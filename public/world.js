// Claude Quest overworld. Projects are areas, worktrees are camps, every live Claude session
// walks the world, blockers are bosses, and the usage limit brings the Long Night.
const T = 16, MW = 96, MH = 72;
const HUB = { x: 48, y: 34 };
const TOWN_SLOTS = [[24, 14], [72, 14], [24, 58], [72, 58], [48, 12]];
const DIRS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };
const OPP = { down: 'up', up: 'down', left: 'right', right: 'left' };
const KEY_DIR = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', s: 'down', w: 'up', a: 'left', d: 'right' };
const KIND_TAG = {
  boss: ['BOSS', '#c04040'], victory: ['WIN', '#d0a020'], step: ['HIT', '#d97757'], reply: ['CLAUDE', '#d97757'],
  update: ['NEWS', '#4878b8'], commit: ['GIT', '#489868'], story: ['TALE', '#8858c8'], sent: ['SENT', '#888'],
  delivered: ['READ', '#38a0a0'], run: ['WAKE', '#d97757'], badge: ['BADGE', '#d0a020'], night: ['NIGHT', '#283878'], dawn: ['DAWN', '#e0a040'],
};
const ROLE_LOOK = {
  scout: { hat: '#e0a020', shirt: '#48a048' },
  historian: { cap: false, hair: '#d0d0d0', shirt: '#806048', pants: '#504038' },
  guide: { hat: '#f0f0f0', shirt: '#e8e8e8', pants: '#406080' },
  messenger: { hat: '#3060c0', shirt: '#4070d0' },
  clerk: { cap: false, hair: '#e07050', shirt: '#f0a0b0', pants: '#f0a0b0' },
  player: { hat: '#e03030', shirt: '#3050c0', pants: '#303850' },
  claude: { cap: false, hair: '#c05a38', shirt: '#d97757', pants: '#6a4030', skin: '#f8d8b0' },
  courier: { hat: '#3868c8', shirt: '#f8c838', pants: '#384060' },
  cartographer: { hat: '#6a4a2a', shirt: '#c8a060', pants: '#504038' },
};
const CLAUDE_BUBBLE = { question: '?', failing: '!', stalled: '…', sleeping: 'Z', looping: '@' };
const CLAUDE_LINE = {
  working: 'is hard at work',
  idle: 'is resting between quests',
  question: 'is waiting for your answer',
  failing: 'is wrestling with failing checks',
  looping: 'is walking in circles',
  stalled: 'went quiet mid-step',
  sleeping: 'is fast asleep',
};

let WORLD = null;
const S = {
  scene: null, grid: null, at: new Map(), dyn: new Map(), dynAt: new Map(), npcs: [], signs: [],
  player: null, px: 0, py: 0, facing: 'down', moving: false, held: new Map(), area: null,
  areas: [], camps: {}, auto: false, path: [], lastInput: performance.now(), couriers: [], courierBusy: false,
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const seen = store.get('cq-seen', { news: {}, missions: [] });
const attuned = new Set(store.get('cq-attuned', ['hub']));
const campSlots = store.get('cq-camp-slots', {});
const saveSeen = () => store.set('cq-seen', seen);

const town = id => WORLD.towns.find(t => t.id === id);
const ago = iso => {
  if (!iso) return 'a while ago';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const until = iso => { const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60e3)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const api = (url, body) => Net.post(url, body); // local server, encrypted link, or the browser save (public/net.js)
const short = (s, n = 70) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const key = (x, y) => `${x},${y}`;
const isNight = () => !!WORLD.night;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- world layout (static) ----------
function campSlotsFor(cx, cy) {
  const dir = cx < HUB.x ? -1 : cx > HUB.x ? 1 : 0;
  if (dir) return [[cx + dir * 12, cy - 3], [cx + dir * 12, cy + 4], [cx + dir * 20, cy - 3], [cx + dir * 20, cy + 4]];
  return [[cx - 12, cy - 3], [cx + 12, cy - 3], [cx - 12, cy + 4], [cx + 12, cy + 4]];
}

function buildLayout(towns) {
  const g = [...Array(MH)].map(() => Array(MW).fill(TILE.GRASS));
  const keep = [...Array(MH)].map(() => Array(MW).fill(false));
  const reserved = new Set();
  const objs = [];
  const R = rng(11);
  const inb = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
  const clear = (cx, cy, rx, ry) => { for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (inb(x, y)) keep[y][x] = true; };
  const path = (x, y) => { if (inb(x, y)) { g[y][x] = TILE.PATH; keep[y][x] = true; } };
  const hline = (x0, x1, y, w = 2) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + w - 1; x++) for (let k = 0; k < w; k++) path(x, y + k); };
  const vline = (x, y0, y1, w = 2) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let k = 0; k < w; k++) path(x + k, y); };
  const reserve = (x, y, w = 1, h = 1) => { for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) reserved.add(key(x + dx, y + dy)); };

  // Hub: the Claude Center.
  clear(HUB.x, HUB.y + 1, 9, 6);
  objs.push({ kind: 'building', x: 45, y: 30, w: 6, h: 4, tex: 'center', door: [48, 33], label: 'center' });
  vline(48, 34, HUB.y + 5);
  objs.push({ kind: 'npc', role: 'clerk', x: 46, y: 35 });
  objs.push({ kind: 'mailbox', x: 51, y: 34 });
  objs.push({ kind: 'board', x: 44, y: 34 });
  objs.push({ kind: 'waystone', x: 51, y: 37, stone: 'hub' });
  objs.push({ kind: 'npc', role: 'cartographer', x: 54, y: 36 });
  S.areas.push({ id: 'hub', name: 'Claude Center', x0: HUB.x - 9, x1: HUB.x + 9, y0: HUB.y - 5, y1: HUB.y + 7, spawn: [48, 36] });

  towns.forEach((t, i) => {
    const [cx, cy] = TOWN_SLOTS[i % TOWN_SLOTS.length];
    t._cx = cx; t._cy = cy;
    clear(cx, cy, 8, 6);
    const vx = cx > HUB.x ? cx - 6 : cx + 5;
    hline(HUB.x, vx, HUB.y + 5);
    vline(vx, HUB.y + 5, cy + 1);
    hline(cx, vx, cy + 1);
    vline(cx, cy - 1, cy + 1);
    objs.push({ kind: 'building', x: cx - 2, y: cy - 4, w: 5, h: 3, tex: `house-${t.id}`, door: [cx, cy - 2], town: t.id });
    objs.push({ kind: 'sign', x: cx - 2, y: cy - 1, town: t.id });
    objs.push({ kind: 'npc', role: 'scout', x: cx + 4, y: cy, town: t.id });
    objs.push({ kind: 'npc', role: 'historian', x: cx - 4, y: cy, town: t.id });
    objs.push({ kind: 'npc', role: 'guide', x: cx + 4, y: cy + 3, town: t.id });
    objs.push({ kind: 'npc', role: 'messenger', x: cx - 3, y: cy + 3, town: t.id });
    objs.push({ kind: 'waystone', x: cx - 1, y: cy + 4, stone: t.id, town: t.id });
    objs.push({ kind: 'rift', x: cx + 1, y: cy + 4, town: t.id });
    reserve(cx + 2, cy - 1, 2, 2); // boss lair
    S.areas.push({ id: t.id, name: t.townName, x0: cx - 8, x1: cx + 8, y0: cy - 6, y1: cy + 6, spawn: [cx, cy + 2], town: t.id });

    // Worktree camps: four fixed clearings on the outer side, joined to the plaza by footpaths.
    t._camps = campSlotsFor(cx, cy).map(([kx, ky], slot) => {
      clear(kx, ky, 4, 3);
      const jx = cx + Math.sign(kx - cx) * 6;
      hline(kx, jx, ky + 2, 1);
      vline(jx, ky + 2, cy + 1, 1);
      hline(Math.min(jx, cx), Math.max(jx, cx), cy + 1, 1);
      reserve(kx - 1, ky - 1, 2, 2); reserve(kx + 1, ky); reserve(kx - 2, ky + 1); reserve(kx - 1, ky - 3, 2, 2);
      S.areas.push({ id: `${t.id}#${slot}`, name: 'Camp', x0: kx - 4, x1: kx + 4, y0: ky - 3, y1: ky + 3, spawn: [kx, ky + 2], town: t.id, slot });
      return { slot, kx, ky };
    });
  });

  for (let y = 44; y <= 46; y++) for (let x = 58; x <= 63; x++) { g[y][x] = TILE.WATER; keep[y][x] = true; }

  const occupied = new Set(objs.flatMap(o => { const c = []; for (let dy = 0; dy < (o.h || 1); dy++) for (let dx = 0; dx < (o.w || 1); dx++) c.push(key(o.x + dx, o.y + dy)); return c; }));
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const border = x < 2 || y < 2 || x >= MW - 2 || y >= MH - 2;
    const r = R();
    if (border) { g[y][x] = TILE.TREE; continue; }
    if (g[y][x] !== TILE.GRASS) continue;
    if (!keep[y][x]) g[y][x] = r < 0.58 ? TILE.TREE : r < 0.72 ? TILE.TALL : r < 0.85 ? TILE.GRASS2 : TILE.GRASS;
    else if (!occupied.has(key(x, y)) && !reserved.has(key(x, y))) g[y][x] = r < 0.03 ? TILE.FLOWER_R : r < 0.06 ? TILE.FLOWER_Y : r < 0.2 ? TILE.GRASS2 : TILE.GRASS;
  }
  return { g, objs, reserved };
}

const areaAt = (x, y) => {
  // Camps first: they sit at the edges of town clearings.
  const hits = S.areas.filter(a => x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1);
  return hits.find(a => a.slot !== undefined) || hits[0] || null;
};

