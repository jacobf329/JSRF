/**
 * All sound is synthesised at runtime -- there are no audio assets in this
 * repo. The radio is a step sequencer driving a small set of Web Audio voices;
 * SFX are one-shot graphs built on demand.
 */

// Every pattern below is written in semitones from the track root (minor pentatonic).
const TRACKS = [
  {
    name: 'FUNKY DEALER',
    bpm: 152,
    root: 41.2, // E1
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1],
    bass: [0, null, 0, 3, null, 0, null, 5, 3, null, 0, null, 7, null, 5, 3],
    stab: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    lead: [null, null, 12, null, 10, null, null, 7, null, 12, null, null, 15, null, 12, 10],
  },
  {
    name: 'BIRTHDAY CAKE',
    bpm: 168,
    root: 49.0, // G1
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1],
    bass: [0, 0, null, 7, null, 5, null, 3, 0, null, 10, null, 7, null, 5, null],
    stab: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    lead: [12, null, null, 10, null, 12, null, 15, null, null, 17, null, 15, null, 12, null],
  },
  {
    name: 'ROLLING ON',
    bpm: 138,
    root: 36.7, // D1
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0],
    bass: [0, null, null, 0, 3, null, 5, null, 7, null, 5, 3, null, 0, null, null],
    stab: [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    lead: [null, 7, null, 10, null, null, 12, null, 10, null, 7, null, null, 5, null, 3],
  },
];

