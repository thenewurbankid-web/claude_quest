// The Keeper controls (R4): wake, rest, resume, cancel, the Recall Bell and the token readout, against the sample Realm
// with sample-work.json's queue. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryStore, applyChanges, validateLedger, DEFAULT_RULES, emberLeft } from '../public/quest/contract.js';
import { startable, wake, rest, resume, cancel, ringBell, tokenReadout, summon, joinSummoned, release, LIVE } from '../public/quest/keeper-controls.js';
import { keepers as keepersSplit } from '../public/quest/status.js';

const read = f => JSON.parse(readFileSync(new URL(`../public/quest/${f}`, import.meta.url)));
const sample = () => ({ ...read('sample-realm.json'), queue: read('sample-work.json').queue });
const T0 = new Date('2026-10-03T12:00:00Z');
const hard = l => validateLedger(l).filter(p => !p.repair);
const applied = async (l, c) => { const s = memoryStore(l); await applyChanges(s, c); return s.snapshot(); };
const refused = c => { assert.ok(c.problem, 'gives a problem'); assert.deepEqual([c.puts, c.events], [[], []]); };

test('startable: open, real, unblocked Works with no live run', () => {
  // w3 leased, w8 queued, w4 blocked, w5 waits on w4, w1 w2 w7 done, w10 cancelled
  assert.deepEqual(startable(sample()).map(w => w.id), ['w9']); // w6 waits in review
});

test('wake queues a sound item with a short task note and gives the Work to the Keeper', async () => {
  const c = wake(sample(), 'k4', 'w9', { note: '  Use the brand palette.  ' }, T0);
  assert.equal(c.problem, undefined);
  const item = c.puts.find(p => p.kind === 'queue').record;
  assert.equal(item.state, 'queued');
  assert.equal(item.createdAt, T0.toISOString());
  assert.equal(item.prompt, 'Work: Fix the logo colours\nNote: Use the brand palette.');
  assert.ok(!item.prompt.includes('quest-report') && !item.prompt.includes('branch')); // /work adds those on copy
  assert.deepEqual(c.events, [{ at: T0.toISOString(), kind: 'work.queued', ref: item.id }]);
  const l = await applied(sample(), c);
  assert.deepEqual(hard(l), []);
  assert.equal(l.works.find(w => w.id === 'w9').keeperId, 'k4');
  assert.ok(!startable(l).some(w => w.id === 'w9')); // now held by a live item
  assert.equal(wake(sample(), 'k4', 'w9', {}, T0).puts[0].record.prompt, 'Work: Fix the logo colours');
  assert.notEqual(wake(sample(), 'k4', 'w9', {}, T0).puts[0].record.id, item.id);
});

test('wake refuses resting Keepers, game-only, blocked, resolved and held Works, and an empty Well', () => {
  const l = sample();
  l.keepers.find(k => k.id === 'k4').status = 'resting';
  refused(wake(l, 'k4', 'w9', {}, T0));
  const lore = sample();
  lore.works.find(w => w.id === 'w9').mark = { status: 'sent', source: 'lore', sourceId: 'x', real: false, at: T0.toISOString() };
  refused(wake(lore, 'k4', 'w9', {}, T0));
  for (const id of ['w4', 'w5', 'w1', 'w10', 'w3', 'w8']) refused(wake(sample(), 'k4', id, {}, T0));
  refused(wake(sample(), 'nobody', 'w9', {}, T0));
  refused(wake(sample(), 'k4', 'nothing', {}, T0));
  const spent = sample();
  spent.queue[0].reports.push({ ...spent.queue[0].reports[0], usage: { input: 900000, output: 100000 }, at: '2026-10-03T11:00:00Z' });
  refused(wake(spent, 'k4', 'w9', {}, T0));
  assert.equal(wake(spent, 'k4', 'w9', {}, new Date('2026-10-05T12:00:00Z')).problem, undefined); // the window rolled on
});

test('rest and resume move a Keeper, and resume knows busy from free', async () => {
  const r = rest(sample(), 'k1', T0);
  assert.deepEqual(r.events, [{ at: T0.toISOString(), kind: 'keeper.rested', ref: 'k1' }]);
  let l = await applied(sample(), r);
  assert.equal(l.keepers.find(k => k.id === 'k1').status, 'resting');
  refused(rest(l, 'k1', T0));
  const back = resume(l, 'k1', T0);
  assert.equal(back.events[0].kind, 'keeper.resumed');
  assert.equal(back.puts[0].record.status, 'busy'); // k1 still holds leased q1
  l = await applied(sample(), rest(sample(), 'k4', T0));
  assert.equal(resume(l, 'k4', T0).puts[0].record.status, 'free'); // k4's q3 is only queued
  refused(resume(sample(), 'k4', T0)); // not resting
  const lost = sample();
  lost.keepers.find(k => k.id === 'k1').status = 'wandered';
  assert.equal(resume(lost, 'k1', T0).puts[0].record.status, 'busy'); // calling a wandered Keeper back
});

