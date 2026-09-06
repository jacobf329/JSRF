// Launches an electron-builder output and reports why it did or did not boot.
import { _electron as electron } from 'playwright';

const bin = process.argv[2];
const app = await electron.launch({
  executablePath: bin,
  args: ['--user-data-dir=/tmp/jsrf-packaged-profile', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// No reload: this has to be the real cold-start path. Poll rather than sleep,
// so "slow" and "broken" do not look the same.
const started = Date.now();
let booted = false;
try {
  await win.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });
  booted = true;
} catch { booted = false; }
const bootMs = Date.now() - started;
const report = {
  url: win.url(),
  booted,
  bootMs,
  desktop: await win.evaluate(() => !!(window.jsrfShell && window.jsrfShell.isDesktop)),
  scripts: await win.evaluate(() => Array.from(document.querySelectorAll('script')).map((s) => s.src || '(inline)')),
};

if (!booted) {
  // Ask the page itself what the server said about its own script.
  report.probe = await win.evaluate(async () => {
    const src = document.querySelector('script[type=module]')?.src;
    if (!src) return 'no module script tag';
    try {
      const r = await fetch(src);
      const text = await r.text();
      return { status: r.status, type: r.headers.get('content-type'), bytes: text.length, head: text.slice(0, 80) };
    } catch (e) { return 'fetch threw: ' + e.message; }
  });
  report.mainLog = 'see stderr';
}

console.log(JSON.stringify(report, null, 2));
if (errors.length) { console.log('renderer errors:'); for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e); }

await app.close();
process.exit(booted ? 0 : 1);
