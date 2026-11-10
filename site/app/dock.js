// The Minus dock: an island at the top of your screen, always on.
//   nothing happening  -> a tiny Minus that blinks now and then
//   agents working     -> a pill with their live faces, what the first one is doing, progress
//   hover or click     -> opens: everyone at work, with pause and open
//   someone needs you  -> opens by itself with the question: buttons, or a box to type in
//   showing an agent   -> a little recorder: it's watching, each step as you go, and Done
//   stand-up time      -> your agents lined up, ready to tell you about their day
// It lives in its own always-on-top window in the desktop app and floats over the page in
// the web preview. Its window is always exactly as big as the island, so it never blocks
// clicks on whatever is underneath.
import { Mascot3D } from '../js/mascot3d.js';
import { COLORS } from '../js/shape.js';

const { animate } = window.Motion;
const tauri = window.__TAURI__;
const ch = new BroadcastChannel('minus-dock');
const island = document.getElementById('island'), stash = document.getElementById('stash');
// On a MacBook the island lives in the notch: idle it is the notch, working it grows out to
// either side of the camera, and questions drop down below it. (dock.html?notch=200x32 fakes one.)
let NOTCH = null;
async function findNotch() {
  const q = new URLSearchParams(location.search).get('notch');
  if (q) { const [w, h] = q.split('x').map(Number); NOTCH = { width: w || 200, height: h || 32 }; }
  else if (tauri) NOTCH = await tauri.core.invoke('dock_notch').catch(() => null);
  if (!NOTCH) return;
  const r = document.documentElement;
  r.classList.add('notch');
  r.style.setProperty('--nw', `${NOTCH.width}px`);
  r.style.setProperty('--nh', `${NOTCH.height}px`);
  // the curved corners where the island meets the top of the screen
  for (const side of ['l', 'r']) { const e = document.createElement('i'); e.className = `ear ${side}`; document.body.appendChild(e); }
  new ResizeObserver(() => r.style.setProperty('--iw', `${island.offsetWidth}px`)).observe(island);
}
const SHADOW = { x: 18, b: 24 }; // window room for the island's shadow
const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };

let S = { working: [], asks: [], watch: null, morning: null };
let mode = '', key = '', size = { w: 40, h: 40 };
let hover = false, pinned = false, hoverT = 0, leaveT = 0;
const later = new Set(); // asks you put off with "Later"
let sentNote = null;     // briefly: "Sent to Scout"
let lastAsks = new Set();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  up: '<svg viewBox="0 0 20 20"><path d="M5.5 12.5L10 8l4.5 4.5"/></svg>',
  pause: '<svg viewBox="0 0 20 20"><path d="M7.5 5v10M12.5 5v10"/></svg>',
  open: '<svg viewBox="0 0 20 20"><path d="M8 5.5h6.5V12M14.5 5.5L6 14"/></svg>',
  send: '<svg viewBox="0 0 20 20"><path d="M10 15.5v-11M5.5 9l4.5-4.5L14.5 9"/></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
};

/* ───────── live faces: one mascot per agent, moved between layouts, never restarted ───────── */
const faces = new Map();
function face(a) {
  let f = faces.get(a.id);
  if (!f) {
    const wrap = document.createElement('div'); wrap.className = 'mx';
    const c = document.createElement('canvas'); wrap.appendChild(c); stash.appendChild(wrap);
    const m = new Mascot3D(c, { shared: true, color: a.color || COLORS.cloud, outfit: a.outfit || {}, emotion: a.id === 'minus' ? 'neutral' : 'focused', frame: 1.62, idle: true, follow: a.id === 'minus' });
    f = { wrap, m, pulse: a.pulse || 0, emotion: '' };
    faces.set(a.id, f);
  }
  return f;
}
const MINUS = { id: 'minus', name: 'Minus', color: COLORS.cloud, outfit: {} };
const slot = (a, s) => `<span class="slot" data-face="${esc(a.id)}" style="--s:${s}"></span>`;
function placeFaces(root) {
  root.querySelectorAll('.slot[data-face]').forEach((el) => {
    const a = S.working.find((x) => x.id === el.dataset.face) || S.asks.map((q) => q.agent).find((x) => x.id === el.dataset.face) || (S.watch?.agent.id === el.dataset.face ? S.watch.agent : null) || S.morning?.agents.find((x) => x.id === el.dataset.face) || (el.dataset.face === 'minus' ? MINUS : null);
    if (a) el.appendChild(face(a).wrap);
  });
}
function mood(id, emotion) {
  const f = faces.get(id); if (!f || f.emotion === emotion) return;
  f.emotion = emotion; f.m.setEmotion(emotion);
}

