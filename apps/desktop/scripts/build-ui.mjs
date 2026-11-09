// Packs the app's interface (the same code as the web preview in site/) into dist/ for Tauri.
//   site/test.html -> dist/index.html   (the app)
//   site/dock.html -> dist/dock.html    (the always-on dock)
//   site/app, site/js, site/vendor      (code, mascots, libraries)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '../../../site');
const dist = join(here, '../dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const dir of ['app', 'js', 'vendor']) {
  cpSync(join(site, dir), join(dist, dir), {
    recursive: true,
    // the website's audio engine isn't part of the app
    filter: (src) => !/elementary\.(js|LICENSE\.md)$/.test(src),
  });
}
const app = readFileSync(join(site, 'test.html'), 'utf8').replace('<meta name="robots" content="noindex, nofollow" />', '');
writeFileSync(join(dist, 'index.html'), app);
for (const f of ['dock.html', 'ghost.html']) cpSync(join(site, f), join(dist, f));
console.log('ui → dist/');
