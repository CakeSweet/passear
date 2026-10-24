import { clamp, storageGet, storageSet } from './utils.js';

const VOLUME = 0.55;
const MUTE_KEY = 'passear:mudo';

/**
 * Sons sintetizados com Web Audio, sem arquivos externos.
 *
 * O contexto só nasce depois de um gesto do usuário (clique/toque/tecla), como
 * exigem as políticas de autoplay dos navegadores. Se o áudio não existir,
 * todos os métodos simplesmente não fazem nada.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = storageGet(MUTE_KEY, '0') === '1';
    this._unlocked = false;
    this._stepTimer = 0;
    this._engine = null;
    this._bindUnlock();
  }

  _bindUnlock() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  /** Chama no primeiro gesto: cria ou retoma o contexto. */
  unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    this._unlocked = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : VOLUME;
      this.master.connect(this.ctx.destination);
      this.noise = this._makeNoise(this.ctx);
    } catch (error) {
      console.warn('[audio] não foi possível iniciar o Web Audio', error);
      this.ctx = null;
      this.master = null;
    }

    return this.ctx;
  }

  _makeNoise(ctx) {
    const seconds = 1;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _ready() {
    if (!this._unlocked || this.muted) return null;
    const ctx = this._ensureContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  _tone({ freq, endFreq = freq, duration = 0.15, gain = 0.1, type = 'sine', delay = 0 }) {
    const ctx = this._ready();
    if (!ctx) return;

    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    }

    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  _noiseBurst({
    duration = 0.1,
    gain = 0.1,
    frequency = 900,
    endFrequency = frequency,
    q = 0.8,
    type = 'bandpass',
    delay = 0,
    pan = 0,
  }) {
    const ctx = this._ready();
    if (!ctx) return;

    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    if (endFrequency !== frequency) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), t + duration);
    }
    filter.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    let node = source;
    node.connect(filter);
    node = filter;

    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      node.connect(panner);
      node = panner;
    }

    node.connect(env);
    env.connect(this.master);
    source.start(t, Math.random() * 0.4, duration + 0.03);
  }

  /** Passo curto na grama. */
  footstep() {
    if (!this._ready()) return;
    const pan = (Math.random() - 0.5) * 0.5;
    const pitch = 760 + Math.random() * 420;

    this._noiseBurst({ duration: 0.085, gain: 0.055, frequency: pitch, q: 1.1, pan });
    this._tone({ freq: 88 + Math.random() * 24, endFreq: 55, duration: 0.075, gain: 0.035, type: 'triangle' });
  }

  /** Chamado a cada frame; toca passos só quando está andando na grama. */
  walk(dt, { moving = false, onGround = true, grass = false, speed = 0 } = {}) {
    this._stepTimer = Math.max(0, this._stepTimer - dt);

    if (!moving || !onGround || !grass) {
      this._stepTimer = 0;
      return;
    }

    if (this._stepTimer > 0) return;
    this.footstep();
    this._stepTimer = clamp(0.56 - speed * 0.035, 0.25, 0.52) + Math.random() * 0.025;
  }

  punch() {
    if (!this._ready()) return;
    this._noiseBurst({ duration: 0.12, gain: 0.14, frequency: 1200, endFrequency: 420, q: 0.7, pan: -0.08 });
    this._tone({ freq: 118, endFreq: 52, duration: 0.18, gain: 0.17, type: 'triangle' });
    this._noiseBurst({ duration: 0.065, gain: 0.1, frequency: 2200, q: 1.4, delay: 0.035 });
  }

  hit() {
    if (!this._ready()) return;
    this._tone({ freq: 82, endFreq: 46, duration: 0.2, gain: 0.2, type: 'triangle' });
    this._noiseBurst({ duration: 0.09, gain: 0.09, frequency: 500, q: 0.9 });
  }

  /** Mensagem recebida no chat. */
  message() {
    this._tone({ freq: 660, duration: 0.09, gain: 0.09 });
    this._tone({ freq: 880, duration: 0.12, gain: 0.08, delay: 0.075 });
  }

  /** Alguém entrou na sala (ou você acabou de entrar). */
  join() {
    this._tone({ freq: 392, duration: 0.1, gain: 0.075 });
    this._tone({ freq: 523.25, duration: 0.1, gain: 0.07, delay: 0.085 });
    this._tone({ freq: 659.25, duration: 0.16, gain: 0.065, delay: 0.17 });
  }

  /** Liga/atualiza/desliga o motor do carro. */
  setCar(active, speed = 0) {
    if (!active || this.muted) {
      this._stopEngine();
      return;
    }

    const ctx = this._ready();
    if (!ctx) return;

    if (!this._engine) this._startEngine(ctx);
    if (!this._engine) return;

    const abs = Math.abs(speed);
    const now = ctx.currentTime;
    const base = 44 + abs * 3.4;
    this._engine.oscA.frequency.setTargetAtTime(base, now, 0.09);
    this._engine.oscB.frequency.setTargetAtTime(base * 2.02, now, 0.09);
    this._engine.filter.frequency.setTargetAtTime(220 + abs * 42, now, 0.12);
    this._engine.gain.gain.setTargetAtTime(0.018 + abs * 0.0018, now, 0.12);
  }

  _startEngine(ctx) {
    try {
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();

      gain.gain.value = 0.0001;
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      filter.Q.value = 0.8;
      oscA.type = 'sawtooth';
      oscA.frequency.value = 48;
      oscB.type = 'square';
      oscB.frequency.value = 96;
      oscB.detune.value = 5;

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      oscA.start();
      oscB.start();
      gain.gain.setTargetAtTime(0.02, ctx.currentTime, 0.15);

      this._engine = { gain, filter, oscA, oscB };
    } catch (error) {
      console.warn('[audio] motor do carro indisponível', error);
      this._engine = null;
    }
  }

  _stopEngine() {
    const engine = this._engine;
    if (!engine) return;
    this._engine = null;

    const ctx = this.ctx;
    const now = ctx?.currentTime ?? 0;
    try {
      engine.gain.gain.cancelScheduledValues(now);
      engine.gain.gain.setTargetAtTime(0.0001, now, 0.08);
      engine.oscA.stop(now + 0.3);
      engine.oscB.stop(now + 0.3);
    } catch {
      /* já parado */
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    storageSet(MUTE_KEY, this.muted ? '1' : '0');

    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.03);
    }
    if (this.muted) this._stopEngine();
    return this.muted;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  dispose() {
    this._stopEngine();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.master = null;
      this.noise = null;
    }
  }
}
