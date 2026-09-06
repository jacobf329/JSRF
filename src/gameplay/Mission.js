/**
 * Run rules: tag every wall in the district.
 *
 * With more than one skater it becomes a race for the same walls -- the tag
 * count is shared, but score, cans and busts are per player, and the run ends
 * when the last wall goes up.
 */
export class Mission {
  constructor(events, graffiti, police) {
    this.events = events;
    this.graffiti = graffiti;
    this.police = police;
    this.slots = [];

    this.elapsed = 0;
    this.complete = false;
    this.running = false;

    events.on('police:knockdown', ({ player }) => {
      const slot = this.slotFor(player);
      if (slot) slot.takedowns++;
    });
    events.on('player:down', ({ player }) => this._bust(player));
    events.on('tag:complete', ({ player }) => {
      const slot = this.slotFor(player);
      if (slot) slot.tags++;
      if (graffiti.remaining === 0) this._finish();
    });
  }

  setSlots(slots) {
    this.slots = slots;
    for (const slot of slots) {
      slot.tags = 0;
      slot.busts = 0;
      slot.takedowns = 0;
    }
  }

  slotFor(player) {
    return this.slots.find((s) => s.player === player) || null;
  }

  start() {
    this.elapsed = 0;
    this.complete = false;
    this.running = true;
    for (const slot of this.slots) {
      slot.tags = 0;
      slot.busts = 0;
      slot.takedowns = 0;
    }
  }

  update(dt) {
    if (!this.running || this.complete) return;
    this.elapsed += dt;
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

  _finish() {
    if (this.complete) return;
    this.complete = true;
    this.running = false;
    for (const slot of this.slots) slot.score.bank();
    this.events.emit('mission:complete', { stats: this.stats });
  }

  /** Per-player standings plus the shared run summary. */
  get stats() {
    const players = this.slots.map((slot) => ({
      index: slot.index,
      name: slot.name,
      colorHex: slot.colorHex,
      score: slot.score.total,
      tags: slot.tags,
      bestCombo: slot.score.bestCombo,
      tricks: slot.score.tricksDone,
      grindMetres: slot.score.grindMetres,
      airTime: slot.score.airTimeTotal,
      takedowns: slot.takedowns,
      busts: slot.busts,
    }));
    players.sort((a, b) => b.score - a.score);
    return {
      complete: this.complete,
      time: this.elapsed,
      totalTags: this.graffiti.totalCount,
      taggedCount: this.graffiti.taggedCount,
      players,
      winner: players[0] || null,
    };
  }
}
