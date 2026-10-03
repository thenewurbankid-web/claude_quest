// The Gloamwyrm (PLAN-engine.md, R2): unanswered Riddles condense in the Haze into a boss whose size follows the
// weighted backlog score. Pure functions, like riddles.js: the weights read a Ledger snapshot, and the battle moves take
// and return BossPlay (the save's play.boss, never ledger data) plus the events to log. Answers never go through here;
// they go through the Riddle rules, and the battle only reads which of its Riddles got resolved.
import { DEFAULT_RULES, BATTLE_MOVES, canMove, validateBattle } from './contract.js';
import { riddleWeight, riskTier } from './riddles.js';

const DAY = 24 * 3600e3;
const clone = v => JSON.parse(JSON.stringify(v));
const round2 = n => Math.round(n * 100) / 100;
const FEEDING = ['open', 'deferred'];
/** A Riddle counts as resolved for the fight once it is no longer open: answered, deferred, sealed or faded. */
const resolved = r => !r || r.state !== 'open';

// ---------- weights ----------
/**
 * The Gloamwyrm's score and where it comes from: the sum of riddleWeight over open and deferred Riddles.
 * parts: one per feeding Riddle, heaviest first, with why it weighs what it does (base 1, + per deferral, + per day).
 * works: the same grouped by Work, heaviest first, so the player can name which Works feed it.
 */
export function bossScore(ledger, now = new Date(), rules = DEFAULT_RULES) {
  const works = new Map((ledger.works || []).map(w => [w.id, w]));
  const marches = new Map((ledger.marches || []).map(m => [m.id, m]));
  const parts = (ledger.riddles || []).filter(r => FEEDING.includes(r.state)).map(r => {
    const w = works.get(r.workId);
    const ageDays = Math.max(0, (now.getTime() - Date.parse(r.raisedAt)) / DAY) || 0;
    const deferrals = r.deferCount || 0;
    return {
      riddleId: r.id, workId: r.workId, workTitle: w?.title || r.workId, march: marches.get(r.marchId)?.name || r.marchId,
      state: r.state, tier: riskTier(r, rules), weight: round2(riddleWeight(r, now, rules)),
      why: { base: 1, deferrals, fromDeferrals: round2(deferrals * rules.deferWeightGrowth), ageDays: round2(ageDays),
        fromAge: round2(0.1 * ageDays) },
    };
  }).sort((a, b) => b.weight - a.weight || a.riddleId.localeCompare(b.riddleId));
  const byWork = new Map();
  for (const p of parts) {
    const g = byWork.get(p.workId) || { workId: p.workId, workTitle: p.workTitle, march: p.march, weight: 0, riddleIds: [] };
    g.weight = round2(g.weight + p.weight);
    g.riddleIds.push(p.riddleId);
    byWork.set(p.workId, g);
  }
  const score = round2(parts.reduce((s, p) => s + p.weight, 0));
  const openScore = round2(parts.filter(p => p.state === 'open').reduce((s, p) => s + p.weight, 0));
  return { score, openScore, threshold: rules.bossThreshold, over: score >= rules.bossThreshold, parts,
    works: [...byWork.values()].sort((a, b) => b.weight - a.weight) };
}

/** One plain sentence on why a part weighs what it does, for the "fed by" list. */
export function whyLine(p) {
  const bits = ['1 for the question'];
  if (p.why.deferrals) bits.push(`${p.why.fromDeferrals} for ${p.why.deferrals} "ask me later"`);
  if (p.why.fromAge >= 0.05) bits.push(`${p.why.fromAge} for ${Math.floor(p.why.ageDays)} day${Math.floor(p.why.ageDays) === 1 ? '' : 's'} waiting`);
  return bits.join(' + ');
}

/** How big the Gloamwyrm looks: 1 at the threshold, growing with the score, capped so it stays on screen. */
export const bossSize = (score, rules = DEFAULT_RULES) => Math.min(2.2, Math.max(0.6, Math.sqrt(score / rules.bossThreshold)));

