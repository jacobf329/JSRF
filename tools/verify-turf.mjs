// Checks the turf war: rivals actually reach walls and paint them, the map
// changes hands, a player can take a rival's wall back, and body-checking a
// rival mid-spray costs them it.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5194, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5194/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s }, { polling: 'raf', timeout: 180000 });
};

await page.evaluate(() => window.__jsrf.onMenuAction('start'));
await gwait(0.4);

const setup = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    gangs: g.mission.standings.map((r) => `${r.short}:${r.human ? 'P' : 'CPU'}`),
    rivals: g.rivals.list.length,
    playerGang: g.slots[0].gang.short,
    walls: g.graffiti.totalCount,
    duration: g.mission.duration,
  };
});

// Rivals start scattered across five districts; give them long enough to cross
// to a wall, climb it and finish a piece.
const samples = [];
for (let i = 0; i < 8; i++) {
  await gwait(6);
  samples.push(await page.evaluate(() => {
    const g = window.__jsrf;
    return {
      t: +g.mission.elapsed.toFixed(1),
      owned: g.graffiti.totalCount - g.graffiti.unclaimed,
      states: g.rivals.list.map((r) => r.state).join(','),
      moved: g.rivals.list.map((r) => Math.round(r.position.length())).join(','),
    };
  }));
}

// Park the camera on a wall a rival has taken, so the shot shows their colours
// on the wall, their beacon over it and the crew strip in the corner.
fs.mkdirSync('scratch/turf', { recursive: true });
await page.evaluate(() => {
  const g = window.__jsrf;
  const spot = g.graffiti.spots.find((s) => s.owner) || g.graffiti.spots[0];
  const p = g.player;
  p.rail = null; p.trick = null;
  p.setState('air');
  p.position.copy(spot.data.position).addScaledVector(spot.data.normal, 7);
  p.position.y = spot.data.position.y;
  p.velocity.set(0, 0, 0);
  p.heading = Math.atan2(-spot.data.normal.x, -spot.data.normal.z);
  g.followCamera.reset(p);
});
await gwait(1.2);
await page.screenshot({ path: 'scratch/turf/wall.png' });

const afterRoam = await page.evaluate(() => {
  const g = window.__jsrf;
  const byGang = {};
  for (const r of g.mission.standings) byGang[r.short] = r.walls;
  return {
    byGang,
    unclaimed: g.graffiti.unclaimed,
    sprayed: g.rivals.list.filter((r) => r.state === 'spray').length,
    reached: g.rivals.list.filter((r) => r.walls > 0 || r.state === 'spray' || r.state === 'rest').length,
  };
});

// --- a player takes a rival's wall back -------------------------------------
const steal = await page.evaluate(async () => {
  const g = window.__jsrf;
  const spot = g.graffiti.spots.find((s) => s.owner && s.owner !== g.slots[0].gang);
  if (!spot) return { skipped: true };
  const before = spot.owner.short;
  const gang = g.slots[0].gang;
  // Drive the same entry point the spray button drives, then run the session
  // out by hand rather than faking stick flicks for a whole sequence.
  const started = g.graffiti.begin(spot, g.player, gang);
  const session = g.graffiti.sessionFor(g.player);
  const steps = session ? session.sequence.length : 0;
  const previousKept = !!(session && session.previous);
  if (session) {
    for (const dir of session.sequence) {
      session.index++;
      session.targetProgress = session.index / session.sequence.length;
    }
    g.graffiti._complete(g.player);
  }
  return {
    started, steps, previousKept, before,
    nowMine: spot.owner === gang,
    tags: g.slots[0].tags,
    steals: g.slots[0].steals,
    score: Math.round(g.slots[0].score.combo),
  };
});

