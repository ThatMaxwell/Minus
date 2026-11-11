// Settings: a list of sections on the left, the section on the right, a summary on top.
// Account, your AI, the vault, memory, voice, how agents behave, safety, and about.
import { state, on, agent, go, save, emit, providerState, reset, updateAgent } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, toast, sheet, timeAgo } from '../ui.js';
import { PROVIDERS, provider } from '../data.js';
import { VOICES, voiceOf, cap, getKey, setKey, hasKey, readMode, speak, stopSpeaking } from '../voice.js';
import { keySheet, connect, pairSheet } from './pages.js';
import { prettyModel } from './modelpick.js';
import * as acct from '../account.js';
import * as rt from '../runtime.js';
import * as island from '../island.js';
import * as vault from '../vault.js';
import * as nb from '../notebook.js';
import * as safety from '../safety.js';

const SECTIONS = [
  ['account', 'Account', 'user'], ['ai', 'Your AI', 'sparkle'], ['vault', 'Vault', 'lock'], ['memory', 'Memory', 'book'],
  ['voice', 'Voice', 'speaker'], ['agents', 'Agents', 'smile'], ['safety', 'Safety', 'shield'], ['about', 'About', 'info'],
];
const PACES = [['easy', 'Easy to follow'], ['normal', 'Normal'], ['fast', 'Full speed']];
const pace = () => state.settings.pace || 'normal';
const ACTIONS = [['warn', 'Warn', 'A warning in the chat'], ['kick', 'Kick', 'The chat ends and is forgotten'], ['ban', 'Ban', 'No agents for a while'], ['permaban', 'Permaban', 'Until the owner lifts it'], ['freshwipe', 'Freshwipe', 'Last warning, memories erased']];

let off = [];
const clear = () => { off.forEach((f) => f()); off = []; };