/**
 * How thick the Haze hangs over the world, 0 (clear) to 1, from the weight of OPEN Riddles (bossScore's openScore):
 * put-off ones still summon the Gloamwyrm, but a fight won by clearing every open question visibly clears the sky.
 * It starts after the first question and is full at 1.5 times the threshold.
 */
export const hazeLevel = (openScore, rules = DEFAULT_RULES) =>
  round2(Math.min(1, Math.max(0, (openScore - 1) / (rules.bossThreshold * 1.5 - 1))));

// ---------- the battle ----------
export const emptyBossPlay = () => ({ battle: null, retreats: 0 });
const active = b => !!b && !['won', 'retreated'].includes(b.phase);
const check = b => {
  const bad = validateBattle(b);
  if (bad.length) throw new Error(`battle: ${bad.map(p => `${p.path} ${p.problem}`).join('; ')}`);
  return b;
};
const move = (b, to) => {
  if (!canMove(BATTLE_MOVES, b.phase, to)) throw new Error(`the battle can't go from ${b.phase} to ${to}`);
  b.phase = to;
};

/** Should the Gloamwyrm cut in: the score is over the threshold, no fight is on, and at least one Riddle is open to face. */
export function shouldSummon(ledger, play = emptyBossPlay(), now = new Date(), rules = DEFAULT_RULES) {
  if (active(play.battle)) return false;
  return bossScore(ledger, now, rules).over && (ledger.riddles || []).some(r => r.state === 'open');
}

/**
 * Starts a fight. Open normal-tier Riddles are asked in combat; open confirm/never ones only pause it for the Lodge.
 * Deferred Riddles feed the score (so its hp) but can't be faced until they return. maxHp = round(score * hpPerWeight *
 * strength), strength = 1 + retreats * returnGrowth.
 */
export function summon(ledger, play = emptyBossPlay(), now = new Date(), rules = DEFAULT_RULES) {
  if (active(play.battle)) throw new Error('a fight is already on');
  const { score, parts } = bossScore(ledger, now, rules);
  const open = parts.filter(p => p.state === 'open');
  if (!open.length) throw new Error('nothing open to face');
  const strength = round2(1 + (play.retreats || 0) * rules.bossReturnGrowth);
  const maxHp = Math.max(1, Math.round(score * rules.bossHpPerWeight * strength));
  const at = now.toISOString();
  const battle = check({
    id: `boss-${now.getTime().toString(36)}`, startedAt: at, phase: 'fighting', score, strength, hp: maxHp, maxHp,
    riddleIds: open.filter(p => p.tier === 'normal').map(p => p.riddleId),
    lodgeIds: open.filter(p => p.tier !== 'normal').map(p => p.riddleId),
    resolvedIds: [], current: null, turn: 1, endedAt: null,
    weights: Object.fromEntries(open.map(p => [p.riddleId, p.weight])),
  });
  return { play: { ...clone(play), battle }, events: [{ at, kind: 'boss.summoned', ref: battle.id }] };
}

/** The fight's Riddles still to resolve, in the order they are offered: normal ones first, heaviest first. */
export function unresolved(battle) {
  const done = new Set(battle.resolvedIds);
  const w = id => battle.weights?.[id] || 0;
  const byWeight = (a, b) => w(b) - w(a);
  return [...battle.riddleIds.filter(id => !done.has(id)).sort(byWeight),
    ...battle.lodgeIds.filter(id => !done.has(id)).sort(byWeight)];
}

/** Face one of the fight's Riddles: a normal one pauses for the question, a confirm/never one pauses for the Lodge. */
export function face(play, riddleId) {
  const b = clone(play.battle);
  if (!b || b.phase !== 'fighting') throw new Error('no turn to take');
  if (!unresolved(b).includes(riddleId)) throw new Error(`Riddle ${riddleId} isn't waiting in this fight`);
  move(b, b.lodgeIds.includes(riddleId) ? 'lodge' : 'question');
  b.current = riddleId;
  return { ...clone(play), battle: check(b) };
}

