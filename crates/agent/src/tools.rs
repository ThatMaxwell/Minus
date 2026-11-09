//! What an agent can do on its computer, and how each tool runs on Minus Hands.

use crate::Event;
use hands::{render, render_diff, Action, Hands, MouseButton, Shot, Snapshot, SnapshotOptions, Target};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Pause before each action so the ghost cursor can be followed (milliseconds).
pub static PACE_MS: AtomicU64 = AtomicU64::new(140);

/// Our own tools, as JSON Schema. Declared once at the start of a conversation and never
/// changed, so the prompt cache and the model's earlier reasoning stay valid.
pub fn custom_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "look",
            "description": "Read a window as an outline of its elements: buttons, fields, links, lists, with their [number], name, value and state. Call it before acting in a window you haven't seen yet, and when you're unsure what's on screen. Without `window` it reads the window in front.",
            "input_schema": {"type": "object", "properties": {
                "window": {"type": "string", "description": "Part of the window title, or the app's file name like \"notepad.exe\". Leave out for the window in front."}
            }}
        }),
        json!({
            "name": "windows",
            "description": "List the open windows (title and app). Use it to find the window you need.",
            "input_schema": {"type": "object", "properties": {}}
        }),
        json!({
            "name": "act",
            "description": "Do several things in one go, in order, using element numbers from your latest look. Returns what changed on screen afterwards, so you usually don't need to look again. Batch everything you can (fill a whole form, then click Save) - one call is much faster than many. Element actions work without moving the person's mouse.\n\nActions (`do`):\n- click {id} / double_click {id} / right_click {id}\n- fill {id, text}: replace a field's text\n- type {text}: type at the keyboard focus (\\n for Enter)\n- key {keys}: e.g. \"enter\", \"ctrl+s\", \"alt+f4\", \"tab tab enter\"\n- focus / toggle / expand / collapse / select {id}\n- scroll {id?, dy}: dy in pages, positive scrolls down\n- launch {text}: start an app, or open a file or URL\n- activate {text}: bring the window whose title contains text to the front\n- wait {ms}",
            "input_schema": {"type": "object", "properties": {
                "window": {"type": "string", "description": "The window to act in (title text or app file name). Leave out for the window you last looked at."},
                "actions": {"type": "array", "items": {"type": "object", "properties": {
                    "do": {"type": "string", "enum": ["click", "double_click", "right_click", "fill", "type", "key", "focus", "toggle", "expand", "collapse", "select", "scroll", "launch", "activate", "wait"]},
                    "id": {"type": "integer"},
                    "text": {"type": "string"},
                    "keys": {"type": "string"},
                    "dy": {"type": "number"},
                    "ms": {"type": "integer"}
                }, "required": ["do"]}}
            }, "required": ["actions"]}
        }),
        json!({
            "name": "ask_user",
            "description": "Ask the person something only they know or decide (a missing detail, a preference), and wait for the answer. Give `options` when there are a few clear choices. Don't ask for things you can find or decide yourself.",
            "input_schema": {"type": "object", "properties": {
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}, "description": "2 to 4 short choices, if it's a choice"},
                "placeholder": {"type": "string", "description": "An example answer, shown in the text box"}
            }, "required": ["question"]}
        }),
        json!({
            "name": "request_approval",
            "description": "Ask the person's OK before anything that can't be undone or that others will see: sending an email or message, posting, buying or paying, deleting, installing software, or anything your permissions say needs asking. Wait for the answer; if it's declined, don't do it.",
            "input_schema": {"type": "object", "properties": {
                "action": {"type": "string", "description": "What you're about to do, short, e.g. \"Send 36 welcome emails\""},
                "details": {"type": "string", "description": "Who or what it affects, e.g. \"To the webinar leads, from your Gmail\""}
            }, "required": ["action"]}
        }),
        json!({
            "name": "remember",
            "description": "Write something in your notebook so you know it in future jobs: a preference the person told you, how their apps or accounts are set up, a shortcut that worked. One clear fact per note. The person can read and edit your notebook.",
            "input_schema": {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]}
        }),
        json!({
            "name": "use_skill",
            "description": "Run a skill the person taught you by doing the job once while you watched (\"Show me once\"). The job text lists your skills. A skill is much faster and more reliable than doing the same steps yourself, so use one whenever it fits. Give a value for every input it lists. If a step can't be done, the steps before it are done and you get the screen as it is; finish the rest yourself.",
            "input_schema": {"type": "object", "properties": {
                "skill": {"type": "string", "description": "The skill's name, as listed"},
                "inputs": {"type": "object", "additionalProperties": {"type": "string"}, "description": "A value for each of the skill's inputs, e.g. {\"name\": \"Dana Okafor\"}"}
            }, "required": ["skill"]}
        }),
        json!({
            "name": "message_user",
            "description": "Send the person a message while you keep working, for something they need now or verbatim (a code, a link, a number they asked for). Not for routine progress.",
            "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
        }),
    ]
}