// ---------- scene ----------
function create() {
  const sc = S.scene = this;
  sc.textures.addCanvas('tiles', Art.tiles());
  const sheet = (k, look) => { const tex = sc.textures.addCanvas(k, Art.character(look)); for (let i = 0; i < 12; i++) tex.add(i, 0, i * 16, 0, 16, 16); };
  for (const [role, look] of Object.entries(ROLE_LOOK)) sheet(`char-${role}`, look);
  sc.textures.addCanvas('center', Art.house(6, 4, '#d97757', { emblem: 'CC' }));
  for (const t of WORLD.towns) {
    sc.textures.addCanvas(`house-${t.id}`, Art.house(5, 3, t.color, { sign: t.name.toUpperCase() }));
    sc.textures.addCanvas(`tent-${t.id}`, Art.tent(t.color));
    sc.textures.addCanvas(`hamlet-${t.id}`, Art.house(2, 2, t.color));
  }
  for (const [k, c] of Object.entries({
    sign: Art.sign(), mailbox: Art.mailbox(), board: Art.board(), rift: Art.rift(), statue: Art.statue(),
    'stone-lit': Art.waystone(true), 'stone-dark': Art.waystone(false), fire0: Art.campfire(0), fire1: Art.campfire(1),
    'flower-r': Art.flower('#f05858'), 'flower-y': Art.flower('#f8d040'), 'flower-p': Art.flower('#c878f0'),
    spark: Art.dot('#ffffff'), drop: Art.dot('#a8c8ff', 1, 4), star: Art.dot('#ffffff', 1, 1),
  })) sc.textures.addCanvas(k, c);
  for (const kind of ['question', 'failing', 'looping', 'stalled']) sc.textures.addCanvas(`boss-${kind}`, Art.boss(kind));
  for (let f = 0; f < 3; f++) sc.textures.addCanvas(`spirit${f}`, Art.spirit(f));
  sc.textures.addCanvas('halo', Art.glow(14, 'rgba(168,240,248,0.55)'));
  sc.textures.addCanvas('mote', Art.glow(3, 'rgba(232,252,255,1)'));
  sc.textures.addCanvas('ember', Art.glow(3, 'rgba(248,192,96,1)'));
  for (const [ch, color] of [['!', '#e04040'], ['?', '#3060c0'], ['…', '#606060'], ['Z', '#5868a8'], ['@', '#8058c8'], ['♪', '#d97757']]) sc.textures.addCanvas(`bub-${ch}`, Art.bubble(ch, color));

  const { g, objs, reserved } = buildLayout(WORLD.towns);
  S.objs = objs;
  S.reserved = reserved;
  S.tiles = g;
  S.grid = g.map(row => row.map(tile => SOLID_TILES.has(tile)));
  const map = sc.make.tilemap({ data: g, tileWidth: T, tileHeight: T });
  map.createLayer(0, map.addTilesetImage('tiles', 'tiles', T, T, 0, 0), 0, 0);

  for (const o of objs) {
    const w = o.w || 1, h = o.h || 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) { S.grid[o.y + dy][o.x + dx] = true; S.at.set(key(o.x + dx, o.y + dy), o); }
    if (o.kind === 'building') {
      sc.add.image(o.x * T, o.y * T, o.tex).setOrigin(0).setDepth((o.y + h) * T);
      S.at.set(key(o.door[0], o.door[1]), { ...o, kind: 'door' });
    } else if (o.kind === 'npc') {
      o.sprite = sc.add.sprite(o.x * T, o.y * T - 2, `char-${o.role}`, 0).setOrigin(0).setDepth(o.y * T + 8);
      o.bubble = bubbleFor(o.x, o.y);
      S.npcs.push(o);
    } else {
      const tex = o.kind === 'waystone' ? 'stone-lit' : o.kind;
      o.sprite = sc.add.image(o.x * T, o.y * T, tex).setOrigin(0).setDepth(o.y * T + 8);
      if (o.kind === 'sign') { o.bubble = bubbleFor(o.x, o.y + 0.15); S.signs.push(o); }
      if (o.kind === 'waystone') S.signs.push(o);
      if (o.kind === 'rift') sc.tweens.add({ targets: o.sprite, alpha: 0.6, duration: 900, yoyo: true, repeat: -1 });
    }
  }

  // Precompute walkable tiles per area for Claudes, flowers and statues.
  for (const a of S.areas) {
    a.free = [];
    for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) {
      if (S.grid[y]?.[x] === false && !S.reserved.has(key(x, y))) a.free.push([x, y]);
    }
  }

  const saved = store.get('cq-pos', null);
  [S.px, S.py] = saved && S.grid[saved[1]]?.[saved[0]] === false ? saved : [HUB.x, HUB.y + 2];
  S.player = sc.add.sprite(S.px * T, S.py * T - 2, 'char-player', 0).setOrigin(0).setDepth(S.py * T + 9);
  S.playerBubble = sc.add.image(0, 0, 'bub-!').setOrigin(0).setDepth(9999).setVisible(false);
  sc.cameras.main.setBounds(0, 0, MW * T, MH * T).startFollow(S.player, true).setRoundPixels(true);

  // Weather and night live in screen space.
  S.rain = sc.add.particles(0, 0, 'drop', {
    x: { min: -20, max: 260 }, y: -6, lifespan: 700, speedY: { min: 220, max: 280 }, speedX: -40,
    quantity: 2, frequency: 25, alpha: 0.7, emitting: false,
  }).setScrollFactor(0).setDepth(9500);
  S.nightVeil = sc.add.rectangle(0, 0, 240, 160, 0x0a1040, 0.55).setOrigin(0).setScrollFactor(0).setDepth(9400).setVisible(false);
  S.stars = Array.from({ length: 18 }, (_, i) => {
    const r = rng(i * 97 + 5);
    const st = sc.add.image(Math.floor(r() * 240), Math.floor(r() * 70), 'star').setScrollFactor(0).setDepth(9401).setVisible(false);
    sc.tweens.add({ targets: st, alpha: 0.2, duration: 600 + r() * 900, yoyo: true, repeat: -1 });
    return st;
  });
  S.burst = sc.add.particles(0, 0, 'spark', {
    speed: { min: 40, max: 110 }, lifespan: 900, gravityY: 70, scale: { start: 1.5, end: 0.5 },
    tint: [0xf05858, 0xf8d040, 0x58a8f8, 0xd97757, 0x78e078], emitting: false,
  }).setDepth(9600);

  sc.time.addEvent({ delay: 650, loop: true, callback: tickNpcs });
  sc.time.addEvent({ delay: 1000, loop: true, callback: () => { hud(); fireFlicker(); } });
  sc.time.addEvent({ delay: 250, loop: true, callback: () => { flushAnswers(); guide(); } });
  sc.time.addEvent({ delay: 200, loop: true, callback: () => MapView.tickMini() });

  syncDynamic();
  refreshMarkers();
  applyNight();
  checkArea();
  hud();
  document.getElementById('boot')?.remove();
}

function bubbleFor(x, y) {
  const b = S.scene.add.image(x * T + 3, y * T - 14, 'bub-!').setOrigin(0).setDepth(9999).setVisible(false);
  S.scene.tweens.add({ targets: b, y: b.y - 2, duration: 400, yoyo: true, repeat: -1, ease: 'Stepped' });
  return b;
}

// ---------- dynamic world: camps, Claudes, bosses, flowers, statues ----------
function placeDyn(id, ent) {
  S.dyn.set(id, ent);
  for (const [x, y] of ent.tiles || []) S.dynAt.set(key(x, y), ent);
}
function removeDyn(id) {
  const ent = S.dyn.get(id);
  if (!ent) return;
  for (const sp of ent.sprites || []) sp.destroy();
  ent.bubble?.destroy(); ent.hpBar?.destroy();
  for (const [k, v] of S.dynAt) if (v === ent) S.dynAt.delete(k);
  S.dyn.delete(id);
}
const blocked = (x, y, self) => {
  if (S.grid[y]?.[x] !== false) return true;
  const d = S.dynAt.get(key(x, y));
  if (d && d !== self && d.solid) return true;
  if (self && S.px === x && S.py === y) return true;
  return false;
};

function campArea(t, slot) { return S.areas.find(a => a.town === t.id && a.slot === slot); }

function assignCampSlots(t) {
  const map = campSlots[t.id] ??= {};
  const live = new Set(t.camps.map(c => c.id));
  for (const id of Object.keys(map)) if (!live.has(id)) delete map[id];
  for (const c of t.camps) {
    if (map[c.id] !== undefined) continue;
    const used = new Set(Object.values(map));
    const free = [0, 1, 2, 3].find(s => !used.has(s));
    if (free !== undefined) map[c.id] = free;
  }
  store.set('cq-camp-slots', campSlots);
  return map;
}

