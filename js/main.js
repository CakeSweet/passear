import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createAvatar } from './avatar.js';
import { LocalPlayer } from './player.js';
import { CameraRig } from './camera.js';
import { Network } from './network.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Car, CAR_SEATS } from './car.js';
import { Ragdoll } from './ragdoll.js';
import { AudioEngine } from './audio.js';
import { clampToWorld, colorForName, dampAngle, randomCode } from './utils.js';

const ORIGIN = new THREE.Vector3(0, 0, 0);

const canvas = document.getElementById('view');
const ui = new UI();
const input = new Input();
const audio = new AudioEngine();
const soundBtn = document.getElementById('soundBtn');

function syncSoundButton() {
  if (!soundBtn) return;
  const on = !audio.muted;
  soundBtn.textContent = on ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Desligar som' : 'Ativar som');
  soundBtn.title = on ? 'Desligar som' : 'Ativar som';
}

syncSoundButton();
soundBtn?.addEventListener('click', () => {
  audio.toggleMuted();
  syncSoundButton();
});

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  console.error(error);
  ui.setStatus('Seu navegador não conseguiu iniciar o WebGL.', 'error');
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const world = createWorld(renderer);
const scene = world.scene;

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
const rig = new CameraRig(camera, canvas);
const viewBtn = document.getElementById('viewBtn');

function syncViewButton(firstPerson = rig.firstPerson) {
  if (!viewBtn) return;
  viewBtn.textContent = firstPerson ? '1ª' : '3ª';
  viewBtn.setAttribute('aria-pressed', String(firstPerson));
  viewBtn.setAttribute(
    'aria-label',
    firstPerson ? 'Câmera em primeira pessoa; voltar para terceira' : 'Câmera em terceira pessoa; mudar para primeira',
  );
  viewBtn.title = firstPerson ? 'Voltar para 3ª pessoa (V)' : 'Mudar para 1ª pessoa (V)';
}

rig.onModeChange = syncViewButton;
syncViewButton();
viewBtn?.addEventListener('click', () => {
  rig.toggleFirstPerson();
  syncViewButton();
});

/** @type {Network|null} */
let net = null;
/** @type {{id:string,name:string,color:string,avatar:any,player:LocalPlayer}|null} */
let me = null;
/** @type {Map<string, any>} */
const remotes = new Map();

/** @type {Car|null} */
let car = null;
/** pose que os passageiros perseguem */
let carTarget = null;

/** banco ocupado pelo jogador local (-1 = a pé) */
let mySeat = -1;
/** @type {Ragdoll|null} */
let myRagdoll = null;
/** pose do carro recebida no welcome antes de o carro existir */
let pendingWorld = null;

let hitCooldownUntil = 0;
let ragdollEndAt = 0;
let ragdollReadyAt = 0;
let ragdollSendTimer = 0;
let carSendTimer = 0;

/** Tempo sem novas poses até considerar que o motorista sumiu (ms). */
const CAR_TARGET_TIMEOUT_MS = 400;
let carTargetAt = 0;
let carTargetFrom = null;

const PLAYER_RADIUS = 0.62;
const PUNCH_RANGE = 1.85;
const PUNCH_COOLDOWN_MS = 900;
const PUNCH_IMPULSE = 4.6;
const PUNCH_LIFT = 4.0;
let punchReadyAt = 0;

const carFocus = new THREE.Vector3();
const scratch = new THREE.Vector3();
const hitImpulse = new THREE.Vector3();

let connecting = false;
let joined = false;
let lastError = null;
let lastUnavailableToastAt = -Infinity;
let sendTimer = 0;
let pingTimer = 0;
let lastTime = performance.now();

// ---------------------------------------------------------------- rede

