// Boxing Manager AI: deterministic physics, the collision rule, telemetry shape, and RAG ranking. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FighterModel, CombatSimulation, computePunch, mulberry32, PUNCHES, TACTICS, RULESETS, RING_HALF_M, TICK_MS, damageDivisorFor } from '../public/boxing/physics-engine.js';
import { buildFightLogRow, rankPrecedents, similarity, profileTags, successScore, toLLMContext } from '../public/boxing/game-db.js';

const PINNED_SEED_11 = '70cbbcde181741d10ecc1a40c0a3165752fdca008b5942dcdb466dd452c177c2'; // re-pinned for BOX-22 (street moveset changed the sim);
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

test('3D view: two-bone IK keeps bone lengths and stops at full reach', async () => {
  const { solveTwoBone, rotateAbout } = await import('../public/boxing/pose-math.js');
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const root = { x: 0, y: 1.4, z: 0 };
  const near = solveTwoBone(root, { x: 0.3, y: 1.3, z: 0.2 }, 0.3, 0.27, { x: 0, y: -1, z: 0 });
  assert.ok(Math.abs(d(root, near.mid) - 0.3) < 1e-9 && Math.abs(d(near.mid, near.end) - 0.27) < 1e-9);
  assert.ok(near.mid.y < 1.4, 'the elbow bends toward the pole');
  const far = solveTwoBone(root, { x: 0, y: 1.4, z: 3 }, 0.3, 0.27, { x: 0, y: -1, z: 0 });
  assert.ok(d(root, far.end) < 0.57 && d(root, far.end) > 0.56, 'an out-of-reach target clamps to the arm length');
  const p = rotateAbout({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, Math.PI / 2);
  assert.ok(Math.abs(p.y) < 1e-9 && Math.abs(Math.abs(p.z) - 1) < 1e-9);
});

test('normalizeLook keeps valid choices, drops junk, and fills gaps from the base outfit', async () => {
  const { normalizeLook, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
  assert.deepEqual(normalizeLook(undefined), normalizeLook(PHOTO_OUTFITS.red));
  const l = normalizeLook({ topStyle: 'hoodie', top: '#ABCDEF', skin: 'medium', cap: null, chain: false, evil: '<script>' }, PHOTO_OUTFITS.blue);
  assert.equal(l.topStyle, 'hoodie');
  assert.equal(l.top, '#abcdef');
  assert.equal(l.skin, 'medium');
  assert.equal(l.cap, null);
  assert.equal(l.chain, false);
  assert.equal(l.jeans, PHOTO_OUTFITS.blue.jeans);
  assert.ok(!('evil' in l));
  const bad = normalizeLook({ topStyle: 'cape', top: 'red; background:url(x)', boots: 'heels', skin: 'blue', wraps: 42 });
  assert.deepEqual(
    [bad.topStyle, bad.top, bad.boots, bad.skin, bad.wraps],
    [PHOTO_OUTFITS.red.topStyle, PHOTO_OUTFITS.red.top, PHOTO_OUTFITS.red.boots, PHOTO_OUTFITS.red.skin, PHOTO_OUTFITS.red.wraps],
  );
});

test('a look in the profile does not change the fight', () => {
  const plain = new CombatSimulation({ seed: 11, rounds: 2, red: fighter('red'), blue: fighter('blue') });
  const dressed = new CombatSimulation({ seed: 11, rounds: 2,
    red: new FighterModel({ corner: 'red', name: 'red', stats: AVG, look: { topStyle: 'hoodie', skin: 'deep' } }), blue: fighter('blue') });
  for (const sim of [plain, dressed]) while (sim.phase !== 'fight_over') { sim.startRound({ red: 'pressure', blue: 'outbox' }); sim.runRoundToEnd(); }
  assert.equal(JSON.stringify(plain.rounds), JSON.stringify(dressed.rounds));
});

test('profileOf ships a normalized look; receivedProfile rebuilds a peer look with the corner outfit', async () => {
  const { profileOf, receivedProfile } = await import('../public/boxing/profile.js');
  const { PHOTO_OUTFITS, normalizeLook } = await import('../public/boxing/boxer-model.js');
  const f = { name: 'A', stats: { ...AVG }, points: 3, look: { topStyle: 'tank', top: '#123456', junk: 1 } };
  const p = profileOf(f);
  assert.deepEqual(Object.keys(p).sort(), ['look', 'name', 'stats']);
  assert.equal(p.look.topStyle, 'tank');
  assert.ok(!('junk' in p.look));
  assert.notEqual(p.stats, f.stats);
  assert.deepEqual(Object.keys(profileOf({ name: 'B', stats: AVG })).sort(), ['name', 'stats']);
  // the look survives a JSON round trip (Dexie / P2P message) unchanged
  assert.deepEqual(normalizeLook(JSON.parse(JSON.stringify(p)).look), p.look);
  const r = receivedProfile({ name: 'C', stats: AVG, look: { skin: 'x', top: 'url(evil)', chain: 'yes' } }, 'blue');
  assert.deepEqual(r.look, normalizeLook(undefined, PHOTO_OUTFITS.blue));
  assert.deepEqual(receivedProfile({ name: 'D', stats: AVG }, 'red').look, normalizeLook(undefined, PHOTO_OUTFITS.red));
});

// ─── The MPFB person (public/boxing/models/person.glb), loaded in Babylon's NullEngine ─────────────────────────
const personWorld = async () => {
  const fs = await import('node:fs');
  const { createRequire } = await import('node:module');
  const B = createRequire(import.meta.url)('babylonjs');
  createRequire(import.meta.url)('babylonjs-loaders');
  const scene = new B.Scene(new B.NullEngine());
  const load = (f) => B.SceneLoader.LoadAssetContainerAsync('data:application/octet-stream;base64,' + fs.readFileSync(new URL(`../public/boxing/models/${f}`, import.meta.url)).toString('base64'), undefined, scene, undefined, '.glb');
  const anims = await load('anims.glb');
  for (const g of anims.animationGroups) g.stop();
  const tex = () => new B.Texture('data:image/png;base64,iVBORw0KGgo=', scene);
  const person = { boxer: await load('person.glb'), anims, person: true, skins: { light: tex(), medium: tex(), deep: tex() } };
  return { B, scene, person };
};
const SHADOW = { addShadowCaster() {} };

test('person.glb has every garment a look can show, on the Quaternius bone names', async () => {
  const { personParts, ModelRig, LOOK_OPTIONS } = await import('../public/boxing/boxer-model.js');
  const { B, scene, person } = await personWorld();
  const rig = new ModelRig(B, scene, person, 'red');
  const names = new Set(rig.meshes.map((m) => m.name.slice(4)));
  for (const topStyle of Object.keys(LOOK_OPTIONS.topStyle)) for (const boots of Object.keys(LOOK_OPTIONS.boots)) for (const cap of [null, '#1c2540'])
    for (const skin of Object.keys(LOOK_OPTIONS.skin))
      for (const p of personParts({ topStyle, boots, cap, skin })) assert.ok(names.has(p), `${p} missing from person.glb`);
  for (const b of ['root', 'pelvis', 'spine_03', 'Head', 'upperarm_l', 'hand_r', 'calf_l', 'ball_r']) assert.ok(rig.bones[b], `bone ${b}`);
  assert.equal(rig.clipNames.includes('Punch_Jab') && rig.clipNames.includes('Death01'), true);
});

test('person looks: parts shown and tint colours follow the look; hair depends on skin and cap', async () => {
  const { personParts, personTint, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
  const red = personParts(PHOTO_OUTFITS.red), blue = personParts(PHOTO_OUTFITS.blue);
  assert.ok(red.includes('top_tee') && red.includes('top_tee_sleeve') && red.includes('shoes_timbs') && !red.includes('shoes_sneakers'));
  assert.ok(blue.includes('top_varsity_sleeve') && blue.includes('shoes_sneakers') && blue.includes('hair_short01'));
  assert.ok(!red.some((p) => p.startsWith('hair')), 'the red corner wears a cap');
  assert.ok(personParts({ ...PHOTO_OUTFITS.red, cap: null, skin: 'light' }).includes('hair_short02'));
  assert.ok(!personParts({ topStyle: 'tank', boots: 'timbs', cap: null, skin: 'deep' }).some((p) => /sleeve|top_tee/.test(p)));
  assert.equal(personTint('pants_jeans', PHOTO_OUTFITS.blue), PHOTO_OUTFITS.blue.jeans);
  assert.equal(personTint('top_varsity_sleeve', PHOTO_OUTFITS.blue), PHOTO_OUTFITS.blue.sleeve);
  assert.equal(personTint('top_varsity', PHOTO_OUTFITS.blue), PHOTO_OUTFITS.blue.top);
  assert.equal(personTint('top_tee_sleeve', PHOTO_OUTFITS.red), PHOTO_OUTFITS.red.top);
  assert.equal(personTint('skin', PHOTO_OUTFITS.red), null);
  assert.equal(personTint('shoes_timbs', PHOTO_OUTFITS.red), null);
});

test('the existing clips pose the person: finite bones, soles on the floor, head and fists where a boxer has them', async () => {
  const { ModelBoxer, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
  const { B, scene, person } = await personWorld();
  const boxer = new ModelBoxer(B, scene, person, 'red', SHADOW, { glove: '#c9343a', trunks: '#9e1c24', wraps: true, outfit: PHOTO_OUTFITS.red });
  const me = { x: 0, y: 0, vx: 0, vy: 0, gasRatio: 1, activePunch: null }, opp = { x: 0, y: 1.2, activePunch: null };
  const idle = boxer.pose(me, opp, 0, 0, 1 / 60, 0);
  assert.ok(idle.head.y > 1.3 && idle.head.y < 1.6, `head ${idle.head.y}`);
  const soles = [boxer.rig.pos('ball_l').y, boxer.rig.pos('ball_r').y];
  assert.ok(soles.every((y) => y > -0.02 && y < 0.1), `balls ${soles}`);
  for (const type of ['jab', 'cross', 'hook', 'uppercut', 'body']) {
    const r = boxer.pose({ ...me, activePunch: { type, launchTick: 0, arriveTick: 10 } }, opp, 9, 0, 1 / 60, 0);
    for (const p of [r.head, r.chest, r.gloveL, r.gloveR, r.hips]) assert.ok([p.x, p.y, p.z].every(Number.isFinite), `${type} not finite`);
    const reach = Math.max(r.gloveL.z, r.gloveR.z);
    assert.ok(reach > 0.7, `${type}: a fist reaches ${reach.toFixed(2)} m forward`);
  }
  for (const clip of boxer.rig.clipNames) {
    boxer.rig.applyLayers([{ clip: 'Idle_Loop', t: 0, w: 1 }, { clip, t: 0.5, w: 1 }]);
    for (const k of ['Head', 'hand_l', 'foot_r']) { const p = boxer.rig.pos(k); assert.ok([p.x, p.y, p.z].every(Number.isFinite), `${clip}/${k}`); }
  }
});

test('idle guard stands straight: spine, hips, shoulders and head within sensible angles, hands at the face', async () => {
  const { ModelBoxer, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
  const { B, scene, person } = await personWorld();
  const boxer = new ModelBoxer(B, scene, person, 'red', SHADOW, { glove: '#c9343a', trunks: '#9e1c24', wraps: true, outfit: PHOTO_OUTFITS.red });
  const me = { x: 0, y: 0, vx: 0, vy: 0, gasRatio: 1, activePunch: null }, opp = { x: 0, y: 1.2, activePunch: null };
  for (const k of [0, 1, 2]) boxer.pose(me, opp, 0, 0, 1 / 60, k * 0.3);   // 0.9 s of standing sway
  const P = (n) => boxer.rig.pos(n), deg = (r) => Math.abs(r * 180 / Math.PI);
  const lean = (a, b) => { const d = { x: P(b).x - P(a).x, y: P(b).y - P(a).y, z: P(b).z - P(a).z }; return { side: deg(Math.atan2(d.x, d.y)), fore: deg(Math.atan2(d.z, d.y)) }; };
  for (const [a, b] of [['pelvis', 'spine_01'], ['spine_01', 'spine_02'], ['spine_02', 'spine_03'], ['spine_03', 'neck_01'], ['neck_01', 'Head']]) {
    const l = lean(a, b);
    assert.ok(l.side < 10, `${a}->${b} leans ${l.side.toFixed(1)} deg sideways`);
    assert.ok(l.fore < 25, `${a}->${b} leans ${l.fore.toFixed(1)} deg forward or back`);
  }
  const tilt = (l, r) => deg(Math.atan2(P(r).y - P(l).y, P(r).x - P(l).x));
  assert.ok(tilt('thigh_l', 'thigh_r') < 6, 'hips level');
  assert.ok(tilt('upperarm_l', 'upperarm_r') < 8, 'shoulders level');
  // The head sits over the body, not thrown ahead of the feet, and the hands are up at the face (below the crown, above the chest).
  const head = P('Head'), feet = { x: (P('foot_l').x + P('foot_r').x) / 2, z: (P('foot_l').z + P('foot_r').z) / 2 };
  assert.ok(Math.hypot(head.x - feet.x, head.z - feet.z) < 0.25, 'head over the feet');
  for (const h of ['hand_l', 'hand_r']) assert.ok(P(h).y < head.y && P(h).y > head.y - 0.35, `${h} at the face: ${(P(h).y - head.y).toFixed(2)}`);
  // A straight punch keeps the spine from folding.
  boxer.pose({ ...me, activePunch: { type: 'cross', launchTick: 0, arriveTick: 10 } }, opp, 9, 0, 1 / 60, 0);
  assert.ok(lean('spine_01', 'neck_01').fore < 40, 'cross does not fold the torso');
});

test('planted feet do not slip at walk, shuffle and pivot speeds, and the feet do step', async () => {
  const { ModelBoxer, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
  const { B, scene, person } = await personWorld();
  const boxer = new ModelBoxer(B, scene, person, 'red', SHADOW, { glove: '#c9343a', trunks: '#9e1c24', wraps: true, outfit: PHOTO_OUTFITS.red });
  const dt = 1 / 60;
  // [speed m/s, direction angle, turn rate rad/s] over 3 s each: forward walk, fast shuffle, side step, pivot around the opponent.
  for (const [speed, dir, turn] of [[0.6, 0, 0], [1.2, 0, 0], [1.8, Math.PI / 2, 0], [0.9, Math.PI / 2, 1.2], [0, 0, 0]]) {
    const before = boxer.fw?.steps ?? 0;
    let x = 0, y = 0, a = 0, worst = 0;
    for (let i = 0; i < 180; i++) {
      a += turn * dt;
      const vx = Math.sin(a + dir) * speed, vy = Math.cos(a + dir) * speed;
      x += vx * dt; y += vy * dt;
      const opp = { x: x + Math.sin(a) * 1.4, y: y + Math.cos(a) * 1.4, activePunch: null };
      boxer.pose({ x, y, vx, vy, gasRatio: 1, activePunch: null }, opp, i, i * dt * 1000, dt, i * dt);
      if (i > 10) worst = Math.max(worst, boxer.footSlip.l, boxer.footSlip.r);
    }
    const steps = boxer.fw.steps - before;
    assert.ok(worst < 0.0005, `speed ${speed} dir ${dir} turn ${turn}: a planted foot slipped ${(worst * 100).toFixed(2)} cm in one frame`);
    if (speed > 0.5) assert.ok(steps >= 3, `speed ${speed}: only ${steps} steps in 3 s`);
    if (speed === 0) assert.ok(steps <= 2, `standing still took ${steps} steps`);
  }
});

test('punches pivot the punching-side foot without sliding it, and a tired boxer still holds the planted feet', async () => {
  const { ModelBoxer, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
  const { B, scene, person } = await personWorld();
  const boxer = new ModelBoxer(B, scene, person, 'red', SHADOW, { glove: '#c9343a', trunks: '#9e1c24', wraps: true, outfit: PHOTO_OUTFITS.red });
  const dt = 1 / 60;
  for (const [type, gas] of [['cross', 1], ['hook', 0.3], ['body', 0.3], ['uppercut', 1], ['jab', 1]]) {
    let worst = 0, hip0 = null, hipLow = Infinity;
    for (let i = 0; i < 120; i++) {
      const k = i % 60;
      const ap = k < 20 ? { type, launchTick: i - k, arriveTick: i - k + 20 } : null;
      boxer.pose({ x: 0, y: 0, vx: 0, vy: 0, gasRatio: gas, activePunch: ap }, { x: 0, y: 1.3, activePunch: null }, i, i * dt * 1000, dt, i * dt);
      if (i > 10) worst = Math.max(worst, boxer.footSlip.l, boxer.footSlip.r);
      const p = boxer.rig.pos('pelvis'); hip0 ??= p.y; hipLow = Math.min(hipLow, p.y);
    }
    assert.ok(worst < 0.0005, `${type}: a planted foot slipped ${(worst * 100).toFixed(2)} cm in one frame`);
    if (type === 'body') assert.ok(hip0 - hipLow > 0.02, 'body shots drop the hips');
  }
});

test('boxer assets fall back to the Quaternius boxer when person.glb will not load', async () => {
  const { loadBoxerAssets } = await import('../public/boxing/boxer-model.js');
  const asked = [];
  const B = {
    SceneLoader: {
      IsPluginForExtensionAvailable: () => true,
      LoadAssetContainerAsync: async (base, file) => { asked.push(file); if (file === 'person.glb') throw new Error('404'); return { animationGroups: [], file }; },
    },
    Texture: class { constructor(url) { this.url = url; } },
  };
  const warn = console.warn; console.warn = () => {};
  const a = await loadBoxerAssets(B, {}, '/x/').finally(() => { console.warn = warn; });
  assert.deepEqual(asked.sort(), ['anims.glb', 'boxer.glb', 'person.glb']);
  assert.equal(a.person, false);
  assert.equal(a.boxer.file, 'boxer.glb');
  assert.ok(a.skinLight.url.endsWith('skin_light.webp'));
});

test('pressure crowds a defender, but not one who is also on pressure', () => {
  const mk = (key) => { const f = fighter('blue'); f.tacticKey = key; f.tactic = TACTICS[key]; return f; };
  const run = (defKey) => {
    const r = fighter('red'); r.tacticKey = 'pressure'; r.tactic = TACTICS.pressure;
    const b = mk(defKey); r.pos = { x: -0.45, y: 0 }; b.pos = { x: 0.45, y: 0 };
    return computePunch({ attacker: r, defender: b, type: 'jab', tick: 0, rng: mulberry32(3) }).reaction.windowMs;
  };
  // The defender's own guard style (defendMs) also shifts the window; crowd is the rest.
  const dm = (k) => TACTICS[k].defendMs || 0;
  assert.ok(Math.abs(run('outbox') - run('pressure') - (TACTICS.pressure.crowdMs + dm('outbox') - dm('pressure'))) < 1e-9);
});

// ─── Game flow (flow.js): screens, progression, unlocks, scorecards, corner tips, settings ───
import { SCREENS, navigate, eventsFrom, statCost, REWARDS, outcomeOf, UNLOCKS, isUnlocked, lockedLook, newUnlocks, scorecard, fightStats, punchBreakdown, PUNCH_TYPES, aiPlan, emptyDamage, recordDamage, zoneOf, zoneHeat, DAMAGE_ZONES, cornerTip, normalizeSettings, DEFAULT_SETTINGS } from '../public/boxing/flow.js';

test('screen flow: Title to Fighter to Opponent to Fight to Result and back', () => {
  let s = 'title';
  for (const [ev, to] of [['play', 'fighter'], ['fight', 'opponent'], ['start', 'fight'], ['finished', 'result'], ['rematch', 'fight'], ['finished', 'result'], ['train', 'upgrade'], ['back', 'fighter'], ['back', 'title']]) {
    s = navigate(s, ev); assert.equal(s, to);
  }
  assert.equal(navigate('title', 'continue'), 'opponent');
  assert.equal(navigate('fight', 'quit'), 'title');
});

test('screen flow: every edge lands on a real screen, and a wrong button throws', () => {
  for (const s of SCREENS) for (const ev of eventsFrom(s)) assert.ok(SCREENS.includes(navigate(s, ev)));
  assert.throws(() => navigate('title', 'finished'), /No "finished"/);
  assert.throws(() => navigate('nowhere', 'play'));
});

test('training costs step up at 60 and 80; rewards favour winning', () => {
  assert.deepEqual([59, 60, 79, 80, 99].map(statCost), [1, 2, 2, 3, 3]);
  assert.ok(REWARDS.w > REWARDS.d && REWARDS.d > REWARDS.l && REWARDS.l > 0);
  assert.deepEqual([outcomeOf('red', 'red'), outcomeOf('blue', 'red'), outcomeOf('draw', 'blue')], ['w', 'l', 'd']);
});

test('unlocks follow wins; a locked look is put back to the base outfit', () => {
  assert.ok(isUnlocked('topStyle', 'tee', 0));            // free choices are always open
  assert.ok(!isUnlocked('topStyle', 'varsity', 0) && isUnlocked('topStyle', 'varsity', 1));
  const base = { topStyle: 'tee', jeans: '#2f3b52', wraps: '#ecebe6', top: '#c0392b' };
  const worn = { ...base, topStyle: 'varsity', wraps: '#d9a12b', jeans: '#1d1e22' };
  assert.deepEqual(lockedLook(worn, 0, base), base);
  assert.deepEqual(lockedLook(worn, 5, base), worn);
  assert.deepEqual(newUnlocks(0, 2).map((u) => u.wins), [1, 2]);
  assert.deepEqual(newUnlocks(2, 2), []);
  assert.equal(UNLOCKS.length, new Set(UNLOCKS.map((u) => u.key + u.value)).size);
});

test('scorecard and fight stats add up the sim rounds', () => {
  const sim = fight(11);
  const card = scorecard(sim.rounds), st = fightStats(sim.rounds);
  assert.equal(card.rows.length, sim.rounds.length);
  assert.equal(card.total.red, sim.result.cards.red);
  assert.equal(card.total.blue, sim.result.cards.blue);
  assert.equal(st.red.landed, sim.rounds.reduce((s, r) => s + r.totals.red.landed, 0));
  assert.ok(st.red.thrown >= st.red.landed);
});

test('corner tips: gassed fighters recover, hurt ones survive, a tiring foe is pressed', () => {
  const me = { health: 90, gasRatio: 0.9, stats: AVG }, opp = { health: 90, gasRatio: 0.9, stats: AVG };
  assert.equal(cornerTip({ ...me, gasRatio: 0.2 }, opp).tactic, 'recover');
  assert.equal(cornerTip({ ...me, health: 20 }, opp).tactic, 'outbox');
  assert.equal(cornerTip(me, { ...opp, health: 20 }).tactic, 'pressure');
  assert.equal(cornerTip(me, { ...opp, gasRatio: 0.3 }).tactic, 'pressure');
  assert.equal(cornerTip(me, opp, { tactic: 'counter', label: 'Counter' }).tactic, 'counter');
  assert.equal(cornerTip(me, { ...opp, stats: { ...AVG, power: 80 } }).tactic, 'counter');
  for (const t of Object.keys(TACTICS)) assert.ok(TACTICS[t]);
});

test('settings: junk falls back to the defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ sfx: 'yes', music: true, time: 'dusk', speed: 3, extra: 1 }), { ...DEFAULT_SETTINGS, music: true });
  assert.equal(normalizeSettings({ speed: '2', time: 'night' }).speed, 2);
  assert.equal(normalizeSettings({ time: 'night' }).time, 'night');
});

// ─── Career mode (career.js) ───
import { ENERGY, TIERS, newCareer, normalizeCareer, effectiveStats, ladder, rankOf, offersFor, rest, applyFight, DRILLS, SPAR_CUES, beatAt, sparPos, markerAt, hitScore, drillResult, applyDrill, canDrill, tierIndex } from '../public/boxing/career.js';

test('career flow: Title to Career to Fight card to Fight to Result back to Career; Gym and decline return', () => {
  let s = 'title';
  for (const [ev, to] of [['career', 'career'], ['fight', 'card'], ['decline', 'career'], ['gym', 'gym'], ['back', 'career'], ['fight', 'card'], ['accept', 'fight'], ['finished', 'result'], ['career', 'career'], ['back', 'title']]) {
    s = navigate(s, ev); assert.equal(s, to);
  }
});

test('career offers are the same for a seed and week, differ by week, and scale with the tier', () => {
  const c = newCareer(7);
  assert.deepEqual(offersFor(c, 3), offersFor(c, 3));
  assert.notDeepEqual(offersFor(c, 3), offersFor(c, 4));
  const o = offersFor(c, 1);
  assert.equal(o.length, 2);
  assert.notEqual(o[0].name, o[1].name);
  for (const x of o) { assert.ok(x.rounds >= 1 && x.rounds <= 2); assert.ok(x.purse >= 40 && x.purse <= 90); }
  const pro = offersFor({ ...c, rep: 250 }, 1);
  assert.ok(pro.every((x) => x.rounds === 5 && x.purse >= 1500));
});

test('career: a win pays, raises rep and rank, and spends the week and energy; a KO loss injures', () => {
  const c = newCareer(1), offer = offersFor(c, 1)[0];
  const rank0 = rankOf(c);
  const w = applyFight(c, offer, 'w', true);
  assert.equal(w.career.week, 2);
  assert.equal(w.career.money, offer.purse);
  assert.equal(w.changes.repGain, 15);
  assert.ok(w.career.rep > 0 && rankOf(w.career) < rank0);
  assert.equal(w.career.energy, ENERGY.max - ENERGY.fight + ENERGY.weekly);
  const l = applyFight(c, offer, 'l', true);
  assert.equal(l.career.injury, 3 - 1);              // three weeks, one already passed
  assert.equal(l.career.money, Math.round(offer.purse / 4));
  assert.ok(l.career.rivals[offer.name].grudge);
  assert.equal(l.career.rep, 0);
});

test('career: a rival who beat you comes back two weeks later with a better edge; beating him clears it', () => {
  let c = newCareer(2);
  const offer = offersFor(c, 1)[0];
  c = applyFight(c, offer, 'l', false).career;                       // week 2 now
  assert.ok(!offersFor(c, 2).some((o) => o.rival));
  const back = offersFor(c, 3).find((o) => o.rival);
  assert.equal(back.name, offer.name);
  assert.ok(back.purse >= offer.purse * 0.5);
  c = applyFight(c, back, 'w', false).career;
  assert.equal(c.rivals[offer.name].grudge, false);
  assert.equal(c.rivals[offer.name].meetings, 2);
});

test('career: rep moves you up a tier, the ladder slots you in by rep', () => {
  assert.equal(tierIndex(0), 0); assert.equal(tierIndex(30), 1); assert.equal(tierIndex(250), 3);
  const c = { ...newCareer(1), rep: 12 };
  const rows = ladder(c);
  assert.equal(rows.length, TIERS[0].pool.length + 1);
  assert.equal(rows.filter((r) => r.you).length, 1);
  assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
  const up = applyFight({ ...newCareer(1), rep: 25 }, offersFor(newCareer(1), 1)[0], 'w', false);
  assert.equal(up.changes.promoted, 'Local circuit');
});

test('career: tiredness and injury lower stats, rest restores energy and heals', () => {
  const stats = { speed: 60, power: 60, stamina: 60, ringIQ: 60 };
  assert.deepEqual(effectiveStats(stats, newCareer(1)), stats);
  const tired = effectiveStats(stats, { ...newCareer(1), energy: 0 });
  assert.ok(tired.power < 50 && tired.power >= 40);
  assert.ok(effectiveStats(stats, { ...newCareer(1), injury: 2 }).power < 60);
  const r = rest({ ...newCareer(1), energy: 20, injury: 2 });
  assert.equal(r.energy, 65); assert.equal(r.injury, 1); assert.equal(r.week, 2);
});

test('gym drill: the marker is deterministic, centre taps score best, gains shrink as the stat rises, and it costs energy and a week', () => {
  assert.equal(markerAt(0, 2.4), 0);
  assert.equal(markerAt(1, 2.4), markerAt(1, 2.4));
  assert.ok(hitScore(0) > hitScore(0.2) && hitScore(0.2) > hitScore(0.5) && hitScore(0.9) === 0);
  const n = DRILLS.heavybag.hits;
  const perfect = drillResult('heavybag', Array(n).fill(0), 50);
  assert.deepEqual([perfect.gain, perfect.grade], [3, 'Perfect']);
  assert.equal(drillResult('heavybag', Array(n).fill(0), 70).gain, 2);
  assert.equal(drillResult('heavybag', Array(n).fill(0), 90).gain, 1);
  assert.equal(drillResult('heavybag', [], 50).gain, 0);
  assert.equal(drillResult('heavybag', Array(n).fill(0), 99).gain, 1);
  const c = newCareer(1), stats = { speed: 50, power: 50, stamina: 50, ringIQ: 50 };
  const d = applyDrill(c, stats, 'heavybag', perfect);
  assert.equal(d.stats.power, 53);
  assert.deepEqual(d.career.trained.power, { gain: 3, sessions: 1 });
  assert.equal(d.career.energy, ENERGY.max - ENERGY.drill + ENERGY.weekly);
  assert.equal(d.career.week, 2);
  assert.equal(canDrill({ ...c, energy: 19 }), false);
});

test('gym drills: speed bag, roadwork and sparring each train their own stat with deterministic scoring', () => {
  assert.deepEqual(['speedbag', 'roadwork', 'sparring'].map((k) => DRILLS[k].stat), ['speed', 'stamina', 'ringIQ']);
  assert.ok(DRILLS.speedbag.speed > DRILLS.heavybag.speed);
  assert.equal(beatAt(0.62, 0.62), 0);
  assert.ok(Math.abs(beatAt(0.62 * 3 - 0.01, 0.62)) < 0.05 && beatAt(0.62 * 1.5, 0.62) === -1);
  assert.ok(beatAt(0.62 + 0.1, 0.62) > 0 && beatAt(0.62 - 0.1, 0.62) < 0);
  const cue = SPAR_CUES[0], other = cue.side === 'L' ? 'R' : 'L';
  assert.equal(sparPos(cue, cue.side, 300), 1);           // slipped into the glove
  assert.equal(hitScore(sparPos(cue, other, 300)), 1);    // fast and correct
  assert.ok(hitScore(sparPos(cue, other, 500)) < 1 && hitScore(sparPos(cue, other, 500)) > 0);
  assert.equal(hitScore(sparPos(cue, other, 5000)), 0);
  const stats = { speed: 50, power: 50, stamina: 50, ringIQ: 50 };
  const good = drillResult('sparring', SPAR_CUES.map((c) => sparPos(c, c.side === 'L' ? 'R' : 'L', 300)), 50);
  assert.deepEqual([good.grade, good.gain], ['Perfect', 3]);
  assert.equal(drillResult('sparring', SPAR_CUES.map((c) => sparPos(c, c.side, 300)), 50).gain, 0);
  const d = applyDrill(newCareer(1), stats, 'roadwork', drillResult('roadwork', Array(DRILLS.roadwork.hits).fill(0), 50));
  assert.equal(d.stats.stamina, 53);
  assert.equal(d.career.trained.stamina.sessions, 1);
});

test('normalizeCareer drops junk and clamps numbers', () => {
  assert.equal(normalizeCareer(null), null);
  const n = normalizeCareer({ week: -4, money: 'x', rep: 1e12, energy: 500, injury: 99, rivals: { Bad: { arch: 'nope' }, Ok: { arch: 'slugger', w: 2, grudge: 1 } }, log: [{ text: 5 }], trained: { power: { gain: 2, sessions: 1 }, evil: {} } });
  assert.equal(n.week, 1); assert.equal(n.money, 0); assert.equal(n.rep, 1e6); assert.equal(n.energy, 100); assert.equal(n.injury, 6);
  assert.deepEqual(Object.keys(n.rivals), ['Ok']); assert.equal(n.rivals.Ok.grudge, true);
  assert.deepEqual(Object.keys(n.trained), ['power']);
});

test('trainer tip points at a stat the gym can train, tiredness first', async () => {
  const { trainerTip } = await import('../public/boxing/career.js');
  const stats = { speed: 10, power: 50, stamina: 50, ringIQ: 50 };
  assert.match(trainerTip(stats, newCareer(1)), /speed bag/);
  assert.match(trainerTip({ ...stats, speed: 60, power: 20 }, newCareer(1)), /heavy bag/);
  assert.match(trainerTip({ ...stats, speed: 60, ringIQ: 20 }, newCareer(1)), /Spar/);
  assert.match(trainerTip(stats, { ...newCareer(1), energy: 5 }), /Rest/);
  assert.match(trainerTip(stats, { ...newCareer(1), injury: 2 }), /hurt/);

});
test('impact events say where and how hard: contact point, direction, energy01, knockout', () => {
  const sim = new CombatSimulation({ seed: 3, rounds: 3, red: fighter('red', { ...AVG, power: 90 }), blue: fighter('blue', { ...AVG, power: 20 }) });
  const hits = [];
  sim.on('impact', (r) => hits.push(r));
  while (sim.phase !== 'fight_over') { sim.startRound({ red: 'pressure', blue: 'outbox' }); sim.runRoundToEnd(); }
  assert.ok(hits.length > 20);
  for (const r of hits) {
    const c = r.contact;
    assert.equal(c.region, r.outcome === 'landed' ? r.target : r.outcome === 'blocked' ? 'guard' : 'air');
    assert.ok(Math.abs(Math.hypot(c.dirX, c.dirY) - 1) < 1e-9);
    assert.ok(r.energy01 >= 0 && r.energy01 <= 1);
    assert.equal(r.energy01 === 0, r.transferredJoules === 0);
    assert.ok(Math.abs(c.x) <= RING_HALF_M && Math.abs(c.y) <= RING_HALF_M);
    assert.equal(c.heightM, r.target === 'body' ? 1.15 : 1.6);
    assert.equal(r.knockout, r.healthAfter[r.defender] <= 0);
  }
  const landed = hits.filter((r) => r.outcome === 'landed');
  const mean = (rs) => rs.reduce((s, r) => s + r.energy01, 0) / rs.length;
  assert.ok(mean(landed.filter((r) => r.attacker === 'red')) > mean(landed.filter((r) => r.attacker === 'blue')));
  assert.ok(hits.filter((r) => r.knockout).length <= 1);
});

test('the contact point sits on the defender surface, on the attacker side', () => {
  const sim = new CombatSimulation({ seed: 5, rounds: 1, red: fighter('red'), blue: fighter('blue') });
  const hits = [];
  sim.on('impact', (r) => { if (r.outcome === 'landed') hits.push({ r, red: { ...sim.fighters.red.pos }, blue: { ...sim.fighters.blue.pos } }); });
  sim.startRound({ red: 'pressure', blue: 'pressure' }); sim.runRoundToEnd();
  assert.ok(hits.length > 3);
  for (const { r, red, blue } of hits) {
    const [atk, def] = r.attacker === 'red' ? [red, blue] : [blue, red];
    assert.ok(Math.abs(Math.hypot(r.contact.x - def.x, r.contact.y - def.y) - 0.15) < 1e-9);
    assert.ok(Math.hypot(r.contact.x - atk.x, r.contact.y - atk.y) < Math.hypot(def.x - atk.x, def.y - atk.y));
  }
});

test('fighters stay inside the ropes and never overlap, tick by tick, across tactics and seeds', () => {
  const lim = RING_HALF_M - 0.25;
  for (const tactics of [{ red: 'pressure', blue: 'pressure' }, { red: 'pressure', blue: 'outbox' }, { red: 'outbox', blue: 'outbox' }]) {
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new CombatSimulation({ seed, rounds: 2, red: fighter('red', { ...AVG, speed: 90 }), blue: fighter('blue', { ...AVG, power: 90 }) });
      while (sim.phase !== 'fight_over') {
        sim.startRound(tactics);
        while (sim.phase === 'running') {
          sim.step();
          const { red, blue } = sim.fighters;
          for (const f of [red, blue]) assert.ok(Math.abs(f.pos.x) <= lim + 1e-9 && Math.abs(f.pos.y) <= lim + 1e-9);
          assert.ok(Math.hypot(red.pos.x - blue.pos.x, red.pos.y - blue.pos.y) >= 0.25 * 2.2 - 1e-9);
        }
      }
    }
  }
});

test('the sim output is pinned: contact data is read-only and no listener changes a result', () => {
  const run = (listen) => {
    const sim = new CombatSimulation({ seed: 11, rounds: 3, red: fighter('red', { ...AVG, speed: 70 }), blue: fighter('blue', { ...AVG, power: 70 }) });
    if (listen) { sim.on('impact', (r) => { r.contact.x = 99; r.energy01 = -1; }); sim.on('action', (e) => { e.contact.x = 99; e.energy01 = -1; }); }
    const pos = [];
    while (sim.phase !== 'fight_over') { sim.startRound({ red: 'pressure', blue: 'outbox' }); while (sim.phase === 'running') { sim.step(); pos.push(sim.fighters.red.pos.x, sim.fighters.blue.pos.y); } }
    return JSON.stringify([sim.rounds, sim.result, pos]);
  };
  assert.equal(run(false), run(true));
  assert.equal(createHash('sha256').update(run(false)).digest('hex'), PINNED_SEED_11);
});

test('damage by zone adds up the sim impacts per defender', () => {
  const sim = new CombatSimulation({ seed: 11, rounds: 3, red: fighter('red', AVG), blue: fighter('blue', AVG) });
  const dmg = emptyDamage(), seen = [];
  sim.on('impact', (p) => { seen.push(p); recordDamage(dmg, p); });
  while (sim.phase !== 'fight_over') { sim.startRound({ red: 'pressure', blue: 'body_attack' }); sim.runRoundToEnd(); }
  assert.ok(seen.length > 0);
  for (const c of ['red', 'blue']) {
    const expected = seen.filter((p) => p.defender === c).reduce((s, p) => s + p.damage, 0);
    const tally = DAMAGE_ZONES.reduce((s, z) => s + dmg[c][z].damage, 0);
    assert.ok(Math.abs(expected - tally) < 1e-9);
  }
  assert.ok(dmg.red.body.hits + dmg.blue.body.hits > 0, 'body_attack lands on the body');
  assert.equal(zoneOf({ outcome: 'landed', target: 'body' }), 'body');
  assert.equal(zoneOf({ outcome: 'landed', target: 'head' }), 'head');
  assert.equal(zoneOf({ outcome: 'blocked', target: 'head' }), 'guard');
  assert.equal(zoneOf({ outcome: 'slipped', target: 'head' }), null);
  assert.equal(zoneHeat(0), 0);
  assert.ok(zoneHeat(0.1) >= 0.25 && zoneHeat(500) === 1);
});

test('punch breakdown by type and round matches the round totals', () => {
  const sim = fight(11);
  const b = punchBreakdown(sim.rounds);
  assert.equal(b.perRound.length, sim.rounds.length);
  for (const c of ['red', 'blue']) {
    const thrown = PUNCH_TYPES.reduce((s, t) => s + b.byType[c][t].thrown, 0);
    const landed = PUNCH_TYPES.reduce((s, t) => s + b.byType[c][t].landed, 0);
    assert.equal(thrown, fightStats(sim.rounds)[c].thrown);
    assert.equal(landed, fightStats(sim.rounds)[c].landed);
    assert.equal(b.perRound.reduce((s, r) => s + r[c].landed, 0), landed);
  }
});

test('the AI corner plan follows its fixed rules and says why', () => {
  const st = (o = {}) => ({ speed: 50, power: 50, stamina: 50, ringIQ: 50, ...o });
  const me = (o = {}, f = {}) => ({ health: 100, gasRatio: 1, stats: st(o), ...f });
  assert.equal(aiPlan(me({}, { gasRatio: 0.2 }), me(), 0, 1).tactic, 'recover');
  assert.equal(aiPlan(me(), me({}, { gasRatio: 0.3 }), 0, 1).tactic, 'pressure');
  assert.equal(aiPlan(me({ ringIQ: 70 }), me({ power: 70 }), 0, 1).tactic, 'counter');
  assert.equal(aiPlan(me({ ringIQ: 40 }), me({ power: 70 }), 0, 1).tactic, 'outbox');
  assert.equal(aiPlan(me(), me({ stamina: 30 }), 0, 1).tactic, 'body_attack');
  assert.equal(aiPlan(me({ speed: 70 }), me(), 0, 1).tactic, 'outbox');
  const even = aiPlan(me(), me(), 2, 1);
  assert.ok(['pressure', 'outbox', 'counter', 'body_attack'].includes(even.tactic));
  assert.ok(even.reason.length > 10);
  assert.equal(aiPlan(me(), me(), 2, 1).tactic, even.tactic, 'deterministic');
});

test('fight IQ: stat sources split camp from gym, tendencies and the log summary are plain counts', async () => {
  const { statSources, tendencies, learnedFromLog, learnedLines, opponentKind } = await import('../public/boxing/fightiq.js');
  const src = statSources({ speed: 58, power: 50, stamina: 47, ringIQ: 52 }, { trained: { speed: { gain: 3, sessions: 2 } } });
  assert.equal(src.speed.gym, 3); assert.equal(src.speed.camp, 5);
  assert.match(src.speed.text, /\+5 training camp · \+3 gym \(2 sessions\)/);
  assert.match(src.stamina.text, /−3 below start/);
  assert.equal(statSources({ speed: 50, power: 50, stamina: 50, ringIQ: 50 }).power.text, 'Start 50');
  const t = tendencies({ speed: 80, power: 30, stamina: 50, ringIQ: 50 });
  assert.match(t.lines[0], /^Fast hands/); assert.match(t.lines[1], /^Light hitter/); assert.match(t.style, /Box outside/);
  assert.equal(opponentKind({ speed: 38, power: 82, stamina: 55, ringIQ: 42 }), 'puncher');
  assert.equal(opponentKind(AVG), 'balanced');
  assert.match(learnedLines(learnedFromLog([]))[0], /No rounds logged/);
  const sim = fight(7, AVG, { speed: 38, power: 82, stamina: 55, ringIQ: 42 });
  const rows = sim.rounds.map((r) => buildFightLogRow(r, { mode: 'single', seed: 7, fighters: { red: AVG, blue: { speed: 38, power: 82, stamina: 55, ringIQ: 42 } }, managerCorner: 'red' }));
  const learned = learnedFromLog(rows);
  assert.equal(learned.rounds, rows.length);
  assert.equal(learned.tactics.reduce((n, x) => n + x.rounds, 0), rows.length);
  assert.equal(learned.kinds[0].kind, 'puncher');
  assert.ok(learnedLines(learned).some((l) => /Against heavy hitters/.test(l)));
});

test('fighterSummary and changeLines: plain counts', async () => {
  const { fighterSummary, changeLines } = await import('../public/boxing/fightiq.js');
  const f = { record: { w: 2, l: 1, d: 0 }, stats: { speed: 56, power: 50, stamina: 50, ringIQ: 50 }, points: 3 };
  const none = fighterSummary(f, null);
  assert.match(none[0], /2-1-0 over 3 fights/);
  assert.match(none[1], /\+6 stat points/);
  assert.match(none[2], /no career/);
  const c = { energy: 30, injury: 2, trained: { speed: { gain: 4, sessions: 2 } } };
  const lines = fighterSummary(f, c);
  assert.match(lines[1], /\+2 stat points.*2 gym sessions/);
  assert.match(lines[2], /10% lower/);
  assert.match(lines[3], /2 weeks.*12%/);
  const ch = changeLines({ outcome: 'w', before: { w: 1, l: 0, d: 0 }, after: { w: 2, l: 0, d: 0 }, gained: 6, pointsAfter: 9, unlocked: [{ label: 'Varsity' }] });
  assert.match(ch[0], /1-0-0 → 2-0-0 \(win added\)/);
  assert.match(ch[2], /Unlocked: Varsity/);
});

// ─── BOX-17: 2D clip mapping (render-only) ───
import { CLIPS, ATTACK_CLIP, reactionClip, clipRate, planImpact, ShotDirector, postProfile, timecode } from '../public/boxing/clips2d.js';

test('2D: every punch type has an attack clip, every clip a sane definition, and reactions exist', () => {
  for (const t of Object.keys(PUNCHES)) assert.ok(CLIPS[ATTACK_CLIP[t]], t);
  for (const [id, c] of Object.entries(CLIPS)) {
    assert.ok(c.frames > 0 && c.fps > 0, id);
    if (c.impact != null) assert.ok(c.impact < c.frames, id);
  }
  const recs = [];
  for (const seed of [3, 11, 21]) {
    const sim = new CombatSimulation({ seed, rounds: 3, red: fighter('red'), blue: fighter('blue', { speed: 40, power: 80, stamina: 50, ringIQ: 40 }) });
    sim.on('impact', (r) => recs.push(r));
    while (sim.phase !== 'fight_over') { sim.startRound({ red: 'pressure', blue: 'body_attack' }); sim.runRoundToEnd(); }
  }
  assert.ok(recs.length > 50);
  const seen = new Set();
  for (const r of recs) {
    const plan = planImpact(r), c = reactionClip(r);
    assert.ok(CLIPS[c] && CLIPS[plan.attacker.clip], c);
    assert.equal(plan.defender.clip, c);
    seen.add(c);
    if (r.outcome === 'slipped') assert.equal(c, 'slip');
    if (r.outcome === 'blocked') assert.equal(c, 'block');
    if (r.outcome === 'landed') assert.ok(['hit_head', 'hit_body', 'stagger', 'ko'].includes(c));
    const rate = clipRate(plan.attacker.clip, r.launchTick, r.arriveTick);
    assert.ok(rate > 0 && Number.isFinite(rate));
  }
  for (const c of ['slip', 'block', 'hit_head']) assert.ok(seen.has(c), c);
});

test('2D: reactions by energy, KO and punch target; clip rate puts the impact frame on the arrival tick', () => {
  const base = { outcome: 'landed', target: 'head', energy01: 0.3, knockout: false };
  assert.equal(reactionClip(base), 'hit_head');
  assert.equal(reactionClip({ ...base, target: 'body' }), 'hit_body');
  assert.equal(reactionClip({ ...base, energy01: 0.9 }), 'stagger');
  assert.equal(reactionClip({ ...base, knockout: true }), 'ko');
  const c = CLIPS.atk_cross, simSec = 0.25, ticks = Math.round(simSec * 240);
  assert.ok(Math.abs((c.impact / c.fps) / clipRate('atk_cross', 100, 100 + ticks) - simSec) < 0.01);
  assert.equal(clipRate('idle_guard', 0, 50), 1);
});

test('2D: shot director cuts on heavy hits, holds 0.5-1.5 s, returns to medium, rate-limits, always cuts for KO', () => {
  const d = new ShotDirector();
  const hit = (e, o = {}) => ({ outcome: 'landed', target: 'head', attacker: 'red', defender: 'blue', type: 'cross', energy01: e, knockout: false, ...o });
  assert.equal(d.onImpact(hit(0.3), 1000), 'medium');
  assert.equal(d.onImpact(hit(1.0), 2000), 'close_red');
  assert.equal(d.update(2400), 'close_red');
  assert.equal(d.update(3600), 'medium');
  d.onImpact(hit(0.8, { attacker: 'blue' }), 3700);
  assert.equal(d.shot, 'medium', 'cooldown');
  assert.equal(d.onImpact(hit(0.1, { knockout: true }), 3800), 'ko_close');
  const soft = new ShotDirector(); soft.onImpact(hit(0.61), 0);
  assert.ok(soft.until >= 500 && soft.until <= 600);
});

test('2D: looks and post profile: filmic default, camcorder for replay/intro, low-end drops costly passes', () => {
  assert.equal(postProfile().look, 'filmic');
  assert.equal(postProfile('nonsense').look, 'filmic');
  assert.equal(postProfile('filmic', { replay: true }).look, 'camcorder');
  assert.equal(postProfile('filmic', { intro: true }).stamp, true);
  const low = postProfile('camcorder', { lowEnd: true });
  assert.deepEqual([low.bloom, low.grain, low.dof, low.wobble], [0, 0, false, 0]);
  assert.deepEqual(timecode('1994-07-04', 3, 75400), { date: '1994-07-04', clock: 'R3 01:15' });

// ─── Street moveset (BOX-22) ────────────────────────────────────────────────

const STREET_FAMILIES = ['jab', 'cross', 'hook', 'uppercut', 'body'];
const setup = (ruleset = 'street', seed = 5, tactics = { red: 'outbox', blue: 'outbox' }) => {
  const sim = new CombatSimulation({ seed, rounds: 3, roundSeconds: 35, ruleset, red: fighter('red'), blue: fighter('blue') });
  sim.startRound(tactics);
  sim.fighters.red.pos = { x: -0.35, y: 0 }; sim.fighters.blue.pos = { x: 0.35, y: 0 };
  const actions = [], hits = [];
  sim.on('action', (e) => actions.push(e)); sim.on('impact', (e) => hits.push(e));
  const steps = (n) => { for (let i = 0; i < n && sim.phase === 'running'; i++) sim.step(); };
  const ms = (m) => Math.ceil(m / TICK_MS);
  return { sim, red: sim.fighters.red, blue: sim.fighters.blue, actions, hits, steps, ms };
};
// Every fight of a tactic pair over several seeds, collecting impacts and actions.
const collect = (tactics, { ruleset = 'street', seeds = 8, seconds = 35 } = {}) => {
  const hits = [], actions = [], sims = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const sim = new CombatSimulation({ seed, rounds: 3, roundSeconds: seconds, ruleset, red: fighter('red'), blue: fighter('blue') });
    sim.on('impact', (e) => hits.push({ ...e, seed })); sim.on('action', (e) => actions.push({ ...e, seed }));
    while (sim.phase !== 'fight_over') { sim.startRound(tactics); sim.runRoundToEnd(); }
    sims.push(sim);
  }
  return { hits, actions, sims };
};

test('street strikes: each is a legacy-shaped punch with a hand, and a haymaker is slow, heavy and easy to read', () => {
  const street = ['haymaker', 'overhand', 'hook_body', 'shovel', 'short_upper', 'check_hook', 'cheap_shot'];
  for (const k of [...Object.keys(PUNCHES)]) {
    assert.ok(STREET_FAMILIES.includes(PUNCHES[k].family), k);
    assert.ok(['lead', 'rear'].includes(PUNCHES[k].hand), k);
  }
  for (const k of street) assert.ok(PUNCHES[k], k);
  const throwIt = (type) => { const r = fighter('red'), b = fighter('blue'); r.pos = { x: -0.45, y: 0 }; b.pos = { x: 0.45, y: 0 }; return computePunch({ attacker: r, defender: b, type, tick: 0, rng: mulberry32(2) }); };
  const hay = throwIt('haymaker'), cross = throwIt('cross'), jab = throwIt('jab');
  assert.equal(hay.type, 'hook'); assert.equal(hay.move, 'haymaker'); assert.equal(hay.hand, 'rear');
  assert.ok(hay.telegraphMs > 2 * jab.telegraphMs, 'big wind-up');
  assert.ok(hay.kineticJoules > 1.3 * cross.kineticJoules * 0.9 && hay.effectiveMassKg > cross.effectiveMassKg);
  assert.equal(throwIt('hook_body').target, 'body'); assert.equal(throwIt('shovel').target, 'body');
  assert.ok(PUNCHES.short_upper.reachFactor < PUNCHES.uppercut.reachFactor, 'short upper is the close one');
  assert.ok(PUNCHES.check_hook.counterOnly && PUNCHES.cheap_shot.afterBreak && PUNCHES.cheap_shot.foul);
});

test('street strikes show up in fights as impacts with move, hand, target, energy and contact', () => {
  const seen = new Set();
  for (const t of [{ red: 'brawl', blue: 'dirty_boxing' }, { red: 'pressure', blue: 'body_attack' }, { red: 'outbox', blue: 'counter' }]) {
    for (const h of collect(t, { seeds: 6 }).hits) {
      seen.add(h.move);
      assert.equal(h.type, PUNCHES[h.move].family); assert.equal(h.hand, PUNCHES[h.move].hand); assert.equal(h.target, PUNCHES[h.move].target);
      assert.ok(h.contact && typeof h.contact.x === 'number' && h.energy01 >= 0 && h.energy01 <= 1);
    }
  }
  for (const k of ['haymaker', 'overhand', 'hook_body', 'shovel', 'short_upper', 'jab', 'cross', 'hook', 'body']) assert.ok(seen.has(k), `${k} thrown`);
});

test('double jab and flurry: chained punches carry combo id, index and length, 2 for the double jab and 2-4 for a flurry', () => {
  const { hits } = collect({ red: 'outbox', blue: 'brawl' }, { seeds: 10 });
  const combos = new Map();
  for (const h of hits) if (h.combo) { const key = `${h.seed}:${h.attacker}:${h.combo.id}`; (combos.get(key) ?? combos.set(key, []).get(key)).push(h); }
  assert.ok(combos.size > 5);
  let doubles = 0, flurries = 0;
  for (const list of combos.values()) {
    const L = list[0].combo.length;
    assert.ok(L >= 2 && L <= 4);
    assert.ok(list.every((h, i) => h.combo.index === i && h.combo.length === L && h.attacker === list[0].attacker));
    assert.ok(list.every((h, i) => i === 0 || h.launchTick >= list[i - 1].arriveTick), 'a chain throws one punch after the other');
    if (L === 2 && list.every((h) => h.move === 'jab')) doubles++;
    if (L > 2) flurries++;
  }
  assert.ok(doubles > 0 && flurries > 0, `doubles ${doubles}, flurries ${flurries}`);
});

test('check hook is only ever thrown off a slip', () => {
  const { hits } = collect({ red: 'counter', blue: 'brawl' }, { seeds: 14 });
  const ch = hits.filter((h) => h.move === 'check_hook');
  assert.ok(ch.length > 0);
  assert.ok(ch.every((h) => h.isCounter));
});

test('clinch: both fighters lock up, forearm frame drains the other, and street ends with a push-off and a punch', () => {
  const { sim, red, blue, actions, hits, steps, ms } = setup('street');
  sim._startClinch(red, blue);
  assert.deepEqual(actions.map((a) => a.kind), ['clinch', 'forearm_frame']);
  assert.ok(red.clinch && blue.clinch && red.clinch.initiator && !blue.clinch.initiator);
  const before = { r: { ...red.pos }, b: { ...blue.pos }, gas: blue.gas };
  steps(ms(500));
  assert.deepEqual(red.pos, before.r); assert.deepEqual(blue.pos, before.b);
  assert.ok(sim.snapshot().red.clinch);
  assert.ok(red.gas > 0 && blue.gas < before.gas + 5, 'the frame wears the other fighter down');
  steps(ms(1900));
  assert.ok(!red.clinch && !blue.clinch);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('push_off') && !kinds.includes('ref_break'));
  const push = actions.find((a) => a.kind === 'push_off');
  assert.ok(push.energy01 > 0 && push.target === 'body');
  // The pusher throws right after (push-off then punch).
  steps(ms(600));
  assert.ok(hits.some((h) => h.attacker === push.corner && h.launchTick >= push.tick), 'a punch follows the push-off');
});

test('clinch under sanctioned rules is shorter and the ref breaks it: no push-off, both step back', () => {
  const a = setup('street'), b = setup('sanctioned');
  a.sim._startClinch(a.red, a.blue); b.sim._startClinch(b.red, b.blue);
  assert.ok(b.red.clinch.endTick < b.sim.tick + 1 + a.ms(RULESETS.sanctioned.clinchMs + 5));
  assert.ok(a.red.clinch.endTick - a.sim.tick >= a.ms(RULESETS.street.clinchMs) - 1);
  b.steps(b.ms(1000));
  const kinds = b.actions.map((x) => x.kind);
  assert.ok(kinds.includes('ref_break') && !kinds.includes('push_off'));
  assert.ok(b.red.push || b.sim.tick > 0);
  assert.ok(!b.red.clinch);
});

test('shove: street only; it pushes the other fighter back, staggers them and costs the shover time', () => {
  const { sim, red, blue, actions, steps, ms } = setup('street');
  const gap0 = blue.pos.x - red.pos.x;
  blue.queue = ['jab'];
  sim._shove(red, blue);
  const ev = actions[0];
  assert.equal(ev.kind, 'shove'); assert.equal(ev.target, 'body'); assert.ok(ev.energy01 > 0.2 && ev.contact.region === 'body');
  assert.ok(blue.committedUntilTick > sim.tick && red.committedUntilTick > sim.tick && blue.queue.length === 0);
  steps(ms(200));
  assert.ok(blue.pos.x - red.pos.x > gap0 + 0.3, 'pushed back');
  // Sanctioned fights never choose a shove; street fights do.
  const sanctioned = collect({ red: 'pressure', blue: 'dirty_boxing' }, { ruleset: 'sanctioned', seeds: 6 }).actions;
  const street = collect({ red: 'pressure', blue: 'dirty_boxing' }, { ruleset: 'street', seeds: 6 }).actions;
  assert.equal(sanctioned.filter((e) => e.kind === 'shove').length, 0);
  assert.ok(street.filter((e) => e.kind === 'shove').length > 3);
});

test('cheap shot: free in the street, a one-point foul under sanctioned rules, and a miss leaves the thrower open', () => {
  const st = setup('street'), sa = setup('sanctioned');
  st.sim._foul(st.red, st.blue, 'cheap_shot'); sa.sim._foul(sa.red, sa.blue, 'cheap_shot');
  assert.equal(st.actions.length, 0);
  assert.equal(sa.actions[0].kind, 'foul'); assert.equal(sa.actions[0].points, 1);
  sa.sim.runRoundToEnd();
  assert.equal(sa.sim.rounds[0].fouls.red, 1);
  assert.ok(sa.sim.rounds[0].cards.red <= 9 && sa.sim.rounds[0].cards.red + sa.sim.rounds[0].cards.blue < 20);
  assert.equal(st.sim.runRoundToEnd().fouls.red, 0);
  // It is rare, and the thrower is exposed after a miss.
  const { hits } = collect({ red: 'dirty_boxing', blue: 'brawl' }, { seeds: 12 });
  const cheap = hits.filter((h) => h.move === 'cheap_shot');
  const all = hits.length;
  assert.ok(cheap.length > 0 && cheap.length < all * 0.03, `${cheap.length} of ${all}`);
  assert.ok(cheap.every((h) => h.target === 'body'));
  const x = setup('street'); x.red.tactic = TACTICS.dirty_boxing;
  x.sim._launch(x.red, x.blue, 'cheap_shot', false);
  const p = x.sim.pending[0]; p.outcome = 'slipped'; p.transferredJoules = 0;
  x.sim.tick = p.arriveTick; x.sim._resolveArrivals();
  assert.ok(x.red.exposedUntilTick > x.sim.tick && x.blue.counterUntilTick > x.sim.tick);
});

test('feint: shoulder and step both happen, and the follow-up punch is harder to read', () => {
  const { sim, red, blue, actions } = setup('street');
  const kinds = new Set();
  for (let i = 0; i < 40; i++) { red.feintUntilTick = 0; sim._feint(red, blue); kinds.add(actions.at(-1).type); }
  assert.deepEqual([...kinds].sort(), ['shoulder', 'step']);
  assert.ok(actions.every((a) => a.kind === 'feint' && a.hand === 'lead'));
  const win = (fe) => { const r = fighter('red'), b = fighter('blue'); r.pos = { x: -0.45, y: 0 }; b.pos = { x: 0.45, y: 0 }; r.feintUntilTick = fe; return computePunch({ attacker: r, defender: b, type: 'cross', tick: 0, rng: mulberry32(9) }).reaction.windowMs; };
  const gain = win(100) - win(0);
  assert.ok(gain > 10 && gain < 40, `feint adds ${gain} ms`);
  assert.ok(win(100) - win(0) < win(100) + 1); // sanity
  const smart = (iq) => { const r = fighter('red'), b = fighter('blue', { ...AVG, ringIQ: iq }); r.pos = { x: -0.45, y: 0 }; b.pos = { x: 0.45, y: 0 }; const w = (f) => { r.feintUntilTick = f; return computePunch({ attacker: r, defender: b, type: 'cross', tick: 0, rng: mulberry32(9) }).reaction.windowMs; }; return w(100) - w(0); };
  assert.ok(smart(90) < smart(10), 'high Ring IQ reads a feint better');
});

test('taunt drains the other fighter\'s composure but leaves the taunter open; composure comes back', () => {
  const { sim, red, blue, actions, steps, ms } = setup('street');
  sim._taunt(red, blue);
  const ev = actions[0];
  assert.equal(ev.kind, 'taunt'); assert.ok(blue.composure < 100 && ev.energy01 > 0);
  const win = (def) => { const r = fighter('red'); r.pos = { x: -0.45, y: 0 }; def.pos = { x: 0.45, y: 0 }; return computePunch({ attacker: r, defender: def, type: 'jab', tick: 0, rng: mulberry32(4) }).reaction.windowMs; };
  const calm = fighter('blue'), rattled = fighter('blue'); rattled.composure = 60;
  assert.ok(win(rattled) > win(calm), 'a rattled fighter reads slower');
  const showboat = fighter('blue'); showboat.exposedUntilTick = 10;
  assert.ok(Math.abs(win(showboat) - win(calm) - 45) < 1e-9, 'a showboating fighter is open');
  const low = blue.composure; steps(ms(10000));
  assert.ok(blue.composure > low);
  assert.ok(red.exposedUntilTick > 0);
});

test('shell up: covered-up fighters take half damage from landed shots, and only the ropes bring it on', () => {
  const dmg = (shell) => {
    const { sim, red, blue } = setup('street');
    for (let seed = 1; seed < 60; seed++) {
      const r = fighter('red'), b = fighter('blue'); r.pos = { x: -0.4, y: 0 }; b.pos = { x: 0.4, y: 0 };
      const p = computePunch({ attacker: r, defender: b, type: 'cross', tick: sim.tick, rng: mulberry32(seed) });
      if (p.outcome !== 'landed') continue;
      sim.pending.push({ ...p, attacker: 'red', defender: 'blue', arriveTick: sim.tick });
      if (shell) blue.shellUntilTick = sim.tick + 10;
      sim._resolveArrivals();
      return 100 - blue.health;
    }
  };
  assert.ok(Math.abs(dmg(true) / dmg(false) - 0.5) < 1e-9);
  const { sim, red, blue, actions } = setup('street');
  sim._shell(blue, red);
  assert.equal(actions[0].kind, 'shell'); assert.equal(actions[0].contact.region, 'guard'); assert.ok(sim.snapshot().blue.shell);
  const { actions: acts, sims } = collect({ red: 'counter', blue: 'counter' }, { seeds: 6 });
  assert.ok(acts.some((a) => a.kind === 'shell'));
});

test('pivot out: from the ropes, a fighter slides sideways and ends nearer the middle', () => {
  const { sim, red, blue, actions, steps, ms } = setup('street');
  red.pos = { x: -2.7, y: 0.1 }; blue.pos = { x: -2.0, y: 0.9 };
  const d0 = Math.hypot(red.pos.x, red.pos.y);
  sim._pivot(red, blue);
  assert.equal(actions[0].kind, 'pivot');
  steps(ms(260));
  assert.ok(Math.hypot(red.pos.x + 2.7, red.pos.y - 0.1) > 0.25, 'moved');
  const ropeD = (f) => RING_HALF_M - Math.max(Math.abs(f.pos.x), Math.abs(f.pos.y));
  assert.ok(Math.hypot(red.pos.x, red.pos.y) < d0 - 0.1, 'ends nearer the middle'); assert.ok(ropeD(red) > 0.3);
});

test('circle off is reported as an action with its direction; slips, rolls, parries and shells label every impact', () => {
  const { actions, hits } = collect({ red: 'outbox', blue: 'counter' }, { seeds: 6 });
  const circ = actions.filter((a) => a.kind === 'circle_off');
  assert.ok(circ.length > 3 && circ.every((a) => a.dir === 1 || a.dir === -1));
  const all = hits.concat(collect({ red: 'brawl', blue: 'pressure' }, { seeds: 6 }).hits);
  const labels = new Set();
  for (const h of all) {
    if (h.outcome === 'slipped') assert.ok(['slip', 'roll', 'pull_back', 'pivot'].includes(h.defense), h.defense);
    else if (h.outcome === 'blocked') assert.ok(['parry', 'block', 'shell'].includes(h.defense), h.defense);
    else assert.ok(h.defense === null || h.defense === 'shell');
    if (h.outcome === 'slipped') assert.equal(h.defense, h.type === 'jab' || h.type === 'cross' ? 'slip' : h.type === 'hook' ? 'roll' : h.type === 'uppercut' ? 'pull_back' : 'pivot');
    if (h.defense) labels.add(h.defense);
  }
  for (const k of ['slip', 'roll', 'parry', 'block']) assert.ok(labels.has(k), k);
});

test('every action event has kind, type, corner, hand, target, energy and a contact point', () => {
  const actions = [['dirty_boxing', 'brawl'], ['brawl', 'outbox'], ['outbox', 'counter'], ['counter', 'recover']].flatMap(([red, blue]) => collect({ red, blue }, { seeds: 6 }).actions);
  const kinds = new Set(actions.map((a) => a.kind));
  for (const k of ['clinch', 'forearm_frame', 'shove', 'push_off', 'taunt', 'feint', 'circle_off']) assert.ok(kinds.has(k), k);
  for (const a of actions) {
    assert.ok(a.kind && a.type && ['red', 'blue'].includes(a.corner) && ['lead', 'rear', 'both'].includes(a.hand), a.kind);
    assert.ok(['head', 'body', 'none'].includes(a.target));
    assert.ok(a.energy01 >= 0 && a.energy01 <= 1);
    const c = a.contact;
    assert.ok(['head', 'body', 'guard', 'air'].includes(c.region) && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.heightM));
    assert.ok(Math.abs(Math.hypot(c.dirX, c.dirY) - 1) < 1e-9);
    assert.ok(a.endTick > a.startTick && a.round >= 1);
  }
});

test('rulesets: street by default, a bad name falls back to it, sanctioned never shoves; snapshot and round summary say which', () => {
  assert.equal(new CombatSimulation({ red: fighter('red'), blue: fighter('blue') }).ruleset, 'street');
  assert.equal(new CombatSimulation({ red: fighter('red'), blue: fighter('blue'), ruleset: 'x' }).ruleset, 'street');
  assert.deepEqual(Object.keys(RULESETS), ['street', 'sanctioned']);
  const { sims } = collect({ red: 'pressure', blue: 'dirty_boxing' }, { ruleset: 'sanctioned', seeds: 3 });
  assert.equal(sims[0].snapshot().ruleset, 'sanctioned');
  assert.equal(sims[0].rounds[0].ruleset, 'sanctioned');
  assert.ok(Object.values(sims[0].rounds[0].actions.red).every(Number.isInteger));
});

test('Brawl throws more haymakers and overhands, Dirty boxing clinches and works close, and both beat nothing by default', () => {
  assert.ok(TACTICS.brawl && TACTICS.dirty_boxing);
  const count = (tactics, red, pred) => collect(tactics, { seeds: 8 }).hits.filter((h) => h.attacker === red && pred(h)).length;
  const big = (h) => h.move === 'haymaker' || h.move === 'overhand';
  assert.ok(count({ red: 'brawl', blue: 'outbox' }, 'red', big) > 3 * count({ red: 'outbox', blue: 'brawl' }, 'red', big) + 5);
  const clinches = (t, who) => collect(t, { seeds: 8 }).actions.filter((a) => a.corner === who && a.kind === 'clinch').length;
  assert.ok(clinches({ red: 'dirty_boxing', blue: 'outbox' }, 'red') > 3 * clinches({ red: 'outbox', blue: 'dirty_boxing' }, 'red') + 3);
  assert.ok(TACTICS.dirty_boxing.rangeM < TACTICS.pressure.rangeM && TACTICS.brawl.defendMs < 0);
});

test('street fights are deterministic, actions included, and the short-round damage scale has a KO band', () => {
  const run = () => { const out = []; const sim = new CombatSimulation({ seed: 21, rounds: 3, roundSeconds: 35, red: fighter('red'), blue: fighter('blue') }); sim.on('action', (e) => out.push(e)); while (sim.phase !== 'fight_over') { sim.startRound({ red: 'dirty_boxing', blue: 'brawl' }); sim.runRoundToEnd(); } return JSON.stringify([out, sim.rounds, sim.result]); };
  assert.equal(run(), run());
  assert.equal(damageDivisorFor(180), 475);
  assert.ok(damageDivisorFor(35) < damageDivisorFor(60) && damageDivisorFor(60) < damageDivisorFor(180) && damageDivisorFor(10) === damageDivisorFor(35));
  // 3 x 35 s fights, every tactic pair, 4 seeds: some KOs, mostly decisions.
  const keys = Object.keys(TACTICS); let ko = 0, n = 0;
  for (const a of keys) for (const b of keys) for (let seed = 1; seed <= 4; seed++) {
    const sim = new CombatSimulation({ seed, rounds: 3, roundSeconds: 35, red: fighter('red'), blue: fighter('blue') });
    while (sim.phase !== 'fight_over') { sim.startRound({ red: a, blue: b }); sim.runRoundToEnd(); }
    n++; if (sim.result.method.startsWith('KO')) ko++;
  }
  assert.ok(ko / n >= 0.05 && ko / n <= 0.3, `KO rate ${ko / n}`);
});
