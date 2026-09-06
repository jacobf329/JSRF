import { POSES } from './Poses.js';

/**
 * The trick catalogue.
 *
 * Which trick comes out is decided by the direction held when the button is
 * pressed, and repeated presses in the same air cycle step through the
 * variants for that direction -- so a long air is a different string of tricks
 * every time rather than the same one three times.
 *
 * `spin`, `flip` and `roll` are whole turns applied to the body over the
 * trick's duration. `clip` is the animation name a rigged model is expected to
 * provide; until one is loaded the procedural rig plays `pose` instead, so the
 * catalogue is the single source of truth either way.
 */

export const TRICK_KIND = {
  AIR: 'air',
  GRIND: 'grind',
  WALL: 'wall',
};

function trick(id, name, pose, points, opts = {}) {
  return {
    id,
    name,
    pose,
    points,
    kind: opts.kind || TRICK_KIND.AIR,
    duration: opts.duration ?? 0.52,
    spin: opts.spin ?? 0,
    flip: opts.flip ?? 0,
    roll: opts.roll ?? 0,
    clip: opts.clip || `trick_${id}`,
  };
}

// --- air, by the direction held -------------------------------------------

export const AIR_TRICKS = {
  neutral: [
    trick('kickflip', 'KICKFLIP', 'tuck', 240, { roll: 1, duration: 0.46 }),
    trick('heelflip', 'HEELFLIP', 'tuck', 260, { roll: -1, duration: 0.46 }),
    trick('hardflip', 'HARDFLIP', 'corkscrew', 340, { roll: 1, spin: 0.5, duration: 0.6 }),
  ],
  up: [
    trick('rocket', 'ROCKET AIR', 'rocket', 300, { duration: 0.6 }),
    trick('christ', 'CHRIST AIR', 'christ', 380, { duration: 0.7 }),
    trick('superman', 'SUPERMAN', 'superman', 420, { duration: 0.72 }),
  ],
  down: [
    trick('japan', 'JAPAN AIR', 'japan', 320, { duration: 0.6 }),
    trick('tuckknee', 'TUCK KNEE', 'tuck', 200, { duration: 0.42 }),
    trick('stalefish', 'STALEFISH', 'stalefish', 340, { duration: 0.62 }),
  ],
  left: [
    trick('method', 'METHOD AIR', 'method', 360, { duration: 0.66 }),
    trick('mute', 'MUTE GRAB', 'indy', 260, { duration: 0.5 }),
    trick('backside', 'BACKSIDE AIR', 'method', 400, { spin: -0.5, duration: 0.7 }),
  ],
  right: [
    trick('indy', 'INDY GRAB', 'indy', 280, { duration: 0.52 }),
    trick('nosebone', 'NOSEBONE', 'stalefish', 300, { duration: 0.56 }),
    trick('frontside', 'FRONTSIDE AIR', 'indy', 400, { spin: 0.5, duration: 0.7 }),
  ],
  upLeft: [
    trick('backflip', 'BACKFLIP', 'tuck', 480, { flip: -1, duration: 0.72 }),
    trick('mistyflip', 'MISTY FLIP', 'corkscrew', 620, { flip: -1, spin: 0.5, duration: 0.85 }),
  ],
  upRight: [
    trick('frontflip', 'FRONTFLIP', 'tuck', 480, { flip: 1, duration: 0.72 }),
    trick('rodeo', 'RODEO 540', 'corkscrew', 660, { flip: 1, spin: 1.5, duration: 0.95 }),
  ],
  downLeft: [
    trick('handplant', 'HANDPLANT', 'handplant', 420, { duration: 0.7 }),
    trick('sacktap', 'SACKTAP', 'airwalk', 300, { duration: 0.5 }),
  ],
  downRight: [
    trick('madonna', 'MADONNA', 'madonna', 380, { duration: 0.64 }),
    trick('airwalk', 'AIRWALK', 'airwalk', 340, { duration: 0.6 }),
  ],
};

/** Spins are stacked on top of any air trick by holding the shoulder buttons. */
export const SPIN_TRICKS = [
  trick('spin360', '360 SPIN', 'corkscrew', 300, { spin: 1, duration: 0.6 }),
  trick('spin540', '540 SPIN', 'corkscrew', 520, { spin: 1.5, duration: 0.8 }),
  trick('spin720', '720 SPIN', 'corkscrew', 780, { spin: 2, duration: 0.95 }),
  trick('spin900', '900', 'corkscrew', 1200, { spin: 2.5, duration: 1.15 }),
];

