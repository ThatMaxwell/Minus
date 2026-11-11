//! Cloud computers, for real: small Ubuntu machines in the person's own cloud account (AWS,
//! Google Cloud, Oracle Cloud, DigitalOcean, Hetzner). Minus makes them with its own SSH key,
//! starts and stops them, and agents use them over SSH: commands, files, and a browser of their
//! own that keeps working while your laptop is closed. The person's cloud bills them directly.

pub mod ssh;
mod aws;
mod gcp;
mod oci;
mod simple;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Machine {
    /// the provider's own id for it (OCI/AWS id, GCP name, DO/Hetzner number)
    pub id: String,
    /// aws | gcp | oci | digitalocean | hetzner
    pub provider: String,
    pub name: String,
    /// region, or zone where the provider has them (GCP)
    pub region: String,
    pub size: String,
    #[serde(default)]
    pub ip: String,
    /// starting | running | stopped | stopping | gone
    pub status: String,
    /// its SSH key's fingerprint, pinned the first time Minus connects
    #[serde(default)]
    pub host_key: Option<String>,
    #[serde(default)]
    pub created: u64,
    /// set up and ready (Minus's first-boot setup finished)
    #[serde(default)]
    pub ready: bool,
    /// provider details needed later (OCI's compartment, GCP's project…)
    #[serde(default)]
    pub extra: Value,
}

/// What the person asked for.
#[derive(Deserialize, Clone, Debug)]
pub struct Want {
    pub name: String,
    pub region: String,
    /// "small" (2 GB, enough for a browser) or "medium" (4 GB or more)
    pub size: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Region {
    pub id: String,
    pub name: String,
}

/// The user agents log in as, everywhere.
pub const USER: &str = "minus";

/// First boot: Minus's user with its key, a browser for the agents, and a sign that it's done.
pub fn cloud_init(public_key: &str) -> String {
    format!(
        "#cloud-config\n\
users:\n  - default\n  - name: {USER}\n    shell: /bin/bash\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    ssh_authorized_keys:\n      - {public_key}\n\
package_update: true\n\
packages: [curl, git, jq, unzip, python3-pip, fonts-noto-color-emoji, fonts-liberation]\n\
runcmd:\n  - [bash, -c, 'snap install chromium || apt-get install -y chromium-browser || true']\n  - [bash, -c, 'touch /var/lib/minus-ready']\n"
    )
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
fn b64(b: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(b)
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn sha256(b: &[u8]) -> Vec<u8> {
    ring::digest::digest(&ring::digest::SHA256, b).as_ref().to_vec()
}
/// A name every provider accepts: lowercase letters, digits and dashes.
pub fn slug(name: &str) -> String {
    let s: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    let s = if s.starts_with(|c: char| c.is_ascii_alphabetic()) { s } else { format!("minus-{s}") };
    s.chars().take(40).collect::<String>().trim_end_matches('-').to_string()
}

/// Where each provider's API lives (tests point them at a stand-in).
#[derive(Clone, Default)]
pub struct Endpoints {
    pub base: Option<String>,
}

async fn api_error(name: &str, r: reqwest::Response) -> String {
    let status = r.status();
    let body = r.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let msg = v["error"]["message"].as_str().or(v["message"].as_str()).or(v["error"].as_str()).or(v["errors"][0]["message"].as_str())
        .map(String::from)
        .or_else(|| aws::xml(&body, "Message"))
        .unwrap_or_else(|| body.chars().take(200).collect());
    let low = msg.to_lowercase();
    if status.as_u16() == 401 || status.as_u16() == 403 || low.contains("authfailure") || low.contains("not authorized") || low.contains("invalid credentials") {
        return format!("{name} didn't accept these credentials ({msg}).");
    }
    if low.contains("capacity") {
        return format!("{name} has no room for this computer in that region right now ({msg}). Try another region, or again later.");
    }
    if low.contains("limit") || low.contains("quota") {
        return format!("Your {name} account has reached a limit ({msg}). Raise it in {name}'s console, or remove a computer you don't need.");
    }
    format!("{name}: {msg} ({status})")
}

/// Checks the credentials and lists where computers can go.
pub async fn check(http: &reqwest::Client, ep: &Endpoints, provider: &str, creds: &Value) -> Result<Vec<Region>, String> {
    match provider {
        "aws" => aws::regions(http, ep, creds).await,
        "gcp" => gcp::regions(http, ep, creds).await,
        "oci" => oci::regions(http, ep, creds).await,
        "digitalocean" | "hetzner" => simple::regions(http, ep, provider, creds).await,
        p => Err(format!("Minus doesn't know the cloud “{p}”")),
    }
}

/// Makes a new computer. It boots on its own; `refresh` says when it's up.
pub async fn create(http: &reqwest::Client, ep: &Endpoints, provider: &str, creds: &Value, want: &Want, public_key: &str) -> Result<Machine, String> {
    let init = cloud_init(public_key);
    let mut m = match provider {
        "aws" => aws::create(http, ep, creds, want, &init).await?,
        "gcp" => gcp::create(http, ep, creds, want, &init).await?,
        "oci" => oci::create(http, ep, creds, want, &init, public_key).await?,
        "digitalocean" | "hetzner" => simple::create(http, ep, provider, creds, want, &init).await?,
        p => return Err(format!("Minus doesn't know the cloud “{p}”")),
    };
    m.provider = provider.into();
    m.name = want.name.clone();
    m.created = now();
    if m.status.is_empty() {
        m.status = "starting".into();
    }
    Ok(m)
}

/// Its state and address now.
pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<Machine, String> {
    let mut n = match m.provider.as_str() {
        "aws" => aws::refresh(http, ep, creds, m).await?,
        "gcp" => gcp::refresh(http, ep, creds, m).await?,
        "oci" => oci::refresh(http, ep, creds, m).await?,
        _ => simple::refresh(http, ep, creds, m).await?,
    };
    n.host_key = m.host_key.clone();
    n.ready = m.ready && n.status == "running";
    Ok(n)
}

/// Starts (`on`) or stops it. A stopped computer keeps its files and costs (almost) nothing.
pub async fn power(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine, on: bool) -> Result<(), String> {
    match m.provider.as_str() {
        "aws" => aws::power(http, ep, creds, m, on).await,
        "gcp" => gcp::power(http, ep, creds, m, on).await,
        "oci" => oci::power(http, ep, creds, m, on).await,
        _ => simple::power(http, ep, creds, m, on).await,
    }
}

/// Deletes it, and its disk. There's no undo.
pub async fn delete(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<(), String> {
    match m.provider.as_str() {
        "aws" => aws::delete(http, ep, creds, m).await,
        "gcp" => gcp::delete(http, ep, creds, m).await,
        "oci" => oci::delete(http, ep, creds, m).await,
        _ => simple::delete(http, ep, creds, m).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_every_cloud_takes() {
        assert_eq!(slug("Cloud computer 1"), "cloud-computer-1");
        assert_eq!(slug("  Scout's  PC!! "), "scout-s-pc");
        assert_eq!(slug("1st"), "minus-1st");
    }
    #[test]
    fn first_boot_sets_up_minus() {
        let c = cloud_init("ssh-ed25519 AAAA minus");
        assert!(c.starts_with("#cloud-config\n") && c.contains("- ssh-ed25519 AAAA minus") && c.contains("minus-ready") && c.contains("name: minus"));
    }
}
