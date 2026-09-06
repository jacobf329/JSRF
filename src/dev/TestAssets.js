/**
 * Builds a small rigged, animated GLB in memory.
 *
 * Only ever imported dynamically, by the asset-pipeline test, so it never
 * reaches a production bundle. It exists so the loader can be proven
 * end-to-end -- skeleton, clips, PBR-to-toon conversion and rig swap -- without
 * needing a real character model committed to the repository.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

function buildSkinnedFigure() {
  const geometry = new THREE.BoxGeometry(0.5, 2, 0.5, 1, 6, 1);
  const position = geometry.attributes.position;
  const skinIndices = [];
  const skinWeights = [];
  for (let i = 0; i < position.count; i++) {
    // Blend from the lower bone to the upper one over the height of the box.
    const t = THREE.MathUtils.clamp((position.getY(i) + 1) / 2, 0, 1);
    skinIndices.push(0, 1, 0, 0);
    skinWeights.push(1 - t, t, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.y = -1;
  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.y = 1;
  hips.add(chest);

  // A PBR material on purpose: the point is to watch it become a toon one.
  const material = new THREE.MeshStandardMaterial({ color: 0xff2f87, roughness: 0.6 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'body';
  mesh.add(hips);
  mesh.bind(new THREE.Skeleton([hips, chest]));

  const group = new THREE.Group();
  group.name = 'TestRudie';
  group.add(mesh);
  return group;
}

function buildClips() {
  const lean = (name, angle) => new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('chest.quaternion', [0, 0.5, 1], [
      0, 0, 0, 1,
      ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray(),
      0, 0, 0, 1,
    ]),
  ]);
  return [lean('idle', 0.15), lean('skate', 0.5), lean('trick_kickflip', 1.1)];
}

/** @returns {Promise<ArrayBuffer>} a binary glTF containing a rigged figure. */
export function makeRiggedGlb() {
  const figure = buildSkinnedFigure();
  const clips = buildClips();
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      figure,
      (result) => resolve(result),
      (err) => reject(err),
      { binary: true, animations: clips },
    );
  });
}
