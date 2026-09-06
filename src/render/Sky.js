import * as THREE from 'three';
import { SKY } from './Palette.js';

const VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(world.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vWorldDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float h = dir.y;

  vec3 sky = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
  sky = mix(uGround, sky, smoothstep(-0.16, 0.01, h));

  // Sun disc plus a wide warm halo.
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  sky += uSunColor * pow(sd, 320.0) * 1.6;
  sky += uSunColor * pow(sd, 8.0) * 0.22;

  // Flat, banded clouds -- posterised to match the cel look.
  if (h > 0.02) {
    vec2 uv = dir.xz / max(h, 0.08);
    float c = fbm(uv * 0.6 + vec2(uTime * 0.012, uTime * 0.005));
    c = smoothstep(0.52, 0.72, c);
    c = floor(c * 3.0) / 3.0;
    float fade = smoothstep(0.02, 0.3, h);
    sky = mix(sky, mix(vec3(1.0), uSunColor, 0.28), c * fade * 0.85);
  }

  gl_FragColor = vec4(sky, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(SKY.top) },
        uHorizon: { value: new THREE.Color(SKY.horizon) },
        uGround: { value: new THREE.Color(SKY.ground) },
        uSunColor: { value: new THREE.Color(SKY.sun) },
        uSunDir: { value: new THREE.Vector3(0.45, 0.5, -0.75).normalize() },
        uTime: { value: 0 },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  tick(dt) {
    this.material.uniforms.uTime.value += dt;
  }

  /** Centre the dome on whichever camera is about to render. */
  place(camera) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
  }

  setSunDirection(v) {
    this.material.uniforms.uSunDir.value.copy(v).normalize();
  }
}
