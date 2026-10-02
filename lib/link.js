// The link to a hosted game page. Outgoing only: this server connects out to an MQTT broker over a WebSocket and
// never listens for anyone. Every payload is end-to-end encrypted (public/linkcrypto.js), so the broker sees only a
// random topic and ciphertext. Nothing here calls Claude; it only moves game data.
//   cq/<room>/world  retained  the latest world (sent only when it changes)
//   cq/<room>/event            each new event
//   cq/<room>/act              actions from the page  { id, method, url, body }
//   cq/<room>/ack              results back           { id, result }
const mqtt = require('mqtt');
const C = require('../public/linkcrypto');
const store = require('./store');

function start({ broker, pagesUrl, dispatch, trim }) {
  let code = store.read('link.json', {}).code;
  if (!code) { code = C.newCode(); store.write('link.json', { code, createdAt: new Date().toISOString() }); }
  const { room, key } = C.parse(code);
  const T = s => `cq/${room}/${s}`;
  const url = `${pagesUrl.replace(/\/$/, '')}/#link=${code}`;
  console.log(`[link] pair a browser with: ${url}`);

  let k, client, lastWorld = '', pendingWorld = null, timer = null;
  const ready = C.importKey(key).then(x => { k = x; });
  client = mqtt.connect(broker, { clientId: `cq-mac-${room.slice(0, 8)}-${Math.random().toString(16).slice(2, 6)}`, clean: true, reconnectPeriod: 5000, connectTimeout: 15e3 });
  client.on('connect', () => { console.log(`[link] connected to ${broker}`); client.subscribe(T('act'), { qos: 1 }); if (lastWorld) publishWorld(JSON.parse(lastWorld), true); });
  client.on('error', e => console.warn(`[link] ${e.message}`));
  client.on('message', async (topic, buf) => {
    if (topic !== T('act')) return;
    await ready;
    let a;
    try { a = await C.open(k, buf); } catch { return; } // not ours or tampered: ignore
    let result;
    try { result = await dispatch(a.method || 'POST', a.url, a.body || {}); } catch (e) { result = { error: e.message }; }
    client.publish(T('ack'), Buffer.from(await C.seal(k, { id: a.id, result })), { qos: 1 });
  });

  // Coalesce bursts: at most one world every 2 seconds, and none when nothing changed.
  async function publishWorld(w, force = false) {
    const json = JSON.stringify(trim(w));
    if (!force && json === lastWorld) return;
    lastWorld = json;
    if (!client.connected) return;
    await ready;
    client.publish(T('world'), Buffer.from(await C.seal(k, JSON.parse(json))), { qos: 1, retain: true });
  }
  return {
    url,
    world(w) { pendingWorld = w; if (!timer) timer = setTimeout(() => { timer = null; publishWorld(pendingWorld).catch(e => console.warn(`[link] ${e.message}`)); }, 2000); },
    async event(e) { if (!client.connected) return; await ready; client.publish(T('event'), Buffer.from(await C.seal(k, e)), { qos: 1 }); },
  };
}

module.exports = { start };
