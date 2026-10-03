// The Quest contract: the shared shapes every slice builds against (PLAN-engine.md, "How a release runs").
// Render-free and dependency-free, so it loads in the browser and under node:test alike. It fixes:
//   - the ledger (Realm, Marches, Halls, Works, Keepers, Riddles, the /work queue, the event log) and its validation,
//   - the Riddle record and its states,
//   - the /work queue states and their allowed moves,
//   - the LedgerStore interface (the IndexedDB store implements it; memoryStore below is the reference version),
//   - the save format (the split save's parts, held as one object until R5 packs them into a zip),
//   - the lore rules' defaults (R1: outbox seconds, defer and fade delays, the never-in-game list; R2: the boss),
//   - R2's battle record and its phases (play state, kept in the save's play part, not in the ledger),
//   - R3's area-lore entry and cell index (shared per geohash-4 cell), and isGameOnly, which keeps lore out of the boss,
//   - missions (a parent Work and its children; the saga is their Hall), Keepers summoned with Ember, and the event
//     log's hash chain.
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
// wandered: its lease lapsed (R4). summoned: called up with Ember, its first Work not approved yet; it joins the Lodge
// (free) once one is. released: retired to the Hall of Champions; it keeps its record and gets no more work.
export const KEEPER_STATUS = ['free', 'busy', 'resting', 'wandered', 'summoned', 'released'];
export const BEACON = ['gold', 'amber', 'red'];

// Every action and response carries a mark: where it is in its life, and where it came from.
export const MARK_STATUS = ['sent', 'seen', 'working', 'answered', 'done', 'failed'];
export const MARK_SOURCE = ['project', 'task', 'agent', 'player', 'lore'];

/**
 * Game-only records (R3 area lore, and any mark with real: false) never feed the Haze, the Gloamwyrm, the stats board
 * or Renown: bossScore, shouldSummon, riddleWeight, realmStats and answerTimes skip them.
 */
export const isGameOnly = record => record?.mark?.real === false || record?.mark?.source === 'lore';

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
  lapsed: ['queued', 'leased', 'returned', 'cancelled'], // a late paste while still lapsed: the Keeper found its way back
  returned: [],
  cancelled: [], // pasted results for a cancelled item are refused
};

// The local event log behind the success measures. It never leaves the machine.
// R1 adds the Riddle's later moves; question-to-answer time is riddle.raised → riddle.answered for the same ref.
export const EVENT_KIND = ['riddle.raised', 'riddle.answered', 'riddle.deferred', 'riddle.recalled', 'riddle.sealed',
  'riddle.returned', 'riddle.faded', 'riddle.proposed', 'agent.blocked', 'agent.unblocked', 'session.start',
  'session.end', 'riddle.asked', 'riddle.replied', 'boss.summoned', 'boss.retreated', 'boss.defeated', 'boss.pushed',
  // R4: the /work page and the Keeper controls (ref: the queue item, or the Keeper for rested/resumed)
  'work.queued', 'work.leased', 'work.reported', 'work.returned', 'work.lapsed', 'work.cancelled',
  'keeper.rested', 'keeper.resumed', 'bell.rung',
  // missions (ref: the mission's parent Work) and Keepers summoned with Ember (ref: the Keeper)
  'mission.begun', 'mission.cliffhanger', 'mission.resumed', 'mission.shelved', 'mission.debriefed', 'mission.done',
  'keeper.summoned', 'keeper.joined', 'keeper.released'];

