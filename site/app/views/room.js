// Ask the room: one question, and every agent answers with its own AI. A Claude agent and a
// GPT agent can really disagree. Then they can reply to each other, and one sums it up.
import { state, agent, save } from '../store.js';
import { $, $$, esc, icon, face, mountMascots, mascotsOf, motion, IN, toast } from '../ui.js';
import { react, feel } from '../director.js';
import { provider } from '../data.js';
import * as rt from '../runtime.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (c) => (c == null ? '' : c < 0.01 ? '<$0.01' : '$' + c.toFixed(2));

export function room(main) {
  const people = state.agents.filter((a) => a.status !== 'off');
  const picked = new Set(state.roomPick?.filter((id) => people.find((a) => a.id === id)) || people.map((a) => a.id));
  let q = null; // the current question: { text, answers: {aid: {text, face, cost, state}}, replies, summary }

  main.innerHTML = `<section class="room">
    <header class="rm-h"><h1>${icon('room')}Ask the room</h1><p>One question to the whole team. Each agent answers with its own AI, so you hear real, different views.</p></header>
    <form class="rm-ask">
      <textarea rows="2" placeholder="e.g. Should we move the webinar leads to a new CRM, or clean up the one we have?" aria-label="Your question"></textarea>
      <div class="rm-who">${people.map((a) => `<button type="button" class="rm-pick ${picked.has(a.id) ? 'on' : ''}" data-pick="${esc(a.id)}" aria-pressed="${picked.has(a.id)}" data-tip="${esc(a.name)} answers with ${esc(provider(a.model).name)}">${face(a, 22)}<span>${esc(a.name)}</span><small>${esc(provider(a.model).name)}</small></button>`).join('')}</div>
      <div class="rm-go"><span class="rm-est" aria-live="polite"></span><button class="btn btn-primary" disabled>${icon('send')}<span>Ask everyone</span></button></div>
    </form>
    <div class="rm-out"></div>
  </section>`;
  mountMascots(main, agent);
  const form = $('.rm-ask', main), ta = $('textarea', form), go = $('.rm-go .btn', form), out = $('.rm-out', main), M = motion();

  const est = () => {
    const who = people.filter((a) => picked.has(a.id)), real = who.filter(rt.ready);
    const e = rt.estimate(who, ta.value, 1);
    $('.rm-est', form).textContent = !who.length ? 'Pick who should answer' : real.length
      ? `About ${money(e.total) || '$0.00'} on your own keys${real.length < who.length ? ` · ${who.length - real.length} without a key answer from the preview` : ''}`
      : rt.desktop ? 'Connect an AI in Settings so they can answer for real' : 'Preview: answers here are examples. In the app each one asks its own AI.';
    go.disabled = !ta.value.trim() || !who.length;
  };
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; est(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  est(); setTimeout(() => ta.focus(), 60);

  form.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]'); if (!p) return;
    picked.has(p.dataset.pick) ? picked.delete(p.dataset.pick) : picked.add(p.dataset.pick);
    p.classList.toggle('on'); p.setAttribute('aria-pressed', picked.has(p.dataset.pick));
    state.roomPick = [...picked]; save(); est();
    react(p.dataset.pick, picked.has(p.dataset.pick) ? 'yes' : 'no');
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (!go.disabled) ask(ta.value.trim()); });

  /* ───────── round 1: everyone answers, at the same time ───────── */
  async function ask(text) {
    const who = people.filter((a) => picked.has(a.id));
    q = { text, who, answers: {}, replies: {}, summary: null, cost: 0 };
    out.innerHTML = `<div class="rm-q"><span>You asked</span><p>${esc(text)}</p></div>
      <div class="rm-grid">${who.map((a) => `<article class="rm-card thinking" data-a="${esc(a.id)}" style="--c:${a.color}">
        <header>${face(a, 40)}<div><b>${esc(a.name)}</b><small>${esc(provider(a.model).name)}${a.role ? ' · ' + esc(a.role) : ''}</small></div><span class="rm-cost"></span></header>
        <div class="rm-a"><i></i><i></i><i></i></div></article>`).join('')}</div>
      <div class="rm-next" hidden><button class="btn btn-quiet" data-rm="reply">${icon('handoff')}<span>Let them reply to each other</span></button><button class="btn btn-quiet" data-rm="sum">${icon('sparkle')}<span>Sum it up</span></button><span class="rm-total"></span></div>
      <div class="rm-sum" hidden></div>`;
    mountMascots(out, agent);
    M.animate($$('.rm-card', out), { opacity: [0, 1], y: [16, 0] }, { delay: M.stagger(0.06), duration: 0.45, ease: IN });
    who.forEach((a) => react(a.id, 'thinking'));
    ta.value = ''; est();
    await Promise.all(who.map(async (a, k) => {
      const card = $(`.rm-card[data-a="${CSS.escape(a.id)}"]`, out);
      try {
        const r = rt.ready(a) ? await rt.roomAnswer(a, text, [], 1) : await demoAnswer(a, text, k);
        q.answers[a.id] = r;
        fill(card, '.rm-a', r.text);
        if (r.cost != null) { q.cost += r.cost; $('.rm-cost', card).textContent = money(r.cost); }
        feel(a.id, r.face || 'happy', 6000);
        mascotsOf(a.id).forEach((m) => card.contains(m.canvas) && m.gesture('nod'));
      } catch (err) {
        card.classList.add('failed');
        fill(card, '.rm-a', String(err?.message || err));
        react(a.id, 'confused');
      }
      card.classList.remove('thinking');
    }));
    total();
    const nx = $('.rm-next', out); nx.hidden = false;
    M.animate(nx, { opacity: [0, 1], y: [8, 0] }, { duration: 0.35 });
  }
  const fill = (card, sel, text) => {
    const el = $(sel, card);
    el.className = sel.slice(1); el.innerHTML = text.split(' ').map((w, k) => `<span style="--d:${k}">${esc(w)} </span>`).join('');
  };
  const total = () => { const t = $('.rm-total', out); if (t) t.textContent = q.cost ? `${money(q.cost)} in all` : ''; };
  const said = () => q.who.filter((a) => q.answers[a.id] && !$(`.rm-card[data-a="${CSS.escape(a.id)}"]`, out)?.classList.contains('failed')).map((a) => [a.name, q.answers[a.id].text]);

  /* ───────── round 2: they answer each other; then one of them sums it up ───────── */
  out.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm]'); if (!b || !q) return;
    if (b.dataset.rm === 'reply') {
      b.disabled = true;
      const all = said();
      await Promise.all(q.who.filter((a) => q.answers[a.id]).map(async (a, k) => {
        const card = $(`.rm-card[data-a="${CSS.escape(a.id)}"]`, out);
        card.insertAdjacentHTML('beforeend', `<div class="rm-reply"><span>${icon('handoff')}Replying</span><div class="rm-r"><i></i><i></i><i></i></div></div>`);
        react(a.id, 'thinking');
        try {
          const others = all.filter(([n]) => n !== a.name);
          const r = rt.ready(a) ? await rt.roomAnswer(a, q.text, others, 2) : await demoReply(a, others, k);
          q.replies[a.id] = r;
          $('.rm-reply span', card).innerHTML = `${icon('handoff')}After hearing the others`;
          fill(card, '.rm-r', r.text);
          if (r.cost != null) { q.cost += r.cost; }
          feel(a.id, r.face || 'curious', 6000);
        } catch (err) { fill(card, '.rm-r', String(err?.message || err)); }
      }));
      total();
      return;
    }
    if (b.dataset.rm === 'sum') {
      b.disabled = true;
      const by = q.who.find((a) => rt.ready(a)) || q.who[0];
      const box = $('.rm-sum', out); box.hidden = false;
      box.innerHTML = `<header>${face(by, 30)}<b>${esc(by.name)} sums it up</b></header><div class="rm-a"><i></i><i></i><i></i></div>`;
      mountMascots(box, agent); react(by.id, 'thinking');
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const all = said().concat(Object.entries(q.replies).map(([id, r]) => [agent(id)?.name + ' (reply)', r.text]));
      try {
        const r = rt.ready(by) ? await rt.roomSumUp(by, q.text, all) : await demoSum(q);
        if (r.cost != null) q.cost += r.cost;
        const parts = { Agree: '', Differ: '', Suggest: '' };
        for (const line of r.text.split(/\n+/)) { const m = line.match(/^\W*(Agree|Differ|Suggest)\W*:?\s*(.*)$/i); if (m) parts[m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()] = m[2]; }
        const ok = Object.values(parts).some(Boolean);
        $('.rm-a', box).outerHTML = ok
          ? `<div class="rm-parts">${[['Agree', 'check', 'Where you agree'], ['Differ', 'handoff', 'Where you differ'], ['Suggest', 'sparkle', 'What to do']].map(([k, i, t]) => `<section><h4>${icon(i)}${t}</h4><p>${esc(parts[k] || '—')}</p></section>`).join('')}</div>`
          : `<p class="rm-plain">${esc(r.text)}</p>`;
        M.animate($$('.rm-parts section', box), { opacity: [0, 1], y: [10, 0] }, { delay: M.stagger(0.08), duration: 0.4, ease: IN });
        react(by.id, 'done');
      } catch (err) { $('.rm-a', box).outerHTML = `<p class="rm-plain">${esc(String(err?.message || err))}</p>`; }
      total();
    }
  });
}

