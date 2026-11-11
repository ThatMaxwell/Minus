// Little sounds for the moments that matter: an agent finished, an agent needs you, something
// went wrong. Made live with Web Audio (two or three soft bell notes), nothing to download.
// When Minus isn't in front, a system notification says it too.
import { state } from './store.js';

let ctx = null;
const audio = () => {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};
// Browsers only allow sound after you've touched the page once.
addEventListener('pointerdown', () => audio(), { once: true, capture: true });

// A soft bell: a sine with a quiet octave and a fifth on top, a quick attack and a long fade.
function bell(c, out, f, at, len = 1.1, gain = 0.22) {
  for (const [mul, g] of [[1, 1], [2, 0.18], [3, 0.06]]) {
    const o = c.createOscillator(), v = c.createGain();
    o.type = 'sine'; o.frequency.value = f * mul;
    v.gain.setValueAtTime(0, at);
    v.gain.linearRampToValueAtTime(gain * g, at + 0.012);
    v.gain.exponentialRampToValueAtTime(0.0001, at + len / mul);
    o.connect(v).connect(out); o.start(at); o.stop(at + len + 0.05);
  }
}

const SONGS = {
  // finished: up a major sixth, like "ta-da" said gently
  done: [[659.25, 0], [1046.5, 0.11]],
  // needs you: two quick notes, the second a bit higher, a little brighter
  ask: [[783.99, 0], [987.77, 0.09], [1174.66, 0.18]],
  // a problem: down, soft
  oops: [[523.25, 0], [392, 0.14]],
};

export function chime(kind = 'done') {
  if (state.settings.sounds === false) return;
  const c = audio(); if (!c) return;
  const out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination);
  const t = c.currentTime + 0.02;
  for (const [f, d] of SONGS[kind] || SONGS.done) bell(c, out, f, t + d, kind === 'oops' ? 0.9 : 1.2, kind === 'ask' ? 0.17 : 0.2);
}

// A system notification, only when you're not looking at Minus.
let asked = false;
export async function notify(title, body) {
  if (state.settings.notify === false || (document.hasFocus() && !document.hidden)) return;
  const n = window.__TAURI__?.notification;
  try {
    if (n) {
      let ok = await n.isPermissionGranted();
      if (!ok && !asked) { asked = true; ok = (await n.requestPermission()) === 'granted'; }
      if (ok) n.sendNotification({ title, body });
    } else if ('Notification' in window) {
      if (Notification.permission === 'default' && !asked) { asked = true; await Notification.requestPermission(); }
      if (Notification.permission === 'granted') new Notification(title, { body, silent: true });
    }
  } catch { /* notifications are a nice-to-have */ }
}
