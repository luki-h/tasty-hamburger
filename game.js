(() => {
  'use strict';

  if (typeof THREE === 'undefined') {
    document.getElementById('load-error').classList.remove('hidden');
    document.getElementById('start').disabled = true;
    return;
  }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const W = 96, D = 96, H = 40;  // world size in blocks: x, z, y
  const SEA = 12;
  const CHUNK = 16;
  const NCX = W / CHUNK, NCZ = D / CHUNK;
  const REACH = 5;

  const DAY_LENGTH = 300;        // seconds for a full day/night cycle
  const TOOL_DURABILITY = 60;
  const FIRE_MAX = 300;

  const HUNGER_RATE = 0.16;      // per second
  const THIRST_RATE = 0.22;
  const STARVE_DMG = 1.0;
  const DEHYDRATE_DMG = 1.5;
  const COLD_DMG = 0.4;
  const REGEN = 0.8;

  const PLAYER_W = 0.3;          // half width
  const PLAYER_H = 1.8;
  const EYE = 1.62;
  const WALK = 4.3, SPRINT = 5.8;
  const GRAVITY = 28, JUMP = 8.6;

  // Block ids
  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WATER = 5, LOG = 6, LEAVES = 7,
    PLANKS = 8, COBBLE = 9, GRAVEL = 10, BUSH = 11, BUSH_EMPTY = 12, DOOR = 13, CAMPFIRE = 14, BEDROCK = 15;

  // Atlas tile per face: [+x, -x, +y, -y, +z, -z]
  const BLOCK_TEX = {
    [GRASS]: [1, 1, 0, 2, 1, 1],
    [DIRT]: 2, [STONE]: 3, [SAND]: 4, [WATER]: 5,
    [LOG]: [6, 6, 7, 7, 6, 6],
    [LEAVES]: 8, [PLANKS]: 9, [COBBLE]: 10, [GRAVEL]: 11, [BEDROCK]: 12,
    [BUSH]: 13, [BUSH_EMPTY]: 14,
  };
  const texOf = (id, face) => {
    const t = BLOCK_TEX[id];
    return Array.isArray(t) ? t[face] : t;
  };

  const BLOCK_NAMES = {
    [GRASS]: 'Grass', [DIRT]: 'Dirt', [STONE]: 'Stone', [SAND]: 'Sand', [LOG]: 'Log', [LEAVES]: 'Leaves',
    [PLANKS]: 'Planks', [COBBLE]: 'Cobblestone', [GRAVEL]: 'Gravel', [BUSH]: 'Berry Bush',
    [BUSH_EMPTY]: 'Bush (no berries)', [DOOR]: 'Door', [CAMPFIRE]: 'Campfire', [BEDROCK]: 'Bedrock',
  };

  const OPAQUE = new Set([GRASS, DIRT, STONE, SAND, LOG, PLANKS, COBBLE, GRAVEL, BEDROCK]);
  const SOLID = new Set([GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, COBBLE, GRAVEL, BEDROCK, CAMPFIRE]);
  const NEEDS_SUPPORT = new Set([BUSH, BUSH_EMPTY, DOOR, CAMPFIRE]);

  // Seconds to break by hand / with the right tool. `tool` = required tool.
  const BREAK = {
    [GRASS]: { t: 0.6 }, [DIRT]: { t: 0.5 }, [SAND]: { t: 0.5 }, [GRAVEL]: { t: 0.6 },
    [LEAVES]: { t: 0.2 }, [BUSH_EMPTY]: { t: 0.3 }, [DOOR]: { t: 0.8 }, [CAMPFIRE]: { t: 0.6 },
    [PLANKS]: { t: 1.0, fast: 'axe' },
    [LOG]: { t: 1.1, tool: 'axe' },
    [STONE]: { t: 1.5, tool: 'pickaxe' },
    [COBBLE]: { t: 1.5, tool: 'pickaxe' },
  };

  const ITEMS = {
    dirt:     { name: 'Dirt',        tile: 2,  place: DIRT },
    sand:     { name: 'Sand',        tile: 4,  place: SAND },
    log:      { name: 'Log',         tile: 6,  place: LOG },
    planks:   { name: 'Planks',      tile: 9,  place: PLANKS },
    cobble:   { name: 'Cobblestone', tile: 10, place: COBBLE },
    door:     { name: 'Door',        icon: '🚪', place: DOOR },
    campfire: { name: 'Campfire',    icon: '🔥', place: CAMPFIRE },
    stick:    { name: 'Stick',       icon: '🥢' },
    pebble:   { name: 'Pebble',      icon: '🪨' },
    berries:  { name: 'Berries',     icon: '🍒', food: { hunger: 15, thirst: 4 } },
    pie:      { name: 'Berry Pie',   icon: '🥧', food: { hunger: 60, thirst: 0 } },
  };

  const TOOLS = {
    axe:     { name: 'Stone Axe',     icon: '🪓' },
    pickaxe: { name: 'Stone Pickaxe', icon: '⛏️' },
  };

  const RECIPES = [
    { name: 'Planks',        out: 'planks', n: 4, cost: { log: 1 }, desc: 'Building blocks made from a log.' },
    { name: 'Sticks',        out: 'stick',  n: 4, cost: { planks: 2 }, desc: 'Split planks into sticks.' },
    { name: 'Stone Axe',     tool: 'axe',     cost: { stick: 3, pebble: 2 }, desc: 'Chop logs from trees.' },
    { name: 'Stone Pickaxe', tool: 'pickaxe', cost: { stick: 3, pebble: 3 }, desc: 'Mine stone and cobblestone.' },
    { name: 'Door',          out: 'door', n: 1, cost: { planks: 6 }, desc: 'Right-click to open and close.' },
    { name: 'Campfire',      out: 'campfire', n: 1, cost: { stick: 3, log: 2, pebble: 3 }, desc: 'Keeps you warm at night and lets you cook.' },
    { name: 'Pebbles',       out: 'pebble', n: 2, cost: { cobble: 1 }, desc: 'Smash cobblestone into pebbles.' },
    { name: 'Berry Pie',     out: 'pie', n: 1, cost: { berries: 3 }, desc: '+60 hunger. Needs a lit campfire nearby.', fire: true },
  ];

  // Cube faces in the order [+x, -x, +y, -y, +z, -z]. Corners go bottom-left,
  // bottom-right, top-right, top-left as seen from outside the block.
  const FACES = [
    { dir: [1, 0, 0],  corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { dir: [0, 1, 0],  corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { dir: [0, 0, 1],  corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  ];
  const FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const AO_LEVELS = [0.45, 0.65, 0.82, 1];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

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

  // ---------------------------------------------------------------------------
  // Pixel-art textures (generated, 16x16 per tile, 4x4 atlas)
  // ---------------------------------------------------------------------------
  function makeAtlas() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(64, 64);
    const rand = mulberry32(1234);
    const vary = (rgb, amt) => {
      const f = 1 + (rand() - 0.5) * amt;
      return rgb.map(v => clamp(Math.round(v * f), 0, 255));
    };
    const tiles = [];
    // 0 grass top
    tiles[0] = () => [...vary([95, 159, 53], 0.3), 255];
    // 1 grass side
    tiles[1] = (i, j) => (j < 3 || (j === 3 && rand() < 0.5))
      ? [...vary([95, 159, 53], 0.3), 255]
      : [...vary(rand() < 0.08 ? [100, 72, 50] : [134, 96, 67], 0.3), 255];
    // 2 dirt
    tiles[2] = () => [...vary(rand() < 0.08 ? [100, 72, 50] : [134, 96, 67], 0.3), 255];
    // 3 stone
    tiles[3] = () => [...vary(rand() < 0.1 ? [96, 96, 96] : [128, 128, 128], 0.18), 255];
    // 4 sand
    tiles[4] = () => [...vary([219, 207, 142], 0.12), 255];
    // 5 water
    tiles[5] = () => [...vary([52, 104, 214], 0.15), 255];
    // 6 log side
    tiles[6] = i => [...vary(i % 4 === 0 ? [78, 60, 36] : [104, 82, 51], 0.18), 255];
    // 7 log top
    tiles[7] = (i, j) => {
      const d = Math.max(Math.abs(i - 7.5), Math.abs(j - 7.5));
      if (d > 6.5) return [...vary([104, 82, 51], 0.15), 255];
      return [...vary((d | 0) % 2 ? [176, 142, 86] : [150, 118, 68], 0.08), 255];
    };
    // 8 leaves (with see-through holes)
    tiles[8] = () => rand() < 0.16 ? [0, 0, 0, 0] : [...vary([58, 122, 40], 0.4), 255];
    // 9 planks
    tiles[9] = (i, j) => {
      const seam = (((j / 4) | 0) % 2) ? 7 : 15;
      if (j % 4 === 3 || i === seam) return [...vary([112, 88, 52], 0.08), 255];
      return [...vary([168, 135, 82], 0.1), 255];
    };
    // 10 cobblestone (rough cells with dark mortar)
    const pts = Array.from({ length: 9 }, () => [rand() * 16, rand() * 16]);
    tiles[10] = (i, j) => {
      const ds = pts.map(([px, py]) => {
        const dx = Math.min(Math.abs(i - px), 16 - Math.abs(i - px));
        const dy = Math.min(Math.abs(j - py), 16 - Math.abs(j - py));
        return Math.hypot(dx, dy);
      }).sort((a, b) => a - b);
      if (ds[1] - ds[0] < 1.1) return [...vary([70, 70, 70], 0.2), 255];
      return [...vary([130, 130, 130], 0.22), 255];
    };
    // 11 gravel
    const gravel = [[132, 125, 120], [100, 96, 94], [152, 142, 132], [116, 106, 96]];
    tiles[11] = () => [...vary(gravel[(rand() * 4) | 0], 0.1), 255];
    // 12 bedrock
    tiles[12] = () => [...vary([62, 62, 62], 0.8), 255];
    // 13 berry bush, 14 empty bush
    tiles[13] = () => rand() < 0.09 ? [...vary([214, 38, 58], 0.2), 255] : [...vary([46, 112, 40], 0.4), 255];
    tiles[14] = () => [...vary([46, 112, 40], 0.4), 255];
    // 15 door wood
    tiles[15] = (i, j) => (i === 0 || i === 15 || j === 0 || j === 15)
      ? [...vary([92, 66, 38], 0.1), 255]
      : [...vary([140, 102, 60], 0.12), 255];

    for (let t = 0; t < 16; t++) {
      const ox = (t % 4) * 16, oy = ((t / 4) | 0) * 16;
      for (let j = 0; j < 16; j++)
        for (let i = 0; i < 16; i++) {
          const [r, gg, b, a] = tiles[t](i, j);
          const p = ((oy + j) * 64 + ox + i) * 4;
          img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = b; img.data[p + 3] = a;
        }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function makeDoorCanvas() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 32;
    const g = c.getContext('2d');
    const rand = mulberry32(77);
    for (let j = 0; j < 32; j++)
      for (let i = 0; i < 16; i++) {
        const frame = i < 2 || i > 13 || j < 2 || j > 29 || j === 15 || j === 16;
        const window = j > 4 && j < 12 && i > 4 && i < 11;
        let rgb = frame ? [98, 70, 40] : window ? [70, 52, 30] : [150, 110, 64];
        const f = 1 + (rand() - 0.5) * 0.15;
        g.fillStyle = `rgb(${rgb.map(v => Math.round(v * f)).join(',')})`;
        g.fillRect(i, j, 1, 1);
      }
    g.fillStyle = '#e8c86a';
    g.fillRect(12, 17, 2, 2);
    return c;
  }

  const atlasCanvas = makeAtlas();
  const doorCanvas = makeDoorCanvas();

  function tileUV(tile, u, v) {
    const eps = 0.002;
    const col = tile % 4, row = (tile / 4) | 0;
    return [col / 4 + eps + u * (0.25 - 2 * eps), 1 - (row + 1) / 4 + eps + v * (0.25 - 2 * eps)];
  }

  const iconCache = {};
  function itemIcon(id) {
    const it = ITEMS[id];
    if (it.tile === undefined) return `<span>${it.icon}</span>`;
    if (!iconCache[id]) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const col = it.tile % 4, row = (it.tile / 4) | 0;
      c.getContext('2d').drawImage(atlasCanvas, col * 16, row * 16, 16, 16, 0, 0, 16, 16);
      iconCache[id] = c.toDataURL();
    }
    return `<img src="${iconCache[id]}" alt="">`;
  }

  // ---------------------------------------------------------------------------
  // Three.js setup
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.magFilter = atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  const doorTex = new THREE.CanvasTexture(doorCanvas);
  doorTex.magFilter = doorTex.minFilter = THREE.NearestFilter;
  doorTex.generateMipmaps = false;

  const terrainMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
  const waterMat = new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
  });

  const skyDay = new THREE.Color(0x87b8ff), skyNight = new THREE.Color(0x070b1c), skyDusk = new THREE.Color(0xf08a4b);
  scene.background = skyDay.clone();
  scene.fog = new THREE.Fog(scene.background, 28, 72);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);
  scene.add(sunLight, sunLight.target);

  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false }));
  const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
  scene.add(sunMesh, moonMesh);

  const starGeo = new THREE.BufferGeometry();
  {
    const r = mulberry32(5), pos = [];
    for (let i = 0; i < 600; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(r() * 2 - 1);
      pos.push(Math.sin(ph) * Math.cos(th) * 200, Math.abs(Math.cos(ph)) * 200, Math.sin(ph) * Math.sin(th) * 200);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Ocean around the island: four big water planes outside the world edges.
  {
    const oceanMat = new THREE.MeshLambertMaterial({ color: 0x3468d6, transparent: true, opacity: 0.85 });
    const y = SEA + 0.88, E = 400;
    for (const [x0, z0, x1, z1] of [[-E, -E, W + E, 0], [-E, D, W + E, D + E], [-E, 0, 0, D], [W, 0, W + E, D]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), oceanMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      scene.add(m);
    }
  }

  // Up to four campfires light their surroundings at a time.
  const fireLights = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xff9a40, 0, 13, 1.2);
    scene.add(l);
    fireLights.push(l);
  }

  // Block selection outline and crack overlay
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }),
  );
  outline.visible = false;
  scene.add(outline);
  const crack = new THREE.Mesh(
    new THREE.BoxGeometry(1.01, 1.01, 1.01),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
  );
  crack.visible = false;
  scene.add(crack);

  // A cube geometry textured from the atlas (used for the block in your hand).
  function blockGeometry(id) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++)
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const [u, v] = tileUV(texOf(id, f), uv.getX(i), uv.getY(i));
        uv.setXY(i, u, v);
      }
    const colors = new Float32Array(geo.attributes.position.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  // First-person hand
  const hand = new THREE.Group();
  hand.position.set(0.5, -0.5, -0.5);
  camera.add(hand);
  const handMatOpts = { depthTest: false };
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.8), new THREE.MeshLambertMaterial({ color: 0xd9a066, ...handMatOpts }));
  arm.rotation.set(0.35, 0.25, 0);
  arm.position.set(0, -0.05, 0.12);
  arm.renderOrder = 10;
  hand.add(arm);
  const heldMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, ...handMatOpts });
  const heldGeos = {};
  const held = new THREE.Mesh(blockGeometry(DIRT), heldMat);
  held.scale.setScalar(0.22);
  held.position.set(-0.12, 0.16, -0.3);
  held.rotation.set(0.2, 0.7, 0);
  held.renderOrder = 11;
  hand.add(held);
  const heldEmojiMat = new THREE.MeshBasicMaterial({ transparent: true, ...handMatOpts });
  const heldEmoji = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), heldEmojiMat);
  heldEmoji.position.set(-0.12, 0.18, -0.3);
  heldEmoji.renderOrder = 11;
  hand.add(heldEmoji);
  const emojiTextures = {};
  function emojiTexture(ch) {
    if (!emojiTextures[ch]) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.font = '52px serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, 32, 36);
      emojiTextures[ch] = new THREE.CanvasTexture(c);
    }
    return emojiTextures[ch];
  }

  // ---------------------------------------------------------------------------
  // World data
  // ---------------------------------------------------------------------------
  let state = null;
  let world = new Uint8Array(W * D * H);
  const idx = (x, y, z) => (y * D + z) * W + x;

  function get(x, y, z) {
    if (y < 0) return BEDROCK;
    if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return AIR;
    return world[idx(x, y, z)];
  }

  function setBlock(x, y, z, id) {
    world[idx(x, y, z)] = id;
    markDirty(x, z);
  }

  function isSolid(x, y, z) {
    if (x < 0 || z < 0 || x >= W || z >= D) return true;   // invisible world border
    const id = get(x, y, z);
    if (id === DOOR) { const d = doorAt(x, y, z); return !(d && d.open); }
    return SOLID.has(id);
  }

  function surfaceY(x, z) {
    for (let y = H - 1; y >= 0; y--) {
      const id = world[idx(x, y, z)];
      if (id !== AIR && id !== LEAVES) return y;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // World generation
  // ---------------------------------------------------------------------------
  function generate(seed) {
    const rand = mulberry32(seed);
    const n1 = makeNoise(rand), n2 = makeNoise(rand), n3 = makeNoise(rand);
    world = new Uint8Array(W * D * H);
    const heights = new Int16Array(W * D);

    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        let e = fbm(n1, x / 26, z / 26);
        const edge = Math.max(Math.abs(x / W - 0.5), Math.abs(z / D - 0.5)) * 2;
        e -= Math.max(0, edge - 0.62) * 1.5;
        const m = fbm(n3, x / 18, z / 18);
        const h = clamp(Math.floor(SEA + 2 + (e - 0.5) * 30 + Math.max(0, m - 0.56) * 40), 3, H - 12);
        heights[z * W + x] = h;

        world[idx(x, 0, z)] = BEDROCK;
        const beach = h <= SEA + 1;
        const rocky = h >= SEA + 11;
        for (let y = 1; y <= h; y++) {
          let id;
          if (y === h) id = beach ? SAND : rocky ? STONE : GRASS;
          else if (y >= h - 3) id = beach ? (y >= h - 1 ? SAND : DIRT) : rocky ? STONE : DIRT;
          else id = STONE;
          world[idx(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) world[idx(x, y, z)] = WATER;
      }

    // Surface features
    const trees = [];
    for (let z = 2; z < D - 2; z++)
      for (let x = 2; x < W - 2; x++) {
        const h = heights[z * W + x];
        const top = world[idx(x, h, z)];
        if (top === GRASS) {
          const f = fbm(n2, x / 12, z / 12);
          const r = rand();
          if (r < clamp((f - 0.45) * 0.45, 0, 0.12) + 0.006) trees.push([x, h + 1, z]);
          else if (r < 0.2 && rand() < 0.06) world[idx(x, h + 1, z)] = BUSH;
          else if (rand() < 0.012) world[idx(x, h, z)] = GRAVEL;
          else if (rand() < 0.003) boulder(x, h + 1, z, rand);
        } else if (top === SAND && h >= SEA - 2 && rand() < 0.05) {
          world[idx(x, h, z)] = GRAVEL;
        }
      }
    for (const [x, y, z] of trees) plantTree(x, y, z, rand);

    // Spawn: a grass column near the middle with water close by.
    const nearWater = (x, z) => {
      for (let dz = -10; dz <= 10; dz++)
        for (let dx = -10; dx <= 10; dx++)
          if (get(x + dx, SEA, z + dz) === WATER) return true;
      return false;
    };
    const cands = [];
    for (let z = 8; z < D - 8; z++)
      for (let x = 8; x < W - 8; x++) {
        const h = heights[z * W + x];
        if (world[idx(x, h, z)] === GRASS && get(x, h + 1, z) === AIR && get(x, h + 2, z) === AIR)
          cands.push([x, z, (x - W / 2) ** 2 + (z - D / 2) ** 2]);
      }
    cands.sort((a, b) => a[2] - b[2]);
    const [sx, sz] = cands.find(c => nearWater(c[0], c[1])) || cands[0] || [W / 2, D / 2];

    // Make sure there's gravel, a bush and a tree near the spawn point.
    const around = (count, fn) => {
      let placed = 0;
      for (let tries = 0; tries < 300 && placed < count; tries++) {
        const x = sx + Math.round((rand() - 0.5) * 14), z = sz + Math.round((rand() - 0.5) * 14);
        if (x < 3 || z < 3 || x >= W - 3 || z >= D - 3 || Math.abs(x - sx) + Math.abs(z - sz) < 3) continue;
        const h = surfaceY(x, z);
        if (world[idx(x, h, z)] !== GRASS || get(x, h + 1, z) !== AIR) continue;
        fn(x, h, z);
        placed++;
      }
    };
    around(5, (x, h, z) => { world[idx(x, h, z)] = GRAVEL; });
    around(2, (x, h, z) => { world[idx(x, h + 1, z)] = BUSH; });
    around(2, (x, h, z) => plantTree(x, h + 1, z, rand));

    return { spawn: { x: sx + 0.5, y: surfaceY(sx, sz) + 1, z: sz + 0.5 } };
  }

  function plantTree(x, y, z, rand) {
    const th = 4 + ((rand() * 2) | 0);
    if (y + th + 2 >= H) return;
    for (let k = 0; k < th; k++) if (get(x, y + k, z) !== AIR) return;
    for (let k = 0; k < th; k++) world[idx(x, y + k, z)] = LOG;
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy >= th ? 1 : 2;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === th + 1 || rand() < 0.5)) continue;
          const bx = x + dx, by = y + dy, bz = z + dz;
          if (bx < 0 || bz < 0 || bx >= W || bz >= D || by >= H) continue;
          if (world[idx(bx, by, bz)] === AIR) world[idx(bx, by, bz)] = LEAVES;
        }
    }
  }

  function boulder(x, y, z, rand) {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [1, 0, 1]]) {
      if (dy === 0 && dx !== 0 && rand() < 0.4) continue;
      const bx = x + dx, by = y + dy, bz = z + dz;
      if (bx < 1 || bz < 1 || bx >= W - 1 || bz >= D - 1) continue;
      if (world[idx(bx, by, bz)] === AIR) world[idx(bx, by, bz)] = STONE;
    }
  }

  function countBlocks() {
    const c = { log: 0, gravel: 0, bush: 0 };
    for (let i = 0; i < world.length; i++) {
      const id = world[i];
      if (id === LOG) c.log++;
      else if (id === GRAVEL) c.gravel++;
      else if (id === BUSH || id === BUSH_EMPTY) c.bush++;
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // Chunk meshing
  // ---------------------------------------------------------------------------
  let chunks = [];
  const dirty = new Set();

  function markDirty(x, z) {
    const cx = (x / CHUNK) | 0, cz = (z / CHUNK) | 0;
    dirty.add(cz * NCX + cx);
    const lx = x % CHUNK, lz = z % CHUNK;
    if (lx === 0 && cx > 0) dirty.add(cz * NCX + cx - 1);
    if (lx === CHUNK - 1 && cx < NCX - 1) dirty.add(cz * NCX + cx + 1);
    if (lz === 0 && cz > 0) dirty.add((cz - 1) * NCX + cx);
    if (lz === CHUNK - 1 && cz < NCZ - 1) dirty.add((cz + 1) * NCX + cx);
  }

  const occludes = (x, y, z) => OPAQUE.has(get(x, y, z)) || get(x, y, z) === LEAVES;

  function vertexAO(x, y, z, face, corner) {
    const n = face.dir;
    const axes = [0, 1, 2].filter(a => n[a] === 0);
    const base = [x + n[0], y + n[1], z + n[2]];
    const d = corner.map(c => c * 2 - 1);
    const s1 = base.slice(); s1[axes[0]] += d[axes[0]];
    const s2 = base.slice(); s2[axes[1]] += d[axes[1]];
    const cc = base.slice(); cc[axes[0]] += d[axes[0]]; cc[axes[1]] += d[axes[1]];
    const a = occludes(...s1) ? 1 : 0, b = occludes(...s2) ? 1 : 0, c = occludes(...cc) ? 1 : 0;
    return a && b ? 0 : 3 - (a + b + c);
  }

  function buildChunk(ci) {
    const cx = ci % NCX, cz = (ci / NCX) | 0;
    const solid = { pos: [], nor: [], uv: [], col: [], idx: [] };
    const water = { pos: [], nor: [], uv: [], col: [], idx: [] };

    const quad = (buf, verts, normal, tile, ao) => {
      const base = buf.pos.length / 3;
      for (let k = 0; k < 4; k++) {
        buf.pos.push(...verts[k]);
        buf.nor.push(...normal);
        buf.uv.push(...tileUV(tile, FACE_UV[k][0], FACE_UV[k][1]));
        const b = ao ? AO_LEVELS[ao[k]] : 1;
        buf.col.push(b, b, b);
      }
      if (!ao || ao[0] + ao[2] >= ao[1] + ao[3]) buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    };

    for (let y = 0; y < H; y++)
      for (let lz = 0; lz < CHUNK; lz++)
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
          const id = world[idx(x, y, z)];
          if (id === AIR || id === DOOR || id === CAMPFIRE) continue;

          if (id === WATER) {
            const top = get(x, y + 1, z) !== WATER;
            const hgt = top ? 0.88 : 1;
            FACES.forEach((f, fi) => {
              const nb = get(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
              if (fi === 2 ? !top : (nb === WATER || OPAQUE.has(nb) || fi === 3)) return;
              const verts = f.corners.map(c => [x + c[0], y + c[1] * hgt, z + c[2]]);
              quad(water, verts, f.dir, 5, null);
            });
            continue;
          }

          if (id === BUSH || id === BUSH_EMPTY) {
            FACES.forEach((f, fi) => {
              const verts = f.corners.map(c => [x + 0.1 + c[0] * 0.8, y + c[1] * 0.8, z + 0.1 + c[2] * 0.8]);
              quad(solid, verts, f.dir, texOf(id, fi), null);
            });
            continue;
          }

          FACES.forEach((f, fi) => {
            const nb = get(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
            if (OPAQUE.has(nb)) return;
            if (id === LEAVES && nb === LEAVES && fi !== 2) return;
            const verts = f.corners.map(c => [x + c[0], y + c[1], z + c[2]]);
            const ao = f.corners.map(c => vertexAO(x, y, z, f, c));
            quad(solid, verts, f.dir, texOf(id, fi), ao);
          });
        }

    const old = chunks[ci];
    if (old) {
      for (const m of [old.solid, old.water]) { scene.remove(m); m.geometry.dispose(); }
    }
    const mk = (buf, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
      geo.setIndex(buf.idx);
      const m = new THREE.Mesh(geo, mat);
      scene.add(m);
      return m;
    };
    chunks[ci] = { solid: mk(solid, terrainMat), water: mk(water, waterMat) };
    chunks[ci].water.renderOrder = 1;
  }

  function rebuildDirty(max) {
    let n = 0;
    for (const ci of dirty) {
      buildChunk(ci);
      dirty.delete(ci);
      if (++n >= max) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Doors, campfires, bushes (blocks with extra state)
  // ---------------------------------------------------------------------------
  let doors = new Map();      // key of the bottom cell -> door
  let fires = new Map();      // key -> campfire
  let bushTimers = new Map(); // key -> seconds until berries regrow

  function doorAt(x, y, z) {
    return doors.get(idx(x, y, z)) || (y > 0 ? doors.get(idx(x, y - 1, z)) : undefined);
  }

  const doorMat = new THREE.MeshLambertMaterial({ map: doorTex });
  function addDoor(x, y, z, alongX) {
    world[idx(x, y, z)] = DOOR;
    world[idx(x, y + 1, z)] = DOOR;
    markDirty(x, z);
    const pivot = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.12), doorMat);
    panel.position.set(0.5, 1, 0);
    pivot.add(panel);
    const d = { x, y, z, alongX, open: false, pivot, base: alongX ? 0 : -Math.PI / 2 };
    if (alongX) pivot.position.set(x, y, z + 0.5);
    else pivot.position.set(x + 0.5, y, z);
    pivot.rotation.y = d.base;
    scene.add(pivot);
    doors.set(idx(x, y, z), d);
  }

  function setDoorOpen(d, open) {
    d.open = open;
    d.pivot.rotation.y = d.base + (open ? -Math.PI / 2 : 0);
  }

  function removeDoor(d) {
    scene.remove(d.pivot);
    doors.delete(idx(d.x, d.y, d.z));
    world[idx(d.x, d.y, d.z)] = AIR;
    world[idx(d.x, d.y + 1, d.z)] = AIR;
    markDirty(d.x, d.z);
  }

  const logGeo = new THREE.BoxGeometry(0.9, 0.16, 0.16);
  const logMat = new THREE.MeshLambertMaterial({ color: 0x5b3a1c });
  const stoneGeo = new THREE.BoxGeometry(0.18, 0.14, 0.18);
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8d939a });
  const flameOuterMat = new THREE.MeshBasicMaterial({ color: 0xff7b22, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const flameInnerMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.22, 0.6, 5, 1, true);
  const flameInnerGeo = new THREE.ConeGeometry(0.12, 0.38, 5, 1, true);

  function addFire(x, y, z, fuel) {
    world[idx(x, y, z)] = CAMPFIRE;
    markDirty(x, z);
    const g = new THREE.Group();
    g.position.set(x + 0.5, y, z + 0.5);
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const l = new THREE.Mesh(logGeo, logMat);
      l.position.y = 0.1;
      l.rotation.y = r;
      g.add(l);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const s = new THREE.Mesh(stoneGeo, stoneMat);
      s.position.set(Math.cos(a) * 0.4, 0.07, Math.sin(a) * 0.4);
      g.add(s);
    }
    const flame = new THREE.Group();
    const outer = new THREE.Mesh(flameGeo, flameOuterMat);
    outer.position.y = 0.45;
    const inner = new THREE.Mesh(flameInnerGeo, flameInnerMat);
    inner.position.y = 0.36;
    flame.add(outer, inner);
    g.add(flame);
    scene.add(g);
    fires.set(idx(x, y, z), { x, y, z, fuel, group: g, flame, seed: Math.random() * 10 });
  }

  function removeFire(f) {
    scene.remove(f.group);
    fires.delete(idx(f.x, f.y, f.z));
    world[idx(f.x, f.y, f.z)] = AIR;
    markDirty(f.x, f.z);
  }

  function clearSpecials() {
    for (const d of doors.values()) scene.remove(d.pivot);
    for (const f of fires.values()) scene.remove(f.group);
    doors = new Map();
    fires = new Map();
    bushTimers = new Map();
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  function newGame() {
    clearSpecials();
    const { spawn } = generate((Math.random() * 2 ** 32) >>> 0);
    for (const c of chunks) if (c) for (const m of [c.solid, c.water]) { scene.remove(m); m.geometry.dispose(); }
    chunks = [];
    dirty.clear();
    for (let ci = 0; ci < NCX * NCZ; ci++) buildChunk(ci);

    const counts = countBlocks();
    state = {
      player: {
        x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0,
        yaw: Math.random() * Math.PI * 2, pitch: -0.1, onGround: false, peakY: spawn.y,
        hp: 100, hunger: 100, thirst: 100, inWater: false, headInWater: false, walk: 0,
      },
      inv: {},
      hotbar: new Array(9).fill(null),
      sel: 0,
      tools: { axe: 0, pickaxe: 0 },
      time: DAY_LENGTH * 0.3,
      targets: { log: Math.floor(counts.log * 0.85), gravel: Math.floor(counts.gravel * 0.7), bush: Math.floor(counts.bush * 0.8) },
      target: null,
      mine: { key: -1, t: 0 },
      cooldown: 0, useCooldown: 0, swing: 0,
      sheltered: false, nearFire: false, cold: false,
      shelterTimer: 0, respawnAcc: 0,
      sleeping: false, dead: false, lastDay: 1, hurt: 0,
    };
    msgThrottle.clear();
    logEl.innerHTML = '';
    invDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  function boxCollides(px, py, pz) {
    const x0 = Math.floor(px - PLAYER_W), x1 = Math.floor(px + PLAYER_W);
    const y0 = Math.floor(py), y1 = Math.floor(py + PLAYER_H);
    const z0 = Math.floor(pz - PLAYER_W), z1 = Math.floor(pz + PLAYER_W);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (isSolid(x, y, z)) return true;
    return false;
  }

  function cellOverlapsPlayer(x, y, z) {
    const p = state.player;
    return p.x + PLAYER_W > x && p.x - PLAYER_W < x + 1 &&
           p.y + PLAYER_H > y && p.y < y + 1 &&
           p.z + PLAYER_W > z && p.z - PLAYER_W < z + 1;
  }

  // Voxel raycast. Returns the first non-air, non-water block (and the first water cell passed).
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz;
    if (!dx) tmx = Infinity;
    if (!dy) tmy = Infinity;
    if (!dz) tmz = Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0, water = null;
    while (t <= maxDist) {
      const id = get(x, y, z);
      if (id !== AIR && y >= 0) {
        if (id === WATER) { if (!water) water = { x, y, z }; }
        else return { x, y, z, id, nx, ny, nz, water };
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return { id: null, water };
  }

  // A shelter: a roof above your head and walls on all four sides (doors count only when closed).
  function computeSheltered() {
    const p = state.player;
    const x = Math.floor(p.x), y = Math.floor(p.y + 0.01), z = Math.floor(p.z);
    let roof = false;
    for (let k = 2; k <= 7; k++) if (isSolid(x, y + k, z)) { roof = true; break; }
    if (!roof) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const hy of [y, y + 1]) {
        let wall = false;
        for (let k = 1; k <= 6; k++) {
          if (isSolid(x + dx * k, hy, z + dz * k)) { wall = true; break; }
        }
        if (!wall) return false;
      }
    }
    return true;
  }

  function checkNearFire() {
    const p = state.player;
    for (const f of fires.values()) {
      if (f.fuel > 0 && Math.hypot(f.x + 0.5 - p.x, f.y - p.y, f.z + 0.5 - p.z) <= 4.5) return true;
    }
    return false;
  }

  const dayPhase = () => (state.time % DAY_LENGTH) / DAY_LENGTH;
  const sunHeight = () => Math.sin((dayPhase() - 0.25) * Math.PI * 2);
  const isNight = () => sunHeight() < -0.3;
  const dayNumber = () => Math.floor(state.time / DAY_LENGTH - 0.25) + 1;

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------
  let invDirty = true;
  const count = item => state.inv[item] || 0;
  const has = cost => Object.entries(cost).every(([k, v]) => count(k) >= v);
  const selectedItem = () => {
    const id = state.hotbar[state.sel];
    return id && count(id) > 0 ? id : null;
  };

  function give(item, n) {
    state.inv[item] = count(item) + n;
    if (!state.hotbar.includes(item)) {
      const free = state.hotbar.indexOf(null);
      if (free >= 0) state.hotbar[free] = item;
    }
    invDirty = true;
    pickupToast(item, n);
  }

  function take(item, n) {
    state.inv[item] = count(item) - n;
    if (state.inv[item] <= 0) {
      delete state.inv[item];
      const s = state.hotbar.indexOf(item);
      if (s >= 0) state.hotbar[s] = null;
    }
    invDirty = true;
  }

  function pay(cost) { for (const [k, v] of Object.entries(cost)) take(k, v); }

  function useTool(tool) {
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
    take(item, 1);
    p.hunger = Math.min(100, p.hunger + food.hunger);
    p.thirst = Math.min(100, p.thirst + food.thirst);
    state.swing = 0.3;
    return true;
  }

  function eatBest() {
    if (count('pie') > 0) return eat('pie');
    if (count('berries') > 0) return eat('berries');
    msgOnce('nofood', 'You have nothing to eat. Look for berry bushes.', 2);
    return false;
  }

  function drink() {
    const p = state.player;
    if (p.thirst >= 99) { msgOnce('notthirsty', "You're not thirsty.", 2); return; }
    p.thirst = Math.min(100, p.thirst + 20);
    state.swing = 0.3;
    msgOnce('drank', 'You drink some water. 💧', 1);
  }

  function drinkNearby() {
    const p = state.player;
    if (p.inWater || (state.target && state.target.water)) { drink(); return; }
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    for (let dy = -1; dy <= 0; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          if (get(x + dx, y + dy, z + dz) === WATER) { drink(); return; }
    msgOnce('nowater', 'No water nearby. Walk up to a lake or the sea.', 2);
  }

  function craft(recipe) {
    if (!has(recipe.cost)) return;
    if (recipe.fire && !checkNearFire()) { addMsg('You need to stand next to a lit campfire to cook.', 'warn'); return; }
    pay(recipe.cost);
    if (recipe.tool) {
      state.tools[recipe.tool] = TOOL_DURABILITY;
      addMsg(`Crafted a ${recipe.name}.`);
    } else {
      give(recipe.out, recipe.n);
    }
    renderCraft();
  }

  // ---------------------------------------------------------------------------
  // Breaking and placing
  // ---------------------------------------------------------------------------
  function breakTime(id) {
    const b = BREAK[id];
    if (!b) return Infinity;
    if (b.tool && state.tools[b.tool] <= 0) return Infinity;
    if (b.fast && state.tools[b.fast] > 0) return b.t * 0.5;
    return b.t;
  }

  function drops(id) {
    switch (id) {
      case GRASS: case DIRT: return [['dirt', 1]];
      case SAND: return [['sand', 1]];
      case STONE: return Math.random() < 0.3 ? [['cobble', 1], ['pebble', 1]] : [['cobble', 1]];
      case COBBLE: return [['cobble', 1]];
      case LOG: return [['log', 1]];
      case PLANKS: return [['planks', 1]];
      case LEAVES: return Math.random() < 0.5 ? [['stick', 1]] : [];
      case GRAVEL: return [['pebble', 1 + (Math.random() < 0.5 ? 1 : 0)]];
      case BUSH_EMPTY: return [['stick', 1]];
      case DOOR: return [['door', 1]];
      case CAMPFIRE: return [['campfire', 1]];
      default: return [];
    }
  }

  function removeBlock(x, y, z) {
    const id = get(x, y, z);
    if (id === DOOR) { const d = doorAt(x, y, z); if (d) removeDoor(d); }
    else if (id === CAMPFIRE) { const f = fires.get(idx(x, y, z)); if (f) removeFire(f); }
    else {
      bushTimers.delete(idx(x, y, z));
      setBlock(x, y, z, AIR);
    }
    // Things that sit on top of this block go with it.
    const above = get(x, y + 1, z);
    if (NEEDS_SUPPORT.has(above) && !(above === DOOR && id === DOOR)) {
      for (const [item, n] of drops(above)) give(item, n);
      removeBlock(x, y + 1, z);
    }
  }

  function breakBlock(t) {
    const b = BREAK[t.id];
    if (b && b.tool) useTool(b.tool);
    else if (b && b.fast && state.tools[b.fast] > 0) useTool(b.fast);
    for (const [item, n] of drops(t.id)) give(item, n);
    removeBlock(t.x, t.y, t.z);
  }

  function harvestBush(t) {
    give('berries', 2 + (Math.random() < 0.5 ? 1 : 0));
    setBlock(t.x, t.y, t.z, BUSH_EMPTY);
    bushTimers.set(idx(t.x, t.y, t.z), 60);
    state.swing = 0.3;
  }

  function place(t, item) {
    const it = ITEMS[item];
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    if (x < 0 || z < 0 || x >= W || z >= D || y < 1 || y >= H - 1) return false;
    const cur = get(x, y, z);
    if (cur !== AIR && cur !== WATER) return false;

    if (it.place === DOOR) {
      const up = get(x, y + 1, z);
      if ((up !== AIR && up !== WATER) || !isSolid(x, y - 1, z) || get(x, y - 1, z) === DOOR) {
        msgOnce('doorplace', 'A door needs two free blocks of space on solid ground.', 2);
        return false;
      }
      if (cellOverlapsPlayer(x, y, z) || cellOverlapsPlayer(x, y + 1, z)) return false;
      const p = state.player;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      addDoor(x, y, z, Math.abs(fz) > Math.abs(fx));
    } else if (it.place === CAMPFIRE) {
      if (!isSolid(x, y - 1, z)) { msgOnce('fireplace', 'Place the campfire on solid ground.', 2); return false; }
      if (cellOverlapsPlayer(x, y, z)) return false;
      addFire(x, y, z, 180);
    } else {
      if (cellOverlapsPlayer(x, y, z)) return false;
      setBlock(x, y, z, it.place);
    }
    take(item, 1);
    state.swing = 0.3;
    return true;
  }

  // Right click
  function use() {
    const t = state.target;
    const sel = selectedItem();
    if (t && t.id === DOOR) {
      const d = doorAt(t.x, t.y, t.z);
      if (d) {
        if (d.open && (cellOverlapsPlayer(d.x, d.y, d.z) || cellOverlapsPlayer(d.x, d.y + 1, d.z))) {
          msgOnce('doorway', 'Step out of the doorway first.', 2);
        } else setDoorOpen(d, !d.open);
      }
      return;
    }
    if (t && t.id === CAMPFIRE && (sel === 'stick' || sel === 'log')) {
      const f = fires.get(idx(t.x, t.y, t.z));
      if (f.fuel >= FIRE_MAX - 20) { msgOnce('fullfire', 'The fire is already roaring.', 2); return; }
      take(sel, 1);
      f.fuel = Math.min(FIRE_MAX, f.fuel + (sel === 'log' ? 90 : 30));
      state.swing = 0.3;
      return;
    }
    if (t && t.id === CAMPFIRE && !sel) { msgOnce('firewood', 'Hold sticks or logs and right-click to add fuel.', 3); return; }
    if (t && t.id === BUSH) { harvestBush(t); return; }
    if (sel && ITEMS[sel].place !== undefined && t && t.id) { place(t, sel); return; }
    if (sel && ITEMS[sel].food) { eat(sel); return; }
    if (t && t.water) { drink(); return; }
  }

  function trySleep() {
    if (state.sleeping) return;
    if (!isNight()) { msgOnce('sleepday', "It's daytime. You can only sleep at night.", 2); return; }
    if (!computeSheltered()) { msgOnce('sleepout', "It's not safe to sleep out here. Build a shelter first.", 3); return; }
    if (state.player.hunger < 15 || state.player.thirst < 15) { msgOnce('sleephungry', "You're too hungry or thirsty to sleep.", 3); return; }
    state.sleeping = true;
    mouse.left = mouse.right = false;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function moveAxis(p, axis, dist) {
    if (!dist) return false;
    const steps = Math.ceil(Math.abs(dist) / 0.3);
    const d = dist / steps;
    for (let i = 0; i < steps; i++) {
      p[axis] += d;
      if (boxCollides(p.x, p.y, p.z)) {
        if (axis === 'y') {
          p.y = d < 0 ? Math.floor(p.y) + 1 : Math.floor(p.y + PLAYER_H) - PLAYER_H - 0.001;
        } else {
          p[axis] = d > 0 ? Math.floor(p[axis] + PLAYER_W) - PLAYER_W - 0.001 : Math.floor(p[axis] - PLAYER_W) + 1 + PLAYER_W + 0.001;
        }
        return true;
      }
    }
    return false;
  }

  function update(dt) {
    const s = state, p = s.player;
    const timeMul = s.sleeping ? 10 : 1;
    s.time += dt * timeMul;

    // Movement
    p.inWater = get(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z)) === WATER;
    p.headInWater = get(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)) === WATER;
    let mx = 0, mz = 0;
    if (!s.sleeping) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) mz++;
      if (keys.has('KeyS') || keys.has('ArrowDown')) mz--;
      if (keys.has('KeyD') || keys.has('ArrowRight')) mx++;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) mx--;
    }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    let speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && mz > 0 ? SPRINT : WALK;
    if (p.inWater) speed *= 0.55;
    const accel = Math.min(1, dt * (p.onGround || p.inWater ? 14 : 4));
    p.vx = lerp(p.vx, wx * speed, accel);
    p.vz = lerp(p.vz, wz * speed, accel);

    const jump = keys.has('Space') && !s.sleeping;
    if (p.inWater) {
      p.vy -= 9 * dt;
      p.vy = Math.max(p.vy, -2.5);
      if (jump) p.vy = Math.min(p.vy + 24 * dt, 3.4);
    } else {
      p.vy -= GRAVITY * dt;
      p.vy = Math.max(p.vy, -40);
      if (jump && p.onGround) p.vy = JUMP;
    }

    const bumped = moveAxis(p, 'x', p.vx * dt) | moveAxis(p, 'z', p.vz * dt);
    // Climb out of water onto the shore
    if (p.inWater && jump && bumped) p.vy = Math.max(p.vy, 6);
    const wasOnGround = p.onGround;
    const hitY = moveAxis(p, 'y', p.vy * dt);
    p.onGround = hitY && p.vy < 0;
    if (hitY) p.vy = 0;

    // Fall damage
    if (p.inWater) p.peakY = p.y;
    else if (!p.onGround) p.peakY = Math.max(p.peakY, p.y);
    else if (!wasOnGround) {
      const fall = p.peakY - p.y;
      if (fall > 3.5) { damage((fall - 3) * 6); msgOnce('fall', 'Ouch! That was a long fall.', 3, 'bad'); }
      p.peakY = p.y;
    } else p.peakY = p.y;
    if (p.y < -5) { p.hp = 0; }
    if (len > 0 && p.onGround) p.walk += dt * speed;

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
    if (dmg > 0) { p.hp -= dmg * dt; s.hurt = Math.max(s.hurt, 0.15); }
    else if (p.hunger > 50 && p.thirst > 50) p.hp = Math.min(100, p.hp + REGEN * dt * (s.sleeping ? 4 : 1));
    s.hurt = Math.max(0, s.hurt - dt);

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

    // Targeting
    const cp = p.y + EYE;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    s.target = raycast(p.x, cp, p.z, dir.x, dir.y, dir.z, REACH);

    // Breaking (hold left mouse)
    s.cooldown -= dt;
    s.useCooldown -= dt;
    s.swing = Math.max(0, s.swing - dt);
    const t = s.target;
    let crackLevel = 0;
    if (mouse.left && !s.sleeping && t && t.id && s.cooldown <= 0) {
      const key = idx(t.x, t.y, t.z);
      if (s.mine.key !== key) s.mine = { key, t: 0 };
      if (s.swing <= 0) s.swing = 0.3;
      if (t.id === BUSH) {
        harvestBush(t);
        s.cooldown = 0.3;
      } else {
        const bt = breakTime(t.id);
        s.mine.t += dt;
        if (bt === Infinity) {
          if (t.id === LOG) {
            msgOnce('needaxe', 'You need a Stone Axe to chop logs. Break leaves for sticks and gravel for pebbles, then press C.', 6);
            if (s.mine.t > 1.2) { s.mine.t = 0; if (Math.random() < 0.4) give('stick', 1); }
          } else if (t.id === STONE || t.id === COBBLE) {
            msgOnce('needpick', 'You need a Stone Pickaxe to mine stone.', 5);
          }
        } else {
          crackLevel = s.mine.t / bt;
          if (s.mine.t >= bt) {
            breakBlock(t);
            s.mine = { key: -1, t: 0 };
            s.cooldown = 0.15;
            crackLevel = 0;
          }
        }
      }
    } else if (!mouse.left) {
      s.mine = { key: -1, t: 0 };
    }

    // Right mouse (repeats while held)
    if (mouse.right && !s.sleeping && s.useCooldown <= 0) {
      use();
      s.useCooldown = 0.25;
    }

    // Selection visuals
    if (t && t.id) {
      outline.visible = crack.visible = true;
      const tall = t.id === DOOR ? doorAt(t.x, t.y, t.z) : null;
      if (tall) {
        outline.position.set(t.x + 0.5, tall.y + 1, t.z + 0.5);
        outline.scale.set(1, 2, 1);
      } else {
        outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
        outline.scale.set(1, 1, 1);
      }
      crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      crack.material.opacity = clamp(crackLevel, 0, 1) * 0.55;
      crack.visible = crackLevel > 0;
    } else {
      outline.visible = crack.visible = false;
    }

    // World ticks
    for (const [k, left] of bushTimers) {
      const nl = left - dt * timeMul;
      if (nl <= 0) {
        bushTimers.delete(k);
        if (world[k] === BUSH_EMPTY) {
          world[k] = BUSH;
          markDirty(k % W, ((k / W) | 0) % D);
        }
      } else bushTimers.set(k, nl);
    }
    for (const f of fires.values()) if (f.fuel > 0) f.fuel = Math.max(0, f.fuel - dt * timeMul);
    s.respawnAcc += dt * timeMul;
    if (s.respawnAcc >= 20) { s.respawnAcc = 0; respawn(); }
  }

  function damage(n) {
    state.player.hp -= n;
    state.hurt = 0.4;
  }

  function respawn() {
    const c = countBlocks();
    const p = state.player;
    const randomSurface = (ok, tries = 60) => {
      for (let i = 0; i < tries; i++) {
        const x = 3 + Math.floor(Math.random() * (W - 6)), z = 3 + Math.floor(Math.random() * (D - 6));
        if (Math.hypot(x - p.x, z - p.z) < 24) continue;
        const y = surfaceY(x, z);
        if (ok(world[idx(x, y, z)]) && get(x, y + 1, z) === AIR) return [x, y, z];
      }
      return null;
    };
    if (c.log < state.targets.log) {
      const s = randomSurface(id => id === GRASS);
      if (s) { plantTree(s[0], s[1] + 1, s[2], Math.random); markArea(s[0], s[2]); }
    }
    if (c.gravel < state.targets.gravel) {
      const s = randomSurface(id => id === GRASS || id === SAND);
      if (s) setBlock(s[0], s[1], s[2], GRAVEL);
    }
    if (c.bush < state.targets.bush) {
      const s = randomSurface(id => id === GRASS);
      if (s) setBlock(s[0], s[1] + 1, s[2], BUSH);
    }
  }

  function markArea(x, z) {
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if (x + dx >= 0 && z + dz >= 0 && x + dx < W && z + dz < D) markDirty(x + dx, z + dz);
  }

  function die() {
    const s = state, p = s.player;
    s.dead = true;
    s.sleeping = false;
    mouse.left = mouse.right = false;
    let reason = 'Your health ran out.';
    if (p.thirst <= 0) reason = 'You died of thirst.';
    else if (p.hunger <= 0) reason = 'You starved.';
    else if (s.cold) reason = 'You froze in the night.';
    else if (p.y < 0) reason = 'You fell out of the world.';
    $('death-reason').textContent = reason;
    $('survived').textContent = `You survived until day ${dayNumber()}.`;
    show('gameover', true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const tmpColor = new THREE.Color();

  function render(now, playing) {
    const s = state, p = s.player;
    const t = now / 1000;

    // Camera
    const bob = p.onGround ? Math.sin(p.walk * 2.2) * 0.04 : 0;
    camera.position.set(p.x, p.y + EYE + bob, p.z);
    if (!playing && isOpen('title')) p.yaw += 0.0015;
    camera.rotation.set(p.pitch, p.yaw, 0);

    // Sky and lighting
    const sun = sunHeight();
    const dayAmt = clamp((sun + 0.3) / 0.5, 0, 1);
    const duskAmt = clamp(1 - Math.abs(sun - 0.05) / 0.3, 0, 1) * 0.55;
    tmpColor.copy(skyNight).lerp(skyDay, dayAmt).lerp(skyDusk, duskAmt * dayAmt);
    if (p.headInWater) tmpColor.set(0x1d3f8f);
    scene.background.copy(tmpColor);
    scene.fog.color.copy(tmpColor);
    scene.fog.near = p.headInWater ? 2 : 28;
    scene.fog.far = p.headInWater ? 14 : 72;
    ambient.intensity = lerp(0.16, 0.6, dayAmt);
    sunLight.intensity = lerp(0.1, 0.6, dayAmt);
    sunLight.color.set(dayAmt > 0.2 ? 0xfff4e0 : 0x8899ff);

    const ang = (dayPhase() - 0.25) * Math.PI * 2;
    const sd = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.3).normalize();
    sunMesh.position.copy(camera.position).addScaledVector(sd, 160);
    sunMesh.lookAt(camera.position);
    moonMesh.position.copy(camera.position).addScaledVector(sd, -160);
    moonMesh.lookAt(camera.position);
    const lightDir = sun > -0.1 ? sd : sd.clone().negate();
    sunLight.position.set(p.x + lightDir.x * 50, p.y + lightDir.y * 50, p.z + lightDir.z * 50);
    sunLight.target.position.set(p.x, p.y, p.z);
    stars.position.copy(camera.position);
    starMat.opacity = clamp(1 - dayAmt * 1.5, 0, 1);

    // Campfires: flicker, and light the nearest four
    const lit = [];
    for (const f of fires.values()) {
      f.flame.visible = f.fuel > 0;
      if (f.fuel > 0) {
        const size = 0.6 + 0.4 * Math.min(1, f.fuel / 120);
        f.flame.scale.set(size, size * (1 + Math.sin(t * 13 + f.seed) * 0.12), size);
        f.flame.rotation.y = t * 1.5 + f.seed;
        lit.push([Math.hypot(f.x - p.x, f.z - p.z), f]);
      }
    }
    lit.sort((a, b) => a[0] - b[0]);
    fireLights.forEach((l, i) => {
      const f = lit[i] && lit[i][1];
      if (f) {
        l.position.set(f.x + 0.5, f.y + 0.8, f.z + 0.5);
        l.intensity = (1.6 + Math.sin(t * 9 + f.seed) * 0.08) * (0.5 + 0.5 * Math.min(1, f.fuel / 120));
      } else l.intensity = 0;
    });

    // Hand
    const sel = playing ? selectedItem() : null;
    const it = sel && ITEMS[sel];
    held.visible = !!(it && it.place !== undefined && it.tile !== undefined);
    heldEmoji.visible = !!(it && !held.visible);
    if (held.visible) {
      const blockId = it.place;
      if (!heldGeos[blockId]) heldGeos[blockId] = blockGeometry(blockId);
      held.geometry = heldGeos[blockId];
    } else if (heldEmoji.visible && heldEmojiMat.map !== emojiTexture(it.icon)) {
      heldEmojiMat.map = emojiTexture(it.icon);
      heldEmojiMat.needsUpdate = true;
    }
    const swing = s.swing > 0 ? Math.sin((1 - s.swing / 0.3) * Math.PI) : 0;
    hand.rotation.x = -swing * 0.9;
    hand.position.y = -0.5 + (p.onGround ? Math.abs(Math.sin(p.walk * 2.2)) * -0.02 : 0);
    hand.visible = playing && !s.sleeping;

    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------------------
  // DOM UI
  // ---------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const logEl = $('log');
  const hotbarEl = $('hotbar');
  const toolsEl = $('tools');
  const recipesEl = $('recipes');
  const inventoryEl = $('inventory');
  const bars = { hp: $('bar-health'), hunger: $('bar-hunger'), thirst: $('bar-thirst') };
  const msgThrottle = new Map();

  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  const isOpen = id => !$(id).classList.contains('hidden');
  const panelOpen = () => isOpen('craft') || isOpen('help');

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

  let toastTimer = null;
  function pickupToast(item, n) {
    const el = $('selected-name');
    el.textContent = `+${n} ${ITEMS[item].name}`;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
  }

  function showSelectedName() {
    const id = selectedItem();
    const el = $('selected-name');
    el.textContent = id ? ITEMS[id].name : '';
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }

  function updateHud() {
    const s = state, p = s.player;
    for (const [key, el] of Object.entries(bars)) {
      const v = clamp(p[key], 0, 100);
      el.querySelector('.fill').style.width = v + '%';
      el.querySelector('.val').textContent = Math.ceil(v);
      el.classList.toggle('low', v < 25);
    }
    const mins = Math.floor(dayPhase() * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(Math.floor((mins % 60) / 10) * 10).padStart(2, '0');
    $('day').textContent = `${isNight() ? '🌙' : '☀️'} Day ${dayNumber()} · ${hh}:${mm}`;
    let status = '';
    if (s.sheltered) status = '<span class="safe">🏠 Sheltered</span>';
    else if (s.nearFire) status = '<span class="warm">🔥 Warm by the fire</span>';
    else if (s.cold) status = '<span class="cold">❄️ Freezing</span>';
    else if (isNight()) status = '<span class="cold">Cold night</span>';
    const st = $('status');
    if (st.innerHTML !== status) st.innerHTML = status;
    show('sleep', s.sleeping);
    show('underwater', p.headInWater);
    $('hurt').style.opacity = String(Math.min(0.35, s.hurt));

    const t = s.target;
    let tn = '';
    if (t && t.id) {
      tn = BLOCK_NAMES[t.id] || '';
      if (t.id === CAMPFIRE) {
        const f = fires.get(idx(t.x, t.y, t.z));
        tn += f && f.fuel > 0 ? ` (${Math.ceil(f.fuel)}s of fuel)` : ' (out — add sticks or logs)';
      }
    } else if (t && t.water) tn = 'Water (right-click or E to drink)';
    const tEl = $('target-name');
    if (tEl.textContent !== tn) tEl.textContent = tn;

    if (invDirty) {
      invDirty = false;
      renderHotbar();
      renderTools();
      if (isOpen('craft')) renderCraft();
    }
  }

  function renderHotbar() {
    const s = state;
    hotbarEl.innerHTML = '';
    s.hotbar.forEach((id, i) => {
      const el = document.createElement('div');
      el.className = 'slot' + (i === s.sel ? ' sel' : '');
      el.innerHTML = `<span class="key">${i + 1}</span>` +
        (id && count(id) > 0 ? `${itemIcon(id)}<span class="count">${count(id) > 1 ? count(id) : ''}</span>` : '');
      hotbarEl.appendChild(el);
    });
  }

  function renderTools() {
    toolsEl.innerHTML = '';
    for (const [id, t] of Object.entries(TOOLS)) {
      if (state.tools[id] <= 0) continue;
      const el = document.createElement('div');
      el.className = 'tool';
      el.title = `${t.name} (${state.tools[id]}/${TOOL_DURABILITY})`;
      el.innerHTML = `${t.icon}<div class="dur"><i style="width:${(state.tools[id] / TOOL_DURABILITY) * 100}%"></i></div>`;
      toolsEl.appendChild(el);
    }
  }

  function costHtml(cost) {
    return Object.entries(cost).map(([k, v]) => {
      const ok = count(k) >= v;
      return `<span class="${ok ? '' : 'miss'}" title="${ITEMS[k].name}">${itemIcon(k)} ${count(k)}/${v}</span>`;
    }).join(' &nbsp; ');
  }

  function renderCraft() {
    recipesEl.innerHTML = '';
    for (const r of RECIPES) {
      const el = document.createElement('div');
      el.className = 'recipe';
      const icon = r.tool ? TOOLS[r.tool].icon : itemIcon(r.out);
      const owned = r.tool && state.tools[r.tool] > 0 ? ` (you have one: ${state.tools[r.tool]}/${TOOL_DURABILITY})` : '';
      const name = r.n > 1 ? `${r.name} ×${r.n}` : r.name;
      el.innerHTML = `<div class="ic">${icon}</div>
        <div class="info"><div class="name">${name}</div><div class="desc">${r.desc}${owned}</div><div class="cost">${costHtml(r.cost)}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Craft';
      btn.disabled = !has(r.cost);
      btn.addEventListener('click', () => craft(r));
      el.appendChild(btn);
      recipesEl.appendChild(el);
    }

    inventoryEl.innerHTML = '';
    const ids = Object.keys(state.inv).filter(k => count(k) > 0);
    if (!ids.length) inventoryEl.innerHTML = '<div class="empty">Nothing yet.</div>';
    for (const id of ids) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.title = ITEMS[id].name;
      el.innerHTML = `${itemIcon(id)}<span class="count">${count(id)}</span>`;
      el.addEventListener('click', () => {
        const old = state.hotbar.indexOf(id);
        if (old >= 0) state.hotbar[old] = state.hotbar[state.sel];
        state.hotbar[state.sel] = id;
        invDirty = true;
      });
      inventoryEl.appendChild(el);
    }
  }

  function selectSlot(i) {
    state.sel = (i + 9) % 9;
    invDirty = true;
    showSelectedName();
  }

  // ---------------------------------------------------------------------------
  // Input and pointer lock
  // ---------------------------------------------------------------------------
  const keys = new Set();
  const mouse = { left: false, right: false };
  let paused = false;
  let started = false;

  const locked = () => document.pointerLockElement === canvas;
  function requestLock() {
    try {
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function setPaused(on) {
    if (on && (!started || state.dead)) return;
    paused = on;
    show('paused', on);
    keys.clear();
    mouse.left = mouse.right = false;
  }

  function openPanel(id) {
    show('craft', id === 'craft');
    show('help', id === 'help');
    if (id === 'craft') renderCraft();
    keys.clear();
    mouse.left = mouse.right = false;
    if (locked()) document.exitPointerLock();
  }

  function closePanels() {
    show('craft', false);
    show('help', false);
    requestLock();
  }

  document.addEventListener('pointerlockchange', () => {
    if (locked()) {
      if (paused) setPaused(false);
    } else if (started && !state.dead && !panelOpen()) {
      setPaused(true);
    }
  });

  document.addEventListener('mousemove', e => {
    if (!locked() || !state || state.sleeping) return;
    const p = state.player;
    p.yaw -= e.movementX * 0.0023;
    p.pitch = clamp(p.pitch - e.movementY * 0.0023, -1.55, 1.55);
  });

  document.addEventListener('mousedown', e => {
    if (!started || state.dead || paused) return;
    if (!locked()) {
      if (e.target === canvas && !panelOpen()) requestLock();
      return;
    }
    if (state.sleeping) return;
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) { mouse.right = true; state.useCooldown = 0; }
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  document.addEventListener('contextmenu', e => { if (e.target === canvas) e.preventDefault(); });
  document.addEventListener('wheel', e => {
    if (!started || !locked() || paused) return;
    selectSlot(state.sel + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  window.addEventListener('keydown', e => {
    if (!started || state.dead) return;
    if (paused) {
      if (e.code === 'KeyP') requestLock();
      return;
    }
    if (state.sleeping) {
      state.sleeping = false;
      addMsg('You wake up.');
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code.startsWith('Digit')) {
      const n = +e.code.slice(5);
      if (n >= 1 && n <= 9) selectSlot(n - 1);
      return;
    }
    switch (e.code) {
      case 'KeyC': isOpen('craft') ? closePanels() : openPanel('craft'); break;
      case 'KeyH': isOpen('help') ? closePanels() : openPanel('help'); break;
      case 'KeyF': eatBest(); break;
      case 'KeyE': drinkNearby(); break;
      case 'KeyZ': trySleep(); break;
      case 'KeyP':
        if (locked()) document.exitPointerLock();
        else setPaused(true);
        break;
      case 'Escape':
        if (panelOpen()) closePanels();
        break;
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    mouse.left = mouse.right = false;
    setPaused(true);
  });

  function startGame() {
    started = true;
    show('title', false);
    show('gameover', false);
    show('craft', false);
    show('help', false);
    show('hud', true);
    setPaused(false);
    newGame();
    addMsg('You wake up on a wild island. Click to look around with the mouse.');
    addMsg('Break leaves for sticks and gravel for pebbles, then press C to craft a Stone Axe.');
    requestLock();
  }

  $('start').addEventListener('click', startGame);
  $('restart').addEventListener('click', startGame);
  $('pause-restart').addEventListener('click', startGame);
  $('resume').addEventListener('click', requestLock);
  $('pause-btn').addEventListener('click', e => {
    e.currentTarget.blur();
    if (locked()) document.exitPointerLock();
    else setPaused(true);
  });

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  // A world to look at behind the title screen.
  newGame();

  let last = performance.now();
  let hudAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const playing = started && !state.dead && !paused;
    if (playing) update(dt);
    rebuildDirty(playing ? 4 : 36);
    render(now, playing);
    hudAcc += dt;
    if (playing && hudAcc > 0.05) { hudAcc = 0; updateHud(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Test hook: open index.html?debug to poke at the game from the console.
  if (location.search.includes('debug')) {
    window.__game = { get state() { return state; }, get, give, use, startGame, keys, mouse, isSolid, computeSheltered, setBlock };
  }
})();
