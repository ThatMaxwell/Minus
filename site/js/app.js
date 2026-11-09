// The Minus app, as a live mock: agent list, a thread that narrates the work,
// and the agent's computer screen. Used by the intro and by the hero.
import { avatarSVG, COLORS } from './shape.js';
import { ComputerSim } from './computer.js';

const { animate } = window.Motion;
const EASE = [0.22, 1, 0.36, 1];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const AGENTS = [
  { name: 'Scout', color: COLORS.mint, status: 'Adding webinar leads', live: true },
  { name: 'Inbox', color: COLORS.violet, status: 'Waiting for your OK' },
  { name: 'Ledger', color: COLORS.amber, status: 'Matched 214 receipts' },
  { name: 'Patch', color: COLORS.sky, status: 'Reproduced the login bug', live: true },
  { name: 'Atlas', color: COLORS.coral, status: 'Booked the offsite', live: true },
];

const ICON = {
  model: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v2.4M8 11.8v2.4M1.8 8h2.4M11.8 8h2.4M3.6 3.6l1.7 1.7M10.7 10.7l1.7 1.7M3.6 12.4l1.7-1.7M10.7 5.3l1.7-1.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
  comp: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5.5 13.6h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function roll(slot, text) {
  const cur = slot.lastElementChild;
  if (cur && cur.textContent === text) return;
  const next = document.createElement('span');
  next.textContent = text;
  slot.appendChild(next);
  const h = slot.getBoundingClientRect().height || 18;
  const sp = { type: 'spring', stiffness: 320, damping: 30 };
  if (cur) animate(cur, { y: [0, -h], opacity: [1, 0] }, sp).then(() => cur.remove());
  animate(next, { y: [h, 0], opacity: [0, 1] }, sp);
}

export function createApp(root, { intro = false, sound } = {}) {
  root.classList.add('win');
  root.innerHTML = `
    <div class="win-bar">
      <div class="wb-l"><span class="wb-mx">${avatarSVG(COLORS.cloud, { box: 112 })}</span><span class="wb-ws">Acme</span><span class="wb-sep">/</span><span class="wb-page">Agents</span></div>
      <div class="wb-r"><span class="wb-dot"></span>3 working</div>
    </div>
    <div class="win-body">
      <aside class="w-side">
        <div class="ws-h">Agents</div>
        <div class="ws-list">${AGENTS.map((a, i) => `
          <div class="ws-ag${i === 0 ? ' sel' : ''}">
            <span class="av">${avatarSVG(a.color, { alive: true })}</span>
            <span class="ws-t"><b>${a.name}</b><small>${a.status}</small></span>
            ${a.live ? '<span class="ws-live"></span>' : ''}
          </div>`).join('')}
        </div>
        <div class="ws-h">Computers</div>
        <div class="ws-comp"><span><i class="cl"></i>Cloud computer 1</span><span><i class="cl"></i>Cloud computer 2</span><span><i class="lo"></i>This laptop</span></div>
      </aside>
      <section class="w-thread">
        <header class="wt-h">
          <span class="av">${avatarSVG(COLORS.mint, { alive: true })}</span><b>Scout</b>
          <span class="chip">${ICON.model}<span class="slot" data-slot="model"><span>Claude</span></span></span>
          <span class="chip hide-s">${ICON.comp}<span class="slot" data-slot="comp"><span>Cloud computer 1</span></span></span>
        </header>
        <div class="wt-msgs"></div>
        <div class="wt-input"><span>Message Scout</span><kbd>↵</kbd></div>
      </section>
      <section class="w-screen">
        <header class="wsc-h"><span class="live"><i></i>Live</span><span class="slot" data-slot="comp2"><span>Cloud computer 1</span></span><span class="wsc-btn">Take over</span></header>
        <div class="wsc-pc"></div>
      </section>
    </div>`;

  const msgs = root.querySelector('.wt-msgs');
  const slots = Object.fromEntries([...root.querySelectorAll('[data-slot]')].map((s) => [s.dataset.slot, s]));
  let steps = null, stepList = null, progress = null, running = false;

  const sim = new ComputerSim(root.querySelector('.wsc-pc'), {
    agent: 'Scout', color: COLORS.mint, speed: intro ? 1.7 : 1.1,
    onClick: () => sound?.click(), onKey: () => sound?.key(),
    onStep: (s) => addStep(s.text),
    onSave: (n) => progress && (progress.textContent = n),
  });

  function post(html, cls) {
    const m = document.createElement('div');
    m.className = 'm ' + cls; m.innerHTML = html;
    msgs.appendChild(m);
    while (msgs.children.length > 8) msgs.firstElementChild.remove();
    animate(m, { opacity: [0, 1], y: [10, 0], filter: ['blur(4px)', 'blur(0px)'] }, { duration: 0.5, ease: EASE });
    return m;
  }
  const agentMsg = (color, name, text) => post(`<span class="av">${avatarSVG(color, { alive: true })}</span><div><b>${name}</b><p>${text}</p></div>`, 'ag');
  const typing = (color) => post(`<span class="av">${avatarSVG(color, { alive: true })}</span><div class="dots"><i></i><i></i><i></i></div>`, 'ag');

  function addStep(text) {
    if (!stepList) return;
    const prev = stepList.querySelector('.st.run');
    if (prev) { prev.classList.replace('run', 'done'); prev.querySelector('.ic').innerHTML = ICON.check; }
    const row = document.createElement('div');
    row.className = 'st run'; row.innerHTML = `<span class="ic"><i class="spin"></i></span><span class="tx"></span>`;
    row.querySelector('.tx').textContent = text;
    stepList.appendChild(row);
    while (stepList.children.length > 3) stepList.firstElementChild.remove();
    animate(row, { opacity: [0, 1], x: [-6, 0] }, { duration: 0.35, ease: EASE });
  }

  async function script() {
    let first = !intro;
    while (running) {
      msgs.innerHTML = ''; sim.reset();
      post('Add everyone from yesterday’s webinar sheet to the CRM. Skip anyone who’s already in it.', 'me');
      if (!first) {
        await wait(intro ? 250 : 900);
        const t = typing(COLORS.mint); await wait(intro ? 450 : 1100); t.remove();
      }
      agentMsg(COLORS.mint, 'Scout', 'On it. 42 people in the sheet and 6 are already in the CRM, so I’m adding the other 36.');
      await wait(first ? 0 : intro ? 250 : 700);
      first = false;
      steps = post(`<div class="steps-h"><span>${ICON.comp}Working on <b>Cloud computer 1</b></span><span class="prog"><b>0</b> / 36</span></div><div class="steps-l"></div>`, 'steps');
      stepList = steps.querySelector('.steps-l'); progress = steps.querySelector('.prog b');
      await sim.run({ max: intro ? 99 : 3 });
      if (!running) return;
      for (let n = sim.saved; n <= 36; n++) { progress.textContent = n; await wait(28); }
      addStep('Checked for duplicates'); await wait(500);
      stepList.querySelector('.st.run')?.classList.replace('run', 'done');
      stepList = null;
      await wait(400);
      agentMsg(COLORS.mint, 'Scout', 'Done. 36 added, no duplicates. Handing the welcome emails to Inbox.');
      await wait(900);
      post(`<span class="av">${avatarSVG(COLORS.mint, { alive: true })}</span><span class="arr"></span><span class="av">${avatarSVG(COLORS.violet, { alive: true })}</span><span>Scout handed off to <b>Inbox</b></span>`, 'handoff');
      await wait(900);
      const t2 = typing(COLORS.violet); await wait(1100); t2.remove();
      agentMsg(COLORS.violet, 'Inbox', '36 welcome emails are drafted in your voice. Nothing goes out until you say so.');
      await wait(1600);
      post('Looks good. Send them.', 'me');
      await wait(800);
      agentMsg(COLORS.violet, 'Inbox', 'Sent.');
      await wait(5000);
    }
  }

  return {
    root, sim, slots,
    start() { if (running) return; running = true; script(); },
    stop() { running = false; sim.stop(); },
    setComputer(name) { roll(slots.comp, name); roll(slots.comp2, name); },
    setModel(name) { roll(slots.model, name); },
  };
}