/// Parsed `act` input.
#[derive(serde::Deserialize)]
struct ActIn {
    window: Option<String>,
    actions: Vec<ActStep>,
}
#[derive(serde::Deserialize)]
struct ActStep {
    #[serde(rename = "do")]
    what: String,
    id: Option<u32>,
    text: Option<String>,
    keys: Option<String>,
    dy: Option<f32>,
    ms: Option<u64>,
}

pub fn target_of(w: Option<&str>) -> Option<Target> {
    let w = w?.trim();
    if w.is_empty() {
        return None;
    }
    Some(if w.to_lowercase().ends_with(".exe") || (!w.contains(' ') && w.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c == '.')) {
        Target::App(w.to_string())
    } else {
        Target::Title(w.to_string())
    })
}

/// State one conversation keeps about the screen between tool calls.
#[derive(Default)]
pub struct Screen {
    /// The last look at each window (by handle), for "what changed" after an act.
    looks: HashMap<u64, Snapshot>,
    /// The window the agent last looked at or acted in.
    current: Option<u64>,
    /// The last screenshot, to turn the model's coordinates into screen pixels.
    pub shot: Option<Shot>,
}

pub enum Outcome {
    Text(String),
    Error(String),
}

fn name_of(s: Option<&Snapshot>, id: u32) -> String {
    s.and_then(|s| s.elements.iter().find(|e| e.id == id))
        .map(|e| if e.name.trim().is_empty() { e.role.clone() } else { format!("“{}”", e.name.trim()) })
        .unwrap_or_else(|| format!("[{id}]"))
}

impl Screen {
    fn remember(&mut self, s: Snapshot) -> &Snapshot {
        let h = s.window.handle;
        self.current = Some(h);
        self.looks.insert(h, s);
        &self.looks[&h]
    }
    /// Keeps a snapshot taken elsewhere (after a skill ran) and returns it as an outline.
    pub(crate) fn seen(&mut self, s: Snapshot) -> String {
        render(self.remember(s))
    }
    fn target(&self, w: Option<&str>) -> Target {
        target_of(w).or(self.current.map(Target::Handle)).unwrap_or(Target::Focused)
    }

    pub fn look(&mut self, hands: &Hands, window: Option<&str>, step: &dyn Fn(Event)) -> Outcome {
        match hands.snapshot(self.target(window), SnapshotOptions::default()) {
            Ok(s) => {
                let b = s.window.bounds;
                step(Event::Scan { x: b.x, y: b.y, w: b.w, h: b.h });
                Outcome::Text(render(self.remember(s)))
            }
            Err(e) => Outcome::Error(e.to_string()),
        }
    }

    pub fn windows(&self, hands: &Hands) -> Outcome {
        match hands.windows() {
            Ok(ws) => Outcome::Text(ws.iter().map(|w| format!("\"{}\" app={}{}", w.title, w.app, if w.focused { " (in front)" } else { "" })).collect::<Vec<_>>().join("\n")),
            Err(e) => Outcome::Error(e.to_string()),
        }
    }

