// Boots the real Electron app under a virtual display and checks that the
// custom app:// protocol serves the module build, the game starts, and the
// save bridge round-trips to a real file on disk.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const userData = '/tmp/jsrf-electron-profile';
fs.rmSync(userData, { recursive: true, force: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`, '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--no-sandbox'],
  cwd: process.cwd(),
});

const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// Listeners attach after the window exists, so reload to catch load-time
// errors that would otherwise have happened before we were listening. Then
// poll rather than sleep: a cold start under software rendering is slow, and
// "slow" must not be reported as "broken".
await win.reload();
await win.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 90000 }).catch(() => { });

const url = win.url();
const booted = await win.evaluate(() => !!window.__jsrf);
const isDesktop = await win.evaluate(() => !!(window.jsrfShell && window.jsrfShell.isDesktop));

if (!booted) {
  console.error('game never booted; url =', url);
  console.error('body length:', await win.evaluate(() => document.body.innerHTML.length));
  console.error('scripts:', JSON.stringify(await win.evaluate(() =>
    Array.from(document.querySelectorAll('script')).map((s) => s.src || '(inline)'))));
  console.error('console errors:');
  for (const e of [...new Set(errors)].slice(0, 15)) console.error('  ' + e);
  await app.close();
  process.exit(1);
}

// Play a little.
await win.keyboard.press('Enter');
await win.waitForTimeout(400);
await win.keyboard.down('w');
const t0 = await win.evaluate(() => window.__jsrf.time);
await win.waitForFunction((t) => window.__jsrf.time - t >= 2.0, t0, { polling: 'raf', timeout: 120000 });
await win.keyboard.up('w');
fs.mkdirSync('scratch', { recursive: true });
await win.screenshot({ path: 'scratch/app-window.png' });

// Force a save through the shell bridge and read the file back off disk.
await win.evaluate(async () => {
  const g = window.__jsrf;
  g.profile.recordScore(1, 123456);
  g.profile.flush();
  await new Promise((r) => setTimeout(r, 400));
});
await win.waitForTimeout(600);

const savePath = path.join(userData, 'save.json');
const saved = fs.existsSync(savePath) ? JSON.parse(fs.readFileSync(savePath, 'utf8')) : null;

const state = await win.evaluate(() => {
  const g = window.__jsrf;
  return {
    mode: g.mode,
    platform: g.profile ? undefined : undefined,
    moved: +g.player.position.distanceTo(g.level.spawn).toFixed(1),
    drawCalls: g.renderer.stats.calls,
    triangles: g.renderer.stats.triangles,
  };
});

console.log('url          :', url);
console.log('desktop API  :', isDesktop);
console.log('game state   :', JSON.stringify(state));
console.log('save on disk :', saved ? `yes, best[1]=${saved.best['1']}` : 'NO');

const real = errors.filter((e) => !/Failed to load resource|fonts\.googleapis|ERR_|Autofill|devtools/i.test(e));
if (real.length) { console.log('errors:'); for (const e of [...new Set(real)].slice(0, 8)) console.log('  ' + e); }

await app.close();
const ok = booted && isDesktop && url.startsWith('app://') && saved && saved.best['1'] === 123456 && !real.length;
console.log(ok ? 'APP OK' : 'APP FAILED');
process.exit(ok ? 0 : 1);
