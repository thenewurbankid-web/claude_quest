/**
 * Boxing Manager AI: the 3D street-fight view, in Babylon.js (a back lot at night, filmed like a broadcast).
 *
 * This layer is read-only. CombatSimulation stays the single source of truth: every frame we read
 * `sim.snapshot()`, and we listen to 'impact', 'round_end' and 'fight_end'. Nothing here writes to the
 * simulation, so P2P lockstep is unaffected. Something else (the headless Phaser game) steps the sim.
 *
 * The sim's 2D ring (metres, origin at the centre) is a square sprayed on the asphalt: sim (x, y) → (x, 0, y).
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
  yardM: 13,                          // the back lot: buildings stand this far from the centre on every side
  wallH: 11,
  corners: { red: '#d8343c', blue: '#2f7ae0' },
  skin: { red: '#c68a62', blue: '#8a5a3c' },
  trunks: { red: '#9e1c24', blue: '#1b3f86' },
  wraps: '#ece6da',
  neon: { pink: '#ff2d95', cyan: '#19e3ff', lime: '#a6ff3a', amber: '#ffb02e' },
  sodium: new Float32Array([1, 0.62, 0.28]),
};

// ─── Procedural textures (no files to download) ────────────────────────────────

function radialTexture(B, scene, name, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const t = new B.DynamicTexture(name, { width: 64, height: 64 }, scene, false);
  const g = t.getContext(), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64); t.update(); t.hasAlpha = true;
  return t;
}

/** Tiling wet asphalt: aggregate speckle, cracks, oil stains and darker puddles. */
function asphaltTexture(B, scene) {
  const S = 1024, t = new B.DynamicTexture('asphaltTex', { width: S, height: S }, scene, true);
  const g = t.getContext(), rand = mulberryish(11);
  g.fillStyle = '#2a2b2f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const c = rand() < 0.5 ? 20 + rand() * 25 : 60 + rand() * 50;
    g.fillStyle = `rgba(${c},${c},${c + 4},${0.25 + rand() * 0.4})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }
  // Puddles and oil: soft dark blobs (they read as wet once the reflection lands on them).
  for (let i = 0; i < 14; i++) {
    const x = rand() * S, y = rand() * S, r = 30 + rand() * 110;
    const grd = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    grd.addColorStop(0, `rgba(6,7,10,${0.55 + rand() * 0.3})`); grd.addColorStop(1, 'rgba(6,7,10,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rand() * 0.5), rand() * 3, 0, Math.PI * 2); g.fill();
  }
  // Cracks: jittered random walks.
  g.strokeStyle = 'rgba(8,8,10,0.75)'; g.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    let x = rand() * S, y = rand() * S, a = rand() * Math.PI * 2;
    g.lineWidth = 1 + rand() * 2.5; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 30; k++) { a += (rand() - 0.5) * 0.9; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
    g.stroke();
  }
  t.update();
  return t;
}

/** The fight spot, spray-painted on the asphalt: a rough square on the sim's ring, a centre X and tags. Alpha only. */
function paintTexture(B, scene, sizeM) {
  const S = 1024, t = new B.DynamicTexture('paintTex', { width: S, height: S }, scene, true);
  const g = t.getContext(), rand = mulberryish(5), px = S / sizeM;
  g.clearRect(0, 0, S, S);
  const spray = (pts, col, w) => {
    for (let pass = 0; pass < 3; pass++) {
      g.strokeStyle = col; g.globalAlpha = pass ? 0.18 : 0.7; g.lineWidth = w * (1 + pass * 1.4); g.lineJoin = 'round';
      g.beginPath();
      pts.forEach(([x, y], i) => { const j = () => (rand() - 0.5) * w * 0.6; i ? g.lineTo(x + j(), y + j()) : g.moveTo(x, y); });
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const edge = (a, b, n = 14) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  const h = RING_HALF_M * px, c = S / 2;
  const sq = [[c - h, c - h], [c + h, c - h], [c + h, c + h], [c - h, c + h], [c - h, c - h]];
  spray(sq.slice(0, -1).flatMap((p, i) => edge(p, sq[i + 1])), '#f4f1e8', 9);
  // Corner marks in the fighters' colours (red at −x −z, blue at +x +z; v runs along +z).
  g.fillStyle = LOOK.corners.red; g.globalAlpha = 0.8; g.beginPath(); g.arc(c - h, c + h, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = LOOK.corners.blue; g.beginPath(); g.arc(c + h, c - h, 26, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  spray(edge([c - 40, c - 40], [c + 40, c + 40], 4), '#f4f1e8', 7);
  spray(edge([c + 40, c - 40], [c - 40, c + 40], 4), '#f4f1e8', 7);
  g.save(); g.translate(c, c + h + 70); g.rotate(-0.04);
  g.font = '900 64px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.globalAlpha = 0.75;
  g.fillStyle = '#ffd23f'; g.fillText('NO ROPES', 0, 0); g.restore();
  t.hasAlpha = true; t.update();
  return t;
}

/** Tiling brick, 4 m × 2 m per tile. */
function brickTexture(B, scene) {
  const W = 512, H = 256, t = new B.DynamicTexture('brickTex', { width: W, height: H }, scene, true);
  const g = t.getContext(), rand = mulberryish(3);
  g.fillStyle = '#2b2522'; g.fillRect(0, 0, W, H);
  const bw = W / 18, bh = H / 30;
  for (let r = 0; r < 30; r++) {
    for (let k = -1; k < 19; k++) {
      const x = k * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
      const base = 70 + rand() * 40, red = base + 30 + rand() * 20;
      g.fillStyle = `rgb(${red | 0},${(base * 0.55) | 0},${(base * 0.42) | 0})`;
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  // Grime: soot from the top, damp from the bottom.
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(10,10,12,0.35)'); grd.addColorStop(0.6, 'rgba(10,10,12,0.05)'); grd.addColorStop(1, 'rgba(10,10,12,0.4)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE;
  t.update();
  return t;
}

/** A graffiti piece: outlined bubble letters with a drop shadow and drips. Alpha. */
function graffitiTexture(B, scene, name, word, fill, outline) {
  const W = 1024, H = 384, t = new B.DynamicTexture(name, { width: W, height: H }, scene, true);
  const g = t.getContext(), rand = mulberryish(word.length * 97);
  g.clearRect(0, 0, W, H);
  g.font = `900 ${Math.min(230, 1500 / word.length)}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.06); g.transform(1, 0, -0.18, 1, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(word, 14, 14);
  g.lineWidth = 26; g.strokeStyle = outline; g.strokeText(word, 0, 0);
  const grd = g.createLinearGradient(0, -90, 0, 90);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, fill); grd.addColorStop(1, fill);
  g.fillStyle = grd; g.fillText(word, 0, 0);
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.strokeText(word, -3, -3);
  g.restore();
  g.fillStyle = fill;
  for (let i = 0; i < 12; i++) { const x = W * (0.15 + rand() * 0.7), y = H * (0.6 + rand() * 0.1); g.fillRect(x, y, 3, 20 + rand() * 70); }
  t.hasAlpha = true; t.update();
  return t;
}

