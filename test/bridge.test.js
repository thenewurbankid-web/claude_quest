// The Bridge process (R4.5): real loopback sockets only. aedes + mqtt over TCP, a fake Paperclip on 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import mqtt from 'mqtt';
import { createBridge } from '../bridge/bridge.js';
import { wake } from '../public/quest/keeper-controls.js';
import { keepersMessage } from '../public/quest/work-queue.js';
import WebSocket from 'ws';

const sampleBridge = () => JSON.parse(readFileSync(new URL('../public/quest/sample-bridge.json', import.meta.url)));
const T0 = new Date('2026-10-03T12:00:00Z');
const waitFor = async (f, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = f(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 15)); } };

function ledgerWithQueue() {
  const l = JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
  const work = l.works.find(x => !['done', 'cancelled', 'in_review'].includes(x.status) && !x.gameOnly && wake(l, 'k4', x.id, {}, T0).puts.length);
  const c = wake(l, 'k4', work.id, {}, T0);
  l.queue.push(c.puts[0].record);
  return l;
}

async function setup(extra = {}) {
  const cred = sampleBridge().credential, ledger = ledgerWithQueue();
  const paperclip = { calls: [] };
  const fake = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { paperclip.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  cred.paperclip.url = `http://127.0.0.1:${fake.address().port}`;
  const bridge = createBridge({ credential: cred, origin: 'http://localhost:4777', httpPort: 0, tcpPort: 0,
    offerEveryMs: 60000, now: () => T0, ...extra });
  const ports = await bridge.start();
  const client = async id => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${ports.tcp}`, { clientId: id, username: cred.mqtt.username, password: cred.mqtt.password, reconnectPeriod: 0 });
    c.msgs = []; c.on('message', (topic, payload) => c.msgs.push({ topic, json: JSON.parse(payload.toString()) }));
    await new Promise((ok, no) => { c.once('connect', ok); c.once('error', no); });
    return c;
  };
  const clients = [];
  const open = async id => { const c = await client(id); clients.push(c); return c; };
  const optIn = (game, ids = ['k4']) => pub(game, 'quest/lantern/keepers', keepersMessage(ledger, ids, T0), true);
  const done = async () => { for (const c of clients) c.end(true); await bridge.stop(); await new Promise(r => fake.close(r)); };
  return { bridge, ports, cred, ledger, paperclip, open, optIn, done };
}
const pub = (c, topic, body, retain = false) => new Promise((ok, no) => c.publish(topic, typeof body === 'string' ? body : JSON.stringify(body), { qos: 1, retain }, e => e ? no(e) : ok()));
const sub = (c, topic) => new Promise((ok, no) => c.subscribe(topic, (e, g) => e ? no(e) : ok(g)));

test('Bridge: binds 127.0.0.1 only; refuses another host', async () => {
  assert.throws(() => createBridge({ credential: sampleBridge().credential, host: '0.0.0.0' }), /only listens on 127\.0\.0\.1/);
  const s = await setup();
  try { assert.equal(s.bridge.aedes.connectedClients, 0); } finally { await s.done(); }
});

test('Bridge: a wrong login or an unknown client id is refused', async () => {
  const s = await setup();
  try {
    const bad = mqtt.connect(`mqtt://127.0.0.1:${s.ports.tcp}`, { clientId: 'game', username: 'quest', password: 'nope', reconnectPeriod: 0 });
    await new Promise(r => { bad.once('error', r); bad.once('close', r); });
    bad.end(true);
    const stranger = mqtt.connect(`mqtt://127.0.0.1:${s.ports.tcp}`, { clientId: 'someone', username: s.cred.mqtt.username, password: s.cred.mqtt.password, reconnectPeriod: 0 });
    await new Promise(r => { stranger.once('error', r); stranger.once('close', r); });
    stranger.end(true);
    const anon = mqtt.connect(`mqtt://127.0.0.1:${s.ports.tcp}`, { clientId: 'game', reconnectPeriod: 0 }); // no login at all
    await new Promise(r => { anon.once('error', r); anon.once('close', r); });
    anon.end(true);
  } finally { await s.done(); }
});

test('Bridge: a registered Keeper gets one work offer; an unregistered or other-named one gets none', async () => {
  const s = await setup();
  try {
    const sb = sampleBridge();
    const game = await s.open('game');
    await s.optIn(game); await pub(game, 'quest/lantern/open', {});
    const ghost = await s.open('agent-k99');
    await sub(ghost, 'quest/lantern/work/k99');
    await pub(ghost, 'quest/lantern/register/k99', { ...sb.registration, keeperId: 'k99', name: 'Ghost' });
    const wren = await s.open('agent-k4');
    await sub(wren, 'quest/lantern/work/k4');
    await pub(wren, 'quest/lantern/register/k4', sb.registration);
    const m = await waitFor(() => wren.msgs.find(x => x.topic === 'quest/lantern/work/k4'));
    assert.equal(m.json.v, 1);
    assert.match(m.json.prompt, /^Quest Work: /);
    s.bridge.offerAll();                                          // not offered twice
    await new Promise(r => setTimeout(r, 100));
    assert.equal(wren.msgs.filter(x => x.topic.includes('/work/')).length, 1);
    assert.equal(ghost.msgs.length, 0);
  } finally { await s.done(); }
});

