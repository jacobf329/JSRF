// Checks the rudie rig: it fits the capsule the physics uses, its hand-built
// geometry faces outward, the merge keeps it cheap, and the secondary motion
// actually moves and actually settles.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5206, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5206/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

// --- geometry ---------------------------------------------------------------
const geo = await page.evaluate(async () => {
  const S = await import('/src/player/Shapes.js');
  const THREE = window.__three;

  // Normals must point away from the shape, or a toon material renders it
  // solid black -- which is exactly how the hair shipped broken once.
  const outward = (g) => {
    const pos = g.attributes.position, nor = g.attributes.normal;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); }
    cx /= pos.count; cy /= pos.count; cz /= pos.count;
    let agree = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy, dz = pos.getZ(i) - cz;
      if (nor.getX(i) * dx + nor.getY(i) * dy + nor.getZ(i) * dz > 0) agree++;
    }
    return +(agree / pos.count).toFixed(2);
  };

  const shapes = {
    roundedBox: S.roundedBox(0.4, 0.5, 0.3, 0.1, 2),
    limbGeo: S.limbGeo(0.4, 0.12, 0.08),
    blobGeo: S.blobGeo(0.2, 0.2, 0.2),
    swoopGeo: S.swoopGeo(0.3, 0.17, 0.11, { curl: 0.35, taper: 0.2, segments: 4 }),
    skateGeo: S.skateGeo(),
    skateFrameGeo: S.skateFrameGeo(),
  };
  const out = {};
  for (const [name, g] of Object.entries(shapes)) {
    const n = S.normalise(g);
    out[name] = {
      outward: outward(n),
      tris: n.attributes.position.count / 3,
      attrs: Object.keys(n.attributes).sort().join(','),
      indexed: !!n.index,
    };
  }

  // A merge of all of them must succeed -- that is the thing that broke when
  // extruded, lathed and hand-built shapes disagreed about their attributes.
  const b = new S.PartBuilder();
  for (const g of Object.values(shapes)) b.add(g, 0xff2f87);
  const merged = b.build();
  return { shapes: out, mergedParts: merged.length, mergedOk: !!merged[0] && merged[0].geometry.attributes.position.count > 0 };
});

// --- the rig ----------------------------------------------------------------
const rig = await page.evaluate(async () => {
  const THREE = window.__three;
  const { PlayerModel } = await import('/src/player/PlayerModel.js');
  const { SKATER } = await import('/src/player/PlayerConfig.js');
  const { RUDIES } = await import('/src/player/Rudies.js');

  const rows = RUDIES.map((r, i) => {
    const m = new PlayerModel(i);
    const box = new THREE.Box3().setFromObject(m.root);
    let meshes = 0;
    let tris = 0;
    m.root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      tris += o.geometry.attributes.position.count / 3;
    });
    return {
      id: r.id,
      height: +(box.max.y - box.min.y).toFixed(3),
      feet: +box.min.y.toFixed(3),
      meshes,
      tris: Math.round(tris),
    };
  });
  return { rows, capsule: SKATER.height };
});

