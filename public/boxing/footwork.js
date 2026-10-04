// Boxing Manager AI: foot planting for the 3D view. Pure maths, no WebGL. Render-only: it reads the sim's position and
// velocity and never writes back. A planted foot is locked to a world point (the leg IK holds it there, so it cannot
// skate); a foot that falls too far from its stance spot lifts, drags a short low step toward where the body is going,
// and plants again. A boxer holds still in stance: a foot lifts only when the body has drifted about a third of the stance
// width away from it, lands past its spot so one step buys a long hold, and the back foot follows (step-drag). At most ~2 steps a second.

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const ease = (t) => t * t * (3 - 2 * t);

export const FOOTWORK = {
  stanceWidth: 0.31,       // m between the feet sideways (the stance this was tuned for)
  leadFrac: 0.75,          // lag, as a share of stance width, before the lead foot lifts (~23 cm: hips and knees absorb the rest)
  trailFrac: 0.85,         // the back foot tolerates more
  followFrac: 0.3,         // once the lead foot has landed, a back foot this far behind follows it (step-drag)
  yawWeight: 0.12,         // metres of "lag" per radian the foot is turned away from the body
  emergencyFrac: 1.1,      // past this share of stance width a foot steps whatever the cadence limit or the other foot says
  minGap: 0.42,            // s between step groups (about 2 foot steps a second at the very most)
  cooldown: 0.3,           // s after landing before the same foot may lift again (hysteresis)
  overshoot: 1,            // a step lands this share of its trigger distance past the stance spot, so one step buys a long hold
  lead: 0.25,              // seconds of travel a step also overshoots by
  maxOver: 0.2,            // m, the most a step lands past its spot
  lift: 0.055,             // m, low drag steps
};

/** Critically damped follower (~12 rad/s): a low-pass for the sim's position so its jitter never reaches the feet or hips. Render-only. `v` is the filtered velocity. */
export class Smoother {
  constructor(omega = 12) { this.w = omega; this.p = null; this.v = null; this.vs = null; }
  /** target {x, z}; returns the smoothed point with the steady-state lag (2v/omega) taken back out. */
  update(t, dt) {
    if (!this.p) { this.p = { x: t.x, z: t.z }; this.v = { x: 0, z: 0 }; this.vs = { x: 0, z: 0 }; return { ...this.p }; }
    const w = this.w, n = Math.max(1, Math.ceil(dt * w / 0.5)), h = dt / n;
    for (let i = 0; i < n; i++) for (const k of ['x', 'z']) {
      const a = w * w * (t[k] - this.p[k]) - 2 * w * this.v[k];
      this.v[k] += a * h; this.p[k] += this.v[k] * h;
    }
    // The lag is taken back out with a slower copy of the velocity, so tick-level noise in it never reaches the output.
    const k = 1 - Math.exp(-dt * 4);
    for (const a of ['x', 'z']) this.vs[a] += (this.v[a] - this.vs[a]) * k;
    return { x: this.p.x + this.vs.x * 2 / w, z: this.p.z + this.vs.z * 2 / w };
  }
}

