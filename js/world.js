import * as THREE from 'three';
import { CONFIG } from './config.js';

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Com flipY, o topo da imagem vira o zênite (v = 1) e o meio, o horizonte.
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0.0, '#1d466b');
  gradient.addColorStop(0.18, '#2c6390');
  gradient.addColorStop(0.32, '#4a89b9');
  gradient.addColorStop(0.42, '#77b1d7');
  gradient.addColorStop(0.47, '#a8d1e8');
  gradient.addColorStop(0.50, '#cfe8f5');
  gradient.addColorStop(0.56, '#e8f3fa');
  gradient.addColorStop(1.0, '#eef6fa');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGroundTexture(renderer) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#7da76b';
  ctx.fillRect(0, 0, size, size);

  // manchas suaves de grama
  for (let i = 0; i < 220; i++) {
    const r = 8 + Math.random() * 46;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = Math.random() > 0.5 ? 'rgba(148, 190, 128, 0.16)' : 'rgba(86, 122, 76, 0.16)';
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // divisa do tile (dá noção de escala e velocidade)
  ctx.strokeStyle = 'rgba(52, 78, 46, 0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(CONFIG.world.size / 5, CONFIG.world.size / 5);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makePlazaTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#cfd6c4';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120, 132, 112, 0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

/** Posição e medidas do ringue de ragdoll combat. */
export const RING = {
  x: 0,
  z: 24,
  radius: 7.2,
  height: 0.55,
  rampWidth: 3.6,
  rampLength: 4.2,
};

/** Altura do piso no ringue: lona elevada + rampa de entrada. */
export function ringFloorHeight(x, z) {
  const dx = x - RING.x;
  const dz = z - RING.z;
  const distance = Math.hypot(dx, dz);

  if (distance <= RING.radius) return RING.height;

  // rampa no lado que olha para a praça (z negativo em relação ao ringue)
  if (
    Math.abs(dx) <= RING.rampWidth / 2 &&
    dz < -RING.radius &&
    dz >= -RING.radius - RING.rampLength
  ) {
    const t = (-dz - RING.radius) / RING.rampLength;
    return RING.height * (1 - t);
  }

  return 0;
}

function makeRingTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 30, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, '#b34a5c');
  gradient.addColorStop(0.55, '#8f2f43');
  gradient.addColorStop(1, '#5c1d2c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // círculos concêntricos da lona
  ctx.strokeStyle = 'rgba(255, 226, 207, 0.72)';
  ctx.lineWidth = 8;
  for (const radius of [size * 0.19, size * 0.34, size * 0.46]) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 226, 207, 0.26)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(size / 2 + Math.cos(angle) * size * 0.19, size / 2 + Math.sin(angle) * size * 0.19);
    ctx.lineTo(size / 2 + Math.cos(angle) * size * 0.46, size / 2 + Math.sin(angle) * size * 0.46);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 240, 230, 0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 116px system-ui, "Segoe UI", Arial, sans-serif';
  ctx.fillText('RAGDOLL', size / 2, size / 2 - 42);
  ctx.font = '800 62px system-ui, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255, 218, 205, 0.86)';
  ctx.fillText('COMBAT', size / 2, size / 2 + 58);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // A lona é vista de frente para a rampa: gira o desenho para o texto ficar
  // legível para quem chega pela praça.
  texture.center.set(0.5, 0.5);
  texture.rotation = Math.PI;
  return texture;
}

/**
 * Cria a cena: céu em gradiente, luz com sombra, chão plano e a praça central.
 */
