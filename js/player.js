import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clampToWorld, dampAngle } from './utils.js';

const forwardVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const wishVec = new THREE.Vector3();

/** Boneco controlado pelo jogador local + física simples de chão. */
export class LocalPlayer {
  constructor(avatar) {
    this.avatar = avatar;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector2(0, 0);
    this.vy = 0;
    this.yaw = 0;
    this.onGround = true;
    this.speed = 0;
    this.crouching = false;
    /** Altura do piso no ponto (para o ringue); 0 = gramado. */
    this.groundAt = null;
  }

  spawn(x = 0, z = 0, yaw = 0) {
    this.pos.set(x, 0, z);
    clampToWorld(this.pos, CONFIG.world.bounds - 1);
    this.velocity.set(0, 0);
    this.vy = 0;
    this.yaw = yaw;
    this.onGround = true;
    this.speed = 0;
    this._apply();
  }

  update(dt, input, cameraYaw) {
    const { walk, run, accel, jump, gravity, turn } = CONFIG.move;

    this.crouching = Boolean(input.crouch) && this.onGround;

    // direção relativa à câmera
    forwardVec.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    rightVec.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));

    wishVec
      .set(0, 0, 0)
      .addScaledVector(forwardVec, input.forward)
      .addScaledVector(rightVec, input.right);

    const wishLength = wishVec.length();
    if (wishLength > 1) wishVec.divideScalar(wishLength);

    const speedLimit = this.crouching ? walk * 0.48 : input.run ? run : walk;
    const targetX = wishVec.x * speedLimit;
    const targetZ = wishVec.z * speedLimit;

    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (targetX - this.velocity.x) * k;
    this.velocity.y += (targetZ - this.velocity.y) * k;

    this.pos.x += this.velocity.x * dt;
    this.pos.z += this.velocity.y * dt;

    // limite circular do mundo
    if (clampToWorld(this.pos, CONFIG.world.bounds)) {
      this.velocity.multiplyScalar(0.4);
    }

    if (wishLength > 0.05) {
      const targetYaw = Math.atan2(wishVec.x, wishVec.z);
      this.yaw = dampAngle(this.yaw, targetYaw, turn, dt);
    }

    // Sobe degraus/rampa quando a diferença é pequena; o ringue usa isso.
    const floor = this.groundAt ? this.groundAt(this.pos.x, this.pos.z) : 0;
    if (this.onGround && Math.abs(floor - this.pos.y) <= 0.28) {
      // acompanha a rampa suavemente, para cima ou para baixo
      this.pos.y = floor;
      this.vy = 0;
    } else if (this.onGround && floor > this.pos.y && floor - this.pos.y <= 0.62) {
      // degrau baixo (borda do ringue)
      this.pos.y = floor;
      this.vy = 0;
    }

    if (input.jump && this.onGround) {
      this.vy = jump;
      this.onGround = false;
    }

    this.vy -= gravity * dt;
    this.pos.y += this.vy * dt;

    if (this.pos.y <= floor) {
      this.pos.y = floor;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.y);

    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.update(dt, this.speed, !this.onGround, false, this.crouching);
  }

  _apply() {
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.yaw;
  }

  snapshot(seat = -1) {
    return {
      p: [
        Math.round(this.pos.x * 100) / 100,
        Math.round(this.pos.y * 100) / 100,
        Math.round(this.pos.z * 100) / 100,
      ],
      r: Math.round(this.yaw * 1000) / 1000,
      s: Math.round(this.speed * 100) / 100,
      a: this.onGround ? 0 : 1,
      k: Number.isFinite(seat) ? seat : -1,
      c: this.crouching ? 1 : 0,
    };
  }
}
