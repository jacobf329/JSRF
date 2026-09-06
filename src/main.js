import './style.css';
import { Game, MODE } from './core/Game.js';

const canvas = document.getElementById('viewport');
const uiRoot = document.getElementById('ui');

const game = new Game(canvas, uiRoot);
game.load();
game.start();

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
  if (e.code === 'KeyM') game.audio.setMusicEnabled(!game.audio.musicEnabled);
  if (e.code === 'BracketRight') {
    const name = game.audio.nextTrack();
    for (const slot of game.slots) slot.hud.banner(`NOW PLAYING: ${name}`, '#24d6ff', 2);
  }
  if (e.code === 'F3') {
    e.preventDefault();
    game.slots[0].hud.showFps = !game.slots[0].hud.showFps;
  }
  if (e.code === 'F4') {
    e.preventDefault();
    game.renderer.outlinesEnabled = !game.renderer.outlinesEnabled;
  }
});

window.__jsrf = game;
