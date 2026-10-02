// Asset editor endpoints (public/editor.html). Local only: app.js calls this from the HTTP handler, not from the
// `routes` table, so a linked hosted page can't reach it.
//   GET  /api/editor/list                 → { packs: [png paths], models: [glb paths], imported: manifest entries }
//   POST /api/editor/import?name=x.glb    → raw file body; saved to public/assets/imported/, appended to its manifest
// Uploads must be application/octet-stream (forces a CORS preflight, which this server never grants) and any Origin
// header must be this host, so other websites can't write files here.
const fs = require('fs');
const path = require('path');

const MAX = 50 * 1024 * 1024;
const OK_EXT = new Set(['.png', '.glb', '.gltf']);

function walk(dir, ext, out = [], base = dir) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    if (d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, ext, out, base);
    else if (ext.includes(path.extname(d.name).toLowerCase())) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

module.exports = function editorAssets(PUBLIC) {
  const IMPORTED = path.join(PUBLIC, 'assets', 'imported');
  const MANIFEST = path.join(IMPORTED, 'manifest.json');
  const readManifest = () => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return { assets: [] }; } };

  return async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/editor/list') {
      return json(res, 200, {
        packs: walk(path.join(PUBLIC, 'packs'), ['.png']).sort(),
        models: walk(path.join(PUBLIC, 'assets', '3d'), ['.glb', '.gltf']).sort(),
        imported: readManifest().assets,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/editor/import') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'wrong origin' });
      if (req.headers['content-type'] !== 'application/octet-stream') return json(res, 415, { error: 'send application/octet-stream' });
      const raw = String(url.searchParams.get('name') || '');
      const ext = path.extname(raw).toLowerCase();
      const stem = path.basename(raw, path.extname(raw)).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'asset';
      if (!OK_EXT.has(ext)) return json(res, 400, { error: 'only .png, .glb and .gltf' });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX) return json(res, 413, { error: 'file too large (50 MB max)' }); chunks.push(c); }
      fs.mkdirSync(IMPORTED, { recursive: true });
      let file = stem + ext;
      for (let i = 2; fs.existsSync(path.join(IMPORTED, file)); i++) file = `${stem}-${i}${ext}`;
      fs.writeFileSync(path.join(IMPORTED, file), Buffer.concat(chunks));
      const m = readManifest();
      const entry = { file, kind: ext === '.png' ? 'sheet' : 'model', name: path.basename(raw).slice(0, 120), size, added: new Date().toISOString() };
      m.assets.push(entry);
      fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
      return json(res, 200, { ok: true, path: 'assets/imported/' + file, entry });
    }
    return json(res, 404, { error: 'unknown editor action' });
  };
};
