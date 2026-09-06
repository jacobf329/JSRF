import { clamp } from './MathUtils.js';

/**
 * Action names every source produces. Gameplay code only ever asks a source
 * for these, so a keyboard, a second keyboard scheme and a gamepad are all
 * interchangeable.
 */
export const ACTIONS = [
  'up', 'down', 'left', 'right',
  'jump', 'boost', 'spray',
  'camLeft', 'camRight', 'camReset',
  'pause', 'confirm', 'back',
];

// Player 1: WASD + mouse.
const SCHEME_PRIMARY = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'boost',
  KeyE: 'spray', KeyF: 'spray',
  KeyQ: 'camLeft', KeyR: 'camRight', KeyC: 'camReset',
  Escape: 'pause', Enter: 'confirm', Backspace: 'back',
};

// Player 2 sharing the same keyboard: arrows + the number pad / right-hand keys.
const SCHEME_SECONDARY = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Numpad0: 'jump', ShiftRight: 'jump',
  ControlRight: 'boost', Numpad1: 'boost',
  Period: 'spray', Numpad2: 'spray', Slash: 'spray',
  Numpad4: 'camLeft', Numpad6: 'camRight', Numpad5: 'camReset',
  NumpadEnter: 'confirm',
};

// Standard gamepad mapping.
const PAD_BUTTONS = {
  0: 'jump',
  1: 'back',
  2: 'spray',
  3: 'camReset',
  5: 'boost',
  7: 'boost',
  9: 'pause',
  8: 'confirm',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

function applyDeadzone(x, y, dz) {
  const mag = Math.hypot(x, y);
  if (mag < dz) return { x: 0, y: 0, mag: 0 };
  const scaled = (mag - dz) / (1 - dz);
  return { x: (x / mag) * scaled, y: (y / mag) * scaled, mag: scaled };
}

/** One controller's worth of state. Shared API across every device type. */
export class InputSource {
  constructor(id, label) {
    this.id = id;
    this.label = label;
    this.actions = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.enabled = true;
    this.connected = true;
  }

  down(action) { return this.enabled && this.actions.has(action); }
  pressed(action) { return this.enabled && this.pressedThisFrame.has(action); }
  released(action) { return this.enabled && this.releasedThisFrame.has(action); }

  /** Ignores `enabled`, so menus stay reachable while gameplay input is off. */
  pressedRaw(action) { return this.pressedThisFrame.has(action); }

  _press(action) {
    if (!this.actions.has(action)) this.pressedThisFrame.add(action);
    this.actions.add(action);
  }

  _release(action) {
    if (this.actions.has(action)) this.releasedThisFrame.add(action);
    this.actions.delete(action);
  }

  _setDigitalMove() {
    let x = (this.actions.has('right') ? 1 : 0) - (this.actions.has('left') ? 1 : 0);
    let y = (this.actions.has('up') ? 1 : 0) - (this.actions.has('down') ? 1 : 0);
    const mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; }
    this.move.x = x;
    this.move.y = y;
  }

  releaseAll() {
    for (const a of Array.from(this.actions)) this._release(a);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }
}

class KeyboardSource extends InputSource {
  constructor(id, label, scheme, { useMouse = false } = {}) {
    super(id, label);
    this.scheme = scheme;
    this.useMouse = useMouse;
  }

  handleKey(code, isDown) {
    const action = this.scheme[code];
    if (!action) return false;
    if (isDown) this._press(action); else this._release(action);
    return true;
  }

  update(manager) {
    this._setDigitalMove();
    this.look.x = (this.actions.has('camRight') ? 1 : 0) - (this.actions.has('camLeft') ? 1 : 0);
    this.look.y = 0;
    if (this.useMouse) {
      this.pointerLocked = manager.pointerLocked;
      this.mouseDelta.x = manager.mouseDelta.x;
      this.mouseDelta.y = manager.mouseDelta.y;
    }
  }
}

class GamepadSource extends InputSource {
  constructor(id, label, padIndex) {
    super(id, label);
    this.padIndex = padIndex;
    this.deadzone = 0.22;
  }

