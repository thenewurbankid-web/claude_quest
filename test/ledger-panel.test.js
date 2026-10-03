// The Ledger panel's pure helpers: grouping for display, and new records that pass the contract's validation.
// The DOM and the IndexedDB store are checked by hand on quest/dev-ledger.html (Node has neither).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger, emptyLedger } from '../public/quest/contract.js';
import { groupLedger, newMarch, newHall, newWork } from '../public/quest/ledger-panel.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));

test('groupLedger puts Halls in order under their March and loose Works aside', () => {
  const g = groupLedger(sample());
  assert.deepEqual(g.map(x => x.march.id), ['ferry', 'orchard']);
  assert.deepEqual(g[0].halls.map(h => h.hall.id), ['ferry-a', 'ferry-b']);
  assert.deepEqual(g[0].halls[1].works.map(w => w.id), ['w3', 'w4', 'w5', 'w10']);
  assert.deepEqual(g[1].loose.map(w => w.id), ['w9']);
  assert.deepEqual(g[0].loose, []);
});

test('a Work pointing at another March\'s Hall shows as loose, not under that Hall', () => {
  const l = sample();
  l.works[0].hallId = 'orchard-a';
  const g = groupLedger(l);
  assert.ok(g[0].loose.some(w => w.id === 'w1'));
  assert.ok(!g[1].halls[0].works.some(w => w.id === 'w1'));
});

test('new March, Hall and Work make a sound ledger', () => {
  const l = emptyLedger();
  const m = newMarch('  The Ferry March ');
  l.marches.push(m);
  const h1 = newHall(l, m.id, 'First'); l.halls.push(h1);
  const h2 = newHall(l, m.id, 'Second'); l.halls.push(h2);
  l.works.push(newWork({ marchId: m.id, hallId: h2.id, title: 'Pricing page', priority: 'high', size: 'M' }));
  l.works.push(newWork({ marchId: m.id, hallId: h1.id, title: 'No size', size: '' }));
  assert.equal(m.name, 'The Ferry March');
  assert.deepEqual([h1.order, h2.order], [1, 2]);
  assert.notEqual(h1.id, h2.id);
  assert.equal(l.works[1].size, null);
  assert.ok(!Number.isNaN(Date.parse(l.works[0].createdAt)));
  assert.deepEqual(validateLedger(l), []);
});

test('a new Hall goes after the sample\'s existing ones', () => {
  assert.equal(newHall(sample(), 'ferry', 'Third').order, 3);
});
