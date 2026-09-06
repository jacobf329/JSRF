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

window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && game.mode === MODE.TITLE) game.onMenuAction('start');
  if (e.code === 'KeyM') game.audio.setMusicEnabled(!game.audio.musicEnabled);
  if (e.code === 'BracketRight') game.hud.banner(`NOW PLAYING: ${game.audio.nextTrack()}`, '#24d6ff', 2);
  if (e.code === 'F3') { e.preventDefault(); game.hud.showFps = !game.hud.showFps; }
  if (e.code === 'F4') { e.preventDefault(); game.renderer.outlinesEnabled = !game.renderer.outlinesEnabled; }
});

window.__jsrf = game;
