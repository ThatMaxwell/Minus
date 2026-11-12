//! Minus Hands: lets an agent see and use any app on a computer.
//!
//! Agents don't guess from pixels. Hands reads the operating system's accessibility tree
//! (Windows UI Automation first; macOS and Linux next), which lists every element on screen
//! with its role, name, value, state and position. The agent gets a compact outline:
//!
//! ```text
//! window "Untitled - Notepad" app=notepad.exe
//!   [3] menubar
//!     [4] menuitem "File"
//!   [9] edit "Text editor" value=""
//!   [12] button "Save" disabled
//! ```
//!
//! and acts on elements by id, in batches (`click [12]`, `type [9] "hello"`). Where an app
//! exposes the right pattern, Hands invokes the element directly, without moving the mouse,
//! so an agent can work while you keep using the computer.

pub mod outline;
mod platform;
pub mod teach;

pub use teach::{best_match, fill_in, inputs_of, parameterize, ElementRef, TaughtStep};

use serde::{Deserialize, Serialize};
use std::time::Duration;

pub use outline::{diff, line, render, render_diff, Change};

/// Screen rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
impl Rect {
    pub fn center(&self) -> (i32, i32) {
        (self.x + self.w / 2, self.y + self.h / 2)
    }
    pub fn is_empty(&self) -> bool {
        self.w <= 0 || self.h <= 0
    }
}

/// One thing on screen: a button, a text box, a list item, a link...
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Element {
    /// Small number the agent uses to refer to it. Valid until the next snapshot.
    pub id: u32,
    /// Normalized role: button, edit, link, checkbox, menuitem, listitem, tab, window, ...
    pub role: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub bounds: Rect,
    pub enabled: bool,
    pub focused: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    /// What can be done to it without the mouse (invoke, set_value, toggle, expand, select, scroll).
    pub can: Vec<String>,
    /// Stable-ish key for diffing between snapshots (role + name + path), not shown to agents.
    #[serde(skip)]
    pub key: String,
    pub depth: u16,
    pub children: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowInfo {
    pub handle: u64,
    pub title: String,
    pub app: String,
    pub pid: u32,
    pub bounds: Rect,
    pub focused: bool,
    pub minimized: bool,
}

/// Everything visible in one window, in reading order (parents before children).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub window: WindowInfo,
    pub elements: Vec<Element>,
    /// How long it took to read, so we can keep an eye on speed.
    pub took_ms: u64,
    /// True when the tree was cut off at `max_elements`.
    pub truncated: bool,
}

