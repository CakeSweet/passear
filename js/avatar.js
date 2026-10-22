import * as THREE from 'three';
import { clamp, damp, hashCode } from './utils.js';

const SKIN_TONES = [0xf3c9a6, 0xe6b58c, 0xd09a6a, 0xb47b4f, 0x8d5a35, 0x6b4023];
const FONT_STACK = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

/**
 * Boneco low-poly montado com primitivas: cabeça, tronco, braços e pernas
 * articulados. A altura final é ~1,9 unidade (1 unidade = 1 metro).
 */
export function createAvatar({ name = 'Boneco', color = '#ff7d6b' } = {}) {
  const seed = hashCode(name);
  const accent = new THREE.Color(color);

  const shirtMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.78, metalness: 0.02 });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0.01, -0.10, -0.24),
    roughness: 0.88,
    metalness: 0,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: SKIN_TONES[seed % SKIN_TONES.length],
    roughness: 0.62,
    metalness: 0,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.075, 0.42, 0.10 + ((seed >>> 5) % 5) * 0.028),
    roughness: 0.92,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c232c, roughness: 0.55 });

  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const mesh = (geometry, material) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    return m;
  };

  // ---- pernas -------------------------------------------------------------
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.125 * side, 0.86, 0);

    const leg = mesh(new THREE.CapsuleGeometry(0.095, 0.62, 5, 12), pantsMat);
    leg.position.y = -0.43;
    pivot.add(leg);

    const foot = mesh(new THREE.BoxGeometry(0.17, 0.1, 0.3), darkMat);
    foot.position.set(0, -0.81, 0.06);
    pivot.add(foot);

    rig.add(pivot);
    legs.push(pivot);
  }

  // ---- tronco -------------------------------------------------------------
  const torso = mesh(new THREE.CapsuleGeometry(0.225, 0.34, 6, 16), shirtMat);
  torso.position.y = 1.14;
  rig.add(torso);

  // cinto, só um detalhe para dar leitura à silhueta
  const belt = mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.08, 16), darkMat);
  belt.position.y = 0.9;
  rig.add(belt);

  // ---- braços -------------------------------------------------------------
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.285 * side, 1.42, 0);

    const arm = mesh(new THREE.CapsuleGeometry(0.072, 0.4, 5, 10), shirtMat);
    arm.position.y = -0.27;
    pivot.add(arm);

    const hand = mesh(new THREE.SphereGeometry(0.078, 12, 10), skinMat);
    hand.position.y = -0.55;
    pivot.add(hand);

    pivot.rotation.z = 0.08 * side;
    rig.add(pivot);
    arms.push(pivot);
  }

  // ---- cabeça -------------------------------------------------------------
  const neck = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.09, 10), skinMat);
  neck.position.y = 1.55;
  rig.add(neck);

  const head = new THREE.Group();
  head.position.y = 1.72;
  rig.add(head);

  const skull = mesh(new THREE.SphereGeometry(0.185, 22, 16), skinMat);
  head.add(skull);

  const hairTop = mesh(
    new THREE.SphereGeometry(0.193, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.44),
    hairMat,
  );
  hairTop.position.y = 0.008;
  head.add(hairTop);

  // nuca: meia casca atrás, para o cabelo não invadir o rosto
  const hairBack = mesh(
    new THREE.SphereGeometry(0.193, 20, 12, Math.PI, Math.PI, Math.PI * 0.44, Math.PI * 0.36),
    hairMat,
  );
  hairBack.position.y = 0.008;
  head.add(hairBack);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), darkMat);
    eye.position.set(0.068 * side, 0.02, 0.158);
    eye.scale.set(1, 1.12, 0.5);
    head.add(eye);
  }

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), skinMat);
  nose.position.set(0, -0.045, 0.172);
  nose.scale.set(0.85, 1.05, 0.9);
  head.add(nose);

  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 6, 16, Math.PI), darkMat);
  mouth.position.set(0, -0.095, 0.158);
  mouth.rotation.z = Math.PI;
  head.add(mouth);

  // ---- etiqueta de nome ---------------------------------------------------
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const labelCtx = labelCanvas.getContext('2d');
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.anisotropy = 4;

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  label.scale.set(2.1, 0.525, 1);
  label.position.y = 2.32;
  label.renderOrder = 10;
  root.add(label);

  let currentName = name;
  let currentColor = color;

  function drawLabel() {
    const { width, height } = labelCanvas;
    labelCtx.clearRect(0, 0, width, height);

    const text = currentName.length > 14 ? `${currentName.slice(0, 13)}…` : currentName;
    labelCtx.font = `600 50px ${FONT_STACK}`;
    labelCtx.textAlign = 'center';
    labelCtx.textBaseline = 'middle';

    const textWidth = Math.ceil(labelCtx.measureText(text).width);
    const boxW = Math.min(width - 8, textWidth + 62);
    const boxH = 82;
    const x = (width - boxW) / 2;
    const y = (height - boxH) / 2;
    const radius = boxH / 2;

    labelCtx.beginPath();
    if (labelCtx.roundRect) {
      labelCtx.roundRect(x, y, boxW, boxH, radius);
    } else {
      labelCtx.moveTo(x + radius, y);
      labelCtx.arcTo(x + boxW, y, x + boxW, y + boxH, radius);
      labelCtx.arcTo(x + boxW, y + boxH, x, y + boxH, radius);
      labelCtx.arcTo(x, y + boxH, x, y, radius);
      labelCtx.arcTo(x, y, x + boxW, y, radius);
      labelCtx.closePath();
    }

    labelCtx.fillStyle = 'rgba(9, 14, 20, 0.74)';
    labelCtx.fill();
    labelCtx.lineWidth = 3;
    labelCtx.strokeStyle = currentColor;
    labelCtx.globalAlpha = 0.85;
    labelCtx.stroke();
    labelCtx.globalAlpha = 1;

    labelCtx.fillStyle = '#eef5fa';
    labelCtx.fillText(text, width / 2, height / 2 + 2);

    labelTexture.needsUpdate = true;
  }

  drawLabel();

  // ---- animação -----------------------------------------------------------
  let phase = Math.random() * Math.PI * 2;
  let idlePhase = phase;
  let bob = 0;

  const pose = {
    legL: 0, legR: 0, armL: 0, armR: 0, armLZ: 0.08, armRZ: -0.08, lean: 0, headTilt: 0,
  };

  function animate(dt, speed = 0, airborne = false) {
    const moving = speed > 0.25;
    const runBlend = clamp(speed / 7.6, 0, 1);

    let legL = 0;
    let legR = 0;
    let armL = 0;
    let armR = 0;
    let armLZ = 0.08;
    let armRZ = -0.08;
    let lean = 0;
    let headTilt = 0;
    let targetBob = 0;

    if (airborne) {
      legL = -0.42;
      legR = 0.28;
      armL = -1.25;
      armR = -1.25;
      armLZ = 0.42;
      armRZ = -0.42;
      lean = 0.04;
    } else if (moving) {
      phase += dt * (4.4 + speed * 1.9);
      const swing = 0.42 + 0.38 * runBlend;
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      legL = s * swing;
      legR = -s * swing;
      armL = -s * swing * 0.9;
      armR = s * swing * 0.9;
      armLZ = 0.10;
      armRZ = -0.10;
      lean = 0.05 + 0.16 * runBlend;
      headTilt = -lean * 0.6;
      targetBob = Math.abs(c) * (0.02 + 0.04 * runBlend);
    } else {
      idlePhase += dt * 1.9;
      const breathe = Math.sin(idlePhase);
      armL = breathe * 0.045;
      armR = -breathe * 0.045;
      armLZ = 0.09 + breathe * 0.012;
      armRZ = -0.09 - breathe * 0.012;
      headTilt = Math.sin(idlePhase * 0.6) * 0.02;
      targetBob = breathe * 0.012;
    }

    const k = 1 - Math.exp(-14 * dt);
    pose.legL += (legL - pose.legL) * k;
    pose.legR += (legR - pose.legR) * k;
    pose.armL += (armL - pose.armL) * k;
    pose.armR += (armR - pose.armR) * k;
    pose.armLZ += (armLZ - pose.armLZ) * k;
    pose.armRZ += (armRZ - pose.armRZ) * k;
    pose.lean += (lean - pose.lean) * k;
    pose.headTilt += (headTilt - pose.headTilt) * k;
    bob = damp(bob, targetBob, 12, dt);

    legs[0].rotation.x = pose.legL;
    legs[1].rotation.x = pose.legR;
    arms[0].rotation.x = pose.armL;
    arms[1].rotation.x = pose.armR;
    arms[0].rotation.z = pose.armLZ;
    arms[1].rotation.z = pose.armRZ;
    torso.rotation.x = pose.lean;
    belt.rotation.x = pose.lean;
    head.rotation.x = pose.headTilt;
    rig.position.y = bob;
  }

  function setName(next) {
    const clean = (next || 'Boneco').slice(0, 16);
    if (clean === currentName) return;
    currentName = clean;
    drawLabel();
  }

  function setColor(next) {
    if (!next || next === currentColor) return;
    currentColor = next;
    accent.set(next);
    shirtMat.color.copy(accent);
    pantsMat.color.copy(accent).offsetHSL(0.01, -0.10, -0.24);
    shirtMat.needsUpdate = true;
    pantsMat.needsUpdate = true;
    drawLabel();
  }

  function dispose() {
    root.removeFromParent();
    const materials = [shirtMat, pantsMat, skinMat, hairMat, darkMat];
    const geometries = new Set();
    root.traverse((obj) => {
      // geometria de Sprite é compartilhada entre todos: não descartar
      if (obj.isMesh && obj.geometry) geometries.add(obj.geometry);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    labelTexture.dispose();
    label.material.dispose();
  }

  return {
    root,
    name: currentName,
    color: currentColor,
    update: animate,
    setName,
    setColor,
    dispose,
    /** altura aproximada, útil para câmera/etiqueta */
    height: 1.9,
  };
}
