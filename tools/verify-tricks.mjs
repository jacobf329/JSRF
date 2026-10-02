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
    const weights = [];
    const steps = 60;
    // The rotation has to be read on the last frame the trick is still live.
    // Sampling after completion reads whatever the idle branch has damped it
    // to, which made this check pass without testing anything.
    let last = { spin: 0, flip: 0, roll: 0 };
    for (let i = 0; i < steps; i++) {
      p._updateTrickAnimation(p.trickDuration / steps);
      m.update(1 / 60, p);
      const j = joints();
      if (prev) for (let k = 0; k < j.length; k++) distance += Math.abs(j[k] - prev[k]);
      prev = j.slice();
      if (i % 12 === 0) shapes.push(p.trickPose);
      // How strongly the closing key ever actually gets applied. It is always
      // the *next* key of the pair, never the current one -- the key index is
      // clamped so the pair's first slot stops at the second-to-last shape.
      if (p.trick && p.trickPoseNext === trick.keys[trick.keys.length - 1]) {
        weights.push(p.trickPoseWeight * p.trickPoseMix);
      }
      if (!p.trick) break;
      last = {
        spin: p.trickSpin / (Math.PI * 2),
        flip: p.trickFlip / (Math.PI * 2),
        roll: p.trickRoll / (Math.PI * 2),
      };
    }
    return {
      distance: +distance.toFixed(2),
      shapes,
      // Everything must be back on its stated whole/half turn as it ends.
      endSpin: +last.spin.toFixed(4),
      endFlip: +last.flip.toFixed(4),
      endRoll: +last.roll.toFixed(4),
      lastKeyWeight: +Math.max(0, ...weights).toFixed(3),
      wanted: { spin: trick.spin, flip: trick.flip, roll: trick.roll },
    };
  };

  const all = T.allTricks();
  const held = run(all.find((t) => t.id === 'tuckknee'));
  const moved = run(all.find((t) => t.id === 'mctwist'));
  // A five-key trick is where the release used to swallow the closing shape.
  const long = run(all.find((t) => t.keys.length >= 5) || all.find((t) => t.id === 'mctwist'));

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

  // --- no snap, in isolation or when chained.
  //
  // A half-turn trick ends half a turn round. Hard-zeroing that on the
  // completion frame popped the body 180 degrees in one frame, and starting
  // the next trick from zero popped whatever was still unwinding.
  //
  // The property that catches both without flagging legitimately fast moves:
  // once a trick is over, the body must never turn further in a frame than it
  // did at any point during the trick. A 2.5-turn McTwist genuinely moves 48
  // degrees in a frame and that is fine; the settle afterwards decelerating
  // from it is fine; a single frame that outruns the trick itself is a snap.
  // Budgets are per trick, not pooled: pooled, cork1080's 54 degrees a frame
  // sets the allowance for every other trick in the catalogue and a slow one
  // can snap freely inside it.
  const offenders = [];
  let worstRatio = 0;
  let worstTrick = null;
  const halfTurn = all.filter((x) => x.kind === 'air'
    && [x.spin, x.flip, x.roll].some((v) => Math.abs(v - Math.round(v)) > 0.01));

  const wrap = (a) => { let d = a % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d <= -Math.PI) d += Math.PI * 2; return d; };

  const reset = () => {
    p.setState('air');
    p.grounded = false;
    p.trick = null;
    p.trickSpin = 0; p.trickFlip = 0; p.trickRoll = 0;
    p.trickCarry = { spin: 0, flip: 0, roll: 0 };
    for (const a of ['spin', 'flip', 'roll']) { p.trickSettle[a].value = 0; p.trickSettle[a].velocity = 0; }
  };

  // One trick, then enough idle frames for the settle to run out.
  const measure = (t, seed) => {
    reset();
    if (seed) {
      // Leave the rig mid-unwind, the way a chained trick finds it.
      p.trickSpin = seed; p.trickFlip = seed; p.trickRoll = seed;
    }
    p.trickCarry.spin = wrap(p.trickSpin);
    p.trickCarry.flip = wrap(p.trickFlip);
    p.trickCarry.roll = wrap(p.trickRoll);
    p.trick = t;
    p.trickDuration = t.duration || 0.5;
    p.trickTimer = p.trickDuration;

    let during = 0;
    let after = 0;
    let prev = [p.trickSpin, p.trickFlip, p.trickRoll];
    const frames = Math.ceil(p.trickDuration * 60) + 60;
    for (let i = 0; i < frames; i++) {
      const wasLive = !!p.trick;
      p._updateTrickAnimation(1 / 60);
      const now = [p.trickSpin, p.trickFlip, p.trickRoll];
      for (let k = 0; k < 3; k++) {
        // Shortest path between the two orientations, not the raw difference:
        // taking three whole turns out of a leftover changes the number by
        // 6*pi and the picture by nothing at all. The hand-off frame counts.
        const step = Math.abs(wrap(now[k] - prev[k]));
        if (wasLive) during = Math.max(during, step);
        else after = Math.max(after, step);
      }
      prev = now;
    }
    // Allow a floor, or a trick that barely rotates fails on its own settle.
    const budget = Math.max(during, 0.2);
    const ratio = after / budget;
    if (ratio > worstRatio) { worstRatio = ratio; worstTrick = `${t.id}${seed ? ' (chained)' : ''}`; }
    if (ratio > 1) offenders.push({ id: t.id, chained: !!seed, during: +during.toFixed(3), after: +after.toFixed(3) });
  };

  for (const t of halfTurn) {
    measure(t, 0);
    // And again starting from an unwinding half turn, which is the state a
    // trick thrown straight after a 540 actually begins in.
    measure(t, Math.PI * 0.9);
  }

  // Aborting mid-trick and wiping out are both exits the completion path does
  // not cover, and both used to zero the rotation outright.
  const exitJumps = {};
  for (const [name, exit] of [
    ['abort', () => p._abortTrick()],
    ['bail', () => p._bail('TEST')],
  ]) {
    reset();
    const t = all.find((x) => x.id === 'spin540');
    p.trick = t;
    p.trickDuration = t.duration;
    p.trickTimer = t.duration;
    // Same relative property as a completed trick: carrying on at the speed
    // it was already turning is continuous, not a snap. The threshold has to
    // be the trick's own rate, because it is aborted at its fastest.
    let during = 0;
    let prev = [p.trickSpin, p.trickFlip, p.trickRoll];
    for (let i = 0; i < 24; i++) {
      p._updateTrickAnimation(1 / 60);
      const now = [p.trickSpin, p.trickFlip, p.trickRoll];
      for (let k = 0; k < 3; k++) during = Math.max(during, Math.abs(wrap(now[k] - prev[k])));
      prev = now;
    }
    const before = [p.trickSpin, p.trickFlip, p.trickRoll];
    exit();
    p.state = 'air';
    let after = 0;
    let last = before;
    for (let i = 0; i < 30; i++) {
      p._updateTrickAnimation(1 / 60);
      const now = [p.trickSpin, p.trickFlip, p.trickRoll];
      for (let k = 0; k < 3; k++) after = Math.max(after, Math.abs(wrap(now[k] - last[k])));
      last = now;
    }
    exitJumps[name] = { during: +during.toFixed(3), after: +after.toFixed(3), ratio: +(after / Math.max(during, 0.2)).toFixed(3) };
  }

  // --- no pose channel may latch.
  //
  // The locomotion pass is the only thing that returns a joint to rest: the
  // overlay lerps toward a target and stops, so a channel nothing else writes
  // keeps whatever the last trick left in it forever. Rather than spot-check
  // the one that broke, drive every channel in the canonical list on its own
  // and watch all of them come back.
  const { POSE_CHANNELS, POSES } = await import('/src/player/Poses.js');
  const readers = {
    hips: () => 0.92 - m.hips.position.y,
    spineX: () => m.body.rotation.x, spineY: () => m.body.rotation.y, spineZ: () => m.body.rotation.z,
    neckX: () => m.neck.rotation.x, neckY: () => m.neck.rotation.y,
    armLX: () => m.armL.upper.rotation.x, armLY: () => m.armL.upper.rotation.y,
    armLZ: () => m.armL.upper.rotation.z, armLLower: () => m.armL.lower.rotation.x,
    armRX: () => m.armR.upper.rotation.x, armRY: () => m.armR.upper.rotation.y,
    armRZ: () => m.armR.upper.rotation.z, armRLower: () => m.armR.lower.rotation.x,
    legLThighX: () => m.legL.thigh.rotation.x, legLThighY: () => m.legL.thigh.rotation.y,
    legLThighZ: () => m.legL.thigh.rotation.z, legLShin: () => m.legL.shin.rotation.x,
    legLFoot: () => m.legL.foot.rotation.x,
    legRThighX: () => m.legR.thigh.rotation.x, legRThighY: () => m.legR.thigh.rotation.y,
    legRThighZ: () => m.legR.thigh.rotation.z, legRShin: () => m.legR.shin.rotation.x,
    legRFoot: () => m.legR.foot.rotation.x,
  };

  p.trick = null;
  p.trickSpin = 0; p.trickFlip = 0; p.trickRoll = 0;
  for (const a of ['spin', 'flip', 'roll']) { p.trickSettle[a].value = 0; p.trickSettle[a].velocity = 0; }
  p.state = 'skate';
  p.grounded = true;

  const channels = [];
  for (const channel of POSE_CHANNELS) {
    const read = readers[channel];
    if (!read) { channels.push({ channel, applied: false, rest: null, missingReader: true }); continue; }

    // Most of these channels are driven by the skating stride, so "rest" is a
    // band, not a value. Measure the band over a few full cycles first, then
    // check the channel comes back inside it -- comparing against a single
    // sample just compares two different phases of the same walk.
    p.trickPose = null; p.trickPoseNext = null; p.trickPoseWeight = 0;
    for (let i = 0; i < 180; i++) m.update(1 / 60, p);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 240; i++) {
      m.update(1 / 60, p);
      const v = read();
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const pad = Math.max(0.03, (hi - lo) * 0.2);

    // A pose with exactly one channel in it, injected the way a trick would.
    POSES.__probe = { [channel]: channel === 'hips' ? 0.3 : 0.8 };
    p.trickPose = '__probe'; p.trickPoseNext = '__probe';
    p.trickPoseMix = 0; p.trickPoseWeight = 1;
    for (let i = 0; i < 60; i++) m.update(1 / 60, p);
    const held = read();

    p.trickPose = null; p.trickPoseNext = null; p.trickPoseWeight = 0;
    for (let i = 0; i < 300; i++) m.update(1 / 60, p);
    const after = read();

    channels.push({
      channel,
      applied: held < lo - pad || held > hi + pad,
      returned: after >= lo - pad && after <= hi + pad,
      band: [+lo.toFixed(3), +hi.toFixed(3)],
      held: +held.toFixed(3), after: +after.toFixed(3),
    });
  }
  delete POSES.__probe;

  // No pose may use a channel the canonical list does not know about.
  const known = new Set(POSE_CHANNELS);
  const strays = [];
  for (const [name, pose] of Object.entries(POSES)) {
    for (const key of Object.keys(pose)) if (!known.has(key)) strays.push(`${name}.${key}`);
  }

  return {
    held, moved, long,
    swing: { mid: +mid.toFixed(3), amplitude: swung.swingZ },
    worstRatio: +worstRatio.toFixed(3), worstTrick, offenders, exitJumps,
    channels, strays,
  };
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
  // Read on the trick's last live frame: it must land on exactly the turns it
  // claims, which is what proves the swing came back and the curve ended at 1.
  tricksLandOnTheirStatedTurns:
    Math.abs(travel.moved.endFlip - travel.moved.wanted.flip) < 0.02
    && Math.abs(travel.moved.endSpin - travel.moved.wanted.spin) < 0.02
    && Math.abs(travel.moved.endRoll - travel.moved.wanted.roll) < 0.02,
  // The closing key has to be applied at real strength, not as the pose fades.
  longTricksReachTheirLastShape: travel.long.lastKeyWeight > 0.8,
  // Per trick: once it is over, the body must never turn further in a frame
  // than it did during it. Measured alone and mid-unwind from a previous one.
  rotationNeverSnapsAfterATrick: travel.offenders.length === 0,
  // Pressing B to cash out, and wiping out, are exits of their own.
  abortDoesNotSnap: travel.exitJumps.abort.ratio <= 1,
  bailDoesNotSnap: travel.exitJumps.bail.ratio <= 1,
  everyPoseChannelIsApplied: travel.channels.every((c) => c.applied),
  everyPoseChannelReturnsToRest: travel.channels.every((c) => c.returned),
  noPoseUsesAnUnknownChannel: travel.strays.length === 0,
};
console.log('\n--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
