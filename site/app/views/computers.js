// Computers: this one, and real cloud computers in your own cloud account. Connect a cloud
// once (its key goes in the vault), then make, start, stop and delete computers from here.
import { state, on, agent, save } from '../store.js';
import { $, esc, icon, face, mountMascots, toast, sheet, menu } from '../ui.js';
import * as cl from '../cloud.js';
import * as rt from '../runtime.js';

let off = [];
const mark = (c) => `<span class="cl-mark" style="--cc:${c.color}">${esc(c.mark)}</span>`;

export function computers(main) {
  off.forEach((f) => f()); off = []; main.onclick = null;
  const real = cl.real();
  const draw = () => {
    const pcs = state.computers;
    const anyCloud = CLOUDS().some((c) => cl.connected(c.id));
    main.innerHTML = `<section class="page">
      <header class="pg-h"><div><h1>Computers</h1><p class="muted">Where your agents work. Cloud computers are yours, in your own cloud account: they keep going when your laptop is closed.</p></div>
        <div class="pg-act"><button class="btn btn-primary btn-sm" data-new>${icon('plus')}<span>New cloud computer</span></button></div></header>
      <div class="pc-grid">${pcs.map((c) => {
        const users = state.agents.filter((a) => a.computer === c.id), busy = users.some((a) => a.status === 'working');
        const p = c.real ? cl.cloud(c.provider) : null, moving = ['starting', 'setting-up', 'stopping'].includes(c.status);
        const st = busy ? 'In use' : c.real ? cl.label(c) : c.kind === 'local' ? 'Connected' : c.status === 'starting' ? 'Starting' : 'Ready';
        return `<article class="pc-card ${c.status === 'stopped' ? 'off' : ''}" data-c="${esc(c.id)}">
          <div class="pc-thumb ${moving ? 'starting' : ''}"><div class="pc-win"><i></i><i></i><i></i><span></span><span></span><span class="short"></span></div>
            ${moving ? `<div class="pc-boot"><i class="spin"></i>${esc(st)}</div>` : ''}${p ? mark(p) : ''}</div>
          <div class="pc-meta"><b>${icon(c.kind === 'local' ? 'laptop' : 'cloud')}${esc(c.name)}</b>
            <small>${esc(c.real ? [p?.name, c.region, c.os].filter(Boolean).join(' · ') : [c.region, c.os].filter(Boolean).join(' · '))}</small></div>
          <div class="pc-users">${users.map((a) => `<span data-tip="${esc(a.name)}">${face(a, 24)}</span>`).join('') || '<span class="muted small">No agents yet</span>'}
            <span class="pc-state ${busy ? 'busy' : ''}"><i class="dot ${busy ? 'mint' : moving ? 'amber' : c.status === 'stopped' ? 'dim' : 'mint'}"></i>${esc(st)}</span>
            ${c.real ? `<button class="icon-btn sm" data-more="${esc(c.id)}" aria-label="More">${icon('more')}</button>` : ''}</div>
        </article>`; }).join('')}</div>
      <h2 class="sec-h">Your clouds</h2>
      <p class="muted small">${real ? 'Connect a cloud account once and Minus can make computers in it. You pay your cloud for them directly; Minus never charges.' : 'In the Minus app, connect your own cloud account and make real computers for your agents.'}</p>
      <div class="cl-grid">${CLOUDS().map((c) => { const on_ = cl.connected(c.id); return `
        <article class="cl-tile ${on_ ? 'on' : ''}" data-cl="${c.id}">${mark(c)}<span class="cl-t"><b>${esc(c.name)}</b><small>${on_ ? 'Connected' : esc(c.price.small)}</small></span>
          <button class="btn ${on_ ? 'btn-quiet' : 'btn-primary'} btn-xs" data-clc ${real ? '' : 'disabled'}>${on_ ? 'Disconnect' : 'Connect'}</button></article>`; }).join('')}</div>
      ${real && !anyCloud ? '' : ''}
    </section>`;
    mountMascots(main, agent);
  };
  const CLOUDS = () => cl.CLOUDS;
  draw();
  off.push(on('computers', () => { if (main.isConnected && $('.pc-grid', main)) draw(); }), on('keys', draw), on('agent', () => { if ($('.pc-grid', main)) draw(); }));
  // while this page is open, the ones on their way up are checked
  if (real) cl.sync();

  main.onclick = async (e) => {
    if (e.target.closest('[data-new]')) {
      if (!real) return demoNew(draw);
      const ready = cl.CLOUDS.filter((c) => cl.connected(c.id));
      if (!ready.length) { toast('Connect a cloud account first, below.', { icon: 'cloud' }); return $('.cl-grid', main)?.scrollIntoView({ behavior: 'smooth' }); }
      return newSheet(ready);
    }
    const t = e.target.closest('[data-cl]');
    if (t && e.target.closest('[data-clc]')) {
      const pid = t.dataset.cl;
      if (cl.connected(pid)) {
        const n = state.computers.filter((c) => c.provider === pid).length;
        if (n) return toast(`Delete its ${n} computer${n === 1 ? '' : 's'} first, so none keep running where Minus can't see them.`, { icon: 'cloud' });
        await cl.disconnect(pid); toast(`${cl.cloud(pid).name} disconnected`, { icon: 'x' }); return draw();
      }
      return connectSheet(pid, draw);
    }
    const mb = e.target.closest('[data-more]');
    if (mb) {
      const c = state.computers.find((x) => x.id === mb.dataset.more); if (!c) return;
      const items = [];
      if (c.status === 'stopped') items.push({ label: 'Start', icon: 'play', run: () => cl.power(c.id, true).then(() => toast(`Starting ${c.name}`, { icon: 'cloud' })).catch((x) => toast(String(x), { icon: 'x' })) });
      if (['running', 'setting-up'].includes(c.status)) items.push({ label: 'Stop (keeps its files, costs less)', icon: 'pause', run: () => cl.power(c.id, false).then(() => toast(`Stopping ${c.name}`, { icon: 'pause' })).catch((x) => toast(String(x), { icon: 'x' })) });
      items.push({ label: 'Check on it', icon: 'rewind', run: () => cl.refresh(c.id).catch((x) => toast(String(x), { icon: 'x' })) });
      if (c.ip) items.push({ label: `Copy its address (${c.ip})`, icon: 'copy', run: () => navigator.clipboard.writeText(c.ip).then(() => toast('Address copied')) });
      items.push('-', { label: 'Delete it…', icon: 'trash', danger: true, run: () => confirmDelete(c) });
      return menu(mb, items, { align: 'right' });
    }
  };
}