    /// Runs a batch, then reports what changed. `step` gets a plain-language line per action.
    pub fn act(&mut self, hands: &Hands, input: &Value, step: &dyn Fn(Event)) -> Outcome {
        let inp: ActIn = match serde_json::from_value(input.clone()) {
            Ok(v) => v,
            Err(e) => return Outcome::Error(format!("couldn't read the actions: {e}")),
        };
        let target = self.target(inp.window.as_deref());
        // the ids refer to the last look at this window; take one if there isn't any
        let before = match hands.snapshot(target.clone(), SnapshotOptions::default()) {
            Ok(s) => s,
            Err(e) => return Outcome::Error(e.to_string()),
        };
        let handle = before.window.handle;
        let prev = self.looks.get(&handle).cloned();
        let names = prev.as_ref().unwrap_or(&before);
        let mut actions: Vec<(Action, String, Option<Event>)> = Vec::new();
        let mut needs_front = false;
        for s in &inp.actions {
            let id = || s.id.ok_or_else(|| format!("\"{}\" needs an element id", s.what));
            let a = match s.what.as_str() {
                "click" => id().map(|id| Action::Click { id, button: MouseButton::Left, double: false }),
                "double_click" => id().map(|id| Action::Click { id, button: MouseButton::Left, double: true }),
                "right_click" => id().map(|id| Action::Click { id, button: MouseButton::Right, double: false }),
                "fill" => id().map(|id| Action::Fill { id, text: s.text.clone().unwrap_or_default() }),
                "type" => { needs_front = true; Ok(Action::Type { text: s.text.clone().unwrap_or_default() }) }
                "key" => { needs_front = true; Ok(Action::Key { keys: s.keys.clone().or(s.text.clone()).unwrap_or_default(), repeat: 1 }) }
                "focus" => id().map(|id| Action::Focus { id }),
                "toggle" => id().map(|id| Action::Toggle { id }),
                "expand" => id().map(|id| Action::Expand { id }),
                "collapse" => id().map(|id| Action::Collapse { id }),
                "select" => id().map(|id| Action::Select { id }),
                "scroll" => Ok(Action::Scroll { id: s.id, dx: 0.0, dy: s.dy.unwrap_or(1.0) }),
                "launch" => Ok(Action::Launch { target: s.text.clone().unwrap_or_default() }),
                "activate" => Ok(Action::Activate { target: Target::Title(s.text.clone().unwrap_or_default()) }),
                "wait" => Ok(Action::Wait { ms: s.ms.unwrap_or(500) }),
                other => Err(format!("unknown action \"{other}\"")),
            };
            match a {
                Ok(a) => {
                    let point = point_of(&a, names);
                    actions.push((a.clone(), describe(&a, names), point));
                }
                Err(e) => return Outcome::Error(e),
            }
        }
        // typing goes to the window in front, so bring this one forward first
        if needs_front && !before.window.focused {
            if let Err(e) = hands.act(vec![Action::Activate { target: Target::Handle(handle) }, Action::Wait { ms: 150 }], false) {
                return Outcome::Error(e.to_string());
            }
        }
        // one at a time, so the ghost cursor can show each one where it happens
        let pace = PACE_MS.load(Ordering::Relaxed);
        let mut results = Vec::new();
        for (a, text, point) in actions {
            step(Event::Step { text });
            if let Some(p) = point {
                step(p);
                if pace > 0 {
                    std::thread::sleep(Duration::from_millis(pace));
                }
            }
            match hands.act(vec![a], false) {
                Ok(mut r) => {
                    let failed = r.iter().any(|r| !r.ok);
                    results.append(&mut r);
                    if failed {
                        break;
                    }
                }
                Err(e) => return Outcome::Error(e.to_string()),
            }
        }
        std::thread::sleep(Duration::from_millis(350));
        let mut out = String::new();
        if let Some((i, r)) = results.iter().enumerate().find(|(_, r)| !r.ok) {
            out.push_str(&format!("action {} failed: {}. The actions after it didn't run.\n", i + 1, r.error.clone().unwrap_or_default()));
        } else {
            out.push_str(&format!("done ({} actions)\n", results.len()));
        }
        match hands.snapshot(Target::Handle(handle), SnapshotOptions::default()) {
            Ok(after) => {
                out.push_str(&render_diff(&before, &after));
                self.remember(after);
            }
            Err(_) => out.push_str("the window closed or changed; look again"),
        }
        Outcome::Text(out)
    }
}

/// Where an action lands on screen, for the ghost cursor.
pub(crate) fn point_of(a: &Action, s: &Snapshot) -> Option<Event> {
    let (id, action, text) = match a {
        Action::Click { id, .. } => (*id, "click", None),
        Action::Fill { id, text } => (*id, "type", Some(text.clone())),
        Action::Focus { id } => (*id, "focus", None),
        Action::Toggle { id } => (*id, "click", None),
        Action::Expand { id } | Action::Collapse { id } | Action::Select { id } => (*id, "click", None),
        Action::Scroll { id: Some(id), .. } => (*id, "scroll", None),
        Action::Type { text } => {
            let f = s.elements.iter().find(|e| e.focused)?;
            return Some(Event::Point { x: f.bounds.x, y: f.bounds.y, w: f.bounds.w, h: f.bounds.h, action: "type".into(), text: Some(text.clone()) });
        }
        Action::Key { keys, .. } => {
            let f = s.elements.iter().find(|e| e.focused)?;
            return Some(Event::Point { x: f.bounds.x, y: f.bounds.y, w: f.bounds.w, h: f.bounds.h, action: "key".into(), text: Some(keys.clone()) });
        }
        _ => return None,
    };
    let e = s.elements.iter().find(|e| e.id == id)?;
    if e.bounds.is_empty() {
        return None;
    }
    Some(Event::Point { x: e.bounds.x, y: e.bounds.y, w: e.bounds.w, h: e.bounds.h, action: action.into(), text })
}

