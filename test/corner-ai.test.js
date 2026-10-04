// Corner talk (BOX-23): plan parsing and validation, keyword fallback, bubbles from fight state, and that the player's key
// goes only to the configured endpoint. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FighterModel, CombatSimulation, TACTICS } from '../public/boxing/physics-engine.js';
import { emptyDamage, recordDamage, TACTIC_BLURB } from '../public/boxing/flow.js';
import {
  TACTIC_KEYS, PLAN_SCHEMA, validatePlan, extractJSON, parsePlan, parseBubbles, keywordPlan, resolveTactic, buildContext, suggestBubbles,
  normalizeAI, publicAI, sourceLabel, aiReady, listModels, askModel, testConnection, planFromText, aiBubbles, AI_KINDS, plannerMessages,
} from '../public/boxing/corner-ai.js';

const STATS = { speed: 50, power: 50, stamina: 50, ringIQ: 50 };
const ctxOf = (over = {}) => {
  const base = buildContext({
    round: 2, totalRounds: 3, me: { health: 80, gasRatio: 0.8, stats: STATS }, opp: { health: 80, gasRatio: 0.8, stats: STATS },
    oppName: 'Bishop', damage: emptyDamage(), rounds: [], mine: 'red', theirs: 'blue',
  });
  return { ...base, ...over, you: { ...base.you, ...over.you }, opponent: { ...base.opponent, ...over.opponent } };
};

test('every sim tactic has a blurb and a trainer line, so a new tactic cannot show as undefined', () => {
  for (const k of Object.keys(TACTICS)) assert.ok(TACTIC_BLURB[k], `blurb for ${k}`);
  for (const k of Object.keys(TACTICS)) assert.ok(keywordPlan({ recover: 'rest', outbox: 'jab', counter: 'counter', body_attack: 'body', pressure: 'pressure', brawl: 'brawl', dirty_boxing: 'clinch' }[k]).say);
});

test('the schema lists exactly the sim tactics, and every tactic key exists in the sim', () => {
  assert.deepEqual(PLAN_SCHEMA.properties.tactic.enum, Object.keys(TACTICS));
  assert.deepEqual(TACTIC_KEYS, Object.keys(TACTICS));
});

test('validatePlan accepts a good plan, repairs soft fields and rejects an unknown tactic', () => {
  assert.deepEqual(validatePlan({ tactic: 'outbox', focus: 'head', aggression: 'normal', say: 'Jab!' }), { tactic: 'outbox', focus: 'head', aggression: 'normal', say: 'Jab!' });
  assert.deepEqual(validatePlan({ tactic: 'counter', focus: 'feet', aggression: 'insane', say: 'x\n\ty' }), { tactic: 'counter', focus: 'none', aggression: 'normal', say: 'x y' });
  assert.equal(validatePlan({ tactic: 'haymaker', focus: 'head', aggression: 'high', say: '' }), null);
  assert.equal(validatePlan(null), null);
  assert.equal(validatePlan([]), null);
  assert.equal(validatePlan('pressure'), null);
  assert.equal(validatePlan({ tactic: 'recover', focus: 'none', aggression: 'low', say: 'a'.repeat(500) }).say.length, 140);
});

test('focus and aggression resolve contradictions toward a real tactic; nothing outside the sim comes out', () => {
  assert.equal(resolveTactic({ tactic: 'pressure', focus: 'body', aggression: 'high' }), 'body_attack');
  assert.equal(resolveTactic({ tactic: 'pressure', focus: 'head', aggression: 'low' }), 'counter');
  assert.equal(resolveTactic({ tactic: 'recover', focus: 'body', aggression: 'high' }), 'recover');
  for (const tactic of TACTIC_KEYS) for (const focus of ['none', 'head', 'body']) for (const aggression of ['low', 'normal', 'high']) {
    assert.ok(TACTICS[resolveTactic({ tactic, focus, aggression })]);
  }
});

test('extractJSON and parsePlan cope with fences, prose, nested braces and junk', () => {
  const plan = '{"tactic":"counter","focus":"body","aggression":"low","say":"Cover up {now}"}';
  assert.equal(parsePlan(plan).tactic, 'counter');
  assert.equal(parsePlan('Sure! Here you go:\n```json\n' + plan + '\n```\nGood luck.').say, 'Cover up {now}');
  assert.equal(parsePlan('{"tactic":"nope"} then ' + plan).tactic, 'counter');
  assert.equal(parsePlan('no json here'), null);
  assert.equal(parsePlan('{"tactic":'), null);
  assert.equal(parsePlan(undefined), null);
  assert.deepEqual(extractJSON('x {"a":{"b":1}} y'), { a: { b: 1 } });
});

