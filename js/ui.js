import { sanitizeCode, sanitizeName, isTouch } from './utils.js';

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
    this.toasts = document.getElementById('toasts');
    this.hint = document.getElementById('hint');
    this.prompt = document.getElementById('prompt');
    this.actionBtn = document.getElementById('actionBtn');
    this.touchEl = document.getElementById('touch');

    this.roomCode = '';
    this.busy = false;
    this.joined = false;
    this.callbacks = { create: null, join: null, chat: null, action: null };
    this._promptText = null;
    this._actionLabel = null;

    this._bind();
    this._restore();
  }

  // ------------------------------------------------------------- callbacks

  onCreate(fn) { this.callbacks.create = fn; return this; }
  onJoin(fn) { this.callbacks.join = fn; return this; }
  onChat(fn) { this.callbacks.chat = fn; return this; }
  onAction(fn) { this.callbacks.action = fn; return this; }

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

    this.chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.chatInput.value.trim();
      if (!text) return;
      this.chatInput.value = '';
      this.callbacks.chat?.(text);
    });

    window.addEventListener('keydown', (event) => {
      if (!this.joined) return;

      const typing = document.activeElement === this.chatInput;

      if (event.key === 'Enter' && !typing) {
        event.preventDefault();
        this.chatInput.focus();
        return;
      }

      if (event.key === 'Escape' && typing) {
        this.chatInput.blur();
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
    this.menu.classList.remove('is-hidden', 'closing');
    this.setBusy(false);
  }

  showHud() {
    this.hud.classList.remove('is-hidden');
    this.hud.setAttribute('aria-hidden', 'false');
  }

  hideHud() {
    this.hud.classList.add('is-hidden');
    this.hud.setAttribute('aria-hidden', 'true');
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
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast${kind ? ` ${kind}` : ''}`;
    el.textContent = text;
    this.toasts.append(el);
    setTimeout(() => el.remove(), 3400);
  }
}
