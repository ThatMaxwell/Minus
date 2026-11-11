// A stand-in for the agent runtime: replies, runs work in steps on its computer, and
// asks for approval before anything it can't undo. The desktop app swaps this for the
// real runtime; the messages it posts have the same shapes.
import { state, agent, computer, post, patchMessage, updateAgent, emit, id, save, APP } from './store.js';
import { react } from './director.js';
import * as rt from './runtime.js';
import * as nb from './notebook.js';
import * as teach from './teach.js';
import * as link from './link.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = new Set();

// Questions that need a typed answer. Whatever you say next (in the chat or the dock) answers it.
const waiting = new Map(); // agent -> { mid, resolve }
function question(aid, text, placeholder) {
  const m = post(aid, { from: 'agent', kind: 'question', text, placeholder });
  updateAgent(aid, { status: 'waiting', statusText: 'Needs an answer' });
  react(aid, 'ask');
  return new Promise((resolve) => waiting.set(aid, { mid: m.mid, resolve }));
}
function answer(aid, text) {
  const w = waiting.get(aid); if (!w) return false;
  waiting.delete(aid);
  patchMessage(aid, w.mid, { answered: text });
  w.resolve(text);
  return true;
}

const RISKY = /\b(send|email|mail|reply|post|tweet|publish|buy|pay|order|book|delete|remove|cancel|transfer|invite)\b/i;
const TASK = /\b(add|find|research|fill|update|import|check|look|search|collect|match|compare|summari[sz]e|list|clean|organi[sz]e|reproduce|test|fix|plan|schedule|draft|write|make|create|build|open|go)\b/i;

const plan = (text) => {
  const t = text.toLowerCase();
  if (/crm|lead/.test(t)) return ['Open the browser', 'Go to crm.acme.example', 'Open the import sheet', 'Read 42 rows', 'Skip 6 that already exist', 'Add 36 leads', 'Check for duplicates'];
  if (/receipt|expense|invoice/.test(t)) return ['Open the finance inbox', 'Download 18 receipts', 'Match them to card charges', 'Flag 2 without a match', 'Update the spreadsheet'];
  if (/bug|crash|error|test|reproduce/.test(t)) return ['Start a clean browser profile', 'Follow the steps in the report', 'Reproduce the problem', 'Record the screen', 'Write up the steps'];
  if (/flight|hotel|trip|travel|room|meeting/.test(t)) return ['Check the calendar', 'Search for options', 'Compare prices and times', 'Pick the best two', 'Hold them for you'];
  return ['Open the browser', 'Search for what you asked', 'Read the top results', 'Take notes', 'Put it together'];
};

