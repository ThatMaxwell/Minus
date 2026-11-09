// Small UI toolkit: escaping, icons, mascots, tooltips, toasts, menus and sheets.
import { Mascot3D } from '../js/mascot3d.js';
import { state } from './store.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const motion = () => window.Motion;
export const IN = [0.22, 1, 0.36, 1];
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl';

/* ───────── icons (1.6px strokes, 20px grid) ───────── */
const P = {
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  search: '<circle cx="9" cy="9" r="5"/><path d="M13 13l3.5 3.5"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  x: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
  inbox: '<path d="M3.5 11.5l2-6.5h9l2 6.5v4h-13z"/><path d="M3.5 11.5h4l1 2h3l1-2h4"/>',
  clock: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
  monitor: '<rect x="3" y="4" width="14" height="9.5" rx="1.8"/><path d="M7.5 16.5h5M10 13.5v3"/>',
  gear: '<circle cx="10" cy="10" r="2.4"/><path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4"/>',
  send: '<path d="M10 15.5v-11M5.5 9l4.5-4.5L14.5 9"/>',
  mic: '<rect x="7.5" y="3.5" width="5" height="8.5" rx="2.5"/><path d="M5 10a5 5 0 0010 0M10 15v2"/>',
  paperclip: '<path d="M14.5 9.5l-5 5a3 3 0 01-4.2-4.2l5.6-5.6a2 2 0 012.8 2.8L8.3 13"/>',
  more: '<circle cx="5" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="15" cy="10" r=".9"/>',
  sparkle: '<path d="M10 3.5l1.6 4.9 4.9 1.6-4.9 1.6L10 16.5l-1.6-4.9L3.5 10l4.9-1.6z"/>',
  hand: '<path d="M7 10V5.5a1.2 1.2 0 012.4 0V9M9.4 9V4.5a1.2 1.2 0 012.4 0V9M11.8 9V5.5a1.2 1.2 0 012.4 0v5.5a5 5 0 01-5 5h-.6a5 5 0 01-4-2L3 11.2a1.2 1.2 0 011.9-1.4L7 12"/>',
  panel: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M11.5 4v12"/>',
  chevron: '<path d="M7.5 5l5 5-5 5"/>',
  back: '<path d="M12.5 5l-5 5 5 5"/>',
  dice: '<rect x="3.5" y="3.5" width="13" height="13" rx="3"/><circle cx="7.3" cy="7.3" r=".9"/><circle cx="12.7" cy="12.7" r=".9"/><circle cx="12.7" cy="7.3" r=".9"/><circle cx="7.3" cy="12.7" r=".9"/><circle cx="10" cy="10" r=".9"/>',
  pause: '<path d="M7.5 5v10M12.5 5v10"/>',
  play: '<path d="M7 5l8 5-8 5z"/>',
  github: '<path d="M10 2.5a7.5 7.5 0 00-2.4 14.6c.4.1.5-.2.5-.4v-1.3c-2.1.5-2.5-1-2.5-1-.3-.9-.8-1.1-.8-1.1-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.8.8 2.2.6.1-.5.3-.8.5-1-1.7-.2-3.4-.8-3.4-3.7 0-.8.3-1.5.8-2-.1-.2-.3-1 .1-2 0 0 .6-.2 2 .8a7 7 0 013.7 0c1.4-1 2-.8 2-.8.4 1 .2 1.8.1 2 .5.5.8 1.2.8 2 0 2.9-1.8 3.5-3.4 3.7.3.2.5.7.5 1.4v2.1c0 .2.1.5.5.4A7.5 7.5 0 0010 2.5z"/>',
  phone: '<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2"/>',
  key: '<circle cx="7" cy="12.5" r="3"/><path d="M9.2 10.3L15.5 4M13 6.5l2 2"/>',
  bell: '<path d="M5.5 13.5V9a4.5 4.5 0 019 0v4.5l1.2 1.5H4.3z"/><path d="M8.5 16.5a1.6 1.6 0 003 0"/>',
  shield: '<path d="M10 3.5l5.5 2v4.2c0 3.4-2.3 5.7-5.5 6.8-3.2-1.1-5.5-3.4-5.5-6.8V5.5z"/>',
  cloud: '<path d="M6 15h8a3.5 3.5 0 00.4-7A5 5 0 004.6 9.5 2.8 2.8 0 006 15z"/>',
  laptop: '<rect x="4.5" y="5" width="11" height="7.5" rx="1.2"/><path d="M2.5 15h15"/>',
  trash: '<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="1.8"/><path d="M13 7V5.5A1.5 1.5 0 0011.5 4h-6A1.5 1.5 0 004 5.5v6A1.5 1.5 0 005.5 13H7"/>',
  keyboard: '<rect x="2.5" y="5.5" width="15" height="9" rx="2"/><path d="M5.5 8.5h.01M8.5 8.5h.01M11.5 8.5h.01M14.5 8.5h.01M6.5 11.5h7"/>',
  book: '<path d="M4.5 4.5A1.5 1.5 0 016 3h9.5v12H6a1.5 1.5 0 00-1.5 1.5z"/><path d="M4.5 16.5A1.5 1.5 0 006 18h9.5v-3M7.5 6.5h5M7.5 9h3.5"/>',
  edit: '<path d="M12.5 4.5l3 3-8.5 8.5H4v-3z"/>',
  showme: '<path d="M4.5 3.5l9 3.8-3.7 1.3-1.4 3.7z"/><circle cx="14.2" cy="14.2" r="2.3"/><path d="M10.4 8.6l2 2"/>',
  sunrise: '<path d="M2.5 15h15M5.5 15a4.5 4.5 0 019 0"/><path d="M10 4.5V7M4.6 7.6l1.6 1.6M15.4 7.6l-1.6 1.6"/>',
  room: '<circle cx="10" cy="11.5" r="3.2"/><circle cx="4.3" cy="7" r="1.5"/><circle cx="10" cy="4.3" r="1.5"/><circle cx="15.7" cy="7" r="1.5"/><path d="M3.6 15.6c1.6 1.3 3.9 1.9 6.4 1.9s4.8-.6 6.4-1.9"/>',
  rewind: '<path d="M9.6 5.5L3.8 10l5.8 4.5zM16.2 5.5L10.4 10l5.8 4.5z"/>',
  file: '<path d="M5.5 2.8h6l3.5 3.5v10.9h-9.5z"/><path d="M11.5 2.8v3.5H15"/>',
  timer: '<circle cx="10" cy="11" r="6"/><path d="M10 7.8V11l2 1.4M8 2.8h4"/>',
  bolt: '<path d="M11 3.5L5.5 11H10l-1 5.5L14.5 9H10z"/>',
  routine: '<path d="M4 10a6 6 0 0110.4-4M16 10a6 6 0 01-10.4 4"/><path d="M14.5 3v3.2h-3.2M5.5 17v-3.2h3.2"/>',
  speaker: '<path d="M3.5 8h2.8L10 5v10l-3.7-3H3.5z"/><path d="M13 7.6a3.4 3.4 0 010 4.8M15.2 5.5a6.4 6.4 0 010 9"/>',
  stop: '<rect x="5.5" y="5.5" width="9" height="9" rx="1.5"/>',
  eye: '<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/>',
  arrow: '<path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5"/>',
  handoff: '<path d="M3.5 10h9M9.5 6.5L13 10l-3.5 3.5M16.5 5v10"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 20 20" aria-hidden="true">${P[name] || ''}</svg>`;

/* ───────── mascots ───────── */
const live = new Set();
// A live 3D agent in a canvas that is already on the page.
export function mascot(canvas, a, opts = {}) {
  // agents rest neutral and idle their own way; how they feel shows up while they work
  // how it feels today (moods.js) is how it rests
  const rest = opts.emotion || (a.mood && a.mood !== 'neutral' ? a.mood : 'neutral');
  const m = new Mascot3D(canvas, { shared: true, frame: 1.62, idle: state.settings.lively, color: a.color, outfit: a.outfit, idleStyle: a.idle || 'calm', ...opts, emotion: rest });
  m.agentId = a.id; m.rest = rest; live.add(m);
  return m;
}
export const mascotsOf = (aid) => [...live].filter((m) => { if (!m.running) { live.delete(m); return false; } return m.agentId === aid; });
export const allMascots = () => [...live].filter((m) => m.running);
// Mount every <canvas data-agent="id"> inside root.
export function mountMascots(root, getAgent) {
  $$('canvas[data-agent]', root).forEach((c) => {
    if (c._m) return;
    const a = getAgent(c.dataset.agent); if (!a) return;
    c._m = mascot(c, a, { follow: c.dataset.follow === '1', emotion: c.dataset.emotion || undefined, frame: c.dataset.frame ? +c.dataset.frame : 1.62 });
  });
}
export const face = (a, size = 28, extra = '') => `<span class="face" style="--s:${size}px"><canvas data-agent="${esc(a.id)}" ${extra} aria-hidden="true"></canvas></span>`;

/* ───────── tooltips: anything with data-tip ───────── */
export function tooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
  let t = 0, cur = null;
  const show = (el) => {
    cur = el;
    const r = el.getBoundingClientRect(), [text, keys] = el.dataset.tip.split('|');
    tip.innerHTML = esc(text) + (keys ? `<kbd>${esc(keys.replace('mod', mod))}</kbd>` : '');
    tip.classList.add('on');
    const tw = tip.offsetWidth, th = tip.offsetHeight, below = el.dataset.tipPos === 'bottom' || r.top < th + 16;
    const right = el.dataset.tipPos === 'right';
    let x = right ? r.right + 10 : r.left + r.width / 2 - tw / 2, y = right ? r.top + r.height / 2 - th / 2 : below ? r.bottom + 8 : r.top - th - 8;
    x = Math.max(8, Math.min(innerWidth - tw - 8, x));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  const hide = () => { clearTimeout(t); cur = null; tip.classList.remove('on'); };
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el === cur) return;
    hide();
    if (el) t = setTimeout(() => el.isConnected && show(el), 420);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && e.target.matches(':focus-visible')) show(el); });
  document.addEventListener('focusout', hide);
}