// ---------- missions ----------
// A mission is a parent Work and its child Works (Work.parentId, Paperclip's parent issue); its saga is their Hall (the
// milestone), whose finale is the Sealed Hall. A Work with no parent and no children is a one-step side mission.
// The player goes on one mission at a time. Mission progress is play state (the save's play.missions), never ledger
// data: the real work still moves only through the /work queue and the Riddle rules.
//   briefing: chosen, its Keeper's briefing not yet heard; active: under way; cliffhanger: one of its Works raised a
//   Riddle that waits on the player; debrief: every Work resolved, the debrief not yet heard; done: heard;
//   shelved: set aside for another mission, and picked up again where it was.
export const MISSION_STATE = ['briefing', 'active', 'cliffhanger', 'debrief', 'done', 'shelved'];
export const MISSION_MOVES = {
  briefing: ['active', 'shelved'],
  active: ['cliffhanger', 'debrief', 'shelved'],
  cliffhanger: ['active', 'debrief', 'shelved'],
  debrief: ['done'],
  done: [],
  shelved: ['active'],
};

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
  // Heads and the Lantern (PLAN-fight.md): one head per Work in the fight; after each turn that lands a hit, every
  // living head bites the Lantern, and each Keeper freed by a cut head guards one point of it.
  lanternBase: 3,          // lantern = lanternBase + lanternPerHead * heads (tuned so a careless order can lose)
  lanternPerHead: 1,
  dimHours: 12,            // a head whose question has waited this long is Dim: it bites 1 + one per started day, at most dimMax
  dimMax: 3,
  guardBlock: 1,           // what each freed Keeper takes off the Gloamwyrm's bite
  lanternFromLight: 2,     // what a full light meter gives back to the Lantern when you tend it
  // R4, Bring your Keeper (first guesses, tuned later like the fight numbers):
  leaseHours: 4,           // copying a prompt leases the work this long; each pasted progress report renews it
  emberMax: 100,           // the Well's fuel; at 0 the /work page offers no prompts (safety rule 5)
  tokensPerEmber: 10000,   // reported tokens (input + output) per Ember
  emberWindowHours: 24,    // Ember spent in this rolling window counts against emberMax
  summonCost: 10,          // Ember spent to summon a Keeper; it counts against the window like reported tokens
  // R5, backlog pressure (missions.js pressure()): a saga's open Work weight against the days left to its release date.
  // A Work weighs its weight if set, else pressurePriority[priority] * pressureSize[size] + pressureFailure * failures.
  pressurePriority: { critical: 4, high: 3, medium: 2, low: 1 },
  pressureSize: { S: 1, M: 2, L: 3 },
  pressureFailure: 1,
  pressurePerDay: 4,       // open weight a saga clears in a day: pressure = open / (pressurePerDay * days left), at most 1
  pressureFull: 24,        // with no release date, this much open weight is full pressure
  pressureGate: 0.75,      // at or above it, side content locks (lore quests, the lore tab, past the hub); never real work
};

// ---------- R2: the battle ----------
// The Gloamwyrm fight is play state (the save's play part), never ledger data: answers still go through the Riddle
// rules, and the battle only reads which Riddles got resolved. Phases:
//   fighting: turns run; question: paused on a normal-tier Riddle, no timer, input locked until the box closes;
//   lodge: paused because a confirm- or never-tier Riddle came up; it is answered in the Lodge, never in combat;
//   won: every Riddle in the fight resolved (answered or deferred); retreated: the player fell back to the Lodge, or
//   was pushed back there when the Lantern ran out (pushed: true; no strength penalty, answers kept).
// Hits come only from resolving a Riddle (deferring counts). Mashing scales a hit by at most mashBonus and never
// picks an answer. hp never reaches 0 while any of the fight's Riddles is unresolved.
// Heads: one per Work, cut when all its Riddles are resolved, which frees its Keeper to guard. Heads only bite in the
// beat after a hit, while fighting; never during a question or the Lodge, and never against a clock.
export const HEAD_KIND = ['snap', 'dim', 'echo'];
export const BATTLE_PHASE = ['fighting', 'question', 'lodge', 'won', 'retreated'];
export const BATTLE_MOVES = {
  fighting: ['question', 'lodge', 'won', 'retreated'],
  question: ['fighting', 'won', 'retreated'], // retreat works from any turn, a pause included
  lodge: ['fighting', 'won', 'retreated'],
  won: [],
  retreated: [],
};

