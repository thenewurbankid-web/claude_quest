/**
 * Boxing Manager AI: the televised 3D view, in Babylon.js.
 *
 * This layer is read-only. CombatSimulation stays the single source of truth: every frame we read
 * `sim.snapshot()`, and we listen to 'impact', 'round_end' and 'fight_end'. Nothing here writes to the
 * simulation, so P2P lockstep is unaffected. Something else (the headless Phaser game) steps the sim.
 *
 * The ring is the sim's 2D plane (metres, origin at the centre) laid on Babylon's ground: sim (x, y) → (x, 0, y).
 * Boxers are built from primitives and posed with two-bone IK each frame, so they need no downloaded assets;
 * a rigged model can replace `Boxer` later without touching the rest.
 */
import { RING_HALF_M, TICK_MS } from './physics-engine.js';
import { loadBoxerAssets, ModelBoxer } from './boxer-model.js';
import { v, add, sub, mul, dot, len, norm, lerp, bez, clamp, smooth, UP, rotateAbout, solveTwoBone } from './pose-math.js';

const BABYLON_SRC = '/vendor/babylonjs/babylon.js';
let babylonPromise = null;

/** Loads the UMD build once and resolves with the BABYLON global. */
export function loadBabylon(src = BABYLON_SRC) {
  if (globalThis.BABYLON) return Promise.resolve(globalThis.BABYLON);
  babylonPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(globalThis.BABYLON);
    s.onerror = () => { babylonPromise = null; reject(new Error(`could not load ${src}`)); };
    document.head.appendChild(s);
  });
  return babylonPromise;
}

// ─── Look ───────────────────────────────────────────────────────────────────

const LOOK = {
  postM: RING_HALF_M + 0.15,          // corner posts sit just outside the sim's ropes
  apronM: RING_HALF_M + 0.65,
  platformM: 1.15,                    // canvas height above the arena floor
  ropeHeights: [0.42, 0.72, 1.02, 1.32],
  ropeColors: ['#d8d8d8', '#c9343a', '#d8d8d8', '#2f6fd0'],
  canvas: '#c9ccd2',
  corners: { red: '#c9343a', blue: '#2f6fd0' },
  skin: { red: '#c68a62', blue: '#8a5a3c' },
  trunks: { red: '#b5222b', blue: '#1f4fa6' },
  crowdRows: 11,
};

// ─── Procedural textures (no files to download) ────────────────────────────────

function radialTexture(B, scene, name, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const t = new B.DynamicTexture(name, { width: 64, height: 64 }, scene, false);
  const g = t.getContext(), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64); t.update(); t.hasAlpha = true;
  return t;
}

function canvasTexture(B, scene) {
  const S = 1024, t = new B.DynamicTexture('canvasTex', { width: S, height: S }, scene, true);
  const g = t.getContext();
  g.fillStyle = LOOK.canvas; g.fillRect(0, 0, S, S);
  // Scuffs and resin marks, so the canvas doesn't read as flat plastic.
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * 0.05;
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,40,50' : '255,255,255'},${a})`;
    const r = 2 + Math.random() * 14;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); g.fill();
  }
  // Corner triangles in the corner colours (red at −x −z, blue at +x +z; the canvas texture's v runs along +z).
  const tri = (x, y, dx, dy, c) => { g.fillStyle = c; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y); g.lineTo(x, y + dy); g.fill(); g.globalAlpha = 1; };
  tri(0, S, 150, -150, LOOK.corners.red);
  tri(S, 0, -150, 150, LOOK.corners.blue);
  // Centre logo.
  g.strokeStyle = 'rgba(20,30,50,0.55)'; g.lineWidth = 10;
  g.beginPath(); g.arc(S / 2, S / 2, 150, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(20,30,50,0.55)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 64px system-ui, sans-serif'; g.fillText('BOXING', S / 2, S / 2 - 34);
  g.font = 'bold 44px system-ui, sans-serif'; g.fillText('MANAGER AI', S / 2, S / 2 + 34);
  t.update();
  return t;
}

// ─── The arena ────────────────────────────────────────────────────────────────