fn describe(a: &Action, s: &Snapshot) -> String {
    let n = |id: u32| name_of(Some(s), id);
    match a {
        Action::Click { id, double: true, .. } => format!("Double-click {}", n(*id)),
        Action::Click { id, button: MouseButton::Right, .. } => format!("Right-click {}", n(*id)),
        Action::Click { id, .. } => format!("Click {}", n(*id)),
        Action::Fill { id, text } => format!("Type “{}” in {}", short(text), n(*id)),
        Action::Type { text } => format!("Type “{}”", short(text)),
        Action::Key { keys, .. } => format!("Press {keys}"),
        Action::Focus { id } => format!("Focus {}", n(*id)),
        Action::Toggle { id } => format!("Toggle {}", n(*id)),
        Action::Expand { id } => format!("Open {}", n(*id)),
        Action::Collapse { id } => format!("Close {}", n(*id)),
        Action::Select { id } => format!("Select {}", n(*id)),
        Action::Scroll { .. } => "Scroll".into(),
        Action::Launch { target } => format!("Open {}", short(target)),
        Action::Activate { .. } => "Switch window".into(),
        Action::Wait { .. } => "Wait".into(),
        _ => "Act".into(),
    }
}

fn short(s: &str) -> String {
    let s = s.replace('\n', " ");
    if s.chars().count() > 40 { format!("{}…", s.chars().take(39).collect::<String>()) } else { s }
}

/* ───────── Anthropic's computer toolset (pixel actions + screenshots), on Hands ───────── */

pub const SCREENSHOT_EDGE: u32 = 1568;
const HALT: &str = "Not executed: an earlier computer action in this turn failed.";

