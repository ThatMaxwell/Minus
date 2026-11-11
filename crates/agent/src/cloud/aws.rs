//! AWS: EC2 instances, signed with Signature Version 4 from an access key.

use super::{api_error, b64, hex, sha256, Endpoints, Machine, Region, Want};
use serde_json::{json, Value};

fn hmac(key: &[u8], msg: &[u8]) -> Vec<u8> {
    ring::hmac::sign(&ring::hmac::Key::new(ring::hmac::HMAC_SHA256, key), msg).as_ref().to_vec()
}
fn enc(s: &str) -> String {
    // AWS's encoding: everything but unreserved characters
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// The Authorization header for a request (SigV4). `headers` are lowercase names with values.
pub fn sign(method: &str, host: &str, path: &str, query: &str, headers: &[(&str, &str)], payload: &[u8], region: &str, service: &str, key_id: &str, secret: &str, amz_date: &str) -> String {
    let date = &amz_date[..8];
    let mut hs: Vec<(String, String)> = headers.iter().map(|(k, v)| (k.to_lowercase(), v.trim().to_string())).collect();
    if !hs.iter().any(|(k, _)| k == "host") {
        hs.push(("host".into(), host.into()));
    }
    hs.sort();
    let canonical_headers: String = hs.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed: String = hs.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");
    let mut q: Vec<(String, String)> = query.split('&').filter(|x| !x.is_empty()).map(|p| { let (k, v) = p.split_once('=').unwrap_or((p, "")); (k.to_string(), v.to_string()) }).collect();
    q.sort();
    let canonical_query = q.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let creq = format!("{method}\n{path}\n{canonical_query}\n{canonical_headers}\n{signed}\n{}", hex(&sha256(payload)));
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let sts = format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", hex(&sha256(creq.as_bytes())));
    let k = hmac(&hmac(&hmac(&hmac(format!("AWS4{secret}").as_bytes(), date.as_bytes()), region.as_bytes()), service.as_bytes()), b"aws4_request");
    format!("AWS4-HMAC-SHA256 Credential={key_id}/{scope}, SignedHeaders={signed}, Signature={}", hex(&hmac(&k, sts.as_bytes())))
}

fn amz_date() -> String {
    // YYYYMMDDTHHMMSSZ from the clock, without a date library
    let s = super::now();
    let (days, rem) = (s / 86400, s % 86400);
    let (h, mi, se) = (rem / 3600, rem % 3600 / 60, rem % 60);
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}{m:02}{d:02}T{h:02}{mi:02}{se:02}Z")
}

/// The text of the first <tag> in an XML reply (EC2 answers in XML).
pub fn xml(body: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let i = body.find(&open)? + open.len();
    let j = body[i..].find(&format!("</{tag}>"))? + i;
    Some(body[i..j].trim().to_string())
}
fn xml_all(body: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(i) = rest.find(&open) {
        let after = &rest[i + open.len()..];
        let Some(j) = after.find(&format!("</{tag}>")) else { break };
        out.push(after[..j].trim().to_string());
        rest = &after[j..];
    }
    out
}

