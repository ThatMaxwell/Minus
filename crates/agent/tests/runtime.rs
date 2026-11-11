//! The real runtime against a small fake AI server: a whole job (a tool call, then the answer),
//! a key the provider turns down, and checking a key when it's connected.

use agent::{AgentSpec, Brain, Event, Runtime};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// One request the fake server received.
#[derive(Debug, Clone)]
struct Seen {
    path: String,
    auth: String,
    body: Value,
}

/// Answers each request with the next (status, body) in `script`, and records what it got.
fn server(script: Vec<(u16, String)>) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", l.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        let mut script = script.into_iter();
        for conn in l.incoming() {
            let Ok(mut s) = conn else { break };
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            r.read_line(&mut line).unwrap();
            let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
            let (mut len, mut auth) = (0usize, String::new());
            loop {
                let mut h = String::new();
                r.read_line(&mut h).unwrap();
                let h = h.trim_end();
                if h.is_empty() { break; }
                let (k, v) = h.split_once(':').unwrap_or((h, ""));
                match k.to_ascii_lowercase().as_str() {
                    "content-length" => len = v.trim().parse().unwrap_or(0),
                    "authorization" | "x-api-key" => auth = v.trim().to_string(),
                    _ => {}
                }
            }
            let mut body = vec![0; len];
            r.read_exact(&mut body).unwrap();
            log.lock().unwrap().push(Seen { path, auth, body: serde_json::from_slice(&body).unwrap_or(Value::Null) });
            let (status, out) = script.next().unwrap_or((500, "{}".into()));
            let kind = if out.starts_with("data:") { "text/event-stream" } else { "application/json" };
            let _ = write!(s, "HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
        }
    });
    (url, seen)
}

