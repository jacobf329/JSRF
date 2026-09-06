import { clamp } from '../core/MathUtils.js';

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
    e.on('player:grind:tick', mine(({ distance }) => {
      this.grindMetres += distance;
      this._add(distance * RATES.grindPerMetre, null, false);
    }));
    e.on('player:grind:start', mine(({ player }) => {
      this._chain(player.grindTrick || 'GRIND');
    }));
    e.on('player:grind:end', mine(({ distance }) => {
      if (distance > 4) this._add(distance * 2, null, false);
    }));
    e.on('player:wallride:start', mine(() => this._chain('WALL RIDE')));
    e.on('player:wallride:tick', mine(({ dt }) => this._add(RATES.wallridePerSecond * dt, null, false)));
    e.on('player:trick', mine(({ trick }) => {
      this.tricksDone++;
      this._chain(trick.name, trick.points);
    }));
    e.on('player:land', mine(({ airTime }) => {
      this.airTimeTotal += airTime;
      if (airTime >= RATES.minAirTime) {
        const pts = RATES.airBase * Math.pow(airTime, RATES.airExponent) + RATES.landBonus;
        this._chain(airTime > 1.8 ? 'BIG AIR' : 'AIR', pts);
      }
    }));
    e.on('tag:complete', mine(({ points, cans, word }) => {
      this.tagsDone++;
      this.cans = Math.max(0, this.cans - cans);
      this._chain(`TAG: ${word}`, points);
    }));
    e.on('pickup:can', mine(({ amount }) => {
      this.cans = Math.min(this.maxCans, this.cans + amount);
      this.events.emit('score:cans', { cans: this.cans, player: this.player });
    }));
    e.on('police:knockdown', mine(() => this._chain('TAKEDOWN', RATES.knockdown)));
    e.on('player:hit', mine(() => this.breakCombo()));
    e.on('player:respawn', mine(() => this.breakCombo()));
  }

  /** Start or extend the chain, optionally with a lump of points. */
  _chain(label, points = 0) {
    this.comboActive = true;
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
    this.comboTimer = COMBO_WINDOW;
    this.comboLabel = label;
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
    this.comboTimer = 0;
    payload.player = this.player;
    if (gained > 0) this.events.emit('score:bank', payload);
    return gained;
  }

  breakCombo() {
    if (!this.comboActive) return;
    // A wipeout still pays out, just at a quarter rate.
    const gained = Math.round(this.combo * Math.max(1, this.multiplier) * 0.25);
    this.total += gained;
    this.combo = 0;
    this.multiplier = 0;
    this.comboActive = false;
    this.comboTimer = 0;
    this.comboLabel = '';
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
    this.comboActive = false;
    this.bestCombo = 0;
    this.tagsDone = 0;
    this.tricksDone = 0;
    this.grindMetres = 0;
    this.airTimeTotal = 0;
  }

  get comboPreview() {
    return Math.round(this.combo * Math.max(1, this.multiplier));
  }

  get comboFraction() {
    return clamp(this.comboTimer / COMBO_WINDOW, 0, 1);
  }
}
