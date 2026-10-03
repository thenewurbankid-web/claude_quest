// The outbox (PLAN-engine.md, R1; safety rules 1, 4 and 9): an answered Riddle waits at the gate until its outboxUntil,
// and can be called back until then ("Lumi waits at the gate a moment before flying; call her back"). Once the window
// closes it is sealed and written back to its Work as a Decision. Only sealed choices change a Work.
// The rules here are pure: they read a ledger snapshot and return Changes (contract.js); applyChanges writes them.
// The strip (prefix qob-) puts real text in through textContent only, never innerHTML.
import { applyChanges, noChanges, stewardOf } from './contract.js';

const PENDING = ['open', 'deferred', 'answered'];
const ms = iso => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(t) ? NaN : t; };
const clone = v => JSON.parse(JSON.stringify(v));

/** Answers waiting at the gate, soonest to seal first. secondsLeft is whole seconds, never below 0. */
export function outboxItems(ledger, now = new Date()) {
  const t = now.getTime();
  return (ledger.riddles || [])
    .filter(r => r.state === 'answered')
    .map(r => ({
      riddle: r,
      work: (ledger.works || []).find(w => w.id === r.workId) || null,
      secondsLeft: Math.max(0, Math.ceil(((ms(r.outboxUntil) || t) - t) / 1000)),
    }))
    .sort((a, b) => (ms(a.riddle.outboxUntil) || 0) - (ms(b.riddle.outboxUntil) || 0));
}

/** Calls an answer back from the gate: answered → open. Throws once the window has closed (it is sealing). */
export function recallRiddle(ledger, riddleId, now = new Date()) {
  const r = (ledger.riddles || []).find(x => x.id === riddleId);
  if (!r) throw new Error(`no Riddle ${riddleId}`);
  if (r.state !== 'answered') throw new Error(`Riddle ${riddleId} is ${r.state}, not waiting in the outbox`);
  if (!(ms(r.outboxUntil) > now.getTime())) throw new Error(`too late: Riddle ${riddleId} is sealing`);
  return {
    puts: [{ kind: 'riddles', record: { ...clone(r), state: 'open', answer: null, outboxUntil: null } }],
    events: [{ at: now.toISOString(), kind: 'riddle.recalled', ref: r.id }],
  };
}

/**
 * Seals every answered Riddle whose window has closed and writes each back to its Work as one Decision.
 * An answer by someone other than the steward is never sealed here (rule 10): it stays put for the answering rules.
 */
export function sealDue(ledger, now = new Date()) {
  const t = now.getTime(), at = now.toISOString();
  const due = (ledger.riddles || []).filter(r => r.state === 'answered' && r.answer?.by && ms(r.outboxUntil) <= t
    && r.answer.by === (r.steward || stewardOf(ledger, r.marchId)));
  if (!due.length) return noChanges();
  const sealing = new Set(due.map(r => r.id));
  const changes = noChanges();
  const works = new Map(); // workId → the Work as it will be written, so several seals on one Work add up

  for (const r of due) {
    changes.puts.push({ kind: 'riddles', record: { ...clone(r), state: 'sealed', sealed_by: r.answer.by, resolvedAt: at } });
    changes.events.push({ at, kind: 'riddle.sealed', ref: r.id });
    const base = works.get(r.workId) || (ledger.works || []).find(w => w.id === r.workId);
    if (!base) continue;
    const w = works.get(r.workId) || clone(base);
    w.decisions = w.decisions || [];
    if (!w.decisions.some(d => d.riddleId === r.id)) // rule 9: one Decision per Riddle, ever
      w.decisions.push({ riddleId: r.id, question: r.text, answer: r.answer.text, sealed_by: r.answer.by, at, sent: null });
    works.set(r.workId, w);
  }

  for (const w of works.values()) {
    if (w.status === 'blocked') {
      const stillPending = (ledger.riddles || []).some(r => r.workId === w.id && !sealing.has(r.id) && PENDING.includes(r.state));
      if (!stillPending) {
        w.status = 'todo';
        changes.events.push({ at, kind: 'agent.unblocked', ref: w.id });
      }
    }
    changes.puts.push({ kind: 'works', record: w });
  }
  return changes;
}

/** One pass: snapshot → sealDue → applyChanges when there is anything to write. Resolves to the Changes applied. */
export async function outboxTick(store, now = new Date()) {
  const changes = sealDue(await store.snapshot(), now);
  if (changes.puts.length || changes.events.length) await applyChanges(store, changes);
  return changes;
}

/** Seals due answers on a timer. Returns stop(). A tick never starts while the last one is still writing. */
export function startOutbox(store, { now = () => new Date(), every = 1000 } = {}) {
  let busy = false;
  const id = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await outboxTick(store, now()); } catch (e) { console.error('outbox tick failed', e); } finally { busy = false; }
  }, every);
  return () => clearInterval(id);
}

