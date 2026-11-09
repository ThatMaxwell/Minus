//! Skills: jobs the person showed an agent once ("Show me once"), replayed step by step.
//!
//! Each step names an element by meaning (role, name, window, what's around it), so replay
//! finds it again in a moved window, on another screen size, or after a small redesign. When
//! a step can't be found it waits a moment (apps take time to load), then gives up and says
//! which step it got to, so the agent can finish the rest by looking at the screen.

use crate::Event;
use hands::{fill_in, Action, Hands, Snapshot, SnapshotOptions, TaughtStep, Target, WindowInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    /// What it's for, in the person's words
    #[serde(default)]
    pub about: String,
    pub steps: Vec<TaughtStep>,
}

impl Skill {
    pub fn inputs(&self) -> Vec<String> {
        hands::inputs_of(&self.steps)
    }
    /// One line for the agent's job text.
    pub fn summary(&self) -> String {
        let inputs = self.inputs();
        format!(
            "- “{}”{}{}: {} step{}",
            self.name,
            if self.about.trim().is_empty() { String::new() } else { format!(" ({})", self.about.trim()) },
            if inputs.is_empty() { String::new() } else { format!(", inputs: {}", inputs.join(", ")) },
            self.steps.len(),
            if self.steps.len() == 1 { "" } else { "s" }
        )
    }
}

/// How long to keep looking for a step's element before giving up.
const FIND_FOR: Duration = Duration::from_millis(4000);

/// What a replay did.
pub struct Replay {
    pub done: usize,
    pub total: usize,
    /// The window it finished in, for the agent's next look
    pub last: Option<Snapshot>,
    pub error: Option<String>,
}

impl Replay {
    pub fn report(&self, skill: &Skill) -> String {
        match &self.error {
            None => format!("Ran “{}”: all {} steps done.", skill.name, self.total),
            Some(e) => format!(
                "“{}” stopped at step {} of {}: {e}. The steps before it are done. Look at the screen and finish the rest yourself, then tell the person the skill may need showing again.",
                skill.name,
                self.done + 1,
                self.total
            ),
        }
    }
}

/// Inputs the skill needs that weren't given.
pub fn missing(skill: &Skill, inputs: &HashMap<String, String>) -> Vec<String> {
    skill.inputs().into_iter().filter(|k| inputs.get(k).is_none_or(|v| v.is_empty())).collect()
}

/// Picks the window a step happened in: same app and title, else same app, else the front one.
fn window_for(windows: &[WindowInfo], app: &str, title: &str) -> Option<Target> {
    let same_app: Vec<&WindowInfo> = windows.iter().filter(|w| !app.is_empty() && w.app.eq_ignore_ascii_case(app)).collect();
    if let Some(w) = same_app.iter().find(|w| w.title == title) {
        return Some(Target::Handle(w.handle));
    }
    // titles often carry the page or file name; the part they share is what's left
    let words = |s: &str| s.split([' ', '-', '|', '—', '·']).filter(|w| w.len() > 2).map(|w| w.to_lowercase()).collect::<Vec<_>>();
    let want = words(title);
    let best = same_app.iter().max_by_key(|w| (words(&w.title).iter().filter(|x| want.contains(x)).count(), w.focused));
    if let Some(w) = best {
        return Some(Target::Handle(w.handle));
    }
    if app.is_empty() { Some(Target::Focused) } else { None }
}

fn masked(value: &str, filled: &str) -> String {
    if value.contains("{{password}}") { "•".repeat(filled.chars().count().clamp(4, 12)) } else { filled.to_string() }
}

