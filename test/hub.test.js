import test from 'node:test';
import assert from 'node:assert/strict';
import { HUB, SOLID, START, TOWN, AREAS, COLS, ROWS } from '../public/3d/hub.js';

const at = (c, r) => HUB[r]?.[c];
const find = ch => { const out = []; HUB.forEach((row, r) => [...row].forEach((x, c) => { if (x === ch) out.push([c, r]); })); return out; };
const reach = (() => {
  const seen = new Set([START.join()]), queue = [START];
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const n = [c + dc, r + dr];
      if (at(...n) === undefined || SOLID.has(at(...n)) || seen.has(n.join())) continue;
      seen.add(n.join()); queue.push(n);
    }
  }
  return seen;
})();
const touches = ([c, r]) => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dc, dr]) => reach.has([c + dc, r + dr].join()));

test('the hub is 96x64 and every row is full width', () => {
  assert.equal(HUB.length, ROWS);
  assert.ok(HUB.every(row => row.length === COLS));
});

test('the landmarks exist once and can be reached on foot', () => {
  for (const ch of ['C', 'B', 'M', 'S', 'W']) {
    const spots = find(ch);
    assert.ok(spots.length >= 1, ch);
    if (ch !== 'C') assert.equal(spots.length, 1, ch);
    assert.ok(spots.some(touches), `${ch} is reachable`);
  }
  assert.ok(!SOLID.has(at(...START)) && reach.has(START.join()));
});

test('the old town keeps its place in the middle', () => {
  assert.deepEqual(TOWN, [36, 24]);
  assert.deepEqual(AREAS.town, [36, 24, 59, 39]);
});

test('the streets run to the edges of the map', () => {
  assert.ok(reach.has('0,31') && reach.has(`${COLS - 1},32`));
  assert.ok(reach.has('47,0') && reach.has(`47,${ROWS - 1}`));
});

test('each district has its features and is walkable from the start', () => {
  const inside = ([c0, r0, c1, r1]) => (ch) => find(ch).filter(([c, r]) => c >= c0 && c <= c1 && r >= r0 && r <= r1);
  const market = inside(AREAS.market), docks = inside(AREAS.docks), forest = inside(AREAS.forest);
  assert.ok(market('K').length >= 8 && market('K').every(touches));
  assert.ok(market('L').length >= 4);
  assert.ok(docks('~').length > 100 && docks('P').length >= 20);
  assert.ok(docks('P').every(p => reach.has(p.join())), 'every plank can be walked to');
  assert.ok(docks('P').some(([c, r]) => at(c, r + 1) === '~'), 'the pier reaches out over the water');
  assert.ok(forest('H').some(touches), 'the clearing hut is reachable');
  assert.ok(forest('T').length > 300);
  assert.ok(inside(AREAS.lodge)('F').length >= 8);
});

test('the map stays light enough for a phone: objects are chunked, so keep the static count bounded', () => {
  const count = ch => find(ch).length;
  assert.ok(count('T') < 0.3 * COLS * ROWS);
  assert.ok(count('K') + count('L') + count('H') < 80);
});