// ---------- R3: area lore ----------
// Shared lore for an area (PLAN-engine.md, "R3 Lore quests"): a geohash-4 cell, about 39x20 km. The generator writes
// each entry once to lore/<cell>/<id>.json and lists it in lore/<cell>/index.json (and the cell in lore/cells.json); every player in the cell (and its 8
// neighbours) reads the same files until the entry ends. Only these kinds are written; anything else is dropped at the
// source, never filtered after the fact. 'calendar' is the built-in fallback (time of day, season, weekend), made in
// the client and never published.
export const AREA_LORE_VERSION = 1;
export const AREA_LORE_KIND = ['festival', 'market', 'sports', 'music', 'seasonal', 'weather', 'calendar'];
export const AREA_LORE_WRITER = ['ollama', 'template', 'calendar'];
export const GEOHASH_CELL = /^[0-9b-hjkmnp-z]{4}$/; // geohash-4: base32 without a, i, l, o
/**
 * @typedef {{ id: string, cell: string, kind: string, line: string, hint: string, question: string,
 *             options?: string[], startsAt: string, endsAt: string, writtenAt: string, writer: string,
 *             source?: { name: string, url?: string|null }|null }} AreaLoreEntry
 *   line: the in-world headline ("Bards gather at the Lodge tonight"), plain text;
 *   hint: the tooltip naming the real event ("Live music at the Corn Exchange, 8pm"), plain text;
 *   question: the game-only Riddle it becomes; options: its choices (an errand has none);
 *   source: where the real event came from (a feed's name, or Open-Meteo for weather)
 * @typedef {{ version: number, cell: string, updatedAt: string,
 *             entries: { id: string, kind: string, startsAt: string, endsAt: string }[] }} AreaLoreIndex
 *   lore/<cell>/index.json: what is live or coming in the cell, so a client fetches only the entries it needs
 * @typedef {{ version: number, updatedAt: string, cells: string[] }} AreaLoreCells
 *   lore/cells.json: every cell with an index, so a client asks only for cells that exist (no 404s in the console)
 */

const ISO = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const LORE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/; // also the file name, so no dots or slashes

/** Problems with an area-lore entry, empty when sound. A client drops an entry with any problem. */
export function validateAreaLore(e) {
  const out = [];
  const bad = (path, problem) => out.push({ path, problem });
  if (!e || typeof e !== 'object') return [{ path: '', problem: 'not an area-lore entry' }];
  if (typeof e.id !== 'string' || !LORE_ID.test(e.id)) bad('id', 'needs a lowercase id of letters, digits and dashes');
  if (!GEOHASH_CELL.test(e.cell)) bad('cell', 'needs a geohash-4 cell');
  if (!AREA_LORE_KIND.includes(e.kind)) bad('kind', `${JSON.stringify(e.kind)} is not one of ${AREA_LORE_KIND.join(', ')}`);
  if (!AREA_LORE_WRITER.includes(e.writer)) bad('writer', `${JSON.stringify(e.writer)} is not one of ${AREA_LORE_WRITER.join(', ')}`);
  for (const k of ['line', 'hint', 'question']) if (typeof e[k] !== 'string' || !e[k].trim()) bad(k, 'needs text');
  if (e.options !== undefined && (!Array.isArray(e.options) || e.options.some(o => typeof o !== 'string' || !o.trim())))
    bad('options', 'a list of plain-text choices');
  for (const k of ['startsAt', 'endsAt', 'writtenAt']) if (!ISO(e[k])) bad(k, 'needs an ISO time');
  if (ISO(e.startsAt) && ISO(e.endsAt) && Date.parse(e.endsAt) <= Date.parse(e.startsAt)) bad('endsAt', 'ends after it starts');
  return out;
}

/** Problems with lore/cells.json, empty when sound. */
export function validateAreaLoreCells(c) {
  const out = [];
  if (!c || typeof c !== 'object') return [{ path: '', problem: 'not an area-lore cell list' }];
  if (c.version !== AREA_LORE_VERSION) out.push({ path: 'version', problem: `expected ${AREA_LORE_VERSION}, got ${c.version}` });
  if (!ISO(c.updatedAt)) out.push({ path: 'updatedAt', problem: 'needs an ISO time' });
  if (!Array.isArray(c.cells) || c.cells.some(x => !GEOHASH_CELL.test(x))) out.push({ path: 'cells', problem: 'a list of geohash-4 cells' });
  return out;
}

/** Problems with a cell's index.json, empty when sound. */
export function validateAreaLoreIndex(ix) {
  const out = [];
  const bad = (path, problem) => out.push({ path, problem });
  if (!ix || typeof ix !== 'object') return [{ path: '', problem: 'not an area-lore index' }];
  if (ix.version !== AREA_LORE_VERSION) bad('version', `expected ${AREA_LORE_VERSION}, got ${ix.version}`);
  if (!GEOHASH_CELL.test(ix.cell)) bad('cell', 'needs a geohash-4 cell');
  if (!ISO(ix.updatedAt)) bad('updatedAt', 'needs an ISO time');
  if (!Array.isArray(ix.entries)) bad('entries', 'missing list');
  else ix.entries.forEach((x, i) => {
    if (typeof x?.id !== 'string' || !LORE_ID.test(x.id)) bad(`entries[${i}].id`, 'needs a lowercase id');
    if (!AREA_LORE_KIND.includes(x?.kind) || x.kind === 'calendar') bad(`entries[${i}].kind`, 'not a published kind');
    if (!ISO(x?.startsAt) || !ISO(x?.endsAt)) bad(`entries[${i}]`, 'needs startsAt and endsAt');
  });
  return out;
}

