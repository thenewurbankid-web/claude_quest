// The event log's readers: the "while you were away" digest, its lines, question-to-answer time, session tracking.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLedger, memoryStore } from '../public/quest/contract.js';
import { lastSessionEnd, digest, digestLines, answerTimes, trackSession, resolveSince } from '../public/quest/digest.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const withEvents = events => ({ ...emptyLedger(), events });
const ev = (at, kind, ref = null) => ({ at, kind, ref });
const tick = () => new Promise(r => setTimeout(r, 0));

test('lastSessionEnd: the latest session.end by time, or null', () => {
  assert.equal(lastSessionEnd([]), null);
  assert.equal(lastSessionEnd([ev('2026-10-01T00:00:00Z', 'session.start')]), null);
  assert.equal(lastSessionEnd([
    ev('2026-10-02T00:00:00Z', 'session.end'), ev('2026-10-01T00:00:00Z', 'session.end'),
    ev('2026-10-03T00:00:00Z', 'session.start'),
  ]), '2026-10-02T00:00:00Z');
});

test('digest: counts only events strictly after since; null counts the whole log', () => {
  const l = withEvents([
    ev('2026-10-01T00:00:00Z', 'riddle.raised', 'a'),
    ev('2026-10-01T12:00:00Z', 'session.end'),
    ev('2026-10-01T12:00:00Z', 'riddle.raised', 'b'), // at the boundary: not after
    ev('2026-10-02T00:00:00Z', 'riddle.raised', 'c'), ev('2026-10-02T00:00:00Z', 'riddle.raised', 'd'),
    ev('2026-10-02T01:00:00Z', 'riddle.answered', 'c'), ev('2026-10-02T01:00:10Z', 'riddle.sealed', 'c'),
    ev('2026-10-02T02:00:00Z', 'riddle.returned', 'a'), ev('2026-10-02T03:00:00Z', 'riddle.faded', 'e'),
    ev('2026-10-02T04:00:00Z', 'agent.blocked', 'w1'), ev('2026-10-02T05:00:00Z', 'agent.unblocked', 'w1'),
    ev('2026-10-02T06:00:00Z', 'riddle.deferred', 'd'), ev('2026-10-02T07:00:00Z', 'session.start'),
  ]);
  const since = lastSessionEnd(l.events);
  assert.deepEqual(digest(l, since), { since: '2026-10-01T12:00:00Z', raised: 2, answered: 1, sealed: 1, returned: 1,
    faded: 1, blocked: 1, unblocked: 1 });
  assert.equal(digest(l, null).raised, 4);
  assert.equal(digest(l, null).since, null);
  assert.deepEqual(digest(l, '2026-10-09T00:00:00Z'), { since: '2026-10-09T00:00:00Z', raised: 0, answered: 0,
    sealed: 0, returned: 0, faded: 0, blocked: 0, unblocked: 0 });
});

test('digest: the sample Realm since 1 October', () => {
  const d = digest(sample(), '2026-10-01T00:00:00Z');
  assert.equal(d.raised, 3);
  assert.equal(d.answered, 0);
});

test('digestLines: nothing happened is an empty list', () => {
  assert.deepEqual(digestLines(digest(withEvents([]), null)), []);
});

test('digestLines: singular and plural', () => {
  assert.deepEqual(digestLines({ since: null, raised: 2, answered: 0, sealed: 1, returned: 1, faded: 0, blocked: 0,
    unblocked: 0 }), ['2 Riddles arrived', '1 decision was sealed', "1 Riddle came back from 'ask me later'"]);
  assert.deepEqual(digestLines({ since: null, raised: 1, answered: 1, sealed: 3, returned: 2, faded: 2, blocked: 1,
    unblocked: 2 }), ['1 Riddle arrived', '1 Riddle was answered', '3 decisions were sealed',
    "2 Riddles came back from 'ask me later'", '2 Riddles faded', '1 Keeper got stuck', '2 Keepers got going again']);
  assert.deepEqual(digestLines({ since: null, raised: 0, answered: 2, sealed: 0, returned: 0, faded: 1, blocked: 3,
    unblocked: 1 }), ['2 Riddles were answered', '1 Riddle faded', '3 Keepers got stuck', '1 Keeper got going again']);
});

