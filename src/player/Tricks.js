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

/**
 * How a trick's rotation is spread across its duration.
 *
 * The curve is most of a move's character: an even sweep reads as a turntable,
 * and what makes a trick look thrown is the body going somewhere fast and then
 * arriving. Every curve must run from exactly 0 to exactly 1 and never go
 * backwards -- a rotation that dips makes a flip visibly stutter the wrong way
 * mid-air, and one that does not end on 1 lands on the wrong number of turns.
 */
export const CURVES = {
  /** Whips round early and settles. The default. */
  ease: (t) => 1 - Math.pow(1 - t, 2.2),
  /** Winds up, then snaps, then arrives: slow, fast, slow. For heavy flips. */
  whip: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** Runs ahead of itself and settles back. For anything with a corked axis. */
  overshoot: (t) => {
    const e = 1 - Math.pow(1 - t, 2.4);
    return e + Math.sin(Math.PI * t) * 0.14 * (1 - t);
  },
  /** Holds, then throws it all at the end. For late shove-its. */
  late: (t) => Math.pow(t, 2.6),
  /** Dead even, for a slow deliberate rotation. */
  linear: (t) => t,
};

export function curveFor(name) {
  return CURVES[name] || CURVES.ease;
}

/**
 * Out and back: 0 at both ends, 1 in the middle.
 *
 * This is the "swing" -- amplitude the body throws out and hauls back, which
 * adds nothing to where it ends up. It has to return to exactly 0 or a trick
 * would land off-axis by whatever was left over.
 */
