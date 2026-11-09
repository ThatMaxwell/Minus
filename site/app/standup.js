// The morning stand-up: once a day your agents line up and each one tells you, in a few
// words and in its own voice, what it did, what it's doing today and what it needs from you.
// Built from what actually happened (their messages, jobs, routines and requests), so it
// costs nothing to run and never makes things up.
import { state, emit, save } from './store.js';

const H = 3600e3;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const today = () => new Date().toLocaleDateString('en-CA');

/** Time of day it happens, "09:00" (Settings can change it or turn it off). */
export const at = () => state.settings.standupAt || '09:00';
export const enabled = () => state.settings.standup !== false;

/** True once it's past stand-up time today and you haven't had it (or put it off). */
export function due() {
  if (!enabled()) return false;
  const s = state.settings, [h, m] = at().split(':').map(Number), n = new Date();
  return s.standupDone !== today() && s.standupLater !== today() && n.getHours() * 60 + n.getMinutes() >= h * 60 + m;
}
export function done() { state.settings.standupDone = today(); save(); emit('standup'); }
export function later() { state.settings.standupLater = today(); save(); emit('standup'); }

const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMins = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// the meaningful sentences of a message ("On it." and "Got it." don't count)
const sentences = (t) => (t.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);

function routinesToday(aid) {
  const d = DAYS[new Date().getDay()];
  return state.routines.filter((r) => r.agent === aid && r.on && (/^today\b/i.test(r.next) || r.next.startsWith(d) || /every day|every weekday/i.test(r.when)))
    .map((r) => {
      // the next time it runs today, if it hasn't already ("Every weekday at 8:00 and 16:00")
      const times = [...(r.next.match(/\d{1,2}:\d{2}/g) || []), ...(r.when.match(/\d{1,2}:\d{2}/g) || [])];
      return { name: r.name, time: times.length ? times.find((x) => mins(x) > nowMins()) ?? null : '' };
    })
    .filter((r) => r.time !== null);
}

/** One agent's stand-up: what it did, what's on today, what it needs, and how it says it. */
export function brief(a) {
  const t = state.threads[a.id] || [], since = Date.now() - 30 * H;
  const recent = t.filter((m) => (m.at || 0) >= since);
  const said = [...recent].reverse().find((m) => m.from === 'agent' && !m.kind && m.text && sentences(m.text).length);
  const live = [...t].reverse().find((m) => m.kind === 'steps' && m.live);
  const did = [], today_ = [], needs = [];

  const needsYou = (s) => /\bneeds? (you|your)\b/i.test(s);
  if (said) did.push(...sentences(said.text).filter((s) => !needsYou(s)).slice(0, 2));
  for (const m of recent) if (m.kind === 'steps' && !m.live && /^Done/.test(m.title || '')) did.push(`${m.title.replace(/^Done on .*/, 'Finished a job on its computer')}${m.done ? ` (${m.done} steps)` : ''}`);
  for (const n of a.notebook || []) if (n.by !== 'you' && n.at >= since) did.push(`Learned: ${n.text}`);
  for (const s of a.skills || []) if ((s.at || 0) >= since) did.push(`Learned a new skill: ${s.name}`);

  if (a.status === 'off') today_.push(a.statusText || 'Off today');
  else {
    if (live) today_.push(`${a.statusText || 'Working'}${live.total ? ` · ${live.done} of ${live.total}` : ''}`);
    else if (a.status === 'working' && a.statusText) today_.push(a.statusText);
    for (const r of routinesToday(a.id)) today_.push(`${r.name}${r.time ? ` at ${r.time}` : ''}`);
  }

  for (const m of t) if (m.kind === 'approval' && m.state === 'pending') needs.push({ kind: 'approval', mid: m.mid || m.id, title: m.action, detail: m.detail });
  const last = t[t.length - 1];
  if (last?.from === 'agent' && last.kind === 'question' && !last.answered) needs.push({ kind: 'question', mid: last.mid || last.id, title: last.text });
  if (last?.from === 'agent' && last.choices && !last.chosen) needs.push({ kind: 'choice', mid: last.mid || last.id, title: last.text, choices: last.choices });
  const mention = said && sentences(said.text).find(needsYou);
  if (mention && !needs.length) needs.push({ kind: 'chat', title: mention });

  // what it says out loud
  const say = [];
  if (a.status === 'off') say.push(`I’m ${lower(a.statusText || 'off today')}.`);
  else {
    const told = said ? sentences(said.text).filter((s) => !needsYou(s)).slice(0, 2) : [];
    say.push(told.length ? told.join(' ') : did.length ? did[0].replace(/^Learned: /, 'I learned that ').replace(/^Learned a new skill: /, 'I learned a new skill: ') + (/[.!?]$/.test(did[0]) ? '' : '.') : 'Quiet one yesterday, nothing to report.');
    const busy = live || (a.status === 'working' && a.statusText);
    if (busy) say.push(`Right now I’m ${lower(a.statusText || 'working')}${live?.total ? `, ${live.done} of ${live.total} done` : ''}.`);
    const rs = routinesToday(a.id);
    if (rs.length) say.push(`Later today: ${rs.map((r) => lower(r.name) + (r.time ? ` at ${r.time}` : '')).join(' and ')}.`);
    else if (!busy) say.push('Nothing on my list today, so I’m free for a job.');
    const n = needs[0];
    if (n?.kind === 'approval') say.push(`I need your OK to ${lower(n.title)}.`);
    else if (n?.kind === 'question' || n?.kind === 'choice') say.push('And I have a question for you.');
    else if (mention) say.push(mention);
    else say.push('Nothing needs you.');
  }
  const speech = (a.status === 'off' ? '' : 'Morning! ') + say.join(' ').replace(/\s+/g, ' ').trim();
  return { agent: a, did, today: today_, needs, speech, off: a.status === 'off' };
}

/** Everyone's, in the order they speak: who needs you first, then who's busy, then the rest. */
export function round() {
  const all = state.agents.map(brief);
  const rank = (b) => (b.off ? 3 : b.needs.length ? 0 : b.agent.status === 'working' ? 1 : 2);
  return { speaking: all.filter((b) => !b.off).sort((x, y) => rank(x) - rank(y)), away: all.filter((b) => b.off) };
}
