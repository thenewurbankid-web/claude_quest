/**
 * game-db.js — IndexedDB storage for Boxing Manager AI, through Dexie.js.
 *
 * Tables
 *   fight_logs  one row per round: match id, round index, the full physics
 *               telemetry (every exchange, every punch), both corners' actions,
 *               and two "perspectives" (red's view and blue's view) that the
 *               RAG retrieval ranks.
 *   matches     one row per finished fight.
 *   fighters    the manager's saved fighter and training points.
 *
 * Retrieval (RAG)
 *   retrieveTacticalPrecedents(opponentProfile) finds the 3 most successful
 *   past tactics used against opponents physically similar to this one. The
 *   result carries the evidence and a "why" breakdown for each pick, and
 *   toLLMContext() turns it into a compact prompt block for the background LLM
 *   worker.
 *
 * `Dexie` is imported by its package name. The page maps it with an import map
 * (/vendor/dexie/…), and Node resolves it from node_modules, so the pure
 * helpers below run under `node --test` without IndexedDB.
 */
import Dexie from 'dexie';
import { STAT_KEYS, normalizeStats } from './physics-engine.js';

export const DB_NAME = 'boxing-manager';

/** Tunables for ranking. */
export const RAG_RULES = Object.freeze({
  k: 3,
  similaritySigma: 0.18,   // Gaussian width over 0–1 stat space; ~0.18 ≈ "within 15–20 points per stat"
  minSimilarity: 0.25,     // below this an opponent is "not like this one"
  prefilterMin: 12,        // fewer tag-matched rows than this → widen to a recent full scan
  scanLimit: 600,          // rows read on the widened scan
});

// ─── Schema ─────────────────────────────────────────────────────────────────

export class GameDB extends Dexie {
  constructor(name = DB_NAME, options) {
    super(name, options);
    this.version(1).stores({
      // *opponentTags is multi-entry: every tag of either corner's opponent,
      // so a profile query becomes an index lookup before the ranking pass.
      fight_logs: '++id, matchId, [matchId+roundIndex], roundIndex, createdAt, *opponentTags',
      matches: '&matchId, createdAt, mode, winner',
      fighters: '&id',
    });
  }

  // ── writes ──

  /**
   * Stores one finished round.
   * @param {object} round   summary from CombatSimulation ('round_end' event)
   * @param {object} meta    { mode, seed, fighters: { red: profile, blue: profile }, managerCorner? }
   */
  async logRound(round, meta) {
    const row = buildFightLogRow(round, meta);
    row.id = await this.fight_logs.add(row);
    return row;
  }

  async logMatch(result, meta) {
    const row = { ...result, matchId: result.match_id, mode: meta.mode, seed: meta.seed, fighters: meta.fighters, createdAt: Date.now() };
    await this.matches.put(row);
    return row;
  }

  async saveFighter(fighter) { await this.fighters.put({ id: 'manager', ...fighter, updatedAt: Date.now() }); }
  async loadFighter() { return this.fighters.get('manager'); }

  // ── reads ──

  async roundsForMatch(matchId) {
    return this.fight_logs.where('[matchId+roundIndex]').between([matchId, Dexie.minKey], [matchId, Dexie.maxKey]).toArray();
  }

  async counts() {
    const [rounds, matches] = await Promise.all([this.fight_logs.count(), this.matches.count()]);
    return { rounds, matches };
  }

  /**
   * RAG retrieval. Given the opponent's physical profile, returns the top `k`
   * past tactical outcomes against similar opponents, most successful first.
   * @param {{speed:number,power:number,stamina:number,ringIQ:number}} opponentProfile
   */
  async retrieveTacticalPrecedents(opponentProfile, opts = {}) {
    const rules = { ...RAG_RULES, ...opts };
    // 1. Cheap prefilter on the multi-entry tag index.
    const tags = profileTags(opponentProfile);
    let rows = tags.length
      ? await this.fight_logs.where('opponentTags').anyOf(tags).distinct().toArray()
      : [];
    // 2. Too few hits (new database, or an all-average opponent): widen to recent rows.
    if (rows.length < rules.prefilterMin) {
      rows = await this.fight_logs.orderBy('createdAt').reverse().limit(rules.scanLimit).toArray();
    }
    // 3. Rank in memory: similarity × success.
    return rankPrecedents(rows, opponentProfile, rules);
  }