function wireNetwork(network) {
  network.on('peer-join', (profile) => {
    audio.join();
    addRemote(profile);
  });

  network.on('peer-leave', (person) => removeRemote(person.id, person.name));

  network.on('peer-state', (id, message) => {
    const remote = remotes.get(id);
    if (!remote || !Array.isArray(message.p)) return;

    const [x, y, z] = message.p;
    remote.target.set(x || 0, y || 0, z || 0);

    if (typeof message.r === 'number') remote.targetYaw = message.r;
    remote.speed = typeof message.s === 'number' ? message.s : 0;
    remote.airborne = Number(message.a) === 1;
    remote.crouching = Number(message.c) === 1;
    remote.seat = Number.isFinite(message.k) ? message.k : -1;

    // se a diferença for grande (entrou agora, teleportou), cola de uma vez
    if (remote.seat < 0 && remote.pos.distanceToSquared(remote.target) > 400) {
      remote.pos.copy(remote.target);
      remote.yaw = remote.targetYaw;
    }
  });

  network.on('peer-car', (id, message) => {
    if (mySeat === 0) return; // o motorista manda, não obedece
    if (!Number.isFinite(message.x) || !Number.isFinite(message.z) || !Number.isFinite(message.yaw)) {
      return;
    }
    carTarget = {
      x: message.x,
      z: message.z,
      yaw: message.yaw,
      v: Number(message.v) || 0,
      st: Number(message.st) || 0,
    };
    carTargetAt = performance.now();
    carTargetFrom = id;
  });

  network.on('peer-ragdoll', (id, points) => {
    const remote = remotes.get(id);
    if (!remote) return;

    if (!points) {
      remote.ragdoll?.dispose();
      remote.ragdoll = null;
      remote.avatar.root.visible = true;
      return;
    }

    if (!remote.ragdoll) {
      const ragdoll = new Ragdoll({
        color: remote.color,
        skin: remote.avatar.skinColor,
        bounds: CONFIG.world.bounds,
        floorAt: world.ring.floorHeightAt,
      });
      scene.add(ragdoll.group);
      ragdoll.remote = true;
      ragdoll.launch({ position: remote.pos, yaw: remote.yaw });
      remote.ragdoll = ragdoll;
      remote.avatar.root.visible = false;
    }

    remote.ragdoll.applyRemote(points);
  });

  network.on('world', (state) => {
    if (!state?.car) return;
    // Quem está no volante manda na pose; um welcome atrasado não pode
    // teleportar o carro de volta para a posição do anfitrião.
    if (mySeat === 0) return;
    if (!car) {
      pendingWorld = state.car;
      return;
    }
    car.setPose(state.car);
    car.sync(0);
    carTarget = { ...car.pose };
    carTargetAt = performance.now();
    carTargetFrom = null;
  });

  network.on('chat', (message) => {
    audio.message();
    ui.chat({ name: message.name, text: message.text, color: message.color });
  });

  network.on('peer-hit', (id, message) => {
    const attacker = remotes.get(id);
    attacker?.avatar.punch();

    if (!me || message.to !== network.id || myRagdoll || mySeat >= 0) return;

    const now = performance.now();
    if (now < hitCooldownUntil) return;

    // valida do lado de quem levou: o soco precisa ter saído de perto
    const distance = Math.hypot(me.player.pos.x - message.px, me.player.pos.z - message.pz);
    if (distance > 2.8) return;

    audio.hit();
    const dx = Number(message.dx) || 0;
    const dz = Number(message.dz) || 0;
    const name = attacker?.name || 'Alguém';
    startRagdoll(
      new THREE.Vector3(dx * PUNCH_IMPULSE, PUNCH_LIFT, dz * PUNCH_IMPULSE),
      now,
      `${name} te acertou! Aperte R para levantar.`,
    );
  });

  network.on('latency', () => ui.setPing(network.averageRtt));

  network.on('host-lost', () => {
    if (!joined) return;
    ui.toast('Quem criou a sala saiu. Vocês continuam juntos, mas ninguém novo entra.', 'leave');
    ui.chat({ system: true, text: 'O anfitrião saiu da sala. A conversa continua.' });
  });

  network.on('status', (text) => {
    if (joined) console.info('[net]', text);
  });

  network.on('error', (error) => {
    console.warn('[net] erro', error);
    if (!joined) return;
    if (error?.type === 'peer-unavailable') {
      // A malha tenta reconectar sozinha; não vale um toast a cada tentativa.
      const now = performance.now();
      if (now - lastUnavailableToastAt < 20000) return;
      lastUnavailableToastAt = now;
      ui.toast('Não foi possível falar com um participante.', 'leave');
      return;
    }
    ui.toast(friendlyError(error), 'leave');
  });
}

