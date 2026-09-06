/** Tuning for the skater. Kept in one place so the feel is easy to iterate on. */
export const SKATER = {
  radius: 0.42,
  height: 1.78,

  gravity: 34,
  terminalVelocity: 62,

  accel: 30,
  maxSpeed: 19,
  boostSpeed: 31,
  boostAccel: 46,
  brakeDecel: 26,
  friction: 5.0,
  slopeAccel: 22,

  // Steering: tight at walking pace, wide and floaty at full tilt.
  turnRateSlow: 11.0,
  turnRateFast: 3.4,
  gripSlow: 12.0,
  gripFast: 5.0,

  airControl: 2.6,
  airTurnRate: 4.2,
  airDrag: 0.06,

  jumpSpeed: 12.6,
  jumpHoldBoost: 16,
  jumpHoldTime: 0.2,
  coyoteTime: 0.14,
  jumpBufferTime: 0.16,
  groundSnapDistance: 0.55,

  // Broad phase: how far the rail search looks at all.
  grindSnapDistance: 1.9,
  // Acceptance window, measured from the feet. A rail has to be close to
  // underfoot to be caught -- a fat spherical radius meant anything within a
  // couple of metres in any direction grabbed the skater, which is what made
  // rails feel impossible to leave.
  grindGrabRadius: 0.85,
  grindGrabAbove: 0.5,
  grindGrabBelow: 1.6,
  grindMinSpeed: 3.0,
  grindAccel: 7.0,
  grindMaxSpeed: 30,
  grindGravity: 12,
  grindExitSpeedKeep: 1.0,
  grindHopSpeed: 9.5,
  grindCooldown: 0.18,
  // Sideways push when bailing off a rail, and how long that rail stays
  // un-latchable afterwards so the hop actually leaves it.
  grindBailSpeed: 7.5,
  grindRelatchLockout: 0.55,

  wallrideMinSpeed: 8.0,
  wallrideTime: 1.9,
  wallrideRise: 7.5,
  wallrideDecay: 4.2,
  wallrideKick: 8.0,
  wallrideCooldown: 0.25,

  boostMax: 100,
  boostDrain: 34,
  boostRegen: 9,
  boostRegenGrind: 26,
  boostRegenTrick: 14,
  boostMinToStart: 8,

  trickTime: 0.42,
  maxAirTricks: 3,

  hitStun: 0.9,
  hitKnockback: 12,
};