fn spec() -> AgentSpec {
    serde_json::from_value(json!({"id": "a1", "name": "Rosie", "role": "Support", "perms": [["Send email", "ask"]]})).unwrap()
}
fn brain(url: &str) -> Brain {
    Brain { provider: "custom".into(), model: "test-model".into(), key: "k-123".into(), effort: None, base_url: Some(url.into()) }
}
/// Runs one job and returns every event, up to Done or Error.
fn job(rt: &Runtime, b: Brain, text: &str) -> Vec<Event> {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    rt.start(spec(), b, text.into(), Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); }));
    let mut out = Vec::new();
    while let Ok(e) = rx.recv_timeout(Duration::from_secs(20)) {
        let end = matches!(e, Event::Done { .. } | Event::Error { .. } | Event::Stopped);
        out.push(e);
        if end { break; }
    }
    out
}
fn reply(content: Value) -> String {
    json!({"choices": [{"message": content, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}).to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_whole_job_with_a_tool_call() {
    let (url, seen) = server(vec![
        (200, reply(json!({"role": "assistant", "content": null, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "remember", "arguments": "{\"note\":\"Karla likes tea\"}"}}]}))),
        (200, reply(json!({"role": "assistant", "content": "Oi, Karla! Anotei que você gosta de chá."}))),
    ]);
    let dir = std::env::temp_dir().join(format!("minus-test-{}", std::process::id()));
    let rt = Runtime::new(dir.clone());
    let ev = job(&rt, brain(&url), "Lembra que eu gosto de chá e me dá oi");
    let _ = std::fs::remove_dir_all(dir);

    assert!(matches!(ev.first(), Some(Event::Started)), "{ev:?}");
    assert!(ev.iter().any(|e| matches!(e, Event::Remember { text } if text == "Karla likes tea")), "{ev:?}");
    match ev.last() { Some(Event::Done { text }) => assert!(text.contains("Oi, Karla")), other => panic!("ended with {other:?}") }

    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_eq!(seen[0].path, "/v1/chat/completions");
    assert_eq!(seen[0].auth, "Bearer k-123");
    let tools: Vec<&str> = seen[0].body["tools"].as_array().unwrap().iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
    assert!(tools.contains(&"remember") && tools.contains(&"ask_user"), "{tools:?}");
    if !rt.has_computer() {
        // no computer to use here: no computer tools, and the agent is told so
        assert!(!tools.contains(&"look") && !tools.contains(&"act"), "{tools:?}");
        assert!(seen[0].body["messages"][0]["content"].as_str().unwrap().contains("can't use the person's apps"));
    }
    // the web, everywhere
    assert!(tools.contains(&"web_search") && tools.contains(&"read_page"), "{tools:?}");
    assert!(seen[0].body["messages"][0]["content"].as_str().unwrap().contains("language the person writes in"));
    // the second request carries the tool's result
    let msgs = seen[1].body["messages"].as_array().unwrap();
    assert!(msgs.iter().any(|m| m["role"] == "tool" && m["tool_call_id"] == "call_1"), "{msgs:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_the_provider_turns_down() {
    // Google's way: status 400, the error inside a list
    let (url, _) = server(vec![(400, r#"[{"error":{"code":400,"message":"Invalid Auth key.","status":"INVALID_ARGUMENT"}}]"#.into())]);
    let rt = Runtime::new(std::env::temp_dir().join(format!("minus-test-b-{}", std::process::id())));
    let ev = job(&rt, brain(&url), "hi");
    match ev.last() {
        Some(Event::Error { message }) => assert!(message.contains("didn't accept the API key (Invalid Auth key.)"), "{message}"),
        other => panic!("ended with {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn checking_a_key() {
    let rt = Runtime::new(std::env::temp_dir().join(format!("minus-test-c-{}", std::process::id())));
    let (url, seen) = server(vec![(200, r#"{"object":"list","data":[{"id":"models/gemini-3-pro"},{"id":"models/gemini-3-flash"}]}"#.into())]);
    let mut b = brain(&url);
    b.key = "AQ.Ab8RN6-test".into();
    assert_eq!(rt.check(&b, "Gemini").await.unwrap(), vec!["gemini-3-flash", "gemini-3-pro"]);
    assert_eq!(seen.lock().unwrap()[0].auth, "Bearer AQ.Ab8RN6-test");

    let (url, _) = server(vec![(401, r#"{"error":{"message":"Incorrect API key provided"}}"#.into())]);
    let e = rt.check(&brain(&url), "ChatGPT").await.unwrap_err();
    assert!(e.starts_with("ChatGPT didn't accept this key: Incorrect API key"), "{e}");

    // no model list: it tries the smallest real request instead
    let (url, seen) = server(vec![(404, "{}".into()), (200, reply(json!({"role": "assistant", "content": "OK"})))]);
    assert!(rt.check(&brain(&url), "My server").await.unwrap().is_empty());
    assert_eq!(seen.lock().unwrap()[1].path, "/v1/chat/completions");
}

/// Real providers, fake keys: the request gets as far as the key check, and the answer comes
/// back as a clear message. (Needs the internet: cargo test -- --ignored)
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn real_providers_turn_down_fake_keys() {
    let rt = Runtime::new(std::env::temp_dir().join(format!("minus-test-r-{}", std::process::id())));
    for (provider, model, key, name) in [
        ("gemini", "gemini-2.5-flash", "AQ.Ab8RN6fakefakefakefake", "Gemini"),
        ("gemini", "gemini-2.5-flash", "AIzaSyFakeFakeFakeFakeFakeFakeFakeFake1", "Gemini"),
        ("openai", "gpt-5", "sk-fake", "ChatGPT"),
        ("anthropic", "claude-opus-5-5", "sk-ant-fake", "Claude"),
    ] {
        let b = Brain { provider: provider.into(), model: model.into(), key: key.into(), effort: None, base_url: None };
        let checked = rt.check(&b, name).await;
        let ev = job(&rt, b, "hi");
        println!("{name} ({}…): check → {checked:?}\n    job → {:?}", &key[..4], ev.last());
        assert!(checked.is_err());
        assert!(matches!(ev.last(), Some(Event::Error { .. })));
    }
}

/// A streamed reply, the way Gemini sends one: the text arrives in pieces (and shows up live),
/// the tool call comes in two pieces with a thought signature, and that signature goes back
/// with the next request exactly as it came.
#[tokio::test(flavor = "multi_thread")]
async fn a_streamed_reply_with_a_signed_tool_call() {
    let sse = |chunks: &[Value]| chunks.iter().map(|c| format!("data: {c}\n\n")).collect::<String>() + "data: [DONE]\n\n";
    let first = sse(&[
        json!({"choices": [{"delta": {"role": "assistant", "content": "Anotando "}}]}),
        json!({"choices": [{"delta": {"content": "isso <[[happy]] agora."}}]}),
        json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "fc_1", "type": "function", "function": {"name": "remember", "arguments": "{\"note\":\"Karla "}, "extra_content": {"google": {"thought_signature": "SIG123"}}}]}}]}),
        json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "likes tea\"}"}}]}, "finish_reason": "tool_calls"}]}),
    ]);
    let second = sse(&[
        json!({"choices": [{"delta": {"content": "Pronto! "}}]}),
        json!({"choices": [{"delta": {"content": "Anotei. <[[proud]]"}, "finish_reason": "stop"}]}),
    ]);
    let (url, seen) = server(vec![
        (400, r#"[{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"reasoning_effort\": Cannot find field.","status":"INVALID_ARGUMENT"}}]"#.into()),
        (200, first),
        (200, second),
    ]);
    let rt = Runtime::new(std::env::temp_dir().join(format!("minus-test-s-{}", std::process::id())));
    let b = Brain { provider: "gemini".into(), model: "gemini-3-pro".into(), key: "AQ.test".into(), effort: Some("low".into()), base_url: Some(url) };
    let ev = job(&rt, b, "Lembra que eu gosto de chá");

    // the provider turned down reasoning_effort: sent again without it, and it worked
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].body["reasoning_effort"], "low");
    assert_eq!(seen[0].body["stream"], true);
    assert!(seen[1].body.get("reasoning_effort").is_none());
    // the reply showed up live, without the face code; the face changed instead
    assert!(ev.iter().any(|e| matches!(e, Event::Draft { text } if text.starts_with("Anotando"))), "{ev:?}");
    assert!(!ev.iter().any(|e| matches!(e, Event::Draft { text } | Event::Done { text } if text.contains("[[") || text.contains(']'))), "{ev:?}");
    assert!(ev.iter().any(|e| matches!(e, Event::Face { name } if name == "proud")), "{ev:?}");
    assert!(ev.iter().any(|e| matches!(e, Event::Remember { text } if text == "Karla likes tea")), "{ev:?}");
    match ev.last() { Some(Event::Done { text }) => assert_eq!(text, "Pronto! Anotei."), other => panic!("ended with {other:?}") }
    // the thought signature went back with the call it belongs to
    let msgs = seen[2].body["messages"].as_array().unwrap();
    let call = msgs.iter().find(|m| m["role"] == "assistant").unwrap();
    assert_eq!(call["tool_calls"][0]["extra_content"]["google"]["thought_signature"], "SIG123");
    assert_eq!(call["tool_calls"][0]["function"]["arguments"], "{\"note\":\"Karla likes tea\"}");
}

