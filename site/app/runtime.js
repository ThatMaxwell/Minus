// The real agent runtime, in the desktop app (crates/agent). Agents whose AI is connected
// with a key run for real: they plan with that model and work on the computer through
// Minus Hands. Anywhere else (the web preview, or before a key is added) the demo brain in
// brain.js plays the part. Both post the same kinds of messages, so the UI doesn't care.
import { state, agent, computer, post, patchMessage, updateAgent, emit, providerState } from './store.js';
import { react, feel, gesture } from './director.js';
import { PERMISSIONS } from './data.js';
import * as nb from './notebook.js';
import { pendingRun } from './teach.js';
import { chime, notify } from './chime.js';
import * as vault from './vault.js';
import * as safety from './safety.js';

const tauri = window.__TAURI__;
export const desktop = !!tauri;

// Which API each provider in Settings uses, and the model new agents start with.
// The model can be changed when connecting (accounts don't all have the same ones).
export const ENGINES = {
  claude: { provider: 'anthropic', model: 'claude-opus-5-5', keyHint: 'sk-ant-…', where: 'console.anthropic.com' },
  chatgpt: { provider: 'openai', model: 'gpt-5', keyHint: 'sk-…', where: 'platform.openai.com' },
  codex: { provider: 'openai', model: 'gpt-5-codex', keyHint: 'sk-…', where: 'platform.openai.com' },
  gemini: { provider: 'gemini', model: 'gemini-2.5-pro', keyHint: 'AQ.… (or an older AIza… key)', where: 'aistudio.google.com' },
  grok: { provider: 'grok', model: 'grok-4', keyHint: 'xai-…', where: 'console.x.ai' },
  llama: { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', keyHint: 'sk-or-…', where: 'openrouter.ai' },
  ollama: { provider: 'ollama', model: 'qwen3', keyHint: '', where: 'ollama.com', local: true },
  openrouter: { provider: 'openrouter', model: 'openrouter/auto', keyHint: 'sk-or-…', where: 'openrouter.ai' },
  custom: { provider: 'custom', model: '', keyHint: 'API key', where: '', custom: true },
};

// Prices per million tokens (input, output, cache read), for the cost shown on each task.
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.1], 'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-fable-5-2': [8, 40, 0.2], 'claude-opus-5': [5, 25, 0.5],
};

let keyed = new Set();
export async function refreshKeys() {
  if (!tauri) return;
  try { keyed = new Set(await tauri.core.invoke('keys_list')); } catch { keyed = new Set(); }
  emit('keys');
}
export const hasKey = (slot) => keyed.has(slot);
export const slots = () => [...keyed];
export async function setKey(slot, key) { await tauri.core.invoke('keys_set', { slot, key }); await refreshKeys(); }
export async function removeKey(slot) { await tauri.core.invoke('keys_remove', { slot }); await refreshKeys(); }

// What agents can do on this device: use the computer (Windows, for now) or only think and write.
let caps = { computer: true, browser: false, platform: '' };
export const canUseComputer = () => caps.computer;
/** Agents here have their own web browser (a Chromium-family browser is installed). */
export const canBrowse = () => !!caps.browser;
export const browserFrame = (aid) => tauri?.core.invoke('browser_frame', { agent: aid });
const browsing = new Set(); // agents with a browser tab open
export const isBrowsing = (aid) => browsing.has(aid);

/** Tries a key with its provider before saving it. Resolves to the models the key can use. */
export function check(pid, key, model, baseUrl, name) {
  return tauri.core.invoke('ai_check', { provider: ENGINES[pid].provider, slot: pid, key: key || null, model: model || ENGINES[pid].model || '', baseUrl: baseUrl || null, name });
}
// The best model a key can use, when the one asked for isn't there: the newest of the family
// this provider is known for (Opus for Claude, Pro for Gemini, and so on).
const FAMILY = { claude: [/^claude-opus-(\d+)(?:-(\d+))?$/, /^claude-sonnet-(\d+)(?:-(\d+))?$/], gemini: [/^gemini-(\d+)(?:\.(\d+))?-pro$/, /^gemini-(\d+)(?:\.(\d+))?-pro-preview/, /^gemini-(\d+)(?:\.(\d+))?-flash$/],
  chatgpt: [/^gpt-(\d+)(?:\.(\d+))?$/], codex: [/^gpt-(\d+)(?:\.(\d+))?-codex$/, /^gpt-(\d+)(?:\.(\d+))?$/], grok: [/^grok-(\d+)(?:\.(\d+))?$/] };
