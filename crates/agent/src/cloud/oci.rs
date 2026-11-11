//! Oracle Cloud (OCI): compute instances, with an API key (requests signed with RSA). Uses the
//! Ampere A1 shape, which fits Oracle's Always Free allowance. Minus sets up a small network
//! of its own the first time (a VCN with internet access and SSH).

use super::{api_error, b64, sha256, Endpoints, Machine, Region, Want};
use serde_json::{json, Value};

fn http_date() -> String {
    let s = super::now();
    let days = s / 86400;
    let wd = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][(days % 7) as usize];
    let rem = s % 86400;
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m - 1) as usize];
    format!("{wd}, {d:02} {mon} {y} {:02}:{:02}:{:02} GMT", rem / 3600, rem % 3600 / 60, rem % 60)
}

struct Oci<'a> {
    http: &'a reqwest::Client,
    ep: &'a Endpoints,
    key_id: String,
    key: ring::signature::RsaKeyPair,
    region: String,
    compartment: String,
    tenancy: String,
}
impl<'a> Oci<'a> {
    fn new(http: &'a reqwest::Client, ep: &'a Endpoints, creds: &Value) -> Result<Self, String> {
        let g = |k: &str| creds[k].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let (Some(tenancy), Some(user), Some(fp), Some(pem), Some(region)) = (g("tenancy"), g("user"), g("fingerprint"), g("private_key"), g("region")) else {
            return Err("Add your tenancy OCID, user OCID, key fingerprint, private key and region (from Oracle Cloud's API key page).".into());
        };
        let der = super::gcp::pem_der(&pem)?;
        let key = ring::signature::RsaKeyPair::from_pkcs8(&der).or_else(|_| ring::signature::RsaKeyPair::from_der(&der)).map_err(|_| "The private key isn't readable. Paste the whole .pem file.".to_string())?;
        let compartment = g("compartment").unwrap_or_else(|| tenancy.clone());
        Ok(Oci { http, ep, key_id: format!("{tenancy}/{user}/{fp}"), key, region, compartment, tenancy })
    }
    fn host(&self, service: &str) -> String {
        format!("{service}.{}.oraclecloud.com", self.region)
    }
    /// A signed request (OCI's HTTP signatures).
    async fn call(&self, service: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let host = self.host(service);
        let url = format!("{}{path}", self.ep.base.clone().unwrap_or_else(|| format!("https://{host}")));
        let date = http_date();
        let m = method.as_str().to_lowercase();
        let mut lines = vec![format!("date: {date}"), format!("(request-target): {m} {path}"), format!("host: {host}")];
        let mut names = "date (request-target) host".to_string();
        let data = body.as_ref().map(|b| b.to_string());
        if let Some(d) = &data {
            lines.push(format!("content-length: {}", d.len()));
            lines.push("content-type: application/json".into());
            lines.push(format!("x-content-sha256: {}", b64(&sha256(d.as_bytes()))));
            names.push_str(" content-length content-type x-content-sha256");
        }
        let mut sig = vec![0u8; self.key.public().modulus_len()];
        self.key.sign(&ring::signature::RSA_PKCS1_SHA256, &ring::rand::SystemRandom::new(), lines.join("\n").as_bytes(), &mut sig).map_err(|_| "Couldn't sign the request.".to_string())?;
        let auth = format!("Signature version=\"1\",keyId=\"{}\",algorithm=\"rsa-sha256\",headers=\"{names}\",signature=\"{}\"", self.key_id, b64(&sig));
        let mut rb = self.http.request(method, url).header("date", &date).header("authorization", auth);
        if let Some(d) = data {
            rb = rb.header("content-type", "application/json").header("x-content-sha256", b64(&sha256(d.as_bytes()))).body(d);
        }
        let r = rb.send().await.map_err(|e| format!("Couldn't reach Oracle Cloud ({e})"))?;
        if !r.status().is_success() {
            return Err(api_error("Oracle Cloud", r).await);
        }
        let t = r.text().await.unwrap_or_default();
        Ok(serde_json::from_str(&t).unwrap_or(Value::Null))
    }
    async fn wait_available(&self, path: &str) -> Result<Value, String> {
        for _ in 0..30 {
            let v = self.call("iaas", reqwest::Method::GET, path, None).await?;
            if v["lifecycleState"] == "AVAILABLE" {
                return Ok(v);
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        Err("Oracle Cloud took too long setting up the network. Try again.".into())
    }
    /// Minus's own little network: a VCN with a route to the internet and a public subnet.
    async fn subnet(&self) -> Result<String, String> {
        let c = &self.compartment;
        let q = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
        let vcns = self.call("iaas", reqwest::Method::GET, &format!("/20160918/vcns?compartmentId={}&displayName=minus", q(c)), None).await?;
        let vcn = match vcns.as_array().and_then(|a| a.iter().find(|v| v["lifecycleState"] == "AVAILABLE").cloned()) {
            Some(v) => v,
            None => {
                let v = self.call("iaas", reqwest::Method::POST, "/20160918/vcns", Some(json!({"compartmentId": c, "cidrBlocks": ["10.0.0.0/16"], "displayName": "minus", "dnsLabel": "minus"}))).await?;
                self.wait_available(&format!("/20160918/vcns/{}", v["id"].as_str().unwrap_or(""))).await?
            }
        };
        let vcn_id = vcn["id"].as_str().unwrap_or("").to_string();
        let igws = self.call("iaas", reqwest::Method::GET, &format!("/20160918/internetGateways?compartmentId={}&vcnId={}", q(c), q(&vcn_id)), None).await?;
        let igw = match igws.as_array().and_then(|a| a.first().cloned()) {
            Some(g) => g["id"].as_str().unwrap_or("").to_string(),
            None => self.call("iaas", reqwest::Method::POST, "/20160918/internetGateways", Some(json!({"compartmentId": c, "vcnId": vcn_id, "isEnabled": true, "displayName": "minus"}))).await?["id"].as_str().unwrap_or("").to_string(),
        };
        let rt_id = vcn["defaultRouteTableId"].as_str().unwrap_or("").to_string();
        let rt = self.call("iaas", reqwest::Method::GET, &format!("/20160918/routeTables/{rt_id}"), None).await?;
        let mut rules = rt["routeRules"].as_array().cloned().unwrap_or_default();
        if !rules.iter().any(|r| r["destination"] == "0.0.0.0/0") {
            rules.push(json!({"destination": "0.0.0.0/0", "destinationType": "CIDR_BLOCK", "networkEntityId": igw}));
            self.call("iaas", reqwest::Method::PUT, &format!("/20160918/routeTables/{rt_id}"), Some(json!({"routeRules": rules}))).await?;
        }
        let subs = self.call("iaas", reqwest::Method::GET, &format!("/20160918/subnets?compartmentId={}&vcnId={}", q(c), q(&vcn_id)), None).await?;
        if let Some(s) = subs.as_array().and_then(|a| a.iter().find(|s| s["prohibitPublicIpOnVnic"] == false).cloned()) {
            return Ok(s["id"].as_str().unwrap_or("").to_string());
        }
        let s = self.call("iaas", reqwest::Method::POST, "/20160918/subnets", Some(json!({"compartmentId": c, "vcnId": vcn_id, "cidrBlock": "10.0.0.0/24", "displayName": "minus", "prohibitPublicIpOnVnic": false}))).await?;
        let id = s["id"].as_str().unwrap_or("").to_string();
        self.wait_available(&format!("/20160918/subnets/{id}")).await?;
        Ok(id)
    }
}

pub async fn regions(http: &reqwest::Client, ep: &Endpoints, creds: &Value) -> Result<Vec<Region>, String> {
    let o = Oci::new(http, ep, creds)?;
    let v = o.call("identity", reqwest::Method::GET, &format!("/20160918/tenancies/{}/regionSubscriptions", o.tenancy), None).await?;
    let mut rs: Vec<Region> = v.as_array().cloned().unwrap_or_default().iter().filter_map(|r| Some(Region { id: r["regionName"].as_str()?.into(), name: format!("{}{}", r["regionName"].as_str()?, if r["isHomeRegion"] == true { " (home)" } else { "" }) })).collect();
    if rs.is_empty() {
        rs.push(Region { id: o.region.clone(), name: o.region.clone() });
    }
    Ok(rs)
}

pub async fn create(http: &reqwest::Client, ep: &Endpoints, creds: &Value, want: &Want, init: &str, public_key: &str) -> Result<Machine, String> {
    let mut c = creds.clone();
    c["region"] = json!(want.region);
    let o = Oci::new(http, ep, &c)?;
    let subnet = o.subnet().await?;
    let q = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    let ads = o.call("identity", reqwest::Method::GET, &format!("/20160918/availabilityDomains?compartmentId={}", q(&o.tenancy)), None).await?;
    let ad = ads[0]["name"].as_str().ok_or("Oracle Cloud listed no availability domain.")?.to_string();
    let shape = "VM.Standard.A1.Flex";
    let imgs = o.call("iaas", reqwest::Method::GET, &format!("/20160918/images?compartmentId={}&operatingSystem={}&operatingSystemVersion=24.04&shape={shape}&sortBy=TIMECREATED&sortOrder=DESC&limit=1", q(&o.compartment), q("Canonical Ubuntu")), None).await?;
    let image = imgs[0]["id"].as_str().ok_or("Oracle Cloud has no Ubuntu 24.04 image for this shape in that region.")?.to_string();
    let (ocpus, mem) = if want.size == "medium" { (2, 12) } else { (1, 6) };
    let body = json!({
        "availabilityDomain": ad, "compartmentId": o.compartment, "displayName": want.name, "shape": shape,
        "shapeConfig": {"ocpus": ocpus, "memoryInGBs": mem},
        "sourceDetails": {"sourceType": "image", "imageId": image, "bootVolumeSizeInGBs": 50},
        "createVnicDetails": {"subnetId": subnet, "assignPublicIp": true},
        "metadata": {"ssh_authorized_keys": public_key, "user_data": b64(init.as_bytes())},
        "freeformTags": {"minus": "yes"},
    });
    let v = o.call("iaas", reqwest::Method::POST, "/20160918/instances", Some(body)).await?;
    Ok(Machine { id: v["id"].as_str().unwrap_or("").into(), region: want.region.clone(), size: format!("{shape} ({ocpus} OCPU, {mem} GB)"), status: "starting".into(), extra: json!({"compartment": o.compartment}), ..Default::default() })
}

fn at(creds: &Value, m: &Machine) -> Value {
    let mut c = creds.clone();
    c["region"] = json!(m.region);
    if let Some(cp) = m.extra["compartment"].as_str() {
        c["compartment"] = json!(cp);
    }
    c
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<Machine, String> {
    let c = at(creds, m);
    let o = Oci::new(http, ep, &c)?;
    let mut n = m.clone();
    let v = match o.call("iaas", reqwest::Method::GET, &format!("/20160918/instances/{}", m.id), None).await {
        Err(e) if e.contains("404") || e.contains("NotAuthorizedOrNotFound") => { n.status = "gone".into(); return Ok(n); }
        r => r?,
    };
    n.status = match v["lifecycleState"].as_str().unwrap_or("") { "RUNNING" => "running", "STOPPED" => "stopped", "STOPPING" => "stopping", "TERMINATING" | "TERMINATED" => "gone", _ => "starting" }.into();
    if n.status == "running" && n.ip.is_empty() {
        let q = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
        let atts = o.call("iaas", reqwest::Method::GET, &format!("/20160918/vnicAttachments?compartmentId={}&instanceId={}", q(&o.compartment), q(&m.id)), None).await?;
        if let Some(vnic) = atts.as_array().and_then(|a| a.iter().find(|x| x["lifecycleState"] == "ATTACHED")).and_then(|x| x["vnicId"].as_str()) {
            let v = o.call("iaas", reqwest::Method::GET, &format!("/20160918/vnics/{vnic}"), None).await?;
            n.ip = v["publicIp"].as_str().unwrap_or("").into();
        }
    }
    Ok(n)
}

pub async fn power(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine, on: bool) -> Result<(), String> {
    let c = at(creds, m);
    Oci::new(http, ep, &c)?.call("iaas", reqwest::Method::POST, &format!("/20160918/instances/{}?action={}", m.id, if on { "START" } else { "SOFTSTOP" }), None).await.map(|_| ())
}

pub async fn delete(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<(), String> {
    let c = at(creds, m);
    match Oci::new(http, ep, &c)?.call("iaas", reqwest::Method::DELETE, &format!("/20160918/instances/{}?preserveBootVolume=false", m.id), None).await {
        Err(e) if e.contains("404") => Ok(()),
        r => r.map(|_| ()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn dates_look_like_http_dates() {
        let d = super::http_date();
        assert!(d.ends_with(" GMT") && d.len() == 29 && d.as_bytes()[3] == b',', "{d}");
    }
}