export const canMove = (moves, from, to) => (moves[from] || []).includes(to);

/** Who seals a March's decisions: its steward, or the Realm owner when it has none. */
export const stewardOf = (ledger, marchId) =>
  ledger.marches?.find(m => m.id === marchId)?.steward || ledger.realm?.owner || null;

// ---------- R4: Bring your Keeper ----------
// Agents get work only through the /work page (no server, no polling). The copied prompt ends with REPORT_INSTRUCTIONS,
// asking the agent to close every reply with one fenced quest-report block. parseReport reads the last such block
// (the prompt's own example comes first if an agent echoes it). With no valid block the player picks the kind by hand;
// the paste is always kept verbatim. Agents work on branchFor(work) and never merge (safety rule 12).
// Keeper controls are state changes on the ledger: wake = queue work for it; rest = Keeper resting, no prompts
// offered; resume = back to free or busy; cancel = the queue item cancelled, later pastes refused; the Recall Bell =
// every Keeper resting (released ones stay released) and every queued, leased or lapsed item cancelled. The game can't
// stop a running agent; the player stops it.
export const REPORT_KIND = ['progress', 'done', 'blocked'];
export const LIVE_QUEUE = ['queued', 'leased', 'lapsed']; // queue states that still hold a Keeper to a Work
export const REPORT_FENCE = 'quest-report';
export const KEEPER_CONTROL = ['wake', 'rest', 'resume', 'cancel', 'bell'];
export const branchFor = work => `quest/${work.id}`;
export const REPORT_INSTRUCTIONS = [
  'End every reply with exactly one block like this, filled in:',
  '```' + REPORT_FENCE,
  'kind: progress | done | blocked',
  'summary: one line on what changed',
  'question: only when blocked, the one question you need answered',
  'branch: the branch you worked on',
  'input_tokens: tokens read this run, if you know them',
  'output_tokens: tokens written this run, if you know them',
  '```',
  'Work only on your branch and never merge it; a person merges.',
].join('\n');

const REPORT_KEYS = ['kind', 'summary', 'question', 'branch', 'input_tokens', 'output_tokens'];
const FENCE_RE = new RegExp('```' + REPORT_FENCE + '[ \\t]*\\r?\\n([\\s\\S]*?)```', 'g');

/** Edit distance between two strings (Levenshtein). */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/**
 * Up to three words from vocab that input was probably meant to be, closest first (similarity 0.6 or more, ignoring
 * case). Only ever offered to the player as "did you mean"; nothing is repaired with it.
 */
export function suggest(input, vocab) {
  const x = String(input ?? '').trim().toLowerCase();
  if (!x) return [];
  return vocab.map(v => ({ v, sim: 1 - distance(x, v.toLowerCase()) / Math.max(x.length, v.length) }))
    .filter(c => c.sim >= 0.6 && c.v !== input).sort((a, b) => b.sim - a.sim).slice(0, 3).map(c => c.v);
}

/**
 * Reads the last quest-report block in a paste. Returns { report, problems }: report is null when there is no block or
 * it has any problem (the page then asks the player to pick the kind). Never repairs a field; extra keys are problems.
 * A problem may carry suggestions ("did you mean"): a misspelled field or kind names the likely one.
 * @returns {{ report: { kind: string, summary: string, question: string|null, branch: string|null,
 *             usage: { input: number, output: number }|null }|null,
 *             problems: { field: string, problem: string, suggestions?: string[] }[] }}
 */
