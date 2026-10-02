// Chiptune background music, generated in code. The mood follows the place you stand in (busy, calm, a boss on
// the roads, the Long Night) and each land gets its own key and melody, seeded from its id.
const MOODS = {
  center:  { bpm: 104, scale: [0, 2, 4, 5, 7, 9, 11], chords: [0, 3, 4, 0, 5, 3, 4, 4], lead: 'square', bass: 'triangle', vol: 0.032, density: 0.7, octave: 0 },
  working: { bpm: 136, scale: [0, 2, 4, 5, 7, 9, 11], chords: [0, 4, 5, 3, 0, 4, 3, 4], lead: 'square', bass: 'square', vol: 0.028, density: 0.85, octave: 0, arp: true },
  idle:    { bpm: 84,  scale: [0, 2, 4, 7, 9],        chords: [0, 3, 1, 4, 0, 3, 1, 2], lead: 'triangle', bass: 'triangle', vol: 0.05, density: 0.45, octave: 0 },
  boss:    { bpm: 124, scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 0, 5, 6, 0, 0, 3, 4], lead: 'sawtooth', bass: 'square', vol: 0.022, density: 0.75, octave: -1, pulse: true },
  night:   { bpm: 62,  scale: [0, 2, 3, 7, 8],        chords: [0, 3, 2, 1, 0, 3, 4, 1], lead: 'sine', bass: 'sine', vol: 0.06, density: 0.4, octave: 1 },
};

const Music = {
  ctx: null, master: null, mood: null, place: null, song: null, timer: null, step: 0, next: 0,
  get on() { return WORLD?.save?.settings.music ?? true; },

  // Which song fits where the player is right now.
  pick() {
    if (isNight()) return ['night', 'night'];
    const a = S.areas.find(x => x.id === S.area);
    const t = a?.town && town(a.town);
    if (!t) return ['center', 'hub'];
    if (t.bosses.some(b => b.kind !== 'question')) return ['boss', t.id];
    if (t.status === 'working') return ['working', t.id];
    return ['idle', t.id];
  },

  // An 8-bar loop of eighth notes: lead melody on chord tones, bass on roots, light percussion.
  compose(mood, place) {
    const m = MOODS[mood];
    const seed = [...place].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const r = rng(seed + mood.length * 101);
    const root = 48 + Math.floor(r() * 7); // C3..F#3, per land
    const deg = (d, oct = 0) => root + 12 * oct + m.scale[((d % m.scale.length) + m.scale.length) % m.scale.length] + 12 * Math.floor(d / m.scale.length);
    const lead = [], bass = [], hat = [];
    let last = 2;
    // A one-bar motif, repeated with variation, so the tune is hummable rather than random.
    const motif = Array.from({ length: 8 }, () => r() < m.density ? Math.floor(r() * 5) - 2 : null);
    for (let bar = 0; bar < 8; bar++) {
      const ch = m.chords[bar];
      for (let i = 0; i < 8; i++) {
        let n = motif[i];
        if (n !== null && bar % 4 === 3 && r() < 0.5) n = Math.floor(r() * 5) - 2; // vary the turnaround
        if (n === null) { lead.push(null); continue; }
        last = Math.max(-2, Math.min(9, ch + n + (r() < 0.3 ? last - ch : 0)));
        lead.push(deg(last, 1 + m.octave));
      }
      for (let i = 0; i < 8; i++) {
        if (m.arp) bass.push(deg(ch + [0, 2, 4, 2][i % 4]));
        else if (m.pulse) bass.push(i % 2 ? null : deg(ch));
        else bass.push(i % 4 === 0 ? deg(ch) : i % 4 === 2 && r() < 0.5 ? deg(ch + 4) : null);
        hat.push(mood === 'night' ? null : i % 2 === 1 || (mood === 'working' && r() < 0.4));
      }
    }
    return { m, lead, bass, hat, len: lead.length };
  },

  start() {
    if (!this.on || this.timer) return;
    try {
      this.ctx = Sound.ctx ??= new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    } catch { return; }
    this.timer = setInterval(() => this.tick(), 90);
  },

  stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.master) { const g = this.master; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); setTimeout(() => g.disconnect(), 1500); }
    this.master = null; this.mood = this.place = this.song = null;
  },

  // Drop the music under a fanfare, then bring it back.
  duck(sec) {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.08, t, 0.05);
    this.master.gain.setTargetAtTime(1, t + sec, 0.5);
  },

  toggle() { WORLD.save.settings.music = !this.on; api('/api/settings', { music: this.on }); this.on ? this.start() : this.stop(); },

  tick() {
    if (!this.on) return this.stop();
    if (!S.player || !this.master) return;
    const [mood, place] = this.pick();
    const now = this.ctx.currentTime;
    if (mood !== this.mood || place !== this.place) {
      // Crossfade: dip, switch songs on the next beat, swell back in.
      this.mood = mood; this.place = place;
      this.master.gain.setTargetAtTime(0, now, 0.25);
      this.pending = this.compose(mood, place);
      this.switchAt = now + 0.9;
    }
    if (this.pending && now >= this.switchAt) {
      this.song = this.pending; this.pending = null; this.step = 0; this.next = now + 0.05;
      this.master.gain.setTargetAtTime(1, now, 0.6);
    }
    if (!this.song) return;
    const { m } = this.song, dur = 60 / m.bpm / 2; // eighth notes
    while (this.next < now + 0.35) {
      const i = this.step % this.song.len;
      const n = this.song.lead[i], b = this.song.bass[i];
      if (n) this.note(n, this.next, dur * (this.song.lead[i + 1] ? 0.9 : 1.8), m.lead, m.vol);
      if (b) this.note(b - 12, this.next, dur * 0.95, m.bass, m.vol * 1.3);
      if (this.song.hat[i]) this.noise(this.next, m.vol * 0.6);
      this.step++; this.next += dur;
    }
  },

  note(midi, t, dur, type, vol) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(t, vol) {
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    this.buf ??= (() => { const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return b; })();
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 6000;
    s.buffer = this.buf; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
  },
};

// Browsers only allow audio after a user gesture.
window.addEventListener('keydown', () => Music.start(), { once: false });
window.addEventListener('mousedown', () => Music.start(), { once: false });
