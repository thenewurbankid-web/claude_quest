// R3 Lore quests, the client (PLAN-engine.md, "R3 Lore quests"): shared area lore becomes game-only quests, so a
// player with no work still has something to do. Not the lore files of PLAN-settlements §12; this is "area lore".
// - Where: a geohash-4 cell from the rounded place the weather already keeps (clock.js place()); the client reads its
//   cell plus the 8 neighbours from a static lore folder (lore/<cell>/index.json, lore/<cell>/<id>.json).
// - What: only entries that pass validateAreaLore and are live now; anything else is dropped.
// - Never empty: built-in calendar entries (time of day, season, weekend) when nothing else is live.
// - Into the ledger: one game-only March and Lore Hall, a Work per entry and a Riddle with mark {source:'lore',
//   real:false}. isGameOnly keeps them out of the boss, the Haze, the stats and the digest. A lore Work closes when its
//   entry ends (its open Riddle fades) or once its Riddle is sealed.
// Render-free and pure apart from fetchAreaLore, so it runs under node:test.
import { validateAreaLore, validateAreaLoreIndex, noChanges, isGameOnly } from './contract.js';
import { ASK_LATER } from './riddles.js';

// ---------- geohash ----------
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** The geohash of a point, `precision` characters long (4 for an area-lore cell). */
export function geohash(lat, lon, precision = 4) {
  let latR = [-90, 90], lonR = [-180, 180], even = true, bit = 0, ch = 0, out = '';
  while (out.length < precision) {
    const r = even ? lonR : latR, v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

/** A cell's bounds: { lat: [s, n], lon: [w, e] }. */
export function cellBounds(cell) {
  let latR = [-90, 90], lonR = [-180, 180], even = true;
  for (const c of cell) {
    const n = B32.indexOf(c);
    if (n < 0) throw new Error(`not a geohash: ${cell}`);
    for (let i = 4; i >= 0; i--) {
      const r = even ? lonR : latR, mid = (r[0] + r[1]) / 2;
      if ((n >> i) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat: latR, lon: lonR };
}

/** The cell and its 8 neighbours (fewer at the poles), own cell first. Longitude wraps at the date line. */
export function cellAndNeighbours(cell) {
  const { lat, lon } = cellBounds(cell);
  const h = lat[1] - lat[0], w = lon[1] - lon[0];
  const cLat = (lat[0] + lat[1]) / 2, cLon = (lon[0] + lon[1]) / 2;
  const out = [cell];
  for (const dy of [1, 0, -1]) for (const dx of [-1, 0, 1]) {
    const y = cLat + dy * h;
    if ((!dx && !dy) || y > 90 || y < -90) continue;
    const x = ((cLon + dx * w + 540) % 360) - 180;
    const n = geohash(y, x, cell.length);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// ---------- reading the lore folder ----------
const ms = iso => Date.parse(iso);
const live = (e, t) => ms(e.startsAt) <= t && ms(e.endsAt) > t;

/**
 * Reads the live entries for `cells` from a lore folder at `base` (a URL ending in /). A cell with no index, a bad
 * index or a bad entry is skipped, never an error: lore is a nice-to-have.
 * @returns {Promise<{ entries: import('./contract.js').AreaLoreEntry[], reached: string[] }>}
 *   reached: the cells whose index was read, so a caller can tell "nothing live" from "offline"
 */
export async function fetchAreaLore(base, cells, { now = new Date(), fetchFn = globalThis.fetch } = {}) {
  const t = now.getTime(), entries = [], reached = [];
  const get = async url => { const r = await fetchFn(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  await Promise.all(cells.map(async cell => {
    let ix;
    try { ix = await get(new URL(`${cell}/index.json`, base)); } catch { return; }
    if (validateAreaLoreIndex(ix).length || ix.cell !== cell) return;
    reached.push(cell);
    await Promise.all(ix.entries.filter(x => live(x, t)).map(async x => {
      try {
        const e = await get(new URL(`${cell}/${x.id}.json`, base));
        if (!validateAreaLore(e).length && e.cell === cell && e.id === x.id && live(e, t)) entries.push(e);
      } catch {}
    }));
  }));
  entries.sort((a, b) => cells.indexOf(a.cell) - cells.indexOf(b.cell) || a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  return { entries, reached };
}

// ---------- the calendar fallback ----------
const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();

const PARTS = [ // local hours
  { from: 5, to: 12, id: 'morning', line: 'The Hollow wakes to the smell of bread', hint: 'Morning where you are',
    question: 'The baker asks which loaf to bake first.', options: ['Seeded rye', 'Honey loaf', 'Whatever is quickest'] },
  { from: 12, to: 17, id: 'afternoon', line: 'Market carts rattle through the square', hint: 'Afternoon where you are',
    question: 'A carter has lost a wheel pin. Lend a hand?', options: ['Help fix it', 'Point them to the smith'] },
  { from: 17, to: 22, id: 'evening', line: 'Lanterns are lit along the lane', hint: 'Evening where you are',
    question: 'The lamplighter asks which lane to light last.', options: ['The river lane', 'The orchard lane'] },
  { from: 22, to: 29, id: 'night', line: 'Owls keep watch over the sleeping Hollow', hint: 'Night where you are',
    question: 'A night watcher asks you to count the stars over the Lodge.', options: ['Too many to count', 'Seven, I think'] },
];
const SEASONS = { spring: 'Blossom drifts over the orchard', summer: 'Long light lies over the fields',
  autumn: 'Leaves pile up against the Lodge door', winter: 'Frost silvers the well rope' };
const SEASON_Q = { spring: 'The orchard keeper asks which tree to tend first.', summer: 'The miller asks for help bringing water to the fields.',
  autumn: 'The Lodge keeper asks you to sweep the leaves from the door.', winter: 'The well-keeper asks you to break the ice.' };

/** Northern-hemisphere season by month, flipped south of the equator. */
export const seasonOf = (date, lat = 48) => {
  const m = (date.getMonth() + (lat < 0 ? 6 : 0)) % 12;
  return m < 2 || m === 11 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
};

/**
 * Built-in entries from the player's own clock: one for the part of the day, one for the season, one on weekends.
 * Made in the client, never published. Each is valid area lore (kind 'calendar', writer 'calendar').
 */
export function calendarLore(cell, now = new Date(), { lat = 48 } = {}) {
  const h = now.getHours(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hh = h < 5 ? h + 24 : h;
  const p = PARTS.find(x => hh >= x.from && hh < x.to);
  const base = p.id === 'night' && h < 5 ? new Date(today.getTime() - 864e5) : today; // after midnight, still last night
  const writtenAt = now.toISOString();
  const mk = (id, line, hint, question, options, startsAt, endsAt) =>
    ({ id, cell, kind: 'calendar', line, hint, question, ...(options ? { options } : {}), startsAt, endsAt, writtenAt,
      writer: 'calendar', source: null });
  const out = [mk(`cal-${p.id}-${day(base)}`, p.line, p.hint, p.question, p.options, at(base, p.from), at(base, p.to))];
  const s = seasonOf(now, lat);
  out.push(mk(`cal-${s}-${day(today)}`, SEASONS[s], `${s[0].toUpperCase()}${s.slice(1)} where you are`, SEASON_Q[s], null,
    at(today, 0), at(today, 24)));
  const dow = now.getDay();
  if (dow === 0 || dow === 6) {
    const sat = new Date(today.getTime() - (dow === 0 ? 864e5 : 0));
    out.push(mk(`cal-weekend-${day(sat)}`, 'Fiddlers tune up for the weekend dance', 'It is the weekend',
      'The fiddlers ask which tune should open the dance.', ['A quick reel', 'A slow air'], at(sat, 0), at(sat, 48)));
  }
  return out;
}

/** What the board and the ledger use: the live area lore, or the calendar when there is none. */
export const boardLore = (areaEntries, cell, now = new Date(), opts = {}) =>
  areaEntries.length ? areaEntries : calendarLore(cell, now, opts);

// ---------- into the ledger ----------
export const LORE_MARCH = { id: 'lore-town', name: 'Town news', banner: '#c9a24a', steward: null };
export const LORE_HALL = { id: 'lore-hall', marchId: LORE_MARCH.id, name: 'The Lore Hall', status: 'active', order: 9999 };
const workId = e => `lore:${e.cell}/${e.id}`;
/** The id of the game-only Riddle an entry becomes. */
export const riddleId = e => `lore-riddle:${e.cell}/${e.id}`;
const mark = (e, t) => ({ status: 'sent', source: 'lore', sourceId: `${e.cell}/${e.id}`, real: false, at: t });

/**
 * Changes that bring the ledger in line with the live lore: the Town news March and Lore Hall once, a blocked Work and
 * an open Riddle for each new entry, and lore Works closed when their entry ends (open Riddle faded) or their Riddle is
 * sealed (done). Real Works and Riddles are never touched.
 */
export function loreChanges(ledger, entries, now = new Date()) {
  const out = noChanges(), t = now.toISOString(), tn = now.getTime();
  if (!ledger.marches.some(m => m.id === LORE_MARCH.id)) out.puts.push({ kind: 'marches', record: { ...LORE_MARCH } });
  if (!ledger.halls.some(h => h.id === LORE_HALL.id)) out.puts.push({ kind: 'halls', record: { ...LORE_HALL } });
  const have = new Set(ledger.works.map(w => w.id));
  for (const e of entries) {
    if (have.has(workId(e)) || ms(e.endsAt) <= tn) continue;
    out.puts.push({ kind: 'works', record: { id: workId(e), marchId: LORE_MARCH.id, hallId: LORE_HALL.id, title: e.line,
      status: 'blocked', priority: 'low', size: 'S', keeperId: null, createdAt: t, updatedAt: t, endsAt: e.endsAt,
      mark: mark(e, t) } });
    const opts = [...new Set((e.options || []).map(o => o.trim()).filter(o => o && o !== ASK_LATER))];
    const r = { id: riddleId(e), workId: workId(e), marchId: LORE_MARCH.id, text: e.question, line: e.line,
      options: [...(opts.length ? opts : ['Done']), ASK_LATER], risk: 'normal', state: 'open', steward: null, raisedAt: t,
      mark: mark(e, t) };
    out.puts.push({ kind: 'riddles', record: r });
    out.events.push({ at: t, kind: 'riddle.raised', ref: r.id });
  }
  for (const w of ledger.works.filter(w => isGameOnly(w) && !['done', 'cancelled'].includes(w.status))) {
    const rs = ledger.riddles.filter(r => r.workId === w.id);
    if (w.endsAt && ms(w.endsAt) <= tn) {
      for (const r of rs.filter(r => ['open', 'deferred'].includes(r.state))) {
        out.puts.push({ kind: 'riddles', record: { ...r, state: 'faded', resolvedAt: t, fadeNote: 'The moment passed.' } });
        out.events.push({ at: t, kind: 'riddle.faded', ref: r.id });
      }
      out.puts.push({ kind: 'works', record: { ...w, status: rs.some(r => r.state === 'sealed') ? 'done' : 'cancelled', resolvedAt: t } });
    } else if (rs.length && rs.every(r => ['sealed', 'faded'].includes(r.state))) {
      out.puts.push({ kind: 'works', record: { ...w, status: 'done', resolvedAt: t } });
    }
  }
  return out;
}