export function parseReport(pasted) {
  const blocks = [...String(pasted ?? '').matchAll(FENCE_RE)];
  if (!blocks.length) return { report: null, problems: [{ field: 'block', problem: `no ${REPORT_FENCE} block` }] };
  const problems = [];
  const bad = (field, problem, suggestions = []) =>
    problems.push(suggestions.length ? { field, problem, suggestions } : { field, problem });
  const f = {};
  for (const raw of blocks.at(-1)[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z_ -]+?)\s*:\s*(.*)$/);
    if (!m) { bad('block', `not a "key: value" line: ${line.slice(0, 40)}`); continue; }
    if (!REPORT_KEYS.includes(m[1])) { bad(m[1], 'unknown field', suggest(m[1], REPORT_KEYS)); continue; }
    if (m[1] in f) { bad(m[1], 'given twice'); continue; }
    f[m[1]] = m[2].trim();
  }
  if (!REPORT_KIND.includes(f.kind)) bad('kind', `must be one of ${REPORT_KIND.join(', ')}`, suggest(f.kind, REPORT_KIND));
  if (!f.summary) bad('summary', 'needs one line');
  if (f.kind === 'blocked' && !f.question) bad('question', 'a blocked report asks its question');
  if (f.kind === 'done' && f.question) bad('question', 'a done report asks nothing; report blocked instead');
  const num = k => {
    if (f[k] === undefined || f[k] === '') return null;
    if (!/^\d+$/.test(f[k])) { bad(k, 'a whole number'); return null; }
    return Number(f[k]);
  };
  const input = num('input_tokens'), output = num('output_tokens');
  if ((input === null) !== (output === null) && !problems.some(p => p.field.endsWith('_tokens')))
    bad(input === null ? 'input_tokens' : 'output_tokens', 'give both token counts or neither');
  if (problems.length) return { report: null, problems };
  return { report: { kind: f.kind, summary: f.summary, question: f.question || null, branch: f.branch || null,
    usage: input === null ? null : { input, output } }, problems };
}

/**
 * Ember left now: emberMax less what was spent in the last emberWindowHours, never below 0. Spent: the tokens agents
 * reported, and summonCost for each Keeper summoned in the window. Keepers are made of Ember, so it comes back as the
 * window moves on.
 */
export function emberLeft(ledger, now = new Date(), rules = DEFAULT_RULES) {
  const since = new Date(now).getTime() - rules.emberWindowHours * 3600e3;
  let tokens = 0, summons = 0;
  for (const q of ledger.queue || []) for (const r of q.reports || [])
    if (r.usage && Date.parse(r.at) > since) tokens += r.usage.input + r.usage.output;
  for (const k of ledger.keepers || []) if (k.summonedAt && Date.parse(k.summonedAt) > since) summons++;
  return Math.max(0, rules.emberMax - tokens / rules.tokensPerEmber - summons * rules.summonCost);
}

