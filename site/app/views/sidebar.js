// Sidebar: new agent, places, and your agents with live faces and status.
import { state, on, go, pendingApprovals, agent } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, mod } from '../ui.js';
import { STATUS } from '../data.js';
import { openCreate } from './create.js';
import * as su from '../standup.js';

export function sidebar(el) {
  el.innerHTML = `
    <button class="btn btn-primary new-agent" data-tip="New agent|mod N">${icon('plus')}<span>New agent</span></button>
    <nav class="side-nav" aria-label="Places">
      <button data-go="standup" data-tip="Hear from every agent: what they did, what’s on today, what they need">${icon('sunrise')}<span>Stand-up</span><i class="su-due" hidden></i></button>
      <button data-go="approvals" data-tip="Things waiting for your OK">${icon('inbox')}<span>Approvals</span><b class="count" hidden></b></button>
      <button data-go="routines" data-tip="Work that runs on a schedule">${icon('routine')}<span>Routines</span></button>
      <button data-go="computers" data-tip="Cloud computers and this laptop">${icon('monitor')}<span>Computers</span></button>
    </nav>
    <div class="side-h"><span>Agents</span><b class="ag-count"></b></div>
    <div class="ag-list" role="list"></div>
    <div class="side-foot">
      <button data-go="settings" data-tip="Settings|mod ,">${icon('gear')}<span>Settings</span></button>
      <div class="me" data-tip="Signed in on this computer"><span class="me-av">TM</span><span><b>ThatMaxwell</b><small>Acme workspace</small></span></div>
    </div>`;

  const list = $('.ag-list', el);
  const row = (a) => `
    <button class="ag-row" role="listitem" data-agent="${esc(a.id)}" data-tip="${esc(a.name)} · ${esc(a.role || 'Agent')}" data-tip-pos="right">
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
