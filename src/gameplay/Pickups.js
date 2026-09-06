import * as THREE from 'three';
import { toon, flat } from '../render/Materials.js';
import { PALETTE } from '../render/Palette.js';

const CAN_COLORS = [PALETTE.lime, PALETTE.hotPink, PALETTE.cyan, PALETTE.sunYellow, PALETTE.violet];
const RESPAWN_TIME = 22;
const PICKUP_RADIUS = 1.7;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _axis = new THREE.Vector3(0, 1, 0);

/**
 * Spray-can pickups. Drawn as two instanced meshes so thirty of them cost
 * two draw calls.
 */
export class Pickups {
  constructor(scene, level, events, effects) {
    this.events = events;
    this.effects = effects;

    const spots = level.canSpots;
    this.cans = spots.map((p, i) => ({
      home: p.clone(),
      active: true,
      respawn: 0,
      phase: i * 0.7,
      color: CAN_COLORS[i % CAN_COLORS.length],
      scale: 1,
    }));

    const bodyGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.62, 10);
    const capGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.16, 8);
    capGeo.translate(0, 0.38, 0);

    this.body = new THREE.InstancedMesh(bodyGeo, toon(0xffffff, { steps: 3 }), this.cans.length);
    this.cap = new THREE.InstancedMesh(capGeo, flat(0x1b1e2c), this.cans.length);
    this.body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cans.length * 3), 3);
    this.body.castShadow = true;
    this.body.frustumCulled = false;
    this.cap.frustumCulled = false;
    this.body.userData.noCollide = true;
    this.cap.userData.noCollide = true;

    const c = new THREE.Color();
    for (let i = 0; i < this.cans.length; i++) {
      c.set(this.cans[i].color);
      this.body.setColorAt(i, c);
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;

    this.group = new THREE.Group();
    this.group.name = 'pickups';
    this.group.add(this.body, this.cap);
    scene.add(this.group);

    this.time = 0;
  }

  update(dt, game) {
    this.time += dt;
    const slots = game.slots;

    for (let i = 0; i < this.cans.length; i++) {
      const can = this.cans[i];

      if (!can.active) {
        can.respawn -= dt;
        if (can.respawn <= 0) {
          can.active = true;
          can.scale = 0;
        } else {
          _p.set(0, -9999, 0);
          _m.compose(_p, _q, _s);
          this.body.setMatrixAt(i, _m);
          this.cap.setMatrixAt(i, _m);
          continue;
        }
      }

      can.scale = Math.min(1, can.scale + dt * 3.5);
      const bob = Math.sin(this.time * 2.2 + can.phase) * 0.18;
      _p.set(can.home.x, can.home.y + 0.5 + bob, can.home.z);
      _q.setFromAxisAngle(_axis, this.time * 1.9 + can.phase);
      _s.setScalar(can.scale);
      _m.compose(_p, _q, _s);
      this.body.setMatrixAt(i, _m);
      this.cap.setMatrixAt(i, _m);

      if (can.scale > 0.6) {
        // First player to reach it takes it.
        for (const slot of slots) {
          const pp = slot.player.position;
          const d = Math.hypot(_p.x - pp.x, _p.y - (pp.y + 0.9), _p.z - pp.z);
          if (d >= PICKUP_RADIUS) continue;
          can.active = false;
          can.respawn = RESPAWN_TIME;
          this.effects.burst(_p, can.color, 16, 4.5);
          this.events.emit('pickup:can', {
            position: _p.clone(), amount: 1, color: can.color, player: slot.player,
          });
          break;
        }
      }
    }

    _s.setScalar(1);
    this.body.instanceMatrix.needsUpdate = true;
    this.cap.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const can of this.cans) {
      can.active = true;
      can.respawn = 0;
      can.scale = 1;
    }
  }

  get activeCount() { return this.cans.reduce((n, c) => n + (c.active ? 1 : 0), 0); }
}
