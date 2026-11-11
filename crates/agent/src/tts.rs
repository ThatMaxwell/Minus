//! Voices: agents' replies read aloud by the voice service you choose, with your own key.
//!
//! - ElevenLabs: Eleven v3 and newer read voice directions in brackets ("[excited] Done!").
//! - OpenRouter: one key for many speech models (Gemini, GPT, Grok, Voxtral…), each with its voices.
//! - Gemini: Gemini TTS, steered by a style ("cheerful and friendly") for the whole piece.
//!
//! (Groq's Orpheus and the voices that run on this computer live in the app itself.)

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize, Clone, Debug)]
pub struct Spoken {
    /// the sound, base64
    pub audio: String,
    pub mime: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    /// a few words about it ("Upbeat", "British, calm")
    pub about: String,
}

pub const GEMINI_VOICES: &[(&str, &str)] = &[
    ("Zephyr", "Bright"), ("Puck", "Upbeat"), ("Charon", "Informative"), ("Kore", "Firm"), ("Fenrir", "Excitable"), ("Leda", "Youthful"),
    ("Orus", "Firm"), ("Aoede", "Breezy"), ("Callirrhoe", "Easy-going"), ("Autonoe", "Bright"), ("Enceladus", "Breathy"), ("Iapetus", "Clear"),
    ("Umbriel", "Easy-going"), ("Algieba", "Smooth"), ("Despina", "Smooth"), ("Erinome", "Clear"), ("Algenib", "Gravelly"), ("Rasalgethi", "Informative"),
    ("Laomedeia", "Upbeat"), ("Achernar", "Soft"), ("Alnilam", "Firm"), ("Schedar", "Even"), ("Gacrux", "Mature"), ("Pulcherrima", "Forward"),
    ("Achird", "Friendly"), ("Zubenelgenubi", "Casual"), ("Vindemiatrix", "Gentle"), ("Sadachbia", "Lively"), ("Sadaltager", "Knowledgeable"), ("Sulafat", "Warm"),
];
pub const GEMINI_TTS: &str = "gemini-3.8-flash-tts";
pub const ELEVEN_MODEL: &str = "eleven_v3";
pub const OPENROUTER_TTS: &str = "google/gemini-3.8-flash-tts";

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}