test('answerTimes: first raised to last answered; a recall then re-answer counts the final answer', () => {
  const l = withEvents([
    ev('2026-10-01T10:00:00Z', 'riddle.raised', 'a'),
    ev('2026-10-01T10:30:00Z', 'riddle.answered', 'a'),
    ev('2026-10-01T10:31:00Z', 'riddle.recalled', 'a'),
    ev('2026-10-01T11:00:00Z', 'riddle.answered', 'a'), // final: 60 minutes
    ev('2026-10-01T12:00:00Z', 'riddle.raised', 'b'),
    ev('2026-10-01T12:00:00Z', 'riddle.deferred', 'b'),
    ev('2026-10-02T12:00:00Z', 'riddle.returned', 'b'),
    ev('2026-10-02T12:00:00Z', 'riddle.raised', 'b'), // a later raise does not reset the clock
    ev('2026-10-01T12:10:00Z', 'riddle.answered', 'b'), // out of order in the log: still 10 minutes
    ev('2026-10-01T13:00:00Z', 'riddle.raised', 'never'),
    ev('2026-10-01T13:00:00Z', 'riddle.answered', 'orphan'), // never raised: left out
  ]);
  const t = answerTimes(l);
  assert.equal(t.count, 2);
  assert.deepEqual(t.items, [{ ref: 'a', minutes: 60 }, { ref: 'b', minutes: 10 }]);
  assert.equal(t.medianMinutes, 35);
});

test('answerTimes: odd count median, empty log, and the sample Realm', () => {
  const l = withEvents([
    ev('2026-10-01T00:00:00Z', 'riddle.raised', 'x'), ev('2026-10-01T00:05:00Z', 'riddle.answered', 'x'),
    ev('2026-10-01T00:00:00Z', 'riddle.raised', 'y'), ev('2026-10-01T01:00:00Z', 'riddle.answered', 'y'),
    ev('2026-10-01T00:00:00Z', 'riddle.raised', 'z'), ev('2026-10-01T00:20:00Z', 'riddle.answered', 'z'),
  ]);
  assert.equal(answerTimes(l).medianMinutes, 20);
  assert.deepEqual(answerTimes(withEvents([])), { count: 0, medianMinutes: null, items: [] });
  assert.deepEqual(answerTimes(sample()), { count: 1, medianMinutes: 17 * 60, items: [{ ref: 'r3', minutes: 17 * 60 }] });
});

test('trackSession: start now, one end per hide, a new start on return, and stop() detaches', async () => {
  const store = memoryStore();
  const target = new EventTarget();
  target.document = { visibilityState: 'visible' };
  let clock = Date.parse('2026-10-03T09:00:00Z');
  const now = () => new Date(clock);
  const kinds = async () => (await store.snapshot()).events.map(e => `${e.kind}@${e.at.slice(11, 16)}`);

  const stop = trackSession(store, { now, target });
  await tick();
  assert.deepEqual(await kinds(), ['session.start@09:00']);

  clock += 30 * 60000;
  target.document.visibilityState = 'hidden';
  target.dispatchEvent(new Event('visibilitychange'));
  target.dispatchEvent(new Event('pagehide')); // the same hide: no second end
  await tick();
  assert.deepEqual(await kinds(), ['session.start@09:00', 'session.end@09:30']);

  clock += 60 * 60000;
  target.document.visibilityState = 'visible';
  target.dispatchEvent(new Event('visibilitychange'));
  target.dispatchEvent(new Event('pageshow')); // the same return: no second start
  await tick();
  clock += 5 * 60000;
  target.dispatchEvent(new Event('pagehide'));
  await tick();
  assert.deepEqual(await kinds(), ['session.start@09:00', 'session.end@09:30', 'session.start@10:30',
    'session.end@10:35']);

  stop();
  target.dispatchEvent(new Event('pageshow'));
  await tick();
  assert.equal((await kinds()).length, 4);
  assert.equal(lastSessionEnd((await store.snapshot()).events), '2026-10-03T10:35:00.000Z');
});

test('resolveSince: the given since wins (null included); otherwise the last session.end at mount', async () => {
  const store = memoryStore(withEvents([
    ev('2026-10-01T00:00:00Z', 'session.end'), ev('2026-10-02T00:00:00Z', 'riddle.raised', 'a'),
  ]));
  const atMount = (await store.snapshot()).events;
  const target = new EventTarget();
  trackSession(store, { target, now: () => new Date('2026-10-03T00:00:00Z') });
  target.dispatchEvent(new Event('pagehide')); // a later end doesn't move the mount's since
  await tick();
  assert.equal(resolveSince(undefined, atMount), '2026-10-01T00:00:00Z');
  assert.equal(digest(await store.snapshot(), resolveSince(undefined, atMount)).raised, 1);
  assert.equal(resolveSince(null, atMount), null);
  assert.equal(resolveSince('2026-09-01T00:00:00Z', atMount), '2026-09-01T00:00:00Z');
  assert.equal(resolveSince(undefined, []), null);
});
