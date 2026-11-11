// Hats, and everything else Minus wears on its head.
//
// Each one is built on the head itself: the same rounded envelope the body sits in. A hat's
// rim follows the head all the way round, so it sits on the head instead of floating over
// it, and the head never pokes through. Flat colors, two or three tones, chunky rolled edges,
// and every part touches something (no bits hanging in the air).
import * as THREE from 'three';
import { hatRadiusAt, profile, surfaceZ } from './shape.js';

const TAU = Math.PI * 2, PI = Math.PI;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const flat = (c, side = THREE.DoubleSide) => new THREE.MeshBasicMaterial({ color: c, side });
const mesh = (geo, c, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) => {
  const m = new THREE.Mesh(geo, typeof c === 'string' ? flat(c) : c);
  m.position.set(...(pos.isVector3 ? pos.toArray() : pos)); m.rotation.set(...rot);
  m.scale.set(...(typeof scale === 'number' ? [scale, scale, scale] : scale));
  return m;
};
const group = (...items) => { const g = new THREE.Group(); items.forEach((i) => i && g.add(i)); return g; };
const smooth = (u) => u * u * (3 - 2 * u);
// Geometry is built once per hat and shared by every Minus wearing it.
const GEO = new Map();
const memo = (key, make) => { if (!GEO.has(key)) GEO.set(key, make()); return GEO.get(key); };

/* ───────── the head, as something to build on ───────── */

// Half the thickness of the head envelope (grown by `add`, front and back puffed by `kz`)
// at (x, y), or -1 outside it.
function half(x, y, add, kz) {
  const R = hatRadiusAt(Math.atan2(y, x)) + add, s = Math.hypot(x, y) / R;
  return s >= 1 ? -1 : profile(s) * kz + add * 0.6;
}
const inside = (p, add, kz) => { const h = half(p.x, p.y, add, kz); return h >= 0 && Math.abs(p.z) <= h; };

// A hat's own axes: Y up through the hat, tipped to one side (tilt), forward (lean) or turned.
function frame({ x = 0, tilt = 0, lean = 0, turn = 0 } = {}) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, turn, tilt, 'ZXY'));
  return { o: V(x, 0, 0), q, X: V(1, 0, 0).applyQuaternion(q), Y: V(0, 1, 0).applyQuaternion(q), Z: V(0, 0, 1).applyQuaternion(q) };
}
const N = 120; // points around every ring; ψ = π/2 is straight ahead, 0 is to the right
const PSI = Array.from({ length: N }, (_, i) => (i / N) * TAU);
const FRONT = N / 4;
const dirOf = (F, psi) => F.X.clone().multiplyScalar(Math.cos(psi)).addScaledVector(F.Z, Math.sin(psi));
const at = (F, h, rho, psi) => F.o.clone().addScaledVector(F.Y, h).addScaledVector(dirOf(F, psi), rho);

// How far the head reaches from the hat's axis at height h, in direction ψ.
function reach(F, h, psi, add, kz) {
  if (!inside(at(F, h, 0, psi), add, kz)) return 0;
  let lo = 0, hi = 2.4;
  for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (inside(at(F, h, m, psi), add, kz)) lo = m; else hi = m; }
  return lo;
}
const fit = (F, h, add, kz) => PSI.map((p) => reach(F, h, p, add, kz));
function topOf(F, add, kz) {
  let lo = 0, hi = 2.4;
  for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (inside(at(F, m, 0, 0), add, kz)) lo = m; else hi = m; }
  return lo;
}
// A ring of points around the hat's axis at height h. rho: a number, an array, or (ψ, i) => number.
function ring(F, h, rho, lift = 0) {
  const r = typeof rho === 'function' ? rho : Array.isArray(rho) ? (_, i) => rho[i] : () => rho;
  return PSI.map((p, i) => at(F, h, r(p, i), p).addScaledVector(F.Y, typeof lift === 'function' ? lift(p, i) : lift));
}

// A surface through rings of points (each the same length), optionally closed at either end.
function loft(rings, { wrap = true, top = null, bottom = null } = {}) {
  const n = rings[0].length, pos = [], idx = [], m = wrap ? n : n - 1;
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < m; i++) {
    const a = j * n + i, b = j * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (j, point) => {
    const r = rings[j], c = point || r.reduce((s, p) => s.add(p), V()).divideScalar(n), k = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let i = 0; i < m; i++) idx.push(k, j * n + ((i + 1) % n), j * n + i);
  };
  if (bottom) cap(0, bottom.isVector3 ? bottom : null);
  if (top) cap(rings.length - 1, top.isVector3 ? top : null);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// A dome that hugs the head from height h0 up, closed at the top. lift makes it taller.
function dome(F, { add, kz, h0, lift = 0, rows = 30, from = 0, to = N }) {
  const top = topOf(F, add, kz), rings = [];
  for (let k = 0; k <= rows; k++) {
    const u = k / rows, h = h0 + (top - h0) * Math.sin((u * PI) / 2);
    rings.push(ring(F, h, fit(F, h, add, kz), lift * smooth(u)));
  }
  return { rings, apex: at(F, top, 0, 0).addScaledVector(F.Y, lift), geo: loft(rings, { top: true }) };
}
// One slice of a dome (from index `from` to `to`, wrapping), for hats made of colored panels.
function slice(rings, from, to) {
  const ids = []; for (let i = from; i <= to; i++) ids.push(((i % N) + N) % N);
  return loft(rings.map((r) => ids.map((i) => r[i])), { wrap: false });
}
// A band around the head between two heights.
function band(F, h0, h1, add, kz, rows = 5) {
  const rings = [];
  for (let k = 0; k <= rows; k++) { const h = h0 + ((h1 - h0) * k) / rows; rings.push(ring(F, h, fit(F, h, add, kz))); }
  return { rings, geo: loft(rings) };
}

