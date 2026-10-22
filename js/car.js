import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, dampAngle } from './utils.js';

/**
 * Bancos do carro, em coordenadas locais. O carro olha para +Z (mesma
 * convenção do boneco): z positivo é a frente.
 */
export const CAR_SEATS = [
  { x: -0.44, z: 0.58, label: 'motorista' },
  { x: 0.44, z: 0.58, label: 'passageiro' },
  { x: -0.44, z: -0.78, label: 'banco de trás' },
  { x: 0.44, z: -0.78, label: 'banco de trás' },
];

/** Altura do assento e do quadril do boneco em pé. */
const SEAT_Y = 0.72;
const HIP_Y = 0.86;
const WHEEL_RADIUS = 0.37;

/** Buggy aberto de 4 lugares, montado com primitivas. */
export class Car {
  constructor({ color = '#d9543f' } = {}) {
    const spawn = CONFIG.car.spawn;
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = spawn.yaw;
    this.speed = 0;
    this.steer = 0;
    this.spin = 0;

    this.group = new THREE.Group();
    this._materials = [];
    this._geometries = [];
    this._build(color);
    this.sync(0);
  }

  // ------------------------------------------------------------- visual

  _mat(options) {
    const material = new THREE.MeshStandardMaterial(options);
    this._materials.push(material);
    return material;
  }

  _geo(geometry) {
    this._geometries.push(geometry);
    return geometry;
  }

  _build(color) {
    const bodyMat = this._mat({ color, roughness: 0.42, metalness: 0.22 });
    const darkMat = this._mat({ color: 0x1d232b, roughness: 0.7, metalness: 0.18 });
    const seatMat = this._mat({ color: 0x2a3038, roughness: 0.9 });
    const chromeMat = this._mat({ color: 0xc3ccd6, roughness: 0.32, metalness: 0.85 });
    const lightMat = this._mat({
      color: 0xfff6d6,
      emissive: 0xffe7a1,
      emissiveIntensity: 1.1,
      roughness: 0.35,
    });
    const tailMat = this._mat({
      color: 0x8d1c1c,
      emissive: 0xff3d2a,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });

    const add = (geometry, material, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // casco
    add(this._geo(new THREE.BoxGeometry(1.78, 0.24, 3.9)), darkMat, 0, 0.33, 0);
    add(this._geo(new THREE.BoxGeometry(1.92, 0.38, 3.66)), bodyMat, 0, 0.55, -0.06);
    add(this._geo(new THREE.BoxGeometry(1.72, 0.24, 1.0)), bodyMat, 0, 0.77, 1.36);
    add(this._geo(new THREE.BoxGeometry(1.72, 0.2, 0.72)), bodyMat, 0, 0.76, -1.52);

    // laterais
    add(this._geo(new THREE.BoxGeometry(0.16, 0.32, 2.9)), bodyMat, -0.9, 0.83, -0.05);
    add(this._geo(new THREE.BoxGeometry(0.16, 0.32, 2.9)), bodyMat, 0.9, 0.83, -0.05);

    // para-choques
    add(this._geo(new THREE.BoxGeometry(1.94, 0.18, 0.22)), darkMat, 0, 0.44, 1.98);
    add(this._geo(new THREE.BoxGeometry(1.94, 0.18, 0.22)), darkMat, 0, 0.44, -1.98);

    // faróis e lanternas
    add(this._geo(new THREE.BoxGeometry(0.28, 0.16, 0.08)), lightMat, -0.62, 0.82, 1.9);
    add(this._geo(new THREE.BoxGeometry(0.28, 0.16, 0.08)), lightMat, 0.62, 0.82, 1.9);
    add(this._geo(new THREE.BoxGeometry(0.22, 0.13, 0.07)), tailMat, -0.74, 0.8, -1.9);
    add(this._geo(new THREE.BoxGeometry(0.22, 0.13, 0.07)), tailMat, 0.74, 0.8, -1.9);

    // bancos
    for (const seat of CAR_SEATS) {
      add(this._geo(new THREE.BoxGeometry(0.58, 0.14, 0.56)), seatMat, seat.x, 0.7, seat.z);
      const back = add(
        this._geo(new THREE.BoxGeometry(0.58, 0.62, 0.14)),
        seatMat,
        seat.x,
        0.98,
        seat.z - 0.31,
      );
      back.rotation.x = -0.12;
    }

    // volante
    const wheel = add(this._geo(new THREE.TorusGeometry(0.155, 0.032, 8, 20)), darkMat, -0.44, 1.0, 1.02);
    wheel.rotation.x = -1.02;
    add(this._geo(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8)), darkMat, -0.44, 0.9, 1.1);

    // arco de proteção
    const postGeo = this._geo(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 10));
    for (const x of [-0.8, 0.8]) {
      const post = add(postGeo, chromeMat, x, 1.32, 0.02);
      post.rotation.z = x > 0 ? -0.05 : 0.05;
    }
    const bar = add(this._geo(new THREE.CylinderGeometry(0.05, 0.05, 1.62, 10)), chromeMat, 0, 1.86, 0.02);
    bar.rotation.z = Math.PI / 2;

