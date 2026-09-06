import * as THREE from 'three';
import { toon, flat } from '../render/Materials.js';
import { PALETTE } from '../render/Palette.js';
import { clamp, damp, dampAngle } from '../core/MathUtils.js';

const COP = {
  radius: 0.42,
  height: 1.8,
  walkSpeed: 3.2,
  chaseSpeed: 8.4,
  accel: 22,
  gravity: 34,
  sightRadius: 26,
  sightRadiusAlert: 46,
  attackRange: 2.1,
  attackWindup: 0.32,
  attackCooldown: 1.35,
  loseInterest: 5.0,
  stunTime: 3.2,
  knockdownSpeed: 17,
  maxDistanceFromPlayer: 110,
};

const STATE = { PATROL: 'patrol', CHASE: 'chase', ATTACK: 'attack', STUN: 'stun' };

const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 0 };

function box(w, h, d, color, pos) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  mesh.castShadow = true;
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  return mesh;
}

function limb(length, w, d, color) {
  const pivot = new THREE.Group();
  const mesh = box(w, length, d, color, [0, -length / 2, 0]);
  pivot.add(mesh);
  return pivot;
}

/** Riot-squad officer: model plus a small pursue/swing state machine. */
class Cop {
  constructor() {
    this.root = new THREE.Group();
    this.yaw = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.yaw);
    this.yaw.add(this.body);

    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);

    const navy = PALETTE.police;
    this.hips.add(box(0.6, 0.46, 0.36, navy, [0, 0.2, 0]));
    this.hips.add(box(0.68, 0.58, 0.42, 0x2c3a63, [0, 0.7, 0]));
    this.hips.add(box(0.72, 0.12, 0.46, PALETTE.policeAccent, [0, 0.46, 0]));

    this.neck = new THREE.Group();
    this.neck.position.y = 1.0;
    this.hips.add(this.neck);
    this.neck.add(box(0.36, 0.34, 0.34, navy, [0, 0.18, 0]));
    this.neck.add(box(0.42, 0.26, 0.4, 0x39476f, [0, 0.34, 0]));           // helmet
    this.neck.add(box(0.4, 0.12, 0.06, PALETTE.cyan, [0, 0.24, 0.19]));    // visor
    this.neck.add(box(0.1, 0.14, 0.1, PALETTE.bloodOrange, [0, 0.5, 0]));  // light

    this.armL = this._arm(1, navy);
    this.armR = this._arm(-1, navy);
    this.hips.add(this.armL.shoulder, this.armR.shoulder);

    // Baton in the right hand, shield on the left.
    this.baton = box(0.09, 0.62, 0.09, 0x1b1e2c, [0, -0.3, 0]);
    this.armR.hand.add(this.baton);
    const shield = box(0.1, 0.9, 0.62, 0x8fa4d6, [0.08, -0.35, 0]);
    shield.material = toon(0x8fa4d6, { transparent: true, opacity: 0.75, steps: 2 });
    this.armL.hand.add(shield);

    this.legL = this._leg(1, navy);
    this.legR = this._leg(-1, navy);
    this.hips.add(this.legL.hip, this.legR.hip);

    // Alert beacon that pops on when you are spotted.
    this.alert = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 6), flat(PALETTE.bloodOrange));
    this.alert.position.y = 2.55;
    this.alert.rotation.x = Math.PI;
    this.alert.visible = false;
    this.root.add(this.alert);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.state = STATE.PATROL;
    this.stateTime = 0;
    this.target = new THREE.Vector3();
    this.attackTimer = 0;
    this.cooldown = 0;
    this.lostTimer = 0;
    this.stride = Math.random() * 6.28;
    this.swing = 0;
    this.active = false;
    this.grounded = false;
    this.home = new THREE.Vector3();
  }

  _arm(side, color) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.42, 0.82, 0);
    const upper = limb(0.34, 0.17, 0.17, color);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    upper.add(elbow);
    const lower = limb(0.32, 0.15, 0.15, color);
    elbow.add(lower);
    const hand = new THREE.Group();
    hand.position.y = -0.32;
    lower.add(hand);
    return { shoulder, upper, elbow, lower, hand, side };
  }

  _leg(side, color) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.18, 0, 0);
    const thigh = limb(0.46, 0.21, 0.23, color);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    thigh.add(knee);
    const shin = limb(0.4, 0.18, 0.2, color);
    knee.add(shin);
    const foot = new THREE.Group();
    foot.position.y = -0.4;
    shin.add(foot);
    foot.add(box(0.22, 0.16, 0.4, 0x11131f, [0, -0.08, 0.06]));
    return { hip, thigh, knee, shin, foot };
  }

  spawn(position) {
    this.position.copy(position);
    this.home.copy(position);
    this.velocity.set(0, 0, 0);
    this.state = STATE.PATROL;
    this.stateTime = 0;
    this.cooldown = 0;
    this.lostTimer = 0;
    this.active = true;
    this.root.visible = true;
    this.target.copy(position);
  }

  despawn() {
    this.active = false;
    this.root.visible = false;
  }

  knockdown(fromVelocity) {
    this.state = STATE.STUN;
    this.stateTime = 0;
    _tmp.copy(fromVelocity).setY(0).normalize();
    this.velocity.copy(_tmp).multiplyScalar(11);
    this.velocity.y = 6.5;
  }

  update(dt, ctx) {
    const { collision, effects, events, alertRadius } = ctx;
    const player = ctx.pickTarget(this);
    this.target_player = player;
    this.stateTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    const toPlayer = _dir.subVectors(player.position, this.position);
    const dist = toPlayer.length();
    const flat2 = Math.hypot(toPlayer.x, toPlayer.z);

    switch (this.state) {
      case STATE.STUN:
        if (this.stateTime > COP.stunTime && this.grounded) {
          this.state = STATE.PATROL;
          this.stateTime = 0;
        }
        break;

      case STATE.PATROL: {
        if (dist < alertRadius && Math.abs(toPlayer.y) < 6) {
          this.state = STATE.CHASE;
          this.stateTime = 0;
          this.lostTimer = 0;
          events.emit('police:spot', { cop: this, player });
        } else {
          if (this.position.distanceTo(this.target) < 2.5 || this.stateTime > 6) {
            const a = Math.random() * Math.PI * 2;
            const r = 8 + Math.random() * 16;
            this.target.set(this.home.x + Math.cos(a) * r, this.position.y, this.home.z + Math.sin(a) * r);
            this.stateTime = 0;
          }
          this._steer(dt, this.target, COP.walkSpeed);
        }
        break;
      }

      case STATE.CHASE: {
        if (dist > COP.sightRadiusAlert || Math.abs(toPlayer.y) > 9) {
          this.lostTimer += dt;
          if (this.lostTimer > COP.loseInterest) {
            this.state = STATE.PATROL;
            this.stateTime = 0;
            this.home.copy(this.position);
          }
        } else {
          this.lostTimer = 0;
        }
        // Lead the target a little so they cut corners.
        _tmp.copy(player.position).addScaledVector(player.velocity, 0.22);
        _tmp.y = this.position.y;
        this._steer(dt, _tmp, COP.chaseSpeed);
        if (flat2 < COP.attackRange && Math.abs(toPlayer.y) < 2.2 && this.cooldown <= 0) {
          this.state = STATE.ATTACK;
          this.stateTime = 0;
          this.attackTimer = COP.attackWindup;
        }
        break;
      }

      case STATE.ATTACK: {
        this.velocity.x *= Math.exp(-8 * dt);
        this.velocity.z *= Math.exp(-8 * dt);
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          if (flat2 < COP.attackRange + 0.8 && Math.abs(toPlayer.y) < 2.4) {
            if (player.hit(this.position, 1)) {
              effects.impact(player.position.clone().setY(player.position.y + 1), 0xff4d2e, 18);
              events.emit('police:strike', { cop: this, player });
            }
          }
          this.cooldown = COP.attackCooldown;
          this.state = STATE.CHASE;
          this.stateTime = 0;
        }
        break;
      }
      default: break;
    }

    // The player can bowl cops over at speed.
    if (this.state !== STATE.STUN && dist < 1.5 && player.speed > COP.knockdownSpeed) {
      this.knockdown(player.velocity);
      effects.burst(this.position.clone().setY(this.position.y + 1), PALETTE.policeAccent, 22, 6);
      events.emit('police:knockdown', { cop: this, player });
    }

    this._physics(dt, collision);
    this._animate(dt);
  }

  _steer(dt, target, maxSpeed) {
    _tmp.subVectors(target, this.position);
    _tmp.y = 0;
    const len = _tmp.length();
    if (len < 0.05) return;
    _tmp.divideScalar(len);
    this.velocity.x += _tmp.x * COP.accel * dt;
    this.velocity.z += _tmp.z * COP.accel * dt;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }
    this.heading = Math.atan2(_tmp.x, _tmp.z);
  }

  _physics(dt, collision) {
    this.velocity.y -= COP.gravity * dt;
    if (this.state === STATE.STUN) {
      const d = Math.exp(-1.6 * dt);
      this.velocity.x *= d;
      this.velocity.z *= d;
    }

    const steps = clamp(Math.ceil((this.velocity.length() * dt) / 0.3), 1, 4);
    const sub = dt / steps;
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      this.position.addScaledVector(this.velocity, sub);
      const contacts = collision.resolveCapsule(this.position, COP.radius, COP.height, 3);
      for (const c of contacts) {
        const vn = this.velocity.dot(c.normal);
        if (vn < 0) this.velocity.addScaledVector(c.normal, -vn);
        if (c.normal.y > 0.5) grounded = true;
      }
    }

    if (!grounded && this.velocity.y <= 0) {
      _tmp.copy(this.position).setY(this.position.y + 0.3);
      const hit = collision.raycast(_tmp, _down, 0.9, _hit);
      if (hit && hit.normal.y > 0.5) {
        this.position.y = hit.point.y;
        this.velocity.y = 0;
        grounded = true;
      }
    }
    this.grounded = grounded;

    if (this.position.y < -30) this.despawn();
  }

  _animate(dt) {
    this.root.position.copy(this.position);
    this.yaw.rotation.y = dampAngle(this.yaw.rotation.y, this.heading, 10, dt);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const stunned = this.state === STATE.STUN;
    const chasing = this.state === STATE.CHASE || this.state === STATE.ATTACK;
    this.alert.visible = chasing;
    if (chasing) {
      this.alert.position.y = 2.55 + Math.sin(this.stateTime * 9) * 0.1;
      this.alert.rotation.y += dt * 5;
    }

    this.body.rotation.x = damp(this.body.rotation.x, stunned ? -1.35 : clamp(speed / 14, 0, 0.35), 8, dt);
    this.body.rotation.z = damp(this.body.rotation.z, stunned ? 0.7 : 0, 8, dt);
    this.hips.position.y = damp(this.hips.position.y, stunned ? 0.45 : 0.95, 8, dt);

    this.stride += dt * (2 + speed * 2.4);
    const s = Math.sin(this.stride);
    const amt = stunned ? 0 : clamp(speed / 6, 0.1, 1.1);

    this.legL.thigh.rotation.x = s * 0.75 * amt;
    this.legR.thigh.rotation.x = -s * 0.75 * amt;
    this.legL.shin.rotation.x = Math.max(0, -s) * 0.85 * amt;
    this.legR.shin.rotation.x = Math.max(0, s) * 0.85 * amt;

    // Baton swing on the attack windup.
    const attacking = this.state === STATE.ATTACK;
    this.swing = damp(this.swing, attacking ? 1 : 0, attacking ? 22 : 9, dt);
    this.armR.upper.rotation.x = -s * 0.6 * amt - this.swing * 2.5;
    this.armR.upper.rotation.z = 0.2 + this.swing * 0.4;
    this.armR.lower.rotation.x = -0.5 + this.swing * 0.9;
    this.armL.upper.rotation.x = s * 0.6 * amt - 0.5;
    this.armL.upper.rotation.z = -0.55;
    this.armL.lower.rotation.x = -1.1;
  }
}

