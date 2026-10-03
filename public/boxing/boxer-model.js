/**
 * Boxing Manager AI: the rigged boxer for the 3D view (Quaternius CC0 character and clips, see models/CREDITS.md).
 *
 * We don't let Babylon play the clips. Each frame we sample them ourselves (Animation.evaluate) and blend per bone, so a
 * punch clip can be scrubbed to the sim's launch → arrive ticks and hit exactly when the sim says the fist lands. On top
 * of the clips, two-bone IK on the real arm bones puts the gloves where the pose logic wants them (guard, uppercut,
 * body shot), since the free clips have no boxing guard, uppercut or body shot.
 */
import { v, add, sub, mul, len, norm, clamp, solveTwoBone } from './pose-math.js';

const LOADER_SRC = '/vendor/babylonjs-loaders/babylon.glTF2FileLoader.min.js';
let loaderPromise = null;

function loadGltfLoader(B) {
  if (B.SceneLoader.IsPluginForExtensionAvailable?.('.glb')) return Promise.resolve();
  loaderPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LOADER_SRC; s.onload = resolve;
    s.onerror = () => { loaderPromise = null; reject(new Error(`could not load ${LOADER_SRC}`)); };
    document.head.appendChild(s);
  });
  return loaderPromise;
}

/** Loads boxer.glb and anims.glb once per scene into asset containers. */
export async function loadBoxerAssets(B, scene, base = '/boxing/models/') {
  await loadGltfLoader(B);
  const [boxer, anims] = await Promise.all([
    B.SceneLoader.LoadAssetContainerAsync(base, 'boxer.glb', scene),
    B.SceneLoader.LoadAssetContainerAsync(base, 'anims.glb', scene),
  ]);
  for (const g of anims.animationGroups) g.stop();
  const skinLight = new B.Texture(base + 'skin_light.webp', scene, false, false);
  return { boxer, anims, skinLight };
}

const ARM = {
  [-1]: { upper: 'upperarm_l', lower: 'lowerarm_l', hand: 'hand_l' },
  [1]: { upper: 'upperarm_r', lower: 'lowerarm_r', hand: 'hand_r' },
};

/** One instanced character with a clip mixer and arm IK. */
export class ModelRig {
  constructor(B, scene, assets, tag) {
    this.B = B;
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
  }

  /** Stands the rig at `pos` (ground point) facing unit `forward` (both {x,y,z}). */
  place(pos, forward) {
    this.holder.position.set(pos.x, pos.y, pos.z);
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
      node.position.copyFrom(p ?? rest.p);
    }
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
    const delta = new B.Matrix();
    const dq = new B.Quaternion();
    B.Quaternion.FromUnitVectorsToRef(d0, d1, dq);
    B.Matrix.FromQuaternionToRef(dq, delta);
    // world' = world · delta (row vectors). local' = world' · parentWorld⁻¹. Keep the local translation and scale.
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
  jab: { clip: 'Punch_Jab', impact: 0.25, side: -1 },
  cross: { clip: 'Punch_Cross', impact: 0.3, side: 1 },
  hook: { clip: 'Melee_Hook', impact: 0.425, side: -1 },
  uppercut: { clip: 'Punch_Cross', impact: 0.3, side: 1 },     // no free uppercut: cross body, IK arm on an upward path
  body: { clip: 'Melee_Hook', impact: 0.425, side: -1 },        // no free body shot: hook body, IK arm to the ribs
};
const STANCE = { clip: 'Punch_Jab', t: 0 };                       // the jab's first frame is a good orthodox guard
// Guard hand positions relative to the head bone, in the boxer's own frame (x right, y up, z forward), measured on the
// stance frame. Relative to the head so the guard follows the body down when a clip crouches.
const GUARD = { [-1]: { x: -0.13, y: -0.04, z: 0.26 }, [1]: { x: 0.18, y: -0.08, z: 0.1 } };
// The free hook clip is a deep lunging melee swing; only part of it reads as a boxing hook.
const CLIP_WEIGHT = { Melee_Hook: 0.5 };
const HIT_CLIP = { head: 'Hit_Head', body: 'Hit_Chest', big: 'Hit_Knockback' };

