// The Quest contract: the sample Realm is sound, problems are found, state moves are fixed, saves round-trip.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateLedger, emptyLedger, memoryStore, makeSave, ledgerFromSave, canMove, RIDDLE_MOVES, QUEUE_MOVES, stewardOf,
  DEFAULT_RULES, EVENT_KIND, applyChanges, mergeChanges, noChanges, validateBattle, BATTLE_MOVES,
} from '../public/quest/contract.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));

test('the sample Realm has only its one deliberate repair quest', () => {
  const problems = validateLedger(sample());
  assert.deepEqual(problems.map(p => [p.path, p.repair]), [['works[8].hallId', true]]);
});

test('an empty ledger is sound', () => assert.deepEqual(validateLedger(emptyLedger()), []));

test('bad values, unknown ids and duplicates are reported, not repaired', () => {
  const l = sample();
  l.works[0].status = 'finished';
  l.works[1].keeperId = 'nobody';
  l.halls.push({ ...l.halls[0] });
  l.riddles[2].sealed_by = null;
  const p = validateLedger(l).filter(p => !p.repair).map(p => p.path);
  assert.deepEqual(p.sort(), ['halls[4].id', 'riddles[2].sealed_by', 'works[0].status', 'works[1].keeperId'].sort());
});

test('a Work pointing at another March\'s Hall is a repair quest', () => {
  const l = sample();
  l.works[0].hallId = 'orchard-a';
  assert.ok(validateLedger(l).some(p => p.path === 'works[0].hallId' && p.repair));
});

test('Riddle and /work queue moves', () => {
  assert.ok(canMove(RIDDLE_MOVES, 'open', 'deferred'));      // ask me later is an answer
  assert.ok(canMove(RIDDLE_MOVES, 'answered', 'open'));      // recalled from the outbox
  assert.ok(!canMove(RIDDLE_MOVES, 'sealed', 'open'));       // sealed is final
  assert.ok(canMove(QUEUE_MOVES, 'leased', 'leased'));       // a progress paste renews the lease
  assert.ok(canMove(QUEUE_MOVES, 'lapsed', 'queued'));       // back on the board
  assert.ok(!canMove(QUEUE_MOVES, 'cancelled', 'returned')); // results for cancelled work are refused
});

test('memoryStore: put, remove, replace and subscribe; snapshots are copies', async () => {
  const s = memoryStore(sample());
  let seen = 0;
  const off = s.subscribe(() => seen++);
  await s.put('works', { ...(await s.snapshot()).works[2], status: 'in_review' });
  await s.remove('riddles', 'r2');
  const snap = await s.snapshot();
  assert.equal(snap.works[2].status, 'in_review');
  assert.equal(snap.riddles.length, 3);
  snap.works.length = 0;
  assert.equal((await s.snapshot()).works.length, 10);
  off();
  await s.replace(emptyLedger());
  assert.equal(seen, 2);
  await assert.rejects(() => s.put('nonsense', { id: 'x' }));
});

test('a save carries the full ledger and rebuilds it', () => {
  const l = sample();
  const save = makeSave(l, { pos: [3, 4] });
  assert.deepEqual(Object.keys(save.marches), ['ferry', 'orchard']);
  const back = ledgerFromSave(save);
  for (const k of ['marches', 'halls', 'works', 'keepers', 'riddles', 'queue', 'events'])
    assert.equal(back[k].length, l[k].length, k);
  assert.deepEqual(validateLedger(back).map(p => p.problem), ['"Fix the logo colours" belongs to no Hall']);
});

test('export without the ledger keeps only manifest and play', () => {
  const save = makeSave(sample(), { pos: [1, 1] }, { withLedger: false });
  assert.deepEqual(save.manifest.parts, ['manifest.json', 'play.json']);
  assert.equal(ledgerFromSave(save), null);
  assert.throws(() => ledgerFromSave({ manifest: { kind: 'quest-save' } }));
});

test('R1: outbox, deferral and fading each carry their time or note', () => {
  const l = sample();
  l.riddles[0] = { ...l.riddles[0], state: 'answered', answer: { text: 'Stripe', by: 'player', at: '2026-10-03T09:00:00Z' } };
  l.riddles[1] = { ...l.riddles[1], state: 'deferred' };
  l.riddles[3] = { ...l.riddles[3], state: 'faded', deferredUntil: null };
  const p = validateLedger(l).filter(p => !p.repair).map(p => p.path);
  assert.deepEqual(p.sort(), ['riddles[0].outboxUntil', 'riddles[1].deferredUntil', 'riddles[3].fadeNote']);
});

