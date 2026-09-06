// Headless smoke test: boots the game, plays through skating, grinding and a
// full graffiti tag, then reports state plus any console errors.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

const OUTDIR = process.argv[2] || 'scratch';
fs.mkdirSync(OUTDIR, { recursive: true });

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();

function chromePath() {
  // This container ships a Chromium at a fixed path; CI and dev machines use
  // whatever Playwright downloaded. JSRF_CHROME overrides both.
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));

const shot = (name) => page.screenshot({ path: `${OUTDIR}/${name}.png` });

// Wall-clock waits are useless here: the game clamps dt, so a slow software
// renderer advances far less game time than real time. Wait on game time.
// A grinding player has its position rewritten from the rail every frame, so
// any teleport has to drop the rail and go back to a free state first.
async function teleport(spec) {
  await page.evaluate((a) => {
    const p = window.__jsrf.player;
    p.rail = null;
    p.trick = null;
    p.setState('air');
    p.position.set(a.x, a.y, a.z);
    p.velocity.set(a.vx ?? 0, a.vy ?? 0, a.vz ?? 0);
    if (a.heading !== undefined) p.heading = a.heading;
    p.grounded = false;
    p.grindCooldown = 0;
  }, spec);
}

async function gwait(seconds) {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction(
    (a) => window.__jsrf.time - a.t0 >= a.s,
    { t0, s: seconds },
    { polling: 'raf', timeout: 180000 },
  );
}

await page.goto('http://127.0.0.1:5199/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await shot('01-title');

// --- start the run ---
await page.keyboard.press('Enter');
await gwait(0.5);

// --- skate around ---
await page.keyboard.down('w');
await gwait(1.2);
await page.keyboard.down('Shift');
await gwait(1.6);
await page.keyboard.press('Space');
await gwait(0.4);
await page.keyboard.press('Space');
await gwait(1.0);
await page.keyboard.up('Shift');
await page.keyboard.up('w');
await gwait(0.5);
await shot('02-skating');

// --- drop onto a rail to check grinding ---
const railSpec = await page.evaluate(() => {
  const g = window.__jsrf;
  const V = g.player.position.constructor;
  const rail = g.level.rails.rails.find((r) => r.name === 'stair');
  const at = rail.totalLength * 0.12;
  const p = rail.getPointAt(at, new V());
  const t = rail.getTangentAt(at, new V());
  window.__grindSeen = null;
  g.events.on('player:grind:start', (e) => { window.__grindSeen = e.rail.name || 'unnamed'; });
  return { x: p.x, y: p.y + 1.1, z: p.z, vx: t.x * 9, vy: -1, vz: t.z * 9, heading: Math.atan2(t.x, t.z) };
});
await teleport(railSpec);
await gwait(1.4);
const grind = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    grindFired: window.__grindSeen,
    state: g.player.state,
    railName: g.player.rail?.name ?? null,
    grindMetres: Math.round(g.score.grindMetres),
  };
});
await shot('03-grind');

// --- teleport to a tag spot and paint it ---
const tagSpec = await page.evaluate(() => {
  const g = window.__jsrf;
  const spot = g.graffiti.spots.find((s) => !s.tagged && s.data.position.y < 5);
  const p = spot.data.position;
  const n = spot.data.normal;
  return { x: p.x + n.x * 2.2, y: 0.3, z: p.z + n.z * 2.2, heading: Math.atan2(-n.x, -n.z) };
});
await teleport(tagSpec);
await gwait(0.6);
await shot('04-prompt');

await page.keyboard.press('e');
await gwait(0.5);
await shot('05-spraying');

// Answer the arrow prompts.
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
for (let i = 0; i < 10; i++) {
  const next = await page.evaluate(() => {
    const g = window.__jsrf;
    const s = g.graffiti.sessionFor(g.player);
    return s ? s.sequence[s.index] : null;
  });
  if (!next) break;
  await page.keyboard.press(KEY[next]);
  await gwait(0.22);
}
await gwait(1.0);
await shot('06-tagged');

