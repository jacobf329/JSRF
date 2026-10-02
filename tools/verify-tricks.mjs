// Throws one trick per stick direction with a simulated pad and checks that the
// catalogue fires the right trick AND that the rig actually changes shape --
// a trick that scores but does not move the body is not a trick.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5195, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__pad = {
    index: 0, id: 'Sim (STANDARD GAMEPAD)', connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 0,
  };
  navigator.getGamepads = () => [window.__pad];
});
await page.goto('http://127.0.0.1:5195/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s }, { polling: 'raf', timeout: 120000 });
};
const stick = (x, y) => page.evaluate(([x, y]) => {
  window.__pad.axes[0] = x; window.__pad.axes[1] = -y;   // axis 1 is inverted
  window.__pad.timestamp = performance.now();
}, [x, y]);
const tap = async (i) => {
  await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; window.__pad.timestamp = performance.now(); }, i);
  await gwait(0.09);
  await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; window.__pad.timestamp = performance.now(); }, i);
};

await page.evaluate(() => window.__jsrf.onMenuAction('start'));
await gwait(0.4);
fs.mkdirSync('scratch/tricks', { recursive: true });

// Frame the skater from a fixed angle so the shots are comparable.
const CASES = [
  { dir: [0, 0], button: 0, label: 'neutral' },
  { dir: [0, 1], button: 0, label: 'up' },
  { dir: [0, -1], button: 0, label: 'down' },
  { dir: [-1, 0], button: 0, label: 'left' },
  { dir: [1, 0], button: 0, label: 'right' },
  { dir: [-0.75, 0.75], button: 0, label: 'upLeft' },
  { dir: [0.75, 0.75], button: 0, label: 'upRight' },
  { dir: [-0.75, -0.75], button: 0, label: 'downLeft' },
  { dir: [0.75, -0.75], button: 0, label: 'downRight' },
  { dir: [0, 0], button: 2, label: 'spin (X)' },
];

const rows = [];
for (const c of CASES) {
  await page.evaluate(() => {
    const g = window.__jsrf;
    const p = g.player;
    p.rail = null; p.trick = null; p.trickPoseWeight = 0; p.trickPose = null;
    p.setState('air');
    p.position.set(0, 26, 60);
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    p.airTime = 0.5;
    p.airTricks = 0;
    p.heading = 0;
    g.followCamera.yaw = Math.PI;      // look at the skater from the front
    g.followCamera.pitch = 0.05;
    g.followCamera.manualTimer = 30;
    g.followCamera.reset(p);
  });
  await stick(c.dir[0], c.dir[1]);
  await gwait(0.2);
  await tap(c.button);
  await gwait(0.16);

  const shot = await page.evaluate(() => {
    const g = window.__jsrf;
    const p = g.player;
    const m = g.slots[0].model;
    return {
      trick: p.trick ? p.trick.name : null,
      points: p.trick ? p.trick.points : 0,
      pose: p.trickPose,
      weight: +p.trickPoseWeight.toFixed(2),
      spinTurns: +(p.trickSpin / (Math.PI * 2)).toFixed(2),
      flipTurns: +(p.trickFlip / (Math.PI * 2)).toFixed(2),
      rollTurns: +(p.trickRoll / (Math.PI * 2)).toFixed(2),
      // Proof the rig moved, not just the score.
      armLX: +m.armL.upper.rotation.x.toFixed(2),
      legLThighX: +m.legL.thigh.rotation.x.toFixed(2),
      combo: g.slots[0].score.comboText,
    };
  });
  rows.push({ input: c.label, ...shot });
  await page.screenshot({ path: `scratch/tricks/${c.label.replace(/[^a-z]/gi, '') || 'neutral'}.png` });
  await stick(0, 0);
}

