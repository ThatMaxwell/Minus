//! Try the large local voice: downloads llama.cpp and Orpheus (once), then writes the sound
//! codes for a sentence to stdout as JSON.
//!     cargo run -p agent --example orpheus -- <dir> "Hey! <laugh> It's Minus." [voice]
#[tokio::main]
async fn main() {
    let mut a = std::env::args().skip(1);
    let dir = std::path::PathBuf::from(a.next().expect("a folder to keep it in"));
    let text = a.next().unwrap_or_else(|| "Hey there! <laugh> This is Minus, talking right on your own computer.".into());
    let voice = a.next().unwrap_or_else(|| "tara".into());
    let http = agent::http_client();
    let last = std::sync::Mutex::new(0u64);
    agent::orpheus::install(&http, &dir, &|d, t| {
        let mut l = last.lock().unwrap();
        if d - *l > 200_000_000 || d == t { *l = d; eprintln!("downloaded {} / {} MB", d / 1_000_000, t / 1_000_000); }
    }).await.unwrap();
    let t = std::time::Instant::now();
    let codes = agent::orpheus::speak(&http, &dir, &voice, &text).await.unwrap();
    eprintln!("{} codes ({:.1} s of speech) in {:.1} s", codes.len(), codes.len() as f64 / 7.0 / 12.0, t.elapsed().as_secs_f64());
    println!("{}", serde_json::to_string(&codes).unwrap());
    agent::orpheus::stop();
}
