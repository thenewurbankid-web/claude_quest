// The Keeper HUD (PLAN-engine.md, R4 "Bring your Keeper"): start work from an NPC with a token readout, a small Ember
// meter, the Keepers list (rest, resume, cancel a run) and the Recall Bell. Moves go through keeper-controls.js.
// mountStartWork(...).open(keeperId) is what integration calls when the player presses E next to a free Keeper; with
// no id it opens the Keepers list. The bell rings from its button or the B key (R is the weather, E talk, T the clock,
// WASD and Space are taken), always behind an in-page confirm, never a native one.
// The Ember meter and the bell share a dock at the bottom left, clear of the Beacon HUD (top right) and the outbox.
// Safety: ledger text is real text, so it only ever goes in through textContent, never innerHTML. Styles under qkh-.
import { applyChanges, DEFAULT_RULES } from './contract.js';
import { LIVE, startable, wake, rest, resume, cancel, ringBell, tokenReadout, summon, release } from './keeper-controls.js';

const STYLE_ID = 'qkh-styles';
const CSS = `
.qkh-dock { --qkh-bg: rgba(14, 16, 24, 0.82); --qkh-line: rgba(255, 255, 255, 0.12); --qkh-text: #eef0f4;
  --qkh-dim: #a3a9b6; --qkh-gold: #f2c14e; --qkh-ember: #f08a24;
  position: fixed; left: 16px; bottom: 16px; z-index: 1000; display: flex; gap: 8px; align-items: stretch;
  max-width: calc(100vw - 32px); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--qkh-text); }
.qkh-dock > * { box-sizing: border-box; min-height: 40px; background: var(--qkh-bg); border: 1px solid var(--qkh-line);
  border-radius: 999px; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); }
.qkh-ember { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }
.qkh-flame { flex: none; width: 12px; height: 12px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
  background: var(--qkh-ember); box-shadow: 0 0 8px var(--qkh-ember); }
.qkh-ember[data-out="true"] .qkh-flame { background: var(--qkh-dim); box-shadow: none; }
.qkh-bar { flex: none; width: 56px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.qkh-fill { height: 100%; background: linear-gradient(90deg, var(--qkh-ember), var(--qkh-gold)); }
.qkh-num { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.qkh-dock button { display: flex; align-items: center; gap: 6px; padding: 6px 14px; color: inherit; font: inherit;
  font-weight: 600; cursor: pointer; }
.qkh-dock button:hover { filter: brightness(1.25); }
.qkh-dock button:focus-visible, .qkh-dlg button:focus-visible, .qkh-dlg a:focus-visible, .qkh-dlg textarea:focus-visible,
  .qkh-dlg input:focus-visible { outline: 2px solid var(--qkh-gold); outline-offset: 2px; }
.qkh-bellbtn { border-color: rgba(239, 75, 75, 0.55) !important; }
.qkh-bellicon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round;
  stroke-linejoin: round; }
.qkh-key { color: var(--qkh-dim); font-weight: 400; font-size: 11px; }
@media (max-width: 420px) { .qkh-key, .qkh-dock .qkh-label { display: none; } .qkh-bar { width: 40px; } }

.qkh-back { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(6, 6, 12, 0.55); }
.qkh-back[hidden] { display: none; }
.qkh-back.qkh-over { z-index: 1210; } /* the bell's confirm, above the start-work dialog */
.qkh-dlg { --qkh-line: rgba(255, 255, 255, 0.14); --qkh-dim: #a3a9b6; --qkh-gold: #f2c14e; --qkh-red: #ef4b4b;
  box-sizing: border-box; width: min(460px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 16px;
  border-radius: 12px; background: rgba(14, 16, 24, 0.96); border: 1px solid var(--qkh-line); color: #eef0f4;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  overflow-wrap: anywhere; }
.qkh-dlg *, .qkh-dlg *::before, .qkh-dlg *::after { box-sizing: border-box; }
.qkh-dlg h2 { margin: 0 0 2px; font-size: 17px; }
.qkh-sub { margin: 0 0 12px; color: var(--qkh-dim); }
.qkh-h { margin: 12px 0 4px; color: var(--qkh-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.qkh-works { list-style: none; margin: 0; padding: 0; }
.qkh-works label { display: flex; gap: 10px; align-items: flex-start; min-height: 40px; padding: 8px; border-radius: 8px;
  cursor: pointer; }
.qkh-works label:hover { background: rgba(255, 255, 255, 0.06); }
.qkh-works input { flex: none; width: 18px; height: 18px; margin: 1px 0 0; accent-color: var(--qkh-gold); }
.qkh-title { font-weight: 600; }
.qkh-meta { color: var(--qkh-dim); font-size: 11px; }
.qkh-empty { color: var(--qkh-dim); font-style: italic; padding: 4px 0; }
.qkh-dlg textarea { display: block; width: 100%; min-height: 64px; margin-top: 4px; padding: 8px; border-radius: 8px;
  border: 1px solid var(--qkh-line); background: rgba(255, 255, 255, 0.06); color: inherit; font: inherit; resize: vertical; }
.qkh-readout { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; padding: 8px 10px; border-radius: 8px;
  background: rgba(240, 138, 36, 0.1); border: 1px solid rgba(240, 138, 36, 0.35); }
.qkh-readout b { font-variant-numeric: tabular-nums; }
.qkh-note { margin: 10px 0 0; color: var(--qkh-dim); }
.qkh-note a { color: var(--qkh-gold); }
.qkh-problem { margin: 10px 0 0; color: #ffb4b4; }
.qkh-problem:empty { display: none; }
.qkh-said { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(242, 193, 78, 0.12); }
.qkh-said:empty { display: none; }
.qkh-foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.qkh-dlg button { min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.08); color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.qkh-dlg button:hover:not(:disabled) { filter: brightness(1.25); }
.qkh-dlg button:disabled { opacity: 0.5; cursor: default; }
.qkh-dlg button.qkh-go { background: rgba(242, 193, 78, 0.22); border-color: rgba(242, 193, 78, 0.6); }
.qkh-dlg button.qkh-ring { background: rgba(239, 75, 75, 0.25); border-color: rgba(239, 75, 75, 0.7); }
.qkh-keepers { list-style: none; margin: 0; padding: 0; }
.qkh-keepers > li { padding: 8px 0; }
.qkh-keepers > li + li { border-top: 1px solid rgba(255, 255, 255, 0.08); }
.qkh-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.qkh-row > .qkh-who { flex: 1; min-width: 140px; }
.qkh-status { display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 999px; font-size: 11px;
  background: rgba(255, 255, 255, 0.1); color: var(--qkh-dim); text-transform: capitalize; }
.qkh-status[data-s="free"] { color: #9fe0a8; }
.qkh-status[data-s="busy"] { color: var(--qkh-gold); }
.qkh-status[data-s="wandered"] { color: #f0a868; }
.qkh-runs { list-style: none; margin: 6px 0 0; padding: 0 0 0 12px; border-left: 2px solid rgba(255, 255, 255, 0.1); }
.qkh-runs li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 2px 0; }
.qkh-runs li > span { flex: 1; min-width: 120px; }
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const btn = (text, cls, onclick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onclick) b.onclick = onclick;
  return b;
};
const num = n => Math.round(n).toLocaleString();
const emberText = r => `${Math.ceil(r.emberLeft)} of ${r.emberMax}`; // ceil: never shows 0 while work can still start
const STATE = { queued: 'waiting on /work', leased: 'running', lapsed: 'lapsed' };

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.append(s);
}

// The dock is shared by the Ember meter and the bell, so they sit side by side whatever order they mount in.
function dock(container) {
  let d = container.querySelector(':scope > .qkh-dock');
  if (!d) {
    d = el('div', 'qkh-dock');
    d.setAttribute('role', 'group');
    d.setAttribute('aria-label', 'Ember and the Recall Bell');
    container.append(d);
  }
  return d;
}
const undock = d => { if (d && !d.children.length) d.remove(); };
const unstyle = () => { if (!document.querySelector('.qkh-dock, .qkh-back')) document.getElementById(STYLE_ID)?.remove(); };

// A modal backdrop. While up, keys stop at the window (capture phase) so the scene never walks or talks; typing in
// its fields still works. Escape closes it. A click on the backdrop closes it too.
function modal(container, label, onClose) {
  const back = el('div', 'qkh-back');
  back.hidden = true;
  const box = el('section', 'qkh-dlg');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', label);
  back.append(box);
  container.append(back);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { // keep focus inside the box
      const f = [...box.querySelectorAll('button:not(:disabled), a[href], textarea, input:not(:disabled)')];
      if (f.length && e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (f.length && !e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();
  };
  let before = null;
  function close() {
    if (back.hidden) return;
    back.hidden = true;
    removeEventListener('keydown', onKey, true);
    before?.focus?.();
    onClose();
  }
  back.addEventListener('click', e => { if (e.target === back) close(); });
  return {
    back, box, close,
    get open() { return !back.hidden; },
    show() {
      if (!back.hidden) return;
      before = document.activeElement;
      back.hidden = false;
      addEventListener('keydown', onKey, true);
    },
  };
}

/**
 * The start-work dialog. open(keeperId) shows that Keeper: its startable Works, an optional note, the token readout,
 * and Wake (or Resume while it rests), plus Rest and Cancel for its live runs. open() with no id shows every Keeper.
 * Resolves with the new queue item's id when work was queued, else null, once the dialog closes.
 * @param {HTMLElement} container
 * @param {import('./contract.js').LedgerStore} store
 * @param {{ now?: () => Date, rules?: object, workUrl?: string }} [opts]  workUrl: the /work page, relative to the page
 * @returns {{ open: (keeperId?: string|null) => Promise<string|null>, readonly isOpen: boolean, destroy: () => void }}
 */
export function mountStartWork(container, store, { now = () => new Date(), rules, workUrl = 'work.html' } = {}) {
  injectStyles();
  let done = null, queued = null, view = null, summoning = null, said = ''; // view: a keeper id, or null for the list
  let draft = { workId: null, note: '' }; // kept across re-renders, so a store change never wipes what was typed
  const m = modal(container, 'Wake a Keeper', () => { const d = done; done = null; d?.(queued); });

  const workLink = text => {
    const a = el('a', '', text);
    a.href = workUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  async function act(changes, okText) {
    if (changes.problem) { said = ''; render(await store.snapshot(), changes.problem); return; }
    await applyChanges(store, changes);
    said = okText;
    render(await store.snapshot());
  }
  // Cancel asks once, in place: the first press turns the button into "Yes, cancel it".
  const cancelBtn = (item, title) => {
    const b = btn('Cancel', '', null);
    b.setAttribute('aria-label', `Cancel the run for ${title}`);
    b.onclick = async () => {
      if (b.dataset.sure !== 'true') { b.dataset.sure = 'true'; b.textContent = 'Yes, cancel it'; return; }
      await act(cancel(await store.snapshot(), item.id, now()), `Cancelled: ${title}. Anything pasted for it will be refused. If an agent is already on it, stop it in your own tool.`);
    };
    return b;
  };
  const runs = (l, keeperId) => {
    const items = (l.queue || []).filter(q => q.keeperId === keeperId && LIVE.includes(q.state));
    if (!items.length) return null;
    const ul = el('ul', 'qkh-runs');
    for (const q of items) {
      const title = l.works.find(w => w.id === q.workId)?.title || 'Unknown Work';
      const li = el('li'), span = el('span');
      span.append(el('span', 'qkh-title', title), el('span', 'qkh-meta', ` · ${STATE[q.state] || q.state}`));
      li.append(span, cancelBtn(q, title));
      ul.append(li);
    }
    return ul;
  };
  const restBtn = k => k.status === 'resting' || k.status === 'wandered'
    ? btn(k.status === 'resting' ? 'Resume' : 'Call back', 'qkh-go', async () =>
      act(resume(await store.snapshot(), k.id, now()), `${k.name} is back at the bench.`))
    : btn('Rest', '', async () => act(rest(await store.snapshot(), k.id, now()), `${k.name} rests. No prompts are offered until you resume them.`));

  // Release asks once, in place, like Cancel: the first press turns the button into "Yes, release".
  const releaseBtn = k => {
    const b = btn('Release', '', null);
    b.setAttribute('aria-label', `Release ${k.name} to the Hall of Champions`);
    b.onclick = async () => {
      if (b.dataset.sure !== 'true') { b.dataset.sure = 'true'; b.textContent = 'Yes, release'; return; }
      await act(release(await store.snapshot(), k.id, now()), `${k.name} is released to the Hall of Champions. Their record is kept; they take no more work.`);
    };
    return b;
  };
  // Summon: a small form, then a confirm that names the Ember it spends. The Keeper joins on its first approved Work.
  function summonForm(l) {
    const box = el('div', 'qkh-readout');
    const cost = (rules || DEFAULT_RULES).summonCost;
    const field = (label, key, max) => {
      const lab = el('label', 'qkh-h', label), input = el('input');
      input.type = 'text';
      input.maxLength = max;
      input.value = summoning[key];
      input.oninput = () => { summoning[key] = input.value; };
      lab.append(input);
      return lab;
    };
    const foot = el('div', 'qkh-foot');
    const go = btn(`Spend ${cost} Ember`, 'qkh-go', async () => {
      const c = summon(await store.snapshot(), { name: summoning.name, role: summoning.role,
        skills: summoning.skills.split(',') }, now(), rules);
      if (c.problem) { said = ''; render(await store.snapshot(), c.problem); return; }
      const name = c.puts[0].record.name;
      summoning = null;
      await act(c, `${name} is summoned. They join the Lodge when their first Work is approved.`);
    });
    foot.append(btn('Not now', '', async () => { summoning = null; render(await store.snapshot()); }), go);
    box.append(el('p', 'qkh-note', `Summoning costs ${cost} Ember and comes back as the Well refills. The new Keeper joins the Lodge once the first Work they do is approved.`),
      field('Name', 'name', 40), field('Role (optional)', 'role', 40), field('Skills, comma separated (optional)', 'skills', 120), foot);
    return box;
  }

  function readout(l) {
    const r = tokenReadout(l, now(), rules);
    const box = el('div', 'qkh-readout');
    box.setAttribute('aria-label', 'Token readout');
    const item = (label, value) => { const s = el('span', '', `${label} `); s.append(el('b', '', value)); return s; };
    box.append(item('Ember', emberText(r)),
      item('Last run', r.lastRun ? `${num(r.lastRun.input)} in · ${num(r.lastRun.output)} out tokens` : 'none reported'),
      item('Spent today', `${num(r.spentToday)} Ember`));
    return { box, r };
  }

  function keeperView(l, k, problem) {
    const nodes = [el('h2', '', k.name)];
    const sub = el('p', 'qkh-sub', `${k.role}${k.skills?.length ? ` · ${k.skills.join(', ')}` : ''}`);
    const st = el('span', 'qkh-status', k.status);
    st.dataset.s = k.status;
    sub.append(st);
    nodes.push(sub);
    const foot = el('div', 'qkh-foot');
    const { box: ro, r } = readout(l);

    if (k.status === 'released') {
      nodes.push(el('p', '', `${k.name} is released to the Hall of Champions and takes no more work.`));
    } else if (k.status === 'resting') {
      nodes.push(el('p', '', `${k.name} is resting: no prompts are offered. Resume them to start work.`), ro);
      foot.append(restBtn(k));
    } else {
      const works = startable(l);
      nodes.push(el('div', 'qkh-h', 'Start a Work'));
      let first = null;
      if (!works.length) nodes.push(el('div', 'qkh-empty', 'Nothing to start: every open Work is blocked, done, or already has a Keeper on it.'));
      else {
        const ul = el('ul', 'qkh-works');
        ul.setAttribute('role', 'radiogroup');
        ul.setAttribute('aria-label', 'Works to start');
        const marches = new Map(l.marches.map(x => [x.id, x.name]));
        for (const w of works) {
          const li = el('li'), label = el('label'), input = el('input'), text = el('span');
          input.type = 'radio';
          input.name = 'qkh-work';
          input.value = w.id;
          input.checked = w.id === draft.workId;
          input.onchange = () => { draft.workId = w.id; };
          first ||= input;
          text.append(el('div', 'qkh-title', w.title),
            el('div', 'qkh-meta', [w.priority, w.size, marches.get(w.marchId), w.status.replace('_', ' ')].filter(Boolean).join(' · ')));
          label.append(input, text);
          li.append(label);
          ul.append(li);
        }
        if (first && !ul.querySelector('input:checked')) { first.checked = true; draft.workId = first.value; }
        nodes.push(ul);
      }
      const noteLabel = el('label', 'qkh-h', 'A note for the Keeper (optional)');
      const note = el('textarea');
      note.maxLength = 1000;
      note.rows = 2;
      note.value = draft.note;
      note.oninput = () => { draft.note = note.value; };
      noteLabel.append(note);
      nodes.push(noteLabel, ro);
      const out = r.emberLeft <= 0;
      if (out) nodes.push(el('p', 'qkh-problem', 'The Well is out of Ember. Keepers rest until it refills.'));
      const p = el('p', 'qkh-note', 'Waking queues a short task note. The full prompt then waits on the ');
      p.append(workLink('/work page'), document.createTextNode(': copy it into your own agent there, and paste its reply back.'));
      nodes.push(p);
      const go = btn(`Wake ${k.name}`, 'qkh-go', async () => {
        const picked = m.box.querySelector('input[name="qkh-work"]:checked')?.value;
        if (!picked) return;
        const title = works.find(w => w.id === picked)?.title || 'the Work';
        const c = wake(await store.snapshot(), k.id, picked, { note: note.value }, now(), rules);
        if (!c.problem) { queued = c.puts[0].record.id; draft = { workId: null, note: '' }; }
        await act(c, `Queued: ${title}. It waits on the /work page.`);
      });
      go.disabled = !works.length || out;
      foot.append(restBtn(k), go);
    }
    if (k.status !== 'released') foot.append(releaseBtn(k));
    const live = runs(l, k.id);
    if (live) nodes.push(el('div', 'qkh-h', 'Live runs'), live);
    nodes.push(el('p', 'qkh-problem', problem || ''));
    const s = el('p', 'qkh-said', said);
    s.setAttribute('role', 'status');
    if (said.startsWith('Queued')) { s.append(document.createTextNode(' ')); s.append(workLink('Open /work')); }
    nodes.push(s);
    foot.prepend(btn('All Keepers', '', async () => { view = null; said = ''; render(await store.snapshot()); }));
    foot.append(btn('Close', '', () => m.close()));
    return nodes.concat(foot);
  }

  function listView(l, problem) {
    const nodes = [el('h2', '', 'Keepers'), el('p', 'qkh-sub', 'Wake, rest or call back your Keepers. Cancelling a run stops new prompts for it; an agent already running is stopped in your own tool.')];
    const ul = el('ul', 'qkh-keepers');
    for (const k of l.keepers.filter(k => k.status !== 'released')) { // released ones live in the Hall of Champions
      const li = el('li'), row = el('div', 'qkh-row'), who = el('div', 'qkh-who');
      who.append(el('span', 'qkh-title', k.name));
      const st = el('span', 'qkh-status', k.status);
      st.dataset.s = k.status;
      who.append(st, el('div', 'qkh-meta', `${k.role}${k.skills?.length ? ` · ${k.skills.join(', ')}` : ''}`));
      row.append(who, restBtn(k));
      row.append(releaseBtn(k));
      if (k.status !== 'resting') row.append(btn('Start work', 'qkh-go', async () => { view = k.id; said = ''; render(await store.snapshot()); }));
      li.append(row);
      const live = runs(l, k.id);
      if (live) li.append(live);
      ul.append(li);
    }
    if (!l.keepers.length) ul.append(el('li', 'qkh-empty', 'No Keepers registered yet.'));
    const s = el('p', 'qkh-said', said);
    s.setAttribute('role', 'status');
    const foot = el('div', 'qkh-foot');
    foot.append(btn('Close', '', () => m.close()));
    const sm = summoning ? summonForm(l) : btn('Summon a Keeper', '', async () => { summoning = { name: '', role: '', skills: '' }; said = ''; render(await store.snapshot()); });
    return [...nodes, readout(l).box, ul, sm, el('p', 'qkh-problem', problem || ''), s, foot];
  }

  function render(l, problem) {
    const k = view && l.keepers.find(x => x.id === view);
    const a = document.activeElement;
    const was = m.box.contains(a) ? { tag: a.tagName, text: a.textContent, value: a.value } : null;
    m.box.replaceChildren(...(k ? keeperView(l, k, problem) : listView(l, problem)));
    m.box.setAttribute('aria-label', k ? `Wake ${k.name}` : 'Keepers');
    // keep focus on the same control across a re-render where it still exists (the note, a Work, a button), else
    // the first useful one, so a store change while typing never pulls the caret away
    const again = was && [...m.box.querySelectorAll(was.tag)].find(n => was.tag === 'TEXTAREA'
      || (was.tag === 'INPUT' ? n.value === was.value : n.textContent === was.text));
    (again || m.box.querySelector('input[name="qkh-work"]:checked, .qkh-go:not(:disabled), button'))?.focus();
    if (again?.tagName === 'TEXTAREA') again.selectionStart = again.selectionEnd = again.value.length;
  }

  const off = store.subscribe(l => { if (m.open) render(l); });
  return {
    get isOpen() { return m.open; },
    async open(keeperId = null) {
      if (m.open) m.close();
      view = keeperId;
      summoning = null;
      queued = null;
      said = '';
      draft = { workId: null, note: '' };
      m.show();
      render(await store.snapshot());
      return new Promise(resolve => { done = resolve; });
    },
    destroy() { off(); m.close(); m.back.remove(); unstyle(); },
  };
}

/**
 * A small always-visible Ember meter (left of max) in the bottom-left dock, in the Beacon HUD's look. Follows the
 * store, and refreshes each minute since spent Ember comes back as the window rolls.
 * @returns {{ destroy: () => void }}
 */
export function mountEmberReadout(container, store, { now = () => new Date(), rules } = {}) {
  injectStyles();
  const d = dock(container);
  const root = el('div', 'qkh-ember');
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', 'Ember');
  root.setAttribute('aria-valuemin', '0');
  const flame = el('span', 'qkh-flame'), bar = el('span', 'qkh-bar'), fill = el('span', 'qkh-fill'), n = el('span', 'qkh-num');
  flame.setAttribute('aria-hidden', 'true');
  fill.style.display = 'block';
  bar.append(fill);
  root.append(flame, el('span', 'qkh-label', 'Ember'), bar, n);
  d.prepend(root);

  let ledger = null, alive = true, fresh = false;
  const render = () => {
    if (!alive || !ledger) return;
    const r = tokenReadout(ledger, now(), rules);
    n.textContent = `${Math.ceil(r.emberLeft)}/${r.emberMax}`;
    fill.style.width = `${Math.round((r.emberLeft / r.emberMax) * 100)}%`;
    root.dataset.out = String(r.emberLeft <= 0);
    root.setAttribute('aria-valuemax', String(r.emberMax));
    root.setAttribute('aria-valuenow', String(Math.ceil(r.emberLeft)));
    root.title = r.emberLeft <= 0 ? 'The Well is out of Ember: Keepers rest until it refills'
      : `Ember ${emberText(r)}. Agents' reported tokens spend it; it comes back over a day.`;
  };
  const off = store.subscribe(l => { if (alive) { fresh = true; ledger = l; render(); } });
  store.snapshot().then(l => { if (alive && !fresh) { ledger = l; render(); } });
  const timer = setInterval(render, 60e3);
  return { destroy() { alive = false; off(); clearInterval(timer); root.remove(); undock(d); unstyle(); } };
}

