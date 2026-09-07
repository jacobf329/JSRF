import * as THREE from 'three';
import { PlayerModel } from '../player/PlayerModel.js';
import { PSTATE } from '../player/Player.js';
import { clamp, dampAngle } from '../core/MathUtils.js';

const R = {
  radius: 0.42,
  height: 1.72,
  skateSpeed: 13.5,
  accel: 26,
  gravity: 34,
  hopSpeed: 9.5,

  // Reaching the wall
  approachRadius: 2.6,   // close enough to start going up
  climbSpeed: 5.2,       // metres per second up the face
  climbLead: 1.15,       // how far off the wall they hang while climbing

  // Painting. Unopposed, three rivals take about half the map in a five-minute
  // run at this pace -- enough that ignoring them loses, slow enough that a
  // player who keeps moving stays ahead of all three.
  sprayRate: { medium: 0.24, large: 0.17, xl: 0.12 },  // progress per second
  restTime: [6, 10],

  // Getting there. After a piece they cut across town before picking their
  // next wall, which paces the crew and reads as a gang moving through the
  // city rather than a vacuum cleaner working the nearest corner.
  roamDistance: [70, 150],
  roamTime: 9,
  repathTime: 1.4,       // no progress for this long and they try a detour
  detourTime: 1.3,
  giveUpTime: 26,        // still not there and the wall was a bad idea
  stuckLimit: 3,         // that many failed detours and they reset elsewhere

  // Getting hit
  bodyCheckSpeed: 16,
  bodyCheckRadius: 1.8,
  stunTime: 3.4,

  // Who they go after
  leaderDiscount: 40,    // metres of "free" distance for taking the leader's wall
};

const STATE = {
  SEEK: 'seek',
  ROAM: 'roam',
  TRAVEL: 'travel',
  CLIMB: 'climb',
  SPRAY: 'spray',
  REST: 'rest',
  STUN: 'stun',
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 0 };

/**
 * One AI skater working for a crew.
 *
 * It drives a real PlayerModel through a duck-typed pose object, so a rival is
 * the same rig a human in that gang would wear and reads at distance by its
 * colour alone. What it does not share is the player controller -- it steers
 * itself and climbs walls outright instead of chaining wallrides, because a
 * skater that cannot reach a wall is a skater that never contests anything.
 */
class Rival {
  constructor(gang, scene, bounds) {
    this.gang = gang;
    this.bounds = bounds;
    this.model = new PlayerModel(gang.id);
    scene.add(this.model.root);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.visualHeading = 0;
    this.grounded = false;

    this.state = STATE.SEEK;
    this.stateTime = 0;
    this.spot = null;
    this.anchor = new THREE.Vector3();
    this.detour = 0;
    this.detourSign = 1;
    this.noProgress = 0;
    this.lastDistance = Infinity;
    this.strikes = 0;
    this.restFor = 0;
    this.walls = 0;

    // Everything PlayerModel.update reads. Keeping it flat and explicit means
    // the rig animates without a Player, and without the model knowing.
    this.pose = {
      position: this.position,
      velocity: this.velocity,
      index: gang.id,
      time: 0,
      state: PSTATE.SKATE,
      groundSpeed: 0,
      speed: 0,
      visualHeading: 0,
      lean: 0,
      grounded: true,
      trickFlip: 0,
      trickSpin: 0,
      trickRoll: 0,
      trickPose: null,
      trickPoseWeight: 0,
      invulnerable: 0,
    };
  }

  get name() { return this.gang.name; }
  get speed() { return this.velocity.length(); }

  spawn(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this._enter(STATE.SEEK);
    this.spot = null;
    this.strikes = 0;
    this.walls = 0;
    this.model.root.visible = true;
  }

  _enter(state) {
    this.state = state;
    this.stateTime = 0;
  }

  /** Bowled over by a player at speed. Drops whatever they were painting. */
  knockdown(fromVelocity, graffiti) {
    if (this.state === STATE.STUN) return false;
    graffiti.cancel(this);
    this.spot = null;
    this._enter(STATE.STUN);
    _v.copy(fromVelocity).setY(0);
    if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
    _v.normalize();
    this.velocity.copy(_v).multiplyScalar(11);
    this.velocity.y = 6.5;
    return true;
  }

  // ------------------------------------------------------------- behaviour

