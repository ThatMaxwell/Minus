// App state. One plain object, a tiny event bus, and local persistence.
// The desktop app replaces load/save with its database and the agent runtime.
import { SEED_AGENTS, SEED_THREADS, SEED_ROUTINES, COMPUTERS, PROVIDERS, DEFAULT_PERMS } from './data.js';

// In the apps you start with nothing: no example agents, chats or routines, no AI connected.
// The web preview keeps its example team so there's something to see.
export const APP = !!window.__TAURI__ && !new URLSearchParams(location.search).has('demo');
const KEY = APP ? 'minus.app.v2' : 'minus.app.v1';
const os = () => (/Android/i.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.platform) ? 'macOS' : /Win/.test(navigator.platform) ? 'Windows' : 'Linux');
const HERE = () => [{ id: 'here', name: 'This computer', kind: 'local', status: 'connected', region: 'Your desk', os: os() }];
const listeners = new Map();
let uid = Date.now();

export const state = {
  route: { view: 'chat', agent: 'scout' },
  agents: [], threads: {}, routines: [], computers: [], providers: [],
  settings: { lively: true, sounds: false, notify: true, compact: false },
  panel: true, // the computer panel in a chat
};

export const id = (p = 'id') => `${p}-${(uid++).toString(36)}`;
export const on = (ev, fn) => { (listeners.get(ev) || listeners.set(ev, new Set()).get(ev)).add(fn); return () => listeners.get(ev).delete(fn); };
export const emit = (ev, data) => { listeners.get(ev)?.forEach((fn) => fn(data)); listeners.get('*')?.forEach((fn) => fn(ev, data)); };

export function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  const seed = structuredClone;
  state.agents = saved?.agents || (APP ? [] : seed(SEED_AGENTS));
  state.threads = saved?.threads || (APP ? {} : seed(SEED_THREADS));
  state.routines = saved?.routines || (APP ? [] : seed(SEED_ROUTINES));
  state.computers = saved?.computers || (APP ? HERE() : seed(COMPUTERS));
  state.providers = saved?.providers || PROVIDERS.map((p) => ({ id: p.id, connected: APP ? false : p.connected, key: '' }));
  Object.assign(state.settings, saved?.settings || {});
  for (const a of state.agents) { a.perms ||= { ...DEFAULT_PERMS }; a.outfit ||= {}; state.threads[a.id] ||= []; }
  if (!state.agents.find((a) => a.id === state.route.agent)) state.route.agent = state.agents[0]?.id;
}
let saveT = 0;
export function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ agents: state.agents, threads: state.threads, routines: state.routines, computers: state.computers, providers: state.providers, settings: state.settings })); } catch {}
  }, 200);
}
export function reset() { try { localStorage.removeItem(KEY); } catch {} location.reload(); }

export const agent = (aid) => state.agents.find((a) => a.id === aid);
export const computer = (cid) => state.computers.find((c) => c.id === cid);
export const providerState = (pid) => state.providers.find((p) => p.id === pid);
export const pendingApprovals = () => state.agents.flatMap((a) => (state.threads[a.id] || []).filter((m) => m.kind === 'approval' && m.state === 'pending').map((m) => ({ agent: a, msg: m })));

export function go(view, extra = {}) {
  state.route = { ...state.route, view, ...extra };
  if (view === 'chat' && extra.agent) { const a = agent(extra.agent); if (a) a.unread = 0; }
  emit('route', state.route); save();
}
export function updateAgent(aid, patch) {
  const a = agent(aid); if (!a) return;
  Object.assign(a, patch); emit('agent', a); save();
}
export function post(aid, msg) {
  const m = { at: Date.now(), ...msg, mid: msg.mid || id('m') };
  (state.threads[aid] ||= []).push(m);
  emit('message', { agent: aid, msg: m }); save();
  return m;
}
export function patchMessage(aid, mid, patch) {
  const m = (state.threads[aid] || []).find((x) => x.mid === mid || x.id === mid);
  if (!m) return; Object.assign(m, patch); emit('message:update', { agent: aid, msg: m }); save();
}
