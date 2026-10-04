// CLA-16: generated area lore goes to a moderation queue; only an explicit approve publishes it to the `lore` branch,
// which the client reads back. Queue states, approve/reject/edit, the publish layout and its guards, the schedule, the
// local-only review routes. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAreaLoreCells } from '../public/quest/contract.js';
import { fetchAreaLore } from '../public/quest/area-lore.js';
import * as Q from '../area-lore/queue.mjs';
import { publish, ensureCheckout } from '../area-lore/publish.mjs';
import { createLoreService, areasOf } from '../area-lore/service.mjs';

const NOW = new Date('2026-10-04T06:00:00Z');
const entry = (id, over = {}) => ({ id, cell: 'gcpv', kind: 'market', line: 'Stalls line the square', hint: 'Market on the green', question: 'A stallholder needs three baskets carried.',
  startsAt: '2026-10-04T08:00:00Z', endsAt: '2026-10-04T18:00:00Z', writtenAt: NOW.toISOString(), writer: 'template', source: { name: 'Town events', url: null }, ...over });
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
const tmp = () => mkdtemp(join(tmpdir(), 'lore-'));
async function bare() { const d = await tmp(); execFileSync('git', ['init', '-q', '--bare', d]); return d; }

test('queue: new stories are pending, never queued twice, invalid ones dropped', () => {
  let { queue, added } = Q.enqueue(Q.emptyQueue(), [entry('a'), entry('b'), entry('a'), { id: 'x' }], NOW);
  assert.deepEqual(added.map(i => i.id), ['gcpv/a', 'gcpv/b']);
  assert.ok(queue.items.every(i => i.status === 'pending'));
  ({ queue, added } = Q.enqueue(queue, [entry('a'), entry('c')], NOW));
  assert.deepEqual(added.map(i => i.id), ['gcpv/c']);
});

test('queue: approve, reject with a reason, edit then approve; only pending items change', () => {
  let { queue } = Q.enqueue(Q.emptyQueue(), [entry('a'), entry('b'), entry('c')], NOW);
  let r = Q.decide(queue, { ids: ['gcpv/a'], action: 'approve' }, NOW);
  assert.deepEqual(r.changed, ['gcpv/a']);
  r = Q.decide(r.queue, { ids: ['gcpv/b'], action: 'reject', reason: '  too   dull ' }, NOW);
  assert.equal(r.queue.items[1].status, 'rejected');
  assert.equal(r.queue.items[1].reason, 'too dull');
  r = Q.decide(r.queue, { ids: ['gcpv/c'], action: 'approve', edits: { 'gcpv/c': { line: 'Better headline', options: ['Yes', 'No', ' ', 'Maybe', 'Extra'] } } }, NOW);
  const c = r.queue.items[2];
  assert.equal(c.status, 'approved'); assert.equal(c.edited, true);
  assert.equal(c.entry.line, 'Better headline'); assert.deepEqual(c.entry.options, ['Yes', 'No', 'Maybe']);
  assert.equal(c.entry.hint, 'Market on the green'); // the hint is never editable
  r = Q.decide(r.queue, { ids: ['gcpv/a', 'gcpv/b'], action: 'approve' }, NOW);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.refused.map(x => x.why), ['already approved', 'already rejected']);
  assert.throws(() => Q.decide(r.queue, { ids: [], action: 'publish' }));
});

test('queue: an edit that empties the text is refused and the item stays pending', () => {
  const { queue } = Q.enqueue(Q.emptyQueue(), [entry('a')], NOW);
  const r = Q.decide(queue, { ids: ['gcpv/a'], action: 'approve', edits: { 'gcpv/a': { line: '   ' } } }, NOW);
  assert.equal(r.refused.length, 1);
  assert.equal(r.queue.items[0].status, 'pending');
});

test('queue: errands show no choices; markPublished only moves approved items', () => {
  assert.equal(Q.riddleOf(entry('a')).errand, true);
  assert.deepEqual(Q.riddleOf(entry('a', { options: ['x', 'y'] })).options, ['x', 'y']);
  let { queue } = Q.enqueue(Q.emptyQueue(), [entry('a'), entry('b')], NOW);
  queue = Q.decide(queue, { ids: ['gcpv/a'], action: 'approve' }, NOW).queue;
  queue = Q.markPublished(queue, ['gcpv/a', 'gcpv/b'], 'abc');
  assert.deepEqual(queue.items.map(i => i.status), ['published', 'pending']);
});

