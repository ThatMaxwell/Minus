// Sidebar: new agent, places, and your agents with live faces and status.
import { state, on, go, pendingApprovals, agent } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, mod } from '../ui.js';
import { STATUS } from '../data.js';
import { openCreate } from './create.js';
import * as su from '../standup.js';
import * as acct from '../account.js';
import * as saved from '../saved.js';
import { WORDS } from '../moods.js';

export function sidebar(el) {
  el.innerHTML = `
    <button class="btn btn-primary new-agent" data-tip-pos="right" data-tip="New agent|mod N">${icon('plus')}<span>New agent</span></button>
    <nav class="side-nav" aria-label="Places">
      <button data-go="standup" data-tip-pos="right" data-tip="Hear from every agent: what they did, what’s on today, what they need">${icon('sunrise')}<span>Stand-up</span><i class="su-due" hidden></i></button>
      <button data-go="room" data-tip-pos="right" data-tip="One question, every agent answers with its own AI">${icon('room')}<span>Ask the room</span></button>
      <button data-go="approvals" data-tip-pos="right" data-tip="Things waiting for your OK">${icon('inbox')}<span>Approvals</span><b class="count" hidden></b></button>
      <button data-go="routines" data-tip-pos="right" data-tip="Work that runs on a schedule">${icon('routine')}<span>Routines</span></button>
      <button data-go="computers" data-tip-pos="right" data-tip="Cloud computers and this laptop">${icon('monitor')}<span>Computers</span></button>
    </nav>
    <div class="side-h"><span>Agents</span><b class="ag-count"></b></div>
    <div class="ag-list" role="list"></div>
    <button class="saved" data-tip="About how long your agents’ work this week would have taken you by hand (an estimate from their steps)" data-tip-pos="right"><span class="sv-ic">${icon('timer')}</span><span class="sv-t"><b class="sv-n"></b><small>saved this week</small></span><span class="sv-bars"></span></button>
    <div class="side-foot">
      <button data-go="settings" data-tip-pos="right" data-tip="Settings|mod ,">${icon('gear')}<span>Settings</span></button>
      <div class="me"></div>
    </div>`;

  const list = $('.ag-list', el);
  const row = (a) => `
    <button class="ag-row" role="listitem" data-agent="${esc(a.id)}" data-tip="${esc(a.name)} · ${esc(a.role || 'Agent')}${WORDS[a.mood] ? ` · feeling ${WORDS[a.mood]}` : ''}" data-tip-pos="right">
      ${face(a, 30)}
      <span class="ag-meta"><b>${esc(a.name)}</b><small>${esc(a.statusText || STATUS[a.status]?.label || '')}</small></span>
      <span class="ag-right"><i class="dot ${STATUS[a.status]?.tone || 'dim'}"></i><b class="unread" ${a.unread ? '' : 'hidden'}>${a.unread || ''}</b></span>
    </button>`;
  const build = () => {
    list.innerHTML = state.agents.map(row).join('');
    $('.ag-count', el).textContent = state.agents.length;
    mountMascots(list, agent);
    mark();
  };
  const mark = () => {
    $$('.ag-row', list).forEach((r) => r.classList.toggle('on', state.route.view === 'chat' && r.dataset.agent === state.route.agent));
    $$('[data-go]', el).forEach((b) => b.classList.toggle('on', state.route.view === b.dataset.go));
    const n = pendingApprovals().length, c = $('.count', el);
    c.hidden = !n; c.textContent = n;
    $('.su-due', el).hidden = !su.due();
  };
  const patch = (a) => {
    const r = $(`.ag-row[data-agent="${CSS.escape(a.id)}"]`, list);
    if (!r) return build();
    $('.ag-meta b', r).textContent = a.name;
    $('.ag-meta small', r).textContent = a.statusText || STATUS[a.status]?.label || '';
    r.dataset.tip = `${a.name} · ${a.role || 'Agent'}${WORDS[a.mood] ? ` · feeling ${WORDS[a.mood]}` : ''}`;
    $('.dot', r).className = 'dot ' + (STATUS[a.status]?.tone || 'dim');
    const u = $('.unread', r); u.hidden = !a.unread; u.textContent = a.unread || '';
  };

  el.addEventListener('click', (e) => {
    const r = e.target.closest('.ag-row'); if (r) return go('chat', { agent: r.dataset.agent });
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    if (e.target.closest('.new-agent')) openCreate();
  });
  // hover a row and that agent looks up at you
  list.addEventListener('pointerover', (e) => {
    const r = e.target.closest('.ag-row'); if (!r || r._hov) return;
    r._hov = true; mascotsOf(r.dataset.agent).forEach((m) => { if (list.contains(m.canvas)) { m.look(0.2, 0.3, { noBlink: true }); m.blink(); m.pointerT = 1.2; } });
  });
  list.addEventListener('pointerout', (e) => { const r = e.target.closest('.ag-row'); if (r && !r.contains(e.relatedTarget)) r._hov = false; });

  // the time saved meter: counts up when it grows, with a bar for each of the last 7 days
  let shown = 0;
  const meter = (bump) => {
    const w = saved.week(), max = Math.max(...w.days.map((d) => d.secs), 1);
    $('.sv-bars', el).innerHTML = w.days.map((d, i) => `<i style="height:${Math.max(8, (d.secs / max) * 100)}%" class="${i === 6 ? 'today' : ''}"></i>`).join('');
    const n = $('.sv-n', el), from = shown, to = w.total; shown = to;
    if (!bump || to - from < 1) { n.textContent = saved.fmt(to); return; }
    import('../ui.js').then(({ motion }) => motion().animate(from, to, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => (n.textContent = saved.fmt(v)) }));
    const plus = document.createElement('span'); plus.className = 'sv-plus'; plus.textContent = '+' + saved.fmt(Math.max(60, bump)); $('.saved', el).appendChild(plus);
    setTimeout(() => plus.remove(), 1400);
  };
  meter();
  on('saved', ({ secs }) => meter(secs));
  $('.saved', el).addEventListener('click', () => go('standup'));
  // you: your GitHub name and picture once you're signed in
  const me = () => {
    const u = acct.user(), name = acct.login(), pic = u?.user_metadata?.avatar_url;
    const box = $('.me', el);
    box.dataset.tip = u ? 'Signed in with GitHub' : 'Not signed in';
    box.innerHTML = `<span class="me-av">${pic ? `<img src="${esc(pic)}" alt="">` : esc((name || 'You').slice(0, 2).toUpperCase())}</span><span><b>${esc(name || 'You')}</b><small>${u ? 'Signed in with GitHub' : 'Not signed in'}</small></span>`;
  };
  me();
  on('account', me);
  on('agent', patch);
  on('agents', build);
  on('route', mark);
  on('approvals', mark);
  on('standup', mark);
  on('message', ({ agent: aid }) => {
    const a = agent(aid);
    if (a && !(state.route.view === 'chat' && state.route.agent === aid)) { a.unread = (a.unread || 0) + 1; patch(a); }
    mark();
  });
  build();
}
