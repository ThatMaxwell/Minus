//! Google Cloud: Compute Engine, with a service account key (the JSON file Google gives you).

use super::{api_error, Endpoints, Machine, Region, Want};
use base64::Engine as _;
use serde_json::{json, Value};

fn b64url(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}
pub(crate) fn pem_der(pem: &str) -> Result<Vec<u8>, String> {
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect::<Vec<_>>().join("");
    base64::engine::general_purpose::STANDARD.decode(body.trim()).map_err(|_| "The private key isn't readable. Paste the whole key file.".to_string())
}

struct Gcp<'a> {
    http: &'a reqwest::Client,
    ep: &'a Endpoints,
    project: String,
    token: String,
}
impl<'a> Gcp<'a> {
    /// Signs in as the service account (a signed JWT traded for an hour-long token).
    async fn new(http: &'a reqwest::Client, ep: &'a Endpoints, creds: &Value) -> Result<Gcp<'a>, String> {
        let sa = if creds["key"].is_object() { &creds["key"] } else { creds };
        let email = sa["client_email"].as_str().ok_or("That isn't a service account key. In Google Cloud, make one under IAM → Service accounts → Keys, and paste the JSON.")?;
        let project = creds["project"].as_str().or(sa["project_id"].as_str()).ok_or("The key doesn't say which project it's for.")?.to_string();
        let der = pem_der(sa["private_key"].as_str().unwrap_or(""))?;
        let kp = ring::signature::RsaKeyPair::from_pkcs8(&der).map_err(|_| "The service account's private key isn't readable.".to_string())?;
        let token_uri = sa["token_uri"].as_str().unwrap_or("https://oauth2.googleapis.com/token");
        let now = super::now();
        let head = b64url(json!({"alg": "RS256", "typ": "JWT"}).to_string().as_bytes());
        let claims = b64url(json!({"iss": email, "scope": "https://www.googleapis.com/auth/compute", "aud": token_uri, "iat": now, "exp": now + 3600}).to_string().as_bytes());
        let msg = format!("{head}.{claims}");
        let mut sig = vec![0u8; kp.public().modulus_len()];
        kp.sign(&ring::signature::RSA_PKCS1_SHA256, &ring::rand::SystemRandom::new(), msg.as_bytes(), &mut sig).map_err(|_| "Couldn't sign in to Google Cloud.".to_string())?;
        let jwt = format!("{msg}.{}", b64url(&sig));
        let url = ep.base.as_ref().map(|b| format!("{b}/token")).unwrap_or_else(|| token_uri.to_string());
        let r = http.post(url).form(&[("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"), ("assertion", jwt.as_str())]).send().await.map_err(|e| format!("Couldn't reach Google Cloud ({e})"))?;
        if !r.status().is_success() {
            return Err(api_error("Google Cloud", r).await);
        }
        let v: Value = r.json().await.map_err(|e| e.to_string())?;
        let token = v["access_token"].as_str().ok_or("Google Cloud didn't sign in.")?.to_string();
        Ok(Gcp { http, ep, project, token })
    }
    fn url(&self, path: &str) -> String {
        format!("{}/compute/v1/projects/{}{path}", self.ep.base.clone().unwrap_or_else(|| "https://compute.googleapis.com".into()), self.project)
    }
    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let mut rb = self.http.request(method, self.url(path)).bearer_auth(&self.token);
        if let Some(b) = body {
            rb = rb.json(&b);
        }
        let r = rb.send().await.map_err(|e| format!("Couldn't reach Google Cloud ({e})"))?;
        if !r.status().is_success() {
            return Err(api_error("Google Cloud", r).await);
        }
        Ok(r.json().await.unwrap_or(Value::Null))
    }
}

pub async fn regions(http: &reqwest::Client, ep: &Endpoints, creds: &Value) -> Result<Vec<Region>, String> {
    let g = Gcp::new(http, ep, creds).await?;
    let v = g.call(reqwest::Method::GET, "/zones?maxResults=500", None).await?;
    let mut zs: Vec<Region> = v["items"].as_array().cloned().unwrap_or_default().iter().filter(|z| z["status"] == "UP").filter_map(|z| Some(Region { id: z["name"].as_str()?.into(), name: z["name"].as_str()?.into() })).collect();
    zs.sort_by(|a, b| (!a.id.starts_with("us-central1")).cmp(&!b.id.starts_with("us-central1")).then(a.id.cmp(&b.id)));
    Ok(zs)
}

pub async fn create(http: &reqwest::Client, ep: &Endpoints, creds: &Value, want: &Want, init: &str) -> Result<Machine, String> {
    let g = Gcp::new(http, ep, creds).await?;
    let zone = want.region.as_str();
    // SSH in (the default network usually allows it already; this makes sure)
    let fw = json!({"name": "minus-ssh", "network": "global/networks/default", "allowed": [{"IPProtocol": "tcp", "ports": ["22"]}], "sourceRanges": ["0.0.0.0/0"], "targetTags": ["minus"]});
    if let Err(e) = g.call(reqwest::Method::POST, "/global/firewalls", Some(fw)).await {
        if !e.contains("already exists") && !e.contains("409") {
            return Err(e);
        }
    }
    let size = if want.size == "medium" { "e2-medium" } else { "e2-small" };
    let name = super::slug(&want.name);
    let body = json!({
        "name": name, "machineType": format!("zones/{zone}/machineTypes/{size}"),
        "disks": [{"boot": true, "autoDelete": true, "initializeParams": {"sourceImage": "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64", "diskSizeGb": "20"}}],
        "networkInterfaces": [{"network": "global/networks/default", "accessConfigs": [{"type": "ONE_TO_ONE_NAT", "name": "External NAT"}]}],
        "metadata": {"items": [{"key": "user-data", "value": init}]},
        "tags": {"items": ["minus"]}, "labels": {"minus": "yes"},
    });
    g.call(reqwest::Method::POST, &format!("/zones/{zone}/instances"), Some(body)).await?;
    Ok(Machine { id: name, region: zone.into(), size: size.into(), status: "starting".into(), extra: json!({"project": g.project}), ..Default::default() })
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<Machine, String> {
    let g = Gcp::new(http, ep, creds).await?;
    let mut n = m.clone();
    let v = match g.call(reqwest::Method::GET, &format!("/zones/{}/instances/{}", m.region, m.id), None).await {
        Err(e) if e.contains("404") || e.contains("not found") => { n.status = "gone".into(); return Ok(n); }
        r => r?,
    };
    n.ip = v["networkInterfaces"][0]["accessConfigs"][0]["natIP"].as_str().unwrap_or("").into();
    n.status = match v["status"].as_str().unwrap_or("") { "RUNNING" => "running", "TERMINATED" | "STOPPED" | "SUSPENDED" => "stopped", "STOPPING" | "SUSPENDING" => "stopping", _ => "starting" }.into();
    Ok(n)
}

pub async fn power(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine, on: bool) -> Result<(), String> {
    let g = Gcp::new(http, ep, creds).await?;
    g.call(reqwest::Method::POST, &format!("/zones/{}/instances/{}/{}", m.region, m.id, if on { "start" } else { "stop" }), None).await.map(|_| ())
}

pub async fn delete(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<(), String> {
    let g = Gcp::new(http, ep, creds).await?;
    match g.call(reqwest::Method::DELETE, &format!("/zones/{}/instances/{}", m.region, m.id), None).await {
        Err(e) if e.contains("404") => Ok(()),
        r => r.map(|_| ()),
    }
}
