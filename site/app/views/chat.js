// A conversation with one agent, its live computer, and the composer.
import { state, on, agent, computer, updateAgent, go, emit, save, providerState, post, id, APP, patchMessage } from '../store.js';
import { $, $$, esc, md, icon, face, mountMascots, mascotsOf, menu, sheet, toast, motion, IN, mod, timeAgo } from '../ui.js';
import { react } from '../director.js';
import { respond, choose, resolve } from '../brain.js';
import { provider, PROVIDERS, STATUS } from '../data.js';
import { ComputerSim } from '../../js/computer.js';
import { openCreate } from './create.js';
import { Listener, transcribe, hasKey, heardYou, speak, stopSpeaking, speaking, VoiceError } from '../voice.js';
import { keySheet, connect } from './pages.js';
import * as rt from '../runtime.js';
import { musingHTML } from '../musing.js';
import { pickModel, prettyModel } from './modelpick.js';

// While it's thinking (not on a named step), the agent's status is a word that keeps changing.
const GENERIC = /^(Thinking…|Starting|Writing…|Working)$/;
const musing = (x) => x.status === 'working' && (!x.statusText || GENERIC.test(x.statusText));
const statusHTML = (x) => (musing(x) ? musingHTML(x) : `<span>${esc(x.statusText || STATUS[x.status]?.label || '')}</span>`);
import * as nb from '../notebook.js';
import * as teach from '../teach.js';
import { land } from '../drop.js';

