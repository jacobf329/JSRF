// Renders the rudie rig on its own, through the game's own cel renderer and
// lights, so the model can be iterated on without hunting for a patch of the
// city with nothing in the way. Writes scratch/rudie/*.png.
//
//   node tools/view-rudie.mjs [skinIndex] [poseName]
//   node tools/view-rudie.mjs 0 trick:mctwist      -- a strip through one move
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

function chromePath() {
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return process.env.JSRF_CHROME || (fs.existsSync(local) ? local : undefined);
}

const skin = Number(process.argv[2] ?? 0);
const pose = process.argv[3] || null;

const server = await createServer({ server: { port: 5205, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5205/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jsrf, null, { polling: 100, timeout: 60000 });

// Strip the city and the UI; keep the lights, the sky and the cel pass.
const info = await page.evaluate(async (opts) => {
  const g = window.__jsrf;
  const THREE = window.__three;
  g.onMenuAction('mission', 'first-marks');
  document.getElementById('ui').style.display = 'none';
  // Hide the city's meshes, not the group: the sun, the fill and the hemi
  // light all live under it, and hiding the group leaves the rig unlit.
  g.level.group.traverse((o) => { if (o.isMesh) o.visible = false; });
  g.graffiti.group.visible = false;
  g.pickups.group.visible = false;
  g.police.group.visible = false;
  g.rivals.setVisible(false);
  g.slots[0].followCamera.update = () => {};

  // A floor so the rig casts a shadow onto something, in the game's own
  // cel material so it bands the way the city does.
  const { toon } = await import('/src/render/Materials.js');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), toon(0xb9bcc9));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.scene.add(floor);

  const { PlayerModel } = await import('/src/player/PlayerModel.js');
  const model = new PlayerModel(opts.skin);
  g.scene.add(model.root);
  window.__model = model;

  // A stand-in player: the rig reads a fixed set of fields and nothing else,
  // so a plain object drives it exactly as the real controller would.
  window.__fake = {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    index: 0, time: 0, state: 'skate',
    groundSpeed: 0, speed: 0, visualHeading: 0, lean: 0, grounded: true,
    trickFlip: 0, trickSpin: 0, trickRoll: 0,
    trickPose: opts.pose && !opts.pose.startsWith('trick:') ? opts.pose : null,
    trickPoseNext: null,
    trickPoseMix: 0,
    trickPoseWeight: opts.pose && !opts.pose.startsWith('trick:') ? 1 : 0,
    invulnerable: 0,
  };
  for (let i = 0; i < 40; i++) model.update(1 / 60, window.__fake);

  // The shadow camera tracks the live player every frame, so it stays where
  // the stand-in rig is. Its own rig is removed from the scene rather than
  // hidden: PlayerModel.update sets its own visibility every frame, so a
  // hidden one comes straight back.
  g.slots[0].player.position.set(0, 0, 0);
  g.slots[0].player.velocity.set(0, 0, 0);
  g.scene.remove(g.slots[0].model.root);
  g.slots[0].update = () => {};
  const box = new THREE.Box3().setFromObject(model.root);
  return { height: +(box.max.y - box.min.y).toFixed(3), skin: model.skin.name };
}, { skin, pose });

fs.mkdirSync('scratch/rudie', { recursive: true });

// `trick:<id>` renders the move as a filmstrip instead of four static angles,
// which is the only way to tell whether a pose sequence actually travels.
if (pose && pose.startsWith('trick:')) {
  const id = pose.slice(6);
  const frames = 8;
  for (let i = 0; i < frames; i++) {
    await page.evaluate(async (o) => {
      const g = window.__jsrf;
      const T = await import('/src/player/Tricks.js');
      const trick = T.allTricks().find((t) => t.id === o.id);
      if (!trick) throw new Error(`no trick "${o.id}"`);
      const p = g.slots[0].player;
      const m = window.__model;
      const fake = window.__fake;

      // Re-run the move from the start each frame and stop at the sample
      // point, so every frame is reached the same way.
      p.state = 'air';
      p.grounded = false;
      p.trick = trick;
      p.trickDuration = trick.duration || 0.5;
      p.trickTimer = p.trickDuration;
      p.trickPoseWeight = 0;
      const steps = Math.max(1, Math.round(48 * o.t));
      for (let k = 0; k < steps; k++) {
        p._updateTrickAnimation(p.trickDuration / 48);
        if (!p.trick) break;
      }
      Object.assign(fake, {
        state: 'air', grounded: false,
        trickFlip: p.trickFlip, trickSpin: p.trickSpin, trickRoll: p.trickRoll,
        trickPose: p.trickPose, trickPoseNext: p.trickPoseNext,
        trickPoseMix: p.trickPoseMix, trickPoseWeight: p.trickPoseWeight,
      });
      m.update(1 / 60, fake);
      // Lift the rig clear of the floor: a move that goes inverted rotates
      // about the feet, so on the ground half of it ends up underneath.
      m.root.position.set(0, 1.5, 0);

      const cam = g.slots[0].camera;
      cam.position.set(0, 2.4, 7.0);
      cam.lookAt(0, 2.0, 0);
      cam.fov = 30;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    }, { id, t: (i + 0.5) / frames });
    await page.waitForTimeout(380);
    await page.screenshot({ path: `scratch/rudie/${id}-${i}.png` });
  }
  console.log(JSON.stringify({ ...info, filmstrip: id, frames }));
  await browser.close();
  await server.close();
  process.exit(0);
}

const SHOTS = [
  // The rig faces +Z at heading 0, so the camera at a = 0 is looking at it.
  { name: 'front', a: 0 },
  { name: 'three-quarter', a: Math.PI * 0.25 },
  { name: 'side', a: Math.PI * 0.5 },
  { name: 'back', a: Math.PI },
];
for (const s of SHOTS) {
  await page.evaluate((o) => {
    const g = window.__jsrf;
    const cam = g.slots[0].camera;
    const d = 5.2;
    cam.position.set(Math.sin(o.a) * d, 1.6, Math.cos(o.a) * d);
    cam.lookAt(0, 0.92, 0);
    cam.fov = 26;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }, s);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `scratch/rudie/${s.name}.png` });
}

console.log(JSON.stringify({ ...info, pose }), errors.length ? `errors: ${errors.slice(0, 3)}` : 'no errors');
await browser.close();
await server.close();
