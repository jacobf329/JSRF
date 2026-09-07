import * as THREE from 'three';
import { PALETTE } from '../render/Palette.js';
import { toon, flat, glass } from '../render/Materials.js';
import { Builder } from './Builder.js';
import { CollisionWorld, SURFACE } from './Collision.js';
import { RailNetwork, Rail, RAIL_TYPE } from './Rail.js';
import { BUILDINGS, CAN_SPOTS, DISTRICTS, LEVEL, POLICE_POSTS, TAG_SPOTS, districtAt } from './LevelData.js';
import {
  bankGeo, boxGeo, cylGeo, pillarGeo, quarterPipeGeo, sphereGeo,
  stairsGeo, textureCanvas, tubeGeo, wedgeGeo,
} from './Geo.js';
import { makeRng } from '../core/MathUtils.js';

const HALF = LEVEL.bounds;

/** Wall panel sizes a tag can be painted at. */
const TAG_SIZES = {
  medium: { w: 6, h: 4.4 },
  large: { w: 6.5, h: 4.8 },
  xl: { w: 8, h: 6 },
};
const BOWL = LEVEL.bowl;
const EXPRESSWAY_X = -110;
const EXPRESSWAY_Y = 14;

/**
 * Builds the playable district: geometry, collision, grind rails and the
 * gameplay anchor points (tag walls, pickups, patrol posts).
 */
export class Level {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'level';
    this.props = new THREE.Group();
    this.props.name = 'props';
    this.group.add(this.props);

    this.collision = new CollisionWorld(8);
    this.rails = new RailNetwork(7);
    this.tagSpots = [];
    this.canSpots = [];
    this.policePosts = [];
    this.bounds = LEVEL.bounds;
    this.spawn = new THREE.Vector3(LEVEL.spawn.x, LEVEL.spawn.y, LEVEL.spawn.z);
    this.spawnHeading = LEVEL.spawn.heading;
    this.name = LEVEL.name;

