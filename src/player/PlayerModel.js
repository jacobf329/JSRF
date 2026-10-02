import * as THREE from 'three';
import { toon, flat } from '../render/Materials.js';
import { PALETTE } from '../render/Palette.js';
import { PSTATE } from './Player.js';
import { POSES } from './Poses.js';
import { clamp, damp, spring, angleDelta } from '../core/MathUtils.js';
import { RUDIES } from './Rudies.js';
import { SKATER } from './PlayerConfig.js';
import { roundedBox, limbGeo, blobGeo, swoopGeo, skateGeo, skateFrameGeo, PartBuilder } from './Shapes.js';

const SHOE = 0xf4f6ff;
const INK = 0x1b1e2c;

// Kept as an export because the rig and the asset pipeline both index looks by
// number; the roster itself, stats and all, lives in Rudies.js.
export const RUDIE_SKINS = RUDIES;

/**
 * One mesh per colour for a joint, merged.
 *
 * Every part of the rig is built through this: a joint collects its shapes,
 * they are merged by colour, and the joint ends up carrying two or three
 * meshes instead of a dozen. With four players and three rival crews on screen
 * that is the difference between a rig you can afford to detail and one you
 * cannot.
 */
function attach(parent, parts) {
  for (const { color, geometry } of parts) {
    const mesh = new THREE.Mesh(geometry, toon(color));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    parent.add(mesh);
  }
  return parent;
}

/**
 * Hand-built rudie with fully procedural animation -- no rigs or clips to
 * load, everything is driven from the player's state and speed.
 *
 * The forms are deliberately chamfered rather than boxed. A cel ramp turns
 * surface angle into a band, so a flat box is a single flat colour; a rolled
 * edge picks up a second band along the roll and the outline runs down a curve
 * instead of a corner.
 */
