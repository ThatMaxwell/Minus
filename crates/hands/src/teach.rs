//! "Show me once": you do a task, Minus watches, and the steps become a skill agents replay.
//!
//! Steps are recorded by meaning, not by mouse position: the element you clicked (its role,
//! name, window and the elements around it), the value a field ended up with when you left
//! it, and the shortcuts you pressed. That's what makes replay survive a moved window, a
//! different screen size or a slightly changed page. Input that agents generate is ignored.

use crate::{MouseButton, Rect};
use serde::{Deserialize, Serialize};

/// How to find an element again later.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElementRef {
    pub role: String,
    pub name: String,
    /// The app's file name, e.g. "chrome.exe"
    pub app: String,
    /// The window title when it was recorded
    pub window: String,
    /// Ancestors from the window down, as "role:name" (helps tell look-alikes apart)
    #[serde(default)]
    pub path: Vec<String>,
    /// Where it was, relative to its window (a last resort when names change)
    #[serde(default)]
    pub at: Rect,
}

/// One recorded step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaughtStep {
    Click { target: ElementRef, #[serde(default)] button: MouseButton, #[serde(default)] double: bool },
    /// A field ended up with this text. In a skill, `{{name}}` in the value is filled in each run.
    Fill { target: ElementRef, value: String },
    Key { keys: String, app: String, window: String },
}

impl TaughtStep {
    /// Plain words, for the list you see while recording and in the skill.
    pub fn describe(&self) -> String {
        let n = |t: &ElementRef| if t.name.trim().is_empty() { t.role.clone() } else { format!("“{}”", t.name.trim()) };
        match self {
            TaughtStep::Click { target, double: true, .. } => format!("Double-click {}", n(target)),
            TaughtStep::Click { target, button: MouseButton::Right, .. } => format!("Right-click {}", n(target)),
            TaughtStep::Click { target, .. } => format!("Click {}", n(target)),
            TaughtStep::Fill { target, value } => format!("Type “{value}” in {}", n(target)),
            TaughtStep::Key { keys, .. } => format!("Press {keys}"),
        }
    }
}

/// Picks the best match for `want` among elements of a snapshot (by role and name, then by
/// the path around it, then by position). Returns the element id.
pub fn best_match(want: &ElementRef, snap: &crate::Snapshot) -> Option<u32> {
    let win = snap.window.bounds;
    let mut best: Option<(i64, u32)> = None;
    // ancestors of each element, as role:name, from the window down
    let mut stack: Vec<(u16, String)> = Vec::new();
    for e in &snap.elements {
        while stack.last().is_some_and(|(d, _)| *d >= e.depth) {
            stack.pop();
        }
        let path: Vec<String> = stack.iter().map(|(_, s)| s.clone()).collect();
        stack.push((e.depth, format!("{}:{}", e.role, e.name.trim())));
        if e.role != want.role {
            continue;
        }
        let mut score: i64 = 0;
        if e.name.trim() == want.name.trim() {
            score += 1000;
        } else if !want.name.is_empty() && e.name.to_lowercase().contains(&want.name.to_lowercase()) {
            score += 400;
        } else if !want.name.trim().is_empty() {
            continue;
        }
        let shared = want.path.iter().rev().zip(path.iter().rev()).take_while(|(a, b)| a == b).count();
        score += shared as i64 * 40;
        let (dx, dy) = ((e.bounds.x - win.x) - want.at.x, (e.bounds.y - win.y) - want.at.y);
        score -= ((dx * dx + dy * dy) as f64).sqrt() as i64 / 20;
        if best.is_none_or(|(s, _)| score > s) {
            best = Some((score, e.id));
        }
    }
    best.map(|(_, id)| id)
}

/// Turns literal values into {{inputs}}: `inputs` maps a value you typed to the input's name.
pub fn parameterize(steps: &[TaughtStep], inputs: &[(String, String)]) -> Vec<TaughtStep> {
    steps
        .iter()
        .map(|s| match s {
            TaughtStep::Fill { target, value } => {
                let v = inputs.iter().find(|(lit, _)| lit == value).map(|(_, name)| format!("{{{{{name}}}}}")).unwrap_or_else(|| value.clone());
                TaughtStep::Fill { target: target.clone(), value: v }
            }
            other => other.clone(),
        })
        .collect()
}

/// The {{inputs}} a skill needs, in the order they first appear.
pub fn inputs_of(steps: &[TaughtStep]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in steps {
        let TaughtStep::Fill { value, .. } = s else { continue };
        let mut rest = value.as_str();
        while let Some(i) = rest.find("{{") {
            let after = &rest[i + 2..];
            let Some(j) = after.find("}}") else { break };
            let name = after[..j].trim().to_string();
            if !name.is_empty() && !out.contains(&name) {
                out.push(name);
            }
            rest = &after[j + 2..];
        }
    }
    out
}

/// Fills {{inputs}} in a value.
pub fn fill_in(value: &str, inputs: &std::collections::HashMap<String, String>) -> String {
    let mut out = value.to_string();
    for (k, v) in inputs {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Element, Snapshot, WindowInfo};
    fn el(id: u32, depth: u16, role: &str, name: &str, x: i32) -> Element {
        Element { id, role: role.into(), name: name.into(), value: None, bounds: Rect { x, y: 100, w: 80, h: 20 }, enabled: true, focused: false, checked: None, expanded: None, selected: None, can: vec![], key: String::new(), depth, children: vec![] }
    }
    #[test]
    fn finds_the_right_save_button() {
        let snap = Snapshot {
            window: WindowInfo { handle: 1, title: "CRM".into(), app: "chrome.exe".into(), pid: 1, bounds: Rect { x: 0, y: 0, w: 800, h: 600 }, focused: true, minimized: false },
            elements: vec![el(1, 0, "group", "Contact", 0), el(2, 1, "button", "Save", 100), el(3, 0, "group", "New lead", 0), el(4, 1, "button", "Save", 400)],
            took_ms: 1,
            truncated: false,
        };
        let want = ElementRef { role: "button".into(), name: "Save".into(), app: "chrome.exe".into(), window: "CRM".into(), path: vec!["group:New lead".into()], at: Rect { x: 400, y: 100, w: 80, h: 20 } };
        assert_eq!(best_match(&want, &snap), Some(4));
    }
    #[test]
    fn inputs_round_trip() {
        let t = ElementRef { role: "edit".into(), name: "Name".into(), app: "a".into(), window: "w".into(), path: vec![], at: Rect::default() };
        let steps = vec![TaughtStep::Fill { target: t, value: "Dana Okafor".into() }];
        let p = parameterize(&steps, &[("Dana Okafor".into(), "name".into())]);
        let TaughtStep::Fill { value, .. } = &p[0] else { panic!() };
        assert_eq!(value, "{{name}}");
        let mut m = std::collections::HashMap::new();
        m.insert("name".to_string(), "Leo".to_string());
        assert_eq!(fill_in(value, &m), "Leo");
        assert_eq!(inputs_of(&p), vec!["name".to_string()]);
    }
}
