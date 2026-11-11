//! The large local voice: Orpheus 3B, the most expressive open voice (it laughs, sighs,
//! whispers), on this computer. Orpheus is a language model that writes sound: llama.cpp runs
//! it (on the graphics card when there is one), and its "sound codes" go to the app, where
//! SNAC turns them into sound.
//!
//! Everything is downloaded once, on request: llama.cpp's server (about 30 MB) from its GitHub
//! releases and the model (2.4 GB) from Hugging Face. Nothing runs until a voice is needed.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

pub const MODEL_URL: &str = "https://huggingface.co/isaiahbjork/orpheus-3b-0.1-ft-Q4_K_M-GGUF/resolve/main/orpheus-3b-0.1-ft-q4_k_m.gguf";
const MODEL_FILE: &str = "orpheus-3b-0.1-ft-q4_k_m.gguf";
/// Used when GitHub won't say which release is the latest (it limits how often you can ask).
const KNOWN_RELEASE: &str = "b9500";

// Orpheus' special tokens
const START_HUMAN: i64 = 128259;
const BOS: i64 = 128000;
const END_TEXT: i64 = 128009;
const END_HUMAN: i64 = 128260;
const START_AI: i64 = 128261;
const START_SPEECH: i64 = 128257;
const END_SPEECH: i64 = 128258;
const AUDIO_BASE: i64 = 128266; // <custom_token_10>, the first sound code

pub fn dir(base: &Path) -> PathBuf {
    base.join("voices").join("orpheus")
}
pub fn model_path(base: &Path) -> PathBuf {
    dir(base).join(MODEL_FILE)
}
fn server_name() -> &'static str {
    if cfg!(windows) { "llama-server.exe" } else { "llama-server" }
}
/// Where llama-server ended up after unpacking (releases nest it differently over time).
pub fn server_path(base: &Path) -> Option<PathBuf> {
    fn find(d: &Path, name: &str, depth: u8) -> Option<PathBuf> {
        let rd = std::fs::read_dir(d).ok()?;
        let mut dirs = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() && p.file_name().is_some_and(|n| n == name) {
                return Some(p);
            }
            if p.is_dir() {
                dirs.push(p);
            }
        }
        if depth == 0 {
            return None;
        }
        dirs.into_iter().find_map(|p| find(&p, name, depth - 1))
    }
    find(&dir(base).join("llama"), server_name(), 3)
}
pub fn installed(base: &Path) -> bool {
    model_path(base).exists() && server_path(base).is_some()
}

/// Which of a release's downloads fits this computer, best first.
pub fn wanted_assets() -> Vec<&'static str> {
    if cfg!(all(windows, target_arch = "aarch64")) {
        vec!["bin-win-cpu-arm64"]
    } else if cfg!(windows) {
        // Vulkan uses any graphics card (and falls back to the processor)
        vec!["bin-win-vulkan-x64", "bin-win-cpu-x64"]
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        vec!["bin-macos-arm64"]
    } else if cfg!(target_os = "macos") {
        vec!["bin-macos-x64"]
    } else if cfg!(target_arch = "aarch64") {
        vec!["bin-ubuntu-arm64"]
    } else {
        vec!["bin-ubuntu-x64", "bin-ubuntu-vulkan-x64"]
    }
}
pub fn pick_asset(names: &[String]) -> Option<String> {
    for want in wanted_assets() {
        if let Some(n) = names.iter().find(|n| n.contains(want) && (n.ends_with(".zip") || n.ends_with(".tar.gz")) && !n.contains("cudart")) {
            return Some(n.clone());
        }
    }
    None
}

/// Downloads `url` to `to` (resuming a download that stopped), telling `progress` (done, total).
pub async fn download(http: &reqwest::Client, url: &str, to: &Path, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<(), String> {
    let part = to.with_extension("part");
    let _ = std::fs::create_dir_all(to.parent().unwrap());
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut req = http.get(url);
    if have > 0 {
        req = req.header("Range", format!("bytes={have}-"));
    }
    let mut r = req.send().await.map_err(|e| format!("Couldn't download it ({e})"))?;
    if !r.status().is_success() {
        return Err(format!("Couldn't download it ({})", r.status()));
    }
    let resumed = r.status().as_u16() == 206;
    let total = r.content_length().unwrap_or(0) + if resumed { have } else { 0 };
    let mut f = std::fs::OpenOptions::new().create(true).append(resumed).write(true).truncate(!resumed).open(&part).map_err(|e| e.to_string())?;
    let mut done = if resumed { have } else { 0 };
    let mut last = std::time::Instant::now();
    use std::io::Write;
    while let Some(chunk) = r.chunk().await.map_err(|e| format!("The download stopped ({e}). Try again: it picks up where it left off."))? {
        f.write_all(&chunk).map_err(|e| format!("Couldn't save it ({e})"))?;
        done += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(200) {
            last = std::time::Instant::now();
            progress(done, total);
        }
    }
    f.flush().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&part, to).map_err(|e| e.to_string())?;
    progress(done, total.max(done));
    Ok(())
}

fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(into);
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    if archive.to_string_lossy().ends_with(".zip") {
        zip::ZipArchive::new(file).and_then(|mut z| z.extract(into)).map_err(|e| format!("Couldn't unpack llama.cpp ({e})"))?;
    } else {
        tar::Archive::new(flate2::read::GzDecoder::new(file)).unpack(into).map_err(|e| format!("Couldn't unpack llama.cpp ({e})"))?;
    }
    #[cfg(unix)]
    for e in walk(into) {
        use std::os::unix::fs::PermissionsExt;
        if e.is_file() {
            let _ = std::fs::set_permissions(&e, std::fs::Permissions::from_mode(0o755));
        }
    }
    Ok(())
}
#[cfg(unix)]
fn walk(d: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(d) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { out.extend(walk(&p)); } else { out.push(p); }
        }
    }
    out
}

/// Gets llama.cpp's server and the model, if they aren't here yet. `progress` hears about the
/// whole thing, model included, as (done, total) bytes.
pub async fn install(http: &reqwest::Client, base: &Path, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<(), String> {
    const SERVER_GUESS: u64 = 40_000_000;
    if server_path(base).is_none() {
        // the latest release, or a known one when GitHub won't tell
        let latest: Option<(String, Vec<String>)> = async {
            let v: Value = http.get("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest").header("User-Agent", "Minus").send().await.ok()?.json().await.ok()?;
            Some((v["tag_name"].as_str()?.to_string(), v["assets"].as_array()?.iter().filter_map(|a| a["name"].as_str().map(String::from)).collect()))
        }.await;
        let (tag, name) = match latest.and_then(|(t, names)| pick_asset(&names).map(|n| (t, n))) {
            Some(x) => x,
            None => {
                let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
                (KNOWN_RELEASE.to_string(), format!("llama-{KNOWN_RELEASE}-{}.{ext}", wanted_assets()[0]))
            }
        };
        let url = format!("https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{name}");
        let archive = dir(base).join(&name);
        download(http, &url, &archive, &|d, _| progress(d, SERVER_GUESS + 2_400_000_000)).await?;
        unpack(&archive, &dir(base).join("llama"))?;
        let _ = std::fs::remove_file(&archive);
        if server_path(base).is_none() {
            return Err("llama.cpp came without its server. Try again later.".into());
        }
    }
    if !model_path(base).exists() {
        download(http, MODEL_URL, &model_path(base), &|d, t| progress(SERVER_GUESS + d, SERVER_GUESS + t.max(1))).await?;
    }
    Ok(())
}

/* ───────── running it ───────── */

struct Server {
    child: tokio::process::Child,
    port: u16,
}
static SERVER: Mutex<Option<Server>> = Mutex::new(None);

/// Stops the server (when the app closes, or the voice is removed).
pub fn stop() {
    if let Some(mut s) = SERVER.lock().unwrap().take() {
        let _ = s.child.start_kill();
    }
}
pub fn remove(base: &Path) {
    stop();
    let _ = std::fs::remove_dir_all(dir(base));
}

async fn running(http: &reqwest::Client, base: &Path) -> Result<u16, String> {
    {
        let mut g = SERVER.lock().unwrap();
        if let Some(s) = g.as_mut() {
            if matches!(s.child.try_wait(), Ok(None)) {
                return Ok(s.port);
            }
            *g = None;
        }
    }
    let exe = server_path(base).ok_or("The large voice isn't downloaded yet.")?;
    let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).map_err(|e| e.to_string())?;
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("-m").arg(model_path(base))
        .args(["--host", "127.0.0.1", "--port", &port.to_string(), "-c", "4096", "-ngl", "99", "-np", "1", "--no-webui"])
        .current_dir(exe.parent().unwrap())
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // no console window
    let child = cmd.spawn().map_err(|e| format!("Couldn't start the large voice ({e})"))?;
    *SERVER.lock().unwrap() = Some(Server { child, port });
    // loading 2.4 GB takes a moment
    for _ in 0..240 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Ok(r) = http.get(format!("http://127.0.0.1:{port}/health")).send().await {
            if r.status().is_success() {
                return Ok(port);
            }
        }
        let gone = SERVER.lock().unwrap().as_mut().map(|s| !matches!(s.child.try_wait(), Ok(None))).unwrap_or(true);
        if gone {
            *SERVER.lock().unwrap() = None;
            return Err("The large voice stopped while starting. This computer may not have enough memory for it (it needs about 4 GB free).".into());
        }
    }
    stop();
    Err("The large voice took too long to start.".into())
}

