import { clamp } from './MathUtils.js';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  KeyE: 'spray', KeyF: 'spray',
  KeyQ: 'camLeft',
  KeyR: 'camRight',
  KeyC: 'camReset',
  Escape: 'pause', KeyP: 'pause',
  Digit1: 'trick1', Digit2: 'trick2', Digit3: 'trick3',
  Enter: 'confirm',
  Tab: 'map',
};

/**
 * Unified keyboard / mouse / gamepad input.
 *
 * Digital keys and buttons feed the same action table, so gameplay code only
 * ever asks `input.down('jump')` / `input.pressed('spray')`.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.actions = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();

    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.gamepadIndex = null;
    this.usingGamepad = false;
    this.enabled = true;

    this._onKeyDown = (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      const action = KEY_MAP[e.code];
      if (action) this._press(action);
      this.usingGamepad = false;
    };
    this._onKeyUp = (e) => {
      const action = KEY_MAP[e.code];
      if (action) this._release(action);
    };
    this._onBlur = () => {
      for (const a of Array.from(this.actions)) this._release(a);
    };
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) this._press('spray');
      if (e.button === 2) this._press('boost');
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this._release('spray');
      if (e.button === 2) this._release('boost');
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    };
    this._onGamepadConnected = (e) => { this.gamepadIndex = e.gamepad.index; };
    this._onGamepadDisconnected = () => { this.gamepadIndex = null; };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    window.addEventListener('gamepadconnected', this._onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
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

  _press(action) {
    if (!this.actions.has(action)) this.pressedThisFrame.add(action);
    this.actions.add(action);
  }

  _release(action) {
    if (this.actions.has(action)) this.releasedThisFrame.add(action);
    this.actions.delete(action);
  }

  down(action) { return this.enabled && this.actions.has(action); }
  pressed(action) { return this.enabled && this.pressedThisFrame.has(action); }
  released(action) { return this.enabled && this.releasedThisFrame.has(action); }

  /** Poll analog sources. Call once per frame before gameplay updates. */
  update() {
    // Digital keys -> analog stick vector.
    let x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let y = (this.down('up') ? 1 : 0) - (this.down('down') ? 1 : 0);

    let lookX = (this.down('camRight') ? 1 : 0) - (this.down('camLeft') ? 1 : 0);
    let lookY = 0;

    const pad = this._pollGamepad();
    if (pad) {
      const [ax, ay, rx, ry] = pad.axes;
      const dz = 0.22;
      const stick = applyDeadzone(ax ?? 0, -(ay ?? 0), dz);
      if (stick.mag > 0) {
        x = stick.x;
        y = stick.y;
        this.usingGamepad = true;
      }
      const rstick = applyDeadzone(rx ?? 0, ry ?? 0, dz);
      if (rstick.mag > 0) {
        lookX = rstick.x;
        lookY = rstick.y;
        this.usingGamepad = true;
      }
      this._syncPadButton(pad, 0, 'jump');
      this._syncPadButton(pad, 2, 'spray');
      this._syncPadButton(pad, 5, 'boost');
      this._syncPadButton(pad, 7, 'boost');
      this._syncPadButton(pad, 1, 'camReset');
      this._syncPadButton(pad, 9, 'pause');
      this._syncPadButton(pad, 3, 'trick1');
      this._syncPadButton(pad, 8, 'map');
    }

    const mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; }
    this.move.x = x;
    this.move.y = y;

    this.look.x = clamp(lookX, -1, 1);
    this.look.y = clamp(lookY, -1, 1);
  }

  _syncPadButton(pad, index, action) {
    const btn = pad.buttons[index];
    if (!btn) return;
    if (btn.pressed) this._press(action);
    else this._release(action);
  }

  _pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.gamepadIndex !== null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) {
      if (p && p.connected) { this.gamepadIndex = p.index; return p; }
    }
    return null;
  }

  /** Clear per-frame edge state. Call at the very end of the frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
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
    window.removeEventListener('gamepadconnected', this._onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
  }
}

function applyDeadzone(x, y, dz) {
  const mag = Math.hypot(x, y);
  if (mag < dz) return { x: 0, y: 0, mag: 0 };
  const scaled = (mag - dz) / (1 - dz);
  return { x: (x / mag) * scaled, y: (y / mag) * scaled, mag: scaled };
}
