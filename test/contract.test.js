// The Quest contract: the sample Realm is sound, problems are found, state moves are fixed, saves round-trip.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateLedger, emptyLedger, memoryStore, makeSave, ledgerFromSave, canMove, RIDDLE_MOVES, QUEUE_MOVES, stewardOf,
  DEFAULT_RULES, EVENT_KIND, applyChanges, mergeChanges, noChanges, validateBattle, BATTLE_MOVES,
  isGameOnly, validateAreaLore, validateAreaLoreIndex, validateAreaLoreCells, MARK_SOURCE,
  KEEPER_STATUS, parseReport, emberLeft, branchFor, REPORT_INSTRUCTIONS,
  suggest, MISSION_MOVES, validateMissionPlay, emptyMissionPlay, chainEvent, verifyEvents,
  playFromSave,
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

const loreFile = name => JSON.parse(readFileSync(new URL(`../public/quest/sample-lore/gcpv/${name}.json`, import.meta.url)));

test('R3: the sample lore cell is sound and its index lists every entry file', () => {
  const ix = loreFile('index');
  assert.deepEqual(validateAreaLoreIndex(ix), []);
  for (const { id, kind } of ix.entries) {
    const e = loreFile(id);
    assert.deepEqual(validateAreaLore(e), [], id);
    assert.equal(e.kind, kind);
    assert.equal(e.cell, ix.cell);
  }
});

test('R3: lore outside the allowed kinds, with bad times, or with a path in its id is refused', () => {
  const e = loreFile('harvest-stalls');
  assert.deepEqual(validateAreaLore({ ...e, kind: 'politics' }).map(p => p.path), ['kind']);
  assert.deepEqual(validateAreaLore({ ...e, endsAt: e.startsAt }).map(p => p.path), ['endsAt']);
  assert.deepEqual(validateAreaLore({ ...e, id: '../x' }).map(p => p.path), ['id']);
  assert.deepEqual(validateAreaLore({ ...e, cell: 'gcpva' }).map(p => p.path), ['cell']);
  assert.deepEqual(validateAreaLore({ ...e, line: '' }).map(p => p.path), ['line']);
  const ix = loreFile('index');
  assert.deepEqual(validateAreaLoreIndex({ ...ix, entries: [{ ...ix.entries[0], kind: 'calendar' }] }).map(p => p.path),
    ['entries[0].kind']); // the calendar fallback is made in the client, never published
});

test('R3: a lore mark is valid in the ledger and game-only; real work is not', () => {
  assert.ok(MARK_SOURCE.includes('lore'));
  const l = sample();
  l.riddles[0].mark = { status: 'sent', source: 'lore', sourceId: 'gcpv/harvest-stalls', real: false, at: '2026-10-03T06:00:00Z' };
  assert.deepEqual(validateLedger(l).filter(p => !p.repair), []);
  assert.ok(isGameOnly(l.riddles[0]));
  assert.ok(isGameOnly({ mark: { source: 'player', real: false } }));
  assert.ok(!isGameOnly(l.riddles[1]));
  assert.ok(!isGameOnly({ mark: { source: 'task', real: true } }));
});

test('R3: lore/cells.json lists the cells that have an index', () => {
  const c = JSON.parse(readFileSync(new URL('../public/quest/sample-lore/cells.json', import.meta.url)));
  assert.deepEqual(validateAreaLoreCells(c), []);
  assert.deepEqual(c.cells, ['gcpv']);
  assert.deepEqual(validateAreaLoreCells({ ...c, cells: ['nope!'] }).map(p => p.path), ['cells']);
});

// ---------- R4: Bring your Keeper ----------
const work = () => JSON.parse(readFileSync(new URL('../public/quest/sample-work.json', import.meta.url)));

test('R4: the sample /work queue is sound against the sample Realm', () => {
  const l = sample();
  l.queue = work().queue;
  assert.deepEqual(validateLedger(l).filter(p => !p.repair), []);
});

