// Builds public/boxing/img/logo-ruckus-{640,1100}.webp: a hand-styled marker tag of "Bring The Ruckus".
// Letters are authored as pen paths (no font): one slant, a rising baseline, letters joined by shared strokes,
// chisel-nib width (thick downstrokes, tapered entries and exits), translucent ink that builds where strokes cross,
// bleed into the CC0 brick photo, swashes and a few drips. White on transparent.
// Needs playwright-core + a Chromium (dev only): node scripts/build-logo.mjs <path to playwright-core>
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = createRequire(path.resolve(process.argv[2] || 'node_modules/playwright-core', '../x.js'))('playwright-core');
const WALL = pathToFileURL(path.join(root, 'public/boxing/textures/brick_dirty_diff.webp')).href;

const page_fn = async ({ WALL }) => {
  const W = 1800, H = 1150;
  const wall = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = WALL; });
  let seed = 4417;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

  // Letters: pen points in a 0-100 cap-height box, y up. `join` = continue the previous letter's stroke.
  // Each stroke runs entry -> exit; letters that end low hand over to the next one's low entry.
  const L = {
    B: { w: 66, s: [[[-14, 6], [0, 0], [0, 50], [1, 100], [38, 100], [56, 82], [40, 56], [2, 52], [44, 48], [64, 28], [50, 6], [8, 0], [-4, 2]]] },
    R: { w: 68, join: true, s: [[[-14, 4], [0, 0], [0, 50], [1, 100], [40, 102], [58, 80], [42, 54], [4, 50], [34, 44], [54, 22], [70, 0], [92, 8]]] },
    I: { w: 8, join: true, s: [[[-6, 4], [2, 0], [1, 50], [2, 100], [0, 104]]] },
    N: { w: 60, s: [[[-6, 6], [0, 0], [1, 100], [8, 80], [30, 40], [56, 0], [57, 50], [58, 100], [74, 96]]] },
    G: { w: 66, join: true, s: [[[64, 84], [38, 102], [6, 82], [-2, 44], [14, 8], [46, 0], [66, 16], [64, 42], [34, 42]]] },
    T: { w: 74, s: [[[-8, 96], [30, 102], [78, 100]], [[38, 104], [37, 50], [36, 0], [44, -6]]] },
    H: { w: 62, s: [[[-6, 104], [0, 100], [1, 50], [0, 0], [0, 50], [30, 56], [62, 50], [62, 100], [62, 50], [62, 0], [80, 8]]] },
    E: { w: 62, s: [[[64, 94], [36, 104], [4, 98], [0, 50], [2, 6], [30, -2], [64, 6]], [[6, 54], [28, 58], [52, 52]]] },
    U: { w: 62, joinAfter: 'R', s: [[[0, 102], [3, 40], [18, 4], [38, -2], [56, 24], [60, 100], [62, 40], [62, 0], [74, 4]]] },
    C: { w: 62, s: [[[64, 86], [38, 102], [6, 84], [-2, 44], [14, 8], [44, -2], [66, 12]]] },
    K: { w: 66, s: [[[-6, 100], [0, 98], [1, 50], [0, 0]], [[66, 104], [34, 78], [4, 46], [30, 40], [50, 18], [70, 0], [90, 8]]] },
    S: { w: 58, s: [[[56, 86], [34, 102], [8, 86], [20, 58], [48, 42], [58, 20], [38, -2], [6, 10]]] },
  };
  const rows = [
    { text: 'BRING', ox: 110, oy: 400, sc: 2.3, slant: 0.3, drift: 4, gap: 14 },
    { text: 'THE', ox: 1100, oy: 372, sc: 2.3, slant: 0.3, drift: 4, gap: 16 }, // ~100 px word gap after the G's exit
    { text: 'RUCKUS', ox: 90, oy: 910, sc: 3.4, slant: 0.3, drift: 6, gap: 12 },
  ];
  const strokes = []; // each: { pts:[[x,y]], width }
  for (const row of rows) {
    let ox = row.ox, last = null;
    [...row.text].forEach((ch, i) => {
      const g = L[ch];
      const baseY = row.oy - i * row.drift * 1.2 + (rnd() - 0.5) * row.sc * 3;
      const sc = row.sc * (0.95 + rnd() * 0.1);
      const jit = () => (rnd() - 0.5) * 2.6;
      g.s.forEach((st, k) => {
        const pts = st.map(([px, py]) => { px += jit(); py += jit(); return [ox + (px + py * row.slant) * sc, baseY - py * sc]; });
        if (k === 0 && (g.join || g.joinAfter === row.text[i - 1]) && last) last.pts.push(...pts); else { last = { pts, width: sc * 12.5 }; strokes.push(last); }
      });
      ox += (g.w + row.gap) * sc;
    });
  }
  // underline swash out of the last S, and an entry flick before the B
  const sw = strokes[strokes.length - 1];
  strokes.push({ width: 34, pts: [[1580, 990], [1250, 1012], [800, 1030], [380, 1022], [170, 1004], [110, 988]], taper: true });
  void sw;

  const catmull = (p) => {
    const out = [], n = p.length;
    const P = (i) => p[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), steps = Math.max(2, Math.ceil(d / 1.5));
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(p[n - 1]); return out;
  };

  // Ink: each stroke is stamped opaque into its own layer, then laid on the sheet at ~0.8 alpha so crossings build up.
  const ink = mk(), I = ink.getContext('2d');
  const nib = -0.6; // chisel angle
  for (const st of strokes) {
    const path = catmull(st.pts), n = path.length;
    const layer = mk(), l = layer.getContext('2d'); l.fillStyle = '#fff';
    let len = 0; const cum = [0]; for (let i = 1; i < n; i++) cum.push(len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 3)], b = path[Math.min(n - 1, i + 3)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const t = cum[i] / len;
      const press = Math.min(1, 0.45 + t * 5) * (st.taper ? 1 - Math.pow(t, 1.6) * 0.92 : Math.min(1, 0.3 + (1 - t) * 4.5));
      const chisel = 0.78 + 0.22 * Math.abs(Math.sin(ang - nib));
      const down = Math.sin(ang) > 0 ? 1.12 : 0.9; // downstrokes carry more ink
      const r = st.width * 0.5 * press * chisel * down;
      l.beginPath(); l.ellipse(path[i][0], path[i][1], Math.max(0.8, r), Math.max(0.8, r * 0.72), nib, 0, 7); l.fill();
    }
    I.globalAlpha = 0.82; I.drawImage(layer, 0, 0);
  }
  I.globalAlpha = 1;
  const md = I.getImageData(0, 0, W, H).data;

  // Drips from believable low points.
  const lowest = (cx, from) => { for (let y = from; y > 0; y--) if (md[(y * W + cx) * 4 + 3] > 150) return y; return -1; };
  const D = ink.getContext('2d');
  for (const [cx, len] of [[330, 70], [640, 100], [1030, 60], [1250, 120], [1450, 60], [520, 80]]) {
    let x = cx, y = lowest(x, H - 90);
    for (let k = 0; y < 0 && k < 40; k++) { x += 6; y = lowest(x, H - 90); }
    if (y < 0) continue;
    const wd = 4 + rnd() * 3; D.fillStyle = 'rgba(255,255,255,0.85)';
    D.beginPath(); D.moveTo(x - wd, y - 6); D.quadraticCurveTo(x - wd * 0.5, y + len * 0.5, x - wd * 0.45, y + len); D.lineTo(x + wd * 0.45, y + len); D.quadraticCurveTo(x + wd * 0.5, y + len * 0.5, x + wd, y - 6); D.fill();
    D.beginPath(); D.ellipse(x, y + len, wd * 0.95, wd * 1.3, 0, 0, 7); D.fill();
  }
  const ink2 = D.getImageData(0, 0, W, H).data;

  // Wall: tiled photo gives pits and tooth; ink bleeds slightly and a soft dark offset shadow lifts it off the wall.
  const tx = mk(), t = tx.getContext('2d');
  t.translate(W / 2, H / 2); t.rotate(-0.05);
  for (let yy = -H; yy < H; yy += wall.height * 3.2) for (let xx = -W; xx < W; xx += wall.width * 3.2) t.drawImage(wall, xx, yy, wall.width * 3.2, wall.height * 3.2);
  const td = t.getImageData(0, 0, W, H).data;
  let mean = 0, cnt = 0; for (let i = 0; i < td.length; i += 4 * 97) { mean += td[i] * 0.3 + td[i + 1] * 0.59 + td[i + 2] * 0.11; cnt++; } mean /= cnt;
  const vn = (x, y, f) => { const a = Math.floor(x / f), b = Math.floor(y / f); const h2 = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7 + 13.7) * 43758.5453; return n - Math.floor(n); }; const u = x / f - a, v = y / f - b; const s = (k) => k * k * (3 - 2 * k); return (h2(a, b) * (1 - s(u)) + h2(a + 1, b) * s(u)) * (1 - s(v)) + (h2(a, b + 1) * (1 - s(u)) + h2(a + 1, b + 1) * s(u)) * s(v); };
  const sheet = mk(), S = sheet.getContext('2d');
  const bleed = mk(), B = bleed.getContext('2d'); B.putImageData(D.getImageData(0, 0, W, H), 0, 0);
  const bl = mk(), bc = bl.getContext('2d'); bc.filter = 'blur(2.2px)'; bc.drawImage(bleed, 0, 0);
  const bd = bc.getImageData(0, 0, W, H).data;
  const out = S.createImageData(W, H), od = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const core = ink2[i + 3] / 255, soft = bd[i + 3] / 255;
    const lum = (td[i] * 0.3 + td[i + 1] * 0.59 + td[i + 2] * 0.11 - mean) / 128;
    const streak = vn(x, y * 0.35, 40) * 0.5 + vn(x, y, 6) * 0.5; // dry-marker streaking
    const cover = Math.max(0, Math.min(1, 0.86 + lum * 0.34 + (streak - 0.5) * 0.3 - (rnd() < 0.006 ? 0.45 : 0)));
    const a = Math.min(1, core * cover + (soft - core > 0 ? (soft - core) * 0.22 * cover : 0));
    // darker where ink is thin (fibres show), full white where it pooled
    const v = 232 + Math.min(1, core) * 22 - (1 - cover) * 30;
    od[i] = od[i + 1] = od[i + 2] = Math.max(0, Math.min(255, v)); od[i + 3] = a * 255;
  }
  S.putImageData(out, 0, 0);
  const fin = mk(), F = fin.getContext('2d');
  F.filter = 'blur(9px)'; F.globalAlpha = 0.7; F.save(); F.translate(8, 11); F.drawImage(sheet, 0, 0); F.restore();
  F.globalCompositeOperation = 'source-atop'; F.fillStyle = '#000'; F.fillRect(0, 0, W, H); F.globalCompositeOperation = 'source-over';
  F.filter = 'none'; F.globalAlpha = 1; F.drawImage(sheet, 0, 0);
  return fin.toDataURL('image/png');
};

const browser = await pw.chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const html = path.join(root, 'scripts', '.logo-build.html');
writeFileSync(html, '<!doctype html><meta charset=utf-8><body>');
await page.goto(pathToFileURL(html).href);
const data = await page.evaluate(`(${page_fn.toString()})(${JSON.stringify({ WALL })})`);
await browser.close();
unlinkSync(html);
const png = Buffer.from(data.split(',')[1], 'base64');
const dir = path.join(root, 'public/boxing/img'); mkdirSync(dir, { recursive: true });
const trimmed = await sharp(png).trim({ threshold: 2 }).toBuffer();
writeFileSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp', 'logo-full.png'), trimmed);
for (const [w, q] of [[640, 82], [1100, 80]]) {
  const file = path.join(dir, `logo-ruckus-${w}.webp`);
  const buf = await sharp(trimmed).resize({ width: w }).webp({ quality: q, alphaQuality: 88, effort: 6 }).toBuffer();
  writeFileSync(file, buf); console.log(path.relative(root, file), buf.length, 'bytes');
}
