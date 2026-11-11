//! "Does this key work?" One small, real request to the provider when you connect it, so a
//! wrong key is caught right there (with the provider's own reason), and the list of models
//! your account can use comes back with it.

use crate::{anthropic, openai, Brain};
use serde_json::Value;

fn reason(text: &str) -> String {
    crate::api_message(text)
}

fn ids(text: &str) -> Vec<String> {
    let v: Value = serde_json::from_str(text).unwrap_or_default();
    let list = v["data"].as_array().or(v["models"].as_array()).cloned().unwrap_or_default();
    let mut out: Vec<String> = list
        .iter()
        .filter_map(|m| m["id"].as_str().or(m["name"].as_str()).or(m["model"].as_str()))
        .map(|s| s.trim_start_matches("models/").to_string())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Checks the key in `brain` with the provider and returns the models it can use (empty when
/// the provider doesn't list them). The error is ready to show to the person.
pub async fn check(http: &reqwest::Client, brain: &Brain, name: &str) -> Result<Vec<String>, String> {
    let anthropic = brain.provider == "anthropic";
    let req = if anthropic {
        http.get("https://api.anthropic.com/v1/models?limit=1000").header("x-api-key", &brain.key).header("anthropic-version", anthropic::VERSION)
    } else {
        let r = http.get(format!("{}/models", openai::base_url(brain)));
        if brain.key.is_empty() { r } else { r.bearer_auth(&brain.key) }
    };
    let resp = req.timeout(std::time::Duration::from_secs(25)).send().await.map_err(|e| unreachable(name, brain, &e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    match status {
        200 => Ok(ids(&text)),
        401 | 403 => Err(format!("{name} didn't accept this key: {}", reason(&text))),
        400 if reason(&text).to_lowercase().contains("key") => Err(format!("{name} didn't accept this key: {}", reason(&text))),
        // no model list here: try the smallest possible real request instead
        404 | 405 if !anthropic => probe(http, brain, name).await.map(|_| Vec::new()),
        429 => Ok(Vec::new()), // the key works; the account is just busy right now
        _ => Err(format!("{name} answered with an error ({status}): {}", reason(&text))),
    }
}

async fn probe(http: &reqwest::Client, brain: &Brain, name: &str) -> Result<(), String> {
    let body = serde_json::json!({"model": brain.model, "messages": [{"role": "user", "content": "Say OK."}], "max_tokens": 5});
    let mut req = http.post(format!("{}/chat/completions", openai::base_url(brain))).json(&body).timeout(std::time::Duration::from_secs(40));
    if !brain.key.is_empty() {
        req = req.bearer_auth(&brain.key);
    }
    let resp = req.send().await.map_err(|e| unreachable(name, brain, &e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    match status {
        200 | 429 => Ok(()),
        401 | 403 => Err(format!("{name} didn't accept this key: {}", reason(&text))),
        404 => Err(format!("{name} doesn't have the model \"{}\": {}", brain.model, reason(&text))),
        _ => Err(format!("{name} answered with an error ({status}): {}", reason(&text))),
    }
}

fn unreachable(name: &str, brain: &Brain, e: &reqwest::Error) -> String {
    if brain.provider == "ollama" {
        return "Couldn't reach Ollama on this computer. Is it installed and running?".into();
    }
    format!("Couldn't reach {name}. Check the internet connection{}. ({e})", if brain.base_url.is_some() { " and the address" } else { "" })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_lists() {
        assert_eq!(ids(r#"{"object":"list","data":[{"id":"models/gemini-2.5-pro"},{"id":"models/gemini-2.5-flash"}]}"#), vec!["gemini-2.5-flash", "gemini-2.5-pro"]);
        assert_eq!(ids(r#"{"data":[{"id":"claude-opus-5-5","type":"model"}],"has_more":false}"#), vec!["claude-opus-5-5"]);
        assert_eq!(ids(r#"{"models":[{"name":"qwen3:latest","model":"qwen3:latest"}]}"#), vec!["qwen3:latest"]);
    }
    #[test]
    fn reasons() {
        assert_eq!(reason(r#"[{"error":{"code":400,"message":"Invalid Auth key.","status":"INVALID_ARGUMENT"}}]"#), "Invalid Auth key.");
        assert_eq!(reason(r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#), "invalid x-api-key");
    }
}
