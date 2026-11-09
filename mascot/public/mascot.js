// Minus mascot — a real 3D body rendered with flat, unlit colors so it reads as 2D.
// The 3D lets the eyes slide over a curved face and foreshorten when the head turns,
// which is what sells the motion. Two animations only: BLINK and LOOK.
import * as THREE from 'three';

/* ───────────────────────── Palette ───────────────────────── */
const COLORS = [
  { name: 'Cloud',  body: '#f7f7f5' },
  { name: 'Mint',   body: '#4fd1a5' },
  { name: 'Amber',  body: '#ffa63d' },
  { name: 'Violet', body: '#8b6cff' },
  { name: 'Sky',    body: '#3f8cff' },
  { name: 'Coral',  body: '#ff6a3d' },
];
const EYE_COLOR = '#0b0b0d';

/* ───────────────────────── Shape ───────────────────────── */
// Silhouette = smooth union of 8 lobe circles around a core circle.
// Fixed, hand-tuned jitter keeps it organic (never a perfect flower).
const LOBES = [
  // angle offset (rad), ring distance, lobe radius
  [ 0.00, 0.640, 0.372],
  [ 0.05, 0.628, 0.378],
  [-0.03, 0.650, 0.362],
  [ 0.04, 0.636, 0.380],
  [-0.02, 0.646, 0.366],
  [ 0.03, 0.632, 0.376],
  [-0.05, 0.648, 0.362],
  [ 0.02, 0.636, 0.374],
].map(([da, d, r], i) => {
  const a = Math.PI / 2 + i * (Math.PI * 2 / 8) + da;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, r };
});
const CORE = { x: 0, y: 0, r: 0.72 };
const CUSP_SOFTNESS = 26; // higher = sharper notches between lobes

function rayToCircle(ux, uy, c) {
  const b = ux * c.x + uy * c.y;
  const disc = b * b - (c.x * c.x + c.y * c.y) + c.r * c.r;
  return disc < 0 ? null : b + Math.sqrt(disc);
}

const SAMPLES = 4096;
const radiusTable = new Float32Array(SAMPLES + 1);
(() => {
  let max = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const ux = Math.cos(t), uy = Math.sin(t);
    let sum = 0;
    for (const c of [CORE, ...LOBES]) {
      const d = rayToCircle(ux, uy, c);
      if (d !== null && d > 0) sum += Math.exp(CUSP_SOFTNESS * d);
    }
    radiusTable[i] = Math.log(sum) / CUSP_SOFTNESS;
    max = Math.max(max, radiusTable[i]);
  }
  for (let i = 0; i <= SAMPLES; i++) radiusTable[i] /= max; // outermost point = 1
})();

function radiusAt(t) {
  let u = (t / (Math.PI * 2)) % 1; if (u < 0) u += 1;
  const f = u * SAMPLES, i = Math.floor(f), k = f - i;
  return radiusTable[i] * (1 - k) + radiusTable[Math.min(i + 1, SAMPLES)] * k;
}

// Puffy "pillow" depth: flat-ish face, rounded rim. z = D·(1 − s^P)^(1/P)
const DEPTH = 0.5;
const PILLOW = 2.3;
const profile = (s) => DEPTH * Math.pow(Math.max(0, 1 - Math.pow(Math.min(s, 1), PILLOW)), 1 / PILLOW);
// The face the eyes ride on is the smooth dome *under* the lobes (mean radius),
// so eyes never kink over the creases between lobes when the head turns.
let MEAN_R = 0; for (let i = 0; i < SAMPLES; i++) MEAN_R += radiusTable[i] / SAMPLES;
function surfaceZ(x, y) {
  return profile(Math.hypot(x, y) / MEAN_R);
}

