// Local dev server for the Minus site. Run: node server.js  →  http://localhost:7000
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 7000, ROOT = __dirname, INDEX = process.env.INDEX || 'index.html';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? '/' + INDEX : url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(ROOT) || file.includes('node_modules')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Minus site → http://localhost:${PORT}`));
