// Marches as 3D regions (CLA-15). Pure: the ledger snapshot in, a list of regions out. The ledger is the Quest protocol's
// view of the work, whatever the source (Paperclip projects arrive as Marches, local Halls are made in game), so the
// renderer never asks where a March came from. With no real March at all (a fresh local ledger), a default set of
// explorable regions stands in so the larger world still has somewhere to go. Never touches a store.
import { isGameOnly } from './contract.js';
import { LORE_MARCH } from './area-lore.js';

/** The regions a ledger with no Marches gets. Plainly generated: no Works, no Halls. */
export const DEFAULT_REGIONS = [
  { id: 'default-fernwood', name: 'The Fernwood', banner: '#4f8a3c' },
  { id: 'default-saltmere', name: 'The Saltmere', banner: '#3f86b8' },
  { id: 'default-highmoor', name: 'The Highmoor', banner: '#8a5fb0' },
  { id: 'default-emberfen', name: 'The Emberfen', banner: '#d9822b' },
];

/** Most Works a region shows as posts (the rest are counted, not drawn: phone performance). */
export const MAX_POSTS = 24;

const URGENCY = { blocked: 0, in_review: 1, in_progress: 2, todo: 3, backlog: 4, done: 5, cancelled: 6 };

/**
 * @typedef {{ id: string, name: string, banner: string, generated: boolean, marchId: string|null,
 *             posts: { workId: string, title: string, status: string }[], hidden: number }} Region
 * @param {object} ledger
 * @returns {Region[]}
 */
export function regionsOf(ledger) {
  const marches = (ledger?.marches || []).filter(m => m.id !== LORE_MARCH.id && !isGameOnly(m));
  if (!marches.length) return DEFAULT_REGIONS.map(r => ({ ...r, generated: true, marchId: null, posts: [], hidden: 0 }));
  return marches.map(m => {
    const works = (ledger.works || []).filter(w => w.marchId === m.id && !isGameOnly(w))
      .sort((a, b) => (URGENCY[a.status] ?? 9) - (URGENCY[b.status] ?? 9) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { id: m.id, name: m.name, banner: m.banner || '#c9a24a', generated: false, marchId: m.id,
      posts: works.slice(0, MAX_POSTS).map(w => ({ workId: w.id, title: w.title, status: w.status })), hidden: Math.max(0, works.length - MAX_POSTS) };
  });
}

/** What a post says when read: plain text lines for the Work (never HTML). */
export function postLines(ledger, workId) {
  const w = ledger?.works?.find(x => x.id === workId);
  if (!w) return null;
  const hall = ledger.halls?.find(h => h.id === w.hallId);
  const march = ledger.marches?.find(m => m.id === w.marchId);
  const open = (ledger.riddles || []).some(r => r.workId === w.id && r.state === 'open');
  return [w.title, [w.status.replace('_', ' '), w.priority, hall?.name, march?.name].filter(Boolean).join(' · '),
    ...(open ? ['A question about this Work is waiting.'] : [])];
}
