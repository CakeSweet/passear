import { sanitizeCode, sanitizeName, isTouch } from './utils.js';

/** Cores do seletor do menu. */
const PALETTE = [
  { hex: '#ff8f6b', name: 'coral' },
  { hex: '#f2c94c', name: 'amarelo' },
  { hex: '#f2994a', name: 'laranja' },
  { hex: '#e2564a', name: 'vermelho' },
  { hex: '#f26d9c', name: 'rosa' },
  { hex: '#a97cf4', name: 'roxo' },
  { hex: '#5b9cf6', name: 'azul' },
  { hex: '#4dd0e1', name: 'ciano' },
  { hex: '#4fc3b8', name: 'turquesa' },
  { hex: '#9adf7a', name: 'verde' },
  { hex: '#e8eef4', name: 'branco' },
  { hex: '#8d9aa8', name: 'cinza' },
];

/** Tempo sem interação até o chat recolher. */
const CHAT_IDLE_MS = 9000;

export class UI {
  constructor() {
    this.menu = document.getElementById('menu');
    this.form = document.getElementById('menuForm');
    this.nameInput = document.getElementById('nameInput');
    this.codeInput = document.getElementById('codeInput');
    this.createBtn = document.getElementById('createBtn');
    this.joinBtn = document.getElementById('joinBtn');
    this.status = document.getElementById('menuStatus');

    this.hud = document.getElementById('hud');
    this.roomCodeEl = document.getElementById('roomCode');
    this.copyBtn = document.getElementById('copyBtn');
    this.onlineCount = document.getElementById('onlineCount');
    this.pingValue = document.getElementById('pingValue');
    this.peopleList = document.getElementById('peopleList');
    this.chatLog = document.getElementById('chatLog');
    this.chatForm = document.getElementById('chatForm');
    this.chatInput = document.getElementById('chatInput');
    this.chatPanel = document.getElementById('chatPanel');
    this.chatBadge = document.getElementById('chatBadge');
    this.colorPicker = document.getElementById('colorPicker');
    this.punchBtn = document.getElementById('punchBtn');
    this.toasts = document.getElementById('toasts');
    this.hint = document.getElementById('hint');
    this.prompt = document.getElementById('prompt');
    this.actionBtn = document.getElementById('actionBtn');
    this.touchEl = document.getElementById('touch');

    this.roomCode = '';
    this.busy = false;
    this.joined = false;
    this.callbacks = { create: null, join: null, chat: null, action: null, punch: null };
    this._promptText = null;
    this._actionLabel = null;

    this.color = localStorage.getItem('passear:cor') || PALETTE[0].hex;
    this.chatIdle = false;
    this._chatTimer = null;
    this._unread = 0;

    this._bind();
    this._buildColors();
    this._restore();
  }

  // ------------------------------------------------------------- callbacks

  onCreate(fn) { this.callbacks.create = fn; return this; }
  onJoin(fn) { this.callbacks.join = fn; return this; }
  onChat(fn) { this.callbacks.chat = fn; return this; }
  onAction(fn) { this.callbacks.action = fn; return this; }
  onPunch(fn) { this.callbacks.punch = fn; return this; }

  // ------------------------------------------------------------------ cores

  _buildColors() {
    if (!this.colorPicker) return;

    const known = PALETTE.some((entry) => entry.hex.toLowerCase() === this.color.toLowerCase());
    if (!known) this.color = PALETTE[0].hex;

    const fragment = document.createDocumentFragment();
    for (const entry of PALETTE) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.color = entry.hex;
      button.style.setProperty('--swatch', entry.hex);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', `Cor ${entry.name}`);
      button.setAttribute('aria-checked', String(entry.hex === this.color));
      button.title = entry.name;
      button.addEventListener('click', () => this._pickColor(entry.hex));
      fragment.append(button);
    }

