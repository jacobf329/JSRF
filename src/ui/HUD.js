import * as THREE from 'three';
import { formatScore, formatTime, clamp } from '../core/MathUtils.js';

const ARROW_GLYPH = { up: '▲', down: '▼', left: '◀', right: '▶' };

const _proj = new THREE.Vector3();

/**
 * One HUD per player, living inside that player's viewport.
 *
 * Panels sit in a scaled wrapper so a quarter-screen pane keeps everything
 * legible; world-anchored overlays (popups, trackers) stay unscaled so their
 * pixel maths matches the pane directly.
 */
export class HUD {
  constructor(root, events, slot) {
    this.events = events;
    this.slot = slot;

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__scale" data-scale>
        <div class="hud__corner hud__corner--tl">
          <div class="tag-panel">
            <div class="score__label" data-name>P1</div>
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
            <div class="mission">Walls <span class="mission__count" data-tags>0/0</span></div>
          <div class="mission__goal" data-goal></div>
          </div>
          <div class="tag-panel">
            <div class="crews" data-crews></div>
          </div>
          <div class="tag-panel">
            <div class="stat"><span>Time</span><span class="stat__num" data-time>0:00</span></div>
          </div>
          <div class="heat" data-heat></div>
        </div>

        <div class="risk" data-risk>
          <div class="risk__label" data-risk-label>LAND IT</div>
          <div class="risk__bar"><div class="risk__fill" data-risk-fill></div></div>
        </div>

        <div class="objective" data-objective></div>

        <div class="hud__corner hud__corner--bl">
          <div class="hearts" data-hearts></div>
          <div>
            <div class="meter__label">Boost</div>
            <div class="meter"><div class="meter__fill" data-boost></div></div>
          </div>
        </div>

        <div class="prompt" data-prompt></div>
        <div class="banner" data-banner></div>

        <div class="spray" data-spray>
          <div class="spray__word" data-spray-word></div>
          <div class="spray__arrows" data-spray-arrows></div>
          <div class="spray__timer"><div class="spray__timer-fill" data-spray-timer></div></div>
        </div>
      </div>

      <div class="hud__overlay">
        <div data-trackers></div>
        <div data-popups></div>
      </div>

      <div class="fps" data-fps></div>
    `;
    root.appendChild(this.el);

    const q = (sel) => this.el.querySelector(sel);
    this.$scale = q('[data-scale]');
    this.$name = q('[data-name]');
    this.$score = q('[data-score]');
    this.$combo = q('[data-combo]');
    this.$comboLabel = q('[data-combo-label]');
    this.$comboPoints = q('[data-combo-points]');
    this.$comboMult = q('[data-combo-mult]');
    this.$comboFill = q('[data-combo-fill]');
    this.$cans = q('[data-cans]');
    this.$tags = q('[data-tags]');
    this.$crews = q('[data-crews]');
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
    this.$popups = q('[data-popups]');
    this.$goal = q('[data-goal]');
    this.$risk = q('[data-risk]');
    this.$riskLabel = q('[data-risk-label]');
    this.$riskFill = q('[data-risk-fill]');
    this.$objective = q('[data-objective]');

    this.$name.textContent = `P${slot.index + 1} ${slot.name}`;
    this.$name.style.color = slot.colorHex;
    this.el.style.setProperty('--player-color', slot.colorHex);

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
    this.showFps = slot.index === 0;
    this.scale = 1;
    this.width = 1;
    this.height = 1;
    this.objectiveTimer = 0;
    this._sprayKey = '';

    this._bind();
  }

  /** Only react to events belonging to this HUD's player. */
  _mine(payload) {
    return !payload || payload.player === undefined || payload.player === this.slot.player;
  }

  _bind() {
    const e = this.events;
    const mine = (fn) => (p) => { if (this._mine(p)) fn(p); };

    e.on('player:trick', mine(({ trick }) => this.banner(`${trick.name}!`, '#ffd21e')));
    e.on('score:bank', mine(({ gained }) => {
      if (gained > 800) this.banner(`+${formatScore(gained)}`, '#a8ff3e');
    }));
    e.on('tag:complete', mine(({ word, points, position }) => {
      this.banner(`${word} TAGGED!`, '#ff2f87');
      this.popup(position, `+${formatScore(points)}`, '#a8ff3e');
    }));
    e.on('tag:fail', mine(() => this.banner('RAN OUT!', '#ff4d4d')));
    e.on('pickup:can', mine(({ position, color }) => {
      this.popup(position, '+1 CAN', `#${new THREE.Color(color).getHexString()}`);
    }));
    e.on('police:knockdown', mine(({ cop }) => this.popup(cop.position, 'TAKEDOWN!', '#ffd21e')));
    e.on('player:hit', mine(() => this.banner('BUSTED!', '#ff4d4d')));

    // Rival activity is worth knowing about even in your own pane.
    e.on('tag:complete', (p) => {
      if (this._mine(p)) return;
      const slot = p.player && p.player.index !== undefined ? p.player : null;
      this.banner(`P${(slot ? slot.index : 0) + 1} TAGGED ${p.word}`, '#8fa4d6', 1.2);
    });
  }

  /** Position and scale this HUD to its player's viewport. */
  setRect(rect, playerCount) {
    this.width = rect.width;
    this.height = rect.height;
    this.el.style.left = `${rect.x}px`;
    this.el.style.top = `${rect.y}px`;
    this.el.style.width = `${rect.width}px`;
    this.el.style.height = `${rect.height}px`;

    // Shrink the panels as panes get smaller, but never below readable.
    const s = playerCount === 1 ? 1 : clamp(Math.min(rect.width / 1280, rect.height / 720) * 1.5, 0.62, 1);
    this.scale = s;
    this.$scale.style.transform = `scale(${s})`;
    this.$scale.style.width = `${100 / s}%`;
    this.$scale.style.height = `${100 / s}%`;
    this.el.classList.toggle('hud--compact', playerCount > 1);
    this.showFps = this.showFps && this.slot.index === 0;
  }

  banner(text, color = '#ffd21e', duration = 1.1) {
    this.$banner.textContent = text;
    this.$banner.style.color = color;
    this.$banner.classList.add('is-on');
    this.bannerTimer = duration;
  }

  popup(worldPosition, text, color = '#ffffff') {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.color = color;
    this.$popups.appendChild(el);
    this.popups.push({
      el,
      position: worldPosition.clone(),
      life: 1.5,
      maxLife: 1.5,
      rise: 1.6 + Math.random() * 0.6,
    });
    if (this.popups.length > 16) this.popups.shift().el.remove();
  }

  update(dt, game) {
    const slot = this.slot;
    const player = slot.player;
    const score = slot.score;
    const { graffiti, police, mission } = game;

    this.displayScore += (score.total - this.displayScore) * Math.min(1, dt * 9);
    if (Math.abs(score.total - this.displayScore) < 1) this.displayScore = score.total;
    this.$score.textContent = formatScore(this.displayScore);

    if (score.comboActive) {
      this.$combo.classList.add('is-on');
      this.$comboLabel.textContent = score.comboText;
      this.$comboPoints.textContent = formatScore(score.combo);
      this.$comboMult.textContent = `x${Math.max(1, score.multiplier)}`;
      this.$comboFill.style.transform = `scaleX(${score.comboFraction})`;
    } else {
      this.$combo.classList.remove('is-on');
    }

    this.$cans.textContent = String(score.cans);
    this.$cans.classList.toggle('stat__num--low', score.cans < 3);
    // Your crew's walls out of the whole map -- the turf war's only number.
    this.$tags.textContent = `${graffiti.ownedBy(this.slot.gang)}/${graffiti.totalCount}`;
    this.$goal.textContent = 'Most walls wins';
    this.$time.textContent = formatTime(mission ? mission.timeLeft : 0);
    this.$time.classList.toggle('stat__num--low', !!mission && mission.timeLeft < 30);

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

    this._updateCrews(game);
    this._updateRisk(game);
    this._updateTrackers(game);
    this._updatePrompt(game);
    this._updateSpray(game);
    this._updatePopups(dt);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.$banner.classList.remove('is-on');
    }
    if (this.objectiveTimer > 0) {
      this.objectiveTimer -= dt;
      if (this.objectiveTimer <= 0) this.$objective.classList.remove('is-on');
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
   * The one meter that says whether you are about to lose everything.
   *
   * In the air it is trick completion -- you cannot land until it fills. On a
   * rail it is balance, which drains while you hold a stance. Both are the
   * same question, so they share the same bar rather than adding two.
   */
  /**
   * The live turf standings, four rows of one line each.
   *
   * Rebuilt only when the numbers actually move -- this runs every frame in
   * every pane, and four players means four of these.
   */
  _updateCrews(game) {
    const rows = game.mission.standings;
    const key = rows.map((r) => `${r.short}${r.walls}`).join('|');
    if (key === this._crewKey) return;
    this._crewKey = key;
    this.$crews.innerHTML = rows.map((r) => `
      <div class="crews__row${r.gang === this.slot.gang ? ' crews__row--me' : ''}">
        <span class="crews__dot" style="background:${r.colorHex}"></span>
        <span class="crews__name">${r.short}</span>
        <span class="crews__walls">${r.walls}</span>
      </div>`).join('');
  }

  _updateRisk(game) {
    const player = this.slot.player;
    let label = null;
    let value = 0;
    let danger = false;

    if (player.state === 'grind') {
      label = 'BALANCE';
      value = clamp(player.grindStability, 0, 1);
      danger = value < 0.34;
    } else if (player.trick) {
      label = 'LAND IT';
      value = clamp(1 - player.trickTimer / Math.max(0.01, player.trickDuration), 0, 1);
      danger = value < 1;
    }

    if (!label) {
      this.$risk.classList.remove('is-on');
      return;
    }
    this.$risk.classList.add('is-on');
    this.$risk.classList.toggle('is-danger', danger);
    this.$riskLabel.textContent = label;
    this.$riskFill.style.transform = `scaleX(${value})`;
  }

  /** A card at the start of a run saying what the run is. */
  showObjective(lines, duration = 5.5) {
    this.$objective.innerHTML = lines
      .map((line, i) => `<div class="objective__${i === 0 ? 'title' : 'line'}">${line}</div>`)
      .join('');
    this.$objective.classList.add('is-on');
    this.objectiveTimer = duration;
  }

  _updateTrackers(game) {
    const slot = this.slot;
    const targets = game.graffiti.sessionFor(slot.player)
      ? []
      : game.graffiti.nearestSpots(slot.player.position, slot.gang, this.scale < 0.9 ? 2 : 3);

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

    const w = this.width;
    const h = this.height;
    const pad = Math.max(34, 58 * this.scale);
    const camera = slot.camera;

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
      // A tracker wears the colour of whoever holds the wall, so a screenful
      // of arrows tells you at a glance which crew is running away with it.
      t.el.style.color = spot.owner ? spot.owner.colorHex : '';
      t.el.style.left = `${x}px`;
      t.el.style.top = `${y}px`;
      t.el.style.opacity = String(i === 0 ? 1 : 0.55);
      t.arrow.style.transform = onScreen ? '' : `rotate(${angle}rad)`;
      t.dist.textContent = `${Math.round(distance)}m`;
    }
  }

  _updatePrompt(game) {
    const p = game.graffiti.promptFor(this.slot.player);
    if (!p) {
      this.$prompt.classList.remove('is-on');
      return;
    }
    this.$prompt.classList.add('is-on');
    this.$prompt.classList.toggle('is-blocked', !p.enough);
    const key = this.slot.input.id.startsWith('pad') ? 'X' : this.slot.input.id === 'kb2' ? '.' : 'E';
    const cans = `${p.cans} can${p.cans > 1 ? 's' : ''}`;
    const verb = p.retag
      ? `Paint over ${p.stolenFrom.name}`
      : 'Tag this spot';
    this.$prompt.innerHTML = p.enough
      ? `<kbd>${key}</kbd> ${verb} &mdash; ${cans}`
      : `Need ${cans} &mdash; find more paint`;
  }

  _updateSpray(game) {
    const s = game.graffiti.sessionFor(this.slot.player);
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
      s.sequence.forEach((dir, i) => {
        const el = document.createElement('div');
        el.className = 'spray__arrow';
        if (i < s.index) el.classList.add('is-done');
        else if (i === s.index) el.classList.add('is-next');
        el.textContent = ARROW_GLYPH[dir];
        this.$sprayArrows.appendChild(el);
      });
    }
    this.$sprayTimer.style.transform = `scaleX(${clamp(s.timeLeft / s.stepTime, 0, 1)})`;
  }

  _updatePopups(dt) {
    const camera = this.slot.camera;
    const w = this.width;
    const h = this.height;
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
      const t = p.life / p.maxLife;
      if (_proj.z > 1) {
        p.el.style.opacity = '0';
        continue;
      }
      p.el.style.opacity = String(Math.min(1, t * 2.4));
      p.el.style.transform = `translate(-50%, -50%) scale(${(0.85 + (1 - t) * 0.25) * this.scale})`;
      p.el.style.left = `${(_proj.x * 0.5 + 0.5) * w}px`;
      p.el.style.top = `${(-_proj.y * 0.5 + 0.5) * h}px`;
    }
  }

  setVisible(visible) {
    this.el.style.display = visible ? '' : 'none';
  }

  dispose() {
    this.el.remove();
  }
}