  /** Every table as plain JSON, for a save file (same idea as net.js Saves.exportFile). */
  async exportAll() {
    const [fight_logs, matches, fighters] = await Promise.all([this.fight_logs.toArray(), this.matches.toArray(), this.fighters.toArray()]);
    return { app: 'boxing-manager', version: 1, exportedAt: new Date().toISOString(), fight_logs, matches, fighters };
  }

  async importAll(dump) {
    if (dump?.app !== 'boxing-manager') throw new Error('Not a Boxing Manager save file.');
    await this.transaction('rw', this.fight_logs, this.matches, this.fighters, async () => {
      await Promise.all([this.fight_logs.clear(), this.matches.clear(), this.fighters.clear()]);
      await this.fight_logs.bulkAdd(dump.fight_logs.map(({ id, ...r }) => r));
      await this.matches.bulkPut(dump.matches);
      await this.fighters.bulkPut(dump.fighters);
    });
  }
}

// ─── Pure helpers (no IndexedDB; unit-tested) ───────────────────────────────

/** Stats → 0–1 vector in STAT_KEYS order. */
export function profileVector(profile) {
  const s = normalizeStats(profile);
  return STAT_KEYS.map((k) => s[k] / 100);
}

/** Distinctive tags only, e.g. ['power:high', 'speed:low']. Mid values add nothing to a prefilter. */
export function profileTags(profile) {
  const s = normalizeStats(profile);
  const tags = [];
  for (const k of STAT_KEYS) {
    if (s[k] >= 65) tags.push(`${k}:high`);
    else if (s[k] <= 35) tags.push(`${k}:low`);
  }
  return tags;
}

/** Gaussian similarity in 0–1 over the four stats; 1 means identical. */
export function similarity(a, b, sigma = RAG_RULES.similaritySigma) {
  const va = profileVector(a), vb = profileVector(b);
  let d2 = 0;
  for (let i = 0; i < va.length; i++) d2 += (va[i] - vb[i]) ** 2;
  return Math.exp(-d2 / (2 * sigma * sigma));
}

/**
 * How well a round went for one corner, 0–1, with its parts.
 *   45 % round won (an even round counts half)
 *   30 % share of the energy landed (J for / J for + against)
 *   15 % land rate
 *   10 % finished the fight by KO this round
 */
export function successScore(p) {
  const won = p.won === 1 ? 1 : p.won === 0.5 ? 0.5 : 0;
  const total = p.evidence.joulesFor + p.evidence.joulesAgainst;
  const energyShare = total > 0 ? p.evidence.joulesFor / total : 0.5;
  const parts = {
    won: 0.45 * won,
    energyShare: 0.30 * energyShare,
    landRate: 0.15 * p.evidence.landRate,
    ko: 0.10 * (p.evidence.koFor ? 1 : 0),
  };
  const score = parts.won + parts.energyShare + parts.landRate + parts.ko;
  return { score: Math.round(score * 1000) / 1000, parts };
}

/** One corner's view of a round: what it did, who it faced, how it went. */
export function buildPerspective(round, fighters, corner) {
  const opp = corner === 'red' ? 'blue' : 'red';
  const mine = round.totals[corner], theirs = round.totals[opp];
  const p = {
    corner,
    tactic: round.corner_actions[corner],
    opponentTactic: round.corner_actions[opp],
    self: pickStats(fighters[corner]),
    opponent: pickStats(fighters[opp]),
    won: round.winner === corner ? 1 : round.winner === 'even' ? 0.5 : 0,
    evidence: {
      landRate: mine.land_rate,
      landRateAgainst: theirs.land_rate,
      thrown: mine.thrown,
      joulesFor: mine.joules_landed,
      joulesAgainst: theirs.joules_landed,
      avgVelocityMps: mine.avg_velocity_mps,
      avgTravelMs: mine.avg_travel_ms,           // my punches' travel time
      avgReactionAgainstMs: mine.avg_reaction_ms, // the opponent's window against them
      avgMarginMs: mine.avg_margin_ms,            // + means my punches beat their reactions
      koFor: round.reason === 'ko' && round.winner === corner,
      healthLeft: round.end_state[corner].health,
      opponentHealthLeft: round.end_state[opp].health,
    },
  };
  p.success = successScore(p);
  return p;
}

