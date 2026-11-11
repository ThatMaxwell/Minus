// Choosing an agent's brain: which AI, which of its models, and how hard it thinks.
// Each agent keeps its own choice (and remembers one per AI, so switching back is one tap).
import { state, providerState, updateAgent, save, go } from '../store.js';
import { $, $$, esc, icon, motion, toast } from '../ui.js';
import { PROVIDERS, provider } from '../data.js';
import * as rt from '../runtime.js';

// Shown before an account's own list has loaded (and in the web preview).
const SUGGESTED = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
  chatgpt: ['gpt-5', 'gpt-5-mini'],
  codex: ['gpt-5-codex'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  grok: ['grok-4', 'grok-4-fast'],
  openrouter: ['openrouter/auto', 'anthropic/claude-opus-5.5', 'google/gemini-2.5-pro', 'openai/gpt-5', 'x-ai/grok-4', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwen3-235b-a22b'],
  llama: ['meta-llama/llama-3.3-70b-instruct'],
  ollama: ['qwen3', 'llama3.3', 'gemma3'],
};
// Lists from providers include models that can't chat (embeddings, images, speech): leave those out.
const NOT_CHAT = /embed|tts|whisper|transcri|audio|speech|image|imagen|dall-e|moderation|realtime|search-preview|davinci|babbage|aqa|veo|lyria|-001$|vision-preview/i;

const EFFORT = [['low', 'Quick', 'Answers fast'], ['medium', 'Balanced', 'Thinks a bit first'], ['high', 'Deep', 'Thinks hard on tricky jobs']];

/** "claude-opus-5-5" → "Claude Opus 5.5", "google/gemini-2.5-pro" → "Gemini 2.5 Pro". */
export function prettyModel(id = '') {
  const tail = String(id).split('/').pop().replace(/:.*$/, '');
  const parts = tail.split(/[-_]/).filter(Boolean);
  const out = [];
  for (const w of parts) {
    const prev = out[out.length - 1];
    if (/^\d+$/.test(w) && prev && /^\d+(\.\d+)?$/.test(prev) && w.length <= 2 && !prev.includes('.')) out[out.length - 1] = `${prev}.${w}`;
    else if (/^(gpt|ai|xl|llm)$/i.test(w)) out.push(w.toUpperCase());
    else if (/^\d/.test(w)) out.push(w);
    else out.push(w[0].toUpperCase() + w.slice(1));
  }
  return out.join(' ') || id;
}

/** The model this agent uses with its AI right now. */
export const chosen = (a) => rt.modelOf(a);

export function pickModel(anchor, a, done = () => {}) {
  document.querySelector('.mp')?.remove();
  const phone = document.documentElement.classList.contains('phone') || innerWidth < 640;
  const connected = PROVIDERS.filter((p) => providerState(p.id)?.connected);
  let pid = connected.find((p) => p.id === a.model)?.id || connected[0]?.id || a.model, q = '', loading = new Set();

  const el = document.createElement('div');
  el.className = `mp ${phone ? 'mp-phone' : ''}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${a.name}’s brain`);
  document.body.appendChild(el);

  const list = () => {
    const ps = providerState(pid) || {};
    const have = (ps.models || []).filter((m) => !NOT_CHAT.test(m));
    const base = have.length ? have : SUGGESTED[pid] || [];
    const cur = (a.pick || {})[pid] || ps.modelId || rt.ENGINES[pid]?.model;
    const all = [...new Set([cur, ...base].filter(Boolean))];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return { cur, ms: all.filter((m) => words.every((w) => (m + ' ' + prettyModel(m)).toLowerCase().includes(w))) };
  };

  const draw = () => {
    const p = provider(pid), { cur, ms } = list(), ps = providerState(pid) || {};
    const using = a.model === pid ? rt.modelOf(a) : null;
    el.innerHTML = `
      <div class="mp-side">
        <div class="mp-h">AI</div>
        ${connected.map((x) => `<button class="mp-prov ${x.id === pid ? 'on' : ''}" data-prov="${x.id}">${x.icon}<span>${esc(x.name)}</span>${x.id === a.model ? '<i class="mp-dot" aria-label="In use"></i>' : ''}</button>`).join('') || '<p class="mp-none">No AI connected yet</p>'}
        <button class="mp-more" data-more>${icon('plus')}<span>Connect another</span></button>
      </div>
      <div class="mp-main">
        <label class="mp-search">${icon('search')}<input placeholder="Search ${esc(p?.name || '')} models" value="${esc(q)}" spellcheck="false" autocomplete="off" aria-label="Search models"></label>
        <div class="mp-list" role="listbox" aria-label="${esc(p?.name || '')} models">
          ${loading.has(pid) && !(ps.models || []).length ? '<p class="mp-none">Getting the models your account has…</p>' : ''}
          ${ms.map((m) => `<button role="option" class="mp-m ${m === using ? 'on' : ''}" data-model="${esc(m)}" aria-selected="${m === using}">
            <span class="mp-mt"><b>${esc(prettyModel(m))}</b><small>${esc(m)}</small></span>
            ${m === (ps.modelId || rt.ENGINES[pid]?.model) ? '<span class="mp-tag">Default</span>' : ''}${m === using ? `<span class="mp-ok">${icon('check')}</span>` : ''}</button>`).join('')}
          ${q.trim() && !ms.includes(q.trim()) ? `<button class="mp-m mp-custom" data-model="${esc(q.trim())}"><span class="mp-mt"><b>Use “${esc(q.trim())}”</b><small>Any model ${esc(p?.name || 'this AI')} has, by its exact name</small></span></button>` : ''}
          ${!ms.length && !q.trim() ? '<p class="mp-none">No models listed yet</p>' : ''}
        </div>
        <div class="mp-foot"><span>Thinking</span>
          <div class="seg sm" role="radiogroup" aria-label="How hard ${esc(a.name)} thinks">${EFFORT.map(([k, t, d]) => `<button role="radio" aria-checked="${(a.effort || 'medium') === k}" data-effort="${k}" data-tip="${d}">${t}</button>`).join('')}</div>
        </div>
      </div>`;
    const inp = $('.mp-search input', el);
    inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; draw(); const i = $('.mp-search input', el); i.focus(); i.setSelectionRange(pos, pos); };
    void cur;
  };

  // the account's own list of models, fetched once a day (it's what the key can really use)
  const fetchModels = async (id) => {
    const ps = providerState(id);
    if (!rt.desktop || !ps?.connected || loading.has(id) || (ps.models?.length && Date.now() - (ps.modelsAt || 0) < 864e5)) return;
    loading.add(id); draw();
    try {
      const got = await rt.check(id, null, ps.modelId || rt.ENGINES[id]?.model, ps.baseUrl, provider(id).name);
      if (got?.length) { ps.models = got; ps.modelsAt = Date.now(); save(); }
    } catch { /* keep the suggestions */ }
    loading.delete(id); if (el.isConnected) draw();
  };

  const place = () => {
    if (phone) return;
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let y = r.bottom + 8; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
    el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; el.style.top = y + 'px';
  };
  const close = () => { removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside, true); motion().animate(el, { opacity: 0, scale: 0.97 }, { duration: 0.14 }).then(() => el.remove()); };
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') close(); };

  el.addEventListener('click', (e) => {
    const pv = e.target.closest('[data-prov]');
    if (pv) { pid = pv.dataset.prov; q = ''; draw(); fetchModels(pid); return; }
    if (e.target.closest('[data-more]')) { close(); go('settings'); return; }
    const ef = e.target.closest('[data-effort]');
    if (ef) { updateAgent(a.id, { effort: ef.dataset.effort }); Object.assign(a, { effort: ef.dataset.effort }); draw(); return; }
    const m = e.target.closest('[data-model]');
    if (m) {
      const model = m.dataset.model, pick = { ...(a.pick || {}), [pid]: model };
      updateAgent(a.id, { model: pid, pick }); Object.assign(a, { model: pid, pick });
      toast(`${a.name} now thinks with ${prettyModel(model)}`);
      close(); done(); return;
    }
  });

  draw(); place();
  motion().animate(el, phone ? { opacity: [0, 1], y: [40, 0] } : { opacity: [0, 1], scale: [0.97, 1], y: [-6, 0] }, { type: 'spring', stiffness: 460, damping: 36 });
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); $('.mp-search input', el)?.focus({ preventScroll: true }); });
  addEventListener('keydown', key);
  fetchModels(pid);
  return { close };
}
