// GBA-style UI overlay: dialog with typewriter text, choice boxes, list panels, text input,
// start menu, toasts. Every call returns a promise so game scripts read top to bottom.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const UI = {
  mode: null, // null | 'say' | 'choose' | 'panel' | 'input' | 'menu'
  busy: 0,    // >0 while a scripted conversation runs; blocks walking
  handler: null,

  get open() { return this.mode !== null || this.busy > 0; },

  // The companion goes by the name the player gave it. Place names (the Keeper's Lodge) keep the word.
  name(s) {
    const n = (typeof WORLD !== 'undefined' && WORLD?.save?.settings.keeperName) || '';
    if (!n || s == null) return s;
    return String(s)
      .replace(/\bKeepers\b/g, `${n}s`)
      .replace(/\bKeeper\b(?!'s Lodge)/g, n)
      .replace(/\bKEEPER\b/g, n.toUpperCase());
  },

  // Buttons and clicks feed the same handlers as the keyboard.
  press(key) { this.handler?.({ key, preventDefault() {} }); },

  key(e) {
    if (!this.handler) return false;
    return this.handler(e) !== false;
  },

  // Split long text into pages that fit the 3-line dialog box.
  paginate(text, max = 120) {
    const pages = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        if ((cur + ' ' + w).trim().length > max) { if (cur) pages.push(cur); cur = w; }
        else cur = (cur + ' ' + w).trim();
      }
      if (cur) pages.push(cur);
    }
    return pages;
  },

  // opts.auto: ms after a page finishes typing before it advances by itself (autoplay).
  say(lines, { auto = 0 } = {}) {
    const pages = [].concat(lines).filter(Boolean).flatMap(l => this.paginate(this.name(l)));
    return new Promise(done => {
      if (!pages.length) return done();
      const box = $('dialog'), txt = $('dtext'), more = $('dmore');
      let i = 0, shown = 0, timer = null;
      box.classList.remove('hidden');
      this.mode = 'say';
      const show = () => {
        const page = pages[i];
        txt.classList.toggle('small', page.length > 100);
        shown = 0; more.classList.add('hidden');
        clearInterval(timer);
        timer = setInterval(() => {
          shown = Math.min(page.length, shown + 2);
          txt.textContent = page.slice(0, shown);
          if (shown >= page.length) {
            clearInterval(timer); more.classList.remove('hidden');
            if (auto) { clearTimeout(this._auto); this._auto = setTimeout(() => this.handler?.({ key: 'z' }), auto); }
          }
        }, 16);
        Sound.blip();
      };
      show();
      box.onclick = () => this.press('z');
      this.handler = e => {
        if (!['z', 'Z', ' ', 'Enter', 'x', 'X'].includes(e.key)) return;
        if (shown < pages[i].length) { shown = pages[i].length; txt.textContent = pages[i]; clearInterval(timer); more.classList.remove('hidden'); return; }
        if (++i < pages.length) return show();
        clearInterval(timer);
        box.classList.add('hidden');
        this.mode = null; this.handler = null;
        done();
      };
    });
  },

  // Shows `prompt` in the dialog box and a cursor menu of options. Resolves to index, or -1 on X.
  choose(prompt, options, { menu = false } = {}) {
    return new Promise(done => {
      const box = $('dialog'), txt = $('dtext'), list = $('choices');
      list.classList.toggle('menu', menu);
      if (prompt) {
        box.classList.remove('hidden');
        txt.classList.toggle('small', prompt.length > 110);
        txt.textContent = this.name(prompt);
        $('dmore').classList.add('hidden');
      }
      let sel = 0;
      const render = () => {
        list.innerHTML = `<button class="back" data-back>◀ Back</button>` + options.map((o, k) => `<div class="opt${k === sel ? ' sel' : ''}" data-k="${k}">${esc(this.name(o))}</div>`).join('');
        list.onclick = e => { if (e.target.closest('[data-back]')) return finish(-1); const o = e.target.closest('[data-k]'); if (o) { Sound.blip(); finish(+o.dataset.k); } };
        list.querySelectorAll('.opt')[sel]?.scrollIntoView({ block: 'nearest' });
      };
      list.classList.remove('hidden');
      render();
      this.mode = 'choose';
      const finish = v => {
        list.classList.add('hidden'); box.classList.add('hidden');
        this.mode = null; this.handler = null;
        done(v);
      };
      this.handler = e => {
        if (e.key === 'ArrowDown' || e.key === 's') { sel = (sel + 1) % options.length; Sound.tick(); render(); }
        else if (e.key === 'ArrowUp' || e.key === 'w') { sel = (sel + options.length - 1) % options.length; Sound.tick(); render(); }
        else if (['z', 'Z', ' ', 'Enter'].includes(e.key)) { Sound.blip(); finish(sel); }
        else if (['x', 'X', 'Escape'].includes(e.key)) finish(-1);
      };
    });
  },

  // Scrollable list. items: [{label, sub, tag, tagColor}]. Resolves to index or -1.
  // opts.header: trusted HTML shown above the list (HP bars, map image, stats).
  panel(title, items, { right = '', hint, header = '' } = {}) {
    return new Promise(done => {
      const box = $('panel'), list = $('plist');
      $('ptitle').innerHTML = `<span><button class="back" data-back>◀ Back</button>${esc(title)}</span><span>${esc(right)}</span>`;
      $('ptitle').onclick = e => { if (e.target.closest('[data-back]')) finish(-1); };
      list.onclick = e => { const o = e.target.closest('[data-k]'); if (o && items.length) { Sound.blip(); finish(+o.dataset.k); } };
      $('pheader').innerHTML = header;
      $('pheader').classList.toggle('hidden', !header);
      $('phint').textContent = hint || (items.length ? '↑↓ choose · Z open · X close' : 'X close');
      let sel = 0;
      const render = () => {
        list.innerHTML = items.length ? items.map((it, k) => `<div class="opt${k === sel ? ' sel' : ''}" data-k="${k}">` +
          (it.tag ? `<span class="tag" style="background:${it.tagColor || '#888'}">${esc(it.tag)}</span>` : '') +
          `${esc(this.name(it.label))}${it.sub ? `<div class="sub">${esc(this.name(it.sub))}</div>` : ''}</div>`).join('')
          : '<div class="sub">Nothing here yet.</div>';
        list.children[sel]?.scrollIntoView({ block: 'nearest' });
      };
      box.classList.remove('hidden');
      render();
      this.mode = 'panel';
      const finish = v => { box.classList.add('hidden'); this.mode = null; this.handler = null; done(v); };
      this.handler = e => {
        if (!items.length) { if (['x', 'X', 'Escape', 'z', 'Z', 'Enter'].includes(e.key)) finish(-1); return; }
        if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); Sound.tick(); render(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); Sound.tick(); render(); }
        else if (['z', 'Z', ' ', 'Enter'].includes(e.key)) { Sound.blip(); finish(sel); }
        else if (['x', 'X', 'Escape'].includes(e.key)) finish(-1);
      };
    });
  },

  ask(label, initial = '') {
    return new Promise(done => {
      const box = $('input'), ta = $('itext');
      $('ilabel').textContent = this.name(label);
      ta.value = initial;
      box.classList.remove('hidden');
      this.mode = 'input';
      setTimeout(() => ta.focus(), 30);
      const finish = v => { box.classList.add('hidden'); ta.blur(); this.mode = null; this.handler = null; done(v); };
      this.handler = e => {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(ta.value.trim() || null); }
        else return false; // let the textarea receive normal typing
      };
    });
  },

  toast(html) {
    const el = document.createElement('div');
    el.className = 'box toast';
    el.innerHTML = this.name(html);
    $('toasts').prepend(el);
    setTimeout(() => el.remove(), 6200);
    while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
  },

  banner(text) {
    const b = $('banner');
    b.textContent = this.name(text);
    b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.add('hidden'), 2900);
  },

  // Wrap an async conversation so the player can't walk while it runs.
  async run(fn) {
    if (this.busy) return;
    this.busy++;
    try { await fn(); } catch (e) { console.error(e); await this.say(`Something went wrong: ${e.message}`); }
    finally { this.busy--; }
  },
};

