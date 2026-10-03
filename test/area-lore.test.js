// R3 Lore quests, the client: geohash cells, reading a lore folder, the calendar fallback, the ledger mapping, and
// the safety line: lore never moves the boss, the Haze, the Beacon, the stats board or the digest.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger, validateAreaLore, emptyLedger, isGameOnly, applyChanges, memoryStore } from '../public/quest/contract.js';
import { geohash, cellBounds, cellAndNeighbours, fetchAreaLore, calendarLore, boardLore, seasonOf, loreChanges,
  LORE_MARCH } from '../public/quest/area-lore.js';
import { bossScore, shouldSummon, emptyBossPlay } from '../public/quest/boss.js';
import { riddleWeight, answerRiddle, ASK_LATER } from '../public/quest/riddles.js';
import { realmStats, digest, answerTimes } from '../public/quest/digest.js';
import { sealDue } from '../public/quest/outbox.js';
import { beacon } from '../public/quest/status.js';

const LORE = new URL('../public/quest/sample-lore/', import.meta.url);
const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const fileFetch = async url => {
  try { const body = readFileSync(url); return { ok: true, json: async () => JSON.parse(body) }; }
  catch { return { ok: false, status: 404, json: async () => null }; }
};
const NOW = new Date('2026-10-04T12:00:00Z');

test('geohash: known cells, bounds that hold the point, and 8 distinct neighbours', () => {
  assert.equal(geohash(51.5074, -0.1278), 'gcpv');     // London
  assert.equal(geohash(57.64911, 10.40744, 6), 'u4pruy'); // the geohash.org example
  const b = cellBounds('gcpv');
  assert.ok(b.lat[0] <= 51.5074 && 51.5074 < b.lat[1] && b.lon[0] <= -0.1278 && -0.1278 < b.lon[1]);
  const n = cellAndNeighbours('gcpv');
  assert.equal(n[0], 'gcpv');
  assert.equal(new Set(n).size, 9);
  assert.ok(n.includes('gcpu') && n.includes('gcpy')); // west and east
  assert.equal(new Set(cellAndNeighbours(geohash(10, 179.9))).size, 9); // wraps the date line
});

test('fetchAreaLore: reads live entries for reachable cells and skips missing ones', async () => {
  const { entries, reached } = await fetchAreaLore(LORE, cellAndNeighbours('gcpv'), { now: NOW, fetchFn: fileFetch });
  assert.deepEqual(reached, ['gcpv']);
  assert.deepEqual(entries.map(e => e.id).sort(), ['bards-at-the-lodge', 'harvest-stalls', 'rain-on-the-hollow']);
  const before = await fetchAreaLore(LORE, ['gcpv'], { now: new Date('2026-10-01T00:00:00Z'), fetchFn: fileFetch });
  assert.deepEqual(before.entries, []); // not started yet
  assert.deepEqual(before.reached, ['gcpv']);
});

