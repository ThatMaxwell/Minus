// The agent's notebook: what it has learned about you and your work, as notes you can read,
// fix and add to. The agent reads it before every job, and writes in it as it learns
// ("remember" in the runtime). Nothing hidden: if it's not in the notebook, it doesn't know it.
import { state, agent, updateAgent, id, emit, on } from './store.js';
import { $, esc, icon, motion, IN, timeAgo, toast } from './ui.js';
import { react } from './director.js';
import * as teach from './teach.js';

const notes = (a) => (a.notebook ||= []);

export function add(aid, text, by = 'agent') {
  const a = agent(aid); if (!a || !text?.trim()) return;
  const n = { id: id('note'), text: text.trim(), at: Date.now(), by };
  notes(a).unshift(n);
  updateAgent(aid, { notebook: a.notebook });
  emit('remember', { agent: aid, note: n });
  return n;
}
export function edit(aid, nid, text) {
  const a = agent(aid), n = notes(a).find((x) => x.id === nid); if (!n) return;
  n.text = text.trim(); n.edited = Date.now();
  updateAgent(aid, { notebook: a.notebook });
}
export function remove(aid, nid) {
  const a = agent(aid);
  a.notebook = notes(a).filter((x) => x.id !== nid);
  updateAgent(aid, { notebook: a.notebook });
}
/** The notebook as text, handed to the agent with each job. */
export function asText(a) {
  const ns = notes(a).filter((n) => n.text);
  return ns.length ? `Your notebook (things you've learned; use them):\n${ns.map((n) => `- ${n.text}`).join('\n')}` : '';
}

const card = (aid, n, i) => `<article class="nb-card ${n.by === 'you' ? 'yours' : ''}" data-nid="${esc(n.id)}" style="--tilt:${(i % 2 ? 0.6 : -0.5) * (i % 3 === 2 ? -1 : 1)}deg">
  <p class="nb-text" tabindex="0" data-tip="Click to edit">${esc(n.text)}</p>
  <footer><span>${n.by === 'you' ? 'You wrote this' : 'Learned'} · ${timeAgo(n.edited || n.at)}</span><button class="nb-x" data-nbx aria-label="Remove this note" data-tip="Remove">${icon('x')}</button></footer>
</article>`;

const skillCard = (a, s) => {
  const ins = teach.inputsOf(s.steps);
  const line = (st) => esc(teach.describe(st)).replace(/“\{\{\s*([^}]+?)\s*\}\}”/g, (_, k) => `<span class="sk-chip">${icon('bolt')}${esc(k.replace(/_/g, ' '))}</span>`);
  return `<article class="sk-card" data-sid="${esc(s.id)}">
    <header><span class="sk-ic">${icon('showme')}</span><div><b>${esc(s.name)}</b><span>${s.steps.length} step${s.steps.length === 1 ? '' : 's'} · shown ${((t) => (t === 'now' ? 'just now' : t + ' ago'))(timeAgo(s.at || Date.now()))}</span></div>
      <button class="nb-x" data-skx aria-label="Forget this skill" data-tip="Forget it">${icon('x')}</button></header>
    <ol>${s.steps.slice(0, 4).map((st) => `<li>${line(st)}</li>`).join('')}${s.steps.length > 4 ? `<li class="more">and ${s.steps.length - 4} more</li>` : ''}</ol>
    <footer><span>${ins.length ? `Asks for ${ins.map((i) => esc(i.replace(/_/g, ' '))).join(', ')}` : 'Same every time'}</span><button class="btn btn-primary btn-xs" data-skrun>${icon('play')}Run</button></footer>
  </article>`;
};
const showMe = (a) => `<div class="sk-teach"><span class="sk-ic big">${icon('showme')}</span><div><b>Show ${esc(a.name)} once</b><p>Do a job yourself while ${esc(a.name)} watches. It can do it again by itself, with new details each time.</p></div><button class="btn btn-sm" data-teach>${icon('eye')}Start</button></div>`;
const skillsHTML = (a) => showMe(a) + ((a.skills || []).map((s) => skillCard(a, s)).join('') || '');

