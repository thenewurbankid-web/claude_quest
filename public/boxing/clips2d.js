// BOX-17 photoreal 2D view: pure, render-only mapping from sim events to pre-rendered clips, shots and post effects.
// Reads sim snapshots and 'impact' records only; nothing here writes to the sim.
import { TICK_MS } from './physics-engine.js';

/** Clip catalogue. impact = frame where the fist lands (attack clips) or the reaction peaks. loop = idle-style. */
export const CLIPS = Object.freeze({
  idle_guard:  { frames: 16, fps: 15, loop: true },
  step_in:     { frames: 8,  fps: 20 },
  step_out:    { frames: 8,  fps: 20 },
  atk_jab:     { frames: 10, fps: 30, impact: 4 },
  atk_cross:   { frames: 12, fps: 30, impact: 5 },
  atk_hook:    { frames: 14, fps: 30, impact: 6 },
  atk_uppercut:{ frames: 14, fps: 30, impact: 6 },
  atk_body:    { frames: 14, fps: 30, impact: 6 },
  block:       { frames: 8,  fps: 30, impact: 2 },
  slip:        { frames: 10, fps: 30, impact: 4 },
  hit_head:    { frames: 10, fps: 30, impact: 3 },
  hit_body:    { frames: 10, fps: 30, impact: 3 },
  stagger:     { frames: 16, fps: 24, impact: 4 },
  knockdown:   { frames: 20, fps: 24, impact: 4 },
  get_up:      { frames: 20, fps: 20 },
  ko:          { frames: 24, fps: 24, impact: 4 },
  celebrate:   { frames: 24, fps: 15, loop: true },
});

export const ATTACK_CLIP = Object.freeze({ jab: 'atk_jab', cross: 'atk_cross', hook: 'atk_hook', uppercut: 'atk_uppercut', body: 'atk_body' });

export const HEAVY_ENERGY = 0.6;   // energy01 at which a hit gets a push-in and effects
export const STAGGER_ENERGY = 0.75;

/** The defender's reaction clip for a resolved punch record (the sim's 'impact' payload). */
export function reactionClip(rec) {
  if (rec.knockout) return 'ko';
  if (rec.outcome === 'blocked') return 'block';
  if (rec.outcome === 'slipped') return 'slip';
  if (rec.energy01 >= STAGGER_ENERGY) return 'stagger';
  return rec.target === 'body' ? 'hit_body' : 'hit_head';
}

/** Playback rate that lands a clip's impact frame exactly on the sim's arrival tick (1 = authored speed). */
export function clipRate(clip, launchTick, arriveTick) {
  const c = CLIPS[clip];
  if (!c || c.impact == null) return 1;
  const sim = ((arriveTick - launchTick) * TICK_MS) / 1000;
  if (sim <= 0) return 1;
  return (c.impact / c.fps) / sim;
}

/** Everything the presentation does for one resolved punch. */
export function planImpact(rec) {
  const heavy = rec.outcome === 'landed' && rec.energy01 >= HEAVY_ENERGY;
  const defenderClip = reactionClip(rec);
  const big = heavy || rec.knockout;
  return {
    attacker: { corner: rec.attacker, clip: ATTACK_CLIP[rec.type] ?? 'atk_jab', launchTick: rec.launchTick, arriveTick: rec.arriveTick },
    defender: { corner: rec.defender, clip: defenderClip, startTick: rec.arriveTick },
    fx: {
      shake: rec.outcome === 'landed' ? Math.min(1, rec.energy01) : 0,
      pushIn: big,
      sweat: heavy,
      radialBlur: big,
      chroma: big,
      slowmoMs: rec.knockout ? 900 : 0,
      dutch: rec.knockout,
    },
    crowd: rec.knockout ? 'jump' : heavy ? 'cheer' : rec.outcome === 'landed' && rec.energy01 >= 0.35 ? 'wince' : null,
  };
}

