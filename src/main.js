import './style.css';
import { Game } from './core/Game.js';

const canvas = document.getElementById('viewport');
const uiRoot = document.getElementById('ui');

const game = new Game(canvas, uiRoot);
game.load();
game.start();

canvas.addEventListener('click', () => game.input.requestPointerLock());

// Handy for tinkering from the console.
window.__jsrf = game;
