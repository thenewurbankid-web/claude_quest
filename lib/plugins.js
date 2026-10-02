// Studio plugins: discovers plugins/<kind>/<name>/{plugin.json,index.js} and serves the local-only studio endpoints.
//   GET  /api/studio/plugins              → { plugins: [{ id, kind, label, description, cost, available? }] }
//   GET  /api/studio/models?provider=id   → { models: [{ id, label, size }] }
//   POST /api/studio/chat                 → JSON { provider, model, messages, system } in; NDJSON out:
//                                           {"delta":"…"} and {"thinking":n} (reasoning so far, in chars) lines,
//                                           then {"done":true} or {"error":"…"}
// Like the editor endpoints, app.js calls this outside the `routes` table, so a linked hosted page can't reach it.
// The chat POST must be application/json (forces a CORS preflight, never granted) from this host's Origin.
const fs = require('fs');
const path = require('path');

const KINDS = ['provider', 'tool3d', 'tool2d'];
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

function load(dir, cfg) {
  const out = new Map();
  for (const kind of KINDS) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, kind), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { continue; }
    for (const name of names) {
      const home = path.join(dir, kind, name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(home, 'plugin.json'), 'utf8'));
        const id = String(manifest.id || name);
        if (manifest.kind && manifest.kind !== kind) throw new Error(`kind "${manifest.kind}" but lives in ${kind}/`);
        const impl = require(path.join(home, 'index.js'))({ cfg, manifest, home });
        out.set(id, { id, kind, label: manifest.label || id, description: manifest.description || '', cost: manifest.cost || 'free', impl });
      } catch (e) {
        console.error(`plugin ${kind}/${name} skipped: ${e.message}`);
      }
    }
  }
  return out;
}

async function readJson(req, max = 2e6) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > max) throw Object.assign(new Error('request too large'), { status: 413 }); }
  return JSON.parse(s || '{}');
}

module.exports = function studio(dir, cfg) {
  const plugins = load(dir, cfg);
  const provider = id => { const p = plugins.get(id); return p?.kind === 'provider' ? p : null; };

  return async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/studio/plugins') {
      const list = await Promise.all([...plugins.values()].map(async ({ impl, ...p }) =>
        ({ ...p, available: impl.available ? await impl.available().catch(() => false) : true })));
      return json(res, 200, { plugins: list });
    }
    if (req.method === 'GET' && url.pathname === '/api/studio/models') {
      const p = provider(url.searchParams.get('provider'));
      if (!p) return json(res, 404, { error: 'no such provider' });
      try { return json(res, 200, { models: await p.impl.models() }); } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/chat') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'wrong origin' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'send application/json' });
      const body = await readJson(req);
      const p = provider(body.provider);
      if (!p) return json(res, 404, { error: 'no such provider' });
      const messages = (Array.isArray(body.messages) ? body.messages : [])
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content }));
      if (!messages.length || !body.model) return json(res, 400, { error: 'needs a model and at least one message' });
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      try {
        let thought = 0;
        for await (const c of p.impl.chat({ model: String(body.model), messages, system: typeof body.system === 'string' ? body.system : '', signal: ac.signal })) {
          if (typeof c === 'string') res.write(JSON.stringify({ delta: c }) + '\n');
          else if (c?.thinking) res.write(JSON.stringify({ thinking: (thought += c.thinking.length) }) + '\n');
        }
        res.end(JSON.stringify({ done: true }) + '\n');
      } catch (e) {
        if (!ac.signal.aborted) res.end(JSON.stringify({ error: e.message }) + '\n');
      }
      return;
    }
    return json(res, 404, { error: 'unknown studio action' });
  };
};
