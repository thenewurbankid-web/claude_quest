// The event log's readers (PLAN-engine.md, "Risks and gaps"): the "while you were away" digest shown on opening the
// game, play-session tracking, and question-to-answer time, the first success measure. The log is the ledger's
// append-only `events` list (contract.js Event: { at, kind, ref }); it never leaves the machine.
// The pure functions run under node:test; mountDigest is the only part that needs a DOM.
// Safety: text only ever goes in through textContent. Styles are scoped under the qdg- prefix and injected once.

const time = iso => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };

/** ISO string of the latest 'session.end' in the log, or null when there is none. */
export function lastSessionEnd(events) {
  let best = null, bestT = -Infinity;
  for (const e of events || []) {
    if (e?.kind !== 'session.end') continue;
    const t = time(e.at);
    if (t !== null && t >= bestT) { best = e.at; bestT = t; }
  }
  return best;
}

const DIGEST_KINDS = { raised: 'riddle.raised', answered: 'riddle.answered', sealed: 'riddle.sealed',
  returned: 'riddle.returned', faded: 'riddle.faded', blocked: 'agent.blocked', unblocked: 'agent.unblocked' };

/**
 * Counts the events strictly after `since` (null = the whole log).
 * @returns {import('./contract.js').Digest}
 */
export function digest(ledger, since) {
  const d = { since: since ?? null };
  for (const k of Object.keys(DIGEST_KINDS)) d[k] = 0;
  const after = since == null ? -Infinity : time(since) ?? -Infinity;
  const byKind = Object.fromEntries(Object.entries(DIGEST_KINDS).map(([k, v]) => [v, k]));
  for (const e of ledger?.events || []) {
    const k = byKind[e?.kind];
    if (!k) continue;
    const t = time(e.at);
    if (t !== null && t > after) d[k]++;
  }
  return d;
}

const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const was = count => (count === 1 ? 'was' : 'were');

/** Short plain sentences for the card; an empty array when nothing happened. */
export function digestLines(d) {
  const lines = [];
  if (d.raised) lines.push(`${n(d.raised, 'Riddle', 'Riddles')} arrived`);
  if (d.answered) lines.push(`${n(d.answered, 'Riddle', 'Riddles')} ${was(d.answered)} answered`);
  if (d.sealed) lines.push(`${n(d.sealed, 'decision', 'decisions')} ${was(d.sealed)} sealed`);
  if (d.returned) lines.push(`${n(d.returned, 'Riddle', 'Riddles')} came back from 'ask me later'`);
  if (d.faded) lines.push(`${n(d.faded, 'Riddle', 'Riddles')} faded`);
  if (d.blocked) lines.push(`${n(d.blocked, 'Keeper', 'Keepers')} got stuck`);
  if (d.unblocked) lines.push(`${n(d.unblocked, 'Keeper', 'Keepers')} got going again`);
  return lines;
}

/**
 * Question-to-answer time per Riddle ref: its first riddle.raised to its LAST riddle.answered (a recall then a new
 * answer counts the final one). Riddles never answered are left out. Items are in order of first raising.
 * @returns {{ count: number, medianMinutes: number|null, items: { ref: string, minutes: number, at: string }[] }}
 *   at: when the final answer came
 */
export function answerTimes(ledger) {
  const raised = new Map(), answered = new Map();
  for (const e of ledger?.events || []) {
    if (!e?.ref) continue;
    const t = time(e.at);
    if (t === null) continue;
    if (e.kind === 'riddle.raised' && !(raised.get(e.ref) <= t)) raised.set(e.ref, t);
    if (e.kind === 'riddle.answered' && !(answered.get(e.ref) >= t)) answered.set(e.ref, t);
  }
  const items = [...raised.entries()].sort((a, b) => a[1] - b[1])
    .filter(([ref, t]) => answered.has(ref) && answered.get(ref) >= t)
    .map(([ref, t]) => ({ ref, minutes: (answered.get(ref) - t) / 60000, at: new Date(answered.get(ref)).toISOString() }));
  return { count: items.length, medianMinutes: median(items.map(i => i.minutes)), items };
}

const median = xs => {
  const m = [...xs].sort((a, b) => a - b), mid = m.length >> 1;
  return !m.length ? null : m.length % 2 ? m[mid] : (m[mid - 1] + m[mid]) / 2;
};

const STAT_KINDS = { raised: 'riddle.raised', answered: 'riddle.answered', deferred: 'riddle.deferred',
  sealed: 'riddle.sealed', faded: 'riddle.faded', blocked: 'agent.blocked', unblocked: 'agent.unblocked',
  sessions: 'session.start', won: 'boss.defeated', retreated: 'boss.retreated' };

