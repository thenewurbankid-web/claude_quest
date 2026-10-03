// The Local Ledger in IndexedDB: the contract's LedgerStore (contract.js), the only live project data (PLAN-engine.md,
// "No server"). Its own database, apart from net.js's 'claude-quest'. One object store per kind in KINDS, keyed by id;
// events have no id, so theirs is an autoIncrement key. A 'meta' store holds the realm and the ledger version.
// Records keep their insertion order, as memoryStore does: each is held as { id, seq, r } and read back by seq.
// Subscribers hear every change, from this tab and (through a BroadcastChannel) from the others.
import { KINDS, LEDGER_VERSION, emptyLedger } from './contract.js';

const DB_VERSION = 1;
const CHANNEL = 'quest-ledger';
const META = 'meta';

const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const done = tx => new Promise((ok, no) => {
  tx.oncomplete = () => ok();
  tx.onerror = () => no(tx.error);
  tx.onabort = () => no(tx.error || new Error('transaction aborted'));
});
const known = kind => { if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`); };
const clone = v => JSON.parse(JSON.stringify(v));

function open(name) {
  return new Promise((ok, no) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const k of KINDS) {
        if (db.objectStoreNames.contains(k)) continue;
        if (k === 'events') db.createObjectStore(k, { autoIncrement: true });
        else db.createObjectStore(k, { keyPath: 'id' }).createIndex('seq', 'seq');
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
    r.onblocked = () => no(new Error(`ledger database ${name} is blocked by another tab`));
  });
}

/** Opens (creating if needed) the IndexedDB ledger and returns a LedgerStore. */
export async function openLedger(name = 'quest-ledger') {
  const db = await open(name);
  db.onversionchange = () => db.close();
  const subs = new Set();
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;

  // the next seq for a kind, kept in meta so it survives reloads; called inside a write transaction
  const nextSeq = async (meta, kind) => {
    const n = (await req(meta.get(`seq:${kind}`))) || 0;
    meta.put(n + 1, `seq:${kind}`);
    return n;
  };

  async function snapshot() {
    const tx = db.transaction([...KINDS, META], 'readonly');
    const [realm, version, ...lists] = await Promise.all([
      req(tx.objectStore(META).get('realm')),
      req(tx.objectStore(META).get('version')),
      ...KINDS.map(k => k === 'events' ? req(tx.objectStore(k).getAll())
        : req(tx.objectStore(k).index('seq').getAll()).then(rows => rows.map(x => x.r))),
    ]);
    const l = emptyLedger(realm || undefined);
    l.version = version ?? LEDGER_VERSION;
    KINDS.forEach((k, i) => { l[k] = lists[i]; });
    return l;
  }

  const notify = async () => {
    if (!subs.size) return;
    const s = await snapshot();
    subs.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } });
  };
  const changed = async () => { bc?.postMessage({ changed: name }); await notify(); };
  if (bc) bc.onmessage = e => { if (e.data?.changed === name) notify(); };

  return {
    snapshot,
    async put(kind, record) {
      known(kind);
      const r = clone(record);
      if (kind === 'works') r.updatedAt = new Date().toISOString();
      if (kind !== 'events' && (typeof r.id !== 'string' || !r.id)) throw new Error(`a ${kind} record needs a string id`);
      const tx = db.transaction([kind, META], 'readwrite');
      const store = tx.objectStore(kind);
      if (kind === 'events') store.add(r);
      else {
        const old = await req(store.get(r.id));
        const seq = old ? old.seq : await nextSeq(tx.objectStore(META), kind);
        store.put({ id: r.id, seq, r });
      }
      await done(tx);
      await changed();
    },
    async remove(kind, id) {
      known(kind);
      const tx = db.transaction(kind, 'readwrite');
      tx.objectStore(kind).delete(kind === 'events' ? Number(id) : id); // an event's id is its autoIncrement key
      await done(tx);
      await changed();
    },
    async replace(ledger) {
      const l = clone(ledger);
      const tx = db.transaction([...KINDS, META], 'readwrite');
      const meta = tx.objectStore(META);
      try {
        meta.clear();
        meta.put(l.realm, 'realm');
        meta.put(l.version ?? LEDGER_VERSION, 'version');
        for (const k of KINDS) {
          const store = tx.objectStore(k);
          store.clear();
          const rows = l[k] || [];
          if (k === 'events') rows.forEach(e => store.add(e));
          else {
            rows.forEach((r, seq) => store.put({ id: r.id, seq, r }));
            meta.put(rows.length, `seq:${k}`);
          }
        }
      } catch (e) { tx.abort(); throw e; } // a bad record leaves the old ledger whole
      await done(tx);
      await changed();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
