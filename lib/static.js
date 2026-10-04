// Static files from a root folder: a directory serves its index.html, anything else missing is a 404, stream errors never crash.
const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json',
  '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg', '.jpg': 'image/jpeg', '.md': 'text/markdown' };

const notFound = res => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}'); };

function serveStatic(root, pathname, res) {
  let file = path.join(root, pathname === '/' ? 'index.html' : path.normalize(pathname));
  if (file !== root && !file.startsWith(root + path.sep)) return notFound(res);
  let st = fs.statSync(file, { throwIfNoEntry: false });
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file, { throwIfNoEntry: false }); }
  if (!st || !st.isFile()) return notFound(res);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

module.exports = { serveStatic, MIME };
