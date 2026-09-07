import { clamp } from '../core/MathUtils.js';
import { describeCombo } from '../player/Tricks.js';

const COMBO_WINDOW = 2.2;
const MAX_MULTIPLIER = 24;

const RATES = {
  grindPerMetre: 13,
  wallridePerSecond: 110,
  airBase: 55,
  airExponent: 1.45,
  minAirTime: 0.55,
  landBonus: 120,
  knockdown: 400,
  rivalKnockdown: 650,
};

/**
 * Score, combo chain and the spray-can resource.
 *
 * Actions feed a running combo; the combo banks into the total once the player
 * spends long enough doing nothing tricky.
 */
export class Score {
  constructor(events, player) {
    this.events = events;
    this.player = player;
    this.total = 0;
    this.cans = 15;
    this.maxCans = 99;

    this.combo = 0;          // points banked in the current chain
    this.multiplier = 0;
    this.comboTimer = 0;
    this.comboLabel = '';
    this.comboTricks = [];
    this.comboActive = false;
    this.bestCombo = 0;
    this.tagsDone = 0;
    this.tricksDone = 0;
    this.grindMetres = 0;
    this.airTimeTotal = 0;
    this.lastEvent = '';

    this._bind();
  }

  /** Every gameplay event carries the player it belongs to. */
  _mine(payload) {
    return !this.player || !payload || payload.player === undefined || payload.player === this.player;
  }

  _bind() {
    const e = this.events;
    const mine = (fn) => (payload) => { if (this._mine(payload)) fn(payload); };
    e.on('player:grind:tick', mine(({ distance, player }) => {
      this.grindMetres += distance;
      // Fancier stances are worth more per metre, so holding a hard grind
      // through a long rail actually pays.
      const rate = player.grindTrick ? player.grindTrick.points : RATES.grindPerMetre;
      this._add(distance * rate, null, false);
    }));
    e.on('player:grind:start', mine(({ player }) => {
      this._chain(player.grindTrick ? player.grindTrick.name : 'GRIND');
    }));
    // Switching stance mid-rail extends the chain rather than restarting it.
    e.on('player:grind:stance', mine(({ trick }) => this._chain(trick.name)));
    e.on('player:grind:end', mine(({ distance }) => {
      if (distance > 4) this._add(distance * 2, null, false);
    }));
    e.on('player:wallride:start', mine(() => this._chain('WALL RIDE')));
    e.on('player:wallride:tick', mine(({ dt }) => this._add(RATES.wallridePerSecond * dt, null, false)));
    // Starting a trick extends the chain and names it; it does not pay. The
    // points arrive when the trick actually lands, so a trick you wiped out on
    // was never banked in the first place.
    e.on('player:trick', mine(({ trick }) => {
      this.tricksDone++;
      this._chain(trick.name, 0);
    }));
    e.on('player:trick:complete', mine(({ trick, progress }) => {
      this._add(trick.points * progress, null, false);
    }));
    e.on('player:bail', mine(() => this.loseCombo()));
    e.on('player:land', mine(({ airTime }) => {
      this.airTimeTotal += airTime;
      if (airTime >= RATES.minAirTime) {
        const pts = RATES.airBase * Math.pow(airTime, RATES.airExponent) + RATES.landBonus;
        this._chain(airTime > 1.8 ? 'BIG AIR' : 'AIR', pts);
      }
    }));
    e.on('tag:complete', mine(({ points, cans, word, retag, stolenFrom }) => {
      this.tagsDone++;
      this.cans = Math.max(0, this.cans - cans);
      this._chain(retag ? `TAKEOVER: ${stolenFrom.short}` : `TAG: ${word}`, points);
    }));
    e.on('pickup:can', mine(({ amount }) => {
      this.cans = Math.min(this.maxCans, this.cans + amount);
      this.events.emit('score:cans', { cans: this.cans, player: this.player });
    }));
    e.on('police:knockdown', mine(() => this._chain('TAKEDOWN', RATES.knockdown)));
    // Skating through a rival mid-spray is worth more than flooring a cop --
    // it costs them the wall as well.
    e.on('rival:knockdown', mine(({ gang }) => this._chain(`${gang.short} WIPED OUT`, RATES.rivalKnockdown)));
    e.on('player:hit', mine(() => this.breakCombo()));
    e.on('player:respawn', mine(() => this.breakCombo()));
  }

