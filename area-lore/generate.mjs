#!/usr/bin/env node
// R3 area lore, the generator (PLAN-engine.md, "R3 Lore quests"). Run on a schedule by the private lore-gen repo's
// workflow on the user's self-hosted runner; see area-lore/README.md. For each area in areas.json it reads today's
// weather and the area's feeds, keeps only allowed kinds, writes each new happening once (Ollama, else a template) and
// lays out the static lore folder the clients read:
//   <out>/cells.json, <out>/<cell>/index.json, <out>/<cell>/<id>.json
// An entry already written is reused until it ends, then removed. A missed run only makes lore late.
//
//   node area-lore/generate.mjs --areas areas.json --out lore [--now 2026-10-04T06:00:00Z] [--no-ollama]
//   env: OLLAMA_URL (default http://127.0.0.1:11434), OLLAMA_MODEL (no model: templates only)
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateAreaLore, validateAreaLoreIndex, validateAreaLoreCells, AREA_LORE_VERSION, GEOHASH_CELL } from '../public/quest/contract.js';
import { cellBounds } from '../public/quest/area-lore.js';
import { classify, parseICal, parseRSS, weatherEvent, forecastUrl } from './sources.mjs';
import { writeWords, hintOf } from './writer.mjs';

const HORIZON_DAYS = 7;   // write what starts within a week
const PER_CELL = 12;      // at most this many entries live or coming in a cell
const ms = iso => Date.parse(iso);

/** A stable file-safe id: kind, start day and a short hash of the source's uid. */
export const entryId = (kind, ev) =>
  `${kind}-${ev.startsAt.slice(0, 10)}-${createHash('sha1').update(String(ev.uid)).digest('hex').slice(0, 8)}`;

/**
 * One cell's lore: keeps the still-current entries already written, writes new ones for happenings that start within
 * the horizon, and drops anything ended or invalid.
 * @param {{ cell: string, happenings: (import('./sources.mjs').RawEvent & { kind: string })[],
 *           existing: import('../public/quest/contract.js').AreaLoreEntry[], now: Date,
 *           words: (kind: string, ev: object) => Promise<{ line: string, question: string, options?: string[], writer: string }> }} a
 * @returns {Promise<{ entries: import('../public/quest/contract.js').AreaLoreEntry[], index: object }>}
 */
export async function buildCell({ cell, happenings, existing, now, words }) {
  const t = now.getTime(), until = t + HORIZON_DAYS * 864e5;
  const kept = new Map(existing.filter(e => !validateAreaLore(e).length && e.cell === cell && ms(e.endsAt) > t).map(e => [e.id, e]));
  const seen = new Set();
  const fresh = happenings
    .filter(h => h.kind && ms(h.endsAt) > t && ms(h.startsAt) <= until)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const h of fresh) {
    const id = entryId(h.kind, h);
    if (seen.has(id)) continue;
    seen.add(id);
    if (kept.has(id) || kept.size >= PER_CELL) continue;
    const w = await words(h.kind, h);
    const e = { id, cell, kind: h.kind, line: w.line, hint: hintOf(h), question: w.question,
      ...(w.options ? { options: w.options } : {}), startsAt: h.startsAt, endsAt: h.endsAt, writtenAt: now.toISOString(),
      writer: w.writer, source: { name: String(h.feed).slice(0, 60), url: h.url || null } };
    if (!validateAreaLore(e).length) kept.set(id, e);
  }
  const entries = [...kept.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const index = { version: AREA_LORE_VERSION, cell, updatedAt: now.toISOString(),
    entries: entries.map(({ id, kind, startsAt, endsAt }) => ({ id, kind, startsAt, endsAt })) };
  const bad = validateAreaLoreIndex(index);
  if (bad.length) throw new Error(`index for ${cell}: ${bad.map(p => `${p.path} ${p.problem}`).join('; ')}`);
  return { entries, index };
}