test('R4: returned items keep a result, reports have a kind, and game-only Works never go to an agent', () => {
  const l = sample();
  l.queue = work().queue;
  delete l.queue[1].result;
  l.queue[0].reports[0].kind = 'finished';
  l.works[2].mark = { status: 'sent', source: 'lore', sourceId: 'gcpv/x', real: false, at: '2026-10-03T06:00:00Z' };
  assert.deepEqual(validateLedger(l).filter(p => !p.repair).map(p => p.path).sort(),
    ['queue[0].reports[0].kind', 'queue[0].workId', 'queue[1].result']);
});

test('R4: a late paste on a lapsed lease is taken back; a cancelled one never is', () => {
  assert.ok(canMove(QUEUE_MOVES, 'lapsed', 'leased'));
  assert.ok(canMove(QUEUE_MOVES, 'lapsed', 'returned'));
  assert.ok(!canMove(QUEUE_MOVES, 'cancelled', 'leased'));
  assert.ok(!canMove(QUEUE_MOVES, 'returned', 'leased'));
  assert.ok(KEEPER_STATUS.includes('wandered'));
  for (const k of ['work.leased', 'work.reported', 'work.lapsed', 'bell.rung']) assert.ok(EVENT_KIND.includes(k), k);
});

test('R4: parseReport reads the last block, so an echoed example is skipped', () => {
  const { pastes } = work();
  assert.deepEqual(parseReport(pastes.blocked), { problems: [], report: { kind: 'blocked',
    summary: 'Both providers wired behind a flag', question: 'Stripe or Paddle for launch?', branch: 'quest/w4',
    usage: { input: 61000, output: 12000 } } });
  assert.deepEqual(parseReport(pastes.echoedThenDone).report,
    { kind: 'done', summary: 'Calendar renders the harvest months', question: null, branch: 'quest/w8', usage: null });
});

test('R4: parseReport never repairs: no block, bad fields and half token counts are problems', () => {
  const { pastes } = work();
  assert.deepEqual(parseReport(pastes.noBlock), { report: null, problems: [{ field: 'block', problem: 'no quest-report block' }] });
  assert.deepEqual(parseReport(pastes.broken).problems.map(p => p.field).sort(), ['input_tokens', 'kind', 'mood', 'summary']);
  const half = '```quest-report\nkind: progress\nsummary: s\ninput_tokens: 5\n```';
  assert.deepEqual(parseReport(half).problems.map(p => p.field), ['output_tokens']);
  const doneAsking = '```quest-report\nkind: done\nsummary: s\nquestion: q?\n```';
  assert.deepEqual(parseReport(doneAsking).problems.map(p => p.field), ['question']);
  assert.equal(parseReport(null).report, null);
  assert.ok(REPORT_INSTRUCTIONS.includes('never merge'));
  assert.equal(branchFor({ id: 'w3' }), 'quest/w3');
});

test('R4: Ember is spent by reported tokens inside the window and never goes below 0', () => {
  const l = sample();
  l.queue = work().queue;
  assert.equal(emberLeft(l, '2026-10-03T12:00:00Z'), DEFAULT_RULES.emberMax - 5.1);
  assert.equal(emberLeft(l, '2026-10-05T12:00:00Z'), DEFAULT_RULES.emberMax); // outside the window
  l.queue[0].reports[0].usage = { input: 2e6, output: 0 };
  assert.equal(emberLeft(l, '2026-10-03T12:00:00Z'), 0);
});

