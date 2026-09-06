/**
 * One seam between the game and whatever is hosting it.
 *
 * In the desktop app the preload script exposes `window.jsrfShell`; in a plain
 * browser tab there is nothing, so everything here falls back to what a page
 * can do on its own. Game code never has to know which one it is running in.
 */
const shell = typeof window !== 'undefined' ? window.jsrfShell : null;

const STORAGE_KEY = 'jsrf.save.v1';

export const Platform = {
  get isDesktop() { return !!(shell && shell.isDesktop); },

  get name() { return this.isDesktop ? 'desktop' : 'browser'; },

  async version() {
    if (shell) {
      try { return await shell.version(); } catch { /* fall through */ }
    }
    return null;
  },

  /** Returns the saved object, or null when there is nothing saved yet. */
  async loadSave() {
    if (shell) {
      try { return await shell.loadSave(); } catch { /* fall through to storage */ }
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // Private windows and file:// pages can both refuse storage outright.
      return null;
    }
  },

  async saveGame(data) {
    if (shell) {
      try { return await shell.saveGame(data); } catch { /* fall through */ }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  },

  async toggleFullscreen(value) {
    if (shell) {
      try { return await shell.toggleFullscreen(value); } catch { /* fall through */ }
    }
    const wanted = value === undefined ? !document.fullscreenElement : !!value;
    try {
      if (wanted) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* the browser may simply refuse without a gesture */ }
    return !!document.fullscreenElement;
  },

  quit() {
    if (shell) { shell.quit(); return true; }
    return false;   // a browser tab cannot close itself it did not open
  },
};