function addRemote(profile) {
  if (!profile?.id || profile.id === net?.id) return;

  const existing = remotes.get(profile.id);
  if (existing) {
    if (profile.name) existing.avatar.setName(profile.name);
    if (profile.color) existing.avatar.setColor(profile.color);
    existing.name = profile.name || existing.name;
    return;
  }

  const name = profile.name || 'Jogador';
  const color = profile.color || colorForName(name);
  const avatar = createAvatar({ name, color });

  const start = Array.isArray(profile.pos) ? profile.pos : [0, 0, 0];
  const pos = new THREE.Vector3(Number(start[0]) || 0, Number(start[1]) || 0, Number(start[2]) || 0);

  avatar.root.position.copy(pos);
  scene.add(avatar.root);

  remotes.set(profile.id, {
    id: profile.id,
    name,
    color,
    avatar,
    pos: pos.clone(),
    target: pos.clone(),
    yaw: 0,
    targetYaw: 0,
    speed: 0,
    airborne: false,
    crouching: false,
    seat: Number.isFinite(profile.seat) ? profile.seat : -1,
    ragdoll: null,
  });

  refreshPeople();
  if (joined) {
    ui.toast(`${name} entrou`, 'join');
    ui.chat({ system: true, text: `${name} entrou na sala.` });
  }
}

function removeRemote(id, fallbackName) {
  const remote = remotes.get(id);
  if (!remote) return;
  remotes.delete(id);

  // Se quem saiu era o motorista (ou a última pose vinha dele), o carro
  // não pode continuar "andando" sozinho para o resto da sala.
  if (remote.seat === 0 || id === carTargetFrom) {
    carTarget = null;
    carTargetFrom = null;
    if (car && mySeat !== 0) {
      car.speed = 0;
      car.steer = 0;
    }
  }

  remote.ragdoll?.dispose();
  remote.avatar.dispose();
  refreshPeople();
  if (!joined) return;

  const name = fallbackName || remote.name;
  ui.toast(`${name} saiu`, 'leave');
  ui.chat({ system: true, text: `${name} saiu da sala.` });
}

function refreshPeople() {
  const people = [];
  if (me) people.push({ id: me.id, name: me.name, color: me.color, me: true });
  for (const remote of remotes.values()) {
    people.push({ id: remote.id, name: remote.name, color: remote.color, me: false });
  }
  ui.setParticipants(people);
}

// --------------------------------------------------------------- carro

function ensureCar() {
  if (car) return car;
  car = new Car();
  car.ring = world.ring;
  scene.add(car.group);
  car.sync(0);
  carFocus.set(car.x, 0.6, car.z);
  return car;
}

function updateCar(dt) {
  if (!car) return;

  if (me && mySeat === 0 && !myRagdoll) {
    car.drive(dt, input.state);
    carSendTimer += dt;
    if (carSendTimer >= 1 / 20) {
      carSendTimer = 0;
      net?.broadcastCar(car.pose);
    }
  } else if (carTarget) {
    if (performance.now() - carTargetAt > CAR_TARGET_TIMEOUT_MS) {
      // O motorista sumiu ou parou de mandar poses: não deixa o carro
      // "fantasma" continuar com velocidade e derrubando quem passa perto.
      carTarget = null;
      carTargetFrom = null;
      car.speed = 0;
      car.steer = 0;
    } else {
      car.remoteUpdate(dt, carTarget);
    }
  }

  car.sync(dt);
  carFocus.set(car.x, 0.55, car.z);
}

/** Bancos ocupados segundo o que cada jogador contou. */
function occupiedSeats() {
  const taken = new Set();
  for (const remote of remotes.values()) {
    if (remote.seat >= 0) taken.add(remote.seat);
  }
  return taken;
}

function enterCar() {
  if (!me || !car || mySeat >= 0 || myRagdoll) return;

  const distance = Math.hypot(me.player.pos.x - car.x, me.player.pos.z - car.z);
  if (distance > CONFIG.car.enterRadius) return;

  const taken = occupiedSeats();
  let seat = -1;
  for (let index = 0; index < CAR_SEATS.length; index++) {
    if (!taken.has(index)) {
      seat = index;
      break;
    }
  }

  if (seat < 0) {
    ui.toast('O carro está cheio (4 lugares).', 'leave');
    return;
  }

  mySeat = seat;
  if (net) net.localSeat = seat;

  me.player.velocity.set(0, 0);
  me.player.vy = 0;
  me.player.onGround = true;

  if (seat === 0) {
    // assume o volante a partir da pose atual do carro
    car.speed = 0;
    car.steer = 0;
    net?.broadcastCar(car.pose);
    ui.toast('Você está dirigindo. W/S acelera e freia, A/D vira.', 'ok');
  } else {
    ui.toast(`Você sentou no ${CAR_SEATS[seat].label}.`, 'ok');
  }
}

