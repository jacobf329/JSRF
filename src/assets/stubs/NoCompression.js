/**
 * Stand-ins for the Draco and KTX2 loaders.
 *
 * The single-file build ships no external assets, so a megabyte of wasm
 * decoders for files that cannot exist is pure weight. The single-file bundler
 * aliases the real loaders to these; nothing calls them there.
 */
class Unavailable {
  constructor() {
    this.unavailable = true;
  }

  setDecoderPath() { return this; }
  setTranscoderPath() { return this; }
  detectSupport() { return this; }
  preload() { return this; }
  dispose() { }
}

export class DRACOLoader extends Unavailable {}
export class KTX2Loader extends Unavailable {}
