//! Try an agent from a terminal against any OpenAI-compatible endpoint or Claude:
//!   MINUS_KEY=... cargo run -p agent --example try -- <provider> <model> "<job>" [base_url]
//! Questions are answered with "blue", approvals with "approved".
use agent::{AgentSpec, Brain, Event, Runtime};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (provider, model, job) = (a[0].clone(), a[1].clone(), a[2].clone());
    let rt = Runtime::new(std::env::temp_dir().join("minus-try"));
    rt.forget("try");
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    let emit: Arc<dyn Fn(Event) + Send + Sync> = Arc::new(move |e| { let _ = tx.send(e); });
    let spec = AgentSpec { id: "try".into(), name: "Tester".into(), role: "Testing Minus".into(), instructions: String::new(), computer: "this computer".into(), perms: vec![("Send email and messages".into(), "ask".into())], skills: vec![], team: vec![], secrets: vec![], mcp: String::new() };
    let brain = Brain { provider, model, key: std::env::var("MINUS_KEY").unwrap_or_default(), effort: Some("low".into()), base_url: a.get(3).cloned() };
    rt.start(spec, brain, job, emit);
    while let Some(e) = rx.recv().await {
        println!("{}", serde_json::to_string(&e).unwrap());
        match &e {
            Event::Ask { call, .. } => { rt.reply(call, "blue".into()); }
            Event::Approval { call, .. } => { rt.reply(call, "approved".into()); }
            Event::Done { .. } | Event::Error { .. } | Event::Stopped => break,
            _ => {}
        }
    }
}
