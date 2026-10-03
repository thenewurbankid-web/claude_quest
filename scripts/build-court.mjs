// Compresses the Blender bake (scripts/bake-court.py → assets-src/build/court_raw.glb) into the file the 3D view loads:
//   node scripts/build-court.mjs
// Writes public/boxing/models/court.glb (WebP textures: albedo at most 512 px, lightmaps at full size; positions,
// normals and vertex colours quantized with KHR_mesh_quantization, which Babylon reads without a decoder) and
// court_sky.webp (the overcast HDRI, tone-mapped, for the sky dome).
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, quantize, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

const ROOT = path.join(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'assets-src', 'build');
const OUT = path.join(ROOT, 'public', 'boxing', 'models');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(BUILD, 'court_raw.glb'));
// Nothing in the court is specular (the materials become unlit StandardMaterials), so drop the exporter's specular extension.
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_specular') ext.dispose();
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [512, 512], quality: 82 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^emissive/, quality: 86 }),
  weld(),
  quantize({ pattern: /^(POSITION|NORMAL|COLOR_0)$/, quantizePosition: 16, quantizeNormal: 10, quantizeColor: 8 }),
  dedup(),
  prune({ keepLeaves: true }),       // keep the `court_info` empty: its extras carry the lightmap level
);
fs.mkdirSync(OUT, { recursive: true });
await io.write(path.join(OUT, 'court.glb'), doc);
await sharp(path.join(BUILD, 'sky.png')).webp({ quality: 80 }).toFile(path.join(OUT, 'court_sky.webp'));

const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log(`court.glb ${kb('court.glb')}, court_sky.webp ${kb('court_sky.webp')}`);
for (const t of doc.getRoot().listTextures()) console.log(' ', t.getName(), t.getSize()?.join('×'), (t.getImage().byteLength / 1024).toFixed(0) + ' KB');