function exitCar() {
  if (mySeat < 0 || !car || !me) return;

  const seat = mySeat;
  mySeat = -1;
  if (net) net.localSeat = -1;

  const side = CAR_SEATS[seat].x < 0 ? -1.25 : 1.25;
  car.toWorld(side, CAR_SEATS[seat].z, scratch);

  me.player.pos.set(scratch.x, world.ring.floorHeightAt(scratch.x, scratch.z), scratch.z);
  clampToWorld(me.player.pos, CONFIG.world.bounds - 1);
  me.player.yaw = car.yaw;
  me.player.velocity.set(0, 0);
  me.player.vy = 0;
  me.player.onGround = true;

  me.avatar.root.position.copy(me.player.pos);
  me.avatar.root.rotation.y = me.player.yaw;

  if (seat === 0) {
    car.speed = 0;
    car.steer = 0;
    carTarget = car.pose;
    carTargetAt = performance.now();
    carTargetFrom = null;
    net?.broadcastCar(car.pose);
  }

  hitCooldownUntil = performance.now() + 500;
}

// ------------------------------------------------------------- ragdoll

function startRagdoll(velocity, now = performance.now(), notice = 'Você caiu! Aperte R para levantar.') {
  if (!me || myRagdoll || mySeat >= 0) return;

  const ragdoll = new Ragdoll({
    color: me.color,
    skin: me.avatar.skinColor,
    bounds: CONFIG.world.bounds,
    floorAt: world.ring.floorHeightAt,
  });

  scene.add(ragdoll.group);
  ragdoll.launch({ position: me.player.pos, yaw: me.player.yaw, velocity });

  myRagdoll = ragdoll;
  me.avatar.root.visible = false;
  me.player.velocity.set(0, 0);
  me.player.vy = 0;
  me.player.speed = 0;

  ragdollSendTimer = 0;
  ragdollReadyAt = now + CONFIG.ragdoll.minMs;
  ragdollEndAt = now + CONFIG.ragdoll.maxMs;
  hitCooldownUntil = now + 800;

  net?.broadcastRagdoll(ragdoll.serialize());
  ui.toast(notice, 'leave');
}

function endRagdoll(now = performance.now()) {
  if (!myRagdoll || !me) return;

  const hips = myRagdoll.hips;
  const floor = world.ring.floorHeightAt(hips.x, hips.z);

  me.player.pos.set(hips.x, floor, hips.z);
  clampToWorld(me.player.pos, CONFIG.world.bounds - 1);
  me.player.velocity.set(0, 0);
  me.player.vy = 0;
  me.player.onGround = true;
  me.avatar.root.position.copy(me.player.pos);
  me.avatar.root.rotation.y = me.player.yaw;
  me.avatar.root.visible = !rig.firstPerson;

  myRagdoll.dispose();
  myRagdoll = null;

  net?.broadcastRagdoll(null);
  hitCooldownUntil = now + 1500;
}

/** E / botão de toque: entra, sai ou levanta conforme o estado. */
function handleAction() {
  if (!me) return;
  if (myRagdoll) {
    endRagdoll();
    return;
  }
  if (mySeat >= 0) {
    exitCar();
    return;
  }
  enterCar();
}

ui.onAction(() => handleAction());

// ------------------------------------------------------------------ socos

