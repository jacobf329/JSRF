import * as THREE from 'three';
import { SKATER as C } from './PlayerConfig.js';
import { SURFACE } from '../world/Collision.js';
import { RAIL_TYPE } from '../world/Rail.js';
import { clamp, dampAngle, damp } from '../core/MathUtils.js';
import { pickAirTrick, pickGrindTrick, pickWallTrick, directionFromInput } from './Tricks.js';

export const PSTATE = {
  SKATE: 'skate',
  AIR: 'air',
  GRIND: 'grind',
  WALLRIDE: 'wallride',
  TAG: 'tag',
  HIT: 'hit',
};


/** Ease-out so a spin whips round early and settles, rather than crawling. */
function ease(t) {
  return 1 - Math.pow(1 - t, 2.2);
}

const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _hv = new THREE.Vector3();
const _inputDir = new THREE.Vector3();
const _rayDir = new THREE.Vector3(0, -1, 0);
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 0 };
const _tangent = new THREE.Vector3();

/**
 * Momentum skater with a small state machine: skate -> air -> grind /
 * wallride, plus locked states for tagging and taking a hit.
 */
export class Player {
  constructor(level, events, options = {}) {
    this.index = options.index ?? 0;
    this.name = options.name ?? 'RUDIE';
    this.color = options.color ?? 0x24d6ff;
    this.level = level;
    this.collision = level.collision;
    this.rails = level.rails;
    this.events = events;

    this.position = level.spawn.clone();
    // Fan players out around the spawn so nobody starts inside anybody else.
    if (this.index > 0) {
      const a = (this.index / 4) * Math.PI * 2 + 0.6;
      this.position.x += Math.cos(a) * 5.5;
      this.position.z += Math.sin(a) * 5.5;
    }
    this.spawnPoint = this.position.clone();
    this.velocity = new THREE.Vector3();
    this.heading = level.spawnHeading;
    this.visualHeading = this.heading;
    this.lean = 0;
    this.pitch = 0;

    this.state = PSTATE.AIR;
    this.stateTime = 0;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundSurface = SURFACE.DEFAULT;
    this.lastGroundedTime = 0;
    this.time = 0;

    this.boost = C.boostMax;
    this.boosting = false;
    this.health = 3;
    this.invulnerable = 0;

    this.jumpBuffer = 0;
    this.jumpHeld = 0;
    this.grindCooldown = 0;
    this.wallrideCooldown = 0;

    this.rail = null;
    this.railDist = 0;
    this.railDir = 1;
    // Hopping off a rail used to drop you straight back onto it: you leave
    // moving along the rail, so you are still directly above it when the
    // cooldown ends. Several rails are closed loops, so that read as "you can
    // never get off".
    this.noRelatchRail = null;
    this.noRelatchTimer = 0;
    this.railSpeed = 0;
    this.grindDistance = 0;
    this.grindTrick = pickGrindTrick(0, 0, 0);

    this.wallNormal = new THREE.Vector3();
    this.wallTrick = null;
    this.wallTimer = 0;
    this.wallContact = null;

    this.trick = null;
    this.trickTimer = 0;
    this.trickDuration = 1;
    this.trickSpin = 0;
    this.trickFlip = 0;
    this.trickRoll = 0;
    // What the rig should be shaped like right now, and how strongly.
    this.trickPose = null;
    this.trickPoseWeight = 0;
    this.grindVariant = 0;
    this.grindDirection = 'neutral';
    this.airTricks = 0;
    this.airTime = 0;
    this.peakAirTime = 0;

    this.tagTarget = null;
    this.speed = 0;
    this.groundSpeed = 0;
    this.cameraYaw = level.spawnHeading;

    this._contactWall = new THREE.Vector3();
    this._hasWallContact = false;
  }

  get isLocked() { return this.state === PSTATE.TAG || this.state === PSTATE.HIT; }

  get eyePosition() {
    return _tmp2.copy(this.position).addScaledVector(_up, C.height * 0.85);
  }

