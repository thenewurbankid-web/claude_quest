// Pixel sheet viewer: crisp zoom (wheel, around the cursor), pan (right/middle drag, Space+drag, or the Pan toggle),
// an optional grid, and drag-to-select a rectangle that reports [x, y, w, h] in sheet pixels.
export function createSheetView(canvas, onChange) {
  const ctx = canvas.getContext('2d');
  const st = { img: null, scale: 2, ox: 0, oy: 0, grid: true, cell: 16, snap: true, hover: null, sel: null, panMode: false };
  let drag = null, space = false, touched = false; // until the user zooms or pans, resizing refits

  const toSheet = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - st.ox) / st.scale, y: (e.clientY - r.top - st.oy) / st.scale };
  };
  const inside = p => st.img && p.x >= 0 && p.y >= 0 && p.x < st.img.width && p.y < st.img.height;
  const clampSel = (a, b) => {
    const W = st.img.width, H = st.img.height, g = st.snap ? st.cell : 1;
    let x0 = Math.floor(Math.min(a.x, b.x) / g) * g, y0 = Math.floor(Math.min(a.y, b.y) / g) * g;
    let x1 = Math.ceil((Math.max(a.x, b.x) + (st.snap ? 0.001 : 1)) / g) * g, y1 = Math.ceil((Math.max(a.y, b.y) + (st.snap ? 0.001 : 1)) / g) * g;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
  };

  function resize() {
    const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * d)); canvas.height = Math.max(1, Math.round(r.height * d));
    if (!touched && st.img) fit(); else draw();
  }
  function draw() {
    const d = devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const W = canvas.width / d, H = canvas.height / d;
    ctx.clearRect(0, 0, W, H);
    if (!st.img) return;
    const s = st.scale, iw = st.img.width * s, ih = st.img.height * s;
    // checkerboard behind transparency
    ctx.save(); ctx.beginPath(); ctx.rect(st.ox, st.oy, iw, ih); ctx.clip();
    ctx.fillStyle = '#1b2033'; ctx.fillRect(st.ox, st.oy, iw, ih);
    ctx.fillStyle = '#20263b';
    const ck = 8 * Math.max(1, Math.round(s));
    for (let y = 0; y < ih; y += ck) for (let x = (y / ck) % 2 ? ck : 0; x < iw; x += ck * 2) ctx.fillRect(st.ox + x, st.oy + y, ck, ck);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(st.img, st.ox, st.oy, iw, ih);
    if (st.grid && st.cell * s >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
      const step = st.cell * s;
      const x0 = Math.max(0, Math.floor(-st.ox / step)), x1 = Math.min(st.img.width / st.cell, Math.ceil((W - st.ox) / step));
      const y0 = Math.max(0, Math.floor(-st.oy / step)), y1 = Math.min(st.img.height / st.cell, Math.ceil((H - st.oy) / step));
      for (let i = x0; i <= x1; i++) { const x = Math.round(st.ox + i * step) + .5; ctx.moveTo(x, Math.max(st.oy, 0)); ctx.lineTo(x, Math.min(st.oy + ih, H)); }
      for (let j = y0; j <= y1; j++) { const y = Math.round(st.oy + j * step) + .5; ctx.moveTo(Math.max(st.ox, 0), y); ctx.lineTo(Math.min(st.ox + iw, W), y); }
      ctx.stroke();
    }
    const box = (r, color, fill) => {
      const [x, y, w, h] = r;
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(st.ox + x * s, st.oy + y * s, w * s, h * s); }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(st.ox + x * s + 1, st.oy + y * s + 1, w * s - 2, h * s - 2);
    };
    if (st.hover && !drag) {
      const g = st.snap ? st.cell : 1, p = st.hover;
      box([Math.floor(p.x / g) * g, Math.floor(p.y / g) * g, g, g], 'rgba(255,255,255,.55)');
    }
    if (st.sel) box(st.sel, '#ffb347', 'rgba(255,179,71,.14)');
  }
  function fit() {
    if (!st.img) return;
    const r = canvas.getBoundingClientRect();
    st.scale = Math.max(0.25, Math.min(8, Math.floor(Math.min((r.width - 24) / st.img.width, (r.height - 24) / st.img.height) * 4) / 4 || 0.25));
    st.ox = Math.round((r.width - st.img.width * st.scale) / 2); st.oy = 12;
    draw(); onChange?.(st);
  }
  function zoomAt(cx, cy, factor) {
    touched = true;
    const ns = Math.max(0.25, Math.min(48, st.scale * factor));
    st.ox = cx - (cx - st.ox) * ns / st.scale; st.oy = cy - (cy - st.oy) * ns / st.scale; st.scale = ns;
    draw(); onChange?.(st);
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || !e.shiftKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    else { touched = true; st.ox -= e.deltaX || e.deltaY; draw(); }
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (!st.img) return;
    canvas.setPointerCapture(e.pointerId);
    const pan = e.button === 1 || e.button === 2 || space || st.panMode;
    drag = pan ? { pan: true, x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy } : { pan: false, a: toSheet(e) };
    if (!pan && inside(drag.a)) { st.sel = clampSel(drag.a, drag.a); onChange?.(st); }
    canvas.style.cursor = pan ? 'grabbing' : 'crosshair';
    draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!st.img) return;
    const p = toSheet(e);
    st.hover = inside(p) ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null;
    if (drag?.pan) { touched = true; st.ox = drag.ox + e.clientX - drag.x; st.oy = drag.oy + e.clientY - drag.y; }
    else if (drag) st.sel = clampSel(drag.a, p);
    draw(); onChange?.(st);
  });
  const end = () => { drag = null; canvas.style.cursor = st.panMode ? 'grab' : 'crosshair'; draw(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { st.hover = null; draw(); onChange?.(st); });
  addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) { space = true; e.preventDefault(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') space = false; });
  new ResizeObserver(resize).observe(canvas);

  return {
    state: st,
    set(img) { st.img = img; st.sel = null; st.hover = null; touched = false; resize(); },
    fit() { touched = false; fit(); }, draw,
    zoom(f) { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); },
    setScale(s) { const r = canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, s / st.scale); },
    toggle(key, v) { st[key] = v ?? !st[key]; canvas.style.cursor = st.panMode ? 'grab' : 'crosshair'; draw(); onChange?.(st); },
    // the selected pixels as a PNG blob
    async crop() {
      if (!st.img || !st.sel) return null;
      const [x, y, w, h] = st.sel, c = document.createElement('canvas');
      c.width = w; c.height = h; c.getContext('2d').drawImage(st.img, x, y, w, h, 0, 0, w, h);
      return new Promise(ok => c.toBlob(ok, 'image/png'));
    },
  };
}