// ---------- record shapes ----------
// Ids are strings, unique within their kind. Times are ISO strings. Optional fields may be null or missing.
/**
 * @typedef {{ id: string, name: string, owner: string }} Realm   owner: the fallback steward for every March
 * @typedef {{ id: string, name: string, banner: string, steward: string|null }} March   banner: a CSS colour
 * @typedef {{ id: string, marchId: string, name: string, status: string, order: number,
 *             weight?: number|null, council?: boolean, dueAt?: string|null }} Hall
 *   council: big milestone, accepted by a council vote (quest:council) rather than the steward
 *   dueAt: the release date the milestone ships on (the saga's clock); deadlines are on work, never on answering
 * @typedef {{ id: string, marchId: string, hallId: string|null, parentId?: string|null, title: string, status: string, priority: string,
 *             size?: string|null, weight?: number|null, risk?: 'high'|null, keeperId?: string|null,
 *             blockedBy?: string[], failures?: number, createdAt: string, updatedAt: string,
 *             resolvedAt?: string|null, decisions?: Decision[], mark?: Mark, endsAt?: string|null,
 *             dueAt?: string|null }} Work
 *   hallId null is allowed but is a repair quest ("this Work belongs to no Hall")
 *   parentId: the mission's parent Work, in the same Hall; one level only (a parent has no parent of its own)
 *   dueAt: its deadline (a mission's is its parent's); unlike endsAt it closes nothing, it only sets the clock
 *   endsAt: R3 lore only, when its area-lore entry ends; the Work closes then and its open Riddle fades
 * @typedef {{ riddleId: string, question: string, answer: string, sealed_by: string, at: string,
 *             sent?: { to: 'paperclip', at: string, ref?: string|null }|null }} Decision
 *   a sealed Riddle written back to its Work (rule 9); sent: set once the connector has posted it as a comment
 * @typedef {{ id: string, name: string, role: string, skills: string[], status: string,
 *             summonedAt?: string|null, joinedAt?: string|null, releasedAt?: string|null }} Keeper
 *   Keepers are agents, and everything about one beyond these fields is read from its work (Works, reports, events);
 *   the game invents no stats. summonedAt: when Ember was spent on it; joinedAt: its first approved Work;
 *   releasedAt: when it was retired. Keepers from before summoning existed have none of these.
 * @typedef {{ status: string, source: string, sourceId: string, real: boolean, at: string }} Mark
 *   real: true for real work, false for game-only actions
 * @typedef {{ id: string, workId: string, marchId: string, text: string, line?: string|null, options?: string[],
 *             risk: string, state: string, steward: string|null, sealed_by?: string|null,
 *             answer?: { text: string, by: string, at: string }|null,
 *             proposals?: { text: string, by: string, at: string }[],
 *             asks?: { text: string, by: string, at: string, reply?: { text: string, by: string, at: string }|null }[],
 *             raisedAt: string, outboxUntil?: string|null, deferredUntil?: string|null, deferCount?: number,
 *             fadeNote?: string|null, resolvedAt?: string|null, mark?: Mark }} Riddle
 *   text: the real words, shown verbatim as plain text (never HTML); line: the game's line shown above them
 *   proposals: teammates' answers, shown and never overwritten
 *   asks: questions asked back to the agent on the Work before answering; the Riddle stays open while they wait. The
 *         reply is real text (plain text only); until R3 brings the /work page it is pasted in by hand
 *   outboxUntil: while answered, when the recall window closes and the answer may be sealed
 * @typedef {{ start: number, end: number, why: 'addresses-reader'|'addresses-ai'|'instruction'|'link' }} Flag
 *   True Sight's mark on a suspicious stretch of real text (character offsets into text); computed, never stored
 * @typedef {{ since: string|null, raised: number, answered: number, sealed: number, returned: number,
 *             faded: number, blocked: number, unblocked: number }} Digest
 *   "while you were away", counted from the event log after the last session.end
 * @typedef {{ id: string, keeperId: string, workId: string, prompt: string, state: string,
 *             leaseUntil?: string|null, result?: { text: string, usage?: { input: number, output: number },
 *             at: string }|null, createdAt: string, copiedAt?: string|null, reports?: Report[],
 *             cancelledAt?: string|null }} QueueItem
 *   leaseUntil is null once returned; a leased item may be copied again, which renews it (leased → leased)
 *   prompt: what the player copies (the Work, the branch, REPORT_INSTRUCTIONS); copiedAt: when the lease started
 *   result: the final pasted text once returned (verbatim, plain text); reports: every paste, oldest first
 * @typedef {{ kind: string, summary: string, question?: string|null, branch?: string|null,
 *             usage?: { input: number, output: number }|null, text: string, relayed: 'player', manual: boolean,
 *             at: string }} Report
 *   R4: one paste on /work. text: the whole paste, verbatim; manual: no valid quest-report block was found, so the
 *   player picked the kind by hand (summary is then the paste's first line). A question raises a Riddle on the Work.
 * @typedef {{ at: string, kind: string, ref?: string|null, seq?: number, prevHash?: string|null, hash?: string }} Event
 *   seq, prevHash, hash: stamped by the store as the event is written (chainEvent), so a lost or changed event shows
 *   (verifyEvents). Events from before the chain have none and count as its unchained start.
 * @typedef {{ id: string, state: string, startedAt: string, endedAt?: string|null }} MissionRun
 *   id: the mission's parent Work (or the lone Work of a side mission)
 * @typedef {{ current: string|null, runs: Record<string, MissionRun> }} MissionPlay   the save's play.missions
 * @typedef {{ id: string, startedAt: string, phase: string, score: number, strength: number, hp: number, maxHp: number,
 *             riddleIds: string[], lodgeIds: string[], resolvedIds: string[], current: string|null, turn: number,
 *             endedAt?: string|null, weights?: Record<string, number>,
 *             dealt?: Record<string, number>, heads?: Head[], lantern?: number, lanternMax?: number,
 *             pushed?: boolean, bitten?: Record<string, number> }} Battle
 *   bitten: the Lantern each hit's beat cost, given back with the hp if that answer is recalled
 * @typedef {{ workId: string, workTitle: string, keeperId: string|null, keeper: string|null, riddleIds: string[],
 *             kind: string, bite: number, beats: number }} Head
 *   kind: snap (a plain question), dim (waited dimHours or more), echo (put off before: bites harder each beat alive);
 *   bite: its base bite; beats: beats it has bitten so far (an echo head adds one per beat)
 *   dealt: the hp each resolved Riddle took off, given back if its answer is recalled from the outbox
 *   weights: each fight Riddle's weight when it was summoned, so a hit's size is its share of maxHp
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
    if (h.dueAt !== null && h.dueAt !== undefined && !ISO(h.dueAt)) bad(`${p}.dueAt`, 'needs an ISO time');
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
    if (w.dueAt !== null && w.dueAt !== undefined && !ISO(w.dueAt)) bad(`${p}.dueAt`, 'needs an ISO time');
    if (w.parentId !== null && w.parentId !== undefined) {
      const parent = l.works.find(x => x.id === w.parentId);
      if (w.parentId === w.id) bad(`${p}.parentId`, `"${w.title}" is its own parent`, true);
      else if (!parent) ref(`${p}.parentId`, w.parentId, 'works');
      else if (parent.hallId !== w.hallId) bad(`${p}.parentId`, `"${w.title}" and its parent are in different Halls`, true);
      else if (parent.parentId) bad(`${p}.parentId`, `"${parent.title}" is already a child; missions are one level deep`, true);
    }
    mark(`${p}.mark`, w.mark);
  });
  l.keepers.forEach((k, i) => {
    const p = `keepers[${i}]`;
    text(`${p}.name`, k.name);
    oneOf(`${p}.status`, k.status, KEEPER_STATUS);
    for (const t of ['summonedAt', 'joinedAt', 'releasedAt'])
      if (k[t] !== null && k[t] !== undefined && !ISO(k[t])) bad(`${p}.${t}`, 'needs an ISO time');
    if (k.status === 'summoned' && !k.summonedAt) bad(`${p}.summonedAt`, 'a summoned Keeper records when Ember was spent');
    if (k.status === 'summoned' && k.joinedAt) bad(`${p}.status`, 'a Keeper that has joined is no longer only summoned');
    if (k.status === 'released' && !k.releasedAt) bad(`${p}.releasedAt`, 'a released Keeper records when it was retired');
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
    (r.asks || []).forEach((a, j) => {
      text(`${p}.asks[${j}].text`, a.text);
      if (a.reply) text(`${p}.asks[${j}].reply.text`, a.reply.text);
    });
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
    if (q.state === 'returned' && !q.result) bad(`${p}.result`, 'a returned item keeps its result');
    const w = l.works.find(w => w.id === q.workId);
    if (w && isGameOnly(w)) bad(`${p}.workId`, 'game-only Works never go to an agent');
    (q.reports || []).forEach((r, j) => {
      oneOf(`${p}.reports[${j}].kind`, r.kind, REPORT_KIND);
      text(`${p}.reports[${j}].text`, r.text);
      if (r.kind === 'blocked') text(`${p}.reports[${j}].question`, r.question);
    });
  });
  l.events.forEach((e, i) => oneOf(`events[${i}].kind`, e.kind, EVENT_KIND));
  const chain = verifyEvents(l.events);
  if (!chain.ok) bad(`events[${chain.brokenAt}]`, `the event log's chain breaks here: ${chain.why}`);
  return out;
}

/** Problems with the save's play.missions, empty when sound. One mission at a time: current is the one under way. */
export function validateMissionPlay(mp) {
  const out = [];
  const bad = (path, problem) => out.push({ path, problem });
  if (!mp || typeof mp !== 'object' || !mp.runs || typeof mp.runs !== 'object') return [{ path: '', problem: 'not mission play' }];
  for (const [id, r] of Object.entries(mp.runs)) {
    if (r?.id !== id) bad(`runs.${id}.id`, 'a run is keyed by its own id');
    if (!MISSION_STATE.includes(r?.state)) bad(`runs.${id}.state`, `${JSON.stringify(r?.state)} is not one of ${MISSION_STATE.join(', ')}`);
    if (!ISO(r?.startedAt)) bad(`runs.${id}.startedAt`, 'needs an ISO time');
    if (r?.state === 'done' && !ISO(r.endedAt)) bad(`runs.${id}.endedAt`, 'a finished mission records when it ended');
  }
  if (mp.current !== null && mp.current !== undefined) {
    const r = mp.runs[mp.current];
    if (!r) bad('current', `no run ${JSON.stringify(mp.current)}`);
    else if (['done', 'shelved'].includes(r.state)) bad('current', `the current mission can't be ${r.state}`);
  }
  const live = Object.values(mp.runs).filter(r => !['done', 'shelved'].includes(r?.state)).map(r => r.id);
  if (live.some(id => id !== mp.current)) bad('runs', 'only the current mission is under way; the rest are shelved or done');
  return out;
}
export const emptyMissionPlay = () => ({ current: null, runs: {} });

