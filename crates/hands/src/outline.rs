//! The text agents read: an indented outline of a window, and the changes between two looks.
//! Kept short on purpose: every line costs tokens and time.

use crate::{Element, Snapshot};
use std::collections::HashMap;
use std::fmt::Write;

const NAME_MAX: usize = 80;
const VALUE_MAX: usize = 60;
/// Containers that only group things. Without a name or an action they add nothing.
const QUIET: &[&str] = &["pane", "group", "custom", "generic", "none", "section", "panel", "filler", "unknown"];

/// Gives every element a key that survives between snapshots (path of role:name, with a
/// counter for look-alike siblings), so `diff` can tell what changed.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn finalize(elements: &mut [Element]) {
    let mut stack: Vec<(u16, String)> = Vec::new();
    let mut seen: HashMap<String, u32> = HashMap::new();
    for e in elements.iter_mut() {
        while stack.last().is_some_and(|(d, _)| *d >= e.depth) {
            stack.pop();
        }
        let parent = stack.last().map(|(_, k)| k.as_str()).unwrap_or("");
        let base = format!("{parent}/{}:{}", e.role, short(&e.name, 40));
        let n = seen.entry(base.clone()).or_insert(0);
        e.key = format!("{base}#{n}");
        *n += 1;
        stack.push((e.depth, e.key.clone()));
    }
}

fn short(s: &str, max: usize) -> String {
    let s = s.trim().replace(['\n', '\r', '\t'], " ");
    if s.chars().count() <= max {
        s
    } else {
        let mut t: String = s.chars().take(max - 1).collect();
        t.push('…');
        t
    }
}

fn quiet(e: &Element) -> bool {
    QUIET.contains(&e.role.as_str()) && e.name.trim().is_empty() && e.value.as_deref().unwrap_or("").is_empty() && e.can.is_empty() && !e.focused
}

/// One element as one line, without indentation.
pub fn line(e: &Element) -> String {
    let mut s = format!("[{}] {}", e.id, e.role);
    if !e.name.trim().is_empty() {
        let _ = write!(s, " \"{}\"", short(&e.name, NAME_MAX).replace('"', "'"));
    }
    if let Some(v) = &e.value {
        if !v.is_empty() && v.trim() != e.name.trim() {
            let _ = write!(s, " value=\"{}\"", short(v, VALUE_MAX).replace('"', "'"));
        }
    }
    if !e.enabled {
        s.push_str(" disabled");
    }
    if e.focused {
        s.push_str(" focused");
    }
    match e.checked {
        Some(true) => s.push_str(" checked"),
        Some(false) => s.push_str(" unchecked"),
        None => {}
    }
    match e.expanded {
        Some(true) => s.push_str(" expanded"),
        Some(false) => s.push_str(" collapsed"),
        None => {}
    }
    if e.selected == Some(true) {
        s.push_str(" selected");
    }
    if e.can.iter().any(|c| c == "scroll") {
        s.push_str(" scrollable");
    }
    s
}

/// The full outline of a snapshot. Empty grouping containers are skipped and their
/// children move up, so the agent sees structure, not noise.
pub fn render(snap: &Snapshot) -> String {
    let w = &snap.window;
    let mut out = format!(
        "window \"{}\" app={} {}x{}{}\n",
        short(&w.title, NAME_MAX).replace('"', "'"),
        w.app,
        w.bounds.w,
        w.bounds.h,
        if snap.truncated { " (cut off: too many elements, look at a part with a narrower target)" } else { "" }
    );
    // display depth = number of shown ancestors
    let mut stack: Vec<(u16, bool)> = Vec::new();
    for e in &snap.elements {
        while stack.last().is_some_and(|(d, _)| *d >= e.depth) {
            stack.pop();
        }
        let shown = !quiet(e);
        if shown {
            let indent = stack.iter().filter(|(_, s)| *s).count() + 1;
            for _ in 0..indent {
                out.push_str("  ");
            }
            out.push_str(&line(e));
            out.push('\n');
        }
        stack.push((e.depth, shown));
    }
    out
}