test('cancel stops a live run only where the queue allows it, and frees its Keeper', async () => {
  const c = cancel(sample(), 'q1', T0);
  assert.deepEqual(c.events, [{ at: T0.toISOString(), kind: 'work.cancelled', ref: 'q1' }]);
  const l = await applied(sample(), c);
  assert.equal(l.queue.find(q => q.id === 'q1').state, 'cancelled');
  assert.equal(l.keepers.find(k => k.id === 'k1').status, 'free');
  assert.deepEqual(hard(l), []);
  refused(cancel(l, 'q1', T0));          // cancelled is final
  refused(cancel(sample(), 'q2', T0));   // returned is final
  refused(cancel(sample(), 'nope', T0));
  // a Keeper with another leased run stays busy; a resting one stays resting
  const two = sample();
  two.queue.push({ ...two.queue[0], id: 'q9', workId: 'w9' });
  assert.equal(cancel(two, 'q1', T0).puts.length, 1);
  const tired = sample();
  tired.keepers.find(k => k.id === 'k1').status = 'resting';
  assert.equal(cancel(tired, 'q1', T0).puts.length, 1);
});

test('ringBell rests everyone and cancels every live run, leaving returned ones alone', async () => {
  const before = sample();
  before.queue.push({ ...before.queue[0], id: 'q4', state: 'lapsed', workId: 'w9', keeperId: 'k2' });
  const c = ringBell(before, T0);
  assert.deepEqual(c.events, [{ at: T0.toISOString(), kind: 'bell.rung', ref: null }]);
  const l = await applied(before, c);
  assert.ok(l.keepers.every(k => k.status === 'resting'));
  assert.deepEqual(l.queue.map(q => [q.id, q.state]), [['q1', 'cancelled'], ['q2', 'returned'], ['q3', 'cancelled'], ['q4', 'cancelled']]);
  assert.deepEqual(l.queue.find(q => q.id === 'q2'), before.queue.find(q => q.id === 'q2'));
  assert.ok(!l.queue.some(q => LIVE.includes(q.state)));
  assert.deepEqual(hard(l), []);
  assert.equal(ringBell(l, T0).puts.length, 0); // ringing again changes nothing but still rings
});

test('tokenReadout: Ember left of max, the last run, and the day\'s spend', () => {
  const r = tokenReadout(sample(), T0);
  assert.equal(r.emberMax, DEFAULT_RULES.emberMax);
  assert.equal(r.emberLeft, 100 - 51000 / DEFAULT_RULES.tokensPerEmber);
  assert.deepEqual(r.lastRun, { input: 42000, output: 9000 });
  assert.equal(r.spentToday, 5.1);
  const next = tokenReadout(sample(), new Date('2026-10-05T12:00:00Z'));
  assert.deepEqual([next.emberLeft, next.spentToday], [100, 0]); // spent Ember comes back as the window rolls
  assert.deepEqual(next.lastRun, { input: 42000, output: 9000 }); // the last run is still the last run
  const empty = { ...sample(), queue: [] };
  assert.deepEqual(tokenReadout(empty, T0), { emberLeft: 100, emberMax: 100, lastRun: null, spentToday: 0 });
});

// ---------- R5 Keeper states in the R4 controls ----------
test('a released Keeper is never woken, rested, rung home or offered a prompt', async () => {
  const { offerable } = await import('../public/quest/work-queue.js');
  const l = sample();
  l.keepers[3] = { ...l.keepers[3], status: 'released', releasedAt: '2026-10-03T10:00:00Z' };
  assert.ok(wake(l, 'k4', 'w9', {}, T0).problem);
  assert.ok(rest(l, 'k4', T0).problem);
  assert.ok(!ringBell(l, T0).puts.some(p => p.kind === 'keepers' && p.record.id === 'k4'));
  assert.ok(!offerable(l, T0).some(o => o.keeper.id === 'k4'));
  assert.ok(!keepersSplit(l).free.concat(keepersSplit(l).busy, keepersSplit(l).resting).some(k => k.id === 'k4'));
});

