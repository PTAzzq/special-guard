/** 程序化合成音效（全部由 WebAudio 生成，不使用任何外部音频素材） */
class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);

    // 白噪声缓冲
    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.noiseBuf = buf;
    return this.ctx;
  }

  _noise(dur, filterFreq, gain, decay = 0.9, type = 'lowpass') {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  _tone(freq, dur, gain = 0.2, type = 'sine', slideTo = null) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  shot(weapon) {
    const heavy = weapon && (weapon.cls === '狙击枪' || weapon.id === 'deagle' || weapon.id === 'revolver');
    const big = weapon && weapon.cls === '狙击枪';
    this._noise(big ? 0.30 : heavy ? 0.22 : 0.13, big ? 1400 : heavy ? 1800 : 2600, big ? 0.95 : 0.7, 1);
    this._tone(big ? 90 : heavy ? 120 : 170, big ? 0.26 : 0.14, 0.55, 'square', big ? 40 : 60);
  }

  dryFire() { this._tone(900, 0.04, 0.15, 'square', 600); }
  reloadStart() { this._noise(0.10, 1200, 0.22); }
  reloadEnd() { this._noise(0.09, 2400, 0.28); this._tone(420, 0.05, 0.12, 'square'); }
  hit() { this._tone(1600, 0.05, 0.18, 'sine', 900); }
  headshot() { this._tone(2200, 0.09, 0.22, 'sine', 1200); }
  bodyFall() { this._noise(0.22, 400, 0.4); }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.28, 0.24, 'triangle'), i * 130));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this._tone(f, 0.36, 0.26, 'sawtooth'), i * 150));
  }
  click() { this._tone(700, 0.03, 0.1, 'square'); }
}

export const sfx = new Sfx();
