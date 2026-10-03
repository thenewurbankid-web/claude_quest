// Quest in 2.5D: the hub as a lit miniature diorama. Three.js, square grid, tilt-shift + bloom, day/night, Ember Well
// fire, wandering Keepers. Models come from assets/3d/manifest.json (KayKit, CC0) when present; until then plain
// placeholder shapes stand in so the scene still runs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SquareGrid } from './grid.js';
import { HUB, SOLID } from './hub.js';
import { dayPhase, clockLabel } from './clock.js';
import { createAtmosphere } from './atmosphere.js';
import { LOOK } from './look.js';
import { load as loadSunnyside } from './sunnyside.js';

const A = 'assets/';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rows = HUB.map(r => r.padEnd(24, '.').slice(0, 24));
const grid = new SquareGrid(24, rows.length, 1);
const at = (c, r) => (grid.inside(c, r) ? rows[r][c] : 'T');

// ---------- renderer, scene, camera ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ea, 30, 60);
const camera = new THREE.PerspectiveCamera(LOOK.camera.fov, 1, 0.1, 200);
// Lower and closer than a classic top-down view, like the newer Pokémon games: the forest edge and the sky's haze
// show at the top of the frame, which is what gives the depth layers room to move.
const CAM = new THREE.Vector3(0, LOOK.camera.height, LOOK.camera.back);
const camOffset = CAM.clone();

