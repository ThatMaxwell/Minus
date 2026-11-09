// A scripted "computer use" demo: an agent's cursor fills a CRM form.
// Emits steps (onStep) so the thread and action logs can follow along.
import { avatarSVG, COLORS } from './shape.js';

export const LEADS = [
  ['Dana Okafor', 'Northwind', 'dana@northwind.example'],
  ['Leo Brandt', 'Halcyon Labs', 'leo@halcyon.example'],
  ['Priya Raman', 'Fernwood', 'priya@fernwood.example'],
  ['Sam Ito', 'Bluebird', 'sam@bluebird.example'],
  ['Mara Quinn', 'Outpost', 'mara@outpost.example'],
  ['Theo Vance', 'Lumen', 'theo@lumen.example'],
];
const FIELDS = ['Name', 'Company', 'Email'];
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class ComputerSim {
  constructor(root, { agent = 'Scout', color = COLORS.mint, speed = 1, url = 'crm.acme.example/leads/new', onClick, onKey, onStep, onSave } = {}) {
    Object.assign(this, { root, speed, onClick, onKey, onStep, onSave });
    root.classList.add('pc');
    root.innerHTML = `
      <div class="pc-bar"><span class="pc-nav"><i></i><i></i></span><span class="pc-url">${url}</span></div>
      <div class="pc-body">
        <div class="pc-form">
          <div class="pc-h">New lead</div>
          ${FIELDS.map((f, i) => `<label class="pc-l">${f}</label><div class="pc-in" data-f="${i}"></div>`).join('')}
          <div class="pc-btn">Save lead</div>
        </div>
        <div class="pc-table">
          <div class="pc-tr pc-thead"><span>Name</span><span>Company</span><span></span></div>
          <div class="pc-rows"></div>
        </div>
      </div>
      <div class="pc-cursor">
        <svg viewBox="0 0 16 20" width="15" height="19" aria-hidden="true"><path d="M1 1 L1 15.6 L4.9 12.2 L7.6 18.4 L10.2 17.2 L7.6 11.2 L12.8 11.2 Z" fill="#0b0b0d" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>
        <span class="pc-tag" style="--c:${color}">${avatarSVG(color)}${agent}</span>
      </div>`;
    this.cursor = root.querySelector('.pc-cursor');
    this.inputs = [...root.querySelectorAll('.pc-in')];
    this.btn = root.querySelector('.pc-btn');
    this.rows = root.querySelector('.pc-rows');
    this.x = 60; this.y = 70; this.place();
    this.stopped = true; this.saved = 0;
  }
  pos(el) {
    let x = Math.min(el.offsetWidth * 0.32, 90), y = el.offsetHeight * 0.58;
    for (let n = el; n && n !== this.root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return [x, y];
  }
  place() { this.cursor.style.transform = `translate(${this.x}px, ${this.y}px)`; }
  move(el, ms = 300) {
    const [tx, ty] = this.pos(el), sx = this.x, sy = this.y, dur = ms / this.speed, t0 = performance.now();
    const bend = (Math.random() - 0.5) * 36;
    return new Promise((res) => {
      const tick = (now) => {
        if (this.stopped) return res();
        const f = Math.min(1, (now - t0) / dur), e = ease(f), arc = Math.sin(f * Math.PI) * bend;
        this.x = sx + (tx - sx) * e + arc * 0.25; this.y = sy + (ty - sy) * e + arc;
        this.place();
        f < 1 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
  }
  async click(el, label) {
    await this.move(el);
    if (this.stopped) return;
    this.cursor.classList.remove('down'); void this.cursor.offsetWidth; this.cursor.classList.add('down');
    el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 160);
    this.onClick?.(); this.onStep?.({ kind: 'click', text: `Click ${label}` });
    await wait(70 / this.speed);
  }
  async type(el, text, field) {
    el.classList.add('focus');
    this.onStep?.({ kind: 'type', text: `Type “${text}”`, field });
    for (const ch of text) {
      if (this.stopped) return;
      el.textContent += ch; this.onKey?.(ch);
      await wait(22 / this.speed);
    }
    el.classList.remove('focus');
  }
  addRow([name, co]) {
    const r = document.createElement('div');
    r.className = 'pc-tr pc-new';
    r.innerHTML = `<span>${name}</span><span>${co}</span><span class="pc-ok">Saved</span>`;
    this.rows.prepend(r);
    while (this.rows.children.length > 4) this.rows.lastChild.remove();
  }
  reset() { this.rows.innerHTML = ''; this.inputs.forEach((n) => (n.textContent = '')); this.saved = 0; }
  async run({ max = Infinity, start = 0 } = {}) {
    this.stopped = false;
    let i = start;
    while (!this.stopped && i - start < max) {
      const lead = LEADS[i % LEADS.length];
      for (let f = 0; f < 3 && !this.stopped; f++) {
        await this.click(this.inputs[f], FIELDS[f].toLowerCase() + ' field');
        await this.type(this.inputs[f], lead[f], FIELDS[f]);
      }
      if (this.stopped) break;
      await this.click(this.btn, 'Save lead');
      this.addRow(lead); this.saved++;
      this.onSave?.(this.saved, lead);
      this.inputs.forEach((n) => (n.textContent = ''));
      i++;
      await wait(160 / this.speed);
    }
    this.stopped = true;
  }
  stop() { this.stopped = true; }
}
