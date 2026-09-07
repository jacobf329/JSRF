import { PALETTE } from '../render/Palette.js';

/**
 * Static description of Tokyo-to.
 *
 * Coordinates are metres, +Y is up. The world is five districts on one
 * continuous map: the terminal in the middle, and four more reached by
 * skating out of it. Each is a separate merge chunk, so the far side of the
 * city is culled rather than drawn.
 *
 * Buildings carry their own tag walls (`tags`), so a graffiti spot is always
 * on a real face rather than a hand-typed coordinate that drifts the moment
 * the building moves.
 */

export const LEVEL = {
  name: 'TOKYO-TO',
  bounds: 300,
  bowl: { half: 24, depth: 3, radius: 3 },
  spawn: { x: 0, y: 0.6, z: 36, heading: Math.PI },
};

export const DISTRICTS = {
  terminal: { id: 'terminal', name: 'SHIBUYA TERMINAL', centre: [0, 0] },
  heights: { id: 'heights', name: 'ROKKAKU HEIGHTS', centre: [0, -225] },
  hill: { id: 'hill', name: 'DOGENZAKA HILL', centre: [0, 225] },
  drain: { id: 'drain', name: 'KOGANE DRAIN', centre: [-225, 0] },
  bantam: { id: 'bantam', name: 'BANTAM STREET', centre: [225, 0] },
};

/** Which district a point belongs to. The terminal is the middle square. */
export function districtAt(x, z) {
  if (Math.abs(x) <= 150 && Math.abs(z) <= 150) return DISTRICTS.terminal;
  if (z < -150 && Math.abs(x) <= 150) return DISTRICTS.heights;
  if (z > 150 && Math.abs(x) <= 150) return DISTRICTS.hill;
  if (x < -150) return DISTRICTS.drain;
  return DISTRICTS.bantam;
}

const T = (side, y, size = 'medium', offset = 0) => ({ side, y, size, offset });