function syncDynamic() {
  const sc = S.scene;
  const want = new Set();
  for (const t of WORLD.towns) {
    const tArea = S.areas.find(a => a.id === t.id);
    tArea.name = t.townName;
    const slots = assignCampSlots(t);
    const campBySlot = {};
    for (const c of t.camps) {
      const slot = slots[c.id];
      if (slot === undefined) continue;
      campBySlot[c.id] = slot;
      const { kx, ky } = t._camps[slot];
      const area = campArea(t, slot);
      area.name = `${c.kind === 'hamlet' ? 'Hamlet' : 'Camp'} ${c.label}`;
      area.camp = c.id;
      const id = `camp-${c.id}-${c.kind}`;
      want.add(id);
      if (!S.dyn.has(id)) {
        for (const k of [...S.dyn.keys()]) if (k.startsWith(`camp-${c.id}-`) && k !== id) removeDyn(k);
        const home = sc.add.image((kx - 1) * T, (ky - 1) * T, `${c.kind}-${t.id}`).setOrigin(0).setDepth((ky + 1) * T);
        const fire = sc.add.image((kx + 1) * T, ky * T, 'fire0').setOrigin(0).setDepth(ky * T + 8);
        const sign = sc.add.image((kx - 2) * T, (ky + 1) * T, 'sign').setOrigin(0).setDepth((ky + 1) * T + 8);
        placeDyn(id, { kind: 'camp', town: t.id, camp: c.id, slot, solid: true, sprites: [home, fire, sign], fire,
          tiles: [[kx - 1, ky - 1], [kx, ky - 1], [kx - 1, ky], [kx, ky], [kx + 1, ky], [kx - 2, ky + 1]] });
      }
    }

    // Bosses: the first one at each place stands in its lair.
    const lairTaken = new Set();
    for (const b of t.bosses) {
      const where = b.location === 'town' || campBySlot[b.location] === undefined ? 'town' : b.location;
      if (lairTaken.has(where)) continue;
      lairTaken.add(where);
      const [bx, by] = where === 'town' ? [t._cx + 2, t._cy - 1] : [t._camps[campBySlot[where]].kx - 1, t._camps[campBySlot[where]].ky - 3];
      const id = `boss-${b.id}`;
      want.add(id);
      let ent = S.dyn.get(id);
      if (!ent) {
        const sp = sc.add.image(bx * T, by * T, `boss-${b.kind}`).setOrigin(0).setDepth((by + 2) * T);
        sc.tweens.add({ targets: sp, y: sp.y - 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        ent = { kind: 'boss', town: t.id, boss: b.id, solid: true, sprites: [sp], sprite: sp, hpBar: sc.add.graphics().setDepth(9998),
          tiles: [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]], bx, by };
        placeDyn(id, ent);
      }
      ent.hpBar.clear();
      const frac = b.hp / (b.maxHp || 1);
      ent.hpBar.fillStyle(0x282830).fillRect(bx * T + 2, by * T - 6, 28, 4);
      ent.hpBar.fillStyle(frac > 0.5 ? 0x58c058 : frac > 0.2 ? 0xe0b030 : 0xe05038).fillRect(bx * T + 3, by * T - 5, Math.max(frac ? 2 : 0, Math.round(26 * frac)), 2);
    }

    // Claudes: one per live session, living where it works.
    t.claudes.forEach((c, i) => {
      const area = c.location === 'town' || campBySlot[c.location] === undefined ? tArea : campArea(t, campBySlot[c.location]);
      const id = `claude-${c.sid}`;
      want.add(id);
      let ent = S.dyn.get(id);
      if (!ent || ent.area !== area) {
        removeDyn(id);
        const anchor = area === tArea ? [t._cx + 1, t._cy] : [t._camps[campBySlot[c.location]].kx + 1, t._camps[campBySlot[c.location]].ky + 1];
        const spots = area.free.slice().sort((a, b) => Math.hypot(a[0] - anchor[0], a[1] - anchor[1]) - Math.hypot(b[0] - anchor[0], b[1] - anchor[1]));
        const home = spots.find(([x, y]) => !blocked(x, y) && !(x === S.px && y === S.py)) || spots[0];
        const sp = sc.add.sprite(home[0] * T, home[1] * T - 2, 'char-claude', 0).setOrigin(0).setDepth(home[1] * T + 8);
        ent = { kind: 'claude', town: t.id, sid: c.sid, area, home, x: home[0], y: home[1], solid: true, sprites: [sp], sprite: sp, bubble: bubbleFor(home[0], home[1]), facing: 'down', loopStep: 0 };
        placeDyn(id, ent);
        ent.tiles = [[ent.x, ent.y]];
        S.dynAt.set(key(ent.x, ent.y), ent);
      }
      ent.data = c;
      ent.sprite.setTint(c.state === 'sleeping' ? 0x9090c0 : 0xffffff);
    });

    // Flowers bloom with commits; statues rise for victories.
    const decor = tArea.free.filter(([x, y]) => S.tiles[y][x] !== TILE.PATH);
    const order = decor.map((p, i) => [p, rng(i * 31 + t.id.length)()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    for (let i = 0; i < t.flowers; i++) {
      const id = `flower-${t.id}-${i}`;
      want.add(id);
      if (S.dyn.has(id) || !order[i]) continue;
      const [x, y] = order[i];
      const sp = sc.add.image(x * T, y * T, ['flower-r', 'flower-y', 'flower-p'][i % 3]).setOrigin(0).setDepth(y * T + 1);
      placeDyn(id, { kind: 'flower', solid: false, sprites: [sp], tiles: [] });
      if (S.area === t.id) { sp.setScale(0.1); sc.tweens.add({ targets: sp, scale: 1, duration: 500, ease: 'Back.out' }); }
    }
    for (let i = 0; i < t.statues; i++) {
      const id = `statue-${t.id}-${i}`;
      want.add(id);
      if (S.dyn.has(id)) continue;
      const spot = order[order.length - 1 - i];
      if (!spot) continue;
      const [x, y] = spot;
      const sp = sc.add.image(x * T, y * T, 'statue').setOrigin(0).setDepth(y * T + 8);
      placeDyn(id, { kind: 'statue', town: t.id, solid: true, sprites: [sp], tiles: [[x, y]] });
    }
  }
  for (const id of [...S.dyn.keys()]) if (!want.has(id)) removeDyn(id);
}

function fireFlicker() {
  for (const e of S.dyn.values()) if (e.fire) e.fire.setTexture(e.fire.texture.key === 'fire0' ? 'fire1' : 'fire0');
}

// Claudes act out their real state.
function tickNpcs() {
  if (!WORLD) return;
  for (const e of S.dyn.values()) {
    if (e.kind !== 'claude' || e.moving) continue;
    const st = e.data.state;
    const stopped = town(e.town)?.stopped;
    const mark = stopped ? '…' : CLAUDE_BUBBLE[st];
    e.bubble.setPosition(e.x * T + 3, e.y * T - 14).setVisible(!!mark);
    if (mark) e.bubble.setTexture(`bub-${mark}`);
    if (UI.open && Math.abs(e.x - S.px) + Math.abs(e.y - S.py) <= 1) continue;
    if (stopped || st === 'sleeping' || st === 'question' || st === 'stalled') { if (st === 'sleeping') e.sprite.setFrame(0); continue; }
    if (st === 'looping') {
      const loop = ['right', 'down', 'left', 'up'];
      moveEntity(e, loop[Math.floor(e.loopStep++ / 1) % 4]);
    } else if (st === 'failing') {
      moveEntity(e, e.loopStep++ % 2 ? 'left' : 'right');
    } else if (st === 'working' && Math.random() < 0.6) {
      const dirs = Object.keys(DIRS).filter(d => { const [dx, dy] = DIRS[d]; return e.area.free.some(([x, y]) => x === e.x + dx && y === e.y + dy); });
      if (dirs.length) moveEntity(e, dirs[Math.floor(Math.random() * dirs.length)]);
    } else if (Math.random() < 0.25) face(e, Object.keys(DIRS)[Math.floor(Math.random() * 4)]);
  }
}

function moveEntity(e, dir, ms = 220) {
  const [dx, dy] = DIRS[dir];
  face(e, dir);
  const nx = e.x + dx, ny = e.y + dy;
  if (blocked(nx, ny, e)) return false;
  S.dynAt.delete(key(e.x, e.y));
  e.x = nx; e.y = ny; e.tiles = [[nx, ny]];
  S.dynAt.set(key(nx, ny), e);
  e.moving = true;
  e.sprite.setFrame(DIR_INDEX[dir] * 3 + 1 + (e.step = (e.step || 0) ^ 1));
  S.scene.tweens.add({ targets: e.sprite, x: nx * T, y: ny * T - 2, duration: ms, onComplete: () => { e.moving = false; e.sprite.setFrame(DIR_INDEX[dir] * 3).setDepth(ny * T + 8); } });
  return true;
}

function face(o, dir) { o.facing = dir; o.sprite.setFrame(DIR_INDEX[dir] * 3); }

// ---------- player movement, autoplay ----------
function update(time) {
  if (!S.player) return;
  S.playerBubble.setPosition(S.player.x + 3, S.player.y - 12);
  if (UI.open || S.moving || S.warping) return;
  let dir = null, newest = -1;
  for (const [d, t] of S.held) if (t > newest) { newest = t; dir = d; }
  if (!dir && S.queued) { dir = S.queued; S.turnedAt = 0; }
  S.queued = null;
  if (!dir && S.auto) return autoStep(time);
  if (!dir) return maybeStartAuto();
  if (S.facing !== dir) { S.facing = dir; S.player.setFrame(DIR_INDEX[dir] * 3); S.turnedAt = time; }
  if (time - (S.turnedAt || 0) < 90) return;
  stepPlayer(dir, time);
}

function stepPlayer(dir, time = S.scene.time.now) {
  const [dx, dy] = DIRS[dir];
  S.facing = dir;
  const nx = S.px + dx, ny = S.py + dy;
  if (blocked(nx, ny)) {
    S.player.setFrame(DIR_INDEX[dir] * 3);
    if (!S.auto && time - (S.lastBump || 0) > 300) { Sound.bump(); S.lastBump = time; }
    return false;
  }
  S.moving = true;
  S.step = (S.step || 0) % 2 + 1;
  S.player.setFrame(DIR_INDEX[dir] * 3 + S.step);
  S.scene.tweens.add({
    targets: S.player, x: nx * T, y: ny * T - 2, duration: S.auto ? 170 : 140,
    onComplete: () => {
      S.px = nx; S.py = ny;
      S.player.setDepth(ny * T + 9).setFrame(DIR_INDEX[dir] * 3);
      S.moving = false;
      store.set('cq-pos', [S.px, S.py]);
      checkArea();
    },
  });
  return true;
}

function bfs(from, goalFn, maxNodes = 6000) {
  const start = key(...from);
  const prev = new Map([[start, null]]);
  const q = [from];
  while (q.length && prev.size < maxNodes) {
    const [x, y] = q.shift();
    if (goalFn(x, y) && !(x === from[0] && y === from[1])) {
      const path = [];
      for (let k = key(x, y); k; k = prev.get(k)) path.unshift(k.split(',').map(Number));
      return path;
    }
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || blocked(nx, ny)) continue;
      prev.set(k, key(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

function maybeStartAuto() {
  const sec = WORLD.save?.settings.autoplaySec ?? 60;
  if (sec > 0 && performance.now() - S.lastInput > sec * 1e3 && !S.auto) { S.auto = true; S.path = []; hud(); }
}

// Autoplay: wander toward wherever Claude is busy, glance at things, never answer anything.
function autoStep() {
  if (!S.path.length) {
    if (S.autoPause && performance.now() < S.autoPause) return;
    const busy = [...S.dyn.values()].filter(e => e.kind === 'claude' && e.data.state === 'working');
    const spots = busy.length && Math.random() < 0.7
      ? busy.map(e => [e.x, e.y])
      : S.areas.filter(a => a.slot === undefined || a.camp).map(a => a.spawn);
    const target = spots[Math.floor(Math.random() * spots.length)];
    const path = bfs([S.px, S.py], (x, y) => Math.abs(x - target[0]) + Math.abs(y - target[1]) <= 1);
    S.path = path ? path.slice(1) : [];
    if (!S.path.length) { S.autoPause = performance.now() + 2000; return; }
  }
  const [nx, ny] = S.path[0];
  const dir = Object.keys(DIRS).find(d => S.px + DIRS[d][0] === nx && S.py + DIRS[d][1] === ny);
  if (!dir || !stepPlayer(dir)) { S.path = []; return; }
  S.path.shift();
  if (!S.path.length) {
    // Arrived: look at whoever is here for a moment.
    const near = [...S.dyn.values(), ...S.npcs].find(e => e.sprite && Math.abs((e.x ?? 0) - nx) + Math.abs((e.y ?? 0) - ny) === 1);
    if (near) { const d = Object.keys(DIRS).find(k => nx + DIRS[k][0] === near.x && ny + DIRS[k][1] === near.y); if (d) setTimeout(() => S.player.setFrame(DIR_INDEX[d] * 3), 200); }
    S.autoPause = performance.now() + 2500 + Math.random() * 3000;
  }
}

function stopAuto() { if (S.auto) { S.auto = false; S.path = []; hud(); } S.lastInput = performance.now(); }

function checkArea() {
  const a = areaAt(S.px, S.py);
  if (a && a.id !== S.area) {
    UI.banner(a.name);
    if (a.slot === undefined && a.id !== 'hub') attune(a.id, true);
  }
  S.area = a?.id ?? null;
  weather();
}

function weather() {
  const a = S.areas.find(x => x.id === S.area);
  const t = a?.town && town(a.town);
  const storm = t && t.bosses.some(b => b.kind !== 'question');
  S.rain.emitting = !!storm && !isNight();
}

function applyNight() {
  const n = isNight();
  S.nightVeil.setVisible(n);
  for (const s of S.stars) s.setVisible(n);
  for (const o of S.signs) if (o.kind === 'waystone') o.sprite.setTexture(n || !attuned.has(o.stone) ? 'stone-dark' : 'stone-lit');
  weather();
}

function hud() {
  const parts = [];
  if (WORLD?.night) parts.push(`🌙 The Long Night · dawn in ${until(WORLD.night.until)}`);
  if (S.auto) parts.push('AUTO ▶ (any key to take over)');
  const awake = (WORLD?.runs || []).filter(r => r.status === 'running').length;
  if (awake) parts.push(`${awake} woken Claude${awake > 1 ? 's' : ''} at work`);
  const q = WORLD ? WORLD.towns.reduce((n, t) => n + t.decisions.filter(d => d.source === 'claude').length, 0) : 0;
  if (q) parts.push(`${q} riddle${q > 1 ? 's' : ''} waiting`);
  if (!parts.length) parts.push('Arrows move · Z talk · Enter menu · M map · N minimap');
  document.getElementById('hud').textContent = parts.join('   ·   ');
}

// ---------- the guide: the one most useful thing to do next, with a compass arrow ----------
function nextAction() {
  const claudes = [...S.dyn.values()].filter(e => e.kind === 'claude');
  for (const t of WORLD.towns) for (const d of t.decisions.filter(x => x.source === 'claude')) {
    const e = claudes.find(c => c.sid === d.session);
    if (e) return { text: `Answer Claude's riddle in ${t.townName}`, x: e.x, y: e.y };
  }
  for (const t of WORLD.towns) for (const b of t.bosses) {
    const e = S.dyn.get(`boss-${b.id}`);
    if (e) return { text: `Face ${b.name} in ${t.townName}`, x: e.bx, y: e.by + 2 };
  }
  for (const t of WORLD.towns) if (t.missions.some(m => m.state === 'new' && !seen.missions.includes(m.id))) {
    const g = S.npcs.find(n => n.role === 'guide' && n.town === t.id);
    if (g) return { text: `Hear the Guide's new missions in ${t.townName}`, x: g.x, y: g.y };
  }
  if (WORLD.towns.length < 2) { const c = S.npcs.find(n => n.role === 'cartographer'); if (c) return { text: 'Ask the Cartographer to chart a new land', x: c.x, y: c.y }; }
  const stone = S.objs?.find(o => o.kind === 'waystone' && !attuned.has(o.stone));
  if (stone) return { text: `Attune the Waystone in ${S.areas.find(a => a.id === stone.stone)?.name || 'a new land'}`, x: stone.x, y: stone.y };
  return { text: 'All quiet. Post a quest at the Guild Hall, or explore', x: null };
}

function guide() {
  const el = document.getElementById('guide');
  if (!el || !WORLD || !S.player) return;
  const n = nextAction();
  let where = '';
  if (n.x !== null) {
    const dx = n.x - S.px, dy = n.y - S.py, dist = Math.abs(dx) + Math.abs(dy);
    const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    where = dist <= 1 ? ` · right here, press ${document.documentElement.classList.contains('touch') ? 'A' : 'Z'}` : ` · ${arrows[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]} ${dist} steps`;
  }
  const text = `NEXT ▸ ${n.text}${where}`;
  // The line fades back once read; it brightens again when the goal changes.
  if (n.text !== S.guideText) { S.guideText = n.text; S.guideAt = performance.now(); }
  el.textContent = text;
  el.classList.toggle('quiet', performance.now() - S.guideAt > 5000);
  el.classList.toggle('hidden', !!UI.open);
  pointer(n);
}

// A soft arrow on the screen edge toward the goal; over the goal itself once it's in view.
function pointer(n) {
  const el = document.getElementById('pointer');
  const cam = S.scene.cameras.main, W = 240, H = 160, pad = 9;
  if (n.x === null || UI.open || S.warping || Math.abs(n.x - S.px) + Math.abs(n.y - S.py) <= 1) return el.classList.add('hidden');
  const sx = n.x * T + 8 - cam.scrollX, sy = n.y * T - cam.scrollY;
  let x, y, ang, onScreen = sx > pad && sx < W - pad && sy > pad + 4 && sy < H - pad - 14;
  if (onScreen) { x = sx; y = sy - 10; ang = 90; }
  else {
    // Walk from the screen centre toward the goal until the ray meets the inset border.
    const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
    const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad - 6) / Math.abs(dy || 1e-6));
    x = cx + dx * k; y = cy + dy * k; ang = Math.atan2(dy, dx) * 180 / Math.PI;
  }
  el.classList.remove('hidden');
  el.classList.toggle('over', onScreen);
  el.style.left = `${(x / W) * 100}%`; el.style.top = `${(y / H) * 100}%`;
  el.style.setProperty('--ang', `${ang}deg`);
}

function refreshMarkers() {
  for (const n of S.npcs) {
    const t = n.town && town(n.town);
    let mark = null;
    if (n.role === 'messenger' && t.decisions.length) mark = '?';
    if (n.role === 'guide' && t.missions.some(m => m.state === 'new' && !seen.missions.includes(m.id))) mark = '!';
    if (n.role === 'scout' && WORLD.events.some(e => e.project === t.id && e.at > (seen.news[t.id] || ''))) mark = '!';
    if (n.role === 'clerk' && WORLD.towns.some(x => x.decisions.length)) mark = '?';
    if (n.role === 'cartographer' && WORLD.towns.length < 2) mark = '!';
    n.bubble.setVisible(!!mark);
    if (mark) n.bubble.setTexture(`bub-${mark}`);
  }
  for (const s of S.signs) if (s.kind === 'sign') { s.bubble.setVisible(!!town(s.town)?.generating); s.bubble.setTexture('bub-…'); }
}

// ---------- warping (Waystones, Rifts, couriers' shards) ----------
async function warp(x, y, { flash = [255, 255, 255] } = {}) {
  if (S.warping) return;
  S.warping = true;
  const cam = S.scene.cameras.main;
  Sound.warp();
  for (let i = 0; i < 8; i++) { S.player.setFrame(DIR_INDEX[['down', 'left', 'up', 'right'][i % 4]] * 3); await wait(55); }
  cam.flash(250, ...flash);
  await wait(120);
  cam.fadeOut(180, 255, 255, 255);
  await wait(200);
  S.px = x; S.py = y; S.path = [];
  S.player.setPosition(x * T, y * T - 2).setDepth(y * T + 9).setFrame(0);
  S.facing = 'down';
  store.set('cq-pos', [x, y]);
  cam.fadeIn(260, 255, 255, 255);
  checkArea();
  await wait(260);
  S.warping = false;
}

function spawnNear([x, y]) {
  const p = bfs([x, y], () => true, 1) || [];
  if (!blocked(x, y)) return [x, y];
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) if (!blocked(x + dx, y + dy)) return [x + dx, y + dy];
  return p[1] || [x, y];
}

function attune(stone, silent) {
  if (attuned.has(stone)) return;
  attuned.add(stone);
  store.set('cq-attuned', [...attuned]);
  applyNight();
  if (!silent) Sound.mail();
}

async function useWaystone(o) {
  if (isNight()) return UI.say(['The Waystone is cold and dark.', 'Waystones drink from the Ember Well, and the Well is dry until dawn. You will have to walk.']);
  if (!attuned.has(o.stone)) { attune(o.stone); await UI.say('The Waystone hums as you touch it. Attuned!'); }
  const dests = S.areas.filter(a => a.slot === undefined && attuned.has(a.id) && a.id !== (o.stone));
  if (!dests.length) return UI.say('The Waystone glows, but you have no other attuned stones yet. Visit a town to attune its stone.');
  const i = await UI.choose('The Waystone glows. Where to?', [...dests.map(a => a.name), 'Stay']);
  if (i < 0 || i === dests.length) return;
  await warp(...spawnNear(dests[i].spawn));
}

async function useRift(t) {
  const camps = t.camps.filter(c => campSlots[t.id]?.[c.id] !== undefined);
  if (!camps.length) return UI.say(['The Rift shimmers faintly.', 'No worktree camps have formed here yet. When Claude works in a worktree, its echo appears as a camp.']);
  const i = await UI.choose('The Rift shows echoes of this town: its worktree camps.', [...camps.map(c => `${c.label} (${c.ago})`), 'Step back']);
  if (i < 0 || i === camps.length) return;
  const a = campArea(t, campSlots[t.id][camps[i].id]);
  await warp(...spawnNear(a.spawn), { flash: [200, 160, 255] });
}

// ---------- conversations ----------
function interact() {
  const [dx, dy] = DIRS[S.facing];
  const tx = S.px + dx, ty = S.py + dy;
  const d = S.dynAt.get(key(tx, ty));
  const o = d || S.at.get(key(tx, ty));
  if (!o) return;
  if (o.kind === 'npc' || o.kind === 'claude') face(o, OPP[S.facing]);
  UI.run(async () => {
    const t = o.town && town(o.town);
    if (o.kind === 'claude') return claudeMenu(t, o.data);
    if (o.kind === 'boss') return bossScreen(t, t.bosses.find(b => b.id === o.boss));
    if (o.kind === 'camp') return campSign(t, t.camps.find(c => c.id === o.camp));
    if (o.kind === 'statue') return UI.say(`A statue honoring a cleared blocker in ${t.townName}. It gleams.`);
    if (o.kind === 'npc') return ({ scout: talkScout, historian: talkHistorian, guide: talkGuide, messenger: talkMessenger, clerk: talkClerk, cartographer: talkCartographer })[o.role](t);
    if (o.kind === 'sign') return UI.say([`${t.townName.toUpperCase()}`, `"${t.motto}"`, `(The ${t.name} project.${t.camps.length ? ` ${t.camps.length} worktree camp${t.camps.length > 1 ? 's' : ''} through the Rift.` : ''})`]);
    if (o.kind === 'door') return o.label === 'center' ? talkClerk() : readJournal(t);
    if (o.kind === 'mailbox') return mailPanel();
    if (o.kind === 'board') return questLog();
    if (o.kind === 'waystone') return useWaystone(o);
    if (o.kind === 'rift') return useRift(t);
  });
}

async function campSign(t, c) {
  if (!c) return;
  const claudes = t.claudes.filter(x => x.location === c.id);
  await UI.say([
    `${c.kind === 'hamlet' ? 'HAMLET' : 'CAMP'}: ${c.label}`,
    `An echo of ${t.townName}, a worktree${c.branch ? ` on the "${c.branch}" road` : ''}. Last Claude visit ${c.ago}.`,
    claudes.length ? `${claudes.length} Claude${claudes.length > 1 ? 's' : ''} camp here now.` : 'The fire burns, but no Claude is here right now.',
  ]);
  if (await UI.choose('A small rift flickers beside the sign.', [`Return to ${t.townName}`, 'Stay']) === 0) {
    await warp(...spawnNear(S.areas.find(a => a.id === t.id).spawn), { flash: [200, 160, 255] });
  }
}

async function claudeMenu(t, c) {
  const where = c.location === 'town' ? t.townName : `camp ${t.camps.find(x => x.id === c.location)?.label}`;
  if (isNight()) {
    await UI.say([`CLAUDE is fast asleep in ${where}. Zzz…`, `The Ember Well ran dry. Dawn comes in ${until(WORLD.night.until)}.`]);
    if (await UI.choose('You could leave a note by its pillow.', ['Leave a letter for dawn', 'Let it sleep']) === 0) {
      const text = await UI.ask('Letter for Claude to read at dawn:');
      if (text) { await api('/api/letter', { project: t.id, text }); await UI.say('You tuck the letter under its pillow.'); }
    }
    return;
  }
  const lines = [`CLAUDE ${CLAUDE_LINE[c.state] || 'is here'}. ("${short(c.title || 'untitled', 40)}", ${c.ago})`];
  if (t.stopped) lines.push('The STOP banner is up over this town. Claude is holding still.');
  if (c.recent.length) lines.push(`CLAUDE: ${c.recent[c.recent.length - 1].text}`);
  await UI.say(lines);
  const q = t.decisions.find(d => d.session === c.sid);
  for (;;) {
    const opts = [];
    if (q) opts.push(['Answer its question', 'answer']);
    opts.push(['Talk', 'chat'], ['Give a command', 'command']);
    if (c.recent.length > 1) opts.push(['Hear what it said earlier', 'history']);
    opts.push([t.stopped ? 'Lower the STOP banner' : 'Raise the STOP banner', 'stop']);
    if (c.canWake && !c.running) opts.push(['Wake it with a task (uses Claude tokens)', 'wake']);
    opts.push(['Bye', 'bye']);
    const i = await UI.choose(`What do you do?`, opts.map(o => o[0]));
    const act = i < 0 ? 'bye' : opts[i][1];
    if (act === 'bye') return;
    if (act === 'answer') { await decideFlow(t, q); return; }
    if (act === 'history') await UI.say(c.recent.map(r => `CLAUDE (${r.ago}): ${r.text}`));
    if (act === 'chat' || act === 'command') {
      const text = await UI.ask(act === 'chat' ? 'Say to Claude:' : 'Command for Claude:');
      if (!text) continue; // Esc: back to the menu
      await sendFlow(t, c, act, text);
      return;
    }
    if (act === 'stop') {
      await api('/api/stop', { project: t.id, on: !t.stopped });
      Sound.mail();
      await UI.say(t.stopped ? 'You lower the banner. Claude may carry on.' : ['You raise the STOP banner over the town!', 'Every Claude here halts at its next step. Lower it when you are ready.']);
      return;
    }
    if (act === 'wake') {
      const text = await UI.ask(`Wake Claude in "${short(c.title, 30)}" with this task:`);
      if (!text) continue;
      await wakeFlow(t, c, text);
      return;
    }
  }
}

async function sendFlow(t, c, mode, text) {
  const r = await api('/api/chat', { project: t.id, session: c.sid, text, mode });
  if (r.night) return UI.say('The Long Night holds. Your words will wait as a letter.');
  if (r.queued) { Sound.mail(); return UI.say(['Claude hears you!', 'It will read your words at its very next step and reply.']); }
  if (r.needsWake) {
    const opts = c.canWake ? ['Wake it with this (uses Claude tokens)', 'Leave it as a letter', 'Cancel'] : ['Leave it as a letter', 'Cancel'];
    const i = await UI.choose('Claude is resting, not mid-quest.', opts);
    const pick = opts[i];
    if (pick?.startsWith('Wake')) return wakeFlow(t, c, text);
    if (pick === 'Leave it as a letter') { await api('/api/letter', { project: t.id, text }); return UI.say(`Letter sent. It goes out with your next prompt in ${t.name}.`); }
  }
  if (r.error) return UI.say(r.error);
}

async function wakeFlow(t, c, text) {
  const r = await api('/api/wake', { project: t.id, session: c.sid, text });
  if (r.night) return UI.say('No Ember to wake it with. Wait for dawn.');
  if (r.error) return UI.say(r.error);
  Sound.warp();
  await UI.say(['Claude stirs, stretches, and gets to work!', 'It will come find you when it has something to say.']);
}

async function bossScreen(t, b) {
  if (!b) return;
  for (;;) {
    const cur = town(t.id).bosses.find(x => x.id === b.id);
    if (!cur) return UI.say('The boss is gone. The path is clear!');
    const frac = cur.hp / (cur.maxHp || 1);
    const header = `<div class="lore">${esc(cur.lore)}</div><div>${esc(cur.detail)}</div>` +
      `<div class="hp ${frac <= 0.2 ? 'crit' : frac <= 0.5 ? 'low' : ''}"><i style="width:${Math.round(frac * 100)}%"></i></div>` +
      `<div>HP ${cur.hp}/${cur.maxHp} · in "${esc(short(cur.sessionTitle || 'session', 40))}"${cur.hp === 0 ? ' · Staggered! It falls once Claude moves on.' : ''}</div>`;
    const items = cur.steps.map(s => ({
      label: s.title, sub: s.owner === 'you' ? 'Your move' : 'Claude\'s move',
      tag: s.state === 'done' ? 'DONE' : s.state === 'sent' ? 'SENT' : s.owner === 'you' ? 'YOU' : 'CLAUDE',
      tagColor: s.state === 'done' ? '#489868' : s.state === 'sent' ? '#c8a030' : s.owner === 'you' ? '#3060c0' : '#d97757',
    }));
    const i = await UI.panel(cur.name, items, { header, right: t.townName, hint: '↑↓ pick a move · Z act · X leave' });
    if (i < 0) return;
    await stepFlow(t, cur, cur.steps[i]);
  }
}

async function stepFlow(t, b, s) {
  if (s.state === 'done') return UI.say('That blow already landed.');
  if (isNight() && s.owner === 'claude') return UI.say('Claude sleeps through the Long Night. Its moves wait for dawn.');
  if (s.action === 'answer') {
    const d = t.decisions.find(x => x.id === s.decisionId);
    if (!d) return UI.say('You already answered. The Sphinx waits for Claude to read it.');
    return decideFlow(t, d);
  }
  if (s.owner === 'you') {
    const i = await UI.choose(s.title, ['Mark it done: strike!', 'Ask Claude about it', 'Back']);
    if (i === 0) { await api('/api/step', { bossId: b.id, stepId: s.id, action: 'done' }); hitFx(b.id); return UI.say(`You strike ${b.name}!`); }
    if (i === 1) { const c = town(t.id).claudes.find(x => x.sid === b.session); if (c) { const text = await UI.ask(`Ask Claude about: ${s.title}`); if (text) await sendFlow(t, c, 'chat', text); } }
    return;
  }
  const i = await UI.choose(s.title, ['Send Claude to do this', t.stopped ? 'Lower the STOP banner' : 'Raise the STOP banner', 'Back']);
  if (i === 0) {
    const r = await api('/api/step', { bossId: b.id, stepId: s.id, action: 'send' });
    if (r.queued) { Sound.mail(); return UI.say('Claude charges in! Its progress shows up here as it works.'); }
    if (r.needsWake) {
      const c = town(t.id).claudes.find(x => x.sid === b.session);
      if (c?.canWake && await UI.choose('Claude is resting.', ['Wake it for this move (uses Claude tokens)', 'Not now']) === 0) return wakeFlow(t, c, `Boss quest step: ${s.title}. (Blocker: ${b.detail})`);
      return;
    }
    if (r.error) return UI.say(r.error);
  }
  if (i === 1) { await api('/api/stop', { project: t.id, on: !t.stopped }); await UI.say(t.stopped ? 'Banner lowered.' : 'STOP banner raised. Claude halts at its next step.'); }
}

function hitFx(bossId) {
  const e = S.dyn.get(`boss-${bossId}`);
  if (!e) return;
  S.scene.cameras.main.shake(180, 0.01);
  S.scene.tweens.add({ targets: e.sprite, alpha: 0.2, duration: 70, yoyo: true, repeat: 3 });
  Sound.bump();
}

async function talkScout(t) {
  seen.news[t.id] = new Date().toISOString(); saveSeen(); refreshMarkers();
  const intro = {
    working: `SCOUT: Claude is hard at work in ${t.townName} right now!`,
    blocked: 'SCOUT: Claude is resting here. It hit a usage limit.',
    idle: `SCOUT: Claude was last seen here ${t.lastActivityAgo}.`,
    quiet: `SCOUT: It's been quiet. Last activity was ${t.lastActivityAgo}.`,
  }[t.status];
  const lines = [intro];
  if (t.claudes.length) lines.push(`I count ${t.claudes.length} Claude${t.claudes.length > 1 ? 's' : ''} around here today.`);
  if (t.bosses.length) lines.push(`Careful! ${t.bosses.map(b => b.name).join(' and ')} ${t.bosses.length > 1 ? 'are' : 'is'} blocking the way.`);
  lines.push(...t.scout.map(l => `SCOUT: ${l}`));
  await UI.say(lines);
  if (WORLD.events.some(e => e.project === t.id) && await UI.choose('SCOUT: Want to read the town news?', ['Read news', 'No thanks']) === 0) await mailPanel(t.id);
}

async function talkHistorian(t) {
  const lines = [];
  if (t.commits.length) {
    lines.push(`HISTORIAN: Let me read you the last entries in the ${t.name} chronicle.`);
    for (const c of t.commits.slice(0, 3)) lines.push(`${c.ago}: ${c.subject}`);
  } else lines.push('HISTORIAN: This town keeps no git chronicle. Its history lives in the journal.');
  if (t.branch) lines.push(`We're on the "${t.branch}" road${t.dirty ? `, with ${t.dirty} loose pages not yet bound (uncommitted).` : ', all pages bound.'}`);
  if (t.flowers) lines.push(`${t.flowers} flower${t.flowers > 1 ? 's' : ''} bloomed this week, one for every commit.`);
  lines.push(...t.historian.map(l => `HISTORIAN: ${l}`));
  await UI.say(lines);
}

async function talkGuide(t) {
  for (const m of t.missions) if (!seen.missions.includes(m.id)) seen.missions.push(m.id);
  saveSeen(); refreshMarkers();
  if (!t.missions.length) return UI.say(`GUIDE: No missions in ${t.townName} right now. Check back after the next chapter.`);
  for (;;) {
    const cur = town(t.id);
    const opts = cur.missions.map(m => `${m.state === 'accepted' ? '★ ' : ''}${short(m.title, 46)}`);
    const i = await UI.choose('GUIDE: Here are the missions I know about.', [...opts, 'Bye']);
    if (i < 0 || i === opts.length) return;
    await missionFlow(cur, cur.missions[i]);
  }
}

async function missionFlow(t, m) {
  await UI.say([`MISSION: ${m.title}`, m.detail]);
  if (m.state === 'accepted') {
    const i = await UI.choose('This mission is on your list.', ['Mark done', 'Abandon it', 'Back']);
    if (i === 0) { await api('/api/mission', { project: t.id, missionId: m.id, action: 'done' }); await celebrate('MISSION COMPLETE!', `${m.title} · a statue will rise in ${t.townName}`, '★'); }
    if (i === 1) { await api('/api/mission', { project: t.id, missionId: m.id, action: 'abandon' }); await UI.say(`Mission dropped. Claude will be told next time it works in ${t.name}.`); }
  } else {
    const opts = ['Post it at the Guild Hall (uses Claude tokens)', 'Keep it as a letter for Claude', 'Not now', 'Dismiss for good'];
    const i = await UI.choose('Take this mission?', opts);
    if (i === 0 && await postQuest(t, m.title, m.detail)) await api('/api/mission', { project: t.id, missionId: m.id, action: 'accept' });
    if (i === 1) { await api('/api/mission', { project: t.id, missionId: m.id, action: 'accept' }); Sound.mail(); await UI.say(['Mission accepted!', `Claude gets the order at its next step in ${t.name}.`]); }
    if (i === 3) await api('/api/mission', { project: t.id, missionId: m.id, action: 'dismiss' });
  }
}

async function decideFlow(t, d) {
  const who = d.source === 'claude' ? `Claude asks${d.sessionTitle ? ` (in "${short(d.sessionTitle, 30)}")` : ''}:` : 'The Oracle wonders:';
  await UI.say(who);
  const opts = [...d.options, 'Write my own reply…', 'Ask me later'];
  let answer = null;
  // Esc in the reply box goes back to the options; only "Ask me later" (or X here) leaves.
  while (!answer) {
    const i = await UI.choose(d.question, opts);
    if (i < 0 || i === opts.length - 1) return false;
    answer = i === opts.length - 2 ? await UI.ask(`Your reply to: ${d.question}`) : d.options[i];
  }
  await api('/api/decide', { project: t.id, decisionId: d.id, question: d.question, answer });
  S.flushPending = true; // sent to Claude as soon as the menu closes
  Sound.mail();
  const boss = t.bosses.find(b => b.steps.some(s => s.decisionId === d.id));
  if (boss) hitFx(boss.id);
  await UI.say([boss ? `You answer the riddle. ${boss.name} staggers!` : 'Your answer is sealed!', 'Lumi carries it to Claude the moment you close this.']);
  return true;
}

async function talkMessenger(t) {
  const ds = t.decisions;
  if (!ds.length) await UI.say(`MESSENGER: No open questions in ${t.townName}.`);
  else {
    await UI.say(`MESSENGER: ${ds.length} question${ds.length > 1 ? 's need' : ' needs'} your call.`);
    for (const d of ds) if ((await decideFlow(t, d)) === false && (await UI.choose(null, ['Next question', 'Stop'])) !== 0) break;
  }
  if (await UI.choose('MESSENGER: Anything you want to tell Claude?', ['Write a letter', 'Bye']) === 0) {
    const text = await UI.ask(`Letter to Claude about ${t.name}:`);
    if (text) { await api('/api/letter', { project: t.id, text }); Sound.mail(); await UI.say(`Letter sent! It goes out with your next prompt in ${t.name}.`); }
  }
}

async function readJournal(t) {
  const lines = [`You open the ${t.townName} journal.`];
  if (t.story.length) lines.push(...t.story);
  if (t.journal) lines.push(`A page from ${t.journal.name} reads:`, ...t.journal.lines.slice(0, 5));
  if (t.storySource === 'template') lines.push('(The local storyteller hasn\'t written this chapter yet.)');
  await UI.say(lines);
  if (await UI.choose(`Ask the local storyteller (${WORLD.model}) for a fresh chapter?`, ['Yes, rewrite it', 'No']) === 0) {
    await api('/api/refresh', { project: t.id });
    await UI.say('The storyteller starts writing… the town sign shows "…" until it\'s done.');
  }
}

async function talkClerk() {
  const pending = WORLD.towns.reduce((n, t) => n + t.decisions.length, 0);
  const bosses = WORLD.towns.reduce((n, t) => n + t.bosses.length, 0);
  const working = WORLD.towns.filter(t => t.status === 'working').map(t => t.name);
  await UI.say([
    'CLERK: Welcome to the Claude Center!',
    WORLD.night ? `The Long Night is upon us. Every Claude sleeps until dawn, in ${until(WORLD.night.until)}.` : working.length ? `Claude is busy in ${working.join(', ')}.` : 'No Claude sessions are running right now.',
    `${pending} question${pending === 1 ? '' : 's'} need you. ${bosses} boss${bosses === 1 ? '' : 'es'} block the roads.`,
  ]);
  for (;;) {
    const i = await UI.choose('CLERK: How can I help?', ['World map', 'Read mail', 'Quest log', 'Open questions', 'Trainer card', 'Outbox', 'Rewrite every chapter', 'Guild Hall', 'Bye']);
    if (i === 7) await guildHall();
    else if (i === 0) await mapScreen();
    else if (i === 1) await mailPanel();
    else if (i === 2) await questLog();
    else if (i === 3) await decisionsPanel();
    else if (i === 4) await trainerCard();
    else if (i === 5) await outboxPanel();
    else if (i === 6) { await api('/api/refresh', {}); await UI.say('The storytellers are writing. Signs show "…" while they work.'); }
    else return;
  }
}

async function mailPanel(filter) {
  for (;;) {
    const evs = WORLD.events.filter(e => !filter || e.project === filter);
    const items = evs.map(e => {
      const [tag, tagColor] = KIND_TAG[e.kind] || ['INFO', '#888'];
      return { label: short(e.text, 80), sub: `${(e.project && town(e.project)?.townName) || 'The world'} · ${ago(e.at)}`, tag, tagColor };
    });
    const i = await UI.panel(filter ? `${town(filter).townName} news` : 'Mail', items, { right: `${evs.length}` });
    if (i < 0) return;
    await UI.say(evs[i].text);
  }
}

async function questLog() {
  for (;;) {
    const all = [
      ...WORLD.towns.flatMap(t => t.bosses.map(b => ({ t, b }))),
      ...WORLD.towns.flatMap(t => t.missions.map(m => ({ t, m }))),
    ];
    const items = all.map(({ t, m, b }) => b
      ? { label: `${b.name} (HP ${b.hp}/${b.maxHp})`, sub: `${t.townName} · ${short(b.detail, 90)}`, tag: 'BOSS', tagColor: '#c04040' }
      : { label: m.title, sub: `${t.townName} · ${short(m.detail, 90)}`, tag: m.state === 'accepted' ? 'ON' : 'NEW', tagColor: m.state === 'accepted' ? '#d97757' : '#489868' });
    const i = await UI.panel('Quest log', items, { right: `${all.length}` });
    if (i < 0) return;
    const pick = all[i];
    if (pick.b) await bossScreen(pick.t, pick.b); else await missionFlow(pick.t, pick.m);
  }
}

async function decisionsPanel() {
  for (;;) {
    const all = WORLD.towns.flatMap(t => t.decisions.map(d => ({ t, d })));
    const items = all.map(({ t, d }) => ({ label: d.question, sub: t.townName, tag: d.source === 'claude' ? 'CLAUDE' : 'ORACLE', tagColor: d.source === 'claude' ? '#d97757' : '#8858c8' }));
    const i = await UI.panel('Open questions', items, { right: `${all.length}` });
    if (i < 0) return;
    await decideFlow(all[i].t, all[i].d);
  }
}

async function outboxPanel() {
  const items = WORLD.outbox.map(m => ({
    label: short(m.text, 90), sub: `${town(m.project)?.name} · sent ${ago(m.createdAt)}${m.deliveredAt ? ` · read ${ago(m.deliveredAt)}${m.via === 'post' ? ' (live)' : ''}` : ''}`,
    tag: m.deliveredAt ? 'READ' : 'WAIT', tagColor: m.deliveredAt ? '#38a0a0' : '#c8a030',
  }));
  const i = await UI.panel('Outbox', items, { hint: 'Letters reach Claude at its next step or prompt · X close' });
  if (i >= 0) await UI.say(WORLD.outbox[i].text);
}

async function trainerCard() {
  const s = WORLD.stats;
  const header = `<div class="stats"><div>Riddles answered: <b>${s.answers}</b></div><div>Blockers cleared: <b>${s.bosses}</b></div>` +
    `<div>Missions done: <b>${s.missionsDone}</b></div><div>Messages sent: <b>${s.messages}</b></div>` +
    `<div>Day streak: <b>${s.streak}</b></div><div>Waystones attuned: <b>${attuned.size}/${WORLD.towns.length + 1}</b></div></div>`;
  const items = WORLD.badges.map(b => ({ label: b.name, sub: `${b.desc} · ${ago(b.at)}`, tag: '◆', tagColor: '#d0a020' }));
  await UI.panel('Trainer card', items, { header, right: `${WORLD.badges.length} badges`, hint: items.length ? 'X close' : 'Answer riddles and clear blockers to earn badges · X close' });
}

async function startMenu() {
  for (;;) {
    const q = WORLD.towns.reduce((n, t) => n + t.decisions.length, 0);
    const i = await UI.choose(null, ['Map', 'Quest log', 'Mail', `Questions${q ? ` (${q})` : ''}`, 'Trainer card', 'Outbox', `Sound: ${Sound.on ? 'on' : 'off'}`, `Music: ${Music.on ? 'on' : 'off'}`, 'Guild Hall', 'Settings', 'Close'], { menu: true });
    if (i === 7) { Music.toggle(); continue; }
    if (i === 8) { await guildHall(); continue; }
    if (i === 9) { window.open('settings.html', 'cq-settings'); continue; }
    if (i === 0) return mapScreen();
    if (i === 1) await questLog();
    else if (i === 2) await mailPanel();
    else if (i === 3) await decisionsPanel();
    else if (i === 4) await trainerCard();
    else if (i === 5) await outboxPanel();
    else if (i === 6) { Sound.on = !Sound.on; api('/api/settings', { sound: Sound.on }); }
    else return;
  }
}

// ---------- the Guild Hall (Paperclip): quests the guild's Claude takes on ----------
const GUILD_TAG = {
  backlog: ['IDLE', '#888'], todo: ['POSTED', '#c8a030'], in_progress: ['OUT', '#d97757'], in_review: ['REVIEW', '#3878d0'],
  blocked: ['STUCK', '#c04040'], done: ['DONE', '#489868'], cancelled: ['OFF', '#686878'],
};
const guildAgent = () => WORLD.guild?.agents?.[0] || null;
const areaOfIssue = i => WORLD.towns.find(t => t.projectId && t.projectId === i.projectId);

async function guildClosed() {
  if (WORLD.guild?.up) return false;
  await UI.say(['The Guild Hall is closed. Its doors are barred.', '(Paperclip isn\'t running at 127.0.0.1:3100. Start it, and the hall opens on the next scan.)']);
  return true;
}

// Posting a quest assigns it to the guild's Claude, which sets out at once. That spends Claude tokens, so ask first.
async function postQuest(t, title, detail = '') {
  if (await guildClosed()) return false;
  if (isNight()) { await UI.say('No one leaves the Guild Hall during the Long Night. Post it at dawn.'); return false; }
  if (!t.projectId) { await UI.say([`${t.townName} isn't on the guild's maps yet.`, '(This land has no Paperclip project. It registers on the next scan while the hall is open.)']); return false; }
  const a = guildAgent();
  const warn = a?.status === 'paused' ? ' The guild is sent home, so it waits until you call them back.' : '';
  if (await UI.choose(`Post "${short(title, 50)}" for ${t.townName}? A guild Claude sets out right away.${warn}`, ['Post it (uses Claude tokens)', 'Not yet']) !== 0) return false;
  const r = await api('/api/guild/mission', { area: t.id, title, detail });
  if (r.error || r.closed || r.night) { await UI.say(r.error || 'The hall turned you away. Try again later.'); return false; }
  Sound.mail();
  await UI.say(['The clerk pins your quest to the board!', `(Paperclip issue ${r.key || r.id}, assigned to ${a?.name || 'the guild agent'}.)`]);
  return true;
}

async function guildHall() {
  if (await guildClosed()) return;
  for (;;) {
    const g = WORLD.guild, a = guildAgent();
    const paused = a?.status === 'paused';
    const issues = (g.issues || []).slice().sort((x, y) => Date.parse(y.updatedAt || 0) - Date.parse(x.updatedAt || 0));
    const live = new Set((g.liveRuns || []).map(r => r.issueId));
    const items = [
      { label: 'Post a new quest', sub: 'Write it yourself; a guild Claude takes it on', tag: 'NEW', tagColor: '#489868' },
      { label: paused ? 'Call the guild back to work' : 'Send the guild home', sub: paused ? 'Quests resume' : 'Stops every run now. Nothing starts until you call them back', tag: paused ? 'RESUME' : 'STOP', tagColor: paused ? '#489868' : '#c04040' },
      ...issues.map(i => {
        const [tag, tagColor] = live.has(i.id) ? ['OUT', '#d97757'] : GUILD_TAG[i.status] || [i.status.toUpperCase(), '#888'];
        return { label: i.title, sub: `${areaOfIssue(i)?.townName || 'Unmapped land'} · ${i.key || ''} · ${ago(i.updatedAt)}`, tag, tagColor };
      }),
    ];
    const right = a ? `${a.name}: ${paused ? 'sent home' : live.size ? 'on a quest' : 'resting'}` : 'no guild member';
    const i = await UI.panel('Guild Hall', items, { right, hint: 'Quests run on Paperclip · Z open · X leave' });
    if (i < 0) return;
    if (i === 0) {
      const t = await pickTown('Which land is the quest for?');
      if (!t) continue;
      const title = await UI.ask(`Quest for ${t.townName}, in one line:`);
      if (!title) continue;
      const detail = await UI.ask('Any details for the guild? (Enter to skip)');
      await postQuest(t, title, detail || '');
      continue;
    }
    if (i === 1) {
      if (!paused && await UI.choose('Send the whole guild home? Any running quest stops mid-step.', ['Send them home', 'Keep working']) !== 0) continue;
      await api('/api/guild/stop', { on: !paused });
      Sound.mail();
      await UI.say(paused ? 'The guild hurries back to the board.' : 'The guild packs up and heads home.');
      continue;
    }
    await guildQuest(issues[i - 2], live.has(issues[i - 2].id));
  }
}

async function guildQuest(q, running) {
  const t = areaOfIssue(q);
  await UI.say([`QUEST: ${q.title}`, `${t?.townName || 'Unmapped land'} · ${running ? 'a guild Claude is out on it now' : (GUILD_TAG[q.status]?.[0] || q.status).toLowerCase()}`, `(Paperclip ${q.key || q.id} · ${q.status} · ${q.priority || 'medium'} priority)`]);
  if (['done', 'cancelled'].includes(q.status)) return;
  const i = await UI.choose('What do you do?', ['Send word to the guild (uses Claude tokens)', 'Call off this quest', 'Back']);
  if (i === 0) {
    if (isNight()) return UI.say('Your word waits for dawn. The guild sleeps in the Long Night.');
    const text = await UI.ask(`Word for the guild about "${short(q.title, 40)}":`);
    if (!text) return;
    const r = await api('/api/guild/send', { issueId: q.id, text });
    if (r.error) return UI.say(r.error);
    Sound.mail();
    return UI.say(['A runner takes your word to the guild.', '(Comment added and the agent woken.)']);
  }
  if (i === 1 && await UI.choose(`Call off "${short(q.title, 40)}"? Its run stops now.`, ['Call it off', 'Keep it']) === 0) {
    await api('/api/guild/stop', { issueId: q.id });
    return UI.say('The quest is struck from the board.');
  }
}

async function pickTown(prompt) {
  if (WORLD.towns.length === 1) return WORLD.towns[0];
  const i = await UI.choose(prompt, [...WORLD.towns.map(t => t.townName), 'Cancel']);
  return WORLD.towns[i] || null;
}

// ---------- the Cartographer: chart new lands (repos), abandon old ones ----------
async function talkCartographer() {
  const n = WORLD.towns.length, max = WORLD.save?.maxAreas || 5;
  await UI.say(['CARTOGRAPHER: Ah, a traveler with an eye for maps!', `You've charted ${n} land${n === 1 ? '' : 's'} so far. My maps have room for ${max}.`]);
  for (;;) {
    const i = await UI.choose('CARTOGRAPHER: What shall we do?', ['Chart a new land', 'Abandon a land', 'Open the map room (settings)', 'Bye']);
    if (i === 0) { if (await chartLand()) return; }
    else if (i === 1) { if (await abandonLand()) return; }
    else if (i === 2) { window.open('settings.html', 'cq-settings'); await UI.say('CARTOGRAPHER: The map room is open in another tab. Changes show up here on the next scan.'); }
    else return;
  }
}

async function chartLand() {
  const r = await Net.get('/api/repos');
  if (r.error) { await UI.say(`CARTOGRAPHER: ${r.error}`); return false; }
  if (r.charted >= r.max) { await UI.say(`CARTOGRAPHER: My maps are full at ${r.max} lands. Abandon one to make room.`); return false; }
  if (!r.repos.length) { await UI.say('CARTOGRAPHER: I see no uncharted lands. (No other git repos in ~/Repositories.)'); return false; }
  const i = await UI.panel('Uncharted lands', r.repos.map(x => ({ label: x.name, sub: x.path.replace(/^\/Users\/[^/]+/, '~') })), { right: `${r.charted}/${r.max} charted`, hint: 'Newest first · Z chart · X back' });
  if (i < 0) return false;
  const repo = r.repos[i];
  const name = await UI.ask(`Name this land (it's ${repo.name}):`, repo.name.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
  if (!name) return false;
  const a = await api('/api/areas', { path: repo.path, name });
  if (a.error) { await UI.say(`CARTOGRAPHER: ${a.error}`); return false; }
  await celebrate('NEW LAND!', `${a.name} is on the map`, '✦');
  await UI.say([`CARTOGRAPHER: There! ${a.name} is on the map.`, 'Walk there and touch its Waystone to attune it.', WORLD.guild?.up ? '(Registered as a Paperclip project.)' : '(The Guild Hall is closed, so it registers with Paperclip once the hall opens.)']);
  return true;
}

async function abandonLand() {
  const i = await UI.choose('CARTOGRAPHER: Which land do you leave behind?', [...WORLD.towns.map(t => t.townName), 'None']);
  const t = WORLD.towns[i];
  if (!t) return false;
  if (await UI.choose(`Abandon ${t.townName}? It leaves the map. Its repo and history stay untouched, and you can chart it again later.`, ['Abandon it', 'Keep it']) !== 0) return false;
  const r = await api('/api/areas/update', { id: t.id, retire: true });
  if (r.error) { await UI.say(r.error); return false; }
  await UI.say(`CARTOGRAPHER: I'll let the grass take ${t.townName}'s roads.`);
  return true;
}

// The map is built once, so a change in charted lands reloads the world (after any open dialog closes).
function landsChanged(next) {
  return next.towns.map(t => t.id).join() !== WORLD.towns.map(t => t.id).join();
}
async function reloadWorld() {
  while (UI.open) await wait(300);
  S.scene?.cameras.main.fadeOut(400, 0, 0, 0);
  await wait(450);
  location.reload();
}

// ---------- title screen and the new game intro ----------
async function titleScreen() {
  const boot = document.getElementById('boot');
  boot.innerHTML = '<div class="title">CLAUDE QUEST<small>Lands of the Ember Well</small></div>';
  const cont = WORLD.save?.introDone;
  const opts = cont ? ['Continue', 'New Journey'] : ['New Journey'];
  const list = document.getElementById('choices');
  list.classList.add('title');
  const i = await UI.choose(null, opts);
  list.classList.remove('title');
  if (opts[i] === 'Continue' || i < 0 && cont) return;
  if (cont && await UI.choose('Begin a new journey? Your charted lands, letters and badges stay. Your footsteps and attuned Waystones reset.', ['Start over', 'Continue instead']) !== 0) return;
  for (const k of ['cq-pos', 'cq-attuned', 'cq-seen', 'cq-camp-slots']) try { localStorage.removeItem(k); } catch {}
  attuned.clear(); attuned.add('hub');
  boot.innerHTML = '';
  await intro();
}

// A big portrait of the Warden, drawn from the same pixel sprite as everyone else.
function wardenPortrait() {
  const sheet = Art.character({ hat: '#6a3a78', shirt: '#9a6ab8', pants: '#3a2a48' });
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  c.getContext('2d').drawImage(sheet, 0, 0, 16, 16, 0, 0, 16, 16);
  c.className = 'warden';
  return c;
}

async function intro() {
  const home = WORLD.towns[0];
  const boot = document.getElementById('boot');
  boot.replaceChildren(wardenPortrait());
  await UI.say([
    'Hello there! Welcome to the lands of the Ember Well.',
    'My name is WARDEN ASH. People call me the keeper of the Well.',
    'Every land here is a place where work gets done. And the one who does it… is CLAUDE.',
    'Claude is a tireless traveler. It drinks Ember from the Well to work.',
    'When the Well runs dry, the Long Night falls. Claude sleeps, and the Waystones go dark until dawn.',
    '(Ember is your Claude usage. The Long Night is a usage limit.)',
    home ? `You begin in ${home.townName}, the land where these very roads are laid.` : 'You have no lands yet. Visit the Cartographer to chart your first.',
    'In the Claude Center, the CLERK keeps the Guild Hall. Post quests there, and a guild Claude sets out.',
    'The CARTOGRAPHER beside the Waystone charts new lands for you, one repository at a time.',
    'And LUMI, a little spirit from beyond the Rift, will float to you whenever there is news.',
    'Answer the riddles Claude brings you, clear the bosses that block its roads, and the lands will flourish.',
  ]);
  // The player names everything that's theirs, Pokémon style.
  await UI.say('But first, tell me a little about yourself.');
  const me = (await UI.ask('What is your name?', WORLD.save?.settings.playerName || '')) || 'Traveler';
  await UI.say(`${me}! A fine name.`);
  await UI.say('And the tireless traveler who works these lands with you… what shall we call it?');
  const friend = (await UI.ask('Name your companion:', WORLD.save?.settings.claudeName || 'Claude')) || 'Claude';
  await api('/api/settings', { playerName: me, claudeName: friend });
  if (home) {
    await UI.say(`Every land needs a name. Your first one is where these roads are laid (${home.name}).`);
    const land = await UI.ask('Name your home land:', home.townName);
    if (land && land !== home.townName) await rename(home.id, land);
  }
  await UI.say([`${friend.toUpperCase()}, then. It is waiting for you in ${home?.townName || 'the lands'}.`, `${me}, your adventure starts now!`]);
  await api('/api/intro', {});
}

// ---------- couriers: news comes running to you ----------
const COURIER = new Set(['boss', 'victory', 'step', 'reply', 'delivered', 'run', 'badge', 'night', 'dawn']);
const needsYou = ev => ev.kind === 'reply' || (ev.kind === 'boss' && /Sphinx/.test(ev.text));

function onEvent(ev) {
  const [tag, color] = KIND_TAG[ev.kind] || ['INFO', '#888'];
  const name = (ev.project && town(ev.project)?.townName) || 'The world';
  UI.toast(`<b style="color:${color}">${tag}</b> ${esc(name)}<br>${esc(short(ev.text, 110))}`);
  if (ev.kind === 'commit' && S.area === ev.project) fireworks();
  if (ev.kind === 'victory') { const e = [...S.dyn.values()].find(x => x.kind === 'boss' && x.boss === ev.bossId); if (e) fireworks(e.bx * T + 16, e.by * T + 8); }
  if (ev.kind === 'step' && ev.bossId) hitFx(ev.bossId);
  if (COURIER.has(ev.kind)) { S.couriers.push(ev); pumpCouriers(); }
}

function fireworks(x, y) {
  const cam = S.scene.cameras.main;
  const cx = x ?? cam.scrollX + 120, cy = y ?? cam.scrollY + 50;
  for (let i = 0; i < 3; i++) setTimeout(() => { S.burst.explode(26, cx + (i - 1) * 40, cy + (i % 2) * 14); Sound.pop(); }, i * 280);
}

async function pumpCouriers() {
  if (S.courierBusy || !S.couriers.length || !S.player) return;
  if (UI.open || S.moving || S.warping) { setTimeout(pumpCouriers, 700); return; }
  S.courierBusy = true;
  const batch = S.couriers.splice(0, 4);
  try { await UI.run(() => courierVisit(batch)); } finally { S.courierBusy = false; }
  if (S.couriers.length) setTimeout(pumpCouriers, 1500);
}

async function courierVisit(batch) {
  const isClaude = batch.length === 1 && batch[0].kind === 'reply';
  const urgent = batch.some(needsYou);
  S.playerBubble.setTexture('bub-!').setVisible(true);
  Sound.alert();
  if (urgent && S.auto) stopAuto();
  await wait(650);
  S.playerBubble.setVisible(false);

  // Lumi (or Claude) steps out of a small rift a few tiles away and glides to you on a smooth curve.
  const startPath = bfs([S.px, S.py], (x, y) => Math.abs(x - S.px) + Math.abs(y - S.py) >= 6, 3000) || bfs([S.px, S.py], (x, y) => Math.abs(x - S.px) + Math.abs(y - S.py) >= 2, 600);
  const v = startPath ? await arrive(startPath.slice().reverse(), isClaude) : null;

  const auto = S.auto && !urgent ? 4000 : 0;
  for (const ev of batch) await courierLine(ev, isClaude, auto);

  if (v) await depart(v);
}

// The visitor's entrance: a rift opens, it fades in, and it floats along the path with a trail of motes.
async function arrive(route, isClaude) {
  const sc = S.scene;
  route = route.slice(0, -1); // stop beside the player
  const [sx, sy] = route[0];
  const rift = sc.add.image(sx * T + 8, sy * T + 8, 'rift').setDepth(8990).setScale(0.2).setAlpha(0);
  sc.tweens.add({ targets: rift, scale: 1.6, alpha: 0.9, angle: 180, duration: 420, ease: 'Back.out' });
  Sound.chime();
  await wait(380);
  const sprite = isClaude
    ? sc.add.sprite(sx * T, sy * T - 2, 'char-claude', 0).setOrigin(0)
    : sc.add.image(sx * T, sy * T - 4, 'spirit0').setOrigin(0);
  sprite.setDepth(9000).setAlpha(0).setScale(0.4);
  const halo = sc.add.image(0, 0, 'halo').setDepth(8999).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8);
  const trail = sc.add.particles(0, 0, 'mote', {
    lifespan: 700, speed: { min: 2, max: 10 }, scale: { start: 1, end: 0 }, alpha: { start: 0.9, end: 0 },
    frequency: 45, blendMode: 'ADD', follow: sprite, followOffset: { x: 8, y: 10 },
  }).setDepth(8998);
  sc.tweens.add({ targets: sprite, alpha: 1, scale: 1, duration: 300, ease: 'Sine.out' });
  sc.tweens.add({ targets: rift, alpha: 0, scale: 0.4, angle: 360, delay: 350, duration: 500, onComplete: () => rift.destroy() });
  await wait(300);

  // One eased glide along a Catmull-Rom curve through the path's tiles, instead of tile-by-tile hops.
  const xs = route.map(([x]) => x * T), ys = route.map(([, y]) => y * T - (isClaude ? 2 : 4));
  const prog = { t: 0 };
  let last = performance.now();
  await new Promise(done => sc.tweens.add({
    targets: prog, t: 1, duration: Math.max(500, route.length * 130), ease: 'Sine.inOut',
    onUpdate: () => {
      const x = Phaser.Math.Interpolation.CatmullRom(xs, prog.t), y = Phaser.Math.Interpolation.CatmullRom(ys, prog.t);
      const now = performance.now(), dx = x - sprite.x, dy = y - sprite.y;
      if (isClaude) {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        sprite.setFrame(DIR_INDEX[dir] * 3 + 1 + (Math.floor(now / 140) % 2));
      } else sprite.setTexture(`spirit${Math.floor(now / 220) % 2}`).setFlipX(dx < -0.01 ? true : dx > 0.01 ? false : sprite.flipX);
      sprite.setPosition(x, y + (isClaude ? 0 : Math.sin(now / 160) * 1.5));
      halo.setPosition(sprite.x + 8, sprite.y + 9);
      last = now;
    },
    onComplete: done,
  }));

  const end = route[route.length - 1];
  const toPlayer = Object.keys(DIRS).find(d => end[0] + DIRS[d][0] === S.px && end[1] + DIRS[d][1] === S.py) || 'down';
  if (isClaude) sprite.setFrame(DIR_INDEX[toPlayer] * 3);
  S.facing = OPP[toPlayer]; S.player.setFrame(DIR_INDEX[S.facing] * 3);
  // While it talks it keeps bobbing and blinking.
  const idle = sc.time.addEvent({ delay: 60, loop: true, callback: () => {
    const now = performance.now();
    if (!isClaude) sprite.setTexture(now % 2600 < 140 ? 'spirit2' : `spirit${Math.floor(now / 420) % 2}`).setY(end[1] * T - 4 + Math.sin(now / 260) * 1.5);
    halo.setPosition(sprite.x + 8, sprite.y + 9).setAlpha(0.6 + Math.sin(now / 300) * 0.2);
  } });
  trail.frequency = 160;
  return { sprite, halo, trail, idle };
}

// The exit: it rises a little and dissolves into light.
async function depart({ sprite, halo, trail, idle }) {
  const sc = S.scene;
  idle.remove();
  trail.stop();
  Sound.chime(true);
  const burst = sc.add.particles(sprite.x + 8, sprite.y + 8, 'mote', {
    speed: { min: 20, max: 60 }, lifespan: 800, scale: { start: 1.4, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
  }).setDepth(9001);
  burst.explode(24);
  await new Promise(done => sc.tweens.add({ targets: [sprite, halo], y: '-=10', alpha: 0, scale: 1.4, duration: 520, ease: 'Sine.in', onComplete: done }));
  sprite.destroy(); halo.destroy();
  setTimeout(() => { trail.destroy(); burst.destroy(); }, 900);
}

// Answers go out the moment every menu is closed: one wake per waiting Claude, carrying all its answers.
async function flushAnswers() {
  if (!S.flushPending || UI.open || S.flushing) return;
  S.flushPending = false; S.flushing = true;
  try {
    const r = await api('/api/flush', {});
    if (r.night) UI.toast('<b>LETTERS</b> The Long Night holds. Your answers go out at dawn.');
    for (const w of r.woke || []) UI.toast(`<b>SENT</b> Lumi woke Claude with ${w.answers} answer${w.answers > 1 ? 's' : ''}<br>${esc(short(w.title || 'session', 60))}`);
    if (r.woke?.length) Sound.chime();
  } finally { S.flushing = false; }
}

// ---------- rewards: a fanfare, light, and a card you can't miss ----------
async function celebrate(title, sub, icon = '◆') {
  const sc = S.scene, cam = sc.cameras.main;
  Music.duck?.(3.2);
  Sound.fanfare();
  cam.flash(220, 255, 240, 200);
  const cx = S.player.x + 8, cy = S.player.y + 6;
  const ring = sc.add.particles(cx, cy, 'ember', {
    speed: { min: 50, max: 120 }, angle: { min: 0, max: 360 }, lifespan: 1100, gravityY: 40,
    scale: { start: 1.6, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
  }).setDepth(9601);
  ring.explode(40);
  setTimeout(() => S.burst.explode(30, cx, cy - 20), 250);
  setTimeout(() => S.burst.explode(30, cx - 30, cy - 10), 500);
  setTimeout(() => S.burst.explode(30, cx + 30, cy - 10), 700);
  setTimeout(() => ring.destroy(), 1500);
  // Hold the trophy overhead, Pokémon style.
  S.player.setFrame(0);
  const card = document.getElementById('reward');
  card.querySelector('.icon').textContent = icon;
  card.querySelector('.title').textContent = title;
  card.querySelector('.sub').textContent = sub || '';
  card.classList.remove('hidden');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  await wait(2600);
  card.classList.add('hidden');
}

async function courierLine(ev, isClaude, auto) {
  const t = ev.project && town(ev.project);
  const tn = t?.townName || 'the world';
  const say = (lines) => UI.say(lines, { auto });
  switch (ev.kind) {
    case 'reply': {
      await say([`CLAUDE dashes over from ${tn}!`, `CLAUDE: ${ev.text}`]);
      const c = t?.claudes.find(x => x.sid === ev.session);
      while (c && !isNight() && await UI.choose('Reply?', ['Reply', 'Nod and let it work']) === 0) {
        const text = await UI.ask('Reply to Claude:');
        if (text) { await sendFlow(t, c, 'chat', text); break; }
      }
      return;
    }
    case 'boss': {
      await say([`LUMI: Urgent news from ${tn}!`, ev.text]);
      if (auto) return;
      const b = t?.bosses.find(x => x.id === ev.bossId);
      if (b && await UI.choose('LUMI: I carry a rift shard. Want to go there now?', ['Take me there', 'Later']) === 0) {
        const e = S.dyn.get(`boss-${b.id}`);
        if (e) { await warp(...spawnNear([e.bx, e.by + 2]), { flash: [200, 160, 255] }); S.facing = 'up'; S.player.setFrame(DIR_INDEX.up * 3); }
      }
      return;
    }
    case 'night': return say(['LUMI: Bad news, traveler…', 'The Ember Well has run dry. The Long Night falls.', `Every Claude sleeps until dawn${WORLD.night ? `, in ${until(WORLD.night.until)}` : ''}. The Waystones go dark.`, 'Letters you write will wait for morning.']);
    case 'dawn': return say(['LUMI: Dawn breaks over the land!', 'The Ember Well is full again. Claude wakes, and the Waystones glow.']);
    case 'badge': await say(['LUMI: A gift from the Ember Well!']); await celebrate('BADGE GET!', ev.text.replace(/^You earned the /, '')); return;
    case 'victory': await say([`LUMI: Victory in ${tn}!`]); await celebrate('VICTORY!', ev.text, '★'); return;
    case 'step': return say([`LUMI: Word from the front in ${tn}:`, ev.text]);
    case 'delivered': return say([`LUMI: Your letter reached Claude in ${tn}.`]);
    default: return say([`LUMI: News from ${tn}:`, ev.text]);
  }
}

// ---------- input ----------
window.addEventListener('keydown', e => {
  stopAuto();
  if (UI.handler) { if (UI.key(e)) e.preventDefault(); return; }
  if (UI.open) return;
  const dir = KEY_DIR[e.key];
  if (dir) {
    e.preventDefault();
    if (!S.held.has(dir)) S.held.set(dir, S.scene ? S.scene.time.now : 0);
    if (S.player && !S.moving && S.facing !== dir) { S.facing = dir; S.player.setFrame(DIR_INDEX[dir] * 3); S.turnedAt = S.scene.time.now; }
    else if (S.player) S.queued = dir; // a tap while already facing that way takes one step
    return;
  }
  if (['z', 'Z', ' '].includes(e.key)) { e.preventDefault(); interact(); }
  else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); UI.run(startMenu); }
  else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); UI.run(mapScreen); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); MapView.toggleMini(); }
  else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); UI.run(() => mailPanel()); }
});
window.addEventListener('keyup', e => { const dir = KEY_DIR[e.key]; if (dir) S.held.delete(dir); });
window.addEventListener('blur', () => S.held.clear());
window.addEventListener('mousedown', () => stopAuto());

