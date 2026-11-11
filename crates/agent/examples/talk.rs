//! Give an agent one job from the command line and watch what happens, with any AI:
//!   cargo run -p agent --example talk -- <provider> <model> "<job>" [base_url]
//! The key comes from MINUS_KEY (none for local servers like Ollama or llama.cpp).
use agent::{AgentSpec, Brain, Event, Runtime};
use std::sync::{mpsc, Arc, Mutex};

#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (provider, model, job) = (a[0].clone(), a[1].clone(), a[2].clone());
    let brain = Brain { provider, model, key: std::env::var("MINUS_KEY").unwrap_or_default(), effort: None, base_url: a.get(3).cloned() };
    let spec: AgentSpec = serde_json::from_value(serde_json::json!({"id": "talk", "name": "Rosie", "role": "Ajudante da Karla"})).unwrap();
    let rt = Runtime::new(std::env::temp_dir().join("minus-talk"));
    rt.forget("talk");
    println!("computer here: {}", rt.has_computer());
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let t0 = std::time::Instant::now();
    rt.start(spec, brain, job, Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); }));
    while let Ok(e) = rx.recv() {
        println!("[{:>5.1}s] {}", t0.elapsed().as_secs_f32(), serde_json::to_string(&e).unwrap());
        if matches!(e, Event::Done { .. } | Event::Error { .. } | Event::Stopped) { break; }
    }
}