  setState(next) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.stateTime = 0;
    this.events.emit('player:state', { prev, next, player: this });
  }

  // ------------------------------------------------------------------ update

  update(dt, input, cameraYaw) {
    this.time += dt;
    this.stateTime += dt;
    this.cameraYaw = cameraYaw;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.grindCooldown = Math.max(0, this.grindCooldown - dt);
    this.noRelatchTimer = Math.max(0, this.noRelatchTimer - dt);
    if (this.noRelatchTimer <= 0) this.noRelatchRail = null;
    this.wallrideCooldown = Math.max(0, this.wallrideCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (input.pressed('jump')) this.jumpBuffer = C.jumpBufferTime;

    this._updateBoost(dt, input);

    switch (this.state) {
      case PSTATE.GRIND: this._updateGrind(dt, input); break;
      case PSTATE.WALLRIDE: this._updateWallride(dt, input); break;
      case PSTATE.TAG: this._updateTag(dt); break;
      case PSTATE.HIT: this._updateHit(dt); break;
      default: this._updateFree(dt, input); break;
    }

    this._updateTrickAnimation(dt);

    this.speed = this.velocity.length();
    this.groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.visualHeading = dampAngle(this.visualHeading, this.heading, 16, dt);
  }

  _updateBoost(dt, input) {
    const wants = input.down('boost') && !this.isLocked;
    if (wants && this.boost > (this.boosting ? 0 : C.boostMinToStart)) {
      this.boosting = true;
      this.boost = Math.max(0, this.boost - C.boostDrain * dt);
      if (this.boost <= 0) this.boosting = false;
    } else {
      this.boosting = false;
      let regen = C.boostRegen;
      if (this.state === PSTATE.GRIND) regen = C.boostRegenGrind;
      else if (this.state === PSTATE.WALLRIDE) regen = C.boostRegenGrind * 0.8;
      this.boost = Math.min(C.boostMax, this.boost + regen * dt);
    }
  }

  /**
   * Camera-relative input direction on the XZ plane.
   *
   * The chase camera sits at `target - (sin yaw, cos yaw) * distance`, so it
   * looks along forward = (sin yaw, 0, cos yaw). Facing that way with Y up,
   * screen-right is (-cos yaw, 0, sin yaw) -- the opposite of what a naive
   * rotation gives, which is why pushing right used to send you left.
   */
  _inputWorldDir(input, out) {
    const s = Math.sin(this.cameraYaw);
    const c = Math.cos(this.cameraYaw);
    const ix = input.move.x;
    const iz = input.move.y;
    out.set(iz * s - ix * c, 0, iz * c + ix * s);
    return out;
  }

  // ------------------------------------------------------------ free skating

  _updateFree(dt, input) {
    const throttle = Math.hypot(input.move.x, input.move.y);
    this._inputWorldDir(input, _inputDir);

    if (throttle > 0.12) {
      const desired = Math.atan2(_inputDir.x, _inputDir.z);
      const rate = this.grounded
        ? THREE.MathUtils.lerp(C.turnRateSlow, C.turnRateFast, clamp(this.groundSpeed / C.maxSpeed, 0, 1))
        : C.airTurnRate;
      this.heading = dampAngle(this.heading, desired, rate, dt);
    }

    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));

    if (this.grounded) this._groundMove(dt, input, throttle);
    else this._airMove(dt, input, throttle);

    if (this._integrate(dt, input)) return;   // caught a rail mid-flight
    this._postMove(dt, input);
  }

  _groundMove(dt, input, throttle) {
    const n = this.groundNormal;
    // Forward along the slope.
    _tmp.copy(_fwd).addScaledVector(n, -_fwd.dot(n));
    if (_tmp.lengthSq() < 1e-6) _tmp.copy(_fwd);
    _tmp.normalize();

    _hv.set(this.velocity.x, 0, this.velocity.z);
    let speed = _hv.length();

    // Skate grip: the wheels drag the velocity toward the facing direction.
    if (speed > 0.05) {
      const grip = THREE.MathUtils.lerp(C.gripSlow, C.gripFast, clamp(speed / C.maxSpeed, 0, 1));
      const t = 1 - Math.exp(-grip * dt);
      _hv.x = THREE.MathUtils.lerp(_hv.x / speed, _fwd.x, t);
      _hv.z = THREE.MathUtils.lerp(_hv.z / speed, _fwd.z, t);
      const l = Math.hypot(_hv.x, _hv.z) || 1;
      _hv.set((_hv.x / l) * speed, 0, (_hv.z / l) * speed);
    }

    const maxSpeed = this.boosting ? C.boostSpeed : C.maxSpeed;
    const accel = this.boosting ? C.boostAccel : C.accel;

    if (throttle > 0.12) {
      _hv.x += _fwd.x * accel * throttle * dt;
      _hv.z += _fwd.z * accel * throttle * dt;
    } else if (this.boosting) {
      _hv.x += _fwd.x * accel * 0.6 * dt;
      _hv.z += _fwd.z * accel * 0.6 * dt;
    } else {
      const f = Math.exp(-C.friction * dt);
      _hv.x *= f; _hv.z *= f;
    }

    // Slope gravity.
    _tmp2.set(0, -1, 0).addScaledVector(n, n.y);
    _hv.x += _tmp2.x * C.slopeAccel * dt;
    _hv.z += _tmp2.z * C.slopeAccel * dt;

    speed = Math.hypot(_hv.x, _hv.z);
    if (speed > maxSpeed) {
      // Soft clamp: keep downhill overspeed but bleed it off.
      const target = Math.max(maxSpeed, speed - (speed - maxSpeed) * 6 * dt);
      const s = target / speed;
      _hv.x *= s; _hv.z *= s;
      speed = target;
    }

    this.velocity.x = _hv.x;
    this.velocity.z = _hv.z;
    // Follow the slope instead of launching off every bump.
    if (n.y > 0.2) this.velocity.y = -(n.x * _hv.x + n.z * _hv.z) / n.y;

    this.lean = damp(this.lean, clamp(input.move.x * clamp(speed / C.maxSpeed, 0, 1), -1, 1), 8, dt);

    if (this.jumpBuffer > 0) this._jump();
  }

  _airMove(dt, input, throttle) {
    this.airTime += dt;
    this.velocity.y -= C.gravity * dt;

    if (this.jumpHeld > 0 && input.down('jump')) {
      this.jumpHeld -= dt;
      this.velocity.y += C.jumpHoldBoost * dt;
    } else {
      this.jumpHeld = 0;
    }

    if (throttle > 0.12) {
      const control = C.airControl * (this.boosting ? 1.6 : 1);
      this.velocity.x += _fwd.x * control * throttle * dt;
      this.velocity.z += _fwd.z * control * throttle * dt;
    }

    const drag = Math.exp(-C.airDrag * dt);
    this.velocity.x *= drag;
    this.velocity.z *= drag;
    this.velocity.y = Math.max(this.velocity.y, -C.terminalVelocity);

    this.lean = damp(this.lean, input.move.x * 0.6, 5, dt);

    // Two trick buttons in the air: A throws grabs and flips, X throws spins.
    // Spray is only ever used against a wall on the ground, so it is free here.
    if (this.airTime > 0.1 && !this.trick && this.airTricks < C.maxAirTricks) {
      if (this.jumpBuffer > 0) {
        this.jumpBuffer = 0;
        this._startTrick(input, false);
      } else if (input.pressed('spray')) {
        this._startTrick(input, true);
      }
    }
  }

  _jump() {
    const canJump = this.grounded || (this.time - this.lastGroundedTime) < C.coyoteTime;
    if (!canJump) return;
    this.jumpBuffer = 0;
    this.grounded = false;
    this.airTime = 0;
    this.airTricks = 0;
    // Jump off the surface normal so ramps and banks throw you outward.
    _tmp.copy(this.groundNormal).lerp(_up, 0.55).normalize();
    this.velocity.addScaledVector(_tmp, C.jumpSpeed);
    this.jumpHeld = C.jumpHoldTime;
    this.setState(PSTATE.AIR);
    this.events.emit('player:jump', { player: this });
  }

  // -------------------------------------------------------------- integrate

  /**
   * Advance and depenetrate, sub-stepped so nothing tunnels at speed.
   *
   * When `input` is given and the skater is airborne, each sub-step also looks
   * for a rail. Testing once per frame instead meant a fast fall crossed the
   * rail and landed in the same frame, and the ground always won -- which is
   * why rails that sit close above a kerb or ledge could not be caught at all.
   *
   * Returns true if a rail was caught, in which case the caller must not carry
   * on with its own post-move handling.
   */
  _integrate(dt, input = null) {
    const speed = this.velocity.length();
    const steps = clamp(Math.ceil((speed * dt) / 0.22), 1, 8);
    const sub = dt / steps;

    let grounded = false;
    this.groundNormal.set(0, 0, 0);
    this._hasWallContact = false;
    let groundSurface = SURFACE.DEFAULT;
    let bestWallDot = 0;

    for (let i = 0; i < steps; i++) {
      this.position.addScaledVector(this.velocity, sub);
      const contacts = this.collision.resolveCapsule(this.position, C.radius, C.height);
      let stepGrounded = false;
      for (let c = 0; c < contacts.length; c++) {
        const contact = contacts[c];
        const n = contact.normal;
        const vn = this.velocity.dot(n);
        if (vn < 0) this.velocity.addScaledVector(n, -vn);
        if (n.y > 0.5) {
          grounded = true;
          stepGrounded = true;
          this.groundNormal.add(n);
          groundSurface = contact.surface;
        } else if (Math.abs(n.y) < 0.65) {
          const horiz = Math.hypot(n.x, n.z);
          if (horiz > bestWallDot) {
            bestWallDot = horiz;
            this._contactWall.copy(n);
            this._hasWallContact = true;
            this._wallSurface = contact.surface;
          }
        }
      }

      // Only from a genuine airborne state, so skating past a kerb rail never
      // snatches the player onto it.
      if (input && !stepGrounded && this.state === PSTATE.AIR) {
        this._tryGrind(input);
        if (this.state === PSTATE.GRIND) return true;
      }
    }

    if (grounded) {
      this.groundNormal.normalize();
      this.groundSurface = groundSurface;
    } else {
      this.groundNormal.set(0, 1, 0);
    }
    this.grounded = grounded;
    return false;
  }

  _postMove(dt, input) {
    const wasAir = this.state === PSTATE.AIR;

    // Look for a rail before accepting a ground snap. Rails sit just above the
    // kerbs and ledges they run along, so snapping first meant the snap always
    // won and a low rail could never be caught at all.
    if (!this.grounded) {
      this._tryGrind(input);
      if (this.state === PSTATE.GRIND) return;
    }

    if (!this.grounded && this.velocity.y <= 0.5) {
      // Ground snap keeps stairs and small ledges from launching the skater.
      _tmp.copy(this.position).addScaledVector(_up, 0.25);
      const hit = this.collision.raycast(_tmp, _rayDir, 0.25 + C.groundSnapDistance, _hit);
      if (hit && hit.normal.y > 0.5 && (wasAir ? this.airTime > 0.08 : true)) {
        const drop = hit.point.y;
        if (this.position.y - drop < C.groundSnapDistance) {
          this.position.y = drop;
          this.groundNormal.copy(hit.normal);
          this.groundSurface = hit.surface;
          this.grounded = true;
          this.velocity.y = Math.min(this.velocity.y, 0);
        }
      }
    }

    if (this.grounded) {
      this.lastGroundedTime = this.time;
      if (wasAir) this._land();
      else this.setState(PSTATE.SKATE);
    } else if (this.state === PSTATE.SKATE) {
      this.airTime = 0;
      this.airTricks = 0;
      this.setState(PSTATE.AIR);
    }

    if (this.state === PSTATE.AIR || this.state === PSTATE.SKATE) this._tryWallride(dt, input);

    if (this.position.y < -40) this.respawn();
  }

  _land() {
    const airTime = this.airTime;
    const impact = -this.velocity.y;
    this.airTime = 0;
    this.airTricks = 0;
    this.trick = null;
    this.trickSpin = 0;
    this.trickFlip = 0;
    this.setState(PSTATE.SKATE);
    this.events.emit('player:land', { player: this, airTime, impact });
  }

  // ------------------------------------------------------------------ grind

  _tryGrind(input) {
    if (this.grindCooldown > 0) return;
    if (this.velocity.y > 6) return;
    // Other rails stay latchable straight away, so rail-to-rail transfers keep
    // their snap; only the one just left is off limits.
    const blocked = this.noRelatchTimer > 0 ? this.noRelatchRail : null;
    const hit = this.rails.find(
      this.position,
      C.grindSnapDistance + C.radius,
      blocked ? (rail) => rail !== blocked : null,
    );
    if (!hit) return;

    // Narrow phase. The rail has to be near underfoot, not merely somewhere in
    // a sphere around the skater: you catch a rail by coming down onto it. A
    // fat spherical radius meant anything within a couple of metres in any
    // direction grabbed you, which is what made rails impossible to leave.
    const dx = hit.point.x - this.position.x;
    const dy = hit.point.y - this.position.y;
    const dz = hit.point.z - this.position.z;
    if (Math.hypot(dx, dz) > C.grindGrabRadius) return;
    if (dy > C.grindGrabAbove || dy < -C.grindGrabBelow) return;

    // Only latch when moving roughly along the rail, or slow enough to just land on it.
    _hv.set(this.velocity.x, 0, this.velocity.z);
    const speed = _hv.length();
    let dir = 1;
    if (speed > 1.5) {
      // Right on a corner the closest point is the join between two segments,
      // and the tangent there belongs to whichever of them the search happened
      // to land on -- which can read as perpendicular to travel and refuse a
      // grind the player is lined up for. Sample either side and take the best
      // match; a genuine broadside approach still fails all three.
      let along = 0;
      for (const offset of [0, -0.7, 0.7]) {
        hit.rail.getTangentAt(hit.along + offset, _tangent);
        const dot = (_hv.x * _tangent.x + _hv.z * _tangent.z) / speed;
        if (Math.abs(dot) > Math.abs(along)) along = dot;
      }
      if (Math.abs(along) < 0.35) return;
      dir = along >= 0 ? 1 : -1;
    } else {
      _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      dir = _fwd.dot(hit.tangent) >= 0 ? 1 : -1;
    }
    const tangent = hit.tangent;

    this.rail = hit.rail;
    this.railDist = hit.along;
    this.railDir = dir;
    this.railSpeed = Math.max(C.grindMinSpeed, Math.max(speed, Math.abs(this.velocity.y) * 0.5));
    this.grindDistance = 0;
    this.grindVariant = 0;
    this.grindDirection = directionFromInput(input.move.x, input.move.y);
    this.grindTrick = pickGrindTrick(input.move.x, input.move.y, 0);
    this.position.copy(hit.point);
    this.position.y -= 0.02;
    this.velocity.set(tangent.x * this.railSpeed * dir, 0, tangent.z * this.railSpeed * dir);
    this.setState(PSTATE.GRIND);
    this.events.emit('player:grind:start', { player: this, rail: this.rail });
  }

  _updateGrind(dt, input) {
    const rail = this.rail;
    if (!rail) { this.setState(PSTATE.AIR); return; }

    rail.getTangentAt(this.railDist, _tmp);
    const slope = -_tmp.y * this.railDir;
    this.railSpeed += slope * C.grindGravity * dt;

    if (this.boosting) this.railSpeed += C.grindAccel * dt;
    const throttle = Math.hypot(input.move.x, input.move.y);
    this._inputWorldDir(input, _inputDir);
    if (throttle > 0.2) {
      const push = (_inputDir.x * _tmp.x + _inputDir.z * _tmp.z) * this.railDir;
      this.railSpeed += push * C.grindAccel * 0.8 * throttle * dt;
    }

    // Leaning a new way on the rail switches stance, and tapping the trick
    // button cycles the variants for that direction. Both keep the combo alive.
    const wanted = directionFromInput(input.move.x, input.move.y);
    const cycling = input.pressed('spray');
    if (wanted !== this.grindDirection || cycling) {
      if (cycling) this.grindVariant++;
      else this.grindVariant = 0;
      this.grindDirection = wanted;
      const next = pickGrindTrick(input.move.x, input.move.y, this.grindVariant);
      if (next !== this.grindTrick) {
        this.grindTrick = next;
        this.events.emit('player:grind:stance', { player: this, trick: next });
      }
    }

    this.railSpeed = clamp(this.railSpeed, 1.2, C.grindMaxSpeed);
    const step = this.railSpeed * this.railDir * dt;
    this.railDist = rail.wrap(this.railDist + step);
    this.grindDistance += Math.abs(step);

    rail.getPointAt(this.railDist, this.position);
    this.position.y -= 0.02;
    rail.getTangentAt(this.railDist, _tmp);
    this.heading = Math.atan2(_tmp.x * this.railDir, _tmp.z * this.railDir);
    this.velocity.set(_tmp.x * this.railSpeed * this.railDir, _tmp.y * this.railSpeed * this.railDir, _tmp.z * this.railSpeed * this.railDir);
    this.lean = damp(this.lean, input.move.x * 0.5, 8, dt);

    this.events.emit('player:grind:tick', { player: this, distance: Math.abs(step), rail });

    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this._exitGrind(true, input);
      return;
    }

    if (rail.atEnd(this.railDist, 0.02) && !rail.closed) {
      const goingOffStart = this.railDir < 0 && this.railDist <= 0.05;
      const goingOffEnd = this.railDir > 0 && this.railDist >= rail.totalLength - 0.05;
      if (goingOffStart || goingOffEnd) this._exitGrind(false);
    }
  }

  _exitGrind(hopped, input = null) {
    const rail = this.rail;
    const dist = this.grindDistance;
    this.rail = null;
    this.grindCooldown = C.grindCooldown;
    this.airTime = 0;
    this.airTricks = 0;
    if (hopped) {
      const boost = rail ? rail.boost : 1;
      this.velocity.multiplyScalar(C.grindExitSpeedKeep * boost);
      this.velocity.y = C.grindHopSpeed;
      this.jumpHeld = C.jumpHoldTime;
      // Bail in the direction you are holding, so stepping off sideways is a
      // decision rather than a wrestle with the rail.
      if (input) {
        const throttle = Math.hypot(input.move.x, input.move.y);
        if (throttle > 0.2) {
          this._inputWorldDir(input, _inputDir);
          this.velocity.addScaledVector(_inputDir, C.grindBailSpeed * throttle);
          this.heading = Math.atan2(_inputDir.x, _inputDir.z);
        }
      }
      this.noRelatchRail = rail;
      this.noRelatchTimer = C.grindRelatchLockout;
    }
    this.setState(PSTATE.AIR);
    this.events.emit('player:grind:end', { player: this, distance: dist, hopped, rail });
  }

  // --------------------------------------------------------------- wallride

  _tryWallride(dt, input) {
    if (this.wallrideCooldown > 0 || !this._hasWallContact) return;
    if (this._wallSurface === SURFACE.SLICK) return;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < C.wallrideMinSpeed) return;

    const n = this._contactWall;
    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    // Need to be moving into the wall rather than sliding away from it.
    if (_fwd.x * n.x + _fwd.z * n.z > -0.15) return;

    this.wallNormal.copy(n).setY(0).normalize();
    this.wallTrick = pickWallTrick(0);
    this.wallTimer = C.wallrideTime;
    // Project momentum along the wall so we keep speed.
    _tmp.copy(this.velocity);
    _tmp.addScaledVector(this.wallNormal, -_tmp.dot(this.wallNormal));
    this.velocity.copy(_tmp);
    this.velocity.y = Math.max(this.velocity.y, C.wallrideRise * clamp(speed / C.maxSpeed, 0.4, 1.3));
    this.setState(PSTATE.WALLRIDE);
    this.events.emit('player:wallride:start', { player: this });
  }

  _updateWallride(dt, input) {
    this.wallTimer -= dt;

    // Stick to the wall.
    this.velocity.addScaledVector(this.wallNormal, -this.velocity.dot(this.wallNormal) - 1.2);
    this.velocity.y -= C.wallrideDecay * dt;

    const throttle = Math.hypot(input.move.x, input.move.y);
    this._inputWorldDir(input, _inputDir);
    _right.crossVectors(_up, this.wallNormal).normalize();
    if (throttle > 0.15) {
      const along = _inputDir.dot(_right);
      this.velocity.addScaledVector(_right, along * 14 * dt);
      if (this.boosting) this.velocity.y += 8 * dt;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.heading = Math.atan2(this.velocity.x, this.velocity.z);
    this.lean = damp(this.lean, _right.dot(this.velocity) > 0 ? 0.9 : -0.9, 8, dt);

    this._integrate(dt);
    this.events.emit('player:wallride:tick', { player: this, dt });

    const stillTouching = this._hasWallContact && this._contactWall.dot(this.wallNormal) > 0.4;
    const bail = this.wallTimer <= 0 || !stillTouching || speed < 3 || this.grounded;

    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.velocity.addScaledVector(this.wallNormal, C.wallrideKick);
      this.velocity.y = Math.max(this.velocity.y, C.jumpSpeed * 0.92);
      this.jumpHeld = C.jumpHoldTime;
      this._exitWallride();
      return;
    }
    if (bail) this._exitWallride();
  }

  _exitWallride() {
    this.wallrideCooldown = C.wallrideCooldown;
    this.airTime = 0;
    this.airTricks = 0;
    const grounded = this.grounded;
    this.setState(grounded ? PSTATE.SKATE : PSTATE.AIR);
    this.events.emit('player:wallride:end', { player: this });
  }

  // ----------------------------------------------------------------- tricks

  _startTrick(input, spinning) {
    const trick = pickAirTrick(input.move.x, input.move.y, this.airTricks, spinning);
    this.trick = trick;
    this.trickDuration = trick.duration || C.trickTime;
    this.trickTimer = this.trickDuration;
    this.airTricks++;
    this.boost = Math.min(C.boostMax, this.boost + C.boostRegenTrick);
    this.events.emit('player:trick', { player: this, trick, index: this.airTricks });
  }

  _updateTrickAnimation(dt) {
    // Grinds and wall rides hold their stance for as long as they last, rather
    // than playing out over a fixed duration.
    if (this.state === PSTATE.GRIND && this.grindTrick) {
      this.trickPose = this.grindTrick.pose;
      this.trickPoseWeight = damp(this.trickPoseWeight, 1, 9, dt);
      this.trickSpin = damp(this.trickSpin, 0, 12, dt);
      this.trickFlip = damp(this.trickFlip, 0, 12, dt);
      this.trickRoll = damp(this.trickRoll, 0, 12, dt);
      return;
    }
    if (this.state === PSTATE.WALLRIDE) {
      this.trickPose = this.wallTrick ? this.wallTrick.pose : 'wallride';
      this.trickPoseWeight = damp(this.trickPoseWeight, 1, 10, dt);
      return;
    }

    if (!this.trick) {
      this.trickPoseWeight = damp(this.trickPoseWeight, 0, 11, dt);
      if (this.trickPoseWeight < 0.02) this.trickPose = null;
      this.trickSpin = damp(this.trickSpin, 0, 10, dt);
      this.trickFlip = damp(this.trickFlip, 0, 10, dt);
      this.trickRoll = damp(this.trickRoll, 0, 10, dt);
      return;
    }

    this.trickTimer -= dt;
    const t = 1 - clamp(this.trickTimer / this.trickDuration, 0, 1);
    const turn = Math.PI * 2 * ease(t);
    this.trickSpin = this.trick.spin * turn;
    this.trickFlip = this.trick.flip * turn;
    this.trickRoll = this.trick.roll * turn;

    // Snap into the shape, hold it, then release -- a grab that eases in and
    // out over its whole duration never actually looks like the pose.
    this.trickPose = this.trick.pose;
    this.trickPoseWeight = clamp(Math.min(t / 0.16, (1 - t) / 0.24), 0, 1);

    if (this.trickTimer <= 0) {
      this.trick = null;
      this.trickSpin = 0;
      this.trickFlip = 0;
      this.trickRoll = 0;
    }
  }

  // -------------------------------------------------------- locked states

  beginTag(spot) {
    this.tagTarget = spot;
    this.velocity.set(0, 0, 0);
    this.heading = Math.atan2(-spot.normal.x, -spot.normal.z);
    this.setState(PSTATE.TAG);
  }

  endTag() {
    this.tagTarget = null;
    this.setState(this.grounded ? PSTATE.SKATE : PSTATE.AIR);
  }

  _updateTag(dt) {
    this.velocity.set(0, -C.gravity * 0.4, 0);
    this._integrate(dt);
    this.velocity.set(0, 0, 0);
  }

  hit(fromPosition, damage = 1) {
    if (this.invulnerable > 0 || this.state === PSTATE.HIT) return false;
    this.health -= damage;
    this.invulnerable = 2.0;
    _tmp.subVectors(this.position, fromPosition).setY(0);
    if (_tmp.lengthSq() < 1e-4) _tmp.set(0, 0, 1);
    _tmp.normalize();
    this.velocity.copy(_tmp).multiplyScalar(C.hitKnockback);
    this.velocity.y = 7;
    this.rail = null;
    this.setState(PSTATE.HIT);
    this.events.emit('player:hit', { player: this, health: this.health });
    if (this.health <= 0) this.events.emit('player:down', { player: this });
    return true;
  }

  _updateHit(dt) {
    this.velocity.y -= C.gravity * dt;
    const drag = Math.exp(-2.0 * dt);
    this.velocity.x *= drag;
    this.velocity.z *= drag;
    this._integrate(dt);
    if (this.stateTime > C.hitStun && (this.grounded || this.stateTime > 3)) {
      this.setState(this.grounded ? PSTATE.SKATE : PSTATE.AIR);
    }
  }

  respawn(point = null) {
    this.position.copy(point || this.spawnPoint || this.level.spawn);
    this.velocity.set(0, 0, 0);
    this.rail = null;
    this.trick = null;
    this.boost = C.boostMax;
    this.invulnerable = 1.5;
    this.setState(PSTATE.AIR);
    this.events.emit('player:respawn', { player: this });
  }

  revive() {
    this.health = 3;
    this.respawn();
  }
}
