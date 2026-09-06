/**
 * Split-screen layouts. Rects are CSS pixels with a top-left origin, matching
 * how the DOM HUD is positioned; the renderer flips them for WebGL.
 */
export function computeViewports(count, width, height) {
  const n = Math.max(1, Math.min(4, count | 0));
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);

  switch (n) {
    case 1:
      return [{ x: 0, y: 0, width, height }];
    case 2:
      // Stacked, so each player keeps the full horizontal field of view.
      return [
        { x: 0, y: 0, width, height: hh },
        { x: 0, y: hh, width, height: height - hh },
      ];
    default:
      return [
        { x: 0, y: 0, width: hw, height: hh },
        { x: hw, y: 0, width: width - hw, height: hh },
        { x: 0, y: hh, width: hw, height: height - hh },
        { x: hw, y: hh, width: width - hw, height: height - hh },
      ].slice(0, n === 3 ? 3 : 4);
  }
}

/** The cell left over in a three-player game, used for the standings panel. */
export function spareCell(count, width, height) {
  if (count !== 3) return null;
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  return { x: hw, y: hh, width: width - hw, height: height - hh };
}

/** Seam positions so the UI can draw dividers over the viewport joins. */
export function seams(count, width, height) {
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  if (count <= 1) return [];
  if (count === 2) return [{ x: 0, y: hh, width, height: 0 }];
  return [
    { x: 0, y: hh, width, height: 0 },
    { x: hw, y: 0, width: 0, height },
  ];
}
