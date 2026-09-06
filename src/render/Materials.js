import * as THREE from 'three';
import { PALETTE } from './Palette.js';

const gradientCache = new Map();
const toonCache = new Map();

/** Hard-stepped ramp texture: this is what turns Lambert shading into cel bands. */
export function gradientMap(steps = 3) {
  if (gradientCache.has(steps)) return gradientCache.get(steps);
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    // Keep the darkest band fairly bright so shadowed sides stay colourful.
    const t = i / (steps - 1);
    data[i] = Math.round(THREE.MathUtils.lerp(96, 255, t));
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientCache.set(steps, tex);
  return tex;
}

/**
 * Cached cel-shaded material. Everything in the world shares a handful of
 * these so the draw-call count stays low even with a few thousand boxes.
 */
export function toon(color, opts = {}) {
  const {
    steps = 3,
    emissive = 0x000000,
    emissiveIntensity = 1,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
    fog = true,
    depthWrite = true,
  } = opts;

  const key = `${color}|${steps}|${emissive}|${emissiveIntensity}|${transparent}|${opacity}|${side}|${fog}|${depthWrite}`;
  if (toonCache.has(key)) return toonCache.get(key);

  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(steps),
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    side,
    fog,
    depthWrite,
  });
  mat.userData.celColor = color;
  toonCache.set(key, mat);
  return mat;
}

/** Unlit flat colour, for signs, neon, HUD-ish props and particles. */
export function flat(color, opts = {}) {
  const { transparent = false, opacity = 1, side = THREE.FrontSide, fog = false, depthWrite = true } = opts;
  const key = `flat|${color}|${transparent}|${opacity}|${side}|${fog}|${depthWrite}`;
  if (toonCache.has(key)) return toonCache.get(key);
  const mat = new THREE.MeshBasicMaterial({ color, transparent, opacity, side, fog, depthWrite });
  toonCache.set(key, mat);
  return mat;
}

export function glass() {
  return toon(PALETTE.glass, { steps: 2, transparent: true, opacity: 0.55, emissive: PALETTE.glassDark, emissiveIntensity: 0.35 });
}

export function disposeMaterialCaches() {
  for (const mat of toonCache.values()) mat.dispose();
  toonCache.clear();
  for (const tex of gradientCache.values()) tex.dispose();
  gradientCache.clear();
}
