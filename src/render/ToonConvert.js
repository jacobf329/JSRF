import * as THREE from 'three';
import { gradientMap } from './Materials.js';

/**
 * Re-shades imported PBR materials into the game's cel look.
 *
 * A model exported from Meshy, Mixamo or Blender arrives with
 * MeshStandardMaterial and a full PBR setup; dropped into this game unchanged
 * it reads as a smoothly lit object glued onto a flat-shaded world. Converting
 * to MeshToonMaterial keeps the base colour texture -- which is the whole point
 * of a textured asset -- while putting it back under the same banded lighting
 * and the same ink outlines as everything else.
 */

const converted = new WeakMap();

export function toonifyMaterial(source, options = {}) {
  const { steps = 3, keepNormalMap = true } = options;
  if (!source) return source;
  if (converted.has(source)) return converted.get(source);
  if (source.isMeshToonMaterial) return source;

  const material = new THREE.MeshToonMaterial({
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    map: source.map || null,
    normalMap: keepNormalMap ? (source.normalMap || null) : null,
    alphaMap: source.alphaMap || null,
    emissive: source.emissive ? source.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: source.emissiveMap || null,
    gradientMap: gradientMap(steps),
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    vertexColors: source.vertexColors,
    depthWrite: source.depthWrite,
    name: source.name,
  });

  // A base colour map already carries its own tint; letting the material colour
  // multiply on top of it a second time washes textured models out.
  if (material.map) material.color.setScalar(1);
  if (material.normalMap && source.normalScale) material.normalScale.copy(source.normalScale);

  converted.set(source, material);
  return material;
}

/**
 * Convert every material in a subtree, and set it up to sit in the world:
 * shadows on, and skinned meshes exempt from frustum culling (their bounds are
 * the bind pose, so an animated limb can otherwise pop out of view).
 */
export function toonifyObject(root, options = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    obj.castShadow = options.castShadow ?? true;
    obj.receiveShadow = options.receiveShadow ?? false;
    if (obj.isSkinnedMesh) obj.frustumCulled = false;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => toonifyMaterial(m, options));
    } else {
      obj.material = toonifyMaterial(obj.material, options);
    }
  });
  return root;
}

/** Scale and centre a model so it stands the requested height with feet at y=0. */
export function fitToHeight(root, targetHeight) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y < 1e-4) return root;
  const scale = targetHeight / size.y;
  root.scale.multiplyScalar(scale);

  const scaled = new THREE.Box3().setFromObject(root);
  const centre = new THREE.Vector3();
  scaled.getCenter(centre);
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= scaled.min.y;
  return root;
}
