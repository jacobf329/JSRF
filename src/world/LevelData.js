import { PALETTE } from '../render/Palette.js';

/**
 * Static description of the "Shibuya Terminal" district.
 *
 * Coordinates are metres, +Y is up. The plaza bowl sits at the origin and the
 * street grid frames it; buildings ring the outside with rooftops linked by
 * wires and rails so the whole map is traversable without touching the ground.
 */

export const LEVEL = {
  name: 'SHIBUYA TERMINAL',
  bounds: 150,
  bowl: { half: 24, depth: 3, radius: 3 },
  spawn: { x: 0, y: 0.6, z: 36, heading: Math.PI },
};

// x, z = footprint centre; w, d = footprint; h = height.
export const BUILDINGS = [
  // --- North strip (behind the terminal) ---
  { x: -76, z: -62, w: 34, d: 26, h: 30, color: PALETTE.plaster, style: 'shop', sign: { text: 'NOISE TANK', color: PALETTE.hotPink, side: 'south' } },
  { x: -36, z: -64, w: 30, d: 22, h: 22, color: PALETTE.concreteWarm, style: 'shop', sign: { text: 'ROKKAKU', color: PALETTE.cyan, side: 'south' } },
  { x: 0, z: -66, w: 34, d: 26, h: 44, color: PALETTE.concrete, style: 'tower', sign: { text: 'TERMINAL', color: PALETTE.sunYellow, side: 'south' } },
  { x: 38, z: -64, w: 28, d: 22, h: 26, color: PALETTE.brick, style: 'shop', sign: { text: 'GRAFFITI', color: PALETTE.lime, side: 'south' } },
  { x: 78, z: -62, w: 32, d: 26, h: 34, color: PALETTE.plaster, style: 'tower' },

  // --- East strip ---
  { x: 72, z: -14, w: 26, d: 34, h: 24, color: PALETTE.concreteWarm, style: 'shop', sign: { text: 'RADIO', color: PALETTE.tangerine, side: 'west' } },
  { x: 76, z: 26, w: 30, d: 32, h: 38, color: PALETTE.concrete, style: 'tower', sign: { text: '99', color: PALETTE.violet, side: 'west' } },
  { x: 70, z: 66, w: 26, d: 28, h: 20, color: PALETTE.brick, style: 'shop' },

  // --- South strip ---
  { x: 26, z: 78, w: 30, d: 24, h: 28, color: PALETTE.plaster, style: 'shop', sign: { text: 'DOGENZAKA', color: PALETTE.hotPink, side: 'north' } },
  { x: -14, z: 80, w: 28, d: 24, h: 22, color: PALETTE.concreteWarm, style: 'shop' },
  { x: -54, z: 76, w: 32, d: 26, h: 32, color: PALETTE.concrete, style: 'tower', sign: { text: 'GARAGE', color: PALETTE.cyan, side: 'north' } },

  // --- West strip ---
  { x: -74, z: 30, w: 28, d: 30, h: 26, color: PALETTE.brick, style: 'shop', sign: { text: 'JET SET', color: PALETTE.sunYellow, side: 'east' } },
  { x: -78, z: -12, w: 26, d: 32, h: 36, color: PALETTE.plaster, style: 'tower' },

  // --- Inner blocks flanking the square ---
  { x: -42, z: -18, w: 14, d: 20, h: 14, color: PALETTE.concreteWarm, style: 'low' },
  { x: -42, z: 22, w: 14, d: 20, h: 11, color: PALETTE.plaster, style: 'low' },
  { x: 42, z: -22, w: 14, d: 18, h: 12, color: PALETTE.brick, style: 'low' },
  { x: 42, z: 20, w: 14, d: 22, h: 16, color: PALETTE.concrete, style: 'low' },
];

/** Wall panels the player can tag. `dir` is the outward facing angle in radians. */
export const TAG_SPOTS = [
  { x: -13, y: 3.6, z: -53.0, dir: 0, w: 7, h: 5, size: 'large' },
  { x: 14, y: 3.4, z: -53.0, dir: 0, w: 6, h: 4.6, size: 'large' },
  { x: -35, y: 3.2, z: -53.0, dir: 0, w: 6, h: 4.4, size: 'medium' },
  { x: 58.8, y: 3.4, z: -14, dir: -Math.PI / 2, w: 6.5, h: 4.8, size: 'large' },
  { x: 60.8, y: 3.2, z: 26, dir: -Math.PI / 2, w: 6, h: 4.4, size: 'medium' },
  { x: 26, y: 3.4, z: 66.0, dir: Math.PI, w: 6.5, h: 4.8, size: 'large' },
  { x: -14, y: 3.2, z: 68.0, dir: Math.PI, w: 6, h: 4.4, size: 'medium' },
  { x: -60.0, y: 3.4, z: 30, dir: Math.PI / 2, w: 6.5, h: 4.8, size: 'large' },
  { x: -65.0, y: 3.2, z: -12, dir: Math.PI / 2, w: 6, h: 4.4, size: 'medium' },
  // Up high -- these are the ones worth chaining a line for.
  { x: 0, y: 15.5, z: -53.0, dir: 0, w: 8, h: 6, size: 'xl' },
  { x: 61.0, y: 17.0, z: 26, dir: -Math.PI / 2, w: 7.5, h: 5.6, size: 'xl' },
  { x: -35.0, y: 9.5, z: -18, dir: Math.PI / 2, w: 5.5, h: 4, size: 'medium' },
  { x: 35.0, y: 8.5, z: 20, dir: -Math.PI / 2, w: 5.5, h: 4, size: 'medium' },
  // Expressway support pillars, out on the west edge.
  { x: -107.5, y: 5.0, z: -40, dir: Math.PI / 2, w: 4.2, h: 4, size: 'medium' },
  { x: -107.5, y: 5.0, z: 20, dir: Math.PI / 2, w: 4.2, h: 4, size: 'medium' },
];

export const CAN_SPOTS = [
  // Plaza bowl rim
  [-22, 0.9, -22], [22, 0.9, -22], [22, 0.9, 22], [-22, 0.9, 22],
  [0, -2.1, 0], [-12, -2.1, -12], [12, -2.1, 12],
  // Streets
  [-46, 0.9, 0], [46, 0.9, 0], [0, 0.9, 46], [0, 0.9, -46],
  [-56, 0.9, -34], [56, 0.9, -34], [56, 0.9, 44], [-56, 0.9, 44],
  // Stairs & alleys
  [-40, 3.2, 46], [40, 3.2, -44], [-8, 0.9, 62], [8, 0.9, -62],
  // Rooftops and the highway -- rewards for going vertical.
  [0, 45.4, -66], [76, 39.4, 26], [-76, 31.4, -62], [-54, 33.4, 76],
  [-110, 15.4, -60], [-110, 15.4, 4], [-110, 15.4, 64],
  [-72, 27.4, -12], [72, 25.4, -14], [70, 21.4, 66],
];

export const POLICE_POSTS = [
  [0, 0, -44], [-44, 0, 40], [46, 0, 40], [-40, 0, -40], [40, 0, -30], [0, 0, 60],
];
