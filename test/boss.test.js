// R2, the Gloamwyrm: weights, summoning, the battle moves, retreat and winning. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryStore, applyChanges, validateLedger, validateBattle, DEFAULT_RULES } from '../public/quest/contract.js';
import { answerRiddle, ASK_LATER } from '../public/quest/riddles.js';
import { bossScore, whyLine, bossSize, hazeLevel, shouldSummon, summon, face, settle, retreat, unresolved,
  emptyBossPlay, returnNote } from '../public/quest/boss.js';
import { playtestRealm } from '../public/quest/playtest.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const T0 = new Date('2026-10-03T12:00:00Z');
const realm = (o) => playtestRealm(sample(), T0, o);
const apply = async (l, c) => { const s = memoryStore(l); await applyChanges(s, c); return s.snapshot(); };

test('the playtest backlog is sound, crosses the threshold, and has one question of each tier', () => {
  const l = realm();
  assert.deepEqual(validateLedger(l).filter(p => !p.repair), []);
  const { score, over, parts } = bossScore(l, T0);
  assert.ok(over && score >= DEFAULT_RULES.bossThreshold);
  const tiers = Object.fromEntries(parts.filter(p => p.riddleId.startsWith('p')).map(p => [p.riddleId, p.tier]));
  assert.deepEqual(tiers, { p1: 'normal', p2: 'confirm', p3: 'never' });
  assert.ok(bossScore(realm({ heavier: true }), T0).score > score); // the second session's is heavier
});

test('weights: the score is the sum over open and deferred Riddles, grouped by Work, each with a reason', () => {
  const l = realm();
  const s = bossScore(l, T0);
  assert.equal(s.score, Math.round(s.parts.reduce((a, p) => a + p.weight, 0) * 100) / 100);
  assert.ok(s.parts.every(p => ['open', 'deferred'].includes(p.state)));
  assert.ok(!s.parts.some(p => p.riddleId === 'r3')); // sealed: no weight
  const r4 = s.parts.find(p => p.riddleId === 'r4');
  assert.match(whyLine(r4), /ask me later/);
  assert.ok(s.works.length && s.works[0].weight >= s.works.at(-1).weight);
  assert.ok(bossSize(s.score) >= 1 && hazeLevel(s.openScore) > 0 && hazeLevel(0) === 0);
});

test('summon: normal Riddles are asked in combat, confirm/never ones only pause it for the Lodge', () => {
  const l = realm();
  assert.ok(shouldSummon(l, emptyBossPlay(), T0));
  const { play, events } = summon(l, emptyBossPlay(), T0);
  const b = play.battle;
  assert.deepEqual(validateBattle(b), []);
  assert.deepEqual(b.riddleIds, ['p1']);
  assert.deepEqual([...b.lodgeIds].sort(), ['p2', 'p3']);
  assert.equal(b.maxHp, Math.round(b.score * DEFAULT_RULES.bossHpPerWeight));
  assert.equal(events[0].kind, 'boss.summoned');
  assert.equal(shouldSummon(l, play, T0), false); // one fight at a time
  assert.throws(() => face(play, 'r4'));          // deferred: can't be faced until it returns
});

test('a pause closed with no answer lands nothing; an answer lands a hit; hp never hits 0 early', async () => {
  let l = realm();
  let { play } = summon(l, emptyBossPlay(), T0);
  play = face(play, 'p1');
  assert.equal(play.battle.phase, 'question');
  let r = settle(l, play, {}, T0);
  assert.equal(r.hits.length, 0);
  assert.equal(r.play.battle.phase, 'fighting');
  play = face(r.play, 'p1');
  l = await apply(l, answerRiddle(l, 'p1', { text: 'Keep both', by: 'player' }, T0));
  r = settle(l, play, {}, T0);
  assert.equal(r.hits.length, 1);
  assert.ok(r.play.battle.hp > 0 && r.play.battle.hp < r.play.battle.maxHp);
  assert.deepEqual(validateBattle(r.play.battle), []);
});