/* ───────── what to show ───────── */
const activeAsk = () => S.asks.find((q) => !later.has(q.mid));
function pickMode() {
  if (S.watch) return 'watch';
  if (sentNote) return 'sent';
  if (activeAsk()) return 'ask';
  if (S.morning) return 'morning';
  if (S.working.length || S.asks.length) return hover || pinned ? 'open' : 'pill';
  return hover ? 'hi' : 'dot';
}

function ring(done, total) {
  const r = 6.2, C = 2 * Math.PI * r, p = total ? Math.min(1, done / total) : 0;
  return `<svg class="ring" viewBox="0 0 16 16"><circle class="bg" cx="8" cy="8" r="${r}"/><circle class="fg" cx="8" cy="8" r="${r}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>`;
}
const step = (w) => (w.total ? `${w.done}/${w.total}` : '');

function html(m) {
  if (m === 'watch') {
    const w = S.watch, last = w.recent[w.recent.length - 1];
    return `<div class="c-watch"><span class="rec" aria-hidden="true"><i></i></span>${slot(w.agent, 0.72)}
      <div class="w-t"><b>${esc(w.agent.name)} is watching</b><span data-k="wlast">${esc(last || 'Do the job once, the way you always do')}</span></div>
      <span class="w-n" data-k="wn" ${w.count ? '' : 'hidden'}>${w.count}</span>
      <button class="w-x" data-act="teach-cancel" aria-label="Stop without saving">${ICON.x}</button>
      <button class="btn solid" data-act="teach-done">Done</button></div>`;
  }
  if (m === 'morning') {
    const g = S.morning;
    return `<div class="c-watch c-morning"><span class="stack">${g.agents.map((a) => slot(a, 0.6)).join('')}</span>
      <div class="w-t"><b>Morning stand-up</b><span>${g.count} agent${g.count === 1 ? '' : 's'} ready${g.needs ? ` · ${g.needs} need${g.needs === 1 ? 's' : ''} you` : ''}</span></div>
      <button class="w-x" data-act="su-later" aria-label="Not today">${ICON.x}</button>
      <button class="btn solid" data-act="su-start">Start</button></div>`;
  }
  // in the notch: idle looks exactly like the notch; one-line states sit either side of the camera
  if (NOTCH && m === 'dot') return `<div class="c-dot" data-act="open"></div>`;
  if (NOTCH && m === 'hi') return `<div class="c-hi n-row" data-act="open"><span class="nl">${slot(MINUS, 0.5)}<b>Minus</b></span><i class="ngap"></i><span class="nr"><span>All quiet</span></span></div>`;
  if (m === 'dot') return `<div class="c-dot" data-act="open">${slot(MINUS, 0.6)}</div>`;
  if (m === 'hi') return `<div class="c-hi" data-act="open">${slot(MINUS, 0.6)}<b>Minus</b><span>All quiet</span></div>`;
  if (m === 'sent') return `<div class="sent">${slot(sentNote.agent, 0.84)}<div><b>Sent to ${esc(sentNote.agent.name)}</b><br><span>${esc(sentNote.text)}</span></div></div>`;
  if (m === 'pill') {
    const w = S.working, first = w[0] || S.asks[0]?.agent;
    const label = w.length > 1 ? `<b>${w.length} agents</b><span>working</span>` : w.length ? `<b>${esc(first.name)}</b><span>${esc(first.status)}</span>` : `<b>${esc(first.name)}</b><span>needs you</span>`;
    const avg = w.filter((x) => x.total).reduce((s, x) => [s[0] + x.done, s[1] + x.total], [0, 0]);
    const faceList = [...w, ...S.asks.map((q) => q.agent).filter((a) => !w.find((x) => x.id === a.id))].slice(0, 4);
    const end = S.asks.length ? '<span class="ping" aria-label="Someone needs you"></span>' : avg[1] ? ring(avg[0], avg[1]) : '';
    if (NOTCH) return `<div class="c-pill n-row" data-act="pin"><span class="nl"><span class="stack">${faceList.map((a) => slot(a, 0.5)).join('')}</span></span><i class="ngap"></i><span class="nr"><span class="p-text">${label}</span>${end}</span></div>`;
    return `<div class="c-pill" data-act="pin"><span class="stack">${faceList.map((a) => slot(a, 0.56)).join('')}</span>
      <span class="p-text">${label}</span>${end}</div>`;
  }
  if (m === 'open') {
    return `<div class="c-open"><div class="o-h"><span>${S.working.length ? `Working now · ${S.working.length}` : 'Waiting on you'}</span><button data-act="collapse" aria-label="Collapse">${ICON.up}</button></div>
      ${S.working.map((w) => `<div class="row" data-agent="${esc(w.id)}">${slot(w, 0.72)}<div class="r-t"><b>${esc(w.name)}</b><span data-k="status">${esc(w.status)}${step(w) ? ` · <span data-k="step">${step(w)}</span>` : ''}</span>
        ${w.total ? `<div class="bar"><i data-k="bar" style="width:${(100 * w.done) / w.total}%"></i></div>` : ''}</div>
        <button class="icon" data-act="pause" data-agent="${esc(w.id)}" aria-label="Pause ${esc(w.name)}">${ICON.pause}</button>
        <button class="icon" data-act="open" data-agent="${esc(w.id)}" aria-label="Open ${esc(w.name)}">${ICON.open}</button></div>`).join('')}
      ${S.asks.filter((q) => later.has(q.mid)).map((q) => `<div class="row" data-ask="${esc(q.mid)}">${slot(q.agent, 0.72)}<div class="r-t"><b>${esc(q.agent.name)}</b><span>${esc(q.title)}</span></div><button class="btn ghost" data-act="reopen" data-mid="${esc(q.mid)}">Answer</button></div>`).join('')}
      <div class="o-f"><button data-act="open">Open Minus</button></div></div>`;
  }
  if (m === 'ask') {
    const q = activeAsk();
    const who = q.kind === 'approval' ? `${q.agent.name} needs your OK` : `${q.agent.name} has a question`;
    const act = q.kind === 'question'
      ? `<form class="a-in" data-act="answer"><input name="t" placeholder="${esc(q.placeholder)}" autocomplete="off" spellcheck="true" aria-label="Your answer"><button class="send" disabled aria-label="Send">${ICON.send}</button></form>
         <div class="a-act"><button class="later" data-act="later">Later</button></div>`
      : `<div class="a-act"><button class="later" data-act="later">Later</button>${q.options.map(([v, t], i) => `<button class="btn ${i === q.options.length - 1 ? 'solid' : 'ghost'}" data-act="pick" data-v="${esc(v)}">${esc(t)}</button>`).join('')}</div>`;
    return `<div class="c-ask"><div class="a-top">${slot(q.agent, 0.9)}<div class="r-t"><div class="who">${esc(who)}</div><div class="q">${esc(q.title)}</div>${q.detail ? `<div class="d">${esc(q.detail)}</div>` : ''}</div></div>${act}</div>`;
  }
  return '';
}