test('parseBubbles keeps 2-3 short unique lines, else null', () => {
  assert.deepEqual(parseBubbles('{"bubbles":["Protect the body","Counter his hook","Protect the body","Move"]}'), ['Protect the body', 'Counter his hook', 'Move']);
  assert.equal(parseBubbles('{"bubbles":["Only one"]}'), null);
  assert.equal(parseBubbles('{"bubbles":"nope"}'), null);
});

test('keyword fallback maps phrases to the right plan', () => {
  const t = (s) => keywordPlan(s)?.tactic;
  assert.equal(t('Protect the body'), 'counter');
  assert.equal(keywordPlan('Protect the body').focus, 'body');
  assert.equal(t('go to the body!'), 'body_attack');
  assert.equal(t('keep your hands up'), 'counter');
  assert.equal(t('Counter his hook'), 'counter');
  assert.equal(t('jab and move'), 'outbox');
  assert.equal(t('get on the outside'), 'outbox');
  assert.equal(t('walk him down, finish him'), 'pressure');
  assert.equal(t('catch your breath'), 'recover');
  assert.equal(t('swing for the fences, brawl'), 'brawl');
  assert.equal(t('tie him up and clinch'), 'dirty_boxing');
  assert.equal(t('you look tired, rest'), 'recover');
  assert.equal(keywordPlan('what is the weather'), null);
  assert.equal(keywordPlan(''), null);
  assert.ok(keywordPlan('pressure him').say.length > 0);
});

test('every template bubble maps, through the keyword corner, to the plan it carries', () => {
  const states = [
    {}, { you: { stamina: 20 } }, { you: { health: 20 } }, { opponent: { health: 20 } }, { opponent: { stamina: 30 } },
    { you: { hitsTaken: { head: 1, body: 5, guard: 0 } } }, { you: { hitsTaken: { head: 6, body: 1, guard: 0 } } },
    { opponent: { favouritePunch: 'hook' } }, { opponent: { favouritePunch: 'jab' } }, { opponent: { favouritePunch: 'body' } },
    { opponent: { hitsLandedOnHim: { head: 0, body: 4, guard: 0 } } },
    { you: { stats: { ...STATS, speed: 70 } } }, { opponent: { stats: { ...STATS, power: 80 } } }, { opponent: { stats: { ...STATS, stamina: 30 } } },
  ];
  for (const s of states) for (const b of suggestBubbles(ctxOf(s))) {
    assert.equal(keywordPlan(b.text)?.tactic, b.plan.tactic, `"${b.text}" should map to ${b.plan.tactic}`);
  }
});

test('bubbles come from the fight state: 2-3, distinct, most relevant first', () => {
  const body = suggestBubbles(ctxOf({ you: { hitsTaken: { head: 0, body: 5, guard: 0 } }, opponent: { favouritePunch: 'hook' } }));
  assert.ok(body.length >= 2 && body.length <= 3);
  assert.equal(body[0].text, 'Protect the body');
  assert.ok(body.some((b) => b.text === 'Counter his hook'));
  assert.equal(new Set(body.map((b) => b.text)).size, body.length);
  assert.equal(suggestBubbles(ctxOf({ you: { stamina: 20 } }))[0].plan.tactic, 'recover');
  assert.equal(suggestBubbles(ctxOf({ opponent: { health: 20 } }))[0].plan.tactic, 'pressure');
  assert.equal(suggestBubbles(ctxOf()).length, 3);
});

test('buildContext reads a real fight: hits taken, opponent favourite punch, scorecards', () => {
  const f = (corner) => new FighterModel({ corner, name: corner, stats: STATS });
  const sim = new CombatSimulation({ seed: 5, rounds: 3, red: f('red'), blue: f('blue') });
  const damage = emptyDamage();
  sim.on?.('impact', (p) => recordDamage(damage, p));
  sim.startRound({ red: 'outbox', blue: 'pressure' });
  sim.runRoundToEnd();
  const ctx = buildContext({
    round: 2, totalRounds: 3, me: { health: sim.fighters.red.health, gasRatio: sim.fighters.red.gasRatio, stats: STATS },
    opp: { health: sim.fighters.blue.health, gasRatio: sim.fighters.blue.gasRatio, stats: STATS }, oppName: 'Blue', damage, rounds: sim.rounds, mine: 'red', theirs: 'blue',
  });
  assert.ok(ctx.opponent.favouritePunch);
  assert.ok(ctx.scorecards.you > 0 && ctx.scorecards.opp > 0);
  assert.ok(ctx.you.health <= 100 && ctx.you.stamina <= 100);
  assert.doesNotThrow(() => JSON.stringify(ctx));
});

