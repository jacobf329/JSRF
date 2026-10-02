import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Shape primitives for the rudies.
 *
 * Everything here is chamfered or curved, which matters more than it sounds.
 * A cel ramp turns the angle between a surface and the light into a band, so a
 * flat-sided box is one flat colour and reads as a box. The moment a form has
 * a rolled edge it picks up a second band along that roll, and the ink outline
 * follows a curve instead of a corner. That is the whole difference between
 * "low poly" and "drawn".
 *
 * Poly counts stay small on purpose: these are built once per rudie and up to
 * seven rudies are on screen at a time.
 */

/**
 * Put a geometry into the one shape every merge here expects.
 *
 * The primitives come from three different families -- extruded profiles,
 * lathed cylinders, hand-built strips -- and they disagree about both indexing
 * and which attributes exist. Merging needs them to agree, so everything is
 * flattened to non-indexed position + normal. The rig is painted in solid
 * colours, so UVs are dead weight anyway.
 */
export function normalise(geo) {
  const out = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  out.morphAttributes = {};
  return out;
}

/** Merge a list of geometries that may not agree about indexing or attributes. */
function join(list) {
  const clean = list.map(normalise);
  return clean.length === 1 ? clean[0] : mergeGeometries(clean, false);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

/**
 * A box with its edges rolled off.
 *
 * Built as an extruded rounded rectangle rather than a subdivided cube: the
 * profile gives the rounded silhouette from the side, and the extrude bevel
 * rounds the two remaining faces, for 1/6th the triangles of a smooth cube.
 */
export function roundedBox(w, h, d, radius = 0.05, segments = 2) {
  const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const bevel = Math.min(r, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  shape.moveTo(-hw, -h / 2);
  shape.lineTo(hw, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
  shape.lineTo(w / 2, hh);
  shape.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
  shape.lineTo(-hw, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
  shape.lineTo(-w / 2, -hh);
  shape.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d - bevel * 2,
    bevelEnabled: bevel > 1e-3,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: segments + 1,
    steps: 1,
  });
  geo.translate(0, 0, -(d - bevel * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A limb segment: a rounded tube that narrows toward the far end.
 *
 * Built around the origin pointing down -Y, which is how every joint in the
 * rig hangs, so a limb geometry drops straight into a pivot with no transform.
 */
export function limbGeo(length, topRadius, bottomRadius, { segments = 8, squash = 1 } = {}) {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, length, segments, 1, false);
  geo.translate(0, -length / 2, 0);
  if (squash !== 1) geo.scale(1, 1, squash);
  geo.computeVertexNormals();
  return geo;
}

/** A rounded mass: the head, a shoulder, a knee. */
export function blobGeo(rx, ry, rz, segments = 10) {
  const geo = new THREE.SphereGeometry(1, segments, Math.max(5, segments >> 1));
  geo.scale(rx, ry, rz);
  return geo;
}

/**
 * A swept wedge, for hair, a fringe, a coat tail.
 *
 * `curl` bends the sweep so a lock of hair falls rather than sticking out, and
 * the taper means it comes to a point the ink outline can run down.
 */
export function swoopGeo(length, width, thickness, { curl = 0.6, taper = 0.25, segments = 5 } = {}) {
  const positions = [];
  const indices = [];
  const ring = 4;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = width * (1 - (1 - taper) * t) * 0.5;
    const th = thickness * (1 - (1 - taper) * t) * 0.5;
    // Sweep back and down, accelerating, so the tip hooks.
    const z = -length * t;
    const y = -length * curl * t * t;
    positions.push(
      -w, y + th, z,
      w, y + th, z,
      w, y - th, z,
      -w, y - th, z,
    );
  }
  // The ring runs clockwise seen from behind the sweep, so the side quads wind
  // the other way round to face outward. Getting this backwards makes every
  // normal point into the shape, and a toon material renders that solid black.
  for (let i = 0; i < segments; i++) {
    const a = i * ring;
    const b = (i + 1) * ring;
    for (let k = 0; k < ring; k++) {
      const k2 = (k + 1) % ring;
      indices.push(a + k, b + k2, b + k, a + k, a + k2, b + k2);
    }
  }
  // Cap the root so it is watertight against the head.
  indices.push(0, 1, 2, 0, 2, 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * An inline skate boot: rounded shell, raised cuff, and a wheel frame.
 *
 * Returned as one geometry per colour so the whole foot is two draw calls
 * rather than a dozen. Wheels stay separate because they spin.
 */
export function skateGeo() {
  const shell = roundedBox(0.23, 0.2, 0.46, 0.085, 2);
  shell.translate(0, -0.05, 0.03);
  const cuff = roundedBox(0.21, 0.22, 0.26, 0.085, 2);
  cuff.translate(0, 0.09, -0.04);
  const toe = blobGeo(0.115, 0.085, 0.1, 8);
  toe.translate(0, -0.08, 0.22);
  return join([shell, cuff, toe]);
}

export function skateFrameGeo() {
  const frame = roundedBox(0.1, 0.1, 0.44, 0.04, 1);
  frame.translate(0, -0.2, 0.02);
  const sole = roundedBox(0.25, 0.06, 0.46, 0.03, 1);
  sole.translate(0, -0.15, 0.03);
  return join([frame, sole]);
}

/**
 * Collect geometries by colour and hand back one merged geometry each.
 *
 * A rig built part-by-part is thirty-odd draw calls and there can be seven
 * rigs on screen; merged per joint and colour it is a handful. Joints stay
 * separate because they have to move independently -- this only merges what
 * is rigid relative to the same pivot.
 */
export class PartBuilder {
  constructor() {
    this.byColor = new Map();
  }

  /** Add a geometry, positioned and rotated into the joint's local space. */
  add(geo, color, { pos, rot, scale } = {}) {
    if (pos || rot || scale) {
      _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      _q.setFromEuler(_e);
      _m.compose(
        _v.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0),
        _q,
        scale ? new THREE.Vector3(scale[0], scale[1], scale[2]) : new THREE.Vector3(1, 1, 1),
      );
      geo = geo.clone().applyMatrix4(_m);
    }
    if (!this.byColor.has(color)) this.byColor.set(color, []);
    this.byColor.get(color).push(geo);
    return this;
  }

  /** [{ color, geometry }] -- one entry per colour used. */
  build() {
    const out = [];
    for (const [color, list] of this.byColor) {
      const merged = join(list);
      if (merged) out.push({ color, geometry: merged });
    }
    this.byColor.clear();
    return out;
  }
}
