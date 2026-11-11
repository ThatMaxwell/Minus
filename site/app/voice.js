// Talk to an agent and hear it answer.
//   Listening: the mic is recorded and transcribed by Whisper (whisper-large-v3-turbo) on Groq.
//   Speaking:  replies are read by the voice you choose in Settings → Voice: Orpheus on Groq,
//              ElevenLabs, OpenRouter, Gemini (your keys), or a voice that runs on this computer.
// The Groq key is kept on this computer only (localStorage here; the desktop app keeps it in the
// OS keychain) and goes straight to api.groq.com, nowhere else.
import { state, agent, emit, on } from './store.js';
import { mascotsOf } from './ui.js';
import * as local from './local-voice.js';
import * as rt from './runtime.js';

const tauri = window.__TAURI__;
/* ───────── where voices come from ───────── */
export const ENGINES = [
  { id: 'groq', name: 'Groq', model: 'Orpheus', about: 'Expressive voices, and it also listens', where: 'console.groq.com' },
  { id: 'elevenlabs', name: 'ElevenLabs', model: 'Eleven v3', about: 'The most natural voices, 70+ languages', slot: 'voice-elevenlabs', keyHint: 'sk_…', where: 'elevenlabs.io', app: true },
  { id: 'openrouter', name: 'OpenRouter', model: 'Gemini, GPT, Grok, Voxtral…', about: 'One key, many voice models', slot: 'openrouter', keyHint: 'sk-or-…', where: 'openrouter.ai', app: true },
  { id: 'gemini', name: 'Gemini', model: 'Gemini 3.8 Flash TTS', about: '30 voices, 100+ languages', slot: 'gemini', keyHint: 'AQ.… (or AIza…)', where: 'aistudio.google.com', app: true },
  { id: 'local', name: 'On this computer', model: 'Kokoro, Supertonic, Orpheus', about: 'Free, private, works offline' },
];
const GEMINI = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];
/** 'groq' | 'elevenlabs' | 'openrouter' | 'gemini' | 'local:small' | 'local:medium' | 'local:large' */
export const engine = () => state.settings.voiceEngine || 'groq';
export const engineInfo = (e = engine()) => ENGINES.find((x) => x.id === e.split(':')[0]) || ENGINES[0];
const lists = () => (state.settings.voiceLists ||= {}); // voices fetched from a service, kept between runs
/** The voices the chosen engine has: [id, name, about]. */
export function voicesFor(e = engine()) {
  if (e === 'groq') return VOICES.map((v) => [v, cap(v), '']);
  if (e === 'gemini') return GEMINI.map((v) => [v, v, '']);
  if (e.startsWith('local:')) return local.TIERS[e.slice(6)]?.voices || [];
  return (lists()[e] || []).map((v) => [v.id, v.name, v.about || '']);
}
export async function refreshVoices(e = engine()) {
  if (!tauri || !engineInfo(e).app || e === 'gemini') return voicesFor(e);
  const vs = await tauri.core.invoke('voice_list', { engine: e, model: state.settings.voiceModels?.[e] || null });
  lists()[e] = vs; emit('voice');
  return voicesFor(e);
}
/** Can the chosen voice speak right now? */
export function canSpeak(e = engine()) {
  if (e === 'groq') return hasKey();
  if (e.startsWith('local:')) return local.installed(e.slice(6));
  const info = engineInfo(e);
  return !!tauri && !!info.slot && rt.hasKey(info.slot);
}

const API = 'https://api.groq.com/openai/v1';
const LS = 'minus.voice.key';
const TTS_MODEL = 'canopylabs/orpheus-v1-english', STT_MODEL = 'whisper-large-v3-turbo';

export const VOICES = ['diana', 'hannah', 'autumn', 'troy', 'daniel', 'austin'];
const SEED_VOICE = { scout: 'hannah', inbox: 'diana', ledger: 'daniel', patch: 'austin', atlas: 'troy', rosie: 'autumn' };
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const groqVoice = (a) => (a && (a.voice || SEED_VOICE[a.id] || VOICES[hash(a.name || a.id || '') % VOICES.length])) || 'diana';
/** The agent's voice with the chosen engine: its own pick, or one chosen from its name. */
export function voiceOf(a, e = engine()) {
  if (e === 'groq') return groqVoice(a);
  const vs = voicesFor(e); if (!vs.length) return '';
  const mine = a?.voices?.[e];
  return mine && vs.some((v) => v[0] === mine) ? mine : vs[hash(a?.name || a?.id || '') % vs.length][0];
}
export const voiceName = (a, e = engine()) => (voicesFor(e).find((v) => v[0] === voiceOf(a, e)) || [])[1] || cap(voiceOf(a, e) || 'default');
export const cap = (s) => s[0].toUpperCase() + s.slice(1);

export const getKey = () => { try { return localStorage.getItem(LS) || ''; } catch { return ''; } };
export const setKey = (k) => { try { k ? localStorage.setItem(LS, k.trim()) : localStorage.removeItem(LS); } catch {} emit('voice'); };
export const hasKey = () => !!getKey();
// 'talk': read replies aloud when you talked · 'always' · 'never'
export const readMode = () => state.settings.readAloud || 'talk';

