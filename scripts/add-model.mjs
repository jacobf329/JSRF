/**
 * Puts a character model where the game expects it, and says whether it works.
 *
 *   npm run add-model -- ~/Downloads/beat.glb
 *   npm run add-model -- https://example.com/beat.glb --id character.beat
 *
 * Works with anything that exports GLB -- Meshy, Mixamo, Blender, Sketchfab.
 * The game reads the manifest in src/assets/AssetManifest.js, so the id here
 * has to match an entry there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from './inspect-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { source: null, id: 'character.beat' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id') args.id = argv[++i];
    else if (!args.source) args.source = argv[i];
  }
  return args;
}

async function fetchTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const { source, id } = parseArgs(process.argv.slice(2));
if (!source) {
  console.error('usage: npm run add-model -- <file-or-url.glb> [--id character.beat]');
  process.exit(1);
}

// The manifest decides where each id lives, so the two can never drift.
const manifestPath = path.join(root, 'src', 'assets', 'AssetManifest.js');
const manifestSource = fs.readFileSync(manifestPath, 'utf8');
const match = manifestSource.match(new RegExp(`id:\\s*'${id.replace('.', '\\.')}'[\\s\\S]*?url:\\s*'([^']+)'`));
if (!match) {
  console.error(`\n  No manifest entry with id "${id}".`);
  console.error(`  Add one to ${path.relative(root, manifestPath)} first.\n`);
  process.exit(1);
}

const dest = path.join(root, 'public', match[1]);
fs.mkdirSync(path.dirname(dest), { recursive: true });

try {
  if (/^https?:\/\//.test(source)) {
    console.log(`\n  Downloading ${source}`);
    const bytes = await fetchTo(source, dest);
    console.log(`  Saved ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  } else {
    const from = path.resolve(source);
    if (!fs.existsSync(from)) throw new Error(`no such file: ${from}`);
    fs.copyFileSync(from, dest);
    console.log(`\n  Copied ${from}`);
  }
  console.log(`  -> ${path.relative(root, dest)}`);
  report(dest);
  console.log('  Run "npm run dev" (or rebuild the app) and it will be picked up.\n');
} catch (err) {
  console.error(`\n  Failed: ${err.message}\n`);
  process.exit(1);
}
