// The Ledger panel (R0, PLAN-engine.md): add Marches, Halls and Works by hand, load the sample Realm, see problems.
// A self-contained DOM overlay for any page, the 3D view included: fixed at the top left, its own scoped styles
// (prefix qlp-), and a toggle button. It talks only to a LedgerStore (contract.js) and re-renders on subscribe.
// Ledger text is real text and goes in with textContent only, never innerHTML.
// The pure helpers (groupLedger, newMarch, newHall, newWork) are exported for node:test.
import { validateLedger, PRIORITY, SIZE } from './contract.js';

// ---------- pure helpers ----------
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** Marches with their Halls (in order) and each Hall's Works; Works with no Hall, or a Hall elsewhere, are loose. */
export function groupLedger(l) {
  return l.marches.map(m => {
    const halls = l.halls.filter(h => h.marchId === m.id).sort(byOrder);
    const hallIds = new Set(halls.map(h => h.id));
    const works = l.works.filter(w => w.marchId === m.id);
    return {
      march: m,
      halls: halls.map(h => ({ hall: h, works: works.filter(w => w.hallId === h.id) })),
      loose: works.filter(w => !hallIds.has(w.hallId)),
    };
  });
}

export function newMarch(name) {
  return { id: uid(), name: name.trim(), banner: '#d9a441', steward: null };
}

/** A planned Hall at the end of its March. */
export function newHall(l, marchId, name) {
  const order = Math.max(0, ...l.halls.filter(h => h.marchId === marchId).map(h => h.order ?? 0)) + 1;
  return { id: uid(), marchId, name: name.trim(), status: 'planned', order };
}

export function newWork({ marchId, hallId, title, priority = 'medium', size = null }) {
  const t = now();
  return { id: uid(), marchId, hallId: hallId || null, title: title.trim(), status: 'todo', priority,
    size: size || null, createdAt: t, updatedAt: t };
}

// ---------- styles ----------
const CSS = `
.qlp-toggle{position:fixed;top:8px;left:8px;z-index:1001;font:600 13px/1 system-ui,sans-serif;color:#f3e6c8;
  background:rgba(20,18,28,.85);border:1px solid rgba(243,230,200,.35);border-radius:6px;padding:8px 12px;cursor:pointer}
.qlp-panel{position:fixed;top:44px;left:8px;z-index:1000;box-sizing:border-box;width:min(360px,calc(100vw - 16px));
  max-height:calc(100vh - 56px);overflow:auto;padding:10px 12px;border-radius:8px;
  background:rgba(14,12,22,.86);border:1px solid rgba(243,230,200,.2);color:#eadfc6;
  font:13px/1.4 system-ui,sans-serif;-webkit-overflow-scrolling:touch;backdrop-filter:blur(4px)}
.qlp-panel[hidden]{display:none}
.qlp-panel *{box-sizing:border-box}
.qlp-realm{font-weight:700;font-size:15px;margin:0 0 6px}
.qlp-h{font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#bfae88;margin:12px 0 4px}
.qlp-march{border-left:3px solid #d9a441;padding-left:8px;margin:6px 0}
.qlp-march-name{font-weight:700}
.qlp-hall{margin:4px 0 4px 6px}
.qlp-hall-name{font-weight:600}
.qlp-hall-status,.qlp-meta{color:#a99c80;font-size:11px}
.qlp-works{list-style:none;margin:2px 0 0;padding:0 0 0 10px}
.qlp-work{display:flex;gap:6px;align-items:baseline}
.qlp-work-title{flex:1;min-width:0;overflow-wrap:anywhere}
.qlp-done{opacity:.55}
.qlp-empty{color:#8f8570;font-style:italic}
.qlp-form{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.qlp-form input,.qlp-form select,.qlp-panel button{font:inherit;color:#f3e6c8;background:rgba(255,255,255,.08);
  border:1px solid rgba(243,230,200,.25);border-radius:4px;padding:4px 6px;min-height:30px}
.qlp-form input{flex:1 1 140px;min-width:0}
.qlp-form select{flex:1 1 90px;min-width:0}
.qlp-panel button{cursor:pointer}
.qlp-panel button:hover,.qlp-toggle:hover{background:rgba(255,255,255,.16)}
.qlp-problems{list-style:none;margin:0;padding:0}
.qlp-problem{margin:2px 0;overflow-wrap:anywhere}
.qlp-tag{display:inline-block;font-size:10px;font-weight:700;border-radius:3px;padding:0 4px;margin-right:4px;
  background:#7a3b2e;color:#fde}
.qlp-tag.qlp-repair{background:#3b6a3a;color:#eaffd8}
.qlp-note{min-height:1em;color:#e8a87c;font-size:12px;margin-top:4px}
`;

