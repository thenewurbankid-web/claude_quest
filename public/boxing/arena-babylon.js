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
import { loadBoxerAssets, loadGltfLoader, ModelBoxer, PHOTO_OUTFITS, normalizeLook } from './boxer-model.js';
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
  yardM: 13,                          // the tenements stand this far from the centre on every side
  wallH: 17,                          // five floors of windows over a shop floor
  floors: 5,
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

// ─── The court ───────────────────────────────────────────────────────────────

/** Photo textures (Poly Haven, CC0; see textures/CREDITS.md), tiled every `tileM` metres over a `w` × `h` m surface. */
function photoMaterial(B, scene, name, file, w, h, tileM, tint = '#ffffff') {
  const m = new B.StandardMaterial(name, scene);
  const tex = (f) => { const t = new B.Texture(`/boxing/textures/${f}`, scene); t.uScale = w / tileM; t.vScale = h / tileM; return t; };
  m.diffuseTexture = tex(`${file}_diff.webp`);
  m.bumpTexture = tex(`${file}_nor.webp`); m.bumpTexture.level = 0.6;
  m.diffuseColor = B.Color3.FromHexString(tint);
  m.specularColor = new B.Color3(0.03, 0.03, 0.03);
  return m;
}

/**
 * Basketball court lines, faded, on a transparent texture the size of the fenced court (`sizeM` square). The hoop's
 * baseline is at +z (the top of the texture). The fighters' corners get small sprayed dots (red −x −z, blue +x +z).
 */
