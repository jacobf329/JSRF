import { formatScore, formatTime } from '../core/MathUtils.js';
import { MAX_PLAYERS } from '../core/Constants.js';

const CONTROLS = [
  ['WASD / Left stick', 'Skate'],
  ['Space / A', 'Jump &mdash; press again in the air for a trick'],
  ['Shift / RT', 'Boost'],
  ['E / X', 'Tag a wall, then match the arrows'],
  ['Mouse / Right stick', 'Look around'],
  ['C / B', 'Snap the camera behind you'],
  ['Esc / Start', 'Pause'],
];

function controlsMarkup() {
  return `<dl class="controls">${CONTROLS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

/** Title, pause, busted and results screens, plus the player-count picker. */
export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;

    this.el = document.createElement('div');
    this.el.innerHTML = `
      <div class="screen clickable" data-screen="title">
        <div class="screen__sub">Tokyo-to &middot; Shibuya Terminal</div>
        <h1 class="screen__title">JET SET<br />RADIO FUTURE</h1>

        <div class="picker">
          <div class="picker__label">Players</div>
          <div class="picker__row" data-players></div>
          <div class="picker__devices" data-devices></div>
        </div>

        <div class="picker__best" data-best></div>
        <button class="btn btn--big" data-action="start">Skate</button>
        ${controlsMarkup()}
      </div>

      <div class="screen clickable" data-screen="pause">
        <h1 class="screen__title" style="font-size:clamp(36px,6vw,84px)">PAUSED</h1>
        ${controlsMarkup()}
        <div class="btn-row">
          <button class="btn" data-action="resume">Resume</button>
          <button class="btn" data-action="restart">Restart run</button>
          <button class="btn" data-action="quit">Quit to title</button>
        </div>
      </div>

      <div class="screen clickable" data-screen="busted">
        <h1 class="screen__title" style="color:#ff4d4d;text-shadow:6px 6px 0 var(--ink)">BUSTED</h1>
        <div class="screen__sub" data-busted-sub>The Rokkaku police hauled you in</div>
        <div class="btn-row">
          <button class="btn" data-action="continue">Get back out there</button>
          <button class="btn" data-action="restart">Restart run</button>
        </div>
      </div>

      <div class="screen clickable" data-screen="results">
        <div class="screen__sub" data-results-sub>District tagged</div>
        <h1 class="screen__title" data-results-rank>RANK: JET</h1>
        <div class="results__record" data-results-record style="display:none">NEW RECORD</div>
        <div data-results-body></div>
        <div class="btn-row">
          <button class="btn" data-action="restart">Run it again</button>
          <button class="btn" data-action="quit">Title screen</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    this.screens = {};
    for (const s of this.el.querySelectorAll('[data-screen]')) {
      this.screens[s.dataset.screen] = s;
    }
    this.$players = this.el.querySelector('[data-players]');
    this.$devices = this.el.querySelector('[data-devices]');
    this.$best = this.el.querySelector('[data-best]');

    for (let n = 1; n <= MAX_PLAYERS; n++) {
      const btn = document.createElement('button');
      btn.className = 'picker__btn';
      btn.dataset.action = 'players';
      btn.dataset.value = String(n);
      btn.textContent = String(n);
      this.$players.appendChild(btn);
    }

    this.el.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      ev.stopPropagation();
      const value = btn.dataset.value !== undefined ? Number(btn.dataset.value) : undefined;
      this.onAction?.(btn.dataset.action, value);
    });

    this.current = null;
    this.onAction = null;
    this.refreshPlayers();
  }

  /** The record for the current player count, or nothing if there isn't one. */
  setBest(score) {
    if (!this.$best) return;
    this.$best.textContent = score > 0 ? `Best: ${formatScore(score)}` : '';
  }

  /** Reflect the chosen player count and show what will drive each seat. */
  refreshPlayers() {
    const count = this.game.playerCount;
    for (const btn of this.$players.children) {
      btn.classList.toggle('is-on', Number(btn.dataset.value) === count);
    }
    const assignment = this.game.input.describeAssignment(count);
    this.$devices.innerHTML = assignment.map((a) => `
      <div class="picker__device ${a.connected ? '' : 'is-missing'}">
        <b>P${a.player}</b> ${a.label}
      </div>`).join('');
    const pads = this.game.input.padCount;
    if (count > 2 && pads < count - 1) {
      this.$devices.innerHTML += `<div class="picker__warn">Plug in ${count - 1 - pads} more gamepad${count - 1 - pads > 1 ? 's' : ''} to fill every seat</div>`;
    }
  }

  show(name) {
    for (const key of Object.keys(this.screens)) {
      this.screens[key].classList.toggle('is-on', key === name);
    }
    if (name === 'title') this.refreshPlayers();
    this.current = name;
  }

  hide() {
    for (const key of Object.keys(this.screens)) this.screens[key].classList.remove('is-on');
    this.current = null;
  }

  showBusted(message) {
    if (message) this.el.querySelector('[data-busted-sub]').textContent = message;
    this.show('busted');
  }

  showResults(stats) {
    const solo = stats.players.length === 1;
    const rank = rankFor(stats, stats.players[0]);
    this.el.querySelector('[data-results-rank]').textContent = solo
      ? `RANK: ${rank}`
      : `P${stats.winner.index + 1} ${stats.winner.name} WINS`;
    this.el.querySelector('[data-results-sub]').textContent = stats.complete
      ? `Shibuya Terminal tagged in ${formatTime(stats.time)}`
      : 'Run ended';
    const banner = this.el.querySelector('[data-results-record]');
    banner.textContent = stats.record ? 'NEW RECORD' : '';
    banner.style.display = stats.record ? '' : 'none';

    const body = solo
      ? `<div class="results">
          <span>Score</span><b>${formatScore(stats.players[0].score)}</b>
          <span>Tags</span><b>${stats.players[0].tags}/${stats.totalTags}</b>
          <span>Time</span><b>${formatTime(stats.time)}</b>
          <span>Best combo</span><b>${formatScore(stats.players[0].bestCombo)}</b>
          <span>Tricks landed</span><b>${stats.players[0].tricks}</b>
          <span>Grind distance</span><b>${Math.round(stats.players[0].grindMetres)} m</b>
          <span>Air time</span><b>${stats.players[0].airTime.toFixed(1)} s</b>
          <span>Takedowns</span><b>${stats.players[0].takedowns}</b>
        </div>`
      : `<table class="scoreboard">
          <thead><tr><th></th><th>Rudie</th><th>Score</th><th>Tags</th><th>Best combo</th><th>Tricks</th><th>Grind</th><th>Busts</th></tr></thead>
          <tbody>
            ${stats.players.map((p, i) => `
              <tr>
                <td class="scoreboard__pos">${i + 1}</td>
                <td style="color:${p.colorHex}"><b>P${p.index + 1} ${p.name}</b></td>
                <td>${formatScore(p.score)}</td>
                <td>${p.tags}</td>
                <td>${formatScore(p.bestCombo)}</td>
                <td>${p.tricks}</td>
                <td>${Math.round(p.grindMetres)} m</td>
                <td>${p.busts}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    this.el.querySelector('[data-results-body]').innerHTML = body;
    this.show('results');
  }
}

function rankFor(stats, player) {
  if (!stats.complete || !player) return 'ROOKIE';
  const perMinute = player.score / Math.max(1, stats.time / 60);
  if (perMinute > 90000 && player.busts === 0) return 'JET';
  if (perMinute > 55000) return 'RUDIE';
  if (perMinute > 30000) return 'STREET';
  return 'ROOKIE';
}
