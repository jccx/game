// 音效：全部用 Web Audio 现场合成，不需要任何音频文件。
// 浏览器要求用户先点一下页面才能出声，所以第一次触摸/点击时调用 Sfx.unlock()。
import { store } from './ui.js';

let ctx = null, master = null, noiseBuf = null;

/** 取得（必要时创建）音频上下文 */
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = Sfx.muted ? 0 : Sfx.volume;
      master.connect(ctx.destination);
      // 1 秒白噪声，供爆炸、枪声等使用
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }
  return ctx;
}

export const Sfx = {
  muted: store.get('muted', false),
  volume: 0.5,
  _last: {},   // 每种音效上次播放的时间，用来限制同一音效的触发频率

  /** 用户第一次操作时调用，解除浏览器的静音限制 */
  unlock() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); },

  setMuted(m) {
    this.muted = m; store.set('muted', m);
    if (master) master.gain.value = m ? 0 : this.volume;
  },

  /** 一个音调：f 起始频率，f2 结束频率（滑音），dur 时长，type 波形 */
  tone({ f = 440, f2 = 0, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 } = {}) {
    const c = ac(); if (!c || this.muted || c.state !== 'running') return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /** 一段过滤后的噪声：f 滤波频率，f2 结束频率 */
  noise({ dur = 0.2, vol = 0.3, f = 1200, f2 = 0, q = 0.8, type = 'lowpass', delay = 0 } = {}) {
    const c = ac(); if (!c || this.muted || c.state !== 'running') return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  },

  /**
   * 播放预设音效。gap 是同名音效的最小间隔（秒），避免一帧内叠几十个同样的声音。
   */
  play(name, gap = 0.05) {
    const now = performance.now() / 1000;
    if (now - (this._last[name] || 0) < gap) return;
    this._last[name] = now;
    const p = PRESETS[name];
    if (p) p(this);
  },

  /**
   * 持续的引擎声。返回 { set(pitch, vol), stop() }；pitch 约 0~1。
   */
  engine() {
    const c = ac(); if (!c) return { set() {}, stop() {} };
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
    o.type = 'sawtooth'; o2.type = 'square';
    fl.type = 'lowpass'; fl.frequency.value = 500;
    g.gain.value = 0;
    o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(master);
    o.start(); o2.start();
    return {
      set(pitch, vol) {
        const t = c.currentTime;
        const f = 45 + pitch * 130;
        o.frequency.setTargetAtTime(f, t, 0.05);
        o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
        fl.frequency.setTargetAtTime(300 + pitch * 900, t, 0.05);
        g.gain.setTargetAtTime(Sfx.muted ? 0 : vol, t, 0.08);
      },
      stop() { try { g.gain.value = 0; o.stop(); o2.stop(); } catch { /* 已停止 */ } },
    };
  },
};

/** 预设音效表：名字 → 合成方法 */
const PRESETS = {
  click:   (s) => s.tone({ f: 660, f2: 880, dur: 0.06, type: 'triangle', vol: 0.15 }),
  hit:     (s) => { s.noise({ dur: 0.08, vol: 0.25, f: 2200, f2: 500 }); s.tone({ f: 180, f2: 90, dur: 0.08, type: 'square', vol: 0.08 }); },
  slash:   (s) => s.noise({ dur: 0.12, vol: 0.2, f: 4000, f2: 900, type: 'bandpass', q: 1.5 }),
  shoot:   (s) => { s.noise({ dur: 0.1, vol: 0.3, f: 3000, f2: 400 }); s.tone({ f: 320, f2: 80, dur: 0.1, type: 'square', vol: 0.1 }); },
  arrow:   (s) => s.noise({ dur: 0.1, vol: 0.12, f: 5000, f2: 1500, type: 'bandpass', q: 2 }),
  magic:   (s) => { s.tone({ f: 520, f2: 1200, dur: 0.18, type: 'sine', vol: 0.15 }); s.tone({ f: 780, f2: 1500, dur: 0.14, type: 'triangle', vol: 0.08, delay: 0.03 }); },
  boom:    (s) => { s.noise({ dur: 0.5, vol: 0.5, f: 900, f2: 60 }); s.tone({ f: 90, f2: 30, dur: 0.4, type: 'sine', vol: 0.35 }); },
  bigboom: (s) => { s.noise({ dur: 0.9, vol: 0.6, f: 700, f2: 40 }); s.tone({ f: 70, f2: 24, dur: 0.7, type: 'sine', vol: 0.45 }); },
  coin:    (s) => { s.tone({ f: 990, dur: 0.07, type: 'square', vol: 0.08 }); s.tone({ f: 1320, dur: 0.12, type: 'square', vol: 0.08, delay: 0.07 }); },
  levelup: (s) => { [523, 659, 784, 1047].forEach((f, i) => s.tone({ f, dur: 0.14, type: 'triangle', vol: 0.14, delay: i * 0.07 })); },
  skill:   (s) => { s.noise({ dur: 0.2, vol: 0.15, f: 800, f2: 3000, type: 'bandpass', q: 1 }); s.tone({ f: 300, f2: 700, dur: 0.2, type: 'sawtooth', vol: 0.07 }); },
  dash:    (s) => s.noise({ dur: 0.18, vol: 0.18, f: 600, f2: 2600, type: 'bandpass', q: 0.8 }),
  heal:    (s) => { s.tone({ f: 440, f2: 880, dur: 0.3, type: 'sine', vol: 0.12 }); },
  hurt:    (s) => s.tone({ f: 220, f2: 110, dur: 0.15, type: 'sawtooth', vol: 0.12 }),
  die:     (s) => s.tone({ f: 300, f2: 60, dur: 0.5, type: 'sawtooth', vol: 0.15 }),
  win:     (s) => { [523, 659, 784, 1047, 1319].forEach((f, i) => s.tone({ f, dur: 0.25, type: 'triangle', vol: 0.16, delay: i * 0.12 })); },
  lose:    (s) => { [392, 330, 262, 196].forEach((f, i) => s.tone({ f, dur: 0.3, type: 'triangle', vol: 0.16, delay: i * 0.16 })); },
  tower:   (s) => { s.tone({ f: 900, f2: 300, dur: 0.15, type: 'square', vol: 0.07 }); },
  crash:   (s) => { s.noise({ dur: 0.25, vol: 0.4, f: 1500, f2: 200 }); },
  horn:    (s) => { s.tone({ f: 420, dur: 0.25, type: 'square', vol: 0.1 }); s.tone({ f: 530, dur: 0.25, type: 'square', vol: 0.1 }); },
  siren:   (s) => { s.tone({ f: 700, f2: 1000, dur: 0.25, type: 'sine', vol: 0.08 }); s.tone({ f: 1000, f2: 700, dur: 0.25, type: 'sine', vol: 0.08, delay: 0.25 }); },
  jump:    (s) => s.tone({ f: 300, f2: 620, dur: 0.12, type: 'square', vol: 0.08 }),
  splash:  (s) => s.noise({ dur: 0.35, vol: 0.25, f: 1800, f2: 400, type: 'bandpass', q: 0.6 }),
  boost:   (s) => { s.noise({ dur: 0.5, vol: 0.2, f: 500, f2: 3500, type: 'bandpass', q: 0.7 }); },
  beep:    (s) => s.tone({ f: 880, dur: 0.1, type: 'square', vol: 0.1 }),
  go:      (s) => s.tone({ f: 1320, dur: 0.35, type: 'square', vol: 0.12 }),
  error:   (s) => s.tone({ f: 160, dur: 0.12, type: 'square', vol: 0.1 }),
};
