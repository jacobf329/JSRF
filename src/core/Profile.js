import { Platform } from './Platform.js';

const VERSION = 2;

const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };

function blank() {
  return {
    version: VERSION,
    settings: {
      playerCount: 1,
      musicEnabled: true,
      masterVolume: 0.7,
      showFps: false,
    },
    // Best banked score per player count, so a solo run and a four-player
    // free-for-all are not competing for the same number.
    best: {},
    // Story progress. `missions` keeps the best result per mission; districts
    // and rudies are the things clearing one opened up.
    progress: { missions: {}, districts: [], rudies: [], rudie: 'beat' },
    stats: { runs: 0, tagsTotal: 0, playTime: 0 },
  };
}

/**
 * Settings and records, persisted through whatever the host offers -- a real
 * file in the desktop app, localStorage in a browser.
 *
 * Writes are debounced and never awaited by the game loop: losing the last
 * second of a settings change matters far less than a frame hitch.
 */
export class Profile {
  constructor() {
    this.data = blank();
    this.loaded = false;
    this._timer = null;
    this._pending = false;
  }

  async load() {
    const stored = await Platform.loadSave();
    if (stored && typeof stored === 'object') {
      // Merge rather than replace, so a save written by an older build does
      // not leave newer settings undefined.
      const fresh = blank();
      this.data = {
        version: VERSION,
        settings: { ...fresh.settings, ...(stored.settings || {}) },
        best: { ...(stored.best || {}) },
        progress: { ...fresh.progress, ...(stored.progress || {}) },
        stats: { ...fresh.stats, ...(stored.stats || {}) },
      };
    }
    this.loaded = true;
    return this.data;
  }

  get settings() { return this.data.settings; }

  bestFor(playerCount) { return this.data.best[playerCount] || 0; }

  /** Returns true when this beat the previous record for that player count. */
  recordScore(playerCount, score) {
    const key = String(playerCount);
    if (score <= (this.data.best[key] || 0)) return false;
    this.data.best[key] = Math.round(score);
    this.save();
    return true;
  }

  get progress() { return this.data.progress; }

  /**
   * File the result of a mission.
   *
   * Only an improvement is written: replaying a cleared mission for fun should
   * never cost somebody the gold they already have. Returns what changed, so
   * the results screen can say "new medal" and name what it opened up.
   */
  recordMission(id, { medal = null, metric = 0, time = 0, unlocks = null } = {}) {
    const missions = this.data.progress.missions;
    const previous = missions[id] || null;
    const improved = !previous
      || (MEDAL_RANK[medal] || 0) > (MEDAL_RANK[previous.medal] || 0)
      || metric > (previous.metric || 0);

    if (improved) {
      missions[id] = {
        medal: (MEDAL_RANK[medal] || 0) >= (MEDAL_RANK[previous && previous.medal] || 0)
          ? medal
          : previous.medal,
        metric: Math.max(metric, previous ? previous.metric || 0 : 0),
        time,
      };
    }

    const opened = { districts: [], rudies: [] };
    if (unlocks) {
      for (const key of ['districts', 'rudies']) {
        for (const value of unlocks[key] || []) {
          if (this.data.progress[key].includes(value)) continue;
          this.data.progress[key].push(value);
          opened[key].push(value);
        }
      }
    }

    this.save();
    return {
      first: !previous,
      improved,
      previous,
      record: missions[id] || null,
      opened,
      anyOpened: opened.districts.length > 0 || opened.rudies.length > 0,
    };
  }

  /** True when this rudie is on the roster -- either from the start or earned. */
  hasRudie(rudie) {
    if (!rudie) return false;
    return !rudie.locked || this.data.progress.rudies.includes(rudie.id);
  }

  recordRun({ tags = 0, time = 0 } = {}) {
    this.data.stats.runs += 1;
    this.data.stats.tagsTotal += tags;
    this.data.stats.playTime += time;
    this.save();
  }

  set(key, value) {
    if (this.data.settings[key] === value) return;
    this.data.settings[key] = value;
    this.save();
  }

  save() {
    this._pending = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._pending) return;
      this._pending = false;
      Platform.saveGame(this.data);
    }, 400);
  }

  /** Write immediately -- for page unload, where a timer will not fire. */
  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this._pending) return;
    this._pending = false;
    Platform.saveGame(this.data);
  }
}
