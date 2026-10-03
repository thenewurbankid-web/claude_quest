/**
 * physics-engine.js — deterministic boxing physics for Boxing Manager AI.
 *
 * Two layers live here:
 *
 *   1. A pure simulation core (FighterModel, CombatSimulation, serializers).
 *      No DOM, no Phaser, no wall clock. It runs a fixed 240 Hz step, so it can
 *      run on the main thread, in a Web Worker, or in Node for tests.
 *
 *   2. A Phaser 3 layer (Fighter sprite, BoxingScene, createPhysicsGame). It
 *      only steps the core and draws it. Phaser is resolved lazily from
 *      `globalThis.Phaser`, so importing this module never needs Phaser.
 *
 * Determinism rules (these keep two P2P peers bit-identical):
 *   - All randomness comes from a seeded mulberry32 PRNG.
 *   - Time is an integer tick count. Milliseconds are derived from it.
 *   - The core uses only + - * / and Math.sqrt, which IEEE 754 defines exactly.
 *     It never uses Math.sin/exp/pow, whose results can differ across engines.
 *   - Rounding happens only when telemetry is serialized, never in live state.
 *
 * Units are SI everywhere in the core: metres, seconds, kilograms, joules.
 * Pixels appear only in the Phaser layer.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

export const SIM_HZ = 240;                 // physics ticks per simulated second
export const TICK_MS = 1000 / SIM_HZ;      // ≈ 4.1667 ms per tick
const DT = 1 / SIM_HZ;                     // seconds per tick

export const RING_HALF_M = 3.0;            // 6 m × 6 m ring, origin at centre
const BODY_RADIUS_M = 0.25;                // torso radius, used for collisions
const GUARD_OFFSET_M = 0.25;               // fist rests this far ahead of centre
const TARGET_DEPTH_M = 0.15;               // head/body surface ahead of centre
const SLIP_DISTANCE_M = 0.12;              // how far a head must move to evade
const EXCHANGE_IDLE_MS = 800;              // quiet time that closes an exchange
const DAMAGE_DIVISOR = 475;                // joules per health point
const BLOCK_MARGIN_MS = 35;                // late reactions within this are blocks
const PERIPHERAL_MS = 30;                  // extra perception for punches from the side
const ROPES_ZONE_M = 0.6;                  // within this of the ropes, a defender can't slip back

/** Punch catalogue. Factors are relative to the fighter's base values. */
export const PUNCHES = Object.freeze({
  jab:      { reachFactor: 1.00, pathFactor: 1.00, speedFactor: 1.10, massFactor: 0.70, windupMs: 130, recoveryMs: 120, gasCost: 0.8, target: 'head' },
  cross:    { reachFactor: 1.05, pathFactor: 1.05, speedFactor: 1.00, massFactor: 1.00, windupMs: 150, recoveryMs: 170, gasCost: 1.4, target: 'head' },
  hook:     { reachFactor: 0.78, pathFactor: 1.45, speedFactor: 1.05, massFactor: 1.15, windupMs: 160, recoveryMs: 200, gasCost: 1.8, target: 'head', peripheral: true },
  uppercut: { reachFactor: 0.68, pathFactor: 1.25, speedFactor: 0.95, massFactor: 1.10, windupMs: 170, recoveryMs: 210, gasCost: 1.8, target: 'head', peripheral: true },
  body:     { reachFactor: 0.85, pathFactor: 1.20, speedFactor: 0.95, massFactor: 1.10, windupMs: 155, recoveryMs: 190, gasCost: 1.6, target: 'body' },
});

/**
 * Corner actions (tactics) the manager picks between rounds.
 * rangeM: preferred centre-to-centre distance. aggression: punch attempts per
 * second at full gas. combo: chance the next punch chains with no gap.
 * lateral: circling speed as a share of foot speed.
 */
export const TACTICS = Object.freeze({
  pressure:    { label: 'Pressure',     rangeM: 0.85, crowdMs: 30, aggression: 1.0, combo: 0.35, lateral: 0.10, counter: 0.2, gasRegen: 1.0, weights: { jab: 1, cross: 2, hook: 3, uppercut: 2, body: 2 } },
  outbox:      { label: 'Box outside',  rangeM: 1.25, aggression: 0.8, combo: 0.25, lateral: 0.60, counter: 0.4, gasRegen: 1.0, weights: { jab: 6, cross: 2, hook: 0.5, uppercut: 0.2, body: 0.5 } },
  counter:     { label: 'Counter-punch', rangeM: 1.20, aggression: 0.45, combo: 0.30, lateral: 0.30, counter: 1.0, gasRegen: 1.1, weights: { jab: 2, cross: 3, hook: 2, uppercut: 1, body: 1 } },
  body_attack: { label: 'Body attack',  rangeM: 0.95, aggression: 0.9, combo: 0.40, lateral: 0.15, counter: 0.3, gasRegen: 1.0, weights: { jab: 1, cross: 1, hook: 1, uppercut: 1, body: 5 } },
  recover:     { label: 'Recover',      rangeM: 1.70, aggression: 0.25, combo: 0.10, lateral: 0.70, counter: 0.5, gasRegen: 1.7, weights: { jab: 5, cross: 1, hook: 0, uppercut: 0, body: 0 } },
});

