// Sunnyside World (Daniel Diggle) as the default look of the 3D view: pixel ground painted from the 16 px tileset,
// pixel trees, and layered human sprites (body + hair) as camera-facing billboards. The pack lives in the git-ignored
// public/packs/ folder (its licence forbids redistribution in the repo). When it is missing, load() returns null and
// scene.js keeps its placeholder shapes.
import * as THREE from 'three';
import { LOOK } from './look.js';

const ROOT = 'packs/Sunnyside_World_ASSET_PACK_V2.1/Sunnyside_World_ASSET_PACK_V2.1/Sunnyside_World_Assets/';
const PX = 16;                       // tileset pixels per grid cell
const img = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = ROOT + src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function pixelTex(source) {
  const t = new THREE.CanvasTexture(source);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Ground swatches in the 16 px tileset: [x, y, w, h]. Each repeats in world space so neighbouring cells join up.
const SWATCH = { grass: [16, 32, 32, 32], water: [176, 288, 64, 64], path: [672, 112, 32, 32] };

// Human layers: body plus one hairstyle per character. Frames are 96x64 with the figure centred and the feet on
// row 39, so each frame is cropped to a 32x32 window ending just under the feet.
const ANIMS = { idle: ['IDLE', 'idle', 9], walk: ['WALKING', 'walk', 8] };
const CROP = { x: 32, y: 8, w: 32, h: 32 };
const HAIR = ['shorthair', 'curlyhair', 'longhair', 'mophair', 'bowlhair', 'spikeyhair'];

export async function load() {
  let tiles;
  try { tiles = await img('Tileset/spr_tileset_sunnysideworld_16px.png'); } catch { return null; }
  const strips = new Map();
  const strip = src => { if (!strips.has(src)) strips.set(src, img(src).catch(() => null)); return strips.get(src); };
  const swatch = name => { const [x, y, w, h] = SWATCH[name]; const c = canvas(w, h); c.getContext('2d').drawImage(tiles, x, y, w, h, 0, 0, w, h); return c; };
  const sw = { grass: swatch('grass'), water: swatch('water'), path: swatch('path') };

  // One canvas for the whole map: grass, path and (transparent) water cells, so the lit water plane shows through.
  // Grass mixes plain and dotted tiles so it doesn't repeat; road cells get a ragged grass fringe where they meet grass;
  // flowers ('F' cells, plus a few strays) and grass tufts (',' cells, plus strays) are painted on as decals.
  const GRASS = { plain: [[32, 16], [16, 48], [32, 48]], dotted: [[16, 32], [32, 32], [48, 32], [64, 32], [80, 32], [16, 64], [32, 64]] };
  const FLOWERS = [[533, 18, 5, 6], [552, 19, 7, 8], [533, 34, 5, 6], [552, 35, 7, 8], [532, 51, 7, 6], [551, 52, 9, 8], [538, 57, 6, 6]];
  const TUFTS = [[438, 39, 8, 8], [454, 38, 8, 9], [470, 38, 8, 9], [486, 39, 8, 8], [434, 50, 8, 9], [450, 49, 8, 10], [466, 49, 8, 10]];
  const hash = (q, r, k = 0) => (((q + 101) * 73856093 ^ (r + 37) * 19349663 ^ (k + 7) * 83492791) >>> 0);
  function ground(cols, rows, at) {
    const c = canvas(cols * PX, rows * PX), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const tile = ([sx, sy], q, r) => g.drawImage(tiles, sx, sy, PX, PX, q * PX, r * PX, PX, PX);
    const isGrass = (q, r) => { const ch = at(q, r); return ch !== '=' && ch !== '~' && ch !== 'P' && ch !== undefined; };
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const ch = at(q, r), h = hash(q, r);
      if (ch === '~') continue;
      if (ch === 'P') { // dock planks: boards across the cell with dark seams
        g.fillStyle = '#9c7a4e'; g.fillRect(q * PX, r * PX, PX, PX);
        for (let i = 0; i < PX; i += 4) { g.fillStyle = '#6f5233'; g.fillRect(q * PX, r * PX + i, PX, 1); }
        g.fillStyle = '#7d5f3c'; g.fillRect(q * PX + (h % 2) * 8 + 3, r * PX + 4 * (h % 4), 1, 4);
        continue;
      }
      if (ch === '=') { const sx = (q * PX) % sw.path.width, sy = (r * PX) % sw.path.height; g.drawImage(sw.path, sx, sy, PX, PX, q * PX, r * PX, PX, PX); continue; }
      const set = h % 100 < 28 ? GRASS.dotted : GRASS.plain;
      tile(set[(h >>> 8) % set.length], q, r);
    }
    // Ragged fringe: grass creeps 1-3 px onto the road along each grass edge, with a darker rim pixel under it.
    const probe = canvas(1, 1).getContext('2d'); probe.drawImage(tiles, 40, 20, 1, 1, 0, 0, 1, 1);
    const [gr, gg, gb] = probe.getImageData(0, 0, 1, 1).data, grass = `rgb(${gr},${gg},${gb})`, rim = `rgb(${gr * 0.62 | 0},${gg * 0.7 | 0},${gb * 0.55 | 0})`;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      if (at(q, r) !== '=') continue;
      for (const [dq, dr, side] of [[0, -1, 'n'], [0, 1, 's'], [-1, 0, 'w'], [1, 0, 'e']]) {
        const nq = q + dq, nr = r + dr;
        if (nq < 0 || nr < 0 || nq >= cols || nr >= rows || !isGrass(nq, nr)) continue;
        for (let i = 0; i < PX; i++) {
          // Depth varies along the edge in runs of 2-3 px, so it reads as tufts rather than noise.
          const run = Math.floor((i + (hash(q, r, side.charCodeAt(0)) % 3)) / 3), d = 1 + hash(q * PX + i, r, run) % 3;
          for (let k = 0; k <= d; k++) {
            const [x, y] = side === 'n' ? [i, k] : side === 's' ? [i, PX - 1 - k] : side === 'w' ? [k, i] : [PX - 1 - k, i];
            g.fillStyle = k === d ? rim : grass;
            g.fillRect(q * PX + x, r * PX + y, 1, 1);
          }
        }
      }
    }
    // Decals: flowers and tufts, kept off the cell edges so they never spill onto the road.
    const decal = ([sx, sy, w, h], q, r, k) => {
      const ox = 2 + hash(q, r, k) % Math.max(1, PX - w - 3), oy = 2 + hash(q, r, k + 50) % Math.max(1, PX - h - 3);
      g.drawImage(tiles, sx, sy, w, h, q * PX + ox, r * PX + oy, w, h);
    };
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const ch = at(q, r), h = hash(q, r, 3);
      if (!isGrass(q, r)) continue;
      if (ch === 'F') for (let k = 0; k < 3; k++) decal(FLOWERS[hash(q, r, k + 9) % FLOWERS.length], q, r, k + 20);
      else if (ch === ',') for (let k = 0; k < 2; k++) decal(TUFTS[hash(q, r, k + 9) % TUFTS.length], q, r, k + 20);
      else if (h % 100 < LOOK.ground.flowers * 100) decal(FLOWERS[(h >>> 7) % FLOWERS.length], q, r, 1);
      else if (h % 100 < (LOOK.ground.flowers + LOOK.ground.tufts) * 100) decal(TUFTS[(h >>> 7) % TUFTS.length], q, r, 1);
    }
    return pixelTex(c);
  }
  // A repeating swatch for wide surfaces (the meadow past the map, the water). `cells` is the world size covered.
  function tiled(name, cells) {
    const s = sw[name], t = pixelTex(s);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(cells * PX / s.width, cells * PX / s.height);
    return t;
  }

  // ---------- sprites ----------
  const unit = LOOK.sprite.height / PX;          // world units per sprite pixel; LOOK.sprite.height is one cell's worth
  const lit = map => new THREE.MeshLambertMaterial({
    map, alphaTest: 0.5, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveMap: map, emissiveIntensity: LOOK.sprite.selfLight * 0.25,
  });
  // A quad with its origin at the bottom centre, so position.y = 0 stands it on the ground.
  const quad = (w, h, u = unit) => { const g = new THREE.PlaneGeometry(w * u, h * u); g.translate(0, h * u / 2, 0); return g; };
  const blob = (() => {
    const c = canvas(32, 32), g = c.getContext('2d'), grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const blobMat = opacity => new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity });
  const peopleBlob = blobMat(LOOK.sprite.blob), treeBlob = blobMat(LOOK.trees.contact);
  const contact = (size, mat = peopleBlob) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.55), mat); m.rotation.x = -Math.PI / 2; m.position.y = 0.01; return m; };

  // Every sprite turns to face the camera, kept upright (yaw only would show their thin edge; full facing reads best
  // with this camera, per the sprite lab).
  const billboards = [];
  function billboard(mesh) { mesh.castShadow = true; billboards.push(mesh); return mesh; }
  function face(camera) { for (const m of billboards) m.quaternion.copy(camera.quaternion); }

  // Stack body + hair (+ tools) into one strip of cropped frames.
  async function layered(anim, hair) {
    const [dir, key, n] = ANIMS[anim];
    const layers = await Promise.all(['base', hair, 'tools'].map(l => strip(`Characters/Human/${dir}/${l}_${key}_strip${n}.png`)));
    const c = canvas(CROP.w * n, CROP.h), g = c.getContext('2d');
    for (const l of layers) if (l) for (let f = 0; f < n; f++) g.drawImage(l, f * 96 + CROP.x, CROP.y, CROP.w, CROP.h, f * CROP.w, 0, CROP.w, CROP.h);
    const t = pixelTex(c);
    t.repeat.set(1 / n, 1);
    return { tex: t, n };
  }

  // A person: returns { obj, sprite } where sprite.tick(dt, moving, dir) animates and flips the frames.
  async function person(hair = HAIR[0]) {
    const anims = { idle: await layered('idle', hair), walk: await layered('walk', hair) };
    const mat = lit(anims.idle.tex);
    const body = billboard(new THREE.Mesh(quad(CROP.w, CROP.h), mat));
    body.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: anims.idle.tex, alphaTest: 0.5 });
    const obj = new THREE.Group();
    obj.add(body, contact(0.7));
    let cur = 'idle', time = 0, flip = 1, still = 0;
    const sprite = {
      tick(dt, moving, dir) {
        const want = moving ? 'walk' : 'idle';
        if (want !== cur) { cur = want; time = 0; mat.map = mat.emissiveMap = body.customDepthMaterial.map = anims[cur].tex; mat.needsUpdate = true; }
        if (dir === 'left') flip = -1; else if (dir === 'right') flip = 1;
        body.scale.x = flip;
        const a = anims[cur], fps = moving ? 10 : 6;
        // Idle frames (breathing) only run after standing still for LOOK.people.idleAfter seconds.
        still = moving ? 0 : still + dt;
        if (!moving && still < LOOK.people.idleAfter) time = 0; else time += dt;
        a.tex.offset.x = (Math.floor(time * fps) % a.n) / a.n;
      },
    };
    return { obj, sprite };
  }

  // Trees: the two Sunnyside trees, held on their first frame (cycling the strip made them look like they were dancing).
  // Then pieces cut from the tileset ([x, y, w, h]): two pines, a round bush, berry and flowering bushes, a shrub.
  const TREES = [['Elements/Plants/spr_deco_tree_01_strip4.png', 32, 34], ['Elements/Plants/spr_deco_tree_02_strip4.png', 28, 43],
    [833, 61, 14, 35], [823, 100, 18, 35], [788, 22, 24, 21], [788, 54, 24, 21], [788, 86, 24, 21], [816, 65, 16, 15]];
  const trees = [];
  // The hub holds well over a thousand trees, so texture, geometry and depth material are built once per kind (a
  // phone can't hold a texture each); only the material is per tree, for the fade.
  const treeParts = new Map();
  async function treeKind(variant, scale) {
    const key = variant % TREES.length + ':' + scale;
    if (!treeParts.has(key)) treeParts.set(key, (async () => {
      const entry = TREES[variant % TREES.length];
      let t, w, h;
      if (typeof entry[0] === 'string') {
        const s = await strip(entry[0]);
        if (!s) return null;
        [, w, h] = entry;
        t = pixelTex(s); t.repeat.set(1 / 4, 1);
      } else {
        const [x, y] = entry; [, , w, h] = entry;
        const c = canvas(w, h); c.getContext('2d').drawImage(tiles, x, y, w, h, 0, 0, w, h);
        t = pixelTex(c);
      }
      const shadow = contact(Math.max(0.6, 1.3 * w / 32) * scale, treeBlob).geometry; // smaller shadow under bushes
      return { t, geo: quad(w, h, scale / PX), shadow, depth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 }) };
    })());
    return treeParts.get(key);
  }
  async function tree(variant = 0, scale = 1) {
    const kind = await treeKind(variant, scale);
    if (!kind) return null;
    // Trees stand upright (not tipped back toward the camera) so their trunks meet the ground, and always keep a
    // contact shadow; tipped-back trees without one looked like they were floating.
    const mesh = new THREE.Mesh(kind.geo, lit(kind.t));
    mesh.castShadow = true;
    mesh.material.transparent = true;
    mesh.customDepthMaterial = kind.depth;
    const shadow = new THREE.Mesh(kind.shadow, treeBlob); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
    const obj = new THREE.Group();
    obj.add(mesh, shadow);
    trees.push({ obj, mat: mesh.material, fade: 1 });
    return obj;
  }

  // Folded sprites. The tileset draws buildings top-down at 3/4: the part seen from above on top, the front face below.
  // folded() stands the front face upright and leans the top part back from its upper edge by `tilt` degrees, so the
  // piece reads as a solid object from the camera. Each part is its own mesh and catches the sun at its own angle.
  // `sides` fills the space under the top with plain panels, so a building never looks hollow from an angle.
  function folded({ x, y, w, top, front, tilt, scale, sides }) {
    const u = scale / PX;
    const part = (py, h) => { const c = canvas(w, h); c.getContext('2d').drawImage(tiles, x, py, w, h, 0, 0, w, h); return pixelTex(c); };
    const solid = map => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
      m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
      return m;
    };
    const ww = w * u, fh = front * u, tl = top * u, a = THREE.MathUtils.degToRad(tilt);
    const depth = Math.sin(a) * tl, rise = Math.cos(a) * tl;
    const face = solid(part(y + top, front)); face.scale.set(ww, fh, 1); face.position.set(0, fh / 2, depth / 2);
    const cap = solid(part(y, top)); cap.scale.set(ww, tl, 1); cap.rotation.x = -a; cap.position.set(0, fh + rise / 2, 0);
    const obj = new THREE.Group();
    if (sides) {
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, fh), new THREE.Vector2(depth, fh + rise), new THREE.Vector2(depth, 0)]);
      const mat = new THREE.MeshLambertMaterial({ color: sides, side: THREE.DoubleSide });
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
        side.rotation.y = Math.PI / 2; side.position.set(sx * (ww / 2 - 0.02), 0, depth / 2);
        side.castShadow = side.receiveShadow = true;
        obj.add(side);
      }
    }
    obj.add(face, cap);
    // Where the top's near edge sits, for things placed on it (the well's fire).
    obj.userData.rim = { y: fh, z: depth / 2, depth, rise, unit: u };
    return obj;
  }
  // Houses: the small gabled houses (blue, green, orange roofs), 32 px wide: roof rows 0-31, front wall rows 32-55.
  const HOUSES = [[520, 168], [520, 296], [520, 424]];
  const house = (variant = 0, scale = LOOK.houses.scale) => {
    const [x, y] = HOUSES[variant % HOUSES.length];
    return folded({ x, y, w: 32, top: 32, front: 24, tilt: LOOK.houses.roofTilt, scale, sides: 0x7a4e30 });
  };
  // The stone well: rim and opening rows 0-10, stonework rows 11-20 (its drawn shadow below is left out).
  const well = (scale = LOOK.well.scale) => folded({ x: 598, y: 311, w: 20, top: 11, front: 10, tilt: LOOK.well.tilt, scale });

  // Trees standing between the camera and the player fade out so the player is never hidden.
  // Animals: 4-frame strips facing left, shadows drawn in. FOOT is each strip's bottom pixel row, so they stand on y = 0.
  const ANIMAL = { Chicken: ['spr_deco_chicken_01_strip4.png', 26], Duck: ['spr_deco_duck_01_strip4.png', 16], Sheep: ['spr_deco_sheep_01_strip4.png', 27], Pig: ['spr_deco_pig_01_strip4.png', 27], Cow: ['spr_deco_cow_strip4.png', 29] };
  async function animal(kind) {
    const [file, foot] = ANIMAL[kind] || [];
    const s = file && await strip('Elements/Animals/' + file);
    if (!s) return null;
    const w = s.width / 4, h = s.height, u = LOOK.animals.scale / PX;
    const t = pixelTex(s); t.repeat.set(1 / 4, 1);
    const geo = new THREE.PlaneGeometry(w * u, h * u); geo.translate(0, (h / 2 - foot) * u, 0);
    const body = billboard(new THREE.Mesh(geo, lit(t)));
    body.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
    const obj = new THREE.Group(); obj.add(body);
    let time = Math.random() * 4, flip = 1;
    return { obj, sprite: { tick(dt, moving, dir) {
      if (dir === 'right') flip = -1; else if (dir === 'left') flip = 1;
      body.scale.x = flip; time += dt;
      t.offset.x = (Math.floor(time * LOOK.animals.fps) % 4) / 4;
    } } };
  }

  function update(dt, t, camera, reduceMotion, focus) {
    face(camera);
    if (focus) for (const s of trees) {
      const p = s.obj.position, hides = p.z > focus.z + 0.4 && p.z < focus.z + 4 && Math.abs(p.x - focus.x) < 1.6;
      s.fade += ((hides ? LOOK.trees.fadeTo : 1) - s.fade) * Math.min(1, dt * 8);
      s.mat.opacity = s.fade;
    }
  }

  return { ground, tiled, person, tree, animal, house, well, update, HAIR };
}