#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    Added(String),
    Removed(String),
    Changed(String),
}

/// What changed between two looks at the same window, as short lines. Much cheaper for
/// the agent than re-reading the whole outline after every action.
pub fn diff(before: &Snapshot, after: &Snapshot) -> Vec<Change> {
    let old: HashMap<&str, &Element> = before.elements.iter().map(|e| (e.key.as_str(), e)).collect();
    let new: HashMap<&str, &Element> = after.elements.iter().map(|e| (e.key.as_str(), e)).collect();
    let mut out = Vec::new();
    if before.window.title != after.window.title {
        out.push(Change::Changed(format!("window title is now \"{}\"", short(&after.window.title, NAME_MAX))));
    }
    for e in &after.elements {
        if quiet(e) {
            continue;
        }
        match old.get(e.key.as_str()) {
            None => out.push(Change::Added(line(e))),
            Some(o) => {
                let same = o.value == e.value && o.enabled == e.enabled && o.checked == e.checked && o.expanded == e.expanded && o.selected == e.selected && o.focused == e.focused;
                if !same {
                    out.push(Change::Changed(line(e)));
                }
            }
        }
    }
    for e in &before.elements {
        if !quiet(e) && !new.contains_key(e.key.as_str()) {
            let mut l = e.role.clone();
            if !e.name.trim().is_empty() {
                let _ = write!(l, " \"{}\"", short(&e.name, NAME_MAX));
            }
            out.push(Change::Removed(l));
        }
    }
    out
}

/// Diff as text. Falls back to the full outline when most of the window changed.
pub fn render_diff(before: &Snapshot, after: &Snapshot) -> String {
    let changes = diff(before, after);
    if changes.is_empty() {
        return "nothing changed".into();
    }
    if changes.len() > after.elements.len() / 2 + 10 {
        return render(after);
    }
    let mut out = String::from("changes:\n");
    for c in changes {
        match c {
            Change::Added(l) => { let _ = writeln!(out, "+ {l}"); }
            Change::Removed(l) => { let _ = writeln!(out, "- {l}"); }
            Change::Changed(l) => { let _ = writeln!(out, "~ {l}"); }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Rect, WindowInfo};

    fn el(id: u32, depth: u16, role: &str, name: &str) -> Element {
        Element { id, role: role.into(), name: name.into(), value: None, bounds: Rect::default(), enabled: true, focused: false, checked: None, expanded: None, selected: None, can: vec![], key: String::new(), depth, children: vec![] }
    }
    fn snap(mut elements: Vec<Element>) -> Snapshot {
        finalize(&mut elements);
        Snapshot { window: WindowInfo { handle: 1, title: "Notepad".into(), app: "notepad.exe".into(), pid: 1, bounds: Rect { x: 0, y: 0, w: 800, h: 600 }, focused: true, minimized: false }, elements, took_ms: 3, truncated: false }
    }

    #[test]
    fn hides_empty_groups_and_indents() {
        let s = snap(vec![el(1, 0, "pane", ""), el(2, 1, "button", "Save"), el(3, 1, "group", ""), el(4, 2, "edit", "Text")]);
        let r = render(&s);
        assert!(r.contains("\n  [2] button \"Save\"\n"), "{r}");
        assert!(r.contains("\n  [4] edit \"Text\"\n"), "{r}");
        assert!(!r.contains("pane"));
    }

    #[test]
    fn diff_finds_value_change_and_new_dialog() {
        let a = snap(vec![el(1, 0, "edit", "Text"), el(2, 0, "button", "Save")]);
        let mut e = el(1, 0, "edit", "Text");
        e.value = Some("hello".into());
        let b = snap(vec![e, el(2, 0, "button", "Save"), el(3, 0, "dialog", "Save As")]);
        let d = render_diff(&a, &b);
        assert!(d.contains("~ [1] edit \"Text\" value=\"hello\""), "{d}");
        assert!(d.contains("+ [3] dialog \"Save As\""), "{d}");
    }
}
