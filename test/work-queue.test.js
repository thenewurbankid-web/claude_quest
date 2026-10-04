// R4 slice (a): the /work queue rules (work-queue.js) against the sample Realm with sample-work.json's queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryStore, applyChanges, validateLedger, DEFAULT_RULES, REPORT_INSTRUCTIONS, emberLeft } from '../public/quest/contract.js';
import { riskTier } from '../public/quest/riddles.js';
import { buildPrompt, offerable, copyPrompt, pasteResult, tickLeases, workBoard, emberReturnsAt, leaseLeft }
  from '../public/quest/work-queue.js';

const read = f => JSON.parse(readFileSync(new URL(`../public/quest/${f}`, import.meta.url)));
const pastes = read('sample-work.json').pastes;
const realm = () => ({ ...read('sample-realm.json'), queue: read('sample-work.json').queue });
const T0 = new Date('2026-10-03T12:00:00Z');
const hours = h => new Date(T0.getTime() + h * 3600e3);
const play = async (l, ...steps) => { const s = memoryStore(l); for (const f of steps) await applyChanges(s, f(await s.snapshot())); return s.snapshot(); };
const sound = l => validateLedger(l).filter(p => !p.repair);
const get = (l, kind, id) => l[kind].find(x => x.id === id);
const paste = (...a) => l => pasteResult(l, ...a).changes;
const spent = l => { l.queue[0].reports[0].usage = { input: DEFAULT_RULES.emberMax * DEFAULT_RULES.tokensPerEmber, output: 0 }; return l; };

test('the sample queue is sound to start with', () => assert.deepEqual(sound(realm()), []));

test('buildPrompt wraps the task note with the Work, its March, Hall and branch, and ends with the report block', () => {
  const p = buildPrompt(realm(), 'q3');
  for (const s of ['Harvest calendar', 'The Orchard March', 'Hall of the Harvest', 'Branch: quest/w8', 'Wren',
    'Work: Harvest calendar (branch quest/w8).', `${DEFAULT_RULES.leaseHours} hours`]) assert.ok(p.includes(s), s);
  assert.ok(p.endsWith(REPORT_INSTRUCTIONS));
  assert.throws(() => buildPrompt(realm(), 'nope'));
});

test('offerable: queued, leased and lapsed items of real Works, oldest first', () => {
  assert.deepEqual(offerable(realm(), T0).map(x => x.item.id), ['q1', 'q3']); // q2 is returned
  const l = realm(); l.queue[0].state = 'lapsed';
  assert.deepEqual(offerable(l, T0).map(x => x.item.id), ['q1', 'q3']);
});