  update(dt, ctx) {
    this.stateTime += dt;
    this.pose.time += dt;

    switch (this.state) {
      case STATE.SEEK: this._seek(ctx); break;
      case STATE.ROAM: this._roam(dt, ctx); break;
      case STATE.TRAVEL: this._travel(dt, ctx); break;
      case STATE.CLIMB: this._climb(dt, ctx); break;
      case STATE.SPRAY: this._spray(ctx); break;
      case STATE.REST: this._rest(dt); break;
      case STATE.STUN:
        if (this.stateTime > R.stunTime && this.grounded) this._enter(STATE.SEEK);
        break;
      default: break;
    }

    if (this.state !== STATE.CLIMB && this.state !== STATE.SPRAY) this._physics(dt, ctx.collision);
    this._drive(dt);
  }

  /**
   * Pick a wall.
   *
   * Nearest wins, except that the crew currently in front gets a standing
   * discount -- rivals gang up on whoever is winning, which keeps a runaway
   * leader from running away and gives a losing player something to do.
   */
  _seek(ctx) {
    const { graffiti, leader } = ctx;
    let best = null;
    let bestCost = Infinity;
    for (const spot of graffiti.spots) {
      if (spot.owner === this.gang) continue;
      if (graffiti.isClaimed(spot)) continue;
      if (ctx.blocked(this, spot)) continue;
      let cost = this.position.distanceTo(spot.data.position);
      if (spot.owner && spot.owner === leader) cost -= R.leaderDiscount;
      if (cost < bestCost) { bestCost = cost; best = spot; }
    }
    if (!best) { this.restFor = 2; this._enter(STATE.REST); return; }

    this.spot = best;
    this.anchor.copy(best.data.position).addScaledVector(best.data.normal, R.climbLead);
    this.detour = 0;
    this.noProgress = 0;
    this.lastDistance = Infinity;
    this._enter(STATE.TRAVEL);
  }

  /** Head somewhere else entirely before looking for the next wall. */
  _roam(dt, ctx) {
    _v.set(this.anchor.x - this.position.x, 0, this.anchor.z - this.position.z);
    if (_v.length() < 6 || this.stateTime > R.roamTime) { this._enter(STATE.SEEK); return; }
    this._advance(dt, _v, ctx);
  }

  _travel(dt, ctx) {
    const spot = this.spot;
    if (!spot || spot.owner === this.gang || ctx.graffiti.isClaimed(spot)) { this._enter(STATE.SEEK); return; }

    // Steer at the wall's footprint, not the wall itself: the anchor can be
    // thirty metres up a tower, and chasing it in XZ is the same either way.
    _v.set(this.anchor.x - this.position.x, 0, this.anchor.z - this.position.z);
    const flat = _v.length();

    if (flat < R.approachRadius) {
      const rise = this.anchor.y - this.position.y;
      if (rise > 1.2) { this._enter(STATE.CLIMB); return; }
      if (rise < -2.5) {
        // Standing on top of the thing they meant to paint the side of.
        this._fail(ctx);
        return;
      }
      this._begin(ctx);
      return;
    }

    if (this.stateTime > R.giveUpTime) { this._fail(ctx); return; }
    if (!this._advance(dt, _v, ctx)) this._fail(ctx);
  }

  /**
   * Skate along `dir`, working around whatever is in the way.
   *
   * There is no navmesh, so a stalled skater peels off at an angle for a
   * moment and comes back at the target on a different line. Returns false
   * once it has run out of lines to try.
   */
  _advance(dt, dir, ctx) {
    const flat = dir.length();
    if (flat > this.lastDistance - 0.35) this.noProgress += dt;
    else this.noProgress = 0;
    this.lastDistance = Math.min(this.lastDistance, flat);

    if (this.detour > 0) {
      this.detour -= dt;
      const a = this.detourSign * 1.05;
      _w.set(dir.x * Math.cos(a) - dir.z * Math.sin(a), 0, dir.x * Math.sin(a) + dir.z * Math.cos(a));
      dir.copy(_w);
    } else if (this.noProgress > R.repathTime) {
      this.detour = R.detourTime;
      this.detourSign = Math.random() < 0.5 ? -1 : 1;
      this.noProgress = 0;
      this.lastDistance = Infinity;
      this.strikes++;
      if (this.strikes > R.stuckLimit) return false;
      if (this.grounded) this.velocity.y = R.hopSpeed;
    }

    this._steer(dt, dir, R.skateSpeed);
    return true;
  }

