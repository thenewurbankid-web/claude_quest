// The Riddle rules (PLAN-engine.md, R1 "Riddles"): which Riddles stand as NPCs, how risky each is, what True Sight
// flags in the real text, and what answering, deferring, returning and fading do. Pure functions over a Ledger
// snapshot (contract.js): they never touch a store and never mutate their input. Each move returns Changes
// ({ puts, events }) that applyChanges writes, events last.
import { DEFAULT_RULES, RIDDLE_MOVES, canMove, stewardOf, noChanges } from './contract.js';

/** "Ask me later" counts as an answer: the Riddle is deferred and returns after rules.deferHours. */
export const ASK_LATER = 'Ask me later';

const HOUR = 3600e3, DAY = 24 * HOUR;
const clone = v => JSON.parse(JSON.stringify(v));
const iso = ms => new Date(ms).toISOString();
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORK_WAITING = ['blocked', 'in_review'];

// ---------- risk tiers (safety rule 3) ----------
// Whole words or phrases, any case, with a plural ending allowed ("tokens", "credentials"), so "dropped" is not "drop".
const wordsRe = words => words.length
  ? new RegExp(`\\b(?:${words.map(w => escape(w.trim()).replace(/\s+/g, '\\s+')).join('|')})(?:s|es)?\\b`, 'i')
  : null;
const matches = (text, words) => !!wordsRe(words || [])?.test(String(text || ''));

/** 'never' (never answered in the game), 'confirm' (leaves the game for a plain confirm) or 'normal'. */
export function riskTier(riddle, rules = DEFAULT_RULES) {
  if (matches(riddle.text, rules.neverInGame)) return 'never';
  if (riddle.risk === 'high' || matches(riddle.text, rules.confirmWords)) return 'confirm';
  return 'normal';
}

// ---------- True Sight ----------
// Suspicious stretches of real text: lines that speak to the AI or to the reader, commands aimed at the game, links.
// A short readable list; each pattern needs a telltale phrase, so plain questions ("Keep them or skip them?") pass.
const SIGHT = [
  ['addresses-ai', /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|messages?|rules)\b/gi],
  ['addresses-ai', /\byou\s+are\s+(?:now\s+)?(?:an?\s+|the\s+)?(?:ai|assistant|claude|model|language\s+model|llm|chatbot|bot)\b/gi],
  ['addresses-ai', /\bas\s+an?\s+(?:ai|language\s+model|assistant)\b/gi],
  ['addresses-ai', /\bsystem\s+prompt\b/gi],
  ['addresses-reader', /\byou\s+must\b/gi],
  ['addresses-reader', /\bclick(?:\s+(?:here|this|below|the\s+link))?\b/gi],
  ['addresses-reader', /\bdear\s+(?:player|reader|user|human)\b/gi],
  ['addresses-reader', /\bas\s+the\s+(?:reader|player)\b/gi],
  ['addresses-reader', /\b(?:whoever|anyone)\s+(?:is\s+)?reading\s+this\b/gi],
  ['instruction', /\bapprove\s+(?:this|it|now|immediately)\b/gi],
  ['instruction', /\bseal\s+(?:it|this)(?:\s+now)?\b/gi],
  ['instruction', /\b(?:answer|choose|pick|select)\s+(?:yes|no)\b/gi],
  ['instruction', /\b(?:do\s+not|don['’]t)\s+(?:tell|mention|show|reveal)\b/gi],
  ['link', /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi],
];

/** Flag[] ({ start, end, why }) over text, sorted by start and never overlapping. Computed, never stored. */
export function trueSight(text) {
  const s = String(text || ''), found = [];
  for (const [why, re] of SIGHT) for (const m of s.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length, why });
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  for (const f of found) if (!out.length || f.start >= out[out.length - 1].end) out.push(f);
  return out;
}

// ---------- NPCs ----------
/** One NPC per open Riddle whose Work is blocked or in review, oldest question first. */
export function riddleNpcs(ledger, now = new Date()) {
  const works = new Map((ledger.works || []).map(w => [w.id, w]));
  const keepers = new Map((ledger.keepers || []).map(k => [k.id, k]));
  return (ledger.riddles || [])
    .filter(r => r.state === 'open' && WORK_WAITING.includes(works.get(r.workId)?.status))
    .sort((a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt)))
    .map(r => {
      const work = works.get(r.workId);
      return { riddle: clone(r), work: clone(work), keeper: work.keeperId ? clone(keepers.get(work.keeperId) ?? null) : null,
        tier: riskTier(r) };
    });
}