/** Soco: atinge o primeiro boneco em pé à frente e derruba via rede. */
function tryPunch(now = performance.now()) {
  if (!me || myRagdoll || mySeat >= 0) return;
  if (now < punchReadyAt) return;
  punchReadyAt = now + PUNCH_COOLDOWN_MS;

  me.avatar.punch();
  audio.punch();

  const fx = Math.sin(me.player.yaw);
  const fz = Math.cos(me.player.yaw);
  let target = null;
  let bestDot = 0.35;

  for (const remote of remotes.values()) {
    if (remote.ragdoll || remote.seat >= 0) continue;

    const dx = remote.pos.x - me.player.pos.x;
    const dz = remote.pos.z - me.player.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001 || distance > PUNCH_RANGE) continue;

    const dot = (dx * fx + dz * fz) / distance;
    if (dot > bestDot) {
      bestDot = dot;
      target = remote;
    }
  }

  let dx = fx;
  let dz = fz;
  if (target) {
    dx = target.pos.x - me.player.pos.x;
    dz = target.pos.z - me.player.pos.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
  }

  // o alvo valida a distância e cai sozinho; os outros só veem o golpe
  net?.broadcastHit({
    to: target ? target.id : null,
    px: me.player.pos.x,
    pz: me.player.pos.z,
    dx,
    dz,
  });
}

ui.onPunch(() => tryPunch());

// --------------------------------------------------- colisão entre bonecos

/** Empurra o jogador local para fora de quem está em pé por perto. */
function resolvePlayerCollisions() {
  if (!me || mySeat >= 0 || myRagdoll) return;

  const pos = me.player.pos;
  let moved = false;

  for (const remote of remotes.values()) {
    if (remote.ragdoll || remote.seat >= 0) continue;

    const dx = pos.x - remote.pos.x;
    const dz = pos.z - remote.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= PLAYER_RADIUS) continue;

    const nx = distance > 0.0001 ? dx / distance : me.id < remote.id ? 1 : -1;
    const nz = distance > 0.0001 ? dz / distance : 0;
    const push = (PLAYER_RADIUS - distance) * 0.5 + 0.002;

    pos.x += nx * push;
    pos.z += nz * push;

    // tira a velocidade que empurrava para dentro do outro
    const into = me.player.velocity.x * nx + me.player.velocity.y * nz;
    if (into < 0) {
      me.player.velocity.x -= into * nx;
      me.player.velocity.y -= into * nz;
    }

    moved = true;
  }

  if (moved) {
    clampToWorld(pos, CONFIG.world.bounds - 1);
    me.avatar.root.position.copy(pos);
  }
}

// --------------------------------------------------------------- entrar

function cleanupNetwork() {
  if (net) {
    try {
      net.destroy();
    } catch {
      /* ignora */
    }
    net = null;
  }
}

async function enterRoom({ name, code, host }) {
  if (connecting) return false;

  connecting = true;
  joined = false;
  ui.setBusy(true);
  ui.setStatus(host ? 'Abrindo a sala…' : 'Procurando a sala…');
  cleanupNetwork();

  const color = ui.getColor();
  net = new Network({ name, color });
  wireNetwork(net);

  try {
    // O carro e o provider precisam existir antes de a sala abrir: um convidado
    // pode entrar e pedir o welcome antes de o host terminar este bloco.
    ensureCar();
    net.worldProvider = () => ({ car: car ? car.pose : null });

    if (host) await net.host(code);
    else await net.join(code);
  } catch (error) {
    console.error(error);
    lastError = error;
    cleanupNetwork();
    ui.setBusy(false);
    ui.setStatus(friendlyError(error), 'error');
    connecting = false;
    return false;
  }

  connecting = false;
  joined = true;
  ui.setBusy(false);
  ui.setRoom(code);
  ui.hideMenu();
  ui.showHud();
  ui.setPing(null);

  const avatar = createAvatar({ name, color });
  scene.add(avatar.root);

  const player = new LocalPlayer(avatar);
  player.groundAt = world.ring.floorHeightAt;
  player.spawn((Math.random() - 0.5) * 4, 4 + (Math.random() - 0.5) * 3, 0);

  me = { id: net.id, name, color, avatar, player };
  mySeat = -1;
  myRagdoll = null;

  if (pendingWorld && car) {
    car.setPose(pendingWorld);
    car.sync(0);
    carTarget = { ...car.pose };
    carTargetAt = performance.now();
    carTargetFrom = null;
    pendingWorld = null;
  }

  net.localPos = player.snapshot().p;

  rig.reset();
  input.setEnabled(true);
  refreshPeople();

  ui.chat({ system: true, text: `Sala ${code}. Compartilhe o link para chamar alguém.` });
  ui.toast(host ? `Sala ${code} criada` : `Você entrou na sala ${code}`, 'ok');
  audio.join();
  return true;
}

