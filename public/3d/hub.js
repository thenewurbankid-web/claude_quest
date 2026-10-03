// The hub, Ember Hollow, as cells: 48x32 (user, 2026-10-03: "make the worlds bigger"). The old 24x16 town sits in the
// middle (offset TOWN) with its tree wall opened into a hedge: Keeper's Lodge to the north, two crossing roads, the
// Ember Well at the crossing, a notice board, a mailbox and a Waystone. Around it the roads run on to the map's edges:
// a wood with a hamlet to the north, a lake to the west, an orchard and fields to the east, a meadow to the south.
// Legend:
//   . grass   , tall grass   = road   ~ water   T tree   C Keeper's Lodge (2x2 footprint marker)   H house
//   W Ember Well   B board   M mailbox   S Waystone   F flowers
export const HUB = [
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
export const SOLID = new Set(['T', '~', 'C', 'H', 'W', 'B', 'M', 'S']);
// Where the old town's cell (0, 0) now sits; the spots below are town cells shifted by it.
export const TOWN = [12, 8];
const inTown = ([c, r]) => [c + TOWN[0], r + TOWN[1]];
/** The player's first cell: just south-east of the Ember Well. */
export const START = inTown([11, 9]);
/** Where Keepers start wandering, in order (LOOK.people.keepers takes the first few). */
export const KEEPER_SPOTS = [[4, 7], [17, 8], [11, 13], [6, 4], [19, 12]].map(inTown);
