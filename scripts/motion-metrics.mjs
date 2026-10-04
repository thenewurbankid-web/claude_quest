// Boxing Manager AI: how calm do the fighters move? Plays one real sim round through ModelBoxer at 60 fps (Babylon NullEngine)
// and counts steps per second and direction reversals (swings over 1.5 mm) of feet, hips and head. Run: node scripts/motion-metrics.mjs [seed]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { FighterModel, CombatSimulation } from '../public/boxing/physics-engine.js';
import { ModelBoxer, PHOTO_OUTFITS } from '../public/boxing/boxer-model.js';

export async function loadPerson() {
  const require = createRequire(import.meta.url);
  const B = require('babylonjs'); require('babylonjs-loaders');
  const scene = new B.Scene(new B.NullEngine());
  const load = (f) => B.SceneLoader.LoadAssetContainerAsync('data:application/octet-stream;base64,' + fs.readFileSync(new URL(`../public/boxing/models/${f}`, import.meta.url)).toString('base64'), undefined, scene, undefined, '.glb');
  const anims = await load('anims.glb');
  for (const g of anims.animationGroups) g.stop();
  const tex = () => new B.Texture('data:image/png;base64,iVBORw0KGgo=', scene);
  return { B, scene, person: { boxer: await load('person.glb'), anims, person: true, skins: { light: tex(), medium: tex(), deep: tex() } } };
}

const BONES = { footL: 'foot_l', footR: 'foot_r', hips: 'pelvis', head: 'Head' };

/** Counts direction reversals that swing at least `h` metres, so a 0.3 mm tremble doesn't count but a 3 mm shiver does. */
class Zigzag {
  constructor(h) { this.h = h; this.dir = 0; this.ext = null; this.n = 0; }
  add(p) {
    if (this.ext === null) { this.ext = p; return; }
    if (this.dir === 0) { if (Math.abs(p - this.ext) > this.h) { this.dir = Math.sign(p - this.ext); this.ext = p; } return; }
    if (this.dir > 0) { if (p > this.ext) this.ext = p; else if (this.ext - p > this.h) { this.n++; this.dir = -1; this.ext = p; } }
    else if (p < this.ext) this.ext = p; else if (p - this.ext > this.h) { this.n++; this.dir = 1; this.ext = p; }
  }
}

/** Poses both fighters at 60 fps from `frames` (an iterator of sim snapshots) and reports steps/s and reversals/s per tracked point. */
export function play(world, frames, { h = 0.0015, tactics } = {}) {
  const { B, scene, person } = world;
  const boxers = {}; for (const c of ['red', 'blue']) boxers[c] = new ModelBoxer(B, scene, person, c, { addShadowCaster() {} }, { glove: '#c9343a', trunks: '#9e1c24', wraps: true, outfit: PHOTO_OUTFITS[c] });
  const dt = 1 / 60, zz = { red: {}, blue: {} };
  let n = 0;
  for (const s of frames) {
    n++;
    for (const [c, o] of [['red', 'blue'], ['blue', 'red']]) {
      boxers[c].pose(s[c], s[o], s.tick, s.tick * 1000 / 240, dt, n * dt);
      for (const [name, bone] of Object.entries(BONES)) for (const ax of ['x', 'z']) (zz[c][name + '.' + ax] ??= new Zigzag(h)).add(boxers[c].rig.pos(bone)[ax]);
    }
  }
  const secs = n * dt, out = { seconds: +secs.toFixed(1) };
  for (const c of ['red', 'blue']) {
    const r = {}; for (const [k, z] of Object.entries(zz[c])) r[k] = +(z.n / secs).toFixed(2);
    const feet = Math.max(r['footL.x'], r['footL.z'], r['footR.x'], r['footR.z']), core = Math.max(r['hips.x'], r['hips.z'], r['head.x'], r['head.z']);
    out[c] = { stepsPerSec: +(boxers[c].fw.steps / secs).toFixed(2), footReversalsPerSec: feet, hipHeadReversalsPerSec: core, reversalsPerSec: r };
  }
  return out;
}

const person = (stats = { speed: 50, power: 50, stamina: 50, ringIQ: 50 }) => (c) => new FighterModel({ corner: c, name: c, stats });

/** One real sim round (35 s unless it ends early): the fighters move, punch and clinch as the sim says. */
export async function measureRound({ seed = 11, seconds = 35, tactics = { red: 'pressure', blue: 'outbox' }, world } = {}) {
  world ??= await loadPerson();
  const mk = person();
  const sim = new CombatSimulation({ seed, rounds: 1, roundSeconds: seconds, red: mk('red'), blue: mk('blue') });
  sim.startRound(tactics);
  return play(world, (function* () { while (sim.phase === 'running') { for (let i = 0; i < 4 && sim.phase === 'running'; i++) sim.step(); yield sim.snapshot(); } })());
}

/** An idle exchange: both stand 1.3 m apart, no punches, and the sim's position and velocity are fed 4 mm / 0.3 m/s of per-tick noise on purpose. */
export async function measureIdle({ seconds = 12, noise = 1, world } = {}) {
  world ??= await loadPerson();
  let a = 5; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 31 - 1; };
  const side = (x) => ({ x: x + 0.004 * noise * rnd(), y: 0.004 * noise * rnd(), vx: 0.3 * noise * rnd(), vy: 0.3 * noise * rnd(), gasRatio: 1, activePunch: null });
  return play(world, (function* () { for (let i = 0; i < seconds * 60; i++) yield { tick: i * 4, red: side(-0.65), blue: { ...side(0.65) } }; })());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const world = await loadPerson();
  console.log('round', JSON.stringify(await measureRound({ seed: +process.argv[2] || 11, world }), null, 1));
  console.log('idle', JSON.stringify(await measureIdle({ world }), null, 1));
}