function courtLinesTexture(B, scene, sizeM) {
  const S = 1024, t = new B.DynamicTexture('courtLines', { width: S, height: S }, scene, true);
  const g = t.getContext(), px = S / sizeM, c = S / 2, rand = mulberryish(13);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(235,235,228,0.75)'; g.lineWidth = 0.06 * px;
  const z = (m) => c - m * px, x = (m) => c + m * px;          // metres from the centre → canvas
  const base = COURT.baselineZ, rimZ = base - 1.575;
  g.strokeRect(x(-sizeM / 2 + 0.6), z(base), (sizeM - 1.2) * px, (base + sizeM / 2 - 0.6) * px);   // sidelines + baseline
  g.strokeRect(x(-2.45), z(base), 4.9 * px, 5.8 * px);                                            // the key
  g.beginPath(); g.arc(x(0), z(base - 5.8), 1.8 * px, 0, Math.PI * 2); g.stroke();                 // free-throw circle
  g.beginPath(); g.arc(x(0), z(rimZ), 6.75 * px, Math.PI * 0.08, Math.PI * 0.92); g.stroke();      // three-point arc
  g.beginPath(); g.arc(x(0), z(-sizeM / 2 + 0.6), 1.8 * px, Math.PI, Math.PI * 2); g.stroke();     // half of the centre circle
  // Wear: knock the paint out in patches.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`; g.fillRect(rand() * S, rand() * S, 2 + rand() * 10, 2 + rand() * 10); }
  g.globalCompositeOperation = 'source-over';
  const h = RING_HALF_M * px;
  g.globalAlpha = 0.7;
  g.fillStyle = LOOK.corners.red; g.beginPath(); g.arc(c - h, c + h, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = LOOK.corners.blue; g.beginPath(); g.arc(c + h, c - h, 18, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  t.hasAlpha = true; t.update();
  return t;
}

/** The court the photo shows: the fence half-width, and where the hoop's baseline is. */
const COURT = { half: 9.6, baselineZ: 9.0 };

/**
 * The user's reference photo, rebuilt: a New York neighbourhood basketball court ringed by a tall chain-link fence,
 * a gooseneck hoop behind the crowd, street trees, and 5–6 storey brick tenements with fire escapes all round.
 * `night` adds the night dressing (neon, a sodium lamp, string lights, fire barrels, headlights, rain, lit windows);
 * by day the light is overcast and the windows are dark glass.
 * Returns { ground, crowd, update(t, dt) }.
 */
function buildStreet(B, scene, shadow, { night = false } = {}) {
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
  const Y = LOOK.yardM, H = LOOK.wallH, F = COURT.half;

  // Street asphalt everywhere, the court's own lighter surface inside the fence, and its lines.
  const ground = B.MeshBuilder.CreateGround('asphalt', { width: Y * 2 + 2, height: Y * 2 + 2 }, scene);
  ground.material = photoMaterial(B, scene, 'asphaltM', 'asphalt', Y * 2 + 2, Y * 2 + 2, 4, '#8f8f8f');
  ground.receiveShadows = true;
  const court = B.MeshBuilder.CreateGround('court', { width: F * 2, height: F * 2 }, scene);
  court.position.y = 0.003; court.receiveShadows = true;
  court.material = photoMaterial(B, scene, 'courtM', 'asphalt', F * 2, F * 2, 3, '#c4c6c6');
  const lines = B.MeshBuilder.CreateGround('paint', { width: F * 2, height: F * 2 }, scene);
  lines.position.y = 0.006; lines.receiveShadows = true;
  const lm = mat('paintM', '#ffffff'); lm.diffuseTexture = courtLinesTexture(B, scene, F * 2); lm.useAlphaFromDiffuseTexture = true;
  lines.material = lm;
  // Sidewalks along the buildings, with a curb.
  const walk = photoMaterial(B, scene, 'sidewalkM', 'sidewalk', Y * 2, 2.2, 2, '#b9b6b0');
  for (let side = 0; side < 4; side++) {
    const s = B.MeshBuilder.CreateBox('sidewalk', { width: Y * 2, height: 0.15, depth: 2.2 }, scene);
    const yaw = side * Math.PI / 2;
    s.position.set(Math.sin(yaw) * (Y - 1.1), 0.075, Math.cos(yaw) * (Y - 1.1)); s.rotation.y = yaw;
    s.material = walk; s.receiveShadows = true;
  }

  // Tenements: photo brick on all four sides, windows with stone lintels and sills, AC units, bars low down.
  const brick = photoMaterial(B, scene, 'brickM', 'brick_red', Y * 2 + 0.6, H, 2.4, '#d9c2b4');
  const glassDay = mat('windowDark', '#2a3036');
  const lit = night ? ['#ffcf8a', '#ffe2b0', '#8fb7ff', '#ffb36b'].map((c, i) => glow('windowLit' + i, c)) : [];
  const frameM = mat('frameM', '#e8e2d6');
  const lintelM = mat('lintelM', '#b9ab95');
  const acM = mat('acM', '#cfd0cc');
  const barM = mat('barM', '#16171a');
  const pipeM = mat('pipeM', '#3b3f45');
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
      return mesh;
    };
    const wall = B.MeshBuilder.CreatePlane('wall', { width: Y * 2 + 0.6, height: H }, scene);
    wall.material = brick; place(wall, 0, H / 2); wall.receiveShadows = true;
    for (let floor = 0; floor < LOOK.floors; floor++) {
      for (let a = -Y + 2; a <= Y - 2; a += 3.1) {
        if (side === 0 && floor === 0 && a < -2) continue;          // the shop front
        const up = 4.4 + floor * 2.6;
        place(B.MeshBuilder.CreatePlane('wframe', { width: 1.25, height: 1.75 }, scene), a, up, 0.02).material = frameM;
        const win = place(B.MeshBuilder.CreatePlane('window', { width: 1.05, height: 1.55 }, scene), a, up, 0.04);
        const on = night && rand() < 0.38;
        win.material = on ? lit[Math.floor(rand() * lit.length)] : glassDay;
        if (on && win.material === lit[2] && rand() < 0.7) flicker.push({ kind: 'tv', mesh: win, phase: rand() * 10 });
        place(B.MeshBuilder.CreateBox('lintel', { width: 1.5, height: 0.2, depth: 0.08 }, scene), a, up + 0.98, 0.04).material = lintelM;
        place(B.MeshBuilder.CreateBox('sill', { width: 1.35, height: 0.08, depth: 0.14 }, scene), a, up - 0.9, 0.07).material = lintelM;
        if (rand() < 0.3) place(B.MeshBuilder.CreateBox('acUnit', { width: 0.66, height: 0.42, depth: 0.55 }, scene), a + 0.1, up - 0.6, 0.3).material = acM;
        if (floor === 0) for (let b = -0.45; b <= 0.46; b += 0.15) place(B.MeshBuilder.CreateBox('bar', { width: 0.025, height: 1.55, depth: 0.025 }, scene), a + b, up, 0.12).material = barM;
      }
    }
    // Ground floor: a roller door (not where the shop is), a drainpipe, a graffiti piece.
    if (side !== 0) {
      const door = place(B.MeshBuilder.CreatePlane('door', { width: 3.2, height: 2.8 }, scene), -5 + side * 2.5, 1.4, 0.03);
      door.material = mat('doorM' + side, '#5a5e63');
    }
    place(B.MeshBuilder.CreateCylinder('pipe', { height: H, diameter: 0.12 }, scene), 7.5 - side, H / 2, 0.1).material = pipeM;
    const [word, fill, line] = tags[side % tags.length];
    const piece = place(B.MeshBuilder.CreatePlane('graffiti', { width: 5.5, height: 2.1 }, scene), 3 - side * 1.2, 1.9, 0.05);
    const gmat = mat('graffitiM' + side, '#ffffff');
    gmat.diffuseTexture = graffitiTexture(B, scene, 'graffitiTex' + side, word, fill, line); gmat.useAlphaFromDiffuseTexture = true;
    piece.material = gmat;
  }

  // The chain-link fence round the court, on steel posts with a top rail.
  const fm = new B.StandardMaterial('fenceM', scene);
  fm.diffuseTexture = chainLinkTexture(B, scene); fm.diffuseTexture.uScale = F * 2 * 4.5; fm.diffuseTexture.vScale = 4.2 * 4.5;
  fm.useAlphaFromDiffuseTexture = true; fm.backFaceCulling = false; fm.diffuseColor = new B.Color3(0.35, 0.36, 0.38);
  fm.specularColor = new B.Color3(0, 0, 0);
  const postM = mat('fencePostM', '#1d1f22');
  for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2, fwd = new B.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new B.Vector3(fwd.z, 0, -fwd.x);
    const fence = B.MeshBuilder.CreatePlane('fence', { width: F * 2, height: 4.2 }, scene);
    fence.position.copyFrom(fwd.scale(F)); fence.position.y = 2.1; fence.rotation.y = yaw; fence.material = fm;
    const rail = B.MeshBuilder.CreateCylinder('fenceRail', { height: F * 2, diameter: 0.05 }, scene);
    rail.position.copyFrom(fwd.scale(F)); rail.position.y = 4.2; rail.rotation.z = Math.PI / 2; rail.rotation.y = yaw; rail.material = postM;
    for (let a = -F; a < F; a += 3.2) {
      const p = B.MeshBuilder.CreateCylinder('fencePost', { height: 4.3, diameter: 0.07 }, scene);
      p.position.copyFrom(fwd.scale(F)).addInPlace(right.scale(a)); p.position.y = 2.15; p.material = postM;
    }
  }

  // The hoop behind the crowd: a gooseneck pole, a steel-framed backboard, an orange rim and a chain net.
  const hz = COURT.baselineZ;
  const steel = mat('hoopSteel', '#2a2d31');
  const pole = B.MeshBuilder.CreateCylinder('hoopPole', { height: 3.4, diameter: 0.16 }, scene);
  pole.position.set(0, 1.7, hz + 0.25); pole.material = steel; shadow.addShadowCaster(pole);
  const neck = B.MeshBuilder.CreateTube('hoopNeck', { path: [new B.Vector3(0, 3.35, hz + 0.25), new B.Vector3(0, 3.75, hz + 0.05), new B.Vector3(0, 3.85, hz - 0.35)], radius: 0.07, tessellation: 10 }, scene);
  neck.material = steel;
  const board = B.MeshBuilder.CreateBox('backboard', { width: 1.8, height: 1.05, depth: 0.04 }, scene);
  board.position.set(0, 3.55, hz - 0.4); board.material = mat('backboardM', '#e4e4e0');
  const boardFrame = B.MeshBuilder.CreateBox('backboardFrame', { width: 1.86, height: 1.11, depth: 0.03 }, scene);
  boardFrame.position.set(0, 3.55, hz - 0.37); boardFrame.material = steel;
  const square = B.MeshBuilder.CreatePlane('backboardSquare', { width: 0.59, height: 0.45 }, scene);
  square.position.set(0, 3.3, hz - 0.425); square.material = mat('squareM', '#c94a2a');
  const sq2 = B.MeshBuilder.CreatePlane('backboardSquareIn', { width: 0.53, height: 0.39 }, scene);
  sq2.position.set(0, 3.3, hz - 0.426); sq2.material = mat('backboardM2', '#e4e4e0');
  const rim = B.MeshBuilder.CreateTorus('rim', { diameter: 0.46, thickness: 0.022, tessellation: 24 }, scene);
  rim.position.set(0, 3.05, hz - 0.65); rim.material = mat('rimM', '#d9531e');
  const net = B.MeshBuilder.CreateCylinder('net', { height: 0.42, diameterTop: 0.44, diameterBottom: 0.28, tessellation: 12, enclose: false }, scene);
  net.position.set(0, 2.83, hz - 0.65);
  const nm = mat('netM', '#b8bcc0'); nm.wireframe = true; net.material = nm;

  // Street trees between the fence and the buildings: thin trunks, a few branches, sparse autumn leaves.
  const bark = mat('barkM', '#3d3328');
  const leafM = [mat('leafA', '#8c9a3e'), mat('leafB', '#b5a542'), mat('leafC', '#6f7a35')];
  for (const [x, z] of [[-6, 11.4], [4.5, 11.4], [-11.4, -3], [11.4, 2.5], [-11.4, 7.5], [9, -11.4], [-4, -11.4]]) {
    const h = 5.5 + rand() * 2;
    const trunk = B.MeshBuilder.CreateCylinder('trunk', { height: h, diameterTop: 0.09, diameterBottom: 0.2, tessellation: 8 }, scene);
    trunk.position.set(x, h / 2, z); trunk.material = bark; shadow.addShadowCaster(trunk);
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2, tilt = 0.5 + rand() * 0.5, len = 1.2 + rand() * 1.4, y0 = h * (0.55 + rand() * 0.35);
      const branch = B.MeshBuilder.CreateCylinder('branch', { height: len, diameterTop: 0.02, diameterBottom: 0.07, tessellation: 6 }, scene);
      const dir = new B.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      branch.position.set(x + dir.x * len / 2, y0 + dir.y * len / 2, z + dir.z * len / 2);
      branch.rotationQuaternion = B.Quaternion.FromUnitVectorsToRef(B.Vector3.Up(), dir, new B.Quaternion());
      branch.material = bark;
      for (let k = 0; k < 5; k++) {
        const leaf = B.MeshBuilder.CreateIcoSphere('leaves', { radius: 0.16 + rand() * 0.2, subdivisions: 1 }, scene);
        const f = 0.5 + rand() * 0.6;
        leaf.position.set(x + dir.x * len * f + (rand() - 0.5) * 0.5, y0 + dir.y * len * f + (rand() - 0.5) * 0.4, z + dir.z * len * f + (rand() - 0.5) * 0.5);
        leaf.scaling.y = 0.6; leaf.material = leafM[Math.floor(rand() * 3)];
      }
    }
  }

  // A New York lamppost outside the fence; its sodium light only comes on at night.
  const poleM = mat('poleM', '#2c3a33');
  const lp = B.MeshBuilder.CreateCylinder('lampPole', { height: 7, diameter: 0.16 }, scene);
  lp.position.set(-11, 3.5, 11); lp.material = poleM; shadow.addShadowCaster(lp);
  const arm = B.MeshBuilder.CreateBox('lampArm', { width: 0.1, height: 0.1, depth: 1.8 }, scene);
  arm.position.set(-11, 6.95, 10.2); arm.material = poleM;
  const head = B.MeshBuilder.CreateBox('lampHead', { width: 0.32, height: 0.12, depth: 0.7 }, scene);
  head.position.set(-11, 6.85, 9.4); head.material = night ? glow('sodiumM', '#ffae5a') : mat('lampOffM', '#c9c4b8');
  if (night) {
    const sodium = new B.SpotLight('sodium', new B.Vector3(-11, 6.7, 9.4), new B.Vector3(0.45, -1, -0.45), Math.PI / 1.8, 2, scene);
    sodium.diffuse = new B.Color3(...LOOK.sodium); sodium.intensity = 1.3; sodium.range = 22;
  }

  // Two cars pulled up at the far corners, outside the fence, noses toward the court.
  const glass = mat('carGlass', '#1a1f26');
  const tyre = mat('tyreM', '#0d0d0f');
  const flareTex = radialTexture(B, scene, 'flareTex', 'rgba(230,240,255,1)', 'rgba(230,240,255,0)');
  for (const [x, z, paint, taxi] of [[11.3, 11.3, '#7a1018'], [-11.3, -11.3, '#f2b90f', true]]) {
    const yaw = Math.atan2(-x, -z);
    const car = new B.TransformNode('car', scene);
    car.position.set(x, 0, z); car.rotation.y = yaw;
    const body = mat('carPaint' + paint, paint, { spec: 0.1, power: 40 });
    const part = (mesh, px, py, pz, m) => { mesh.parent = car; mesh.position.set(px, py, pz); mesh.material = m; shadow.addShadowCaster(mesh); return mesh; };
    part(B.MeshBuilder.CreateBox('carBody', { width: 1.85, height: 0.62, depth: 4.4 }, scene), 0, 0.6, 0, body);
    part(B.MeshBuilder.CreateBox('carCabin', { width: 1.6, height: 0.55, depth: 2.2 }, scene), 0, 1.18, -0.25, glass);
    part(B.MeshBuilder.CreateBox('carRoof', { width: 1.62, height: 0.06, depth: 1.9 }, scene), 0, 1.47, -0.3, body);
    if (taxi) {
      part(B.MeshBuilder.CreateBox('taxiSign', { width: 0.7, height: 0.18, depth: 0.22 }, scene), 0, 1.6, -0.2, night ? glow('taxiSignM', '#fff3c4') : mat('taxiSignDay', '#f4efe0'));
      const checker = mat('checkerM', '#111111');
      for (const sx of [-0.93, 0.93]) part(B.MeshBuilder.CreateBox('taxiStripe', { width: 0.02, height: 0.08, depth: 3.6 }, scene), sx, 0.62, 0, checker);
    }
    for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]]) {
      const w = part(B.MeshBuilder.CreateCylinder('wheel', { height: 0.24, diameter: 0.66, tessellation: 18 }, scene), wx, 0.33, wz, tyre);
      w.rotation.z = Math.PI / 2;
    }
    const head = night ? glow('headlightM', '#f2f6ff') : mat('headlightOff', '#d9dde2'), tail = night ? glow('taillightM', '#ff1a1a') : mat('taillightOff', '#7a1a1a');
    for (const s of [-0.62, 0.62]) {
      const hl = part(B.MeshBuilder.CreatePlane('headlight', { width: 0.36, height: 0.16 }, scene), s, 0.68, 2.205, head);
      hl.rotation.y = Math.PI;
      part(B.MeshBuilder.CreatePlane('taillight', { width: 0.4, height: 0.12 }, scene), s, 0.72, -2.205, tail);
      if (!night) continue;
      const flare = B.MeshBuilder.CreatePlane('flare', { size: 1.1 }, scene);
      flare.parent = car; flare.position.set(s, 0.68, 2.26); flare.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
      const fmat = new B.StandardMaterial('flareM', scene);
      fmat.emissiveTexture = flareTex; fmat.opacityTexture = flareTex; fmat.disableLighting = true; fmat.alphaMode = B.Engine.ALPHA_ADD;
      flare.material = fmat;
    }
    if (night) {
      const at = B.Vector3.TransformCoordinates(new B.Vector3(0, 0.7, 2.3), B.Matrix.RotationYawPitchRoll(yaw, 0, 0)).add(car.position);
      const beam = new B.SpotLight('headlights', at, new B.Vector3(-x, -0.6, -z).normalize(), Math.PI / 4.5, 6, scene);
      beam.diffuse = new B.Color3(0.92, 0.95, 1); beam.specular = beam.diffuse; beam.intensity = 2.2; beam.range = 26;
    }
  }

  // A dumpster and pallets by the walls; a manhole outside the fence (its steam stack is in buildNewYork).
  const dumpster = B.MeshBuilder.CreateBox('dumpster', { width: 2.2, height: 1.3, depth: 1.2 }, scene);
  dumpster.position.set(7.5, 0.8, Y - 1.1); dumpster.material = photoMaterial(B, scene, 'dumpsterM', 'rust', 2.2, 1.3, 1.5, '#6f8a74');
  shadow.addShadowCaster(dumpster);
  const palletM = mat('palletM', '#6b5034');
  for (const [x, z, h] of [[-Y + 1, -3, 0.6], [-Y + 1.2, -1.6, 0.3], [Y - 1, -8, 0.45]]) {
    const p = B.MeshBuilder.CreateBox('pallet', { width: 1.2, height: h, depth: 1 }, scene);
    p.position.set(x, 0.15 + h / 2, z); p.rotation.y = rand(); p.material = palletM;
  }
  const manhole = B.MeshBuilder.CreateDisc('manhole', { radius: 0.4, tessellation: 24 }, scene);
  manhole.rotation.x = Math.PI / 2; manhole.position.set(-10.6, 0.006, 3.5); manhole.material = mat('manholeM', '#2a2b2e');
  steamFrom(B, scene, new B.Vector3(-10.6, 1.75, 3.5));

  if (night) buildNight(B, scene, shadow, { mat, glow, rand, flicker });
  buildNewYork(B, scene, shadow, mat, glow, rand, { night });

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