/** A scalar spring toward a target (underdamped: it overshoots a little, then settles). Render-only secondary motion. */
export class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  update(target, dt, omega = 16, zeta = 0.6) {
    const n = Math.max(1, Math.ceil(dt * omega / 0.4)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (omega * omega * (target - this.x) - 2 * zeta * omega * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

/** Slow seeded drift in [-1, 1]: a few incommensurate sines with seeded phases, so each fighter has its own wandering and loops never repeat. */
export class Drift {
  constructor(seed = 1) {
    let a = (seed >>> 0) || 1;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.rnd = rnd; this.ch = {};
  }
  /** channel name, time s, base rate rad/s (keep it at or under ~3: slow and wide). */
  at(name, t, rate = 1) {
    const c = this.ch[name] ??= [0, 1, 2].map((i) => ({ ph: this.rnd() * TAU, f: rate * (0.55 + 0.45 * i + 0.3 * this.rnd()), a: [0.6, 0.3, 0.2][i] }));
    let s = 0; for (const o of c) s += o.a * Math.sin(o.f * t + o.ph);
    return s / 1.1;
  }
}

export class Footwork {
  /** homes: { l: {x, z}, r: {x, z} } stance foot offsets in the boxer's frame (x right, z forward). */
  constructor(homes, opts = {}) {
    this.homes = homes; this.cfg = { ...FOOTWORK, ...opts };
    this.feet = null; this.steps = 0; this.clock = 0; this.lastStart = -9; this.lastLand = { l: -9, r: -9 };
    this.stepped = null;
  }

  /**
   * root {x,z} ground point (already smoothed), forward {x,z} unit, vel {x,z} m/s, dt, opts.still: how much the feet should
   * hold (1 = planted: punching, clinch, shell, taunt; stepping only past the emergency lag).
   * Returns { l, r } = { x, z, lift, yaw, planted }.
   */
  update(root, forward, vel, dt, opts = {}) {
    const c = this.cfg, f = forward, r = { x: f.z, z: -f.x };
    const bodyYaw = Math.atan2(f.x, f.z), W = c.stanceWidth;
    const home = (side) => { const h = this.homes[side]; return { x: root.x + r.x * h.x + f.x * h.z, z: root.z + r.z * h.x + f.z * h.z }; };
    this.clock += dt;
    if (!this.feet) {
      this.feet = {};
      for (const s of ['l', 'r']) this.feet[s] = { ...home(s), yaw: bodyYaw, lift: 0, planted: true, step: null };
      return this.out();
    }
    const speed = Math.hypot(vel.x, vel.z);
    const vd = speed > 0.05 ? { x: vel.x / speed, z: vel.z / speed } : null;
    const lead = vd ? (this.homes.l.x * vd.x + this.homes.l.z * vd.z) > (this.homes.r.x * vd.x + this.homes.r.z * vd.z) ? 'l' : 'r' : null;
    const hold = opts.still ? 1 + 1.5 * opts.still : 1;
    for (const s of ['l', 'r']) {
      const F = this.feet[s], other = this.feet[s === 'l' ? 'r' : 'l'], h = home(s);
      if (F.step) {
        const st = F.step;
        st.t = Math.min(1, st.t + dt / st.dur);
        const e = ease(st.t);
        // The landing spot keeps tracking the body, plus the overshoot that makes this one step a long one.
        const to = { x: h.x + st.dir.x * st.over + (vd ? vd.x : 0) * speed * c.lead, z: h.z + st.dir.z * st.over + (vd ? vd.z : 0) * speed * c.lead };
        F.x = st.from.x + (to.x - st.from.x) * e; F.z = st.from.z + (to.z - st.from.z) * e;
        F.yaw = st.yaw0 + angDiff(bodyYaw, st.yaw0) * e;
        F.lift = c.lift * Math.sin(Math.PI * st.t) * (0.6 + 0.4 * Math.min(1, speed / 1.5));
        if (st.t >= 1) { F.step = null; F.planted = true; F.lift = 0; this.lastLand[s] = this.clock; this.stepped = s; }
        continue;
      }
      const dx = h.x - F.x, dz = h.z - F.z, dist = Math.hypot(dx, dz);
      const lag = dist + c.yawWeight * Math.abs(angDiff(bodyYaw, F.yaw));
      const isLead = lead ? s === lead : s === 'l';
      let thr = (isLead ? c.leadFrac : c.trailFrac) * W * hold;
      // Step-drag: right after the other foot landed, this one follows from a smaller lag.
      const follow = this.stepped && this.stepped !== s && this.clock - this.lastLand[this.stepped] < 0.25 && !other.step;
      if (follow) thr = Math.min(thr, c.followFrac * W * hold);
      const emergency = lag > c.emergencyFrac * W * (1 + 0.6 * (opts.still ?? 0));
      const ready = this.clock - this.lastLand[s] > c.cooldown && !other.step && (this.clock - this.lastStart > c.minGap || follow);
      if ((lag > thr && ready) || emergency) {
        F.planted = false; this.steps++;
        if (!follow) this.lastStart = this.clock;
        const dir = dist > 1e-6 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 0 };
        F.step = { t: 0, from: { x: F.x, z: F.z }, yaw0: F.yaw, dir, over: Math.min(c.maxOver, c.overshoot * Math.min(lag, 0.3)), dur: Math.max(0.2, 0.28 - 0.04 * speed) };
        this.stepped = null;
      }
    }
    return this.out();
  }

  out() { return { l: this.feet.l, r: this.feet.r }; }
}
