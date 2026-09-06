import * as THREE from 'three';
import { CelRenderer } from '../render/CelRenderer.js';
import { Sky } from '../render/Sky.js';
import { computeViewports, seams, spareCell } from '../render/Viewports.js';
import { InputManager } from './InputManager.js';
import { Events } from './Events.js';
import { clamp } from './MathUtils.js';
import { Level } from '../world/Level.js';
import { PSTATE } from '../player/Player.js';
import { PlayerSlot } from './PlayerSlot.js';
import { Effects } from '../gameplay/Effects.js';
import { Graffiti } from '../gameplay/Graffiti.js';
import { Pickups } from '../gameplay/Pickups.js';
import { Police } from '../gameplay/Police.js';
import { Mission } from '../gameplay/Mission.js';
import { Menus } from '../ui/Menus.js';
import { AudioEngine } from '../audio/Audio.js';
import { MAX_PLAYERS } from './Constants.js';
import { Profile } from './Profile.js';
import { Platform } from './Platform.js';

export { MAX_PLAYERS };

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

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.input = new InputManager(canvas);
    this.audio = new AudioEngine();
    this.profile = new Profile();
    this.clock = new THREE.Clock();
    this.time = 0;
    this.mode = MODE.TITLE;
    this.running = false;

    this.allSlots = [];   // every slot ever created, reused across runs
    this.slots = [];      // the ones actually playing right now
    this.playerCount = 1;
    this.bustedSlot = null;

    // Attract-mode camera, also used as the fallback view before a run starts.
    this.titleCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 700);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === MODE.PLAYING) this.setMode(MODE.PAUSED);
    });
  }

  /** Convenience for tooling and for systems that only need one skater. */
  get player() { return this.slots.length ? this.slots[0].player : null; }
  get score() { return this.slots.length ? this.slots[0].score : null; }
  get followCamera() { return this.slots.length ? this.slots[0].followCamera : null; }

  load() {
    this.level = new Level().build();
    this.scene.add(this.level.group);
    if (this.level.sunDirection) this.sky.setSunDirection(this.level.sunDirection);

    this.effects = new Effects(this.scene);
    this.graffiti = new Graffiti(this.scene, this.level, this.events, this.effects);
    this.pickups = new Pickups(this.scene, this.level, this.events, this.effects);
    this.police = new Police(this.scene, this.level, this.events, this.effects);
    this.mission = new Mission(this.events, this.graffiti, this.police);

    this.dividers = document.createElement('div');
    this.dividers.className = 'dividers';
    this.uiRoot.appendChild(this.dividers);

    this.standings = document.createElement('div');
    this.standings.className = 'standings';
    this.standings.style.display = 'none';
    this.uiRoot.appendChild(this.standings);

    this.menus = new Menus(this.uiRoot, this);
    this.menus.onAction = (action, value) => this.onMenuAction(action, value);

    this._normalPassExcluded = [this.sky.mesh, this.graffiti.group, this.effects.points];

    this.setPlayerCount(1);
    this._bindFeedback();
    this.setMode(MODE.TITLE);
    this.resize();

    // Settings and records arrive asynchronously (a file in the desktop app,
    // storage in a browser); the title screen is already up by then, so apply
    // them when they land rather than blocking the boot on them.
    this.profile.load().then((data) => this._applyProfile(data)).catch(() => { });
    window.addEventListener('beforeunload', () => this.profile.flush());

    return this;
  }

  _applyProfile(data) {
    const settings = data.settings;
    if (settings.playerCount !== this.playerCount) this.setPlayerCount(settings.playerCount);
    this.audio.setMasterVolume(settings.masterVolume);
    this.audio.setMusicEnabled(settings.musicEnabled);
    for (const slot of this.allSlots) slot.hud.showFps = !!settings.showFps && slot.index === 0;
    this.menus.refreshPlayers();
    this.menus.setBest(this.profile.bestFor(this.playerCount));
  }

  // ------------------------------------------------------------ player slots

  setPlayerCount(count) {
    const n = clamp(count | 0, 1, MAX_PLAYERS);
    this.playerCount = n;

    while (this.allSlots.length < n) {
      this.allSlots.push(new PlayerSlot(this.allSlots.length, {
        level: this.level,
        events: this.events,
        scene: this.scene,
        uiRoot: this.uiRoot,
        input: null,
      }));
    }
    for (let i = 0; i < this.allSlots.length; i++) this.allSlots[i].setVisible(i < n);
    this.slots = this.allSlots.slice(0, n);

    const sources = this.input.assign(n);
    for (let i = 0; i < n; i++) this.slots[i].setInput(sources[i]);

    this.mission.setSlots(this.slots);
    this.resize();
  }

  // -------------------------------------------------------- feedback glue

  _bindFeedback() {
    const e = this.events;
    const fx = this.effects;
    const audio = this.audio;
    const slotFor = (player) => this.slots.find((s) => s.player === player) || this.slots[0];

    e.on('player:jump', ({ player }) => {
      fx.dust(player.position.clone(), 8);
      audio.play('jump');
    });

    e.on('player:land', ({ player, airTime, impact }) => {
      fx.dust(player.position.clone(), Math.min(18, 5 + impact));
      audio.play('land');
      const slot = slotFor(player);
      if (impact > 18) slot.followCamera.addShake(Math.min(0.6, impact / 45));
      if (airTime > 1.4) slot.followCamera.addShake(0.2);
    });

    e.on('player:grind:start', ({ player }) => {
      audio.play('grindStart');
      slotFor(player).hud.banner(player.grindTrick, '#24d6ff', 0.8);
    });

    e.on('player:wallride:start', () => audio.play('wallride'));
    e.on('player:trick', () => audio.play('trick'));
    e.on('player:hit', ({ player }) => {
      audio.play('hit');
      slotFor(player).followCamera.addShake(0.9);
    });
    e.on('player:respawn', ({ player }) => slotFor(player).followCamera.reset(player));

    e.on('tag:step', () => audio.play('spray'));
    e.on('tag:complete', () => audio.play('tag'));
    e.on('tag:miss', () => audio.play('hit'));
    e.on('pickup:can', () => audio.play('pickup'));
    e.on('score:bank', ({ gained }) => { if (gained > 400) audio.play('bank'); });
    e.on('police:spot', () => audio.play('alert'));

    e.on('mission:busted', ({ slot }) => {
      this.bustedSlot = slot;
      // With more than one skater the run carries on; only a solo bust stops it.
      if (this.playerCount === 1) this.setMode(MODE.BUSTED);
      else {
        slot.player.revive();
        slot.hud.banner('BUSTED! -20%', '#ff4d4d', 1.6);
      }
    });
    e.on('mission:complete', ({ stats }) => {
      const top = stats.winner ? stats.winner.score : 0;
      stats.record = this.profile.recordScore(this.playerCount, top);
      stats.previousBest = this.profile.bestFor(this.playerCount);
      this.profile.recordRun({ tags: stats.taggedCount, time: stats.time });
      this.menus.showResults(stats);
      this.setMode(MODE.RESULTS);
    });
  }

  // ------------------------------------------------------------ game modes

  setMode(mode) {
    this.mode = mode;
    const playing = mode === MODE.PLAYING;
    this.input.setEnabled(playing);
    for (const slot of this.slots) slot.hud.setVisible(playing || mode === MODE.PAUSED);
    this.dividers.style.display = (playing || mode === MODE.PAUSED) && this.playerCount > 1 ? '' : 'none';
    this.standings.style.display = (playing || mode === MODE.PAUSED) && this.playerCount === 3 ? '' : 'none';

    switch (mode) {
      case MODE.TITLE: this.menus.show('title'); break;
      case MODE.PAUSED: this.menus.show('pause'); break;
      case MODE.BUSTED: this.menus.showBusted(); break;
      case MODE.RESULTS: break;
      default: this.menus.hide(); break;
    }

    if (playing) this.audio.resume();
    else this.input.exitPointerLock();
  }

  onMenuAction(action, value) {
    switch (action) {
      case 'players':
        this.setPlayerCount(value);
        this.profile.set('playerCount', value);
        this.menus.refreshPlayers();
        this.menus.setBest(this.profile.bestFor(value));
        break;
      case 'start':
        this.audio.init();
        this.startRun();
        break;
      case 'resume':
        this.setMode(MODE.PLAYING);
        break;
      case 'continue':
        if (this.bustedSlot) this.bustedSlot.player.revive();
        this.setMode(MODE.PLAYING);
        break;
      case 'restart':
        this.restart();
        break;
      case 'quit':
        this.setMode(MODE.TITLE);
        break;
      default: break;
    }
  }

  startRun() {
    this.restart();
    this.slots[0].hud.banner(`NOW PLAYING: ${this.audio.trackName}`, '#24d6ff', 2.2);
  }

  restart() {
    this.graffiti.reset();
    this.pickups.reset();
    this.police.reset();
    for (const slot of this.slots) slot.reset();
    this.mission.setSlots(this.slots);
    this.mission.start();
    this.setMode(MODE.PLAYING);
  }

  // ---------------------------------------------------------------- loop

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.titleCamera.aspect = w / h;
    this.titleCamera.updateProjectionMatrix();

    if (!this.slots || !this.slots.length) return;
    const rects = computeViewports(this.playerCount, w, h);
    for (let i = 0; i < this.slots.length; i++) this.slots[i].setRect(rects[i], this.playerCount);
    this.renderer.setViewRects(rects);
    this._layoutDividers(w, h);
  }

  _layoutDividers(w, h) {
    if (!this.dividers) return;
    const lines = seams(this.playerCount, w, h);
    this.dividers.innerHTML = '';
    for (const line of lines) {
      const el = document.createElement('div');
      el.className = 'divider';
      el.style.left = `${line.x}px`;
      el.style.top = `${line.y}px`;
      el.style.width = `${line.width || 6}px`;
      el.style.height = `${line.height || 6}px`;
      el.style.marginLeft = line.width ? '0' : '-3px';
      el.style.marginTop = line.height ? '0' : '-3px';
      this.dividers.appendChild(el);
    }
    const cell = spareCell(this.playerCount, w, h);
    if (cell && this.standings) {
      this.standings.style.left = `${cell.x}px`;
      this.standings.style.top = `${cell.y}px`;
      this.standings.style.width = `${cell.width}px`;
      this.standings.style.height = `${cell.height}px`;
    }
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

    if (this.input.anyPressed('pause')) {
      if (this.mode === MODE.PLAYING) this.setMode(MODE.PAUSED);
      else if (this.mode === MODE.PAUSED) this.setMode(MODE.PLAYING);
    }

    if (this.mode === MODE.PLAYING) this.updatePlaying(dt);
    else this.updateIdle(dt);

    this.render(dt);
    this.input.endFrame();
  }

  updatePlaying(dt) {
    for (const slot of this.slots) slot.update(dt, slot.input);

    this.graffiti.update(dt, this);
    this.pickups.update(dt, this);
    this.police.update(dt, this);
    this.mission.update(dt);
    this._continuousEffects(dt);
    this.effects.update(dt);
    this.audio.update(dt, this);

    this.level.updateShadows(this.slots.map((s) => s.player.position));

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.hud.update(dt, this);
      const player = slot.player;
      this.renderer.setViewEffect(
        i,
        player.boosting ? Math.min(1, player.speed / 26) : 0,
        player.invulnerable > 0 ? Math.min(0.55, player.invulnerable * 0.3) : 0,
      );
    }

    if (this.playerCount === 3) this._updateStandings();
  }

  updateIdle(dt) {
    if (this.mode === MODE.TITLE) {
      const a = this.time * 0.1;
      const r = 78 + Math.sin(a * 0.6) * 12;
      this.titleCamera.position.set(Math.cos(a) * r, 40 + Math.sin(a * 0.7) * 10, Math.sin(a) * r);
      this.titleCamera.lookAt(0, 4, 0);
      for (const slot of this.slots) slot.model.update(dt, slot.player);
      this.pickups.update(dt, this);
      this.level.updateShadows([this.titleCamera.position]);
    }
    this.effects.update(dt);
    if (this.mode === MODE.PAUSED) {
      for (const slot of this.slots) slot.hud.update(0, this);
    }
  }

  _updateStandings() {
    const ranked = [...this.slots].sort((a, b) => b.score.total - a.score.total);
    this.standings.innerHTML = `
      <div class="standings__title">Standings</div>
      ${ranked.map((s, i) => `
        <div class="standings__row">
          <span class="standings__pos">${i + 1}</span>
          <span class="standings__name" style="color:${s.colorHex}">P${s.index + 1} ${s.name}</span>
          <span class="standings__score">${Math.floor(s.score.total).toLocaleString('en-US')}</span>
          <span class="standings__tags">${s.tags} tags</span>
        </div>`).join('')}
      <div class="standings__title">Walls left</div>
      <div class="standings__big">${this.graffiti.remaining}</div>
    `;
  }

  _continuousEffects(dt) {
    for (const slot of this.slots) {
      const player = slot.player;

      if (player.boosting && player.speed > 5) {
        slot._boostAccum += dt;
        if (slot._boostAccum > 0.035) {
          slot._boostAccum = 0;
          _v.copy(player.position).addScaledVector(player.velocity, -0.06);
          _v.y += 0.4;
          this.effects.boostTrail(_v, slot.color);
        }
      }

      if (player.state === PSTATE.GRIND) {
        slot._grindAccum += dt;
        if (slot._grindAccum > 0.045) {
          slot._grindAccum = 0;
          _v.copy(player.position);
          _v.y += 0.1;
          this.effects.sparks(_v, player.velocity.clone().normalize(), 0xffd21e, 3);
        }
      }

      if (player.state === PSTATE.WALLRIDE) {
        slot._wallAccum += dt;
        if (slot._wallAccum > 0.05) {
          slot._wallAccum = 0;
          _v.copy(player.position).addScaledVector(player.wallNormal, 0.35);
          _v.y += 0.7;
          this.effects.sparks(_v, player.wallNormal, 0xff7a1a, 3);
        }
      }
    }
  }

  render(dt) {
    this.sky.tick(dt);

    const views = this.mode === MODE.PLAYING || this.mode === MODE.PAUSED
      ? this.slots.map((slot) => ({ camera: slot.camera, rect: this.playerCount > 1 ? slot.rect : null }))
      : [{ camera: this.titleCamera, rect: null }];

    this.renderer.render(this.scene, views, {
      hideDuringNormalPass: this._normalPassExcluded,
      time: this.time,
      beforeView: (view) => {
        this.sky.place(view.camera);
        this._cullNearRigs(view.camera);
      },
    });
  }

  /**
   * A skater standing where a camera happens to be fills that pane with an
   * armpit. Hide any rig within arm's reach of the view being drawn -- it is
   * per-view, so everyone else still sees them.
   */
  _cullNearRigs(camera) {
    for (const slot of this.slots) {
      const model = slot.model;
      if (!model.wantVisible) { model.root.visible = false; continue; }
      _v.copy(slot.player.position);
      _v.y += 0.9;
      model.root.visible = camera.position.distanceToSquared(_v) > 2.4 * 2.4;
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.renderer.dispose();
  }
}
