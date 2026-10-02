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
  function ground(cols, rows, at) {
    const c = canvas(cols * PX, rows * PX), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const ch = at(q, r);
      if (ch === '~') continue;
      const s = ch === '=' ? sw.path : sw.grass;
      const sx = (q * PX) % s.width, sy = (r * PX) % s.height;
      g.drawImage(s, sx, sy, PX, PX, q * PX, r * PX, PX, PX);
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
  const TREES = [['Elements/Plants/spr_deco_tree_01_strip4.png', 32, 34], ['Elements/Plants/spr_deco_tree_02_strip4.png', 28, 43]];
  const trees = [];
  async function tree(variant = 0, scale = 1) {
    const [src, w, h] = TREES[variant % TREES.length];
    const s = await strip(src);
    if (!s) return null;
    const t = pixelTex(s); t.repeat.set(1 / 4, 1);
    // Trees stand upright (not tipped back toward the camera) so their trunks meet the ground, and always keep a
    // contact shadow; tipped-back trees without one looked like they were floating.
    const mesh = new THREE.Mesh(quad(w, h, scale / PX), lit(t));
    mesh.castShadow = true;
    mesh.material.transparent = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
    const obj = new THREE.Group();
    obj.add(mesh, contact(1.3 * scale, treeBlob));
    trees.push({ obj, mat: mesh.material, fade: 1 });
    return obj;
  }

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

  return { ground, tiled, person, tree, animal, update, HAIR };
}
