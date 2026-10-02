import * as THREE from 'three';
import { PALETTE } from './Palette.js';

const gradientCache = new Map();
const toonCache = new Map();

/**
 * A fresnel rim, injected into three's toon shader.
 *
 * Cel shading alone gives a surface two or three flat bands and nothing at the
 * edge, so a curved form silhouetted against the sky loses its own outline.
 * A rim term puts sky light back along the grazing edge, which is what reads
 * as a drawn highlight and what separates a rudie from the building behind.
 *
 * Patched in rather than written as a custom material so everything three
 * already does -- shadows, fog, the gradient ramp -- keeps working.
 */
const RIM_PARS = /* glsl */ `
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
`;

const RIM_BODY = /* glsl */ `
{
  vec3 rimNormal = normalize(normal);
  vec3 rimView = normalize(vViewPosition);
  float fres = 1.0 - clamp(dot(rimNormal, rimView), 0.0, 1.0);
  // Bias the rim upward: a street lit from the sky should glow along the top
  // edge far more than along the bottom one.
  float up = 0.55 + 0.45 * clamp(rimNormal.y * 0.5 + 0.5, 0.0, 1.0);
  float rim = pow(fres, uRimPower) * uRimStrength * up;
  gl_FragColor.rgb += uRimColor * rim;
}
`;

// Deliberately faint. The look this is serving is flat poster colour with ink
// on top, and a strong rim turns that into moody stylised 3D -- it should be
// just enough to keep a curved edge from dissolving into whatever is behind
// it, and no more.
const RIM = {
  color: new THREE.Color(0xd8f0ff),
  power: 4.0,
  strength: 0.13,
};

function addRim(mat) {
  const uniforms = {
    uRimColor: { value: RIM.color.clone() },
    uRimPower: { value: RIM.power },
    uRimStrength: { value: RIM.strength },
  };
  mat.userData.rimUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // `vViewPosition` and `normal` are both in scope at this point in three's
    // toon shader; if the chunk ever moves, the material still compiles and
    // simply renders without a rim rather than going black.
    if (!shader.fragmentShader.includes('#include <colorspace_fragment>')) return;
    shader.fragmentShader = RIM_PARS + shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `${RIM_BODY}
#include <colorspace_fragment>`,
    );
  };
  // Materials that differ only by their injected code still need distinct
  // programs, which three keys off this.
  mat.customProgramCacheKey = () => 'rim';
  return mat;
}

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
  addRim(mat);
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
