# Wiring in textured assets

Everything in the game is generated from code today. This is how you replace
any of it with a real, textured asset — and what has to be true of that asset
for the game to use it.

## The short version

```bash
npm run add-model -- ~/Downloads/beat.glb      # copy it in and check it
npm run dev                                     # it gets picked up
```

If the model has a skeleton and animation clips, the game swaps it in for the
procedural rudie while it is running. If it doesn't, the game says so in the
console and keeps the procedural one — it never breaks.

## Getting a character out of Meshy

This is the part worth reading, because the obvious path produces something the
game can't animate.

1. **Generate the mesh.** Meshy's Text-to-3D or Image-to-3D gives you a
   textured model. Download it as **GLB**.
2. **Rig it.** A raw text-to-3D export is a *static mesh* — no skeleton, no
   joints. It can be displayed, but it cannot skate, grind or throw a trick.
   Use Meshy's rigging/animation step, or upload the GLB to
   [Mixamo](https://www.mixamo.com), auto-rig it there and download the rigged
   result.
3. **Get animation clips.** Mixamo is the quickest source: grab an idle, a run,
   a jump and a crouch, and export them **with skin** into the same file (or
   merge them in Blender). Name them so the manifest can find them — see below.
4. **Drop it in.** `npm run add-model -- <file.glb>`.

Check what you have at any point:

```bash
npm run inspect-model -- public/assets/characters/beat.glb
```

It reads the glTF container directly — no GL context needed — and tells you the
triangle count, materials, whether there's a skeleton, which clips exist, and
what to fix.

## Clip names

`src/assets/AssetManifest.js` maps game states to the names a model might use:

```js
clips: {
  idle:  ['idle', 'Idle', 'Armature|idle'],
  skate: ['skate', 'run', 'Run', 'Armature|run'],
  air:   ['air', 'jump', 'Jump', 'falling'],
  grind: ['grind', 'crouch', 'Crouch'],
}
```

Any alias matches, and failing that it falls back to a case-insensitive
substring match, because exporters love to prefix clip names with the armature.
Add your own aliases rather than renaming clips by hand.

Trick clips are named by the catalogue: a trick with id `kickflip` looks for a
clip called `trick_kickflip`. Every trick that has no clip still works — the
body-level spin, flip and roll still play, so a model with no trick animations
at all is perfectly playable. See `src/player/Tricks.js` for the full list.

## What happens to the materials

Imported PBR materials are converted to the game's cel materials on the way in
(`src/render/ToonConvert.js`). The base colour texture is kept — that is the
whole point of a textured asset — but it gets re-shaded under the same banded
lighting and the same ink outlines as the rest of the world. A model dropped in
unconverted reads as a smoothly lit object glued onto a flat-shaded city.

Normal maps are kept. Roughness, metalness and AO are dropped, because a toon
material has nowhere to put them.

## Budgets

- **Triangles:** aim for 15–30k for a character. It is drawn up to four times in
  split-screen, twice each (once for the normal pass), so 60k+ gets expensive.
- **Textures:** one 1–2k base colour map per character is plenty for this look.
- **File size:** under about 12 MB. Past that, compress.

## Compression

Draco (geometry) and KTX2/Basis (textures) both work, but their decoders have to
ship with the app:

```bash
npm run assets:decoders
```

That copies them into `public/vendor/`. `inspect-model` tells you when a file
needs it. Call `game.assets.enableCompression()` before loading if you are
loading compressed assets outside the normal manifest path.

## Adding a new kind of asset

1. Add an entry to `MANIFEST` in `src/assets/AssetManifest.js`.
2. Put the file at that path under `public/`.
3. Read it with `game.assets.get('your.id')`.

Leave `optional: true` on anything the game can live without. The single-file
build ships no external assets at all, so anything not marked optional would
break it.

## Where things live

```
public/assets/characters/    character models (.glb)
public/assets/textures/      standalone textures
public/vendor/               Draco / KTX2 decoders, if needed
src/assets/AssetManifest.js  what exists and what it is for
src/assets/AssetManager.js   loading, caching, graceful failure
src/render/ToonConvert.js    PBR to cel conversion
src/player/GltfRig.js        skinned rig: clips, crossfades, trick one-shots
```

`tools/verify-assets.mjs` proves the whole path end to end — it builds a rigged,
animated GLB in the browser, loads it back through the manager, and swaps it in
as a live player rig.