/** Neon sign text on transparent, drawn bright so the glow layer picks it up. */
function neonTexture(B, scene, name, text, col) {
  const W = 512, H = 160, t = new B.DynamicTexture(name, { width: W, height: H }, scene, true);
  const g = t.getContext();
  g.clearRect(0, 0, W, H);
  g.font = `700 ${Math.min(110, 700 / text.length)}px "Brush Script MT", "Segoe Script", cursive, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = col; g.shadowBlur = 24; g.fillStyle = col; g.fillText(text, W / 2, H / 2);
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.fillText(text, W / 2, H / 2);
  t.hasAlpha = true; t.update();
  return t;
}

function chainLinkTexture(B, scene) {
  const S = 128, t = new B.DynamicTexture('fenceTex', { width: S, height: S }, scene, true);
  const g = t.getContext();
  g.clearRect(0, 0, S, S); g.strokeStyle = 'rgba(190,195,200,1)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S); g.moveTo(S, 0); g.lineTo(0, S); g.stroke();
  t.hasAlpha = true; t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.update();
  return t;
}

// ─── The street ───────────────────────────────────────────────────────────────

/**
 * A back lot at night: wet asphalt with the fight spot sprayed on it, brick buildings with lit windows and graffiti,
 * neon signs, a sodium street lamp, string lights across the yard, fire barrels, two cars with their headlights on
 * the fight, a chain-link fence, a steaming manhole, rain, and a ring of onlookers.
 * Returns the pieces the caller wires up: { ground, crowd, update(t, dt) }.
 */
function buildStreet(B, scene, shadow) {
  const rand = mulberryish(21);
  const mat = (name, hex, opts = {}) => {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    // Matte throughout (the user asked for no shiny graphics): `spec` is capped so nothing reads as gloss.
    const s = Math.min(opts.spec ?? 0.04, 0.1); m.specularColor = new B.Color3(s, s, s); m.specularPower = opts.power ?? 16;
    if (opts.emissive) m.emissiveColor = B.Color3.FromHexString(opts.emissive);
    return m;
  };
  const glow = (name, hex) => { const m = mat(name, '#000000', { emissive: hex }); m.disableLighting = true; return m; };
  const flicker = [];
  const Y = LOOK.yardM, H = LOOK.wallH;

  // Ground: damp asphalt plus the painted fight spot just above it.
  const ground = B.MeshBuilder.CreateGround('asphalt', { width: Y * 2 + 2, height: Y * 2 + 2 }, scene);
  const gm = mat('asphaltM', '#ffffff', { spec: 0.55, power: 90 });
  gm.diffuseTexture = asphaltTexture(B, scene); gm.diffuseTexture.uScale = gm.diffuseTexture.vScale = 4;
  ground.material = gm; ground.receiveShadows = true;
  const spotM = 10;
  const paint = B.MeshBuilder.CreateGround('paint', { width: spotM, height: spotM }, scene);
  paint.position.y = 0.004;
  const pm = mat('paintM', '#ffffff', { spec: 0.3, power: 60 });
  pm.diffuseTexture = paintTexture(B, scene, spotM); pm.useAlphaFromDiffuseTexture = true; pm.diffuseTexture.hasAlpha = true;
  paint.material = pm; paint.receiveShadows = true;

  // Buildings: four brick walls with windows, drainpipes, doors and graffiti.
  const brick = brickTexture(B, scene);
  const windowDark = mat('windowDark', '#0c1016', { spec: 0.9, power: 120 });
  const lit = ['#ffcf8a', '#ffe2b0', '#8fb7ff', '#ffb36b'].map((c, i) => glow('windowLit' + i, c));
  const frameM = mat('frameM', '#1a1b1f');
  const pipeM = mat('pipeM', '#3b3f45', { spec: 0.5, power: 60 });
  const tags = [
    ['STREET KINGS', '#ff2d95', '#14081a'], ['UPTOWN', '#ffd23f', '#1a1206'], ['BROOKLYN', '#19e3ff', '#04161a'],
    ['BX 4 LIFE', '#a6ff3a', '#0d1a05'], ['HARLEM', '#ff5a36', '#1a0805'],
  ];
  for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2;
    const fwd = new B.Vector3(Math.sin(yaw), 0, Math.cos(yaw));      // wall's position direction from the centre
    const right = new B.Vector3(fwd.z, 0, -fwd.x);
    const place = (mesh, along, up, out = 0) => {
      mesh.position.copyFrom(fwd.scale(Y - out)).addInPlace(right.scale(along)); mesh.position.y = up;
      mesh.rotation.y = yaw;
    };
    const wall = B.MeshBuilder.CreatePlane('wall', { width: Y * 2 + 0.6, height: H }, scene);
    const wm = mat('wallM' + side, '#ffffff', { spec: 0.04 });
    wm.diffuseTexture = brick.clone(); wm.diffuseTexture.uScale = (Y * 2) / 4; wm.diffuseTexture.vScale = H / 2;
    wall.material = wm; place(wall, 0, H / 2); wall.receiveShadows = true;
    // Windows from the second floor up; some lit, a few TVs flickering blue.
    for (let floor = 0; floor < 3; floor++) {
      for (let a = -Y + 2; a <= Y - 2; a += 3.1) {
        if (rand() < 0.15) continue;
        const up = 4.4 + floor * 2.6;
        const frame = B.MeshBuilder.CreatePlane('wframe', { width: 1.35, height: 1.75 }, scene);
        frame.material = frameM; place(frame, a, up, 0.02);
        const win = B.MeshBuilder.CreatePlane('window', { width: 1.15, height: 1.55 }, scene);
        const on = rand() < 0.38;
        win.material = on ? lit[Math.floor(rand() * lit.length)] : windowDark; place(win, a, up, 0.04);
        if (on && win.material === lit[2] && rand() < 0.7) flicker.push({ kind: 'tv', mesh: win, phase: rand() * 10 });
      }
    }
    // Ground floor: a roller door, and a drainpipe.
    const door = B.MeshBuilder.CreatePlane('door', { width: 3.2, height: 2.8 }, scene);
    if (side === 0) door.setEnabled(false);       // the bodega takes that spot on the far wall
    door.material = mat('doorM' + side, '#3e4247', { spec: 0.35, power: 40 }); place(door, -5 + side * 2.5, 1.4, 0.03);
    const pipe = B.MeshBuilder.CreateCylinder('pipe', { height: H, diameter: 0.12 }, scene);
    pipe.material = pipeM; place(pipe, 7.5 - side, H / 2, 0.1);
    // Graffiti pieces on the lower wall.
    const [word, fill, line] = tags[side % tags.length];
    const piece = B.MeshBuilder.CreatePlane('graffiti', { width: 6.5, height: 2.45 }, scene);
    const gmat = mat('graffitiM' + side, '#ffffff', { spec: 0.15 });
    gmat.diffuseTexture = graffitiTexture(B, scene, 'graffitiTex' + side, word, fill, line); gmat.useAlphaFromDiffuseTexture = true;
    gmat.emissiveColor = new B.Color3(0.12, 0.12, 0.12);
    piece.material = gmat; place(piece, 2.5 - side * 1.2, 1.9, 0.05);
    if (side === 1) {
      const t2 = B.MeshBuilder.CreatePlane('graffiti', { width: 4, height: 1.5 }, scene);
      const [w2, f2, l2] = tags[4];
      const m2 = mat('graffitiM5', '#ffffff', { spec: 0.15 });
      m2.diffuseTexture = graffitiTexture(B, scene, 'graffitiTex5', w2, f2, l2); m2.useAlphaFromDiffuseTexture = true;
      m2.emissiveColor = new B.Color3(0.12, 0.12, 0.12);
      t2.material = m2; place(t2, -8.5, 2.4, 0.05);
    }
  }

  // Neon signs, each with a coloured light washing the wall and the wet ground.
  const neons = [
    { text: 'Open 24h', col: LOOK.neon.pink, side: 2, along: -4, up: 3.6 },
    { text: 'Pizza', col: LOOK.neon.cyan, side: 1, along: 3, up: 3.4 },
    { text: 'Liquors', col: LOOK.neon.lime, side: 3, along: 1, up: 3.5 },
    { text: 'Botanica', col: LOOK.neon.amber, side: 2, along: 6.5, up: 4.2 },
  ];
  neons.forEach((n, i) => {
    const yaw = n.side * Math.PI / 2, fwd = new B.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new B.Vector3(fwd.z, 0, -fwd.x);
    const sign = B.MeshBuilder.CreatePlane('neon', { width: 3.2, height: 1 }, scene);
    const m = new B.StandardMaterial('neonM' + i, scene);
    m.emissiveTexture = neonTexture(B, scene, 'neonTex' + i, n.text, n.col); m.opacityTexture = m.emissiveTexture;
    m.disableLighting = true; m.backFaceCulling = false;
    sign.material = m;
    sign.position.copyFrom(fwd.scale(Y - 0.12)).addInPlace(right.scale(n.along)); sign.position.y = n.up; sign.rotation.y = yaw;
    const light = new B.PointLight('neonLight', sign.position.subtract(fwd.scale(1.2)), scene);
    light.diffuse = B.Color3.FromHexString(n.col); light.specular = light.diffuse.scale(0.8);
    light.intensity = 1.1; light.range = 11;
    flicker.push({ kind: 'neon', mat: m, light, base: 1.1, phase: rand() * 10, broken: i === 3 });
  });

  // A sodium street lamp in one corner of the yard.
  const poleM = mat('poleM', '#2c2f34', { spec: 0.4 });
  const pole = B.MeshBuilder.CreateCylinder('lampPole', { height: 7, diameter: 0.16 }, scene);
  pole.position.set(-9.5, 3.5, 8.5); pole.material = poleM; shadow.addShadowCaster(pole);
  const arm = B.MeshBuilder.CreateBox('lampArm', { width: 1.8, height: 0.1, depth: 0.1 }, scene);
  arm.position.set(-8.7, 6.95, 8.5); arm.material = poleM;
  const head = B.MeshBuilder.CreateBox('lampHead', { width: 0.7, height: 0.12, depth: 0.32 }, scene);
  head.position.set(-7.9, 6.85, 8.5); head.material = glow('sodiumM', '#ffae5a');
  const sodium = new B.SpotLight('sodium', new B.Vector3(-7.9, 6.7, 8.5), new B.Vector3(0.35, -1, -0.35), Math.PI / 1.8, 2, scene);
  sodium.diffuse = new B.Color3(...LOOK.sodium); sodium.intensity = 1.3; sodium.range = 22;

  // String lights zig-zagging across the yard.
  const bulbM = glow('bulbM', '#ffd9a0');
  const bulb = B.MeshBuilder.CreateSphere('bulb', { diameter: 0.09, segments: 6 }, scene);
  bulb.material = bulbM;
  const wireM = mat('wireM', '#111111');
  const bulbs = [];
  const strands = [[[-Y, 7.2, -6], [Y, 7.6, 2]], [[-Y, 7.4, 4], [Y, 7.0, -4]], [[-6, 7.5, -Y], [5, 7.3, Y]]];
  for (const [a, b] of strands) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40, sag = Math.sin(f * Math.PI) * 1.4;
      pts.push(new B.Vector3(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - sag, a[2] + (b[2] - a[2]) * f));
    }
    B.MeshBuilder.CreateTube('wire', { path: pts, radius: 0.008, tessellation: 4 }, scene).material = wireM;
    for (let i = 1; i < 40; i += 2) bulbs.push(pts[i].add(new B.Vector3(0, -0.06, 0)));
  }
  const bm = new Float32Array(bulbs.length * 16);
  bulbs.forEach((p, i) => B.Matrix.Translation(p.x, p.y, p.z).copyToArray(bm, i * 16));
  bulb.thinInstanceSetBuffer('matrix', bm, 16, true);

  // Fire barrels: rusty drums with flames, sparks and a flickering orange light.
  const fireTex = radialTexture(B, scene, 'fireTex', 'rgba(255,220,150,1)', 'rgba(255,80,10,0)');
  const smokeTex = radialTexture(B, scene, 'smokeTex', 'rgba(120,120,130,0.5)', 'rgba(120,120,130,0)');
  const barrelM = mat('barrelM', '#5a3220', { spec: 0.2 });
  for (const [x, z] of [[-5.6, 3.2], [5.4, -2.6], [4.2, 6.4]]) {
    const drum = B.MeshBuilder.CreateCylinder('barrel', { height: 0.9, diameter: 0.6, tessellation: 18 }, scene);
    drum.position.set(x, 0.45, z); drum.material = barrelM; shadow.addShadowCaster(drum);
    const fire = new B.ParticleSystem('fire', 260, scene);
    fire.particleTexture = fireTex; fire.emitter = new B.Vector3(x, 0.95, z);
    fire.minEmitBox = new B.Vector3(-0.22, 0, -0.22); fire.maxEmitBox = new B.Vector3(0.22, 0, 0.22);
    fire.color1 = new B.Color4(1, 0.75, 0.3, 1); fire.color2 = new B.Color4(1, 0.4, 0.08, 1); fire.colorDead = new B.Color4(0.3, 0.05, 0, 0);
    fire.minSize = 0.18; fire.maxSize = 0.5; fire.minLifeTime = 0.25; fire.maxLifeTime = 0.7;
    fire.emitRate = 180; fire.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    fire.direction1 = new B.Vector3(-0.15, 1, -0.15); fire.direction2 = new B.Vector3(0.15, 1.6, 0.15);
    fire.minEmitPower = 0.6; fire.maxEmitPower = 1.3; fire.gravity = new B.Vector3(0, 0.8, 0);
    fire.start();
    const smoke = new B.ParticleSystem('smoke', 80, scene);
    smoke.particleTexture = smokeTex; smoke.emitter = new B.Vector3(x, 1.5, z);
    smoke.color1 = smoke.color2 = new B.Color4(0.3, 0.3, 0.33, 0.35); smoke.colorDead = new B.Color4(0.2, 0.2, 0.2, 0);
    smoke.minSize = 0.6; smoke.maxSize = 1.4; smoke.minLifeTime = 2; smoke.maxLifeTime = 3.5; smoke.emitRate = 14;
    smoke.direction1 = new B.Vector3(-0.2, 1, -0.2); smoke.direction2 = new B.Vector3(0.3, 1, 0.2);
    smoke.minEmitPower = 0.3; smoke.maxEmitPower = 0.6; smoke.blendMode = B.ParticleSystem.BLENDMODE_STANDARD; smoke.start();
    const light = new B.PointLight('fireLight', new B.Vector3(x, 1.5, z), scene);
    light.diffuse = new B.Color3(1, 0.55, 0.2); light.specular = new B.Color3(0.8, 0.45, 0.2); light.range = 8;
    flicker.push({ kind: 'fire', light, base: 1.2, phase: rand() * 10 });
  }

  // Two cars parked with their headlights on the fight.
  const glass = mat('carGlass', '#0a0d12', { spec: 1, power: 150 });
  const tyre = mat('tyreM', '#0d0d0f');
  const flareTex = radialTexture(B, scene, 'flareTex', 'rgba(230,240,255,1)', 'rgba(230,240,255,0)');
  for (const [x, z, paint, taxi] of [[7.6, 7.2, '#7a1018'], [-7.8, -6.4, '#f2b90f', true]]) {
    const yaw = Math.atan2(-x, -z);
    const car = new B.TransformNode('car', scene);
    car.position.set(x, 0, z); car.rotation.y = yaw;
    const body = mat('carPaint' + paint, paint, { spec: 0.9, power: 110 });
    const part = (mesh, px, py, pz, m) => { mesh.parent = car; mesh.position.set(px, py, pz); mesh.material = m; shadow.addShadowCaster(mesh); return mesh; };
    part(B.MeshBuilder.CreateBox('carBody', { width: 1.85, height: 0.62, depth: 4.4 }, scene), 0, 0.6, 0, body);
    part(B.MeshBuilder.CreateBox('carCabin', { width: 1.6, height: 0.55, depth: 2.2 }, scene), 0, 1.18, -0.25, glass);
    part(B.MeshBuilder.CreateBox('carRoof', { width: 1.62, height: 0.06, depth: 1.9 }, scene), 0, 1.47, -0.3, body);
    if (taxi) {
      // A yellow cab: roof light and the checker stripe.
      const roofSign = glow('taxiSignM', '#fff3c4');
      part(B.MeshBuilder.CreateBox('taxiSign', { width: 0.7, height: 0.18, depth: 0.22 }, scene), 0, 1.6, -0.2, roofSign);
      const checker = mat('checkerM', '#111111');
      for (const sx of [-0.93, 0.93]) part(B.MeshBuilder.CreateBox('taxiStripe', { width: 0.02, height: 0.08, depth: 3.6 }, scene), sx, 0.62, 0, checker);
    }
    for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]]) {
      const w = part(B.MeshBuilder.CreateCylinder('wheel', { height: 0.24, diameter: 0.66, tessellation: 18 }, scene), wx, 0.33, wz, tyre);
      w.rotation.z = Math.PI / 2;
    }
    const head = glow('headlightM', '#f2f6ff'), tail = glow('taillightM', '#ff1a1a');
    for (const s of [-0.62, 0.62]) {
      const hl = part(B.MeshBuilder.CreatePlane('headlight', { width: 0.36, height: 0.16 }, scene), s, 0.68, 2.205, head);
      hl.rotation.y = Math.PI;
      part(B.MeshBuilder.CreatePlane('taillight', { width: 0.4, height: 0.12 }, scene), s, 0.72, -2.205, tail);
      const flare = B.MeshBuilder.CreatePlane('flare', { size: 1.1 }, scene);
      flare.parent = car; flare.position.set(s, 0.68, 2.26); flare.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
      const fm = new B.StandardMaterial('flareM', scene);
      fm.emissiveTexture = flareTex; fm.opacityTexture = flareTex; fm.disableLighting = true; fm.alphaMode = B.Engine.ALPHA_ADD;
      flare.material = fm;
    }
    const at = B.Vector3.TransformCoordinates(new B.Vector3(0, 0.7, 2.3), B.Matrix.RotationYawPitchRoll(yaw, 0, 0)).add(car.position);
    const beam = new B.SpotLight('headlights', at, new B.Vector3(-x, -0.6, -z).normalize(), Math.PI / 4.5, 6, scene);
    beam.diffuse = new B.Color3(0.92, 0.95, 1); beam.specular = beam.diffuse; beam.intensity = 2.2; beam.range = 24;
  }

  // Chain-link fence across one side of the yard, a dumpster and pallets by the walls.
  const fm = new B.StandardMaterial('fenceM', scene);
  fm.diffuseTexture = chainLinkTexture(B, scene); fm.diffuseTexture.uScale = 60; fm.diffuseTexture.vScale = 14;
  fm.useAlphaFromDiffuseTexture = true; fm.backFaceCulling = false; fm.specularColor = new B.Color3(0.6, 0.6, 0.6);
  const fence = B.MeshBuilder.CreatePlane('fence', { width: 14, height: 3.2 }, scene);
  fence.position.set(Y - 2.2, 1.6, 2); fence.rotation.y = Math.PI / 2; fence.material = fm;
  for (let z = -5; z <= 9; z += 3.5) {
    const p = B.MeshBuilder.CreateCylinder('fencePost', { height: 3.3, diameter: 0.06 }, scene);
    p.position.set(Y - 2.2, 1.65, z); p.material = pipeM;
  }
  const dumpster = B.MeshBuilder.CreateBox('dumpster', { width: 2.2, height: 1.3, depth: 1.2 }, scene);
  dumpster.position.set(7.5, 0.65, Y - 0.9); dumpster.material = mat('dumpsterM', '#1f4a2c', { spec: 0.25 }); shadow.addShadowCaster(dumpster);
  const palletM = mat('palletM', '#6b5034');
  for (const [x, z, h] of [[-Y + 1, -3, 0.6], [-Y + 1.2, -1.6, 0.3], [Y - 1, -8, 0.45]]) {
    const p = B.MeshBuilder.CreateBox('pallet', { width: 1.2, height: h, depth: 1 }, scene);
    p.position.set(x, h / 2, z); p.rotation.y = rand(); p.material = palletM;
  }

  // A manhole breathing steam.
  const manhole = B.MeshBuilder.CreateDisc('manhole', { radius: 0.4, tessellation: 24 }, scene);
  manhole.rotation.x = Math.PI / 2; manhole.position.set(-4.4, 0.006, -5.2); manhole.material = mat('manholeM', '#1b1c1f', { spec: 0.6, power: 60 });
  const steam = new B.ParticleSystem('steam', 120, scene);
  steam.particleTexture = radialTexture(B, scene, 'steamTex', 'rgba(220,225,235,0.35)', 'rgba(220,225,235,0)');
  steam.emitter = new B.Vector3(-4.4, 1.75, -5.2);
  steam.minEmitBox = new B.Vector3(-0.12, 0, -0.12); steam.maxEmitBox = new B.Vector3(0.12, 0, 0.12);
  steam.emitRate = 40;
  steam.color1 = steam.color2 = new B.Color4(0.85, 0.87, 0.92, 0.3); steam.colorDead = new B.Color4(0.8, 0.8, 0.85, 0);
  steam.minSize = 0.5; steam.maxSize = 1.6; steam.minLifeTime = 1.5; steam.maxLifeTime = 3;
  steam.direction1 = new B.Vector3(-0.1, 1, -0.1); steam.direction2 = new B.Vector3(0.25, 1, 0.1);
  steam.minEmitPower = 0.4; steam.maxEmitPower = 0.8; steam.blendMode = B.ParticleSystem.BLENDMODE_STANDARD; steam.start();

  // Rain: stretched streaks falling around the yard.
  const rain = new B.ParticleSystem('rain', 5000, scene);
  rain.particleTexture = radialTexture(B, scene, 'rainTex', 'rgba(200,215,255,0.9)', 'rgba(200,215,255,0)');
  rain.emitter = new B.Vector3(0, 10, 0);
  rain.minEmitBox = new B.Vector3(-Y, 0, -Y); rain.maxEmitBox = new B.Vector3(Y, 0, Y);
  rain.billboardMode = B.ParticleSystem.BILLBOARDMODE_STRETCHED;
  rain.minSize = rain.maxSize = 0.03; rain.minScaleX = rain.maxScaleX = 0.5; rain.minScaleY = 10; rain.maxScaleY = 14;
  rain.color1 = rain.color2 = new B.Color4(0.65, 0.72, 0.9, 0.3); rain.colorDead = new B.Color4(0.65, 0.72, 0.9, 0.3);
  rain.direction1 = new B.Vector3(0.6, -14, 0.2); rain.direction2 = new B.Vector3(0.9, -16, 0.4);
  rain.minEmitPower = rain.maxEmitPower = 1; rain.minLifeTime = rain.maxLifeTime = 0.72;
  rain.emitRate = 4500; rain.blendMode = B.ParticleSystem.BLENDMODE_ADD; rain.start();

  buildNewYork(B, scene, shadow, mat, glow, rand);
  const crowd = buildCrowd(B, scene);
  return {
    ground, crowd,
    update(t, dt) {
      for (const f of flicker) {
        if (f.kind === 'fire') f.light.intensity = f.base * (0.75 + 0.25 * Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 2) + Math.random() * 0.15);
        else if (f.kind === 'tv') f.mesh.material.emissiveColor.b = 0.75 + 0.25 * Math.sin(t * 9 + f.phase);
        else if (f.kind === 'neon') {
          // One sign has a bad transformer: it stutters off for a moment every few seconds.
          const off = f.broken && (Math.sin(t * 0.9 + f.phase) > 0.93) && Math.random() < 0.6;
          f.light.intensity = off ? 0.05 : f.base; f.mat.alpha = off ? 0.15 : 1;
        }
      }
      crowd.update(t, dt);
    },
  };
}

/** Stripes for an awning or the Con Ed steam stack. */
function stripeTexture(B, scene, name, a, b, n, vertical = true) {
  const S = 256, t = new B.DynamicTexture(name, { width: S, height: S }, scene, true);
  const g = t.getContext();
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? b : a;
    if (vertical) g.fillRect((i * S) / n, 0, S / n + 1, S); else g.fillRect(0, (i * S) / n, S, S / n + 1);
  }
  t.update();
  return t;
}

/** A bodega window, lit from inside: shelves of colourful stock, a fridge glow, an ATM sticker. */
function bodegaTexture(B, scene) {
  const W = 512, H = 256, t = new B.DynamicTexture('bodegaTex', { width: W, height: H }, scene, true);
  const g = t.getContext(), rand = mulberryish(9);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#fff2cf'); grd.addColorStop(1, '#d9b77a');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = '#cfe9ff'; g.fillRect(W * 0.72, 10, W * 0.26, H - 20);              // the drinks fridge
  for (let shelf = 0; shelf < 5; shelf++) {
    const y = 30 + shelf * 44;
    g.fillStyle = '#6b5440'; g.fillRect(8, y + 30, W * 0.68, 5);
    for (let x = 12; x < W * 0.68; x += 10 + rand() * 8) {
      g.fillStyle = `hsl(${Math.floor(rand() * 360)},70%,${45 + rand() * 20}%)`;
      g.fillRect(x, y + 30 - (14 + rand() * 14), 8, 30);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < W; x += W / 4) g.fillRect(x, 0, 4, H);    // mullions
  g.fillStyle = '#1b6d2e'; g.fillRect(W * 0.04, H * 0.06, 70, 34);
  g.fillStyle = '#fff'; g.font = 'bold 24px system-ui, sans-serif'; g.fillText('ATM', W * 0.04 + 10, H * 0.06 + 26);
  t.update();
  return t;
}

function signTexture(B, scene, name, text, bg, fg, w = 512, h = 128, font = 'bold 72px "Helvetica Neue", Arial, sans-serif') {
  const t = new B.DynamicTexture(name, { width: w, height: h }, scene, true);
  const g = t.getContext();
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  t.update();
  return t;
}

/**
 * Uptown Manhattan dressing for the yard: tenement fire escapes and cornices, a water tower, a bodega with an awning,
 * a hydrant, trash bags, the orange-and-white steam stack over the manhole, subway globes, green street signs on the
 * lamp pole, and a basketball hoop on the fence.
 */
function buildNewYork(B, scene, shadow, mat, glow, rand) {
  const Y = LOOK.yardM, H = LOOK.wallH;
  const onWall = (side, mesh, along, up, out = 0) => {
    const yaw = side * Math.PI / 2, fwd = new B.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new B.Vector3(fwd.z, 0, -fwd.x);
    mesh.position.copyFrom(fwd.scale(Y - out)).addInPlace(right.scale(along)); mesh.position.y = up;
    mesh.rotation.y = yaw;
    return mesh;
  };
  const iron = mat('ironM', '#121316', { spec: 0.35, power: 40 });
  const box = (name, w, h, d, m) => { const b = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene); b.material = m; return b; };

  // Fire escapes: a platform under each window of a column, railings, and a ladder slanting between floors.
  // Window columns sit at −Y + 2 + 3.1k along each wall and the floors at 4.4 + 2.6f (see buildStreet).
  for (const [side, k] of [[1, 2], [1, 6], [3, 3], [3, 7], [0, 6], [2, 1]]) {
    const along = -Y + 2 + 3.1 * k;
    for (let f = 0; f < 3; f++) {
      const y = 4.4 + f * 2.6 - 0.95;
      onWall(side, box('escapeDeck', 2.2, 0.05, 0.85, iron), along, y, 0.45);
      onWall(side, box('escapeRail', 2.2, 0.04, 0.04, iron), along, y + 0.9, 0.86);
      for (const dx of [-1.08, -0.36, 0.36, 1.08]) onWall(side, box('escapeBar', 0.03, 0.9, 0.03, iron), along + dx, y + 0.45, 0.86);
      for (const dx of [-1.1, 1.1]) onWall(side, box('escapeSide', 0.04, 0.04, 0.85, iron), along + dx, y + 0.9, 0.45);
      if (f < 2) {
        const ladder = onWall(side, box('escapeLadder', 0.5, 2.9, 0.05, iron), along + 0.55, y + 1.3, 0.7);
        ladder.rotation.z = 0.5;
      }
    }
    // The drop ladder hanging from the lowest deck.
    onWall(side, box('dropLadder', 0.45, 1.6, 0.04, iron), along - 0.6, 4.4 - 0.95 - 0.8, 0.8);
  }

  // Cornices along the roofline.
  const stone = mat('corniceM', '#4a4038', { spec: 0.05 });
  for (let side = 0; side < 4; side++) {
    onWall(side, box('cornice', Y * 2 + 0.6, 0.45, 0.5), 0, H - 0.2, 0.2).material = stone;
    onWall(side, box('corniceLip', Y * 2 + 0.6, 0.12, 0.75), 0, H + 0.05, 0.3).material = stone;
  }

  // A wooden water tower on the far roof.
  const wood = mat('towerWood', '#5b4330', { spec: 0.05 });
  const tank = B.MeshBuilder.CreateCylinder('waterTower', { height: 3, diameter: 2.8, tessellation: 20 }, scene);
  tank.position.set(-5, H + 2.9, Y + 2.2); tank.material = wood;
  const cap = B.MeshBuilder.CreateCylinder('waterTowerCap', { height: 1.2, diameterTop: 0.1, diameterBottom: 3.1, tessellation: 20 }, scene);
  cap.position.set(-5, H + 5, Y + 2.2); cap.material = iron;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const leg = box('towerLeg', 0.12, 1.4, 0.12, iron); leg.position.set(-5 + dx, H + 0.7, Y + 2.2 + dz);
  }
  // Roofs beyond the walls, so the rooftop camera sees a skyline edge rather than the void.
  for (let side = 0; side < 4; side++) {
    const roof = B.MeshBuilder.CreateGround('roof', { width: Y * 2 + 12, height: 6 }, scene);
    roof.material = mat('roofM' + side, '#141418');
    onWall(side, roof, 0, H, -3);
  }

  // The bodega on the far wall: lit window, a door, a red-and-white awning and a backlit sign.
  const shop = B.MeshBuilder.CreatePlane('bodegaWindow', { width: 4.2, height: 2.1 }, scene);
  const sm = new B.StandardMaterial('bodegaM', scene);
  sm.emissiveTexture = bodegaTexture(B, scene); sm.diffuseColor = new B.Color3(0, 0, 0); sm.specularColor = new B.Color3(0, 0, 0);
  shop.material = sm; onWall(0, shop, -6.5, 1.45, 0.04);
  onWall(0, box('bodegaDoor', 1.1, 2.4, 0.06, mat('bodegaDoorM', '#2a1f18')), -3.6, 1.2, 0.03);
  const awning = box('awning', 6.2, 0.06, 1.5, mat('awningM', '#ffffff', { spec: 0.15 }));
  awning.material.diffuseTexture = stripeTexture(B, scene, 'awningTex', '#c8202a', '#f2efe6', 14);
  onWall(0, awning, -5.4, 2.95, 0.7); awning.rotation.x = -0.35;
  const sign = B.MeshBuilder.CreatePlane('bodegaSign', { width: 5.4, height: 0.75 }, scene);
  const sgm = new B.StandardMaterial('bodegaSignM', scene);
  sgm.emissiveTexture = signTexture(B, scene, 'bodegaSignTex', 'DELI · GROCERY · 24 HR', '#0f3d8c', '#ffe066', 1024, 128, 'bold 64px "Helvetica Neue", Arial, sans-serif');
  sgm.disableLighting = true; sign.material = sgm; onWall(0, sign, -5.4, 3.55, 0.06);
  const shopLight = new B.PointLight('bodegaLight', new B.Vector3(-6.5, 1.6, Y - 1.5), scene);
  shopLight.diffuse = new B.Color3(1, 0.86, 0.6); shopLight.intensity = 0.9; shopLight.range = 9;

  // A fire hydrant.
  const hydrantM = mat('hydrantM', '#b81d1d', { spec: 0.5, power: 50 });
  const hyd = B.MeshBuilder.CreateCylinder('hydrant', { height: 0.62, diameter: 0.26, tessellation: 14 }, scene);
  hyd.position.set(6.4, 0.31, -7.2); hyd.material = hydrantM; shadow.addShadowCaster(hyd);
  const dome = B.MeshBuilder.CreateSphere('hydrantCap', { diameter: 0.28, segments: 10, slice: 0.5 }, scene);
  dome.position.set(6.4, 0.62, -7.2); dome.material = mat('hydrantCapM', '#e8c21a', { spec: 0.5 });
  const nozzle = B.MeshBuilder.CreateCylinder('hydrantNozzle', { height: 0.4, diameter: 0.1 }, scene);
  nozzle.position.set(6.4, 0.42, -7.2); nozzle.rotation.z = Math.PI / 2; nozzle.material = hydrantM;

  // Black trash bags piled by the walls and the dumpster.
  const bagM = mat('bagM', '#08090b', { spec: 0.9, power: 90 });
  for (const [cx, cz, n] of [[6, Y - 0.8, 7], [-Y + 0.9, 5.5, 6], [-2, -Y + 0.8, 5], [Y - 0.8, -3.5, 4]]) {
    for (let i = 0; i < n; i++) {
      const bag = B.MeshBuilder.CreateSphere('trashBag', { diameter: 0.7, segments: 8 }, scene);
      bag.scaling.set(0.9 + rand() * 0.4, 0.7 + rand() * 0.3, 0.85 + rand() * 0.3);
      bag.position.set(cx + (rand() - 0.5) * 1.6, 0.22 + (i > n * 0.6 ? 0.35 : 0), cz + (rand() - 0.5) * 1.2);
      bag.rotation.y = rand() * 3; bag.material = bagM;
    }
  }

  // The orange-and-white Con Ed stack over the manhole (the steam comes out of its top).
  const stack = B.MeshBuilder.CreateCylinder('steamStack', { height: 1.7, diameterTop: 0.36, diameterBottom: 0.44, tessellation: 18 }, scene);
  stack.position.set(-4.4, 0.85, -5.2);
  const stm = mat('stackM', '#ffffff', { spec: 0.3 });
  stm.diffuseTexture = stripeTexture(B, scene, 'stackTex', '#ff6a13', '#f4f4f0', 6, false);
  stack.material = stm; shadow.addShadowCaster(stack);

  // Subway entrance: two green globe lamps on posts and a sign, at the left wall.
  const globeM = glow('subwayGlobeM', '#3dd66b');
  for (const z of [-9.4, -6.6]) {
    const post = B.MeshBuilder.CreateCylinder('subwayPost', { height: 2.4, diameter: 0.08 }, scene);
    post.position.set(-Y + 1.6, 1.2, z); post.material = iron;
    const globe = B.MeshBuilder.CreateSphere('subwayGlobe', { diameter: 0.34, segments: 12 }, scene);
    globe.position.set(-Y + 1.6, 2.5, z); globe.material = globeM;
  }
  const rail = box('subwayRail', 0.05, 0.05, 2.8, iron); rail.position.set(-Y + 1.6, 1.0, -8);
  const subwaySign = B.MeshBuilder.CreatePlane('subwaySign', { width: 1.9, height: 0.42 }, scene);
  const ssm = new B.StandardMaterial('subwaySignM', scene);
  ssm.emissiveTexture = signTexture(B, scene, 'subwaySignTex', 'SUBWAY', '#111111', '#ffffff', 512, 112, 'bold 74px "Helvetica Neue", Arial, sans-serif');
  ssm.disableLighting = true; ssm.backFaceCulling = false; subwaySign.material = ssm;
  subwaySign.position.set(-Y + 1.6, 1.9, -8); subwaySign.rotation.y = Math.PI / 2;
  const subwayLight = new B.PointLight('subwayLight', new B.Vector3(-Y + 2.2, 2.4, -8), scene);
  subwayLight.diffuse = new B.Color3(0.3, 1, 0.45); subwayLight.intensity = 0.7; subwayLight.range = 6;

  // Green street-name blades on the lamp pole (the pole stands at −9.5, 8.5).
  for (const [text, yaw, y] of [['LENOX AV', 0, 3.1], ['W 125 ST', Math.PI / 2, 3.35]]) {
    const blade = B.MeshBuilder.CreatePlane('streetSign', { width: 1.5, height: 0.26 }, scene);
    const bm = new B.StandardMaterial('streetSignM' + text, scene);
    bm.diffuseTexture = signTexture(B, scene, 'streetSignTex' + text, text, '#0b6b3a', '#ffffff', 512, 96, 'bold 62px "Helvetica Neue", Arial, sans-serif');
    bm.emissiveColor = new B.Color3(0.25, 0.25, 0.25); bm.backFaceCulling = false;
    blade.material = bm; blade.position.set(-9.5, y, 8.5); blade.rotation.y = yaw;
  }

  // A basketball hoop on the chain-link fence (the fence runs along x = Y − 2.2).
  const hx = Y - 2.25;
  const pole = B.MeshBuilder.CreateCylinder('hoopPole', { height: 3.3, diameter: 0.12 }, scene);
  pole.position.set(hx + 0.15, 1.65, 6.5); pole.material = iron;
  const board = box('backboard', 0.04, 1.05, 1.8, mat('backboardM', '#e9e9e9', { spec: 0.4 }));
  board.position.set(hx - 0.1, 3.3, 6.5);
  const rim = B.MeshBuilder.CreateTorus('rim', { diameter: 0.46, thickness: 0.025, tessellation: 24 }, scene);
  rim.position.set(hx - 0.4, 3.05, 6.5); rim.material = mat('rimM', '#e0561b', { spec: 0.5 });
}

/**
 * The street is hundreds of small static meshes (window frames, fire-escape bars, bags). Each one is a draw call in the
 * main pass and the shadow map, so merge everything static that shares a material.
 * Parented (cars), thin-instanced (crowd, bulbs), billboarded and listed meshes are left alone.
 */
function mergeStatic(B, scene, shadow, keep) {
  const casters = shadow.getShadowMap().renderList;
  const groups = new Map();
  for (const m of scene.meshes) {
    if (keep.includes(m) || m.parent || m.skeleton || m.hasThinInstances || m.billboardMode || !m.material || !m.isEnabled()) continue;
    if (!m.getTotalVertices()) continue;
    const g = groups.get(m.material) ?? []; g.push(m); groups.set(m.material, g);
  }
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const cast = g.some((m) => casters.includes(m)), receive = g.some((m) => m.receiveShadows);
    const merged = B.Mesh.MergeMeshes(g, true, true);
    if (!merged) continue;
    merged.freezeWorldMatrix(); merged.receiveShadows = receive;
    if (cast) shadow.addShadowCaster(merged);
  }
}

/** Onlookers standing in a loose ring around the fight spot, open on the hard camera's side. One thin-instanced mesh. */
function buildCrowd(B, scene) {
  const part = (mesh, x, y, rz = 0) => { mesh.position.set(x, y, 0); mesh.rotation.z = rz; return mesh; };
  const limb = (name, h, d0, d1) => B.MeshBuilder.CreateCylinder(name, { height: h, diameterTop: d0, diameterBottom: d1, tessellation: 8 }, scene);
  const torso = B.MeshBuilder.CreateCylinder('crowdBody', { height: 0.62, diameterTop: 0.42, diameterBottom: 0.32, tessellation: 10 }, scene);
  torso.scaling.z = 0.6; torso.position.y = 1.18;
  const person = B.Mesh.MergeMeshes([
    part(limb('legL', 0.86, 0.15, 0.11), -0.1, 0.43, 0.04), part(limb('legR', 0.86, 0.15, 0.11), 0.1, 0.43, -0.04),
    torso,
    part(limb('armL', 0.62, 0.1, 0.08), -0.25, 1.15, -0.1), part(limb('armR', 0.62, 0.1, 0.08), 0.25, 1.15, 0.1),
    part(limb('neck', 0.1, 0.09, 0.1), 0, 1.53),
    part(B.MeshBuilder.CreateSphere('crowdHead', { diameter: 0.22, segments: 8 }, scene), 0, 1.66),
  ], true);
  person.name = 'crowd';
  const m = new B.StandardMaterial('crowdM', scene);
  m.diffuseColor = new B.Color3(1, 1, 1); m.specularColor = new B.Color3(0.05, 0.05, 0.05);
  person.material = m;

  const seats = [];
  const rand = mulberryish(7);
  for (let row = 0; row < 3; row++) {
    const r = RING_HALF_M + 2.1 + row * 0.7;
    const n = Math.round((2 * Math.PI * r) / 0.62);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.3 + (rand() - 0.5) * 0.08;
      // Leave a gap toward −z, where the hard camera stands.
      const fromCam = Math.abs(Math.atan2(Math.sin(a), -Math.cos(a)));
      if (fromCam < 0.85 + row * 0.1 || rand() < 0.12) continue;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      seats.push({ x, z, yaw: Math.atan2(-x, -z), phase: rand() * Math.PI * 2, h: 0.9 + rand() * 0.18 });
    }
  }
  const palette = ['#1d1f24', '#2b2d33', '#3a2f2a', '#5a1f22', '#1f3550', '#4a4a4a', '#6b5b45', '#203527', '#c9a227', '#a33a2a', '#2a6f78', '#e2e2e2'];
  const mats = new Float32Array(seats.length * 16), cols = new Float32Array(seats.length * 4);
  seats.forEach((s, i) => {
    const c = B.Color3.FromHexString(palette[Math.floor(rand() * palette.length)]);
    cols.set([c.r, c.g, c.b, 1], i * 4);
  });
  person.thinInstanceSetBuffer('matrix', mats, 16, false);
  person.thinInstanceSetBuffer('color', cols, 4, true);
  const tmp = new B.Matrix(), q = new B.Quaternion(), sc = new B.Vector3(1, 1, 1), pos = new B.Vector3();

  let excite = 0;
  return {
    mesh: person,
    /** Crowd bounce; `excite` jumps on big moments and settles. */
    update(t, dt) {
      excite = Math.max(0, excite - dt * 0.6);
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        const bob = Math.max(0, Math.sin(t * (2 + excite * 6) + s.phase)) * (0.02 + excite * 0.14);
        pos.set(s.x, bob, s.z); sc.set(1, s.h, 1);
        B.Quaternion.RotationYawPitchRollToRef(s.yaw + Math.sin(t * 0.4 + s.phase) * 0.25, 0, 0, q);
        B.Matrix.ComposeToRef(sc, q, pos, tmp);
        tmp.copyToArray(mats, i * 16);
      }
      person.thinInstanceBufferUpdated('matrix');
    },
    roar(amount) { excite = Math.min(1, excite + amount); },
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
    <div class="bm3d-bug"><b>●</b> LIVE · UPTOWN NYC</div>
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
  // Night in the back lot: a dark blue sky glow and a damp haze that the lamps bleed into.
  const haze = new B.Color3(0.05, 0.055, 0.085);
  scene.clearColor = new B.Color4(haze.r, haze.g, haze.b, 1);
  scene.ambientColor = new B.Color3(0.22, 0.22, 0.28);
  scene.fogMode = B.Scene.FOGMODE_EXP2; scene.fogDensity = 0.036; scene.fogColor = haze;

  // Lights: cool moonlight fill, a work lamp hung over the fight spot (the key, for shadows), and a wide warm flood
  // from it; the street builds its own neon, sodium, fire and headlights.
  const hemi = new B.HemisphericLight('moon', new B.Vector3(0.2, 1, -0.3), scene);
  hemi.intensity = 0.26; hemi.diffuse = new B.Color3(0.55, 0.62, 0.9); hemi.groundColor = new B.Color3(0.12, 0.1, 0.12);
  hemi.specular = new B.Color3(0.25, 0.28, 0.4);
  const key = new B.DirectionalLight('workLamp', new B.Vector3(0.12, -1, 0.18), scene);
  key.position = new B.Vector3(-1, 12, -2); key.intensity = 1.05; key.diffuse = new B.Color3(1, 0.88, 0.7);
  const flood = new B.SpotLight('flood', new B.Vector3(0, 6.2, 0), new B.Vector3(0, -1, 0), Math.PI / 1.7, 3, scene);
  flood.intensity = 1.0; flood.diffuse = new B.Color3(1, 0.86, 0.66); flood.specular = new B.Color3(1, 0.9, 0.8); flood.range = 16;
  const shadow = new B.ShadowGenerator(2048, key);
  shadow.useBlurExponentialShadowMap = true; shadow.blurKernel = 16; shadow.darkness = 0.4;

  const arena = buildStreet(B, scene, shadow);
  mergeStatic(B, scene, shadow, [arena.ground]);
  const lampCage = B.MeshBuilder.CreateCylinder('workLampShade', { height: 0.25, diameterTop: 0.15, diameterBottom: 0.55, tessellation: 16 }, scene);
  lampCage.position.set(0, 6.3, 0); lampCage.material = new B.StandardMaterial('workLampM', scene);
  lampCage.material.diffuseColor = new B.Color3(0.15, 0.16, 0.18); lampCage.material.emissiveColor = new B.Color3(0.9, 0.75, 0.5);

  // Rigged Quaternius boxers when the models load; the primitive boxers otherwise.
  let boxers;
  try {
    const assets = await loadBoxerAssets(B, scene);
    boxers = Object.fromEntries(['red', 'blue'].map((c) => [c, new ModelBoxer(B, scene, assets, c, shadow, { glove: LOOK.wraps, trunks: LOOK.trunks[c], wraps: true })]));
  } catch (err) {
    console.warn('boxer models unavailable, using primitive boxers:', err);
    boxers = { red: new Boxer(B, scene, 'red', shadow), blue: new Boxer(B, scene, 'blue', shadow) };
  }

  // The street has a dozen lights; StandardMaterial takes four unless told otherwise.
  for (const m of scene.materials) if ('maxSimultaneousLights' in m) m.maxSimultaneousLights = 16;

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

  // Post: broadcast grade and a vignette; no bloom or lens effects (matte look).
  const pipe = new B.DefaultRenderingPipeline('broadcast', true, scene, [cam]);
  pipe.fxaaEnabled = true; pipe.samples = 4;
  pipe.bloomEnabled = false;
  pipe.imageProcessingEnabled = true;
  pipe.imageProcessing.toneMappingEnabled = true; pipe.imageProcessing.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipe.imageProcessing.exposure = 1.2; pipe.imageProcessing.contrast = 1.2;
  pipe.imageProcessing.vignetteEnabled = true; pipe.imageProcessing.vignetteWeight = 1.4; pipe.imageProcessing.vignetteColor = new B.Color4(0, 0, 0, 0);
  pipe.sharpenEnabled = true; pipe.sharpen.edgeAmount = 0.25;
  const glow = new B.GlowLayer('glow', scene); glow.intensity = 0.3;   // only so neon reads as neon

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
    overlay.cam({ hard: 'CAM 1', ringside: 'CAM 3 · CROWD', wide: 'CAM 2 · ROOFTOP' }[mode]);
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

    arena.update(time, dt);
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