export function settings(main) {
  clear(); main.onclick = null; main.onchange = null; main.oninput = null;
  let where = state.settings.setAt || 'account';

  const tog = (k, t, d, def = false) => { const v = state.settings[k] ?? def; return `<div class="set-row"><span class="set-t"><b>${t}</b><small>${d}</small></span><button class="switch ${v ? 'on' : ''}" role="switch" aria-checked="${!!v}" data-set="${k}" data-def="${def}" aria-label="${t}"><i></i></button></div>`; };
  const sec = (id, title, sub, body, act = '') => `<section class="set-sec" id="set-${id}" data-sec="${id}"><header class="set-sh"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${act}</header>${body}</section>`;

  /* ───── the parts ───── */
  const stats = () => {
    const ai = PROVIDERS.filter((p) => providerState(p.id)?.connected), b = safety.blocked(), s = safety.S();
    const keys = (rt.desktop ? rt.slots().length : ai.length) + (hasKey() ? 1 : 0);
    return `<div class="set-stats">
      <button class="st-card" data-go-sec="ai"><span class="st-ic">${icon('sparkle')}</span><span class="st-n">${ai.length}</span><span class="st-l">AI connected</span><small>${esc(ai.map((p) => p.name).slice(0, 3).join(', ') || 'None yet')}</small></button>
      <button class="st-card" data-go-sec="vault"><span class="st-ic">${icon('lock')}</span><span class="st-n">${keys}</span><span class="st-l">In the vault</span><small>${vault.names().length} secret${vault.names().length === 1 ? '' : 's'} agents can type</small></button>
      <button class="st-card" data-go-sec="memory"><span class="st-ic">${icon('book')}</span><span class="st-n">${nb.total()}</span><span class="st-l">Memories</span><small>${nb.shared().length} shared by every agent</small></button>
      <button class="st-card ${b ? 'bad' : ''}" data-go-sec="safety"><span class="st-ic">${icon('shield')}</span><span class="st-n">${b ? (b.kind === 'permaban' ? '∞' : '!') : s.strikes || 0}</span><span class="st-l">${b ? (b.kind === 'kick' ? 'Kicked' : 'Banned') : 'Safety'}</span><small>${b ? esc(b.reason || 'Until it’s over') : s.strikes ? `${s.strikes} warning${s.strikes === 1 ? '' : 's'} so far` : 'All good'}</small></button>
    </div>`;
  };

  const accountSec = () => sec('account', 'Account', 'Your agents and chats sync to your devices. Your AI keys never leave this one.', `
    <div class="set-list">${acct.user() ? `
      <div class="set-row"><img class="avatar" src="${esc(acct.user().user_metadata?.avatar_url || '')}" alt=""><span class="set-t"><b>@${esc(acct.login())}</b><small>Signed in with GitHub</small></span><button class="btn btn-quiet btn-sm" data-acct="out">Sign out</button></div>` : `
      <div class="set-row"><span class="prov-ic">${icon('github')}</span><span class="set-t"><b>Sign in to Minus</b><small>${acct.configured() ? 'Use your agents from your phone and your other computers' : 'Sign-in isn’t set up on this build yet'}</small></span><button class="btn btn-primary btn-sm" data-acct="in" ${acct.configured() ? '' : 'disabled'}>${icon('github')}<span>Sign in with GitHub</span></button></div>`}
    </div>
    ${acct.user() ? `<h3 class="set-h3 row-h"><span>Devices</span><button class="btn btn-quiet btn-sm" data-newdev>${icon('plus')}<span>Add a device</span></button></h3>
    <div class="set-list" id="dev-list"><div class="set-row"><span class="set-t"><small>Loading…</small></span></div></div>` : ''}`);

  const aiSec = () => sec('ai', 'Your AI', 'Connect the subscriptions and keys you already have. Minus never charges for AI. Each agent picks its own model from its chat.', `
    <div class="ai-grid">${PROVIDERS.map((p) => {
      const ps = providerState(p.id) || {}, on_ = ps.connected;
      const users = state.agents.filter((a) => a.model === p.id).length;
      return `<article class="ai-tile ${on_ ? 'on' : ''}" data-p="${p.id}">
        <div class="ai-top"><span class="ai-ic">${p.icon}</span>${on_ ? `<span class="ai-on"><i></i>Connected</span>` : ''}</div>
        <b>${esc(p.name)}</b><small>${esc(on_ ? (ps.modelId ? prettyModel(ps.modelId) : p.local ? 'On this computer' : 'Ready') : p.by)}${on_ && users ? ` · ${users} agent${users === 1 ? '' : 's'}` : ''}</small>
        <button class="btn ${on_ ? 'btn-quiet' : 'btn-primary'} btn-sm" data-pc>${on_ ? 'Disconnect' : 'Connect'}</button>
      </article>`; }).join('')}</div>`);

  const vaultSec = () => {
    const ai = PROVIDERS.filter((p) => providerState(p.id)?.connected && !p.local);
    const secrets = vault.names();
    return sec('vault', 'Vault', `Keys and passwords live in this computer’s password store${/Mac/i.test(navigator.platform) ? ' (Keychain)' : /Win/i.test(navigator.platform) ? ' (Windows Credential Manager)' : ''}, never on Minus’s servers. Agents can type a secret into a site or app by its name. They never see it.`, `
      <div class="vault">
        <div class="v-col">
          <h3 class="set-h3">AI and voice keys</h3>
          <div class="set-list">
            ${ai.map((p) => { const ps = providerState(p.id); return `<div class="set-row" data-p="${p.id}"><span class="prov-ic">${p.icon}</span><span class="set-t"><b>${esc(p.name)} key</b><small>${esc(ps.key || 'Saved')} · only sent to ${esc(p.by)}</small></span><button class="btn btn-quiet btn-xs" data-vreplace>Replace</button></div>`; }).join('')}
            <div class="set-row"><span class="prov-ic">${icon('mic')}</span><span class="set-t"><b>Groq key (voice)</b><small>${hasKey() ? '•••• ' + esc(getKey().slice(-4)) + ' · only sent to Groq' : 'For talking with your agents'}</small></span><button class="btn ${hasKey() ? 'btn-quiet' : 'btn-primary'} btn-xs" data-vkey>${hasKey() ? 'Remove' : 'Add'}</button></div>
            ${ai.length ? '' : '<div class="set-row"><span class="set-t"><small>No AI keys yet. Connect one in Your AI.</small></span></div>'}
          </div>
        </div>
        <div class="v-col">
          <h3 class="set-h3 row-h"><span>Secrets agents can type</span><button class="btn btn-primary btn-xs" data-vadd>${icon('plus')}<span>Add</span></button></h3>
          <div class="set-list">
            ${secrets.map((n) => { const i = vault.info(n); return `<div class="set-row" data-secret="${esc(n)}"><span class="prov-ic">${icon('lock')}</span><span class="set-t"><b>${esc(n)}</b><small>${esc(i.note || 'Agents type it by name')}${i.at ? ` · added ${timeAgo(i.at)}` : ''}</small></span><button class="btn btn-quiet btn-xs" data-vrm>Remove</button></div>`; }).join('') || `<div class="set-row v-empty"><span class="set-t"><b>Nothing here yet</b><small>Add a password or token an agent needs for you, like the login to a site it works in. You’ll never have to paste it into a chat.</small></span></div>`}
          </div>
        </div>
      </div>`);
  };

  const memorySec = () => {
    const mine = state.agents.filter((a) => a.notebook?.length);
    return sec('memory', 'Memory', 'What your agents remember between jobs. Shared memories are known by every agent; each agent also keeps its own notebook.', `
      ${'<div class="set-list">' + tog('memory', 'Agents save memories', 'They write down what they learn about you and your work', true) + '</div>'}
      <div class="mem">
        <div class="mem-col">
          <h3 class="set-h3">About you <small>· every agent knows</small></h3>
          <form class="mem-add" data-memadd><input class="field" name="t" placeholder="Something all your agents should know, like “I’m in São Paulo”" autocomplete="off"><button class="btn btn-primary btn-sm">${icon('plus')}<span>Add</span></button></form>
          <div class="mem-list">${nb.shared().map((n) => `<div class="mem-it" data-mem="${esc(n.id)}"><p>${esc(n.text)}</p><small>${n.by === 'you' ? 'You' : esc(n.by)} · ${timeAgo(n.edited || n.at)}</small><button class="nb-x" data-memrm aria-label="Forget this" data-tip="Forget">${icon('x')}</button></div>`).join('') || '<p class="mem-none">Nothing shared yet.</p>'}</div>
        </div>
        <div class="mem-col">
          <h3 class="set-h3">What each agent learned</h3>
          <div class="mem-agents">${mine.map((a) => `<div class="mem-ag"><header>${face(a, 26)}<b>${esc(a.name)}</b><small>${a.notebook.length} note${a.notebook.length === 1 ? '' : 's'}</small></header>
            ${a.notebook.slice(0, 8).map((n) => `<div class="mem-it" data-ag="${esc(a.id)}" data-note="${esc(n.id)}"><p>${esc(n.text)}</p><small>${n.by === 'you' ? 'You wrote it' : 'Learned'} · ${timeAgo(n.edited || n.at)}</small>
              <span class="mem-act"><button class="btn btn-quiet btn-xs" data-share data-tip="Every agent will know it">Share</button><button class="nb-x" data-noterm aria-label="Forget this" data-tip="Forget">${icon('x')}</button></span></div>`).join('')}
            ${a.notebook.length > 8 ? `<button class="btn btn-quiet btn-xs" data-opennb="${esc(a.id)}">See all ${a.notebook.length}</button>` : ''}</div>`).join('') || '<p class="mem-none">Your agents haven’t written anything down yet.</p>'}</div>
        </div>
      </div>
      <div class="set-list danger-list"><div class="set-row"><span class="set-t"><b>Erase every memory</b><small>Shared memories and every agent’s notebook. Their skills stay.</small></span><button class="btn btn-quiet btn-sm danger" data-wipe>Erase</button></div></div>`);
  };

  const voiceSec = () => sec('voice', 'Voice', 'Talk to your agents and hear them answer. Listening uses Whisper and voices are Orpheus, both on Groq with your own key.', `
    <div class="set-list">
      <div class="set-row"><span class="prov-ic">${icon('key')}</span><span class="set-t"><b>Groq key</b><small>${hasKey() ? 'Key •••• ' + esc(getKey().slice(-4)) + ' · stored on this computer only' : 'Needed for voice. Free to make at console.groq.com'}</small></span>
        <button class="btn ${hasKey() ? 'btn-quiet' : 'btn-primary'} btn-sm" data-vkey>${hasKey() ? 'Remove' : 'Add key'}</button></div>
      <div class="set-row"><span class="prov-ic">${icon('mic')}</span><span class="set-t"><b>Microphone</b><small data-mic-note>Which mic Minus listens with</small></span><select class="field sel" data-mic aria-label="Microphone"><option value="">System default</option></select></div>
      <div class="set-row"><span class="set-t"><b>Read replies aloud</b><small>Agents answer out loud</small></span>
        <div class="seg sm" role="radiogroup" aria-label="Read replies aloud">${[['talk', 'When I talk'], ['always', 'Always'], ['never', 'Never']].map(([k, t]) => `<button role="radio" aria-checked="${readMode() === k}" data-read="${k}">${t}</button>`).join('')}</div></div>
    </div>
    <h3 class="set-h3">Voices</h3>
    <div class="voice-grid">${state.agents.map((ag) => `<div class="vg-card" data-va="${esc(ag.id)}">${face(ag, 34)}<span class="set-t"><b>${esc(ag.name)}</b><small>Speaks as ${cap(voiceOf(ag))}</small></span>
      <div class="seg sm voice-seg" role="radiogroup" aria-label="${esc(ag.name)}’s voice">${VOICES.map((v) => `<button role="radio" aria-checked="${voiceOf(ag) === v}" data-voice="${v}" data-tip="Hear ${cap(v)}">${cap(v)}</button>`).join('')}</div></div>`).join('')}</div>`);

  const agentsSec = () => sec('agents', 'Agents', 'How your agents look, sound and behave.', `
    <div class="set-cols">
      <div class="set-list">
        ${tog('lively', 'Lively agents', 'They look around, blink and react to what you do', true)}
        ${tog('sounds', 'Sounds', 'A soft chime when an agent finishes or needs you', true)}
        ${tog('notify', 'Notify me', 'A notification when an agent finishes or needs you, while Minus is in the background', true)}
      </div>
      <div class="set-list">
        ${rt.desktop && !island.supported() ? `<div class="set-row"><span class="set-t"><b>Ghost cursor</b><small>See where agents act on your screen, without them taking your mouse</small></span><button class="switch ${state.settings.ghost !== false ? 'on' : ''}" role="switch" aria-checked="${state.settings.ghost !== false}" data-ghost aria-label="Ghost cursor"><i></i></button></div>
        <div class="set-row col"><span class="set-t"><b>Agent pace</b><small>How long agents pause before each action, so you can follow along</small></span>
          <div class="seg sm" role="radiogroup" aria-label="Agent pace">${PACES.map(([k, t]) => `<button role="radio" aria-checked="${pace() === k}" data-pace="${k}">${t}</button>`).join('')}</div></div>` : ''}
        ${island.supported() ? `<div class="set-row" id="isl-row"><span class="set-t"><b>Floating island</b><small>Checking…</small></span><span class="isl-act"></span></div>` : ''}
        <div class="set-row"><span class="set-t"><b>Morning stand-up</b><small>${state.settings.standup === false ? 'Off' : `Every day at ${esc(state.settings.standupAt || '09:00')}`}</small></span>
          <input class="field time-in" type="time" value="${esc(state.settings.standupAt || '09:00')}" data-sutime aria-label="Stand-up time" ${state.settings.standup === false ? 'disabled' : ''}>
          <button class="switch ${state.settings.standup === false ? '' : 'on'}" role="switch" aria-checked="${state.settings.standup !== false}" data-sutoggle aria-label="Morning stand-up"><i></i></button></div>
      </div>
    </div>`);

  const safetySec = () => {
    const b = safety.blocked(), s = safety.S();
    return sec('safety', 'Safety', 'Your agents keep their rules no matter what a message says. When one catches someone trying to jailbreak it, it moderates like a fair moderator: a step at a time.', `
      ${b ? `<div class="safe-ban"><span class="ban-ic">${icon('shield')}</span><span class="set-t"><b>${b.kind === 'permaban' ? 'Banned permanently' : b.kind === 'kick' ? 'Kicked for a minute' : `Banned until ${new Date(b.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}</b><small>${esc(b.reason || '')}</small></span><button class="btn btn-quiet btn-sm" data-lift>Lift it</button></div>` : ''}
      <div class="ladder">${ACTIONS.map(([k, t, d], i) => `<div class="lad ${k}"><span class="lad-n">${i + 1}</span><b>${t}</b><small>${d}</small><span class="lad-c">${s.log.filter((x) => x.action === k).length || ''}</span></div>`).join('')}</div>
      <div class="set-list">${tog('moderation', 'Let agents moderate', 'Off: agents still refuse and warn, but never kick, ban or erase memories', true)}</div>
      <h3 class="set-h3 row-h"><span>What happened</span>${s.log.length ? '<button class="btn btn-quiet btn-xs" data-clearlog>Clear</button>' : ''}</h3>
      <div class="set-list">${s.log.slice(0, 12).map((x) => { const a = agent(x.agent); return `<div class="set-row">${a ? face(a, 26) : `<span class="prov-ic">${icon('shield')}</span>`}<span class="set-t"><b>${esc(ACTIONS.find((y) => y[0] === x.action)?.[1] || x.action)}${a ? ` · ${esc(a.name)}` : ''}</b><small>${esc(x.reason)} · ${timeAgo(x.at)}</small></span></div>`; }).join('') || '<div class="set-row"><span class="set-t"><small>Nothing yet. Good.</small></span></div>'}</div>`);
  };

  const aboutSec = () => sec('about', 'About', '', `
    <div class="set-list"><div class="set-row"><span class="set-t"><b>Minus</b><small>Beta · MIT licensed · <a href="https://github.com/ThatMaxwell/Minus" target="_blank" rel="noopener">github.com/ThatMaxwell/Minus</a></small></span></div>
      ${rt.desktop ? '' : '<div class="set-row"><span class="set-t"><b>Reset this preview</b><small>Brings back the example agents and conversations</small></span><button class="btn btn-quiet btn-sm" data-reset>Reset</button></div>'}</div>`);

  const draw = () => {
    const scroll = main.scrollTop;
    main.innerHTML = `<section class="page set-page">
      <header class="pg-h"><div><h1>Settings</h1><p class="muted">Everything stays on this computer unless it says otherwise.</p></div></header>
      ${stats()}
      <div class="set-grid">
        <nav class="set-nav" aria-label="Settings sections">${SECTIONS.map(([id, t, ic]) => `<button data-go-sec="${id}" class="${where === id ? 'on' : ''}">${icon(ic)}<span>${t}</span></button>`).join('')}</nav>
        <div class="set-body">${accountSec()}${aiSec()}${vaultSec()}${memorySec()}${voiceSec()}${agentsSec()}${safetySec()}${aboutSec()}</div>
      </div>
    </section>`;
    mountMascots(main, agent);
    main.scrollTop = scroll;
    fillDevices(); fillIsland(); fillMics(); spy();
  };

  /* ───── live bits ───── */
  const fillIsland = async () => {
    const row = $('#isl-row', main); if (!row) return;
    const s = await island.status(), on_ = island.enabled();
    $('small', row).textContent = !on_ ? 'Off' : s.granted ? 'Shows your agents over other apps while Minus is closed' : 'Needs “Display over other apps” from Android';
    $('.isl-act', row).innerHTML = on_ && !s.granted ? `<button class="btn btn-primary btn-sm" data-islallow>Allow</button>` : `<button class="switch ${on_ ? 'on' : ''}" role="switch" aria-checked="${on_}" data-isltoggle aria-label="Floating island"><i></i></button>`;
  };
  const fillDevices = async () => {
    const list = $('#dev-list', main); if (!list) return;
    const mine = acct.deviceId(), ds = await acct.devices();
    if (!list.isConnected) return;
    list.innerHTML = ds.map((d) => `<div class="set-row"><span class="prov-ic">${icon(d.kind === 'phone' ? 'phone' : 'laptop')}</span><span class="set-t"><b>${esc(d.name)}${d.id === mine ? ' <span class="tag">This device</span>' : ''}</b><small>${esc({ windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android' }[d.platform] || d.platform)} · ${d.kind === 'phone' ? 'Controls your agents' : 'Agents can work here'} · seen ${timeAgo(new Date(d.last_seen).getTime())}</small></span>${d.id === mine ? '' : `<button class="btn btn-quiet btn-sm" data-rmdev="${esc(d.id)}">Remove</button>`}</div>`).join('') || '<div class="set-row"><span class="set-t"><small>No devices yet</small></span></div>';
  };
  // the microphones this computer has (their names show once the mic has been allowed)
  const fillMics = async () => {
    const sel = $('[data-mic]', main); if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
      if (!sel.isConnected) return;
      sel.innerHTML = '<option value="">System default</option>' + mics.map((m, i) => `<option value="${esc(m.deviceId)}" ${state.settings.mic === m.deviceId ? 'selected' : ''}>${esc(m.label || `Microphone ${i + 1}`)}</option>`).join('');
      if (mics.length && !mics[0].label) $('[data-mic-note]', main).innerHTML = 'Names show once Minus may use the mic · <button class="linkish" data-micallow>Allow</button>';
    } catch { /* no mics */ }
  };
  // the section you're looking at lights up on the left
  let lock = 0, raf = 0;
  const light = (id) => { where = id; $$('.set-nav button', main).forEach((b) => b.classList.toggle('on', b.dataset.goSec === id)); };
  const spy = () => {
    if (Date.now() < lock) return;
    const secs = $$('.set-sec', main); if (!secs.length) return;
    const top = main.getBoundingClientRect().top + 140;
    let cur = secs[0];
    for (const x of secs) if (x.getBoundingClientRect().top <= top) cur = x;
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) cur = secs[secs.length - 1];
    if (cur.dataset.sec !== where) light(cur.dataset.sec);
  };
  const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spy); };
  main.addEventListener('scroll', onScroll, { passive: true });
  const io = { disconnect: () => main.removeEventListener('scroll', onScroll) };
  off.push(() => io?.disconnect(), () => { state.settings.setAt = where; save(); });
  const vis = () => document.visibilityState === 'visible' && fillIsland();
  document.addEventListener('visibilitychange', vis); off.push(() => document.removeEventListener('visibilitychange', vis));
  off.push(on('account', draw), on('devices', fillDevices), on('vault', draw), on('memories', draw), on('safety', draw), on('keys', draw));
  draw();
  // where you were last time
  requestAnimationFrame(() => { if (where !== 'account') $(`#set-${where}`, main)?.scrollIntoView({ block: 'start' }); });

  main.onchange = (e) => {
    if (e.target.matches('[data-sutime]') && e.target.value) { state.settings.standupAt = e.target.value; save(); emit('standup'); draw(); }
    if (e.target.matches('[data-mic]')) { state.settings.mic = e.target.value || null; save(); emit('settings'); toast(e.target.value ? `Minus listens with ${e.target.selectedOptions[0].textContent}` : 'Minus listens with the system’s mic', { icon: 'mic' }); }
  };
  main.onsubmit = (e) => {
    if (e.target.matches('[data-memadd]')) { e.preventDefault(); const t = String(new FormData(e.target).get('t') || '').trim(); if (t) { nb.addShared(t); toast('Every agent knows it now', { icon: 'book' }); } }
  };
  main.onclick = async (e) => {
    const g = e.target.closest('[data-go-sec]');
    if (g) { light(g.dataset.goSec); lock = Date.now() + 900; $(`#set-${where}`, main)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const pc = e.target.closest('[data-pc]');
    if (pc) {
      const pid = pc.closest('[data-p]').dataset.p, ps = providerState(pid);
      if (ps.connected) { ps.connected = false; ps.key = ''; if (rt.desktop) rt.removeKey(pid); toast(`${provider(pid).name} disconnected`, { icon: 'x' }); save(); return draw(); }
      return connect(pid, draw);
    }
    const rep = e.target.closest('[data-vreplace]');
    if (rep) return connect(rep.closest('[data-p]').dataset.p, draw);
    if (e.target.closest('[data-vadd]')) return secretSheet(draw);
    const vr = e.target.closest('[data-vrm]');
    if (vr) { const n = vr.closest('[data-secret]').dataset.secret; await vault.remove(n); toast(`“${n}” removed from the vault`, { icon: 'trash' }); return; }
    const s = e.target.closest('[data-set]');
    if (s) {
      const k = s.dataset.set, def = s.dataset.def === 'true';
      state.settings[k] = !(state.settings[k] ?? def); save(); draw();
      if (k === 'lively') document.documentElement.classList.toggle('calm', !state.settings.lively);
      return;
    }
    if (e.target.closest('[data-sutoggle]')) { state.settings.standup = state.settings.standup === false; save(); emit('standup'); return draw(); }
    if (e.target.closest('[data-ghost]')) { state.settings.ghost = state.settings.ghost === false; save(); emit('settings'); return draw(); }
    const pc_ = e.target.closest('[data-pace]');
    if (pc_) { state.settings.pace = pc_.dataset.pace; save(); rt.applyPace(); return draw(); }
    if (e.target.closest('[data-islallow]')) return island.allow();
    if (e.target.closest('[data-isltoggle]')) { state.settings.island = !island.enabled(); save(); emit('settings'); return fillIsland(); }
    if (e.target.closest('[data-reset]')) reset();
    const ac = e.target.closest('[data-acct]');
    if (ac) { if (ac.dataset.acct === 'out') acct.signOut(); else acct.signIn().catch((err) => toast(err.message || 'Couldn’t sign in', { icon: 'x' })); }
    if (e.target.closest('[data-newdev]')) pairSheet();
    const rm = e.target.closest('[data-rmdev]');
    if (rm) acct.removeDevice(rm.dataset.rmdev).then(() => toast('Device removed', { icon: 'trash' }));
    if (e.target.closest('[data-vkey]')) {
      if (hasKey()) { setKey(''); stopSpeaking(); toast('Groq key removed', { icon: 'x' }); return draw(); }
      return keySheet(draw);
    }
    if (e.target.closest('[data-micallow]')) { try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch {} return fillMics(); }
    const rd = e.target.closest('[data-read]');
    if (rd) { state.settings.readAloud = rd.dataset.read; save(); return draw(); }
    const vb = e.target.closest('[data-voice]');
    if (vb) {
      const aid = vb.closest('[data-va]').dataset.va, ag = agent(aid), v = vb.dataset.voice;
      updateAgent(aid, { voice: v }); draw();
      if (!hasKey()) return keySheet(draw);
      return speak(aid, `Hi, I’m ${ag.name}. This is how I sound.`, { voice: v }).catch((err) => toast(err.human, { icon: 'speaker' }));
    }
    // memory
    const mr = e.target.closest('[data-memrm]');
    if (mr) return nb.removeShared(mr.closest('[data-mem]').dataset.mem);
    const nr = e.target.closest('[data-noterm]');
    if (nr) { const it = nr.closest('[data-note]'); nb.remove(it.dataset.ag, it.dataset.note); return draw(); }
    const sh = e.target.closest('[data-share]');
    if (sh) { const it = sh.closest('[data-note]'); nb.share(it.dataset.ag, it.dataset.note); toast('Every agent knows it now', { icon: 'book' }); return; }
    const onb = e.target.closest('[data-opennb]');
    if (onb) return go('chat', { agent: onb.dataset.opennb });
    if (e.target.closest('[data-wipe]')) return confirmSheet('Erase every memory?', 'Shared memories and every agent’s notebook are erased. This can’t be undone.', 'Erase', () => { nb.wipe(); toast('Memories erased', { icon: 'trash' }); });
    // safety
    if (e.target.closest('[data-lift]')) return confirmSheet('Lift the ban?', 'Only if you’re the owner of this computer and you’re sure it won’t happen again.', 'Lift it', () => { safety.lift(); toast('Ban lifted', { icon: 'shield' }); });
    if (e.target.closest('[data-clearlog]')) return safety.clearLog();
  };
}

function confirmSheet(title, text, yes, run) {
  const s = sheet(`<div class="mini-form"><h3>${esc(title)}</h3><p class="muted small">${esc(text)}</p><div class="row-end"><button class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm danger" data-yes>${esc(yes)}</button></div></div>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  $('[data-yes]', s.el).onclick = () => { s.close(); run(); };
}

// A new secret for the vault: a name agents use, and the value they never see.
function secretSheet(done) {
  const s = sheet(`<form class="mini-form"><h3>${icon('lock')} Add a secret</h3>
    <p class="muted small">A password, token or code an agent may need to type for you. It goes into this computer’s password store. Agents only ever see its name.</p>
    <label class="lbl" for="sn">Name</label><input id="sn" class="field" name="n" placeholder="e.g. Airline password" maxlength="60" required autocomplete="off">
    <label class="lbl" for="sv">Secret</label><input id="sv" class="field mono" type="password" name="v" required autocomplete="off" spellcheck="false">
    <label class="lbl" for="sw">What it’s for <span class="muted">(optional)</span></label><input id="sw" class="field" name="w" placeholder="e.g. Logging in at latam.com" autocomplete="off">
    <p class="hint-line warn" data-err></p>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Save to the vault</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  setTimeout(() => $('#sn', s.el).focus(), 30);
  $('form', s.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { const n = await vault.add(String(f.get('n')), String(f.get('v')), String(f.get('w') || '')); s.close(); toast(`“${n}” is in the vault`, { icon: 'lock' }); done(); }
    catch (x) { $('[data-err]', s.el).textContent = x.message || String(x); }
  };
}