// ---------- moves ----------
const findRiddle = (ledger, id) => {
  const r = (ledger.riddles || []).find(r => r.id === id);
  if (!r) throw new Error(`no Riddle ${id}`);
  return r;
};
const change = (record, kind, at) => ({ puts: [{ kind: 'riddles', record }], events: [{ at, kind, ref: record.id }] });

/**
 * Answers an open Riddle. "Ask me later" defers it; the steward's answer goes to the outbox; anyone else's answer is
 * kept as a proposal and the Riddle stays open (rule 10). Throws if it isn't open, the text is empty, or it is never-tier
 * (a never-tier Riddle can still be deferred).
 */
export function answerRiddle(ledger, riddleId, { text, by } = {}, now = new Date(), rules = DEFAULT_RULES) {
  const r = clone(findRiddle(ledger, riddleId));
  if (r.state !== 'open') throw new Error(`Riddle ${riddleId} is ${r.state}, not open`);
  const words = typeof text === 'string' ? text.trim() : '';
  if (!words) throw new Error('an answer needs text');
  // Deferring isn't answering, so a never-tier Riddle may still be put off; any other answer is refused.
  if (words !== ASK_LATER && riskTier(r, rules) === 'never') throw new Error(`Riddle ${riddleId} is never answered in the game`);
  const at = now.toISOString(), t = now.getTime();

  if (words === ASK_LATER) {
    if (!canMove(RIDDLE_MOVES, r.state, 'deferred')) throw new Error(`Riddle ${riddleId} can't be deferred`);
    Object.assign(r, { state: 'deferred', deferredUntil: iso(t + rules.deferHours * HOUR), deferCount: (r.deferCount || 0) + 1 });
    return change(r, 'riddle.deferred', at);
  }
  if (by && by === (r.steward || stewardOf(ledger, r.marchId))) {
    Object.assign(r, { state: 'answered', answer: { text: words, by, at }, outboxUntil: iso(t + rules.outboxSeconds * 1000) });
    return change(r, 'riddle.answered', at);
  }
  r.proposals = [...(r.proposals || []), { text: words, by: by || 'unknown', at }];
  return change(r, 'riddle.proposed', at);
}

/** Time passing: deferred Riddles come back when due; open Riddles older than rules.fadeDays fade with a note (rule 8). */
export function tickRiddles(ledger, now = new Date(), rules = DEFAULT_RULES) {
  const out = noChanges(), at = now.toISOString(), t = now.getTime();
  for (const orig of ledger.riddles || []) {
    let r = null, kind = null;
    if (orig.state === 'deferred' && orig.deferredUntil && Date.parse(orig.deferredUntil) <= t) {
      r = { ...clone(orig), state: 'open', deferredUntil: null };
      kind = 'riddle.returned';
    }
    const cur = r || orig;
    if (cur.state === 'open' && t - Date.parse(cur.raisedAt) > rules.fadeDays * DAY) {
      r = { ...clone(cur), state: 'faded', resolvedAt: at,
        fadeNote: `Faded after ${rules.fadeDays} days unanswered; the question may be stale. Ask again from its Work.` };
      kind = 'riddle.faded'; // a Riddle that returns already stale fades in the same tick, with one event
    }
    if (r) { out.puts.push({ kind: 'riddles', record: r }); out.events.push({ at, kind, ref: r.id }); }
  }
  return out;
}

/** The Riddle's pull on R2's boss: grows with deferrals and age, so deferring can't dodge it. 0 once settled. */
export function riddleWeight(riddle, now = new Date(), rules = DEFAULT_RULES) {
  if (['sealed', 'faded'].includes(riddle.state)) return 0;
  const age = Math.max(0, (now.getTime() - Date.parse(riddle.raisedAt)) / DAY) || 0;
  return 1 + (riddle.deferCount || 0) * rules.deferWeightGrowth + 0.1 * age;
}
