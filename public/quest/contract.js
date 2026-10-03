// The Quest contract: the shared shapes every slice builds against (PLAN-engine.md, "How a release runs").
// Render-free and dependency-free, so it loads in the browser and under node:test alike. It fixes:
//   - the ledger (Realm, Marches, Halls, Works, Keepers, Riddles, the /work queue, the event log) and its validation,
//   - the Riddle record and its states,
//   - the /work queue states and their allowed moves,
//   - the LedgerStore interface (the IndexedDB store implements it; memoryStore below is the reference version),
//   - the save format (the split save's parts, held as one object until R5 packs them into a zip),
//   - the lore rules' defaults (R1: outbox seconds, defer and fade delays, the never-in-game list; R2: the boss),
//   - R2's battle record and its phases (play state, kept in the save's play part, not in the ledger).
// Change a shape here first, in its own commit, and only then in the slices that use it.

export const LEDGER_VERSION = 1;
export const SAVE_KIND = 'quest-realm-save'; // net.js's older 'quest-save' is the 2D game's save, not this one
export const SAVE_VERSION = 1;

// ---------- vocabularies ----------
// Work and Hall statuses follow Paperclip's issue and goal statuses, so the connector maps them one to one.
export const WORK_STATUS = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'];
export const WORK_RESOLVED = ['done', 'cancelled'];
export const HALL_STATUS = ['planned', 'active', 'achieved'];
export const PRIORITY = ['critical', 'high', 'medium', 'low'];
export const SIZE = ['S', 'M', 'L']; // pebble, stone, boulder
export const KEEPER_STATUS = ['free', 'busy', 'resting'];
export const BEACON = ['gold', 'amber', 'red'];

// Every action and response carries a mark: where it is in its life, and where it came from.
export const MARK_STATUS = ['sent', 'seen', 'working', 'answered', 'done', 'failed'];
export const MARK_SOURCE = ['project', 'task', 'agent', 'player'];

// Riddle life: open → answered (sealed in the outbox, still recallable) → sealed (written back to its Work).
// "Ask me later" is an answer: open → deferred, and it comes back to open after the lore rules' delay.
// A stale Riddle fades with a note. An answered Riddle waits in the outbox until outboxUntil (the recall window);
// sealing it writes a Decision onto its Work (safety rules 1, 4 and 9). Only the March's steward (or the Realm owner
// when the March has none) seals; anyone else's answer is kept as a proposal (rule 10).
export const RIDDLE_STATE = ['open', 'deferred', 'answered', 'sealed', 'faded'];
export const RIDDLE_MOVES = {
  open: ['answered', 'deferred', 'faded'],
  deferred: ['open', 'faded'],
  answered: ['sealed', 'open'], // back to open = recalled from the outbox
  sealed: [],
  faded: [],
};
export const RIDDLE_RISK = ['normal', 'high']; // high never appears in combat; it is answered in the Lodge

// The /work page: the only way agents get work (no server). Copying a prompt starts a lease, pasting a progress report
// renews it, pasting the final result returns it. A lapsed lease puts the work back on the board.
export const QUEUE_STATE = ['queued', 'leased', 'returned', 'lapsed', 'cancelled'];
export const QUEUE_MOVES = {
  queued: ['leased', 'cancelled'],
  leased: ['leased', 'returned', 'lapsed', 'cancelled'],
  lapsed: ['queued', 'cancelled'],
  returned: [],
  cancelled: [], // pasted results for a cancelled item are refused
};

// The local event log behind the success measures. It never leaves the machine.
// R1 adds the Riddle's later moves; question-to-answer time is riddle.raised → riddle.answered for the same ref.
export const EVENT_KIND = ['riddle.raised', 'riddle.answered', 'riddle.deferred', 'riddle.recalled', 'riddle.sealed',
  'riddle.returned', 'riddle.faded', 'riddle.proposed', 'agent.blocked', 'agent.unblocked', 'session.start',
  'session.end', 'boss.summoned', 'boss.retreated', 'boss.defeated'];

