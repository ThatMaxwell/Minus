// Hero heading: "Meet [ … ] Minus."
// A pill opens after "Meet", a row of agents gets shoved in from the left, a selector
// settles on the white one, the pill closes around him, he steps left and "Minus." lands.
// Click him and an iOS-style pill of agents opens underneath to swap him out.
import { Mascot3D } from './mascot3d.js';
import { COLORS } from './shape.js';

const { animate, stagger } = window.Motion;
const IN = [0.22, 1, 0.36, 1];
const INOUT = [0.76, 0, 0.24, 1];

export const ROSTER = [
  { name: 'Scout', color: COLORS.mint, emotion: 'happy', cosmetic: 'cap' },
  { name: 'Ledger', color: COLORS.amber, emotion: 'suspicious', cosmetic: 'crown' },
  { name: 'Inbox', color: COLORS.violet, emotion: 'wink', cosmetic: 'headphones' },
  { name: 'Minus', color: COLORS.cloud, emotion: 'neutral', cosmetic: 'none' },
  { name: 'Patch', color: COLORS.sky, emotion: 'excited', cosmetic: 'antenna' },
  { name: 'Atlas', color: COLORS.coral, emotion: 'surprised', cosmetic: 'beanie' },
  { name: 'Rosie', color: COLORS.rose, emotion: 'happy', cosmetic: 'cat ears' },
];
const WHITE = 3;
const HAT_FRAME = 1.12 * 1.4; // slot canvases are 140% of the slot, so the body keeps its size and hats fit