// x, z = footprint centre; w, d = footprint; h = height.
const HAND_PLACED = [
  // --- Shibuya Terminal, north strip ---
  { d: 'terminal', x: -76, z: -62, w: 34, d2: 26, h: 30, color: PALETTE.plaster, style: 'shop',
    sign: { text: 'NOISE TANK', color: PALETTE.hotPink, side: 'south' }, tags: [T('south', 3.4, 'large')] },
  { d: 'terminal', x: -36, z: -64, w: 30, d2: 22, h: 22, color: PALETTE.concreteWarm, style: 'shop',
    sign: { text: 'ROKKAKU', color: PALETTE.cyan, side: 'south' }, tags: [T('south', 3.2, 'medium')] },
  { d: 'terminal', x: 0, z: -66, w: 34, d2: 26, h: 44, color: PALETTE.concrete, style: 'tower',
    sign: { text: 'TERMINAL', color: PALETTE.sunYellow, side: 'south' },
    tags: [T('south', 3.6, 'large', -13), T('south', 3.4, 'large', 13), T('south', 15.5, 'xl')] },
  { d: 'terminal', x: 38, z: -64, w: 28, d2: 22, h: 26, color: PALETTE.brick, style: 'shop',
    sign: { text: 'GRAFFITI', color: PALETTE.lime, side: 'south' }, tags: [T('south', 3.4, 'large')] },
  { d: 'terminal', x: 78, z: -62, w: 32, d2: 26, h: 34, color: PALETTE.plaster, style: 'tower',
    tags: [T('south', 3.2, 'medium'), T('west', 12, 'large')] },

  // --- east strip ---
  { d: 'terminal', x: 72, z: -14, w: 26, d2: 34, h: 24, color: PALETTE.concreteWarm, style: 'shop',
    sign: { text: 'RADIO', color: PALETTE.tangerine, side: 'west' }, tags: [T('west', 3.4, 'large')] },
  { d: 'terminal', x: 76, z: 26, w: 30, d2: 32, h: 38, color: PALETTE.concrete, style: 'tower',
    sign: { text: '99', color: PALETTE.violet, side: 'west' },
    tags: [T('west', 3.2, 'medium'), T('west', 17, 'xl')] },
  { d: 'terminal', x: 70, z: 66, w: 26, d2: 28, h: 20, color: PALETTE.brick, style: 'shop',
    tags: [T('north', 3.2, 'medium')] },

  // --- south strip ---
  { d: 'terminal', x: 26, z: 78, w: 30, d2: 24, h: 28, color: PALETTE.plaster, style: 'shop',
    sign: { text: 'DOGENZAKA', color: PALETTE.hotPink, side: 'north' }, tags: [T('north', 3.4, 'large')] },
  { d: 'terminal', x: -14, z: 80, w: 28, d2: 24, h: 22, color: PALETTE.concreteWarm, style: 'shop',
    tags: [T('north', 3.2, 'medium')] },
  { d: 'terminal', x: -54, z: 76, w: 32, d2: 26, h: 32, color: PALETTE.concrete, style: 'tower',
    sign: { text: 'GARAGE', color: PALETTE.cyan, side: 'north' }, tags: [T('north', 3.4, 'large')] },

  // --- west strip ---
  { d: 'terminal', x: -74, z: 30, w: 28, d2: 30, h: 26, color: PALETTE.brick, style: 'shop',
    sign: { text: 'JET SET', color: PALETTE.sunYellow, side: 'east' }, tags: [T('east', 3.4, 'large')] },
  { d: 'terminal', x: -78, z: -12, w: 26, d2: 32, h: 36, color: PALETTE.plaster, style: 'tower',
    tags: [T('east', 3.2, 'medium'), T('east', 16, 'xl')] },

  // --- inner blocks flanking the square ---
  { d: 'terminal', x: -42, z: -18, w: 14, d2: 20, h: 14, color: PALETTE.concreteWarm, style: 'low',
    tags: [T('east', 9.5, 'medium')] },
  { d: 'terminal', x: -42, z: 22, w: 14, d2: 20, h: 11, color: PALETTE.plaster, style: 'low' },
  { d: 'terminal', x: 42, z: -22, w: 14, d2: 18, h: 12, color: PALETTE.brick, style: 'low' },
  { d: 'terminal', x: 42, z: 20, w: 14, d2: 22, h: 16, color: PALETTE.concrete, style: 'low',
    tags: [T('west', 8.5, 'medium')] },

  // --- Rokkaku Heights: towers, and the roofs between them ---
  { d: 'heights', x: -100, z: -200, w: 36, d2: 36, h: 62, color: PALETTE.concrete, style: 'tower',
    sign: { text: 'ROKKAKU', color: PALETTE.violet, side: 'south' },
    tags: [T('south', 3.6, 'large'), T('south', 22, 'xl')] },
  { d: 'heights', x: -40, z: -215, w: 30, d2: 30, h: 48, color: PALETTE.plaster, style: 'tower',
    tags: [T('east', 3.4, 'large')] },
  { d: 'heights', x: 20, z: -195, w: 34, d2: 28, h: 70, color: PALETTE.concreteWarm, style: 'tower',
    sign: { text: 'GROUP', color: PALETTE.hotPink, side: 'south' },
    tags: [T('south', 3.4, 'large'), T('west', 28, 'xl')] },
  { d: 'heights', x: 86, z: -210, w: 32, d2: 34, h: 54, color: PALETTE.concrete, style: 'tower',
    tags: [T('west', 3.6, 'large')] },
  { d: 'heights', x: -70, z: -270, w: 40, d2: 30, h: 40, color: PALETTE.brick, style: 'tower',
    tags: [T('south', 3.2, 'medium')] },
  { d: 'heights', x: 0, z: -275, w: 34, d2: 28, h: 58, color: PALETTE.plaster, style: 'tower',
    sign: { text: 'HEIGHTS', color: PALETTE.cyan, side: 'south' }, tags: [T('south', 3.4, 'large')] },
  { d: 'heights', x: 74, z: -272, w: 30, d2: 30, h: 44, color: PALETTE.concreteWarm, style: 'tower',
    tags: [T('west', 3.2, 'medium')] },
  { d: 'heights', x: 128, z: -240, w: 26, d2: 40, h: 36, color: PALETTE.concrete, style: 'tower',
    tags: [T('west', 3.4, 'large')] },
  { d: 'heights', x: -134, z: -246, w: 26, d2: 38, h: 34, color: PALETTE.brick, style: 'tower',
    tags: [T('east', 3.4, 'large')] },

  // --- Dogenzaka Hill: buildings flanking the descent ---
  { d: 'hill', x: -104, z: 190, w: 32, d2: 34, h: 26, color: PALETTE.plaster, style: 'shop',
    sign: { text: 'HILL', color: PALETTE.tangerine, side: 'east' }, tags: [T('east', 3.4, 'large')] },
  { d: 'hill', x: -108, z: 250, w: 30, d2: 32, h: 22, color: PALETTE.brick, style: 'shop',
    tags: [T('east', 3.2, 'medium')] },
  { d: 'hill', x: 104, z: 190, w: 32, d2: 34, h: 28, color: PALETTE.concreteWarm, style: 'shop',
    tags: [T('west', 3.4, 'large')] },
  { d: 'hill', x: 108, z: 250, w: 30, d2: 32, h: 24, color: PALETTE.concrete, style: 'shop',
    sign: { text: 'SLOPE', color: PALETTE.lime, side: 'west' }, tags: [T('west', 3.2, 'medium')] },
  { d: 'hill', x: 0, z: 286, w: 60, d2: 20, h: 30, color: PALETTE.plaster, style: 'tower',
    sign: { text: 'SUMMIT', color: PALETTE.sunYellow, side: 'north' },
    tags: [T('north', 26, 'xl'), T('north', 24, 'large', -22)] },

  // --- Kogane Drain: the sheds and outfalls along the channel ---
  { d: 'drain', x: -290, z: -90, w: 18, d2: 40, h: 26, color: PALETTE.rooftop, style: 'low',
    tags: [T('east', 3.4, 'large')] },
  { d: 'drain', x: -290, z: 90, w: 18, d2: 40, h: 22, color: PALETTE.rooftop, style: 'low',
    tags: [T('east', 3.2, 'medium')] },
  { d: 'drain', x: -168, z: -120, w: 20, d2: 34, h: 30, color: PALETTE.concrete, style: 'tower',
    sign: { text: 'KOGANE', color: PALETTE.cyan, side: 'east' }, tags: [T('east', 3.4, 'large')] },
  { d: 'drain', x: -168, z: 120, w: 20, d2: 34, h: 28, color: PALETTE.brick, style: 'tower',
    tags: [T('east', 3.2, 'medium')] },
];