console.log('input        trick            pose        w     spin  flip  roll   armLX  thighX');
for (const r of rows) {
  console.log(
    `${r.input.padEnd(12)} ${(r.trick || 'NONE').padEnd(16)} ${(r.pose || '-').padEnd(11)} ` +
    `${String(r.weight).padEnd(5)} ${String(r.spinTurns).padEnd(5)} ${String(r.flipTurns).padEnd(5)} ` +
    `${String(r.rollTurns).padEnd(6)} ${String(r.armLX).padEnd(6)} ${r.legLThighX}`);
}
console.log('\nlast combo:', rows[rows.length - 1].combo);

// --- the catalogue itself ---------------------------------------------------
const cat = await page.evaluate(async () => {
  const T = await import('/src/player/Tricks.js');
  const { POSES } = await import('/src/player/Poses.js');
  const all = T.allTricks();

  // Every curve has to run 0 -> 1 without meaningfully going backwards: a
  // rotation that dips makes a flip stutter the wrong way mid-air, and one
  // that misses 1 lands on the wrong number of turns.
  const curves = {};
  for (const [name, f] of Object.entries(T.CURVES)) {
    let worst = 0;
    for (let i = 1; i <= 500; i++) worst = Math.min(worst, f(i / 500) - f((i - 1) / 500));
    curves[name] = { start: f(0), end: f(1), worstStep: worst };
  }

  const cw = T.pickAirTrick(1, 0, 2, true);
  const ccw = T.pickAirTrick(-1, 0, 2, true);

  return {
    total: all.length,
    air: Object.values(T.AIR_TRICKS).flat().length,
    grind: Object.values(T.GRIND_TRICKS).flat().length,
    wall: T.WALL_TRICKS.length,
    spin: T.SPIN_TRICKS.length,
    multiKey: all.filter((t) => t.keys.length > 1).length,
    swinging: all.filter((t) => t.swingX || t.swingY || t.swingZ).length,
    everyKeyExists: all.every((t) => t.keys.every((k) => !!POSES[k])),
    everyNamed: all.every((t) => t.name && t.points > 0),
    uniqueIds: new Set(all.map((t) => t.id)).size === all.length,
    uniqueNames: new Set(all.map((t) => t.name)).size === all.length,
    posesUsed: new Set(all.flatMap((t) => t.keys)).size,
    posesDefined: Object.keys(POSES).length,
    curves,
    arcEnds: [T.arc(0), T.arc(1)],
    mirror: { cw: cw.name, ccw: ccw.name, cwSpin: cw.spin, ccwSpin: ccw.spin },
    // Holding a direction and pressing again must give a different trick.
    variants: ['neutral', 'up', 'down', 'left', 'right'].map((d) => {
      const list = T.AIR_TRICKS[d];
      return { d, n: list.length, unique: new Set(list.map((t) => t.id)).size === list.length };
    }),
  };
});

