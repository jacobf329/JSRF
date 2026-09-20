// Checks the mission engine and the progression around it: each run type
// scores the thing it claims to score, a district mission really is confined
// to its district, medals land on the right side of their thresholds, and
// clearing a mission opens the next chapter.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5196, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5196/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s }, { polling: 'raf', timeout: 180000 });
};

// --- the roster actually changes handling --------------------------------
const roster = await page.evaluate(() => {
  const g = window.__jsrf;
  const { RUDIES, skaterConfigFor, traitsFor } = g.__rudies;
  const of = (id) => {
    const r = RUDIES.find((x) => x.id === id);
    return { c: skaterConfigFor(r), t: traitsFor(r) };
  };
  const gum = of('gum');
  const yoyo = of('yoyo');
  const combo = of('combo');
  const beat = of('beat');
  return {
    names: RUDIES.map((r) => r.id),
    gumFaster: gum.c.maxSpeed > beat.c.maxSpeed && beat.c.maxSpeed > yoyo.c.maxSpeed,
    yoyoPaysMore: yoyo.t.trickPoints > beat.t.trickPoints && beat.t.trickPoints > combo.t.trickPoints,
    yoyoHoldsRails: yoyo.c.grindStabilityTime > combo.c.grindStabilityTime,
    comboHitsEasier: combo.t.checkSpeed < gum.t.checkSpeed,
    everybodySane: RUDIES.every((r) => {
      const c = skaterConfigFor(r);
      return c.maxSpeed > 10 && c.maxSpeed < 30 && c.jumpSpeed > 9 && c.trickTime > 0.2;
    }),
  };
});

// A seat can actually swap rudie mid-session without losing its camera or HUD.
const swap = await page.evaluate(() => {
  const g = window.__jsrf;
  const before = g.slots[0].player;
  g.onMenuAction('rudie', 'gum');
  const after = g.slots[0].player;
  return {
    swapped: g.slots[0].rudie.id === 'gum' && after !== before,
    scoreRebound: g.slots[0].score.player === after,
    faster: after.C.maxSpeed > before.C.maxSpeed,
    modelSwapped: g.slots[0].model.skin.id === 'gum',
  };
});
await page.evaluate(() => window.__jsrf.onMenuAction('rudie', 'beat'));

// --- gating ---------------------------------------------------------------
const gate = await page.evaluate(() => {
  const g = window.__jsrf;
  g.profile.data.progress = { missions: {}, districts: [], rudies: [], rudie: 'beat' };
  const fresh = g.__missions.missionState(g.profile.progress);
  const open = fresh.flatMap((c) => c.rows.filter((r) => !r.locked).map((r) => r.mission.id));
  return { open, chapters: fresh.length, lockedChapters: fresh.filter((c) => c.locked).length };
});

// --- run each mission type ------------------------------------------------
const started = [];
async function runMission(id, drive) {
  await page.evaluate((mid) => {
    const g = window.__jsrf;
    g.onMenuAction('mission', mid);
  }, id);
  await gwait(0.4);
  const setup = await page.evaluate(() => {
    const g = window.__jsrf;
    const d = g.mission.def.district;
    const spots = g.graffiti.spots;
    return {
      id: g.mission.def.id,
      type: g.mission.def.type,
      district: d,
      inPlay: spots.length,
      allInDistrict: !d || spots.every((s) => s.data.district === d),
      lit: g.graffiti.all.filter((s) => s.beacon.visible).length,
      rivals: g.rivals.list.length,
      police: g.police.intensity,
      playerDistrict: g.level.constructor.name ? null : null,
      spawnOk: !d || (() => {
        const p = g.player.position;
        const c = g.__level.DISTRICTS[d].centre;
        return Math.abs(p.x - c[0]) <= 150 && Math.abs(p.z - c[1]) <= 150;
      })(),
      goalLabel: g.mission.goalLabel,
      target: g.mission.target,
      timeLeft: Math.round(g.mission.timeLeft),
    };
  });
  const result = drive ? await drive() : null;
  started.push({ ...setup, ...result });
  return setup;
}

// tagRun: paint the required walls outright and check it ends on the goal
const tagRun = await runMission('first-marks', async () => page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ stats, reason }) => { ended = { reason, won: stats.won, medal: stats.medal, metric: stats.metric }; });
  const gang = g.slots[0].gang;
  for (const spot of g.graffiti.spots.slice(0, g.mission.target)) {
    g.graffiti.begin(spot, g.player, gang);
    const s = g.graffiti.sessionFor(g.player);
    if (!s) continue;
    s.index = s.sequence.length;
    s.targetProgress = 1;
    g.graffiti._complete(g.player);
  }
  await new Promise((r) => setTimeout(r, 120));
  return { ended, counted: g.mission.counts.tags };
}));

