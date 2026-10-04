// Smoke test for the 2D arena: loads dev-arena2d.html in headless Chromium, grabs frames, reports console errors.
//   node scripts/shot-arena2d.mjs [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'public/boxing/qa';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4805;
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/boxing/dev-arena2d.html`);
  await page.waitForFunction(() => globalThis.__ready, null, { timeout: 60000 });
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/box-17-arena2d-${i}.png` }); }
  console.log('events', await page.evaluate(() => `${__events.length} impacts, tick ${__sim.tick}, phase ${__sim.phase}`));
  console.log('errors', errs.length ? errs : 'none');
} finally { await browser.close(); server.kill(); }
