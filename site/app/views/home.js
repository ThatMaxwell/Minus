// The phone's home: your agents and what they're doing, what needs you, and getting set up
// (connect an AI, pair with your PC, turn on the island). Your PC's agents work on the PC; agents
// you make here live on the phone and answer with the phone's AI.
import { state, agent, on, go, pendingApprovals } from '../store.js';
import { $, esc, icon, face, mountMascots, motion, IN, toast } from '../ui.js';
import { STATUS } from '../data.js';
import * as acct from '../account.js';
import * as link from '../link.js';
import * as island from '../island.js';
import * as saved from '../saved.js';
import * as rt from '../runtime.js';
import { openCreate } from './create.js';
import * as sb from './sidebar.js';
import { menu } from '../ui.js';

let off = [], shown = 0;
export function leaveHome() { off.forEach((f) => f()); off = []; shown++; }

export function home(main) {
  leaveHome();
  const me = shown;
  let q = '';
  const match = (a) => !q || [a.name, a.role, sb.last(a).text].join(' ').toLowerCase().includes(q);
  const draw = async () => {
    const needs = pendingApprovals();
    const asks = state.agents.map((a) => { const t = state.threads[a.id] || [], l = t[t.length - 1]; return l?.from === 'agent' && ((l.kind === 'question' && !l.answered) || (l.choices && !l.chosen)) ? { a, m: l } : null; }).filter(Boolean);
    const isl = (await island.status().catch(() => null)) || {};
    if (me !== shown) return; // you've moved on to another screen meanwhile
    main.innerHTML = `<section class="home">
      <header class="hm-h"><span class="hm-logo">minus</span><span class="grow"></span>
        <button class="icon-btn" data-go="room" aria-label="Ask the room">${icon('room')}</button>
        <button class="icon-btn" data-new aria-label="New agent">${icon('plus')}</button></header>
      ${rt.desktop && !Object.keys(rt.ENGINES).some((p) => rt.hasKey(p)) ? `<div class="hm-card"><span class="hm-ic">${icon('key')}</span><div><b>Connect your AI</b><p>Agents on this phone think with your own AI: Claude, ChatGPT, Gemini and more. Paste a key once; it stays on this phone.</p></div><button class="btn btn-primary btn-sm" data-go="settings">Connect</button></div>` : ''}
      ${!link.linked() ? `<div class="hm-card hm-pair"><span class="hm-ic">${icon('phone')}</span><div><b>Connect to your computer</b><p>${acct.configured() ? 'On your PC, open Minus → Settings → Devices → New, and scan the code with this phone. Or sign in with the same GitHub account.' : 'Sign-in isn’t set up on this build yet.'}</p></div>${acct.configured() ? `<button class="btn btn-primary btn-sm" data-signin>${icon('github')}<span>Sign in</span></button>` : ''}</div>` : ''}
      ${isl.supported && !isl.granted && island.enabled() ? `<div class="hm-card"><span class="hm-ic">${icon('sparkle')}</span><div><b>See your agents over other apps</b><p>A small island shows who’s working, and pops open when someone needs you. Android calls this “Display over other apps”.</p></div><button class="btn btn-sm" data-island>Turn on</button></div>` : ''}
      ${needs.length || asks.length ? `<h2 class="hm-sec">Needs you</h2><div class="hm-needs">
        ${needs.map(({ agent: a, msg: m }) => `<button class="hm-need" data-open="${esc(a.id)}">${face(a, 34)}<span class="hm-t"><b>${esc(m.action)}</b><small>${esc(a.name)} needs your OK</small></span>${icon('chevron')}</button>`).join('')}
        ${asks.map(({ a, m }) => `<button class="hm-need" data-open="${esc(a.id)}">${face(a, 34)}<span class="hm-t"><b>${esc(m.text)}</b><small>${esc(a.name)} has a question</small></span>${icon('chevron')}</button>`).join('')}</div>` : ''}
      ${!state.agents.length ? `<div class="hm-card"><span class="hm-ic">${icon('plus')}</span><div><b>Make your first agent</b><p>Give it a name and a job, and talk to it right here. Agents you make on your PC show up here too, and work on the PC.</p></div><button class="btn btn-primary btn-sm" data-new>New agent</button></div>` : ''}
      ${state.agents.length ? `<div class="sb-search hm-search"><label>${icon('search')}<input type="search" placeholder="Search agents and chats" aria-label="Search agents and chats" spellcheck="false" value="${esc(q)}"></label></div>` : ''}
      ${(() => { const { pins, rest } = sb.order(match); return `<div class="sb-pins hm-pins ${pins.length > 1 ? 'many' : ''}" ${pins.length ? '' : 'hidden'}>${pins.map(sb.pinHTML).join('')}</div>
      <div class="ag-list hm-agents" role="list">${rest.map(sb.row).join('')}</div>${q && !pins.length && !rest.length ? '<p class="sb-none">No agent matches that.</p>' : ''}`; })()}
      <button class="hm-saved" data-go="standup">${icon('timer')}<span><b>${saved.fmt(saved.week().total)}</b> saved this week</span>${icon('chevron')}</button>
    </section>`;
    mountMascots(main, agent);
    motion().animate(main.querySelectorAll('.hm-card, .hm-need, .ag-row, .pin'), { opacity: [0, 1], y: [10, 0] }, { delay: motion().stagger(0.03), duration: 0.35, ease: IN });
  };
  draw();
  let t = 0;
  const soon = () => { clearTimeout(t); t = setTimeout(() => { if (!main.querySelector('.hm-search input:focus')) draw(); }, 200); };
  off.push(on('agents', draw), on('linked', draw), on('account', draw), on('approvals', draw), on('keys', draw), on('agent', soon), on('message', soon), () => clearTimeout(t));
  main.oninput = (e) => {
    if (!e.target.closest('.hm-search')) return;
    q = e.target.value.trim().toLowerCase();
    const { pins, rest } = sb.order(match), p = $('.hm-pins', main);
    p.hidden = !pins.length; p.innerHTML = pins.map(sb.pinHTML).join(''); $('.hm-agents', main).innerHTML = rest.map(sb.row).join('');
    mountMascots(main, agent);
  };
  // hold an agent: pin it to the top (or take it off)
  main.oncontextmenu = (e) => {
    const r = e.target.closest('[data-agent]'); if (!r) return;
    e.preventDefault();
    const a = agent(r.dataset.agent), p = sb.isPinned(a.id);
    menu(r, [{ label: p ? 'Unpin' : 'Pin to the top', icon: 'bolt', run: () => { sb.togglePin(a.id); draw(); } }]);
  };
  // come back from Android's settings page: check the permission again
  const vis = () => { if (document.visibilityState === 'visible' && main.querySelector('.home')) draw(); };
  document.addEventListener('visibilitychange', vis); off.push(() => document.removeEventListener('visibilitychange', vis));
  main.onclick = (e) => {
    const o = e.target.closest('[data-open], [data-agent]'); if (o) return go('chat', { agent: o.dataset.open || o.dataset.agent });
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    if (e.target.closest('[data-island]')) return island.allow();
    if (e.target.closest('[data-new]')) return openCreate();
    if (e.target.closest('[data-signin]')) acct.signIn().catch((err) => toast(err.message || 'Couldn’t sign in', { icon: 'x' }));
  };
}