// ---------- lore rules (defaults) ----------
// A world's lore folder overrides these (PLAN-engine.md, "Customizable through lore files"); until Ink lore lands in
// R6 the game uses them as they are.
export const DEFAULT_RULES = {
  logResolved: 5,          // resolved items kept in the in-game log
  outboxSeconds: 10,       // the recall window before an answer is sealed
  deferHours: 24,          // "ask me later": when a deferred Riddle returns
  deferWeightGrowth: 0.5,  // extra weight per deferral, so deferring everything can't dodge the boss
  fadeDays: 14,            // an open Riddle untouched this long fades with a note
  // Risk tiers: a Riddle whose text matches one of these leaves the game for a plain confirm (risk: high);
  // neverInGame ones are never answered in the game at all, only shown with where to answer them.
  confirmWords: ['merge', 'deploy', 'release', 'delete', 'drop', 'budget', 'payment', 'billing'],
  neverInGame: ['password', 'secret', 'api key', 'token', 'credential'],
  // R2, the Gloamwyrm: its score is the sum of riddleWeight over open and deferred Riddles; past the threshold it cuts in.
  bossThreshold: 3,
  bossHpPerWeight: 10,     // maxHp = round(score * this * strength)
  bossReturnGrowth: 0.25,  // each retreat: strength + this, so it returns stronger
  mashBonus: 0.15,         // the most extra damage mashing adds to a hit, as a share of that hit
};

// ---------- R2: the battle ----------
// The Gloamwyrm fight is play state (the save's play part), never ledger data: answers still go through the Riddle
// rules, and the battle only reads which Riddles got resolved. Phases:
//   fighting: turns run; question: paused on a normal-tier Riddle, no timer, input locked until the box closes;
//   lodge: paused because a confirm- or never-tier Riddle came up; it is answered in the Lodge, never in combat;
//   won: every Riddle in the fight resolved (answered or deferred); retreated: the player fell back to the Lodge.
// Hits come only from resolving a Riddle (deferring counts). Mashing scales a hit by at most mashBonus and never
// picks an answer. hp never reaches 0 while any of the fight's Riddles is unresolved.
export const BATTLE_PHASE = ['fighting', 'question', 'lodge', 'won', 'retreated'];
export const BATTLE_MOVES = {
  fighting: ['question', 'lodge', 'won', 'retreated'],
  question: ['fighting', 'won', 'retreated'], // retreat works from any turn, a pause included
  lodge: ['fighting', 'won', 'retreated'],
  won: [],
  retreated: [],
};

export const canMove = (moves, from, to) => (moves[from] || []).includes(to);

/** Who seals a March's decisions: its steward, or the Realm owner when it has none. */
export const stewardOf = (ledger, marchId) =>
  ledger.marches?.find(m => m.id === marchId)?.steward || ledger.realm?.owner || null;

