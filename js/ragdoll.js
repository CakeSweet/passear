import * as THREE from 'three';

/**
 * Ragdoll por integração de Verlet: cada articulação é um ponto com massa e as
 * conexões são restrições de distância resolvidas por relaxação. É leve,
 * estável no chão plano e fácil de sincronizar (só posições).
 *
 * Quem simula é o dono do boneco; os outros recebem as posições e interpolam.
 */

const UP = new THREE.Vector3(0, 1, 0);
const STEP = 1 / 120;

const HEAD = 0;
const CHEST = 1;
const HIPS = 2;
const SH_L = 3;
const EL_L = 4;
const HA_L = 5;
const SH_R = 6;
const EL_R = 7;
const HA_R = 8;
const KN_L = 9;
const FT_L = 10;
const KN_R = 11;
const FT_R = 12;
const COUNT = 13;

/** Pose de repouso, em metros, relativa aos pés. */
const REST = [
  [0, 1.7, 0],
  [0, 1.33, 0],
  [0, 0.86, 0],
  [-0.28, 1.42, 0],
  [-0.3, 1.1, 0],
  [-0.31, 0.85, 0],
  [0.28, 1.42, 0],
  [0.3, 1.1, 0],
  [0.31, 0.85, 0],
  [-0.12, 0.47, 0],
  [-0.12, 0.06, 0.04],
  [0.12, 0.47, 0],
  [0.12, 0.06, 0.04],
];

/** Raio de colisão com o chão de cada ponto. */
const RADIUS = [0.17, 0.16, 0.13, 0.07, 0.06, 0.055, 0.07, 0.06, 0.055, 0.08, 0.07, 0.08, 0.07];

const LINKS = [
  [HEAD, CHEST],
  [CHEST, HIPS],
  [CHEST, SH_L],
  [SH_L, EL_L],
  [EL_L, HA_L],
  [CHEST, SH_R],
  [SH_R, EL_R],
  [EL_R, HA_R],
  [HIPS, KN_L],
  [KN_L, FT_L],
  [HIPS, KN_R],
  [KN_R, FT_R],
  [HIPS, SH_L],
  [HIPS, SH_R],
  [HEAD, SH_L],
  [HEAD, SH_R],
  [SH_L, SH_R],
];

const REST_LENGTHS = LINKS.map(([a, b]) => {
  const pa = REST[a];
  const pb = REST[b];
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
});

const GRAVITY = 20;
const ITERATIONS = 8;

export class Ragdoll {
  constructor({ color = '#ff7d6b', skin = 0xd09a6a, bounds = 88 } = {}) {
    this.bounds = bounds;
    this.remote = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.remoteReady = false;
    this.acc = 0;
    this.still = 0;

    this.points = Array.from({ length: COUNT }, () => new THREE.Vector3());
    this.prev = Array.from({ length: COUNT }, () => new THREE.Vector3());
    this.targets = Array.from({ length: COUNT }, () => new THREE.Vector3());
    this.focus = new THREE.Vector3();
    this._lastChest = new THREE.Vector3();

    this._materials = [];
    this._geometries = [];
    this._buildVisual(color, skin);
  }

  // ------------------------------------------------------------- visual

