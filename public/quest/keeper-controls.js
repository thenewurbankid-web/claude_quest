// The Keeper controls (PLAN-engine.md, R4 "Bring your Keeper"; contract.js KEEPER_CONTROL): wake, rest, resume, cancel
// and the Recall Bell, each a state change on the ledger. Pure functions over a Ledger snapshot: they never touch a store
// and never mutate their input. Each returns Changes ({ puts, events }) for applyChanges; a refused move returns no
// changes and a plain-text problem instead (`problem`), so the UI can say why.
// Waking only queues a short task note; the /work page wraps it with the branch and REPORT_INSTRUCTIONS when copied.
// The game can't stop an agent that is already running: the player stops it in their own tool.
import { DEFAULT_RULES, QUEUE_MOVES, WORK_RESOLVED, canMove, emberLeft, isGameOnly, noChanges } from './contract.js';

/** Queue states that still hold a Keeper to a Work. */
export const LIVE = ['queued', 'leased', 'lapsed'];

const clone = v => JSON.parse(JSON.stringify(v));
const refuse = problem => ({ ...noChanges(), problem });
const keeperOf = (ledger, id) => (ledger.keepers || []).find(k => k.id === id);
const liveFor = (ledger, pred) => (ledger.queue || []).filter(q => LIVE.includes(q.state) && pred(q));

/** A Work is blocked when its status says so, or a Work it waits on is still unresolved. */
function blocked(ledger, w) {
  if (w.status === 'blocked') return true;
  const works = new Map((ledger.works || []).map(x => [x.id, x]));
  return (w.blockedBy || []).some(id => works.has(id) && !WORK_RESOLVED.includes(works.get(id).status));
}

/** Works a Keeper can be woken for: unresolved, real, not blocked, and with no live queue item. */
export function startable(ledger) {
  const held = new Set(liveFor(ledger, () => true).map(q => q.workId));
  return (ledger.works || []).filter(w => !WORK_RESOLVED.includes(w.status) && !isGameOnly(w) && !blocked(ledger, w)
    && !held.has(w.id));
}

/** The short task note a queue item carries: the Work's title, then the player's note. Plain text. */
export const taskNote = (work, note) => {
  const n = typeof note === 'string' ? note.trim() : '';
  return n ? `Work: ${work.title}\nNote: ${n}` : `Work: ${work.title}`;
};

/**
 * Wake = queue work for a Keeper. A new 'queued' item with the task note as its prompt, the Work given to the Keeper,
 * and work.queued. Refused when the Keeper is resting, the Work isn't startable, or the Well is out of Ember.
 */
export function wake(ledger, keeperId, workId, { note } = {}, now = new Date(), rules = DEFAULT_RULES) {
  const k = keeperOf(ledger, keeperId);
  if (!k) return refuse(`No Keeper ${keeperId}.`);
  if (k.status === 'resting') return refuse(`${k.name} is resting. Resume them first.`);
  const w = (ledger.works || []).find(x => x.id === workId);
  if (!w) return refuse(`No Work ${workId}.`);
  if (!startable(ledger).some(x => x.id === workId)) return refuse(`"${w.title}" can't be started now.`);
  if (emberLeft(ledger, now, rules) <= 0) return refuse('The Well is out of Ember. Keepers rest until it refills.');
  const at = now.toISOString();
  const item = { id: crypto.randomUUID(), keeperId, workId, prompt: taskNote(w, note), state: 'queued',
    leaseUntil: null, createdAt: at, copiedAt: null, reports: [] };
  return {
    puts: [{ kind: 'queue', record: item }, { kind: 'works', record: { ...clone(w), keeperId, updatedAt: at } }],
    events: [{ at, kind: 'work.queued', ref: item.id }],
  };
}

