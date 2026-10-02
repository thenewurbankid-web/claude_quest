// Maps: an always-on minimap in the corner and a full Town Map, Pokémon style. Both are painted from the live
// scene itself (tiles, buildings, camps, Keepers, bosses) at a small scale, so they always match the world.
const MapView = {
  // Placement and size come from the save's settings (the Map Room page); N toggles it in game.
  get mini() { return WORLD?.save?.settings.minimap ?? true; },
  layout() {
    const st = WORLD?.save?.settings || {};
    const s = document.getElementById('screen');
    s.dataset.mm = this.mini ? (st.minimapCorner || 'tr') : 'off';
    s.dataset.mmSize = st.minimapSize || 'm';
  },

  // Paint the whole world at `sc` pixels per tile.
  paint(sc) {
    const c = document.createElement('canvas');
    c.width = MW * sc; c.height = MH * sc;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = sc >= 4;
    g.imageSmoothingQuality = 'high';
    const tiles = S.scene.textures.get('tiles').getSourceImage();
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) g.drawImage(tiles, S.tiles[y][x] * T, 0, T, T, x * sc, y * sc, sc, sc);
    // Every world object in depth order, minus overlays (bubbles, HP bars, weather) and the player.
    const k = sc / T;
    const objs = S.scene.children.list
      .filter(o => o.frame && o.visible && o.scrollFactorX === 1 && o.depth < 9000 && o !== S.player)
      .sort((a, b) => a.depth - b.depth);
    for (const o of objs) {
      const f = o.frame;
      g.globalAlpha = o.alpha;
      g.drawImage(f.source.image, f.cutX, f.cutY, f.cutWidth, f.cutHeight, Math.round(o.x * k), Math.round(o.y * k), f.cutWidth * k, f.cutHeight * k);
    }
    g.globalAlpha = 1;
    if (isNight()) { g.fillStyle = 'rgba(10,16,64,0.45)'; g.fillRect(0, 0, c.width, c.height); }
    return c;
  },

  // Markers on top of the painting, sized for legibility rather than to scale.
  markers(g, sc, ox = 0, oy = 0, r = 2) {
    const dot = (x, y, color, rr = r) => {
      const px = (x + 0.5) * sc - ox, py = (y + 0.5) * sc - oy;
      g.fillStyle = '#181820'; g.fillRect(px - rr - 1, py - rr - 1, rr * 2 + 2, rr * 2 + 2);
      g.fillStyle = color; g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    };
    for (const e of S.dyn.values()) {
      if (e.kind === 'boss') dot(e.bx + 0.5, e.by + 0.5, '#ff3838', r + 1);
      if (e.kind === 'keeper') dot(e.x, e.y, e.data.state === 'sleeping' ? '#9090b8' : '#ffb080');
    }
    if (performance.now() % 1000 < 650) dot(S.px, S.py, '#ffffff', r + 1);
  },

  // ---------- minimap ----------
  VIEW_W: 24, VIEW_H: 16, SC: 6,
  tickMini() {
    const el = document.getElementById('minimap');
    if (!el) return;
    this.layout();
    el.classList.toggle('hidden', !this.mini || !S.player);
    if (!this.mini || !S.player) return;
    // The painted world changes slowly; repaint it every few seconds, markers every tick.
    if (!this.miniBase || performance.now() - this.miniAt > 4000) { this.miniBase = this.paint(this.SC); this.miniAt = performance.now(); }
    const c = el.querySelector('canvas'), g = c.getContext('2d'), sc = this.SC;
    c.width = this.VIEW_W * sc; c.height = this.VIEW_H * sc;
    const ox = Math.max(0, Math.min(MW - this.VIEW_W, S.px - this.VIEW_W / 2)) * sc;
    const oy = Math.max(0, Math.min(MH - this.VIEW_H, S.py - this.VIEW_H / 2)) * sc;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniBase, ox, oy, c.width, c.height, 0, 0, c.width, c.height);
    this.markers(g, sc, ox, oy, 3);
    const a = S.areas.find(x => x.id === S.area);
    el.querySelector('.name').textContent = a?.name || 'The wilds';
  },
  toggleMini() { WORLD.save.settings.minimap = !this.mini; api('/api/settings', { minimap: this.mini }); this.tickMini(); },

  // ---------- full Town Map ----------
  places() {
    return S.areas.filter(a => a.slot === undefined || a.camp).map(a => {
      const t = a.town && town(a.town);
      const camp = a.camp && t?.camps.find(c => c.id === a.camp);
      let sub = 'Mail, quests, the Guild Hall, the Cartographer';
      if (t && !camp) sub = `${t.status} · ${t.keepers.length} Keeper${t.keepers.length === 1 ? '' : 's'} · ${t.camps.length} camp${t.camps.length === 1 ? '' : 's'}${t.bosses.length ? ` · ${t.bosses.length} boss${t.bosses.length > 1 ? 'es' : ''}` : ''}`;
      if (camp) sub = `Worktree camp of ${t.townName}${camp.branch ? ` · ${camp.branch}` : ''} · last visit ${camp.ago}`;
      const warpable = a.slot === undefined;
      return { a, t, name: a.name, sub, cx: (a.x0 + a.x1) / 2, cy: (a.y0 + a.y1) / 2, warpable, real: t ? `(${t.name}${camp ? ` / ${camp.label}` : ''})` : '' };
    });
  },

  open() {
    return new Promise(done => {
      const SC = 8;
      const root = document.getElementById('townmap');
      const c = root.querySelector('canvas'), g = c.getContext('2d');
      const places = this.places();
      // Frame the charted region (4:3, padded), so a small world isn't lost in forest.
      const bx0 = Math.min(...places.map(p => p.a.x0)) - 5, bx1 = Math.max(...places.map(p => p.a.x1)) + 5;
      const by0 = Math.min(...places.map(p => p.a.y0)) - 5, by1 = Math.max(...places.map(p => p.a.y1)) + 5;
      const vw = Math.min(MW, Math.max(bx1 - bx0, (by1 - by0) * 4 / 3, 40)), vh = Math.min(MH, vw * 3 / 4);
      const vx = Math.max(0, Math.min(MW - vw, (bx0 + bx1 - vw) / 2)), vy = Math.max(0, Math.min(MH - vh, (by0 + by1 - vh) / 2));
      const world = this.paint(SC);
      const base = document.createElement('canvas');
      base.width = Math.round(vw * SC); base.height = Math.round(vh * SC);
      base.getContext('2d').drawImage(world, vx * SC, vy * SC, base.width, base.height, 0, 0, base.width, base.height);
      c.width = base.width; c.height = base.height;
      const OX = vx * SC, OY = vy * SC;
      const here = places.findIndex(p => p.a.id === S.area || p.a.id === S.areas.find(x => x.id === S.area)?.town);
      let sel = Math.max(0, here);
      let raf = 0;
      const draw = () => {
        g.drawImage(base, 0, 0);
        // Region names, like the GBA Town Map.
        g.font = `600 ${Math.round(SC * 2)}px "Nunito", system-ui, sans-serif`; g.textAlign = 'center';
        for (const p of places) if (!p.a.camp) {
          const x = p.cx * SC - OX, y = (p.a.y0 - 0.6) * SC - OY;
          g.lineWidth = 4; g.strokeStyle = '#181820'; g.strokeText(p.name, x, y);
          g.fillStyle = '#fff8e0'; g.fillText(p.name, x, y);
        }
        this.markers(g, SC, OX, OY, 4);
        const p = places[sel];
        if (p) {
          const blink = performance.now() % 800 < 520;
          g.lineWidth = 4; g.strokeStyle = blink ? '#f8d040' : '#d97757';
          g.strokeRect(p.a.x0 * SC - OX, p.a.y0 * SC - OY, (p.a.x1 - p.a.x0 + 1) * SC, (p.a.y1 - p.a.y0 + 1) * SC);
        }
        raf = requestAnimationFrame(draw);
      };
      const info = () => {
        const p = places[sel];
        const can = p.warpable && attuned.has(p.a.id) && !isNight();
        root.querySelector('.place').textContent = p.name;
        root.querySelector('.sub').textContent = `${p.sub} ${p.real}`;
        root.querySelector('.act').textContent = p.a.id === S.area ? 'You are here' : can ? 'Z: warp here' : isNight() ? 'Waystones are dark' : p.warpable ? 'Not attuned yet' : 'Reach it through its town\'s Rift';
      };
      // Arrow keys jump to the nearest place in that direction.
      const step = dir => {
        const [dx, dy] = DIRS[dir], cur = places[sel];
        let best = -1, bestScore = Infinity;
        places.forEach((p, i) => {
          const vx = p.cx - cur.cx, vy = p.cy - cur.cy, along = vx * dx + vy * dy;
          if (i === sel || along <= 0) return;
          const score = along + 2 * Math.abs(vx * dy - vy * dx);
          if (score < bestScore) { bestScore = score; best = i; }
        });
        if (best >= 0) { sel = best; Sound.tick(); info(); }
      };
      root.classList.remove('hidden');
      UI.mode = 'map';
      info(); draw();
      const finish = v => { cancelAnimationFrame(raf); root.classList.add('hidden'); UI.mode = null; UI.handler = null; done(v); };
      UI.handler = e => {
        const dir = KEY_DIR[e.key];
        if (dir) return step(dir);
        if (['x', 'X', 'Escape', 'm', 'M'].includes(e.key)) return finish(null);
        if (['z', 'Z', ' ', 'Enter'].includes(e.key)) {
          const p = places[sel];
          if (p.a.id === S.area) return;
          if (p.warpable && attuned.has(p.a.id) && !isNight()) { Sound.blip(); return finish(p); }
          Sound.bump();
        }
      };
    });
  },
};

// The Town Map replaces the old list-style map screen.
async function mapScreen() {
  const p = await MapView.open();
  if (p) await warp(...spawnNear(p.a.spawn));
}
