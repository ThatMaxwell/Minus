// The Minus mascot. A real 3D body drawn with flat, unlit colors so it reads as 2D.
//
// Always on: BLINK and LOOK. On top of that, EMOTIONS change the eye shapes and how
// the body moves, and COSMETICS are small 3D props in flat colors (no outlines).
//
// Eyes are drawn as vertical spans: for every column across the eye there is a lower
// and an upper edge. Arcs, droopy lids and squints are all just different
// edge curves, so any emotion morphs smoothly into any other.
import * as THREE from 'three';
import { radiusAt, hatRadiusAt, MEAN_R, EYE, EYE_COLOR, COLORS } from './shape.js';

const DEPTH = 0.5, PILLOW = 2.3;
const profile = (s) => DEPTH * Math.pow(Math.max(0, 1 - Math.pow(Math.min(s, 1), PILLOW)), 1 / PILLOW);
const surfaceZ = (x, y) => profile(Math.hypot(x, y) / MEAN_R);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ───────── body ───────── */
const BODY_GEO = {};
function bodyGeometry(lod = 'hi') {
  if (BODY_GEO[lod]) return BODY_GEO[lod];
  const [NT, NP] = lod === 'hi' ? [540, 48] : [220, 22], pos = [], idx = [];
  for (let j = 0; j <= NP; j++) {
    const v = j / NP, s = Math.sin(v * Math.PI), f = v <= 0.5 ? 1 : -1;
    for (let i = 0; i <= NT; i++) {
      const t = (i / NT) * Math.PI * 2, r = radiusAt(t) * s;
      pos.push(Math.cos(t) * r, Math.sin(t) * r, f * profile(s));
    }
  }
  for (let j = 0; j < NP; j++) for (let i = 0; i < NT; i++) {
    const a = j * (NT + 1) + i, b = a + NT + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return (BODY_GEO[lod] = g);
}

// One WebGL context shared by every small and medium mascot on the page. Each mascot
// renders into a corner of it and copies the pixels to its own 2D canvas. Browsers
// cap how many WebGL contexts a page may hold, so this is what lets a page have dozens.
let SHARED = null;
function sharedRenderer() {
  if (SHARED === false) throw new Error('WebGL unavailable');
  if (SHARED) return SHARED;
  try { SHARED = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true }); }
  catch (e) { SHARED = false; throw e; }
  SHARED.setPixelRatio(1);
  SHARED.setSize(256, 256, false);
  SHARED.setClearColor(0, 0);
  SHARED.outputColorSpace = THREE.SRGBColorSpace;
  SHARED.localClippingEnabled = true;
  return SHARED;
}
const BUF = new THREE.Vector2();
let BODY2D = null;
function bodyPath2D() {
  if (BODY2D) return BODY2D;
  BODY2D = new Path2D();
  for (let i = 0; i < 360; i++) { const t = (i / 360) * Math.PI * 2, r = radiusAt(t); i ? BODY2D.lineTo(Math.cos(t) * r, Math.sin(t) * r) : BODY2D.moveTo(Math.cos(t) * r, Math.sin(t) * r); }
  BODY2D.closePath();
  return BODY2D;
}

/* ───────── eye shapes ───────── */
const COLS = 44, ROWS = 5;
const XS = Array.from({ length: COLS }, (_, i) => -Math.cos((Math.PI * i) / (COLS - 1))); // denser at the tips
const round = (x) => Math.sqrt(Math.max(0, 1 - x * x));

// Smooth min/max: lids blend into the eye with a soft corner instead of a sharp one.
const smin = (a, b, k = 0.09) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
const smax = (a, b, k = 0.09) => -smin(-a, -b, k);
// An arc band with round caps: center curve is a parabola, thickness tapers like a circle.
const arc = (x, base, rise, thick) => { const c = base + rise * (1 - x * x), t = thick * round(x); return [c - t / 2, c + t / 2]; };

// Each shape returns [lo, up] for column x of the eye on side s (-1 left, +1 right).
// x * s is the "outer" coordinate: +1 at the outside corner of either eye.
const SHAPES = {
  open: (x) => [-round(x), round(x)],
  happy: (x) => arc(x, -0.16, 0.66, 0.5),
  laugh: (x) => arc(x, -0.22, 0.78, 0.6),
  closed: (x) => arc(x, -0.1, 0.46, 0.28),
  sad: (x, s) => { const r = round(x); return [-r, smin(r, 0.5 - 0.72 * x * s)]; },
  worried: (x, s) => { const r = round(x); return [-r, smin(r, 0.66 - 0.5 * x * s, 0.1)]; },
  angry: (x, s) => { const r = round(x); return [smax(-r, -0.78), smin(r, 0.14 + 0.78 * x * s)]; },
  determined: (x, s) => { const r = round(x); return [smax(-r, -0.84, 0.1), smin(r, 0.34 + 0.46 * x * s, 0.1)]; },
  sleepy: (x) => { const r = round(x); return [-r * 0.92, smin(r, -0.1, 0.12)]; },
  squint: (x) => { const r = round(x); return [smax(-r, -0.48, 0.12), smin(r, 0.18, 0.12)]; },
  focus: (x) => { const r = round(x); return [smax(-r, -0.6, 0.11), smin(r, 0.5, 0.11)]; },
  raise: (x) => { const r = round(x); return [smax(-r, -0.52, 0.12), r]; },
};

// Emotion = per-eye shape + eye transform + body behaviour + face extras.
//   scale/sy: eye size; kL/kR: per-eye size; dy: eye height; motion: body loop;
//   particles: '?', '!', '…', 'z' or 'sparkle'; blush; sweat; tears; tint; noBlink
// How an agent behaves when nothing is going on. You choose this; its expressions are its own.
export const IDLES = {
  calm:    { label: 'Calm', hint: 'Looks around now and then' },
  curious: { label: 'Curious', hint: 'Glances everywhere, tilts its head' },
  bouncy:  { label: 'Bouncy', hint: 'Can’t sit still: little hops' },
  dreamy:  { label: 'Dreamy', hint: 'Gazes up, slow blinks' },
  shy:     { label: 'Shy', hint: 'Looks down, peeks at you' },
  busy:    { label: 'Busy', hint: 'Eyes on its work, quick checks' },
};

export const EMOTIONS = {
  neutral:    { L: 'open', R: 'open' },
  happy:      { L: 'happy', R: 'happy', dy: 0.02, motion: 'bounce', blush: 0.6 },
  laughing:   { L: 'laugh', R: 'laugh', dy: 0.03, motion: 'laugh', blush: 1 },
  excited:    { L: 'open', R: 'open', scale: 1.14, motion: 'hops' },
  proud:      { L: 'closed', R: 'closed', dy: 0.03, motion: 'chin', blush: 0.5, particles: 'sparkle' },
  surprised:  { L: 'open', R: 'open', scale: 1.06, sy: 1.22, dy: 0.05, motion: 'startle' },
  alert:      { L: 'open', R: 'open', scale: 1.16, sy: 1.08, dy: 0.04, motion: 'startle', particles: '!' },
  curious:    { L: 'open', R: 'open', kL: 1.12, kR: 0.94, dy: 0.02, motion: 'tilt' },
  listening:  { L: 'open', R: 'open', scale: 1.05, motion: 'lean' },
  thinking:   { L: 'raise', R: 'open', dy: 0.03, motion: 'ponder', particles: '…' },
  focused:    { L: 'focus', R: 'focus', dy: -0.04, motion: 'work' },
  determined: { L: 'determined', R: 'determined', dy: -0.02, motion: 'steady' },
  confused:   { L: 'open', R: 'raise', kL: 1.12, kR: 0.9, motion: 'tilt', particles: '?' },
  suspicious: { L: 'squint', R: 'squint', dy: -0.02, motion: 'glance' },
  shy:        { L: 'open', R: 'open', scale: 0.86, dy: -0.05, motion: 'shy', blush: 1 },
  wink:       { L: 'open', R: 'closed', motion: 'tilt' },
  worried:    { L: 'worried', R: 'worried', dy: -0.03, motion: 'fidget', sweat: true },
  sad:        { L: 'sad', R: 'sad', dy: -0.07, motion: 'droop', tears: true },
  angry:      { L: 'angry', R: 'angry', dy: -0.03, motion: 'tremble', tint: '#ff5a46' },
  sleepy:     { L: 'sleepy', R: 'sleepy', dy: -0.08, motion: 'breathe', particles: 'z', noBlink: true },
};

// One-off gestures, layered on top of whatever the emotion is doing.
export const GESTURES = ['nod', 'shake', 'tilt', 'bow', 'spin', 'celebrate', 'shiver', 'peek', 'squish', 'hop'];

/* ───────── cosmetics: real 3D, flat colors, two or three tones, never an outline ───────── */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (c, extra = {}) => new THREE.MeshBasicMaterial({ color: c, ...extra });
const mesh = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) => {
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? flat(mat) : mat);
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale);
  return m;
};
const group = (...items) => { const g = new THREE.Group(); items.forEach((i) => g.add(i)); return g; };
// keep the part of a mesh on the side the normal points to
const keep = (normal, point) => new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone().normalize(), point);