/** Minutes played from `from` on: each session.start to the next session.end, an open session up to now. */
function playMinutes(events, from, now) {
  let total = 0, start = null;
  const sorted = events.filter(e => e.kind === 'session.start' || e.kind === 'session.end')
    .map(e => [e.kind, time(e.at)]).filter(([, t]) => t !== null).sort((a, b) => a[1] - b[1]);
  for (const [kind, t] of sorted) {
    if (kind === 'session.start') start ??= t;
    else if (start !== null) { total += Math.max(0, t - Math.max(start, from)); start = null; }
  }
  if (start !== null) total += Math.max(0, now - Math.max(start, from));
  return total / 60000;
}

/**
 * The Keeper's Lodge stats board (PLAN-engine.md, success measures): counts over the last `days` and over the whole
 * log, question-to-answer time, play time, and, per Keeper, how many answers they got and how long they waited.
 * Riddles on a Work with no Keeper count under keeper null.
 */
export function realmStats(ledger, now = new Date(), { days = 7 } = {}) {
  const events = (ledger?.events || []).filter(e => e && typeof e.kind === 'string');
  const t = now.getTime(), from = t - days * 24 * 3600e3;
  const times = answerTimes(ledger);
  const window = since => {
    const out = {};
    for (const [k, kind] of Object.entries(STAT_KINDS))
      out[k] = events.filter(e => e.kind === kind && (time(e.at) ?? -Infinity) >= since).length;
    const answers = times.items.filter(i => time(i.at) >= since).map(i => i.minutes);
    return { ...out, medianMinutes: median(answers), playMinutes: playMinutes(events, since, t) };
  };

  const riddle = new Map((ledger?.riddles || []).map(r => [r.id, r]));
  const work = new Map((ledger?.works || []).map(w => [w.id, w]));
  const keeperOf = ref => work.get(riddle.get(ref)?.workId)?.keeperId ?? null;
  const rows = new Map((ledger?.keepers || []).map(k => [k.id, { keeper: k.id, name: k.name, answered: 0, waits: [], waiting: 0 }]));
  const row = id => rows.get(id) ?? (rows.set(id, { keeper: id, name: id ? 'A Keeper' : 'No Keeper', answered: 0, waits: [], waiting: 0 }), rows.get(id));
  for (const i of times.items) { const r = row(keeperOf(i.ref)); r.answered++; r.waits.push(i.minutes); }
  for (const r of riddle.values()) if (['open', 'deferred'].includes(r.state)) row(keeperOf(r.id)).waiting++;
  const keepers = [...rows.values()]
    .map(({ waits, ...r }) => ({ ...r, medianMinutes: median(waits) }))
    .sort((a, b) => b.answered + b.waiting - (a.answered + a.waiting) || String(a.name).localeCompare(b.name));

  return { days, recent: window(from), all: window(-Infinity), keepers };
}