/** Steam rising out of the Con Ed stack's top at `at`. */
function steamFrom(B, scene, at) {
  const steam = new B.ParticleSystem('steam', 120, scene);
  steam.particleTexture = radialTexture(B, scene, 'steamTex', 'rgba(220,225,235,0.35)', 'rgba(220,225,235,0)');
  steam.emitter = at;
  steam.minEmitBox = new B.Vector3(-0.12, 0, -0.12); steam.maxEmitBox = new B.Vector3(0.12, 0, 0.12);
  steam.color1 = steam.color2 = new B.Color4(0.85, 0.87, 0.92, 0.3); steam.colorDead = new B.Color4(0.8, 0.8, 0.85, 0);
  steam.minSize = 0.5; steam.maxSize = 1.6; steam.minLifeTime = 1.5; steam.maxLifeTime = 3; steam.emitRate = 40;
  steam.direction1 = new B.Vector3(-0.1, 1, -0.1); steam.direction2 = new B.Vector3(0.25, 1, 0.1);
  steam.minEmitPower = 0.4; steam.maxEmitPower = 0.8; steam.blendMode = B.ParticleSystem.BLENDMODE_STANDARD; steam.start();
  return steam;
}

/** Night only: neon signs, string lights over the court, fire barrels and rain. */
function buildNight(B, scene, shadow, { mat, glow, rand, flicker }) {
  const Y = LOOK.yardM;
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
    light.diffuse = B.Color3.FromHexString(n.col); light.specular = light.diffuse.scale(0.3);
    light.intensity = 1.1; light.range = 11;
    flicker.push({ kind: 'neon', mat: m, light, base: 1.1, phase: rand() * 10, broken: i === 3 });
  });

  // String lights zig-zagging over the court.
  const bulb = B.MeshBuilder.CreateSphere('bulb', { diameter: 0.09, segments: 6 }, scene);
  bulb.material = glow('bulbM', '#ffd9a0');
  const wireM = mat('wireM', '#111111');
  const bulbs = [];
  for (const [a, b] of [[[-Y, 7.2, -6], [Y, 7.6, 2]], [[-Y, 7.4, 4], [Y, 7.0, -4]], [[-6, 7.5, -Y], [5, 7.3, Y]]]) {
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

  // Fire barrels inside the fence, behind the crowd.
  const fireTex = radialTexture(B, scene, 'fireTex', 'rgba(255,220,150,1)', 'rgba(255,80,10,0)');
  const smokeTex = radialTexture(B, scene, 'smokeTex', 'rgba(120,120,130,0.5)', 'rgba(120,120,130,0)');
  const barrelM = photoMaterial(B, scene, 'barrelM', 'rust', 1.9, 0.9, 1, '#a07060');
  for (const [x, z] of [[-8.4, 4.2], [8.3, -3.4], [6.5, 7.8]]) {
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
    light.diffuse = new B.Color3(1, 0.55, 0.2); light.specular = new B.Color3(0.3, 0.15, 0.05); light.range = 8;
    flicker.push({ kind: 'fire', light, base: 1.2, phase: rand() * 10 });
  }

  // Rain: stretched streaks falling over the court.
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
function buildNewYork(B, scene, shadow, mat, glow, rand, { night = false } = {}) {
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
  // Not on the far wall's left: that is the shop.
  for (const [side, k] of [[1, 2], [1, 6], [3, 3], [3, 7], [0, 5], [0, 7], [2, 1], [2, 5]]) {
    const along = -Y + 2 + 3.1 * k;
    for (let f = 0; f < LOOK.floors; f++) {
      const y = 4.4 + f * 2.6 - 0.95;
      onWall(side, box('escapeDeck', 2.2, 0.05, 0.85, iron), along, y, 0.45);
      onWall(side, box('escapeRail', 2.2, 0.04, 0.04, iron), along, y + 0.9, 0.86);
      for (const dx of [-1.08, -0.36, 0.36, 1.08]) onWall(side, box('escapeBar', 0.03, 0.9, 0.03, iron), along + dx, y + 0.45, 0.86);
      for (const dx of [-1.1, 1.1]) onWall(side, box('escapeSide', 0.04, 0.04, 0.85, iron), along + dx, y + 0.9, 0.45);
      if (f < LOOK.floors - 1) {
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

  // The corner store on the far wall, as in the photo: a dark green awning with white lettering over a lit window.
  const shop = B.MeshBuilder.CreatePlane('bodegaWindow', { width: 4.2, height: 2.1 }, scene);
  const sm = new B.StandardMaterial('bodegaM', scene);
  const shopTex = bodegaTexture(B, scene);
  if (night) { sm.emissiveTexture = shopTex; sm.diffuseColor = new B.Color3(0, 0, 0); } else { sm.diffuseTexture = shopTex; sm.emissiveColor = new B.Color3(0.35, 0.33, 0.3); }
  sm.specularColor = new B.Color3(0, 0, 0);
  shop.material = sm; onWall(0, shop, -6.5, 1.45, 0.04);
  onWall(0, box('bodegaDoor', 1.1, 2.4, 0.06, mat('bodegaDoorM', '#2a1f18')), -3.6, 1.2, 0.03);
  const awning = box('awning', 6.2, 0.06, 1.5, mat('awningM', '#1f4d36'));
  onWall(0, awning, -5.4, 2.95, 0.7); awning.rotation.x = -0.35;
  const valance = B.MeshBuilder.CreatePlane('awningValance', { width: 6.2, height: 0.42 }, scene);
  const vm = mat('awningValanceM', '#ffffff');
  vm.diffuseTexture = signTexture(B, scene, 'awningTex', 'DELI · GROCERY · 24 HR', '#1f4d36', '#f4f1e8', 1024, 72, 'bold 44px "Helvetica Neue", Arial, sans-serif');
  valance.material = vm; onWall(0, valance, -5.4, 2.55, 1.42);
  if (night) {
    const shopLight = new B.PointLight('bodegaLight', new B.Vector3(-6.5, 1.6, Y - 1.5), scene);
    shopLight.diffuse = new B.Color3(1, 0.86, 0.6); shopLight.intensity = 0.9; shopLight.range = 9;
  }

  // A fire hydrant.
  const hydrantM = mat('hydrantM', '#b81d1d', { spec: 0.5, power: 50 });
  const hyd = B.MeshBuilder.CreateCylinder('hydrant', { height: 0.62, diameter: 0.26, tessellation: 14 }, scene);
  hyd.position.set(10.6, 0.46, -4); hyd.material = hydrantM; shadow.addShadowCaster(hyd);
  const dome = B.MeshBuilder.CreateSphere('hydrantCap', { diameter: 0.28, segments: 10, slice: 0.5 }, scene);
  dome.position.set(10.6, 0.77, -4); dome.material = mat('hydrantCapM', '#e8c21a', { spec: 0.5 });
  const nozzle = B.MeshBuilder.CreateCylinder('hydrantNozzle', { height: 0.4, diameter: 0.1 }, scene);
  nozzle.position.set(10.6, 0.57, -4); nozzle.rotation.z = Math.PI / 2; nozzle.material = hydrantM;

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
  stack.position.set(-10.6, 0.85, 3.5);
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
  if (night) {
    const subwayLight = new B.PointLight('subwayLight', new B.Vector3(-Y + 2.2, 2.4, -8), scene);
    subwayLight.diffuse = new B.Color3(0.3, 1, 0.45); subwayLight.intensity = 0.7; subwayLight.range = 6;
  }

  // Green street-name blades on the lamp pole (the pole stands at −11, 11).
  for (const [text, yaw, y] of [['LENOX AV', 0, 3.1], ['W 125 ST', Math.PI / 2, 3.35]]) {
    const blade = B.MeshBuilder.CreatePlane('streetSign', { width: 1.5, height: 0.26 }, scene);
    const bm = new B.StandardMaterial('streetSignM' + text, scene);
    bm.diffuseTexture = signTexture(B, scene, 'streetSignTex' + text, text, '#0b6b3a', '#ffffff', 512, 96, 'bold 62px "Helvetica Neue", Arial, sans-serif');
    bm.emissiveColor = new B.Color3(0.25, 0.25, 0.25); bm.backFaceCulling = false;
    blade.material = bm; blade.position.set(-11, y, 11); blade.rotation.y = yaw;
  }
}

/** Puts a mesh on wall `side` (0 far, +z; then +x, −z, −x) the way buildStreet's `place` does: `along` the wall, `up`, `out` from it. */
function wallPlace(B, mesh, side, along, up, out = 0) {
  const yaw = side * Math.PI / 2, fwd = new B.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new B.Vector3(fwd.z, 0, -fwd.x);
  mesh.position.copyFrom(fwd.scale(LOOK.yardM - out)).addInPlace(right.scale(along)); mesh.position.y = up;
  mesh.rotation.y = yaw;
  return mesh;
}

/**
 * The day court baked in Blender (scripts/bake-court.py → scripts/build-court.mjs → models/court.glb): the same layout as
 * buildStreet, lit by an overcast HDRI with the light baked into lightmaps and vertex colours.
 *
 * Each glTF material is rebuilt as an unlit StandardMaterial. With lighting off, StandardMaterial draws
 * emissive × albedo, then multiplies by the lightmap, so `tint` (from the material's extras) × albedo × lightmap × `lmLevel`
 * is the baked colour and no real-time light adds to it. The ground keeps a little real-time light from the key so the
 * fighters and crowd still cast soft contact shadows onto it: emissive 1 − k plus the key's k gives the same colour
 * outside a shadow. The canvas-drawn signs and graffiti, the steam and the crowd are added on top, as in buildStreet.
 * Returns { ground, crowd, lit, skyUp, update } (`lit`: meshes the hemispheric fill must leave alone), or throws.
 */
async function buildBakedCourt(B, scene, key) {
  await loadGltfLoader(B);
  // Keep the textures' bytes as they are: by default the loader uploads colour images as sRGB buffers, so the GPU would
  // linearise them on sampling, and StandardMaterial (which works in gamma space) would draw them far too dark.
  const plug = B.SceneLoader.OnPluginActivatedObservable.add((loader) => { if (loader.name === 'gltf') loader.useSRGBBuffers = false; });
  const c = await B.SceneLoader.LoadAssetContainerAsync('/boxing/models/', 'court.glb', scene)
    .finally(() => B.SceneLoader.OnPluginActivatedObservable.remove(plug));
  c.addAllToScene();
  const info = c.transformNodes.find((n) => n.name === 'court_info')?.metadata?.gltf?.extras ?? {};
  const keyShare = key.intensity * Math.max(0, -key.direction.normalizeToNew().y);
  const made = new Map(), ground = [], lit = [];
  const white = B.RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  white.level = info.lmLevel ?? 1;
  for (const mesh of c.meshes) {
    const pbr = mesh.material;
    if (!pbr) continue;
    mesh.isPickable = false;
    if (!made.has(pbr)) {
      const x = pbr.metadata?.gltf?.extras ?? {};
      const tint = B.Color3.FromArray(x.tint ?? [1, 1, 1]);
      const m = new B.StandardMaterial(pbr.name, scene);
      m.diffuseTexture = pbr.albedoTexture ?? null;
      m.specularColor = new B.Color3(0, 0, 0);
      if (x.ground) { m.emissiveColor = tint.scale(1 - keyShare); m.diffuseColor = tint; } else { m.disableLighting = true; m.emissiveColor = tint; }
      if (pbr.emissiveTexture) {
        m.lightmapTexture = pbr.emissiveTexture;          // keeps the glTF's texCoord 1
        m.lightmapTexture.level = info.lmLevel ?? 1;
        m.useLightmapAsShadowmap = true;
      }
      else if (x.kind === 'vc' || x.kind === 'flat') {
        // Vertex colours hold the light ÷ lmLevel; a 1×1 white lightmap carries the level (the fence just gets the court's).
        m.lightmapTexture = white;
        m.useLightmapAsShadowmap = true;
        if (x.kind === 'flat') { m.lightmapTexture = white.clone(); m.lightmapTexture.level = info.court ?? 1; }
      }
      if (x.alpha) { m.diffuseTexture.hasAlpha = true; m.useAlphaFromDiffuseTexture = true; m.backFaceCulling = false; }
      else m.backFaceCulling = pbr.backFaceCulling;
      made.set(pbr, { m, ground: !!x.ground });
    }
    const { m, ground: isGround } = made.get(pbr);
    mesh.material = m;
    lit.push(mesh);
    if (isGround) { mesh.receiveShadows = true; ground.push(mesh); }
    mesh.freezeWorldMatrix();
  }
  for (const pbr of made.keys()) pbr.dispose(false, false);

  // The sky: the same HDRI, tone-mapped, on a dome that stays centred on the camera.
  const dome = B.MeshBuilder.CreateSphere('skyDome', { diameter: 180, segments: 24, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const dm = new B.StandardMaterial('skyDomeM', scene);
  dm.emissiveTexture = new B.Texture('/boxing/models/court_sky.webp', scene);
  dm.emissiveTexture.uScale = -1;                         // seen from inside
  dm.disableLighting = true; dm.fogEnabled = false; dm.specularColor = new B.Color3(0, 0, 0);
  dome.material = dm; dome.infiniteDistance = true; dome.isPickable = false;

  // Canvas-drawn pieces on top of the bake: unlit, at about the brightness of the light the bake gives their surface.
  const flat = (name, tex, level, { alpha = false, twoSided = false } = {}) => {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseTexture = tex; m.disableLighting = true; m.emissiveColor = new B.Color3(level, level, level);
    m.specularColor = new B.Color3(0, 0, 0);
    if (alpha) { tex.hasAlpha = true; m.useAlphaFromDiffuseTexture = true; }
    m.backFaceCulling = !twoSided;
    return m;
  };
  const F = COURT.half;
  const lines = B.MeshBuilder.CreateGround('paint', { width: F * 2, height: F * 2 }, scene);
  lines.position.y = 0.006; lines.receiveShadows = true;
  const lm = new B.StandardMaterial('paintM', scene);
  lm.diffuseTexture = courtLinesTexture(B, scene, F * 2); lm.useAlphaFromDiffuseTexture = true;
  const paint = 0.82;
  lm.diffuseColor = new B.Color3(paint, paint, paint); lm.emissiveColor = lm.diffuseColor.scale(1 - keyShare);
  lm.specularColor = new B.Color3(0, 0, 0);
  lines.material = lm; ground.push(lines); lit.push(lines);
  const tags = [['STREET KINGS', '#ff2d95', '#14081a'], ['UPTOWN', '#ffd23f', '#1a1206'], ['BROOKLYN', '#19e3ff', '#04161a'], ['BX 4 LIFE', '#a6ff3a', '#0d1a05']];
  tags.forEach(([word, fill, line], side) => {
    const piece = wallPlace(B, B.MeshBuilder.CreatePlane('graffiti', { width: 5.5, height: 2.1 }, scene), side, 3 - side * 1.2, 1.9, 0.05);
    piece.material = flat('graffitiM' + side, graffitiTexture(B, scene, 'graffitiTex' + side, word, fill, line), 0.7, { alpha: true });
  });
  const shop = wallPlace(B, B.MeshBuilder.CreatePlane('bodegaWindow', { width: 4.2, height: 2.1 }, scene), 0, -6.5, 1.45, 0.04);
  shop.material = flat('bodegaM', bodegaTexture(B, scene), 0.9);
  const valance = wallPlace(B, B.MeshBuilder.CreatePlane('awningValance', { width: 6.2, height: 0.42 }, scene), 0, -5.4, 2.62, 1.4);
  valance.material = flat('awningValanceM', signTexture(B, scene, 'awningTex', 'DELI · GROCERY · 24 HR', '#1f4d36', '#f4f1e8', 1024, 72, 'bold 44px "Helvetica Neue", Arial, sans-serif'), 0.62);
  for (const [text, yaw, y] of [['LENOX AV', 0, 3.1], ['W 125 ST', Math.PI / 2, 3.35]]) {
    const blade = B.MeshBuilder.CreatePlane('streetSign', { width: 1.5, height: 0.26 }, scene);
    blade.material = flat('streetSignM' + text, signTexture(B, scene, 'streetSignTex' + text, text, '#0b6b3a', '#ffffff', 512, 96, 'bold 62px "Helvetica Neue", Arial, sans-serif'), 0.75, { twoSided: true });
    blade.position.set(-11, y, 11); blade.rotation.y = yaw;
  }
  const subway = B.MeshBuilder.CreatePlane('subwaySign', { width: 1.9, height: 0.42 }, scene);
  subway.material = flat('subwaySignM', signTexture(B, scene, 'subwaySignTex', 'SUBWAY', '#111111', '#ffffff', 512, 112, 'bold 74px "Helvetica Neue", Arial, sans-serif'), 0.8);
  subway.position.set(-LOOK.yardM + 1.625, 2.05, -8); subway.rotation.y = -Math.PI / 2;

  steamFrom(B, scene, new B.Vector3(-10.2, 1.75, 3.5));
  const crowd = buildCrowd(B, scene);
  return {
    ground: lines, crowd, lit, skyUp: info.skyUp,
    update(t, dt) { crowd.update(t, dt); },
  };
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

/**
 * The cypher crowd from the reference photo: packed shoulder to shoulder round the fight, open on the hard camera's
 * side, leaning in, a third with their arms up. Each body part is its own thin-instanced mesh so a person can wear a
 * Yankees-style fitted cap, a varsity or denim jacket or a white tee, jeans and Timberland-style boots, in the photo's
 * colours.
 */
const CROWD_WEAR = {
  skin: ['#4a2f22', '#6b4430', '#8a5a3c', '#a8774f', '#c68a62', '#dcb08a'],
  top: [['#1f2a44', '#c9c6bf'], ['#5b7fa6'], ['#34506e'], ['#e9e7e2'], ['#e9e7e2'], ['#1b1b1d'], ['#7c7f84'], ['#4b5136'], ['#8b1e2b', '#e9e7e2'], ['#1b1b1d']],
  jeans: ['#8fa8c4', '#7d97b5', '#5e7896', '#2f3b52', '#1e1f22', '#6d6f73'],
  boots: ['#c89a5c', '#c89a5c', '#b8864a', '#ececea', '#1a1a1a'],
  cap: ['#1c2540', '#1c2540', '#1c2540', '#111111', '#7a1d24'],
};

function buildCrowd(B, scene) {
  const m = new B.StandardMaterial('crowdM', scene);
  m.diffuseColor = new B.Color3(1, 1, 1); m.specularColor = new B.Color3(0.02, 0.02, 0.02);
  const limb = (name, h, d0, d1, x, y, rz = 0) => {
    const c = B.MeshBuilder.CreateCylinder(name, { height: h, diameterTop: d0, diameterBottom: d1, tessellation: 8 }, scene);
    c.position.set(x, y, 0); c.rotation.z = rz; return c;
  };
  const merge = (name, meshes) => { const mm = B.Mesh.MergeMeshes(meshes, true); mm.name = name; mm.material = m; return mm; };
  const legs = merge('crowdLegs', [limb('legL', 0.8, 0.17, 0.14, -0.1, 0.5, 0.04), limb('legR', 0.8, 0.17, 0.14, 0.1, 0.5, -0.04)]);
  const boots = merge('crowdBoots', [
    B.MeshBuilder.CreateBox('bootL', { width: 0.13, height: 0.16, depth: 0.28 }, scene), B.MeshBuilder.CreateBox('bootR', { width: 0.13, height: 0.16, depth: 0.28 }, scene),
  ].map((b, i) => { b.position.set(i ? 0.11 : -0.11, 0.08, 0.04); return b; }));
  const torso = B.MeshBuilder.CreateCylinder('crowdBody', { height: 0.64, diameterTop: 0.46, diameterBottom: 0.36, tessellation: 10 }, scene);
  torso.scaling.z = 0.62; torso.position.y = 1.2;
  const top = merge('crowdTop', [torso, limb('neck', 0.1, 0.09, 0.1, 0, 1.55)]);
  const armsDown = merge('crowdArms', [limb('armL', 0.64, 0.12, 0.09, -0.27, 1.16, -0.12), limb('armR', 0.64, 0.12, 0.09, 0.27, 1.16, 0.12)]);
  const armsUp = merge('crowdArmsUp', [limb('armUL', 0.52, 0.1, 0.08, -0.28, 1.72, 0.28), limb('armUR', 0.52, 0.1, 0.08, 0.28, 1.72, -0.28)]);
  const hand = (x, y) => { const h = B.MeshBuilder.CreateSphere('hand', { diameter: 0.09, segments: 6 }, scene); h.position.set(x, y, 0); return h; };
  const handsDown = merge('crowdHands', [hand(-0.31, 0.83), hand(0.31, 0.83)]);
  const handsUp = merge('crowdHandsUp', [hand(-0.36, 2.0), hand(0.36, 2.0)]);
  const head = B.MeshBuilder.CreateSphere('crowdHead', { diameter: 0.22, segments: 8 }, scene);
  head.position.y = 1.68; head.material = m; head.name = 'crowdHeads';
  const capDome = B.MeshBuilder.CreateSphere('capDome', { diameter: 0.24, segments: 8, slice: 0.55 }, scene);
  capDome.position.y = 1.71;
  const brim = B.MeshBuilder.CreateBox('capBrim', { width: 0.2, height: 0.015, depth: 0.14 }, scene);
  brim.position.set(0, 1.72, 0.16);
  const cap = merge('crowdCaps', [capDome, brim]);

  const seats = [];
  const rand = mulberryish(7);
  for (let row = 0; row < 4; row++) {
    const r = RING_HALF_M + 1.9 + row * 0.55;
    const n = Math.round((2 * Math.PI * r) / 0.5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.3 + (rand() - 0.5) * 0.08;
      // Leave a gap toward −z, where the hard camera stands.
      const fromCam = Math.abs(Math.atan2(Math.sin(a), -Math.cos(a)));
      if (fromCam < 0.8 + row * 0.08 || rand() < 0.06) continue;
      const x = Math.sin(a) * r + (rand() - 0.5) * 0.15, z = Math.cos(a) * r + (rand() - 0.5) * 0.15;
      const pick = (list) => list[Math.floor(rand() * list.length)];
      const topCols = pick(CROWD_WEAR.top);
      seats.push({
        x, z, yaw: Math.atan2(-x, -z), phase: rand() * Math.PI * 2, h: 0.92 + rand() * 0.14, lean: 0.06 + rand() * 0.1,
        up: rand() < 0.2, capped: rand() < 0.55, backwards: rand() < 0.3,
        col: { legs: pick(CROWD_WEAR.jeans), boots: pick(CROWD_WEAR.boots), top: topCols[0], arms: topCols[1] ?? topCols[0], head: pick(CROWD_WEAR.skin), cap: pick(CROWD_WEAR.cap) },
      });
    }
  }
  // Each part lists the people who have it and the colour key it wears.
  const parts = [
    { mesh: legs, key: 'legs', who: () => true }, { mesh: boots, key: 'boots', who: () => true },
    { mesh: top, key: 'top', who: () => true }, { mesh: head, key: 'head', who: () => true },
    { mesh: armsDown, key: 'arms', who: (s) => !s.up }, { mesh: armsUp, key: 'arms', who: (s) => s.up },
    { mesh: handsDown, key: 'head', who: (s) => !s.up }, { mesh: handsUp, key: 'head', who: (s) => s.up },
    { mesh: cap, key: 'cap', who: (s) => s.capped },
  ].map((p) => {
    const people = seats.filter(p.who);
    const cols = new Float32Array(people.length * 4);
    people.forEach((s, i) => { const c = B.Color3.FromHexString(s.col[p.key]); cols.set([c.r, c.g, c.b, 1], i * 4); });
    const mats = new Float32Array(people.length * 16);
    p.mesh.thinInstanceSetBuffer('matrix', mats, 16, false);
    p.mesh.thinInstanceSetBuffer('color', cols, 4, true);
    return { ...p, people, mats };
  });
  const tmp = new B.Matrix(), q = new B.Quaternion(), sc = new B.Vector3(1, 1, 1), pos = new B.Vector3();

  let excite = 0;
  return {
    mesh: top,
    /** Crowd bounce; `excite` jumps on big moments and settles. */
    update(t, dt) {
      excite = Math.max(0, excite - dt * 0.6);
      for (const p of parts) {
        p.people.forEach((s, i) => {
          const bob = Math.max(0, Math.sin(t * (2 + excite * 6) + s.phase)) * (0.02 + excite * 0.14);
          pos.set(s.x, bob, s.z); sc.set(1, s.h, 1);
          const yaw = s.yaw + Math.sin(t * 0.4 + s.phase) * 0.2 + (p.key === 'cap' && s.backwards ? Math.PI : 0);
          B.Quaternion.RotationYawPitchRollToRef(yaw, p.key === 'cap' && s.backwards ? -s.lean : s.lean, 0, q);
          B.Matrix.ComposeToRef(sc, q, pos, tmp);
          tmp.copyToArray(p.mats, i * 16);
        });
        p.mesh.thinInstanceBufferUpdated('matrix');
      }
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
 * names: { red, blue } for the lower thirds. looks: { red, blue } from character creation (see normalizeLook); a
 * corner without one wears its outfit from the reference photo.
 */
export async function createArena3D({ parent, sim, names = {}, looks = {}, timeOfDay = 'day', BABYLON: B = globalThis.BABYLON }) {
  const night = timeOfDay === 'night';
  B ??= await loadBabylon();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
  canvas.setAttribute('aria-label', '3D view of the fight');
  parent.appendChild(canvas);
  const overlay = makeOverlay(parent);

  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, antialias: true }, true);
  const scene = new B.Scene(engine);
  let key, shadow, hemi;
  if (night) {
    // Night: a dark blue sky glow and a damp haze that the lamps bleed into.
    const haze = new B.Color3(0.05, 0.055, 0.085);
    scene.clearColor = new B.Color4(haze.r, haze.g, haze.b, 1);
    scene.ambientColor = new B.Color3(0.22, 0.22, 0.28);
    scene.fogMode = B.Scene.FOGMODE_EXP2; scene.fogDensity = 0.036; scene.fogColor = haze;
    // Cool moonlight fill, a work lamp hung over the court (the key, for shadows), and a wide warm flood from it;
    // the street adds its own neon, sodium, fire and headlights.
    const hemi = new B.HemisphericLight('moon', new B.Vector3(0.2, 1, -0.3), scene);
    hemi.intensity = 0.26; hemi.diffuse = new B.Color3(0.55, 0.62, 0.9); hemi.groundColor = new B.Color3(0.12, 0.1, 0.12);
    hemi.specular = new B.Color3(0.1, 0.1, 0.15);
    key = new B.DirectionalLight('workLamp', new B.Vector3(0.12, -1, 0.18), scene);
    key.position = new B.Vector3(-1, 12, -2); key.intensity = 1.05; key.diffuse = new B.Color3(1, 0.88, 0.7);
    const flood = new B.SpotLight('flood', new B.Vector3(0, 6.2, 0), new B.Vector3(0, -1, 0), Math.PI / 1.7, 3, scene);
    flood.intensity = 1.0; flood.diffuse = new B.Color3(1, 0.86, 0.66); flood.specular = new B.Color3(0.3, 0.27, 0.24); flood.range = 16;
    const lampCage = B.MeshBuilder.CreateCylinder('workLampShade', { height: 0.25, diameterTop: 0.15, diameterBottom: 0.55, tessellation: 16 }, scene);
    lampCage.position.set(0, 6.3, 0); lampCage.material = new B.StandardMaterial('workLampM', scene);
    lampCage.material.diffuseColor = new B.Color3(0.15, 0.16, 0.18); lampCage.material.emissiveColor = new B.Color3(0.9, 0.75, 0.5);
    shadow = new B.ShadowGenerator(2048, key);
    shadow.useBlurExponentialShadowMap = true; shadow.blurKernel = 16; shadow.darkness = 0.4;
  } else {
    // Day, as in the reference photo: an overcast autumn afternoon. A pale grey sky, soft even light from above with
    // barely any shadow, a slightly cool cast, and a light haze down the street.
    const sky = new B.Color3(0.76, 0.79, 0.81);
    scene.clearColor = new B.Color4(sky.r, sky.g, sky.b, 1);
    scene.ambientColor = new B.Color3(0.35, 0.36, 0.38);
    scene.fogMode = B.Scene.FOGMODE_EXP2; scene.fogDensity = 0.012; scene.fogColor = sky;
    hemi = new B.HemisphericLight('overcast', new B.Vector3(0, 1, 0), scene);
    hemi.intensity = 1.05; hemi.diffuse = new B.Color3(0.95, 0.97, 1); hemi.groundColor = new B.Color3(0.42, 0.42, 0.42);
    hemi.specular = new B.Color3(0.05, 0.05, 0.05);
    key = new B.DirectionalLight('cloudSun', new B.Vector3(0.25, -1, 0.35), scene);
    key.position = new B.Vector3(-4, 20, -6); key.intensity = 0.35; key.diffuse = new B.Color3(1, 0.98, 0.95);
    key.specular = new B.Color3(0, 0, 0);
    shadow = new B.ShadowGenerator(2048, key);
    shadow.useBlurExponentialShadowMap = true; shadow.blurKernel = 48; shadow.darkness = 0.25;
  }

  // Day: the court baked in Blender (models/court.glb). Night, or if the bake fails to load: the procedural street.
  let arena = null;
  if (!night) {
    try {
      arena = await buildBakedCourt(B, scene, key);
      hemi.excludedMeshes.push(...arena.lit);         // the bake already holds the sky's light
      if (arena.skyUp) {
        // Tint the fighters' fill with the HDRI's own sky colour.
        const peak = Math.max(...arena.skyUp);
        hemi.diffuse = new B.Color3(...arena.skyUp.map((c) => (c / peak) ** (1 / 2.2)));
      }
    } catch (err) {
      console.warn('baked court unavailable, using the procedural street:', err);
    }
  }
  arena ??= buildStreet(B, scene, shadow, { night });
  mergeStatic(B, scene, shadow, [arena.ground]);

  // Rigged Quaternius boxers when the models load; the primitive boxers otherwise.
  let boxers;
  try {
    const assets = await loadBoxerAssets(B, scene);
    boxers = Object.fromEntries(['red', 'blue'].map((c) => [c, new ModelBoxer(B, scene, assets, c, shadow, { glove: LOOK.wraps, trunks: LOOK.trunks[c], wraps: true, outfit: looks[c] ? normalizeLook(looks[c], PHOTO_OUTFITS[c]) : PHOTO_OUTFITS[c] })]));
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
  pipe.imageProcessing.exposure = night ? 1.2 : 1.05; pipe.imageProcessing.contrast = night ? 1.2 : 1.08;
  pipe.imageProcessing.vignetteEnabled = true; pipe.imageProcessing.vignetteWeight = night ? 1.4 : 0.7; pipe.imageProcessing.vignetteColor = new B.Color4(0, 0, 0, 0);
  if (!night) {
    // The photo's grade: muted colour, a touch of green-cyan in the shadows, warm-neutral highlights.
    const curves = new B.ColorCurves();
    curves.globalSaturation = -22;
    curves.shadowsHue = 170; curves.shadowsDensity = 18; curves.shadowsSaturation = 0;
    curves.highlightsHue = 40; curves.highlightsDensity = 8;
    pipe.imageProcessing.colorCurvesEnabled = true; pipe.imageProcessing.colorCurves = curves;
  }
  pipe.sharpenEnabled = true; pipe.sharpen.edgeAmount = 0.25;
  if (night) { const glow = new B.GlowLayer('glow', scene); glow.intensity = 0.3; }   // only so neon reads as neon

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