/// Bracketed voice directions ("[cheerful]") out of the text, and the last one, as a style.
pub fn directions(text: &str) -> (String, Option<String>) {
    let mut out = String::with_capacity(text.len());
    let mut style = None;
    let mut rest = text;
    while let Some(i) = rest.find('[') {
        let after = &rest[i + 1..];
        match after.find(']').filter(|&j| j > 0 && j <= 24 && after[..j].chars().all(|c| c.is_alphabetic() || c == ' ' || c == '-')) {
            // a Markdown link: its words are read, its address isn't
            Some(j) if after[j + 1..].starts_with('(') => {
                out.push_str(&rest[..i]);
                out.push_str(&after[..j]);
                let tail = &after[j + 1..];
                rest = tail.find(')').map(|k| &tail[k + 1..]).unwrap_or(tail);
            }
            Some(j) => {
                out.push_str(&rest[..i]);
                style = Some(after[..j].trim().to_lowercase());
                rest = &after[j + 1..];
            }
            None => {
                out.push_str(&rest[..i + 1]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    (out.split_whitespace().collect::<Vec<_>>().join(" "), style)
}

/// 16-bit mono PCM in a .wav, for services that send bare samples.
pub fn wav(pcm: &[u8], rate: u32) -> Vec<u8> {
    let mut w = Vec::with_capacity(44 + pcm.len());
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes());
    w.extend_from_slice(&rate.to_le_bytes());
    w.extend_from_slice(&(rate * 2).to_le_bytes());
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    w.extend_from_slice(pcm);
    w
}

/// Where each service lives (tests point these at a stand-in).
#[derive(Clone)]
pub struct Bases {
    pub elevenlabs: String,
    pub openrouter: String,
    pub gemini: String,
}
impl Default for Bases {
    fn default() -> Self {
        Bases { elevenlabs: "https://api.elevenlabs.io".into(), openrouter: "https://openrouter.ai/api".into(), gemini: "https://generativelanguage.googleapis.com".into() }
    }
}

async fn fail(service: &str, r: reqwest::Response) -> String {
    let status = r.status();
    let body = r.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<Value>(&body).ok().and_then(|v| {
        let v = if v.is_array() { v[0].clone() } else { v };
        v["error"]["message"].as_str().or(v["detail"]["message"].as_str()).or(v["detail"].as_str()).or(v["message"].as_str()).map(String::from)
    });
    let why = msg.unwrap_or_else(|| body.chars().take(160).collect());
    match status.as_u16() {
        401 | 403 => format!("{service} didn't accept the key ({why})"),
        429 => format!("{service} is busy or out of credit right now ({why})"),
        _ => format!("{service} couldn't read it out loud ({status}: {why})"),
    }
}

fn gemini_auth(rb: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    // the newer "AQ." keys go as a bearer token; the classic ones in Google's own header
    if key.starts_with("AQ.") { rb.bearer_auth(key) } else { rb.header("x-goog-api-key", key) }
}

/// Reads `text` (directions in brackets allowed) in `voice`.
pub async fn say(http: &reqwest::Client, bases: &Bases, engine: &str, key: &str, model: Option<&str>, voice: &str, text: &str) -> Result<Spoken, String> {
    if text.trim().is_empty() {
        return Err("Nothing to say.".into());
    }
    match engine {
        "elevenlabs" => {
            let model = model.filter(|m| !m.is_empty()).unwrap_or(ELEVEN_MODEL);
            // directions in brackets are understood from Eleven v3 on; older models would read them out
            let text = if model.contains("v3") || model.contains("v4") || model.contains("v5") { text.to_string() } else { directions(text).0 };
            let r = http
                .post(format!("{}/v1/text-to-speech/{}?output_format=mp3_44100_128", bases.elevenlabs, voice))
                .header("xi-api-key", key)
                .json(&json!({"text": text, "model_id": model}))
                .send()
                .await
                .map_err(|e| format!("Couldn't reach ElevenLabs ({e})"))?;
            if !r.status().is_success() {
                return Err(fail("ElevenLabs", r).await);
            }
            let b = r.bytes().await.map_err(|e| e.to_string())?;
            Ok(Spoken { audio: b64(&b), mime: "audio/mpeg".into() })
        }
        "openrouter" => {
            let model = model.filter(|m| !m.is_empty()).unwrap_or(OPENROUTER_TTS);
            let (clean, _) = directions(text);
            let r = http
                .post(format!("{}/v1/audio/speech", bases.openrouter))
                .bearer_auth(key)
                .json(&json!({"model": model, "input": clean, "voice": voice, "response_format": "mp3"}))
                .send()
                .await
                .map_err(|e| format!("Couldn't reach OpenRouter ({e})"))?;
            if !r.status().is_success() {
                return Err(fail("OpenRouter", r).await);
            }
            let mime = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("audio/mpeg").to_string();
            let b = r.bytes().await.map_err(|e| e.to_string())?;
            Ok(Spoken { audio: b64(&b), mime })
        }
        "gemini" => {
            let model = model.filter(|m| !m.is_empty()).unwrap_or(GEMINI_TTS);
            let (clean, style) = directions(text);
            let url = format!("{}/v1beta/models/{}:generateContent", bases.gemini, model);
            // Gemini 3.8: the style rides along with the words; older models take a "say it like this" line
            let new_body = json!({
                "contents": [{"role": "user", "parts": [match &style { Some(s) => json!({"text": clean, "speech_metadata": {"style": s}}), None => json!({"text": clean}) }]}],
                "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"voice": voice}}}
            });
            let old_body = json!({
                "contents": [{"role": "user", "parts": [{"text": match &style { Some(s) => format!("Say it {s}: {clean}"), None => clean.clone() }}]}],
                "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}
            });
            let mut r = gemini_auth(http.post(&url), key).json(&new_body).send().await.map_err(|e| format!("Couldn't reach Gemini ({e})"))?;
            if r.status().as_u16() == 400 {
                r = gemini_auth(http.post(&url), key).json(&old_body).send().await.map_err(|e| format!("Couldn't reach Gemini ({e})"))?;
            }
            if !r.status().is_success() {
                return Err(fail("Gemini", r).await);
            }
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            let part = v["candidates"][0]["content"]["parts"].as_array().and_then(|ps| ps.iter().find(|p| p["inlineData"]["data"].is_string()).cloned()).ok_or("Gemini sent no sound back")?;
            let data = base64::engine::general_purpose::STANDARD.decode(part["inlineData"]["data"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
            let mime = part["inlineData"]["mimeType"].as_str().unwrap_or("");
            if data.starts_with(b"RIFF") {
                return Ok(Spoken { audio: b64(&data), mime: "audio/wav".into() });
            }
            // bare samples ("audio/L16;codec=pcm;rate=24000"): put them in a .wav
            let rate = mime.split("rate=").nth(1).and_then(|r| r.split(';').next()).and_then(|r| r.trim().parse().ok()).unwrap_or(24000);
            Ok(Spoken { audio: b64(&wav(&data, rate)), mime: "audio/wav".into() })
        }
        other => Err(format!("No voice service called {other}")),
    }
}

/// The voices a service offers this key (and, for OpenRouter, this model).
pub async fn voices(http: &reqwest::Client, bases: &Bases, engine: &str, key: &str, model: Option<&str>) -> Result<Vec<VoiceInfo>, String> {
    match engine {
        "gemini" => Ok(GEMINI_VOICES.iter().map(|(n, a)| VoiceInfo { id: n.to_string(), name: n.to_string(), about: a.to_string() }).collect()),
        "elevenlabs" => {
            let r = http.get(format!("{}/v1/voices", bases.elevenlabs)).header("xi-api-key", key).send().await.map_err(|e| format!("Couldn't reach ElevenLabs ({e})"))?;
            if !r.status().is_success() {
                return Err(fail("ElevenLabs", r).await);
            }
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            Ok(v["voices"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| {
                let l = &x["labels"];
                let about = [l["description"].as_str(), l["accent"].as_str(), l["gender"].as_str()].into_iter().flatten().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ");
                Some(VoiceInfo { id: x["voice_id"].as_str()?.to_string(), name: x["name"].as_str()?.to_string(), about })
            }).collect())
        }
        "openrouter" => {
            let want = model.filter(|m| !m.is_empty()).unwrap_or(OPENROUTER_TTS);
            let ms = speech_models(http, bases, key).await?;
            let m = ms.iter().find(|m| m["id"] == want).or(ms.first()).ok_or("OpenRouter has no speech models for this key")?;
            Ok(voices_of(m))
        }
        other => Err(format!("No voice service called {other}")),
    }
}

/// OpenRouter's models that speak, each with its voices.
async fn speech_models(http: &reqwest::Client, bases: &Bases, key: &str) -> Result<Vec<Value>, String> {
    let r = http.get(format!("{}/v1/models?output_modalities=speech", bases.openrouter)).bearer_auth(key).send().await.map_err(|e| format!("Couldn't reach OpenRouter ({e})"))?;
    if !r.status().is_success() {
        return Err(fail("OpenRouter", r).await);
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(v["data"].as_array().cloned().unwrap_or_default().into_iter().filter(|m| {
        let outs = m["architecture"]["output_modalities"].as_array().cloned().unwrap_or_default();
        outs.is_empty() || outs.iter().any(|o| o == "speech" || o == "audio")
    }).collect())
}
fn voices_of(m: &Value) -> Vec<VoiceInfo> {
    let list = m["supported_voices"].as_array().or(m["architecture"]["supported_voices"].as_array()).or(m["voices"].as_array()).cloned().unwrap_or_default();
    list.iter().filter_map(|x| match x {
        Value::String(s) => Some(VoiceInfo { id: s.clone(), name: s.clone(), about: String::new() }),
        _ => {
            let id = x["id"].as_str().or(x["voice"].as_str()).or(x["name"].as_str())?;
            Some(VoiceInfo { id: id.into(), name: x["name"].as_str().unwrap_or(id).into(), about: x["description"].as_str().unwrap_or("").into() })
        }
    }).collect()
}

/// The speech models a service has for this key (OpenRouter and ElevenLabs).
pub async fn models(http: &reqwest::Client, bases: &Bases, engine: &str, key: &str) -> Result<Vec<VoiceInfo>, String> {
    match engine {
        "openrouter" => Ok(speech_models(http, bases, key).await?.iter().filter_map(|m| {
            let id = m["id"].as_str()?;
            Some(VoiceInfo { id: id.into(), name: m["name"].as_str().unwrap_or(id).into(), about: format!("{} voices", voices_of(m).len()) })
        }).collect()),
        "elevenlabs" => {
            let r = http.get(format!("{}/v1/models", bases.elevenlabs)).header("xi-api-key", key).send().await.map_err(|e| format!("Couldn't reach ElevenLabs ({e})"))?;
            if !r.status().is_success() {
                return Err(fail("ElevenLabs", r).await);
            }
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            Ok(v.as_array().cloned().unwrap_or_default().iter().filter(|m| m["can_do_text_to_speech"].as_bool().unwrap_or(true)).filter_map(|m| {
                let id = m["model_id"].as_str()?;
                Some(VoiceInfo { id: id.into(), name: m["name"].as_str().unwrap_or(id).into(), about: m["description"].as_str().unwrap_or("").chars().take(90).collect() })
            }).collect())
        }
        "gemini" => Ok(vec![
            VoiceInfo { id: GEMINI_TTS.into(), name: "Gemini 3.8 Flash TTS".into(), about: "Expressive, 100+ languages".into() },
            VoiceInfo { id: "gemini-3.8-flash-lite-tts".into(), name: "Gemini 3.8 Flash-Lite TTS".into(), about: "Faster and cheaper".into() },
        ]),
        other => Err(format!("No voice service called {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directions_come_out() {
        assert_eq!(directions("[cheerful] Pronto! Tudo [nervously] feito."), ("Pronto! Tudo feito.".into(), Some("nervously".into())));
        assert_eq!(directions("see [the docs](https://x.io/a) now"), ("see the docs now".into(), None));
        assert_eq!(directions("no tags [1] here"), ("no tags [1] here".into(), None));
    }
    #[test]
    fn bare_samples_become_a_wav() {
        let w = wav(&[0u8; 480], 24000);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes([w[24], w[25], w[26], w[27]]), 24000);
        assert_eq!(w.len(), 44 + 480);
    }
}
