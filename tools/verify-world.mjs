// Checks the enlarged world: every district is solid ground you can land on,
// tags and cans are spread across all of them, and the chunked merge is
// actually culling rather than drawing the whole map from everywhere.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const server = await createServer({ server: { port: 5192, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5192/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s }, { polling: 'raf', timeout: 120000 });
};

await page.evaluate(() => window.__jsrf.onMenuAction('start'));
await gwait(0.5);

const world = await page.evaluate(() => {
  const g = window.__jsrf;
  const tags = {};
  for (const s of g.level.tagSpots) tags[s.district] = (tags[s.district] || 0) + 1;
  return {
    bounds: g.level.constructor.name && g.level.spawn ? 300 : null,
    tagTotal: g.level.tagSpots.length,
    tagsByDistrict: tags,
    cans: g.level.canSpots.length,
    rails: g.level.rails.rails.length,
    collisionTris: g.level.collision.triCount,
    chunks: (() => {
      const names = new Set();
      g.level.group.traverse((o) => { if (o.isMesh && o.name.includes(':')) names.add(o.name.split(':')[0]); });
      return [...names];
    })(),
    meshes: (() => { let n = 0; g.level.group.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
  };
});

const DISTRICTS = [
  { id: 'terminal', at: [0, 40, 40] },
  { id: 'heights', at: [0, 60, -225] },
  { id: 'hill', at: [0, 60, 225] },
  { id: 'drain', at: [-225, 40, 0] },
  { id: 'bantam', at: [225, 40, 0] },
];

const rows = [];
fs.mkdirSync('scratch/world', { recursive: true });
for (const d of DISTRICTS) {
  await page.evaluate((at) => {
    const g = window.__jsrf;
    const p = g.player;
    p.rail = null; p.trick = null;
    p.setState('air');
    p.position.set(at[0], at[1], at[2]);
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    g.followCamera.reset(p);
  }, d.at);
  await gwait(3.2);   // long enough to fall and settle
  const info = await page.evaluate(() => {
    const g = window.__jsrf;
    return {
      grounded: g.player.grounded,
      y: +g.player.position.y.toFixed(2),
      state: g.player.state,
      calls: g.renderer.stats.calls,
      tris: g.renderer.stats.triangles,
    };
  });
  rows.push({ id: d.id, ...info });
  await page.screenshot({ path: `scratch/world/${d.id}.png` });
}

console.log(JSON.stringify(world, null, 2));
console.log('\ndistrict   landed  y       state   calls  triangles');
for (const r of rows) {
  console.log(`${r.id.padEnd(10)} ${String(r.grounded).padEnd(7)} ${String(r.y).padEnd(7)} ${r.state.padEnd(7)} ${String(r.calls).padEnd(6)} ${r.tris.toLocaleString('en-US')}`);
}

// Dropped from height onto a district full of rails, catching one is a landing
// too -- what matters is that something caught them.
const landed = rows.filter((r) => r.grounded || r.state === 'grind').length;
const calls = rows.map((r) => r.calls);
const ok = {
  allDistrictsCatchYou: landed === DISTRICTS.length,
  nobodyFellThrough: rows.every((r) => r.y > -20),
  tagsEverywhere: Object.keys(world.tagsByDistrict).length === 5,
  plentyOfTags: world.tagTotal >= 55,
  allChunksBuilt: world.chunks.length >= 5,
  cullingWorks: Math.min(...calls) < Math.max(...calls) * 0.85,
};
console.log('\n--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 6)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
