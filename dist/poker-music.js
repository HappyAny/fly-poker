/* One optional, lazy-loaded background track. Music never enters game state. */
(function(root) {
  'use strict';
  class PokerMusic {
    constructor(options = {}) {
      this.document = options.document ?? root.document;
      this.storage = options.storage;
      if (!this.storage) {try {this.storage = root.localStorage;} catch {}}
      this.Audio = options.Audio ?? root.Audio;
      this.i18n = options.i18n ?? root.PokerI18n;
      this.audio = null;
      this.activated = false;
      this.suspended = false;
      this.failed = false;
      this.destroyed = false;
      this.generation = 0;
      this.pending = null;
      let saved;
      try {saved = JSON.parse(this.storage?.getItem('fly-poker-music') || '{}');} catch {}
      this.enabled = saved?.enabled !== false;
      this.volume = Number.isFinite(saved?.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.25;
      const get = id => this.document?.getElementById?.(id);
      this.control = get('musicControl');
      this.button = get('musicButton');
      this.toggle = get('musicToggle');
      this.range = get('musicVolume');
      this.output = get('musicVolumeValue');
      this.button?.addEventListener('click', () => this.activate());
      this.toggle?.addEventListener('change', () => this.setEnabled(this.toggle.checked));
      this.range?.addEventListener('input', () => this.setVolume(Number(this.range.value) / 100));
      this.outside = event => {if (this.control?.open && !this.control.contains(event.target)) this.control.open = false;};
      this.escape = event => {if (event.key === 'Escape' && this.control) this.control.open = false;};
      this.document?.addEventListener?.('pointerdown', this.outside);
      this.document?.addEventListener?.('keydown', this.escape);
      this.render();
    }
    get shouldPlay() {return this.activated && this.enabled && !this.suspended && !this.destroyed;}
    persist() {try {this.storage?.setItem('fly-poker-music', JSON.stringify({enabled:this.enabled,volume:this.volume}));} catch {}}
    activate() {
      if (this.destroyed) return;
      this.activated = true;
      if (this.audio?.error) {this.audio.load(); this.failed = false;}
      this.sync();
    }
    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (this.enabled) this.activated = true;
      this.persist(); this.sync();
    }
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      this.volume = Math.max(0, Math.min(1, value));
      if (this.audio) this.audio.volume = this.volume;
      this.persist(); this.render();
    }
    setSuspended(suspended) {
      if (this.suspended === Boolean(suspended)) return;
      this.suspended = Boolean(suspended); this.sync();
    }
    sync() {
      if (!this.shouldPlay) {
        this.generation++; this.pending = null;
        this.audio?.pause(); this.render(); return;
      }
      if (!this.Audio) {this.failed = true; this.render(); return;}
      if (!this.audio) {
        try {this.audio = new this.Audio(new URL('audio/table-lounge.mp3', this.document?.baseURI || 'http://localhost/').href);}
        catch {this.failed = true; this.render(); return;}
        this.audio.id = 'bgmAudio';
        this.audio.preload = 'none';
        this.audio.loop = true;
        this.audio.hidden = true;
        this.audio.volume = this.volume;
        this.audio.addEventListener('play', () => this.render());
        this.audio.addEventListener('pause', () => this.render());
        this.audio.addEventListener('error', () => {this.failed = true; this.render();});
        this.document?.body?.append?.(this.audio);
      }
      if (!this.audio.paused || this.pending) {this.render(); return;}
      const generation = ++this.generation;
      try {
        this.pending = Promise.resolve(this.audio.play()).then(() => {
          if (!this.shouldPlay) this.audio.pause();
          if (generation !== this.generation) return;
          this.pending = null; this.failed = false;
          if (!this.shouldPlay) this.audio.pause();
          this.render();
        }).catch(() => {
          if (generation !== this.generation) return;
          this.pending = null; this.failed = true; this.render();
        });
      } catch {this.pending = null; this.failed = true; this.render();}
      this.render();
    }
    render() {
      const state = this.failed ? 'blocked' : !this.enabled ? 'off' : this.audio && !this.audio.paused ? 'playing' : 'ready';
      if (this.control) this.control.dataset.sound = state;
      if (this.toggle) this.toggle.checked = this.enabled;
      if (this.range) this.range.value = String(Math.round(this.volume * 100));
      if (this.output) this.output.textContent = Math.round(this.volume * 100) + '%';
      if (this.button && this.i18n) {
        this.i18n.text(this.button, this.failed ? '背景音乐暂不可用' : '背景音乐设置', {}, 'aria-label');
        this.i18n.text(this.button, this.failed ? '背景音乐暂不可用' : '背景音乐设置', {}, 'title');
      }
    }
    destroy() {
      this.destroyed = true; this.generation++; this.pending = null;
      this.audio?.pause(); this.audio?.remove?.();
      this.document?.removeEventListener?.('pointerdown', this.outside);
      this.document?.removeEventListener?.('keydown', this.escape);
    }
  }
  root.PokerMusic = PokerMusic;
  if (typeof module !== 'undefined' && module.exports) module.exports = PokerMusic;
})(globalThis);