export const STAT_KEYS = ['speed', 'power', 'stamina', 'ringIQ'];

// ─── Small deterministic helpers ────────────────────────────────────────────

/** mulberry32: tiny, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v, dp = 3) => { const f = 10 ** dp; return Math.round(v * f) / f; };
const other = (corner) => (corner === 'red' ? 'blue' : 'red');

/** Weighted pick from {key: weight}, using the simulation PRNG. */
function weightedPick(weights, rng) {
  let total = 0;
  for (const k in weights) total += weights[k];
  if (total <= 0) return null;
  let r = rng() * total;
  for (const k in weights) { r -= weights[k]; if (r < 0) return k; }
  return Object.keys(weights).pop();
}

/** Clamp stats to 1–100 and fill missing keys with 50. */
export function normalizeStats(stats = {}) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = clamp(Math.round(stats[k] ?? 50), 1, 100);
  return out;
}

// ─── FighterModel: pure physical state ──────────────────────────────────────

/**
 * Turns the four manager stats into physical constants. Every derived value
 * is a linear map of a stat, so it is easy to reason about and to tune.
 */
export function deriveAttributes(stats, bodyMassKg = 72) {
  const s = stats.speed / 100, p = stats.power / 100, st = stats.stamina / 100, iq = stats.ringIQ / 100;
  return {
    // Arm plus the share of body mass a punch carries: about 2.3–4.3 kg at 72 kg.
    effectiveMassKg: bodyMassKg * (0.032 + 0.028 * p),
    baseHandSpeedMps: 6.0 + 4.0 * s + 1.5 * p,        // 6.0–11.5 m/s fresh
    footSpeedMps: 1.0 + 1.6 * s,                      // 1.0–2.6 m/s
    maxGas: 60 + 90 * st,                             // stamina "tank"
    gasRegenPerS: 0.6 + 1.6 * st,
    perceptionMs: 200 - 45 * s - 70 * iq,             // visual cue → motor start, 85–200 ms
    headMoveMps: 0.9 + 1.4 * s,                       // slip/duck velocity
    telegraphScale: 1.25 - 0.35 * iq - 0.20 * s,      // how readable the wind-up is
    readSkill: iq,                                    // anticipation of patterns
  };
}

export class FighterModel {
  /**
   * @param {object} cfg
   * @param {'red'|'blue'} cfg.corner
   * @param {string} cfg.name
   * @param {{speed:number,power:number,stamina:number,ringIQ:number}} cfg.stats
   */
  constructor({ corner, name, stats, bodyMassKg = 72, reachM = 0.92, color }) {
    this.corner = corner;
    this.name = name ?? corner;
    this.color = color ?? (corner === 'red' ? 0xe5484d : 0x3e8fe0);
    this.stats = normalizeStats(stats);
    this.bodyMassKg = bodyMassKg;
    this.reachM = reachM;
    this.attr = deriveAttributes(this.stats, bodyMassKg);
    this.health = 100;
    this.gas = this.attr.maxGas;
    this.resetForRound();
  }

