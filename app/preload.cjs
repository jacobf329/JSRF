/**
 * The only bridge between the game and the desktop shell.
 *
 * Deliberately tiny and explicit: the renderer gets four functions, not Node.
 * Everything here has a browser fallback in src/core/Platform.js, so the same
 * game code runs unchanged in a plain browser tab.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jsrfShell', {
  isDesktop: true,
  version: () => ipcRenderer.invoke('jsrf:version'),
  loadSave: () => ipcRenderer.invoke('jsrf:load'),
  saveGame: (data) => ipcRenderer.invoke('jsrf:save', data),
  toggleFullscreen: (value) => ipcRenderer.invoke('jsrf:fullscreen', value),
  quit: () => ipcRenderer.invoke('jsrf:quit'),
});