  /** Run straight up the face. Nobody said rudies obey gravity. */
  _climb(dt, ctx) {
    if (!this.spot) { this._enter(STATE.SEEK); return; }
    this.velocity.set(0, 0, 0);
    this.grounded = false;

    const step = R.climbSpeed * dt;
    _v.subVectors(this.anchor, this.position);
    const remaining = _v.length();
    if (remaining <= step) {
      this.position.copy(this.anchor);
      this._begin(ctx);
      return;
    }
    this.position.addScaledVector(_v.divideScalar(remaining), step);
    this.heading = Math.atan2(-this.spot.data.normal.x, -this.spot.data.normal.z);
    if (this.stateTime > 12) this._fail(ctx);
  }

  _begin(ctx) {
    const spot = this.spot;
    const rate = R.sprayRate[spot.data.size] * ctx.difficulty;
    if (!ctx.graffiti.begin(spot, this, this.gang, { auto: true, rate })) {
      this._fail(ctx);
      return;
    }
    this.heading = Math.atan2(-spot.data.normal.x, -spot.data.normal.z);
    this._enter(STATE.SPRAY);
  }

  _spray(ctx) {
    // Graffiti drives the session; this only waits for it to end, however it
    // ends -- finished, or knocked out of their hands.
    if (ctx.graffiti.sessionFor(this)) return;
    this.spot = null;
    this.strikes = 0;
    this.restFor = R.restTime[0] + Math.random() * (R.restTime[1] - R.restTime[0]);
    this._enter(STATE.REST);
  }

  _rest(dt) {
    this.restFor -= dt;
    // Roll away from the wall so they are not stood in it when they set off.
    this.velocity.x *= Math.exp(-2 * dt);
    this.velocity.z *= Math.exp(-2 * dt);
    if (this.restFor > 0) return;

    const angle = Math.random() * Math.PI * 2;
    const reach = R.roamDistance[0] + Math.random() * (R.roamDistance[1] - R.roamDistance[0]);
    const edge = this.bounds - 20;
    this.anchor.set(
      clamp(this.position.x + Math.cos(angle) * reach, -edge, edge),
      this.position.y,
      clamp(this.position.z + Math.sin(angle) * reach, -edge, edge),
    );
    this.detour = 0;
    this.noProgress = 0;
    this.lastDistance = Infinity;
    this.strikes = 0;
    this._enter(STATE.ROAM);
  }

  _fail(ctx) {
    ctx.graffiti.cancel(this);
    if (this.spot) ctx.blacklist(this, this.spot);
    this.spot = null;
    this.strikes = 0;
    this.restFor = 0.8;
    this._enter(STATE.REST);
  }

  // -------------------------------------------------------------- movement

  _steer(dt, dir, maxSpeed) {
    const len = dir.length();
    if (len < 1e-4) return;
    dir.divideScalar(len);
    this.velocity.x += dir.x * R.accel * dt;
    this.velocity.z += dir.z * R.accel * dt;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }
    this.heading = Math.atan2(dir.x, dir.z);
  }

  _physics(dt, collision) {
    this.velocity.y -= R.gravity * dt;
    if (this.state === STATE.STUN) {
      const d = Math.exp(-1.6 * dt);
      this.velocity.x *= d;
      this.velocity.z *= d;
    }

    const steps = clamp(Math.ceil((this.velocity.length() * dt) / 0.3), 1, 5);
    const sub = dt / steps;
    let grounded = false;
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      this.position.addScaledVector(this.velocity, sub);
      const contacts = collision.resolveCapsule(this.position, R.radius, R.height, 3);
      for (const c of contacts) {
        const vn = this.velocity.dot(c.normal);
        if (vn < 0) this.velocity.addScaledVector(c.normal, -vn);
        if (c.normal.y > 0.5) grounded = true;
        else if (c.normal.y < 0.35) blocked = true;
      }
    }

    if (!grounded && this.velocity.y <= 0) {
      _v.copy(this.position).setY(this.position.y + 0.3);
      const hit = collision.raycast(_v, _down, 0.9, _hit);
      if (hit && hit.normal.y > 0.5) {
        this.position.y = hit.point.y;
        this.velocity.y = 0;
        grounded = true;
      }
    }
    this.grounded = grounded;

    // A kerb, a planter, a market stall: hop it rather than grind to a halt.
    if (blocked && grounded && this.state === STATE.TRAVEL) this.velocity.y = R.hopSpeed;

    // Nothing under them for a very long way means they have fallen out of the
    // world; put them back on the wall they were heading for.
    if (this.position.y < -40) {
      this.position.set(this.anchor.x, Math.max(2, this.anchor.y), this.anchor.z);
      this.velocity.set(0, 0, 0);
    }
  }

  /** Feed the rig. */
  _drive(dt) {
    const p = this.pose;
    const ground = Math.hypot(this.velocity.x, this.velocity.z);
    this.visualHeading = dampAngle(this.visualHeading, this.heading, 9, dt);

    p.groundSpeed = ground;
    p.speed = this.velocity.length();
    p.visualHeading = this.visualHeading;
    p.grounded = this.grounded;
    p.lean = 0;

    if (this.state === STATE.SPRAY) p.state = PSTATE.TAG;
    else if (this.state === STATE.CLIMB) p.state = PSTATE.WALLRIDE;
    else if (this.state === STATE.STUN) p.state = PSTATE.BAIL;
    else if (!this.grounded) p.state = PSTATE.AIR;
    else p.state = PSTATE.SKATE;

    this.model.update(dt, p);
  }

  dispose(scene) {
    scene.remove(this.model.root);
    if (this.model.dispose) this.model.dispose();
  }
}

