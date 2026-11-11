//! Claude through the Messages API (raw HTTP: there's no official Rust SDK).
//!
//! Per request:
//! - streaming, so progress shows while the model works, and long turns don't time out
//! - adaptive thinking with `display: "updates"`: the model's short notes between tool calls
//!   come back as text we show as progress, while its reasoning stays hidden
//! - effort set explicitly (Opus 5.5's default is `medium`; the agent's setting wins)
//! - server-side fallback (`fallbacks: "default"`): if a safety check declines a request,
//!   Anthropic reruns it on the model it recommends instead of failing the job
//! - old tool results (screenshots, outlines) are cleared by the API as the conversation
//!   grows, and the whole prefix is cached, so long jobs stay fast and cheap
//! - the history is append-only and every block goes back exactly as it came
//! If the API turns down one of the optional features (an older model, a beta that ended),
//! that feature is switched off and the request is sent again.

use crate::{AgentError, Brain, Call, CallResult, Event, Stop, Turn};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub(crate) const URL: &str = "https://api.anthropic.com/v1/messages";
pub(crate) const VERSION: &str = "2026-10-21";

/// Optional features, switched off one by one if the API rejects them.
#[derive(Default)]
pub struct Compat {
    no_updates: bool,
    no_binding: bool,
    no_fallbacks: bool,
    no_context_edits: bool,
    no_computer: bool,
    no_effort: bool,
    no_cache: bool,
    no_eager: bool,
}

fn body(brain: &Brain, system: &str, messages: &[Value], c: &Compat, computer: bool, browser: bool, shell: bool) -> (Value, Vec<&'static str>) {
    let mut betas = Vec::new();
    let mut tools: Vec<Value> = crate::tools::custom_tools(computer, browser, shell);
    if !c.no_eager {
        for t in tools.iter_mut() {
            t["eager_input_streaming"] = json!(true);
        }
    }
    if computer && !c.no_computer {
        tools.push(json!({"type": "computer_toolset_20260801", "configs": {"zoom": {"enabled": false}}}));
    }
    let mut thinking = json!({"type": "adaptive"});
    if !c.no_updates {
        thinking["display"] = json!("updates");
        betas.push("thinking-display-updates-2026-08-18");
    }
    if !c.no_binding {
        // our history is append-only; if anything ever differs, drop the old reasoning
        // block instead of failing the job
        thinking["block_binding"] = json!({"prefix_mismatch_behavior": "drop_block"});
        betas.push("thinking-binding-controls-2026-08-01");
    }
    let mut b = json!({
        "model": brain.model,
        "max_tokens": 64000,
        "stream": true,
        "system": [{"type": "text", "text": system}],
        "tools": tools,
        "messages": messages,
        "thinking": thinking,
    });
    if !c.no_effort {
        b["output_config"] = json!({"effort": brain.effort.clone().unwrap_or_else(|| "medium".into())});
    }
    if !c.no_fallbacks {
        b["fallbacks"] = json!("default");
        betas.push("server-side-fallback-2026-07-01");
    }
    if !c.no_context_edits {
        b["context_management"] = json!({"edits": [{"type": "clear_tool_uses_20250919"}]});
        betas.push("context-management-2025-06-27");
    }
    if !c.no_cache {
        b["cache_control"] = json!({"type": "ephemeral"});
    }
    (b, betas)
}

/// Switches off whatever optional feature an error message points at. False if nothing matched.
fn degrade(c: &mut Compat, msg: &str) -> bool {
    let m = msg.to_lowercase();
    let checks: [(&str, &mut bool); 8] = [
        ("display", &mut c.no_updates),
        ("block_binding", &mut c.no_binding),
        ("fallback", &mut c.no_fallbacks),
        ("context_management", &mut c.no_context_edits),
        ("computer", &mut c.no_computer),
        ("effort", &mut c.no_effort),
        ("cache_control", &mut c.no_cache),
        ("eager_input_streaming", &mut c.no_eager),
    ];
    for (needle, flag) in checks {
        if m.contains(needle) && !*flag {
            *flag = true;
            return true;
        }
    }
    // betas themselves: switch everything optional off at once
    if m.contains("beta") {
        let any = !(c.no_updates && c.no_binding && c.no_fallbacks && c.no_context_edits);
        c.no_updates = true;
        c.no_binding = true;
        c.no_fallbacks = true;
        c.no_context_edits = true;
        return any;
    }
    false
}

fn friendly(status: u16, msg: &str) -> String {
    match status {
        401 => "Anthropic didn't accept the API key. Check it in Settings → Your AI.".into(),
        403 => format!("Anthropic refused the request: {msg}"),
        404 => format!("This model isn't available on your Anthropic account: {msg}"),
        429 => "Anthropic's rate limit was reached. The agent will be ready again in a minute.".into(),
        529 | 503 => "Anthropic is overloaded right now. Try again in a minute.".into(),
        _ => format!("Anthropic: {msg}"),
    }
}

