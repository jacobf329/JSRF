import * as THREE from 'three';
import { toon, flat } from '../render/Materials.js';
import { PALETTE } from '../render/Palette.js';
import { PSTATE } from './Player.js';
import { clamp, damp } from '../core/MathUtils.js';

const SHOE = 0xf4f6ff;

/** One look per player slot, so everybody is readable at split-screen size. */
export const RUDIE_SKINS = [
  { name: 'BEAT', jacket: 0x18d7c8, jacketDark: 0x0f9a90, beanie: 0xff2f87, pack: 0xff7a1a, pants: 0x2b3150, skin: PALETTE.skin, wheel: 0x24d6ff },
  { name: 'GUM', jacket: 0xa8ff3e, jacketDark: 0x6fb320, beanie: 0x9a5cff, pack: 0x24d6ff, pants: 0x21243a, skin: 0xf2b98a, wheel: 0xa8ff3e },
  { name: 'YOYO', jacket: 0xff7a1a, jacketDark: 0xc4530a, beanie: 0x24d6ff, pack: 0xffd21e, pants: 0x33263f, skin: 0xc98a5e, wheel: 0xff7a1a },
  { name: 'COMBO', jacket: 0xff2f87, jacketDark: 0xc00f5c, beanie: 0xffd21e, pack: 0xa8ff3e, pants: 0x1d2b5c, skin: 0x8a5a3c, wheel: 0xff2f87 },
];

function box(w, h, d, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color, opts.mat));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  if (opts.pos) mesh.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
  if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  return mesh;
}

/** A limb pivot: children hang downward from the joint. */
function limb(length, w, d, color) {
  const pivot = new THREE.Group();
  const mesh = box(w, length, d, color, { pos: [0, -length / 2, 0] });
  pivot.add(mesh);
  pivot.userData.length = length;
  return pivot;
}

/**
 * Hand-built low-poly rudie with fully procedural animation -- no rigs or
 * clips to load, everything is driven from the player's state and speed.
 */
export class PlayerModel {
  constructor(skinIndex = 0) {
    const skinDef = RUDIE_SKINS[skinIndex % RUDIE_SKINS.length];
    this.skin = skinDef;
    const JACKET = skinDef.jacket;
    const JACKET_DARK = skinDef.jacketDark;
    const PANTS = skinDef.pants;
    const SKIN = skinDef.skin;

    this.root = new THREE.Group();
    this.root.name = `rudie-${skinDef.name}`;

    // `body` carries yaw + lean; `flipper` carries trick rotations so they
    // do not fight each other.
    this.yawGroup = new THREE.Group();
    this.flipper = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.yawGroup);
    this.yawGroup.add(this.flipper);
    this.flipper.add(this.body);

    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.body.add(this.hips);

    // Torso
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.torso.add(box(0.56, 0.42, 0.34, PANTS, { pos: [0, 0.19, 0] }));
    this.torso.add(box(0.62, 0.52, 0.38, JACKET, { pos: [0, 0.66, 0] }));
    this.torso.add(box(0.66, 0.14, 0.42, JACKET_DARK, { pos: [0, 0.44, 0] }));
    // Backpack
    this.torso.add(box(0.44, 0.5, 0.24, skinDef.pack, { pos: [0, 0.62, -0.28] }));
    this.torso.add(box(0.1, 0.28, 0.1, skinDef.beanie, { pos: [0.13, 0.86, -0.4] }));
    this.torso.add(box(0.1, 0.28, 0.1, skinDef.jacket, { pos: [-0.13, 0.86, -0.4] }));

    // Head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.95;
    this.torso.add(this.neck);
    this.neck.add(box(0.36, 0.36, 0.34, SKIN, { pos: [0, 0.18, 0] }));
    this.neck.add(box(0.38, 0.12, 0.36, 0x1b1e2c, { pos: [0, 0.3, 0.01] }));       // visor
    this.neck.add(box(0.3, 0.06, 0.34, PALETTE.cyan, { pos: [0, 0.3, 0.06] }));    // visor glow
    this.neck.add(box(0.4, 0.2, 0.38, skinDef.beanie, { pos: [0, 0.44, 0] }));      // beanie
    this.neck.add(box(0.12, 0.2, 0.16, 0x1b1e2c, { pos: [0.24, 0.2, 0] }));        // headphone L
    this.neck.add(box(0.12, 0.2, 0.16, 0x1b1e2c, { pos: [-0.24, 0.2, 0] }));       // headphone R
    this.neck.add(box(0.46, 0.08, 0.1, 0x1b1e2c, { pos: [0, 0.4, -0.02] }));       // headband

