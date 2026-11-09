// The practice window. In the web preview there's no real desktop to watch, so "Show me once"
// gives you a small pretend app to do the job in. It records the same steps the desktop
// recorder does (by meaning: what kind of element, and its name), and skills replay in it
// with the agent's own cursor, the way they replay on a real screen.
import { icon, motion, IN } from './ui.js';

export const APP = 'chrome.exe', TITLE = 'New lead · Acme CRM - Google Chrome';
let win = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function build() {
  const el = document.createElement('div');
  el.className = 'practice';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Practice app: Acme CRM');
  el.innerHTML = `<div class="pw-bar"><i></i><i></i><i></i><span>crm.acme.example/leads/new</span><button class="pw-x" aria-label="Close the practice app">${icon('x')}</button></div>
    <div class="pw-body" data-g="New lead">
      <h4>New lead</h4>
      <label>Name<input data-r="edit" data-n="Name" autocomplete="off" spellcheck="false"></label>
      <label>Company<input data-r="edit" data-n="Company" autocomplete="off" spellcheck="false"></label>
      <label>Email<input data-r="edit" data-n="Email" autocomplete="off" spellcheck="false"></label>
      <div class="pw-seg" data-g="Stage"><span>Stage</span><button data-r="button" data-n="New">New</button><button data-r="button" data-n="Warm">Warm</button><button data-r="button" data-n="Hot">Hot</button></div>
      <button class="pw-save" data-r="button" data-n="Save lead">Save lead</button>
      <p class="pw-saved" hidden>${icon('check')}<span></span></p>
    </div>
    <p class="pw-foot">A practice app, for the preview. In the desktop app you show your agent the real thing, in any app.</p>`;
  document.body.appendChild(el);
  // the app itself works: stage buttons pick, Save saves
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('pw-x')) return close();
    if (b.parentElement.classList.contains('pw-seg')) { el.querySelectorAll('.pw-seg button').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.classList.contains('pw-save')) {
      const name = el.querySelector('[data-n="Name"]').value.trim();
      const s = el.querySelector('.pw-saved'); s.hidden = false; s.querySelector('span').textContent = name ? `Saved ${name}` : 'Saved';
      motion().animate(s, { opacity: [0, 1], y: [6, 0] }, { duration: 0.3, ease: IN });
      setTimeout(() => { el.querySelectorAll('input').forEach((i) => (i.value = '')); el.querySelectorAll('.pw-seg button').forEach((x) => x.classList.remove('on')); s.hidden = true; }, 1800);
    }
  });
  // drag it by its title bar
  el.querySelector('.pw-bar').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m) => { el.style.left = Math.max(0, m.clientX - dx) + 'px'; el.style.top = Math.max(0, m.clientY - dy) + 'px'; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  motion().animate(el, { opacity: [0, 1], scale: [0.94, 1], y: [20, 0] }, { type: 'spring', stiffness: 300, damping: 26 });
  return el;
}

export function open() { if (!win?.isConnected) win = build(); return win; }
export function close() {
  const el = win; win = null; if (!el) return;
  motion().animate(el, { opacity: 0, scale: 0.96, y: 12 }, { duration: 0.2 }).then(() => el.remove());
}

// How the desktop recorder describes an element: role, name, the window, what it sits in.
function ref(el) {
  const w = win.getBoundingClientRect(), b = el.getBoundingClientRect();
  const path = []; for (let g = el.parentElement.closest('[data-g]'); g; g = g.parentElement.closest('[data-g]')) path.unshift(`group:${g.dataset.g}`);
  return { role: el.dataset.r, name: el.dataset.n, app: APP, window: TITLE, path, at: { x: Math.round(b.left - w.left), y: Math.round(b.top - w.top), w: Math.round(b.width), h: Math.round(b.height) } };
}

/** Records what you do in the practice app. Returns a function that stops recording. */
export function record(onStep) {
  const el = open(), last = new Map();
  const fill = (i) => { if (last.get(i) === i.value) return; last.set(i, i.value); onStep({ kind: 'fill', target: ref(i), value: i.value }); };
  const click = (e) => { if (playing) return; const b = e.target.closest('[data-r="button"]'); if (b) { el.querySelectorAll('input').forEach((i) => i.value && fill(i)); onStep({ kind: 'click', target: ref(b), button: 'left', double: false }); } };
  const change = (e) => { if (!playing && e.target.matches('input[data-r]')) fill(e.target); };
  const key = (e) => { if (!playing && e.key === 'Enter' && e.target.matches('input[data-r]')) { fill(e.target); onStep({ kind: 'key', keys: 'enter', app: APP, window: TITLE }); } };
  el.addEventListener('click', click, true); el.addEventListener('change', change); el.addEventListener('keydown', key);
  setTimeout(() => el.querySelector('input')?.focus(), 300);
  return () => { el.removeEventListener('click', click, true); el.removeEventListener('change', change); el.removeEventListener('keydown', key); };
}

/* ───────── replay: the agent's cursor does it again ───────── */
let playing = false;
export async function replay(steps, fillIn, { name, color, onStep, stopped }) {
  const el = open();
  playing = true;
  await wait(450);
  const cur = document.createElement('div');
  cur.className = 'pw-cur'; cur.style.setProperty('--c', color);
  cur.innerHTML = `<svg viewBox="0 0 16 20"><path d="M1 1 L1 15.6 L4.9 12.2 L7.6 18.4 L10.2 17.2 L7.6 11.2 L12.8 11.2 Z" fill="${color}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg><b></b>`;
  cur.querySelector('b').textContent = name;
  document.body.appendChild(cur);
  const M = motion();
  let x = innerWidth / 2, y = innerHeight + 40;
  const to = async (t) => {
    const r = t.getBoundingClientRect(), nx = r.left + Math.min(r.width * 0.5, 40), ny = r.top + r.height * 0.6;
    await M.animate(cur, { x: [x, nx], y: [y, ny] }, { duration: 0.55, ease: [0.3, 0.8, 0.3, 1] });
    x = nx; y = ny;
  };
  M.animate(cur, { opacity: [0, 1] }, { duration: 0.25 });
  try {
    for (let i = 0; i < steps.length; i++) {
      if (stopped?.()) throw new Error('stopped');
      const s = steps[i], t = s.target;
      onStep?.(i, s);
      if (s.kind === 'key') {
        const k = document.createElement('kbd'); k.className = 'pw-key'; k.textContent = s.keys.replace(/\b\w/g, (c) => c.toUpperCase());
        cur.appendChild(k); await M.animate(k, { opacity: [0, 1, 1, 0], y: [4, 0, 0, -6] }, { duration: 0.9 }); k.remove();
        continue;
      }
      const node = el.querySelector(`[data-r="${t.role}"][data-n="${CSS.escape(t.name)}"]`);
      if (!node) throw new Error(`couldn’t find “${t.name}”`);
      await to(node);
      if (s.kind === 'click') {
        cur.classList.add('down'); await wait(110); cur.classList.remove('down');
        const rip = document.createElement('i'); rip.className = 'pw-rip'; cur.appendChild(rip);
        M.animate(rip, { scale: [0.2, 2.4], opacity: [0.7, 0] }, { duration: 0.5 }).then(() => rip.remove());
        node.click();
        await wait(380);
      } else if (s.kind === 'fill') {
        const v = fillIn(s.value);
        node.focus(); node.value = '';
        for (const ch of v) { node.value += ch; await wait(24 + Math.random() * 30); }
        node.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(200);
      }
    }
  } finally {
    playing = false;
    M.animate(cur, { opacity: 0, scale: 0.8 }, { duration: 0.3 }).then(() => cur.remove());
  }
}
