import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MANIFEST, ASSET_KIND } from './AssetManifest.js';
import { toonifyObject } from '../render/ToonConvert.js';

/**
 * Loads the game's external assets.
 *
 * Two rules shape this:
 *
 * 1. Nothing here is allowed to break the game. Every manifest entry is
 *    optional by default, a failed load is recorded and moved past, and
 *    callers ask `get(id)` and cope with null. The single-file build ships no
 *    assets at all and must keep working.
 * 2. Everything arrives already looking like the rest of the game. Imported
 *    materials are re-shaded to the cel look on the way in, so a model never
 *    lands in the scene as a smoothly lit stranger.
 *
 * Draco and KTX2 decoders are wired up lazily: most models need neither, and
 * loading their wasm on boot for nothing is a waste.
 */
export class AssetManager {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.basePath = options.basePath ?? '';
    this.assets = new Map();
    this.failures = new Map();
    this.loading = 0;
    this.loaded = 0;

    this.manager = new THREE.LoadingManager();
    this.gltf = new GLTFLoader(this.manager);
    this.textures = new THREE.TextureLoader(this.manager);
    this._draco = null;
    this._ktx2 = null;
  }

  /** Resolve against the document base, so dev, app:// and static hosting agree. */
  url(path) {
    const relative = this.basePath ? `${this.basePath}/${path}` : path;
    if (typeof document === 'undefined') return relative;
    return new URL(relative, document.baseURI).href;
  }

  async _enableDraco() {
    if (this._draco) return;
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    this._draco = new DRACOLoader(this.manager);
    if (this._draco.unavailable) return;      // stubbed out in the single-file build
    this._draco.setDecoderPath(this.url('vendor/draco/'));
    this.gltf.setDRACOLoader(this._draco);
  }

  async _enableKtx2() {
    if (this._ktx2) return;
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    this._ktx2 = new KTX2Loader(this.manager);
    if (this._ktx2.unavailable) return;
    this._ktx2.setTranscoderPath(this.url('vendor/basis/'));
    this._ktx2.detectSupport(this.renderer);
    this.gltf.setKTX2Loader(this._ktx2);
  }

  /**
   * Turn on the optional decoders. Loaded on demand: most models need neither,
   * and their wasm is far larger than everything else the game ships.
   */
  async enableCompression({ draco = true, ktx2 = true } = {}) {
    if (draco) await this._enableDraco();
    if (ktx2) await this._enableKtx2();
    return this;
  }

  // ------------------------------------------------------------------ load

  async loadGltf(entry) {
    const url = this.url(entry.url);
    const gltf = await this.gltf.loadAsync(url);
    return this._prepareGltf(gltf, entry);
  }

  /** Parse an in-memory GLB. Used by tooling and tests; same preparation. */
  async parseGltf(arrayBuffer, entry = {}) {
    const gltf = await new Promise((resolve, reject) => {
      this.gltf.parse(arrayBuffer, '', resolve, reject);
    });
    return this._prepareGltf(gltf, entry);
  }

  _prepareGltf(gltf, entry) {
    if (entry.shading !== 'raw') toonifyObject(gltf.scene);

    let skinned = null;
    gltf.scene.traverse((obj) => { if (obj.isSkinnedMesh && !skinned) skinned = obj; });

    return {
      kind: ASSET_KIND.MODEL,
      id: entry.id,
      scene: gltf.scene,
      animations: gltf.animations || [],
      // A raw text-to-3D export is a static mesh with no skeleton. That is not
      // an error, but it cannot be animated, and the caller needs to know
      // rather than silently showing a T-posed statue.
      rigged: !!skinned,
      clipNames: (gltf.animations || []).map((c) => c.name),
    };
  }

  async loadTexture(entry) {
    const texture = await this.textures.loadAsync(this.url(entry.url));
    texture.colorSpace = entry.linear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (entry.repeat) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(entry.repeat[0], entry.repeat[1]);
    }
    return { kind: ASSET_KIND.TEXTURE, id: entry.id, texture };
  }

  async loadEntry(entry) {
    try {
      const asset = entry.kind === ASSET_KIND.TEXTURE
        ? await this.loadTexture(entry)
        : await this.loadGltf(entry);
      asset.entry = entry;
      this.assets.set(entry.id, asset);
      return asset;
    } catch (err) {
      this.failures.set(entry.id, err);
      if (!entry.optional) throw err;
      // Expected whenever an optional asset simply is not there yet.
      console.info(`[assets] ${entry.id} unavailable (${entry.url}); using the built-in fallback.`);
      return null;
    }
  }

  /**
   * Load the manifest. Resolves once every entry has settled, whether or not
   * each one succeeded, so boot is never blocked by a missing optional file.
   */
  async loadAll(entries = MANIFEST, onProgress = null) {
    this.loading = entries.length;
    this.loaded = 0;
    await Promise.all(entries.map(async (entry) => {
      await this.loadEntry(entry);
      this.loaded++;
      if (onProgress) onProgress(this.loaded / Math.max(1, this.loading), entry);
    }));
    return this.assets;
  }

  get(id) { return this.assets.get(id) || null; }
  has(id) { return this.assets.has(id); }
  failed(id) { return this.failures.get(id) || null; }

  /** A short line for the console or a debug overlay. */
  summary() {
    return {
      loaded: this.assets.size,
      failed: this.failures.size,
      ids: [...this.assets.keys()],
      missing: [...this.failures.keys()],
    };
  }

  dispose() {
    for (const asset of this.assets.values()) {
      if (asset.texture) asset.texture.dispose();
      if (asset.scene) {
        asset.scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) if (m && m.dispose) m.dispose();
        });
      }
    }
    this.assets.clear();
    if (this._draco) this._draco.dispose();
    if (this._ktx2) this._ktx2.dispose();
  }
}