  _material(hex, rough = 0.72) {
    const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.04 });
    this._materials.push(mat);
    return mat;
  }

  _geometry(geometry) {
    this._geometries.push(geometry);
    return geometry;
  }

  _bone(a, b, material, radius, shape = 'capsule') {
    const index = LINKS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
    const length = REST_LENGTHS[index] ?? 0.3;
    const geometry =
      shape === 'box'
        ? this._geometry(new THREE.BoxGeometry(radius * 4.6, length, radius * 3))
        : this._geometry(new THREE.CapsuleGeometry(radius, Math.max(0.02, length - radius * 2), 4, 10));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.bones.push({ mesh, a, b });
    return mesh;
  }

  _buildVisual(color, skin) {
    const accent = new THREE.Color(color);
    const shirt = this._material(accent, 0.75);
    const pants = this._material(accent.clone().offsetHSL(0.01, -0.1, -0.24), 0.85);
    const skinMat = this._material(skin, 0.62);
    const hairMat = this._material(new THREE.Color(0x2a1e18), 0.92);
    const shoeMat = this._material(0x1c232c, 0.55);

    this.bones = [];

    this._bone(HIPS, CHEST, shirt, 0.185);
    this.torsoBone = this.bones[this.bones.length - 1];

    this.pelvis = new THREE.Mesh(
      this._geometry(new THREE.BoxGeometry(0.34, 0.22, 0.25)),
      pants,
    );
    this.pelvis.castShadow = true;
    this.group.add(this.pelvis);

    this._bone(SH_L, EL_L, shirt, 0.072);
    this._bone(EL_L, HA_L, shirt, 0.06);
    this._bone(SH_R, EL_R, shirt, 0.072);
    this._bone(EL_R, HA_R, shirt, 0.06);

    this._bone(HIPS, KN_L, pants, 0.088);
    this._bone(KN_L, FT_L, pants, 0.08);
    this._bone(HIPS, KN_R, pants, 0.088);
    this._bone(KN_R, FT_R, pants, 0.08);

    this.headGroup = new THREE.Group();
    const skull = new THREE.Mesh(this._geometry(new THREE.SphereGeometry(0.18, 20, 14)), skinMat);
    skull.castShadow = true;
    this.headGroup.add(skull);

    const hair = new THREE.Mesh(
      this._geometry(new THREE.SphereGeometry(0.188, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)),
      hairMat,
    );
    hair.position.y = 0.006;
    this.headGroup.add(hair);
    this.group.add(this.headGroup);

    const footGeo = this._geometry(new THREE.BoxGeometry(0.16, 0.09, 0.26));
    this.footL = new THREE.Mesh(footGeo, shoeMat);
    this.footR = new THREE.Mesh(footGeo, shoeMat);
    this.footL.castShadow = true;
    this.footR.castShadow = true;
    this.group.add(this.footL, this.footR);

    const handGeo = this._geometry(new THREE.SphereGeometry(0.075, 12, 10));
    this.handL = new THREE.Mesh(handGeo, skinMat);
    this.handR = new THREE.Mesh(handGeo, skinMat);
    this.handL.castShadow = true;
    this.handR.castShadow = true;
    this.group.add(this.handL, this.handR);
  }

  // -------------------------------------------------------------- início

  /** Coloca o ragdoll na posição atual do boneco e aplica um empurrão. */
  launch({ position, yaw = 0, velocity = null }) {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const v = velocity ?? { x: 0, y: 0, z: 0 };

    for (let i = 0; i < COUNT; i++) {
      const rest = REST[i];
      const point = this.points[i];

      point.set(
        position.x + rest[0] * cos + rest[2] * sin,
        position.y + rest[1],
        position.z - rest[0] * sin + rest[2] * cos,
      );

      // pontos mais altos recebem mais impulso: o corpo gira ao cair
      const spread = 0.45 + (rest[1] / 1.7) * 1.15;
      const jitter = 0.5;

      this.prev[i].set(
        point.x - (v.x * spread + (Math.random() - 0.5) * jitter) * STEP,
        point.y - (v.y * spread + Math.random() * jitter * 0.6) * STEP,
        point.z - (v.z * spread + (Math.random() - 0.5) * jitter) * STEP,
      );
    }

    this.acc = 0;
    this.still = 0;
    this.group.visible = true;
    this._lastChest.copy(this.points[CHEST]);
    this.syncMeshes();
  }

  // ------------------------------------------------------------ física

  _integrate() {
    const damping = 0.997;

    for (let i = 0; i < COUNT; i++) {
      const p = this.points[i];
      const q = this.prev[i];

      const vx = (p.x - q.x) * damping;
      const vy = (p.y - q.y) * damping;
      const vz = (p.z - q.z) * damping;

      q.copy(p);
      p.x += vx;
      p.y += vy - GRAVITY * STEP * STEP;
      p.z += vz;
    }

    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (let l = 0; l < LINKS.length; l++) {
        const [ai, bi] = LINKS[l];
        const a = this.points[ai];
        const b = this.points[bi];

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;

        const distance = Math.hypot(dx, dy, dz) || 1e-6;
        const difference = ((distance - REST_LENGTHS[l]) / distance) * 0.5;

        dx *= difference;
        dy *= difference;
        dz *= difference;

        a.x += dx;
        a.y += dy;
        a.z += dz;
        b.x -= dx;
        b.y -= dy;
        b.z -= dz;
      }

      // chão + limite do mundo
      for (let i = 0; i < COUNT; i++) {
        const p = this.points[i];
        const r = RADIUS[i];

        if (p.y < r) {
          const q = this.prev[i];
          p.y = r;
          q.x = p.x - (p.x - q.x) * 0.72;
          q.z = p.z - (p.z - q.z) * 0.72;
          q.y = p.y;
        }

        const limit = this.bounds;
        if (p.x > limit) p.x = limit;
        else if (p.x < -limit) p.x = -limit;
        if (p.z > limit) p.z = limit;
        else if (p.z < -limit) p.z = -limit;
      }
    }
  }

  step(dt) {
    if (this.remote) {
      if (!this.remoteReady) {
        for (let i = 0; i < COUNT; i++) this.points[i].copy(this.targets[i]);
        this.remoteReady = true;
      } else {
        const k = 1 - Math.exp(-18 * dt);
        for (let i = 0; i < COUNT; i++) this.points[i].lerp(this.targets[i], k);
      }
      this.syncMeshes();
      return;
    }

    this.acc = Math.min(this.acc + dt, 0.1);
    let steps = 0;

    while (this.acc >= STEP && steps < 10) {
      this._integrate();
      this.acc -= STEP;
      steps++;
    }

    if (steps > 0) {
      const moved = this.points[CHEST].distanceTo(this._lastChest);
      this._lastChest.copy(this.points[CHEST]);
      this.still = moved < 0.004 ? this.still + dt : 0;
    }

    this.syncMeshes();
  }

  syncMeshes() {
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (const bone of this.bones) {
      const a = this.points[bone.a];
      const b = this.points[bone.b];

      mid.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a);
      const length = dir.length() || 1;

      bone.mesh.position.copy(mid);
      bone.mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
    }

    this.pelvis.position.copy(this.points[HIPS]);
    this.pelvis.quaternion.copy(this.torsoBone.mesh.quaternion);

    const head = this.points[HEAD];
    this.headGroup.position.copy(head);
    dir.subVectors(head, this.points[CHEST]).normalize();
    this.headGroup.quaternion.setFromUnitVectors(UP, dir);

    // mãos e pés acompanham as pontas
    this.handL.position.copy(this.points[HA_L]);
    this.handR.position.copy(this.points[HA_R]);

    dir.subVectors(this.points[FT_L], this.points[KN_L]).normalize();
    this.footL.quaternion.setFromUnitVectors(UP, dir);
    dir.subVectors(this.points[FT_R], this.points[KN_R]).normalize();
    this.footR.quaternion.setFromUnitVectors(UP, dir);

    this.footL.position.copy(this.points[FT_L]);
    this.footR.position.copy(this.points[FT_R]);

    this.focus.addVectors(this.points[CHEST], this.points[HEAD]).multiplyScalar(0.5);
  }

  // ------------------------------------------------------------- rede

  serialize() {
    const out = new Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const p = this.points[i];
      out[i * 3] = Math.round(p.x * 100) / 100;
      out[i * 3 + 1] = Math.round(p.y * 100) / 100;
      out[i * 3 + 2] = Math.round(p.z * 100) / 100;
    }
    return out;
  }

  applyRemote(list) {
    if (!Array.isArray(list) || list.length !== COUNT * 3) return;
    for (let i = 0; i < COUNT; i++) {
      this.targets[i].set(list[i * 3], list[i * 3 + 1], list[i * 3 + 2]);
    }
  }

  get hips() {
    return this.points[HIPS];
  }

  get readyToStand() {
    return this.still > 0.7;
  }

  dispose() {
    this.group.removeFromParent();
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
  }
}