// --- wall ride: charge a building face at speed ---
await page.evaluate(() => {
  window.__wallSeen = false;
  window.__jsrf.events.on('player:wallride:start', () => { window.__wallSeen = true; });
});
await teleport({ x: 0, y: 0.4, z: -46, vx: 0, vy: 0, vz: -17, heading: Math.PI });
await page.keyboard.down('w');
await page.keyboard.down('Shift');
await gwait(2.0);
const wallride = await page.evaluate(() => ({
  fired: window.__wallSeen,
  state: window.__jsrf.player.state,
}));
await page.keyboard.up('Shift');
await page.keyboard.up('w');
await shot('065-wallride');

// --- let the police show up ---
await page.evaluate(() => { window.__jsrf.police.heat = 5; });
await gwait(6.0);
await page.keyboard.down('a');
await gwait(1.5);
await page.keyboard.up('a');
await shot('07-heat');

// --- four-player split screen ---
await page.evaluate(() => {
  const g = window.__jsrf;
  g.setMode('title');
  g.setPlayerCount(4);
  g.restart();
  // Spread them out so every pane shows something different.
  g.slots.forEach((slot, i) => {
    const a = (i / 4) * Math.PI * 2;
    slot.player.position.set(Math.cos(a) * 30, 1, Math.sin(a) * 30);
    slot.player.velocity.set(0, 0, 0);
    slot.player.heading = a + Math.PI;
    slot.player.invulnerable = 0;
    slot.followCamera.reset(slot.player);
    slot.score.total = 1000 * (i + 1);
  });
});
await gwait(1.2);
await shot('08-fourplayer');

const splitState = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    players: g.playerCount,
    rects: g.slots.map((s) => `${s.rect.width}x${s.rect.height}@${s.rect.x},${s.rect.y}`),
    devices: g.slots.map((s) => s.input.label),
    drawCalls: g.renderer.stats.calls,
  };
});

await page.evaluate(() => {
  const g = window.__jsrf;
  g.setPlayerCount(3);
  g.restart();
  g.slots.forEach((s) => { s.player.invulnerable = 0; s.score.total = 4200 * (s.index + 1); });
});
await gwait(0.8);
await shot('09-threeplayer');

await page.evaluate(() => {
  const g = window.__jsrf;
  g.setPlayerCount(2);
  g.restart();
  g.slots.forEach((s) => { s.player.invulnerable = 0; });
});
await gwait(0.8);
await shot('10-twoplayer');

await page.evaluate(() => {
  const g = window.__jsrf;
  g.setPlayerCount(1);
  g.restart();
});
await gwait(0.5);

const state = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    mode: g.mode,
    playerState: g.player.state,
    pos: g.player.position.toArray().map((n) => +n.toFixed(1)),
    speed: +g.player.speed.toFixed(1),
    health: g.player.health,
    score: g.score.total,
    combo: Math.round(g.score.combo),
    cans: g.score.cans,
    tags: `${g.graffiti.taggedCount}/${g.graffiti.totalCount}`,
    grindMetres: Math.round(g.score.grindMetres),
    cops: g.police.activeCops.length,
    heat: +g.police.heat.toFixed(1),
    drawCalls: g.renderer.stats.calls,
    triangles: g.renderer.stats.triangles,
    collisionTris: g.level.collision.triCount,
    rails: g.level.rails.rails.length,
    fps: Math.round(g.slots[0].hud.fps),
    players: g.playerCount,
  };
});

console.log('--- grind check ---');
console.log(JSON.stringify(grind));
console.log('--- wallride check ---');
console.log(JSON.stringify(wallride));
console.log('--- split screen ---');
console.log(JSON.stringify(splitState, null, 2));
console.log('--- state ---');
console.log(JSON.stringify(state, null, 2));
if (errors.length) {
  console.log('--- errors ---');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(e);
} else {
  console.log('--- no console errors ---');
}

await browser.close();
await server.close();
process.exit(errors.some((e) => !e.includes('Failed to load resource')) ? 1 : 0);