/** Shot ids: one fixed medium-wide plate plus a few close angles (each pre-rendered once, see HANDOFF plan). */
export const SHOTS = Object.freeze({
  medium: { zoom: 1.0 },
  push: { zoom: 1.18 },        // 2D push-in on the same plate
  close_red: { zoom: 1 },      // over-the-shoulder close angle, red's side (own plate)
  close_blue: { zoom: 1 },
  ko_close: { zoom: 1 },
  replay_close: { zoom: 1 },
});

const MIN_HOLD_MS = 500, MAX_HOLD_MS = 1500, COOLDOWN_MS = 2000;

/**
 * Edit rhythm: stay on the readable medium shot, cut on a heavy hit to a close angle on the attacker's side,
 * hold 0.5-1.5 s (longer for harder hits), then return. Deterministic from the sim clock, so replays match.
 */
export class ShotDirector {
  constructor() { this.shot = 'medium'; this.until = 0; this.lastCut = -Infinity; }

  onImpact(rec, tMs) {
    const plan = planImpact(rec);
    if (!plan.fx.pushIn) return this.shot;
    if (rec.knockout) { this._cut('ko_close', tMs, 2400); return this.shot; }
    if (tMs - this.lastCut < COOLDOWN_MS) return this.shot;
    const hold = MIN_HOLD_MS + (MAX_HOLD_MS - MIN_HOLD_MS) * Math.min(1, (rec.energy01 - HEAVY_ENERGY) / (1 - HEAVY_ENERGY));
    this._cut(rec.attacker === 'red' ? 'close_red' : 'close_blue', tMs, hold);
    return this.shot;
  }

  update(tMs) {
    if (this.shot !== 'medium' && tMs >= this.until) this.shot = 'medium';
    return this.shot;
  }

  _cut(shot, tMs, holdMs) { this.shot = shot; this.until = tMs + holdMs; this.lastCut = tMs; }
}

/** Post-pass settings per look. Everything cheap (2D); `lowEnd` drops the expensive parts but keeps the grade. */
export const LOOKS = Object.freeze({
  filmic:    { grade: 'filmic', grain: 0.04, vignette: 0.25, bloom: 0.15, dof: true, scanlines: 0, chromaBleed: 0, wobble: 0, stamp: false },
  camcorder: { grade: 'vhs_warm', grain: 0.10, vignette: 0.45, bloom: 0.1, dof: false, scanlines: 0.12, chromaBleed: 0.5, wobble: 0.15, stamp: true },
});

export function postProfile(look = 'filmic', { lowEnd = false, replay = false, intro = false } = {}) {
  const key = replay || intro ? 'camcorder' : (LOOKS[look] ? look : 'filmic');
  const p = { ...LOOKS[key], look: key };
  if (lowEnd) { p.bloom = 0; p.dof = false; p.grain = 0; p.chromaBleed = 0; p.wobble = 0; }
  return p;
}

/** Camcorder stamp: fight date and round clock. */
export function timecode(dateISO, round, clockMs) {
  const s = Math.max(0, Math.floor(clockMs / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
  return { date: dateISO, clock: `R${round} ${mm}:${ss}` };
}

/** Stand-ins for clips that aren't rendered yet, so the compositor never shows nothing. */
export const CLIP_FALLBACK = Object.freeze({
  atk_uppercut: 'atk_hook', atk_body: 'atk_jab', hit_body: 'hit_head', slip: 'idle_guard', knockdown: 'ko',
  step_in: 'idle_guard', step_out: 'idle_guard', get_up: 'idle_guard', celebrate: 'idle_guard',
});

/** The clip to play: `name` if rendered (in `have`), else its fallback chain, else idle_guard. */
export function resolveClip(name, have) {
  for (let n = name, i = 0; n && i < 4; n = CLIP_FALLBACK[n], i++) if (have.has(n)) return n;
  return 'idle_guard';
}

/** Frame to show `elapsedMs` into a clip played at `rate`. Loops wrap; one-shots hold the last frame (done = true). */
export function clipFrame(clip, elapsedMs, rate = 1, frames = clip.frames) {
  const f = Math.max(0, Math.floor((elapsedMs / 1000) * clip.fps * rate));
  if (clip.loop) return { frame: f % frames, done: false };
  return { frame: Math.min(f, frames - 1), done: f >= frames };
}