const layoutKey = (m) => m + '|' + (m === 'watch' ? S.watch.agent.id : m === 'morning' ? S.morning.count + '/' + S.morning.needs : m === 'ask' ? activeAsk()?.mid : m === 'sent' ? sentNote.text : m === 'open' ? S.working.map((w) => w.id).join(',') + '/' + S.asks.map((q) => q.mid).join(',') : m === 'pill' ? S.working.map((w) => w.id).join(',') + '/' + S.asks.length + '/' + (S.working.length === 1 ? S.working[0].status : '') : '');

/* ───────── fitting the window to the island ───────── */
function fit(w, h) {
  const W = Math.ceil(w + SHADOW.x * 2), H = Math.ceil(h + SHADOW.b);
  if (tauri) tauri.core.invoke('dock_fit', { width: W, height: H }).catch(() => {});
  else parent.postMessage({ type: 'dock-fit', w: W, h: H }, '*');
}
document.body.style.paddingTop = '0px';

let anim = null, current = null;
function render(force = false) {
  const m = pickMode(), k = layoutKey(m);
  if (!force && k === key) return patch();
  key = k; mode = m;
  const next = document.createElement('div');
  next.className = 'content';
  next.innerHTML = html(m);
  next.style.opacity = '0';
  island.appendChild(next);
  placeFaces(next);
  const w = next.offsetWidth, h = next.offsetHeight;
  island.classList.toggle('asking', m === 'ask');
  island.classList.toggle('watching', m === 'watch');
  document.documentElement.dataset.mode = m;
  // grow the window first, shrink it after
  fit(Math.max(w, size.w), Math.max(h, size.h));
  anim?.stop?.();
  const radius = m === 'dot' || m === 'hi' || m === 'pill' ? 20 : m === 'sent' || m === 'watch' || m === 'morning' ? 26 : 28;
  anim = animate(island, { width: w, height: h, borderRadius: radius }, SPRING);
  anim.then(() => { if (mode === m) fit(w, h); });
  size = { w, h };
  const prev = current; current = next;
  if (prev) {
    animate(prev, { opacity: 0, filter: 'blur(4px)', scale: 0.97 }, { duration: 0.14 }).then(() => {
      // faces that moved on are already in the new layout; the rest go back to the stash
      prev.querySelectorAll('.mx').forEach((x) => stash.appendChild(x));
      prev.remove();
    });
  }
  animate(next, { opacity: [0, 1], filter: ['blur(6px)', 'blur(0px)'], scale: [0.98, 1] }, { duration: 0.3, delay: prev ? 0.07 : 0, ease: [0.22, 1, 0.36, 1] });
  const input = next.querySelector('input');
  if (input) {
    const send = next.querySelector('.send');
    input.addEventListener('input', () => (send.disabled = !input.value.trim()));
  }
  moods();
}