function friendlyError(error) {
  const type = error?.type;

  switch (type) {
    case 'unavailable-id':
      return 'Esse código de sala já está em uso. Clique em "Criar sala" de novo.';
    case 'peer-unavailable':
      return 'Sala não encontrada. Confira o código com quem te convidou.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Não consegui falar com o servidor de sinalização. Verifique sua internet e tente de novo.';
    case 'browser-incompatible':
      return 'Este navegador não suporta WebRTC. Tente Chrome, Edge ou Firefox atualizados.';
    case 'webrtc':
      return 'A conexão P2P falhou. Redes muito restritivas podem exigir um servidor TURN.';
    default:
      return error?.message || 'Algo deu errado. Tente novamente.';
  }
}

// ---------------------------------------------------------------- menu

ui.onCreate(async (name) => {
  // tenta alguns códigos se o sorteado já estiver em uso
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    if (await enterRoom({ name, code, host: true })) return;
    if (lastError?.type !== 'unavailable-id') return;
  }
  ui.setStatus('Não consegui abrir uma sala agora. Tente novamente em instantes.', 'error');
});

ui.onJoin((name, code) => {
  enterRoom({ name, code, host: false });
});

ui.onChat((text) => {
  if (!net) return;
  net.sendChat(text);
  ui.chat({ name: me?.name || 'Você', text, color: me?.color || '#eaf2f8' });
});

// ---------------------------------------------------------------- loop

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  // em retrato, abre a lente para o boneco não virar a tela toda
  camera.fov = camera.aspect < 0.85 ? 70 : 58;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
}

window.addEventListener('resize', resize);
resize();

// O menu nativo do navegador não abre no jogo (clique direito / toque longo),
// exceto em campos de texto, onde colar ainda é útil.
window.addEventListener('contextmenu', (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
  event.preventDefault();
});

function updateLocal(dt, now) {
  if (!me) return;

  // ---- caído ----
  if (myRagdoll) {
    audio.setCar(false);
    audio.walk(dt);
    myRagdoll.step(dt);
    me.player.pos.copy(myRagdoll.hips);
    me.player.speed = 0;

    rig.update(dt, myRagdoll.focus, 0.15);

    ragdollSendTimer += dt;
    if (ragdollSendTimer >= 1 / CONFIG.ragdoll.syncHz) {
      ragdollSendTimer = 0;
      net?.broadcastRagdoll(myRagdoll.serialize());
    }

    const settled = myRagdoll.readyToStand && now > ragdollReadyAt;
    if (input.wasPressed('KeyR') || now > ragdollEndAt || settled) endRagdoll(now);
    return;
  }

  // ---- sentado ----
  if (mySeat >= 0 && car) {
    audio.walk(dt);
    audio.setCar(true, car.speed);
    car.seatRoot(mySeat, me.player.pos);
    me.player.yaw = car.yaw;
    me.player.velocity.set(0, 0);
    me.player.vy = 0;
    me.player.onGround = true;
    me.player.speed = 0;

    me.avatar.root.position.copy(me.player.pos);
    me.avatar.root.rotation.y = me.player.yaw;
    me.avatar.root.visible = !rig.firstPerson;
    me.avatar.update(dt, 0, false, true);

    rig.update(dt, carFocus, 0.95);
    return;
  }

  // ---- a pé ----
  me.player.update(dt, input.state, rig.yaw);
  me.avatar.root.visible = !rig.firstPerson;
  resolvePlayerCollisions();
  rig.update(dt, me.player.pos, me.player.crouching ? 1.05 : 1.35);

  audio.setCar(false);
  const onGrass =
    me.player.onGround &&
    me.player.pos.y < 0.1 &&
    Math.hypot(me.player.pos.x, me.player.pos.z) > 9.4;
  audio.walk(dt, {
    moving: me.player.speed > 0.35,
    onGround: me.player.onGround,
    grass: onGrass,
    speed: me.player.speed,
  });

  // atropelamento: cada cliente detecta o próprio
  if (car && now > hitCooldownUntil && car.hits(me.player.pos)) {
    startRagdoll(car.impulse(hitImpulse), now);
  }
}

