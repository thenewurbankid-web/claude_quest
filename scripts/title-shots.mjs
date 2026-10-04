// Title screen shots at 375x812 and 1440x900: node scripts/title-shots.mjs <tag> [outdir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const tag = process.argv[2] || 'after', dir = process.argv[3] || 'public/boxing/qa', PORT = 4805;
mkdirSync(dir, { recursive: true });
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  for (const [w, h] of [[375, 812], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/boxing/`);
    await page.waitForSelector('#t-career'); await page.waitForTimeout(4500);
    await page.screenshot({ path: `${dir}/box-${process.env.BOX || 30}-${tag}-${w}.png` });
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
