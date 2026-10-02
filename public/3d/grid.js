// Grid interface for the 2.5D view. Game logic talks in cells; only a grid knows where a cell sits in the world.
// Square first. A HexGrid with the same methods can be added later for hex regions (HANDOFF "Art direction").
export class SquareGrid {
  constructor(cols, rows, size = 1) { this.cols = cols; this.rows = rows; this.size = size; this.kind = 'square'; }
  key(c, r) { return `${c},${r}`; }
  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  // Cell centre in world space (x right, z down the map), with the grid centred on the origin.
  toWorld(c, r) { return { x: (c - (this.cols - 1) / 2) * this.size, z: (r - (this.rows - 1) / 2) * this.size }; }
  fromWorld(x, z) { return { c: Math.round(x / this.size + (this.cols - 1) / 2), r: Math.round(z / this.size + (this.rows - 1) / 2) }; }
  neighbors(c, r) { return [[c, r - 1], [c + 1, r], [c, r + 1], [c - 1, r]].filter(([a, b]) => this.inside(a, b)); }
  step(c, r, dir) { const d = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[dir]; return [c + d[0], r + d[1]]; }
  // Facing angle (radians around Y) for a move direction, so models turn toward where they walk.
  heading(dir) { return { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[dir]; }
}