// ---------- record shapes ----------
// Ids are strings, unique within their kind. Times are ISO strings. Optional fields may be null or missing.
/**
 * @typedef {{ id: string, name: string, owner: string }} Realm   owner: the fallback steward for every March
 * @typedef {{ id: string, name: string, banner: string, steward: string|null }} March   banner: a CSS colour
 * @typedef {{ id: string, marchId: string, name: string, status: string, order: number,
 *             weight?: number|null, council?: boolean }} Hall
 *   council: big milestone, accepted by a council vote (quest:council) rather than the steward
 * @typedef {{ id: string, marchId: string, hallId: string|null, title: string, status: string, priority: string,
 *             size?: string|null, weight?: number|null, risk?: 'high'|null, keeperId?: string|null,
 *             blockedBy?: string[], failures?: number, createdAt: string, updatedAt: string,
 *             resolvedAt?: string|null, decisions?: Decision[], mark?: Mark }} Work
 *   hallId null is allowed but is a repair quest ("this Work belongs to no Hall")
 * @typedef {{ riddleId: string, question: string, answer: string, sealed_by: string, at: string,
 *             sent?: { to: 'paperclip', at: string, ref?: string|null }|null }} Decision
 *   a sealed Riddle written back to its Work (rule 9); sent: set once the connector has posted it as a comment
 * @typedef {{ id: string, name: string, role: string, skills: string[], status: string }} Keeper
 * @typedef {{ status: string, source: string, sourceId: string, real: boolean, at: string }} Mark
 *   real: true for real work, false for game-only actions
 * @typedef {{ id: string, workId: string, marchId: string, text: string, line?: string|null, options?: string[],
 *             risk: string, state: string, steward: string|null, sealed_by?: string|null,
 *             answer?: { text: string, by: string, at: string }|null,
 *             proposals?: { text: string, by: string, at: string }[],
 *             raisedAt: string, outboxUntil?: string|null, deferredUntil?: string|null, deferCount?: number,
 *             fadeNote?: string|null, resolvedAt?: string|null, mark?: Mark }} Riddle
 *   text: the real words, shown verbatim as plain text (never HTML); line: the game's line shown above them
 *   proposals: teammates' answers, shown and never overwritten
 *   outboxUntil: while answered, when the recall window closes and the answer may be sealed
 * @typedef {{ start: number, end: number, why: 'addresses-reader'|'addresses-ai'|'instruction'|'link' }} Flag
 *   True Sight's mark on a suspicious stretch of real text (character offsets into text); computed, never stored
 * @typedef {{ since: string|null, raised: number, answered: number, sealed: number, returned: number,
 *             faded: number, blocked: number, unblocked: number }} Digest
 *   "while you were away", counted from the event log after the last session.end
 * @typedef {{ id: string, keeperId: string, workId: string, prompt: string, state: string,
 *             leaseUntil?: string|null, result?: { text: string, usage?: { input: number, output: number },
 *             at: string }|null, createdAt: string }} QueueItem
 * @typedef {{ at: string, kind: string, ref?: string|null }} Event
 * @typedef {{ id: string, startedAt: string, phase: string, score: number, strength: number, hp: number, maxHp: number,
 *             riddleIds: string[], lodgeIds: string[], resolvedIds: string[], current: string|null, turn: number,
 *             endedAt?: string|null }} Battle
 *   riddleIds: normal-tier Riddles asked in the fight; lodgeIds: confirm/never ones that pause it for the Lodge;
 *   resolvedIds: those answered or deferred so far (answers kept across a retreat); current: the Riddle on screen
 * @typedef {{ battle: Battle|null, retreats: number }} BossPlay   the save's play.boss
 * @typedef {{ version: number, realm: Realm, marches: March[], halls: Hall[], works: Work[], keepers: Keeper[],
 *             riddles: Riddle[], queue: QueueItem[], events: Event[] }} Ledger
 */

/** Kinds of record in a ledger, in the order a store should create them. */
export const KINDS = ['marches', 'halls', 'works', 'keepers', 'riddles', 'queue', 'events'];

export function emptyLedger(realm = { id: 'realm', name: 'The Unwritten Realm', owner: 'player' }) {
  return { version: LEDGER_VERSION, realm, marches: [], halls: [], works: [], keepers: [], riddles: [], queue: [], events: [] };
}

