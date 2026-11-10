// The time saved meter: roughly how long the work your agents did would have taken you by
// hand, counted from each step they take. An estimate, and it says so.
import { state, on, emit, save, APP } from './store.js';

const day = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA');

/** About how long a step takes a person, in seconds. */
export function secondsFor(step) {
  const s = String(step).toLowerCase();
  const typed = s.match(/type\s+“([^”]*)”/)?.[1];
  if (typed != null) return 4 + typed.length * 0.35;
  const n = +(s.match(/\b(\d{1,4})\b/)?.[1] || 0);
  if (/^(click|double-click|right-click|press|select|toggle)\b/.test(s)) return 3;
  if (/\b(read|check|match|compare|skip|review|answer)\b/.test(s)) return 20 + Math.min(n, 300) * 4;
  if (/\b(add|write|draft|fill|update|file|send|reply)\b/.test(s)) return 40 + Math.min(n, 300) * 25;
  if (/\b(open|go to|start|search|download|find)\b/.test(s)) return 15 + Math.min(n, 100) * 6;
  return 30;
}

const S = () => (state.saved ||= APP ? { days: {}, agents: {} } : seed());
// the example agents have been at it for a week
function seed() {
  const d = {}, mins = [52, 75, 38, 96, 61, 44];
  mins.forEach((m, i) => (d[day(Date.now() - (6 - i) * 864e5)] = m * 60));
  return { days: d, agents: {} };
}

export function add(aid, secs) {
  if (!(secs > 0)) return;
  const s = S(), k = day();
  s.days[k] = (s.days[k] || 0) + secs;
  s.agents[aid] = (s.agents[aid] || 0) + secs;
  for (const key of Object.keys(s.days)) if (Date.now() - new Date(key).getTime() > 35 * 864e5) delete s.days[key];
  save(); emit('saved', { agent: aid, secs });
}

/** Seconds saved per day for the last 7 days (oldest first), and their total. */
export function week() {
  const s = S(), days = [];
  for (let i = 6; i >= 0; i--) { const k = day(Date.now() - i * 864e5); days.push({ day: k, secs: s.days[k] || 0 }); }
  return { days, total: days.reduce((n, d) => n + d.secs, 0) };
}
export const yesterday = () => S().days[day(Date.now() - 864e5)] || 0;
export const fmt = (secs) => { const m = Math.round(secs / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`; };

// every step an agent finishes counts (the live steps cards, real or preview)
const seen = new Map(); // card -> steps already counted
export function startMeter() {
  // a new card starts from where it is; cards from before this session aren't counted again
  on('message', ({ msg }) => { if (msg.kind === 'steps') seen.set(msg.mid || msg.id, msg.done || 0); });
  on('message:update', ({ agent: aid, msg }) => {
    if (msg.kind !== 'steps') return;
    const k = msg.mid || msg.id, before = seen.get(k) ?? null, done = msg.done || 0;
    if (before === null) { seen.set(k, done); return; }
    if (done > before) { add(aid, (msg.steps || []).slice(-(done - before)).reduce((n, s) => n + secondsFor(s), 0)); seen.set(k, done); }
  });
  // approved sends and posts: the writing they did counts too
  on('message:update', ({ agent: aid, msg }) => { if (msg.kind === 'approval' && msg.state === 'approved' && !msg._counted) { msg._counted = true; add(aid, 120 + (msg.preview?.length || 0) * 30); } });
}