test('Bridge: topicAllowed on every publish and subscribe; an agent cannot ring the Bell or read another Keeper\'s work', async () => {
  const s = await setup();
  try {
    const agent = await s.open('agent-k4');
    await assert.rejects(sub(agent, 'quest/lantern/work/k2'), /Subscribe error/); // someone else's work: refused (suback 128)
    await assert.rejects(sub(agent, 'quest/lantern/#'));
    const closed = new Promise(r => agent.once('close', r));
    agent.publish('quest/lantern/bell', '{}', { qos: 0 });        // an agent publishing to bell is dropped
    await closed;
    assert.equal(s.bridge.state.halted, true);                    // still halted: an agent opened nothing
  } finally { await s.done(); }
});

test('Bridge: the Bell halts work; only the game\'s open clears it', async () => {
  const s = await setup();
  try {
    const game = await s.open('game'), wren = await s.open('agent-k4');
    await sub(wren, 'quest/lantern/work/k4'); await sub(game, 'quest/lantern/status');
    assert.equal(s.bridge.state.halted, true);                    // starts halted: a Bell rung while it was off is not lost
    await s.optIn(game); await pub(game, 'quest/lantern/open', {});
    await waitFor(() => !s.bridge.state.halted);
    await pub(game, 'quest/lantern/bell', {});
    await waitFor(() => s.bridge.state.halted);
    await pub(wren, 'quest/lantern/register/k4', sampleBridge().registration);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(wren.msgs.filter(x => x.topic.includes('/work/')).length, 0);
    s.bridge.offerAll();
    assert.equal(wren.msgs.filter(x => x.topic.includes('/work/')).length, 0);
    await pub(game, 'quest/lantern/open', {});
    await waitFor(() => wren.msgs.find(x => x.topic.includes('/work/')));
    assert.equal(s.bridge.state.halted, false);
  } finally { await s.done(); }
});

test('Bridge: a good report is republished for the game; a bad one is refused with the problems', async () => {
  const s = await setup();
  try {
    const game = await s.open('game'), wren = await s.open('agent-k4');
    await s.optIn(game);
    await sub(game, 'quest/lantern/report/k4'); await sub(game, 'quest/lantern/status');
    const q = s.ledger.queue.find(x => x.keeperId === 'k4').id;
    await pub(wren, 'quest/lantern/report/k4', { v: 1, queueId: q, kind: 'progress', summary: 'Wrote the first test' });
    const ok = await waitFor(() => game.msgs.find(x => x.topic === 'quest/lantern/report/k4'));
    assert.equal(ok.json.report.summary, 'Wrote the first test');
    assert.equal(ok.json.report.relayed, 'bridge');
    await pub(wren, 'quest/lantern/report/k4', { v: 1, queueId: q, kind: 'nonsense', summary: 'x' });
    await pub(wren, 'quest/lantern/report/k4', { v: 1, queueId: 'q-of-someone-else', kind: 'done', summary: 'x' });
    const refused = await waitFor(() => game.msgs.filter(x => x.json.kind === 'refused').length >= 2 && game.msgs.filter(x => x.json.kind === 'refused'));
    assert.ok(refused.every(r => r.json.problems.length > 0));
    assert.equal(game.msgs.filter(x => x.topic === 'quest/lantern/report/k4').length, 1); // bad ones never reached the report topic
  } finally { await s.done(); }
});

test('Bridge: only the player\'s own machine is answered (peer check)', async () => {
  const s = await setup();
  try {
    let dropped = false;
    const probe = netConnect(s.ports.tcp, '127.0.0.1'); probe.on('close', () => { dropped = true; }); probe.on('error', () => {});
    await new Promise(r => setTimeout(r, 80));
    assert.equal(dropped, false);                                  // loopback stays
    probe.destroy();
  } finally { await s.done(); }
});

