// The lore service the game server runs (CLA-16): generates area lore on a schedule into a moderation queue, serves the
// local review page, and publishes approved stories to the `lore` branch. Nothing leaves the Mac without an explicit
// approve. Config (config.json "lore"): cell | areas, everyHours (3), model (qwen3:4b), remote, repoDir, base
// (override for testing: a local folder, served at /lore-local/, or a URL).
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { generateNew } from './generate.mjs';
import { publish, DEFAULT_REMOTE } from './publish.mjs';
import * as Q from './queue.mjs';

const { serveStatic } = createRequire(import.meta.url)('../lib/static.js');
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const isLoopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

/** Cells to generate for: lore.areas, else lore.cell, else none (no place is known on the server). */
export const areasOf = lore => (Array.isArray(lore?.areas) && lore.areas.length ? lore.areas : /^[0-9b-hjkmnp-z]{4}$/.test(lore?.cell || '') ? [{ cell: lore.cell }] : []);

export function createLoreService({ dataDir, gameDir, port, publicDir, cfg = {}, ollama = null, fetchFn = globalThis.fetch,
  generateFn = generateNew, publishFn = publish, log = () => {}, now = () => new Date(), everyMs }) {
  const lore = cfg.lore || {};
  const file = join(dataDir, 'lore-queue.json');
  const remote = lore.remote || DEFAULT_REMOTE;
  const repoDir = resolve(lore.repoDir || join(homedir(), '.claude-quest', 'lore-repo'));
  const localBase = lore.base && !/^https?:/.test(lore.base) ? (isAbsolute(lore.base) ? lore.base : resolve(gameDir, lore.base)) : null;
  const status = { lastGeneratedAt: null, lastError: null, generating: false, publishing: false };

  const load = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return Q.emptyQueue(); } };
  const save = async q => { await mkdir(dataDir, { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify(q, null, 2)); await rename(`${file}.tmp`, file); };
  let chain = Promise.resolve(); // one queue change at a time
  const locked = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  async function unload() {
    if (!ollama?.url) return;
    await fetchFn(`${ollama.url.replace(/\/$/, '')}/api/generate`, { method: 'POST', body: JSON.stringify({ model: ollama.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }

  /** One generation pass: new stories go to the pending queue. */
  const generate = () => locked(async () => {
    const areas = areasOf(lore);
    if (!areas.length || status.generating) return { added: 0 };
    status.generating = true;
    try {
      const q = await load();
      const at = now();
      const fresh = await generateFn({ areas, known: Q.knownEntries(q), now: at, ollama, fetchFn, log, keepAlive: '1m' });
      const { queue, added } = Q.enqueue(Q.prune(q, at), fresh, at);
      await save(queue);
      status.lastGeneratedAt = at.toISOString(); status.lastError = null;
      return { added: added.length };
    } catch (err) { status.lastError = `generate: ${err.message}`; log(status.lastError); return { added: 0, error: err.message }; }
    finally { status.generating = false; await unload(); }
  });

  /** Pushes every approved item; a failure leaves them approved for the next try. */
  const publishApproved = () => locked(async () => {
    const q = await load(), items = Q.byStatus(q, 'approved');
    if (!items.length) return { published: 0 };
    status.publishing = true;
    try {
      const commit = await publishFn({ dir: repoDir, remote, gameDir, entries: items.map(i => i.entry), now: now() });
      await save(Q.markPublished(q, items.map(i => i.id), commit));
      status.lastError = null;
      return { published: items.length, commit };
    } catch (err) { status.lastError = `publish: ${err.message}`; log(status.lastError); return { published: 0, error: err.message }; }
    finally { status.publishing = false; }
  });

  /** Approve (optionally with edits) or reject; approved items are published right away. */
  async function decide(body) {
    const r = await locked(async () => {
      const out = Q.decide(await load(), { ids: Array.isArray(body.ids) ? body.ids : [], action: body.action, reason: body.reason, edits: body.edits || {} }, now());
      await save(out.queue);
      return out;
    });
    const pub = body.action === 'approve' && r.changed.length ? await publishApproved() : null;
    return { changed: r.changed, refused: r.refused, publish: pub };
  }

  const view = async () => {
    const q = await load(), t = now().getTime();
    return { status, remote, base: lore.base || null, areas: areasOf(lore),
      items: q.items.filter(i => i.status !== 'published' || Date.parse(i.entry.endsAt) > t)
        .map(i => ({ ...i, riddle: Q.riddleOf(i.entry) })).reverse() };
  };

  function start() {
    if (!areasOf(lore).length) { log('lore: no cell configured (config.json "lore.cell"); the board uses the calendar'); return () => {}; }
    const tick = () => generate().then(() => publishApproved()).catch(() => {});
    tick();
    const t = setInterval(tick, everyMs ?? Math.max(0.01, +lore.everyHours || 3) * 3600e3);
    t.unref?.();
    return () => clearInterval(t);
  }

  // ---------- HTTP ----------
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  // Review calls are local only: loopback peer, a localhost Host (no DNS rebinding), and for writes a custom header
  // (a web page on another site cannot send it without a preflight) plus a matching Origin when one is sent.
  const localOnly = (req, write) => {
    if (!isLoopback(req.socket.remoteAddress) || !LOCAL_HOST.test(req.headers.host || '')) return false;
    if (!write) return true;
    const origin = req.headers.origin;
    if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) return false;
    return req.headers['x-lore-review'] === '1';
  };
  const readBody = req => new Promise((ok, no) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { no(new Error('bad json')); } });
    req.on('error', no);
  });

  /** Returns true when it answered the request. */
  async function handle(req, res, url) {
    const p = url.pathname;
    if (p === '/api/lore/config' && req.method === 'GET') return json(res, 200, { base: localBase ? '/lore-local/' : lore.base || null, cell: areasOf(lore)[0]?.cell || null }), true;
    if (p.startsWith('/lore-local/') && localBase) return serveStatic(localBase, p.slice('/lore-local'.length), res), true;
    if (p === '/lore-review') {
      if (!localOnly(req, false)) return json(res, 403, { error: 'local only' }), true;
      serveStatic(publicDir, '/lore-review.html', res); return true;
    }
    if (p === '/api/lore/queue' && req.method === 'GET') {
      if (!localOnly(req, false)) return json(res, 403, { error: 'local only' }), true;
      return json(res, 200, await view()), true;
    }
    if (p === '/api/lore/decide' && req.method === 'POST') {
      if (!localOnly(req, true)) return json(res, 403, { error: 'local only' }), true;
      try { return json(res, 200, await decide(await readBody(req))), true; }
      catch (err) { return json(res, 400, { error: err.message }), true; }
    }
    if (p === '/api/lore/generate' && req.method === 'POST') {
      if (!localOnly(req, true)) return json(res, 403, { error: 'local only' }), true;
      return json(res, 200, await generate()), true;
    }
    return false;
  }

  return { generate, decide, publishApproved, view, start, handle, status, load };
}