pub async fn turn(http: &reqwest::Client, brain: &Brain, system: &str, messages: &[Value], compat: &mut Compat, computer: bool, browser: bool, shell: bool, emit: &Arc<dyn Fn(Event) + Send + Sync>, stop: &Arc<AtomicBool>) -> Result<Turn, AgentError> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let (b, betas) = body(brain, system, messages, compat, computer, browser, shell);
        let mut req = http.post(URL).header("x-api-key", &brain.key).header("anthropic-version", VERSION).header("content-type", "application/json").json(&b);
        if !betas.is_empty() {
            req = req.header("anthropic-beta", betas.join(","));
        }
        let resp = req.send().await.map_err(|e| AgentError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        if status != 200 {
            let text = resp.text().await.unwrap_or_default();
            let msg = crate::api_message(&text);
            if status == 400 && attempt < 9 && degrade(compat, &msg) {
                continue;
            }
            if (status == 429 || status == 529 || status >= 500) && attempt < 4 {
                tokio::time::sleep(std::time::Duration::from_millis(1500 * attempt as u64)).await;
                continue;
            }
            return Err(AgentError::Api(friendly(status, &msg)));
        }
        return read_stream(resp, emit, stop).await;
    }
}

/// Rebuilds the assistant message from the event stream, block by block, exactly as sent.
async fn read_stream(resp: reqwest::Response, emit: &Arc<dyn Fn(Event) + Send + Sync>, stop: &Arc<AtomicBool>) -> Result<Turn, AgentError> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut message = json!({"role": "assistant", "content": []});
    let mut blocks: Vec<Value> = Vec::new();
    let mut partial: std::collections::HashMap<usize, String> = Default::default();
    let mut stop_reason = String::new();
    let mut refusal = String::new();
    let mut usage = (0u64, 0u64, 0u64);
    let mut shown = std::time::Instant::now() - std::time::Duration::from_secs(1);
    while let Some(chunk) = stream.next().await {
        if stop.load(Ordering::SeqCst) {
            return Err(AgentError::Stopped);
        }
        let chunk = chunk.map_err(|e| AgentError::Network(e.to_string()))?;
        buf.extend_from_slice(&chunk);
        // events are separated by a blank line
        while let Some(pos) = find(&buf, b"\n\n") {
            let raw: Vec<u8> = buf.drain(..pos + 2).collect();
            let text = String::from_utf8_lossy(&raw);
            let data: String = text.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.trim_start()).collect::<Vec<_>>().join("\n");
            if data.is_empty() {
                continue;
            }
            let Ok(ev) = serde_json::from_str::<Value>(&data) else { continue };
            match ev["type"].as_str().unwrap_or("") {
                "message_start" => {
                    let u = &ev["message"]["usage"];
                    usage.0 += u["input_tokens"].as_u64().unwrap_or(0);
                    usage.2 += u["cache_read_input_tokens"].as_u64().unwrap_or(0);
                }
                "content_block_start" => {
                    let i = ev["index"].as_u64().unwrap_or(0) as usize;
                    while blocks.len() <= i {
                        blocks.push(Value::Null);
                    }
                    blocks[i] = ev["content_block"].clone();
                }
                "content_block_delta" => {
                    let i = ev["index"].as_u64().unwrap_or(0) as usize;
                    let d = &ev["delta"];
                    let Some(b) = blocks.get_mut(i) else { continue };
                    match d["type"].as_str().unwrap_or("") {
                        "text_delta" => {
                            append(b, "text", d["text"].as_str().unwrap_or(""));
                            // the reply shows up live as it's written
                            if shown.elapsed().as_millis() > 180 {
                                let t = b["text"].as_str().unwrap_or("").to_string();
                                emit(Event::Draft { text: t });
                                shown = std::time::Instant::now();
                            }
                        }
                        "thinking_delta" => append(b, "thinking", d["thinking"].as_str().unwrap_or("")),
                        "signature_delta" => b["signature"] = d["signature"].clone(),
                        "input_json_delta" => partial.entry(i).or_default().push_str(d["partial_json"].as_str().unwrap_or("")),
                        "citations_delta" => {
                            if let Some(arr) = b.get_mut("citations").and_then(|c| c.as_array_mut()) {
                                arr.push(d["citation"].clone());
                            } else {
                                b["citations"] = json!([d["citation"].clone()]);
                            }
                        }
                        _ => {}
                    }
                }
                "content_block_stop" => {
                    let i = ev["index"].as_u64().unwrap_or(0) as usize;
                    let Some(b) = blocks.get_mut(i) else { continue };
                    if let Some(p) = partial.remove(&i) {
                        // strict parse: a truncated or malformed input must not run
                        match serde_json::from_str::<Value>(if p.trim().is_empty() { "{}" } else { &p }) {
                            Ok(v) if v.is_object() => b["input"] = v,
                            _ => {
                                b["input"] = json!({});
                                b["__invalid"] = json!(p);
                            }
                        }
                    }
                    // progress notes between tool calls arrive as thinking blocks
                    if b["type"] == "thinking" {
                        let t = b["thinking"].as_str().unwrap_or("").trim().to_string();
                        if !t.is_empty() {
                            emit(Event::Note { text: t });
                        }
                    }
                }
                "message_delta" => {
                    if let Some(s) = ev["delta"]["stop_reason"].as_str() {
                        stop_reason = s.to_string();
                    }
                    if let Some(cat) = ev["delta"]["stop_details"]["category"].as_str() {
                        refusal = cat.to_string();
                    }
                    usage.1 += ev["usage"]["output_tokens"].as_u64().unwrap_or(0);
                }
                "error" => {
                    let m = ev["error"]["message"].as_str().unwrap_or("the stream broke").to_string();
                    return Err(AgentError::Api(format!("Anthropic: {m}")));
                }
                _ => {}
            }
        }
    }
    emit(Event::Usage { input: usage.0, output: usage.1, cache_read: usage.2 });
    let mut calls = Vec::new();
    let mut text = String::new();
    for b in blocks.iter_mut().filter(|b| !b.is_null()) {
        match b["type"].as_str().unwrap_or("") {
            "text" => text.push_str(b["text"].as_str().unwrap_or("")),
            "tool_use" => {
                let invalid = b.get("__invalid").and_then(|v| v.as_str()).map(String::from);
                if let Some(o) = b.as_object_mut() {
                    o.remove("__invalid");
                }
                calls.push(Call { id: b["id"].as_str().unwrap_or("").into(), name: b["name"].as_str().unwrap_or("").into(), input: b["input"].clone(), toolset: b["toolset_name"].as_str().map(String::from), invalid });
            }
            _ => {}
        }
    }
    message["content"] = Value::Array(blocks.into_iter().filter(|b| !b.is_null()).collect());
    let stop = match stop_reason.as_str() {
        "tool_use" => Stop::Tools,
        "max_tokens" => Stop::Cut,
        "refusal" => Stop::Refused(refusal),
        "pause_turn" => Stop::Pause,
        _ => Stop::Done,
    };
    Ok(Turn { message, calls, text, stop })
}

