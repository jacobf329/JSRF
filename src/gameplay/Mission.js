import { GANGS } from './Gangs.js';
import { FREE_SKATE } from './MissionData.js';

const MEDALS = ['gold', 'silver', 'bronze'];

/**
 * Runs one mission, whatever kind it is.
 *
 * Every mission boils down to the same three questions: what is the player
 * accumulating, when have they got enough, and how well did they do it. The
 * type table below answers those and nothing else -- the clock, the bust
 * penalty and the crew standings are shared by every run, because a turf war
 * and a tutorial are the same game with a different thing being counted.
 */
const TYPES = {
  tagRun: {
    label: 'WALLS PAINTED',
    // Painted, not held: a rival stealing one back should not un-progress you.
    progress: (m) => m.counts.tags,
    target: (m) => m.resolve(m.def.goal.walls, m.graffiti.totalCount),
    // Time left rewards a fast run without punishing a careful one.
    metric: (m) => Math.round(m.timeLeft),
    metricLabel: 'SECONDS SPARE',
  },
  score: {
    label: 'POINTS',
    progress: (m) => m.counts.score,
    target: (m) => m.def.goal.points,
    metric: (m) => Math.round(m.counts.score),
    metricLabel: 'SCORE',
  },
  trick: {
    label: 'BEST CHAIN',
    progress: (m) => m.counts.bestCombo,
    target: (m) => m.def.goal.points,
    metric: (m) => Math.round(m.counts.bestCombo),
    metricLabel: 'BEST CHAIN',
  },
  collect: {
    label: 'CANS',
    progress: (m) => m.counts.cans,
    target: (m) => m.def.goal.cans,
    metric: (m) => Math.round(m.timeLeft),
    metricLabel: 'SECONDS SPARE',
  },
  takedown: {
    label: 'TAKEDOWNS',
    progress: (m) => m.counts.takedowns,
    target: (m) => m.def.goal.count,
    metric: (m) => m.counts.takedowns,
    metricLabel: 'TAKEDOWNS',
  },
  turf: {
    label: 'WALLS HELD',
    progress: (m) => m.wallsFor(m.slots[0]),
    // A turf war has no fixed number to reach: it ends on the clock and is won
    // by being ahead. The target is only there so the HUD has a bar to fill.
    target: (m) => Math.max(1, m.bestRivalWalls + 1),
    endsOnGoal: false,
    won: (m) => m.wallsFor(m.slots[0]) > m.bestRivalWalls,
    metric: (m) => m.wallsFor(m.slots[0]),
    metricLabel: 'WALLS HELD',
  },
};

export class Mission {
  constructor(events, graffiti, police) {
    this.events = events;
    this.graffiti = graffiti;
    this.police = police;
    this.slots = [];
    this.aiGangs = [];

    this.def = FREE_SKATE;
    this.rules = TYPES.turf;
    this.duration = FREE_SKATE.time;
    this.timeLeft = this.duration;
    this.elapsed = 0;
    this.complete = false;
    this.won = false;
    this.running = false;
    this.medal = null;
    this._warned = 0;

    this.counts = { tags: 0, steals: 0, score: 0, bestCombo: 0, cans: 0, takedowns: 0 };

    // Every one of these can be the thing that finishes a run, so each checks
    // for the end itself rather than leaving it to the next tick -- otherwise
    // whether a mission ends on the beat depends on which kind it is.
    events.on('police:knockdown', ({ player }) => {
      const slot = this.slotFor(player);
      if (slot) slot.takedowns++;
      if (this._own(player)) this.counts.takedowns++;
      this._check();
    });
    events.on('rival:knockdown', ({ player }) => {
      if (this._own(player)) this.counts.takedowns++;
      this._check();
    });
    events.on('pickup:can', ({ player }) => {
      if (this._own(player)) this.counts.cans++;
      this._check();
    });
    events.on('player:down', ({ player }) => this._bust(player));
    events.on('tag:complete', ({ player, retag }) => {
      const slot = this.slotFor(player);
      if (slot) { slot.tags++; if (retag) slot.steals++; }
      if (this._own(player)) {
        this.counts.tags++;
        if (retag) this.counts.steals++;
      }
      this._check();
    });
    events.on('rival:tag', () => this._check());
    events.on('score:bank', ({ gained, player }) => {
      if (!this._own(player)) return;
      this.counts.bestCombo = Math.max(this.counts.bestCombo, gained);
      this._check();
    });
  }

