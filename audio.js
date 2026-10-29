/*
 * PARROT CROSSING — sound & music.
 * Everything is synthesized with the Web Audio API, so there are no audio files to load.
 * Each of the five worlds has its own music theme; the music speeds up and gets tenser
 * when the cat is stalking you. Press M (or tap the speaker button) to mute.
 */
(() => {
  'use strict';

  const MUTE_KEY = 'parrotCrossing.muted';
  const VOL_KEY = 'parrotCrossing.volumes';
  const DEFAULT_VOL = { master: 0.85, music: 0.75, sfx: 0.9 };
  const MUSIC_SCALE = 0.45;                      // music slider at 100% = this much bus gain
  const vol = Object.assign({}, DEFAULT_VOL);
  try {
    const s = JSON.parse(localStorage.getItem(VOL_KEY) || 'null');
    if (s) for (const k in vol) if (typeof s[k] === 'number') vol[k] = Math.min(1, Math.max(0, s[k]));
  } catch (e) { /* ignore */ }
  let inMenu = false, menuReady = false;
  const musTarget = () => (paused && !inMenu ? 0.25 : 1) * vol.music * MUSIC_SCALE;
  let ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  let muted = false, paused = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage unavailable */ }

  const hz = (root, semi) => root * Math.pow(2, semi / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------------
   * Engine setup
   * ------------------------------------------------------------------ */
  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol.master;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = musTarget(); musBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const live = () => ctx && !muted && ctx.state === 'running';
  const now = () => ctx.currentTime;

  /** One oscillator note with a quick attack and exponential decay. */
  function tone(f, t, dur, o = {}) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    const v = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.value = o.lp;
      osc.connect(fl); node = fl;
    }
    node.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1];
      l.connect(lg); lg.connect(osc.frequency);
      l.start(t); l.stop(t + dur + 0.05);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** A filtered burst of noise (splashes, thuds, whooshes, hi-hats). */
  function noise(t, dur, o = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = o.type || 'lowpass';
    fl.frequency.setValueAtTime(o.f || 1000, t);
    if (o.to) fl.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    fl.Q.value = o.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol == null ? 0.2 : o.vol, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.6);
    src.stop(t + dur + 0.05);
  }

  /** A cat-ish "meow": a sawtooth with a vowel-like filter and a rise-and-fall pitch. */
  function meow(t, k, dur, vol) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(430 * k, t);
    osc.frequency.linearRampToValueAtTime(820 * k, t + dur * 0.35);
    osc.frequency.linearRampToValueAtTime(480 * k, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(1800, t + dur * 0.4);
    bp.frequency.linearRampToValueAtTime(1000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(bp); bp.connect(g); g.connect(sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  const arp = (freqs, t, gap, dur, o) => freqs.forEach((f, i) => tone(f, t + i * gap, dur, o));
  const chirp = (t, base) => {
    tone(base, t, 0.07, { type: 'sine', to: base * 1.35, vol: 0.12 });
    tone(base * 1.25, t + 0.08, 0.09, { type: 'sine', to: base * 1.7, vol: 0.12 });
  };

  /* ------------------------------------------------------------------
   * Sound effects
   * ------------------------------------------------------------------ */
  const fx = (fn) => (...a) => { if (live()) fn(now(), ...a); };

  const S = {
    hop: fx((t, dir, boot) => {
      const f = (dir === 'f' ? 520 : dir === 'b' ? 360 : 440) * rnd(0.97, 1.04);
      tone(f, t, 0.1, { type: 'triangle', to: f * 1.6, vol: 0.2 });
      if (boot === 'goldboots' || boot === 'fireboots') tone(f * 3, t + 0.03, 0.12, { type: 'sine', vol: 0.06 });
      if (dir === 'f' && Math.random() < 0.09) chirp(t + 0.06, rnd(1500, 1900));     // the occasional parrot tweet
    }),
    bump: fx((t) => tone(120, t, 0.07, { type: 'square', to: 80, vol: 0.1, lp: 400 })),
    land: fx((t, kind) => {
      if (kind === 'log') {
        tone(160, t, 0.09, { type: 'triangle', to: 100, vol: 0.2 });
        noise(t, 0.08, { type: 'bandpass', f: 1500, vol: 0.05 });
      } else if (kind === 'road') {
        noise(t, 0.06, { f: 500, vol: 0.12 });
      } else {
        tone(230, t, 0.06, { type: 'sine', to: 140, vol: 0.12 });
        noise(t, 0.04, { f: 2200, vol: 0.04 });
      }
    }),
    coin: fx((t, n) => {
      const steps = [0, 2, 4, 5, 7, 9, 11, 12];
      const f = 988 * Math.pow(2, steps[clamp((n || 1) - 1, 0, 7)] / 12);
      tone(f, t, 0.1, { type: 'square', vol: 0.08, lp: 4000 });
      tone(f * 1.5, t + 0.06, 0.24, { type: 'square', vol: 0.08, lp: 4000 });
      tone(f * 3, t + 0.06, 0.2, { type: 'sine', vol: 0.05 });
    }),
    combo: fx((t) => arp([523, 659, 784, 1047, 1319], t, 0.06, 0.16, { type: 'triangle', vol: 0.2 })),
    honk: fx((t, type) => {
      if (type === 'police') {
        for (let i = 0; i < 4; i++) tone(i % 2 ? 988 : 740, t + i * 0.16, 0.17, { type: 'sawtooth', vol: 0.09, lp: 2500 });
      } else if (type === 'icecream') {
        arp([1319, 1047, 1319, 1047], t, 0.13, 0.18, { type: 'triangle', vol: 0.14 });
      } else if (type === 'bus' || type === 'truck') {
        tone(165, t, 0.34, { type: 'square', vol: 0.12, lp: 700 });
        tone(208, t, 0.34, { type: 'square', vol: 0.1, lp: 700 });
      } else {
        tone(523, t, 0.11, { type: 'square', vol: 0.08, lp: 1800 });
        tone(523, t + 0.16, 0.14, { type: 'square', vol: 0.08, lp: 1800 });
      }
    }),
    die: fx((t, type) => {
      if (type === 'car') {
        noise(t, 0.35, { f: 900, to: 200, vol: 0.5 });
        tone(260, t, 0.4, { type: 'sawtooth', to: 50, vol: 0.22, lp: 900 });
        tone(1100, t, 0.2, { type: 'square', to: 400, vol: 0.1, vib: [30, 60] });
      } else if (type === 'cat') {
        noise(t, 0.14, { f: 1500, vol: 0.3 });
        tone(80, t, 0.28, { type: 'square', to: 40, vol: 0.3, lp: 300 });
        tone(900, t, 0.32, { type: 'sawtooth', to: 300, vol: 0.18, lp: 2000, vib: [25, 50] });
      } else if (type === 'bear') {                                 // CHOMP, rattle, BOING
        tone(2400, t, 0.08, { type: 'square', to: 900, vol: 0.22 });
        noise(t, 0.12, { type: 'highpass', f: 3000, vol: 0.3 });
        tone(110, t, 0.2, { type: 'square', to: 60, vol: 0.25, lp: 400 });
        tone(1000, t + 0.05, 0.3, { type: 'sawtooth', to: 350, vol: 0.13, lp: 2500, vib: [30, 60] });
        for (let i = 0; i < 6; i++) tone(300 + (i % 2) * 80, t + 0.15 + i * 0.11, 0.06, { type: 'square', vol: 0.05, lp: 1500 });
        tone(150, t + 0.85, 0.45, { type: 'sine', to: 900, vol: 0.25, vib: [10, 80] });
        arp([2093, 2637, 3136], t + 1.25, 0.1, 0.2, { type: 'sine', vol: 0.06 });
      } else if (type === 'snare') {                                // zip, whoosh, dangling "help"
        noise(t, 0.18, { type: 'highpass', f: 1500, to: 5000, vol: 0.25 });
        tone(200, t + 0.05, 0.2, { type: 'triangle', to: 900, vol: 0.18 });
        tone(110, t + 0.22, 0.12, { type: 'square', to: 70, vol: 0.18, lp: 500 });
        tone(700, t + 0.4, 0.8, { type: 'sawtooth', vol: 0.08, lp: 1800, vib: [8, 80] });
        for (let i = 0; i < 4; i++) tone(260, t + 0.5 + i * 0.3, 0.12, { type: 'sawtooth', to: 220, vol: 0.04, lp: 700 });
      } else if (type === 'hole') {                                 // falling whistle, then a poof
        tone(1400, t, 0.9, { type: 'sine', to: 140, vol: 0.2, vib: [6, 40] });
        tone(1400, t + 0.02, 0.9, { type: 'triangle', to: 140, vol: 0.06 });
        noise(t + 0.9, 0.25, { f: 600, to: 120, vol: 0.3 });
        tone(90, t + 0.9, 0.2, { type: 'sine', to: 50, vol: 0.3 });
        tone(1760, t + 1.05, 0.3, { type: 'sine', vol: 0.05 });
      } else if (type === 'banana') {                               // squeak, whirl, SPLAT, sad slide whistle
        tone(1800, t, 0.1, { type: 'square', to: 700, vol: 0.08, lp: 3000 });
        tone(300, t + 0.1, 0.55, { type: 'triangle', to: 1200, vol: 0.14, vib: [16, 60] });
        noise(t + 0.1, 0.5, { type: 'bandpass', f: 800, to: 2500, vol: 0.15 });
        noise(t + 0.7, 0.15, { f: 1200, to: 200, vol: 0.4 });
        tone(120, t + 0.7, 0.2, { type: 'sine', to: 60, vol: 0.3 });
        tone(900, t + 0.78, 0.35, { type: 'sine', to: 200, vol: 0.1 });
      } else if (type === 'anvil') {                                // whistle, CLANG, boing
        tone(2200, t, 0.28, { type: 'sine', to: 500, vol: 0.14 });
        [523, 830, 1245, 1760].forEach((f) => tone(f, t + 0.28, 0.9, { type: 'square', vol: 0.06, lp: 5000 }));
        noise(t + 0.28, 0.1, { type: 'highpass', f: 2500, vol: 0.3 });
        tone(70, t + 0.28, 0.3, { type: 'sine', to: 40, vol: 0.4 });
        tone(200, t + 0.34, 0.35, { type: 'sine', to: 700, vol: 0.1, vib: [10, 60] });
        [523, 830, 1245].forEach((f) => tone(f, t + 0.78, 0.4, { type: 'square', vol: 0.025, lp: 4000 }));
      } else {                                                      // water / swept away
        noise(t, 0.55, { type: 'bandpass', f: 1800, to: 300, vol: 0.35 });
        tone(700, t, 0.24, { type: 'sine', to: 180, vol: 0.2 });
        tone(520, t + 0.16, 0.24, { type: 'sine', to: 140, vol: 0.16 });
      }
      duck(type === 'bear' || type === 'snare' || type === 'anvil' ? 1.8 : 1.3);
    }),
    catAppear: fx((t, scale) => {
      const k = Math.max(0.4, 1.3 - 0.25 * (scale || 1));
      meow(t, k, 0.55, 0.16);
    }),
    catWindup: fx((t) => {
      tone(70, t, 0.42, { type: 'sawtooth', vol: 0.14, lp: 300, vib: [18, 22] });
      tone(1200, t, 0.06, { type: 'square', vol: 0.08, lp: 3000 });
    }),
    catPounce: fx((t) => {
      noise(t, 0.28, { type: 'highpass', f: 600, to: 3200, vol: 0.22 });
      tone(300, t, 0.22, { type: 'triangle', to: 700, vol: 0.12 });
    }),
    catFling: fx((t) => {
      meow(t, 2.1, 0.4, 0.17);
      tone(300, t, 0.4, { type: 'sine', to: 900, vol: 0.12, vib: [14, 40] });
      arp([1319, 1568, 2093], t + 0.15, 0.07, 0.14, { type: 'sine', vol: 0.07 });
    }),
    catGiveup: fx((t) => tone(520, t, 0.35, { type: 'sine', to: 240, vol: 0.09 })),
    revive: fx((t) => {
      arp([392, 523, 659, 784, 1047, 1319], t, 0.06, 0.2, { type: 'triangle', vol: 0.17 });
      tone(2093, t + 0.2, 0.5, { type: 'sine', vol: 0.05, vib: [8, 25] });
    }),
    celebrate: fx((t) => {
      arp([523, 659, 784], t, 0.09, 0.14, { type: 'square', vol: 0.07, lp: 3000 });
      tone(1047, t + 0.27, 0.36, { type: 'square', vol: 0.08, lp: 3000 });
      tone(1047, t + 0.27, 0.36, { type: 'triangle', vol: 0.14 });
    }),
    biome: fx((t, i) => {
      const th = THEMES[clamp(i, 0, THEMES.length - 1)];
      const notes = [0, 2, 4].map((d) => hz(th.root * 2, degToSemi(th, d + 2)));
      arp(notes, t, 0.1, 0.3, { type: 'triangle', vol: 0.18 });
      tone(notes[2] * 2, t + 0.3, 0.45, { type: 'sine', vol: 0.07, vib: [6, 10] });
    }),
    start: fx((t) => {
      tone(300, t, 0.22, { type: 'triangle', to: 900, vol: 0.12 });
      chirp(t + 0.12, 1500);
      chirp(t + 0.34, 1800);
    }),
    gameOver: fx((t, isBest) => {
      if (isBest) {
        arp([523, 659, 784, 1047, 1319], t + 0.1, 0.1, 0.25, { type: 'triangle', vol: 0.2 });
        tone(1568, t + 0.6, 0.6, { type: 'sine', vol: 0.08, vib: [7, 20] });
      } else {
        const f = [392, 370, 349];
        f.forEach((x, i) => tone(x, t + 0.1 + i * 0.26, 0.26, { type: 'sawtooth', vol: 0.11, lp: 900 }));
        tone(330, t + 0.88, 0.7, { type: 'sawtooth', to: 290, vol: 0.11, lp: 900, vib: [6, 8] });
      }
      mus.biome = 0; mus.int = 0; mus.step = 0;                    // calm meadow theme on the menu
    }),
    caseShake: fx((t) => {
      for (let i = 0; i < 6; i++) {
        noise(t + i * 0.2, 0.07, { type: 'bandpass', f: 900, vol: 0.22 });
        tone(i % 2 ? 150 : 120, t + i * 0.2, 0.1, { type: 'triangle', vol: 0.18 });
      }
      tone(200, t + 0.2, 1.05, { type: 'triangle', to: 1000, vol: 0.07 });
    }),
    reveal: fx((t, rarity) => {
      if (rarity === 'legendary') {
        tone(131, t, 1.6, { type: 'sawtooth', vol: 0.12, lp: 600 });
        arp([523, 659, 784, 1047, 1319, 1568, 2093], t, 0.08, 0.5, { type: 'triangle', vol: 0.18 });
        arp([523, 659, 784, 1047], t, 0.0, 1.4, { type: 'square', vol: 0.04, lp: 2500 });
        for (let i = 0; i < 12; i++) tone(rnd(2000, 4200), t + 0.4 + i * 0.1, 0.18, { type: 'sine', vol: 0.05 });
        noise(t, 0.7, { type: 'highpass', f: 3000, vol: 0.08 });
      } else if (rarity === 'epic') {
        arp([523, 659, 784, 1047, 1319, 1568], t, 0.07, 0.35, { type: 'triangle', vol: 0.18 });
        noise(t + 0.3, 0.5, { type: 'highpass', f: 5000, vol: 0.05 });
      } else if (rarity === 'rare') {
        arp([659, 880, 1319], t, 0.1, 0.4, { type: 'triangle', vol: 0.18 });
      } else {
        arp([784, 1175], t, 0.1, 0.3, { type: 'sine', vol: 0.2 });
      }
    }),
    buy: fx((t) => {
      tone(1568, t, 0.1, { type: 'square', vol: 0.07, lp: 4000 });
      tone(2093, t + 0.08, 0.3, { type: 'square', vol: 0.07, lp: 4000 });
      noise(t, 0.04, { type: 'highpass', f: 4000, vol: 0.05 });
    }),
    click: fx((t) => tone(700, t, 0.04, { type: 'square', vol: 0.05, lp: 3000 })),
  };

  /** Briefly dip the music (used when something dramatic happens). */
  function duck(sec) {
    if (!ctx) return;
    const t = now(), base = musTarget();
    musBus.gain.cancelScheduledValues(t);
    musBus.gain.setTargetAtTime(0.04, t, 0.03);
    musBus.gain.setTargetAtTime(base, t + sec, 0.4);
  }

  /* ------------------------------------------------------------------
   * Music: one theme per world, built from a seeded random walk on a scale
   * ------------------------------------------------------------------ */
  const THEMES = [
    { name: 'Sunny Meadow', bpm: 118, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 3], seed: 11, density: 0.6,
      lead: 'triangle', leadVol: 0.34, leadLp: 3500, noteLen: 1.9, bass: 'triangle', bassVol: 0.42, bassLp: 700, bassSteps: [0, 6, 8, 14], drum: 'pop' },
    { name: 'Sunbaked Desert', bpm: 104, root: 293.66, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 3, 0, 4], seed: 27, density: 0.5,
      lead: 'sawtooth', leadVol: 0.22, leadLp: 1700, noteLen: 2.6, bass: 'triangle', bassVol: 0.42, bassLp: 600, bassSteps: [0, 10], drum: 'tabla' },
    { name: 'Frosty Peaks', bpm: 88, root: 392, scale: [0, 2, 4, 7, 9], prog: [0, 2, 3, 1], seed: 5, density: 0.38,
      lead: 'sine', leadVol: 0.4, leadLp: 6000, noteLen: 3, bass: 'sine', bassVol: 0.4, bassLp: 500, bassSteps: [0, 8], drum: 'sleigh', echo: true },
    { name: 'Autumn Woods', bpm: 96, root: 220, scale: [0, 3, 5, 7, 10], prog: [0, 4, 3, 2], seed: 42, density: 0.52,
      lead: 'triangle', leadVol: 0.38, leadLp: 2800, noteLen: 1.5, bass: 'triangle', bassVol: 0.44, bassLp: 600, bassSteps: [0, 8, 14], drum: 'folk' },
    { name: 'Ember Ridge', bpm: 134, root: 164.81, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 5], seed: 77, density: 0.55,
      lead: 'sawtooth', leadVol: 0.2, leadLp: 2200, noteLen: 1.3, bass: 'sawtooth', bassVol: 0.3, bassLp: 480, bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], drum: 'drive' },
  ];
  const degToSemi = (th, d) => {
    const n = th.scale.length;
    return th.scale[((d % n) + n) % n] + 12 * Math.floor(d / n);
  };
  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  THEMES.forEach((th) => {                                          // write a 4-bar melody for each world
    const r = mulberry(th.seed), n = th.scale.length;
    th.mel = [];
    let d = 0;
    for (let s = 0; s < 64; s++) {
      const bar = s >> 4, st = s & 15;
      if (st === 0) d = th.prog[bar] + n;
      const play = st === 0 || (st % 4 === 0 ? r() < 0.85 : r() < th.density * (st % 2 === 0 ? 0.8 : 0.4));
      if (play) {
        th.mel.push(d);
        d = clamp(d + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)], 0, n * 2 - 1);
      } else th.mel.push(-1);
    }
  });

  const kick = (t, v) => tone(150, t, 0.13, { type: 'sine', to: 45, vol: v, bus: musBus });
  const hat = (t, v, f) => noise(t, 0.04, { type: 'highpass', f: f || 7000, vol: v, bus: musBus });
  const rim = (t, v) => noise(t, 0.05, { type: 'bandpass', f: 1800, q: 2, vol: v, bus: musBus });

  const mus = { biome: 0, int: 0, step: 0, next: 0, on: false, timer: 0 };
  const stepDur = () => 60 / (THEMES[mus.biome].bpm * (1 + 0.12 * mus.int)) / 4;

  function playStep(s, t) {
    const th = THEMES[mus.biome], I = mus.int, sd = stepDur();
    const bar = (s >> 4) & 3, st = s & 15;
    const rootSemi = degToSemi(th, th.prog[bar]);

    if (th.bassSteps.includes(st) || (I > 0.35 && st % 2 === 0)) {
      const off = (st === 6 || st === 14) && th.drum !== 'drive' ? 7 : 0;
      tone(hz(th.root / 2, rootSemi + off), t, sd * (I > 0.35 || th.drum === 'drive' ? 1.3 : 2.4),
        { type: th.bass, vol: th.bassVol, lp: th.bassLp, bus: musBus });
    }
    const d = th.mel[s & 63];
    if (d >= 0) {
      const f = hz(th.root, degToSemi(th, d));
      const o = { type: th.lead, vol: th.leadVol, lp: th.leadLp, attack: 0.01, bus: musBus };
      tone(f, t, sd * th.noteLen, o);
      if (th.echo) tone(f, t + sd * 3, sd * th.noteLen, Object.assign({}, o, { vol: th.leadVol * 0.33 }));
    }
    switch (th.drum) {
      case 'pop': if (st % 8 === 0 || (st === 10 && I > 0.3)) kick(t, 0.5); if (st % 4 === 2) hat(t, 0.07); break;
      case 'tabla': if (st === 0 || st === 10) tone(220, t, 0.14, { type: 'sine', to: 110, vol: 0.4, bus: musBus }); if (st % 2) hat(t, 0.035, 9000); break;
      case 'sleigh': if (st === 0) kick(t, 0.28); if (st % 4 === 2) hat(t, 0.06, 9500); break;
      case 'folk': if (st === 0 || st === 8) kick(t, 0.4); if (st === 4 || st === 12) rim(t, 0.1); break;
      default: if (st % 4 === 0) kick(t, 0.55); if (st % 2 === 0) hat(t, 0.06); if (st === 4 || st === 12) rim(t, 0.12);
    }
    if (I > 0.3 && st % 2 === 0 && th.drum !== 'drive') hat(t, 0.05 * I);                // nervous ticking
    if (I > 0.6 && st % 4 === 0) {                                                        // cat-is-close stab
      tone(hz(th.root * 2, rootSemi), t, sd * 2, { type: 'square', vol: 0.05, lp: 2500, vib: [12, 12], bus: musBus });
    }
  }

  function tick() {
    if (!live()) return;
    const t = now();
    if (mus.next < t - 0.1) mus.next = t + 0.05;                    // we were suspended or muted: resync
    while (mus.next < t + 0.2) {
      playStep(mus.step, mus.next);
      mus.next += stepDur();
      mus.step++;
    }
  }
  function startMusic() {
    if (mus.on || !ctx) return;
    mus.on = true;
    mus.next = now() + 0.1;
    mus.timer = setInterval(tick, 50);
  }

  /* ------------------------------------------------------------------
   * Public API + mute control
   * ------------------------------------------------------------------ */
  const api = Object.assign({}, S, {
    /** Called every frame while playing: which world we are in and how close the cat is (0..1). */
    mood(biome, danger) {
      if (!ctx) return;
      const bi = clamp(biome | 0, 0, THEMES.length - 1);
      if (bi !== mus.biome) { mus.biome = bi; mus.step = 0; }
      mus.int += (clamp(danger || 0, 0, 1) - mus.int) * 0.05;
      startMusic();
    },
    pause(on) {
      paused = !!on;
      if (!ctx) return;
      musBus.gain.cancelScheduledValues(now());
      musBus.gain.setTargetAtTime(musTarget(), now(), 0.08);
      if (live()) tone(paused ? 440 : 660, now(), 0.08, { type: 'triangle', vol: 0.12 });
    },
    duck,
    /** The sound menu is open: keep the music at full level so slider changes can be heard. */
    menu(on) {
      inMenu = !!on;
      if (!ctx) return;
      musBus.gain.cancelScheduledValues(now());
      musBus.gain.setTargetAtTime(musTarget(), now(), 0.08);
    },
    isMuted: () => muted,
  });
  window.Sfx = api;

  const btn = document.getElementById('soundBtn');
  function paintButton() {
    if (!btn) return;
    btn.classList.toggle('muted', muted);
    btn.setAttribute('aria-label', muted ? 'Sound settings (sound is off)' : 'Sound settings');
    btn.title = muted ? 'Sound settings - muted (M to unmute)' : 'Sound settings (M mutes)';
    if (menuReady) paintMenu();
  }
  function setMuted(v) {
    muted = v;
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(v ? 0 : vol.master, now(), 0.03);
    paintButton();
    if (!v) { unlock(); if (live()) S.click(); }
  }
  paintButton();

  /** Browsers only allow audio after a user gesture, so we start on the first one. */
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    startMusic();
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  /* ---- sound menu: master / music / effects sliders ---- */
  const SLIDERS = [['volMaster', 'master'], ['volMusic', 'music'], ['volSfx', 'sfx']];
  const byId = (id) => document.getElementById(id);
  function paintMenu() {
    SLIDERS.forEach(([id, k]) => {
      const r = byId(id);
      if (!r) return;
      r.value = Math.round(vol[k] * 100);
      r.style.setProperty('--fill', r.value + '%');
      const o = byId(id + 'Val');
      if (o) o.textContent = r.value + '%';
    });
    const mt = byId('muteToggle');
    if (mt) { mt.textContent = muted ? 'Unmute' : 'Mute all'; mt.setAttribute('aria-pressed', muted ? 'true' : 'false'); }
  }
  function saveVolumes() { try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch (e) { /* ignore */ } }
  function setVolume(k, v) {
    vol[k] = clamp(v, 0, 1);
    if (ctx) {
      if (k === 'master' && !muted) master.gain.setTargetAtTime(vol.master, now(), 0.02);
      if (k === 'sfx') sfxBus.gain.setTargetAtTime(vol.sfx, now(), 0.02);
      if (k === 'music') musBus.gain.setTargetAtTime(musTarget(), now(), 0.02);
    }
    saveVolumes();
    paintMenu();
  }
  SLIDERS.forEach(([id, k]) => {
    const r = byId(id);
    if (!r) return;
    r.addEventListener('input', () => { unlock(); setVolume(k, r.value / 100); });
    r.addEventListener('change', () => { if (k !== 'music') S.coin(1); });         // let them hear the new level
  });
  const mt = byId('muteToggle'); if (mt) mt.addEventListener('click', () => setMuted(!muted));
  const tb = byId('soundTest');
  if (tb) tb.addEventListener('click', () => {
    unlock();
    S.coin(1); setTimeout(() => S.coin(4), 120);
    setTimeout(() => S.honk('car'), 450);
    setTimeout(() => S.catAppear(1.5), 900);
    setTimeout(() => S.die('anvil'), 1700);
  });
  const rb = byId('soundReset');
  if (rb) rb.addEventListener('click', () => { Object.assign(vol, DEFAULT_VOL); setMuted(false); setVolume('master', vol.master); setVolume('music', vol.music); setVolume('sfx', vol.sfx); });
  menuReady = true;
  paintMenu();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) setMuted(!muted);
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.btn, .tab')) S.click();
  });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (!muted) ctx.resume();
  });
})();