/** Bantam Street is a market grid, so it is described as one rather than typed out. */
function bantamBlocks() {
  const out = [];
  const colors = [PALETTE.brick, PALETTE.plaster, PALETTE.concreteWarm, PALETTE.concrete];
  const signs = ['BANTAM', 'MARKET', 'KICKS', 'CREW', 'FLY'];
  let n = 0;
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 5; iz++) {
      const x = 178 + ix * 34;
      const z = -136 + iz * 68;
      const h = 9 + ((ix * 3 + iz * 5) % 4) * 3.5;
      const entry = {
        d: 'bantam',
        x, z, w: 26, d2: 44, h,
        color: colors[(ix + iz) % colors.length],
        style: 'shop',
      };
      // Tag the alley-facing walls, which is where a skater actually passes.
      if (ix % 2 === 0) entry.tags = [T('west', 3.2, iz % 2 ? 'large' : 'medium')];
      else if (iz % 2 === 0) entry.tags = [T('east', 3.2, 'medium')];
      if (n % 4 === 0) {
        entry.sign = { text: signs[(n / 4) % signs.length], color: PALETTE.hotPink, side: 'west' };
      }
      out.push(entry);
      n++;
    }
  }
  return out;
}

// `d2` is the footprint depth; it is spelled that way only because `d` is the
// district. The builder reads `.d` for depth, so normalise here.
export const BUILDINGS = [...HAND_PLACED, ...bantamBlocks()].map((b) => ({
  ...b,
  district: b.d,
  d: b.d2,
}));

