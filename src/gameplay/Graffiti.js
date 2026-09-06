import * as THREE from 'three';
import { makeTagTexture, tagMarkerTexture } from './TagArt.js';
import { PSTATE } from '../player/Player.js';
import { clamp, damp } from '../core/MathUtils.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

// Building faces carry window bands and shopfronts that stand ~0.12m proud, so
// decals sit further out than that to avoid being swallowed by them.
const DECAL_OFFSET = 0.3;
const MARKER_OFFSET = 0.34;

const SIZE_RULES = {
  medium: { cans: 1, steps: 3, points: 500 },
  large: { cans: 2, steps: 5, points: 900 },
  xl: { cans: 3, steps: 7, points: 1600 },
};

const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uProgress;
uniform vec3 uWet;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.02) discard;

  // Spray-on reveal: noisy threshold sweeping bottom-left to top-right.
  float n = noise(vUv * 5.0) * 0.45 + (1.0 - vUv.y) * 0.3 + vUv.x * 0.2;
  float p = uProgress * 1.3 - 0.14;
  float rev = smoothstep(n - 0.07, n + 0.07, p);
  if (rev < 0.02) discard;

  // Wet paint highlight riding the reveal edge.
  float edge = rev * (1.0 - rev) * 4.0;
  vec3 color = mix(tex.rgb, uWet, edge * 0.5);

  gl_FragColor = vec4(color, tex.a * rev);
  #include <colorspace_fragment>
}
`;

/**
 * Tag spots, the spray minigame and the decals it leaves behind.
 */
export class Graffiti {
  constructor(scene, level, events, effects) {
    this.scene = scene;
    this.level = level;
    this.events = events;
    this.effects = effects;

    this.group = new THREE.Group();
    this.group.name = 'graffiti';
    this.group.userData.noCollide = true;
    scene.add(this.group);

    this.beaconMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0xffd21e) }, uPulse: { value: 0 } },
      vertexShader: `
        varying float vH;
        void main() {
          vH = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uPulse;
        varying float vH;
        void main() {
          float fade = pow(1.0 - vH, 2.2);
          float band = 0.6 + 0.4 * sin(vH * 26.0 - uPulse * 3.4);
          gl_FragColor = vec4(uColor, fade * band * 0.34);
        }
      `,
    });

    this.markerMaterial = new THREE.MeshBasicMaterial({
      map: tagMarkerTexture(),
      transparent: true,
      depthWrite: false,
      color: 0xffd21e,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    this.spots = level.tagSpots.map((data) => this._makeSpot(data));
    this.taggedCount = 0;
    this.totalCount = this.spots.length;

    this.session = null;
    this.prompt = null;
    this._stickLatch = null;
    this._pulse = 0;
  }

  _makeSpot(data) {
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(data.width, data.height) * 0.8, Math.min(data.width, data.height) * 0.8),
      this.markerMaterial,
    );
    marker.position.copy(data.position).addScaledVector(data.normal, MARKER_OFFSET);
    marker.rotation.y = data.dir;
    marker.renderOrder = 4;
    marker.userData.noCollide = true;
    this.group.add(marker);

    // Vertical light column so spots read from the other side of the district.
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 46, 6, 1, true), this.beaconMaterial);
    beacon.position.set(marker.position.x, data.position.y + 23, marker.position.z);
    beacon.renderOrder = 2;
    beacon.userData.noCollide = true;
    beacon.frustumCulled = true;
    this.group.add(beacon);

    return { data, marker, beacon, tagged: false, decal: null, pulseOffset: Math.random() * 6.28 };
  }

  // ------------------------------------------------------------------ query

  /** The nearest un-tagged spots, for the HUD's off-screen trackers. */
  nearestSpots(position, limit = 3) {
    const out = [];
    for (const spot of this.spots) {
      if (spot.tagged) continue;
      out.push({ spot, distance: position.distanceTo(spot.data.position) });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, limit);
  }

  /** Closest un-tagged spot the player is standing in front of. */
  findNearby(player, maxDistance = 4.4) {
    let best = null;
    let bestDist = maxDistance;
    const px = player.position.x;
    const py = player.position.y + 1.0;
    const pz = player.position.z;
    for (const spot of this.spots) {
      if (spot.tagged) continue;
      const p = spot.data.position;
      const dist = Math.hypot(p.x - px, p.y - py, p.z - pz);
      if (dist >= bestDist) continue;
      // Must be roughly in front of the wall, not behind it.
      const toPlayer = (px - p.x) * spot.data.normal.x + (pz - p.z) * spot.data.normal.z;
      if (toPlayer < -0.2) continue;
      bestDist = dist;
      best = spot;
    }
    return best;
  }

  cansFor(spot) { return SIZE_RULES[spot.data.size].cans; }

  // ------------------------------------------------------------- minigame

  begin(spot, player) {
    if (this.session || spot.tagged) return false;
    const rule = SIZE_RULES[spot.data.size];
    const sequence = [];
    for (let i = 0; i < rule.steps; i++) {
      let dir;
      do { dir = DIRECTIONS[Math.floor(Math.random() * 4)]; }
      while (i > 0 && dir === sequence[i - 1]);
      sequence.push(dir);
    }

    const { texture, word, palette } = makeTagTexture({ seed: (Math.random() * 1e9) | 0 });
    const material = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: texture },
        uProgress: { value: 0 },
        uWet: { value: new THREE.Color(0xffffff) },
      },
    });

    const geo = new THREE.PlaneGeometry(spot.data.width, spot.data.height);
    const decal = new THREE.Mesh(geo, material);
    decal.position.copy(spot.data.position).addScaledVector(spot.data.normal, DECAL_OFFSET);
    decal.rotation.y = spot.data.dir;
    decal.renderOrder = 3;
    decal.userData.noCollide = true;
    this.group.add(decal);

    spot.decal = decal;
    spot.marker.visible = false;
    spot.beacon.visible = false;

    this.session = {
      spot, sequence, index: 0, rule, word, palette,
      progress: 0, targetProgress: 0,
      timeLeft: 1.55, stepTime: 1.55,
      material, decal, failed: false, flash: 0,
    };
    this._stickLatch = null;
    player.beginTag(spot.data);
    this.events.emit('tag:begin', { spot, word, sequence });
    return true;
  }

  cancel(player, { keepDecal = false } = {}) {
    const s = this.session;
    if (!s) return;
    if (!keepDecal) {
      this.group.remove(s.decal);
      s.decal.geometry.dispose();
      s.material.uniforms.uMap.value.dispose();
      s.material.dispose();
      s.spot.decal = null;
      s.spot.marker.visible = true;
      s.spot.beacon.visible = true;
    }
    this.session = null;
    if (player.state === PSTATE.TAG) player.endTag();
    this.events.emit('tag:cancel', { spot: s.spot });
  }

  _complete(player) {
    const s = this.session;
    const spot = s.spot;
    spot.tagged = true;
    spot.marker.visible = false;
    spot.beacon.visible = false;
    s.material.uniforms.uProgress.value = 1;
    this.taggedCount++;
    this.session = null;
    player.endTag();

    const pos = spot.data.position.clone().addScaledVector(spot.data.normal, 0.6);
    this.effects.burst(pos, new THREE.Color(s.palette[0]).getHex(), 34, 7);
    this.events.emit('tag:complete', {
      spot, word: s.word, points: s.rule.points,
      cans: s.rule.cans, size: spot.data.size, position: pos,
    });
  }

  /** Edge-detected directional input from keys or the left stick. */
  _readDirection(input) {
    for (const dir of DIRECTIONS) {
      if (input.pressed(dir)) return dir;
    }
    const mag = Math.hypot(input.move.x, input.move.y);
    if (mag > 0.65) {
      const dir = Math.abs(input.move.x) > Math.abs(input.move.y)
        ? (input.move.x > 0 ? 'right' : 'left')
        : (input.move.y > 0 ? 'up' : 'down');
      if (this._stickLatch !== dir) {
        this._stickLatch = dir;
        return dir;
      }
    } else if (mag < 0.35) {
      this._stickLatch = null;
    }
    return null;
  }

  update(dt, game) {
    const player = game.player;
    const input = game.input;
    this._pulse += dt;

    // Idle markers breathe so they read from across the street.
    const s = 0.9 + Math.sin(this._pulse * 2.6) * 0.09;
    this.markerMaterial.opacity = 0.55 + Math.sin(this._pulse * 2.6) * 0.22;
    this.beaconMaterial.uniforms.uPulse.value = this._pulse;
    for (const spot of this.spots) {
      if (spot.tagged) continue;
      spot.marker.scale.setScalar(s);
    }

    if (this.session) {
      this._updateSession(dt, game, player, input);
      this.prompt = null;
      return;
    }

    // Not tagging: surface a prompt when the player is in front of a wall.
    const near = this.findNearby(player);
    if (near && !player.isLocked) {
      const cans = this.cansFor(near);
      this.prompt = { spot: near, cans, enough: game.score ? game.score.cans >= cans : true };
      if (input.pressed('spray') && this.prompt.enough && player.grounded) {
        this.begin(near, player);
      }
    } else {
      this.prompt = null;
    }
  }

  _updateSession(dt, game, player, input) {
    const s = this.session;
    s.flash = Math.max(0, s.flash - dt * 4);

    if (player.state !== PSTATE.TAG) { this.cancel(player); return; }
    if (input.pressed('jump')) { this.cancel(player); return; }

    s.timeLeft -= dt;
    const dir = this._readDirection(input);
    if (dir) {
      if (dir === s.sequence[s.index]) {
        s.index++;
        s.targetProgress = s.index / s.sequence.length;
        s.timeLeft = s.stepTime;
        s.flash = 1;
        const p = s.spot.data.position.clone()
          .addScaledVector(s.spot.data.normal, 0.35)
          .add(new THREE.Vector3(0, (Math.random() - 0.5) * s.spot.data.height * 0.6, 0));
        this.effects.spray(p, s.spot.data.normal, new THREE.Color(s.palette[0]).getHex(), 8);
        this.events.emit('tag:step', { index: s.index, total: s.sequence.length });
        if (s.index >= s.sequence.length) { this._complete(player); return; }
      } else {
        s.timeLeft -= 0.35;
        s.flash = -1;
        game.followCamera.addShake(0.25);
        this.events.emit('tag:miss', {});
      }
    }

    s.progress = damp(s.progress, s.targetProgress, 12, dt);
    s.material.uniforms.uProgress.value = clamp(s.progress, 0, 1);

    if (s.timeLeft <= 0) {
      this.events.emit('tag:fail', { spot: s.spot });
      this.cancel(player);
    }
  }

  /** Strip every decal and put the markers back. */
  reset() {
    if (this.session) {
      this.group.remove(this.session.decal);
      this.session = null;
    }
    for (const spot of this.spots) {
      if (spot.decal) {
        this.group.remove(spot.decal);
        spot.decal.geometry.dispose();
        spot.decal.material.uniforms.uMap.value.dispose();
        spot.decal.material.dispose();
        spot.decal = null;
      }
      spot.tagged = false;
      spot.marker.visible = true;
      spot.beacon.visible = true;
    }
    this.taggedCount = 0;
    this.prompt = null;
  }

  get remaining() { return this.totalCount - this.taggedCount; }
}