  /** Puts the fighter back in its corner. Health and gas carry over. */
  resetForRound() {
    this.pos = { x: this.corner === 'red' ? -1.2 : 1.2, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.tactic = TACTICS.outbox;
    this.tacticKey = 'outbox';
    this.committedUntilTick = 0;    // mid-punch: cannot start a new action
    this.nextActionTick = 0;        // earliest tick for the next punch
    this.counterUntilTick = 0;      // a slip opened a counter window until here
    this.circleDir = this.corner === 'red' ? 1 : -1;
    this.recentPunches = [];        // last 6 punch types, used for predictability
    this.activePunch = null;        // { type, launchTick, arriveTick } for rendering
  }

  /** 0.75–1.0: hand speed, foot speed and head movement scale with remaining gas. */
  get staminaFactor() { return 0.75 + 0.25 * (this.gas / this.attr.maxGas); }
  get gasRatio() { return this.gas / this.attr.maxGas; }

  /** How predictable this fighter's next `type` is: share of the last 6 punches. */
  predictability(type) {
    if (this.recentPunches.length === 0) return 0;
    let n = 0;
    for (const t of this.recentPunches) if (t === type) n++;
    return n / this.recentPunches.length;
  }

  /** A plain-object profile, stored with logs and used for RAG similarity. */
  profile() {
    return { name: this.name, ...this.stats, reachM: this.reachM, bodyMassKg: this.bodyMassKg };
  }
}

// ─── Punch physics ──────────────────────────────────────────────────────────

/**
 * Computes one punch analytically when it is thrown. The outcome is fixed now;
 * the effect is applied when the fist arrives, `travelTimeMs` later.
 *
 * Travel Time = telegraph (wind-up the defender can see) + flight time.
 * Reaction Window = perception + motor time + fatigue − anticipation; this is
 * how long the defender needs to get out of the way or cover up.
 * Rule: if Travel Time < Reaction Window the punch lands. Within
 * BLOCK_MARGIN_MS the other way it is blocked; beyond that it is slipped.
 */
export function computePunch({ attacker, defender, type, tick, rng, isCounter = false }) {
  const pd = PUNCHES[type];
  const a = attacker.attr, d = defender.attr;

  // True distance vector, attacker → defender.
  const dx = defender.pos.x - attacker.pos.x;
  const dy = defender.pos.y - attacker.pos.y;
  const distanceM = Math.sqrt(dx * dx + dy * dy);

  // Straight-line gap from guard to target, stretched by the punch's arc.
  const gapM = Math.max(0.05, distanceM - GUARD_OFFSET_M - TARGET_DEPTH_M);
  const travelDistanceM = gapM * pd.pathFactor;

  // Punch velocity (m/s), scaled by remaining stamina.
  const staminaFactor = attacker.staminaFactor;
  const punchVelocityMps = a.baseHandSpeedMps * pd.speedFactor * staminaFactor;

  // Travel time (ms). Counters are thrown off a read, with a shorter wind-up.
  const telegraphMs = pd.windupMs * a.telegraphScale * (isCounter ? 0.7 : 1);
  const flightMs = (travelDistanceM / punchVelocityMps) * 1000;
  const travelTimeMs = telegraphMs + flightMs;

  // Defender reaction window (ms).
  // Hooks and uppercuts arrive from outside central vision, so they are seen later.
  const perceptionMs = d.perceptionMs + (pd.peripheral ? PERIPHERAL_MS : 0);
  const fatiguePenaltyMs = (1 - defender.gasRatio) * 25;
  const motorScale = pd.target === 'body' ? 1.2 : 1.0; // elbow-down is slower than a slip
  // On the ropes there is no room to slip back: the head has to travel further.
  const ropesM = RING_HALF_M - Math.max(Math.abs(defender.pos.x), Math.abs(defender.pos.y));
  const onRopes = ropesM < ROPES_ZONE_M;
  let motorMs = (SLIP_DISTANCE_M / (d.headMoveMps * defender.staminaFactor)) * 1000 * motorScale * (onRopes ? 1.35 : 1);
  // A defender who is mid-punch has to finish the punch before reacting.
  const committedMs = Math.max(0, (defender.committedUntilTick - tick) * TICK_MS);
  motorMs += Math.min(40, committedMs * 0.3);
  const anticipationMs = d.readSkill * (40 + 110 * attacker.predictability(type));
  const jitterMs = (rng() + rng() - 1) * 40;   // ±40 ms triangular neuromotor noise (seeded)
  // Pressure crowds a defender who is not also pressing: less room to read and slip.
  const crowdMs = defender.tacticKey === 'pressure' ? 0 : (attacker.tactic.crowdMs || 0);
  const reactionWindowMs = Math.max(60, perceptionMs + motorMs + fatiguePenaltyMs - anticipationMs + jitterMs + crowdMs);

  // Collision rule.
  const marginMs = reactionWindowMs - travelTimeMs;  // > 0 means the fist wins
  let outcome;
  if (travelTimeMs < reactionWindowMs) outcome = 'landed';
  else if (-marginMs <= BLOCK_MARGIN_MS) outcome = 'blocked';
  else outcome = 'slipped';

  // Kinetic energy at impact, E = ½ m v².
  const effectiveMassKg = a.effectiveMassKg * pd.massFactor;
  const kineticJoules = 0.5 * effectiveMassKg * punchVelocityMps * punchVelocityMps;
  const transferredJoules = outcome === 'landed' ? kineticJoules : outcome === 'blocked' ? kineticJoules * 0.15 : 0;

  return {
    type, target: pd.target, isCounter,
    attacker: attacker.corner, defender: defender.corner,
    launchTick: tick,
    arriveTick: tick + Math.max(1, Math.ceil(travelTimeMs / TICK_MS)),
    distanceVector: { dx, dy, magnitudeM: distanceM },
    velocities: {
      attacker: { vx: attacker.vel.x, vy: attacker.vel.y },
      defender: { vx: defender.vel.x, vy: defender.vel.y },
    },
    travelDistanceM, punchVelocityMps, staminaFactor,
    telegraphMs, flightMs, travelTimeMs,
    onRopes, reaction: { perceptionMs, motorMs, committedMs, fatiguePenaltyMs, anticipationMs, jitterMs, windowMs: reactionWindowMs },
    marginMs, outcome,
    effectiveMassKg, kineticJoules, transferredJoules,
  };
}

// ─── CombatSimulation: the deterministic fight loop ─────────────────────────

/**
 * Phases:
 *   'awaiting_corner' → startRound(actions) → 'running' → 'round_over' → …
 *   … → 'fight_over' (KO or final bell).
 *
 * Listeners: on('exchange' | 'impact' | 'round_end' | 'fight_end', fn).
 */
export class CombatSimulation {
  constructor({ red, blue, seed = 1, rounds = 6, roundSeconds = 180, matchId }) {
    this.fighters = { red, blue };
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.totalRounds = rounds;
    this.roundTicks = Math.round(roundSeconds * SIM_HZ);
    this.matchId = matchId ?? `m_${this.seed.toString(36)}`;
    this.roundIndex = 0;              // 1-based once a round starts
    this.phase = 'awaiting_corner';
    this.tick = 0;                    // ticks inside the current round
    this.pending = [];                // punches in flight
    this.exchange = null;             // the exchange being recorded
    this.exchangeSeq = 0;
    this.roundTelemetry = [];         // serialized exchanges this round
    this.rounds = [];                 // finished round summaries
    this.cornerActions = null;
    this.result = null;
    this._listeners = {};
  }