/** "4 min", "2.5 h", "3 days"; an em dash for no data. */
export function duration(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${+(minutes / 60).toFixed(1)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

/**
 * Logs play sessions: a 'session.start' now, one 'session.end' when the page is hidden or left (pagehide, or
 * visibilitychange to hidden), and a new 'session.start' when it comes back (pageshow, or visible again).
 * `target` receives the listeners; its `document.visibilityState` (when present) says which way a
 * visibilitychange went. stop() only removes the listeners; it writes nothing.
 */
export function trackSession(store, { now = () => new Date(), target = globalThis } = {}) {
  let active = false;
  const log = kind => { Promise.resolve(store.put('events', { at: now().toISOString(), kind })).catch(() => {}); };
  const start = () => { if (!active) { active = true; log('session.start'); } };
  const end = () => { if (active) { active = false; log('session.end'); } };
  const onVisibility = () => ((target.document?.visibilityState ?? 'visible') === 'hidden' ? end() : start());
  const on = { pagehide: end, pageshow: start, visibilitychange: onVisibility };
  for (const [type, fn] of Object.entries(on)) target.addEventListener(type, fn);
  start();
  return () => { for (const [type, fn] of Object.entries(on)) target.removeEventListener(type, fn); };
}

/**
 * The `since` mountDigest uses: the one given (null included, meaning the whole log), else the last session.end in
 * the log as it stood at mount, so the session that mount starts doesn't erase the digest.
 */
export function resolveSince(given, events) {
  return given !== undefined ? given : lastSessionEnd(events);
}

// ---------- the card ----------
const STYLE_ID = 'qdg-styles';
const CSS = `
.qdg-root { position: fixed; top: 16px; right: 372px; z-index: 1000; box-sizing: border-box; width: 260px;
  padding: 10px 12px 12px; background: rgba(14, 16, 24, 0.82); color: #eef0f4;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.qdg-root[hidden] { display: none; }
.qdg-root *, .qdg-root *::before, .qdg-root *::after { box-sizing: border-box; }
.qdg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.qdg-title { flex: 1; margin: 0; font-size: 14px; font-weight: 600; color: #f2c14e; }
.qdg-close { flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none;
  color: #a3a9b6; font: 18px/1 system-ui, sans-serif; cursor: pointer; }
.qdg-close:hover { background: rgba(255, 255, 255, 0.1); color: #eef0f4; }
.qdg-close:focus-visible { outline: 2px solid #f2c14e; outline-offset: 1px; }
.qdg-list { margin: 0; padding: 0 0 0 18px; }
.qdg-toggle { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 0; border: 0;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.qdg-toggle:focus-visible { outline: 2px solid #f2c14e; outline-offset: 2px; border-radius: 6px; }
.qdg-badge { padding: 0 6px; border-radius: 999px; background: #f2c14e; color: #1b1406; font-size: 12px; font-weight: 700; }
.qdg-caret { color: #a3a9b6; font-size: 11px; }
.qdg-root:not(.qdg-folded) .qdg-caret { transform: rotate(180deg); }
.qdg-root.qdg-folded { width: auto; padding: 6px 12px; border-radius: 999px; }
.qdg-root.qdg-folded .qdg-head { margin: 0; }
.qdg-root.qdg-folded .qdg-list, .qdg-root.qdg-folded .qdg-close { display: none; }
.qdg-list li { margin: 2px 0; }
@media (max-width: 720px) {
  .qdg-root { top: var(--qdg-top, 72px); right: 16px; width: auto; max-width: calc(100vw - 32px); }
}
`;

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.append(s);
}

/**
 * Mounts the "While you were away" card into container and keeps its counts in step with store. Hidden when there is
 * nothing to say; the close button dismisses it until the next mount.
 * @returns {{ unmount: () => void }}
 */
export function mountDigest(container, store, { since } = {}) {
  injectStyles();
  const root = el('section', 'qdg-root');
  root.setAttribute('aria-label', 'While you were away');
  root.hidden = true;
  // Folded by default to a pill (the title and how many things changed); clicking it opens the list.
  const head = el('div', 'qdg-head'), close = el('button', 'qdg-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  const toggle = el('button', 'qdg-toggle'), badge = el('span', 'qdg-badge');
  toggle.type = 'button';
  toggle.append(el('span', 'qdg-title', 'While you were away'), badge, el('span', 'qdg-caret', '▾'));
  head.append(toggle, close);
  const list = el('ul', 'qdg-list');
  list.id = `qdg-list-${Math.random().toString(36).slice(2, 8)}`;
  toggle.setAttribute('aria-controls', list.id);
  root.append(head, list);
  const fold = f => { root.classList.toggle('qdg-folded', f); toggle.setAttribute('aria-expanded', String(!f)); };
  fold(true);
  toggle.addEventListener('click', () => fold(!root.classList.contains('qdg-folded')));
  container.append(root);

  // Beside the Beacon HUD on wide screens (left of it, whatever its width, folded or open); under 720px just below it.
  const narrow = matchMedia('(max-width: 720px)');
  const place = () => {
    const hud = document.querySelector('.qbh-root');
    if (!hud) return;
    const r = hud.getBoundingClientRect();
    if (narrow.matches) { root.style.right = ''; root.style.setProperty('--qdg-top', `${Math.round(r.bottom) + 8}px`); }
    else root.style.right = `${Math.round(innerWidth - r.left) + 8}px`;
  };
  const hudNode = document.querySelector('.qbh-root');
  const ro = hudNode && typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
  if (ro) ro.observe(hudNode);
  addEventListener('resize', place);
  place();

  let from, dismissed = false, gone = false, unsub = null;
  const render = ledger => {
    if (gone || from === undefined) return;
    const lines = digestLines(digest(ledger, from));
    list.replaceChildren(...lines.map(t => el('li', '', t)));
    badge.textContent = String(lines.length);
    root.hidden = dismissed || !lines.length;
  };
  close.addEventListener('click', () => { dismissed = true; root.hidden = true; });

  // `since` is fixed once, from the log as it stood at mount; later changes only update the counts.
  store.snapshot().then(l => {
    if (gone) return;
    from = resolveSince(since, l.events);
    render(l);
    unsub = store.subscribe(render);
  });

  return {
    unmount() {
      gone = true;
      if (unsub) unsub();
      if (ro) ro.disconnect();
      removeEventListener('resize', place);
      root.remove();
    },
  };
}
