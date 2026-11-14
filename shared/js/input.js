// 输入：键盘、虚拟摇杆、带拖动瞄准的按钮。
// 全部用 Pointer Events，一套代码同时支持触屏和鼠标，并且支持多指同时操作（一手摇杆一手技能）。
import { el } from './ui.js';
import { clamp } from './util.js';

/** 键盘状态 */
export class Keys {
  constructor() {
    this.down = new Set();   // 当前按住的键
    this.hits = new Set();   // 本帧刚按下的键
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (!e.repeat) this.hits.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }
  /** 任意一个键被按住 */
  isDown(...codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  /** 本帧是否刚按下 */
  hit(code) { return this.hits.has(code); }
  /** 每个逻辑帧结束时调用 */
  endFrame() { this.hits.clear(); }
  /** 方向键 / WASD 合成的方向，x 右为正，y 下为正 */
  axis() {
    const x = (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (this.isDown('KeyW', 'ArrowUp') ? 1 : 0);
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m, active: x !== 0 || y !== 0 };
  }
}

/**
 * 虚拟摇杆。手指按在 zone 区域内的任意位置，摇杆就出现在那里（动态摇杆），松手回到默认位置。
 * 输出 x、y ∈ [-1, 1]（x 右为正，y 下为正）、mag（0~1）、active。
 */
export class Joystick {
  /**
   * @param {HTMLElement} zone 可触发摇杆的区域
   * @param {object} [o]
   * @param {number} [o.radius=52] 摇杆可拖动的半径（像素）
   */
  constructor(zone, o = {}) {
    this.zone = zone;
    this.radius = o.radius || 52;
    this.x = 0; this.y = 0; this.mag = 0; this.active = false;
    this._id = -1; this._cx = 0; this._cy = 0;
    this.base = el('div', { cls: 'g-joy' }, zone);
    this.knob = el('div', { cls: 'g-joy-knob' }, this.base);
    zone.addEventListener('pointerdown', (e) => this._down(e));
    zone.addEventListener('pointermove', (e) => this._move(e));
    const up = (e) => this._up(e);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);
  }
  _down(e) {
    if (this._id !== -1) return;
    this._id = e.pointerId;
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    const r = this.zone.getBoundingClientRect();
    this._cx = e.clientX; this._cy = e.clientY;
    // 把底盘移到手指落点
    this.base.style.left = (e.clientX - r.left) + 'px';
    this.base.style.top = (e.clientY - r.top) + 'px';
    this.base.classList.add('on');
    this.active = true;
    this._set(0, 0);
    e.preventDefault();
  }
  _move(e) {
    if (e.pointerId !== this._id) return;
    let dx = e.clientX - this._cx, dy = e.clientY - this._cy;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) { dx *= this.radius / d; dy *= this.radius / d; }
    this._set(dx / this.radius, dy / this.radius);
  }
  _up(e) {
    if (e.pointerId !== this._id) return;
    this._id = -1;
    this.active = false;
    this.base.classList.remove('on');
    this.base.style.left = ''; this.base.style.top = '';
    this._set(0, 0);
  }
  _set(x, y) {
    this.x = x; this.y = y; this.mag = Math.min(1, Math.hypot(x, y));
    this.knob.style.transform = `translate(${x * this.radius}px, ${y * this.radius}px)`;
  }
}

/**
 * 动作按钮：支持按下、松开，以及按住拖动来瞄准（技能方向）。
 * 冷却用一圈扇形遮罩显示。
 */
