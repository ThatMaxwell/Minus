// Tiny static server for the Minus mascot. Run: node server.js  →  http://localhost:7000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 7000;
const ROOT = path.join(__dirname, 'public');
const ROUTES = {
  '/vendor/three.module.js': path.join(__dirname, 'node_modules/three/build/three.module.js'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = ROUTES[url] || path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!ROUTES[url] && !file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Minus mascot → http://localhost:${PORT}`));
