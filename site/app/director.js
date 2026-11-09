// The mascot director: turns what happens in the app into body language.
// Every agent on screen gives a hint about what is going on: it listens while you type,
// nods when you send, looks at its computer while it works, tilts its head when it needs
// you, looks away while you type a secret, and so on.
import { mascotsOf, allMascots } from './ui.js';

const rest = (m) => m.rest || 'neutral';
const later = (m, ms, fn) => { clearTimeout(m._rev); m._rev = setTimeout(fn, ms); };
const back = (m, ms = 2400) => later(m, ms, () => m.setEmotion(rest(m)));

export const REACTIONS = {
  listening: (m, el) => { clearTimeout(m._rev); if (m.emotion !== 'listening') m.setEmotion('listening'); if (el) m.lookAtEl(el, 3); },
  word: (m) => { if (Math.random() < 0.34) m.gesture('nod'); },
  calm: (m) => { m.setEmotion(rest(m)); m.pointerT = 0; },
  send: (m) => { m.gesture('nod'); m.setEmotion('happy'); back(m, 900); },
  thinking: (m) => { clearTimeout(m._rev); m.setEmotion('thinking'); },
  reply: (m) => { m.setEmotion(rest(m)); m.blink(); },
  working: (m, el) => { clearTimeout(m._rev); m.setEmotion('focused'); if (el) m.lookAtEl(el, 4); },
  step: (m) => { if (Math.random() < 0.25) m.gesture('nod'); },
  done: (m) => { m.setEmotion('proud'); m.hop(); back(m, 3000); },
  ask: (m) => { clearTimeout(m._rev); m.setEmotion('curious'); m.gesture('tilt'); },
  approved: (m) => { m.setEmotion('happy'); m.gesture('nod'); back(m, 2200); },
  rejected: (m) => { m.setEmotion('sad'); later(m, 900, () => m.gesture('nod')); back(m, 2600); },
  takeover: (m) => { m.setEmotion('surprised'); later(m, 900, () => m.setEmotion('listening')); },
  giveback: (m) => { m.setEmotion('happy'); m.gesture('nod'); back(m, 1800); },
  hello: (m) => { m.setEmotion('excited'); m.gesture('celebrate'); back(m, 2600); },
  confused: (m) => { m.setEmotion('confused'); m.gesture('shake'); back(m, 2000); },
  no: (m) => { m.gesture('shake'); },
  yes: (m) => { m.gesture('nod'); },
  shy: (m, el) => { clearTimeout(m._rev); m.setEmotion('shy'); if (el) { const r = el.getBoundingClientRect(), c = m.canvas.getBoundingClientRect(); m.lookAt(c.left - (r.left - c.left), c.top + c.height * 1.2, 99); } },
  worried: (m) => { m.setEmotion('worried'); m.gesture('shiver'); back(m, 2600); },
  relieved: (m) => { m.setEmotion('happy'); m.gesture('nod'); back(m, 1600); },
  proud: (m) => { m.setEmotion('proud'); back(m, 2600); },
  sleep: (m) => { m.setEmotion('sleepy'); },
  wake: (m) => { m.setEmotion('alert'); back(m, 1200); },
  look: (m, el) => { if (el) m.lookAtEl(el, 2); },
  peek: (m) => m.gesture('peek'),
  spin: (m) => { m.setEmotion('excited'); m.gesture('spin'); back(m, 1600); },
  hop: (m) => { m.hop(); },
  admire: (m, slot) => { m.setEmotion('happy'); m.look(0, slot === 'neck' ? -0.9 : slot === 'head' ? 0.9 : 0, { noBlink: true }); m.pointerT = 1.4; m.hop(); back(m, 1600); },
};

// React with one mascot.
export function act(m, name, arg) { if (m && m.running !== false) REACTIONS[name]?.(m, arg); }
// React with every mascot of one agent (sidebar, header, thread...).
export function react(agentId, name, arg) { mascotsOf(agentId).forEach((m) => act(m, name, arg)); }

// Nobody touching anything for a while: everyone dozes off. Any input wakes them.
export function idleWatch(ms = 60000) {
  let t = 0, asleep = false;
  const arm = () => {
    clearTimeout(t);
    if (asleep) { asleep = false; allMascots().forEach((m) => act(m, 'wake')); }
    t = setTimeout(() => { asleep = true; allMascots().forEach((m) => act(m, 'sleep')); }, ms);
  };
  ['pointerdown', 'keydown', 'wheel'].forEach((e) => addEventListener(e, arm, { passive: true }));
  arm();
}
