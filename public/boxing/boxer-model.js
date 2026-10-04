/**
 * Boxing Manager AI: the rigged boxer for the 3D view (a MakeHuman/MPFB person with Quaternius CC0 clips, falling back
 * to the Quaternius character; see models/CREDITS.md).
 *
 * We don't let Babylon play the clips. Each frame we sample them ourselves (Animation.evaluate) and blend per bone, so a
 * punch clip can be scrubbed to the sim's launch → arrive ticks and hit exactly when the sim says the fist lands. On top
 * of the clips, two-bone IK on the real arm bones puts the gloves where the pose logic wants them (guard, uppercut,
 * body shot), since the free clips have no boxing guard, uppercut or body shot.
 */
import { v, add, sub, mul, dot, len, norm, clamp, solveTwoBone } from './pose-math.js';
import { Footwork, Smoother, Drift, Spring } from './footwork.js';

const LOADER_SRC = 'https://cdn.jsdelivr.net/npm/babylonjs-loaders@7.54.3/babylon.glTF2FileLoader.min.js';
let loaderPromise = null;

export function loadGltfLoader(B) {
  if (B.SceneLoader.IsPluginForExtensionAvailable?.('.glb')) return Promise.resolve();
  loaderPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LOADER_SRC; s.onload = resolve;
    s.onerror = () => { loaderPromise = null; reject(new Error(`could not load ${LOADER_SRC}`)); };
    document.head.appendChild(s);
  });
  return loaderPromise;
}

/**
 * Loads the character and anims.glb once per scene into asset containers. The MPFB person (person.glb, clothing options
 * as separate meshes) is preferred; if it won't load, the Quaternius boxer.glb is used and `person` is false.
 */
export async function loadBoxerAssets(B, scene, base = new URL('models/', import.meta.url).href) {
  await loadGltfLoader(B);
  const anims = await B.SceneLoader.LoadAssetContainerAsync(base, 'anims.glb', scene);
  for (const g of anims.animationGroups) g.stop();
  let boxer = null;
  try { boxer = await B.SceneLoader.LoadAssetContainerAsync(base, 'person.glb', scene); }
  catch (err) { console.warn('person.glb unavailable, using the Quaternius boxer:', err); }
  if (boxer) {
    const tex = (tone) => new B.Texture(`${base}person_skin_${tone}.webp`, scene, false, false);
    return { boxer, anims, person: true, skins: { light: tex('light'), medium: tex('medium'), deep: tex('deep') } };
  }
  boxer = await B.SceneLoader.LoadAssetContainerAsync(base, 'boxer.glb', scene);
  return { boxer, anims, person: false, skinLight: new B.Texture(base + 'skin_light.webp', scene, false, false) };
}

/**
 * The Quaternius clips carry a translation for every bone, which would stretch another skeleton to Quaternius bone
 * lengths. The person keeps its own bone offsets and only takes the clips' root and pelvis movement, relative to this
 * rest (pelvis position under `root` in boxer.glb, in the root bone's own axes).
 */
const CLIP_REST = { root: [0, 0, 0], pelvis: [0, 0.043, 0.949] };

const ARM = {
  [-1]: { upper: 'upperarm_l', lower: 'lowerarm_l', hand: 'hand_l' },
  [1]: { upper: 'upperarm_r', lower: 'lowerarm_r', hand: 'hand_r' },
};

const LEG = {
  [-1]: { upper: 'thigh_l', lower: 'calf_l', foot: 'foot_l', ball: 'ball_l' },
  [1]: { upper: 'thigh_r', lower: 'calf_r', foot: 'foot_r', ball: 'ball_r' },
};

/** One instanced character with a clip mixer and arm IK. */
export class ModelRig {
  constructor(B, scene, assets, tag) {
    this.B = B; this.ownBones = !!assets.person;
    const inst = assets.boxer.instantiateModelsToScene((n) => `${tag}:${n}`, false, { doNotInstantiate: true });
    this.root = inst.rootNodes[0];
    this.holder = new B.TransformNode(`${tag}:holder`, scene);
    this.root.parent = this.holder;
    this.meshes = this.root.getChildMeshes(false);
    this.bones = {};
    for (const n of this.root.getDescendants(false)) {
      const name = n.name.slice(tag.length + 1);
      if (!(n instanceof B.AbstractMesh)) this.bones[name] = n;
    }
    for (const n of Object.values(this.bones)) n.rotationQuaternion ??= B.Quaternion.FromEulerVector(n.rotation);
    this.rest = Object.fromEntries(Object.entries(this.bones).map(([k, n]) => [k, { q: n.rotationQuaternion.clone(), p: n.position.clone() }]));

    // Clips: per bone, the rotation and position channels, sampled by frame.
    this.clips = {};
    for (const g of assets.anims.animationGroups) {
      const ch = {};
      let fps = 60;
      for (const { target, animation } of g.targetedAnimations) {
        const bone = target.name;
        if (!this.bones[bone]) continue;
        (ch[bone] ??= {})[animation.targetProperty === 'rotationQuaternion' ? 'rot' : animation.targetProperty] = animation;
        fps = animation.framePerSecond;
      }
      this.clips[g.name] = { from: g.from, to: g.to, seconds: (g.to - g.from) / fps, ch };
    }
    this.clipNames = Object.keys(this.clips);
    this._q = new B.Quaternion(); this._p = new B.Vector3();
    this.lift = 0;
    this.initFists();
  }

