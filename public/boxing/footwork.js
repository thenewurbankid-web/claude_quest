// Boxing Manager AI: foot planting for the 3D view. Pure maths, no WebGL. Render-only: it reads the sim's position and
// velocity and never writes back. A planted foot is locked to a world point (the leg IK holds it there, so it cannot
// skate); a foot that falls too far from its stance spot lifts, drags a short low step toward where the body is going,
// and plants again. The other foot stays down while one steps, so a boxer shuffles (lead foot first, back foot follows).

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const ease = (t) => t * t * (3 - 2 * t);

export const FOOTWORK = {
  leadThreshold: 0.07,     // m the lead foot may lag its stance spot before it steps
  trailThreshold: 0.085,    // the back foot lags more before it follows
  yawWeight: 0.2,          // metres of "lag" per radian the foot is turned away from the body
  idleSnap: 0.05,          // standing still: re-set a foot that is this far off its spot
  emergency: 0.13,         // past this a foot steps even if the other is in the air
  lead: 0.14,              // seconds of travel a step overshoots by
  lift: 0.055,             // m, low drag steps
};

export class Footwork {
  /** homes: { l: {x, z}, r: {x, z} } stance foot offsets in the boxer's frame (x right, z forward). */
  constructor(homes, opts = {}) {
    this.homes = homes; this.cfg = { ...FOOTWORK, ...opts };
    this.feet = null; this.steps = 0;
  }

  /** root {x,z} ground point, forward {x,z} unit, vel {x,z} m/s. Returns { l, r } = { x, z, lift, yaw, planted }. */
  update(root, forward, vel, dt) {
    const c = this.cfg, f = forward, r = { x: f.z, z: -f.x };
    const bodyYaw = Math.atan2(f.x, f.z);
    const home = (side) => { const h = this.homes[side]; return { x: root.x + r.x * h.x + f.x * h.z, z: root.z + r.z * h.x + f.z * h.z }; };
    if (!this.feet) {
      this.feet = {};
      for (const s of ['l', 'r']) this.feet[s] = { ...home(s), yaw: bodyYaw, lift: 0, planted: true, step: null };
      return this.out();
    }
    const speed = Math.hypot(vel.x, vel.z);
    const vd = speed > 0.05 ? { x: vel.x / speed, z: vel.z / speed } : null;
    const lead = vd ? (this.homes.l.x * vd.x + this.homes.l.z * vd.z) > (this.homes.r.x * vd.x + this.homes.r.z * vd.z) ? 'l' : 'r' : null;
    for (const s of ['l', 'r']) {
      const F = this.feet[s], other = this.feet[s === 'l' ? 'r' : 'l'], h = home(s);
      if (F.step) {
        const st = F.step;
        st.t = Math.min(1, st.t + dt / st.dur);
        const e = ease(st.t);
        // The landing spot keeps tracking the body, so a step never lands behind where it is needed.
        const to = { x: h.x + (vd ? vd.x : 0) * speed * c.lead, z: h.z + (vd ? vd.z : 0) * speed * c.lead };
        F.x = st.from.x + (to.x - st.from.x) * e; F.z = st.from.z + (to.z - st.from.z) * e;
        F.yaw = st.yaw0 + angDiff(bodyYaw, st.yaw0) * e;
        F.lift = c.lift * Math.sin(Math.PI * st.t) * (0.6 + 0.4 * Math.min(1, speed / 1.5));
        if (st.t >= 1) { F.step = null; F.planted = true; F.lift = 0; }
        continue;
      }
      const lag = Math.hypot(F.x - h.x, F.z - h.z) + c.yawWeight * Math.abs(angDiff(bodyYaw, F.yaw));
      const thr = !vd ? c.idleSnap : s === lead ? c.leadThreshold : c.trailThreshold;
      if ((lag > thr && !other.step) || lag > c.emergency) {
        F.planted = false; this.steps++;
        F.step = { t: 0, from: { x: F.x, z: F.z }, yaw0: F.yaw, dur: Math.max(0.12, 0.17 - 0.03 * speed) };
      }
    }
    return this.out();
  }

  out() { return { l: this.feet.l, r: this.feet.r }; }
}
