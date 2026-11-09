// Renders the app icon (dark rounded square with the white Minus mascot) and the tray icon
// from docs/mascot.svg. Run: node scripts/gen-icons.cjs && npx tauri icon icons/source.png
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const svg = fs.readFileSync(path.join(__dirname, '../../../docs/mascot.svg'), 'utf8').replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const shot = async (html, file, size) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await p.screenshot({ path: path.join(__dirname, '../src-tauri/icons', file), omitBackground: true });
  };
  fs.mkdirSync(path.join(__dirname, '../src-tauri/icons'), { recursive: true });
  // app icon: squircle with soft top light, mascot at ~64%
  await shot(`<div style="width:1024px;height:1024px;border-radius:228px;background:radial-gradient(120% 80% at 50% 0%,#26262b 0%,#0e0e10 62%);box-shadow:inset 0 3px 0 rgba(255,255,255,.08);display:grid;place-items:center">
    <div style="width:660px;height:660px">${svg}</div></div>`, 'source.png', 1024);
  // tray: just the mascot, a little larger, on transparent
  await shot(`<div style="width:64px;height:64px;display:grid;place-items:center"><div style="width:62px;height:62px">${svg}</div></div>`, 'tray.png', 64);
  await b.close();
})();