// small updates without re-laying out: progress, status text
function patch() {
  if (!current) return;
  for (const w of S.working) {
    const row = current.querySelector(`.row[data-agent="${CSS.escape(w.id)}"]`);
    if (row) {
      const bar = row.querySelector('[data-k="bar"]'); if (bar && w.total) bar.style.width = `${(100 * w.done) / w.total}%`;
      const st = row.querySelector('[data-k="status"]'); if (st) st.innerHTML = `${esc(w.status)}${step(w) ? ` · ${step(w)}` : ''}`;
    }
  }
  if (mode === 'watch' && S.watch) {
    const n = current.querySelector('[data-k="wn"]'), l = current.querySelector('[data-k="wlast"]'), last = S.watch.recent[S.watch.recent.length - 1];
    if (n && String(S.watch.count) !== n.textContent) {
      n.hidden = !S.watch.count; n.textContent = S.watch.count;
      animate(n, { scale: [1.5, 1] }, { type: 'spring', stiffness: 500, damping: 18 });
      if (l && last) { l.textContent = last; animate(l, { opacity: [0, 1], y: [5, 0] }, { duration: 0.3 }); }
      const f = faces.get(S.watch.agent.id); if (f) { f.m.gesture('nod'); }
      // keep the island exactly as wide as what it says
      const c = current.firstElementChild, w = c.offsetWidth, h = c.offsetHeight;
      if (w !== size.w) { fit(Math.max(w, size.w), h); animate(island, { width: w }, SPRING).then(() => fit(w, h)); size = { w, h }; }
    }
  }
  const r = current.querySelector('.ring .fg');
  if (r) {
    const t = S.working.filter((x) => x.total).reduce((s, x) => [s[0] + x.done, s[1] + x.total], [0, 0]);
    const C = 2 * Math.PI * 6.2; r.setAttribute('stroke-dashoffset', C * (1 - (t[1] ? t[0] / t[1] : 0)));
  }
  moods();
}

// faces react: focused while working, a nod for every step, curious when they need you
function moods() {
  for (const w of S.working) {
    const f = faces.get(w.id); if (!f) continue;
    if (w.pulse > f.pulse) { f.pulse = w.pulse; f.m.gesture('nod'); }
    mood(w.id, w.feel || 'focused');
  }
  for (const q of S.asks) mood(q.agent.id, q.kind === 'approval' ? 'worried' : 'curious');
  if (S.watch) mood(S.watch.agent.id, 'listening');
  if (mode === 'morning') for (const a of S.morning?.agents || []) mood(a.id, 'happy');
}

