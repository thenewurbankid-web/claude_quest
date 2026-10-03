// The Beacon HUD (PLAN-engine.md, R0): a DOM overlay over the 3D canvas with the Beacon chip, the in-game log, the
// Sealed Halls and the Keepers' benches. It reads a LedgerStore (contract.js) and re-renders on every change.
// Safety: ledger text is real text, so it only ever goes in through textContent, never innerHTML.
// Styles are scoped under the qbh- prefix and injected once per document.
import { beacon, gameLog, sealedHalls, keepers } from './status.js';

const STYLE_ID = 'qbh-styles';
const CSS = `
.qbh-root { --qbh-bg: rgba(14, 16, 24, 0.82); --qbh-line: rgba(255, 255, 255, 0.12); --qbh-text: #eef0f4;
  --qbh-dim: #a3a9b6; --qbh-gold: #f2c14e; --qbh-amber: #f08a24; --qbh-red: #ef4b4b;
  position: fixed; top: 16px; right: 16px; z-index: 1000; box-sizing: border-box;
  width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden;
  background: var(--qbh-bg); color: var(--qbh-text); border: 1px solid var(--qbh-line); border-radius: 12px;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
.qbh-root *, .qbh-root *::before, .qbh-root *::after { box-sizing: border-box; }
.qbh-chip { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; margin: 0; border: 0;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.qbh-chip:focus-visible, .qbh-sec > summary:focus-visible, .qbh-root button:focus-visible {
  outline: 2px solid var(--qbh-gold); outline-offset: -2px; }
.qbh-dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--qbh-gold);
  box-shadow: 0 0 8px var(--qbh-gold); }
.qbh-dot[data-color="amber"] { background: var(--qbh-amber); box-shadow: 0 0 8px var(--qbh-amber); }
.qbh-dot[data-color="red"] { background: var(--qbh-red); box-shadow: 0 0 10px var(--qbh-red);
  animation: qbh-pulse 1.6s ease-in-out infinite; }
@keyframes qbh-pulse { 50% { opacity: 0.45; box-shadow: 0 0 2px var(--qbh-red); } }
@media (prefers-reduced-motion: reduce) { .qbh-dot[data-color="red"] { animation: none; } }
.qbh-realm { flex: 1; min-width: 0; font-weight: 600; font-size: 14px; }
.qbh-word { flex: none; color: var(--qbh-dim); font-size: 12px; text-transform: capitalize; }
.qbh-reasons { margin: 0; padding: 0 12px 10px 34px; color: var(--qbh-dim); }
.qbh-reasons[hidden] { display: none; }
.qbh-reasons li { margin: 2px 0; }
.qbh-sec { border-top: 1px solid var(--qbh-line); }
.qbh-sec > summary { display: flex; justify-content: space-between; gap: 8px; padding: 8px 12px; cursor: pointer;
  font-weight: 600; list-style: none; }
.qbh-sec > summary::-webkit-details-marker { display: none; }
.qbh-sec > summary::before { content: "\\25B8"; color: var(--qbh-dim); margin-right: 6px; }
.qbh-sec[open] > summary::before { content: "\\25BE"; }
.qbh-sec > summary > span:first-child { flex: 1; }
.qbh-count { color: var(--qbh-dim); font-weight: 400; }
.qbh-body { padding: 0 12px 10px; }
.qbh-root.qbh-folded { width: auto; max-width: calc(100vw - 32px); border-radius: 999px; }
.qbh-root.qbh-folded > :not(.qbh-chip) { display: none; }
.qbh-root.qbh-folded .qbh-chip { padding: 6px 12px; }
.qbh-badge { min-width: 20px; padding: 0 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.14);
  font-size: 12px; font-weight: 700; text-align: center; }
.qbh-badge:empty { display: none; }
.qbh-caret { color: var(--qbh-dim); font-size: 11px; transition: transform .15s; }
.qbh-root:not(.qbh-folded) .qbh-caret { transform: rotate(180deg); }
.qbh-h { margin: 6px 0 4px; color: var(--qbh-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.qbh-list { list-style: none; margin: 0; padding: 0; }
.qbh-list li { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; }
.qbh-list li + li { border-top: 1px solid rgba(255, 255, 255, 0.05); }
.qbh-banner { flex: none; width: 8px; height: 8px; border-radius: 2px; background: var(--qbh-dim);
  align-self: center; }
.qbh-text { flex: 1; min-width: 0; }
.qbh-at { flex: none; color: var(--qbh-dim); font-size: 11px; }
.qbh-kind { color: var(--qbh-dim); font-size: 11px; margin-right: 4px; }
.qbh-empty { color: var(--qbh-dim); font-style: italic; padding: 4px 0; }
.qbh-lock { flex: none; width: 14px; height: 14px; align-self: center; fill: none; stroke: currentColor;
  stroke-width: 2; stroke-linecap: round; color: var(--qbh-dim); }
.qbh-hall[data-locked="false"] .qbh-lock { color: var(--qbh-gold); }
.qbh-keepers { display: flex; gap: 8px; padding: 8px 12px 10px; border-top: 1px solid var(--qbh-line); }
.qbh-bench { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.06); }
.qbh-bench b { display: block; font-size: 18px; line-height: 1.1; }
.qbh-bench span { color: var(--qbh-dim); font-size: 11px; }
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const SVG = 'http://www.w3.org/2000/svg';
// A padlock, open (shackle lifted) or shut. Built with DOM calls; no markup strings.
function lockIcon(locked) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('class', 'qbh-lock');
  s.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(SVG, 'rect');
  for (const [k, v] of Object.entries({ x: 3, y: 7, width: 10, height: 7, rx: 1.5 })) body.setAttribute(k, v);
  const shackle = document.createElementNS(SVG, 'path');
  shackle.setAttribute('d', locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0');
  s.append(body, shackle);
  return s;
}
const when = iso => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const KIND = { riddle: 'Riddle', work: 'Work', queue: 'Keeper' };

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.append(s);
}

/**
 * Mounts the HUD into container (usually document.body) and keeps it in step with store.
 * @param {HTMLElement} container
 * @param {import('./contract.js').LedgerStore} store
 * @returns {{ destroy: () => void }}
 */
export function mountBeaconHud(container, store) {
  injectStyles();
  const root = el('aside', 'qbh-root');
  root.setAttribute('aria-label', 'Realm status');

  // The skeleton is built once, so open sections and the expanded chip survive re-renders.
  const chip = el('button', 'qbh-chip');
  chip.type = 'button';
  chip.setAttribute('aria-expanded', 'false');
  const dot = el('span', 'qbh-dot'), realm = el('span', 'qbh-realm'), word = el('span', 'qbh-word');
  chip.append(dot, realm, word);
  const reasons = el('ul', 'qbh-reasons');
  reasons.id = `qbh-reasons-${Math.random().toString(36).slice(2, 8)}`;
  reasons.hidden = true;
  chip.setAttribute('aria-controls', reasons.id);
  // Folded by default: only the chip shows (the Beacon's dot, the Realm and how many items wait), so the panel
  // stays out of the world until opened. The chip opens and folds the whole panel.
  const badge = el('span', 'qbh-badge'), caret = el('span', 'qbh-caret', '▾');
  chip.append(badge, caret);
  let folded = true;
  const fold = f => {
    folded = f;
    root.classList.toggle('qbh-folded', f);
    reasons.hidden = f;
    chip.setAttribute('aria-expanded', String(!f));
    chip.title = f ? 'Open the Realm panel' : 'Fold the Realm panel';
  };
  chip.addEventListener('click', () => fold(!folded));

  const section = (title, open) => {
    const d = el('details', 'qbh-sec');
    d.open = open;
    const s = el('summary'), count = el('span', 'qbh-count');
    s.append(el('span', '', title), count);
    const body = el('div', 'qbh-body');
    d.append(s, body);
    return { d, count, body };
  };
  // On a phone the log starts folded so the panel doesn't cover the world.
  const log = section('Log', !matchMedia('(max-width: 600px)').matches), halls = section('Sealed Halls', false);
  const benches = el('div', 'qbh-keepers');
  const bench = label => { const b = el('div', 'qbh-bench'), n = el('b'); b.append(n, el('span', '', label)); benches.append(b); return n; };
  const freeN = bench('Keepers free'), busyN = bench('Keepers busy'), restN = bench('resting');

  root.append(chip, reasons, log.d, halls.d, benches);
  fold(true);
  container.append(root);

  const bannerOf = (l, marchId) => l.marches.find(m => m.id === marchId)?.banner;
  const row = (l, item) => {
    const li = el('li'), dotM = el('span', 'qbh-banner'), text = el('span', 'qbh-text');
    const banner = bannerOf(l, item.marchId);
    if (banner) dotM.style.backgroundColor = banner; // an invalid colour is simply ignored
    text.append(el('span', 'qbh-kind', KIND[item.kind] || item.kind), document.createTextNode(item.text));
    li.append(dotM, text, el('time', 'qbh-at', when(item.at)));
    if (item.at) li.lastChild.dateTime = item.at;
    return li;
  };
  const list = (items, make, emptyText) => {
    if (!items.length) return el('div', 'qbh-empty', emptyText);
    const ul = el('ul', 'qbh-list');
    items.forEach(i => ul.append(make(i)));
    return ul;
  };

  function render(l) {
    const b = beacon(l);
    dot.dataset.color = b.color;
    realm.textContent = l.realm?.name || 'The Realm';
    word.textContent = b.color;
    const waiting = gameLog(l, { resolved: 0 }).open.length;
    badge.textContent = waiting ? String(waiting) : '';
    chip.setAttribute('aria-label', `${realm.textContent}: Beacon ${b.color}, ${waiting} waiting. ${folded ? 'Open the panel' : 'Fold the panel'}`);
    reasons.replaceChildren(...(b.reasons.length ? b.reasons : ['All is well in the Realm.']).map(r => el('li', '', r)));

    const g = gameLog(l, { resolved: 5 });
    log.count.textContent = `${g.open.length} open`;
    log.body.replaceChildren(
      el('div', 'qbh-h', 'Open'), list(g.open, i => row(l, i), 'Nothing waiting.'),
      el('div', 'qbh-h', 'Recently resolved'), list(g.resolved, i => row(l, i), 'Nothing resolved yet.'));

    const hs = sealedHalls(l);
    halls.count.textContent = `${hs.filter(h => !h.locked).length} of ${hs.length} open`;
    halls.body.replaceChildren(list(hs, h => {
      const li = el('li', 'qbh-hall');
      li.dataset.locked = String(h.locked);
      const name = el('span', 'qbh-text', h.name);
      const banner = bannerOf(l, h.marchId), m = el('span', 'qbh-banner');
      if (banner) m.style.backgroundColor = banner;
      li.append(lockIcon(h.locked), m, name, el('span', 'qbh-at', `${h.done}/${h.total}`));
      li.title = `${h.name}: ${h.locked ? 'sealed' : 'open'}, ${h.done} of ${h.total} Works resolved`;
      return li;
    }, 'No Halls yet.'));

    const k = keepers(l);
    freeN.textContent = String(k.free.length);
    busyN.textContent = String(k.busy.length);
    restN.textContent = String(k.resting.length);
    restN.parentElement.hidden = !k.resting.length;
  }

  let alive = true, fresh = false; // fresh: a change already rendered, so the first snapshot is stale
  const off = store.subscribe(l => { if (alive) { fresh = true; render(l); } });
  store.snapshot().then(l => { if (alive && !fresh) render(l); });

  return {
    destroy() {
      alive = false;
      off();
      root.remove();
      if (!document.querySelector('.qbh-root')) document.getElementById(STYLE_ID)?.remove();
    },
  };
}
