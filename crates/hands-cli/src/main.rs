//! minus-hands: try Minus Hands from a terminal.
//!
//!   minus-hands windows                     list windows
//!   minus-hands tree [focused|"title"|app.exe]  outline of a window (default: focused, after 3 s)
//!   minus-hands json [target]               the same, as JSON
//!   minus-hands act '<json actions>' [target]   snapshot the target, then run actions on its ids
//!   minus-hands watch [target]              print what changes, every second
//!   minus-hands bench [target]              how fast a snapshot is
//!   minus-hands shot out.png                screenshot of all screens
//!
//! Quick actions (the target goes last, default: focused window):
//!   minus-hands click 12 notepad.exe        click element [12]
//!   minus-hands fill 5 "hello" notepad.exe  put text into element [5]
//!   minus-hands type "hello"                type at the keyboard focus
//!   minus-hands key ctrl+s                  press keys
//!
//! Example (Notepad open):
//!   minus-hands act '[{"do":"fill","id":5,"text":"hi from Minus"},{"do":"key","keys":"ctrl+s"}]' notepad.exe

use hands::{render, render_diff, Action, Hands, SnapshotOptions, Target};
use std::time::{Duration, Instant};

fn target(arg: Option<&String>) -> Target {
    match arg.map(|s| s.as_str()) {
        None | Some("focused") => Target::Focused,
        Some(s) if s.to_lowercase().ends_with(".exe") => Target::App(s.to_string()),
        Some(s) if s.chars().all(|c| c.is_ascii_digit()) => Target::Handle(s.parse().unwrap()),
        Some(s) => Target::Title(s.to_string()),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("help");
    if !matches!(cmd, "windows" | "tree" | "json" | "act" | "watch" | "bench" | "shot" | "click" | "fill" | "type" | "key") {
        println!("{}", include_str!("main.rs").lines().skip(1).take_while(|l| l.starts_with("//!")).map(|l| l.trim_start_matches("//!").strip_prefix(' ').unwrap_or("")).collect::<Vec<_>>().join("\n"));
        return;
    }
    let hands = match Hands::new() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Minus Hands can't start: {e}");
            std::process::exit(1);
        }
    };
    let focused_wait = |t: &Target| {
        if matches!(t, Target::Focused) {
            eprintln!("Click the window you want within 3 seconds…");
            std::thread::sleep(Duration::from_secs(3));
        }
    };
    let res: Result<(), String> = (|| {
        match cmd {
            "windows" => {
                for w in hands.windows().map_err(|e| e.to_string())? {
                    println!("{:>10}  {:<22} {}{}", w.handle, w.app, w.title, if w.focused { "  (focused)" } else { "" });
                }
            }
            "tree" | "json" => {
                let t = target(args.get(1));
                focused_wait(&t);
                let s = hands.snapshot(t, SnapshotOptions::default()).map_err(|e| e.to_string())?;
                if cmd == "json" {
                    println!("{}", serde_json::to_string_pretty(&s).unwrap());
                } else {
                    print!("{}", render(&s));
                    eprintln!("{} elements in {} ms", s.elements.len(), s.took_ms);
                }
            }
            "act" | "click" | "fill" | "type" | "key" => {
                let num = |i: usize| -> Result<u32, String> { args.get(i).and_then(|s| s.trim_matches(['[', ']']).parse().ok()).ok_or_else(|| "give an element number, like 12".to_string()) };
                let text = |i: usize| -> Result<String, String> { args.get(i).cloned().ok_or_else(|| "give the text".to_string()) };
                let (actions, t): (Vec<Action>, Target) = match cmd {
                    "click" => (vec![Action::Click { id: num(1)?, button: Default::default(), double: false }], target(args.get(2))),
                    "fill" => (vec![Action::Fill { id: num(1)?, text: text(2)? }], target(args.get(3))),
                    "type" => (vec![Action::Type { text: text(1)? }], target(args.get(2))),
                    "key" => (vec![Action::Key { keys: text(1)? }], target(args.get(2))),
                    _ => (serde_json::from_str(args.get(1).ok_or("give the actions as JSON")?).map_err(|e| format!("bad actions: {e}"))?, target(args.get(2))),
                };
                focused_wait(&t);
                let before = hands.snapshot(t.clone(), SnapshotOptions::default()).map_err(|e| e.to_string())?;
                let t0 = Instant::now();
                let results = hands.act(actions, false).map_err(|e| e.to_string())?;
                let took = t0.elapsed();
                for r in &results {
                    println!("{}", serde_json::to_string(r).unwrap());
                }
                eprintln!("ran in {} ms", took.as_millis());
                std::thread::sleep(Duration::from_millis(300));
                if let Ok(after) = hands.snapshot(t, SnapshotOptions::default()) {
                    print!("{}", render_diff(&before, &after));
                }
            }
            "watch" => {
                let t = target(args.get(1));
                focused_wait(&t);
                let mut prev = hands.snapshot(t.clone(), SnapshotOptions::default()).map_err(|e| e.to_string())?;
                print!("{}", render(&prev));
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                    let Ok(next) = hands.snapshot(t.clone(), SnapshotOptions::default()) else { continue };
                    let d = render_diff(&prev, &next);
                    if d != "nothing changed" {
                        println!("--- {} ms ---\n{d}", next.took_ms);
                    }
                    prev = next;
                }
            }
            "bench" => {
                let t = target(args.get(1));
                focused_wait(&t);
                let mut times = Vec::new();
                let mut n = 0;
                for _ in 0..10 {
                    let s = hands.snapshot(t.clone(), SnapshotOptions::default()).map_err(|e| e.to_string())?;
                    times.push(s.took_ms);
                    n = s.elements.len();
                }
                times.sort();
                println!("{n} elements · median {} ms · best {} ms · worst {} ms", times[5], times[0], times[9]);
            }
            "shot" => {
                let path = args.get(1).cloned().unwrap_or_else(|| "screen.png".into());
                let png = hands.screenshot().map_err(|e| e.to_string())?;
                std::fs::write(&path, png).map_err(|e| e.to_string())?;
                println!("saved {path}");
            }
            _ => {
                println!("{}", include_str!("main.rs").lines().skip(1).take_while(|l| l.starts_with("//!")).map(|l| l.trim_start_matches("//!").strip_prefix(' ').unwrap_or("")).collect::<Vec<_>>().join("\n"));
            }
        }
        Ok(())
    })();
    if let Err(e) = res {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
