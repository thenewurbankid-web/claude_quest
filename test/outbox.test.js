// The outbox: recall inside the window, seal after it, one Decision per Riddle, unblocking only when nothing waits.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger, memoryStore, applyChanges, DEFAULT_RULES } from '../public/quest/contract.js';
import { outboxItems, recallRiddle, sealDue, outboxTick, startOutbox } from '../public/quest/outbox.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const T0 = new Date('2026-10-03T12:00:00Z');
const plus = s => new Date(T0.getTime() + s * 1000);
const hard = l => validateLedger(l).filter(p => !p.repair);

/** The sample with Riddle id answered at T0 by `by`, waiting the default outbox window. */
function answered(l, id, { by = 'player', text, at = T0 } = {}) {
  const r = l.riddles.find(r => r.id === id);
  Object.assign(r, { state: 'answered', answer: { text: text || r.options[0], by, at: at.toISOString() },
    outboxUntil: new Date(at.getTime() + DEFAULT_RULES.outboxSeconds * 1000).toISOString() });
  return l;
}
async function applied(l, changes) {
  const store = memoryStore(l);
  await applyChanges(store, changes);
  return store.snapshot();
}

test('outboxItems lists answered Riddles, soonest first, with seconds left', () => {
  const l = answered(answered(sample(), 'r2', { at: plus(-5) }), 'r1');
  const items = outboxItems(l, plus(1));
  assert.deepEqual(items.map(i => [i.riddle.id, i.work.id, i.secondsLeft]), [['r2', 'w6', 4], ['r1', 'w4', 9]]);
  assert.equal(outboxItems(l, plus(60))[0].secondsLeft, 0);
  assert.deepEqual(outboxItems(sample(), T0), []);
});

test('recall inside the window reopens the Riddle and logs it', async () => {
  const l = answered(sample(), 'r1');
  const before = JSON.stringify(l);
  const c = recallRiddle(l, 'r1', plus(3));
  assert.equal(JSON.stringify(l), before, 'the input ledger is not touched');
  const after = await applied(l, c);
  const r = after.riddles.find(r => r.id === 'r1');
  assert.equal(r.state, 'open');
  assert.equal(r.answer, null);
  assert.equal(r.outboxUntil, null);
  const { seq, prevHash, hash, ...recalled } = after.events.at(-1); // the store's chain fields aside
  assert.deepEqual(recalled, { at: plus(3).toISOString(), kind: 'riddle.recalled', ref: 'r1' });
  assert.deepEqual(hard(after), []);
});

test('recall is refused once the window has closed, and for Riddles not in the outbox', () => {
  const l = answered(sample(), 'r1');
  assert.throws(() => recallRiddle(l, 'r1', plus(DEFAULT_RULES.outboxSeconds)), /too late/);
  assert.throws(() => recallRiddle(l, 'r1', plus(99)), /too late/);
  assert.throws(() => recallRiddle(l, 'r2', T0), /not waiting/);
  assert.throws(() => recallRiddle(l, 'r3', T0), /not waiting/);
  assert.throws(() => recallRiddle(l, 'nope', T0), /no Riddle/);
});

test('nothing is sealed, and no Work changes, before the window closes', () => {
  const l = answered(sample(), 'r1');
  assert.deepEqual(sealDue(l, plus(9)), { puts: [], events: [] });
});

test('sealing writes exactly one Decision and unblocks a Work with nothing else pending', async () => {
  const l = answered(sample(), 'r1', { text: 'Stripe' });
  const before = JSON.stringify(l);
  const c = sealDue(l, plus(10));
  assert.equal(JSON.stringify(l), before, 'the input ledger is not touched');
  const after = await applied(l, c);
  const r = after.riddles.find(r => r.id === 'r1'), w = after.works.find(w => w.id === 'w4');
  assert.equal(r.state, 'sealed');
  assert.equal(r.sealed_by, 'player');
  assert.equal(r.resolvedAt, plus(10).toISOString());
  assert.deepEqual(w.decisions, [{ riddleId: 'r1', question: r.text, answer: 'Stripe', sealed_by: 'player',
    at: plus(10).toISOString(), sent: null }]);
  assert.equal(w.status, 'todo');
  assert.deepEqual(after.events.slice(-2).map(e => [e.kind, e.ref]), [['riddle.sealed', 'r1'], ['agent.unblocked', 'w4']]);
  assert.deepEqual(hard(after), []);

  // Sealing again finds nothing to do, and a stale copy never gets a second Decision.
  assert.deepEqual(sealDue(after, plus(20)), { puts: [], events: [] });
  const stale = answered(JSON.parse(JSON.stringify(after)), 'r1');
  const again = await applied(stale, sealDue(stale, plus(20)));
  assert.equal(again.works.find(w => w.id === 'w4').decisions.length, 1);
});