test('publish: creates the orphan lore branch with only lore/ files and pushes only that branch', async () => {
  const remote = await bare(), dir = join(await tmp(), 'clone'), game = await tmp();
  const sha = await publish({ dir, remote, gameDir: game, entries: [entry('market-1'), entry('market-2', { cell: 'gcpw' })], now: NOW });
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), 'refs/heads/lore');
  assert.equal(git(remote, 'rev-list', '--max-parents=0', 'lore'), sha); // orphan: root commit
  assert.deepEqual(git(remote, 'ls-tree', '-r', '--name-only', 'lore').split('\n'),
    ['lore/cells.json', 'lore/gcpv/index.json', 'lore/gcpv/market-1.json', 'lore/gcpw/index.json', 'lore/gcpw/market-2.json']);
  const cells = JSON.parse(await readFile(join(dir, 'lore', 'cells.json'), 'utf8'));
  assert.deepEqual(validateAreaLoreCells(cells), []);
  assert.deepEqual(cells.cells, ['gcpv', 'gcpw']);
  const ix = JSON.parse(await readFile(join(dir, 'lore', 'gcpv', 'index.json'), 'utf8'));
  assert.deepEqual(ix.entries.map(e => e.id), ['market-1']);
});

test('publish: a second publish adds to the same branch; ended entries are dropped; a fresh clone continues from the remote', async () => {
  const remote = await bare(), game = await tmp(), a = join(await tmp(), 'a'), b = join(await tmp(), 'b');
  await publish({ dir: a, remote, gameDir: game, entries: [entry('one')], now: NOW });
  await publish({ dir: a, remote, gameDir: game, entries: [entry('two')], now: NOW });
  assert.equal(git(remote, 'rev-list', '--count', 'lore'), '2');
  const later = new Date('2026-10-05T06:00:00Z'); // both have ended
  await publish({ dir: b, remote, gameDir: game, entries: [entry('three', { startsAt: '2026-10-05T08:00:00Z', endsAt: '2026-10-05T18:00:00Z' })], now: later });
  assert.deepEqual(git(remote, 'ls-tree', '-r', '--name-only', 'lore').split('\n'), ['lore/cells.json', 'lore/gcpv/index.json', 'lore/gcpv/three.json']);
});

test('publish: refuses a clone inside the game checkout, a clone on another branch, and invalid entries', async () => {
  const remote = await bare(), game = await tmp();
  await assert.rejects(publish({ dir: join(game, 'data', 'lore'), remote, gameDir: game, entries: [] }), /outside the game checkout/);
  await assert.rejects(publish({ dir: game, remote, gameDir: game, entries: [] }), /outside the game checkout/);
  const dir = join(await tmp(), 'c');
  await ensureCheckout({ dir, remote, gameDir: game });
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await assert.rejects(publish({ dir, remote, gameDir: game, entries: [] }), /must be on lore/);
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/lore');
  await assert.rejects(publish({ dir, remote, gameDir: game, entries: [{ id: 'bad' }] }), /invalid/);
  assert.equal(git(remote, 'for-each-ref'), ''); // nothing was pushed
});

async function rig(over = {}) {
  const remote = await bare(), dataDir = await tmp(), repoDir = join(await tmp(), 'repo'), gameDir = await tmp();
  const calls = { gen: 0 };
  const svc = createLoreService({ dataDir, gameDir, port: 0, publicDir: join(process.cwd(), 'public'), now: () => NOW,
    cfg: { lore: { cell: 'gcpv', remote, repoDir, ...over.lore } }, ollama: null,
    generateFn: async ({ known }) => { calls.gen++; return [entry('m1'), entry('m2')].filter(e => !known.some(k => k.id === e.id)); }, ...over.svc });
  return { svc, remote, dataDir, repoDir, calls };
}

test('service: generating fills the pending queue and publishes nothing', async () => {
  const { svc, remote } = await rig();
  assert.deepEqual(await svc.generate(), { added: 2 });
  assert.deepEqual(await svc.generate(), { added: 0 }); // known stories are not written again
  assert.equal((await svc.view()).items.filter(i => i.status === 'pending').length, 2);
  assert.equal(git(remote, 'for-each-ref'), '');
  assert.deepEqual(await svc.publishApproved(), { published: 0 });
});

