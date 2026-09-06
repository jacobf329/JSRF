/**
 * Named body poses for tricks.
 *
 * A pose is a sparse set of joint channels; anything it leaves out keeps
 * whatever the locomotion animation produced, so a grab can change the arms
 * and legs without flattening the skating stride underneath it.
 *
 * Channels, all radians except `hips` (metres of crouch):
 *   hips                       vertical offset of the pelvis
 *   spineX spineZ              lean forward/back, roll left/right
 *   neckX                      head pitch
 *   armLX armLZ armLLower      left shoulder pitch, shoulder spread, elbow
 *   armRX armRZ armRLower      right, same
 *   legLThighX legLThighZ legLShin legLFoot
 *   legRThighX legRThighZ legRShin legRFoot
 */

export const POSES = {
  /** Knees to chest, arms in. The default air shape. */
  tuck: {
    hips: 0.16, spineX: -0.25,
    armLX: -0.7, armLZ: -0.7, armLLower: -1.5,
    armRX: -0.7, armRZ: 0.7, armRLower: -1.5,
    legLThighX: -1.5, legLShin: 1.9, legLThighZ: -0.2, legLFoot: -0.6,
    legRThighX: -1.5, legRShin: 1.9, legRThighZ: 0.2, legRFoot: -0.6,
  },

  /** Flat out, arms forward, legs trailing. */
  superman: {
    hips: 0.05, spineX: 1.25, neckX: -0.7,
    armLX: -2.6, armLZ: -0.16, armLLower: -0.1,
    armRX: -2.6, armRZ: 0.16, armRLower: -0.1,
    legLThighX: 0.5, legLShin: 0.35, legLThighZ: -0.12,
    legRThighX: 0.5, legRShin: 0.35, legRThighZ: 0.12,
  },

  /** Back arched, trailing skate grabbed behind the head. */
  method: {
    hips: 0.1, spineX: -0.55, spineZ: 0.5, neckX: 0.3,
    armLX: -2.7, armLZ: -0.5, armLLower: -1.2,
    armRX: 0.5, armRZ: 0.9, armRLower: -0.3,
    legLThighX: -0.5, legLShin: 2.3, legLThighZ: -0.5,
    legRThighX: -0.2, legRShin: 1.0, legRThighZ: 0.2,
  },

  /** Front hand to the outside skate, knees split. */
  indy: {
    hips: 0.14, spineX: 0.35, spineZ: -0.4,
    armLX: -0.4, armLZ: -1.0, armLLower: -0.4,
    armRX: -1.5, armRZ: 0.35, armRLower: -1.5,
    legLThighX: -1.2, legLShin: 1.5, legLThighZ: -0.6,
    legRThighX: -0.9, legRShin: 1.7, legRThighZ: 0.5,
  },

  /** Rear hand behind, back leg boned out straight. */
  stalefish: {
    hips: 0.12, spineX: 0.2, spineZ: 0.45,
    armLX: -1.6, armLZ: -0.4, armLLower: -1.6,
    armRX: 0.7, armRZ: 0.7, armRLower: -0.5,
    legLThighX: -1.3, legLShin: 1.6, legLThighZ: -0.35,
    legRThighX: 0.35, legRShin: 0.15, legRThighZ: 0.35,
  },

  /** Both skates pulled up under, knees out wide. */
  japan: {
    hips: 0.2, spineX: -0.4, spineZ: 0.25,
    armLX: -2.2, armLZ: -0.8, armLLower: -1.0,
    armRX: -0.3, armRZ: 0.8, armRLower: -0.8,
    legLThighX: -1.9, legLShin: 2.5, legLThighZ: -0.8,
    legRThighX: -0.6, legRShin: 2.0, legRThighZ: 0.6,
  },

  /** Legs kicked apart, arms out. */
  airwalk: {
    hips: 0.08, spineX: 0.1,
    armLX: -1.9, armLZ: -0.9, armLLower: -0.3,
    armRX: -1.9, armRZ: 0.9, armRLower: -0.3,
    legLThighX: -1.0, legLShin: 0.2, legLThighZ: -0.75,
    legRThighX: 0.85, legRShin: 0.25, legRThighZ: 0.75,
  },

  /** Arms straight out to the sides, body upright. */
  christ: {
    hips: -0.02, spineX: -0.15,
    armLX: 0.0, armLZ: -1.55, armLLower: 0.0,
    armRX: 0.0, armRZ: 1.55, armRLower: 0.0,
    legLThighX: 0.15, legLShin: 0.1, legLThighZ: -0.1,
    legRThighX: 0.15, legRShin: 0.1, legRThighZ: 0.1,
  },

  /** Both arms up, body stretched tall. */
  rocket: {
    hips: -0.06, spineX: -0.35, neckX: -0.35,
    armLX: -2.9, armLZ: -0.12, armLLower: -0.05,
    armRX: -2.9, armRZ: 0.12, armRLower: -0.05,
    legLThighX: 0.1, legLShin: 0.05, legLThighZ: -0.06,
    legRThighX: 0.1, legRShin: 0.05, legRThighZ: 0.06,
  },

  /** One hand planted below, body inverted over it. */
  handplant: {
    hips: 0.1, spineX: 0.9, spineZ: -0.7, neckX: -0.5,
    armLX: -0.3, armLZ: -1.3, armLLower: -0.2,
    armRX: 1.5, armRZ: 0.3, armRLower: -0.1,
    legLThighX: -0.9, legLShin: 1.5, legLThighZ: -0.5,
    legRThighX: -0.2, legRShin: 0.7, legRThighZ: 0.35,
  },

  /** Legs scissored wide, one arm hooked over. */
  madonna: {
    hips: 0.06, spineX: -0.3, spineZ: 0.55,
    armLX: -2.4, armLZ: -0.6, armLLower: -0.7,
    armRX: 0.3, armRZ: 1.1, armRLower: -0.2,
    legLThighX: -0.4, legLShin: 0.3, legLThighZ: -1.0,
    legRThighX: -1.4, legRShin: 2.1, legRThighZ: 0.55,
  },

  /** Compact spin shape: arms crossed tight to the chest. */
  corkscrew: {
    hips: 0.14, spineX: 0.15, spineZ: 0.3,
    armLX: -1.4, armLZ: 0.55, armLLower: -2.0,
    armRX: -1.4, armRZ: -0.55, armRLower: -2.0,
    legLThighX: -1.35, legLShin: 1.85, legLThighZ: -0.15,
    legRThighX: -1.35, legRShin: 1.85, legRThighZ: 0.15,
  },

  // --- grind stances -----------------------------------------------------

  /** Front foot square across the rail, back leg trailing. */
  soul: {
    hips: 0.3, spineX: 0.2, spineZ: 0.12,
    armLX: -0.5, armLZ: -1.35, armLLower: -0.5,
    armRX: -0.4, armRZ: 1.35, armRLower: -0.5,
    legLThighX: -0.85, legLShin: 0.55, legLThighZ: -0.45, legLFoot: -0.3,
    legRThighX: 0.55, legRShin: 0.3, legRThighZ: 0.3,
  },

  /** Front knee tucked high, back leg long. */
  makio: {
    hips: 0.36, spineX: 0.3, spineZ: -0.3,
    armLX: -1.8, armLZ: -0.9, armLLower: -0.4,
    armRX: -0.2, armRZ: 1.2, armRLower: -0.6,
    legLThighX: -1.5, legLShin: 1.5, legLThighZ: -0.6,
    legRThighX: 0.65, legRShin: 0.15, legRThighZ: 0.25,
  },

  /** Deep crouch, both knees folded, arms low. */
  acid: {
    hips: 0.52, spineX: 0.55, neckX: -0.3,
    armLX: 0.35, armLZ: -1.1, armLLower: -0.3,
    armRX: 0.35, armRZ: 1.1, armRLower: -0.3,
    legLThighX: -1.15, legLShin: 1.5, legLThighZ: -0.5,
    legRThighX: -1.0, legRShin: 1.6, legRThighZ: 0.5,
  },

  /** Torso twisted hard against the direction of travel. */
  torque: {
    hips: 0.3, spineX: 0.1, spineZ: 0.55,
    armLX: -1.2, armLZ: -0.3, armLLower: -1.3,
    armRX: 0.6, armRZ: 1.4, armRLower: -0.2,
    legLThighX: -0.7, legLShin: 0.9, legLThighZ: -0.7, legLFoot: -0.4,
    legRThighX: 0.45, legRShin: 0.5, legRThighZ: 0.55,
  },

  /** Legs crossed over one another on the rail. */
  unity: {
    hips: 0.34, spineX: 0.24, spineZ: -0.45,
    armLX: -1.5, armLZ: -0.5, armLLower: -0.9,
    armRX: -0.9, armRZ: 0.65, armRLower: -1.1,
    legLThighX: -0.6, legLShin: 0.8, legLThighZ: 0.35,
    legRThighX: -0.3, legRShin: 0.6, legRThighZ: -0.5,
  },

  /** Wide stance, board-flat across the rail. */
  fastslide: {
    hips: 0.28, spineX: 0.12, spineZ: 0.0,
    armLX: -0.2, armLZ: -1.5, armLLower: -0.2,
    armRX: -0.2, armRZ: 1.5, armRLower: -0.2,
    legLThighX: -0.35, legLShin: 0.35, legLThighZ: -0.85,
    legRThighX: -0.35, legRShin: 0.35, legRThighZ: 0.85,
  },

  // --- wall --------------------------------------------------------------

  /** Body flat to the wall, outside arm trailing. */
  wallride: {
    hips: 0.12, spineX: 0.1, spineZ: 0.95,
    armLX: -1.1, armLZ: -1.1, armLLower: -0.4,
    armRX: -0.5, armRZ: 0.8, armRLower: -0.9,
    legLThighX: -0.55, legLShin: 0.65, legLThighZ: -0.3,
    legRThighX: -0.25, legRShin: 0.45, legRThighZ: 0.3,
  },

  /** Coiled against the wall, about to kick off it. */
  wallplant: {
    hips: 0.34, spineX: 0.45, spineZ: 0.7,
    armLX: -2.5, armLZ: -0.4, armLLower: -0.3,
    armRX: -0.4, armRZ: 0.9, armRLower: -1.2,
    legLThighX: -1.3, legLShin: 1.7, legLThighZ: -0.4,
    legRThighX: -1.1, legRShin: 1.5, legRThighZ: 0.4,
  },
};

/** Channel names, so the rig can iterate without knowing each pose's shape. */
export const POSE_CHANNELS = Object.freeze([
  'hips', 'spineX', 'spineZ', 'neckX',
  'armLX', 'armLZ', 'armLLower', 'armRX', 'armRZ', 'armRLower',
  'legLThighX', 'legLThighZ', 'legLShin', 'legLFoot',
  'legRThighX', 'legRThighZ', 'legRShin', 'legRFoot',
]);

export function getPose(name) {
  return POSES[name] || null;
}