  update(manager) {
    const pad = manager.getPad(this.padIndex);
    this.connected = !!pad;
    if (!pad) {
      this.releaseAll();
      this.move.x = 0; this.move.y = 0;
      this.look.x = 0; this.look.y = 0;
      return;
    }

    const stick = applyDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), this.deadzone);
    const rstick = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.deadzone);

    for (const [index, action] of Object.entries(PAD_BUTTONS)) {
      const btn = pad.buttons[Number(index)];
      if (!btn) continue;
      if (btn.pressed) this._press(action); else this._release(action);
    }
    // Analog triggers double as boost on pads without digital shoulder buttons.
    const rt = pad.buttons[7];
    if (rt && rt.value > 0.35) this._press('boost');

    if (stick.mag > 0) {
      this.move.x = stick.x;
      this.move.y = stick.y;
    } else {
      this._setDigitalMove();
    }
    this.look.x = clamp(rstick.x, -1, 1);
    this.look.y = clamp(rstick.y, -1, 1);
  }
}

/**
 * Owns the raw browser listeners and hands out one `InputSource` per player.
 *
 * Player 1 gets keyboard + mouse; extra players get gamepads in connection
 * order, falling back to the second keyboard scheme for player 2.
 */
export class InputManager {
  constructor(domElement) {
    this.dom = domElement;
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.pads = [];
    this.lastPadCount = 0;

    this.keyboardPrimary = new KeyboardSource('kb1', 'Keyboard + Mouse', SCHEME_PRIMARY, { useMouse: true });
    this.keyboardSecondary = new KeyboardSource('kb2', 'Arrows + Numpad', SCHEME_SECONDARY);
    this.keyboards = [this.keyboardPrimary, this.keyboardSecondary];
    this.gamepadSources = [];
    this.sources = [...this.keyboards];

    this._onKeyDown = (e) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      for (const kb of this.keyboards) kb.handleKey(e.code, true);
    };
    this._onKeyUp = (e) => {
      for (const kb of this.keyboards) kb.handleKey(e.code, false);
    };
    this._onBlur = () => {
      for (const s of this.sources) s.releaseAll();
    };
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) this.keyboardPrimary._press('spray');
      if (e.button === 2) this.keyboardPrimary._press('boost');
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.keyboardPrimary._release('spray');
      if (e.button === 2) this.keyboardPrimary._release('boost');
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  getPad(index) {
    return this.pads[index] || null;
  }

  get padCount() { return this.pads.length; }

  /** How many players this machine can actually drive right now. */
  get maxPlayers() {
    return Math.min(4, 1 + Math.max(this.padCount, this.padCount > 0 ? this.padCount : 1));
  }

  /**
   * Devices for `count` players: keyboard first, then each connected pad,
   * then the second keyboard scheme as a stand-in for player 2.
   */
  assign(count) {
    const out = [this.keyboardPrimary];
    let padCursor = 0;
    for (let i = 1; i < count; i++) {
      if (padCursor < this.gamepadSources.length) {
        out.push(this.gamepadSources[padCursor++]);
      } else if (!out.includes(this.keyboardSecondary)) {
        out.push(this.keyboardSecondary);
      } else {
        // Nothing left to drive this slot -- hand back a dead source so the
        // caller can show "no controller" rather than crash.
        const dead = new InputSource(`none${i}`, 'No controller');
        dead.connected = false;
        out.push(dead);
      }
    }
    return out;
  }

  /** Pretty labels for the player-select screen, in assignment order. */
  describeAssignment(count) {
    return this.assign(count).map((s, i) => ({ player: i + 1, label: s.label, connected: s.connected }));
  }

  requestPointerLock() {
    if (!this.pointerLocked && this.dom.requestPointerLock) {
      const req = this.dom.requestPointerLock();
      if (req && typeof req.catch === 'function') req.catch(() => {});
    }
  }

  exitPointerLock() {
    if (this.pointerLocked && document.exitPointerLock) document.exitPointerLock();
  }

  _pollPads() {
    if (!navigator.getGamepads) { this.pads = []; return; }
    const raw = navigator.getGamepads();
    this.pads = [];
    for (const p of raw) if (p && p.connected) this.pads.push(p);

    if (this.pads.length !== this.lastPadCount) {
      this.lastPadCount = this.pads.length;
      while (this.gamepadSources.length < this.pads.length) {
        const i = this.gamepadSources.length;
        const src = new GamepadSource(`pad${i}`, `Gamepad ${i + 1}`, i);
        this.gamepadSources.push(src);
        this.sources.push(src);
      }
    }
  }

  update() {
    this._pollPads();
    for (const s of this.sources) s.update(this);
  }

  endFrame() {
    for (const s of this.sources) s.endFrame();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  /** True if any device pressed the action -- used for menu navigation. */
  anyPressed(action) {
    for (const s of this.sources) if (s.pressedRaw(action)) return true;
    return false;
  }

  setEnabled(enabled) {
    for (const s of this.sources) s.enabled = enabled;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.dom.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
