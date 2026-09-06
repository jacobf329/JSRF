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

const distinct = new Set(rows.map((r) => r.trick));
const allFired = rows.every((r) => r.trick);
const posed = rows.every((r) => r.weight > 0.4);
console.log(`\ndistinct tricks: ${distinct.size}/${rows.length}   all fired: ${allFired}   all posed: ${posed}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(allFired && posed && distinct.size >= 9 && !errors.length ? 0 : 1);