test('mashing adds at most mashBonus to a hit and never answers anything', async () => {
  const l0 = realm();
  const { play } = summon(l0, emptyBossPlay(), T0);
  const l = await apply(l0, answerRiddle(l0, 'p1', { text: 'Keep both', by: 'player' }, T0));
  const plain = settle(l, face(play, 'p1'), { mash: 0 }, T0).hits[0].damage;
  const mashed = settle(l, face(play, 'p1'), { mash: 50 }, T0).hits[0].damage; // clamped to 1
  assert.ok(mashed >= plain && mashed <= Math.round(plain * (1 + DEFAULT_RULES.mashBonus)) + 1);
  const untouched = settle(l0, face(play, 'p1'), { mash: 1 }, T0);
  assert.equal(untouched.hits.length, 0); // mash alone resolves nothing
  assert.equal(l0.riddles.find(x => x.id === 'p1').state, 'open');
});

test('"ask me later" lands the hit, and the Gloamwyrm falls only when every fight Riddle is resolved', async () => {
  let l = realm();
  let { play } = summon(l, emptyBossPlay(), T0);
  for (const id of ['p1', 'p3', 'p2']) {
    play = face(play, id);
    assert.equal(play.battle.phase, id === 'p1' ? 'question' : 'lodge');
    l = await apply(l, answerRiddle(l, id, { text: ASK_LATER, by: 'player' }, T0));
    const r = settle(l, play, {}, T0);
    assert.equal(r.hits.length, 1);
    play = r.play;
    if (id !== 'p2') assert.ok(play.battle.hp > 0);
  }
  assert.equal(play.battle.phase, 'won');
  assert.equal(play.battle.hp, 0);
  assert.equal(play.retreats, 0);
  assert.equal(unresolved(play.battle).length, 0);
});

test('retreat works from any turn, keeps answers, and the next one comes back stronger', async () => {
  let l = realm();
  let { play } = summon(l, emptyBossPlay(), T0);
  play = face(play, 'p1');
  l = await apply(l, answerRiddle(l, 'p1', { text: 'Keep both', by: 'player' }, T0));
  play = face(settle(l, play, {}, T0).play, 'p2'); // paused for the Lodge
  assert.match(returnNote(play), /25% stronger/);
  const back = retreat(play, T0);
  assert.equal(back.play.battle.phase, 'retreated');
  assert.equal(back.play.retreats, 1);
  assert.equal(back.events[0].kind, 'boss.retreated');
  assert.equal(l.riddles.find(r => r.id === 'p1').state, 'answered'); // the answer stays
  const again = summon(l, back.play, T0).play.battle;
  assert.equal(again.strength, 1.25);
  assert.ok(!again.riddleIds.includes('p1'));                         // and isn't asked again
  assert.equal(again.maxHp, Math.round(again.score * DEFAULT_RULES.bossHpPerWeight * 1.25));
});

test('the Haze follows open questions, so winning by putting everything off still clears the sky', async () => {
  let l = realm();
  assert.ok(hazeLevel(bossScore(l, T0).openScore) > 0.4);
  for (const id of ['p1', 'p2', 'p3']) l = await apply(l, answerRiddle(l, id, { text: ASK_LATER, by: 'player' }, T0));
  const s = bossScore(l, T0);
  assert.ok(s.over);                         // put off, they still weigh: the next fight will come
  assert.equal(hazeLevel(s.openScore), 0);   // but nothing is open, so the Haze lifts
  assert.equal(shouldSummon(l, emptyBossPlay(), T0), false);
});

test('a recalled answer takes its hit back', async () => {
  const { recallRiddle } = await import('../public/quest/outbox.js');
  let l = realm();
  let { play } = summon(l, emptyBossPlay(), T0);
  l = await apply(l, answerRiddle(l, 'p1', { text: 'Keep both', by: 'player' }, T0));
  const hit = settle(l, face(play, 'p1'), {}, T0);
  l = await apply(l, recallRiddle(l, 'p1', new Date(T0.getTime() + 2000)));
  const back = settle(l, hit.play, {}, T0);
  assert.equal(back.healed[0].hp, hit.hits[0].damage);
  assert.equal(back.play.battle.hp, back.play.battle.maxHp);
  assert.ok(!back.play.battle.resolvedIds.includes('p1'));
  assert.deepEqual(validateBattle(back.play.battle), []);
});
