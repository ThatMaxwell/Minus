// Command palette (mod+K): jump to an agent, a place, or an action.
import { state, go } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, sheet } from '../ui.js';
import { agent } from '../store.js';
import { openCreate } from './create.js';

export function palette() {
  if ($('.palette')) return;
  const actions = [
    { t: 'New agent', i: 'plus', k: 'N', run: () => openCreate() },
    { t: 'Morning stand-up', i: 'sunrise', run: () => go('standup') },
    { t: 'Approvals', i: 'inbox', run: () => go('approvals') },
    { t: 'Routines', i: 'routine', run: () => go('routines') },
    { t: 'Computers', i: 'monitor', run: () => go('computers') },
    { t: 'Settings', i: 'gear', k: ',', run: () => go('settings') },
  ];
  const items = () => [...state.agents.map((a) => ({ t: a.name, sub: a.role || 'Agent', a, run: () => go('chat', { agent: a.id }) })), ...actions];
  const s = sheet(`<div class="palette"><div class="pal-in">${icon('search')}<input placeholder="Jump to an agent or do something…" aria-label="Search"><kbd>Esc</kbd></div><div class="pal-list" role="listbox"></div></div>`, { cls: 'pal' });
  const inp = $('input', s.el), list = $('.pal-list', s.el);
  let sel = 0, shown = [];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    shown = items().filter((x) => !q || x.t.toLowerCase().includes(q) || (x.sub || '').toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((x, i) => `<button role="option" aria-selected="${i === sel}" data-i="${i}">${x.a ? face(x.a, 24) : icon(x.i)}<span class="pl-t">${esc(x.t)}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}${x.k ? `<kbd>${x.k}</kbd>` : ''}</button>`).join('') || '<p class="muted pal-empty">Nothing matches</p>';
    mountMascots(list, agent);
  };
  const runSel = () => { const x = shown[sel]; if (x) { s.close(); x.run(); } };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); e.preventDefault(); mark(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); e.preventDefault(); mark(); }
    if (e.key === 'Enter') { e.preventDefault(); runSel(); }
  });
  const mark = () => $$('[data-i]', list).forEach((b, i) => { b.setAttribute('aria-selected', i === sel); if (i === sel) b.scrollIntoView({ block: 'nearest' }); });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { sel = +b.dataset.i; runSel(); } });
  list.addEventListener('pointermove', (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; mark(); } });
  draw(); inp.focus();
}
