//! API keys for AI providers. They live in this computer's own password store (Windows
//! Credential Manager, macOS Keychain, the Secret Service on Linux) and never go to Minus's
//! servers. Where no password store runs, they go in a file only this user can read.

use std::path::{Path, PathBuf};

const SERVICE: &str = "app.getminus.minus";

fn index(dir: &Path) -> PathBuf {
    dir.join("keys-index.json")
}
fn fallback(dir: &Path) -> PathBuf {
    dir.join("keys.json")
}
fn read_json(p: &Path) -> serde_json::Map<String, serde_json::Value> {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn write_private(p: &Path, v: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let _ = std::fs::create_dir_all(p.parent().unwrap());
    std::fs::write(p, serde_json::to_vec(v).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Which providers have a key (names only, never the keys).
pub fn list(dir: &Path) -> Vec<String> {
    read_json(&index(dir)).keys().cloned().collect()
}

pub fn set(dir: &Path, slot: &str, key: &str) -> Result<(), String> {
    let mut stored = false;
    #[cfg(desktop)]
    if let Ok(e) = keyring::Entry::new(SERVICE, slot) {
        stored = e.set_password(key).is_ok() && e.get_password().map(|k| k == key).unwrap_or(false);
    }
    let mut fb = read_json(&fallback(dir));
    if stored {
        fb.remove(slot);
    } else {
        fb.insert(slot.into(), key.into());
    }
    write_private(&fallback(dir), &fb)?;
    let mut idx = read_json(&index(dir));
    idx.insert(slot.into(), serde_json::Value::Bool(stored));
    write_private(&index(dir), &idx)
}

pub fn get(dir: &Path, slot: &str) -> Option<String> {
    #[cfg(desktop)]
    if let Ok(e) = keyring::Entry::new(SERVICE, slot) {
        if let Ok(k) = e.get_password() {
            return Some(k);
        }
    }
    read_json(&fallback(dir)).get(slot).and_then(|v| v.as_str()).map(String::from)
}

pub fn remove(dir: &Path, slot: &str) {
    #[cfg(desktop)]
    if let Ok(e) = keyring::Entry::new(SERVICE, slot) {
        let _ = e.delete_credential();
    }
    let mut fb = read_json(&fallback(dir));
    fb.remove(slot);
    let _ = write_private(&fallback(dir), &fb);
    let mut idx = read_json(&index(dir));
    idx.remove(slot);
    let _ = write_private(&index(dir), &idx);
}
