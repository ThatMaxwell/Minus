// Magic Move for text. Letters that two phrases share glide from their old spot
// to their new one; the rest blur out and in. "*word*" sets a word in italics.
const { animate } = window.Motion;
const OUT = [0.4, 0, 1, 1];
const IN = [0.22, 1, 0.36, 1];

function tokens(src) {
  const out = []; let it = false;
  for (const ch of src) { if (ch === '*') { it = !it; continue; } out.push({ ch, it }); }
  return out;
}

// Longest common subsequence of letters (spaces never match).
function pairs(a, b) {
  const n = a.length, m = b.length, eq = (x, y) => x.ch !== ' ' && x.ch === y.ch && x.it === y.it;
  const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return out;
}

export class MagicText {
  constructor(el) {
    this.el = el; el.classList.add('magic-text');
    this.line = null; this.toks = [];
  }
  build(toks) {
    const line = document.createElement('div');
    line.className = 'mt-line';
    for (const t of toks) {
      const s = document.createElement('span');
      s.className = t.it ? 'mt-ch it' : 'mt-ch';
      s.textContent = t.ch;
      line.appendChild(s);
    }
    this.el.appendChild(line);
    // Longer phrases (other languages) shrink to fit the screen.
    let w = 0; for (const s of line.children) w += s.getBoundingClientRect().width;
    const room = this.el.clientWidth * 0.92;
    if (w > room) line.style.fontSize = (room / w).toFixed(3) + 'em';
    return line;
  }
  // First phrase: letters rise into place.
  show(text) {
    this.clear();
    this.toks = tokens(text);
    this.line = this.build(this.toks);
    const chars = [...this.line.children];
    chars.forEach((s, i) => {
      s.style.opacity = 0;
      animate(s, { opacity: [0, 1], y: ['0.45em', '0em'], filter: ['blur(10px)', 'blur(0px)'] }, { duration: 0.9, delay: i * 0.028, ease: IN });
    });
  }
  to(text) {
    if (!this.line) return this.show(text);
    const old = this.line, oldT = this.toks, newT = tokens(text);
    const line = this.build(newT);
    const oR = [...old.children].map((s) => s.getBoundingClientRect());
    const nR = [...line.children].map((s) => s.getBoundingClientRect());
    const P = pairs(oldT, newT), keepOld = new Set(P.map((p) => p[0])), keepNew = new Set(P.map((p) => p[1]));

    // Shared letters glide on a spring.
    for (const [i, j] of P) {
      old.children[i].style.visibility = 'hidden';
      animate(line.children[j], { x: [oR[i].left - nR[j].left, 0], y: [oR[i].top - nR[j].top, 0] },
        { type: 'spring', stiffness: 150, damping: 21, mass: 1 });
    }
    // Leaving letters lift and blur away.
    [...old.children].forEach((s, i) => {
      if (keepOld.has(i)) return;
      animate(s, { opacity: 0, y: '-0.32em', filter: 'blur(8px)' }, { duration: 0.32, delay: i * 0.01, ease: OUT });
    });
    // Arriving letters rise in, slightly after the glide begins.
    let n = 0;
    [...line.children].forEach((s, j) => {
      if (keepNew.has(j)) return;
      s.style.opacity = 0;
      animate(s, { opacity: [0, 1], y: ['0.38em', '0em'], filter: ['blur(10px)', 'blur(0px)'] }, { duration: 0.7, delay: 0.1 + n++ * 0.02, ease: IN });
    });
    this.line = line; this.toks = newT;
    setTimeout(() => old.remove(), 450);
  }
  // Letters fall into a hairline at the vertical center, from the middle outwards.
  collapse() {
    if (!this.line) return;
    const line = this.line, box = this.el.getBoundingClientRect(), mid = box.left + box.width / 2;
    [...line.children].forEach((s) => {
      const r = s.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid);
      animate(s, { y: '0.12em', scaleY: 0.04, opacity: 0, x: (mid - (r.left + r.width / 2)) * 0.25 },
        { duration: 0.5, delay: d / 2400, ease: [0.7, 0, 0.84, 0] });
    });
    this.line = null; this.toks = [];
    setTimeout(() => line.remove(), 900);
  }
  clear() { this.el.querySelectorAll('.mt-line').forEach((l) => l.remove()); this.line = null; this.toks = []; }
}