    this.b = new Builder();
    this.rng = makeRng(0x5f3759df);
  }

  build() {
    this.b.setChunk('ground');
    this._ground();
    this.b.setChunk('terminal');
    this._bowl();
    this._buildings();
    this._expressway();
    this._skatepark();
    this._stairsAndLedges();
    this._streetDressing();
    this.b.setChunk('heights');
    this._heights();
    this.b.setChunk('hill');
    this._hill();
    this.b.setChunk('drain');
    this._drain();
    this.b.setChunk('bantam');
    this._bantam();
    this._railNetwork();

    const baked = this.b.finish('district', this.collision);
    this.group.add(baked);
    this.collision.build();

    this._tagSpots();
    this._pickupSpots();
    this._policePosts();
    this._lights();

    return this;
  }

  // ------------------------------------------------------------------ ground

  _ground() {
    const road = toon(PALETTE.asphalt);
    const walk = toon(PALETTE.sidewalk);
    const half = BOWL.half;

    // Street surface as a frame around the plaza bowl.
    const slabs = [
      [-HALF, -HALF, HALF, -half],
      [-HALF, half, HALF, HALF],
      [-HALF, -half, -half, half],
      [half, -half, HALF, half],
    ];
    for (const [x0, z0, x1, z1] of slabs) {
      const w = x1 - x0;
      const d = z1 - z0;
      this.b.add(boxGeo(w, 4, d), road, {
        transform: { x: x0 + w / 2, y: -2, z: z0 + d / 2 },
        surface: SURFACE.ROAD,
        castShadow: false,
      });
    }

    // Raised sidewalks hugging the building strips.
    const walks = [
      [-HALF, -96, HALF, -84],
      [-HALF, -48, HALF, -40],
      [-HALF, 42, HALF, 50],
      [-HALF, 92, HALF, 100],
      [-100, -HALF, -92, HALF],
      [-58, -40, -50, 42],
      [50, -40, 58, 42],
      [92, -HALF, 100, HALF],
    ];
    for (const [x0, z0, x1, z1] of walks) {
      const w = x1 - x0;
      const d = z1 - z0;
      this.b.add(boxGeo(w, 0.32, d), walk, {
        transform: { x: x0 + w / 2, y: 0.16, z: z0 + d / 2 },
        castShadow: false,
      });
    }

    // Kerbs along the avenue sidewalks -- these double as grind ledges.
    const kerbMat = toon(PALETTE.curb);
    for (const [x, z, w, d] of [
      [0, -40.2, 190, 0.7], [0, 42.2, 190, 0.7],
      [-51.5, 1, 0.7, 78], [51.5, 1, 0.7, 78],
    ]) {
      this.b.add(boxGeo(w, 0.62, d), kerbMat, { transform: { x, y: 0.31, z }, castShadow: false });
    }

    // Crosswalk stripes -- pure decoration, sits a hair above the asphalt.
    const paint = flat(0xf2f2ee);
    for (let i = -6; i <= 6; i++) {
      this.b.add(boxGeo(1.6, 0.02, 9), paint, {
        transform: { x: i * 3.4, y: 0.03, z: -32 }, collide: false, castShadow: false,
      });
      this.b.add(boxGeo(1.6, 0.02, 9), paint, {
        transform: { x: i * 3.4, y: 0.03, z: 32 }, collide: false, castShadow: false,
      });
      this.b.add(boxGeo(9, 0.02, 1.6), paint, {
        transform: { x: -32, y: 0.03, z: i * 3.4 }, collide: false, castShadow: false,
      });
      this.b.add(boxGeo(9, 0.02, 1.6), paint, {
        transform: { x: 32, y: 0.03, z: i * 3.4 }, collide: false, castShadow: false,
      });
    }

    // Outer wall so the player cannot skate off the world.
    const wall = toon(PALETTE.concrete);
    const t = 3;
    for (const [x, z, w, d] of [
      [0, -HALF - t / 2, HALF * 2 + t * 2, t],
      [0, HALF + t / 2, HALF * 2 + t * 2, t],
      [-HALF - t / 2, 0, t, HALF * 2 + t * 2],
      [HALF + t / 2, 0, t, HALF * 2 + t * 2],
    ]) {
      this.b.add(pillarGeo(w, 26, d), wall, {
        transform: { x, y: 0, z }, surface: SURFACE.WALL, castShadow: false,
      });
    }
  }

  // -------------------------------------------------------------------- bowl

  _bowl() {
    const half = BOWL.half;
    const depth = BOWL.depth;
    const r = BOWL.radius;
    const floorMat = toon(PALETTE.concreteWarm);
    const transMat = toon(PALETTE.concrete);

    // Bowl floor.
    this.b.add(boxGeo(half * 2, 4, half * 2), floorMat, {
      transform: { y: -depth - 2 },
      castShadow: false,
    });

    // Four transitions. Default orientation rises toward -Z.
    const span = half * 2;
    const configs = [
      { x: 0, z: -half + r / 2, ry: 0 },
      { x: 0, z: half - r / 2, ry: Math.PI },
      { x: -half + r / 2, z: 0, ry: Math.PI / 2 },
      { x: half - r / 2, z: 0, ry: -Math.PI / 2 },
    ];
    for (const c of configs) {
      this.b.add(quarterPipeGeo(r, span, 10, depth + 1), transMat, {
        transform: { x: c.x, y: -depth, z: c.z, ry: c.ry },
      });
    }

    // Roll-in ramps at two corners so you can drop in without a trick.
    for (const [sx, sz, ry] of [[-1, 1, Math.PI], [1, -1, 0]]) {
      this.b.add(wedgeGeo(9, depth, 12), transMat, {
        transform: { x: sx * (half - 8), y: -depth, z: sz * (half - 7), ry },
      });
    }

    // Centre monument: a stepped plinth with a beacon on top.
    this.b.add(cylGeo(6.4, 7.2, 1.1, 16), toon(PALETTE.concrete), {
      transform: { y: -depth },
    });
    this.b.add(cylGeo(4.4, 5.2, 1.0, 16), toon(PALETTE.sidewalk), {
      transform: { y: -depth + 1.1 },
    });
    this.b.add(cylGeo(0.5, 0.7, 5.5, 8), toon(PALETTE.steel), {
      transform: { y: -depth + 2.1 },
    });
    this.b.add(sphereGeo(1.15, 14), flat(PALETTE.sunYellow), {
      transform: { y: -depth + 8.0 }, collide: false, castShadow: false,
    });

    // Bowl-lip kerb: gives the rim rail something to sit on.
    const kerb = toon(PALETTE.sidewalk);
    for (const [x, z, w, d] of [
      [0, -half - 0.5, span + 2, 1],
      [0, half + 0.5, span + 2, 1],
      [-half - 0.5, 0, 1, span + 2],
      [half + 0.5, 0, 1, span + 2],
    ]) {
      this.b.add(boxGeo(w, 0.5, d), kerb, { transform: { x, y: 0.25, z }, castShadow: false });
    }
  }

  // --------------------------------------------------------------- buildings

  _buildings() {
    for (const spec of BUILDINGS) {
      this.b.setChunk(spec.district || 'terminal');
      this._building(spec);
    }
  }

  _building(spec) {
    const { x, z, w, d, h, color, style, sign } = spec;
    const body = toon(color);
    const trim = toon(PALETTE.rooftop);

    this.b.add(pillarGeo(w, h, d), body, {
      transform: { x, y: 0, z }, surface: SURFACE.WALL,
    });

    // Roof parapet -- four low walls that also read as a grindable edge.
    const pt = 0.55;
    const ph = 0.9;
    this.b.add(pillarGeo(w, ph, pt), trim, { transform: { x, y: h, z: z - d / 2 + pt / 2 } });
    this.b.add(pillarGeo(w, ph, pt), trim, { transform: { x, y: h, z: z + d / 2 - pt / 2 } });
    this.b.add(pillarGeo(pt, ph, d - pt * 2), trim, { transform: { x: x - w / 2 + pt / 2, y: h, z } });
    this.b.add(pillarGeo(pt, ph, d - pt * 2), trim, { transform: { x: x + w / 2 - pt / 2, y: h, z } });

    // Rooftop clutter.
    if (style !== 'low') {
      this.b.add(pillarGeo(4, 2.6, 3.2), toon(PALETTE.steel), {
        transform: { x: x + w * 0.22, y: h + ph, z: z - d * 0.2 }, surface: SURFACE.METAL,
      });
      this.b.add(cylGeo(1.1, 1.1, 2.2, 10), toon(PALETTE.steel), {
        transform: { x: x - w * 0.26, y: h + ph, z: z + d * 0.22 }, surface: SURFACE.METAL,
      });
      this.b.add(cylGeo(0.16, 0.16, 7, 6), toon(PALETTE.steel), {
        transform: { x: x - w * 0.3, y: h + ph, z: z - d * 0.3 }, collide: false,
      });
    }

    // Window bands.
    const bandMat = glass();
    const inset = 0.03;
    const rows = Math.max(1, Math.floor((h - 3) / 3.4));
    for (let i = 0; i < rows; i++) {
      const y = 3 + i * 3.4;
      if (y > h - 1.4) break;
      this.b.add(boxGeo(w * 0.82, 1.5, d + inset * 2), bandMat, {
        transform: { x, y, z }, collide: false, castShadow: false, receiveShadow: false,
      });
      this.b.add(boxGeo(w + inset * 2, 1.5, d * 0.82), bandMat, {
        transform: { x, y, z }, collide: false, castShadow: false, receiveShadow: false,
      });
    }

    // Ground floor shopfront band.
    if (style === 'shop' || style === 'low') {
      this.b.add(boxGeo(w * 0.9, 2.6, d + 0.06), toon(PALETTE.deepBlue, { steps: 2 }), {
        transform: { x, y: 1.6, z }, collide: false, castShadow: false,
      });
      this.b.add(boxGeo(w + 0.06, 2.6, d * 0.9), toon(PALETTE.deepBlue, { steps: 2 }), {
        transform: { x, y: 1.6, z }, collide: false, castShadow: false,
      });
      // Sun canopy, kept high enough to leave the tag walls clear.
      const awningMat = toon(PALETTE.bloodOrange, { steps: 2 });
      for (const oz of [d / 2 + 0.6, -d / 2 - 0.6]) {
        this.b.add(boxGeo(w * 0.86, 0.16, 1.2), awningMat, {
          transform: { x, y: 6.6, z: z + oz, rx: oz > 0 ? -0.24 : 0.24 },
          collide: false,
        });
      }
    }

    if (sign) this._sign(spec, sign);
  }

  _sign(spec, sign) {
    const { x, z, w, d, h } = spec;
    const tex = textureCanvas(512, 128, (ctx, cw, ch) => {
      ctx.fillStyle = '#12131c';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = `#${new THREE.Color(sign.color).getHexString()}`;
      ctx.fillRect(6, 6, cw - 12, ch - 12);
      ctx.fillStyle = '#12131c';
      ctx.font = 'bold 78px "Archivo Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sign.text, cw / 2, ch / 2 + 4);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const width = Math.min(w * 0.75, 16);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.25), mat);
    const y = Math.min(h - 2.5, 9.5);
    const off = 0.2;
    switch (sign.side) {
      case 'south': mesh.position.set(x, y, z + d / 2 + off); break;
      case 'north': mesh.position.set(x, y, z - d / 2 - off); mesh.rotation.y = Math.PI; break;
      case 'east': mesh.position.set(x + w / 2 + off, y, z); mesh.rotation.y = Math.PI / 2; break;
      default: mesh.position.set(x - w / 2 - off, y, z); mesh.rotation.y = -Math.PI / 2; break;
    }
    mesh.userData.noCollide = true;
    this.props.add(mesh);
  }

  // -------------------------------------------------------------- expressway

  _expressway() {
    const deckMat = toon(PALETTE.rooftop);
    const barrier = toon(PALETTE.concrete);
    const pillarMat = toon(PALETTE.concrete);
    const length = HALF * 2;

    this.b.add(boxGeo(14, 1.2, length), deckMat, {
      transform: { x: EXPRESSWAY_X, y: EXPRESSWAY_Y - 0.6, z: 0 },
      surface: SURFACE.ROAD,
    });
    for (const side of [-1, 1]) {
      this.b.add(boxGeo(0.8, 1.4, length), barrier, {
        transform: { x: EXPRESSWAY_X + side * 6.6, y: EXPRESSWAY_Y + 0.7, z: 0 },
        surface: SURFACE.WALL,
      });
    }

    for (let z = -HALF + 10; z <= HALF - 10; z += 30) {
      this.b.add(pillarGeo(4.2, EXPRESSWAY_Y - 0.6, 4.2), pillarMat, {
        transform: { x: EXPRESSWAY_X, y: 0, z }, surface: SURFACE.WALL,
      });
    }

    // On-ramp from the south street up onto the deck.
    this.b.add(wedgeGeo(10, EXPRESSWAY_Y, 46), toon(PALETTE.asphaltDark), {
      transform: { x: EXPRESSWAY_X, y: 0, z: HALF - 24, ry: Math.PI },
      surface: SURFACE.ROAD,
    });
    // Kicker at the north end so the deck launches you back over the city.
    this.b.add(bankGeo(6, 10, 10), toon(PALETTE.asphaltDark), {
      transform: { x: EXPRESSWAY_X, y: EXPRESSWAY_Y, z: -HALF + 18, ry: Math.PI },
      surface: SURFACE.ROAD,
    });
  }

  // --------------------------------------------------------------- skatepark

  _skatepark() {
    const cx = 42;
    const cz = 62;
    const mat = toon(PALETTE.concrete);
    const accent = toon(PALETTE.tangerine, { steps: 2 });

    // Facing quarter pipes make a mini half-pipe.
    this.b.add(quarterPipeGeo(4.5, 18, 12, 0.5), mat, {
      transform: { x: cx, y: 0, z: cz - 7, ry: 0 },
    });
    this.b.add(quarterPipeGeo(4.5, 18, 12, 0.5), mat, {
      transform: { x: cx, y: 0, z: cz + 7, ry: Math.PI },
    });

    // Funbox with a flat top and two kickers.
    this.b.add(boxGeo(9, 1.6, 7), mat, { transform: { x: cx - 24, y: 0.8, z: cz } });
    this.b.add(wedgeGeo(9, 1.6, 5), mat, { transform: { x: cx - 24, y: 0, z: cz - 6, ry: 0 } });
    this.b.add(wedgeGeo(9, 1.6, 5), mat, { transform: { x: cx - 24, y: 0, z: cz + 6, ry: Math.PI } });
    this.b.add(boxGeo(9.4, 0.22, 0.5), accent, {
      transform: { x: cx - 24, y: 1.71, z: cz - 3.4 }, collide: false, castShadow: false,
    });

    // Banked corner for wall-riding practice.
    this.b.add(bankGeo(5, 14, 12), mat, {
      transform: { x: cx - 6, y: 0, z: cz + 20, ry: Math.PI / 2 },
    });

    // Pyramid ledge.
    this.b.add(boxGeo(7, 1.0, 7), mat, { transform: { x: cx + 16, y: 0.5, z: cz + 14 } });
    this.b.add(boxGeo(4, 1.0, 4), mat, { transform: { x: cx + 16, y: 1.5, z: cz + 14 } });
  }

  // -------------------------------------------------------- stairs & ledges

  _stairsAndLedges() {
    const mat = toon(PALETTE.sidewalk);

    // Four stair sets radiating out of the square.
    this.stairs = [
      { x: -40, z: 46, ry: 0, w: 10, h: 3.2, d: 8 },
      { x: 40, z: -44, ry: Math.PI, w: 10, h: 3.2, d: 8 },
      { x: -8, z: 62, ry: -Math.PI / 2, w: 8, h: 2.6, d: 7 },
      { x: 8, z: -62, ry: Math.PI / 2, w: 8, h: 2.6, d: 7 },
    ];
    for (const s of this.stairs) {
      this.b.add(stairsGeo(s.w, s.h, s.d, 8), mat, {
        transform: { x: s.x, y: 0, z: s.z, ry: s.ry },
      });
      // Landing platform at the top.
      const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      this.b.add(boxGeo(s.w, s.h, 8), mat, {
        transform: {
          x: s.x + dir.x * (s.d / 2 + 4),
          y: s.h / 2,
          z: s.z + dir.z * (s.d / 2 + 4),
          ry: s.ry,
        },
      });
    }

    // Long grindable planter ledges lining the main avenues.
    const ledge = toon(PALETTE.curb);
    const soil = toon(PALETTE.planter, { steps: 2 });
    this.planters = [];
    for (const [x, z, w, d] of [
      [-54, -14, 3, 22], [-54, 14, 3, 22],
      [54, -14, 3, 22], [54, 14, 3, 22],
      [-14, 46, 22, 3], [14, 46, 22, 3],
      [-14, -46, 22, 3], [14, -46, 22, 3],
    ]) {
      this.b.add(boxGeo(w, 1.1, d), ledge, { transform: { x, y: 0.55, z } });
      this.b.add(boxGeo(w - 0.7, 0.2, d - 0.7), soil, {
        transform: { x, y: 1.15, z }, collide: false, castShadow: false,
      });
      this.planters.push({ x, z, w, d });
      // Shrubs.
      const count = Math.max(2, Math.floor(Math.max(w, d) / 5));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count - 0.5;
        const bush = 0.46 + this.rng() * 0.16;
        this.b.add(sphereGeo(bush, 8), toon(PALETTE.foliage, { steps: 2 }), {
          transform: { x: x + (w > d ? t * w : 0), y: 1.28 + bush * 0.5, z: z + (d >= w ? t * d : 0), sy: 0.8 },
          collide: false,
        });
      }
    }
  }

  // ---------------------------------------------------------------- dressing

  _streetDressing() {
    const poleMat = toon(PALETTE.steel);
    const lampMat = flat(PALETTE.sunYellow);
    const coneMat = toon(PALETTE.tangerine, { steps: 2 });

    // Street lamps along the avenues.
    const lampSpots = [];
    for (let i = -4; i <= 4; i++) {
      lampSpots.push([i * 22, -37], [i * 22, 37], [-53, i * 20], [53, i * 20]);
    }
    for (const [x, z] of lampSpots) {
      if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) continue;
      this.b.add(cylGeo(0.16, 0.2, 7.2, 6), poleMat, {
        transform: { x, y: 0.3, z }, surface: SURFACE.METAL,
      });
      this.b.add(boxGeo(0.5, 0.4, 2.2), poleMat, {
        transform: { x, y: 7.3, z: z + 0.9 }, collide: false,
      });
      this.b.add(sphereGeo(0.42, 8), lampMat, {
        transform: { x, y: 7.1, z: z + 1.8 }, collide: false, castShadow: false,
      });
    }

    // Vending machines -- the little colour pops that sell the street.
    const vendColors = [PALETTE.hotPink, PALETTE.cyan, PALETTE.lime, PALETTE.tangerine, PALETTE.violet];
    for (let i = 0; i < 22; i++) {
      const side = Math.floor(this.rng() * 4);
      const t = (this.rng() - 0.5) * 130;
      const off = 44 + this.rng() * 4;
      let x, z, ry;
      if (side === 0) { x = t; z = -off; ry = 0; }
      else if (side === 1) { x = t; z = off; ry = Math.PI; }
      else if (side === 2) { x = -off - 12; z = t; ry = Math.PI / 2; }
      else { x = off + 12; z = t; ry = -Math.PI / 2; }
      const c = vendColors[Math.floor(this.rng() * vendColors.length)];
      this.b.add(pillarGeo(1.5, 2.2, 0.9), toon(c, { steps: 2 }), { transform: { x, y: 0.32, z, ry } });
      this.b.add(boxGeo(1.1, 1.2, 0.08), flat(0x121420), {
        transform: { x, y: 1.85, z: z + (ry === 0 ? 0.5 : ry === Math.PI ? -0.5 : 0), rx: 0, ry },
        collide: false, castShadow: false,
      });
    }

    // Traffic cones and barriers scattered around the square.
    for (let i = 0; i < 26; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 28 + this.rng() * 24;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      this.b.add(cylGeo(0.06, 0.42, 0.8, 7), coneMat, {
        transform: { x, y: 0, z }, collide: false,
      });
    }

    // Bus-stop shelters flanking the terminal.
    for (const [x, z, ry] of [[-24, -36, 0], [24, -36, 0], [-24, 36, Math.PI], [24, 36, Math.PI]]) {
      this.b.add(boxGeo(8, 0.25, 3), toon(PALETTE.steel), {
        transform: { x, y: 3.0, z, ry }, surface: SURFACE.METAL,
      });
      for (const sx of [-3.6, 3.6]) {
        this.b.add(cylGeo(0.12, 0.12, 3.0, 6), toon(PALETTE.steel), {
          transform: { x: x + sx, y: 0.3, z, ry }, collide: false,
        });
      }
      this.b.add(boxGeo(8, 2.4, 0.1), glass(), {
        transform: { x, y: 1.6, z: z + (ry === 0 ? -1.4 : 1.4) },
        surface: SURFACE.SLICK, castShadow: false,
      });
    }
  }

  // ------------------------------------------------------------------- rails

  _addRail(points, options) {
    const rail = new Rail(points, options);
    this.rails.add(rail);
    // Merge a rail's tube with the district it runs through, so it is culled
    // along with everything else over there.
    const mid = rail.getPointAt(rail.totalLength * 0.5, new THREE.Vector3());
    this.b.setChunk(districtAt(mid.x, mid.z).id);
    this._railVisual(rail, options);
    return rail;
  }

  _railVisual(rail, options = {}) {
    const type = options.type ?? RAIL_TYPE.RAIL;
    if (type === RAIL_TYPE.LEDGE) return; // the ledge itself is already solid geometry

    const radius = type === RAIL_TYPE.WIRE ? 0.05 : 0.09;
    const color = type === RAIL_TYPE.WIRE ? 0x1b1e2c : PALETTE.rail;
    const segments = Math.max(12, Math.min(220, Math.ceil(rail.totalLength / 1.2)));
    const curve = new THREE.CatmullRomCurve3(rail.points, rail.closed, 'catmullrom', 0.02);
    this.b.add(tubeGeo(curve, radius, segments, 6), toon(color, { steps: 2 }), {
      collide: false, castShadow: type !== RAIL_TYPE.WIRE, receiveShadow: false,
      surface: SURFACE.METAL,
    });

    // Support posts for street handrails.
    if (type === RAIL_TYPE.RAIL && options.posts !== false) {
      const step = 3.2;
      for (let d = step * 0.5; d < rail.totalLength; d += step) {
        const p = rail.getPointAt(d, new THREE.Vector3());
        const ground = this.collisionSampleY ? this.collisionSampleY(p.x, p.z) : null;
        const baseY = ground ?? (p.y - 1.0);
        const height = Math.max(0.3, p.y - baseY);
        this.b.add(cylGeo(0.06, 0.06, height, 5), toon(PALETTE.steel), {
          transform: { x: p.x, y: p.y - height, z: p.z }, collide: false, receiveShadow: false,
        });
      }
    }
  }

  _railNetwork() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const half = BOWL.half;

    // 1. Bowl rim -- a closed circuit right around the square. Rails sit a
    //    little clear of the kerb or ledge they follow: flush with it, landing
    //    on the surface beats catching the rail every time.
    this._addRail([
      V(-half - 0.5, 0.82, -half - 0.5),
      V(half + 0.5, 0.82, -half - 0.5),
      V(half + 0.5, 0.82, half + 0.5),
      V(-half - 0.5, 0.82, half + 0.5),
    ], { type: RAIL_TYPE.LEDGE, closed: true, curved: false, name: 'bowl-rim' });

    // 2. Monument ring inside the bowl.
    const ring = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ring.push(V(Math.cos(a) * 7.4, -BOWL.depth + 1.25, Math.sin(a) * 7.4));
    }
    this._addRail(ring, { type: RAIL_TYPE.LEDGE, closed: true, curved: true, name: 'monument' });

    // 3. Stair handrails.
    for (const s of this.stairs) {
      const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      for (const sgn of [-1, 1]) {
        const a = V(
          s.x - dir.x * (s.d / 2 + 1.2) + side.x * sgn * (s.w / 2 - 0.4), 1.05,
          s.z - dir.z * (s.d / 2 + 1.2) + side.z * sgn * (s.w / 2 - 0.4),
        );
        const b = V(
          s.x + dir.x * (s.d / 2 + 0.6) + side.x * sgn * (s.w / 2 - 0.4), s.h + 1.05,
          s.z + dir.z * (s.d / 2 + 0.6) + side.z * sgn * (s.w / 2 - 0.4),
        );
        this._addRail([a, b], { type: RAIL_TYPE.RAIL, curved: false, name: 'stair' });
      }
    }

    // 4. Planter ledges.
    for (const p of this.planters) {
      const along = p.w > p.d ? 'x' : 'z';
      const len = (along === 'x' ? p.w : p.d) / 2 - 0.2;
      const a = V(p.x - (along === 'x' ? len : 0), 1.48, p.z - (along === 'z' ? len : 0));
      const b = V(p.x + (along === 'x' ? len : 0), 1.48, p.z + (along === 'z' ? len : 0));
      this._addRail([a, b], { type: RAIL_TYPE.LEDGE, curved: false, name: 'planter' });
    }

    // 5. Rooftop parapets.
    for (const s of BUILDINGS) {
      const y = s.h + 1.28;
      const hw = s.w / 2 - 0.3;
      const hd = s.d / 2 - 0.3;
      this._addRail([
        V(s.x - hw, y, s.z - hd), V(s.x + hw, y, s.z - hd),
        V(s.x + hw, y, s.z + hd), V(s.x - hw, y, s.z + hd),
      ], { type: RAIL_TYPE.LEDGE, closed: true, curved: false, name: 'roof' });
    }

    // 5b. The other districts.
    this._heightsRails(V);
    this._hillRails(V);
    this._drainRails(V);
    this._bantamRails(V);

    // 6. Sagging wires linking rooftops -- the fast lane across the city.
    const wireLinks = [
      [[-76, -62, 30], [-36, -64, 22]],
      [[-36, -64, 22], [0, -66, 44]],
      [[0, -66, 44], [38, -64, 26]],
      [[38, -64, 26], [78, -62, 34]],
      [[78, -62, 34], [72, -14, 24]],
      [[72, -14, 24], [76, 26, 38]],
      [[76, 26, 38], [70, 66, 20]],
      [[70, 66, 20], [26, 78, 28]],
      [[26, 78, 28], [-14, 80, 22]],
      [[-14, 80, 22], [-54, 76, 32]],
      [[-54, 76, 32], [-74, 30, 26]],
      [[-74, 30, 26], [-78, -12, 36]],
      [[-78, -12, 36], [-76, -62, 30]],
      // Rokkaku Heights, roof to roof.
      [[-100, -200, 62], [-40, -215, 48]],
      [[-40, -215, 48], [20, -195, 70]],
      [[20, -195, 70], [86, -210, 54]],
      [[86, -210, 54], [128, -240, 36]],
      [[-70, -270, 40], [0, -275, 58]],
      [[0, -275, 58], [74, -272, 44]],
      [[-134, -246, 34], [-70, -270, 40]],
      [[-100, -200, 62], [-70, -270, 40]],
      // The long one: out of the terminal and up into the Heights.
      [[0, -66, 44], [20, -195, 70]],
      // Cross-town shortcuts over the square.
      [[-44, -18, 14], [44, -22, 12]],
      [[-44, 22, 11], [44, 20, 16]],
      [[0, -66, 44], [44, 20, 16]],
    ];
    for (const [a, b] of wireLinks) {
      const ay = a[2] + 1.6;
      const by = b[2] + 1.6;
      const pa = V(a[0], ay, a[1]);
      const pb = V(b[0], by, b[1]);
      const mid = pa.clone().lerp(pb, 0.5);
      mid.y -= Math.min(4, pa.distanceTo(pb) * 0.06);
      this._addRail([pa, mid, pb], { type: RAIL_TYPE.WIRE, curved: true, name: 'wire', boost: 1.12 });
    }

    // 7. Expressway barrier rails.
    for (const side of [-1, 1]) {
      this._addRail([
        V(EXPRESSWAY_X + side * 6.6, EXPRESSWAY_Y + 1.72, -HALF + 6),
        V(EXPRESSWAY_X + side * 6.6, EXPRESSWAY_Y + 1.72, HALF - 30),
      ], { type: RAIL_TYPE.LEDGE, curved: false, name: 'expressway' });
    }

    // 8. Skatepark rails.
    this._addRail([V(20, 1.9, 62), V(38, 1.9, 62)], { type: RAIL_TYPE.RAIL, curved: false });
    this._addRail([V(52, 1.15, 74), V(52, 1.15, 90)], { type: RAIL_TYPE.RAIL, curved: false });
    this._addRail([V(58, 2.6, 76), V(58, 2.6, 90)], { type: RAIL_TYPE.RAIL, curved: false });

    // 9. Ring of street rails around the square -- the money line for combos.
    this._addRail([V(-30, 1.05, -33), V(30, 1.05, -33)], { type: RAIL_TYPE.RAIL, curved: false });
    this._addRail([V(30, 1.05, 33), V(-30, 1.05, 33)], { type: RAIL_TYPE.RAIL, curved: false });
    this._addRail([V(-33, 1.05, 30), V(-33, 1.05, -30)], { type: RAIL_TYPE.RAIL, curved: false });
    this._addRail([V(33, 1.05, -30), V(33, 1.05, 30)], { type: RAIL_TYPE.RAIL, curved: false });

    // 10. Kerb rails running the length of the avenues.
    this._addRail([V(-95, 0.82, -40.2), V(95, 0.82, -40.2)], { type: RAIL_TYPE.LEDGE, curved: false });
    this._addRail([V(95, 0.82, 42.2), V(-95, 0.82, 42.2)], { type: RAIL_TYPE.LEDGE, curved: false });
    this._addRail([V(-51.5, 0.82, 40), V(-51.5, 0.82, -38)], { type: RAIL_TYPE.LEDGE, curved: false });
    this._addRail([V(51.5, 0.82, -38), V(51.5, 0.82, 40)], { type: RAIL_TYPE.LEDGE, curved: false });
  }


  // ------------------------------------------------------ Rokkaku Heights

  /**
   * Towers, and the ways between them.
   *
   * The towers themselves come from the building data; what makes the district
   * a place to skate rather than a place to look at is the skybridges, which
   * turn nine separate roofs into one connected route.
   */
  _heights() {
    const deck = toon(PALETTE.rooftop);
    const steel = toon(PALETTE.steel);

    this.skybridges = [
      { a: [-100, -200], b: [-40, -215], y: 34 },
      { a: [-40, -215], b: [20, -195], y: 40 },
      { a: [20, -195], b: [86, -210], y: 44 },
      { a: [-70, -270], b: [0, -275], y: 32 },
      { a: [0, -275], b: [74, -272], y: 36 },
      { a: [-100, -200], b: [-70, -270], y: 30 },
      { a: [86, -210], b: [128, -240], y: 30 },
    ];
    for (const bridge of this.skybridges) {
      const dx = bridge.b[0] - bridge.a[0];
      const dz = bridge.b[1] - bridge.a[1];
      const length = Math.hypot(dx, dz);
      const angle = Math.atan2(dx, dz);
      const cx = (bridge.a[0] + bridge.b[0]) / 2;
      const cz = (bridge.a[1] + bridge.b[1]) / 2;

      this.b.add(boxGeo(5.5, 0.5, length), deck, {
        transform: { x: cx, y: bridge.y, z: cz, ry: angle }, surface: SURFACE.METAL,
      });
      for (const side of [-1, 1]) {
        this.b.add(boxGeo(0.35, 1.0, length), steel, {
          transform: { x: cx + Math.cos(angle) * side * 2.6, y: bridge.y + 0.75, z: cz - Math.sin(angle) * side * 2.6, ry: angle },
          surface: SURFACE.METAL,
        });
      }
    }

    // A roll-in from street level, so the district is enterable without
    // arriving from a wire.
    this.b.add(wedgeGeo(14, 9, 30), toon(PALETTE.concrete), {
      transform: { x: -10, y: 0, z: -165, ry: Math.PI }, surface: SURFACE.ROAD,
    });
    this.b.add(boxGeo(26, 9, 16), toon(PALETTE.concrete), { transform: { x: -10, y: 4.5, z: -186 } });

    // Ledges and banks at ground level.
    for (const [x, z, w, d] of [[-120, -170, 26, 4], [60, -170, 26, 4], [-30, -240, 4, 30], [110, -200, 4, 26]]) {
      this.b.add(boxGeo(w, 1.2, d), toon(PALETTE.curb), { transform: { x, y: 0.6, z } });
    }
    for (const [x, z, ry] of [[-150, -220, -Math.PI / 2], [150, -220, Math.PI / 2]]) {
      this.b.add(quarterPipeGeo(6, 30, 10, 0.5), toon(PALETTE.concrete), { transform: { x, y: 0, z, ry } });
    }
  }

  // -------------------------------------------------------- Dogenzaka Hill

  /**
   * The descent.
   *
   * One long ramp you bomb down, with guard walls to ride and kickers to clear.
   * The whole district is about carrying speed, so nothing is placed where it
   * would stop you dead.
   */
  _hill() {
    const RISE = 22;
    const FROM = 160;
    const TO = 290;
    const depth = TO - FROM;
    const slope = Math.atan2(RISE, depth);
    const road = toon(PALETTE.asphaltDark);
    const wall = toon(PALETTE.concrete);

    this.hill = { from: FROM, to: TO, rise: RISE, slope, halfWidth: 60 };

    this.b.add(wedgeGeo(120, RISE, depth), road, {
      transform: { x: 0, y: 0, z: (FROM + TO) / 2 }, surface: SURFACE.ROAD,
    });

    // Guard walls, tilted to follow the grade.
    const wallLength = Math.hypot(depth, RISE);
    for (const side of [-1, 1]) {
      this.b.add(boxGeo(2, 3.2, wallLength), wall, {
        transform: { x: side * 59, y: RISE / 2 + 1.4, z: (FROM + TO) / 2, rx: -slope },
        surface: SURFACE.WALL,
      });
    }

    // A central island splitting the road, and kickers either side of it.
    for (let i = 0; i < 4; i++) {
      const t = 0.18 + i * 0.2;
      const z = FROM + depth * t;
      const y = RISE * t;
      this.b.add(boxGeo(9, 1.1, 20), toon(PALETTE.curb), {
        transform: { x: 0, y: y + 0.55, z, rx: -slope },
      });
      for (const side of [-1, 1]) {
        this.b.add(wedgeGeo(12, 2.4, 7), road, {
          transform: { x: side * 30, y, z: z + 14, ry: Math.PI, rx: -slope },
        });
      }
    }

    // The lip at the bottom, so the descent throws you into the terminal.
    this.b.add(bankGeo(4, 40, 10), road, {
      transform: { x: 0, y: 0, z: FROM - 6, ry: Math.PI }, surface: SURFACE.ROAD,
    });
  }

  // ---------------------------------------------------------- Kogane Drain

  /**
   * A drainage channel: two facing transitions running the height of the map.
   *
   * Built up from the ground rather than dug into it, because the street is one
   * slab and carving a trench out of it would mean rebuilding the whole ground
   * plane around a second hole.
   */
  _drain() {
    const concrete = toon(PALETTE.concrete);
    const RADIUS = 10;
    const LENGTH = HALF * 2;
    const WEST = -254;
    const EAST = -196;

    // Facing quarter pipes. Default orientation rises toward -Z, so a quarter
    // turn each way points them at each other across the channel.
    this.b.add(quarterPipeGeo(RADIUS, LENGTH, 12, 1), concrete, {
      transform: { x: WEST + RADIUS / 2, y: 0, z: 0, ry: Math.PI / 2 },
    });
    this.b.add(quarterPipeGeo(RADIUS, LENGTH, 12, 1), concrete, {
      transform: { x: EAST - RADIUS / 2, y: 0, z: 0, ry: -Math.PI / 2 },
    });

    // Lips along the top of each wall, for grinding the rim of the channel.
    for (const x of [WEST, EAST]) {
      this.b.add(boxGeo(3, 1, LENGTH), toon(PALETTE.curb), {
        transform: { x, y: RADIUS + 0.5, z: 0 }, castShadow: false,
      });
    }

    // Pipes crossing overhead, and the outfalls they run into.
    const steel = toon(PALETTE.steel);
    for (let i = -2; i <= 2; i++) {
      const z = i * 110;
      this.b.add(cylGeo(1.1, 1.1, 62, 10), steel, {
        transform: { x: WEST, y: RADIUS + 7, z, rz: Math.PI / 2 }, surface: SURFACE.METAL,
      });
      this.b.add(cylGeo(2.4, 2.4, 5, 10), concrete, {
        transform: { x: WEST - 2, y: 2.4, z: z + 30, rz: Math.PI / 2 },
      });
    }

    // Roll-in at the north end and a bank at the south, so it is a run rather
    // than a dead end.
    this.b.add(wedgeGeo(50, 10, 34), concrete, {
      transform: { x: -225, y: 0, z: -HALF + 40, ry: 0 }, surface: SURFACE.ROAD,
    });
    this.b.add(bankGeo(7, 50, 12), concrete, {
      transform: { x: -225, y: 0, z: HALF - 40, ry: Math.PI }, surface: SURFACE.ROAD,
    });

    // A funbox on the channel floor to break up the run.
    this.b.add(boxGeo(16, 2, 12), concrete, { transform: { x: -225, y: 1, z: 0 } });
    for (const sz of [-1, 1]) {
      this.b.add(wedgeGeo(16, 2, 8), concrete, {
        transform: { x: -225, y: 0, z: sz * 10, ry: sz > 0 ? Math.PI : 0 },
      });
    }
  }

  // ---------------------------------------------------------- Bantam Street

  /** A market grid: tight alleys, stalls to clear, and rails the length of them. */
  _bantam() {
    const canopy = toon(PALETTE.bloodOrange, { steps: 2 });
    const crate = toon(PALETTE.wood);
    const kerb = toon(PALETTE.curb);

    this.bantamAisles = [];
    for (let ix = 0; ix < 5; ix++) {
      const x = 161 + ix * 34;
      this.bantamAisles.push(x);
      // A kerb the length of each aisle, which doubles as its grind line.
      this.b.add(boxGeo(1.4, 0.7, 280), kerb, { transform: { x, y: 0.35, z: 0 }, castShadow: false });
    }

    // Stalls and crates down the aisles: things to ollie rather than walls.
    for (let i = 0; i < 46; i++) {
      const x = this.bantamAisles[i % this.bantamAisles.length] + (this.rng() - 0.5) * 9;
      const z = -140 + this.rng() * 280;
      const h = 1.1 + this.rng() * 0.8;
      this.b.add(pillarGeo(2.6, h, 2.2), crate, { transform: { x, y: 0, z } });
      if (this.rng() > 0.45) {
        this.b.add(boxGeo(4.6, 0.14, 3.4), canopy, {
          transform: { x, y: h + 1.5, z }, collide: false,
        });
      }
    }

    // Ramps up onto the low roofs, so the district has a top layer too.
    for (const [x, z, ry] of [[168, -60, -Math.PI / 2], [236, 60, Math.PI / 2], [270, -100, -Math.PI / 2]]) {
      this.b.add(wedgeGeo(10, 9, 18), toon(PALETTE.concrete), { transform: { x, y: 0, z, ry } });
    }
  }


  _heightsRails(V) {
    // The skybridges are grindable along both edges.
    for (const bridge of this.skybridges || []) {
      const angle = Math.atan2(bridge.b[0] - bridge.a[0], bridge.b[1] - bridge.a[1]);
      for (const side of [-1, 1]) {
        const ox = Math.cos(angle) * side * 2.6;
        const oz = -Math.sin(angle) * side * 2.6;
        this._addRail([
          V(bridge.a[0] + ox, bridge.y + 1.45, bridge.a[1] + oz),
          V(bridge.b[0] + ox, bridge.y + 1.45, bridge.b[1] + oz),
        ], { type: RAIL_TYPE.LEDGE, curved: false, name: 'skybridge' });
      }
    }
    this._addRail([V(-120, 1.3, -170), V(-94, 1.3, -170)], { type: RAIL_TYPE.LEDGE, curved: false });
    this._addRail([V(60, 1.3, -170), V(86, 1.3, -170)], { type: RAIL_TYPE.LEDGE, curved: false });
    this._addRail([V(-30, 1.3, -255), V(-30, 1.3, -225)], { type: RAIL_TYPE.LEDGE, curved: false });
  }

  _hillRails(V) {
    const { from, to, rise } = this.hill;
    const depth = to - from;
    const yAt = (z) => (rise * (z - from)) / depth;
    // Both guard walls, and the island down the middle: three lines the whole
    // length of the descent, which is what makes the hill a combo rather than
    // just a fast bit of road.
    for (const side of [-1, 1]) {
      this._addRail([
        V(side * 58, yAt(from + 4) + 3.4, from + 4),
        V(side * 58, yAt(to - 4) + 3.4, to - 4),
      ], { type: RAIL_TYPE.LEDGE, curved: false, name: 'hill-wall' });
    }
    this._addRail([
      V(0, yAt(from + 10) + 1.25, from + 10),
      V(0, yAt(to - 10) + 1.25, to - 10),
    ], { type: RAIL_TYPE.RAIL, curved: false, name: 'hill-island', boost: 1.1 });
  }

  _drainRails(V) {
    const LIP = 11.2;
    for (const x of [-254, -196]) {
      this._addRail([V(x, LIP, -HALF + 20), V(x, LIP, HALF - 20)],
        { type: RAIL_TYPE.LEDGE, curved: false, name: 'drain-lip' });
    }
    // The overhead pipes, crossing the channel.
    for (let i = -2; i <= 2; i++) {
      this._addRail([V(-256, 17, i * 110), V(-194, 17, i * 110)],
        { type: RAIL_TYPE.POLE, curved: false, name: 'drain-pipe', boost: 1.1 });
    }
  }

  _bantamRails(V) {
    for (const x of this.bantamAisles || []) {
      this._addRail([V(x, 0.92, -138), V(x, 0.92, 138)],
        { type: RAIL_TYPE.LEDGE, curved: false, name: 'bantam-kerb' });
    }
  }

  // ------------------------------------------------------------- gameplay pts

  /**
   * Tag walls, from the buildings that own them plus the loose ones.
   *
   * Deriving a spot from its building's footprint means it is always on a real
   * face: move the building and the graffiti moves with it, instead of ending
   * up floating in a street or buried inside a wall.
   */
  _tagSpots() {
    const specs = [];

    for (const b of BUILDINGS) {
      for (const tag of b.tags || []) {
        const offset = tag.offset || 0;
        let x = b.x;
        let z = b.z;
        let dir = 0;
        switch (tag.side) {
          case 'south': z = b.z + b.d / 2; dir = 0; x += offset; break;
          case 'north': z = b.z - b.d / 2; dir = Math.PI; x += offset; break;
          case 'east': x = b.x + b.w / 2; dir = Math.PI / 2; z += offset; break;
          default: x = b.x - b.w / 2; dir = -Math.PI / 2; z += offset; break;
        }
        const size = TAG_SIZES[tag.size] || TAG_SIZES.medium;
        specs.push({ x, y: tag.y, z, dir, w: size.w, h: size.h, size: tag.size, district: b.district });
      }
    }
    specs.push(...TAG_SPOTS);

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const normal = new THREE.Vector3(Math.sin(s.dir), 0, Math.cos(s.dir));
      const position = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(normal, 0.08);
      this.tagSpots.push({
        id: `tag-${i}`,
        position,
        normal,
        dir: s.dir,
        width: s.w,
        height: s.h,
        size: s.size ?? 'medium',
        district: s.district || districtAt(s.x, s.z).id,
      });
    }
  }

  _pickupSpots() {
    for (const [x, y, z] of CAN_SPOTS) this.canSpots.push(new THREE.Vector3(x, y, z));
  }

  _policePosts() {
    for (const [x, y, z] of POLICE_POSTS) this.policePosts.push(new THREE.Vector3(x, y, z));
  }

  // ------------------------------------------------------------------ lights

  _lights() {
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a3b2e, 1.05);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d0, 2.0);
    this.sunDirection = new THREE.Vector3(0.45, 0.62, -0.72).normalize();
    sun.position.copy(this.sunDirection).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70;
    cam.near = 1; cam.far = 320;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.04;
    this.group.add(sun);
    this.group.add(sun.target);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(0x8fb6ff, 0.45);
    fill.position.set(-70, 50, 90);
    this.group.add(fill);
  }

  /**
   * Keep the shadow frustum around the skaters, snapped to texels so it does
   * not shimmer. In split-screen it widens to cover however far apart they are.
   */
  updateShadows(focusPoints) {
    if (!this.sun) return;
    const points = Array.isArray(focusPoints) ? focusPoints : [focusPoints];
    if (!points.length) return;

    let cx = 0;
    let cz = 0;
    for (const p of points) { cx += p.x; cz += p.z; }
    cx /= points.length;
    cz /= points.length;

    let spread = 0;
    for (const p of points) spread = Math.max(spread, Math.hypot(p.x - cx, p.z - cz));

    // Beyond this the map is simply too spread out for one cascade; the
    // shadows go soft rather than popping in and out.
    const size = Math.min(190, Math.max(70, spread * 1.25 + 45));
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - size) > 1) {
      cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
      cam.updateProjectionMatrix();
    }

    const texel = (size * 2) / 2048;
    const sx = Math.round(cx / texel) * texel;
    const sz = Math.round(cz / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx, 0, sz).addScaledVector(this.sunDirection, 160);
    this.sun.target.updateMatrixWorld();
  }
}
