// The front door. In the apps, nothing of Minus shows until you sign in: a black screen, a
// pill opens in the middle, a row of agents is shoved in, a selector settles on the white
// one, the pill closes around him and "Minus" lands. Below, Continue with GitHub.
import { Mascot3D } from '../js/mascot3d.js';
import { ROSTER } from '../js/hero.js';
import { icon } from './ui.js';
import * as account from './account.js';

const { animate, stagger } = window.Motion;
const IN = [0.22, 1, 0.36, 1];
const INOUT = [0.76, 0, 0.24, 1];
const WHITE = 3;
const FRAME = 1.12 * 1.4;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let el = null, hero = null, live = [];

export function showGate({ phone = false } = {}) {
  if (el) return;
  el = document.createElement('div');
  el.className = 'gate';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Sign in to Minus');
  el.innerHTML = `<div class="g-center"><div class="g-meet" aria-label="Minus">
      <span class="g-pill" aria-hidden="true"><span class="g-sel"></span><span class="g-track"></span></span>
      <span class="g-word" aria-hidden="true"><span class="g-word-in">Minus</span></span></div></div>
    <div class="g-foot">
      <button class="g-signin" type="button">${icon('github')}<span>Continue with GitHub</span></button>
      <p class="g-note">${phone ? 'Or on your computer: Minus → Settings → Devices → New, and scan the code with this phone’s camera.' : 'Free and open source. Your AI keys never leave this computer.'}</p>
      <p class="g-err" role="alert" hidden></p>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.g-signin').addEventListener('click', async (e) => {
    const b = e.currentTarget, err = el.querySelector('.g-err');
    b.disabled = true; err.hidden = true;
    b.querySelector('span').textContent = 'Opening GitHub…';
    try { await account.signIn(); b.querySelector('span').textContent = 'Waiting for GitHub…'; }
    catch (x) { err.hidden = false; err.textContent = x?.message || 'Couldn’t open GitHub. Try again.'; b.querySelector('span').textContent = 'Continue with GitHub'; }
    finally { setTimeout(() => { b.disabled = false; }, 2500); }
  });
  play(phone).catch(() => {});
}

async function play(phone) {
  const meet = el.querySelector('.g-meet'), pill = el.querySelector('.g-pill'), track = el.querySelector('.g-track'), sel = el.querySelector('.g-sel');
  const word = el.querySelector('.g-word'), wordIn = el.querySelector('.g-word-in'), foot = el.querySelector('.g-foot');
  const roster = phone || innerWidth < 640 ? ROSTER.slice(1, 6) : ROSTER;
  const white = roster.indexOf(ROSTER[WHITE]);
  const em = () => parseFloat(getComputedStyle(meet).fontSize);
  const slots = roster.map((a) => {
    const slot = document.createElement('span'); slot.className = 'g-slot';
    const c = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true');
    slot.appendChild(c); track.appendChild(slot);
    return { slot, canvas: c, a, m: null };
  });
  pill.style.width = '0px'; word.style.width = '0px'; wordIn.style.opacity = 0; foot.style.opacity = 0;
  await wait(450);
  if (!el) return;
  const E = em(), sw = slots[0].slot.getBoundingClientRect().width || E * 0.98, pad = E * 0.1, n = slots.length, openW = n * sw + pad * 2;
  // the pill opens, and the agents are shoved in from the left
  animate(pill, { width: [0, openW], opacity: [0, 1] }, { width: { type: 'spring', stiffness: 110, damping: 19 }, opacity: { duration: 0.25 } });
  slots.forEach((s) => {
    s.m = new Mascot3D(s.canvas, { shared: true, idle: true, color: s.a.color, emotion: s.a.emotion, cosmetic: s.a.cosmetic, frame: FRAME });
    s.m.setScale(1, true); live.push(s.m);
  });
  const far = -(openW + E * 2);
  slots.forEach((s) => (s.slot.style.transform = `translateX(${far}px)`));
  await wait(220);
  slots.slice().reverse().forEach((s, k) => animate(s.slot, { x: [far, 0] }, { type: 'spring', stiffness: 170, damping: 17, delay: 0.05 + k * 0.07 }));
  await wait(1300);
  if (!el) return;
  // a selector runs along and settles on the white one; everyone turns to look
  const xs = slots.map((s) => s.slot.offsetLeft);
  sel.style.width = sw + 'px';
  await animate(sel, { opacity: [0, 1], x: [xs[0], xs[0]] }, { duration: 0.15 });
  await animate(sel, { x: [xs[0], xs[n - 1], xs[white]] }, { duration: 1.25, ease: [0.3, 0, 0.2, 1], times: [0, 0.55, 1] });
  hero = slots[white].m;
  hero.setEmotion('happy'); hero.hop();
  slots.forEach((s, i) => { if (i !== white) s.m.look(Math.sign(white - i) * 0.9, 0.05, { noBlink: true }); });
  await wait(750);
  if (!el) return;
  // the others pop out and the pill closes around him
  const others = slots.filter((_, i) => i !== white);
  await animate(others.map((s) => s.slot), { scale: 0, opacity: 0 }, { duration: 0.32, ease: [0.5, 0, 0.75, 0], delay: stagger(0.035, { from: white }) });
  animate(sel, { opacity: 0 }, { duration: 0.2 });
  const left = slots[white].slot.offsetLeft - pad;
  others.forEach((s) => { s.m.destroy(); s.slot.remove(); });
  live = [hero];
  track.style.transform = `translateX(${left}px)`;
  await Promise.all([animate(track, { x: [left, 0] }, { duration: 0.6, ease: INOUT }), animate(pill, { width: sw + pad * 2 }, { duration: 0.6, ease: INOUT })]);
  pill.classList.add('closed');
  await animate(pill, { width: sw }, { duration: 0.4, ease: INOUT });
  hero.setEmotion('neutral');
  // he steps aside and "Minus" lands; then the way in
  animate(slots[white].slot, { x: [0, -E * 0.08, 0] }, { duration: 0.5, ease: IN });
  const mw = wordIn.getBoundingClientRect().width;
  animate(word, { width: [0, mw] }, { duration: 0.75, ease: INOUT }).then(() => (word.style.width = 'auto'));
  animate(wordIn, { x: ['-0.4em', '0em'], opacity: [0, 1], filter: ['blur(10px)', 'blur(0px)'] }, { duration: 0.8, delay: 0.1, ease: IN });
  setTimeout(() => hero?.look(0, 0.5), 600);
  animate(foot, { opacity: [0, 1], y: [14, 0] }, { duration: 0.6, delay: 0.5, ease: IN });
  hero.follow = true;
  addEventListener('pointermove', follow);
}
const follow = (e) => hero?.onPointer?.(e);

/** Signed in: the screen fades and Minus is underneath. */
export async function hideGate() {
  if (!el) return;
  const g = el; el = null;
  removeEventListener('pointermove', follow);
  hero?.setEmotion('happy'); hero?.hop();
  await wait(350);
  await animate(g, { opacity: 0, filter: 'blur(8px)', scale: 1.04 }, { duration: 0.5, ease: IN });
  live.forEach((m) => m.destroy()); live = []; hero = null;
  g.remove();
}