/* ───────────────────────── Geometry ───────────────────────── */
function buildBody() {
  const NT = 720, NP = 64; // around × front-to-back
  const pos = [];
  const idx = [];
  for (let j = 0; j <= NP; j++) {
    const v = j / NP;                       // 0 = front pole, 1 = back pole
    const s = Math.sin(v * Math.PI);        // 0 → 1 → 0 across the rim
    const front = v <= 0.5 ? 1 : -1;
    for (let i = 0; i <= NT; i++) {
      const t = (i / NT) * Math.PI * 2;
      const r = radiusAt(t) * s;
      pos.push(Math.cos(t) * r, Math.sin(t) * r, front * profile(s));
    }
  }
  for (let j = 0; j < NP; j++) for (let i = 0; i < NT; i++) {
    const a = j * (NT + 1) + i, b = a + NT + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Eyes are pebbles, not perfect ellipses — a couple of low harmonics.
const EYE = { rx: 0.268, ry: 0.272, gap: 0.33, y: 0.04, tilt: 0.05 };
const EYE_SEG = 128, EYE_RINGS = 10;

class Eye {
  constructor(side, material) {
    this.side = side; // -1 left, +1 right
    const verts = 1 + EYE_RINGS * EYE_SEG;
    this.positions = new Float32Array(verts * 3);
    const idx = [];
    for (let i = 0; i < EYE_SEG; i++) idx.push(0, 1 + ((i + 1) % EYE_SEG), 1 + i);
    for (let r = 1; r < EYE_RINGS; r++) {
      const a0 = 1 + (r - 1) * EYE_SEG, a1 = 1 + r * EYE_SEG;
      for (let i = 0; i < EYE_SEG; i++) {
        const n = (i + 1) % EYE_SEG;
        idx.push(a0 + i, a0 + n, a1 + i, a0 + n, a1 + n, a1 + i);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.renderOrder = 1;
  }

  // Lay the 2D pebble onto the curved face. open: 1 = open, 0 = shut.
  update(lookX, lookY, open) {
    const s = this.side;
    const cx = s * EYE.gap + lookX * 0.15;
    const cy = EYE.y + lookY * 0.11;
    const tilt = -s * EYE.tilt;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    // Lid closes from the top: squash and drift down a touch.
    const squash = 0.06 + 0.94 * open;
    const drop = (1 - open) * EYE.ry * 0.22;
    const p = this.positions;
    const put = (k, lx, ly) => {
      ly = ly * squash - drop;
      const x = cx + lx * cosT - ly * sinT;
      const y = cy + lx * sinT + ly * cosT;
      p[k] = x; p[k + 1] = y; p[k + 2] = surfaceZ(x, y) + 0.004;
    };
    put(0, 0, 0);
    for (let r = 1; r <= EYE_RINGS; r++) {
      const f = r / EYE_RINGS;
      for (let i = 0; i < EYE_SEG; i++) {
        const t = (i / EYE_SEG) * Math.PI * 2;
        const tm = s < 0 ? t : Math.PI - t; // mirror the pebble for the right eye
        const w = 1 + 0.028 * Math.cos(2 * tm + 0.4) + 0.018 * Math.cos(3 * tm + 2.6);
        put(3 * (1 + (r - 1) * EYE_SEG + i), Math.cos(t) * EYE.rx * w * f, Math.sin(t) * EYE.ry * w * f);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/* ───────────────────────── Scene ───────────────────────── */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(14, 1, 0.1, 100);

const bodyMat = new THREE.MeshBasicMaterial({ color: COLORS[0].body });
const eyeMat = new THREE.MeshBasicMaterial({
  color: EYE_COLOR, side: THREE.DoubleSide, depthTest: false, // eyes always sit on the face
});

const rig = new THREE.Group();   // whole character (squash lives here)
const head = new THREE.Group();  // rotates for LOOK
rig.add(head);
head.add(new THREE.Mesh(buildBody(), bodyMat));
const eyes = [new Eye(-1, eyeMat), new Eye(1, eyeMat)];
eyes.forEach((e) => head.add(e.mesh));
scene.add(rig);

let viewH = 1, unitPx = 1;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  unitPx = Math.min(250, Math.min(w, h) * 0.25); // body radius in CSS px
  const halfH = h / 2 / unitPx;
  camera.aspect = w / h;
  camera.position.set(0, 0, halfH / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  camera.updateProjectionMatrix();
  rig.position.y = 44 / unitPx; // sit a little above the dock
  viewH = h;
}
addEventListener('resize', resize);
resize();

/* ───────────────────────── Motion helpers ───────────────────────── */
class Spring {
  constructor(stiffness, damping) { this.k = stiffness; this.c = 2 * damping * Math.sqrt(stiffness); this.x = 0; this.v = 0; this.target = 0; }
  step(dt) { this.v += (this.k * (this.target - this.x) - this.c * this.v) * dt; this.x += this.v * dt; }
}
const easeInQuad = (t) => t * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const rand = (a, b) => a + Math.random() * (b - a);

/* ───────────────────────── ANIM 1: BLINK ───────────────────────── */
// Fast close, tiny hold, softer open. The whole body dips ~2% with it.
const BLINK = { close: 0.07, hold: 0.035, open: 0.15 };
const BLINK_LEN = BLINK.close + BLINK.hold + BLINK.open;
let blinkT = null;    // seconds into the current blink, null when idle
let blinksLeft = 0;   // extra blinks queued (double-blink)
let blinkWait = 0;    // gap before the next queued blink
function blink(times = 1) {
  if (blinkT !== null || blinksLeft) return;
  blinkT = 0; blinksLeft = times - 1;
}
function blinkOpenness(dt) {
  if (blinkT === null) {
    if (blinksLeft && (blinkWait -= dt) <= 0) { blinksLeft--; blinkT = 0; }
    else return 1;
  }
  blinkT += dt;
  const { close, hold, open } = BLINK;
  if (blinkT < close) return 1 - easeInQuad(blinkT / close);
  if (blinkT < close + hold) return 0;
  if (blinkT < BLINK_LEN) return easeOutCubic((blinkT - close - hold) / open);
  blinkT = null; blinkWait = 0.08;
  return 1;
}

/* ───────────────────────── ANIM 2: LOOK ───────────────────────── */
// Eyes lead (fast, near-critical); the head follows with a soft overshoot.
const eyeX = new Spring(520, 0.92), eyeY = new Spring(520, 0.92);
const headX = new Spring(70, 0.62), headY = new Spring(70, 0.62);
let lookX = 0, lookY = 0;
function look(x, y) {
  x = THREE.MathUtils.clamp(x, -1, 1); y = THREE.MathUtils.clamp(y, -1, 1);
  if (Math.hypot(x - lookX, y - lookY) > 0.9) blink(); // big moves get a blink, like real eyes
  lookX = x; lookY = y;
  eyeX.target = x; eyeY.target = y;
  headX.target = x; headY.target = y;
}
function lookSomewhere() {
  // Pick a spot clearly away from where we're looking now.
  let x, y, tries = 0;
  do { x = rand(-1, 1); y = rand(-0.7, 0.8); } while (Math.hypot(x - lookX, y - lookY) < 0.8 && ++tries < 20);
  look(x, y);
}

/* ───────────────────────── Director ───────────────────────── */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let nextBlink = rand(1.2, 2.5), nextLook = rand(1.5, 3);
let pointerActive = 0;

addEventListener('pointermove', (e) => {
  const cx = innerWidth / 2, cy = viewH / 2 - 44;
  const dx = (e.clientX - cx) / (unitPx * 3.2), dy = -(e.clientY - cy) / (unitPx * 2.6);
  const m = Math.hypot(dx, dy), k = m > 1 ? 1 / m : 1;
  look(dx * k, dy * k);
  pointerActive = 2.5;
});
addEventListener('pointerleave', () => { pointerActive = 0; });
document.getElementById('blink').onclick = () => blink();
document.getElementById('look').onclick = () => { pointerActive = 0; nextLook = rand(1.2, 2.2); lookSomewhere(); };
addEventListener('keydown', (e) => {
  if (e.key === 'b' || e.key === 'B') blink();
  if (e.key === 'l' || e.key === 'L') { pointerActive = 0; nextLook = rand(1.2, 2.2); lookSomewhere(); }
});

// Color swatches
const swatches = document.getElementById('swatches');
COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.style.background = c.body; b.title = c.name;
  b.setAttribute('aria-label', c.name); b.setAttribute('aria-pressed', i === 0);
  b.onclick = () => {
    bodyMat.color.set(c.body);
    swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', s === b));
    blink();
  };
  swatches.appendChild(b);
});

/* ───────────────────────── Loop ───────────────────────── */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  if (!reduced) {
    if ((nextBlink -= dt) <= 0) { blink(Math.random() < 0.18 ? 2 : 1); nextBlink = rand(2.2, 5.5); }
    if (pointerActive > 0) pointerActive -= dt;
    else if ((nextLook -= dt) <= 0) {
      // Wander, but keep coming home to center so it feels attentive.
      if (Math.random() < 0.35 && Math.hypot(lookX, lookY) > 0.3) look(rand(-0.15, 0.15), rand(-0.1, 0.15));
      else lookSomewhere();
      nextLook = rand(1.6, 3.8);
    }
  }

  const sub = 4, h = dt / sub; // substeps keep the springs stable
  for (let i = 0; i < sub; i++) { eyeX.step(h); eyeY.step(h); headX.step(h); headY.step(h); }

  head.rotation.y = headX.x * 0.42;
  head.rotation.x = -headY.x * 0.3;
  head.position.x = headX.x * 0.05;
  head.position.y = headY.x * 0.03;

  const open = blinkOpenness(dt);
  const dip = 1 - open;
  rig.scale.set(1 + dip * 0.012, 1 - dip * 0.02, 1);

  // Eyes also slide over the face (on top of the head turn) — this is the 3D payoff.
  eyes.forEach((e) => e.update(eyeX.x - headX.x * 0.35, eyeY.x - headY.x * 0.35, open));

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