  on(type, fn) { (this._listeners[type] ??= []).push(fn); return () => this.off(type, fn); }
  off(type, fn) { this._listeners[type] = (this._listeners[type] ?? []).filter((f) => f !== fn); }
  _emit(type, payload) { for (const fn of this._listeners[type] ?? []) fn(payload); }

  get tMs() { return this.tick * TICK_MS; }

  /** Starts the next round with each corner's tactic, e.g. {red:'pressure', blue:'counter'}. */
  startRound(cornerActions) {
    if (this.phase !== 'awaiting_corner' && this.phase !== 'round_over') {
      throw new Error(`startRound() called during phase "${this.phase}"`);
    }
    this.roundIndex += 1;
    this.tick = 0;
    this.pending = [];
    this.exchange = null;
    this.roundTelemetry = [];
    this.cornerActions = { red: cornerActions.red, blue: cornerActions.blue };
    for (const c of ['red', 'blue']) {
      const f = this.fighters[c];
      // Between-round recovery: 40 % of the missing gas comes back.
      if (this.roundIndex > 1) f.gas = Math.min(f.attr.maxGas, f.gas + (f.attr.maxGas - f.gas) * 0.4);
      f.resetForRound();
      f.tacticKey = TACTICS[cornerActions[c]] ? cornerActions[c] : 'outbox';
      f.tactic = TACTICS[f.tacticKey];
    }
    this.phase = 'running';
  }

  /** Advances one 240 Hz tick. Returns the phase after the step. */
  step() {
    if (this.phase !== 'running') return this.phase;
    this.tick += 1;
    const { red, blue } = this.fighters;

    this._move(red, blue);
    this._move(blue, red);
    this._separate(red, blue);
    this._resolveArrivals();
    if (this.phase !== 'running') return this.phase; // KO

    this._decide(red, blue);
    this._decide(blue, red);
    this._closeExchangeIfIdle();

    if (this.tick >= this.roundTicks) this._endRound('bell');
    return this.phase;
  }

  /** Runs the current round to its end with no rendering (headless or Worker). */
  runRoundToEnd() {
    while (this.phase === 'running') this.step();
    return this.rounds[this.rounds.length - 1];
  }

  // ── movement ──

  _move(self, opp) {
    const t = self.tactic;
    const dx = opp.pos.x - self.pos.x, dy = opp.pos.y - self.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const ux = dx / dist, uy = dy / dist;          // unit vector toward opponent
    const px = -uy, py = ux;                       // perpendicular, for circling

    const sf = self.staminaFactor;
    const committed = self.committedUntilTick > this.tick;
    const mobility = committed ? 0.2 : 1.0;
    const foot = self.attr.footSpeedMps * sf * mobility;

    // Radial: proportional controller toward the preferred range.
    const err = dist - t.rangeM;
    const radial = clamp(err * 3, -1, 1) * foot;
    // Lateral: circle, switching direction now and then (seeded).
    if (this.rng() < 0.25 * DT) self.circleDir = -self.circleDir;
    const lateral = t.lateral * foot * self.circleDir;

    self.vel.x = ux * radial + px * lateral;
    self.vel.y = uy * radial + py * lateral;
    self.pos.x = clamp(self.pos.x + self.vel.x * DT, -RING_HALF_M + BODY_RADIUS_M, RING_HALF_M - BODY_RADIUS_M);
    self.pos.y = clamp(self.pos.y + self.vel.y * DT, -RING_HALF_M + BODY_RADIUS_M, RING_HALF_M - BODY_RADIUS_M);

    // Gas: footwork costs a little, rest regenerates when not punching.
    const speed = Math.sqrt(self.vel.x * self.vel.x + self.vel.y * self.vel.y);
    self.gas -= speed * 0.04 * DT;
    if (!committed) self.gas += self.attr.gasRegenPerS * t.gasRegen * DT;
    self.gas = clamp(self.gas, 0, self.attr.maxGas);
  }

