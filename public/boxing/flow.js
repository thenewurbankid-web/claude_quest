// Game flow rules with no DOM: screen transitions, progression, unlocks, scorecards, corner tips, settings.
// index.html draws them; test/boxing.test.js pins them.

export const SCREENS = ['title', 'settings', 'fighter', 'upgrade', 'opponent', 'fight', 'result', 'career', 'card', 'gym'];

const EDGES = {
  title:    { career: 'career', play: 'fighter', continue: 'opponent', settings: 'settings' },
  settings: { back: 'title' },
  fighter:  { fight: 'opponent', train: 'upgrade', back: 'title' },
  upgrade:  { back: 'fighter', fight: 'opponent' },
  opponent: { start: 'fight', back: 'fighter' },
  fight:    { finished: 'result', quit: 'title' },
  result:   { rematch: 'fight', opponent: 'opponent', train: 'upgrade', title: 'title', career: 'career' },
  career:   { fight: 'card', gym: 'gym', fighter: 'fighter', back: 'title' },
  card:     { accept: 'fight', decline: 'career', back: 'career' },
  gym:      { back: 'career' },
};

/** The screen an event leads to. Throws on an event the screen doesn't have, so a wrong button is a loud bug. */
export function navigate(screen, event) {
  const next = EDGES[screen]?.[event];
  if (!next) throw new Error(`No "${event}" from the ${screen} screen`);
  return next;
}
export const eventsFrom = (screen) => Object.keys(EDGES[screen] ?? {});

// ─── Progression ────────────────────────────────────────────────────────────

/** Training points for +1 on a stat at value v: 1 under 60, 2 under 80, then 3. */
export const statCost = (v) => (v < 60 ? 1 : v < 80 ? 2 : 3);

export const REWARDS = { w: 6, d: 4, l: 3 };
export const outcomeOf = (winner, corner) => (winner === 'draw' ? 'd' : winner === corner ? 'w' : 'l');

/** Outfit pieces that unlock at a number of wins. Everything else is free from the start. */
export const UNLOCKS = [
  { wins: 1, key: 'topStyle', value: 'varsity', label: 'Varsity jacket' },
  { wins: 2, key: 'jeans', value: '#1d1e22', label: 'Black jeans' },
  { wins: 3, key: 'topStyle', value: 'hoodie', label: 'Knit sweater' },
  { wins: 4, key: 'top', value: '#c9a227', label: 'Gold top' },
  { wins: 5, key: 'wraps', value: '#d9a12b', label: 'Gold wraps' },
];

/** The unlock that gates look[key] === value, or null if that choice is free. */
export const unlockFor = (key, value) => UNLOCKS.find((u) => u.key === key && u.value === value) ?? null;
export const isUnlocked = (key, value, wins) => { const u = unlockFor(key, value); return !u || wins >= u.wins; };

/** A look with every still-locked choice put back to `base`'s, so a stale or edited save can't wear what it hasn't won. */
export function lockedLook(look, wins, base) {
  const out = { ...look };
  for (const u of UNLOCKS) if (out[u.key] === u.value && wins < u.wins) out[u.key] = base[u.key];
  return out;
}

/** Unlocks earned by going from `before` wins to `after` wins. */
export const newUnlocks = (before, after) => UNLOCKS.filter((u) => u.wins > before && u.wins <= after);

// ─── Fight read-outs ────────────────────────────────────────────────────────

/** Round-by-round scorecard from sim.rounds (each has .cards {red, blue}) plus the totals. */
export function scorecard(rounds) {
  const rows = rounds.map((r) => ({ round: r.round_index, red: r.cards.red, blue: r.cards.blue, ko: r.reason === 'ko' }));
  return { rows, total: { red: rows.reduce((s, r) => s + r.red, 0), blue: rows.reduce((s, r) => s + r.blue, 0) } };
}

/** Landed / thrown punches and energy delivered per corner, summed over the rounds. */
export function fightStats(rounds) {
  const zero = () => ({ landed: 0, thrown: 0, joules: 0 });
  const out = { red: zero(), blue: zero() };
  for (const r of rounds) for (const c of ['red', 'blue']) {
    out[c].landed += r.totals[c].landed;
    out[c].thrown += r.totals[c].thrown;
    out[c].joules += r.totals[c].joules_landed;
  }
  return out;
}

/**
 * The AI corner's pick for a round, with the rule that fired. It is a fixed rule on stamina, health and the stat matchup:
 * it does not read the other corner's tactic and does not query the fight log. `me`/`opp` are { health, gasRatio, stats }.
 */
export function aiPlan(me, opp, roundIndex, seed) {
  if (me.gasRatio < 0.35) return { tactic: 'recover', reason: 'It was gassed, so it took the round to recover.' };
  if (opp.gasRatio < 0.45) return { tactic: 'pressure', reason: 'You were tiring, so it pressed.' };
  if (opp.health < me.health - 25) return { tactic: 'pressure', reason: 'You were hurt, so it pressed.' };
  if (opp.stats.power > me.stats.power + 15) {
    return me.stats.ringIQ >= 55
      ? { tactic: 'counter', reason: 'You hit harder, and it reads well enough to counter.' }
      : { tactic: 'outbox', reason: 'You hit harder, and it cannot read well enough to counter, so it kept range.' };
  }
  if (opp.stats.stamina < me.stats.stamina - 10) return { tactic: 'body_attack', reason: 'You have less stamina, so it went to the body.' };
  if (me.stats.speed > opp.stats.speed + 10) return { tactic: 'outbox', reason: 'It is quicker, so it boxed from range.' };
  return { tactic: ['pressure', 'outbox', 'counter', 'body_attack'][(roundIndex + seed) % 4], reason: 'An even matchup: it rotates its plan each round.' };
}