/**
 * The crews nobody is playing.
 *
 * One skater per unplayed gang: enough that the map is visibly changing hands
 * while you are across town, few enough that a competent player can still out-
 * paint all of them.
 */
export class Rivals {
  constructor(scene, level, events, effects) {
    this.scene = scene;
    this.level = level;
    this.events = events;
    this.effects = effects;
    this.list = [];
    this.difficulty = 1;

    events.on('rival:tag', ({ player }) => { if (player && player.gang) player.walls++; });

    // Walls a rival could not physically reach. Remembered per skater so one
    // bad angle does not write a wall off for the whole crew.
    this._blacklist = new Map();
  }

  /** Stand up one skater for each gang no human is using. */
  setGangs(gangs) {
    for (const rival of this.list) rival.dispose(this.scene);
    const bounds = this.level.bounds || 300;
    this.list = gangs.map((gang) => new Rival(gang, this.scene, bounds));
    this._blacklist = new Map();
    this.reset();
  }

  reset() {
    const posts = this.level.policePosts;
    for (let i = 0; i < this.list.length; i++) {
      const rival = this.list[i];
      // Start each crew in a different district so the first minute is not a
      // scrum over the plaza.
      const post = posts.length
        ? posts[Math.floor((i + 0.5) * posts.length / Math.max(1, this.list.length)) % posts.length]
        : this.level.spawn;
      _v.copy(post).setY(post.y + 1.2);
      rival.spawn(_v);
      this._blacklist.set(rival, new Set());
    }
  }

  setVisible(visible) {
    for (const rival of this.list) rival.model.root.visible = visible;
  }

  update(dt, game) {
    if (!this.list.length) return;
    const graffiti = game.graffiti;
    const leader = game.mission ? game.mission.leadingGang : null;

    const ctx = {
      graffiti,
      collision: this.level.collision,
      leader,
      difficulty: this.difficulty,
      // A wall one skater could not physically reach is written off for that
      // skater only -- a different approach line may well work.
      blocked: (rival, spot) => this._blacklist.get(rival).has(spot),
      blacklist: (rival, spot) => this._blacklist.get(rival).add(spot),
    };

    for (const rival of this.list) {
      rival.update(dt, ctx);
      this._bodyChecks(rival, game);
    }
  }

  /** Skating through a rival at speed puts them on the floor. */
  _bodyChecks(rival, game) {
    for (const slot of game.slots) {
      const player = slot.player;
      if (player.speed < R.bodyCheckSpeed) continue;
      if (rival.position.distanceTo(player.position) > R.bodyCheckRadius) continue;
      if (!rival.knockdown(player.velocity, game.graffiti)) continue;
      _v.copy(rival.position).setY(rival.position.y + 1);
      this.effects.burst(_v, rival.gang.color, 26, 7);
      this.events.emit('rival:knockdown', { rival, player, gang: rival.gang });
    }
  }
}

export const RIVAL_TUNING = R;
