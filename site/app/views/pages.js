// Approvals, Routines, Computers and Settings.
import { state, on, agent, go, save, emit, pendingApprovals, providerState, reset, id } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, toast, sheet, motion, IN, timeAgo } from '../ui.js';
import { react, act } from '../director.js';
import { resolve } from '../brain.js';
import { PROVIDERS, provider } from '../data.js';
import { VOICES, voiceOf, cap, getKey, setKey, hasKey, readMode, speak, stopSpeaking } from '../voice.js';
import { updateAgent } from '../store.js';
import * as acct from '../account.js';
import * as rt from '../runtime.js';
import * as island from '../island.js';

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
const PACES = [['easy', 'Easy to follow'], ['normal', 'Normal'], ['fast', 'Full speed']];
const pace = () => state.settings.pace || 'normal';
export function settings(main) {
  clear(); main.onclick = null;
  const draw = () => {
    main.innerHTML = `<section class="page narrow">${head('Settings', 'Your AI keys stay on this computer. Your agents and chats sync to your devices.')}
      <h2 class="sec-h">Account</h2>
      <div class="set-list">${acct.user() ? `
        <div class="set-row"><img class="avatar" src="${esc(acct.user().user_metadata?.avatar_url || '')}" alt=""><span class="set-t"><b>@${esc(acct.login())}</b><small>Signed in with GitHub</small></span><button class="btn btn-quiet btn-sm" data-acct="out">Sign out</button></div>` : `
        <div class="set-row"><span class="prov-ic">${icon('github')}</span><span class="set-t"><b>Sign in to Minus</b><small>${acct.configured() ? 'Use your agents from your phone and your other computers' : 'Sign-in isn’t set up on this build yet'}</small></span><button class="btn btn-primary btn-sm" data-acct="in" ${acct.configured() ? '' : 'disabled'}>${icon('github')}<span>Sign in with GitHub</span></button></div>`}
      </div>
      ${acct.user() ? `<h2 class="sec-h row-h"><span>Devices</span><button class="btn btn-quiet btn-sm" data-newdev>${icon('plus')}<span>New</span></button></h2>
      <p class="muted small">Your phone controls your agents. Your computers are where they work.</p>
      <div class="set-list" id="dev-list"><div class="set-row"><span class="set-t"><small>Loading…</small></span></div></div>` : ''}
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
        ${rt.desktop && !island.supported() ? `<div class="set-row"><span class="set-t"><b>Ghost cursor</b><small>See where agents act on your screen, without them taking your mouse</small></span><button class="switch ${state.settings.ghost !== false ? 'on' : ''}" role="switch" aria-checked="${state.settings.ghost !== false}" data-ghost aria-label="Ghost cursor"><i></i></button></div>
        <div class="set-row"><span class="set-t"><b>Agent pace</b><small>How long agents pause before each action, so you can follow along</small></span>
          <div class="seg sm" role="radiogroup" aria-label="Agent pace">${PACES.map(([k, t]) => `<button role="radio" aria-checked="${pace() === k}" data-pace="${k}">${t}</button>`).join('')}</div></div>` : ''}
        ${island.supported() ? `<div class="set-row" id="isl-row"><span class="set-t"><b>Floating island</b><small>Checking…</small></span><span class="isl-act"></span></div>` : ''}
        <div class="set-row"><span class="set-t"><b>Morning stand-up</b><small>${state.settings.standup === false ? 'Off' : `Every day at ${esc(state.settings.standupAt || '09:00')}, the island offers it`}</small></span>
          <input class="field time-in" type="time" value="${esc(state.settings.standupAt || '09:00')}" data-sutime aria-label="Stand-up time" ${state.settings.standup === false ? 'disabled' : ''}>
          <button class="switch ${state.settings.standup === false ? '' : 'on'}" role="switch" aria-checked="${state.settings.standup !== false}" data-sutoggle aria-label="Morning stand-up"><i></i></button></div>
      </div>
      <h2 class="sec-h">About</h2>
      <div class="set-list"><div class="set-row"><span class="set-t"><b>Minus</b><small>Beta · MIT licensed · <a href="https://github.com/ThatMaxwell/Minus" target="_blank" rel="noopener">github.com/ThatMaxwell/Minus</a></small></span></div>
        <div class="set-row"><span class="set-t"><b>Reset this preview</b><small>Brings back the example agents and conversations</small></span><button class="btn btn-quiet btn-sm" data-reset>Reset</button></div></div>
    </section>`;
    mountMascots(main, agent);
    fillDevices();
    fillIsland();
  };
  // the phone's island needs Android's "Display over other apps"
  const fillIsland = async () => {
    const row = $('#isl-row', main); if (!row) return;
    const s = await island.status(), on_ = island.enabled();
    $('small', row).textContent = !on_ ? 'Off' : s.granted ? 'Shows your agents over other apps while Minus is closed' : 'Needs “Display over other apps” from Android';
    $('.isl-act', row).innerHTML = on_ && !s.granted ? `<button class="btn btn-primary btn-sm" data-islallow>Allow</button>` : `<button class="switch ${on_ ? 'on' : ''}" role="switch" aria-checked="${on_}" data-isltoggle aria-label="Floating island"><i></i></button>`;
  };
  const vis = () => document.visibilityState === 'visible' && fillIsland();
  document.addEventListener('visibilitychange', vis); off.push(() => document.removeEventListener('visibilitychange', vis));
  const fillDevices = async () => {
    const list = $('#dev-list', main); if (!list) return;
    const mine = acct.deviceId(), ds = await acct.devices();
    if (!list.isConnected) return;
    list.innerHTML = ds.map((d) => `<div class="set-row"><span class="prov-ic">${icon(d.kind === 'phone' ? 'phone' : 'laptop')}</span><span class="set-t"><b>${esc(d.name)}${d.id === mine ? ' <span class="tag">This device</span>' : ''}</b><small>${esc({ windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android' }[d.platform] || d.platform)} · ${d.kind === 'phone' ? 'Controls your agents' : 'Agents can work here'} · seen ${timeAgo(new Date(d.last_seen).getTime())}</small></span>${d.id === mine ? '' : `<button class="btn btn-quiet btn-sm" data-rmdev="${esc(d.id)}">Remove</button>`}</div>`).join('') || '<div class="set-row"><span class="set-t"><small>No devices yet</small></span></div>';
  };
  off.push(on('account', draw), on('devices', fillDevices));
  const tog = (k, t, d) => `<div class="set-row"><span class="set-t"><b>${t}</b><small>${d}</small></span><button class="switch ${state.settings[k] ? 'on' : ''}" role="switch" aria-checked="${!!state.settings[k]}" data-set="${k}" aria-label="${t}"><i></i></button></div>`;
  draw();
  main.onchange = (e) => { if (e.target.matches('[data-sutime]') && e.target.value) { state.settings.standupAt = e.target.value; save(); emit('standup'); draw(); } };
  main.onclick = (e) => {
    const pc = e.target.closest('[data-pc]');
    if (pc) {
      const pid = pc.closest('[data-p]').dataset.p, ps = providerState(pid);
      if (ps.connected) { ps.connected = false; ps.key = ''; if (rt.desktop) rt.removeKey(pid); toast(`${provider(pid).name} disconnected`, { icon: 'x' }); }
      else return connect(pid, draw);
      save(); draw();
    }
    const s = e.target.closest('[data-set]');
    if (s) {
      const k = s.dataset.set; state.settings[k] = !state.settings[k]; save(); draw();
      if (k === 'lively') document.documentElement.classList.toggle('calm', !state.settings.lively);
    }
    if (e.target.closest('[data-sutoggle]')) { state.settings.standup = state.settings.standup === false; save(); emit('standup'); return draw(); }
    if (e.target.closest('[data-ghost]')) { state.settings.ghost = state.settings.ghost === false; save(); emit('settings'); return draw(); }
    const pc_ = e.target.closest('[data-pace]');
    if (pc_) { state.settings.pace = pc_.dataset.pace; save(); rt.applyPace(); return draw(); }
    if (e.target.closest('[data-islallow]')) return island.allow();
    if (e.target.closest('[data-isltoggle]')) { state.settings.island = !island.enabled(); save(); emit('settings'); return fillIsland(); }
    if (e.target.closest('[data-reset]')) reset();
    const ac = e.target.closest('[data-acct]');
    if (ac) {
      if (ac.dataset.acct === 'out') acct.signOut();
      else acct.signIn().catch((err) => toast(err.message || 'Couldn’t sign in', { icon: 'x' }));
    }
    if (e.target.closest('[data-newdev]')) pairSheet();
    const rm = e.target.closest('[data-rmdev]');
    if (rm) acct.removeDevice(rm.dataset.rmdev).then(() => toast('Device removed', { icon: 'trash' }));
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

// New device: a QR code your phone scans to sign in as you. Single use, gone in 5 minutes.
function pairSheet() {
  const s = sheet(`<div class="mini-form pair"><h3>${icon('phone')} Add a device</h3>
    <div class="qr-box"><div class="qr">${icon('phone')}</div></div>
    <p class="small">Open the camera on your phone and point it at the code. Minus opens and signs in.</p>
    <p class="muted small warn-line">This code signs in as you. Only scan it with your own devices.</p>
    <div class="row-end"><span class="muted small" data-left></span><button class="btn btn-quiet btn-sm" data-copy>${icon('copy')}<span>Copy link</span></button><button class="btn btn-primary btn-sm" data-x>Done</button></div></div>`, { cls: 'small' });
  let link = '', timer = 0;
  const make = async () => {
    const box = $('.qr-box', s.el);
    box.classList.remove('expired');
    try {
      const p = await acct.makePairCode();
      link = p.link;
      box.innerHTML = acct.qrSVG(p.link, 220);
      motion().animate(box.firstElementChild, { opacity: [0, 1], scale: [0.92, 1], filter: ['blur(6px)', 'blur(0px)'] }, { duration: 0.4, ease: IN });
      clearInterval(timer);
      timer = setInterval(() => {
        const left = Math.max(0, p.expires - Date.now());
        const el = $('[data-left]', s.el); if (!el) return clearInterval(timer);
        el.textContent = left ? `Expires in ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : '';
        if (!left) { clearInterval(timer); box.classList.add('expired'); box.innerHTML = '<button class="btn btn-quiet btn-sm" data-again>Make a new code</button>'; }
      }, 500);
    } catch (err) { box.innerHTML = `<p class="small">${esc(err.message || 'Couldn’t make a code')}</p>`; }
  };
  s.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) { clearInterval(timer); s.close(); }
    if (e.target.closest('[data-again]')) make();
    if (e.target.closest('[data-copy]') && link) navigator.clipboard.writeText(link).then(() => toast('Link copied'));
  });
  make();
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
  const p = provider(pid), eng = rt.ENGINES[pid] || {}, ps = providerState(pid) || {};
  const local = p.local, custom = eng.custom;
  const s = sheet(`<form class="mini-form"><h3>${p.icon} Connect ${p.name}</h3>
    <p class="muted small">${local ? 'Minus talks to Ollama on this computer. Install it from ollama.com and pull a model first.' : `Paste an API key${eng.where ? ` from <b>${esc(eng.where)}</b>` : ''}. It’s kept in this computer’s password store and only ever sent to ${esc(p.by && !custom ? p.by : 'that provider')}.`}</p>
    ${local ? '' : `<label class="lbl" for="ck">API key</label><input id="ck" class="field mono" type="password" name="k" placeholder="${esc(eng.keyHint || 'API key')}" ${ps.connected ? '' : 'required'} autocomplete="off" spellcheck="false">`}
    <label class="lbl" for="cm">Model</label><input id="cm" class="field mono" name="m" value="${esc(ps.modelId || eng.model || '')}" placeholder="model name" ${custom ? 'required' : ''} autocomplete="off" spellcheck="false">
    <p class="hint-line">${pid === 'claude' ? 'Claude Opus 5.5 is the default: the best at planning work on a computer.' : 'Change it if your account uses a different model name.'}</p>
    ${local || custom ? `<label class="lbl" for="cu">Address</label><input id="cu" class="field mono" name="u" value="${esc(ps.baseUrl || (local ? 'http://localhost:11434/v1' : ''))}" placeholder="https://…/v1" ${custom ? 'required' : ''} autocomplete="off" spellcheck="false">` : ''}
    <p class="hint-line warn" data-err></p>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Connect</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  setTimeout(() => $('input', s.el)?.focus(), 30);
  $('form', s.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), k = String(f.get('k') || '').trim();
    try {
      if (k && rt.desktop) await rt.setKey(pid, k);
    } catch (err) { $('[data-err]', s.el).textContent = `Couldn’t save the key: ${err?.message || err}`; return; }
    const st = providerState(pid);
    st.connected = true;
    if (k) st.key = '•••• ' + k.slice(-4);
    st.modelId = String(f.get('m') || '').trim() || eng.model;
    if (f.has('u')) st.baseUrl = String(f.get('u') || '').trim();
    save(); s.close(); done();
    toast(rt.desktop ? `${p.name} connected. Agents using it now work for real.` : `${p.name} connected`);
  };
}
