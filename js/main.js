import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createAvatar } from './avatar.js';
import { LocalPlayer } from './player.js';
import { CameraRig } from './camera.js';
import { Network } from './network.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { colorForName, dampAngle, randomCode } from './utils.js';

const ORIGIN = new THREE.Vector3(0, 0, 0);

const canvas = document.getElementById('view');
const ui = new UI();
const input = new Input();

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

/** @type {Network|null} */
let net = null;
/** @type {{id:string,name:string,color:string,avatar:any,player:LocalPlayer}|null} */
let me = null;
/** @type {Map<string, any>} */
const remotes = new Map();

let connecting = false;
let joined = false;
let lastError = null;
let sendTimer = 0;
let pingTimer = 0;
let lastTime = performance.now();

// ---------------------------------------------------------------- rede

function wireNetwork(network) {
  network.on('peer-join', (profile) => addRemote(profile));

  network.on('peer-leave', (person) => removeRemote(person.id, person.name));

  network.on('peer-state', (id, message) => {
    const remote = remotes.get(id);
    if (!remote || !Array.isArray(message.p)) return;

    const [x, y, z] = message.p;
    remote.target.set(x || 0, y || 0, z || 0);

    if (typeof message.r === 'number') remote.targetYaw = message.r;
    remote.speed = typeof message.s === 'number' ? message.s : 0;
    remote.airborne = Number(message.a) === 1;

    // se a diferença for grande (entrou agora, teleportou), cola de uma vez
    if (remote.pos.distanceToSquared(remote.target) > 400) {
      remote.pos.copy(remote.target);
      remote.yaw = remote.targetYaw;
    }
  });

  network.on('chat', (message) => {
    ui.chat({ name: message.name, text: message.text, color: message.color });
  });

  network.on('latency', () => ui.setPing(network.averageRtt));

  network.on('host-lost', () => {
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
  });

  refreshPeople();
  ui.toast(`${name} entrou`, 'join');
  ui.chat({ system: true, text: `${name} entrou na sala.` });
}

function removeRemote(id, fallbackName) {
  const remote = remotes.get(id);
  if (!remote) return;
  remotes.delete(id);
  remote.avatar.dispose();
  refreshPeople();
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

  const color = colorForName(name);
  net = new Network({ name, color });
  wireNetwork(net);

  try {
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
  player.spawn((Math.random() - 0.5) * 4, 4 + (Math.random() - 0.5) * 3, 0);

  net.localPos = player.snapshot().p;

  me = { id: net.id, name, color, avatar, player };

  rig.reset();
  input.setEnabled(true);
  refreshPeople();

  ui.chat({ system: true, text: `Sala ${code}. Compartilhe o link para chamar alguém.` });
  ui.toast(host ? `Sala ${code} criada` : `Você entrou na sala ${code}`, 'ok');
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
    const code = randomCode(5);
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

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (me) {
    me.player.update(dt, input.state, rig.yaw);
    rig.update(dt, me.player.pos);
    world.updateSun(me.player.pos);

    sendTimer += dt;
    if (sendTimer >= 1 / CONFIG.net.stateHz) {
      sendTimer = 0;
      net?.broadcastState(me.player.snapshot());
    }
  } else {
    rig.orbit(dt);
    world.updateSun(ORIGIN);
  }

  for (const remote of remotes.values()) {
    remote.pos.lerp(remote.target, 1 - Math.exp(-12 * dt));
    remote.yaw = dampAngle(remote.yaw, remote.targetYaw, 14, dt);
    remote.avatar.root.position.copy(remote.pos);
    remote.avatar.root.rotation.y = remote.yaw;
    remote.avatar.update(dt, remote.speed, remote.airborne);
  }

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
    rig,
  };
}
