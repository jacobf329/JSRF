import './style.css';
import { Game, MODE } from './core/Game.js';
import { Platform } from './core/Platform.js';

const canvas = document.getElementById('viewport');
const uiRoot = document.getElementById('ui');

const game = new Game(canvas, uiRoot);
game.load();
game.start();

// Drop the boot screen once a frame has actually been drawn, not merely when
// the script finishes: building the district and compiling shaders is the slow
// part, and it happens inside that first frame.
requestAnimationFrame(() => requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('is-done');
  setTimeout(() => boot.remove(), 400);
}));

// Any first gesture unlocks audio; clicking the viewport grabs the mouse.
const kick = () => game.audio.init();
window.addEventListener('pointerdown', kick, { once: true });
window.addEventListener('keydown', kick, { once: true });

canvas.addEventListener('click', () => {
  if (game.mode === MODE.TITLE) game.onMenuAction('start');
  else if (game.mode === MODE.PLAYING) game.input.requestPointerLock();
});

// Re-poll pads on the title screen so hot-plugged controllers show up.
window.addEventListener('gamepadconnected', () => {
  if (game.mode === MODE.TITLE) game.menus.refreshPlayers();
});
window.addEventListener('gamepaddisconnected', () => {
  if (game.mode === MODE.TITLE) game.menus.refreshPlayers();
});

window.addEventListener('keydown', (e) => {
  if (game.mode === MODE.TITLE) {
    if (e.code === 'Enter') game.onMenuAction('start');
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 4) game.onMenuAction('players', n);
    }
  }
  if (e.code === 'KeyM') {
    game.audio.setMusicEnabled(!game.audio.musicEnabled);
    game.profile.set('musicEnabled', game.audio.musicEnabled);
  }
  // The desktop shell handles F11 itself in the main process; doing it here as
  // well would toggle twice and land back where it started.
  if (e.code === 'F11' && !Platform.isDesktop) {
    e.preventDefault();
    Platform.toggleFullscreen();
  }
  if (e.code === 'BracketRight') {
    const name = game.audio.nextTrack();
    for (const slot of game.slots) slot.hud.banner(`NOW PLAYING: ${name}`, '#24d6ff', 2);
  }
  if (e.code === 'F3') {
    e.preventDefault();
    const on = !game.slots[0].hud.showFps;
    game.slots[0].hud.showFps = on;
    game.profile.set('showFps', on);
  }
  if (e.code === 'F4') {
    e.preventDefault();
    game.renderer.outlinesEnabled = !game.renderer.outlinesEnabled;
  }
});

window.__jsrf = game;