  /**
   * The person's hands are open, flat and spread. Finds, for each finger, the local axis that closes it toward the palm
   * (the bone rolls differ, so each is tried) and keeps a curl rotation per bone that applyLayers adds, so both hands are fists.
   */
  initFists() {
    const B = this.B;
    this.curl = {};
    this.root.computeWorldMatrix(true);
    for (const n of Object.values(this.bones)) n.computeWorldMatrix(true);
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const s of ['l', 'r']) {
      const hand = this.bones[`hand_${s}`];
      if (!hand) continue;
      for (const [finger, bend] of [['index', [1.15, 1.5, 1.1]], ['middle', [1.15, 1.5, 1.1]], ['ring', [1.2, 1.5, 1.1]], ['pinky', [1.25, 1.5, 1.1]], ['thumb', [0.35, 0.55, 0.55]]]) {
        const names = [1, 2, 3].map((i) => `${finger}_0${i}_${s}`);
        if (!names.every((n) => this.bones[n])) continue;
        const first = this.bones[names[0]], tip = this.bones[names[2]];
        let best = null;
        for (const ax of axes) {
          const q = B.Quaternion.RotationAxis(new B.Vector3(...ax), 1);
          const keep = first.rotationQuaternion.clone();
          first.rotationQuaternion.copyFrom(keep.multiply(q));
          first.computeWorldMatrix(true); for (const d of first.getDescendants(false)) d.computeWorldMatrix?.(true);
          const dist = B.Vector3.Distance(tip.getAbsolutePosition(), hand.getAbsolutePosition());
          first.rotationQuaternion.copyFrom(keep);
          first.computeWorldMatrix(true); for (const d of first.getDescendants(false)) d.computeWorldMatrix?.(true);
          if (!best || dist < best.dist) best = { ax, dist };
        }
        names.forEach((n, i) => { this.curl[n] = B.Quaternion.RotationAxis(new B.Vector3(...best.ax), bend[i]); });
      }
    }
  }

  /** Stands the rig at `pos` (ground point) facing unit `forward` (both {x,y,z}). */
  place(pos, forward) {
    this.holder.position.set(pos.x, pos.y + this.lift, pos.z);
    this.holder.rotation.y = Math.atan2(forward.x, forward.z);
  }

  /**
   * Blends clips. layers: [{ clip, t: 0..1 through the clip, w: weight }]; the first is the base (weight 1).
   * Bones a layer doesn't animate keep whatever the earlier layers gave them.
   */
  applyLayers(layers) {
    const B = this.B;
    for (const [name, node] of Object.entries(this.bones)) {
      const rest = this.rest[name];
      let q = null, p = null;
      for (const L of layers) {
        const clip = this.clips[L.clip];
        const c = clip?.ch[name];
        if (!c || L.w <= 0) continue;
        const frame = clip.from + clamp(L.t, 0, 1) * (clip.to - clip.from);
        if (c.rot) {
          const val = c.rot.evaluate(frame);
          if (!q) q = val.clone(); else B.Quaternion.SlerpToRef(q, val, L.w, q);
        }
        if (c.position) {
          const val = c.position.evaluate(frame);
          if (!p) p = val.clone(); else B.Vector3.LerpToRef(p, val, L.w, p);
        }
      }
      node.rotationQuaternion.copyFrom(q ?? rest.q);
      const curl = this.curl[name];
      if (curl) node.rotationQuaternion.copyFrom((q ?? rest.q).multiply(curl));
      if (this.ownBones) {
        const cr = CLIP_REST[name];
        if (p && cr) node.position.set(rest.p.x + p.x - cr[0], rest.p.y + p.y - cr[1], rest.p.z + p.z - cr[2]);
        else node.position.copyFrom(rest.p);
      } else node.position.copyFrom(p ?? rest.p);
    }
    this.root.computeWorldMatrix(true);
    for (const n of Object.values(this.bones)) n.computeWorldMatrix(true);
  }

  /**
   * The person has shorter legs than the clips were made for, and its shoes' soles sit below its foot bones, so in the
   * stance its soles would sink into the floor. Sets `lift` so the sole of `shoe` rests at y = 0 in the guard stance.
   */
  standOn(shoe) {
    const ballY = () => (this.pos('ball_l').y + this.pos('ball_r').y) / 2;
    this.lift = 0;
    this.holder.position.set(0, 0, 0); this.holder.rotation.y = 0;
    this.applyLayers([]);
    const restBall = ballY();
    shoe.computeWorldMatrix(true);
    const sole = shoe.getBoundingInfo().boundingBox.minimumWorld.y - restBall;
    this.applyLayers([{ ...STANCE, w: 1 }]);
    this.lift = -(ballY() + sole);
  }

  /** Lowers the whole body by `dy` m (the clips have already been applied). */
  drop(dy) {
    this.holder.position.y -= dy;
    this.root.computeWorldMatrix(true);
    for (const n of Object.values(this.bones)) n.computeWorldMatrix(true);
  }

  /** World position of a bone as {x,y,z}. */
  pos(name) { const p = this.bones[name].getAbsolutePosition(); return v(p.x, p.y, p.z); }

  /**
   * Rotates `name` (in world space, by the smallest turn) so the bone toward `childName` points at `target`.
   * Works through the parent's world rotation, so the glTF root's mirroring doesn't matter.
   */
  aim(name, childName, target) {
    const B = this.B, node = this.bones[name], child = this.bones[childName];
    node.computeWorldMatrix(true); child.computeWorldMatrix(true);
    const s = node.getAbsolutePosition(), c = child.getAbsolutePosition();
    const d0 = c.subtract(s).normalize(), d1 = new B.Vector3(target.x - s.x, target.y - s.y, target.z - s.z).normalize();
    if (B.Vector3.Dot(d0, d1) > 0.99999) return;
    const dq = new B.Quaternion();
    B.Quaternion.FromUnitVectorsToRef(d0, d1, dq);
    this.turn(node, dq);
  }

  /** Turns `node` by the world-space rotation `dq` about its own position, keeping its local translation and scale. */
  turn(node, dq) {
    const B = this.B, delta = new B.Matrix();
    B.Matrix.FromQuaternionToRef(dq, delta);
    // world' = world · delta (row vectors). local' = world' · parentWorld⁻¹.
    const world = node.getWorldMatrix().clone();
    const t = world.getTranslation();
    world.setTranslationFromFloats(0, 0, 0);
    const turned = world.multiply(delta);
    turned.setTranslation(t);
    const parentInv = node.parent.getWorldMatrix().clone().invert();
    const local = turned.multiply(parentInv);
    const sc = new B.Vector3(), rq = new B.Quaternion(), tr = new B.Vector3();
    local.decompose(sc, rq, tr);
    node.rotationQuaternion.copyFrom(rq);
    node.computeWorldMatrix(true);
    for (const n of node.getDescendants(false)) n.computeWorldMatrix?.(true);
  }

  /** Twists `name` about the line toward `childName` by `angle` rad (right-handed about that line). */
  twist(name, childName, angle) {
    const B = this.B, a = this.pos(name), c = this.pos(childName), d = norm(sub(c, a));
    this.turn(this.bones[name], B.Quaternion.RotationAxis(new B.Vector3(d.x, d.y, d.z), angle));
  }

  /**
   * The clips' torsos are hunched (the jab frame bends the upper spine ~30 deg forward over a back-leaning lower spine).
   * Turns each spine/neck segment toward an upright boxer's lean (`lean` rad forward from vertical, per segment) by
   * `w`, keeping each segment's own twist, so the guard and the punches stand straight. `f` is the boxer's forward.
   */
  straighten(f, w = 1, lean = SPINE_LEAN, loose = null) {
    if (w <= 0) return;
    const chain = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      if (!this.bones[a] || !this.bones[b]) continue;
      const s = this.pos(a), c = this.pos(b), d = sub(c, s), l = len(d);
      let want = norm(add(mul(UPV, Math.cos(lean[i])), mul(f, Math.sin(lean[i]))));
      // Loose torso: slow side lean and fore-aft rock per segment (rad), each lagging the one below it.
      if (loose) want = norm(add(want, add(mul(f, loose.fore[i] ?? 0), mul(v(f.z, 0, -f.x), loose.side[i] ?? 0))));
      const dir = norm(add(mul(norm(d), 1 - w), mul(want, w)));
      this.aim(a, b, add(s, mul(dir, l)));
    }
  }

  /** Arm IK: puts the hand of `side` (−1 left, +1 right) at `target`, elbow bending toward `pole` (directions {x,y,z}). */
  reach(side, target, pole, weight = 1) {
    if (weight <= 0) return;
    const a = ARM[side];
    const sh = this.pos(a.upper), el = this.pos(a.lower), wr = this.pos(a.hand);
    const lu = len(sub(el, sh)), lf = len(sub(wr, el));
    // Blend the IK target with where the clip already put the hand.
    const goal = add(wr, mul(sub(target, wr), weight));
    const { mid, end } = solveTwoBone(sh, goal, lu, lf, pole);
    this.aim(a.upper, a.lower, mid);
    this.aim(a.lower, a.hand, end);
  }

  /** Leg IK: puts the ankle of `side` at `ankle` and the toes toward `ball`, the knee bending toward `pole`. */
  plant(side, ankle, ball, pole, weight = 1) {
    if (weight <= 0) return;
    const L = LEG[side];
    const hip = this.pos(L.upper), kn = this.pos(L.lower), an = this.pos(L.foot), bl = this.pos(L.ball);
    const lu = len(sub(kn, hip)), lf = len(sub(an, kn));
    const goal = add(an, mul(sub(ankle, an), weight));
    const { mid, end } = solveTwoBone(hip, goal, lu, lf, pole);
    this.aim(L.upper, L.lower, mid);
    this.aim(L.lower, L.foot, end);
    this.aim(L.foot, L.ball, add(this.pos(L.foot), mul(sub(add(bl, mul(sub(ball, bl), weight)), this.pos(L.foot)), 1)));
  }

  /** Numbers for the dev viewer: height, arm lengths, where the toes point. */
  describe() {
    this.applyLayers([{ clip: 'Idle_Loop', t: 0, w: 1 }]);
    const r = (p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) });
    const toe = this.pos('ball_l'), heel = this.pos('foot_l');
    return {
      head: r(this.pos('Head')), pelvis: r(this.pos('pelvis')),
      upperArm: +len(sub(this.pos('lowerarm_l'), this.pos('upperarm_l'))).toFixed(3),
      forearm: +len(sub(this.pos('hand_l'), this.pos('lowerarm_l'))).toFixed(3),
      toesPoint: r(norm(sub(toe, heel))),
      handL: r(this.pos('hand_l')), handR: r(this.pos('hand_r')),
      clips: Object.fromEntries(Object.entries(this.clips).map(([k, c]) => [k, +c.seconds.toFixed(2)])),
      bones: Object.keys(this.bones).length,
    };
  }

  dispose() { this.holder.dispose(false, true); }
}

