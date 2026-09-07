import * as THREE from 'three';
import { makeTagTexture, tagMarkerTexture } from './TagArt.js';
import { PSTATE } from '../player/Player.js';
import { clamp, damp } from '../core/MathUtils.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

// Window bands and shopfronts stand a few centimetres proud of the wall, so
// decals clear them by a little. They write no depth and are skipped by the
// outline pass, which keeps an ink rectangle from appearing around the piece.
const DECAL_OFFSET = 0.09;
const MARKER_OFFSET = 0.12;

const SIZE_RULES = {
  medium: { cans: 1, steps: 3, points: 500 },
  large: { cans: 2, steps: 5, points: 900 },
  xl: { cans: 3, steps: 7, points: 1600 },
};

// Unclaimed walls glow in the neutral yellow the markers have always used.
const NEUTRAL = 0xffd21e;

// Painting over a rival is harder and pays for it: one extra direction in the
// sequence, and most of the wall's value again on top.
const RETAG_STEPS = 1;
const RETAG_BONUS = 0.75;

// A takeover decal sits a hair proud of the piece it is burying, so the old
// crew's outline still shows around the edges.
const RETAG_LIFT = 0.025;

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
 *
 * A wall is territory, not a checkbox: every spot is either unclaimed or owned
 * by a gang, and anybody who is not that gang can paint over it. That is the
 * whole conflict -- the map is never finished, it just changes hands.
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

    // Beacons and markers are tinted by whoever owns the wall, so the caches
    // are keyed by colour and shared across every spot a crew holds.
    this._beacons = new Map();
    this._markers = new Map();
    this._markerTexture = tagMarkerTexture();

    this.beaconMaterialProto = {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
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
        uniform float uStrength;
        varying float vH;
        void main() {
          float fade = pow(1.0 - vH, 2.2);
          float band = 0.6 + 0.4 * sin(vH * 26.0 - uPulse * 3.4);
          gl_FragColor = vec4(uColor, fade * band * 0.34 * uStrength);
        }
      `,
    };

    this.spots = level.tagSpots.map((data) => this._makeSpot(data));
    this.totalCount = this.spots.length;

    // Several players and rivals can be painting different walls at once, so
    // sessions and prompts are keyed by whoever is holding the can.
    this.sessions = new Map();
    this.prompts = new Map();
    this._pulse = 0;
  }

  // ------------------------------------------------------------ materials

  _beaconMaterial(color, strength) {
    const key = `${color}:${strength}`;
    let mat = this._beacons.get(key);
    if (!mat) {
      mat = new THREE.ShaderMaterial({
        ...this.beaconMaterialProto,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uPulse: { value: 0 },
          uStrength: { value: strength },
        },
      });
      this._beacons.set(key, mat);
    }
    return mat;
  }

  _markerMaterial(color) {
    let mat = this._markers.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: this._markerTexture,
        transparent: true,
        depthWrite: false,
        color,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this._markers.set(color, mat);
    }
    return mat;
  }

  _makeSpot(data) {
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(data.width, data.height) * 0.8, Math.min(data.width, data.height) * 0.8),
      this._markerMaterial(NEUTRAL),
    );
    marker.position.copy(data.position).addScaledVector(data.normal, MARKER_OFFSET);
    marker.rotation.y = data.dir;
    marker.renderOrder = 4;
    marker.userData.noCollide = true;
    this.group.add(marker);

    // Vertical light column so spots read from the other side of the district.
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 46, 6, 1, true), this._beaconMaterial(NEUTRAL, 1));
    beacon.position.set(marker.position.x, data.position.y + 23, marker.position.z);
    beacon.renderOrder = 2;
    beacon.userData.noCollide = true;
    beacon.frustumCulled = true;
    this.group.add(beacon);

    const spot = { data, owner: null, marker, beacon, decal: null, pulseOffset: Math.random() * 6.28 };
    this._dress(spot);
    return spot;
  }

  /**
   * Put a spot's marker and beacon into the state its owner implies.
   *
   * An unclaimed wall gets the full yellow column and a spray reticle. A held
   * wall drops the reticle -- it would sit on top of the art -- and keeps a
   * short column in the owner's colour, which is how you spot somebody else's
   * turf from a rooftop and go and take it.
   */
  _dress(spot) {
    const owner = spot.owner;
    const base = spot.data.position.y;
    if (!owner) {
      spot.marker.material = this._markerMaterial(NEUTRAL);
      spot.marker.visible = true;
      spot.beacon.material = this._beaconMaterial(NEUTRAL, 1);
      spot.beacon.scale.y = 1;
      spot.beacon.position.y = base + 23;
    } else {
      spot.marker.visible = false;
      spot.beacon.material = this._beaconMaterial(owner.color, 0.75);
      spot.beacon.scale.y = 0.3;
      spot.beacon.position.y = base + 23 * 0.3;
    }
    spot.beacon.visible = true;
  }

  // ------------------------------------------------------------------ query

  /** How many walls a crew is holding right now. */
  ownedBy(gang) {
    let n = 0;
    for (const spot of this.spots) if (spot.owner === gang) n++;
    return n;
  }

  /** Walls nobody has claimed yet. */
  get unclaimed() {
    let n = 0;
    for (const spot of this.spots) if (!spot.owner) n++;
    return n;
  }

  /**
   * The nearest walls this gang could take, for the HUD's off-screen trackers.
   * Anything the gang already holds is not a target.
   */
  nearestSpots(position, gang, limit = 3) {
    const out = [];
    for (const spot of this.spots) {
      if (spot.owner && spot.owner === gang) continue;
      out.push({ spot, distance: position.distanceTo(spot.data.position) });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, limit);
  }

  /** Closest takeable spot the player is standing in front of. */
  findNearby(player, gang, maxDistance = 4.4) {
    let best = null;
    let bestDist = maxDistance;
    const px = player.position.x;
    const py = player.position.y + 1.0;
    const pz = player.position.z;
    for (const spot of this.spots) {
      if (spot.owner && spot.owner === gang) continue;
      const p = spot.data.position;
      const dist = Math.hypot(p.x - px, p.y - py, p.z - pz);
      if (dist >= bestDist) continue;
      if (this._claimed(spot)) continue;
      // Must be roughly in front of the wall, not behind it.
      const toPlayer = (px - p.x) * spot.data.normal.x + (pz - p.z) * spot.data.normal.z;
      if (toPlayer < -0.2) continue;
      bestDist = dist;
      best = spot;
    }
    return best;
  }

  cansFor(spot) { return SIZE_RULES[spot.data.size].cans; }

  sessionFor(player) { return this.sessions.get(player) || null; }
  promptFor(player) { return this.prompts.get(player) || null; }
  get anySession() { return this.sessions.size > 0; }

  /** True while somebody else is already painting this wall. */
  isClaimed(spot) { return this._claimed(spot); }

  _claimed(spot, exclude = null) {
    for (const [actor, session] of this.sessions) {
      if (actor === exclude) continue;
      if (session.spot === spot) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- minigame

  /**
   * Start painting a wall.
   *
   * `actor` is whoever is holding the can -- a Player for a human, a rival
   * skater for the AI. Both drive the same session; the difference is that an
   * auto session fills itself in on a timer instead of on stick flicks.
   */
  begin(spot, actor, gang, { auto = false, rate = 0.4 } = {}) {
    if (this.sessions.has(actor) || (spot.owner && spot.owner === gang) || this._claimed(spot)) return false;
    const rule = SIZE_RULES[spot.data.size];
    const retag = !!spot.owner;
    const steps = rule.steps + (retag ? RETAG_STEPS : 0);
    const sequence = [];
    for (let i = 0; i < steps; i++) {
      let dir;
      do { dir = DIRECTIONS[Math.floor(Math.random() * 4)]; }
      while (i > 0 && dir === sequence[i - 1]);
      sequence.push(dir);
    }

    const { texture, word, palette } = makeTagTexture({
      seed: (Math.random() * 1e9) | 0,
      word: gang ? gang.words[Math.floor(Math.random() * gang.words.length)] : undefined,
      palette: gang ? gang.palette : undefined,
    });
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
    const lift = DECAL_OFFSET + (retag ? RETAG_LIFT : 0);
    decal.position.copy(spot.data.position).addScaledVector(spot.data.normal, lift);
    decal.rotation.y = spot.data.dir;
    decal.renderOrder = retag ? 4 : 3;
    decal.userData.noCollide = true;
    this.group.add(decal);

    // On a takeover the losing crew's piece stays up until this one is
    // finished, so a half-sprayed wall reads as contested rather than blank.
    const previous = retag ? spot.decal : null;
    spot.decal = decal;
    spot.marker.visible = false;
    spot.beacon.visible = false;

    this.sessions.set(actor, {
      actor, player: actor, gang, spot, sequence, index: 0, rule, word, palette,
      retag, previous, auto, rate,
      progress: 0, targetProgress: 0,
      timeLeft: 1.55, stepTime: 1.55,
      material, decal, failed: false, flash: 0, stickLatch: null,
    });
    if (actor.beginTag) actor.beginTag(spot.data);
    this.events.emit('tag:begin', { spot, word, sequence, player: actor, gang, retag });
    return true;
  }

  cancel(actor, { keepDecal = false } = {}) {
    const s = this.sessions.get(actor);
    if (!s) return;
    this.sessions.delete(actor);
    if (!keepDecal) {
      this._disposeDecal(s.decal);
      // Hand the wall back to whoever held it when the attempt started.
      s.spot.decal = s.previous;
      this._dress(s.spot);
    }
    if (actor.state === PSTATE.TAG && actor.endTag) actor.endTag();
    this.events.emit('tag:cancel', { spot: s.spot, player: actor, gang: s.gang });
  }

  _disposeDecal(decal) {
    if (!decal) return;
    this.group.remove(decal);
    decal.geometry.dispose();
    decal.material.uniforms.uMap.value.dispose();
    decal.material.dispose();
  }

  _complete(actor) {
    const s = this.sessions.get(actor);
    if (!s) return;
    this.sessions.delete(actor);
    const spot = s.spot;
    const stolenFrom = spot.owner;
    spot.owner = s.gang;
    s.material.uniforms.uProgress.value = 1;
    this._disposeDecal(s.previous);
    this._dress(spot);
    if (actor.endTag) actor.endTag();

    const points = Math.round(s.rule.points * (s.retag ? 1 + RETAG_BONUS : 1));
    const pos = spot.data.position.clone().addScaledVector(spot.data.normal, 0.6);
    this.effects.burst(pos, new THREE.Color(s.palette[0]).getHex(), 34, 7);
    const payload = {
      spot, word: s.word, points, player: actor, gang: s.gang,
      retag: s.retag, stolenFrom,
      cans: s.rule.cans, size: spot.data.size, position: pos,
    };
    // Rivals paint the same walls but must not reach the score, the HUD or the
    // can economy, all of which are keyed to a seat at the couch.
    this.events.emit(s.auto ? 'rival:tag' : 'tag:complete', payload);
  }

  /** Edge-detected directional input from keys or the left stick. */
  _readDirection(input, session) {
    for (const dir of DIRECTIONS) {
      if (input.pressed(dir)) return dir;
    }
    const mag = Math.hypot(input.move.x, input.move.y);
    if (mag > 0.65) {
      const dir = Math.abs(input.move.x) > Math.abs(input.move.y)
        ? (input.move.x > 0 ? 'right' : 'left')
        : (input.move.y > 0 ? 'up' : 'down');
      if (session.stickLatch !== dir) {
        session.stickLatch = dir;
        return dir;
      }
    } else if (mag < 0.35) {
      session.stickLatch = null;
    }
    return null;
  }

  update(dt, game) {
    this._pulse += dt;

    // Idle markers breathe so they read from across the street.
    const s = 0.9 + Math.sin(this._pulse * 2.6) * 0.09;
    const alpha = 0.55 + Math.sin(this._pulse * 2.6) * 0.22;
    for (const mat of this._markers.values()) mat.opacity = alpha;
    for (const mat of this._beacons.values()) mat.uniforms.uPulse.value = this._pulse;
    for (const spot of this.spots) {
      if (spot.owner) continue;
      spot.marker.scale.setScalar(s);
    }

    for (const slot of game.slots) {
      this._updateSlot(dt, game, slot);
    }
    this._updateAuto(dt);
  }

  /**
   * Rival sessions fill themselves in.
   *
   * They run the same session, decal and completion path a player does, so a
   * rival's wall is indistinguishable from one you lost fairly -- it just
   * advances on a clock instead of on stick flicks.
   */
  _updateAuto(dt) {
    for (const session of [...this.sessions.values()]) {
      if (!session.auto) continue;
      session.targetProgress = Math.min(1, session.targetProgress + session.rate * dt);
      session.progress = damp(session.progress, session.targetProgress, 12, dt);
      session.material.uniforms.uProgress.value = clamp(session.progress, 0, 1);
      // No tag:step here: that event drives the player's spray UI and the
      // spray sound, neither of which belongs to a rival across the city.
      session.index = Math.floor(session.targetProgress * session.sequence.length);
      if (session.targetProgress >= 1) this._complete(session.actor);
    }
  }

  _updateSlot(dt, game, slot) {
    const { player, input, score } = slot;

    if (this.sessions.has(player)) {
      this._updateSession(dt, game, slot);
      this.prompts.delete(player);
      return;
    }

    // Not tagging: surface a prompt when the player is in front of a wall.
    const near = this.findNearby(player, slot.gang);
    if (near && !player.isLocked) {
      const cans = this.cansFor(near);
      const prompt = {
        spot: near, cans, retag: !!near.owner, stolenFrom: near.owner,
        enough: score ? score.cans >= cans : true,
      };
      this.prompts.set(player, prompt);
      if (input.pressed('spray') && prompt.enough && player.grounded) {
        this.begin(near, player, slot.gang);
      }
    } else {
      this.prompts.delete(player);
    }
  }

  _updateSession(dt, game, slot) {
    const { player, input } = slot;
    const s = this.sessions.get(player);
    s.flash = Math.max(0, s.flash - dt * 4);

    if (player.state !== PSTATE.TAG) { this.cancel(player); return; }
    if (input.pressed('jump')) { this.cancel(player); return; }

    s.timeLeft -= dt;
    const dir = this._readDirection(input, s);
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
        this.events.emit('tag:step', { index: s.index, total: s.sequence.length, player });
        if (s.index >= s.sequence.length) { this._complete(player); return; }
      } else {
        s.timeLeft -= 0.35;
        s.flash = -1;
        slot.followCamera.addShake(0.25);
        this.events.emit('tag:miss', { player });
      }
    }

    s.progress = damp(s.progress, s.targetProgress, 12, dt);
    s.material.uniforms.uProgress.value = clamp(s.progress, 0, 1);

    if (s.timeLeft <= 0) {
      this.events.emit('tag:fail', { spot: s.spot, player });
      this.cancel(player);
    }
  }

  /** Strip every decal and hand the whole map back to nobody. */
  reset() {
    for (const session of this.sessions.values()) {
      this.group.remove(session.decal);
      if (session.previous === session.spot.decal) session.spot.decal = session.previous;
    }
    this.sessions.clear();
    this.prompts.clear();
    for (const spot of this.spots) {
      this._disposeDecal(spot.decal);
      spot.decal = null;
      spot.owner = null;
      this._dress(spot);
    }
  }

  /** Walls still up for grabs -- the old "how many left to paint" number. */
  get remaining() { return this.unclaimed; }
}
