import { formatScore, formatTime } from '../core/MathUtils.js';
import { MAX_PLAYERS } from '../core/Constants.js';
import { RUDIES } from '../player/Rudies.js';

const MEDAL_GLYPH = { gold: '\u25c6', silver: '\u25c6', bronze: '\u25c6' };

const TYPE_LABEL = {
  tagRun: 'tag run',
  turf: 'turf war',
  score: 'score',
  trick: 'trick',
  collect: 'collect',
  takedown: 'takedown',
};

// Gamepad first: it is how this is meant to be played.
const CONTROLS = [
  ['Left stick', 'Skate'],
  ['A', 'Jump &mdash; press again in the air for a trick'],
  ['RT / RB', 'Boost'],
  ['X', 'Tag a wall, then match the arrows'],
  ['Right stick', 'Look around'],
  ['Y', 'Snap the camera behind you'],
  ['Start', 'Pause'],
  ['Keyboard', 'WASD, Space, Shift, E, mouse'],
];

/** Numeric controls carry data-value; the string ones carry data-id. */
function valueOf(el) {
  if (el.dataset.value !== undefined) return Number(el.dataset.value);
  if (el.dataset.id !== undefined) return el.dataset.id;
  return undefined;
}

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
        <div class="btn-row">
          <button class="btn btn--big" data-action="missions">Missions</button>
          <button class="btn" data-action="start">Free skate</button>
        </div>
        ${controlsMarkup()}
      </div>

      <div class="screen clickable" data-screen="missions">
        <h1 class="screen__title" style="font-size:clamp(28px,5vw,62px)">MISSIONS</h1>
        <div class="roster" data-roster></div>
        <div class="chapters" data-chapters></div>
        <div class="btn-row">
          <button class="btn" data-action="quit">Back</button>
        </div>
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
        <h1 class="screen__title" data-results-rank>RANK: JET</h1>
        <div class="screen__sub" data-results-sub>District tagged</div>
        <div class="results__record" data-results-record style="display:none">NEW RECORD</div>
        <div data-results-body></div>
        <div class="btn-row">
          <button class="btn" data-action="again">Run it again</button>
          <button class="btn" data-action="missions">Missions</button>
          <button class="btn" data-action="quit">Title screen</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    this.screens = {};
    for (const s of this.el.querySelectorAll('[data-screen]')) {
      this.screens[s.dataset.screen] = s;
    }
    this.$chapters = this.el.querySelector('[data-chapters]');
    this.$roster = this.el.querySelector('[data-roster]');
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
      this.onAction?.(btn.dataset.action, valueOf(btn));
    });

    // Pointer users and pad users share one notion of "the focused control",
    // so hovering and steering never disagree about what A will press.
    this.el.addEventListener('mousemove', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const index = this.focusables().indexOf(btn);
      if (index >= 0) this.setFocus(index);
    });

    this.current = null;
    this.onAction = null;
    this.focusIndex = 0;
    this.refreshPlayers();
  }

  // --------------------------------------------------------------- focus

  /** Every control on the visible screen, in reading order. */
  focusables() {
    const screen = this.current ? this.screens[this.current] : null;
    if (!screen) return [];
    return Array.from(screen.querySelectorAll('[data-action]'));
  }

  setFocus(index) {
    const items = this.focusables();
    if (!items.length) return;
    this.focusIndex = ((index % items.length) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('is-focused', i === this.focusIndex));
    const focused = items[this.focusIndex];
    if (focused && focused.scrollIntoView) {
      focused.scrollIntoView({ block: 'nearest' });
    }
    if (this.current === 'missions') this._describeRudie();
  }

  /**
   * Menu movement. The controls are a flat list, so up/left step back and
   * down/right step forward -- which makes the player-count row read exactly
   * as it looks without needing a grid model.
   */
  moveFocus({ x = 0, y = 0 }) {
    if (!x && !y) return;
    const step = (x || 0) - (y || 0);   // stick up is +y, and up means back
    if (!step) return;
    this.setFocus(this.focusIndex + Math.sign(step));
  }

  activateFocused() {
    const items = this.focusables();
    const el = items[this.focusIndex];
    if (!el) return;
    this.onAction?.(el.dataset.action, valueOf(el));
  }

  /** B / Escape: resume, or step back out of the mission list. */
  back() {
    if (this.current === 'pause') this.onAction?.('resume');
    else if (this.current === 'missions') this.onAction?.('quit');
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
    const short = count - pads - 2;   // pads, plus the two keyboard schemes
    if (short > 0) {
      this.$devices.innerHTML += `<div class="picker__warn">Plug in ${short} more gamepad${short > 1 ? 's' : ''} to fill every seat</div>`;
    } else if (pads === 0) {
      this.$devices.innerHTML += '<div class="picker__warn">No gamepad detected &mdash; plug one in and press a button</div>';
    }
  }

  /**
   * Draw the mission list and the roster.
   *
   * Locked rows stay visible but unfocusable, so the shape of what is left to
   * do is readable from the first run rather than appearing a row at a time.
   */
  showMissions(state, { rudies = [], rudieId = 'beat' } = {}) {
    this.$chapters.innerHTML = state.map((group) => `
      <div class="chapter${group.locked ? ' is-locked' : ''}">
        <div class="chapter__name">${group.chapter.name}${group.locked ? ' &mdash; locked' : ''}</div>
        ${group.rows.map((row) => {
      const m = row.mission;
      const medal = row.record && row.record.medal;
      const tag = row.locked
        ? '<span class="mission-row__lock">locked</span>'
        : medal
          ? `<span class="mission-row__medal is-${medal}">${MEDAL_GLYPH[medal]} ${medal}</span>`
          : row.record ? '<span class="mission-row__medal">cleared</span>' : '';
      return row.locked
        ? `<div class="mission-row is-locked">
             <span class="mission-row__name">${m.name}</span>
             <span class="mission-row__type">${TYPE_LABEL[m.type] || m.type}</span>
             ${tag}
           </div>`
        : `<button class="mission-row" data-action="mission" data-id="${m.id}">
             <span class="mission-row__name">${m.name}</span>
             <span class="mission-row__type">${TYPE_LABEL[m.type] || m.type}</span>
             ${tag}
           </button>`;
    }).join('')}
      </div>`).join('');

    this.$roster.innerHTML = `
      <div class="roster__label">Skater</div>
      <div class="roster__row">
        ${RUDIES.map((r) => {
      const owned = rudies.includes(r.id) || !r.locked;
      const stats = `${r.stats.speed}/${r.stats.technique}/${r.stats.power}`;
      return owned
        ? `<button class="roster__pick${r.id === rudieId ? ' is-on' : ''}" data-action="rudie" data-id="${r.id}"
                   style="--crew:#${r.jacket.toString(16).padStart(6, '0')}">
             <b>${r.name}</b><span>${stats}</span>
           </button>`
        : `<div class="roster__pick is-locked"><b>?????</b><span>locked</span></div>`;
    }).join('')}
      </div>
      <div class="roster__blurb" data-roster-blurb></div>`;
    this.$rosterBlurb = this.el.querySelector('[data-roster-blurb]');
    this.show('missions');
    this._describeRudie();
  }

  /** Say what the focused rudie is good at, under the row. */
  _describeRudie() {
    if (!this.$rosterBlurb) return;
    const el = this.focusables()[this.focusIndex];
    const id = el && el.dataset.action === 'rudie' ? el.dataset.id : null;
    const rudie = RUDIES.find((r) => r.id === id);
    this.$rosterBlurb.textContent = rudie
      ? rudie.blurb
      : 'Speed / technique / power. Every point in one is a point out of another.';
  }

  show(name) {
    for (const key of Object.keys(this.screens)) {
      this.screens[key].classList.toggle('is-on', key === name);
    }
    if (name === 'title') this.refreshPlayers();
    this.current = name;

    // Land on the action somebody most likely wants, so a single press of A
    // does the obvious thing on every screen.
    const items = this.focusables();
    // On the title, A does the obvious thing for the seats that are filled:
    // the story for one player, straight into a turf war for a couch full.
    const preferred = {
      title: this.game.playerCount > 1 ? 'start' : 'missions',
      missions: 'mission',
      pause: 'resume',
      busted: 'continue',
      results: 'missions',
    }[name];
    const index = items.findIndex((el) => el.dataset.action === preferred);
    this.setFocus(index >= 0 ? index : 0);
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
    const you = stats.players[0];
    const $rank = this.el.querySelector('[data-results-rank]');
    const $sub = this.el.querySelector('[data-results-sub]');
    const banner = this.el.querySelector('[data-results-record]');

    if (stats.free) {
      // Free skate has nothing to clear, so the headline is who took the city.
      const winner = stats.winner;
      $rank.textContent = winner ? `${winner.name} TAKES THE CITY` : 'NOBODY TAKES THE CITY';
      $sub.textContent = solo
        ? `You held ${you.walls} of ${stats.totalTags} walls in ${formatTime(stats.time)} \u2014 rank ${rankFor(stats, you)}`
        : `${stats.totalTags} walls, ${stats.unclaimed} still unclaimed after ${formatTime(stats.time)}`;
      banner.textContent = stats.record ? 'NEW RECORD' : '';
      banner.style.display = stats.record ? '' : 'none';
    } else {
      $rank.textContent = stats.won ? stats.mission.name : 'RUN FAILED';
      $rank.style.color = stats.won ? '' : '#ff4d4d';
      $sub.textContent = stats.won
        ? `${stats.metricLabel}: ${formatScore(stats.metric)}`
        : `${stats.goalLabel}: ${formatScore(Math.floor(stats.progress))} of ${formatScore(stats.target)}`;
      const medal = stats.medal;
      const opened = stats.opened || [];
      banner.textContent = medal
        ? `${medal.toUpperCase()} MEDAL${opened.length ? ` \u2014 UNLOCKED: ${opened.join(', ')}` : ''}`
        : opened.length ? `UNLOCKED: ${opened.join(', ')}` : '';
      banner.style.display = banner.textContent ? '' : 'none';
    }

    const crews = `<table class="scoreboard scoreboard--crews">
        <thead><tr><th></th><th>Crew</th><th>Walls</th><th>Score</th></tr></thead>
        <tbody>
          ${stats.standings.map((r, i) => `
            <tr${r.human ? '' : ' class="scoreboard__cpu"'}>
              <td class="scoreboard__pos">${i + 1}</td>
              <td style="color:${r.colorHex}"><b>${r.name}</b>${r.human ? ` &mdash; P${r.playerIndex + 1} ${r.rudie}` : ' &mdash; CPU'}</td>
              <td>${r.walls}</td>
              <td>${r.human ? formatScore(r.score) : '&mdash;'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    const ladder = stats.medals ? `
      <div class="medals">
        ${['gold', 'silver', 'bronze'].filter((k) => stats.medals[k] !== undefined).map((k) => `
          <div class="medals__row${stats.medal === k ? ' is-on' : ''}">
            <span class="medals__name is-${k}">${MEDAL_GLYPH[k]} ${k}</span>
            <span class="medals__need">${stats.metricLabel} ${formatScore(stats.medals[k])}+</span>
          </div>`).join('')}
      </div>` : '';

    const body = solo
      ? (stats.free ? crews : ladder) + `<div class="results">
          <span>Walls held</span><b>${you.walls}/${stats.totalTags}</b>
          <span>Walls painted</span><b>${you.tags}</b>
          <span>Taken off rivals</span><b>${you.steals}</b>
          <span>Score</span><b>${formatScore(you.score)}</b>
          <span>Time</span><b>${formatTime(stats.time)}</b>
          <span>Best combo</span><b>${formatScore(you.bestCombo)}</b>
          <span>Tricks landed</span><b>${you.tricks}</b>
          <span>Grind distance</span><b>${Math.round(you.grindMetres)} m</b>
          <span>Air time</span><b>${you.airTime.toFixed(1)} s</b>
          <span>Takedowns</span><b>${you.takedowns}</b>
        </div>`
      : crews + `<table class="scoreboard">
          <thead><tr><th></th><th>Rudie</th><th>Walls</th><th>Score</th><th>Stolen</th><th>Best combo</th><th>Tricks</th><th>Busts</th></tr></thead>
          <tbody>
            ${stats.players.map((p, i) => `
              <tr>
                <td class="scoreboard__pos">${i + 1}</td>
                <td style="color:${p.colorHex}"><b>P${p.index + 1} ${p.name}</b></td>
                <td>${p.walls}</td>
                <td>${formatScore(p.score)}</td>
                <td>${p.steals}</td>
                <td>${formatScore(p.bestCombo)}</td>
                <td>${p.tricks}</td>
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
