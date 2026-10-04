// Folder URLs and missing files must answer 404 and leave the server running (a directory used to kill it with EISDIR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { serveStatic } = createRequire(import.meta.url)('../lib/static.js');

test('static serving: directories, missing files, traversal', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cq-static-'));
  mkdirSync(path.join(root, 'bare')); mkdirSync(path.join(root, 'withindex'));
  writeFileSync(path.join(root, 'index.html'), 'home');
  writeFileSync(path.join(root, 'withindex', 'index.html'), 'inner');
  let crashed = null;
  const onErr = e => { crashed = e; };
  process.on('uncaughtException', onErr);
  const server = createServer((req, res) => serveStatic(root, new URL(req.url, 'http://x').pathname, res)).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const get = p => fetch(`http://127.0.0.1:${server.address().port}${p}`);
  try {
    assert.equal((await get('/bare/')).status, 404);
    assert.equal((await get('/bare')).status, 404);
    assert.equal((await get('/missing.js')).status, 404);
    assert.equal((await get('/../x')).status, 404);
    const inner = await get('/withindex/');
    assert.equal(inner.status, 200);
    assert.equal(await inner.text(), 'inner');
    const home = await get('/');
    assert.equal(home.status, 200);
    assert.equal(await home.text(), 'home');
    assert.equal(crashed, null);
  } finally { process.off('uncaughtException', onErr); server.close(); }
});
