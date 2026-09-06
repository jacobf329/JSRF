import * as THREE from 'three';
import { CelRenderer } from '../render/CelRenderer.js';
import { Sky } from '../render/Sky.js';
import { Input } from './Input.js';
import { Events } from './Events.js';
import { clamp } from './MathUtils.js';
import { Level } from '../world/Level.js';
import { Player } from '../player/Player.js';
import { PlayerModel } from '../player/PlayerModel.js';
import { FollowCamera } from '../player/FollowCamera.js';

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.events = new Events();

    this.renderer = new CelRenderer(canvas);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfd0e8, 120, 340);

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 600);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.input = new Input(canvas);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = false;
    this.running = false;
    this.systems = [];

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  /** Build the world and everything that depends on it. */
  load() {
    this.level = new Level().build();
    this.scene.add(this.level.group);
    if (this.level.sunDirection) this.sky.setSunDirection(this.level.sunDirection);

    this.player = new Player(this.level, this.events);
    this.playerModel = new PlayerModel();
    this.scene.add(this.playerModel.root);

    this.followCamera = new FollowCamera(this.camera, this.level.collision);
    this.followCamera.reset(this.player);

    this.resize();
    return this;
  }

  addSystem(system) {
    this.systems.push(system);
    return system;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);
      this.tick();
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
  }

  setPaused(paused) {
    this.paused = paused;
    this.input.enabled = !paused;
    if (paused) this.input.exitPointerLock();
  }

  tick() {
    const raw = this.clock.getDelta();
    const dt = clamp(raw, 1 / 240, 1 / 30);
    this.input.update();

    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    } else {
      // Keep the UI systems ticking so menus animate.
      for (const s of this.systems) if (s.updateWhilePaused) s.updateWhilePaused(dt);
    }

    this.render(dt);
    this.input.endFrame();
  }

  update(dt) {
    const player = this.player;

    this.followCamera.update(dt, player, this.input);
    player.update(dt, this.input, this.followCamera.controlYaw);
    this.playerModel.update(dt, player);
    this.level.updateShadows(player.position);

    for (const s of this.systems) if (s.update) s.update(dt, this);

    // Boost smear + damage tint feed the composite pass.
    this.renderer.setEffect('uBoost', player.boosting ? Math.min(1, player.speed / 26) : 0);
    this.renderer.setEffect('uDamage', player.invulnerable > 0 ? Math.min(0.6, player.invulnerable * 0.35) : 0);
  }

  render(dt) {
    this.sky.update(dt, this.camera);
    this.renderer.render(this.scene, this.camera, {
      hideDuringNormalPass: [this.sky.mesh],
      time: this.time,
    });
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.renderer.dispose();
  }
}