/* ───────── input ───────── */
island.addEventListener('pointerenter', () => { hover = true; clearTimeout(leaveT); clearTimeout(hoverT); hoverT = setTimeout(() => render(), 110); });
island.addEventListener('pointerleave', () => {
  clearTimeout(hoverT);
  leaveT = setTimeout(() => { if (document.activeElement?.tagName === 'INPUT') return; hover = false; render(); }, 420);
});
island.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  const q = activeAsk();
  if (act === 'pin') { pinned = true; render(); }
  if (act === 'su-start') ch.postMessage({ type: 'standup' });
  if (act === 'su-later') ch.postMessage({ type: 'standup-later' });
  if (act === 'teach-done' || act === 'teach-cancel') {
    const f = S.watch && faces.get(S.watch.agent.id);
    if (f) { if (act === 'teach-done') { f.m.setEmotion('happy'); f.m.hop(); } else f.m.setEmotion('neutral'); }
    ch.postMessage({ type: act });
  }
  if (act === 'collapse') { pinned = false; hover = false; render(); }
  if (act === 'open') { ch.postMessage({ type: 'open', agent: b.dataset.agent || S.working[0]?.id || null }); }
  if (act === 'pause') { ch.postMessage({ type: 'pause', agent: b.dataset.agent }); faces.get(b.dataset.agent)?.m.setEmotion('sleepy'); }
  if (act === 'later' && q) { later.add(q.mid); pinned = false; hover = false; render(); }
  if (act === 'reopen') { later.delete(b.dataset.mid); render(); }
  if (act === 'pick' && q) {
    const v = b.dataset.v;
    if (q.kind === 'approval') ch.postMessage({ type: 'resolve', agent: q.agent.id, mid: q.mid, decision: v });
    else ch.postMessage({ type: 'choose', agent: q.agent.id, mid: q.mid, choice: v });
    const f = faces.get(q.agent.id);
    if (f) { if (v === 'declined') { f.m.setEmotion('sad'); f.m.gesture('shake'); } else { f.m.setEmotion('happy'); f.m.gesture('nod'); } }
    done(q, q.kind === 'approval' ? (v === 'approved' ? 'Approved' : 'Declined') : v);
  }
});
island.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = activeAsk(), input = e.target.querySelector('input'), text = input?.value.trim();
  if (!q || !text) return;
  ch.postMessage({ type: 'answer', agent: q.agent.id, mid: q.mid, text });
  const f = faces.get(q.agent.id); if (f) { f.m.setEmotion('happy'); f.m.gesture('nod'); }
  done(q, `“${text}”`);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && activeAsk()) { later.add(activeAsk().mid); hover = false; render(); } });
function done(q, text) {
  later.add(q.mid);
  sentNote = { agent: q.agent, text };
  pinned = false; hover = false;
  render();
  setTimeout(() => { sentNote = null; render(); }, 1600);
}

/* ───────── state from the app ───────── */
ch.onmessage = ({ data }) => {
  if (data?.type !== 'state') return;
  S = data.state;
  // a new question opens the island by itself, with a little hop
  const now = new Set(S.asks.map((q) => q.mid));
  for (const q of S.asks) if (!lastAsks.has(q.mid)) { later.delete(q.mid); setTimeout(() => faces.get(q.agent.id)?.m.hop(), 250); }
  lastAsks = now;
  for (const id of [...later]) if (!now.has(id)) later.delete(id);
  // agents that stopped working leave the stash
  for (const [id, f] of faces) {
    if (id !== 'minus' && !S.working.find((w) => w.id === id) && !S.asks.find((q) => q.agent.id === id) && S.watch?.agent.id !== id && !S.morning?.agents.find((a) => a.id === id) && f.wrap.parentElement === stash) { f.m.destroy(); f.wrap.remove(); faces.delete(id); }
  }
  render();
};
ch.postMessage({ type: 'hello' });
findNotch().finally(() => {
  render(true);
  if (tauri) setTimeout(() => tauri.window.getCurrentWindow().show(), 120);
});
