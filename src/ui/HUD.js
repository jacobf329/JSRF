import * as THREE from 'three';
import { formatScore, formatTime, clamp } from '../core/MathUtils.js';

const ARROW_GLYPH = { up: '▲', down: '▼', left: '◀', right: '▶' };

const _proj = new THREE.Vector3();

/** DOM heads-up display: score, combo, resources, prompts and popups. */
export class HUD {
  constructor(root, events) {
    this.root = root;
    this.events = events;

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__corner hud__corner--tl">
        <div class="tag-panel">
          <div class="score__label">Score</div>
          <div class="score" data-score>0</div>
        </div>
        <div class="combo" data-combo>
          <div class="combo__label" data-combo-label>&nbsp;</div>
          <div class="combo__row">
            <span class="combo__points" data-combo-points>0</span>
            <span class="combo__mult" data-combo-mult>x1</span>
          </div>
          <div class="combo__bar"><div class="combo__fill" data-combo-fill></div></div>
        </div>
      </div>

      <div class="hud__corner hud__corner--tr">
        <div class="tag-panel">
          <div class="stat"><span>Cans</span><span class="stat__num" data-cans>15</span></div>
        </div>
        <div class="tag-panel">
          <div class="mission">Tags <span class="mission__count" data-tags>0/0</span></div>
        </div>
        <div class="tag-panel">
          <div class="stat"><span>Time</span><span class="stat__num" data-time>0:00</span></div>
        </div>
        <div class="heat" data-heat></div>
      </div>

      <div class="hud__corner hud__corner--bl">
        <div class="hearts" data-hearts></div>
        <div>
          <div class="meter__label">Boost</div>
          <div class="meter"><div class="meter__fill" data-boost></div></div>
        </div>
      </div>

      <div data-trackers></div>
      <div class="prompt" data-prompt></div>
      <div class="banner" data-banner></div>

      <div class="spray" data-spray>
        <div class="spray__word" data-spray-word></div>
        <div class="spray__arrows" data-spray-arrows></div>
        <div class="spray__timer"><div class="spray__timer-fill" data-spray-timer></div></div>
      </div>

      <div class="fps" data-fps></div>
    `;
    root.appendChild(this.el);

    const q = (sel) => this.el.querySelector(sel);
    this.$score = q('[data-score]');
    this.$combo = q('[data-combo]');
    this.$comboLabel = q('[data-combo-label]');
    this.$comboPoints = q('[data-combo-points]');
    this.$comboMult = q('[data-combo-mult]');
    this.$comboFill = q('[data-combo-fill]');
    this.$cans = q('[data-cans]');
    this.$tags = q('[data-tags]');
    this.$time = q('[data-time]');
    this.$heat = q('[data-heat]');
    this.$hearts = q('[data-hearts]');
    this.$boost = q('[data-boost]');
    this.$prompt = q('[data-prompt]');
    this.$banner = q('[data-banner]');
    this.$spray = q('[data-spray]');
    this.$sprayWord = q('[data-spray-word]');
    this.$sprayArrows = q('[data-spray-arrows]');
    this.$sprayTimer = q('[data-spray-timer]');
    this.$fps = q('[data-fps]');
    this.$trackers = q('[data-trackers]');

    this.heatPips = [];
    for (let i = 0; i < 5; i++) {
      const pip = document.createElement('div');
      pip.className = 'heat__pip';
      this.$heat.appendChild(pip);
      this.heatPips.push(pip);
    }
    this.hearts = [];
    for (let i = 0; i < 3; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      this.$hearts.appendChild(h);
      this.hearts.push(h);
    }

    this.trackers = [];
    this.popups = [];
    this.bannerTimer = 0;
    this.displayScore = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.fps = 0;
    this.showFps = true;
    this._sprayArrowEls = [];
    this._sprayKey = '';

    this._bind();
  }

  _bind() {
    const e = this.events;
    e.on('player:trick', ({ trick }) => this.banner(`${trick.name}!`, '#ffd21e'));
    e.on('score:bank', ({ gained }) => {
      if (gained > 800) this.banner(`+${formatScore(gained)}`, '#a8ff3e');
    });
    e.on('tag:complete', ({ word, points, position }) => {
      this.banner(`${word} TAGGED!`, '#ff2f87');
      this.popup(position, `+${formatScore(points)}`, '#a8ff3e');
    });
    e.on('tag:fail', () => this.banner('RAN OUT!', '#ff4d4d'));
    e.on('pickup:can', ({ position, color }) => {
      this.popup(position, '+1 CAN', `#${new THREE.Color(color).getHexString()}`);
    });
    e.on('police:knockdown', ({ cop }) => this.popup(cop.position, 'TAKEDOWN!', '#ffd21e'));
    e.on('player:hit', () => this.banner('BUSTED!', '#ff4d4d'));
  }

  banner(text, color = '#ffd21e', duration = 1.1) {
    this.$banner.textContent = text;
    this.$banner.style.color = color;
    this.$banner.classList.add('is-on');
    this.bannerTimer = duration;
  }

  /** Floating world-anchored text that drifts upward and fades. */
  popup(worldPosition, text, color = '#ffffff') {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.color = color;
    this.el.appendChild(el);
    this.popups.push({
      el,
      position: worldPosition.clone(),
      life: 1.5,
      maxLife: 1.5,
      rise: 1.6 + Math.random() * 0.6,
    });
    if (this.popups.length > 24) {
      const old = this.popups.shift();
      old.el.remove();
    }
  }

  update(dt, game) {
    const { player, score, graffiti, police, mission } = game;

    // Score counts up rather than snapping, which reads better mid-combo.
    this.displayScore += (score.total - this.displayScore) * Math.min(1, dt * 9);
    if (Math.abs(score.total - this.displayScore) < 1) this.displayScore = score.total;
    this.$score.textContent = formatScore(this.displayScore);

    // Combo panel.
    if (score.comboActive) {
      this.$combo.classList.add('is-on');
      this.$comboLabel.textContent = score.comboLabel || 'COMBO';
      this.$comboPoints.textContent = formatScore(score.combo);
      this.$comboMult.textContent = `x${Math.max(1, score.multiplier)}`;
      this.$comboFill.style.transform = `scaleX(${score.comboFraction})`;
    } else {
      this.$combo.classList.remove('is-on');
    }

    // Resources.
    this.$cans.textContent = String(score.cans);
    this.$cans.classList.toggle('stat__num--low', score.cans < 3);
    this.$tags.textContent = `${graffiti.taggedCount}/${graffiti.totalCount}`;
    this.$time.textContent = formatTime(mission ? mission.elapsed : 0);

    const boostPct = clamp(player.boost / 100, 0, 1);
    this.$boost.style.transform = `scaleX(${boostPct})`;
    this.$boost.classList.toggle('meter__fill--empty', boostPct < 0.08);

    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].classList.toggle('is-off', i >= player.health);
    }

    const heat = police ? police.heat : 0;
    for (let i = 0; i < this.heatPips.length; i++) {
      const on = heat > i;
      this.heatPips[i].classList.toggle('is-on', on);
      this.heatPips[i].classList.toggle('is-max', on && heat >= 5);
    }

    this._updateTrackers(game);
    this._updatePrompt(game);
    this._updateSpray(game);
    this._updatePopups(dt, game);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.$banner.classList.remove('is-on');
    }

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      if (this.showFps) {
        const stats = game.renderer.stats;
        this.$fps.textContent = `${this.fps.toFixed(0)} fps  ${stats.calls} calls  ${(stats.triangles / 1000).toFixed(0)}k tris`;
      }
    }
    this.$fps.style.display = this.showFps ? '' : 'none';
  }

  /**
   * Edge-of-screen arrows pointing at the nearest un-tagged walls. Off-screen
   * targets clamp to an inset rectangle and rotate to point outward; on-screen
   * ones sit right on the wall.
   */
  _updateTrackers(game) {
    const targets = game.graffiti.session
      ? []
      : game.graffiti.nearestSpots(game.player.position, 3);

    while (this.trackers.length < targets.length) {
      const el = document.createElement('div');
      el.className = 'tracker';
      el.innerHTML = '<div class="tracker__arrow"></div><div class="tracker__dist"></div>';
      this.$trackers.appendChild(el);
      this.trackers.push({ el, arrow: el.querySelector('.tracker__arrow'), dist: el.querySelector('.tracker__dist') });
    }
    for (let i = targets.length; i < this.trackers.length; i++) {
      this.trackers[i].el.style.display = 'none';
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const pad = 58;
    const camera = game.camera;

    for (let i = 0; i < targets.length; i++) {
      const t = this.trackers[i];
      const { spot, distance } = targets[i];
      t.el.style.display = '';

      _proj.copy(spot.data.position).project(camera);
      const behind = _proj.z > 1;
      let x = (_proj.x * 0.5 + 0.5) * w;
      let y = (-_proj.y * 0.5 + 0.5) * h;
      if (behind) { x = w - x; y = h - y; }

      const onScreen = !behind && x > pad && x < w - pad && y > pad && y < h - pad;
      let angle = 0;
      if (!onScreen) {
        // Point from screen centre toward the clamped position.
        const cx = w / 2;
        const cy = h / 2;
        const dx = x - cx;
        const dy = y - cy;
        const sx = Math.abs(dx) > 1e-3 ? (w / 2 - pad) / Math.abs(dx) : Infinity;
        const sy = Math.abs(dy) > 1e-3 ? (h / 2 - pad) / Math.abs(dy) : Infinity;
        const s = Math.min(sx, sy, 1e6);
        x = cx + dx * s;
        y = cy + dy * s;
        angle = Math.atan2(dy, dx) + Math.PI / 2;
      }

      t.el.classList.toggle('tracker--onscreen', onScreen);
      t.el.classList.toggle('tracker--near', distance < 22);
      t.el.style.left = `${x}px`;
      t.el.style.top = `${y}px`;
      t.el.style.opacity = String(i === 0 ? 1 : 0.55);
      t.arrow.style.transform = onScreen ? '' : `rotate(${angle}rad)`;
      t.dist.textContent = `${Math.round(distance)}m`;
    }
  }

  _updatePrompt(game) {
    const p = game.graffiti.prompt;
    if (!p || game.graffiti.session) {
      this.$prompt.classList.remove('is-on');
      return;
    }
    this.$prompt.classList.add('is-on');
    this.$prompt.classList.toggle('is-blocked', !p.enough);
    this.$prompt.innerHTML = p.enough
      ? `<kbd>E</kbd> Tag this spot &mdash; ${p.cans} can${p.cans > 1 ? 's' : ''}`
      : `Need ${p.cans} can${p.cans > 1 ? 's' : ''} &mdash; find more paint`;
  }

  _updateSpray(game) {
    const s = game.graffiti.session;
    if (!s) {
      this.$spray.classList.remove('is-on');
      this._sprayKey = '';
      return;
    }
    this.$spray.classList.add('is-on');
    this.$spray.classList.toggle('is-miss', s.flash < 0);

    const key = `${s.sequence.join('')}|${s.index}`;
    if (key !== this._sprayKey) {
      this._sprayKey = key;
      this.$sprayWord.textContent = s.word;
      this.$sprayArrows.innerHTML = '';
      this._sprayArrowEls = s.sequence.map((dir, i) => {
        const el = document.createElement('div');
        el.className = 'spray__arrow';
        if (i < s.index) el.classList.add('is-done');
        else if (i === s.index) el.classList.add('is-next');
        el.textContent = ARROW_GLYPH[dir];
        this.$sprayArrows.appendChild(el);
        return el;
      });
    }
    this.$sprayTimer.style.transform = `scaleX(${clamp(s.timeLeft / s.stepTime, 0, 1)})`;
  }

  _updatePopups(dt, game) {
    const camera = game.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      p.position.y += p.rise * dt;
      _proj.copy(p.position).project(camera);
      const behind = _proj.z > 1;
      const t = p.life / p.maxLife;
      if (behind) {
        p.el.style.opacity = '0';
        continue;
      }
      const x = (_proj.x * 0.5 + 0.5) * w;
      const y = (-_proj.y * 0.5 + 0.5) * h;
      p.el.style.opacity = String(Math.min(1, t * 2.4));
      p.el.style.transform = `translate(-50%, -50%) scale(${0.85 + (1 - t) * 0.25})`;
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
    }
  }

  setVisible(visible) {
    this.el.style.display = visible ? '' : 'none';
  }
}
