// Sidebar: search, your pinned agents up top (big), every other agent with what it last said,
// and the places (stand-up, room, approvals, routines, computers, settings) as a row of icons.
import { state, on, go, save, pendingApprovals, agent } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, menu, timeAgo } from '../ui.js';
import { STATUS } from '../data.js';
import { openCreate } from './create.js';
import * as su from '../standup.js';
import * as acct from '../account.js';
import * as saved from '../saved.js';
import { WORDS } from '../moods.js';
import { musingHTML } from '../musing.js';

const PLACES = [
  ['standup', 'sunrise', 'Stand-up: what every agent did, and what it needs'],
  ['room', 'room', 'Ask the room: one question, every agent answers'],
  ['approvals', 'inbox', 'Approvals: things waiting for your OK'],
  ['routines', 'routine', 'Routines: work that runs on a schedule'],
  ['computers', 'monitor', 'Computers: cloud computers and this one'],
];
const pinned = () => (state.settings.pinned ||= []).filter((id) => agent(id));
export const isPinned = (id) => pinned().includes(id);
export function togglePin(id) {
  const p = pinned();
  state.settings.pinned = p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-3);
  save();
}

// What an agent last said (or is doing now), for its row.
const plain = (t) => String(t || '').replace(/<?\[\[[a-z -]+\]\]?>?/gi, '').replace(/[*_`#>~]|\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
function last(a) {
  const t = state.threads[a.id] || [];
  for (let i = t.length - 1; i >= 0; i--) {
    const m = t[i];
    if (m.kind === 'day') continue;
    const who = m.from === 'me' ? 'You: ' : '';
    const text = m.kind === 'steps' ? (m.live ? m.steps?.[m.steps.length - 1] || 'Working' : `Worked on ${m.done || 0} step${m.done === 1 ? '' : 's'}`)
      : m.kind === 'approval' ? (m.state === 'pending' ? `Needs your OK: ${m.action}` : m.action)
      : m.kind === 'question' ? m.text : m.kind === 'mod' ? 'Safety warning' : m.text;
    if (text) return { text: who + plain(text), at: m.at || 0 };
  }
  return { text: a.role || 'New agent', at: 0 };
}

const status = (a) => (a.status === 'working' ? musingHTML(a, 'mz-row') : esc(last(a).text));
export const row = (a) => {
  const l = last(a);
  return `<button class="ag-row ${a.unread ? 'has-new' : ''}" role="listitem" data-agent="${esc(a.id)}">
    ${face(a, 34)}
    <span class="ag-meta"><span class="ag-top"><b>${esc(a.name)}</b><time>${l.at ? esc(timeAgo(l.at)) : ''}</time></span>
      <small class="ag-last ${a.status === 'waiting' ? 'needs' : ''}">${status(a)}</small></span>
    ${a.unread ? `<b class="unread">${a.unread}</b>` : a.status === 'waiting' ? '<i class="dot amber"></i>' : ''}
  </button>`;
};
export const pinHTML = (a) => `<button class="pin" data-agent="${esc(a.id)}" data-tip="${esc(a.role || a.name)}">${face(a, pinned().length > 1 ? 52 : 68, 'data-idle="1"')}<b>${esc(a.name)}</b>${a.status === 'working' ? musingHTML(a, 'mz-pin') : a.unread ? `<small>${a.unread} new</small>` : ''}</button>`;
/** Pinned agents first, then everyone else, most recent first (the phone's home uses it too). */
export const order = (match = () => true) => { const pin = new Set(pinned()); return { pins: pinned().map(agent).filter(match), rest: state.agents.filter((a) => !pin.has(a.id) && match(a)).sort((x, y) => last(y).at - last(x).at) }; };
export { last };

export function sidebar(el) {
  el.innerHTML = `
    <div class="sb-search"><label>${icon('search')}<input type="search" placeholder="Search agents and chats" aria-label="Search agents and chats" spellcheck="false"></label>
      <button class="icon-btn sb-new" data-new data-tip-pos="right" data-tip="New agent|mod N" aria-label="New agent">${icon('plus')}</button></div>
    <div class="sb-pins" hidden></div>
    <div class="ag-list" role="list"></div>
    <p class="sb-none" hidden>No agent matches that.</p>
    <div class="sb-foot">
      <nav class="sb-places" aria-label="Places">${PLACES.map(([go_, ic, tip]) => `<button class="icon-btn" data-go="${go_}" data-tip="${tip}" aria-label="${tip.split(':')[0]}">${icon(ic)}${go_ === 'approvals' ? '<b class="count" hidden></b>' : go_ === 'standup' ? '<i class="su-due" hidden></i>' : ''}</button>`).join('')}</nav>
      <div class="sb-me"><button class="me" data-go="standup"></button><button class="icon-btn" data-go="settings" data-tip="Settings|mod ," aria-label="Settings">${icon('gear')}</button></div>
    </div>`;

  const list = $('.ag-list', el), pins = $('.sb-pins', el), search = $('.sb-search input', el);
  let q = '';
  const matches = (a) => !q || [a.name, a.role, last(a).text].join(' ').toLowerCase().includes(q);
  const build = () => {
    const pin = new Set(pinned());
    const ps = pinned().map(agent).filter(matches);
    pins.hidden = !ps.length; pins.classList.toggle('many', ps.length > 1);
    pins.innerHTML = ps.map(pinHTML).join('');
    // most recent first, like a list of conversations
    const rest = state.agents.filter((a) => !pin.has(a.id) && matches(a)).sort((x, y) => last(y).at - last(x).at);
    list.innerHTML = rest.map(row).join('');
    $('.sb-none', el).hidden = !!(rest.length + ps.length) || !q;
    mountMascots(el, agent);
    mark();
  };
  const mark = () => {
    $$('[data-agent]', el).forEach((r) => r.classList.toggle('on', state.route.view === 'chat' && r.dataset.agent === state.route.agent));
    $$('.sb-places [data-go], .sb-me [data-go="settings"]', el).forEach((b) => b.classList.toggle('on', state.route.view === b.dataset.go));
    const n = pendingApprovals().length, c = $('.count', el);
    c.hidden = !n; c.textContent = n;
    $('.su-due', el).hidden = !su.due();
  };
  // small changes (status, last words) without rebuilding every face
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(build, 120); };
  const patch = (a) => {
    const r = $(`.ag-row[data-agent="${CSS.escape(a.id)}"]`, list);
    if (!r || isPinned(a.id)) return later();
    const s = $('.ag-last', r), was = s.querySelector('.musing') ? 'working' : '';
    if ((a.status === 'working') !== (was === 'working') || a.status !== 'working') { s.innerHTML = status(a); s.classList.toggle('needs', a.status === 'waiting'); }
  };

  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); build(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const r = $('[data-agent]', el); if (r) { go('chat', { agent: r.dataset.agent }); search.value = ''; q = ''; build(); } }
    if (e.key === 'Escape') { search.value = ''; q = ''; build(); search.blur(); }
  });
  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-agent]'); if (r) return go('chat', { agent: r.dataset.agent });
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    if (e.target.closest('[data-new]')) openCreate();
  });
  // right-click an agent: pin it to the top (or take it off)
  el.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('[data-agent]'); if (!r) return;
    e.preventDefault();
    const a = agent(r.dataset.agent), p = isPinned(a.id);
    menu(r, [
      { label: p ? 'Unpin' : 'Pin to the top', icon: 'bolt', run: () => { togglePin(a.id); build(); } },
      { label: `Open ${a.name}`, icon: 'arrow', run: () => go('chat', { agent: a.id }) },
    ]);
  });
  // hover a row and that agent looks up at you
  el.addEventListener('pointerover', (e) => {
    const r = e.target.closest('[data-agent]'); if (!r || r._hov) return;
    r._hov = true; mascotsOf(r.dataset.agent).forEach((m) => { if (el.contains(m.canvas)) { m.look(0.2, 0.3, { noBlink: true }); m.blink(); m.pointerT = 1.2; } });
  });
  el.addEventListener('pointerout', (e) => { const r = e.target.closest('[data-agent]'); if (r && !r.contains(e.relatedTarget)) r._hov = false; });

  // you, and how much time your agents saved you this week
  const me = (bump) => {
    const u = acct.user(), name = acct.login(), pic = u?.user_metadata?.avatar_url, w = saved.week();
    const box = $('.me', el);
    box.dataset.tip = 'About how long your agents’ work this week would have taken you by hand';
    box.innerHTML = `<span class="me-av">${pic ? `<img src="${esc(pic)}" alt="">` : esc((name || 'You').slice(0, 2).toUpperCase())}</span><span class="me-t"><b>${esc(name || 'You')}</b><small>${w.total >= 60 ? `${esc(saved.fmt(w.total))} saved this week` : u ? 'Signed in with GitHub' : 'Not signed in'}</small></span>`;
    if (bump) box.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
  };
  me();
  on('account', () => me());
  on('saved', ({ secs }) => me(secs));
  on('agent', patch);
  on('agents', build);
  on('route', (r) => {
    mark();
    // opening a chat reads it: its row stops saying there's something new
    const row = r?.view === 'chat' && $(`.ag-row[data-agent="${CSS.escape(r.agent || '')}"]`, list);
    if (row) { row.classList.remove('has-new'); row.querySelector('.unread')?.remove(); }
  });
  on('approvals', mark);
  on('standup', mark);
  on('settings', later);
  on('message', ({ agent: aid }) => {
    const a = agent(aid);
    if (a && !(state.route.view === 'chat' && state.route.agent === aid)) a.unread = (a.unread || 0) + 1;
    later();
  });
  on('message:update', later);
  // "now", "5m"… stay true
  setInterval(() => { if (!document.hidden && !q) $$('.ag-row', list).forEach((r) => { const a = agent(r.dataset.agent), tm = $('time', r), l = a && last(a); if (tm && l?.at) tm.textContent = timeAgo(l.at); }); }, 60e3);
  build();
}
