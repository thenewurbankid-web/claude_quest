// Career loop at phone size: Title → Career → gym drill → fight card → fight → result → Career. Screenshots in public/boxing/qa/career-*.png
//   node scripts/career-e2e.mjs  (CAREER_URL=https://…/ for a deployed copy; PLAYWRIGHT_DIR as in measure-boxing.mjs)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4803, QA = 'public/boxing/qa/career-';
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], out = {};
const visible = (page, sel) => page.locator(sel).isVisible();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.CAREER_URL || `http://localhost:${PORT}/boxing/`);
  await page.evaluate(() => indexedDB.deleteDatabase && 0);
  await page.waitForSelector('#t-career');
  await page.click('#t-career');
  await page.click('text=Start career');
  await page.waitForSelector('.offer');
  await page.screenshot({ path: `${QA}1-hub.png`, fullPage: false });
  out.hub = await page.textContent('#c-week');

  await page.click('#c-gym');                                   // drill: 8 taps at the marker's centre
  await page.waitForSelector('text=Start drill');
  await page.screenshot({ path: `${QA}2-gym.png` });
  await page.click('text=Start drill');
  for (let i = 0; i < 8; i++) {
    await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.mk').style.left) - 50) < 4, null, { polling: 'raf', timeout: 5000 });
    await page.locator('.hit-btn').dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('.grade');
  out.grade = await page.textContent('.grade');
  await page.screenshot({ path: `${QA}3-drill.png` });
  await page.click('text=Back to career');
  out.weekAfterDrill = await page.textContent('#c-week');

  await page.locator('.offer').first().click();                 // fight card
  await page.waitForSelector('.poster');
  await page.screenshot({ path: `${QA}4-card.png` });
  await page.click('#card-accept');
  await page.waitForSelector('#corner:not([hidden])');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${QA}5-corner.png` });
  await page.evaluate(() => { document.getElementById('speed-override').value = 'instant'; });
  for (let i = 0; i < 200 && !(await visible(page, '#s-result')); i++) {
    if (await visible(page, '#start-round') && await page.locator('#start-round').isEnabled()) await page.click('#start-round');
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('#s-result:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${QA}6-result.png` });
  out.verdict = await page.textContent('.verdict');
  out.changed = await page.locator('#r-body .card', { hasText: 'What changed' }).innerText();
  await page.click('text=Continue career');
  await page.waitForSelector('.offer');
  await page.screenshot({ path: `${QA}7-hub-after.png` });
  out.weekAfterFight = await page.textContent('#c-week');
  console.log(JSON.stringify({ out, errors }, null, 1));
} finally { await browser.close(); server.kill(); }
