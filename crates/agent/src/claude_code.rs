//! Claude Code on this PC: the agent's work goes through Anthropic's own `claude` program,
//! signed in with the person's own Claude plan. Minus never sees or keeps that sign-in; it
//! runs the program the person installed, like they would in a terminal.
//!
//! Each agent gets its own folder to work in. Claude Code's own tools do the work there:
//! reading files, searching the web, writing in its folder. Running commands or touching
//! files elsewhere stays off.

use crate::{AgentError, Event};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

type Emit = Arc<dyn Fn(Event) + Send + Sync>;

/// What Claude Code may use without asking: look, read and search, and write in its folder.
const ALLOWED: &str = "Read Glob Grep WebSearch WebFetch Edit Write TodoWrite";
const BLOCKED: &str = "Bash KillShell";

/// Where `claude` is: on PATH, or where its installers put it.
pub fn find() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd", "claude"] } else { &["claude"] };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(h) = home() {
        dirs.push(h.join(".local").join("bin"));
        dirs.push(h.join(".claude").join("local"));
        dirs.push(h.join(".npm-global").join("bin"));
        if cfg!(windows) {
            if let Some(a) = std::env::var_os("APPDATA") {
                dirs.push(PathBuf::from(a).join("npm"));
            }
        }
    }
    if cfg!(target_os = "macos") {
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/usr/local/bin".into());
    }
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}
fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Is it installed, and signed in? (`claude auth status` where it exists; else just installed)
pub async fn status() -> Value {
    let Some(bin) = find() else { return json!({"installed": false, "signed_in": false}) };
    let mut cmd = command(&bin);
    cmd.args(["auth", "status"]);
    let out = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await;
    let (signed, who) = match out {
        Ok(Ok(o)) => {
            let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            let low = text.to_lowercase();
            let v: Value = serde_json::from_slice(&o.stdout).unwrap_or(Value::Null);
            let signed = v["loggedIn"].as_bool().or(v["logged_in"].as_bool()).unwrap_or(o.status.success() && !low.contains("not logged in") && !low.contains("not signed in"));
            (signed, v["email"].as_str().or(v["account"]["email"].as_str()).map(str::to_string).unwrap_or_default())
        }
        _ => (true, String::new()),
    };
    json!({"installed": true, "signed_in": signed, "who": who, "path": bin.to_string_lossy()})
}

fn command(bin: &Path) -> tokio::process::Command {
    // npm's Windows shims are .cmd files, which need cmd to run
    let mut c = if bin.extension().is_some_and(|e| e == "cmd") {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(bin);
        c
    } else {
        tokio::process::Command::new(bin)
    };
    #[cfg(windows)]
    {
        c.creation_flags(0x0800_0000); // no console window
    }
    c.stdin(std::process::Stdio::null()).kill_on_drop(true);
    c
}

