// Measures the 3D view in headless Chromium at a phone-sized canvas: meshes, draw calls, frame time, plus a screenshot.
//   node scripts/measure-boxing.mjs [--crowd=photo|3d] [--time=day|night] [--shot=path.png] [--cam=hard|ringside|rooftop] [--frames=240] [--nomorph]
// Needs playwright: PLAYWRIGHT_DIR=/path/to/node_modules/playwright (default: the construct checkout's copy).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4801;
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 760 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/boxing/?debug${args.crowd === '3d' ? '&crowd=3d' : ''}`);
  await page.waitForSelector('#t-play');
  if (args.time === 'night') {
    await page.click('[data-go=settings]');
    await page.locator('#set-time button', { hasText: 'Night' }).click();
    await page.click('#s-settings .back');
  }
  await page.click('#t-play');
  await page.click('#f-next');
  await page.waitForSelector('#opps .opp');
  await page.click('#o-fight');
  await page.waitForFunction(() => globalThis.__bmArena, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  if (args.cam) await page.evaluate((c) => __bmArena.cut(c, 600000, 'blue'), args.cam);
  if (args.nomorph !== undefined) await page.evaluate(() => { for (const b of Object.values(__bmArena.boxers)) b.setPhysique({ lean: 0, heavy: 0 }); });
  const res = await page.evaluate(async (frames) => {
    const { scene, engine } = __bmArena;
    const inst = new BABYLON.SceneInstrumentation(scene);
    inst.captureFrameTime = true; inst.captureRenderTime = true; inst.captureActiveMeshesEvaluationTime = true;
    await new Promise((r) => setTimeout(r, 500));
    const t0 = performance.now(); let n = 0;
    await new Promise((r) => { const o = scene.onAfterRenderObservable.add(() => { if (++n >= frames) { scene.onAfterRenderObservable.remove(o); r(); } }); });
    const wall = (performance.now() - t0) / n;
    return {
      renderer: engine.getGlInfo().renderer, canvas: [engine.getRenderWidth(), engine.getRenderHeight()],
      meshes: scene.meshes.length, activeMeshes: scene.getActiveMeshes().length, drawCalls: inst.drawCallsCounter.current,
      frameCpuMs: +inst.frameTimeCounter.average.toFixed(2), renderMs: +inst.renderTimeCounter.average.toFixed(2),
      activeMeshesEvalMs: +inst.activeMeshesEvaluationTimeCounter.average.toFixed(2), wallMsPerFrame: +wall.toFixed(2),
      crowd: __bmArena.scene.getMeshByName('crowdPhotos') ? 'photo' : '3d',
    };
  }, Number(args.frames || 240));
  if (args.shot) await page.locator('#ring canvas').first().screenshot({ path: args.shot });
  console.log(JSON.stringify({ ...args, ...res, errors }, null, 1));
} finally { await browser.close(); server.kill(); }
