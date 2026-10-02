// Quest in 2.5D: the hub as a lit miniature diorama. Three.js, square grid, tilt-shift + bloom, day/night, Ember Well
// fire, wandering Claudes. Models come from assets/3d/manifest.json (KayKit, CC0) when present; until then plain
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

// ---------- ground: flat-shaded tiles with gentle colour variation ----------
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
  const tiles = new THREE.InstancedMesh(geo, mat, grid.cols * grid.rows);
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
  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x6aa84c, roughness: 1 }));
  meadow.rotation.x = -Math.PI / 2; meadow.position.y = -0.02 - 0.4; meadow.receiveShadow = true;
  scene.add(meadow);
}
// water surface that shimmers
const water = (() => {
  const mat = new THREE.MeshStandardMaterial({ color: 0x5fb3e3, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  const group = new THREE.Group();
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (at(c, r) === '~') {
    const { x, z } = grid.toWorld(c, r);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    q.rotation.x = -Math.PI / 2; q.position.set(x, -0.33, z); group.add(q);
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
  const mesh = new THREE.InstancedMesh(blade, mat, spots.length);
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
async function model(role) {
  const file = manifest[role];
  if (!file) return null;
  if (!cache.has(file)) cache.set(file, loader.loadAsync(A + '3d/' + file).catch(() => null));
  const g = await cache.get(file);
  if (!g) return null;
  const obj = SkeletonUtils.clone(g.scene);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { obj, clips: g.animations };
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
async function place(role, fallbackKind, c, r, { color, rot = 0, scale = 1, offset = [0, 0] } = {}) {
  const m = await model(role);
  const obj = m ? m.obj : placeholder(fallbackKind, color);
  const { x, z } = grid.toWorld(c, r);
  obj.position.set(x + offset[0], 0, z + offset[1]);
  obj.rotation.y = rot;
  obj.scale.setScalar(m ? (manifest.scale?.[role] ?? 1) * scale : scale);
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
{
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a9aa8, roughness: 0.9 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.42, 14, 1, true), stone);
  ring.position.set(wellPos.x, 0.21, wellPos.z);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.07, 6, 18), stone);
  rim.rotation.x = Math.PI / 2; rim.position.set(wellPos.x, 0.42, wellPos.z);
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), new THREE.MeshStandardMaterial({ color: 0x3a1a08, emissive: 0xff7a20, emissiveIntensity: 2.2 }));
  embers.rotation.x = -Math.PI / 2; embers.position.set(wellPos.x, 0.3, wellPos.z);
  scene.add(shadowed(ring), shadowed(rim), embers);
}
const fire = emitter({ map: fx('flame_03'), count: 26, color: 0xffa040, size: 0.55, origin: { x: wellPos.x, y: 0.35, z: wellPos.z }, spread: 0.22, rise: 0.9, life: 1.1 });
const sparks = emitter({ map: fx('spark_04'), count: 18, color: 0xffd080, size: 0.16, origin: { x: wellPos.x, y: 0.5, z: wellPos.z }, spread: 0.35, rise: 2.6, life: 2.4 });

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
function makeActor(obj, clips, c, r, speed) {
  const a = { obj, c, r, from: grid.toWorld(c, r), to: grid.toWorld(c, r), k: 1, speed, dir: 'down', mixer: null, actions: {} };
  if (clips.length) {
    a.mixer = new THREE.AnimationMixer(obj);
    for (const clip of clips) a.actions[clip.name.toLowerCase()] = a.mixer.clipAction(clip);
  }
  obj.position.set(a.from.x, 0, a.from.z);
  actors.push(a);
  return a;
}
function play(a, name) {
  if (!a.mixer) return;
  const want = Object.keys(a.actions).find(k => k.includes(name)) || Object.keys(a.actions)[0];
  if (!want || a.current === want) return;
  a.actions[a.current]?.fadeOut(0.2);
  a.actions[want].reset().fadeIn(0.2).play();
  a.current = want;
}
const free = (c, r) => !SOLID.has(at(c, r)) && !actors.some(o => (o.c === c && o.r === r));
function tryMove(a, dir) {
  a.dir = dir;
  const [c, r] = grid.step(a.c, a.r, dir);
  if (!free(c, r)) return false;
  a.from = grid.toWorld(a.c, a.r); a.to = grid.toWorld(c, r); a.c = c; a.r = r; a.k = 0;
  return true;
}
function updateActor(a, dt) {
  const target = grid.heading(a.dir);
  let d = target - a.obj.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
  a.obj.rotation.y += d * Math.min(1, dt * 14);
  if (a.k < 1) {
    a.k = Math.min(1, a.k + dt * a.speed);
    const e = a.k < 0.5 ? 2 * a.k * a.k : 1 - Math.pow(-2 * a.k + 2, 2) / 2;
    a.obj.position.x = a.from.x + (a.to.x - a.from.x) * e;
    a.obj.position.z = a.from.z + (a.to.z - a.from.z) * e;
    if (!a.mixer) a.obj.position.y = Math.abs(Math.sin(a.k * Math.PI)) * 0.06; // a small hop for placeholders
    play(a, 'walk');
  } else play(a, 'idle');
  a.mixer?.update(dt);
}

// ---------- player input ----------
const held = new Set();
let tapped = null; // a quick tap still takes one step, even if the key is up before the next frame
const KEY = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
addEventListener('keydown', e => { const k = KEY[e.key]; if (k) { e.preventDefault(); held.add(k); tapped = k; } if (e.key === 't' || e.key === 'T') { fastTime = !fastTime; if (!fastTime && pinned == null) skyClock = 0; }
  if (e.key === 'r' || e.key === 'R') atmos.cycle(e.shiftKey ? -1 : 1);
  audio.unlock(); });
addEventListener('keyup', e => { const k = KEY[e.key]; if (k) held.delete(k); });
for (const b of document.querySelectorAll('[data-dir]')) {
  const d = b.dataset.dir;
  b.addEventListener('pointerdown', e => { e.preventDefault(); held.add(d); tapped = d; audio.unlock(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => held.delete(d));
}

// ---------- sound: footsteps (Kenney RPG Audio), started by the first key or tap ----------
const audio = {
  ctx: null, bufs: [], i: 0,
  async unlock() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      atmos.startSound(this.ctx);
      this.bufs = await Promise.all([0, 1, 2, 3].map(async n => this.ctx.decodeAudioData(await (await fetch(`${A}sfx/footstep0${n}.ogg`)).arrayBuffer())));
    } catch { this.bufs = []; }
  },
  step() {
    if (!this.ctx || !this.bufs.length) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = this.bufs[this.i++ % this.bufs.length]; g.gain.value = 0.25; s.connect(g).connect(this.ctx.destination); s.start();
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
  uniforms: { tDiffuse: { value: null }, warmth: { value: LOOK.lens.warmth }, vig: { value: LOOK.lens.vignette } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float warmth; uniform float vig; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); c.rgb += vec3(warmth, warmth*0.4, -warmth*0.6);
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
function updateSky(dt) {
  if (fastTime) dayT = (dayT + dt / 20) % 1;
  else if (pinned == null && (skyClock -= dt) <= 0) { dayT = dayPhase(); skyClock = 5; }
  const ang = (dayT - 0.25) * Math.PI * 2;            // sunrise at 0.25, sunset at 0.75
  const height = Math.sin(ang);
  const day = THREE.MathUtils.smoothstep(height, -0.15, 0.25);
  sun.position.set(Math.cos(ang) * 18, Math.max(2, height * 22), 8);
  const w = atmos.state, flash = atmos.flash;
  sun.intensity = (0.1 + day * 1.7) * (0.25 + 0.75 * w.sun) * LOOK.light.sun;
  sun.color.setHSL(0.09, 0.6 * w.sun, 0.55 + day * 0.35);
  hemi.intensity = (0.12 + day * 0.3) * LOOK.light.sky + flash * 1.6;
  renderer.toneMappingExposure = (0.6 + day * 0.25) * (0.85 + 0.15 * w.sun) * LOOK.light.exposure + flash * 0.5;
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
let player;
async function build() {
  await loadManifest();
  document.getElementById('models').textContent = Object.keys(manifest).length ? 'KayKit models' : 'Placeholder shapes · KayKit models not added yet';
  const jobs = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const ch = at(c, r);
    if (ch === 'T') jobs.push(place('tree', 'tree', c, r, { rot: (c * 7 + r * 3) % 6, scale: 0.9 + ((c + r) % 3) * 0.12 }));
    if (ch === 'C') jobs.push(place('center', 'center', c, r, { color: 0xd97757, offset: [0.5, -0.5] }));
    if (ch === 'H') jobs.push(place('house', 'house', c, r, { color: [0xe0a84f, 0x7a8fd0, 0xc05050][(c + r) % 3], rot: Math.PI }));
    if (ch === 'B') jobs.push(place('board', 'prop', c, r, { color: 0x8a6440 }));
    if (ch === 'M') jobs.push(place('mailbox', 'prop', c, r, { color: 0xc04040 }));
    if (ch === 'S') jobs.push(place('waystone', 'prop', c, r, { color: 0x6aa8e8 }));
  }
  // A ring of forest beyond the edge so the map never ends at a cliff.
  for (let r = -3; r < grid.rows + 3; r++) for (let c = -3; c < grid.cols + 3; c++) {
    if (grid.inside(c, r)) continue;
    const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
    if (h % 3 === 0) continue;
    jobs.push(place('tree', 'tree', c, r, { rot: h % 6, scale: 0.85 + (h % 5) * 0.08, offset: [((h >> 3) % 7 - 3) * 0.08, ((h >> 6) % 7 - 3) * 0.08] }));
  }
  await Promise.all(jobs);
  const p = await place('player', 'person', 11, 9, { color: 0x3050c0 });
  player = makeActor(p.obj, p.clips, 11, 9, LOOK.move.walk);
  const claudeSpots = [[4, 7], [17, 8], [11, 13], [6, 4]];
  for (const [c, r] of claudeSpots) {
    const m = await place('claude', 'person', c, r, { color: 0xd97757 });
    const a = makeActor(m.obj, m.clips, c, r, 2.6 * LOOK.move.npcPace);
    a.npc = true; a.wait = Math.random() * 2;
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
      const dir = held.size ? [...held].pop() : tapped;
      tapped = null;
      if (tryMove(player, dir)) { lastStepK = 0; audio.step(); }
    }
    for (const a of actors) {
      if (a.npc && a.k >= 1 && (a.wait -= dt * LOOK.move.npcPace) <= 0) {
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
  if (!reduceMotion) { fire(t); sparks(t); fireflies.tick(t); }
  wellLight.intensity *= reduceMotion ? 1 : 0.9 + Math.sin(t * 11) * 0.05 + Math.sin(t * 23) * 0.05;
  water.opacity = 0.8 + Math.sin(t * 1.2) * 0.05;
  if (player) atmos.update(dt, t, look, day, reduceMotion);
  composer.render();
  requestAnimationFrame(loop);
}
build().then(() => requestAnimationFrame(loop));
