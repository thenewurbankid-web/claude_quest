// Screenshots of every screen at 375x812 for before/after comparisons: node scripts/ui-shots.mjs <before|after> [outdir]
// Writes <outdir>/ui-<tag>-<n>-<screen>.png (default public/boxing/qa). Needs playwright (PLAYWRIGHT_DIR as in demo-e2e.mjs).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const tag = process.argv[2] || 'after', dir = process.argv[3] || 'public/boxing/qa', PORT = 4804;
mkdirSync(dir, { recursive: true });
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], seen = [];
const visible = (page, sel) => page.locator(sel).isVisible();
let n = 0;
const shot = async (page, name) => { n++; seen.push(name); await page.screenshot({ path: `${dir}/ui-${tag}-${String(n).padStart(2, '0')}-${name}.png` }); };
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/boxing/`);
  await page.waitForSelector('#t-career');
  await page.waitForTimeout(4500);
  await shot(page, 'title');
  await page.click('[data-go=settings]'); await page.waitForTimeout(700);
  await shot(page, 'settings');
  await page.click('#s-settings .back'); await page.waitForTimeout(900);
  await page.click('#t-career'); await page.waitForTimeout(700);
  await shot(page, 'career-intro');
  await page.click('text=Start career');
  await page.waitForSelector('.offer'); await page.waitForTimeout(500);
  await shot(page, 'career-hub');
  await page.click('#c-gym'); await page.waitForSelector('text=Start drill'); await page.waitForTimeout(500);
  await shot(page, 'gym');
  await page.click('#s-gym .back'); await page.waitForSelector('.offer');
  await page.locator('.offer').first().click(); await page.waitForSelector('.poster'); await page.waitForTimeout(500);
  await shot(page, 'fight-card');
  await page.click('#card-accept');
  await page.waitForSelector('#corner:not([hidden])'); await page.waitForTimeout(6000);
  await shot(page, 'corner');
  await page.click('#start-round'); await page.waitForTimeout(5000);
  await shot(page, 'fight-hud');
  await page.evaluate(() => { document.getElementById('speed-override').value = 'instant'; });
  for (let i = 0; i < 200 && !(await visible(page, '#s-result')); i++) {
    if (await visible(page, '#start-round') && await page.locator('#start-round').isEnabled()) await page.click('#start-round');
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('#s-result:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(2500); await shot(page, 'scorecard');
  await page.waitForTimeout(5000); await shot(page, 'result');
  await page.click('text=Continue career'); await page.waitForSelector('.offer');
  await page.click('#s-career .back'); await page.waitForTimeout(900);
  await page.click('#t-play'); await page.waitForTimeout(900);
  await page.fill('#fighter-name', 'Demo Kid'); await page.waitForTimeout(3500);
  await shot(page, 'fighter');
  await page.click('#f-train'); await page.waitForTimeout(500);
  await page.locator('.urow .btns button[aria-label^=Train]').first().click();
  await shot(page, 'training');
  await page.click('#s-upgrade .back'); await page.click('#f-next'); await page.waitForSelector('#opps .opp'); await page.waitForTimeout(500);
  await shot(page, 'opponent');
  // Button audit: every settings option takes, title Gym opens the gym, every Back returns.
  const bad = [];
  await page.click('#s-opponent .back'); await page.click('#s-fighter .back'); await page.waitForTimeout(900);
  await page.click('[data-go=settings]'); await page.waitForTimeout(600);
  for (const b of await page.locator('#s-settings .seg button').all()) {
    await b.click(); if ((await b.getAttribute('aria-pressed')) !== 'true') bad.push('settings: ' + (await b.textContent()));
  }
  await page.click('#s-settings .back'); await page.waitForTimeout(900);
  await page.click('#t-gym'); await page.waitForTimeout(500);
  if (!(await visible(page, '#s-gym'))) bad.push('title gym did not open the gym');
  await page.click('#s-gym .back'); await page.click('#s-career .back'); await page.waitForTimeout(900);
  if (!(await visible(page, '#s-title'))) bad.push('back chain did not reach title');
  console.log(JSON.stringify({ seen, bad, errors }, null, 1));
} finally { await browser.close(); server.kill(); }
