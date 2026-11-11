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

// New device: a QR code your phone scans to sign in as you. Single use, gone in 5 minutes.
export function pairSheet() {
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
export function connect(pid, done) {
  const p = provider(pid), eng = rt.ENGINES[pid] || {}, ps = providerState(pid) || {};
  const local = p.local, custom = eng.custom;
  const plan = pid === 'chatgpt' && rt.desktop;
  const viaCode = pid === 'claude' && rt.desktop;
  const s = sheet(`<form class="mini-form"><h3>${p.icon} Connect ${p.name}</h3>
    ${plan ? `<button type="button" class="siwc" data-siwc>${p.icon}<span>Continue with ChatGPT</span></button>
    <p class="muted small siwc-note">Your agents use your ChatGPT plan (Plus or Pro). No API key, nothing extra to pay. You can cap how much Minus uses in ChatGPT’s settings.</p>
    <p class="hint-line warn" data-perr></p>
    <div class="or-line"><span>or use an API key</span></div>` : ''}
    ${viaCode ? `<button type="button" class="siwc" data-cc>${p.icon}<span>Use Claude Code on this PC</span></button>
    <p class="muted small siwc-note">Agents work through Claude Code, signed in with your own Claude plan. Your phone can use it too while this PC is on. <b>Anthropic hasn’t approved plans for apps like Minus</b>, so use it at your own risk. An API key is the safe way.</p>
    <p class="hint-line warn" data-cerr></p>
    <div class="or-line"><span>or use an API key</span></div>` : ''}
    <p class="muted small">${local ? 'Minus talks to Ollama on this computer. Install it from ollama.com and pull a model first.' : `Paste an API key${eng.where ? ` from <b>${esc(eng.where)}</b>` : ''}. It’s kept on this ${/Android/i.test(navigator.userAgent) ? 'phone' : 'computer’s password store'} and only ever sent to ${esc(p.by && !custom ? p.by : 'that provider')}.`}</p>
    ${local ? '' : `<label class="lbl" for="ck">API key</label><input id="ck" class="field mono" type="password" name="k" placeholder="${esc(eng.keyHint || 'API key')}" ${ps.connected ? '' : 'required'} autocomplete="off" spellcheck="false">`}
    <label class="lbl" for="cm">Model</label><input id="cm" class="field mono" name="m" value="${esc(ps.modelId || eng.model || '')}" placeholder="model name" list="cm-list" ${custom ? 'required' : ''} autocomplete="off" spellcheck="false"><datalist id="cm-list">${(ps.models || []).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <p class="hint-line">${pid === 'claude' ? 'Claude Opus 5.5 is the default: the best at planning work on a computer.' : 'Minus tries your key when you connect, and picks a model your account has if this one isn’t there.'}</p>
    ${local || custom ? `<label class="lbl" for="cu">Address</label><input id="cu" class="field mono" name="u" value="${esc(ps.baseUrl || (local ? 'http://localhost:11434/v1' : ''))}" placeholder="https://…/v1" ${custom ? 'required' : ''} autocomplete="off" spellcheck="false">` : ''}
    <p class="hint-line warn" data-err></p>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Connect</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  if (!plan) setTimeout(() => $('input', s.el)?.focus(), 30);
  const cb = $('[data-cc]', s.el);
  if (cb) cb.onclick = async () => {
    const cerr = $('[data-cerr]', s.el), lbl = cb.lastElementChild;
    cb.disabled = true; lbl.textContent = 'Looking for Claude Code…'; cerr.textContent = '';
    const st0 = await rt.codeStatus();
    if (!st0?.installed) { cerr.innerHTML = 'Claude Code isn’t on this PC yet. Install it from <a href="https://claude.com/claude-code" target="_blank" rel="noopener" data-ext>claude.com/claude-code</a>, then press this again.'; cb.disabled = false; lbl.textContent = 'Use Claude Code on this PC'; return; }
    if (st0.signed_in === false) {
      try { await rt.codeSignIn(); } catch (x) { cerr.textContent = String(x?.message || x); }
      lbl.textContent = 'Sign in in the window that opened…';
      for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 2000)); if ((await rt.codeStatus())?.signed_in) break; if (!document.body.contains(cb)) return; }
      if (!rt.codeInfo()?.signed_in) { cerr.textContent = 'Not signed in yet. Finish in the terminal window, then press this again.'; cb.disabled = false; lbl.textContent = 'Use Claude Code on this PC'; return; }
    }
    const st = providerState(pid);
    st.connected = true; st.viaCode = { who: rt.codeInfo()?.who || '', at: Date.now() };
    st.modelId ||= eng.model;
    save(); s.close(); done();
    toast('Claude agents now work through Claude Code on this PC', { icon: 'check' });
    import('../brain.js').then((b) => b.aiConnected(pid));
  };
  const sb = $('[data-siwc]', s.el);
  if (sb) sb.onclick = async () => {
    const perr = $('[data-perr]', s.el);
    sb.disabled = true; sb.lastElementChild.textContent = 'Finish signing in in your browser…'; perr.textContent = '';
    try {
      const r = await rt.planSignIn();
      const st = providerState(pid);
      const slugs = (r.models || []).map((m) => m[0]);
      st.connected = true; st.key = ''; st.plan = { email: r.email || '', at: Date.now() };
      if (slugs.length) { st.models = slugs; st.modelsAt = Date.now(); st.modelId = slugs.includes(st.modelId) ? st.modelId : slugs[0]; }
      save(); s.close(); done();
      planWelcome();
      import('../brain.js').then((b) => b.aiConnected(pid));
    } catch (x) { perr.textContent = String(x?.message || x); sb.disabled = false; sb.lastElementChild.textContent = 'Continue with ChatGPT'; }
  };
  $('form', s.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), k = String(f.get('k') || '').trim(), err = $('[data-err]', s.el), go = $('.btn-primary', s.el);
    let model = String(f.get('m') || '').trim() || eng.model, models = [], swapped = '';
    const baseUrl = f.has('u') ? String(f.get('u') || '').trim() : '';
    if (rt.desktop) {
      // try the key for real before saving it: a wrong key is caught here, with the provider's reason
      go.disabled = true; go.textContent = 'Checking…'; err.textContent = '';
      try { models = (await rt.check(pid, k, model, baseUrl, p.name)) || []; }
      catch (x) { err.textContent = String(x?.message || x); go.disabled = false; go.textContent = 'Connect'; return; }
      const best = custom || local ? model : rt.pickModel(pid, models, model);
      if (best !== model) { swapped = model; model = best; }
      try { if (k) await rt.setKey(pid, k); }
      catch (x) { err.textContent = `Couldn’t save the key: ${x?.message || x}`; go.disabled = false; go.textContent = 'Connect'; return; }
    }
    const st = providerState(pid);
    st.connected = true;
    if (k) st.key = '•••• ' + k.slice(-4);
    st.modelId = model;
    if (models.length) st.models = models;
    if (f.has('u')) st.baseUrl = baseUrl;
    save(); s.close(); done();
    toast(swapped ? `${p.name} connected. ${swapped} isn’t on your account, so agents use ${model}.` : rt.desktop ? `${p.name} connected and working. Agents using it now work for real.` : `${p.name} connected`);
    import('../brain.js').then((b) => b.aiConnected(pid));
  };
}

// The first time agents use your ChatGPT plan: say so, once.
export function planWelcome() {
  if (state.settings.planWelcomed) return;
  state.settings.planWelcomed = true; save();
  const s = sheet(`<div class="mini-form"><h3>You’re using your ChatGPT plan</h3>
    <p class="muted small">Agents that think with ChatGPT now use your ChatGPT plan instead of an API key. You can see and limit how much Minus uses in ChatGPT’s settings.</p>
    <div class="row-end"><a class="btn btn-quiet btn-sm" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener" data-ext>Manage usage</a><button class="btn btn-primary btn-sm" data-x>Got it</button></div></div>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  $('[data-ext]', s.el).onclick = (e) => { e.preventDefault(); const u = e.currentTarget.href; window.__TAURI__?.opener ? window.__TAURI__.opener.openUrl(u) : window.open(u, '_blank', 'noopener'); };
}
