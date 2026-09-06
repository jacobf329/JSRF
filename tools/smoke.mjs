// Headless smoke test: boots the built game, runs a few seconds of simulated
// input, and reports console errors plus a screenshot.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

const OUT = process.argv[2] || 'scratch/shot.png';
const SECONDS = Number(process.argv[3] || 6);

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox', '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = `${m.type()}: ${m.text()}`;
  logs.push(t);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));

await page.goto('http://127.0.0.1:5199/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

// Drive the skater around: hold forward, jump, boost.
await page.keyboard.down('w');
await page.waitForTimeout(1200);
await page.keyboard.down('Shift');
await page.waitForTimeout(1000);
await page.keyboard.press('Space');
await page.waitForTimeout(700);
await page.keyboard.down('d');
await page.waitForTimeout(900);
await page.keyboard.up('d');
await page.waitForTimeout(SECONDS * 300);
await page.keyboard.up('Shift');
await page.keyboard.up('w');
await page.waitForTimeout(600);

const state = await page.evaluate(() => {
  const g = window.__jsrf;
  if (!g) return { ok: false, reason: 'no game object' };
  return {
    ok: true,
    state: g.player.state,
    pos: g.player.position.toArray().map((n) => +n.toFixed(2)),
    speed: +g.player.speed.toFixed(2),
    grounded: g.player.grounded,
    tris: g.level.collision.triCount,
    rails: g.level.rails.rails.length,
    drawCalls: g.renderer.stats.calls,
    frameTris: g.renderer.stats.triangles,
    score: g.score ? g.score.total : null,
  };
});

fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
await page.screenshot({ path: OUT });

console.log('--- state ---');
console.log(JSON.stringify(state, null, 2));
if (errors.length) {
  console.log('--- errors ---');
  for (const e of errors.slice(0, 12)) console.log(e);
} else {
  console.log('--- no console errors ---');
}

await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
