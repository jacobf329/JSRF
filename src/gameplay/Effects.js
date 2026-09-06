import * as THREE from 'three';

const MAX = 1600;

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(-mv.z, 0.001));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = dot(d, d);
  if (r > 0.25) discard;
  // Hard-edged puck with a lighter core -- matches the flat cel look.
  float core = step(r, 0.09);
  vec3 c = mix(vColor, mix(vColor, vec3(1.0), 0.55), core);
  gl_FragColor = vec4(c, vAlpha);
  #include <colorspace_fragment>
}
`;

const _v = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Pooled CPU particle system rendered as a single Points draw call.
 * Everything that sparks, sprays, puffs or pops goes through here.
 */
export class Effects {
  constructor(scene) {
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.sizes = new Float32Array(MAX);
    this.alphas = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.gravity = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.shrink = new Float32Array(MAX);
    this.active = new Uint8Array(MAX);
    this.cursor = 0;
    this.count = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setDrawRange(0, MAX);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.userData.noCollide = true;
    this.geometry = geo;
    scene.add(this.points);

    // Start every particle fully transparent.
    this.alphas.fill(0);
  }

  _alloc() {
    for (let i = 0; i < MAX; i++) {
      const idx = (this.cursor + i) % MAX;
      if (!this.active[idx]) {
        this.cursor = (idx + 1) % MAX;
        this.active[idx] = 1;
        this.count++;
        return idx;
      }
    }
    // Everything is busy -- recycle the oldest slot.
    const idx = this.cursor;
    this.cursor = (idx + 1) % MAX;
    return idx;
  }

  emit({
    position, velocity = null, spread = 0, color = 0xffffff, size = 0.4,
    life = 0.6, gravity = 0, drag = 1.4, shrink = 1, count = 1, speed = 0,
  }) {
    _color.set(color);
    for (let n = 0; n < count; n++) {
      const i = this._alloc();
      const p3 = i * 3;
      this.positions[p3] = position.x + (Math.random() - 0.5) * spread;
      this.positions[p3 + 1] = position.y + (Math.random() - 0.5) * spread;
      this.positions[p3 + 2] = position.z + (Math.random() - 0.5) * spread;

      if (velocity) {
        this.vel[p3] = velocity.x;
        this.vel[p3 + 1] = velocity.y;
        this.vel[p3 + 2] = velocity.z;
      } else {
        this.vel[p3] = 0; this.vel[p3 + 1] = 0; this.vel[p3 + 2] = 0;
      }
      if (speed > 0) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const s = speed * (0.4 + Math.random() * 0.6);
        this.vel[p3] += Math.sin(phi) * Math.cos(theta) * s;
        this.vel[p3 + 1] += Math.cos(phi) * s;
        this.vel[p3 + 2] += Math.sin(phi) * Math.sin(theta) * s;
      }

      const jitter = 0.75 + Math.random() * 0.5;
      this.colors[p3] = _color.r;
      this.colors[p3 + 1] = _color.g;
      this.colors[p3 + 2] = _color.b;
      this.baseSize[i] = size * jitter;
      this.sizes[i] = this.baseSize[i];
      this.alphas[i] = 1;
      this.life[i] = life * (0.7 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i];
      this.gravity[i] = gravity;
      this.drag[i] = drag;
      this.shrink[i] = shrink;
    }
  }

  update(dt) {
    const pos = this.positions;
    const vel = this.vel;
    for (let i = 0; i < MAX; i++) {
      if (!this.active[i]) continue;
      const l = (this.life[i] -= dt);
      if (l <= 0) {
        this.active[i] = 0;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this.count--;
        continue;
      }
      const p3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      vel[p3] *= d;
      vel[p3 + 2] *= d;
      vel[p3 + 1] = vel[p3 + 1] * d - this.gravity[i] * dt;
      pos[p3] += vel[p3] * dt;
      pos[p3 + 1] += vel[p3 + 1] * dt;
      pos[p3 + 2] += vel[p3 + 2] * dt;

      const t = l / this.maxLife[i];
      this.alphas[i] = Math.min(1, t * 2.2);
      this.sizes[i] = this.baseSize[i] * (this.shrink[i] ? t * 0.7 + 0.3 : 1);
    }

    const attrs = this.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aColor.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
  }

  // ------------------------------------------------------------ presets

  sparks(position, direction, color = 0xffd21e, count = 6) {
    _v.copy(direction).multiplyScalar(-2.2);
    this.emit({
      position, velocity: _v, spread: 0.24, color, size: 0.16,
      life: 0.34, gravity: 9, drag: 1.2, speed: 3.4, count,
    });
  }

  dust(position, count = 8, color = 0xd8d4c6) {
    this.emit({
      position, spread: 0.7, color, size: 0.5, life: 0.55,
      gravity: -1.4, drag: 3.2, speed: 2.2, count,
    });
  }

  boostTrail(position, color = 0x24d6ff) {
    this.emit({
      position, spread: 0.5, color, size: 0.55, life: 0.42,
      gravity: -2.2, drag: 2.6, speed: 0.8, count: 2,
    });
  }

  spray(position, normal, color = 0xff2f87, count = 5) {
    _v.copy(normal).multiplyScalar(1.6);
    this.emit({
      position, velocity: _v, spread: 0.4, color, size: 0.22,
      life: 0.5, gravity: 2.5, drag: 2.2, speed: 1.4, count,
    });
  }

  burst(position, color = 0xa8ff3e, count = 24, speed = 6) {
    this.emit({
      position, spread: 0.3, color, size: 0.34, life: 0.7,
      gravity: 7, drag: 1.1, speed, count,
    });
  }

  impact(position, color = 0xff4d2e, count = 16) {
    this.emit({
      position, spread: 0.4, color, size: 0.4, life: 0.55,
      gravity: 10, drag: 1.0, speed: 7, count,
    });
  }
}
