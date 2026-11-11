//! "Sign in with ChatGPT": use your ChatGPT plan in Minus instead of an API key.
//!
//! OpenAI's flow for open-source apps that run on your own computer: no client secret. The
//! first sign-in registers Minus on your account (`dynamic_agent_client`) and OpenAI gives back
//! a client id, kept for next time. It's OAuth with PKCE, through the browser, coming back to a
//! one-time listener on 127.0.0.1. The ID token's signature is checked against OpenAI's keys.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const JWKS: &str = "https://auth.openai.com/.well-known/jwks.json";
const DISCOVERY: &str = "https://auth.openai.com/.well-known/openid-configuration";
pub const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PATH: &str = "/auth/callback";

/// What's kept (in the OS password store) after signing in.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Saved {
    pub client_id: String,
    pub host_id: String,
    pub email: String,
    pub subject: String,
    pub id_token: String,
    pub access_token: String,
    pub refresh_token: String,
    /// seconds since 1970
    pub expires_at: u64,
    pub scopes: String,
}
impl Saved {
    pub fn fresh(&self) -> bool {
        self.expires_at > now() + 300
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
fn b64url(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}
fn random(n: usize) -> Vec<u8> {
    use ring::rand::SecureRandom;
    let mut b = vec![0u8; n];
    ring::rand::SystemRandom::new().fill(&mut b).expect("the system's random numbers");
    b
}

/// An id for this computer, made once and kept (it's not a secret, and not about the person).
pub fn new_host_id() -> String {
    let mut b = random(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("urn:uuid:{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// A sign-in under way: the page to open, and what's needed to finish it.
pub struct Pending {
    pub url: String,
    listener: tokio::net::TcpListener,
    redirect: String,
    state: String,
    nonce: String,
    verifier: String,
    client_id: Option<String>,
    host_id: String,
}

/// Starts signing in. `client_id` is the one OpenAI gave last time (none the first time).
pub async fn begin(client_id: Option<String>, host_id: &str, previous_id_token: Option<&str>) -> Result<Pending, String> {
    // OpenAI's usual port first; any other free one if that's taken (only the port may change)
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:1455").await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("Couldn't get ready for the sign-in ({e})"))?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}{PATH}");
    let (state, nonce, verifier) = (b64url(&random(24)), b64url(&random(24)), b64url(&random(48)));
    let challenge = b64url(ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes()).as_ref());
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    q.append_pair("client_id", client_id.as_deref().unwrap_or("dynamic_agent_client"));
    if client_id.is_none() {
        q.append_pair("agent_name_hint", "Minus");
    }
    q.append_pair("ext_agent_host_id", host_id);
    if let Some(t) = previous_id_token {
        q.append_pair("id_token_hint", t);
    }
    q.append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect)
        .append_pair("scope", SCOPES)
        .append_pair("resource", RESOURCE)
        .append_pair("state", &state)
        .append_pair("nonce", &nonce)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &challenge);
    Ok(Pending { url: format!("{AUTHORIZE}?{}", q.finish()), listener, redirect, state, nonce, verifier, client_id, host_id: host_id.to_string() })
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Minus</title><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#0b0b0c;color:#f2f2ef;font:16px system-ui\"><div style=\"text-align:center\"><h1 style=\"font-weight:500\">You're signed in</h1><p style=\"color:#a6a6ab\">Go back to Minus. You can close this tab.</p></div>";
const PAGE_NO: &str = "<!doctype html><meta charset=utf-8><title>Minus</title><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#0b0b0c;color:#f2f2ef;font:16px system-ui\"><div style=\"text-align:center\"><h1 style=\"font-weight:500\">Not signed in</h1><p style=\"color:#a6a6ab\">Go back to Minus to try again, or use an API key there.</p></div>";

/// Waits for the browser to come back (up to 10 minutes), then trades the code for tokens.
pub async fn finish(http: &reqwest::Client, p: Pending) -> Result<Saved, String> {
    let q = tokio::time::timeout(std::time::Duration::from_secs(600), async {
        loop {
            let (mut sock, _) = p.listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 16384];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let target = req.split_whitespace().nth(1).unwrap_or("").to_string();
            if !target.starts_with(PATH) {
                let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                continue;
            }
            let query: Vec<(String, String)> = url::form_urlencoded::parse(target.split_once('?').map(|x| x.1).unwrap_or("").as_bytes()).into_owned().collect();
            let get = |k: &str| query.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
            let ok = get("code").is_some() && get("state").as_deref() == Some(p.state.as_str());
            let page = if ok { PAGE_OK } else { PAGE_NO };
            let _ = sock.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes()).await;
            return Ok::<_, String>(query);
        }
    })
    .await
    .map_err(|_| "The sign-in wasn't finished in time. Try again.".to_string())??;
    let get = |k: &str| q.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
    if get("state").as_deref() != Some(p.state.as_str()) {
        return Err("The sign-in came back from somewhere else, so it was ignored. Try again.".into());
    }
    if let Some(e) = get("error") {
        return Err(if e == "access_denied" { "You didn't allow it, so Minus isn't using your ChatGPT plan. You can use an API key instead.".into() } else { format!("ChatGPT didn't sign you in ({e})") });
    }
    let code = get("code").ok_or("ChatGPT sent no sign-in code. Try again.")?;
    // the first time, OpenAI names Minus's client id here; after that it must stay the same
    let client_id = match (get("client_id"), p.client_id.clone()) {
        (Some(new), Some(old)) if new != old => return Err("ChatGPT answered for a different app registration. Try again.".into()),
        (Some(new), _) => new,
        (None, Some(old)) => old,
        (None, None) => return Err("ChatGPT didn't register Minus. Try again.".into()),
    };
    let r = http
        .post(TOKEN)
        .form(&[("grant_type", "authorization_code"), ("client_id", &client_id), ("code", &code), ("code_verifier", &p.verifier), ("redirect_uri", &p.redirect), ("resource", RESOURCE)])
        .send()
        .await
        .map_err(|e| format!("Couldn't reach ChatGPT ({e})"))?;
    let v = tokens(r).await?;
    let mut s = Saved { client_id, host_id: p.host_id.clone(), ..Default::default() };
    take(&mut s, &v);
    let claims = verify(http, &s.id_token, &s.client_id, Some(&p.nonce)).await?;
    s.email = claims["email"].as_str().unwrap_or("").to_string();
    s.subject = claims["sub"].as_str().unwrap_or("").to_string();
    if !s.scopes.split_whitespace().any(|x| x == "chatgpt.tokens.use.direct") {
        return Err("You signed in, but ChatGPT didn't allow Minus to use your plan. Your plan may not include it yet (Plus or Pro).".into());
    }
    Ok(s)
}

async fn tokens(r: reqwest::Response) -> Result<Value, String> {
    let status = r.status();
    let body = r.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    if !status.is_success() {
        let why = v["error_description"].as_str().or(v["error"].as_str()).unwrap_or(&body).to_string();
        return Err(if v["error"] == "invalid_grant" { format!("Your ChatGPT sign-in has ended ({why}). Sign in again.") } else { format!("ChatGPT didn't sign you in ({status}: {why})") });
    }
    Ok(v)
}
fn take(s: &mut Saved, v: &Value) {
    if let Some(t) = v["access_token"].as_str() { s.access_token = t.into(); }
    if let Some(t) = v["refresh_token"].as_str() { s.refresh_token = t.into(); }
    if let Some(t) = v["id_token"].as_str() { s.id_token = t.into(); }
    if let Some(t) = v["scope"].as_str() { s.scopes = t.into(); }
    s.expires_at = now() + v["expires_in"].as_u64().unwrap_or(3600);
}

/// A new access token (they last an hour); the refresh token is replaced too.
pub async fn refresh(http: &reqwest::Client, s: &Saved) -> Result<Saved, String> {
    let r = http
        .post(TOKEN)
        .form(&[("grant_type", "refresh_token"), ("client_id", s.client_id.as_str()), ("refresh_token", s.refresh_token.as_str()), ("resource", RESOURCE)])
        .send()
        .await
        .map_err(|e| format!("Couldn't reach ChatGPT ({e})"))?;
    let v = tokens(r).await?;
    let mut n = s.clone();
    take(&mut n, &v);
    Ok(n)
}

/// Signing out: OpenAI forgets this sign-in (the registration stays, for next time).
pub async fn revoke(http: &reqwest::Client, s: &Saved) -> Result<(), String> {
    let d: Value = http.get(DISCOVERY).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let at = d["revocation_endpoint"].as_str().ok_or("no revocation endpoint")?;
    let r = http.post(at).form(&[("token", s.refresh_token.as_str()), ("token_type_hint", "refresh_token"), ("client_id", s.client_id.as_str())]).send().await.map_err(|e| e.to_string())?;
    if r.status().is_success() { Ok(()) } else { Err(format!("revocation answered {}", r.status())) }
}

/// The ID token, checked: signed by OpenAI (RS256, its published keys), for Minus, not expired,
/// and the one this sign-in asked for. Returns its claims.
pub async fn verify(http: &reqwest::Client, jwt: &str, client_id: &str, nonce: Option<&str>) -> Result<Value, String> {
    let keys: Value = http.get(JWKS).send().await.map_err(|e| format!("Couldn't check the sign-in ({e})"))?.json().await.map_err(|e| e.to_string())?;
    check_jwt(jwt, &keys, client_id, nonce, now())
}
pub fn check_jwt(jwt: &str, keys: &Value, client_id: &str, nonce: Option<&str>, at: u64) -> Result<Value, String> {
    let bad = |w: &str| Err(format!("The sign-in couldn't be verified ({w}). Try again."));
    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() != 3 {
        return bad("not a token");
    }
    let dec = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s.trim_end_matches('='));
    let (Ok(h), Ok(c), Ok(sig)) = (dec(parts[0]), dec(parts[1]), dec(parts[2])) else { return bad("unreadable") };
    let header: Value = serde_json::from_slice(&h).unwrap_or(Value::Null);
    let claims: Value = serde_json::from_slice(&c).unwrap_or(Value::Null);
    if header["alg"] != "RS256" {
        return bad("unexpected signature type");
    }
    let key = keys["keys"].as_array().and_then(|ks| ks.iter().find(|k| k["kid"] == header["kid"] || (header["kid"].is_null() && k["kty"] == "RSA"))).ok_or("The sign-in was signed with a key OpenAI doesn't list")?;
    let (Some(n), Some(e)) = (key["n"].as_str().and_then(|x| dec(x).ok()), key["e"].as_str().and_then(|x| dec(x).ok())) else { return bad("unreadable key") };
    let pk = ring::signature::RsaPublicKeyComponents { n: &n, e: &e };
    if pk.verify(&ring::signature::RSA_PKCS1_2048_8192_SHA256, format!("{}.{}", parts[0], parts[1]).as_bytes(), &sig).is_err() {
        return bad("bad signature");
    }
    if claims["iss"] != ISSUER {
        return bad("wrong issuer");
    }
    let aud_ok = match &claims["aud"] { Value::String(a) => a == client_id, Value::Array(a) => a.iter().any(|x| x == client_id), _ => false };
    if !aud_ok {
        return bad("for another app");
    }
    if claims["exp"].as_u64().unwrap_or(0) + 5 < at {
        return bad("expired");
    }
    if let Some(nn) = nonce {
        if claims["nonce"].as_str() != Some(nn) {
            return bad("from another sign-in");
        }
    }
    Ok(claims)
}

