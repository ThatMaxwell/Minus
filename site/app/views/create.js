// Create (or edit) an agent: look, basics, brain, computer, permissions, review.
// The big agent on the left is the one you are making; it reacts to every choice.
import { state, agent, id, save, emit, go, post, providerState, updateAgent } from '../store.js';
import { $, $$, esc, icon, sheet, toast, motion, IN } from '../ui.js';
import { Mascot3D, IDLES, SLOTS, snapshot } from '../../js/mascot3d.js';
import { act } from '../director.js';
import { PALETTE, PROVIDERS, ROLES, PERMISSIONS, DEFAULT_PERMS, provider } from '../data.js';
import { voicesFor, voiceOf, canSpeak, engine, speak } from '../voice.js';

const STEPS = ['Look', 'Basics', 'Brain', 'Computer', 'Permissions', 'Review'];
const LOOK_TABS = [['color', 'Color'], ['idle', 'Idle'], ['head', 'Head'], ['extras', 'Face extras'], ['neck', 'Neck']];
const thumbs = new Map();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function openCreate({ edit, step = 0 } = {}) {
  const src = edit ? agent(edit) : null;
  const firstConnected = PROVIDERS.find((p) => providerState(p.id)?.connected)?.id || 'claude';
  const d = src ? structuredClone(src) : {
    name: '', role: '', instructions: '', color: pick(PALETTE).hex, emotion: 'neutral', idle: 'calm', outfit: {},
    model: firstConnected, computer: 'new', perms: { ...DEFAULT_PERMS },
  };
  let cur = step, lookTab = 'color', m = null;
  const myVoice = () => voiceOf(d);

  const s = sheet(`
    <div class="cr">
      <div class="cr-stage">
        <div class="cr-floor"></div>
        <canvas class="cr-mx" aria-label="Preview of your agent"></canvas>
        <div class="cr-tag"><b class="cr-name"></b><span class="cr-role"></span></div>
        <div class="cr-try" aria-label="Try a gesture">
          ${['nod', 'shake', 'tilt', 'spin', 'hop', 'peek'].map((g) => `<button class="chip sm" data-g="${g}" data-tip="${g[0].toUpperCase() + g.slice(1)}">${g}</button>`).join('')}
        </div>
      </div>
      <div class="cr-side">
        <header class="cr-h">
          <div><h2>${src ? 'Edit ' + esc(src.name) : 'New agent'}</h2><p class="muted">${src ? 'Changes save when you’re done.' : 'Takes about a minute. You can change all of it later.'}</p></div>
          <button class="icon-btn" data-x data-tip="Close|Esc">${icon('x')}</button>
        </header>
        <nav class="cr-steps" aria-label="Steps">${STEPS.map((t, i) => `<button data-step="${i}"><b>${i + 1}</b>${t}</button>`).join('')}</nav>
        <div class="cr-pane"></div>
        <footer class="cr-f">
          <button class="btn btn-quiet" data-back>${icon('back')}<span>Back</span></button>
          <span class="grow"></span>
          <button class="btn btn-primary" data-next><span>Next</span>${icon('arrow')}</button>
        </footer>
      </div>
    </div>`, { cls: 'create', onClose: () => m?.destroy() });
  const el = s.el;
  let pane = $('.cr-pane', el);

  // its expressions are its own (it shows how it feels while it works); you choose how it idles
  d.emotion = 'neutral';
  m = new Mascot3D($('.cr-mx', el), { room: true, follow: true, color: d.color, emotion: 'neutral', outfit: d.outfit, idleStyle: d.idle || 'calm' });
  m.rest = 'neutral';
  const tag = () => { $('.cr-name', el).textContent = d.name || 'Your agent'; $('.cr-role', el).textContent = d.role || 'No job yet'; };
  tag();

  $('.cr-try', el).addEventListener('click', (e) => { const g = e.target.closest('[data-g]')?.dataset.g; if (g) m.gesture(g); });
  $('[data-x]', el).onclick = s.close;
  $('.cr-steps', el).addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) show(+b.dataset.step); });
  $('[data-back]', el).onclick = () => (cur > 0 ? show(cur - 1) : s.close());
  $('[data-next]', el).onclick = () => (cur < STEPS.length - 1 ? show(cur + 1) : finish());

  function show(i) {
    if (i > 1 && !d.name.trim() && cur <= 1) { show(1); const n = $('#cr-name', el); n?.focus(); act(m, 'confused'); n?.classList.add('shake'); setTimeout(() => n?.classList.remove('shake'), 500); return; }
    cur = i;
    const fresh = pane.cloneNode(false); pane.replaceWith(fresh); pane = fresh; // drop the last step's listeners
    $$('.cr-steps button', el).forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); });
    $('[data-back] span', el).textContent = i ? 'Back' : 'Cancel';
    $('[data-next] span', el).textContent = i === STEPS.length - 1 ? (src ? 'Save changes' : `Create ${d.name || 'agent'}`) : 'Next';
    pane.innerHTML = [look, basics, brain, comp, perms, review][i]();
    [wireLook, wireBasics, wireBrain, wireComp, wirePerms, () => {}][i]();
    motion().animate(pane, { opacity: [0, 1], x: [10, 0] }, { duration: 0.32, ease: IN });
    if (i === 5) { act(m, 'proud'); } else if (i !== 0) m.setEmotion(d.emotion);
  }

  /* ───────── 1 · look ───────── */
  function look() {
    return `<div class="seg" role="tablist">${LOOK_TABS.map(([k, t]) => `<button role="tab" data-lt="${k}" aria-selected="${k === lookTab}">${t}</button>`).join('')}</div>
      <div class="look-body"></div>
      <div class="look-foot"><button class="btn btn-quiet btn-sm" data-dice data-tip="Random color, face and outfit">${icon('dice')}<span>Surprise me</span></button>
      <span class="muted">${Object.values(d.outfit).filter(Boolean).length} of 3 slots used</span></div>`;
  }
  function wireLook() {
    const body = $('.look-body', pane);
    const draw = () => {
      $$('[data-lt]', pane).forEach((b) => b.setAttribute('aria-selected', b.dataset.lt === lookTab));
      if (lookTab === 'color') {
        body.innerHTML = `<div class="swatches">${PALETTE.map((c) => `<button class="sw ${c.hex === d.color ? 'on' : ''}" style="--c:${c.hex}" data-c="${c.hex}" data-tip="${c.name}" aria-label="${c.name}"></button>`).join('')}
          <label class="sw custom" data-tip="Any color"><input type="color" value="${d.color}" aria-label="Pick any color"><span>${icon('plus')}</span></label></div>
          <p class="muted small">Flat colors, no gradients. Pick something that’s easy to tell apart from your other agents.</p>`;
        return;
      }
      if (lookTab === 'idle') {
        // live previews: each one idles its own way
        body.innerHTML = `<div class="tiles idles">${Object.entries(IDLES).map(([k, v]) => `<button class="tile idle ${k === (d.idle || 'calm') ? 'on' : ''}" data-it="${k}"><canvas class="idle-mx" aria-hidden="true"></canvas><span>${esc(v.label)}</span><small>${esc(v.hint)}</small></button>`).join('')}</div>
          <p class="muted small">How ${esc(d.name || 'it')} behaves when nothing is going on. Its expressions are its own: it shows how it feels while it works.</p>`;
        $$('.idle-mx', body).forEach((c, i) => new Mascot3D(c, { shared: true, color: d.color, outfit: d.outfit, idleStyle: Object.keys(IDLES)[i], frame: 1.6 }));
        return;
      }
      const slot = lookTab === 'extras' ? 'face' : lookTab;
      const items = ['none', ...SLOTS[slot]];
      const selected = d.outfit[slot] || 'none';
      body.innerHTML = `<div class="tiles">${items.map((it) => `<button class="tile ${it === selected ? 'on' : ''}" data-it="${esc(it)}" data-tip="${esc(cap(it))}"><img alt="" data-k="${esc(it)}"><span>${esc(cap(it))}</span></button>`).join('')}</div>`;
      fillThumbs(body, (it) => ({ color: d.color, outfit: it === 'none' ? {} : { [slot]: it } }));
    };
    draw();
    pane.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-lt]'); if (tab) { lookTab = tab.dataset.lt; draw(); return; }
      const c = e.target.closest('[data-c]'); if (c) { setColor(c.dataset.c); draw(); return; }
      const t = e.target.closest('[data-it]');
      if (t) {
        const it = t.dataset.it;
        if (lookTab === 'idle') {
          d.idle = it; m.setIdleStyle(it);
          ({ curious: () => m.gesture('tilt'), bouncy: () => m.hop(), dreamy: () => m.look(0.2, 0.8, { noBlink: true }), shy: () => m.gesture('peek'), busy: () => m.look(0, -0.5), calm: () => m.blink() })[it]?.();
        }
        else { const slot = lookTab === 'extras' ? 'face' : lookTab; d.outfit[slot] = it === 'none' ? null : it; m.wear(slot, d.outfit[slot]); if (it !== 'none') act(m, 'admire', slot); else m.gesture('shake'); }
        $$('.tile', pane).forEach((x) => x.classList.toggle('on', x === t));
        $('.look-foot .muted', pane).textContent = `${Object.values(d.outfit).filter(Boolean).length} of 3 slots used`;
      }
      if (e.target.closest('[data-dice]')) {
        setColor(pick(PALETTE).hex, false);
        d.idle = pick(Object.keys(IDLES)); m.setIdleStyle(d.idle);
        d.outfit = { head: Math.random() < 0.85 ? pick(SLOTS.head) : null, face: Math.random() < 0.35 ? pick(SLOTS.face) : null, neck: Math.random() < 0.45 ? pick(SLOTS.neck) : null };
        m.setOutfit(d.outfit); act(m, 'spin'); draw();
        $('.look-foot .muted', pane).textContent = `${Object.values(d.outfit).filter(Boolean).length} of 3 slots used`;
      }
    });
    pane.addEventListener('input', (e) => { if (e.target.type === 'color') setColor(e.target.value, false); });
    pane.addEventListener('change', (e) => { if (e.target.type === 'color') draw(); });
  }
  function setColor(c, hop = true) { d.color = c; m.setColor(c); if (hop) act(m, 'hop'); }

  /* ───────── 2 · basics ───────── */
  function basics() {
    return `<label class="lbl" for="cr-name">Name</label>
      <input id="cr-name" class="field big" maxlength="24" placeholder="Scout, Inbox, Ledger…" value="${esc(d.name)}" autocomplete="off">
      <p class="hint-line" id="cr-name-hint"></p>
      <label class="lbl">Job</label>
      <div class="chips">${ROLES.map((r) => `<button class="chip ${r === d.role ? 'on' : ''}" data-role="${r}">${r}</button>`).join('')}</div>
      <label class="lbl" for="cr-ins">What should ${esc(d.name || 'it')} do?</label>
      <textarea id="cr-ins" class="field" rows="4" placeholder="Describe the job like you would to a new teammate.">${esc(d.instructions)}</textarea>
      <div class="chips sugg">${['Keep my inbox at zero and draft replies in my voice', 'Find leads that match our customers and add them to the CRM', 'Reproduce bug reports and open issues with steps', 'Match receipts to card charges every month'].map((x) => `<button class="chip sm" data-sugg="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      ${voicesFor().length ? `<label class="lbl">Voice <span class="muted small">${canSpeak() ? 'click one to hear it' : 'when you talk to it out loud'}</span></label>
      <div class="seg sm voice-seg" role="radiogroup" aria-label="Voice">${voicesFor().slice(0, 6).map(([v, n]) => `<button role="radio" aria-checked="${myVoice() === v}" data-cv="${esc(v)}">${esc(n)}</button>`).join('')}</div>` : ''}`;
  }
  function wireBasics() {
    const n = $('#cr-name', pane), ins = $('#cr-ins', pane), hint = $('#cr-name-hint', pane);
    let last = d.name;
    n.addEventListener('focus', () => act(m, 'listening', n));
    n.addEventListener('input', () => {
      d.name = n.value.trim(); tag();
      $('[data-next] span', el).textContent = 'Next';
      const dupe = state.agents.some((a) => a.name.toLowerCase() === d.name.toLowerCase() && a.id !== src?.id);
      hint.textContent = dupe ? `You already have an agent called ${d.name}. Two is fine, but it can get confusing.` : d.name ? `Nice to meet you, ${d.name}.` : '';
      hint.className = 'hint-line' + (dupe ? ' warn' : '');
      if (dupe) act(m, 'confused');
      else if (!d.name) act(m, 'no');
      else if (n.value.length > last.length && (n.value.endsWith(' ') || n.value.length === 1 || n.value.length % 4 === 0)) act(m, 'yes');
      last = n.value;
    });
    n.addEventListener('blur', () => { if (d.name) act(m, 'calm'); });
    pane.addEventListener('click', (e) => {
      const r = e.target.closest('[data-role]');
      if (r) { d.role = r.dataset.role; $$('[data-role]', pane).forEach((x) => x.classList.toggle('on', x === r)); tag(); act(m, 'yes'); m.setEmotion('happy'); setTimeout(() => m.setEmotion(d.emotion), 1200); }
      const sg = e.target.closest('[data-sugg]');
      if (sg) { ins.value = d.instructions = sg.dataset.sugg; act(m, 'yes'); }
      const cv = e.target.closest('[data-cv]');
      if (cv) {
        d.voices = { ...(d.voices || {}), [engine()]: cv.dataset.cv }; if (engine() === 'groq') d.voice = cv.dataset.cv;
        $$('[data-cv]', pane).forEach((x) => x.setAttribute('aria-checked', x === cv));
        act(m, 'yes');
        if (canSpeak()) speak(null, `Hi, I’m ${d.name || 'your new agent'}.`, { voice: cv.dataset.cv, mascots: [m] }).catch(() => {});
      }
    });
    ins.addEventListener('focus', () => act(m, 'listening', ins));
    ins.addEventListener('input', () => { d.instructions = ins.value; if (/\s$/.test(ins.value)) act(m, 'word'); });
    ins.addEventListener('blur', () => act(m, 'calm'));
    setTimeout(() => (d.name ? ins : n).focus({ preventScroll: true }), 60);
  }

  /* ───────── 3 · brain ───────── */
  function brain() {
    return `<p class="muted">${esc(d.name || 'Your agent')} thinks with an AI you already have. Minus never charges for AI.</p>
      <div class="provs">${PROVIDERS.map((p) => { const ps = providerState(p.id); return `
        <button class="prov ${p.id === d.model ? 'on' : ''}" data-p="${p.id}">
          <span class="prov-ic">${p.icon}</span><span class="prov-t"><b>${p.name}</b><small>${esc(p.by)}</small></span>
          <span class="prov-s ${ps?.connected ? 'ok' : ''}">${ps?.connected ? 'Connected' : 'Connect'}</span>
        </button>`; }).join('')}</div>
      <div class="key-box" hidden>
        <label class="lbl" for="cr-key">${icon('key')} API key for <span class="kp"></span></label>
        <div class="key-row"><input id="cr-key" class="field mono" type="password" placeholder="Paste your key" autocomplete="off" spellcheck="false"><button class="btn btn-primary btn-sm" data-connect>Connect</button></div>
        <p class="hint-line">Stored on this computer only. ${esc(d.name || 'Your agent')} looks away while you type it.</p>
      </div>`;
  }
  function wireBrain() {
    const box = $('.key-box', pane), key = $('#cr-key', pane);
    let want = null;
    pane.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (b) {
        const p = provider(b.dataset.p), ps = providerState(p.id);
        $$('.prov', pane).forEach((x) => x.classList.toggle('on', x === b));
        if (ps?.connected) { d.model = p.id; box.hidden = true; act(m, 'yes'); }
        else { want = p.id; box.hidden = false; $('.kp', pane).textContent = p.name; key.value = ''; key.focus(); }
      }
      if (e.target.closest('[data-connect]')) {
        if (!key.value.trim()) { act(m, 'no'); key.focus(); return; }
        const ps = providerState(want); ps.connected = true; ps.key = '•••• ' + key.value.trim().slice(-4); save();
        d.model = want; box.hidden = true; act(m, 'relieved'); toast(`${provider(want).name} connected`);
        pane.innerHTML = brain(); wireBrain();
      }
    });
    // privacy, shown: the agent looks away while you type a secret
    key.addEventListener('focus', () => act(m, 'shy', key));
    key.addEventListener('blur', () => act(m, 'calm'));
  }

  /* ───────── 4 · computer ───────── */
  function comp() {
    const opts = [{ id: 'new', name: 'New cloud computer', kind: 'cloud', desc: 'A fresh computer just for this agent. Keeps working when your laptop is closed.' },
      ...state.computers.map((c) => ({ ...c, desc: c.kind === 'local' ? 'Uses your apps and logins. Only works while this computer is on.' : `Shared · ${c.region} · ${c.os}` }))];
    return `<p class="muted">Where ${esc(d.name || 'your agent')} clicks and types.</p>
      <div class="opts">${opts.map((o) => `<button class="opt ${o.id === d.computer ? 'on' : ''}" data-c="${o.id}">${icon(o.kind === 'local' ? 'laptop' : 'cloud')}<span><b>${esc(o.name)}</b><small>${esc(o.desc)}</small></span>${o.id === 'new' ? '<em>Recommended</em>' : ''}</button>`).join('')}</div>`;
  }
  function wireComp() {
    pane.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      d.computer = b.dataset.c; $$('.opt', pane).forEach((x) => x.classList.toggle('on', x === b));
      if (d.computer === 'laptop') { m.setEmotion('curious'); m.gesture('peek'); setTimeout(() => { m.gesture('nod'); m.setEmotion(d.emotion); }, 1500); }
      else act(m, 'yes');
    });
  }

  /* ───────── 5 · permissions ───────── */
  function perms() {
    return `<p class="muted">What ${esc(d.name || 'your agent')} may do without asking you first.</p>
      <div class="perms">${PERMISSIONS.map((p) => `<div class="perm" data-perm="${p.id}"><span class="perm-t"><b>${p.name}</b><small>${p.desc}</small></span>
        <div class="seg sm" role="radiogroup" aria-label="${p.name}">${[['ask', 'Ask me'], ['allow', 'Allowed'], ['never', 'Never']].map(([v, t]) => `<button role="radio" data-v="${v}" aria-checked="${d.perms[p.id] === v}" class="${v === 'allow' && p.risk >= 2 ? 'risky' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
  }
  function wirePerms() {
    pane.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      const row = b.closest('[data-perm]'), p = PERMISSIONS.find((x) => x.id === row.dataset.perm), v = b.dataset.v;
      d.perms[p.id] = v; $$('[data-v]', row).forEach((x) => x.setAttribute('aria-checked', x === b));
      if (v === 'allow' && p.risk >= 2) act(m, 'worried');
      else if (v === 'never') act(m, 'yes');
      else if (v === 'ask') { m.setEmotion('happy'); m.gesture('nod'); setTimeout(() => m.setEmotion(d.emotion), 1200); }
      else act(m, 'yes');
    });
  }

  /* ───────── 6 · review ───────── */
  function review() {
    const c = d.computer === 'new' ? 'New cloud computer' : state.computers.find((x) => x.id === d.computer)?.name;
    const allowed = PERMISSIONS.filter((p) => d.perms[p.id] === 'allow').map((p) => p.name.toLowerCase());
    return `<dl class="sum">
      <div><dt>Name</dt><dd>${esc(d.name || '—')}</dd></div>
      <div><dt>Job</dt><dd>${esc(d.role || 'Not set')}</dd></div>
      <div><dt>Thinks with</dt><dd>${provider(d.model).icon}${esc(provider(d.model).name)}</dd></div>
      <div><dt>Computer</dt><dd>${esc(c || '—')}</dd></div>
      <div><dt>Voice</dt><dd>${esc((voicesFor().find(([v]) => v === myVoice()) || [0, 'Default'])[1])}</dd></div>
      <div><dt>Wears</dt><dd>${esc(Object.values(d.outfit).filter(Boolean).map(cap).join(', ') || 'Nothing yet')}</dd></div>
      <div><dt>Allowed on its own</dt><dd>${esc(allowed.join(', ') || 'Nothing, it always asks')}</dd></div>
      ${d.instructions ? `<div class="wide"><dt>Instructions</dt><dd>${esc(d.instructions)}</dd></div>` : ''}
    </dl>`;
  }

  function finish() {
    if (!d.name.trim()) return show(1);
    if (d.computer === 'new') {
      const n = state.computers.filter((c) => c.kind === 'cloud').length + 1;
      const c = { id: id('cloud'), name: `Cloud computer ${n}`, kind: 'cloud', status: 'running', region: 'US East', os: 'Linux desktop' };
      state.computers.push(c); d.computer = c.id; emit('computers');
    }
    if (src) {
      updateAgent(src.id, { name: d.name, role: d.role, instructions: d.instructions, color: d.color, emotion: 'neutral', idle: d.idle, outfit: d.outfit, model: d.model, computer: d.computer, perms: d.perms, voice: d.voice });
      emit('agents'); s.close(); toast(`${d.name} is updated`, { icon: 'sparkle' }); go('chat', { agent: src.id });
      return;
    }
    const a = { ...d, id: id('agent'), status: 'idle', statusText: 'Ready', unread: 0 };
    state.agents.push(a); state.threads[a.id] = [{ from: 'system', kind: 'day', text: 'Today', mid: id('m') }];
    save(); emit('agents');
    act(m, 'hello');
    setTimeout(() => {
      s.close(); go('chat', { agent: a.id });
      post(a.id, { from: 'agent', text: `Hi, I’m ${a.name}! ${a.instructions ? 'Here’s my job as I understand it: ' + a.instructions : 'What should I work on first?'}`, choices: ['Start now', 'Save as routine'], about: a.instructions || 'my first task' });
      setTimeout(() => import('../director.js').then(({ react }) => react(a.id, 'hello')), 400);
      toast(`${a.name} joined your team`, { icon: 'sparkle' });
    }, 900);
  }

  show(cur);
}

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Thumbnails for the pickers, rendered a few per frame and cached by look.
function fillThumbs(root, lookFor) {
  const imgs = $$('img[data-k]', root);
  let i = 0;
  const step = () => {
    const t0 = performance.now();
    while (i < imgs.length && performance.now() - t0 < 12) {
      const img = imgs[i++]; if (!img.isConnected) return;
      const look = lookFor(img.dataset.k), key = JSON.stringify(look);
      if (!thumbs.has(key)) thumbs.set(key, snapshot(look, 84));
      img.src = thumbs.get(key);
    }
    if (i < imgs.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
