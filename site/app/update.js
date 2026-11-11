// Updates: the app knows which build it is; when the "latest" release is newer, it offers it.
import { sheet, $ } from './ui.js';
const REL = 'https://github.com/ThatMaxwell/Minus/releases/download/latest/';
export async function checkUpdate() {
  const t = window.__TAURI__; if (!t) return;
  let mine = null; try { mine = await t.core.invoke('app_build'); } catch { return; }
  if (!mine) return; // a local build
  try {
    const r = await fetch('https://api.github.com/repos/ThatMaxwell/Minus/releases/tags/latest');
    const rel = await r.json(), sha = rel.target_commitish;
    if (!sha || sha === mine || /^[0-9a-f]{40}$/.test(sha) === false) return;
    if (sessionStorage.getItem('minus-upd') === sha) return;
    sessionStorage.setItem('minus-upd', sha);
    const phone = /Android/i.test(navigator.userAgent);
    const file = phone ? 'Minus-Android.apk' : /Mac/i.test(navigator.platform) ? 'Minus-macOS.dmg' : /Linux/i.test(navigator.platform) ? 'Minus-Linux.AppImage' : 'Minus-Windows-Setup.exe';
    const url = file ? REL + file : 'https://github.com/ThatMaxwell/Minus/releases/tag/latest';
    const s = sheet(`<div class="mini-form"><h3>A new Minus is out</h3>
      <p class="muted small">${(rel.name || rel.body || 'Fixes and new things.').toString().slice(0, 300).replace(/[<>&]/g, '')}</p>
      <div class="row-end"><button class="btn btn-quiet btn-sm" data-x>Later</button><a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener" data-ext>Download update</a></div></div>`, { cls: 'small' });
    $('[data-x]', s.el).onclick = s.close;
  } catch { /* offline */ }
}
