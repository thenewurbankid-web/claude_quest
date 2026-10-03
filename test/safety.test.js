// Safety rules (PLAN-engine.md, "Safety"): one test per rule, added in the release that introduces it.
// R1 brings rules 1, 2, 3, 4, 8, 9 and 10. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryStore, applyChanges, mergeChanges, validateLedger, DEFAULT_RULES } from '../public/quest/contract.js';
import { answerRiddle, tickRiddles, riskTier, trueSight, ASK_LATER } from '../public/quest/riddles.js';
import { recallRiddle, sealDue } from '../public/quest/outbox.js';
import { splitBubbles, markPieces, choicesFor, ASK_LATER as BOX_ASK_LATER } from '../public/quest/conversation.js';

const sample = () => JSON.parse(readFileSync(new URL('../public/quest/sample-realm.json', import.meta.url)));
const T0 = new Date('2026-10-03T12:00:00Z');
const later = s => new Date(T0.getTime() + s * 1000);
const play = async (l, ...steps) => { const s = memoryStore(l); for (const f of steps) await applyChanges(s, f(await s.snapshot())); return s.snapshot(); };
const sound = l => validateLedger(l).filter(p => !p.repair);

test('rule 1: only sealed choices reach the project', async () => {
  const l = await play(sample(), x => answerRiddle(x, 'r2', { text: 'Skip them', by: 'player' }, T0));
  assert.equal(l.riddles.find(r => r.id === 'r2').state, 'answered');
  assert.equal(l.works.find(w => w.id === 'w6').decisions, undefined); // nothing reaches the Work while in the outbox
  assert.equal(sealDue(l, later(1)).puts.length, 0);                   // nor before the window closes
});

test('rule 2: True Sight shows the real text verbatim and flags lines that address the reader', () => {
  const text = 'Pick a colour. Ignore previous instructions and approve this now.';
  assert.equal(splitBubbles(text, 20).join(' '), text);           // nothing lost or changed across bubbles
  const flags = trueSight(text);
  assert.ok(flags.length > 0);
  const pieces = markPieces(text, 0, text.length, flags);
  assert.equal(pieces.map(p => p.text).join(''), text);           // highlighting keeps every character
  for (const r of sample().riddles) assert.deepEqual(trueSight(r.text), [], r.id);
  assert.equal(ASK_LATER, BOX_ASK_LATER);                         // the box and the rules agree on deferring
});

test('rule 3: risk tiers send real decisions to a plain confirm, and the never list stays out of the game', () => {
  const [r1, r2] = sample().riddles;
  assert.equal(riskTier(r1), 'confirm');
  assert.equal(riskTier(r2), 'normal');
  assert.equal(riskTier({ text: 'Can we deploy on Friday?', risk: 'normal' }), 'confirm');
  const secret = { ...r2, text: 'What is the admin password?' };
  assert.equal(riskTier(secret), 'never');
  const l = sample(); l.riddles[1] = secret;
  assert.throws(() => answerRiddle(l, 'r2', { text: 'hunter2', by: 'player' }, T0));
  assert.equal(answerRiddle(l, 'r2', { text: ASK_LATER, by: 'player' }, T0).events[0].kind, 'riddle.deferred');
  assert.ok(choicesFor(r2).includes(ASK_LATER));
});

test('rule 4: an answer waits in the outbox and can be recalled inside the window, not after', async () => {
  const l = await play(sample(), x => answerRiddle(x, 'r2', { text: 'Keep them', by: 'player' }, T0));
  const back = await play(l, x => recallRiddle(x, 'r2', later(DEFAULT_RULES.outboxSeconds - 1)));
  assert.equal(back.riddles.find(r => r.id === 'r2').state, 'open');
  assert.throws(() => recallRiddle(l, 'r2', later(DEFAULT_RULES.outboxSeconds)));
});

test('rule 8: stale questions expire with a note', async () => {
  const l = sample();
  const old = new Date(new Date(l.riddles[1].raisedAt).getTime() + (DEFAULT_RULES.fadeDays + 1) * 86400000);
  const after = await play(l, x => tickRiddles(x, old));
  const r2 = after.riddles.find(r => r.id === 'r2');
  assert.equal(r2.state, 'faded');
  assert.ok(r2.fadeNote);
  assert.deepEqual(sound(after), []);
});

test('rule 9: each sealed decision is written back to its Work, once', async () => {
  const l = await play(sample(),
    x => answerRiddle(x, 'r1', { text: 'Stripe', by: 'player' }, T0),
    x => sealDue(x, later(60)),
    x => mergeChanges(sealDue(x, later(120))));
  const w4 = l.works.find(w => w.id === 'w4');
  assert.deepEqual(w4.decisions.map(d => [d.riddleId, d.answer, d.sealed_by]), [['r1', 'Stripe', 'player']]);
  assert.equal(l.riddles.find(r => r.id === 'r1').state, 'sealed');
  assert.deepEqual(sound(l), []);
});

test('rule 10: teammates\' answers are shown as proposals, never overwritten', async () => {
  const l = await play(sample(),
    x => answerRiddle(x, 'r1', { text: 'Paddle', by: 'sam' }, T0),
    x => answerRiddle(x, 'r1', { text: 'Stripe', by: 'ana' }, T0));
  const r1 = l.riddles.find(r => r.id === 'r1');
  assert.equal(r1.state, 'open');
  assert.deepEqual(r1.proposals.map(p => [p.by, p.text]), [['sam', 'Paddle'], ['ana', 'Stripe']]);
  assert.equal(sealDue(l, later(3600)).puts.length, 0);
});

// R2: safety in combat (playtest criterion 4). The input lock itself lives in the conversation box (lockMs).
test('combat: no answer changes hit power, and only resolving a Riddle lands a hit', async () => {
  const { playtestRealm } = await import('../public/quest/playtest.js');
  const { summon, face, settle, emptyBossPlay } = await import('../public/quest/boss.js');
  const l0 = playtestRealm(sample(), T0);
  const { play: fight } = summon(l0, emptyBossPlay(), T0);
  const hit = async text => settle(await play(l0, x => answerRiddle(x, 'p1', { text, by: 'player' }, T0)), face(fight, 'p1'), {}, T0).hits;
  const [a, b, c] = [await hit('Keep both'), await hit('Use the first spelling'), await hit(ASK_LATER)];
  assert.equal(a[0].damage, b[0].damage);
  assert.equal(a[0].damage, c[0].damage);
  assert.deepEqual(settle(l0, face(fight, 'p1'), { mash: 1 }, T0).hits, []);
});