/* ───────── toasts ───────── */
export function toast(text, { icon: ic = 'check', tone = '' } = {}) {
  let host = $('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + tone; t.innerHTML = icon(ic) + `<span>${esc(text)}</span>`;
  host.appendChild(t);
  motion().animate(t, { opacity: [0, 1], y: [12, 0], scale: [0.96, 1] }, { type: 'spring', stiffness: 400, damping: 30 });
  setTimeout(() => motion().animate(t, { opacity: 0, y: 8 }, { duration: 0.25 }).then(() => t.remove()), 2600);
}

/* ───────── menus ───────── */
export function menu(anchor, items, { align = 'left' } = {}) {
  closeMenus();
  const m = document.createElement('div');
  m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="menu-sep"></div>' : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-i="${i}" ${it.checked ? 'aria-checked="true"' : ''}>${it.svg || (it.icon ? icon(it.icon) : '')}<span>${esc(it.label)}</span>${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : ''}${it.checked ? `<span class="menu-check">${icon('check')}</span>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  let x = align === 'right' ? r.right - w : r.left, y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = r.top - h - 6;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px'; m.style.top = y + 'px';
  motion().animate(m, { opacity: [0, 1], scale: [0.96, 1], y: [-4, 0] }, { type: 'spring', stiffness: 500, damping: 34 });
  m.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; closeMenus(); items[+b.dataset.i].run?.(); });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  function outside(e) { if (!m.contains(e.target)) { closeMenus(); document.removeEventListener('pointerdown', outside, true); } }
  m.querySelector('button')?.focus({ preventScroll: true });
  return m;
}
export const closeMenus = () => $$('.menu').forEach((m) => m.remove());

/* ───────── sheets (modals) ───────── */
export function sheet(content, { cls = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'scrim';
  wrap.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true">${content}</div>`;
  document.body.appendChild(wrap);
  const s = wrap.firstElementChild;
  motion().animate(wrap, { opacity: [0, 1] }, { duration: 0.2 });
  motion().animate(s, { opacity: [0, 1], scale: [0.96, 1], y: [16, 0] }, { type: 'spring', stiffness: 380, damping: 32 });
  const close = async () => {
    removeEventListener('keydown', esc_);
    await Promise.all([motion().animate(s, { opacity: 0, scale: 0.97, y: 10 }, { duration: 0.18 }), motion().animate(wrap, { opacity: 0 }, { duration: 0.2 })]);
    wrap.remove(); onClose?.();
  };
  const esc_ = (e) => { if (e.key === 'Escape' && !$('.menu')) close(); };
  addEventListener('keydown', esc_);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  return { el: s, close };
}

export function timeAgo(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}