export class ModelBoxer {
  constructor(B, scene, assets, corner, shadow, colors) {
    this.B = B; this.corner = corner;
    const skin = corner === 'red' ? assets.skinLight : null;
    this.rig = new ModelRig(B, scene, assets, corner);
    // The rest of the arena uses standard materials and has no environment map, so the PBR skin would come out near
    // black. Rebuild it as a standard material from the same textures; the red corner gets the light skin.
    for (const m of this.rig.meshes) {
      const pbr = m.material;
      if (!pbr?.albedoTexture) continue;
      const mat = new B.StandardMaterial(`${pbr.name}-${corner}`, scene);
      mat.diffuseTexture = /Superhero/.test(pbr.name) && skin ? skin : pbr.albedoTexture;
      if (pbr.bumpTexture) { mat.bumpTexture = pbr.bumpTexture; mat.invertNormalMapX = pbr.invertNormalMapX; mat.invertNormalMapY = pbr.invertNormalMapY; }
      mat.specularColor = new B.Color3(0.18, 0.16, 0.15); mat.specularPower = /Eyes/.test(pbr.name) ? 96 : 20;
      if (/Superhero/.test(pbr.name) && colors.sheen) { mat.specularColor = new B.Color3(0.24, 0.22, 0.2); mat.specularPower = 36; colors.sheen(mat, 0.05, 4); }
      m.material = mat;
    }
    for (const m of this.rig.meshes) { shadow.addShadowCaster(m); m.receiveShadows = true; }

    const mat = (name, hex, spec = 0.3) => {
      const m = new B.StandardMaterial(`${name}-${corner}`, scene);
      m.diffuseColor = B.Color3.FromHexString(hex); m.specularColor = new B.Color3(spec, spec, spec); m.specularPower = 48;
      return m;
    };
    // Street gear (colors.wraps): taped fists instead of gloves, low sneakers instead of high-top boots.
    const wraps = !!colors.wraps;
    const glove = mat('glove', colors.glove, wraps ? 0.08 : 0.6), trunks = mat('trunks', colors.trunks, 0.35);
    const band = mat('band', wraps ? colors.glove : '#f1f1f1', 0.2), boot = mat('boot', wraps && corner === 'red' ? '#e9e9e6' : '#111318', 0.3);
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
    if (wraps) for (const c of [this.extras.cuffL, this.extras.cuffR]) c.scaling.set(0.82, 1.6, 0.82);
    this.collarH = wraps ? 0.07 : 0.16;

    // Render-side state only.
    this.lastPunch = null; this.retract = null;
    this.hitAnim = null; this.walkPhase = 0;
    this.fall = 0; this.knocked = false; this.koStart = null;
  }

  hit(record) {
    if (record.outcome === 'blocked') return;
    if (record.outcome !== 'landed') return;
    const big = record.transferredJoules > 160;
    this.hitAnim = { clip: big ? HIT_CLIP.big : record.target === 'body' ? HIT_CLIP.body : HIT_CLIP.head, start: performance.now() / 1000, strength: clamp(record.transferredJoules / 140, 0.5, 1) };
  }

  pose(me, opp, tick, now, dt, time) {
    const B = this.B, rig = this.rig;
    const root = v(me.x, 0, me.y), oppRoot = v(opp.x, 0, opp.y);
    const f = norm(v(opp.x - me.x, 0, opp.y - me.y));
    const r = v(f.z, 0, -f.x);
    const gap = Math.hypot(opp.x - me.x, opp.y - me.y);
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
      else if (theirs.outcome === 'slipped') { slip = smooth(clamp((k - 0.3) / 0.6, 0, 1)); slipSide = PUNCH_CLIP[theirs.type].side > 0 ? 1 : -1; }
      else guardUp = 0.25 * k;
    }