  /** Bodies can't overlap; push both apart equally (a clinch break). */
  _separate(a, b) {
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const minD = BODY_RADIUS_M * 2.2;
    if (dist >= minD) return;
    const push = (minD - dist) / 2;
    const ux = dx / dist, uy = dy / dist;
    a.pos.x -= ux * push; a.pos.y -= uy * push;
    b.pos.x += ux * push; b.pos.y += uy * push;
  }

  // ── offence ──

  _decide(self, opp) {
    if (this.tick < self.nextActionTick || self.committedUntilTick > this.tick) return;
    const t = self.tactic;
    const dx = opp.pos.x - self.pos.x, dy = opp.pos.y - self.pos.y;
    const gapM = Math.sqrt(dx * dx + dy * dy) - GUARD_OFFSET_M - TARGET_DEPTH_M;

    // Only punches that can physically reach are candidates.
    const options = {};
    for (const type in PUNCHES) {
      const w = t.weights[type] ?? 0;
      if (w > 0 && gapM * PUNCHES[type].pathFactor <= self.reachM * PUNCHES[type].reachFactor) options[type] = w;
    }
    if (Object.keys(options).length === 0) return;

    // A slip opened a counter window: fire at once if the tactic wants to.
    const isCounter = self.counterUntilTick > this.tick && this.rng() < t.counter;
    const attemptsPerS = t.aggression * (0.5 + 0.5 * self.staminaFactor);
    if (!isCounter && this.rng() >= attemptsPerS * DT) return;

    const type = weightedPick(options, this.rng);
    this._launch(self, opp, type, isCounter);
  }

  _launch(attacker, defender, type, isCounter) {
    const p = computePunch({ attacker, defender, type, tick: this.tick, rng: this.rng, isCounter });
    const pd = PUNCHES[type];

    attacker.gas = Math.max(0, attacker.gas - pd.gasCost * (1 + attacker.stats.power / 200));
    attacker.committedUntilTick = p.arriveTick + Math.ceil(pd.recoveryMs / TICK_MS);
    const chains = this.rng() < attacker.tactic.combo;
    const gapTicks = chains ? 0 : Math.ceil((150 + this.rng() * 350) / TICK_MS);
    attacker.nextActionTick = attacker.committedUntilTick + gapTicks;
    attacker.counterUntilTick = 0;
    attacker.recentPunches.push(type);
    if (attacker.recentPunches.length > 6) attacker.recentPunches.shift();
    attacker.activePunch = { type, launchTick: p.launchTick, arriveTick: p.arriveTick, outcome: p.outcome };

    if (!this.exchange) {
      this.exchange = { id: ++this.exchangeSeq, startTick: this.tick, initiator: attacker.corner, punches: [] };
    }
    this.exchange.lastTick = this.tick;
    this.pending.push(p);
  }

  /** Applies every punch whose fist arrives this tick. */
  _resolveArrivals() {
    if (this.pending.length === 0) return;
    const due = [], still = [];
    for (const p of this.pending) (p.arriveTick <= this.tick ? due : still).push(p);
    this.pending = still;

    for (const p of due) {
      const atk = this.fighters[p.attacker], def = this.fighters[p.defender];
      let damage = 0;
      if (p.outcome === 'landed') {
        damage = (p.transferredJoules / DAMAGE_DIVISOR) * (p.target === 'body' ? 0.55 : 1.0);
        def.gas = Math.max(0, def.gas - p.transferredJoules / (p.target === 'body' ? 60 : 120));
      } else if (p.outcome === 'blocked') {
        damage = p.transferredJoules / DAMAGE_DIVISOR;
        def.gas = Math.max(0, def.gas - p.transferredJoules / 100);
      } else {
        // A clean slip opens a counter window scaled by the defender's Ring IQ.
        def.counterUntilTick = this.tick + Math.ceil((120 + 280 * def.attr.readSkill) / TICK_MS);
      }
      def.health = Math.max(0, def.health - damage);
      if (atk.activePunch && atk.activePunch.launchTick === p.launchTick) atk.activePunch = null;

      const record = { ...p, damage, resolvedTick: this.tick, healthAfter: { red: this.fighters.red.health, blue: this.fighters.blue.health }, gasAfter: { red: this.fighters.red.gas, blue: this.fighters.blue.gas } };
      if (this.exchange) { this.exchange.punches.push(record); this.exchange.lastTick = this.tick; }
      this._emit('impact', record);

      if (def.health <= 0) { this._endRound('ko', atk.corner); return; }
    }
  }

  _closeExchangeIfIdle(force = false) {
    const ex = this.exchange;
    if (!ex) return;
    const idle = (this.tick - ex.lastTick) * TICK_MS >= EXCHANGE_IDLE_MS;
    if (!force && (!idle || this.pending.length > 0)) return;
    ex.endTick = this.tick;
    this.exchange = null;
    if (ex.punches.length === 0) return;
    const json = serializeExchange(ex, this);
    this.roundTelemetry.push(json);
    this._emit('exchange', json);
  }

