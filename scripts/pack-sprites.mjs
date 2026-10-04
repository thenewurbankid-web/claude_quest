// BOX-17: pack Cycles frames (assets-src/build/frames_{red,blue}/<clip>/NNN.png + meta.json) into one WebP atlas per
// clip and corner plus public/boxing/sprites2d/manifest.json. Every frame of a clip shares one crop box (union of alpha)
// so the compositor needs a single offset per clip. Usage: node scripts/pack-sprites.mjs [scale=0.75] [quality=82]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '..');
const SCALE = Number(process.argv[2] ?? 0.75);   // sprite px per render px
const QUALITY = Number(process.argv[3] ?? 82);
const COLS = 8;
const outDir = path.join(root, 'public/boxing/sprites2d');
fs.mkdirSync(outDir, { recursive: true });

const manifest = { scale: SCALE, corners: {} };
for (const corner of ['red', 'blue']) {
  const dir = path.join(root, 'assets-src/build', `frames_${corner}`);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const [W, H] = meta.size;
  const b = meta.border;
  const clips = {};
  for (const [name, c] of Object.entries(meta.clips)) {
    const files = Array.from({ length: c.frames }, (_, i) => path.join(dir, name, String(i).padStart(3, '0') + '.png'));
    const raws = [];
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, fw = 0, fh = 0;
    for (const f of files) {
      const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      fw = info.width; fh = info.height;
      raws.push(data);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        if (data[(y * fw + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const dw = Math.round(cw * SCALE), dh = Math.round(ch * SCALE);
    const rows = Math.ceil(c.frames / COLS);
    const cells = [];
    for (let i = 0; i < raws.length; i++) {
      const buf = await sharp(raws[i], { raw: { width: fw, height: fh, channels: 4 } })
        .extract({ left: x0, top: y0, width: cw, height: ch }).resize(dw, dh, { kernel: 'lanczos3' }).png().toBuffer();
      cells.push({ input: buf, left: (i % COLS) * dw, top: Math.floor(i / COLS) * dh });
    }
    const file = `${corner}_${name}.webp`;
    await sharp({ create: { width: dw * Math.min(COLS, c.frames), height: dh * rows, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(cells).webp({ quality: QUALITY, alphaQuality: 90, effort: 5 }).toFile(path.join(outDir, file));
    // sprite top-left in render-frame px: border origin + crop offset
    clips[name] = { file, frames: c.frames, fps: c.fps, impact: c.impact, loop: c.loop, cols: Math.min(COLS, c.frames), cw: dw, ch: dh,
      ox: Math.round(b.x0 * W) + x0, oy: Math.round((1 - b.y1) * H) + y0, rw: cw, rh: ch };
    console.log(corner, name, `${dw}x${dh} x${c.frames}`, (fs.statSync(path.join(outDir, file)).size / 1024).toFixed(0) + ' KB');
  }
  manifest.corners[corner] = { size: meta.size, clips };
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
const total = fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
console.log('total', (total / 1048576).toFixed(2), 'MB');
