// A region's map and the hub's gates, as cells. Render-free (no three.js), so node tests can check them.
// Region legend (the hub's, plus):  G gate back to the hub (walkable)   P a post that carries one Work (solid)
// A region is 32x24: a road runs north from the gate and a cross road meets it, posts stand either side in a fixed
// pattern (nearest first), a pond sits in one top corner, and trees ring the edge. The same region id always gives the
// same map. Nothing here knows a source or a ledger: it takes a region's id and the number of posts it must hold.
export const REGION_COLS = 32;
export const REGION_ROWS = 24;
const hash = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const cellHash = (c, r, k = 0) => (((c + 13) * 73856093) ^ ((r + 7) * 19349663) ^ ((k + 3) * 83492791)) >>> 0;

const POST_COLS = [12, 20, 8, 24];
const POST_ROWS = [20, 18, 16, 14, 9, 7];
const GATE = [16, REGION_ROWS - 1];
const START = [16, REGION_ROWS - 2];

/** @param {{ id: string, posts: { workId: string }[] }} region */
export function regionMap(region) {
  const g = Array.from({ length: REGION_ROWS }, () => Array(REGION_COLS).fill('.'));
  const set = (c, r, ch) => { if (r >= 0 && c >= 0 && r < REGION_ROWS && c < REGION_COLS) g[r][c] = ch; };
  for (let r = 0; r < REGION_ROWS; r++) for (let c = 0; c < REGION_COLS; c++) {
    if (r === 0 || c === 0 || c === REGION_COLS - 1 || r === REGION_ROWS - 1) set(c, r, 'T');
    else if (cellHash(c, r) % 100 < 14) set(c, r, ',');
  }
  for (let r = 2; r < REGION_ROWS - 1; r++) for (const c of [15, 16, 17]) set(c, r, '=');
  for (let c = 4; c <= REGION_COLS - 5; c++) set(c, 11, '=');
  // the pond: a left or right top corner, by the region's id
  const left = hash(region.id) % 2 === 0, p0 = left ? 3 : 22;
  for (let r = 2; r <= 5; r++) for (let c = p0; c < p0 + 6; c++) set(c, r, (r === 2 || r === 5) && (c === p0 || c === p0 + 5) ? '.' : '~');
  const slots = [];
  for (const r of POST_ROWS) for (const c of POST_COLS) slots.push([c, r]);
  slots.sort((a, b) => Math.abs(a[0] - START[0]) + Math.abs(a[1] - START[1]) - Math.abs(b[0] - START[0]) - Math.abs(b[1] - START[1]) || a[1] - b[1] || a[0] - b[0]);
  const posts = [];
  region.posts.slice(0, slots.length).forEach((p, i) => { const [c, r] = slots[i]; set(c, r, 'P'); posts.push({ workId: p.workId, c, r }); });
  // scattered trees stay off roads, posts, the pond's edge and the start; the grass round a post stays open
  for (let r = 1; r < REGION_ROWS - 1; r++) for (let c = 1; c < REGION_COLS - 1; c++) {
    if (g[r][c] !== '.' || cellHash(c, r, 5) % 100 >= 7) continue;
    if (Math.abs(c - START[0]) + Math.abs(r - START[1]) <= 3) continue;
    if (posts.some(p => Math.abs(p.c - c) <= 1 && Math.abs(p.r - r) <= 1)) continue;
    if (r <= 6 && (c >= p0 - 1 && c <= p0 + 6)) continue;
    if (g[r][c - 1] === '=' || g[r][c + 1] === '=' || g[r - 1]?.[c] === '=' || g[r + 1]?.[c] === '=') continue;
    set(c, r, 'T');
  }
  set(...GATE, 'G');
  return { rows: g.map(r => r.join('')), cols: REGION_COLS, gate: GATE, start: START, posts };
}

// The hub's gate slots, in the order Marches take them: the four road ends first, then the second lane of each. Each
// is { c, r } on the map's edge and `inward`, the cell the player stands on when coming back.
export const GATE_SLOTS = [
  { c: 22, r: 0, inward: [22, 1] }, { c: 22, r: 31, inward: [22, 30] }, { c: 0, r: 15, inward: [1, 15] }, { c: 47, r: 15, inward: [46, 15] },
  { c: 24, r: 0, inward: [24, 1] }, { c: 24, r: 31, inward: [24, 30] }, { c: 0, r: 16, inward: [1, 16] }, { c: 47, r: 16, inward: [46, 16] },
];

/** One gate per region, up to the slots; `hidden` counts the regions that found no gate (the sign says so). */
export function hubGates(regions) {
  const gates = regions.slice(0, GATE_SLOTS.length).map((reg, i) => ({ regionId: reg.id, name: reg.name, banner: reg.banner, ...GATE_SLOTS[i] }));
  return { gates, hidden: Math.max(0, regions.length - GATE_SLOTS.length) };
}
