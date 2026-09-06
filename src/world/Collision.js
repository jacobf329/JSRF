import * as THREE from 'three';

export const SURFACE = {
  DEFAULT: 0,
  ROAD: 1,
  WALL: 2,      // wall-ridable
  SLICK: 3,     // glass / signage - no wall ride
  METAL: 4,
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _bp = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _refPt = new THREE.Vector3();
const _triPt = new THREE.Vector3();
const _segPt = new THREE.Vector3();
const _edge1 = new THREE.Vector3();
const _edge2 = new THREE.Vector3();
const _pvec = new THREE.Vector3();
const _tvec = new THREE.Vector3();
const _qvec = new THREE.Vector3();

/** Closest point on triangle abc to point p (Ericson, Real-Time Collision Detection). */
function closestPointOnTriangle(p, a, b, c, out) {
  _ab.subVectors(b, a);
  _ac.subVectors(c, a);
  _ap.subVectors(p, a);
  const d1 = _ab.dot(_ap);
  const d2 = _ac.dot(_ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);

  _bp.subVectors(p, b);
  const d3 = _ab.dot(_bp);
  const d4 = _ac.dot(_bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return out.copy(a).addScaledVector(_ab, v);
  }

  _cp.subVectors(p, c);
  const d5 = _ab.dot(_cp);
  const d6 = _ac.dot(_cp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return out.copy(a).addScaledVector(_ac, w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return out.copy(b).addScaledVector(_tmp.subVectors(c, b), w);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return out.copy(a).addScaledVector(_ab, v).addScaledVector(_ac, w);
}

/** Closest point on segment [s0, s1] to point p. */
function closestPointOnSegment(p, s0, s1, out) {
  _tmp.subVectors(s1, s0);
  const len2 = _tmp.lengthSq();
  if (len2 < 1e-12) return out.copy(s0);
  let t = _tmp2.subVectors(p, s0).dot(_tmp) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return out.copy(s0).addScaledVector(_tmp, t);
}

export class Contact {
  constructor() {
    this.normal = new THREE.Vector3();
    this.point = new THREE.Vector3();
    this.depth = 0;
    this.surface = SURFACE.DEFAULT;
  }
}

/**
 * Static triangle-soup collision with a uniform XZ spatial hash.
 *
 * The whole city is baked once at load time; queries are then just a handful of
 * cell lookups, which keeps the skater's sub-stepped movement cheap.
 */
export class CollisionWorld {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this._verts = [];     // flat x,y,z * 3 per tri
    this._normals = [];
    this._surfaces = [];
    this.triCount = 0;

    this.verts = null;
    this.normals = null;
    this.surfaces = null;
    this.cells = new Map();

    this._visited = null;
    this._queryId = 0;
    this._results = [];
    this.contacts = [];
    this._contactPool = [];
  }

  addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, surface = SURFACE.DEFAULT) {
    _a.set(ax, ay, az); _b.set(bx, by, bz); _c.set(cx, cy, cz);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    _n.crossVectors(_ab, _ac);
    const len = _n.length();
    if (len < 1e-9) return; // degenerate
    _n.divideScalar(len);
    this._verts.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this._normals.push(_n.x, _n.y, _n.z);
    this._surfaces.push(surface);
    this.triCount++;
  }

  /** Bake a mesh's triangles in world space. `mesh.userData.surface` picks the surface type. */
  addMesh(mesh) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    if (!geo || !geo.attributes.position) return;
    const surface = mesh.userData.surface ?? SURFACE.DEFAULT;
    const pos = geo.attributes.position;
    const index = geo.index;
    const m = mesh.matrixWorld;

    const readVert = (i, target) => {
      target.fromBufferAttribute(pos, i).applyMatrix4(m);
    };

    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;
      readVert(i0, _segA); readVert(i1, _segB); readVert(i2, _refPt);
      this.addTriangle(
        _segA.x, _segA.y, _segA.z,
        _segB.x, _segB.y, _segB.z,
        _refPt.x, _refPt.y, _refPt.z,
        surface,
      );
    }
  }

  /** Recursively bake every mesh in a subtree that is not marked `noCollide`. */
  addObject(root) {
    root.updateWorldMatrix(true, true);
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      if (obj.userData.noCollide) return;
      this.addMesh(obj);
    });
  }

  build() {
    this.verts = new Float32Array(this._verts);
    this.normals = new Float32Array(this._normals);
    this.surfaces = new Uint8Array(this._surfaces);
    this._verts = null;
    this._normals = null;
    this._surfaces = null;

    this.cells.clear();
    const cs = this.cellSize;
    for (let t = 0; t < this.triCount; t++) {
      const o = t * 9;
      const minX = Math.min(this.verts[o], this.verts[o + 3], this.verts[o + 6]);
      const maxX = Math.max(this.verts[o], this.verts[o + 3], this.verts[o + 6]);
      const minZ = Math.min(this.verts[o + 2], this.verts[o + 5], this.verts[o + 8]);
      const maxZ = Math.max(this.verts[o + 2], this.verts[o + 5], this.verts[o + 8]);
      const cx0 = Math.floor(minX / cs);
      const cx1 = Math.floor(maxX / cs);
      const cz0 = Math.floor(minZ / cs);
      const cz1 = Math.floor(maxZ / cs);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = cx * 73856093 ^ cz * 19349663;
          let bucket = this.cells.get(key);
          if (!bucket) { bucket = []; this.cells.set(key, bucket); }
          bucket.push(t);
        }
      }
    }
    this._visited = new Int32Array(this.triCount).fill(-1);
    return this;
  }

  /** Collect triangle indices whose cells overlap the given XZ box. */
  query(minX, minZ, maxX, maxZ) {
    const out = this._results;
    out.length = 0;
    if (!this.verts) return out;
    const cs = this.cellSize;
    const id = ++this._queryId;
    const cx0 = Math.floor(minX / cs);
    const cx1 = Math.floor(maxX / cs);
    const cz0 = Math.floor(minZ / cs);
    const cz1 = Math.floor(maxZ / cs);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const bucket = this.cells.get(cx * 73856093 ^ cz * 19349663);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const t = bucket[i];
          if (this._visited[t] === id) continue;
          this._visited[t] = id;
          out.push(t);
        }
      }
    }
    return out;
  }

  _triVerts(t) {
    const o = t * 9;
    _a.set(this.verts[o], this.verts[o + 1], this.verts[o + 2]);
    _b.set(this.verts[o + 3], this.verts[o + 4], this.verts[o + 5]);
    _c.set(this.verts[o + 6], this.verts[o + 7], this.verts[o + 8]);
  }

  _triNormal(t, out) {
    const o = t * 3;
    return out.set(this.normals[o], this.normals[o + 1], this.normals[o + 2]);
  }

  _acquireContact() {
    const c = this._contactPool.length ? this._contactPool.pop() : new Contact();
    this.contacts.push(c);
    return c;
  }

  _releaseContacts() {
    for (const c of this.contacts) this._contactPool.push(c);
    this.contacts.length = 0;
  }

  /**
   * Push a vertical capsule out of the world.
   *
   * `position` is the capsule's foot point and is mutated in place.
   * Returns the contact list (valid until the next call).
   */
  resolveCapsule(position, radius, height, iterations = 4) {
    this._releaseContacts();
    if (!this.verts) return this.contacts;

    const halfSeg = Math.max(0.001, height - radius * 2);

    for (let iter = 0; iter < iterations; iter++) {
      _segA.set(position.x, position.y + radius, position.z);
      _segB.set(position.x, position.y + radius + halfSeg, position.z);

      const pad = radius + 0.15;
      const tris = this.query(
        position.x - pad, position.z - pad,
        position.x + pad, position.z + pad,
      );

      let moved = false;
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        this._triVerts(t);
        this._triNormal(t, _n);

        // Reference point: where the capsule axis crosses the triangle plane.
        const denom = _n.dot(_tmp.subVectors(_segB, _segA));
        if (Math.abs(denom) > 1e-6) {
          const s = _n.dot(_tmp2.subVectors(_a, _segA)) / denom;
          const cs = s < 0 ? 0 : s > 1 ? 1 : s;
          _refPt.copy(_segA).addScaledVector(_tmp, cs);
        } else {
          _refPt.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
        }

        closestPointOnTriangle(_refPt, _a, _b, _c, _triPt);
        closestPointOnSegment(_triPt, _segA, _segB, _segPt);
        closestPointOnTriangle(_segPt, _a, _b, _c, _triPt);

        _tmp.subVectors(_segPt, _triPt);
        const dist = _tmp.length();
        if (dist >= radius) continue;

        let nx, ny, nz;
        if (dist > 1e-5) {
          nx = _tmp.x / dist; ny = _tmp.y / dist; nz = _tmp.z / dist;
          // Never push back into the face we are resting on.
          if (nx * _n.x + ny * _n.y + nz * _n.z < 0) { nx = _n.x; ny = _n.y; nz = _n.z; }
        } else {
          nx = _n.x; ny = _n.y; nz = _n.z;
        }

        const depth = radius - dist;
        position.x += nx * depth;
        position.y += ny * depth;
        position.z += nz * depth;
        moved = true;

        const contact = this._acquireContact();
        contact.normal.set(nx, ny, nz);
        contact.point.copy(_triPt);
        contact.depth = depth;
        contact.surface = this.surfaces[t];

        _segA.set(position.x, position.y + radius, position.z);
        _segB.set(position.x, position.y + radius + halfSeg, position.z);
      }
      if (!moved) break;
    }

    return this.contacts;
  }

  /**
   * Ray cast against the soup. Returns `{ distance, point, normal, surface }`
   * or null. `dir` must be normalised.
   */
  raycast(origin, dir, maxDistance = 100, out = null) {
    if (!this.verts) return null;
    const ex = origin.x + dir.x * maxDistance;
    const ez = origin.z + dir.z * maxDistance;
    const pad = 0.001;
    const tris = this.query(
      Math.min(origin.x, ex) - pad, Math.min(origin.z, ez) - pad,
      Math.max(origin.x, ex) + pad, Math.max(origin.z, ez) + pad,
    );

    let bestT = maxDistance;
    let bestTri = -1;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      this._triVerts(t);
      _edge1.subVectors(_b, _a);
      _edge2.subVectors(_c, _a);
      _pvec.crossVectors(dir, _edge2);
      const det = _edge1.dot(_pvec);
      if (Math.abs(det) < 1e-9) continue;
      const invDet = 1 / det;
      _tvec.subVectors(origin, _a);
      const u = _tvec.dot(_pvec) * invDet;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      _qvec.crossVectors(_tvec, _edge1);
      const v = dir.dot(_qvec) * invDet;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const dist = _edge2.dot(_qvec) * invDet;
      if (dist < 1e-4 || dist >= bestT) continue;
      bestT = dist;
      bestTri = t;
    }

    if (bestTri < 0) return null;
    const result = out || { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 0 };
    result.distance = bestT;
    result.point.copy(origin).addScaledVector(dir, bestT);
    this._triNormal(bestTri, result.normal);
    result.surface = this.surfaces[bestTri];
    return result;
  }

  /** Height of the highest surface under (x, z) starting from `fromY`. */
  groundHeight(x, z, fromY = 200, maxDown = 400) {
    _tmp.set(x, fromY, z);
    _tmp2.set(0, -1, 0);
    const hit = this.raycast(_tmp, _tmp2, maxDown);
    return hit ? hit.point.y : null;
  }
}
