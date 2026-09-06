/**
 * Reports what is inside a .glb, and whether the game can use it.
 *
 * Reads the container directly rather than through a loader: the glTF JSON
 * chunk has everything worth knowing, and parsing it by hand means this runs
 * in plain Node with no GL context and no image decoding.
 *
 *   node scripts/inspect-model.mjs public/assets/characters/beat.glb
 */
import fs from 'node:fs';
import path from 'node:path';

const MAGIC = 0x46546c67;   // 'glTF'
const CHUNK_JSON = 0x4e4f534a;

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 12) throw new Error('too short to be a glTF');
  if (buf.readUInt32LE(0) !== MAGIC) {
    throw new Error('not a binary glTF (.glb). Export as GLB, or convert the .gltf first.');
  }
  const version = buf.readUInt32LE(4);
  let offset = 12;
  let json = null;
  let binBytes = 0;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === CHUNK_JSON) json = JSON.parse(buf.slice(start, start + length).toString('utf8'));
    else binBytes += length;
    offset = start + length;
  }
  if (!json) throw new Error('no JSON chunk found');
  return { json, version, binBytes, fileBytes: buf.length };
}

function countTriangles(json) {
  const accessors = json.accessors || [];
  let tris = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue;                        // triangles only
      const idx = prim.indices !== undefined ? accessors[prim.indices] : null;
      const pos = accessors[prim.attributes?.POSITION];
      const count = idx ? idx.count : (pos ? pos.count : 0);
      tris += Math.floor(count / 3);
    }
  }
  return tris;
}

export function describe(file) {
  const { json, version, binBytes, fileBytes } = readGlb(file);
  const animations = (json.animations || []).map((a, i) => a.name || `clip${i}`);
  const images = json.images || [];
  const skins = json.skins || [];
  const joints = skins.reduce((n, s) => n + (s.joints ? s.joints.length : 0), 0);

  return {
    file: path.basename(file),
    fileBytes,
    version,
    binBytes,
    meshes: (json.meshes || []).length,
    triangles: countTriangles(json),
    materials: (json.materials || []).length,
    images: images.length,
    imageTypes: [...new Set(images.map((i) => i.mimeType || 'external'))],
    skins: skins.length,
    joints,
    rigged: skins.length > 0,
    animations,
    extensions: json.extensionsUsed || [],
  };
}

function report(file) {
  const info = describe(file);
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

  console.log(`\n  ${info.file}  (glTF ${info.version}, ${mb(info.fileBytes)})`);
  console.log(`  ${'-'.repeat(info.file.length + 24)}`);
  console.log(`  meshes      ${info.meshes}   triangles ${info.triangles.toLocaleString('en-US')}`);
  console.log(`  materials   ${info.materials}   images ${info.images} ${info.imageTypes.length ? `(${info.imageTypes.join(', ')})` : ''}`);
  console.log(`  skeleton    ${info.rigged ? `yes, ${info.joints} joints` : 'NO'}`);
  console.log(`  animations  ${info.animations.length ? info.animations.join(', ') : 'none'}`);
  if (info.extensions.length) console.log(`  extensions  ${info.extensions.join(', ')}`);

  const notes = [];
  if (!info.rigged) {
    notes.push('No skeleton. A raw text-to-3D export is a static mesh: the game will keep the\n'
      + '     procedural rudie until this is rigged. Run it through Meshy\'s rigging step or\n'
      + '     upload it to Mixamo, then re-export as GLB.');
  }
  if (info.rigged && info.animations.length === 0) {
    notes.push('Rigged but no animation clips. The rig will pose but never move; add clips\n'
      + '     named idle / skate / air / grind (see src/assets/AssetManifest.js).');
  }
  if (info.triangles > 60000) {
    notes.push(`${info.triangles.toLocaleString('en-US')} triangles is heavy for a character drawn up to four\n`
      + '     times in split-screen. Decimate to roughly 15-30k.');
  }
  if (info.fileBytes > 12 * 1024 * 1024) {
    notes.push(`${mb(info.fileBytes)} is large. Compress the textures (KTX2) or the mesh (Draco).`);
  }
  if (info.extensions.includes('KHR_draco_mesh_compression')) {
    notes.push('Uses Draco. Run "npm run assets:decoders" so the decoder ships with the app.');
  }
  if (info.extensions.includes('KHR_texture_basisu')) {
    notes.push('Uses KTX2/Basis. Run "npm run assets:decoders" so the transcoder ships with the app.');
  }

  if (notes.length) {
    console.log('\n  Notes:');
    for (const n of notes) console.log(`   -  ${n}`);
  } else {
    console.log('\n  Looks ready to drop in.');
  }
  console.log('');
  return info;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('inspect-model.mjs');
if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/inspect-model.mjs <model.glb>');
    process.exit(1);
  }
  try {
    report(file);
  } catch (err) {
    console.error(`\n  Could not read ${file}: ${err.message}\n`);
    process.exit(1);
  }
}

export { report };
