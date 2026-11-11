//! Reaching a cloud computer: SSH with Minus's own key. Agents run commands on it, and its
//! browser is reached through a tunnel, so it works like the browser on this computer.

use russh::client::{self, Handle};
use russh::keys::{decode_secret_key, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelMsg;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Minus's key for cloud computers: (private, in OpenSSH form; public, "ssh-ed25519 AAAA… minus").
pub fn new_key() -> Result<(String, String), String> {
    use ring::rand::SecureRandom;
    let mut seed = [0u8; 32];
    ring::rand::SystemRandom::new().fill(&mut seed).map_err(|_| "No randomness for a new key".to_string())?;
    let k = PrivateKey::from(russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&seed));
    let private = k.to_openssh(russh::keys::ssh_key::LineEnding::LF).map_err(|e| e.to_string())?.to_string();
    let mut public = k.public_key().clone();
    public.set_comment("minus");
    Ok((private, public.to_openssh().map_err(|e| e.to_string())?))
}
pub fn public_of(private: &str) -> Result<String, String> {
    let k = decode_secret_key(private, None).map_err(|e| format!("The cloud key is damaged ({e})"))?;
    let mut p = k.public_key().clone();
    p.set_comment("minus");
    p.to_openssh().map_err(|e| e.to_string())
}

/// Trusts the computer the first time (it was just made for you) and holds it to the same key
/// after: someone in between can't pretend to be it.
struct Trust {
    pinned: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}
impl client::Handler for Trust {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fp = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256).to_string(),
            PublicKeyOrCertificate::Certificate(c) => c.public_key().fingerprint(HashAlg::Sha256).to_string(),
        };
        *self.seen.lock().unwrap() = Some(fp.clone());
        Ok(self.pinned.as_deref().is_none_or(|p| p == fp))
    }
}

pub struct Ssh {
    handle: Handle<Trust>,
    /// the computer's key fingerprint (to pin it after the first connection)
    pub host_key: String,
}

pub struct Output {
    pub code: Option<u32>,
    pub out: String,
    pub err: String,
}

impl Ssh {
    pub async fn connect(host: &str, port: u16, user: &str, private: &str, pinned: Option<&str>) -> Result<Ssh, String> {
        let key = decode_secret_key(private, None).map_err(|e| format!("The cloud key is damaged ({e})"))?;
        let config = Arc::new(client::Config { inactivity_timeout: Some(Duration::from_secs(600)), keepalive_interval: Some(Duration::from_secs(30)), ..Default::default() });
        let seen = Arc::new(Mutex::new(None));
        let trust = Trust { pinned: pinned.map(String::from), seen: seen.clone() };
        let mut handle = tokio::time::timeout(Duration::from_secs(20), client::connect(config, (host, port), trust))
            .await
            .map_err(|_| "The cloud computer didn't answer. It may still be starting.".to_string())?
            .map_err(|e| match e {
                russh::Error::UnknownKey => "The cloud computer's identity changed, so Minus didn't connect (someone could be in between). If you rebuilt it, remove it in Computers and make it again.".to_string(),
                e => format!("Couldn't reach the cloud computer ({e})"),
            })?;
        let hash = handle.best_supported_rsa_hash().await.map_err(|e| e.to_string())?.flatten();
        let ok = handle.authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash)).await.map_err(|e| e.to_string())?;
        if !ok.success() {
            return Err("The cloud computer didn't accept Minus's key.".into());
        }
        let host_key = seen.lock().unwrap().clone().unwrap_or_default();
        Ok(Ssh { handle, host_key })
    }

    /// Runs a command (through bash), up to `secs` seconds; output is capped at `cap` bytes each.
    pub async fn run(&self, cmd: &str, secs: u64, cap: usize) -> Result<Output, String> {
        let mut ch = self.handle.channel_open_session().await.map_err(|e| format!("The cloud computer refused a command ({e})"))?;
        ch.exec(true, format!("bash -lc {}", quote(cmd))).await.map_err(|e| e.to_string())?;
        let (mut out, mut err, mut code) = (Vec::new(), Vec::new(), None);
        let read = async {
            while let Some(m) = ch.wait().await {
                match m {
                    ChannelMsg::Data { data } => if out.len() < cap { out.extend_from_slice(&data) },
                    ChannelMsg::ExtendedData { data, .. } => if err.len() < cap { err.extend_from_slice(&data) },
                    // done (something it started in the background may keep the channel open)
                    ChannelMsg::ExitStatus { exit_status } => { code = Some(exit_status); break; }
                    _ => {}
                }
            }
        };
        let timed_out = tokio::time::timeout(Duration::from_secs(secs), read).await.is_err();
        let mut err = String::from_utf8_lossy(&err[..err.len().min(cap)]).to_string();
        if timed_out {
            err.push_str(&format!("\n(stopped waiting after {secs}s; it may still be running)"));
        }
        Ok(Output { code, out: String::from_utf8_lossy(&out[..out.len().min(cap)]).to_string(), err })
    }

    /// A port on this computer that leads to `remote_port` on the cloud computer (its browser).
    pub async fn tunnel(self: &Arc<Self>, remote_port: u16) -> Result<u16, String> {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let port = l.local_addr().map_err(|e| e.to_string())?.port();
        let me = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Ok((mut sock, peer)) = l.accept().await {
                let Some(ssh) = me.upgrade() else { break };
                tokio::spawn(async move {
                    if let Ok(ch) = ssh.handle.channel_open_direct_tcpip("127.0.0.1", remote_port as u32, "127.0.0.1", peer.port() as u32).await {
                        let mut s = ch.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut sock, &mut s).await;
                    }
                });
            }
        });
        Ok(port)
    }

    pub fn closed(&self) -> bool {
        self.handle.is_closed()
    }
}

/// One shell word, single-quoted.
pub fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
