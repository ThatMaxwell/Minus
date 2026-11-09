// Minus sound. Every sound is synthesized live with Elementary Audio (MIT):
// a functional DSP engine compiled to WebAssembly. No samples, no stock sounds.
//
// The whole mix is one declarative graph. Cues change a few keyed constants
// (notes, gates, levels) and re-render; Elementary diffs the graph and keeps
// every oscillator, envelope and filter running without clicks.
import { el, WebRenderer } from '../vendor/elementary.js';

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function hz(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  const semi = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
}

// Synthetic stereo hall: seeded noise, exponential decay, tail darkens over time.
function impulse(sr, seconds, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
  const n = Math.floor(sr * seconds), out = new Float32Array(n), pre = Math.floor(sr * 0.018);
  let lp = 0, energy = 0;
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sr;
    const k = 0.55 + 0.4 * Math.min(1, t / seconds * 1.6); // more low-pass as the tail goes on
    lp = lp * k + rnd() * (1 - k);
    out[i] = lp * Math.exp(-6.9 * t / seconds);
    energy += out[i] * out[i];
  }
  const g = 1 / Math.sqrt(energy);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// Phones and small machines get a lighter graph: one short reverb, single oscillators.
const LITE = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const PAD_VOICES = 6, BELLS = 6, CLICKS = 3, KEYS = 4;

export class Sound {
  constructor() {
    this.ok = false;
    this.S = {
      master: 1.5,
      pad: Array.from({ length: PAD_VOICES }, () => ({ f: 110, g: 0 })),
      padFc: 260, padGain: 1,
      bells: Array.from({ length: BELLS }, () => ({ f: 440, gate: 0, v: 0 })),
      sub: 0, riser: 0, whoosh: 0, pulse: 0,
      clicks: Array(CLICKS).fill(0), keys: Array(KEYS).fill(0), keyF: Array(KEYS).fill(5000),
    };
    this.bellI = 0; this.clickI = 0; this.keyI = 0; this.lastKey = 0;
    this.queued = false;
  }

