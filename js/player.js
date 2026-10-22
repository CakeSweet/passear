import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, dampAngle } from './utils.js';

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
  }

  spawn(x = 0, z = 0, yaw = 0) {
    const limit = CONFIG.world.bounds - 1;
    this.pos.set(clamp(x, -limit, limit), 0, clamp(z, -limit, limit));
    this.velocity.set(0, 0);
    this.vy = 0;
    this.yaw = yaw;
    this.onGround = true;
    this.speed = 0;
    this._apply();
  }

  update(dt, input, cameraYaw) {
    const { walk, run, accel, jump, gravity, turn } = CONFIG.move;

    // direção relativa à câmera
    forwardVec.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    rightVec.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));

    wishVec
      .set(0, 0, 0)
      .addScaledVector(forwardVec, input.forward)
      .addScaledVector(rightVec, input.right);

    const wishLength = wishVec.length();
    if (wishLength > 1) wishVec.divideScalar(wishLength);

    const maxSpeed = input.run ? run : walk;
    const targetX = wishVec.x * maxSpeed;
    const targetZ = wishVec.z * maxSpeed;

    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (targetX - this.velocity.x) * k;
    this.velocity.y += (targetZ - this.velocity.y) * k;

    this.pos.x += this.velocity.x * dt;
    this.pos.z += this.velocity.y * dt;

    // limite circular do mundo
    const limit = CONFIG.world.bounds;
    const distance = Math.hypot(this.pos.x, this.pos.z);
    if (distance > limit) {
      const scale = limit / distance;
      this.pos.x *= scale;
      this.pos.z *= scale;
      this.velocity.multiplyScalar(0.4);
    }

    if (wishLength > 0.05) {
      const targetYaw = Math.atan2(wishVec.x, wishVec.z);
      this.yaw = dampAngle(this.yaw, targetYaw, turn, dt);
    }

    if (input.jump && this.onGround) {
      this.vy = jump;
      this.onGround = false;
    }

    this.vy -= gravity * dt;
    this.pos.y += this.vy * dt;

    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.onGround = true;
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.y);

    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.update(dt, this.speed, !this.onGround);
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
    };
  }
}
