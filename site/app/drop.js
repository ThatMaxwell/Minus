// Drop on an agent: drag files (or some text) onto an agent in the sidebar, or into a chat,
// and it catches them. They wait in its message box until you say what to do with them.
// In the desktop app the agent gets the files' paths, so it can open them on the computer.
import { state, agent, go, emit } from './store.js';
import { $, $$, mascotsOf, motion } from './ui.js';

const tauri = window.__TAURI__;
let over = null;

// which agent is under this point: a sidebar row, a stand-up spot, or the open chat
function agentAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const row = el?.closest?.('[data-agent].ag-row, .su-a, .rm-pick');
  if (row) return row.dataset.agent || row.dataset.pick || row.querySelector('canvas[data-agent]')?.dataset.agent;
  if (el?.closest?.('.chat') && state.route.view === 'chat') return state.route.agent;
  return null;
}
function hover(aid) {
  if (aid === over) return;
  $$('.drop-on').forEach((x) => x.classList.remove('drop-on'));
  over = aid;
  if (!aid) return;
  $(`.ag-row[data-agent="${CSS.escape(aid)}"]`)?.classList.add('drop-on');
  if (state.route.view === 'chat' && state.route.agent === aid) $('.chat')?.classList.add('drop-on');
  mascotsOf(aid).forEach((m) => { m.setEmotion('excited'); m.gesture('tilt'); });
}
function catchIt(aid, files, text) {
  hover(null);
  const a = agent(aid); if (!a || (!files.length && !text)) return;
  mascotsOf(aid).forEach((m) => { m.setEmotion('happy'); m.hop(); });
  if (!(state.route.view === 'chat' && state.route.agent === aid)) go('chat', { agent: aid });
  setTimeout(() => emit('attach', { agent: aid, files, text }), 60);
}

export function startDrop() {
  // the browser (and the web preview): File objects and dragged text
  addEventListener('dragover', (e) => {
    const aid = agentAt(e.clientX, e.clientY);
    if (aid) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    hover(aid);
  });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) hover(null); });
  addEventListener('drop', (e) => {
    const aid = agentAt(e.clientX, e.clientY); if (!aid) return;
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])].map((f) => ({ name: f.name, size: f.size }));
    catchIt(aid, files, files.length ? '' : e.dataTransfer.getData('text/plain'));
  });
  // the desktop app: the system gives us the files' paths
  if (tauri) {
    const pt = (p) => [p.x / devicePixelRatio, p.y / devicePixelRatio];
    tauri.event.listen('tauri://drag-over', ({ payload }) => hover(agentAt(...pt(payload.position))));
    tauri.event.listen('tauri://drag-leave', () => hover(null));
    tauri.event.listen('tauri://drag-drop', ({ payload }) => {
      const aid = agentAt(...pt(payload.position)); if (!aid) return hover(null);
      catchIt(aid, (payload.paths || []).map((p) => ({ name: p.split(/[\\/]/).pop(), path: p })), '');
    });
  }
}

/** A little bounce for the chips as they land in the message box. */
export function land(el) { motion().animate(el, { opacity: [0, 1], y: [-14, 0], scale: [0.8, 1] }, { type: 'spring', stiffness: 420, damping: 22 }); }