  /** Mission goals track seat one; the other seats are playing, not scored. */
  _own(player) {
    return !!this.slots.length && this.slots[0].player === player;
  }

  // ------------------------------------------------------------------ setup

  /**
   * Choose the run.
   *
   * Returns what the rest of the game needs to set itself up for it -- which
   * district is in play, how many crews to field, how hard the police are --
   * rather than reaching out and doing it, so the mission stays a rules object.
   */
  setMission(def) {
    this.def = def || FREE_SKATE;
    this.rules = TYPES[this.def.type] || TYPES.turf;
    this.duration = this.def.time;
    return {
      district: this.def.district || null,
      rivals: this.def.rivals ?? 3,
      police: this.def.police ?? 1,
    };
  }

  setSlots(slots) {
    this.slots = slots;
    for (const slot of slots) {
      slot.gang = GANGS[slot.index % GANGS.length];
      slot.tags = 0;
      slot.steals = 0;
      slot.busts = 0;
      slot.takedowns = 0;
    }
    this.aiGangs = GANGS.slice(slots.length);
  }

  slotFor(player) {
    return this.slots.find((s) => s.player === player) || null;
  }

  slotForGang(gang) {
    return this.slots.find((s) => s.gang === gang) || null;
  }

  wallsFor(slot) {
    return slot ? this.graffiti.ownedBy(slot.gang) : 0;
  }

  /** The best any crew that is not seat one is holding. */
  get bestRivalWalls() {
    const mine = this.slots.length ? this.slots[0].gang : null;
    let best = 0;
    for (const gang of GANGS) {
      if (gang === mine) continue;
      best = Math.max(best, this.graffiti.ownedBy(gang));
    }
    return best;
  }

  /** Whoever is holding the most walls right now, or null while it is level. */
  get leadingGang() {
    let best = null;
    let bestWalls = 0;
    let tied = false;
    for (const gang of GANGS) {
      const walls = this.graffiti.ownedBy(gang);
      if (walls > bestWalls) { bestWalls = walls; best = gang; tied = false; }
      else if (walls === bestWalls && walls > 0) tied = true;
    }
    return tied ? null : best;
  }

  /** A goal of 'all' means whatever the district actually holds. */
  resolve(value, available) {
    if (value === 'all') return available;
    return Math.min(value, available || value);
  }

  // --------------------------------------------------------------- progress

  get progress() { return this.rules.progress(this); }
  get target() { return this.rules.target(this); }
  get goalLabel() { return this.rules.label; }
  get goalMet() {
    if (this.rules.won) return this.rules.won(this);
    return this.progress >= this.target;
  }

  /** Medal earned for a finished run, or null for a run that was lost. */
  medalFor(metric) {
    const table = this.def.medals;
    if (!table) return null;
    for (const name of MEDALS) {
      if (table[name] !== undefined && metric >= table[name]) return name;
    }
    return null;
  }

  start() {
    this.elapsed = 0;
    this.timeLeft = this.duration;
    this.complete = false;
    this.won = false;
    this.medal = null;
    this.running = true;
    this._warned = 0;
    this.counts = { tags: 0, steals: 0, score: 0, bestCombo: 0, cans: 0, takedowns: 0 };
    for (const slot of this.slots) {
      slot.tags = 0;
      slot.steals = 0;
      slot.busts = 0;
      slot.takedowns = 0;
    }
  }

