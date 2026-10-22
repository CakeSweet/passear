/**
 * Ajustes do jogo. Nada aqui precisa de build: é só editar e recarregar.
 */
export const CONFIG = {
  /** Prefixo dos IDs de sala no PeerJS. Troque a versão se mudar o protocolo. */
  prefix: 'passear-v1-',

  peer: {
    debug: 0,

    /**
     * Servidor de sinalização. Sem `host` o PeerJS usa a nuvem pública
     * (0.peerjs.com). Para produção séria, suba o seu:
     *   host: 'meu-servidor.com', port: 443, secure: true, path: '/'
     */

    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Redes corporativas / NAT restritivo: adicione um TURN seu.
        // { urls: 'turn:turn.seudominio.com:3478', username: 'usuario', credential: 'senha' },
      ],
    },
  },

  net: {
    /** Frequência de envio da própria posição (Hz). */
    stateHz: 15,
    /** Intervalo do ping de latência (ms). */
    pingMs: 2500,
    /** Tempo máximo esperando resposta de uma sala ao entrar (ms). */
    joinTimeoutMs: 15000,
  },

  world: {
    size: 200,
    /** Distância máxima que um boneco pode andar do centro. */
    bounds: 88,
    fogNear: 70,
    fogFar: 190,
  },

  move: {
    walk: 4.2,
    run: 7.6,
    accel: 16,
    jump: 6.6,
    gravity: 19,
    turn: 14,
  },

  car: {
    /** Onde o carro nasce (todo mundo começa com a mesma pose). */
    spawn: { x: 5.5, z: 8.5, yaw: Math.PI * 0.92 },
    /** Velocidade máxima para a frente e para a ré (m/s). */
    maxSpeed: 15,
    maxReverse: 5,
    /** Aceleração, frenagem e ré (m/s²). */
    accel: 9,
    brake: 24,
    reverseAccel: 6,
    /** Perda de velocidade sem acelerar (1/s). */
    drag: 0.7,
    /** Velocidade angular máxima (rad/s). */
    turnRate: 1.9,
    /** Distância para entrar no carro. */
    enterRadius: 3.6,
  },

  ragdoll: {
    /** Frequência de envio das posições do ragdoll (Hz). */
    syncHz: 12,
    /** Tempo máximo caído antes de levantar sozinho (ms). */
    maxMs: 6000,
    /** Tempo mínimo caído, mesmo que já esteja parado (ms). */
    minMs: 2200,
  },
};
