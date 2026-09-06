import * as THREE from 'three';
import { makeRng } from '../core/MathUtils.js';

const WORDS = [
  'JET SET', 'RUDIE', 'GG', 'FUTURE', 'TOKYO-TO', 'BEAT', 'RADIO',
  'FLY', 'KICKS', 'NOISE', 'ROLL', '99', 'GRIND', 'CREW', 'SLIDE',
];

const PALETTES = [
  ['#ff2f87', '#ffd21e', '#12131c'],
  ['#24d6ff', '#a8ff3e', '#12131c'],
  ['#ff7a1a', '#ff2f87', '#12131c'],
  ['#9a5cff', '#24d6ff', '#12131c'],
  ['#a8ff3e', '#ff4d2e', '#12131c'],
  ['#ffd21e', '#ff4d2e', '#12131c'],
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, cx, cy, spikes, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Draws a piece of wildstyle-ish graffiti onto a canvas and returns it as a
 * texture. Everything is procedural, so no two tags in a run look alike.
 */
export function makeTagCanvas({ word, seed = Date.now(), width = 640, height = 448 } = {}) {
  const rng = makeRng(seed || 1);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const text = (word || WORDS[Math.floor(rng() * WORDS.length)]).toUpperCase();
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)];
  const [main, accent, ink] = palette;

  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // --- backdrop blob so the piece reads against any wall colour ---
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = accent;
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rng() - 0.5) * 0.16);
  ctx.beginPath();
  const lobes = 8;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const r = (0.34 + rng() * 0.1) * width * (1 + 0.22 * Math.cos(a * 2));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.62;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- accents behind the letters ---
  ctx.save();
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = i % 2 ? main : '#ffffff';
    star(ctx, rng() * width, rng() * height, 4, 26 + rng() * 22, 7);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.restore();

  // --- the word, letter by letter with a hand-thrown wobble ---
  const chars = text.split('');
  const baseSize = Math.min(190, (width * 1.55) / Math.max(4, chars.length));
  ctx.font = `900 ${baseSize}px "Archivo Black", Impact, "Arial Black", sans-serif`;

  const widths = chars.map((c) => ctx.measureText(c).width);
  const spacing = -baseSize * 0.07;
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = width / 2 - total / 2;
  const baseY = height * 0.52;
  const letterBoxes = [];

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const w = widths[i];
    const cx = x + w / 2;
    const cy = baseY + Math.sin(i * 1.3 + rng()) * baseSize * 0.09;
    const rot = (rng() - 0.5) * 0.3;
    const scale = 0.9 + rng() * 0.28;

    if (c !== ' ') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(scale, scale * (0.95 + rng() * 0.2));

      // Drop shadow slab.
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.55;
      ctx.fillText(c, 10, 12);
      ctx.globalAlpha = 1;

      // Thick ink outline, then a coloured keyline, then the fill.
      ctx.lineWidth = baseSize * 0.34;
      ctx.strokeStyle = ink;
      ctx.strokeText(c, 0, 0);
      ctx.lineWidth = baseSize * 0.2;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(c, 0, 0);
      ctx.lineWidth = baseSize * 0.1;
      ctx.strokeStyle = ink;
      ctx.strokeText(c, 0, 0);

      const grad = ctx.createLinearGradient(0, -baseSize / 2, 0, baseSize / 2);
      grad.addColorStop(0, main);
      grad.addColorStop(1, accent);
      ctx.fillStyle = grad;
      ctx.fillText(c, 0, 0);

      // Gloss.
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.rect(-w, -baseSize * 0.52, w * 2, baseSize * 0.2);
      ctx.clip();
      ctx.fillText(c, 0, 0);
      ctx.restore();

      ctx.restore();
      letterBoxes.push({ cx, cy, w: w * scale });
    }
    x += w + spacing;
  }

  // --- drips ---
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  for (const box of letterBoxes) {
    if (rng() > 0.55) continue;
    const dx = box.cx + (rng() - 0.5) * box.w * 0.55;
    const dy = box.cy + baseSize * 0.34;
    const len = baseSize * (0.2 + rng() * 0.5);
    const w = 9 + rng() * 9;
    ctx.fillStyle = main;
    roundRect(ctx, dx - w / 2, dy, w, len, w / 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dx, dy + len, w * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // --- splatter ---
  ctx.save();
  for (let i = 0; i < 40; i++) {
    const r = 1.5 + rng() * 6;
    ctx.globalAlpha = 0.35 + rng() * 0.5;
    ctx.fillStyle = rng() > 0.5 ? main : accent;
    ctx.beginPath();
    ctx.arc(rng() * width, rng() * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // --- signature underline ---
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 10;
  ctx.beginPath();
  const uy = baseY + baseSize * 0.6;
  ctx.moveTo(width * 0.18, uy);
  ctx.bezierCurveTo(width * 0.4, uy + 26, width * 0.62, uy - 22, width * 0.86, uy + 6);
  ctx.stroke();
  ctx.restore();

  return { canvas, word: text, palette };
}

export function makeTagTexture(options) {
  const { canvas, word, palette } = makeTagCanvas(options);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { texture: tex, word, palette };
}

/** Dashed target frame drawn once and shared by every un-tagged spot marker. */
let markerTexture = null;
export function tagMarkerTexture() {
  if (markerTexture) return markerTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.setLineDash([26, 18]);
  ctx.strokeRect(16, 16, size - 32, size - 32);
  ctx.setLineDash([]);

  // Corner brackets.
  ctx.lineWidth = 14;
  const c = 46;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = sx > 0 ? 16 : size - 16;
    const y = sy > 0 ? 16 : size - 16;
    ctx.beginPath();
    ctx.moveTo(x + sx * c, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * c);
    ctx.stroke();
  }

  // Spray can glyph.
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, size / 2 - 26, size / 2 - 40, 52, 84, 12);
  ctx.fill();
  ctx.fillRect(size / 2 - 12, size / 2 - 56, 24, 18);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    ctx.arc(size / 2 + 44 + i * 12, size / 2 - 58 - i * 8, 5 - i * 0.6, 0, Math.PI * 2);
  }
  ctx.fill();

  markerTexture = new THREE.CanvasTexture(canvas);
  markerTexture.colorSpace = THREE.SRGBColorSpace;
  return markerTexture;
}

export { WORDS };