// ---------- sky + lighting ----------
const pmrem = new THREE.PMREMGenerator(renderer);
new HDRLoader().load(A + 'sky/kloofendal_48d_partly_cloudy_puresky_1k.hdr', tex => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.background = tex;
  scene.backgroundBlurriness = 0.35;
});
const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a7a48, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ---------- ground: flat-shaded tiles with gentle colour variation (Sunnyside paints over them in build) ----------
let tiles, meadow, blades;
const COLORS = {
  grass: [0x80bf5b, 0x84c25e, 0x7dbc58], tall: [0x5fa646], road: [0xd8c594, 0xd5c290, 0xdac796], water: [0x4f9fd1],
};
function tileColor(ch, c, r) {
  const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
  const pick = a => a[h % a.length];
  if (ch === '=') return pick(COLORS.road);
  if (ch === '~') return pick(COLORS.water);
  if (ch === ',') return pick(COLORS.tall);
  return pick(COLORS.grass);
}
{
  const geo = new THREE.BoxGeometry(1, 0.4, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  tiles = new THREE.InstancedMesh(geo, mat, grid.cols * grid.rows);
  tiles.receiveShadow = true;
  const m = new THREE.Matrix4(), col = new THREE.Color();
  let i = 0;
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const ch = at(c, r), { x, z } = grid.toWorld(c, r);
    const y = ch === '=' ? -0.24 : ch === '~' ? -0.5 : -0.2;
    m.makeTranslation(x, y, z);
    tiles.setMatrixAt(i, m);
    tiles.setColorAt(i, col.setHex(tileColor(ch, c, r)));
    i++;
  }
  scene.add(tiles);
}
// The world goes on past the map: a wide meadow fading into the fog, with a ring of forest just outside the edge.
{
  meadow = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x6aa84c, roughness: 1 }));
  meadow.rotation.x = -Math.PI / 2; meadow.position.y = -0.02 - 0.4; meadow.receiveShadow = true;
  scene.add(meadow);
}
// water surface that shimmers
const water = (() => {
  const mat = new THREE.MeshStandardMaterial({ color: 0x5fb3e3, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  const group = new THREE.Group();
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (at(c, r) === '~') {
    const { x, z } = grid.toWorld(c, r);
    // UVs in cells (world space), so a tiling texture runs across neighbouring water cells without seams.
    const geo = new THREE.PlaneGeometry(1, 1), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, c + uv.getX(i), grid.rows - 1 - r + uv.getY(i));
    const q = new THREE.Mesh(geo, mat);
    q.rotation.x = -Math.PI / 2; q.position.set(x, -0.28, z); group.add(q); // just above the water tile tops (-0.3)
  }
  scene.add(group);
  return mat;
})();

// ---------- grass blades, instanced, swaying in the wind ----------
const wind = { value: 0 };
{
  const blade = new THREE.ConeGeometry(0.035, 0.32, 3);
  blade.translate(0, 0.16, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6fb24a, roughness: 0.9 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = wind;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sway = sin(uTime * 1.6 + wp.x * 0.7 + wp.z * 0.5) * 0.08 + sin(uTime * 3.1 + wp.x * 2.3) * 0.02;
      transformed.x += sway * position.y * 3.0;`);
  };
  const spots = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const ch = at(c, r);
    const n = ch === ',' ? 26 : ch === '.' || ch === 'F' ? 5 : 0;
    for (let k = 0; k < n; k++) spots.push([c, r]);
  }
  const mesh = blades = new THREE.InstancedMesh(blade, mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  spots.forEach(([c, r], i) => {
    const { x, z } = grid.toWorld(c, r);
    const tall = at(c, r) === ',';
    p.set(x + rnd() - 0.5, 0, z + rnd() - 0.5);
    q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3));
    const k = (tall ? 1.4 : 0.8) * (0.7 + rnd() * 0.6);
    s.set(k, k, k);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  });
  mesh.castShadow = false; mesh.receiveShadow = true;
  scene.add(mesh);
}

// ---------- models: KayKit when present, placeholders until then ----------
const loader = new GLTFLoader();
let manifest = {};
const cache = new Map();
async function loadManifest() {
  try { const r = await fetch(A + '3d/manifest.json', { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch {}
}
// KayKit characters share one rig, and their clips live in separate files (manifest.animations): load those once and
// give every character the same clips. A role can list several files; `variant` picks one, so the Keepers differ.
let sharedClips = null;
async function animationClips() {
  if (!sharedClips) sharedClips = Promise.all((manifest.animations || []).map(f => loader.loadAsync(A + '3d/' + f).then(g => g.animations).catch(() => [])))
    .then(sets => sets.flat().filter(c => c.name !== 'T-Pose'));
  return sharedClips;
}
async function model(role, variant = 0) {
  const entry = manifest[role];
  const file = Array.isArray(entry) ? entry[variant % entry.length] : entry;
  if (!file) return null;
  if (!cache.has(file)) cache.set(file, loader.loadAsync(A + '3d/' + file).catch(() => null));
  const g = await cache.get(file);
  if (!g) return null;
  const obj = SkeletonUtils.clone(g.scene);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { obj, clips: [...g.animations, ...(await animationClips())] };
}
const shadowed = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
// Placeholder shapes, plainly marked as stand-ins (no drawn art): box houses, cone trees, capsule people.
function placeholder(kind, color = 0xd97757) {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  if (kind === 'house' || kind === 'center') {
    const w = kind === 'center' ? 2.6 : 1.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, w * 0.8), mat(0xf1e6d2)); body.position.y = 0.55;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, 0.9, 4), mat(color)); roof.position.y = 1.55; roof.rotation.y = Math.PI / 4;
    g.add(body, roof);
  } else if (kind === 'tree') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 6), mat(0x7a5230)); trunk.position.y = 0.25;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 0), mat(0x3f8f45)); crown.position.y = 0.85;
    g.add(trunk, crown);
  } else if (kind === 'person') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), mat(color)); body.position.y = 0.38;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat(0xf6d2b0)); head.position.y = 0.82;
    g.add(body, head);
  } else if (kind === 'prop') {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), mat(color)); post.position.y = 0.3; g.add(post);
  }
  return shadowed(g);
}
async function place(role, fallbackKind, c, r, { color, rot = 0, scale = 1, offset = [0, 0], variant = 0 } = {}) {
  const m = await model(role, variant);
  const obj = m ? m.obj : placeholder(fallbackKind, color);
  const { x, z } = grid.toWorld(c, r);
  obj.position.set(x + offset[0], 0, z + offset[1]);
  obj.rotation.y = rot;
  // manifest.height sizes a model to a height in tiles, whatever units the file uses.
  const fit = m && manifest.height?.[role] ? manifest.height[role] / Math.max(0.01, new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y) : 1;
  obj.scale.setScalar(m ? fit * (manifest.scale?.[role] ?? 1) * scale : scale);
  scene.add(obj);
  return { obj, clips: m?.clips || [] };
}

// ---------- the Ember Well: warm light, fire and rising sparks ----------
const tex = new THREE.TextureLoader();
const fx = name => { const t = tex.load(A + 'fx/' + name + '.png'); t.colorSpace = THREE.SRGBColorSpace; return t; };
function emitter({ map, count, color, size, origin, spread, rise, life }) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map, color, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return t => {
    for (let i = 0; i < count; i++) {
      const k = ((t / life) + seeds[i]) % 1, a = seeds[i] * 40;
      pos[i * 3] = origin.x + Math.sin(a) * spread * (1 - k * 0.5);
      pos[i * 3 + 1] = origin.y + k * rise;
      pos[i * 3 + 2] = origin.z + Math.cos(a) * spread * (1 - k * 0.5);
    }
    geo.attributes.position.needsUpdate = true;
  };
}
const wellCell = (() => { for (let r = 0; r < grid.rows; r++) { const c = rows[r].indexOf('W'); if (c >= 0) return [c, r]; } return [10, 8]; })();
const wellPos = grid.toWorld(...wellCell);
const wellLight = new THREE.PointLight(0xffa04a, 6, LOOK.light.fireReach, 1.6);
wellLight.position.set(wellPos.x, 0.9, wellPos.z);
wellLight.castShadow = true;
wellLight.shadow.mapSize.set(512, 512);
scene.add(wellLight);
// Placeholder well, hidden once the Sunnyside stone well is built (build() moves the fire into its opening).
const wellParts = new THREE.Group();
{
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, roughness: 0.9 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.42, 14, 1, true), stone);
  ring.position.set(wellPos.x, 0.21, wellPos.z);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.07, 6, 18), stone);
  rim.rotation.x = Math.PI / 2; rim.position.set(wellPos.x, 0.42, wellPos.z);
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), new THREE.MeshStandardMaterial({ color: 0x3a1a08, emissive: 0xff7a20, emissiveIntensity: 2.2 }));
  embers.rotation.x = -Math.PI / 2; embers.position.set(wellPos.x, 0.3, wellPos.z);
  wellParts.add(shadowed(ring), shadowed(rim), embers);
  scene.add(wellParts);
}
const fireAt = { x: wellPos.x, y: 0.35, z: wellPos.z }, sparkAt = { x: wellPos.x, y: 0.5, z: wellPos.z };
const fire = emitter({ map: fx('flame_03'), count: 26, color: 0xffa040, size: 0.55, origin: fireAt, spread: 0.22, rise: 0.9, life: 1.1 });
const sparks = emitter({ map: fx('spark_04'), count: 18, color: 0xffd080, size: 0.16, origin: sparkAt, spread: 0.35, rise: 2.6, life: 2.4 });

// ---------- the Beacon atop the Keeper's Lodge: the Realm's status (public/quest/boot.js) ----------
// Gold burns steady, amber flickers, red pulses. Dark until a Realm exists in the ledger.
const BEACON = { gold: 0xf2c14e, amber: 0xf08a24, red: 0xef4b4b };
const lodgeCell = (() => { for (let r = 0; r < grid.rows; r++) { const c = rows[r].indexOf('C'); if (c >= 0) return [c, r]; } return [9, 2]; })();
const lodgePos = grid.toWorld(...lodgeCell);
const beaconFlame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: BEACON.gold }));
const beaconLight = new THREE.PointLight(BEACON.gold, 0, 6, 1.6);
const beaconGroup = new THREE.Group();
beaconGroup.add(beaconFlame, beaconLight);
beaconGroup.position.set(lodgePos.x + 0.5, 2.9, lodgePos.z - 0.5);
beaconGroup.visible = false;
scene.add(beaconGroup);
let beaconColor = null;
const setBeacon = color => {
  beaconColor = BEACON[color] ? color : null;
  beaconGroup.visible = !!beaconColor;
  if (beaconColor) { beaconFlame.material.color.setHex(BEACON[color]); beaconLight.color.setHex(BEACON[color]); }
};
addEventListener('quest:beacon', e => setBeacon(e.detail));
setBeacon(window.__questBeacon);
const beaconGlow = t => {
  if (!beaconColor) return;
  const wave = reduceMotion ? 0 : beaconColor === 'red' ? Math.sin(t * 4) : beaconColor === 'amber' ? Math.sin(t * 13) * 0.4 + Math.sin(t * 29) * 0.3 : 0;
  beaconLight.intensity = 3 + wave * 1.5;
  beaconFlame.scale.setScalar(1 + wave * 0.15);
};

// ---------- fireflies at night ----------
const fireflies = (() => {
  const n = 40, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), base = [];
  for (let i = 0; i < n; i++) { base.push([(Math.random() - 0.5) * 20, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 13, Math.random() * 10]); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: fx('light_01'), color: 0xd8ff9a, size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  scene.add(new THREE.Points(geo, mat));
  return { mat, tick(t) { base.forEach(([x, y, z, s], i) => { pos[i * 3] = x + Math.sin(t * 0.5 + s) * 0.6; pos[i * 3 + 1] = y + Math.sin(t * 1.3 + s * 2) * 0.2; pos[i * 3 + 2] = z + Math.cos(t * 0.4 + s) * 0.6; }); geo.attributes.position.needsUpdate = true; } };
})();

// ---------- characters on the grid ----------
const actors = [];
function makeActor(obj, clips, c, r, speed, sprite = null) {
  const a = { obj, c, r, from: grid.toWorld(c, r), to: grid.toWorld(c, r), k: 1, speed, dir: 'down', mixer: null, actions: {}, sprite };
  if (clips.length) {
    a.mixer = new THREE.AnimationMixer(obj);
    for (const clip of clips) a.actions[clip.name.toLowerCase()] = a.mixer.clipAction(clip);
  }
  obj.position.set(a.from.x, obj.position.y, a.from.z); // keeps a set height (ducks sit in the water)
  actors.push(a);
  return a;
}
// KayKit clip names; the player moves at running pace, so it runs where the Keepers walk.
const CLIP = { idle: ['idle_a'], walk: ['walking_a'], run: ['running_a', 'walking_a'] };
function play(a, name) {
  if (!a.mixer) return;
  const keys = Object.keys(a.actions);
  const want = (CLIP[name] || []).find(k => a.actions[k]) || keys.find(k => k.includes(name)) || keys[0];
  if (!want || a.current === want) return;
  a.actions[a.current]?.fadeOut(LOOK.people.blend);
  a.actions[want].reset().fadeIn(LOOK.people.blend).play();
  a.current = want;
}
// Ducks keep to the water; everyone else keeps off water, solid cells and the trees standing inside the map.
const treeCells = new Set();
const free = (c, r, a) => (a?.swims ? at(c, r) === '~' : !SOLID.has(at(c, r)) && !treeCells.has(c + ',' + r)) && !actors.some(o => (o.c === c && o.r === r));
function tryMove(a, dir) {
  a.dir = dir;
  const [c, r] = grid.step(a.c, a.r, dir);
  if (!free(c, r, a)) return false;
  a.from = grid.toWorld(a.c, a.r); a.to = grid.toWorld(c, r); a.c = c; a.r = r; a.k = 0;
  return true;
}
function updateActor(a, dt) {
  if (!a.sprite) {
    const target = grid.heading(a.dir);
    let d = target - a.obj.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    a.obj.rotation.y += d * Math.min(1, dt * LOOK.people.turn);
  }
  // Sprites keep walking frames through back-to-back steps instead of flicking to idle between cells.
  a.sprite?.tick(dt, a.k < 1 || (a === player && held.size > 0), a.dir);
  if (a.k < 1) {
    a.k += dt * a.speed;
    // The player glides at a steady speed: when a key is still held at the end of a cell, the next step starts with
    // the leftover progress, so there is no stop or ease between cells. NPCs ease in and out of single steps.
    if (a === player && a.k >= 1 && held.size) { const over = a.k - 1; if (tryMove(a, newestHeld())) a.k = over; }
    a.k = Math.min(1, a.k);
    const e = a === player ? a.k : a.k < 0.5 ? 2 * a.k * a.k : 1 - Math.pow(-2 * a.k + 2, 2) / 2;
    a.obj.position.x = a.from.x + (a.to.x - a.from.x) * e;
    a.obj.position.z = a.from.z + (a.to.z - a.from.z) * e;
    if (!a.mixer && !a.sprite) a.obj.position.y = Math.abs(Math.sin(a.k * Math.PI)) * 0.06; // a small hop for placeholders
    play(a, a === player ? 'run' : 'walk');
    a.still = 0;
  } else {
    play(a, 'idle');
    // Hold the idle clip's first pose until they've stood still a while, so nobody breathes the instant they stop.
    a.still = (a.still || 0) + dt;
    const idle = a.actions[a.current];
    if (idle) idle.paused = a.still < LOOK.people.idleAfter;
  }
  a.mixer?.update(dt * LOOK.people.animSpeed);
}

// ---------- player input ----------
const held = new Set();
const order = []; // held directions, newest last, so the latest key wins when two are down
const newestHeld = () => order.filter(d => held.has(d)).pop();
let tapped = null; // a quick tap still takes one step, even if the key is up before the next frame
const KEY = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
addEventListener('keydown', e => { const k = KEY[e.key]; if (k) { e.preventDefault(); if (!held.has(k)) order.push(k); held.add(k); tapped = k; } if (e.key === 't' || e.key === 'T') { fastTime = !fastTime; if (!fastTime && pinned == null) skyClock = 0; }
  if (e.key === 'r' || e.key === 'R') atmos.cycle(e.shiftKey ? -1 : 1);
  audio.unlock(); });
addEventListener('keyup', e => { const k = KEY[e.key]; if (k) { held.delete(k); order.splice(0, order.length, ...order.filter(d => d !== k)); } });
for (const b of document.querySelectorAll('[data-dir]')) {
  const d = b.dataset.dir;
  b.addEventListener('pointerdown', e => { e.preventDefault(); order.push(d); held.add(d); tapped = d; audio.unlock(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => held.delete(d));
}

// ---------- sound: weather ambience, started by the first key or tap (no footsteps; the user didn't like them) ----------
const audio = {
  ctx: null,
  unlock() {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); atmos.startSound(this.ctx); } catch {}
  },
};

// ---------- post-processing: bloom on embers and magic, tilt-shift miniature focus, vignette ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Bloom only catches what is far brighter than lit ground: embers, sparks, fireflies.
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 2.2);
composer.addPass(bloom);
const tiltShift = (axis) => new ShaderPass({
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.9 / 1000 * LOOK.lens.tilt }, focus: { value: LOOK.lens.focus }, axis: { value: axis } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform float focus; uniform vec2 axis; varying vec2 vUv;
    void main(){
      float d = smoothstep(0.2, 0.55, abs(vUv.y - focus));
      vec4 sum = vec4(0.0); float w = 0.0;
      for (int i = -4; i <= 4; i++) { float k = exp(-float(i*i) / 8.0); sum += texture2D(tDiffuse, vUv + axis * float(i) * amount * d * 1.5) * k; w += k; }
      gl_FragColor = sum / w;
    }`,
});
const tsH = tiltShift(new THREE.Vector2(1, 0)), tsV = tiltShift(new THREE.Vector2(0, 1));
composer.addPass(tsH); composer.addPass(tsV);
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null }, warmth: { value: LOOK.lens.warmth }, vig: { value: LOOK.lens.vignette }, sat: { value: LOOK.lens.saturation }, contrast: { value: LOOK.lens.contrast } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float warmth; uniform float vig; uniform float sat; uniform float contrast; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); c.rgb += vec3(warmth, warmth*0.4, -warmth*0.6);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); c.rgb = mix(vec3(l), c.rgb, sat); c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      float v = smoothstep(0.85, 0.25, length(vUv - 0.5)); c.rgb *= mix(1.0 - vig, 1.0, v); gl_FragColor = c; }`,
}));
composer.addPass(new OutputPass());

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
  camera.aspect = w / h;
  // Phones in portrait see less width, so pull the camera back a little.
  camOffset.copy(CAM).multiplyScalar(w / h < 0.8 ? 1.45 : 1);
  atmos.resize(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- weather and the depth layers (atmosphere.js) ----------
const atmos = createAtmosphere({ scene, grid, at, renderer, camera });
const weatherChip = document.getElementById('weather');
atmos.onChange(i => { if (weatherChip) weatherChip.innerHTML = `<b>${i.icon} ${i.label}</b><small>${i.modeLabel}${i.note ? ' · ' + i.note : ''}</small>`; });
weatherChip?.addEventListener('click', e => { atmos.cycle(e.shiftKey ? -1 : 1); audio.unlock(); });

// ---------- day and night ----------
// The sky follows the player's real local time. ?time=dawn|day|dusk|night pins a time; T runs a fast preview day.
let fastTime = false, dayT = dayPhase(); // 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
const pinned = { dawn: 0.26, day: 0.45, dusk: 0.74, night: 0.95 }[new URLSearchParams(location.search).get('time')];
if (pinned != null) dayT = pinned;
const hud = document.getElementById('time');
let skyClock = 0;
const MOONLIGHT = new THREE.Color(0.62, 0.72, 1);
function updateSky(dt) {
  if (fastTime) dayT = (dayT + dt / 20) % 1;
  else if (pinned == null && (skyClock -= dt) <= 0) { dayT = dayPhase(); skyClock = 5; }
  const ang = (dayT - 0.25) * Math.PI * 2;            // sunrise at 0.25, sunset at 0.75
  const height = Math.sin(ang);
  const day = THREE.MathUtils.smoothstep(height, -0.15, 0.25);
  // LOOK.light.sunAz turns the sun's path around the vertical axis.
  const az = THREE.MathUtils.degToRad(LOOK.light.sunAz), sx = Math.cos(ang) * 18;
  // At night the same light stands in for the moon: high, cool and soft, so people stay readable after dark.
  sun.position.set(sx * Math.cos(az) - 8 * Math.sin(az), Math.max(2, Math.abs(height) * 22), sx * Math.sin(az) + 8 * Math.cos(az));
  sun.shadow.radius = LOOK.light.shadowSoft;
  const w = atmos.state, flash = atmos.flash;
  const moon = (1 - day) * LOOK.light.moon * (0.4 + 0.6 * w.sun);
  sun.intensity = (0.1 + day * 1.7) * (0.25 + 0.75 * w.sun) * LOOK.light.sun + moon * 0.4;
  sun.color.setHSL(0.09, 0.6 * w.sun, 0.55 + day * 0.35).lerp(MOONLIGHT, 1 - day);
  hemi.intensity = (0.12 + day * 0.3) * LOOK.light.sky + moon * 0.22 + flash * 1.6;
  renderer.toneMappingExposure = (0.6 + day * 0.25) * (0.85 + 0.15 * w.sun) * LOOK.light.exposure + moon * 0.05 + flash * 0.5;
  scene.backgroundIntensity = (0.12 + day * 0.88) * (0.55 + 0.45 * w.sun);
  scene.environmentIntensity = (0.12 + day * 0.4) * LOOK.light.sky;
  // Overcast skies grey the haze out; fog pulls it in close.
  const grey = (1 - w.sun) * 0.5;
  scene.fog.color.setRGB(0.2 + day * 0.61, 0.24 + day * 0.64, 0.38 + day * 0.54).lerp(new THREE.Color(0.32 + day * 0.4, 0.34 + day * 0.4, 0.38 + day * 0.4), grey);
  scene.fog.near = 26 - w.fog * 18; scene.fog.far = 58 - w.fog * 34;
  wellLight.intensity = (3 + (1 - day * w.sun) * 9) * LOOK.light.fire;
  fireflies.mat.opacity = (1 - day) * 0.9;
  bloom.strength = (0.3 + (1 - day) * 0.45) * LOOK.lens.bloom;
  const label = day > 0.6 ? 'Day' : day > 0.15 ? (dayT < 0.5 ? 'Dawn' : 'Dusk') : 'Night';
  const when = fastTime || pinned != null ? 'preview' : clockLabel();
  if (hud) hud.textContent = `Ember Hollow · ${label} · ${when}`;
  return day;
}

// ---------- build the hub ----------
let player, sunny = null;
// Sunnyside paints the ground, water and meadow; the 3D grass blades go, since they fight the pixel grass.
function paintSunnyside(ss) {
  const dim = new THREE.Color().setScalar(LOOK.ground.brightness);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(grid.cols, grid.rows), new THREE.MeshLambertMaterial({ map: ss.ground(grid.cols, grid.rows, at), alphaTest: 0.5, color: dim }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = 0.002; ground.receiveShadow = true;
  scene.add(ground);
  meadow.material = new THREE.MeshLambertMaterial({ map: ss.tiled('grass', 160), color: dim });
  // Matte, so the sky reflection doesn't wash the pixel waves out.
  water.map = ss.tiled('water', 1); water.color.set(0xffffff); water.roughness = 1; water.metalness = 0; water.envMapIntensity = 0.2; water.needsUpdate = true;
  blades.visible = false;
  if (!LOOK.canopy.on) atmos.hideCanopy();
}
async function tree(c, r, opts) {
  const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
  // 'mixed' leans on the two big trees, with pines and bushes for variety (indices into sunnyside.js TREES).
  const kinds = LOOK.trees.kind === 'round' ? [0] : LOOK.trees.kind === 'tall' ? [1] : [0, 1, 0, 1, 0, 1, 2, 3, 4, 5, 6, 7];
  const obj = sunny && await sunny.tree(kinds[h % kinds.length], LOOK.trees.scale);
  if (!obj) return place('tree', 'tree', c, r, opts);
  const { x, z } = grid.toWorld(c, r), [ox, oz] = opts.offset || [0, 0];
  obj.position.set(x + ox, 0, z + oz);
  scene.add(obj);
}
// People are 3D models by default (LOOK.characters); 'pixel' uses the Sunnyside sprites. ?chars=pixel|3d overrides.
const CHARS = new URLSearchParams(location.search).get('chars') || LOOK.characters;
async function person(role, c, r, color, hair, variant = 0) {
  if (CHARS === '3d' && manifest[role]) return place(role, 'person', c, r, { color, variant });
  if (sunny) { const p = await sunny.person(hair); const { x, z } = grid.toWorld(c, r); p.obj.position.set(x, 0, z); scene.add(p.obj); return { obj: p.obj, clips: [], sprite: p.sprite }; }
  return place(role, 'person', c, r, { color });
}
async function build() {
  await loadManifest();
  sunny = await loadSunnyside();
  if (sunny) paintSunnyside(sunny);
  if (sunny) {
    const w = sunny.well(), { y, z, unit } = w.userData.rim, a = THREE.MathUtils.degToRad(LOOK.well.tilt), d = 1.5 * unit;
    w.position.set(wellPos.x, 0, wellPos.z); scene.add(w); wellParts.visible = false;
    // The opening sits 1.5 px back from the rim's front edge.
    fireAt.y = y + Math.cos(a) * d + 0.02; fireAt.z = wellPos.z + z - Math.sin(a) * d;
    sparkAt.y = fireAt.y + 0.15; sparkAt.z = fireAt.z;
  }
  document.getElementById('models').textContent = [sunny && 'Sunnyside World by Daniel Diggle', CHARS === '3d' && manifest.player && 'KayKit Adventurers by Kay Lousberg'].filter(Boolean).join(' · ') || 'Placeholder shapes · art pack not added';
  const jobs = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const ch = at(c, r);
    if (ch === 'T') jobs.push(tree(c, r, { rot: (c * 7 + r * 3) % 6, scale: 0.9 + ((c + r) % 3) * 0.12 }));
    // The Keeper's Lodge: the ember-orange house, larger, on its 2x2 plot. Village houses take the blue and green roofs.
    if (ch === 'C' && sunny) { const h = sunny.house(2, LOOK.houses.lodge), { x, z } = grid.toWorld(c, r); h.position.set(x + 0.5, 0, z - 0.5); scene.add(h); }
    else if (ch === 'C') jobs.push(place('center', 'center', c, r, { color: 0xd97757, offset: [0.5, -0.5] }));
    if (ch === 'H' && sunny) { const h = sunny.house((c + r) % 2), { x, z } = grid.toWorld(c, r); h.position.set(x, 0, z); scene.add(h); }
    else if (ch === 'H') jobs.push(place('house', 'house', c, r, { color: [0xe0a84f, 0x7a8fd0, 0xc05050][(c + r) % 3], rot: Math.PI }));
    if (ch === 'B') jobs.push(place('board', 'prop', c, r, { color: 0x8a6440 }));
    if (ch === 'M') jobs.push(place('mailbox', 'prop', c, r, { color: 0xc04040 }));
    if (ch === 'S') jobs.push(place('waystone', 'prop', c, r, { color: 0x6aa8e8 }));
  }
  // A ring of forest beyond the edge so the map never ends at a cliff (LOOK.trees: ring depth and density).
  const ring = LOOK.trees.ring;
  for (let r = -ring; r < grid.rows + ring; r++) for (let c = -ring; c < grid.cols + ring; c++) {
    if (grid.inside(c, r)) continue;
    const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
    if ((h % 1000) / 1000 >= LOOK.trees.density) continue;
    jobs.push(tree(c, r, { rot: h % 6, scale: 0.85 + (h % 5) * 0.08, offset: [((h >> 3) % 7 - 3) * 0.08, ((h >> 6) % 7 - 3) * 0.08] }));
  }
  // A few trees standing in the open grass inside the map, away from the well and the player's start.
  const open = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    if ((at(c, r) === '.' || at(c, r) === ',') && Math.abs(c - wellCell[0]) + Math.abs(r - wellCell[1]) > 3 && !(c === 11 && r === 9)) open.push([c, r]);
  }
  const rank = ([c, r]) => ((c * 7 + 3) * 73856093 ^ (r * 5 + 1) * 19349663) >>> 0;
  for (const [c, r] of open.sort((a, b) => rank(a) - rank(b)).slice(0, LOOK.trees.inside)) { treeCells.add(c + ',' + r); jobs.push(tree(c, r, {})); }
  await Promise.all(jobs);
  const p = await person('player', 11, 9, 0x3050c0, 'shorthair');
  player = makeActor(p.obj, p.clips, 11, 9, LOOK.move.walk, p.sprite);
  const keeperSpots = [[4, 7], [17, 8], [11, 13], [6, 4], [19, 12]].slice(0, LOOK.people.keepers);
  for (const [i, [c, r]] of keeperSpots.entries()) {
    const m = await person('keeper', c, r, 0xd97757, sunny?.HAIR[(i + 1) % sunny.HAIR.length], i);
    const a = makeActor(m.obj, m.clips, c, r, 2.6 * LOOK.move.npcPace, m.sprite);
    a.npc = true; a.wait = Math.random() * 2;
  }
  // Animals wander slowly; ducks paddle around the pond.
  if (sunny) {
    const land = [], pond = [];
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) (at(c, r) === '~' ? pond : at(c, r) === '.' || at(c, r) === ',' ? land : []).push([c, r]);
    const rank = ([c, r]) => ((c + 11) * 73856093 ^ (r + 29) * 19349663) >>> 0;
    land.sort((a, b) => rank(a) - rank(b)); pond.sort((a, b) => rank(a) - rank(b));
    for (let i = 0; i < LOOK.animals.count; i++) {
      const kind = LOOK.animals.kinds[i % LOOK.animals.kinds.length], swims = kind === 'Duck';
      const spot = (swims ? pond : land).find(([c, r]) => free(c, r, { swims }));
      const m = spot && await sunny.animal(kind);
      if (!m) continue;
      const { x, z } = grid.toWorld(...spot);
      m.obj.position.set(x, swims ? -0.27 : 0, z); scene.add(m.obj);
      const a = makeActor(m.obj, [], spot[0], spot[1], 1.6 * LOOK.animals.pace, m.sprite);
      a.npc = true; a.swims = swims; a.pace = LOOK.animals.pace; a.wait = 1 + Math.random() * 3;
    }
  }
  resize();
  document.body.classList.add('ready');
}

// ---------- loop ----------
const timer = new THREE.Timer();
let snapped = false;
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
let lastStepK = 1;
function loop() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05), t = timer.getElapsed();
  wind.value = reduceMotion ? 0 : t;
  const day = updateSky(dt);
  if (player) {
    if (player.k >= 1 && (held.size || tapped)) {
      const dir = held.size ? newestHeld() : tapped;
      tapped = null;
      if (tryMove(player, dir)) lastStepK = 0;
    }
    for (const a of actors) {
      if (a.npc && a.k >= 1 && (a.wait -= dt * (a.pace ?? LOOK.move.npcPace)) <= 0) {
        const dirs = ['up', 'down', 'left', 'right'].sort(() => Math.random() - 0.5);
        for (const d of dirs) if (tryMove(a, d)) break;
        a.wait = 0.8 + Math.random() * 2.5;
      }
      updateActor(a, dt);
    }
    look.set(player.obj.position.x, 0, player.obj.position.z);
    camPos.copy(look).add(camOffset);
    camera.position.lerp(camPos, reduceMotion || !snapped ? 1 : Math.min(1, dt * LOOK.camera.follow));
    snapped = true;
    camera.lookAt(camera.position.x - camOffset.x, 0, camera.position.z - camOffset.z);
    sun.target.position.copy(look);
    sun.position.add(look);
  }
  sunny?.update(dt, t, camera, reduceMotion, player?.obj.position);
  if (!reduceMotion) { fire(t); sparks(t); fireflies.tick(t); }
  wellLight.intensity *= reduceMotion ? 1 : 0.9 + Math.sin(t * 11) * 0.05 + Math.sin(t * 23) * 0.05;
  beaconGlow(t);
  water.opacity = LOOK.water.opacity - 0.05 + Math.sin(t * 1.2) * 0.05;
  if (water.map && !reduceMotion) water.map.offset.set(t * LOOK.water.flow * 0.05, t * LOOK.water.flow * 0.02);
  if (player) atmos.update(dt, t, look, day, reduceMotion);
  composer.render();
  requestAnimationFrame(loop);
}
build().then(() => requestAnimationFrame(loop));