export function setupHero() {
  const h1 = document.querySelector('.meet');
  const meet = h1.querySelector('.meet-w'), minus = h1.querySelector('.minus-w'), minusIn = minus.firstElementChild;
  const pill = h1.querySelector('.meet-pill'), track = h1.querySelector('.meet-track'), sel = h1.querySelector('.meet-sel');
  const em = () => parseFloat(getComputedStyle(h1).fontSize);
  const narrow = innerWidth < 640;
  const roster = narrow ? ROSTER.slice(1, 6) : ROSTER; // keep white in the middle either way
  const white = roster.indexOf(ROSTER[WHITE]);

  // slots
  const slots = roster.map((a) => {
    const slot = document.createElement('span');
    slot.className = 'meet-slot';
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    slot.appendChild(c); track.appendChild(slot);
    return { slot, canvas: c, a, m: null };
  });
  const mascots = () => slots.filter((s) => s.m).map((s) => s.m);

  let hero = null; // the one that stays
  const slotW = () => slots[0].slot.getBoundingClientRect().width || em() * 0.98;
  const PAD = () => em() * 0.1;

  function finalState() {
    slots.forEach((s, i) => { if (i !== white) s.slot.remove(); });
    const s = slots[white];
    s.m = new Mascot3D(s.canvas, { shared: true, follow: true, color: s.a.color, frame: HAT_FRAME });
    hero = s.m;
    pill.classList.add('closed');
    pill.style.width = ''; track.style.transform = '';
    minus.style.width = 'auto'; minusIn.style.transform = 'none';
    meet.style.opacity = 1;
    enablePicker(s);
  }

  async function play() {
    h1.classList.add('playing');
    const E = em(), sw = slotW(), n = slots.length, openW = n * sw + PAD() * 2;
    // 1. "Meet"
    await animate(meet, { opacity: [0, 1], y: ['0.3em', '0em'], filter: ['blur(10px)', 'blur(0px)'] }, { duration: 0.7, ease: IN });
    // 2. the pill opens to the right
    animate(pill, { width: [0, openW], opacity: [0, 1] }, { width: { type: 'spring', stiffness: 110, damping: 19 }, opacity: { duration: 0.25 } });
    // 3. agents get shoved in from the left, one after another
    slots.forEach((s) => {
      s.m = new Mascot3D(s.canvas, { shared: true, idle: true, color: s.a.color, emotion: s.a.emotion, cosmetic: s.a.cosmetic, frame: HAT_FRAME });
      s.m.setScale(1, true);
    });
    const far = -(openW + E * 2);
    slots.forEach((s) => (s.slot.style.transform = `translateX(${far}px)`));
    await new Promise((r) => setTimeout(r, 220));
    slots.slice().reverse().forEach((s, k) => {
      animate(s.slot, { x: [far, 0] }, { type: 'spring', stiffness: 170, damping: 17, delay: 0.05 + k * 0.07 });
    });
    await new Promise((r) => setTimeout(r, 1300));
    // 4. a selector runs along and settles on the white one; everyone turns to look
    const xs = slots.map((s) => s.slot.offsetLeft);
    sel.style.width = sw + 'px';
    await animate(sel, { opacity: [0, 1], x: [xs[0], xs[0]] }, { duration: 0.15 });
    await animate(sel, { x: [xs[0], xs[n - 1], xs[white]] }, { duration: 1.25, ease: [0.3, 0, 0.2, 1], times: [0, 0.55, 1] });
    hero = slots[white].m;
    hero.setEmotion('happy'); hero.hop();
    slots.forEach((s, i) => { if (i !== white) s.m.look(Math.sign(white - i) * 0.9, 0.05, { noBlink: true }); });
    await new Promise((r) => setTimeout(r, 750));
    // 5. the others pop out, the pill closes around him
    const others = slots.filter((_, i) => i !== white);
    await animate(others.map((s) => s.slot), { scale: 0, opacity: 0 }, { duration: 0.32, ease: [0.5, 0, 0.75, 0], delay: stagger(0.035, { from: white }) });
    animate(sel, { opacity: 0 }, { duration: 0.2 });
    const left = slots[white].slot.offsetLeft - PAD();
    others.forEach((s) => { s.m.destroy(); s.slot.remove(); });
    // after removing, the white slot sits first; hold it in place, then let the pill shrink
    track.style.transform = `translateX(${left}px)`;
    await Promise.all([
      animate(track, { x: [left, 0] }, { duration: 0.6, ease: INOUT }),
      animate(pill, { width: sw + PAD() * 2 }, { duration: 0.6, ease: INOUT }),
    ]);
    pill.classList.add('closed');
    await animate(pill, { width: sw }, { duration: 0.4, ease: INOUT });
    hero.setEmotion('neutral');
    // 6. he steps left, "Minus." lands
    animate(slots[white].slot, { x: [0, -E * 0.08, 0] }, { duration: 0.5, ease: IN });
    const mw = minusIn.getBoundingClientRect().width;
    animate(minus, { width: [0, mw] }, { duration: 0.75, ease: INOUT }).then(() => (minus.style.width = 'auto'));
    animate(minusIn, { x: ['-0.4em', '0em'], opacity: [0, 1], filter: ['blur(10px)', 'blur(0px)'] }, { duration: 0.8, delay: 0.1, ease: IN });
    setTimeout(() => hero.look(0.6, 0, { noBlink: true }), 250);
    setTimeout(() => hero.look(0, 0), 1100);
    hero.follow = true; addEventListener('pointermove', (e) => hero.onPointer(e));
    h1.classList.remove('playing');
    enablePicker(slots[white]);
  }

  /* ───────── the swap picker ───────── */
  function enablePicker(s) {
    const btn = s.slot;
    btn.classList.add('swap');
    btn.setAttribute('role', 'button'); btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Swap the agent'); btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    let picker = null, opts = [];
    const wrap = h1.parentElement;

    const close = async () => {
      if (!picker) return;
      const p = picker; picker = null; btn.setAttribute('aria-expanded', 'false');
      removeEventListener('pointerdown', outside, true); removeEventListener('keydown', esc);
      hero.pointerT = 0; hero.look(0, 0, { noBlink: true });
      await animate(p, { opacity: 0, scale: 0.86, y: -6, filter: 'blur(6px)' }, { duration: 0.22, ease: [0.4, 0, 1, 1] });
      opts.forEach((o) => o.m.destroy()); opts = [];
      p.remove();
    };
    const outside = (e) => { if (picker && !picker.contains(e.target) && !btn.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };

    const open = () => {
      if (picker) return close();
      picker = document.createElement('div');
      picker.className = 'picker'; picker.setAttribute('role', 'listbox'); picker.setAttribute('aria-label', 'Choose an agent');
      picker.innerHTML = ROSTER.map((a, i) => `<button class="pk" role="option" data-i="${i}" aria-label="${a.name}"><canvas aria-hidden="true"></canvas><span>${a.name}</span></button>`).join('');
      wrap.appendChild(picker);
      // place it under him
      const br = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const pw = picker.offsetWidth;
      const cx = br.left + br.width / 2 - wr.left;
      const left = Math.max(8, Math.min(wr.width - pw - 8, cx - pw / 2));
      picker.style.left = left + 'px';
      picker.style.top = br.bottom - wr.top + 14 + 'px';
      picker.style.setProperty('--tip', cx - left + 'px');
      picker.style.transformOrigin = `${cx - left}px 0px`;
      opts = [...picker.querySelectorAll('.pk')].map((b) => {
        const a = ROSTER[+b.dataset.i];
        const m = new Mascot3D(b.querySelector('canvas'), { shared: true, idle: true, color: a.color, emotion: 'neutral', cosmetic: a.cosmetic, scale: 0, frame: 1.55 });
        b.addEventListener('pointerenter', () => { m.setEmotion(a.emotion); m.hop(); });
        b.addEventListener('pointerleave', () => m.setEmotion('neutral'));
        b.addEventListener('click', () => { hero.become(a); close(); });
        return { b, m };
      });
      animate(picker, { opacity: [0, 1], scale: [0.6, 1], y: [-10, 0], filter: ['blur(8px)', 'blur(0px)'] },
        { scale: { type: 'spring', stiffness: 420, damping: 30 }, y: { type: 'spring', stiffness: 420, damping: 30 }, default: { duration: 0.25 } });
      opts.forEach((o, i) => setTimeout(() => o.m.setScale(1), 90 + i * 40));
      hero.look(0, -1, { noBlink: true }); hero.pointerT = 99;
      btn.setAttribute('aria-expanded', 'true');
      addEventListener('pointerdown', outside, true); addEventListener('keydown', esc);
      opts[0]?.b.focus({ preventScroll: true });
    };
    btn.addEventListener('click', open);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    btn.addEventListener('pointerenter', () => !picker && hero.hop());
  }

  // hidden until played
  meet.style.opacity = 0; pill.style.width = '0px'; minus.style.width = '0px'; minusIn.style.opacity = 0;
  return { play, finalState };
}