/** Happenings for one area: today's weather plus every feed's events of an allowed kind. Failures are skipped. */
export async function gather(area, { now = new Date(), fetchFn = globalThis.fetch, log = () => {} } = {}) {
  const out = [];
  const get = async url => { const r = await fetchFn(url, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${r.status}`); return r; };
  const { lat, lon } = cellBounds(area.cell);
  try {
    const w = weatherEvent(await (await get(forecastUrl({ lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 }))).json(), area.cell, now);
    if (w) out.push(w);
  } catch (err) { log(`${area.cell}: weather skipped (${err.message})`); }
  for (const f of area.feeds || []) {
    try {
      const text = await (await get(f.url)).text();
      const evs = f.type === 'rss' ? parseRSS(text, f.name || 'rss') : parseICal(text, f.name || 'ical');
      for (const ev of evs) { const kind = classify(ev.text || ev.title); if (kind) out.push({ ...ev, kind }); }
    } catch (err) { log(`${area.cell}: feed ${f.name || f.url} skipped (${err.message})`); }
  }
  return out;
}

/**
 * New entries only, for the moderation queue: `known` (everything already queued, approved, published or rejected)
 * is treated as existing, so it is never written twice. Returns the entries not in `known`.
 */
export async function generateNew({ areas, known = [], now = new Date(), ollama = null, fetchFn = globalThis.fetch, log = () => {}, keepAlive }) {
  const out = [];
  for (const area of areas) {
    if (!GEOHASH_CELL.test(area.cell || '')) { log(`skipped an area with a bad cell: ${JSON.stringify(area.cell)}`); continue; }
    const existing = known.filter(e => e.cell === area.cell);
    const ids = new Set(existing.map(e => e.id));
    const happenings = await gather(area, { now, fetchFn, log });
    const { entries } = await buildCell({ cell: area.cell, happenings, existing, now,
      words: (kind, ev) => writeWords(kind, ev, ollama, { fetchFn, keepAlive }) });
    out.push(...entries.filter(e => !ids.has(e.id)));
  }
  return out;
}

const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

/** Runs every area into the lore folder `out`, then rewrites cells.json from the cells that have an index. */
export async function run({ areas, out, now = new Date(), ollama = null, fetchFn = globalThis.fetch, log = console.log }) {
  for (const area of areas) {
    if (!GEOHASH_CELL.test(area.cell || '')) { log(`skipped an area with a bad cell: ${JSON.stringify(area.cell)}`); continue; }
    const dir = join(out, area.cell);
    await mkdir(dir, { recursive: true });
    const existing = [];
    for (const f of (await readdir(dir)).filter(f => f.endsWith('.json') && f !== 'index.json'))
      try { existing.push(await readJson(join(dir, f))); } catch {}
    const happenings = await gather(area, { now, fetchFn, log });
    const { entries, index } = await buildCell({ cell: area.cell, happenings, existing, now,
      words: (kind, ev) => writeWords(kind, ev, ollama, { fetchFn }) });
    const keep = new Set(entries.map(e => `${e.id}.json`));
    for (const e of entries) await writeFile(join(dir, `${e.id}.json`), JSON.stringify(e, null, 2) + '\n');
    for (const f of existing.map(e => `${e.id}.json`)) if (!keep.has(f)) await rm(join(dir, f), { force: true });
    await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    log(`${area.cell}: ${entries.length} entries (${entries.filter(e => e.writtenAt === now.toISOString()).length} new)`);
  }
  const cells = [];
  for (const d of (await readdir(out, { withFileTypes: true })).filter(d => d.isDirectory() && GEOHASH_CELL.test(d.name)))
    try { if (!validateAreaLoreIndex(await readJson(join(out, d.name, 'index.json'))).length) cells.push(d.name); } catch {}
  const list = { version: AREA_LORE_VERSION, updatedAt: now.toISOString(), cells: cells.sort() };
  if (validateAreaLoreCells(list).length) throw new Error('cells.json would be invalid');
  await writeFile(join(out, 'cells.json'), JSON.stringify(list, null, 2) + '\n');
  return list;
}

// ---------- CLI ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
  const areasPath = arg('areas'), out = arg('out');
  if (!areasPath || !out) { console.error('usage: generate.mjs --areas areas.json --out lore [--now ISO] [--no-ollama]'); process.exit(2); }
  const model = process.env.OLLAMA_MODEL;
  const ollama = process.argv.includes('--no-ollama') || !model ? null
    : { url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434', model };
  const { areas } = await readJson(areasPath);
  await mkdir(out, { recursive: true });
  const list = await run({ areas, out, now: arg('now') ? new Date(arg('now')) : new Date(), ollama });
  console.log(`cells.json: ${list.cells.length} cells${ollama ? '' : ' (templates only)'}`);
}
