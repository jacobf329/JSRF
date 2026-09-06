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
uniform float uTime;

// Split-screen: each view supplies its own rect (in UV space) plus the
// intensities of the effects that are tied to a single skater.
uniform int uViewCount;
uniform vec4 uViewRect[4];
uniform float uViewBoost[4];
uniform float uViewDamage[4];

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
  // Work out which player's pane this pixel belongs to.
  vec4 rect = vec4(0.0, 0.0, 1.0, 1.0);
  float boost = 0.0;
  float damage = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uViewCount) break;
    vec4 r = uViewRect[i];
    if (vUv.x >= r.x && vUv.x <= r.x + r.z && vUv.y >= r.y && vUv.y <= r.y + r.w) {
      rect = r;
      boost = uViewBoost[i];
      damage = uViewDamage[i];
      break;
    }
  }
  vec2 viewCentre = rect.xy + rect.zw * 0.5;
  vec2 viewUv = (vUv - rect.xy) / rect.zw;

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

  // Radial smear while boosting, kept inside this player's pane.
  if (boost > 0.001) {
    vec2 dir = vUv - viewCentre;
    vec3 smear = vec3(0.0);
    for (int i = 1; i <= 5; i++) {
      float t = float(i) / 5.0;
      vec2 uv = clamp(vUv - dir * t * 0.09 * boost, rect.xy + uTexel, rect.xy + rect.zw - uTexel);
      smear += texture2D(tColor, uv).rgb;
    }
    smear /= 5.0;
    float mask = smoothstep(0.12, 0.62, length((vUv - viewCentre) / rect.zw) * 2.0 * 0.5);
    color = mix(color, smear, mask * boost * 0.85);
  }

  color = mix(color, uOutlineColor, edge);

  // Poster grade: push saturation and contrast for the flat street-art look.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);
  color = (color - 0.5) * uContrast + 0.5;

  if (damage > 0.001) {
    float pulse = 0.5 + 0.5 * sin(uTime * 18.0);
    float ring = smoothstep(0.25, 0.85, length(viewUv - vec2(0.5)));
    color = mix(color, vec3(0.95, 0.12, 0.18), ring * damage * (0.45 + 0.35 * pulse));
  }

  float vig = 1.0 - uVignette * pow(length(viewUv - vec2(0.5)) * 1.32, 2.4);
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
        uTime: { value: 0 },
        uViewCount: { value: 1 },
        uViewRect: { value: [
          new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, 1),
          new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(0, 0, 1, 1),
        ] },
        uViewBoost: { value: [0, 0, 0, 0] },
        uViewDamage: { value: [0, 0, 0, 0] },
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

  /**
   * Tell the composite pass where each player's pane is. `rects` are CSS
   * pixels with a top-left origin; they are converted to bottom-left UVs.
   */
  setViewRects(rects) {
    const u = this.compositeMaterial.uniforms;
    u.uViewCount.value = Math.min(4, rects.length);
    for (let i = 0; i < 4; i++) {
      const r = rects[Math.min(i, rects.length - 1)];
      const v = u.uViewRect.value[i];
      if (!r) { v.set(0, 0, 1, 1); continue; }
      v.set(
        r.x / this.width,
        (this.height - (r.y + r.height)) / this.height,
        r.width / this.width,
        r.height / this.height,
      );
    }
  }

  /** Per-player effect intensities for the composite pass. */
  setViewEffect(index, boost, damage) {
    if (index < 0 || index > 3) return;
    const u = this.compositeMaterial.uniforms;
    u.uViewBoost.value[index] = boost;
    u.uViewDamage.value[index] = damage;
  }

  /**
   * Bind `target` and restrict drawing to `rect` (CSS pixels, top-left origin);
   * pass a null rect for the whole buffer.
   *
   * The viewport has to live on the render target itself, not just on the
   * renderer: the shadow pass swaps render targets mid-`render()` and restores
   * the viewport and scissor from the target it comes back to. Setting only
   * `renderer.setViewport()` would be silently undone before a single scene
   * triangle is drawn, and every view would end up full-screen.
   */
  _applyRect(rect, target) {
    const dpr = this.renderer.getPixelRatio();

    if (target) {
      let x = 0;
      let y = 0;
      let w = target.width;
      let h = target.height;
      if (rect) {
        x = Math.round(rect.x * dpr);
        y = Math.round((this.height - (rect.y + rect.height)) * dpr);
        w = Math.round(rect.width * dpr);
        h = Math.round(rect.height * dpr);
      }
      target.viewport.set(x, y, w, h);
      target.scissor.set(x, y, w, h);
      target.scissorTest = !!rect;
      this.renderer.setRenderTarget(target);
      return;
    }

    this.renderer.setRenderTarget(null);
    if (rect) {
      const y = this.height - (rect.y + rect.height);
      this.renderer.setViewport(rect.x, y, rect.width, rect.height);
      this.renderer.setScissor(rect.x, y, rect.width, rect.height);
      this.renderer.setScissorTest(true);
    } else {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.width, this.height);
    }
  }

  /**
   * Render one or more views.
   *
   * `views` is `[{ camera, rect }]`; a single full-screen view can omit `rect`.
   * All views share the colour/normal/depth buffers and are composited in one
   * final pass, so split-screen costs an extra scene draw rather than an extra
   * post chain.
   */
  render(scene, views, options = {}) {
    const list = Array.isArray(views) ? views : [{ camera: views }];
    if (!list.length) return;
    const { hideDuringNormalPass = [], time = 0, beforeView = null } = options;

    // Stats are read after every pass, so they have to survive them.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();

    const u = this.compositeMaterial.uniforms;
    u.uNear.value = list[0].camera.near;
    u.uFar.value = list[0].camera.far;
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

      this._applyRect(null, this.normalTarget);
      this.renderer.setClearColor(0x8080ff, 1);
      this.renderer.clear(true, true, false);
      for (const view of list) {
        if (beforeView) beforeView(view);
        this._applyRect(view.rect, this.normalTarget);
        this.renderer.render(scene, view.camera);
      }

      scene.overrideMaterial = prevOverride;
      scene.background = prevBackground;
      for (const [obj, vis] of restore) obj.visible = vis;
    }

    this._applyRect(null, this.colorTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, false);
    for (const view of list) {
      if (beforeView) beforeView(view);
      this._applyRect(view.rect, this.colorTarget);
      this.renderer.render(scene, view.camera);
    }

    // Snapshot scene stats before the composite pass overwrites them.
    this.stats = {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      programs: this.renderer.info.programs ? this.renderer.info.programs.length : 0,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };

    this._applyRect(null, null);
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