// ---------- validation ----------
// Returns a list of problems, empty when the ledger is sound. repair: true marks problems the game turns into a
// repair quest (the player fixes them in game) rather than refusing the data.
export function validateLedger(l) {
  const out = [];
  const bad = (path, problem, repair = false) => out.push({ path, problem, repair });
  if (!l || typeof l !== 'object') return [{ path: '', problem: 'not a ledger', repair: false }];
  if (l.version !== LEDGER_VERSION) bad('version', `expected ${LEDGER_VERSION}, got ${l.version}`);
  if (!l.realm?.id || !l.realm?.name) bad('realm', 'needs id and name');
  for (const k of KINDS) if (!Array.isArray(l[k])) { bad(k, 'missing list'); l = { ...l, [k]: [] }; }

  const ids = {};
  for (const k of KINDS.filter(k => k !== 'events')) {
    ids[k] = new Set();
    l[k].forEach((r, i) => {
      if (typeof r?.id !== 'string' || !r.id) bad(`${k}[${i}].id`, 'needs a string id');
      else if (ids[k].has(r.id)) bad(`${k}[${i}].id`, `duplicate id ${r.id}`);
      else ids[k].add(r.id);
    });
  }
  const oneOf = (path, v, list, optional = false) => {
    if (optional && (v === null || v === undefined)) return;
    if (!list.includes(v)) bad(path, `${JSON.stringify(v)} is not one of ${list.join(', ')}`);
  };
  const ref = (path, v, kind, optional = false) => {
    if (optional && (v === null || v === undefined)) return;
    if (!ids[kind].has(v)) bad(path, `unknown ${kind} id ${JSON.stringify(v)}`);
  };
  const text = (path, v) => { if (typeof v !== 'string' || !v.trim()) bad(path, 'needs text'); };
  const mark = (path, m) => {
    if (m === null || m === undefined) return;
    oneOf(`${path}.status`, m.status, MARK_STATUS);
    oneOf(`${path}.source`, m.source, MARK_SOURCE);
    if (typeof m.real !== 'boolean') bad(`${path}.real`, 'needs true or false');
  };

  l.marches.forEach((m, i) => text(`marches[${i}].name`, m.name));
  l.halls.forEach((h, i) => {
    const p = `halls[${i}]`;
    ref(`${p}.marchId`, h.marchId, 'marches');
    text(`${p}.name`, h.name);
    oneOf(`${p}.status`, h.status, HALL_STATUS);
  });
  l.works.forEach((w, i) => {
    const p = `works[${i}]`;
    ref(`${p}.marchId`, w.marchId, 'marches');
    if (w.hallId === null || w.hallId === undefined) bad(`${p}.hallId`, `"${w.title}" belongs to no Hall`, true);
    else {
      ref(`${p}.hallId`, w.hallId, 'halls');
      const h = l.halls.find(h => h.id === w.hallId);
      if (h && h.marchId !== w.marchId) bad(`${p}.hallId`, `Hall ${h.id} is in another March`, true);
    }
    text(`${p}.title`, w.title);
    oneOf(`${p}.status`, w.status, WORK_STATUS);
    oneOf(`${p}.priority`, w.priority, PRIORITY);
    oneOf(`${p}.size`, w.size, SIZE, true);
    oneOf(`${p}.risk`, w.risk, ['high'], true);
    ref(`${p}.keeperId`, w.keeperId, 'keepers', true);
    (w.decisions || []).forEach((d, j) => {
      ref(`${p}.decisions[${j}].riddleId`, d.riddleId, 'riddles');
      text(`${p}.decisions[${j}].answer`, d.answer);
    });
    (w.blockedBy || []).forEach((b, j) => ref(`${p}.blockedBy[${j}]`, b, 'works'));
    mark(`${p}.mark`, w.mark);
  });
  l.keepers.forEach((k, i) => {
    text(`keepers[${i}].name`, k.name);
    oneOf(`keepers[${i}].status`, k.status, KEEPER_STATUS);
  });
  l.riddles.forEach((r, i) => {
    const p = `riddles[${i}]`;
    ref(`${p}.workId`, r.workId, 'works');
    ref(`${p}.marchId`, r.marchId, 'marches');
    text(`${p}.text`, r.text);
    oneOf(`${p}.risk`, r.risk, RIDDLE_RISK);
    oneOf(`${p}.state`, r.state, RIDDLE_STATE);
    if (['answered', 'sealed'].includes(r.state) && !r.answer) bad(`${p}.answer`, `a ${r.state} Riddle needs its answer`);
    if (r.state === 'sealed' && !r.sealed_by) bad(`${p}.sealed_by`, 'a sealed Riddle records who sealed it');
    if (r.state === 'answered' && !r.outboxUntil) bad(`${p}.outboxUntil`, 'an answered Riddle waits in the outbox');
    if (r.state === 'deferred' && !r.deferredUntil) bad(`${p}.deferredUntil`, 'a deferred Riddle needs its return time');
    if (r.state === 'faded' && !r.fadeNote) bad(`${p}.fadeNote`, 'a faded Riddle leaves a note');
    const steward = r.steward || stewardOf(l, r.marchId);
    if (r.state === 'sealed' && r.sealed_by && r.sealed_by !== steward)
      bad(`${p}.sealed_by`, `only the steward (${steward}) seals; other answers are proposals`);
    mark(`${p}.mark`, r.mark);
  });
  l.queue.forEach((q, i) => {
    const p = `queue[${i}]`;
    ref(`${p}.keeperId`, q.keeperId, 'keepers');
    ref(`${p}.workId`, q.workId, 'works');
    oneOf(`${p}.state`, q.state, QUEUE_STATE);
    if (q.state === 'leased' && !q.leaseUntil) bad(`${p}.leaseUntil`, 'a leased item needs its lease end');
  });
  l.events.forEach((e, i) => oneOf(`events[${i}].kind`, e.kind, EVENT_KIND));
  return out;
}

