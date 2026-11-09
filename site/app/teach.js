// "Show me once": you do a job while your agent watches, and the steps become a skill it can
// do again by itself, with new names, emails or numbers each time.
//   desktop app  -> Minus Hands records what you do in any app (by meaning, not by mouse
//                   position, so replay survives moved windows and small redesigns)
//   web preview  -> a practice app to show it in
// While it watches, the dock turns into a little recorder with each step and a Done button.
import { agent, updateAgent, emit, id, post, patchMessage } from './store.js';
import { $, $$, esc, icon, sheet, toast, motion, IN } from './ui.js';
import { react, feel } from './director.js';
import * as practice from './practice.js';

const tauri = window.__TAURI__;
let session = null; // { agent, steps, poll, stopRec }

/* ───────── steps in plain words (the same as the recorder's, in crates/hands/src/teach.rs) ───────── */
const nameOf = (t) => (t.name?.trim() ? `“${t.name.trim()}”` : t.role);
const isSecret = (v) => /\{\{\s*password\s*\}\}/.test(v);
export function describe(s, value = s.value) {
  if (s.kind === 'click') return `${s.double ? 'Double-click' : s.button === 'right' ? 'Right-click' : 'Click'} ${nameOf(s.target)}`;
  if (s.kind === 'fill') return isSecret(s.value) ? `Type your password in ${nameOf(s.target)}` : `Type “${value}” in ${nameOf(s.target)}`;
  if (s.kind === 'key') return `Press ${s.keys.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  return '';
}
export function inputsOf(steps) {
  const out = [];
  for (const s of steps) if (s.kind === 'fill') for (const m of s.value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
export const fillIn = (v, inputs) => v.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => inputs[k] ?? '');
const skills = (a) => (a.skills ||= []);
export const watching = () => session && { agent: session.agent, steps: session.steps };

/* ───────── watching ───────── */
export async function start(aid) {
  const a = agent(aid); if (!a || session) return;
  session = { agent: aid, steps: [] };
  const changed = () => emit('teach', watching());
  if (tauri) {
    try { await tauri.core.invoke('teach_start'); }
    catch (e) { session = null; toast(String(e?.message || e).replace(/^.*?supported yet/, 'Show me once needs Windows for now'), { icon: 'eye' }); return; }
    session.poll = setInterval(async () => {
      const s = await tauri.core.invoke('teach_steps').catch(() => null);
      if (s && session && s.length !== session.steps.length) { session.steps = s; changed(); }
    }, 400);
  } else {
    practice.open();
    session.stopRec = practice.record((s) => { session.steps.push(s); changed(); feel(aid, 'curious', 1400); });
  }
  updateAgent(aid, { status: 'watching', statusText: 'Watching you' });
  react(aid, 'listening');
  feel(aid, 'listening', 60000);
  changed();
  toast(tauri ? `${a.name} is watching. Do the job once, then press Done in the island.` : `${a.name} is watching. Do the job once in the practice app, then press Done.`, { icon: 'eye' });
}

export async function finish(save = true) {
  if (!session) return;
  const s = session; session = null;
  clearInterval(s.poll); s.stopRec?.();
  let steps = s.steps;
  if (tauri) steps = (await tauri.core.invoke('teach_stop').catch(() => null)) || steps;
  emit('teach', null);
  updateAgent(s.agent, { status: 'idle', statusText: 'Ready' });
  if (!tauri) practice.close();
  if (!save) { react(s.agent, 'calm'); return; }
  if (!steps.length) { toast('Nothing to learn yet: no steps were recorded.', { icon: 'eye' }); react(s.agent, 'confused'); return; }
  saveSheet(s.agent, steps);
}

/* ───────── saving: name it, and say which parts change each time ───────── */
function guessInput(t) { return (t.name || t.role || 'value').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '_') || 'value'; }

function saveSheet(aid, recorded) {
  const a = agent(aid);
  // each typed value can stay the same every time, or become an input you give each run
  const rows = recorded.map((s) => ({ s, keep: true, input: s.kind === 'fill' && !isSecret(s.value) && s.value.trim() ? guessInput(s.target) : null, vary: s.kind === 'fill' && !isSecret(s.value) && !!s.value.trim() }));
  const html = () => rows.map((r, i) => {
    const s = r.s;
    let body;
    if (s.kind === 'fill' && isSecret(s.value)) body = `Type your password in ${esc(nameOf(s.target))} <span class="sk-lock" data-tip="Asked each time it runs, never saved">${icon('key')}asked each time</span>`;
    else if (s.kind === 'fill' && r.vary) body = `Type <span class="sk-var on"><button type="button" data-vary="${i}" aria-label="Keep “${esc(s.value)}” every time" data-tip="Changes each time. Click to keep “${esc(s.value)}” every time">${icon('bolt')}</button><input value="${esc(r.input)}" aria-label="Name of this input" data-tip="What it’s called when you ask" size="${Math.max(4, r.input.length)}"></span> in ${esc(nameOf(s.target))}`;
    else if (s.kind === 'fill') body = `Type <button type="button" class="sk-var" data-vary="${i}" data-tip="The same every time. Click to make it change each run">“${esc(s.value)}”</button> in ${esc(nameOf(s.target))}`;
    else body = esc(describe(s));
    return `<li class="${r.keep ? '' : 'off'}" data-i="${i}"><span class="sk-n">${i + 1}</span><span class="sk-t">${body}</span><button type="button" class="sk-drop" data-drop="${i}" aria-label="${r.keep ? 'Leave this step out' : 'Put this step back'}" data-tip="${r.keep ? 'Leave this step out' : 'Put it back'}">${icon(r.keep ? 'x' : 'plus')}</button></li>`;
  }).join('');
  const first = recorded.find((s) => s.target?.window || s.window);
  const where = (first?.target?.window || first?.window || '').replace(/\s[-–—]\s(Google Chrome|Microsoft Edge|Mozilla Firefox|Brave)$/, '');
  const sh = sheet(`<form class="mini-form skill-save">
      <div class="sk-head"><span class="sk-badge">${icon('eye')}</span><div><h3>What should ${esc(a.name)} call this?</h3><p class="muted small">${recorded.length} step${recorded.length === 1 ? '' : 's'}${where ? ` in ${esc(where)}` : ''}. ${esc(a.name)} can do it again whenever you ask.</p></div></div>
      <input class="field" name="n" placeholder="e.g. Add a lead to the CRM" maxlength="60" aria-label="Skill name" required>
      <p class="sk-help">Words that should change each time it runs are inputs, marked ${icon('bolt')}. Click a value to switch.</p>
      <ol class="sk-steps">${html()}</ol>
      <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Throw away</button><button class="btn btn-primary btn-sm">Teach ${esc(a.name)}</button></div>
    </form>`, { cls: 'skill-sheet' });
  const f = $('form', sh.el), list = $('.sk-steps', sh.el);
  const M = motion();
  M.animate($$('.sk-steps li', sh.el), { opacity: [0, 1], x: [-8, 0] }, { delay: M.stagger(0.04, { start: 0.12 }), duration: 0.35, ease: IN });
  setTimeout(() => $('[name=n]', sh.el).focus(), 60);
  const redraw = () => { list.innerHTML = html(); };
  list.addEventListener('input', (e) => { const li = e.target.closest('li'); if (li && e.target.matches('input')) { rows[li.dataset.i].input = e.target.value.replace(/[{}]/g, ''); e.target.size = Math.max(4, e.target.value.length); } });
  list.addEventListener('click', (e) => {
    const d = e.target.closest('[data-drop]'); if (d) { rows[d.dataset.drop].keep = !rows[d.dataset.drop].keep; return redraw(); }
    const v = e.target.closest('[data-vary]');
    if (v) { const r = rows[v.dataset.vary]; r.vary = !r.vary; redraw(); if (r.vary) $(`[data-i="${v.dataset.vary}"] .sk-var input`, list)?.select(); }
  });
  $('[data-x]', sh.el).onclick = () => { sh.close(); react(aid, 'sad'); };
  f.onsubmit = (e) => {
    e.preventDefault();
    const name = $('[name=n]', sh.el).value.trim(); if (!name) return;
    const steps = rows.filter((r) => r.keep).map((r) => (r.s.kind === 'fill' && r.vary && r.input?.trim() ? { ...r.s, value: `{{${r.input.trim()}}}` } : r.s));
    if (!steps.length) return toast('Keep at least one step.', { icon: 'eye' });
    const sk = { id: id('skill'), name, about: '', steps, at: Date.now() };
    skills(a).unshift(sk);
    updateAgent(aid, { skills: a.skills });
    sh.close();
    learned(aid, sk);
  };
}

function learned(aid, sk) {
  const a = agent(aid), ins = inputsOf(sk.steps);
  post(aid, { from: 'agent', kind: 'skill', skill: sk.id, name: sk.name, count: sk.steps.length, inputs: ins });
  post(aid, { from: 'agent', text: ins.length ? `Got it. Next time just ask me to ${sk.name.charAt(0).toLowerCase() + sk.name.slice(1)}, and tell me the ${list(ins)}.` : `Got it. Ask me to ${sk.name.charAt(0).toLowerCase() + sk.name.slice(1)} any time and I’ll do it the way you just did.` });
  emit('skill', { agent: aid, skill: sk });
  react(aid, 'done');
  feel(aid, 'proud', 3000);
}
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]).replace(/_/g, ' ');

export function remove(aid, sid) {
  const a = agent(aid); a.skills = skills(a).filter((s) => s.id !== sid);
  updateAgent(aid, { skills: a.skills });
}

/* ───────── running a skill ───────── */
/** Asks for the skill's inputs (if it has any), then runs it. */
export function run(aid, sid, given = {}) {
  const a = agent(aid), sk = skills(a).find((s) => s.id === sid); if (!sk) return;
  const need = inputsOf(sk.steps).filter((k) => !given[k]);
  if (!need.length) return play(aid, sk, given);
  const sh = sheet(`<form class="mini-form skill-run">
      <h3>${icon('play')}${esc(sk.name)}</h3>
      <p class="muted small">${esc(a.name)} does it the way you showed it. What’s different this time?</p>
      ${need.map((k, i) => `<label class="sk-in"><span>${esc(k.replace(/_/g, ' '))}</span><input class="field" name="${esc(k)}" ${k === 'password' ? 'type="password" autocomplete="off"' : ''} ${i === 0 ? 'autofocus' : ''} required>${k === 'password' ? '<em>Used for this run only, never saved.</em>' : ''}</label>`).join('')}
      <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Run it</button></div>
    </form>`, { cls: 'small' });
  setTimeout(() => $('input', sh.el)?.focus(), 60);
  $('[data-x]', sh.el).onclick = sh.close;
  $('form', sh.el).onsubmit = (e) => {
    e.preventDefault();
    const v = { ...given }; for (const k of need) v[k] = sh.el.querySelector(`[name="${CSS.escape(k)}"]`).value;
    sh.close(); play(aid, sk, v);
  };
}

const stopped = new Set();
export const busy = new Set(); // agents replaying a skill in the preview
export const stop = (aid) => { stopped.add(aid); tauri?.core.invoke('agent_stop', { agent: aid }); };

async function play(aid, sk, inputs) {
  const a = agent(aid);
  if (a.status === 'working') return toast(`${a.name} is busy. Try again when it’s done.`, { icon: 'clock' });
  if (tauri) {
    pendingRun.set(aid, sk);
    try { await tauri.core.invoke('skill_run', { agent: aid, skill: { id: sk.id, name: sk.name, about: sk.about || '', steps: sk.steps }, inputs }); }
    catch (e) { pendingRun.delete(aid); post(aid, { from: 'agent', kind: 'problem', text: String(e?.message || e) }); react(aid, 'confused'); }
    return;
  }
  // the preview: the practice app, with the agent's cursor
  stopped.delete(aid); busy.add(aid);
  const m = post(aid, { from: 'agent', kind: 'steps', title: `Doing “${sk.name}”`, live: true, total: sk.steps.length, done: 0, steps: [], skill: true });
  updateAgent(aid, { status: 'working', statusText: describe(sk.steps[0], fillIn(sk.steps[0].value || '', inputs)) });
  emit('work', { agent: aid, on: true });
  react(aid, 'working');
  const done = [];
  try {
    await practice.replay(sk.steps, (v) => fillIn(v, inputs), {
      name: a.name, color: a.color, stopped: () => stopped.has(aid),
      onStep: (i, s) => {
        const t = s.kind === 'fill' && isSecret(s.value) ? describe(s) : describe(s, fillIn(s.value || '', inputs));
        done.push(t);
        patchMessage(aid, m.mid, { steps: done.slice(-5), done: i + 1 });
        updateAgent(aid, { statusText: t });
        react(aid, 'step');
      },
    });
    patchMessage(aid, m.mid, { live: false, title: `Done: “${sk.name}”` });
    post(aid, { from: 'agent', text: `Done, the way you showed me. ${sk.steps.length} steps.` });
    updateAgent(aid, { status: 'done', statusText: `Finished: ${sk.name.toLowerCase()}` });
    react(aid, 'done');
  } catch (e) {
    patchMessage(aid, m.mid, { live: false, title: e.message === 'stopped' ? 'Stopped' : 'Stopped by a problem' });
    if (e.message !== 'stopped') post(aid, { from: 'agent', kind: 'problem', text: `Step ${done.length} didn’t work: ${e.message}. The steps before it are done.` });
    updateAgent(aid, { status: 'idle', statusText: 'Ready' });
    react(aid, e.message === 'stopped' ? 'calm' : 'worried');
  } finally {
    busy.delete(aid);
    emit('work', { agent: aid, on: false });
    setTimeout(() => practice.close(), 1600);
  }
}

// desktop runs report through the runtime's events; this names their card
export const pendingRun = new Map();

/** Finds a skill that fits a request, for the demo brain ("add Leo from Initech to the CRM"). */
export function match(a, text) {
  const words = (s) => (s.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'new'].includes(w)).map((w) => w.replace(/s$/, ''));
  const t = new Set(words(text));
  let best = null, score = 0;
  for (const sk of skills(a)) { const n = words(sk.name).filter((w) => t.has(w)).length; if (n > score) { best = sk; score = n; } }
  return score >= 2 ? best : null;
}
