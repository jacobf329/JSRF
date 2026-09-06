/**
 * Run rules: tag every wall in the district. Getting busted costs score and
 * clears the heat, but the run keeps going.
 */
export class Mission {
  constructor(events, graffiti, score, police) {
    this.events = events;
    this.graffiti = graffiti;
    this.score = score;
    this.police = police;

    this.elapsed = 0;
    this.complete = false;
    this.busts = 0;
    this.takedowns = 0;
    this.running = false;

    events.on('police:knockdown', () => { this.takedowns++; });
    events.on('player:down', () => this._bust());
    events.on('tag:complete', () => {
      if (graffiti.remaining === 0) this._finish();
    });
  }

  start() {
    this.elapsed = 0;
    this.complete = false;
    this.busts = 0;
    this.takedowns = 0;
    this.running = true;
  }

  update(dt) {
    if (!this.running || this.complete) return;
    this.elapsed += dt;
  }

  _bust() {
    this.busts++;
    this.score.breakCombo();
    const penalty = Math.round(this.score.total * 0.2);
    this.score.total = Math.max(0, this.score.total - penalty);
    this.police.reset();
    this.events.emit('mission:busted', { penalty, busts: this.busts });
  }

  _finish() {
    if (this.complete) return;
    this.complete = true;
    this.running = false;
    this.score.bank();
    this.events.emit('mission:complete', { stats: this.stats });
  }

  get stats() {
    return {
      complete: this.complete,
      score: this.score.total,
      tags: this.graffiti.taggedCount,
      totalTags: this.graffiti.totalCount,
      time: this.elapsed,
      bestCombo: this.score.bestCombo,
      tricks: this.score.tricksDone,
      grindMetres: this.score.grindMetres,
      airTime: this.score.airTimeTotal,
      takedowns: this.takedowns,
      busts: this.busts,
    };
  }
}