/** Problems with a battle record, empty when sound. */
export function validateBattle(b) {
  const out = [];
  const bad = (path, problem) => out.push({ path, problem });
  if (!b || typeof b !== 'object') return [{ path: '', problem: 'not a battle' }];
  if (!BATTLE_PHASE.includes(b.phase)) bad('phase', `${JSON.stringify(b.phase)} is not one of ${BATTLE_PHASE.join(', ')}`);
  for (const k of ['riddleIds', 'lodgeIds', 'resolvedIds']) if (!Array.isArray(b[k])) bad(k, 'missing list');
  if (!(b.maxHp > 0) || !(b.hp >= 0) || b.hp > b.maxHp) bad('hp', 'needs 0 <= hp <= maxHp, maxHp > 0');
  if (!(b.strength >= 1)) bad('strength', 'starts at 1 and only grows');
  const all = [...(b.riddleIds || []), ...(b.lodgeIds || [])];
  if ((b.resolvedIds || []).some(id => !all.includes(id))) bad('resolvedIds', 'resolves a Riddle outside the fight');
  const open = all.filter(id => !(b.resolvedIds || []).includes(id));
  if (b.hp === 0 && open.length) bad('hp', 'the Gloamwyrm cannot fall while a Riddle is unresolved');
  if (b.phase === 'won' && open.length) bad('phase', 'won with Riddles unresolved');
  if (b.phase === 'question' && !(b.riddleIds || []).includes(b.current)) bad('current', 'a question pause shows one of the fight\'s Riddles');
  if ((b.lodgeIds || []).includes(b.current) && b.phase !== 'lodge') bad('current', 'confirm/never Riddles are never asked in combat');
  return out;
}

// ---------- the store interface ----------
// The IndexedDB ledger implements exactly this; views and rules only ever see snapshots.
/**
 * @typedef {object} LedgerStore
 * @property {() => Promise<Ledger>} snapshot              a deep copy of the whole ledger
 * @property {(kind: string, record: object) => Promise<void>} put   insert or replace by id; stamps updatedAt on works
 * @property {(kind: string, id: string) => Promise<void>} remove
 * @property {(ledger: Ledger) => Promise<void>} replace   swap in a whole ledger (sample Realm, a loaded save)
 * @property {(fn: (l: Ledger) => void) => () => void} subscribe   called after every change; returns unsubscribe
 */

const clone = v => JSON.parse(JSON.stringify(v));