function semitoneToRatio(s) { return Math.pow(2, s / 12); }

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.masterVolume = 0.7;
    this.musicVolume = 0.5;
    this.trackIndex = 0;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.grindGain = null;
    this.grindSource = null;
    this.windGain = null;
  }

  get track() { return TRACKS[this.trackIndex]; }
  get trackName() { return this.track.name; }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);

    // Shared ping-pong-ish delay for the lead line.
    this.delay = this.ctx.createDelay(1.0);
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0.34;
    this.delayFilter = this.ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 2600;
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.musicBus);

    this.noiseBuffer = this._makeNoise(2);
    this._buildGrindLoop();
    this._buildWind();

    this.ready = true;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this._startScheduler();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // ------------------------------------------------------------- sequencer

  _startScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this._schedule(), 25);
  }

  _schedule() {
    if (!this.ready || !this.musicEnabled) return;
    const t = this.track;
    const secondsPerStep = 60 / t.bpm / 4;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextNoteTime, t);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 16;
    }
  }

  _playStep(step, time, t) {
    if (t.kick[step]) this._kick(time);
    if (t.snare[step]) this._snare(time);
    if (t.hat[step]) this._hat(time, step % 4 === 0 ? 0.16 : 0.09);
    const b = t.bass[step];
    if (b !== null && b !== undefined) this._bass(time, t.root * semitoneToRatio(b), (60 / t.bpm / 4) * 1.6);
    if (t.stab[step]) this._stab(time, t.root);
    const l = t.lead[step];
    if (l !== null && l !== undefined) this._lead(time, t.root * 8 * semitoneToRatio(l));
  }

  _env(node, time, attack, decay, peak = 1) {
    const g = node.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0.0001, time);
    g.exponentialRampToValueAtTime(peak, time + attack);
    g.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  }

  _kick(time) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    this._env(gain, time, 0.004, 0.24, 1.0);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.32);
  }

  _snare(time) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const gain = this.ctx.createGain();
    this._env(gain, time, 0.002, 0.14, 0.55);
    noise.connect(bp); bp.connect(gain); gain.connect(this.musicBus);
    noise.start(time);
    noise.stop(time + 0.2);

    const body = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(120, time + 0.09);
    this._env(bodyGain, time, 0.002, 0.09, 0.35);
    body.connect(bodyGain); bodyGain.connect(this.musicBus);
    body.start(time); body.stop(time + 0.14);
  }

  _hat(time, level) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const gain = this.ctx.createGain();
    this._env(gain, time, 0.001, 0.05, level);
    noise.connect(hp); hp.connect(gain); gain.connect(this.musicBus);
    noise.start(time); noise.stop(time + 0.09);
  }

  _bass(time, freq, dur) {
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    sub.type = 'sine';
    osc.frequency.value = freq;
    sub.frequency.value = freq / 2;
    filter.type = 'lowpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(Math.min(3200, freq * 12), time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(140, freq * 2.5), time + dur);
    this._env(gain, time, 0.008, dur, 0.42);
    osc.connect(filter); sub.connect(filter);
    filter.connect(gain); gain.connect(this.musicBus);
    osc.start(time); sub.start(time);
    osc.stop(time + dur + 0.06);
    sub.stop(time + dur + 0.06);
  }

  _stab(time, root) {
    const gain = this.ctx.createGain();
    this._env(gain, time, 0.006, 0.2, 0.2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1250;
    filter.Q.value = 1.4;
    gain.connect(this.musicBus);
    filter.connect(gain);
    for (const semi of [0, 3, 7, 10]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = root * 4 * semitoneToRatio(semi);
      osc.detune.value = (Math.random() - 0.5) * 14;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + 0.28);
    }
  }

  _lead(time, freq) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'square';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = 3400;
    this._env(gain, time, 0.004, 0.16, 0.12);
    osc.connect(filter); filter.connect(gain);
    gain.connect(this.musicBus);
    gain.connect(this.delay);
    osc.start(time); osc.stop(time + 0.22);
  }

  // -------------------------------------------------------- looped sources

  _buildGrindLoop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 4.5;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(bp); bp.connect(gain); gain.connect(this.sfxBus);
    src.start();
    this.grindSource = src;
    this.grindGain = gain;
    this.grindFilter = bp;
  }

  _buildWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(lp); lp.connect(gain); gain.connect(this.sfxBus);
    src.start();
    this.windGain = gain;
    this.windFilter = lp;
  }

  // ------------------------------------------------------------------ sfx

  _noiseBurst({ time, duration = 0.2, type = 'bandpass', freq = 1200, q = 1, gain = 0.4, sweepTo = null }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, time);
    filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, time + duration);
    const g = this.ctx.createGain();
    this._env(g, time, 0.005, duration, gain);
    src.connect(filter); filter.connect(g); g.connect(this.sfxBus);
    src.start(time);
    src.stop(time + duration + 0.05);
  }

  _blip({ time, freq, duration = 0.12, type = 'square', gain = 0.25, to = null }) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, time + duration);
    this._env(g, time, 0.004, duration, gain);
    osc.connect(g); g.connect(this.sfxBus);
    osc.start(time); osc.stop(time + duration + 0.04);
  }

  play(name, opts = {}) {
    if (!this.ready || !this.sfxEnabled) return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case 'jump':
        this._blip({ time: t, freq: 380, to: 780, duration: 0.14, type: 'triangle', gain: 0.28 });
        this._noiseBurst({ time: t, duration: 0.1, freq: 900, sweepTo: 2600, gain: 0.16 });
        break;
      case 'land':
        this._noiseBurst({ time: t, duration: 0.16, type: 'lowpass', freq: 1400, sweepTo: 260, gain: 0.34 });
        this._blip({ time: t, freq: 150, to: 70, duration: 0.12, type: 'sine', gain: 0.3 });
        break;
      case 'grindStart':
        this._noiseBurst({ time: t, duration: 0.12, freq: 3200, q: 6, gain: 0.3 });
        break;
      case 'trick':
        this._blip({ time: t, freq: 540, to: 1080, duration: 0.16, type: 'square', gain: 0.16 });
        this._blip({ time: t + 0.06, freq: 720, to: 1420, duration: 0.14, type: 'square', gain: 0.13 });
        break;
      case 'spray':
        this._noiseBurst({ time: t, duration: 0.22, type: 'highpass', freq: 2600, sweepTo: 5200, gain: 0.22 });
        break;
      case 'tag':
        for (let i = 0; i < 4; i++) {
          this._blip({ time: t + i * 0.07, freq: 440 * Math.pow(2, i / 4), duration: 0.14, type: 'square', gain: 0.2 });
        }
        break;
      case 'pickup':
        this._blip({ time: t, freq: 880, duration: 0.07, type: 'square', gain: 0.18 });
        this._blip({ time: t + 0.06, freq: 1320, duration: 0.1, type: 'square', gain: 0.16 });
        break;
      case 'hit':
        this._noiseBurst({ time: t, duration: 0.3, type: 'lowpass', freq: 1800, sweepTo: 180, gain: 0.45 });
        this._blip({ time: t, freq: 220, to: 60, duration: 0.26, type: 'sawtooth', gain: 0.28 });
        break;
      case 'alert':
        this._blip({ time: t, freq: 660, duration: 0.14, type: 'sawtooth', gain: 0.16 });
        this._blip({ time: t + 0.16, freq: 520, duration: 0.16, type: 'sawtooth', gain: 0.16 });
        break;
      case 'wallride':
        this._noiseBurst({ time: t, duration: 0.25, type: 'bandpass', freq: 1400, q: 3, gain: 0.2 });
        break;
      case 'bank':
        for (let i = 0; i < 3; i++) {
          this._blip({ time: t + i * 0.05, freq: 660 * Math.pow(2, i / 3), duration: 0.1, type: 'triangle', gain: 0.2 });
        }
        break;
      default: break;
    }
    void opts;
  }

  /** Continuous sounds tied to what the skater is doing. */
  update(dt, game) {
    if (!this.ready) return;
    const player = game.player;
    const t = this.ctx.currentTime;

    const grinding = player.state === 'grind';
    const targetGrind = grinding ? Math.min(0.3, 0.08 + player.speed * 0.012) : 0;
    this.grindGain.gain.setTargetAtTime(targetGrind, t, 0.06);
    if (grinding) {
      this.grindFilter.frequency.setTargetAtTime(1400 + player.speed * 130, t, 0.08);
    }

    const windLevel = Math.min(0.18, Math.max(0, (player.speed - 12) * 0.012));
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + player.speed * 40, t, 0.2);
  }

  nextTrack() {
    this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
    this.step = 0;
    return this.trackName;
  }

  setTrack(i) {
    this.trackIndex = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    this.step = 0;
    return this.trackName;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (this.ready) this.musicBus.gain.setTargetAtTime(on ? this.musicVolume : 0, this.ctx.currentTime, 0.1);
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.ready) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() { if (this.ready && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); }
}

export { TRACKS };
