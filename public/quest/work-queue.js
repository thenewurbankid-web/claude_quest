// The /work queue rules (PLAN-engine.md, R4 "Bring your Keeper"; safety rules 5 and 12): which queued Works the page
// offers as prompts, what copying one does (a lease), what a pasted result does, and what a lapsed lease does.
// Pure functions over a Ledger snapshot (contract.js): they never touch a store and never mutate their input. Each
// move returns Changes ({ puts, events }) that applyChanges writes, events last. The page lives in work-page.js.
import { DEFAULT_RULES, QUEUE_MOVES, REPORT_KIND, REPORT_INSTRUCTIONS, canMove, branchFor, emberLeft, parseReport,
  isGameOnly, noChanges, BRIDGE_VERSION, workOffer } from './contract.js';
import { raiseRiddle } from './riddles.js';

const HOUR = 3600e3;
const clone = v => JSON.parse(JSON.stringify(v));
const iso = ms => new Date(ms).toISOString();
const LIVE = ['queued', 'leased', 'lapsed']; // items still on the page
const COPYABLE = ['queued', 'leased', 'lapsed']; // a leased item may be copied again (the lease renews)
const RESOLVED = ['done', 'cancelled'];

const findItem = (ledger, id) => {
  const q = (ledger.queue || []).find(x => x.id === id);
  if (!q) throw new Error(`no queue item ${id}`);
  return q;
};
const byId = (list, id) => (list || []).find(x => x.id === id) || null;

/** When Ember next comes back, as an ISO time: null unless the Well is empty now. Reports age out of the window. */
export function emberReturnsAt(ledger, now = new Date(), rules = DEFAULT_RULES) {
  if (emberLeft(ledger, now, rules) > 0) return null;
  const win = rules.emberWindowHours * HOUR, since = new Date(now).getTime() - win;
  const spent = [];
  for (const q of ledger.queue || []) for (const r of q.reports || [])
    if (r.usage && Date.parse(r.at) > since) spent.push({ at: Date.parse(r.at), tokens: r.usage.input + r.usage.output });
  spent.sort((a, b) => a.at - b.at);
  let total = spent.reduce((s, x) => s + x.tokens, 0);
  for (const x of spent) {
    total -= x.tokens;
    if (total < rules.emberMax * rules.tokensPerEmber) return iso(x.at + win);
  }
  return null;
}

/** Whole milliseconds left on a leased item's lease (0 once due); null for an item that isn't leased. */
export const leaseLeft = (item, now = new Date()) =>
  item.state === 'leased' && item.leaseUntil ? Math.max(0, Date.parse(item.leaseUntil) - now.getTime()) : null;

/** The text the player copies into their agent: the Work, where it sits, its branch, the task note, then the report block. */
export function buildPrompt(ledger, itemId, rules = DEFAULT_RULES) {
  const q = findItem(ledger, itemId);
  const w = byId(ledger.works, q.workId);
  if (!w) throw new Error(`no Work ${q.workId}`);
  const m = byId(ledger.marches, w.marchId), h = byId(ledger.halls, w.hallId), k = byId(ledger.keepers, q.keeperId);
  return [
    `Quest Work: ${w.title}`,
    `Project (March): ${m?.name || w.marchId}`,
    `Milestone (Hall): ${h?.name || 'none yet'}`,
    `Priority: ${w.priority}`,
    ...(k ? [`Keeper: ${k.name} (${k.role})`] : []),
    `Branch: ${branchFor(w)} (create it if it doesn't exist; work only there)`,
    '',
    'Task:',
    String(q.prompt || '').trim() || '(no task note; work from the title)',
    '',
    `Report back within ${rules.leaseHours} hours, or the lease lapses and the Work goes back on the board.`,
    '',
    REPORT_INSTRUCTIONS,
  ].join('\n');
}

/**
 * Queue items the page may offer as prompts, oldest first, each with its Work and Keeper: none at all when Ember is 0
 * (safety rule 5), none for a resting Keeper, never a game-only Work, nor a resolved one.
 * @returns {{ item: object, work: object, keeper: object }[]}
 */
export function offerable(ledger, now = new Date(), rules = DEFAULT_RULES) {
  if (!(emberLeft(ledger, now, rules) > 0)) return [];
  return (ledger.queue || [])
    .filter(q => COPYABLE.includes(q.state))
    .map(q => ({ item: q, work: byId(ledger.works, q.workId), keeper: byId(ledger.keepers, q.keeperId) }))
    .filter(({ work, keeper }) => work && keeper && !['resting', 'released'].includes(keeper.status) && !isGameOnly(work)
      && !RESOLVED.includes(work.status))
    .sort((a, b) => String(a.item.createdAt).localeCompare(String(b.item.createdAt)))
    .map(x => clone(x));
}