/**
 * After a pause closes: every fight Riddle the ledger now shows resolved lands a hit (deferring counts), sized by its
 * weight's share of maxHp. mash (0..1) adds at most rules.mashBonus of a hit and never picks an answer. hp only reaches
 * 0 with the last Riddle, and then the fight is won. A pause closed with no answer just goes back to fighting.
 * Returns { play, hits: [{ riddleId, damage, mashed }], healed: [{ riddleId, hp }], events }.
 */
export function settle(ledger, play, { mash = 0 } = {}, now = new Date(), rules = DEFAULT_RULES) {
  const b = clone(play.battle);
  if (!active(b)) throw new Error('no fight is on');
  const riddles = new Map((ledger.riddles || []).map(r => [r.id, r]));
  const all = [...b.riddleIds, ...b.lodgeIds];
  // An answer recalled from the outbox reopens its Riddle: the hit it landed is taken back.
  const healed = [];
  for (const id of b.resolvedIds.filter(id => !resolved(riddles.get(id)))) {
    b.resolvedIds = b.resolvedIds.filter(x => x !== id);
    const back = b.dealt?.[id] || 0;
    b.hp = Math.min(b.maxHp, b.hp + back);
    if (b.dealt) delete b.dealt[id];
    healed.push({ riddleId: id, hp: back });
  }
  const newly = all.filter(id => !b.resolvedIds.includes(id) && resolved(riddles.get(id)));
  const total = all.reduce((s, id) => s + (b.weights?.[id] || 1), 0);
  const m = Math.min(1, Math.max(0, Number(mash) || 0));
  const hits = [];
  for (const id of newly) {
    b.resolvedIds.push(id);
    const base = b.maxHp * (b.weights?.[id] || 1) / total;
    const left = all.length - b.resolvedIds.length;
    const damage = Math.round(base * (1 + m * rules.mashBonus));
    const before = b.hp;
    b.hp = left ? Math.max(1, b.hp - damage) : 0;
    b.dealt = { ...(b.dealt || {}), [id]: before - b.hp };
    hits.push({ riddleId: id, damage: left ? damage : Math.max(damage, 1), mashed: m > 0 });
  }
  const at = now.toISOString(), events = [];
  if (b.phase !== 'fighting') move(b, 'fighting');
  b.current = null;
  b.turn += 1;
  let next = { ...clone(play), battle: b };
  if (all.every(id => b.resolvedIds.includes(id))) {
    b.hp = 0;
    move(b, 'won');
    b.endedAt = at;
    events.push({ at, kind: 'boss.defeated', ref: b.id });
    next = { battle: b, retreats: 0 }; // it's beaten: the next one starts at full strength again
  }
  check(b);
  return { play: next, hits, healed, events };
}

/** Fall back to the Lodge, from any turn. Answers already given stay in the ledger; the Gloamwyrm comes back stronger. */
export function retreat(play, now = new Date()) {
  const b = clone(play.battle);
  if (!active(b)) throw new Error('no fight to retreat from');
  move(b, 'retreated');
  b.current = null;
  b.endedAt = now.toISOString();
  return { play: { battle: check(b), retreats: (play.retreats || 0) + 1 },
    events: [{ at: b.endedAt, kind: 'boss.retreated', ref: b.id }] };
}

/** What the next fight's strength will be, and why, for the retreat button and the Lodge. */
export function returnNote(play, rules = DEFAULT_RULES) {
  const n = (play.retreats || 0) + 1;
  const s = round2(1 + n * rules.bossReturnGrowth);
  return `It will come back ${Math.round((s - 1) * 100)}% stronger (${n} retreat${n === 1 ? '' : 's'}): more hp, the same questions.`;
}