export async function respond(aid, text, { here = false } = {}) {
  const a = agent(aid); if (!a) return;
  if (answer(aid, text.trim())) return;
  // on the phone, a message to one of your PC's agents goes to the PC (link.js), unless you
  // asked the phone to answer it; agents made on the phone work right here
  if (!here && link.isPhone() && link.linked() && a.home === 'pc') return link.relayed(aid, text);
  // the real runtime, when this agent's AI is connected (desktop app)
  if (rt.answer(aid, text.trim())) return;
  if (rt.ready(a)) {
    // remember which of your messages were jobs, so Rewind knows where each one starts
    const mine = [...(state.threads[aid] || [])].reverse().find((m) => m.from === 'me');
    if (mine) mine.job = true;
    return rt.run(aid, text);
  }
  // the app never pretends: without an AI the agent says so, and picks up once you connect one
  if (APP) return needsAI(aid, text);
  if (busy.has(aid)) return;
  busy.add(aid);
  const prevStatus = a.status;
  updateAgent(aid, { status: 'working', statusText: 'Thinking…' });
  react(aid, 'thinking');
  emit('typing', { agent: aid, on: true });
  await wait(900 + Math.random() * 700);
  emit('typing', { agent: aid, on: false });
  busy.delete(aid);

  const t = text.trim();
  // "remember …" goes in its notebook
  const mem = t.match(/^(?:please\s+)?(?:remember|note|keep in mind)(?: that)?[:,]?\s+(.+)/i);
  if (mem) {
    const fact = mem[1].replace(/^\w/, (c) => c.toUpperCase()).replace(/([^.!?])$/, '$1.');
    nb.add(aid, fact, 'agent');
    post(aid, { from: 'agent', text: 'Got it, it’s in my notebook. I’ll keep it in mind on every job.' });
    updateAgent(aid, { status: prevStatus === 'working' ? 'working' : 'idle', statusText: 'Ready' });
    react(aid, 'proud');
    return;
  }
  // a thank-you makes its day (moods.js shows it on its face)
  if (/\b(thanks|thank you|thx|good job|great job|well done|nice work|awesome|amazing|love it|perfect|obrigad[oa]|valeu)\b/i.test(t) && t.split(/\s+/).length <= 8) {
    const lines = ['Anytime. That made my day.', 'Thank you! Happy to help.', 'Glad it helped. I’m here when you need me.', 'Aw, thanks. On to the next one whenever you are.'];
    post(aid, { from: 'agent', text: lines[Math.floor(Math.random() * lines.length)] });
    updateAgent(aid, { status: prevStatus === 'working' ? 'working' : 'idle', statusText: 'Ready' });
    return;
  }
  if (/^(hi|hey|hello|yo|sup|hola)\b/i.test(t)) {
    post(aid, { from: 'agent', text: `Hi! I’m ${a.name}. ${a.instructions ? 'I’m set up to: ' + a.instructions : 'Give me a job and I’ll get going.'} What should I start with?` });
    updateAgent(aid, { status: prevStatus === 'working' ? 'idle' : prevStatus, statusText: 'Ready' });
    react(aid, 'hello');
    return;
  }
  // "ask Ledger to file the bank statement": it's a teammate's job, so it hands it over
  const ho = t.match(/\b(?:ask|tell|get)\s+(\w+)\s+to\s+(.+)/i) || t.match(/\b(?:hand|pass|give|send)\s+(?:this|it|that)\s+(?:over\s+)?to\s+(\w+)[,:]?\s*(.*)/i);
  const mate = ho && state.agents.find((x) => x.name.toLowerCase() === ho[1].toLowerCase() && x.id !== aid);
  if (mate) {
    const job = (ho[2] || t).replace(/[.!]+$/, '').replace(/^\w/, (c) => c.toUpperCase());
    post(aid, { from: 'agent', text: `That’s ${mate.name}’s kind of job, so I’m handing it over with everything they need.` });
    updateAgent(aid, { status: prevStatus === 'working' ? 'working' : 'idle', statusText: 'Ready' });
    setTimeout(() => emit('handoff', { from: aid, to: mate.name, job }), 500);
    return;
  }
  // a job it was shown once: it does it that way, with this time's details
  const sk = teach.match(a, t);
  if (sk && (!teach.inputsOf(sk.steps).length || Object.keys(detailsFor(sk, t)).length)) return useSkill(aid, sk, t, prevStatus);
  if (RISKY.test(t)) return ask(aid, t);
  if (TASK.test(t)) return work(aid, t);
  if (/\?$/.test(t)) {
    post(aid, { from: 'agent', text: 'Good question. I’d check it on my computer instead of guessing. Want me to look it up now?', choices: ['Look it up', 'Not now'] });
    updateAgent(aid, { status: 'idle', statusText: 'Ready' }); react(aid, 'reply');
    return;
  }
  post(aid, { from: 'agent', text: 'Got it. Should I start now, or save it as a routine that runs on its own?', choices: ['Start now', 'Save as routine'], about: t });
  updateAgent(aid, { status: 'idle', statusText: 'Ready' }); react(aid, 'reply');
}