// Tiny square-wave chirps, GBA-ish. Silent until the first keypress (browser autoplay rules).
const Sound = {
  ctx: null, on: true,
  tone(freq, dur, type = 'square', vol = 0.04) {
    if (!this.on) return;
    try {
      this.ctx ??= new AudioContext();
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g).connect(this.ctx.destination);
      const t = this.ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch {}
  },
  blip() { this.tone(880, 0.05); },
  tick() { this.tone(660, 0.03); },
  bump() { this.tone(110, 0.08, 'triangle', 0.08); },
  mail() { [988, 1319, 1568].forEach((f, i) => setTimeout(() => this.tone(f, 0.12), i * 110)); },
  alert() { [1568, 1568].forEach((f, i) => setTimeout(() => this.tone(f, 0.07), i * 120)); },
  warp() { for (let i = 0; i < 10; i++) setTimeout(() => this.tone(300 + i * 90, 0.05, 'sine', 0.05), i * 40); },
  pop() { this.tone(180 + Math.random() * 200, 0.12, 'triangle', 0.06); },
  // A soft glassy arpeggio for the spirit's rift (rising in, falling out).
  chime(out = false) { const n = [1319, 1568, 1976, 2637]; (out ? n.reverse() : n).forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'sine', 0.035), i * 70)); },
  // The item-get fanfare.
  fanfare() {
    const notes = [[784, 0.12], [784, 0.12], [784, 0.12], [1047, 0.5], [0, 0.1], [932, 0.25], [1047, 0.25], [1175, 0.25], [1568, 0.7]];
    let t = 0;
    for (const [f, d] of notes) { if (f) setTimeout(() => { this.tone(f, d, 'square', 0.05); this.tone(f / 2, d, 'triangle', 0.05); }, t * 1000); t += d * 0.9; }
  },
  jingle() { [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => this.tone(f, 0.16), i * 140)); },
};
