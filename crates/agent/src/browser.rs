//! Each agent's own web browser. Minus starts the Chromium-family browser already on the
//! computer (Edge, Chrome, Brave or Chromium) without a window and with its own private profile,
//! so it never touches yours, and gives each agent a tab, driven over the DevTools protocol.
//!
//! Like the browser-use project (github.com/browser-use/browser-use), the agent sees a page as a
//! numbered list of the things it can use (links, buttons, fields) plus the page's text, and acts
//! by number: click 4, type into 7. You can watch any agent's tab live from its chat.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

/// The browser to use: $MINUS_BROWSER, or the first Chromium-family browser installed.
pub fn find() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("MINUS_BROWSER").map(PathBuf::from).filter(|p| p.exists()) {
        return Some(p);
    }
    #[allow(unused_mut)]
    let mut c: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    for base in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"].iter().filter_map(std::env::var_os) {
        for rel in [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe", r"BraveSoftware\Brave-Browser\Application\brave.exe", r"Chromium\Application\chrome.exe"] {
            c.push(PathBuf::from(&base).join(rel));
        }
    }
    #[cfg(target_os = "macos")]
    for app in ["Google Chrome.app/Contents/MacOS/Google Chrome", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Brave Browser.app/Contents/MacOS/Brave Browser", "Chromium.app/Contents/MacOS/Chromium"] {
        c.push(PathBuf::from("/Applications").join(app));
        if let Some(h) = std::env::var_os("HOME") {
            c.push(PathBuf::from(h).join("Applications").join(app));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(path) = std::env::var_os("PATH") {
        for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"] {
            for dir in std::env::split_paths(&path) {
                c.push(dir.join(name));
            }
        }
    }
    c.into_iter().find(|p| p.is_file())
}

/// The running browser and the agents' tabs.
pub struct Browser {
    _child: Option<tokio::process::Child>,
    port: u16,
    http: reqwest::Client,
    tabs: tokio::sync::Mutex<HashMap<String, Arc<Tab>>>,
}