function buildArena(B, scene, shadow) {
  const mat = (name, hex, opts = {}) => {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.specularColor = new B.Color3(opts.spec ?? 0.08, opts.spec ?? 0.08, opts.spec ?? 0.08);
    if (opts.emissive) m.emissiveColor = B.Color3.FromHexString(opts.emissive);
    return m;
  };
  const P = LOOK.platformM;

  // Arena floor, dark.
  const floor = B.MeshBuilder.CreateGround('floor', { width: 80, height: 80 }, scene);
  floor.position.y = -P; floor.material = mat('floorM', '#0b0d12');

  // Platform: the canvas on top, a skirt below.
  const canvas = B.MeshBuilder.CreateGround('canvas', { width: LOOK.apronM * 2, height: LOOK.apronM * 2 }, scene);
  const cm = mat('canvasM', '#ffffff', { spec: 0.05 }); cm.diffuseTexture = canvasTexture(B, scene);
  canvas.material = cm; canvas.receiveShadows = true;
  const skirt = B.MeshBuilder.CreateBox('skirt', { width: LOOK.apronM * 2, depth: LOOK.apronM * 2, height: P }, scene);
  skirt.position.y = -P / 2 - 0.005; skirt.material = mat('skirtM', '#14161c');
  const apronEdge = B.MeshBuilder.CreateBox('apronEdge', { width: LOOK.apronM * 2 + 0.06, depth: LOOK.apronM * 2 + 0.06, height: 0.12 }, scene);
  apronEdge.position.y = -0.065; apronEdge.material = mat('apronEdgeM', '#1d2330');

  // Corner posts and turnbuckle pads. Red corner −x −z, blue +x +z, neutral (white) the others.
  const c = LOOK.postM, top = LOOK.ropeHeights.at(-1) + 0.12;
  const corners = [
    { x: -c, z: -c, col: LOOK.corners.red }, { x: c, z: -c, col: '#e8e8e8' },
    { x: c, z: c, col: LOOK.corners.blue }, { x: -c, z: c, col: '#e8e8e8' },
  ];
  const postM = mat('postM', '#9aa3ad', { spec: 0.6 });
  for (const k of corners) {
    const post = B.MeshBuilder.CreateCylinder('post', { height: top, diameter: 0.09 }, scene);
    post.position.set(k.x, top / 2, k.z); post.material = postM; shadow.addShadowCaster(post);
    const pad = B.MeshBuilder.CreateBox('pad', { width: 0.22, depth: 0.22, height: top - 0.25 }, scene);
    const inward = norm(v(-k.x, 0, -k.z));
    pad.position.set(k.x + inward.x * 0.1, (top - 0.25) / 2 + 0.2, k.z + inward.z * 0.1);
    pad.rotation.y = Math.PI / 4; pad.material = mat('padM' + k.col, k.col, { spec: 0.25 });
  }

  // Ropes: four strands, each a closed loop through the four posts.
  LOOK.ropeHeights.forEach((h, i) => {
    const path = [v(-c, h, -c), v(c, h, -c), v(c, h, c), v(-c, h, c), v(-c, h, -c)].map((p) => new B.Vector3(p.x, p.y, p.z));
    const rope = B.MeshBuilder.CreateTube('rope' + i, { path, radius: 0.022, tessellation: 10 }, scene);
    rope.material = mat('ropeM' + i, LOOK.ropeColors[i], { spec: 0.35 });
  });

  // Steps in the two neutral corners, and stools in the fighters' corners.
  const stoolM = mat('stoolM', '#2a2f38', { spec: 0.2 });
  for (const s of [{ x: -c + 0.45, z: -c + 0.45 }, { x: c - 0.45, z: c - 0.45 }]) {
    const seat = B.MeshBuilder.CreateCylinder('stool', { height: 0.05, diameter: 0.38 }, scene);
    seat.position.set(s.x, 0.48, s.z); seat.material = stoolM;
    for (const o of [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]]) {
      const leg = B.MeshBuilder.CreateCylinder('stoolLeg', { height: 0.46, diameter: 0.025 }, scene);
      leg.position.set(s.x + o[0], 0.23, s.z + o[1]); leg.material = postM;
    }
  }

  // Lighting rig: a square truss over the ring with glowing light panels.
  const trussY = 6.8, trussR = 4.6;
  const trussM = mat('trussM', '#1b1f27', { spec: 0.3 });
  const panelM = mat('panelM', '#000000', { emissive: '#fff4dc' });
  for (let i = 0; i < 4; i++) {
    const beam = B.MeshBuilder.CreateBox('truss', { width: trussR * 2 + 0.3, height: 0.28, depth: 0.28 }, scene);
    beam.material = trussM; beam.position.y = trussY;
    if (i < 2) beam.position.z = i ? trussR : -trussR; else { beam.rotation.y = Math.PI / 2; beam.position.x = i === 2 ? trussR : -trussR; }
    for (let j = -3; j <= 3; j++) {
      const panel = B.MeshBuilder.CreateBox('lamp', { width: 0.42, height: 0.08, depth: 0.42 }, scene);
      panel.material = panelM; panel.position.y = trussY - 0.18;
      if (i < 2) { panel.position.x = j * 1.25; panel.position.z = i ? trussR : -trussR; }
      else { panel.position.z = j * 1.25; panel.position.x = i === 2 ? trussR : -trussR; }
    }
  }
  // A big scoreboard cube hanging over the ring.
  const cube = B.MeshBuilder.CreateBox('jumbotron', { size: 1.6 }, scene);
  cube.scaling.y = 0.7; cube.position.y = trussY + 1.4; cube.material = mat('cubeM', '#05070b', { emissive: '#1c2a44' });

  // Ringside: press tables along two sides.
  const tableM = mat('tableM', '#20252e');
  for (const z of [-(LOOK.apronM + 1.0), LOOK.apronM + 1.0]) {
    const table = B.MeshBuilder.CreateBox('table', { width: 6.5, height: 0.08, depth: 0.7 }, scene);
    table.position.set(0, -P + 0.75, z); table.material = tableM;
    for (let x = -2.6; x <= 2.6; x += 1.3) {
      const screen = B.MeshBuilder.CreatePlane('laptop', { width: 0.32, height: 0.2 }, scene);
      screen.position.set(x, -P + 0.9, z + (z < 0 ? 0.15 : -0.15)); screen.rotation.y = z < 0 ? Math.PI : 0;
      screen.material = mat('laptopM', '#000000', { emissive: '#7fa6d8' });
    }
  }

  return { canvas, crowd: buildCrowd(B, scene) };
}