// score: bank past the target
const scoreRun = await runMission('keep-moving', async () => page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ stats }) => { ended = { won: stats.won, medal: stats.medal, metric: stats.metric }; });
  g.slots[0].score.total = 95000;
  g.mission.update(0.016);
  await new Promise((r) => setTimeout(r, 120));
  return { ended };
}));

// trick: one big chain, not a big total
const trickRun = await runMission('air-time', async () => page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ stats }) => { ended = { won: stats.won, medal: stats.medal, metric: stats.metric }; });
  // A pile of small chains must not count; one big one must.
  for (let i = 0; i < 12; i++) g.events.emit('score:bank', { gained: 3000, player: g.player });
  const smallOnly = g.mission.counts.bestCombo;
  g.events.emit('score:bank', { gained: 61000, player: g.player });
  g.mission.update(0.016);
  await new Promise((r) => setTimeout(r, 120));
  return { ended, smallOnly };
}));

// collect: cans
const collectRun = await runMission('downhill', async () => page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ stats }) => { ended = { won: stats.won, medal: stats.medal }; });
  // Same shape the real pickup emits: the HUD pops a label at its position.
  for (let i = 0; i < 12; i++) {
    g.events.emit('pickup:can', { player: g.player, amount: 1, color: 0xffd21e, position: g.player.position.clone() });
  }
  await new Promise((r) => setTimeout(r, 120));
  return { ended };
}));

// takedown: rivals and cops both count
const takedownRun = await runMission('hill-takedown', async () => page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ stats }) => { ended = { won: stats.won, medal: stats.medal, metric: stats.metric }; });
  // Six rivals is not enough on its own; four cops on top of it is. That the
  // run ends on the tenth and not the eleventh is the point.
  const at = { position: g.player.position.clone() };
  for (let i = 0; i < 6; i++) {
    g.events.emit('rival:knockdown', { player: g.player, gang: g.slots[0].gang, rival: at });
  }
  const rivalsOnly = { count: g.mission.counts.takedowns, ended: !!ended };
  for (let i = 0; i < 4; i++) g.events.emit('police:knockdown', { player: g.player, cop: at });
  await new Promise((r) => setTimeout(r, 120));
  return { ended, rivalsOnly };
}));

// turf: being ahead is not the same as having won -- it runs the clock out
const turfRun = await runMission('terminal-turf', async () => page.evaluate(async () => {
  const g = window.__jsrf;
  let ended = null;
  g.events.on('mission:complete', ({ stats }) => { ended = { won: stats.won, medal: stats.medal, metric: stats.metric }; });
  const gang = g.slots[0].gang;
  for (const spot of g.graffiti.spots.slice(0, 10)) spot.owner = gang;
  g.mission.update(0.016);
  const endedEarly = !!ended;
  g.mission.timeLeft = 0.01;
  g.mission.update(0.02);
  await new Promise((r) => setTimeout(r, 150));
  return { ended, endedEarly, unlocked: [...g.profile.progress.districts] };
}));

// A failed run must not file progress.
const failed = await page.evaluate(async () => {
  const g = window.__jsrf;
  g.profile.data.progress.missions = {};
  g.profile.data.progress.districts = [];
  g.onMenuAction('mission', 'terminal-turf');
  let stats = null;
  g.events.on('mission:complete', (e) => { stats = e.stats; });
  g.mission.timeLeft = 0.01;
  g.mission.update(0.02);
  await new Promise((r) => setTimeout(r, 150));
  return {
    won: stats ? stats.won : null,
    missionsFiled: Object.keys(g.profile.progress.missions).length,
    districtsOpened: g.profile.progress.districts.length,
  };
});

// Clearing it opens the next chapter in the list, and the rudie it promised.
const unlocked = await page.evaluate(async () => {
  const g = window.__jsrf;
  const before = g.__missions.missionState(g.profile.progress);
  g.profile.recordMission('terminal-turf', { medal: 'gold', metric: 14, unlocks: { districts: ['heights'] } });
  g.profile.recordMission('up-top', { medal: 'bronze', metric: 5 });
  g.profile.recordMission('air-time', { medal: 'silver', metric: 40000, unlocks: { rudies: ['cube'] } });
  const after = g.__missions.missionState(g.profile.progress);
  const chapter = (state, id) => state.find((c) => c.chapter.id === id);
  // A worse replay must not take a medal away.
  g.profile.recordMission('terminal-turf', { medal: 'bronze', metric: 5 });
  return {
    heightsWasLocked: chapter(before, 'heights').locked,
    heightsNowOpen: !chapter(after, 'heights').locked,
    thirdRowOpened: !chapter(after, 'heights').rows[2].locked,
    hillStillLocked: chapter(after, 'hill').locked,
    cubeUnlocked: g.profile.hasRudie(g.__rudies.RUDIES.find((r) => r.id === 'cube')),
    garamLocked: !g.profile.hasRudie(g.__rudies.RUDIES.find((r) => r.id === 'garam')),
    medalKept: g.profile.progress.missions['terminal-turf'].medal,
  };
});

