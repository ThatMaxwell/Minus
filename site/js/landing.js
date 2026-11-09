// Landing page: hero heading, product shot, agent gallery, live demos, quiet reveals.
import { avatarSVG, COLORS } from './shape.js';
import { createApp } from './app.js';
import { ComputerSim } from './computer.js';
import { Mascot3D } from './mascot3d.js';
import { setupHero } from './hero.js';

const { animate, inView, scroll, stagger } = window.Motion;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const IN = [0.22, 1, 0.36, 1];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let hero;

export function initLanding({ hideHero }) {
  $$('[data-avatar]').forEach((el) => {
    el.innerHTML = avatarSVG(COLORS[el.dataset.avatar] || el.dataset.avatar, { box: el.dataset.box ? +el.dataset.box : 104 });
  });
  $$('[data-alive]').forEach((el) => (el.innerHTML = avatarSVG(COLORS[el.dataset.alive], { alive: true })));
  hero = setupHero();
  if (hideHero) $$('.h-rv').forEach((el) => (el.style.opacity = 0));
  $$('.rv').forEach((el) => (el.style.opacity = 0));

  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const copy = $('.clone button');
  copy?.addEventListener('click', async () => {
    const code = $('.clone code');
    try { await navigator.clipboard.writeText(code.textContent); copy.textContent = 'Copied'; }
    catch { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); copy.textContent = 'Selected'; }
    setTimeout(() => (copy.textContent = 'Copy'), 1600);
  });
  buildModels();
}

export function revealHero() {
  const h = $('.hero');
  animate($$('.h-rv[data-o="0"]', h), { opacity: [0, 1], y: [10, 0] }, { duration: 0.8, ease: IN });
  hero.play().catch((e) => { console.error(e); hero.finalState(); });
  animate($$('.h-rv[data-o="1"]', h), { opacity: [0, 1], y: [14, 0], filter: ['blur(6px)', 'blur(0px)'] }, { duration: 0.9, delay: stagger(0.08, { startDelay: 0.9 }), ease: IN });
  animate($('.hero-win'), { opacity: [0, 1], y: [80, 0] }, { opacity: { duration: 0.8, delay: 1.1 }, y: { type: 'spring', stiffness: 60, damping: 18, delay: 1.1 } });
}
export function heroFinal() { hero.finalState(); }

export function startLive() {
  const tilt = $('.hero-tilt');
  scroll(animate(tilt, { rotateX: [14, 0], scale: [0.94, 1] }, { ease: 'linear' }), { target: tilt, offset: ['start end', 'start 0.25'] });
  const app = createApp($('.hero-win'));
  inView('.hero-win', () => { app.start(); return () => app.stop(); }, { amount: 0.2 });

  inView('.rv', (el) => {
    const kids = el.dataset.stagger ? $$(el.dataset.stagger, el) : null;
    animate(el, { opacity: [0, 1], y: [18, 0] }, { duration: 0.9, ease: IN });
    if (kids) animate(kids, { opacity: [0, 1], y: [14, 0], filter: ['blur(4px)', 'blur(0px)'] }, { duration: 0.8, delay: stagger(0.08, { startDelay: 0.15 }), ease: IN });
  }, { amount: 0.2 });

  gallery();
  computerUse();
  jobs();
  teams();
  routines();
  approvals();
  const c = $('.cta canvas');
  if (c) new Mascot3D(c, { shared: true, color: COLORS.cloud, follow: true });
}

/* ───────── Agent gallery: real 3D agents with faces and hats ───────── */
const GALLERY = [
  { name: 'Scout', job: 'Research and leads', color: COLORS.mint, emotion: 'happy', cosmetic: 'cap', status: 'Adding 36 leads', state: 'work' },
  { name: 'Inbox', job: 'Email', color: COLORS.violet, emotion: 'wink', cosmetic: 'headphones', status: '5 drafts for you to check', state: 'wait' },
  { name: 'Ledger', job: 'Finance', color: COLORS.amber, emotion: 'suspicious', cosmetic: 'crown', status: 'Checking 214 receipts', state: 'work' },
  { name: 'Patch', job: 'Engineering', color: COLORS.sky, emotion: 'excited', cosmetic: 'antenna', status: 'Reproduced the login bug', state: 'done' },
  { name: 'Atlas', job: 'Operations', color: COLORS.coral, emotion: 'sleepy', cosmetic: 'beanie', status: 'Off until Monday', state: 'idle' },
  { name: 'Rosie', job: 'Support', color: COLORS.rose, emotion: 'happy', cosmetic: 'cat ears', status: 'Answered 18 tickets', state: 'work' },
];
function gallery() {
  const grid = $('.ag-grid');
  grid.innerHTML = GALLERY.map((a) => `
    <article class="ag-card" style="--c:${a.color}">
      <div class="ag-stage"><canvas aria-hidden="true"></canvas></div>
      <div class="ag-meta"><b>${a.name}</b><span>${a.job}</span></div>
      <div class="ag-status" data-state="${a.state}"><i></i>${a.status}</div>
    </article>`).join('');
  $$('.ag-card', grid).forEach((card, i) => {
    const a = GALLERY[i];
    const m = new Mascot3D(card.querySelector('canvas'), { shared: true, follow: true, color: a.color, emotion: a.emotion, cosmetic: a.cosmetic, frame: 1.66 });
    card.addEventListener('pointerenter', () => { m.hop(); if (a.emotion === 'sleepy') m.setEmotion('surprised'); });
    card.addEventListener('pointerleave', () => m.setEmotion(a.emotion));
  });
}