// A wall a crew already holds must not be re-paintable by that same crew.
const relock = await page.evaluate(() => {
  const g = window.__jsrf;
  const gang = g.slots[0].gang;
  const mine = g.graffiti.spots.find((s) => s.owner === gang);
  if (!mine) return { skipped: true };
  return {
    refusedBegin: g.graffiti.begin(mine, g.player, gang) === false,
    notOffered: g.graffiti.findNearby({ position: mine.data.position }, gang, 40) !== mine,
  };
});

// --- body-checking a rival mid-spray ---------------------------------------
const check = await page.evaluate(async () => {
  const g = window.__jsrf;
  const rival = g.rivals.list[0];
  const spot = g.graffiti.spots.find((s) => !s.owner);
  if (!rival || !spot) return { skipped: true };

  // Put them on a wall by hand so the test does not wait on the roam.
  g.graffiti.cancel(rival);
  rival.spot = spot;
  rival.anchor.copy(spot.data.position).addScaledVector(spot.data.normal, 1.15);
  rival.position.copy(rival.anchor);
  rival._begin({ graffiti: g.graffiti, difficulty: 1 });
  const painting = !!g.graffiti.sessionFor(rival);

  const before = Math.round(g.slots[0].score.combo);
  const p = g.player;
  p.position.copy(rival.position);
  p.velocity.set(0, 0, 20);
  p.speed = p.velocity.length();   // the controller caches it each frame
  g.rivals._bodyChecks(rival, g);

  return {
    painting,
    stunned: rival.state === 'stun',
    sessionDropped: !g.graffiti.sessionFor(rival),
    wallStillFree: !spot.owner,
    scored: Math.round(g.slots[0].score.combo) > before,
  };
});

// --- the clock ends the run -------------------------------------------------
const clock = await page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ reason, stats }) => { ended = { reason, winner: stats.winner.short }; });
  g.mission.timeLeft = 0.05;
  await new Promise((r) => setTimeout(r, 400));
  return { ended, mode: g.mode };
});

await page.screenshot({ path: 'scratch/turf/results.png' });

console.log(JSON.stringify({ setup, samples, afterRoam, steal, relock, check, clock }, null, 2));

const rivalWalls = Object.entries(afterRoam.byGang)
  .filter(([k]) => k !== setup.playerGang)
  .reduce((a, [, v]) => a + v, 0);

// Extrapolate the unopposed pace over a whole run. Three rivals should be on
// course for roughly half the map: enough that ignoring them loses the run,
// not so much that they have taken it before a player can cross the city.
const span = samples[samples.length - 1].t - samples[0].t;
const rate = (samples[samples.length - 1].owned - samples[0].owned) / Math.max(1, span);
const projected = Math.round(rate * setup.duration);
console.log(`\nunopposed pace: ${rate.toFixed(3)} walls/s -> ~${projected} of ${setup.walls} walls in a ${setup.duration}s run`);

const ok = {
  aiFillsEmptySeats: setup.rivals === 3 && setup.gangs.filter((g) => g.endsWith('CPU')).length === 3,
  rivalsGetToWalls: afterRoam.reached >= 2,
  rivalsPaintWalls: rivalWalls >= 2,
  mapChangesHands: samples[samples.length - 1].owned > samples[0].owned,
  takeoverCostsAnExtraStep: !steal.skipped && steal.started && steal.steps >= 4,
  losingTagStaysUpUntilFinished: !steal.skipped && steal.previousKept,
  takeoverFlipsOwner: !steal.skipped && steal.nowMine && steal.steals === 1,
  ownWallsAreLocked: !relock.skipped && relock.refusedBegin && relock.notOffered,
  bodyCheckStunsRival: !check.skipped && check.painting && check.stunned,
  bodyCheckCostsThemTheWall: !check.skipped && check.sessionDropped && check.wallStillFree,
  bodyCheckPays: !check.skipped && check.scored,
  paceIsCompetitive: projected >= 20 && projected <= 48,
  clockEndsTheRun: !!clock.ended && clock.ended.reason === 'time' && clock.mode === 'results',
};
console.log('\n--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 6)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
