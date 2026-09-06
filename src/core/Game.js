import * as THREE from 'three';
import { CelRenderer } from '../render/CelRenderer.js';
import { Sky } from '../render/Sky.js';
import { Input } from './Input.js';
import { Events } from './Events.js';
import { clamp } from './MathUtils.js';
import { Level } from '../world/Level.js';
import { Player, PSTATE } from '../player/Player.js';
import { PlayerModel } from '../player/PlayerModel.js';
import { FollowCamera } from '../player/FollowCamera.js';
import { Effects } from '../gameplay/Effects.js';
import { Graffiti } from '../gameplay/Graffiti.js';
import { Pickups } from '../gameplay/Pickups.js';
import { Score } from '../gameplay/Score.js';
import { Police } from '../gameplay/Police.js';
import { Mission } from '../gameplay/Mission.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { AudioEngine } from '../audio/Audio.js';

export const MODE = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  BUSTED: 'busted',
  RESULTS: 'results',
};

const _v = new THREE.Vector3();

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.events = new Events();

    this.renderer = new CelRenderer(canvas);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc7d4e8, 130, 380);

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 700);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.clock = new THREE.Clock();
    this.time = 0;
    this.mode = MODE.TITLE;
    this.running = false;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === MODE.PLAYING) this.setMode(MODE.PAUSED);
    });
  }

  load() {
    this.level = new Level().build();
    this.scene.add(this.level.group);
    if (this.level.sunDirection) this.sky.setSunDirection(this.level.sunDirection);

    this.player = new Player(this.level, this.events);
    this.playerModel = new PlayerModel();
    this.scene.add(this.playerModel.root);

    this.followCamera = new FollowCamera(this.camera, this.level.collision);
    this.followCamera.reset(this.player);

    this.effects = new Effects(this.scene);
    this.score = new Score(this.events);
    this.graffiti = new Graffiti(this.scene, this.level, this.events, this.effects);
    this.pickups = new Pickups(this.scene, this.level, this.events, this.effects);
    this.police = new Police(this.scene, this.level, this.events, this.effects);
    this.mission = new Mission(this.events, this.graffiti, this.score, this.police);

    this.hud = new HUD(this.uiRoot, this.events);
    this.menus = new Menus(this.uiRoot, this);
    this.menus.onAction = (action) => this.onMenuAction(action);

    this._bindFeedback();
    this.setMode(MODE.TITLE);
    this.resize();
    return this;
  }

  // -------------------------------------------------------- feedback glue

  _bindFeedback() {
    const e = this.events;
    const fx = this.effects;
    const audio = this.audio;

    e.on('player:jump', ({ player }) => {
      fx.dust(player.position.clone(), 8);
      audio.play('jump');
    });

    e.on('player:land', ({ player, airTime, impact }) => {
      fx.dust(player.position.clone(), Math.min(18, 5 + impact));
      audio.play('land');
      if (impact > 18) this.followCamera.addShake(Math.min(0.6, impact / 45));
      if (airTime > 1.4) this.followCamera.addShake(0.2);
    });

    e.on('player:grind:start', ({ player }) => {
      audio.play('grindStart');
      this.hud.banner(player.grindTrick, '#24d6ff', 0.8);
    });

    e.on('player:wallride:start', () => audio.play('wallride'));
    e.on('player:trick', () => audio.play('trick'));
    e.on('player:hit', () => {
      audio.play('hit');
      this.followCamera.addShake(0.9);
    });
    e.on('player:respawn', () => this.followCamera.reset(this.player));

    e.on('tag:step', () => audio.play('spray'));
    e.on('tag:complete', () => audio.play('tag'));
    e.on('tag:miss', () => audio.play('hit'));
    e.on('pickup:can', () => audio.play('pickup'));
    e.on('score:bank', ({ gained }) => { if (gained > 400) audio.play('bank'); });
    e.on('police:spot', () => audio.play('alert'));

    e.on('mission:busted', () => this.setMode(MODE.BUSTED));
    e.on('mission:complete', ({ stats }) => {
      this.menus.showResults(stats);
      this.setMode(MODE.RESULTS);
    });
  }

  // ------------------------------------------------------------ game modes

  setMode(mode) {
    this.mode = mode;
    const playing = mode === MODE.PLAYING;
    this.input.enabled = playing;
    this.hud.setVisible(playing || mode === MODE.PAUSED);

    switch (mode) {
      case MODE.TITLE: this.menus.show('title'); break;
      case MODE.PAUSED: this.menus.show('pause'); break;
      case MODE.BUSTED: this.menus.showBusted(); break;
      case MODE.RESULTS: break; // showResults() already ran
      default: this.menus.hide(); break;
    }

    if (playing) {
      this.audio.resume();
    } else {
      this.input.exitPointerLock();
    }
  }

  onMenuAction(action) {
    switch (action) {
      case 'start':
        this.audio.init();
        this.mission.start();
        this.setMode(MODE.PLAYING);
        this.followCamera.reset(this.player);
        this.hud.banner(`NOW PLAYING: ${this.audio.trackName}`, '#24d6ff', 2.2);
        break;
      case 'resume':
        this.setMode(MODE.PLAYING);
        break;
      case 'continue':
        this.player.revive();
        this.setMode(MODE.PLAYING);
        break;
      case 'restart':
        this.restart();
        break;
      default: break;
    }
  }

  restart() {
    this.score.reset();
    this.graffiti.reset();
    this.pickups.reset();
    this.police.reset();
    this.player.health = 3;
    this.player.respawn();
    this.mission.start();
    this.setMode(MODE.PLAYING);
  }

  // ---------------------------------------------------------------- loop

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

  tick() {
    const dt = clamp(this.clock.getDelta(), 1 / 240, 1 / 30);
    this.time += dt;
    this.input.update();

    // Pause is available from gameplay and from the pause screen itself.
    if (this.input.actions.has('pause') && !this._pauseLatch) {
      this._pauseLatch = true;
      if (this.mode === MODE.PLAYING) this.setMode(MODE.PAUSED);
      else if (this.mode === MODE.PAUSED) this.setMode(MODE.PLAYING);
    } else if (!this.input.actions.has('pause')) {
      this._pauseLatch = false;
    }

    if (this.mode === MODE.PLAYING) this.updatePlaying(dt);
    else this.updateIdle(dt);

    this.render(dt);
    this.input.endFrame();
  }

  updatePlaying(dt) {
    const player = this.player;

    this.followCamera.update(dt, player, this.input);
    player.update(dt, this.input, this.followCamera.controlYaw);
    this.playerModel.update(dt, player);
    this.level.updateShadows(player.position);

    this.graffiti.update(dt, this);
    this.pickups.update(dt, this);
    this.police.update(dt, this);
    this.score.update(dt, this);
    this.mission.update(dt, this);
    this._continuousEffects(dt);
    this.effects.update(dt);
    this.audio.update(dt, this);
    this.hud.update(dt, this);

    this.renderer.setEffect('uBoost', player.boosting ? Math.min(1, player.speed / 26) : 0);
    this.renderer.setEffect('uDamage', player.invulnerable > 0 ? Math.min(0.55, player.invulnerable * 0.3) : 0);
  }

  /** Menus and the attract camera still need the world to breathe. */
  updateIdle(dt) {
    if (this.mode === MODE.TITLE) {
      const a = this.time * 0.1;
      const r = 78 + Math.sin(a * 0.6) * 12;
      this.camera.position.set(Math.cos(a) * r, 40 + Math.sin(a * 0.7) * 10, Math.sin(a) * r);
      this.camera.lookAt(0, 4, 0);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      this.playerModel.update(dt, this.player);
      this.pickups.update(dt, this);
      this.level.updateShadows(this.camera.position);
    }
    this.effects.update(dt);
    if (this.mode === MODE.PAUSED) this.hud.update(0, this);
  }

  _continuousEffects(dt) {
    const player = this.player;

    if (player.boosting && player.speed > 5) {
      this._boostAccum = (this._boostAccum || 0) + dt;
      if (this._boostAccum > 0.035) {
        this._boostAccum = 0;
        _v.copy(player.position).addScaledVector(player.velocity, -0.06);
        _v.y += 0.4;
        this.effects.boostTrail(_v, 0x24d6ff);
      }
    }

    if (player.state === PSTATE.GRIND) {
      this._grindAccum = (this._grindAccum || 0) + dt;
      if (this._grindAccum > 0.045) {
        this._grindAccum = 0;
        _v.copy(player.position);
        _v.y += 0.1;
        this.effects.sparks(_v, player.velocity.clone().normalize(), 0xffd21e, 3);
      }
    }

    if (player.state === PSTATE.WALLRIDE) {
      this._wallAccum = (this._wallAccum || 0) + dt;
      if (this._wallAccum > 0.05) {
        this._wallAccum = 0;
        _v.copy(player.position).addScaledVector(player.wallNormal, 0.35);
        _v.y += 0.7;
        this.effects.sparks(_v, player.wallNormal, 0xff7a1a, 3);
      }
    }
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
