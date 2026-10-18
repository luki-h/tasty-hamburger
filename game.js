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
  };
  const ITEM_ORDER = ['wood', 'stick', 'pebble', 'stone', 'berries', 'pie'];

  const TOOLS = {
    axe:     { name: 'Stone Axe',     icon: '🪓' },
    pickaxe: { name: 'Stone Pickaxe', icon: '⛏️' },
  };

  const RECIPES = [
    { id: 'axe',     name: 'Stone Axe',     icon: '🪓', cost: { stick: 3, pebble: 2 }, desc: 'Chop trees for wood.', tool: 'axe' },
    { id: 'pickaxe', name: 'Stone Pickaxe', icon: '⛏️', cost: { stick: 3, pebble: 3 }, desc: 'Mine rocks for stone.', tool: 'pickaxe' },
    { id: 'pie',     name: 'Berry Pie',     icon: '🥧', cost: { berries: 3 }, desc: '+60 hunger. Needs a lit campfire nearby.', item: 'pie', fire: true },
  ];

  const BUILDS = [
    { id: 'wall',     name: 'Wall',     icon: '🟫', cost: { wood: 2 } },
    { id: 'floor',    name: 'Floor',    icon: '🟧', cost: { wood: 1 } },
    { id: 'door',     name: 'Door',     icon: '🚪', cost: { wood: 3 } },
    { id: 'campfire', name: 'Campfire', icon: '🔥', cost: { wood: 3, stone: 2 } },
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
      tools: { axe: 0, pickaxe: 0 },
      time: DAY_LENGTH * 0.26,
      build: null,
      floats: [],
      sheltered: false, nearFire: false, cold: false,
      shelterTimer: 0, tickAcc: 0, respawnAcc: 0,
      sleeping: false,
      dead: false,
      lastDay: 1,
    };
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
    if (count('pie') > 0) return eat('pie');
    if (count('berries') > 0) return eat('berries');
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
  const mouse = { x: 0, y: 0, down: false, shift: false };
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
    else state.obj[i] = makeObj(b.id, Math.random);
    renderBuildBar();
    return true;
  }

  function deconstruct(tx, ty) {
    if (!inReach(tx, ty)) { msgOnce('reach', 'Too far away. Move closer.', 2); return; }
    const i = ty * W + tx;
    const o = state.obj[i];
    const cx = tx * TILE + 16, cy = ty * TILE + 4;
    if (o && STRUCTURES.has(o.type)) {
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
    state.sleeping = true;
    mouse.down = false;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    const s = state, p = s.player;
    const timeMul = s.sleeping ? 10 : 1;
    s.time += dt * timeMul;

    // Movement
    if (!s.sleeping) {
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
    if (mouse.down && p.cooldown <= 0 && !s.sleeping) act();

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

    // Hover highlight
    const hv = hoverTile();
    if (hv && !s.sleeping && !s.dead) {
      const ok = inReach(hv.tx, hv.ty);
      if (!s.build) {
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

    // Build ghost
    if (s.build && hv && !s.dead) {
      const ok = inReach(hv.tx, hv.ty) && canPlace(s.build, hv.tx, hv.ty) && has(BUILD_BY_ID[s.build].cost);
      ctx.globalAlpha = 0.55;
      const gx = hv.tx * TILE, gy = hv.ty * TILE;
      if (s.build === 'floor') drawFloor(gx, gy);
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
    const bob = keys.size && !state.sleeping ? Math.sin((p.walk || 0) * 14) * 1.2 : 0;
    const x = p.x, y = p.y + bob;
    shadow(p.x, p.y + 11, 11, 4);

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
    if (s.build) status += ' · 🔨 Build mode';
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
      el.className = 'slot';
      el.innerHTML = `${t.icon}<div class="dur"><i style="width:${(s.tools[id] / TOOL_DURABILITY) * 100}%"></i></div><span class="tip">${t.name} (${s.tools[id]}/${TOOL_DURABILITY})</span>`;
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
      show('craft', false);
      msgOnce('buildhelp', 'Build mode: press 1–4 to choose, click to place, right-click to remove. B or Esc to exit.', 30);
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
    if (e.code === 'Escape' && !isOpen('craft') && !isOpen('help') && !state.build) { setPaused(true); return; }
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
      case 'Escape':
        show('craft', false); show('help', false);
        if (state.build) { state.build = null; renderBuildBar(); }
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
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
})();