test('R1: only the steward seals; the Realm owner stands in for a March without one', () => {
  const l = sample();
  assert.equal(stewardOf(l, 'ferry'), 'player');
  assert.equal(stewardOf(l, 'orchard'), 'player'); // no steward: the Realm owner
  l.marches[0].steward = 'tamsin';
  l.riddles[2].steward = null;
  assert.deepEqual(validateLedger(l).filter(p => !p.repair).map(p => p.path), ['riddles[2].sealed_by']);
});

test('R1: a decision written back to a Work points at its Riddle', () => {
  const l = sample();
  assert.equal(l.works[1].decisions[0].riddleId, 'r3');
  l.works[1].decisions.push({ riddleId: 'r9', question: 'q', answer: '', sealed_by: 'player', at: 'x' });
  const p = validateLedger(l).filter(p => !p.repair).map(p => p.path);
  assert.deepEqual(p.sort(), ['works[1].decisions[1].answer', 'works[1].decisions[1].riddleId']);
});

test('R1: lore rule defaults and the events the Riddle slices log', () => {
  assert.ok(DEFAULT_RULES.outboxSeconds > 0 && DEFAULT_RULES.deferHours > 0 && DEFAULT_RULES.fadeDays > 0);
  assert.equal(DEFAULT_RULES.logResolved, 5);
  for (const k of ['riddle.recalled', 'riddle.sealed', 'riddle.returned', 'riddle.faded', 'riddle.proposed'])
    assert.ok(EVENT_KIND.includes(k), k);
  assert.deepEqual(validateLedger(sample()).map(p => p.path), ['works[8].hallId']); // the sample's R1 examples are sound
});

test('R1: Changes merge and apply puts before events', async () => {
  const s = memoryStore(sample());
  const r = (await s.snapshot()).riddles[1];
  const c = mergeChanges(noChanges(), { puts: [{ kind: 'riddles', record: { ...r, state: 'deferred', deferredUntil: 'x' } }],
    events: [{ at: 'x', kind: 'riddle.deferred', ref: r.id }] });
  await applyChanges(s, c);
  const l = await s.snapshot();
  assert.equal(l.riddles[1].state, 'deferred');
  assert.equal(l.events.at(-1).kind, 'riddle.deferred');
});

const battle = (o = {}) => ({ id: 'b1', startedAt: '2026-10-03T12:00:00Z', phase: 'fighting', score: 3.2, strength: 1,
  hp: 32, maxHp: 32, riddleIds: ['r2'], lodgeIds: ['r1'], resolvedIds: [], current: null, turn: 0, ...o });

test('R2: a battle is sound; it cannot fall or be won while a Riddle is unresolved', () => {
  assert.deepEqual(validateBattle(battle()), []);
  assert.deepEqual(validateBattle(battle({ hp: 0 })).map(p => p.path), ['hp']);
  assert.deepEqual(validateBattle(battle({ phase: 'won', hp: 0, resolvedIds: ['r2'] })).map(p => p.path), ['hp', 'phase']);
  assert.deepEqual(validateBattle(battle({ phase: 'won', hp: 0, resolvedIds: ['r2', 'r1'] })), []);
});

test('R2: confirm/never Riddles pause for the Lodge and are never asked in combat; retreat from any turn', () => {
  assert.deepEqual(validateBattle(battle({ phase: 'question', current: 'r1' })).map(p => p.path), ['current', 'current']);
  assert.deepEqual(validateBattle(battle({ phase: 'lodge', current: 'r1' })), []);
  for (const from of ['fighting', 'question', 'lodge']) assert.ok(canMove(BATTLE_MOVES, from, 'retreated'), from);
  assert.ok(!canMove(BATTLE_MOVES, 'won', 'fighting'));
  assert.ok(DEFAULT_RULES.bossThreshold > 0 && DEFAULT_RULES.mashBonus < 1);
  for (const k of ['boss.summoned', 'boss.retreated', 'boss.defeated']) assert.ok(EVENT_KIND.includes(k), k);
});