let off = [];
// stop listening to the store when another page takes over (the router calls this)
export const leaveChat = () => { off.forEach((f) => f()); off = []; };
export function chat(main) {
  leaveChat();
  const a = agent(state.route.agent);
  if (!a) {
    main.innerHTML = `<section class="first"><canvas class="first-mx" aria-hidden="true"></canvas><h1>Make your first agent</h1>
      <p>Give it a name, a job and a computer. It works while you do other things, and asks before anything it can’t undo.</p>
      <button class="btn btn-primary" data-first>${icon('plus')}<span>New agent</span></button></section>`;
    import('../../js/mascot3d.js').then(({ Mascot3D }) => { const c = main.querySelector('.first-mx'); if (c) { const m = new Mascot3D(c, { shared: true, idle: true, follow: true, emotion: 'happy' }); m.hop(); } });
    main.querySelector('[data-first]').onclick = () => openCreate();
    return;
  }
  const comp = computer(a.computer), prov = provider(a.model);
  main.innerHTML = `
    <section class="chat ${state.panel ? 'with-panel' : ''}">
      <header class="ch-h ${a.status === 'working' ? 'working' : ''}" style="--ac:${esc(a.color || '#f3f2ee')}">
        <button class="icon-btn ch-back" data-act="back" aria-label="Back to your agents">${icon('back')}</button>
        <div class="ch-who">
          <span class="ch-face">${face(a, 56, 'data-idle="1"')}</span>
          <div class="ch-id">
            <div class="ch-name"><b>${esc(a.name)}</b>${a.role ? `<span class="ch-role">${esc(a.role)}</span>` : ''}</div>
            <span class="ch-status"><i class="dot ${STATUS[a.status]?.tone}"></i><span class="ch-st">${statusHTML(a)}</span></span>
          </div>
        </div>
        <div class="ch-brain">
          <button class="ch-seg" data-act="model" data-tip="Which AI ${esc(a.name)} thinks with">${prov.icon}<span>${esc(prov.name)}</span>${rt.modelOf(a) ? `<small>${esc(prettyModel(rt.modelOf(a)))}</small>` : ''}${icon('chevron', 'rot')}</button>
          <i class="ch-div"></i>
          <button class="ch-seg" data-act="computer" data-tip="Which computer ${esc(a.name)} works on">${icon(comp?.kind === 'local' ? 'laptop' : 'cloud')}<span>${esc(comp?.name || 'No computer')}</span>${icon('chevron', 'rot')}</button>
        </div>
        <div class="ch-tools">
          <button class="icon-btn" data-act="rewind" data-tip="Rewind: go back to an earlier moment and continue from there">${icon('rewind')}</button>
          <button class="icon-btn" data-act="teach" data-tip="Show me once: do a job while ${esc(a.name)} watches, and it learns how">${icon('showme')}</button>
          <button class="icon-btn nb-btn" data-act="notebook" data-tip="${esc(a.name)}’s notebook: what it has learned">${icon('book')}<span class="nb-count" ${nb.count(a) ? '' : 'hidden'}>${nb.count(a)}</span></button>
          <button class="icon-btn" data-act="look" data-tip="Change how ${esc(a.name)} looks">${icon('sparkle')}</button>
          <span class="sep"></span>
          <button class="icon-btn web-btn ${rt.isBrowsing(a.id) ? 'live' : ''}" data-act="browser" data-tip="Watch ${esc(a.name)}’s browser, live">${icon('globe')}</button>
          <button class="icon-btn" data-act="pause" data-tip="${a.status === 'paused' ? 'Resume' : 'Pause'} ${esc(a.name)}">${icon(a.status === 'paused' ? 'play' : 'pause')}</button>
          <button class="icon-btn ${state.panel ? 'on' : ''}" data-act="panel" data-tip="${state.panel ? 'Hide' : 'Show'} the computer|mod .">${icon('panel')}</button>
          <button class="icon-btn" data-act="more" data-tip="More">${icon('more')}</button>
        </div>
        <i class="ch-work" aria-hidden="true"></i>
      </header>
      <div class="ch-body">
        <div class="thread-col">
          <div class="thread" role="log" aria-live="polite"></div>
          <form class="composer" autocomplete="off">
            <div class="cmp-box">
              <div class="cmp-files" hidden></div>
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
        <aside class="pc-panel view-${state.panelView === 'browser' ? 'browser' : 'screen'}" aria-label="${esc(a.name)}’s computer">
          <div class="pcp-h"><span class="live ${a.status === 'working' ? 'on' : ''}"><i></i>${a.status === 'working' ? 'Live' : 'Idle'}</span>
            <span class="pcp-seg" role="tablist"><button role="tab" data-view="screen">${icon('laptop')}<span>Screen</span></button><button role="tab" data-view="browser">${icon('globe')}<span>Browser</span></button></span><span class="grow"></span>
            <button class="btn btn-quiet btn-xs" data-act="takeover" data-tip="Use the mouse and keyboard yourself">${icon('hand')}<span>Take over</span></button></div>
          <div class="pcp-screen"><div class="pcp-sim"></div>
            <div class="pcp-web"><div class="pcp-addr">${icon('lock')}<span class="pcp-url">No page open</span></div><div class="pcp-page"><img alt="${esc(a.name)}’s browser, live" hidden><p class="pcp-msg">When ${esc(a.name)} uses the web, its browser shows up here, live. It’s private: separate from yours.</p></div></div><div class="pcp-yours" hidden><div>${icon('hand')}<b>You’re driving</b><span>${esc(a.name)} is watching and will pick up where you leave off.</span><button class="btn btn-primary btn-sm" data-act="giveback">Give back to ${esc(a.name)}</button></div></div></div>
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
    thread.innerHTML = msgs.map((m) => { const h = msgHTML(a, m, prev); prev = m; return h; }).join('') + `<div class="typing" ${a.status === 'working' && a.statusText === 'Thinking…' ? '' : 'hidden'}><span class="face-dots">${face(a, 22)}</span>${musingHTML(a, 'mz-typing')}</div>`;
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
    // a reply being written: just the words change (no re-render, five times a second)
    const p = msg.live && msg.from === 'agent' && !msg.kind ? node.querySelector('.md') : null;
    if (p) {
      p.innerHTML = md(msg.text); node.classList.add('streaming');
      if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
      return;
    }
    const tmp = document.createElement('div'); tmp.innerHTML = msgHTML(a, msg, null, node.classList.contains('cont'));
    const fresh = tmp.firstElementChild; node.replaceWith(fresh); mountMascots(fresh, agent);
  }));
  off.push(on('typing', ({ agent: aid, on: t }) => { if (aid === a.id) { $('.typing', thread).hidden = !t; if (t) thread.scrollTop = thread.scrollHeight; } }));
  off.push(on('agent', (x) => {
    if (x.id !== a.id) return;
    const st = $('.ch-st', main), next = musing(x) ? 'musing' : x.statusText || STATUS[x.status]?.label || '';
    if (st.dataset.was !== next) { st.dataset.was = next; st.innerHTML = statusHTML(x); }
    $('.ch-status .dot', main).className = 'dot ' + (STATUS[x.status]?.tone || 'dim');
    $('.ch-h', main).classList.toggle('working', x.status === 'working');
    const live = $('.pcp-h .live', main); live.classList.toggle('on', x.status === 'working'); live.lastChild.textContent = x.status === 'working' ? 'Live' : 'Idle';
  }));

  thread.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ap]');
    if (b) { const card = b.closest('[data-mid]'); return resolve(a.id, card.dataset.mid, b.dataset.ap); }
    const c = e.target.closest('[data-choice]');
    if (c) { const card = c.closest('[data-mid]'); return choose(a.id, card.dataset.mid, c.dataset.choice); }
    const link = e.target.closest('.md a[href]');
    if (link) { e.preventDefault(); const u = link.href; return window.__TAURI__?.opener ? window.__TAURI__.opener.openUrl(u) : window.open(u, '_blank', 'noopener'); }
    const cn = e.target.closest('[data-connect]');
    if (cn) return connect(cn.dataset.connect, () => {});
    const hr = e.target.closest('[data-here]');
    if (hr) {
      // your PC is off: the phone answers it instead (and tells the PC not to, later)
      const mid = hr.closest('[data-mid]').dataset.mid, m = (state.threads[a.id] || []).find((x) => x.mid === mid);
      if (!m || m.here) return;
      patchMessage(a.id, mid, { here: true });
      const you = m.about ? (state.threads[a.id] || []).find((x) => x.mid === m.about) : null;
      if (you) patchMessage(a.id, you.mid, { answeredOn: 'phone' });
      return respond(a.id, m.text, { here: true });
    }
    const r = e.target.closest('[data-run-skill]');
    if (r) return teach.run(a.id, r.dataset.runSkill);
    if (e.target.closest('[data-open-skills]')) return nb.open(main, a.id, 'skills');
  });
  thread.addEventListener('pointerover', (e) => { const b = e.target.closest('[data-ap="approved"]'); if (b) react(a.id, 'look', b); });

  /* ───────── composer: the agent listens, nods along, and nods when you send ───────── */
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; send.disabled = !ta.value.trim() && !files.length; };
  // files dropped on this agent wait here until you send
  let files = [];
  const chips = () => {
    const box = $('.cmp-files', main);
    box.hidden = !files.length;
    box.innerHTML = files.map((f, i) => `<span class="fchip" data-tip="${esc(f.path || f.name)}">${icon('file')}<span>${esc(f.name)}</span><button type="button" data-unfile="${i}" aria-label="Remove ${esc(f.name)}">${icon('x')}</button></span>`).join('');
    grow();
  };
  off.push(on('attach', ({ agent: aid, files: fs, text }) => {
    if (aid !== a.id) return;
    const before = files.length;
    files = files.concat(fs);
    if (text) ta.value = (ta.value ? ta.value + '\n' : '') + text;
    chips();
    $$('.cmp-files .fchip', main).slice(before).forEach(land);
    ta.focus();
    if (fs.length) ta.placeholder = `What should ${a.name} do with ${fs.length === 1 ? 'it' : 'them'}?`;
  }));
  main.addEventListener('click', (e) => { const x = e.target.closest('[data-unfile]'); if (x) { files.splice(+x.dataset.unfile, 1); chips(); } });
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
    const fs = files; files = []; chips(); ta.placeholder = `Message ${a.name}…`;
    if (!text && fs.length) text = fs.length === 1 ? 'Here’s a file for you.' : `Here are ${fs.length} files for you.`;
    ta.value = ''; grow(); lastLen = 0;
    if (via === 'voice') heardYou(a.id);
    post(a.id, { from: 'me', text, ...(via ? { via } : {}), ...(fs.length ? { files: fs } : {}) });
    react(a.id, 'send');
    // the agent gets where the files are, so it can open them on its computer
    respond(a.id, fs.length ? `${text}\n\nFiles you were given:\n${fs.map((f) => `- ${f.path || f.name}`).join('\n')}` : text);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ta.value.trim(); if (text || files.length) sendText(text);
  });
  // on the phone the keyboard waits until you tap the box
  if (!document.documentElement.classList.contains('phone')) setTimeout(() => ta.focus({ preventScroll: true }), 50);

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
    if (m) speak(a.id, m.voice || m.text, { mid }).catch((err) => toast(err.human || 'Voice didn’t work this time.', { icon: 'speaker' }));
  });
  // when it learns something, a note flies into its notebook
  off.push(on('remember', ({ agent: aid, note }) => {
    if (aid !== a.id) return;
    $('.nb-btn', main)?.classList.add('fresh');
    nb.fly(main, a.id, note.text);
    const c = $('.nb-count', main); if (c) { c.hidden = false; c.textContent = nb.count(agent(a.id)); }
    if (note.by !== 'you') react(a.id, 'proud');
  }));
  off.push(on('speaking', ({ agent: aid, mid, on: isOn, loading }) => {
    if (aid !== a.id || !mid) return;
    const node = $(`[data-mid="${CSS.escape(mid)}"]`, thread); if (!node) return;
    node.classList.toggle('saying', !!isOn && !loading); node.classList.toggle('say-wait', !!isOn && !!loading);
    const sb = $('[data-say]', node); if (sb) sb.dataset.tip = isOn ? 'Stop' : 'Read aloud';
  }));

  /* ───────── the agent's computer: your real screen in the app, a pretend one in the preview ───────── */
  const logStep = (text) => {
    const rows = $('.pcp-rows', main); if (!rows) return; // left the chat mid-step
    const r = document.createElement('div');
    r.className = 'lg'; r.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span></span>`;
    r.querySelector('span').textContent = text; rows.prepend(r);
    while (rows.children.length > 40) rows.lastChild.remove();
  };
  let driving = false, syncSim = () => {};
  // the panel shows the computer's screen or the agent's own browser
  const panel = $('.pc-panel', main);
  let webTimer = 0, webGone = false;
  const webTick = async () => {
    clearTimeout(webTimer);
    if (webGone || !main.contains(panel) || !state.panel || state.panelView !== 'browser') return;
    const img = $('.pcp-page img', panel), msg = $('.pcp-page .pcp-msg', panel), url = $('.pcp-url', panel);
    if (!APP) { msg.textContent = 'In the Minus app, each agent has its own browser, and you can watch it here live.'; return; }
    if (!rt.canBrowse()) { msg.textContent = 'Agents get their own browser when Chrome, Edge or Brave is installed.'; return; }
    try {
      const f = document.visibilityState === 'visible' ? await rt.browserFrame(a.id) : null;
      if (f?.jpeg) { img.src = 'data:image/jpeg;base64,' + f.jpeg; img.hidden = false; msg.hidden = true; url.textContent = f.url.replace(/^https?:\/\/(www\.)?/, ''); url.title = f.title; }
    } catch { /* the browser is starting, or closed: try again shortly */ }
    webTimer = setTimeout(webTick, agent(a.id)?.status === 'working' ? 500 : 2000);
  };
  const setView = (v) => {
    state.panelView = v; save();
    panel.classList.toggle('view-browser', v === 'browser'); panel.classList.toggle('view-screen', v !== 'browser');
    $$('.pcp-seg [data-view]', panel).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $('[data-act="browser"]', main)?.classList.toggle('on', state.panel && v === 'browser');
    webTick();
  };
  panel.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  off.push(() => { webGone = true; clearTimeout(webTimer); });
  off.push(on('browse', ({ agent: aid }) => {
    if (aid !== a.id) return;
    $('[data-act="browser"]', main)?.classList.add('live');
    // it went on the web: show its browser, if you're watching its computer
    if (state.panel && state.panelView !== 'browser') setView('browser');
  }));
  setView(state.panelView === 'browser' ? 'browser' : 'screen');
  if (APP) {
    const box = $('.pcp-sim', main);
    box.innerHTML = `<div class="pcp-live"><img alt="${esc(a.name)}’s screen, live"><i class="pcp-mark" hidden></i></div><p class="pcp-msg" hidden></p>`;
    const img = $('.pcp-live img', box), mark = $('.pcp-mark', box), msg = $('.pcp-msg', box);
    let shot = null, timer = 0, gone = false;
    const tick = async () => {
      if (gone || !main.contains(box)) return;
      if (!rt.canUseComputer()) {
        // nothing to watch here: agents on this device think and write instead
        img.hidden = true; msg.hidden = false;
        msg.textContent = /Android/i.test(navigator.userAgent) ? 'Agents on your phone think and write; they don’t use a screen.' : 'Minus can see and use the screen on Windows for now. Mac and Linux are next. Agents here think and write in the meantime.';
        return;
      }
      if (state.panel && state.panelView !== 'browser' && document.visibilityState === 'visible') {
        try {
          shot = await window.__TAURI__.core.invoke('hands_screen', { maxEdge: 1100 });
          if (!shot?.png) throw new Error('no picture of the screen came back');
          img.src = 'data:image/png;base64,' + shot.png; img.hidden = false; msg.hidden = true;
        } catch (err) {
          img.hidden = true; msg.hidden = false;
          msg.textContent = /support|platform/i.test(String(err)) ? 'Minus can see and use the screen on Windows for now. Mac and Linux are next.' : `Can’t see the screen: ${err}`;
          return; // nothing to watch here
        }
      }
      timer = setTimeout(tick, agent(a.id)?.status === 'working' ? 600 : 2500);
    };
    tick();
    off.push(() => { gone = true; clearTimeout(timer); });
    off.push(on('step', ({ agent: aid, text }) => aid === a.id && logStep(text)));
    // where it's about to act, marked on the screen
    off.push(on('point', (p) => {
      if (p.agent !== a.id || !shot) return;
      const x = ((p.x + p.w / 2 - shot.origin_x) * shot.scale) / shot.width, y = ((p.y + p.h / 2 - shot.origin_y) * shot.scale) / shot.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      mark.hidden = false; mark.style.left = x * 100 + '%'; mark.style.top = y * 100 + '%'; mark.style.setProperty('--c', a.color);
      mark.classList.remove('go'); void mark.offsetWidth; mark.classList.add('go');
    }));
  } else {
    const sim = new ComputerSim($('.pcp-sim', main), { agent: a.name, color: a.color, speed: 1.15, url: comp?.kind === 'local' ? 'localhost:3000/login' : 'crm.acme.example/leads/new', onStep: ({ text }) => logStep(text) });
    syncSim = () => { const x = agent(a.id); if (x?.status === 'working' && state.panel && !driving) { if (sim.stopped) sim.run(); } else sim.stop(); };
    syncSim();
    off.push(on('agent', (x) => x.id === a.id && syncSim()), () => sim.stop());
  }

  /* ───────── header actions ───────── */
  main.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'model') {
      return pickModel(b, a, () => { react(a.id, 'yes'); chat(main); });
    }
    if (act === 'computer') return menu(b, state.computers.map((c) => ({ label: c.name, checked: c.id === a.computer, icon: c.kind === 'local' ? 'laptop' : 'cloud', run: () => { updateAgent(a.id, { computer: c.id }); toast(`${a.name} moved to ${c.name}`); react(a.id, c.kind === 'local' ? 'peek' : 'yes'); chat(main); } })));
    if (act === 'look') return openCreate({ edit: a.id, step: 0 });
    if (act === 'back') return go('home');
    if (act === 'teach') return teach.start(a.id);
    if (act === 'rewind') return rewind();
    if (act === 'pause') {
      if (teach.busy.has(a.id)) { teach.stop(a.id); toast(`${a.name} will stop after this step`, { icon: 'pause' }); return; }
      if (rt.running(a.id)) { rt.stop(a.id); toast(`${a.name} will stop after this step`, { icon: 'pause' }); return; }
      const paused = a.status === 'paused';
      updateAgent(a.id, paused ? { status: 'idle', statusText: 'Ready' } : { status: 'paused', statusText: 'Paused' });
      react(a.id, paused ? 'wake' : 'sleep'); toast(paused ? `${a.name} is back` : `${a.name} is paused`, { icon: paused ? 'play' : 'pause' });
      return chat(main);
    }
    if (act === 'panel') { state.panel = !state.panel; save(); return chat(main); }
    if (act === 'browser') {
      // the agent's own browser, live, in the panel (a second press puts it away)
      if (state.panel && state.panelView === 'browser') { state.panel = false; save(); return chat(main); }
      state.panelView = 'browser';
      if (!state.panel) { state.panel = true; save(); return chat(main); }
      save(); return setView('browser');
    }
    if (act === 'more') return menu(b, [
      { label: 'Rename', icon: 'edit', run: () => rename(a, main) },
      { label: 'Change look', icon: 'sparkle', run: () => openCreate({ edit: a.id, step: 0 }) },
      { label: 'Edit job and permissions', icon: 'shield', run: () => openCreate({ edit: a.id, step: 1 }) },
      { label: 'Duplicate', icon: 'copy', run: () => duplicate(a) },
      '-',
      { label: `Delete ${a.name}`, icon: 'trash', danger: true, run: () => remove(a) },
    ], { align: 'right' });
    if (act === 'takeover') {
      driving = true; syncSim(); if (APP && rt.running(a.id)) rt.stop(a.id); $('.pcp-yours', main).hidden = false; react(a.id, 'takeover');
      motion().animate($('.pcp-yours > div', main), { opacity: [0, 1], scale: [0.95, 1] }, { type: 'spring', stiffness: 380, damping: 28 });
    }
    if (act === 'giveback') { driving = false; $('.pcp-yours', main).hidden = true; react(a.id, 'giveback'); syncSim(); toast(`${a.name} has the computer again`, { icon: 'hand' }); }
    if (act === 'attach') toast('Drop files here, or paste a screenshot', { icon: 'paperclip' });
    if (act === 'mic') return talk();
    if (act === 'notebook') { b.classList.remove('fresh'); return nb.open(main, a.id); }
  };
  /* ───────── rewind: scrub back through the conversation and continue from an earlier moment ───────── */
  function rewind() {
    if ($('.rw', main)) return;
    const msgs = state.threads[a.id] || [];
    // you can continue from just before anything you said, or from now
    const stops = msgs.map((m, i) => (m.from === 'me' ? i : -1)).filter((i) => i >= 0).concat(msgs.length);
    if (stops.length < 2) return toast(`Nothing to rewind yet. Give ${a.name} a job first.`, { icon: 'rewind' });
    const nodes = () => $$('.thread > [data-mid]', main);
    const bar = document.createElement('div');
    bar.className = 'rw';
    const n = msgs.length;
    bar.innerHTML = `<div class="rw-top"><span class="rw-ic">${icon('rewind')}</span><div class="rw-t"><b>Rewind</b><span class="rw-when">Now</span></div>
        <button type="button" class="btn btn-quiet btn-sm" data-rw="cancel">Cancel</button><button type="button" class="btn btn-primary btn-sm" data-rw="go" disabled>Continue from here</button></div>
      <div class="rw-track"><div class="rw-line"></div><div class="rw-past"></div>${msgs.map((m, i) => m.kind === 'day' ? '' : `<i class="rw-tick ${m.from === 'me' ? 'you' : m.kind === 'steps' ? 'work' : m.kind === 'approval' ? 'ask' : ''}" style="left:${((i + 0.5) / n) * 100}%"></i>`).join('')}
        <button type="button" class="rw-head" role="slider" aria-label="Moment to go back to" aria-valuemin="0" aria-valuemax="${stops.length - 1}"></button></div>
      <p class="rw-note">${esc(a.name)} forgets everything after this moment. What it already did on its computer stays done.</p>`;
    $('.thread-col', main).prepend(bar);
    const M = motion();
    M.animate(bar, { opacity: [0, 1], y: [-10, 0] }, { duration: 0.3, ease: IN });
    const track = $('.rw-track', bar), head = $('.rw-head', bar), past = $('.rw-past', bar);
    let k = stops.length - 1;
    const xOf = (i) => (i / n) * 100;
    const show = (nk, glide = true) => {
      k = Math.max(0, Math.min(stops.length - 1, nk));
      const at = stops[k], x = xOf(at);
      M.animate(head, { left: x + '%' }, glide ? { type: 'spring', stiffness: 500, damping: 36 } : { duration: 0 });
      M.animate(past, { width: x + '%' }, glide ? { type: 'spring', stiffness: 500, damping: 36 } : { duration: 0 });
      head.setAttribute('aria-valuenow', k);
      nodes().forEach((el) => { const i = msgs.findIndex((m) => (m.mid || m.id) === el.dataset.mid); el.classList.toggle('future', i >= at); });
      const m = msgs[at];
      $('.rw-when', bar).textContent = m ? `Before you said “${m.text.length > 54 ? m.text.slice(0, 52) + '…' : m.text}”${m.at ? ' · ' + timeAgo(m.at) + ' ago' : ''}` : 'Now';
      $('[data-rw="go"]', bar).disabled = at === n;
      const node = m && $(`[data-mid="${CSS.escape(m.mid || m.id || '')}"]`, thread);
      if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // its eyes go back in time with you
      mascotsOf(a.id).forEach((mm) => { if ($('.ch-h', main).contains(mm.canvas)) { mm.look(at === n ? 0 : -0.7, 0.1, { noBlink: true }); mm.pointerT = 1.5; } });
    };
    const fromX = (cx) => { const r = track.getBoundingClientRect(), p = Math.max(0, Math.min(1, (cx - r.left) / r.width)) * n; let best = 0; stops.forEach((s, i) => { if (Math.abs(s - p) < Math.abs(stops[best] - p)) best = i; }); return best; };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault(); show(fromX(e.clientX)); head.focus();
      const move = (m) => show(fromX(m.clientX), false);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); show(k); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    const close = () => { nodes().forEach((el) => el.classList.remove('future')); removeEventListener('keydown', keys, true); M.animate(bar, { opacity: 0, y: -8 }, { duration: 0.2 }).then(() => bar.remove()); react(a.id, 'calm'); };
    const go = () => {
      const at = stops[k]; if (at === n) return close();
      const m = msgs[at], jobs = msgs.slice(0, at).filter((x) => x.job).length;
      if (rt.running(a.id)) rt.stop(a.id);
      rt.rewind(a.id, jobs);
      state.threads[a.id] = msgs.slice(0, at);
      post(a.id, { from: 'system', kind: 'rewound', text: 'Rewound to here' });
      updateAgent(a.id, { status: 'idle', statusText: 'Ready' });
      removeEventListener('keydown', keys, true);
      chat(main);
      const t2 = $('.composer textarea', main); t2.value = m.text; t2.dispatchEvent(new Event('input')); t2.focus(); t2.select();
      toast(`${a.name} is back to just before you said that. Change it, or send it again.`, { icon: 'rewind' });
      mascotsOf(a.id).forEach((mm) => mm.gesture('spin'));
    };
    const keys = (e) => {
      if (!bar.isConnected) return removeEventListener('keydown', keys, true);
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(k - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(k + 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && document.activeElement === head) { e.preventDefault(); go(); }
    };
    addEventListener('keydown', keys, true);
    off.push(() => removeEventListener('keydown', keys, true));
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-rw]'); if (!b) return; b.dataset.rw === 'go' ? go() : close(); });
    show(stops.length - 2, true);
    react(a.id, 'look', bar);
  }

  // the agent glances at whatever header button you point at
}