/**
 * The play state inside a save, with play.missions checked: missing becomes empty, and unsound mission play is
 * dropped to empty with its problems returned (a warning, never a refusal; the ledger is untouched either way).
 */
export function playFromSave(save) {
  const play = clone(save?.play || {});
  if (play.missions === undefined) return { play: { ...play, missions: emptyMissionPlay() }, problems: [] };
  const problems = validateMissionPlay(play.missions);
  return { play: problems.length ? { ...play, missions: emptyMissionPlay() } : play, problems };
}

// ---------- the event log's hash chain ----------
// Each event the store writes is stamped with its place (seq), the hash before it (prevHash) and its own hash, so an
// event that goes missing or changes shows up. FNV-1a: it catches accidents (a lost write, a hand-edited save), not a
// determined forger; a source with outside writers can move to SHA-256 later.
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v ?? null);
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const bodyOf = ({ seq, prevHash, hash, ...body }) => body;
/** An event's hash: its body (without the chain fields), its seq and the hash before it. */
export const eventHash = (e, seq, prevHash) => fnv1a(`${seq}|${prevHash ?? ''}|${canon(bodyOf(e))}`);
/**
 * Stamps an event for the end of the log. prev: the last event in the log (or null), seq: how many events come
 * before this one. An unchained log (events from before the chain) starts the chain with prevHash null.
 */