/** Rest = the Keeper is offered no prompts until resumed. */
export function rest(ledger, keeperId, now = new Date()) {
  const k = keeperOf(ledger, keeperId);
  if (!k) return refuse(`No Keeper ${keeperId}.`);
  if (k.status === 'resting') return refuse(`${k.name} is already resting.`);
  return { puts: [{ kind: 'keepers', record: { ...clone(k), status: 'resting' } }],
    events: [{ at: now.toISOString(), kind: 'keeper.rested', ref: k.id }] };
}

/** Resume (call back) a resting or wandered Keeper: busy if it holds a leased item, else free. */
export function resume(ledger, keeperId, now = new Date()) {
  const k = keeperOf(ledger, keeperId);
  if (!k) return refuse(`No Keeper ${keeperId}.`);
  if (!['resting', 'wandered'].includes(k.status)) return refuse(`${k.name} is ${k.status}, not resting.`);
  const leased = (ledger.queue || []).some(q => q.keeperId === k.id && q.state === 'leased');
  return { puts: [{ kind: 'keepers', record: { ...clone(k), status: leased ? 'busy' : 'free' } }],
    events: [{ at: now.toISOString(), kind: 'keeper.resumed', ref: k.id }] };
}

/** Cancel one queue item (pasted results for it are then refused). Its Keeper is freed if nothing else holds it. */
export function cancel(ledger, itemId, now = new Date()) {
  const q = (ledger.queue || []).find(x => x.id === itemId);
  if (!q) return refuse(`No queue item ${itemId}.`);
  if (!canMove(QUEUE_MOVES, q.state, 'cancelled')) return refuse(`This run is ${q.state}; it can't be cancelled.`);
  const at = now.toISOString();
  const c = { puts: [{ kind: 'queue', record: { ...clone(q), state: 'cancelled' } }],
    events: [{ at, kind: 'work.cancelled', ref: q.id }] };
  const k = keeperOf(ledger, q.keeperId);
  if (k && k.status !== 'resting') {
    const others = liveFor(ledger, x => x.keeperId === k.id && x.id !== q.id);
    const status = !others.length ? 'free' : others.some(x => x.state === 'leased') ? 'busy' : k.status;
    if (status !== k.status) c.puts.push({ kind: 'keepers', record: { ...clone(k), status } });
  }
  return c;
}

/**
 * The Recall Bell (safety rule 11): every Keeper resting and every queued, leased or lapsed item cancelled, from
 * anywhere, with one bell.rung. Returned and cancelled items are left alone. It never refuses.
 */
export function ringBell(ledger, now = new Date()) {
  const puts = [];
  for (const k of ledger.keepers || []) if (k.status !== 'resting') puts.push({ kind: 'keepers', record: { ...clone(k), status: 'resting' } });
  for (const q of liveFor(ledger, () => true)) puts.push({ kind: 'queue', record: { ...clone(q), state: 'cancelled' } });
  return { puts, events: [{ at: now.toISOString(), kind: 'bell.rung', ref: null }] };
}

/**
 * The token readout shown before waking a Keeper: Ember left of max, the last reported run's tokens, and the Ember
 * spent in the rolling window (rules.emberWindowHours, a day by default).
 * @returns {{ emberLeft: number, emberMax: number, lastRun: { input: number, output: number }|null, spentToday: number }}
 */
export function tokenReadout(ledger, now = new Date(), rules = DEFAULT_RULES) {
  const since = new Date(now).getTime() - rules.emberWindowHours * 3600e3;
  let last = null, tokens = 0;
  for (const q of ledger.queue || []) {
    // the spend counts reports only, as emberLeft does (a result repeats its final report); the last run may be either
    for (const r of q.reports || []) if (r.usage && Date.parse(r.at) > since) tokens += r.usage.input + r.usage.output;
    for (const u of [...(q.reports || []), q.result]) {
      if (!u?.usage) continue;
      const t = Date.parse(u.at);
      if (!last || t > last.t) last = { t, input: u.usage.input, output: u.usage.output };
    }
  }
  return { emberLeft: emberLeft(ledger, now, rules), emberMax: rules.emberMax,
    lastRun: last ? { input: last.input, output: last.output } : null, spentToday: tokens / rules.tokensPerEmber };
}