test('Bridge Paperclip: GET passes through with CORS for the game\'s origin and the key; comments only on write', async () => {
  const s = await setup();
  const base = `http://127.0.0.1:${s.ports.http}`, tok = { 'x-quest-token': s.cred.webhook.token, origin: 'http://localhost:4777' };
  try {
    const g = await fetch(`${base}/paperclip/api/issues?x=1`, { headers: { ...tok, origin: 'http://localhost:4777' } });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get('access-control-allow-origin'), 'http://localhost:4777');
    assert.deepEqual(s.paperclip.calls[0], { method: 'GET', url: '/api/issues?x=1', auth: `Bearer ${s.cred.paperclip.key}`, body: '' });
    const other = await fetch(`${base}/paperclip/api/issues`, { headers: { ...tok, origin: 'http://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${base}/paperclip/api/issues`)).status, 401);       // no token
    const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { ...tok, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/paperclip/comment', { issueId: 'CLA-7', kind: 'decision', body: 'Sealed: Stripe' })).status, 200);
    assert.deepEqual(s.paperclip.calls.at(-1).url, '/api/issues/CLA-7/comments');
    assert.equal(s.paperclip.calls.at(-1).method, 'POST');
    assert.deepEqual(JSON.parse(s.paperclip.calls.at(-1).body), { body: 'Sealed: Stripe' });
    const n = s.paperclip.calls.length;
    assert.equal((await post('/paperclip/comment', { issueId: '../x', kind: 'decision', body: 'x' })).status, 400);
    assert.equal((await post('/paperclip/comment', { issueId: 'CLA-7', kind: 'status', body: 'x' })).status, 400);
    assert.equal((await post('/paperclip/comment', { issueId: 'CLA-7', kind: 'report', body: `leak ${s.cred.paperclip.key}` })).status, 400);
    assert.equal((await post('/paperclip/api/issues/CLA-7', { status: 'done' })).status, 404);  // no way to change a status
    for (const method of ['PATCH', 'PUT', 'DELETE']) assert.equal((await fetch(`${base}/paperclip/api/issues/CLA-7`, { method, headers: tok })).status, 404, method);
    assert.equal(s.paperclip.calls.length, n);                                      // none of those reached Paperclip
  } finally { await s.done(); }
});

test('Bridge safety: a WebSocket upgrade from a foreign Origin is refused; the game\'s own is let in', async () => {
  const s = await setup();
  try {
    const url = `ws://127.0.0.1:${s.ports.http}/`;
    const tryOrigin = origin => new Promise(res => {
      const ws = new WebSocket(url, 'mqtt', origin ? { origin } : {});
      ws.on('open', () => { ws.close(); res(true); }); ws.on('error', () => res(false)); ws.on('unexpected-response', () => res(false));
    });
    assert.equal(await tryOrigin('http://evil.example'), false);
    assert.equal(await tryOrigin(null), false);
    assert.equal(await tryOrigin('http://localhost:4777'), true);
  } finally { await s.done(); }
});

test('Bridge safety: a comment POST without the login or from a foreign Origin is refused and writes nothing', async () => {
  const s = await setup();
  const url = `http://127.0.0.1:${s.ports.http}/paperclip/comment`, body = JSON.stringify({ issueId: 'CLA-7', kind: 'decision', body: 'Sealed' });
  const send = headers => fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body }); // a plain cross-site POST
  try {
    assert.equal((await send({ origin: 'http://localhost:4777' })).status, 401);                                   // no login
    assert.equal((await send({ origin: 'http://localhost:4777', 'x-quest-token': 'wrong' })).status, 401);
    assert.equal((await send({ origin: 'http://evil.example', 'x-quest-token': s.cred.webhook.token })).status, 403); // foreign page
    assert.equal((await send({ 'x-quest-token': s.cred.webhook.token })).status, 403);                              // no Origin
    assert.equal(s.paperclip.calls.length, 0);
    assert.equal((await send({ origin: 'http://localhost:4777', 'x-quest-token': s.cred.webhook.token })).status, 200);
    assert.equal(s.paperclip.calls.length, 1);
  } finally { await s.done(); }
});

test('Bridge: only the game may publish the keepers list, and only a valid one is kept', async () => {
  const s = await setup();
  try {
    const game = await s.open('game'), wren = await s.open('agent-k4');
    const closed = new Promise(r => wren.once('close', r));
    wren.publish('quest/lantern/keepers', JSON.stringify(keepersMessage(s.ledger, ['k4'], T0)), { qos: 0 });
    await closed;
    assert.equal(s.bridge.state.keepers.keepers.length, 0);
    const gameClosed = new Promise(r => game.once('close', r));
    game.publish('quest/lantern/keepers', '{"v":1,"keepers":"all"}', { qos: 0, retain: true });
    await gameClosed;                                                         // a bad list drops the connection and is not kept
    assert.equal(s.bridge.state.keepers.keepers.length, 0);
    await s.optIn(await s.open('game'), ['k4']);
    await waitFor(() => s.bridge.state.keepers.keepers.length === 1);
    assert.deepEqual(s.bridge.state.keepers.keepers.map(k => k.id), ['k4']);   // only the opted-in Keeper is known
  } finally { await s.done(); }
});
