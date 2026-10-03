// What the Realm looks like right now (PLAN-engine.md, R0 "The Beacon lights up"): the Beacon, the in-game log, the
// Sealed Halls and the Keepers' benches. Pure functions over a Ledger snapshot (contract.js): no DOM, no store, so the
// HUD, the 3D view and node:test all read the same answers.
import { WORK_RESOLVED, isGameOnly } from './contract.js';

const RANK = { gold: 0, amber: 1, red: 2 };
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);
const resolved = w => WORK_RESOLVED.includes(w.status);
const URGENT = ['critical', 'high'];
const WAITING_RIDDLE = ['open', 'deferred'];
const times = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const newest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));

// ---------- the Beacon ----------
// Per March: red when an unresolved Work is blocked at critical or high priority, or has failed at least once.
// Amber when Riddles wait (open or deferred), any other Work is blocked, or Works are in review. Gold otherwise.
// The Realm shows its worst March; its reasons are every March's reasons, red ones first.
// Game-only Works and Riddles (R3 area lore) never colour it: an errand is not real work waiting.
export function beacon(ledger) {
  const marches = {};
  for (const m of ledger.marches || []) {
    const red = [], amber = [];
    for (const w of (ledger.works || []).filter(w => w.marchId === m.id && !resolved(w) && !isGameOnly(w))) {
      if (w.status === 'blocked') (URGENT.includes(w.priority) ? red : amber).push(`${w.title} is blocked`);
      if (w.failures > 0) red.push(`${w.title} failed ${times(w.failures)}`);
      if (w.status === 'in_review') amber.push(`${w.title} is in review`);
    }
    const waiting = (ledger.riddles || []).filter(r => r.marchId === m.id && WAITING_RIDDLE.includes(r.state) && !isGameOnly(r)).length;
    if (waiting) amber.unshift(`${plural(waiting, 'Riddle waits', 'Riddles wait')} for an answer in ${m.name}`);
    const color = red.length ? 'red' : amber.length ? 'amber' : 'gold';
    marches[m.id] = { color, reasons: [...red, ...amber] };
  }
  const all = Object.values(marches);
  const color = all.reduce((c, m) => worse(c, m.color), 'gold');
  const reasons = ['red', 'amber'].flatMap(c => all.filter(m => m.color === c).flatMap(m => m.reasons));
  return { color, reasons, marches };
}

// ---------- the in-game log ----------
// Open: Riddles waiting (open or deferred), blocked and in-review Works, leased /work items. Resolved: the last N
// Works and Riddles by resolvedAt. Both newest first. Riddle text is the real words, verbatim.
export function gameLog(ledger, { resolved: keep = 5 } = {}) {
  const works = ledger.works || [], riddles = ledger.riddles || [];
  const workById = new Map(works.map(w => [w.id, w]));
  const keeperById = new Map((ledger.keepers || []).map(k => [k.id, k]));
  const item = (kind, r, text, at) => ({ kind, id: r.id, marchId: r.marchId ?? null, text, at: at ?? null,
    ...(r.mark ? { mark: r.mark } : {}) });

  const open = [
    ...riddles.filter(r => WAITING_RIDDLE.includes(r.state)).map(r => item('riddle', r, r.text, r.raisedAt)),
    ...works.filter(w => w.status === 'blocked').map(w => item('work', w, `${w.title} is blocked`, w.updatedAt)),
    ...works.filter(w => w.status === 'in_review').map(w => item('work', w, `${w.title} is in review`, w.updatedAt)),
    ...(ledger.queue || []).filter(q => q.state === 'leased').map(q => {
      const w = workById.get(q.workId), k = keeperById.get(q.keeperId);
      return { ...item('queue', q, `${k?.name || 'A Keeper'} is working on ${w?.title || 'a Work'}`, q.createdAt),
        marchId: w?.marchId ?? null };
    }),
  ].sort(newest);

  const done = [
    ...works.filter(w => w.resolvedAt).map(w => item('work', w, `${w.title} is ${w.status === 'cancelled' ? 'cancelled' : 'done'}`, w.resolvedAt)),
    ...riddles.filter(r => r.resolvedAt).map(r => item('riddle', r, r.text, r.resolvedAt)),
  ].sort(newest).slice(0, Math.max(0, keep));

  return { open, resolved: done };
}

// ---------- Sealed Halls ----------
// One per Hall, in March then Hall order. A Hall opens when it is achieved, or when it has Works and all are
// resolved. An empty Hall stays sealed: nothing has been done yet.
export function sealedHalls(ledger) {
  const marchOrder = new Map((ledger.marches || []).map((m, i) => [m.id, i]));
  const works = ledger.works || [];
  return (ledger.halls || [])
    .map(h => {
      const mine = works.filter(w => w.hallId === h.id);
      const done = mine.filter(resolved).length, total = mine.length;
      const open = h.status === 'achieved' || (total > 0 && done === total);
      return { id: h.id, marchId: h.marchId, name: h.name, order: h.order, locked: !open, done, total };
    })
    .sort((a, b) => ((marchOrder.get(a.marchId) ?? 1e9) - (marchOrder.get(b.marchId) ?? 1e9)) || (a.order - b.order));
}

// ---------- Keepers ----------
// Capacity at the Lodge benches. A Keeper with an unknown status counts as resting.
export function keepers(ledger) {
  const out = { free: [], busy: [], resting: [] };
  for (const k of ledger.keepers || []) (out[k.status] || out.resting).push(k);
  return out;
}
