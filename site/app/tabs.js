// The phone's dock: a floating bar of liquid glass, like the Mac's dock. Slide a finger
// across it and the icons swell under your finger; let go on one to open it. It slips away
// while the keyboard is up, so typing gets the whole screen.
import { state, on, go, pendingApprovals } from './store.js';
import { $, $$, icon } from './ui.js';

const PLACES = [['home', 'inbox', 'Agents'], ['approvals', 'bell', 'Needs you'], ['standup', 'sunrise', 'Stand-up'], ['room', 'room', 'Ask'], ['settings', 'gear', 'Settings']];

// the glass bends what's behind it at its edges, like a lens (Chromium, so Android's web view)
const LENS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="glass-lens" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feImage x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" href="data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 60' preserveAspectRatio='none'><defs><linearGradient id='x' x1='0' x2='1'><stop offset='0' stop-color='rgb(255,0,0)'/><stop offset='.18' stop-color='rgb(128,0,0)'/><stop offset='.82' stop-color='rgb(128,0,0)'/><stop offset='1' stop-color='rgb(0,0,0)'/></linearGradient><linearGradient id='y' y1='0' y2='1' x1='0' x2='0'><stop offset='0' stop-color='rgb(0,255,0)'/><stop offset='.3' stop-color='rgb(0,128,0)'/><stop offset='.7' stop-color='rgb(0,128,0)'/><stop offset='1' stop-color='rgb(0,0,0)'/></linearGradient></defs><rect width='200' height='60' fill='url(%23x)'/><rect width='200' height='60' fill='url(%23y)' style='mix-blend-mode:screen'/></svg>`)}"/>
    <feGaussianBlur in="map" stdDeviation="3" result="soft"/>
    <feDisplacementMap in="SourceGraphic" in2="soft" scale="26" xChannelSelector="R" yChannelSelector="G"/>
  </filter></defs></svg>`;

export function dock(root) {
  root.insertAdjacentHTML('beforeend', LENS);
  const bar = document.createElement('nav');
  bar.className = 'tabs';
  bar.setAttribute('aria-label', 'Places');
  bar.innerHTML = `<span class="tb-sheen" aria-hidden="true"></span>${PLACES.map(([v, i, t]) => `<button data-tab="${v}" aria-label="${t}"><span class="tb-ic">${icon(i)}</span><span class="tb-tip">${t}</span>${v === 'approvals' ? '<b class="count" hidden></b>' : ''}<i class="tb-dot"></i></button>`).join('')}`;
  root.appendChild(bar);
  const btns = $$('[data-tab]', bar), sheen = $('.tb-sheen', bar);

  const mark = () => {
    btns.forEach((b) => b.classList.toggle('on', b.dataset.tab === state.route.view || (b.dataset.tab === 'home' && state.route.view === 'chat')));
    const n = pendingApprovals().length, c = $('.count', bar); c.hidden = !n; c.textContent = n;
  };
  mark();
  on('route', mark); on('approvals', mark); on('message:update', mark);

  // magnify under the finger, like the Mac's dock
  let pressed = null;
  const swell = (x) => {
    for (const b of btns) {
      const r = b.getBoundingClientRect(), d = Math.abs(x - (r.left + r.width / 2));
      const s = 1 + 0.42 * Math.max(0, 1 - d / 86) ** 2;
      b.style.setProperty('--s', s.toFixed(3));
      b.classList.toggle('near', d < r.width / 2);
    }
    const br = bar.getBoundingClientRect();
    sheen.style.setProperty('--x', `${x - br.left}px`);
  };
  const rest = () => { btns.forEach((b) => { b.style.setProperty('--s', '1'); b.classList.remove('near'); }); bar.classList.remove('touching'); };
  bar.addEventListener('pointerdown', (e) => { pressed = e.pointerId; bar.setPointerCapture(e.pointerId); bar.classList.add('touching'); swell(e.clientX); navigator.vibrate?.(4); });
  bar.addEventListener('pointermove', (e) => { if (pressed === e.pointerId) swell(e.clientX); });
  const up = (e) => {
    if (pressed !== e.pointerId) return;
    pressed = null;
    const b = btns.find((x) => x.classList.contains('near'));
    rest();
    if (b && e.type === 'pointerup') {
      b.classList.add('bounce'); setTimeout(() => b.classList.remove('bounce'), 520);
      if (b.dataset.tab !== state.route.view) go(b.dataset.tab);
    }
  };
  bar.addEventListener('pointerup', up);
  bar.addEventListener('pointercancel', up);
  // keyboard access still works
  bar.addEventListener('click', (e) => { if (e.detail === 0) { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); } });

  // out of the way while you type
  let tallest = innerHeight, typing = false;
  const field = (el) => el?.matches?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), [contenteditable="true"]');
  const sync = () => {
    tallest = Math.max(tallest, innerHeight);
    const vv = window.visualViewport;
    const shrunk = tallest - innerHeight > 140 || (vv && innerHeight - vv.height > 140);
    document.documentElement.classList.toggle('kb', typing || shrunk);
  };
  addEventListener('focusin', (e) => { if (field(e.target)) { typing = true; sync(); } });
  addEventListener('focusout', () => { typing = false; setTimeout(sync, 60); });
  addEventListener('resize', sync);
  window.visualViewport?.addEventListener('resize', sync);
}