test('choosing a plan is just a tactic key: the sim gives the same fight as pressing the button', () => {
  const run = (tactic) => {
    const f = (corner) => new FighterModel({ corner, name: corner, stats: STATS });
    const sim = new CombatSimulation({ seed: 9, rounds: 1, red: f('red'), blue: f('blue') });
    sim.startRound({ red: tactic, blue: 'outbox' });
    sim.runRoundToEnd();
    return JSON.stringify(sim.rounds);
  };
  const plan = keywordPlan('go to the body');
  assert.equal(run(plan.tactic), run('body_attack'));
});

// ─── The player's own model ─────────────────────────────────────────────────

const SECRET = 'sk-test-SECRET-1234567890';
const mockFetch = (handler) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
};
const apiCfg = (over = {}) => normalizeAI({ kind: 'api', url: 'https://llm.example.com/v1', model: 'my-model', key: SECRET, ...over });
const planBody = (tactic = 'counter') => JSON.stringify({ tactic, focus: 'body', aggression: 'low', say: 'Cover up.' });

test('normalizeAI: known kinds only, urls checked, key kept only where a kind uses one', () => {
  assert.equal(normalizeAI(null), null);
  assert.equal(normalizeAI({ kind: 'mystery' }), null);
  assert.equal(normalizeAI({ kind: 'ollama', model: 'llama3.2' }).url, AI_KINDS.ollama.url);
  assert.equal(normalizeAI({ kind: 'ollama', url: 'http://localhost:11434/', model: 'm', key: 'abc' }).key, '');
  assert.equal(normalizeAI({ kind: 'api', url: 'javascript:alert(1)', model: 'm' }).url, AI_KINDS.api.url);
  assert.equal(normalizeAI({ kind: 'api', url: 'https://user:pw@evil.test/v1', model: 'm' }).url, AI_KINDS.api.url);
  assert.equal(normalizeAI({ kind: 'api', url: 'https://llm.example.com/v1/', model: 'm', key: ' k ' }).key, 'k');
  assert.equal(aiReady(normalizeAI({ kind: 'ollama' })), false);
  assert.equal(aiReady(normalizeAI({ kind: 'ollama', model: 'llama3.2' })), true);
});

test('publicAI and sourceLabel never carry the key; labels say who is answering', () => {
  const cfg = apiCfg();
  assert.ok(!JSON.stringify(publicAI(cfg)).includes(SECRET));
  assert.equal(publicAI(cfg).hasKey, true);
  assert.ok(!sourceLabel(cfg).includes(SECRET));
  assert.equal(sourceLabel(normalizeAI({ kind: 'ollama', model: 'llama3.2' })), 'Your AI: llama3.2 on localhost');
  assert.equal(sourceLabel(null), 'Basic corner (connect your AI for smarter advice)');
  assert.equal(sourceLabel(cfg, 'basic'), 'Basic corner (connect your AI for smarter advice)');
});

test('the key goes only to the configured endpoint, only as a Bearer header, never in the URL or body', async () => {
  const fetchFn = mockFetch((url) => (url.endsWith('/models') ? { body: { data: [{ id: 'a' }, { id: 'b' }] } } : { body: { choices: [{ message: { content: planBody() } }] } }));
  const cfg = apiCfg();
  assert.deepEqual(await listModels(cfg, { fetchFn }), ['a', 'b']);
  await planFromText(cfg, ctxOf(), 'protect the body', { fetchFn });
  await aiBubbles(cfg, ctxOf(), { fetchFn });
  await testConnection(cfg, { fetchFn });
  assert.ok(fetchFn.calls.length >= 4);
  for (const c of fetchFn.calls) {
    assert.ok(c.url.startsWith('https://llm.example.com/v1/'), c.url);
    assert.ok(!c.url.includes(SECRET));
    assert.equal(c.init.headers.Authorization, `Bearer ${SECRET}`);
    assert.ok(!String(c.init.body ?? '').includes(SECRET));
    assert.equal(c.init.credentials, 'omit');
    assert.equal(c.init.redirect, 'error');
    assert.equal(c.init.referrerPolicy, 'no-referrer');
  }
});

