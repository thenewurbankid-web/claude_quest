// Prints the idle stance's spine/pelvis/head lean and twist, and shoulder/hip level, in NullEngine (no browser).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const req = createRequire(import.meta.url);
const B = req('babylonjs'); req('babylonjs-loaders');
const { ModelBoxer, PHOTO_OUTFITS } = await import('../public/boxing/boxer-model.js');
export async function world() {
  const scene = new B.Scene(new B.NullEngine());
  const load = (f) => B.SceneLoader.LoadAssetContainerAsync('data:application/octet-stream;base64,' + fs.readFileSync(new URL(`../public/boxing/models/${f}`, import.meta.url)).toString('base64'), undefined, scene, undefined, '.glb');
  const anims = await load('anims.glb'); for (const g of anims.animationGroups) g.stop();
  const tex = () => new B.Texture('data:image/png;base64,iVBORw0KGgo=', scene);
  return { scene, person: { boxer: await load('person.glb'), anims, person: true, skins: { light: tex(), medium: tex(), deep: tex() } } };
}
const { scene, person } = await world();
const boxer = new ModelBoxer(B, scene, person, 'red', { addShadowCaster() {} }, { glove: '#c9343a', trunks: '#9e1c24', wraps: true, outfit: PHOTO_OUTFITS.red });
boxer.pose({ x: 0, y: 0, vx: 0, vy: 0, gasRatio: 1, activePunch: null }, { x: 0, y: 1.2, activePunch: null }, 0, 0, 1 / 60, 0);
const rig = boxer.rig, P = (n) => rig.pos(n);
const deg = (r) => +(r * 180 / Math.PI).toFixed(1);
// Fighter faces +z (towards opponent), his right is +x? report in world axes: x across, y up, z forward.
const ang = (a, b) => { const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }; return { side: deg(Math.atan2(d.x, d.y)), fore: deg(Math.atan2(d.z, d.y)) }; };
const yaw = (a, b) => deg(Math.atan2(b.z - a.z, b.x - a.x));
const out = {
  pelvis_to_spine03: ang(P('pelvis'), P('spine_03')), spine03_to_neck: ang(P('spine_03'), P('neck_01')), neck_to_head: ang(P('neck_01'), P('Head')),
  hipsLineYaw: yaw(P('thigh_l'), P('thigh_r')), shoulderLineYaw: yaw(P('upperarm_l'), P('upperarm_r')),
  hipsTiltDeg: deg(Math.atan2(P('thigh_r').y - P('thigh_l').y, P('thigh_r').x - P('thigh_l').x)),
  shouldersTiltDeg: deg(Math.atan2(P('upperarm_r').y - P('upperarm_l').y, P('upperarm_r').x - P('upperarm_l').x)),
  thighL: ang(P('thigh_l'), P('calf_l')), thighR: ang(P('thigh_r'), P('calf_r')), calfL: ang(P('calf_l'), P('foot_l')), calfR: ang(P('calf_r'), P('foot_r')),
  head: P('Head'), pelvis: P('pelvis'), footL: P('foot_l'), footR: P('foot_r'), handL: P('hand_l'), handR: P('hand_r'), elbL: P('lowerarm_l'), elbR: P('lowerarm_r'),
};
console.log(JSON.stringify(out, null, 1));
process.exit(0);