  async init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      // 'playback' asks for bigger audio buffers: a little more latency, no crackle on busy phones
      this.ctx = new AC({ latencyHint: 'playback' });
      await this.ctx.resume();
      this.core = new WebRenderer();
      const node = await this.core.initialize(this.ctx, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(this.ctx.destination);
      const sr = this.ctx.sampleRate;
      const len = LITE ? 1.3 : 3.4;
      await this.core.updateVirtualFileSystem({ 'hall:l': impulse(sr, len, 7), 'hall:r': impulse(sr, len, 19) });
      const resume = () => this.ctx.state !== 'running' && this.ctx.resume();
      document.addEventListener('visibilitychange', resume); addEventListener('touchend', resume, { passive: true });
      this.ok = true;
      this.render();
    } catch (e) {
      console.warn('Sound unavailable:', e);
      this.ok = false;
    }
  }

  /* ───────── graph ───────── */
  render() {
    if (!this.ok || this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.core.render(...this.graph()); });
  }

  graph() {
    const S = this.S;
    const k = (key, value) => el.const({ key, value });
    const sm = (key, value, tau) => el.smooth(el.tau2pole(tau), k(key, value));
    const smLog = (key, value, tau) => el.exp(sm(key, Math.log(value), tau));

    // Pad: detuned saw pairs, panned alternately, one slow-moving low-pass.
    const padL = [], padR = [];
    S.pad.forEach((v, i) => {
      const f = smLog('pf' + i, v.f, 0.07);
      const g = sm('pg' + i, v.g, 0.9);
      const osc = LITE ? el.mul(g, 1.6, el.blepsaw(f)) : el.mul(g, el.add(el.blepsaw(el.mul(f, 1.0032)), el.blepsaw(el.mul(f, 0.9968))));
      padL.push(el.mul(i % 2 ? 0.55 : 1, osc));
      padR.push(el.mul(i % 2 ? 1 : 0.55, osc));
    });
    const fc = el.mul(smLog('pfc', S.padFc, 1.1), el.add(1, el.mul(0.12, el.cycle(0.07))));
    const padGain = sm('pgain', S.padGain, 0.6);
    const pl = el.mul(padGain, el.svf({ mode: 'lowpass' }, fc, 0.9, el.add(...padL)));
    const pr = el.mul(padGain, el.svf({ mode: 'lowpass' }, fc, 0.9, el.add(...padR)));

    // Bells: two-operator FM, bright attack that mellows as the index decays.
    const bl = [], br = [];
    S.bells.forEach((b, i) => {
      const gate = k('bg' + i, b.gate), f = k('bf' + i, b.f), v = k('bv' + i, b.v);
      const amp = el.adsr(0.002, 2.6, 0, 2.6, gate);
      const idx = el.adsr(0.001, 0.45, 0.06, 1.2, gate);
      const mod = el.mul(idx, el.mul(f, 1.5), el.cycle(el.mul(f, 3.5)));
      const bell = el.mul(v, amp, el.cycle(el.add(f, mod)));
      bl.push(el.mul(i % 2 ? 0.6 : 1, bell)); br.push(el.mul(i % 2 ? 1 : 0.6, bell));
    });
    const bellsL = el.add(...bl), bellsR = el.add(...br);

    // Sub swell: sine with a falling pitch envelope.
    const sg = k('sub', S.sub);
    const senv = el.adsr(0.004, 2.2, 0, 1.4, sg);
    const spitch = el.adsr(0.001, 0.11, 0, 0.08, sg);
    const sub = el.mul(0.5, senv, el.cycle(el.add(34, el.mul(58, spitch))));

    // Pulse: a soft heartbeat and a hush of ticks (96 bpm), faded in and out.
    const pulseOn = sm('pulse', S.pulse, 0.35);
    const beat = el.train(1.6);
    const heart = el.mul(0.22, pulseOn, el.adsr(0.001, 0.2, 0, 0.05, beat),
      el.cycle(el.add(46, el.mul(44, el.adsr(0.001, 0.045, 0, 0.02, beat)))));
    const tick = el.train(6.4);
    const ticks = el.mul(0.028, pulseOn, el.adsr(0.0004, 0.022, 0, 0.01, tick), el.svf({ mode: 'highpass' }, 7800, 0.7, el.noise()));

    // Air: a riser (slow attack, filter sweeps up) and a whoosh (filter sweeps down).
    const renv = el.adsr(1.25, 0.2, 0, 0.5, k('riser', S.riser));
    const riser = el.mul(0.13, el.mul(renv, renv),
      el.svf({ mode: 'bandpass' }, el.exp(el.add(Math.log(240), el.mul(Math.log(9500 / 240), renv))), 2.2, el.pinknoise()));
    const wenv = el.adsr(0.05, 0.75, 0, 0.3, k('whoosh', S.whoosh));
    const whoosh = el.mul(0.17, wenv,
      el.svf({ mode: 'bandpass' }, el.exp(el.add(Math.log(200), el.mul(Math.log(5200 / 200), wenv))), 1.3, el.pinknoise()));

    // UI: cursor clicks and key taps, short filtered noise with a tiny tone.
    const clicks = S.clicks.map((g, i) => {
      const e = el.adsr(0.0003, 0.016, 0, 0.012, k('cg' + i, g));
      return el.mul(0.2, e, el.add(el.svf({ mode: 'bandpass' }, 2400, 1.4, el.noise()), el.mul(0.35, el.cycle(1600))));
    });
    const keys = S.keys.map((g, i) => {
      const e = el.adsr(0.0003, 0.009, 0, 0.008, k('kg' + i, g));
      return el.mul(0.07, e, el.svf({ mode: 'bandpass' }, k('kf' + i, S.keyF[i]), 1.1, el.noise()));
    });
    const ui = el.add(...clicks, ...keys);

    // Hall reverb send.
    const send = el.add(el.mul(0.32, el.add(pl, pr)), el.mul(0.7, el.add(bellsL, bellsR)), el.mul(0.25, sub), el.mul(0.4, riser), el.mul(0.35, whoosh), el.mul(0.15, ui));
    const wetL = el.mul(0.3, el.convolve({ path: 'hall:l' }, send));
    const wetR = LITE ? wetL : el.mul(0.3, el.convolve({ path: 'hall:r' }, send));

    const master = sm('master', S.master, 0.6);
    const mix = (pad, bells, wet) => el.tanh(el.mul(master, el.add(pad, bells, sub, heart, ticks, riser, whoosh, ui, wet)));
    return [mix(pl, bellsL, wetL), mix(pr, bellsR, wetR)];
  }

  /* ───────── controls ───────── */
  gate(set, holdMs) {
    set(1); this.render();
    setTimeout(() => { set(0); this.render(); }, holdMs);
  }
  chord(notes, { gain = 0.05, fc } = {}) {
    this.S.pad.forEach((v, i) => {
      if (i < notes.length) { v.f = hz(notes[i]); v.g = gain; } else v.g = 0;
    });
    if (fc) this.S.padFc = fc;
    this.render();
  }
  filter(fc) { this.S.padFc = fc; this.render(); }
  padLevel(g) { this.S.padGain = g; this.render(); }
  bell(note, v = 0.09) {
    const i = this.bellI++ % BELLS, b = this.S.bells[i];
    b.f = hz(note); b.v = v;
    this.gate((x) => (b.gate = x), 70);
  }
  boom() { this.gate((x) => (this.S.sub = x), 900); }
  rise() { this.gate((x) => (this.S.riser = x), 1250); }
  whoosh() { this.gate((x) => (this.S.whoosh = x), 120); }
  pulse(on) { this.S.pulse = on ? 1 : 0; this.render(); }
  click() { const i = this.clickI++ % CLICKS; this.gate((x) => (this.S.clicks[i] = x), 25); }
  key() {
    const now = performance.now();
    if (now - this.lastKey < 34) return;
    this.lastKey = now;
    const i = this.keyI++ % KEYS;
    this.S.keyF[i] = 3800 + Math.random() * 2600;
    this.gate((x) => (this.S.keys[i] = x), 20);
  }
  fadeOut() { this.S.master = 0; this.render(); }
}
