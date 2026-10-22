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

  const offset = new THREE.Vector3(24, 34, 16);

  /** Mantém a luz/sombra acompanhando quem joga. */
  function updateSun(target) {
    sun.position.copy(target).add(offset);
    sun.target.position.set(target.x, 0, target.z);
    sun.target.updateMatrixWorld();
  }

  return { scene, sun, ground, plaza, updateSun };
}