export function createWorld(renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd8e7ef, CONFIG.world.fogNear, CONFIG.world.fogFar);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 20),
    new THREE.MeshBasicMaterial({
      map: makeSkyTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xdbeeff, 0x5f7a4c, 1.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  sun.position.set(24, 34, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.world.size, CONFIG.world.size, 1, 1),
    new THREE.MeshStandardMaterial({
      map: makeGroundTexture(renderer),
      roughness: 0.96,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({
      map: makePlazaTexture(),
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.95,
    }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.004;
  plaza.receiveShadow = true;
  scene.add(plaza);

  const plazaRing = new THREE.Mesh(
    new THREE.RingGeometry(8.85, 9.35, 96),
    new THREE.MeshStandardMaterial({ color: 0x7d8a73, roughness: 1, transparent: true, opacity: 0.55 }),
  );
  plazaRing.rotation.x = -Math.PI / 2;
  plazaRing.position.y = 0.006;
  scene.add(plazaRing);

  const boundary = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.world.bounds, CONFIG.world.bounds + 0.35, 160),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.y = 0.008;
  scene.add(boundary);

  // ------------------------------------------------------------- ringue
  const ringGroup = new THREE.Group();
  ringGroup.position.set(RING.x, 0, RING.z);
  scene.add(ringGroup);

  const apron = new THREE.Mesh(
    new THREE.CylinderGeometry(RING.radius + 0.2, RING.radius + 0.35, 0.28, 64),
    new THREE.MeshStandardMaterial({ color: 0x2b1c25, roughness: 0.9, metalness: 0.05 }),
  );
  apron.position.y = 0.14;
  apron.receiveShadow = true;
  ringGroup.add(apron);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(RING.radius, RING.radius, RING.height, 64),
    new THREE.MeshStandardMaterial({ color: 0x4a2632, roughness: 0.88, metalness: 0.02 }),
  );
  platform.position.y = RING.height / 2;
  platform.castShadow = true;
  platform.receiveShadow = true;
  ringGroup.add(platform);

  const canvasMat = new THREE.MeshStandardMaterial({
    map: makeRingTexture(),
    roughness: 0.82,
    metalness: 0.01,
  });
  const canvasTop = new THREE.Mesh(new THREE.CircleGeometry(RING.radius - 0.06, 64), canvasMat);
  canvasTop.rotation.x = -Math.PI / 2;
  canvasTop.position.y = RING.height + 0.003;
  canvasTop.receiveShadow = true;
  ringGroup.add(canvasTop);

  // rampa de entrada, no lado voltado para a praça
  const rampAngle = Math.atan2(RING.height, RING.rampLength);
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(RING.rampWidth, 0.14, RING.rampLength),
    new THREE.MeshStandardMaterial({ color: 0x6f4a35, roughness: 0.92 }),
  );
  ramp.position.set(
    0,
    RING.height - 0.07 - (RING.rampLength / 2) * Math.sin(rampAngle),
    -RING.radius - RING.rampLength / 2,
  );
  ramp.rotation.x = -rampAngle;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  ringGroup.add(ramp);

  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 2.25, 10);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.42, metalness: 0.55 });
  const postCapGeo = new THREE.SphereGeometry(0.1, 10, 8);
  const postCapMat = new THREE.MeshStandardMaterial({ color: 0xd7dde3, roughness: 0.35, metalness: 0.5 });
  const postRadius = RING.radius + 0.5;

  for (let i = 0; i < 8; i++) {
    // desloca meia casa para não nascer um poste no meio da rampa
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(Math.cos(angle) * postRadius, 1.12, Math.sin(angle) * postRadius);
    post.castShadow = true;
    ringGroup.add(post);

    const cap = new THREE.Mesh(postCapGeo, postCapMat);
    cap.position.set(post.position.x, 2.27, post.position.z);
    cap.castShadow = true;
    ringGroup.add(cap);
  }

  const ropeGeo = new THREE.TorusGeometry(postRadius, 0.038, 8, 96);
  const ropeColors = [0xe05b4f, 0xf2e9df, 0x5b9cf6];
  [1.12, 1.58, 2.04].forEach((height, index) => {
    const rope = new THREE.Mesh(
      ropeGeo,
      new THREE.MeshStandardMaterial({ color: ropeColors[index], roughness: 0.55, metalness: 0.08 }),
    );
    rope.rotation.x = Math.PI / 2;
    rope.position.y = height;
    rope.castShadow = true;
    ringGroup.add(rope);
  });

  const ring = {
    ...RING,
    group: ringGroup,
    floorHeightAt: ringFloorHeight,
  };

  const offset = new THREE.Vector3(24, 34, 16);

  /** Mantém a luz/sombra acompanhando quem joga. */
  function updateSun(target) {
    sun.position.copy(target).add(offset);
    sun.target.position.set(target.x, 0, target.z);
    sun.target.updateMatrixWorld();
  }

  return { scene, sun, ground, plaza, ring, updateSun };
}