    // ── clip layers ──
    const layers = [{ ...STANCE, w: 1 }];
    const speed = Math.hypot(me.vx, me.vy);
    if (speed > 0.05) {
      this.walkPhase = (this.walkPhase + (speed * dt) / 1.1) % 1;
      layers.push({ clip: 'Walk_Loop', t: this.walkPhase, w: clamp(speed / 1.6, 0, 0.45) });
    }
    let lunge = 0;
    const pc = punch && PUNCH_CLIP[punch.type];
    if (pc) {
      const t = punch.back > 0 ? pc.impact + punch.back * (1 - pc.impact) : punch.k * pc.impact;
      layers.push({ clip: pc.clip, t, w: CLIP_WEIGHT[pc.clip] ?? 1 });
      // Close the distance a little at impact so long-range shots don't stop short (render only).
      const e = punch.back > 0 ? 1 - punch.back : smooth(punch.k);
      lunge = e * clamp(gap - 1.0, 0, 0.22);
    }
    if (punch?.type === 'body') layers.push({ clip: 'Crouch_Idle_Loop', t: 0.2, w: 0.35 * (punch.back > 0 ? 1 - punch.back : smooth(punch.k)) });
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
    rig.place(add(add(root, slipOff), mul(f, lunge)), f);
    rig.applyLayers(layers);

    // ── arm IK on top of the clips ──
    const ikW = 1 - koW;
    if (ikW > 0) {
      const headNow = rig.pos('Head');
      const local = (o) => add(add(add(headNow, mul(r, o.x)), mul(UPV, o.y)), mul(f, o.z));
      const pole = (side) => add(add(mul(UPV, -1), mul(r, side * 0.5)), mul(f, -0.2));
      for (const side of [-1, 1]) {
        const g = GUARD[side];
        const guard = local({
          x: g.x * (1 - 0.5 * guardUp) + slipSide * slip * 0.14,
          y: g.y + 0.06 * guardUp - 0.12 * tired,
          z: (g.z - 0.06 * guardUp) * (0.55 + 0.45 * clamp((gap - 0.55) / 0.5, 0, 1)),
        });
        let target = guard, w = (1 - 0.6 * hitW) * ikW;
        if (pc && pc.side === side) {
          const e = punch.back > 0 ? 1 - smooth(punch.back) : smooth(clamp((punch.k - 0.25) / 0.75, 0, 1));
          const head = add(add(oppRoot, mul(UPV, 1.48)), mul(f, -0.1));
          const ribs = add(add(oppRoot, mul(UPV, 1.08)), mul(f, -0.12));
          if (punch.type === 'uppercut') {
            const ctrl = add(add(rig.pos(ARM[side].upper), mul(f, 0.1)), mul(UPV, -0.4));
            target = bez2(guard, ctrl, add(head, mul(UPV, -0.1)), e);
          } else if (punch.type === 'body') {
            const ctrl = add(add(rig.pos(ARM[side].upper), mul(r, side * 0.3)), mul(UPV, -0.3));
            target = bez2(guard, ctrl, ribs, e);
          } else if (punch.type === 'hook') {
            // Round the side with the elbow up and out, into the side of the head.
            const ctrl = add(add(rig.pos(ARM[side].upper), mul(r, side * 0.45)), mul(f, 0.2));
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

    return { head: rig.pos('Head'), chest: rig.pos('spine_03'), gloveL, gloveR, hips: pelvis };
  }

  dispose() { this.rig.dispose(); for (const m of Object.values(this.extras)) m.dispose(); }
}

const UPV = v(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const lerpV = (a, b, t) => add(a, mul(sub(b, a), t));
const bez2 = (a, b, c, t) => lerpV(lerpV(a, b, t), lerpV(b, c, t), t);
