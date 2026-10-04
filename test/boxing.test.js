// Boxing Manager AI: deterministic physics, the collision rule, telemetry shape, and RAG ranking. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FighterModel, CombatSimulation, computePunch, mulberry32, PUNCHES, TACTICS, RING_HALF_M } from '../public/boxing/physics-engine.js';
import { buildFightLogRow, rankPrecedents, similarity, profileTags, successScore, toLLMContext } from '../public/boxing/game-db.js';

const PINNED_SEED_11 = '23f33a511243c1efa74eb1ebc68d7466f6605a642f3aa073e0f3c94470bbce02'; // from the engine before contact data was added;
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
  assert.equal(run('outbox') - run('pressure'), TACTICS.pressure.crowdMs);
});

// ─── Game flow (flow.js): screens, progression, unlocks, scorecards, corner tips, settings ───
import { SCREENS, navigate, eventsFrom, statCost, REWARDS, outcomeOf, UNLOCKS, isUnlocked, lockedLook, newUnlocks, scorecard, fightStats, cornerTip, normalizeSettings, DEFAULT_SETTINGS } from '../public/boxing/flow.js';

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
import { ENERGY, TIERS, newCareer, normalizeCareer, effectiveStats, ladder, rankOf, offersFor, rest, applyFight, DRILLS, markerAt, hitScore, drillResult, applyDrill, canDrill, tierIndex } from '../public/boxing/career.js';

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
  assert.match(trainerTip(stats, newCareer(1)), /heavy bag/);
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
    if (listen) sim.on('impact', (r) => { r.contact.x = 99; r.energy01 = -1; });
    const pos = [];
    while (sim.phase !== 'fight_over') { sim.startRound({ red: 'pressure', blue: 'outbox' }); while (sim.phase === 'running') { sim.step(); pos.push(sim.fighters.red.pos.x, sim.fighters.blue.pos.y); } }
    return JSON.stringify([sim.rounds, sim.result, pos]);
  };
  assert.equal(run(false), run(true));
  assert.equal(createHash('sha256').update(run(false)).digest('hex'), PINNED_SEED_11);
});
