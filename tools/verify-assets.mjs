// Proves the asset pipeline end to end without needing a real model committed:
// builds a rigged, animated, PBR-textured GLB in the page, loads it back
// through the AssetManager, and swaps it in as a live player rig.
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
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

await page.goto('http://127.0.0.1:5194/', { waitUntil: 'load' });
await ready();

// The fixture pulls in GLTFExporter, which the dev server has not pre-bundled;
// the first import makes Vite re-optimise and force a reload. Do that once up
// front so it cannot land in the middle of a measurement.
await page.evaluate(() => import('/src/dev/TestAssets.js').then(() => true).catch(() => false))
  .catch(() => { /* the reload itself destroys this context; that is the point */ });
await page.waitForTimeout(1500);
await ready();

const gwait = async (s) => {
  const t0 = await page.evaluate(() => window.__jsrf.time);
  await page.waitForFunction((a) => window.__jsrf.time - a.t0 >= a.s, { t0, s }, { polling: 'raf', timeout: 120000 });
};

const result = await page.evaluate(async () => {
  const g = window.__jsrf;
  const THREE = window.__three;
  const { makeRiggedGlb } = await import('/src/dev/TestAssets.js');

  const buffer = await makeRiggedGlb();
  const asset = await g.assets.parseGltf(buffer, {
    id: 'test.character',
    clips: { idle: ['idle'], skate: ['skate'] },
  });

  // Did the PBR material become the game's toon material, keeping its colour?
  let materialType = null;
  let materialColor = null;
  asset.scene.traverse((o) => {
    if (o.isSkinnedMesh && !materialType) {
      materialType = o.material.type;
      materialColor = `#${o.material.color.getHexString()}`;
    }
  });

  return {
    glbBytes: buffer.byteLength,
    rigged: asset.rigged,
    clipNames: asset.clipNames,
    materialType,
    materialColor,
    hasGradientMap: (() => {
      let found = false;
      asset.scene.traverse((o) => { if (o.material && o.material.gradientMap) found = true; });
      return found;
    })(),
    threeAvailable: !!THREE,
  };
});

// Now adopt it as a real player rig and let it run.
const swapped = await page.evaluate(async () => {
  const g = window.__jsrf;
  const { makeRiggedGlb } = await import('/src/dev/TestAssets.js');
  const { GltfRig } = await import('/src/player/GltfRig.js');
  const buffer = await makeRiggedGlb();
  const asset = await g.assets.parseGltf(buffer, { id: 'test.character' });
  const rig = new GltfRig(asset, { clips: { idle: ['idle'], skate: ['skate'] }, skinIndex: 0 });
  g.slots[0].setRig(rig);
  return {
    rigClass: g.slots[0].model.constructor.name,
    inScene: !!rig.root.parent,
    resolvedIdle: rig.locomotion.idle,
    resolvedSkate: rig.locomotion.skate,
    hasTrickClip: rig.hasClip('trick_kickflip'),
  };
});

await page.evaluate(() => window.__jsrf.onMenuAction('start'));
await gwait(1.2);

const running = await page.evaluate(() => {
  const g = window.__jsrf;
  const rig = g.slots[0].model;
  return {
    rigClass: rig.constructor.name,
    mixerTime: +rig.mixer.time.toFixed(2),
    followsPlayer: rig.root.position.distanceTo(g.player.position) < 0.01,
    height: (() => {
      const box = new (window.__three.Box3)().setFromObject(rig.root);
      return +(box.max.y - box.min.y).toFixed(2);
    })(),
  };
});

fs.mkdirSync('scratch', { recursive: true });
await page.screenshot({ path: 'scratch/asset-rig.png' });

// Write the fixture out so the offline inspector can be run against a real file.
const glbBase64 = await page.evaluate(async () => {
  const { makeRiggedGlb } = await import('/src/dev/TestAssets.js');
  const buffer = await makeRiggedGlb();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
});
fs.writeFileSync('scratch/fixture.glb', Buffer.from(glbBase64, 'base64'));
console.log('wrote scratch/fixture.glb');

console.log('parsed  :', JSON.stringify(result, null, 2));
console.log('swapped :', JSON.stringify(swapped));
console.log('running :', JSON.stringify(running));

const ok = {
  glbBuilt: result.glbBytes > 500,
  detectedSkeleton: result.rigged === true,
  clipsFound: result.clipNames.length === 3,
  convertedToToon: result.materialType === 'MeshToonMaterial',
  keptColour: result.materialColor === '#ff2f87',
  bandedShading: result.hasGradientMap === true,
  rigAdopted: swapped.rigClass === 'GltfRig' && swapped.inScene,
  clipsResolved: swapped.resolvedIdle === 'idle' && swapped.resolvedSkate === 'skate',
  trickClipSeen: swapped.hasTrickClip === true,
  animating: running.mixerTime > 0.5,
  followsPlayer: running.followsPlayer,
  scaledToHeight: running.height > 1.5 && running.height < 2.1,
};
console.log('--- checks ---');
for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
if (errors.length) { console.log('errors:'); for (const e of [...new Set(errors)].slice(0, 6)) console.log('  ' + e); }

await browser.close();
await server.close();
process.exit(Object.values(ok).every(Boolean) && !errors.length ? 0 : 1);
