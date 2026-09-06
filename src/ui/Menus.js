import { formatScore, formatTime } from '../core/MathUtils.js';

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

/** Title, pause, busted and results screens. */
export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;

    this.el = document.createElement('div');
    this.el.innerHTML = `
      <div class="screen clickable" data-screen="title">
        <div class="screen__sub">Tokyo-to &middot; Shibuya Terminal</div>
        <h1 class="screen__title">JET SET<br />RADIO FUTURE</h1>
        <div class="screen__hint">Click or press ENTER to skate</div>
        ${controlsMarkup()}
      </div>

      <div class="screen clickable" data-screen="pause">
        <h1 class="screen__title" style="font-size:clamp(36px,6vw,84px)">PAUSED</h1>
        ${controlsMarkup()}
        <div class="btn-row">
          <button class="btn" data-action="resume">Resume</button>
          <button class="btn" data-action="restart">Restart run</button>
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
        <div class="results" data-results-body></div>
        <div class="btn-row">
          <button class="btn" data-action="restart">Run it again</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    this.screens = {};
    for (const s of this.el.querySelectorAll('[data-screen]')) {
      this.screens[s.dataset.screen] = s;
    }

    this.el.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (btn) {
        ev.stopPropagation();
        this.onAction?.(btn.dataset.action);
        return;
      }
      if (this.current === 'title') this.onAction?.('start');
    });

    this.current = null;
    this.onAction = null;
  }

  show(name) {
    for (const key of Object.keys(this.screens)) {
      this.screens[key].classList.toggle('is-on', key === name);
    }
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
    const rank = rankFor(stats);
    this.el.querySelector('[data-results-rank]').textContent = `RANK: ${rank}`;
    this.el.querySelector('[data-results-sub]').textContent = stats.complete
      ? 'Shibuya Terminal is yours'
      : 'Run ended';
    this.el.querySelector('[data-results-body]').innerHTML = `
      <span>Score</span><b>${formatScore(stats.score)}</b>
      <span>Tags</span><b>${stats.tags}/${stats.totalTags}</b>
      <span>Time</span><b>${formatTime(stats.time)}</b>
      <span>Best combo</span><b>${formatScore(stats.bestCombo)}</b>
      <span>Tricks landed</span><b>${stats.tricks}</b>
      <span>Grind distance</span><b>${Math.round(stats.grindMetres)} m</b>
      <span>Air time</span><b>${stats.airTime.toFixed(1)} s</b>
      <span>Takedowns</span><b>${stats.takedowns}</b>
    `;
    this.show('results');
  }
}

function rankFor(stats) {
  if (!stats.complete) return 'ROOKIE';
  const perMinute = stats.score / Math.max(1, stats.time / 60);
  if (perMinute > 90000 && stats.busts === 0) return 'JET';
  if (perMinute > 55000) return 'RUDIE';
  if (perMinute > 30000) return 'STREET';
  return 'ROOKIE';
}
