// Screenshots the idle stance (or a punch) from front/side/back in headless Chromium.
//   node scripts/shot-stance.mjs <outPrefix> [--cams=front,side] [--punch=jab --k=0.5] [--skin=light]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')));
const prefix = process.argv[2];
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4802;
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  for (const cam of (args.cams || 'front,side').split(',')) {
    const page = await browser.newPage({ viewport: { width: 480, height: 720 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e))); if (args.log) page.on('pageerror', (e) => console.log('[err]', String(e))); if (args.log) page.on('console', (m) => console.log('[page]', m.text().slice(0, 200))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const qs = new URLSearchParams({ cam, ...(args.punch ? { punch: args.punch, k: args.k || '0.5' } : {}), ...(args.skin ? { skin: args.skin } : {}) });
    await page.goto(`http://localhost:${PORT}/boxing/dev-stance.html?${qs}`);
    await page.waitForFunction(() => globalThis.__ready, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${prefix}-${cam}.png` });
    if (errors.length) console.log(cam, 'errors', errors);
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
