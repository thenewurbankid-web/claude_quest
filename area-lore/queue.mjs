// Moderation queue for generated area lore (CLA-16). Nothing generated reaches the game until a person approves it.
// States: pending (waiting for review) -> approved (approved, push not done yet) -> published; or pending -> rejected.
// Pure functions over a plain object; the caller loads and saves it. Items: { id, cell, entry, status, queuedAt,
// decidedAt?, reason?, edited?, commit? }.
import { validateAreaLore } from '../public/quest/contract.js';

export const STATES = ['pending', 'approved', 'published', 'rejected'];
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = e => `${e.cell}/${e.id}`;

export const emptyQueue = () => ({ version: 1, items: [] });

/** Every entry the generator must not write again (any state), so reruns only add what is new. */
export const knownEntries = q => q.items.map(i => i.entry);

/** Adds entries not seen before as pending; returns { queue, added }. Invalid entries are dropped. */
export function enqueue(q, entries, now = new Date()) {
  const seen = new Set(q.items.map(i => key(i.entry)));
  const added = [];
  for (const entry of entries) {
    if (validateAreaLore(entry).length || seen.has(key(entry))) continue;
    seen.add(key(entry));
    added.push({ id: `${entry.cell}/${entry.id}`, cell: entry.cell, entry, status: 'pending', queuedAt: now.toISOString() });
  }
  return { queue: { ...q, items: [...q.items, ...added] }, added };
}

/** An edited copy of an entry: only line, question and options change, clipped like the writer clips them. */
export function editEntry(entry, edit = {}) {
  const e = { ...entry };
  if (edit.line !== undefined) e.line = clip(edit.line, 60);
  if (edit.question !== undefined) e.question = clip(edit.question, 140);
  if (edit.options !== undefined) {
    const o = (Array.isArray(edit.options) ? edit.options : []).map(x => clip(x, 30)).filter(Boolean).slice(0, 3);
    if (o.length) e.options = o; else delete e.options;
  }
  return e;
}

/**
 * Approves or rejects pending items by id. `edits` maps an id to { line, question, options }; an edited item that no
 * longer validates stays pending and is reported in `refused`. Only pending items change state.
 * @returns {{ queue: object, changed: string[], refused: { id: string, why: string }[] }}
 */
export function decide(q, { ids, action, reason = '', edits = {} }, now = new Date()) {
  if (action !== 'approve' && action !== 'reject') throw new Error(`unknown action ${action}`);
  const want = new Set(ids), changed = [], refused = [];
  const items = q.items.map(it => {
    if (!want.has(it.id)) return it;
    if (it.status !== 'pending') { refused.push({ id: it.id, why: `already ${it.status}` }); return it; }
    if (action === 'reject') { changed.push(it.id); return { ...it, status: 'rejected', decidedAt: now.toISOString(), ...(clip(reason, 200) ? { reason: clip(reason, 200) } : {}) }; }
    const entry = edits[it.id] ? editEntry(it.entry, edits[it.id]) : it.entry;
    const bad = validateAreaLore(entry);
    if (bad.length) { refused.push({ id: it.id, why: bad.map(p => `${p.path} ${p.problem}`).join('; ') }); return it; }
    changed.push(it.id);
    return { ...it, entry, status: 'approved', decidedAt: now.toISOString(), ...(edits[it.id] ? { edited: true } : {}) };
  });
  return { queue: { ...q, items }, changed, refused };
}

/** Marks the approved items as published with the commit that carries them. */
export const markPublished = (q, ids, commit) => {
  const want = new Set(ids);
  return { ...q, items: q.items.map(it => (want.has(it.id) && it.status === 'approved' ? { ...it, status: 'published', commit } : it)) };
};

export const byStatus = (q, status) => q.items.filter(i => i.status === status);

/** Drops finished history: rejected or published items whose entry ended over a week ago. */
export const prune = (q, now = new Date()) => ({
  ...q, items: q.items.filter(i => i.status === 'pending' || i.status === 'approved' || Date.parse(i.entry.endsAt) > now.getTime() - 7 * 864e5),
});

/** What the review page shows for an item: the Riddle (or errand) it would create. */
export const riddleOf = entry => ({
  question: entry.question,
  options: entry.options?.length ? entry.options : null,
  errand: !entry.options?.length,
});