/** Tag walls that are not on a building: pillars, barriers, channel walls. */
export const TAG_SPOTS = [
  { x: -107.5, y: 5.0, z: -40, dir: Math.PI / 2, w: 4.2, h: 4, size: 'medium', district: 'terminal' },
  { x: -107.5, y: 5.0, z: 20, dir: Math.PI / 2, w: 4.2, h: 4, size: 'medium', district: 'terminal' },
  // Kogane Drain: the channel walls themselves, high up on the transition.
  { x: -196, y: 8.5, z: -60, dir: -Math.PI / 2, w: 8, h: 6, size: 'xl', district: 'drain' },
  { x: -254, y: 8.5, z: 40, dir: Math.PI / 2, w: 8, h: 6, size: 'xl', district: 'drain' },
  { x: -196, y: 4.0, z: 140, dir: -Math.PI / 2, w: 6, h: 4.6, size: 'large', district: 'drain' },
  { x: -254, y: 4.0, z: -140, dir: Math.PI / 2, w: 6, h: 4.6, size: 'large', district: 'drain' },
  // Dogenzaka Hill: the guard walls down the descent.
  { x: -58, y: 3.0, z: 200, dir: Math.PI / 2, w: 6.5, h: 4.4, size: 'large', district: 'hill' },
  { x: 58, y: 3.0, z: 240, dir: -Math.PI / 2, w: 6.5, h: 4.4, size: 'large', district: 'hill' },
];

/** Spray cans. The good ones are somewhere you have to work to reach. */
function canSpots() {
  const out = [
    // Terminal
    [-22, 0.9, -22], [22, 0.9, -22], [22, 0.9, 22], [-22, 0.9, 22],
    [0, -2.1, 0], [-12, -2.1, -12], [12, -2.1, 12],
    [-46, 0.9, 0], [46, 0.9, 0], [0, 0.9, 46], [0, 0.9, -46],
    [-56, 0.9, -34], [56, 0.9, -34], [56, 0.9, 44], [-56, 0.9, 44],
    [-40, 3.2, 46], [40, 3.2, -44], [-8, 0.9, 62], [8, 0.9, -62],
    [0, 45.4, -66], [76, 39.4, 26], [-76, 31.4, -62], [-54, 33.4, 76],
    [-110, 15.4, -60], [-110, 15.4, 4], [-110, 15.4, 64],
    [-72, 27.4, -12], [72, 25.4, -14], [70, 21.4, 66],
    // Heights: rooftops, and the wires between them
    [-100, 63.4, -200], [20, 71.4, -195], [86, 55.4, -210], [-40, 49.4, -215],
    [0, 59.4, -275], [-70, 41.4, -270], [74, 45.4, -272],
    [-40, 0.9, -180], [40, 0.9, -180], [0, 0.9, -240], [-120, 0.9, -190], [120, 0.9, -250],
    // Hill: down the descent and on the guard walls
    [0, 4.2, 180], [-30, 8.0, 210], [30, 11.0, 240], [0, 15.0, 265], [0, 20.4, 284],
    [-70, 0.9, 200], [70, 0.9, 240],
    // Drain: the channel floor and the lips
    [-225, 0.9, -120], [-225, 0.9, -40], [-225, 0.9, 40], [-225, 0.9, 120],
    [-196, 10.4, 0], [-254, 10.4, -80], [-254, 10.4, 80],
    [-290, 27.4, -90], [-168, 31.4, -120],
    // Bantam: the alleys and the low roofs
    [163, 0.9, -100], [163, 0.9, 0], [163, 0.9, 100],
    [212, 0.9, -60], [212, 0.9, 60], [246, 0.9, 0], [280, 0.9, -30], [280, 0.9, 30],
    [178, 14.4, -136], [246, 18.4, 0], [280, 12.4, 136],
  ];
  return out;
}

export const CAN_SPOTS = canSpots();

export const POLICE_POSTS = [
  [0, 0, -44], [-44, 0, 40], [46, 0, 40], [-40, 0, -40], [40, 0, -30], [0, 0, 60],
  [0, 0, -170], [-90, 0, -230], [70, 0, -250],
  [0, 0, 175], [-80, 0, 230], [80, 0, 230],
  [-225, 0, -80], [-225, 0, 80], [-180, 0, 0],
  [170, 0, -80], [230, 0, 0], [280, 0, 80],
];
