(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const TILE = 32;
  const W = 96;
  const H = 72;
  const GRASS = 0, SAND = 1, WATER = 2;

  const DAY_LENGTH = 300;        // seconds for a full day/night cycle
  const REACH = TILE * 2.5;      // how far the player can interact
  const PLAYER_HALF = 10;        // collision half-size
  const SPEED = 150;
  const TOOL_DURABILITY = 40;
  const FIRE_MAX = 300;

  const HUNGER_RATE = 0.16;      // per second
  const THIRST_RATE = 0.22;
  const STARVE_DMG = 1.0;
  const DEHYDRATE_DMG = 1.5;
  const COLD_DMG = 0.4;
  const REGEN = 0.8;

  const ITEMS = {
    wood:    { name: 'Wood',       icon: '🪵' },
    stick:   { name: 'Stick',      icon: '🥢' },
    pebble:  { name: 'Pebble',     icon: '🪨' },
    stone:   { name: 'Stone',      icon: '🧱' },
    berries: { name: 'Berries',    icon: '🍒', food: { hunger: 15, thirst: 4 } },
    pie:     { name: 'Berry Pie',  icon: '🥧', food: { hunger: 60, thirst: 0 } },
    fiber:   { name: 'Plant Fiber', icon: '🌾' },
    fish:    { name: 'Raw Fish',   icon: '🐟', food: { hunger: 10, thirst: 2 } },
    cooked_fish: { name: 'Cooked Fish', icon: '🍤', food: { hunger: 40, thirst: 0 } },
  };
  const ITEM_ORDER = ['wood', 'stick', 'pebble', 'stone', 'fiber', 'berries', 'fish', 'cooked_fish', 'pie'];

  const TOOLS = {
    axe:     { name: 'Stone Axe',     icon: '🪓' },
    pickaxe: { name: 'Stone Pickaxe', icon: '⛏️' },
    rod:     { name: 'Fishing Rod',   icon: '🎣' },
  };

  const RECIPES = [
    { id: 'axe',     name: 'Stone Axe',     icon: '🪓', cost: { stick: 3, pebble: 2 }, desc: 'Chop trees for wood.', tool: 'axe' },
    { id: 'pickaxe', name: 'Stone Pickaxe', icon: '⛏️', cost: { stick: 3, pebble: 3 }, desc: 'Mine rocks for stone.', tool: 'pickaxe' },
    { id: 'pie',     name: 'Berry Pie',     icon: '🥧', cost: { berries: 3 }, desc: '+60 hunger. Needs a lit campfire nearby.', item: 'pie', fire: true },
    { id: 'rod',     name: 'Fishing Rod',   icon: '🎣', cost: { stick: 3, fiber: 2 }, desc: 'Press R to fish. Fiber comes from berry bushes.', tool: 'rod' },
    { id: 'cookedfish', name: 'Cooked Fish', icon: '🍤', cost: { fish: 1 }, desc: '+40 hunger. Needs a lit campfire nearby.', item: 'cooked_fish', fire: true },
  ];

  const BUILDS = [
    { id: 'wall',     name: 'Wall',     icon: '🟫', cost: { wood: 2 } },
    { id: 'floor',    name: 'Floor',    icon: '🟧', cost: { wood: 1 } },
    { id: 'door',     name: 'Door',     icon: '🚪', cost: { wood: 3 } },
    { id: 'campfire', name: 'Campfire', icon: '🔥', cost: { wood: 3, stone: 2 } },
    { id: 'boat',     name: 'Boat',     icon: '🛶', cost: { wood: 5 } },
  ];
  const BUILD_BY_ID = Object.fromEntries(BUILDS.map(b => [b.id, b]));
  const STRUCTURES = new Set(['wall', 'door', 'campfire']);

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const lightCanvas = document.createElement('canvas');
  const lctx = lightCanvas.getContext('2d');
  let vw = 0, vh = 0, dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    vw = window.innerWidth;
    vh = window.innerHeight;
    for (const c of [canvas, lightCanvas]) {
      c.width = Math.floor(vw * dpr);
      c.height = Math.floor(vh * dpr);
    }
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inBounds = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H;
  const hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(rand) {
    const S = 64;
    const g = new Float32Array(S * S);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    const at = (x, y) => g[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
    const sm = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = sm(x - x0), fy = sm(y - y0);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }
  const fbm = (n, x, y) => n(x, y) * 0.6 + n(x * 2, y * 2) * 0.3 + n(x * 4, y * 4) * 0.1;

  function costText(cost) {
    return Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ');
  }

  // ---------------------------------------------------------------------------
  // World generation
  // ---------------------------------------------------------------------------
  let state = null;

  function makeObj(type, rand) {
    const o = { type, v: rand() };
    if (type === 'tree') o.hp = 4;
    if (type === 'rock') o.hp = 5;
    if (type === 'bush') { o.berries = true; o.regrow = 0; }
    if (type === 'door') o.open = false;
    if (type === 'campfire') o.fuel = 180;
    return o;
  }

  function generate(seed) {
    const rand = mulberry32(seed);
    const n1 = makeNoise(rand), n2 = makeNoise(rand);
    const ground = new Uint8Array(W * H);
    const floor = new Uint8Array(W * H);
    const obj = new Array(W * H).fill(null);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let e = fbm(n1, x / 14, y / 14);
        const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
        const edge = Math.max(Math.abs(dx), Math.abs(dy));
        e -= Math.max(0, edge - 0.72) * 1.8;
        const i = y * W + x;
        ground[i] = e < 0.38 ? WATER : e < 0.43 ? SAND : GRASS;

        if (ground[i] === GRASS) {
          const f = fbm(n2, x / 9, y / 9);
          if (rand() < clamp((f - 0.45) * 1.2, 0, 0.45) + 0.02) obj[i] = makeObj('tree', rand);
          else {
            const r = rand();
            if (r < 0.015) obj[i] = makeObj('rock', rand);
            else if (r < 0.035) obj[i] = makeObj('bush', rand);
            else if (r < 0.06) obj[i] = makeObj('stick', rand);
            else if (r < 0.075) obj[i] = makeObj('pebble', rand);
          }
        } else if (ground[i] === SAND) {
          const r = rand();
          if (r < 0.03) obj[i] = makeObj('rock', rand);
          else if (r < 0.07) obj[i] = makeObj('pebble', rand);
          else if (r < 0.08) obj[i] = makeObj('stick', rand);
        }
      }
    }

    // Spawn: the grass tile nearest the centre that has water within 8 tiles.
    const nearWater = (x, y) => {
      for (let yy = y - 8; yy <= y + 8; yy++)
        for (let xx = x - 8; xx <= x + 8; xx++)
          if (inBounds(xx, yy) && ground[yy * W + xx] === WATER) return true;
      return false;
    };
    const cands = [];
    for (let y = 4; y < H - 4; y++)
      for (let x = 4; x < W - 4; x++)
        if (ground[y * W + x] === GRASS) cands.push([x, y, (x - W / 2) ** 2 + (y - H / 2) ** 2]);
    cands.sort((a, b) => a[2] - b[2]);
    const spawn = cands.find(c => nearWater(c[0], c[1])) || cands[0] || [W / 2, H / 2];
    const [sx, sy] = spawn;

    // Clear a small area and scatter starter resources nearby.
    for (let y = sy - 2; y <= sy + 2; y++)
      for (let x = sx - 2; x <= sx + 2; x++)
        if (inBounds(x, y)) obj[y * W + x] = null;
    const scatter = (type, count) => {
      let placed = 0;
      for (let tries = 0; tries < 400 && placed < count; tries++) {
        const x = sx + Math.round((rand() - 0.5) * 12);
        const y = sy + Math.round((rand() - 0.5) * 12);
        if (!inBounds(x, y) || Math.abs(x - sx) + Math.abs(y - sy) < 3) continue;
        const i = y * W + x;
        if (ground[i] === WATER || obj[i]) continue;
        obj[i] = makeObj(type, rand);
        placed++;
      }
    };
    scatter('stick', 6);
    scatter('pebble', 5);
    scatter('bush', 2);
    scatter('tree', 4);

    const counts = countObjects(obj);
    return {
      rand, ground, floor, obj,
      targets: {
        tree: Math.floor(counts.tree * 0.85),
        rock: Math.floor(counts.rock * 0.8),
        stick: counts.stick,
        pebble: counts.pebble,
        bush: counts.bush,
      },
      spawn: { x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2 },
    };
  }

  function countObjects(obj) {
    const c = { tree: 0, rock: 0, stick: 0, pebble: 0, bush: 0 };
    for (const o of obj) if (o && o.type in c) c[o.type]++;
    return c;
  }

  function newGame() {
    const world = generate((Math.random() * 2 ** 32) >>> 0);
    state = {
      ...world,
      player: {
        x: world.spawn.x, y: world.spawn.y, face: 0,
        hp: 100, hunger: 100, thirst: 100,
        cooldown: 0, swing: 0, lastTool: null,
      },
      inv: {},
      tools: { axe: 0, pickaxe: 0, rod: 0 },
      time: DAY_LENGTH * 0.26,
      build: null,
      floats: [],
      sheltered: false, nearFire: false, cold: false,
      shelterTimer: 0, tickAcc: 0, respawnAcc: 0,
      sleeping: false,
      dead: false,
      lastDay: 1,
      fishMode: false, fishing: null,
      fishes: [], particles: [], ripples: [],
      boats: [], riding: null,
    };
    spawnFishNear(FISH_TARGET);
    msgThrottle.clear();
    logEl.innerHTML = '';
    invDirty = true;
    renderBuildBar();
    addMsg('You wake up on a wild island. Pick up sticks and pebbles by clicking them.');
    addMsg('Press C to craft a Stone Axe, then chop trees for wood.');
  }

  // ---------------------------------------------------------------------------
  // World queries
  // ---------------------------------------------------------------------------
  function isSolid(tx, ty) {
    if (!inBounds(tx, ty)) return true;
    const i = ty * W + tx;
    if (state.ground[i] === WATER) return true;
    const o = state.obj[i];
    if (!o) return false;
    if (o.type === 'door') return !o.open;
    return o.type === 'tree' || o.type === 'rock' || o.type === 'wall' || o.type === 'campfire';
  }

  function boxHitsSolid(x, y) {
    const x0 = Math.floor((x - PLAYER_HALF) / TILE), x1 = Math.floor((x + PLAYER_HALF - 0.01) / TILE);
    const y0 = Math.floor((y - PLAYER_HALF) / TILE), y1 = Math.floor((y + PLAYER_HALF - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (isSolid(tx, ty)) return true;
    return false;
  }

  function overlapsPlayer(tx, ty) {
    const p = state.player;
    return p.x + PLAYER_HALF > tx * TILE && p.x - PLAYER_HALF < (tx + 1) * TILE &&
           p.y + PLAYER_HALF > ty * TILE && p.y - PLAYER_HALF < (ty + 1) * TILE;
  }

  function inReach(tx, ty) {
    const p = state.player;
    return Math.hypot(tx * TILE + TILE / 2 - p.x, ty * TILE + TILE / 2 - p.y) <= REACH;
  }

  // A shelter is an enclosed, fully floored area bounded by walls and closed doors.
  function computeSheltered() {
    const p = state.player;
    const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
    const start = sy * W + sx;
    if (!state.floor[start]) return false;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const i = queue.pop();
      if (!state.floor[i]) return false;
      if (seen.size > 120) return false;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) return false;
        const n = ny * W + nx;
        const o = state.obj[n];
        if (o && (o.type === 'wall' || (o.type === 'door' && !o.open))) continue;
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    return true;
  }

  function checkNearFire() {
    const p = state.player;
    const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
    for (let y = py - 3; y <= py + 3; y++)
      for (let x = px - 3; x <= px + 3; x++) {
        if (!inBounds(x, y)) continue;
        const o = state.obj[y * W + x];
        if (o && o.type === 'campfire' && o.fuel > 0 &&
            Math.hypot(x * TILE + 16 - p.x, y * TILE + 16 - p.y) <= TILE * 3.2) return true;
      }
    return false;
  }

  // Sun height: 1 at noon, -1 at midnight.
  const dayPhase = () => (state.time % DAY_LENGTH) / DAY_LENGTH;
  const sunHeight = () => Math.sin((dayPhase() - 0.25) * Math.PI * 2);
  const isNight = () => sunHeight() < -0.3;
  const darkness = () => clamp((0.1 - sunHeight()) / 0.5, 0, 1) * 0.88;
  const dayNumber = () => Math.floor(state.time / DAY_LENGTH - 0.25) + 1;

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------
  let invDirty = true;
  const count = item => state.inv[item] || 0;
  const has = cost => Object.entries(cost).every(([k, v]) => count(k) >= v);
  function pay(cost) {
    for (const [k, v] of Object.entries(cost)) state.inv[k] -= v;
    invDirty = true;
  }
  function refund(cost) {
    for (const [k, v] of Object.entries(cost)) state.inv[k] = count(k) + v;
    invDirty = true;
  }
  function give(item, n, wx, wy) {
    state.inv[item] = count(item) + n;
    invDirty = true;
    floatText(wx, wy, `+${n} ${ITEMS[item].icon}`, '#fff');
  }
  function useTool(tool) {
    state.player.lastTool = tool;
    state.tools[tool]--;
    invDirty = true;
    if (state.tools[tool] <= 0) {
      state.tools[tool] = 0;
      addMsg(`Your ${TOOLS[tool].name} broke! Craft a new one with C.`, 'warn');
    }
  }

  function eat(item) {
    const p = state.player;
    const food = ITEMS[item] && ITEMS[item].food;
    if (!food || count(item) <= 0) return false;
    if (p.hunger >= 98) { msgOnce('full', "You're not hungry right now.", 2); return false; }
    state.inv[item]--;
    p.hunger = Math.min(100, p.hunger + food.hunger);
    p.thirst = Math.min(100, p.thirst + food.thirst);
    invDirty = true;
    floatText(p.x, p.y - 20, `+${food.hunger} 🍖`, '#ffcf7a');
    return true;
  }

  function eatBest() {
    for (const food of ['pie', 'cooked_fish', 'berries', 'fish']) if (count(food) > 0) return eat(food);
    msgOnce('nofood', 'You have nothing to eat. Look for berry bushes.', 2);
    return false;
  }

  function drink(wx, wy) {
    const p = state.player;
    if (p.thirst >= 99) { msgOnce('notthirsty', "You're not thirsty.", 2); return; }
    p.thirst = Math.min(100, p.thirst + 20);
    floatText(wx, wy, '+20 💧', '#8fd3ff');
  }

  function drinkNearby() {
    const p = state.player;
    const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
    for (let y = py - 1; y <= py + 1; y++)
      for (let x = px - 1; x <= px + 1; x++)
        if (inBounds(x, y) && state.ground[y * W + x] === WATER) {
          drink(x * TILE + 16, y * TILE + 8);
          return;
        }
    msgOnce('nowater', 'No water nearby. Walk up to a lake or the sea.', 2);
  }

  function craft(recipe) {
    if (!has(recipe.cost)) return;
    if (recipe.fire && !checkNearFire()) { addMsg('You need to stand next to a lit campfire to cook.', 'warn'); return; }
    pay(recipe.cost);
    const p = state.player;
    if (recipe.tool) {
      state.tools[recipe.tool] = TOOL_DURABILITY;
      addMsg(`Crafted a ${recipe.name}.`);
    } else {
      give(recipe.item, 1, p.x, p.y - 20);
      addMsg(`Made a ${recipe.name}.`);
    }
    renderCraft();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const mouse = { x: 0, y: 0, down: false, pressed: false, shift: false };
  let camX = 0, camY = 0;

  function hoverTile() {
    const tx = Math.floor((mouse.x + camX) / TILE), ty = Math.floor((mouse.y + camY) / TILE);
    return inBounds(tx, ty) ? { tx, ty } : null;
  }

  function act() {
    const s = state, p = s.player;
    const t = hoverTile();
    if (!t) return;
    const { tx, ty } = t;
    const i = ty * W + tx;

    if (mouse.shift) { deconstruct(tx, ty); p.cooldown = 0.25; return; }
    if (s.build) { p.cooldown = placeStructure(tx, ty) ? 0.12 : 0.25; return; }
    if (!inReach(tx, ty)) { msgOnce('reach', 'Too far away. Move closer.', 2); p.cooldown = 0.2; return; }

    // In a boat: click nearby land to step out, click water to drink.
    if (s.riding) {
      p.cooldown = 0.3;
      if (s.ground[i] === WATER) drink(tx * TILE + 16, ty * TILE + 4);
      else if (!isSolid(tx, ty)) leaveBoat(tx, ty);
      return;
    }
    const clicked = boatAtPx(mouse.x + camX, mouse.y + camY);
    if (clicked) { boardBoat(clicked); p.cooldown = 0.3; return; }

    p.cooldown = 0.3;
    p.swing = 0.25;
    const o = s.obj[i];
    const cx = tx * TILE + 16, cy = ty * TILE + 4;

    if (!o) {
      if (s.ground[i] === WATER) { drink(cx, cy); return; }
      p.swing = 0; p.cooldown = 0.1;
      return;
    }

    switch (o.type) {
      case 'stick':
      case 'pebble':
        give(o.type, 1, cx, cy);
        s.obj[i] = null;
        p.cooldown = 0.15;
        break;

      case 'bush':
        if (o.berries) {
          give('berries', 2 + Math.floor(Math.random() * 2), cx, cy);
          if (Math.random() < 0.6) give('fiber', 1, cx, cy - 14);
          o.berries = false;
          o.regrow = 60;
        } else {
          msgOnce('bush', 'No berries yet. They grow back after a while.', 3);
        }
        break;

      case 'tree':
        o.hit = performance.now();
        if (s.tools.axe > 0) {
          useTool('axe');
          if (--o.hp <= 0) {
            give('wood', 3 + (Math.random() < 0.5 ? 1 : 0), cx, cy);
            if (Math.random() < 0.4) give('stick', 1, cx, cy - 14);
            s.obj[i] = null;
          }
        } else {
          if (Math.random() < 0.35) give('stick', 1, cx, cy);
          msgOnce('needaxe', 'You need a Stone Axe to chop wood. Press C to craft one.', 4);
        }
        break;

      case 'rock':
        o.hit = performance.now();
        if (s.tools.pickaxe > 0) {
          useTool('pickaxe');
          if (Math.random() < 0.25) give('pebble', 1, cx, cy - 14);
          if (--o.hp <= 0) {
            give('stone', 2 + (Math.random() < 0.5 ? 1 : 0), cx, cy);
            s.obj[i] = null;
          }
        } else {
          if (Math.random() < 0.3) give('pebble', 1, cx, cy);
          msgOnce('needpick', 'You need a Stone Pickaxe to mine stone.', 4);
        }
        break;

      case 'door':
        if (o.open && overlapsPlayer(tx, ty)) { msgOnce('door', "Step out of the doorway first.", 2); break; }
        o.open = !o.open;
        p.swing = 0;
        break;

      case 'campfire':
        if (o.fuel >= FIRE_MAX - 30) { msgOnce('fullfire', 'The fire is already roaring.', 2); break; }
        if (count('wood') > 0) {
          state.inv.wood--;
          invDirty = true;
          o.fuel = Math.min(FIRE_MAX, o.fuel + 90);
          floatText(cx, cy, '🔥 +fuel', '#ffb45c');
        } else {
          msgOnce('firewood', 'Add Wood to keep the fire burning.', 3);
        }
        break;

      case 'wall':
        p.swing = 0;
        msgOnce('wallhint', 'Right-click or Shift+click to take apart something you built.', 4);
        break;
    }
  }

  function canPlace(id, tx, ty) {
    const s = state;
    const i = ty * W + tx;
    if (id === 'boat') return inBounds(tx, ty) && boatFits(tx * TILE + 16, ty * TILE + 16) && !boatAtPx(tx * TILE + 16, ty * TILE + 16, 30);
    if (!inBounds(tx, ty) || s.ground[i] === WATER) return false;
    const o = s.obj[i];
    if (id === 'floor') return !s.floor[i] && (!o || STRUCTURES.has(o.type));
    return !o && !overlapsPlayer(tx, ty);
  }

  function placeStructure(tx, ty) {
    const b = BUILD_BY_ID[state.build];
    if (!inReach(tx, ty)) { msgOnce('reach', 'Too far away. Move closer.', 2); return false; }
    if (!canPlace(b.id, tx, ty)) { msgOnce('place', "You can't build there.", 1.5); return false; }
    if (!has(b.cost)) { msgOnce('cost', `${b.name} needs ${costText(b.cost)}.`, 2); return false; }
    pay(b.cost);
    const i = ty * W + tx;
    if (b.id === 'floor') state.floor[i] = 1;
    else if (b.id === 'boat') state.boats.push(makeBoat(tx * TILE + 16, ty * TILE + 16, state.player.face));
    else state.obj[i] = makeObj(b.id, Math.random);
    renderBuildBar();
    return true;
  }

  function deconstruct(tx, ty) {
    if (!inReach(tx, ty)) { msgOnce('reach', 'Too far away. Move closer.', 2); return; }
    const i = ty * W + tx;
    const o = state.obj[i];
    const cx = tx * TILE + 16, cy = ty * TILE + 4;
    const boat = boatAtPx(tx * TILE + 16, ty * TILE + 16, 22);
    if (boat && boat !== state.riding) {
      state.boats = state.boats.filter(b => b !== boat);
      refund(BUILD_BY_ID.boat.cost);
      floatText(cx, cy, `+${costText(BUILD_BY_ID.boat.cost)}`, '#fff');
    } else if (o && STRUCTURES.has(o.type)) {
      state.obj[i] = null;
      refund(BUILD_BY_ID[o.type].cost);
      floatText(cx, cy, `+${costText(BUILD_BY_ID[o.type].cost)}`, '#fff');
    } else if (!o && state.floor[i]) {
      state.floor[i] = 0;
      refund(BUILD_BY_ID.floor.cost);
      floatText(cx, cy, `+${costText(BUILD_BY_ID.floor.cost)}`, '#fff');
    }
    renderBuildBar();
  }

  function trySleep() {
    if (state.sleeping) return;
    if (!isNight()) { msgOnce('sleepday', "It's daytime. You can only sleep at night.", 2); return; }
    if (!computeSheltered()) { msgOnce('sleepout', "It's not safe to sleep out here. Build a shelter first.", 3); return; }
    if (state.player.hunger < 15 || state.player.thirst < 15) { msgOnce('sleephungry', "You're too hungry or thirsty to sleep.", 3); return; }
    if (state.fishMode) toggleFishing();
    state.sleeping = true;
    mouse.down = false;
  }

  // ---------------------------------------------------------------------------
  // Fishing
  // ---------------------------------------------------------------------------
  // The bobber lives in 3D: x/y on the map plus a height z (0 = water surface,
  // negative = pulled under). The line is a verlet rope from the rod tip to the
  // bobber. A hooked fish pulls on the bobber; reeling shortens the line, and
  // fighting a fish that's running builds tension until the line snaps.
  const FISH_GRAVITY = 520;     // px/s² on the bobber while it's in the air
  const MAX_LINE = 440;         // px of line on the reel
  const REEL_SPEED = 150;       // px/s wound in while holding the mouse
  const ROPE_POINTS = 16;
  const FISH_TARGET = 30;       // fish kept swimming around the player

  const isWaterPx = (x, y) => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return inBounds(tx, ty) && state.ground[ty * W + tx] === WATER;
  };

  // Things the bobber bounces off when it's low to the ground.
  const blocksBobber = (x, y) => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!inBounds(tx, ty)) return true;
    const o = state.obj[ty * W + tx];
    return !!o && (o.type === 'tree' || o.type === 'rock' || o.type === 'wall' || (o.type === 'door' && !o.open));
  };

  function toggleFishing() {
    const s = state;
    if (s.fishMode) {
      s.fishMode = false;
      dropLine();
    } else {
      if (s.tools.rod <= 0) { msgOnce('norod', 'You need a Fishing Rod. Craft one with C.', 2); return; }
      s.fishMode = true;
      if (s.build) { s.build = null; renderBuildBar(); }
      msgOnce('fishhelp', 'Fishing: hold the mouse to charge a cast, release to throw it at the water. Hold again to reel in. R puts the rod away.', 30);
    }
    invDirty = true;
  }

  function rodTip() {
    const p = state.player, f = state.fishing;
    const ten = f && f.tension ? clamp(f.tension, 0, 1.2) : 0;
    let x = p.x + Math.cos(p.face) * 18, y = p.y + Math.sin(p.face) * 18;
    // Under tension the rod bends toward the line.
    if (ten > 0 && f.bx !== undefined) {
      const a = Math.atan2(f.by - p.y, f.bx - p.x);
      x += Math.cos(a) * ten * 6;
      y += Math.sin(a) * ten * 6;
    }
    return { x, y, z: 30 - ten * 12 };
  }

  function cast(f) {
    const p = state.player, tip = rodTip();
    const sp = 140 + f.charge * 360;
    Object.assign(f, {
      phase: 'flying',
      bx: tip.x, by: tip.y, bz: tip.z,
      vx: Math.cos(p.face) * sp, vy: Math.sin(p.face) * sp, vz: 110 + f.charge * 150,
      L: 0, fish: null, tension: 0, snapT: 0, biteT: 0, nibbles: 0, nibbleT: 0, rippleT: 0,
      rope: Array.from({ length: ROPE_POINTS + 1 }, () => ({ x: tip.x, y: tip.y, z: tip.z, px: tip.x, py: tip.y, pz: tip.z })),
    });
    p.swing = 0.25;
  }

  // Reel the line in without catching anything (putting the rod away, sleeping...).
  function dropLine() {
    const f = state.fishing;
    if (f && f.fish) fleeFish(f.fish, f.bx, f.by);
    state.fishing = null;
  }

  function splash(x, y, power) {
    const s = state;
    for (let i = 0; i < 6 + power * 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 70 * power;
      s.particles.push({ x, y, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 50 + Math.random() * 130 * power });
    }
    ripple(x, y);
  }
  const ripple = (x, y) => state.ripples.push({ x, y, t: 0 });

  function moveBobber(f, dt) {
    const nx = f.bx + f.vx * dt, ny = f.by + f.vy * dt;
    const low = f.bz < 22;
    if (low && blocksBobber(nx, f.by)) f.vx *= -0.4; else f.bx = nx;
    if (low && blocksBobber(f.bx, ny)) f.vy *= -0.4; else f.by = ny;
  }

  function hookFish(f, fish) {
    fish.state = 'hooked';
    fish.stamina = 1;
    fish.running = false;
    fish.runT = 0;
    f.tension = 0;
    splash(f.bx, f.by, 0.6);
    addMsg('🎣 Hooked! Reel in (hold) while it rests. Let go when it runs!', 'warn');
  }

  function scareFish(f, text) {
    fleeFish(f.fish, f.bx, f.by);
    f.fish = null;
    addMsg(text);
  }

  function snapLine() {
    const s = state, f = s.fishing;
    if (f.fish) fleeFish(f.fish, f.bx, f.by);
    splash(f.bx, f.by, 0.5);
    s.fishing = null;
    addMsg('💥 Snap! The line broke and the fish got away. Ease off when it runs.', 'bad');
    useTool('rod');
    if (s.tools.rod <= 0) s.fishMode = false;
  }

  function landFish(f) {
    const s = state, p = s.player, fish = f.fish;
    s.fishes = s.fishes.filter(o => o !== fish);
    const n = fish.size > 1.25 ? 2 : 1;
    give('fish', n, p.x, p.y - 20);
    addMsg(n > 1 ? '🐟 What a big one! You caught 2 Raw Fish.' : '🐟 You caught a fish!');
    useTool('rod');
    if (s.tools.rod <= 0) s.fishMode = false;
  }

  function updateFishing(dt) {
    const s = state, p = s.player;
    const pressed = mouse.pressed;
    if (!s.fishMode || s.sleeping) return;
    let f = s.fishing;
    if (!f) {
      if (pressed) s.fishing = { phase: 'charge', charge: 0, dir: 1 };
      return;
    }

    // Charging: power swings up and down until you let go.
    if (f.phase === 'charge') {
      f.charge += f.dir * dt * 1.2;
      if (f.charge >= 1) { f.charge = 1; f.dir = -1; }
      if (f.charge <= 0.1 && f.dir < 0) { f.charge = 0.1; f.dir = 1; }
      if (!mouse.down) cast(f);
      return;
    }

    const reeling = mouse.down;
    const fish = f.fish;

    // Nibbles and bites
    if (fish && pressed) {
      if (fish.state === 'biting') hookFish(f, fish);
      else if (fish.state === 'nibble') scareFish(f, 'You pulled too early and scared it off. Wait for the bobber to go under.');
    }
    if (f.fish && f.fish.state === 'nibble') {
      f.nibbleT -= dt;
      if (f.nibbleT <= 0) {
        ripple(f.bx, f.by);
        if (f.nibbles > 0) {
          f.vz -= 35;
          f.nibbles--;
          f.nibbleT = 0.5 + Math.random() * 0.8;
        } else {
          f.fish.state = 'biting';
          f.biteT = 0.8;
          f.vz -= 150;
          splash(f.bx, f.by, 0.3);
        }
      }
    } else if (f.fish && f.fish.state === 'biting') {
      f.biteT -= dt;
      if (f.biteT <= 0) scareFish(f, 'It got away. Click as soon as the bobber goes under!');
    }

    // A hooked fish alternates between running (pulling hard) and resting.
    const hooked = f.fish && f.fish.state === 'hooked';
    let pull = 0;
    if (hooked) {
      const hf = f.fish;
      hf.runT -= dt;
      if (hf.runT <= 0) {
        hf.running = !hf.running;
        hf.runT = hf.running ? 0.7 + Math.random() * 1.1 : 0.8 + Math.random() * 1.0;
        hf.pullDir = Math.atan2(f.by - p.y, f.bx - p.x) + (Math.random() - 0.5) * 2.2;
      }
      hf.stamina = Math.max(0.15, hf.stamina - dt * (0.05 + f.tension * 0.1));
      if (f.phase === 'floating') {
        pull = hf.size * (hf.running ? 300 : 45) * hf.stamina;
        f.vx += Math.cos(hf.pullDir) * pull * dt;
        f.vy += Math.sin(hf.pullDir) * pull * dt;
        f.rippleT -= dt;
        if (f.rippleT <= 0) { ripple(f.bx, f.by); f.rippleT = hf.running ? 0.25 : 0.7; }
      }
      hf.x = f.bx; hf.y = f.by; hf.heading = hf.pullDir;
    }

    // Bobber physics
    if (f.phase === 'flying') {
      f.vz -= FISH_GRAVITY * dt;
      f.bz += f.vz * dt;
      moveBobber(f, dt);
      if (f.bz <= 0) {
        f.bz = 0;
        if (isWaterPx(f.bx, f.by)) {
          f.phase = 'floating';
          splash(f.bx, f.by, Math.min(1, -f.vz / 300));
          f.vz *= 0.15; f.vx *= 0.25; f.vy *= 0.25;
        } else if (f.vz < -70) {
          f.vz = -f.vz * 0.35; f.vx *= 0.6; f.vy *= 0.6;   // bounce off the ground
        } else {
          f.phase = 'ground';
          f.vz = 0;
        }
      }
    } else if (f.phase === 'floating') {
      // Buoyancy: a damped spring toward a resting depth that rocks with the waves.
      const rest = -1.5 + Math.sin(performance.now() / 430 + f.bx * 0.05) - (hooked ? (f.fish.running ? 5 : 2) : 0);
      f.vz += ((rest - f.bz) * 70 - f.vz * 7) * dt;
      f.bz += f.vz * dt;
      const drag = Math.exp(-2.5 * dt);
      f.vx *= drag; f.vy *= drag;
      moveBobber(f, dt);
      if (!isWaterPx(f.bx, f.by)) { f.phase = 'ground'; f.bz = Math.max(0, f.bz); f.vz = 0; }
    } else {
      f.vz -= FISH_GRAVITY * dt;
      f.bz += f.vz * dt;
      if (f.bz <= 0) { f.bz = 0; f.vz = 0; }
      const friction = Math.exp(-6 * dt);
      f.vx *= friction; f.vy *= friction;
      moveBobber(f, dt);
      if (f.bz <= 0 && isWaterPx(f.bx, f.by)) { f.phase = 'floating'; ripple(f.bx, f.by); }
    }

    // Line length: pays out while flying, winds in while reeling.
    const tip = rodTip();
    const dx = f.bx - tip.x, dy = f.by - tip.y;
    const dist = Math.hypot(dx, dy);
    if (f.phase === 'flying') f.L = Math.min(MAX_LINE, Math.max(f.L, dist));
    else if (reeling) f.L = Math.max(0, f.L - REEL_SPEED * dt);
    if (dist > f.L && dist > 0) {
      const nx = dx / dist, ny = dy / dist;
      const outward = f.vx * nx + f.vy * ny;
      // Not reeling: the reel lets a running fish take line instead of fighting it.
      if (!reeling && hooked && outward > 0) f.L = Math.min(MAX_LINE, f.L + outward * dt);
      const over = Math.max(0, dist - f.L);
      f.bx -= nx * over;
      f.by -= ny * over;
      if (outward > 0) { f.vx -= nx * outward; f.vy -= ny * outward; }
    }

    // Tension builds when you reel against a fish that's pulling away.
    const taut = f.phase !== 'flying' && dist >= f.L - 0.5;
    let target = 0;
    if (taut && hooked) target = (pull / 380) * (reeling ? 1.25 : 0.55) + (reeling ? 0.25 : 0);
    else if (taut && reeling) target = 0.12;
    f.tension += (target - f.tension) * Math.min(1, dt * 6);
    if (hooked && f.tension > 1) {
      f.snapT += dt;
      if (f.snapT > 0.35) { snapLine(); return; }
    } else f.snapT = Math.max(0, f.snapT - dt);
    if (hooked && f.L >= MAX_LINE - 1) {
      scareFish(f, 'The fish ran off with all your line and got away.');
    }

    // Back at your feet: the line is in (with a fish, if one is on).
    if (f.phase !== 'flying' && Math.hypot(f.bx - p.x, f.by - p.y) < 24) {
      if (f.fish && f.fish.state === 'hooked') landFish(f);
      else if (f.fish) fleeFish(f.fish, f.bx, f.by);
      s.fishing = null;
      return;
    }

    updateRope(f, tip, dt);
  }

  // Verlet rope: sags under gravity, rests on the water, and never stretches past its length.
  function updateRope(f, tip, dt) {
    const pts = f.rope, n = pts.length - 1;
    const end = { x: f.bx, y: f.by, z: Math.max(f.bz, 0) + 3 };
    const straight = Math.hypot(end.x - tip.x, end.y - tip.y, end.z - tip.z);
    const seg = Math.min(Math.max(f.L, straight), straight + 70) / n;
    const t = performance.now() / 1000;
    for (let i = 1; i < n; i++) {
      const q = pts[i];
      const vx = (q.x - q.px) * 0.97, vy = (q.y - q.py) * 0.97, vz = (q.z - q.pz) * 0.97;
      q.px = q.x; q.py = q.y; q.pz = q.z;
      q.x += vx + Math.sin(t * 1.7 + i * 0.6) * 0.03;
      q.y += vy;
      q.z += vz - 260 * dt * dt;
      if (q.z < 0) q.z = 0;
    }
    Object.assign(pts[0], tip);
    Object.assign(pts[n], end);
    for (let k = 0; k < 10; k++) {
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 0.0001;
        if (d <= seg) continue;
        const diff = (d - seg) / d;
        const wa = i === 0 ? 0 : (i + 1 === n ? 1 : 0.5);
        const wb = i + 1 === n ? 0 : (i === 0 ? 1 : 0.5);
        a.x += dx * diff * wa; a.y += dy * diff * wa; a.z += dz * diff * wa;
        b.x -= dx * diff * wb; b.y -= dy * diff * wb; b.z -= dz * diff * wb;
      }
    }
  }

  // ---- Fish swimming in the water ----
  function spawnFishNear(n) {
    const s = state, p = s.player;
    const ptx = p.x / TILE, pty = p.y / TILE;
    for (let tries = 0; tries < n * 60 && n > 0; tries++) {
      const tx = Math.floor(ptx + (Math.random() - 0.5) * 60), ty = Math.floor(pty + (Math.random() - 0.5) * 60);
      if (!inBounds(tx, ty) || s.ground[ty * W + tx] !== WATER || Math.hypot(tx - ptx, ty - pty) < 8) continue;
      const x = tx * TILE + 16, y = ty * TILE + 16;
      s.fishes.push({
        x, y, vx: 0, vy: 0, tx: x, ty: y, heading: Math.random() * Math.PI * 2,
        size: 0.7 + Math.random() * 0.7, seed: Math.random() * 10, state: 'wander', timer: 0,
      });
      n--;
    }
  }

  function fleeFish(fish, fromX, fromY) {
    const a = Math.atan2(fish.y - fromY, fish.x - fromX) + (Math.random() - 0.5);
    fish.state = 'flee';
    fish.tx = fish.x + Math.cos(a) * 160;
    fish.ty = fish.y + Math.sin(a) * 160;
    fish.timer = 2.5;
  }

  function updateFishes(dt) {
    const s = state, f = s.fishing;
    const bob = f && f.phase === 'floating' ? f : null;
    for (const fish of s.fishes) {
      if (fish.state === 'hooked') continue;   // it moves with the bobber
      fish.timer -= dt;
      let speed = 28;
      if (fish.state === 'flee') {
        speed = 95;
        if (fish.timer <= 0) fish.state = 'wander';
      } else if (fish.state === 'wander') {
        const fast = s.boats.find(b => b.speed > 40 && Math.hypot(b.x - fish.x, b.y - fish.y) < 60);
        if (fast) fleeFish(fish, fast.x, fast.y);
        else if (bob && !bob.fish && Math.hypot(bob.bx - fish.x, bob.by - fish.y) < 160 && Math.random() < 0.35 * dt) fish.state = 'interested';
      }
      if (fish.state === 'interested' || fish.state === 'nibble' || fish.state === 'biting') {
        if (!bob || (bob.fish && bob.fish !== fish)) {
          fish.state = 'wander';
        } else {
          fish.tx = bob.bx; fish.ty = bob.by;
          speed = fish.state === 'interested' ? 45 : 12;
          if (fish.state === 'interested' && Math.hypot(bob.bx - fish.x, bob.by - fish.y) < 10) {
            fish.state = 'nibble';
            bob.fish = fish;
            bob.nibbles = Math.floor(Math.random() * 3);
            bob.nibbleT = 0.6;
          }
        }
      }
      if (fish.state === 'wander' && (fish.timer <= 0 || Math.hypot(fish.tx - fish.x, fish.ty - fish.y) < 8)) {
        for (let k = 0; k < 5; k++) {
          const nx = fish.x + (Math.random() - 0.5) * 240, ny = fish.y + (Math.random() - 0.5) * 240;
          if (isWaterPx(nx, ny)) { fish.tx = nx; fish.ty = ny; break; }
        }
        fish.timer = 3 + Math.random() * 4;
      }
      // Steer toward the target, turning gradually.
      const dx = fish.tx - fish.x, dy = fish.ty - fish.y, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, dt * 2);
      fish.vx += ((dx / d) * speed - fish.vx) * k;
      fish.vy += ((dy / d) * speed - fish.vy) * k;
      const nx = fish.x + fish.vx * dt, ny = fish.y + fish.vy * dt;
      if (isWaterPx(nx, ny)) { fish.x = nx; fish.y = ny; }
      else { fish.vx *= -0.5; fish.vy *= -0.5; fish.timer = 0; }
      if (Math.hypot(fish.vx, fish.vy) > 2) fish.heading = Math.atan2(fish.vy, fish.vx);
    }
  }

  function updateSplashes(dt) {
    const s = state;
    for (const q of s.particles) {
      q.vz -= 400 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    s.particles = s.particles.filter(q => q.z >= 0);
    for (const r of s.ripples) r.t += dt;
    s.ripples = s.ripples.filter(r => r.t < 1);
  }

  // ---------------------------------------------------------------------------
  // Boats
  // ---------------------------------------------------------------------------
  // A boat glides forward easily but resists sliding sideways (like a keel),
  // keeps its momentum on the water, and bounces off the shore.
  const BOAT_RADIUS = 11;
  const BOAT_THRUST = 260;      // px/s² while rowing
  const BOAT_MAX_SPEED = 170;

  function makeBoat(x, y, angle) {
    return { x, y, angle, vx: 0, vy: 0, av: 0, row: 0, wakeT: 0, seed: Math.random() * 10 };
  }

  function boatFits(x, y) {
    for (const [dx, dy] of [[0, 0], [BOAT_RADIUS, 0], [-BOAT_RADIUS, 0], [0, BOAT_RADIUS], [0, -BOAT_RADIUS]])
      if (!isWaterPx(x + dx, y + dy)) return false;
    return true;
  }

  function boatAtPx(x, y, r = 16) {
    let best = null, bestD = r;
    for (const b of state.boats) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  function boardBoat(b) {
    const s = state;
    s.riding = b;
    if (s.build) { s.build = null; renderBuildBar(); }
    s.player.x = b.x;
    s.player.y = b.y;
    msgOnce('boathelp', 'You get in the boat. W/S to row, A/D to steer, Space (or click the shore) to get out.', 20);
  }

  // Step onto a land tile next to the boat. With no tile given, pick the closest one.
  function leaveBoat(tx, ty) {
    const s = state, p = s.player, b = s.riding;
    const ok = (x, y) => inBounds(x, y) && s.ground[y * W + x] !== WATER && !isSolid(x, y) &&
      Math.hypot(x * TILE + 16 - b.x, y * TILE + 16 - b.y) <= TILE * 1.9;
    let spot = tx !== undefined && ok(tx, ty) ? [tx, ty] : null;
    if (!spot) {
      const bx = Math.floor(b.x / TILE), by = Math.floor(b.y / TILE);
      let bestD = Infinity;
      for (let y = by - 2; y <= by + 2; y++)
        for (let x = bx - 2; x <= bx + 2; x++) {
          const d = Math.hypot(x * TILE + 16 - b.x, y * TILE + 16 - b.y);
          if (ok(x, y) && d < bestD) { bestD = d; spot = [x, y]; }
        }
    }
    if (!spot) { msgOnce('noshore', 'Row closer to the shore to get out.', 2); return; }
    s.riding = null;
    b.vx *= 0.3; b.vy *= 0.3;
    p.x = spot[0] * TILE + 16;
    p.y = spot[1] * TILE + 16;
  }

  function updateBoats(dt) {
    const s = state;
    for (const b of s.boats) {
      const rowing = b === s.riding && !s.sleeping;
      let thrust = 0, turn = 0;
      if (rowing) {
        if (keys.has('KeyW') || keys.has('ArrowUp')) thrust = 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) thrust = -0.5;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) turn = -1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) turn = 1;
      }
      b.av += (turn * 2.4 - b.av) * Math.min(1, dt * 4);
      b.angle += b.av * dt;
      const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
      b.vx += fx * thrust * BOAT_THRUST * dt;
      b.vy += fy * thrust * BOAT_THRUST * dt;

      // Split velocity into forward and sideways parts; sideways dies off much faster.
      const fwd = (b.vx * fx + b.vy * fy) * Math.exp(-1.1 * dt);
      const side = (-b.vx * fy + b.vy * fx) * Math.exp(-6 * dt);
      b.vx = fx * fwd - fy * side;
      b.vy = fy * fwd + fx * side;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > BOAT_MAX_SPEED) { b.vx *= BOAT_MAX_SPEED / speed; b.vy *= BOAT_MAX_SPEED / speed; }

      // Move, bouncing off land.
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (boatFits(nx, b.y)) b.x = nx; else b.vx *= -0.35;
      if (boatFits(b.x, ny)) b.y = ny; else b.vy *= -0.35;

      b.row = thrust || turn ? b.row + dt * 7 : b.row;
      b.wakeT -= dt;
      if (speed > 35 && b.wakeT <= 0) {
        ripple(b.x - fx * 15, b.y - fy * 15);
        b.wakeT = 0.18;
      }
      b.speed = speed;
    }
    if (s.riding) {
      s.player.x = s.riding.x;
      s.player.y = s.riding.y;
    }
  }

  function boatPath() {
    ctx.beginPath();
    ctx.moveTo(19, 0);
    ctx.quadraticCurveTo(12, -10, -12, -9);
    ctx.lineTo(-16, -7);
    ctx.lineTo(-16, 7);
    ctx.lineTo(-12, 9);
    ctx.quadraticCurveTo(12, 10, 19, 0);
    ctx.closePath();
  }

  function drawBoat(b, t) {
    const riding = b === state.riding;
    ctx.save();
    ctx.translate(b.x, b.y + Math.sin(t * 2 + b.seed) * 0.8);
    ctx.rotate(b.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 19, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6e4521';
    boatPath();
    ctx.fill();
    ctx.save();
    ctx.scale(0.8, 0.7);
    ctx.fillStyle = '#a8743d';
    boatPath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#6e4521';
    ctx.fillRect(-4, -7, 5, 14);   // seat
    if (riding) {
      // Oars sweep back and forth while rowing.
      const a = Math.sin(b.row) * 0.6;
      ctx.strokeStyle = '#5b3a1c';
      ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-1, side * 7);
        ctx.lineTo(-1 - Math.sin(a) * 14, side * (7 + Math.cos(a) * 12));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    const s = state, p = s.player;
    const timeMul = s.sleeping ? 10 : 1;
    s.time += dt * timeMul;

    // Movement
    if (s.riding) {
      p.face = Math.atan2(mouse.y + camY - p.y, mouse.x + camX - p.x);
    } else if (!s.sleeping) {
      let mx = 0, my = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) mx--;
      if (keys.has('KeyD') || keys.has('ArrowRight')) mx++;
      if (keys.has('KeyW') || keys.has('ArrowUp')) my--;
      if (keys.has('KeyS') || keys.has('ArrowDown')) my++;
      if (mx || my) {
        const len = Math.hypot(mx, my);
        const dx = (mx / len) * SPEED * dt, dy = (my / len) * SPEED * dt;
        if (!boxHitsSolid(p.x + dx, p.y)) p.x += dx;
        if (!boxHitsSolid(p.x, p.y + dy)) p.y += dy;
        p.walk = (p.walk || 0) + dt;
      }
      p.face = Math.atan2(mouse.y + camY - p.y, mouse.x + camX - p.x);
    }

    // Shelter / fire status
    s.shelterTimer -= dt;
    if (s.shelterTimer <= 0) {
      s.sheltered = computeSheltered();
      s.nearFire = checkNearFire();
      s.shelterTimer = 0.3;
    }
    const night = isNight();
    s.cold = night && !s.sheltered && !s.nearFire;

    // Stats. While sleeping, time runs 10x but you only get 2.5x as hungry.
    const drainMul = s.sleeping ? 2.5 : 1;
    p.hunger = Math.max(0, p.hunger - HUNGER_RATE * dt * drainMul);
    p.thirst = Math.max(0, p.thirst - THIRST_RATE * dt * drainMul);

    let dmg = 0;
    if (p.hunger <= 0) dmg += STARVE_DMG;
    if (p.thirst <= 0) dmg += DEHYDRATE_DMG;
    if (s.cold) dmg += COLD_DMG;
    if (dmg > 0) {
      p.hp -= dmg * dt;
      p.hurt = 0.2;
    } else if (p.hunger > 50 && p.thirst > 50) {
      p.hp = Math.min(100, p.hp + REGEN * dt * (s.sleeping ? 4 : 1));
    }
    p.hurt = Math.max(0, (p.hurt || 0) - dt);

    if (s.cold) msgOnce('cold', "You're freezing! Get near a campfire or inside a shelter.", 8, 'bad');
    if (p.hunger <= 0) msgOnce('starving', "You're starving! Eat something (F).", 8, 'bad');
    else if (p.hunger < 25) msgOnce('hungry', "You're getting hungry.", 20, 'warn');
    if (p.thirst <= 0) msgOnce('dehydrated', "You're dehydrated! Drink water (E).", 8, 'bad');
    else if (p.thirst < 25) msgOnce('thirsty', "You're getting thirsty.", 20, 'warn');

    const sun = sunHeight();
    if (sun < 0 && sun > -0.3 && dayPhase() > 0.5) msgOnce('dusk', 'The sun is setting. Night is coming.', DAY_LENGTH * 0.5, 'warn');
    const day = dayNumber();
    if (day !== s.lastDay) { s.lastDay = day; addMsg(`☀️ Day ${day} begins.`); }

    if (s.sleeping && (!night || p.hunger < 10 || p.thirst < 10 || !s.sheltered)) {
      s.sleeping = false;
      addMsg(night ? 'You wake up hungry and thirsty.' : 'You wake up feeling rested.');
    }

    if (p.hp <= 0) { die(); return; }

    // Actions
    p.cooldown -= dt;
    p.swing = Math.max(0, p.swing - dt);
    updateBoats(dt);
    if (s.fishMode) updateFishing(dt);
    else if (mouse.down && p.cooldown <= 0 && !s.sleeping) act();
    mouse.pressed = false;
    updateFishes(dt);
    updateSplashes(dt);

    // World ticks
    s.tickAcc += dt * timeMul;
    while (s.tickAcc >= 0.25) { s.tickAcc -= 0.25; worldTick(0.25); }
    s.respawnAcc += dt * timeMul;
    if (s.respawnAcc >= 15) { s.respawnAcc = 0; respawn(); }

    for (const f of s.floats) { f.t += dt; f.y -= 28 * dt; }
    s.floats = s.floats.filter(f => f.t < 1.1);
  }

  function worldTick(dt) {
    for (const o of state.obj) {
      if (!o) continue;
      if (o.type === 'bush' && !o.berries) {
        o.regrow -= dt;
        if (o.regrow <= 0) o.berries = true;
      } else if (o.type === 'campfire' && o.fuel > 0) {
        o.fuel = Math.max(0, o.fuel - dt);
      }
    }
  }

  function respawn() {
    const s = state;
    const c = countObjects(s.obj);
    const p = s.player;
    const spawnSome = (type, n, grounds) => {
      let placed = 0;
      for (let tries = 0; tries < n * 40 && placed < n; tries++) {
        const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H);
        const i = y * W + x;
        if (!grounds.includes(s.ground[i]) || s.obj[i] || s.floor[i]) continue;
        if (Math.hypot(x * TILE - p.x, y * TILE - p.y) < TILE * 14) continue;
        s.obj[i] = makeObj(type, Math.random);
        placed++;
      }
    };
    if (c.stick < s.targets.stick) spawnSome('stick', 6, [GRASS, SAND]);
    if (c.pebble < s.targets.pebble) spawnSome('pebble', 5, [GRASS, SAND]);
    if (c.tree < s.targets.tree) spawnSome('tree', 4, [GRASS]);
    if (c.rock < s.targets.rock) spawnSome('rock', 1, [GRASS, SAND]);
    if (c.bush < s.targets.bush) spawnSome('bush', 1, [GRASS]);
    // Keep fish around the player: drop far-away ones, add new ones nearby.
    s.fishes = s.fishes.filter(f => f.state === 'hooked' || Math.hypot(f.x - p.x, f.y - p.y) < TILE * 50);
    if (s.fishes.length < FISH_TARGET) spawnFishNear(Math.min(6, FISH_TARGET - s.fishes.length));
  }

  function die() {
    const s = state, p = s.player;
    s.dead = true;
    s.sleeping = false;
    mouse.down = false;
    let reason = 'Your health ran out.';
    if (p.thirst <= 0) reason = 'You died of thirst.';
    else if (p.hunger <= 0) reason = 'You starved.';
    else if (s.cold) reason = 'You froze in the night.';
    document.getElementById('death-reason').textContent = reason;
    const days = dayNumber();
    document.getElementById('survived').textContent = `You survived until day ${days}.`;
    show('gameover', true);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const GRASS_COLORS = ['#5c9e4a', '#589a46', '#61a34f', '#5a9c48'];

  function render(now) {
    ctx.fillStyle = '#1d4f8f';
    ctx.fillRect(0, 0, vw, vh);
    if (!state) return;
    const s = state, p = s.player;
    const t = now / 1000;

    const worldW = W * TILE, worldH = H * TILE;
    camX = worldW <= vw ? (worldW - vw) / 2 : clamp(p.x - vw / 2, 0, worldW - vw);
    camY = worldH <= vh ? (worldH - vh) / 2 : clamp(p.y - vh / 2, 0, worldH - vh);
    camX = Math.round(camX); camY = Math.round(camY);

    const tx0 = Math.max(0, Math.floor(camX / TILE)), tx1 = Math.min(W - 1, Math.floor((camX + vw) / TILE));
    const ty0 = Math.max(0, Math.floor(camY / TILE)), ty1 = Math.min(H - 1, Math.floor((camY + vh) / TILE) + 1);

    ctx.save();
    ctx.translate(-camX, -camY);

    // Ground + floors
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        drawGround(tx, ty, t);
        if (s.floor[ty * W + tx]) drawFloor(tx * TILE, ty * TILE);
      }
    drawFishes(t);
    for (const b of s.boats) drawBoat(b, t);

    // Hover highlight
    const hv = hoverTile();
    if (hv && !s.sleeping && !s.dead) {
      const ok = inReach(hv.tx, hv.ty);
      if (!s.build && !s.fishMode) {
        ctx.strokeStyle = ok ? 'rgba(255,255,255,0.55)' : 'rgba(255,90,90,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(hv.tx * TILE + 1, hv.ty * TILE + 1, TILE - 2, TILE - 2);
      }
    }

    // Objects and player, row by row so things lower on screen draw in front.
    const pRow = Math.floor(p.y / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = s.obj[ty * W + tx];
        if (o) drawObj(o, tx * TILE, ty * TILE, t);
      }
      if (ty === pRow) drawPlayer(p, t);
    }
    if (pRow < ty0 || pRow > ty1) drawPlayer(p, t);
    drawFishingLine();

    // Build ghost
    if (s.build && hv && !s.dead) {
      const ok = inReach(hv.tx, hv.ty) && canPlace(s.build, hv.tx, hv.ty) && has(BUILD_BY_ID[s.build].cost);
      ctx.globalAlpha = 0.55;
      const gx = hv.tx * TILE, gy = hv.ty * TILE;
      if (s.build === 'floor') drawFloor(gx, gy);
      else if (s.build === 'boat') drawBoat(makeBoat(gx + 16, gy + 16, p.face), t);
      else drawObj(makeObj(s.build, () => 0.5), gx, gy, t);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#7ddc6a' : '#ff5a5a';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1, gy + 1, TILE - 2, TILE - 2);
    }

    // Floating texts
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of s.floats) {
      ctx.globalAlpha = clamp(1.1 - f.t, 0, 1);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawLighting(t);
    drawTensionMeter();

    // Red flash when taking damage
    if (p.hurt > 0) {
      ctx.fillStyle = `rgba(200,0,0,${p.hurt * 0.4})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  function drawGround(tx, ty, t) {
    const s = state;
    const g = s.ground[ty * W + tx];
    const x = tx * TILE, y = ty * TILE;
    const h = hash(tx, ty);
    if (g === WATER) {
      ctx.fillStyle = '#2f6fc4';
      ctx.fillRect(x, y, TILE, TILE);
      const w = Math.sin(t * 1.6 + tx * 0.7 + ty * 1.3);
      ctx.fillStyle = `rgba(255,255,255,${0.07 + 0.05 * w})`;
      ctx.fillRect(x + 4 + (h % 10), y + 12 + w * 2, 12, 2);
      // shoreline foam
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      if (ty > 0 && s.ground[(ty - 1) * W + tx] !== WATER) ctx.fillRect(x, y, TILE, 3);
      if (ty < H - 1 && s.ground[(ty + 1) * W + tx] !== WATER) ctx.fillRect(x, y + TILE - 3, TILE, 3);
      if (tx > 0 && s.ground[ty * W + tx - 1] !== WATER) ctx.fillRect(x, y, 3, TILE);
      if (tx < W - 1 && s.ground[ty * W + tx + 1] !== WATER) ctx.fillRect(x + TILE - 3, y, 3, TILE);
    } else if (g === SAND) {
      ctx.fillStyle = h % 3 ? '#dcc78f' : '#d6c088';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(150,120,70,0.25)';
      ctx.fillRect(x + (h % 23) + 3, y + ((h >> 5) % 23) + 3, 2, 2);
    } else {
      ctx.fillStyle = GRASS_COLORS[h % GRASS_COLORS.length];
      ctx.fillRect(x, y, TILE, TILE);
      if (h % 5 === 0) {
        ctx.strokeStyle = 'rgba(40,90,30,0.6)';
        ctx.lineWidth = 1;
        const gx = x + 6 + (h >> 4) % 20, gy = y + 10 + (h >> 8) % 16;
        ctx.beginPath();
        ctx.moveTo(gx, gy); ctx.lineTo(gx - 2, gy - 5);
        ctx.moveTo(gx, gy); ctx.lineTo(gx + 2, gy - 6);
        ctx.stroke();
      }
    }
  }

  function drawFloor(x, y) {
    ctx.fillStyle = '#b07c47';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#946233';
    for (let k = 0; k < 4; k++) ctx.fillRect(x, y + k * 8 + 7, TILE, 1);
    ctx.fillRect(x + ((y / TILE) % 2 ? 10 : 22), y, 1, TILE);
  }

  function shadow(cx, cy, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawObj(o, x, y, t) {
    const cx = x + TILE / 2;
    const shake = o.hit && performance.now() - o.hit < 150 ? Math.sin(performance.now() / 15) * 2 : 0;
    switch (o.type) {
      case 'tree': {
        const sc = 0.85 + o.v * 0.3;
        shadow(cx, y + 28, 13 * sc, 5);
        ctx.fillStyle = '#6b4423';
        ctx.fillRect(cx - 4, y + 10, 8, 18);
        const ox = cx + shake;
        circle(ox, y + 2, 16 * sc, '#2f6b2f');
        circle(ox - 7 * sc, y - 1, 11 * sc, '#3d8a3a');
        circle(ox + 7 * sc, y + 1, 10 * sc, '#3a8237');
        circle(ox - 3 * sc, y - 8 * sc, 8 * sc, '#4fa04a');
        if (o.hp < 4) {
          ctx.fillStyle = '#e8c38f';
          ctx.fillRect(cx - 4, y + 20, 8, 2 * (4 - o.hp));
        }
        break;
      }
      case 'rock': {
        shadow(cx, y + 27, 14, 5);
        const ox = cx + shake;
        ctx.fillStyle = '#7f858c';
        ctx.beginPath();
        ctx.moveTo(ox - 13, y + 26); ctx.lineTo(ox - 11, y + 12); ctx.lineTo(ox - 3, y + 5);
        ctx.lineTo(ox + 8, y + 7); ctx.lineTo(ox + 14, y + 17); ctx.lineTo(ox + 12, y + 26);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a3a9b1';
        ctx.beginPath();
        ctx.moveTo(ox - 9, y + 13); ctx.lineTo(ox - 3, y + 8); ctx.lineTo(ox + 6, y + 10); ctx.lineTo(ox - 1, y + 15);
        ctx.closePath(); ctx.fill();
        if (o.hp < 5) {
          ctx.strokeStyle = '#4d5157'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(ox + 2, y + 10); ctx.lineTo(ox, y + 16); ctx.lineTo(ox + 4, y + 20);
          if (o.hp < 3) { ctx.moveTo(ox, y + 16); ctx.lineTo(ox - 6, y + 22); }
          ctx.stroke();
        }
        break;
      }
      case 'bush': {
        shadow(cx, y + 27, 12, 4);
        circle(cx - 6, y + 20, 8, '#2e7d32');
        circle(cx + 6, y + 20, 8, '#2e7d32');
        circle(cx, y + 15, 10, '#388e3c');
        if (o.berries) {
          for (const [bx, by] of [[-6, 14], [4, 11], [7, 20], [-2, 21], [-9, 21], [1, 16]]) circle(cx + bx, y + by, 2.4, '#e53950');
        }
        break;
      }
      case 'stick': {
        const a = o.v * Math.PI;
        const cy = y + 18;
        ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 5);
        ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 5);
        ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 1.5);
        ctx.lineTo(cx + Math.cos(a) * 3 + 4, cy - 5);
        ctx.stroke();
        ctx.lineCap = 'butt';
        break;
      }
      case 'pebble': {
        shadow(cx, y + 22, 8, 3);
        circle(cx - 3, y + 19, 4.5, '#8d939a');
        circle(cx + 4, y + 21, 3.5, '#a2a8af');
        circle(cx - 4, y + 18, 1.5, '#c2c7cc');
        break;
      }
      case 'wall': {
        ctx.fillStyle = '#6e4521';
        ctx.fillRect(x, y + 4, TILE, TILE - 4);
        ctx.fillStyle = '#a8743d';
        ctx.fillRect(x, y - 8, TILE, 12);
        ctx.fillStyle = '#5b3a1c';
        for (let k = 1; k < 4; k++) ctx.fillRect(x + k * 8, y + 4, 1, TILE - 4);
        ctx.fillStyle = '#8f6131';
        ctx.fillRect(x, y + 4, TILE, 2);
        break;
      }
      case 'door': {
        ctx.fillStyle = '#5b3a1c';
        ctx.fillRect(x, y - 8, TILE, 4);
        ctx.fillRect(x, y - 8, 4, TILE + 8);
        ctx.fillRect(x + TILE - 4, y - 8, 4, TILE + 8);
        if (o.open) {
          ctx.fillStyle = '#9c6b3a';
          ctx.fillRect(x + 4, y - 4, 5, TILE + 4);
        } else {
          ctx.fillStyle = '#9c6b3a';
          ctx.fillRect(x + 4, y - 4, TILE - 8, TILE + 4);
          ctx.fillStyle = '#7d5229';
          ctx.fillRect(x + 4, y + 6, TILE - 8, 2);
          ctx.fillRect(x + 4, y + 18, TILE - 8, 2);
          circle(x + TILE - 9, y + 13, 2, '#e8c86a');
        }
        break;
      }
      case 'campfire': {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          circle(cx + Math.cos(a) * 11, y + 20 + Math.sin(a) * 6, 3.5, '#8d939a');
        }
        ctx.strokeStyle = '#5b3a1c'; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx - 8, y + 24); ctx.lineTo(cx + 8, y + 16);
        ctx.moveTo(cx - 8, y + 16); ctx.lineTo(cx + 8, y + 24);
        ctx.stroke();
        if (o.fuel > 0) {
          const f = 1 + Math.sin(t * 12 + o.v * 10) * 0.12;
          const size = 0.6 + 0.4 * Math.min(1, o.fuel / 120);
          ctx.fillStyle = '#ff7b22';
          ctx.beginPath();
          ctx.moveTo(cx - 8 * size, y + 20); ctx.quadraticCurveTo(cx, y + 20 - 26 * size * f, cx + 8 * size, y + 20);
          ctx.fill();
          ctx.fillStyle = '#ffd23f';
          ctx.beginPath();
          ctx.moveTo(cx - 4 * size, y + 20); ctx.quadraticCurveTo(cx, y + 20 - 15 * size * f, cx + 4 * size, y + 20);
          ctx.fill();
        } else {
          circle(cx, y + 20, 5, '#3a3a3a');
        }
        break;
      }
    }
  }

  function drawPlayer(p, t) {
    const bob = keys.size && !state.sleeping && !state.riding ? Math.sin((p.walk || 0) * 14) * 1.2 : 0;
    const x = p.x, y = p.y + bob;
    if (!state.riding) shadow(p.x, p.y + 11, 11, 4);

    // Tool swing
    if (p.swing > 0 || state.build) {
      const swingA = p.face + (p.swing > 0 ? (p.swing / 0.25 - 0.5) * 1.6 : 0);
      const hx = x + Math.cos(swingA) * 13, hy = y + Math.sin(swingA) * 13;
      ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
      if (p.lastTool && p.swing > 0) {
        circle(hx, hy, 4, '#9aa0a6');
      }
    }

    if (state.fishMode) {
      const tip = rodTip();
      const hx = x + Math.cos(p.face) * 7, hy = y + Math.sin(p.face) * 7 + 2;
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo((hx + tip.x) / 2, (hy + tip.y - tip.z) / 2 - 6, tip.x, tip.y - tip.z);
      ctx.stroke();
    }

    circle(x, y + 2, 11, state.sleeping ? '#5a6ea8' : '#3f6fd1');   // body / shirt
    circle(x, y - 3, 8, '#f1c27d');                                 // head
    ctx.fillStyle = '#5a3a1e';                                       // hair
    ctx.beginPath();
    ctx.arc(x, y - 4, 8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (state.sleeping) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('z', x + 12, y - 14 - Math.sin(t * 2) * 3);
    } else {
      const ex = Math.cos(p.face) * 3, ey = Math.sin(p.face) * 2;
      circle(x - 3 + ex, y - 3 + ey, 1.4, '#222');
      circle(x + 3 + ex, y - 3 + ey, 1.4, '#222');
    }
  }

  // Fish are dark shapes under the water; ripples sit on the surface.
  function drawFishes(t) {
    const s = state;
    for (const fish of s.fishes) {
      if (fish.x < camX - 40 || fish.x > camX + vw + 40 || fish.y < camY - 40 || fish.y > camY + vh + 40) continue;
      const len = 9 * fish.size, wid = 3.5 * fish.size;
      const hooked = fish.state === 'hooked';
      ctx.save();
      ctx.translate(fish.x, fish.y);
      ctx.rotate(fish.heading);
      ctx.fillStyle = hooked ? 'rgba(40,60,110,0.8)' : 'rgba(18,40,85,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(-len * 0.8, 0);
      ctx.rotate(Math.sin(t * (hooked ? 25 : 8) + fish.seed) * 0.4);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-len * 0.8, -wid * 1.2);
      ctx.lineTo(-len * 0.8, wid * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.lineWidth = 1.2;
    for (const r of s.ripples) {
      ctx.strokeStyle = `rgba(255,255,255,${(1 - r.t) * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 3 + r.t * 22, (3 + r.t * 22) * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawFishingLine() {
    const s = state, p = s.player, f = s.fishing;
    ctx.fillStyle = 'rgba(200,230,255,0.9)';
    for (const q of s.particles) ctx.fillRect(q.x - 1, q.y - q.z - 1, 2, 2);
    if (!f) return;

    if (f.phase === 'charge') {
      // Power meter over your head and a dotted preview of the throw.
      const mx = p.x - 18, my = p.y - 36;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(mx - 1, my - 1, 38, 7);
      ctx.fillStyle = `hsl(${120 - f.charge * 120}, 80%, 55%)`;
      ctx.fillRect(mx, my, 36 * f.charge, 5);
      const tip = rodTip();
      const sp = 140 + f.charge * 360, vz = 110 + f.charge * 150;
      const flight = (vz + Math.sqrt(vz * vz + 2 * FISH_GRAVITY * tip.z)) / FISH_GRAVITY;
      const cos = Math.cos(p.face), sin = Math.sin(p.face);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      for (let k = 1; k < 12; k++) {
        const u = (flight * k) / 12;
        const z = tip.z + vz * u - 0.5 * FISH_GRAVITY * u * u;
        circle(tip.x + cos * sp * u, tip.y + sin * sp * u - z, 1.5, 'rgba(255,255,255,0.65)');
      }
      const lx = tip.x + cos * sp * flight, ly = tip.y + sin * sp * flight;
      ctx.strokeStyle = isWaterPx(lx, ly) ? 'rgba(140,215,255,0.95)' : 'rgba(255,140,140,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(lx, ly, 7, 3.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    // Line
    const pts = f.rope;
    ctx.strokeStyle = f.tension > 0.85 ? 'rgba(255,120,120,0.95)' : 'rgba(245,245,245,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - pts[0].z);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y - pts[i].z);
    ctx.stroke();

    // Bobber (fades as it's pulled under)
    const by = f.by - Math.max(0, f.bz);
    if (f.bz > 2) shadow(f.bx, f.by + 2, 4, 1.5);
    ctx.globalAlpha = 1 - clamp(-f.bz / 6, 0, 1) * 0.75;
    circle(f.bx, by, 4, '#f4f4f4');
    ctx.fillStyle = '#e23b3b';
    ctx.beginPath();
    ctx.arc(f.bx, by, 4, Math.PI, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawTensionMeter() {
    const f = state.fishing;
    if (!f || !f.fish || f.fish.state !== 'hooked') return;
    const w = 240, x = vw / 2 - w / 2, y = vh - 150;
    ctx.fillStyle = 'rgba(20,22,28,0.75)';
    ctx.fillRect(x - 10, y - 26, w + 20, 46);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = f.fish.running ? '#ffcf7a' : '#9be38f';
    ctx.fillText(f.fish.running ? "🐟 It's running! Let go!" : "🐟 It's resting. Reel in!", x, y - 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${Math.max(0, Math.round((MAX_LINE - f.L) / TILE))} m of line left`, x + w, y - 9);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, y, w, 9);
    ctx.fillStyle = f.tension > 1 ? '#ff4d4d' : f.tension > 0.75 ? '#ffc04d' : '#6ddc6a';
    ctx.fillRect(x, y, (w * clamp(f.tension, 0, 1.2)) / 1.2, 9);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + w / 1.2 - 1, y - 3, 2, 15);   // snap point
  }

  function drawLighting(t) {
    const d = darkness();
    if (d < 0.01) return;
    const s = state, p = s.player;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, vw, vh);
    lctx.fillStyle = `rgba(6,10,32,${d})`;
    lctx.fillRect(0, 0, vw, vh);
    lctx.globalCompositeOperation = 'destination-out';

    const light = (x, y, r) => {
      const g = lctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.arc(x, y, r, 0, Math.PI * 2);
      lctx.fill();
    };
    light(p.x - camX, p.y - camY, 95);

    const fires = [];
    const m = 8;
    const tx0 = Math.max(0, Math.floor(camX / TILE) - m), tx1 = Math.min(W - 1, Math.floor((camX + vw) / TILE) + m);
    const ty0 = Math.max(0, Math.floor(camY / TILE) - m), ty1 = Math.min(H - 1, Math.floor((camY + vh) / TILE) + m);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = s.obj[ty * W + tx];
        if (o && o.type === 'campfire' && o.fuel > 0) {
          const fx = tx * TILE + 16 - camX, fy = ty * TILE + 16 - camY;
          const r = (150 + 70 * Math.min(1, o.fuel / 120)) * (1 + Math.sin(t * 9 + o.v * 7) * 0.03);
          light(fx, fy, r);
          fires.push([fx, fy, r]);
        }
      }

    lctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lightCanvas, 0, 0);
    ctx.restore();

    // Warm glow around fires
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fy, r] of fires) {
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 0.7);
      g.addColorStop(0, `rgba(255,140,40,${0.22 * d})`);
      g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fx, fy, r * 0.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function floatText(x, y, text, color) {
    state.floats.push({ x, y, text, color, t: 0 });
  }

  // ---------------------------------------------------------------------------
  // DOM UI
  // ---------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const logEl = $('log');
  const hotbarEl = $('hotbar');
  const buildbarEl = $('buildbar');
  const recipesEl = $('recipes');
  const bars = {
    hp: $('bar-health'), hunger: $('bar-hunger'), thirst: $('bar-thirst'),
  };
  const msgThrottle = new Map();

  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  const isOpen = id => !$(id).classList.contains('hidden');

  function addMsg(text, kind = '') {
    const el = document.createElement('div');
    el.textContent = text;
    if (kind) el.className = kind;
    logEl.appendChild(el);
    while (logEl.children.length > 6) logEl.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; }, 5500);
    setTimeout(() => el.remove(), 6200);
  }

  // Show a message at most once every `cooldown` seconds of real time.
  function msgOnce(key, text, cooldown, kind) {
    const now = performance.now();
    if ((msgThrottle.get(key) || 0) > now) return;
    msgThrottle.set(key, now + cooldown * 1000);
    addMsg(text, kind);
  }

  function updateHud() {
    const s = state, p = s.player;
    for (const [key, el] of Object.entries(bars)) {
      const v = clamp(p[key], 0, 100);
      el.querySelector('.fill').style.width = v + '%';
      el.querySelector('.val').textContent = Math.ceil(v);
      el.classList.toggle('low', v < 25);
    }
    const phase = dayPhase();
    const mins = Math.floor(phase * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(Math.floor(mins % 60 / 10) * 10).padStart(2, '0');
    $('day').textContent = `${isNight() ? '🌙' : '☀️'} Day ${dayNumber()} · ${hh}:${mm}`;
    let status = '';
    if (s.sheltered) status = '<span class="safe">🏠 Sheltered</span>';
    else if (s.nearFire) status = '<span class="warm">🔥 Warm by the fire</span>';
    else if (s.cold) status = '<span class="cold">❄️ Freezing</span>';
    else if (isNight()) status = '<span class="cold">Cold night</span>';
    const modes = [];
    if (s.build) modes.push('🔨 Build mode');
    if (s.fishMode) modes.push('🎣 Fishing');
    if (s.riding) modes.push('🛶 Boating');
    if (modes.length) status += (status ? ' · ' : '') + modes.join(' · ');
    const st = $('status');
    if (st.innerHTML !== status) st.innerHTML = status;
    show('sleep', s.sleeping);

    if (invDirty) {
      invDirty = false;
      renderHotbar();
      if (isOpen('craft')) renderCraft();
      if (s.build) renderBuildBar();
    }
  }

  function renderHotbar() {
    const s = state;
    hotbarEl.innerHTML = '';
    let any = false;
    for (const [id, t] of Object.entries(TOOLS)) {
      if (s.tools[id] <= 0) continue;
      any = true;
      const el = document.createElement('div');
      el.className = 'slot' + (id === 'rod' ? ' clickable' + (s.fishMode ? ' active' : '') : '');
      el.innerHTML = `${t.icon}<div class="dur"><i style="width:${(s.tools[id] / TOOL_DURABILITY) * 100}%"></i></div><span class="tip">${t.name} (${s.tools[id]}/${TOOL_DURABILITY})${id === 'rod' ? ' · R or click to fish' : ''}</span>`;
      if (id === 'rod') el.addEventListener('click', toggleFishing);
      hotbarEl.appendChild(el);
    }
    for (const id of ITEM_ORDER) {
      const n = count(id);
      if (n <= 0) continue;
      any = true;
      const it = ITEMS[id];
      const el = document.createElement('div');
      el.className = 'slot' + (it.food ? ' food' : '');
      el.innerHTML = `${it.icon}<span class="count">${n}</span><span class="tip">${it.name}${it.food ? ' (click to eat)' : ''}</span>`;
      if (it.food) el.addEventListener('click', () => eat(id));
      hotbarEl.appendChild(el);
    }
    if (!any) hotbarEl.innerHTML = '<div class="empty-hint">Your inventory is empty. Click sticks and pebbles to pick them up.</div>';
  }

  function costHtml(cost) {
    return Object.entries(cost).map(([k, v]) => {
      const ok = count(k) >= v;
      return `<span class="${ok ? '' : 'miss'}">${ITEMS[k].icon} ${count(k)}/${v}</span>`;
    }).join(' &nbsp; ');
  }

  function renderCraft() {
    recipesEl.innerHTML = '';
    for (const r of RECIPES) {
      const el = document.createElement('div');
      el.className = 'recipe';
      const owned = r.tool && state.tools[r.tool] > 0 ? ` (you have one: ${state.tools[r.tool]}/${TOOL_DURABILITY})` : '';
      el.innerHTML = `<div class="ic">${r.icon}</div>
        <div class="info"><div class="name">${r.name}</div><div class="desc">${r.desc}${owned}</div><div class="cost">${costHtml(r.cost)}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Craft';
      btn.disabled = !has(r.cost);
      btn.addEventListener('click', () => craft(r));
      el.appendChild(btn);
      recipesEl.appendChild(el);
    }
  }

  function renderBuildBar() {
    if (!state || !state.build) { show('buildbar', false); return; }
    show('buildbar', true);
    buildbarEl.innerHTML = '';
    BUILDS.forEach((b, idx) => {
      const el = document.createElement('div');
      el.className = 'bopt' + (state.build === b.id ? ' sel' : '') + (has(b.cost) ? '' : ' no');
      el.innerHTML = `<div class="ic">${b.icon}</div><div><span class="key">${idx + 1}</span> ${b.name}</div><div>${costHtml(b.cost)}</div>`;
      el.addEventListener('click', () => { state.build = b.id; renderBuildBar(); });
      buildbarEl.appendChild(el);
    });
  }

  function toggleBuild() {
    state.build = state.build ? null : 'wall';
    if (state.build) {
      if (state.fishMode) toggleFishing();
      show('craft', false);
      msgOnce('buildhelp', 'Build mode: press 1–5 to choose, click to place, right-click to remove. B or Esc to exit.', 30);
    }
    renderBuildBar();
  }

  function toggleCraft() {
    const open = !isOpen('craft');
    show('craft', open);
    show('help', false);
    if (open) renderCraft();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let paused = false;

  function setPaused(on) {
    if (on && (!state || state.dead || isOpen('title'))) return;
    paused = on;
    show('paused', on);
    keys.clear();
    mouse.down = false;
  }

  window.addEventListener('keydown', e => {
    if (!state || state.dead || isOpen('title')) return;
    if (paused) {
      if (e.code === 'KeyP' || e.code === 'Escape') setPaused(false);
      return;
    }
    if (e.code === 'KeyP') { setPaused(true); return; }
    if (e.code === 'Escape' && !isOpen('craft') && !isOpen('help') && !state.build && !state.fishMode) { setPaused(true); return; }
    if (state.sleeping) {
      state.sleeping = false;
      addMsg('You wake up.');
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyC': toggleCraft(); break;
      case 'KeyB': toggleBuild(); break;
      case 'KeyH': show('help', !isOpen('help')); show('craft', false); break;
      case 'KeyF': eatBest(); break;
      case 'KeyE': drinkNearby(); break;
      case 'KeyZ': trySleep(); break;
      case 'KeyR': toggleFishing(); break;
      case 'Escape':
        show('craft', false); show('help', false);
        if (state.build) { state.build = null; renderBuildBar(); }
        if (state.fishMode) toggleFishing();
        break;
      case 'Space': if (state.riding) leaveBoat(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        if (state.build) { state.build = BUILDS[+e.code.slice(5) - 1].id; renderBuildBar(); }
        break;
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; setPaused(true); });

  canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', e => {
    if (!state || state.dead) return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.button === 2) {
      const t = hoverTile();
      if (t && !state.sleeping) deconstruct(t.tx, t.ty);
      return;
    }
    if (e.button !== 0) return;
    mouse.shift = e.shiftKey;
    mouse.down = true;
    mouse.pressed = true;
    state.player.cooldown = Math.min(state.player.cooldown, 0);
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  $('start').addEventListener('click', () => {
    show('title', false);
    show('hud', true);
    newGame();
  });
  function restart() {
    setPaused(false);
    show('gameover', false);
    show('craft', false);
    show('help', false);
    newGame();
  }
  $('restart').addEventListener('click', restart);
  $('pause-restart').addEventListener('click', restart);
  $('pause-btn').addEventListener('click', e => { setPaused(!paused); e.currentTarget.blur(); });
  $('resume').addEventListener('click', () => setPaused(false));

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  // A world to look at behind the title screen.
  newGame();
  logEl.innerHTML = '';

  let last = performance.now();
  let hudAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const playing = state && !state.dead && !isOpen('title') && !paused;
    if (playing) update(dt);
    render(now);
    hudAcc += dt;
    if (playing && hudAcc > 0.05) { hudAcc = 0; updateHud(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Test hook: open index.html?debug to poke at the game from the console.
  if (location.search.includes('debug')) {
    window.__game = { get state() { return state; }, get cam() { return [camX, camY]; }, mouse, keys, give, toggleFishing, isWaterPx, makeBoat, boardBoat, leaveBoat };
  }
})();