/// What Orpheus is asked: "<voice>: <text>", in its own wrapping.
pub fn prompt(voice: &str, text: &str) -> Value {
    json!([START_HUMAN, BOS, format!("{voice}: {text}"), END_TEXT, END_HUMAN, START_AI, START_SPEECH])
}

/// Orpheus' tokens into SNAC codes (in frames of 7), up to where its speech ends.
pub fn codes(tokens: &[i64]) -> Vec<i64> {
    let mut out = Vec::new();
    for &t in tokens {
        if t == END_SPEECH {
            break;
        }
        if t < AUDIO_BASE {
            continue;
        }
        let c = t - AUDIO_BASE - (out.len() as i64 % 7) * 4096;
        if (0..4096).contains(&c) {
            out.push(c);
        }
    }
    out.truncate(out.len() / 7 * 7);
    out
}
/// The same, from text with "<custom_token_N>" in it (older servers send no token list).
pub fn codes_from_text(text: &str) -> Vec<i64> {
    let toks: Vec<i64> = text.split("<custom_token_").skip(1).filter_map(|s| s.split('>').next()?.parse::<i64>().ok()).map(|n| n + 128256).collect();
    codes(&toks)
}

/// Says `text` (Orpheus tags like <laugh> allowed) in `voice`: SNAC codes, frames of 7.
pub async fn speak(http: &reqwest::Client, base: &Path, voice: &str, text: &str) -> Result<Vec<i64>, String> {
    let port = running(http, base).await?;
    // about 84 codes a second of speech, and people say about 14 characters a second
    let n = ((text.chars().count() as f64 / 14.0 * 84.0 * 1.4) as i64 + 210).min(4000);
    let body = json!({
        "prompt": prompt(voice, text), "n_predict": n, "temperature": 0.6, "top_p": 0.9, "repeat_penalty": 1.1,
        "return_tokens": true, "stream": false, "cache_prompt": false,
    });
    let r = http.post(format!("http://127.0.0.1:{port}/completion")).json(&body).timeout(Duration::from_secs(600)).send().await.map_err(|e| format!("The large voice didn't answer ({e})"))?;
    if !r.status().is_success() {
        return Err(format!("The large voice couldn't say it ({})", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let toks: Vec<i64> = v["tokens"].as_array().map(|a| a.iter().filter_map(|x| x.as_i64()).collect()).unwrap_or_default();
    let c = if toks.is_empty() { codes_from_text(v["content"].as_str().unwrap_or("")) } else { codes(&toks) };
    if c.is_empty() {
        return Err("The large voice made no sound for that. Try again.".into());
    }
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tokens_become_codes() {
        // frame of 7: each position has its own 4096-wide range
        let frame: Vec<i64> = (0..7).map(|i| AUDIO_BASE + i * 4096 + 100 + i).collect();
        let mut toks = vec![START_SPEECH];
        toks.extend(&frame);
        toks.extend(&frame);
        toks.push(AUDIO_BASE + 5); // half a frame: dropped
        toks.push(END_SPEECH);
        toks.extend(&frame); // after the end: ignored
        let c = codes(&toks);
        assert_eq!(c.len(), 14);
        assert_eq!(&c[..7], &[100, 101, 102, 103, 104, 105, 106]);
        assert_eq!(codes_from_text("<custom_token_110><custom_token_4207>"), Vec::<i64>::new()); // under a frame
    }
    #[test]
    fn picks_the_right_download() {
        let names: Vec<String> = ["llama-b9500-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-12.4-x64.zip", "llama-b9500-bin-win-vulkan-x64.zip", "llama-b9500-bin-win-cpu-x64.zip", "llama-b9500-bin-ubuntu-x64.tar.gz", "llama-b9500-bin-macos-arm64.tar.gz"].map(String::from).to_vec();
        let got = pick_asset(&names).unwrap();
        if cfg!(windows) { assert!(got.contains("win-vulkan")); } else if cfg!(target_os = "macos") { assert!(got.contains("macos")); } else { assert_eq!(got, "llama-b9500-bin-ubuntu-x64.tar.gz"); }
    }
}
