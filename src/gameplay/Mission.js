import { GANGS } from './Gangs.js';

// Long enough to cross the city a few times, short enough that losing a wall
// in the last minute actually hurts.
const RUN_TIME = 300;

/**
 * Run rules: hold more walls than anybody else when the clock stops.
 *
 * Nothing is ever finished -- a wall you painted in the first minute can be
 * taken back in the last one -- so the run ends on the clock, or early if one
 * crew somehow owns the whole map. Score still accumulates and still breaks
 * ties, but walls are what you are playing for.
 */
export class Mission {
  constructor(events, graffiti, police) {
    this.events = events;
    this.graffiti = graffiti;
    this.police = police;
    this.slots = [];
    this.aiGangs = [];

    this.duration = RUN_TIME;
    this.timeLeft = RUN_TIME;
    this.elapsed = 0;
    this.complete = false;
    this.running = false;
    this._warned = 0;

    events.on('police:knockdown', ({ player }) => {
      const slot = this.slotFor(player);
      if (slot) slot.takedowns++;
    });
    events.on('player:down', ({ player }) => this._bust(player));
    events.on('tag:complete', ({ player, retag }) => {
      const slot = this.slotFor(player);
      if (slot) { slot.tags++; if (retag) slot.steals++; }
      this._checkWipeout();
    });
    events.on('rival:tag', () => this._checkWipeout());
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

  start() {
    this.elapsed = 0;
    this.timeLeft = this.duration;
    this.complete = false;
    this.running = true;
    this._warned = 0;
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

    // One shout at a minute left, one at ten seconds.
    for (const [mark, label] of [[60, 'ONE MINUTE LEFT'], [10, 'TEN SECONDS']]) {
      if (this.timeLeft <= mark && this._warned < mark) {
        this._warned = mark;
        this.events.emit('mission:warning', { timeLeft: this.timeLeft, label });
        break;
      }
    }

    if (this.timeLeft <= 0) this._finish('time');
  }

  /** A crew owning every wall on the map ends it there and then. */
  _checkWipeout() {
    if (this.graffiti.unclaimed > 0) return;
    const first = this.graffiti.spots[0].owner;
    for (const spot of this.graffiti.spots) if (spot.owner !== first) return;
    this._finish('wipeout');
  }

  _bust(player) {
    const slot = this.slotFor(player);
    if (!slot) return;
    slot.busts++;
    slot.score.breakCombo();
    const penalty = Math.round(slot.score.total * 0.2);
    slot.score.total = Math.max(0, slot.score.total - penalty);
    // Heat only clears once nobody is left standing on the street.
    if (this.slots.every((s) => s.player.health <= 0 || s === slot)) this.police.reset();
    this.events.emit('mission:busted', { penalty, player, slot, busts: slot.busts });
  }

  _finish(reason = 'time') {
    if (this.complete) return;
    this.complete = true;
    this.running = false;
    for (const slot of this.slots) slot.score.bank();
    this.events.emit('mission:complete', { stats: this.stats, reason });
  }

  /** Per-crew standings plus the shared run summary. */
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
    // Walls decide it; score is only there to break a tie.
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
      complete: this.complete,
      time: this.elapsed,
      totalTags: this.graffiti.totalCount,
      taggedCount: this.graffiti.totalCount - this.graffiti.unclaimed,
      unclaimed: this.graffiti.unclaimed,
      standings,
      players,
      winner: standings[0] || null,
    };
  }
}
