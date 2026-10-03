// Dev-only static file server for the browser-only game (PLAN-engine.md, "No server"). It serves public/ as is, plus
// Three.js from node_modules at /vendor/three/, which is all the game needs. No APIs: anything under /api/ is a 404,
// so a page that still leans on app.js shows up at once. Never the real 4777 game. Run: node dev/static.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const THREE = path.join(__dirname, '..', 'node_modules', 'three');
const PORT = Number(process.argv[2]) || 4790;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.hdr': 'application/octet-stream', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ink': 'text/plain' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  let base = ROOT;
  if (p.startsWith('/vendor/three/')) { base = THREE; p = p.slice('/vendor/three'.length); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(base, path.normalize(p));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`static game on http://localhost:${PORT}`));
