// Weather and the depth layers around the play grid. Ninja Adventure sprites (Pixel-Boy & AAA, CC0) do the drawing.
// From the camera down:
//   canopy  - high tree crowns over the border trees, close to the lens, sliding fastest and blurred by tilt-shift
//   wisps   - thin clouds drifting between the camera and the ground
//   weather - rain, snow, leaves or blossom filling the whole depth, so near flakes pass faster than far ones
//   rays    - light shafts on clear days, mist bands at dawn and in fog
//   shadows - cloud shadows sliding over the ground
// Everything is anchored in the world and wraps around the camera, so the parallax comes from real depth.
import * as THREE from 'three';
import { place } from './clock.js';
import { LOOK } from './look.js';

const A = 'assets/na/';
const loader = new THREE.TextureLoader();
function pixelTex(path) {
  const t = loader.load(A + path);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
const softTex = path => { const t = loader.load(A + path); t.colorSpace = THREE.SRGBColorSpace; return t; };

// ---------- weather kinds ----------
// rain/snow/leaves/petals: particle amount 0..1 · clouds: cover 0..1 · fog 0..1 · sun: how much sunlight gets through
const KINDS = {
  clear:   { label: 'Clear',   icon: '☀', clouds: 0.15, sun: 1 },
  cloudy:  { label: 'Cloudy',  icon: '⛅', clouds: 0.75, sun: 0.6 },
  rain:    { label: 'Rain',    icon: '🌧', rain: 0.7, clouds: 1, fog: 0.25, sun: 0.35, wind: 0.6 },
  storm:   { label: 'Storm',   icon: '⛈', rain: 1, clouds: 1, fog: 0.35, sun: 0.2, wind: 1.4, storm: 1 },
  snow:    { label: 'Snow',    icon: '❄', snow: 0.8, clouds: 0.8, fog: 0.3, sun: 0.55, wind: 0.3 },
  fog:     { label: 'Fog',     icon: '🌫', clouds: 0.5, fog: 1, sun: 0.5 },
  leaves:  { label: 'Autumn wind', icon: '🍂', leaves: 0.7, clouds: 0.35, sun: 0.9, wind: 1 },
  blossom: { label: 'Blossom', icon: '🌸', petals: 0.7, clouds: 0.2, sun: 1, wind: 0.6 },
  off:     { label: 'Off',     icon: '○', clouds: 0, sun: 1 },
};
const MODES = ['auto', 'real', 'clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'leaves', 'blossom', 'off'];
const ZERO = { rain: 0, snow: 0, leaves: 0, petals: 0, clouds: 0, fog: 0, sun: 1, wind: 0.3, storm: 0 };
const params = k => ({ ...ZERO, ...KINDS[k] });

// Auto weather: a calm, seasonal pick that changes every 20 minutes and is the same for everyone at that time.
function autoKind(date = new Date()) {
  const south = place().lat < 0, m = (date.getMonth() + (south ? 6 : 0)) % 12;
  const season = m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
  const table = {
    spring: { clear: 4, blossom: 3, cloudy: 2, rain: 2, fog: 1 },
    summer: { clear: 6, cloudy: 2, rain: 1, storm: 1 },
    autumn: { clear: 3, leaves: 4, cloudy: 2, rain: 2, fog: 1 },
    winter: { snow: 4, cloudy: 3, clear: 2, fog: 1 },
  }[season];
  const slot = Math.floor(date.getTime() / 12e5);
  let h = (slot * 2654435761) >>> 0; h = ((h ^ (h >>> 15)) * 2246822519) >>> 0;
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let pick = (h % 1000) / 1000 * total;
  for (const [k, w] of Object.entries(table)) if ((pick -= w) < 0) return k;
  return 'clear';
}

// Real weather: only after the player picks it. The browser asks for location; it is rounded to ~10 km and sent
// only to Open-Meteo (no key, no account).
function wmoKind(code) {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3 || code === 2) return 'cloudy';
  return 'clear';
}
async function realKind() {
  let p = place();
  if (p.guessed) {
    p = await new Promise((ok, no) => navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(g => ok({ lat: +g.coords.latitude.toFixed(1), lon: +g.coords.longitude.toFixed(1) }), no, { timeout: 15000, maximumAge: 36e5 })
      : no(new Error('no geolocation')));
    try { localStorage.setItem('quest.place', JSON.stringify(p)); } catch {}
  }
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=weather_code,wind_speed_10m`);
  if (!r.ok) throw new Error('weather ' + r.status);
  const cur = (await r.json()).current;
  return { kind: wmoKind(cur.weather_code), wind: Math.min(1.6, (cur.wind_speed_10m || 0) / 20) };
}

// ---------- rain: thin streaks along the fall direction; snow: small soft flakes ----------
// Kept faint on purpose: weather should be felt, not stare back. Both wrap around the camera like everything else.
const WRAP = `
  uniform float uTime; uniform vec3 uCenter, uBox, uVel;
  vec3 wrapPos(vec3 base, float speed) {
    vec3 lo = uCenter - uBox * 0.5;
    return lo + mod(base * uBox * 4.0 + uVel * speed * uTime - lo, uBox);
  }`;
function streaks(scene, { count, box }) {
  const base = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0); // top at y=0, tail hangs below
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = count;
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  const u = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) },
    uVel: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: 0.55 }, uWidth: { value: 0.016 }, uOpacity: { value: 0.2 }, uTint: { value: new THREE.Color(1, 1, 1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: WRAP + `
      attribute vec4 aSeed; uniform float uLen, uWidth; varying float vT; varying float vFade;
      void main() {
        float speed = 0.85 + aSeed.w * 0.3;
        vec3 head = wrapPos(aSeed.xyz, speed);
        vec3 dir = normalize(uVel);
        vec3 toCam = normalize(cameraPosition - head);
        vec3 side = normalize(cross(dir, toCam));
        vec3 p = head + dir * (-position.y) * uLen * speed + side * position.x * uWidth * 2.0;
        vT = -position.y;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vFade = smoothstep(1.5, 5.0, -mv.z);      // drops right at the lens fade out instead of smearing
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uTint; varying float vT; varying float vFade;
      void main() { gl_FragColor = vec4(uTint, uOpacity * vFade * (1.0 - vT) * smoothstep(0.0, 0.15, vT + 0.05)); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6;
  scene.add(mesh);
  return { mesh, u, count, geo };
}
function flakes(scene, { count, box }) {
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const u = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) },
    uVel: { value: new THREE.Vector3(0, -1, 0) }, uScale: { value: 600 }, uSize: { value: 0.07 }, uOpacity: { value: 0.55 }, uTint: { value: new THREE.Color(1, 1, 1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: WRAP + `
      attribute vec4 aSeed; uniform float uScale, uSize; varying float vA;
      void main() {
        vec3 p = wrapPos(aSeed.xyz, 0.7 + aSeed.w * 0.6);
        p.x += sin(uTime * 0.8 + aSeed.w * 40.0) * 0.35;
        p.z += cos(uTime * 0.6 + aSeed.w * 23.0) * 0.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (0.6 + aSeed.w * 0.8) * uScale / -mv.z, 1.0, 14.0);
        vA = smoothstep(1.5, 5.0, -mv.z);
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uTint; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uTint, uOpacity * vA * smoothstep(0.5, 0.1, d)); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 6;
  scene.add(pts);
  return { pts, u, count, geo };
}

// ---------- sprite-sheet particles (one draw call per kind) ----------
const VERT = `
  attribute vec4 aSeed;            // x, y, z in 0..1, plus a random value
  uniform float uTime, uSize, uScale, uFall, uSway, uFrames, uFps, uSpin;
  uniform vec3 uCenter, uBox;       // box around the camera, in world units
  uniform vec2 uWind;
  varying float vFrame;
  vec3 wrapPos(vec3 base, vec3 vel) {
    vec3 lo = uCenter - uBox * 0.5;
    return lo + mod(base * uBox * 4.0 + vel * uTime - lo, uBox);
  }
  void main() {
    vec3 vel = vec3(uWind.x, -uFall * (0.8 + aSeed.w * 0.4), uWind.y);
    vec3 p = wrapPos(aSeed.xyz, vel);
    p.x += sin(uTime * 1.3 + aSeed.w * 40.0) * uSway;
    p.z += cos(uTime * 0.9 + aSeed.w * 23.0) * uSway * 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uSize * uScale / -mv.z, 96.0);
    vFrame = uFps > 0.0 ? mod(floor(uTime * uFps + aSeed.w * 17.0), uFrames) : floor(aSeed.w * uFrames);
  }`;
const FRAG = `
  uniform sampler2D uMap; uniform float uFrames, uAspect, uOpacity; uniform vec3 uTint;
  varying float vFrame;
  void main() {
    vec2 q = gl_PointCoord;
    if (uAspect > 1.0) q.y = (q.y - 0.5) * uAspect + 0.5; else q.x = (q.x - 0.5) / uAspect + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;
    vec4 c = texture2D(uMap, vec2((vFrame + q.x) / uFrames, 1.0 - q.y));
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb * uTint, uOpacity);
  }`;
function particles(scene, { sheet, frames, fw, fh, count, size, fall, sway = 0, fps = 0, box }) {
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // unused; the shader places points
  const u = {
    uMap: { value: pixelTex('fx/' + sheet) }, uTime: { value: 0 }, uSize: { value: size }, uScale: { value: 600 },
    uFall: { value: fall }, uSway: { value: sway }, uFrames: { value: frames }, uFps: { value: fps }, uSpin: { value: 0 },
    uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) }, uWind: { value: new THREE.Vector2() },
    uAspect: { value: fw / fh }, uOpacity: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { pts, u, count };
}

export function createAtmosphere({ scene, grid, at, renderer, camera }) {
  const BOX = [30, 11, 26];
  const rain = streaks(scene, { count: 2600, box: BOX });
  const snow = flakes(scene, { count: 1600, box: BOX });
  const kinds = {
    leaves: particles(scene, { sheet: 'Leaf.png', frames: 6, fw: 12, fh: 7, count: 160, size: 0.42, fall: 1.1, sway: 0.9, fps: 6, box: BOX }),
    petals: particles(scene, { sheet: 'LeafPink.png', frames: 6, fw: 12, fh: 7, count: 200, size: 0.38, fall: 0.9, sway: 0.9, fps: 6, box: BOX }),
  };
  // Rain splashes on the ground: three-frame rings that pop up at random spots.
  const splash = (() => {
    const n = 220, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), seed = Array.from({ length: n }, Math.random);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sheet = pixelTex('fx/RainOnFloor.png');
    const mat = new THREE.PointsMaterial({ size: 0.38, map: sheet, transparent: true, depthWrite: false, alphaTest: 0.5, opacity: 0 });
    sheet.repeat.set(1 / 3, 1);
    const p = new THREE.Points(geo, mat); p.frustumCulled = false; scene.add(p);
    // Each splash picks its world spot when its cycle starts and keeps it, so splashes stay put as the camera moves.
    const cycOf = new Int32Array(n).fill(-1);
    return { mat, tick(t, center) {
      for (let i = 0; i < n; i++) {
        const cyc = Math.floor(t * 2.2 + seed[i] * 7);
        if (cyc === cycOf[i]) continue;
        cycOf[i] = cyc;
        const h = Math.sin(seed[i] * 91.7 + cyc * 12.9898) * 43758.5453;
        const fx = h - Math.floor(h), fz = (h * 7.13) - Math.floor(h * 7.13);
        pos[i * 3] = center.x + (fx - 0.5) * 26; pos[i * 3 + 1] = 0.05; pos[i * 3 + 2] = center.z + (fz - 0.5) * 20;
      }
      sheet.offset.x = (Math.floor(t * 9) % 3) / 3;
      geo.attributes.position.needsUpdate = true;
    } };
  })();

  // ---------- clouds: shadows on the ground and thin wisps above it ----------
  const cloudTex = pixelTex('fx/Clouds.png');
  // A soft round blob for shadows: pixel edges look wrong on a shadow cast from far above.
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.55, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  // Cloud banks: each bank is a few puffs grouped together, so the one sprite in the pack reads as many shapes.
  const cloudBanks = (y, banks, { map, color, opacity, puff, spread, speed, alphaTest = 0 }) => {
    const mat = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, alphaTest });
    const items = [];
    for (let i = 0; i < banks; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, map === cloudTex ? 36 / 80 : 1), mat);
        m.rotation.x = -Math.PI / 2;
        const k = puff * (0.6 + Math.random() * 0.7);
        m.scale.set(k, k, k);
        m.position.set((Math.random() - 0.5) * spread, j * 0.02, (Math.random() - 0.5) * spread * 0.45);
        m.renderOrder = 2;
        g.add(m);
      }
      items.push({ g, bx: Math.random() * 70, bz: Math.random() * 52, k: 0.8 + Math.random() * 0.4 });
      scene.add(g);
    }
    return { mat, base: opacity, tick(t, c, wind) {
      const W = 70, D = 52, lx = c.x - W / 2, lz = c.z - D / 2;
      for (const it of items) {
        it.g.position.set(lx + (((it.bx + t * speed * it.k * (0.4 + wind) - lx) % W) + W) % W, y,
          lz + (((it.bz + t * speed * 0.25 * it.k - lz) % D) + D) % D);
      }
    } };
  };
  const shadows = cloudBanks(0.07, 6, { map: blobTex, color: 0x0c1220, opacity: 0.3, puff: 9, spread: 10, speed: 0.9 });
  const wisps = cloudBanks(LOOK.clouds.wispHeight, 5, { map: cloudTex, color: 0xffffff, opacity: 0.16, puff: 4.5, spread: 7, speed: 0.9, alphaTest: 0.02 });

  // ---------- mist bands and light shafts ----------
  const fogTex = softTex('fx/Fog.png');
  const mist = (() => {
    const mat = new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, opacity: 0, depthWrite: false, color: 0xe8eef5 });
    const bands = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), mat);
      m.rotation.x = -Math.PI / 2; m.renderOrder = 3;
      bands.push({ m, y: 0.5 + (i % 3) * 0.55, bx: Math.random() * 48, bz: Math.random() * 36, k: 0.15 + Math.random() * 0.2 });
      scene.add(m);
    }
    return { mat, tick(t, c) { for (const b of bands) { const lx = c.x - 24, lz = c.z - 18; b.m.position.set(lx + (((b.bx + t * b.k - lx) % 48) + 48) % 48, b.y, lz + (((b.bz - lz) % 36) + 36) % 36); } } };
  })();
  const rays = (() => {
    const tex = softTex('fx/Raylight.png');
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0c8 });
    const list = [];
    // Shafts fall through the gaps in the border forest, where light would really come through.
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
      if (at(c, r) !== 'T' || h % 5) continue;
      const { x, z } = grid.toWorld(c, r);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), mat);
      m.position.set(x + 0.8, 1.6, z + 0.9); m.rotation.set(-0.5, 0.35, 0.6); m.renderOrder = 4;
      scene.add(m); list.push({ m, s: h % 7 });
    }
    return { mat, list };
  })();

  // ---------- canopy: big crowns high over the border trees ----------
  const canopy = (() => {
    const sheet = pixelTex('tiles/TilesetNature.png');
    const W = 384, H = 336;
    const crop = (x, y, w, h) => { const t = sheet.clone(); t.repeat.set(w / W, h / H); t.offset.set(x / W, 1 - (y + h) / H); t.needsUpdate = true; return t; };
    const frames = [crop(0, 32, 64, 48), crop(64, 32, 64, 48), crop(48, 288, 48, 48)];
    const mats = frames.map(map => new THREE.SpriteMaterial({ map, alphaTest: 0.5, color: 0xffffff }));
    const list = [];
    // Only outside the map, so crowns frame the play area and never cover it. They sit high, so they slide past
    // faster than the ground when the camera moves.
    for (let r = -3; r < grid.rows + 4; r++) for (let c = -4; c < grid.cols + 4; c++) {
      const gap = LOOK.canopy.gap;
      if (r >= -gap && r < grid.rows + gap && c >= -gap && c < grid.cols + gap) continue;
      const h = ((c * 19349663) ^ (r * 83492791)) >>> 0;
      if ((h % 1000) / 1000 >= LOOK.canopy.density) continue;
      const { x, z } = grid.toWorld(c, r);
      const k = h % 3, s = (1.6 + (h % 5) * 0.2) * LOOK.canopy.scale;
      const sp = new THREE.Sprite(mats[k]);
      sp.scale.set(s, s * (k === 2 ? 1 : 0.75), 1);
      sp.position.set(x, LOOK.canopy.height + (h % 4) * 0.3, z);
      sp.renderOrder = 5;
      scene.add(sp); list.push(sp);
    }
    return { mats, list };
  })();

  // ---------- sound: rain, storm and wind loops from the pack ----------
  const sound = { ctx: null, loops: {} };
  async function startSound(ctx) {
    if (sound.ctx) return;
    sound.ctx = ctx;
    for (const name of ['Rain', 'Storm', 'Wind']) {
      try {
        const buf = await ctx.decodeAudioData(await (await fetch(A + 'sfx/' + name + '.m4a')).arrayBuffer());
        const src = ctx.createBufferSource(), gain = ctx.createGain();
        src.buffer = buf; src.loop = true; gain.gain.value = 0;
        src.connect(gain).connect(ctx.destination); src.start();
        sound.loops[name] = gain;
      } catch {}
    }
  }

  // ---------- state ----------
  let mode = 'auto';
  try { const m = localStorage.getItem('quest.weather'); if (MODES.includes(m)) mode = m; } catch {}
  const urlKind = new URLSearchParams(location.search).get('weather');
  if (MODES.includes(urlKind)) mode = urlKind;
  let target = params('clear'), kindNow = 'clear', note = '';
  const cur = { ...target };
  let realTimer = 0, flash = 0, nextBolt = 6;

  async function resolve() {
    note = '';
    if (mode === 'auto') kindNow = autoKind();
    else if (mode === 'real') {
      try { const r = await realKind(); kindNow = r.kind; target = { ...params(kindNow), wind: Math.max(params(kindNow).wind, r.wind) }; note = 'Live'; announce(); return; }
      catch { kindNow = autoKind(); note = 'Live weather unavailable · seasonal'; }
    } else kindNow = mode;
    target = params(kindNow);
    // Autumn: a few leaves on dry days. Spring: a few petals.
    const m = new Date().getMonth(), south = place().lat < 0, mm = (m + (south ? 6 : 0)) % 12;
    if (mode === 'auto' || mode === 'real') {
      if (mm >= 8 && mm <= 10 && !target.rain && !target.snow) target.leaves = Math.max(target.leaves, 0.2);
      if (mm >= 2 && mm <= 4 && !target.rain && !target.snow) target.petals = Math.max(target.petals, 0.15);
    }
    announce();
  }
  const listeners = new Set();
  function announce() { for (const f of listeners) f(info()); }
  function info() {
    const k = KINDS[kindNow];
    return { mode, kind: kindNow, label: k.label, icon: k.icon, note, modeLabel: mode === 'auto' ? 'Seasonal' : mode === 'real' ? 'Real' : 'Fixed' };
  }
  function setMode(m) {
    mode = m;
    try { localStorage.setItem('quest.weather', m); } catch {}
    realTimer = 0;
    resolve();
  }
  resolve();
  setInterval(() => { if (mode === 'auto') resolve(); }, 60e3);

  const tint = new THREE.Color(), night = new THREE.Color(0.35, 0.42, 0.62);
  return {
    MODES, KINDS, info, setMode, onChange: f => (listeners.add(f), f(info())),
    cycle(dir = 1) { setMode(MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length]); },
    startSound,
    // Hides the high crowns, for art packs whose own border forest already frames the map.
    hideCanopy() { for (const sp of canopy.list) sp.visible = false; },
    get state() { return cur; },
    get flash() { return flash; },
    resize(h) { const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); for (const k of Object.values(kinds)) k.u.uScale.value = s; snow.u.uScale.value = s; },
    update(dt, t, look, day, reduceMotion) {
      if (mode === 'real' && (realTimer -= dt) <= 0) { realTimer = 900; resolve(); }
      // Ease toward the target weather over a few seconds, so changes roll in rather than switch.
      const k = Math.min(1, dt * 0.35);
      for (const key of Object.keys(ZERO)) cur[key] += (target[key] - cur[key]) * k;
      const center = new THREE.Vector3(look.x, BOX[1] / 2 - 0.3, look.z + 3);
      tint.copy(night).lerp(new THREE.Color(1, 1, 1), day);
      const time = reduceMotion ? 0 : t;
      const wind = cur.wind;
      for (const [name, p] of Object.entries(kinds)) {
        const amt = cur[name];
        p.pts.visible = amt > 0.01;
        p.pts.geometry.setDrawRange(0, Math.floor(p.count * amt));
        p.u.uTime.value = time; p.u.uCenter.value.copy(center);
        p.u.uWind.value.set(wind * (name === 'rain' ? 2.4 : 1.6), wind * 0.4);
        p.u.uTint.value.copy(tint);
        p.u.uOpacity.value = 0.9;
      }
      splash.mat.opacity = Math.min(1, cur.rain * 1.2) * 0.7;
      splash.mat.color.copy(tint);
      // Rain: faint cool-white streaks, slanted by the wind, a little longer in storms.
      rain.mesh.visible = cur.rain > 0.01;
      rain.geo.instanceCount = Math.floor(rain.count * cur.rain);
      rain.u.uTime.value = time; rain.u.uCenter.value.copy(center);
      rain.u.uVel.value.set(wind * 3.2, -16, wind * 0.8);
      rain.u.uLen.value = 0.75 + cur.storm * 0.4;
      rain.u.uOpacity.value = 0.2 + cur.storm * 0.08;
      rain.u.uTint.value.setRGB(0.82, 0.88, 1).multiply(tint);
      snow.pts.visible = cur.snow > 0.01;
      snow.geo.setDrawRange(0, Math.floor(snow.count * cur.snow));
      snow.u.uTime.value = time; snow.u.uCenter.value.copy(center);
      snow.u.uVel.value.set(wind * 0.8, -1.1, wind * 0.2);
      snow.u.uTint.value.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.3);
      if (cur.rain > 0.05 && !reduceMotion) splash.tick(t, look);
      shadows.mat.opacity = shadows.base * day * Math.min(1, 0.3 + cur.clouds) * (0.3 + 0.7 * cur.sun);
      wisps.mat.opacity = wisps.base * (0.25 + cur.clouds * 0.75);
      wisps.mat.color.copy(tint);
      shadows.tick(time, look, wind); wisps.tick(time, look, wind);
      // Dawn brings a low mist even on clear days.
      const dawn = Math.max(0, 1 - Math.abs(day - 0.35) / 0.25) * 0.5;
      mist.mat.opacity = Math.min(0.4, (cur.fog + dawn * (1 - cur.rain)) * 0.3) * (0.45 + 0.55 * day);
      mist.mat.color.copy(tint);
      mist.tick(time, look);
      rays.mat.opacity = day * Math.max(0, cur.sun - 0.5) * 2 * 0.22 * (1 - cur.fog);
      if (!reduceMotion) rays.mat.opacity *= 0.8 + Math.sin(t * 0.7) * 0.2;
      for (const m of canopy.mats) m.color.copy(tint).multiplyScalar((0.5 + 0.3 * cur.sun) * LOOK.canopy.brightness); // a touch darker than the ground, like a foreground
      // Storms: lightning every so often, a white flash that fades fast.
      flash = Math.max(0, flash - dt * 3.5);
      if (cur.storm > 0.5 && !reduceMotion && (nextBolt -= dt) <= 0) { flash = 1; nextBolt = 5 + Math.random() * 11; }
      if (sound.ctx) {
        const set = (n, v) => sound.loops[n]?.gain.setTargetAtTime(v, sound.ctx.currentTime, 0.8);
        set('Rain', cur.rain * (1 - cur.storm) * 0.35);
        set('Storm', cur.storm * 0.4);
        set('Wind', Math.max(0, cur.wind - 0.4) * 0.12 + cur.snow * 0.05);
      }
    },
  };
}
