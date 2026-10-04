// End-to-end check at phone size: Title → Fighter → Opponent → Fight → Result (day, then night); screenshots in public/boxing/qa/.
//   node scripts/demo-e2e.mjs  (DEMO_URL=https://…/ to test a deployed copy)    (needs playwright: PLAYWRIGHT_DIR as in measure-boxing.mjs)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4802, QA = 'public/boxing/qa/game-';
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const out = [], errors = [];
const visible = (page, sel) => page.locator(sel).isVisible();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.DEMO_URL || `http://localhost:${PORT}/boxing/`);
  await page.waitForSelector('#t-play');
  await page.screenshot({ path: `${QA}1-title.png` });

  for (const time of ['day', 'night']) {
    if (time === 'night') {                                   // Settings → Night
      await page.click('[data-go=settings]');
      await page.locator('#set-time button', { hasText: 'Night' }).click();
      await page.screenshot({ path: `${QA}2-settings.png` });
      await page.click('#s-settings .back');
    }
    await page.click('#t-play');
    if (time === 'day') {
      await page.fill('#fighter-name', 'Demo Kid');
      await page.waitForTimeout(3500);
      await page.screenshot({ path: `${QA}3-fighter.png` });
      await page.click('#f-train');
      await page.locator('.urow .btns button[aria-label^=Train]').first().click();
      await page.screenshot({ path: `${QA}4-upgrade.png` });
      await page.click('#camp-confirm');
      await page.click('#s-upgrade .back');
    }
    await page.click('#f-next');
    await page.waitForSelector('#opps .opp');
    await page.screenshot({ path: `${QA}5-opponent-${time}.png` });
    await page.click('#o-fight');
    await page.waitForSelector('#corner:not([hidden])');
    await page.waitForTimeout(6000);                          // arena loads behind the corner sheet
    await page.screenshot({ path: `${QA}6-corner-${time}.png` });
    await page.click('#start-round');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${QA}7-fight-${time}.png` });
    await page.evaluate(() => { const s = document.getElementById('speed-override'); s.value = 'instant'; });   // later rounds run instantly
    for (let i = 0; i < 200 && !(await visible(page, '#s-result')); i++) {
      if (await visible(page, '#start-round') && await page.locator('#start-round').isEnabled()) await page.click('#start-round');
      await page.waitForTimeout(700);
    }
    await page.waitForSelector('#s-result:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(6500);                          // scorecard reveal plays out
    await page.screenshot({ path: `${QA}8-result-${time}.png` });
    out.push({ time, verdict: await page.textContent('.verdict'), method: await page.textContent('.method'), record: await page.textContent('#r-body .reward div:nth-child(2) b') });
    await page.evaluate(() => { document.getElementById('speed-override').value = ''; });
    await page.locator('#r-actions button', { hasText: 'Title' }).click();
  }
  console.log(JSON.stringify({ out, errors }, null, 1));
} finally { await browser.close(); server.kill(); }
