// CLA-15, Marches as 3D regions: regions from the ledger (with and without real Marches), region maps, hub gates.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLedger } from '../public/quest/contract.js';
import { regionsOf, postLines, DEFAULT_REGIONS, MAX_POSTS } from '../public/quest/regions.js';
import { LORE_MARCH } from '../public/quest/area-lore.js';
import { regionMap, hubGates, GATE_SLOTS, REGION_COLS, REGION_ROWS } from '../public/3d/region-map.js';
import { HUB, SOLID } from '../public/3d/hub.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const work = (i, marchId, status = 'todo') => ({ id: `x${i}`, marchId, hallId: null, title: `Work ${i}`, status, priority: 'low', createdAt: '2026-10-01T00:00:00Z', updatedAt: `2026-10-01T00:${String(i % 60).padStart(2, '0')}:00Z` });

test('regions: one per March from the ledger, Works as posts, the most urgent first', () => {
  const rs = regionsOf(sample());
  assert.deepEqual(rs.map(r => [r.id, r.name, r.generated]), [['ferry', 'The Ferry March', false], ['orchard', 'The Orchard March', false]]);
  const ferry = rs[0];
  assert.equal(ferry.posts.length, 6);
  assert.equal(ferry.posts[0].status, 'blocked');
  assert.equal(ferry.posts.at(-1).status, 'cancelled');
  assert.equal(ferry.hidden, 0);
});

test('regions: local ledger mode, no Marches (or only Town news) gives the default explorable set', () => {
  for (const l of [emptyLedger({ id: 'local', name: 'Local', owner: 'player' }),
    { ...emptyLedger({ id: 'local', name: 'Local', owner: 'player' }), marches: [LORE_MARCH] }]) {
    const rs = regionsOf(l);
    assert.equal(rs.length, 4);
    assert.deepEqual(rs.map(r => r.id), DEFAULT_REGIONS.map(r => r.id));
    assert.ok(rs.every(r => r.generated && r.posts.length === 0 && r.marchId === null));
  }
  assert.equal(regionsOf(null).length, 4);
});

test('regions: a local ledger Hall-and-Work March becomes a region, and the defaults go away', () => {
  const l = emptyLedger({ id: 'local', name: 'Local', owner: 'player' });
  l.marches.push({ id: 'm1', name: 'Docs', banner: '#abcdef', steward: null });
  l.works.push(work(1, 'm1'));
  const rs = regionsOf(l);
  assert.deepEqual(rs.map(r => [r.id, r.generated, r.posts.length]), [['m1', false, 1]]);
});

test('regions: game-only Works never appear, and posts are capped with the rest counted', () => {
  const l = sample();
  l.works.push({ ...work(99, 'ferry'), mark: { status: 'sent', source: 'lore', sourceId: 'x', real: false, at: '2026-10-01T00:00:00Z' } });
  assert.ok(regionsOf(l).find(r => r.id === 'ferry').posts.every(p => p.workId !== 'x99'));
  for (let i = 0; i < 30; i++) l.works.push(work(i, 'orchard'));
  const orchard = regionsOf(l).find(r => r.id === 'orchard');
  assert.equal(orchard.posts.length, MAX_POSTS);
  assert.equal(orchard.hidden, 4 + 30 - MAX_POSTS);
});

test('regions: reading a post gives plain text lines, and an open question is mentioned', () => {
  const l = sample();
  const lines = postLines(l, 'w4');
  assert.equal(lines[0], 'Payment provider');
  assert.match(lines[1], /blocked · critical/);
  assert.ok(lines.some(x => /question/.test(x)));
  assert.equal(postLines(l, 'nope'), null);
  l.works[0].title = '<img src=x onerror=alert(1)>';
  assert.equal(postLines(l, 'w1')[0], '<img src=x onerror=alert(1)>'); // verbatim; the box shows it with textContent
});

const walk = (rows, from, ok) => {
  const seen = new Set([from.join(',')]), q = [from];
  while (q.length) {
    const [c, r] = q.shift();
    for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const n = [c + dc, r + dr], k = n.join(',');
      if (seen.has(k) || !rows[n[1]]?.[n[0]] || !ok(rows[n[1]][n[0]], n)) continue;
      seen.add(k); q.push(n);
    }
  }
  return seen;
};

test('region map: fixed size, one gate, every post reachable from the start, same id same map', () => {
  for (const id of ['ferry', 'orchard', 'default-fernwood', 'a', 'b', 'c']) {
    for (const n of [0, 1, 7, MAX_POSTS]) {
      const reg = { id, posts: Array.from({ length: n }, (_, i) => ({ workId: `w${i}` })) };
      const m = regionMap(reg);
      assert.equal(m.rows.length, REGION_ROWS);
      assert.ok(m.rows.every(r => r.length === REGION_COLS));
      assert.equal(m.rows.join('').split('G').length - 1, 1);
      assert.equal(m.rows[m.gate[1]][m.gate[0]], 'G');
      assert.equal(m.posts.length, n);
      assert.equal(m.rows.join('').split('P').length - 1, n);
      const ok = ch => !SOLID.has(ch) && ch !== 'P';
      const reach = walk(m.rows, m.start, ok);
      assert.ok(reach.has(m.gate.join(',')), `${id}: the gate is reachable`);
      for (const p of m.posts) {
        const beside = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dc, dr]) => reach.has(`${p.c + dc},${p.r + dr}`));
        assert.ok(beside, `${id}: post ${p.workId} has a reachable cell beside it`);
      }
      assert.deepEqual(regionMap(reg), m);
    }
  }
});

test('region map: hub gates sit on road cells at the map edge, one per region up to the slots', () => {
  for (const s of GATE_SLOTS) {
    assert.equal(HUB[s.r][s.c], '=', `gate slot ${s.c},${s.r}`);
    assert.equal(HUB[s.inward[1]][s.inward[0]], '=', `inward cell of ${s.c},${s.r}`);
    assert.ok(s.c === 0 || s.r === 0 || s.c === HUB[0].length - 1 || s.r === HUB.length - 1);
  }
  assert.equal(new Set(GATE_SLOTS.map(s => `${s.c},${s.r}`)).size, GATE_SLOTS.length);
  const four = hubGates(regionsOf(emptyLedger({ id: 'l', name: 'L', owner: 'p' })));
  assert.equal(four.gates.length, 4);
  assert.equal(four.hidden, 0);
  const many = hubGates(Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, banner: '#fff' })));
  assert.equal(many.gates.length, GATE_SLOTS.length);
  assert.equal(many.hidden, 3);
});

test('the renderer has no special case for a source or for the default regions', () => {
  const scene = readFileSync(new URL('../public/3d/scene.js', import.meta.url), 'utf8');
  assert.ok(!/paperclip|default-|generated/i.test(scene));
});