// A shell of the head: the rounded head envelope, inflated by `add`, front/back puffed by `kz`.
// Cut it with planes and you get hats and bands that actually fit.
const SHELLS = new Map();
function shellGeo(add, kz) {
  const key = add + ':' + kz;
  if (SHELLS.has(key)) return SHELLS.get(key);
  const NT = 300, NP = 40, pos = [], idx = [];
  for (let j = 0; j <= NP; j++) {
    const v = j / NP, s = Math.sin(v * Math.PI), f = v <= 0.5 ? 1 : -1;
    for (let i = 0; i <= NT; i++) {
      const t = (i / NT) * Math.PI * 2, r = (hatRadiusAt(t) + add) * s;
      pos.push(Math.cos(t) * r, Math.sin(t) * r, f * (profile(s) * kz + add * 0.6));
    }
  }
  for (let j = 0; j < NP; j++) for (let i = 0; i < NT; i++) {
    const a = j * (NT + 1) + i, b = a + NT + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  SHELLS.set(key, g);
  return g;
}
// z of a shell's front surface at (x, y), for placing decals on hats
function shellZ(x, y, add, kz) {
  const t = Math.atan2(y, x), s = Math.min(1, Math.hypot(x, y) / (hatRadiusAt(t) + add));
  return profile(s) * kz + add * 0.6;
}
function roundedPoly(points, r) {
  const s = new THREE.Shape(), n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i], a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const p1 = [p[0] + ((a[0] - p[0]) / da) * r, p[1] + ((a[1] - p[1]) / da) * r];
    const p2 = [p[0] + ((b[0] - p[0]) / db) * r, p[1] + ((b[1] - p[1]) / db) * r];
    i ? s.lineTo(...p1) : s.moveTo(...p1);
    s.quadraticCurveTo(p[0], p[1], ...p2);
  }
  return s;
}
const roundRect = (w, h, r) => roundedPoly([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], r);
function starShape(n, R, r) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r : R; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  return s;
}
function ellipseShape(rx, ry) { const s = new THREE.Shape(); s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0); return s; }
function leafShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.bezierCurveTo(0.12, 0.05, 0.2, 0.2, 0.0, 0.34); s.bezierCurveTo(-0.2, 0.2, -0.12, 0.05, 0, 0);
  return new THREE.ShapeGeometry(s, 24);
}
// A tube that tapers from r0 to r1 along a curve.
function taper(curve, r0, r1) {
  const T = 40, R = 14, g = new THREE.TubeGeometry(curve, T, 1, R, false), p = g.attributes.position;
  for (let i = 0; i <= T; i++) {
    const c = curve.getPointAt(i / T), r = r0 + (r1 - r0) * (i / T);
    for (let j = 0; j <= R; j++) {
      const k = i * (R + 1) + j;
      p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r);
    }
  }
  p.needsUpdate = true;
  return g;
}
// A crown band whose top edge rises into rounded points.
function crownGeo(R, base, peak, n) {
  const N = 160, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, f = ((a * n) / (Math.PI * 2)) % 1, tri = 1 - Math.abs(2 * f - 1);
    const h = base + peak * Math.pow(tri * tri * (3 - 2 * tri), 1.6);
    pos.push(Math.sin(a) * R, 0, Math.cos(a) * R, Math.sin(a) * R * 0.97, h, Math.cos(a) * R * 0.97);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Each cosmetic gets ctx: { body (the body material), clip(material, planes) }.
export const COSMETICS = {
  none: null,
  beanie: (ctx) => {
    const n = V(0.1, 1, 0.05);
    const knit = mesh(shellGeo(0.035, 1.12), flat('#e9a93a', { side: THREE.DoubleSide }));
    ctx.clip(knit.material, [keep(n, V(0, 0.5, 0))]);
    const band = mesh(shellGeo(0.065, 1.2), flat('#cf8c1f', { side: THREE.DoubleSide }));
    ctx.clip(band.material, [keep(n, V(0, 0.46, 0)), keep(n.clone().negate(), V(0, 0.61, 0))]);
    const pom = group(
      mesh(new THREE.SphereGeometry(0.15, 32, 20), '#f4efe4'),
      mesh(new THREE.SphereGeometry(0.1, 24, 16), '#e6dfcf', [0.05, -0.05, 0.08]),
    );
    pom.position.set(0.08, 1.14, 0);
    return group(knit, band, pom);
  },
  cap: (ctx) => {
    const n = V(0, 1, 0.28);
    const dome = mesh(shellGeo(0.035, 1.12), flat('#33407a', { side: THREE.DoubleSide }));
    ctx.clip(dome.material, [keep(n, V(0, 0.56, 0))]);
    const brim = mesh(shellGeo(0.14, 1.4), flat('#252f5c', { side: THREE.DoubleSide }));
    ctx.clip(brim.material, [keep(n, V(0, 0.43, 0)), keep(n.clone().negate(), V(0, 0.64, 0)), keep(V(0, 0, 1), V(0, 0, 0.26))]);
    const button = mesh(new THREE.SphereGeometry(0.055, 20, 14), '#252f5c', [0, 1.05, 0]);
    const logo = mesh(new THREE.ShapeGeometry(roundRect(0.2, 0.055, 0.027), 8), '#f3f2ee', [0, 0.78, shellZ(0, 0.78, 0.035, 1.12) + 0.01]);
    logo.material.depthTest = false; logo.renderOrder = 4;
    return group(dome, brim, button, logo);
  },
  headband: (ctx) => {
    const n = V(-0.08, 1, 0);
    const band = mesh(shellGeo(0.045, 1.16), flat('#e5484d', { side: THREE.DoubleSide }));
    ctx.clip(band.material, [keep(n, V(0, 0.5, 0)), keep(n.clone().negate(), V(0, 0.65, 0))]);
    const tail = new THREE.SphereGeometry(1, 24, 16);
    const knot = group(
      mesh(tail, '#c9383e', [0.16, 0.06, 0], [0, 0, 0.55], [0.2, 0.065, 0.04]),
      mesh(tail, '#c9383e', [0.15, -0.08, 0], [0, 0, -0.35], [0.18, 0.06, 0.04]),
      mesh(new THREE.SphereGeometry(0.075, 20, 14), '#e5484d'),
    );
    knot.position.set(0.98, 0.52, 0.08);
    return group(band, knot);
  },
  crown: () => {
    const geo = crownGeo(0.36, 0.13, 0.17, 5);
    const g = group(
      mesh(geo, flat('#f6c445', { side: THREE.FrontSide })),
      mesh(geo, flat('#c9921d', { side: THREE.BackSide })),
    );
    for (let i = 0; i < 5; i++) {
      const a = ((i + 0.5) / 5) * Math.PI * 2;
      g.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), '#fff2c2', [Math.sin(a) * 0.35, 0.31, Math.cos(a) * 0.35]));
    }
    g.add(mesh(new THREE.SphereGeometry(0.05, 20, 14), '#e5484d', [0, 0.07, 0.37], [0, 0, 0], [1, 1, 0.6]));
    g.add(mesh(new THREE.SphereGeometry(0.036, 20, 14), '#4f92f6', [0.21, 0.07, 0.3], [0, 0, 0], [1, 1, 0.6]));
    g.add(mesh(new THREE.SphereGeometry(0.036, 20, 14), '#4f92f6', [-0.21, 0.07, 0.3], [0, 0, 0], [1, 1, 0.6]));
    g.position.set(0.02, 0.82, 0); g.rotation.set(0.12, 0, -0.1); g.scale.setScalar(1.18);
    return g;
  },
  'cat ears': (ctx) => {
    const ear = new THREE.ExtrudeGeometry(roundedPoly([[-0.21, 0], [0.21, 0], [0.02, 0.38]], 0.07), { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3, curveSegments: 10 });
    const inner = new THREE.ShapeGeometry(roundedPoly([[-0.11, 0.04], [0.11, 0.04], [0.015, 0.25]], 0.045), 10);
    const one = (s) => {
      const g = group(mesh(ear, ctx.body, [0, 0, -0.04]), mesh(inner, '#ff9fb4', [0, 0.02, 0.065]));
      g.position.set(s * 0.5, 0.7, 0.02); g.rotation.z = -s * 0.42; g.scale.set(-s, 1, 1);
      return g;
    };
    return group(one(-1), one(1));
  },
  antenna: () => {
    const curve = new THREE.QuadraticBezierCurve3(V(0, 0, 0), V(0.02, 0.32, 0), V(0.17, 0.52, 0));
    const g = group(
      mesh(taper(curve, 0.04, 0.024), '#2b2b31'),
      mesh(new THREE.SphereGeometry(0.105, 28, 18), '#5fcfa6', [0.17, 0.56, 0]),
      mesh(new THREE.SphereGeometry(0.05, 20, 14), '#7fe0bd', [0.13, 0.6, 0.06]),
    );
    g.position.set(0, 0.9, 0); g.userData.sway = 0.08; return g;
  },
  headphones: () => {
    const dark = '#2b2b31';
    const band = mesh(new THREE.TorusGeometry(1.07, 0.06, 16, 80, Math.PI), dark, [0, 0, 0], [0, 0, 0], [1, 1, 1.8]);
    const pad = mesh(new THREE.TorusGeometry(1.0, 0.035, 12, 60, Math.PI * 0.5), '#3d3d45', [0, 0, 0], [0, 0, Math.PI * 0.25], [1, 1, 2.2]);
    const cup = (s) => group(
      mesh(new THREE.SphereGeometry(0.29, 32, 20), dark, [0, 0, 0], [0, 0, 0], [0.55, 1, 1]),
      mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 40), '#5fcfa6', [s * 0.15, 0, 0], [0, 0, Math.PI / 2]),
    );
    const l = cup(-1), r = cup(1);
    l.position.set(-1.06, -0.02, 0); r.position.set(1.06, -0.02, 0);
    const g = group(band, pad, l, r); g.position.y = 0.04; return g;
  },
  'party hat': () => {
    const H = 0.95, R = 0.38, rAt = (y) => R * (1 - y / H), stops = [0, 0.28, 0.5, 0.7, H];
    const g = group();
    for (let i = 0; i < stops.length - 1; i++) {
      const y0 = stops[i], y1 = stops[i + 1];
      g.add(mesh(new THREE.CylinderGeometry(Math.max(rAt(y1), 0.001), rAt(y0), y1 - y0, 48), i % 2 ? '#ffd25e' : '#ff6b8f', [0, (y0 + y1) / 2, 0]));
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      g.add(mesh(new THREE.SphereGeometry(0.06, 16, 12), '#fff4e0', [Math.sin(a) * R, 0.01, Math.cos(a) * R]));
    }
    g.add(mesh(new THREE.SphereGeometry(0.09, 24, 16), '#fff4e0', [0, H + 0.04, 0]));
    g.position.set(0.12, 0.8, 0); g.rotation.z = -0.24;
    return g;
  },
  shades: () => {
    const lens = new THREE.ShapeGeometry(roundRect(0.36, 0.24, 0.1), 12);
    const g = group(
      mesh(lens, '#141417', [-0.21, 0, 0]), mesh(lens, '#141417', [0.21, 0, 0]),
      mesh(new THREE.PlaneGeometry(0.1, 0.045), '#141417', [0, 0.04, 0]),
      mesh(new THREE.PlaneGeometry(0.05, 0.13), '#3a3a42', [-0.28, 0.02, 0.002], [0, 0, -0.6]),
      mesh(new THREE.PlaneGeometry(0.05, 0.13), '#3a3a42', [0.14, 0.02, 0.002], [0, 0, -0.6]),
    );
    g.traverse((m) => { if (m.material) { m.material.depthTest = false; m.renderOrder = 4; } });
    g.position.set(0, 0.6, 0.47); g.rotation.x = -0.3; g.scale.setScalar(1.05); return g;
  },
  bow: () => {
    const pink = '#ff6b8f', wing = new THREE.ConeGeometry(0.15, 0.3, 32);
    const g = group(
      mesh(wing, pink, [-0.15, 0, 0], [0, 0, -Math.PI / 2]), mesh(wing, pink, [0.15, 0, 0], [0, 0, Math.PI / 2]),
      mesh(new THREE.SphereGeometry(0.075, 20, 14), '#e2507a', [0, 0, 0.02]),
    );
    g.traverse((m) => { if (m.material) { m.material.depthTest = false; m.renderOrder = 4; } });
    g.position.set(0.56, 0.74, 0.3); g.rotation.z = -0.5; g.scale.setScalar(1.15); return g;
  },
  sprout: () => {
    const g = group(
      mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.26, 12), '#3f9a52', [0, 0.13, 0]),
      mesh(leafShape(), '#5fcf6a', [0, 0.24, 0], [0, 0, -0.95]),
      mesh(leafShape(), '#4ab35a', [0, 0.24, 0.001], [0, 0, 0.95], [0.85, 0.85, 1]),
    );
    g.position.set(0, 0.9, 0.02); g.userData.sway = 0.12; return g;
  },
  /* ───── more hats ───── */
  'top hat': () => {
    const g = group(
      mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.045, 48), '#283058', [0, 0, 0], [0, 0, 0], [1, 1, 0.7]),
      mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.56, 48), '#323b6b', [0, 0.3, 0], [0, 0, 0], [1, 1, 0.8]),
      mesh(new THREE.CylinderGeometry(0.327, 0.334, 0.11, 48), '#e5484d', [0, 0.08, 0], [0, 0, 0], [1, 1, 0.8]),
    );
    g.position.set(0.06, 0.9, 0); g.rotation.z = -0.13; return g;
  },
  'wizard hat': () => {
    const H = 1.05, cone = mesh(new THREE.ConeGeometry(0.42, H, 48), '#5b4bd6', [0, H / 2, 0], [0, 0, 0], [1, 1, 0.8]);
    const star = new THREE.ShapeGeometry(starShape(5, 0.09, 0.04), 1);
    const st1 = mesh(star, '#ffd25e', [0.06, 0.3, 0.27]), st2 = mesh(star, '#ffd25e', [-0.1, 0.56, 0.17], [0, 0, 0.4], [0.7, 0.7, 1]);
    const g = group(mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.035, 56), '#4a3cb8', [0, 0, 0], [0, 0, 0], [1, 1, 0.62]), cone, st1, st2);
    g.position.set(0.05, 0.88, 0); g.rotation.z = -0.12; return g;
  },
  'chef hat': () => {
    const puff = new THREE.SphereGeometry(0.24, 28, 18), w = '#ffffff';
    const g = group(
      mesh(new THREE.CylinderGeometry(0.36, 0.37, 0.22, 48), '#e4e0d6', [0, 0.1, 0], [0, 0, 0], [1, 1, 0.8]),
      mesh(puff, w, [-0.2, 0.36, 0], [0, 0, 0], [1, 1, 0.8]), mesh(puff, w, [0.2, 0.36, 0], [0, 0, 0], [1, 1, 0.8]),
      mesh(puff, w, [0, 0.44, 0], [0, 0, 0], [1.15, 1.1, 0.85]),
    );
    g.position.set(0, 0.86, 0); return g;
  },
  'bucket hat': (ctx) => {
    const dome = mesh(shellGeo(0.035, 1.12), flat('#d9c7a1', { side: THREE.DoubleSide }));
    ctx.clip(dome.material, [keep(V(0, 1, 0), V(0, 0.52, 0))]);
    const brim = mesh(new THREE.CylinderGeometry(0.98, 1.2, 0.17, 64, 1, true), flat('#c3ae85', { side: THREE.DoubleSide }), [0, 0.47, 0], [0, 0, 0], [1, 1, 0.56]);
    return group(dome, brim);
  },
  'cowboy hat': () => {
    const brim = mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.04, 64), '#8f5730', [0, 0, 0], [0, 0, 0], [1, 1, 0.56]);
    const lip = (s) => mesh(new THREE.SphereGeometry(0.28, 24, 14), '#8f5730', [s * 0.82, 0.07, 0], [0, 0, s * 0.5], [1, 0.35, 1.5]);
    const g = group(brim, lip(-1), lip(1),
      mesh(new THREE.CylinderGeometry(0.31, 0.38, 0.38, 48), '#a8693a', [0, 0.21, 0], [0, 0, 0], [1, 1, 0.8]),
      mesh(new THREE.SphereGeometry(0.31, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), '#a8693a', [0, 0.39, 0], [0, 0, 0], [1, 0.45, 0.8]),
      mesh(new THREE.CylinderGeometry(0.385, 0.39, 0.08, 48), '#3b2416', [0, 0.06, 0], [0, 0, 0], [1, 1, 0.8]),
    );
    g.position.set(0, 0.84, 0); g.rotation.z = 0.08; return g;
  },
  'viking helmet': (ctx) => {
    const dome = mesh(shellGeo(0.045, 1.15), flat('#a3acb6', { side: THREE.DoubleSide }));
    ctx.clip(dome.material, [keep(V(0, 1, 0), V(0, 0.5, 0))]);
    const rim = mesh(shellGeo(0.07, 1.2), flat('#7f8892', { side: THREE.DoubleSide }));
    ctx.clip(rim.material, [keep(V(0, 1, 0), V(0, 0.46, 0)), keep(V(0, -1, 0), V(0, 0.57, 0))]);
    const horn = (s) => mesh(taper(new THREE.QuadraticBezierCurve3(V(s * 0.66, 0.74, 0), V(s * 1.08, 0.86, 0), V(s * 1.04, 1.32, 0)), 0.12, 0.018), '#efe6d2');
    return group(dome, rim, horn(-1), horn(1));
  },
  'hard hat': (ctx) => {
    const dome = mesh(shellGeo(0.045, 1.15), flat('#f5c03a', { side: THREE.DoubleSide }));
    ctx.clip(dome.material, [keep(V(0, 1, 0.12), V(0, 0.52, 0))]);
    const brim = mesh(shellGeo(0.12, 1.32), flat('#d9a226', { side: THREE.DoubleSide }));
    ctx.clip(brim.material, [keep(V(0, 1, 0.12), V(0, 0.45, 0)), keep(V(0, -1, -0.12), V(0, 0.56, 0))]);
    const ridge = mesh(new THREE.TorusGeometry(0.5, 0.045, 12, 40, Math.PI * 0.62), '#e3ae2c', [0, 0.52, 0], [0, Math.PI / 2, Math.PI * 0.19]);
    return group(dome, brim, ridge);
  },
  'grad cap': () => {
    const gold = '#f5c03a';
    const board = mesh(new THREE.BoxGeometry(0.92, 0.045, 0.92), '#3a3f57', [0, 0.2, 0], [0.42, Math.PI / 4, 0]);
    board.add(mesh(new THREE.BoxGeometry(0.9, 0.01, 0.9), '#474d68', [0, 0.024, 0]));
    const skull = mesh(new THREE.CylinderGeometry(0.33, 0.38, 0.2, 40), '#2f3449', [0, 0.08, 0], [0, 0, 0], [1, 1, 0.8]);
    const tassel = mesh(taper(new THREE.QuadraticBezierCurve3(V(0, 0.24, 0), V(0.38, 0.26, 0.1), V(0.46, -0.02, 0.18)), 0.016, 0.016), gold);
    const end = mesh(new THREE.ConeGeometry(0.05, 0.14, 16), gold, [0.46, -0.06, 0.18]);
    const g = group(skull, board, mesh(new THREE.SphereGeometry(0.04, 16, 12), gold, [0, 0.24, 0]), tassel, end);
    g.position.set(0, 0.86, 0); g.rotation.z = -0.06; return g;
  },
  'propeller cap': (ctx) => {
    const dome = mesh(shellGeo(0.035, 1.12), flat('#4f92f6', { side: THREE.DoubleSide }));
    ctx.clip(dome.material, [keep(V(0, 1, 0), V(0, 0.6, 0))]);
    const band = mesh(shellGeo(0.06, 1.18), flat('#ffd25e', { side: THREE.DoubleSide }));
    ctx.clip(band.material, [keep(V(0, 1, 0), V(0, 0.56, 0)), keep(V(0, -1, 0), V(0, 0.66, 0))]);
    const blade = new THREE.SphereGeometry(1, 20, 10);
    const prop = group(mesh(blade, '#e5484d', [0.2, 0, 0], [0, 0, 0], [0.22, 0.03, 0.07]), mesh(blade, '#e5484d', [-0.2, 0, 0], [0, 0, 0], [0.22, 0.03, 0.07]),
      mesh(new THREE.SphereGeometry(0.045, 16, 12), '#ffd25e'));
    prop.position.y = 1.2; prop.userData.spin = 9;
    return group(dome, band, mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10), '#2b2b31', [0, 1.1, 0]), prop);
  },
  visor: (ctx) => {
    const n = V(0, 1, 0.2);
    const band = mesh(shellGeo(0.045, 1.16), flat('#4fbf98', { side: THREE.DoubleSide }));
    ctx.clip(band.material, [keep(n, V(0, 0.5, 0)), keep(n.clone().negate(), V(0, 0.63, 0))]);
    const brim = mesh(shellGeo(0.15, 1.42), flat('#3a9f7c', { side: THREE.DoubleSide }));
    ctx.clip(brim.material, [keep(n, V(0, 0.42, 0)), keep(n.clone().negate(), V(0, 0.56, 0)), keep(V(0, 0, 1), V(0, 0, 0.2))]);
    return group(band, brim);
  },
  'santa hat': () => {
    const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.04, 0.3, 0), V(0.2, 0.52, 0), V(0.46, 0.5, 0), V(0.6, 0.36, 0)]);
    const g = group(
      mesh(taper(curve, 0.42, 0.04), '#e5484d', [0, 0, 0], [0, 0, 0], [1, 1, 0.8]),
      mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.16, 48), '#f6f3ec', [0, 0.02, 0], [0, 0, 0], [1, 1, 0.82]),
      mesh(new THREE.SphereGeometry(0.12, 24, 16), '#f6f3ec', [0.62, 0.32, 0]),
    );
    g.position.set(0, 0.84, 0); return g;
  },
  goggles: (ctx) => {
    const strap = mesh(shellGeo(0.04, 1.14), flat('#2b2b31', { side: THREE.DoubleSide }));
    ctx.clip(strap.material, [keep(V(0, 1, 0), V(0, 0.55, 0)), keep(V(0, -1, 0), V(0, 0.64, 0))]);
    const lens = (s) => group(
      mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 36), '#3a3a42', [0, 0, 0], [Math.PI / 2, 0, 0]),
      mesh(new THREE.CircleGeometry(0.13, 36), '#8fd0ff', [0, 0, 0.062]),
      mesh(new THREE.CircleGeometry(0.045, 20), '#d6eeff', [-0.05, 0.05, 0.064]),
    );
    const l = lens(-1), r = lens(1);
    const z = surfaceZ(0.22, 0.6) + 0.07;
    l.position.set(-0.22, 0.6, z); r.position.set(0.22, 0.6, z);
    l.rotation.x = r.rotation.x = -0.35;
    return group(strap, l, r);
  },
  headset: () => {
    const g = COSMETICS.headphones();
    g.add(mesh(taper(new THREE.QuadraticBezierCurve3(V(-1.06, -0.06, 0.12), V(-0.95, -0.55, 0.4), V(-0.42, -0.5, 0.5)), 0.03, 0.025), '#2b2b31'));
    g.add(mesh(new THREE.SphereGeometry(0.07, 20, 14), '#2b2b31', [-0.4, -0.5, 0.5], [0, 0, 0], [1.3, 1, 1]));
    return g;
  },
  earmuffs: () => {
    const band = mesh(new THREE.TorusGeometry(1.06, 0.04, 12, 64, Math.PI), '#e5484d', [0, 0.04, 0], [0, 0, 0], [1, 1, 1.6]);
    const muff = (s) => mesh(new THREE.SphereGeometry(0.3, 28, 18), '#ffb3c7', [s * 1.04, 0.0, 0], [0, 0, 0], [0.7, 1, 1]);
    return group(band, muff(-1), muff(1));
  },
  'bunny ears': (ctx) => {
    const ear = new THREE.ExtrudeGeometry(ellipseShape(0.13, 0.4), { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3, curveSegments: 20 });
    const inner = new THREE.ShapeGeometry(ellipseShape(0.07, 0.3), 20);
    const one = (s) => {
      const g = group(mesh(ear, ctx.body, [0, 0.4, -0.035]), mesh(inner, '#ff9fb4', [0, 0.42, 0.06]));
      g.position.set(s * 0.26, 0.78, 0); g.rotation.z = -s * 0.16;
      return g;
    };
    const r = one(1); r.rotation.z = -0.5;
    return group(one(-1), r);
  },
  'bear ears': (ctx) => {
    const one = (s) => {
      const g = group(mesh(new THREE.SphereGeometry(0.21, 28, 18), ctx.body, [0, 0, 0], [0, 0, 0], [1, 1, 0.55]),
        mesh(new THREE.CircleGeometry(0.12, 28), flat('#000000', { transparent: true, opacity: 0.16 }), [0, 0.0, 0.12]));
      g.position.set(s * 0.55, 0.82, 0.02);
      return g;
    };
    return group(one(-1), one(1));
  },
  'devil horns': () => {
    const horn = (s) => mesh(taper(new THREE.QuadraticBezierCurve3(V(s * 0.3, 0.86, 0.05), V(s * 0.38, 1.04, 0.05), V(s * 0.5, 1.12, 0.05)), 0.085, 0.012), '#e0443e');
    return group(horn(-1), horn(1));
  },
  curl: () => {
    const curve = new THREE.CatmullRomCurve3([V(0, 0.9, 0), V(0.01, 1.08, 0), V(0.1, 1.2, 0), V(0.21, 1.18, 0), V(0.22, 1.08, 0), V(0.13, 1.05, 0)]);
    const g = group(mesh(taper(curve, 0.075, 0.03), '#2b2b31'));
    g.scale.setScalar(1.5); g.position.set(0, -0.48, 0); g.userData.sway = 0.05; return g;
  },
  flower: () => {
    const petal = new THREE.SphereGeometry(0.075, 20, 12), g = group();
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.add(mesh(petal, '#ff8fb1', [Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0], [0, 0, 0], [1, 1, 0.4])); }
    g.add(mesh(new THREE.SphereGeometry(0.055, 20, 12), '#ffd25e', [0, 0, 0.02], [0, 0, 0], [1, 1, 0.5]));
    g.traverse((m) => { if (m.material) { m.material.depthTest = false; m.renderOrder = 4; m.userData.face = true; } });
    g.position.set(-0.6, 0.72, 0.3); g.scale.setScalar(1.25); return g;
  },

  /* ───── face ───── */
  eyepatch: (ctx) => {
    const strap = mesh(shellGeo(0.03, 1.12), flat('#26262b', { side: THREE.DoubleSide }));
    const n = V(0.45, 1, 0);
    ctx.clip(strap.material, [keep(n, V(0, 0.15, 0)), keep(n.clone().negate(), V(0, 0.23, 0))]);
    const x = EYE.gap, y = EYE.y;
    const patch = mesh(new THREE.ShapeGeometry(ellipseShape(0.32, 0.3), 32), flat('#16161a', { depthTest: false }), [x, y, surfaceZ(x, y) + 0.03]);
    patch.renderOrder = 5; patch.userData.face = true;
    return group(strap, patch);
  },
  mustache: () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.02);
    s.bezierCurveTo(0.08, 0.1, 0.2, 0.08, 0.26, 0.0); s.bezierCurveTo(0.31, -0.05, 0.36, 0.0, 0.35, 0.06);
    s.bezierCurveTo(0.38, -0.04, 0.3, -0.1, 0.2, -0.06); s.bezierCurveTo(0.12, -0.03, 0.05, -0.05, 0, -0.02);
    s.bezierCurveTo(-0.05, -0.05, -0.12, -0.03, -0.2, -0.06); s.bezierCurveTo(-0.3, -0.1, -0.38, -0.04, -0.35, 0.06);
    s.bezierCurveTo(-0.36, 0.0, -0.31, -0.05, -0.26, 0.0); s.bezierCurveTo(-0.2, 0.08, -0.08, 0.1, 0, 0.02);
    const m = mesh(new THREE.ShapeGeometry(s, 24), flat('#3a2a22', { depthTest: false }), [0, -0.33, surfaceZ(0, -0.33) + 0.02], [0, 0, 0], [1.45, 1.7, 1]);
    m.renderOrder = 5; m.userData.face = true; return group(m);
  },
  freckles: () => {
    const g = group(), dot = new THREE.CircleGeometry(0.032, 16);
    [[-0.5, -0.24], [-0.42, -0.3], [-0.56, -0.32], [0.5, -0.24], [0.42, -0.3], [0.56, -0.32]].forEach(([x, y]) => {
      const m = mesh(dot, flat('#a85a3e', { depthTest: false }), [x, y, surfaceZ(x, y) + 0.01]); m.renderOrder = 5; m.userData.face = true; g.add(m);
    });
    return g;
  },
  'rosy cheeks': () => {
    const g = group();
    [-1, 1].forEach((s) => { const x = s * 0.52, y = -0.25; const m = mesh(new THREE.CircleGeometry(0.11, 28), flat('#ff8fa8', { depthTest: false, transparent: true, opacity: 0.92 }), [x, y, surfaceZ(x, y) + 0.01], [0, 0, 0], [1.5, 0.85, 1]); m.renderOrder = 5; m.userData.face = true; g.add(m); });
    return g;
  },

  /* ───── neck ───── */
  'bow tie': () => {
    const wing = new THREE.ConeGeometry(0.13, 0.26, 3), red = '#e5484d';
    const g = group(mesh(wing, red, [-0.13, 0, 0], [0, 0, -Math.PI / 2], [1, 1, 0.3]), mesh(wing, red, [0.13, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.3]),
      mesh(new THREE.SphereGeometry(0.06, 20, 12), '#c93a3f', [0, 0, 0.02], [0, 0, 0], [1, 1, 0.5]));
    g.traverse((m) => { if (m.material) { m.material.depthTest = false; m.renderOrder = 5; m.userData.face = true; } });
    g.position.set(0, -0.6, surfaceZ(0, -0.6) + 0.04); g.scale.setScalar(1.35); return g;
  },
  tie: () => {
    const knot = mesh(new THREE.ShapeGeometry(roundedPoly([[-0.08, 0.06], [0.08, 0.06], [0.05, -0.06], [-0.05, -0.06]], 0.02), 6), flat('#3a76d6', { depthTest: false }));
    const blade = mesh(new THREE.ShapeGeometry(roundedPoly([[-0.05, -0.06], [0.05, -0.06], [0.1, -0.3], [0, -0.42], [-0.1, -0.3]], 0.02), 6), flat('#4f92f6', { depthTest: false }));
    const g = group(knot, blade);
    g.traverse((m) => { if (m.material) { m.renderOrder = 5; m.userData.face = true; } }); knot.renderOrder = 6;
    g.position.set(0, -0.4, surfaceZ(0, -0.4) + 0.03); g.scale.setScalar(1.55); return g;
  },
  scarf: (ctx) => {
    const wrap = mesh(shellGeo(0.06, 1.2), flat('#e5484d', { side: THREE.DoubleSide }));
    ctx.clip(wrap.material, [keep(V(0, 1, 0), V(0, -0.66, 0)), keep(V(0, -1, 0), V(0, -0.38, 0))]);
    const stripe = mesh(shellGeo(0.07, 1.22), flat('#f6f3ec', { side: THREE.DoubleSide }));
    ctx.clip(stripe.material, [keep(V(0, 1, 0), V(0, -0.56, 0)), keep(V(0, -1, 0), V(0, -0.49, 0))]);
    const tail = mesh(new THREE.ShapeGeometry(roundedPoly([[-0.08, 0], [0.08, 0], [0.11, -0.36], [-0.05, -0.36]], 0.03), 6), flat('#c93a3f', { depthTest: false }), [0.34, -0.56, surfaceZ(0.34, -0.56) + 0.08], [0, 0, 0.12]);
    tail.renderOrder = 5; tail.userData.face = true;
    return group(wrap, stripe, tail);
  },
  pearls: () => {
    const g = group(), bead = new THREE.SphereGeometry(0.045, 16, 12);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, x = -0.56 + 1.12 * u, y = -0.4 - 0.26 * Math.sin(Math.PI * u);
      g.add(mesh(bead, i === 5 ? '#ffd9e3' : '#f6f1e6', [x, y, surfaceZ(x, y) + 0.035], [0, 0, 0], i === 5 ? [1.5, 1.5, 1.5] : [1, 1, 1]));
    }
    return g;
  },
  bell: (ctx) => {
    const collar = mesh(shellGeo(0.045, 1.16), flat('#e5484d', { side: THREE.DoubleSide }));
    ctx.clip(collar.material, [keep(V(0, 1, 0), V(0, -0.64, 0)), keep(V(0, -1, 0), V(0, -0.5, 0))]);
    const z = surfaceZ(0, -0.72) + 0.1;
    const b = group(mesh(new THREE.SphereGeometry(0.13, 24, 16), '#f6c445'), mesh(new THREE.BoxGeometry(0.15, 0.022, 0.02), '#9a7414', [0, -0.04, 0.125]), mesh(new THREE.SphereGeometry(0.05, 16, 12), '#ffe18a', [-0.05, 0.05, 0.08]));
    b.position.set(0, -0.72, z);
    return group(collar, b);
  },
  medal: () => {
    const ribbon = (s) => mesh(new THREE.PlaneGeometry(0.07, 0.24), flat('#4f92f6', { depthTest: false }), [s * 0.05, 0.1, 0], [0, 0, s * 0.35]);
    const g = group(ribbon(-1), ribbon(1),
      mesh(new THREE.CircleGeometry(0.1, 32), flat('#f6c445', { depthTest: false }), [0, -0.04, 0.005]),
      mesh(new THREE.CircleGeometry(0.06, 28), flat('#dca52b', { depthTest: false }), [0, -0.04, 0.01]));
    g.traverse((m) => { if (m.material) { m.renderOrder = 5; m.userData.face = true; } });
    g.position.set(0.2, -0.5, surfaceZ(0.2, -0.5) + 0.03); g.scale.setScalar(1.45); return g;
  },
};