export class PlayerModel {
  constructor(skinIndex = 0) {
    const skinDef = RUDIE_SKINS[Math.max(0, skinIndex) % RUDIE_SKINS.length];
    this.skin = skinDef;
    const JACKET = skinDef.jacket;
    const JACKET_DARK = skinDef.jacketDark;
    const PANTS = skinDef.pants;
    const SKIN = skinDef.skin;
    const HAIR = skinDef.beanie;

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

    // --- torso: a tapered barrel under a boxy jacket, which is the shape
    // that reads as a skater in baggy clothes from thirty metres away.
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    {
      const b = new PartBuilder();
      // Waist, narrow, so the jacket above it reads as oversized.
      b.add(limbGeo(0.32, 0.26, 0.2, { segments: 10, squash: 0.72 }), PANTS, { pos: [0, 0.36, 0] });
      // The jacket is a cone, not a cube: wide across the shoulders, gathered
      // at the hem. That trapezoid is most of the rudie's silhouette.
      b.add(limbGeo(0.46, 0.3, 0.24, { segments: 12, squash: 0.68 }), JACKET, { pos: [0, 0.9, 0] });
      b.add(blobGeo(0.3, 0.13, 0.21, 12), JACKET, { pos: [0, 0.87, 0] });           // shoulder roll
      b.add(blobGeo(0.26, 0.12, 0.19, 12), JACKET, { pos: [0, 0.46, 0] });          // hem roll
      b.add(limbGeo(0.17, 0.155, 0.19, { segments: 12, squash: 0.85 }), JACKET_DARK, { pos: [0, 1.06, 0.01] });  // collar
      b.add(roundedBox(0.07, 0.4, 0.05, 0.03, 2), JACKET_DARK, { pos: [0, 0.68, 0.19], rot: [-0.07, 0, 0] });  // zip
      // Backpack, rounded and sitting proud of the shoulders.
      b.add(roundedBox(0.38, 0.44, 0.2, 0.12, 2), skinDef.pack, { pos: [0, 0.64, -0.26] });
      b.add(roundedBox(0.26, 0.07, 0.07, 0.03, 2), JACKET_DARK, { pos: [0, 0.56, -0.36] });
      b.add(roundedBox(0.12, 0.05, 0.05, 0.02, 2), skinDef.beanie, { pos: [0, 0.56, -0.38] });
      // Straps over the shoulders, front side.
      b.add(roundedBox(0.05, 0.3, 0.04, 0.018, 2), JACKET_DARK, { pos: [0.16, 0.8, 0.17], rot: [0.3, 0, 0.12] });
      b.add(roundedBox(0.05, 0.3, 0.04, 0.018, 2), JACKET_DARK, { pos: [-0.16, 0.8, 0.17], rot: [0.3, 0, -0.12] });
      attach(this.torso, b.build());
    }

    // Coat tails: two swoops hanging off the hem that the animation swings.
    this.tailL = new THREE.Group();
    this.tailR = new THREE.Group();
    this.tailL.position.set(0.17, 0.42, -0.1);
    this.tailR.position.set(-0.17, 0.42, -0.1);
    for (const [tail, flip] of [[this.tailL, 1], [this.tailR, -1]]) {
      const geo = swoopGeo(0.36, 0.22, 0.08, { curl: -1.5, taper: 0.5, segments: 3 });
      geo.rotateY(Math.PI / 2 * flip * 0.25);
      attach(tail, [{ color: JACKET, geometry: geo }]);
      this.torso.add(tail);
    }

    // --- head
    this.neck = new THREE.Group();
    this.neck.position.y = 0.95;
    this.torso.add(this.neck);
    {
      const b = new PartBuilder();
      b.add(limbGeo(0.09, 0.085, 0.1, { segments: 8 }), SKIN, { pos: [0, 0.06, 0] });   // neck
      b.add(blobGeo(0.22, 0.235, 0.21, 12), SKIN, { pos: [0, 0.23, 0] });              // skull
      b.add(blobGeo(0.1, 0.08, 0.05, 8), SKIN, { pos: [0, 0.12, 0.16] });              // jaw
      // A band across the eyes, not a helmet: deep enough to wrap the temples
      // and no deeper, or it swallows the whole head from three-quarter on.
      b.add(roundedBox(0.4, 0.1, 0.26, 0.045, 2), INK, { pos: [0, 0.285, 0.07] });     // visor
      b.add(roundedBox(0.33, 0.05, 0.26, 0.022, 1), PALETTE.cyan, { pos: [0, 0.285, 0.1] });
      b.add(blobGeo(0.11, 0.125, 0.085, 8), INK, { pos: [0.22, 0.23, 0] });            // headphone cup
      b.add(blobGeo(0.11, 0.125, 0.085, 8), INK, { pos: [-0.22, 0.23, 0] });
      b.add(roundedBox(0.44, 0.045, 0.07, 0.02, 2), INK, { pos: [0, 0.42, -0.03], rot: [0.12, 0, 0] });  // headphone arc
      attach(this.neck, b.build());
    }

    // Hair: a cap plus three swoops that the animation springs. Separate from
    // the head so it can lag behind it.
    this.hair = new THREE.Group();
    this.hair.position.y = 0.29;
    this.neck.add(this.hair);
    {
      const b = new PartBuilder();
      b.add(blobGeo(0.245, 0.235, 0.245, 12), HAIR, { pos: [0, -0.08, -0.035] });
      b.add(swoopGeo(0.4, 0.2, 0.14, { curl: 0.55, taper: 0.12, segments: 4 }), HAIR, { pos: [0, 0.09, -0.12], rot: [-0.25, 0, 0] });
      b.add(swoopGeo(0.34, 0.14, 0.1, { curl: 0.2, taper: 0.12, segments: 4 }), HAIR, { pos: [0.13, 0.04, -0.1], rot: [-0.1, -0.55, 0.35] });
      b.add(swoopGeo(0.34, 0.14, 0.1, { curl: 0.2, taper: 0.12, segments: 4 }), HAIR, { pos: [-0.13, 0.04, -0.1], rot: [-0.1, 0.55, -0.35] });
      b.add(swoopGeo(0.3, 0.1, 0.08, { curl: -0.3, taper: 0.1, segments: 4 }), HAIR, { pos: [0.05, 0.14, -0.08], rot: [-0.5, -0.2, 0.1] });
      // Fringe, forward over the visor.
      b.add(swoopGeo(0.16, 0.26, 0.1, { curl: 0.9, taper: 0.45, segments: 3 }), HAIR, { pos: [0, 0.04, 0.06], rot: [0, Math.PI, 0] });
      attach(this.hair, b.build());
    }

    // --- limbs
    this.armL = this._arm(1, JACKET, SKIN);
    this.armR = this._arm(-1, JACKET, SKIN);
    this.torso.add(this.armL.shoulder, this.armR.shoulder);

    this.legL = this._leg(1, PANTS, skinDef.wheel);
    this.legR = this._leg(-1, PANTS, skinDef.wheel);
    this.hips.add(this.legL.hip, this.legR.hip);

    // Spray can, shown while tagging.
    this.canProp = new THREE.Group();
    {
      const b = new PartBuilder();
      b.add(limbGeo(0.26, 0.065, 0.07, { segments: 10 }), PALETTE.lime, { pos: [0, 0.03, 0] });
      b.add(limbGeo(0.05, 0.04, 0.045, { segments: 8 }), INK, { pos: [0, 0.09, 0] });
      b.add(roundedBox(0.08, 0.035, 0.08, 0.015, 1), INK, { pos: [0, 0.1, 0] });
      attach(this.canProp, b.build());
    }
    this.canProp.visible = false;
    this.armR.hand.add(this.canProp);

    this.strideTime = 0;
    this.crouch = 0;
    this.state = PSTATE.SKATE;
    this._tuck = 0;
    this._split = 0;
    this._wall = 0;
    this.wantVisible = true;

    // Secondary motion. Each of these chases the body rather than being driven
    // by it, so the body leads and the soft parts arrive late -- which is the
    // difference between a model that moves and a model that is animated.
    this._hairPitch = { value: 0, velocity: 0 };
    this._hairRoll = { value: 0, velocity: 0 };
    this._tail = { value: 0, velocity: 0 };
    this._tailRoll = { value: 0, velocity: 0 };
    this._squash = { value: 0, velocity: 0 };
    this._armLag = { value: 0, velocity: 0 };
    this._headLead = { value: 0, velocity: 0 };
    this._lastHeading = 0;
    this._lastGrounded = true;
    this._lastFallSpeed = 0;

    this._fitToCapsule();
  }

