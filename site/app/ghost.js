// The ghost cursor. Agents act on your real desktop through accessibility, without taking
// your mouse; this overlay shows where they are and what they're doing:
//   - each working agent has its own cursor in its color, with its live face and what it's doing
//   - it glides to each element before acting, and a frame settles around that element
//   - clicks ripple, typing appears beside the field, key presses show as keycaps
//   - when an agent reads a window, corner brackets lock on and a band sweeps down
// The overlay window ignores the mouse and is left out of screenshots, so agents never see it.
// ghost.html?demo plays a scripted scene over a pretend desktop (for previews).
import { Mascot3D } from '../js/mascot3d.js';
import { COLORS } from '../js/shape.js';

const { animate } = window.Motion;
const tauri = window.__TAURI__;
const demo = new URLSearchParams(location.search).has('demo');
const root = document.getElementById('ghosts');
const looks = new Map(); // agent -> { name, color, outfit }
const ghosts = new Map();
let origin = { x: 0, y: 0, scale: 1 };

// what each agent looks like comes from the app, over the same channel the dock uses
const ch = new BroadcastChannel('minus-dock');
ch.onmessage = ({ data }) => {
  if (data?.type !== 'state') return;
  for (const a of [...data.state.working, ...data.state.asks.map((q) => q.agent)]) looks.set(a.id, a);
};
ch.postMessage({ type: 'hello' });

// screen pixels -> this window's CSS pixels
const css = (x, y) => [(x - origin.x) / origin.scale, (y - origin.y) / origin.scale];
const box = (e) => { const [x, y] = css(e.x, e.y); return { x, y, w: e.w / origin.scale, h: e.h / origin.scale }; };

function ghost(aid) {
  let g = ghosts.get(aid);
  if (g) return g;
  const a = looks.get(aid) || { id: aid, name: aid, color: COLORS.cloud, outfit: {} };
  const el = document.createElement('div');
  el.className = 'cur';
  el.style.setProperty('--c', a.color);
  el.innerHTML = `<svg class="arrow" viewBox="0 0 16 20"><path d="M1 1 L1 15.6 L4.9 12.2 L7.6 18.4 L10.2 17.2 L7.6 11.2 L12.8 11.2 Z" fill="${a.color}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>
    <div class="tag"><span class="face"><canvas></canvas></span><b></b><span class="what"></span></div>`;
  el.querySelector('b').textContent = a.name;
  root.appendChild(el);
  const m = new Mascot3D(el.querySelector('canvas'), { shared: true, color: a.color, outfit: a.outfit || {}, emotion: 'focused', frame: 1.55, idle: true });
  const [sx, sy] = [innerWidth * 0.5, innerHeight + 60];
  g = { aid, a, el, m, x: sx, y: sy, hide: 0, what: el.querySelector('.what') };
  el.style.transform = `translate(${sx}px, ${sy}px)`;
  ghosts.set(aid, g);
  return g;
}

function wake(g) {
  clearTimeout(g.hide);
  if (g.el.style.opacity !== '1') animate(g.el, { opacity: [0, 1], scale: [0.6, 1] }, { duration: 0.35, ease: [0.22, 1, 0.36, 1] });
  g.el.style.opacity = '1';
  g.hide = setTimeout(() => animate(g.el, { opacity: 0, scale: 0.8 }, { duration: 0.5 }).then(() => (g.el.style.opacity = '0')), 3600);
  if (tauri) tauri.window.getCurrentWindow().show();
}

function glide(g, x, y) {
  wake(g);
  const from = [g.x, g.y];
  g.x = x; g.y = y;
  // separate springs for x and y give a natural, slightly curved path
  animate(g.el, { x: [from[0], x] }, { type: 'spring', stiffness: 170, damping: 22 });
  animate(g.el, { y: [from[1], y] }, { type: 'spring', stiffness: 130, damping: 20 });
}

function frame(g, r, linger = 1100) {
  const hl = document.createElement('div');
  hl.className = 'hl';
  hl.style.setProperty('--c', g.a.color);
  Object.assign(hl.style, { left: r.x - 4 + 'px', top: r.y - 4 + 'px', width: r.w + 8 + 'px', height: r.h + 8 + 'px' });
  root.prepend(hl);
  animate(hl, { opacity: [0, 1], scale: [1.12, 1] }, { duration: 0.32, ease: [0.22, 1, 0.36, 1] });
  setTimeout(() => animate(hl, { opacity: 0 }, { duration: 0.45 }).then(() => hl.remove()), linger);
}

function ripple(g, x, y, delay = 0) {
  setTimeout(() => {
    g.el.classList.add('press');
    setTimeout(() => g.el.classList.remove('press'), 160);
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.setProperty('--c', g.a.color);
    Object.assign(r.style, { left: x + 'px', top: y + 'px' });
    root.appendChild(r);
    animate(r, { opacity: [0.9, 0], scale: [0.4, 2.6] }, { duration: 0.6, ease: [0.22, 1, 0.36, 1] }).then(() => r.remove());
  }, delay);
}

