// The Realm's status: Beacon colours and reasons, the in-game log, Sealed Halls locked or open, Keepers free or busy.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLedger } from '../public/quest/contract.js';
import { beacon, gameLog, sealedHalls, keepers } from '../public/quest/status.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));

// A one-March ledger with the given Works and Riddles.
const tiny = ({ works = [], riddles = [], halls = [{ id: 'h', marchId: 'm', name: 'Hall', status: 'active', order: 1 }] } = {}) => {
  const l = emptyLedger({ id: 'r', name: 'Tiny', owner: 'player' });
  l.marches = [{ id: 'm', name: 'The March', banner: '#888', steward: null }];
  l.halls = halls;
  l.works = works.map((w, i) => ({ id: `w${i}`, marchId: 'm', hallId: 'h', title: `Work ${i}`, status: 'todo',
    priority: 'medium', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...w }));
  l.riddles = riddles.map((r, i) => ({ id: `r${i}`, workId: 'w0', marchId: 'm', text: `Riddle ${i}?`, risk: 'normal',
    state: 'open', steward: null, raisedAt: '2026-10-01T00:00:00Z', ...r }));
  return l;
};

test('Beacon: the sample Realm is red from Payment provider; the Orchard is amber', () => {
  const b = beacon(sample());
  assert.equal(b.color, 'red');
  assert.equal(b.marches.ferry.color, 'red');
  assert.equal(b.marches.orchard.color, 'amber');
  assert.ok(b.reasons.includes('Payment provider is blocked'));
  assert.ok(b.reasons.includes('Payment provider failed once'));
  assert.ok(b.marches.orchard.reasons.includes('Plant catalogue import is in review'));
  assert.equal(b.reasons[0], 'Payment provider is blocked'); // red reasons come first
});

test('Beacon: gold when nothing waits, and for an empty Realm', () => {
  assert.deepEqual(beacon(tiny({ works: [{ status: 'in_progress' }, { status: 'done' }] })).color, 'gold');
  assert.deepEqual(beacon(emptyLedger()), { color: 'gold', reasons: [], marches: {} });
});

test('Beacon: red for urgent blocked or failed Works, amber for the rest', () => {
  assert.equal(beacon(tiny({ works: [{ status: 'blocked', priority: 'high' }] })).color, 'red');
  assert.equal(beacon(tiny({ works: [{ status: 'in_progress', failures: 2 }] })).color, 'red');
  assert.equal(beacon(tiny({ works: [{ status: 'blocked', priority: 'low' }] })).color, 'amber');
  assert.equal(beacon(tiny({ works: [{ status: 'in_review' }] })).color, 'amber');
  assert.equal(beacon(tiny({ works: [{}], riddles: [{ state: 'deferred' }] })).color, 'amber');
  // resolved Works and settled Riddles no longer count
  assert.equal(beacon(tiny({ works: [{ status: 'cancelled', priority: 'critical', failures: 3 }],
    riddles: [{ state: 'faded' }] })).color, 'gold');
});

test('Beacon: unblocking Payment provider leaves the sample amber only if failures are cleared too', () => {
  const l = sample();
  const w4 = l.works.find(w => w.id === 'w4');
  w4.status = 'in_progress';
  assert.equal(beacon(l).marches.ferry.color, 'red'); // it still failed once
  w4.failures = 0;
  assert.equal(beacon(l).marches.ferry.color, 'amber'); // r1 still waits
});

test('log: open items and the last 5 resolved, newest first', () => {
  const log = gameLog(sample());
  assert.deepEqual(log.open.map(i => i.id), ['r2', 'w6', 'r1', 'w4', 'r4']);
  assert.equal(log.open[0].text, 'The import dropped 12 rows with no Latin name. Keep them or skip them?');
  assert.deepEqual(log.resolved.map(i => i.id), ['w7', 'w10', 'w2', 'r3', 'w1']);
  assert.equal(log.resolved[1].text, 'Refund policy copy is cancelled');
  for (const i of [...log.open, ...log.resolved]) assert.deepEqual(Object.keys(i).slice(0, 5), ['kind', 'id', 'marchId', 'text', 'at']);
});

test('log: the resolved limit holds, and leased /work items are open', () => {
  const l = sample();
  l.queue = [{ id: 'q1', keeperId: 'k1', workId: 'w3', prompt: 'p', state: 'leased', leaseUntil: '2026-10-03T12:00:00Z',
    createdAt: '2026-10-03T11:00:00Z' }, { id: 'q2', keeperId: 'k2', workId: 'w4', prompt: 'p', state: 'returned',
    createdAt: '2026-10-03T11:30:00Z' }];
  const log = gameLog(l, { resolved: 2 });
  assert.deepEqual(log.resolved.map(i => i.id), ['w7', 'w10']);
  assert.deepEqual(log.open[0], { kind: 'queue', id: 'q1', marchId: 'ferry', text: 'Bramble is working on Pricing page',
    at: '2026-10-03T11:00:00Z' });
  assert.ok(!log.open.some(i => i.id === 'q2'));
  assert.deepEqual(gameLog(l, { resolved: 0 }).resolved, []);
});

test('Sealed Halls: achieved or all-resolved Halls open; empty and unfinished Halls stay locked', () => {
  const halls = sealedHalls(sample());
  assert.deepEqual(halls.map(h => [h.id, h.locked, h.done, h.total]), [
    ['ferry-a', false, 2, 2], ['ferry-b', true, 1, 4], ['orchard-a', true, 1, 2], ['orchard-b', true, 0, 1],
  ]);
  const empty = sealedHalls(tiny());
  assert.deepEqual(empty, [{ id: 'h', marchId: 'm', name: 'Hall', order: 1, locked: true, done: 0, total: 0 }]);
  const finished = sealedHalls(tiny({ works: [{ status: 'done' }, { status: 'cancelled' }] }));
  assert.equal(finished[0].locked, false);
  const achievedEmpty = sealedHalls(tiny({ halls: [{ id: 'h', marchId: 'm', name: 'Hall', status: 'achieved', order: 1 }] }));
  assert.equal(achievedEmpty[0].locked, false);
});

test('Keepers split into free, busy and resting', () => {
  const k = keepers(sample());
  assert.deepEqual(k.free.map(x => x.name), ['Wren']);
  assert.deepEqual(k.busy.map(x => x.name), ['Bramble', 'Quill', 'Moss']);
  assert.deepEqual(k.resting, []);
  assert.deepEqual(keepers(emptyLedger()), { free: [], busy: [], resting: [] });
});
