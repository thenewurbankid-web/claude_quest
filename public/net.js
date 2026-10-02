// Where the game gets its world and sends its actions. Three modes:
//   local   - served by app.js on this machine: same-origin /api and a live event stream (the original setup).
//   linked  - hosted (e.g. GitHub Pages) and paired with the player's Mac over an end-to-end encrypted MQTT link
//             (see Link below). The Mac never takes an incoming connection; both sides connect out to the broker.
//   browser - nothing linked. The game runs on its last saved world, kept in IndexedDB, with export/import and
//             checkpoints. Actions that need Claude wait in a queue until a link exists.
const SAVE_VERSION = 1;

// ---------- the browser save: a tiny IndexedDB key/value store ----------
const Saves = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((ok, fail) => {
      const r = indexedDB.open('claude-quest', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }).catch(() => null);
    return this.db;
  },
  async get(k, d = null) {
    const db = await this.open();
    if (!db) { try { return JSON.parse(localStorage.getItem(`cq-db-${k}`)) ?? d; } catch { return d; } }
    return new Promise(ok => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result ?? d); r.onerror = () => ok(d); });
  },
  async set(k, v) {
    const db = await this.open();
    if (!db) { try { localStorage.setItem(`cq-db-${k}`, JSON.stringify(v)); } catch {} return; }
    return new Promise(ok => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; });
  },

  // Everything that makes up a save: the world as last seen, the player's own progress, queued actions.
  clientKeys: ['cq-pos', 'cq-attuned', 'cq-seen', 'cq-camp-slots'],
  async bundle(name = 'save') {
    const client = {};
    for (const k of this.clientKeys) { try { client[k] = JSON.parse(localStorage.getItem(k)); } catch {} }
    return { kind: 'claude-quest-save', version: SAVE_VERSION, name, at: new Date().toISOString(), world: await this.get('world'), client, pending: await this.get('pending', []) };
  },
  async restore(b) {
    if (b?.kind !== 'claude-quest-save') throw new Error('That file is not a Claude Quest save.');
    if (b.world) await this.set('world', b.world);
    await this.set('pending', b.pending || []);
    for (const k of this.clientKeys) { try { if (b.client?.[k] === undefined || b.client[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(b.client[k])); } catch {} }
  },
  async exportFile() {
    const b = await this.bundle('export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
    a.download = `claude-quest-${b.at.slice(0, 16).replace(/[:T]/g, '-')}.cqsave.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async importFile(file) { await this.restore(JSON.parse(await file.text())); },
  async checkpoints() { return this.get('checkpoints', []); },
  async checkpoint(name) {
    const list = await this.checkpoints();
    list.unshift(await this.bundle(name || `Checkpoint ${list.length + 1}`));
    await this.set('checkpoints', list.slice(0, 12));
  },
  async loadCheckpoint(i) { const list = await this.checkpoints(); if (list[i]) await this.restore(list[i]); },
  async deleteCheckpoint(i) { const list = await this.checkpoints(); list.splice(i, 1); await this.set('checkpoints', list); },
};

// ---------- the link: MQTT over a WebSocket, end-to-end encrypted ----------
// The page and the player's Mac both connect out to a broker; neither listens. The pairing code (room.key) comes
// from the link the local server prints, in the URL fragment, which browsers never send anywhere.
const Link = {
  get code() { try { return localStorage.getItem('cq-link') || null; } catch { return null; } },
  set code(v) { try { v ? localStorage.setItem('cq-link', v) : localStorage.removeItem('cq-link'); } catch {} },
  get broker() { try { return localStorage.getItem('cq-broker') || LinkCrypto.DEFAULT_BROKER; } catch { return LinkCrypto.DEFAULT_BROKER; } },
  client: null, key: null, room: null, status: 'off',
  async connect(onWorld, onEvent, onAck) {
    const { room, key } = LinkCrypto.parse(this.code);
    this.room = room; this.key = await LinkCrypto.importKey(key);
    const T = t => `cq/${room}/${t}`;
    this.status = 'connecting';
    this.client = mqtt.connect(this.broker, { clientId: `cq-page-${Math.random().toString(16).slice(2, 10)}`, clean: true, reconnectPeriod: 4000 });
    this.client.on('connect', () => { this.status = 'connected'; this.client.subscribe([T('world'), T('event'), T('ack')], { qos: 1 }); });
    this.client.on('close', () => { this.status = 'reconnecting'; });
    this.client.on('error', e => { this.status = `error: ${e.message}`; });
    this.client.on('message', async (topic, buf) => {
      let msg;
      try { msg = await LinkCrypto.open(this.key, buf); } catch { return; }
      if (topic === T('world')) { this.seenMac = Date.now(); onWorld(msg); }
      else if (topic === T('event')) onEvent(msg);
      else if (topic === T('ack')) onAck(msg);
    });
  },
  async send(action) {
    if (!this.client?.connected) throw new Error('not connected');
    this.client.publish(`cq/${this.room}/act`, await LinkCrypto.seal(this.key, action), { qos: 1 });
  },
};

// Pairing: a link like https://…/#link=<room>.<key> sets the code once, then the fragment is wiped from the bar.
(function takeLinkFromUrl() {
  const m = /[#&]link=([\w-]+\.[\w-]+)/.exec(location.hash);
  if (!m) return;
  try { LinkCrypto.parse(m[1]); Link.code = m[1]; } catch {}
  history.replaceState(null, '', location.pathname + location.search);
})();

// ---------- the one interface the game uses ----------
const LOCAL_ONLY = 'The land is cut off from the Ember Well. Link your Mac in the Map Room (settings) to send this to Claude.';
const QUEUEABLE = new Set(['/api/decide', '/api/letter', '/api/mission', '/api/step', '/api/flush']);

const Net = {
  mode: null,
  world: null,
  onWorld: null, onEvent: null,
  waiting: new Map(),

  async detect() {
    if (this.mode) return this.mode;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      try { const r = await fetch('api/world', { cache: 'no-store' }); if (r.ok && (r.headers.get('content-type') || '').includes('json')) return (this.mode = 'local'); } catch {}
    }
    return (this.mode = Link.code ? 'linked' : 'browser');
  },

  async post(url, body = {}) {
    await this.detect();
    if (this.mode === 'local') return fetch(url.replace(/^\//, ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    if (url === '/api/settings' || url === '/api/intro') return this.localSave(url, body);
    if (this.mode === 'linked') return this.relay('POST', url, body);
    if (QUEUEABLE.has(url)) { const p = await Saves.get('pending', []); p.push({ id: uid(), at: new Date().toISOString(), method: 'POST', url, body }); await Saves.set('pending', p); return { ok: true, queued: 'offline' }; }
    return { error: LOCAL_ONLY };
  },

  async get(url) {
    await this.detect();
    if (this.mode === 'local') return fetch(url.replace(/^\//, ''), { cache: 'no-store' }).then(r => r.json());
    if (url === '/api/world') return this.world;
    if (this.mode === 'linked') return this.relay('GET', url);
    return { error: LOCAL_ONLY, repos: [], areas: [], max: 5, charted: this.world?.towns.length || 0 };
  },

  // Settings and the intro belong to the player, so they also live in the browser save in hosted modes.
  async localSave(url, body) {
    const w = this.world;
    if (url === '/api/intro') w.save.introDone = true;
    else { const { names, ...rest } = body; Object.assign(w.save.settings, rest); if (names) w.save.settings.names = { ...w.save.settings.names, ...names }; }
    await Saves.set('world', w);
    if (this.mode === 'linked') this.relay('POST', url, body).catch(() => {});
    this.emitWorld(w);
    return url === '/api/intro' ? { ok: true } : w.save.settings;
  },

  // Send an action over the link and wait for the Mac's answer. If the link is down, answers and letters queue.
  async relay(method, url, body) {
    const id = uid(), action = { id, at: new Date().toISOString(), method, url, body };
    try { await Link.send(action); }
    catch {
      if (QUEUEABLE.has(url)) { const p = await Saves.get('pending', []); p.push(action); await Saves.set('pending', p); return { ok: true, queued: 'offline' }; }
      return { error: 'The link to your Mac is down. Is the local server running?' };
    }
    return new Promise(ok => {
      const timer = setTimeout(() => { this.waiting.delete(id); ok({ error: 'Your Mac did not answer. Is the local server running with the link on?' }); }, 30e3);
      this.waiting.set(id, r => { clearTimeout(timer); ok(r); });
    });
  },

  emitWorld(w) { this.onWorld?.(w); },

  // Start the world feed. Calls onWorld(world) whenever it changes and onEvent(e) for each new event.
  async subscribe(onWorld, onEvent) {
    this.onWorld = onWorld; this.onEvent = onEvent;
    await this.detect();
    if (this.mode === 'local') {
      const es = new EventSource('api/stream');
      es.addEventListener('world', e => { const w = JSON.parse(e.data); if (w) { this.world = w; Saves.set('world', strip(w)); onWorld(w); } });
      es.addEventListener('event', e => onEvent(JSON.parse(e.data)));
      return;
    }
    this.world = (await Saves.get('world')) || DEMO_WORLD();
    if (!this.world.save) this.world.save = DEMO_WORLD().save;
    this.world.guild = { up: false };
    onWorld(this.world);
    if (this.mode === 'linked') {
      this.seen = new Set((this.world.events || []).map(e => e.id));
      await Link.connect(w => this.take(w), e => { if (!this.seen.has(e.id)) { this.seen.add(e.id); this.onEvent?.(e); } },
        a => { const cb = this.waiting.get(a.id); if (cb) { this.waiting.delete(a.id); cb(a.result); } });
      const t = setInterval(() => { if (Link.client?.connected) { clearInterval(t); this.flushPending(); } }, 1000);
    }
  },

  take(w) {
    // Keep the player's own settings; the poller's copy of them may be older.
    w.save = { ...w.save, ...this.world.save, settings: { ...w.save?.settings, ...this.world.save?.settings } };
    const fresh = (w.events || []).filter(e => !this.seen.has(e.id)).reverse();
    for (const e of fresh) this.seen.add(e.id);
    this.world = w;
    Saves.set('world', strip(w));
    this.onWorld?.(w);
    for (const e of fresh.slice(-6)) this.onEvent?.(e);
  },

  // Actions queued while unlinked go out once the mailbox is reachable.
  async flushPending() {
    const p = await Saves.get('pending', []);
    if (!p.length) return;
    try { for (const a of p) await Link.send(a); await Saves.set('pending', []); } catch {}
  },
};

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// What a browser save keeps of a world: drop acks (one-shot) and the Guild (live only).
const strip = w => ({ ...w, guild: { up: false } });

// A fresh world for someone with nothing linked and no save yet: one land, the game itself.
function DEMO_WORLD() {
  return {
    towns: [{
      id: 'claude-quest', name: 'Claude Quest', color: '#e0a84f', projectId: null, townName: 'Ember Hollow',
      motto: 'Where the roads are laid, one quest at a time.', status: 'quiet', generating: false, storySource: 'template',
      activeTitle: null, lastActivityAgo: 'a while ago', lastClaude: null, blocked: null, branch: 'main', dirty: 0, commits: [],
      story: ['Ember Hollow is quiet. Its builders are away.', 'Link your Mac in the Map Room and the lands come alive.'],
      scout: ['No Claude has passed through yet.'], historian: ['The chronicle is still unwritten.'],
      missions: [], decisions: [], camps: [], claudes: [], bosses: [], stopped: false, flowers: 3, statues: 0, journal: null,
    }],
    events: [], outbox: [], model: 'offline', night: null,
    stats: { answers: 0, missionsDone: 0, bosses: 0, messages: 0, days: [], streak: 0 }, badges: [], runs: [],
    guild: { up: false },
    save: { introDone: false, maxAreas: 5, settings: { sound: true, music: true, autoplaySec: 60, subtext: 'always', minimap: true, minimapCorner: 'tr', minimapSize: 'm' } },
  };
}