  update(dt) {
    if (!this.running || this.complete) return;
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    // Score counts the chain that is still running, or a bad last combo would
    // look like a target missed by exactly the amount still in the air.
    if (this.slots.length) {
      const score = this.slots[0].score;
      this.counts.score = score.total + score.comboPreview;
    }

    for (const [mark, label] of [[60, 'ONE MINUTE LEFT'], [10, 'TEN SECONDS']]) {
      if (this.timeLeft <= mark && this._warned < mark && this.duration > mark + 5) {
        this._warned = mark;
        this.events.emit('mission:warning', { timeLeft: this.timeLeft, label });
        break;
      }
    }

    this._check();
    if (!this.complete && this.timeLeft <= 0) this._finish('time');
  }

  /**
   * Has the run ended?
   *
   * Most missions stop the moment the goal is met -- there is nothing left to
   * do and standing around is not a reward. A turf war is the exception: being
   * ahead is not the same as having won, because it can be taken back.
   */
  _check() {
    if (!this.running || this.complete) return;
    if (this.rules.endsOnGoal === false) {
      // Except when one crew has literally taken everything.
      if (this.graffiti.unclaimed === 0) {
        const first = this.graffiti.spots[0].owner;
        if (this.graffiti.spots.every((s) => s.owner === first)) this._finish('wipeout');
      }
      return;
    }
    if (this.goalMet) this._finish('goal');
  }

  _bust(player) {
    const slot = this.slotFor(player);
    if (!slot) return;
    slot.busts++;
    slot.score.breakCombo();
    const penalty = Math.round(slot.score.total * 0.2);
    slot.score.total = Math.max(0, slot.score.total - penalty);
    if (this.slots.every((s) => s.player.health <= 0 || s === slot)) this.police.reset();
    this.events.emit('mission:busted', { penalty, player, slot, busts: slot.busts });
  }

  _finish(reason = 'time') {
    if (this.complete) return;
    for (const slot of this.slots) slot.score.bank();
    if (this.slots.length) this.counts.score = this.slots[0].score.total;

    this.complete = true;
    this.running = false;
    this.won = this.goalMet;
    this.medal = this.won ? this.medalFor(this.rules.metric(this)) : null;
    this.events.emit('mission:complete', { stats: this.stats, reason });
  }

  /** Per-crew standings, for the live panel and the results screen. */
  get standings() {
    const rows = GANGS.map((gang) => {
      const slot = this.slotForGang(gang);
      return {
        gang,
        name: gang.name,
        short: gang.short,
        colorHex: gang.colorHex,
        walls: this.graffiti.ownedBy(gang),
        human: !!slot,
        playerIndex: slot ? slot.index : -1,
        rudie: slot ? slot.name : null,
        score: slot ? Math.floor(slot.score.total) : 0,
        tags: slot ? slot.tags : 0,
        steals: slot ? slot.steals : 0,
      };
    });
    rows.sort((a, b) => b.walls - a.walls || b.score - a.score);
    return rows;
  }

  get stats() {
    const players = this.slots.map((slot) => ({
      index: slot.index,
      name: slot.name,
      gang: slot.gang,
      colorHex: slot.gang ? slot.gang.colorHex : slot.colorHex,
      walls: this.graffiti.ownedBy(slot.gang),
      score: slot.score.total,
      tags: slot.tags,
      steals: slot.steals,
      bestCombo: slot.score.bestCombo,
      tricks: slot.score.tricksDone,
      grindMetres: slot.score.grindMetres,
      airTime: slot.score.airTimeTotal,
      takedowns: slot.takedowns,
      busts: slot.busts,
    }));
    players.sort((a, b) => b.walls - a.walls || b.score - a.score);
    const standings = this.standings;
    return {
      mission: this.def,
      free: !!this.def.free,
      complete: this.complete,
      won: this.won,
      medal: this.medal,
      metric: this.rules.metric(this),
      metricLabel: this.rules.metricLabel,
      medals: this.def.medals || null,
      goalLabel: this.rules.label,
      progress: this.progress,
      target: this.target,
      time: this.elapsed,
      timeLeft: this.timeLeft,
      counts: { ...this.counts },
      totalTags: this.graffiti.totalCount,
      taggedCount: this.graffiti.totalCount - this.graffiti.unclaimed,
      unclaimed: this.graffiti.unclaimed,
      standings,
      players,
      winner: standings[0] || null,
    };
  }
}
