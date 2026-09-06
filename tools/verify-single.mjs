// Opens the distributable HTML over file:// -- exactly how a double-click loads
// it -- and checks the game boots, starts a run and renders.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const file = path.resolve(process.argv[2] || 'game/JetSetRadioFuture.html');
if (!fs.existsSync(file)) { console.error('missing', file); process.exit(1); }

function chromePath() {
  // This container ships a Chromium at a fixed path; CI and dev machines use
  // whatever Playwright downloaded. JSRF_CHROME overrides both.
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const booted = await page.evaluate(() => !!window.__jsrf);
if (!booted) { console.error('game object never appeared'); await browser.close(); process.exit(1); }

await page.screenshot({ path: 'scratch/file-title.png' });
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.keyboard.down('w');

const t0 = await page.evaluate(() => window.__jsrf.time);
await page.waitForFunction((t) => window.__jsrf.time - t >= 2.5, t0, { polling: 'raf', timeout: 120000 });
await page.keyboard.up('w');
await page.screenshot({ path: 'scratch/file-playing.png' });

const state = await page.evaluate(() => {
  const g = window.__jsrf;
  return {
    mode: g.mode,
    moved: +g.player.position.distanceTo(g.level.spawn).toFixed(1),
    speed: +g.player.speed.toFixed(1),
    drawCalls: g.renderer.stats.calls,
    triangles: g.renderer.stats.triangles,
  };
});
console.log('file:// boot =>', JSON.stringify(state));

// Google Fonts being unreachable is expected offline and is not a failure.
const real = errors.filter((e) => !/Failed to load resource|fonts\.googleapis|ERR_/.test(e));
if (real.length) {
  console.log('errors:');
  for (const e of [...new Set(real)].slice(0, 8)) console.log('  ' + e);
}
await browser.close();
process.exit(real.length || state.drawCalls === 0 ? 1 : 0);
