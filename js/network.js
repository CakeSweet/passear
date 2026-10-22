import { CONFIG } from './config.js';

const ROOM_PREFIX = `${CONFIG.prefix}room-`;

/**
 * Malha P2P com PeerJS.
 *
 * Fluxo:
 *  1. Quem cria a sala registra o ID fixo "passear-v1-room-<CODIGO>".
 *  2. Quem entra conecta nesse ID. O anfitrião responde com a lista de
 *     participantes e avisa todo mundo sobre o recém-chegado.
 *  3. Cada par negocia uma conexão própria (malha completa). O anfitrião não
 *     intermedeia o tráfego: só apresenta as pessoas.
 *
 * Para evitar conexões duplicadas (A liga para B e B liga para A ao mesmo
 * tempo), a regra é: quem tem o ID lexicograficamente menor disca.
 * Exceção: a conexão com o anfitrião é sempre mantida, pois é a porta de
 * entrada da sala.
 */
export class Network {
  constructor(profile) {
    this.profile = { name: profile.name, color: profile.color };
    this.id = null;
    this.role = null;
    this.roomCode = null;
    this.hostId = null;
    this.peer = null;

    /** id -> { id, name, color, conn, pos, rtt } */
    this.peers = new Map();
    /** id -> perfil conhecido (mesmo antes de conectar) */
    this.known = new Map();
    this.dialing = new Set();

    this.localPos = [0, 0, 0];
    /** Banco que o jogador local ocupa (-1 = a pé). */
    this.localSeat = -1;
    /** Quem cria a sala fornece o estado do mundo para quem chega (ex.: o carro). */
    this.worldProvider = null;
    this.handlers = new Map();
    this.timers = [];
    this.closed = false;
  }

