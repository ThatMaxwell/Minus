// Visible hand-offs: when one agent passes work to another, you see it happen. A little
// folder flies from one face to the other in the sidebar, both chats say so, and the
// teammate gets going.
import { state, agent, post, on, emit } from './store.js';
import { $, esc, icon, motion, mascotsOf } from './ui.js';
import { react } from './director.js';
import { respond, work } from './brain.js';
import * as rt from './runtime.js';

const byName = (n) => state.agents.find((a) => a.name.toLowerCase() === String(n).trim().toLowerCase());

export function handOff(fromId, toName, job) {
  const from = agent(fromId), to = byName(toName);
  if (!from || !to || to.id === from.id) return false;
  post(from.id, { from: 'system', kind: 'handoff', text: `Handed to ${to.name}: ${job}`, to: to.id });
  post(to.id, { from: 'system', kind: 'handoff', text: `From ${from.name}: ${job}`, by: from.id });
  fly(from, to, job);
  react(from.id, 'yes');
  // the teammate starts on it (it's a job, not a chat)
  setTimeout(() => (rt.ready(to) ? respond(to.id, `${job}\n\n(${from.name} handed this to you.)`) : work(to.id, job)), 1100);
  emit('handed', { from: from.id, to: to.id });
  return true;
}

// the folder travels between the two agents' faces in the sidebar
function fly(from, to, job) {
  const a = $(`.ag-row[data-agent="${CSS.escape(from.id)}"] .face`), b = $(`.ag-row[data-agent="${CSS.escape(to.id)}"] .face`);
  if (!a || !b) return;
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'baton'; p.style.setProperty('--c', from.color);
  p.innerHTML = `${icon('file')}<span>${esc(job.length > 34 ? job.slice(0, 32) + '…' : job)}</span>`;
  document.body.appendChild(p);
  const M = motion(), sx = ra.right + 4, sy = ra.top + ra.height / 2 - 14, ex = rb.right + 4, ey = rb.top + rb.height / 2 - 14;
  const bow = Math.max(60, Math.abs(ey - sy) * 0.5);
  mascotsOf(from.id).forEach((m) => m.lookAtEl(b, 2));
  M.animate(p, { x: [sx, sx + bow, ex], y: [sy, (sy + ey) / 2, ey], scale: [0.6, 1, 0.5], opacity: [0, 1, 0], rotate: [-6, 4, 0] }, { duration: 1.15, ease: [0.45, 0, 0.2, 1] })
    .then(() => {
      p.remove();
      mascotsOf(to.id).forEach((m) => { m.setEmotion('excited'); m.hop(); });
      M.animate(b, { scale: [1, 1.25, 1] }, { duration: 0.4 });
    });
}

export function startHandoffs() {
  on('handoff', ({ from, to, job }) => handOff(from, to, job));
}
