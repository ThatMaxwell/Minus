// The real agent runtime, in the desktop app (crates/agent). Agents whose AI is connected
// with a key run for real: they plan with that model and work on the computer through
// Minus Hands. Anywhere else (the web preview, or before a key is added) the demo brain in
// brain.js plays the part. Both post the same kinds of messages, so the UI doesn't care.
import { state, agent, computer, post, patchMessage, updateAgent, emit, providerState } from './store.js';
import { react, feel } from './director.js';
import { PERMISSIONS } from './data.js';
import * as nb from './notebook.js';
import { pendingRun } from './teach.js';

const tauri = window.__TAURI__;
export const desktop = !!tauri;

// Which API each provider in Settings uses, and the model new agents start with.
// The model can be changed when connecting (accounts don't all have the same ones).
export const ENGINES = {
  claude: { provider: 'anthropic', model: 'claude-opus-5-5', keyHint: 'sk-ant-…', where: 'console.anthropic.com' },
  chatgpt: { provider: 'openai', model: 'gpt-5', keyHint: 'sk-…', where: 'platform.openai.com' },
  codex: { provider: 'openai', model: 'gpt-5-codex', keyHint: 'sk-…', where: 'platform.openai.com' },
  gemini: { provider: 'gemini', model: 'gemini-2.5-pro', keyHint: 'AIza…', where: 'aistudio.google.com' },
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
export async function setKey(slot, key) { await tauri.core.invoke('keys_set', { slot, key }); await refreshKeys(); }
export async function removeKey(slot) { await tauri.core.invoke('keys_remove', { slot }); await refreshKeys(); }

/** True when this agent should run on the real runtime. */
export const ready = (a) => !!tauri && !!a && (keyed.has(a.model) || a.model === 'ollama') && !!ENGINES[a.model];

const live = new Map(); // agent -> { card mid, steps, usage, model }
const asking = new Map(); // agent -> { call, mid }

const specOf = (a) => ({
  id: a.id, name: a.name, role: a.role || '', instructions: a.instructions || '',
  computer: computer(a.computer)?.name || 'this computer',
  perms: PERMISSIONS.map((p) => [p.name, a.perms?.[p.id] || 'ask']),
  skills: (a.skills || []).map((s) => ({ id: s.id, name: s.name, about: s.about || '', steps: s.steps })),
  team: state.agents.filter((x) => x.id !== a.id && x.status !== 'off').map((x) => [x.name, x.role || '']),
});
const brainOf = (a) => { const eng = ENGINES[a.model], ps = providerState(a.model) || {}; return { provider: eng.provider, slot: a.model, model: ps.modelId || eng.model, effort: a.effort || 'medium', base_url: ps.baseUrl || null }; };
export const modelOf = (a) => (providerState(a.model) || {}).modelId || ENGINES[a.model]?.model;

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

export async function run(aid, text) {
  const a = agent(aid);
  const spec = specOf(a), brain = brainOf(a);
  try {
    // the notebook goes with the job (not into the standing instructions, which stay cached)
    const notes = nb.asText(a);
    await tauri.core.invoke('agent_run', { spec, brain, text: notes ? `${text}\n\n${notes}` : text });
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
  tauri.event.listen('agent-event', ({ payload }) => {
    const aid = payload.agent, e = payload.event, a = agent(aid); if (!a) return;
    const cur = live.get(aid);
    const card = (patch) => cur && patchMessage(aid, cur.mid, patch);
    switch (e.kind) {
      case 'started': {
        const comp = computer(a.computer)?.name || 'this computer';
        const sk = pendingRun.get(aid); pendingRun.delete(aid);
        const m = post(aid, { from: 'agent', kind: 'steps', title: sk ? `Doing “${sk.name}”` : `Working on ${comp}`, live: true, total: sk ? sk.steps.length : null, done: 0, steps: [], skill: !!sk });
        live.set(aid, { mid: m.mid, steps: [], usage: { input: 0, output: 0, cacheRead: 0 }, model: (providerState(a.model) || {}).modelId || ENGINES[a.model]?.model });
        updateAgent(aid, { status: 'working', statusText: 'Starting' });
        react(aid, 'working', document.querySelector('.pc-panel'));
        emit('work', { agent: aid, on: true });
        break;
      }
      case 'note':
        updateAgent(aid, { statusText: brief(e.text) });
        card({ note: e.text });
        break;
      case 'step':
        if (!cur) break;
        cur.steps.push(e.text);
        emit('step', { agent: aid, text: e.text });
        card({ steps: cur.steps.slice(-5), done: cur.steps.length });
        updateAgent(aid, { statusText: e.text });
        react(aid, 'step');
        break;
      case 'ask': {
        const m = e.options?.length
          ? post(aid, { from: 'agent', text: e.question, choices: e.options, call: e.call })
          : post(aid, { from: 'agent', kind: 'question', text: e.question, placeholder: e.placeholder || 'Type your answer', call: e.call });
        asking.set(aid, { call: e.call, mid: m.mid });
        updateAgent(aid, { status: 'waiting', statusText: 'Needs an answer' });
        react(aid, 'ask');
        break;
      }
      case 'approval':
        post(aid, { from: 'agent', kind: 'approval', id: e.call, call: e.call, action: e.action, detail: e.details, preview: [], state: 'pending' });
        updateAgent(aid, { status: 'waiting', statusText: 'Waiting for your OK' });
        react(aid, 'ask');
        emit('approvals');
        break;
      case 'message':
        post(aid, { from: 'agent', text: e.text });
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
        card({ live: false, title: `Done on ${computer(a.computer)?.name || 'this computer'}` });
        live.delete(aid);
        if (e.text?.trim()) post(aid, { from: 'agent', text: e.text.trim() });
        updateAgent(aid, { status: 'done', statusText: 'Finished' });
        emit('work', { agent: aid, on: false });
        react(aid, 'done');
        break;
      case 'stopped':
        card({ live: false, title: 'Stopped' });
        live.delete(aid); asking.delete(aid);
        updateAgent(aid, { status: 'idle', statusText: 'Stopped' });
        emit('work', { agent: aid, on: false });
        react(aid, 'calm');
        break;
      case 'error':
        card({ live: false, title: 'Stopped by a problem' });
        live.delete(aid); asking.delete(aid);
        post(aid, { from: 'agent', kind: 'problem', text: e.message });
        updateAgent(aid, { status: 'idle', statusText: 'Hit a problem' });
        emit('work', { agent: aid, on: false });
        react(aid, 'worried');
        break;
    }
  });
}
