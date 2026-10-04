// The /work page (PLAN-engine.md, R4; safety rules 5 and 12): queued Works as ready-to-copy prompts, grouped by Keeper,
// and a paste box for each leased one. It talks only to a LedgerStore (the game's own IndexedDB ledger on work.html)
// and re-renders on subscribe; leases are ticked every 30s. Pasted and real text go in with textContent only, never
// innerHTML. No native dialogs: notes and choices are in the page. Scoped styles, prefix qwp-.
import { applyChanges, emberLeft, DEFAULT_RULES, REPORT_KIND } from './contract.js';
import { buildPrompt, copyPrompt, pasteResult, tickLeases, workBoard, emberReturnsAt, leaseLeft } from './work-queue.js';

const STYLE_ID = 'qwp-styles';
const CSS = `
.qwp-root { --qwp-bg: rgba(14, 16, 24, 0.86); --qwp-line: rgba(255, 255, 255, 0.14); --qwp-text: #eef0f4;
  --qwp-dim: #a3a9b6; --qwp-gold: #f2c14e; --qwp-red: #ff8a7a;
  box-sizing: border-box; width: 100%; max-width: 760px; margin: 0 auto; padding: 16px;
  color: var(--qwp-text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.qwp-root *, .qwp-root *::before, .qwp-root *::after { box-sizing: border-box; }
.qwp-top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
.qwp-title { margin: 0; font-size: 20px; }
.qwp-back { color: var(--qwp-gold); min-height: 40px; display: inline-flex; align-items: center; }
.qwp-ember { margin: 12px 0; padding: 10px 12px; border-radius: 12px; background: var(--qwp-bg);
  border: 1px solid var(--qwp-line); }
.qwp-ember b { color: var(--qwp-gold); font-variant-numeric: tabular-nums; }
.qwp-bar { height: 8px; margin-top: 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.qwp-bar > i { display: block; height: 100%; background: var(--qwp-gold); }
.qwp-paused { margin-top: 8px; color: var(--qwp-red); }
.qwp-paused:empty { display: none; }
.qwp-empty { color: var(--qwp-dim); }
.qwp-keeper { margin: 16px 0; padding: 12px; border-radius: 12px; background: var(--qwp-bg); border: 1px solid var(--qwp-line); }
.qwp-kname { margin: 0; font-size: 16px; }
.qwp-kstatus { color: var(--qwp-dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.qwp-kstatus[data-s="wandered"], .qwp-kstatus[data-s="resting"] { color: var(--qwp-gold); }
.qwp-item { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--qwp-line); }
.qwp-work { font-weight: 600; }
.qwp-where, .qwp-lease, .qwp-last { color: var(--qwp-dim); font-size: 13px; }
.qwp-lease[data-lapsed] { color: var(--qwp-gold); }
.qwp-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.qwp-btn { min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.08); color: var(--qwp-text); font: inherit; font-weight: 600; cursor: pointer; }
.qwp-btn.qwp-main { border-color: var(--qwp-gold); background: rgba(242, 193, 78, 0.14); }
.qwp-btn[aria-pressed="true"] { border-color: var(--qwp-gold); background: rgba(242, 193, 78, 0.3); }
.qwp-btn:hover { background: rgba(255, 255, 255, 0.16); }
.qwp-btn:focus-visible, .qwp-text:focus-visible { outline: 2px solid var(--qwp-gold); outline-offset: 2px; }
.qwp-btn:disabled { opacity: 0.5; cursor: default; }
.qwp-text { display: block; width: 100%; margin-top: 8px; padding: 8px; border-radius: 8px; border: 1px solid var(--qwp-line);
  background: rgba(0, 0, 0, 0.35); color: var(--qwp-text); font: 13px/1.4 ui-monospace, Menlo, monospace; resize: vertical; }
.qwp-label { display: block; margin-top: 8px; font-size: 13px; color: var(--qwp-dim); }
.qwp-note { margin-top: 8px; font-size: 13px; }
.qwp-note:empty { display: none; }
.qwp-problems { margin: 8px 0 0; padding-left: 20px; color: var(--qwp-red); font-size: 13px; }
.qwp-problems:empty { display: none; }
.qwp-pick { margin-top: 8px; }
.qwp-pick[hidden], .qwp-row[hidden], .qwp-text[hidden], .qwp-label[hidden], .qwp-paste[hidden] { display: none; }
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (text, cls = 'qwp-btn') => { const b = el('button', cls, text); b.type = 'button'; return b; };

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.append(s);
}

const span = ms => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const clock = isoTime => new Date(isoTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Mounts the /work page into container. Cards are keyed by queue item and updated in place, so a half-typed paste
 * and focus survive every refresh. Returns { unmount }.
 */
export function mountWorkPage(container, store, { now = () => new Date(), rules = DEFAULT_RULES, gameUrl = './' } = {}) {
  injectStyles();
  const root = el('main', 'qwp-root');
  const top = el('div', 'qwp-top');
  const back = el('a', 'qwp-back', 'Back to the game');
  back.href = gameUrl;
  top.append(el('h1', 'qwp-title', "Keepers' work"), back);
  const ember = el('section', 'qwp-ember');
  ember.setAttribute('aria-live', 'polite');
  const emberLine = el('div'), bar = el('div', 'qwp-bar'), fill = el('i'), paused = el('div', 'qwp-paused');
  bar.append(fill);
  ember.append(emberLine, bar, paused);
  const intro = el('p', 'qwp-empty',
    'Copy a prompt into your own agent, then paste its reply here. Agents work on their own branch; a person merges.');
  const groups = el('div');
  root.append(top, ember, intro, groups);
  container.append(root);

  const sections = new Map(); // keeperId → { sec, name, status, rest, list }
  const cards = new Map();    // itemId → card parts
  let ledger = null, alive = true;

  async function copy(itemId, c) {
    c.copy.disabled = true;
    try {
      const l = await store.snapshot();
      const text = buildPrompt(l, itemId, rules);
      const changes = copyPrompt(l, itemId, now(), rules); // throws when it isn't offered any more
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch {}
      if (copied) {
        c.manual.hidden = true;
        c.note.textContent = 'Copied. Paste it into your agent, then paste its reply below.';
      } else { // no clipboard: show the prompt selected, to copy by hand
        c.manual.hidden = false;
        c.manual.value = text;
        c.manual.focus();
        c.manual.select();
        c.note.textContent = 'Copying was blocked here. The prompt is selected above: copy it by hand.';
      }
      await applyChanges(store, changes);
    } catch (e) {
      c.note.textContent = String(e.message || e);
    } finally { c.copy.disabled = false; }
  }

  async function submit(itemId, c) {
    c.submit.disabled = true;
    try {
      const l = await store.snapshot();
      const opts = c.kind ? { kind: c.kind, question: c.question.value } : {};
      const { changes, problems, refused } = pasteResult(l, itemId, c.paste.value, opts, now(), rules);
      c.problems.replaceChildren(...problems.map(p => el('li', null,
        `${p.field}: ${p.problem}${p.suggestions?.length ? ` (did you mean ${p.suggestions.map(x => `"${x}"`).join(' or ')}?)` : ''}`)));
      if (refused) { c.note.textContent = `Not taken: this item is ${refused}.`; return; }
      if (problems.length) {
        c.pick.hidden = false;
        c.note.textContent = c.kind ? 'Fill in what is missing, then submit again.'
          : 'No valid quest-report block. Pick what the reply means, then submit again; the paste is kept as is.';
        return;
      }
      const kind = changes.puts.find(p => p.kind === 'queue').record.reports.at(-1).kind;
      await applyChanges(store, changes);
      c.paste.value = '';
      c.question.value = '';
      setKind(c, null);
      c.pick.hidden = true;
      c.note.textContent = kind === 'done' ? 'Returned for review. It waits on a person to merge.'
        : kind === 'blocked' ? 'Blocked: its question is now a Riddle in the game.' : 'Progress noted; the lease is renewed.';
    } catch (e) {
      c.note.textContent = String(e.message || e);
    } finally { c.submit.disabled = false; }
  }

  function setKind(c, kind) {
    c.kind = kind;
    for (const [k, b] of c.kinds) b.setAttribute('aria-pressed', String(k === kind));
    c.qLabel.hidden = c.question.hidden = kind !== 'blocked';
  }

  function section(keeperId) {
    let s = sections.get(keeperId);
    if (s) return s;
    const sec = el('section', 'qwp-keeper'), name = el('h2', 'qwp-kname'), status = el('div', 'qwp-kstatus');
    const rest = el('p', 'qwp-empty'), list = el('div');
    sec.append(name, status, rest, list);
    s = { sec, name, status, rest, list };
    sections.set(keeperId, s);
    return s;
  }

  function card(itemId) {
    let c = cards.get(itemId);
    if (c) return c;
    const box = el('article', 'qwp-item');
    const work = el('div', 'qwp-work'), where = el('div', 'qwp-where'), lease = el('div', 'qwp-lease');
    const last = el('div', 'qwp-last');
    const copyRow = el('div', 'qwp-row'), copyBtn = button('Copy prompt', 'qwp-btn qwp-main');
    copyRow.append(copyBtn);
    const manual = el('textarea', 'qwp-text');
    manual.readOnly = true;
    manual.rows = 8;
    manual.hidden = true;
    manual.setAttribute('aria-label', 'The prompt, to copy by hand');
    const pasteWrap = el('div', 'qwp-paste');
    const pasteLabel = el('label', 'qwp-label', "Paste your agent's reply");
    const paste = el('textarea', 'qwp-text');
    paste.rows = 5;
    paste.id = `qwp-paste-${itemId}`;
    pasteLabel.htmlFor = paste.id;
    const problems = el('ul', 'qwp-problems');
    const pick = el('div', 'qwp-pick');
    pick.hidden = true;
    pick.append(el('div', 'qwp-label', 'What does the reply mean?'));
    const kindRow = el('div', 'qwp-row');
    const kinds = new Map();
    const KIND_LABEL = { progress: 'Still working', done: 'Done, ready for review', blocked: 'Blocked on a question' };
    for (const k of REPORT_KIND) { const b = button(KIND_LABEL[k] || k); b.setAttribute('aria-pressed', 'false'); kinds.set(k, b); kindRow.append(b); }
    const qLabel = el('label', 'qwp-label', 'The question it needs answered');
    const question = el('input', 'qwp-text');
    question.type = 'text';
    question.id = `qwp-q-${itemId}`;
    qLabel.htmlFor = question.id;
    pick.append(kindRow, qLabel, question);
    const submitRow = el('div', 'qwp-row'), submitBtn = button('Submit reply', 'qwp-btn qwp-main');
    submitRow.append(submitBtn);
    pasteWrap.append(pasteLabel, paste, problems, pick, submitRow);
    const note = el('div', 'qwp-note');
    note.setAttribute('role', 'status');
    box.append(work, where, lease, last, copyRow, manual, pasteWrap, note);
    c = { box, work, where, lease, last, copyRow, copy: copyBtn, manual, pasteWrap, paste, problems, pick, kinds, qLabel,
      question, submit: submitBtn, note, kind: null };
    for (const [k, b] of kinds) b.addEventListener('click', () => setKind(c, c.kind === k ? null : k));
    setKind(c, null);
    copyBtn.addEventListener('click', () => copy(itemId, c));
    submitBtn.addEventListener('click', () => submit(itemId, c));
    cards.set(itemId, c);
    return c;
  }

  const place = (parent, node, i) => { if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] || null); };

  function render() {
    if (!alive || !ledger) return;
    const t = now();
    const left = emberLeft(ledger, t, rules);
    emberLine.replaceChildren('Ember in the Well: ', el('b', null, `${Math.floor(left)} of ${rules.emberMax}`));
    fill.style.width = `${Math.max(0, Math.min(100, (left / rules.emberMax) * 100))}%`;
    const returns = emberReturnsAt(ledger, t, rules);
    paused.textContent = left > 0 ? '' : `The Well is out of Ember, so work is paused: no prompts are offered until it refills. `
      + (returns ? `Ember starts coming back ${clock(returns)}, as the tokens reported ${rules.emberWindowHours} hours earlier age out.`
        : `It refills as reported tokens age out of the last ${rules.emberWindowHours} hours.`)
      + ' Replies to work already copied are still taken.';

    const board = workBoard(ledger, t, rules);
    const marches = new Map(ledger.marches.map(m => [m.id, m])), halls = new Map(ledger.halls.map(h => [h.id, h]));
    const seenK = new Set(), seenI = new Set();
    board.forEach(({ keeper, items }, gi) => {
      seenK.add(keeper.id);
      const s = section(keeper.id);
      s.name.textContent = `${keeper.name} (${keeper.role})`;
      s.status.textContent = keeper.status;
      s.status.dataset.s = keeper.status;
      s.rest.textContent = keeper.status === 'resting' ? 'Resting: no prompts are offered. Call it back in the game.'
        : keeper.status === 'wandered' ? 'Wandered off: its lease lapsed. Copy the prompt again, or paste a late reply.' : '';
      s.rest.hidden = !s.rest.textContent;
      place(groups, s.sec, gi);
      items.forEach(({ item, work, offered }, ii) => {
        seenI.add(item.id);
        const c = card(item.id);
        c.work.textContent = work.title;
        c.where.textContent = [marches.get(work.marchId)?.name, halls.get(work.hallId)?.name, work.status.replace('_', ' ')]
          .filter(Boolean).join(' · ');
        const ms = leaseLeft(item, t);
        c.lease.toggleAttribute('data-lapsed', item.state === 'lapsed');
        c.lease.textContent = item.state === 'queued' ? 'Waiting to be copied.'
          : item.state === 'lapsed' ? 'Lease lapsed: the Work went back on the board. A late reply is still taken.'
          : ms > 0 ? `Leased: ${span(ms)} left. Each progress reply renews it.` : 'Lease ending now.';
        const r = item.reports?.at(-1);
        c.last.textContent = r ? `Last reply (${r.kind}${r.manual ? ', picked by hand' : ''}): ${r.summary}` : '';
        c.copyRow.hidden = !offered;
        c.copy.textContent = item.state === 'queued' ? 'Copy prompt' : 'Copy prompt again';
        if (!offered) c.manual.hidden = true;
        c.pasteWrap.hidden = item.state === 'queued';
        place(s.list, c.box, ii);
      });
    });
    for (const [id, c] of cards) if (!seenI.has(id)) { c.box.remove(); cards.delete(id); }
    for (const [id, s] of sections) if (!seenK.has(id)) { s.sec.remove(); sections.delete(id); }
    intro.textContent = board.length ? 'Copy a prompt into your own agent, then paste its reply here. Agents work on '
      + 'their own branch and never merge; a person does.' : 'Nothing is queued. Wake a Keeper in the game to give it work.';
  }

  let ticking = false;
  async function tick() {
    if (ticking || !alive) return;
    ticking = true;
    try {
      const changes = tickLeases(await store.snapshot(), now());
      if (changes.puts.length || changes.events.length) await applyChanges(store, changes);
      else render(); // countdowns move on even when nothing lapses
    } catch (e) { console.error('lease tick failed', e); } finally { ticking = false; }
  }

  let fresh = false;
  const off = store.subscribe(l => { if (alive) { fresh = true; ledger = l; render(); } });
  store.snapshot().then(l => { if (alive && !fresh) { ledger = l; render(); } tick(); });
  const timer = setInterval(tick, 30000);

  return {
    unmount() {
      alive = false;
      off();
      clearInterval(timer);
      root.remove();
      if (!document.querySelector('.qwp-root')) document.getElementById(STYLE_ID)?.remove();
    },
  };
}