/// A tiny website: the same page for every address.
fn site(html: &'static str) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", l.local_addr().unwrap());
    std::thread::spawn(move || {
        for conn in l.incoming() {
            let Ok(mut s) = conn else { break };
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            while r.read_line(&mut line).map(|n| n > 0).unwrap_or(false) && line != "\r\n" { line.clear(); }
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len());
        }
    });
    url
}

/// The agent's own browser, driven by the AI through the real tools: it opens a page, fills in
/// a form and submits it, and the AI sees the result. Needs a Chromium-family browser
/// (MINUS_BROWSER=... to point at one); skipped without one.
#[tokio::test(flavor = "multi_thread")]
async fn the_agents_own_browser() {
    let rt = Runtime::new(std::env::temp_dir().join(format!("minus-test-w-{}", std::process::id())));
    if !rt.has_browser() {
        eprintln!("no browser here: skipped");
        return;
    }
    let page = site(r#"<!doctype html><meta charset="utf-8"><title>Voos</title><form onsubmit="event.preventDefault(); out.textContent = 'Resultados para ' + q.value + ': TAP R$ 2.890';"><input id="q" placeholder="Para onde?"><button>Buscar</button></form><p id="out"></p>"#);
    let call = |id: &str, name: &str, args: Value| reply(json!({"role": "assistant", "content": null, "tool_calls": [{"id": id, "type": "function", "function": {"name": name, "arguments": args.to_string()}}]}));
    let (url, seen) = server(vec![
        (200, call("c1", "browser_open", json!({"url": page}))),
        (200, call("c2", "browser_act", json!({"actions": [{"do": "type", "id": 1, "text": "Lisboa"}, {"do": "click", "id": 2}]}))),
        (200, reply(json!({"role": "assistant", "content": "Achei: TAP por R$ 2.890."}))),
    ]);
    let ev = job(&rt, brain(&url), "Procura voos pra Lisboa");
    let seen = seen.lock().unwrap();
    let tool_text = |i: usize| seen[i].body["messages"].as_array().unwrap().iter().rev().find(|m| m["role"] == "tool").map(|m| m["content"].as_str().unwrap_or("").to_string()).unwrap_or_default();
    // after opening: the page as numbered things to use
    assert!(tool_text(1).contains("[1] text box \"Para onde?\"") && tool_text(1).contains("[2] button \"Buscar\""), "{}", tool_text(1));
    // after typing and clicking: the result is on the page
    assert!(tool_text(2).contains("Resultados para Lisboa: TAP R$ 2.890"), "{}", tool_text(2));
    // each step showed up, and the app heard where the browser went
    assert!(ev.iter().any(|e| matches!(e, Event::Step { text } if text == "Clicked “Buscar”")), "{ev:?}");
    assert!(ev.iter().any(|e| matches!(e, Event::Browse { title, .. } if title == "Voos")), "{ev:?}");
    assert!(rt.browser_frame("a1").await.is_some_and(|f| f.0.len() > 1000 && f.2 == "Voos"));
    assert!(matches!(ev.last(), Some(Event::Done { .. })));
}