const FACE_ITEMS = new Set(['eyepatch', 'mustache', 'freckles', 'rosy cheeks']);
const NECK_ITEMS = new Set(['bow tie', 'tie', 'scarf', 'pearls', 'bell', 'medal']);

/* ───────── particles (Zs) ───────── */
function zGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.08, 0.08); s.lineTo(0.08, 0.08); s.lineTo(0.08, 0.05); s.lineTo(-0.035, -0.05); s.lineTo(0.08, -0.05);
  s.lineTo(0.08, -0.08); s.lineTo(-0.08, -0.08); s.lineTo(-0.08, -0.05); s.lineTo(0.035, 0.05); s.lineTo(-0.08, 0.05);
  return new THREE.ShapeGeometry(s);
}
function tearGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.07); s.bezierCurveTo(0.05, -0.01, 0.045, -0.06, 0, -0.06); s.bezierCurveTo(-0.045, -0.06, -0.05, -0.01, 0, 0.07);
  return new THREE.ShapeGeometry(s, 16);
}

/* ───────── eyes ───────── */
class Eye {
  constructor(side, mat) {
    this.side = side;
    this.p = new Float32Array(COLS * ROWS * 3);
    const idx = [];
    for (let i = 0; i < COLS - 1; i++) for (let j = 0; j < ROWS - 1; j++) {
      const a = i * ROWS + j, b = (i + 1) * ROWS + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.renderOrder = 1; this.mesh.frustumCulled = false;
    this.lo = new Float32Array(COLS); this.up = new Float32Array(COLS);
    this.setTarget('open', true);
  }
  setTarget(name, snap) {
    this.tLo = new Float32Array(COLS); this.tUp = new Float32Array(COLS);
    XS.forEach((x, i) => { const [l, u] = SHAPES[name](x, this.side, i); this.tLo[i] = l; this.tUp[i] = Math.max(l, u); });
    if (snap) { this.lo.set(this.tLo); this.up.set(this.tUp); }
  }
  update(dt, lx, ly, open, sx, sy, dy) {
    const k = 1 - Math.exp(-dt * 16);
    for (let i = 0; i < COLS; i++) { this.lo[i] += (this.tLo[i] - this.lo[i]) * k; this.up[i] += (this.tUp[i] - this.up[i]) * k; }
    const s = this.side, cx = s * EYE.gap + lx * 0.15, cy = EYE.y + ly * 0.11 + dy;
    const tilt = -s * EYE.tilt, c = Math.cos(tilt), sn = Math.sin(tilt), p = this.p;
    const rx = EYE.rx * sx, ry = EYE.ry * sy, o = Math.max(open, 0.06);
    for (let i = 0; i < COLS; i++) {
      const lo = this.lo[i], up = this.up[i], mid = lo + (up - lo) * 0.3;
      for (let j = 0; j < ROWS; j++) {
        let ey = lo + ((up - lo) * j) / (ROWS - 1);
        ey = mid + (ey - mid) * o;
        const ex = XS[i] * rx, eyy = ey * ry;
        const x = cx + ex * c - eyy * sn, y = cy + ex * sn + eyy * c, k3 = (i * ROWS + j) * 3;
        p[k3] = x; p[k3 + 1] = y; p[k3 + 2] = surfaceZ(x, y) + 0.004;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.cx = cx; this.cy = cy; this.rx = rx; this.ry = ry;
  }
}

class Spring {
  constructor(k, z) { this.k = k; this.c = 2 * z * Math.sqrt(k); this.x = 0; this.v = 0; this.target = 0; }
  step(dt) { this.v += (this.k * (this.target - this.x) - this.c * this.v) * dt; this.x += this.v * dt; }
}
const smooth = (cur, target, dt, speed) => cur + (target - cur) * (1 - Math.exp(-dt * speed));

/* ───────── glyph particles ('?', '!', '…', 'z') and sparkles ───────── */
const GLYPHS = new Map();
function glyphMaterial(ch, color) {
  const key = ch + color;
  if (!GLYPHS.has(key)) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${ch === '…' ? 96 : 104}px Geist, "Helvetica Neue", Arial, sans-serif`;
    g.fillText(ch, 64, ch === '…' ? 58 : 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    GLYPHS.set(key, tex);
  }
  return new THREE.MeshBasicMaterial({ map: GLYPHS.get(key), transparent: true, depthTest: false });
}
const PLANE = new THREE.PlaneGeometry(0.5, 0.5);
let SPARKLE = null;

export const SLOTS = {
  head: Object.keys(COSMETICS).filter((k) => k !== 'none' && !FACE_ITEMS.has(k) && !NECK_ITEMS.has(k)),
  face: [...FACE_ITEMS],
  neck: [...NECK_ITEMS],
};
export const slotOf = (name) => (FACE_ITEMS.has(name) ? 'face' : NECK_ITEMS.has(name) ? 'neck' : 'head');

const VIS = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((es) => { for (const e of es) if (e.target._mascot) e.target._mascot.onscreen = e.isIntersecting; }, { rootMargin: '40px' })
  : null;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const bell = (f) => Math.sin(Math.PI * Math.min(1, Math.max(0, f)));

export class Mascot3D {
  // canvas: where it draws. Options:
  //   color, emotion, outfit {head, face, neck} (or cosmetic: one item), idle (looks around and blinks on its own),
  //   follow (eyes follow the pointer), shared (draw through the page-wide renderer: use for all but one big mascot),
  //   frame (view half-height in body radii; ~1.6 leaves room for hats), room (lots of space: hops move the body),
  //   scale (start size; 0 to pop in later), still (no animation loop; for thumbnails)
  constructor(canvas, { color = COLORS.cloud, idle = true, follow = false, scale = 1, room = false, emotion = 'neutral', cosmetic, outfit, shared = false, frame = 1.12, still = false, idleStyle = 'calm' } = {}) {
    this.viewH = frame;
    this.canvas = canvas; this.room = room; this.shared = shared;
    // No WebGL (hardware acceleration off, blocked GPU)? Fall back to a flat 2D drawing of the
    // same front-facing mascot: body, eyes, expressions, blink, look and hops. Only accessories are skipped.
    this.flat = false;
    try {
      if (shared) { this.renderer = sharedRenderer(); this.ctx2d = canvas.getContext('2d'); }
      else {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: still });
        this.renderer.setClearColor(0, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.localClippingEnabled = true;
      }
    } catch (e) {
      this.flat = true; this.renderer = null;
      this.ctx2d = canvas.getContext('2d');
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(14, 1, 0.1, 100);
    this.baseColor = new THREE.Color(color);
    this.bodyMat = new THREE.MeshBasicMaterial({ color });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: EYE_COLOR, side: THREE.DoubleSide, depthTest: false });
    this.rig = new THREE.Group(); this.head = new THREE.Group();
    this.rig.add(this.head); this.scene.add(this.rig);
    this.body = new THREE.Mesh(bodyGeometry(shared && (canvas.clientWidth || 99) < 72 ? 'lo' : 'hi'), this.bodyMat);
    this.head.add(this.body);
    this.eyes = [new Eye(-1, this.eyeMat), new Eye(1, this.eyeMat)];
    this.eyes.forEach((e) => this.head.add(e.mesh));

    // face extras: tears, sweat, blush
    const drop = (c) => { const m = new THREE.Mesh(tearGeo(), new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true })); m.renderOrder = 3; m.visible = false; this.head.add(m); return m; };
    this.tear = drop('#7cc4ff'); this.sweat = drop('#9fd6ff');
    const blushMat = new THREE.MeshBasicMaterial({ color: '#ff8fa8', depthTest: false, transparent: true, opacity: 0 });
    this.blush = [-1, 1].map((s) => {
      const x = s * 0.53, y = -0.25, m = new THREE.Mesh(new THREE.CircleGeometry(0.11, 28), blushMat);
      m.position.set(x, y, surfaceZ(x, y) + 0.008); m.scale.set(1.5, 0.82, 1); m.renderOrder = 0.5; this.head.add(m); return m;
    });
    this.blushMat = blushMat;
    this.particles = []; this.partT = 0;

    this.eyeX = new Spring(520, 0.92); this.eyeY = new Spring(520, 0.92);
    this.headX = new Spring(70, 0.62); this.headY = new Spring(70, 0.62);
    this.pop = new Spring(260, 0.45); this.pop.x = this.pop.target = scale;
    this.lookX = 0; this.lookY = 0;
    this.blinkT = null; this.blinksLeft = 0; this.blinkWait = 0;
    this.idle = idle; this.follow = follow; this.pointerT = 0; this.idleStyle = IDLES[idleStyle] ? idleStyle : 'calm';
    this.nextBlink = rand(1.5, 3); this.nextLook = rand(1.5, 3);
    this.t = 0; this.emoT = 0; this.g = null;
    this.st = { sx: 1, sy: 1, dy: 0, tint: 0, kL: 1, kR: 1, blush: 0 };
    this.items = { head: null, face: null, neck: null }; this.clipSets = { head: [], face: [], neck: [] };
    this.setEmotion(emotion, true);
    if (outfit) this.setOutfit(outfit); else if (cosmetic) this.setCosmetic(cosmetic);

    this.still = still;
    this.resize = this.resize.bind(this);
    if (still) { this.resize(); this.running = false; return; }
    this.ro = new ResizeObserver(this.resize); this.ro.observe(canvas);
    // skip drawing while scrolled out of sight (also inside scrolling lists, which a
    // plain viewport check misses)
    this.onscreen = true; canvas._mascot = this; VIS?.observe(canvas);
    this.resize();
    if (follow) { this.onMove = (e) => this.onPointer(e); addEventListener('pointermove', this.onMove); }
    this.last = performance.now();
    this.running = true;
    const loop = (now) => {
      if (!this.running) return;
      // lifecycle: once it has been on the page, leaving the page ends it
      if (this.canvas.isConnected) this.seen = true; else if (this.seen) return this.destroy();
      this.frame(now); requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    if (this.still) { this.camera.aspect = 1; const hh = this.viewH; this.camera.position.set(0, 0.24, hh / Math.tan(THREE.MathUtils.degToRad(7))); this.camera.updateProjectionMatrix(); return; }
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.shared || this.flat) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    else { this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false); }
    const halfH = (this.room ? 2.1 : this.viewH) * Math.max(1, h / w);
    this.camera.aspect = w / h;
    this.camera.position.set(0, this.room ? 0.25 : 0, halfH / Math.tan(THREE.MathUtils.degToRad(7)));
    this.camera.updateProjectionMatrix();
  }

  /* ───────── identity ───────── */
  setColor(c) { this.baseColor.set(c); }
  setIdleStyle(s) { this.idleStyle = IDLES[s] ? s : 'calm'; }
  setScale(s, instant = false) { this.pop.target = s; if (instant) { this.pop.x = s; this.pop.v = 0; } }
  setEmotion(name, snap = false) {
    const e = EMOTIONS[name] || EMOTIONS.neutral;
    this.emotion = EMOTIONS[name] ? name : 'neutral'; this.emo = e; this.emoT = 0;
    this.eyes[0].setTarget(e.L, snap); this.eyes[1].setTarget(e.R, snap);
    if (snap) Object.assign(this.st, { sx: e.scale || 1, sy: (e.scale || 1) * (e.sy || 1), dy: e.dy || 0, kL: e.kL || 1, kR: e.kR || 1, blush: e.blush || 0, tint: e.tint ? 1 : 0 });
    if (e.motion === 'startle' && !snap) this.pop.v += 9;
    if (e.motion === 'hops') this.hopT = 0;
    if (!snap && !e.noBlink && name !== 'wink') this.blinkT === null && this.blink();
  }
  // outfit: { head, face, neck } — item names, or null/'none' to leave a slot empty
  setOutfit(outfit = {}) { for (const slot of ['head', 'face', 'neck']) this.wear(slot, outfit[slot]); }
  get outfit() { return { head: this.items.head?.userData.name || null, face: this.items.face?.userData.name || null, neck: this.items.neck?.userData.name || null }; }
  // one item into its own slot; 'none' takes everything off (kept for older callers)
  setCosmetic(name) {
    if (!name || name === 'none') return this.setOutfit({});
    this.wear(slotOf(name), name);
  }
  wear(slot, name) {
    const old = this.items[slot];
    if (old) { this.head.remove(old); old.traverse((m) => { if (m.material && m.material !== this.bodyMat) m.material.dispose(); }); }
    this.items[slot] = null; this.clipSets[slot] = [];
    const make = name && name !== 'none' ? COSMETICS[name] : null;
    if (!make) return;
    const ctx = { body: this.bodyMat, clip: (mat, planes) => { const world = planes.map((p) => p.clone()); mat.clippingPlanes = world; this.clipSets[slot].push({ local: planes, world }); } };
    const item = make(ctx);
    item.userData.name = name; item.userData.base = item.position.clone(); item.userData.rot = item.rotation.z;
    item.traverse((m) => {
      if (!m.isMesh) return;
      if (m.material.depthTest === false) m.userData.face = true; // drawn over the face: hide when facing away
      if (!m.renderOrder) m.renderOrder = 2; // after the eyes, so a brim or band can sit over them cleanly
    });
    this.items[slot] = item; this.head.add(item);
  }
  // Swap identity in place with a little pop.
  become({ color, emotion, cosmetic, outfit }) {
    this.setScale(0);
    setTimeout(() => {
      if (color) this.setColor(color);
      if (emotion) this.setEmotion(emotion, true);
      if (outfit) this.setOutfit(outfit); else if (cosmetic) this.setCosmetic(cosmetic);
      this.setScale(1); this.pop.v += 4;
    }, 170);
  }

  /* ───────── motion ───────── */
  hop() { this.hopT = 0; }
  // gestures: nod, shake, tilt, bow, spin, celebrate, shiver, peek, squish, hop
  gesture(name) {
    if (name === 'hop') return this.hop();
    const dur = { nod: 0.85, shake: 0.9, tilt: 1.3, bow: 1.1, spin: 0.95, celebrate: 1.3, shiver: 0.6, peek: 1.4, squish: 0.6 }[name];
    if (!dur) return;
    this.g = { name, t: 0, dur };
    if (name === 'celebrate') this.hopT = 0;
    if (name === 'peek') { this.look(-0.9, 0.1, { noBlink: true }); setTimeout(() => this.look(0.9, 0.1, { noBlink: true }), 450); setTimeout(() => this.look(0, 0), 950); this.pointerT = 1.5; }
  }
  blink(times = 1) {
    if (this.blinkT !== null || this.blinksLeft) return;
    this.blinkT = 0; this.blinksLeft = times - 1;
  }
  look(x, y, { noBlink = false } = {}) {
    x = clamp(x, -1, 1); y = clamp(y, -1, 1);
    if (!noBlink && Math.hypot(x - this.lookX, y - this.lookY) > 0.9) this.blink();
    this.lookX = x; this.lookY = y;
    this.eyeX.target = this.headX.target = x;
    this.eyeY.target = this.headY.target = y;
  }
  // look at a point on the screen (a button, an input) for `hold` seconds
  lookAt(clientX, clientY, hold = 2) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const size = this.room ? r.height * 0.3 : r.width;
    const dx = (clientX - (r.left + r.width / 2)) / (size * 1.6), dy = -(clientY - (r.top + r.height / 2)) / (size * 1.3);
    const m = Math.hypot(dx, dy), k = m > 1 ? 1 / m : 1;
    this.look(dx * k, dy * k); this.pointerT = hold;
  }
  lookAtEl(el, hold = 2) { const r = el.getBoundingClientRect(); this.lookAt(r.left + r.width / 2, r.top + r.height / 2, hold); }
  onPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const size = this.room ? r.height * 0.3 : r.width;
    // Wander far away and it hops twice, looking up after you.
    const far = Math.max(280, size * 4), dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (dist > far && !this.wasFar && performance.now() > (this.hopReady || 0)) {
      this.wasFar = true; this.hopReady = performance.now() + 4000; this.hopT = 0;
      this.look(Math.sign(e.clientX - cx) * 0.35, 1, { noBlink: true }); this.pointerT = 1.6;
      return;
    }
    if (dist < far * 0.6) this.wasFar = false;
    if (this.hopT !== undefined && this.hopT < 0.9) return;
    if (this.pointerT > 2.5) return; // looking at something on purpose
    this.lookAt(e.clientX, e.clientY, 2.5);
  }

  openness(dt) {
    if (this.blinkT === null) {
      if (this.blinksLeft && (this.blinkWait -= dt) <= 0) { this.blinksLeft--; this.blinkT = 0; } else return 1;
    }
    this.blinkT += dt;
    const C = 0.07, H = 0.035, O = 0.15, t = this.blinkT;
    if (t < C) return 1 - (t / C) ** 2;
    if (t < C + H) return 0;
    if (t < C + H + O) return 1 - (1 - (t - C - H) / O) ** 3;
    this.blinkT = null; this.blinkWait = 0.08; return 1;
  }

  spawn(kind) {
    let m;
    if (kind === 'sparkle') {
      SPARKLE ||= new THREE.ShapeGeometry(starShape(4, 0.11, 0.035), 1);
      m = new THREE.Mesh(SPARKLE, new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#ffd25e' : '#fff4c2', transparent: true, depthTest: false }));
      m.position.set(rand(-0.9, 0.9), rand(0.5, 1.0), 0.6);
      m.userData = { age: 0, life: 1.1, vx: 0, vy: 0.08, s: rand(0.7, 1.2), spin: rand(-2, 2), kind };
    } else {
      const color = kind === 'z' ? '#b9b8c8' : kind === '!' ? '#ffb02e' : kind === '?' ? '#ffd25e' : '#d7d6e2';
      m = new THREE.Mesh(PLANE, glyphMaterial(kind, color));
      const side = kind === 'z' || kind === '…' ? 1 : Math.random() < 0.5 ? -1 : 1;
      m.position.set(side * rand(0.6, 0.72), rand(0.78, 0.9), 0.6);
      m.userData = { age: 0, life: kind === 'z' ? 2.4 : 1.7, vx: side * (kind === 'z' ? 0.12 : 0.04), vy: kind === 'z' ? 0.42 : 0.16, s: kind === 'z' ? rand(0.6, 0.9) : 1, kind };
    }
    m.renderOrder = 6; m.userData.face = false;
    this.rig.add(m); this.particles.push(m);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (!this.onscreen) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width === 0) return;
    this.step(dt);
    this.draw();
  }

  step(dt) {
    this.t += dt; this.emoT += dt;
    const e = this.emo, st = this.st, T = this.t;

    if (this.idle) {
      if (!e.noBlink && (this.nextBlink -= dt) <= 0) { this.blink(Math.random() < 0.18 ? 2 : 1); this.nextBlink = rand(2.2, 5.5); }
      if (this.pointerT > 0) this.pointerT -= dt;
      else if ((this.nextLook -= dt) <= 0) {
        // while it feels something, the feeling moves it; at rest, its idle style does
        const rest = this.emotion === 'neutral';
        const m = rest ? { curious: 'glance', shy: 'shy', busy: 'work', dreamy: 'dream' }[this.idleStyle] : e.motion;
        if (m === 'dream') { this.look(rand(-0.6, 0.6), rand(0.45, 0.9), { noBlink: true }); this.nextLook = rand(3, 5.5); }
        else {
        if (m === 'glance') this.look(Math.random() < 0.5 ? -0.85 : 0.85, -0.1, { noBlink: true });
        else if (m === 'droop' || m === 'shy') this.look(rand(-0.5, 0.5), -0.55, { noBlink: true });
        else if (m === 'ponder') this.look(rand(-0.7, -0.3), rand(0.5, 0.8), { noBlink: true });
        else if (m === 'work') this.look(rand(-0.25, 0.25), -0.35, { noBlink: true });
        else if (Math.random() < 0.4 && Math.hypot(this.lookX, this.lookY) > 0.3) this.look(rand(-0.15, 0.15), rand(-0.1, 0.15));
        else this.look(rand(-1, 1), rand(-0.6, 0.8));
        this.nextLook = m === 'glance' ? rand(1.2, 2) : m === 'work' ? rand(0.8, 1.6) : rand(1.6, 3.8);
        }
      }
      if (this.emotion === 'neutral' && !this.g) {
        const s = this.idleStyle;
        if (s === 'bouncy' && this.hopT !== undefined && this.hopT >= 0.9 && Math.random() < dt * 0.12) this.hopT = 0;
        else if (s === 'bouncy' && this.hopT === undefined && Math.random() < dt * 0.12) this.hopT = 0;
        if (s === 'curious' && Math.random() < dt * 0.05) this.gesture('tilt');
        if (s === 'shy' && Math.random() < dt * 0.04) this.gesture('peek');
      }
    }
    if (e.motion === 'hops' && this.hopT !== undefined && this.hopT >= 0.9 && Math.random() < dt * 1.2) this.hopT = 0;

    const h = dt / 4;
    for (let i = 0; i < 4; i++) [this.eyeX, this.eyeY, this.headX, this.headY, this.pop].forEach((s) => s.step(h));

    // emotion body loop
    let bx = 0, by = 0, rz = 0, sqx = 0, sqy = 0, hx = 0;
    switch (e.motion) {
      case 'bounce': { const b = Math.abs(Math.sin(T * Math.PI * 2.2)); by = b * 0.05; sqy = (b - 0.5) * 0.03; break; }
      case 'laugh': { const b = Math.abs(Math.sin(T * Math.PI * 3.6)); by = b * 0.045; sqy = (b - 0.5) * 0.05; rz = Math.sin(T * 7) * 0.03; break; }
      case 'droop': by = -0.05; sqy = -0.03; sqx = 0.015; rz = Math.sin(T * 0.9) * 0.02; break;
      case 'tremble': bx = Math.sin(T * 63) * 0.008; rz = Math.sin(T * 41) * 0.012; sqy = -0.015; break;
      case 'fidget': bx = Math.sin(T * 47) * 0.004; rz = Math.sin(T * 1.7) * 0.03; sqy = -0.01; break;
      case 'breathe': sqy = Math.sin(T * 1.6) * 0.025; sqx = -sqy * 0.6; rz = 0.09 + Math.sin(T * 0.8) * 0.02; by = -0.03; break;
      case 'tilt': rz = Math.min(1, this.emoT * 5) * 0.14; break;
      case 'lean': rz = Math.min(1, this.emoT * 4) * -0.1; sqy = 0.012; break;
      case 'glance': rz = -this.headX.x * 0.05; break;
      case 'ponder': rz = 0.08 + Math.sin(T * 1.1) * 0.03; break;
      case 'work': by = Math.abs(Math.sin(T * 9)) * 0.012; break;
      case 'steady': sqy = Math.sin(T * 2) * 0.01; hx = 0.08; break;
      case 'shy': rz = -0.07 + Math.sin(T * 1.4) * 0.025; sqy = -0.02; break;
      case 'chin': hx = -0.16; by = 0.02; break;
      case 'startle': sqy = Math.max(0, 0.06 - this.emoT * 0.08); by = Math.max(0, 0.04 - this.emoT * 0.05); break;
    }

    // gesture (one-off, layered)
    let gx = 0, gy = 0, gz = 0, spin = 0, gby = 0, gbx = 0, gsq = 0;
    if (this.g) {
      const g = this.g; g.t += dt; const f = g.t / g.dur;
      if (f >= 1) this.g = null;
      else switch (g.name) {
        case 'nod': gx = Math.sin(f * Math.PI * 4) * 0.2 * (1 - f * 0.7); break;
        case 'shake': gy = Math.sin(f * Math.PI * 6) * 0.3 * (1 - f); break;
        case 'tilt': gz = 0.2 * Math.min(1, bell(f) * 1.7); break;
        case 'bow': gx = 0.36 * Math.pow(bell(f), 0.7); gby = -0.03 * bell(f); break;
        case 'spin': spin = ease(f) * Math.PI * 2; gby = bell(f) * 0.12; break;
        case 'celebrate': spin = ease(Math.min(1, f * 1.4)) * Math.PI * 2; break;
        case 'shiver': gbx = Math.sin(g.t * 70) * 0.02 * (1 - f); break;
        case 'peek': gz = Math.sin(f * Math.PI * 2) * 0.08; break;
        case 'squish': gsq = bell(f); break;
      }
    }

    // hops (two arcs)
    let hopY = 0, land = 0;
    if (this.hopT !== undefined && this.hopT < 0.9) {
      this.hopT += dt;
      const t = this.hopT, arc = (a, b, ht) => (t > a && t < b ? ht * 4 * ((t - a) / (b - a)) * (1 - (t - a) / (b - a)) : 0);
      hopY = arc(0.04, 0.38, 0.32) + arc(0.44, 0.72, 0.2);
      land = (t > 0 && t < 0.06) || (t > 0.38 && t < 0.46) || (t > 0.72 && t < 0.82) ? 1 : 0;
    }
    if (this.room) { this.rig.position.y = by + gby + hopY; this.canvas.style.translate = ''; }
    else { this.rig.position.y = by + gby; this.canvas.style.translate = hopY ? `0 ${(-hopY * this.canvas.clientHeight * 0.45).toFixed(2)}px` : ''; }
    this.rig.position.x = bx + gbx;
    this.rig.rotation.z = smooth(this.rig.rotation.z, rz, dt, 8) + gz;
    this.rig.rotation.y = spin;
    this.headTilt = smooth(this.headTilt || 0, hx, dt, 6);

    this.head.rotation.y = this.headX.x * 0.42 + gy;
    this.head.rotation.x = -this.headY.x * 0.3 + this.headTilt + gx;
    this.head.position.x = this.headX.x * 0.05;
    this.head.position.y = this.headY.x * 0.03;

    const open = this.openness(dt), p = Math.max(0, this.pop.x);
    const dip = Math.max(1 - open, land);
    const spring = Math.max(-0.25, Math.min(0.25, this.pop.v * 0.012)), air = hopY > 0.02 ? 0.06 : 0;
    this.rig.scale.set(p * (1 + dip * 0.03 + sqx - spring * 0.5 - air * 0.5 + gsq * 0.12), p * (1 - dip * 0.05 + sqy + spring + air - gsq * 0.16), p);

    // eyes, tint, blush
    st.sx = smooth(st.sx, e.scale || 1, dt, 10); st.sy = smooth(st.sy, (e.scale || 1) * (e.sy || 1), dt, 10);
    st.kL = smooth(st.kL, e.kL || 1, dt, 10); st.kR = smooth(st.kR, e.kR || 1, dt, 10);
    st.dy = smooth(st.dy, e.dy || 0, dt, 10);
    st.tint = smooth(st.tint, e.tint ? 1 : 0, dt, 5);
    st.blush = smooth(st.blush, e.blush || 0, dt, 5);
    this.bodyMat.color.copy(this.baseColor).lerp(new THREE.Color(e.tint || '#000'), st.tint * 0.07);
    this.blushMat.opacity = st.blush * 0.7;
    const lx = this.eyeX.x - this.headX.x * 0.35, ly = this.eyeY.x - this.headY.x * 0.35;
    this.eyes[0].update(dt, lx, ly, open, st.sx * st.kL, st.sy * st.kL, st.dy);
    this.eyes[1].update(dt, lx, ly, open, st.sx * st.kR, st.sy * st.kR, st.dy);

    // tears and sweat
    const slide = (m, on, period, x0, y0, len) => {
      if (!on) { m.visible = false; return; }
      const cyc = (this.emoT % period) / period, f = cyc / 0.7;
      m.visible = cyc < 0.7;
      const y = y0 - f * len;
      m.position.set(x0, y, surfaceZ(x0, y) + 0.012);
      m.scale.setScalar(Math.min(1, f * 5) * 0.9);
      m.material.opacity = 1 - Math.max(0, (f - 0.75) * 4);
    };
    const eye = this.eyes[1];
    slide(this.tear, e.tears, 2.6, eye.cx + eye.rx * 0.55, eye.cy - eye.ry * 0.7, 0.32);
    slide(this.sweat, e.sweat, 2.2, 0.72, 0.52, 0.18);

    // particles
    if (e.particles && (this.partT -= dt) <= 0) {
      this.spawn(e.particles);
      this.partT = { z: 0.9, sparkle: 0.28, '?': 1.7, '!': 1.7, '…': 1.9 }[e.particles] || 1;
    }
    this.particles = this.particles.filter((m) => {
      const u = m.userData; u.age += dt;
      const f = u.age / u.life;
      if (f >= 1) { this.rig.remove(m); m.material.dispose(); return false; }
      m.position.x += u.vx * dt + (u.kind === 'z' ? Math.sin(u.age * 3) * 0.002 : 0);
      m.position.y += u.vy * dt;
      if (u.spin) m.rotation.z += u.spin * dt;
      const pop = u.kind === 'sparkle' ? bell(f) : Math.min(1, f * 6) * (u.kind === 'z' ? 0.8 + f * 0.6 : 1 + Math.max(0, 0.25 - f) * 0.8);
      m.scale.setScalar(u.s * pop);
      m.material.opacity = u.kind === 'sparkle' ? 1 : 1 - Math.max(0, (f - 0.6) / 0.4);
      return true;
    });

    // accessories: idle motion
    for (const it of Object.values(this.items)) {
      if (!it) continue;
      const sw = it.userData.sway;
      if (sw) it.rotation.z = it.userData.rot + Math.sin(T * 2.4) * sw - this.headX.v * 0.006 - this.rig.position.y * 0.3;
      it.traverse((m) => { if (m.userData.spin) m.rotation.y += m.userData.spin * dt; });
    }

    // the face (eyes, cheeks, anything drawn over it) only shows while it faces the camera
    const facing = Math.cos(this.rig.rotation.y + this.head.rotation.y) > 0.25;
    if (facing !== this.facing) {
      this.facing = facing;
      this.eyes.forEach((x) => (x.mesh.visible = facing));
      this.blush.forEach((x) => (x.visible = facing));
      for (const it of Object.values(this.items)) it?.traverse((m) => { if (m.userData.face) m.visible = facing; });
    }
    if (!facing) { this.tear.visible = this.sweat.visible = false; }

    const clips = this.flat ? [] : [...this.clipSets.head, ...this.clipSets.face, ...this.clipSets.neck];
    if (clips.length) {
      this.scene.updateMatrixWorld();
      for (const c of clips) c.local.forEach((p, i) => c.world[i].copy(p).applyMatrix4(this.head.matrixWorld));
    }
  }

  draw() {
    if (this.flat) return this.draw2d();
    if (!this.shared) return this.renderer.render(this.scene, this.camera);
    const r = this.renderer, cw = this.canvas.width, ch = this.canvas.height;
    if (!cw || !ch) return;
    r.getDrawingBufferSize(BUF);
    if (BUF.x < cw || BUF.y < ch) { r.setSize(Math.max(BUF.x, cw), Math.max(BUF.y, ch), false); r.getDrawingBufferSize(BUF); }
    r.setViewport(0, 0, cw, ch); r.setScissor(0, 0, cw, ch); r.setScissorTest(true);
    r.clear(); r.render(this.scene, this.camera);
    this.ctx2d.clearRect(0, 0, cw, ch);
    this.ctx2d.drawImage(r.domElement, 0, BUF.y - ch, cw, ch, 0, 0, cw, ch);
  }

  // Flat fallback: project the same body and eye geometry onto a 2D canvas.
  draw2d() {
    const c = this.ctx2d, W = this.canvas.width, H = this.canvas.height;
    if (!c || !W || !H) return;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    const halfH = (this.room ? 2.1 : this.viewH) * Math.max(1, H / W), k = H / 2 / halfH;
    c.translate(W / 2, H / 2 + (this.room ? 0.25 : 0) * k);
    c.scale(k, -k);
    const rg = this.rig, hd = this.head;
    c.translate(rg.position.x, rg.position.y); c.rotate(rg.rotation.z); c.scale(rg.scale.x * Math.max(0.15, Math.abs(Math.cos(rg.rotation.y))), rg.scale.y);
    c.translate(hd.position.x, hd.position.y);
    c.fillStyle = '#' + this.bodyMat.color.getHexString();
    c.fill(bodyPath2D());
    if (!this.facing) return;
    const cy = Math.cos(hd.rotation.y), sy = Math.sin(hd.rotation.y), cx = Math.cos(hd.rotation.x), sx = Math.sin(hd.rotation.x);
    const proj = (x, y, z) => { const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return [x1, y * cx - z1 * sx]; };
    c.fillStyle = '#' + this.eyeMat.color.getHexString();
    for (const e of this.eyes) {
      const p = e.p; c.beginPath();
      for (let i = 0; i < COLS; i++) { const q = i * ROWS * 3, [x, y] = proj(p[q], p[q + 1], p[q + 2]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      for (let i = COLS - 1; i >= 0; i--) { const q = (i * ROWS + ROWS - 1) * 3, [x, y] = proj(p[q], p[q + 1], p[q + 2]); c.lineTo(x, y); }
      c.closePath(); c.fill();
    }
  }

  destroy() {
    this.running = false; this.ro?.disconnect(); VIS?.unobserve(this.canvas);
    if (this.onMove) removeEventListener('pointermove', this.onMove);
    if (!this.shared && !this.flat) this.renderer.dispose();
  }
}

// A still picture of an agent, for thumbnails (accessory pickers, lists). Returns a data URL.
// One mascot per size is kept and re-dressed for each picture, so a picker with forty
// tiles builds the body once instead of forty times (and leaves nothing behind on the GPU).
const SNAPS = new Map();
export function snapshot({ color = COLORS.cloud, emotion = 'neutral', outfit = {}, look = [0, 0] } = {}, px = 96, frame = 1.85) {
  const size = Math.round(px * Math.min(devicePixelRatio || 1, 2)), key = size + ':' + frame;
  let m = SNAPS.get(key);
  if (!m) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    m = new Mascot3D(c, { shared: true, still: true, idle: false, frame });
    SNAPS.set(key, m);
  }
  for (const p of m.particles) m.rig.remove(p);
  m.particles.length = 0;
  m.setColor(color); m.setEmotion(emotion, true); m.setOutfit(outfit);
  m.t = 0; m.emoT = 0; m.g = null; m.hopT = undefined;
  m.look(look[0], look[1], { noBlink: true });
  for (let i = 0; i < 40; i++) m.step(1 / 30);
  m.draw();
  return m.canvas.toDataURL('image/png');
}