/// Result content for one toolset call: Ok(text or image block list) / Err(message)
pub fn computer(hands: &Hands, screen: &mut Screen, name: &str, input: &Value, step: &dyn Fn(Event)) -> Result<Value, String> {
    let take = |screen: &mut Screen| -> Result<Value, String> {
        let shot = hands.screenshot_for_model(SCREENSHOT_EDGE).map_err(|e| e.to_string())?;
        use base64::Engine;
        let data = base64::engine::general_purpose::STANDARD.encode(&shot.png);
        screen.shot = Some(shot);
        Ok(json!([{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}]))
    };
    if screen.shot.is_none() && name != "screenshot" {
        take(screen)?; // so coordinates can be mapped
    }
    let pt = |screen: &Screen, v: &Value| -> Option<(i32, i32)> {
        let a = v.as_array()?;
        let (x, y) = (a.first()?.as_f64()?, a.get(1)?.as_f64()?);
        Some(screen.shot.as_ref()?.to_screen(x, y))
    };
    let mods = input.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let run = |acts: Vec<Action>| -> Result<Value, String> {
        let r = hands.act(acts, false).map_err(|e| e.to_string())?;
        match r.iter().find(|r| !r.ok) {
            Some(f) => Err(f.error.clone().unwrap_or_else(|| "failed".into())),
            None => Ok(json!("OK")),
        }
    };
    let click = |screen: &Screen, button: MouseButton, count: u8| -> Result<Value, String> {
        let (x, y) = match input.get("coordinate").and_then(|c| pt(screen, c)) {
            Some(p) => p,
            None => {
                // no coordinate: click where the pointer is
                let r = hands.act(vec![Action::CursorPos], false).map_err(|e| e.to_string())?;
                let info = r.first().and_then(|r| r.info.clone()).unwrap_or_default();
                let nums: Vec<i32> = info.split(|c: char| !c.is_ascii_digit() && c != '-').filter_map(|s| s.parse().ok()).collect();
                (*nums.first().unwrap_or(&0), *nums.get(1).unwrap_or(&0))
            }
        };
        step(Event::Point { x, y, w: 0, h: 0, action: "click".into(), text: None });
        step(Event::Step { text: format!("{} on the screen", match (button, count) { (MouseButton::Right, _) => "Right-click", (_, 2) => "Double-click", (_, 3) => "Triple-click", _ => "Click" }) });
        run(vec![Action::ClickAt { x, y, button, count, mods: mods.clone() }])
    };
    match name {
        "screenshot" => { step(Event::Step { text: "Look at the screen".into() }); take(screen) }
        "zoom" => take(screen), // zoom is turned off in the toolset config; answer with a fresh screenshot if it comes
        "left_click" => click(screen, MouseButton::Left, 1),
        "right_click" => click(screen, MouseButton::Right, 1),
        "middle_click" => click(screen, MouseButton::Middle, 1),
        "double_click" => click(screen, MouseButton::Left, 2),
        "triple_click" => click(screen, MouseButton::Left, 3),
        "left_click_drag" => {
            let from = input.get("start_coordinate").and_then(|c| pt(screen, c)).ok_or("start_coordinate is missing")?;
            let to = input.get("coordinate").and_then(|c| pt(screen, c)).ok_or("coordinate is missing")?;
            step(Event::Point { x: to.0, y: to.1, w: 0, h: 0, action: "drag".into(), text: None });
            step(Event::Step { text: "Drag on the screen".into() });
            run(vec![Action::Drag { from: [from.0, from.1], to: [to.0, to.1], mods }])
        }
        "mouse_move" => {
            let (x, y) = input.get("coordinate").and_then(|c| pt(screen, c)).ok_or("coordinate is missing")?;
            run(vec![Action::MoveTo { x, y }])
        }
        "left_mouse_down" => run(vec![Action::MouseDown]),
        "left_mouse_up" => run(vec![Action::MouseUp]),
        "cursor_position" => {
            let r = hands.act(vec![Action::CursorPos], false).map_err(|e| e.to_string())?;
            let info = r.first().and_then(|r| r.info.clone()).unwrap_or_default();
            let nums: Vec<f64> = info.split(|c: char| !c.is_ascii_digit() && c != '-').filter_map(|s| s.parse().ok()).collect();
            let s = screen.shot.as_ref().ok_or("no screenshot yet")?;
            let (x, y) = (nums.first().copied().unwrap_or(0.0), nums.get(1).copied().unwrap_or(0.0));
            Ok(json!(format!("X={}, Y={}", ((x - s.origin_x as f64) * s.scale).round(), ((y - s.origin_y as f64) * s.scale).round())))
        }
        "scroll" => {
            let at = input.get("coordinate").and_then(|c| pt(screen, c)).map(|(x, y)| [x, y]);
            let direction = input.get("scroll_direction").and_then(|d| d.as_str()).unwrap_or("down").to_string();
            let amount = input.get("scroll_amount").and_then(|a| a.as_u64()).unwrap_or(3) as u32;
            step(Event::Step { text: format!("Scroll {direction}") });
            run(vec![Action::ScrollAt { at, direction, amount, mods }])
        }
        "type" => {
            let text = input.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
            step(Event::Step { text: format!("Type “{}”", short(&text)) });
            run(vec![Action::Type { text }])
        }
        "key" => {
            let keys = keyname(input.get("text").and_then(|t| t.as_str()).unwrap_or(""));
            let repeat = input.get("repeat").and_then(|r| r.as_u64()).unwrap_or(1) as u32;
            step(Event::Step { text: format!("Press {keys}") });
            run(vec![Action::Key { keys, repeat }])
        }
        "hold_key" => {
            let keys = keyname(input.get("text").and_then(|t| t.as_str()).unwrap_or(""));
            let secs = input.get("duration").and_then(|d| d.as_f64()).unwrap_or(1.0) as f32;
            run(vec![Action::HoldKey { keys, secs }])
        }
        "wait" => {
            let secs = input.get("duration").and_then(|d| d.as_f64()).unwrap_or(1.0).clamp(0.0, 300.0);
            std::thread::sleep(Duration::from_secs_f64(secs));
            Ok(json!("OK"))
        }
        other => Err(format!("{other} isn't supported on this computer")),
    }
}

/// xdotool-style names ("Return", "Page_Down", "ctrl+shift+t") -> Hands names.
fn keyname(k: &str) -> String {
    k.split('+').map(|p| p.trim().to_lowercase().replace('_', "")).map(|p| match p.as_str() {
        "return" | "kpenter" => "enter".to_string(),
        "prior" => "pageup".to_string(),
        "next" => "pagedown".to_string(),
        "control" => "ctrl".to_string(),
        "meta" | "super" | "win" => "win".to_string(),
        _ => p,
    }).collect::<Vec<_>>().join("+")
}

pub fn halt_text() -> &'static str {
    HALT
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn key_names() {
        assert_eq!(keyname("Return"), "enter");
        assert_eq!(keyname("ctrl+Page_Down"), "ctrl+pagedown");
        assert_eq!(keyname("alt+Tab"), "alt+tab");
    }
    #[test]
    fn targets() {
        assert!(matches!(target_of(Some("notepad.exe")), Some(Target::App(_))));
        assert!(matches!(target_of(Some("Untitled - Notepad")), Some(Target::Title(_))));
        assert!(target_of(Some("  ")).is_none());
    }
}
