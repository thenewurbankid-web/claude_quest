// R5, missions and backlog pressure: listing, one mission at a time, the moves, pressure and the gate.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyMissionPlay, validateMissionPlay, DEFAULT_RULES } from '../public/quest/contract.js';
import { missionsOf, missionWorks, workWeight, begin, tickMission, hearBriefing, hearDebrief, pressure, gated, GATED }
  from '../public/quest/missions.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const NOW = new Date('2026-10-03T12:00:00Z');
const runOf = (mp, id) => mp.runs[id];

test('missions: a parent and its children, lone Works as side missions, game-only Works never', () => {
  const l = sample();
  assert.deepEqual(missionWorks(l, 'w3').map(w => w.id), ['w3', 'w4', 'w5', 'w10']);
  assert.deepEqual(missionWorks(l, 'w4'), []);                       // a child is not a mission of its own
  const sagas = missionsOf(l, emptyMissionPlay(), NOW);
  const toll = sagas.find(s => s.hallId === 'ferry-b');
  assert.deepEqual(toll.missions.map(m => [m.id, m.total, m.resolved, m.side]), [['w3', 4, 1, false]]);
  assert.equal(toll.dueAt, '2026-10-10T17:00:00Z');
  assert.ok(sagas.flatMap(s => s.missions).every(m => m.id !== 'w9')); // no Hall: a repair quest, not a mission
  l.works.push({ id: 'lore1', marchId: 'ferry', hallId: 'ferry-b', title: 'Fair', status: 'todo', priority: 'low',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), mark: { status: 'sent', source: 'lore', sourceId: 'x', real: false, at: NOW.toISOString() } });
  assert.ok(missionsOf(l, emptyMissionPlay(), NOW).find(s => s.hallId === 'ferry-b').missions.every(m => m.id !== 'lore1'));
  assert.deepEqual(sagas.map(s => s.hallId), ['ferry-b', 'orchard-b', 'orchard-a', 'ferry-a']); // most pressure first
});

test('missions: one at a time; switching shelves the current one, and a shelved one picks up where it was', () => {
  const l = sample();
  let r = begin(emptyMissionPlay(), l, 'w3', NOW);
  assert.equal(r.problem, null);
  assert.deepEqual([r.mp.current, runOf(r.mp, 'w3').state, r.events.map(e => e.kind)], ['w3', 'briefing', ['mission.begun']]);
  let mp = hearBriefing(r.mp, NOW).mp;
  assert.equal(runOf(mp, 'w3').state, 'active');
  r = begin(mp, l, 'w6', NOW);
  assert.deepEqual(r.events.map(e => [e.kind, e.ref]), [['mission.shelved', 'w3'], ['mission.begun', 'w6']]);
  assert.deepEqual(validateMissionPlay(r.mp), []);
  r = begin(r.mp, l, 'w3', NOW);
  assert.deepEqual([runOf(r.mp, 'w3').state, runOf(r.mp, 'w6').state], ['active', 'shelved']);
  assert.deepEqual(validateMissionPlay(r.mp), []);
  assert.ok(begin(r.mp, l, 'w4', NOW).problem);                      // a child is not a mission
  assert.ok(begin(r.mp, l, 'nope', NOW).problem);
});

test('missions: a waiting Riddle is a cliffhanger, its answer clears it, and resolving every Work brings the debrief', () => {
  const l = sample();
  let mp = hearBriefing(begin(emptyMissionPlay(), l, 'w3', NOW).mp, NOW).mp;
  let t = tickMission(mp, l, NOW);                                   // r1 on w4 is open
  assert.deepEqual([runOf(t.mp, 'w3').state, t.events.map(e => e.kind)], ['cliffhanger', ['mission.cliffhanger']]);
  l.riddles.find(r => r.id === 'r1').state = 'deferred';
  t = tickMission(t.mp, l, NOW);
  assert.equal(runOf(t.mp, 'w3').state, 'active');
  for (const w of l.works) if (['w3', 'w4', 'w5'].includes(w.id)) w.status = 'done';
  t = tickMission(t.mp, l, NOW);
  assert.equal(runOf(t.mp, 'w3').state, 'debrief');
  const d = hearDebrief(t.mp, NOW);
  assert.deepEqual([runOf(d.mp, 'w3').state, d.mp.current, d.events.map(e => e.kind)], ['done', null, ['mission.debriefed', 'mission.done']]);
  assert.deepEqual(validateMissionPlay(d.mp), []);
  assert.ok(begin(d.mp, l, 'w3', NOW).problem);                     // done is done
});

test('missions: the briefing must be heard first; ticks never skip it', () => {
  const l = sample();
  for (const w of l.works) if (['w3', 'w4', 'w5'].includes(w.id)) w.status = 'done';
  const mp = begin(emptyMissionPlay(), l, 'w3', NOW).mp;
  assert.equal(runOf(tickMission(mp, l, NOW).mp, 'w3').state, 'briefing');
  const heard = hearBriefing(mp, NOW).mp;
  assert.equal(runOf(tickMission(heard, l, NOW).mp, 'w3').state, 'debrief');
});

test('pressure: open weight against the days left to the release date, with a reason', () => {
  const l = sample();
  assert.equal(workWeight(l.works.find(w => w.id === 'w4')), 4 * 3 + 1);  // critical × L + one failure
  const p = pressure(l, 'ferry-b', NOW);
  assert.equal(p.openWeight, 21);                                        // w3 6 + w4 13 + w5 2 (w10 cancelled)
  assert.ok(p.level > 0.7 && p.level < DEFAULT_RULES.pressureGate, String(p.level));
  assert.match(p.why, /21 weight of open work in Hall of the Tollkeeper/);
  const closer = pressure(l, 'ferry-b', new Date('2026-10-08T12:00:00Z'));
  assert.ok(closer.level > p.level);                                     // less time, more pressure
  const over = pressure(l, 'ferry-b', new Date('2026-10-11T12:00:00Z'));
  assert.deepEqual([over.level, over.overdue], [1, true]);
  l.works.push({ ...l.works.find(w => w.id === 'w5'), id: 'w11', parentId: null });
  assert.ok(pressure(l, 'ferry-b', NOW).level > p.level);               // more work, more pressure
  assert.equal(pressure(l, 'ferry-a', NOW).level, 0);                    // achieved: nothing open
  const undated = pressure(l, 'orchard-b', NOW);
  assert.deepEqual([undated.daysLeft, undated.level], [null, 6 / DEFAULT_RULES.pressureFull]);
});

test('the gate: side content locks at the gate and opens again once pressure drops', () => {
  const l = sample();
  assert.equal(gated(l, NOW).gated, false);
  const late = new Date('2026-10-09T12:00:00Z');
  const g = gated(l, late);
  assert.deepEqual([g.gated, g.hallId], [true, 'ferry-b']);
  assert.ok(g.why);
  for (const w of l.works) if (w.hallId === 'ferry-b') w.status = 'done';
  assert.equal(gated(l, late).gated, false);
  assert.deepEqual(GATED, ['lore-quests', 'lore-tab', 'explore']);
});