/** Live items for a Keeper other than skip (still leased and not lapsing), so it stays busy. */
const otherLease = (ledger, keeperId, skip) =>
  (ledger.queue || []).some(q => q.keeperId === keeperId && q.state === 'leased' && !skip.has(q.id));

/** The Keeper's record after a move, or null when it doesn't change. Resting and released Keepers stay so, and a
 *  summoned one stays summoned until it joins (R5). */
function keeperTo(ledger, keeperId, status) {
  const k = byId(ledger.keepers, keeperId);
  if (!k || ['resting', 'released', 'summoned'].includes(k.status) || k.status === status) return null;
  return { kind: 'keepers', record: { ...clone(k), status } };
}

/**
 * Copying a prompt leases its item: queued (or lapsed, or leased again) → leased for rules.leaseHours, the Keeper
 * busy, the Work in progress if it was waiting. Throws when the page wouldn't offer it (see offerable).
 */
export function copyPrompt(ledger, itemId, now = new Date(), rules = DEFAULT_RULES) {
  const q = findItem(ledger, itemId);
  if (!canMove(QUEUE_MOVES, q.state, 'leased')) throw new Error(`queue item ${itemId} is ${q.state}; it can't be leased`);
  if (!offerable(ledger, now, rules).some(x => x.item.id === itemId)) {
    if (!(emberLeft(ledger, now, rules) > 0)) throw new Error('the Well is out of Ember; work is paused');
    throw new Error(`queue item ${itemId} isn't offered (resting Keeper, game-only or resolved Work)`);
  }
  const at = now.toISOString();
  const out = noChanges();
  out.puts.push({ kind: 'queue', record: { ...clone(q), state: 'leased', copiedAt: at,
    leaseUntil: iso(now.getTime() + rules.leaseHours * HOUR) } });
  const k = keeperTo(ledger, q.keeperId, 'busy');
  if (k) out.puts.push(k);
  const w = byId(ledger.works, q.workId);
  if (['backlog', 'todo'].includes(w.status) || !w.keeperId) {
    const status = ['backlog', 'todo'].includes(w.status) ? 'in_progress' : w.status;
    out.puts.push({ kind: 'works', record: { ...clone(w), status, keeperId: w.keeperId || q.keeperId, updatedAt: at } });
  }
  out.events.push({ at, kind: 'work.leased', ref: q.id });
  return out;
}

const firstLine = s => String(s).split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';

/**
 * A pasted result. Reads its quest-report block; with none valid and no hand-picked kind, returns the problems and no
 * changes (the page asks the player to pick a kind). The paste is kept verbatim on a new Report, relayed by the player.
 * progress: the lease renews; done: returned for review (in_review, never done: a person merges, safety rule 12);
 * blocked: the lease renews, the Work is blocked and its question raised as a Riddle (risk tiers apply).
 * Cancelled and returned items refuse every paste; a late paste on a lapsed item is taken back, and its Keeper returns.
 * @returns {{ changes: object, problems: { field: string, problem: string }[], refused: string|null }}
 */
export function pasteResult(ledger, itemId, pasted, { kind = null, question = null } = {}, now = new Date(), rules = DEFAULT_RULES) {
  const q = findItem(ledger, itemId);
  const none = (problems = [], refused = null) => ({ changes: noChanges(), problems, refused });
  if (!['leased', 'lapsed'].includes(q.state)) return none([], q.state); // cancelled, returned, or never copied
  const w = byId(ledger.works, q.workId);
  if (!w) throw new Error(`no Work ${q.workId}`);
  if (RESOLVED.includes(w.status)) return none([], `work ${w.status}`);
  const text = String(pasted ?? '');
  if (!text.trim()) return none([{ field: 'paste', problem: 'nothing pasted' }]);

  let { report, problems } = parseReport(text);
  let manual = false;
  if (!report) {
    if (!kind) return none(problems);
    if (!REPORT_KIND.includes(kind)) return none([{ field: 'kind', problem: `must be one of ${REPORT_KIND.join(', ')}` }]);
    const ask = typeof question === 'string' ? question.trim() : '';
    if (kind === 'blocked' && !ask) return none([{ field: 'question', problem: 'a blocked report asks its question' }]);
    report = { kind, summary: firstLine(text), question: kind === 'blocked' ? ask : null, branch: null, usage: null };
    manual = true;
  }

  const at = now.toISOString();
  const out = noChanges();
  const rep = { kind: report.kind, summary: report.summary, question: report.question, branch: report.branch,
    usage: report.usage, text, relayed: 'player', manual, at };
  const item = { ...clone(q), reports: [...(q.reports || []), rep] };
  let work = clone(w);
  const workEvents = [];

  if (report.kind === 'done') {
    Object.assign(item, { state: 'returned', leaseUntil: null, result: { text, usage: report.usage, at } });
    if (work.status !== 'in_review') work = { ...work, status: 'in_review', updatedAt: at };
  } else {
    Object.assign(item, { state: 'leased', leaseUntil: iso(now.getTime() + rules.leaseHours * HOUR) });
    if (report.kind === 'progress' && ['backlog', 'todo'].includes(work.status)) work = { ...work, status: 'in_progress', updatedAt: at };
    if (report.kind === 'blocked') {
      // raiseRiddle blocks a Work in todo or in progress; one in backlog or review is moved to in progress first.
      const base = ['todo', 'in_progress', 'blocked'].includes(work.status) ? work : { ...work, status: 'in_progress' };
      const view = { ...ledger, works: ledger.works.map(x => x.id === w.id ? base : x) };
      const raised = raiseRiddle(view, { workId: w.id, text: report.question, high: w.risk === 'high' }, now);
      const r = raised.puts.find(p => p.kind === 'riddles').record;
      r.mark = { status: 'sent', source: 'agent', sourceId: q.id, real: true, at };
      out.puts.push({ kind: 'riddles', record: r });
      work = raised.puts.find(p => p.kind === 'works')?.record || { ...base, status: 'blocked', updatedAt: at };
      workEvents.push(...raised.events);
    }
  }

  out.puts.push({ kind: 'queue', record: item });
  if (JSON.stringify(work) !== JSON.stringify(w)) out.puts.push({ kind: 'works', record: work });
  const keeper = keeperTo(ledger, q.keeperId,
    report.kind === 'done' && !otherLease(ledger, q.keeperId, new Set([q.id])) ? 'free' : 'busy');
  if (keeper) out.puts.push(keeper);
  out.events.push(...workEvents, { at, kind: 'work.reported', ref: q.id });
  if (report.kind === 'done') out.events.push({ at, kind: 'work.returned', ref: q.id });
  return { changes: out, problems: [], refused: null };
}