export function pickModel(pid, models, wanted) {
  if (!models?.length || models.includes(wanted)) return wanted;
  for (const re of FAMILY[pid] || []) {
    const best = models.map((m) => [m, m.match(re)]).filter(([, x]) => x).sort((a, b) => (+b[1][1] - +a[1][1]) || ((+b[1][2] || 0) - (+a[1][2] || 0)))[0];
    if (best) return best[0];
  }
  return wanted;
}

/** True when this agent should run on the real runtime. */
/** Uses a ChatGPT plan (signed in) rather than an API key. */
export const onPlan = (pid) => pid === 'chatgpt' && !!providerState('chatgpt')?.plan && keyed.has('chatgpt-plan');
export const ready = (a) => !!tauri && !!a && (keyed.has(a.model) || a.model === 'ollama' || onPlan(a.model)) && !!ENGINES[a.model];

/* ───────── Sign in with ChatGPT (agents use your ChatGPT plan, no API key) ───────── */
export async function planSignIn() {
  const r = await tauri.core.invoke('chatgpt_signin');
  await refreshKeys();
  return r;
}
export async function planSignOut() {
  const revoked = await tauri.core.invoke('chatgpt_signout').catch(() => false);
  await refreshKeys();
  return revoked;
}

const live = new Map(); // agent -> { card mid, steps, usage, model }
const asking = new Map(); // agent -> { call, mid }

const specOf = (a) => ({
  id: a.id, name: a.name, role: a.role || '', instructions: a.instructions || '',
  computer: computer(a.computer)?.name || 'this computer',
  perms: PERMISSIONS.map((p) => [p.name, a.perms?.[p.id] || 'ask']),
  skills: (a.skills || []).map((s) => ({ id: s.id, name: s.name, about: s.about || '', steps: s.steps })),
  team: state.agents.filter((x) => x.id !== a.id && x.status !== 'off').map((x) => [x.name, x.role || '']),
  secrets: vault.names(),
});
// Each agent can pick its own model for each AI (a.pick); otherwise the AI's default.
export const modelOf = (a) => (a.pick || {})[a.model] || (providerState(a.model) || {}).modelId || ENGINES[a.model]?.model;
const brainOf = (a) => { const eng = ENGINES[a.model], ps = providerState(a.model) || {}; return { provider: onPlan(a.model) ? 'chatgpt-plan' : eng.provider, slot: a.model, model: modelOf(a), effort: a.effort || 'medium', base_url: ps.baseUrl || null }; };

/** Ask the room: this agent's answer, with its own AI and no tools. */
export async function roomAnswer(a, question, others = [], round = 1) {
  const r = await tauri.core.invoke('room_answer', { spec: specOf(a), brain: brainOf(a), notes: nb.asText(a), question, others, round });
  return { ...r, cost: cost(modelOf(a), { input: r.input, output: r.output, cacheRead: 0 }) };
}
export async function roomSumUp(a, question, said) {
  const r = await tauri.core.invoke('room_sum_up', { spec: specOf(a), brain: brainOf(a), question, said });
  return { ...r, cost: cost(modelOf(a), { input: r.input, output: r.output, cacheRead: 0 }) };
}
/** Roughly what a question to the room costs on your own keys, before you ask. */
export function estimate(agents, question, rounds = 1) {
  let total = 0, unknown = 0;
  for (const a of agents) {
    if (!ready(a)) continue;
    const c = cost(modelOf(a), { input: (900 + question.length / 3) * rounds + 300 * (rounds - 1) * agents.length, output: 180 * rounds, cacheRead: 0 });
    if (c == null) unknown++; else total += c;
  }
  return { total, unknown };
}
/** Rewind: the agent forgets everything after its first `jobs` jobs. */
export function rewind(aid, jobs) { tauri?.core.invoke('agent_rewind', { agent: aid, jobs }); }

const begun = new Set(); // agents whose job has started (the runtime said so)
const voiced = new Map(); // agent -> how its next message sounds read aloud
const takeVoice = (aid) => { const v = voiced.get(aid); voiced.delete(aid); return v || undefined; };
export async function run(aid, text) {
  const a = agent(aid);
  const spec = specOf(a), brain = brainOf(a);
  begun.delete(aid);
  try {
    // the notebook goes with the job (not into the standing instructions, which stay cached)
    const notes = nb.asText(a);
    await tauri.core.invoke('agent_run', { spec, brain, text: notes ? `${text}\n\n${notes}` : text });
    // never silence: if the job doesn't start, say so
    setTimeout(() => {
      if (begun.has(aid) || live.has(aid)) return;
      post(aid, { from: 'agent', kind: 'problem', text: 'This job didn’t start. Try sending it again; if it keeps happening, close Minus and open it again.' });
      updateAgent(aid, { status: 'idle', statusText: 'Hit a problem' });
      react(aid, 'worried');
    }, 12000);
  } catch (e) {
    post(aid, { from: 'agent', text: String(e?.message || e) });
    updateAgent(aid, { status: 'idle', statusText: 'Ready' });
    react(aid, 'confused');
  }
}


