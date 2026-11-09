//! Ask the room: one question to several agents at once. Each answers with its own AI (so a
//! Claude agent and a GPT agent can really disagree), from its own job and notebook, without
//! touching the computer. Then they can answer each other, and one of them can sum it up.

use crate::{anthropic, faces, openai, AgentError, AgentSpec, Brain};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct Answer {
    pub text: String,
    /// the face it chose while answering, if any
    pub face: Option<String>,
    pub input: u64,
    pub output: u64,
}

fn system(a: &AgentSpec, notes: &str) -> String {
    format!(
        "You are {name}, an AI agent on the person's team in Minus. Your job: {role}.{instr}\n\
         The person asked the whole team a question in a meeting, and every agent answers in turn. \
         Answer from your job and what you know, in your own voice: 2 to 4 sentences, plain words, no preamble, no lists. \
         Say what you'd do and why. If you see it differently from the others, say so plainly; agreeing for the sake of it doesn't help the person. \
         If it's outside your job, say so in one sentence and who on the team would know.\n\
         {notes}\
         You can show how you feel with a hidden face code like <[[curious] or <[[worried]; the person only sees your face change. Faces: {faces}.",
        name = a.name,
        role = if a.role.is_empty() { "whatever the person asks" } else { &a.role },
        instr = if a.instructions.trim().is_empty() { String::new() } else { format!(" Their instructions for you: {}", a.instructions.trim()) },
        notes = if notes.trim().is_empty() { String::new() } else { format!("{}\n", notes.trim()) },
        faces = crate::FACES.join(", "),
    )
}

fn prompt(question: &str, others: &[(String, String)], round: u8) -> String {
    if others.is_empty() {
        return format!("The question: {question}");
    }
    let said = others.iter().map(|(n, t)| format!("- {n}: {t}")).collect::<Vec<_>>().join("\n");
    if round >= 2 {
        format!("The question: {question}\n\nWhat everyone said:\n{said}\n\nNow reply to the others in 1 to 3 sentences: where you agree, where you don't, and whether you'd change your answer.")
    } else {
        format!("The question: {question}\n\nWhat the agents before you said:\n{said}\n\nYour answer:")
    }
}

/// One agent's answer. `others` are what the others said (for round 2, or to build on).
pub async fn answer(http: &reqwest::Client, brain: &Brain, spec: &AgentSpec, notes: &str, question: &str, others: &[(String, String)], round: u8) -> Result<Answer, AgentError> {
    let (text, input, output) = complete(http, brain, &system(spec, notes), &prompt(question, others, round), 700).await?;
    let (text, found) = faces(&text);
    Ok(Answer { text, face: found.last().cloned(), input, output })
}

/// Where they agree, where they differ, and what to do: written by the agent you pick.
pub async fn sum_up(http: &reqwest::Client, brain: &Brain, spec: &AgentSpec, question: &str, said: &[(String, String)]) -> Result<Answer, AgentError> {
    let all = said.iter().map(|(n, t)| format!("- {n}: {t}")).collect::<Vec<_>>().join("\n");
    let sys = format!("You are {}, an AI agent in Minus, writing a short summary of a team discussion for the person. Be fair to every view, including ones you disagree with. Plain words.", spec.name);
    let user = format!("The question: {question}\n\nWhat the team said:\n{all}\n\nWrite three short parts, each one or two sentences, starting with these words exactly:\nAgree: ...\nDiffer: ...\nSuggest: ...");
    let (text, input, output) = complete(http, brain, &sys, &user, 600).await?;
    let (text, _) = faces(&text);
    Ok(Answer { text, face: None, input, output })
}

/// A single answer, no tools.
async fn complete(http: &reqwest::Client, brain: &Brain, system: &str, user: &str, max_tokens: u32) -> Result<(String, u64, u64), AgentError> {
    let anthropic = brain.provider == "anthropic";
    let (url, body) = if anthropic {
        (anthropic::URL.to_string(), json!({"model": brain.model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": user}]}))
    } else {
        (format!("{}/chat/completions", openai::base_url(brain)), json!({"model": brain.model, "max_tokens": max_tokens, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}))
    };
    let mut req = http.post(url).json(&body);
    if anthropic {
        req = req.header("x-api-key", &brain.key).header("anthropic-version", anthropic::VERSION);
    } else if !brain.key.is_empty() {
        req = req.bearer_auth(&brain.key);
    }
    let mut last = String::new();
    for attempt in 1..=3u64 {
        let resp = req.try_clone().expect("plain body").send().await.map_err(|e| AgentError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if status == 200 {
            return Ok(if anthropic {
                let t = v["content"].as_array().map(|c| c.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("")).unwrap_or_default();
                (t.trim().to_string(), v["usage"]["input_tokens"].as_u64().unwrap_or(0), v["usage"]["output_tokens"].as_u64().unwrap_or(0))
            } else {
                (v["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_string(), v["usage"]["prompt_tokens"].as_u64().unwrap_or(0), v["usage"]["completion_tokens"].as_u64().unwrap_or(0))
            });
        }
        let msg = v["error"]["message"].as_str().map(String::from).unwrap_or(text);
        last = match status {
            401 | 403 => format!("{} didn't accept the API key. Check it in Settings → Your AI.", brain.provider),
            404 => format!("{} doesn't have the model \"{}\".", brain.provider, brain.model),
            _ => format!("{}: {msg}", brain.provider),
        };
        if status == 429 || status >= 500 {
            tokio::time::sleep(std::time::Duration::from_millis(1200 * attempt)).await;
            continue;
        }
        break;
    }
    Err(AgentError::Api(last))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_two_shows_everyone() {
        let p = prompt("Which CRM?", &[("Scout".into(), "Keep Acme.".into()), ("Ledger".into(), "Cheaper to switch.".into())], 2);
        assert!(p.contains("- Scout: Keep Acme.") && p.contains("reply to the others"));
        assert_eq!(prompt("Hi?", &[], 1), "The question: Hi?");
    }
}
