// Minus app preview: the desktop app's interface running in the browser.
import { state, load, on, agent, go, save, pendingApprovals } from './store.js';
import { $, $$, tooltips, icon, isMac } from './ui.js';
import { installDefs } from '../js/shape.js';
import { STATUS } from './data.js';
import { keepNames } from '../js/names.js';
import { idleWatch } from './director.js';
import { sidebar } from './views/sidebar.js';
import { chat, leaveChat } from './views/chat.js';
import { approvals, routines, computers } from './views/pages.js';
import { settings } from './views/settings.js';
import { palette } from './views/palette.js';
import { standup } from './views/standup.js';
import { room } from './views/room.js';
import { startHandoffs } from './handoff.js';
import { startMeter } from './saved.js';
import { startMoods } from './moods.js';
import { startDrop } from './drop.js';
import { home, leaveHome } from './views/home.js';
import * as link from './link.js';
import { startIsland } from './island.js';
import { dock } from './tabs.js';
import * as su from './standup.js';
import { openCreate } from './views/create.js';
import { autoRead, stopSpeaking, speaking } from './voice.js';
import { startBridge } from './bridge.js';
import * as account from './account.js';
import * as runtime from './runtime.js';
import { showGate, hideGate } from './gate.js';

const tauri = window.__TAURI__;
const gated = (!!tauri || new URLSearchParams(location.search).has('gate')) && account.configured();
// until we know whether you're signed in, show nothing at all
if (gated) document.documentElement.classList.add('locked');

load();
installDefs();
// the phone: one column, tabs at the bottom, and it controls agents instead of running them
const phone = link.isPhone() || new URLSearchParams(location.search).has('phone');
document.documentElement.classList.toggle('phone', phone);
if (phone) state.route = { ...state.route, view: 'home' };
document.documentElement.classList.toggle('calm', !state.settings.lively);

const app = $('#app');
app.innerHTML = `
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-l">${isMac ? '<span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}<span class="logo"><b>minus</b></span><span class="beta">Beta</span><span class="grow"></span><button class="icon-btn tb-side" data-side data-tip="Hide or show the sidebar|mod B" aria-label="Hide or show the sidebar">${icon('sidebar')}</button></div>
    <div class="tb-mid"><span class="tb-tab"><i class="dot dim"></i><span class="tb-title">Minus</span></span><button class="icon-btn tb-find" data-palette data-tip="Jump anywhere|mod K" aria-label="Jump anywhere">${icon('search')}</button></div>
    <div class="tb-r"><button class="icon-btn" data-help data-tip="Keyboard shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button>${tauri && !isMac ? `<span class="wc"><button data-wc="min" aria-label="Minimize"><svg viewBox="0 0 12 12"><path d="M2 6h8"/></svg></button><button data-wc="max" aria-label="Maximize"><svg viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/></svg></button><button data-wc="close" class="wc-x" aria-label="Close to the tray"><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button></span>` : ''}</div>
  </header>
  <aside class="side" aria-label="Agents and places"></aside>
  <main class="main" id="main"></main>
`;
if (phone) dock(app);

sidebar($('.side'));
// the sidebar folds down to a slim rail of icons and faces (remembered)
const sideMin = () => app.classList.toggle('side-min', !!state.settings.sideMin);
const toggleSide = () => { state.settings.sideMin = !state.settings.sideMin; save(); sideMin(); };
sideMin();
$('[data-side]', app).addEventListener('click', toggleSide);
const main = $('.main');
const views = { chat, approvals, routines, computers, settings, standup, room, home };
const render = () => {
  main.onclick = null; leaveChat(); leaveHome();
  (views[state.route.view] || (phone ? home : chat))(main);
};
if (phone) {
  // Android's back button: from anywhere back to the agents
  addEventListener('popstate', () => { if (state.route.view !== 'home') go('home'); });
  on('route', (r) => { if (r.view !== 'home') history.pushState({}, ''); });
}
on('route', render);
// the tab at the top: who you're talking to (and how it's doing), or which page this is
const PAGES = { approvals: 'Approvals', routines: 'Routines', computers: 'Computers', settings: 'Settings', standup: 'Stand-up', room: 'Ask the room', home: 'Home' };
const tab = () => {
  const r = state.route, a = r.view === 'chat' ? state.agents.find((x) => x.id === r.agent) : null;
  const title = $('.tb-title', app), dot = $('.tb-tab .dot', app);
  title.textContent = a ? a.name : PAGES[r.view] || 'Minus';
  dot.className = `dot ${a ? STATUS[a.status]?.tone || 'dim' : 'dim'}`;
  document.title = a ? `${a.name} · Minus` : r.view in PAGES ? `${PAGES[r.view]} · Minus` : 'Minus';
};
tab();
on('route', tab);
on('agent', (x) => { if (state.route.view === 'chat' && state.route.agent === x.id) tab(); });
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
  if (k === 'b') { e.preventDefault(); toggleSide(); }
  if (k === ',') { e.preventDefault(); go('settings'); }
  if (k === '.') { e.preventDefault(); state.panel = !state.panel; save(); if (state.route.view === 'chat') render(); }
});

function shortcuts() {
  import('./ui.js').then(({ sheet, mod }) => {
    const rows = [['Jump anywhere', `${mod} K`], ['New agent', `${mod} N`], ['Hide or show the sidebar', `${mod} B`], ['Show or hide the computer', `${mod} .`], ['Settings', `${mod} ,`], ['Send a message', 'Enter'], ['Talk to the agent', `${mod} J`], ['New line', 'Shift Enter'], ['Close a window', 'Esc']];
    sheet(`<div class="mini-form"><h3>Keyboard shortcuts</h3><dl class="keys">${rows.map(([t, k]) => `<div><dt>${t}</dt><dd>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dd></div>`).join('')}</dl></div>`, { cls: 'small' });
  });
}

tooltips();
startBridge();
startHandoffs();
startMeter();
startMoods();
startDrop();
account.start().finally(() => {
  if (!gated) return;
  if (account.user()) { document.documentElement.classList.remove('locked'); return; }
  showGate({ phone });
});
on('account', () => {
  if (!gated) return;
  if (account.user()) { hideGate(); document.documentElement.classList.remove('locked'); }
  else { document.documentElement.classList.add('locked'); showGate({ phone }); }
});
link.start();
startIsland();
runtime.listen();
idleWatch(90000);
// stand-up time: the dock offers it (see bridge.js); check once a minute
setInterval(() => su.due() && import('./store.js').then(({ emit }) => emit('standup')), 60e3);
autoRead((e) => import('./ui.js').then(({ toast }) => toast(e.human || 'Voice didn’t work this time.', { icon: 'speaker' })));
keepNames();
