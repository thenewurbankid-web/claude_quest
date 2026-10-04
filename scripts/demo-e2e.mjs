// End-to-end demo check at phone size: name a fighter, pick a look, fight day then night to the result; screenshots in public/boxing/qa/.
//   node scripts/demo-e2e.mjs   (needs playwright: PLAYWRIGHT_DIR as in measure-boxing.mjs)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4802, QA = 'public/boxing/qa/demo-';
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const out = [];
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/boxing/?debug`);
  await page.fill('#fighter-name', 'Demo Kid');
  await page.waitForTimeout(4000);
  const chips = await page.locator('#look button').count();
  if (chips) await page.locator('#look button').nth(1).click().catch(() => {});
  await page.screenshot({ path: `${QA}1-create.png`, fullPage: true });
  for (const time of ['day', 'night']) {
    await page.selectOption('#time', time);
    await page.selectOption('#speed', 'instant').catch(() => {});
    await page.selectOption('#rounds', '3').catch(() => {});
    await page.click('#new-fight');
    await page.waitForFunction(() => globalThis.__bmArena, null, { timeout: 180000 });
    await page.waitForTimeout(3000);
    for (let r = 0; r < 12; r++) {
      const done = /wins|Draw/.test(await page.textContent('#corner-status'));
      if (done) break;
      const btn = page.locator('#start-round');
      if (await btn.isEnabled()) { await btn.click(); if (r === 0) { await page.waitForTimeout(2000); await page.locator('#ring canvas').first().screenshot({ path: `${QA}2-${time}-fight.png` }); } }
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(500);
    const result = await page.textContent('#corner-status');
    await page.screenshot({ path: `${QA}3-${time}-result.png` });
    out.push({ time, result });
    await page.evaluate(() => { try { __bmArena.dispose?.(); } catch {} });
  }
  console.log(JSON.stringify({ out, errors }, null, 1));
} finally { await browser.close(); server.kill(); }
