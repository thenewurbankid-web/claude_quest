// The hub's notice board (PLAN-engine.md, "R3 Lore quests"): two tabs, Town news (area lore) now and Quest boards when
// PLAN-settlements §16 lands. Opened from the board ('quest:board'); Close, Escape or a click outside closes it.
// Each Town news row shows the in-world line with the real event as its hint (a tooltip, and a small line under it for
// touch screens), and "Take it on" when its game-only Riddle is still open. show() resolves with the Riddle id picked,
// or null. When the place is only guessed from the time zone, a button offers to use a rough location once.
// Safety: lore text is plain text and goes in through textContent only. Styles are scoped under qtb-.

const CSS = `
.qtb-back{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(6,6,12,.55)}
.qtb-back[hidden]{display:none}
.qtb{box-sizing:border-box;width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:16px 18px;
  border-radius:12px;background:rgba(24,18,12,.96);border:1px solid rgba(201,162,74,.45);color:#f1ebe0;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.qtb *{box-sizing:border-box}
.qtb h2{margin:0 0 10px;font:600 17px Georgia,serif;color:#e8c77a}
.qtb-tabs{display:flex;gap:6px;margin:0 0 12px}
.qtb-tab{min-height:34px;padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:transparent;
  color:inherit;font:600 12px system-ui,sans-serif;cursor:pointer}
.qtb-tab[aria-selected=true]{background:rgba(201,162,74,.25);border-color:rgba(232,199,122,.6)}
.qtb-tab:disabled{opacity:.5;cursor:default}
.qtb ul{list-style:none;margin:0;padding:0}
.qtb li{display:flex;gap:10px;align-items:center;padding:8px 0}
.qtb li+li{border-top:1px solid rgba(255,255,255,.08)}
.qtb-text{flex:1;min-width:0}
.qtb-line{font:15px/1.3 Georgia,serif;color:#f6e7bf}
.qtb-hint{margin-top:2px;font-size:11px;color:#a89f8c}
.qtb-state{font-size:11px;color:#a89f8c;white-space:nowrap}
.qtb button.qtb-go,.qtb-close,.qtb-here{min-height:36px;padding:6px 12px;border-radius:8px;cursor:pointer;
  font:600 12px system-ui,sans-serif;color:#f1ebe0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25)}
.qtb button.qtb-go{background:rgba(201,162,74,.3);border-color:rgba(232,199,122,.6);white-space:nowrap}
.qtb button:hover{filter:brightness(1.2)}
.qtb button:focus-visible{outline:2px solid #e8c77a;outline-offset:2px}
.qtb-sub{margin:10px 0 0;color:#a89f8c;font-size:11px}
.qtb-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * @typedef {{ entry: import('./contract.js').AreaLoreEntry, riddleId: string|null, state: string|null }} BoardRow
 *   state: the lore Riddle's state (open, deferred, answered, sealed, faded), or null before it is in the ledger
 * @returns {{ show: (rows: BoardRow[], opts?: { guessed?: boolean, calendar?: boolean,
 *   onUsePlace?: () => Promise<BoardRow[]|null> }) => Promise<string|null>, readonly open: boolean }}
 */
export function mountTownBoard(container) {
  if (!document.querySelector('style[data-qtb]')) {
    const style = el('style', null, CSS);
    style.dataset.qtb = '';
    document.head.append(style);
  }
  const back = el('div', 'qtb-back');
  back.hidden = true;
  const box = el('section', 'qtb');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'The notice board');
  back.append(box);
  container.append(back);

  let done = null;
  const close = (pick = null) => {
    if (back.hidden) return;
    back.hidden = true;
    removeEventListener('keydown', onKey, true);
    done?.(pick); done = null;
  };
  // capture phase, so Escape and E don't reach the scene while the board is up
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });

  const STATE = { answered: 'Answered', sealed: 'Done', deferred: 'Later', faded: 'Passed' };
  function render(rows, opts) {
    const tabs = el('div', 'qtb-tabs');
    tabs.setAttribute('role', 'tablist');
    const news = el('button', 'qtb-tab', 'Town news'), quests = el('button', 'qtb-tab', 'Quest boards');
    news.type = quests.type = 'button';
    news.setAttribute('role', 'tab'); quests.setAttribute('role', 'tab');
    news.setAttribute('aria-selected', 'true'); quests.setAttribute('aria-selected', 'false');
    quests.disabled = true;
    quests.title = 'Coming later';
    tabs.append(news, quests);

    const list = el('ul');
    list.setAttribute('role', 'tabpanel');
    let first = null;
    for (const { entry, riddleId, state } of rows) {
      const li = el('li'), text = el('div', 'qtb-text');
      const line = el('div', 'qtb-line', entry.line);
      line.title = entry.hint;
      text.append(line, el('div', 'qtb-hint', entry.hint));
      li.append(text);
      if (riddleId && state === 'open') {
        const go = el('button', 'qtb-go', 'Take it on');
        go.type = 'button';
        go.setAttribute('aria-label', `Take it on: ${entry.line}`);
        go.onclick = () => close(riddleId);
        first ||= go;
        li.append(go);
      } else if (state) li.append(el('span', 'qtb-state', STATE[state] || state));
      list.append(li);
    }
    if (!rows.length) list.append(el('li', 'qtb-hint', 'Nothing posted yet.'));

    const foot = el('div', 'qtb-foot');
    if (opts.guessed && opts.onUsePlace) {
      const here = el('button', 'qtb-here', 'Use my rough area');
      here.type = 'button';
      here.title = 'Asks once for your location, rounded to about 10 km, and keeps it on this machine';
      here.onclick = async () => {
        here.disabled = true;
        here.textContent = 'Asking…';
        const next = await opts.onUsePlace().catch(() => null);
        if (next) render(next, { ...opts, guessed: false });
        else { here.textContent = 'No location; the calendar stays'; }
      };
      foot.append(here);
    }
    const closeBtn = el('button', 'qtb-close', 'Close');
    closeBtn.type = 'button';
    closeBtn.onclick = () => close();
    foot.append(closeBtn);

    box.replaceChildren(el('h2', null, 'The notice board'), tabs, list,
      el('p', 'qtb-sub', opts.calendar ? 'Nothing posted from your area right now, so the Hollow keeps its own calendar.'
        : 'Posted from what is on near you. These are game-only: they never touch your real work.'), foot);
    (first || closeBtn).focus();
  }

  return {
    get open() { return !back.hidden; },
    show(rows, opts = {}) {
      back.hidden = false; // before render, so its focus() lands
      render(rows, opts);
      addEventListener('keydown', onKey, true);
      return new Promise(resolve => { done = resolve; });
    },
  };
}