    // Arms
    this.armL = this._arm(1, JACKET, SKIN);
    this.armR = this._arm(-1, JACKET, SKIN);
    this.torso.add(this.armL.shoulder, this.armR.shoulder);

    // Legs
    this.legL = this._leg(1, PANTS, skinDef.wheel);
    this.legR = this._leg(-1, PANTS, skinDef.wheel);
    this.hips.add(this.legL.hip, this.legR.hip);

    // Spray can, shown while tagging.
    this.canProp = new THREE.Group();
    this.canProp.add(box(0.13, 0.3, 0.13, PALETTE.lime, { pos: [0, -0.1, 0] }));
    this.canProp.add(box(0.07, 0.06, 0.07, 0x1b1e2c, { pos: [0, 0.07, 0] }));
    this.canProp.visible = false;
    this.armR.hand.add(this.canProp);

    this.strideTime = 0;
    this.crouch = 0;
    this.state = PSTATE.SKATE;
    this._tuck = 0;
    this._split = 0;
    this._wall = 0;
    this.wantVisible = true;
  }

  _arm(side, JACKET, SKIN) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.38, 0.78, 0);
    const upper = limb(0.34, 0.16, 0.16, JACKET);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    upper.add(elbow);
    const lower = limb(0.32, 0.14, 0.14, SKIN);
    elbow.add(lower);
    const hand = new THREE.Group();
    hand.position.y = -0.32;
    lower.add(hand);
    hand.add(box(0.15, 0.14, 0.15, PALETTE.sunYellow, { pos: [0, -0.06, 0] }));
    return { shoulder, upper, elbow, lower, hand, side };
  }

  _leg(side, PANTS, wheelColor) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.17, 0, 0);
    const thigh = limb(0.42, 0.2, 0.22, PANTS);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    thigh.add(knee);
    const shin = limb(0.36, 0.17, 0.19, PANTS);
    knee.add(shin);

    const foot = new THREE.Group();
    foot.position.y = -0.36;
    shin.add(foot);
    foot.add(box(0.2, 0.16, 0.44, SHOE, { pos: [0, -0.06, 0.05] }));
    foot.add(box(0.22, 0.08, 0.5, 0x1b1e2c, { pos: [0, -0.16, 0.05] }));
    const wheels = new THREE.Group();
    wheels.position.set(0, -0.22, 0);
    foot.add(wheels);
    const wheelMat = flat(wheelColor);
    const wheelGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.07, 8);
    wheelGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(0, 0, -0.14 + i * 0.11);
      wheels.add(w);
    }
    return { hip, thigh, knee, shin, foot, wheels, side };
  }

  /** Drive every joint from the player's current state. */
  update(dt, player) {
    const speedN = clamp(player.groundSpeed / 20, 0, 1.4);
    this.root.position.copy(player.position);
    this.yawGroup.rotation.y = player.visualHeading;

    const state = player.state;
    const grinding = state === PSTATE.GRIND;
    const airborne = state === PSTATE.AIR;
    const wallriding = state === PSTATE.WALLRIDE;
    const tagging = state === PSTATE.TAG;
    const hit = state === PSTATE.HIT;

    // Trick rotations.
    this.flipper.rotation.x = player.trickFlip;
    this.flipper.rotation.y = player.trickSpin;

    // Lean into turns, plus a forward crouch that grows with speed.
    const targetRoll = -player.lean * 0.42 + (wallriding ? 0.85 : 0);
    this.body.rotation.z = damp(this.body.rotation.z, targetRoll, 10, dt);
    const targetPitch = hit ? -0.9 : tagging ? 0.05 : grinding ? 0.16 : airborne ? -0.12 : speedN * 0.32;
    this.body.rotation.x = damp(this.body.rotation.x, targetPitch, 9, dt);

    this._tuck = damp(this._tuck, airborne ? 1 : 0, 9, dt);
    this._split = damp(this._split, grinding ? 1 : 0, 12, dt);
    this._wall = damp(this._wall, wallriding ? 1 : 0, 10, dt);

    const crouchTarget = hit ? 0.42 : tagging ? 0.1 : grinding ? 0.3 : airborne ? 0.12 : 0.06 + speedN * 0.16;
    this.crouch = damp(this.crouch, crouchTarget, 10, dt);
    this.hips.position.y = 0.92 - this.crouch;

    // Skating stride: legs push out alternately, faster with speed.
    this.strideTime += dt * (2.6 + speedN * 9);
    const stride = Math.sin(this.strideTime);
    const strideAmt = (1 - this._tuck) * (1 - this._split) * clamp(speedN * 1.4, 0.15, 1);

    const L = this.legL;
    const R = this.legR;

    // Base pose.
    const tuckX = -1.15 * this._tuck;
    const splitFront = 0.75 * this._split;

    L.thigh.rotation.x = tuckX + stride * 0.55 * strideAmt - splitFront;
    R.thigh.rotation.x = tuckX - stride * 0.55 * strideAmt + splitFront;
    L.thigh.rotation.z = -stride * 0.4 * strideAmt - 0.06 - this._split * 0.35;
    R.thigh.rotation.z = stride * 0.4 * strideAmt + 0.06 + this._split * 0.35;

    L.shin.rotation.x = 1.6 * this._tuck + Math.max(0, -stride) * 0.5 * strideAmt + this._split * 0.25;
    R.shin.rotation.x = 1.6 * this._tuck + Math.max(0, stride) * 0.5 * strideAmt + this._split * 0.25;

    L.foot.rotation.x = -0.5 * this._tuck - this._split * 0.2;
    R.foot.rotation.x = -0.5 * this._tuck - this._split * 0.2;

    // Wheels spin with ground speed.
    const spin = (player.grounded || grinding) ? player.speed * dt * 5 : 0;
    L.wheels.rotation.x += spin;
    R.wheels.rotation.x += spin;

    // Arms: pumping while skating, out wide on rails, up in the air.
    const armSwing = stride * 0.7 * strideAmt;
    const balance = this._split * 1.25 + this._wall * 0.9;
    const tuckArm = this._tuck * 0.9;

    this.armL.upper.rotation.x = -armSwing - tuckArm * 0.6;
    this.armR.upper.rotation.x = armSwing - tuckArm * 0.6;
    this.armL.upper.rotation.z = -0.18 - balance - tuckArm * 0.5;
    this.armR.upper.rotation.z = 0.18 + balance + tuckArm * 0.5;
    this.armL.lower.rotation.x = -0.45 - this._tuck * 0.7;
    this.armR.lower.rotation.x = -0.45 - this._tuck * 0.7;

    if (tagging) {
      // Arm up, holding the can against the wall.
      this.armR.upper.rotation.x = -1.9;
      this.armR.upper.rotation.z = 0.25;
      this.armR.lower.rotation.x = -0.35;
      this.armL.upper.rotation.x = -0.35;
      this.armL.upper.rotation.z = 0.4;
    }
    this.canProp.visible = tagging;

    // Head steadies itself against the body pitch.
    this.neck.rotation.x = damp(this.neck.rotation.x, -this.body.rotation.x * 0.65 + (tagging ? 0.2 : 0), 8, dt);

    // Blink the whole rudie while invulnerable. The phase is offset per player
    // so a split-screen respawn does not make everyone vanish at once.
    const phase = player.index * 0.37;
    const flicker = player.invulnerable > 0 && Math.floor(player.time * 14 + phase) % 2 === 0;
    // `wantVisible` is the gameplay answer; per-view near-camera culling can
    // still hide the rig for a single pane.
    this.wantVisible = !flicker;
    this.root.visible = this.wantVisible;
  }
}