/** Tiered stands on all four sides, one thin-instanced mesh, plus camera flashes. */
function buildCrowd(B, scene) {
  const body = B.MeshBuilder.CreateBox('crowdBody', { width: 0.42, height: 0.62, depth: 0.28 }, scene);
  const head = B.MeshBuilder.CreateSphere('crowdHead', { diameter: 0.22, segments: 6 }, scene);
  head.position.y = 0.44;
  const person = B.Mesh.MergeMeshes([body, head], true);
  person.name = 'crowd';
  const m = new B.StandardMaterial('crowdM', scene);
  m.diffuseColor = new B.Color3(1, 1, 1); m.specularColor = new B.Color3(0, 0, 0);
  person.material = m;

  const seats = [];
  const P = LOOK.platformM;
  const rand = mulberryish(7);
  for (let side = 0; side < 4; side++) {
    for (let row = 0; row < LOOK.crowdRows; row++) {
      const dist = LOOK.apronM + 2.6 + row * 0.85;
      const y = -P + 0.31 + row * 0.42 + (row > 0 ? 0.3 : 0);
      const span = dist * 2 + 1;
      for (let s = -span / 2; s <= span / 2; s += 0.55) {
        if (rand() < 0.07) continue; // empty seat
        let x = s, z = -dist;
        if (side === 1) { x = dist; z = s; } else if (side === 2) { x = -s; z = dist; } else if (side === 3) { x = -dist; z = -s; }
        seats.push({ x: x + (rand() - 0.5) * 0.1, y, z, yaw: Math.atan2(-x, -z), phase: rand() * Math.PI * 2, row });
      }
    }
  }
  const palette = ['#2b2f3a', '#3d3a36', '#5a2e2e', '#2e3f5a', '#4a4a4a', '#6b5b45', '#1e2a22', '#5b5f6b', '#7a3b2f', '#22262e'];
  const mats = new Float32Array(seats.length * 16), cols = new Float32Array(seats.length * 4);
  seats.forEach((s, i) => {
    const c = B.Color3.FromHexString(palette[Math.floor(rand() * palette.length)]);
    const dim = 0.55 + 0.45 * (1 - s.row / LOOK.crowdRows);
    cols.set([c.r * dim, c.g * dim, c.b * dim, 1], i * 4);
  });
  person.thinInstanceSetBuffer('matrix', mats, 16, false);
  person.thinInstanceSetBuffer('color', cols, 4, true);
  const tmp = new B.Matrix(), q = new B.Quaternion(), sc = new B.Vector3(1, 1, 1), pos = new B.Vector3();

  // Flash bulbs: tiny additive particles scattered through the stands.
  const flashes = new B.ParticleSystem('flashes', 200, scene);
  flashes.particleTexture = radialTexture(B, scene, 'flashTex');
  const R = LOOK.apronM + 2.6, R2 = R + LOOK.crowdRows * 0.85;
  flashes.emitter = new B.Vector3(0, 0, 0);
  flashes.startPositionFunction = (_w, out) => {
    const side = Math.floor(Math.random() * 4), d = R + Math.random() * (R2 - R), s = (Math.random() - 0.5) * 2 * d;
    const y = -P + 0.6 + ((d - R) / 0.85) * 0.42;
    out.copyFromFloats(side === 0 ? s : side === 1 ? d : side === 2 ? -s : -d, y, side === 0 ? -d : side === 1 ? s : side === 2 ? d : -s);
  };
  flashes.minLifeTime = 0.04; flashes.maxLifeTime = 0.09;
  flashes.minSize = 0.25; flashes.maxSize = 0.6;
  flashes.color1 = new B.Color4(1, 1, 1, 1); flashes.color2 = new B.Color4(0.85, 0.9, 1, 1);
  flashes.colorDead = new B.Color4(1, 1, 1, 0);
  flashes.direction1 = flashes.direction2 = new B.Vector3(0, 0, 0);
  flashes.minEmitPower = flashes.maxEmitPower = 0;
  flashes.emitRate = 4; flashes.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  flashes.start();

  let excite = 0;
  return {
    /** Crowd bounce; `excite` jumps on big moments and settles. */
    update(t, dt) {
      excite = Math.max(0, excite - dt * 0.6);
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        const bob = Math.max(0, Math.sin(t * (2 + excite * 6) + s.phase)) * (0.015 + excite * 0.12);
        pos.set(s.x, s.y + bob, s.z);
        B.Quaternion.RotationYawPitchRollToRef(s.yaw + Math.sin(t * 0.3 + s.phase) * 0.15, 0, 0, q);
        B.Matrix.ComposeToRef(sc, q, pos, tmp);
        tmp.copyToArray(mats, i * 16);
      }
      person.thinInstanceBufferUpdated('matrix');
    },
    roar(amount) {
      excite = Math.min(1, excite + amount);
      flashes.manualEmitCount = Math.round(amount * 40);
    },
    get count() { return seats.length; },
  };
}