/* ───────── Bento: provider tiles ───────── */
function buildModels() {
  const host = $('.models-art');
  if (!host) return;
  const items = $$('.works .wk').filter((w) => w.querySelector('svg')).slice(0, 8);
  host.innerHTML = items.map((w, i) => `<div class="mdl" style="--d:${(i * 0.35).toFixed(2)}s">${w.querySelector('svg').outerHTML}<span>${w.textContent.trim()}</span><i></i></div>`).join('');
}

/* ───────── Computer use: live screen + action log ───────── */
function computerUse() {
  const host = $('#cu-screen'), log = $('#cu-log');
  if (!host) return;
  let t0 = 0;
  const sim = new ComputerSim(host, {
    agent: 'Patch', color: COLORS.sky, speed: 1.25, url: 'crm.acme.example/leads/new',
    onStep: ({ text }) => {
      const row = document.createElement('div');
      const t = (performance.now() - t0) / 1000;
      row.className = 'lg';
      row.innerHTML = `<time>${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}</time><span></span>`;
      row.querySelector('span').textContent = text;
      log.prepend(row);
      while (log.children.length > 6) log.lastElementChild.remove();
      animate(row, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4, ease: IN });
    },
  });
  inView(host, () => { t0 = performance.now(); log.innerHTML = ''; sim.reset(); sim.run(); return () => sim.stop(); }, { amount: 0.3 });
}