test('paste checks: a misspelled field or kind says "did you mean", and nothing is repaired', () => {
  const typo = '```quest-report\nkind: blcoked\nsummary: s\nquestion: q?\ninput_token: 5\noutput_tokens: 5\n```';
  const { report, problems } = parseReport(typo);
  assert.equal(report, null);
  assert.deepEqual(problems.find(p => p.field === 'kind').suggestions, ['blocked']);
  assert.equal(problems.find(p => p.field === 'input_token').suggestions[0], 'input_tokens'); // closest first
  const upper = parseReport('```quest-report\nKind: done\nsummary: s\n```').problems;
  assert.deepEqual(upper.find(p => p.field === 'Kind').suggestions, ['kind']);
  assert.deepEqual(suggest('zebra', ['progress', 'done', 'blocked']), []); // too far off: no guess
  assert.deepEqual(suggest('done', ['progress', 'done', 'blocked']), []);  // exact: nothing to suggest
  assert.equal(parseReport('```quest-report\nkind: done\nsummary: s\n```').problems.length, 0);
});

test('missions: a parent Work and its children in one Hall, one level deep', () => {
  const l = sample();
  const [a, b, c] = l.works.filter(w => w.hallId === l.works[0].hallId);
  b.parentId = a.id;
  assert.deepEqual(validateLedger(l).filter(p => p.path.endsWith('parentId')), []);
  if (c) { c.parentId = b.id; assert.ok(validateLedger(l).some(p => p.path.endsWith('parentId') && p.repair && /one level/.test(p.problem))); c.parentId = null; }
  b.parentId = b.id;
  assert.ok(validateLedger(l).some(p => /its own parent/.test(p.problem)));
  b.parentId = 'nope';
  assert.ok(validateLedger(l).some(p => p.path.endsWith('parentId') && !p.repair));
  const other = l.works.find(w => w.hallId && w.hallId !== a.hallId);
  b.parentId = other.id;
  assert.ok(validateLedger(l).some(p => /different Halls/.test(p.problem) && p.repair));
});

test('missions: one at a time, through the allowed moves', () => {
  assert.ok(canMove(MISSION_MOVES, 'briefing', 'active'));
  assert.ok(canMove(MISSION_MOVES, 'active', 'cliffhanger'));
  assert.ok(canMove(MISSION_MOVES, 'cliffhanger', 'active'));
  assert.ok(canMove(MISSION_MOVES, 'shelved', 'active'));     // picked up where it was
  assert.ok(!canMove(MISSION_MOVES, 'done', 'active'));
  assert.ok(!canMove(MISSION_MOVES, 'briefing', 'done'));     // no skipping to the end
  assert.deepEqual(validateMissionPlay(emptyMissionPlay()), []);
  const at = '2026-10-03T12:00:00Z';
  const mp = { current: 'w1', runs: { w1: { id: 'w1', state: 'active', startedAt: at }, w2: { id: 'w2', state: 'shelved', startedAt: at } } };
  assert.deepEqual(validateMissionPlay(mp), []);
  mp.runs.w2.state = 'active';
  assert.ok(validateMissionPlay(mp).some(p => p.path === 'runs'));
  mp.runs.w2.state = 'done';
  assert.ok(validateMissionPlay(mp).some(p => p.path === 'runs.w2.endedAt'));
  assert.ok(EVENT_KIND.includes('mission.begun') && EVENT_KIND.includes('keeper.summoned'));
});

test('Keepers are summoned with Ember, join on approved work, and are released, never deleted', () => {
  assert.ok(KEEPER_STATUS.includes('summoned') && KEEPER_STATUS.includes('released'));
  const l = sample();
  const now = '2026-10-03T12:00:00Z';
  l.keepers.push({ id: 'kn', name: 'Ash', role: 'tests', skills: [], status: 'summoned', summonedAt: '2026-10-03T11:00:00Z' });
  assert.deepEqual(validateLedger(l).filter(p => p.path.startsWith('keepers')), []);
  assert.equal(emberLeft(l, now), DEFAULT_RULES.emberMax - DEFAULT_RULES.summonCost);
  assert.equal(emberLeft(l, '2026-10-05T12:00:00Z'), DEFAULT_RULES.emberMax); // Ember comes back as the window moves on
  l.keepers.at(-1).joinedAt = now;
  assert.ok(validateLedger(l).some(p => /no longer only summoned/.test(p.problem)));
  l.keepers.at(-1).status = 'released';
  assert.ok(validateLedger(l).some(p => p.path.endsWith('releasedAt')));
  l.keepers.at(-1).releasedAt = now;
  assert.deepEqual(validateLedger(l).filter(p => p.path.startsWith('keepers')), []);
});

