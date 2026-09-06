import * as THREE from 'three';

/** Apply a TRS placement to a geometry in place. */
export function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  if (sx !== 1 || sy !== 1 || sz !== 1) geo.scale(sx, sy, sz);
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  if (x || y || z) geo.translate(x, y, z);
  return geo;
}

export function boxGeo(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/** Box whose origin sits on its bottom face -- handy for buildings. */
export function pillarGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}

export function cylGeo(radiusTop, radiusBottom, height, segments = 12, openEnded = false) {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, openEnded);
  g.translate(0, height / 2, 0);
  return g;
}

export function sphereGeo(radius, seg = 12) {
  return new THREE.SphereGeometry(radius, seg, Math.max(6, seg >> 1));
}

/**
 * Closed solid from a 2D profile, extruded along Z and centred on it.
 * `points` is an array of [x, y] pairs describing the outline counter-clockwise.
 */
export function extrudeProfile(points, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * Ramp solid. Rises from y=0 at z=-d/2 to y=h at z=+d/2, width w along X.
 * Origin is centred on the footprint, sitting on the ground.
 */
export function wedgeGeo(w, h, d) {
  const geo = extrudeProfile([
    [-d / 2, 0],
    [d / 2, 0],
    [d / 2, h],
  ], w);
  // Profile was built in the ZY plane; rotate so extrusion runs along X.
  geo.rotateY(Math.PI / 2);
  return geo;
}

/**
 * Concave quarter-pipe transition. The skateable face curves from flat ground
 * at z=-d/2 up to vertical at z=+d/2, reaching `radius` in height.
 */
export function quarterPipeGeo(radius, width, segments = 10, base = 0.4, sweep = Math.PI / 2) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * sweep;
    pts.push([-radius / 2 + radius * Math.sin(t), radius - radius * Math.cos(t)]);
  }
  const last = pts[pts.length - 1];
  pts.push([last[0], -base]);
  pts.push([pts[0][0], -base]);
  const geo = extrudeProfile(pts, width);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** Convex bank -- the outside of a curve, good for launching off. */
export function bankGeo(radius, width, segments = 10, base = 0.4) {
  const pts = [];
  for (let i = segments; i >= 0; i--) {
    const t = (i / segments) * (Math.PI / 2);
    pts.push([-radius / 2 + radius * (1 - Math.cos(t)), radius * Math.sin(t)]);
  }
  const last = pts[pts.length - 1];
  pts.push([last[0], -base]);
  pts.push([pts[0][0], -base]);
  const geo = extrudeProfile(pts, width);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** Staircase solid rising along +Z. */
export function stairsGeo(width, totalHeight, totalDepth, steps = 8) {
  const pts = [];
  const sh = totalHeight / steps;
  const sd = totalDepth / steps;
  pts.push([-totalDepth / 2, 0]);
  for (let i = 0; i < steps; i++) {
    const z = -totalDepth / 2 + i * sd;
    pts.push([z, (i + 1) * sh]);
    pts.push([z + sd, (i + 1) * sh]);
  }
  pts.push([totalDepth / 2, 0]);
  const geo = extrudeProfile(pts, width);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** Hollow-ish arch / gateway made from a single extruded outline. */
export function archGeo(width, height, thickness, openWidth, openHeight, depth) {
  const hw = width / 2;
  const ow = openWidth / 2;
  const pts = [
    [-hw, 0], [-ow, 0], [-ow, openHeight], [ow, openHeight], [ow, 0], [hw, 0],
    [hw, height], [-hw, height],
  ];
  void thickness;
  return extrudeProfile(pts, depth);
}

/** Tube swept along a curve -- used for rails, cables and pipes. */
export function tubeGeo(curve, radius = 0.09, tubularSegments = 64, radialSegments = 6) {
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

export function textureCanvas(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