function mulberryish(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ─── A boxer, built from primitives and posed with IK ───────────────────────────────

const BODY = {
  thigh: 0.46, shin: 0.45, upperArm: 0.30, forearm: 0.27,
  hipH: 0.9, chestUp: 0.42, shoulderHalf: 0.2, headUp: 0.27,
  guardLead: { f: 0.34, r: -0.1, u: 1.47 },
  guardRear: { f: 0.2, r: 0.11, u: 1.5 },
  stanceTwist: 0.42,                 // orthodox: left shoulder forward
};
/** Which hand throws what (orthodox). side −1 = left/lead, +1 = right/rear. */
const HAND = { jab: -1, cross: 1, hook: -1, uppercut: 1, body: -1 };

class Boxer {
  constructor(B, scene, corner, shadow) {
    this.B = B; this.corner = corner;
    const m = (name, hex, spec = 0.12, power = 32) => {
      const mt = new B.StandardMaterial(name + corner, scene);
      mt.diffuseColor = B.Color3.FromHexString(hex); mt.specularColor = new B.Color3(spec, spec, spec); mt.specularPower = power;
      return mt;
    };
    const skin = m('skin', LOOK.skin[corner], 0.22, 24), trunks = m('trunks', LOOK.trunks[corner], 0.3, 40);
    const glove = m('glove', LOOK.corners[corner], 0.55, 64), shoe = m('shoe', '#111318', 0.3);
    const band = m('band', '#f1f1f1', 0.2), hair = m('hair', '#1a1410', 0.05);
    this.meshes = [];
    const keep = (mesh, mat) => { mesh.material = mat; shadow.addShadowCaster(mesh); this.meshes.push(mesh); return mesh; };
    const cyl = (name, d, mat, top) => keep(B.MeshBuilder.CreateCylinder(name, { height: 1, diameterTop: top ?? d, diameterBottom: d, tessellation: 14 }, scene), mat);
    const sph = (name, d, mat) => keep(B.MeshBuilder.CreateSphere(name, { diameter: d, segments: 12 }, scene), mat);

    this.parts = {
      thighL: cyl('thighL', 0.15, skin, 0.19), thighR: cyl('thighR', 0.15, skin, 0.19),
      shinL: cyl('shinL', 0.1, skin, 0.14), shinR: cyl('shinR', 0.1, skin, 0.14),
      kneeL: sph('kneeL', 0.13, skin), kneeR: sph('kneeR', 0.13, skin),
      bootL: keep(B.MeshBuilder.CreateBox('bootL', { width: 0.11, height: 0.14, depth: 0.27 }, scene), shoe),
      bootR: keep(B.MeshBuilder.CreateBox('bootR', { width: 0.11, height: 0.14, depth: 0.27 }, scene), shoe),
      trunks: keep(B.MeshBuilder.CreateCylinder('trunks', { height: 0.3, diameterTop: 0.36, diameterBottom: 0.4, tessellation: 18 }, scene), trunks),
      belt: keep(B.MeshBuilder.CreateCylinder('belt', { height: 0.07, diameter: 0.37, tessellation: 18 }, scene), band),
      abdomen: cyl('abdomen', 0.27, skin, 0.33),
      chest: sph('chest', 1, skin),
      neck: cyl('neck', 0.11, skin),
      head: sph('head', 0.23, skin),
      hair: sph('hair', 0.235, hair),
      uArmL: cyl('uArmL', 0.11, skin, 0.13), uArmR: cyl('uArmR', 0.11, skin, 0.13),
      fArmL: cyl('fArmL', 0.085, skin, 0.105), fArmR: cyl('fArmR', 0.085, skin, 0.105),
      shoulderL: sph('shoulderL', 0.14, skin), shoulderR: sph('shoulderR', 0.14, skin),
      elbowL: sph('elbowL', 0.095, skin), elbowR: sph('elbowR', 0.095, skin),
      gloveL: sph('gloveL', 1, glove), gloveR: sph('gloveR', 1, glove),
      cuffL: cyl('cuffL', 0.1, band), cuffR: cyl('cuffR', 0.1, band),
    };
    this.parts.chest.scaling.set(0.44, 0.36, 0.27);
    this.parts.gloveL.scaling.set(0.15, 0.15, 0.18);
    this.parts.gloveR.scaling.set(0.15, 0.15, 0.18);
    this.parts.hair.scaling.set(1, 0.6, 1);
    for (const p of Object.values(this.parts)) p.rotationQuaternion = new B.Quaternion();

    // Render-side animation state. None of this feeds back into the sim.
    this.feet = null;                  // planted foot positions { L, R, stepping }
    this.headKick = v(); this.headVel = v();
    this.crouch = 0; this.crouchVel = 0;
    this.lastPunch = null;             // the punch the arms are still finishing
    this.retract = null;               // { from, side, startT }
    this.fall = 0;                     // 0 standing → 1 flat on the canvas
    this.wobble = 0;
  }

  /** Called by the impact listener: a landed or blocked punch kicks the head or folds the body. */
  hit(record, fromDir) {
    const j = record.transferredJoules;
    if (record.outcome === 'landed') {
      if (record.target === 'body') { this.crouchVel += clamp(j / 900, 0.1, 0.5); }
      else {
        const k = clamp(j / 220, 0.25, 1.6);
        this.headVel = add(this.headVel, add(mul(fromDir, k), mul(UP, k * (record.type === 'uppercut' ? 0.8 : 0.1))));
      }
    } else if (record.outcome === 'blocked') {
      this.headVel = add(this.headVel, mul(fromDir, clamp(j / 600, 0.05, 0.3)));
    }
  }

  /** Poses the boxer for this frame. `tick` is the sim's tick in this round; `now` keeps counting across rounds. */
  pose(me, opp, tick, now, dt, time) {
    const B = this.B;
    const root = v(me.x, 0, me.y);
    const oppRoot = v(opp.x, 0, opp.y);
    const f = norm(v(opp.x - me.x, 0, opp.y - me.y));
    const r = v(f.z, 0, -f.x);
    const at = (o, base = root, ff = f, rr = r) => add(add(add(base, mul(ff, o.f ?? 0)), mul(rr, o.r ?? 0)), mul(UP, o.u ?? 0));

    // Springs: head snap and body fold settle back on their own.
    const kSpring = 90, damp = 12;
    this.headVel = add(this.headVel, mul(add(mul(this.headKick, -kSpring), mul(this.headVel, -damp)), dt));
    this.headKick = add(this.headKick, mul(this.headVel, dt));
    this.crouchVel += (-kSpring * 0.6 * this.crouch - damp * this.crouchVel) * dt;
    this.crouch = clamp(this.crouch + this.crouchVel * dt, -0.05, 0.3);

    const tired = 1 - me.gasRatio, hurt = 1 - me.health / 100;
    this.wobble = hurt > 0.7 ? (hurt - 0.7) * 0.35 : 0;

    // ── the punch in progress (ours) and the defence against theirs ──
    let ap = me.activePunch;
    if (ap) this.lastPunch = ap;
    let punch = null;
    if (ap) {
      const k = clamp((tick - ap.launchTick) / Math.max(1, ap.arriveTick - ap.launchTick), 0, 1);
      punch = { type: ap.type, k, outcome: ap.outcome };
      this.retract = null;
    } else if (this.lastPunch) {
      this.retract = { type: this.lastPunch.type, outcome: this.lastPunch.outcome, start: now };
      this.lastPunch = null;
    }
    const retractTicks = 36; // ~150 ms of sim time
    let back = 0;
    if (this.retract) {
      back = clamp((now - this.retract.start) / retractTicks, 0, 1);
      if (back >= 1) this.retract = null;
    }

    const theirs = opp.activePunch;
    let guardUp = 0, slip = 0, slipSide = 0;
    if (theirs) {
      const k = clamp((tick - theirs.launchTick) / Math.max(1, theirs.arriveTick - theirs.launchTick), 0, 1);
      if (theirs.outcome === 'blocked') guardUp = smooth(clamp((k - 0.25) / 0.5, 0, 1));
      else if (theirs.outcome === 'slipped') { slip = smooth(clamp((k - 0.3) / 0.6, 0, 1)); slipSide = HAND[theirs.type] > 0 ? 1 : -1; }
      else guardUp = 0.25 * k;      // saw it late
    }

    // ── torso ──
    let twist = BODY.stanceTwist, lean = 0.08 + tired * 0.05, dip = 0;
    const bounce = Math.sin(time * 9.5 + (this.corner === 'red' ? 0 : 1.7)) * 0.018 * (1 - tired * 0.6);
    const pk = punch ? punch.k : this.retract ? 1 - back : 0;
    const pType = punch?.type ?? this.retract?.type;
    if (pType) {
      const e = smooth(clamp((pk - 0.3) / 0.7, 0, 1));
      const windup = pk < 0.3 ? Math.sin((pk / 0.3) * Math.PI) : 0;
      if (pType === 'cross') { twist += -0.75 * e + 0.12 * windup; lean += 0.1 * e; }
      else if (pType === 'jab') { twist += 0.12 * e; lean += 0.06 * e; }
      else if (pType === 'hook') { twist += -0.55 * e + 0.2 * windup; }
      else if (pType === 'uppercut') { twist += -0.5 * e; dip += 0.1 * windup - 0.04 * e; }
      else if (pType === 'body') { twist += -0.3 * e; dip += 0.14 * Math.max(e, windup); lean += 0.12 * e; }
    }
    lean += slip * 0.12; dip += slip * 0.08 + this.crouch;
    const hipH = BODY.hipH - dip + bounce - tired * 0.03;
    const sway = v(Math.sin(time * 1.7) * this.wobble, 0, Math.cos(time * 1.3) * this.wobble);
    const slipOff = mul(r, slipSide * slip * 0.14);
    const hips = add(add(add(root, mul(UP, hipH)), slipOff), sway);

    // Torso frame, twisted around UP.
    const tf = norm(add(mul(f, Math.cos(twist)), mul(r, -Math.sin(twist))));
    const tr = v(tf.z, 0, -tf.x);
    const chest = add(add(hips, mul(UP, BODY.chestUp)), add(mul(f, lean * 0.6), mul(slipOff, 0.6)));
    const shoulderL = add(add(chest, mul(tr, -BODY.shoulderHalf)), mul(UP, 0.07));
    const shoulderR = add(add(chest, mul(tr, BODY.shoulderHalf)), mul(UP, 0.07));
    const neckBase = add(chest, mul(UP, 0.1));
    const head = add(add(add(neckBase, mul(UP, 0.17)), mul(f, lean * 0.4 - 0.02)), add(mul(this.headKick, 1), mul(slipOff, 0.8)));

    // ── arms ──
    const target = (type) => type === 'body'
      ? add(oppRoot, mul(UP, 1.12))
      : add(add(oppRoot, mul(UP, 1.6)), mul(f, -0.08));
    const gap = Math.hypot(opp.x - me.x, opp.y - me.y);
    const room = clamp((gap - 0.55) / 0.5, 0, 1);       // 0 in a clinch, 1 at range
    const guardHigh = (o) => ({ f: (o.f - 0.1 * guardUp) * (0.45 + 0.55 * room), r: o.r * (1 - 0.6 * guardUp), u: o.u + 0.08 * guardUp - tired * 0.12 });
    const gloveGuard = {
      [-1]: add(at(guardHigh(BODY.guardLead)), add(slipOff, v(0, -dip, 0))),
      [1]: add(at(guardHigh(BODY.guardRear)), add(slipOff, v(0, -dip, 0))),
    };
    const shoulders = { [-1]: shoulderL, [1]: shoulderR };
    const glove = { [-1]: gloveGuard[-1], [1]: gloveGuard[1] };

    if (pType) {
      const side = HAND[pType], sh = shoulders[side], g0 = gloveGuard[side];
      const tgt = target(pType);
      const reach = BODY.upperArm + BODY.forearm + 0.05;
      const toT = sub(tgt, sh);
      const end = add(sh, mul(norm(toT), Math.min(len(toT), reach)));
      const e = smooth(clamp((pk - 0.3) / 0.7, 0, 1));
      const w = pk < 0.3 ? Math.sin((pk / 0.3) * Math.PI) * 0.05 : 0;
      let g;
      if (pType === 'jab' || pType === 'cross') {
        g = lerp(g0, end, e);
      } else if (pType === 'hook') {
        const ctrl = add(add(sh, mul(r, side * 0.5)), add(mul(f, 0.25), mul(UP, -0.02)));
        g = bez(g0, ctrl, add(end, mul(r, side * 0.06)), e);
      } else if (pType === 'uppercut') {
        const ctrl = add(add(sh, mul(f, 0.12)), mul(UP, -0.42));
        g = bez(g0, ctrl, add(end, mul(UP, -0.08)), e);
      } else {
        const ctrl = add(add(sh, mul(r, side * 0.32)), mul(UP, -0.3));
        g = bez(g0, ctrl, end, e);
      }
      glove[side] = add(g, mul(f, -w)); // the small cock back is the telegraph
    }

    // ── legs: feet stay planted and step when the body moves away from them ──
    const footIdeal = { L: at({ f: 0.2, r: -0.13 }), R: at({ f: -0.22, r: 0.15 }) };
    if (!this.feet) this.feet = { L: footIdeal.L, R: footIdeal.R, step: null };
    const F = this.feet;
    if (F.step) {
      F.step.t += dt / 0.13;
      if (F.step.t >= 1) { F[F.step.foot] = F.step.to; F.step = null; }
    }
    if (!F.step) {
      const dL = len(sub(F.L, footIdeal.L)), dR = len(sub(F.R, footIdeal.R));
      const foot = dL > dR ? 'L' : 'R', d = Math.max(dL, dR);
      if (d > 0.14) F.step = { foot, from: F[foot], to: footIdeal[foot], t: 0 };
    }
    const footPos = (k) => {
      if (F.step?.foot === k) { const t = smooth(F.step.t); return add(lerp(F.step.from, F.step.to, t), mul(UP, Math.sin(t * Math.PI) * 0.06)); }
      return F[k];
    };
    const ankleL = add(footPos('L'), mul(UP, 0.09)), ankleR = add(footPos('R'), mul(UP, 0.09));
    const hipL = add(hips, mul(tr, -0.1)), hipR = add(hips, mul(tr, 0.1));
    const legL = solveTwoBone(hipL, ankleL, BODY.thigh, BODY.shin, add(f, mul(r, -0.3)));
    const legR = solveTwoBone(hipR, ankleR, BODY.thigh, BODY.shin, add(f, mul(r, 0.3)));

    const armPole = (side) => add(add(mul(UP, -1), mul(r, side * 0.6)), mul(f, -0.2));
    const wristTarget = (side) => add(glove[side], mul(norm(sub(glove[side], shoulders[side])), -0.07));
    const armL = solveTwoBone(shoulderL, wristTarget(-1), BODY.upperArm, BODY.forearm, armPole(-1));
    const armR = solveTwoBone(shoulderR, wristTarget(1), BODY.upperArm, BODY.forearm, armPole(1));
    const gloveL = add(armL.end, mul(norm(sub(armL.end, armL.mid)), 0.07));
    const gloveR = add(armR.end, mul(norm(sub(armR.end, armR.mid)), 0.07));

    // ── knockdown: tip the whole figure back around its feet ──
    const fallAng = smooth(this.fall) * 1.45;
    const pivot = lerp(footPos('L'), footPos('R'), 0.5);
    const fx = (p) => (fallAng ? add(rotateAbout(p, pivot, r, -fallAng), mul(UP, 0.12 * smooth(this.fall))) : p);

    // ── place meshes ──
    const P = this.parts;
    const seg = (mesh, a, b) => {
      a = fx(a); b = fx(b);
      const d = sub(b, a), l = len(d);
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      mesh.scaling.y = l;
      B.Quaternion.FromUnitVectorsToRef(B.Vector3.UpReadOnly, new B.Vector3(d.x / l, d.y / l, d.z / l), mesh.rotationQuaternion);
    };
    const put = (mesh, p, yawDir = tf, pitch = 0) => {
      p = fx(p);
      mesh.position.set(p.x, p.y, p.z);
      B.Quaternion.RotationYawPitchRollToRef(Math.atan2(yawDir.x, yawDir.z), pitch - (fallAng || 0), 0, mesh.rotationQuaternion);
    };
    seg(P.thighL, legL.mid, hipL); seg(P.thighR, legR.mid, hipR);
    seg(P.shinL, legL.end, legL.mid); seg(P.shinR, legR.end, legR.mid);
    put(P.kneeL, legL.mid); put(P.kneeR, legR.mid);
    put(P.bootL, add(footPos('L'), v(0, 0.07, 0)), add(f, mul(r, -0.35))); put(P.bootR, add(footPos('R'), v(0, 0.07, 0)), add(f, mul(r, 0.5)));
    put(P.trunks, add(hips, mul(UP, -0.06))); put(P.belt, add(hips, mul(UP, 0.09)));
    seg(P.abdomen, add(hips, mul(UP, 0.08)), add(chest, mul(UP, -0.1)));
    put(P.chest, chest, tf, lean * 0.5);
    seg(P.neck, neckBase, head);
    put(P.head, head, f); put(P.hair, add(head, mul(UP, 0.035)), f);
    put(P.shoulderL, shoulderL); put(P.shoulderR, shoulderR);
    seg(P.uArmL, armL.mid, shoulderL); seg(P.uArmR, armR.mid, shoulderR);
    seg(P.fArmL, armL.end, armL.mid); seg(P.fArmR, armR.end, armR.mid);
    put(P.elbowL, armL.mid); put(P.elbowR, armR.mid);
    seg(P.cuffL, armL.end, add(armL.end, mul(norm(sub(armL.mid, armL.end)), 0.08)));
    seg(P.cuffR, armR.end, add(armR.end, mul(norm(sub(armR.mid, armR.end)), 0.08)));
    const gloveDir = (end, mid) => norm(sub(end, mid));
    put(P.gloveL, gloveL, gloveDir(armL.end, armL.mid)); put(P.gloveR, gloveR, gloveDir(armR.end, armR.mid));

    return { head: fx(head), chest: fx(chest), gloveL: fx(gloveL), gloveR: fx(gloveR), hips: fx(hips) };
  }

  dispose() { for (const m of this.meshes) m.dispose(); }
}

// ─── Broadcast direction: cameras, cuts, lower thirds ─────────────────────────────

function makeOverlay(parent) {
  const el = document.createElement('div');
  el.className = 'bm3d-overlay';
  el.innerHTML = `
    <style>
      .bm3d-overlay { position:absolute; inset:0; pointer-events:none; font-family: system-ui, sans-serif; color:#fff; }
      .bm3d-bug { position:absolute; top:12px; left:14px; font: 600 11px/1 system-ui; letter-spacing:.12em; opacity:.8; text-shadow:0 1px 2px #000; }
      .bm3d-bug b { color:#e5484d; }
      .bm3d-banner { position:absolute; left:50%; top:40%; transform:translate(-50%,-50%) scale(.96); padding:10px 26px;
        background:linear-gradient(90deg,rgba(10,14,22,.0),rgba(10,14,22,.85) 15%,rgba(10,14,22,.85) 85%,rgba(10,14,22,0));
        font: 800 clamp(18px,4vw,34px)/1.1 system-ui; letter-spacing:.14em; text-transform:uppercase; opacity:0;
        transition: opacity .35s, transform .35s; white-space:nowrap; text-align:center; }
      .bm3d-banner small { display:block; font: 600 clamp(10px,1.6vw,13px)/1.4 system-ui; letter-spacing:.1em; opacity:.8; }
      .bm3d-banner.on { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .bm3d-third { position:absolute; left:14px; right:14px; bottom:12px; display:flex; justify-content:space-between; gap:8px; }
      .bm3d-third div { background:rgba(8,12,20,.72); padding:5px 10px; border-left:3px solid; font: 600 12px/1.3 system-ui; }
      .bm3d-third div small { display:block; font-weight:400; opacity:.75; font-size:10.5px; }
      .bm3d-cam { position:absolute; top:12px; right:14px; font: 600 10px/1 ui-monospace,monospace; opacity:.6; }
    </style>
    <div class="bm3d-bug">BM<b>AI</b> · LIVE</div>
    <div class="bm3d-cam"></div>
    <div class="bm3d-banner"></div>
    <div class="bm3d-third">
      <div data-c="red" style="border-color:${LOOK.corners.red}"></div>
      <div data-c="blue" style="border-color:${LOOK.corners.blue};text-align:right"></div>
    </div>`;
  parent.appendChild(el);
  const banner = el.querySelector('.bm3d-banner');
  let bannerTimer = 0;
  return {
    el,
    banner(text, sub = '', ms = 2200) {
      banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      if (ms) bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    third(corner, name, line) { el.querySelector(`[data-c="${corner}"]`).innerHTML = `${name}<small>${line}</small>`; },
    cam(label) { el.querySelector('.bm3d-cam').textContent = label; },
    dispose() { clearTimeout(bannerTimer); el.remove(); },
  };
}

const TACTIC_LABEL = { pressure: 'Pressure', outbox: 'Box outside', counter: 'Counter-punch', body_attack: 'Body attack', recover: 'Recover' };

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Mounts the 3D view in `parent` and starts rendering. Returns { destroy }.
 * names: { red, blue } for the lower thirds.
 */
export async function createArena3D({ parent, sim, names = {}, BABYLON: B = globalThis.BABYLON }) {
  B ??= await loadBabylon();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
  canvas.setAttribute('aria-label', '3D view of the fight');
  parent.appendChild(canvas);
  const overlay = makeOverlay(parent);

  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, antialias: true }, true);
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0.02, 0.025, 0.035, 1);
  scene.ambientColor = new B.Color3(0.25, 0.25, 0.3);
  scene.fogMode = B.Scene.FOGMODE_EXP2; scene.fogDensity = 0.022; scene.fogColor = new B.Color3(0.02, 0.025, 0.035);

  // Lights: dim house light, a hard overhead key for the shadows, and warm spots on the canvas.
  const hemi = new B.HemisphericLight('house', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.28; hemi.diffuse = new B.Color3(0.6, 0.68, 0.85); hemi.groundColor = new B.Color3(0.08, 0.07, 0.07);
  const key = new B.DirectionalLight('key', new B.Vector3(0.12, -1, 0.18), scene);
  key.position = new B.Vector3(-1, 12, -2); key.intensity = 1.25; key.diffuse = new B.Color3(1, 0.96, 0.9);
  for (const [x, z] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
    const s = new B.SpotLight('spot', new B.Vector3(x, 6.5, z), new B.Vector3(-x * 0.12, -1, -z * 0.12), Math.PI / 3, 6, scene);
    s.intensity = 0.55; s.diffuse = new B.Color3(1, 0.93, 0.82); s.specular = new B.Color3(0.6, 0.6, 0.6);
  }
  const shadow = new B.ShadowGenerator(2048, key);
  shadow.useBlurExponentialShadowMap = true; shadow.blurKernel = 16; shadow.darkness = 0.35;

  const arena = buildArena(B, scene, shadow);
  // Rigged Quaternius boxers when the models load; the primitive boxers otherwise.
  let boxers;
  try {
    const assets = await loadBoxerAssets(B, scene);
    boxers = Object.fromEntries(['red', 'blue'].map((c) => [c, new ModelBoxer(B, scene, assets, c, shadow, { glove: LOOK.corners[c], trunks: LOOK.trunks[c] })]));
  } catch (err) {
    console.warn('boxer models unavailable, using primitive boxers:', err);
    boxers = { red: new Boxer(B, scene, 'red', shadow), blue: new Boxer(B, scene, 'blue', shadow) };
  }

  // Sweat and spit on clean shots.
  const spray = new B.ParticleSystem('spray', 400, scene);
  spray.particleTexture = radialTexture(B, scene, 'sprayTex', 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  spray.emitter = new B.Vector3(0, 1.6, 0);
  spray.minEmitBox = spray.maxEmitBox = new B.Vector3(0, 0, 0);
  spray.minSize = 0.012; spray.maxSize = 0.035; spray.minLifeTime = 0.25; spray.maxLifeTime = 0.6;
  spray.color1 = new B.Color4(0.95, 0.97, 1, 0.9); spray.color2 = new B.Color4(0.8, 0.85, 0.95, 0.6); spray.colorDead = new B.Color4(1, 1, 1, 0);
  spray.gravity = new B.Vector3(0, -9.8, 0); spray.minEmitPower = 1.2; spray.maxEmitPower = 3.2;
  spray.emitRate = 0; spray.blendMode = B.ParticleSystem.BLENDMODE_ADD; spray.start();

  // Cameras: the hard camera on one side of the ring tracks the fighters; cuts go ringside on big shots.
  const cam = new B.UniversalCamera('broadcast', new B.Vector3(0, 3.2, -9), scene);
  cam.fov = 0.62; cam.minZ = 0.05; cam.maxZ = 120;
  scene.activeCamera = cam;
  const shot = { mode: 'hard', until: 0, pos: cam.position.clone(), look: new B.Vector3(0, 1.2, 0), shake: 0, side: 1 };

  // Post: broadcast grade, bloom on the lights, vignette.
  const pipe = new B.DefaultRenderingPipeline('broadcast', true, scene, [cam]);
  pipe.fxaaEnabled = true; pipe.samples = 4;
  pipe.bloomEnabled = true; pipe.bloomThreshold = 0.75; pipe.bloomWeight = 0.35; pipe.bloomKernel = 48;
  pipe.imageProcessingEnabled = true;
  pipe.imageProcessing.toneMappingEnabled = true; pipe.imageProcessing.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipe.imageProcessing.exposure = 1.25; pipe.imageProcessing.contrast = 1.25;
  pipe.imageProcessing.vignetteEnabled = true; pipe.imageProcessing.vignetteWeight = 2.2; pipe.imageProcessing.vignetteColor = new B.Color4(0, 0, 0, 0);
  const glow = new B.GlowLayer('glow', scene); glow.intensity = 0.5;

  // Events (read only).
  let lastPose = { red: null, blue: null };
  let roundBase = 0;      // keeps `now` increasing across rounds, since sim.tick restarts each round
  const offs = [
    sim.on('impact', (p) => {
      const def = boxers[p.defender], atkPose = lastPose[p.attacker], defPose = lastPose[p.defender];
      if (!atkPose || !defPose) return;
      const from = norm(sub(defPose.head, atkPose.chest));
      def.hit(p, v(from.x, 0, from.z));
      if (p.outcome === 'landed') {
        const at = p.target === 'body' ? defPose.chest : defPose.head;
        spray.emitter = new B.Vector3(at.x, at.y, at.z);
        spray.direction1 = new B.Vector3(from.x * 0.6 - 0.4, 0.6, from.z * 0.6 - 0.4);
        spray.direction2 = new B.Vector3(from.x * 1.2 + 0.4, 1.2, from.z * 1.2 + 0.4);
        spray.manualEmitCount = Math.round(clamp(p.transferredJoules / 6, 6, 60));
        const big = p.transferredJoules > 140 || (p.target !== 'body' && p.type !== 'jab' && p.transferredJoules > 100);
        shot.shake = Math.max(shot.shake, clamp(p.transferredJoules / 1500, 0.02, 0.12));
        arena.crowd.roar(big ? 0.6 : 0.12);
        if (big && performance.now() > shot.until) cut('ringside', 1400, p.defender);
      }
    }),
    sim.on('round_end', (s) => {
      roundBase += 1e8;
      if (s.reason === 'ko') return;
      overlay.banner(`End of round ${s.round_index}`, s.winner === 'even' ? 'Even round' : `${names[s.winner] ?? s.winner} takes it`, 2600);
      cut('wide', 1e9);
    }),
    sim.on('fight_end', (res) => {
      const ko = /KO/.test(res.method);
      if (ko) {
        const loser = res.winner === 'red' ? 'blue' : 'red';
        boxers[loser].knocked = true;
        arena.crowd.roar(1);
        cut('ringside', 1e9, loser);
      }
      overlay.banner(ko ? 'Knockout!' : res.method, res.winner === 'draw' ? 'Draw' : `${names[res.winner] ?? res.winner} wins`, 0);
    }),
  ];

  function cut(mode, ms, focus) {
    shot.mode = mode; shot.until = performance.now() + ms; shot.focus = focus;
    shot.snap = true;
    overlay.cam({ hard: 'CAM 1', ringside: 'CAM 3 · RINGSIDE', wide: 'CAM 2 · WIDE' }[mode]);
  }
  cut('hard', 0);

  let lastPhase = null, lastRound = 0, time = 0;
  const step = () => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    time += dt;
    const s = sim.snapshot();
    const now = roundBase + s.tick;
    if (s.phase !== lastPhase || s.round !== lastRound) {
      if (s.phase === 'running' && (lastPhase !== 'running' || s.round !== lastRound)) {
        overlay.banner(`Round ${s.round}`, `of ${sim.totalRounds}`, 1600);
        cut('hard', 0);
      }
      lastPhase = s.phase; lastRound = s.round;
    }
    for (const c of ['red', 'blue']) {
      overlay.third(c, names[c] ?? c, `${TACTIC_LABEL[s[c].tactic] ?? s[c].tactic} · ${Math.round(s[c].health)} hp`);
      const b = boxers[c];
      if (b.knocked || s[c].health <= 0) b.fall = Math.min(1, b.fall + dt / 0.85);
      else b.fall = Math.max(0, b.fall - dt / 1.5);
    }
    lastPose.red = boxers.red.pose(s.red, s.blue, s.tick, now, dt, time);
    lastPose.blue = boxers.blue.pose(s.blue, s.red, s.tick, now, dt, time);

    // Camera.
    if (shot.mode !== 'hard' && performance.now() > shot.until) cut('hard', 0);
    const mid = v((s.red.x + s.blue.x) / 2, 1.25, (s.red.y + s.blue.y) / 2);
    const gap = Math.hypot(s.red.x - s.blue.x, s.red.y - s.blue.y);
    let want, look;
    if (shot.mode === 'wide') {
      const a = time * 0.12;
      want = v(Math.sin(a) * 11, 6.5, -Math.cos(a) * 11); look = v(0, 0.6, 0);
    } else if (shot.mode === 'ringside') {
      const axis = norm(v(s.blue.x - s.red.x, 0, s.blue.y - s.red.y));
      let perp = v(axis.z, 0, -axis.x);
      if (perp.z > 0) perp = mul(perp, -1);           // stay on the camera side of the ring
      if (shot.focus && boxers[shot.focus].knocked) {
        // The KO: side-on to the line between them, so the one on the canvas lies full length below the one standing.
        // Take whichever side has more room inside the ropes.
        const loser = lastPose[shot.focus].hips, winner = lastPose[shot.focus === 'red' ? 'blue' : 'red'].hips;
        const c = v((loser.x + winner.x) / 2, 0, (loser.z + winner.z) / 2);
        const axis = norm(v(loser.x - winner.x, 0, loser.z - winner.z)), side = v(axis.z, 0, -axis.x);
        const inside = RING_HALF_M - 0.3;
        const at = (sgn) => add(c, mul(side, sgn * 3.0));
        const room = (p) => Math.max(Math.abs(p.x), Math.abs(p.z));
        const pick = room(at(1)) < room(at(-1)) ? at(1) : at(-1);
        want = v(clamp(pick.x, -inside, inside), 1.85, clamp(pick.z, -inside, inside));
        look = v(c.x, 0.95, c.z);
      } else {
        const fp = shot.focus ? lastPose[shot.focus].head : mid;
        want = add(add(mid, mul(perp, 2.6)), v(0, -0.15, 0)); look = lerp(mid, fp, 0.5);
      }
    } else {
      const dist = 5.6 + gap * 0.9;
      want = v(mid.x * 0.55, 2.3 + gap * 0.25, mid.z * 0.35 - dist); look = mid;
    }
    const k = shot.snap ? 1 : 1 - Math.exp(-dt * (shot.mode === 'wide' ? 1.5 : 4));
    shot.snap = false;
    shot.pos = B.Vector3.Lerp(shot.pos, new B.Vector3(want.x, want.y, want.z), k);
    shot.look = B.Vector3.Lerp(shot.look, new B.Vector3(look.x, look.y, look.z), k);
    shot.shake *= Math.exp(-dt * 9);
    const j = () => (Math.random() - 0.5) * shot.shake;
    cam.position.copyFromFloats(shot.pos.x + j(), shot.pos.y + j(), shot.pos.z + j());
    cam.setTarget(shot.look);

    arena.crowd.update(time, dt);
  };
  scene.onBeforeRenderObservable.add(step);
  engine.runRenderLoop(() => scene.render());

  const ro = new ResizeObserver(() => engine.resize());
  ro.observe(parent);

  const api = {
    scene, engine, boxers, cut,
    destroy() {
      for (const off of offs) off();
      ro.disconnect();
      engine.stopRenderLoop();
      scene.dispose(); engine.dispose();
      canvas.remove(); overlay.dispose();
    },
  };
  // ?debug exposes the view for poking at it from the console (e.g. __bmArena.boxers.blue.knocked = true;
  // __bmArena.cut('ringside', 5000, 'blue')).
  if (new URLSearchParams(location.search).has('debug')) globalThis.__bmArena = api;
  return api;
}

// Exposed for tests: the pose maths is plain JS and needs no WebGL.
export const _internals = { solveTwoBone, rotateAbout, HAND, TICK_MS };