// ─── The boxer the arena uses ────────────────────────────────────────────────────

/** Which clip carries each punch's body motion, and where in the clip the fist lands (measured in dev-model.html). */
const PUNCH_CLIP = {
  jab: { clip: 'Punch_Jab', impact: 0.25, side: -1, as: 'jab' },
  cross: { clip: 'Punch_Cross', impact: 0.3, side: 1, as: 'cross' },
  hook: { clip: 'Melee_Hook', impact: 0.425, side: -1, as: 'hook' },
  uppercut: { clip: 'Punch_Cross', impact: 0.3, side: 1, as: 'uppercut' },     // no free uppercut: cross body, IK arm on an upward path
  body: { clip: 'Melee_Hook', impact: 0.425, side: -1, as: 'body' },        // no free body shot: hook body, IK arm to the ribs
};
// Street strikes (BOX-22) borrow a base punch's clip and IK path; `big` widens the swing and the foot pivot.
Object.assign(PUNCH_CLIP, {
  haymaker: { ...PUNCH_CLIP.hook, side: 1, as: 'hook', big: 1.6 },
  overhand: { ...PUNCH_CLIP.hook, side: 1, as: 'hook', big: 1.25 },
  check_hook: { ...PUNCH_CLIP.hook, as: 'hook', big: 0.7 },
  hook_body: { ...PUNCH_CLIP.body, as: 'body' },
  shovel: { ...PUNCH_CLIP.body, side: 1, as: 'body' },
  short_upper: { ...PUNCH_CLIP.uppercut, side: -1, as: 'uppercut', big: 0.7 },
  cheap_shot: { ...PUNCH_CLIP.jab, as: 'jab', big: 0.6 },
});

const STANCE = { clip: 'Punch_Jab', t: 0 };                       // the jab's first frame is a good orthodox guard
// Guard hand positions relative to the head bone, in the boxer's own frame (x right, y up, z forward), measured on the
// stance frame. Relative to the head so the guard follows the body down when a clip crouches.
const GUARD = { [-1]: { x: -0.11, y: -0.14, z: 0.24 }, [1]: { x: 0.13, y: -0.17, z: 0.08 } };
// The free hook clip is a deep lunging melee swing; only part of it reads as a boxing hook.
const CLIP_WEIGHT = { Melee_Hook: 0.5 };
const HIT_CLIP = { head: 'Hit_Head', body: 'Hit_Chest', big: 'Hit_Knockback' };


// ─── Outfits: clothes painted onto the body texture by bone region ─────────────────────────

/** Which part of an outfit covers the skin a bone drives. */
function zoneOf(bone) {
  if (/^(pelvis|thigh|calf)/.test(bone)) return 'legs';
  if (/^(foot|ball)/.test(bone)) return 'feet';
  if (/^(spine|clavicle)/.test(bone)) return 'torso';
  if (/^neck/.test(bone)) return 'neck';
  if (/^upperarm/.test(bone)) return 'upper';
  if (/^lowerarm/.test(bone)) return 'lower';
  return 'skin';
}

/** The colour (hex) an outfit puts on each zone, or null where skin shows. */
function outfitColors(o) {
  const sleeve = o.topStyle === 'varsity' ? o.sleeve ?? o.top : o.top;   // only the varsity jacket has contrast sleeves
  const covers = { tank: ['torso'], tee: ['torso', 'upper'], varsity: ['torso', 'upper', 'lower'], hoodie: ['torso', 'upper', 'lower', 'neck'] }[o.topStyle] ?? [];
  return {
    legs: o.jeans, feet: o.boots === 'sneakers' ? '#ececea' : '#c89a5c',
    torso: covers.includes('torso') ? o.top : null, neck: covers.includes('neck') ? o.top : null,
    upper: covers.includes('upper') ? (o.topStyle === 'tee' || o.topStyle === 'tank' ? o.top : sleeve) : null,
    lower: covers.includes('lower') ? sleeve : null, skin: null,
  };
}

/**
 * Paints `outfit` onto a copy of the body's base texture. Each triangle takes the zone of the bones that drive it,
 * the zone's garment colour fills it in UV space, and the base texture's shading is kept as folds. Denim gets a twill
 * and a lighter wash down the front of the thighs. Resolves with the new texture.
 */
