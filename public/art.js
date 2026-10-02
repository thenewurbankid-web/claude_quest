// All art is drawn in code at GBA resolution: 16x16 tiles, limited palette, no image assets.
const TILE = { GRASS: 0, GRASS2: 1, PATH: 2, TREE: 3, WATER: 4, FLOWER_R: 5, FLOWER_Y: 6, TALL: 7 };
const SOLID_TILES = new Set([TILE.TREE, TILE.WATER]);

const Art = {
  canvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    draw((color, x, y, w = 1, h = 1) => { g.fillStyle = color; g.fillRect(x, y, w, h); }, g);
    return c;
  },

  shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  },

  grass(p, ox, variant) {
    p('#88d070', ox, 0, 16, 16);
    const dots = variant ? [[3, 4], [11, 2], [7, 11], [13, 12], [2, 13]] : [[4, 6], [12, 10]];
    for (const [x, y] of dots) { p('#68b850', ox + x, y, 1, 2); p('#68b850', ox + x + 2, y + 1, 1, 1); }
  },

  tiles() {
    return this.canvas(16 * 8, 16, p => {
      // 0, 1 grass
      this.grass(p, 0, false);
      this.grass(p, 16, true);
      // 2 path
      p('#e8d8a0', 32, 0, 16, 16);
      for (const [x, y] of [[2, 3], [9, 1], [13, 7], [5, 10], [11, 13], [1, 14]]) p('#d0bc80', 32 + x, y, 2, 1);
      // 3 tree
      this.grass(p, 48, false);
      const t = 48;
      p('#285830', t + 3, 1, 10, 1); p('#285830', t + 1, 2, 14, 9); p('#285830', t + 2, 11, 12, 1); p('#285830', t + 4, 12, 8, 1);
      p('#3c8c48', t + 2, 2, 12, 9); p('#3c8c48', t + 4, 1, 8, 1); p('#3c8c48', t + 3, 11, 10, 1);
      p('#58b060', t + 3, 2, 5, 3); p('#58b060', t + 9, 4, 3, 2); p('#58b060', t + 4, 7, 3, 2);
      p('#88d888', t + 4, 2, 2, 1);
      p('#285830', t + 6, 8, 2, 1); p('#285830', t + 10, 7, 2, 1);
      p('#604020', t + 6, 12, 4, 3); p('#805830', t + 7, 12, 2, 3); p('#406030', t + 4, 15, 8, 1);
      // 4 water
      p('#5890e8', 64, 0, 16, 16);
      p('#88b8f8', 64 + 2, 3, 5, 1); p('#88b8f8', 64 + 9, 8, 5, 1); p('#88b8f8', 64 + 3, 12, 4, 1);
      p('#4070c8', 64, 15, 16, 1);
      // 5, 6 flowers
      for (const [ox, petal] of [[80, '#f05858'], [96, '#f8d040']]) {
        this.grass(p, ox, false);
        for (const [x, y] of [[3, 3], [10, 9]]) {
          p(petal, ox + x, y, 3, 1); p(petal, ox + x, y + 2, 3, 1); p(petal, ox + x - 1, y + 1, 1, 1); p(petal, ox + x + 3, y + 1, 1, 1);
          p('#fff8c0', ox + x + 1, y + 1, 1, 1);
        }
      }
      // 7 tall grass
      this.grass(p, 112, false);
      for (let x = 0; x < 16; x += 4) {
        p('#409838', 112 + x, 6, 2, 8); p('#58b048', 112 + x + 1, 4, 1, 8); p('#409838', 112 + x + 2, 9, 2, 5);
      }
    });
  },

  // 4 directions x 3 frames (stand, step L, step R). Order: down, up, left, right.
  character({ hat, shirt, hair = '#503020', pants = '#384060', skin = '#f8d0a0', cap = true }) {
    const O = '#282830';
    return this.canvas(16 * 12, 16, p => {
      ['down', 'up', 'left', 'right'].forEach((dir, d) => {
        for (let f = 0; f < 3; f++) {
          const ox = (d * 3 + f) * 16;
          const q = (c, x, y, w = 1, h = 1) => p(c, ox + x, y, w, h);
          const bob = f ? 1 : 0;
          // head
          q(O, 4, 0 + bob, 8, 1); q(O, 3, 1 + bob, 1, 7); q(O, 12, 1 + bob, 1, 7); q(O, 4, 8 + bob, 8, 1);
          q(skin, 4, 1 + bob, 8, 7);
          if (cap) { q(hat, 4, 1 + bob, 8, 3); q(this.shade(hat, 0.7), 4, 3 + bob, 8, 1); }
          else q(hair, 4, 1 + bob, 8, 3);
          if (dir === 'up') q(hair, 4, 3 + bob, 8, 5);
          if (dir === 'left') { q(hair, 9, 3 + bob, 3, 4); q(O, 5, 5 + bob, 1, 2); if (cap) q(this.shade(hat, 0.7), 2, 3 + bob, 3, 1); }
          if (dir === 'right') { q(hair, 4, 3 + bob, 3, 4); q(O, 10, 5 + bob, 1, 2); if (cap) q(this.shade(hat, 0.7), 11, 3 + bob, 3, 1); }
          if (dir === 'down') { q(hair, 4, 3 + bob, 1, 3); q(hair, 11, 3 + bob, 1, 3); q(O, 6, 5 + bob, 1, 2); q(O, 9, 5 + bob, 1, 2); }
          // body
          q(O, 3, 9, 10, 1); q(O, 2, 10, 1, 3); q(O, 13, 10, 1, 3);
          q(shirt, 3, 9 + 1, 10, 3); q(this.shade(shirt, 0.75), 3, 12, 10, 1);
          if (dir === 'left' || dir === 'right') q(this.shade(shirt, 0.8), dir === 'left' ? 7 : 6, 10, 3, 2);
          else { q(skin, 3, 12, 1, 1); q(skin, 12, 12, 1, 1); }
          // legs
          const lL = f === 1 ? 1 : 2, rL = f === 2 ? 1 : 2;
          q(pants, 5, 13, 2, lL); q(O, 5, 13 + lL, 2, 1);
          q(pants, 9, 13, 2, rL); q(O, 9, 13 + rL, 2, 1);
        }
      });
    });
  },

  // A house: w x h tiles, roof in `color`, door at the middle bottom.
  house(wT, hT, color, { emblem, sign } = {}) {
    const W = wT * 16, H = hT * 16;
    return this.canvas(W, H, (p, g) => {
      const roofH = Math.round(H * 0.5);
      const dark = this.shade(color, 0.65), light = this.shade(color, 1.25);
      // roof
      p('#282830', 0, 2, W, roofH);
      p(color, 1, 3, W - 2, roofH - 2);
      for (let y = 6; y < roofH; y += 4) p(dark, 1, y, W - 2, 1);
      p(light, 1, 3, W - 2, 1);
      p('#282830', 2, 0, W - 4, 3); p(dark, 3, 1, W - 6, 2);
      // walls
      p('#282830', 1, roofH + 1, W - 2, H - roofH - 1);
      p('#f0e8d0', 2, roofH + 1, W - 4, H - roofH - 2);
      p('#d8d0b8', 2, H - 4, W - 4, 3);
      // windows
      const winY = roofH + 4;
      for (let x = 8; x < W - 12; x += 24) {
        if (Math.abs(x + 4 - W / 2) < 12) continue;
        p('#282830', x - 1, winY - 1, 10, 9); p('#88c0f0', x, winY, 8, 7); p('#c8e8ff', x + 1, winY + 1, 3, 2); p('#282830', x + 3, winY, 1, 7);
      }
      // door
      const dx = Math.floor(W / 2) - 5;
      p('#282830', dx - 1, H - 15, 12, 15); p('#704828', dx, H - 14, 10, 14); p('#905c30', dx + 1, H - 13, 3, 12); p('#f8d040', dx + 7, H - 8, 1, 2);
      if (emblem) {
        p('#fff', W / 2 - 7, 5, 14, 9);
        g.fillStyle = color; g.font = 'bold 8px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(emblem, W / 2, 10);
      }
      if (sign) {
        g.font = '6px monospace';
        const sw = Math.min(W - 10, Math.ceil(g.measureText(sign).width) + 6);
        p('#282830', Math.round(W / 2 - sw / 2) - 1, roofH - 3, sw + 2, 8); p('#f8f0d8', Math.round(W / 2 - sw / 2), roofH - 2, sw, 6);
        g.fillStyle = '#503818'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(sign, W / 2, roofH + 1, sw - 4);
      }
    });
  },

  sign() {
    return this.canvas(16, 16, p => {
      p('#282830', 1, 2, 14, 9); p('#c89048', 2, 3, 12, 7); p('#a87030', 2, 9, 12, 1);
      p('#704820', 4, 5, 8, 1); p('#704820', 4, 7, 6, 1);
      p('#282830', 7, 11, 2, 5); p('#805830', 7, 11, 1, 4);
    });
  },

  mailbox() {
    return this.canvas(16, 16, p => {
      p('#282830', 3, 1, 10, 8); p('#e04848', 4, 2, 8, 6); p('#f88080', 4, 2, 8, 1); p('#282830', 5, 5, 6, 1);
      p('#f8f8f8', 12, 2, 2, 3);
      p('#282830', 7, 9, 2, 7); p('#808088', 7, 9, 1, 6);
    });
  },

  board() {
    return this.canvas(16, 16, p => {
      p('#282830', 0, 1, 16, 11); p('#a07040', 1, 2, 14, 9);
      p('#f8f8f0', 2, 3, 5, 4); p('#f8e8a0', 8, 3, 5, 3); p('#c8e0f8', 3, 7, 6, 3); p('#e04848', 4, 3, 1, 1); p('#e04848', 10, 3, 1, 1);
      p('#282830', 2, 12, 2, 4); p('#282830', 12, 12, 2, 4);
    });
  },

  // Crisp pixel disc (canvas arcs antialias, this doesn't).
  disc(p, cx, cy, r, color) {
    for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y)); p(color, cx - w, cy + y, w * 2 + 1, 1); }
  },

  tent(color) {
    return this.canvas(32, 32, p => {
      const dark = this.shade(color, 0.6), light = this.shade(color, 1.2);
      for (let y = 0; y < 22; y++) {
        const half = Math.round(2 + y * 0.68);
        p('#282830', 16 - half - 1, 6 + y, half * 2 + 2, 1);
        p(color, 16 - half, 6 + y, half, 1); p(dark, 16, 6 + y, half, 1);
      }
      p(light, 15, 6, 2, 3);
      p('#282830', 13, 18, 6, 10); p('#3a2418', 14, 19, 4, 9);
      p('#806040', 15, 2, 2, 5); p('#f8d040', 17, 2, 4, 3);
      p('#406030', 2, 28, 28, 2);
    });
  },

  campfire(frame) {
    return this.canvas(16, 16, p => {
      p('#604020', 3, 12, 10, 2); p('#805830', 5, 11, 6, 1); p('#808088', 2, 13, 2, 2); p('#808088', 12, 13, 2, 2);
      const h = frame ? 7 : 6, o = frame ? 1 : 0;
      p('#f05828', 5 + o, 12 - h, 6, h); p('#f8a830', 6, 12 - h + 2, 4 - o, h - 2); p('#fff0a0', 7, 9, 2, 2);
    });
  },

  waystone(lit) {
    return this.canvas(16, 16, p => {
      p('#282830', 5, 1, 6, 13); p('#282830', 3, 13, 10, 3);
      p(lit ? '#58a8f8' : '#58607a', 6, 2, 4, 11); p(lit ? '#b8e8ff' : '#7a8098', 7, 3, 1, 6);
      p('#909098', 4, 14, 8, 1);
      if (lit) { p('#ffffff', 8, 5, 1, 1); p('#b8e8ff', 2, 4, 1, 1); p('#b8e8ff', 13, 7, 1, 1); }
    });
  },

  rift() {
    return this.canvas(16, 16, p => {
      this.disc(p, 8, 9, 6, '#401860'); this.disc(p, 8, 9, 4, '#8040c0'); this.disc(p, 8, 9, 2, '#d0a0ff'); p('#ffffff', 8, 9, 1, 1);
    });
  },

  statue() {
    return this.canvas(16, 16, p => {
      p('#282830', 3, 12, 10, 4); p('#a0a0a8', 4, 13, 8, 2);
      p('#282830', 5, 2, 6, 10); p('#c0c0c8', 6, 3, 4, 3); p('#a8a8b0', 6, 6, 4, 6); p('#e0e0e8', 6, 3, 1, 1);
      p('#f8d040', 7, 0, 2, 2);
    });
  },

  flower(color) {
    return this.canvas(16, 16, p => {
      p('#48a048', 7, 9, 1, 5); p('#48a048', 8, 11, 2, 1);
      p(color, 6, 6, 3, 1); p(color, 6, 8, 3, 1); p(color, 5, 7, 1, 1); p(color, 9, 7, 1, 1); p('#fff8c0', 7, 7, 1, 1);
    });
  },

  boss(kind) {
    return this.canvas(32, 32, p => {
      const O = '#181820';
      if (kind === 'question') { // the Waiting Sphinx
        p(O, 4, 10, 24, 20); p('#d8b868', 5, 11, 22, 18); p('#b89848', 5, 24, 22, 5);
        p(O, 9, 2, 14, 12); p('#e8c878', 10, 3, 12, 10); p('#3060c0', 8, 4, 3, 12); p('#3060c0', 21, 4, 3, 12);
        p(O, 12, 7, 2, 2); p(O, 18, 7, 2, 2); p(O, 14, 10, 4, 1);
        p('#ffffff', 14, 15, 4, 7); p('#3060c0', 15, 16, 2, 1); p('#3060c0', 16, 17, 1, 2); p('#3060c0', 15, 20, 1, 1);
      } else if (kind === 'failing') { // the Red Golem
        p(O, 6, 4, 20, 26); p('#b04040', 7, 5, 18, 24); p('#d06060', 8, 6, 6, 4); p('#802828', 7, 22, 18, 7);
        p(O, 2, 12, 5, 12); p('#a03838', 3, 13, 3, 10); p(O, 25, 12, 5, 12); p('#a03838', 26, 13, 3, 10);
        p('#ffe040', 11, 11, 3, 1); p('#ffe040', 12, 10, 1, 3); p('#ffe040', 19, 11, 3, 1); p('#ffe040', 20, 10, 1, 3);
        p(O, 13, 17, 7, 2); p('#ffe040', 10, 24, 1, 1); p('#ffe040', 21, 26, 1, 1);
      } else if (kind === 'looping') { // the Ouroboros Wyrm
        this.disc(p, 16, 17, 14, O); this.disc(p, 16, 17, 13, '#7048b0'); this.disc(p, 16, 17, 8, O); this.disc(p, 16, 17, 7, 'rgba(0,0,0,0)');
        for (let a = 0; a < 6; a++) { const x = 16 + Math.round(Math.cos(a) * 10), y = 17 + Math.round(Math.sin(a) * 10); p('#9878d8', x, y, 2, 2); }
        p(O, 22, 3, 8, 7); p('#8058c8', 23, 4, 6, 5); p('#ffe040', 26, 5, 2, 2); p(O, 27, 6, 1, 1); p('#f8f8f8', 23, 8, 1, 2);
      } else { // the Stalling Fog
        this.disc(p, 10, 18, 8, '#606070'); this.disc(p, 20, 15, 10, '#606070'); this.disc(p, 22, 22, 7, '#606070');
        this.disc(p, 10, 18, 7, '#9898a8'); this.disc(p, 20, 15, 9, '#a8a8b8'); this.disc(p, 22, 22, 6, '#9898a8');
        p(O, 15, 13, 3, 3); p(O, 22, 13, 3, 3); p('#ffffff', 16, 13, 1, 1); p('#ffffff', 23, 13, 1, 1); p(O, 17, 19, 6, 1);
      }
    });
  },

  dot(color, w = 2, h = 2) { return this.canvas(w, h, p => p(color, 0, 0, w, h)); },

  bubble(ch, color) {
    return this.canvas(10, 12, (p, g) => {
      p('#282830', 1, 0, 8, 10); p('#282830', 0, 1, 10, 8); p('#fff', 1, 1, 8, 8); p('#282830', 4, 10, 2, 2);
      g.fillStyle = color; g.font = 'bold 8px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 5, 5.5);
    });
  },
};