export function arc(t) {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

export const TRICK_KIND = {
  AIR: 'air',
  GRIND: 'grind',
  WALL: 'wall',
};

/**
 * Build a trick.
 *
 * `keys` is the sequence of poses the body travels through, played evenly
 * across the duration. One key is a held shape; three or four is a move. Most
 * tricks start from `coil` and end in `catch`, because what sells a trick is
 * the wind-up and the gather, not the frame in the middle.
 *
 * `spin`, `flip` and `roll` are whole turns, net, spread by `curve`.
 * `swingX/Y/Z` are radians the body throws out and hauls back in -- rotation
 * that does not add up to anything by the time it lands, which is what makes a
 * move look swung rather than turned.
 */
function trick(id, name, keys, points, opts = {}) {
  const list = Array.isArray(keys) ? keys : [keys];
  return {
    id,
    name,
    keys: list,
    pose: list[Math.min(1, list.length - 1)],   // the shape it reads as
    points,
    kind: opts.kind || TRICK_KIND.AIR,
    duration: opts.duration ?? 0.52,
    spin: opts.spin ?? 0,
    flip: opts.flip ?? 0,
    roll: opts.roll ?? 0,
    swingX: opts.swingX ?? 0,
    swingY: opts.swingY ?? 0,
    swingZ: opts.swingZ ?? 0,
    curve: opts.curve || 'ease',
    clip: opts.clip || `trick_${id}`,
  };
}

// Shorthands for the two bookends almost every air trick shares.
const C = 'coil';
const K = 'catch';

// --- air, by the direction held -------------------------------------------

export const AIR_TRICKS = {
  neutral: [
    trick('kickflip', 'KICKFLIP', [C, 'tuck', K], 240, { roll: 1, duration: 0.46, curve: 'whip' }),
    trick('heelflip', 'HEELFLIP', [C, 'tuck', K], 260, { roll: -1, duration: 0.46, curve: 'whip' }),
    trick('hardflip', 'HARDFLIP', [C, 'corkscrew', 'tuck', K], 340, { roll: 1, spin: 0.5, duration: 0.6, curve: 'whip' }),
    trick('impossible', 'IMPOSSIBLE', [C, 'ball', 'scissor', K], 420, { roll: 2, duration: 0.7, curve: 'whip', swingX: 0.4 }),
    trick('bigspin', 'BIGSPIN', ['windLeft', 'ball', 'windRight', K], 460, { spin: 1.5, duration: 0.72, curve: 'late', swingZ: 0.5 }),
    trick('casper', 'CASPER FLIP', [C, 'scissor', 'frog', K], 500, { roll: 1.5, duration: 0.78, curve: 'late', swingY: 0.5 }),
    trick('pressure', 'PRESSURE FLIP', [C, 'kickout', 'tuck', K], 540, { roll: -2, spin: 0.5, duration: 0.8, curve: 'whip' }),
  ],
  up: [
    trick('rocket', 'ROCKET AIR', [C, 'rocket', K], 300, { duration: 0.6, swingX: -0.3 }),
    trick('christ', 'CHRIST AIR', [C, 'christ', 'starfish', K], 380, { duration: 0.72, swingX: -0.45 }),
    trick('superman', 'SUPERMAN', [C, 'superman', K], 420, { duration: 0.74, swingX: 0.5 }),
    trick('stiffy', 'STIFFY', [C, 'stiffy', K], 460, { duration: 0.76, swingX: -0.6 }),
    trick('layout', 'LAYOUT', ['coil', 'layout', 'starfish', K], 520, { duration: 0.82, swingX: -0.75 }),
    trick('crucifix', 'CRUCIFIX', [C, 'cross', 'christ', K], 560, { duration: 0.84, swingZ: 0.5 }),
    trick('skyhook', 'SKY HOOK', [C, 'rocket', 'invert', 'layout', K], 680, { flip: -0.5, duration: 0.95, curve: 'overshoot', swingX: -0.5 }),
  ],
  down: [
    trick('japan', 'JAPAN AIR', [C, 'japan', K], 320, { duration: 0.6, swingZ: 0.35 }),
    trick('tuckknee', 'TUCK KNEE', [C, 'tuck', K], 200, { duration: 0.42 }),
    trick('stalefish', 'STALEFISH', [C, 'stalefish', K], 340, { duration: 0.62, swingZ: -0.3 }),
    trick('cannonball', 'CANNONBALL', [C, 'ball', K], 300, { duration: 0.5, swingX: 0.5 }),
    trick('frogman', 'FROGMAN', [C, 'frog', 'pike', K], 400, { duration: 0.68, swingX: 0.55 }),
    trick('seatbelt', 'SEATBELT', [C, 'cross', 'ball', K], 380, { duration: 0.62, swingY: 0.45 }),
    trick('cannonroll', 'CANNON ROLL', [C, 'ball', 'ball', K], 620, { roll: 2, duration: 0.86, curve: 'whip' }),
  ],
  left: [
    trick('method', 'METHOD AIR', [C, 'method', K], 360, { duration: 0.68, swingZ: 0.55 }),
    trick('mute', 'MUTE GRAB', [C, 'indy', K], 260, { duration: 0.5, swingZ: -0.25 }),
    trick('backside', 'BACKSIDE AIR', ['windRight', 'method', 'windLeft', K], 400, { spin: -0.5, duration: 0.72, swingZ: 0.5 }),
    trick('sailleft', 'SAIL', [C, 'sail', K], 380, { duration: 0.66, swingZ: 0.7 }),
    trick('tailwhip', 'TAILWHIP', [C, 'tailwhip', 'kickout', K], 520, { duration: 0.78, swingZ: 0.8, curve: 'overshoot' }),
    trick('liu', 'LIU KANG', [C, 'scissor', 'sail', K], 480, { duration: 0.74, swingZ: 0.6 }),
    trick('mctwist', 'McTWIST', [C, 'invert', 'corkscrew', 'ball', K], 1150, { flip: -1, spin: 1.5, duration: 1.08, curve: 'overshoot', swingZ: 0.7 }),
  ],
  right: [
    trick('indy', 'INDY GRAB', [C, 'indy', K], 280, { duration: 0.52, swingZ: -0.3 }),
    trick('nosebone', 'NOSEBONE', [C, 'nosegrab', K], 300, { duration: 0.58, swingX: 0.4 }),
    trick('frontside', 'FRONTSIDE AIR', ['windLeft', 'indy', 'windRight', K], 400, { spin: 0.5, duration: 0.72, swingZ: -0.5 }),
    trick('sailright', 'SWITCH SAIL', [C, 'sailSwitch', K], 380, { duration: 0.66, swingZ: -0.7 }),
    trick('kickout', 'KICK OUT', [C, 'kickout', 'starfish', K], 460, { duration: 0.74, swingZ: -0.75, curve: 'overshoot' }),
    trick('nosepick', 'NOSE PICK', [C, 'nosegrab', 'pike', K], 440, { duration: 0.7, swingX: 0.55 }),
    trick('flatspin', 'FLATSPIN 540', [C, 'layout', 'starfish', K], 980, { spin: 1.5, roll: 0.5, duration: 1.0, curve: 'overshoot', swingX: -0.7 }),
  ],
  upLeft: [
    trick('backflip', 'BACKFLIP', [C, 'ball', 'layout', K], 480, { flip: -1, duration: 0.74, curve: 'whip' }),
    trick('mistyflip', 'MISTY FLIP', [C, 'corkscrew', 'invert', K], 620, { flip: -1, spin: 0.5, duration: 0.86, curve: 'overshoot' }),
    trick('doubleback', 'DOUBLE BACKFLIP', [C, 'ball', 'ball', 'layout', K], 1100, { flip: -2, duration: 1.1, curve: 'whip' }),
    trick('lincoln', 'LINCOLN LOOP', [C, 'starfish', 'invert', 'catch'], 980, { flip: -1, roll: 1, duration: 1.0, curve: 'overshoot', swingZ: 0.6 }),
    trick('wildcat', 'WILDCAT', [C, 'ball', 'invert', 'pike', K], 1250, { flip: -2, spin: 0.5, duration: 1.2, curve: 'whip', swingZ: 0.5 }),
  ],
  upRight: [
    trick('frontflip', 'FRONTFLIP', [C, 'ball', 'pike', K], 480, { flip: 1, duration: 0.74, curve: 'whip' }),
    trick('rodeo', 'RODEO 540', [C, 'corkscrew', 'invert', K], 660, { flip: 1, spin: 1.5, duration: 0.96, curve: 'overshoot' }),
    trick('doublefront', 'DOUBLE FRONTFLIP', [C, 'ball', 'ball', 'pike', K], 1100, { flip: 2, duration: 1.1, curve: 'whip' }),
    trick('bioloop', 'BIO LOOP', [C, 'invert', 'starfish', K], 1020, { flip: 1, roll: -1, duration: 1.0, curve: 'overshoot', swingZ: -0.6 }),
    trick('dblcork', 'DOUBLE CORK', [C, 'ball', 'invert', 'ball', K], 1500, { flip: 2, spin: 1, roll: 0.5, duration: 1.3, curve: 'whip', swingZ: -0.6 }),
  ],
  downLeft: [
    trick('handplant', 'HANDPLANT', [C, 'invertPlant', K], 420, { duration: 0.72, swingZ: 0.7 }),
    trick('sacktap', 'SACKTAP', [C, 'airwalk', K], 300, { duration: 0.5 }),
    trick('handstand', 'HANDSTAND AIR', [C, 'handstand', 'invert', K], 700, { duration: 0.9, swingX: -0.5 }),
    trick('miller', 'MILLER FLIP', [C, 'invertPlant', 'invert', K], 820, { flip: -1, spin: 0.5, duration: 0.95, curve: 'overshoot' }),
    trick('eggplant', 'EGGPLANT', [C, 'handstand', 'invertPlant', K], 760, { spin: 0.5, duration: 0.92, swingZ: 0.8 }),
    trick('sadplant', 'SAD PLANT', [C, 'invertPlant', 'scissor', K], 580, { duration: 0.8, swingZ: 0.65 }),
  ],
  downRight: [
    trick('madonna', 'MADONNA', [C, 'madonna', K], 380, { duration: 0.64, swingZ: -0.5 }),
    trick('airwalk', 'AIRWALK', [C, 'airwalk', 'scissor', K], 340, { duration: 0.62, swingX: 0.35 }),
    trick('pike', 'PIKE', [C, 'pike', K], 360, { duration: 0.6, swingX: 0.6 }),
    trick('alleyoop', 'ALLEY-OOP', ['windRight', 'madonna', 'sail', K], 760, { spin: -1, duration: 0.9, curve: 'overshoot', swingZ: 0.65 }),
    trick('judo', 'JUDO AIR', [C, 'kickout', 'scissor', K], 500, { duration: 0.76, swingZ: -0.6 }),
    trick('rocketroll', 'ROCKET ROLL', [C, 'rocket', 'layout', K], 880, { roll: 1.5, duration: 0.95, curve: 'overshoot', swingX: -0.5 }),
  ],
};

/**
 * Spins, stacked on top of any air trick by holding the shoulder buttons.
 *
 * Listed clockwise; holding the stick left mirrors each one rather than
 * doubling the table, so every spin is available both ways and a combo can
 * wind one way and unwind the other.
 */
export const SPIN_TRICKS = [
  trick('spin360', '360 SPIN', ['windLeft', 'corkscrew', K], 300, { spin: 1, duration: 0.6, curve: 'whip' }),
  trick('spin540', '540 SPIN', ['windLeft', 'corkscrew', 'ball', K], 520, { spin: 1.5, duration: 0.8, curve: 'whip' }),
  trick('spin720', '720 SPIN', ['windLeft', 'ball', 'corkscrew', K], 780, { spin: 2, duration: 0.95, curve: 'whip' }),
  trick('spin900', '900', ['windLeft', 'ball', 'ball', 'corkscrew', K], 1200, { spin: 2.5, duration: 1.15, curve: 'whip' }),
  trick('spin1080', '1080', ['windLeft', 'ball', 'ball', 'ball', K], 1700, { spin: 3, duration: 1.35, curve: 'whip' }),
  trick('cork1080', 'CORKED 1080', ['windLeft', 'ball', 'invert', 'corkscrew', K], 2100, { spin: 3, flip: 0.5, roll: 0.5, duration: 1.45, curve: 'overshoot', swingZ: 0.7 }),
];

// --- grind stances, by the direction held ---------------------------------

const grind = (id, name, pose, points, opts = {}) =>
  trick(id, name, pose, points, { ...opts, kind: TRICK_KIND.GRIND, duration: opts.duration ?? 0 });

export const GRIND_TRICKS = {
  neutral: [
    grind('soul', 'SOUL GRIND', 'soul', 14),
    grind('royale', 'ROYALE', 'soul', 16),
    grind('frontsoul', 'FRONTSIDE SOUL', 'grindSwitch', 19),
  ],
  up: [
    grind('torque', 'TORQUE SOUL', 'torque', 20),
    grind('sweatstance', 'SWEATSTANCE', 'torque', 22),
    grind('tallstance', 'TOP SOUL', 'grindTall', 24),
  ],
  down: [
    grind('acid', 'TOP ACID', 'acid', 18),
    grind('fastslide', 'FASTSLIDE', 'fastslide', 15),
    grind('crouchgrind', 'DARKSLIDE', 'grindLow', 21),
  ],
  left: [
    grind('makio', 'MAKIO', 'makio', 16),
    grind('backslide', 'BACKSLIDE', 'makio', 19),
    grind('reachleft', 'KIND GRIND', 'grindReach', 23),
  ],
  right: [
    grind('mizou', 'MIZOU', 'makio', 17),
    grind('pornstar', 'PORNSTAR', 'torque', 21),
    grind('grabgrind', 'SAVANNAH', 'grindGrab', 25),
  ],
  upLeft: [
    grind('unity', 'UNITY', 'unity', 23),
    grind('switchunity', 'SWITCH UNITY', 'grindSwitch', 27),
    grind('lowunity', 'UNITY SLIDE', 'grindLow', 30),
  ],
  upRight: [
    grind('xgrind', 'X-GRIND', 'unity', 24),
    grind('tallx', 'FULL TORQUE', 'grindTall', 28),
    grind('reachx', 'X-REACH', 'grindReach', 31),
  ],
  downLeft: [
    grind('fahr', 'FAHRVERGNUGEN', 'fastslide', 26),
    grind('lowfahr', 'SOYALE SLIDE', 'grindLow', 29),
    grind('grabfahr', 'TORQUE GRAB', 'grindGrab', 32),
  ],
  downRight: [
    grind('softsoul', 'SOYALE', 'soul', 20),
    grind('reachright', 'MISFIT', 'grindReach', 26),
    grind('switchmisfit', 'SWITCH MISFIT', 'grindSwitch', 30),
  ],
};

// --- wall ------------------------------------------------------------------

export const WALL_TRICKS = [
  trick('wallride', 'WALL RIDE', 'wallride', 90, { kind: TRICK_KIND.WALL, duration: 0 }),
  trick('wallplant', 'WALL PLANT', 'wallplant', 140, { kind: TRICK_KIND.WALL, duration: 0 }),
  trick('wallrun', 'WALL RUN', 'wallrun', 120, { kind: TRICK_KIND.WALL, duration: 0 }),
  trick('wallpush', 'KICK OFF', 'wallpush', 170, { kind: TRICK_KIND.WALL, duration: 0 }),
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
  if (spinning) {
    const base = SPIN_TRICKS[Math.min(index, SPIN_TRICKS.length - 1)];
    // Leaning left spins the other way. Mirrored on the fly rather than kept
    // as a second table, so the two directions can never drift apart.
    return x < -0.35 ? mirrorSpin(base) : base;
  }
  const list = AIR_TRICKS[directionFromInput(x, y)] || AIR_TRICKS.neutral;
  return list[index % list.length];
}

const MIRROR_KEYS = { windLeft: 'windRight', windRight: 'windLeft', sail: 'sailSwitch', sailSwitch: 'sail' };
const _mirrored = new Map();

/** The same spin the other way round, built once and cached. */
function mirrorSpin(base) {
  let out = _mirrored.get(base.id);
  if (out) return out;
  out = {
    ...base,
    id: `${base.id}_ccw`,
    name: base.name.startsWith('CORK') ? `${base.name} SWITCH` : `SWITCH ${base.name}`,
    keys: base.keys.map((k) => MIRROR_KEYS[k] || k),
    spin: -base.spin,
    roll: -base.roll,
    swingY: -base.swingY,
    swingZ: -base.swingZ,
    clip: `${base.clip}_ccw`,
  };
  out.pose = out.keys[Math.min(1, out.keys.length - 1)];
  _mirrored.set(base.id, out);
  return out;
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
  out.push(...SPIN_TRICKS, ...SPIN_TRICKS.map(mirrorSpin));
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
// missing pose just makes the rig do nothing, which is hard to spot. Every key
// in the sequence is checked, not only the one the trick reads as.
for (const t of allTricks()) {
  for (const key of t.keys) {
    if (!POSES[key]) throw new Error(`Trick "${t.id}" references unknown pose "${key}"`);
  }
}