function connectSheet(pid, done) {
  const c = cl.cloud(pid);
  const s = sheet(`<form class="mini-form cl-form"><h3>${mark(c)} Connect ${esc(c.name)}</h3>
    <p class="muted small">${esc(c.help)}</p>
    ${c.fields.map(([k, label, ph, kind]) => `<label class="lbl" for="cf-${k}">${esc(label)}</label>${kind === 'area' || kind === 'json'
      ? `<textarea id="cf-${k}" class="field mono" name="${k}" rows="${kind === 'json' ? 6 : 5}" placeholder="${esc(ph)}" spellcheck="false" required></textarea>`
      : `<input id="cf-${k}" class="field ${kind === 'secret' ? 'mono' : ''}" ${kind === 'secret' ? 'type="password"' : ''} name="${k}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false" ${k === 'region' ? '' : 'required'}>`}`).join('')}
    <p class="muted small">It’s kept in this computer’s password store and only sent to ${esc(c.by)}.</p>
    <p class="hint-line warn" data-err></p>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Connect</button></div></form>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  setTimeout(() => $('input, textarea', s.el)?.focus(), 30);
  $('form', s.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), err = $('[data-err]', s.el), go = $('.btn-primary', s.el);
    const creds = {};
    try {
      for (const [k, , , kind] of c.fields) {
        const v = String(f.get(k) || '').trim();
        if (!v) continue;
        creds[k] = kind === 'json' ? JSON.parse(v) : v;
      }
    } catch { err.textContent = 'That isn’t the whole JSON file. Open it and paste everything in it.'; return; }
    go.disabled = true; go.textContent = 'Checking…'; err.textContent = '';
    try { const r = await cl.connect(pid, creds); s.close(); toast(`${c.name} connected: ${r.length} region${r.length === 1 ? '' : 's'} to choose from`, { icon: 'cloud' }); done(); }
    catch (x) { err.textContent = String(x?.message || x); go.disabled = false; go.textContent = 'Connect'; }
  };
}

function newSheet(ready) {
  let pid = ready[0].id, size = 'small';
  const s = sheet(`<form class="mini-form cl-form"><h3>${icon('cloud')} New cloud computer</h3>
    <p class="muted small">An Ubuntu computer in your own cloud account, with a browser and a terminal for your agents. It’s ready a few minutes after you make it.</p>
    <label class="lbl">Cloud</label><div class="seg sm" role="radiogroup" data-pids>${ready.map((c) => `<button type="button" role="radio" aria-checked="${c.id === pid}" data-pid="${c.id}">${esc(c.name)}</button>`).join('')}</div>
    <label class="lbl" for="nc-name">Name</label><input id="nc-name" class="field" name="name" value="${esc(cl.nextName())}" maxlength="40" required>
    <label class="lbl" for="nc-region">Where</label><select id="nc-region" class="field" name="region" required><option>Loading…</option></select>
    <label class="lbl">Size</label><div class="seg sm" role="radiogroup" data-sizes><button type="button" role="radio" aria-checked="true" data-size="small">Small</button><button type="button" role="radio" aria-checked="false" data-size="medium">Medium</button></div>
    <p class="muted small" data-price></p>
    <p class="hint-line warn" data-err></p>
    <div class="row-end"><button type="button" class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm">Make it</button></div></form>`, { cls: 'small' });
  const el = s.el, sel = $('#nc-region', el);
  const price = () => { $('[data-price]', el).textContent = `${size === 'small' ? 'Small' : 'Medium'} on ${cl.cloud(pid).name}: ${cl.cloud(pid).price[size]}. Stop it when it’s not working to pay less.`; };
  const loadRegions = async () => {
    sel.innerHTML = '<option>Loading…</option>'; sel.disabled = true;
    try {
      const rs = await cl.regions(pid);
      sel.innerHTML = rs.map((r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`).join('');
    } catch (x) { $('[data-err]', el).textContent = String(x?.message || x); sel.innerHTML = ''; }
    sel.disabled = false;
  };
  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pid]'); if (p) { pid = p.dataset.pid; el.querySelectorAll('[data-pid]').forEach((b) => b.setAttribute('aria-checked', String(b === p))); price(); loadRegions(); }
    const z = e.target.closest('[data-size]'); if (z) { size = z.dataset.size; el.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-checked', String(b === z))); price(); }
  });
  $('[data-x]', el).onclick = s.close;
  price(); loadRegions();
  $('form', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), err = $('[data-err]', el), go = $('.btn-primary', el);
    go.disabled = true; go.textContent = 'Making it…'; err.textContent = '';
    try {
      const c = await cl.create(pid, { name: String(f.get('name')).trim() || cl.nextName(), region: String(f.get('region')), size });
      s.close(); toast(`Making ${c.name} on ${cl.cloud(pid).name}. It’s ready in a few minutes.`, { icon: 'cloud' });
    } catch (x) { err.textContent = String(x?.message || x); go.disabled = false; go.textContent = 'Make it'; }
  };
}

function confirmDelete(c) {
  const users = state.agents.filter((a) => a.computer === c.id);
  const s = sheet(`<div class="mini-form"><h3>Delete ${esc(c.name)}?</h3>
    <p class="muted small">The computer and its disk are deleted in ${esc(cl.cloud(c.provider)?.name || 'your cloud')}, with everything on it. This can’t be undone.${users.length ? ` ${esc(users.map((a) => a.name).join(', '))} will work on this computer instead.` : ''}</p>
    <div class="row-end"><button class="btn btn-quiet btn-sm" data-x>Cancel</button><button class="btn btn-primary btn-sm danger" data-yes>Delete it</button></div></div>`, { cls: 'small' });
  $('[data-x]', s.el).onclick = s.close;
  $('[data-yes]', s.el).onclick = async () => {
    s.close();
    try { await cl.remove(c.id); toast(`${c.name} deleted`, { icon: 'trash' }); } catch (x) { toast(String(x?.message || x), { icon: 'x' }); }
  };
}

// the web preview: no cloud account, so a pretend computer shows what it looks like
function demoNew(draw) {
  const n = state.computers.filter((c) => c.kind === 'cloud').length + 1;
  const c = { id: `cloud-${Date.now()}`, name: `Cloud computer ${n}`, kind: 'cloud', status: 'starting', region: 'US East', os: 'Linux desktop' };
  state.computers.push(c); save(); draw(); toast(`Starting ${c.name}`, { icon: 'cloud' });
  setTimeout(() => { c.status = 'running'; save(); draw(); toast(`${c.name} is ready`, { icon: 'check' }); }, 3200);
  void rt;
}
