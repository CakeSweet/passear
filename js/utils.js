export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolação independente de framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Interpola ângulos pelo caminho mais curto. */
export function dampAngle(a, b, lambda, dt) {
  const twoPi = Math.PI * 2;
  let delta = (b - a + Math.PI) % twoPi;
  if (delta < 0) delta += twoPi;
  delta -= Math.PI;
  return a + delta * (1 - Math.exp(-lambda * dt));
}

export function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Sempre a mesma cor para o mesmo nome — com matiz variado o bastante para
 * duas pessoas não saírem iguais, evitando a faixa do verde (some na grama).
 */
export function colorForName(name = '') {
  const hash = hashCode(name.trim().toLowerCase() || 'anônimo');
  let hue = hash % 360;
  if (hue >= 62 && hue <= 168) hue = (hue + 184) % 360;

  const saturation = 56 + ((hash >>> 9) % 18);
  const lightness = 54 + ((hash >>> 17) % 10);
  return hslToHex(hue, saturation, lightness);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 5) {
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function sanitizeCode(value = '') {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function sanitizeName(value = '') {
  return value.replace(/\s+/g, ' ').trim().slice(0, 16);
}

export const isTouch = () =>
  window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;

export function formatSeconds(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
