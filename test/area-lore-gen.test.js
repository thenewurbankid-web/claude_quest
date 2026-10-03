// R3 area lore, the generator: only allowed kinds pass, feeds parse, the writer falls back to templates, and a run lays
// out a lore folder the client reads (cells.json, index.json, one file per entry), reusing and pruning entries.
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateAreaLore } from '../public/quest/contract.js';
import { fetchAreaLore } from '../public/quest/area-lore.js';
import { classify, parseICal, parseRSS, weatherEvent } from '../area-lore/sources.mjs';
import { writeWords, templateWords, hintOf } from '../area-lore/writer.mjs';
import { buildCell, run, entryId } from '../area-lore/generate.mjs';

const NOW = new Date('2026-10-04T06:00:00Z');

test('classify: allowed kinds pass, everything else and anything about harm or politics is dropped', () => {
  assert.equal(classify('Christmas Market on the green'), 'market');
  assert.equal(classify('Jazz night at the Corn Exchange'), 'music');
  assert.equal(classify('Cambridge Half Marathon'), 'sports');
  assert.equal(classify('Folk festival weekend'), 'festival');
  assert.equal(classify('Bonfire night fireworks'), 'seasonal');
  assert.equal(classify('Planning committee update'), null);
  assert.equal(classify('Vigil for the victims'), null);
  assert.equal(classify('Election rally with live music'), null); // never wins over a kind
  assert.equal(classify(''), null);
});

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc-1
SUMMARY:Farmers' Market
LOCATION:Market Square\\, Town
DTSTART:20261004T090000Z
DTEND:20261004T140000Z
END:VEVENT
BEGIN:VEVENT
UID:abc-2
SUMMARY:Long title that is fold
 ed onto two lines: Live Music