// A tube through points: closed (a rolled rim) or open (a stem, a cord). bumps makes it
// scalloped (fur trims, frills); taper(u) scales the radius along it.
function tube(points, r, { closed = true, bumps = 0, amount = 0.22, taper = null, segs = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const T = segs || Math.max(48, points.length * 2), R = 14;
  const g = new THREE.TubeGeometry(curve, T, 1, R, closed), p = g.attributes.position;
  for (let i = 0; i <= T; i++) {
    const u = i / T, c = curve.getPointAt(closed ? u % 1 : u);
    let k = r * (bumps ? 1 + amount * Math.cos(bumps * TAU * u) : 1) * (taper ? taper(u) : 1);
    for (let j = 0; j <= R; j++) {
      const n = i * (R + 1) + j;
      p.setXYZ(n, c.x + (p.getX(n) - c.x) * k, c.y + (p.getY(n) - c.y) * k, c.z + (p.getZ(n) - c.z) * k);
    }
  }
  p.needsUpdate = true;
  return g;
}
// A soft, slightly lumpy ball: pom-poms, fluff, puffs.
function puff(r, lumps = 6, amount = 0.08, seed = 0) {
  return memo(`puff:${r}:${lumps}:${amount}:${seed}`, () => {
    const g = new THREE.SphereGeometry(r, 40, 28), p = g.attributes.position, v = V();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const th = Math.atan2(v.z, v.x), ph = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));
      const f = 1 + amount * Math.sin(lumps * th + seed) * Math.sin(lumps * ph + seed * 0.7);
      p.setXYZ(i, v.x * r * f, v.y * r * f, v.z * r * f);
    }
    return g;
  });
}
const ball = (r) => memo(`ball:${r}`, () => new THREE.SphereGeometry(r, 32, 22));
// The visor of a cap: it grows out of the front of the head and curves down a little.
function bill(F, h, add, kz, { reach: w0 = 0.38, span = 1.0, droop = 0.06, thick = 0.035, forward = 0.55 } = {}) {
  const M = 48, inner = [], outer = [];
  for (let k = 0; k <= M; k++) {
    const u = k / M, psi = PI / 2 + (u - 0.5) * 2 * span, w = w0 * Math.pow(Math.sin(PI * u), 0.55);
    const base = at(F, h, reach(F, h, psi, add, kz), psi);
    const dir = dirOf(F, psi).lerp(F.Z, forward).normalize();
    inner.push(base);
    outer.push(base.clone().addScaledVector(dir, w).addScaledVector(F.Y, -droop * (w / w0) ** 1.6));
  }
  const down = (r) => r.map((p) => p.clone().addScaledVector(F.Y, -thick));
  return { top: loft([inner, outer], { wrap: false }), under: loft([outer, down(outer), down(inner)], { wrap: false }), edge: outer };
}
// Rings around a bent cone (wizard and santa hats): each ring follows the head at the base and
// shrinks toward the tip, square to the spine as it bends.
function bentCone(F, base, h0, spine, { rows = 40, shrink = (u) => 1 - u, min = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(spine.map(([x, y, z = 0]) => F.o.clone().addScaledVector(F.X, x).addScaledVector(F.Y, h0 + y).addScaledVector(F.Z, z)));
  const rings = []; let b1 = F.X.clone(), b2 = F.Z.clone(), prevT = F.Y.clone();
  for (let k = 0; k <= rows; k++) {
    const u = k / rows, c = curve.getPointAt(u), t = curve.getTangentAt(u);
    // carry the side axes along the bend (parallel transport) so the cone doesn't twist
    const q = new THREE.Quaternion().setFromUnitVectors(prevT, t); b1.applyQuaternion(q); b2.applyQuaternion(q); prevT = t;
    const s = Math.max(min, shrink(u));
    rings.push(PSI.map((p, i) => c.clone().addScaledVector(b1, base[i] * Math.cos(p) * s).addScaledVector(b2, base[i] * Math.sin(p) * s)));
  }
  return { rings, curve };
}
// Point an object's +Y (or +Z with face) along a direction.
const aim = (obj, dir, axis = V(0, 1, 0)) => { obj.quaternion.setFromUnitVectors(axis, dir.clone().normalize()); return obj; };
function starShape(n, R, r) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) { const a = PI / 2 + (i * PI) / n, rr = i % 2 ? r : R; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  return s;
}
function roundedPoly(points, r) {
  const s = new THREE.Shape(), n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i], a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const p1 = [p[0] + ((a[0] - p[0]) / da) * r, p[1] + ((a[1] - p[1]) / da) * r];
    const p2 = [p[0] + ((b[0] - p[0]) / db) * r, p[1] + ((b[1] - p[1]) / db) * r];
    if (i) s.lineTo(...p1); else s.moveTo(...p1);
    s.quadraticCurveTo(p[0], p[1], ...p2);
  }
  return s;
}
function ellipseShape(rx, ry) { const s = new THREE.Shape(); s.absellipse(0, 0, rx, ry, 0, TAU, false, 0); return s; }
// Something flat drawn on the front of a hat (a logo, a star): always on top, hidden from behind.
const decal = (geo, c, pos, rot = [0, 0, 0], scale = 1) => {
  const m = mesh(geo, new THREE.MeshBasicMaterial({ color: c, depthTest: false, side: THREE.DoubleSide }), pos, rot, scale);
  m.renderOrder = 4; m.userData.face = true; return m;
};
// A point on the outline of the head (in the plane of the face), `add` outside it.
const edge = (t, add = 0, z = 0) => V(Math.cos(t) * (hatRadiusAt(t) + add), Math.sin(t) * (hatRadiusAt(t) + add), z);

