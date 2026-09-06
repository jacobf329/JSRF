/**
 * Copies the Draco decoder and KTX2 transcoder out of three into public/, so
 * compressed models work in the built app.
 *
 * Only needed once a model actually uses Draco or KTX2 -- inspect-model.mjs
 * says when. Kept as an explicit step rather than part of every build, because
 * most models need neither and it is a megabyte of wasm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const three = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');

const jobs = [
  { from: path.join(three, 'draco', 'gltf'), to: path.join(root, 'public', 'vendor', 'draco'), label: 'Draco' },
  { from: path.join(three, 'basis'), to: path.join(root, 'public', 'vendor', 'basis'), label: 'KTX2/Basis' },
];

let copied = 0;
for (const job of jobs) {
  if (!fs.existsSync(job.from)) {
    console.warn(`  ${job.label}: not found at ${path.relative(root, job.from)} -- skipped`);
    continue;
  }
  fs.mkdirSync(job.to, { recursive: true });
  for (const name of fs.readdirSync(job.from)) {
    const src = path.join(job.from, name);
    if (fs.statSync(src).isDirectory()) continue;
    fs.copyFileSync(src, path.join(job.to, name));
    copied++;
  }
  console.log(`  ${job.label} -> ${path.relative(root, job.to)}`);
}
console.log(`  ${copied} files copied.`);
