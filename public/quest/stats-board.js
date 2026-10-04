// The stats board in the Keeper's Lodge (PLAN-engine.md, success measures): what the local event log says about the
// last week and all time, and how long each Keeper waits on you. It reads realmStats() (digest.js) and never leaves
// the machine. Opened from the Lodge door ('quest:lodge'); Close, Escape or a click outside closes it.
// Safety: Keeper names are real text and go in through textContent only. Styles are scoped under qsb-.
import { duration } from './digest.js';

const CSS = `
.qsb-back{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(6,6,12,.55)}
.qsb-back[hidden]{display:none}
.qsb{box-sizing:border-box;width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:16px 18px;
  border-radius:12px;background:rgba(18,16,26,.96);border:1px solid rgba(242,193,78,.35);color:#eef0f4;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.qsb *{box-sizing:border-box}
.qsb h2{margin:0;font-size:16px;color:#f2c14e}
.qsb-sub{margin:2px 0 12px;color:#a3a9b6;font-size:12px}
.qsb table{width:100%;border-collapse:collapse}
.qsb th,.qsb td{padding:4px 0;text-align:right;font-variant-numeric:tabular-nums}
.qsb th:first-child,.qsb td:first-child{text-align:left}
.qsb thead th{color:#a3a9b6;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.qsb tbody tr+tr td{border-top:1px solid rgba(255,255,255,.06)}
.qsb tr.qsb-key td{font-weight:700;color:#f6e7bf}
.qsb h3{margin:16px 0 4px;font-size:11px;font-weight:600;color:#a3a9b6;text-transform:uppercase;letter-spacing:.05em}
.qsb-empty{color:#8b90a0;font-style:italic}
.qsb-close{display:block;margin:16px 0 0 auto;min-height:36px;padding:6px 16px;border-radius:8px;cursor:pointer;
  font:600 13px system-ui,sans-serif;color:#eef0f4;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25)}
.qsb-close:hover{background:rgba(255,255,255,.16)}
.qsb-close:focus-visible{outline:2px solid #f2c14e;outline-offset:2px}
`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const tr = (cells, cls, head = false) => {
  const r = el('tr', cls);
  cells.forEach(c => r.append(el(head ? 'th' : 'td', null, String(c))));
  return r;
};

/** @returns {{ show: (stats: ReturnType<import('./digest.js').realmStats>) => Promise<void>, readonly open: boolean }} */
export function mountStatsBoard(container) {
  if (!document.querySelector('style[data-qsb]')) {
    const style = el('style', null, CSS);
    style.dataset.qsb = '';
    document.head.append(style);
  }
  const back = el('div', 'qsb-back');
  back.hidden = true;
  const box = el('section', 'qsb');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', "The Keeper's Lodge stats board");
  back.append(box);
  container.append(back);

  let done = null;
  const close = () => {
    if (back.hidden) return;
    back.hidden = true;
    removeEventListener('keydown', onKey, true);
    done?.(); done = null;
  };
  // capture phase, so Escape and E don't reach the scene while the board is up
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });

  return {
    get open() { return !back.hidden; },
    show(s) {
      const { recent: w, all: a } = s;
      const rows = [
        ['Riddles raised', w.raised, a.raised],
        ['Answered', w.answered, a.answered],
        ['Question to answer (median)', duration(w.medianMinutes), duration(a.medianMinutes), 'qsb-key'],
        ['Put off', w.deferred, a.deferred],
        ['Sealed', w.sealed, a.sealed],
        ['Faded', w.faded, a.faded],
        ['Keepers got stuck', w.blocked, a.blocked],
        ['Keepers got going again', w.unblocked, a.unblocked],
        ['Gloamwyrms beaten', w.won, a.won],
        ['Retreats', w.retreated, a.retreated],
        ['Pushed back (Lantern out)', w.pushed, a.pushed],
        ['Play sessions', w.sessions, a.sessions],
        ['Time played', duration(w.playMinutes), duration(a.playMinutes)],
      ];
      const table = el('table');
      const thead = el('thead'), tbody = el('tbody');
      thead.append(tr(['', `Last ${s.days} days`, 'All time'], null, true));
      rows.forEach(([label, x, y, cls]) => tbody.append(tr([label, x, y], cls)));
      table.append(thead, tbody);

      const keepers = el('table');
      const kh = el('thead'), kb = el('tbody');
      kh.append(tr(['Keeper', 'Answered', 'Waited (median)', 'Waiting now'], null, true));
      s.keepers.forEach(k => kb.append(tr([k.name, k.answered, duration(k.medianMinutes), k.waiting])));
      keepers.append(kh, kb);

      const closeBtn = el('button', 'qsb-close', 'Close');
      closeBtn.type = 'button';
      closeBtn.onclick = close;
      box.replaceChildren(el('h2', null, "The Keeper's Lodge"),
        el('p', 'qsb-sub', 'From the log kept on this machine. It never leaves it.'),
        table, el('h3', null, 'Who waits on you'),
        s.keepers.length ? keepers : el('p', 'qsb-empty', 'No Riddles yet.'), closeBtn);

      back.hidden = false;
      addEventListener('keydown', onKey, true);
      closeBtn.focus();
      return new Promise(resolve => { done = resolve; });
    },
  };
}
