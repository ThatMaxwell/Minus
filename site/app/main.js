// Minus app preview: the desktop app's interface running in the browser.
import { state, load, on, agent, go, save } from './store.js';
import { $, tooltips, icon, isMac } from './ui.js';
import { installDefs, avatarSVG, COLORS } from '../js/shape.js';
import { keepNames } from '../js/names.js';
import { idleWatch } from './director.js';
import { sidebar } from './views/sidebar.js';
import { chat, leaveChat } from './views/chat.js';
import { approvals, routines, computers, settings } from './views/pages.js';
import { palette } from './views/palette.js';
import { standup } from './views/standup.js';
import { room } from './views/room.js';
import { startHandoffs } from './handoff.js';
import { startMeter } from './saved.js';
import { startMoods } from './moods.js';
import { startDrop } from './drop.js';
import * as su from './standup.js';
import { openCreate } from './views/create.js';
import { autoRead, stopSpeaking, speaking } from './voice.js';
import { startBridge } from './bridge.js';
import * as account from './account.js';
import * as runtime from './runtime.js';

const tauri = window.__TAURI__;

load();
installDefs();
document.documentElement.classList.toggle('calm', !state.settings.lively);

const app = $('#app');
app.innerHTML = `
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-l">${isMac ? '<span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}<span class="logo">${avatarSVG(COLORS.cloud, { box: 112 })}<b>minus</b></span><span class="beta">Beta</span></div>
    <button class="tb-search" data-palette data-tip="Jump anywhere|mod K">${icon('search')}<span>Search agents and actions</span><kbd>${isMac ? '⌘' : 'Ctrl'} K</kbd></button>
    <div class="tb-r"><button class="icon-btn" data-go-approvals data-tip="Approvals">${icon('bell')}</button><button class="icon-btn" data-help data-tip="Keyboard shortcuts">${icon('keyboard')}</button>${tauri && !isMac ? `<span class="wc"><button data-wc="min" aria-label="Minimize"><svg viewBox="0 0 12 12"><path d="M2 6h8"/></svg></button><button data-wc="max" aria-label="Maximize"><svg viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/></svg></button><button data-wc="close" class="wc-x" aria-label="Close to the tray"><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button></span>` : ''}</div>
  </header>
  <aside class="side" aria-label="Agents and places"></aside>
  <main class="main" id="main"></main>`;

sidebar($('.side'));
const main = $('.main');
const views = { chat, approvals, routines, computers, settings, standup, room };
const render = () => { main.onclick = null; leaveChat(); (views[state.route.view] || chat)(main); };
on('route', render);
on('agents', () => { if (state.route.view === 'chat') { if (!agent(state.route.agent)) state.route.agent = state.agents[0]?.id; render(); } });
render();

$('.titlebar').addEventListener('click', (e) => {
  const wc = e.target.closest('[data-wc]') || (tauri && e.target.closest('.traffic i'));
  if (wc && tauri) {
    const w = tauri.window.getCurrentWindow();
    const k = wc.dataset?.wc || ['close', 'min', 'max'][[...wc.parentElement.children].indexOf(wc)];
    if (k === 'min') w.minimize(); else if (k === 'max') w.toggleMaximize(); else w.close();
    return;
  }
  if (e.target.closest('[data-palette]')) palette();
  if (e.target.closest('[data-go-approvals]')) go('approvals');
  if (e.target.closest('[data-help]')) shortcuts();
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && speaking()) stopSpeaking();
  const m = isMac ? e.metaKey : e.ctrlKey;
  if (!m) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); palette(); }
  if (k === 'n') { e.preventDefault(); openCreate(); }
  if (k === ',') { e.preventDefault(); go('settings'); }
  if (k === '.') { e.preventDefault(); state.panel = !state.panel; save(); if (state.route.view === 'chat') render(); }
});

function shortcuts() {
  import('./ui.js').then(({ sheet, mod }) => {
    const rows = [['Jump anywhere', `${mod} K`], ['New agent', `${mod} N`], ['Show or hide the computer', `${mod} .`], ['Settings', `${mod} ,`], ['Send a message', 'Enter'], ['Talk to the agent', `${mod} J`], ['New line', 'Shift Enter'], ['Close a window', 'Esc']];
    sheet(`<div class="mini-form"><h3>Keyboard shortcuts</h3><dl class="keys">${rows.map(([t, k]) => `<div><dt>${t}</dt><dd>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dd></div>`).join('')}</dl></div>`, { cls: 'small' });
  });
}

tooltips();
startBridge();
startHandoffs();
startMeter();
startMoods();
startDrop();
account.start();
runtime.listen();
idleWatch(90000);
// stand-up time: the dock offers it (see bridge.js); check once a minute
setInterval(() => su.due() && import('./store.js').then(({ emit }) => emit('standup')), 60e3);
autoRead((e) => import('./ui.js').then(({ toast }) => toast(e.human || 'Voice didn’t work this time.', { icon: 'speaker' })));
keepNames();