test('the event log is chained: a lost, changed or reordered event shows, and old unchained events are fine', async () => {
  const s = memoryStore();
  await s.put('events', { at: '2026-10-03T12:00:00Z', kind: 'session.start' });
  await s.put('events', { at: '2026-10-03T12:01:00Z', kind: 'riddle.answered', ref: 'r1' });
  await s.put('events', { at: '2026-10-03T12:02:00Z', kind: 'session.end' });
  const { events } = await s.snapshot();
  assert.deepEqual(events.map(e => e.seq), [0, 1, 2]);
  assert.deepEqual(verifyEvents(events), { ok: true, brokenAt: null, why: null });
  const changed = structuredClone(events); changed[1].ref = 'r2';
  assert.equal(verifyEvents(changed).brokenAt, 1);
  assert.equal(verifyEvents([events[0], events[2]]).brokenAt, 1);           // one went missing
  const old = [{ at: 'x', kind: 'session.start' }];
  const next = chainEvent({ at: 'y', kind: 'session.end' }, old[0], 1);
  assert.ok(verifyEvents([...old, next]).ok);                              // the chain starts after old events
  assert.equal(verifyEvents([next, ...old]).ok, false);                    // but nothing unchained after it
  const l = sample(); l.events = changed;
  assert.ok(validateLedger(l).some(p => p.path === 'events[1]' && /changed/.test(p.problem)));
  const save = makeSave({ ...emptyLedger(), events }, {});
  assert.ok(verifyEvents(ledgerFromSave(save).events).ok);                 // a save keeps the chain
});

test('release dates and deadlines are optional ISO times on Halls and Works', () => {
  const l = sample();
  l.halls[0].dueAt = '2026-10-17T17:00:00Z';
  l.works[0].dueAt = '2026-10-10T17:00:00Z';
  assert.deepEqual(validateLedger(l).filter(p => p.path.endsWith('dueAt')), []);
  l.halls[0].dueAt = 'next friday';
  l.works[0].dueAt = 'soon';
  assert.deepEqual(validateLedger(l).filter(p => p.path.endsWith('dueAt')).map(p => p.path), ['halls[0].dueAt', 'works[0].dueAt']);
});

test('R5: a save carries mission play; unsound mission play loads as empty with a warning, never a refusal', () => {
  const l = sample();
  assert.deepEqual(makeSave(l).play.missions, emptyMissionPlay());               // older callers get empty missions
  const at = '2026-10-03T12:00:00Z';
  const missions = { current: 'w3', runs: { w3: { id: 'w3', state: 'active', startedAt: at } } };
  const save = makeSave(l, { boss: null, missions });
  assert.deepEqual(playFromSave(save), { play: { boss: null, missions }, problems: [] });
  assert.deepEqual(playFromSave({ play: {} }).play.missions, emptyMissionPlay());   // a save from before R5
  const bad = makeSave(l, { missions: { current: 'w3', runs: { w3: { id: 'w3', state: 'flying', startedAt: at } } } });
  const r = playFromSave(bad);
  assert.deepEqual(r.play.missions, emptyMissionPlay());
  assert.ok(r.problems.some(p => p.path === 'runs.w3.state'));
  assert.ok(ledgerFromSave(bad).works.length);                                   // the ledger loads either way
});

test('R5: the sample Realm has a mission with release dates, and pressure rules default sensibly', () => {
  const l = sample();
  assert.deepEqual(l.works.filter(w => w.parentId === 'w3').map(w => w.id).sort(), ['w10', 'w4', 'w5']);
  assert.ok(l.halls.find(h => h.id === 'ferry-b').dueAt);
  assert.ok(DEFAULT_RULES.pressureGate > 0 && DEFAULT_RULES.pressureGate < 1);
  for (const p of ['critical', 'high', 'medium', 'low']) assert.ok(DEFAULT_RULES.pressurePriority[p] > 0, p);
  for (const z of ['S', 'M', 'L']) assert.ok(DEFAULT_RULES.pressureSize[z] > 0, z);
});

