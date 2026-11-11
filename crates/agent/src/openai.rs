//! Every provider that speaks the OpenAI chat completions format: OpenAI (ChatGPT, Codex
//! models), Google Gemini, xAI Grok, OpenRouter (Llama and many more), Ollama on this
//! computer, and any custom OpenAI-compatible endpoint.
//! These agents use the element tools (look, act, ...); pixel-level computer use is Claude's.

use crate::{AgentError, Brain, Call, CallResult, Event, Stop, Turn};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

type Emit = Arc<dyn Fn(Event) + Send + Sync>;

pub fn base_url(b: &Brain) -> String {
    if let Some(u) = b.base_url.as_ref().filter(|u| !u.trim().is_empty()) {
        return u.trim_end_matches('/').to_string();
    }
    match b.provider.as_str() {
        "openai" | "chatgpt" | "codex" => "https://api.openai.com/v1",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai",
        "grok" | "xai" => "https://api.x.ai/v1",
        "openrouter" | "llama" => "https://openrouter.ai/api/v1",
        "ollama" => "http://localhost:11434/v1",
        _ => "https://api.openai.com/v1",
    }
    .to_string()
}

fn tools(computer: bool) -> Vec<Value> {
    crate::tools::custom_tools(computer)
        .into_iter()
        .map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}))
        .collect()
}

/// Optional request features, switched off one by one if a provider turns them down.
#[derive(Default)]
pub struct Compat {
    no_stream: bool,
    no_effort: bool,
    no_usage: bool,
}

pub async fn turn(http: &reqwest::Client, brain: &Brain, system: &str, history: &[Value], computer: bool, compat: &mut Compat, emit: &Emit, stop: &Arc<AtomicBool>) -> Result<Turn, AgentError> {
    let mut messages = vec![json!({"role": "system", "content": system})];
    messages.extend(history.iter().flat_map(|m| {
        // tool results are stored as one message holding a list; this format wants one each
        if m["role"] == "tool_batch" { m["items"].as_array().cloned().unwrap_or_default() } else { vec![m.clone()] }
    }));
    let name = crate::provider_name(&brain.provider);
    let mut attempt = 0;
    let last = loop {
        attempt += 1;
        let mut body = json!({"model": brain.model, "messages": messages, "tools": tools(computer)});
        if !compat.no_stream {
            // streamed, so the reply shows up as it's written instead of all at once at the end
            body["stream"] = json!(true);
            if !compat.no_usage && matches!(brain.provider.as_str(), "openai" | "chatgpt" | "codex" | "openrouter" | "llama") {
                body["stream_options"] = json!({"include_usage": true});
            }
        }
        // how hard it thinks: lower is faster (Gemini and OpenAI's reasoning models take this)
        if let (false, Some(e), true) = (compat.no_effort, brain.effort.as_deref(), matches!(brain.provider.as_str(), "gemini" | "openai" | "chatgpt" | "codex")) {
            body["reasoning_effort"] = json!(e);
        }
        let mut req = http.post(format!("{}/chat/completions", base_url(brain))).json(&body);
        if !brain.key.is_empty() {
            req = req.bearer_auth(&brain.key);
        }
        if brain.provider == "openrouter" || brain.provider == "llama" {
            req = req.header("X-Title", "Minus");
        }
        let resp = req.send().await.map_err(|e| AgentError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        if status == 200 {
            let streamed = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|c| c.contains("event-stream"));
            if streamed {
                return read_stream(resp, emit, stop).await;
            }
            return parse(&resp.text().await.unwrap_or_default());
        }
        let text = resp.text().await.unwrap_or_default();
        let msg = crate::api_message(&text);
        let low = msg.to_lowercase();
        // a feature this provider doesn't take: switch it off and send again
        if status == 400 && attempt <= 4 {
            let off = if low.contains("reasoning") && !compat.no_effort { compat.no_effort = true; true }
                else if low.contains("stream_options") && !compat.no_usage { compat.no_usage = true; true }
                else if low.contains("stream") && !compat.no_stream { compat.no_stream = true; true }
                else { false };
            if off { continue; }
        }
        let last = match status {
            401 | 403 => format!("{name} didn't accept the API key ({msg}). Check it in Settings → Your AI."),
            400 if low.contains("key") => format!("{name} didn't accept the API key ({msg}). Check it in Settings → Your AI."),
            404 => format!("{name} doesn't have the model \"{}\": {msg}", brain.model),
            429 => format!("{name}'s rate limit was reached ({msg}). Try again in a minute."),
            _ => format!("{name}: {msg}"),
        };
        if (status == 429 || status >= 500) && attempt < 4 {
            tokio::time::sleep(std::time::Duration::from_millis(1500 * attempt as u64)).await;
            continue;
        }
        break last;
    };
    Err(AgentError::Api(last))
}

/// One tool call, put together from the pieces it streams in.
#[derive(Default)]
struct Partial {
    id: String,
    name: String,
    args: String,
    extra: Option<Value>,
}

