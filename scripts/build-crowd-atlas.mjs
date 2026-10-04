// Packs assets-src/crowd/render/pNN_vK.png (from build-crowd-person.py) into textures/crowd_atlas.webp + crowd_atlas.json.
// Rows are people, columns the five views (front .. back, side views facing image-right); the renderer mirrors them for the other side.
//   node scripts/build-crowd-atlas.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
const SRC = new URL('../assets-src/crowd/render/', import.meta.url);
const DST = new URL('../public/boxing/textures/', import.meta.url);
const FW = 96, FH = 192, COLS = 5;
const { up, frameHeightM } = JSON.parse(readFileSync(new URL('people.json', SRC)));
const comps = [];
for (let r = 0; r < up.length; r++) for (let v = 0; v < COLS; v++) {
  const id = String(r).padStart(2, '0');
  const input = await sharp(new URL(`p${id}_v${v}.png`, SRC).pathname).resize(FW, FH, { kernel: 'lanczos3' }).png().toBuffer();
  comps.push({ input, left: v * FW, top: r * FH });
}
const out = new URL('crowd_atlas.webp', DST).pathname;
await sharp({ create: { width: FW * COLS, height: FH * up.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).webp({ quality: 72, alphaQuality: 85, effort: 6 }).toFile(out);
writeFileSync(new URL('crowd_atlas.json', DST), JSON.stringify({ cols: COLS, rows: up.length, frame: [FW, FH], aspect: FW / FH, frameHeightM, flip: 1, up }));
console.log(`${up.length} people -> ${out} ${(statSync(out).size / 1024).toFixed(0)} KB`);