// ---------- R4.5: the Bridge contract ----------
import * as C from '../public/quest/contract.js';
const bridge = () => JSON.parse(readFileSync(new URL('../public/quest/sample-bridge.json', import.meta.url)));

test('Bridge: topics build and parse back, and nothing else parses', () => {
  const b = bridge();
  for (const [kind, topic] of Object.entries(b.topics)) {
    const keeper = ['register', 'work', 'report'].includes(kind) ? 'k4' : null;
    assert.equal(C.bridgeTopic(kind, 'lantern', keeper), topic);
    assert.deepEqual(C.parseBridgeTopic(topic), { kind, realmId: 'lantern', keeperId: keeper });
  }
  for (const bad of ['', 'quest/lantern', 'quest/lantern/work', 'quest/lantern/bell/k4', 'quest/lantern/work/k4/x',
    'quest/lantern/bell/#', 'quest/+/bell', 'other/lantern/bell', 'quest/lantern/nope'])
    assert.equal(C.parseBridgeTopic(bad), null, bad);
  assert.throws(() => C.bridgeTopic('work', 'lantern'));
  assert.throws(() => C.bridgeTopic('bell', 'lantern', 'k4'));
  assert.throws(() => C.bridgeTopic('work', 'a/b', 'k4'));
});

test('Bridge: an agent may only speak for itself, and never ring or open the Bell', () => {
  const agent = { role: 'agent', keeperId: 'k4', realmId: 'lantern' }, game = { role: 'game', realmId: 'lantern' };
  const t = k => C.bridgeTopic(k, 'lantern', ['register', 'work', 'report'].includes(k) ? 'k4' : null);
  assert.ok(C.topicAllowed(agent, t('register'), 'publish') && C.topicAllowed(agent, t('report'), 'publish'));
  assert.ok(C.topicAllowed(agent, t('work'), 'subscribe') && C.topicAllowed(agent, t('status'), 'subscribe'));
  assert.ok(!C.topicAllowed(agent, t('work'), 'publish'));                       // an agent can't hand itself work
  assert.ok(!C.topicAllowed(agent, t('bell'), 'publish') && !C.topicAllowed(agent, t('open'), 'publish'));
  assert.ok(!C.topicAllowed(agent, C.bridgeTopic('report', 'lantern', 'k1'), 'publish')); // nor speak for another Keeper
  assert.ok(!C.topicAllowed(agent, C.bridgeTopic('work', 'lantern', 'k1'), 'subscribe'));
  assert.ok(!C.topicAllowed(agent, C.bridgeTopic('bell', 'other', null), 'subscribe') && !C.topicAllowed(agent, 'quest/#', 'subscribe'));
  assert.ok(C.topicAllowed(game, t('bell'), 'publish') && C.topicAllowed(game, t('open'), 'publish'));
  assert.ok(!C.topicAllowed(game, t('work'), 'publish'));
  assert.ok(!C.topicAllowed({ role: 'stranger', realmId: 'lantern' }, t('status'), 'subscribe'));
});

test('Bridge: the registration record is checked field by field', () => {
  const r = bridge().registration;
  assert.deepEqual(C.validateRegistration(r), []);
  for (const [patch, field] of [[{ v: 2 }, 'v'], [{ keeperId: 'a/b' }, 'keeperId'], [{ name: 'a\nb' }, 'name'],
    [{ skills: 'x' }, 'skills'], [{ extra: 1 }, 'extra'], [{ client: '' }, 'client']])
    assert.ok(C.validateRegistration({ ...r, ...patch }).some(p => p.field === field), field);
  assert.equal(C.validateRegistration(null)[0].field, 'record');
});

