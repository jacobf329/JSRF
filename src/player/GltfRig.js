import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { fitToHeight } from '../render/ToonConvert.js';
import { PSTATE } from './Player.js';
import { dampAngle } from '../core/MathUtils.js';
import { SKATER } from './PlayerConfig.js';

const FADE = 0.18;

/**
 * A rig driven by a loaded, skinned glTF.
 *
 * Interchangeable with the procedural PlayerModel: same constructor shape,
 * same `update(dt, player)`, so nothing above it needs to know which one is in
 * play. Locomotion crossfades between the clips the model actually provides,
 * and tricks fire a one-shot clip named by the catalogue -- any trick whose
 * clip is missing simply does not play, rather than breaking the others.
 */
export class GltfRig {
  constructor(asset, options = {}) {
    const { height = SKATER.height, clips = {}, skinIndex = 0 } = options;

    // Cloning through SkeletonUtils is what allows four players to share one
    // loaded model: a plain clone() shares the skeleton and they all animate
    // as one.
    this.root = new THREE.Group();
    this.root.name = `rudie-gltf-${skinIndex}`;
    this.model = cloneSkinned(asset.scene);
    fitToHeight(this.model, height);
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    for (const clip of asset.animations || []) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }

    // Resolve the manifest's alias lists down to whatever this model calls it.
    this.locomotion = {};
    for (const [state, aliases] of Object.entries(clips)) {
      this.locomotion[state] = this._resolve(aliases);
    }

    this.current = null;
    this.trickAction = null;
    this.activeTrick = null;
    this.wantVisible = true;
    this.skin = { name: `P${skinIndex + 1}` };
  }

  _resolve(aliases) {
    for (const name of aliases) {
      if (this.actions.has(name)) return name;
    }
    // Fall back to a case-insensitive substring match: exporters love to
    // prefix clip names with the armature.
    for (const name of this.actions.keys()) {
      const lower = name.toLowerCase();
      if (aliases.some((a) => lower.includes(a.toLowerCase()))) return name;
    }
    return null;
  }

  hasClip(name) { return this.actions.has(name); }

  _play(name, { loop = true, fade = FADE } = {}) {
    if (!name || !this.actions.has(name)) return null;
    const action = this.actions.get(name);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.fadeIn(fade).play();
    return action;
  }

  _crossfadeTo(name) {
    if (name === this.current) return;
    const next = name && this.actions.get(name);
    const previous = this.current && this.actions.get(this.current);
    if (previous) previous.fadeOut(FADE);
    if (next) {
      next.reset();
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.fadeIn(FADE).play();
    }
    this.current = name;
  }

  _stateClip(player) {
    switch (player.state) {
      case PSTATE.GRIND: return this.locomotion.grind || this.locomotion.skate;
      case PSTATE.AIR: return this.locomotion.air || this.locomotion.skate;
      case PSTATE.WALLRIDE: return this.locomotion.air || this.locomotion.skate;
      default:
        return player.groundSpeed > 1.2
          ? (this.locomotion.skate || this.locomotion.idle)
          : (this.locomotion.idle || this.locomotion.skate);
    }
  }

  update(dt, player) {
    this.root.position.copy(player.position);
    this.root.rotation.y = dampAngle(this.root.rotation.y, player.visualHeading, 16, dt);

    // Whole-body trick rotations still apply -- they are how a model without a
    // dedicated flip clip still reads as flipping.
    this.model.rotation.set(player.trickFlip || 0, 0, player.trickRoll || 0);
    this.root.rotation.y += player.trickSpin || 0;

    this._crossfadeTo(this._stateClip(player));

    // One-shot trick clip, if the model has one for this trick.
    if (player.trick !== this.activeTrick) {
      this.activeTrick = player.trick;
      if (this.trickAction) { this.trickAction.fadeOut(FADE); this.trickAction = null; }
      if (player.trick && this.actions.has(player.trick.clip)) {
        this.trickAction = this._play(player.trick.clip, { loop: false, fade: 0.08 });
        if (this.trickAction && player.trickDuration > 0) {
          const clipLength = this.trickAction.getClip().duration;
          // Fit the clip to the trick's timing rather than the other way round.
          this.trickAction.timeScale = clipLength / player.trickDuration;
        }
      }
    }

    // Speed the skating clip up with actual speed, so it never moonwalks.
    const skate = this.locomotion.skate && this.actions.get(this.locomotion.skate);
    if (skate) skate.timeScale = 0.6 + Math.min(2.2, player.groundSpeed / 9);

    this.mixer.update(dt);

    const phase = player.index * 0.37;
    const flicker = player.invulnerable > 0 && Math.floor(player.time * 14 + phase) % 2 === 0;
    this.wantVisible = !flicker;
    this.root.visible = this.wantVisible;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
