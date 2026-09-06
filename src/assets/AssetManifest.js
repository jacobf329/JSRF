/**
 * Everything the game will load from disk.
 *
 * Assets are declared here rather than fetched ad hoc so that one place says
 * what exists, what it is for, and whether the game can run without it.
 * `optional: true` means a missing file is a shrug, not a crash -- which is
 * what keeps the single-file build (which ships no external assets at all)
 * working exactly as it does today.
 *
 * Paths are relative to the app root, so they resolve the same under Vite's
 * dev server, the packaged app:// scheme, and a plain static host.
 */

export const ASSET_KIND = {
  MODEL: 'model',
  TEXTURE: 'texture',
};

export const MANIFEST = [
  {
    id: 'character.beat',
    kind: ASSET_KIND.MODEL,
    url: 'assets/characters/beat.glb',
    optional: true,
    // How the imported materials should be treated. `toon` re-shades them into
    // the game's cel look while keeping their base colour textures.
    shading: 'toon',
    // Clip names the rig will look for. Missing ones fall back to the
    // procedural animation, so a model can arrive with only some of them.
    clips: {
      idle: ['idle', 'Idle', 'Armature|idle'],
      skate: ['skate', 'run', 'Run', 'Armature|run'],
      air: ['air', 'jump', 'Jump', 'falling'],
      grind: ['grind', 'crouch', 'Crouch'],
    },
  },
];

export function manifestById(id) {
  return MANIFEST.find((entry) => entry.id === id) || null;
}