// Picks this time's details out of the request: "add Leo Park from Initech, leo@initech.example"
function detailsFor(sk, text) {
  const got = {};
  for (const k of teach.inputsOf(sk.steps)) {
    let v = null;
    if (/mail/.test(k)) v = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
    else if (/company|org|business/.test(k)) v = text.match(/\b(?:from|at|of)\s+([A-Z][\w&.-]*(?:\s[A-Z][\w&.-]*)?)/)?.[1];
    else if (/name/.test(k)) v = text.match(/\b(?:[Aa]dd|[Ff]or|[Nn]ew lead)\s+([A-Z][\w'-]*(?:\s[A-Z][\w'-]*)?)/)?.[1];
    if (v) got[k] = v.replace(/[.,]$/, '');
  }
  return got;
}
async function useSkill(aid, sk, text, prevStatus) {
  const got = detailsFor(sk, text);
  post(aid, { from: 'agent', text: `I know this one. You showed me how to ${sk.name.charAt(0).toLowerCase() + sk.name.slice(1)}, so I’ll do it the same way${Object.keys(got).length ? ` with ${Object.values(got).join(', ')}` : ''}.` });
  updateAgent(aid, { status: prevStatus === 'working' ? 'working' : 'idle', statusText: 'Ready' });
  react(aid, 'yes');
  await wait(700);
  teach.run(aid, sk.id, got);
}

const waitingForAI = new Map(); // agent -> what you asked, to send once an AI is connected
function needsAI(aid, text) {
  const a = agent(aid);
  waitingForAI.set(aid, text);
  const last = (state.threads[aid] || []).at(-1);
  if (last?.kind !== 'needai') post(aid, { from: 'agent', kind: 'needai', provider: a.model, text });
  updateAgent(aid, { status: 'idle', statusText: 'Needs an AI' });
  react(aid, 'confused');
}
/** After you connect an AI: agents that were waiting on it get going with what you asked. */
export function aiConnected(pid) {
  for (const [aid, text] of [...waitingForAI]) {
    const a = agent(aid);
    if (a?.model !== pid || !rt.ready(a)) continue;
    waitingForAI.delete(aid);
    const card = (state.threads[aid] || []).findLast((m) => m.kind === 'needai' && !m.connected);
    if (card) patchMessage(aid, card.mid, { connected: true });
    updateAgent(aid, { statusText: 'Getting started' });
    respond(aid, text);
  }
}

export async function choose(aid, mid, choice) {
  const m = (state.threads[aid] || []).find((x) => x.mid === mid);
  if (link.isPhone() && m?._remote) { patchMessage(aid, mid, { chosen: choice }); react(aid, 'yes'); return; }
  if (m?.call) { patchMessage(aid, mid, { chosen: choice }); post(aid, { from: 'me', text: choice }); rt.reply(aid, m, choice); react(aid, 'yes'); return; }
  if (m) patchMessage(aid, mid, { chosen: choice });
  post(aid, { from: 'me', text: choice });
  if (choice === 'Start now' || choice === 'Look it up') return work(aid, m?.about || 'look it up');
  if (choice === 'Save as routine') {
    const a = agent(aid);
    state.routines.push({ id: id('r'), agent: aid, name: (m?.about || 'New routine').slice(0, 40), when: 'Mondays at 9:00', next: 'Mon 9:00', last: 'Never', on: true });
    save(); emit('routines');
    await wait(500);
    post(aid, { from: 'agent', text: `Saved as a routine. I’ll run it every Monday at 9:00. You can change that in Routines.` });
    react(aid, 'yes');
    return;
  }
  await wait(400);
  post(aid, { from: 'agent', text: 'Okay. I’m here when you need me.' });
  react(aid, 'calm');
}