export class VoiceError extends Error {
  constructor(code, detail = '') { super(code); this.code = code; this.detail = detail; }
  get human() {
    return {
      nokey: 'Add a Groq key in Settings → Voice to talk out loud.',
      badkey: 'Groq didn’t accept that key. Check it in Settings → Voice.',
      terms: 'Accept the Orpheus terms in the Groq console first, then try again.',
      busy: 'Groq is busy right now. Try again in a few seconds.',
      mic: 'Minus can’t use the microphone. Allow it in your system settings.',
      quiet: 'Didn’t catch that. Try again a little closer to the mic.',
      failed: 'Voice didn’t work this time. Try again.',
      setup: 'Choose a voice in Settings → Voice first.',
      service: this.detail || 'That voice didn’t work this time.',
    }[this.code] || 'Voice didn’t work this time.';
  }
}

async function api(path, init = {}) {
  const key = getKey(); if (!key) throw new VoiceError('nokey');
  let r;
  try { r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) } }); }
  catch (e) { throw new VoiceError('failed', String(e)); }
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).error?.message || ''; } catch {}
    throw new VoiceError(r.status === 401 ? 'badkey' : /terms/i.test(msg) ? 'terms' : r.status === 429 ? 'busy' : 'failed', msg);
  }
  return r;
}

let ctx = null;
const audio = () => { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; };
const rms = (an, buf) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };

/* ───────── listening ───────── */
// Records until you stop it, or until you've said something and then gone quiet.
export class Listener {
  constructor({ onLevel = () => {}, onAutoStop = () => {} } = {}) { Object.assign(this, { onLevel, onAutoStop }); this.chunks = []; this.heard = 0; }
  async start() {
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(state.settings.mic ? { deviceId: { ideal: state.settings.mic } } : {}) } }); }
    catch { throw new VoiceError('mic'); }
    const c = audio(), src = c.createMediaStreamSource(this.stream);
    this.an = c.createAnalyser(); this.an.fftSize = 1024; src.connect(this.an);
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(120);
    this.t0 = performance.now();
    const buf = new Float32Array(this.an.fftSize);
    let quietSince = 0, loudFor = 0, last = performance.now();
    const loop = () => {
      if (!this.rec || this.rec.state !== 'recording') return;
      const now = performance.now(), dt = now - last; last = now;
      const lv = Math.min(1, rms(this.an, buf) * 7);
      this.onLevel(lv);
      if (lv > 0.12) { loudFor += dt; quietSince = 0; if (loudFor > 180) this.heard = 1; }
      else { loudFor = Math.max(0, loudFor - dt); quietSince ||= now; }
      if ((this.heard && quietSince && now - quietSince > 1400) || now - this.t0 > 60000) return this.onAutoStop();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  async stop() {
    cancelAnimationFrame(this.raf);
    if (!this.rec) return null;
    const done = new Promise((r) => (this.rec.onstop = r));
    if (this.rec.state !== 'inactive') this.rec.stop();
    await done;
    this.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
    this.rec = null;
    return { blob, heard: this.heard, ms: performance.now() - this.t0 };
  }
  cancel() { cancelAnimationFrame(this.raf); try { this.rec?.stop(); } catch {} this.stream?.getTracks().forEach((t) => t.stop()); this.rec = null; }
}

export async function transcribe(blob) {
  const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('file', blob, 'speech.' + ext); fd.append('model', STT_MODEL); fd.append('response_format', 'json'); fd.append('temperature', '0');
  const r = await api('/audio/transcriptions', { method: 'POST', body: fd });
  const text = ((await r.json()).text || '').trim();
  // Whisper sometimes "hears" these in silence
  if (!text || /^(thank you\.?|thanks for watching!?|you|\.+)$/i.test(text)) throw new VoiceError('quiet');
  return text;
}

