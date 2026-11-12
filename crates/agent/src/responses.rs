//! Your ChatGPT plan ("Sign in with ChatGPT"): OpenAI's Responses API, paid for by the
//! person's own Plus or Pro plan instead of an API key. The plan route has its own rules:
//! nothing stored on OpenAI's side (`store: false`), always streamed, instructions instead of a
//! system message, the whole history sent each time, and tools grouped in a namespace.

use crate::{AgentError, Brain, Call, Event, Stop, Turn};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

type Emit = Arc<dyn Fn(Event) + Send + Sync>;
const NS: &str = "minus";

fn base(b: &Brain) -> String {
    b.base_url.as_ref().filter(|u| !u.trim().is_empty()).map(|u| u.trim_end_matches('/').to_string()).unwrap_or_else(|| "https://api.openai.com/v1".into())
}

fn tools(computer: bool, browser: bool, shell: bool) -> Value {
    let fns: Vec<Value> = crate::tools::custom_tools(computer, browser, shell)
        .into_iter()
        .map(|t| json!({"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"]}))
        .collect();
    json!([{"type": "namespace", "name": NS, "description": "Minus: the person's computer, the web, and talking with the person.", "tools": fns}])
}

/// Optional request parts, switched off if the plan route turns them down.
#[derive(Default)]
pub struct Compat {
    no_effort: bool,
    no_reasoning_items: bool,
}

/// The history as Responses input: user messages as they are, our stored output items, and
/// tool results as function_call_output items.
fn input(history: &[Value], keep_reasoning: bool) -> Vec<Value> {
    let mut out = Vec::new();
    for m in history {
        match m["role"].as_str() {
            Some("responses_batch") => {
                for it in m["items"].as_array().cloned().unwrap_or_default() {
                    if it["type"] == "reasoning" && (!keep_reasoning || it["encrypted_content"].is_null()) {
                        continue;
                    }
                    out.push(it);
                }
            }
            Some("tool_batch") => {
                for r in m["items"].as_array().cloned().unwrap_or_default() {
                    if r["role"] == "user" {
                        let parts: Vec<Value> = r["content"].as_array().cloned().unwrap_or_default().into_iter().map(|p| if p["type"] == "image_url" { json!({"type": "input_image", "image_url": p["image_url"]["url"]}) } else { json!({"type": "input_text", "text": p["text"]}) }).collect();
                        out.push(json!({"role": "user", "content": parts}));
                        continue;
                    }
                    out.push(json!({"type": "function_call_output", "call_id": r["tool_call_id"], "output": r["content"]}));
                }
            }
            _ => out.push(json!({"role": m["role"], "content": m["content"]})),
        }
    }
    out
}

pub async fn turn(http: &reqwest::Client, brain: &Brain, system: &str, history: &[Value], computer: bool, browser: bool, shell: bool, compat: &mut Compat, emit: &Emit, stop: &Arc<AtomicBool>) -> Result<Turn, AgentError> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let mut body = json!({
            "model": brain.model, "instructions": system, "input": input(history, !compat.no_reasoning_items),
            "tools": tools(computer, browser, shell), "store": false, "stream": true,
        });
        if !compat.no_reasoning_items {
            // with nothing kept on OpenAI's side, its thinking comes back sealed so it can continue it
            body["include"] = json!(["reasoning.encrypted_content"]);
        }
        if let (false, Some(e)) = (compat.no_effort, brain.effort.as_deref()) {
            body["reasoning"] = json!({"effort": e});
        }
        let resp = http.post(format!("{}/responses", base(brain))).bearer_auth(&brain.key).json(&body).send().await.map_err(|e| AgentError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        if status == 200 {
            return read(resp, emit, stop).await;
        }
        let text = resp.text().await.unwrap_or_default();
        let msg = crate::api_message(&text);
        let low = msg.to_lowercase();
        if status == 400 && attempt <= 3 {
            if (low.contains("reasoning") || low.contains("effort")) && !low.contains("encrypted") && !compat.no_effort { compat.no_effort = true; continue; }
            if (low.contains("include") || low.contains("encrypted") || low.contains("not found")) && !compat.no_reasoning_items { compat.no_reasoning_items = true; continue; }
        }
        if (status == 429 || status >= 500) && attempt < 3 && !low.contains("usage") {
            tokio::time::sleep(std::time::Duration::from_millis(1500 * attempt as u64)).await;
            continue;
        }
        return Err(AgentError::Api(match status {
            401 | 403 => format!("Your ChatGPT sign-in needs renewing ({msg}). Sign in again in Settings → Your AI."),
            404 => format!("Your ChatGPT plan doesn't have the model \"{}\" ({msg}). Pick another one in the agent's chat.", brain.model),
            429 => limit(&msg),
            _ => format!("ChatGPT: {msg}"),
        }));
    }
}

fn limit(msg: &str) -> String {
    format!("Your ChatGPT plan's allowance is used up for now{}. It refills by itself; see chatgpt.com/settings/usage, or give this agent another AI meanwhile.", if msg.is_empty() { String::new() } else { format!(" ({msg})") })
}

