// Dev-only Paperclip dashboard (HANDOFF, "local Paperclip dashboard"): Quest Dev's pulse and release progress, read
// live. Paperclip sends no CORS header, so /pc/* is a same-origin, GET-only proxy to its API; /git lists the latest
// 3d-world commits. Read-only by design: nothing here can change Paperclip or the repo. Run: node dev/dashboard.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.argv[2]) || 4795;
const PAPERCLIP = 'http://127.0.0.1:3100/api';
const DIR = path.join(__dirname, 'dashboard');
const REPO = path.join(__dirname, '..');
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/sprite-lab.html': 'local/sprite-lab.html' };

const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(body); };

http.createServer(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'read-only');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/pc/')) {
    try {
      const r = await fetch(PAPERCLIP + url.pathname.slice(3) + url.search, { signal: AbortSignal.timeout(4000) });
      return send(res, r.status, 'application/json', await r.text());
    } catch { return send(res, 502, 'application/json', '{"error":"Paperclip is not answering on 127.0.0.1:3100"}'); }
  }
  if (url.pathname === '/git') {
    return execFile('git', ['log', '3d-world', '-15', '--format=%h%x09%cI%x09%an%x09%s'], { cwd: REPO }, (err, out) => {
      if (err) return send(res, 500, 'application/json', '{"error":"git log failed"}');
      const commits = out.trim().split('\n').filter(Boolean).map(l => { const [hash, at, author, subject] = l.split('\t'); return { hash, at, author, subject }; });
      send(res, 200, 'application/json', JSON.stringify(commits));
    });
  }
  const page = PAGES[url.pathname];
  if (!page) return send(res, 404, 'text/plain', 'not found');
  fs.readFile(path.join(DIR, page), (err, buf) => err ? send(res, 404, 'text/plain', 'not found') : send(res, 200, 'text/html', buf));
}).listen(PORT, '127.0.0.1', () => console.log(`Paperclip dashboard on http://localhost:${PORT}`));
