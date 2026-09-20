import { PALETTE } from '../render/Palette.js';
import { SKATER } from './PlayerConfig.js';

/**
 * The playable roster.
 *
 * Each rudie is a look plus three stats, scored 1..5. The stats are not
 * decoration: they rewrite the skater's tuning table, so picking BEAT and
 * picking CUBE are two different games. Nobody is strictly better than anybody
 * else -- every point spent on one stat is a point missing from another.
 *
 *   speed      top speed, acceleration and how much boost there is to spend
 *   technique  trick payout, grind balance and how forgiving a landing is
 *   power      how hard you hit, how much you can take, and jump height
 */
export const RUDIES = [
  {
    id: 'beat', name: 'BEAT',
    blurb: 'All rounder. Nothing to relearn.',
    stats: { speed: 3, technique: 3, power: 3 },
    jacket: 0x18d7c8, jacketDark: 0x0f9a90, beanie: 0xff2f87,
    pack: 0xff7a1a, pants: 0x2b3150, skin: PALETTE.skin, wheel: 0x24d6ff,
  },
  {
    id: 'gum', name: 'GUM',
    blurb: 'Fast and slippery. Hard to corner, impossible to catch.',
    stats: { speed: 5, technique: 3, power: 1 },
    jacket: 0xa8ff3e, jacketDark: 0x6fb320, beanie: 0x9a5cff,
    pack: 0x24d6ff, pants: 0x21243a, skin: 0xf2b98a, wheel: 0xa8ff3e,
  },
  {
    id: 'yoyo', name: 'YOYO',
    blurb: 'Lives on the rails. Every trick pays more, every landing is kinder.',
    stats: { speed: 2, technique: 5, power: 2 },
    jacket: 0xff7a1a, jacketDark: 0xc4530a, beanie: 0x24d6ff,
    pack: 0xffd21e, pants: 0x33263f, skin: 0xc98a5e, wheel: 0xff7a1a,
  },
  {
    id: 'combo', name: 'COMBO',
    blurb: 'Goes through cops instead of round them. Slow to wind up.',
    stats: { speed: 2, technique: 2, power: 5 },
    jacket: 0xff2f87, jacketDark: 0xc00f5c, beanie: 0xffd21e,
    pack: 0xa8ff3e, pants: 0x1d2b5c, skin: 0x8a5a3c, wheel: 0xff2f87,
  },
  {
    id: 'cube', name: 'CUBE',
    blurb: 'Unlocked in Rokkaku Heights. Quick hands, glass jaw.',
    stats: { speed: 4, technique: 4, power: 1 },
    locked: true,
    jacket: 0x9a5cff, jacketDark: 0x6a36c4, beanie: 0xa8ff3e,
    pack: 0xff2f87, pants: 0x241a3c, skin: 0xe8b08a, wheel: 0x9a5cff,
  },
  {
    id: 'garam', name: 'GARAM',
    blurb: 'Unlocked in Kogane Drain. Hits like a truck and outruns one.',
    stats: { speed: 4, technique: 1, power: 4 },
    locked: true,
    jacket: 0xffd21e, jacketDark: 0xc49c05, beanie: 0x1b2340,
    pack: 0x24d6ff, pants: 0x2c2f3f, skin: 0x7a4a2e, wheel: 0xffd21e,
  },
];

export const DEFAULT_RUDIE = RUDIES[0];

export function rudieById(id) {
  return RUDIES.find((r) => r.id === id) || DEFAULT_RUDIE;
}

/** Stat 1..5 mapped to a multiplier either side of 1, `spread` wide at the ends. */
function scale(stat, spread) {
  return 1 + ((stat - 3) / 2) * spread;
}

/**
 * Build a skater tuning table for one rudie.
 *
 * Everything not named here is shared, so a stat change can only ever move the
 * handful of numbers it is supposed to move -- and the base table stays the
 * single place the feel is tuned.
 */
export function skaterConfigFor(rudie) {
  const s = rudie && rudie.stats ? rudie.stats : DEFAULT_RUDIE.stats;
  const speed = scale(s.speed, 0.18);
  const tech = scale(s.technique, 0.3);
  const power = scale(s.power, 0.22);

  return {
    ...SKATER,

    maxSpeed: SKATER.maxSpeed * speed,
    boostSpeed: SKATER.boostSpeed * speed,
    // A fast skater also winds up faster, or the top speed is theoretical.
    accel: SKATER.accel * scale(s.speed, 0.14),
    boostMax: SKATER.boostMax * scale(s.speed, 0.24),

    // Technique is the whole risk side of the game: how long you can hold a
    // rail, and how quickly a trick comes round -- a faster trick is one you
    // can throw from lower without blowing the landing.
    grindStabilityTime: SKATER.grindStabilityTime * tech,
    grindStabilitySpeedBite: SKATER.grindStabilitySpeedBite / tech,
    trickTime: SKATER.trickTime / tech,
    maxAirTricks: s.technique >= 5 ? SKATER.maxAirTricks + 1 : SKATER.maxAirTricks,
    trickAbortPayout: Math.min(0.9, SKATER.trickAbortPayout * tech),

    // Power is jump height and staying upright when something hits you.
    jumpSpeed: SKATER.jumpSpeed * scale(s.power, 0.12),
    jumpHoldBoost: SKATER.jumpHoldBoost * scale(s.power, 0.12),
    hitStun: SKATER.hitStun / power,
    bailTime: SKATER.bailTime / power,
  };
}

/** Per-rudie multipliers the scoring and combat systems read. */
export function traitsFor(rudie) {
  const s = rudie && rudie.stats ? rudie.stats : DEFAULT_RUDIE.stats;
  return {
    // Technique pays: the same trick is worth more in better hands.
    trickPoints: scale(s.technique, 0.36),
    // Power lands the body check from further out and at a lower speed.
    checkSpeed: 1 / scale(s.power, 0.2),
    checkRadius: scale(s.power, 0.22),
  };
}