/// Which window to look at.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "by", content = "value", rename_all = "snake_case")]
pub enum Target {
    Focused,
    Handle(u64),
    /// First window whose title contains this text (case-insensitive).
    Title(String),
    /// First window of a process, e.g. "notepad.exe".
    App(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotOptions {
    pub max_elements: usize,
    pub max_depth: u16,
    /// Skip elements with no name, no value and no actions whose children carry the meaning.
    pub prune: bool,
}
impl Default for SnapshotOptions {
    fn default() -> Self {
        Self { max_elements: 1500, max_depth: 40, prune: true }
    }
}

/// Things an agent can do. A batch of these runs in one go, in order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum Action {
    /// Click an element. Uses the element's own action when it has one (no mouse), else a real click.
    Click { id: u32, #[serde(default)] button: MouseButton, #[serde(default)] double: bool },
    /// Put text into a field: replaces what's there (no mouse when the field allows it).
    Fill { id: u32, text: String },
    /// Type at the keyboard focus, like a person would.
    Type { text: String },
    /// Press keys: "enter", "ctrl+s", "alt+f4", "tab", "ctrl+shift+t". `repeat` presses it again.
    Key { keys: String, #[serde(default = "one")] repeat: u32 },
    /// Hold keys down for a while (games, push-to-talk).
    HoldKey { keys: String, secs: f32 },
    Focus { id: u32 },
    Toggle { id: u32 },
    Expand { id: u32 },
    Collapse { id: u32 },
    Select { id: u32 },
    /// Scroll an element (or the window) by "pages": positive is down/right.
    Scroll { #[serde(default)] id: Option<u32>, #[serde(default)] dx: f32, #[serde(default)] dy: f32 },
    /// Click a screen point, for apps that don't describe themselves (games, canvases).
    /// `count`: 2 = double, 3 = triple. `mods`: held keys like "ctrl" or "ctrl+shift".
    ClickAt { x: i32, y: i32, #[serde(default)] button: MouseButton, #[serde(default = "one_u8")] count: u8, #[serde(default)] mods: String },
    MoveTo { x: i32, y: i32 },
    Drag { from: [i32; 2], to: [i32; 2], #[serde(default)] mods: String },
    MouseDown,
    MouseUp,
    /// Mouse wheel at a point (or wherever the pointer is): direction up/down/left/right, in notches.
    ScrollAt { #[serde(default)] at: Option<[i32; 2]>, direction: String, amount: u32, #[serde(default)] mods: String },
    /// Where the pointer is, in screen pixels (reported in the result's `info`).
    CursorPos,
    /// Start an app or open a file or URL.
    Launch { target: String },
    /// Bring a window to the front.
    Activate { target: Target },
    Wait { ms: u64 },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    #[default]
    Left,
    Right,
    Middle,
}

/// What happened for one action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActResult {
    pub ok: bool,
    /// How it was done: "invoke", "value", "toggle", "mouse", "keyboard", ...
    pub how: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Extra output, e.g. the pointer position for CursorPos.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<String>,
}

fn one() -> u32 {
    1
}
fn one_u8() -> u8 {
    1
}

/// A screenshot sized for an AI model: `scale` = screenshot pixels per screen pixel, and
/// (`origin_x`, `origin_y`) is the screen point at the screenshot's top-left corner.
#[derive(Debug, Clone)]
pub struct Shot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub origin_x: i32,
    pub origin_y: i32,
}
impl Shot {
    /// Screenshot coordinates -> screen coordinates.
    pub fn to_screen(&self, x: f64, y: f64) -> (i32, i32) {
        (self.origin_x + (x / self.scale).round() as i32, self.origin_y + (y / self.scale).round() as i32)
    }
}

/// Keeps element numbers the same between looks: an element that's still there keeps its
/// number, so an agent's "[12]" never silently points at something else after a change.
#[derive(Default)]
pub(crate) struct IdMap {
    by_key: std::collections::HashMap<String, u32>,
    next: u32,
}
impl IdMap {
    /// Renumbers `elements` (keys must be set) and returns the old index -> new id map.
    #[cfg_attr(not(any(windows, test)), allow(dead_code))]
    pub fn stabilize(&mut self, window: u64, elements: &mut [Element]) -> Vec<u32> {
        if self.next == 0 {
            self.next = 1;
        }
        // forget very old keys now and then so the map can't grow forever
        if self.by_key.len() > 50_000 {
            self.by_key.clear();
        }
        let mut old_to_new = Vec::with_capacity(elements.len());
        let mut used = std::collections::HashSet::new();
        for e in elements.iter() {
            let k = format!("{window}{}", e.key);
            let id = match self.by_key.get(&k) {
                Some(id) if !used.contains(id) => *id,
                _ => {
                    let id = self.next;
                    self.next += 1;
                    self.by_key.insert(k, id);
                    id
                }
            };
            used.insert(id);
            old_to_new.push(id);
        }
        let map: std::collections::HashMap<u32, u32> = elements.iter().zip(&old_to_new).map(|(e, n)| (e.id, *n)).collect();
        for e in elements.iter_mut() {
            e.id = map[&e.id];
            for c in e.children.iter_mut() {
                *c = map.get(c).copied().unwrap_or(*c);
            }
        }
        old_to_new
    }
}

#[derive(Debug, thiserror::Error)]
pub enum HandsError {
    #[error("this computer's accessibility isn't supported yet ({0})")]
    Unsupported(&'static str),
    #[error("no window matches {0}")]
    NoWindow(String),
    #[error("element [{0}] isn't in the last snapshot; take a new one")]
    NoElement(u32),
    #[error("{0}")]
    Os(String),
}
pub type Result<T> = std::result::Result<T, HandsError>;

/// The handle agents use. Cheap to clone; all OS calls happen on one worker thread.
#[derive(Clone)]
pub struct Hands {
    inner: platform::Worker,
}

impl Hands {
    /// Starts the worker for this computer's accessibility API.
    pub fn new() -> Result<Self> {
        Ok(Self { inner: platform::Worker::start()? })
    }
    pub fn windows(&self) -> Result<Vec<WindowInfo>> {
        self.inner.windows()
    }
    pub fn snapshot(&self, target: Target, opts: SnapshotOptions) -> Result<Snapshot> {
        self.inner.snapshot(target, opts)
    }
    /// Runs a batch. Stops at the first failure unless `keep_going`.
    pub fn act(&self, actions: Vec<Action>, keep_going: bool) -> Result<Vec<ActResult>> {
        self.inner.act(actions, keep_going)
    }
    /// The whole screen as PNG bytes, for the times the outline isn't enough.
    pub fn screenshot(&self) -> Result<Vec<u8>> {
        Ok(self.inner.screenshot(u32::MAX)?.png)
    }
    /// A screenshot no bigger than `max_edge` pixels on its long side (models have limits),
    /// with what's needed to map its coordinates back to the screen.
    pub fn screenshot_for_model(&self, max_edge: u32) -> Result<Shot> {
        self.inner.screenshot(max_edge)
    }
    /// Just one part of the screen (a window's bounds, in screen pixels), no bigger than
    /// `max_edge` on its long side.
    pub fn screenshot_of(&self, area: Rect, max_edge: u32) -> Result<Shot> {
        let full = self.inner.screenshot(u32::MAX)?;
        crop(&full, area, max_edge)
    }
}

/// "Show me once": records what you do, by meaning, until stopped. One at a time.
pub struct Teacher {
    #[cfg(windows)]
    rec: std::sync::Mutex<Option<platform::Recording>>,
}
impl Default for Teacher {
    fn default() -> Self {
        Self {
            #[cfg(windows)]
            rec: std::sync::Mutex::new(None),
        }
    }
}
impl Teacher {
    pub fn start(&self) -> Result<()> {
        #[cfg(windows)]
        {
            let mut g = self.rec.lock().unwrap();
            if let Some(old) = g.take() {
                old.stop();
            }
            *g = Some(platform::Recording::start()?);
            return Ok(());
        }
        #[allow(unreachable_code)]
        Err(HandsError::Unsupported(std::env::consts::OS))
    }
    /// What's been recorded so far (for the live list).
    pub fn steps(&self) -> Vec<TaughtStep> {
        #[cfg(windows)]
        if let Some(r) = self.rec.lock().unwrap().as_ref() {
            return r.steps();
        }
        Vec::new()
    }
    pub fn stop(&self) -> Vec<TaughtStep> {
        #[cfg(windows)]
        if let Some(r) = self.rec.lock().unwrap().take() {
            return r.stop();
        }
        Vec::new()
    }
}

/// Parses "ctrl+shift+t" into modifier + key names, lowercased.
pub fn parse_keys(keys: &str) -> Vec<Vec<String>> {
    keys.split_whitespace()
        .map(|chord| chord.split('+').map(|k| k.trim().to_lowercase()).filter(|k| !k.is_empty()).collect())
        .filter(|c: &Vec<String>| !c.is_empty())
        .collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_parse() {
        assert_eq!(parse_keys("ctrl+S"), vec![vec!["ctrl".to_string(), "s".to_string()]]);
        assert_eq!(parse_keys("tab tab enter").len(), 3);
    }
    #[test]
    fn actions_json() {
        let a: Vec<Action> = serde_json::from_str(r#"[{"do":"click","id":4},{"do":"fill","id":9,"text":"hi"},{"do":"key","keys":"ctrl+s"}]"#).unwrap();
        assert!(matches!(a[0], Action::Click { id: 4, button: MouseButton::Left, double: false }));
        assert!(matches!(&a[1], Action::Fill { id: 9, text } if text == "hi"));
    }
}

/// Shrinks an RGBA image so its long side is at most `max_edge` (area averaging, so text
/// stays readable), then encodes it as PNG. Returns (png, width, height, scale).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn encode_scaled(px: &[u8], w: u32, h: u32, max_edge: u32) -> Result<(Vec<u8>, u32, u32, f64)> {
    let long = w.max(h).max(1);
    let scale = if long > max_edge { max_edge as f64 / long as f64 } else { 1.0 };
    let (nw, nh) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
    let data: std::borrow::Cow<[u8]> = if scale < 1.0 {
        let mut out = vec![0u8; (nw * nh * 4) as usize];
        let (fx, fy) = (w as f64 / nw as f64, h as f64 / nh as f64);
        for y in 0..nh {
            let (y0, y1) = ((y as f64 * fy) as u32, (((y + 1) as f64 * fy).ceil() as u32).min(h));
            for x in 0..nw {
                let (x0, x1) = ((x as f64 * fx) as u32, (((x + 1) as f64 * fx).ceil() as u32).min(w));
                let mut acc = [0u32; 4];
                let mut n = 0u32;
                for sy in y0..y1.max(y0 + 1) {
                    for sx in x0..x1.max(x0 + 1) {
                        let i = ((sy * w + sx) * 4) as usize;
                        for c in 0..4 {
                            acc[c] += px[i + c] as u32;
                        }
                        n += 1;
                    }
                }
                let o = ((y * nw + x) * 4) as usize;
                for c in 0..4 {
                    out[o + c] = (acc[c] / n.max(1)) as u8;
                }
            }
        }
        std::borrow::Cow::Owned(out)
    } else {
        std::borrow::Cow::Borrowed(px)
    };
    let mut png = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut png, nw, nh);
        enc.set_color(png::ColorType::Rgba);
        enc.set_compression(png::Compression::Fast);
        let mut wr = enc.write_header().map_err(|e| HandsError::Os(e.to_string()))?;
        wr.write_image_data(&data).map_err(|e| HandsError::Os(e.to_string()))?;
    }
    Ok((png, nw, nh, scale))
}

/// Cuts `area` (screen pixels) out of a full-size shot and shrinks it to `max_edge`.
pub(crate) fn crop(full: &Shot, area: Rect, max_edge: u32) -> Result<Shot> {
    let dec = png::Decoder::new(std::io::Cursor::new(&full.png));
    let mut r = dec.read_info().map_err(|e| HandsError::Os(e.to_string()))?;
    let mut buf = vec![0u8; r.output_buffer_size().unwrap_or(0)];
    let info = r.next_frame(&mut buf).map_err(|e| HandsError::Os(e.to_string()))?;
    let ch = match info.color_type { png::ColorType::Rgba => 4, png::ColorType::Rgb => 3, _ => return Err(HandsError::Os("unexpected screenshot format".into())) };
    let (fw, fh) = (info.width as i32, info.height as i32);
    // screen pixels -> picture pixels
    let k = 1.0 / full.scale.max(1e-6);
    let x0 = (((area.x - full.origin_x) as f64) / k).round().clamp(0.0, fw as f64) as i32;
    let y0 = (((area.y - full.origin_y) as f64) / k).round().clamp(0.0, fh as f64) as i32;
    let x1 = (((area.x + area.w - full.origin_x) as f64) / k).round().clamp(0.0, fw as f64) as i32;
    let y1 = (((area.y + area.h - full.origin_y) as f64) / k).round().clamp(0.0, fh as f64) as i32;
    let (w, h) = ((x1 - x0).max(1) as u32, (y1 - y0).max(1) as u32);
    if x1 <= x0 || y1 <= y0 {
        return Err(HandsError::Os("that window isn't on the screen (it may be minimized)".into()));
    }
    let mut px = Vec::with_capacity((w * h * 4) as usize);
    for y in y0..y1 {
        for x in x0..x1 {
            let i = ((y * fw + x) as usize) * ch;
            px.extend_from_slice(&buf[i..i + 3]);
            px.push(if ch == 4 { buf[i + 3] } else { 255 });
        }
    }
    let (png, nw, nh, scale) = encode_scaled(&px, w, h, max_edge)?;
    Ok(Shot { png, width: nw, height: nh, scale: scale * full.scale, origin_x: area.x.max(full.origin_x), origin_y: area.y.max(full.origin_y) })
}

#[cfg(test)]
mod more_tests {
    #[test]
    fn crops_a_window() {
        let px: Vec<u8> = (0..(40 * 20)).flat_map(|i| [(i % 40) as u8, (i / 40) as u8, 0, 255]).collect();
        let (png, w, h, _) = super::encode_scaled(&px, 40, 20, 100).unwrap();
        let full = super::Shot { png, width: w, height: h, scale: 1.0, origin_x: 0, origin_y: 0 };
        let c = super::crop(&full, super::Rect { x: 10, y: 5, w: 20, h: 10 }, 100).unwrap();
        assert_eq!((c.width, c.height, c.origin_x, c.origin_y), (20, 10, 10, 5));
    }
    use super::*;
    fn el(id: u32, key: &str) -> Element {
        Element { id, role: "button".into(), name: key.into(), value: None, bounds: Rect::default(), enabled: true, focused: false, checked: None, expanded: None, selected: None, can: vec![], key: key.into(), depth: 0, children: vec![] }
    }
    #[test]
    fn ids_survive_changes() {
        let mut m = IdMap::default();
        let mut a = vec![el(1, "/a"), el(2, "/b"), el(3, "/c")];
        m.stabilize(7, &mut a);
        let b_id = a[1].id;
        // a dialog appears in front: everything after it would shift without the map
        let mut b = vec![el(1, "/dialog"), el(2, "/a"), el(3, "/b"), el(4, "/c")];
        m.stabilize(7, &mut b);
        assert_eq!(b[2].id, b_id);
        assert_ne!(b[0].id, b_id);
    }
    #[test]
    fn shrinks_screenshots() {
        let px = vec![200u8; 4000 * 2000 * 4];
        let (_, w, h, s) = encode_scaled(&px, 4000, 2000, 1600).unwrap();
        assert_eq!((w, h), (1600, 800));
        assert!((s - 0.4).abs() < 1e-9);
    }
}
