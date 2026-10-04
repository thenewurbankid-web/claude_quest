// BOX-36: frame strip of the 2D arena for before/after comparison.  node scripts/shot-swag2d.mjs <outPrefix> [frames] [stepMs]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const [prefix = 'public/boxing/qa/box-36', n = '12', step = '700'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4806;
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/boxing/dev-arena2d.html`);
  await page.waitForFunction(() => globalThis.__ready, null, { timeout: 60000 });
  for (let i = 0; i < +n; i++) { await page.waitForTimeout(+step); await page.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png`, clip: { x: 0, y: 150, width: 375, height: 360 } }); }
  console.log('errors', errs.length ? errs : 'none');
} finally { await browser.close(); server.kill(); }
