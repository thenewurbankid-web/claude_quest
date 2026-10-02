// Imported assets kept in this browser (IndexedDB). Every call is wrapped: private windows or blocked storage just
// mean nothing is remembered, and the editor keeps working with what's on the server.
const DB = 'quest-editor', STORE = 'assets';
let dbp = null;
function open() {
  if (!dbp) dbp = new Promise((ok, no) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    } catch (e) { no(e); }
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((ok, no) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(req?.result); t.onerror = () => no(t.error); t.onabort = () => no(t.error);
  });
}
export async function all() { try { return (await tx('readonly', s => s.getAll())) || []; } catch (e) { console.warn('[editor] storage unavailable', e); return []; } }
export async function put(rec) { try { await tx('readwrite', s => s.put(rec)); return true; } catch (e) { console.warn('[editor] could not save', e); return false; } }
export async function remove(id) { try { await tx('readwrite', s => s.delete(id)); return true; } catch (e) { console.warn('[editor] could not remove', e); return false; } }
