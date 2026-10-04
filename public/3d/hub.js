// The hub, Ember Hollow, as cells: 96x64 (user, 2026-10-04: a bigger walkable town; before that 48x32). The 48x32 town
// of 2026-10-03 sits in the middle (offset OFF) with its tree wall opened up; its roads run on to the map's edges and
// four new districts grow around it: a market (west), docks on a lake (south-west), the lodge grounds (flowers and
// lamps round the Keeper's Lodge), and a forest edge with a trail and a clearing (east), plus a farm to the south.
// Legend:
//   . grass   , tall grass   = road   ~ water   P dock planks   T tree   C Keeper's Lodge (2x2 footprint marker)
//   H house   W Ember Well   B board   M mailbox   S Waystone   F flowers   K market stall   L lamp post
const OLD = [
  'TTTTTTTTTTTTTTTTTTTTTT====TTTTTTTTTTTTTTTTTTTTTT',
  'TTT.T.TT.TTTTT.TT...T.====T.TTTT.T..T.TTT.TT..TT',
  'T..T....T.TT.T.T....T.====.......T....TT.T...T.T',
  'TT..............TT....====.T...............F.TTT',
  'T.T.T.H.....T...T....T====T...TT..T.H.....F....T',
  'T........F..TT........====..............H..T...T',
  'T.....TT...T.....TT...====...........T.........T',
  'T.....................====.....................T',
  'T............TT.TT.TT.====T.TT.TT.TT...........T',
  'T,.T....,...T..,,.....====.....,,....T.T.T.T.T.T',
  'T...........T.F......C====.........T...........T',
  'T,,,.................=====.....H...T.T.T.T.T.T.T',
  'T....T.T.,..T.H......=====.....................T',
  'T,,...,.,T..T........======........T.T.T.T.T.T.T',
  'TT.,,....,,....,.....=====F....,,..T...........T',
  '================================================',
  '================================================',
  'T................B...=====M........T...........T',
  'T.,,,,,,,,,.T..F.....=====...~~~.....FF,FF,FF,.T',
  'T...~~~~~...T........=====..~~~~~..T.,,,,,,,,,.T',
  'T.~~~~~~~~....,,..H..=====..~~~~...T.FF,FF,FF,.T',
  'T.~~~~~~~~..T.,,,....=====...~~..S...,,,,,,,,,.T',
  'T.~~~~~~~~..T........=====.........T.FF,FF,FF,.T',
  'T.~~~~~~~~...TT.TT.TT=====T.TT.TT.TT.,,,,,,,,,.T',
  'T.~~~~~~~............=====.....................T',
  'T,.~~~~~~....,.TFT..,=====..,..............T,T.T',
  'TF,,,,,,,,,,T....,..,=====.F...,...T...,.HTFT.TT',
  'TT.,.........,..T....=====.,.........,T,.,..H..T',
  'T..T.....T.FTF.,.....=====....T,F...TTF.......,T',
  'T.,..T....F,.,.,..,..=====..,..TT...,...T..,...T',
  'T........T,...,F.,...=====......T.....T.,.....FT',
  'TTTTTTTTTTTTTTTTTTTTT=====TTTTTTTTTTTTTTTTTTTTTT',
];

