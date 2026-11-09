// A conversation with one agent, its live computer, and the composer.
import { state, on, agent, computer, updateAgent, go, emit, save, providerState, post, id } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, menu, sheet, toast, motion, IN, mod, timeAgo } from '../ui.js';
import { react } from '../director.js';
import { respond, choose, resolve } from '../brain.js';
import { provider, PROVIDERS, STATUS } from '../data.js';
import { ComputerSim } from '../../js/computer.js';
import { openCreate } from './create.js';
import { Listener, transcribe, hasKey, heardYou, speak, stopSpeaking, speaking, VoiceError } from '../voice.js';
import { keySheet } from './pages.js';

let off = [];
// stop listening to the store when another page takes over (the router calls this)
export const leaveChat = () => { off.forEach((f) => f()); off = []; };
export function chat(main) {
  leaveChat();
  const a = agent(state.route.agent);
  if (!a) { main.innerHTML = `<div class="empty"><p>Pick an agent, or make a new one.</p></div>`; return; }
  const comp = computer(a.computer), prov = provider(a.model);
  main.innerHTML = `
    <section class="chat ${state.panel ? 'with-panel' : ''}">
      <header class="ch-h">
        <div class="ch-who">
          ${face(a, 46, 'data-follow="1"')}
          <div class="ch-id"><b>${esc(a.name)}</b><span class="ch-status"><i class="dot ${STATUS[a.status]?.tone}"></i><span>${esc(a.statusText || STATUS[a.status]?.label)}</span></span></div>
        </div>
        <div class="ch-tools">
          <button class="chip" data-act="model" data-tip="Which AI ${esc(a.name)} thinks with">${prov.icon}<span>${esc(prov.name)}</span>${icon('chevron', 'rot')}</button>
          <button class="chip" data-act="computer" data-tip="Which computer ${esc(a.name)} works on">${icon(comp?.kind === 'local' ? 'laptop' : 'cloud')}<span>${esc(comp?.name || 'No computer')}</span>${icon('chevron', 'rot')}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-act="look" data-tip="Change how ${esc(a.name)} looks">${icon('sparkle')}</button>
          <button class="icon-btn" data-act="pause" data-tip="${a.status === 'paused' ? 'Resume' : 'Pause'} ${esc(a.name)}">${icon(a.status === 'paused' ? 'play' : 'pause')}</button>
          <button class="icon-btn ${state.panel ? 'on' : ''}" data-act="panel" data-tip="${state.panel ? 'Hide' : 'Show'} the computer|mod .">${icon('panel')}</button>
          <button class="icon-btn" data-act="more" data-tip="More">${icon('more')}</button>
        </div>
      </header>
      <div class="ch-body">
        <div class="thread-col">
          <div class="thread" role="log" aria-live="polite"></div>
          <form class="composer" autocomplete="off">
            <div class="cmp-box">
              <textarea rows="1" placeholder="Message ${esc(a.name)}…" aria-label="Message ${esc(a.name)}"></textarea>
              <div class="cmp-rec" hidden aria-live="polite"><span class="rec-dot"></span><span class="rec-wave">${'<i></i>'.repeat(28)}</span><span class="rec-t">Listening…</span><span class="grow"></span><span class="muted small rec-k"><kbd>Enter</kbd> done · <kbd>Esc</kbd> cancel</span></div>
              <div class="cmp-row">
                <button type="button" class="icon-btn sm" data-act="attach" data-tip="Attach files or a screenshot">${icon('paperclip')}</button>
                <button type="button" class="chip sm" data-act="model" data-tip="Change the AI for this agent">${prov.icon}<span>${esc(prov.name)}</span></button>
                <span class="grow"></span>
                <button type="button" class="icon-btn sm mic" data-act="mic" data-tip="Talk to ${esc(a.name)}|mod J" aria-label="Talk to ${esc(a.name)}">${icon('mic')}<span class="mic-ring"></span></button>
                <button type="submit" class="send" disabled data-tip="Send|Enter">${icon('send')}</button>
              </div>
            </div>
            <p class="cmp-hint">${esc(a.name)} works on ${esc(comp?.name || 'its computer')} and asks before anything it can’t undo. <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line.</p>
          </form>
        </div>
        <aside class="pc-panel" aria-label="${esc(a.name)}’s computer">
          <div class="pcp-h"><span class="live ${a.status === 'working' ? 'on' : ''}"><i></i>${a.status === 'working' ? 'Live' : 'Idle'}</span><span class="pcp-name">${esc(comp?.name || '')}</span>
            <button class="btn btn-quiet btn-xs" data-act="takeover" data-tip="Use the mouse and keyboard yourself">${icon('hand')}<span>Take over</span></button></div>
          <div class="pcp-screen"><div class="pcp-sim"></div><div class="pcp-yours" hidden><div>${icon('hand')}<b>You’re driving</b><span>${esc(a.name)} is watching and will pick up where you leave off.</span><button class="btn btn-primary btn-sm" data-act="giveback">Give back to ${esc(a.name)}</button></div></div></div>
          <div class="pcp-log"><div class="pcp-log-h"><span>Action log</span><span class="muted">${esc(comp?.os || '')}</span></div><div class="pcp-rows"></div></div>
        </aside>
      </div>
    </section>`;
  mountMascots(main, agent);

  const thread = $('.thread', main), form = $('.composer', main), ta = $('textarea', main), send = $('.send', main);

  /* ───────── thread ───────── */
  const render = () => {
    const msgs = state.threads[a.id] || [];
    let prev = null;
    thread.innerHTML = msgs.map((m) => { const h = msgHTML(a, m, prev); prev = m; return h; }).join('') + `<div class="typing" hidden><span class="face-dots">${face(a, 22)}</span><span class="dots"><i></i><i></i><i></i></span></div>`;
    mountMascots(thread, agent);
    thread.scrollTop = thread.scrollHeight;
  };
  render();

  const appendMsg = (m) => {
    const msgs = state.threads[a.id], prev = msgs[msgs.length - 2];
    const tmp = document.createElement('div'); tmp.innerHTML = msgHTML(a, m, prev);
    const node = tmp.firstElementChild; if (!node) return;
    thread.insertBefore(node, $('.typing', thread));
    mountMascots(node, agent);
    motion().animate(node, { opacity: [0, 1], y: [10, 0], filter: ['blur(3px)', 'blur(0px)'] }, { duration: 0.45, ease: IN });
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  };
  off.push(on('message', ({ agent: aid, msg }) => { if (aid === a.id) appendMsg(msg); }));
  off.push(on('message:update', ({ agent: aid, msg }) => {
    if (aid !== a.id) return;
    const node = $(`[data-mid="${CSS.escape(msg.mid || msg.id)}"]`, thread); if (!node) return;
    const tmp = document.createElement('div'); tmp.innerHTML = msgHTML(a, msg, null, node.classList.contains('cont'));
    const fresh = tmp.firstElementChild; node.replaceWith(fresh); mountMascots(fresh, agent);
  }));
  off.push(on('typing', ({ agent: aid, on: t }) => { if (aid === a.id) { $('.typing', thread).hidden = !t; if (t) thread.scrollTop = thread.scrollHeight; } }));
  off.push(on('agent', (x) => {
    if (x.id !== a.id) return;
    $('.ch-status span', main).textContent = x.statusText || STATUS[x.status]?.label || '';
    $('.ch-status .dot', main).className = 'dot ' + (STATUS[x.status]?.tone || 'dim');
    const live = $('.pcp-h .live', main); live.classList.toggle('on', x.status === 'working'); live.lastChild.textContent = x.status === 'working' ? 'Live' : 'Idle';
  }));

  thread.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ap]');
    if (b) { const card = b.closest('[data-mid]'); return resolve(a.id, card.dataset.mid, b.dataset.ap); }
    const c = e.target.closest('[data-choice]');
    if (c) { const card = c.closest('[data-mid]'); return choose(a.id, card.dataset.mid, c.dataset.choice); }
  });
  thread.addEventListener('pointerover', (e) => { const b = e.target.closest('[data-ap="approved"]'); if (b) react(a.id, 'look', b); });

  /* ───────── composer: the agent listens, nods along, and nods when you send ───────── */
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; send.disabled = !ta.value.trim(); };
  let lastLen = 0;
  ta.addEventListener('focus', () => react(a.id, 'listening', ta));
  ta.addEventListener('blur', () => { if (!ta.value.trim()) react(a.id, 'calm'); });
  ta.addEventListener('input', () => {
    grow();
    const v = ta.value;
    if (!v.trim()) react(a.id, 'calm');
    else { react(a.id, 'listening', ta); if (v.length > lastLen && /\s$/.test(v)) react(a.id, 'word'); }
    lastLen = v.length;
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  const sendText = (text, via) => {
    ta.value = ''; grow(); lastLen = 0;
    if (via === 'voice') heardYou(a.id);
    post(a.id, via ? { from: 'me', text, via } : { from: 'me', text });
    react(a.id, 'send');
    respond(a.id, text);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim(); if (text) sendText(text);
  });
  setTimeout(() => ta.focus({ preventScroll: true }), 50);

  /* ───────── talking out loud: you speak, Whisper writes it down, the agent answers in its voice ───────── */
  const mic = $('.mic', main), rec = $('.cmp-rec', main), recT = $('.rec-t', main), bars = [...$$('.rec-wave i', main)];
  let listener = null, busyMic = false;
  const recUI = (isOn, label = 'Listening…') => {
    rec.hidden = !isOn; ta.style.visibility = isOn ? 'hidden' : ''; recT.textContent = label;
    mic.classList.toggle('on', isOn); mic.dataset.tip = isOn ? 'Done talking|Enter' : `Talk to ${a.name}|mod J`;
    mic.innerHTML = icon(isOn ? 'stop' : 'mic') + '<span class="mic-ring"></span>';
    if (!isOn) mic.style.removeProperty('--lv');
  };
  const finishTalk = async () => {
    if (!listener || busyMic) return;
    busyMic = true;
    const l = listener; listener = null;
    recUI(true, 'Writing it down…'); bars.forEach((b) => (b.style.transform = ''));
    rec.classList.add('busy');
    react(a.id, 'thinking');
    try {
      const r = await l.stop();
      if (!r || !r.heard || r.ms < 400) throw new VoiceError('quiet');
      const text = await transcribe(r.blob);
      recUI(false); sendText(text, 'voice');
    } catch (e) {
      recUI(false); react(a.id, 'confused');
      toast(e.human || 'Voice didn’t work this time.', { icon: 'mic' });
    } finally { busyMic = false; rec.classList.remove('busy'); }
  };
  const cancelTalk = () => { if (!listener) return; listener.cancel(); listener = null; recUI(false); react(a.id, 'calm'); };
  async function talk() {
    if (busyMic) return;
    if (listener) return finishTalk();
    if (!hasKey()) return keySheet(() => talk());
    stopSpeaking();
    let k = 0;
    listener = new Listener({
      onLevel: (lv) => {
        mic.style.setProperty('--lv', lv.toFixed(3));
        const b = bars[k++ % bars.length]; if (b) b.style.transform = `scaleY(${(0.12 + lv * 0.95).toFixed(3)})`;
        if (lv > 0.35 && Math.random() < 0.04) react(a.id, 'word');
      },
      onAutoStop: () => finishTalk(),
    });
    try { await listener.start(); } catch (e) { listener = null; toast(e.human || 'Can’t use the microphone.', { icon: 'mic' }); return; }
    recUI(true); react(a.id, 'listening', mic);
  }
  const keyTalk = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); talk(); }
    else if (listener && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelTalk(); }
    else if (listener && e.key === 'Enter') { e.preventDefault(); finishTalk(); }
  };
  addEventListener('keydown', keyTalk, true);
  off.push(() => { removeEventListener('keydown', keyTalk, true); cancelTalk(); });

  // read a reply out loud, or stop it
  thread.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say]'); if (!b) return;
    const node = b.closest('[data-mid]'), mid = node.dataset.mid;
    if (speaking()?.mid === mid) return stopSpeaking();
    if (!hasKey()) return keySheet(() => b.click());
    const m = (state.threads[a.id] || []).find((x) => x.mid === mid);
    if (m) speak(a.id, m.text, { mid }).catch((err) => toast(err.human || 'Voice didn’t work this time.', { icon: 'speaker' }));
  });
  off.push(on('speaking', ({ agent: aid, mid, on: isOn, loading }) => {
    if (aid !== a.id || !mid) return;
    const node = $(`[data-mid="${CSS.escape(mid)}"]`, thread); if (!node) return;
    node.classList.toggle('saying', !!isOn && !loading); node.classList.toggle('say-wait', !!isOn && !!loading);
    const sb = $('[data-say]', node); if (sb) sb.dataset.tip = isOn ? 'Stop' : 'Read aloud';
  }));

  /* ───────── the agent's computer ───────── */
  const sim = new ComputerSim($('.pcp-sim', main), { agent: a.name, color: a.color, speed: 1.15, url: comp?.kind === 'local' ? 'localhost:3000/login' : 'crm.acme.example/leads/new',
    onStep: ({ text }) => {
      const rows = $('.pcp-rows', main); if (!rows) return; // left the chat mid-step
      const r = document.createElement('div');
      r.className = 'lg'; r.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span></span>`;
      r.querySelector('span').textContent = text; rows.prepend(r);
      while (rows.children.length > 40) rows.lastChild.remove();
    } });
  let driving = false;
  const syncSim = () => { const x = agent(a.id); if (x?.status === 'working' && state.panel && !driving) { if (sim.stopped) sim.run(); } else sim.stop(); };
  syncSim();
  off.push(on('agent', (x) => x.id === a.id && syncSim()), () => sim.stop());

  /* ───────── header actions ───────── */
  main.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'model') {
      return menu(b, PROVIDERS.filter((p) => providerState(p.id)?.connected).map((p) => ({ label: `${p.name}${p.id === a.model ? '  ✓' : ''}`, run: () => { updateAgent(a.id, { model: p.id }); toast(`${a.name} now thinks with ${p.name}`); react(a.id, 'yes'); chat(main); } }))
        .concat([]));
    }
    if (act === 'computer') return menu(b, state.computers.map((c) => ({ label: c.name + (c.id === a.computer ? '  ✓' : ''), icon: c.kind === 'local' ? 'laptop' : 'cloud', run: () => { updateAgent(a.id, { computer: c.id }); toast(`${a.name} moved to ${c.name}`); react(a.id, c.kind === 'local' ? 'peek' : 'yes'); chat(main); } })));
    if (act === 'look') return openCreate({ edit: a.id, step: 0 });
    if (act === 'pause') {
      const paused = a.status === 'paused';
      updateAgent(a.id, paused ? { status: 'idle', statusText: 'Ready' } : { status: 'paused', statusText: 'Paused' });
      react(a.id, paused ? 'wake' : 'sleep'); toast(paused ? `${a.name} is back` : `${a.name} is paused`, { icon: paused ? 'play' : 'pause' });
      return chat(main);
    }
    if (act === 'panel') { state.panel = !state.panel; save(); return chat(main); }
    if (act === 'more') return menu(b, [
      { label: 'Rename', icon: 'edit', run: () => rename(a, main) },
      { label: 'Change look', icon: 'sparkle', run: () => openCreate({ edit: a.id, step: 0 }) },
      { label: 'Edit job and permissions', icon: 'shield', run: () => openCreate({ edit: a.id, step: 1 }) },
      { label: 'Duplicate', icon: 'copy', run: () => duplicate(a) },
      '-',
      { label: `Delete ${a.name}`, icon: 'trash', danger: true, run: () => remove(a) },
    ], { align: 'right' });
    if (act === 'takeover') {
      driving = true; sim.stop(); $('.pcp-yours', main).hidden = false; react(a.id, 'takeover');
      motion().animate($('.pcp-yours > div', main), { opacity: [0, 1], scale: [0.95, 1] }, { type: 'spring', stiffness: 380, damping: 28 });
    }
    if (act === 'giveback') { driving = false; $('.pcp-yours', main).hidden = true; react(a.id, 'giveback'); syncSim(); toast(`${a.name} has the computer again`, { icon: 'hand' }); }
    if (act === 'attach') toast('Drop files here, or paste a screenshot', { icon: 'paperclip' });
    if (act === 'mic') return talk();
  };
  // the agent glances at whatever header button you point at
  $('.ch-tools', main).addEventListener('pointerover', (e) => { const b = e.target.closest('button'); if (b) mascotsOf(a.id).forEach((m) => main.contains(m.canvas) && $('.ch-h', main).contains(m.canvas) && m.lookAtEl(b, 1.5)); });
}

export function msgHTML(a, m, prev, cont) {
  const mid = esc(m.mid || m.id || '');
  const sameRun = cont ?? (prev && prev.from === m.from && prev.kind !== 'day' && m.from === 'agent');
  if (m.kind === 'day') return `<div class="day" data-mid="${mid}"><span>${esc(m.text)}</span></div>`;
  if (m.from === 'system' || m.kind === 'handoff') return `<div class="m sys" data-mid="${mid}">${icon('handoff')}<span>${esc(m.text)}</span></div>`;
  if (m.from === 'me') return `<div class="m me ${m.via === 'voice' ? 'said' : ''}" data-mid="${mid}">${m.via === 'voice' ? `<span class="said-ic" data-tip="You said this out loud">${icon('mic')}</span>` : ''}<p>${esc(m.text)}</p></div>`;
  const head = sameRun ? '<span class="gutter"></span>' : face(a, 26);
  const name = sameRun ? '' : `<b class="who">${esc(a.name)} <time>${m.at ? timeAgo(m.at) : ''}</time></b>`;
  let body = '';
  if (m.kind === 'steps') {
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    body = `<div class="card steps ${m.live ? 'is-live' : ''}">
      <div class="card-h">${icon('monitor')}<span>${esc(m.title)}</span><b>${m.done || 0}/${m.total || 0}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="st-list">${(m.steps || []).map((s, i, arr) => `<div class="st ${i === arr.length - 1 && m.live ? 'run' : 'done'}"><span class="ic">${i === arr.length - 1 && m.live ? '<i class="spin"></i>' : icon('check')}</span>${esc(s)}</div>`).join('') || '<div class="st run"><span class="ic"><i class="spin"></i></span>Starting…</div>'}</div>
    </div>`;
  } else if (m.kind === 'question') {
    body = `<div class="card q-card ${m.answered ? 'done' : ''}">
      <div class="card-h">${icon('edit')}<span>${m.answered ? 'Answered' : 'Needs an answer'}</span></div>
      <p class="ask-what">${esc(m.text)}</p>
      <p class="ask-detail">${m.answered ? `You said “${esc(m.answered)}”` : 'Reply below, or right from the dock.'}</p>
    </div>`;
  } else if (m.kind === 'approval') {
    const done = m.state !== 'pending';
    body = `<div class="card ask-card ${m.state}">
      <div class="card-h">${icon('shield')}<span>Needs your OK</span>${done ? `<b class="pill ${m.state}">${m.state === 'approved' ? 'Approved' : 'Declined'}</b>` : ''}</div>
      <p class="ask-what">${esc(m.action)}</p><p class="ask-detail">${esc(m.detail || '')}</p>
      ${m.preview?.length ? `<div class="ask-prev">${m.preview.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
      ${done ? '' : `<div class="ask-btns"><button class="btn btn-quiet btn-sm" data-ap="declined" data-tip="${esc(a.name)} won’t do it">Decline</button><button class="btn btn-primary btn-sm" data-ap="approved" data-tip="Let ${esc(a.name)} do it">Approve</button></div>`}
    </div>`;
  } else {
    body = `<p>${esc(m.text)}<button class="say" data-say data-tip="Read aloud" aria-label="Read aloud"><span class="say-bars"><i></i><i></i><i></i></span>${icon('speaker')}</button></p>` + (m.choices ? `<div class="choices">${m.choices.map((c) => `<button class="chip" data-choice="${esc(c)}" ${m.chosen ? 'disabled' : ''} ${m.chosen === c ? 'aria-pressed="true"' : ''}>${esc(c)}</button>`).join('')}</div>` : '');
  }
  return `<div class="m ag ${sameRun ? 'cont' : ''}" data-mid="${mid}">${head}<div class="m-body">${name}${body}</div></div>`;
}

function rename(a, main) {
  const s = sheet(`<form class="mini-form"><h3>Rename ${esc(a.name)}</h3><input class="field" name="n" value="${esc(a.name)}" maxlength="24" aria-label="Name"><div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Save</button></div></form>`, { cls: 'small' });
  const f = $('form', s.el), inp = $('input', s.el); inp.select();
  $('[data-x]', s.el).onclick = s.close;
  f.onsubmit = (e) => { e.preventDefault(); const n = inp.value.trim(); if (!n) return; updateAgent(a.id, { name: n }); react(a.id, 'yes'); s.close(); chat(main); };
}
function duplicate(a) {
  const copy = { ...structuredClone(a), id: id('agent'), name: a.name + ' 2', status: 'idle', statusText: 'Ready', unread: 0 };
  state.agents.push(copy); state.threads[copy.id] = []; save(); emit('agents');
  toast(`Made a copy: ${copy.name}`); go('chat', { agent: copy.id });
}
function remove(a) {
  const s = sheet(`<div class="mini-form"><h3>Delete ${esc(a.name)}?</h3><p class="muted">${esc(a.name)} and its conversation are removed from this computer. Its routines stop.</p><div class="row-end"><button class="btn btn-quiet btn-sm" data-x>Keep ${esc(a.name)}</button><button class="btn btn-danger btn-sm" data-del>Delete</button></div></div>`, { cls: 'small' });
  react(a.id, 'worried');
  $('[data-x]', s.el).onclick = () => { s.close(); react(a.id, 'relieved'); };
  $('[data-del]', s.el).onclick = () => {
    state.agents = state.agents.filter((x) => x.id !== a.id); delete state.threads[a.id];
    state.routines = state.routines.filter((r) => r.agent !== a.id);
    save(); emit('agents'); s.close(); toast(`${a.name} was deleted`, { icon: 'trash' });
    go('chat', { agent: state.agents[0]?.id });
  };
}