const SVG = 'http://www.w3.org/2000/svg';
function bellIcon() {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('class', 'qkh-bellicon');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11L4 11zM6.5 14a1.5 1.5 0 0 0 3 0');
  s.append(p);
  return s;
}
const typing = t => t instanceof Element && (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

/**
 * The Recall Bell (safety rule 11): a button in the dock and the B key, from anywhere, behind an in-page confirm.
 * Ringing rests every Keeper and cancels every queued, leased or lapsed run, then says plainly that agents already
 * running must be stopped in the player's own tool. onKeepers, if given, adds a Keepers button to the dock
 * (integration passes () => startWork.open()).
 * @returns {{ ask: () => void, destroy: () => void }}
 */
export function mountRecallBell(container, store, { now = () => new Date(), key = 'b', onKeepers = null } = {}) {
  injectStyles();
  const d = dock(container);
  const mine = [];
  if (onKeepers) {
    const k = btn('Keepers', '', () => onKeepers());
    k.title = 'Wake, rest or call back your Keepers';
    mine.push(k);
  }
  const bell = btn('', 'qkh-bellbtn', () => ask());
  bell.append(bellIcon(), el('span', 'qkh-label', 'Recall Bell'), el('span', 'qkh-key', key.toUpperCase()));
  bell.setAttribute('aria-label', `Ring the Recall Bell (${key.toUpperCase()})`);
  bell.title = `Recall Bell (${key.toUpperCase()}): every Keeper comes home`;
  mine.push(bell);
  d.append(...mine);

  const m = modal(container, 'The Recall Bell', () => {});
  m.back.classList.add('qkh-over');
  function ask() {
    if (m.open) return;
    m.show();
    const yes = btn('Ring it', 'qkh-ring', ring), no = btn('Not now', '', () => m.close());
    const foot = el('div', 'qkh-foot');
    foot.append(no, yes);
    m.box.replaceChildren(el('h2', '', 'Ring the Recall Bell?'),
      el('p', '', 'Every Keeper comes home and rests, and every queued, leased or lapsed run is cancelled. Anything pasted for a cancelled run is refused.'),
      el('p', '', 'The game can\'t stop an agent that is already running. Stop it in your own tool.'), foot);
    no.focus();
  }
  async function ring() {
    const l = await store.snapshot();
    const runs = (l.queue || []).filter(q => LIVE.includes(q.state)).length;
    await applyChanges(store, ringBell(l, now()));
    const s = el('p', 'qkh-said', 'Every Keeper is resting. Agents already running must be stopped in your own tool.');
    s.setAttribute('role', 'status');
    const ok = btn('Close', '', () => m.close()), foot = el('div', 'qkh-foot');
    foot.append(ok);
    m.box.replaceChildren(el('h2', '', 'The bell rang'), s,
      el('p', 'qkh-note', runs ? `${runs} run${runs === 1 ? '' : 's'} cancelled.` : 'No runs were live.'), foot);
    ok.focus();
  }
  // The window's capture phase, so the key works from anywhere: while a board or the conversation box holds the keys
  // too. Never while typing in a field, never with a modifier.
  const onKey = e => {
    if (e.key.toLowerCase() !== key || e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target)) return;
    e.preventDefault();
    ask();
  };
  addEventListener('keydown', onKey, true);
  return {
    ask,
    destroy() { removeEventListener('keydown', onKey, true); m.close(); m.back.remove(); mine.forEach(b => b.remove()); undock(d); unstyle(); },
  };
}
