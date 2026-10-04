// Fight sounds synthesized with WebAudio: no audio files, so nothing to license. Browsers only start audio after a
// tap, so call unlock() from a pointer event. Everything is a no-op when WebAudio is missing or sound is off.

export function createSfx() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  let ctx = null, master = null, noise = null, sfxOn = true, musicOn = false, musicTimer = 0, step = 0, nextAt = 0;
  const lastAt = {};

  function ensure() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Fast fights throw many punches a second; a sound per kind at most every `gap` ms.
  const ready = (kind, gap) => { const t = performance.now(); if (t - (lastAt[kind] ?? -1e9) < gap) return false; lastAt[kind] = t; return true; };

  function burst({ at = 0, dur = 0.15, type = 'lowpass', f0 = 900, f1 = 200, q = 0.7, gain = 0.5, out = master }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  function tone({ at = 0, dur = 0.3, f0 = 120, f1 = 50, gain = 0.5, type = 'sine', out = master }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }

  function ding(at) {
    for (const [mul, gain, dec] of [[1, 0.5, 2.2], [2.76, 0.28, 1.4], [5.4, 0.16, 0.9], [8.93, 0.08, 0.5]]) {
      tone({ at, dur: dec, f0: 780 * mul, f1: 780 * mul * 0.998, gain: gain * 0.6 });
    }
  }
  function swell(level = 0.5, secs = 1.6) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * level, t + secs * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 0.4); src.stop(t + secs + 0.05);
  }

  // A boom-bap loop at 88 bpm: kick, snare, hats and a bass line. Scheduled a little ahead of the clock.
  const BASS = [55, 0, 0, 55, 0, 65.4, 0, 0, 49, 0, 0, 49, 0, 0, 58.3, 0];
  function musicTick() {
    if (!ctx || !musicOn) return;
    const stepLen = 60 / 88 / 4;
    while (nextAt < ctx.currentTime + 0.25) {
      const at = Math.max(nextAt - ctx.currentTime, 0), s = step % 16;
      if (s === 0 || s === 7 || s === 10) tone({ at, dur: 0.22, f0: 130, f1: 42, gain: 0.5 });
      if (s === 4 || s === 12) { burst({ at, dur: 0.16, type: 'highpass', f0: 1800, f1: 900, gain: 0.3 }); tone({ at, dur: 0.1, f0: 220, f1: 160, gain: 0.18, type: 'triangle' }); }
      if (s % 2 === 0) burst({ at, dur: 0.05, type: 'highpass', f0: 7000, f1: 6000, gain: 0.07 });
      if (BASS[s]) tone({ at, dur: stepLen * 3, f0: BASS[s] * 2, f1: BASS[s] * 2, gain: 0.22, type: 'triangle' });
      nextAt += stepLen; step++;
    }
  }

  return {
    available: !!AC,
    unlock: ensure,
    setEnabled(on) { sfxOn = on; },
    setMusic(on) {
      musicOn = on;
      clearInterval(musicTimer);
      if (on && ensure()) { step = 0; nextAt = ctx.currentTime + 0.05; musicTimer = setInterval(musicTick, 80); }
    },
    click() { if (sfxOn && ensure() && ready('click', 40)) tone({ dur: 0.06, f0: 900, f1: 500, gain: 0.12, type: 'triangle' }); },
    bell(times = 1) { if (sfxOn && ensure()) for (let i = 0; i < times; i++) ding(i * 0.22); },
    /** A landed punch; `joules` scales weight. */
    hit(joules = 60) {
      if (!sfxOn || !ensure() || !ready('hit', 45)) return;
      const k = Math.min(Math.max(joules / 200, 0.15), 1);
      burst({ dur: 0.09 + 0.12 * k, f0: 1400, f1: 180, gain: 0.35 + 0.5 * k });
      tone({ dur: 0.1 + 0.18 * k, f0: 150 - 40 * k, f1: 45, gain: 0.3 + 0.55 * k });
    },
    block() { if (sfxOn && ensure() && ready('block', 45)) burst({ dur: 0.07, type: 'bandpass', f0: 500, f1: 300, q: 1.2, gain: 0.25 }); },
    whoosh() { if (sfxOn && ensure() && ready('whoosh', 70)) burst({ dur: 0.14, type: 'bandpass', f0: 500, f1: 2400, q: 0.9, gain: 0.1 }); },
    crowd(level = 0.5) { if (sfxOn && ensure() && ready('crowd', 700)) swell(level); },
    ko() {
      if (!sfxOn || !ensure()) return;
      tone({ dur: 0.9, f0: 90, f1: 28, gain: 0.8 });
      burst({ dur: 0.25, f0: 2000, f1: 120, gain: 0.7 });
      swell(1, 2.6);
    },
    win() { if (sfxOn && ensure()) { tone({ dur: 0.18, f0: 392, f1: 392, gain: 0.25, type: 'triangle' }); tone({ at: 0.16, dur: 0.18, f0: 523, f1: 523, gain: 0.25, type: 'triangle' }); tone({ at: 0.32, dur: 0.5, f0: 659, f1: 659, gain: 0.3, type: 'triangle' }); swell(0.7, 2); } },
    lose() { if (sfxOn && ensure()) { tone({ dur: 0.4, f0: 330, f1: 262, gain: 0.25, type: 'triangle' }); tone({ at: 0.35, dur: 0.7, f0: 247, f1: 196, gain: 0.25, type: 'triangle' }); } },
  };
}