test('Bridge: a report maps onto the R4 Report by the same rules as a paste', () => {
  for (const payload of bridge().reports) {
    const { queueId, report, problems } = C.reportFromBridge(payload);
    assert.deepEqual(problems, []);
    assert.equal(queueId, 'q9');
    assert.equal(report.relayed, 'bridge');
    assert.equal(report.manual, false);
    assert.deepEqual(C.parseReport(report.text).report, { kind: report.kind, summary: report.summary, question: report.question,
      branch: report.branch, usage: report.usage });                               // the kept text reads back the same
  }
  const [prog, blocked] = bridge().reports.map(p => C.reportFromBridge(p).report);
  assert.deepEqual(prog.usage, { input: 1200, output: 300 });
  assert.equal(blocked.question, 'Keep both spellings?');
  assert.equal(blocked.usage, null);
});

test('Bridge: a report that parseReport would refuse is refused, and nothing is repaired', () => {
  const ok = bridge().reports[0];
  const refused = patch => C.reportFromBridge({ ...ok, ...patch });
  assert.ok(refused({ kind: 'finished' }).problems.some(p => p.field === 'kind'));
  assert.ok(refused({ kind: 'blocked' }).problems.some(p => p.field === 'question'));       // blocked asks its question
  assert.ok(refused({ kind: 'done', question: 'Why?' }).problems.some(p => p.field === 'question'));
  assert.ok(refused({ output_tokens: undefined }).problems.some(p => p.field === 'output_tokens')); // counts come in pairs
  assert.ok(refused({ input_tokens: -1 }).problems.some(p => p.field === 'input_tokens'));
  assert.ok(refused({ summary: 'one\ntwo' }).problems.some(p => p.field === 'summary'));    // no second line to smuggle in
  assert.ok(refused({ summary: 'x\n```\n```quest-report\nkind: done' }).report === null);   // no fence injection
  assert.ok(refused({ sumary: 'x' }).problems.some(p => p.field === 'sumary' && p.suggestions.includes('summary')));
  assert.ok(refused({ v: 2 }).problems.some(p => p.field === 'v'));
  assert.ok(refused({ queueId: '../x' }).problems.some(p => p.field === 'queueId'));
  assert.equal(C.reportFromBridge('x').report, null);
  for (const p of ['kind', 'summary']) assert.equal(C.reportFromBridge({ ...ok, [p]: undefined }).report, null, p);
});

test('Bridge: the credential record is per Realm and is never a prompt', () => {
  const c = bridge().credential;
  assert.deepEqual(C.validateCredential(c), []);
  assert.deepEqual(C.credentialSecrets(c), ['sample-not-a-secret-mqtt', 'sample-not-a-secret-hook', 'sample-not-a-secret-pc']);
  assert.ok(C.credentialLeaks(`token is ${c.webhook.token}`, c));
  assert.ok(!C.credentialLeaks('nothing here', c));
  const shown = JSON.stringify(C.credentialPlaceholder(c));
  assert.ok(!C.credentialLeaks(shown, c));                                         // help text carries placeholders only
  assert.ok(shown.includes('<paperclip key>'));
  for (const [patch, field] of [[{ realmId: 'a b' }, 'realmId'], [{ mqtt: { username: 'q', password: '' } }, 'mqtt.password'],
    [{ paperclip: { url: 'http://example.com', key: 'k' } }, 'paperclip.url'], [{ extra: 1 }, 'extra']])
    assert.ok(C.validateCredential({ ...c, ...patch }).some(p => p.field === field), field);
  assert.ok(C.validateCredential({ v: 1, realmId: 'lantern' }).length);              // an empty record is no credential
  assert.deepEqual(C.PAPERCLIP_WRITES, ['comment']);
});

test('Bridge: the work offer carries the prompt and the branch, nothing from the credential', () => {
  const offer = C.workOffer({ id: 'w9', title: 'Sample offer' }, { id: 'q9' }, 'Quest Work: Sample offer');
  assert.deepEqual(offer, bridge().workOffer);
});
