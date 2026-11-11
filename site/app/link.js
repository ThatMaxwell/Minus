// The link between your phone and your PC, through your Minus account (Supabase).
//   the PC   mirrors its agents and their conversations to your account, and acts on what
//            you do on the phone (a message, approve, decline, a choice)
//   the phone shows those live, and writes back what you do. If your PC is off, it can answer
//            from the phone instead; and agents you make on the phone live and work there
// Each row says which device wrote it last, so nobody acts on their own changes.
import { state, agent, on, emit, post, patchMessage, save, updateAgent } from './store.js';
import * as acct from './account.js';

const tauri = window.__TAURI__;
const android = /Android/i.test(navigator.userAgent);
/** 'phone' on the Android app, 'pc' in the desktop app, null otherwise (or signed out). */
export const role = () => (!acct.user() ? null : android ? 'phone' : tauri ? 'pc' : null);
export const isPhone = () => android;
export const linked = () => !!role();

const uuids = new Map(); // agent local id -> row id
const locals = new Map(); // row id -> agent local id
let applying = false, channel = null, ready = false;
const me = () => acct.deviceId();
const db = () => acct.client();

// what of a message goes to the other side (no internal flags)
const body = (m) => { const b = {}; for (const [k, v] of Object.entries(m)) if (!k.startsWith('_')) b[k] = v; return b; };
const snap = (a) => ({ id: a.id, name: a.name, role: a.role || '', color: a.color, outfit: a.outfit || {}, idle: a.idle, voice: a.voice, model: a.model, mood: a.mood, status: a.status, statusText: a.statusText, unread: a.unread || 0 });

/* ───────── the PC: publish, and act on the phone's changes ───────── */
let agentsT = 0;
function publishAgents() {
  clearTimeout(agentsT);
  agentsT = setTimeout(async () => {
    const rows = state.agents.map((a) => ({ local_id: a.id, name: a.name, role: a.role || '', color: a.color, outfit: a.outfit || {}, model: a.model || 'claude', status: a.status || 'idle', status_text: a.statusText || '', snapshot: snap(a) }));
    const { data, error } = await db().from('agents').upsert(rows, { onConflict: 'owner,local_id' }).select('id, local_id');
    if (error) return console.warn('link: agents', error.message);
    for (const r of data) { uuids.set(r.local_id, r.id); locals.set(r.id, r.local_id); }
    flush();
  }, 500);
}
const queue = new Map(); // mid -> row
function publishMessage(aid, m) {
  const mid = m.mid || m.id; if (!mid) return;
  queue.set(mid, { aid, row: { local_id: mid, sender: m.from === 'me' ? 'me' : m.from === 'system' ? 'system' : 'agent', kind: m.kind || null, body: body(m), origin: me() } });
  flush();
}
let flushT = 0;
function flush() {
  clearTimeout(flushT);
  flushT = setTimeout(async () => {
    const rows = [];
    for (const [mid, { aid, row }] of queue) { const id = uuids.get(aid); if (id) { rows.push({ ...row, agent_id: id }); queue.delete(mid); } }
    if (!rows.length) return;
    const { error } = await db().from('messages').upsert(rows, { onConflict: 'owner,local_id' });
    if (error) console.warn('link: messages', error.message);
  }, 250);
}

async function fromPhone(row, isNew) {
  const aid = locals.get(row.agent_id); if (!aid || row.origin === me()) return;
  const b = row.body || {}, mid = row.local_id;
  if (b.answeredOn === 'phone') return; // the phone already answered it (your PC was off)
  const { respond, resolve, choose } = await import('./brain.js');
  const mine = (state.threads[aid] || []).find((m) => (m.mid || m.id) === mid);
  if (isNew && row.sender === 'me' && !mine) {
    post(aid, { ...b, from: 'me', mid, via: 'phone' });
    const { react } = await import('./director.js'); react(aid, 'send');
    respond(aid, b.text || '');
    return;
  }
  if (!mine) return;
  if (mine.kind === 'approval' && mine.state === 'pending' && (b.state === 'approved' || b.state === 'declined')) return resolve(aid, mid, b.state);
  if (mine.choices && !mine.chosen && b.chosen) return choose(aid, mid, b.chosen);
}

/* ───────── the phone: show what the PC has, write back what you do ───────── */
const heard = new Map(); // agent -> when the PC last did something for it
/** After you message a PC agent from the phone: if your PC is off, or doesn't pick it up, say so
 *  (with a way to answer from the phone instead). */
export async function relayed(aid, text) {
  const t0 = Date.now(), you = [...(state.threads[aid] || [])].reverse().find((m) => m.from === 'me');
  const off = (why) => {
    if ((heard.get(aid) || 0) >= t0) return;
    post(aid, { from: 'agent', kind: 'pcoff', why, text, about: you?.mid });
    updateAgent(aid, { statusText: why === 'slow' ? 'Waiting for your PC' : 'Your PC is off' });
  };
  let pc = null;
  try { pc = await acct.lastPC(); } catch { /* offline: treat as unknown */ }
  if (!pc) return off('none');
  if (Date.now() - Date.parse(pc.last_seen) > 150000) return off('off');
  setTimeout(() => off('slow'), 25000);
}