// --- grind stances, by the direction held ---------------------------------

const grind = (id, name, pose, points, opts = {}) =>
  trick(id, name, pose, points, { ...opts, kind: TRICK_KIND.GRIND, duration: opts.duration ?? 0 });

export const GRIND_TRICKS = {
  neutral: [grind('soul', 'SOUL GRIND', 'soul', 14), grind('royale', 'ROYALE', 'soul', 16)],
  up: [grind('torque', 'TORQUE SOUL', 'torque', 20), grind('sweatstance', 'SWEATSTANCE', 'torque', 22)],
  down: [grind('acid', 'TOP ACID', 'acid', 18), grind('fastslide', 'FASTSLIDE', 'fastslide', 15)],
  left: [grind('makio', 'MAKIO', 'makio', 16), grind('backslide', 'BACKSLIDE', 'makio', 19)],
  right: [grind('mizou', 'MIZOU', 'makio', 17), grind('pornstar', 'PORNSTAR', 'torque', 21)],
  upLeft: [grind('unity', 'UNITY', 'unity', 23)],
  upRight: [grind('xgrind', 'X-GRIND', 'unity', 24)],
  downLeft: [grind('fahr', 'FAHRVERGNUGEN', 'fastslide', 26)],
  downRight: [grind('softsoul', 'SOYALE', 'soul', 20)],
};

// --- wall ------------------------------------------------------------------

export const WALL_TRICKS = [
  trick('wallride', 'WALL RIDE', 'wallride', 90, { kind: TRICK_KIND.WALL, duration: 0 }),
  trick('wallplant', 'WALL PLANT', 'wallplant', 140, { kind: TRICK_KIND.WALL, duration: 0 }),
];

// --- selection -------------------------------------------------------------

/** Nine-way direction from a stick, with a dead zone in the middle. */
export function directionFromInput(x, y, deadzone = 0.35) {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return 'neutral';
  const angle = Math.atan2(y, x);           // +y is up
  const octant = Math.round(angle / (Math.PI / 4));
  switch (((octant % 8) + 8) % 8) {
    case 0: return 'right';
    case 1: return 'upRight';
    case 2: return 'up';
    case 3: return 'upLeft';
    case 4: return 'left';
    case 5: return 'downLeft';
    case 6: return 'down';
    default: return 'downRight';
  }
}

/**
 * @param {number} x, y   stick position
 * @param {number} index  how many tricks have already been thrown this air
 * @param {boolean} spinning  whether a spin modifier is held
 */
export function pickAirTrick(x, y, index = 0, spinning = false) {
  if (spinning) return SPIN_TRICKS[Math.min(index, SPIN_TRICKS.length - 1)];
  const list = AIR_TRICKS[directionFromInput(x, y)] || AIR_TRICKS.neutral;
  return list[index % list.length];
}

export function pickGrindTrick(x, y, index = 0) {
  const list = GRIND_TRICKS[directionFromInput(x, y)] || GRIND_TRICKS.neutral;
  return list[index % list.length];
}

export function pickWallTrick(index = 0) {
  return WALL_TRICKS[index % WALL_TRICKS.length];
}

/** Every trick in the catalogue, for tooling and for clip lookups. */
export function allTricks() {
  const out = [];
  for (const list of Object.values(AIR_TRICKS)) out.push(...list);
  out.push(...SPIN_TRICKS);
  for (const list of Object.values(GRIND_TRICKS)) out.push(...list);
  out.push(...WALL_TRICKS);
  return out;
}

/** "METHOD AIR to 540 SPIN to SOUL GRIND" -- how a combo reads on the HUD. */
export function describeCombo(names, max = 4) {
  if (!names.length) return '';
  const shown = names.length > max ? names.slice(-max) : names;
  const prefix = names.length > max ? '... ' : '';
  return prefix + shown.join(' to ');
}

// Fail loudly at load if a trick names a pose that does not exist -- a silent
// missing pose just makes the rig do nothing, which is hard to spot.
for (const t of allTricks()) {
  if (!POSES[t.pose]) throw new Error(`Trick "${t.id}" references unknown pose "${t.pose}"`);
}