// R1: rules never touch the store. They return Changes, and one place writes them, events last.
/**
 * @typedef {{ puts: { kind: string, record: object }[], events: Event[] }} Changes
 */
export const noChanges = () => ({ puts: [], events: [] });
export const mergeChanges = (...cs) => ({ puts: cs.flatMap(c => c.puts), events: cs.flatMap(c => c.events) });
/** Writes Changes to a LedgerStore: every put, then every event. */
export async function applyChanges(store, changes) {
  for (const { kind, record } of changes.puts) await store.put(kind, record);
  for (const e of changes.events) await store.put('events', e);
}

/** The reference LedgerStore, in memory. Slices and tests use it until the IndexedDB store lands. */
export function memoryStore(initial = emptyLedger()) {
  let l = clone(initial);
  const subs = new Set();
  const changed = () => { const s = clone(l); subs.forEach(fn => fn(s)); };
  const list = kind => { if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`); return l[kind]; };
  return {
    async snapshot() { return clone(l); },
    async put(kind, record) {
      const rows = list(kind), r = clone(record);
      if (kind === 'works') r.updatedAt = new Date().toISOString();
      const i = kind === 'events' ? -1 : rows.findIndex(x => x.id === r.id);
      if (i >= 0) rows[i] = r; else rows.push(r);
      changed();
    },
    async remove(kind, id) { l[kind] = list(kind).filter(x => x.id !== id); changed(); },
    async replace(ledger) { l = clone(ledger); changed(); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// ---------- the save ----------
// The split save's parts, held as one object: a manifest, play state, one part per March, and archives. R5 packs the
// same parts into a single zip with public/editor/zip.js; export without the ledger keeps only manifest and play.
/**
 * @typedef {{ kind: string, version: number, at: string, realm: Realm, parts: string[], withLedger: boolean }} Manifest
 * @typedef {{ march: March, halls: Hall[], works: Work[], riddles: Riddle[], queue: QueueItem[] }} MarchPart
 * @typedef {{ manifest: Manifest, play: object, ledger: { keepers: Keeper[], events: Event[] }|null,
 *             marches: Record<string, MarchPart>, archives: Record<string, object> }} Save
 */
export function makeSave(ledger, play = {}, { withLedger = true } = {}) {
  const marches = {};
  if (withLedger) for (const m of ledger.marches) {
    const mine = r => r.marchId === m.id;
    const workIds = new Set(ledger.works.filter(mine).map(w => w.id));
    marches[m.id] = {
      march: m, halls: ledger.halls.filter(mine), works: ledger.works.filter(mine), riddles: ledger.riddles.filter(mine),
      queue: ledger.queue.filter(q => workIds.has(q.workId)),
    };
  }
  const parts = ['manifest.json', 'play.json', ...(withLedger ? ['ledger.json', ...Object.keys(marches).map(id => `march/${id}.json`)] : [])];
  return clone({
    manifest: { kind: SAVE_KIND, version: SAVE_VERSION, at: new Date().toISOString(), realm: ledger.realm, parts, withLedger },
    play, ledger: withLedger ? { keepers: ledger.keepers, events: ledger.events } : null, marches, archives: {},
  });
}

/** Rebuilds the ledger inside a save; null for a save exported without it. Throws on a save it can't read. */
export function ledgerFromSave(save) {
  const m = save?.manifest;
  if (m?.kind !== SAVE_KIND) throw new Error('not a Quest Realm save');
  if (m.version > SAVE_VERSION) throw new Error(`save version ${m.version} is newer than this game (${SAVE_VERSION})`);
  if (!m.withLedger) return null;
  const l = emptyLedger(m.realm);
  l.keepers = save.ledger?.keepers || [];
  l.events = save.ledger?.events || [];
  for (const p of Object.values(save.marches || {})) {
    l.marches.push(p.march);
    for (const k of ['halls', 'works', 'riddles', 'queue']) l[k].push(...(p[k] || []));
  }
  return clone(l);
}