function typed(g, r, text, delay = 0) {
  const b = document.createElement('div');
  b.className = 'typing';
  b.style.setProperty('--c', g.a.color);
  // above the field, so it never sits on the cursor's name tag (below it if there's no room)
  const below = r.y < 60;
  Object.assign(b.style, { left: r.x + 'px', top: (below ? r.y + r.h + 44 : r.y - 44) + 'px' });
  root.appendChild(b);
  setTimeout(() => {
    animate(b, { opacity: [0, 1], y: [below ? -6 : 6, 0] }, { duration: 0.25 });
    const chars = [...text];
    let i = 0;
    const t = setInterval(() => {
      b.textContent = chars.slice(0, ++i).join('');
      if (i >= chars.length) { clearInterval(t); setTimeout(() => animate(b, { opacity: 0 }, { duration: 0.4 }).then(() => b.remove()), 900); }
    }, Math.max(12, Math.min(45, 900 / chars.length)));
  }, delay);
}

function keycaps(g, x, y, combo) {
  const k = document.createElement('div');
  k.className = 'keys';
  k.style.setProperty('--c', g.a.color);
  k.innerHTML = combo.split(/[\s+]+/).filter(Boolean).map((s) => `<kbd>${s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1)}</kbd>`).join('');
  Object.assign(k.style, { left: x + 24 + 'px', top: y - 40 + 'px' });
  root.appendChild(k);
  animate(k, { opacity: [0, 1], y: [8, 0], scale: [0.9, 1] }, { type: 'spring', stiffness: 420, damping: 26 });
  setTimeout(() => animate(k, { opacity: 0, y: -8 }, { duration: 0.35 }).then(() => k.remove()), 1100);
}

function scan(g, r) {
  const s = document.createElement('div');
  s.className = 'scan';
  s.style.setProperty('--c', g.a.color);
  Object.assign(s.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  s.innerHTML = '<i></i><i></i><i></i><i></i><b></b>';
  root.prepend(s);
  animate(s, { opacity: [0, 1], scale: [1.04, 1] }, { duration: 0.35, ease: [0.22, 1, 0.36, 1] });
  animate(s.querySelector('b'), { y: [-90, r.h] }, { duration: 0.85, ease: [0.45, 0, 0.2, 1] });
  setTimeout(() => animate(s, { opacity: 0 }, { duration: 0.4 }).then(() => s.remove()), 950);
  g.what.textContent = 'Reading';
  wake(g);
}

function trail(g, x, y) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'trail');
  svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight);
  svg.style.setProperty('--c', g.a.color);
  svg.innerHTML = `<path d="M${g.x} ${g.y} Q ${(g.x + x) / 2} ${Math.min(g.y, y) - 40} ${x} ${y}"/>`;
  root.prepend(svg);
  setTimeout(() => animate(svg, { opacity: 0 }, { duration: 0.5 }).then(() => svg.remove()), 900);
}

/** One event from an agent (the same shapes the runtime sends). */
export function onEvent(aid, e) {
  const g = ghost(aid);
  switch (e.kind) {
    case 'scan': scan(g, box(e)); break;
    case 'step': g.what.textContent = e.text; break;
    case 'point': {
      const r = box(e);
      const pt = e.w ? [r.x + Math.min(r.w * 0.5, 60), r.y + r.h * 0.6] : [r.x, r.y];
      if (e.action === 'drag') trail(g, pt[0], pt[1]);
      glide(g, pt[0], pt[1]);
      if (e.w) frame(g, r);
      if (e.action === 'click' || e.action === 'drag') ripple(g, pt[0], pt[1], 230);
      if (e.action === 'type' && e.text) typed(g, r.w ? r : { x: pt[0], y: pt[1], w: 0, h: 0 }, e.text, 200);
      if (e.action === 'key' && e.text) keycaps(g, pt[0], pt[1], e.text);
      break;
    }
    case 'done':
      g.what.textContent = 'Done';
      g.m.setEmotion('happy'); g.m.hop();
      wake(g);
      break;
    case 'stopped': case 'error':
      g.what.textContent = e.kind === 'error' ? 'Stopped' : 'Paused';
      wake(g);
      break;
  }
}

async function start() {
  if (tauri) {
    const w = tauri.window.getCurrentWindow();
    const [pos, scale] = await Promise.all([w.outerPosition(), w.scaleFactor()]);
    origin = { x: pos.x, y: pos.y, scale };
    tauri.event.listen('agent-event', ({ payload }) => onEvent(payload.agent, payload.event));
  }
  if (demo) import('./ghost-demo.js').then((d) => d.play(onEvent, looks));
}
start();
