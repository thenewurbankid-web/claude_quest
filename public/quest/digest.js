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
 * @returns {{ count: number, medianMinutes: number|null, items: { ref: string, minutes: number }[] }}
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
    .map(([ref, t]) => ({ ref, minutes: (answered.get(ref) - t) / 60000 }));
  const m = items.map(i => i.minutes).sort((a, b) => a - b), mid = m.length >> 1;
  const medianMinutes = !m.length ? null : m.length % 2 ? m[mid] : (m[mid - 1] + m[mid]) / 2;
  return { count: items.length, medianMinutes, items };
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
.qdg-list li { margin: 2px 0; }
@media (max-width: 720px) {
  .qdg-root { top: var(--qdg-top, 72px); right: 16px; left: 16px; width: auto; }
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
  const head = el('div', 'qdg-head'), close = el('button', 'qdg-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  head.append(el('h2', 'qdg-title', 'While you were away'), close);
  const list = el('ul', 'qdg-list');
  root.append(head, list);
  container.append(root);

  // Under 720px the Beacon HUD spans the top, so the card sits just below it, following its height.
  const narrow = matchMedia('(max-width: 720px)');
  const place = () => {
    const hud = document.querySelector('.qbh-root');
    if (narrow.matches && hud) root.style.setProperty('--qdg-top', `${Math.round(hud.getBoundingClientRect().bottom) + 8}px`);
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