  // ── round and fight end ──

  _endRound(reason, koWinner = null) {
    this.pending = [];
    this._closeExchangeIfIdle(true);
    const summary = summarizeRound(this, reason, koWinner);
    this.rounds.push(summary);
    this._emit('round_end', summary);

    if (reason === 'ko' || this.roundIndex >= this.totalRounds) {
      this.phase = 'fight_over';
      this.result = scoreFight(this, reason === 'ko' ? koWinner : null);
      this._emit('fight_end', this.result);
    } else {
      this.phase = 'round_over';
    }
  }

  /** Light-weight view of live state for renderers. */
  snapshot() {
    const f = (m) => ({ corner: m.corner, x: m.pos.x, y: m.pos.y, vx: m.vel.x, vy: m.vel.y, health: m.health, gasRatio: m.gasRatio, activePunch: m.activePunch, tactic: m.tacticKey });
    return { tick: this.tick, tMs: this.tMs, round: this.roundIndex, phase: this.phase, red: f(this.fighters.red), blue: f(this.fighters.blue) };
  }
}

// ─── Telemetry serializers ──────────────────────────────────────────────────

/** One punch → a flat, rounded JSON object. */
export function serializePunch(p) {
  return {
    t_ms: round(p.launchTick * TICK_MS, 2),
    arrive_ms: round(p.arriveTick * TICK_MS, 2),
    attacker: p.attacker, defender: p.defender, punch: p.type, target: p.target, counter: p.isCounter,
    distance_vector: { dx_m: round(p.distanceVector.dx), dy_m: round(p.distanceVector.dy), magnitude_m: round(p.distanceVector.magnitudeM) },
    velocities_mps: {
      attacker: { vx: round(p.velocities.attacker.vx), vy: round(p.velocities.attacker.vy) },
      defender: { vx: round(p.velocities.defender.vx), vy: round(p.velocities.defender.vy) },
    },
    travel_distance_m: round(p.travelDistanceM),
    punch_velocity_mps: round(p.punchVelocityMps),
    stamina_factor: round(p.staminaFactor),
    telegraph_ms: round(p.telegraphMs, 2),
    flight_ms: round(p.flightMs, 2),
    travel_time_ms: round(p.travelTimeMs, 2),
    reaction_window_ms: round(p.reaction.windowMs, 2),
    reaction_breakdown_ms: {
      perception: round(p.reaction.perceptionMs, 2), motor: round(p.reaction.motorMs, 2),
      committed: round(p.reaction.committedMs, 2), fatigue: round(p.reaction.fatiguePenaltyMs, 2),
      anticipation: round(p.reaction.anticipationMs, 2), jitter: round(p.reaction.jitterMs, 2),
    },
    on_ropes: p.onRopes,
    margin_ms: round(p.marginMs, 2),
    outcome: p.outcome,
    effective_mass_kg: round(p.effectiveMassKg),
    kinetic_energy_j: round(p.kineticJoules, 2),
    transferred_energy_j: round(p.transferredJoules, 2),
    damage: round(p.damage, 3),
    health_after: { red: round(p.healthAfter.red, 2), blue: round(p.healthAfter.blue, 2) },
    gas_after: { red: round(p.gasAfter.red, 2), blue: round(p.gasAfter.blue, 2) },
  };
}

/** Per-corner totals over a list of serialized punches. */
function cornerTotals(punches, corner) {
  const mine = punches.filter((p) => p.attacker === corner);
  const landed = mine.filter((p) => p.outcome === 'landed');
  const sum = (arr, k) => arr.reduce((s, p) => s + p[k], 0);
  return {
    thrown: mine.length,
    landed: landed.length,
    blocked: mine.filter((p) => p.outcome === 'blocked').length,
    slipped: mine.filter((p) => p.outcome === 'slipped').length,
    land_rate: mine.length ? round(landed.length / mine.length) : 0,
    joules_landed: round(sum(mine, 'transferred_energy_j'), 2),
    damage_dealt: round(sum(mine, 'damage'), 3),
    avg_travel_ms: mine.length ? round(sum(mine, 'travel_time_ms') / mine.length, 2) : 0,
    avg_reaction_ms: mine.length ? round(sum(mine, 'reaction_window_ms') / mine.length, 2) : 0,
    avg_margin_ms: mine.length ? round(sum(mine, 'margin_ms') / mine.length, 2) : 0,
    avg_velocity_mps: mine.length ? round(sum(mine, 'punch_velocity_mps') / mine.length) : 0,
  };
}

/**
 * The telemetry serializer: bundles one finished exchange into structured
 * JSON. Called by the simulation at the end of every exchange.
 */
export function serializeExchange(ex, sim) {
  const punches = ex.punches.map(serializePunch);
  return {
    schema: 'bm.exchange.v1',
    match_id: sim.matchId,
    round_index: sim.roundIndex,
    exchange_id: ex.id,
    start_ms: round(ex.startTick * TICK_MS, 2),
    end_ms: round(ex.endTick * TICK_MS, 2),
    duration_ms: round((ex.endTick - ex.startTick) * TICK_MS, 2),
    initiator: ex.initiator,
    tactics: { red: sim.fighters.red.tacticKey, blue: sim.fighters.blue.tacticKey },
    punches,
    totals: { red: cornerTotals(punches, 'red'), blue: cornerTotals(punches, 'blue') },
  };
}

/** Round summary: 10-point-must scoring on energy landed plus clean shots. */
function summarizeRound(sim, reason, koWinner) {
  const all = sim.roundTelemetry.flatMap((e) => e.punches);
  const totals = { red: cornerTotals(all, 'red'), blue: cornerTotals(all, 'blue') };
  const score = (t) => t.joules_landed + 25 * t.landed;
  const sr = score(totals.red), sb = score(totals.blue);
  const winner = reason === 'ko' ? koWinner : Math.abs(sr - sb) < 1e-9 ? 'even' : sr > sb ? 'red' : 'blue';
  const cards = { red: winner === 'blue' ? 9 : 10, blue: winner === 'red' ? 9 : 10 };
  return {
    schema: 'bm.round.v1',
    match_id: sim.matchId,
    round_index: sim.roundIndex,
    reason, winner, cards,
    duration_ms: round(sim.tick * TICK_MS, 2),
    corner_actions: { ...sim.cornerActions },
    totals,
    end_state: {
      red: { health: round(sim.fighters.red.health, 2), gas_ratio: round(sim.fighters.red.gasRatio) },
      blue: { health: round(sim.fighters.blue.health, 2), gas_ratio: round(sim.fighters.blue.gasRatio) },
    },
    exchanges: sim.roundTelemetry,
  };
}

function scoreFight(sim, koWinner) {
  const cards = { red: 0, blue: 0 };
  for (const r of sim.rounds) { cards.red += r.cards.red; cards.blue += r.cards.blue; }
  let winner = koWinner;
  let method = koWinner ? `KO in round ${sim.roundIndex}` : 'Decision';
  if (!winner) winner = cards.red === cards.blue ? 'draw' : cards.red > cards.blue ? 'red' : 'blue';
  if (winner === 'draw') method = 'Draw';
  return { match_id: sim.matchId, winner, method, cards, rounds: sim.rounds.length };
}

/** Swaps red/blue so a summary can be read from the other corner. */
export { other as opposingCorner };

// ─── Phaser layer (lazy) ────────────────────────────────────────────────────

let phaserClasses = null;

/**
 * Builds the Phaser classes on first use. They extend Phaser base classes,
 * which only exist once Phaser has loaded, so they can't sit at module top level.
 */
export function getPhaserClasses(Phaser = globalThis.Phaser) {
  if (phaserClasses) return phaserClasses;
  if (!Phaser) throw new Error('Phaser 3 is not loaded (expected globalThis.Phaser).');

  /** A fighter sprite bound to a FighterModel. Stats live on `model.stats`. */
  class Fighter extends Phaser.GameObjects.Container {
    constructor(scene, model, pxPerM) {
      super(scene, 0, 0);
      this.model = model;
      this.pxPerM = pxPerM;
      const r = BODY_RADIUS_M * pxPerM;
      this.torso = scene.add.circle(0, 0, r, model.color).setStrokeStyle(2, 0x000000, 0.4);
      this.glove = scene.add.circle(0, 0, r * 0.42, 0xffffff).setStrokeStyle(2, model.color);
      this.label = scene.add.text(0, -r - 16, model.name, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);
      this.flash = scene.add.circle(0, 0, r * 1.25, 0xffd84d, 0).setBlendMode(Phaser.BlendModes.ADD);
      this.add([this.flash, this.torso, this.glove, this.label]);
      scene.add.existing(this);
    }

    /** Copies physics state into screen space. */
    syncFromModel(opp, tick, toScreen) {
      const m = this.model;
      const { x, y } = toScreen(m.pos.x, m.pos.y);
      this.setPosition(x, y);
      // Glove sits on the guard line, and extends toward the target in flight.
      const dx = opp.pos.x - m.pos.x, dy = opp.pos.y - m.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      let ext = GUARD_OFFSET_M;
      const ap = m.activePunch;
      if (ap) {
        const k = clamp((tick - ap.launchTick) / Math.max(1, ap.arriveTick - ap.launchTick), 0, 1);
        ext = GUARD_OFFSET_M + k * k * Math.max(0, d - GUARD_OFFSET_M - TARGET_DEPTH_M);
      }
      this.glove.setPosition((dx / d) * ext * this.pxPerM, (dy / d) * ext * this.pxPerM);
      this.torso.setAlpha(0.55 + 0.45 * (m.health / 100));
    }

    hitFlash(strength) {
      this.flash.setAlpha(clamp(strength, 0.2, 0.9));
      this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 220 });
    }
  }

  /** Steps the simulation at a fixed rate and draws it. */
  class BoxingScene extends Phaser.Scene {
    constructor() { super('BoxingScene'); }

    init(data) {
      this.sim = data.sim;
      this.timeScale = data.timeScale ?? 1;       // 1 = real time; >1 fast-forward
      this.maxStepsPerFrame = data.maxStepsPerFrame ?? 4000;
      this.acc = 0;
    }

    create() {
      const { width, height } = this.scale;
      const ringPx = Math.min(width, height) - 20;
      this.pxPerM = ringPx / (RING_HALF_M * 2);
      const cx = width / 2, cy = height / 2;
      this.toScreen = (x, y) => ({ x: cx + x * this.pxPerM, y: cy + y * this.pxPerM });

      const g = this.add.graphics();
      g.fillStyle(0x1b2a3a, 1).fillRect(cx - ringPx / 2, cy - ringPx / 2, ringPx, ringPx);
      g.lineStyle(3, 0xd9d9d9, 0.9).strokeRect(cx - ringPx / 2, cy - ringPx / 2, ringPx, ringPx);
      g.lineStyle(1, 0xffffff, 0.08);
      for (let m = -RING_HALF_M + 1; m < RING_HALF_M; m++) {
        g.lineBetween(cx + m * this.pxPerM, cy - ringPx / 2, cx + m * this.pxPerM, cy + ringPx / 2);
        g.lineBetween(cx - ringPx / 2, cy + m * this.pxPerM, cx + ringPx / 2, cy + m * this.pxPerM);
      }

      this.sprites = {
        red: new Fighter(this, this.sim.fighters.red, this.pxPerM),
        blue: new Fighter(this, this.sim.fighters.blue, this.pxPerM),
      };
      this.distanceLine = this.add.graphics();
      this.hud = this.add.text(10, 8, '', { fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#cfd8e3' });

      this._offImpact = this.sim.on('impact', (p) => {
        if (p.outcome === 'landed') this.sprites[p.defender].hitFlash(p.transferredJoules / 250);
      });
      this.events.once('shutdown', () => this._offImpact());
      this._sync();
    }

    update(_time, deltaMs) {
      if (this.sim.phase === 'running') {
        this.acc += deltaMs * this.timeScale;
        let steps = Math.floor(this.acc / TICK_MS);
        if (steps > this.maxStepsPerFrame) { steps = this.maxStepsPerFrame; this.acc = 0; }
        else this.acc -= steps * TICK_MS;
        for (let i = 0; i < steps && this.sim.phase === 'running'; i++) this.sim.step();
      } else {
        this.acc = 0;
      }
      this._sync();
    }

    _sync() {
      const { red, blue } = this.sim.fighters;
      this.sprites.red.syncFromModel(blue, this.sim.tick, this.toScreen);
      this.sprites.blue.syncFromModel(red, this.sim.tick, this.toScreen);
      const a = this.toScreen(red.pos.x, red.pos.y), b = this.toScreen(blue.pos.x, blue.pos.y);
      this.distanceLine.clear().lineStyle(1, 0xffffff, 0.25).lineBetween(a.x, a.y, b.x, b.y);
      const dx = blue.pos.x - red.pos.x, dy = blue.pos.y - red.pos.y;
      const s = this.sim;
      const clock = (s.tick * TICK_MS) / 1000;
      this.hud.setText(
        `R${s.roundIndex}  ${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}  ` +
        `d=${Math.sqrt(dx * dx + dy * dy).toFixed(2)} m  ×${this.timeScale}`
      );
    }
  }

  phaserClasses = { Fighter, BoxingScene };
  return phaserClasses;
}

/**
 * Creates a Phaser game that drives `sim`.
 * headless: true uses Phaser.HEADLESS (no canvas). The loop still steps the
 * simulation, which is useful for a hidden tab running background bouts.
 */
export function createPhysicsGame({ parent, sim, headless = false, width = 480, height = 480, timeScale = 1, Phaser = globalThis.Phaser }) {
  const { BoxingScene } = getPhaserClasses(Phaser);
  const game = new Phaser.Game({
    type: headless ? Phaser.HEADLESS : Phaser.AUTO,
    parent, width, height,
    backgroundColor: '#0e1620',
    banner: false,
    audio: { noAudio: true },
    scale: headless ? undefined : { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add('BoxingScene', BoxingScene, true, { sim, timeScale });
  return {
    game,
    /** Change simulation speed. Determinism doesn't depend on it. */
    setTimeScale(v) { const s = game.scene.getScene('BoxingScene'); if (s) s.timeScale = v; },
    destroy() { game.destroy(true); },
  };
}
