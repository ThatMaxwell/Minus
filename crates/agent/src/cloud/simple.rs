//! DigitalOcean and Hetzner: one API token each, plain JSON.

use super::{api_error, Endpoints, Machine, Region, Want};
use serde_json::{json, Value};

fn base(ep: &Endpoints, provider: &str) -> String {
    ep.base.clone().unwrap_or_else(|| if provider == "hetzner" { "https://api.hetzner.cloud/v1".into() } else { "https://api.digitalocean.com/v2".into() })
}
fn name(provider: &str) -> &'static str {
    if provider == "hetzner" { "Hetzner" } else { "DigitalOcean" }
}
fn token(creds: &Value) -> Result<String, String> {
    creds["token"].as_str().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).ok_or_else(|| "Add the API token first.".into())
}
async fn call(http: &reqwest::Client, ep: &Endpoints, provider: &str, creds: &Value, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut rb = http.request(method, format!("{}{path}", base(ep, provider))).bearer_auth(token(creds)?);
    if let Some(b) = body {
        rb = rb.json(&b);
    }
    let r = rb.send().await.map_err(|e| format!("Couldn't reach {} ({e})", name(provider)))?;
    if !r.status().is_success() {
        return Err(api_error(name(provider), r).await);
    }
    let t = r.text().await.unwrap_or_default();
    Ok(serde_json::from_str(&t).unwrap_or(Value::Null))
}

pub async fn regions(http: &reqwest::Client, ep: &Endpoints, provider: &str, creds: &Value) -> Result<Vec<Region>, String> {
    if provider == "hetzner" {
        let v = call(http, ep, provider, creds, reqwest::Method::GET, "/locations", None).await?;
        Ok(v["locations"].as_array().cloned().unwrap_or_default().iter().filter_map(|l| Some(Region { id: l["name"].as_str()?.into(), name: format!("{} ({})", l["city"].as_str().unwrap_or(""), l["country"].as_str().unwrap_or("")) })).collect())
    } else {
        let v = call(http, ep, provider, creds, reqwest::Method::GET, "/regions?per_page=200", None).await?;
        Ok(v["regions"].as_array().cloned().unwrap_or_default().iter().filter(|r| r["available"].as_bool().unwrap_or(true)).filter_map(|r| Some(Region { id: r["slug"].as_str()?.into(), name: r["name"].as_str().unwrap_or("").into() })).collect())
    }
}

/// Minus's key, added to the account once (and found again after that).
async fn key_id(http: &reqwest::Client, ep: &Endpoints, provider: &str, creds: &Value, public_key: &str) -> Result<Value, String> {
    let same = |k: &Value| k["public_key"].as_str().is_some_and(|p| p.split_whitespace().take(2).eq(public_key.split_whitespace().take(2)));
    let (list_path, list_key, add_path) = if provider == "hetzner" { ("/ssh_keys?per_page=50", "ssh_keys", "/ssh_keys") } else { ("/account/keys?per_page=200", "ssh_keys", "/account/keys") };
    let v = call(http, ep, provider, creds, reqwest::Method::GET, list_path, None).await?;
    if let Some(k) = v[list_key].as_array().and_then(|ks| ks.iter().find(|k| same(k)).cloned()) {
        return Ok(k["id"].clone());
    }
    let body = json!({"name": format!("Minus {}", &public_key.split_whitespace().nth(1).unwrap_or("").chars().rev().take(6).collect::<String>()), "public_key": public_key});
    let v = call(http, ep, provider, creds, reqwest::Method::POST, add_path, Some(body)).await?;
    Ok(v["ssh_key"]["id"].clone())
}

