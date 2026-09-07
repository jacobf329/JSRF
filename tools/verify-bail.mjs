// Checks that a run can now be failed: landing mid-trick wipes out and costs
// the chain, finishing one pays, aborting saves it, and a rail held too long
// throws you off.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5193, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
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
await page.goto('http://127.0.0.1:5193/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s }, { polling: 'raf', timeout: 120000 });
};
const tap = async (i) => {
  await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; window.__pad.timestamp = performance.now(); }, i);
  await gwait(0.08);
  await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; window.__pad.timestamp = performance.now(); }, i);
};
// Drop the skater in with a stocked combo, so what a bail costs is visible.
const airborneAt = (height, combo) => page.evaluate(([height, combo]) => {
  const g = window.__jsrf;
  const p = g.player;
  p.rail = null; p.trick = null; p.trickPoseWeight = 0;
  p.setState('air');
  p.position.set(0, height, 60);
  p.velocity.set(0, 0, 0);
  p.grounded = false;
  p.airTime = 0.5;
  p.airTricks = 0;
  const s = g.slots[0].score;
  s.comboActive = true; s.combo = combo; s.multiplier = 4; s.comboTricks = ['SETUP'];
}, [height, combo]);

await page.evaluate(() => window.__jsrf.onMenuAction('start'));
await gwait(0.5);

// A bail is over in about a second, so sampling the state later reports the
// recovery rather than the wipeout. Record the events instead.
await page.evaluate(() => {
  window.__bails = [];
  window.__jsrf.events.on('player:bail', (e) => window.__bails.push(e.reason));
});
const bailsSoFar = () => page.evaluate(() => window.__bails.length);
const results = {};

// --- 1. thrown too low to finish: wipeout, chain gone ---
await airborneAt(1.0, 5000);
await tap(0);
await gwait(1.6);
results.tooLow = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    bails: window.__bails.length,
    reason: window.__bails[0] || null,
    combo: Math.round(g.slots[0].score.combo),
    active: g.slots[0].score.comboActive,
  };
});

// --- 2. enough height to finish: clean landing, points paid ---
await gwait(1.4);
await airborneAt(14, 0);
await tap(0);
await gwait(2.4);
results.clean = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    bails: window.__bails.length,
    state: g.player.state,
    combo: Math.round(g.slots[0].score.combo),
    active: g.slots[0].score.comboActive,
  };
});

// --- 3. cash out with B before touchdown ---
await gwait(1.2);
await airborneAt(1.2, 0);
await tap(0);
await gwait(0.06);
await tap(1);              // B
await gwait(1.6);
results.aborted = await page.evaluate(() => {
  const g = window.__jsrf;
  return { bails: window.__bails.length, state: g.player.state, combo: Math.round(g.slots[0].score.combo) };
});

// --- 4. sit on one grind stance and lose it ---
await gwait(1.2);
await page.evaluate(() => {
  const g = window.__jsrf;
  const V = g.player.position.constructor;
  const rail = g.level.rails.rails.find((r) => r.closed);
  const at = rail.totalLength * 0.15;
  const p = rail.getPointAt(at, new V());
  const t = rail.getTangentAt(at, new V());
  g.player.rail = null; g.player.noRelatchTimer = 0; g.player.grindCooldown = 0;
  g.player.setState('air'); g.player.grounded = false;
  g.player.position.set(p.x, p.y + 1.0, p.z);
  g.player.velocity.set(t.x * 10, -1, t.z * 10);
  g.player.heading = Math.atan2(t.x, t.z);
});
await gwait(0.8);
const bailsBeforeGrind = await bailsSoFar();
const grindStart = await page.evaluate(() => ({
  state: window.__jsrf.player.state,
  stability: +window.__jsrf.player.grindStability.toFixed(2),
}));
await gwait(2.0);
const grindMid = await page.evaluate(() => +window.__jsrf.player.grindStability.toFixed(2));
await gwait(3.5);
results.grind = {
  start: grindStart,
  midStability: grindMid,
  bailed: (await bailsSoFar()) > bailsBeforeGrind,
  reasons: await page.evaluate(() => window.__bails),
};

fs.mkdirSync('scratch', { recursive: true });
await page.screenshot({ path: 'scratch/bail.png' });

console.log(JSON.stringify(results, null, 2));
const ok = {
  wipesOutWhenTooLow: results.tooLow.bails === 1 && results.tooLow.reason === 'BLEW THE LANDING',
  chainLost: results.tooLow.combo === 0 && results.tooLow.active === false,
  cleanLandingDoesNotBail: results.clean.bails === 1,
  cleanLandingPays: results.clean.combo > 0,
  abortSavesTheLanding: results.aborted.bails === 1,
  abortStillPays: results.aborted.combo > 0,
  grindStarted: results.grind.start.state === 'grind',
  stabilityDrains: results.grind.midStability < results.grind.start.stability,
  railThrowsYouOff: results.grind.bailed && results.grind.reasons.includes('LOST THE RAIL'),
};
console.log('--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
