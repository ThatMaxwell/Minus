// Your PC's screen on your phone, live. The phone asks; the PC sends small pictures of its
// screen over a private channel only your own account can join (supabase 0003_screen.sql).
import * as acct from './account.js';

const tauri = window.__TAURI__;
const android = /Android/i.test(navigator.userAgent);
let ch = null, ok = false, wantAt = 0, pumping = false;
const watchers = new Set();

async function channel() {
  if (ch) return ch;
  const db = acct.client(), u = acct.user(); if (!db || !u) return null;
  try { await db.realtime.setAuth(); } catch {}
  ch = db.channel(`screen:${u.id}`, { config: { private: true, broadcast: { self: false } } });
  ch.on('broadcast', { event: 'want' }, () => { wantAt = Date.now(); if (!android) pump(); })
    .on('broadcast', { event: 'frame' }, ({ payload }) => watchers.forEach((f) => f(payload)))
    .subscribe((s) => { ok = s === 'SUBSCRIBED'; if (s === 'CHANNEL_ERROR') watchers.forEach((f) => f({ error: 'Your Minus server needs an update to show your PC here (supabase/migrations/0003_screen.sql).' })); });
  return ch;
}

// the PC: while a phone is watching (asked in the last 8 s), send a frame about every 0.8 s
async function pump() {
  if (pumping || !tauri) return; pumping = true;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d');
  try {
    while (Date.now() - wantAt < 8000 && ok) {
      try {
        const s = await tauri.core.invoke('hands_screen', { maxEdge: 1280 });
        const img = new Image(); img.src = 'data:image/png;base64,' + s.png; await img.decode();
        const w = Math.min(1100, img.width), h = Math.round(img.height * (w / img.width));
        cv.width = w; cv.height = h; cx.drawImage(img, 0, 0, w, h);
        await ch.send({ type: 'broadcast', event: 'frame', payload: { jpg: cv.toDataURL('image/jpeg', 0.55), w, h, at: Date.now() } });
      } catch (e) {
        await ch.send({ type: 'broadcast', event: 'frame', payload: { error: /support|platform/i.test(String(e)) ? 'Minus can show the screen from Windows PCs for now.' : `Your PC couldn’t take a picture of its screen (${e}).` } });
        await new Promise((r) => setTimeout(r, 3000));
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  } finally { pumping = false; }
}

/** The PC listens for phones that want to watch. */
export function serve() { if (tauri && !android && acct.user()) channel(); }

/** The phone: watch the PC's screen. Calls `on({jpg} | {error})`; returns a stop function. */
export function watch(on) {
  watchers.add(on);
  let t = 0;
  const ask = async () => { const c = await channel(); if (c && ok) c.send({ type: 'broadcast', event: 'want', payload: {} }); t = setTimeout(ask, ok ? 3000 : 700); };
  ask();
  return () => { clearTimeout(t); watchers.delete(on); };
}