// --- motion -----------------------------------------------------------------
const motion = await page.evaluate(async () => {
  const THREE = window.__three;
  const { PlayerModel } = await import('/src/player/PlayerModel.js');
  const m = new PlayerModel(0);

  const fake = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    index: 0, time: 0, state: 'skate',
    groundSpeed: 0, speed: 0, visualHeading: 0, lean: 0, grounded: true,
    trickFlip: 0, trickSpin: 0, trickRoll: 0,
    trickPose: null, trickPoseWeight: 0, invulnerable: 0,
  };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { fake.time += 1 / 60; m.update(1 / 60, fake); } };

  step(60);
  const rest = { hair: m.hair.rotation.x, tail: m.tailL.rotation.x, scaleY: m.yawGroup.scale.y };

  // Speed should stream the hair and tails back.
  fake.groundSpeed = 19; fake.speed = 19;
  fake.velocity.set(0, 0, 19);
  step(45);
  const fast = { hair: m.hair.rotation.x, tail: m.tailL.rotation.x };

  // A hard landing should compress the rig, then let it back up.
  fake.groundSpeed = 0; fake.speed = 0; fake.velocity.set(0, 0, 0);
  step(40);
  fake.grounded = false; fake.state = 'air';
  fake.velocity.set(0, -26, 0);
  step(10);
  fake.grounded = true; fake.state = 'skate';
  fake.velocity.set(0, 0, 0);
  // The compression peaks a few frames after touchdown, not on it, so take
  // the deepest point of the bounce rather than a fixed frame.
  let squashed = Infinity;
  let widened = 0;
  for (let i = 0; i < 24; i++) {
    step(1);
    if (m.yawGroup.scale.y < squashed) {
      squashed = m.yawGroup.scale.y;
      widened = m.yawGroup.scale.x;
    }
  }
  step(90);
  const recovered = m.yawGroup.scale.y;

  // Turning should throw the head ahead of the body.
  let headLead = 0;
  for (let i = 0; i < 30; i++) {
    fake.visualHeading += 0.09;
    m.update(1 / 60, fake);
    headLead = Math.max(headLead, Math.abs(m.neck.rotation.y));
  }

  // Nothing may run away or go non-finite over a long, violent run.
  let finite = true;
  for (let i = 0; i < 1200; i++) {
    fake.visualHeading += (Math.random() - 0.5) * 0.6;
    fake.lean = (Math.random() - 0.5) * 1.4;
    fake.groundSpeed = Math.random() * 24;
    fake.speed = fake.groundSpeed;
    fake.grounded = Math.random() > 0.3;
    fake.velocity.set(0, (Math.random() - 0.5) * 50, fake.groundSpeed);
    fake.state = fake.grounded ? 'skate' : 'air';
    m.update(1 / 60, fake);
    const v = [m.hair.rotation.x, m.hair.rotation.z, m.tailL.rotation.x, m.yawGroup.scale.y, m.neck.rotation.y];
    if (v.some((n) => !Number.isFinite(n) || Math.abs(n) > 40)) { finite = false; break; }
  }

  return { rest, fast, squashed: +squashed.toFixed(3), widened: +widened.toFixed(3), recovered: +recovered.toFixed(3), headLead: +headLead.toFixed(3), finite, scale: m.scaleFactor };
});

console.log(JSON.stringify({ geo, rig, motion }, null, 2));

const shapes = geo.shapes;
const rows = rig.rows;
const ok = {
  everyShapeFacesOutward: Object.values(shapes).every((s) => s.outward >= 0.7),
  everyShapeMergeable: Object.values(shapes).every((s) => s.attrs === 'normal,position' && !s.indexed),
  mixedShapesMerge: geo.mergedOk && geo.mergedParts === 1,

  rigMatchesTheCapsule: rows.every((r) => Math.abs(r.height - rig.capsule) < 0.05),
  rigStandsOnItsFeet: rows.every((r) => Math.abs(r.feet) < 0.02),
  everyRudieBuilds: rows.length === 6 && rows.every((r) => r.tris > 500),
  // Merging by joint and colour is what pays for the extra detail.
  mergeKeepsMeshCountDown: rows.every((r) => r.meshes <= 34),
  rigStaysCheap: rows.every((r) => r.tris < 9000),

  speedStreamsTheHairBack: motion.fast.hair < motion.rest.hair - 0.08,
  speedStreamsTheTailsBack: motion.fast.tail < motion.rest.tail - 0.1,
  landingSquashesTheRig: motion.squashed < motion.rest.scaleY * 0.94,
  squashKeepsVolume: motion.widened > motion.squashed,
  squashRecovers: Math.abs(motion.recovered - motion.rest.scaleY) < 0.01,
  headLeadsTheTurn: motion.headLead > 0.05,
  springsNeverRunAway: motion.finite,
};
console.log('\n--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 6)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