function fit() { document.documentElement.style.setProperty('--px', `${document.getElementById('screen').clientWidth / 240}px`); }
window.addEventListener('resize', fit);

// ---------- live data ----------
// Names the player chose win over anything generated. Keyed by id: a land's id today; characters and places next.
const chosenName = id => WORLD?.save?.settings.names?.[id];
function applyNames(w) { for (const t of w.towns || []) { const n = w.save?.settings.names?.[t.id]; if (n) t.townName = n; } return w; }
async function rename(id, name) {
  name = String(name).trim().slice(0, 24);
  await api('/api/settings', { names: { [id]: name } });
  WORLD.save.settings.names = { ...WORLD.save.settings.names, [id]: name };
  applyNames(WORLD);
  const a = S.areas.find(x => x.id === id); if (a) a.name = name;
}

function connect() {
  Net.subscribe(next => {
    if (!next) return;
    applyNames(next);
    if (!WORLD) { WORLD = next; return start(); }
    if (landsChanged(next)) { WORLD = { ...WORLD, ...next, towns: WORLD.towns }; return reloadWorld(); }
    for (const t of next.towns) { const old = town(t.id); if (old) { t._cx = old._cx; t._cy = old._cy; t._camps = old._camps; } }
    WORLD = next;
    if (S.scene?.sys.isActive()) { syncDynamic(); refreshMarkers(); applyNight(); hud(); }
  }, ev => { if (WORLD && S.player) onEvent(ev); });
}

async function start() {
  fit();
  Sound.on = WORLD.save?.settings.sound ?? true;
  if (!sessionStorage.getItem('cq-played')) await titleScreen();
  try { sessionStorage.setItem('cq-played', '1'); } catch {}
  new Phaser.Game({
    type: Phaser.CANVAS, parent: 'game', width: 240, height: 160, pixelArt: true, backgroundColor: '#000000',
    input: { keyboard: false }, fps: { target: 60, forceSetTimeOut: true }, scale: { mode: Phaser.Scale.NONE },
    scene: { create, update },
  });
}

connect();
