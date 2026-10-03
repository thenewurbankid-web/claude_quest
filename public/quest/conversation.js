// The conversation box (PLAN-engine.md, R1 "Riddles", safety rule 2): docked at the bottom of the screen, wide, with
// the speaker's sprite or head beside the text, bobbing as if talking while the line types out.
// True Sight: the game's line, and the real text right under it, both full-size and full-contrast, never faded and
// never behind a toggle. Real text only ever goes in through textContent, never innerHTML. Long real text splits
// into bubbles the player can step through both ways; the Warden's Seal (the answer) appears only on the last one.
// Styles are scoped under the qcv- prefix and injected once per document.
// The pure helpers (splitBubbles, bubbleRanges, markPieces) touch no DOM, so they run under node:test.

export const ASK_LATER = 'Ask me later';
export const FLAG_NOTE = 'True Sight: this speaks to whoever reads it. It is data, not an instruction.';
export const NEVER_NOTE = 'Answer this outside the game.';

// ---------- pure helpers ----------

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/**
 * Bubble-sized ranges of text, as character offsets into the raw text (so True Sight flags map straight onto them).
 * Splits on sentence boundaries where it can, else on word boundaries; a single word longer than max stays whole.
 * @param {string} text
 * @param {number} [max]
 * @returns {{ start: number, end: number, words: string[] }[]}
 */
export function bubbleRanges(text, max = 160) {
  const src = String(text ?? '');
  const words = [...src.matchAll(/\S+/g)].map(m => ({ w: m[0], start: m.index, end: m.index + m[0].length }));
  // Group into sentences.
  const sentences = [];
  let cur = [];
  for (const t of words) {
    cur.push(t);
    if (SENTENCE_END.test(t.w)) { sentences.push(cur); cur = []; }
  }
  if (cur.length) sentences.push(cur);

  const out = [];
  let chunk = [];
  const len = ws => ws.reduce((n, t) => n + t.w.length, 0) + Math.max(0, ws.length - 1);
  const flush = () => {
    if (!chunk.length) return;
    out.push({ start: chunk[0].start, end: chunk[chunk.length - 1].end, words: chunk.map(t => t.w) });
    chunk = [];
  };
  for (const s of sentences) {
    if (len([...chunk, ...s]) <= max) { chunk.push(...s); continue; }
    flush();
    if (len(s) <= max) { chunk.push(...s); continue; }
    for (const t of s) { // a sentence too long for one bubble: split it on words
      if (chunk.length && len([...chunk, t]) > max) flush();
      chunk.push(t);
    }
  }
  flush();
  return out;
}

/**
 * Split real text into bubble-sized chunks. Never loses or changes a character: the chunks joined with ' ' equal the
 * whitespace-normalised input (runs of whitespace become one space, ends trimmed). Empty text gives [].
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
export function splitBubbles(text, max = 160) {
  return bubbleRanges(text, max).map(r => r.words.join(' '));
}

/**
 * The pieces of text[start, end) with True Sight flags marked. Overlapping flags merge; flags are clipped to the
 * range. Joining the pieces' text gives exactly text.slice(start, end).
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {{ start: number, end: number, why?: string }[]} [flags]
 * @returns {{ text: string, flag: string|null }[]}
 */
export function markPieces(text, start, end, flags = []) {
  const src = String(text ?? '');
  const spans = (flags || [])
    .map(f => ({ s: Math.max(start, Number(f.start)), e: Math.min(end, Number(f.end)), why: f.why || 'flag' }))
    .filter(f => Number.isFinite(f.s) && Number.isFinite(f.e) && f.e > f.s)
    .sort((a, b) => a.s - b.s);
  const merged = [];
  for (const f of spans) {
    const last = merged[merged.length - 1];
    if (last && f.s <= last.e) {
      last.e = Math.max(last.e, f.e);
      if (!last.why.split(', ').includes(f.why)) last.why += `, ${f.why}`;
    } else merged.push({ ...f });
  }
  const out = [];
  let at = start;
  for (const f of merged) {
    if (f.s > at) out.push({ text: src.slice(at, f.s), flag: null });
    out.push({ text: src.slice(f.s, f.e), flag: f.why });
    at = f.e;
  }
  if (end > at) out.push({ text: src.slice(at, end), flag: null });
  return out;
}