struct Aws<'a> {
    http: &'a reqwest::Client,
    ep: &'a Endpoints,
    key: String,
    secret: String,
}
impl<'a> Aws<'a> {
    fn new(http: &'a reqwest::Client, ep: &'a Endpoints, creds: &Value) -> Result<Self, String> {
        let key = creds["access_key"].as_str().unwrap_or("").trim().to_string();
        let secret = creds["secret_key"].as_str().unwrap_or("").trim().to_string();
        if key.is_empty() || secret.is_empty() {
            return Err("Add the access key ID and secret access key first.".into());
        }
        Ok(Aws { http, ep, key, secret })
    }
    fn host(&self, service: &str, region: &str) -> (String, String) {
        let host = format!("{service}.{region}.amazonaws.com");
        (self.ep.base.clone().unwrap_or_else(|| format!("https://{host}")), host)
    }
    /// An EC2 action (Query API, form-encoded, XML back).
    async fn ec2(&self, region: &str, action: &str, params: &[(String, String)]) -> Result<String, String> {
        let (url, host) = self.host("ec2", region);
        let mut body = format!("Action={action}&Version=2016-11-15");
        for (k, v) in params {
            body.push_str(&format!("&{}={}", enc(k), enc(v)));
        }
        let date = amz_date();
        let ct = "application/x-www-form-urlencoded; charset=utf-8";
        let auth = sign("POST", &host, "/", "", &[("content-type", ct), ("host", &host), ("x-amz-date", &date)], body.as_bytes(), region, "ec2", &self.key, &self.secret, &date);
        let r = self.http.post(format!("{url}/")).header("content-type", ct).header("x-amz-date", &date).header("authorization", auth).body(body).send().await.map_err(|e| format!("Couldn't reach AWS ({e})"))?;
        if !r.status().is_success() {
            return Err(api_error("AWS", r).await);
        }
        Ok(r.text().await.unwrap_or_default())
    }
    /// The latest Ubuntu 24.04 image in a region (Canonical publishes it in SSM).
    async fn ubuntu(&self, region: &str) -> Result<String, String> {
        let (url, host) = self.host("ssm", region);
        let body = json!({"Name": "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"}).to_string();
        let date = amz_date();
        let ct = "application/x-amz-json-1.1";
        let target = "AmazonSSM.GetParameter";
        let auth = sign("POST", &host, "/", "", &[("content-type", ct), ("host", &host), ("x-amz-date", &date), ("x-amz-target", target)], body.as_bytes(), region, "ssm", &self.key, &self.secret, &date);
        let r = self.http.post(format!("{url}/")).header("content-type", ct).header("x-amz-date", &date).header("x-amz-target", target).header("authorization", auth).body(body).send().await.map_err(|e| format!("Couldn't reach AWS ({e})"))?;
        if !r.status().is_success() {
            return Err(api_error("AWS", r).await);
        }
        let v: Value = r.json().await.map_err(|e| e.to_string())?;
        v["Parameter"]["Value"].as_str().map(String::from).ok_or_else(|| "AWS didn't say which Ubuntu image to use in that region.".into())
    }
    /// A security group that lets SSH in (Minus's key is the only way in).
    async fn ssh_group(&self, region: &str) -> Result<String, String> {
        let p = |k: &str, v: &str| (k.to_string(), v.to_string());
        let found = self.ec2(region, "DescribeSecurityGroups", &[p("Filter.1.Name", "group-name"), p("Filter.1.Value.1", "minus-ssh")]).await?;
        if let Some(id) = xml(&found, "groupId") {
            return Ok(id);
        }
        let made = self.ec2(region, "CreateSecurityGroup", &[p("GroupName", "minus-ssh"), p("GroupDescription", "SSH for Minus cloud computers")]).await?;
        let id = xml(&made, "groupId").ok_or("AWS didn't make the security group.")?;
        self.ec2(region, "AuthorizeSecurityGroupIngress", &[p("GroupId", &id), p("IpPermissions.1.IpProtocol", "tcp"), p("IpPermissions.1.FromPort", "22"), p("IpPermissions.1.ToPort", "22"), p("IpPermissions.1.IpRanges.1.CidrIp", "0.0.0.0/0")]).await?;
        Ok(id)
    }
}

pub async fn regions(http: &reqwest::Client, ep: &Endpoints, creds: &Value) -> Result<Vec<Region>, String> {
    let a = Aws::new(http, ep, creds)?;
    let home = creds["region"].as_str().filter(|r| !r.is_empty()).unwrap_or("us-east-1");
    let x = a.ec2(home, "DescribeRegions", &[]).await?;
    let mut rs: Vec<Region> = xml_all(&x, "regionName").into_iter().map(|r| Region { name: r.clone(), id: r }).collect();
    rs.sort_by(|a, b| (a.id != home).cmp(&(b.id != home)).then(a.id.cmp(&b.id)));
    Ok(rs)
}

