// The phone's home: your agents and what they're doing, what needs you, and getting set up
// (pair with your PC, turn on the island). The phone controls agents; your computers run them.
import { state, agent, on, go, pendingApprovals } from '../store.js';
import { $, esc, icon, face, mountMascots, motion, IN, toast } from '../ui.js';
import { STATUS } from '../data.js';
import * as acct from '../account.js';
import * as link from '../link.js';
import * as island from '../island.js';
import * as saved from '../saved.js';

let off = [];
export function leaveHome() { off.forEach((f) => f()); off = []; }

export function home(main) {
  leaveHome();
  const draw = async () => {
    const needs = pendingApprovals();
    const asks = state.agents.map((a) => { const t = state.threads[a.id] || [], l = t[t.length - 1]; return l?.from === 'agent' && ((l.kind === 'question' && !l.answered) || (l.choices && !l.chosen)) ? { a, m: l } : null; }).filter(Boolean);
    const isl = await island.status();
    main.innerHTML = `<section class="home">
      <header class="hm-h"><span class="hm-logo">minus</span><span class="grow"></span>
        <button class="icon-btn" data-go="room" aria-label="Ask the room">${icon('room')}</button></header>
      ${!link.linked() ? `<div class="hm-card hm-pair"><span class="hm-ic">${icon('phone')}</span><div><b>Connect to your computer</b><p>${acct.configured() ? 'On your PC, open Minus → Settings → Devices → New, and scan the code with this phone. Or sign in with the same GitHub account.' : 'Sign-in isn’t set up on this build yet.'}</p></div>${acct.configured() ? `<button class="btn btn-primary btn-sm" data-signin>${icon('github')}<span>Sign in</span></button>` : ''}</div>` : ''}
      ${isl.supported && !isl.granted && island.enabled() ? `<div class="hm-card"><span class="hm-ic">${icon('sparkle')}</span><div><b>See your agents over other apps</b><p>A small island shows who’s working, and pops open when someone needs you. Android calls this “Display over other apps”.</p></div><button class="btn btn-sm" data-island>Turn on</button></div>` : ''}
      ${needs.length || asks.length ? `<h2 class="hm-sec">Needs you</h2><div class="hm-needs">
        ${needs.map(({ agent: a, msg: m }) => `<button class="hm-need" data-open="${esc(a.id)}">${face(a, 34)}<span class="hm-t"><b>${esc(m.action)}</b><small>${esc(a.name)} needs your OK</small></span>${icon('chevron')}</button>`).join('')}
        ${asks.map(({ a, m }) => `<button class="hm-need" data-open="${esc(a.id)}">${face(a, 34)}<span class="hm-t"><b>${esc(m.text)}</b><small>${esc(a.name)} has a question</small></span>${icon('chevron')}</button>`).join('')}</div>` : ''}
      ${link.linked() && !state.agents.length ? `<div class="hm-card"><span class="hm-ic">${icon('laptop')}</span><div><b>Waiting for your computer</b><p>Open Minus on your PC and sign in with the same GitHub account. Your agents show up here as soon as it’s on.</p></div></div>` : ''}
      <h2 class="hm-sec">Your agents</h2>
      <div class="hm-list">${state.agents.map((a) => `<button class="hm-row" data-open="${esc(a.id)}">${face(a, 44)}<span class="hm-t"><b>${esc(a.name)}</b><small>${esc(a.statusText || STATUS[a.status]?.label || '')}</small></span><span class="hm-r"><i class="dot ${STATUS[a.status]?.tone || 'dim'}"></i>${a.unread ? `<b class="unread">${a.unread}</b>` : ''}</span></button>`).join('')}</div>
      <button class="hm-saved" data-go="standup">${icon('timer')}<span><b>${saved.fmt(saved.week().total)}</b> saved this week</span>${icon('chevron')}</button>
    </section>`;
    mountMascots(main, agent);
    motion().animate(main.querySelectorAll('.hm-card, .hm-need, .hm-row'), { opacity: [0, 1], y: [10, 0] }, { delay: motion().stagger(0.03), duration: 0.35, ease: IN });
  };
  draw();
  off.push(on('agents', draw), on('linked', draw), on('account', draw), on('approvals', draw), on('agent', (a) => {
    const r = $(`.hm-row[data-open="${CSS.escape(a.id)}"]`, main); if (!r) return;
    $('.hm-t small', r).textContent = a.statusText || STATUS[a.status]?.label || '';
    $('.dot', r).className = 'dot ' + (STATUS[a.status]?.tone || 'dim');
  }));
  // come back from Android's settings page: check the permission again
  const vis = () => { if (document.visibilityState === 'visible' && main.querySelector('.home')) draw(); };
  document.addEventListener('visibilitychange', vis); off.push(() => document.removeEventListener('visibilitychange', vis));
  main.onclick = (e) => {
    const o = e.target.closest('[data-open]'); if (o) return go('chat', { agent: o.dataset.open });
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    if (e.target.closest('[data-island]')) return island.allow();
    if (e.target.closest('[data-signin]')) acct.signIn().catch((err) => toast(err.message || 'Couldn’t sign in', { icon: 'x' }));
  };
}