export async function work(aid, text) {
  const a = agent(aid); if (!a) return;
  const steps = plan(text), comp = computer(a.computer);
  post(aid, { from: 'agent', text: `On it. I’ll use ${comp?.name || 'my computer'} and show you each step.` });
  const msg = post(aid, { from: 'agent', kind: 'steps', title: `Working on ${comp?.name || 'my computer'}`, live: true, total: steps.length, done: 0, steps: [] });
  updateAgent(aid, { status: 'working', statusText: steps[0] });
  react(aid, 'working', document.querySelector('.pc-panel'));
  emit('work', { agent: aid, on: true });
  const list = [];
  for (let i = 0; i < steps.length; i++) {
    await wait(1100 + Math.random() * 900);
    if (agent(aid)?.status === 'paused') { patchMessage(aid, msg.mid, { live: false, title: 'Paused' }); emit('work', { agent: aid, on: false }); return; }
    // some jobs need a detail only you know: ask, wait, carry on
    if (i === 3 && /crm|lead/i.test(text)) {
      const tag = await question(aid, 'Quick one: what tag should these leads get in the CRM?', 'e.g. Webinar Nov 9');
      post(aid, { from: 'agent', text: `Got it. I’ll tag them “${tag}”, and I’ve put that in my notebook for next time.` });
      nb.add(aid, `Webinar leads get the tag “${tag}” in the CRM.`, 'agent');
      updateAgent(aid, { status: 'working', statusText: steps[i] });
      react(aid, 'yes');
      await wait(600);
    }
    list.push(steps[i]);
    patchMessage(aid, msg.mid, { steps: list.slice(-5), done: i + 1 });
    updateAgent(aid, { statusText: steps[i + 1] || 'Wrapping up' });
    react(aid, 'step');
  }
  // If you've said something since, the card itself says it's done instead of a
  // late "Done." landing under your newer message.
  const t = state.threads[aid] || [], last = t[t.length - 1];
  patchMessage(aid, msg.mid, { live: false, title: last === msg ? msg.title : `Done on ${comp?.name || 'my computer'}` });
  emit('work', { agent: aid, on: false });
  if (last === msg) { await wait(500); post(aid, { from: 'agent', text: `Done. ${steps.length} steps, all logged. Anything else?` }); }
  // Don't paper over a question that's still waiting on you.
  if (agent(aid)?.status !== 'waiting') updateAgent(aid, { status: 'done', statusText: 'Finished: ' + steps[steps.length - 1].toLowerCase() });
  react(aid, 'done');
}

export async function ask(aid, text) {
  const a = agent(aid);
  const verb = (text.match(RISKY) || ['do it'])[0].toLowerCase();
  post(aid, { from: 'agent', text: `I’ve prepared it, but I need your OK before I ${verb} anything.` });
  post(aid, { from: 'agent', kind: 'approval', id: id('ap'), action: text.length > 60 ? text.slice(0, 57) + '…' : text, detail: `${a.name} will do this on ${computer(a.computer)?.name || 'its computer'}`, preview: [], state: 'pending' });
  updateAgent(aid, { status: 'waiting', statusText: 'Waiting for your OK' });
  react(aid, 'ask');
  emit('approvals');
}

export async function resolve(aid, mid, decision) {
  const m = (state.threads[aid] || []).find((x) => x.mid === mid || x.id === mid);
  patchMessage(aid, mid, { state: decision });
  emit('approvals');
  if (link.isPhone() && m?._remote) { react(aid, decision === 'approved' ? 'approved' : 'rejected'); return; }
  if (m?.call) { react(aid, decision === 'approved' ? 'approved' : 'rejected'); rt.reply(aid, m, decision); return; }
  if (decision === 'approved') {
    react(aid, 'approved');
    updateAgent(aid, { status: 'working', statusText: 'Doing it now' });
    await wait(1300);
    post(aid, { from: 'agent', text: 'Done. Sent and logged.' });
    updateAgent(aid, { status: 'done', statusText: 'Finished' });
    react(aid, 'done');
  } else {
    react(aid, 'rejected');
    await wait(700);
    post(aid, { from: 'agent', text: 'Okay, I won’t do it. Want me to change anything?' });
    updateAgent(aid, { status: 'idle', statusText: 'Ready' });
  }
}