/* ───────── the wardrobe ───────── */
// Each takes ctx: { body } (the body's own material, for ears that are part of Minus).
export const HEAD = {
  beanie: () => {
    const F = frame({ tilt: -0.1, x: 0.02 });
    const k = memo('beanie', () => {
      const d = dome(F, { add: 0.04, kz: 1.16, h0: 0.44, lift: 0.24 });
      const c = band(F, 0.38, 0.6, 0.065, 1.22, 4);
      return { dome: d.geo, apex: d.apex, cuff: c.geo, lo: tube(c.rings[0], 0.045), hi: tube(c.rings[4], 0.04) };
    });
    const knit = '#e9a93a', fold = '#cf8c1f';
    return group(mesh(k.dome, knit), mesh(k.cuff, fold), mesh(k.lo, fold), mesh(k.hi, fold),
      mesh(puff(0.19, 6, 0.1), '#f6f1e6', k.apex.clone().addScaledVector(F.Y, 0.09)),
      mesh(puff(0.11, 5, 0.1, 2), '#e8dfcc', k.apex.clone().addScaledVector(F.Y, 0.06).add(V(0.09, -0.03, 0.08))));
  },
  cap: () => {
    const F = frame({ tilt: -0.08, turn: 0.42 });
    const k = memo('cap', () => {
      const d = dome(F, { add: 0.04, kz: 1.14, h0: 0.5, lift: 0.08 });
      const b = bill(F, 0.5, 0.055, 1.18, { reach: 0.46, span: 1.0, droop: 0.15, forward: 0.7 });
      const c = at(F, 0.5, 0, 0), seams = [FRONT - 20, FRONT + 20].map((i) => tube(d.rings.slice(0, -2).map((r) => r[i].clone().sub(c).multiplyScalar(1.012).add(c)).concat([d.apex]), 0.011, { closed: false }));
      const logo = at(F, 0.72, reach(F, 0.72, PI / 2, 0.04, 1.14) + 0.02, PI / 2).addScaledVector(F.Y, 0.08 * smooth(0.45));
      return { dome: d.geo, apex: d.apex, top: b.top, under: b.under, rim: tube(ring(F, 0.5, fit(F, 0.5, 0.055, 1.18)), 0.03), seams, logo };
    });
    const navy = '#33407a', dark = '#252f5c';
    const logo = decal(new THREE.ShapeGeometry(roundedPoly([[-0.1, -0.03], [0.1, -0.03], [0.1, 0.03], [-0.1, 0.03]], 0.028), 8), '#f3f2ee', k.logo);
    logo.quaternion.copy(F.q);
    return group(mesh(k.dome, navy), mesh(k.top, dark), mesh(k.under, '#1b2246'), mesh(k.rim, dark),
      ...k.seams.map((s) => mesh(s, dark)), mesh(puff(0.055, 3, 0.02), dark, k.apex.clone().addScaledVector(F.Y, 0.01)), logo);
  },
  headband: () => {
    const F = frame({ tilt: -0.14 });
    const k = memo('headband', () => {
      const b = band(F, 0.5, 0.64, 0.05, 1.18, 4);
      const knot = at(F, 0.57, reach(F, 0.57, 0, 0.05, 1.18) + 0.03, 0);
      const tail = (dy, dz) => tube([knot, knot.clone().addScaledVector(F.X, 0.12).addScaledVector(F.Y, dy * 0.5).addScaledVector(F.Z, dz),
        knot.clone().addScaledVector(F.X, 0.24).addScaledVector(F.Y, dy).addScaledVector(F.Z, dz * 1.6)], 0.06, { closed: false, taper: (u) => 1 - u * 0.55 });
      return { band: b.geo, lo: tube(b.rings[0], 0.02), hi: tube(b.rings[4], 0.02), knot, t1: tail(0.13, -0.06), t2: tail(-0.12, -0.02) };
    });
    const red = '#e5484d', dark = '#c23a40';
    return group(mesh(k.band, red), mesh(k.lo, red), mesh(k.hi, red), mesh(k.t1, dark), mesh(k.t2, dark), mesh(puff(0.085, 3, 0.06), red, k.knot));
  },
  crown: () => {
    const F = frame({ tilt: -0.17, x: 0.05 });
    const k = memo('crown', () => {
      const h = 0.8, base = fit(F, h, 0.035, 1.22);
      const spike = (p) => { const f = ((((p - PI / 2) / TAU) * 5) % 1 + 1) % 1, tri = Math.abs(2 * f - 1); return 0.15 + 0.24 * Math.pow(smooth(tri), 1.5); };
      const rows = [0, 0.4, 1].map((v) => ring(F, h, (p, i) => base[i] * (1 + 0.08 * v) + 0.015 * v, (p) => spike(p) * v));
      const tips = [0, 1, 2, 3, 4].map((j) => { const p = PI / 2 + (j * TAU) / 5; return at(F, h, reach(F, h, p, 0.035, 1.22) * 1.08 + 0.015, p).addScaledVector(F.Y, 0.4); });
      const gem = (p, y) => at(F, h + y, reach(F, h, p, 0.035, 1.22) * 1.04 + 0.03, p);
      return { wall: loft(rows), rim: tube(rows[0], 0.035), lip: tube(rows[2], 0.016, { segs: 360 }), tips, gems: [gem(PI / 2, 0.09), gem(PI / 2 + 0.95, 0.08), gem(PI / 2 - 0.95, 0.08)] };
    });
    const g = group(mesh(k.wall, flat('#f6c445', THREE.FrontSide)), mesh(k.wall, flat('#c9921d', THREE.BackSide)), mesh(k.rim, '#d9a21f'), mesh(k.lip, '#f6c445'),
      ...k.tips.map((p) => mesh(ball(0.042), '#fff2c2', p)),
      mesh(ball(0.052), '#e5484d', k.gems[0]), mesh(ball(0.04), '#4f92f6', k.gems[1]), mesh(ball(0.04), '#4f92f6', k.gems[2]));
    return g;
  },
  'cat ears': (ctx) => {
    const ear = memo('cat ear', () => new THREE.ExtrudeGeometry(roundedPoly([[-0.22, 0], [0.22, 0], [0.02, 0.4]], 0.075), { depth: 0.09, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 4, curveSegments: 12 }));
    const inner = memo('cat ear in', () => new THREE.ShapeGeometry(roundedPoly([[-0.12, 0.05], [0.12, 0.05], [0.015, 0.27]], 0.05), 12));
    const one = (s) => {
      const t = PI / 2 - s * 0.72, p = edge(t, -0.14);
      const g = group(mesh(ear, ctx.body, [0, 0, -0.045]), mesh(inner, '#ff9fb4', [0, 0.02, 0.075]));
      g.position.copy(p); g.rotation.z = t - PI / 2 + s * 0.08; g.scale.set(-s, 1, 1);
      return g;
    };
    return group(one(-1), one(1));
  },
  antenna: () => {
    const k = memo('antenna', () => tube([V(0, 0.84, 0), V(0, 1.1, 0), V(0.05, 1.3, 0), V(0.17, 1.44, 0)], 0.034, { closed: false, taper: (u) => 1 - u * 0.35 }));
    const g = group(
      mesh(puff(0.11, 3, 0.02), '#2b2b31', [0, 0.99, 0], [0, 0, 0], [1, 0.42, 0.8]),
      mesh(k, '#2b2b31'),
      mesh(ball(0.11), '#5fcfa6', [0.18, 1.48, 0]),
      mesh(ball(0.045), '#b6f0da', [0.14, 1.52, 0.07]),
    );
    g.userData.sway = 0.06; return g;
  },
  headphones: () => {
    const k = memo('headphones', () => {
      const pts = []; for (let i = 0; i <= 60; i++) { const t = 0.06 + ((PI - 0.12) * i) / 60; pts.push(edge(t, 0.085)); }
      const pad = []; for (let i = 0; i <= 30; i++) { const t = PI / 2 - 0.85 + (1.7 * i) / 30; pad.push(edge(t, 0.05)); }
      return { band: tube(pts, 0.05, { closed: false }), pad: tube(pad, 0.045, { closed: false, taper: (u) => Math.min(1, Math.sin(PI * u) * 3) }), x: hatRadiusAt(0) + 0.1 };
    });
    const dark = '#2b2b31', mid = '#3d3d45';
    const cup = (s) => group(
      mesh(ball(0.3), dark, [0, 0, 0], [0, 0, 0], [0.5, 1, 0.92]),
      mesh(ball(0.26), mid, [-s * 0.07, 0, 0], [0, 0, 0], [0.42, 0.92, 0.85]),
      mesh(memo('disc', () => new THREE.CylinderGeometry(0.16, 0.16, 0.03, 40)), '#5fcfa6', [s * 0.14, 0, 0], [0, 0, PI / 2]),
    );
    const l = cup(-1), r = cup(1); l.position.set(-k.x, -0.02, 0); r.position.set(k.x, -0.02, 0);
    return group(mesh(k.band, dark), mesh(k.pad, mid), l, r);
  },
  'party hat': () => {
    const F = frame({ tilt: -0.3, x: 0.1 });
    const k = memo('party hat', () => {
      const h0 = 0.84, H = 0.92, base = fit(F, h0, 0.03, 1.2);
      const ringAt = (u) => ring(F, h0 + H * u, (p, i) => base[i] * (1 - u) * (1 + 0.04 * Math.sin(PI * u)));
      const stops = [0, 0.24, 0.48, 0.72, 1];
      const bands = stops.slice(0, -1).map((a, s) => { const b = stops[s + 1], rs = []; for (let q = 0; q <= 8; q++) rs.push(ringAt(a + ((b - a) * q) / 8)); return loft(rs); });
      return { bands, trim: tube(ring(F, h0 + 0.01, base.map((r) => r + 0.015)), 0.06, { bumps: 15, amount: 0.32, segs: 240 }), apex: at(F, h0 + H, 0, 0) };
    });
    return group(...k.bands.map((b, i) => mesh(b, i % 2 ? '#ffd25e' : '#ff6b8f')), mesh(k.trim, '#fff4e0'), mesh(puff(0.1, 5, 0.12), '#fff4e0', k.apex.clone().addScaledVector(F.Y, 0.04)));
  },
  shades: () => {
    const lens = memo('shade lens', () => new THREE.ShapeGeometry(roundedPoly([[-0.18, -0.12], [0.18, -0.12], [0.18, 0.12], [-0.18, 0.12]], 0.1), 12));
    const y = 0.62, z = surfaceZ(0, y) + 0.06;
    const g = group(
      decal(lens, '#141417', [-0.21, 0, 0]), decal(lens, '#141417', [0.21, 0, 0]),
      decal(new THREE.PlaneGeometry(0.1, 0.045), '#141417', [0, 0.04, 0]),
      decal(new THREE.PlaneGeometry(0.05, 0.13), '#3a3a42', [-0.28, 0.02, 0.002], [0, 0, -0.6]),
      decal(new THREE.PlaneGeometry(0.05, 0.13), '#3a3a42', [0.14, 0.02, 0.002], [0, 0, -0.6]),
    );
    g.position.set(0, y, z); g.rotation.x = -0.3; g.scale.setScalar(1.05); return g;
  },
  bow: () => {
    const pink = '#ff6b8f', deep = '#e2507a';
    const wing = (s) => group(mesh(ball(1), pink, [s * 0.15, 0, 0], [0, 0, s * 0.18], [0.17, 0.13, 0.07]), mesh(ball(1), deep, [s * 0.17, 0, 0.045], [0, 0, s * 0.18], [0.07, 0.05, 0.03]));
    const t = 0.95, p = edge(t, -0.06, 0), z = surfaceZ(p.x, p.y);
    const g = group(wing(1), wing(-1),
      mesh(tube([V(0.02, -0.04, 0), V(0.08, -0.16, 0), V(0.1, -0.26, 0)], 0.035, { closed: false, taper: (u) => 1 - u * 0.4 }), deep),
      mesh(tube([V(-0.02, -0.04, 0), V(-0.06, -0.16, 0), V(-0.05, -0.27, 0)], 0.035, { closed: false, taper: (u) => 1 - u * 0.4 }), deep),
      mesh(puff(0.07, 3, 0.05), deep));
    g.position.set(p.x, p.y, z + 0.02); g.rotation.set(-0.35, 0, t - PI / 2 - 0.25); g.scale.setScalar(1.1); return g;
  },
  sprout: () => {
    const leaf = memo('leaf', () => {
      const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(0.13, 0.05, 0.21, 0.2, 0.0, 0.36); s.bezierCurveTo(-0.21, 0.2, -0.13, 0.05, 0, 0);
      return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 20 });
    });
    const vein = memo('vein', () => new THREE.PlaneGeometry(0.014, 0.24));
    const one = (s) => group(mesh(leaf, s > 0 ? '#5fcf6a' : '#4ab35a', [0, 0, -0.01]), mesh(vein, '#3f9a52', [0, 0.14, 0.024]));
    const l = one(1), r = one(-1);
    l.position.set(0, 1.18, 0); l.rotation.z = -0.95; r.position.set(0, 1.18, 0.005); r.rotation.z = 0.95; r.scale.setScalar(0.85);
    const g = group(mesh(memo('sprout stem', () => tube([V(0, 0.86, 0), V(0.01, 1.04, 0), V(0, 1.2, 0)], 0.026, { closed: false })), '#3f9a52'), l, r);
    g.userData.sway = 0.1; return g;
  },
  /* ───── more hats ───── */
  'top hat': () => {
    const F = frame({ tilt: -0.16, x: 0.06 });
    const k = memo('top hat', () => {
      const h0 = 0.8, H = 0.62, head = fit(F, h0, 0.04, 1.22);
      const oval = (rx, rz) => PSI.map((p) => (rx * rz) / Math.hypot(rz * Math.cos(p), rx * Math.sin(p)));
      const crown0 = oval(0.42, 0.33).map((r, i) => Math.max(r, head[i] + 0.02));
      const crownAt = (u) => { const o = oval(0.42 + 0.03 * u, 0.33 + 0.02 * u); return ring(F, h0 + H * u, (p, i) => crown0[i] + (o[i] - crown0[i]) * smooth(Math.min(1, u * 4))); };
      const rows = []; for (let q = 0; q <= 10; q++) rows.push(crownAt(q / 10));
      const lip = ring(F, h0, crown0), out = oval(0.72, 0.56);
      const outer = ring(F, h0, out, (p) => 0.075 * Math.cos(p) ** 2);
      const mid = ring(F, h0, (p, i) => (crown0[i] + out[i]) / 2, (p) => 0.018 * Math.cos(p) ** 2);
      const down = (r) => r.map((p) => p.clone().addScaledVector(F.Y, -0.035));
      const ribbon = []; for (let q = 0; q <= 3; q++) ribbon.push(ring(F, h0 + 0.04 + 0.03 * q, (p, i) => crown0[i] + (oval(0.42, 0.33)[i] - crown0[i]) * smooth(Math.min(1, ((0.04 + 0.03 * q) / H) * 4)) + 0.012));
      return { crown: loft(rows, { top: true }), brimTop: loft([lip, mid, outer]), brimUnder: loft([outer, down(outer), down(mid), down(lip)]), edge: tube(outer.map((p) => p.clone().addScaledVector(F.Y, -0.017)), 0.022, { segs: 240 }), ribbon: loft(ribbon) };
    });
    return group(mesh(k.crown, '#323b6b'), mesh(k.brimTop, '#283058'), mesh(k.brimUnder, '#1d2346'), mesh(k.edge, '#283058'), mesh(k.ribbon, '#e5484d'));
  },
  'wizard hat': () => {
    const F = frame({ tilt: -0.1, x: 0.03 });
    const k = memo('wizard hat', () => {
      const h0 = 0.62, base = fit(F, h0, 0.04, 1.22);
      const cone = bentCone(F, base, h0, [[0, 0], [0, 0.45], [0.06, 0.82], [0.26, 1.08], [0.5, 1.02]], { shrink: (u) => Math.pow(1 - u, 1.05), min: 0.0 });
      const outer = ring(F, h0, (p, i) => base[i] + 0.34, (p) => -0.07 + 0.035 * Math.sin(5 * p + 0.6));
      const mid = ring(F, h0, (p, i) => base[i] + 0.17, (p) => -0.02 + 0.01 * Math.sin(5 * p + 0.6));
      const lip = ring(F, h0, base);
      const down = (r) => r.map((p) => p.clone().addScaledVector(F.Y, -0.03));
      const bandRows = cone.rings.slice(2, 7).map((r, j) => r.map((p) => p.clone()));
      const scale = (r, s, c) => r.map((p) => p.clone().sub(c).multiplyScalar(s).add(c));
      const bandGeo = loft(bandRows.map((r, j) => scale(r, 1.035, cone.curve.getPointAt((j + 2) / 40))));
      const star = (u, side, s) => { const r = cone.rings[Math.round(u * 40)], c = cone.curve.getPointAt(u), p = r[FRONT + Math.round(side * 14)]; return { p: p.clone().add(p.clone().sub(c).multiplyScalar(0.06)), s }; };
      return { cone: loft(cone.rings, { top: true }), brimTop: loft([lip, mid, outer]), brimUnder: loft([outer, down(outer), down(mid), down(lip)]), edge: tube(outer, 0.022, { segs: 300 }), band: bandGeo,
        stars: [star(0.32, -0.3, 1), star(0.55, 0.35, 0.7), star(0.22, 0.75, 0.6)] };
    });
    const st = memo('star', () => new THREE.ShapeGeometry(starShape(5, 0.09, 0.042), 1));
    return group(mesh(k.cone, '#5b4bd6'), mesh(k.brimTop, '#4a3cb8'), mesh(k.brimUnder, '#3a2e98'), mesh(k.edge, '#4a3cb8'), mesh(k.band, '#ffd25e'),
      ...k.stars.map(({ p, s }) => { const d = decal(st, '#ffd25e', p, [0, 0, 0], s); d.quaternion.copy(F.q); return d; }));
  },
  'chef hat': () => {
    const F = frame({ tilt: 0.06 });
    const k = memo('chef hat', () => {
      const h0 = 0.62, H = 0.34, base = fit(F, h0, 0.04, 1.22);
      const rows = []; for (let q = 0; q <= 6; q++) rows.push(ring(F, h0 + (H * q) / 6, (p, i) => base[i] * (1 + 0.07 * (q / 6) ** 1.5)));
      const c0 = at(F, 0, 0, 0), pleats = [-3, -2, -1, 0, 1, 2, 3].map((j) => tube(rows.map((r) => r[FRONT + j * 7].clone().add(r[FRONT + j * 7].clone().sub(c0).setLength(0.006))), 0.008, { closed: false }));
      // the puffy top: one closed, lumpy cushion that spills over the band, so there's no gap to see into
      const top = base.map((r) => r * 1.07), puffy = [[1.0, 0], [1.14, 0.08], [1.2, 0.2], [1.13, 0.34], [0.92, 0.47], [0.58, 0.56], [0, 0.6]];
      const crown = puffy.map(([sc, y]) => ring(F, h0 + H, (p, i) => top[i] * sc * (1 + 0.06 * Math.sin(7 * p + 0.4) * Math.min(1, sc)), y));
      const w = top[0], d = top[FRONT], c = at(F, h0 + H, 0, 0);
      const lumps = [[-w * 0.55, 0.36, 0, 0.32], [w * 0.55, 0.36, 0, 0.32], [0, 0.5, d * 0.1, 0.34], [-w * 0.22, 0.46, d * 0.35, 0.28], [w * 0.25, 0.46, d * 0.35, 0.28], [0, 0.44, -d * 0.4, 0.3]]
        .map(([x, y, z, r]) => ({ p: c.clone().addScaledVector(F.X, x).addScaledVector(F.Y, y).addScaledVector(F.Z, z), r }));
      return { band: loft(rows), pleats, lip: tube(rows[0], 0.03), crown: loft(crown, { top: true }), lumps };
    });
    return group(mesh(k.band, '#ece8de'), mesh(k.lip, '#e1dccf'), ...k.pleats.map((p) => mesh(p, '#d8d2c3')), mesh(k.crown, '#ffffff'),
      ...k.lumps.map(({ p, r }, i) => mesh(puff(r, 4, 0.05, i), '#ffffff', p, [0, 0, 0], [1, 0.75, 0.85])));
  },
  'bucket hat': () => {
    const F = frame({ tilt: -0.07 });
    const k = memo('bucket hat', () => {
      const h0 = 0.5, d = dome(F, { add: 0.045, kz: 1.16, h0, lift: 0.05 }), base = fit(F, h0, 0.05, 1.2);
      const lip = ring(F, h0, base), mid = ring(F, h0, (p, i) => base[i] + 0.14, -0.045), outer = ring(F, h0, (p, i) => base[i] + 0.28, -0.13);
      const down = (r) => r.map((p) => p.clone().addScaledVector(F.Y, -0.03));
      const b = band(F, h0, h0 + 0.1, 0.07, 1.22, 2);
      const stitch = ring(F, h0, (p, i) => base[i] + 0.2, -0.085).map((p) => p.addScaledVector(F.Y, 0.008));
      return { dome: d.geo, top: loft([lip, mid, outer]), under: loft([outer, down(outer), down(mid), down(lip)]), edge: tube(outer.map((p) => p.clone().addScaledVector(F.Y, -0.015)), 0.02, { segs: 240 }), band: b.geo, stitch: tube(stitch, 0.008, { segs: 240 }) };
    });
    return group(mesh(k.dome, '#d9c7a1'), mesh(k.top, '#cdb98f'), mesh(k.under, '#a99367'), mesh(k.edge, '#cdb98f'), mesh(k.band, '#8a7550'), mesh(k.stitch, '#b8a274'));
  },
  'cowboy hat': () => {
    const F = frame({ tilt: 0.1, x: -0.02 });
    const k = memo('cowboy hat', () => {
      const h0 = 0.66, H = 0.42, base = fit(F, h0, 0.04, 1.22);
      const rows = []; for (let q = 0; q <= 10; q++) { const u = q / 10; rows.push(ring(F, h0 + H * u, (p, i) => base[i] * (1 - 0.14 * u) * (1 - 0.16 * u ** 3 * Math.abs(Math.sin(p))))); }
      const dent = at(F, h0 + H - 0.1, 0, 0);
      const lip = ring(F, h0, (p, i) => base[i] + 0.01);
      const brimAt = (v) => ring(F, h0, (p, i) => base[i] + 0.4 * v, (p) => 0.24 * Math.cos(p) ** 2 * v * v - 0.035 * Math.sin(p) ** 2 * v);
      const rowsB = [lip, brimAt(0.35), brimAt(0.7), brimAt(1)];
      const down = (r) => r.map((p) => p.clone().addScaledVector(F.Y, -0.035));
      const bandR = []; for (let q = 0; q <= 2; q++) bandR.push(ring(F, h0 + 0.02 + 0.05 * q, (p, i) => base[i] * (1 - 0.14 * ((0.02 + 0.05 * q) / H)) + 0.015));
      return { crown: loft(rows, { top: dent }), brimTop: loft(rowsB), brimUnder: loft([...rowsB].reverse().map(down)), edge: tube(rowsB[3].map((p) => p.clone().addScaledVector(F.Y, -0.017)), 0.022, { segs: 300 }), band: loft(bandR) };
    });
    return group(mesh(k.crown, '#a8693a'), mesh(k.brimTop, '#8f5730'), mesh(k.brimUnder, '#6f4224'), mesh(k.edge, '#8f5730'), mesh(k.band, '#3b2416'));
  },
  'viking helmet': () => {
    const F = frame({ tilt: -0.04 });
    const k = memo('viking helmet', () => {
      const d = dome(F, { add: 0.05, kz: 1.18, h0: 0.46, lift: 0.04 });
      const b = band(F, 0.42, 0.56, 0.1, 1.26, 3);
      const ridge = tube(d.rings.slice(0, -1).map((r) => r[FRONT]).concat([d.apex], d.rings.slice(0, -1).reverse().map((r) => r[FRONT + N / 2])), 0.03, { closed: false });
      const rivets = []; for (let j = 0; j < 12; j++) { const p = (j / 12) * TAU + PI / 24; rivets.push(at(F, 0.49, reach(F, 0.49, p, 0.1, 1.26) + 0.005, p)); }
      const horn = (s) => {
        const p = s > 0 ? 0 : PI, h = 0.7, o = at(F, h, reach(F, h, p, 0.05, 1.18) - 0.1, p), X = F.X.clone().multiplyScalar(s);
        const pts = [o, o.clone().addScaledVector(X, 0.3).addScaledVector(F.Y, 0.02), o.clone().addScaledVector(X, 0.48).addScaledVector(F.Y, 0.2), o.clone().addScaledVector(X, 0.5).addScaledVector(F.Y, 0.52)];
        return { horn: tube(pts, 0.135, { closed: false, taper: (u) => Math.max(0.1, 1 - u * 0.95) }), cuff: tube([pts[0], o.clone().addScaledVector(X, 0.17).addScaledVector(F.Y, 0.005)], 0.15, { closed: false }) };
      };
      return { dome: d.geo, band: b.geo, lo: tube(b.rings[0], 0.03), hi: tube(b.rings[3], 0.03), ridge, rivets, L: horn(-1), R: horn(1) };
    });
    return group(mesh(k.dome, '#a3acb6'), mesh(k.ridge, '#c2c9d1'), mesh(k.band, '#7f8892'), mesh(k.lo, '#7f8892'), mesh(k.hi, '#7f8892'),
      ...k.rivets.map((p) => mesh(ball(0.028), '#c2c9d1', p)),
      mesh(k.L.horn, '#efe6d2'), mesh(k.R.horn, '#efe6d2'), mesh(k.L.cuff, '#7f8892'), mesh(k.R.cuff, '#7f8892'));
  },
  'hard hat': () => {
    const F = frame({ tilt: -0.08 });
    const k = memo('hard hat', () => {
      const h0 = 0.48, d = dome(F, { add: 0.065, kz: 1.22, h0, lift: 0.1 }), base = fit(F, h0, 0.07, 1.24);
      const lip = ring(F, h0, base), outer = ring(F, h0, (p, i) => base[i] + 0.06 + 0.16 * Math.max(0, Math.sin(p)) ** 2, (p) => -0.02 - 0.03 * Math.max(0, Math.sin(p)) ** 2);
      const down = (r) => r.map((p) => p.clone().addScaledVector(F.Y, -0.035));
      const ridge = (di) => tube(d.rings.slice(0, -2).map((r) => r[FRONT + di].clone().addScaledVector(F.Y, 0.0))
        .concat([d.apex.clone()]).concat(d.rings.slice(0, -2).reverse().map((r) => r[(FRONT + N / 2 - di + N) % N])), 0.035, { closed: false });
      return { dome: d.geo, top: loft([lip, outer]), under: loft([outer, down(outer), down(lip)]), edge: tube(outer.map((p) => p.clone().addScaledVector(F.Y, -0.017)), 0.02, { segs: 240 }), ridge: ridge(0) };
    });
    return group(mesh(k.dome, '#f5c03a'), mesh(k.top, '#e3ae2c'), mesh(k.under, '#c99520'), mesh(k.edge, '#e3ae2c'), mesh(k.ridge, '#ffd75e'));
  },
  'grad cap': () => {
    const F = frame({ tilt: -0.05 });
    const k = memo('grad cap', () => {
      const d = dome(F, { add: 0.04, kz: 1.16, h0: 0.58, lift: -0.02 });
      return { skull: d.geo, apex: d.apex, lip: tube(d.rings[0], 0.028) };
    });
    const gold = '#f5c03a';
    const board = group(
      mesh(memo('board', () => new THREE.BoxGeometry(0.96, 0.05, 0.96)), '#1f2333'),
      mesh(memo('board top', () => new THREE.BoxGeometry(0.93, 0.012, 0.93)), '#454c6e', [0, 0.026, 0]),
      mesh(ball(0.05), gold, [0, 0.04, 0], [0, 0, 0], [1, 0.6, 1]),
      mesh(memo('tassel cord', () => tube([V(0, 0.04, 0), V(0.24, 0.038, 0.24), V(0.47, 0.034, 0.47), V(0.5, -0.06, 0.5), V(0.5, -0.24, 0.5)], 0.016, { closed: false })), gold),
      mesh(memo('tassel', () => new THREE.CylinderGeometry(0.032, 0.06, 0.17, 18)), gold, [0.5, -0.32, 0.5]),
    );
    board.rotation.set(0.5, PI / 4, 0, 'XYZ');
    board.position.copy(k.apex).addScaledVector(F.Y, 0.02);
    return group(mesh(k.skull, '#2f3449'), mesh(k.lip, '#262a3c'), board);
  },
  'propeller cap': () => {
    const F = frame({ tilt: -0.06 });
    const k = memo('propeller cap', () => {
      const d = dome(F, { add: 0.045, kz: 1.16, h0: 0.5, lift: 0.06 });
      const panels = [0, 1, 2, 3].map((s) => slice(d.rings, FRONT - N / 8 + (s * N) / 4, FRONT - N / 8 + ((s + 1) * N) / 4));
      const b = bill(F, 0.5, 0.055, 1.18, { reach: 0.22, span: 0.8, droop: 0.03 });
      return { panels, apex: d.apex, top: b.top, under: b.under, rim: tube(ring(F, 0.5, fit(F, 0.5, 0.055, 1.18)), 0.03) };
    });
    const prop = group(
      mesh(ball(1), '#e5484d', [0.2, 0, 0], [0, 0, 0], [0.21, 0.025, 0.075]), mesh(ball(1), '#e5484d', [-0.2, 0, 0], [0, 0, 0], [0.21, 0.025, 0.075]),
      mesh(ball(0.045), '#ffd25e'));
    prop.position.y = 0.17; prop.userData.spin = 9;
    const stem = group(mesh(memo('prop stem', () => new THREE.CylinderGeometry(0.018, 0.022, 0.18, 12)), '#2b2b31', [0, 0.08, 0]), prop);
    stem.quaternion.copy(F.q); stem.position.copy(k.apex);
    return group(...k.panels.map((p, i) => mesh(p, ['#e5484d', '#ffd25e', '#4f92f6', '#5fcf6a'][i])), mesh(k.top, '#4f92f6'), mesh(k.under, '#3a76d6'), mesh(k.rim, '#ffd25e'), stem);
  },
  visor: () => {
    const F = frame({ tilt: -0.06 });
    const k = memo('visor', () => {
      const b = band(F, 0.5, 0.62, 0.05, 1.18, 3);
      const v = bill(F, 0.5, 0.055, 1.18, { reach: 0.46, span: 1.05, droop: 0.16, forward: 0.7 });
      return { band: b.geo, lo: tube(b.rings[0], 0.02), hi: tube(b.rings[3], 0.02), top: v.top, under: v.under };
    });
    return group(mesh(k.band, '#f3f2ee'), mesh(k.lo, '#e5484d'), mesh(k.hi, '#e5484d'), mesh(k.top, '#e5484d'), mesh(k.under, '#b9353a'));
  },
  'santa hat': () => {
    const F = frame({ tilt: -0.08 });
    const k = memo('santa hat', () => {
      const h0 = 0.5, base = fit(F, h0, 0.05, 1.2);
      const cone = bentCone(F, base, h0, [[0, 0], [0, 0.36], [0.05, 0.62], [0.3, 0.78], [0.58, 0.62]], { shrink: (u) => Math.pow(1 - u, 1.1), min: 0.1 });
      const tip = cone.curve.getPointAt(1);
      return { cone: loft(cone.rings, { top: true }), trim: tube(ring(F, h0 + 0.03, base.map((r) => r + 0.025)), 0.1, { bumps: 18, amount: 0.16, segs: 300 }), tip };
    });
    return group(mesh(k.cone, '#e5484d'), mesh(k.trim, '#f6f3ec'), mesh(puff(0.13, 6, 0.1), '#f6f3ec', k.tip));
  },
  goggles: () => {
    const F = frame({ tilt: -0.04 });
    const k = memo('goggles', () => {
      const b = band(F, 0.54, 0.66, 0.045, 1.18, 3);
      const lens = (side) => { const p = PI / 2 + side * 0.42, h = 0.6, o = at(F, h, reach(F, h, p, 0.045, 1.18), p), n = dirOf(F, p).addScaledVector(F.Y, 0.35).normalize(); return { o, n }; };
      const L = lens(1), R = lens(-1);
      return { band: b.geo, L, R, bridge: tube([L.o.clone().addScaledVector(L.n, 0.06), L.o.clone().lerp(R.o, 0.5).addScaledVector(F.Z, 0.08), R.o.clone().addScaledVector(R.n, 0.06)], 0.025, { closed: false }) };
    });
    const one = ({ o, n }) => {
      const g = group(
        mesh(memo('goggle cup', () => new THREE.CylinderGeometry(0.17, 0.19, 0.12, 36)), '#3a3a42', [0, 0.05, 0]),
        mesh(memo('goggle rim', () => new THREE.TorusGeometry(0.16, 0.025, 10, 36)), '#4a4a54', [0, 0.11, 0], [PI / 2, 0, 0]),
        mesh(memo('goggle glass', () => new THREE.CircleGeometry(0.135, 36)), '#8fd0ff', [0, 0.113, 0], [-PI / 2, 0, 0]),
        mesh(memo('goggle shine', () => new THREE.CircleGeometry(0.045, 20)), '#d6eeff', [-0.05, 0.116, -0.05], [-PI / 2, 0, 0]),
      );
      g.position.copy(o); return aim(g, n);
    };
    return group(mesh(k.band, '#2b2b31'), mesh(k.bridge, '#2b2b31'), one(k.L), one(k.R));
  },
  headset: (ctx) => {
    const g = HEAD.headphones(ctx), x = hatRadiusAt(PI) + 0.1;
    g.add(mesh(memo('boom', () => tube([V(-x + 0.08, -0.08, 0.12), V(-x + 0.12, -0.45, 0.3), V(-0.72, -0.56, 0.42), V(-0.5, -0.55, surfaceZ(-0.5, -0.55) + 0.06)], 0.026, { closed: false })), '#2b2b31'));
    g.add(mesh(ball(0.07), '#2b2b31', [-0.48, -0.55, surfaceZ(-0.5, -0.55) + 0.06], [0, 0, 0], [1.3, 1, 1]));
    return g;
  },
  earmuffs: () => {
    const k = memo('earmuffs', () => {
      const pts = []; for (let i = 0; i <= 60; i++) { const t = 0.1 + ((PI - 0.2) * i) / 60; pts.push(edge(t, 0.05)); }
      return { band: tube(pts, 0.04, { closed: false }), x: hatRadiusAt(0) + 0.08 };
    });
    return group(mesh(k.band, '#e5484d'),
      mesh(puff(0.28, 7, 0.07), '#ffb3c7', [-k.x, 0, 0], [0, 0, 0], [0.72, 1, 1]), mesh(puff(0.28, 7, 0.07, 1), '#ffb3c7', [k.x, 0, 0], [0, 0, 0], [0.72, 1, 1]));
  },
  'bunny ears': (ctx) => {
    const ear = memo('bunny ear', () => new THREE.ExtrudeGeometry(ellipseShape(0.13, 0.4), { depth: 0.07, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 4, curveSegments: 24 }));
    const inner = memo('bunny ear in', () => new THREE.ShapeGeometry(ellipseShape(0.07, 0.3), 24));
    const one = (s, lean) => {
      const t = PI / 2 - s * 0.3, p = edge(t, -0.16);
      const g = group(mesh(ear, ctx.body, [0, 0.4, -0.035]), mesh(inner, '#ff9fb4', [0, 0.42, 0.065]));
      g.position.copy(p); g.rotation.z = -s * lean;
      return g;
    };
    return group(one(-1, 0.16), one(1, 0.5));
  },
  'bear ears': (ctx) => {
    const one = (s) => {
      const t = PI / 2 - s * 0.62, p = edge(t, -0.03);
      const g = group(mesh(ball(0.22), ctx.body, [0, 0, 0], [0, 0, 0], [1, 1, 0.6]),
        mesh(memo('bear in', () => new THREE.CircleGeometry(0.12, 28)), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16 }), [0, 0.01, 0.135]));
      g.position.copy(p); return g;
    };
    return group(one(-1), one(1));
  },
  'devil horns': () => {
    const horn = (s) => {
      const t = PI / 2 - s * 0.38, p = edge(t, -0.1, 0.06);
      return mesh(memo('devil horn', () => tube([V(0, 0, 0), V(0.03, 0.17, 0), V(0.14, 0.28, 0)], 0.09, { closed: false, taper: (u) => Math.max(0.1, 1 - u * 0.95) })), '#e0443e', p, [0, 0, 0], [s, 1, 1]);
    };
    return group(horn(-1), horn(1));
  },
  curl: () => {
    const k = memo('curl', () => tube([V(0, 0.86, 0), V(0.01, 1.1, 0), V(0.14, 1.26, 0), V(0.3, 1.24, 0), V(0.32, 1.1, 0), V(0.18, 1.06, 0)], 0.1, { closed: false, taper: (u) => 1 - u * 0.62 }));
    const g = group(mesh(k, '#2b2b31')); g.userData.sway = 0.05; return g;
  },
  flower: () => {
    const g = group(), petal = ball(0.075);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; g.add(mesh(petal, '#ff8fb1', [Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0], [0, 0, 0], [1, 1, 0.4])); }
    g.add(mesh(ball(0.055), '#ffd25e', [0, 0, 0.02], [0, 0, 0], [1, 1, 0.5]));
    const x = -0.6, y = 0.72;
    g.position.set(x, y, surfaceZ(x, y) + 0.02); g.scale.setScalar(1.25); return g;
  },
};