const OFF = [24, 16];
export const COLS = 96, ROWS = 64;
const hash = (c, r) => (((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000;
/** Districts as [c0, r0, c1, r1] rectangles, inclusive, for tests and for travel points later. */
export const AREAS = {
  town: [OFF[0] + 12, OFF[1] + 8, OFF[0] + 35, OFF[1] + 23],
  market: [6, 22, 21, 30],
  docks: [4, 33, 22, 58],
  lodge: [OFF[0] + 14, OFF[1] + 6, OFF[0] + 20, OFF[1] + 14],
  forest: [76, 8, 95, 55],
  farm: [52, 50, 82, 60],
};
function build() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  const rect = (c0, r0, c1, r1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = ch; };
  const put = (c, r, ch) => { g[r][c] = ch; };
  // Open country first: trees thicker to the north and the east, a loose meadow to the south and west.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const h = hash(c, r);
    const edge = c < 3 || r < 3 || c > COLS - 4 || r > ROWS - 4;
    const dense = edge ? 0.8 : r < 16 ? 0.3 : c >= 84 ? 0.55 : c >= 72 ? 0.2 : r >= 48 ? 0.1 : 0.08;
    g[r][c] = h / 1000 < dense ? 'T' : h % 10 === 3 ? ',' : h % 33 === 4 ? 'F' : '.';
  }
  // The old town, its outer tree wall opened to grass.
  OLD.forEach((row, r) => [...row].forEach((ch, c) => {
    const rim = r === 0 || c === 0 || r === OLD.length - 1 || c === row.length - 1;
    g[r + OFF[1]][c + OFF[0]] = rim && ch === 'T' ? '.' : ch;
  }));
  // The Ember Well at the crossing of the two streets.
  put(OFF[0] + 23, OFF[1] + 14, 'W');
  // Main streets run out to the edges of the map.
  rect(0, 31, 23, 32, '='); rect(72, 31, COLS - 1, 32, '=');
  rect(46, 0, 49, 15, '='); rect(45, 48, 49, ROWS - 1, '=');
  // Market: a paved square with two rows of stalls, lamps at the corners, flowers along its north side.
  rect(4, 19, 23, 30, '.');
  rect(6, 22, 21, 30, '=');
  for (const r of [24, 28]) for (const c of [8, 11, 14, 17, 20]) put(c, r, 'K');
  for (const [c, r] of [[6, 22], [21, 22], [6, 30], [21, 30], [13, 26]]) put(c, r, 'L');
  for (let c = 6; c <= 21; c += 2) put(c, 20, 'F');
  // Docks: a lake with a spur road down to a pier and a cross pier, a boathouse and two fish stalls on the shore.
  rect(2, 35, 24, 62, '.');
  rect(4, 41, 22, 58, '~');
  for (const [c, r] of [[4, 41], [22, 41], [4, 58], [22, 58]]) put(c, r, '.');
  rect(14, 33, 15, 40, '=');
  rect(14, 41, 15, 52, 'P'); rect(8, 49, 21, 50, 'P');
  put(9, 38, 'H'); put(12, 38, 'K'); put(17, 38, 'K'); put(13, 34, 'L'); put(16, 34, 'L'); put(13, 40, 'L'); put(16, 40, 'L');
  // Lodge grounds: flowers either side of the lodge's lawn and lamps along the street, only on open grass.
  const [lc0, lr0, lc1, lr1] = AREAS.lodge;
  for (let r = lr0; r <= lr1; r++) for (let c = lc0; c <= lc1; c++) if ((g[r][c] === '.' || g[r][c] === ',') && (c + r) % 2 === 0 && c < OFF[0] + 20) g[r][c] = 'F';
  for (const [c, r] of [[OFF[0] + 20, OFF[1] + 7], [OFF[0] + 20, OFF[1] + 13]]) if (g[r][c] === '.' || g[r][c] === 'F') put(c, r, 'L');
  // Forest edge: a trail off the east street into a clearing with a hut.
  rect(80, 19, 81, 30, ','); rect(80, 19, 88, 20, ',');
  rect(84, 14, 92, 23, '.'); rect(84, 19, 88, 20, ',');
  for (const [c, r] of [[85, 15], [87, 22], [91, 17], [90, 22]]) put(c, r, 'F');
  put(89, 16, 'H');
  // Farm to the south: a farmhouse, flowers and rows of tall grass for crops, fenced from the road by nothing but habit.
  rect(52, 50, 82, 60, '.');
  put(54, 52, 'H');
  for (let r = 54; r <= 59; r += 2) for (let c = 58; c <= 80; c++) put(c, r, ',');
  for (let c = 56; c <= 60; c += 2) put(c, 52, 'F');
  return g.map(row => row.join(''));
}
export const HUB = build();
export const SOLID = new Set(['T', '~', 'C', 'H', 'W', 'B', 'M', 'S', 'K', 'L']);
// Where the old 24x16 town now sits; the spots below are town cells shifted by it.
export const TOWN = [12 + OFF[0], 8 + OFF[1]];
const inTown = ([c, r]) => [c + TOWN[0], r + TOWN[1]];
/** The player's first cell: just south-east of the Ember Well. */
export const START = inTown([11, 9]);
/** Where Keepers start wandering, in order (LOOK.people.keepers takes the first few). */
export const KEEPER_SPOTS = [[4, 7], [17, 8], [11, 13], [6, 4], [19, 12]].map(inTown);