/* ───────── the preview's answers (no AI here): in character, and they do disagree ───────── */
const topic = (t) => { const m = t.replace(/[?.!]+$/, '').match(/\b(?:about|on|for|with|to)\s+(.{6,40})$/i)?.[1]; return m && !/,|\bor\b/.test(m) ? m.trim() : 'this'; };
const LEANS = [
  (a, t) => `From the ${a.role?.toLowerCase() || 'work'} side, I'd go slow on ${t}. We can test it on a small batch this week and decide with real numbers instead of guesses.`,
  (a, t) => `I'd just do it. Every week we wait on ${t} costs more than getting it slightly wrong, and I can undo most of it if it doesn't work.`,
  (a, t) => `I'm not sure ${t} is the real problem. What I see in my work points somewhere else first, so I'd fix that and then look again.`,
  (a, t) => `Yes, but only if someone owns it. I can take the ${a.role?.toLowerCase() || 'boring'} part of ${t} today if you want.`,
  (a, t) => `Careful: ${t} touches things others will see, so I'd want your OK on each step. Slower, but nothing goes out by surprise.`,
];
async function demoAnswer(a, text, k) {
  await wait(900 + k * 450 + Math.random() * 700);
  const faces = ['thinking', 'determined', 'suspicious', 'happy', 'worried'];
  return { text: LEANS[k % LEANS.length](a, topic(text)), face: faces[k % faces.length], cost: null };
}
async function demoReply(a, others, k) {
  await wait(800 + k * 400 + Math.random() * 600);
  const o = others[k % Math.max(1, others.length)]?.[0] || 'the others', o2 = others[(k + 1) % Math.max(1, others.length)]?.[0] || 'everyone';
  const lines = [`${o} has a point about the risk, so I'd add a check. I still think we should start this week.`, `I disagree with ${o}: waiting doesn't make it cheaper. But I like ${o2}'s idea of a small test first.`, `Hearing ${o}, I'd change my answer a little: same plan, but with you approving each step.`];
  return { text: lines[k % lines.length], face: ['curious', 'determined', 'proud'][k % 3], cost: null };
}
async function demoSum(q) {
  await wait(1400);
  const n = q.who.map((a) => a.name);
  return { text: `Agree: Everyone wants this done, and nobody wants surprises going out to customers.\nDiffer: ${n[0]} and ${n[2] || n[1] || n[0]} would test small first; ${n[1] || n[0]} would rather start now and fix as you go.\nSuggest: Run a small test this week with your OK on each step, then decide with the numbers.`, cost: null };
}