/**
 * Time passing: leased items past leaseUntil lapse. Their Keeper wanders (unless resting, or it still holds another
 * live lease) and a Work in progress goes back to todo, back on the board. A blocked or in-review Work stays put, so
 * its Riddle still stands.
 */
export function tickLeases(ledger, now = new Date()) {
  const t = now.getTime(), at = now.toISOString();
  const due = (ledger.queue || []).filter(q => q.state === 'leased' && q.leaseUntil && Date.parse(q.leaseUntil) <= t);
  if (!due.length) return noChanges();
  const out = noChanges(), lapsing = new Set(due.map(q => q.id)), keepers = new Set(), works = new Set();
  for (const q of due) {
    out.puts.push({ kind: 'queue', record: { ...clone(q), state: 'lapsed' } });
    out.events.push({ at, kind: 'work.lapsed', ref: q.id });
    if (!keepers.has(q.keeperId) && !otherLease(ledger, q.keeperId, lapsing)) {
      keepers.add(q.keeperId);
      const k = keeperTo(ledger, q.keeperId, 'wandered');
      if (k) out.puts.push(k);
    }
    const w = byId(ledger.works, q.workId);
    if (w && !works.has(w.id) && w.status === 'in_progress') {
      works.add(w.id);
      out.puts.push({ kind: 'works', record: { ...clone(w), status: 'todo', updatedAt: at } });
    }
  }
  return out;
}

/** Items still on the page (queued, leased or lapsed), real Works only, grouped by Keeper in ledger order. */
export function workBoard(ledger, now = new Date(), rules = DEFAULT_RULES) {
  const offered = new Set(offerable(ledger, now, rules).map(x => x.item.id));
  return (ledger.keepers || []).map(k => ({
    keeper: clone(k),
    items: (ledger.queue || [])
      .filter(q => q.keeperId === k.id && LIVE.includes(q.state))
      .map(q => ({ item: clone(q), work: clone(byId(ledger.works, q.workId)), offered: offered.has(q.id) }))
      .filter(x => x.work && !isGameOnly(x.work)),
  })).filter(g => g.items.length || g.keeper.status === 'resting');
}

/** The keepers message (contract.js): only the opted-in Keepers, their status and their live queue items; an item
 *  carries its offer only when offerable allows it now. Pure; the game publishes the result, retained. */
export function keepersMessage(ledger, optedIn, now = new Date(), rules = DEFAULT_RULES) {
  const ids = new Set(optedIn);
  const keepers = (ledger.keepers || []).filter(k => ids.has(k.id)).map(k => ({ id: k.id, name: k.name, status: k.status }));
  const can = new Map(offerable(ledger, now, rules).map(x => [x.item.id, x]));
  const queue = (ledger.queue || []).filter(q => ids.has(q.keeperId) && LIVE.includes(q.state)).map(q => {
    const hit = q.state === 'queued' && can.get(q.id);
    return { queueId: q.id, keeperId: q.keeperId, state: q.state, offer: hit ? workOffer(hit.work, hit.item, buildPrompt(ledger, q.id, rules)) : null };
  });
  return { v: BRIDGE_VERSION, keepers, queue };
}