function updateRemotes(dt) {
  for (const remote of remotes.values()) {
    if (remote.ragdoll) {
      remote.ragdoll.step(dt);
      remote.pos.copy(remote.ragdoll.hips);
      continue;
    }

    if (car && remote.seat >= 0) {
      car.seatRoot(remote.seat, remote.target);
      remote.targetYaw = car.yaw;
      remote.speed = 0;
      remote.pos.copy(remote.target);
    } else {
      remote.pos.lerp(remote.target, 1 - Math.exp(-12 * dt));
    }

    remote.yaw = dampAngle(remote.yaw, remote.targetYaw, 14, dt);
    remote.avatar.root.position.copy(remote.pos);
    remote.avatar.root.rotation.y = remote.yaw;
    remote.avatar.update(dt, remote.speed, remote.airborne, remote.seat >= 0, remote.crouching);
  }
}

function updatePrompt() {
  ui.setPunchVisible(!!me && !myRagdoll && mySeat < 0);

  if (!me) {
    ui.setPrompt('');
    ui.setActionLabel('');
    return;
  }

  if (myRagdoll) {
    ui.setPrompt('R — levantar');
    ui.setActionLabel('↑');
    return;
  }

  if (mySeat >= 0) {
    ui.setPrompt(
      mySeat === 0
        ? 'W/S acelerar e frear · A/D virar · E — sair'
        : 'E — sair do carro',
    );
    ui.setActionLabel('↓');
    return;
  }

  if (car && Math.hypot(me.player.pos.x - car.x, me.player.pos.z - car.z) <= CONFIG.car.enterRadius) {
    ui.setPrompt('E — entrar no carro');
    ui.setActionLabel('🚗');
    return;
  }

  ui.setPrompt('');
  ui.setActionLabel('');
}

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  updateCar(dt);

  if (me) {
    // E: entrar/sair do carro ou levantar
    if (input.wasPressed('KeyE')) handleAction();

    // V: alterna a perspectiva (o zoom também entra/sai da primeira pessoa).
    if (input.wasPressed('KeyV')) {
      rig.toggleFirstPerson();
      syncViewButton();
    }

    // F: soco em quem estiver na frente. A tecla é consumida mesmo sem poder
    // socar, para um F apertado dentro do carro não disparar depois.
    const punchPressed = input.wasPressed('KeyF');
    if (!myRagdoll && mySeat < 0 && punchPressed) tryPunch(now);

    // R: deitar no chão (ou levantar, se já estiver caído)
    if (!myRagdoll && input.wasPressed('KeyR')) {
      startRagdoll(
        new THREE.Vector3(
          Math.sin(me.player.yaw) * 1.3,
          0.5,
          Math.cos(me.player.yaw) * 1.3,
        ),
        now,
      );
    }

    updateLocal(dt, now);
    world.updateSun(me.player.pos);

    sendTimer += dt;
    if (sendTimer >= 1 / CONFIG.net.stateHz) {
      sendTimer = 0;
      net?.broadcastState(me.player.snapshot(mySeat));
    }
  } else {
    rig.orbit(dt);
    world.updateSun(ORIGIN);
  }

  updateRemotes(dt);
  updatePrompt();

  pingTimer += dt;
  if (pingTimer > 1) {
    pingTimer = 0;
    if (net && net.peers.size) ui.setPing(net.averageRtt);
  }

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);

window.addEventListener('pagehide', () => cleanupNetwork());
window.addEventListener('beforeunload', () => cleanupNetwork());

if (typeof window.Peer !== 'function') {
  ui.setStatus('A biblioteca PeerJS não carregou. Verifique sua conexão e recarregue a página.', 'error');
  ui.setBusy(true);
}

// Atalhos de depuração: abra com ?debug=1 e inspecione no console.
if (new URLSearchParams(location.search).has('debug')) {
  window.__passear = {
    scene,
    camera,
    renderer,
    get net() { return net; },
    get me() { return me; },
    get remotes() { return remotes; },
    get car() { return car; },
    get seat() { return mySeat; },
    get ragdoll() { return myRagdoll; },
    world,
    ring: world.ring,
    startRagdoll,
    endRagdoll,
    enterCar,
    exitCar,
    punch: tryPunch,
    rig,
    input,
    audio,
  };
}
