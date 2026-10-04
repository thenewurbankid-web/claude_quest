// Builds public/boxing/img/logo-ruckus-{640,1100}.webp: the "Bring The Ruckus" spray piece.
// Needs playwright-core + a Chromium (dev only, not a runtime dependency): node scripts/build-logo.mjs <path to playwright-core>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = createRequire(path.resolve(process.argv[2] || 'node_modules/playwright-core', '../x.js'))('playwright-core');
const FONT = pathToFileURL(path.join(root, 'scripts/fonts/SedgwickAveDisplay.ttf')).href;
const WALL = pathToFileURL(path.join(root, 'public/boxing/textures/brick_dirty_diff.webp')).href;

const page_fn = async ({ FONT, WALL }) => {
  const W = 1700, H = 1180;
  await new FontFace('Sedge', `url(${FONT})`).load().then(f => document.fonts.add(f));
  const wall = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = WALL; });
  let seed = 90210;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

  // 1. Letter mask: every glyph placed by hand-ish rules (own size, tilt, baseline, overlap), none repeats.
  const mask = mk(), m = mask.getContext('2d');
  const lines = [
    { text: 'BRING', size: 300, x: 80, y: 330, rise: -10, tilt: -2.6 },
    { text: 'THE', size: 220, x: 170, y: 610, rise: -8, tilt: -2 },
    { text: 'RUCKUS', size: 360, x: 90, y: 960, rise: -20, tilt: -2.8 },
  ];
  const boxes = [];
  for (const L of lines) {
    let x = L.x;
    [...L.text].forEach((ch, i) => {
      const s = L.size * (0.94 + rnd() * 0.12);
      m.font = `${s}px Sedge`;
      const w = m.measureText(ch).width;
      const rot = (L.tilt + (rnd() - 0.5) * 5) * Math.PI / 180;
      const y = L.y + i * L.rise + (rnd() - 0.5) * L.size * 0.09;
      m.save(); m.translate(x + w / 2, y); m.rotate(rot); m.scale(1 + (rnd() - 0.5) * 0.1, 1 + (rnd() - 0.5) * 0.12);
      m.fillStyle = m.strokeStyle = '#fff'; m.lineJoin = 'round'; m.lineWidth = s * (0.012 + rnd() * 0.01);
      m.textAlign = 'center'; m.textBaseline = 'alphabetic';
      m.strokeText(ch, 0, 0); m.fillText(ch, 0, 0); m.restore();
      boxes.push({ x0: x, x1: x + w, line: L.text });
      x += w * (0.97 + rnd() * 0.05);
    });
  }

  // 2. Drips: from a few chosen bottom edges, tapered with a bead at the tip.
  const md = m.getImageData(0, 0, W, H).data;
  const lowest = (cx) => { for (let y = H - 40; y > 0; y--) if (md[(y * W + cx) * 4 + 3] > 200) return y; return -1; };
  const picks = [[3, 'BRING'], [7, 'THE'], [10, 'RUCKUS'], [13, 'RUCKUS'], [15, 'RUCKUS']];
  const bi = Object.fromEntries(picks.map(([i, l]) => [i, l]));
  for (const [i] of picks) {
    const b = boxes[i]; if (!b) continue;
    for (let tries = 0; tries < 40; tries++) {
      const cx = Math.round(b.x0 + (b.x1 - b.x0) * (0.25 + rnd() * 0.5)), y0 = lowest(cx);
      if (y0 < 0 || y0 > H - 160) continue;
      const len = 50 + rnd() * 100, wd = 8 + rnd() * 4;
      const g = m.createLinearGradient(0, y0 - 6, 0, y0 + len); g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff');
      m.fillStyle = g; m.beginPath(); m.moveTo(cx - wd, y0 - 8); m.lineTo(cx - wd * 0.55, y0 + len * 0.8); m.lineTo(cx + wd * 0.55, y0 + len * 0.8); m.lineTo(cx + wd, y0 - 8); m.fill();
      m.beginPath(); m.ellipse(cx, y0 + len * 0.86, wd * 0.9, wd * 1.25, 0, 0, 7); m.fill(); break;
    }
  }
  void bi;

  // 3. Layers built from the mask: dark offset shadow, thin outline, paint fill.
  const tint = (src, color, dx, dy, r) => {
    const c = mk(), x = c.getContext('2d');
    for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; x.drawImage(src, dx + Math.cos(t) * r, dy + Math.sin(t) * r); }
    if (r === 0) x.drawImage(src, dx, dy);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, W, H); return c;
  };
  const shadow = tint(mask, '#000', 9, 12, 7), outline = tint(mask, '#8c8c8c', 0, 0, 3);

  const out = mk(), o = out.getContext('2d');
  o.filter = 'blur(10px)'; o.globalAlpha = 0.75; o.drawImage(shadow, 0, 0); o.filter = 'none'; o.globalAlpha = 0.9; o.drawImage(shadow, 0, 0); o.globalAlpha = 1;
  o.drawImage(outline, 0, 0);

  // 4. Paint pass: wall texture shows through, soft uneven coverage, crisp cap edge, overspray speckle.
  const tx = mk(), t = tx.getContext('2d'); // tiled, rotated wall photo
  t.translate(W / 2, H / 2); t.rotate(-0.06);
  for (let yy = -H; yy < H; yy += wall.height * 3.4) for (let xx = -W; xx < W; xx += wall.width * 3.4) t.drawImage(wall, xx, yy, wall.width * 3.4, wall.height * 3.4);
  const td = tx.getContext('2d').getImageData(0, 0, W, H).data;
  let mean = 0; for (let i = 0; i < td.length; i += 4 * 97) mean += (td[i] * 0.3 + td[i + 1] * 0.59 + td[i + 2] * 0.11); mean /= td.length / (4 * 97);
  const halo = mk(), h = halo.getContext('2d'); h.filter = 'blur(26px)'; h.drawImage(mask, 0, 0);
  const hd = h.getContext ? null : null; void hd;
  const haloD = halo.getContext('2d').getImageData(0, 0, W, H).data;
  const paint = o.createImageData(W, H), pd = paint.data;
  const vn = (x, y, f) => { const a = Math.floor(x / f), b = Math.floor(y / f); const h2 = (i, j) => { let n = Math.sin(i * 127.1 + j * 311.7 + 13.7) * 43758.5453; return n - Math.floor(n); }; const u = x / f - a, v = y / f - b; const s = (k) => k * k * (3 - 2 * k); return (h2(a, b) * (1 - s(u)) + h2(a + 1, b) * s(u)) * (1 - s(v)) + (h2(a, b + 1) * (1 - s(u)) + h2(a + 1, b + 1) * s(u)) * s(v); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, cov = md[i + 3] / 255, lum = (td[i] * 0.3 + td[i + 1] * 0.59 + td[i + 2] * 0.11 - mean) / 128;
    const soft = vn(x, y, 90) * 0.5 + vn(x, y, 23) * 0.3 + vn(x, y, 7) * 0.2;
    let a = 0, v = 0;
    if (cov > 0.02) {
      // pits where the wall is rough and where the can was moving fast
      a = cov * Math.min(1, Math.max(0, 0.93 + lum * 0.3 + (soft - 0.5) * 0.4 - (rnd() < 0.012 ? 0.5 : 0)));
      v = 248 + lum * 12 - (1 - soft) * 10;
    } else {
      const ov = haloD[i + 3] / 255;
      if (ov > 0.04 && rnd() < ov * ov * 0.9) { a = 0.25 + rnd() * 0.5; v = 240; }
    }
    pd[i] = pd[i + 1] = pd[i + 2] = Math.max(0, Math.min(255, v)); pd[i + 3] = a * 255;
  }
  const pc = mk(); pc.getContext('2d').putImageData(paint, 0, 0);
  o.globalAlpha = 0.42; o.filter = 'blur(2px)'; o.drawImage(pc, 0, 0); o.filter = 'none'; o.globalAlpha = 1; o.drawImage(pc, 0, 0);
  // fine paint grain on the whole piece
  return out.toDataURL('image/png');
};

const browser = await pw.chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const html = path.join(root, 'scripts', '.logo-build.html');
writeFileSync(html, '<!doctype html><meta charset=utf-8><body>');
await page.goto(pathToFileURL(html).href);
const data = await page.evaluate(`(${page_fn.toString()})(${JSON.stringify({ FONT, WALL })})`);
await browser.close();
import('node:fs').then(fs => fs.unlinkSync(html));
const png = Buffer.from(data.split(',')[1], 'base64');
const dir = path.join(root, 'public/boxing/img'); mkdirSync(dir, { recursive: true });
const trimmed = await sharp(png).trim({ threshold: 2 }).toBuffer();
for (const [w, q] of [[640, 82], [1100, 80]]) {
  const file = path.join(dir, `logo-ruckus-${w}.webp`);
  const buf = await sharp(trimmed).resize({ width: w }).webp({ quality: q, alphaQuality: 88, effort: 6 }).toBuffer();
  writeFileSync(file, buf); console.log(path.relative(root, file), buf.length, 'bytes');
}
