// The Bridge (PLAN-engine.md R4.5): an optional local process. aedes MQTT broker (TCP and WebSocket), Paperclip GET
// passthrough and comment write-back. Rules live in public/quest/contract.js; this file only wires them to sockets.
// Everything on the wire is data. The Bridge holds no ledger: the game's retained keepers message is all it knows.
import { createServer as createHttp } from 'node:http';
import { createServer as createTcp } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { Aedes } from 'aedes';
import wsStream from 'websocket-stream';
import { bridgeBindHost, isOwnMachine, topicAllowed, parseBridgeTopic, bridgeTopic, validateCredential, validateRegistration, validateKeepersMessage,
  bridgeMayOffer, bridgeHalt, reportFromBridge, credentialLeaks, PAPERCLIP_WRITES, BRIDGE_VERSION } from '../public/quest/contract.js';

const same = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };
const json = (res, code, body, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const ISSUE_ID = /^[A-Za-z0-9-]{1,64}$/;
const COMMENT_KIND = ['decision', 'report'];

/**
 * @param {{ credential: object, origin?: string|string[], host?: string, httpPort?: number,
 *           tcpPort?: number, fetch?: typeof fetch, offerEveryMs?: number, now?: () => Date }} o
 */
export function createBridge({ credential, origin = [], host, httpPort = 4779, tcpPort = 4780,
  fetch: doFetch = globalThis.fetch, offerEveryMs = 5000, now = () => new Date() }) {
  const bound = bridgeBindHost(host);
  const problems = validateCredential(credential);
  if (problems.length) throw new Error(`bad credential: ${problems.map(p => `${p.field} ${p.problem}`).join('; ')}`);
  if (!credential.mqtt) throw new Error('the Bridge needs an mqtt login in its credential');
  const realmId = credential.realmId;
  const origins = [].concat(origin);
  const state = { halted: true, keepers: { keepers: [], queue: [] }, registered: new Map(), offered: new Set() };
  const aedes = new Aedes();
  const say = (kind, extra = {}) => aedes.publish({ topic: bridgeTopic('status', realmId), retain: true, qos: 0,
    payload: JSON.stringify({ v: BRIDGE_VERSION, kind, halted: state.halted, at: now().toISOString(), ...extra }) }, () => {});
  const secret = credential.webhook?.token ?? credential.mqtt.password; // HTTP needs the Realm login either way
  const gameOrigin = o => origins.includes(o);
  const refuse = (packet, who, what, problems) => { // the message is replaced by a refusal on the status topic
    packet.topic = bridgeTopic('status', realmId); packet.retain = false;
    packet.payload = JSON.stringify({ v: BRIDGE_VERSION, kind: 'refused', what, keeperId: who.keeperId, problems, at: now().toISOString() });
  };

  // ---- who is connecting: one Realm login; the role comes from the client id (game, or agent-<keeperId>)
  aedes.authenticate = (client, username, password, cb) => {
    const m = /^(game|agent-([A-Za-z0-9][A-Za-z0-9_-]{0,63}))$/.exec(client.id || '');
    const ok = m && same(username, credential.mqtt.username) && same(password, credential.mqtt.password);
    if (ok) client.who = m[2] ? { role: 'agent', keeperId: m[2], realmId } : { role: 'game', realmId };
    cb(null, Boolean(ok));
  };
  // every publish and subscribe goes through topicAllowed; a refusal drops the client
  aedes.authorizeSubscribe = (client, sub, cb) => cb(null, topicAllowed(client.who || {}, sub.topic, 'subscribe') ? sub : null);
  aedes.authorizePublish = (client, packet, cb) => {
    const who = client.who || {};
    if (!topicAllowed(who, packet.topic, 'publish')) return cb(new Error(`${who.role || 'nobody'} may not publish to ${packet.topic}`));
    const t = parseBridgeTopic(packet.topic);
    if (t.kind === 'keepers') { // the game's opted-in Keepers, retained so a restarted Bridge gets them back
      let body; try { body = JSON.parse(String(packet.payload)); } catch { return cb(new Error('keepers: not JSON')); }
      if (validateKeepersMessage(body).length) return cb(new Error('keepers: bad message'));
    } else packet.retain = false;
    if (who.role === 'agent' && (t.kind === 'register' || t.kind === 'report')) {
      let body; try { body = JSON.parse(String(packet.payload)); } catch { return (refuse(packet, who, t.kind, [{ field: 'record', problem: 'not JSON' }]), cb(null)); }
      if (t.kind === 'register') {
        const p = validateRegistration(body);
        if (!p.length && body.keeperId !== who.keeperId) p.push({ field: 'keeperId', problem: 'must be your own Keeper id' });
        if (p.length) refuse(packet, who, 'register', p);
      } else {
        const { queueId, report, problems: p } = reportFromBridge(body);
        const item = report && state.keepers.queue.find(q => q.queueId === queueId);
        if (report && !p.length && item?.keeperId !== who.keeperId) p.push({ field: 'queueId', problem: 'not a queue item of this Keeper' });
        if (p.length || !report) refuse(packet, who, 'report', p.length ? p : [{ field: 'record', problem: 'no report' }]);
        else packet.payload = JSON.stringify({ queueId, keeperId: who.keeperId, report });
      }
    }
    cb(null);
  };

  // ---- the Bridge listens to what passes: register, bell, open
  aedes.on('publish', (packet, client) => {
    const t = parseBridgeTopic(packet.topic);
    if (!t || !client?.who) return;
    if (t.kind === 'keepers' && client.who.role === 'game') {
      try { state.keepers = JSON.parse(String(packet.payload)); } catch { return; }
      offerAll();
    } else if (t.kind === 'bell' || t.kind === 'open') {
      const was = state.halted;
      state.halted = bridgeHalt(state.halted, t.kind);
      if (state.halted !== was) say(t.kind === 'bell' ? 'halted' : 'opened');
      if (!state.halted) offerAll();
    } else if (t.kind === 'register' && client.who.role === 'agent') {
      let r; try { r = JSON.parse(String(packet.payload)); } catch { return; }
      if (!validateRegistration(r).length) { state.registered.set(r.keeperId, r); offerAll(); }
    }
  });

  // ---- hands work only through bridgeMayOffer
  function offerAll() {
    if (state.halted) return;
    const ledger = { keepers: state.keepers.keepers };
    for (const [keeperId, reg] of state.registered) {
      if (!bridgeMayOffer(ledger, reg, state.halted).ok) continue;
      const hit = state.keepers.queue.find(q => q.keeperId === keeperId && q.state === 'queued' && q.offer && !state.offered.has(q.queueId));
      if (!hit) continue;
      const offer = hit.offer;
      if (credentialLeaks(JSON.stringify(offer), credential)) continue; // a secret never goes out in an offer
      state.offered.add(hit.queueId);
      aedes.publish({ topic: bridgeTopic('work', realmId, keeperId), qos: 0, retain: false, payload: JSON.stringify(offer) }, () => {});
    }
  }

  // ---- Paperclip: reads pass through, writes are comments only
  const pc = credential.paperclip;
  const corsFor = req => origins.includes(req.headers.origin) ? { 'access-control-allow-origin': req.headers.origin, vary: 'origin',
    'access-control-allow-headers': 'content-type, x-quest-token', 'access-control-allow-methods': 'GET, POST, OPTIONS' } : {};
  const pcHeaders = () => ({ authorization: `Bearer ${pc.key}`, accept: 'application/json' });
  async function onHttp(req, res) {
    const cors = corsFor(req);
    if (!isOwnMachine(req.socket.remoteAddress)) return req.socket.destroy();
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (!same(req.headers['x-quest-token'], secret)) return json(res, 401, { error: 'token' }, cors);
    const url = new URL(req.url, 'http://bridge');
    if (!pc) return json(res, 404, { error: 'no Paperclip configured' }, cors);
    if (req.method === 'GET' && url.pathname.startsWith('/paperclip/api/')) {
      const r = await doFetch(pc.url.replace(/\/$/, '') + url.pathname.slice('/paperclip'.length) + url.search, { method: 'GET', headers: pcHeaders() });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', ...cors });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (req.method === 'POST' && url.pathname === '/paperclip/comment') {
      if (!gameOrigin(req.headers.origin)) return json(res, 403, { error: 'only the game may write' }, cors); // CORS alone stops nothing
      if (!PAPERCLIP_WRITES.includes('comment')) return json(res, 403, { error: 'writes are off' }, cors);
      let body = '';
      for await (const c of req) { body += c; if (body.length > 20000) return json(res, 413, { error: 'too big' }, cors); }
      let m; try { m = JSON.parse(body); } catch { return json(res, 400, { error: 'not JSON' }, cors); }
      const bad = !m || !ISSUE_ID.test(m.issueId || '') || !COMMENT_KIND.includes(m.kind) || typeof m.body !== 'string'
        || !m.body.trim() || m.body.length > 8000;
      if (bad) return json(res, 400, { error: 'need issueId, kind (decision or report) and a body of up to 8000 characters' }, cors);
      if (credentialLeaks(m.body, credential)) return json(res, 400, { error: 'the comment holds a secret' }, cors);
      const r = await doFetch(`${pc.url.replace(/\/$/, '')}/api/issues/${m.issueId}/comments`, { method: 'POST',
        headers: { ...pcHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ body: m.body }) });
      return json(res, r.ok ? 200 : 502, { ok: r.ok, status: r.status }, cors);
    }
    json(res, 404, { error: 'not found' }, cors);
  }

  const http = createHttp((req, res) => onHttp(req, res).catch(() => { if (!res.headersSent) json(res, 502, { error: 'Paperclip did not answer' }); }));
  const tcp = createTcp(sock => aedes.handle(sock));
  wsStream.createServer({ server: http, verifyClient: info => gameOrigin(info.origin) }, stream => aedes.handle(stream)); // MQTT over WebSocket: any page but the game's own origin is refused
  const ownOnly = sock => { if (!isOwnMachine(sock.remoteAddress)) sock.destroy(); };
  http.on('connection', ownOnly); tcp.on('connection', ownOnly);

  let timer = null;
  const listen = (srv, port) => new Promise((ok, no) => { srv.once('error', no); srv.listen(port, bound, () => ok(srv.address().port)); });
  return {
    state, aedes,
    async start() {
      await aedes.listen();
      const ports = { http: await listen(http, httpPort), tcp: await listen(tcp, tcpPort) };
      timer = setInterval(offerAll, offerEveryMs); timer.unref();
      say('open-for-business');
      return ports;
    },
    offerAll,
    async stop() {
      clearInterval(timer);
      await new Promise(r => aedes.close(r));
      await Promise.all([http, tcp].map(s => new Promise(r => s.close(() => r()))));
    },
  };
}
