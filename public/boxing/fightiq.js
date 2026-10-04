// Fight IQ read-outs with no DOM. Everything here is arithmetic on the fighter's stats, the career record and the local
// fight log. There is no learning model: "learned" means retrieved from rounds this player actually fought.
import { deriveAttributes, normalizeStats, STAT_KEYS, TACTICS } from './physics-engine.js';

export const START_STAT = 50;

/** Where each stat came from: the starting 50, gym drills (career.trained), and training-camp points (the rest). */
export function statSources(stats, career = null) {
  const out = {};
  for (const k of STAT_KEYS) {
    const gym = Math.min(career?.trained?.[k]?.gain ?? 0, Math.max(0, stats[k] - START_STAT));
    const sessions = career?.trained?.[k]?.sessions ?? 0;
    const camp = Math.max(0, stats[k] - START_STAT - gym);
    const lost = Math.max(0, START_STAT - stats[k]);
    const parts = [`Start ${START_STAT}`];
    if (camp) parts.push(`+${camp} training camp`);
    if (gym) parts.push(`+${gym} gym (${sessions} session${sessions === 1 ? '' : 's'})`);
    if (lost) parts.push(`−${lost} below start`);
    out[k] = { value: stats[k], camp, gym, text: parts.join(' · ') };
  }
  return out;
}

const band = (v, lo, hi, words) => (v < lo ? words[0] : v < hi ? words[1] : words[2]);

/** Plain-words tendencies from the stats and what the sim derives from them. */
export function tendencies(stats) {
  const s = normalizeStats(stats), a = deriveAttributes(s);
  const lines = [
    band(s.speed, 45, 65, ['Slow hands: punches take time to land and are easy to see coming.', 'Average hand speed.', 'Fast hands: punches land quickly and flurries come easy.']),
    band(s.power, 45, 65, ['Light hitter: needs many clean shots to hurt anyone.', 'Hits with average weight.', 'Heavy hands: one clean shot changes a round.']),
    band(s.stamina, 45, 65, ['Tires early: fades in the late rounds if the pace stays high.', 'Holds a normal pace for three rounds.', 'Big gas tank: keeps the pace up late.']),
    band(s.ringIQ, 45, 65, ['Reads poorly: reacts late to what is thrown.', 'Reads the fight at an average rate.', 'Sharp reader: reacts early and shows little in the wind-up.']),
  ];
  const wp = { pressure: 0, outbox: 0, counter: 0, body_attack: 0 };
  if (s.power >= 65 && s.speed < 55) wp.pressure++;
  if (s.speed >= 65) wp.outbox++;
  if (s.ringIQ >= 65) wp.counter++;
  if (s.stamina >= 65 && s.power < 65) wp.body_attack++;
  const fit = Object.entries(wp).sort((x, y) => y[1] - x[1])[0];
  const style = fit[1] ? `Stats suit: ${TACTICS[fit[0]].label}.` : 'No stat stands out: any plan is a fair choice.';
  return { lines, style, reaction: `${a.perceptionMs.toFixed(0)} ms to react` };
}

/** The player's rows of a perspective list: only rounds where `corner` was the human's. */
const mine = (rows) => rows.flatMap((r) => (r.perspectives ?? []).filter((p) => p.corner === (r.managerCorner ?? 'red')));

/** Opponent kind from the stats, matching the archetype names. */
export function opponentKind(p) {
  const s = normalizeStats(p), top = STAT_KEYS.reduce((b, k) => (s[k] > s[b] ? k : b), STAT_KEYS[0]);
  if (s[top] < 62) return 'balanced';
  return { power: 'puncher', speed: 'speedster', stamina: 'grinder', ringIQ: 'boxer' }[top];
}

/**
 * What the fight log says about this player's own rounds: tactic usage and results, the best plan so far, and the plan
 * that works best against each opponent kind. `rows` are fight_logs rows. Retrieval and counting only.
 */
export function learnedFromLog(rows) {
  const ps = mine(rows);
  const byTactic = {}, byKind = {};
  for (const p of ps) {
    const t = (byTactic[p.tactic] ??= { rounds: 0, won: 0, score: 0 });
    t.rounds++; t.won += p.won; t.score += p.success.score;
    const kind = opponentKind(p.opponent);
    const k = ((byKind[kind] ??= {})[p.tactic] ??= { rounds: 0, won: 0 });
    k.rounds++; k.won += p.won;
  }
  const tactics = Object.entries(byTactic).map(([tactic, t]) => ({ tactic, rounds: t.rounds, won: t.won, winRate: t.won / t.rounds, score: t.score / t.rounds }))
    .sort((a, b) => b.rounds - a.rounds);
  const rated = tactics.filter((t) => t.rounds >= 2).sort((a, b) => b.score - a.score);
  const kinds = Object.entries(byKind).map(([kind, tt]) => {
    const best = Object.entries(tt).filter(([, v]) => v.rounds >= 1).sort((a, b) => b[1].won / b[1].rounds - a[1].won / a[1].rounds || b[1].rounds - a[1].rounds)[0];
    return { kind, tactic: best[0], rounds: best[1].rounds, won: best[1].won };
  });
  return { rounds: ps.length, fights: new Set(rows.map((r) => r.matchId)).size, tactics, best: rated[0] ?? null, favourite: tactics[0] ?? null, kinds };
}

const pct = (x) => `${Math.round(x * 100)}%`;
export const KIND_LABEL = { puncher: 'heavy hitters', speedster: 'fast fighters', grinder: 'fighters who never tire', boxer: 'ring readers', balanced: 'even fighters' };

/** Short sentences for the Fight IQ card. */
export function learnedLines(learned) {
  if (!learned.rounds) return ['No rounds logged yet. Fight, and this fills in from your own rounds.'];
  const lab = (t) => TACTICS[t]?.label ?? t;
  const out = [`${learned.rounds} round${learned.rounds === 1 ? '' : 's'} logged over ${learned.fights} fight${learned.fights === 1 ? '' : 's'}.`];
  if (learned.favourite) out.push(`You pick ${lab(learned.favourite.tactic)} most: ${learned.favourite.rounds} rounds, won ${pct(learned.favourite.winRate)}.`);
  if (learned.best) out.push(`Best plan so far: ${lab(learned.best.tactic)} (${learned.best.won} won of ${learned.best.rounds}).`);
  for (const k of learned.kinds.slice(0, 3)) out.push(`Against ${KIND_LABEL[k.kind]}: ${lab(k.tactic)} has won ${k.won} of ${k.rounds}.`);
  return out;
}
