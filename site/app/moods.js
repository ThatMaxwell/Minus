// Agent moods: how each agent feels drifts with its day. A run of finished jobs makes it
// proud, a "no" makes it a little sad for a while, problems make it worried, a "thanks"
// makes its day, and long quiet stretches make it sleepy. The mood is how it rests between
// moments, so you can read the team at a glance. Its own face codes still win while it works.
import { state, agent, on, updateAgent } from './store.js';
import { mascotsOf } from './ui.js';

const MIN = 60e3;
const PRAISE = /\b(thanks|thank you|thx|ty|good job|great job|well done|nice work|nice one|awesome|amazing|love it|perfect|brilliant|you rock|obrigad[oa]|valeu)\b/i;

export function record(aid, kind) {
  const a = agent(aid); if (!a) return;
  a.moodLog = [...(a.moodLog || []).filter((e) => Date.now() - e.t < 6 * 60 * MIN), { t: Date.now(), kind }].slice(-24);
  apply(a);
}

/** What it feels now, from what happened to it lately. */
export function moodOf(a) {
  const log = a.moodLog || [], ago = (k) => { const e = [...log].reverse().find((x) => x.kind === k); return e ? Date.now() - e.t : Infinity; };
  if (a.status === 'off') return 'sleepy';
  if (ago('praise') < 20 * MIN) return 'happy';
  if (ago('declined') < 10 * MIN) return 'sad';
  if (ago('error') < 15 * MIN) return 'worried';
  if (log.filter((e) => e.kind === 'done' && Date.now() - e.t < 3 * 60 * MIN).length >= 3) return 'proud';
  if (ago('done') < 15 * MIN) return 'happy';
  const lastTalk = Math.max(0, ...(state.threads[a.id] || []).map((m) => m.at || 0), ...log.map((e) => e.t));
  if (a.status !== 'working' && a.status !== 'waiting' && Date.now() - lastTalk > 4 * 60 * MIN) return 'sleepy';
  return 'neutral';
}
export const WORDS = { happy: 'happy', sad: 'a bit down', worried: 'worried', proud: 'proud', sleepy: 'sleepy', neutral: '' };

function apply(a) {
  const mood = moodOf(a);
  if (a.mood !== mood) updateAgent(a.id, { mood });
  for (const m of mascotsOf(a.id)) {
    const was = m.rest; m.rest = mood;
    // only change the face if it was resting (not mid-reaction)
    if (m.emotion === was || m.emotion === 'neutral') m.setEmotion(mood);
  }
}

export function startMoods() {
  on('message', ({ agent: aid, msg }) => {
    if (msg.from === 'me' && PRAISE.test(msg.text || '')) {
      record(aid, 'praise');
      setTimeout(() => mascotsOf(aid).forEach((m) => { m.setEmotion('happy'); m.gesture('celebrate'); }), 350);
    }
    if (msg.kind === 'problem') record(aid, 'error');
  });
  on('message:update', ({ agent: aid, msg }) => {
    if (msg.kind === 'approval' && msg.state === 'declined' && !msg._moodSeen) { msg._moodSeen = true; record(aid, 'declined'); }
    if (msg.kind === 'steps' && !msg.live && /^Done/.test(msg.title || '') && !msg._moodSeen) { msg._moodSeen = true; record(aid, 'done'); }
  });
  // quiet stretches: check everyone now and then
  const tick = () => state.agents.forEach(apply);
  setInterval(tick, 2 * MIN);
  setTimeout(tick, 1500);
  // back after a while away: they're glad to see you
  const last = +localStorage.getItem('minus.lastOpen') || 0;
  try { localStorage.setItem('minus.lastOpen', String(Date.now())); } catch {}
  if (last && Date.now() - last > 10 * 60 * MIN) setTimeout(() => state.agents.forEach((a) => mascotsOf(a.id).forEach((m) => { m.setEmotion('excited'); m.gesture('celebrate'); })), 1200);
}