// The list draws, and locked rows are not reachable with a controller.
const screen = await page.evaluate(() => {
  const g = window.__jsrf;
  g.showMissions();
  const el = document.querySelector('[data-screen="missions"]');
  const rows = el.querySelectorAll('.mission-row');
  const focusable = el.querySelectorAll('[data-action]');
  return {
    shown: el.classList.contains('is-on'),
    rows: rows.length,
    lockedRows: el.querySelectorAll('.mission-row.is-locked').length,
    lockedAreUnfocusable: [...focusable].every((f) => !f.classList.contains('is-locked')),
    rosterPicks: el.querySelectorAll('.roster__pick').length,
    lockedPicks: el.querySelectorAll('.roster__pick.is-locked').length,
  };
});
await page.screenshot({ path: 'scratch/missions/select.png' });

console.log(JSON.stringify({ roster, swap, gate, started, failed, unlocked, screen }, null, 2));

const byId = Object.fromEntries(started.map((r) => [r.id, r]));
const districtRuns = started.filter((r) => r.district);

const ok = {
  statsChangeHandling: roster.gumFaster && roster.yoyoPaysMore && roster.yoyoHoldsRails && roster.comboHitsEasier,
  everyRudieIsPlayable: roster.everybodySane && roster.names.length === 6,
  seatCanSwapRudie: swap.swapped && swap.scoreRebound && swap.faster && swap.modelSwapped,

  onlyTheFirstMissionIsOpen: gate.open.length === 1 && gate.open[0] === 'first-marks' && gate.lockedChapters === 5,

  districtRunsAreScoped: districtRuns.every((r) => r.allInDistrict && r.inPlay > 0 && r.inPlay < 65),
  districtRunsSpawnThere: districtRuns.every((r) => r.spawnOk),
  outOfPlayWallsGoDark: districtRuns.every((r) => r.lit === r.inPlay),
  missionsSetTheirOwnPressure: byId['first-marks'].police === 0 && byId['first-marks'].rivals === 0
    && byId['hill-takedown'].rivals === 2 && byId['market-run'] === undefined,

  tagRunEndsOnItsGoal: tagRun && byId['first-marks'].ended
    && byId['first-marks'].ended.reason === 'goal' && byId['first-marks'].ended.won,
  tagRunMedalsOnTimeLeft: byId['first-marks'].ended.medal === 'gold',
  scoreRunCountsTheTotal: byId['keep-moving'].ended && byId['keep-moving'].ended.won
    && byId['keep-moving'].ended.medal === 'gold',
  trickRunWantsOneBigChain: byId['air-time'].smallOnly < 25000 && byId['air-time'].ended
    && byId['air-time'].ended.won && byId['air-time'].ended.medal === 'gold',
  collectRunCountsCans: byId['downhill'].ended && byId['downhill'].ended.won,
  takedownCountsRivalsAndCops: byId['hill-takedown'].rivalsOnly.count === 6
    && byId['hill-takedown'].rivalsOnly.ended === false
    && byId['hill-takedown'].ended && byId['hill-takedown'].ended.won
    && byId['hill-takedown'].ended.metric === 10,
  turfRunsTheClockOut: byId['terminal-turf'].endedEarly === false && byId['terminal-turf'].ended.won,

  losingFilesNothing: failed.won === false && failed.missionsFiled === 0 && failed.districtsOpened === 0,
  clearingOpensTheNextChapter: unlocked.heightsWasLocked && unlocked.heightsNowOpen
    && unlocked.thirdRowOpened && unlocked.hillStillLocked,
  missionsUnlockRudies: unlocked.cubeUnlocked && unlocked.garamLocked,
  aWorseReplayKeepsTheMedal: unlocked.medalKept === 'gold',

  selectScreenDraws: screen.shown && screen.rows === 14 && screen.rosterPicks === 6,
  lockedRowsAreNotFocusable: screen.lockedAreUnfocusable && screen.lockedRows > 0,
};
console.log('\n--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 6)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