/** Settings → Agent pace: the pause before each action (the ghost cursor needs a moment). */
export function applyPace() { tauri?.core.invoke('ghost_pace', { ms: { easy: 420, normal: 140, fast: 0 }[state.settings.pace || 'normal'] }).catch(() => {}); }

export function stop(aid) { tauri?.core.invoke('agent_stop', { agent: aid }); }
export function forget(aid) { tauri?.core.invoke('agent_forget', { agent: aid }); }
export const running = (aid) => live.has(aid);

/** A typed answer for the question this agent is waiting on. */
export function answer(aid, text) {
  const q = asking.get(aid); if (!q) return false;
  asking.delete(aid);
  patchMessage(aid, q.mid, { answered: text });
  tauri.core.invoke('agent_reply', { call: q.call, answer: text });
  updateAgent(aid, { status: 'working', statusText: 'Back to work' });
  return true;
}
/** A choice or an approval from a card. Returns false if the card isn't from the runtime. */
export function reply(aid, m, value) {
  if (!m?.call) return false;
  asking.delete(aid);
  tauri.core.invoke('agent_reply', { call: m.call, answer: value });
  updateAgent(aid, { status: 'working', statusText: value === 'declined' ? 'Finding another way' : 'Doing it now' });
  return true;
}

function cost(model, u) {
  const p = PRICES[model]; if (!p) return null;
  return ((u.input - u.cacheRead) * p[0] + u.cacheRead * p[2] + u.output * p[1]) / 1e6;
}
const brief = (t) => { const s = t.split(/(?<=[.!?])\s/)[0]; return s.length > 90 ? s.slice(0, 88) + '…' : s; };