impl Browser {
    pub async fn launch(exe: &Path, profile: &Path) -> Result<Self, String> {
        let _ = std::fs::create_dir_all(profile);
        let marker = profile.join("DevToolsActivePort");
        let _ = std::fs::remove_file(&marker);
        let mut cmd = tokio::process::Command::new(exe);
        cmd.arg("--headless=new")
            .arg("--remote-debugging-port=0")
            .arg(format!("--user-data-dir={}", profile.display()))
            .args(["--no-first-run", "--no-default-browser-check", "--window-size=1280,860", "--hide-scrollbars", "--mute-audio", "--disable-features=Translate,MediaRouter,OptimizationHints", "about:blank"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(all(unix, not(target_os = "macos")))]
        if std::fs::metadata("/proc/self").map(|m| std::os::unix::fs::MetadataExt::uid(&m) == 0).unwrap_or(false) {
            cmd.arg("--no-sandbox"); // Chromium refuses to run as root otherwise
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let child = cmd.spawn().map_err(|e| format!("couldn't start the browser ({}): {e}", exe.display()))?;
        // it writes the port it chose into the profile once it's ready
        let mut port = None;
        for _ in 0..150 {
            if let Some(p) = std::fs::read_to_string(&marker).ok().and_then(|s| s.lines().next().and_then(|l| l.trim().parse::<u16>().ok())) {
                port = Some(p);
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let port = port.ok_or("the browser didn't start in time")?;
        let http = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
        Ok(Self { _child: Some(child), port, http, tabs: Default::default() })
    }

    /// A browser that's already running, reached at this port (a cloud computer's, through
    /// an SSH tunnel).
    pub async fn attach(port: u16) -> Result<Self, String> {
        let http = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
        for _ in 0..40 {
            if http.get(format!("http://127.0.0.1:{port}/json/version")).send().await.is_ok_and(|r| r.status().is_success()) {
                return Ok(Self { _child: None, port, http, tabs: Default::default() });
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("couldn't reach the browser".into())
    }

    /// Still there to talk to?
    pub async fn alive(&self) -> bool {
        self.http.get(format!("http://127.0.0.1:{}/json/version", self.port)).send().await.is_ok_and(|r| r.status().is_success())
    }

    /// This agent's tab (opened the first time it's needed, or again if it was closed).
    pub async fn tab(&self, agent: &str) -> Result<Arc<Tab>, String> {
        let mut tabs = self.tabs.lock().await;
        if let Some(t) = tabs.get(agent).filter(|t| t.alive()) {
            return Ok(t.clone());
        }
        let v: Value = self.http.put(format!("http://127.0.0.1:{}/json/new?about:blank", self.port)).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        let ws = v["webSocketDebuggerUrl"].as_str().ok_or("the browser didn't open a tab")?;
        // the browser names its own port; ours may be a tunnel to it
        let ws = &match ws.strip_prefix("ws://").and_then(|r| r.split_once('/')) {
            Some((_, path)) => format!("ws://127.0.0.1:{}/{path}", self.port),
            None => ws.to_string(),
        };
        let t = Tab::connect(ws).await?;
        tabs.insert(agent.to_string(), t.clone());
        Ok(t)
    }
    pub async fn existing(&self, agent: &str) -> Option<Arc<Tab>> {
        self.tabs.lock().await.get(agent).filter(|t| t.alive()).cloned()
    }
}

/// One tab: commands go out over its DevTools connection, answers come back by id.
pub struct Tab {
    tx: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next: AtomicU64,
    open: Arc<std::sync::atomic::AtomicBool>,
    /// what the numbers meant in the last look ([4] → "Search"), for describing steps
    names: Mutex<HashMap<u64, String>>,
}

impl Tab {
    async fn connect(ws: &str) -> Result<Arc<Self>, String> {
        let (stream, _) = tokio_tungstenite::connect_async(ws).await.map_err(|e| format!("couldn't reach the browser tab: {e}"))?;
        let (mut w, mut r) = stream.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            while let Some(m) = rx.recv().await {
                if w.send(Message::Text(m.into())).await.is_err() {
                    break;
                }
            }
        });
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> = Default::default();
        let open = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let (p2, o2) = (pending.clone(), open.clone());
        tokio::spawn(async move {
            while let Some(Ok(m)) = r.next().await {
                if let Message::Text(t) = m {
                    let s: &str = &t;
                    if let Ok(v) = serde_json::from_str::<Value>(s) {
                        if let Some(id) = v["id"].as_u64() {
                            if let Some(tx) = p2.lock().unwrap().remove(&id) {
                                let _ = tx.send(v);
                            }
                        }
                    }
                }
            }
            o2.store(false, Ordering::SeqCst);
            p2.lock().unwrap().clear();
        });
        Ok(Arc::new(Self { tx, pending, next: AtomicU64::new(1), open, names: Default::default() }))
    }
    fn alive(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.tx.send(json!({"id": id, "method": method, "params": params}).to_string()).map_err(|_| "the browser closed".to_string())?;
        let v = tokio::time::timeout(Duration::from_secs(30), rx).await.map_err(|_| format!("the browser didn't answer ({method})"))?.map_err(|_| "the browser closed".to_string())?;
        if let Some(e) = v.get("error") {
            return Err(e["message"].as_str().unwrap_or("the browser said no").to_string());
        }
        Ok(v["result"].clone())
    }
    async fn eval(&self, js: &str) -> Result<Value, String> {
        let r = self.call("Runtime.evaluate", json!({"expression": js, "returnByValue": true, "awaitPromise": true})).await?;
        if let Some(x) = r.get("exceptionDetails") {
            return Err(x["exception"]["description"].as_str().or(x["text"].as_str()).unwrap_or("the page threw an error").lines().next().unwrap_or("").to_string());
        }
        Ok(r["result"]["value"].clone())
    }
    /// Waits for the page to finish loading (or gives up waiting after a while and carries on).
    async fn settle(&self, max_ms: u64) {
        let t0 = std::time::Instant::now();
        tokio::time::sleep(Duration::from_millis(250)).await;
        while t0.elapsed().as_millis() < max_ms as u128 {
            if self.eval("document.readyState").await.ok().and_then(|v| v.as_str().map(|s| s == "complete")).unwrap_or(false) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }

    pub async fn open(&self, url: &str) -> Result<(), String> {
        let url = url.trim();
        let url = if url.contains("://") || url.starts_with("about:") { url.to_string() } else { format!("https://{url}") };
        let r = self.call("Page.navigate", json!({"url": url})).await?;
        if let Some(e) = r["errorText"].as_str().filter(|e| !e.is_empty()) {
            return Err(format!("couldn't open {url} ({e})"));
        }
        self.settle(15000).await;
        Ok(())
    }

    /// The page as the agent sees it: where it is, the numbered things it can use, and its text.
    pub async fn look(&self) -> Result<(String, String, String), String> {
        let v = self.eval(LOOK_JS).await?;
        let (url, title) = (v["url"].as_str().unwrap_or("").to_string(), v["title"].as_str().unwrap_or("").to_string());
        let mut names = self.names.lock().unwrap();
        names.clear();
        for (i, n) in v["names"].as_array().cloned().unwrap_or_default().iter().enumerate() {
            names.insert(i as u64 + 1, n.as_str().unwrap_or("").to_string());
        }
        let els = v["elements"].as_str().unwrap_or("");
        let text = v["text"].as_str().unwrap_or("");
        let out = format!(
            "Page: {title}\n{url}\nScrolled {} of {} px.\n\nWhat you can use (act on these numbers):\n{}\n\nWhat the page says:\n{}",
            v["scroll"][0], v["scroll"][1],
            if els.is_empty() { "(nothing to click or type into)" } else { els },
            if text.trim().is_empty() { "(no text)" } else { text }
        );
        Ok((out, url, title))
    }
    pub fn name(&self, id: u64) -> String {
        self.names.lock().unwrap().get(&id).filter(|n| !n.is_empty()).map(|n| format!("“{n}”")).unwrap_or(format!("[{id}]"))
    }

    async fn center(&self, id: u64) -> Result<(f64, f64), String> {
        let v = self.eval(&format!("(() => {{ const e = document.querySelector('[data-minus-id=\"{id}\"]'); if (!e) return null; e.scrollIntoView({{block: 'center', inline: 'center'}}); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }})()")).await?;
        match (v[0].as_f64(), v[1].as_f64()) {
            (Some(x), Some(y)) => Ok((x, y)),
            _ => Err(format!("there's no [{id}] on the page any more; look again for the new numbers")),
        }
    }
    pub async fn click(&self, id: u64) -> Result<(), String> {
        let (x, y) = self.center(id).await?;
        for (kind, n) in [("mouseMoved", 0), ("mousePressed", 1), ("mouseReleased", 1)] {
            self.call("Input.dispatchMouseEvent", json!({"type": kind, "x": x, "y": y, "button": if n == 0 { "none" } else { "left" }, "clickCount": n})).await?;
        }
        self.settle(8000).await;
        Ok(())
    }
    pub async fn type_into(&self, id: u64, text: &str, enter: bool) -> Result<(), String> {
        let ok = self.eval(&format!("(() => {{ const e = document.querySelector('[data-minus-id=\"{id}\"]'); if (!e) return false; e.scrollIntoView({{block: 'center'}}); e.focus(); if (e.select) e.select(); else if (e.isContentEditable) document.execCommand('selectAll'); return true; }})()")).await?;
        if ok != json!(true) {
            return Err(format!("there's no [{id}] on the page any more; look again for the new numbers"));
        }
        self.call("Input.insertText", json!({"text": text})).await?;
        if enter {
            self.key("Enter").await?;
        }
        Ok(())
    }
    pub async fn select(&self, id: u64, option: &str) -> Result<(), String> {
        let o = serde_json::to_string(option).unwrap();
        let ok = self.eval(&format!("(() => {{ const e = document.querySelector('[data-minus-id=\"{id}\"]'); if (!e || !e.options) return false; const want = {o}.toLowerCase(); const opt = [...e.options].find(x => x.text.trim().toLowerCase() === want || x.value.toLowerCase() === want) || [...e.options].find(x => x.text.toLowerCase().includes(want)); if (!opt) return false; e.value = opt.value; e.dispatchEvent(new Event('input', {{bubbles: true}})); e.dispatchEvent(new Event('change', {{bubbles: true}})); return true; }})()")).await?;
        if ok != json!(true) {
            return Err(format!("[{id}] isn't a list with “{option}” in it"));
        }
        Ok(())
    }
    pub async fn scroll(&self, dy: f64) -> Result<(), String> {
        self.eval(&format!("window.scrollBy(0, {dy})")).await?;
        tokio::time::sleep(Duration::from_millis(300)).await;
        Ok(())
    }
    pub async fn key(&self, key: &str) -> Result<(), String> {
        let (k, code, vk, text) = match key.to_lowercase().as_str() {
            "enter" | "return" => ("Enter", "Enter", 13, "\r"),
            "tab" => ("Tab", "Tab", 9, ""),
            "escape" | "esc" => ("Escape", "Escape", 27, ""),
            "backspace" => ("Backspace", "Backspace", 8, ""),
            "space" => (" ", "Space", 32, " "),
            "down" | "arrowdown" => ("ArrowDown", "ArrowDown", 40, ""),
            "up" | "arrowup" => ("ArrowUp", "ArrowUp", 38, ""),
            "left" | "arrowleft" => ("ArrowLeft", "ArrowLeft", 37, ""),
            "right" | "arrowright" => ("ArrowRight", "ArrowRight", 39, ""),
            "pagedown" => ("PageDown", "PageDown", 34, ""),
            "pageup" => ("PageUp", "PageUp", 33, ""),
            other => return Err(format!("the browser doesn't know the key “{other}”")),
        };
        let mut down = json!({"type": "keyDown", "key": k, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk});
        if !text.is_empty() {
            down["text"] = json!(text);
        }
        self.call("Input.dispatchKeyEvent", down).await?;
        self.call("Input.dispatchKeyEvent", json!({"type": "keyUp", "key": k, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})).await?;
        if k == "Enter" {
            self.settle(8000).await;
        }
        Ok(())
    }
    pub async fn back(&self) -> Result<(), String> {
        self.eval("history.back()").await?;
        self.settle(8000).await;
        Ok(())
    }
    /// A picture of the tab right now (JPEG, base64), its address and title: for watching live.
    pub async fn frame(&self) -> Result<(String, String, String), String> {
        let shot = self.call("Page.captureScreenshot", json!({"format": "jpeg", "quality": 62})).await?;
        let at = self.eval("[location.href, document.title]").await.unwrap_or(Value::Null);
        Ok((shot["data"].as_str().unwrap_or("").to_string(), at[0].as_str().unwrap_or("").to_string(), at[1].as_str().unwrap_or("").to_string()))
    }
}

/// Numbers everything on the page that can be used, the way browser-use does: links, buttons,
/// fields, lists and anything clickable that's visible, nearest the top first. Links that would
/// open a new tab open in this one instead, so the agent doesn't lose track.
const LOOK_JS: &str = r#"(() => {
  const MAX = 150, vh = innerHeight;
  document.querySelectorAll('a[target]').forEach((a) => a.setAttribute('target', '_self'));
  document.querySelectorAll('[data-minus-id]').forEach((e) => e.removeAttribute('data-minus-id'));
  const q = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [role=combobox], [role=textbox], [role=searchbox], [contenteditable=""], [contenteditable=true], [onclick], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const usable = [...document.querySelectorAll(q)].filter((e) => {
    if (seen.has(e)) return false;
    for (let p = e.parentElement; p; p = p.parentElement) if (seen.has(p) && (p.tagName === 'A' || p.tagName === 'BUTTON')) return false;
    const r = e.getBoundingClientRect(); if (r.width < 3 || r.height < 3) return false;
    const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) return false;
    seen.add(e); return true;
  });
  const far = (r) => r.bottom < -40 || r.top > vh * 2.5;
  const list = usable.map((e) => [e, e.getBoundingClientRect()]).sort((a, b) => (far(a[1]) - far(b[1])) || (a[1].top - b[1].top) || (a[1].left - b[1].left)).slice(0, MAX);
  const lines = [], names = [];
  list.forEach(([e, r], i) => {
    const n = i + 1; e.setAttribute('data-minus-id', n);
    const tag = e.tagName.toLowerCase(), type = (e.type || '').toLowerCase();
    const role = e.getAttribute('role') || ({ a: 'link', select: 'list', textarea: 'text box', summary: 'toggle' })[tag] || (tag === 'input' ? (['checkbox', 'radio', 'submit', 'button', 'search', 'email', 'password', 'number', 'date'].includes(type) ? (type === 'submit' ? 'button' : type) : 'text box') : tag);
    let name = (e.getAttribute('aria-label') || (tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : e.innerText) || e.getAttribute('placeholder') || e.title || e.getAttribute('alt') || e.querySelector?.('img')?.alt || e.name || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name && e.labels?.[0]) name = e.labels[0].innerText.trim().slice(0, 80);
    const value = (tag === 'input' || tag === 'textarea') && type !== 'password' && e.value && !['submit', 'button', 'checkbox', 'radio'].includes(type) ? ` = "${e.value.slice(0, 60)}"` : tag === 'select' && e.selectedOptions?.[0] ? ` = "${e.selectedOptions[0].text.trim().slice(0, 60)}"` : '';
    const state = (e.checked ? ' (checked)' : '') + (e.disabled ? ' (disabled)' : '') + (r.bottom < 0 || r.top > vh ? ' (scroll to see)' : '');
    const href = tag === 'a' && e.href && !e.href.startsWith('javascript') ? ` → ${e.href.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}` : '';
    lines.push(`[${n}] ${role} "${name}"${value}${state}${href}`); names.push(name);
  });
  const text = (document.body?.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  return { url: location.href, title: document.title, elements: lines.join('\n'), names, text, scroll: [Math.round(scrollY), Math.max(0, Math.round(document.documentElement.scrollHeight - vh))] };
})()"#;