/* ───────── wraps: the eyepatch strap, the scarf, the bell's collar ───────── */
// Same idea as the hats: solid bands that follow the body all the way round, with rolled
// edges, so nothing turns into a thin floating ring when Minus looks up or down.
export const WRAPS = {
  eyepatch: () => {
    const F = frame({ tilt: -0.42 });
    const k = memo('eyepatch', () => { const b = band(F, 0.13, 0.2, 0.03, 1.14, 2); return { strap: b.geo, lo: tube(b.rings[0], 0.012), hi: tube(b.rings[2], 0.012) }; });
    const x = 0.33, y = 0.04;
    const patch = mesh(memo('patch', () => new THREE.ShapeGeometry(ellipseShape(0.32, 0.3), 32)), new THREE.MeshBasicMaterial({ color: '#16161a', depthTest: false }), [x, y, surfaceZ(x, y) + 0.03]);
    patch.renderOrder = 5; patch.userData.face = true;
    return group(mesh(k.strap, '#26262b'), mesh(k.lo, '#26262b'), mesh(k.hi, '#26262b'), patch);
  },
  scarf: () => {
    const F = frame({ tilt: 0.05 });
    const k = memo('scarf', () => {
      const w = band(F, -0.68, -0.4, 0.07, 1.24, 6), s = band(F, -0.58, -0.5, 0.085, 1.27, 2);
      const p = PI / 2 - 0.6, o = at(F, -0.52, reach(F, -0.52, p, 0.085, 1.27) + 0.02, p);
      return { wrap: w.geo, lo: tube(w.rings[0], 0.04), hi: tube(w.rings[6], 0.04), stripe: s.geo, o };
    });
    const tail = memo('scarf tail', () => new THREE.ExtrudeGeometry(roundedPoly([[-0.09, 0.04], [0.09, 0.04], [0.12, -0.38], [-0.06, -0.38]], 0.035), { depth: 0.04, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 6 }));
    const fold = mesh(tail, '#c93a3f', k.o, [-0.12, 0.25, 0.12]);
    fold.add(mesh(memo('scarf tail stripe', () => new THREE.PlaneGeometry(0.2, 0.06)), '#f6f3ec', [0.025, -0.26, 0.06], [0, 0, -0.07]));
    return group(mesh(k.wrap, '#e5484d'), mesh(k.lo, '#e5484d'), mesh(k.hi, '#e5484d'), mesh(k.stripe, '#f6f3ec'), fold);
  },
  bell: () => {
    const F = frame();
    const k = memo('bell collar', () => {
      const b = band(F, -0.66, -0.52, 0.05, 1.2, 3);
      const o = at(F, -0.66, reach(F, -0.66, PI / 2, 0.05, 1.2) + 0.04, PI / 2);
      return { collar: b.geo, lo: tube(b.rings[0], 0.025), hi: tube(b.rings[3], 0.025), o };
    });
    const bellAt = k.o.clone().add(V(0, -0.1, 0.06));
    const b = group(mesh(ball(0.13), '#f6c445'), mesh(memo('bell slit', () => new THREE.BoxGeometry(0.15, 0.022, 0.02)), '#9a7414', [0, -0.04, 0.125]), mesh(ball(0.05), '#ffe18a', [-0.05, 0.05, 0.08]));
    b.position.copy(bellAt);
    const loop = mesh(memo('bell loop', () => new THREE.TorusGeometry(0.045, 0.014, 8, 20)), '#d9a21f', k.o.clone().add(V(0, 0, 0.03)));
    return group(mesh(k.collar, '#e5484d'), mesh(k.lo, '#c23a40'), mesh(k.hi, '#c23a40'), loop, b);
  },
};