/* ───────── Jobs: chips + a phone that plays each job ───────── */
const JOBS = [
  { chip: 'Sales outbound', agent: 'Scout', color: COLORS.mint, desc: 'Researches accounts, finds the right people and drafts outreach in your voice. Leaves a review list for you to approve.',
    msgs: [['ag', 'Found 52 accounts that match. 36 have a clear contact.'], ['card', 'Drafts ready', '36 emails · 12 LinkedIn notes'], ['me', 'Send the top 10. Hold the rest.'], ['ag', 'Top 10 sent. The rest stay queued.']] },
  { chip: 'Inbox zero', agent: 'Inbox', color: COLORS.violet, desc: 'Sorts, answers and archives. Anything that needs you gets a short summary and a draft reply.',
    msgs: [['ag', 'Inbox is at zero. 5 replies are drafted for you.'], ['card', 'Needs you', 'Contract from Northwind · Invoice question'], ['me', 'Send the invoice reply.'], ['ag', 'Sent. Northwind is pinned for tomorrow.']] },
  { chip: 'Bug reproduction', agent: 'Patch', color: COLORS.sky, desc: 'Takes a bug report, reproduces it on a clean computer, records the steps and opens an issue.',
    msgs: [['me', 'Login fails on Safari for some users.'], ['ag', 'Reproduced on Safari with a fresh profile. The cookie is set on the wrong domain.'], ['card', 'Issue opened', 'Steps, screen recording, suspected line'], ['ag', 'Want me to try a fix on a branch?']] },
  { chip: 'Expense reports', agent: 'Ledger', color: COLORS.amber, desc: 'Collects receipts from email and photos, matches them to card charges and files the report.',
    msgs: [['ag', 'Matched 214 receipts to card charges. 3 are missing.'], ['card', 'Missing receipts', 'Taxi · Oct 12 · Café Lumen · Oct 15 · Hosting'], ['me', 'Hosting is in the billing inbox.'], ['ag', 'Found it. Report filed.']] },
  { chip: 'Support', agent: 'Rosie', color: COLORS.rose, desc: 'Answers tickets with your docs and history. Hands anything unusual to a person, with context.',
    msgs: [['ag', '18 tickets answered this morning. 2 need you.'], ['card', 'Escalated', 'Refund over $500 · Third ticket from one customer'], ['me', 'I’ll take the refund.'], ['ag', 'Assigned to you with the full history.']] },
  { chip: 'Hiring', agent: 'Atlas', color: COLORS.coral, desc: 'Screens applications against your rubric, schedules interviews and keeps candidates posted.',
    msgs: [['ag', '41 applications screened. 6 are a strong match.'], ['card', 'Interviews booked', 'Tue 10:00 · Tue 14:30 · Wed 11:00'], ['me', 'Move Wednesday to Thursday.'], ['ag', 'Moved. Everyone has the new invite.']] },
];
function jobs() {
  const chips = $('.job-chips'), desc = $('.job-desc'), msgs = $('.ph-msgs');
  const av = $('.ph-av'), name = $('.ph-name'), job = $('.ph-job'), ph = $('.ph-ph');
  chips.innerHTML = JOBS.map((j, i) => `<button class="jc" role="tab" aria-selected="${i === 0}" style="--c:${j.color}"><span class="jc-av">${avatarSVG(j.color)}</span>${j.chip}</button>`).join('');
  let cur = -1, run = 0, manual = 0, visible = false;
  async function show(i) {
    cur = i; const j = JOBS[i], my = ++run;
    $$('.jc', chips).forEach((c, k) => c.setAttribute('aria-selected', k === i));
    desc.textContent = j.desc;
    animate(desc, { opacity: [0, 1], y: [6, 0] }, { duration: 0.4, ease: IN });
    av.innerHTML = avatarSVG(j.color, { alive: true }); name.textContent = j.agent; job.textContent = j.chip; ph.textContent = `Message ${j.agent}`;
    msgs.innerHTML = '';
    for (const [who, a, b] of j.msgs) {
      await wait(who === 'me' ? 900 : 650);
      if (my !== run) return;
      const m = document.createElement('div');
      m.className = 'pm ' + who;
      if (who === 'card') m.innerHTML = `<b>${a}</b><span>${b}</span>`;
      else m.textContent = a;
      msgs.appendChild(m);
      animate(m, { opacity: [0, 1], y: [10, 0], scale: [0.97, 1] }, { duration: 0.45, ease: IN });
    }
  }
  $$('.jc', chips).forEach((c, i) => c.addEventListener('click', () => { manual = performance.now(); show(i); }));
  inView('.phone', () => { visible = true; if (cur < 0) show(0); return () => (visible = false); }, { amount: 0.3 });
  setInterval(() => { if (visible && performance.now() - manual > 20000 && cur >= 0) show((cur + 1) % JOBS.length); }, 7000);
}

/* ───────── Teams: work moves from agent to agent ───────── */
function teams() {
  const wrap = $('.flow');
  if (!wrap) return;
  const nodes = $$('.fl-node', wrap), pulse = $('.fl-pulse', wrap), track = $('.fl-track i', wrap);
  let alive = false, looping = false;
  const center = (n) => {
    const w = wrap.getBoundingClientRect(), r = n.querySelector('.av').getBoundingClientRect();
    return [r.left + r.width / 2 - w.left, r.top + r.height / 2 - w.top];
  };
  const setState = (n, s) => { n.dataset.state = s; n.querySelector('.fl-s').textContent = { wait: 'Waiting', work: 'Working', done: 'Done' }[s]; };
  async function loop() {
    if (looping) return; looping = true;
    while (alive) {
      nodes.forEach((n) => setState(n, 'wait'));
      animate(track, { scaleX: 0 }, { duration: 0 });
      for (let i = 0; i < nodes.length && alive; i++) {
        const [x, y] = center(nodes[i]);
        if (i === 0) await animate(pulse, { x, y, opacity: [0, 1], scale: [0.4, 1] }, { duration: 0.4 });
        else {
          await Promise.all([
            animate(pulse, { x, y }, { duration: 0.9, ease: [0.65, 0, 0.35, 1] }),
            animate(track, { scaleX: i / (nodes.length - 1) }, { duration: 0.9, ease: [0.65, 0, 0.35, 1] }),
          ]);
          setState(nodes[i - 1], 'done');
        }
        setState(nodes[i], 'work');
        await wait(1100);
      }
      setState(nodes[nodes.length - 1], 'done');
      await animate(pulse, { opacity: 0, scale: 0.4 }, { duration: 0.4 });
      await wait(1600);
    }
    looping = false;
  }
  inView(wrap, () => { alive = true; loop(); return () => { alive = false; }; }, { amount: 0.4 });
}