/**
 * Spawns and retires officers based on how much heat the player has drawn.
 */
export class Police {
  constructor(scene, level, events, effects) {
    this.level = level;
    this.events = events;
    this.effects = effects;

    this.group = new THREE.Group();
    this.group.name = 'police';
    this.group.userData.noCollide = true;
    scene.add(this.group);

    this.pool = [];
    this.maxCops = 8;
    for (let i = 0; i < this.maxCops; i++) {
      const cop = new Cop();
      cop.despawn();
      this.group.add(cop.root);
      this.pool.push(cop);
    }

    this.heat = 0;
    this.maxHeat = 5;
    this.spawnTimer = 2.5;
    this.enabled = true;

    this._target = new THREE.Vector3();
    events.on('tag:complete', () => { this.heat = Math.min(this.maxHeat, this.heat + 1); });
    events.on('police:knockdown', () => { this.heat = Math.max(0, this.heat - 0.35); });
  }

  get activeCops() { return this.pool.filter((c) => c.active); }
  get chasing() { return this.pool.some((c) => c.active && (c.state === STATE.CHASE || c.state === STATE.ATTACK)); }

  reset() {
    for (const cop of this.pool) cop.despawn();
    this.heat = 0;
    this.spawnTimer = 3;
  }

  update(dt, game) {
    if (!this.enabled) return;
    const slots = game.slots;
    if (!slots.length) return;

    // Heat bleeds off, faster while everyone stays off the street.
    const allHigh = slots.every((s) => s.player.position.y > 8);
    this.heat = Math.max(0, this.heat - dt * (allHigh ? 0.16 : 0.05));

    // More rudies on the street means more of a response.
    const wanted = Math.min(this.maxCops, Math.floor(this.heat) + (slots.length - 1));
    const active = this.activeCops;

    this.spawnTimer -= dt;
    if (active.length < wanted && this.spawnTimer <= 0) {
      this.spawnTimer = 1.3;
      // Spawn near whoever has been busiest -- highest heat contribution is
      // hard to track, so use whoever most recently drew attention.
      this._spawnNear(slots[Math.floor(Math.random() * slots.length)].player);
    }

    const alertRadius = COP.sightRadius + this.heat * 3;
    const ctx = {
      collision: this.level.collision,
      effects: this.effects,
      events: this.events,
      alertRadius,
      // Each officer independently locks on to whoever is closest, so in
      // split-screen the squad naturally spreads across the players.
      pickTarget: (cop) => this._nearestPlayer(slots, cop.position),
    };

    for (const cop of this.pool) {
      if (!cop.active) continue;
      const nearest = this._nearestPlayer(slots, cop.position);
      if (cop.position.distanceTo(nearest.position) > COP.maxDistanceFromPlayer) {
        cop.despawn();
        continue;
      }
      cop.update(dt, ctx);
    }
  }

  _nearestPlayer(slots, position) {
    let best = slots[0].player;
    let bestDist = Infinity;
    for (const slot of slots) {
      const d = slot.player.position.distanceToSquared(position);
      if (d < bestDist) { bestDist = d; best = slot.player; }
    }
    return best;
  }

  _spawnNear(player) {
    const free = this.pool.find((c) => !c.active);
    if (!free) return;
    const posts = this.level.policePosts;
    let best = null;
    let bestScore = -Infinity;
    for (const post of posts) {
      const d = post.distanceTo(player.position);
      // Prefer somewhere close enough to matter but not right on top of them.
      const score = -Math.abs(d - 38) + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = post; }
    }
    if (!best) return;
    _tmp.copy(best);
    const y = this.level.collision.groundHeight(_tmp.x, _tmp.z, 40, 80);
    _tmp.y = (y ?? 0) + 0.05;
    free.spawn(_tmp);
    this.events.emit('police:spawn', { cop: free, heat: this.heat });
  }
}

export { COP, STATE as COP_STATE };