export function chainEvent(e, prev, seq) {
  const prevHash = prev?.hash ?? null;
  return { ...bodyOf(e), seq, prevHash, hash: eventHash(e, seq, prevHash) };
}
/**
 * Checks the log's chain. ok with brokenAt null when sound; otherwise brokenAt is the first bad event and why says
 * what is wrong. Unchained events are fine only before the chain starts.
 */
export function verifyEvents(events = []) {
  let prevHash = null, chained = false;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e?.hash === undefined) {
      if (chained) return { ok: false, brokenAt: i, why: 'an unchained event after the chain began' };
      continue;
    }
    chained = true;
    if (e.seq !== i) return { ok: false, brokenAt: i, why: `expected place ${i}, found ${e.seq} (an event is missing or out of order)` };
    if ((e.prevHash ?? null) !== prevHash) return { ok: false, brokenAt: i, why: 'it does not follow the event before it' };
    if (e.hash !== eventHash(e, e.seq, e.prevHash)) return { ok: false, brokenAt: i, why: 'it was changed after it was written' };
    prevHash = e.hash;
  }
  return { ok: true, brokenAt: null, why: null };
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
  if (b.heads !== undefined) {
    if (!Array.isArray(b.heads)) bad('heads', 'not a list');
    else b.heads.forEach((h, i) => {
      if (!HEAD_KIND.includes(h.kind)) bad(`heads[${i}].kind`, `${JSON.stringify(h.kind)} is not one of ${HEAD_KIND.join(', ')}`);
      if (!h.riddleIds?.length || h.riddleIds.some(id => !all.includes(id))) bad(`heads[${i}].riddleIds`, 'a head is made of the fight\'s Riddles');
      if (!(h.bite >= 1)) bad(`heads[${i}].bite`, 'bites at least 1');
    });
    if (!(b.lanternMax > 0) || !(b.lantern >= 0) || b.lantern > b.lanternMax) bad('lantern', 'needs 0 <= lantern <= lanternMax, lanternMax > 0');
    if (b.lantern === 0 && !['retreated', 'won'].includes(b.phase)) bad('lantern', 'an empty Lantern ends the fight');
  }
  if (b.pushed && b.phase !== 'retreated') bad('pushed', 'only a fight that ended in the Lodge was pushed back');
  return out;
}

// ---------- the store interface ----------
// The IndexedDB ledger implements exactly this; views and rules only ever see snapshots.
/**
 * @typedef {object} LedgerStore
 * @property {() => Promise<Ledger>} snapshot              a deep copy of the whole ledger
 * @property {(kind: string, record: object) => Promise<void>} put   insert or replace by id; stamps updatedAt on works
 *   and chains events (chainEvent) onto the end of the log
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
      const rows = list(kind);
      const r = kind === 'events' ? chainEvent(clone(record), rows.at(-1) || null, rows.length) : clone(record);
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
    play: { ...play, missions: play.missions ?? emptyMissionPlay() },
    ledger: withLedger ? { keepers: ledger.keepers, events: ledger.events } : null, marches, archives: {},
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