/// Reads the stream: words go out live as they're written, and the finished reply's items are
/// kept exactly (they go back with the next request).
async fn read(resp: reqwest::Response, emit: &Emit, stop: &Arc<AtomicBool>) -> Result<Turn, AgentError> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut text = String::new();
    let mut items: Vec<Value> = Vec::new();
    let mut done: Option<Value> = None;
    let mut shown = (std::time::Instant::now() - std::time::Duration::from_secs(1), 0usize);
    'read: while let Some(chunk) = stream.next().await {
        if stop.load(Ordering::SeqCst) {
            return Err(AgentError::Stopped);
        }
        buf.extend_from_slice(&chunk.map_err(|e| AgentError::Network(e.to_string()))?);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else { continue };
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            match v["type"].as_str().unwrap_or("") {
                "response.output_text.delta" => {
                    text.push_str(v["delta"].as_str().unwrap_or(""));
                    if shown.0.elapsed().as_millis() > 180 && text.len() > shown.1 {
                        emit(Event::Draft { text: text.clone() });
                        shown = (std::time::Instant::now(), text.len());
                    }
                }
                "response.output_item.done" => items.push(v["item"].clone()),
                "response.completed" | "response.incomplete" => {
                    done = Some(v["response"].clone());
                    break 'read;
                }
                "response.failed" => {
                    let e = &v["response"]["error"];
                    let code = e["code"].as_str().unwrap_or("");
                    let m = e["message"].as_str().unwrap_or("").to_string();
                    return Err(AgentError::Api(if code.starts_with("subscription_sharing") { limit(&m) } else { format!("ChatGPT couldn't finish this ({})", if m.is_empty() { code.to_string() } else { m }) }));
                }
                "error" => return Err(AgentError::Api(format!("ChatGPT: {}", v["message"].as_str().or(v["error"]["message"].as_str()).unwrap_or("something went wrong")))),
                _ => {}
            }
        }
    }
    let r = done.ok_or_else(|| AgentError::Network("ChatGPT's reply was cut off before it finished. Try again.".into()))?;
    if let Some(u) = r.get("usage").filter(|u| u.is_object()) {
        emit(Event::Usage { input: u["input_tokens"].as_u64().unwrap_or(0), output: u["output_tokens"].as_u64().unwrap_or(0), cache_read: u["input_tokens_details"]["cached_tokens"].as_u64().unwrap_or(0) });
    }
    // the finished response lists every item; the stream's own list is the fallback
    let out = r["output"].as_array().filter(|a| !a.is_empty()).cloned().unwrap_or(items);
    Ok(parse(out, text))
}

pub(crate) fn parse(out: Vec<Value>, streamed: String) -> Turn {
    let mut calls = Vec::new();
    let mut text = String::new();
    for it in &out {
        match it["type"].as_str() {
            Some("function_call") => {
                let raw = it["name"].as_str().unwrap_or("");
                // the namespace may come along with the name ("minus.web_search") or apart from it
                let name = raw.strip_prefix("minus.").or_else(|| raw.strip_prefix("minus__")).unwrap_or(raw).to_string();
                let args = it["arguments"].as_str().unwrap_or("{}");
                let (input, invalid) = match serde_json::from_str::<Value>(if args.trim().is_empty() { "{}" } else { args }) {
                    Ok(v) => (v, None),
                    Err(_) => (json!({}), Some(args.to_string())),
                };
                calls.push(Call { id: it["call_id"].as_str().unwrap_or("").to_string(), name, input, toolset: None, invalid });
            }
            Some("message") => {
                for c in it["content"].as_array().cloned().unwrap_or_default() {
                    if let Some(t) = c["text"].as_str() {
                        text.push_str(t);
                    }
                }
            }
            _ => {}
        }
    }
    if text.is_empty() {
        text = streamed;
    }
    let stop = if calls.is_empty() { Stop::Done } else { Stop::Tools };
    Turn { message: json!({"role": "responses_batch", "items": out}), calls, text, stop }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_goes_back_as_items() {
        let h = vec![
            json!({"role": "user", "content": "Find flights"}),
            json!({"role": "responses_batch", "items": [{"type": "reasoning", "id": "rs_1", "encrypted_content": "xyz"}, {"type": "function_call", "call_id": "c1", "name": "web_search", "namespace": "minus", "arguments": "{\"query\":\"flights\"}"}]}),
            json!({"role": "tool_batch", "items": [{"role": "tool", "tool_call_id": "c1", "content": "3 results"}]}),
        ];
        let i = input(&h, true);
        assert_eq!(i.len(), 4);
        assert_eq!(i[3], json!({"type": "function_call_output", "call_id": "c1", "output": "3 results"}));
        assert_eq!(input(&h, false).len(), 3); // sealed thinking left out when it's turned down
    }
    #[test]
    fn reads_calls_and_words() {
        let t = parse(vec![json!({"type": "function_call", "call_id": "c9", "name": "minus.read_page", "arguments": "{\"url\":\"https://x.io\"}"})], String::new());
        assert_eq!(t.calls[0].name, "read_page");
        assert!(matches!(t.stop, Stop::Tools));
        let t = parse(vec![json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Pronto!"}]})], String::new());
        assert_eq!(t.text, "Pronto!");
        assert!(matches!(t.stop, Stop::Done));
    }
}