DTSTART;VALUE=DATE:20261005
END:VEVENT
END:VCALENDAR`;

test('parseICal: unfolds lines, unescapes text, and gives an all-day event its day', () => {
  const [a, b] = parseICal(ICS, 'Town events');
  assert.equal(a.title, "Farmers' Market");
  assert.equal(a.where, 'Market Square, Town');
  assert.equal(a.startsAt, '2026-10-04T09:00:00.000Z');
  assert.equal(b.title, 'Long title that is folded onto two lines: Live Music');
  assert.equal(b.endsAt, '2026-10-05T23:59:00.000Z');
  assert.equal(classify(b.text), 'music');
});

test('parseRSS: items with a date, tags and entities stripped', () => {
  const rss = `<rss><channel><item><title><![CDATA[Gig: <b>The Band</b> &amp; friends]]></title><link>https://x.test/1</link>
    <pubDate>Sun, 04 Oct 2026 18:00:00 GMT</pubDate></item><item><title>No date</title></item></channel></rss>`;
  const items = parseRSS(rss, 'Listings');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Gig: The Band & friends');
  assert.equal(classify(items[0].text), 'music');
});

test('weatherEvent: today from an Open-Meteo daily forecast', () => {
  const w = weatherEvent({ daily: { time: ['2026-10-04', '2026-10-05'], weather_code: [61, 0],
    temperature_2m_max: [14.4, 16], temperature_2m_min: [8.6, 7] } }, 'gcpv', NOW);
  assert.equal(w.sky, 'rain');
  assert.equal(w.title, 'Rain today, 9 to 14°C');
  assert.equal(w.startsAt, '2026-10-04T00:00:00.000Z');
  assert.equal(weatherEvent({}, 'gcpv', NOW), null);
});

test('writeWords: uses Ollama when it answers well, the template when it fails or answers badly', async () => {
  const ev = { title: 'Jazz night', feed: 'x' };
  const ok = async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify(
    { line: 'Horns sound at the Lodge', question: 'The players ask you to fetch their music stands.', options: ['Fetch them', 'Later'] }) } }) });
  assert.equal((await writeWords('music', ev, { url: 'http://o', model: 'm' }, { fetchFn: ok })).writer, 'ollama');
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.deepEqual(await writeWords('music', ev, { url: 'http://o', model: 'm' }, { fetchFn: down }), templateWords('music'));
  const junk = async () => ({ ok: true, json: async () => ({ message: { content: '{"line":"x","question":"y","options":[]}' } }) });
  assert.equal((await writeWords('music', ev, { url: 'http://o', model: 'm' }, { fetchFn: junk })).writer, 'template');
  assert.equal((await writeWords('market', ev, null)).writer, 'template');
  assert.equal(hintOf({ title: 'Jazz', where: 'Hall' }), 'Jazz, Hall');
});

const words = async (kind, ev) => templateWords(kind, ev);
const happening = (o = {}) => ({ uid: 'u1', title: 'Market', where: '', startsAt: '2026-10-04T09:00:00.000Z',
  endsAt: '2026-10-04T14:00:00.000Z', feed: 'f', url: null, kind: 'market', ...o });

test('buildCell: writes valid entries once, reuses them, and drops ended or far-off ones', async () => {
  let calls = 0;
  const counted = async (k, e) => { calls++; return words(k, e); };
  const hs = [happening(), happening({ uid: 'u2', startsAt: '2026-10-30T09:00:00.000Z', endsAt: '2026-10-30T10:00:00.000Z' }),
    happening({ uid: 'u3', startsAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-01T10:00:00.000Z' })];
  const first = await buildCell({ cell: 'gcpv', happenings: hs, existing: [], now: NOW, words: counted });
  assert.equal(first.entries.length, 1);
  assert.deepEqual(validateAreaLore(first.entries[0]), []);
  assert.equal(first.entries[0].id, entryId('market', hs[0]));
  const again = await buildCell({ cell: 'gcpv', happenings: hs, existing: first.entries, now: NOW, words: counted });
  assert.equal(calls, 1); // written once, reused
  assert.deepEqual(again.entries, first.entries);
  const later = await buildCell({ cell: 'gcpv', happenings: [], existing: first.entries, now: new Date('2026-10-05T00:00:00Z'), words });
  assert.deepEqual(later.entries, []);
});

test('run: lays out a lore folder the client reads, prunes ended entries, lists only cells with an index', async () => {
  const out = await mkdtemp(join(tmpdir(), 'lore-'));
  await mkdir(join(out, 'gcpv'));
  await writeFile(join(out, 'gcpv', 'old.json'), JSON.stringify({ id: 'old', cell: 'gcpv', kind: 'music', line: 'x', hint: 'x',
    question: 'x', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-02T00:00:00Z', writtenAt: '2026-09-01T00:00:00Z', writer: 'template' }));
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('open-meteo')) return { ok: true, json: async () => ({ daily: { time: ['2026-10-04'], weather_code: [3],
      temperature_2m_max: [15], temperature_2m_min: [9] } }) };
    if (u === 'https://feeds.test/town.ics') return { ok: true, text: async () => ICS };
    return { ok: false, status: 404 };
  };
  const areas = [{ cell: 'gcpv', feeds: [{ name: 'Town events', type: 'ical', url: 'https://feeds.test/town.ics' },
    { name: 'Gone', type: 'rss', url: 'https://feeds.test/gone.rss' }] }, { cell: 'bad!' }];
  const list = await run({ areas, out, now: NOW, fetchFn, log: () => {} });
  assert.deepEqual(list.cells, ['gcpv']);
  const files = (await readdir(join(out, 'gcpv'))).sort();
  assert.ok(!files.includes('old.json'));
  assert.equal(files.length, 4); // index + weather + market + music
  const fileFetch = async url => { try { const b = await readFile(url); return { ok: true, json: async () => JSON.parse(b) }; }
    catch { return { ok: false, status: 404 }; } };
  const { entries } = await fetchAreaLore(pathToFileURL(out + '/'), ['gcpv'], { now: new Date('2026-10-04T10:00:00Z'), fetchFn: fileFetch });
  assert.deepEqual(entries.map(e => e.kind).sort(), ['market', 'weather']); // the music night starts tomorrow
  assert.ok(entries.find(e => e.kind === 'market').hint.includes('Market Square'));
});
