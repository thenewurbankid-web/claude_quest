// Compresses the MPFB build (scripts/build-mpfb-boxer.py) into public/boxing/models/person.glb and the skin textures.
//   node scripts/build-mpfb-models.mjs
// Textures go to webp, normal maps are dropped (the game doesn't use them), hair and brows become alpha-tested so they
// sort right, and the game gets person.glb plus person_skin_<tone>.webp for the tone swap.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

const BUILD = path.join(import.meta.dirname, '..', 'assets-src', 'build', 'mpfb');
const OUT = path.join(import.meta.dirname, '..', 'public', 'boxing', 'models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(BUILD, 'person_raw.glb'));

for (const m of doc.getRoot().listMaterials()) {
  m.setNormalTexture(null);
  if (/^(hair|brows|lashes)/.test(m.getName())) m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  else m.setAlphaMode('OPAQUE');
  m.setMetallicFactor(0).setRoughnessFactor(0.9);
}
const size = (re, px) => textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: re, resize: [px, px], quality: 84 });
await doc.transform(
  prune(), dedup(),
  size(/^(top_|pants|shoes_timbs|shoes_sneakers|short|brown|BootsAnkleM)/, 1024),
  size(/^(young|eye|brow)/, 1024),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 84 }),
  prune(),
);
await io.write(path.join(OUT, 'person.glb'), doc);

for (const tone of ['light', 'medium', 'deep']) {
  const src = fs.readFileSync(path.join(BUILD, `skin_${tone}.path`), 'utf8').trim();
  await sharp(src).resize(1024, 1024).webp({ quality: 88 }).toFile(path.join(OUT, `person_skin_${tone}.webp`));
}
for (const f of ['person.glb', 'person_skin_light.webp', 'person_skin_medium.webp', 'person_skin_deep.webp']) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2), 'MB');