  /** Start or extend the chain, optionally with a lump of points. */
  _chain(label, points = 0) {
    this.comboActive = true;
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
    this.comboTimer = COMBO_WINDOW;
    this.comboLabel = label;
    // Repeating the same stance should not stutter the readout.
    if (this.comboTricks[this.comboTricks.length - 1] !== label) this.comboTricks.push(label);
    this.lastEvent = label;
    if (points) this.combo += points;
    this.events.emit('score:chain', { label, points, multiplier: this.multiplier, player: this.player });
  }

  /** Add points to the running chain without bumping the multiplier. */
  _add(points, label = null, extend = true) {
    if (!this.comboActive) {
      this.comboActive = true;
      this.multiplier = Math.max(1, this.multiplier);
    }
    this.combo += points;
    if (extend) this.comboTimer = COMBO_WINDOW;
    else this.comboTimer = Math.max(this.comboTimer, 0.55);
    if (label) this.comboLabel = label;
  }

  /** Bank the chain into the total. */
  bank() {
    if (!this.comboActive) return 0;
    const gained = Math.round(this.combo * Math.max(1, this.multiplier));
    this.total += gained;
    this.bestCombo = Math.max(this.bestCombo, gained);
    const payload = { gained, combo: this.combo, multiplier: this.multiplier };
    this.combo = 0;
    this.multiplier = 0;
    this.comboActive = false;
    this.comboLabel = '';
    this.comboTricks = [];
    this.comboTimer = 0;
    payload.player = this.player;
    if (gained > 0) this.events.emit('score:bank', payload);
    return gained;
  }

  /** Everything, gone. What a bail costs. */
  loseCombo() {
    if (!this.comboActive) {
      this.events.emit('score:lost', { lost: 0, player: this.player });
      return 0;
    }
    const lost = this.comboPreview;
    this.combo = 0;
    this.multiplier = 0;
    this.comboActive = false;
    this.comboTimer = 0;
    this.comboLabel = '';
    this.comboTricks = [];
    this.events.emit('score:lost', { lost, player: this.player });
    return lost;
  }

  /** Getting hit is softer than bailing: a quarter of the chain survives. */
  breakCombo() {
    if (!this.comboActive) return;
    const gained = Math.round(this.combo * Math.max(1, this.multiplier) * 0.25);
    this.total += gained;
    this.combo = 0;
    this.multiplier = 0;
    this.comboActive = false;
    this.comboTimer = 0;
    this.comboLabel = '';
    this.comboTricks = [];
    this.events.emit('score:break', { gained, player: this.player });
  }

  update(dt) {
    if (!this.comboActive) return;
    const player = this.player;
    const chaining = player.state === 'grind' || player.state === 'wallride' || !player.grounded;
    if (!chaining) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.bank();
    }
  }

  /** Back to a fresh run without re-binding event listeners. */
  reset() {
    this.total = 0;
    this.cans = 15;
    this.combo = 0;
    this.multiplier = 0;
    this.comboTimer = 0;
    this.comboLabel = '';
    this.comboTricks = [];
    this.comboActive = false;
    this.bestCombo = 0;
    this.tagsDone = 0;
    this.tricksDone = 0;
    this.grindMetres = 0;
    this.airTimeTotal = 0;
  }

  /** The chain as it reads on the HUD: "METHOD AIR to 540 SPIN to SOUL GRIND". */
  get comboText() {
    return describeCombo(this.comboTricks) || this.comboLabel || 'COMBO';
  }

  get comboPreview() {
    return Math.round(this.combo * Math.max(1, this.multiplier));
  }

  get comboFraction() {
    return clamp(this.comboTimer / COMBO_WINDOW, 0, 1);
  }
}
