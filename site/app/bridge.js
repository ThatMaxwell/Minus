// Keeps the dock (a separate always-on window in the desktop app, a floating frame in the
// web preview) in sync with the app: who's working, on what, and who needs you.
// Both sides talk over a BroadcastChannel (same origin), so it works the same in both places.
// When the agent runtime moves into the app's core, these messages come from there instead.
import { state, on, agent, post, updateAgent, go } from './store.js';
import { respond, choose, resolve } from './brain.js';
import { react } from './director.js';
import * as teach from './teach.js';

const ch = new BroadcastChannel('minus-dock');
const tauri = window.__TAURI__;
const pulses = new Map(); // agent -> count of finished steps (the dock nods along)

function looks(a) {
  return { id: a.id, name: a.name, color: a.color, outfit: a.outfit || {}, emotion: a.emotion || 'neutral' };
}

// What the dock shows: agents at work, and the questions waiting on you.
function snapshot() {
  const working = [], asks = [];
  for (const a of state.agents) {
    const t = state.threads[a.id] || [];
    const steps = [...t].reverse().find((m) => m.kind === 'steps' && m.live);
    if (a.status === 'working') {
      working.push({ ...looks(a), status: a.statusText || 'Working', done: steps?.done ?? null, total: steps?.total ?? null, pulse: pulses.get(a.id) || 0, feel: a.feel || null });
    }
    for (const m of t) {
      if (m.kind === 'approval' && m.state === 'pending') {
        asks.push({ agent: looks(a), mid: m.mid, kind: 'approval', title: m.action, detail: m.detail, options: [['declined', 'Decline'], ['approved', 'Approve']] });
      }
    }
    const last = t[t.length - 1];
    if (last && last.from === 'agent') {
      if (last.kind === 'question' && !last.answered) asks.push({ agent: looks(a), mid: last.mid, kind: 'question', title: last.text, placeholder: last.placeholder || 'Type your answer' });
      else if (last.choices && !last.chosen && Date.now() - (last.at || 0) < 30 * 60e3) asks.push({ agent: looks(a), mid: last.mid, kind: 'choice', title: last.text, options: last.choices.map((c) => [c, c]) });
    }
  }
  const w = teach.watching(), wa = w && agent(w.agent);
  const watch = wa ? { agent: looks(wa), count: w.steps.length, recent: w.steps.slice(-3).map((s) => teach.describe(s)) } : null;
  return { working, asks, watch };
}

let t = 0;
const push = () => { clearTimeout(t); t = setTimeout(() => ch.postMessage({ type: 'state', state: snapshot() }), 40); };

export function startBridge() {
  on('*', (ev, data) => {
    if (ev === 'message:update' && data?.msg?.kind === 'steps') pulses.set(data.agent, (pulses.get(data.agent) || 0) + 1);
    if (['agent', 'message', 'message:update', 'approvals', 'agents', 'work', 'teach'].includes(ev)) push();
  });
  ch.onmessage = ({ data: d }) => {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'hello') return push();
    if (d.type === 'teach-done') return teach.finish(true);
    if (d.type === 'teach-cancel') return teach.finish(false);
    const a = d.agent && agent(d.agent);
    if (d.type === 'open') {
      if (a) go('chat', { agent: a.id });
      tauri?.core.invoke('show_main');
      return;
    }
    if (!a) return;
    if (d.type === 'resolve') resolve(a.id, d.mid, d.decision === 'approved' ? 'approved' : 'declined');
    if (d.type === 'choose') choose(a.id, d.mid, String(d.choice));
    if (d.type === 'answer' && String(d.text || '').trim()) {
      post(a.id, { from: 'me', text: String(d.text).trim(), via: 'dock' });
      react(a.id, 'send');
      respond(a.id, String(d.text).trim());
    }
    if (d.type === 'pause') { updateAgent(a.id, { status: 'paused', statusText: 'Paused' }); react(a.id, 'sleep'); }
  };
  // The tray's "Pause all agents"
  tauri?.event.listen('pause-all', () => state.agents.forEach((x) => x.status === 'working' && updateAgent(x.id, { status: 'paused', statusText: 'Paused' })));
  push();

  // In the browser preview there's no separate window, so the dock floats over the page.
  if (!tauri) {
    const f = document.createElement('iframe');
    f.className = 'dock-frame'; f.src = 'dock.html'; f.title = 'Minus dock';
    f.setAttribute('allowtransparency', 'true');
    document.body.appendChild(f);
    addEventListener('message', (e) => {
      if (e.source !== f.contentWindow || e.data?.type !== 'dock-fit') return;
      f.style.width = e.data.w + 'px'; f.style.height = e.data.h + 'px';
    });
  }
}
