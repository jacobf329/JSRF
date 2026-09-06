import * as THREE from 'three';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _seg = new THREE.Vector3();

export const RAIL_TYPE = {
  RAIL: 'rail',     // metal handrail
  LEDGE: 'ledge',   // concrete ledge / kerb
  WIRE: 'wire',     // power line, high up
  POLE: 'pole',     // pole / pipe run
};

/**
 * An arc-length parameterised grindable line.
 *
 * Sampling once up front means grind movement is just "advance N metres along
 * the rail", which keeps speed consistent through corners.
 */
export class Rail {
  constructor(controlPoints, options = {}) {
    const {
      type = RAIL_TYPE.RAIL,
      closed = false,
      curved = controlPoints.length > 2,
      tension = 0.5,
      sampleStep = 0.9,
      boost = 1,
      name = '',
    } = options;

    this.type = type;
    this.closed = closed;
    this.boost = boost;
    this.name = name;

    const pts = controlPoints.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
    this.controlPoints = pts;

    let samples;
    if (curved && pts.length > 2) {
      const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
      const approxLen = curve.getLength();
      const n = Math.max(8, Math.ceil(approxLen / sampleStep));
      samples = curve.getSpacedPoints(n);
      this.curve = curve;
    } else {
      samples = [];
      const src = closed ? [...pts, pts[0]] : pts;
      for (let i = 0; i < src.length - 1; i++) {
        const a = src[i];
        const b = src[i + 1];
        const len = a.distanceTo(b);
        const n = Math.max(1, Math.ceil(len / sampleStep));
        for (let s = 0; s < n; s++) samples.push(a.clone().lerp(b, s / n));
      }
      samples.push(src[src.length - 1].clone());
      this.curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.0);
    }

    this.points = samples;
    this.lengths = new Float32Array(samples.length);
    let total = 0;
    for (let i = 1; i < samples.length; i++) {
      total += samples[i].distanceTo(samples[i - 1]);
      this.lengths[i] = total;
    }
    this.totalLength = total;

    this.bounds = new THREE.Box3().setFromPoints(samples);
  }

  get segmentCount() { return this.points.length - 1; }

  /** Index of the sample at or before `dist`. */
  _indexAt(dist) {
    const L = this.lengths;
    let lo = 0;
    let hi = L.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid] <= dist) lo = mid; else hi = mid;
    }
    return lo;
  }

  getPointAt(dist, out = new THREE.Vector3()) {
    const d = this.wrap(dist);
    const i = this._indexAt(d);
    const j = Math.min(i + 1, this.points.length - 1);
    const segLen = this.lengths[j] - this.lengths[i];
    const t = segLen > 1e-6 ? (d - this.lengths[i]) / segLen : 0;
    return out.copy(this.points[i]).lerp(this.points[j], t);
  }

  getTangentAt(dist, out = new THREE.Vector3()) {
    const d = this.wrap(dist);
    const i = this._indexAt(d);
    const j = Math.min(i + 1, this.points.length - 1);
    if (i === j) {
      const k = Math.max(0, i - 1);
      return out.subVectors(this.points[i], this.points[k]).normalize();
    }
    return out.subVectors(this.points[j], this.points[i]).normalize();
  }

  wrap(dist) {
    if (!this.closed) return Math.max(0, Math.min(this.totalLength, dist));
    let d = dist % this.totalLength;
    if (d < 0) d += this.totalLength;
    return d;
  }

  atEnd(dist, margin = 0.05) {
    if (this.closed) return false;
    return dist <= margin || dist >= this.totalLength - margin;
  }

  /** Closest point on the rail to `p`, restricted to a segment range if given. */
  closest(p, out = { distance: Infinity, along: 0, point: new THREE.Vector3() }) {
    out.distance = Infinity;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      _seg.subVectors(b, a);
      const len2 = _seg.lengthSq();
      if (len2 < 1e-9) continue;
      let t = _v.subVectors(p, a).dot(_seg) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      _w.copy(a).addScaledVector(_seg, t);
      const dist = _w.distanceTo(p);
      if (dist < out.distance) {
        out.distance = dist;
        out.point.copy(_w);
        out.along = this.lengths[i] + t * Math.sqrt(len2);
      }
    }
    return out;
  }
}

/** Spatially hashed collection of rails, queried every frame while airborne. */
export class RailNetwork {
  constructor(cellSize = 6) {
    this.cellSize = cellSize;
    this.rails = [];
    this.cells = new Map();
    this._hit = { rail: null, distance: Infinity, along: 0, point: new THREE.Vector3(), tangent: new THREE.Vector3() };
  }

  add(rail) {
    const index = this.rails.length;
    this.rails.push(rail);
    const cs = this.cellSize;
    for (let i = 0; i < rail.points.length - 1; i++) {
      const a = rail.points[i];
      const b = rail.points[i + 1];
      const cx0 = Math.floor(Math.min(a.x, b.x) / cs) - 1;
      const cx1 = Math.floor(Math.max(a.x, b.x) / cs) + 1;
      const cz0 = Math.floor(Math.min(a.z, b.z) / cs) - 1;
      const cz1 = Math.floor(Math.max(a.z, b.z) / cs) + 1;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = cx * 73856093 ^ cz * 19349663;
          let bucket = this.cells.get(key);
          if (!bucket) { bucket = new Set(); this.cells.set(key, bucket); }
          bucket.add(index);
        }
      }
    }
    return rail;
  }

  /**
   * Nearest grindable point within `maxDistance` of `position`.
   * Returns a shared result object or null.
   */
  find(position, maxDistance = 1.6, filter = null) {
    const cs = this.cellSize;
    const cx = Math.floor(position.x / cs);
    const cz = Math.floor(position.z / cs);
    let best = null;
    let bestDist = maxDistance;
    const seen = new Set();

    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const bucket = this.cells.get((cx + ix) * 73856093 ^ (cz + iz) * 19349663);
        if (!bucket) continue;
        for (const idx of bucket) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const rail = this.rails[idx];
          if (filter && !filter(rail)) continue;
          const res = rail.closest(position);
          if (res.distance < bestDist) {
            bestDist = res.distance;
            best = { rail, distance: res.distance, along: res.along, point: res.point.clone() };
          }
        }
      }
    }

    if (!best) return null;
    const hit = this._hit;
    hit.rail = best.rail;
    hit.distance = best.distance;
    hit.along = best.along;
    hit.point.copy(best.point);
    best.rail.getTangentAt(best.along, hit.tangent);
    return hit;
  }
}