// ---------- the strip ----------
const STYLE_ID = 'qob-styles';
const CSS = `
.qob-root { --qob-bg: rgba(14, 16, 24, 0.86); --qob-line: rgba(255, 255, 255, 0.14); --qob-text: #eef0f4;
  --qob-dim: #a3a9b6; --qob-gold: #f2c14e;
  position: fixed; left: 16px; bottom: 216px; z-index: 1000; box-sizing: border-box;
  width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 248px); overflow-y: auto; overflow-x: hidden;
  background: var(--qob-bg); color: var(--qob-text); border: 1px solid var(--qob-line); border-radius: 12px;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.qob-root[hidden] { display: none; }
.qob-root *, .qob-root *::before, .qob-root *::after { box-sizing: border-box; }
.qob-list { list-style: none; margin: 0; padding: 0; }
.qob-item { display: flex; gap: 10px; align-items: center; padding: 10px 12px; }
.qob-item + .qob-item { border-top: 1px solid var(--qob-line); }
.qob-main { flex: 1; min-width: 0; }
.qob-lead { color: var(--qob-gold); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.qob-work { font-weight: 600; }
.qob-answer { margin-top: 2px; }
.qob-time { flex: none; min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; font-size: 18px;
  font-weight: 600; color: var(--qob-gold); }
.qob-recall { flex: none; min-height: 36px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--qob-gold);
  background: rgba(242, 193, 78, 0.12); color: var(--qob-text); font: inherit; font-weight: 600; cursor: pointer; }
.qob-recall:hover { background: rgba(242, 193, 78, 0.25); }
.qob-recall:focus-visible { outline: 2px solid var(--qob-gold); outline-offset: 2px; }
.qob-recall:disabled { opacity: 0.5; cursor: default; }
.qob-note { padding: 0 12px 8px; color: var(--qob-dim); font-size: 12px; }
.qob-note:empty { display: none; }
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.append(s);
}

/**
 * Mounts the outbox strip: each waiting answer with its countdown and a Recall button. Hidden when nothing waits.
 * Rows are keyed by Riddle id and updated in place, so focus on a Recall button survives the per-second refresh.
 * @returns {{ unmount: () => void }}
 */
export function mountOutbox(container, store, { now = () => new Date() } = {}) {
  injectStyles();
  const root = el('section', 'qob-root');
  root.setAttribute('aria-label', 'Outbox: answers waiting at the gate');
  root.hidden = true;
  const list = el('ul', 'qob-list');
  const note = el('div', 'qob-note');
  note.setAttribute('role', 'status');
  root.append(list, note);
  container.append(root);

  const rows = new Map(); // riddleId → { li, work, answer, time, btn }
  let ledger = null, timer = null, alive = true;

  async function recall(riddleId, btn) {
    btn.disabled = true;
    try {
      await applyChanges(store, recallRiddle(await store.snapshot(), riddleId, now()));
      note.textContent = 'Lumi came back. The question is open again.';
    } catch (e) {
      note.textContent = 'Too late: Lumi has already flown.';
      btn.disabled = false;
    }
  }

  function row(riddleId) {
    let r = rows.get(riddleId);
    if (r) return r;
    const li = el('li', 'qob-item'), main = el('div', 'qob-main');
    const work = el('div', 'qob-work'), answer = el('div', 'qob-answer');
    main.append(el('div', 'qob-lead', 'Lumi waits at the gate'), work, answer);
    const time = el('span', 'qob-time');
    const btn = el('button', 'qob-recall', 'Recall');
    btn.type = 'button';
    btn.addEventListener('click', () => recall(riddleId, btn));
    li.append(main, time, btn);
    r = { li, work, answer, time, btn };
    rows.set(riddleId, r);
    return r;
  }

  function render() {
    if (!alive || !ledger) return;
    const items = outboxItems(ledger, now());
    const seen = new Set();
    items.forEach(({ riddle, work, secondsLeft }, i) => {
      seen.add(riddle.id);
      const r = row(riddle.id);
      const title = work?.title || 'Unknown Work';
      r.work.textContent = title;
      r.answer.textContent = riddle.answer?.text || '';
      r.time.textContent = `${secondsLeft}s`;
      r.time.setAttribute('aria-label', `${secondsLeft} seconds left`);
      r.btn.setAttribute('aria-label', `Recall the answer for ${title}, ${secondsLeft} seconds left`);
      if (list.children[i] !== r.li) list.insertBefore(r.li, list.children[i] || null);
    });
    for (const [id, r] of rows) if (!seen.has(id)) { r.li.remove(); rows.delete(id); }
    root.hidden = !items.length;
    if (!items.length) note.textContent = '';
    if (items.length && !timer) timer = setInterval(render, 1000);
    if (!items.length && timer) { clearInterval(timer); timer = null; }
  }

  let fresh = false;
  const off = store.subscribe(l => { if (alive) { fresh = true; ledger = l; render(); } });
  store.snapshot().then(l => { if (alive && !fresh) { ledger = l; render(); } });

  return {
    unmount() {
      alive = false;
      off();
      if (timer) clearInterval(timer);
      root.remove();
      if (!document.querySelector('.qob-root')) document.getElementById(STYLE_ID)?.remove();
    },
  };
}