// --- does a move actually travel? ------------------------------------------
// The whole point of a pose sequence is that the body visits several shapes.
// Sample the rig through one long multi-key trick and one single-key stance
// and compare how far the joints move.
const travel = await page.evaluate(async () => {
  const g = window.__jsrf;
  const T = await import('/src/player/Tricks.js');
  const p = g.player;
  const m = g.slots[0].model;

  const joints = () => [
    m.armL.upper.rotation.x, m.armL.upper.rotation.z, m.armL.lower.rotation.x,
    m.armR.upper.rotation.x, m.armR.upper.rotation.z, m.armR.lower.rotation.x,
    m.legL.thigh.rotation.x, m.legL.shin.rotation.x,
    m.legR.thigh.rotation.x, m.legR.shin.rotation.x,
    m.body.rotation.x, m.body.rotation.z, m.hips.position.y,
  ];

  // Total distance the joints travel across a trick, and the end-state spin.
  const run = (trick) => {
    p.setState('air');
    p.position.set(0, 60, 60);
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    p.trick = trick;
    p.trickDuration = trick.duration || 0.5;
    p.trickTimer = p.trickDuration;
    p.trickPoseWeight = 0;

    let distance = 0;
    let prev = null;
    const shapes = [];
    const steps = 60;
    for (let i = 0; i < steps; i++) {
      p._updateTrickAnimation(p.trickDuration / steps);
      m.update(1 / 60, p);
      const j = joints();
      if (prev) for (let k = 0; k < j.length; k++) distance += Math.abs(j[k] - prev[k]);
      prev = j.slice();
      if (i % 12 === 0) shapes.push(p.trickPose);
      if (!p.trick) break;
    }
    return {
      distance: +distance.toFixed(2),
      shapes,
      // Everything must be back on its axis when the trick ends.
      endSpin: +(p.trickSpin / (Math.PI * 2)).toFixed(4),
      endFlip: +(p.trickFlip / (Math.PI * 2)).toFixed(4),
      endRoll: +(p.trickRoll / (Math.PI * 2)).toFixed(4),
    };
  };

  const all = T.allTricks();
  const held = run(all.find((t) => t.id === 'tuckknee'));
  const moved = run(all.find((t) => t.id === 'mctwist'));

  // A trick with swing must still land on exactly its stated turns: the swing
  // is amplitude that comes back, not rotation that counts.
  const swung = all.find((t) => t.id === 'tailwhip');
  p.trick = swung;
  p.trickDuration = swung.duration;
  p.trickTimer = swung.duration;
  let mid = 0;
  for (let i = 0; i < 60; i++) {
    p._updateTrickAnimation(swung.duration / 60);
    if (i === 30) mid = p.trickRoll;
    if (!p.trick) break;
  }

  return { held, moved, swing: { mid: +mid.toFixed(3), amplitude: swung.swingZ } };
});

console.log('\n' + JSON.stringify({ cat, travel }, null, 2));

const distinct = new Set(rows.map((r) => r.trick));
const curveList = Object.entries(cat.curves);

const ok = {
  everyDirectionFires: rows.every((r) => r.trick) && distinct.size >= 9,
  everyDirectionPoses: rows.every((r) => r.weight > 0.4),

  catalogueIsLarge: cat.total >= 100,
  everyKeyResolves: cat.everyKeyExists,
  everyTrickNamedAndScored: cat.everyNamed,
  noDuplicateTricks: cat.uniqueIds && cat.uniqueNames,
  mostTricksAreMoves: cat.multiKey >= cat.total * 0.6,
  plentyOfSwing: cat.swinging >= 40,
  everyDirectionHasVariants: cat.variants.every((v) => v.n >= 3 && v.unique),

  curvesStartAtZero: curveList.every(([, c]) => Math.abs(c.start) < 1e-9),
  // A curve that misses 1 lands the trick on the wrong number of turns.
  curvesEndAtOne: curveList.every(([, c]) => Math.abs(c.end - 1) < 1e-9),
  curvesNeverStutter: curveList.every(([, c]) => c.worstStep > -0.01),
  swingReturnsToZero: Math.abs(cat.arcEnds[0]) < 1e-9 && Math.abs(cat.arcEnds[1]) < 1e-9,

  spinsMirror: cat.mirror.cwSpin === -cat.mirror.ccwSpin && cat.mirror.ccw !== cat.mirror.cw,

  // A multi-key trick has to move the body a lot further than a held shape,
  // and visit more than one of them on the way.
  movesTravelFurtherThanStances: travel.moved.distance > travel.held.distance * 1.5,
  movesVisitSeveralShapes: new Set(travel.moved.shapes).size >= 3,
  swingPeaksMidTrick: Math.abs(travel.swing.mid) > Math.abs(travel.swing.amplitude) * 0.5,
  tricksLandOnAxis: [travel.moved.endFlip, travel.moved.endSpin, travel.moved.endRoll]
    .every((v) => Math.abs(v - Math.round(v)) < 0.02),
};
console.log('\n--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
