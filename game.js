/*
 * PARROT CROSSING — a tiny endless hopper drawn with the 2D Canvas.
 *
 * World coordinates
 *   x : sideways (tiles). Playable columns are 0 .. COLS-1.
 *   z : forward (rows). Row z occupies z-0.5 .. z+0.5.
 *   y : up (tile heights).
 * Everything is projected with a simple isometric camera (see proj helpers),
 * and boxes are painted back-to-front to create the low-poly 3D illusion.
 */
(() => {
  'use strict';

  // Sound lives in audio.js; if it is missing the game simply stays silent.
  const Sfx = window.Sfx || new Proxy({}, { get: () => () => {} });

  /* ===================================================================
   * Configuration
   * =================================================================== */
  const COLS = 9;                       // playable columns
  const MID = 4;                        // spawn column
  const RING_MIN = -22;                 // lanes loop between these x values
  const RING_MAX = COLS + 22;
  const RING_LEN = RING_MAX - RING_MIN;
  const HOP_TIME = 0.15;                // seconds per hop
  const HOP_HEIGHT = 0.55;
  const hopTime = () => HOP_TIME / (1 + bootById(save.boot).speed);   // golden boots = faster hops
  const AHEAD = 26;                     // rows generated in front of the player
  const KEEP_BEHIND = 22;               // rows kept behind the best row
  const MAX_BACK = 5;                   // how far back the player may retreat
  const LOG_TOP = 0.1;                  // height of a log's top surface
  const BEST_KEY = 'parrotCrossing.best';
  const SAVE_KEY = 'parrotCrossing.save';
  const CAT_IDLE = 4.0;                 // seconds without forward progress before the cat shows up
  const CAT_SPEED = 1.6;                // tiles per second while stalking
  const CAT_SPAWN_DIST = 6.5;           // how far behind you it appears
  const CAT_GIVEUP = 11;                // it loses interest when you get this far ahead
  const CAT_WINDUP = 0.45;              // crouch time before the pounce (your chance to dodge)
  const CAT_LEAP = 0.28;
  const FONT = '"Trebuchet MS", "Avenir Next Rounded", "Arial Rounded MT Bold", system-ui, sans-serif';
  const BIOME_LEN = 30;                 // rows per biome before the scenery changes

  const GRASS_H = 0.18, ROAD_H = 0, WATER_H = -0.12;

  const CAR_COLORS = ['#ff5a5f', '#ffb400', '#3ea8ff', '#a66bff', '#3ddc97', '#ff8a3d', '#f2f2f2', '#ff6fb5'];
  
  /* ===================================================================
   * Small helpers
   * =================================================================== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const wrapX = (x) => ((x - RING_MIN) % RING_LEN + RING_LEN) % RING_LEN + RING_MIN;

  const shadeCache = new Map();
  /** Multiply a #rrggbb colour by a brightness factor. */
  function shade(hex, f) {
    const key = hex + f;
    let v = shadeCache.get(key);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    v = `rgb(${r},${g},${b})`;
    shadeCache.set(key, v);
    return v;
  }
  /** Brighten / darken a #rrggbb colour and return another #rrggbb colour. */
  function hexShade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * f)));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  const faceCache = new Map();
  /** Top / left / right face colours for a box (light from the upper left). */
  function faces(hex) {
    let f = faceCache.get(hex);
    if (!f) {
      f = { top: shade(hex, 1.06), left: shade(hex, 0.84), right: shade(hex, 0.66) };
      faceCache.set(hex, f);
    }
    return f;
  }

  const rgbCache = new Map();
  function hexRgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, v); }
    return v;
  }
  const rgbStr = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

  /* ===================================================================
   * Content tables: biomes, parrot skins, hats, boosts
   * =================================================================== */
  const BIOMES = [
    { id: 'meadow', name: 'Sunny Meadow', sky: ['#a9e4ff', '#e8f8ff'], ground: '#7bd45c', alt: '#6dc84f', face: '#4f9a3a',
      road: '#585e70', line: 'rgba(255,255,255,0.9)', water: '#52b9ec', wave: 'rgba(255,255,255,0.55)', foam: 'rgba(255,255,255,0.4)',
      plat: { top: '#b7824a', end: '#e2b57c' }, props: ['round', 'pine', 'round'], leaf: ['#237d3c', '#2e9e48', '#43b95b'],
      trunk: '#8a5a2b', rock: '#8b9199', specks: ['#ffffff', '#ffd93d', '#ff7eb6', '#ff9f43'] },
    { id: 'desert', name: 'Sunbaked Desert', sky: ['#ffcf8a', '#fff0d2'], ground: '#f0d28a', alt: '#e8c677', face: '#c9a45a',
      road: '#6f6a66', line: 'rgba(255,255,255,0.85)', water: '#37c9c0', wave: 'rgba(255,255,255,0.6)', foam: 'rgba(255,255,255,0.45)',
      plat: { top: '#d9b36b', end: '#f0d19a' }, props: ['cactus', 'cactus', 'rock', 'palm'], leaf: ['#237d3c', '#2e9e48', '#43b95b'],
      trunk: '#a9753c', rock: '#c49a62', specks: ['#d9b36b', '#c79a4a', '#fff3d0'] },
    { id: 'snow', name: 'Frosty Peaks', sky: ['#bcd9ee', '#f2f9ff'], ground: '#f4f9fc', alt: '#e5f0f8', face: '#b9d2e2',
      road: '#707a90', line: 'rgba(255,255,255,0.9)', water: '#a6dcf3', wave: 'rgba(255,255,255,0.9)', foam: 'rgba(255,255,255,0.6)',
      plat: { top: '#f0fbff', end: '#cfeeff' }, props: ['snowpine', 'snowpine', 'snowman', 'rock'], leaf: ['#1f6b4a', '#2a8a5e', '#3aa673'],
      trunk: '#6b4a2b', rock: '#9aa6b5', specks: ['#ffffff', '#bfe6ff', '#e6f4ff'] },
    { id: 'autumn', name: 'Autumn Woods', sky: ['#ffc9a0', '#fff0e0'], ground: '#c9b44a', alt: '#bda640', face: '#8a7a2e',
      road: '#5b5560', line: 'rgba(255,240,200,0.9)', water: '#4aa6c4', wave: 'rgba(255,255,255,0.5)', foam: 'rgba(255,255,255,0.38)',
      plat: { top: '#a86a3a', end: '#d9a066' }, props: ['autumn', 'autumn', 'round', 'pine'], leaf: ['#237d3c', '#2e9e48', '#43b95b'],
      trunk: '#6e4524', rock: '#8b8579', specks: ['#ff8a3d', '#ffd23f', '#c2501f'] },
    { id: 'volcano', name: 'Ember Ridge', sky: ['#32202e', '#a85a52'], ground: '#4c4854', alt: '#443f4b', face: '#2b2830',
      road: '#34323e', line: 'rgba(255,190,110,0.85)', water: '#ff6a1a', wave: 'rgba(255,225,120,0.85)', foam: 'rgba(255,190,80,0.45)',
      plat: { top: '#5a5662', end: '#807a8c' }, props: ['basalt', 'ember', 'rock'], leaf: ['#237d3c', '#2e9e48', '#43b95b'],
      trunk: '#2a2430', rock: '#6a6574', specks: ['#ff7a1a', '#ffd23f', '#ff4d4d'] },
  ];
  const biomeIndex = (z) => (z < 0 ? 0 : Math.floor(z / BIOME_LEN) % BIOMES.length);
  const biomeAt = (z) => BIOMES[biomeIndex(z)];
  const AUTUMN_LEAF = ['#b8431c', '#e8742a', '#f6a23a'];

  // Traps lie on grass tiles. Each one has its own slapstick ending (see trapPose / addTrap).
  const TRAP_KINDS = ['bear', 'snare', 'hole', 'banana', 'anvil'];
  const TRAP_LEN = { bear: 1.8, snare: 2.1, hole: 1.3, banana: 1.5, anvil: 1.6 };   // seconds before the game-over card
  const isTrap = (k) => TRAP_KINDS.includes(k);
  const deathLen = (k) => (k === 'cat' ? 1.35 : TRAP_LEN[k] || 0.9);
  const sprungTraps = [];
  let trapWarned = false;

  const mkSkin = (o) => Object.assign({ feet: '#ff9f1c', beak: '#ffb02e', hook: '#e8890c' }, o);
  const SKINS = [
    { id: 'emerald', name: 'Emerald', cost: 0, pal: mkSkin({ body: '#2fbf4a', head: '#36cf52', chest: '#b3e85f', crest: '#ff4d4d', wing: '#2f7bff', edge: '#ff4d4d', tip: '#ffd23f', tail1: '#ff4d4d', tail2: '#2f7bff' }) },
    { id: 'scarlet', name: 'Scarlet Macaw', cost: 25, pal: mkSkin({ body: '#e63946', head: '#f25c54', chest: '#ff9e8f', crest: '#ffd23f', wing: '#2f7bff', edge: '#ffd23f', tip: '#2fbf4a', tail1: '#2f7bff', tail2: '#ffd23f' }) },
    { id: 'blue', name: 'Blue Macaw', cost: 40, pal: mkSkin({ body: '#2f7bff', head: '#4a90ff', chest: '#ffd23f', crest: '#ffd23f', wing: '#1d4ed8', edge: '#6fb1ff', tip: '#ffd23f', tail1: '#1d4ed8', tail2: '#6fb1ff' }) },
    { id: 'pink', name: 'Rosy Cockatoo', cost: 50, pal: mkSkin({ body: '#ff9ec7', head: '#ffb3d4', chest: '#ffffff', crest: '#ffe066', wing: '#ff7eb6', edge: '#ffffff', tip: '#ffe066', tail1: '#ff7eb6', tail2: '#ffffff', feet: '#9aa3ad', beak: '#9aa3ad', hook: '#7a828b' }) },
    { id: 'midnight', name: 'Midnight', cost: 80, pal: mkSkin({ body: '#5b3cc4', head: '#7a56e8', chest: '#c3a6ff', crest: '#ff5ccd', wing: '#2b1d6e', edge: '#ff5ccd', tip: '#6fe7ff', tail1: '#ff5ccd', tail2: '#6fe7ff' }) },
    { id: 'golden', name: 'Golden', cost: 150, pal: mkSkin({ body: '#ffd23f', head: '#ffe066', chest: '#fff3b0', crest: '#ff4d4d', wing: '#ff9f1c', edge: '#ffffff', tip: '#ff4d4d', tail1: '#ff9f1c', tail2: '#ff4d4d' }) },
  ];
  // Hat boxes are [x0, x1, z0, z1, y0, y1, colour] in the parrot's local space.
  const HATS = [
    { id: 'none', name: 'No hat', cost: 0, parts: [] },
    { id: 'party', name: 'Party hat', cost: 15, hideCrest: true, parts: [
      [-0.1, 0.1, 0.04, 0.24, 0.82, 0.94, '#ff4d4d'], [-0.07, 0.07, 0.08, 0.2, 0.94, 1.06, '#ffd23f'], [-0.04, 0.04, 0.11, 0.17, 1.06, 1.18, '#ff4d4d']] },
    { id: 'shades', name: 'Cool shades', cost: 25, parts: [
      [-0.2, 0.2, 0.3, 0.345, 0.63, 0.75, '#15151f'], [0.19, 0.255, 0.15, 0.33, 0.62, 0.77, '#15151f'], [-0.255, -0.19, 0.15, 0.33, 0.62, 0.77, '#15151f']] },
    { id: 'tophat', name: 'Top hat', cost: 35, hideCrest: true, parts: [
      [-0.25, 0.25, -0.07, 0.39, 0.82, 0.87, '#23232f'], [-0.15, 0.15, 0.03, 0.29, 0.87, 1.15, '#2d2d3b'], [-0.155, 0.155, 0.025, 0.295, 0.87, 0.94, '#ff4d4d']] },
    { id: 'crown', name: 'Royal crown', cost: 120, hideCrest: true, parts: [
      [-0.17, 0.17, 0.0, 0.32, 0.82, 0.9, '#ffd23f'], [-0.17, -0.1, 0.0, 0.07, 0.9, 1.0, '#ffd23f'], [0.1, 0.17, 0.0, 0.07, 0.9, 1.0, '#ffd23f'],
      [-0.17, -0.1, 0.25, 0.32, 0.9, 1.0, '#ffd23f'], [0.1, 0.17, 0.25, 0.32, 0.9, 1.0, '#ffd23f'], [-0.03, 0.03, 0.13, 0.19, 0.9, 1.04, '#ff4d4d']] },
  ];
  // Boots only come from Mystery Cases. `speed` shortens every hop.
  const bootSet = (main, sole, cuff) => {
    const out = [];
    for (const [x0, x1] of [[-0.16, -0.03], [0.03, 0.16]]) {
      out.push([x0, x1, -0.04, 0.17, 0, 0.05, sole], [x0, x1, -0.04, 0.17, 0.05, 0.2, main], [x0 - 0.01, x1 + 0.01, -0.05, 0.18, 0.2, 0.26, cuff]);
    }
    return out;
  };
  const BOOTS = [
    { id: 'none', name: 'Bare feet', speed: 0, parts: [] },
    { id: 'sneakers', name: 'Red sneakers', speed: 0, parts: bootSet('#ff4d4d', '#ffffff', '#ffffff') },
    { id: 'snowboots', name: 'Snow boots', speed: 0, parts: bootSet('#8a5a2b', '#3a2a1a', '#ffffff') },
    { id: 'fireboots', name: 'Fire boots', speed: 0.08, parts: bootSet('#ff7a1a', '#7a2a0a', '#ffd23f') },
    { id: 'goldboots', name: 'Golden boots', speed: 0.16, parts: bootSet('#ffd23f', '#b97f00', '#fff3b0') },
  ];
  const bootById = (id) => BOOTS.find((b) => b.id === id) || BOOTS[0];

  const RARITY = {
    common: { name: 'Common', color: '#7a8a99', w: 58, refund: 10 },
    rare: { name: 'Rare', color: '#3ea8ff', w: 27, refund: 20 },
    epic: { name: 'Epic', color: '#a66bff', w: 12, refund: 40 },
    legendary: { name: 'Legendary', color: '#ffb800', w: 3, refund: 100 },
  };
  const RARITY_OF = {
    party: 'common', shades: 'common', scarlet: 'common', sneakers: 'common',
    blue: 'rare', pink: 'rare', tophat: 'rare', snowboots: 'rare',
    midnight: 'epic', golden: 'epic', crown: 'epic', fireboots: 'epic',
    goldboots: 'legendary',
  };
  [SKINS, HATS, BOOTS].forEach((list) => list.forEach((it) => { it.rarity = RARITY_OF[it.id] || 'common'; }));
  const CASE_COST = 40;
  const PITY_AT = 12;                       // an Epic or better is guaranteed within this many cases
  const CASE_POOL = [];
  [['skins', SKINS], ['hats', HATS], ['boots', BOOTS]].forEach(([kind, list]) => list.forEach((item) => {
    if (item.id !== 'emerald' && item.id !== 'none') CASE_POOL.push({ kind, item });
  }));

  const BOOSTS = [
    { id: 'magnet', name: 'Coin magnet', desc: 'Pulls in coins from nearby tiles. Permanent.', cost: 80, icon: '🧲' },
    { id: 'life', name: 'Second chance', desc: 'Survive one hit in your next run.', cost: 30, icon: '💛' },
  ];

  /* ===================================================================
   * DOM / canvas
   * =================================================================== */
  const canvas = document.getElementById('game');
  let ctx = canvas.getContext('2d');   // swapped briefly when drawing shop previews
  const $ = (id) => document.getElementById(id);
  const ui = {
    score: $('score'), best: $('best'),
    start: $('startScreen'), pause: $('pauseScreen'), over: $('overScreen'),
    finalScore: $('finalScore'), finalBest: $('finalBest'), overNote: $('overNote'),
    pauseBtn: $('pauseBtn'), dpad: $('dpad'),
    shop: $('shopScreen'), shopGrid: $('shopGrid'), shopCoins: $('shopCoins'), shopClose: $('shopClose'),
    shopTabs: Array.from(document.querySelectorAll('.tab')),
    coinCount: $('coinCount'), livesChip: $('livesChip'), runCoins: $('runCoins'), toast: $('toast'),
    flash: $('flash'), vignette: $('vignette'), catMeter: $('catMeter'), catBar: $('catBar'),
    biomeName: $('biomeName'), biomeBar: $('biomeBar'), comboChip: $('comboChip'),
    runTime: $('runTime'), runDodges: $('runDodges'), deathCause: $('deathCause'),
    speedChip: $('speedChip'), catIcon: $('catIcon'), caseScreen: $('caseScreen'), caseBox: $('caseBox'),
    sound: $('soundScreen'),
  };
  let curOverlay = null, soundOpen = false, soundReturn = null;

  /** View / camera state used by every draw call. */
  const V = { w: 0, h: 0, dpr: 1, S: 50, hw: 50, hh: 25, hv: 47, ox: 0, oy: 0, cx: MID, cz: 0, sky: null };

  function resize() {
    V.w = window.innerWidth;
    V.h = window.innerHeight;
    V.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(V.w * V.dpr);
    canvas.height = Math.round(V.h * V.dpr);
    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    V.S = clamp(Math.min(V.w / 12, V.h / 12), 28, 76);   // pixels per tile (half diagonal)
    V.hw = V.S;
    V.hh = V.S * 0.5;
    V.hv = V.S * 0.95;
    // Where the camera target sits on screen: lower-left of centre so the forward diagonal has room.
    V.ox = V.w * (V.w < V.h ? 0.38 : 0.42);
    V.oy = V.h * 0.64;
    buildFrost();
    V.sky = ctx.createLinearGradient(0, 0, 0, V.h);
    V.sky.addColorStop(0, '#a9e4ff');
    V.sky.addColorStop(1, '#e8f8ff');
  }

  /* ===================================================================
   * World: rows, lanes and procedural generation
   * =================================================================== */

  /** A lane of moving things (cars or logs) that loops around the ring. */
  const CAR_TYPES = [
    { id: 'sedan', len: 1.6, w: 30 }, { id: 'hatch', len: 1.35, w: 18 }, { id: 'taxi', len: 1.6, w: 10 }, { id: 'police', len: 1.65, w: 6 },
    { id: 'sports', len: 1.5, w: 12 }, { id: 'van', len: 2.0, w: 8 }, { id: 'bus', len: 3.4, w: 6 }, { id: 'truck', len: 2.7, w: 7 },
    { id: 'icecream', len: 2.1, w: 3 },
  ];
  const BUS_COLORS = ['#3ea8ff', '#ff8a3d', '#3ddc97', '#a66bff'];
  function randomCar() {
    let r = Math.random() * CAR_TYPES.reduce((a, t) => a + t.w, 0), t = CAR_TYPES[0];
    for (const c of CAR_TYPES) { if (r < c.w) { t = c; break; } r -= c.w; }
    const color = t.id === 'taxi' ? '#ffc83d' : t.id === 'police' ? '#f4f6fa' : t.id === 'icecream' ? '#ff9ec7' : t.id === 'bus' ? pick(BUS_COLORS) : pick(CAR_COLORS);
    return { type: t.id, len: t.len, color, cargo: pick(['#f2f2f2', '#ffd23f', '#6fd0ff', '#ff8a3d']), phase: rand(0, 6.28), honk: 0 };
  }

  class Lane {
    constructor(kind, dir, speed) {
      this.kind = kind;       // 'road' | 'river'
      this.dir = dir;         // +1 / -1
      this.speed = speed;     // tiles per second
      this.items = [];        // { x, len, ... }
    }
    update(dt) {
      const d = this.dir * this.speed * dt;
      for (const it of this.items) {
        it.x = wrapX(it.x + d);                              // same speed => spacing never changes
        if (it.honk > 0) it.honk -= dt;
      }
    }
    /** Log under world-x `px`, or null. */
    logAt(px) {
      for (const it of this.items) if (Math.abs(px - it.x) <= it.len / 2 - 0.04) return it;
      return null;
    }
  }

  /**
   * Spread items around the ring with a guaranteed minimum gap.
   * `makeItem` returns { len, ... }.
   */
  function fillLane(lane, spacingMin, spacingMax, minGap, maxLen, makeItem) {
    const n = Math.max(2, Math.min(Math.round(RING_LEN / rand(spacingMin, spacingMax)), Math.floor(RING_LEN / (maxLen + minGap))));
    const items = [];
    for (let i = 0; i < n; i++) items.push(makeItem());
    const total = items.reduce((s, it) => s + it.len, 0);
    const extra = Math.max(0, RING_LEN - total - n * minGap);
    const weights = items.map(() => rand(0.2, 1));
    const wsum = weights.reduce((s, w) => s + w, 0);
    const shift = rand(0, RING_LEN);
    let cursor = 0;
    items.forEach((it, i) => {
      it.x = wrapX(RING_MIN + cursor + it.len / 2 + shift);
      cursor += it.len + minGap + (extra * weights[i]) / wsum;
    });
    lane.items = items;
  }

  class Row {
    constructor(z, type) {
      this.z = z;
      this.type = type;                                   // 'grass' | 'road' | 'river'
      this.h = type === 'grass' ? GRASS_H : type === 'road' ? ROAD_H : WATER_H;
      this.biome = biomeAt(z);
      this.trees = new Map();                             // playable column -> { kind, s } (blocking props)
      this.decor = [];                                    // scenery props outside the playable area
      this.flowers = [];
      this.coins = [];                                    // { x, got } resting on grass / road tiles
      this.traps = null;                                  // Map column -> trap (grass only)
      this.lane = null;
    }
  }

  class World {
    constructor() {
      this.rows = new Map();
      this.genZ = -12;                    // next row to generate
      this.segType = 'grass';
      this.segLeft = 15;                  // opening meadow (z -12 .. 2)
      this.laneDir = 1;
      this.minAllowed = -MAX_BACK;
      this.ensure(AHEAD);
    }

    row(z) {
      if (z >= this.genZ) this.ensure(z + 1);
      return this.rows.get(z) || null;
    }

    ensure(maxZ) {
      while (this.genZ <= maxZ) {
        if (this.segLeft <= 0) this.nextSegment(this.genZ);
        this.segLeft--;
        this.rows.set(this.genZ, this.makeRow(this.genZ));
        this.genZ++;
      }
    }

    /** Alternate meadow and hazard so every hazard has a safe landing zone before and after. */
    nextSegment(z) {
      const d = clamp(z / 220, 0, 1);       // difficulty 0..1
      if (this.segType === 'grass') {
        this.segType = Math.random() < 0.6 ? 'road' : 'river';
        this.segLeft = this.segType === 'road' ? randInt(1, 2 + Math.round(d * 3)) : randInt(1, 2 + Math.round(d * 1.5));
        this.laneDir = Math.random() < 0.5 ? 1 : -1;
      } else {
        this.segType = 'grass';
        this.segLeft = randInt(1, d > 0.5 ? 2 : 3);
      }
    }

    makeRow(z) {
      const row = new Row(z, this.segType);
      const d = clamp(z / 220, 0, 1);
      if (row.type === 'grass') this.buildGrass(row);
      else if (row.type === 'road') this.buildRoad(row, d);
      else this.buildRiver(row, d);
      return row;
    }

    buildGrass(row) {
      const z = row.z;
      const start = z <= 2;                               // keep the spawn area open
      const count = start ? randInt(0, 1) : randInt(0, 3);
      for (let i = 0; i < count; i++) {
        const c = randInt(0, COLS - 1);
        if (start && c >= 2 && c <= 6) continue;
        if (row.trees.has(c) || row.trees.has(c - 1) || row.trees.has(c + 1)) continue;   // never wall the row
        row.trees.set(c, { kind: pick(row.biome.props), s: rand(0.88, 1.15) });
      }
      for (let c = -10; c < COLS + 10; c++) {
        if (c >= 0 && c < COLS) continue;
        const edge = c === -1 || c === COLS;
        if (Math.random() < (edge ? 0.7 : 0.3)) row.decor.push({ x: c + rand(-0.15, 0.15), kind: pick(row.biome.props), s: rand(0.85, 1.25) });
      }
      const nf = randInt(3, 6);
      for (let i = 0; i < nf; i++) row.flowers.push({ x: rand(-9, COLS + 8), dz: rand(-0.4, 0.4), c: pick(row.biome.specks) });
      if (!start) {                                       // gold coins on free tiles
        for (let c = 0; c < COLS; c++) if (!row.trees.has(c) && Math.random() < 0.06) row.coins.push({ x: c, got: false });
      }
      this.placeTraps(row, start);
    }

    /** Sprinkle a few traps on free grass tiles. Never walls a row, and never appears at the spawn. */
    placeTraps(row, start) {
      row.traps = new Map();
      if (start || row.z < 8) return;
      const d = clamp(row.z / 220, 0, 1);
      let n = Math.random() < 0.12 + d * 0.25 ? 1 : 0;
      if (n && d > 0.45 && Math.random() < 0.25) n = 2;
      const blocked = (k) => row.trees.has(k) || row.traps.has(k);
      for (let i = 0; i < n; i++) {
        const c = randInt(0, COLS - 1);
        if (blocked(c)) continue;
        row.traps.set(c, { kind: pick(TRAP_KINDS), t: -1, stage: 0, x: c, z: row.z, y: row.h });
        if ([-2, -1, 0].some((o) => blocked(c + o) && blocked(c + o + 1) && blocked(c + o + 2))) { row.traps.delete(c); continue; }   // no 3-tile walls
        if (Math.random() < 0.3 && !row.coins.some((k) => k.x === c)) row.coins.push({ x: c, got: false });   // bait!
      }
    }

    buildRoad(row, d) {
      this.laneDir = Math.random() < 0.25 ? this.laneDir : -this.laneDir;
      const speed = rand(1.8, 3.3) * (1 + d * 0.7);
      const lane = new Lane('road', this.laneDir, speed);
      fillLane(lane, lerp(8, 6.2, d), lerp(11, 8, d), 3.2, 3.5, randomCar);
      row.lane = lane;
      for (let c = 0; c < COLS; c++) if (Math.random() < 0.02) row.coins.push({ x: c, got: false });   // risky coins on the road
    }

    buildRiver(row, d) {
      this.laneDir = -this.laneDir;
      const speed = rand(0.9, 2.0) * (1 + d * 0.6);
      const lane = new Lane('river', this.laneDir, speed);
      fillLane(lane, 5.4, 7, 1.4, 4.2, () => {
        const len = rand(2.6, 4.2 - d * 0.8);
        // some platforms carry a coin that rides along with them
        return { len, phase: rand(0, 6.28), coin: Math.random() < 0.28 ? { off: rand(-len * 0.25, len * 0.25), got: false } : null };
      });
      row.lane = lane;
    }

    update(dt) {
      for (const row of this.rows.values()) if (row.lane) row.lane.update(dt);
    }

    prune(minZ) {
      for (const z of this.rows.keys()) if (z < minZ) this.rows.delete(z);
    }
  }

  /* ===================================================================
   * Player
   * =================================================================== */
  class Parrot {
    constructor() {
      this.x = MID; this.z = 0;             // visual position
      this.tx = MID; this.tz = 0;           // logical tile (target of the current hop)
      this.fromX = MID; this.fromZ = 0; this.toX = MID; this.toZ = 0;
      this.baseFrom = GRASS_H; this.baseTo = GRASS_H;
      this.hop = -1;                        // seconds into the current hop, -1 when idle
      this.face = 'f';                      // f / b / l / r
      this.queued = null;                   // one buffered move
      this.log = null; this.logOff = 0;     // log we are riding
      this.squash = 0;                      // landing squash 0..1
      this.deadType = null; this.deadT = 0;
      this.bump = 0;                        // little shake when a move is blocked
      this.inv = 0;                         // invulnerability seconds after a second chance
    }
  }

  /* ===================================================================
   * Particles & ripples
   * =================================================================== */
  const particles = [];
  const ripples = [];

  function burst(x, y, z, colors, n, speed, up, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      particles.push({
        x, y, z, vx: Math.cos(a) * s, vy: rand(0.4, 1) * up, vz: Math.sin(a) * s,
        life: rand(0.5, 0.9), max: 0.9, color: pick(colors), size,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t += dt;
      if (ripples[i].t > 1.1) ripples.splice(i, 1);
    }
  }

  /* ===================================================================
   * Game state
   * =================================================================== */
  let world = new World();
  let parrot = new Parrot();
  let state = 'menu';                       // menu | playing | paused | dying | over
  let score = 0;
  let maxZ = 0;
  let best = 0;
  let time = 0;
  const cam = { x: MID, z: 0 };

  let runCoins = 0;
  let usedLife = false;
  let biomeShown = 0;
  let shopOpen = false;
  let shopTab = 'cases';
  let shopReturn = 'start';
  let idleT = -2;                           // seconds since the last forward progress (negative = grace)
  let dodges = 0, runTime = 0, deathCause = '';
  let comboCount = 0, comboT = 0, newBestShown = false;
  let shake = 0, dangerCur = 0;
  const skyCur = { top: hexRgb(BIOMES[0].sky[0]).slice(), bot: hexRgb(BIOMES[0].sky[1]).slice() };

  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }
  ui.best.textContent = best;

  /* ---- persistent save: coins, owned cosmetics, boosts ---- */
  let save = { coins: 0, skins: ['emerald'], hats: ['none'], boots: ['none'], skin: 'emerald', hat: 'none', boot: 'none', magnet: false, lives: 0, pity: 0, cases: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (raw && typeof raw === 'object') save = Object.assign(save, raw);
  } catch (e) { /* first run or storage unavailable */ }
  save.coins = Math.max(0, Math.floor(Number(save.coins)) || 0);
  save.lives = clamp(Math.floor(Number(save.lives)) || 0, 0, 9);
  if (!Array.isArray(save.skins) || !save.skins.includes('emerald')) save.skins = ['emerald'];
  if (!Array.isArray(save.hats) || !save.hats.includes('none')) save.hats = ['none'];
  if (!save.skins.includes(save.skin) || !SKINS.some((k) => k.id === save.skin)) save.skin = 'emerald';
  if (!save.hats.includes(save.hat) || !HATS.some((h) => h.id === save.hat)) save.hat = 'none';
  if (!Array.isArray(save.boots) || !save.boots.includes('none')) save.boots = ['none'];
  if (!save.boots.includes(save.boot) || !BOOTS.some((b) => b.id === save.boot)) save.boot = 'none';
  save.pity = clamp(Math.floor(Number(save.pity)) || 0, 0, 99);
  save.cases = Math.max(0, Math.floor(Number(save.cases)) || 0);
  save.magnet = !!save.magnet;

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }
  function updateHud() {
    ui.coinCount.textContent = save.coins;
    ui.livesChip.hidden = save.lives <= 0;
    ui.livesChip.textContent = `Second chance x${save.lives}`;
    const sp = bootById(save.boot).speed;
    ui.speedChip.hidden = sp <= 0;
    ui.speedChip.textContent = `Boots +${Math.round(sp * 100)}% speed`;
  }
  updateHud();

  let toastTimer = 0;
  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2000);
  }

  function setOverlay(name) {
    ui.start.classList.toggle('visible', name === 'start');
    ui.pause.classList.toggle('visible', name === 'pause');
    ui.over.classList.toggle('visible', name === 'over');
    ui.shop.classList.toggle('visible', name === 'shop');
    ui.sound.classList.toggle('visible', name === 'sound');
    curOverlay = name;
    soundOpen = name === 'sound';
    Sfx.menu(soundOpen);                        // keep the music audible while the sliders are being adjusted
  }

  /** Sound settings: pauses a running game and returns to whatever screen was showing. */
  function openSound() {
    if (soundOpen) return;
    if (state === 'playing') pauseGame();
    soundReturn = curOverlay;
    setOverlay('sound');
  }
  function closeSound() {
    if (!soundOpen) return;
    setOverlay(soundReturn);
  }
  function setScore(v) {
    score = v;
    ui.score.textContent = v;
    ui.score.classList.add('bump');
    setTimeout(() => ui.score.classList.remove('bump'), 110);
    ui.biomeName.textContent = biomeAt(v).name;
    ui.biomeBar.style.width = Math.round(((v % BIOME_LEN) / BIOME_LEN) * 100) + '%';
  }

  function resetGame() {
    world = new World();
    parrot = new Parrot();
    particles.length = 0;
    ripples.length = 0;
    maxZ = 0;
    score = 0;
    runCoins = 0;
    usedLife = false;
    biomeShown = 0;
    idleT = -2; dodges = 0; runTime = 0; deathCause = '';
    comboCount = 0; comboT = 0; newBestShown = false; shake = 0; dangerCur = 0;
    cat.state = 'away';
    popups.length = 0;
    sprungTraps.length = 0; trapWarned = false;
    ui.comboChip.hidden = true;
    ui.biomeName.textContent = BIOMES[0].name;
    ui.biomeBar.style.width = '0%';
    ui.score.textContent = '0';
    cam.x = MID; cam.z = 0;
    world.minAllowed = -MAX_BACK;
  }

  function startGame() {
    resetGame();
    state = 'playing';
    Sfx.start();
    setOverlay(null);
  }

  function pauseGame() {
    if (state === 'playing') { state = 'paused'; setOverlay('pause'); Sfx.pause(true); }
  }
  function resumeGame() {
    if (state === 'paused') { state = 'playing'; setOverlay(null); lastTs = 0; Sfx.pause(false); }
  }
  function togglePause() {
    if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame();
  }

  function gameOver() {
    state = 'over';
    let isBest = false;
    if (score > best) {
      best = score; isBest = true;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* storage unavailable: ignore */ }
    }
    Sfx.gameOver(isBest && score > 0);
    ui.best.textContent = best;
    ui.finalScore.textContent = score;
    ui.finalBest.textContent = best;
    ui.runCoins.textContent = runCoins;
    ui.runDodges.textContent = dodges;
    const secs = Math.round(runTime);
    ui.runTime.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    ui.deathCause.textContent = deathCause;
    ui.vignette.style.opacity = '0';
    ui.catMeter.classList.remove('show');
    lastMeter = '';
    ui.overNote.firstChild.textContent = isBest && score > 0 ? 'New best! ' : 'Best ';
    setOverlay('over');
  }

  /* ---------------------------------------------------------------
   * Movement
   * --------------------------------------------------------------- */

  /** Height the parrot stands at when resting on row `row` (possibly on a log). */
  function restHeight(row, log, t) {
    if (log) return LOG_TOP + Math.sin(t * 2.2 + log.phase) * 0.025;
    return row.h;
  }

  /** Try to start a hop in direction dir ('f','b','l','r'). Returns true if a hop began. */
  function tryMove(dir) {
    const p = parrot;
    p.face = dir;
    const dx = dir === 'l' ? -1 : dir === 'r' ? 1 : 0;
    const dz = dir === 'f' ? 1 : dir === 'b' ? -1 : 0;
    const nz = p.tz + dz;
    const cur = world.row(p.tz);
    const target = world.row(nz);
    if (!target || nz < world.minAllowed) { p.bump = 1; Sfx.bump(); return false; }

    // Where will we land? Rivers keep the fractional x (we ride logs); other rows snap to a column.
    let nx;
    if (dz !== 0) nx = target.type === 'river' ? p.x : Math.round(p.x);
    else nx = (cur.type === 'river' ? p.x : Math.round(p.x)) + dx;

    if (nx < -0.01 || nx > COLS - 1 + 0.01) { p.bump = 1; Sfx.bump(); return false; }          // stay on the playfield
    if (target.type === 'grass' && target.trees.has(Math.round(nx))) { p.bump = 1; Sfx.bump(); return false; }   // tree in the way

    p.fromX = p.x; p.fromZ = p.z;
    p.toX = nx; p.toZ = nz;
    p.baseFrom = p.log ? restHeight(cur, p.log, time) : cur.h;
    if (target.type === 'river') p.baseTo = target.lane.logAt(nx) ? LOG_TOP : WATER_H;
    else p.baseTo = target.h;
    p.tx = nx; p.tz = nz;
    p.hop = 0;
    Sfx.hop(dir, save.boot);
    p.log = null;

    if (dz > 0 && nz > maxZ) {
      maxZ = nz;
      setScore(maxZ);
      const bi = biomeIndex(maxZ);
      idleT = Math.min(0, idleT);                         // progress calms the cat
      if (cat.state === 'stalk') cat.z -= cat.tier.push;            // ...and pushes it back a little
      if (bi !== biomeShown) { biomeShown = bi; showToast(BIOMES[bi].name); Sfx.biome(bi); }
      else if (maxZ % 25 === 0) { showToast(maxZ + ' rows!'); celebrate(); }
      if (!newBestShown && best > 0 && maxZ > best) { newBestShown = true; showToast('New best!'); celebrate(); }
      world.ensure(maxZ + AHEAD);
      if (!trapWarned) {
        for (let k = 1; k <= 4; k++) {
          const r2 = world.rows.get(maxZ + k);
          if (r2 && r2.traps && r2.traps.size) { trapWarned = true; showToast('Traps ahead! Watch your step'); break; }
        }
      }
      world.prune(maxZ - KEEP_BEHIND);
      world.minAllowed = Math.max(world.minAllowed, maxZ - MAX_BACK);
    }
    return true;
  }

  function queueMove(dir) {
    if (state !== 'playing') return;
    if (parrot.hop >= 0) parrot.queued = dir;      // buffer one move; holding a key never auto-repeats
    else tryMove(dir);
  }

  /** Called when a hop finishes: attach to logs, drown, spawn dust, run queued input. */
  function land() {
    const p = parrot;
    p.hop = -1;
    p.x = p.toX; p.z = p.toZ;
    p.squash = 1;
    const row = world.row(p.tz);
    if (row.type === 'river') {
      const log = row.lane.logAt(p.x);
      if (!log) { die('water'); return; }
      p.log = log; p.logOff = p.x - log.x;
      Sfx.land('log');
      burst(p.x, LOG_TOP, p.z, ['#bfe9ff', '#8fd3f5'], 3, 0.7, 1.6, 0.06);
    } else {
      p.log = null;
      Sfx.land(row.type);
      const tr = row.type === 'grass' && row.traps ? row.traps.get(Math.round(p.x)) : null;
      if (tr && tr.t < 0 && p.inv <= 0) {
        tr.t = 0; sprungTraps.push(tr);
        die(tr.kind);
        return;
      }
      burst(p.x, row.h, p.z, row.type === 'grass' ? ['#a8e05a', '#8fd148'] : ['#9aa0ad'], 3, 0.6, 1.4, 0.05);
    }
    const bt = bootById(save.boot);
    if (bt.id === 'goldboots') burst(p.x, row.h + 0.1, p.z, ['#ffd23f', '#fff3b0'], 5, 0.9, 1.7, 0.06);
    else if (bt.id === 'fireboots') burst(p.x, row.h + 0.1, p.z, ['#ff7a1a', '#ffd23f'], 4, 0.8, 1.6, 0.06);
    if (p.queued) { const q = p.queued; p.queued = null; tryMove(q); }
  }

  /** Use a Second Chance boost: put the parrot back on the nearest safe grass tile. */
  function tryRevive() {
    if (save.lives <= 0 || usedLife) return false;
    const p = parrot;
    for (let z = p.tz; z >= Math.max(world.minAllowed, p.tz - 8); z--) {
      const row = world.rows.get(z);
      if (!row || row.type !== 'grass') continue;
      let best = -1, bd = 99;
      for (let c = 0; c < COLS; c++) {
        if (row.trees.has(c) || (row.traps && row.traps.has(c))) continue;
        const d = Math.abs(c - p.x);
        if (d < bd) { bd = d; best = c; }
      }
      if (best < 0) continue;
      usedLife = true;
      save.lives--;
      persist(); updateHud();
      p.x = p.tx = p.toX = p.fromX = best;
      p.z = p.tz = p.toZ = p.fromZ = z;
      p.hop = -1; p.log = null; p.queued = null;
      p.inv = 1.6; p.squash = 1;
      burst(p.x, row.h + 0.4, p.z, ['#ffd23f', '#ffffff', '#ff9f1c'], 16, 1.8, 3.2, 0.09);
      showToast('Second chance!');
      Sfx.revive();
      return true;
    }
    return false;
  }

  function die(type) {
    if (state !== 'playing' || parrot.inv > 0) return;
    if (tryRevive()) return;
    const p = parrot;
    state = 'dying';
    Sfx.die(type);
    p.deadType = type;
    p.deadT = 0;
    p.hop = -1;
    p.queued = null;
    p.log = null;
    const row = world.row(Math.round(p.z));
    deathCause = { car: 'Squashed by traffic!', water: "Splash! Parrots can't swim.", swept: 'Swept away by the current!', cat: 'Caught by the cat!',
      bear: 'Chomped by a bear trap!', snare: 'Yanked up by a snare!', hole: 'Fell down a hole!', banana: 'Slipped on a banana peel!', anvil: 'Flattened by an anvil!' }[type] || 'Oh no!';
    shakeScreen(type === 'cat' ? 12 : 9);
    flashScreen(type === 'water' || type === 'swept' ? '#9fe4ff' : '#ffffff', 0.7);
    if (type === 'cat') {
      deathCause = `Caught by the ${cat.tier.name}!`;
      p.baseTo = row.h;
      burst(p.x, row.h + 0.5, p.z, ['#2fbf4a', '#ff4d4d', '#2f7bff', '#ffd23f', '#ffffff'], 26, 3.0, 4.4, 0.1);
      addPopup(p.x, row.h + 1.4, p.z, 'BONK!', { color: '#ffd23f', size: 40, max: 1.1 });
      cat.state = 'catch'; cat.t = 0;
      catSay('GOTCHA!');
    } else if (type === 'car') {
      p.baseTo = row.h;
      burst(p.x, row.h + 0.4, p.z, ['#2fbf4a', '#ff4d4d', '#2f7bff', '#ffd23f', '#36cf52'], 22, 2.4, 3.6, 0.1);
    } else if (isTrap(type)) {
      p.baseTo = row.h;
      const pal = skinById(save.skin).pal, fe = [pal.body, pal.wing, pal.crest, pal.tip];
      const msg = { bear: 'SNAP!', hole: 'WHEEEE...', snare: 'YIKES!', banana: 'WHOOPS!', anvil: 'UH OH...' }[type];
      addPopup(p.x, row.h + 1.4, p.z, msg, { color: '#ffd23f', size: 32, max: 1.1 });
      burst(p.x, row.h + 0.3, p.z, type === 'bear' ? ['#cfd6dd', '#ffffff', '#ffd23f'].concat(fe) : fe, 14, 2.0, 3.2, 0.09);
    } else {
      ripples.push({ x: p.x, z: p.z, t: 0 });
      burst(p.x, WATER_H, p.z, ['#bfe9ff', '#ffffff', '#6fd0ff'], 22, 1.6, 4.2, 0.09);
    }
  }

  /** Per-frame check against cars using the tile the parrot is visually standing on. */
  function checkCars() {
    const p = parrot;
    const zRow = p.hop >= 0 ? (p.hop / hopTime() < 0.5 ? p.fromZ : p.toZ) : p.tz;
    const row = world.rows.get(Math.round(zRow));
    if (!row || row.type !== 'road') return;
    for (const car of row.lane.items) {
      const dx = Math.abs(car.x - p.x);
      if (dx < car.len / 2 + 0.26) { die('car'); return; }
      if (dx < car.len / 2 + 1.2 && !(car.honk > 0)) {                  // close call: the driver lets you know
        car.honk = 5;
        Sfx.honk(car.type);
        const word = car.type === 'police' ? 'WEE-OO!' : car.type === 'icecream' ? 'DING-A-LING!' : car.type === 'bus' || car.type === 'truck' ? 'HOOONK!' : 'BEEP!';
        addPopup(car.x, 1.3, row.z, word, { color: '#ffd23f', size: 20, max: 0.9 });
        shakeScreen(1.5);
      }
    }
  }

  function updateParrot(dt) {
    const p = parrot;
    p.squash = Math.max(0, p.squash - dt * 7);
    p.bump = Math.max(0, p.bump - dt * 6);
    p.inv = Math.max(0, p.inv - dt);
    if (p.hop >= 0) {
      p.hop += dt;
      const u = Math.min(1, p.hop / hopTime());
      p.x = lerp(p.fromX, p.toX, u);
      p.z = lerp(p.fromZ, p.toZ, u);
      if (u >= 1) land();
    } else if (p.log) {
      p.x = p.log.x + p.logOff;                       // ride the log
      if (p.x < -0.6 || p.x > COLS - 0.4) { die('swept'); return; }   // carried off the playfield
    }
    if (state === 'playing') { checkCars(); collectCoins(); }
  }

  function pickCoin(c, x, y, z) {
    c.got = true;
    save.coins++;
    runCoins++;
    persist();
    updateHud();
    burst(x, y, z, ['#ffd23f', '#fff3b0', '#ff9f1c'], 7, 1.2, 2.6, 0.07);
    addPopup(x, y + 0.3, z, '+1', { color: '#ffd23f', size: 24, max: 0.8 });
    // quick successive pickups build a combo; every third one pays a bonus coin
    comboCount = comboT > 0 ? comboCount + 1 : 1;
    comboT = 3;
    Sfx.coin(comboCount);
    if (comboCount >= 3) {
      ui.comboChip.hidden = false;
      ui.comboChip.textContent = 'Combo x' + comboCount;
      if (comboCount % 3 === 0) {
        Sfx.combo();
        save.coins++; runCoins++; persist(); updateHud();
        addPopup(parrot.x, 1.5, parrot.z, 'COMBO x' + comboCount + '!', { color: '#ff7eb6', size: 30, max: 1.1 });
        burst(x, y, z, ['#ff7eb6', '#ffd23f', '#6fe7ff'], 12, 1.8, 3.2, 0.08);
      }
    }
  }

  /** Collect coins close to the parrot (a wider net with the Coin magnet). */
  function collectCoins() {
    const p = parrot;
    const r = save.magnet ? 1.8 : 0.55, r2 = r * r;
    const zr = Math.round(p.z);
    const span = save.magnet ? 1 : 0;
    for (let dz = -span; dz <= span; dz++) {
      const row = world.rows.get(zr + dz);
      if (!row) continue;
      for (const c of row.coins) {
        if (c.got) continue;
        const dx = c.x - p.x, dzz = row.z - p.z;
        if (dx * dx + dzz * dzz < r2) pickCoin(c, c.x, row.h + 0.45, row.z);
      }
      if (row.type === 'river') {
        for (const log of row.lane.items) {
          const c = log.coin;
          if (!c || c.got) continue;
          const wx = log.x + c.off, dx = wx - p.x, dzz = row.z - p.z;
          if (dx * dx + dzz * dzz < r2) pickCoin(c, wx, LOG_TOP + 0.4, row.z);
        }
      }
    }
  }

  /* ---------------------------------------------------------------
   * Main update
   * --------------------------------------------------------------- */
  function update(dt) {
    if (state === 'paused') return;
    time += dt;
    world.update(dt);
    updateParticles(dt);
    updateEffects(dt);
    updateTraps(dt);

    if (state === 'playing') {
      runTime += dt;
      Sfx.mood(biomeIndex(maxZ), dangerCur);
      updateParrot(dt);
      if (state === 'playing') updateCat(dt);
    } else if (state === 'dying') {
      const p = parrot;
      p.deadT += dt;
      if (p.deadT > deathLen(p.deadType)) gameOver();
    }
    updateDanger(dt);

    // Sky colour eases toward the biome the camera is looking at.
    const sb = biomeAt(Math.round(cam.z + 4)), sk = 1 - Math.exp(-2.2 * dt);
    const t0 = hexRgb(sb.sky[0]), t1 = hexRgb(sb.sky[1]);
    for (let i = 0; i < 3; i++) {
      skyCur.top[i] += (t0[i] - skyCur.top[i]) * sk;
      skyCur.bot[i] += (t1[i] - skyCur.bot[i]) * sk;
    }

    // Camera: follow the parrot, never lag too far behind the furthest row.
    if (state !== 'dying' && state !== 'over') {
      const tz = Math.max(parrot.z, maxZ - 3);
      const tx = MID + (parrot.x - MID) * 0.55;
      cam.z += (tz - cam.z) * (1 - Math.exp(-6 * dt));
      cam.x += (tx - cam.x) * (1 - Math.exp(-5 * dt));
    }
  }

  /* ===================================================================
   * Rendering
   * =================================================================== */
  const items = [];                          // depth-sorted boxes for this frame
  // Draw order: far rows first; inside a row, scenery/vehicles (layer 0) before whatever stands ON them
  // (layer 1, e.g. a parrot or coin on a log); then left to right. This stops long logs covering riders.
  const G = { row: 0, layer: 0, gk: 0, yw: 0.4 };   // yw: how strongly height orders boxes inside one object
  const byDepth = (a, b) => (b.row - a.row) || (a.layer - b.layer) || (a.gk - b.gk) || (a.k - b.k);

  function sxOf(x, z) { return V.ox + ((x - V.cx) + (z - V.cz)) * V.hw; }
  function syOf(x, y, z) { return V.oy + ((x - V.cx) - (z - V.cz)) * V.hh - y * V.hv; }

  /** Queue a box. Sort key approximates distance from the camera (nearer = larger). */
  function addBox(x0, x1, z0, z1, y0, y1, hexOrFaces, alpha) {
    const f = typeof hexOrFaces === 'string' ? faces(hexOrFaces) : hexOrFaces;
    items.push({ row: G.row, layer: G.layer, gk: G.gk, k: x1 - z0 + (y0 + y1) * G.yw, x0, x1, z0, z1, y0, y1, f, a: alpha });
  }

  function drawBox(b) {
    const hw = V.hw, hh = V.hh;
    const u0 = b.x0 - V.cx, u1 = b.x1 - V.cx, w0 = b.z0 - V.cz, w1 = b.z1 - V.cz;
    const sxA = V.ox + (u0 + w0) * hw, sxB = V.ox + (u1 + w0) * hw;
    const sxC = V.ox + (u1 + w1) * hw, sxD = V.ox + (u0 + w1) * hw;
    const gA = V.oy + (u0 - w0) * hh, gB = V.oy + (u1 - w0) * hh;
    const gC = V.oy + (u1 - w1) * hh, gD = V.oy + (u0 - w1) * hh;
    const yb = b.y0 * V.hv, yt = b.y1 * V.hv;
    if (sxC < -8 || sxA > V.w + 8 || gB - yb < -8 || gD - yt > V.h + 8) return;     // off screen
    if (b.a !== undefined) ctx.globalAlpha = b.a;

    ctx.fillStyle = b.f.left;                              // left face (z = z0)
    ctx.beginPath();
    ctx.moveTo(sxA, gA - yb); ctx.lineTo(sxB, gB - yb); ctx.lineTo(sxB, gB - yt); ctx.lineTo(sxA, gA - yt);
    ctx.fill();
    ctx.fillStyle = ctx.strokeStyle = b.f.right;           // right face (x = x1); the hairline stroke hides the seam
    ctx.beginPath();
    ctx.moveTo(sxB, gB - yb); ctx.lineTo(sxC, gC - yb); ctx.lineTo(sxC, gC - yt); ctx.lineTo(sxB, gB - yt);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = b.f.top;                               // top face
    ctx.beginPath();
    ctx.moveTo(sxA, gA - yt); ctx.lineTo(sxB, gB - yt); ctx.lineTo(sxC, gC - yt); ctx.lineTo(sxD, gD - yt);
    ctx.fill();
    if (b.a !== undefined) ctx.globalAlpha = 1;
  }

  /** Flat rectangle on the ground plane, appended to the current path. */
  function pathXZ(x0, x1, z0, z1, y) {
    ctx.moveTo(sxOf(x0, z0), syOf(x0, y, z0));
    ctx.lineTo(sxOf(x1, z0), syOf(x1, y, z0));
    ctx.lineTo(sxOf(x1, z1), syOf(x1, y, z1));
    ctx.lineTo(sxOf(x0, z1), syOf(x0, y, z1));
    ctx.closePath();
  }
  function fillXZ(color, x0, x1, z0, z1, y) {
    ctx.fillStyle = color;
    ctx.beginPath();
    pathXZ(x0, x1, z0, z1, y);
    ctx.fill();
  }

  function onScreen(x, z, padX, padY) {
    const sx = sxOf(x, z), sy = syOf(x, 0, z);
    return sx > -padX && sx < V.w + padX && sy > -padY && sy < V.h + padY;
  }

  /** Visible x-range of a row (clamped to the generated scenery). */
  function visibleX(z) {
    const dz = z - V.cz;
    const x0 = V.cx - dz + (-80 - V.ox) / V.hw;
    const x1 = V.cx - dz + (V.w + 80 - V.ox) / V.hw;
    return [Math.max(x0, -30), Math.min(x1, COLS + 30)];
  }

  function faceColor(row) {
    const B = row.biome;
    return row.type === 'grass' ? B.face : row.type === 'road' ? shade(B.road, 0.62) : shade(B.water, 0.72);
  }

  function drawRowGround(row) {
    const z = row.z;
    const [x0, x1] = visibleX(z);
    if (x1 <= x0) return;
    const y = row.h;
    const B = row.biome;

    // Side face toward the camera where this row stands higher than the one in front of it.
    const below = world.rows.get(z - 1);
    if (below && below.h < row.h - 0.001) {
      ctx.fillStyle = faceColor(row);
      ctx.beginPath();
      const za = z - 0.5;
      ctx.moveTo(sxOf(x0, za), syOf(x0, below.h, za));
      ctx.lineTo(sxOf(x1, za), syOf(x1, below.h, za));
      ctx.lineTo(sxOf(x1, za), syOf(x1, row.h, za));
      ctx.lineTo(sxOf(x0, za), syOf(x0, row.h, za));
      ctx.closePath();
      ctx.fill();
    }

    if (row.type === 'grass') {
      fillXZ(B.ground, x0, x1, z - 0.5, z + 0.5, y);
      ctx.fillStyle = B.alt;                               // checker tiles
      ctx.beginPath();
      for (let c = Math.ceil(x0); c < x1; c++) if (((c + z) & 1) === 0) pathXZ(c - 0.5, c + 0.5, z - 0.5, z + 0.5, y);
      ctx.fill();
      for (const f of row.flowers) {                       // tiny flowers
        const sx = sxOf(f.x, z + f.dz), sy = syOf(f.x, y, z + f.dz);
        if (sx < -10 || sx > V.w + 10) continue;
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.arc(sx, sy, V.S * 0.07, 0, 6.283);
        ctx.fill();
      }
      if (row.traps && row.traps.size) drawTrapFlats(row);
    } else if (row.type === 'road') {
      fillXZ(B.road, x0, x1, z - 0.5, z + 0.5, y);
      const prev = world.rows.get(z - 1);
      if (prev && prev.type === 'road') {                  // dashed lane marking between road rows
        ctx.fillStyle = B.line;
        ctx.beginPath();
        for (let c = Math.floor(x0 / 2) * 2; c < x1; c += 2) pathXZ(c - 0.5, c + 0.4, z - 0.54, z - 0.46, y + 0.002);
        ctx.fill();
      }
    } else {
      fillXZ(B.water, x0, x1, z - 0.5, z + 0.5, y);
      ctx.strokeStyle = B.wave;          // drifting wave marks
      ctx.lineWidth = Math.max(1.5, V.S * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      const drift = (time * 0.35 * row.lane.dir) % 2.6;
      for (let c = Math.floor(x0 / 2.6) * 2.6; c < x1; c += 2.6) {
        const hsh = Math.sin(c * 12.9898 + z * 78.233) * 43758.5453;
        const zz = z + ((hsh - Math.floor(hsh)) - 0.5) * 0.7;
        const wx = c + drift;
        ctx.moveTo(sxOf(wx, zz), syOf(wx, y + 0.002, zz));
        ctx.lineTo(sxOf(wx + 0.7, zz), syOf(wx + 0.7, y + 0.002, zz));
      }
      ctx.stroke();
    }
  }

  /* ---- scenery & vehicles -> boxes ---- */

  /** Scenery props. Every kind is built from a few boxes to keep the low-poly look. */
  function addProp(kind, x, z, y, s, B, lod) {
    G.row = Math.round(z); G.layer = 0; G.gk = x; G.yw = 3;
    const sq = (hw, y0, y1, color, ox = 0, oz = 0) => addBox(x + ox - hw, x + ox + hw, z + oz - hw, z + oz + hw, y + y0 * s, y + y1 * s, color);
    if (lod) {                                             // cheap version for far-away scenery
      switch (kind) {
        case 'round': sq(0.1, 0, 0.4, B.trunk); sq(0.4, 0.4, 1.35, B.leaf[1]); break;
        case 'autumn': sq(0.1, 0, 0.4, B.trunk); sq(0.4, 0.4, 1.35, AUTUMN_LEAF[1]); break;
        case 'pine': sq(0.1, 0, 0.4, B.trunk); sq(0.38, 0.4, 1.45, B.leaf[1]); break;
        case 'snowpine': sq(0.1, 0, 0.4, B.trunk); sq(0.38, 0.4, 1.3, B.leaf[0]); sq(0.4, 1.3, 1.45, '#ffffff'); break;
        case 'cactus': sq(0.15, 0, 0.95, '#3a9d4f'); sq(0.3, 0.4, 0.5, '#3a9d4f'); break;
        case 'palm': sq(0.1, 0, 1.2, B.trunk); sq(0.5, 1.2, 1.3, '#2e9e48'); break;
        case 'snowman': sq(0.28, 0, 0.9, '#f4f8fb'); break;
        case 'basalt': sq(0.26, 0, 0.9, '#4a4655'); sq(0.1, 0.9, 0.97, '#ff7a1a'); break;
        case 'ember': sq(0.12, 0, 0.8, '#2a2430'); sq(0.2, 0.8, 0.9, '#ff7a1a'); break;
        default: sq(0.3, 0, 0.45, B.rock);
      }
      return;
    }
    switch (kind) {
      case 'round':
      case 'autumn': {
        const L = kind === 'autumn' ? AUTUMN_LEAF : B.leaf;
        sq(0.12, 0, 0.45, B.trunk);
        sq(0.4, 0.4, 1.05, L[1]);
        sq(0.27, 1.05, 1.4, L[2]);
        break;
      }
      case 'pine':
        sq(0.12, 0, 0.45, B.trunk);
        sq(0.42, 0.4, 0.8, B.leaf[0]); sq(0.3, 0.8, 1.15, B.leaf[1]); sq(0.16, 1.15, 1.5, B.leaf[2]);
        break;
      case 'snowpine':
        sq(0.12, 0, 0.45, B.trunk);
        sq(0.42, 0.4, 0.78, B.leaf[0]); sq(0.44, 0.78, 0.86, '#ffffff');
        sq(0.3, 0.86, 1.14, B.leaf[1]); sq(0.32, 1.14, 1.22, '#ffffff');
        sq(0.16, 1.22, 1.5, B.leaf[2]); sq(0.17, 1.5, 1.58, '#ffffff');
        break;
      case 'cactus':
        sq(0.15, 0, 0.95, '#3a9d4f');
        addBox(x + 0.15, x + 0.36, z - 0.09, z + 0.09, y + 0.38 * s, y + 0.5 * s, '#3a9d4f');
        addBox(x + 0.27, x + 0.36, z - 0.09, z + 0.09, y + 0.5 * s, y + 0.78 * s, '#4caf5e');
        addBox(x - 0.36, x - 0.15, z - 0.09, z + 0.09, y + 0.52 * s, y + 0.62 * s, '#3a9d4f');
        addBox(x - 0.36, x - 0.27, z - 0.09, z + 0.09, y + 0.62 * s, y + 0.85 * s, '#4caf5e');
        sq(0.05, 0.95, 1.03, '#ff7eb6');
        break;
      case 'palm':
        sq(0.1, 0, 0.4, B.trunk);
        sq(0.1, 0.4, 0.8, B.trunk, 0.03, 0.02);
        sq(0.1, 0.8, 1.2, B.trunk, 0.06, 0.04);
        addBox(x - 0.5, x + 0.62, z - 0.02, z + 0.1, y + 1.2 * s, y + 1.28 * s, '#2e9e48');
        addBox(x + 0.0, x + 0.12, z - 0.5, z + 0.6, y + 1.2 * s, y + 1.28 * s, '#43b95b');
        sq(0.2, 1.2, 1.36, '#2a8a42', 0.06, 0.04);
        break;
      case 'rock':
        addBox(x - 0.32, x + 0.32, z - 0.28, z + 0.28, y, y + 0.34 * s, B.rock);
        addBox(x - 0.18, x + 0.2, z - 0.16, z + 0.18, y + 0.34 * s, y + 0.52 * s, hexShade(B.rock, 1.15));
        break;
      case 'snowman':
        sq(0.3, 0, 0.4, '#f4f8fb'); sq(0.22, 0.4, 0.72, '#f4f8fb'); sq(0.17, 0.72, 0.98, '#ffffff');
        sq(0.18, 0.68, 0.74, '#ff4d4d');
        addBox(x + 0.16, x + 0.28, z - 0.03, z + 0.03, y + 0.82 * s, y + 0.87 * s, '#ff8a3d');
        addBox(x + 0.165, x + 0.18, z - 0.09, z - 0.05, y + 0.88 * s, y + 0.93 * s, '#1b1b2f');
        addBox(x + 0.165, x + 0.18, z + 0.05, z + 0.09, y + 0.88 * s, y + 0.93 * s, '#1b1b2f');
        break;
      case 'basalt':
        sq(0.28, 0, 0.7, '#4a4655'); sq(0.18, 0.7, 1.0, '#5d5869'); sq(0.1, 1.0, 1.07, '#ff7a1a');
        break;
      case 'ember':
        sq(0.12, 0, 0.8, '#2a2430');
        addBox(x - 0.3, x + 0.3, z - 0.1, z + 0.1, y + 0.5 * s, y + 0.58 * s, '#2a2430');
        sq(0.07, 0.8, 0.95, '#ff7a1a');
        addBox(x + 0.24, x + 0.32, z - 0.06, z + 0.06, y + 0.58 * s, y + 0.7 * s, '#ff7a1a');
        break;
      default:
        sq(0.3, 0, 0.5, B.rock);
    }
  }

  /** A spinning gold coin (drawn as a squashed ellipse, depth-sorted with the boxes). */
  function addCoin(x, y, z, gy, layer) {
    items.push({ row: Math.round(z), layer: layer || 0, gk: x, k: x - (z - 0.2) + y * 0.4, coin: { x, y, z, gy } });
  }
  function drawCoin(c) {
    const sx = sxOf(c.x, c.z), sy = syOf(c.x, c.y, c.z);
    const r = V.S * 0.2;
    const sc = Math.abs(Math.cos(time * 3.2 + c.x * 0.7)) * 0.85 + 0.15;
    ctx.fillStyle = 'rgba(15,25,30,0.2)';
    ctx.beginPath();
    ctx.ellipse(sxOf(c.x, c.z), syOf(c.x, c.gy + 0.003, c.z), r * 0.9, r * 0.45, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#e0a100';
    ctx.beginPath(); ctx.ellipse(sx, sy, r * sc + 1.5, r + 1.5, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.ellipse(sx, sy, r * sc, r, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.ellipse(sx - r * sc * 0.2, sy - r * 0.25, r * sc * 0.35, r * 0.4, 0, 0, 6.283); ctx.fill();
  }


  /* ===================================================================
   * Traps: gadgets lying on grass tiles, each with its own slapstick ending
   * =================================================================== */
  const easeOut = (u) => 1 - (1 - u) * (1 - u);

  /** Snare: how high the parrot is hoisted and how far it swings sideways. */
  function snareHang(t) {
    const u = Math.min(1, t / 0.2);
    const swing = t < 0.2 ? 0 : Math.sin((t - 0.2) * 6) * 0.45 * Math.exp(-(t - 0.2) * 0.6);
    return { up: 1.7 * easeOut(u), swing };
  }

  /** How fast the parrot thrashes around (faces per second) while a trap does its thing. */
  function deathSpin(kind, t) {
    switch (kind) {
      case 'hole': return t < 0.9 ? 16 : 0;
      case 'banana': return t > 0.08 && t < 0.7 ? 18 : 0;
      case 'snare': return t > 0.2 ? 3 : 0;
      case 'bear': return t > 0.12 && t < 0.85 ? 22 : 0;
      default: return 0;
    }
  }

  function trapPose(kind, t, gy) {
    let base = gy, sy = 1, sw = 1, ox = 0, oz = 0, lift = 0, alpha;
    switch (kind) {
      case 'bear':                                        // chomp, wiggle in the jaws, then BOING into the sky
        if (t < 0.12) { const u = t / 0.12; sy = lerp(1, 0.62, u); sw = lerp(1, 1.2, u); }
        else if (t < 0.85) { sy = 0.7 + Math.sin(t * 34) * 0.07; sw = 1.12; ox = Math.sin(t * 40) * 0.05; lift = 0.9; }
        else { const f = t - 0.85; base = gy + 0.3 + 6.5 * f - 5.5 * f * f; ox = f * 0.9; oz = -f * 1.4; lift = 1; }
        if (t > 1.5) alpha = Math.max(0, 1 - (t - 1.5) / 0.3);
        break;
      case 'hole': {                                      // swirls down the drain
        const u = clamp((t - 0.12) / 0.8, 0, 1), k = Math.max(0.03, 1 - u);
        sy = t < 0.12 ? 1 - 0.1 * Math.sin(t * 60) : k;
        sw = k; base = gy - u * 0.1; lift = 1 - u;
        if (t > 0.9) alpha = 0;
        break;
      }
      case 'snare': {                                     // hoisted up and left dangling
        const h = snareHang(t);
        base = gy + h.up + Math.abs(h.swing) * 0.2; ox = h.swing; lift = 1;
        if (t > 1.75) alpha = Math.max(0, 1 - (t - 1.75) / 0.3);
        break;
      }
      case 'banana':                                      // slips, somersaults, splats
        if (t < 0.08) { lift = 0.5; ox = Math.sin(t * 90) * 0.05; }
        else if (t < 0.7) { const u = (t - 0.08) / 0.62; base = gy + 1.9 * Math.sin(Math.PI * u); oz = 1.4 * u; lift = 1; }
        else { sy = 0.12; sw = 1.8; oz = 1.4; }
        if (t > 1.2) alpha = Math.max(0, 1 - (t - 1.2) / 0.3);
        break;
      case 'anvil':                                       // looks up... then pancake
        if (t < 0.28) { lift = 0.3; sy = 1 + 0.06 * Math.sin(t * 40); }
        else { const u = Math.min(1, (t - 0.28) / 0.05); sy = lerp(1, 0.08, u); sw = lerp(1, 1.9, u); }
        if (t > 1.2) alpha = Math.max(0, 1 - (t - 1.2) / 0.3);
        break;
      default: break;
    }
    return { base, lift, sy, sw, alpha, ox, oz };
  }

  /** Runs the clock of every sprung trap and fires its second-act effects (clang, boing, splat...). */
  function updateTraps(dt) {
    for (let i = sprungTraps.length - 1; i >= 0; i--) {
      const tr = sprungTraps[i];
      tr.t += dt;
      const { t, x, z, y } = tr;
      const pal = skinById(save.skin).pal, fe = [pal.body, pal.wing, pal.crest, pal.tip];
      if (tr.kind === 'anvil' && tr.stage === 0 && t >= 0.28) {
        tr.stage = 1;
        shakeScreen(11); flashScreen('#ffffff', 0.35);
        burst(x, y + 0.2, z, ['#cfd6dd', '#ffffff', '#ffd23f', '#6e7580'].concat(fe), 22, 2.6, 3.4, 0.09);
        addPopup(x, y + 1.3, z, 'CLANG!', { color: '#ffd23f', size: 38, max: 1.0 });
      } else if (tr.kind === 'bear' && tr.stage === 0 && t >= 0.85) {
        tr.stage = 1;
        shakeScreen(6);
        burst(x, y + 0.3, z, ['#cfd6dd', '#ffffff', '#ffd23f'], 14, 2.2, 3.6, 0.08);
        addPopup(x, y + 1.3, z, 'BOING!', { color: '#6fe7ff', size: 36, max: 1.0 });
      } else if (tr.kind === 'banana' && tr.stage === 0 && t >= 0.7) {
        tr.stage = 1;
        shakeScreen(6);
        burst(x, y + 0.2, z + 1.4, ['#ffe14a', '#ffffff', '#cfa968'].concat(fe), 16, 2.0, 2.6, 0.09);
        addPopup(x, y + 1.0, z + 1.4, 'SPLAT!', { color: '#ffe14a', size: 34, max: 1.0 });
      } else if (tr.kind === 'hole' && tr.stage === 0 && t >= 0.9) {
        tr.stage = 1;
        burst(x, y + 0.1, z, ['#6b4a2b', '#8a5a2b', '#3a2618'], 14, 1.6, 3.0, 0.09);
        burst(x, y + 0.2, z, fe, 4, 0.8, 3.6, 0.1);                       // one last feather floats up
        addPopup(x, y + 0.9, z, '...', { color: '#ffffff', size: 30, max: 1.1 });
      } else if (tr.kind === 'snare' && tr.stage === 0 && t >= 0.6) {
        tr.stage = 1;
        addPopup(x, y + 2.6, z, 'HELP!', { color: '#ffffff', size: 26, max: 1.2 });
      }
      if (t > 12) sprungTraps.splice(i, 1);
    }
  }

  /** A little iron anvil built from boxes. */
  function addAnvil(cx, cz, y0) {
    addBox(cx - 0.28, cx + 0.28, cz - 0.2, cz + 0.2, y0, y0 + 0.1, '#3d424c');
    addBox(cx - 0.14, cx + 0.14, cz - 0.12, cz + 0.12, y0 + 0.1, y0 + 0.28, '#4a505c');
    addBox(cx - 0.38, cx + 0.3, cz - 0.22, cz + 0.22, y0 + 0.28, y0 + 0.5, '#5b6270');
    addBox(cx + 0.3, cx + 0.62, cz - 0.12, cz + 0.12, y0 + 0.34, y0 + 0.48, '#5b6270');
    addBox(cx - 0.36, cx + 0.28, cz - 0.2, cz + 0.2, y0 + 0.5, y0 + 0.53, '#98a1b0');
  }
  function addPeel(x, y, z) {
    addBox(x - 0.2, x + 0.2, z - 0.07, z + 0.07, y, y + 0.05, '#ffe14a');
    addBox(x - 0.22, x - 0.14, z - 0.07, z + 0.07, y + 0.05, y + 0.16, '#ffd23f');
    addBox(x + 0.14, x + 0.22, z - 0.07, z + 0.07, y + 0.05, y + 0.16, '#ffd23f');
    addBox(x - 0.24, x - 0.2, z - 0.04, z + 0.04, y + 0.16, y + 0.2, '#6b4a2b');
    addBox(x - 0.12, x + 0.12, z - 0.22, z - 0.07, y, y + 0.03, '#f5d63a');
    addBox(x - 0.12, x + 0.12, z + 0.07, z + 0.22, y, y + 0.03, '#f5d63a');
  }

  /** The raised parts of a trap (jaws, sapling, peel, anvil). Flat parts are drawn by drawTrapFlats. */
  function addTrap(tr, c, z, row) {
    const y = row.h, t = tr.t, armed = t < 0, leaf = row.biome.leaf[1];
    G.row = z; G.layer = 0; G.gk = c; G.yw = 0.4;
    switch (tr.kind) {
      case 'bear': {
        const e = armed ? 0 : clamp(t / 0.07, 0, 1);                      // jaws slam shut
        const jx = lerp(0.3, 0.05, e), jh = lerp(0.05, 0.34, e);
        addBox(c - 0.22, c + 0.22, z - 0.3, z + 0.3, y, y + 0.03, '#4a4f58');
        addBox(c + 0.3, c + 0.5, z - 0.025, z + 0.025, y, y + 0.03, '#6e7580');          // chain
        for (const s of [-1, 1]) {
          addBox(c + s * jx - 0.035, c + s * jx + 0.035, z - 0.3, z + 0.3, y + 0.03, y + 0.03 + jh, '#8c939c');
          for (let i = 0; i < 4; i++) {
            const zz = z - 0.225 + i * 0.15 + (s > 0 ? 0.05 : 0), tx = c + s * (jx - 0.075);
            addBox(tx - 0.03, tx + 0.03, zz - 0.03, zz + 0.03, y + 0.03 + jh * 0.6, y + 0.03 + jh + 0.1, '#d7dde4');
          }
        }
        break;
      }
      case 'snare':
        if (armed) {                                                      // a bent sapling, tied down to the loop
          [[0.4, 0, 0.7], [0.3, 0.7, 0.95], [0.15, 0.95, 1.1], [0.0, 1.1, 1.2]]
            .forEach(([dz, a, b]) => addBox(c - 0.05, c + 0.05, z + dz - 0.05, z + dz + 0.05, y + a, y + b, '#8a5a2b'));
          addBox(c - 0.012, c + 0.012, z - 0.012, z + 0.012, y + 0.03, y + 1.1, '#e8d2a0');
          addBox(c - 0.12, c + 0.12, z - 0.12, z + 0.12, y + 1.2, y + 1.36, leaf);
        } else {                                                          // sprung: the sapling snaps upright with the parrot
          const h = snareHang(t), rx = c + h.swing * 0.6;
          addBox(c - 0.05, c + 0.05, z + 0.35, z + 0.45, y, y + 3.3, '#8a5a2b');
          addBox(c - 0.05, c + 0.05, z - 0.05, z + 0.45, y + 3.2, y + 3.3, '#8a5a2b');
          addBox(c - 0.3, c + 0.3, z - 0.1, z + 0.5, y + 3.3, y + 3.55, leaf);
          addBox(rx - 0.012, rx + 0.012, z - 0.012, z + 0.012, y + h.up + 1.05, y + 3.2, '#e8d2a0');
        }
        break;
      case 'hole':
        addBox(c - 0.5, c - 0.4, z + 0.2, z + 0.3, y, y + 0.1, row.biome.rock);
        addBox(c + 0.34, c + 0.44, z - 0.3, z - 0.2, y, y + 0.08, row.biome.rock);
        break;
      case 'banana':
        if (armed) addPeel(c, y, z);
        else {                                                            // the peel is flicked away
          const u = Math.min(1, t / 0.6);
          addPeel(c + 0.9 * easeOut(u), y + 1.4 * Math.sin(Math.PI * u), z - 0.3 * u);
        }
        break;
      case 'anvil':
        if (armed) break;                                                 // just a pressure plate, drawn flat
        {
          let ax = c, ay = y;
          if (t < 0.28) ay = y + 7 * (1 - (t / 0.28) * (t / 0.28));      // drops out of the sky
          else { const s = Math.min(1, (t - 0.28) / 0.45); ax = c + 0.95 * easeOut(s); ay = y + 1.1 * Math.sin(Math.PI * s); }   // bounces off
          addAnvil(ax, z, ay);
        }
        break;
      default: break;
    }
  }

  function circleXZ(cx, cz, r, y) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * 6.2832, x = cx + Math.cos(a) * r, zz = cz + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(sxOf(x, zz), syOf(x, y, zz)); else ctx.lineTo(sxOf(x, zz), syOf(x, y, zz));
    }
    ctx.closePath();
  }

  /** The flat parts of each trap: the hole itself, the rope loop and the pressure plate. */
  function drawTrapFlats(row) {
    const z = row.z, y = row.h, B = row.biome;
    row.traps.forEach((tr, c) => {
      const sx = sxOf(c, z);
      if (sx < -80 || sx > V.w + 80) return;
      const t = tr.t;
      if (tr.kind === 'hole') {
        ctx.fillStyle = shade(B.ground, 0.62); ctx.beginPath(); circleXZ(c, z, 0.47, y + 0.002); ctx.fill();
        ctx.fillStyle = '#3a2618'; ctx.beginPath(); circleXZ(c, z, 0.38, y + 0.003); ctx.fill();
        ctx.fillStyle = '#0d0704'; ctx.beginPath(); circleXZ(c + 0.03, z - 0.02, 0.3, y + 0.004); ctx.fill();
      } else if (tr.kind === 'snare') {
        const r = t < 0 ? 0.32 : lerp(0.32, 0.07, Math.min(1, t / 0.15));
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#7a5a2c'; ctx.lineWidth = Math.max(3, V.S * 0.085); ctx.beginPath(); circleXZ(c, z, r, y + 0.003); ctx.stroke();
        ctx.strokeStyle = '#e8d2a0'; ctx.lineWidth = Math.max(2, V.S * 0.045); ctx.beginPath(); circleXZ(c, z, r, y + 0.004); ctx.stroke();
      } else if (tr.kind === 'anvil') {
        ctx.fillStyle = '#2f343c'; ctx.beginPath(); pathXZ(c - 0.4, c + 0.4, z - 0.4, z + 0.4, y + 0.002); ctx.fill();
        ctx.fillStyle = '#8a919c'; ctx.beginPath(); pathXZ(c - 0.34, c + 0.34, z - 0.34, z + 0.34, y + 0.003); ctx.fill();
        ctx.fillStyle = '#ffd23f'; ctx.beginPath();                                   // hazard corners
        for (const [sx2, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const px = c + sx2 * 0.27, pz = z + sz2 * 0.27;
          pathXZ(px - 0.06, px + 0.06, pz - 0.06, pz + 0.06, y + 0.004);
        }
        ctx.fill();
        ctx.fillStyle = t >= 0 ? '#7a2420' : (Math.sin(time * 5) > 0 ? '#ff6a5f' : '#c8362c');
        ctx.beginPath(); circleXZ(c, z, 0.14, y + 0.005); ctx.fill();
        if (t >= 0 && t < 0.28) {                                                     // the shadow of what is coming
          ctx.fillStyle = 'rgba(15, 20, 30, 0.35)';
          ctx.beginPath(); circleXZ(c, z, 0.15 + 0.4 * (t / 0.28), y + 0.006); ctx.fill();
        }
      }
    });
  }

  function drawItem(b) { if (b.coin) drawCoin(b.coin); else drawBox(b); }

  const GLASS = { left: '#86bbd8', right: '#5f93b3' };
  const WHEEL_FACES = { top: '#3a3b46', left: '#23242e', right: '#16171e' };

  /** Cars are built from local coordinates (l = along the direction of travel) so they can face either way. */
  function addCar(car, z, dir) {
    G.row = Math.round(z); G.layer = 0; G.gk = car.x; G.yw = 3;
    const x = car.x, h = car.len / 2, c = car.color;
    const by = ROAD_H + Math.sin(time * 15 + car.phase) * 0.012;           // tiny suspension bounce
    const B = (l0, l1, z0, z1, y0, y1, color) => {
      const a = x + dir * l0, b = x + dir * l1;
      addBox(a < b ? a : b, a < b ? b : a, z + z0, z + z1, by + y0, by + y1, color);
    };
    const glass = (top) => ({ top, left: GLASS.left, right: GLASS.right });
    const cf = faces(c);
    const wheel = (l) => B(l - 0.15, l + 0.15, -0.43, -0.27, 0, 0.26, WHEEL_FACES);

    B(-h + 0.06, h - 0.06, -0.3, 0.3, 0.05, 0.18, '#23242e');                // chassis
    if (car.type === 'bus') { wheel(-h + 0.7); wheel(h - 0.7); }
    else if (car.type === 'truck') { wheel(-h + 0.5); wheel(-h + 1.3); wheel(h - 0.4); }
    else { wheel(-h + 0.34); wheel(h - 0.34); }

    const sedanLike = (body, roof, l0, l1, bodyTop) => {
      B(-h, h, -0.34, 0.34, 0.14, bodyTop, body);
      B(h - 0.05, h, -0.345, 0.345, 0.14, bodyTop - 0.12, '#d9dde6');        // bumpers
      B(-h, -h + 0.05, -0.345, 0.345, 0.14, bodyTop - 0.12, '#d9dde6');
      B(l0, l1, -0.29, 0.29, bodyTop, bodyTop + 0.3, glass(faces(roof).top));
      B(l0 - 0.02, l1 + 0.02, -0.31, 0.31, bodyTop + 0.3, bodyTop + 0.36, roof);
    };

    switch (car.type) {
      case 'hatch': sedanLike(c, c, -h * 0.72, h * 0.55, 0.4); break;
      case 'sedan': sedanLike(c, c, -h * 0.62, h * 0.3, 0.4); break;
      case 'taxi':
        sedanLike(c, c, -h * 0.62, h * 0.3, 0.4);
        B(-h, h, -0.35, 0.35, 0.26, 0.3, '#1b1b2f');                         // checker band
        B(-0.12, 0.12, -0.1, 0.1, 0.76, 0.86, '#fff3b0');                    // roof sign
        break;
      case 'police': {
        sedanLike(c, '#e9edf5', -h * 0.62, h * 0.3, 0.4);
        B(-h, h, -0.35, 0.35, 0.2, 0.3, '#2a4fb0');                          // blue stripe
        const flash = Math.floor(time * 7 + car.phase) % 2 === 0;
        B(-0.16, 0.16, -0.24, 0, 0.76, 0.86, flash ? '#ff2d2d' : '#7a1a1a'); // flashing light bar
        B(-0.16, 0.16, 0, 0.24, 0.76, 0.86, flash ? '#1a2a7a' : '#3d7bff');
        break;
      }
      case 'sports': {
        const l0 = -h * 0.45, l1 = h * 0.25;
        B(-h, h, -0.36, 0.36, 0.1, 0.3, c);
        B(l0, l1, -0.28, 0.28, 0.3, 0.5, glass(cf.top));
        B(l0 - 0.02, l1 + 0.02, -0.3, 0.3, 0.5, 0.55, c);
        B(-h, l0, -0.07, 0.07, 0.3, 0.32, '#ffffff');                        // racing stripe
        B(l1, h, -0.07, 0.07, 0.3, 0.32, '#ffffff');
        B(l0, l1, -0.06, 0.06, 0.55, 0.57, '#ffffff');
        B(-h, -h + 0.18, -0.32, 0.32, 0.42, 0.47, '#23242e');                // spoiler
        B(-h + 0.04, -h + 0.1, -0.2, -0.14, 0.3, 0.42, '#23242e');
        B(-h + 0.04, -h + 0.1, 0.14, 0.2, 0.3, 0.42, '#23242e');
        break;
      }
      case 'van':
        B(-h, h, -0.35, 0.35, 0.14, 0.5, c);
        B(-h, h * 0.1, -0.34, 0.34, 0.5, 0.86, c);
        B(-h, h * 0.1, -0.355, 0.355, 0.6, 0.68, '#ffffff');
        B(h * 0.1, h - 0.05, -0.3, 0.3, 0.5, 0.8, glass(cf.top));
        B(h * 0.1 - 0.02, h - 0.03, -0.31, 0.31, 0.8, 0.86, c);
        break;
      case 'icecream':
        B(-h, h, -0.35, 0.35, 0.14, 0.55, c);
        B(-h, h * 0.2, -0.34, 0.34, 0.55, 0.95, '#fff3d6');
        B(-h, h * 0.2, -0.355, 0.355, 0.85, 0.95, '#ff6fa8');                // striped awning
        B(h * 0.2, h - 0.05, -0.3, 0.3, 0.55, 0.82, glass('#ffffff'));
        B(-0.42, -0.12, -0.1, 0.1, 0.95, 1.05, '#e8c27a');                   // giant ice cream on the roof
        B(-0.36, -0.18, -0.07, 0.07, 1.05, 1.12, '#d9a95a');
        B(-0.44, -0.1, -0.12, 0.12, 1.12, 1.3, '#ffffff');
        B(-0.3, -0.24, -0.03, 0.03, 1.3, 1.36, '#ff3b30');
        break;
      case 'bus': {
        B(-h, h, -0.38, 0.38, 0.14, 0.6, c);
        B(-h + 0.05, h - 0.05, -0.36, 0.36, 0.6, 0.92, glass(cf.top));
        for (let i = 1; i <= 4; i++) {                                       // window pillars
          const l = -h + 0.05 + (i * (car.len - 0.1)) / 5;
          B(l - 0.03, l + 0.03, -0.37, 0.37, 0.6, 0.92, c);
        }
        B(-h, h, -0.38, 0.38, 0.92, 0.98, '#f2f4f8');
        B(-h, h, -0.385, 0.385, 0.28, 0.36, '#f2f4f8');
        break;
      }
      case 'truck':
        B(h - 0.85, h, -0.36, 0.36, 0.14, 0.5, c);
        B(h - 0.75, h - 0.05, -0.32, 0.32, 0.5, 0.8, glass(cf.top));
        B(h - 0.77, h - 0.03, -0.33, 0.33, 0.8, 0.86, c);
        B(-h, h - 0.9, -0.38, 0.38, 0.14, 1.0, car.cargo);
        B(-h, h - 0.9, -0.385, 0.385, 0.5, 0.62, c);
        B(h - 0.92, h - 0.84, -0.36, -0.3, 0.3, 1.15, '#9aa0ab');            // exhaust pipe
        B(h - 0.92, h - 0.84, -0.36, -0.3, 1.15, 1.2, '#5a606b');
        break;
      default: sedanLike(c, c, -h * 0.62, h * 0.3, 0.4);
    }
    // lights on the +x end: headlights if we drive that way, tail lights otherwise
    const lc = dir > 0 ? '#fff6b0' : '#ff3b30';
    for (const lz of [-0.22, 0.22]) addBox(x + h - 0.02, x + h + 0.04, z + lz - 0.07, z + lz + 0.07, by + 0.2, by + 0.3, lc);
  }

  function addLog(log, z, B) {
    const x = log.x, h = log.len / 2;
    G.row = Math.round(z); G.layer = 0; G.gk = x; G.yw = 3;
    const bob = Math.sin(time * 2.2 + log.phase) * 0.025;
    addBox(x - h, x + h, z - 0.36, z + 0.36, -0.16 + bob, LOG_TOP + bob, B.plat.top);
    addBox(x + h - 0.03, x + h + 0.01, z - 0.3, z + 0.3, -0.12 + bob, LOG_TOP - 0.04 + bob, B.plat.end);   // cut end
    if (log.coin && !log.coin.got) addCoin(x + log.coin.off, LOG_TOP + 0.42 + bob, z, LOG_TOP + bob, 1);   // rides on top of the log
  }

  /* ---- the parrot ---- */
  // Local coordinates: x = sideways, z = forward (beak side), y = up.
  const PARROT_PARTS = [
    { x: [-0.14, -0.04], z: [0.0, 0.12], y: [0, 0.14], r: 'feet' },           // feet
    { x: [0.04, 0.14], z: [0.0, 0.12], y: [0, 0.14], r: 'feet' },
    { x: [-0.07, 0.07], z: [-0.54, -0.18], y: [0.14, 0.26], r: 'tail1' },     // tail feathers
    { x: [-0.05, 0.05], z: [-0.7, -0.52], y: [0.1, 0.2], r: 'tail2' },
    { x: [-0.22, 0.22], z: [-0.22, 0.22], y: [0.12, 0.54], r: 'body' },       // body
    { x: [-0.15, 0.15], z: [0.21, 0.25], y: [0.16, 0.42], r: 'chest' },       // chest patch
    { x: [-0.19, 0.19], z: [-0.02, 0.34], y: [0.5, 0.82], r: 'head' },        // head
    { x: [-0.05, 0.05], z: [0.0, 0.22], y: [0.82, 0.97], r: 'crest' },        // crest
    { x: [-0.07, 0.07], z: [0.34, 0.5], y: [0.6, 0.75], r: 'beak' },          // beak
    { x: [-0.05, 0.05], z: [0.44, 0.5], y: [0.51, 0.6], r: 'hook' },          // beak hook
    { x: [0.19, 0.23], z: [0.19, 0.3], y: [0.63, 0.76], r: 'eye' },           // eyes
    { x: [-0.23, -0.19], z: [0.19, 0.3], y: [0.63, 0.76], r: 'eye' },
    { x: [0.22, 0.245], z: [0.24, 0.3], y: [0.65, 0.72], r: 'pupil' },        // pupils
    { x: [-0.245, -0.22], z: [0.24, 0.3], y: [0.65, 0.72], r: 'pupil' },
  ];
  const skinById = (id) => SKINS.find((k) => k.id === id) || SKINS[0];
  const hatById = (id) => HATS.find((h) => h.id === id) || HATS[0];

  /** Rotate local (lx, lz) so the parrot's beak points the way it is facing. */
  function rot(face, lx, lz) {
    switch (face) {
      case 'b': return [-lx, -lz];
      case 'r': return [lz, -lx];
      case 'l': return [-lz, lx];
      default: return [lx, lz];
    }
  }

  function parrotPose() {
    const p = parrot;
    let base, lift = 0, sy = 1, sw = 1, alpha;
    const row = world.rows.get(p.tz) || world.rows.get(Math.round(p.z));
    if (p.hop >= 0) {
      const u = Math.min(1, p.hop / hopTime());
      base = lerp(p.baseFrom, p.baseTo, u) + Math.sin(Math.PI * u) * HOP_HEIGHT;
      sy = 1 + 0.14 * Math.sin(Math.PI * u);              // stretch while airborne
      sw = 1 - 0.06 * Math.sin(Math.PI * u);
      lift = Math.sin(Math.PI * u);                       // wings flap out
    } else {
      base = row ? restHeight(row, p.log, time) : GRASS_H;
      if (state === 'menu' || state === 'playing') base += Math.sin(time * 4) * 0.012;   // idle breathing
      sy = 1 - 0.22 * p.squash;                           // landing squash
      sw = 1 + 0.12 * p.squash;
      lift = p.squash * 0.5;
    }
    let ox = 0, oz = 0;
    if (p.bump > 0) ox = Math.sin(p.bump * 18) * 0.05 * p.bump;     // blocked-move wobble

    if (state === 'dying' || (state === 'over' && p.deadType)) {
      const t = p.deadT;
      if (p.deadType === 'cat') {                         // swatted into the sky, spinning
        const u = Math.min(1, t / 0.1);
        const f = Math.max(0, t - 0.1);
        sy = lerp(1, 0.55, u) + Math.min(1, f * 6) * 0.5; sw = lerp(1, 1.4, u) - Math.min(1, f * 6) * 0.4;
        base = p.baseTo + 0.3 + 7 * f - 5 * f * f;
        ox = f * 2.4; oz = f * 1.4;
        lift = 1;
        if (t > 1.05) alpha = Math.max(0, 1 - (t - 1.05) / 0.3);
      } else if (p.deadType === 'car') {
        const u = Math.min(1, t / 0.12);
        sy = lerp(1, 0.1, u); sw = lerp(1, 1.7, u);
        base = p.baseTo;
        lift = 0;
        if (t > 0.6) alpha = Math.max(0, 1 - (t - 0.6) / 0.3);
      } else if (isTrap(p.deadType)) {
        ({ base, lift, sy, sw, alpha, ox, oz } = trapPose(p.deadType, t, p.baseTo));
      } else {
        const u = Math.min(1, t / 0.5);
        base = WATER_H - 0.1 - u * 0.85;
        sy = lerp(1, 0.7, u);
        lift = 1 - u;
        alpha = Math.max(0, 1 - u * 1.1);
      }
    }
    if (p.inv > 0 && alpha === undefined) alpha = Math.floor(time * 14) % 2 ? 0.35 : 1;
    return { base, lift, sy, sw, alpha, ox, oz };
  }

  /** Returns a function that queues a local-space box (rotated to `face`) at world (x, z). */
  function mkPush(x, z, face, pose) {
    return (lx0, lx1, lz0, lz1, y0, y1, color) => {
      const [ax, az] = rot(face, lx0 * pose.sw, lz0 * pose.sw);
      const [bx, bz] = rot(face, lx1 * pose.sw, lz1 * pose.sw);
      const px = x + (pose.ox || 0), pz = z + (pose.oz || 0);
      addBox(px + Math.min(ax, bx), px + Math.max(ax, bx), pz + Math.min(az, bz), pz + Math.max(az, bz),
        pose.base + y0 * pose.sy, pose.base + y1 * pose.sy, color, pose.alpha);
    };
  }

  /** Queue every box of a parrot standing at (x, z) with the given pose, skin and hat. */
  function buildParrot(x, z, face, pose, skin, hat, boots) {
    const bt = boots || BOOTS[0];
    const pal = skin.pal;
    const push = mkPush(x, z, face, pose);
    for (const part of PARROT_PARTS) {
      if (part.r === 'crest' && hat.hideCrest) continue;
      if (part.r === 'feet' && bt.parts.length) continue;           // boots replace the bare feet
      const color = part.r === 'eye' ? '#ffffff' : part.r === 'pupil' ? '#1b1b2f' : pal[part.r];
      push(part.x[0], part.x[1], part.z[0], part.z[1], part.y[0], part.y[1], color);
    }
    // wings flap outward and up while hopping
    const l = pose.lift;
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -0.32 - l * 0.12 : 0.22;
      const x1 = side < 0 ? -0.22 : 0.32 + l * 0.12;
      const dy = l * 0.12;
      push(x0, x1, -0.14, 0.14, 0.22 + dy, 0.42 + dy, pal.wing);
      push(x0, x1, -0.14, 0.14, 0.42 + dy, 0.5 + dy, pal.edge);
      push(x0, x1, -0.26, -0.14, 0.24 + dy, 0.38 + dy, pal.tip);
    }
    for (const h of hat.parts) push(h[0], h[1], h[2], h[3], h[4], h[5], h[6]);
    for (const b of bt.parts) push(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
  }

  function addParrot() {
    const p = parrot;
    const pose = parrotPose();
    if (pose.alpha !== undefined && pose.alpha <= 0) return;
    const prow = world.rows.get(Math.round(p.z));
    G.row = Math.round(p.z); G.layer = prow && prow.type === 'river' ? 1 : 0; G.gk = p.x; G.yw = 0.4;    // riders draw after the log under them
    const dead = p.deadType === 'cat' && (state === 'dying' || state === 'over');
    const dying = state === 'dying' || state === 'over';
    const spin = dying ? deathSpin(p.deadType, p.deadT) : 0;
    const face = dead ? 'frbl'[Math.floor(p.deadT * 14) % 4] : spin ? 'frbl'[Math.floor(p.deadT * spin) % 4] : p.face;
    buildParrot(p.x, p.z, face, pose, skinById(save.skin), hatById(save.hat), bootById(save.boot));
  }

  /** Draw a standalone parrot into a small canvas (used by the shop cards). */
  function previewParrot(cv, skin, hat, boots) {
    const d = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 88, h = cv.clientHeight || 88;
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    const c = cv.getContext('2d');
    const keepCtx = ctx, keepV = Object.assign({}, V), keepItems = items.splice(0);
    ctx = c;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.lineWidth = 1; c.lineJoin = 'round';
    V.w = w; V.h = h; G.row = 0; G.layer = 0; G.gk = 0; G.yw = 0.4;
    const S = w * 0.52;
    V.S = S; V.hw = S; V.hh = S * 0.5; V.hv = S * 0.95; V.ox = w / 2; V.oy = h * 0.8; V.cx = 0; V.cz = 0;
    buildParrot(0, 0, 'b', { base: 0, lift: 0.1, sy: 1, sw: 1, alpha: undefined, ox: 0 }, skin, hat, boots);
    items.sort(byDepth);
    for (const b of items) drawBox(b);
    ctx = keepCtx;
    Object.assign(V, keepV);
    items.length = 0;
    for (const it of keepItems) items.push(it);
  }

  /* ===================================================================
   * The cat: shows up when you dawdle, stalks, pounces, and sometimes regrets it
   * =================================================================== */
  const cat = { state: 'away', x: 0, z: 0, y: 0, t: 0, face: 'f', fx: 0, fz: 0, tx: 0, tz: 0, vx: 0, vy: 0, vz: 0, spin: 0, starT: 0, alpha: 1 };
  // The cat grows up as you go further: faster, bigger, quicker to pounce and harder to shake off.
  const CAT_TIERS = [
    { name: 'Kitten', icon: '🐱', minZ: 0, scale: 1.0, speed: 1.5, idle: 4.0, windup: 0.5, hit: 0.85, reach: 1.7, dizzy: 1.6, push: 0.5, giveup: 11, shout: 'MEOW!', double: false, fur: '#ffc27a', stripe: '#e0903a', light: '#fff0d6' },
    { name: 'Tabby', icon: '🐱', minZ: 40, scale: 1.12, speed: 1.9, idle: 3.6, windup: 0.42, hit: 0.95, reach: 1.9, dizzy: 1.3, push: 0.4, giveup: 12, shout: 'MEOW!', double: false, fur: '#ff9f43', stripe: '#d9741a', light: '#ffd9a8' },
    { name: 'Tiger', icon: '🐯', minZ: 100, scale: 1.3, speed: 2.4, idle: 3.2, windup: 0.36, hit: 1.05, reach: 2.1, dizzy: 1.0, push: 0.3, giveup: 13, shout: 'GRRR!', double: true, fur: '#f0841c', stripe: '#2a2018', light: '#ffe3b8' },
    { name: 'Lion', icon: '🦁', minZ: 180, scale: 1.5, speed: 2.9, idle: 2.8, windup: 0.3, hit: 1.2, reach: 2.4, dizzy: 0.8, push: 0.2, giveup: 14, shout: 'ROAR!', double: true, fur: '#e0a040', stripe: '#b8742a', light: '#fff0c8', mane: true },
  ];
  const CAT_TAUNTS = [['mrrp?', 'snack time!', 'here birdie...'], ['mrrp?', 'nom nom?', '*wiggle*'], ['GRRR...', 'dinner!', 'get over here'], ['ROAR!', 'RUN!', 'MINE!']];
  const catTier = () => { let t = CAT_TIERS[0]; for (const c of CAT_TIERS) if (maxZ >= c.minZ) t = c; return t; };
  cat.tier = CAT_TIERS[0];
  const catIdleLimit = () => catTier().idle;
  const catSpeed = () => cat.tier.speed;
  const catGround = () => { const r = world.rows.get(Math.round(cat.z)); return r ? r.h : 0; };

  function catSay(text) {
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i].bubble) popups.splice(i, 1);   // one bubble at a time
    addPopup(cat.x, cat.y + 1.5, cat.z, text, { bubble: true, follow: true, max: 0.95, size: 20 });
  }

  function spawnCat() {
    const p = parrot;
    cat.tier = catTier();
    cat.doubled = false; cat.taunt = 2;
    ui.catIcon.textContent = cat.tier.icon;
    cat.state = 'stalk'; cat.t = 0; cat.alpha = 1; cat.face = 'f';
    cat.z = p.z - CAT_SPAWN_DIST; cat.x = clamp(p.x, 0, COLS - 1); cat.y = catGround();
    showToast(`A ${cat.tier.name} is coming! Keep hopping!`);
    catSay(cat.tier.shout);
    shakeScreen(2 + cat.tier.scale * 2);
    Sfx.catAppear(cat.tier.scale);
  }

  /** A car clobbers the cat: it spins away and you get a small coin reward. */
  function flingCat(dir) {
    cat.state = 'flung'; cat.t = 0; cat.spin = 0;
    cat.vx = dir * 7; cat.vy = 8; cat.vz = rand(-1, 2);
    catSay('YEOWCH!');
    Sfx.catFling();
    shakeScreen(7);
    burst(cat.x, cat.y + 0.5, cat.z, ['#ff9f43', '#ffd9a8', '#ffffff', '#d9741a'], 18, 2.4, 3.6, 0.09);
    save.coins += 2; runCoins += 2; persist(); updateHud();
    addPopup(cat.x, 2.2, cat.z, 'Cat bonked! +2', { color: '#ffd23f', size: 22, max: 1.2 });
  }

  function updateCat(dt) {
    const p = parrot, c = cat;
    if (c.state === 'away') {
      idleT += dt;
      if (idleT >= catIdleLimit()) spawnCat();
      return;
    }
    c.t += dt;
    const gy = catGround();
    switch (c.state) {
      case 'stalk': {
        const dz = p.z - c.z;
        c.z += Math.sign(dz) * catSpeed() * dt;
        c.x += (p.x - c.x) * Math.min(1, dt * 2.2);
        c.face = dz >= 0 ? 'f' : 'b';
        c.y = gy + Math.abs(Math.sin(c.t * 9)) * 0.06;
        c.taunt -= dt;
        if (c.taunt <= 0 && dz > 2.6) { c.taunt = rand(2.2, 3.6); catSay(pick(CAT_TAUNTS[CAT_TIERS.indexOf(c.tier)])); }
        if (dz > c.tier.giveup) { c.state = 'giveup'; c.t = 0; dodges++; catSay('Hmph...'); Sfx.catGiveup(); idleT = -3; }
        else if (Math.abs(dz) <= c.tier.reach && Math.abs(p.x - c.x) < 1.6) { c.state = 'windup'; c.t = 0; c.tx = p.tx; c.tz = p.tz; catSay('!!'); Sfx.catWindup(); shakeScreen(2); }   // marks the tile it will land on
        break;
      }
      case 'windup':                                       // butt wiggle: this is your cue to move!
        c.x += (p.x - c.x) * Math.min(1, dt * 1.5);
        c.y = gy;
        if (c.t >= (c.windupOverride || c.tier.windup)) { c.state = 'leap'; c.t = 0; c.windupOverride = 0; c.fx = c.x; c.fz = c.z; catSay('NYA!'); Sfx.catPounce(); }
        break;
      case 'leap': {
        const u = Math.min(1, c.t / CAT_LEAP);
        c.x = lerp(c.fx, c.tx, u); c.z = lerp(c.fz, c.tz, u);
        c.y = gy + Math.sin(Math.PI * u) * 1.1;
        c.face = c.tz >= c.fz ? 'f' : 'b';
        if (u >= 1) {
          const hit = Math.hypot(p.x - c.tx, p.z - c.tz) < c.tier.hit && p.inv <= 0;
          burst(c.x, gy, c.z, ['#e8e4d8', '#ffffff', '#cfcfc4'], 10, 1.6, 2.2, 0.08);
          shakeScreen(hit ? 12 : 6);
          if (hit) {
            die('cat');
            if (state === 'playing') { c.state = 'giveup'; c.t = 0; idleT = -3; }   // a Second Chance saved us
          } else { c.state = 'slide'; c.t = 0; dodges++; catSay('OOPS!'); }
        }
        break;
      }
      case 'slide':                                        // missed: skids past
        c.z += Math.sign((c.tz - c.fz) || 1) * 3.2 * (1 - Math.min(1, c.t / 0.5)) * dt;
        c.y = gy;
        if (c.t > 0.5) {
          if (c.tier.double && !c.doubled && Math.hypot(p.x - c.x, p.z - c.z) < 3.2) {      // tigers and lions go again!
            c.doubled = true; c.state = 'windup'; c.t = 0; c.tx = p.tx; c.tz = p.tz; c.windupOverride = 0.24; catSay('AGAIN!');
          } else { c.state = 'dizzy'; c.t = 0; catSay('@_@'); }
        }
        break;
      case 'dizzy':
        c.y = gy;
        c.starT -= dt;
        if (c.starT <= 0) { c.starT = 0.12; burst(c.x, gy + 1.0, c.z, ['#ffe066', '#ffffff'], 1, 0.9, 1.2, 0.08); }
        if (c.t > c.tier.dizzy) { c.state = 'stalk'; c.t = 0; c.doubled = false; }
        break;
      case 'giveup':
        c.z -= 2.2 * dt; c.alpha = Math.max(0, 1 - c.t); c.y = gy;
        if (c.t >= 1) { c.state = 'away'; idleT = -3; }
        break;
      case 'flung':
        c.x += c.vx * dt; c.z += c.vz * dt; c.vy -= 14 * dt; c.y += c.vy * dt; c.spin += dt * 14;
        if (c.t > 1.1) { c.state = 'away'; idleT = -4; }
        break;
      default: break;
    }
    // Traffic is not kind to cats.
    if (c.state === 'stalk' || c.state === 'windup' || c.state === 'slide' || c.state === 'dizzy' || c.state === 'giveup') {
      const row = world.rows.get(Math.round(c.z));
      if (row && row.type === 'road') {
        for (const car of row.lane.items) if (Math.abs(car.x - c.x) < car.len / 2 + 0.35) { flingCat(row.lane.dir); break; }
      }
    }
  }

  // Cat model (local space: z = the way it faces, y = up)
  const CAT_PARTS = [
    [-0.17, -0.07, 0.2, 0.32, 0, 0.2, '#ffd9a8'], [0.07, 0.17, 0.2, 0.32, 0, 0.2, '#ffd9a8'],       // front paws
    [-0.17, -0.07, -0.34, -0.2, 0, 0.2, '#ffd9a8'], [0.07, 0.17, -0.34, -0.2, 0, 0.2, '#ffd9a8'],   // back paws
    [-0.21, 0.21, -0.36, 0.32, 0.18, 0.56, '#ff9f43'],                                              // body
    [-0.215, 0.215, -0.24, -0.15, 0.2, 0.57, '#d9741a'], [-0.215, 0.215, 0.0, 0.09, 0.2, 0.57, '#d9741a'],   // stripes
    [-0.19, 0.19, 0.26, 0.64, 0.4, 0.78, '#ff9f43'],                                                // head
    [-0.17, -0.06, 0.3, 0.42, 0.78, 0.96, '#ff9f43'], [0.06, 0.17, 0.3, 0.42, 0.78, 0.96, '#ff9f43'],       // ears
    [-0.1, 0.1, 0.6, 0.645, 0.42, 0.54, '#ffd9a8'], [-0.04, 0.04, 0.64, 0.67, 0.5, 0.56, '#ff8fa3'],        // muzzle, nose
    [0.19, 0.22, 0.5, 0.6, 0.54, 0.66, '#ffffff'], [-0.22, -0.19, 0.5, 0.6, 0.54, 0.66, '#ffffff'],         // eyes
    [0.215, 0.235, 0.54, 0.58, 0.55, 0.65, '#1b1b2f'], [-0.235, -0.215, 0.54, 0.58, 0.55, 0.65, '#1b1b2f'],
    [0.19, 0.225, 0.5, 0.62, 0.67, 0.71, '#a8530f'], [-0.225, -0.19, 0.5, 0.62, 0.67, 0.71, '#a8530f'],     // grumpy brows
    [0.19, 0.3, 0.56, 0.58, 0.49, 0.51, '#ffffff'], [-0.3, -0.19, 0.56, 0.58, 0.49, 0.51, '#ffffff'],       // whiskers
  ];

  function addCat() {
    const c = cat;
    if (c.state === 'away') return;
    const T = c.tier;
    const crow = world.rows.get(Math.round(c.z));
    G.row = Math.round(c.z); G.layer = crow && crow.type === 'river' ? 1 : 0; G.gk = c.x; G.yw = 0.4;
    let sy = T.scale, sw = T.scale, ox = 0, alpha = c.alpha < 1 ? c.alpha : undefined, face = c.face, sway = 0.07;
    if (c.state === 'windup') { sy = T.scale * 0.65; ox = Math.sin(time * 50) * 0.035; sway = 0.18; }
    else if (c.state === 'slide') sy = T.scale * 0.76;
    else if (c.state === 'leap') { sy = T.scale * 1.1; sw = T.scale * 0.9; }
    else if (c.state === 'dizzy') { face = 'frbl'[Math.floor(time * 3) % 4]; sy = T.scale * 0.85; }
    else if (c.state === 'flung') { face = 'frbl'[Math.floor(c.spin) % 4]; alpha = Math.max(0, 1 - (c.t - 0.6) / 0.5); }
    if (alpha !== undefined && alpha <= 0) return;
    const angry = c.state === 'windup' || c.state === 'leap';
    const tc = (hex) => (hex === '#ff9f43' ? T.fur : hex === '#d9741a' ? T.stripe : hex === '#ffd9a8' ? T.light : hex === '#1b1b2f' && angry ? '#ff3b30' : hex);
    const push = mkPush(c.x, c.z, face, { base: c.y, sy, sw, ox, alpha });
    for (const q of CAT_PARTS) push(q[0], q[1], q[2], q[3], q[4], q[5], tc(q[6]));
    if (T.mane) {                                          // lions get a big mane
      push(-0.28, 0.28, 0.16, 0.34, 0.32, 0.88, '#8a4b14');
      push(-0.22, 0.22, 0.18, 0.36, 0.86, 0.96, '#8a4b14');
    }
    const w = Math.sin(time * 5) * sway;                   // wagging tail
    push(-0.05, 0.05, -0.52, -0.36, 0.3, 0.42, T.fur);
    push(-0.05 + w * 0.5, 0.05 + w * 0.5, -0.52, -0.44, 0.42, 0.68, T.fur);
    push(-0.05 + w, 0.05 + w, -0.52, -0.44, 0.68, 0.84, T.mane ? '#8a4b14' : '#ffffff');
  }

  /* ===================================================================
   * Effects: floating text, screen shake/flash, ambient weather, danger UI
   * =================================================================== */
  const popups = [];
  function addPopup(x, y, z, text, o) {
    popups.push(Object.assign({ x, y, z, text, t: 0, max: 1, color: '#ffffff', size: 22, rise: 46, bubble: false, follow: false }, o));
  }
  function shakeScreen(a) { shake = Math.max(shake, a); }
  function flashScreen(color, alpha) {
    ui.flash.style.background = color;
    ui.flash.style.setProperty('--a', alpha);
    ui.flash.classList.remove('go');
    void ui.flash.offsetWidth;                             // restart the CSS animation
    ui.flash.classList.add('go');
  }
  function celebrate() {
    const p = parrot;
    Sfx.celebrate();
    burst(p.x, 1.2, p.z, ['#ff5a5f', '#ffd23f', '#3ea8ff', '#3ddc97', '#ff7eb6', '#a66bff'], 34, 2.8, 5.2, 0.11);
  }

  // Biome atmosphere. Nothing is always on: a light frost creeps over the screen in the snow,
  // and a little fire flickers in the lava lands.
  const env = { frost: 0, fire: 0 };
  const embers = [];
  let frostCv = null, fireCv = null;
  /** Frost and fire overlays are drawn once into small canvases; each frame only blits them with some opacity. */
  function buildFrost() {
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
    frostCv = mk(V.w, V.h);
    let c = frostCv.getContext('2d');
    c.fillStyle = 'rgba(170,215,255,0.08)';                                // faint cold tint
    c.fillRect(0, 0, V.w, V.h);
    const g = c.createRadialGradient(V.w / 2, V.h / 2, Math.min(V.w, V.h) * 0.42, V.w / 2, V.h / 2, Math.max(V.w, V.h) * 0.78);
    g.addColorStop(0, 'rgba(190,230,255,0)');
    g.addColorStop(1, 'rgba(200,236,255,0.32)');
    c.fillStyle = g;
    c.fillRect(0, 0, V.w, V.h);
    c.fillStyle = 'rgba(228,246,255,0.5)';                                 // ice crystals along the border
    c.beginPath();
    const unit = Math.max(16, Math.min(V.w, V.h) * 0.04), maxD = Math.min(V.w, V.h) * 0.07;
    const tri = (a, b, cx, cy, dx, dy) => { c.moveTo(a, b); c.lineTo(cx, cy); c.lineTo(dx, dy); c.closePath(); };
    for (let p = 0; p < V.w; p += unit) {
      tri(p, 0, p + unit, 0, p + unit / 2, maxD * rand(0.25, 1));
      tri(p, V.h, p + unit, V.h, p + unit / 2, V.h - maxD * rand(0.25, 1));
    }
    for (let p = 0; p < V.h; p += unit) {
      tri(0, p, 0, p + unit, maxD * rand(0.25, 1), p + unit / 2);
      tri(V.w, p, V.w, p + unit, V.w - maxD * rand(0.25, 1), p + unit / 2);
    }
    c.fill();

    fireCv = mk(V.w, V.h * 0.38);                                          // warm glow along the bottom edge
    c = fireCv.getContext('2d');
    const fg = c.createLinearGradient(0, fireCv.height, 0, 0);
    fg.addColorStop(0, 'rgba(255,110,20,0.32)');
    fg.addColorStop(1, 'rgba(255,110,20,0)');
    c.fillStyle = fg;
    c.fillRect(0, 0, fireCv.width, fireCv.height);
  }
  function newEmber(anywhere) {
    return { x: rand(0, V.w), y: anywhere ? rand(0, V.h) : V.h + 10, sz: rand(0.7, 1.4), ph: rand(0, 6.28) };
  }
  function updateEnv(dt) {
    if (!V.w) return;
    const id = biomeAt(Math.round(cam.z + 4)).id;
    const k = 1 - Math.exp(-1.6 * dt);
    env.frost += ((id === 'snow' ? 1 : 0) - env.frost) * k;
    env.fire += ((id === 'volcano' ? 1 : 0) - env.fire) * k;
    const want = env.fire > 0.15 ? Math.round(12 * env.fire) : 0;
    while (embers.length < want) embers.push(newEmber(true));
    if (embers.length > want) embers.pop();
    const u = V.S / 55;
    for (const e of embers) {
      e.ph += dt * 2.4;
      e.y -= (40 + e.sz * 40) * dt * u;
      e.x += Math.sin(e.ph) * 16 * dt * u;
      if (e.y < -12) Object.assign(e, newEmber(false));
    }
    if (env.fire > 0.3 && Math.random() < dt * 4) {              // little flames licking up from the lava
      const z = Math.round(cam.z) + randInt(-6, 12);
      const row = world.rows.get(z);
      if (row && row.type === 'river' && row.biome.id === 'volcano') {
        const [vx0, vx1] = visibleX(z);
        burst(rand(vx0 + 1, vx1 - 1), WATER_H + 0.05, z, ['#ff7a1a', '#ffd23f', '#ff4d4d'], 1, 0.25, 2.2, 0.09);
      }
    }
  }
  function drawEnv() {
    if (env.frost > 0.02 && frostCv) {
      ctx.globalAlpha = env.frost * (0.92 + 0.08 * Math.sin(time * 1.3));
      ctx.drawImage(frostCv, 0, 0, V.w, V.h);
      ctx.globalAlpha = 1;
    }
    if (env.fire > 0.02 && fireCv) {
      ctx.globalAlpha = env.fire * (0.8 + 0.2 * Math.sin(time * 9 + Math.sin(time * 3) * 2));
      ctx.drawImage(fireCv, 0, V.h - fireCv.height, V.w, fireCv.height);
      ctx.globalAlpha = 1;
      const u = V.S / 55;
      for (const e of embers) {
        ctx.fillStyle = e.sz > 1.1 ? 'rgba(255,210,63,0.9)' : 'rgba(255,122,26,0.9)';
        ctx.fillRect(e.x, e.y, 2.5 * e.sz * u, 2.5 * e.sz * u);
      }
    }
  }

  function updateEffects(dt) {
    shake *= Math.exp(-9 * dt);
    if (shake < 0.2) shake = 0;
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].t += dt;
      if (popups[i].t > popups[i].max) popups.splice(i, 1);
    }
    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) { comboCount = 0; ui.comboChip.hidden = true; }
    }
    updateEnv(dt);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPopups() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of popups) {
      let x = p.x, y = p.y, z = p.z;
      if (p.follow && cat.state !== 'away') { x = cat.x; z = cat.z; y = cat.y + 1.5; }
      const age = p.t / p.max;
      const sx = sxOf(x, z), sy = syOf(x, y, z) - age * p.rise * (V.S / 60);
      const pop = Math.min(1, p.t / 0.18);
      const sc = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + 0.14 * Math.sin(pop * Math.PI);
      ctx.save();
      ctx.globalAlpha = age > 0.75 ? (1 - age) / 0.25 : 1;
      ctx.translate(sx, sy);
      ctx.scale(sc, sc);
      ctx.font = `900 ${p.size}px ${FONT}`;
      if (p.bubble) {
        const w = ctx.measureText(p.text).width + 24, h = p.size + 16;
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0f3d3e'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        roundRect(-w / 2, -h / 2, w, h, 12); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-6, h / 2 - 1); ctx.lineTo(0, h / 2 + 9); ctx.lineTo(6, h / 2 - 1); ctx.closePath();
        ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0f3d3e';
        ctx.fillText(p.text, 0, 1);
      } else {
        ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f3d3e';
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
      }
      ctx.restore();
    }
  }

  /** Cat meter + red vignette: the more trouble you're in, the louder the UI gets. */
  let lastMeter = '';
  function updateDanger(dt) {
    let target = 0, pct = 0, mode = '';
    if (state === 'playing') {
      const cs = cat.state;
      if (cs === 'away') {
        pct = clamp(idleT / catIdleLimit(), 0, 1);
        target = pct > 0.6 ? ((pct - 0.6) / 0.4) * 0.3 : 0;
        mode = pct > 0.25 ? 'warn' : '';
      } else if (cs === 'stalk') {
        const dz = Math.abs(parrot.z - cat.z);
        pct = clamp(1 - dz / cat.tier.giveup, 0, 1);
        target = clamp(1 - dz / 6, 0, 1) * 0.8;
        mode = 'chase';
      } else if (cs === 'windup' || cs === 'leap') { pct = 1; target = 1; mode = 'chase'; }
    }
    dangerCur += (target - dangerCur) * Math.min(1, dt * 6);
    const key = mode + Math.round(pct * 50) + Math.round(dangerCur * 30);
    if (key === lastMeter) return;
    lastMeter = key;
    ui.vignette.style.opacity = dangerCur.toFixed(2);
    ui.catMeter.classList.toggle('show', mode !== '');
    ui.catMeter.classList.toggle('chase', mode === 'chase');
    ui.catBar.style.width = Math.round(pct * 100) + '%';
  }

  function drawShadows(rowsInView) {
    ctx.fillStyle = 'rgba(20, 50, 30, 0.2)';
    ctx.beginPath();
    for (const row of rowsInView) {
      const z = row.z;
      if (row.type === 'grass') {
        const add = (x, s) => {
          if (!onScreen(x, z, 120, 160)) return;
          pathXZ(x - 0.36 * s + 0.12, x + 0.36 * s + 0.22, z - 0.34 * s, z + 0.34 * s, row.h + 0.002);
        };
        row.trees.forEach((t, c) => add(c, t.s));
        for (const d of row.decor) add(d.x, d.s);
      } else if (row.type === 'road') {
        for (const car of row.lane.items) {
          if (!onScreen(car.x, z, 200, 160)) continue;
          pathXZ(car.x - car.len / 2 + 0.05, car.x + car.len / 2 + 0.2, z - 0.36, z + 0.34, ROAD_H + 0.002);
        }
      }
    }
    ctx.fill();

    // foam under floating platforms
    for (const row of rowsInView) {
      if (row.type !== 'river') continue;
      ctx.fillStyle = row.biome.foam;
      ctx.beginPath();
      for (const log of row.lane.items) {
        if (!onScreen(log.x, row.z, 220, 160)) continue;
        pathXZ(log.x - log.len / 2 - 0.15, log.x + log.len / 2 + 0.15, row.z - 0.46, row.z + 0.46, WATER_H + 0.003);
      }
      ctx.fill();
    }

    // pounce target: a pulsing red mark on the tile the cat will land on. Step off it!
    if (cat.state === 'windup' || cat.state === 'leap') {
      const row = world.rows.get(Math.round(cat.tz));
      const gy = row ? row.h : 0;
      const pulse = 0.5 + 0.5 * Math.sin(time * 22);
      const rad = cat.tier.hit * 0.76 + pulse * 0.08;
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * 6.283;
        const x = cat.tx + Math.cos(a) * rad, z = cat.tz + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(sxOf(x, z), syOf(x, gy + 0.006, z)); else ctx.lineTo(sxOf(x, z), syOf(x, gy + 0.006, z));
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 59, 48, ${0.22 + pulse * 0.15})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 59, 48, 0.9)';
      ctx.lineWidth = Math.max(2, V.S * 0.05);
      ctx.stroke();
    }

    // cat shadow
    if (cat.state !== 'away' && cat.state !== 'flung') {
      const gy = catGround();
      ctx.fillStyle = 'rgba(15, 40, 30, 0.24)';
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * 6.283;
        const x = cat.x + Math.cos(a) * 0.45, z = cat.z + Math.sin(a) * 0.45;
        if (i === 0) ctx.moveTo(sxOf(x, z), syOf(x, gy + 0.004, z)); else ctx.lineTo(sxOf(x, z), syOf(x, gy + 0.004, z));
      }
      ctx.closePath();
      ctx.fill();
    }

    // parrot shadow
    const p = parrot;
    if (!(state === 'dying' && p.deadType !== 'car') && !(p.deadType === 'car' && p.deadT > 0.6)) {
      const pose = parrotPose();
      const row = world.rows.get(p.hop >= 0 ? (p.hop / hopTime() < 0.5 ? p.fromZ : p.toZ) : p.tz);
      const gy = row ? (p.log ? LOG_TOP : (row.type === 'river' ? (p.hop >= 0 ? p.baseTo : WATER_H) : row.h)) : GRASS_H;
      const air = Math.max(0, pose.base - gy);
      const r = 0.34 * (1 - Math.min(0.5, air * 0.6)) * (state === 'dying' ? pose.sw : 1);
      ctx.fillStyle = `rgba(15, 40, 30, ${0.26 - Math.min(0.12, air * 0.2)})`;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * 6.283;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(sxOf(x, z), syOf(x, gy + 0.004, z)); else ctx.lineTo(sxOf(x, z), syOf(x, gy + 0.004, z));
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  function render() {
    V.cx = cam.x; V.cz = cam.z;
    const keepOx = V.ox, keepOy = V.oy;
    if (shake > 0) { V.ox += (Math.random() - 0.5) * shake * 2; V.oy += (Math.random() - 0.5) * shake * 2; }
    const sky = ctx.createLinearGradient(0, 0, 0, V.h);
    sky.addColorStop(0, rgbStr(skyCur.top));
    sky.addColorStop(1, rgbStr(skyCur.bot));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, V.w, V.h);

    const rowsInView = [];
    const a0 = (0 - V.ox) / V.hw, a1 = (V.w - V.ox) / V.hw, b0 = (0 - V.oy) / V.hh, b1 = (V.h - V.oy) / V.hh;
    const zMin = Math.floor(V.cz + (a0 - b1) / 2) - 2, zMax = Math.ceil(V.cz + (a1 - b0) / 2) + 3;
    for (let z = zMin; z <= zMax; z++) {
      const row = world.rows.get(z);
      if (row) { rowsInView.push(row); drawRowGround(row); }
    }

    // ripples sit on the water, under everything else
    for (const r of ripples) {
      const k = r.t / 1.1;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
      ctx.lineWidth = Math.max(2, V.S * 0.05);
      ctx.beginPath();
      const rad = 0.2 + k * 1.1;
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * 6.283;
        const x = r.x + Math.cos(a) * rad, z = r.z + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(sxOf(x, z), syOf(x, WATER_H + 0.004, z)); else ctx.lineTo(sxOf(x, z), syOf(x, WATER_H + 0.004, z));
      }
      ctx.stroke();
    }

    drawShadows(rowsInView);

    items.length = 0;
    for (const row of rowsInView) {
      const z = row.z;
      if (row.type === 'grass') {
        row.trees.forEach((t, c) => { if (onScreen(c, z, 140, 260)) addProp(t.kind, c, z, row.h, t.s, row.biome); });
        for (const d of row.decor) if (onScreen(d.x, z, 140, 260)) addProp(d.kind, d.x, z, row.h, d.s, row.biome, true);
        if (row.traps) row.traps.forEach((tr, c) => { if (onScreen(c, z, 160, 420)) addTrap(tr, c, z, row); });
        for (const c of row.coins) if (!c.got && onScreen(c.x, z, 100, 200)) addCoin(c.x, row.h + 0.45 + Math.sin(time * 3 + c.x) * 0.05, z, row.h);
      } else if (row.type === 'road') {
        for (const car of row.lane.items) if (onScreen(car.x, z, 260, 200)) addCar(car, z, row.lane.dir);
        for (const c of row.coins) if (!c.got && onScreen(c.x, z, 100, 200)) addCoin(c.x, ROAD_H + 0.45 + Math.sin(time * 3 + c.x) * 0.05, z, ROAD_H);
      } else {
        for (const log of row.lane.items) if (onScreen(log.x, z, 280, 200)) addLog(log, z, row.biome);
      }
    }
    addParrot();
    addCat();
    items.sort(byDepth);
    ctx.lineWidth = 1; ctx.lineJoin = 'round';
    for (const b of items) drawItem(b);

    // particles on top
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      const s = Math.max(2, p.size * V.S * (0.5 + a * 0.5));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(sxOf(p.x, p.z) - s / 2, syOf(p.x, p.y, p.z) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    drawEnv();
    drawPopups();
    V.ox = keepOx; V.oy = keepOy;
  }

  /* ===================================================================
   * Shop: parrot skins, hats and boosts, paid for with gold coins
   * =================================================================== */
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const ownedList = (kind) => (kind === 'skins' ? save.skins : kind === 'hats' ? save.hats : save.boots);
  function isOwned(tab, it) {
    if (tab === 'boosts') return it.id === 'magnet' && save.magnet;
    return ownedList(tab).includes(it.id);
  }
  function isEquipped(tab, it) {
    return tab === 'skins' ? save.skin === it.id : tab === 'hats' ? save.hat === it.id : tab === 'boots' ? save.boot === it.id : false;
  }
  function equip(kind, id) {
    if (kind === 'skins') save.skin = id; else if (kind === 'hats') save.hat = id; else save.boot = id;
  }
  const effectText = (it) => (it.speed ? `+${Math.round(it.speed * 100)}% hop speed` : 'Cosmetic');

  function shopAction(tab, it) {
    if (isOwned(tab, it)) {
      if (tab !== 'boosts') equip(tab, it.id);
    } else {
      if (tab === 'boots' || save.coins < it.cost) return;                 // boots are case-only
      if (tab === 'boosts' && it.id === 'life' && save.lives >= 9) return;
      save.coins -= it.cost;
      Sfx.buy();
      if (tab === 'skins' || tab === 'hats') { ownedList(tab).push(it.id); equip(tab, it.id); }
      else if (it.id === 'magnet') save.magnet = true;
      else if (it.id === 'life') save.lives++;
    }
    persist();
    updateHud();
    renderShop();
  }

  /* ---- mystery cases ---- */
  function rollCase() {
    let rar = 'common';
    if (save.pity >= PITY_AT - 1) rar = Math.random() < 0.2 ? 'legendary' : 'epic';      // pity: Epic or better
    else {
      let r = Math.random() * 100;
      for (const k of ['common', 'rare', 'epic', 'legendary']) { if (r < RARITY[k].w) { rar = k; break; } r -= RARITY[k].w; }
    }
    const pool = CASE_POOL.filter((e) => e.item.rarity === rar);
    const pickOne = pool[Math.floor(Math.random() * pool.length)];
    save.pity = rar === 'epic' || rar === 'legendary' ? 0 : save.pity + 1;
    return { kind: pickOne.kind, item: pickOne.item, rarity: rar, dup: false, refund: 0 };
  }
  /** New items are equipped straight away; duplicates are refunded in coins. */
  function applyDrop(d) {
    const list = ownedList(d.kind);
    if (list.includes(d.item.id)) { d.dup = true; d.refund = RARITY[d.rarity].refund; save.coins += d.refund; }
    else { list.push(d.item.id); equip(d.kind, d.item.id); }
    return d;
  }

  let caseBusy = false;
  function openCase() {
    if (caseBusy || save.coins < CASE_COST) return;
    save.coins -= CASE_COST;
    save.cases++;
    const drop = applyDrop(rollCase());
    persist(); updateHud();
    ui.shopCoins.textContent = save.coins;
    showCase(drop);
  }
  function showCase(drop) {
    caseBusy = true;
    const box = ui.caseBox;
    box.textContent = '';
    box.className = 'card case-card';
    box.appendChild(el('div', 'crate shaking', '\uD83C\uDF81'));
    box.appendChild(el('div', 'case-hint', 'Opening...'));
    ui.caseScreen.classList.add('visible');
    Sfx.caseShake();
    setTimeout(() => revealCase(drop), 1300);
  }
  function revealCase(drop) {
    const R = RARITY[drop.rarity];
    const box = ui.caseBox;
    box.textContent = '';
    box.classList.add('revealed', 'r-' + drop.rarity);
    flashScreen(R.color, drop.rarity === 'legendary' ? 0.8 : 0.45);
    Sfx.reveal(drop.rarity);
    const tag = el('div', 'case-rarity', R.name);
    tag.style.color = R.color;
    box.appendChild(tag);
    const cv = el('canvas', 'case-preview');
    box.appendChild(cv);
    box.appendChild(el('div', 'case-name', drop.item.name));
    const what = drop.kind === 'boots' ? effectText(drop.item) : drop.kind === 'skins' ? 'New parrot' : 'New hat';
    box.appendChild(el('div', 'case-desc', drop.dup ? `Duplicate! Refunded ${drop.refund} coins.` : `${what} - equipped!`));
    const row = el('div', 'btn-row');
    const again = el('button', 'btn small', `Open another (${CASE_COST})`);
    again.disabled = save.coins < CASE_COST;
    again.addEventListener('click', () => { if (!caseBusy) openCase(); });
    const done = el('button', 'btn small ghost', 'Done');
    done.addEventListener('click', closeCase);
    row.appendChild(again); row.appendChild(done);
    box.appendChild(row);
    const skin = drop.kind === 'skins' ? drop.item : skinById(save.skin);
    const hat = drop.kind === 'hats' ? drop.item : hatById(save.hat);
    const boots = drop.kind === 'boots' ? drop.item : bootById(save.boot);
    previewParrot(cv, skin, hat, boots);
    caseBusy = false;
  }
  function closeCase() {
    if (caseBusy) return;
    ui.caseScreen.classList.remove('visible');
    renderShop();
  }

  function renderCasePanel(grid) {
    grid.classList.add('single');
    const card = el('div', 'shop-card case-panel');
    card.appendChild(el('div', 'crate', '\uD83C\uDF81'));
    card.appendChild(el('div', 'shop-name', 'Mystery Case'));
    card.appendChild(el('div', 'shop-desc', 'Open it for a random parrot, hat or pair of boots.'));
    const odds = el('div', 'odds');
    for (const k of ['common', 'rare', 'epic', 'legendary']) {
      const r = el('div', 'odds-row');
      const dot = el('span', 'odds-dot'); dot.style.background = RARITY[k].color;
      const name = el('span', 'odds-name', RARITY[k].name); name.style.color = RARITY[k].color;
      r.appendChild(dot); r.appendChild(name); r.appendChild(el('span', 'odds-pct', RARITY[k].w + '%'));
      odds.appendChild(r);
    }
    card.appendChild(odds);
    card.appendChild(el('div', 'shop-desc', `Legendary: Golden boots, +${Math.round(bootById('goldboots').speed * 100)}% hop speed!`));
    const have = CASE_POOL.filter((e) => ownedList(e.kind).includes(e.item.id)).length;
    card.appendChild(el('div', 'shop-desc', `Collection ${have}/${CASE_POOL.length}. Epic or better guaranteed in ${Math.max(1, PITY_AT - save.pity)} cases.`));
    const btn = el('button', 'btn');
    btn.appendChild(el('span', 'coin-icon'));
    btn.appendChild(document.createTextNode(` Open case (${CASE_COST})`));
    btn.disabled = save.coins < CASE_COST;
    btn.addEventListener('click', openCase);
    card.appendChild(btn);
    grid.appendChild(card);
  }

  function renderShop() {
    ui.shopCoins.textContent = save.coins;
    ui.shopTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === shopTab));
    const grid = ui.shopGrid;
    grid.textContent = '';
    grid.classList.remove('single');
    if (shopTab === 'cases') { renderCasePanel(grid); return; }
    const list = shopTab === 'skins' ? SKINS : shopTab === 'hats' ? HATS : shopTab === 'boots' ? BOOTS : BOOSTS;
    const draws = [];
    for (const it of list) {
      const card = el('div', 'shop-card');
      const rated = it.rarity && it.id !== 'emerald' && it.id !== 'none';
      if (rated) card.style.borderColor = RARITY[it.rarity].color;
      if (shopTab === 'boosts') {
        card.appendChild(el('div', 'shop-icon', it.icon));
      } else {
        const cv = el('canvas', 'shop-preview');
        card.appendChild(cv);
        const skin = shopTab === 'skins' ? it : skinById(save.skin);
        const hat = shopTab === 'hats' ? it : hatById(save.hat);
        const boots = shopTab === 'boots' ? it : bootById(save.boot);
        draws.push(() => previewParrot(cv, skin, hat, boots));
      }
      card.appendChild(el('div', 'shop-name', it.name));
      if (rated) {
        const tag = el('div', 'shop-rarity', RARITY[it.rarity].name);
        tag.style.color = RARITY[it.rarity].color;
        card.appendChild(tag);
      }
      if (shopTab === 'boots' && it.id !== 'none') card.appendChild(el('div', 'shop-desc', effectText(it)));
      if (it.desc) {
        const extra = it.id === 'life' ? ` You have ${save.lives}.` : '';
        card.appendChild(el('div', 'shop-desc', it.desc + extra));
      }
      const owned = isOwned(shopTab, it);
      const btn = el('button', 'btn small');
      if (isEquipped(shopTab, it)) { btn.textContent = 'Equipped'; btn.disabled = true; btn.classList.add('ghost'); }
      else if (owned) { btn.textContent = shopTab === 'boosts' ? 'Owned' : 'Equip'; btn.disabled = shopTab === 'boosts'; btn.classList.add('ghost'); }
      else if (shopTab === 'boots') { btn.textContent = 'Case only'; btn.disabled = true; btn.classList.add('ghost'); }
      else {
        btn.appendChild(el('span', 'coin-icon'));
        btn.appendChild(document.createTextNode(' ' + it.cost));
        btn.disabled = save.coins < it.cost || (it.id === 'life' && save.lives >= 9);
      }
      btn.addEventListener('click', () => shopAction(shopTab, it));
      card.appendChild(btn);
      grid.appendChild(card);
    }
    draws.forEach((fn) => fn());
  }

  function openShop(from) {
    shopReturn = from;
    shopOpen = true;
    setOverlay('shop');
    renderShop();
  }
  function closeShop() {
    shopOpen = false;
    ui.caseScreen.classList.remove('visible');
    setOverlay(shopReturn);
  }


  /* ===================================================================
   * Input
   * =================================================================== */
  const KEY_DIR = {
    ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b',
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
  };

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (soundOpen) {                                 // the sound menu swallows game keys too
      if (code === 'Escape' || code === 'Enter') { e.preventDefault(); closeSound(); }
      return;
    }
    if (shopOpen) {                                  // the shop swallows game keys
      if (code === 'Escape') { e.preventDefault(); if (ui.caseScreen.classList.contains('visible')) closeCase(); else closeShop(); }
      return;
    }
    if (KEY_DIR[code]) {
      e.preventDefault();
      if (!e.repeat) queueMove(KEY_DIR[code]);       // one hop per key press
      return;
    }
    if (code === 'Space' || code === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'playing' || state === 'paused') togglePause();
      else if (code === 'Space' && (state === 'menu' || state === 'over')) startGame();
    } else if (code === 'Enter') {
      e.preventDefault();
      if (!e.repeat && (state === 'menu' || state === 'over')) startGame();
      else if (!e.repeat && state === 'paused') resumeGame();
    }
  });

  $('playBtn').addEventListener('click', startGame);
  $('restartBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', resumeGame);
  $('shopBtn').addEventListener('click', () => openShop('start'));
  $('shopBtn2').addEventListener('click', () => openShop('over'));
  ui.shopClose.addEventListener('click', closeShop);
  document.querySelectorAll('[data-open-sound]').forEach((b) => b.addEventListener('click', () => { b.blur(); openSound(); }));
  $('soundClose').addEventListener('click', closeSound);
  ui.shopTabs.forEach((t) => t.addEventListener('click', () => { shopTab = t.dataset.tab; renderShop(); }));
  ui.pauseBtn.addEventListener('click', () => { ui.pauseBtn.blur(); togglePause(); });

  // On-screen d-pad (pointer events cover touch + mouse)
  ui.dpad.querySelectorAll('.pad').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      queueMove(btn.dataset.dir);
    });
    const off = () => btn.classList.remove('active');
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // Tap = forward, swipe along a lane diagonal = that direction.
  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    document.body.classList.add('has-touch');
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.hypot(dx, dy) < 24) queueMove('f');
    else if (dx >= 0 && dy < 0) queueMove('f');
    else if (dx < 0 && dy >= 0) queueMove('b');
    else if (dx < 0 && dy < 0) queueMove('l');
    else queueMove('r');
  }, { passive: true });
  // Keep the page from scrolling or rubber-banding while playing.
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest && e.target.closest('input[type=range], .shop-grid')) return;   // sliders and the shop list must scroll/drag
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  window.addEventListener('touchstart', () => document.body.classList.add('has-touch'), { once: true, passive: true });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', pauseGame);

  /* ===================================================================
   * Main loop (time-based, so speed is identical at any frame rate)
   * =================================================================== */
  let lastTs = 0;
  function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  resize();
  resetGame();
  parrot.face = 'b';                       // show the parrot's face on the title screen
  setOverlay('start');
  requestAnimationFrame(frame);
})();