  /**
   * Scale the rig so it matches the capsule the physics actually uses.
   *
   * The rig is modelled in whatever units read nicely part by part, which is
   * never quite the collision height -- it had drifted to 2.5m against a 1.78m
   * capsule, so the rudie's feet hung below the ground it was standing on.
   * Measuring and fitting here means the proportions can keep being tuned by
   * eye without anyone having to keep a running total.
   */
  _fitToCapsule() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.yawGroup);
    const height = box.max.y - box.min.y;
    if (!(height > 0.1)) return;
    const scale = SKATER.height / height;
    this.yawGroup.scale.setScalar(scale);
    // Stand the feet on the origin: the root is placed at the player's feet.
    this.yawGroup.position.y = -box.min.y * scale;
    this.scaleFactor = scale;
  }

/** Lerp the current joint rotations toward a named pose by `weight`. */
  _overlayPose(name, weight) {
    if (!name || weight <= 0.001) return;
    const pose = POSES[name];
    if (!pose) return;
    const w = Math.min(1, weight);
    const to = (obj, axis, value) => {
      if (value === undefined) return;
      obj.rotation[axis] += (value - obj.rotation[axis]) * w;
    };

    if (pose.hips !== undefined) {
      this.hips.position.y += ((0.92 - pose.hips) - this.hips.position.y) * w;
    }
    to(this.body, 'x', pose.spineX);
    to(this.body, 'z', pose.spineZ);
    to(this.neck, 'x', pose.neckX);

    to(this.armL.upper, 'x', pose.armLX);
    to(this.armL.upper, 'z', pose.armLZ);
    to(this.armL.lower, 'x', pose.armLLower);
    to(this.armR.upper, 'x', pose.armRX);
    to(this.armR.upper, 'z', pose.armRZ);
    to(this.armR.lower, 'x', pose.armRLower);

    to(this.legL.thigh, 'x', pose.legLThighX);
    to(this.legL.thigh, 'z', pose.legLThighZ);
    to(this.legL.shin, 'x', pose.legLShin);
    to(this.legL.foot, 'x', pose.legLFoot);
    to(this.legR.thigh, 'x', pose.legRThighX);
    to(this.legR.thigh, 'z', pose.legRThighZ);
    to(this.legR.shin, 'x', pose.legRShin);
    to(this.legR.foot, 'x', pose.legRFoot);
  }

  _arm(side, JACKET, SKIN) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.38, 0.79, 0);

    // A rounded cap on the shoulder itself, so the joint reads as a joint
    // rather than two sticks meeting at a gap.
    attach(shoulder, [{ color: JACKET, geometry: blobGeo(0.14, 0.14, 0.14, 10) }]);

    const upper = new THREE.Group();
    shoulder.add(upper);
    attach(upper, new PartBuilder()
      // Baggy at the shoulder, tight at the elbow: the sleeve taper is most of
      // what makes the jacket read as oversized.
      .add(limbGeo(0.34, 0.115, 0.075, { segments: 8 }), JACKET)
      .add(blobGeo(0.08, 0.075, 0.08, 8), JACKET, { pos: [0, -0.33, 0] })
      .build());

    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    upper.add(elbow);

    const lower = new THREE.Group();
    elbow.add(lower);
    attach(lower, new PartBuilder()
      .add(limbGeo(0.3, 0.07, 0.055, { segments: 8 }), SKIN)
      .add(roundedBox(0.14, 0.09, 0.14, 0.04, 2), JACKET, { pos: [0, -0.02, 0] })  // cuff
      .build());

    const hand = new THREE.Group();
    hand.position.y = -0.3;
    lower.add(hand);
    attach(hand, new PartBuilder()
      .add(blobGeo(0.075, 0.085, 0.06, 8), PALETTE.sunYellow, { pos: [0, -0.06, 0] })
      .add(roundedBox(0.11, 0.07, 0.1, 0.03, 1), PALETTE.sunYellow, { pos: [0, -0.1, 0.02] })
      .build());

    return { shoulder, upper, elbow, lower, hand, side };
  }

  _leg(side, PANTS, wheelColor) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.19, 0, 0);

    const thigh = new THREE.Group();
    hip.add(thigh);
    attach(thigh, new PartBuilder()
      // Wide at the hip, gathered at the knee: baggy trousers.
      .add(limbGeo(0.42, 0.16, 0.135, { segments: 8 }), PANTS)
      .add(blobGeo(0.12, 0.1, 0.12, 8), PANTS, { pos: [0, 0, 0] })
      .build());

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    thigh.add(knee);

    const shin = new THREE.Group();
    knee.add(shin);
    attach(shin, new PartBuilder()
      // Flares back out over the boot, which is the silhouette that makes
      // the skates look heavy.
      .add(limbGeo(0.34, 0.125, 0.16, { segments: 8 }), PANTS)
      .add(blobGeo(0.135, 0.12, 0.135, 8), PANTS, { pos: [0, -0.01, 0] })
      .add(roundedBox(0.23, 0.09, 0.23, 0.045, 2), PANTS, { pos: [0, -0.32, 0] })
      .build());

    const foot = new THREE.Group();
    foot.position.y = -0.34;
    shin.add(foot);
    attach(foot, [
      { color: SHOE, geometry: skateGeo() },
      { color: INK, geometry: skateFrameGeo() },
    ]);

    const wheels = new THREE.Group();
    wheels.position.set(0, -0.23, 0);
    foot.add(wheels);
    // The four wheels share an axle and the group is what spins, so they
    // merge into one mesh and cost one draw call instead of four.
    const b = new PartBuilder();
    for (let i = 0; i < 4; i++) {
      const wheelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10);
      wheelGeo.rotateZ(Math.PI / 2);
      b.add(wheelGeo, wheelColor, { pos: [0, 0, -0.145 + i * 0.1] });
    }
    for (const { geometry } of b.build()) {
      const w = new THREE.Mesh(geometry, flat(wheelColor));
      w.castShadow = true;
      wheels.add(w);
    }
    return { hip, thigh, knee, shin, foot, wheels, side };
  }

  /**
   * Everything that answers to the body rather than to the controller.
   *
   * None of this changes where the skater is or what they are doing; it is
   * only what hangs off them and how hard they hit the ground. It runs after
   * the locomotion pass so it has a settled body to react to.
   */
  _secondary(dt, player, { speedN, airborne, grinding, bailing }) {
    // --- hair. Pitch answers to speed and to falling; roll answers to lean,
    // both arriving a few frames after the body has already moved.
    const wind = speedN * 0.55 + (airborne ? clamp(-player.velocity.y * 0.03, -0.3, 0.5) : 0);
    spring(this._hairPitch, -wind - this.body.rotation.x * 0.4, 150, 16, dt);
    spring(this._hairRoll, -this.body.rotation.z * 0.8, 150, 16, dt);
    this.hair.rotation.x = clamp(this._hairPitch.value, -0.9, 0.5);
    this.hair.rotation.z = clamp(this._hairRoll.value, -0.5, 0.5);

    // --- coat tails. They stream behind at speed, lift in the air, and swing
    // out opposite the lean when a turn throws them.
    spring(this._tail, -0.35 - speedN * 0.85 - (airborne ? 0.35 : 0), 110, 14, dt);
    spring(this._tailRoll, this.body.rotation.z * 1.3, 110, 13, dt);
    const tail = clamp(this._tail.value, -1.5, 0.3);
    const tailRoll = clamp(this._tailRoll.value, -0.6, 0.6);
    this.tailL.rotation.set(tail, 0, tailRoll - 0.12);
    this.tailR.rotation.set(tail, 0, tailRoll + 0.12);

    // --- squash and stretch. Touching down hard compresses the whole rig and
    // it springs back; leaving the ground stretches it. Volume is preserved,
    // so a squashed rudie gets wider rather than just shorter.
    if (player.grounded && !this._lastGrounded) {
      // The landing frame has already zeroed the fall, so use the speed the
      // skater had on the way down.
      this._squash.velocity -= clamp(this._lastFallSpeed * 0.1, 0, 2.6);
    } else if (!player.grounded && this._lastGrounded && player.velocity.y > 1) {
      this._squash.velocity += 0.7;
    }
    if (!player.grounded) this._lastFallSpeed = Math.max(0, -player.velocity.y);
    else this._lastFallSpeed = 0;
    this._lastGrounded = player.grounded;

    spring(this._squash, 0, 190, 15, dt);
    const sq = clamp(this._squash.value, -0.3, 0.3);
    const scale = this.scaleFactor || 1;
    this.yawGroup.scale.set(scale * (1 - sq * 0.5), scale * (1 + sq), scale * (1 - sq * 0.5));

    // --- arms lag the torso. A rig whose arms turn with the shoulders in the
    // same frame reads as one rigid piece; a few frames of drag reads as mass.
    spring(this._armLag, this.body.rotation.z, 120, 14, dt);
    const drag = bailing ? 0 : (this.body.rotation.z - this._armLag.value) * 1.4;
    this.armL.upper.rotation.z += drag;
    this.armR.upper.rotation.z += drag;

    // A grind rides on the rail, so the board hand drops toward it.
    if (grinding) {
      this.armL.lower.rotation.x -= 0.25;
      this.armR.lower.rotation.x -= 0.25;
    }
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
    const bailing = state === PSTATE.BAIL;
    const hit = state === PSTATE.HIT || bailing;

    // Trick rotations. Roll lives on the yaw group's child so it composes with
    // the spin instead of fighting it.
    this.flipper.rotation.x = player.trickFlip;
    this.flipper.rotation.y = player.trickSpin;
    this.flipper.rotation.z = player.trickRoll || 0;

    // A wipeout tumbles rather than freezing mid-pose.
    if (bailing) {
      this._tumble = (this._tumble || 0) + dt * 9;
      this.flipper.rotation.x = this._tumble;
      this.flipper.rotation.z = Math.sin(this._tumble * 0.7) * 0.6;
    } else {
      this._tumble = 0;
    }

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

    // Head steadies itself against the body pitch, and leads into turns: a
    // skater looks where they are going before they get there.
    const turn = angleDelta(this._lastHeading, player.visualHeading);
    this._lastHeading = player.visualHeading;
    spring(this._headLead, clamp(turn / Math.max(dt, 1e-4) * 0.12, -0.6, 0.6), 90, 13, dt);
    this.neck.rotation.y = this._headLead.value;
    this.neck.rotation.x = damp(this.neck.rotation.x, -this.body.rotation.x * 0.65 + (tagging ? 0.2 : 0), 8, dt);

    this._secondary(dt, player, { speedN, airborne, grinding, bailing });

    // The trick pose goes on last, blended over whatever the locomotion
    // animation just produced. Blending after the fact rather than folding the
    // pose into every expression above keeps the two independent: a grab can
    // reshape the arms without flattening the skating stride underneath it.
    this._overlayPose(player.trickPose, player.trickPoseWeight);

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
