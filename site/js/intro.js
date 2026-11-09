// The Minus intro (~20s, scored, plays on every visit).
// A hairline (the minus) → one agent → ten → a hundred → the app at work on a real
// computer → open source, free, forever → letters fall into the line → the mascot and
// "minus" → the logo glides into the nav and the page builds underneath.
import { avatarSVG, COLORS } from './shape.js';
import { MagicText } from './magic-text.js';
import { createApp } from './app.js';
import { Mascot3D } from './mascot3d.js';
import { Sound } from './sound.js';

const { animate, stagger } = window.Motion;
const $ = (s, r = document) => r.querySelector(s);
const IN = [0.22, 1, 0.36, 1];
const INOUT = [0.76, 0, 0.24, 1];
const SPRING = { type: 'spring', stiffness: 170, damping: 22 };
const TEAM = [COLORS.mint, COLORS.violet, COLORS.amber, COLORS.sky, COLORS.coral];

export function runIntro({ onReveal, onDone }) {
  const intro = $('#intro'), gate = $('.gate', intro), stage = $('.i-stage', intro);
  const lineEl = $('.i-line', intro), textEl = $('.i-text', intro), crowd = $('.i-crowd', intro);
  const winEl = $('.i-win', intro), lockup = $('.i-lockup', intro), tag = $('.i-tag', intro), bg = $('.i-bg', intro);
  const text = new MagicText(textEl);
  // Phrases live in the page as plain sentences (so browser translation can translate them).
  // Each one is read right before it animates, in whatever language it is in by then.
  const src = $('.i-src', intro);
  const phrase = (k) => {
    const el = src.querySelector(`[data-p="${k}"]`);
    let out = '';
    const walk = (n, it) => n.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += it ? `*${c.textContent}*` : c.textContent;
      else if (c.nodeType === 1) walk(c, it || c.tagName === 'EM');
    });
    walk(el, false);
    return out.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  };
  const sound = new Sound();
  let app, mascot, shift = 0, convergeY = 0;

  gate.querySelector('.gate-mx').innerHTML = avatarSVG(COLORS.cloud, { label: 'Minus' });

  /* ───────── crowd of agents ───────── */
  const avatars = Array.from({ length: 100 }, (_, i) => {
    const a = document.createElement('div');
    a.className = 'i-av';
    a.innerHTML = avatarSVG(i < 10 ? (i === 0 ? COLORS.cloud : TEAM[(i - 1) % 5]) : COLORS.cloud);
    crowd.appendChild(a);
    return a;
  });
  const W = () => innerWidth, H = () => innerHeight;
  const fs = () => parseFloat(getComputedStyle(textEl).fontSize);
  const crowdY = () => fs() * 0.75 + 52; // crowd sits under the phrase
  const gridSpec = () => (W() > 720 ? { cols: 20, gap: 26, size: 0.5 } : { cols: 10, gap: 22, size: 0.42 });
  const to = (els, kf, o) => animate(els, kf, o);

  /* ───────── cue sheet (seconds after the click) ───────── */
  const cues = [
    [0.0, () => { sound.chord(['D2', 'A2', 'D3'], { gain: 0.07, fc: 220 }); }],
    [0.35, () => { to(lineEl, { width: [0, 64], opacity: [0, 1] }, { duration: 1.1, ease: IN }); sound.bell('A4', 0.05); }],

    // the count
    [1.15, () => {
      text.show(phrase('one'));
      to(lineEl, { opacity: 0, width: 24 }, { duration: 0.5, ease: IN });
      to(crowd, { y: crowdY() }, { duration: 0 });
      to(avatars[0], { opacity: [0, 1], scale: [0, 1.25], x: 0, y: 0 }, SPRING);
      sound.chord(['D3', 'F3', 'A3', 'E4'], { gain: 0.05, fc: 900 }); sound.bell('D5');
    }],
    [2.35, () => {
      text.to(phrase('ten'));
      for (let i = 0; i < 10; i++) {
        to(avatars[i], { opacity: 1, scale: 0.875, x: (i - 4.5) * 40, y: 0 }, { ...SPRING, delay: i * 0.035 });
      }
      sound.chord(['Bb2', 'D3', 'F3', 'A3'], { gain: 0.05, fc: 1100 }); sound.bell('F5');
    }],
    [3.55, () => {
      text.to(phrase('hundred'));
      const { cols, gap, size } = gridSpec(), rows = 100 / cols;
      to(textEl, { y: -(rows * gap) / 2 }, { duration: 0.9, ease: INOUT });
      to(crowd, { y: crowdY() - (rows * gap) / 2 + 8 }, { duration: 0.9, ease: INOUT });
      avatars.forEach((a, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const x = (c - (cols - 1) / 2) * gap, y = r * gap;
        to(a, { opacity: i < 10 ? 1 : 0.88, scale: size, x, y }, { ...SPRING, delay: i < 10 ? 0 : 0.05 + (c + r) * 0.018 });
      });
      sound.chord(['G2', 'Bb2', 'F3', 'A3'], { gain: 0.05, fc: 1300 }); sound.bell('A5');
    }],
    [4.75, () => {
      text.to(phrase('work'));
      const { cols } = gridSpec();
      avatars.forEach((a, i) => { a.style.setProperty('--d', (i % cols) * 28 + 'ms'); a.classList.add('blink'); });
      sound.chord(['A2', 'D3', 'E3', 'B3'], { gain: 0.05, fc: 1500 }); sound.bell('E5', 0.06);
    }],

    // the app, at work
    [5.75, () => {
      const { cols, gap } = gridSpec();
      convergeY = ((100 / cols - 1) * gap) / 2;
      to(avatars, { x: 0, y: convergeY, scale: 0, opacity: 0 },
        { duration: 0.45, ease: [0.5, 0, 0.75, 0], delay: stagger(0.003, { from: 'center' }) });
      sound.whoosh();
    }],
    [5.95, () => {
      const top = Math.max(52, H() * 0.075), f = fs();
      to(textEl, { y: top + 0.65 * f * 0.62 - H() / 2, scale: 0.62 }, { duration: 0.9, ease: INOUT });
      text.to(phrase('computers'));
      // window fills the space under the phrase
      const winTop = top + f * 0.62 * 1.3 + 22, avail = H() - winTop - Math.max(28, H() * 0.05);
      const w = Math.min(1080, W() * 0.92), h = Math.min(avail, w * 0.62);
      Object.assign(winEl.style, { width: w + 'px', height: h + 'px', top: winTop + (avail - h) / 2 + 'px' });
      app = createApp(winEl, { intro: true, sound });
      const r = winEl.getBoundingClientRect(), cr = crowd.getBoundingClientRect();
      winEl.style.transformOrigin = `${cr.left - r.left}px ${cr.top + convergeY - r.top}px`;
      winEl.hidden = false;
      to(winEl, { scale: [0.03, 1], opacity: [0, 1], filter: ['blur(14px)', 'blur(0px)'] },
        { scale: { type: 'spring', stiffness: 110, damping: 19 }, default: { duration: 0.6, ease: IN } });
      app.start();
      sound.chord(['D3', 'F3', 'A3', 'C4', 'E4'], { gain: 0.045, fc: 1700 }); sound.pulse(true); sound.boom();
    }],
    [8.3, () => { text.to(phrase('cloud')); sound.chord(['Bb2', 'D3', 'F3', 'A3', 'C4'], { gain: 0.045, fc: 1800 }); sound.bell('D5', 0.05); }],
    [9.4, () => { text.to(phrase('own')); app.setComputer('This laptop'); sound.chord(['G2', 'Bb2', 'D3', 'F3', 'A3'], { gain: 0.045, fc: 1900 }); sound.bell('F5', 0.05); }],
    [10.5, () => { text.to(phrase('ai')); sound.chord(['A2', 'C#3', 'E3', 'G3', 'B3'], { gain: 0.045, fc: 2100 }); sound.bell('E5', 0.05); }],
    ...['ChatGPT', 'Gemini', 'Grok', 'Llama', 'Claude'].map((m, i) => [10.85 + i * 0.3, () => { app.setModel(m); sound.click(); }]),

    // the promise
    [12.35, () => {
      app.stop(); sound.pulse(false); sound.whoosh();
      to(winEl, { scale: 0.94, opacity: 0, filter: 'blur(10px)', y: 24 }, { duration: 0.6, ease: [0.4, 0, 0.2, 1] });
      to(textEl, { y: 0, scale: 1 }, { duration: 0.9, ease: INOUT });
      text.to(phrase('open'));
      sound.chord(['Bb2', 'F3', 'A3', 'C4', 'D4'], { gain: 0.05, fc: 1000 }); sound.bell('A5', 0.07);
    }],
    [13.3, () => { text.to(phrase('free')); sound.bell('C6', 0.07); sound.chord(['G2', 'D3', 'F3', 'A3', 'Bb3'], { gain: 0.05, fc: 1100 }); }],
    [14.2, () => { text.to(phrase('forever')); sound.bell('D6', 0.07); sound.rise(); sound.chord(['A2', 'E3', 'G3', 'C#4', 'D4'], { gain: 0.05, fc: 1300 }); }],

    // the mark
    [15.15, () => {
      text.collapse();
      lineEl.style.top = '50%';
      to(lineEl, { opacity: [0, 1], width: [0, 120] }, { duration: 0.5, ease: IN });
      sound.chord(['D2', 'A2'], { gain: 0.06, fc: 400 });
    }],
    [15.65, () => to(lineEl, { width: 10, height: 10, borderRadius: '50%' }, { duration: 0.2, ease: [0.5, 0, 0.75, 0] })],
    [15.85, () => {
      to(lineEl, { opacity: 0, scale: 2 }, { duration: 0.15 });
      lockup.classList.add('show');
      mascot.setScale(1);
      sound.boom();
      sound.chord(['D2', 'A2', 'F#3', 'C#4', 'E4', 'A4'], { gain: 0.055, fc: 2600 });
      ['A5', 'D6', 'F#6', 'A6', 'C#7'].forEach((n, i) => setTimeout(() => sound.bell(n, 0.055), 140 + i * 95));
    }],
    [16.35, () => {
      to(lockup, { x: [shift, 0] }, { type: 'spring', stiffness: 120, damping: 20 });
      to(lockup.querySelectorAll('.i-name i'), { y: ['110%', '0%'] }, { duration: 0.8, delay: stagger(0.05), ease: IN });
    }],
    [16.9, () => mascot.look(0.8, -0.12, { noBlink: true })],
    [17.4, () => { tag.classList.add('show'); to(tag, { opacity: [0, 1], y: [8, 0] }, { duration: 0.8, ease: IN }); }],
    [17.65, () => mascot.look(0, 0, { noBlink: true })],
    [18.05, () => mascot.blink()],

    // into the site
    [18.75, () => {
      const logo = $('.nav-logo'), from = lockup.getBoundingClientRect(), dest = logo.getBoundingClientRect();
      const s = dest.height / from.height;
      lockup.style.transformOrigin = 'left center';
      to(lockup, { x: dest.left - from.left, y: dest.top + dest.height / 2 - (from.top + from.height / 2), scale: s },
        { duration: 1.05, ease: INOUT }).then(() => { logo.classList.add('on'); lockup.style.opacity = 0; });
      to(tag, { opacity: 0 }, { duration: 0.3 });
      to(bg, { opacity: 0 }, { duration: 1.1, delay: 0.25, ease: [0.4, 0, 0.2, 1] });
      intro.classList.add('leaving');
      sound.padLevel(0.6);
      setTimeout(() => onReveal?.(), 350);
    }],
    [19.4, () => sound.fadeOut()],
    [20.2, () => finish()],
  ];

  let done = false;
  function finish() {
    if (done) return; done = true;
    app?.stop();
    if (mascot) mascot.running = false;
    intro.remove();
    document.documentElement.classList.remove('intro-on');
    onDone?.();
  }

  const start = async () => {
    removeEventListener('click', start); removeEventListener('keydown', start);
    to(gate, { opacity: 0, scale: 0.98 }, { duration: 0.35, ease: [0.4, 0, 1, 1] }).then(() => gate.remove());
    setTimeout(() => finish(), 45000); // whatever happens, never trap anyone in the intro
    // Never let audio hold the intro: start after at most 2.5s, sound joins when ready.
    await Promise.race([sound.init(), new Promise((r) => setTimeout(r, 2500))]);
    mascot = new Mascot3D(lockup.querySelector('.i-mx'), { idle: false, scale: 0 });
    try { await document.fonts.ready; } catch {}
    const name = lockup.querySelector('.i-name');
    shift = (name.offsetWidth + parseFloat(getComputedStyle(lockup).columnGap || 0)) / 2;
    animate(lockup, { x: shift }, { duration: 0 });
    const t0 = performance.now();
    let i = 0;
    const tick = () => {
      if (done) return;
      const t = (performance.now() - t0) / 1000;
      while (i < cues.length && t >= cues[i][0]) { try { cues[i][1](); } catch (e) { console.error(e); } i++; }
      if (i < cues.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // 'click' (not pointerdown): iOS only lets audio start on a full tap.
  addEventListener('click', start);
  addEventListener('keydown', start);
}