test('fetchAreaLore: a bad entry or one filed under the wrong cell is dropped', async () => {
  const files = {
    'gcpv/index.json': { version: 1, cell: 'gcpv', updatedAt: NOW.toISOString(), entries: [
      { id: 'ok', kind: 'music', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-09T00:00:00Z' },
      { id: 'bad', kind: 'music', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-09T00:00:00Z' },
      { id: 'moved', kind: 'music', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-09T00:00:00Z' }] },
    'gcpv/ok.json': { ...JSON.parse(readFileSync(new URL('gcpv/bards-at-the-lodge.json', LORE))), id: 'ok' },
    'gcpv/bad.json': { id: 'bad', cell: 'gcpv', kind: 'politics' },
    'gcpv/moved.json': { ...JSON.parse(readFileSync(new URL('gcpv/bards-at-the-lodge.json', LORE))), id: 'moved', cell: 'gcpu' },
  };
  const fetchFn = async url => {
    const k = String(url).split('/lore/')[1];
    return files[k] ? { ok: true, json: async () => files[k] } : { ok: false, status: 404 };
  };
  const { entries } = await fetchAreaLore('https://x.test/lore/', ['gcpv'], { now: NOW, fetchFn });
  assert.deepEqual(entries.map(e => e.id), ['ok']);
});

test('calendarLore: never empty, always valid, and it follows the clock', () => {
  for (const h of [0, 4, 6, 13, 19, 23]) {
    const now = new Date(2026, 9, 5, h, 30); // a Monday
    const es = calendarLore('gcpv', now);
    assert.equal(es.length, 2, `${h}h`);
    for (const e of es) {
      assert.deepEqual(validateAreaLore(e), [], `${h}h ${e.id}`);
      assert.ok(Date.parse(e.startsAt) <= now.getTime() && now.getTime() < Date.parse(e.endsAt), `${h}h ${e.id} is live`);
    }
  }
  const sat = calendarLore('gcpv', new Date(2026, 9, 3, 10));
  assert.ok(sat.some(e => e.id.startsWith('cal-weekend-2026-10-03')));
  const sun = calendarLore('gcpv', new Date(2026, 9, 4, 10));
  assert.ok(sun.some(e => e.id === 'cal-weekend-2026-10-03')); // the same weekend, the same entry
  assert.equal(seasonOf(new Date(2026, 6, 1)), 'summer');
  assert.equal(seasonOf(new Date(2026, 6, 1), -34), 'winter');
  assert.equal(boardLore([], 'gcpv', NOW).every(e => e.kind === 'calendar'), true);
  assert.equal(boardLore([{ id: 'x' }], 'gcpv', NOW).length, 1);
});

const withLore = async (base = sample(), entries) => {
  const s = memoryStore(base);
  await applyChanges(s, loreChanges(await s.snapshot(), entries, NOW));
  return s;
};
const sampleEntries = async () => (await fetchAreaLore(LORE, ['gcpv'], { now: NOW, fetchFn: fileFetch })).entries;

test('loreChanges: one Town news March and Lore Hall, a Work and a game-only Riddle per entry, idempotent', async () => {
  const entries = await sampleEntries();
  const s = await withLore(emptyLedger(), entries);
  const l = await s.snapshot();
  assert.deepEqual(validateLedger(l), []);
  assert.deepEqual(l.marches.map(m => m.id), [LORE_MARCH.id]);
  assert.equal(l.works.length, 3);
  assert.equal(l.riddles.length, 3);
  assert.ok([...l.works, ...l.riddles].every(isGameOnly));
  assert.ok(l.riddles.every(r => r.mark.source === 'lore' && r.mark.real === false && r.options.at(-1) === ASK_LATER));
  assert.deepEqual(l.riddles.find(r => r.id.endsWith('harvest-stalls')).options, ['Done', ASK_LATER]); // an errand
  const again = loreChanges(l, entries, NOW);
  assert.deepEqual(again, { puts: [], events: [] });
});

test('loreChanges: an ended entry fades its open Riddle and cancels its Work; a sealed one is done', async () => {
  const entries = await sampleEntries();
  const s = await withLore(emptyLedger(), entries);
  let l = await s.snapshot();
  const bards = l.riddles.find(r => r.id.endsWith('bards-at-the-lodge'));
  await applyChanges(s, answerRiddle(l, bards.id, { text: 'Let them choose', by: l.realm.owner }, NOW));
  await applyChanges(s, sealDue(await s.snapshot(), new Date(NOW.getTime() + 60e3)));
  await applyChanges(s, loreChanges(await s.snapshot(), entries, NOW));
  l = await s.snapshot();
  assert.equal(l.works.find(w => w.id === bards.workId).status, 'done');
  const later = new Date('2031-01-01T00:00:00Z');
  await applyChanges(s, loreChanges(l, [], later));
  l = await s.snapshot();
  assert.ok(l.riddles.filter(r => !r.id.endsWith('bards-at-the-lodge')).every(r => r.state === 'faded' && r.fadeNote));
  assert.ok(l.works.filter(w => w.id !== bards.workId).every(w => w.status === 'cancelled'));
  assert.deepEqual(validateLedger(l), []);
});

test('safety: lore never moves the Gloamwyrm, the Haze, the Beacon, the stats board or the digest', async () => {
  const base = sample();
  const before = { score: bossScore(base, NOW), summon: shouldSummon(base, emptyBossPlay(), NOW), beacon: beacon(base).color,
    stats: realmStats(base, NOW), digest: digest(base, null), times: answerTimes(base) };
  // many old, put-off lore Riddles: real ones like these would summon the boss
  const many = Array.from({ length: 12 }, (_, i) => ({ ...JSON.parse(readFileSync(new URL('gcpv/bards-at-the-lodge.json', LORE))),
    id: `lore-${i}` }));
  const s = await withLore(sample(), many);
  let l = await s.snapshot();
  for (const r of l.riddles.filter(isGameOnly).slice(0, 4)) await applyChanges(s, answerRiddle(await s.snapshot(), r.id, { text: ASK_LATER, by: l.realm.owner }, NOW));
  for (const r of l.riddles.filter(isGameOnly).slice(4, 8)) await applyChanges(s, answerRiddle(await s.snapshot(), r.id, { text: 'A', by: l.realm.owner }, NOW));
  await applyChanges(s, sealDue(await s.snapshot(), new Date(NOW.getTime() + 60e3)));
  l = await s.snapshot();
  assert.ok(l.riddles.filter(isGameOnly).every(r => riddleWeight(r, new Date('2026-12-01'), undefined) === 0));
  assert.deepEqual(bossScore(l, NOW), before.score);
  assert.equal(shouldSummon(l, emptyBossPlay(), NOW), before.summon);
  assert.equal(beacon(l).color, before.beacon);
  assert.deepEqual(realmStats(l, NOW).keepers, before.stats.keepers);
  assert.deepEqual(realmStats(l, NOW).all, before.stats.all);
  assert.deepEqual(digest(l, null), before.digest);
  assert.deepEqual(answerTimes(l), before.times);
});