export function listen() {
  if (!tauri) return;
  refreshKeys();
  applyPace();
  tauri.core.invoke('agent_caps').then((c) => { if (c) { caps = c; emit('caps', c); } }).catch(() => {});
  tauri.event.listen('agent-event', ({ payload }) => {
    const aid = payload.agent, e = payload.event, a = agent(aid); if (!a) return;
    const cur = live.get(aid);
    const card = (patch) => cur?.mid && patchMessage(aid, cur.mid, patch);
    const quiet = () => emit('typing', { agent: aid, on: false });
    switch (e.kind) {
      case 'started': {
        begun.add(aid);
        const comp = computer(a.computer)?.name || 'this computer';
        const sk = pendingRun.get(aid); pendingRun.delete(aid);
        // with no computer to use, it's a conversation: it types, then answers (no work card)
        if (!caps.computer && !sk) {
          live.set(aid, { mid: null, steps: [], usage: { input: 0, output: 0, cacheRead: 0 }, model: modelOf(a) });
          updateAgent(aid, { status: 'working', statusText: 'Thinking…' });
          emit('typing', { agent: aid, on: true });
          react(aid, 'thinking');
          break;
        }
        const m = post(aid, { from: 'agent', kind: 'steps', title: sk ? `Doing “${sk.name}”` : `Working on ${comp}`, live: true, total: sk ? sk.steps.length : null, done: 0, steps: [], skill: !!sk });
        live.set(aid, { mid: m.mid, steps: [], usage: { input: 0, output: 0, cacheRead: 0 }, model: modelOf(a) });
        updateAgent(aid, { status: 'working', statusText: 'Starting' });
        react(aid, 'working', document.querySelector('.pc-panel'));
        emit('work', { agent: aid, on: true });
        break;
      }
      case 'draft': {
        // the reply as it's being written: on a work card it's the live note; in a chat it's a
        // bubble that grows, and becomes the answer when it's done
        if (!cur) break;
        if (cur.mid) { card({ note: e.text }); break; }
        if (!cur.draft) { quiet(); cur.draft = post(aid, { from: 'agent', text: e.text, live: true }).mid; }
        else patchMessage(aid, cur.draft, { text: e.text });
        updateAgent(aid, { statusText: 'Writing…' });
        break;
      }
      case 'note':
        updateAgent(aid, { statusText: brief(e.text) });
        card({ note: e.text });
        break;
      case 'step':
        if (!cur) break;
        if (!cur.mid) { quiet(); cur.mid = post(aid, { from: 'agent', kind: 'steps', title: 'Working', live: true, done: 0, steps: [] }).mid; }
        cur.steps.push(e.text);
        emit('step', { agent: aid, text: e.text });
        card({ steps: cur.steps.slice(-5), done: cur.steps.length });
        updateAgent(aid, { statusText: e.text });
        react(aid, 'step');
        break;
      case 'ask': {
        quiet();
        const m = e.options?.length
          ? post(aid, { from: 'agent', text: e.question, choices: e.options, call: e.call })
          : post(aid, { from: 'agent', kind: 'question', text: e.question, placeholder: e.placeholder || 'Type your answer', call: e.call });
        asking.set(aid, { call: e.call, mid: m.mid });
        updateAgent(aid, { status: 'waiting', statusText: 'Needs an answer' });
        react(aid, 'ask');
        chime('ask'); notify(`${a.name} has a question`, e.question);
        break;
      }
      case 'approval':
        quiet();
        post(aid, { from: 'agent', kind: 'approval', id: e.call, call: e.call, action: e.action, detail: e.details, preview: [], state: 'pending' });
        updateAgent(aid, { status: 'waiting', statusText: 'Waiting for your OK' });
        react(aid, 'ask');
        chime('ask'); notify(`${a.name} needs your OK`, e.action);
        emit('approvals');
        break;
      case 'message':
        post(aid, { from: 'agent', text: e.text, voice: takeVoice(aid) });
        break;
      case 'remember':
        nb.add(aid, e.text, 'agent');
        break;
      case 'hand_off':
        emit('handoff', { from: aid, to: e.to, job: e.job });
        break;
      case 'point':
        emit('point', { agent: aid, ...e });
        break;
      case 'voice':
        voiced.set(aid, e.text);
        break;
      case 'browse':
        browsing.add(aid);
        emit('browse', { agent: aid, url: e.url, title: e.title });
        break;
      case 'moderate':
        safety.apply(aid, e);
        react(aid, e.action === 'warn' ? 'no' : 'worried');
        break;
      case 'gesture':
        gesture(aid, e.name);
        emit('gesture', { agent: aid, name: e.name });
        break;
      case 'face':
        // its own expression, chosen by the agent (the code it wrote never shows)
        a.feel = e.name; feel(aid, e.name);
        emit('agent', a);
        break;
      case 'usage':
        if (cur) {
          cur.usage.input += e.input; cur.usage.output += e.output; cur.usage.cacheRead += e.cache_read;
          card({ cost: cost(cur.model, cur.usage), tokens: cur.usage.input + cur.usage.output });
        }
        break;
      case 'done':
        quiet();
        card({ live: false, title: `Done on ${computer(a.computer)?.name || 'this computer'}` });
        live.delete(aid);
        if (cur?.draft) patchMessage(aid, cur.draft, { text: e.text?.trim() || '…', live: false, voice: takeVoice(aid) });
        else if (e.text?.trim()) post(aid, { from: 'agent', text: e.text.trim(), voice: takeVoice(aid) });
        updateAgent(aid, { status: 'done', statusText: 'Finished' });
        emit('work', { agent: aid, on: false });
        react(aid, 'done');
        chime('done');
        notify(`${a.name} is done`, brief(e.text?.trim() || 'Finished the job.').replace(/<?\[\[[a-z -]+\]\]?>?/gi, ''));
        break;
      case 'stopped':
        quiet();
        if (cur?.draft) patchMessage(aid, cur.draft, { live: false });
        card({ live: false, title: 'Stopped' });
        live.delete(aid); asking.delete(aid);
        updateAgent(aid, { status: 'idle', statusText: 'Stopped' });
        emit('work', { agent: aid, on: false });
        react(aid, 'calm');
        break;
      case 'error':
        quiet();
        if (cur?.draft) patchMessage(aid, cur.draft, { live: false });
        card({ live: false, title: 'Stopped by a problem' });
        live.delete(aid); asking.delete(aid);
        post(aid, { from: 'agent', kind: 'problem', text: e.message });
        updateAgent(aid, { status: 'idle', statusText: 'Hit a problem' });
        chime('oops');
        emit('work', { agent: aid, on: false });
        react(aid, 'worried');
        break;
    }
  });
}
