// Poses the real ModelBoxer through the 2D action clips in headless Chromium and writes assets-src/build/poses.json,
// which scripts/render-fighters.py replays in Blender.   node scripts/dump-poses.mjs [--clips=idle_guard,atk_jab]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CAMERA, FRAME, RENDER_SCALE } from '../public/boxing/camera2d.js';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4803;
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[err]', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text().slice(0, 300)));
  await page.goto(`http://localhost:${PORT}/boxing/dev-posedump.html${args.clips ? `?clips=${args.clips}` : ''}`);
  await page.waitForFunction(() => globalThis.__ready, null, { timeout: 90000 });
  const poses = await page.evaluate(() => globalThis.__poses);
  Object.assign(poses, { camera: CAMERA, frame: FRAME, scale: RENDER_SCALE });
  mkdirSync('assets-src/build', { recursive: true });
  writeFileSync('assets-src/build/poses.json', JSON.stringify(poses));
  console.log('clips', Object.entries(poses.actions).map(([k, a]) => `${k}:${a.data.length}`).join(' '), 'root', poses.rootScale, poses.rootQuat);
} finally { await browser.close(); server.kill(); }