/** Opens the notebook over the chat (the computer panel side). */
export function open(main, aid, tab = 'notes') {
  const a = agent(aid); if (!a) return;
  main.querySelector('.nb')?.remove();
  const body = main.querySelector('.ch-body');
  const el = document.createElement('section');
  el.className = 'nb';
  el.setAttribute('aria-label', `${a.name}’s notebook`);
  el.innerHTML = `<header class="nb-h"><div><h3>${esc(a.name)}’s notebook</h3><p>What ${esc(a.name)} knows about you and the job. Read before every task.</p></div><button class="icon-btn" data-nbclose aria-label="Close" data-tip="Close|Esc">${icon('x')}</button></header>
    <div class="nb-tabs" role="tablist"><button role="tab" data-tab="notes">Notes<span>${notes(a).length || ''}</span></button><button role="tab" data-tab="skills">Skills<span>${(a.skills || []).length || ''}</span></button><i class="nb-tab-ink"></i></div>
    <div class="nb-pane" data-pane="notes"><form class="nb-add"><input id="nb-new" placeholder="Tell ${esc(a.name)} something to remember…" autocomplete="off" aria-label="A new note"><button class="icon-btn sm" aria-label="Add" data-tip="Add|Enter">${icon('plus')}</button></form>
    <div class="nb-list">${notes(a).map((n, i) => card(aid, n, i)).join('') || empty(a)}</div></div>
    <div class="nb-pane" data-pane="skills"><div class="nb-list sk-list">${skillsHTML(a)}</div></div>`;
  body.appendChild(el);
  const M = motion();
  M.animate(el, { opacity: [0, 1], x: [40, 0] }, { duration: 0.42, ease: IN });
  const show = (t, animateIn = true) => {
    tab = t;
    el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    el.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
    const b = el.querySelector(`[data-tab="${t}"]`), ink = el.querySelector('.nb-tab-ink');
    M.animate(ink, { x: b.offsetLeft, width: b.offsetWidth }, animateIn ? { type: 'spring', stiffness: 420, damping: 34 } : { duration: 0 });
    if (animateIn) M.animate(el.querySelectorAll(`[data-pane="${t}"] .nb-list > *`), { opacity: [0, 1], y: [14, 0], scale: [0.97, 1] }, { delay: M.stagger(0.045, { start: 0.05 }), duration: 0.42, ease: IN });
  };
  requestAnimationFrame(() => show(tab, false));
  M.animate(el.querySelectorAll(`[data-pane="${tab}"] .nb-list > *`), { opacity: [0, 1], y: [14, 0], scale: [0.96, 1] }, { delay: M.stagger(0.045, { start: 0.1 }), duration: 0.45, ease: IN });
  react(aid, 'look', el);

  const close = () => { off(); M.animate(el, { opacity: 0, x: 40 }, { duration: 0.25 }).then(() => el.remove()); };
  const esc_ = (e) => { if (e.key === 'Escape' && !e.target.closest?.('.nb-text[contenteditable="true"]')) close(); };
  addEventListener('keydown', esc_);
  const offAdd = on('remember', ({ agent: who, note }) => {
    if (who !== aid || !el.isConnected) return;
    const list = el.querySelector('.nb-list');
    list.querySelector('.nb-empty')?.remove();
    list.insertAdjacentHTML('afterbegin', card(aid, note, 0));
    M.animate(list.firstElementChild, { opacity: [0, 1], y: [-30, 0], rotate: [-6, 0], scale: [0.9, 1] }, { type: 'spring', stiffness: 260, damping: 18 });
  });
  const offSkill = on('skill', ({ agent: who }) => {
    if (who !== aid || !el.isConnected) return;
    el.querySelector('.sk-list').innerHTML = skillsHTML(agent(aid));
    el.querySelector('[data-tab="skills"] span').textContent = (agent(aid).skills || []).length || '';
    show('skills');
  });
  const off = () => { offAdd(); offSkill(); removeEventListener('keydown', esc_); };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-nbclose]')) return close();
    const tb = e.target.closest('[data-tab]'); if (tb) return show(tb.dataset.tab);
    if (e.target.closest('[data-teach]')) { close(); return teach.start(aid); }
    const sr = e.target.closest('[data-skrun]'); if (sr) { close(); return teach.run(aid, sr.closest('.sk-card').dataset.sid); }
    const sx = e.target.closest('[data-skx]');
    if (sx) {
      const c = sx.closest('.sk-card');
      M.animate(c, { opacity: 0, scale: 0.9, x: 30 }, { duration: 0.25 }).then(() => { c.remove(); teach.remove(aid, c.dataset.sid); el.querySelector('[data-tab="skills"] span').textContent = (agent(aid).skills || []).length || ''; });
      react(aid, 'worried');
      return;
    }
    const x = e.target.closest('[data-nbx]');
    if (x) {
      const c = x.closest('.nb-card');
      M.animate(c, { opacity: 0, scale: 0.6, rotate: 12, y: 20 }, { duration: 0.3, ease: [0.5, 0, 0.75, 0] }).then(() => { c.remove(); remove(aid, c.dataset.nid); if (!notes(agent(aid)).length) el.querySelector('.nb-list').innerHTML = empty(agent(aid)); });
      react(aid, 'worried');
      return;
    }
    const t = e.target.closest('.nb-text');
    if (t && t.contentEditable !== 'true') {
      t.contentEditable = 'true'; t.focus();
      document.getSelection()?.selectAllChildren(t); document.getSelection()?.collapseToEnd();
      t.addEventListener('blur', () => { t.contentEditable = 'false'; const v = t.textContent.trim(); if (v) { edit(aid, t.closest('.nb-card').dataset.nid, v); react(aid, 'yes'); } }, { once: true });
      t.addEventListener('keydown', (k) => { if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); t.blur(); } if (k.key === 'Escape') { t.blur(); } });
    }
  });
  el.querySelector('.nb-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = el.querySelector('#nb-new'), v = i.value.trim(); if (!v) return;
    i.value = '';
    add(aid, v, 'you');
    react(aid, 'yes');
  });
  if (tab === 'notes') setTimeout(() => el.querySelector('#nb-new')?.focus({ preventScroll: true }), 80);
  return close;
}

const empty = (a) => `<div class="nb-empty"><div class="nb-empty-ic">${icon('book')}</div><p>Nothing yet. ${esc(a.name)} writes here as it learns how you like things done, and you can add notes too.</p></div>`;

/** A note flies from the agent's face into the notebook button. */
export function fly(main, aid, text) {
  const from = main.querySelector('.ch-who .face'), to = main.querySelector('[data-act="notebook"]');
  if (!from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'nb-fly';
  p.textContent = text.length > 46 ? text.slice(0, 44) + '…' : text;
  document.body.appendChild(p);
  const M = motion();
  const sx = a.left + a.width / 2, sy = a.top + a.height / 2, ex = b.left + b.width / 2, ey = b.top + b.height / 2;
  M.animate(p, { x: [sx, (sx + ex) / 2, ex], y: [sy, Math.min(sy, ey) - 70, ey], scale: [0.4, 1, 0.2], opacity: [0, 1, 0], rotate: [-8, 4, 0] }, { duration: 1.1, ease: [0.45, 0, 0.2, 1] })
    .then(() => { p.remove(); M.animate(to, { scale: [1, 1.25, 1] }, { duration: 0.35 }); });
}

export const count = (a) => (a.notebook || []).length;