/// Plays a skill back. `step` gets the same events as the agent's own actions, so the app
/// and the ghost cursor show it the same way.
pub fn replay(hands: &Hands, skill: &Skill, inputs: &HashMap<String, String>, pace_ms: u64, stop: &AtomicBool, step: &dyn Fn(Event)) -> Replay {
    let total = skill.steps.len();
    let mut out = Replay { done: 0, total, last: None, error: None };
    for (i, s) in skill.steps.iter().enumerate() {
        if stop.load(Ordering::SeqCst) {
            out.error = Some("stopped by the person".into());
            return out;
        }
        let (app, title) = match s {
            TaughtStep::Click { target, .. } | TaughtStep::Fill { target, .. } => (target.app.clone(), target.window.clone()),
            TaughtStep::Key { app, window, .. } => (app.clone(), window.clone()),
        };
        // find the window, then the element in it (waiting a little for things to load)
        let started = Instant::now();
        let found = loop {
            let attempt = (|| -> Result<(Snapshot, Option<u32>), String> {
                let wins = hands.windows().map_err(|e| e.to_string())?;
                let t = window_for(&wins, &app, &title).ok_or_else(|| format!("{app} isn't open"))?;
                let snap = hands.snapshot(t, SnapshotOptions::default()).map_err(|e| e.to_string())?;
                let id = match s {
                    TaughtStep::Click { target, .. } | TaughtStep::Fill { target, .. } => {
                        Some(hands::best_match(target, &snap).ok_or_else(|| format!("couldn't find {} in “{}”", name(s), snap.window.title))?)
                    }
                    TaughtStep::Key { .. } => None,
                };
                Ok((snap, id))
            })();
            match attempt {
                Ok(v) => break Ok(v),
                Err(e) if started.elapsed() >= FIND_FOR => break Err(e),
                Err(_) => std::thread::sleep(Duration::from_millis(300)),
            }
        };
        let (snap, id) = match found {
            Ok(v) => v,
            Err(e) => {
                out.error = Some(e);
                return out;
            }
        };
        let action = match (s, id) {
            (TaughtStep::Click { button, double, .. }, Some(id)) => Action::Click { id, button: *button, double: *double },
            (TaughtStep::Fill { value, .. }, Some(id)) => Action::Fill { id, text: fill_in(value, inputs) },
            (TaughtStep::Key { keys, .. }, _) => Action::Key { keys: keys.clone(), repeat: 1 },
            _ => unreachable!(),
        };
        let text = match (s, &action) {
            (TaughtStep::Fill { value, target }, Action::Fill { text, .. }) => {
                let n = if target.name.trim().is_empty() { target.role.clone() } else { format!("“{}”", target.name.trim()) };
                format!("Type “{}” in {n}", masked(value, text))
            }
            _ => s.describe(),
        };
        step(Event::Step { text });
        if let Some(p) = crate::tools::point_of(&action, &snap) {
            // the ghost cursor never shows a password
            let p = match (p, s) {
                (Event::Point { x, y, w, h, action, text }, TaughtStep::Fill { value, .. }) => Event::Point { x, y, w, h, action, text: text.map(|t| masked(value, &t)) },
                (p, _) => p,
            };
            step(p);
            if pace_ms > 0 {
                std::thread::sleep(Duration::from_millis(pace_ms));
            }
        }
        let mut acts = Vec::new();
        if matches!(s, TaughtStep::Key { .. }) && !snap.window.focused {
            acts.push(Action::Activate { target: Target::Handle(snap.window.handle) });
            acts.push(Action::Wait { ms: 150 });
        }
        acts.push(action);
        match hands.act(acts, false) {
            Ok(r) if r.iter().all(|r| r.ok) => {}
            Ok(r) => {
                out.error = Some(r.into_iter().find_map(|r| r.error).unwrap_or_else(|| "it didn't work".into()));
                return out;
            }
            Err(e) => {
                out.error = Some(e.to_string());
                return out;
            }
        }
        out.done = i + 1;
        out.last = Some(snap);
        // give the app a moment to react before the next step looks for its element
        std::thread::sleep(Duration::from_millis(250));
    }
    if let Some(s) = &out.last {
        out.last = hands.snapshot(Target::Handle(s.window.handle), SnapshotOptions::default()).ok();
    }
    out
}

fn name(s: &TaughtStep) -> String {
    match s {
        TaughtStep::Click { target, .. } | TaughtStep::Fill { target, .. } => {
            if target.name.trim().is_empty() { format!("the {}", target.role) } else { format!("“{}”", target.name.trim()) }
        }
        TaughtStep::Key { keys, .. } => keys.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hands::{ElementRef, Rect};
    fn w(handle: u64, app: &str, title: &str, focused: bool) -> WindowInfo {
        WindowInfo { handle, title: title.into(), app: app.into(), pid: 1, bounds: Rect::default(), focused, minimized: false }
    }
    #[test]
    fn picks_the_window_it_happened_in() {
        let wins = vec![w(1, "chrome.exe", "Inbox - Gmail - Google Chrome", true), w(2, "chrome.exe", "Leads · Acme CRM - Google Chrome", false), w(3, "notepad.exe", "notes.txt - Notepad", false)];
        assert!(matches!(window_for(&wins, "chrome.exe", "New lead · Acme CRM - Google Chrome"), Some(Target::Handle(2))));
        assert!(matches!(window_for(&wins, "notepad.exe", "todo.txt - Notepad"), Some(Target::Handle(3))));
        assert!(window_for(&wins, "excel.exe", "Book1").is_none());
    }
    #[test]
    fn summary_lists_inputs() {
        let t = ElementRef { role: "edit".into(), name: "Email".into(), app: "chrome.exe".into(), window: "CRM".into(), path: vec![], at: Rect::default() };
        let sk = Skill { id: "s1".into(), name: "Add a lead".into(), about: String::new(), steps: vec![TaughtStep::Fill { target: t, value: "{{email}}".into() }] };
        assert_eq!(sk.summary(), "- “Add a lead”, inputs: email: 1 step");
        let mut m = HashMap::new();
        assert_eq!(missing(&sk, &m), vec!["email".to_string()]);
        m.insert("email".into(), "a@b.co".into());
        assert!(missing(&sk, &m).is_empty());
        assert_eq!(masked("{{password}}", "hunter22"), "••••••••");
    }
}