  // ---------------------------------------------------------------- eventos

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
    return this;
  }

  emit(event, ...args) {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      try {
        handler(...args);
      } catch (error) {
        console.error(`[net] erro no handler "${event}"`, error);
      }
    }
  }

  get participantCount() {
    return 1 + this.peers.size;
  }

  get averageRtt() {
    let sum = 0;
    let count = 0;
    for (const peer of this.peers.values()) {
      if (typeof peer.rtt === 'number') {
        sum += peer.rtt;
        count++;
      }
    }
    return count ? sum / count : null;
  }

  // ------------------------------------------------------------------ sala

  /** Cria a sala: vira o anfitrião (só para apresentar as pessoas). */
  async host(code) {
    this.role = 'host';
    this.roomCode = code;
    this.hostId = ROOM_PREFIX + code.toLowerCase();

    await this._openPeer(this.hostId);
    this._startTimers();
    this.emit('status', 'Sala criada. Esperando alguém entrar…');
    return this;
  }

  /** Entra na sala de alguém. Resolve quando a conexão com o anfitrião abre. */
  async join(code) {
    this.role = 'guest';
    this.roomCode = code;
    this.hostId = ROOM_PREFIX + code.toLowerCase();

    await this._openPeer(undefined);

    const conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });

    const connected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Ninguém respondeu nessa sala. Confere o código?'));
      }, CONFIG.net.joinTimeoutMs);

      const succeed = () => {
        clearTimeout(timer);
        resolve();
      };
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };

      conn.on('open', succeed);
      conn.on('error', fail);
      this.on('error', (error) => {
        if (error?.type === 'peer-unavailable' || error?.type === 'network') fail(error);
      });
    });

    this._attach(conn, true);
    this._startTimers();

    this.emit('status', 'Conversando com a sala…');
    await connected;
    return this;
  }

  _openPeer(id) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('PeerJS não carregou. Verifique sua conexão com a internet.'));
        return;
      }

      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      let peer;
      try {
        peer = id ? new window.Peer(id, CONFIG.peer) : new window.Peer(CONFIG.peer);
      } catch (error) {
        finish(error);
        return;
      }

      this.peer = peer;

      peer.on('open', (myId) => {
        this.id = myId;
        this.emit('open', myId);
        finish();
      });

      peer.on('connection', (conn) => this._attach(conn, false));

      peer.on('error', (error) => {
        this.emit('error', error);
        finish(error);
      });

      peer.on('disconnected', () => {
        if (this.closed) return;
        this.emit('status', 'Sinal caiu, tentando reconectar…');
        try {
          peer.reconnect();
        } catch {
          /* ignora */
        }
      });

      peer.on('close', () => {
        if (!this.closed) this.emit('status', 'Desconectado do servidor de sinalização.');
      });
    });
  }

  // ------------------------------------------------------------ conexões

  _attach(conn, outbound) {
    const remoteId = conn.peer;
    if (!remoteId) return;

    // Regra de desempate para não abrir duas conexões entre o mesmo par.
    const isHostLink = remoteId === this.hostId || (this.role === 'host' && !outbound);
    const keep = isHostLink || (outbound ? this.id < remoteId : this.id > remoteId);

    if (!keep) {
      try {
        conn.close();
      } catch {
        /* ignora */
      }
      return;
    }

    const existing = this.peers.get(remoteId);
    if (existing && existing.conn !== conn) {
      // Já temos um canal com essa pessoa: descarta o duplicado.
      try {
        conn.close();
      } catch {
        /* ignora */
      }
      return;
    }

    const entry = existing ?? {
      id: remoteId,
      name: this.known.get(remoteId)?.name ?? 'Jogador',
      color: this.known.get(remoteId)?.color ?? '#9aa7b4',
      conn,
      pos: this.known.get(remoteId)?.pos ?? null,
      rtt: null,
    };
    entry.conn = conn;
    this.peers.set(remoteId, entry);
    this.known.set(remoteId, {
      id: remoteId,
      name: entry.name,
      color: entry.color,
      pos: entry.pos,
    });

    const greet = () => {
      this.dialing.delete(remoteId);
      this._send(conn, {
        t: 'hello',
        name: this.profile.name,
        color: this.profile.color,
        pos: this.localPos,
        seat: this.localSeat,
      });
    };

    conn.on('open', greet);
    if (conn.open) greet();

    conn.on('data', (message) => this._onData(remoteId, message));
    conn.on('close', () => this._drop(remoteId));
    conn.on('error', () => this._drop(remoteId));
  }

  _maybeDial(remoteId) {
    if (!remoteId || remoteId === this.id || remoteId === this.hostId) return;
    if (this.peers.has(remoteId) || this.dialing.has(remoteId)) return;
    // Só o ID menor disca (evita duplicidade).
    if (!(this.id < remoteId)) return;
    if (!this.peer || this.peer.destroyed) return;

    this.dialing.add(remoteId);
    const conn = this.peer.connect(remoteId, { reliable: true, serialization: 'json' });
    this._attach(conn, true);

    setTimeout(() => this.dialing.delete(remoteId), 8000);
  }

  _drop(remoteId) {
    const entry = this.peers.get(remoteId);
    if (!entry) return;

    this.peers.delete(remoteId);
    try {
      entry.conn.close();
    } catch {
      /* ignora */
    }

    this.emit('peer-leave', { id: remoteId, name: entry.name, color: entry.color });
    if (remoteId === this.hostId) this.emit('host-lost');
  }

  // -------------------------------------------------------------- mensagens

  _send(conn, message) {
    if (!conn || !conn.open) return;
    try {
      conn.send(message);
    } catch (error) {
      console.warn('[net] falha ao enviar', error);
    }
  }

  _onData(remoteId, message) {
    if (!message || typeof message !== 'object') return;

    const entry = this.peers.get(remoteId);

    switch (message.t) {
      case 'hello': {
        if (entry) {
          entry.name = message.name || entry.name;
          entry.color = message.color || entry.color;
          entry.pos = message.pos || entry.pos;
          entry.seat = Number.isFinite(message.seat) ? message.seat : -1;
        }

        const profile = {
          id: remoteId,
          name: message.name || entry?.name || 'Jogador',
          color: message.color || entry?.color || '#9aa7b4',
          pos: message.pos ?? entry?.pos ?? null,
          seat: Number.isFinite(message.seat) ? message.seat : -1,
        };
        this.known.set(remoteId, profile);

        this.emit('peer-join', profile);

        if (this.role === 'host' && entry) {
          const others = [];
          for (const other of this.peers.values()) {
            if (other.id === remoteId) continue;
            others.push({
              id: other.id,
              name: other.name,
              color: other.color,
              pos: other.pos ?? null,
              seat: other.seat ?? -1,
            });
          }
          this._send(entry.conn, {
            t: 'welcome',
            peers: others,
            world: this.worldProvider ? this.worldProvider() : null,
          });

          for (const other of this.peers.values()) {
            if (other.id === remoteId) continue;
            this._send(other.conn, { t: 'peer-join', peer: profile });
          }
        }
        break;
      }

      case 'welcome': {
        if (message.world) this.emit('world', message.world);
        for (const peer of message.peers || []) {
          if (!peer?.id) continue;
          this.known.set(peer.id, peer);
          this._maybeDial(peer.id);
        }
        break;
      }

      case 'peer-join': {
        if (message.peer?.id) {
          this.known.set(message.peer.id, message.peer);
          this._maybeDial(message.peer.id);
        }
        break;
      }

      case 'peer-leave':
        this._drop(remoteId);
        break;

      case 'st':
        this.emit('peer-state', remoteId, message);
        break;

      case 'car':
        this.emit('peer-car', remoteId, message);
        break;

      case 'rag':
        this.emit('peer-ragdoll', remoteId, message.p ?? null);
        break;

      case 'chat': {
        const text = String(message.text ?? '').slice(0, 140).trim();
        if (!text) return;
        this.emit('chat', {
          id: remoteId,
          name: message.name || entry?.name || 'Jogador',
          color: message.color || entry?.color || '#9aa7b4',
          text,
          ts: message.ts || Date.now(),
        });
        break;
      }

      case 'ping':
        this._send(entry?.conn, { t: 'pong', ts: message.ts });
        break;

      case 'pong': {
        if (!entry || typeof message.ts !== 'number') return;
        entry.rtt = performance.now() - message.ts;
        this.emit('latency', entry.rtt);
        break;
      }

      case 'bye':
        this._drop(remoteId);
        break;

      default:
        break;
    }
  }

  // ------------------------------------------------------------------ envio

  /** Envia posição/rotação/velocidade para todos (chamado pelo loop). */
  broadcastState(state) {
    this.localPos = state.p;
    this.localSeat = Number.isFinite(state.k) ? state.k : -1;
    const message = { t: 'st', p: state.p, r: state.r, s: state.s, a: state.a, k: this.localSeat };
    for (const peer of this.peers.values()) this._send(peer.conn, message);
  }

  /** Só o motorista manda a pose do carro. */
  broadcastCar(pose) {
    const message = { t: 'car', x: pose.x, z: pose.z, yaw: pose.yaw, v: pose.v, st: pose.st };
    for (const peer of this.peers.values()) this._send(peer.conn, message);
  }

  /**
   * Posições do ragdoll (dono simula). `null` avisa que o boneco levantou.
   */
  broadcastRagdoll(points) {
    const message = { t: 'rag', p: points ?? null };
    for (const peer of this.peers.values()) this._send(peer.conn, message);
  }

  sendChat(text) {
    const clean = String(text ?? '').slice(0, 140).trim();
    if (!clean) return;
    const message = {
      t: 'chat',
      name: this.profile.name,
      color: this.profile.color,
      text: clean,
      ts: Date.now(),
    };
    for (const peer of this.peers.values()) this._send(peer.conn, message);
  }

  _startTimers() {
    if (this.timers.length) return;
    const ping = setInterval(() => {
      if (this.closed) return;
      const ts = performance.now();
      for (const peer of this.peers.values()) this._send(peer.conn, { t: 'ping', ts });
    }, CONFIG.net.pingMs);

    this.timers.push(ping);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;

    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];

    for (const peer of this.peers.values()) {
      this._send(peer.conn, { t: 'bye' });
      try {
        peer.conn.close();
      } catch {
        /* ignora */
      }
    }
    this.peers.clear();

    try {
      this.peer?.destroy();
    } catch {
      /* ignora */
    }
    this.peer = null;
  }
}