export function msgHTML(a, m, prev, cont) {
  const mid = esc(m.mid || m.id || '');
  const sameRun = cont ?? (prev && prev.from === m.from && prev.kind !== 'day' && m.from === 'agent');
  if (m.kind === 'day') return `<div class="day" data-mid="${mid}"><span>${esc(m.text)}</span></div>`;
  if (m.kind === 'problem') return `<div class="m sys problem" data-mid="${mid}">${icon('x')}<span>${esc(m.text)}</span></div>`;
  if (m.kind === 'rewound') return `<div class="m sys rw-mark" data-mid="${mid}">${icon('rewind')}<span>Rewound to here</span></div>`;
  if (m.from === 'system' || m.kind === 'handoff') return `<div class="m sys" data-mid="${mid}">${icon('handoff')}<span>${esc(m.text)}</span></div>`;
  if (m.from === 'me') return `<div class="m me ${m.via === 'voice' ? 'said' : ''}" data-mid="${mid}">${m.via === 'voice' ? `<span class="said-ic" data-tip="You said this out loud">${icon('mic')}</span>` : ''}${m.files?.length ? `<div class="m-files">${m.files.map((f) => `<span class="fchip" data-tip="${esc(f.path || f.name)}">${icon('file')}<span>${esc(f.name)}</span></span>`).join('')}</div>` : ''}<p>${esc(m.text)}</p></div>`;
  const head = sameRun ? '<span class="gutter"></span>' : face(a, 26);
  const name = sameRun ? '' : `<b class="who">${esc(a.name)} <time>${m.at ? timeAgo(m.at) : ''}</time></b>`;
  let body = '';
  if (m.kind === 'pcoff' || (m.kind === 'needai' && m._remote)) {
    // on the phone: this agent works on your PC, which is off or can't answer right now
    const p = provider(m.provider);
    const head = m.kind === 'needai' ? `Your PC needs ${esc(p.name)}` : m.why === 'slow' ? 'Your PC hasn’t picked this up' : 'Your PC is off';
    const what = m.kind === 'needai' ? `${esc(a.name)} works on your PC, and ${esc(p.name)} isn’t connected there yet. Connect it on the PC in Settings → Your AI.`
      : m.why === 'none' ? `${esc(a.name)} works on your PC, and Minus hasn’t been opened there yet.`
      : m.why === 'slow' ? `${esc(a.name)} works on your PC, and it hasn’t answered yet. Minus may be closed there, or busy.`
      : `${esc(a.name)} works on your PC, and Minus isn’t open there right now. It’ll pick this up when your PC is back.`;
    body = `<div class="card need-ai pc-off"><div class="card-h">${icon('laptop')}<span>${head}</span></div>
      <p class="ask-what">${what}</p>
      <p class="ask-detail">Or answer from this phone now, with this phone’s AI. Same agent, it just can’t use the computer from here.</p>
      ${m.here ? `<p class="ask-done">${icon('check')}Answered from this phone.</p>` : m.text ? `<div class="ask-btns"><button class="btn btn-primary btn-sm" data-here>${icon('phone')}<span>Answer from this phone</span></button></div>` : ''}</div>`;
  } else if (m.kind === 'needai') {
    const p = provider(m.provider);
    body = `<div class="card need-ai"><div class="card-h">${icon('key')}<span>Needs an AI to think with</span></div>
      <p class="ask-what">${esc(a.name)} uses ${esc(p.name)}, and it isn’t connected yet.</p>
      <p class="ask-detail">Connect it once and every agent using ${esc(p.name)} works for real. Your key stays on this computer.</p>
      ${m.connected ? `<p class="ask-done">${icon('check')}${esc(p.name)} connected. ${esc(a.name)} is on it.</p>` : `<div class="ask-btns"><button class="btn btn-primary btn-sm" data-connect="${esc(m.provider)}">${p.icon}<span>Connect ${esc(p.name)}</span></button></div>`}</div>`;
  } else if (m.kind === 'skill') {
    const sk = (a.skills || []).find((s) => s.id === m.skill);
    body = `<div class="card skill-card">
      <div class="card-h">${icon('showme')}<span>Learned a new skill</span></div>
      <div class="sk-body"><p class="sk-name">${esc(m.name)}</p>
      <p class="sk-meta">${m.count} step${m.count === 1 ? '' : 's'}${m.inputs?.length ? ` <span aria-hidden="true">·</span> asks for ${m.inputs.map((i) => `<span class="sk-chip">${icon('bolt')}${esc(i.replace(/_/g, ' '))}</span>`).join('')}` : ''}</p></div>
      <div class="ask-btns"><button class="btn btn-quiet btn-sm" data-open-skills>See all skills</button>${sk ? `<button class="btn btn-primary btn-sm" data-run-skill="${esc(sk.id)}">${icon('play')}Run it</button>` : ''}</div>
    </div>`;
  } else if (m.kind === 'steps') {
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    const count = m.total ? `${m.done || 0}/${m.total}` : `${m.done || 0} step${m.done === 1 ? '' : 's'}`;
    const price = m.cost != null ? `<span class="st-cost" data-tip="What this job cost on your own API key so far">${m.cost < 0.01 ? '<$0.01' : '$' + m.cost.toFixed(2)}</span>` : '';
    body = `<div class="card steps ${m.live ? 'is-live' : ''}">
      <div class="card-h">${icon('monitor')}<span>${esc(m.title)}</span>${m.live ? musingHTML(a, 'mz-card') : ''}${price}<b>${count}</b></div>
      <div class="bar ${m.total ? '' : 'flow'}"><i style="width:${m.total ? pct : 100}%"></i></div>
      ${m.note && m.live ? `<p class="st-note">${esc(m.note)}</p>` : ''}
      <div class="st-list">${(m.steps || []).map((s, i, arr) => `<div class="st ${i === arr.length - 1 && m.live ? 'run' : 'done'}"><span class="ic">${i === arr.length - 1 && m.live ? '<i class="spin"></i>' : icon('check')}</span>${esc(s)}</div>`).join('') || (m.live ? '<div class="st run"><span class="ic"><i class="spin"></i></span>Starting…</div>' : '')}</div>
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
    body = `<div class="md">${md(m.text)}</div><button class="say" data-say data-tip="Read aloud" aria-label="Read aloud"><span class="say-bars"><i></i><i></i><i></i></span>${icon('speaker')}</button>` + (m.choices ? `<div class="choices">${m.choices.map((c) => `<button class="chip" data-choice="${esc(c)}" ${m.chosen ? 'disabled' : ''} ${m.chosen === c ? 'aria-pressed="true"' : ''}>${esc(c)}</button>`).join('')}</div>` : '');
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
