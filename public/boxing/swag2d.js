// BOX-36: BOX-28's swagger for the photoreal 2D sprites. Pure maths over swag.js; render-only and cosmetic, so it only
// reads sim snapshots and events. Output is a body transform about the feet plus a head transform about the neck, all
// slow curves (under ~2 Hz): no head jitter. Units: metres (scaled by the caller), radians, 1 = unchanged.
import { Swag, BEAT_RAD } from './swag.js';

const sine = Math.sin;

/** One fighter's 2D swagger: feed it `update` each frame, read the pose back. Local frame faces +x (the caller mirrors blue). */
export class Swag2D {
  constructor(seed) { this.swag = new Swag(seed); }
  cue(kind, time, force = false) { this.swag.cue(kind, time, force); }

  /** time/dt in seconds. busy: the sprite is not in its idle guard (punching, reacting). mode as in Swag.update. */
  update(time, dt, { busy, tactic, mode = 'fight' }) {
    const fx = this.swag.update(time, dt, { busy, tactic, mode });
    const S = this.swag.style, ph = this.swag.beatPhase, side = fx.side;
    const calm = busy ? 0 : 1, shim = fx.shimmy;
    // Whole body, about the feet: crouch squashes and rises on toes stretch; lean tips toward (+) or away from (-) the opponent.
    const crouch = S.crouch * 3.2 - S.toe * 3, hot = Math.min(1, fx.walk + fx.strut);
    const lean = (S.lean + S.philly * -0.9 + S.square * 0.12) * 0.9 - 0.045 * fx.walk - 0.035 * fx.strut + 0.012 * fx.adjust * side;
    // Beats move the whole body a little (shimmy side to side, weight shift).
    const beatX = (0.035 * shim * sine(time * 1.25 * BEAT_RAD + ph) + 0.012 * sine(time * BEAT_RAD / 2 + ph) * calm * (0.6 + S.bounce * 0.4));
    const beatY = (0.006 * S.bounce * sine(time * BEAT_RAD + ph) + 0.01 * shim * sine(time * 1.25 * BEAT_RAD + ph)) * calm;
    const roll = 0.012 * S.roll * sine(time * 1.1 + ph) * calm + 0.03 * shim * sine(time * 1.25 * BEAT_RAD / 2 + ph);
    // Head and shoulders, about the neck: nod forward, tilt, chin up, neck roll; shrug lifts the shoulders.
    const nodC = fx.nod + fx.touch * 0.5;
    const head = 0.09 * nodC - 0.07 * fx.low - S.chinUp * 3.2 - 0.05 * fx.strut
      + 0.07 * fx.tilt * side + 0.1 * fx.neck * side * sine(fx.u * Math.PI * 2) + 0.012 * sine(time * 0.9 + ph + 1) * calm;
    return {
      dx: -(0.55 * fx.walk + 0.9 * fx.strut) + beatX,   // metres, backing away to the corner
      dy: beatY,                                           // metres up
      squash: 1 - crouch * 0.9 - 0.012 * fx.adjust,       // vertical scale about the feet
      lean, roll,
      head,                                                // extra head rotation about the neck
      headDy: 0.02 * fx.shrug + 0.012 * fx.low - 0.015 * fx.nod,   // head/shoulders lift (+ up) in metres
      moving: hot,
    };
  }
}