pub async fn create(http: &reqwest::Client, ep: &Endpoints, provider: &str, creds: &Value, want: &Want, init: &str) -> Result<Machine, String> {
    let public_key = init.lines().find(|l| l.trim_start().starts_with("- ssh-")).map(|l| l.trim().trim_start_matches("- ").to_string()).unwrap_or_default();
    let key = key_id(http, ep, provider, creds, &public_key).await?;
    let medium = want.size == "medium";
    if provider == "hetzner" {
        // the cheapest x86 type with enough memory that's sold in that location
        let types = call(http, ep, provider, creds, reqwest::Method::GET, "/server_types?per_page=50", None).await?;
        let need = if medium { 8.0 } else { 4.0 };
        let mut fits: Vec<(f64, String)> = types["server_types"].as_array().cloned().unwrap_or_default().iter().filter(|t| {
            t["architecture"].as_str().unwrap_or("x86") == "x86" && t["deprecated"].as_bool() != Some(true) && t["deprecation"].is_null()
                && t["memory"].as_f64().unwrap_or(0.0) >= need
                && t["prices"].as_array().is_some_and(|ps| ps.iter().any(|p| p["location"] == want.region.as_str()))
        }).map(|t| {
            let price = t["prices"].as_array().and_then(|ps| ps.iter().find(|p| p["location"] == want.region.as_str())).and_then(|p| p["price_monthly"]["gross"].as_str()).and_then(|x| x.parse::<f64>().ok()).unwrap_or(999.0);
            (price, t["name"].as_str().unwrap_or("").to_string())
        }).collect();
        fits.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let size = fits.first().map(|f| f.1.clone()).ok_or("Hetzner has no computer that size in that location. Try another one.")?;
        let body = json!({"name": super::slug(&want.name), "server_type": size, "image": "ubuntu-24.04", "location": want.region, "ssh_keys": [key], "user_data": init, "labels": {"minus": "yes"}, "start_after_create": true});
        let v = call(http, ep, provider, creds, reqwest::Method::POST, "/servers", Some(body)).await?;
        let s = &v["server"];
        return Ok(Machine { id: s["id"].to_string(), region: want.region.clone(), size, ip: s["public_net"]["ipv4"]["ip"].as_str().unwrap_or("").into(), status: "starting".into(), ..Default::default() });
    }
    let size = if medium { "s-2vcpu-4gb" } else { "s-1vcpu-2gb" };
    let body = json!({"name": super::slug(&want.name), "region": want.region, "size": size, "image": "ubuntu-24-04-x64", "ssh_keys": [key], "user_data": init, "tags": ["minus"]});
    let v = call(http, ep, provider, creds, reqwest::Method::POST, "/droplets", Some(body)).await?;
    Ok(Machine { id: v["droplet"]["id"].to_string(), region: want.region.clone(), size: size.into(), status: "starting".into(), ..Default::default() })
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<Machine, String> {
    let p = m.provider.as_str();
    let mut n = m.clone();
    if p == "hetzner" {
        let v = match call(http, ep, p, creds, reqwest::Method::GET, &format!("/servers/{}", m.id), None).await {
            Err(e) if e.contains("404") || e.contains("not_found") => { n.status = "gone".into(); return Ok(n); }
            x => x?,
        };
        let s = &v["server"];
        n.ip = s["public_net"]["ipv4"]["ip"].as_str().unwrap_or(&m.ip).into();
        n.status = match s["status"].as_str().unwrap_or("") { "running" => "running", "off" => "stopped", "stopping" => "stopping", "deleting" => "gone", _ => "starting" }.into();
    } else {
        let v = match call(http, ep, p, creds, reqwest::Method::GET, &format!("/droplets/{}", m.id), None).await {
            Err(e) if e.contains("404") || e.to_lowercase().contains("not found") => { n.status = "gone".into(); return Ok(n); }
            x => x?,
        };
        let d = &v["droplet"];
        n.ip = d["networks"]["v4"].as_array().and_then(|a| a.iter().find(|x| x["type"] == "public")).and_then(|x| x["ip_address"].as_str()).unwrap_or(&m.ip).into();
        n.status = match d["status"].as_str().unwrap_or("") { "active" => "running", "off" => "stopped", "archive" => "gone", _ => "starting" }.into();
    }
    Ok(n)
}

pub async fn power(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine, on: bool) -> Result<(), String> {
    let p = m.provider.as_str();
    if p == "hetzner" {
        call(http, ep, p, creds, reqwest::Method::POST, &format!("/servers/{}/actions/{}", m.id, if on { "poweron" } else { "shutdown" }), None).await?;
    } else {
        call(http, ep, p, creds, reqwest::Method::POST, &format!("/droplets/{}/actions", m.id), Some(json!({"type": if on { "power_on" } else { "shutdown" }}))).await?;
    }
    Ok(())
}

pub async fn delete(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<(), String> {
    let p = m.provider.as_str();
    let path = if p == "hetzner" { format!("/servers/{}", m.id) } else { format!("/droplets/{}", m.id) };
    match call(http, ep, p, creds, reqwest::Method::DELETE, &path, None).await {
        Err(e) if e.contains("404") => Ok(()),
        x => x.map(|_| ()),
    }
}