pub async fn create(http: &reqwest::Client, ep: &Endpoints, creds: &Value, want: &Want, init: &str) -> Result<Machine, String> {
    let a = Aws::new(http, ep, creds)?;
    let region = want.region.as_str();
    let image = a.ubuntu(region).await?;
    let group = a.ssh_group(region).await?;
    let size = if want.size == "medium" { "t3.medium" } else { "t3.small" };
    let p = |k: &str, v: &str| (k.to_string(), v.to_string());
    let x = a.ec2(region, "RunInstances", &[
        p("ImageId", &image), p("InstanceType", size), p("MinCount", "1"), p("MaxCount", "1"),
        p("UserData", &b64(init.as_bytes())), p("SecurityGroupId.1", &group),
        p("BlockDeviceMapping.1.DeviceName", "/dev/sda1"), p("BlockDeviceMapping.1.Ebs.VolumeSize", "20"), p("BlockDeviceMapping.1.Ebs.VolumeType", "gp3"),
        p("TagSpecification.1.ResourceType", "instance"), p("TagSpecification.1.Tag.1.Key", "Name"), p("TagSpecification.1.Tag.1.Value", &want.name),
        p("TagSpecification.1.Tag.2.Key", "minus"), p("TagSpecification.1.Tag.2.Value", "yes"),
    ]).await?;
    let id = xml(&x, "instanceId").ok_or("AWS didn't start the computer.")?;
    Ok(Machine { id, region: region.into(), size: size.into(), status: "starting".into(), ..Default::default() })
}

pub async fn refresh(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<Machine, String> {
    let a = Aws::new(http, ep, creds)?;
    let mut n = m.clone();
    let x = match a.ec2(&m.region, "DescribeInstances", &[("InstanceId.1".into(), m.id.clone())]).await {
        Err(e) if e.contains("InvalidInstanceID") => { n.status = "gone".into(); return Ok(n); }
        r => r?,
    };
    n.ip = xml(&x, "ipAddress").unwrap_or_default();
    let state = x.find("<instanceState>").map(|i| &x[i..]).and_then(|s| xml(s, "name")).unwrap_or_default();
    n.status = match state.as_str() { "running" => "running", "stopped" => "stopped", "stopping" => "stopping", "terminated" | "shutting-down" => "gone", _ => "starting" }.into();
    Ok(n)
}

pub async fn power(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine, on: bool) -> Result<(), String> {
    Aws::new(http, ep, creds)?.ec2(&m.region, if on { "StartInstances" } else { "StopInstances" }, &[("InstanceId.1".into(), m.id.clone())]).await.map(|_| ())
}

pub async fn delete(http: &reqwest::Client, ep: &Endpoints, creds: &Value, m: &Machine) -> Result<(), String> {
    match Aws::new(http, ep, creds)?.ec2(&m.region, "TerminateInstances", &[("InstanceId.1".into(), m.id.clone())]).await {
        Err(e) if e.contains("InvalidInstanceID") => Ok(()),
        r => r.map(|_| ()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signs_like_aws_says() {
        // AWS's own worked example (IAM ListUsers, 2015-08-30)
        let auth = sign("GET", "iam.amazonaws.com", "/", "Action=ListUsers&Version=2010-05-08",
            &[("content-type", "application/x-www-form-urlencoded; charset=utf-8"), ("host", "iam.amazonaws.com"), ("x-amz-date", "20150830T123600Z")],
            b"", "us-east-1", "iam", "AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830T123600Z");
        assert_eq!(auth, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
    }
    #[test]
    fn reads_ec2_answers() {
        let x = "<RunInstancesResponse><instancesSet><item><instanceId>i-0abc</instanceId><instanceState><code>0</code><name>pending</name></instanceState></item></instancesSet></RunInstancesResponse>";
        assert_eq!(xml(x, "instanceId").as_deref(), Some("i-0abc"));
        assert_eq!(xml_all("<regionName>a</regionName><regionName>b</regionName>", "regionName"), ["a", "b"]);
        assert_eq!(amz_date().len(), 16);
    }
}