/** The answer choices for a Riddle: its options with ASK_LATER always offered (once, last), or null for free text. */
export function choicesFor(riddle) {
  const opts = Array.isArray(riddle?.options) ? riddle.options.filter(o => typeof o === 'string' && o.trim()) : [];
  if (!opts.length) return null;
  return [...opts.filter(o => o !== ASK_LATER), ASK_LATER];
}

// ---------- the box ----------

const STYLE_ID = 'qcv-styles';
const CSS = `
.qcv-root { --qcv-bg: #12151f; --qcv-line: rgba(255, 255, 255, 0.18); --qcv-text: #f4f5f8; --qcv-dim: #b9bfcc;
  --qcv-gold: #f2c14e; --qcv-mark: #ffe08a; --qcv-mark-text: #1a1300;
  position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 1100; box-sizing: border-box;
  width: min(1040px, calc(100vw - 16px)); max-height: min(70vh, 560px); overflow-y: auto; overflow-x: hidden;
  display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px;
  background: var(--qcv-bg); color: var(--qcv-text); border: 2px solid var(--qcv-line); border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow-wrap: anywhere; }
.qcv-root[hidden] { display: none; }
.qcv-root *, .qcv-root *::before, .qcv-root *::after { box-sizing: border-box; }
.qcv-root:focus { outline: none; }
.qcv-root:focus-visible, .qcv-root button:focus-visible, .qcv-root input:focus-visible {
  outline: 3px solid var(--qcv-gold); outline-offset: 2px; }
.qcv-speaker { flex: none; width: 72px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.qcv-head { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; overflow: hidden;
  background: #3a4a6b; color: #fff; font-size: 28px; font-weight: 700; border: 2px solid var(--qcv-line);
  image-rendering: pixelated; }
.qcv-head img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.qcv-talking .qcv-head { animation: qcv-bob 0.32s ease-in-out infinite alternate; }
@keyframes qcv-bob { from { transform: translateY(0); } to { transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) { .qcv-talking .qcv-head { animation: none; } }
.qcv-name { font-weight: 700; font-size: 14px; color: var(--qcv-gold); text-align: center; overflow-wrap: normal;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qcv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.qcv-line, .qcv-real { margin: 0; font-size: 16px; color: var(--qcv-text); }
.qcv-line { font-style: italic; }
.qcv-never { margin: 0; font-weight: 700; flex-basis: 100%; }
.qcv-real { white-space: pre-wrap; font-weight: 500; }
.qcv-real[hidden], .qcv-line[hidden], .qcv-note[hidden], .qcv-props[hidden], .qcv-seal[hidden] { display: none; }
.qcv-real mark { background: var(--qcv-mark); color: var(--qcv-mark-text); border-radius: 3px; padding: 0 2px; }
.qcv-note { margin: 0; padding: 6px 10px; border-left: 4px solid var(--qcv-mark); background: rgba(255, 224, 138, 0.1);
  color: var(--qcv-text); font-size: 14px; }
.qcv-props { margin: 0; padding: 0; list-style: none; font-size: 14px; }
.qcv-props li { padding: 2px 0; }
.qcv-ctx[hidden], .qcv-more[hidden] { display: none; }
.qcv-crumbs { margin: 0; color: var(--qcv-dim); font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.qcv-more { font-size: 14px; }
.qcv-more > summary { cursor: pointer; color: var(--qcv-dim); font-size: 13px; width: fit-content; }
.qcv-facts { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0 0; }
.qcv-facts dt { color: var(--qcv-dim); }
.qcv-facts dd { margin: 0; }
.qcv-asks { flex: 1 1 100%; margin: 0; padding: 0; list-style: none; font-size: 14px; }
.qcv-asks .qcv-reply { padding-left: 12px; margin-bottom: 4px; color: var(--qcv-dim); }
.qcv-seal { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.qcv-seal input { flex: 1 1 180px; min-width: 0; padding: 8px 10px; border-radius: 8px; border: 2px solid var(--qcv-line);
  background: #0b0d14; color: var(--qcv-text); font: inherit; }
.qcv-btn { padding: 8px 14px; border-radius: 8px; border: 2px solid var(--qcv-line); background: #263049;
  color: var(--qcv-text); font: inherit; font-size: 15px; cursor: pointer; min-height: 40px; }
.qcv-btn:hover { background: #33405f; }
.qcv-btn:disabled { opacity: 0.45; cursor: default; }
.qcv-choice { border-color: var(--qcv-gold); }
.qcv-nav { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; }
.qcv-count { color: var(--qcv-dim); font-size: 13px; margin-right: auto; }
.qcv-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.qcv-root.qcv-plain { background: #fff; color: #000; border: 2px solid #000; border-radius: 4px; box-shadow: none;
  font-family: system-ui, sans-serif; }
.qcv-plain .qcv-speaker { display: none; }
.qcv-plain p { margin: 0; color: #000; }
.qcv-plain .qcv-btn { background: #fff; color: #000; border: 2px solid #000; }
.qcv-plain .qcv-btn:hover { background: #eee; }
.qcv-plain .qcv-btn:focus-visible { outline-color: #0050c8; }
.qcv-plain .qcv-real { font-weight: 400; }
@media (max-width: 480px) {
  .qcv-root { gap: 10px; padding: 10px; bottom: 8px; }
  .qcv-speaker { width: 64px; }
  .qcv-name { font-size: 12px; }
  .qcv-head { width: 44px; height: 44px; font-size: 20px; }
  .qcv-nav .qcv-btn, .qcv-seal .qcv-btn { flex: 1 1 auto; }
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (text, cls = '') => {
  const b = el('button', `qcv-btn ${cls}`.trim(), text);
  b.type = 'button';
  return b;
};
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 0;

/**
 * Mount the conversation box into container (usually document.body). It stays hidden until say() or ask().
 * @param {HTMLElement} container
 * @returns {{ say: (lines: string[], speaker: { name: string, sprite?: string }) => Promise<void>,
 *   ask: (riddle: object, opts: { speaker: { name: string, sprite?: string }, tier?: 'normal'|'confirm'|'never',
 *     flags?: { start: number, end: number, why: string }[], workTitle?: string, agentName?: string,
 *     context?: { path: string[], facts: [string, string][] }, lockMs?: number })
 *     => Promise<{ choice: string }|{ askBack: string }|{ reply: string }|null>,
 *   close: () => void, unmount: () => void }}
 */
export function mountConversation(container) {
  injectStyles();
  const id = `qcv-${++uid}`;
  const root = el('div', 'qcv-root');
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', `${id}-name`);

  const speakerBox = el('div', 'qcv-speaker');
  const head = el('div', 'qcv-head');
  head.setAttribute('aria-hidden', 'true');
  const name = el('div', 'qcv-name');
  name.id = `${id}-name`;
  speakerBox.append(head, name);

  const main = el('div', 'qcv-main');
  const live = el('div', 'qcv-sr');
  live.setAttribute('aria-live', 'polite');
  // Where the question comes from: March › Hall › Work always shown, the rest in an expandable section.
  const ctx = el('div', 'qcv-ctx');
  const crumbs = el('p', 'qcv-crumbs');
  const more = el('details', 'qcv-more');
  const moreSum = el('summary', '', 'More about this task');
  const facts = el('dl', 'qcv-facts');
  more.append(moreSum, facts);
  ctx.append(crumbs, more);
  const fillContext = c => {
    crumbs.textContent = (c?.path || []).filter(Boolean).join(' › ');
    facts.replaceChildren();
    for (const [k, v] of c?.facts || []) facts.append(el('dt', '', String(k)), el('dd', '', String(v ?? '')));
    more.hidden = !(c?.facts || []).length;
    more.open = false;
  };
  const line = el('p', 'qcv-line');
  line.setAttribute('aria-hidden', 'true'); // typed out visually; the live region carries it whole
  const real = el('p', 'qcv-real');
  const note = el('p', 'qcv-note', FLAG_NOTE);
  const props = el('ul', 'qcv-props');
  props.setAttribute('aria-label', 'Proposals');
  const seal = el('div', 'qcv-seal');
  seal.setAttribute('role', 'group');
  seal.setAttribute('aria-label', "The Warden's Seal");
  const nav = el('div', 'qcv-nav');
  const count = el('span', 'qcv-count');
  const back = button('Back');
  const next = button('Next');
  const closeBtn = button('Close');
  back.setAttribute('aria-keyshortcuts', 'ArrowLeft');
  next.setAttribute('aria-keyshortcuts', 'ArrowRight Enter Space');
  closeBtn.setAttribute('aria-keyshortcuts', 'Escape');
  nav.append(count, back, next, closeBtn);
  main.append(live, ctx, line, real, note, props, seal, nav);
  root.append(speakerBox, main);
  container.appendChild(root);

  // ---------- state ----------
  let session = null; // { kind, bubbles, i, speaker, riddle, opts, resolve, view }
  let returnFocus = null;
  let timer = null;
  let typing = null; // { target, full }

  const stopTyping = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (typing) typing.target.textContent = typing.full;
    typing = null;
    root.classList.remove('qcv-talking');
  };
  const typeOut = (target, full) => {
    stopTyping();
    if (!full || reducedMotion()) { target.textContent = full; return; }
    typing = { target, full };
    let n = 0;
    target.textContent = '';
    root.classList.add('qcv-talking');
    timer = setInterval(() => {
      n = Math.min(full.length, n + 2);
      target.textContent = full.slice(0, n);
      if (n >= full.length) stopTyping();
    }, 24);
  };

  const setSpeaker = sp => {
    const nm = String(sp?.name ?? '');
    name.textContent = nm;
    head.textContent = '';
    if (sp?.sprite) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = sp.sprite;
      head.appendChild(img);
    } else head.textContent = (nm.trim()[0] || '?').toUpperCase();
  };

  const fillReal = (b, flags) => {
    real.textContent = '';
    for (const p of markPieces(b.src, b.start, b.end, flags)) {
      if (!p.flag) { real.append(document.createTextNode(p.text)); continue; }
      const m = el('mark', '', p.text);
      m.title = `True Sight flag: ${p.flag}`;
      real.append(m);
    }
  };

  const finish = result => {
    if (!session) return;
    const s = session;
    session = null;
    stopTyping();
    root.hidden = true;
    root.classList.remove('qcv-plain');
    live.textContent = '';
    s.resolve(result);
    const to = returnFocus;
    returnFocus = null;
    if (to && typeof to.focus === 'function' && to.isConnected) to.focus();
  };

  // Input lock (R2, safety in combat): with lockMs, no choice can be picked until lockMs after the box opens AND after
  // the last key press, so mashing straight through a pause never lands on an answer.
  const locked = () => !!session && Date.now() < (session.lockedUntil || 0);
  const setLock = s => {
    clearTimeout(lockTimer);
    root.classList.toggle('qcv-locked', locked());
    for (const b of seal.querySelectorAll('button:not([data-safe])')) b.disabled = locked();
    if (locked()) lockTimer = setTimeout(() => session === s && setLock(s), s.lockedUntil - Date.now() + 10);
  };
  let lockTimer = null;

  const open = s => {
    if (session) finish(session.kind === 'ask' ? null : undefined);
    session = s;
    if (s.opts?.lockMs > 0) s.lockedUntil = Date.now() + s.opts.lockMs;
    returnFocus = document.activeElement;
    setSpeaker(s.speaker);
    root.hidden = false;
    render();
    root.focus();
  };

  // ---------- views ----------
  function render() {
    const s = session;
    if (!s) return;
    root.classList.toggle('qcv-plain', s.view === 'confirm');
    if (s.view === 'confirm') return renderConfirm();
    const b = s.bubbles[s.i];
    const last = s.i === s.bubbles.length - 1;
    seal.replaceChildren();
    props.replaceChildren();
    ctx.hidden = !(s.kind === 'ask' && s.opts?.context);

    if (s.kind === 'say') {
      line.hidden = true;
      real.hidden = false;
      real.removeAttribute('aria-hidden');
      live.textContent = b.text;
      real.setAttribute('aria-hidden', 'true');
      typeOut(real, b.text);
      note.hidden = true;
      props.hidden = true;
      seal.hidden = true;
    } else {
      // True Sight: the game's line on the first bubble, the real text under it, both always readable.
      const gameLine = s.i === 0 && s.riddle.line ? String(s.riddle.line) : '';
      line.hidden = !gameLine;
      real.hidden = false;
      real.removeAttribute('aria-hidden');
      fillReal(b, s.opts.flags);
      live.textContent = [gameLine, b.text].filter(Boolean).join(' — ');
      if (gameLine) typeOut(line, gameLine); else stopTyping();
      const flagged = markPieces(b.src, b.start, b.end, s.opts.flags).some(p => p.flag);
      note.hidden = !flagged;
      const proposals = last && Array.isArray(s.riddle.proposals) ? s.riddle.proposals : [];
      for (const p of proposals) props.append(el('li', '', `Proposed by ${p?.by ?? 'someone'}: ${p?.text ?? ''}`));
      props.hidden = !proposals.length;
      seal.hidden = !last; // the Warden's Seal only once the whole question has been read
      if (last) renderSeal();
    }

    count.textContent = s.bubbles.length > 1 ? `${s.i + 1} / ${s.bubbles.length}` : '';
    back.hidden = s.bubbles.length < 2;
    back.disabled = s.i === 0;
    next.hidden = s.kind === 'ask' && last;
    next.textContent = s.kind === 'say' && last ? 'Done' : 'Next';
  }

  // The Warden's Seal: the answer choices, plus "Other…" (your own answer), "Ask back…" (a question to the agent on the
  // Work instead of answering) and, while a question waits, "Paste reply…" (by hand until R3's /work page).
  function renderSeal() {
    const s = session;
    const agent = s.opts.agentName || 'the Keeper';
    const asks = Array.isArray(s.riddle.asks) ? s.riddle.asks : [];
    if (asks.length) {
      const list = el('ul', 'qcv-asks');
      list.setAttribute('aria-label', 'Questions asked back');
      for (const a of asks) {
        list.append(el('li', '', `You asked: ${a?.text ?? ''}`));
        list.append(el('li', 'qcv-reply', a?.reply ? `${a.reply.by ?? agent} replied: ${a.reply.text ?? ''}` : `Waiting on ${agent}.`));
      }
      seal.append(list);
    }
    const waiting = asks.some(a => !a?.reply);
    if (s.entry) return renderEntry(agent);
    const open = mode => { s.entry = mode; render(); seal.querySelector('input')?.focus(); };
    const choices = s.opts.tier === 'never' ? null : choicesFor(s.riddle);
    if (s.opts.tier === 'never') seal.append(el('p', 'qcv-never', NEVER_NOTE));
    for (const c of choices || []) {
      if (c === ASK_LATER) continue;
      const b = button(c, 'qcv-choice');
      b.addEventListener('click', () => choose(c));
      seal.append(b);
    }
    if (s.opts.tier !== 'never') {
      const other = button(choices ? 'Other…' : 'Answer…', 'qcv-choice');
      other.addEventListener('click', () => open('other'));
      seal.append(other);
    }
    const ask = button('Ask back…', 'qcv-choice');
    ask.addEventListener('click', () => open('ask'));
    seal.append(ask);
    if (waiting) {
      const paste = button(`Paste ${agent}'s reply…`, 'qcv-choice');
      paste.addEventListener('click', () => open('reply'));
      seal.append(paste);
    }
    const later = button(ASK_LATER, 'qcv-choice');
    later.addEventListener('click', () => choose(ASK_LATER));
    seal.append(later);
    if (s.lockedUntil) setLock(s);
  }

  // One text field for the three typed actions. Typed text is shown back only through textContent.
  function renderEntry(agent) {
    const s = session;
    const [label, send] = {
      other: ['Your answer', 'Seal'],
      ask: [`Your question for ${agent}`, 'Ask'],
      reply: [`${agent}'s reply, pasted`, 'Add reply'],
    }[s.entry];
    const input = el('input');
    input.type = 'text';
    input.setAttribute('aria-label', label);
    input.placeholder = label;
    const go = () => {
      const v = input.value.trim();
      if (!v) return input.focus();
      if (s.entry === 'other') { s.entry = null; choose(v); }
      else finish(s.entry === 'ask' ? { askBack: v } : { reply: v });
    };
    const sendBtn = button(send, 'qcv-choice');
    sendBtn.addEventListener('click', go);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      e.stopPropagation(); // typing never moves the box or the player
    });
    const cancel = button('Cancel');
    cancel.addEventListener('click', () => { s.entry = null; render(); seal.querySelector('button')?.focus(); });
    seal.append(input, sendBtn, cancel);
  }

  function choose(choice) {
    const s = session;
    if (!s || locked()) return;
    if (s.opts.tier === 'confirm' && choice !== ASK_LATER) {
      s.view = 'confirm';
      s.pending = choice;
      if (s.opts.lockMs > 0) s.lockedUntil = Date.now() + s.opts.lockMs; // the plain confirm is locked afresh too
      render();
      return;
    }
    finish({ choice });
  }

  // A plain, un-themed confirm: no speaker, no game line, just the real decision.
  function renderConfirm() {
    const s = session;
    stopTyping();
    line.hidden = true;
    note.hidden = true;
    props.hidden = true;
    real.hidden = false;
    real.removeAttribute('aria-hidden');
    real.replaceChildren(
      el('p', '', 'This is a real decision.'),
      el('p', '', `Work: ${s.opts.workTitle || s.riddle.workId || '(unknown)'}`),
      el('p', '', `Question: ${s.riddle.text ?? ''}`),
      el('p', '', `Answer: ${s.pending}`),
      el('p', '', 'Seal it?'),
    );
    live.textContent = `This is a real decision. Answer: ${s.pending}. Seal it?`;
    seal.replaceChildren();
    seal.hidden = false;
    const yes = button('Seal');
    const no = button('Back');
    yes.addEventListener('click', () => !locked() && finish({ choice: s.pending }));
    no.addEventListener('click', () => { s.view = 'talk'; s.pending = null; render(); seal.querySelector('button, input')?.focus(); });
    seal.append(yes, no);
    count.textContent = '';
    back.hidden = true;
    next.hidden = true;
    if (s.lockedUntil) { no.dataset.safe = '1'; setLock(s); no.focus(); } // locked: never land on Seal by a held key
    else yes.focus();
  }

  // ---------- moving ----------
  function step(d) {
    const s = session;
    if (!s || s.view === 'confirm') return;
    const j = s.i + d;
    if (j < 0) return;
    if (j >= s.bubbles.length) { if (s.kind === 'say') finish(undefined); return; }
    s.i = j;
    render();
  }
  function advance() {
    if (typing) { stopTyping(); return; }
    step(1);
  }

  back.addEventListener('click', () => step(-1));
  next.addEventListener('click', advance);
  closeBtn.addEventListener('click', () => finish(session?.kind === 'ask' ? null : undefined));
  root.addEventListener('keydown', e => {
    if (!session) return;
    if (session.lockedUntil && locked()) { // still mashing: keep the lock on a little longer
      session.lockedUntil = Date.now() + session.opts.lockMs;
      setLock(session);
    }
    const t = e.target;
    const inInput = t instanceof HTMLInputElement;
    const onButton = t instanceof HTMLButtonElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (session.view === 'confirm') { session.view = 'talk'; session.pending = null; render(); root.focus(); }
      else finish(session.kind === 'ask' ? null : undefined);
    } else if (inInput) {
      return; // let the caret move and Enter seal
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); advance(); }
    else if ((e.key === 'Enter' || e.key === ' ') && !onButton) { e.preventDefault(); advance(); }
  });

  // ---------- the interface ----------
  const bubblesOf = (src, max) => {
    const rs = bubbleRanges(src, max);
    return rs.length ? rs.map(r => ({ src, start: r.start, end: r.end, text: r.words.join(' ') }))
      : [{ src, start: 0, end: 0, text: '' }];
  };

  return {
    say(lines, speaker) {
      const bubbles = (Array.isArray(lines) ? lines : [lines]).flatMap(l => bubblesOf(String(l ?? '')));
      return new Promise(resolve => open({ kind: 'say', bubbles, i: 0, speaker, resolve, view: 'talk' }));
    },
    ask(riddle, opts = {}) {
      const r = riddle || {};
      const o = { tier: 'normal', flags: [], ...opts };
      if (!['normal', 'confirm', 'never'].includes(o.tier)) o.tier = 'confirm'; // unknown tier: the safer one
      const bubbles = bubblesOf(String(r.text ?? ''));
      fillContext(o.context);
      return new Promise(resolve => open({ kind: 'ask', bubbles, i: 0, speaker: o.speaker, riddle: r, opts: o,
        resolve, view: 'talk', pending: null }));
    },
    close() { finish(session?.kind === 'ask' ? null : undefined); },
    unmount() {
      finish(session?.kind === 'ask' ? null : undefined);
      root.remove();
      if (!document.querySelector('.qcv-root')) document.getElementById(STYLE_ID)?.remove();
    },
  };
}