test('nothing is offered at Ember 0, nor to a resting Keeper, and copying is refused then', () => {
  const l = spent(realm());
  assert.equal(emberLeft(l, T0), 0);
  assert.deepEqual(offerable(l, T0), []);
  assert.throws(() => copyPrompt(l, 'q3', T0), /Ember/);
  const r = realm(); get(r, 'keepers', 'k4').status = 'resting';
  assert.deepEqual(offerable(r, T0).map(x => x.item.id), ['q1']);
  assert.throws(() => copyPrompt(r, 'q3', T0), /isn't offered/);
  assert.deepEqual(workBoard(r, T0).find(g => g.keeper.id === 'k4').items.map(x => x.offered), [false]);
});

test('game-only Works are never offered or shown', () => {
  const l = realm();
  get(l, 'works', 'w8').mark = { status: 'sent', source: 'lore', sourceId: 'gcpv/x', real: false, at: T0.toISOString() };
  assert.ok(!offerable(l, T0).some(x => x.item.workId === 'w8'));
  assert.ok(!workBoard(l, T0).some(g => g.items.some(x => x.work.id === 'w8')));
  assert.throws(() => copyPrompt(l, 'q3', T0));
});

test('copyPrompt leases the item, makes the Keeper busy and starts a waiting Work', async () => {
  const l = await play(realm(), x => copyPrompt(x, 'q3', T0));
  const q = get(l, 'queue', 'q3');
  assert.equal(q.state, 'leased');
  assert.equal(q.copiedAt, T0.toISOString());
  assert.equal(q.leaseUntil, hours(DEFAULT_RULES.leaseHours).toISOString());
  assert.equal(leaseLeft(q, T0), DEFAULT_RULES.leaseHours * 3600e3);
  assert.equal(get(l, 'keepers', 'k4').status, 'busy');
  assert.equal(get(l, 'works', 'w8').status, 'in_progress');
  assert.equal(get(l, 'works', 'w8').keeperId, 'k4');
  assert.equal(l.events.at(-1).kind, 'work.leased');
  assert.deepEqual(sound(l), []);
  assert.throws(() => copyPrompt(realm(), 'q2', T0), /returned/); // QUEUE_MOVES: returned goes nowhere
});

test('a progress paste renews the lease and keeps the paste verbatim', async () => {
  const text = 'Tiers filled.\n```quest-report\nkind: progress\nsummary: Tiers filled in\nbranch: quest/w3\ninput_tokens: 1000\noutput_tokens: 500\n```';
  const l = await play(realm(), paste('q1', text, {}, T0));
  const q = get(l, 'queue', 'q1');
  assert.equal(q.state, 'leased');
  assert.equal(q.leaseUntil, hours(DEFAULT_RULES.leaseHours).toISOString());
  assert.deepEqual(q.reports.at(-1), { kind: 'progress', summary: 'Tiers filled in', question: null, branch: 'quest/w3',
    usage: { input: 1000, output: 500 }, text, relayed: 'player', manual: false, at: T0.toISOString() });
  assert.equal(l.events.at(-1).kind, 'work.reported');
  assert.equal(emberLeft(l, T0), DEFAULT_RULES.emberMax - 5.1 - 0.15);
  assert.deepEqual(sound(l), []);
});

test('done goes to review, never done, frees the Keeper and keeps the result', async () => {
  const done = pastes.echoedThenDone.replaceAll('quest/w8', 'quest/w3');
  const l = await play(realm(), paste('q1', done, {}, T0));
  const q = get(l, 'queue', 'q1');
  assert.equal(q.state, 'returned');
  assert.deepEqual(q.result, { text: done, usage: null, at: T0.toISOString() });
  assert.equal(get(l, 'works', 'w3').status, 'in_review');
  assert.equal(get(l, 'keepers', 'k1').status, 'free');
  assert.deepEqual(l.events.slice(-2).map(e => e.kind), ['work.reported', 'work.returned']);
  assert.deepEqual(sound(l), []);
});

test('with no valid block, problems come back and nothing changes until a kind is picked', async () => {
  const r = pasteResult(realm(), 'q1', pastes.broken, {}, T0);
  assert.equal(r.refused, null);
  assert.deepEqual(r.changes, { puts: [], events: [] });
  assert.ok(r.problems.length);
  assert.deepEqual(pasteResult(realm(), 'q1', pastes.noBlock, {}, T0).problems.map(p => p.field), ['block']);
  assert.deepEqual(pasteResult(realm(), 'q1', '   ', { kind: 'done' }, T0).problems.map(p => p.field), ['paste']);
  // blocked by hand still needs its question
  assert.deepEqual(pasteResult(realm(), 'q1', pastes.noBlock, { kind: 'blocked' }, T0).problems.map(p => p.field), ['question']);
  const text = '\n  All finished, opened a PR.\nMore detail.';
  const l = await play(realm(), paste('q1', text, { kind: 'done' }, T0));
  const rep = get(l, 'queue', 'q1').reports.at(-1);
  assert.deepEqual([rep.kind, rep.summary, rep.manual, rep.text, rep.relayed], ['done', 'All finished, opened a PR.', true, text, 'player']);
  assert.equal(get(l, 'works', 'w3').status, 'in_review');
});

test('a blocked paste blocks the Work and raises its question as a Riddle, risk tiers applied', async () => {
  const b = await play(realm(), x => copyPrompt(x, 'q3', T0), paste('q3', pastes.blocked, {}, hours(1)));
  const r = b.riddles.at(-1);
  assert.equal(r.text, 'Stripe or Paddle for launch?');
  assert.equal(r.workId, 'w8');
  assert.equal(r.state, 'open');
  assert.equal(r.mark.source, 'agent');
  assert.equal(get(b, 'works', 'w8').status, 'blocked');
  assert.equal(get(b, 'queue', 'q3').state, 'leased');
  assert.equal(get(b, 'queue', 'q3').leaseUntil, hours(1 + DEFAULT_RULES.leaseHours).toISOString());
  assert.ok(b.events.some(e => e.kind === 'riddle.raised' && e.ref === r.id));
  assert.deepEqual(sound(b), []);
  // a hand-picked blocked reply, from a Work in review, with a risky question
  const l = realm(); get(l, 'works', 'w3').status = 'in_review';
  const m = await play(l, paste('q1', 'Need a call.', { kind: 'blocked', question: 'Can I merge to main?' }, T0));
  assert.equal(get(m, 'works', 'w3').status, 'blocked');
  assert.equal(riskTier(m.riddles.at(-1)), 'confirm');
  assert.equal(get(m, 'queue', 'q1').reports.at(-1).question, 'Can I merge to main?');
});

test('cancelled and returned items refuse every paste', () => {
  const l = realm(); l.queue[0].state = 'cancelled';
  for (const [id, why] of [['q1', 'cancelled'], ['q2', 'returned']]) {
    const r = pasteResult(l, id, pastes.blocked, { kind: 'done' }, T0);
    assert.equal(r.refused, why);
    assert.deepEqual(r.changes, { puts: [], events: [] });
  }
  assert.equal(pasteResult(realm(), 'q3', pastes.noBlock, { kind: 'done' }, T0).refused, 'queued'); // never copied
});

test('a lapsed lease: the Keeper wanders and the Work goes back to todo', async () => {
  const lease = Date.parse(get(realm(), 'queue', 'q1').leaseUntil);
  assert.deepEqual(tickLeases(realm(), new Date(lease - 1)), { puts: [], events: [] });
  const l = await play(realm(), x => tickLeases(x, new Date(lease)));
  assert.equal(get(l, 'queue', 'q1').state, 'lapsed');
  assert.equal(get(l, 'keepers', 'k1').status, 'wandered');
  assert.equal(get(l, 'works', 'w3').status, 'todo');
  assert.equal(l.events.at(-1).kind, 'work.lapsed');
  assert.deepEqual(sound(l), []);
  // a Keeper holding another live lease stays busy; a resting one stays resting
  const two = realm(); two.queue[2] = { ...two.queue[2], keeperId: 'k1', state: 'leased', leaseUntil: hours(9).toISOString() };
  assert.ok(!tickLeases(two, new Date(lease)).puts.some(p => p.kind === 'keepers'));
  const rest = realm(); get(rest, 'keepers', 'k1').status = 'resting';
  assert.ok(!tickLeases(rest, new Date(lease)).puts.some(p => p.kind === 'keepers'));
});

test('a late paste on a lapsed item is taken back and the Keeper stops wandering', async () => {
  const lease = new Date(Date.parse(get(realm(), 'queue', 'q1').leaseUntil));
  const progress = '```quest-report\nkind: progress\nsummary: Back at it\n```';
  const l = await play(realm(), x => tickLeases(x, lease), paste('q1', progress, {}, hours(3)));
  assert.equal(get(l, 'queue', 'q1').state, 'leased');
  assert.equal(get(l, 'keepers', 'k1').status, 'busy');
  assert.equal(get(l, 'works', 'w3').status, 'in_progress');
  const d = await play(realm(), x => tickLeases(x, lease), paste('q1', 'Finished late.', { kind: 'done' }, hours(3)));
  assert.equal(get(d, 'queue', 'q1').state, 'returned');
  assert.equal(get(d, 'keepers', 'k1').status, 'free');
  assert.equal(get(d, 'works', 'w3').status, 'in_review');
  assert.deepEqual(sound(d), []);
});

test('emberReturnsAt: null while there is Ember, else when the oldest spend leaves the window', () => {
  assert.equal(emberReturnsAt(realm(), T0), null);
  const l = spent(realm());
  assert.equal(emberReturnsAt(l, T0), new Date(Date.parse(l.queue[0].reports[0].at) + DEFAULT_RULES.emberWindowHours * 3600e3).toISOString());
  assert.ok(emberLeft(l, new Date(emberReturnsAt(l, T0))) > 0);
});

test('workBoard groups live items by Keeper and keeps resting Keepers with nothing offered', () => {
  const l = realm(); get(l, 'keepers', 'k2').status = 'resting';
  assert.deepEqual(workBoard(l, T0).map(g => [g.keeper.id, g.items.map(x => x.item.id)]), [['k1', ['q1']], ['k2', []], ['k4', ['q3']]]);
});