test('a summoned Keeper takes its trial Work and comes back summoned after resting', () => {
  const l = sample();
  l.keepers[3] = { ...l.keepers[3], status: 'summoned', summonedAt: '2026-10-03T10:00:00Z' };
  assert.equal(wake(l, 'k4', 'w9', {}, T0).problem, undefined);
  l.keepers[3].status = 'resting';
  assert.equal(resume(l, 'k4', T0).puts[0].record.status, 'summoned');
  assert.equal(keepersSplit({ keepers: [{ ...l.keepers[3], status: 'summoned' }] }).busy.length, 1);
});

test('cancels and the bell stamp cancelledAt; Works in review are not startable', () => {
  const l = sample();
  const at = T0.toISOString();
  assert.ok(ringBell(l, T0).puts.filter(p => p.kind === 'queue').every(p => p.record.cancelledAt === at));
  assert.ok(!startable(l).some(w => w.status === 'in_review'));
});

test('summon spends Ember through emberLeft, starts summoned, and refuses a poor Well or a bad name', async () => {
  const before = emberLeft(sample(), T0);
  const c = summon(sample(), { name: ' Ash ', role: 'builder', skills: ['code', ' '] }, T0);
  assert.equal(c.problem, undefined);
  const k = c.puts[0].record;
  assert.deepEqual([k.name, k.role, k.skills, k.status, k.summonedAt, k.joinedAt], ['Ash', 'builder', ['code'], 'summoned', T0.toISOString(), null]);
  assert.deepEqual(c.events, [{ at: T0.toISOString(), kind: 'keeper.summoned', ref: k.id }]);
  const l = await applied(sample(), c);
  assert.deepEqual(hard(l), []);
  assert.equal(emberLeft(l, T0), before - DEFAULT_RULES.summonCost);
  assert.equal(emberLeft(l, new Date('2026-10-05T13:00:00Z')), emberLeft(sample(), new Date('2026-10-05T13:00:00Z'))); // comes back
  refused(summon(sample(), { name: '  ' }, T0));
  refused(summon(sample(), { name: 'wren' }, T0)); // taken
  const poor = sample();
  poor.queue[0].reports.push({ ...poor.queue[0].reports[0], usage: { input: 950000, output: 0 }, at: '2026-10-03T11:00:00Z' });
  refused(summon(poor, { name: 'Ash' }, T0));
});

test('a summoned Keeper joins only when a Work it holds is approved (done), and rests stay rested', async () => {
  let l = await applied(sample(), summon(sample(), { name: 'Ash' }, T0));
  const k = l.keepers.find(x => x.name === 'Ash');
  assert.deepEqual(joinSummoned(l, T0).puts, []);
  l.works.find(w => w.id === 'w9').keeperId = k.id;
  l.works.find(w => w.id === 'w9').status = 'in_review'; // not approved yet
  assert.deepEqual(joinSummoned(l, T0), { puts: [], events: [] });
  l.works.find(w => w.id === 'w9').status = 'done';
  const later = new Date('2026-10-04T09:00:00Z');
  const c = joinSummoned(l, later);
  assert.deepEqual(c.events, [{ at: later.toISOString(), kind: 'keeper.joined', ref: k.id }]);
  const j = await applied(l, c);
  assert.deepEqual(hard(j), []);
  const ash = j.keepers.find(x => x.id === k.id);
  assert.deepEqual([ash.status, ash.joinedAt], ['free', later.toISOString()]);
  assert.deepEqual(joinSummoned(j, later), { puts: [], events: [] }); // joins once
  l.keepers.find(x => x.id === k.id).status = 'resting';
  assert.equal(joinSummoned(l, later).puts[0].record.status, 'resting');
  assert.ok(joinSummoned(sample(), T0).puts.length === 0); // old Keepers have no summonedAt
});

test('release retires a Keeper to the Hall of Champions, never deletes, and waits for live runs', async () => {
  const l = sample();
  const c = release(l, 'k2', T0);
  assert.deepEqual(c.events, [{ at: T0.toISOString(), kind: 'keeper.released', ref: 'k2' }]);
  const r = await applied(l, c);
  assert.deepEqual(hard(r), []);
  assert.equal(r.keepers.length, l.keepers.length);
  assert.deepEqual([r.keepers.find(k => k.id === 'k2').status, r.keepers.find(k => k.id === 'k2').releasedAt], ['released', T0.toISOString()]);
  assert.equal(r.works.length, l.works.length);
  refused(release(r, 'k2', T0));
  refused(release(l, 'nobody', T0));
  refused(release(l, 'k1', T0)); // k1 holds a leased run
  assert.ok(wake(r, 'k2', 'w9', {}, T0).problem);
});