/* ───────── Routines: a week with a moving "now" line ───────── */
const WEEK = [
  { d: 0, s: 0.1, e: 0.34, a: 'Scout', c: COLORS.mint, t: 'Pipeline research' },
  { d: 0, s: 0.55, e: 0.78, a: 'Inbox', c: COLORS.violet, t: 'Inbox sweep' },
  { d: 1, s: 0.2, e: 0.5, a: 'Ledger', c: COLORS.amber, t: 'Match receipts' },
  { d: 2, s: 0.05, e: 0.28, a: 'Inbox', c: COLORS.violet, t: 'Inbox sweep' },
  { d: 2, s: 0.48, e: 0.8, a: 'Patch', c: COLORS.sky, t: 'Nightly tests' },
  { d: 3, s: 0.3, e: 0.56, a: 'Rosie', c: COLORS.rose, t: 'Ticket review' },
  { d: 4, s: 0.1, e: 0.4, a: 'Scout', c: COLORS.mint, t: 'Weekly outbound' },
  { d: 4, s: 0.6, e: 0.86, a: 'Ledger', c: COLORS.amber, t: 'File expenses' },
  { d: 5, s: 0.35, e: 0.6, a: 'Atlas', c: COLORS.coral, t: 'Plan the week' },
  { d: 6, s: 0.15, e: 0.38, a: 'Patch', c: COLORS.sky, t: 'Update packages' },
];
function routines() {
  const host = $('.week');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  host.innerHTML = days.map((d) => `<div class="wd"><span class="wd-h">${d}</span><div class="wd-col"></div></div>`).join('') + '<span class="now" aria-hidden="true"></span>';
  const cols = $$('.wd-col', host);
  const blocks = WEEK.map((b) => {
    const el = document.createElement('div');
    el.className = 'rb'; el.style.setProperty('--c', b.c);
    el.style.top = b.s * 100 + '%'; el.style.height = (b.e - b.s) * 100 + '%';
    el.innerHTML = `<span class="rb-av">${avatarSVG(b.c, { alive: true })}</span><span class="rb-t"><b>${b.t}</b><small>${b.a}</small></span><span class="rb-bar"><i></i></span>`;
    cols[b.d].appendChild(el);
    return { el, b, bar: el.querySelector('.rb-bar i') };
  });
  const now = $('.now', host);
  let t = 0.08, last = performance.now(), on = false;
  const tick = (ts) => {
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (on) {
      t = (t + dt / 16) % 1; // a week every 16 seconds
      const day = Math.floor(t * 7), dayT = t * 7 - day;
      const col = cols[day], hr = host.getBoundingClientRect(), cr = col.getBoundingClientRect();
      now.style.transform = `translate(${cr.left - hr.left}px, ${cr.top - hr.top + dayT * cr.height}px)`;
      now.style.width = cr.width + 'px';
      blocks.forEach(({ el, b, bar }) => {
        const state = b.d < day || (b.d === day && dayT > b.e) ? 'done' : b.d === day && dayT >= b.s ? 'run' : 'wait';
        if (el.dataset.state !== state) el.dataset.state = state;
        bar.style.transform = `scaleX(${state === 'done' ? 1 : state === 'run' ? (dayT - b.s) / (b.e - b.s) : 0})`;
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  inView(host, () => { on = true; return () => (on = false); }, { amount: 0.3 });
}

/* ───────── Approvals: the agent asks, you approve ───────── */
function approvals() {
  const card = $('.ask');
  if (!card) return;
  const m = new Mascot3D($('.ask-mx'), { shared: true, color: COLORS.violet, emotion: 'neutral', cosmetic: 'headphones', frame: 1.5 });
  const ok = $('.ask-ok'), review = $('.ask-review');
  let timer = 0, busy = false;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { ok.classList.add('pressing'); setTimeout(() => { ok.classList.remove('pressing'); approve(); }, 260); }, 5200); };
  const reset = () => { card.classList.remove('sent'); m.setEmotion('neutral'); busy = false; schedule(); };
  const approve = () => {
    if (busy) return; busy = true; clearTimeout(timer);
    card.classList.add('sent'); m.setEmotion('happy'); m.hop();
    setTimeout(reset, 4200);
  };
  ok.addEventListener('click', approve);
  review.addEventListener('click', () => { m.setEmotion('suspicious'); m.look(0, -0.6, { noBlink: true }); clearTimeout(timer); setTimeout(() => { m.setEmotion('neutral'); schedule(); }, 2200); });
  inView(card, () => { schedule(); return () => clearTimeout(timer); }, { amount: 0.4 });
}