export class ActionButton {
  /**
   * @param {HTMLElement} parent
   * @param {object} o
   * @param {string} [o.cls] 额外类名（决定大小和位置）
   * @param {string} [o.label] 按钮文字
   * @param {string} [o.icon] 图标（一段 HTML/SVG）
   * @param {boolean} [o.aim] 是否支持拖动瞄准
   * @param {number} [o.aimRadius=64] 拖满的像素距离
   * @param {(btn)=>void} [o.onDown]
   * @param {(ax:number, ay:number, mag:number, btn)=>void} [o.onAim] 拖动中，ax、ay ∈ [-1,1]
   * @param {(ax:number, ay:number, mag:number, cancelled:boolean, btn)=>void} [o.onUp]
   */
  constructor(parent, o = {}) {
    this.o = o;
    this.el = el('div', { cls: 'g-btn ' + (o.cls || '') }, parent);
    this.iconEl = el('div', { cls: 'g-btn-icon', html: o.icon || '' }, this.el);
    this.cdEl = el('div', { cls: 'g-btn-cd' }, this.el);
    this.cdText = el('div', { cls: 'g-btn-cdtext' }, this.el);
    this.labelEl = el('div', { cls: 'g-btn-label', text: o.label || '' }, this.el);
    this.badgeEl = el('div', { cls: 'g-btn-badge' }, this.el);
    this.pressed = false; this.enabled = true;
    this._id = -1; this._sx = 0; this._sy = 0; this._cdShown = -1;
    this.ax = 0; this.ay = 0; this.mag = 0;
    this.aimRadius = o.aimRadius || 64;
    const e = this.el;
    e.addEventListener('pointerdown', (ev) => this._down(ev));
    e.addEventListener('pointermove', (ev) => this._move(ev));
    const up = (ev) => this._up(ev);
    e.addEventListener('pointerup', up);
    e.addEventListener('pointercancel', (ev) => this._up(ev, true));
  }
  _down(e) {
    if (this._id !== -1) return;
    e.preventDefault(); e.stopPropagation();
    this._id = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    this._sx = e.clientX; this._sy = e.clientY;
    this.ax = 0; this.ay = 0; this.mag = 0;
    this.pressed = true;
    this.el.classList.add('down');
    this.o.onDown?.(this);
  }
  _move(e) {
    if (e.pointerId !== this._id || !this.o.aim) return;
    let dx = e.clientX - this._sx, dy = e.clientY - this._sy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(1, d / this.aimRadius);
    if (d > 1e-3) { dx /= d; dy /= d; }
    this.ax = dx * m; this.ay = dy * m; this.mag = m;
    this.o.onAim?.(this.ax, this.ay, m, this, e);
  }
  _up(e, cancelled = false) {
    if (e.pointerId !== this._id) return;
    this._id = -1;
    this.pressed = false;
    this.el.classList.remove('down');
    this.o.onUp?.(this.ax, this.ay, this.mag, cancelled, this, e);
  }
  /** 显示冷却：remain 剩余秒数，total 总秒数。变化不大时不改 DOM，省性能 */
  setCooldown(remain, total) {
    const shown = remain <= 0 ? 0 : remain < 10 ? Math.ceil(remain * 10) / 10 : Math.ceil(remain);
    if (shown === this._cdShown) return;
    this._cdShown = shown;
    if (remain <= 0) {
      this.cdEl.style.display = 'none'; this.cdText.textContent = '';
    } else {
      const deg = clamp(remain / total, 0, 1) * 360;
      this.cdEl.style.display = 'block';
      this.cdEl.style.background = `conic-gradient(rgba(0,0,0,.62) ${deg}deg, transparent 0)`;
      this.cdText.textContent = remain < 10 ? shown.toFixed(1) : shown;
    }
  }
  setEnabled(b) { if (b !== this.enabled) { this.enabled = b; this.el.classList.toggle('off', !b); } }
  setBadge(t) { if (this.badgeEl.textContent !== t) this.badgeEl.textContent = t; }
  setLabel(t) { if (this.labelEl.textContent !== t) this.labelEl.textContent = t; }
  setIcon(html) { this.iconEl.innerHTML = html; }
  show(b) { this.el.style.display = b ? '' : 'none'; }
}

/**
 * 屏幕拖动区域：用于转动视角等。每帧读取 dx、dy（像素增量）后调用 consume() 清零。
 */
export class DragPad {
  constructor(zone) {
    this.dx = 0; this.dy = 0; this.active = false; this.taps = 0;
    this._id = -1; this._lx = 0; this._ly = 0; this._moved = 0; this._t = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (this._id !== -1) return;
      this._id = e.pointerId; this._lx = e.clientX; this._ly = e.clientY; this._moved = 0; this._t = performance.now();
      this.active = true;
      try { zone.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._id) return;
      const mx = e.clientX - this._lx, my = e.clientY - this._ly;
      this.dx += mx; this.dy += my; this._moved += Math.abs(mx) + Math.abs(my);
      this._lx = e.clientX; this._ly = e.clientY;
    });
    const up = (e) => {
      if (e.pointerId !== this._id) return;
      this._id = -1; this.active = false;
      if (this._moved < 8 && performance.now() - this._t < 300) this.taps++; // 轻点
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }
  consume() { const r = { dx: this.dx, dy: this.dy, taps: this.taps }; this.dx = 0; this.dy = 0; this.taps = 0; return r; }
}
