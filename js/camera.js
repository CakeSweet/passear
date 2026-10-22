import * as THREE from 'three';
import { clamp, damp } from './utils.js';

const MIN_DIST = 2.6;
const MAX_DIST = 16;

/** Câmera em terceira pessoa: arrastar gira, roda aproxima, tudo amortecido. */
export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.yaw = Math.PI;
    this.pitch = 0.34;
    this.dist = 8;

    this.position = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.ready = false;

    this.pointers = new Map();
    this.pinchDistance = 0;

    this._bind();
  }

  _bind() {
    const dom = this.dom;

    dom.addEventListener('pointerdown', (event) => {
      dom.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    dom.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;

      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      previous.x = event.clientX;
      previous.y = event.clientY;

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0) {
          const factor = this.pinchDistance / distance;
          this.dist = clamp(this.dist * factor, MIN_DIST, MAX_DIST);
        }
        this.pinchDistance = distance;
        return;
      }

      this.yaw -= dx * 0.005;
      this.pitch = clamp(this.pitch + dy * 0.004, -0.12, 1.15);
    });

    const release = (event) => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinchDistance = 0;
    };

    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('pointerleave', release);

    dom.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.dist = clamp(this.dist + event.deltaY * 0.008, MIN_DIST, MAX_DIST);
      },
      { passive: false },
    );

    dom.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  reset() {
    const portrait = this.camera.aspect < 0.85;
    this.yaw = Math.PI;
    this.pitch = portrait ? 0.40 : 0.34;
    this.dist = portrait ? 9.5 : 8;
    this.ready = false;
  }

  update(dt, target) {
    const focusX = target.x;
    const focusY = target.y + 1.35;
    const focusZ = target.z;

    const horizontal = Math.cos(this.pitch) * this.dist;

    const desiredX = focusX + Math.sin(this.yaw) * horizontal;
    const desiredY = Math.max(0.75, focusY + Math.sin(this.pitch) * this.dist);
    const desiredZ = focusZ + Math.cos(this.yaw) * horizontal;

    if (!this.ready) {
      this.position.set(desiredX, desiredY, desiredZ);
      this.look.set(focusX, focusY, focusZ);
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-11 * dt);
      this.position.x += (desiredX - this.position.x) * k;
      this.position.y += (desiredY - this.position.y) * k;
      this.position.z += (desiredZ - this.position.z) * k;

      const kl = 1 - Math.exp(-16 * dt);
      this.look.x += (focusX - this.look.x) * kl;
      this.look.y += (focusY - this.look.y) * kl;
      this.look.z += (focusZ - this.look.z) * kl;
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }

  /** Modo menu: órbita lenta ao redor da praça. */
  orbit(dt) {
    this.yaw += dt * 0.09;
    this.pitch = damp(this.pitch, 0.24, 2, dt);
    this.dist = damp(this.dist, this.camera.aspect < 0.85 ? 17 : 13, 2, dt);

    const focus = { x: 0, y: 0.4, z: 0 };
    const horizontal = Math.cos(this.pitch) * this.dist;
    const x = focus.x + Math.sin(this.yaw) * horizontal;
    const y = focus.y + Math.sin(this.pitch) * this.dist;
    const z = focus.z + Math.cos(this.yaw) * horizontal;

    if (!this.ready) {
      this.position.set(x, y, z);
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-3 * dt);
      this.position.x += (x - this.position.x) * k;
      this.position.y += (y - this.position.y) * k;
      this.position.z += (z - this.position.z) * k;
    }

    this.look.set(focus.x, focus.y + 1.2, focus.z);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }
}
