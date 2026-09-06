import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDelta } from '../core/MathUtils.js';
import { PSTATE } from './Player.js';

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 0 };

/**
 * Chase camera that auto-aligns behind the skater's momentum but yields to
 * manual input, pulls in when the world gets between it and the player, and
 * widens its FOV with speed.
 */
export class FollowCamera {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;

    this.yaw = 0;
    this.pitch = 0.16;
    this.distance = 7.4;
    this.height = 1.55;
    this.currentDistance = this.distance;

    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.manualTimer = 0;
    this.baseFov = 64;
    this.shake = 0;
    this.shakeSeed = Math.random() * 100;

    this.mouseSensitivity = 0.0026;
    this.stickSensitivity = 2.6;
    this.invertY = false;
  }

  reset(player) {
    this.yaw = player.heading;
    this.pitch = 0.16;
    _target.copy(player.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.height);
    this._computeDesired(_target, this.distance, this.position);
    this.lookAt.copy(_target);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  _computeDesired(target, dist, out) {
    const cp = Math.cos(this.pitch);
    out.set(
      target.x - Math.sin(this.yaw) * cp * dist,
      target.y + Math.sin(this.pitch) * dist + 0.6,
      target.z - Math.cos(this.yaw) * cp * dist,
    );
    return out;
  }

  update(dt, player, input) {
    // --- manual look ---
    let manual = 0;
    if (input.pointerLocked && (input.mouseDelta.x || input.mouseDelta.y)) {
      this.yaw -= input.mouseDelta.x * this.mouseSensitivity;
      this.pitch += input.mouseDelta.y * this.mouseSensitivity * (this.invertY ? -1 : 1);
      manual = 1;
    }
    if (Math.abs(input.look.x) > 0.01 || Math.abs(input.look.y) > 0.01) {
      this.yaw -= input.look.x * this.stickSensitivity * dt;
      this.pitch += input.look.y * this.stickSensitivity * 0.6 * dt * (this.invertY ? -1 : 1);
      manual = 1;
    }
    this.pitch = clamp(this.pitch, -0.42, 1.02);
    if (manual) this.manualTimer = 1.1;
    else this.manualTimer = Math.max(0, this.manualTimer - dt);

    const tagging = player.state === PSTATE.TAG;

    // --- auto align behind momentum ---
    if (!tagging) {
      const speed = player.groundSpeed;
      if (this.manualTimer <= 0 && speed > 4) {
        const moveYaw = Math.atan2(player.velocity.x, player.velocity.z);
        const rate = clamp(speed / 16, 0, 1) * 2.6;
        this.yaw = dampAngle(this.yaw, moveYaw, rate, dt);
      }
      if (input.pressed('camReset')) {
        this.yaw = player.heading;
        this.manualTimer = 0;
      }
    } else if (player.tagTarget) {
      // Swing around to show the wall being painted.
      // The camera offset runs opposite `yaw`, so face the wall by looking
      // back along its normal, swung round a little to keep the rudie in shot.
      const wallYaw = Math.atan2(-player.tagTarget.normal.x, -player.tagTarget.normal.z);
      this.yaw = dampAngle(this.yaw, wallYaw + 0.85, 4.5, dt);
      this.pitch = damp(this.pitch, 0.02, 4, dt);
    }

    // --- target point ---
    const heightBoost = player.state === PSTATE.GRIND ? 0.25 : 0;
    _target.set(player.position.x, player.position.y + this.height + heightBoost, player.position.z);

    // Look slightly ahead of fast movement so you can see where you land.
    _tmp.set(player.velocity.x, 0, player.velocity.z);
    const lead = Math.min(3.2, _tmp.length() * 0.13);
    if (lead > 0.01) _target.addScaledVector(_tmp.normalize(), lead);

    // --- distance: pull back when quick, tuck in when tagging ---
    const speedN = clamp(player.speed / 26, 0, 1.3);
    let wantDist = tagging ? 4.6 : this.distance + speedN * 1.9;
    this._computeDesired(_target, wantDist, _desired);

    // Occlusion: keep the skater visible.
    _dir.subVectors(_desired, _target);
    const len = _dir.length();
    if (len > 0.01) {
      _dir.divideScalar(len);
      const hit = this.collision.raycast(_target, _dir, len + 0.35, _hit);
      if (hit) wantDist = Math.max(1.7, hit.distance - 0.45);
    }

    // Snap in fast, ease out slow, so corners do not clip the camera.
    if (wantDist < this.currentDistance) this.currentDistance = wantDist;
    else this.currentDistance = damp(this.currentDistance, wantDist, 4.5, dt);
    this._computeDesired(_target, this.currentDistance, _desired);

    const follow = tagging ? 7 : 11 + speedN * 6;
    this.position.x = damp(this.position.x, _desired.x, follow, dt);
    this.position.y = damp(this.position.y, _desired.y, follow * 0.85, dt);
    this.position.z = damp(this.position.z, _desired.z, follow, dt);

    this.lookAt.x = damp(this.lookAt.x, _target.x, 14, dt);
    this.lookAt.y = damp(this.lookAt.y, _target.y, 10, dt);
    this.lookAt.z = damp(this.lookAt.z, _target.z, 14, dt);

    // --- shake ---
    this.shake = Math.max(0, this.shake - dt * 2.4);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      const t = performance.now() * 0.001 + this.shakeSeed;
      const amp = this.shake * this.shake * 0.32;
      sx = Math.sin(t * 41) * amp;
      sy = Math.cos(t * 37) * amp;
    }

    this.camera.position.set(this.position.x + sx, this.position.y + sy, this.position.z);
    this.camera.lookAt(this.lookAt);

    // --- speed FOV ---
    const boostKick = player.boosting ? 8 : 0;
    const targetFov = this.baseFov + speedN * 12 + boostKick;
    this.camera.fov = damp(this.camera.fov, targetFov, 5, dt);
    this.camera.updateProjectionMatrix();
  }

  /** Yaw the player controller should treat as "screen forward". */
  get controlYaw() { return this.yaw; }
}

export { angleDelta };