/** Builds the stored fight_logs row from a round summary. */
export function buildFightLogRow(round, meta) {
  const perspectives = [buildPerspective(round, meta.fighters, 'red'), buildPerspective(round, meta.fighters, 'blue')];
  return {
    matchId: round.match_id,
    roundIndex: round.round_index,
    createdAt: Date.now(),
    mode: meta.mode ?? 'single',
    seed: meta.seed,
    managerCorner: meta.managerCorner ?? 'red',
    fighters: { red: meta.fighters.red, blue: meta.fighters.blue },
    cornerActions: { ...round.corner_actions },
    summary: { reason: round.reason, winner: round.winner, cards: round.cards, totals: round.totals, end_state: round.end_state, duration_ms: round.duration_ms },
    telemetry: round.exchanges,            // the full bm.exchange.v1 objects
    perspectives,
    opponentTags: [...new Set([...profileTags(meta.fighters.blue), ...profileTags(meta.fighters.red)])],
  };
}

/**
 * Ranks every perspective in `rows` against `opponentProfile`.
 * relevance = similarity(opponent, past opponent) × successScore.
 * Only won (or even) rounds count as precedents. Keeps the best round per
 * match and tactic, so three picks aren't three rounds of the same fight.
 */
export function rankPrecedents(rows, opponentProfile, rules = RAG_RULES) {
  const best = new Map();
  for (const row of rows) {
    for (const p of row.perspectives ?? []) {
      if (p.won < 0.5) continue;
      const sim = similarity(opponentProfile, p.opponent, rules.similaritySigma);
      if (sim < rules.minSimilarity) continue;
      const relevance = sim * p.success.score;
      const key = `${row.matchId}|${p.corner}|${p.tactic}`;
      const prev = best.get(key);
      if (prev && prev.relevance >= relevance) continue;
      best.set(key, {
        matchId: row.matchId,
        roundIndex: row.roundIndex,
        corner: p.corner,
        tactic: p.tactic,
        opponentTactic: p.opponentTactic,
        opponent: p.opponent,
        similarity: round3(sim),
        successScore: p.success.score,
        relevance: round3(relevance),
        evidence: p.evidence,
        why: { similarity: round3(sim), ...mapValues(p.success.parts, round3) },
      });
    }
  }
  return [...best.values()].sort((a, b) => b.relevance - a.relevance).slice(0, rules.k);
}

/**
 * Compact prompt block for the LLM worker: upper-case headers, one line per
 * fact, an instruction last.
 */
export function toLLMContext(precedents, opponentProfile, { tactics } = {}) {
  const s = normalizeStats(opponentProfile);
  const lines = [
    'OPPONENT',
    `speed ${s.speed}, power ${s.power}, stamina ${s.stamina}, ring IQ ${s.ringIQ} (${profileTags(s).join(', ') || 'balanced'})`,
    '',
    'PAST WINS AGAINST SIMILAR OPPONENTS',
  ];
  if (precedents.length === 0) lines.push('none yet');
  precedents.forEach((p, i) => {
    const e = p.evidence;
    lines.push(
      `${i + 1}. ${p.tactic} vs ${p.opponentTactic} (match ${p.matchId}, round ${p.roundIndex}); similarity ${p.similarity}, success ${p.successScore}. ` +
      `Landed ${Math.round(e.landRate * 100)}% at ${e.avgVelocityMps} m/s; travel ${e.avgTravelMs} ms vs their reaction ${e.avgReactionAgainstMs} ms ` +
      `(margin ${e.avgMarginMs} ms); energy ${Math.round(e.joulesFor)} J for, ${Math.round(e.joulesAgainst)} J against${e.koFor ? '; KO' : ''}.`
    );
  });
  if (tactics) lines.push('', 'TACTICS AVAILABLE', Object.keys(tactics).join(', '));
  lines.push('', 'Write: the corner instruction for next round, one tactic from the list and one sentence why, citing the numbers.');
  return lines.join('\n');
}

function pickStats(profile) { return normalizeStats(profile); }
function round3(v) { return Math.round(v * 1000) / 1000; }
function mapValues(o, fn) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)])); }
