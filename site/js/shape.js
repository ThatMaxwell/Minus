// The Minus mascot shape. One source of truth for the 3D mascot and the flat SVG avatars,
// so a 3D mascot facing forward lines up exactly with its 2D avatar.

export const COLORS = {
  cloud:  '#f3f2ee',
  mint:   '#5fcfa6',
  amber:  '#f5a94f',
  violet: '#9079f7',
  sky:    '#4f92f6',
  coral:  '#f47652',
  rose:   '#f58fb0',
};
export const EYE_COLOR = '#0b0b0d';
export const EYE_LIGHT = '#f3f2ee';
// Dark eyes on most colors; on dark ones (black, charcoal, midnight…) the eyes turn light,
// whichever stands out more against the body.
function luminance(color) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
export function eyeColorFor(color) {
  const L = luminance(color);
  return L === null || (L + 0.05) / 0.0536 >= 0.94 / (L + 0.05) ? EYE_COLOR : EYE_LIGHT;
}
// A near-black Minus would vanish on a dark screen, so it gets a faint rim (the only outline it ever has).
export const RIM = '#3a3a42';
export const needsRim = (color) => { const L = luminance(color); return L !== null && L < 0.03; };

// Silhouette = smooth union of 8 lobe circles around a core circle.
const LOBES = [
  [ 0.00, 0.640, 0.372], [ 0.05, 0.628, 0.378], [-0.03, 0.650, 0.362], [ 0.04, 0.636, 0.380],
  [-0.02, 0.646, 0.366], [ 0.03, 0.632, 0.376], [-0.05, 0.648, 0.362], [ 0.02, 0.636, 0.374],
].map(([da, d, r], i) => {
  const a = Math.PI / 2 + i * (Math.PI / 4) + da;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, r };
});
const CORE = { x: 0, y: 0, r: 0.72 };
const SOFT = 26;

function rayToCircle(ux, uy, c) {
  const b = ux * c.x + uy * c.y;
  const disc = b * b - (c.x * c.x + c.y * c.y) + c.r * c.r;
  return disc < 0 ? null : b + Math.sqrt(disc);
}

export const SAMPLES = 4096;
export const radiusTable = new Float32Array(SAMPLES + 1);
// A rounder envelope that always contains the body (lower softness = larger, smoother).
// Hats and bands are built on it so they hug the head without following every lobe.
export const hatTable = new Float32Array(SAMPLES + 1);
(() => {
  let max = 0;
  const lse = (ux, uy, k) => {
    let sum = 0;
    for (const c of [CORE, ...LOBES]) { const d = rayToCircle(ux, uy, c); if (d !== null && d > 0) sum += Math.exp(k * d); }
    return Math.log(sum) / k;
  };
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2, ux = Math.cos(t), uy = Math.sin(t);
    radiusTable[i] = lse(ux, uy, SOFT);
    hatTable[i] = lse(ux, uy, 9);
    max = Math.max(max, radiusTable[i]);
  }
  for (let i = 0; i <= SAMPLES; i++) { radiusTable[i] /= max; hatTable[i] /= max; }
})();
export function hatRadiusAt(t) {
  let u = (t / (Math.PI * 2)) % 1; if (u < 0) u += 1;
  const f = u * SAMPLES, i = Math.floor(f), k = f - i;
  return hatTable[i] * (1 - k) + hatTable[Math.min(i + 1, SAMPLES)] * k;
}

export function radiusAt(t) {
  let u = (t / (Math.PI * 2)) % 1; if (u < 0) u += 1;
  const f = u * SAMPLES, i = Math.floor(f), k = f - i;
  return radiusTable[i] * (1 - k) + radiusTable[Math.min(i + 1, SAMPLES)] * k;
}

export let MEAN_R = 0;
for (let i = 0; i < SAMPLES; i++) MEAN_R += radiusTable[i] / SAMPLES;

// How thick the body is: a soft pillow, DEPTH at the middle, thin at the edge.
export const DEPTH = 0.5, PILLOW = 2.3;
export const profile = (s) => DEPTH * Math.pow(Math.max(0, 1 - Math.pow(Math.min(s, 1), PILLOW)), 1 / PILLOW);
export const surfaceZ = (x, y) => profile(Math.hypot(x, y) / MEAN_R);

// Eyes (body radius = 1, y up)
export const EYE = { rx: 0.268, ry: 0.272, gap: 0.33, y: 0.04, tilt: 0.05 };
export function eyeWobble(t, side) {
  const tm = side < 0 ? t : Math.PI - t;
  return 1 + 0.028 * Math.cos(2 * tm + 0.4) + 0.018 * Math.cos(3 * tm + 2.6);
}

/* ───────── Flat SVG avatar ───────── */
let bodyPathCache = null;
function bodyPath() {
  if (bodyPathCache) return bodyPathCache;
  const N = 220; let d = '';
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2, r = radiusAt(t);
    d += (i ? 'L' : 'M') + (Math.cos(t) * r * 100).toFixed(2) + ' ' + (-Math.sin(t) * r * 100).toFixed(2);
  }
  return (bodyPathCache = d + 'Z');
}
function eyePath(side) {
  const N = 64, cx = side * EYE.gap, cy = EYE.y, tilt = -side * EYE.tilt;
  const c = Math.cos(tilt), s = Math.sin(tilt); let d = '';
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2, w = eyeWobble(t, side);
    const lx = Math.cos(t) * EYE.rx * w, ly = Math.sin(t) * EYE.ry * w;
    const x = cx + lx * c - ly * s, y = cy + lx * s + ly * c;
    d += (i ? 'L' : 'M') + (x * 100).toFixed(2) + ' ' + (-y * 100).toFixed(2);
  }
  return d + 'Z';
}

// Shared <defs> so hundreds of avatars cost one path each. Call once on boot.
export function installDefs() {
  if (document.getElementById('mxb')) return;
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  d.innerHTML = `<svg aria-hidden="true"><defs><path id="mxb" d="${bodyPath()}"/>` +
    `<path id="mxe" d="${eyePath(-1)} ${eyePath(1)}"/></defs></svg>`;
  document.body.prepend(d);
}

// Returns an <svg> string. Eyes live in <g class="mx-look"><g class="mx-eyes"> so CSS can shift and blink them.
// box: half-size of the viewBox (104 = tight; 112 matches the 3D canvas framing).
// alive: the avatar blinks, glances around and bobs on its own (each one out of step).
export function avatarSVG(color = COLORS.cloud, { cls = '', look = [0, 0], label = '', box = 104, alive = false } = {}) {
  const lx = (look[0] * 12).toFixed(1), ly = (-look[1] * 9).toFixed(1);
  const r = () => (-Math.random() * 7).toFixed(2) + 's';
  const live = alive ? ` style="--bd:${r()};--ld:${r()};--bo:${r()};--gd:${(6 + Math.random() * 3).toFixed(1)}s"` : '';
  return `<svg class="mx ${cls}${alive ? ' alive' : ''}"${live} viewBox="${-box} ${-box} ${box * 2} ${box * 2}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>` +
    `<use href="#mxb" class="mx-body" fill="${color}"${needsRim(color) ? ` stroke="${RIM}" stroke-width="7" paint-order="stroke"` : ''}/>` +
    `<g class="mx-look" style="transform:translate(${lx}px,${ly}px)"><g class="mx-eyes"><use href="#mxe" fill="${eyeColorFor(color)}"/></g></g></svg>`;
}
