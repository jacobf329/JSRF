import * as THREE from 'three';

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
#include <packing>

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uOutlineWidth;
uniform float uOutlineStrength;
uniform vec3 uOutlineColor;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uBoost;
uniform float uDamage;
uniform float uTime;

varying vec2 vUv;

float readDepth(vec2 uv) {
  float fragZ = texture2D(tDepth, uv).x;
  float viewZ = perspectiveDepthToViewZ(fragZ, uNear, uFar);
  return viewZToOrthographicDepth(viewZ, uNear, uFar);
}

vec3 readNormal(vec2 uv) {
  return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
}

void main() {
  vec2 o = uTexel * uOutlineWidth;

  // Roberts cross on both linear depth and view-space normals.
  float d0 = readDepth(vUv);
  float da = readDepth(vUv + vec2( o.x,  o.y));
  float db = readDepth(vUv + vec2(-o.x, -o.y));
  float dc = readDepth(vUv + vec2( o.x, -o.y));
  float dd = readDepth(vUv + vec2(-o.x,  o.y));

  float depthDiff = length(vec2(da - db, dc - dd)) / max(d0, 1e-4);

  vec3 na = readNormal(vUv + vec2( o.x,  o.y));
  vec3 nb = readNormal(vUv + vec2(-o.x, -o.y));
  vec3 nc = readNormal(vUv + vec2( o.x, -o.y));
  vec3 nd = readNormal(vUv + vec2(-o.x,  o.y));
  float normalDiff = length(na - nb) + length(nc - nd);

  float depthEdge = smoothstep(uDepthThreshold, uDepthThreshold * 2.2, depthDiff);
  float normalEdge = smoothstep(uNormalThreshold, uNormalThreshold * 1.9, normalDiff);
  // Fade the normal-based edges out with distance; they get noisy far away.
  normalEdge *= 1.0 - smoothstep(0.18, 0.55, d0);
  float edge = max(depthEdge, normalEdge) * uOutlineStrength;

  vec3 color = texture2D(tColor, vUv).rgb;

  // Radial smear while boosting.
  if (uBoost > 0.001) {
    vec2 dir = vUv - vec2(0.5);
    vec3 smear = vec3(0.0);
    for (int i = 1; i <= 5; i++) {
      float t = float(i) / 5.0;
      smear += texture2D(tColor, vUv - dir * t * 0.09 * uBoost).rgb;
    }
    smear /= 5.0;
    float mask = smoothstep(0.12, 0.62, length(dir));
    color = mix(color, smear, mask * uBoost * 0.85);
  }

  color = mix(color, uOutlineColor, edge);

  // Poster grade: push saturation and contrast for the flat street-art look.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);
  color = (color - 0.5) * uContrast + 0.5;

  if (uDamage > 0.001) {
    float pulse = 0.5 + 0.5 * sin(uTime * 18.0);
    float ring = smoothstep(0.25, 0.85, length(vUv - vec2(0.5)));
    color = mix(color, vec3(0.95, 0.12, 0.18), ring * uDamage * (0.45 + 0.35 * pulse));
  }

  float vig = 1.0 - uVignette * pow(length(vUv - vec2(0.5)) * 1.32, 2.4);
  color *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(max(color, 0.0), 1.0);

  #include <colorspace_fragment>
}
`;

/**
 * Two-pass cel renderer.
 *
 * Pass 1 renders view-space normals, pass 2 renders the lit scene with a depth
 * texture attached, and the composite draws ink outlines wherever depth or
 * normals break. Cheaper and more uniform than inverted-hull outlines on every
 * mesh, and it outlines interior creases too.
 */
export class CelRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 1);

    this.maxPixelRatio = 2;
    this.renderScale = 1;

    const samples = this.renderer.capabilities.isWebGL2 ? 4 : 0;

    this.colorTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      samples,
    });
    this.colorTarget.depthTexture = new THREE.DepthTexture(1, 1);
    this.colorTarget.depthTexture.type = THREE.UnsignedIntType;
    this.colorTarget.depthTexture.minFilter = THREE.NearestFilter;
    this.colorTarget.depthTexture.magFilter = THREE.NearestFilter;

    this.normalTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      samples: 0,
    });

    this.normalMaterial = new THREE.MeshNormalMaterial();

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.colorTarget.texture },
        tDepth: { value: this.colorTarget.depthTexture },
        tNormal: { value: this.normalTarget.texture },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uOutlineWidth: { value: 1.35 },
        uOutlineStrength: { value: 0.92 },
        uOutlineColor: { value: new THREE.Color(0x151726) },
        uDepthThreshold: { value: 0.012 },
        uNormalThreshold: { value: 0.42 },
        uSaturation: { value: 1.22 },
        uContrast: { value: 1.06 },
        uVignette: { value: 0.34 },
        uBoost: { value: 0 },
        uDamage: { value: 0 },
        uTime: { value: 0 },
      },
    });

    this.quadScene = new THREE.Scene();
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(quadGeo, this.compositeMaterial);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.width = 1;
    this.height = 1;
    this.stats = { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 };
    this.outlinesEnabled = true;
  }

  get domElement() { return this.renderer.domElement; }

  setPixelRatioCap(cap) {
    this.maxPixelRatio = cap;
    this.setSize(this.width, this.height);
  }

  setSize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);

    const bw = Math.max(1, Math.floor(this.width * dpr));
    const bh = Math.max(1, Math.floor(this.height * dpr));
    this.colorTarget.setSize(bw, bh);
    this.normalTarget.setSize(bw, bh);
    this.compositeMaterial.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    // Keep the ink line roughly one screen pixel regardless of DPI.
    this.compositeMaterial.uniforms.uOutlineWidth.value = 1.15 * Math.max(1, dpr * 0.85);
  }

  setEffect(name, value) {
    const u = this.compositeMaterial.uniforms[name];
    if (u) u.value = value;
  }

  render(scene, camera, options = {}) {
    const { hideDuringNormalPass = [], time = 0 } = options;

    const u = this.compositeMaterial.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uTime.value = time;

    if (this.outlinesEnabled) {
      const restore = [];
      for (const obj of hideDuringNormalPass) {
        if (!obj) continue;
        restore.push([obj, obj.visible]);
        obj.visible = false;
      }
      const prevOverride = scene.overrideMaterial;
      const prevBackground = scene.background;
      scene.overrideMaterial = this.normalMaterial;
      scene.background = null;
      this.renderer.setRenderTarget(this.normalTarget);
      this.renderer.setClearColor(0x8080ff, 1);
      this.renderer.clear(true, true, false);
      this.renderer.render(scene, camera);
      scene.overrideMaterial = prevOverride;
      scene.background = prevBackground;
      for (const [obj, vis] of restore) obj.visible = vis;
    }

    this.renderer.setRenderTarget(this.colorTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);

    // Snapshot scene stats before the composite pass overwrites them.
    this.stats = {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      programs: this.renderer.info.programs ? this.renderer.info.programs.length : 0,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.colorTarget.dispose();
    this.normalTarget.dispose();
    this.compositeMaterial.dispose();
    this.quadMesh.geometry.dispose();
    this.normalMaterial.dispose();
    this.renderer.dispose();
  }
}
