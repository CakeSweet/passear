import * as THREE from 'three';
import { clamp, damp } from './utils.js';

const MIN_DIST = 2.6;
const MAX_DIST = 16;
const FIRST_PERSON_ENTER = 3.05;
const FIRST_PERSON_EXIT_DIST = 3.8;
const firstPersonEye = 0.22;

/** Câmera em terceira pessoa: arrastar gira, roda aproxima, tudo amortecido. */
export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.yaw = Math.PI;
    this.pitch = 0.34;
    this.dist = 8;
    this.firstPerson = false;
    this.onModeChange = null;
    this._distBefore = this.dist;

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
          if (this.firstPerson) {
            // Fechar a pinça (afastar a câmera) sai da primeira pessoa.
            if (distance < this.pinchDistance - 2) this.setFirstPerson(false);
          } else {
            const factor = this.pinchDistance / distance;
            const next = clamp(this.dist * factor, MIN_DIST, MAX_DIST);
            this.dist = next;
            if (factor < 1 && next <= FIRST_PERSON_ENTER) this.setFirstPerson(true);
          }
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
        if (this.firstPerson) {
          if (event.deltaY > 0) this.setFirstPerson(false);
          return;
        }

        const next = clamp(this.dist + event.deltaY * 0.008, MIN_DIST, MAX_DIST);
        this.dist = next;
        if (event.deltaY < 0 && next <= FIRST_PERSON_ENTER) this.setFirstPerson(true);
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
    this.firstPerson = false;
    this._distBefore = this.dist;
    this.ready = false;
    this.onModeChange?.(false);
  }

  /** Alterna entre a câmera de terceira pessoa e a visão em primeira pessoa. */
  setFirstPerson(value) {
    const next = Boolean(value);
    if (next === this.firstPerson) return this.firstPerson;

    if (next) {
      this._distBefore = Math.max(this.dist, FIRST_PERSON_EXIT_DIST);
      this.dist = MIN_DIST;
    } else {
      this.dist = Math.max(this._distBefore, FIRST_PERSON_EXIT_DIST);
    }

    this.firstPerson = next;
    this.ready = false;
    this.onModeChange?.(next);
    return next;
  }

  toggleFirstPerson() {
    return this.setFirstPerson(!this.firstPerson);
  }

  update(dt, target, focusHeight = 1.35) {
    const focusX = target.x;
    const focusY = target.y + focusHeight + (this.firstPerson ? firstPersonEye : 0);
    const focusZ = target.z;

    // Primeira pessoa: a câmera mora no olho e olha na direção do yaw/pitch.
    if (this.firstPerson) {
      const cosPitch = Math.cos(this.pitch);
      const dirX = -Math.sin(this.yaw) * cosPitch;
      const dirY = -Math.sin(this.pitch);
      const dirZ = -Math.cos(this.yaw) * cosPitch;

      this.position.set(focusX, focusY, focusZ);
      this.look.set(focusX + dirX * 3, focusY + dirY * 3, focusZ + dirZ * 3);
      this.ready = true;
      this.camera.position.copy(this.position);
      this.camera.lookAt(this.look);
      return;
    }

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
