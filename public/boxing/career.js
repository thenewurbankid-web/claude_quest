// Career mode rules with no DOM: weeks, energy, tiers, rankings, fight offers, purses, injuries, rivals, gym drills.
// index.html draws them; test/boxing.test.js pins them. Nothing here touches the fight simulation.
import { mulberry32 } from './physics-engine.js';

export const ENERGY = { max: 100, fight: 25, drill: 20, rest: 35, weekly: 10 };

export const TIERS = [
  { key: 'block', name: 'Block parties', rep: 0, rounds: [1, 2], purse: [40, 90], shift: -10,
    venues: ['Hydrant block party, 129th', 'Rooftop on Lenox', 'Basketball court, 118th', 'Barbershop back lot'],
    pool: [['Lil Hammer', 'slugger'], ['Flash Gordon', 'speedster'], ['Deacon', 'technician'], ['Big Moe', 'grinder'], ['Tiny Tony', 'speedster'], ['Bodega Bill', 'slugger']] },
  { key: 'local', name: 'Local circuit', rep: 30, rounds: [3, 3], purse: [120, 260], shift: 0,
    venues: ['Harlem rec centre', 'Bronx boxing gym', 'Brooklyn warehouse', 'Queens parking garage'],
    pool: [['Mack Attack', 'slugger'], ['Silk', 'technician'], ['Rico Suave', 'speedster'], ['Gravedigger', 'grinder'], ['Cold Hands', 'technician'], ['Joey Bones', 'slugger']] },
  { key: 'city', name: 'City title', rep: 90, rounds: [3, 4], purse: [400, 900], shift: 8,
    venues: ['Apollo basement ring', 'Pier 40 arena', 'Garden annex', 'Rucker Park showdown'],
    pool: [['Ice Cold Ike', 'technician'], ['Nitro', 'speedster'], ['Cinderblock', 'slugger'], ['The Machine', 'grinder'], ['Ghost', 'technician'], ['Tombstone', 'slugger']] },
  { key: 'underground', name: 'Underground championship', rep: 200, rounds: [5, 5], purse: [1500, 3500], shift: 16,
    venues: ['The Vault, under Canal St', 'Subway yard, midnight', 'Rooftop cage, Hell\'s Kitchen'],
    pool: [['King Cobra', 'technician'], ['Wrecking Ball', 'slugger'], ['Phantom', 'speedster'], ['Mr. Zero', 'grinder'], ['The Champ', 'technician'], ['Baron', 'slugger']] },
];
const STAT_ARCH = {
  slugger: { speed: 38, power: 82, stamina: 55, ringIQ: 42 }, speedster: { speed: 84, power: 40, stamina: 60, ringIQ: 55 },
  technician: { speed: 58, power: 50, stamina: 52, ringIQ: 82 }, grinder: { speed: 48, power: 55, stamina: 85, ringIQ: 45 },
};
const LOOKS = {
  slugger: { topStyle: 'tank', top: '#16171a', jeans: '#1d1e22', boots: 'timbs', cap: null, chain: true, wraps: '#16171a', skin: 'deep' },
  speedster: { topStyle: 'tee', top: '#c9a227', jeans: '#2f3b52', boots: 'sneakers', cap: '#16171a', capBackwards: false, chain: false, wraps: '#ecebe6', skin: 'medium' },
  technician: { topStyle: 'hoodie', top: '#8a8f96', jeans: '#4f6b8f', boots: 'sneakers', cap: null, chain: false, wraps: '#2f6fd0', skin: 'light' },
  grinder: { topStyle: 'varsity', top: '#3d5a3a', sleeve: '#c9c6bf', jeans: '#2f3b52', boots: 'timbs', cap: '#3d5a3a', capBackwards: true, chain: true, wraps: '#d9a12b', skin: 'medium' },
};
export const ARCH_STYLE = { slugger: 'Heavy hands', speedster: 'Fast flurries', technician: 'Counter-puncher', grinder: 'Never tires' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export const tierIndex = (rep) => TIERS.reduce((t, x, i) => (rep >= x.rep ? i : t), 0);

export function newCareer(seed = 1) {
  return { v: 1, seed: seed >>> 0, week: 1, money: 0, rep: 0, energy: ENERGY.max, injury: 0, fights: 0, trained: {}, rivals: {}, log: [] };
}

/** A career from storage or anywhere else: every field coerced, junk dropped. */
export function normalizeCareer(c) {
  if (!c || typeof c !== 'object') return null;
  const rivals = {};
  for (const [name, r] of Object.entries(c.rivals && typeof c.rivals === 'object' ? c.rivals : {}).slice(0, 40)) {
    if (!r || typeof r !== 'object' || !STAT_ARCH[r.arch]) continue;
    rivals[String(name).slice(0, 24)] = { arch: r.arch, w: num(r.w, 0, 0, 99), l: num(r.l, 0, 0, 99), meetings: num(r.meetings, 0, 0, 99), grudge: !!r.grudge, lastWeek: num(r.lastWeek, 0, 0, 9999), tier: num(r.tier, 0, 0, TIERS.length - 1) };
  }
  const trained = {};
  for (const k of ['speed', 'power', 'stamina', 'ringIQ']) { const t = c.trained?.[k]; if (t) trained[k] = { gain: num(t.gain, 0, 0, 99), sessions: num(t.sessions, 0, 0, 999) }; }
  return {
    v: 1, seed: num(c.seed, 1, 0, 4294967295), week: num(c.week, 1, 1, 9999), money: num(c.money, 0, 0, 1e9), rep: num(c.rep, 0, 0, 1e6),
    energy: num(c.energy, ENERGY.max, 0, ENERGY.max), injury: num(c.injury, 0, 0, 6), fights: num(c.fights, 0, 0, 9999), trained, rivals,
    log: (Array.isArray(c.log) ? c.log : []).slice(-30).map((e) => ({ week: num(e?.week, 0, 0, 9999), text: String(e?.text ?? '').slice(0, 120) })),
  };
}

/** Stats the fighter brings to the ring today: tiredness and injury take a share, a fresh body takes none. */
export function effectiveStats(stats, c) {
  const tired = c.energy >= 60 ? 0 : ((60 - c.energy) / 60) * 0.2;
  const hurt = c.injury > 0 ? 0.08 + 0.02 * Math.min(c.injury, 3) : 0;
  const f = 1 - tired - hurt;
  const out = {};
  for (const k of Object.keys(stats)) out[k] = clamp(Math.round(stats[k] * f), 1, 100);
  return out;
}
export const conditionPenalty = (c) => Math.round((1 - effectiveStats({ x: 100 }, c).x / 100) * 100);

// ─── Rankings ───────────────────────────────────────────────────────────────

/** The current tier's ladder: its named fighters at fixed rep, with you slotted in by rep. */
export function ladder(c, name = 'You') {
  const ti = tierIndex(c.rep), t = TIERS[ti], top = TIERS[ti + 1]?.rep ?? t.rep + 220;
  const rows = t.pool.map(([n, arch], i) => ({ name: n, arch, rep: Math.round(t.rep + ((i + 1) / (t.pool.length + 1)) * (top - t.rep)) }));
  rows.push({ name, rep: c.rep, you: true });
  rows.sort((a, b) => b.rep - a.rep || (a.you ? -1 : 1));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
export const rankOf = (c) => ladder(c).find((r) => r.you).rank;

// ─── Fight offers ───────────────────────────────────────────────────────────

/** The offers on the table in `week`: always the same for a given career seed and week, so reloading can't reroll them. */
export function offersFor(c, week = c.week) {
  const rnd = mulberry32(hash(`${c.seed}:${week}`));
  const ti = tierIndex(c.rep), t = TIERS[ti];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const offers = [];
  const rival = Object.entries(c.rivals).find(([, r]) => r.grudge && r.tier === ti && r.lastWeek + 2 <= week);
  if (rival) offers.push(build(t, ti, rival[0], rival[1].arch, rnd, { rival: true, shift: 3 + rival[1].l }));
  const names = [];
  while (offers.length < 2) {
    const [n, arch] = pick(t.pool);
    if (names.includes(n) || offers.some((o) => o.name === n)) continue;
    names.push(n);
    offers.push(build(t, ti, n, arch, rnd, { shift: 0 }));
  }
  return offers;
}
function build(t, ti, name, arch, rnd, { rival = false, shift = 0 }) {
  const stats = {};
  for (const k of Object.keys(STAT_ARCH[arch])) stats[k] = clamp(Math.round(STAT_ARCH[arch][k] + t.shift + shift + (rnd() - 0.5) * 8), 25, 95);
  const purse = Math.round((t.purse[0] + rnd() * (t.purse[1] - t.purse[0])) * (rival ? 1.25 : 1) / 5) * 5;
  const rounds = t.rounds[0] + Math.floor(rnd() * (t.rounds[1] - t.rounds[0] + 1));
  const venue = t.venues[Math.floor(rnd() * t.venues.length)];
  const record = { w: 3 + ti * 5 + Math.floor(rnd() * 6), l: Math.floor(rnd() * 5) };
  const title = ti === TIERS.length - 1 || (ti >= 2 && rnd() < 0.15);
  return { id: `${t.key}:${name}`, name, arch, style: ARCH_STYLE[arch], stats, look: LOOKS[arch], purse, rounds, venue, record, rival, tier: ti, tierName: t.name, title };
}

// ─── Weeks ──────────────────────────────────────────────────────────────────

const note = (c, text) => ({ ...c, log: [...c.log, { week: c.week, text }].slice(-30) });
function advance(c) { return { ...c, week: c.week + 1, energy: Math.min(ENERGY.max, c.energy + ENERGY.weekly), injury: Math.max(0, c.injury - 1) }; }

export const canDrill = (c) => c.energy >= ENERGY.drill;

export function rest(c) {
  return advance(note({ ...c, energy: Math.min(ENERGY.max, c.energy + ENERGY.rest) }, c.injury ? 'Rested. The body is mending.' : 'Rested.'));
}

/**
 * Settle a career fight. `outcome` is 'w' | 'l' | 'd'. Returns the new career and what changed, for the result screen.
 */
export function applyFight(c, offer, outcome, ko) {
  const before = { rep: c.rep, rank: rankOf(c), tier: tierIndex(c.rep), energy: c.energy, injury: c.injury, money: c.money };
  const purse = outcome === 'w' ? offer.purse : outcome === 'd' ? Math.round(offer.purse / 2) : Math.round(offer.purse / 4);
  const win = 10 + 5 * offer.tier + (ko ? 5 : 0) + (offer.title ? 8 : 0) + (offer.rival ? 4 : 0);
  const repGain = outcome === 'w' ? win : outcome === 'd' ? 4 : -3;
  const injury = outcome === 'l' ? (ko ? 3 : 1) : 0;
  const prev = c.rivals[offer.name] ?? { arch: offer.arch, w: 0, l: 0, meetings: 0, grudge: false, lastWeek: 0, tier: offer.tier };
  const meetings = prev.meetings + 1;
  const rivals = { ...c.rivals, [offer.name]: {
    ...prev, meetings, tier: offer.tier, lastWeek: c.week, w: prev.w + (outcome === 'w' ? 1 : 0), l: prev.l + (outcome === 'l' ? 1 : 0),
    grudge: outcome === 'l' || (outcome === 'w' && ko && meetings === 1),
  } };
  let n = { ...c, money: c.money + purse, rep: Math.max(0, c.rep + repGain), energy: Math.max(0, c.energy - ENERGY.fight), injury: Math.min(6, c.injury + injury), fights: c.fights + 1, rivals };
  const word = { w: 'Beat', l: 'Lost to', d: 'Drew with' }[outcome];
  n = advance(note(n, `${word} ${offer.name}${ko ? ' by KO' : ''}. $${purse}.`));
  const after = { rep: n.rep, rank: rankOf(n), tier: tierIndex(n.rep) };
  return {
    career: n,
    changes: {
      purse, repGain, repBefore: before.rep, repAfter: n.rep, rankBefore: before.rank, rankAfter: after.rank,
      promoted: after.tier > before.tier ? TIERS[after.tier].name : null, energyCost: ENERGY.fight, injuryWeeks: injury,
      rival: n.rivals[offer.name].grudge ? (outcome === 'l' ? `${offer.name} will want to run it back.` : `${offer.name} wants a rematch.`) : null,
    },
  };
}

// ─── Gym drills ─────────────────────────────────────────────────────────────

export const DRILLS = {
  heavybag: { stat: 'power', name: 'Heavy bag', blurb: 'Hit when the marker is in the gold.', hits: 8, speed: 2.4 },
};

/** Marker position in [-1, 1] at time t seconds: a sweep with no randomness, so a drill is reproducible. */
export const markerAt = (t, speed) => Math.sin(t * speed);

/** Points for one tap: dead centre is 1, the edge of the gold 0.6, the edge of the bar 0. */
export const hitScore = (pos) => { const d = Math.abs(pos); return d < 0.12 ? 1 : d < 0.35 ? 0.6 : d < 0.7 ? 0.25 : 0; };

export const maxGain = (stat) => (stat < 60 ? 3 : stat < 80 ? 2 : 1);

/** Result of a drill from the marker positions at each tap (missing taps count as 0). */
export function drillResult(drill, positions, stat) {
  const d = DRILLS[drill];
  const pts = Array.from({ length: d.hits }, (_, i) => (i < positions.length ? hitScore(positions[i]) : 0));
  const score = pts.reduce((a, b) => a + b, 0) / d.hits;
  const grade = score >= 0.85 ? 'Perfect' : score >= 0.6 ? 'Solid' : score >= 0.3 ? 'Sloppy' : 'Missed';
  return { score, grade, gain: Math.min(100 - stat, Math.round(score * maxGain(stat))), perfect: pts.filter((p) => p === 1).length };
}

/** Apply a drill: the stat rises, the session is logged, the week passes. Returns { career, stats }. */
export function applyDrill(c, stats, drill, result) {
  const d = DRILLS[drill], k = d.stat;
  const t = c.trained[k] ?? { gain: 0, sessions: 0 };
  const n = advance(note({ ...c, energy: Math.max(0, c.energy - ENERGY.drill), trained: { ...c.trained, [k]: { gain: t.gain + result.gain, sessions: t.sessions + 1 } } }, `${d.name}: ${result.grade}, +${result.gain} ${k}.`));
  return { career: n, stats: { ...stats, [k]: Math.min(100, stats[k] + result.gain) } };
}

/** The trainer's one line: points at the weakest stat, or at tiredness first. */
export function trainerTip(stats, c) {
  if (c.injury > 0) return 'You are hurt. Rest before you step in a ring.';
  if (c.energy < ENERGY.drill) return 'You are running on fumes. Rest a week.';
  if (c.energy < 60) return 'Tired legs lose rounds. Rest or fight light.';
  const open = Object.values(DRILLS).map((d) => d.stat);                 // only point at a stat the gym can train
  const weak = open.sort((a, b) => stats[a] - stats[b])[0];
  return { speed: 'Your hands are slow. Work the speed bag.', power: 'You hit like a kid. Hit the heavy bag.', stamina: 'You fade late. Get on the roadwork.', ringIQ: 'You get caught. Spar and learn to read them.' }[weak];
}