/// Opens Claude Code's own sign-in (in a terminal window, since it's interactive there).
pub fn sign_in() -> Result<(), String> {
    let bin = find().ok_or("Claude Code isn't installed on this PC yet.")?;
    let b = bin.to_string_lossy().to_string();
    #[cfg(windows)]
    let r = std::process::Command::new("cmd").args(["/C", "start", "Claude Code sign-in", "cmd", "/K", &b, "auth", "login"]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("osascript").args(["-e", &format!("tell application \"Terminal\" to do script \"'{}' auth login\"", b.replace('\'', "'\\''"))]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"].iter().find_map(|t| std::process::Command::new(t).args(["-e", &format!("{b} auth login")]).spawn().ok()).ok_or(std::io::Error::other("no terminal"));
    r.map(|_| ()).map_err(|_| format!("Couldn't open a terminal. Run `{b} auth login` yourself, then come back."))
}

/// One job: the person's message in, Claude Code's work out as Minus events. Returns the
/// session to continue next time, and the final words.
pub async fn job(dir: &Path, model: &str, system: &str, text: &str, session: Option<&str>, emit: &Emit, stop: &Arc<AtomicBool>) -> Result<(String, String), AgentError> {
    let bin = find().ok_or_else(|| AgentError::Api("Claude Code isn't installed on this PC. Install it from claude.com/claude-code, sign in, and try again.".into()))?;
    let _ = std::fs::create_dir_all(dir);
    let mut cmd = command(&bin);
    cmd.current_dir(dir)
        .args(["-p", text, "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
        .args(["--append-system-prompt", system])
        .args(["--allowedTools", ALLOWED, "--disallowedTools", BLOCKED, "--permission-mode", "acceptEdits"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if !model.is_empty() && model != "default" {
        cmd.args(["--model", model]);
    }
    if let Some(s) = session.filter(|s| !s.is_empty()) {
        cmd.args(["--resume", s]);
    }
    let mut child = cmd.spawn().map_err(|e| AgentError::Api(format!("Couldn't start Claude Code ({e}).")))?;
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut err = child.stderr.take().unwrap();
    let mut sid = session.unwrap_or("").to_string();
    let mut draft = String::new();
    let mut last = String::new();
    let mut result: Option<(bool, String)> = None;
    loop {
        if stop.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            return Err(AgentError::Stopped);
        }
        let line = match tokio::time::timeout(std::time::Duration::from_millis(400), lines.next_line()).await {
            Err(_) => continue,
            Ok(Ok(Some(l))) => l,
            Ok(_) => break,
        };
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(s) = v["session_id"].as_str() {
            sid = s.to_string();
        }
        match v["type"].as_str().unwrap_or("") {
            "stream_event" => {
                let e = &v["event"];
                if e["type"] == "message_start" {
                    draft.clear();
                }
                if let Some(t) = e["delta"]["text"].as_str() {
                    draft.push_str(t);
                    emit(Event::Draft { text: draft.clone() });
                }
            }
            "assistant" => {
                for c in v["message"]["content"].as_array().cloned().unwrap_or_default() {
                    match c["type"].as_str() {
                        Some("text") => {
                            let t = c["text"].as_str().unwrap_or("").trim().to_string();
                            if !t.is_empty() {
                                last = t;
                            }
                        }
                        Some("tool_use") => {
                            if !last.is_empty() {
                                emit(Event::Note { text: std::mem::take(&mut last) });
                            }
                            emit(Event::Step { text: step(c["name"].as_str().unwrap_or(""), &c["input"]) });
                        }
                        _ => {}
                    }
                }
            }
            "result" => {
                if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
                    emit(Event::Usage { input: u["input_tokens"].as_u64().unwrap_or(0), output: u["output_tokens"].as_u64().unwrap_or(0), cache_read: u["cache_read_input_tokens"].as_u64().unwrap_or(0) });
                }
                let bad = v["is_error"].as_bool().unwrap_or(false) || v["subtype"].as_str().is_some_and(|s| s != "success");
                result = Some((bad, v["result"].as_str().unwrap_or("").to_string()));
            }
            _ => {}
        }
    }
    let _ = child.wait().await;
    let mut stderr = String::new();
    let _ = tokio::io::AsyncReadExt::read_to_string(&mut err, &mut stderr).await;
    match result {
        Some((false, words)) => Ok((sid, if words.trim().is_empty() { last } else { words })),
        Some((true, words)) => Err(AgentError::Api(explain(&format!("{words} {stderr}")))),
        None => Err(AgentError::Api(explain(&stderr))),
    }
}

fn explain(raw: &str) -> String {
    let low = raw.to_lowercase();
    let raw = raw.trim();
    if low.contains("login") || low.contains("log in") || low.contains("auth") || low.contains("401") {
        "Claude Code on this PC isn't signed in. Sign in in Settings → Your AI → Claude Code, then try again.".into()
    } else if low.contains("limit") || low.contains("usage") || low.contains("429") {
        format!("Your Claude plan's limit is used up for now. It refills by itself, or give this agent another AI meanwhile. ({})", raw.chars().take(200).collect::<String>())
    } else if raw.is_empty() {
        "Claude Code stopped without saying why. Try again.".into()
    } else {
        format!("Claude Code: {}", raw.chars().take(300).collect::<String>())
    }
}

/// A tool call in plain words, for the work line.
fn step(name: &str, i: &Value) -> String {
    let s = |k: &str| i[k].as_str().unwrap_or("").to_string();
    let file = |k: &str| s(k).rsplit(['/', '\\']).next().unwrap_or("").to_string();
    match name {
        "WebSearch" => format!("Search the web for “{}”", s("query")),
        "WebFetch" => format!("Read {}", s("url").trim_start_matches("https://").trim_start_matches("http://")),
        "Read" => format!("Read {}", file("file_path")),
        "Write" => format!("Write {}", file("file_path")),
        "Edit" | "MultiEdit" => format!("Edit {}", file("file_path")),
        "Glob" => format!("Look for files: {}", s("pattern")),
        "Grep" => format!("Search files for “{}”", s("pattern")),
        "TodoWrite" => "Plan the steps".into(),
        "Task" | "Agent" => format!("Hand a part to a helper: {}", s("description")),
        n => format!("Use {n}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steps_read_well() {
        assert_eq!(step("WebSearch", &json!({"query": "coffee"})), "Search the web for “coffee”");
        assert_eq!(step("Read", &json!({"file_path": "/a/b/notes.md"})), "Read notes.md");
        assert!(explain("Invalid API key · Please run /login").contains("isn't signed in"));
    }
}
