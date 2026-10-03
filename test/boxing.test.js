// Boxing Manager AI: deterministic physics, the collision rule, telemetry shape, and RAG ranking. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FighterModel, CombatSimulation, computePunch, mulberry32, PUNCHES, TACTICS } from '../public/boxing/physics-engine.js';
import { buildFightLogRow, rankPrecedents, similarity, profileTags, successScore, toLLMContext } from '../public/boxing/game-db.js';

const AVG = { speed: 50, power: 50, stamina: 50, ringIQ: 50 };
const fighter = (corner, stats = AVG) => new FighterModel({ corner, name: corner, stats });
const fight = (seed, red = AVG, blue = AVG, tactics = { red: 'pressure', blue: 'outbox' }) => {
  const sim = new CombatSimulation({ seed, rounds: 3, red: fighter('red', red), blue: fighter('blue', blue) });
  while (sim.phase !== 'fight_over') { sim.startRound(tactics); sim.runRoundToEnd(); }
  return sim;
};

test('the same seed gives byte-identical telemetry; a different seed does not', () => {
  const a = JSON.stringify(fight(7).rounds), b = JSON.stringify(fight(7).rounds);
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(fight(8).rounds));
});

test('a punch lands exactly when travel time is shorter than the reaction window', () => {
  const sim = fight(3);
  const punches = sim.rounds.flatMap((r) => r.exchanges.flatMap((e) => e.punches));
  assert.ok(punches.length > 50);
  for (const p of punches) {
    const landed = p.outcome === 'landed';
    // Serialized margins are rounded to 0.01 ms; a margin that rounds to 0 can go either way.
    if (p.margin_ms !== 0) assert.equal(landed, p.margin_ms > 0, `${p.punch} at ${p.t_ms}`);
    if (!landed) assert.equal(p.outcome, -p.margin_ms <= 35 ? 'blocked' : 'slipped');
  }
});

test('impact energy is ½ m v², and only landed or blocked punches transfer it', () => {
  const red = fighter('red'), blue = fighter('blue');
  red.pos = { x: -0.5, y: 0 }; blue.pos = { x: 0.5, y: 0 };
  const p = computePunch({ attacker: red, defender: blue, type: 'cross', tick: 0, rng: mulberry32(1) });
  assert.ok(Math.abs(p.kineticJoules - 0.5 * p.effectiveMassKg * p.punchVelocityMps ** 2) < 1e-9);
  assert.equal(p.travelTimeMs, p.telegraphMs + p.flightMs);
  assert.ok(Math.abs(p.flightMs - (p.travelDistanceM / p.punchVelocityMps) * 1000) < 1e-9);
  const expected = p.outcome === 'landed' ? p.kineticJoules : p.outcome === 'blocked' ? p.kineticJoules * 0.15 : 0;
  assert.equal(p.transferredJoules, expected);
});

test('lower stamina slows the hand and widens the defender window', () => {
  const mk = () => { const r = fighter('red'), b = fighter('blue'); r.pos = { x: -0.5, y: 0 }; b.pos = { x: 0.5, y: 0 }; return [r, b]; };
  const [r1, b1] = mk(), [r2, b2] = mk();
  r2.gas = 0; b2.gas = 0;
  const fresh = computePunch({ attacker: r1, defender: b1, type: 'jab', tick: 0, rng: mulberry32(9) });
  const tired = computePunch({ attacker: r2, defender: b2, type: 'jab', tick: 0, rng: mulberry32(9) });
  assert.ok(tired.punchVelocityMps < fresh.punchVelocityMps);
  assert.ok(tired.reaction.windowMs > fresh.reaction.windowMs);
});

test('exchanges serialize as bm.exchange.v1 with distance vectors and ms timings', () => {
  const sim = fight(11);
  const ex = sim.rounds[0].exchanges[0];
  assert.equal(ex.schema, 'bm.exchange.v1');
  assert.equal(ex.match_id, sim.matchId);
  const p = ex.punches[0];
  for (const k of ['distance_vector', 'punch_velocity_mps', 'travel_time_ms', 'reaction_window_ms', 'margin_ms', 'kinetic_energy_j', 'outcome']) assert.ok(k in p, k);
  const d = p.distance_vector;
  assert.ok(Math.abs(Math.hypot(d.dx_m, d.dy_m) - d.magnitude_m) < 0.005);
  assert.ok(PUNCHES[p.punch] && p.arrive_ms > p.t_ms);
  assert.ok(Math.abs(ex.end_ms - ex.start_ms - ex.duration_ms) < 0.02);
});

test('rounds follow corner calls and the fight ends by KO or after the last round', () => {
  const sim = fight(5);
  assert.equal(sim.phase, 'fight_over');
  assert.ok(sim.rounds.length >= 1 && sim.rounds.length <= 3);
  for (const r of sim.rounds) assert.deepEqual(r.corner_actions, { red: 'pressure', blue: 'outbox' });
  assert.throws(() => sim.startRound({ red: 'pressure', blue: 'outbox' }), /phase/);
  assert.ok(Object.keys(TACTICS).length >= 4);
});

test('RAG: tags, similarity and success score', () => {
  assert.deepEqual(profileTags({ speed: 80, power: 30, stamina: 50, ringIQ: 50 }), ['speed:high', 'power:low']);
  assert.equal(similarity(AVG, AVG), 1);
  assert.ok(similarity(AVG, { ...AVG, power: 60 }) > similarity(AVG, { ...AVG, power: 90 }));
  const won = successScore({ won: 1, evidence: { joulesFor: 300, joulesAgainst: 100, landRate: 0.5, koFor: false } });
  const lost = successScore({ won: 0, evidence: { joulesFor: 100, joulesAgainst: 300, landRate: 0.2, koFor: false } });
  assert.ok(won.score > lost.score);
});

test('RAG: top 3 winning precedents against the most similar opponents, one per match and tactic', () => {
  const slugger = { speed: 35, power: 85, stamina: 50, ringIQ: 40 };
  const rows = [];
  let seed = 100;
  for (const [opp, tactic] of [[slugger, 'outbox'], [slugger, 'counter'], [slugger, 'pressure'], [AVG, 'body_attack'], [{ speed: 90, power: 20, stamina: 90, ringIQ: 90 }, 'outbox']]) {
    const sim = fight(seed++, AVG, opp, { red: tactic, blue: 'pressure' });
    for (const r of sim.rounds) rows.push(buildFightLogRow(r, { seed, fighters: { red: AVG, blue: opp } }));
  }
  const picks = rankPrecedents(rows, slugger);
  assert.ok(picks.length > 0 && picks.length <= 3);
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i - 1].relevance >= picks[i].relevance);
  const keys = picks.map((p) => `${p.matchId}|${p.corner}|${p.tactic}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const p of picks) {
    assert.ok(p.evidence && p.why.similarity === p.similarity);
    assert.ok(Math.abs(p.relevance - p.similarity * p.successScore) < 0.002);
  }
  const ctx = toLLMContext(picks, slugger, { tactics: TACTICS });
  assert.match(ctx, /^OPPONENT\n/);
  assert.match(ctx, /PAST WINS AGAINST SIMILAR OPPONENTS/);
});