test('a blocked Work stays blocked while another of its Riddles is pending', async () => {
  const l = answered(sample(), 'r1');
  l.riddles.push({ id: 'r5', workId: 'w4', marchId: 'ferry', text: 'Monthly or yearly plans first?', risk: 'normal',
    state: 'open', steward: 'player', raisedAt: T0.toISOString() });
  const after = await applied(l, sealDue(l, plus(10)));
  const w = after.works.find(w => w.id === 'w4');
  assert.equal(w.status, 'blocked');
  assert.equal(w.decisions.length, 1);
  assert.ok(!after.events.some(e => e.kind === 'agent.unblocked' && e.ref === 'w4'));
  assert.deepEqual(hard(after), []);
});

test('two Riddles on one blocked Work sealed together each leave a Decision and unblock it once', async () => {
  const l = answered(sample(), 'r1');
  l.riddles.push({ id: 'r5', workId: 'w4', marchId: 'ferry', text: 'Monthly or yearly plans first?', risk: 'normal',
    state: 'answered', steward: 'player', raisedAt: T0.toISOString(),
    answer: { text: 'Monthly', by: 'player', at: T0.toISOString() }, outboxUntil: plus(5).toISOString() });
  const after = await applied(l, sealDue(l, plus(10)));
  const w = after.works.find(w => w.id === 'w4');
  assert.deepEqual(w.decisions.map(d => d.riddleId).sort(), ['r1', 'r5']);
  assert.equal(w.status, 'todo');
  assert.equal(after.events.filter(e => e.kind === 'agent.unblocked' && e.ref === 'w4').length, 1);
  assert.deepEqual(hard(after), []);
});

test('an in_review Work keeps its status when its Riddle is sealed', async () => {
  const l = answered(sample(), 'r2'); // orchard has no steward, so the Realm owner seals
  const after = await applied(l, sealDue(l, plus(10)));
  const w = after.works.find(w => w.id === 'w6');
  assert.equal(w.status, 'in_review');
  assert.equal(w.decisions.length, 1);
  assert.deepEqual(hard(after), []);
});

test('an answer by someone other than the steward is never sealed', () => {
  const l = answered(sample(), 'r1', { by: 'mallory' });
  assert.deepEqual(sealDue(l, plus(60)), { puts: [], events: [] });
});

test('outboxTick seals once; repeated ticks do not seal twice', async () => {
  const store = memoryStore(answered(sample(), 'r1'));
  assert.equal((await outboxTick(store, plus(5))).puts.length, 0);
  assert.ok((await outboxTick(store, plus(10))).puts.length > 0);
  assert.equal((await outboxTick(store, plus(11))).puts.length, 0);
  const l = await store.snapshot();
  assert.equal(l.events.filter(e => e.kind === 'riddle.sealed' && e.ref === 'r1').length, 1);
  assert.equal(l.works.find(w => w.id === 'w4').decisions.length, 1);
});

test('startOutbox seals on its timer with an injected clock, and stop() halts it', async () => {
  const store = memoryStore(answered(sample(), 'r1'));
  let clock = plus(2);
  const stop = startOutbox(store, { now: () => clock, every: 5 });
  await new Promise(r => setTimeout(r, 30));
  assert.equal((await store.snapshot()).riddles.find(r => r.id === 'r1').state, 'answered');
  clock = plus(10);
  await new Promise(r => setTimeout(r, 40));
  stop();
  const l = await store.snapshot();
  assert.equal(l.riddles.find(r => r.id === 'r1').state, 'sealed');
  assert.equal(l.events.filter(e => e.kind === 'riddle.sealed' && e.ref === 'r1').length, 1);
  assert.equal(l.works.find(w => w.id === 'w4').decisions.length, 1);
  assert.deepEqual(hard(l), []);
});
