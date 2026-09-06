import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURFACE } from './Collision.js';
import { place } from './Geo.js';

/**
 * Accumulates level geometry and merges it into one mesh per
 * (material, surface, shadow) combination. The whole district then draws in a
 * few dozen calls instead of a few thousand.
 */
export class Builder {
  constructor() {
    this.buckets = new Map();
    this.materials = new Map();
  }

  /**
   * @param {THREE.BufferGeometry} geo  consumed by the builder
   * @param {THREE.Material} material
   * @param {object} opts  { surface, collide, castShadow, receiveShadow, transform, renderOrder }
   */
  add(geo, material, opts = {}) {
    const {
      surface = SURFACE.DEFAULT,
      collide = true,
      castShadow = true,
      receiveShadow = true,
      transform = null,
      renderOrder = 0,
    } = opts;

    if (transform) place(geo, transform);

    // mergeGeometries() needs every input to agree on indexing.
    if (geo.index) geo = geo.toNonIndexed();

    // Merging needs a consistent attribute set.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      const count = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    geo.clearGroups();

    const key = `${material.uuid}|${surface}|${collide ? 1 : 0}|${castShadow ? 1 : 0}|${receiveShadow ? 1 : 0}|${renderOrder}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material, surface, collide, castShadow, receiveShadow, renderOrder, geos: [] };
      this.buckets.set(key, bucket);
      this.materials.set(material.uuid, material);
    }
    bucket.geos.push(geo);
    return this;
  }

  /**
   * Merge every bucket into the returned group. Meshes flagged `collide` also
   * get baked into `collision` (which the caller still has to `build()`).
   */
  finish(name, collision = null) {
    const group = new THREE.Group();
    group.name = name;

    for (const bucket of this.buckets.values()) {
      if (!bucket.geos.length) continue;
      let merged;
      try {
        merged = mergeGeometries(bucket.geos, false);
      } catch (err) {
        console.warn('[Builder] merge failed, falling back to individual meshes', err);
        merged = null;
      }
      if (merged) {
        for (const g of bucket.geos) g.dispose();
        const mesh = new THREE.Mesh(merged, bucket.material);
        this._configure(mesh, bucket);
        group.add(mesh);
        if (bucket.collide && collision) collision.addMesh(mesh);
      } else {
        for (const g of bucket.geos) {
          const mesh = new THREE.Mesh(g, bucket.material);
          this._configure(mesh, bucket);
          group.add(mesh);
          if (bucket.collide && collision) collision.addMesh(mesh);
        }
      }
    }

    this.buckets.clear();
    return group;
  }

  _configure(mesh, bucket) {
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.renderOrder = bucket.renderOrder;
    mesh.userData.surface = bucket.surface;
    mesh.userData.noCollide = !bucket.collide;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  }
}