/* ───────── speaking ───────── */
// Orpheus reads up to 200 characters per request: split at sentence ends, then at commas.
export function chunks(text, max = engine() === 'groq' ? 190 : 380) {
  const out = split(text, max);
  // a voice direction ([cheerful]) lasts until the next one, even across pieces
  let tone = '';
  return out.map((c) => {
    const starts = /^\[[a-z][a-z -]{0,22}\]/i.test(c), had = tone;
    const all = c.match(/\[[a-z][a-z -]{0,22}\]/gi); if (all) tone = all[all.length - 1];
    return !starts && had ? `${had} ${c}` : c;
  });
}
function split(text, max) {
  const clean = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').replace(/→/g, ' to ').trim();
  const out = [];
  for (let s of clean.match(/[^.!?…]+[.!?…]*["”’)]?\s*/g) || [clean]) {
    s = s.trim(); if (!s) continue;
    while (s.length > max) { let cut = s.lastIndexOf(', ', max); if (cut < 40) cut = s.lastIndexOf(' ', max); out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim(); }
    if (out.length && (out[out.length - 1] + ' ' + s).length <= max && s.length < 40) out[out.length - 1] += ' ' + s; else out.push(s);
  }
  return out;
}
// trim the silence Orpheus leaves at both ends, so sentences join naturally
function trim(buf, c) {
  const d = buf.getChannelData(0), th = 0.012, pad = Math.round(0.06 * buf.sampleRate);
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  a = Math.max(0, a - pad); b = Math.min(d.length, b + pad * 2);
  const out = c.createBuffer(buf.numberOfChannels, Math.max(1, b - a), buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b), ch);
  return out;
}
const cache = new Map(); // engine|voice|text -> Promise<AudioBuffer>
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
async function synth(e, voice, text) {
  if (e === 'groq') {
    const r = await api('/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: TTS_MODEL, voice, input: text, response_format: 'wav' }) });
    return audio().decodeAudioData(await r.arrayBuffer());
  }
  if (e.startsWith('local:')) {
    let out;
    try { out = await local.synth(e.slice(6), voice, text); } catch (x) { throw new VoiceError('service', String(x?.message || x)); }
    const b = audio().createBuffer(1, out.samples.length, out.rate); b.copyToChannel(Float32Array.from(out.samples), 0);
    return b;
  }
  if (!tauri) throw new VoiceError('setup');
  let r;
  try { r = await tauri.core.invoke('voice_say', { engine: e, model: state.settings.voiceModels?.[e] || null, voice, text }); }
  catch (x) { throw new VoiceError('service', String(x?.message || x)); }
  return audio().decodeAudioData(unb64(r.audio));
}
function say(voice, text, e = engine()) {
  const k = e + '|' + voice + '|' + text;
  if (!cache.has(k)) {
    const p = synth(e, voice, text).then((b) => trim(b, audio()));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return cache.get(k);
}

let current = null;
export const speaking = () => current;
export function stopSpeaking() { current?.stop(); }

// Reads `text` in the agent's voice. The agent's mascots bounce along with the words.
export async function speak(aid, text, { mid = null, voice, mascots = null } = {}) {
  stopSpeaking();
  const parts = chunks(text); if (!parts.length) return;
  const c = audio(), v = voice || voiceOf(agent(aid));
  const an = c.createAnalyser(); an.fftSize = 512; an.connect(c.destination);
  const sources = []; let stopped = false, raf = 0, endT = null;
  const me = {
    aid, mid,
    stop() { if (stopped) return; stopped = true; sources.forEach((s) => { try { s.stop(); } catch {} }); end(); },
  };
  const end = () => { cancelAnimationFrame(raf); if (current === me) current = null; emit('speaking', { agent: aid, mid, on: false }); };
  current = me;
  emit('speaking', { agent: aid, mid, on: true, loading: true });
  // the mascot talks: a little bounce on every syllable
  const buf = new Float32Array(an.fftSize); let prev = 0, cool = 0;
  const bob = () => {
    const lv = Math.min(1, rms(an, buf) * 6);
    if (lv > 0.16 && lv > prev * 1.25 && cool <= 0) { (mascots || mascotsOf(aid)).forEach((m) => { m.pop.v += 0.9 + lv * 1.6; }); cool = 6; }
    cool--; prev = prev * 0.7 + lv * 0.3;
    if (endT !== null && c.currentTime > endT + 0.05) return end();
    raf = requestAnimationFrame(bob);
  };
  try {
    if (!canSpeak()) throw new VoiceError(engine() === 'groq' ? 'nokey' : 'setup');
    const pending = engine().startsWith('local:') ? lazy(parts.map((p) => () => say(v, p))) : parts.map((p) => say(v, p)); // in order
    let at = 0;
    for (const p of pending) {
      const b = await p; if (stopped) return;
      const s = c.createBufferSource(); s.buffer = b; s.connect(an);
      at = Math.max(at, c.currentTime + 0.03); s.start(at); at += b.duration + 0.08;
      sources.push(s);
      if (sources.length === 1) { emit('speaking', { agent: aid, mid, on: true }); raf = requestAnimationFrame(bob); }
      endT = at;
    }
  } catch (e) { if (!stopped) { end(); throw e; } }
}

// Made one after another, each starting when the one before is done: [promise-like getters].
function lazy(makers) {
  let chain = Promise.resolve();
  return makers.map((m) => (chain = chain.then(m, m)));
}

// Read replies aloud when you talked to the agent (or always, per Settings).
const lastVia = new Map(); // agent -> time you last talked to it out loud
export const heardYou = (aid) => lastVia.set(aid, Date.now());
export function autoRead(onError) {
  return on('message', ({ agent: aid, msg }) => {
    if (msg.from === 'me') { if (msg.via !== 'voice') lastVia.delete(aid); stopSpeaking(); return; }
    if (msg.from !== 'agent' || !msg.text || msg.kind || !canSpeak()) return;
    const mode = readMode();
    if (mode === 'never' || (mode === 'talk' && !(Date.now() - (lastVia.get(aid) || 0) < 5 * 60e3))) return;
    speak(aid, msg.text, { mid: msg.mid }).catch((e) => onError?.(e));
  });
}
