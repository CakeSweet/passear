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
};
