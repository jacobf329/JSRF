import * as THREE from 'three';
import { Player } from '../player/Player.js';
import { PlayerModel, RUDIE_SKINS } from '../player/PlayerModel.js';
import { FollowCamera } from '../player/FollowCamera.js';
import { Score } from '../gameplay/Score.js';
import { HUD } from '../ui/HUD.js';

/**
 * Everything that belongs to one seat at the couch: a skater, its rig, its
 * camera, its score and its slice of the screen.
 */
export class PlayerSlot {
  constructor(index, { level, events, scene, uiRoot, input }) {
    const skin = RUDIE_SKINS[index % RUDIE_SKINS.length];
    this.index = index;
    this.name = skin.name;
    this.color = skin.jacket;
    this.colorHex = `#${new THREE.Color(skin.jacket).getHexString()}`;

    this.scene = scene;
    this.player = new Player(level, events, { index, name: skin.name, color: skin.jacket });
    this.model = new PlayerModel(index);
    scene.add(this.model.root);

    this.camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 700);
    this.followCamera = new FollowCamera(this.camera, level.collision);
    this.followCamera.reset(this.player);

    this.score = new Score(events, this.player);

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'pane';
    uiRoot.appendChild(this.hudRoot);
    this.hud = new HUD(this.hudRoot, events, this);

    this.input = input;
    this.rect = { x: 0, y: 0, width: 1, height: 1 };

    // Run stats, owned by Mission.
    this.tags = 0;
    this.busts = 0;
    this.takedowns = 0;

    // Effect accumulators, kept per player so trails do not interleave.
    this._boostAccum = 0;
    this._grindAccum = 0;
    this._wallAccum = 0;
  }

  setInput(input) {
    this.input = input;
  }

  /**
   * Swap the visual rig, keeping everything else about the seat.
   *
   * Assets load after the game is already running, so the procedural rudie
   * plays until a model turns up and is then replaced in place -- nothing else
   * in the slot, the camera or the HUD notices.
   */
  setRig(rig) {
    if (!rig || rig === this.model) return;
    const previous = this.model;
    this.scene.add(rig.root);
    rig.root.visible = previous ? previous.root.visible : true;
    this.model = rig;
    if (previous) {
      this.scene.remove(previous.root);
      if (previous.dispose) previous.dispose();
    }
  }

  setRect(rect, playerCount) {
    this.rect = rect;
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    // Narrow panes need a wider vertical field of view to stay playable.
    this.followCamera.baseFov = playerCount === 1 ? 64 : rect.height < rect.width * 0.7 ? 72 : 68;
    this.camera.updateProjectionMatrix();
    this.hud.setRect(rect, playerCount);
  }

  update(dt, input) {
    this.followCamera.update(dt, this.player, input);
    this.player.update(dt, input, this.followCamera.controlYaw);
    this.model.update(dt, this.player);
    this.score.update(dt);
  }

  reset() {
    this.player.health = 3;
    this.player.respawn();
    this.score.reset();
    this.tags = 0;
    this.busts = 0;
    this.takedowns = 0;
    this.followCamera.reset(this.player);
    this.hud.displayScore = 0;
  }

  setVisible(visible) {
    this.model.root.visible = visible;
    this.hud.setVisible(visible);
  }

  dispose(scene) {
    scene.remove(this.model.root);
    this.hud.dispose();
    this.hudRoot.remove();
  }
}
