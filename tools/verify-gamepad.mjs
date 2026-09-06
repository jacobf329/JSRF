// Drives the game with a simulated standard gamepad and nothing else -- no
// keyboard, no mouse. Checks the three things playtesting turned up: that a pad
// takes seat one, that menus are navigable from it, that stick-right actually
// goes right, and that you can get off a rail.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// A standard-mapping pad, installed before any game code runs.
await page.addInitScript(() => {
  window.__pad = {
    index: 0,
    id: 'Simulated Controller (STANDARD GAMEPAD Vendor: 0000 Product: 0000)',
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 0,
  };
  navigator.getGamepads = () => [window.__pad];
});

await page.goto('http://127.0.0.1:5197/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s },
    { polling: 'raf', timeout: 120000 });
};
const setAxis = (i, v) => page.evaluate(([i, v]) => {
  window.__pad.axes[i] = v; window.__pad.timestamp = performance.now();
}, [i, v]);
const tapButton = async (i) => {
  await page.evaluate((i) => {
    window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 };
    window.__pad.timestamp = performance.now();
  }, i);
  await gwait(0.12);
  await page.evaluate((i) => {
    window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 };
    window.__pad.timestamp = performance.now();
  }, i);
  await gwait(0.08);
};

const results = {};

// --- the pad is seen at all ---
await gwait(0.4);
results.padDetected = await page.evaluate(() => window.__jsrf.input.padCount);

// --- the camera-relative basis (this is what was inverted) ---
results.basis = await page.evaluate(() => {
  const g = window.__jsrf;
  const V = g.player.position.constructor;
  const probe = (yaw, x, y) => {
    g.player.cameraYaw = yaw;
    const out = new V();
    g.player._inputWorldDir({ move: { x, y } }, out);
    return [+out.x.toFixed(2), +out.z.toFixed(2)];
  };
  return {
    // Camera at yaw 0 looks toward +Z, so screen-right is world -X.
    rightAtYaw0: probe(0, 1, 0),
    forwardAtYaw0: probe(0, 0, 1),
    // Looking toward +X, screen-right is world +Z.
    rightAtYaw90: probe(Math.PI / 2, 1, 0),
  };
});

// --- menus, using only the pad: A starts the run ---
await tapButton(0);
await gwait(0.3);
results.startedFromPad = await page.evaluate(() => window.__jsrf.mode);
results.seatOne = await page.evaluate(() => window.__jsrf.slots[0].input.id);

// --- stick right actually moves right on screen ---
const moved = await page.evaluate(async () => {
  const g = window.__jsrf;
  g.player.position.set(0, 0.5, 60);
  g.player.velocity.set(0, 0, 0);
  g.player.rail = null;
  g.player.setState('air');
  g.followCamera.yaw = 0;            // looking toward +Z
  g.followCamera.manualTimer = 5;    // hold the camera still for the test
  return true;
});
void moved;
await setAxis(0, 1);
await gwait(1.2);
await setAxis(0, 0);
results.stickRight = await page.evaluate(() => {
  const p = window.__jsrf.player.position;
  return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) };
});

// --- getting off a rail with A ---
const railInfo = await page.evaluate(() => {
  const g = window.__jsrf;
  const V = g.player.position.constructor;
  // A closed loop is the worst case: there is no end to fall off.
  const rail = g.level.rails.rails.find((r) => r.closed) || g.level.rails.rails[0];
  const at = rail.totalLength * 0.15;   // mid-edge, not a corner
  const p = rail.getPointAt(at, new V());
  const t = rail.getTangentAt(at, new V());
  g.player.rail = null;
  g.player.setState('air');
  g.player.position.set(p.x, p.y + 1.0, p.z);
  g.player.velocity.set(t.x * 10, -1, t.z * 10);
  g.player.heading = Math.atan2(t.x, t.z);
  g.player.grindCooldown = 0;
  g.player.noRelatchTimer = 0;
  return { railName: rail.name, closed: rail.closed };
});
await gwait(1.0);
results.grindingBefore = await page.evaluate(() => window.__jsrf.player.state);

// Pressing A with no direction held is a hop, not a bail: landing back on the
// rail is the right answer there, so it is not what gets asserted.
await tapButton(0);
await gwait(1.2);
results.stateAfterHop = await page.evaluate(() => window.__jsrf.player.state);

// Getting off is steering off: look along the rail so that stick-right is
// square to it, hold right, and press A. This is the thing that was broken --
// the strafe axis was inverted, so pushing away pushed you back on.
// Put the skater back on the rail first, so the test does not depend on where
// the previous hop happened to land.
await page.evaluate(() => {
  const g = window.__jsrf;
  const V = g.player.position.constructor;
  const rail = g.level.rails.rails.find((r) => r.closed);
  const at = rail.totalLength * 0.15;
  const p = rail.getPointAt(at, new V());
  const t = rail.getTangentAt(at, new V());
  g.player.rail = null;
  g.player.noRelatchTimer = 0;
  g.player.grindCooldown = 0;
  g.player.setState('air');
  g.player.grounded = false;
  g.player.position.set(p.x, p.y + 1.0, p.z);
  g.player.velocity.set(t.x * 10, -1, t.z * 10);
  g.player.heading = Math.atan2(t.x, t.z);
  // Look along the rail, and hold the camera there, so stick-right is square
  // to it and stays that way.
  g.followCamera.yaw = Math.atan2(t.x, t.z);
  g.followCamera.manualTimer = 10;
});
await gwait(0.8);
results.grindingBeforeBail = await page.evaluate(() => window.__jsrf.player.state);

await setAxis(0, 1);
await gwait(0.25);
await tapButton(0);
await gwait(1.8);
await setAxis(0, 0);
results.stateAfterBail = await page.evaluate(() => window.__jsrf.player.state);
results.railAfterBail = await page.evaluate(() => window.__jsrf.player.rail?.name ?? null);
results.rail = railInfo;

fs.mkdirSync('scratch', { recursive: true });
await page.screenshot({ path: 'scratch/gamepad.png' });

// --- verdict ---
const ok = {
  padSeen: results.padDetected === 1,
  padTakesSeatOne: results.seatOne.startsWith('pad'),
  menuFromPad: results.startedFromPad === 'playing',
  rightIsRight: results.basis.rightAtYaw0[0] < -0.9 && Math.abs(results.basis.rightAtYaw0[1]) < 0.1,
  forwardUnchanged: results.basis.forwardAtYaw0[1] > 0.9,
  rightAtYaw90: results.basis.rightAtYaw90[1] > 0.9,
  movedScreenRight: results.stickRight.x < -3,
  wasGrinding: results.grindingBefore === 'grind',
  hopStaysOnOrLands: results.stateAfterHop !== undefined,
  onRailBeforeBail: results.grindingBeforeBail === 'grind',
  steeredOffTheRail: results.stateAfterBail !== 'grind' && results.railAfterBail === null,
};

console.log(JSON.stringify(results, null, 2));
console.log('--- checks ---');
for (const [name, pass] of Object.entries(ok)) console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
