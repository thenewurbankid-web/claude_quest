// Boxing Manager AI: street swagger for the 3D fighters. Pure maths, no WebGL. Render-only and cosmetic: it is driven by
// sim events and snapshots (a clean landing, a slipped punch, the bell, a KO) and never writes back, so P2P lockstep holds.
// Everything is a slow, wide curve (about 2 Hz at the very most): attitude, not twitch.

/** Per-tactic body language. Offsets are additive on the base guard: crouch/toe in metres (hips), the rest in radians or metres as named. */
export const STYLES = Object.freeze({
  //                 crouch toe    lean  philly square chinUp bounce roll  leadLow leadOut
  pressure:     { crouch: 0.035, toe: 0,     lean: 0.05, philly: 0,    square: 0,    chinUp: 0,    bounce: 0.6, roll: 1,   leadLow: 0.01, leadOut: 0 },      // stalks, low and heavy
  body_attack:  { crouch: 0.04,  toe: 0,     lean: 0.05, philly: 0,    square: 0,    chinUp: 0,    bounce: 0.6, roll: 0.9, leadLow: 0,    leadOut: 0 },
  outbox:       { crouch: 0,     toe: 0.016, lean: 0,    philly: 0,    square: 0,    chinUp: 0.01, bounce: 1.3, roll: 1,   leadLow: 0.05, leadOut: 0.05 },   // dances light, loose lead hand
  counter:      { crouch: 0,     toe: 0.008, lean: -0.03, philly: 0.07, square: 0,    chinUp: 0,    bounce: 0.9, roll: 0.8, leadLow: 0.06, leadOut: 0.03 },   // Philly-shell lean back
  recover:      { crouch: 0,     toe: 0,     lean: 0,    philly: 0,    square: 0,    chinUp: 0,    bounce: 0.7, roll: 0.7, leadLow: 0.02, leadOut: 0 },
  brawl:        { crouch: 0.01,  toe: 0,     lean: 0.02, philly: 0,    square: 0.18, chinUp: 0.06, bounce: 1,   roll: 1.8, leadLow: 0.02, leadOut: 0 },      // square, rolling shoulders, chin up
  dirty_boxing: { crouch: 0.03,  toe: 0,     lean: 0.08, philly: 0.03, square: 0,    chinUp: 0,    bounce: 0.8, roll: 0.8, leadLow: 0,    leadOut: -0.03 },  // leans and stays close
});
const STYLE_KEYS = Object.keys(STYLES.outbox);
export const styleOf = (tactic) => STYLES[tactic] ?? STYLES.outbox;

/** Idle beat: about 90 BPM (1.5 Hz) in rad/s. */
export const BEAT_RAD = 2 * Math.PI * 1.5;

/** Beats: how long each lasts (s). A beat is a smooth envelope 0 -> 1 -> 0; `u` is its progress. */
export const BEATS = Object.freeze({
  nod: 0.9, tilt: 1.2, shrug: 0.9, touch: 1.4, low: 1.5, shimmy: 1.8, neck: 2.2, adjust: 1.6,
});
const GAP = 3.5;          // s of quiet between any two beats
const KIND_GAP = 9;       // s before the same beat may repeat
const WAIT = 1.4;         // a cue that cannot start (mid-exchange) is dropped after this long
const smooth = (t) => t * t * (3 - 2 * t);

export class Swag {
  constructor(seed = 1) {
    let a = (seed >>> 0) || 1;
    this.rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // Each fighter's own beat phase, and a lopsided guard: one hand a touch lower and wider, constant for the fighter.
    this.beatPhase = this.rnd() * 6.283;
    this.asym = { low: 0.015 + 0.03 * this.rnd(), side: this.rnd() < 0.5 ? -1 : 1, out: 0.01 + 0.025 * this.rnd() };
    this.style = Object.fromEntries(STYLE_KEYS.map((k) => [k, STYLES.outbox[k]]));
    this.styleReady = false;
    this.pending = []; this.active = null; this.last = {}; this.lastEnd = -99;
    this.nextIdle = 6 + this.rnd() * 6;
    this.walk = 0; this.strut = 0;
    this.started = 0;
    this.fx = { nod: 0, tilt: 0, shrug: 0, touch: 0, low: 0, shimmy: 0, neck: 0, adjust: 0, u: 0, side: 1, walk: 0, strut: 0 };
  }

  /** Asks for a beat. `force` skips the quiet gap (the bell), otherwise it waits for a calm moment. */
  cue(kind, time, force = false) {
    if (!(kind in BEATS)) return;
    if (!force && this.rnd() > 0.55) return;     // not every landing earns a nod
    this.pending.push({ kind, at: time, force });
  }

  /** busy: a punch, clinch, shell, taunt or hit in progress. mode: 'fight' | 'bell' (between rounds) | 'won' (KO winner) | 'down'. */
  update(time, dt, { busy = false, tactic = 'outbox', mode = 'fight' } = {}) {
    const target = styleOf(tactic), k = this.styleReady ? 1 - Math.exp(-dt * 1.2) : 1;
    this.styleReady = true;
    for (const key of STYLE_KEYS) this.style[key] += (target[key] - this.style[key]) * k;

    const fx = this.fx;
    if (this.active) {
      const u = (time - this.active.t0) / BEATS[this.active.kind];
      if (u >= 1) { this.lastEnd = time; this.active = null; } else { fx.u = u; fx[this.active.kind] = smooth(Math.min(1, u * 2.5)) * smooth(Math.min(1, (1 - u) * 2.5)); }
    }
    for (const kind of Object.keys(BEATS)) if (this.active?.kind !== kind) fx[kind] = 0;
    // Pending cues: oldest valid one starts when calm; the rest of a burst is dropped.
    this.pending = this.pending.filter((p) => time - p.at < WAIT || p.force);
    const calm = !busy && mode !== 'down';
    if (!this.active && calm) {
      const i = this.pending.findIndex((p) => (p.force || time - this.lastEnd > GAP) && (time - (this.last[p.kind] ?? -99) > KIND_GAP || p.force));
      if (i >= 0) { this.start(this.pending[i].kind, time); this.pending.length = 0; }
      else if (time >= this.nextIdle && time - this.lastEnd > GAP) { this.start(this.rnd() < 0.5 ? 'neck' : 'adjust', time); this.nextIdle = time + 8 + this.rnd() * 7; }
    }
    // Slow state beats: walking to the corner at the bell, and the winner's walk-off after a KO.
    const wk = mode === 'bell' ? 1 : 0, st = mode === 'won' ? 1 : 0;
    this.walk += (wk - this.walk) * (1 - Math.exp(-dt * (wk ? 0.7 : 4)));
    this.strut += (st - this.strut) * (1 - Math.exp(-dt * (st ? 0.8 : 4)));
    fx.walk = this.walk; fx.strut = this.strut;
    return fx;
  }

  start(kind, time) {
    this.active = { kind, t0: time }; this.last[kind] = time;
    this.fx.side = this.rnd() < 0.5 ? -1 : 1;     // which way the head tilts or the neck rolls
  }
}