export const PUNCH_TYPES = ['jab', 'cross', 'hook', 'uppercut', 'body'];

/** Thrown/landed per punch type and per round, from the sim's round summaries. */
export function punchBreakdown(rounds) {
  const zero = () => Object.fromEntries(PUNCH_TYPES.map((t) => [t, { thrown: 0, landed: 0 }]));
  const byType = { red: zero(), blue: zero() };
  const perRound = rounds.map((r) => {
    for (const e of r.exchanges) for (const p of e.punches) {
      const slot = byType[p.attacker][p.punch];
      if (!slot) continue;
      slot.thrown += 1;
      if (p.outcome === 'landed') slot.landed += 1;
    }
    const side = (c) => ({ thrown: r.totals[c].thrown, landed: r.totals[c].landed, rate: r.totals[c].land_rate, dealt: r.totals[c].damage_dealt });
    return { round: r.round_index, red: side('red'), blue: side('blue') };
  });
  return { byType, perRound };
}

/** Body zones for the damage silhouette. The sim records only a punch's target (head/body) and outcome, so a blocked shot is the guard zone. */
export const DAMAGE_ZONES = ['head', 'body', 'guard'];
export const zoneOf = (p) => (p.outcome === 'landed' ? (p.target === 'body' ? 'body' : 'head') : p.outcome === 'blocked' ? 'guard' : null);

const zoneZero = () => ({ head: { damage: 0, hits: 0 }, body: { damage: 0, hits: 0 }, guard: { damage: 0, hits: 0 } });
export const emptyDamage = () => ({ red: zoneZero(), blue: zoneZero() });

/** Adds one impact record to the damage tally of the corner that took it. Returns the zone it hit, or null for a slip. */
export function recordDamage(dmg, p) {
  const z = zoneOf(p);
  if (!z) return null;
  const slot = dmg[p.defender][z];
  slot.damage += p.damage;
  slot.hits += 1;
  return z;
}

/** 0..1 intensity for tinting a zone; any damage shows, 20 health points is full. */
export const zoneHeat = (damage) => (damage > 0 ? Math.min(1, 0.25 + damage / 20) : 0);

/**
 * One line from the corner and the tactic it points to. `me`/`opp` are { health, gasRatio, stats }.
 * `precedent` is the best past winner from the fight log, if any ({ tactic, label }).
 */
export function cornerTip(me, opp, precedent = null) {
  if (me.gasRatio < 0.35) return { tip: 'You are gassed. Take a round to recover.', tactic: 'recover' };
  if (me.health < 35) return { tip: 'You are hurt. Stay outside and survive.', tactic: 'outbox' };
  if (opp.health < 35) return { tip: 'He is hurt. Go and finish it.', tactic: 'pressure' };
  if (opp.gasRatio < 0.45) return { tip: 'He is tiring. Press him now.', tactic: 'pressure' };
  if (precedent) return { tip: `${precedent.label} worked last time against a fighter like this.`, tactic: precedent.tactic };
  if (opp.stats.power > me.stats.power + 15) return { tip: 'He hits hard. Slip it and counter.', tactic: 'counter' };
  if (opp.stats.stamina < me.stats.stamina - 10) return { tip: 'He will fade. Work the body.', tactic: 'body_attack' };
  if (me.stats.speed > opp.stats.speed + 10) return { tip: 'You are quicker. Jab and move.', tactic: 'outbox' };
  return { tip: 'Even fight. Pick your moment.', tactic: 'outbox' };
}

export const TACTIC_BLURB = {
  pressure: 'Close in, throw hooks',
  outbox: 'Jab from range',
  counter: 'Slip and return fire',
  body_attack: 'Dig to the ribs',
  recover: 'Catch your breath',
  brawl: 'Swing wild, street style',
  dirty_boxing: 'Clinch and work inside',
};

// ─── Settings ───────────────────────────────────────────────────────────────

export const SPEEDS = { 1: 'Real time', 2: '2×', 4: 'Fast 4×' };
export const DEFAULT_SETTINGS = { sfx: true, music: false, time: 'day', speed: 4 };

/** Settings from localStorage or anywhere else: unknown keys dropped, bad values replaced by the defaults. */
export function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    sfx: typeof o.sfx === 'boolean' ? o.sfx : DEFAULT_SETTINGS.sfx,
    music: typeof o.music === 'boolean' ? o.music : DEFAULT_SETTINGS.music,
    time: o.time === 'night' ? 'night' : 'day',
    speed: Number(o.speed) in SPEEDS ? Number(o.speed) : DEFAULT_SETTINGS.speed,
  };
}
