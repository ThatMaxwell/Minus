// Approvals, Routines, Computers and Settings.
import { state, on, agent, go, save, emit, pendingApprovals, providerState, reset, id } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, toast, sheet, motion, IN } from '../ui.js';
import { react, act } from '../director.js';
import { resolve } from '../brain.js';
import { PROVIDERS, provider } from '../data.js';
import { VOICES, voiceOf, cap, getKey, setKey, hasKey, readMode, speak, stopSpeaking } from '../voice.js';
import { updateAgent } from '../store.js';

const head = (title, sub, actions = '') => `<header class="pg-h"><div><h1>${title}</h1><p class="muted">${sub}</p></div><div class="pg-act">${actions}</div></header>`;
let off = [];
const clear = () => { off.forEach((f) => f()); off = []; };

/* ───────── Approvals ───────── */
export function approvals(main) {
  clear(); main.onclick = null;
  const draw = () => {
    const list = pendingApprovals();
    main.innerHTML = `<section class="page">${head('Approvals', 'Things your agents prepared and won’t do without your OK.')}
      ${list.length ? `<div class="ap-list">${list.map(({ agent: a, msg: m }) => `
        <article class="ap" data-a="${esc(a.id)}" data-mid="${esc(m.mid || m.id)}">
          ${face(a, 54)}
          <div class="ap-t"><b>${esc(m.action)}</b><small>${esc(a.name)} · ${esc(m.detail || '')}</small>
            ${m.preview?.length ? `<div class="ask-prev">${m.preview.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}</div>
          <div class="ap-b"><button class="btn btn-quiet btn-sm" data-open data-tip="Open the conversation">Open</button><button class="btn btn-quiet btn-sm" data-ap="declined">Decline</button><button class="btn btn-primary btn-sm" data-ap="approved">Approve</button></div>
        </article>`).join('')}</div>`
      : `<div class="empty-big"><canvas data-agent="${esc(state.agents[0]?.id || '')}" data-emotion="sleepy" data-frame="1.7"></canvas><h3>Nothing waiting on you</h3><p class="muted">When an agent needs your OK, it shows up here.</p></div>`}
    </section>`;
    mountMascots(main, agent);
    $$('.ap canvas', main).forEach((c) => c._m && (c._m.setEmotion('curious'), c._m.gesture('tilt')));
  };
  draw();
  main.onclick = (e) => {
    const card = e.target.closest('.ap'); if (!card) return;
    const aid = card.dataset.a;
    if (e.target.closest('[data-open]')) return go('chat', { agent: aid });
    const b = e.target.closest('[data-ap]'); if (!b) return;
    const ok = b.dataset.ap === 'approved', m = $('canvas', card)._m;
    act(m, ok ? 'approved' : 'rejected');
    resolve(aid, card.dataset.mid, b.dataset.ap);
    toast(ok ? 'Approved' : 'Declined', { icon: ok ? 'check' : 'x' });
    setTimeout(() => motion().animate(card, { opacity: 0, x: ok ? 40 : -40, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }, { duration: 0.4, ease: IN }).then(draw), 650);
  };
}

/* ───────── Routines ───────── */
export function routines(main) {
  clear(); main.onclick = null;
  const draw = () => {
    main.innerHTML = `<section class="page">${head('Routines', 'Work that runs on its own schedule. Show an agent a task once, then make it a routine.', `<button class="btn btn-primary btn-sm" data-new>${icon('plus')}<span>New routine</span></button>`)}
      <div class="rt-table" role="table">
        <div class="rt-row rt-head" role="row"><span>Routine</span><span>Agent</span><span>When</span><span>Next run</span><span></span></div>
        ${state.routines.map((r) => { const a = agent(r.agent); return a ? `
        <div class="rt-row ${r.on ? '' : 'off'}" role="row" data-r="${esc(r.id)}">
          <span class="rt-name"><b>${esc(r.name)}</b><small>Last run: ${esc(r.last)}</small></span>
          <span class="rt-ag">${face(a, 26)}${esc(a.name)}</span>
          <span>${esc(r.when)}</span><span>${r.on ? esc(r.next) : '<span class="muted">Paused</span>'}</span>
          <span class="rt-act"><button class="icon-btn sm" data-run data-tip="Run now">${icon('play')}</button>
            <button class="switch ${r.on ? 'on' : ''}" role="switch" aria-checked="${r.on}" data-tog data-tip="${r.on ? 'Pause' : 'Resume'} this routine"><i></i></button></span>
        </div>` : ''; }).join('')}
      </div></section>`;
    mountMascots(main, agent);
  };
  draw();
  main.onclick = (e) => {
    if (e.target.closest('[data-new]')) return newRoutine(draw);
    const row = e.target.closest('[data-r]'); if (!row) return;
    const r = state.routines.find((x) => x.id === row.dataset.r);
    if (e.target.closest('[data-tog]')) {
      r.on = !r.on; save(); react(r.agent, r.on ? 'wake' : 'sleep');
      toast(r.on ? `${r.name} is on` : `${r.name} is paused`, { icon: r.on ? 'play' : 'pause' }); draw();
    }
    if (e.target.closest('[data-run]')) {
      import('../brain.js').then(({ work }) => work(r.agent, r.name));
      r.last = 'Just now'; save(); toast(`${agent(r.agent).name} is running ${r.name}`, { icon: 'bolt' }); react(r.agent, 'working'); draw();
    }
  };
}
function newRoutine(done) {
  const s = sheet(`<form class="mini-form"><h3>New routine</h3>
    <label class="lbl">Agent</label><select class="field" name="a">${state.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
    <label class="lbl">What to do</label><input class="field" name="n" placeholder="Sweep the inbox" required maxlength="60">
    <label class="lbl">When</label><select class="field" name="w"><option>Every weekday at 9:00</option><option>Mondays at 9:00</option><option>Every day at 12:00</option><option>First day of the month</option><option>Every hour</option></select>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Create routine</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  $('form', s.el).onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    state.routines.push({ id: id('r'), agent: f.get('a'), name: f.get('n'), when: f.get('w'), next: 'Soon', last: 'Never', on: true });
    save(); s.close(); react(f.get('a'), 'yes'); toast('Routine created', { icon: 'routine' }); done();
  };
}

/* ───────── Computers ───────── */
export function computers(main) {
  clear(); main.onclick = null;
  const draw = () => {
    main.innerHTML = `<section class="page">${head('Computers', 'Where your agents click and type. Cloud computers keep going when your laptop is closed.', `<button class="btn btn-primary btn-sm" data-new>${icon('plus')}<span>New cloud computer</span></button>`)}
      <div class="pc-grid">${state.computers.map((c) => { const users = state.agents.filter((a) => a.computer === c.id); const busy = users.some((a) => a.status === 'working'); return `
        <article class="pc-card" data-c="${esc(c.id)}">
          <div class="pc-thumb ${c.status === 'starting' ? 'starting' : ''}"><div class="pc-win"><i></i><i></i><i></i><span></span><span></span><span class="short"></span></div>
            ${c.status === 'starting' ? '<div class="pc-boot"><i class="spin"></i>Starting…</div>' : ''}</div>
          <div class="pc-meta"><b>${icon(c.kind === 'local' ? 'laptop' : 'cloud')}${esc(c.name)}</b><small>${esc(c.region)} · ${esc(c.os)}</small></div>
          <div class="pc-users">${users.map((a) => `<span data-tip="${esc(a.name)}">${face(a, 24)}</span>`).join('') || '<span class="muted small">No agents yet</span>'}
            <span class="pc-state ${busy ? 'busy' : ''}"><i class="dot ${busy ? 'mint' : c.status === 'starting' ? 'amber' : 'dim'}"></i>${busy ? 'In use' : c.status === 'starting' ? 'Starting' : c.kind === 'local' ? 'Connected' : 'Ready'}</span></div>
        </article>`; }).join('')}</div></section>`;
    mountMascots(main, agent);
  };
  draw();
  main.onclick = (e) => {
    if (e.target.closest('[data-new]')) {
      const n = state.computers.filter((c) => c.kind === 'cloud').length + 1;
      const c = { id: id('cloud'), name: `Cloud computer ${n}`, kind: 'cloud', status: 'starting', region: 'US East', os: 'Linux desktop' };
      state.computers.push(c); save(); draw(); toast(`Starting ${c.name}`, { icon: 'cloud' });
      setTimeout(() => { c.status = 'running'; save(); if ($('.pc-grid', main)) draw(); toast(`${c.name} is ready`, { icon: 'check' }); }, 3200);
    }
  };
}

/* ───────── Settings ───────── */
export function settings(main) {
  clear(); main.onclick = null;
  const draw = () => {
    main.innerHTML = `<section class="page narrow">${head('Settings', 'Everything stays on this computer.')}
      <h2 class="sec-h">Your AI</h2><p class="muted small">Connect the subscriptions and API keys you already have. Minus never charges for AI.</p>
      <div class="set-list">${PROVIDERS.map((p) => { const ps = providerState(p.id); return `
        <div class="set-row" data-p="${p.id}"><span class="prov-ic">${p.icon}</span><span class="set-t"><b>${p.name}</b><small>${ps.connected ? (ps.key ? 'Key ' + esc(ps.key) : p.local ? 'Running on this computer' : 'Connected') : esc(p.by)}</small></span>
          <button class="btn ${ps.connected ? 'btn-quiet' : 'btn-primary'} btn-sm" data-pc>${ps.connected ? 'Disconnect' : 'Connect'}</button></div>`; }).join('')}</div>
      <h2 class="sec-h">Voice</h2><p class="muted small">Talk to your agents and hear them answer. Listening uses Whisper and voices are Orpheus, both on Groq with your own key.</p>
      <div class="set-list">
        <div class="set-row"><span class="prov-ic">${icon('key')}</span><span class="set-t"><b>Groq key</b><small>${hasKey() ? 'Key •••• ' + esc(getKey().slice(-4)) + ' · stored on this computer only' : 'Needed for voice. Free to make at console.groq.com'}</small></span>
          <button class="btn ${hasKey() ? 'btn-quiet' : 'btn-primary'} btn-sm" data-vkey>${hasKey() ? 'Remove' : 'Add key'}</button></div>
        <div class="set-row"><span class="set-t"><b>Read replies aloud</b><small>Agents answer out loud</small></span>
          <div class="seg sm" role="radiogroup" aria-label="Read replies aloud">${[['talk', 'When I talk'], ['always', 'Always'], ['never', 'Never']].map(([k, t]) => `<button role="radio" aria-checked="${readMode() === k}" data-read="${k}">${t}</button>`).join('')}</div></div>
        ${state.agents.map((ag) => `<div class="set-row" data-va="${esc(ag.id)}">${face(ag, 30)}<span class="set-t"><b>${esc(ag.name)}</b><small>Speaks as ${cap(voiceOf(ag))}</small></span>
          <div class="seg sm voice-seg" role="radiogroup" aria-label="${esc(ag.name)}’s voice">${VOICES.map((v) => `<button role="radio" aria-checked="${voiceOf(ag) === v}" data-voice="${v}" data-tip="Hear ${cap(v)}">${cap(v)}</button>`).join('')}</div></div>`).join('')}
      </div>
      <h2 class="sec-h">Agents</h2>
      <div class="set-list">
        ${tog('lively', 'Lively agents', 'They look around, blink and react to what you do')}
        ${tog('notify', 'Notify me', 'When an agent needs your OK or finishes a job')}
        ${tog('sounds', 'Sounds', 'Soft sounds for approvals and finished work')}
      </div>
      <h2 class="sec-h">About</h2>
      <div class="set-list"><div class="set-row"><span class="set-t"><b>Minus</b><small>Beta · MIT licensed · <a href="https://github.com/ThatMaxwell/Minus" target="_blank" rel="noopener">github.com/ThatMaxwell/Minus</a></small></span></div>
        <div class="set-row"><span class="set-t"><b>Reset this preview</b><small>Brings back the example agents and conversations</small></span><button class="btn btn-quiet btn-sm" data-reset>Reset</button></div></div>
    </section>`;
    mountMascots(main, agent);
  };
  const tog = (k, t, d) => `<div class="set-row"><span class="set-t"><b>${t}</b><small>${d}</small></span><button class="switch ${state.settings[k] ? 'on' : ''}" role="switch" aria-checked="${!!state.settings[k]}" data-set="${k}" aria-label="${t}"><i></i></button></div>`;
  draw();
  main.onclick = (e) => {
    const pc = e.target.closest('[data-pc]');
    if (pc) {
      const pid = pc.closest('[data-p]').dataset.p, ps = providerState(pid);
      if (ps.connected) { ps.connected = false; ps.key = ''; toast(`${provider(pid).name} disconnected`, { icon: 'x' }); }
      else return connect(pid, draw);
      save(); draw();
    }
    const s = e.target.closest('[data-set]');
    if (s) {
      const k = s.dataset.set; state.settings[k] = !state.settings[k]; save(); draw();
      if (k === 'lively') document.documentElement.classList.toggle('calm', !state.settings.lively);
    }
    if (e.target.closest('[data-reset]')) reset();
    if (e.target.closest('[data-vkey]')) {
      if (hasKey()) { setKey(''); stopSpeaking(); toast('Groq key removed', { icon: 'x' }); return draw(); }
      return keySheet(draw);
    }
    const rd = e.target.closest('[data-read]');
    if (rd) { state.settings.readAloud = rd.dataset.read; save(); draw(); }
    const vb = e.target.closest('[data-voice]');
    if (vb) {
      const aid = vb.closest('[data-va]').dataset.va, ag = agent(aid), v = vb.dataset.voice;
      updateAgent(aid, { voice: v }); draw();
      if (!hasKey()) return keySheet(draw);
      speak(aid, `Hi, I’m ${ag.name}. This is how I sound.`, { voice: v }).catch((err) => toast(err.human, { icon: 'speaker' }));
    }
  };
}

// Ask for the Groq key. It's checked with a real request before it's kept.
export function keySheet(done = () => {}) {
  const s = sheet(`<form class="mini-form"><h3>${icon('mic')} Talk to your agents</h3>
    <p class="muted small">Paste a Groq API key. Minus uses it for Whisper (listening) and Orpheus (voices). It’s stored on this computer only and sent to nobody but Groq. Make one free at console.groq.com, then accept the Orpheus terms in its playground.</p>
    <input class="field mono" type="password" name="k" placeholder="gsk_…" required autocomplete="off" spellcheck="false">
    <p class="hint-line" data-err></p>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Not now</button><button class="btn btn-primary btn-sm">Save key</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  const f = $('form', s.el), err = $('[data-err]', s.el), btn = $('.btn-primary', s.el);
  setTimeout(() => $('input', s.el).focus(), 30);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const k = String(new FormData(f).get('k') || '').trim(); if (!k) return;
    const old = getKey(); setKey(k);
    btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
    try {
      await speak(state.agents[0]?.id, 'Hi! I can hear you now.', { voice: voiceOf(state.agents[0]) });
      s.close(); toast('Voice is on', { icon: 'mic' }); done();
    } catch (ex) {
      setKey(old); err.textContent = ex.human || 'That key didn’t work.';
      btn.disabled = false; btn.textContent = 'Save key';
    }
  };
}
function connect(pid, done) {
  const p = provider(pid);
  const s = sheet(`<form class="mini-form"><h3>${p.icon} Connect ${p.name}</h3><p class="muted small">${p.local ? 'Minus talks to it on this computer.' : 'Paste an API key. It’s stored on this computer only.'}</p>
    ${p.local ? '' : '<input class="field mono" type="password" name="k" placeholder="API key" required autocomplete="off" spellcheck="false">'}
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Connect</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  $('form', s.el).onsubmit = (e) => {
    e.preventDefault(); const k = new FormData(e.target).get('k') || '';
    const ps = providerState(pid); ps.connected = true; ps.key = k ? '•••• ' + String(k).slice(-4) : ''; save(); s.close(); done();
    toast(`${p.name} connected`);
  };
}
