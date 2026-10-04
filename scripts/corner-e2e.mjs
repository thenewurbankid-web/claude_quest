// Corner talk (BOX-23) in headless Chromium at 375 px against a mock Ollama / OpenAI endpoint (no real model, no network).
//   node scripts/corner-e2e.mjs      (needs playwright: PLAYWRIGHT_DIR as in demo-e2e.mjs)   Screenshots: public/boxing/qa/box-23-*.png
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR || '/Users/shashank/Repositories/construct/node_modules/playwright');
const PORT = 4802, MOCK = 4803, QA = 'public/boxing/qa/box-23-', KEY = 'sk-e2e-SECRET-123';
const seen = [];
const mock = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? null, body });
    const j = body ? JSON.parse(body) : {};
    const bubbles = (j.messages ?? []).some((m) => m.content.includes('"bubbles"'));
    const content = bubbles ? '{"bubbles":["Hit his body","Stay on the jab"]}'
      : '{"tactic":"pressure","focus":"body","aggression":"high","say":"Walk him down and dig to the ribs."}';
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') res.end('{"models":[{"name":"llama3.2:latest"}]}');
    else if (req.url === '/api/chat') res.end(JSON.stringify({ message: { content } }));
    else if (req.url === '/v1/models') res.end('{"data":[{"id":"mock-gpt"}]}');
    else if (req.url === '/v1/chat/completions') res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    else { res.writeHead(404); res.end('{}'); }
  });
}).listen(MOCK);
const server = spawn('node', ['dev/static.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 760 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/boxing/`);
  await page.waitForSelector('#t-play');
  const pick = (name) => page.locator('#ai-kind button', { hasText: name }).click();

  // Settings: Ollama, find models, test
  await page.click('[data-go=settings]');
  await page.waitForFunction(() => /Basic corner/.test(document.getElementById('ai-line').textContent));
  await pick('Ollama');
  await page.fill('#ai-url', `http://localhost:${MOCK}`);
  await page.click('#ai-find');
  await page.waitForFunction(() => /1 model found/.test(document.getElementById('ai-status').textContent));
  assert.equal(await page.inputValue('#ai-model'), 'llama3.2:latest');
  await page.click('#ai-test');
  await page.waitForFunction(() => /Connected: llama3.2:latest, \d+ ms/.test(document.getElementById('ai-status').textContent));
  assert.equal(await page.textContent('#ai-line'), 'Your AI: llama3.2:latest on localhost');
  await page.screenshot({ path: `${QA}settings.png` });
  assert.ok(seen.every((s) => s.auth === null), 'Ollama requests carry no key');

  // Own API with a key: the key goes only to the mock, only as Bearer; forget key removes it from storage
  await pick('Your API');
  await page.fill('#ai-url', `http://localhost:${MOCK}/v1`);
  await page.fill('#ai-key', KEY);
  await page.fill('#ai-model', 'mock-gpt');
  await page.click('#ai-test');
  await page.waitForFunction(() => /Connected: mock-gpt/.test(document.getElementById('ai-status').textContent));
  assert.ok(seen.some((s) => s.auth === `Bearer ${KEY}` && s.url.startsWith('/v1/')));
  assert.ok(seen.every((s) => !s.url.includes(KEY) && !s.body.includes(KEY)));
  assert.ok((await page.evaluate(() => localStorage.getItem('bm.ai'))).includes(KEY));
  assert.ok(!((await page.evaluate(() => localStorage.getItem('bm.settings'))) ?? '').includes(KEY));
  await page.click('#ai-forget');
  assert.ok(!(await page.evaluate(() => localStorage.getItem('bm.ai'))).includes(KEY));
  await pick('Ollama');
  await page.fill('#ai-url', `http://localhost:${MOCK}`);
  await page.fill('#ai-model', 'llama3.2:latest');
  await page.click('#ai-test');
  await page.waitForFunction(() => /Connected/.test(document.getElementById('ai-status').textContent));
  await page.click('#s-settings .back');

  // Fight: corner talk
  await page.click('#t-play');
  await page.fill('#fighter-name', 'Talk Kid');
  await page.click('#f-next');
  await page.waitForSelector('#opps .opp');
  await page.click('#o-fight');
  await page.waitForSelector('#corner:not([hidden])');
  await page.waitForTimeout(5000);
  await page.waitForFunction(() => [...document.querySelectorAll('#bubbles button')].some((b) => b.textContent === 'Hit his body'));  // the model's own bubbles replaced the templates
  assert.match(await page.textContent('#talk-src'), /Your AI: llama3.2:latest on localhost/);
  await page.screenshot({ path: `${QA}corner-bubbles.png` });
  await page.locator('#bubbles button', { hasText: 'Hit his body' }).click();
  await page.waitForSelector('#talk-reply .tag');
  assert.match(await page.textContent('#talk-reply'), /Walk him down and dig to the ribs/);
  assert.match(await page.textContent('#talk-reply .tag'), /Plan: Body attack · aim body · high aggression/);
  assert.equal(await page.locator('#tactics button[aria-pressed=true] b').textContent(), 'Body attack');
  await page.screenshot({ path: `${QA}corner-reply.png` });
  await page.fill('#say-in', 'keep your hands up');
  await page.click('#say-send');
  await page.waitForFunction(() => document.querySelector('#talk-reply .tag'));
  await page.click('#start-round');
  await page.waitForTimeout(1500);
  assert.match(await page.textContent('#tactic-chip'), /PLAN · Body attack · vs .* · "keep your hands up"/);
  await page.screenshot({ path: `${QA}fight-chip.png` });
  console.log('seen requests', seen.length);

  // Not connected: the basic corner answers and says so
  await page.evaluate(() => { document.getElementById('speed-override').value = 'instant'; });
  await page.waitForSelector('#corner:not([hidden])', { timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('bm.ai'));
  await page.reload();
  await page.click('#t-play'); await page.click('#f-next'); await page.waitForSelector('#opps .opp'); await page.click('#o-fight');
  await page.waitForSelector('#corner:not([hidden])');
  assert.match(await page.textContent('#talk-src'), /Basic corner \(connect your AI for smarter advice\)/);
  await page.fill('#say-in', 'protect the body');
  await page.click('#say-send');
  await page.waitForSelector('#talk-reply .tag');
  assert.match(await page.textContent('#talk-reply .tag'), /Plan: Counter-punch · aim body · low aggression/);
  await page.fill('#say-in', 'qwertyuiop');
  await page.click('#say-send');
  await page.waitForFunction(() => /Did not catch a plan/.test(document.getElementById('talk-reply').textContent));
  await page.screenshot({ path: `${QA}corner-basic.png` });
  assert.deepEqual(errors, []);
  console.log('OK: corner talk e2e passed, no console errors');
} finally { await browser.close(); server.kill(); mock.close(); }