/// Reads a streamed reply: the text goes out live as it grows (Draft), tool calls are put back
/// together piece by piece, and anything extra the provider attaches (Gemini's thought
/// signatures, which it needs back on the next request) is kept exactly.
async fn read_stream(resp: reqwest::Response, emit: &Emit, stop: &Arc<AtomicBool>) -> Result<Turn, AgentError> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let (mut text, mut finish, mut extra) = (String::new(), String::new(), None::<Value>);
    let mut parts: Vec<Partial> = Vec::new();
    let mut usage = (0u64, 0u64);
    // the first words show at once, then about five updates a second
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
            if data == "[DONE]" {
                break 'read;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            if v.get("error").is_some() {
                return Err(AgentError::Api(crate::api_message(data)));
            }
            if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
                usage = (u["prompt_tokens"].as_u64().unwrap_or(usage.0), u["completion_tokens"].as_u64().unwrap_or(usage.1));
            }
            let c = &v["choices"][0];
            let d = &c["delta"];
            if let Some(t) = d["content"].as_str() {
                text.push_str(t);
                if shown.0.elapsed().as_millis() > 180 && text.len() > shown.1 {
                    emit(Event::Draft { text: text.clone() });
                    shown = (std::time::Instant::now(), text.len());
                }
            }
            if let Some(x) = d.get("extra_content").filter(|x| !x.is_null()) {
                extra = Some(x.clone());
            }
            for tc in d["tool_calls"].as_array().cloned().unwrap_or_default() {
                // a piece of call number `index` (some providers leave the index out: then it's by order)
                let i = tc["index"].as_u64().map(|i| i as usize).unwrap_or(if tc["id"].is_string() { parts.len() } else { parts.len().max(1) - 1 });
                while parts.len() <= i {
                    parts.push(Partial::default());
                }
                let p = &mut parts[i];
                if let Some(id) = tc["id"].as_str().filter(|s| !s.is_empty()) {
                    p.id = id.to_string();
                }
                if let Some(n) = tc["function"]["name"].as_str() {
                    if p.name.is_empty() { p.name = n.to_string() } else if !p.name.ends_with(n) { p.name.push_str(n) }
                }
                if let Some(a) = tc["function"]["arguments"].as_str() {
                    p.args.push_str(a);
                }
                if let Some(x) = tc.get("extra_content").filter(|x| !x.is_null()) {
                    p.extra = Some(x.clone());
                }
            }
            if let Some(f) = c["finish_reason"].as_str() {
                finish = f.to_string();
            }
        }
    }
    if usage.0 + usage.1 > 0 {
        emit(Event::Usage { input: usage.0, output: usage.1, cache_read: 0 });
    }
    // the same shape a non-streamed reply has, so both go through `parse`
    let calls: Vec<Value> = parts
        .into_iter()
        .enumerate()
        .filter(|(_, p)| !p.name.is_empty())
        .map(|(n, p)| {
            let mut c = json!({"id": if p.id.is_empty() { format!("call_{n}") } else { p.id }, "type": "function", "function": {"name": p.name, "arguments": p.args}});
            if let Some(x) = p.extra { c["extra_content"] = x; }
            c
        })
        .collect();
    let mut msg = json!({"role": "assistant", "content": if text.is_empty() && !calls.is_empty() { Value::Null } else { json!(text) }});
    if !calls.is_empty() { msg["tool_calls"] = json!(calls); }
    if let Some(x) = extra { msg["extra_content"] = x; }
    parse(&json!({"choices": [{"message": msg, "finish_reason": finish}]}).to_string())
}

fn parse(text: &str) -> Result<Turn, AgentError> {
    let v: Value = serde_json::from_str(text).map_err(|e| AgentError::Api(format!("unexpected reply: {e}")))?;
    let choice = &v["choices"][0];
    let msg = choice["message"].clone();
    let mut calls = Vec::new();
    for tc in msg["tool_calls"].as_array().cloned().unwrap_or_default() {
        let args = tc["function"]["arguments"].as_str().unwrap_or("{}");
        let (input, invalid) = match serde_json::from_str::<Value>(if args.trim().is_empty() { "{}" } else { args }) {
            Ok(v) if v.is_object() => (v, None),
            _ => (json!({}), Some(args.to_string())),
        };
        calls.push(Call { id: tc["id"].as_str().unwrap_or("").into(), name: tc["function"]["name"].as_str().unwrap_or("").into(), input, toolset: None, invalid });
    }
    let stop = match choice["finish_reason"].as_str().unwrap_or("") {
        "tool_calls" => Stop::Tools,
        "length" => Stop::Cut,
        "content_filter" => Stop::Refused("content filter".into()),
        _ if !calls.is_empty() => Stop::Tools,
        _ => Stop::Done,
    };
    let text = msg["content"].as_str().unwrap_or("").to_string();
    // keep only what the API accepts back
    let mut message = json!({"role": "assistant", "content": msg["content"].clone()});
    if msg.get("tool_calls").is_some_and(|t| t.is_array()) {
        message["tool_calls"] = msg["tool_calls"].clone();
    }
    // Gemini's thought signature for a reply without tool calls: it wants it back as it came
    if let Some(x) = msg.get("extra_content").filter(|x| !x.is_null()) {
        message["extra_content"] = x.clone();
    }
    Ok(Turn { message, calls, text, stop })
}

pub fn results(rs: Vec<CallResult>) -> Value {
    let items: Vec<Value> = rs
        .into_iter()
        .map(|r| {
            let content = match r.content {
                Value::String(s) => s,
                other => other.to_string(),
            };
            json!({"role": "tool", "tool_call_id": r.id, "content": if r.is_error { format!("Error: {content}") } else { content }})
        })
        .collect();
    json!({"role": "tool_batch", "items": items})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_tool_calls() {
        let t = parse(r#"{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"look","arguments":"{\"window\":\"notepad.exe\"}"}}]}}]}"#).unwrap();
        assert_eq!(t.calls.len(), 1);
        assert_eq!(t.calls[0].input["window"], "notepad.exe");
        assert!(matches!(t.stop, Stop::Tools));
    }
    #[test]
    fn endpoints() {
        let b = |p: &str| Brain { provider: p.into(), model: "m".into(), key: String::new(), effort: None, base_url: None };
        assert!(base_url(&b("gemini")).contains("googleapis"));
        assert!(base_url(&b("ollama")).starts_with("http://localhost:11434"));
    }
}