/// The models this ChatGPT plan can use: (slug, name).
pub async fn models(http: &reqwest::Client, access: &str) -> Result<Vec<(String, String)>, String> {
    let r = http.get(format!("{RESOURCE}/models")).bearer_auth(access).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("ChatGPT didn't list its models ({})", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(v["data"].as_array().cloned().unwrap_or_default().iter()
        .filter(|m| m["visibility"].as_str().map_or(true, |x| x == "list"))
        .filter_map(|m| {
            let slug = m["slug"].as_str().or(m["id"].as_str())?.to_string();
            Some((slug.clone(), m["display_name"].as_str().unwrap_or(&slug).to_string()))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_ids_look_right() {
        let h = new_host_id();
        assert!(h.starts_with("urn:uuid:") && h.len() == 45 && &h[23..24] == "4", "{h}");
        assert_ne!(h, new_host_id());
    }
    #[tokio::test]
    async fn the_sign_in_page_asks_for_the_plan() {
        let p = begin(None, "urn:uuid:test", None).await.unwrap();
        for want in ["client_id=dynamic_agent_client", "agent_name_hint=Minus", "chatgpt.tokens.use.direct", "code_challenge_method=S256", "resource=https%3A%2F%2Fapi.openai.com%2Fv1", "redirect_uri=http%3A%2F%2F127.0.0.1%3A"] {
            assert!(p.url.contains(want), "{want} missing from {}", p.url);
        }
        let p2 = begin(Some("oaiapp_x".into()), "urn:uuid:test", None).await.unwrap();
        assert!(p2.url.contains("client_id=oaiapp_x") && !p2.url.contains("agent_name_hint"));
    }
    #[test]
    fn a_forged_token_is_turned_down() {
        let enc = |v: &Value| b64url(v.to_string().as_bytes());
        let jwt = format!("{}.{}.{}", enc(&serde_json::json!({"alg": "RS256", "kid": "k1"})), enc(&serde_json::json!({"iss": ISSUER, "aud": "oaiapp_x", "exp": 9_999_999_999u64, "nonce": "n"})), b64url(b"not a signature"));
        let keys = serde_json::json!({"keys": [{"kid": "k1", "kty": "RSA", "n": b64url(&[0xc5; 256]), "e": "AQAB"}]});
        assert!(check_jwt(&jwt, &keys, "oaiapp_x", Some("n"), now()).unwrap_err().contains("bad signature"));
        let none = format!("{}.{}.", enc(&serde_json::json!({"alg": "none"})), enc(&serde_json::json!({"iss": ISSUER})));
        assert!(check_jwt(&none, &keys, "oaiapp_x", None, now()).is_err());
    }
}
