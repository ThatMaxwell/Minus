// The stand-up, on stage: your agents in a row, each stepping into the light to say what it
// did, what's on today and what it needs. Answer right there, or let it play through.
import { state, agent, on, go, save, post } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, motion, IN, toast } from '../ui.js';
import { react } from '../director.js';
import { resolve, choose, respond } from '../brain.js';
import { hasKey, speak, stopSpeaking } from '../voice.js';
import * as su from '../standup.js';

const DATE = () => new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

export function standup(main) {
  const { speaking, away } = su.round();
  let i = 0, playing = false, timer = 0;
  const voice = () => hasKey() && state.settings.standupVoice !== false;
  if (!speaking.length) {
    main.innerHTML = `<section class="su"><div class="empty"><p>No one to hear from yet. Make an agent and give it a job.</p></div></section>`;
    return;
  }
  main.innerHTML = `<section class="su">
    <header class="su-h"><div><h1>${icon('sunrise')}Morning stand-up</h1><p>${esc(DATE())} · ${speaking.length} agent${speaking.length === 1 ? '' : 's'}${away.length ? ` · ${away.map((b) => esc(b.agent.name)).join(', ')} ${away.length === 1 ? 'is' : 'are'} away` : ''}</p></div>
      <div class="su-tools">
        <button class="icon-btn ${voice() ? 'on' : ''}" data-su="voice" data-tip="${hasKey() ? 'Hear them say it' : 'Add a Groq key in Settings to hear them'}">${icon('speaker')}</button>
        <button class="btn btn-quiet btn-sm" data-su="play">${icon('play')}<span>Play through</span></button>
      </div></header>
    <div class="su-stage" aria-hidden="true"><div class="su-spot"></div><div class="su-row">${speaking.map((b, k) => `<button class="su-a" data-k="${k}" tabindex="-1">${face(b.agent, 96)}<b>${esc(b.agent.name)}</b>${b.needs.length ? '<i class="su-flag"></i>' : ''}</button>`).join('')}<button class="su-a su-end" data-k="${speaking.length}" tabindex="-1"><span class="su-end-ic">${icon('check')}</span><b>Wrap up</b></button></div><div class="su-floor"></div></div>
    <article class="su-card" aria-live="polite"></article>
    <footer class="su-f"><div class="su-dots">${[...speaking, null].map((_, k) => `<i data-k="${k}"></i>`).join('')}</div>
      <div class="su-nav"><button class="btn btn-quiet btn-sm" data-su="back">${icon('back')}<span>Back</span></button><button class="btn btn-primary btn-sm" data-su="next"><span>Next</span>${icon('chevron')}</button></div></footer>
  </section>`;
  mountMascots(main, agent);
  const root = $('.su', main), row = $('.su-row', main), card = $('.su-card', main), M = motion();

  const place = (instant) => {
    const el = row.children[i], stage = $('.su-stage', main);
    const x = stage.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2);
    M.animate(row, { x }, instant ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 24 });
    $$('.su-a', row).forEach((b, k) => b.classList.toggle('on', k === i));
    $$('.su-dots i', main).forEach((d, k) => d.classList.toggle('on', k === i));
    $('[data-su="back"]', main).disabled = i === 0;
    $('[data-su="next"] span', main).textContent = i === speaking.length ? 'Start the day' : i === speaking.length - 1 ? 'Wrap up' : 'Next';
  };

  const cardHTML = (b) => {
    const a = b.agent, li = (xs, none) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="su-none">${none}</p>`);
    const need = (n) => {
      if (n.kind === 'approval') return `<div class="su-need" data-mid="${esc(n.mid)}"><b>${esc(n.title)}</b>${n.detail ? `<span>${esc(n.detail)}</span>` : ''}<div class="su-btns"><button class="btn btn-quiet btn-sm" data-ap="declined">Decline</button><button class="btn btn-primary btn-sm" data-ap="approved">Approve</button></div></div>`;
      if (n.kind === 'question') return `<form class="su-need su-q" data-mid="${esc(n.mid)}"><b>${esc(n.title)}</b><div class="su-in"><input placeholder="Your answer" aria-label="Your answer" autocomplete="off"><button class="icon-btn sm" aria-label="Send">${icon('send')}</button></div></form>`;
      if (n.kind === 'choice') return `<div class="su-need" data-mid="${esc(n.mid)}"><b>${esc(n.title)}</b><div class="su-btns">${n.choices.map((c) => `<button class="chip sm" data-choice="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>`;
      return `<div class="su-need"><b>${esc(n.title)}</b><div class="su-btns"><button class="btn btn-quiet btn-sm" data-open="${esc(a.id)}">Open chat</button></div></div>`;
    };
    return `<div class="su-who"><b>${esc(a.name)}</b><span>${esc(a.role || 'Agent')}</span><button class="su-chat" data-open="${esc(a.id)}" data-tip="Open ${esc(a.name)}’s chat">${icon('arrow')}</button></div>
      <p class="su-say">${b.speech.split(' ').map((w, k) => `<span style="--d:${k}">${esc(w)} </span>`).join('')}</p>
      <div class="su-cols">
        <section><h4>${icon('check')}Yesterday</h4>${li(b.did, 'Nothing new')}</section>
        <section><h4>${icon('clock')}Today</h4>${li(b.today, 'Free for a job')}</section>
        <section class="${b.needs.length ? 'needs' : ''}"><h4>${icon('bell')}Needs you</h4>${b.needs.length ? b.needs.map(need).join('') : '<p class="su-none">Nothing</p>'}</section>
      </div>`;
  };
  const endHTML = () => {
    const needs = speaking.reduce((n, b) => n + b.needs.length, 0), busy = speaking.filter((b) => b.agent.status === 'working' || b.today.length).length;
    return `<div class="su-end-card"><h2>That’s everyone.</h2>
      <p>${needs ? `<b>${needs} thing${needs === 1 ? '' : 's'}</b> need${needs === 1 ? 's' : ''} you` : 'Nothing needs you'} · <b>${busy}</b> agent${busy === 1 ? '' : 's'} busy today · <b>${speaking.length - busy}</b> free for a job</p>
      <div class="su-free">${speaking.filter((b) => !(b.agent.status === 'working' || b.today.length)).map((b) => `<button class="chip" data-open="${esc(b.agent.id)}">${face(b.agent, 20)}<span>Give ${esc(b.agent.name)} a job</span></button>`).join('')}</div></div>`;
  };

  const show = (k, instant = false) => {
    if (!root.isConnected) { playing = false; return; }
    stopSpeaking();
    i = Math.max(0, Math.min(speaking.length, k));
    place(instant);
    const b = speaking[i];
    card.innerHTML = b ? cardHTML(b) : endHTML();
    mountMascots(card, agent);
    M.animate(card, { opacity: [0, 1], y: [10, 0] }, { duration: 0.35, ease: IN });
    // the one speaking steps up; everyone else turns to look
    speaking.forEach((x, k) => mascotsOf(x.agent.id).forEach((m) => {
      if (!row.contains(m.canvas)) return;
      if (k === i) { m.setEmotion(x.needs.length ? 'curious' : x.agent.status === 'working' ? 'focused' : 'happy'); m.hop(); m.look(0, 0.15, { noBlink: true }); }
      else { m.setEmotion('listening'); const t = row.children[i]; if (t) m.lookAtEl(t, 3); }
    }));
    if (!b) speaking.forEach((x) => mascotsOf(x.agent.id).forEach((m) => { if (row.contains(m.canvas)) { m.setEmotion('happy'); setTimeout(() => m.gesture('celebrate'), Math.random() * 500); } }));
    if (b && voice()) speak(b.agent.id, b.speech, { mascots: mascotsOf(b.agent.id).filter((m) => row.contains(m.canvas)) }).catch((e) => toast(e.human || 'Voice didn’t work this time.', { icon: 'speaker' }));
    if (playing) { clearTimeout(timer); if (!b) playing = false; else if (!voice()) timer = setTimeout(() => playing && show(i + 1), 2600 + b.speech.split(' ').length * 260); }
    syncPlay();
  };
  const syncPlay = () => { const p = $('[data-su="play"]', main); if (p) p.innerHTML = playing ? `${icon('pause')}<span>Pause</span>` : `${icon('play')}<span>Play through</span>`; };
  // with voices on, play-through moves on when each one finishes talking
  const offSpeak = on('speaking', ({ agent: aid, on: isOn }) => {
    if (!root.isConnected) return offSpeak();
    if (playing && !isOn && speaking[i]?.agent.id === aid) { clearTimeout(timer); timer = setTimeout(() => playing && show(i + 1), 900); }
  });

  const finish = () => { su.done(); const first = speaking.find((b) => b.needs.length); go('chat', { agent: (first || speaking[0]).agent.id }); };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-su]');
    if (b) {
      const k = b.dataset.su;
      if (k === 'next') return i === speaking.length ? finish() : show(i + 1);
      if (k === 'back') return show(i - 1);
      if (k === 'play') { playing = !playing; clearTimeout(timer); if (playing) show(i === speaking.length ? 0 : i); else { stopSpeaking(); syncPlay(); } return; }
      if (k === 'voice') {
        if (!hasKey()) return toast('Add a Groq key in Settings → Voice to hear them.', { icon: 'speaker' });
        state.settings.standupVoice = !voice(); save(); b.classList.toggle('on', voice()); if (!voice()) stopSpeaking();
        return;
      }
    }
    const a = e.target.closest('.su-a'); if (a) return show(+a.dataset.k);
    const o = e.target.closest('[data-open]'); if (o) { su.done(); return go('chat', { agent: o.dataset.open }); }
    const ap = e.target.closest('[data-ap]');
    if (ap) { const n = ap.closest('[data-mid]'); resolve(speaking[i].agent.id, n.dataset.mid, ap.dataset.ap); return settle(n, ap.dataset.ap === 'approved' ? 'Approved' : 'Declined'); }
    const c = e.target.closest('[data-choice]');
    if (c) { const n = c.closest('[data-mid]'); choose(speaking[i].agent.id, n.dataset.mid, c.dataset.choice); return settle(n, `You said “${c.dataset.choice}”`); }
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, v = $('input', f).value.trim(); if (!v) return;
    const aid = speaking[i].agent.id;
    post(aid, { from: 'me', text: v, via: 'standup' }); respond(aid, v);
    settle(f, `You said “${v}”`);
  });
  const settle = (n, text) => {
    speaking[i].needs = speaking[i].needs.filter((x) => x.mid !== n.dataset.mid);
    n.innerHTML = `<span class="su-ok">${icon('check')}${esc(text)}</span>`;
    M.animate(n, { opacity: [0.4, 1] }, { duration: 0.3 });
    react(speaking[i].agent.id, /Declined/.test(text) ? 'rejected' : 'approved');
    if (!speaking[i].needs.length) row.children[i].querySelector('.su-flag')?.remove();
  };
  const keys = (e) => {
    if (!root.isConnected) return removeEventListener('keydown', keys);
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); i === speaking.length ? finish() : show(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
  };
  addEventListener('keydown', keys);
  requestAnimationFrame(() => show(0, true));
}