fn append(b: &mut Value, field: &str, s: &str) {
    let cur = b[field].as_str().unwrap_or("").to_string();
    b[field] = json!(cur + s);
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

/// Tool results go back in one user message, one block per call, in order.
pub fn results(rs: Vec<CallResult>) -> Value {
    let content: Vec<Value> = rs
        .into_iter()
        .map(|r| {
            let mut v = json!({"type": "tool_result", "tool_use_id": r.id, "content": r.content});
            if r.is_error {
                v["is_error"] = json!(true);
            }
            if let Some(t) = r.toolset {
                v["toolset_name"] = json!(t);
            }
            v
        })
        .collect();
    json!({"role": "user", "content": content})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn brain() -> Brain {
        Brain { provider: "anthropic".into(), model: "claude-opus-5-5".into(), key: "k".into(), effort: Some("medium".into()), base_url: None }
    }
    #[test]
    fn request_shape() {
        let (b, betas) = body(&brain(), "sys", &[json!({"role": "user", "content": "hi"})], &Compat::default(), true, true, false);
        assert_eq!(b["model"], "claude-opus-5-5");
        assert_eq!(b["thinking"]["type"], "adaptive");
        assert_eq!(b["output_config"]["effort"], "medium");
        assert_eq!(b["fallbacks"], "default");
        assert!(b["tools"].as_array().unwrap().iter().any(|t| t["type"] == "computer_toolset_20260801"));
        assert!(b.get("tool_choice").is_none());
        assert!(betas.contains(&"server-side-fallback-2026-07-01"));
    }
    #[test]
    fn degrades_step_by_step() {
        let mut c = Compat::default();
        assert!(degrade(&mut c, "thinking.display: unknown value"));
        assert!(c.no_updates);
        assert!(degrade(&mut c, "tools.6.type: 'computer_toolset_20260801' is not supported"));
        assert!(c.no_computer);
        assert!(!degrade(&mut c, "messages: roles must alternate"));
    }
    #[test]
    fn results_echo_toolset() {
        let v = results(vec![CallResult { id: "t1".into(), content: json!("OK"), is_error: false, toolset: Some("computer".into()) }]);
        assert_eq!(v["content"][0]["toolset_name"], "computer");
    }
}
