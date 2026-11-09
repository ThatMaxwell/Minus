// A stand-in for the agent runtime: replies, runs work in steps on its computer, and
// asks for approval before anything it can't undo. The desktop app swaps this for the
// real runtime; the messages it posts have the same shapes.
import { state, agent, computer, post, patchMessage, updateAgent, emit, id, save } from './store.js';
import { react } from './director.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = new Set();

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

export async function respond(aid, text) {
  const a = agent(aid); if (!a || busy.has(aid)) return;
  busy.add(aid);
  const prevStatus = a.status;
  updateAgent(aid, { status: 'working', statusText: 'Thinking…' });
  react(aid, 'thinking');
  emit('typing', { agent: aid, on: true });
  await wait(900 + Math.random() * 700);
  emit('typing', { agent: aid, on: false });
  busy.delete(aid);

  const t = text.trim();
  if (/^(hi|hey|hello|yo|sup|hola)\b/i.test(t)) {
    post(aid, { from: 'agent', text: `Hi! I’m ${a.name}. ${a.instructions ? 'I’m set up to: ' + a.instructions : 'Give me a job and I’ll get going.'} What should I start with?` });
    updateAgent(aid, { status: prevStatus === 'working' ? 'idle' : prevStatus, statusText: 'Ready' });
    react(aid, 'hello');
    return;
  }
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

export async function choose(aid, mid, choice) {
  const m = (state.threads[aid] || []).find((x) => x.mid === mid);
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
  patchMessage(aid, mid, { state: decision });
  emit('approvals');
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