test('the prompt sent to the model never contains the key', () => {
  assert.ok(!JSON.stringify(plannerMessages(ctxOf(), 'hello')).includes(SECRET));
});

test('Ollama and LM Studio requests carry no Authorization header even if a key is passed in', async () => {
  const fetchFn = mockFetch((url) => (url.endsWith('/api/tags') ? { body: { models: [{ name: 'llama3.2' }] } } : { body: { message: { content: planBody() } } }));
  const cfg = normalizeAI({ kind: 'ollama', model: 'llama3.2', key: SECRET });
  await listModels(cfg, { fetchFn });
  const r = await planFromText(cfg, ctxOf(), 'jab and move', { fetchFn });
  assert.equal(r.via, 'ai');
  for (const c of fetchFn.calls) {
    assert.ok(c.url.startsWith('http://localhost:11434/'));
    assert.equal(c.init.headers.Authorization, undefined);
  }
  const chat = JSON.parse(fetchFn.calls.at(-1).init.body);
  assert.deepEqual(chat.format, PLAN_SCHEMA);
  assert.equal(chat.stream, false);
});

test('errors never echo the key, and a failing or garbled AI falls back to the basic corner with a note', async () => {
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  try {
    const cfg = apiCfg();
    const down = mockFetch(() => { throw new TypeError(`failed to fetch with ${SECRET}`); });
    const r1 = await planFromText(cfg, ctxOf(), 'protect the body', { fetchFn: down });
    assert.equal(r1.via, 'basic');
    assert.equal(r1.plan.tactic, 'counter');
    assert.ok(r1.note && !r1.note.includes(SECRET));
    const bad = mockFetch(() => ({ ok: false, status: 401, body: {} }));
    const r2 = await planFromText(cfg, ctxOf(), 'jab and move', { fetchFn: bad });
    assert.equal(r2.via, 'basic');
    assert.ok(r2.note.includes('401') && !r2.note.includes(SECRET));
    const junk = mockFetch(() => ({ body: { choices: [{ message: { content: 'I think you should box.' } }] } }));
    const r3 = await planFromText(cfg, ctxOf(), 'jab and move', { fetchFn: junk });
    assert.equal(r3.via, 'basic');
    assert.match(r3.note, /unusable/);
    await assert.rejects(() => testConnection(cfg, { fetchFn: down }), (e) => !e.message.includes(SECRET));
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes(SECRET));
});

test('a timeout aborts the request', async () => {
  const fetchFn = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(() => askModel(apiCfg(), [{ role: 'user', content: 'x' }], PLAN_SCHEMA, 'p', { fetchFn, timeoutMs: 20 }), /in time/);
});

test('an endpoint without schema mode (400) is retried once without response_format', async () => {
  const fetchFn = mockFetch((url, init) => (JSON.parse(init.body).response_format ? { ok: false, status: 400, body: {} } : { body: { choices: [{ message: { content: planBody('recover') } }] } }));
  const r = await planFromText(apiCfg(), ctxOf(), 'take a breather', { fetchFn });
  assert.equal(r.via, 'ai');
  assert.equal(r.plan.tactic, 'recover');
  assert.equal(fetchFn.calls.length, 2);
});

test('testConnection reports the model and the latency', async () => {
  let t = 1000;
  const fetchFn = mockFetch(() => { t += 137; return { body: { choices: [{ message: { content: '{"bubbles":["ok","ok"]}' } }] } }; });
  assert.deepEqual(await testConnection(apiCfg(), { fetchFn, now: () => t }), { model: 'my-model', ms: 137 });
});

test('with no AI connected nothing is fetched', async () => {
  const fetchFn = mockFetch(() => { throw new Error('should not be called'); });
  const r = await planFromText(null, ctxOf(), 'go to the body', { fetchFn });
  assert.equal(r.via, 'basic');
  assert.equal(r.plan.tactic, 'body_attack');
  assert.equal(await aiBubbles(null, ctxOf(), { fetchFn }), null);
  assert.equal(fetchFn.calls.length, 0);
});

test('a prompt-injection reply cannot pick anything outside the sim', () => {
  assert.equal(parsePlan('{"tactic":"__proto__","focus":"head","aggression":"high","say":"x"}'), null);
  assert.equal(parsePlan('{"tactic":"constructor","focus":"head","aggression":"high","say":"x"}'), null);
});