// ---------- the panel ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const option = (value, label) => { const o = el('option', null, label); o.value = value; return o; };
function fill(select, opts, keep = select.value) {
  select.replaceChildren(...opts.map(([v, label]) => option(v, label)));
  if (opts.some(([v]) => v === keep)) select.value = keep;
}

/**
 * Mounts the panel in container on store. sampleUrl defaults to quest/sample-realm.json relative to the page.
 * @returns {{ destroy: () => void }}
 */
export function mountLedgerPanel(container, store, { sampleUrl = 'quest/sample-realm.json' } = {}) {
  const style = el('style', null, CSS);
  style.dataset.qlp = '';
  const toggle = el('button', 'qlp-toggle', 'Ledger');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const panel = el('section', 'qlp-panel');
  panel.setAttribute('aria-label', 'Ledger');
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  };

  const realm = el('div', 'qlp-realm');
  const sampleBtn = el('button', null, 'Load sample Realm');
  sampleBtn.type = 'button';
  const tree = el('div');
  const note = el('div', 'qlp-note');
  note.setAttribute('role', 'status');
  const say = msg => { note.textContent = msg; };

  // add a March
  const marchForm = el('form', 'qlp-form');
  const marchName = Object.assign(el('input'), { placeholder: 'March name', required: true });
  marchForm.append(marchName, Object.assign(el('button', null, 'Add March'), { type: 'submit' }));

  // add a Hall
  const hallForm = el('form', 'qlp-form');
  const hallMarch = el('select');
  const hallName = Object.assign(el('input'), { placeholder: 'Hall name', required: true });
  hallForm.append(hallMarch, hallName, Object.assign(el('button', null, 'Add Hall'), { type: 'submit' }));

  // add a Work
  const workForm = el('form', 'qlp-form');
  const workMarch = el('select'), workHall = el('select'), workPri = el('select'), workSize = el('select');
  const workTitle = Object.assign(el('input'), { placeholder: 'Work title', required: true });
  fill(workPri, PRIORITY.map(p => [p, p]), 'medium');
  fill(workSize, [['', 'no size'], ...SIZE.map(s => [s, s])], 'S');
  for (const [s, label] of [[workMarch, 'March'], [workHall, 'Hall'], [workPri, 'Priority'], [workSize, 'Size']])
    s.setAttribute('aria-label', label);
  hallMarch.setAttribute('aria-label', 'March');
  workForm.append(workTitle, workMarch, workHall, workPri, workSize,
    Object.assign(el('button', null, 'Add Work'), { type: 'submit' }));

  const problems = el('ul', 'qlp-problems');

  panel.append(realm, sampleBtn, note,
    el('div', 'qlp-h', 'Marches'), tree,
    el('div', 'qlp-h', 'Add a March'), marchForm,
    el('div', 'qlp-h', 'Add a Hall'), hallForm,
    el('div', 'qlp-h', 'Add a Work'), workForm,
    el('div', 'qlp-h', 'Problems'), problems);
  container.append(style, toggle, panel);

  let ledger = null;
  const fillHalls = () => {
    const halls = ledger ? ledger.halls.filter(h => h.marchId === workMarch.value).sort(byOrder) : [];
    fill(workHall, halls.map(h => [h.id, h.name]));
  };
  workMarch.onchange = fillHalls;

  function render(l) {
    ledger = l;
    realm.textContent = l.realm?.name || 'Unnamed Realm';

    const groups = groupLedger(l);
    tree.replaceChildren(...(groups.length ? groups.map(renderMarch) : [el('div', 'qlp-empty', 'No Marches yet.')]));

    const marches = l.marches.map(m => [m.id, m.name]);
    fill(hallMarch, marches);
    fill(workMarch, marches);
    fillHalls();

    const ps = validateLedger(l);
    problems.replaceChildren(...(ps.length ? ps.map(p => {
      const li = el('li', 'qlp-problem');
      li.append(el('span', p.repair ? 'qlp-tag qlp-repair' : 'qlp-tag', p.repair ? 'repair quest' : 'error'),
        el('span', null, `${p.path}: ${p.problem}`));
      return li;
    }) : [el('li', 'qlp-empty', 'None.')]));
  }

  function renderWorks(works) {
    const ul = el('ul', 'qlp-works');
    if (!works.length) ul.append(el('li', 'qlp-empty', 'No Works.'));
    for (const w of works) {
      const li = el('li', ['done', 'cancelled'].includes(w.status) ? 'qlp-work qlp-done' : 'qlp-work');
      li.append(el('span', 'qlp-work-title', w.title), el('span', 'qlp-meta', `${w.status}${w.size ? ` · ${w.size}` : ''}`));
      ul.append(li);
    }
    return ul;
  }

  function renderMarch({ march, halls, loose }) {
    const box = el('div', 'qlp-march');
    if (march.banner) box.style.borderLeftColor = march.banner; // a CSS colour; an invalid one is simply ignored
    box.append(el('div', 'qlp-march-name', march.name));
    if (!halls.length) box.append(el('div', 'qlp-empty', 'No Halls.'));
    for (const { hall, works } of halls) {
      const h = el('div', 'qlp-hall');
      const head = el('div');
      head.append(el('span', 'qlp-hall-name', hall.name), document.createTextNode(' '),
        el('span', 'qlp-hall-status', hall.status));
      h.append(head, renderWorks(works));
      box.append(h);
    }
    if (loose.length) {
      const h = el('div', 'qlp-hall');
      h.append(el('div', 'qlp-hall-name', 'No Hall (repair quest)'), renderWorks(loose));
      box.append(h);
    }
    return box;
  }

  const act = async (fn, okMsg) => {
    try { await fn(); say(okMsg); } catch (e) { say(`Could not save: ${e.message}`); }
  };

  marchForm.onsubmit = e => {
    e.preventDefault();
    if (!marchName.value.trim()) return;
    act(() => store.put('marches', newMarch(marchName.value)), 'March added.').then(() => { marchName.value = ''; });
  };
  hallForm.onsubmit = e => {
    e.preventDefault();
    if (!hallMarch.value) return say('Add a March first.');
    if (!hallName.value.trim()) return;
    act(() => store.put('halls', newHall(ledger, hallMarch.value, hallName.value)), 'Hall added.')
      .then(() => { hallName.value = ''; });
  };
  workForm.onsubmit = e => {
    e.preventDefault();
    if (!workMarch.value || !workHall.value) return say('Choose a March and a Hall first.');
    if (!workTitle.value.trim()) return;
    const w = newWork({ marchId: workMarch.value, hallId: workHall.value, title: workTitle.value,
      priority: workPri.value, size: workSize.value });
    act(() => store.put('works', w), 'Work added.').then(() => { workTitle.value = ''; });
  };

  // loading the sample replaces the whole ledger, so a non-empty one asks for a second click
  let armed = false;
  sampleBtn.onclick = async () => {
    const empty = ledger && !ledger.marches.length && !ledger.works.length;
    if (!empty && !armed) {
      armed = true;
      sampleBtn.textContent = 'Replace the whole ledger? Click again';
      setTimeout(() => { armed = false; sampleBtn.textContent = 'Load sample Realm'; }, 4000);
      return;
    }
    armed = false;
    sampleBtn.textContent = 'Load sample Realm';
    await act(async () => {
      const res = await fetch(new URL(sampleUrl, document.baseURI));
      if (!res.ok) throw new Error(`sample Realm: ${res.status}`);
      await store.replace(await res.json());
    }, 'Sample Realm loaded.');
  };

  const off = store.subscribe(render);
  store.snapshot().then(render, e => say(`Could not read the ledger: ${e.message}`));

  return {
    destroy() {
      off();
      style.remove(); toggle.remove(); panel.remove();
    },
  };
}
