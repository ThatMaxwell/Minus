//! Every provider that speaks the OpenAI chat completions format: OpenAI (ChatGPT, Codex
//! models), Google Gemini, xAI Grok, OpenRouter (Llama and many more), Ollama on this
//! computer, and any custom OpenAI-compatible endpoint.
//! These agents use the element tools (look, act, ...); pixel-level computer use is Claude's.

use crate::{AgentError, Brain, Call, CallResult, Stop, Turn};
use serde_json::{json, Value};

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

fn tools() -> Vec<Value> {
    crate::tools::custom_tools()
        .into_iter()
        .map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}))
        .collect()
}

pub async fn turn(http: &reqwest::Client, brain: &Brain, system: &str, history: &[Value]) -> Result<Turn, AgentError> {
    let mut messages = vec![json!({"role": "system", "content": system})];
    messages.extend(history.iter().flat_map(|m| {
        // tool results are stored as one message holding a list; this format wants one each
        if m["role"] == "tool_batch" { m["items"].as_array().cloned().unwrap_or_default() } else { vec![m.clone()] }
    }));
    let body = json!({"model": brain.model, "messages": messages, "tools": tools()});
    let mut req = http.post(format!("{}/chat/completions", base_url(brain))).json(&body);
    if !brain.key.is_empty() {
        req = req.bearer_auth(&brain.key);
    }
    if brain.provider == "openrouter" || brain.provider == "llama" {
        req = req.header("X-Title", "Minus");
    }
    let mut last = String::new();
    for attempt in 1..=4 {
        let resp = req.try_clone().expect("plain body").send().await.map_err(|e| AgentError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if status == 200 {
            return parse(&text);
        }
        let msg = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["error"]["message"].as_str().map(String::from)).unwrap_or(text);
        last = match status {
            401 | 403 => format!("{} didn't accept the API key. Check it in Settings → Your AI.", brain.provider),
            404 => format!("{} doesn't have the model \"{}\": {msg}", brain.provider, brain.model),
            _ => format!("{}: {msg}", brain.provider),
        };
        if status == 429 || status >= 500 {
            tokio::time::sleep(std::time::Duration::from_millis(1500 * attempt)).await;
            continue;
        }
        break;
    }
    Err(AgentError::Api(last))
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