test('service: approve one publishes just that one; reject publishes nothing; the client reads it back', async () => {
  const { svc, remote, repoDir } = await rig();
  await svc.generate();
  const r = await svc.decide({ ids: ['gcpv/m1'], action: 'approve' });
  assert.equal(r.publish.published, 1);
  assert.deepEqual(git(remote, 'ls-tree', '-r', '--name-only', 'lore').split('\n'), ['lore/cells.json', 'lore/gcpv/index.json', 'lore/gcpv/m1.json']);
  const rej = await svc.decide({ ids: ['gcpv/m2'], action: 'reject', reason: 'dull' });
  assert.equal(rej.publish, null);
  assert.equal(git(remote, 'rev-list', '--count', 'lore'), '1');
  const items = (await svc.view()).items;
  assert.deepEqual(items.map(i => [i.id, i.status]).sort(), [['gcpv/m1', 'published'], ['gcpv/m2', 'rejected']]);
  const server = http.createServer(async (req, res) => { if (!(await svc.handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end(); } });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const bare2 = createLoreService({ dataDir: await tmp(), gameDir: await tmp(), publicDir: 'public', cfg: { lore: { cell: 'gcpv', base: join(repoDir, 'lore') } } });
  const server2 = http.createServer(async (req, res) => { if (!(await bare2.handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end(); } });
  await new Promise(ok => server2.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${server2.address().port}/lore-local/`;
    const cfgRes = await (await fetch(`http://127.0.0.1:${server2.address().port}/api/lore/config`)).json();
    assert.deepEqual(cfgRes, { base: '/lore-local/', cell: 'gcpv' });
    const got = await fetchAreaLore(base, ['gcpv'], { now: new Date('2026-10-04T10:00:00Z') });
    assert.deepEqual(got.entries.map(e => e.id), ['m1']);
  } finally { server.close(); server2.close(); }
});

test('service: edit then approve publishes the edited text', async () => {
  const { svc, repoDir } = await rig();
  await svc.generate();
  await svc.decide({ ids: ['gcpv/m1'], action: 'approve', edits: { 'gcpv/m1': { line: 'A fine edited headline', question: 'Which basket first?', options: ['Left', 'Right'] } } });
  const e = JSON.parse(await readFile(join(repoDir, 'lore', 'gcpv', 'm1.json'), 'utf8'));
  assert.equal(e.line, 'A fine edited headline'); assert.deepEqual(e.options, ['Left', 'Right']);
});

test('service: a failed push leaves the story approved and the next publish retries it', async () => {
  let fail = true;
  const { svc } = await rig({ svc: { publishFn: async a => { if (fail) throw new Error('offline'); return publish(a); } } });
  await svc.generate();
  const r = await svc.decide({ ids: ['gcpv/m1'], action: 'approve' });
  assert.equal(r.publish.error, 'offline');
  assert.equal((await svc.view()).items.find(i => i.id === 'gcpv/m1').status, 'approved');
  fail = false;
  assert.equal((await svc.publishApproved()).published, 1);
  assert.equal((await svc.view()).items.find(i => i.id === 'gcpv/m1').status, 'published');
});

test('service: the schedule generates on start and then on every tick, and does nothing with no cell', async () => {
  const { svc, calls } = await rig({ svc: { everyMs: 40 } });
  const stop = svc.start();
  await new Promise(ok => setTimeout(ok, 250));
  stop();
  assert.ok(calls.gen >= 3, `generated ${calls.gen} times`);
  const none = createLoreService({ dataDir: await tmp(), gameDir: await tmp(), publicDir: 'public', cfg: {}, generateFn: async () => { throw new Error('no'); } });
  none.start()();
  assert.deepEqual(areasOf({}), []);
  assert.deepEqual(areasOf({ cell: 'gcpv' }), [{ cell: 'gcpv' }]);
  assert.deepEqual(areasOf({ cell: 'nope!' }), []);
});

test('service: generation asks the model to let go afterwards', async () => {
  const seen = [];
  const { svc } = await rig({ svc: { ollama: { url: 'http://o', model: 'qwen3:4b' }, fetchFn: async (u, o) => { seen.push([u, JSON.parse(o.body)]); return { ok: true }; } } });
  await svc.generate();
  assert.deepEqual(seen.at(-1), ['http://o/api/generate', { model: 'qwen3:4b', keep_alive: 0 }]);
});

test('service: review routes answer only local callers, writes need the header', async () => {
  const { svc } = await rig();
  await svc.generate();
  const server = http.createServer(async (req, res) => { if (!(await svc.handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end(); } });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port, u = p => `http://127.0.0.1:${port}${p}`;
  const post = (headers, body) => fetch(u('/api/lore/decide'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(u('/api/lore/queue'))).status, 200);
    const rawStatus = host => new Promise(ok => http.get({ host: '127.0.0.1', port, path: '/api/lore/queue', headers: { host } }, r => { r.resume(); ok(r.statusCode); }));
    assert.equal(await rawStatus('evil.example'), 403);
    assert.equal(await rawStatus(`localhost:${port}`), 200);
    assert.equal((await fetch(u('/lore-review'))).status, 200);
    assert.equal((await post({}, { ids: ['gcpv/m1'], action: 'approve' })).status, 403);
    assert.equal((await post({ 'x-lore-review': '1', origin: 'https://evil.example' }, { ids: ['gcpv/m1'], action: 'approve' })).status, 403);
    assert.equal((await svc.view()).items.every(i => i.status === 'pending'), true);
    assert.equal((await post({ 'x-lore-review': '1' }, { ids: ['gcpv/m1'], action: 'reject' })).status, 200);
    assert.equal((await post({ 'x-lore-review': '1' }, { ids: [], action: 'nope' })).status, 400);
  } finally { server.close(); }
});
