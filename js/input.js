import { clamp, isTouch } from './utils.js';

const ZERO = { forward: 0, right: 0, run: false, jump: false };

/** Teclado + joystick virtual. */
export class Input {
  constructor() {
    this.keys = new Set();
    /** teclas apertadas desde a última leitura (ações de borda: entrar/sair, cair) */
    this.pressed = new Set();
    this.axisX = 0;
    this.axisY = 0;
    this.jumpHeld = false;
    this.enabled = false;
    this.touch = isTouch();

    this._bindKeyboard();
    this._bindJoystick();
    this._bindJumpButton();
  }

  _isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  _bindKeyboard() {
    const handled = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'ShiftLeft', 'ShiftRight',
      'KeyE', 'KeyR',
    ]);

    window.addEventListener('keydown', (event) => {
      if (!this.enabled || this._isTyping()) return;
      if (!handled.has(event.code)) return;
      if (event.code === 'Space') event.preventDefault();
      this.keys.add(event.code);
      if (!event.repeat) this.pressed.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pressed.clear();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this.pressed.clear();
      }
    });
    document.addEventListener('focusin', (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        this.keys.clear();
        this.pressed.clear();
      }
    });
  }

  _bindJoystick() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stickKnob');
    if (!stick || !knob) return;

    const radius = 44;
    let pointerId = null;

    const reset = () => {
      pointerId = null;
      this.axisX = 0;
      this.axisY = 0;
      stick.classList.remove('active');
      knob.style.transform = 'translate(0px, 0px)';
    };

    stick.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      stick.setPointerCapture?.(pointerId);
      stick.classList.add('active');
      this._moveKnob(event, stick, knob, radius);
    });

    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      this._moveKnob(event, stick, knob, radius);
    });

    const end = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      reset();
    };

    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    stick.addEventListener('lostpointercapture', reset);

    this.resetJoystick = reset;
  }

  _moveKnob(event, stick, knob, radius) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }

    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.axisX = dx / radius;
    this.axisY = -dy / radius;
  }

  _bindJumpButton() {
    const button = document.getElementById('jumpBtn');
    if (!button) return;

    const press = (event) => {
      event.preventDefault();
      this.jumpHeld = true;
    };
    const release = () => {
      this.jumpHeld = false;
    };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
  }

  setEnabled(value) {
    this.enabled = value;
    if (!value) {
      this.keys.clear();
      this.pressed.clear();
      this.jumpHeld = false;
      this.resetJoystick?.();
    }
  }

  /** Ação de borda: devolve true uma única vez por aperto. */
  wasPressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  get state() {
    if (!this.enabled || this._isTyping()) return ZERO;

    let forward = this.axisY;
    let right = this.axisX;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;

    return {
      forward: clamp(forward, -1, 1),
      right: clamp(right, -1, 1),
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      jump: this.keys.has('Space') || this.jumpHeld,
    };
  }
}
