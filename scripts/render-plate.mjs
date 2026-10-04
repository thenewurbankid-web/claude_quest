// Screenshots the baked court from the fixed 2D medium camera (public/boxing/camera2d.js) into public/boxing/plates/medium_day.webp.
//   node scripts/render-plate.mjs [--time=day]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { FRAME, RENDER_SCALE } from '../public/boxing/camera2d.js';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const time = args.time || 'day';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4804;
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: FRAME.w, height: FRAME.h }, deviceScaleFactor: RENDER_SCALE });
  page.on('pageerror', (e) => console.log('[err]', String(e)));
  await page.goto(`http://localhost:${PORT}/boxing/dev-plate.html?time=${time}`);
  await page.waitForFunction(() => globalThis.__ready, null, { timeout: 90000 });
  mkdirSync('public/boxing/plates', { recursive: true });
  const png = await page.screenshot({ type: 'png' });
  const out = `public/boxing/plates/medium_${time}.webp`;
  await sharp(png).webp({ quality: 82 }).toFile(out);
  console.log('wrote', out, (await sharp(out).metadata()).width + 'x' + (await sharp(out).metadata()).height);
} finally { await browser.close(); server.kill(); }
