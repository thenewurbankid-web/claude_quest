// The event log's readers: the "while you were away" digest, its lines, question-to-answer time, session tracking.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLedger, memoryStore } from '../public/quest/contract.js';
import { lastSessionEnd, digest, digestLines, answerTimes, trackSession, resolveSince, realmStats, duration } from '../public/quest/digest.js';

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
  assert.deepEqual(t.items.map(({ ref, minutes }) => ({ ref, minutes })), [{ ref: 'a', minutes: 60 }, { ref: 'b', minutes: 10 }]);
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
  assert.deepEqual(answerTimes(sample()).items, [{ ref: 'r3', minutes: 17 * 60, at: '2026-09-29T10:00:00.000Z' }]);
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

test('realmStats: recent and all-time counts, answer time, play time, and who waits on you', () => {
  const NOW = new Date('2026-10-10T12:00:00Z');
  const l = sample();
  l.keepers = [{ id: 'k1', name: 'Bramble', role: 'x', skills: [], status: 'busy' }];
  l.works.find(w => w.id === 'w2').keeperId = 'k1';      // r3 (answered in the sample) is on w2
  l.events.push(
    ev('2026-10-09T10:00:00Z', 'session.start'), ev('2026-10-09T10:30:00Z', 'session.end'),
    ev('2026-10-10T11:50:00Z', 'session.start'),          // still playing: 10 min so far
    ev('2026-10-09T10:05:00Z', 'riddle.raised', 'n1'), ev('2026-10-09T10:25:00Z', 'riddle.answered', 'n1'),
    ev('2026-10-09T10:26:00Z', 'boss.defeated', 'b1'));
  const s = realmStats(l, NOW);
  assert.equal(s.days, 7);
  assert.equal(s.recent.sessions, 2);
  assert.equal(s.recent.playMinutes, 40);
  assert.deepEqual([s.recent.raised, s.recent.answered, s.recent.won, s.recent.medianMinutes], [1, 1, 1, 20]);
  assert.ok(s.all.raised > s.recent.raised);              // the sample's own history is older than a week
  assert.equal(s.all.medianMinutes, (20 + 17 * 60) / 2);
  const bramble = s.keepers.find(k => k.name === 'Bramble');
  assert.deepEqual([bramble.answered, bramble.medianMinutes], [1, 17 * 60]);
  const none = s.keepers.find(k => k.keeper === null);
  assert.equal(none.answered, 1);                         // n1 has no Riddle record, so no Keeper
  assert.ok(s.keepers.reduce((n, k) => n + k.waiting, 0) >= 1);
});

test('realmStats on an empty log, and duration', () => {
  const s = realmStats(withEvents([]), new Date('2026-10-10T12:00:00Z'));
  assert.deepEqual([s.all.raised, s.all.playMinutes, s.all.medianMinutes, s.keepers.length], [0, 0, null, 0]);
  assert.deepEqual([null, 4.4, 150, 4320].map(duration), ['—', '4 min', '2.5 h', '3 days']);
});