    this.colorPicker.replaceChildren(fragment);
  }

  _pickColor(hex) {
    if (!hex) return;
    this.color = hex;
    localStorage.setItem('passear:cor', hex);
    for (const button of this.colorPicker?.querySelectorAll('.swatch') ?? []) {
      button.setAttribute('aria-checked', String(button.dataset.color === hex));
    }
  }

  getColor() {
    return this.color;
  }

  // ----------------------------------------------------------------- setup

  _bind() {
    this.nameInput.value = localStorage.getItem('passear:nome') || '';

    this.codeInput.addEventListener('input', () => {
      const caret = this.codeInput.selectionStart;
      const clean = sanitizeCode(this.codeInput.value);
      this.codeInput.value = clean;
      this.codeInput.setSelectionRange(Math.min(caret, clean.length), Math.min(caret, clean.length));
    });

    this.createBtn.addEventListener('click', () => this._create());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this._join();
    });

    this.copyBtn.addEventListener('click', () => this._copyInvite());

    this.actionBtn?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.callbacks.action?.();
    });

    this.punchBtn?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.callbacks.punch?.();
    });

    // o chat recolhe sozinho e abre de novo com qualquer interação
    this.chatPanel?.addEventListener('pointerenter', () => this.setChatIdle(false));
    this.chatPanel?.addEventListener('pointerdown', () => {
      const wasIdle = this.chatIdle;
      this.revealChat({ focus: wasIdle });
    });
    this.chatPanel?.addEventListener('focusin', () => this.revealChat());
    this.chatInput.addEventListener('input', () => this.revealChat());

    this.chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.chatIdle) {
        this.revealChat({ focus: true });
        return;
      }
      const text = this.chatInput.value.trim();
      if (!text) return;
      this.chatInput.value = '';
      this.callbacks.chat?.(text);
      this._armChatIdle();
    });

    window.addEventListener('keydown', (event) => {
      if (!this.joined) return;

      const typing = document.activeElement === this.chatInput;

      if (event.key === 'Enter' && !typing) {
        event.preventDefault();
        this.revealChat({ focus: true });
        return;
      }

      if (event.key === 'Escape' && typing) {
        this.chatInput.blur();
        this._armChatIdle();
      }
    });

    if (isTouch()) this.showTouch();
  }

  _restore() {
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const invited = sanitizeCode(params.get('sala') || hash.get('sala') || '');

    if (invited) {
      this.codeInput.value = invited;
      this.setStatus(`Convite para a sala ${invited}. Coloque seu nome e entre.`, 'ok');
      if (!this.nameInput.value) this.nameInput.focus();
    }
  }

  prefillCode(code) {
    this.codeInput.value = sanitizeCode(code);
  }

  // ------------------------------------------------------------------ fluxo

  _name() {
    const name = sanitizeName(this.nameInput.value);
    if (!name) {
      this.setStatus('Escolha um nome para entrar.', 'error');
      this.nameInput.focus();
      return null;
    }
    this.nameInput.value = name;
    localStorage.setItem('passear:nome', name);
    return name;
  }

  _create() {
    if (this.busy) return;
    const name = this._name();
    if (!name) return;
    this.callbacks.create?.(name);
  }

  _join() {
    if (this.busy) return;
    const name = this._name();
    if (!name) return;

    const code = sanitizeCode(this.codeInput.value);
    if (code.length < 4) {
      this.setStatus('Digite o código da sala (ex.: ABC12).', 'error');
      this.codeInput.focus();
      return;
    }

    this.codeInput.value = code;
    this.callbacks.join?.(name, code);
  }

  setBusy(busy) {
    this.busy = busy;
    this.createBtn.disabled = busy;
    this.joinBtn.disabled = busy;
  }

  setStatus(text = '', kind = '') {
    this.status.textContent = text;
    this.status.className = `status${kind ? ` ${kind}` : ''}`;
  }

  hideMenu() {
    this.menu.classList.add('closing');
    this.joined = true;
    setTimeout(() => this.menu.classList.add('is-hidden'), 380);
  }

  showMenu() {
    this.joined = false;
    clearTimeout(this._chatTimer);
    this._chatTimer = null;
    this.chatIdle = false;
    this.chatPanel?.classList.remove('is-idle');
    this.chatBadge?.classList.add('is-hidden');
    this.menu.classList.remove('is-hidden', 'closing');
    this.setBusy(false);
  }

  showHud() {
    this.hud.classList.remove('is-hidden');
    this.hud.setAttribute('aria-hidden', 'false');
    this._armChatIdle();
  }

  hideHud() {
    this.hud.classList.add('is-hidden');
    this.hud.setAttribute('aria-hidden', 'true');
  }

  // ------------------------------------------------------------------ chat

  _armChatIdle(delay = CHAT_IDLE_MS) {
    clearTimeout(this._chatTimer);
    this._chatTimer = null;
    if (!this.joined) return;

    this._chatTimer = setTimeout(() => {
      this._chatTimer = null;
      this.setChatIdle(true);
    }, delay);
  }

  /** Recolhe o chat para o botão redondo (ou abre de novo). */
  setChatIdle(idle) {
    const next = Boolean(idle);

    if (next && document.activeElement === this.chatInput) {
      // digitando: espera mais um pouco em vez de sumir com o campo
      this._armChatIdle(4000);
      return;
    }

    if (next === this.chatIdle) {
      if (!next) this._armChatIdle();
      return;
    }

    this.chatIdle = next;
    this.chatPanel?.classList.toggle('is-idle', next);
    clearTimeout(this._chatTimer);
    this._chatTimer = null;

    if (next) return;

    this.chatBadge?.classList.add('is-hidden');
    this._unread = 0;
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    this._armChatIdle();
  }

  revealChat({ focus = false } = {}) {
    this.setChatIdle(false);
    if (focus) this.chatInput.focus();
  }

  showTouch() {
    this.touchEl.classList.remove('is-hidden');
    if (this.hint) this.hint.textContent = 'arraste para olhar · direcional para andar';
  }

  setRoom(code) {
    this.roomCode = code;
    this.roomCodeEl.textContent = code;
  }

  async _copyInvite() {
    if (!this.roomCode) return;
    const url = new URL(location.href);
    url.hash = `sala=${this.roomCode}`;
    url.search = '';

    try {
      await navigator.clipboard.writeText(url.toString());
      this.toast('Link de convite copiado', 'join');
    } catch {
      window.prompt('Copie o link da sala:', url.toString());
    }
  }

  // ------------------------------------------------------------------- hud

  setPing(ms) {
    this.pingValue.textContent = typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms) : '—';
  }

  /** Dica contextual no rodapé (desktop). Texto vazio esconde. */
  setPrompt(text = '') {
    if (text === this._promptText) return;
    this._promptText = text;
    this.prompt.textContent = text;
    this.prompt.classList.toggle('is-hidden', !text);
  }

  /** Rótulo do botão de ação no toque. */
  setActionLabel(label = '') {
    if (label === this._actionLabel) return;
    this._actionLabel = label;
    this.actionBtn.textContent = label;
    this.actionBtn.classList.toggle('is-hidden', !label);
  }

  /** Mostra o botão de soco apenas quando dá para socar. */
  setPunchVisible(visible) {
    this.punchBtn?.classList.toggle('is-hidden', !visible);
  }

  setParticipants(people) {
    this.onlineCount.textContent = people.length;

    const fragment = document.createDocumentFragment();
    for (const person of people.slice(0, 12)) {
      const li = document.createElement('li');
      if (person.me) li.classList.add('me');

      const dot = document.createElement('i');
      dot.style.background = person.color || '#6bd0c4';
      dot.style.color = person.color || '#6bd0c4';
      li.append(dot);

      const name = document.createElement('span');
      name.textContent = person.name + (person.me ? ' (você)' : '');
      li.append(name);

      fragment.append(li);
    }

    if (people.length > 12) {
      const li = document.createElement('li');
      li.textContent = `+${people.length - 12} pessoas`;
      fragment.append(li);
    }

    this.peopleList.replaceChildren(fragment);
  }

  chat({ name = '', text, color = '#eaf2f8', system = false }) {
    const line = document.createElement('div');
    line.className = `msg${system ? ' system' : ''}`;

    if (!system) {
      const who = document.createElement('span');
      who.className = 'who';
      who.style.color = color;
      who.textContent = name;
      line.append(who);
    }

    const body = document.createElement('span');
    body.textContent = text;
    line.append(body);

    this.chatLog.append(line);
    while (this.chatLog.childElementCount > 80) this.chatLog.firstElementChild.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;

    // chegou mensagem com o chat recolhido: só acende o aviso
    if (this.chatIdle) this._bumpUnread();
  }

  _bumpUnread() {
    this._unread++;
    this.chatBadge?.classList.remove('is-hidden');
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast${kind ? ` ${kind}` : ''}`;
    el.textContent = text;
    this.toasts.append(el);
    setTimeout(() => el.remove(), 3400);
  }
}