async function load() {
  const { data: rows } = await db().from('agents').select('id, local_id, snapshot, status, status_text').order('created_at');
  const agents = (rows || []).map((r) => { uuids.set(r.local_id, r.id); locals.set(r.id, r.local_id); return fromRow(r); });
  const { data: msgs } = await db().from('messages').select('agent_id, local_id, body, created_at').order('created_at', { ascending: false }).limit(600);
  const threads = {};
  for (const m of (msgs || []).reverse()) { const aid = locals.get(m.agent_id); if (aid) (threads[aid] ||= []).push({ ...m.body, mid: m.local_id, _remote: true }); }
  // agents made on this phone stay, with their chats; the PC's are refreshed
  const own = state.agents.filter((a) => a.home !== 'pc' && !uuids.has(a.id));
  for (const a of own) threads[a.id] = state.threads[a.id] || [];
  state.agents = [...agents, ...own]; state.threads = threads;
  for (const a of agents) state.threads[a.id] ||= [];
  if (state.route.view === 'chat' && !agent(state.route.agent)) state.route.agent = agents[0]?.id;
  save(); emit('agents'); emit('linked', { agents: agents.length });
}
const fromRow = (r) => ({ perms: {}, outfit: {}, ...r.snapshot, id: r.local_id, status: r.status, statusText: r.status_text, home: 'pc' });

function fromPC(table, row, isNew) {
  if (table === 'agents') {
    locals.set(row.id, row.local_id); uuids.set(row.local_id, row.id);
    if (row.status === 'working' || row.status === 'waiting') heard.set(row.local_id, Date.now());
    const a = agent(row.local_id), next = fromRow(row);
    if (a) { Object.assign(a, next); emit('agent', a); } else { state.agents.push(next); state.threads[next.id] ||= []; emit('agents'); }
    return;
  }
  if (row.origin === me()) return;
  const aid = locals.get(row.agent_id); if (!aid) return;
  if (row.body?.from !== 'me') heard.set(aid, Date.now());
  const m = (state.threads[aid] || []).find((x) => (x.mid || x.id) === row.local_id);
  applying = true;
  try {
    if (m) patchMessage(aid, row.local_id, row.body);
    else post(aid, { ...row.body, mid: row.local_id, _remote: true });
  } finally { applying = false; }
}

/* ───────── start ───────── */
export async function start() {
  const go = async () => {
    const r = role(); if (!r || ready) return;
    ready = true;
    if (r === 'phone') await load();
    else {
      const { data } = await db().from('agents').select('id, local_id');
      for (const x of data || []) { uuids.set(x.local_id, x.id); locals.set(x.id, x.local_id); }
      publishAgents();
      // the phone gets some history to start with
      for (const a of state.agents) for (const m of (state.threads[a.id] || []).slice(-30)) publishMessage(a.id, m);
      // tell the phone this PC is on, and keep telling it
      acct.heartbeat().catch(() => {});
      setInterval(() => acct.heartbeat().catch(() => {}), 60000);
      // what you sent from the phone while this PC was off (the last day of it)
      const since = new Date(Date.now() - 864e5).toISOString();
      const { data: missed } = await db().from('messages').select('agent_id, local_id, body, sender, origin, created_at').eq('sender', 'me').neq('origin', me()).gte('created_at', since).order('created_at');
      for (const row of missed || []) await fromPhone(row, true);
    }
    channel = db().channel('minus-link')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => { if (!p.new?.local_id) return; r === 'pc' ? fromPhone(p.new, p.eventType === 'INSERT') : fromPC('messages', p.new, p.eventType === 'INSERT'); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, (p) => { if (r === 'phone' && p.new?.local_id) fromPC('agents', p.new); })
      .subscribe();
  };
  on('account', () => { if (!acct.user() && channel) { db()?.removeChannel(channel); channel = null; ready = false; } go(); });
  go();
  // what changes here goes to the other side
  on('*', (ev, data) => {
    const r = ready && role(); if (!r || applying) return;
    if (r === 'pc') {
      if (ev === 'agent' || ev === 'agents') publishAgents();
      if (ev === 'message' || ev === 'message:update') { publishMessage(data.agent, data.msg); if (ev === 'message') publishAgents(); }
    } else if (ev === 'message' || ev === 'message:update') {
      // the phone only writes what you did (your messages and your decisions), to your PC's agents
      if (agent(data.agent)?.home !== 'pc') return;
      const m = data.msg;
      if (m.from === 'me' || m.kind === 'approval' || m.choices || m.kind === 'question') publishMessage(data.agent, m);
    }
  });
}
