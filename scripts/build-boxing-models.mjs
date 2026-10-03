// Builds the boxer assets for the 3D view from the free Quaternius packs (CC0), see public/boxing/models/CREDITS.md.
// Download and unzip the Standard versions of Universal Base Characters, Universal Animation Library and Universal
// Animation Library 2 into one folder, then run:
//   node scripts/build-boxing-models.mjs <folder with the unzipped packs>
// Writes public/boxing/models/boxer.glb (the character, textures at 1024 px), skin_light.webp (the light skin) and
// anims.glb (only the clips we use, on the same rig, no meshes).
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, resample } from '@gltf-transform/functions';
import sharp from 'sharp';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node scripts/build-boxing-models.mjs <folder with the unzipped packs>'); process.exit(1); }
const OUT = path.join(import.meta.dirname, '..', 'public', 'boxing', 'models');
fs.mkdirSync(OUT, { recursive: true });

const find = (re) => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (re.test(p)) hits.push(p); } };
  walk(SRC);
  if (!hits.length) throw new Error(`nothing matches ${re} under ${SRC}`);
  return hits[0];
};

// Clips by pack. Same skeleton (UE-style names: pelvis, spine_01…, upperarm_l…) as the base characters.
const KEEP = {
  ual1: ['Idle_Loop', 'Punch_Jab', 'Punch_Cross', 'Hit_Head', 'Hit_Chest', 'Death01', 'Walk_Loop', 'Jog_Fwd_Loop', 'Crouch_Idle_Loop'],
  ual2: ['Melee_Hook', 'Melee_Hook_Rec', 'Hit_Knockback', 'LayToIdle'],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// The character.
// The pack's .gltf names some images "<name>_png.png" while the files are "<name>.png"; point those at the real files.
const boxerSrc = find(/Godot - UE[/\\]Superhero_Male_FullBody\.gltf$/);
const json = JSON.parse(fs.readFileSync(boxerSrc, 'utf8'));
for (const img of json.images ?? []) {
  if (!fs.existsSync(path.join(path.dirname(boxerSrc), img.uri))) img.uri = img.uri.replace(/_png\.png$/, '.png');
}
const fixed = path.join(path.dirname(boxerSrc), '_fixed_' + path.basename(boxerSrc));
fs.writeFileSync(fixed, JSON.stringify(json));
const boxer = await io.read(fixed);
fs.rmSync(fixed);
await boxer.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }), dedup(), prune());
await io.write(path.join(OUT, 'boxer.glb'), boxer);

// The light skin (the .gltf uses the dark one), for the other corner.
await sharp(find(/Textures[/\\]T_Superhero_Male_Ligh\.png$/)).resize(1024, 1024).webp({ quality: 88 }).toFile(path.join(OUT, 'skin_light.webp'));

// The animations: merge both libraries' kept clips onto the first library's skeleton.
const lib1 = await io.read(find(/UAL1_Standard\.glb$/));
const lib2 = await io.read(find(/UAL2_Standard\.glb$/));
const root1 = lib1.getRoot();
const nodeByName = new Map(root1.listNodes().map((n) => [n.getName(), n]));
for (const a of root1.listAnimations()) if (!KEEP.ual1.includes(a.getName())) a.dispose();
const buffer = root1.listBuffers()[0];
for (const a of lib2.getRoot().listAnimations()) {
  if (!KEEP.ual2.includes(a.getName())) continue;
  const anim = lib1.createAnimation(a.getName());
  for (const ch of a.listChannels()) {
    const target = nodeByName.get(ch.getTargetNode()?.getName());
    if (!target) continue;
    const s = ch.getSampler();
    const copy = (acc) => lib1.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buffer);
    const sampler = lib1.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(lib1.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
}
// Fingers are hidden inside the gloves, so their channels are dead weight.
const FINGER = /^(index|middle|pinky|ring|thumb)_/;
for (const a of root1.listAnimations()) {
  for (const ch of a.listChannels()) if (FINGER.test(ch.getTargetNode()?.getName() ?? '')) ch.dispose();
}
// A disposed channel leaves its sampler (and keyframes) behind; drop samplers nothing uses.
for (const a of root1.listAnimations()) {
  const used = new Set(a.listChannels().map((ch) => ch.getSampler()));
  for (const sm of a.listSamplers()) if (!used.has(sm)) sm.dispose();
}
// Drop the mannequin mesh; the skeleton nodes stay as animation targets.
for (const n of root1.listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.setMesh(null); n.setSkin(null); }
for (const m of root1.listMaterials()) m.dispose();
for (const t of root1.listTextures()) t.dispose();
await lib1.transform(resample({ tolerance: 2e-4 }), prune({ keepLeaves: true }), dedup());
// Disposed animations leave their samplers alive in memory, so their keyframes would still be written. A round trip
// drops the samplers; then sweep the accessors nothing points at.
const animsOut = path.join(OUT, 'anims.glb');
await io.write(animsOut, lib1);
const clean = await io.read(animsOut);
for (const acc of clean.getRoot().listAccessors()) if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
await io.write(animsOut, clean);

for (const f of ['boxer.glb', 'anims.glb', 'skin_light.webp']) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2), 'MB');
console.log('clips:', lib1.getRoot().listAnimations().map((a) => a.getName()).join(', '));
