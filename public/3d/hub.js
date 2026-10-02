// The hub, Ember Hollow, as cells. Mirrors the 2D hub: Claude Center to the north, two crossing roads, the Ember Well
// at the crossing, a notice board, a mailbox and a Waystone. Legend:
//   . grass   , tall grass   = road   ~ water   T tree   C Claude Center (2x2 footprint marker)   H house
//   W Ember Well   B board   M mailbox   S Waystone   F flowers
export const HUB = [
  'TTTTTTTTTT====TTTTTTTTTT',
  'T..,,.....====.....,,..T',
  'T.F......C====.........T',
  'T........=====.....H...T',
  'T.H......=====.........T',
  'T........======........T',
  'T..,.....=====F....,,..T',
  '========================',
  '==========W=============',
  'T....B...=====M........T',
  'T..F.....=====...~~~...T',
  'T........=====..~~~~~..T',
  'T.,,..H..=====..~~~~...T',
  'T.,,,....=====...~~..S.T',
  'T........=====.........T',
  'TTTTTTTTT=====TTTTTTTTTT',
];
export const SOLID = new Set(['T', '~', 'C', 'H', 'W', 'B', 'M', 'S']);
