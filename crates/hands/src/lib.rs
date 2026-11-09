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
    /// Press keys: "enter", "ctrl+s", "alt+f4", "tab", "ctrl+shift+t".
    Key { keys: String },
    Focus { id: u32 },
    Toggle { id: u32 },
    Expand { id: u32 },
    Collapse { id: u32 },
    Select { id: u32 },
    /// Scroll an element (or the window) by "pages": positive is down/right.
    Scroll { #[serde(default)] id: Option<u32>, #[serde(default)] dx: f32, #[serde(default)] dy: f32 },
    /// Click a screen point, for apps that don't describe themselves (games, canvases).
    ClickAt { x: i32, y: i32, #[serde(default)] button: MouseButton },
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
        self.inner.screenshot()
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