export async function paintOutfit(B, scene, mesh, baseTex, outfit) {
  await new Promise((r) => (baseTex.isReady() ? r() : baseTex.onLoadObservable.addOnce(r)));
  const { width: W, height: H } = baseTex.getSize();
  const pixels = await baseTex.readPixels();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const base = new ImageData(new Uint8ClampedArray(pixels.buffer.slice(0)), W, H);

  // Zone mask in UV space: one grey level per zone.
  const ZONES = ['legs', 'feet', 'torso', 'neck', 'upper', 'lower', 'skin'];
  const uv = mesh.getVerticesData('uv'), idx = mesh.getIndices();
  const mi = mesh.getVerticesData('matricesIndices'), mw = mesh.getVerticesData('matricesWeights');
  const bones = mesh.skeleton.bones.map((b) => zoneOf(b.name.replace(/^.*:/, '')));
  const vzone = (v) => { let best = 0; for (let k = 1; k < 4; k++) if (mw[v * 4 + k] > mw[v * 4 + best]) best = k; return bones[mi[v * 4 + best]]; };
  const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
  const mg = mask.getContext('2d');
  mg.lineJoin = 'round'; mg.lineWidth = 2;
  for (let t = 0; t < idx.length; t += 3) {
    const zs = [vzone(idx[t]), vzone(idx[t + 1]), vzone(idx[t + 2])];
    const z = zs[1] === zs[2] ? zs[1] : zs[0];
    const level = `rgb(${(ZONES.indexOf(z) + 1) * 30},0,0)`;
    mg.fillStyle = mg.strokeStyle = level;
    mg.beginPath();
    for (let k = 0; k < 3; k++) { const v = idx[t + k]; const x = uv[v * 2] * W, y = uv[v * 2 + 1] * H; k ? mg.lineTo(x, y) : mg.moveTo(x, y); }
    mg.closePath(); mg.fill(); mg.stroke();
  }
  const m = mg.getImageData(0, 0, W, H).data, px = base.data;
  const cols = outfitColors(outfit);
  const tint = SKIN_TINT[outfit.skin];
  const rgb = Object.fromEntries(Object.entries(cols).map(([k, hex]) => [k, hex && [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));
  // Mean brightness of the base texture, so its shading becomes a ±25 % shade on the cloth.
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 16) { sum += px[i] + px[i + 1] + px[i + 2]; n++; }
  const mean = sum / n || 1;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const zone = ZONES[Math.round(m[i] / 30) - 1];
    const c = zone && rgb[zone];
    if (!c) {
      if (zone && tint) { px[i] *= tint[0]; px[i + 1] *= tint[1]; px[i + 2] *= tint[2]; }
      continue;
    }
    const x = p % W, y = (p / W) | 0;
    let shade = Math.min(1.25, Math.max(0.7, 0.75 + 0.25 * ((px[i] + px[i + 1] + px[i + 2]) / mean)));
    if (zone === 'legs') shade *= ((x + y) % 6 < 3 ? 0.94 : 1.04) * (1 + 0.12 * Math.sin(x * 0.05) * Math.sin(y * 0.03));
    else shade *= 0.97 + ((x * 7 + y * 13) % 5) * 0.015;
    px[i] = c[0] * shade; px[i + 1] = c[1] * shade; px[i + 2] = c[2] * shade;
  }
  g.putImageData(base, 0, 0);
  const tex = new B.DynamicTexture(`outfit-${mesh.name}`, cv, scene, true);
  tex.update(false);
  tex.wrapU = tex.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** The two fighters' default outfits, taken from the user's reference photo. Character creation starts from these. */
export const PHOTO_OUTFITS = {
  red: { topStyle: 'tee', top: '#ecebe6', jeans: '#8fa8c4', boots: 'timbs', cap: '#1c2540', capBackwards: true, chain: true, wraps: '#c9343a', skin: 'light', bottoms: 'jeans', trunks: '#b3262e', mouthguard: false },
  blue: { topStyle: 'varsity', top: '#1f2a44', sleeve: '#c9c6bf', jeans: '#2f3b52', boots: 'sneakers', cap: null, chain: true, wraps: '#2f6fd0', skin: 'deep', bottoms: 'jeans', trunks: '#2f6fd0', mouthguard: false },
};

/** What character creation offers. Everything comes from the reference photo (user: "the outfits will be the ones in the photo"). */
export const LOOK_OPTIONS = {
  topStyle: { tee: 'Tee', tank: 'Tank', varsity: 'Varsity', hoodie: 'Hoodie' },
  top: ['#ecebe6', '#1f2a44', '#16171a', '#7a1f26', '#3d5a3a', '#8a8f96', '#c9a227'],
  sleeve: ['#c9c6bf', '#ecebe6', '#16171a', '#7a1f26', '#1f2a44'],
  jeans: { '#8fa8c4': 'Light wash', '#4f6b8f': 'Mid wash', '#2f3b52': 'Dark wash', '#1d1e22': 'Black' },
  boots: { timbs: 'Wheat boots', sneakers: 'White sneakers' },
  cap: ['#1c2540', '#16171a', '#7a1f26', '#ecebe6', '#3d5a3a'],
  wraps: ['#c9343a', '#2f6fd0', '#ecebe6', '#16171a', '#d9a12b'],
  skin: { light: 'Light', medium: 'Medium', deep: 'Deep' },
  bottoms: { jeans: 'Jeans', trunks: 'Boxing trunks' },
  trunks: ['#b3262e', '#2f6fd0', '#ecebe6', '#16171a', '#d9a12b', '#3d5a3a'],
};
// Medium skin: the light texture multiplied by this, so the painted folds and features stay.
const SKIN_TINT = { medium: [0.8, 0.64, 0.52] };

const HEX = /^#[0-9a-f]{6}$/i;
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * A look safe to render: unknown keys dropped, every value checked against LOOK_OPTIONS or a hex colour, gaps filled
 * from `base`. Looks arrive in P2P `start` messages, so nothing from the other player reaches a material unchecked.
 */
export function normalizeLook(look, base = PHOTO_OUTFITS.red) {
  const l = look && typeof look === 'object' ? look : {};
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  return {
    topStyle: pick(l.topStyle, Object.keys(LOOK_OPTIONS.topStyle), base.topStyle),
    top: hex(l.top, base.top),
    sleeve: hex(l.sleeve, base.sleeve ?? base.top),
    jeans: hex(l.jeans, base.jeans),
    boots: pick(l.boots, Object.keys(LOOK_OPTIONS.boots), base.boots),
    cap: l.cap === null ? null : hex(l.cap, base.cap ?? null),
    capBackwards: typeof l.capBackwards === 'boolean' ? l.capBackwards : !!base.capBackwards,
    chain: typeof l.chain === 'boolean' ? l.chain : !!base.chain,
    wraps: hex(l.wraps, base.wraps),
    skin: pick(l.skin, Object.keys(LOOK_OPTIONS.skin), base.skin ?? 'light'),
    bottoms: pick(l.bottoms, Object.keys(LOOK_OPTIONS.bottoms), base.bottoms ?? 'jeans'),
    trunks: hex(l.trunks, base.trunks ?? '#b3262e'),
    mouthguard: typeof l.mouthguard === 'boolean' ? l.mouthguard : !!base.mouthguard,
  };
}


// ─── The MPFB person: garments are separate meshes in person.glb, shown and tinted by the look ──────────

/** Garment textures are baked grey with this mean (scripts/build-mpfb-boxer.py), so diffuseColor / this gives the exact hex. */
const GREY_MEAN = 0.8;
const TINTED = new Set(['top_tee', 'top_tank', 'top_hoodie', 'top_varsity', 'pants_jeans', 'pants_trunks', 'shoes_sneakers']);
const TOP_PARTS = { tee: ['top_tee', 'top_tee_sleeve'], tank: ['top_tank'], varsity: ['top_varsity', 'top_varsity_sleeve'], hoodie: ['top_hoodie', 'top_hoodie_sleeve'] };

/** Names of the person.glb meshes a look shows. Dark hair for medium and deep skin, brown for light; none under a cap. */
export function personParts(o) {
  const parts = ['skin', 'eyes', 'brows', 'lashes', o.bottoms === 'trunks' ? 'pants_trunks' : 'pants_jeans', `shoes_${o.boots === 'sneakers' ? 'sneakers' : 'timbs'}`, ...(TOP_PARTS[o.topStyle] ?? TOP_PARTS.tee)];
  if (!o.cap) parts.push(o.skin === 'light' ? 'hair_short02' : 'hair_short01');
  return parts;
}

/** The colour (hex) a tinted person mesh gets from the look, or null for an untinted one. */
export function personTint(name, o) {
  if (name === 'pants_jeans') return o.jeans;
  if (name === 'pants_trunks') return o.trunks;
  if (name === 'shoes_sneakers') return '#ececea';
  if (name === 'top_varsity_sleeve') return o.sleeve ?? o.top;
  if (TINTED.has(name) || /^top_.*_sleeve$/.test(name)) return o.top;
  return null;
}

/**
 * How far a fighter's build leans toward the lean or heavy body (0..1 each, never both): power against the mean of speed
 * and stamina, a 30-point gap being the full shift. Even stats keep the balanced body. Render-only, from the stats both
 * sides already share, so nothing extra travels in P2P.
 */
export function physiqueOf(stats) {
  const n = (x) => Math.min(100, Math.max(0, Number(x) || 0));
  const d = Math.min(1, Math.max(-1, (n(stats?.power) - (n(stats?.speed) + n(stats?.stamina)) / 2) / 30));
  return { lean: d < 0 ? -d : 0, heavy: d > 0 ? d : 0 };
}

export class ModelBoxer {
  constructor(B, scene, assets, corner, shadow, colors) {
    this.B = B; this.corner = corner;
    const person = !!assets.person;
    const tone = colors.outfit?.skin ?? (corner === 'red' ? 'light' : 'deep');
    // Quaternius model: its own texture is the deep tone; light and medium use the light texture (medium tinted in paintOutfit).
    const skin = tone === 'deep' ? null : assets.skinLight;
    this.rig = new ModelRig(B, scene, assets, corner);
    // The rest of the arena uses standard materials and has no environment map, so the PBR skin would come out near
    // black. Rebuild it as a standard material from the same textures, with the look's skin tone.
    const lookOutfit = colors.outfit ?? PHOTO_OUTFITS[corner];
    const shown = person ? new Set(personParts(lookOutfit)) : null;
    for (const m of this.rig.meshes) {
      const pbr = m.material;
      const part = m.name.slice(corner.length + 1);
      if (person) m.setEnabled(shown.has(part));
      if (person && part === 'pants_trunks' && !pbr?.albedoTexture) {   // the flat trunks are exported as a plain colour, no texture
        const flat = new B.StandardMaterial(`${pbr.name}-${corner}`, scene);
        flat.diffuseColor = B.Color3.FromHexString(personTint(part, lookOutfit)); flat.specularColor = new B.Color3(0.12, 0.12, 0.12); flat.specularPower = 24;
        m.material = flat;
        continue;
      }
      if (!pbr?.albedoTexture) continue;
      const mat = new B.StandardMaterial(`${pbr.name}-${corner}`, scene);
      if (person) {
        mat.diffuseTexture = part === 'skin' ? assets.skins[tone] : pbr.albedoTexture;
        const hex = personTint(part, lookOutfit);
        if (hex) mat.diffuseColor = B.Color3.FromHexString(hex).scale(1 / GREY_MEAN);
        if (pbr.transparencyMode === B.Material.MATERIAL_ALPHATEST) {
          mat.diffuseTexture.hasAlpha = true; mat.useAlphaFromDiffuseTexture = true;
          mat.transparencyMode = B.Material.MATERIAL_ALPHATEST; mat.alphaCutOff = pbr.alphaCutOff ?? 0.5; mat.backFaceCulling = false;
        }
      } else mat.diffuseTexture = /Superhero/.test(pbr.name) && skin ? skin : pbr.albedoTexture;
      if (pbr.bumpTexture) { mat.bumpTexture = pbr.bumpTexture; mat.invertNormalMapX = pbr.invertNormalMapX; mat.invertNormalMapY = pbr.invertNormalMapY; }
      mat.specularColor = new B.Color3(0.08, 0.07, 0.07); mat.specularPower = /Eyes|eyes/.test(pbr.name) ? 96 : 20;
      m.material = mat;
    }
    this.setPhysique(colors.physique);
    if (person) this.rig.standOn(this.rig.meshes.find((m) => m.isEnabled() && /^shoes_/.test(m.name.slice(corner.length + 1))));
    for (const m of this.rig.meshes) { shadow.addShadowCaster(m); m.receiveShadows = true; }

    // Street clothes (colors.outfit): painted onto the body texture; the trunks give way to jeans.
    const outfit = colors.outfit ?? null;
    this.outfit = outfit;
    if (outfit && !person) {
      const body = this.rig.meshes.find((m) => /Superhero/.test(m.material?.name ?? ''));
      if (body) {
        if (body.material.bumpTexture) body.material.bumpTexture.level = 0.5;
        // Kept so the character preview can dispose the painted texture when it swaps looks.
        this.painted = paintOutfit(B, scene, body, body.material.diffuseTexture, outfit)
          .then((tex) => { body.material.diffuseTexture = tex; return tex; })
          .catch((err) => { console.warn('outfit paint failed, keeping skin:', err); return null; });
      }
    }

    const mat = (name, hex, spec = 0.06) => {
      const m = new B.StandardMaterial(`${name}-${corner}`, scene);
      m.diffuseColor = B.Color3.FromHexString(hex); m.specularColor = new B.Color3(spec, spec, spec); m.specularPower = 48;
      return m;
    };
    // Street gear (colors.wraps): taped fists instead of gloves, low sneakers instead of high-top boots.
    const wraps = !!colors.wraps;   // false in a sanctioned fight: padded gloves
    const wrapCol = outfit?.wraps ?? colors.glove;
    const glove = mat('glove', wrapCol, wraps ? 0.04 : 0.12), trunks = mat('trunks', colors.trunks, 0.06);
    const band = mat('band', wraps ? (outfit ? '#3a2a1e' : wrapCol) : '#f1f1f1', 0.05);
    const bootCol = outfit ? (outfit.boots === 'sneakers' ? '#ececea' : '#c89a5c') : wraps && corner === 'red' ? '#e9e9e6' : '#111318';
    const boot = mat('boot', bootCol, 0.05);
    const keep = (m, material) => { m.material = material; m.rotationQuaternion = new B.Quaternion(); shadow.addShadowCaster(m); return m; };
    this.extras = {
      gloveL: keep(B.MeshBuilder.CreateSphere('gloveL', { diameter: 1, segments: 14 }, scene), glove),
      gloveR: keep(B.MeshBuilder.CreateSphere('gloveR', { diameter: 1, segments: 14 }, scene), glove),
      cuffL: keep(B.MeshBuilder.CreateCylinder('cuffL', { height: 0.08, diameter: 0.1, tessellation: 14 }, scene), band),
      cuffR: keep(B.MeshBuilder.CreateCylinder('cuffR', { height: 0.08, diameter: 0.1, tessellation: 14 }, scene), band),
      trunks: keep(B.MeshBuilder.CreateCylinder('trunks', { height: 0.25, diameterTop: 0.33, diameterBottom: 0.38, tessellation: 24 }, scene), trunks),
      belt: keep(B.MeshBuilder.CreateTorus('belt', { diameter: 0.305, thickness: 0.04, tessellation: 24 }, scene), band),
      bootL: keep(B.MeshBuilder.CreateCapsule('bootL', { height: 0.3, radius: 0.062, tessellation: 14 }, scene), boot),
      bootR: keep(B.MeshBuilder.CreateCapsule('bootR', { height: 0.3, radius: 0.062, tessellation: 14 }, scene), boot),
      ankleL: keep(B.MeshBuilder.CreateCylinder('ankleL', { height: 1, diameterTop: 0.105, diameterBottom: 0.125, tessellation: 14 }, scene), boot),
      ankleR: keep(B.MeshBuilder.CreateCylinder('ankleR', { height: 1, diameterTop: 0.105, diameterBottom: 0.125, tessellation: 14 }, scene), boot),
    };
    const fist = wraps ? [0.095, 0.085, 0.115] : [0.14, 0.14, 0.17];
    this.extras.gloveL.scaling.set(...fist);
    this.extras.gloveR.scaling.set(...fist);
    if (wraps) for (const c of [this.extras.cuffL, this.extras.cuffR]) { c.scaling.set(0.82, 1.6, 0.82); c.material = glove; }
    this.collarH = outfit ? (outfit.boots === 'timbs' ? 0.17 : 0.07) : wraps ? 0.07 : 0.16;
    if (person) for (const k of ['trunks', 'belt', 'bootL', 'bootR', 'ankleL', 'ankleR']) this.extras[k].setEnabled(false);   // the person wears real jeans and shoes
    if (outfit) {
      // Jeans replace the trunks; the belt stays as a leather belt. A fitted cap and a gold chain if the outfit has them.
      this.extras.trunks.setEnabled(false);
      if (outfit.boots === 'timbs') for (const a of [this.extras.ankleL, this.extras.ankleR]) a.scaling.x = a.scaling.z = 1.12;
      if (outfit.cap) {
        const capM = mat('cap', outfit.cap, 0.03);
        this.extras.capDome = keep(B.MeshBuilder.CreateSphere('capDome', { diameter: 0.215, segments: 14, slice: 0.55 }, scene), capM);
        this.extras.capBrim = keep(B.MeshBuilder.CreateBox('capBrim', { width: 0.18, height: 0.012, depth: 0.12 }, scene), capM);
      }
      if (outfit.mouthguard) this.extras.mouth = keep(B.MeshBuilder.CreateBox('mouth', { width: MOUTH.w, height: MOUTH.h, depth: MOUTH.d }, scene), mat('mouthguard', '#f4f4f4', 0.2));
      if (outfit.chain) this.extras.chain = keep(B.MeshBuilder.CreateTorus('chain', { diameter: 0.2, thickness: 0.012, tessellation: 24 }, scene), mat('chain', '#d4a63a', 0.1));
    }

    // Render-side state only.
    this.lastPunch = null; this.retract = null;
    this.hitAnim = null; this.fw = null;
    this.fall = 0; this.knocked = false; this.koStart = null;
  }

  /** Blends the person's lean and heavy morph targets (see physiqueOf); balanced is the base mesh. No-op without morphs. */
  setPhysique(p) {
    const w = { lean: Math.min(1, Math.max(0, p?.lean ?? 0)), heavy: Math.min(1, Math.max(0, p?.heavy ?? 0)) };
    for (const m of this.rig.meshes) {
      const mgr = m.morphTargetManager;
      for (let i = 0; mgr && i < mgr.numTargets; i++) { const t = mgr.getTarget(i); if (t.name in w) t.influence = w[t.name]; }
    }
  }

  /** Captures the stance feet (offsets from the body, in its frame) so planting returns to the same stance. */
  initFootwork(body, f) {
    const rig = this.rig, r = v(f.z, 0, -f.x);
    rig.place(body, f); rig.applyLayers([{ ...STANCE, w: 1 }]);
    const inFrame = (p) => v(dot(sub(p, body), r), p.y, dot(sub(p, body), f));
    const homes = {}, toes = {}, ankleY = {};
    for (const [s, side] of [['l', -1], ['r', 1]]) {
      const a = inFrame(rig.pos(LEG[side].foot)), b = inFrame(rig.pos(LEG[side].ball));
      homes[s] = { x: a.x * STANCE_NARROW.x, z: a.z * STANCE_NARROW.z }; toes[s] = sub(b, a); ankleY[s] = a.y;
    }
    this.fw = new Footwork(homes); this.fwToes = toes; this.fwAnkleY = ankleY;
  }

  /** Locks planted feet to their world points with leg IK; `footSlip` is how far each planted ankle moved this frame. */
  plantFeet(body, f, me, w, dt, pivot = null, still = 0) {
    const rig = this.rig, r = v(f.z, 0, -f.x);
    const st = this.fw.update({ x: body.x, z: body.z }, { x: f.x, z: f.z }, { x: me.vx, z: me.vy }, dt, { still });
    this.fwStepping = !st.l.planted || !st.r.planted;
    this.footSlip = { l: 0, r: 0 };
    // Feet hold longer than the stance has slack for, so when the hips drift from them the knees bend (the hips sink) until
    // both legs reach: the body absorbs the drift instead of a foot slipping or stepping early.
    let need = 0;
    for (const [s, side] of [['l', -1], ['r', 1]]) {
      const L = LEG[side], hip = rig.pos(L.upper), R = len(sub(hip, rig.pos(L.lower))) + len(sub(rig.pos(L.lower), rig.pos(L.foot)));
      const F = st[s], dh = Math.hypot(hip.x - F.x, hip.z - F.z), up = hip.y - (this.fwAnkleY[s] + F.lift);
      need = Math.max(need, up - Math.sqrt(Math.max(0, (0.96 * R) ** 2 - dh * dh)));
    }
    if (need > 0) rig.drop(Math.min(0.22, need));
    for (const [s, side] of [['l', -1], ['r', 1]]) {
      const F = st[s], yaw = F.yaw + (pivot && pivot.foot === s ? pivot.yaw : 0), ff = v(Math.sin(yaw), 0, Math.cos(yaw)), fr = v(ff.z, 0, -ff.x), t = this.fwToes[s];
      const ankle = v(F.x, this.fwAnkleY[s] + F.lift, F.z);
      const toe = add(ankle, add(add(mul(fr, t.x), mul(UPV, t.y - 0.6 * F.lift)), mul(ff, t.z)));
      const pole = add(mul(f, 1), mul(r, side * 0.25));
      rig.plant(side, ankle, toe, pole, w);
      const now = rig.pos(LEG[side].foot);
      const prev = this.lastAnkle?.[s];
      if (prev && F.planted && this.wasPlanted?.[s]) this.footSlip[s] = Math.hypot(now.x - prev.x, now.z - prev.z);
      (this.lastAnkle ??= {})[s] = now; (this.wasPlanted ??= {})[s] = F.planted;
    }
  }

  hit(record) {
    if (record.outcome === 'blocked') return;
    if (record.outcome !== 'landed') return;
    const big = record.transferredJoules > 160;
    this.hitAnim = { clip: big ? HIT_CLIP.big : record.target === 'body' ? HIT_CLIP.body : HIT_CLIP.head, start: performance.now() / 1000, strength: clamp(record.transferredJoules / 140, 0.5, 1) };
  }

  pose(me, opp, tick, now, dt, time) {
    const B = this.B, rig = this.rig;
    // The sim's position is a bang-bang controller's output (it flips between radial and lateral every few ticks), so
    // nothing the body or feet do reads it raw: a critically damped low-pass, lag taken back out, drives them.
    const sm = (this.sm ??= new Smoother(12)).update({ x: me.x, z: me.y }, dt), mv = this.sm.v;
    const osm = (this.osm ??= new Smoother(12)).update({ x: opp.x, z: opp.y }, dt);
    const root = v(sm.x, 0, sm.z), oppRoot = v(osm.x, 0, osm.z);
    const f = norm(v(osm.x - sm.x, 0, osm.z - sm.z));
    const r = v(f.z, 0, -f.x);
    const gap = Math.hypot(osm.x - sm.x, osm.z - sm.z);
    const drift = (this.drift ??= new Drift(this.corner === 'red' ? 7 : 19));
    const D = (name, rate, lag = 0) => drift.at(name, time - lag, rate);
    const tired = 1 - me.gasRatio;
    const nowS = performance.now() / 1000;

    // Our punch: scrub its clip so the fist lands on the sim's arrive tick.
    const ap = me.activePunch;
    let punch = null;
    if (ap) {
      this.lastPunch = ap; this.retract = null;
      punch = { type: ap.type, k: clamp((tick - ap.launchTick) / Math.max(1, ap.arriveTick - ap.launchTick), 0, 1), back: 0 };
    } else if (this.lastPunch) {
      this.retract = { type: this.lastPunch.type, start: now }; this.lastPunch = null;
    }
    if (this.retract) {
      const back = clamp((now - this.retract.start) / 40, 0, 1);
      punch = { type: this.retract.type, k: 1, back };
      if (back >= 1) { this.retract = null; punch = null; }
    }

    // Their punch: block (tight guard) or slip (lean away).
    const theirs = opp.activePunch;
    let guardUp = 0, slip = 0, slipSide = 0;
    if (theirs) {
      const k = clamp((tick - theirs.launchTick) / Math.max(1, theirs.arriveTick - theirs.launchTick), 0, 1);
      if (theirs.outcome === 'blocked') guardUp = smooth(clamp((k - 0.25) / 0.5, 0, 1));
      else if (theirs.outcome === 'slipped') { slip = smooth(clamp((k - 0.3) / 0.6, 0, 1)); slipSide = (PUNCH_CLIP[theirs.type]?.side ?? 1) > 0 ? 1 : -1; }
      else guardUp = 0.25 * k;
    }

    // ── clip layers ──
    const layers = [{ ...STANCE, w: 1 }];
    const speed = Math.hypot(mv.x, mv.z);
    let lunge = 0;
    const pc = punch && PUNCH_CLIP[punch.type];
    if (pc) {
      const t = punch.back > 0 ? pc.impact + punch.back * (1 - pc.impact) : punch.k * pc.impact;
      layers.push({ clip: pc.clip, t, w: CLIP_WEIGHT[pc.clip] ?? 1 });
      // Close the distance a little at impact so long-range shots don't stop short (render only).
      const e = punch.back > 0 ? 1 - punch.back : smooth(punch.k);
      lunge = e * clamp(gap - 1.0, 0, 0.22);
    }
    if (pc?.as === 'body') layers.push({ clip: 'Crouch_Idle_Loop', t: 0.2, w: 0.35 * (punch.back > 0 ? 1 - punch.back : smooth(punch.k)) });
    // Street moves from the sim's snapshot (render-only): smoothed weights so shell, clinch and taunt ease in and out.
    const ac = me.action && !pc ? me.action : null;
    const aw = this.aw ??= { shell: 0, clinch: 0, taunt: 0 }, ak = 1 - Math.exp(-dt * 10);
    aw.shell += ((me.shell ? 1 : 0) - aw.shell) * ak;
    aw.clinch += ((me.clinch ? 1 : 0) - aw.clinch) * ak;
    aw.taunt += ((ac?.kind === 'taunt' ? 1 : 0) - aw.taunt) * ak;
    const quick = ac && ['shove', 'push_off', 'feint'].includes(ac.kind) ? Math.sin(Math.PI * clamp((tick - ac.startTick) / Math.max(1, ac.endTick - ac.startTick), 0, 1)) : 0;
    const shoving = ac && (ac.kind === 'shove' || ac.kind === 'push_off') ? quick : 0, feinting = ac?.kind === 'feint' ? quick : 0;
    lunge += 0.1 * shoving + 0.04 * feinting + 0.08 * aw.clinch;
    let hitW = 0;
    if (this.hitAnim) {
      const clip = rig.clips[this.hitAnim.clip], u = (nowS - this.hitAnim.start) / clip.seconds;
      if (u >= 1) this.hitAnim = null;
      else { hitW = Math.sin(Math.PI * Math.min(1, u * 1.4)) * this.hitAnim.strength; layers.push({ clip: this.hitAnim.clip, t: u, w: hitW }); }
    }
    let koW = 0;
    if (this.fall > 0 || this.knocked) {
      this.koStart ??= nowS;
      koW = clamp((nowS - this.koStart) / 0.15, 0, 1);
      layers.push({ clip: 'Death01', t: clamp((nowS - this.koStart) / rig.clips.Death01.seconds, 0, 1), w: koW });
    } else this.koStart = null;

    const slipOff = mul(r, slipSide * slip * 0.14);
    const body = add(add(root, slipOff), mul(f, lunge));
    if (!this.fw) this.initFootwork(body, f);
    // Punch weight transfer (render-only): the punching-side foot pivots toes toward the target, weight rocks onto the
    // lead leg, and body shots drop the knees.
    const pe = pc ? (punch.back > 0 ? 1 - punch.back : smooth(punch.k)) : 0;
    const pivot = pc && pc.as !== 'jab' ? { foot: pc.side > 0 ? 'r' : 'l', yaw: -pc.side * 0.7 * (pc.big ?? 1) * pe } : null;
    const rock = pc ? mul(r, -0.012 * pe * (pc.side > 0 ? 1 : -1)) : v(0, 0, 0);
    // Loose and alive, never twitchy: everything below is a slow, wide curve (under ~2 Hz). The hips lead, and each
    // segment above them lags the one below, so the shoulders and head follow and the gloves trail.
    const idle = 1 - clamp(pe * 1.4 + aw.shell + aw.clinch, 0, 1);
    const loose = 1 + 1.2 * tired, calm = 1 - 0.6 * clamp(speed / 1.2, 0, 1);
    const sway = add(mul(r, 0.022 * loose * calm * D('sx', 1.4)), mul(f, 0.014 * loose * calm * D('sf', 1.1)));
    // Weight transfer: onto the back foot while loading a punch or defending, onto the front foot as it lands, then an
    // overshoot back to guard from the spring.
    const k0 = punch ? (punch.back > 0 ? 1 : punch.k) : 0, antic = pc && k0 < 0.5 ? Math.sin(Math.PI * k0 / 0.5) : 0;
    this.shift ??= new Spring(0);
    const shiftNow = this.shift.update(0.035 * pe * (pc?.big ?? 1) - 0.02 * antic - 0.03 * guardUp - 0.025 * slip, dt, 18, 0.5);
    // Soft knees: the hips rise and fall with a slow bounce (~1.7 Hz) and dip as a step lands (eased, not toggled).
    this.dip ??= new Spring(0);
    const dip = this.dip.update(this.fwStepping ? 1 : 0, dt, 12, 1);
    const bob = -KNEE_BEND - 0.012 * dip + (0.011 * Math.sin(time * 10.7 + (this.corner === 'red' ? 0 : 2.1)) + 0.007 * D('by', 0.8)) * calm * idle * (1 - 0.5 * tired)
      - (pc?.as === 'body' ? 0.05 * pe : 0) - 0.05 * aw.shell - 0.02 * aw.taunt;
    // Start/stop/turn: the body leans into a change of velocity (smoothed acceleration), so a start drives forward and a stop rocks back.
    const lv = this.lastVel ?? { x: mv.x, z: mv.z };
    const k = 1 - Math.exp(-dt * 8), ax = (mv.x - lv.x) / Math.max(dt, 1e-3), az = (mv.z - lv.z) / Math.max(dt, 1e-3);
    this.lastVel = { x: lv.x + (mv.x - lv.x) * k, z: lv.z + (mv.z - lv.z) * k };
    const acc = this.accLean ?? { x: 0, z: 0 };
    acc.x += (clamp(ax, -6, 6) - acc.x) * k; acc.z += (clamp(az, -6, 6) - acc.z) * k; this.accLean = acc;
    const leanOff = v(clamp(acc.x * 0.006, -0.03, 0.03), 0, clamp(acc.z * 0.006, -0.03, 0.03));
    rig.place(add(add(add(add(add(body, rock), sway), leanOff), mul(f, shiftNow)), v(0, bob, 0)), f);
    rig.applyLayers(layers);
    // Torso: slow roll and rock per segment (each lagging the one below), the chin tucked, then shoulders rolling and the
    // hips leading the punch twist with the shoulders a beat behind.
    const L = idle * loose * (1 - 0.7 * koW), lag = (i) => 0.17 * i;
    const torso = {
      side: [0.012, 0.022, 0.03, 0.034, 0.04].map((a, i) => a * L * D('roll', 1.1, lag(i))),
      fore: [0.01, 0.015, 0.02, 0.025, 0.03].map((a, i) => a * L * D('rock', 0.9, lag(i))).map((x, i) => x + (i === 4 ? 0.07 : i === 3 ? 0.03 : 0) * (1 - koW)),
    };
    rig.straighten(f, STRAIGHT * (1 - 0.7 * koW), SPINE_LEAN, torso);
    this.shSpring ??= new Spring(0);
    const pSh = this.shSpring.update(pe, dt, 14, 0.7);
    const side = pc ? pc.side : 0;
    const roll = 0.1 * L * D('twist', 1.0, 0.3) + 0.07 * L * D('shoulder', 1.6, 0.5);
    rig.twist('pelvis', 'spine_01', -side * 0.2 * pe * (pc?.big ?? 1));
    rig.twist('spine_02', 'spine_03', roll - side * 0.22 * pSh * (pc?.big ?? 1));
    this.plantFeet(body, f, { vx: mv.x, vy: mv.z }, 1 - (this.fall > 0 || this.knocked ? 1 : 0), dt, pivot, pc ? 1 : Math.max(aw.shell, aw.clinch, aw.taunt));

    // ── arm IK on top of the clips ──
    const ikW = 1 - koW;
    if (ikW > 0) {
      const headNow = rig.pos('Head');
      const local = (o) => add(add(add(headNow, mul(r, o.x)), mul(UPV, o.y)), mul(f, o.z));
      const pole = (side) => add(add(mul(UPV, -1), mul(r, side * 0.5)), mul(f, -0.2));
      for (const side of [-1, 1]) {
        const g = GUARD[side];
        const gl = local({
          x: g.x * (1 - 0.5 * guardUp) + slipSide * slip * 0.14 + 0.014 * L * D('gx' + side, 1.5, 0.35),
          y: g.y + 0.06 * guardUp - 0.12 * tired + 0.014 * L * D('gy' + side, 1.9, 0.35),
          z: (g.z - 0.06 * guardUp) * (0.55 + 0.45 * clamp((gap - 0.55) / 0.5, 0, 1)) + 0.012 * L * D('gz' + side, 1.3, 0.35),
        });
        // The gloves trail the head a little and overshoot when they come back to guard.
        const gs = (this.gSpring ??= {})[side] ??= [new Spring(gl.x), new Spring(gl.y), new Spring(gl.z)];
        const guard = v(gs[0].update(gl.x, dt, 15, 0.65), gs[1].update(gl.y, dt, 15, 0.65), gs[2].update(gl.z, dt, 15, 0.65));
        let target = guard, w = (1 - 0.6 * hitW) * ikW;
        if (!pc) {
          const chest = add(add(oppRoot, mul(UPV, 1.3)), mul(f, -0.2));
          const cover = local({ x: side * 0.07, y: 0.03, z: 0.14 });
          const open = local({ x: side * 0.4, y: -0.02, z: 0.05 });
          const wrap = add(add(add(oppRoot, mul(UPV, 1.38)), mul(f, 0.1)), mul(r, side * 0.22));
          target = lerpV(target, cover, aw.shell);
          target = lerpV(target, open, aw.taunt);
          target = lerpV(target, wrap, aw.clinch);
          target = lerpV(target, chest, shoving);
          if (side === -1 && feinting) target = add(target, add(mul(f, 0.18 * feinting), mul(UPV, 0.05 * feinting)));
        }
        if (pc && pc.side === side) {
          const e = punch.back > 0 ? 1 - smooth(punch.back) : smooth(clamp((punch.k - 0.25) / 0.75, 0, 1));
          const head = add(add(oppRoot, mul(UPV, 1.48)), mul(f, -0.1));
          const ribs = add(add(oppRoot, mul(UPV, 1.08)), mul(f, -0.12));
          if (pc.as === 'uppercut') {
            const ctrl = add(add(rig.pos(ARM[side].upper), mul(f, 0.1)), mul(UPV, -0.4));
            target = bez2(guard, ctrl, add(head, mul(UPV, -0.1)), e);
          } else if (pc.as === 'body') {
            const ctrl = add(add(rig.pos(ARM[side].upper), mul(r, side * 0.3)), mul(UPV, -0.3));
            target = bez2(guard, ctrl, ribs, e);
          } else if (pc.as === 'hook') {
            // Round the side with the elbow up and out, into the side of the head.
            const ctrl = add(add(rig.pos(ARM[side].upper), mul(r, side * 0.45 * (pc.big ?? 1) * (1 + 0.5 * tired))), mul(f, 0.2));
            target = bez2(guard, ctrl, add(head, mul(r, side * 0.08)), e);
            rig.reach(side, target, add(mul(r, side), mul(UPV, 0.8)), ikW);
            continue;
          } else {
            // The clip throws the punch; IK only pulls it onto the target near impact.
            target = head; w = ikW * Math.pow(e, 3);
          }
        }
        rig.reach(side, target, pole(side), w);
      }
    }

    // ── gear: gloves on the hands, trunks on the hips, boots on the feet ──
    const X = this.extras;
    const gearOn = (gloveMesh, cuff, side) => {
      const a = ARM[side], hand = rig.pos(a.hand), elbow = rig.pos(a.lower);
      const dir = norm(sub(hand, elbow));
      const c = add(hand, mul(dir, 0.06));
      gloveMesh.position.set(c.x, c.y, c.z);
      B.Quaternion.FromUnitVectorsToRef(new B.Vector3(0, 0, 1), new B.Vector3(dir.x, dir.y, dir.z), gloveMesh.rotationQuaternion);
      const cc = add(hand, mul(dir, -0.03));
      cuff.position.set(cc.x, cc.y, cc.z);
      B.Quaternion.FromUnitVectorsToRef(B.Vector3.UpReadOnly, new B.Vector3(dir.x, dir.y, dir.z), cuff.rotationQuaternion);
      return c;
    };
    const gloveL = gearOn(X.gloveL, X.cuffL, -1), gloveR = gearOn(X.gloveR, X.cuffR, 1);
    const pelvis = rig.pos('pelvis'), spine = rig.pos('spine_01');
    const up = norm(sub(spine, pelvis));
    const tr = add(pelvis, mul(up, -0.07)), bl = add(pelvis, mul(up, 0.065));
    X.trunks.position.set(tr.x, tr.y, tr.z); X.belt.position.set(bl.x, bl.y, bl.z);
    B.Quaternion.FromUnitVectorsToRef(B.Vector3.UpReadOnly, new B.Vector3(up.x, up.y, up.z), X.trunks.rotationQuaternion);
    X.belt.rotationQuaternion.copyFrom(X.trunks.rotationQuaternion);
    // High-top boots: a sole from heel to toes, and a collar up the shin.
    for (const [mesh, collar, foot, ball, calf] of [[X.bootL, X.ankleL, 'foot_l', 'ball_l', 'calf_l'], [X.bootR, X.ankleR, 'foot_r', 'ball_r', 'calf_r']]) {
      const a = rig.pos(foot), b = rig.pos(ball), d = norm(sub(b, a)), c = add(lerpV(a, b, 0.6), mul(UPV, -0.03));
      mesh.position.set(c.x, c.y, c.z);
      B.Quaternion.FromUnitVectorsToRef(B.Vector3.UpReadOnly, new B.Vector3(d.x, d.y, d.z), mesh.rotationQuaternion);
      const shin = norm(sub(rig.pos(calf), a)), top = add(a, mul(shin, this.collarH)), mid = lerpV(a, top, 0.5);
      collar.position.set(mid.x, mid.y, mid.z); collar.scaling.y = this.collarH;
      B.Quaternion.FromUnitVectorsToRef(B.Vector3.UpReadOnly, new B.Vector3(shin.x, shin.y, shin.z), collar.rotationQuaternion);
    }

    // Cap and chain ride on a head/neck frame: up along the neck, right across the shoulders, forward out of the face.
    if (X.capDome || X.chain || X.mouth) {
      const head = rig.pos('Head'), neckP = rig.pos('neck_01');
      const hu = norm(sub(head, neckP)), across = norm(sub(rig.pos('upperarm_r'), rig.pos('upperarm_l')));
      const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
      const fwd = norm(cross(across, hu)), side = cross(hu, fwd);
      const frame = (f) => B.Quaternion.RotationQuaternionFromAxis(new B.Vector3(side.x * f, side.y * f, side.z * f), new B.Vector3(hu.x, hu.y, hu.z), new B.Vector3(fwd.x * f, fwd.y * f, fwd.z * f));
      if (X.capDome) {
        const f = this.outfit.capBackwards ? -1 : 1;
        const c = add(head, add(mul(hu, CAP.up), mul(fwd, CAP.fwd)));
        X.capDome.position.set(c.x, c.y, c.z); X.capDome.rotationQuaternion.copyFrom(frame(f));
        const b = add(c, add(mul(fwd, f * CAP.brim), mul(hu, -0.005)));
        X.capBrim.position.set(b.x, b.y, b.z); X.capBrim.rotationQuaternion.copyFrom(frame(f));
      }
      if (X.mouth) {
        const c = add(head, add(mul(hu, MOUTH.up), mul(fwd, MOUTH.fwd)));
        X.mouth.position.set(c.x, c.y, c.z); X.mouth.rotationQuaternion.copyFrom(frame(1));
      }
      if (X.chain) {
        const c = add(neckP, add(mul(hu, -0.06), mul(fwd, 0.04)));
        X.chain.position.set(c.x, c.y, c.z);
        const tilt = norm(add(hu, mul(fwd, 0.45)));
        B.Quaternion.FromUnitVectorsToRef(B.Vector3.UpReadOnly, new B.Vector3(tilt.x, tilt.y, tilt.z), X.chain.rotationQuaternion);
      }
    }

    return { head: rig.pos('Head'), chest: rig.pos('spine_03'), gloveL, gloveR, hips: pelvis };
  }

  dispose() { this.rig.dispose(); for (const m of Object.values(this.extras)) m.dispose(); }
}

const UPV = v(0, 1, 0);
/** Hips drop this far below the clips' stance so planted legs have slack to reach and a step can land (m). */
const KNEE_BEND = 0.02;
/** The clips' stance is a wide squat; feet come in toward the body by these factors (shoulder-width, knees only slightly bent). */
const STANCE_NARROW = { x: 0.78, z: 0.82 };
/** Forward lean from vertical of pelvis..neck_01 (rad) in the guard, and how fully the clips' torso is pulled to it. */
const SPINE_LEAN = [0.06, 0.08, 0.1, 0.12, 0.12];
const STRAIGHT = 1;
/** Where the cap sits relative to the Head bone (metres along the head frame), tuned by eye. */
const CAP = { up: 0.105, fwd: 0.01, brim: 0.13 };
/** The mouthguard's size and place on the head frame (metres). */
const MOUTH = { w: 0.05, h: 0.011, d: 0.012, up: -0.035, fwd: 0.095 };
const smooth = (t) => t * t * (3 - 2 * t);
const lerpV = (a, b, t) => add(a, mul(sub(b, a), t));
const bez2 = (a, b, c, t) => lerpV(lerpV(a, b, t), lerpV(b, c, t), t);