    // rodas
    this.wheels = [];
    const tyreGeo = this._geo(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 18));
    const rimGeo = this._geo(new THREE.CylinderGeometry(0.19, 0.19, 0.32, 12));

    for (const [x, z] of [[-0.93, 1.3], [0.93, 1.3], [-0.93, -1.3], [0.93, -1.3]]) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(x, WHEEL_RADIUS, z);
      this.group.add(steerPivot);

      const axis = new THREE.Group();
      axis.rotation.z = Math.PI / 2;
      steerPivot.add(axis);

      const tyre = new THREE.Mesh(tyreGeo, darkMat);
      tyre.castShadow = true;
      axis.add(tyre);

      const rim = new THREE.Mesh(rimGeo, chromeMat);
      rim.castShadow = true;
      axis.add(rim);

      this.wheels.push({ steerPivot, tyre, rim, front: z > 0 });
    }
  }

  // ------------------------------------------------------------- estado

  get pose() {
    return {
      x: Math.round(this.x * 100) / 100,
      z: Math.round(this.z * 100) / 100,
      yaw: Math.round(this.yaw * 1000) / 1000,
      v: Math.round(this.speed * 100) / 100,
      st: Math.round(this.steer * 100) / 100,
    };
  }

  setPose(pose) {
    if (!pose) return;
    if (Number.isFinite(pose.x)) this.x = pose.x;
    if (Number.isFinite(pose.z)) this.z = pose.z;
    if (Number.isFinite(pose.yaw)) this.yaw = pose.yaw;
    if (Number.isFinite(pose.v)) this.speed = pose.v;
    if (Number.isFinite(pose.st)) this.steer = pose.st;
  }

  /** Quem não está dirigindo persegue a pose recebida pela rede. */
  remoteUpdate(dt, pose) {
    if (!pose) return;
    const k = 1 - Math.exp(-20 * dt);
    this.x += (pose.x - this.x) * k;
    this.z += (pose.z - this.z) * k;
    this.yaw = dampAngle(this.yaw, pose.yaw, 16, dt);
    this.speed = damp(this.speed, Number(pose.v) || 0, 12, dt);
    this.steer = damp(this.steer, Number(pose.st) || 0, 10, dt);
  }

  /** Direção arcade: acelera, freia e vira mais quanto mais rápido. */
  drive(dt, input) {
    const cfg = CONFIG.car;
    const forward = clamp(input.forward || 0, -1, 1);
    const targetSteer = clamp(input.right || 0, -1, 1);

    if (forward > 0.06) {
      this.speed += cfg.accel * forward * dt;
    } else if (forward < -0.06) {
      // no sentido contrário ao movimento: freio; parado: ré
      const rate = this.speed > 0.2 ? cfg.brake : cfg.reverseAccel;
      this.speed += rate * forward * dt;
    } else {
      this.speed *= Math.exp(-cfg.drag * dt);
    }

    if (Math.abs(this.speed) < 0.06) this.speed = 0;
    this.speed = clamp(this.speed, -cfg.maxReverse, cfg.maxSpeed);

    this.steer = damp(this.steer, targetSteer, 7, dt);

    const grip = clamp(Math.abs(this.speed) / 3.5, 0, 1);
    // O carro olha para +Z: virar à direita (D) diminui o yaw.
    this.yaw -= this.steer * cfg.turnRate * grip * dt * Math.sign(this.speed || 1);

    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;

    const limit = CONFIG.world.bounds - 2;
    const distance = Math.hypot(this.x, this.z);
    if (distance > limit) {
      const scale = limit / distance;
      this.x *= scale;
      this.z *= scale;
      this.speed *= 0.25;
    }
  }

  sync(dt) {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;

    this.spin += (this.speed * dt) / WHEEL_RADIUS;

    for (const wheel of this.wheels) {
      wheel.tyre.rotation.y = this.spin;
      wheel.rim.rotation.y = this.spin;
      wheel.steerPivot.rotation.y = wheel.front ? -this.steer * 0.42 : 0;
    }
  }

  // -------------------------------------------------------------- bancos

  /** Posição do "pé" do boneco para sentar no banco (o quadril cai no assento). */
  seatRoot(index, out = new THREE.Vector3()) {
    const seat = CAR_SEATS[index] ?? CAR_SEATS[0];
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);

    return out.set(
      this.x + seat.x * cos + seat.z * sin,
      SEAT_Y - HIP_Y,
      this.z - seat.x * sin + seat.z * cos,
    );
  }

  toWorld(localX, localZ, out = new THREE.Vector3()) {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    return out.set(
      this.x + localX * cos + localZ * sin,
      0,
      this.z - localX * sin + localZ * cos,
    );
  }

  // ------------------------------------------------------------ colisão

  /** Um boneco em pé no caminho de um carro rápido? */
  hits(position, margin = 0.4) {
    if (Math.abs(this.speed) < 4) return false;

    const dx = position.x - this.x;
    const dz = position.z - this.z;
    if (dx * dx + dz * dz > 28) return false;

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    return Math.abs(localX) < 1.12 + margin && Math.abs(localZ) < 2.05 + margin;
  }

  /** Empurrão que o carro passa para o ragdoll de quem foi atingido. */
  impulse(out = new THREE.Vector3()) {
    const push = this.speed * 0.6;
    return out.set(Math.sin(this.yaw) * push, 2.5 + Math.abs(this.speed) * 0.16, Math.cos(this.yaw) * push);
  }

  dispose() {
    this.group.removeFromParent();
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
  }
}
