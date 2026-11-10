// The phone's island: what your agents are doing, floating over other apps (Android's
// "Display over other apps"). It shows only while Minus is in the background. When an agent
// needs you, it opens by itself with the answers right there.
import { state, agent, on, go, emit } from './store.js';

const tauri = window.__TAURI__;
const android = /Android/i.test(navigator.userAgent);
export const supported = () => !!tauri && android;

export async function status() {
  if (!supported()) return { granted: false, supported: false };
  try { return await tauri.core.invoke('plugin:island|status'); } catch { return { granted: false, supported: false }; }
}
export async function allow() { try { await tauri.core.invoke('plugin:island|ask'); } catch {} }
export const enabled = () => state.settings.island !== false;

function snapshot() {
  // someone needs you: that comes first
  for (const a of state.agents) {
    const t = state.threads[a.id] || [];
    const ap = t.find((m) => m.kind === 'approval' && m.state === 'pending');
    if (ap) return { title: `${a.name} needs your OK`, sub: ap.detail || '', faces: [{ color: a.color, name: a.name }], ask: ap.action, askId: ap.mid || ap.id, agent: a.id, options: ['Decline', 'Approve'] };
    const last = t[t.length - 1];
    if (last?.from === 'agent' && last.choices && !last.chosen) return { title: `${a.name} has a question`, sub: '', faces: [{ color: a.color, name: a.name }], ask: last.text, askId: last.mid, agent: a.id, options: last.choices.slice(0, 3) };
    if (last?.from === 'agent' && last.kind === 'question' && !last.answered) return { title: `${a.name} has a question`, sub: '', faces: [{ color: a.color, name: a.name }], ask: last.text, askId: last.mid, agent: a.id, options: [] };
  }
  const working = state.agents.filter((a) => a.status === 'working');
  if (!working.length) return { title: '', sub: '', faces: [], progress: -1, options: [] };
  const a = working[0], card = [...(state.threads[a.id] || [])].reverse().find((m) => m.kind === 'steps' && m.live);
  return {
    title: working.length > 1 ? `${working.length} agents working` : a.name,
    sub: working.length > 1 ? working.map((x) => x.name).join(', ') : a.statusText || 'Working',
    faces: working.slice(0, 3).map((x) => ({ color: x.color, name: x.name })),
    progress: card?.total ? card.done / card.total : -1,
    options: [],
  };
}

let t = 0, last = '';
function push() {
  clearTimeout(t);
  t = setTimeout(() => {
    const s = enabled() ? snapshot() : { title: '', sub: '', faces: [], progress: -1, options: [] };
    const k = JSON.stringify(s); if (k === last) return; last = k;
    tauri.core.invoke('plugin:island|show', { state: s }).catch(() => {});
  }, 250);
}

export function startIsland() {
  if (!supported()) return;
  on('*', (ev) => { if (['agent', 'agents', 'message', 'message:update', 'approvals', 'work', 'linked', 'settings'].includes(ev)) push(); });
  // a tap on the island
  tauri.event.listen('island', async ({ payload: p }) => {
    if (!p) return;
    const { resolve, choose } = await import('./brain.js');
    if (p.kind === 'choice' && p.agent && p.askId) {
      const m = (state.threads[p.agent] || []).find((x) => (x.mid || x.id) === p.askId);
      if (m?.kind === 'approval') resolve(p.agent, p.askId, p.value === 'Approve' ? 'approved' : 'declined');
      else if (m) choose(p.agent, p.askId, p.value);
    }
    if (p.kind === 'open' && p.agent && agent(p.agent)) go('chat', { agent: p.agent });
  });
  push();
}
