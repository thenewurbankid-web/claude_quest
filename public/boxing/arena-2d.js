// BOX-17: photoreal 2D view. A baked court plate with pre-rendered Cycles fighter clips composited on a canvas.
// Reads sim.snapshot() and 'impact' events only (never writes to the sim); clip choice and timing come from clips2d.js.
import { TICK_MS } from './physics-engine.js';
import { FRAME, RENDER_SCALE, GAP_REF, pxPerMetre } from './camera2d.js';
import { ATTACK_CLIP, reactionClip, clipRate, resolveClip, clipFrame, planImpact } from './clips2d.js';

const SHAKE_MS = 220;

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img); img.onerror = () => reject(new Error(`could not load ${src}`));
  img.src = src;
});

export async function createArena2D({ parent, sim, timeOfDay = 'day', base = new URL('./', import.meta.url).href }) {
  const manifest = await (await fetch(`${base}sprites2d/manifest.json`)).json();
  const plate = await loadImage(`${base}plates/medium_${timeOfDay === 'night' ? 'night' : 'day'}.webp`).catch(() => loadImage(`${base}plates/medium_day.webp`));
  const sheets = {};
  await Promise.all(['red', 'blue'].flatMap((c) => Object.values(manifest.corners[c].clips).map(async (k) => { sheets[k.file] = await loadImage(`${base}sprites2d/${k.file}`); })));
  const have = new Set(Object.keys(manifest.corners.red.clips));

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;background:#000';
  canvas.setAttribute('aria-label', 'Photoreal 2D view of the fight');
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const ppm = pxPerMetre();
  // state per corner: the clip playing, when it started (sim ms), its rate, and the last attack launch seen
  const st = { red: { clip: 'idle_guard', start: 0, rate: 1, launch: -1, hold: false }, blue: { clip: 'idle_guard', start: 0, rate: 1, launch: -1, hold: false } };
  let shakeUntil = 0, shakeAmp = 0, lastTMs = 0;
  const play = (corner, clip, tMs, rate = 1, hold = false) => { Object.assign(st[corner], { clip: resolveClip(clip, have), start: tMs, rate, hold }); };

  const offImpact = sim.on('impact', (rec) => {
    const plan = planImpact(rec);
    play(plan.defender.corner, plan.defender.clip, sim.tMs, 1, !!rec.knockout);
    if (plan.fx.shake > 0) { shakeUntil = performance.now() + SHAKE_MS; shakeAmp = 6 * plan.fx.shake; }
  });

  function draw() {
    const s = sim.snapshot();
    const tMs = s.tMs;
    if (tMs < lastTMs) for (const c of ['red', 'blue']) play(c, 'idle_guard', tMs);   // new match / rewound
    lastTMs = tMs;
    for (const c of ['red', 'blue']) {
      const ap = s[c].activePunch, o = st[c];
      if (ap && ap.launchTick !== o.launch && !o.hold) {
        o.launch = ap.launchTick;
        const name = resolveClip(ATTACK_CLIP[ap.type] ?? 'atk_jab', have);
        play(c, name, ap.launchTick * TICK_MS, clipRate(name, ap.launchTick, ap.arriveTick));
      }
    }

    const w = parent.clientWidth || 1, h = parent.clientHeight || 1;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const u = Math.min(canvas.width / FRAME.w, canvas.height / FRAME.h);   // canvas px per logical px (contain)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const shaking = performance.now() < shakeUntil;
    const sx = shaking ? (Math.random() - 0.5) * shakeAmp * u : 0, sy = shaking ? (Math.random() - 0.5) * shakeAmp * u : 0;
    ctx.setTransform(u, 0, 0, u, (canvas.width - FRAME.w * u) / 2 + sx, (canvas.height - FRAME.h * u) / 2 + sy);
    ctx.drawImage(plate, 0, 0, FRAME.w, FRAME.h);

    const gap = Math.hypot(s.red.x - s.blue.x, s.red.y - s.blue.y);
    const shift = Math.max(-110, Math.min(110, -((gap - GAP_REF) / 2) * ppm));   // outward from centre in each fighter's own frame
    const idle = manifest.corners.red.clips.idle_guard;
    // blue (mirrored) first so red overlaps on a clinch; a finished one-shot returns to guard
    for (const c of ['blue', 'red']) {
      const at = () => { const k = manifest.corners[c].clips[st[c].clip]; return { k, ...clipFrame(k, tMs - st[c].start + (k.loop && c === 'blue' ? 500 : 0), st[c].rate) }; };
      let cur = at();
      if (cur.done && !st[c].hold) { play(c, 'idle_guard', tMs); cur = at(); }
      const { k, frame } = cur;
      const sheet = sheets[k.file];
      const sxp = (frame % k.cols) * k.cw, syp = Math.floor(frame / k.cols) * k.ch;
      const dw = k.rw / RENDER_SCALE, dh = k.rh / RENDER_SCALE;
      const dx = k.ox / RENDER_SCALE + shift, dy = k.oy / RENDER_SCALE;
      ctx.save();
      if (c === 'blue') { ctx.translate(FRAME.w, 0); ctx.scale(-1, 1); }
      const footY = (idle.oy + idle.rh) / RENDER_SCALE, cx = (idle.ox + idle.rw * 0.45) / RENDER_SCALE + shift;
      const sh = ctx.createRadialGradient(cx, footY - 6, 2, cx, footY - 6, 0.55 * ppm);
      sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(cx, footY - 6); ctx.scale(1, 0.22); ctx.translate(-cx, -(footY - 6));
      ctx.fillStyle = sh; ctx.fillRect(cx - 0.6 * ppm, footY - 6 - 0.6 * ppm, 1.2 * ppm, 1.2 * ppm); ctx.restore();
      ctx.drawImage(sheet, sxp, syp, k.cw, k.ch, dx, dy, dw, dh);
      ctx.restore();
    }

    // filmic vignette
    const g = ctx.createRadialGradient(FRAME.w / 2, FRAME.h * 0.5, FRAME.h * 0.3, FRAME.w / 2, FRAME.h * 0.5, FRAME.h * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, FRAME.w, FRAME.h);
  }

  let raf = 0, dead = false;
  const loop = () => { if (dead) return; try { draw(); } catch (e) { console.warn(e); } raf = requestAnimationFrame(loop); };
  loop();
  return { destroy() { dead = true; cancelAnimationFrame(raf); offImpact(); canvas.remove(); } };
}
