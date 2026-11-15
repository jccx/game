// 豆兵大战：画面。Canvas 2D，不用 Three.js。
// 地形画在一张离屏画布上（从逻辑的 mask 逐像素生成），爆炸后只重画爆炸范围那一块；
// 天空、远山、云、水面、豆兵、炮弹、粒子、伤害飘字每帧重画。
// 镜头默认跟随当前行动的豆兵或飞行中的炮弹，拖动可以自由看，全景可以看整张地图。
import { WORLD, PHYS } from './config.js';
import { clamp, damp, lerp } from '../../shared/js/util.js';
import { store, query } from '../../shared/js/ui.js';

const W = WORLD.w, H = WORLD.h;

/** 画质档位：dpr 是像素比上限，particles 是粒子数量系数，clouds 是云的数量 */
export const QUALITY2D = [
  { name: '流畅', dpr: 1, particles: 0.5, clouds: 2 },
  { name: '均衡', dpr: 1.5, particles: 1, clouds: 3 },
  { name: '高清', dpr: 2, particles: 1.5, clouds: 4 },
];

const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export class View {
  /**
   * @param {HTMLElement} container 放画布的元素
   * @param {import('./game.js').Game} game
   * @param {object} [o]
   * @param {(x:number,y:number)=>void} [o.onTap] 轻点画布的回调（世界坐标），空袭/传送选位置用
   */
  constructor(container, game, o = {}) {
    this.game = game; this.onTap = o.onTap || null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'g-canvas';
    container.appendChild(this.canvas);
    this.x = this.canvas.getContext('2d');
    this.cw = 1; this.ch = 1; this.dpr = 1;
    // 画质：?q=0/1/2 可强制指定，否则读本机设置；默认自动
    const forced = query('q'), saved = store.get('artillery-quality', null);
    this.auto = forced === null && (saved === null || saved.auto !== false);
    this.level = forced !== null ? clamp(+forced, 0, 2) : saved ? clamp(saved.level ?? 1, 0, 2) : 1;
    this._ms = 16; this._slow = 0; this._fast = 0;
    // 镜头：x、y 是视野中心的世界坐标
    this.cam = { x: W / 2, y: H / 2, zoom: 0.5, mode: 'follow' };
    this._drag = null; this._pinch = null;
    this.particles = []; this.floats = []; this.tracer = null; this.rings = [];
    this.clouds = [];
    for (let i = 0; i < 4; i++) this.clouds.push({ x: Math.random() * W, y: 50 + Math.random() * 130, s: 60 + Math.random() * 90, v: 4 + Math.random() * 6 });
    this.waterT = 0;
    this.aim = null;      // HUD 正在瞄准时设置：{ angle, power, weapon }
    this.target = null;   // 空袭/传送选中的目标点
    this._skyGrad = null;
    this._buildTerrain();
    this._bind();
    this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', () => setTimeout(this._onResize, 120));
  }
  _onResize = () => this.resize();

  /** 画质设置；auto 为 true 时允许按帧率自动调整 */
  setQuality(level, auto = this.auto) {
    this.level = clamp(level, 0, 2); this.auto = auto;
    store.set('artillery-quality', { level: this.level, auto });
    this.resize();
  }
  get quality() { return QUALITY2D[this.level]; }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
    this._skyGrad = null;
  }

  /* ------------------------------------------------------------ 地形离屏画布 */

  /** 从逻辑的 mask 生成整张地形图（只在开局做一次） */
  _buildTerrain() {
    const g = this.game, th = g.theme;
    this.terrainCv = document.createElement('canvas');
    this.terrainCv.width = W; this.terrainCv.height = H;
    const c = this.terrainCv.getContext('2d');
    this._terrainImg = c.createImageData(W, H);
    this._paintTerrain(0, 0, W, H);
    c.putImageData(this._terrainImg, 0, 0);
  }

  /** 按 mask 重算一块矩形区域的颜色，写进 _terrainImg（不含 putImageData） */
  _paintTerrain(x0, y0, x1, y1) {
    const g = this.game, th = g.theme, m = g.terrain.mask, img = this._terrainImg.data;
    const soilA = rgb(th.soil[0]), soilB = rgb(th.soil[1]), top = rgb(th.top);
    x0 = clamp(x0 | 0, 0, W - 1); y0 = clamp(y0 | 0, 0, H - 1);
    x1 = clamp(x1 | 0, 0, W); y1 = clamp(y1 | 0, 0, H);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        if (!m[y * W + x]) { img[i + 3] = 0; continue; }
        // 表面：上面是空的像素涂草/雪顶，往下渐变到深土
        let topY = y;
        while (topY > 0 && m[(topY - 1) * W + x]) topY--;
        const depth = y - topY;
        const isTop = depth < 5;
        const col = isTop ? top : mix(soilA, soilB, clamp(depth / 130, 0, 1));
        const v = ((x * 374761393 + y * 668265263) | 0) % 13 - 6;   // 每像素一点明暗变化，看起来像土
        img[i] = clamp(col[0] + v, 0, 255); img[i + 1] = clamp(col[1] + v, 0, 255); img[i + 2] = clamp(col[2] + v, 0, 255); img[i + 3] = 255;
      }
    }
  }

  /** 爆炸后只重画受影响的那一块 */
  _dirtyTerrain(x, y, r) {
    const x0 = Math.floor(x - r - 3), y0 = Math.floor(y - r - 3), x1 = Math.ceil(x + r + 3), y1 = Math.ceil(y + r + 3);
    this._paintTerrain(x0, y0, x1, y1);
    const c = this.terrainCv.getContext('2d');
    c.putImageData(this._terrainImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  /* ------------------------------------------------------------ 输入：拖动镜头、点选 */

  _bind() {
    const cv = this.canvas, pts = new Map();
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
      if (pts.size === 2) { const p = [...pts.values()]; this._pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), zoom: this.cam.zoom }; this._drag = null; }
      else this._drag = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.abs(dx) + Math.abs(dy); p.x = e.clientX; p.y = e.clientY;
      if (this._pinch && pts.size === 2) {
        const q = [...pts.values()], d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
        if (d > 10) { this.cam.zoom = clamp(this._pinch.zoom * (d / this._pinch.d), 0.25, 1.6); this.cam.mode = 'free'; }
        return;
      }
      if (this._drag) {
        this.cam.x = clamp(this.cam.x - dx / this.cam.zoom, 0, W);
        this.cam.y = clamp(this.cam.y - dy / this.cam.zoom, 0, H);
        this.cam.mode = 'free';
      }
    });
    const up = (e) => {
      const p = pts.get(e.pointerId);
      if (p && p.moved < 8 && performance.now() - p.t < 350) {
        const r = cv.getBoundingClientRect();
        this.onTap?.(this.cam.x + (e.clientX - r.left - this.cw / 2) / this.cam.zoom, this.cam.y + (e.clientY - r.top - this.ch / 2) / this.cam.zoom);
      }
      pts.delete(e.pointerId);
      if (pts.size < 2) this._pinch = null;
      if (pts.size === 0) this._drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.zoom = clamp(this.cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.25, 1.6);
      this.cam.mode = 'free';
    }, { passive: false });
  }

  /** 镜头目标：跟随当前豆兵或炮弹；全景模式看整张地图 */
  _camTarget() {
    const g = this.game, portrait = this.ch > this.cw;
    if (this.cam.mode === 'overview') return { x: W / 2, y: H / 2, zoom: Math.min(this.cw / W, this.ch / H) * 0.98 };
    let fx = W / 2, fy = H * 0.55;
    if (g.shots.length) { const s = g.shots[0]; fx = s.x; fy = s.y; }
    else if (g.turn.bean && g.turn.bean.alive) { fx = g.turn.bean.x; fy = g.turn.bean.y; }
    const zoom = portrait ? Math.min(this.cw / 760, this.ch / 900) : Math.min(this.cw / 1150, this.ch / 600);
    return { x: fx, y: fy, zoom: clamp(zoom, 0.32, 1.2) };
  }

  setOverview(on) { this.cam.mode = on ? 'overview' : 'follow'; }
  follow() { this.cam.mode = 'follow'; }

  /* ------------------------------------------------------------ 事件：粒子、飘字 */

  onEvent(ev) {
    const k = QUALITY2D[this.level].particles;
    switch (ev.type) {
      case 'boom': {
        this._dirtyTerrain(ev.x, ev.y, ev.r);
        const n = Math.round(26 * k);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.283, sp = 60 + Math.random() * 320;
          this.particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.5 + Math.random() * 0.6, max: 1.1, size: 3 + Math.random() * 6, color: ['#ffb347', '#ff7a3d', '#5a5a5a', '#ffd166'][(Math.random() * 4) | 0], grav: 500 });
        }
        break;
      }
      case 'splash': {
        const n = Math.round(14 * k);
        for (let i = 0; i < n; i++) this.particles.push({ x: ev.x + (Math.random() - 0.5) * 30, y: WORLD.water, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 160, life: 0.5 + Math.random() * 0.4, max: 0.9, size: 2 + Math.random() * 4, color: '#bfe0ff', grav: 700 });
        break;
      }
      case 'dmg': if (ev.b) this.floats.push({ x: ev.b.x, y: ev.b.y - 22, text: '-' + ev.n, life: 0.9, color: '#ff8a7a' }); break;
      case 'gun': this.tracer = { x1: ev.x1, y1: ev.y1, x2: ev.x2, y2: ev.y2, life: 0.25 }; break;
      case 'teleport':
        this.rings.push({ x: ev.x1, y: ev.y1, r: 6, life: 0.5 }); this.rings.push({ x: ev.x2, y: ev.y2, r: 6, life: 0.5 });
        break;
    }
  }

  /* ------------------------------------------------------------ 每帧 */

  update(alpha, fdt) {
    // 画质自动降级：帧耗时连续偏高就降一档，连续流畅就升回来
    if (this.auto && fdt > 0) {
      this._ms = this._ms * 0.95 + Math.min(fdt * 1000, 100) * 0.05;
      if (this._ms > 26 && ++this._slow > 90 && this.level > 0) { this.setQuality(this.level - 1, true); this._slow = 0; }
      else if (this._ms < 15 && ++this._fast > 600 && this.level < 2) { this.setQuality(this.level + 1, true); this._fast = 0; }
      else if (this._ms <= 26) this._slow = 0;
    }
    const g = this.game, dt = Math.min(fdt, 0.05);
    this.waterT += dt;
    for (const c of this.clouds) { c.x += c.v * dt; if (c.x - c.s > W) c.x = -c.s; }
    // 镜头平滑跟随
    const tgt = this._camTarget();
    this.cam.x = damp(this.cam.x, clamp(tgt.x, 0, W), 4, dt);
    this.cam.y = damp(this.cam.y, clamp(tgt.y, 0, H), 4, dt);
    this.cam.zoom = damp(this.cam.zoom, tgt.zoom, this.cam.mode === 'overview' ? 5 : 3, dt);
    // 粒子、飘字、拖影
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.floats.length - 1; i >= 0; i--) { const f = this.floats[i]; f.life -= dt; f.y -= 42 * dt; if (f.life <= 0) this.floats.splice(i, 1); }
    if (this.tracer) { this.tracer.life -= dt; if (this.tracer.life <= 0) this.tracer = null; }
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.life -= dt; r.r += 160 * dt; if (r.life <= 0) this.rings.splice(i, 1); }
    this._draw();
  }

  _draw() {
    const g = this.game, th = g.theme, c = this.x, { cw, ch, dpr } = this;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this._skyGrad) {
      const gr = c.createLinearGradient(0, 0, 0, ch);
      gr.addColorStop(0, th.sky[0]); gr.addColorStop(1, th.sky[1]);
      this._skyGrad = gr;
    }
    c.fillStyle = this._skyGrad; c.fillRect(0, 0, cw, ch);
    const cam = this.cam, z = cam.zoom;
    const sx = (x) => (x - cam.x) * z + cw / 2, sy = (y) => (y - cam.y) * z + ch / 2;
    // 太阳：放屏幕中上方，避开左上的回合信息和右上的按钮
    c.fillStyle = 'rgba(255,244,200,.95)';
    c.beginPath(); c.arc(cw * 0.42, 52, 24, 0, 6.283); c.fill();
    // 云（世界坐标，随风慢慢飘）
    c.fillStyle = th.id === 'snow' ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.85)';
    for (const cl of this.clouds.slice(0, this.quality.clouds)) {
      const x = sx(cl.x), y = sy(cl.y);
      c.beginPath();
      c.ellipse(x, y, cl.s * z, cl.s * 0.36 * z, 0, 0, 6.283);
      c.ellipse(x + cl.s * 0.5 * z, y + 6 * z, cl.s * 0.55 * z, cl.s * 0.3 * z, 0, 0, 6.283);
      c.fill();
    }
    // 远山（两层，固定在世界里）
    c.fillStyle = th.hill;
    c.globalAlpha = 0.55;
    c.beginPath(); c.moveTo(0, sy(WORLD.water));
    for (let x = 0; x <= W; x += 40) c.lineTo(sx(x), sy(WORLD.water - 60 - 50 * Math.sin(x * 0.004 + 1)));
    c.lineTo(sx(W), sy(WORLD.water)); c.closePath(); c.fill();
    c.globalAlpha = 1;
    // 水面：从水线到底部是水，表面画一道波浪线
    const wgr = c.createLinearGradient(0, sy(WORLD.water), 0, ch);
    wgr.addColorStop(0, th.water); wgr.addColorStop(1, '#123a5e');
    c.fillStyle = wgr;
    c.fillRect(0, sy(WORLD.water), cw, ch - sy(WORLD.water));
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.beginPath();
    for (let x = 0; x <= cw; x += 12) {
      const wx = cam.x + (x - cw / 2) / z, wy = WORLD.water + Math.sin(wx * 0.02 + this.waterT * 2.4) * 3;
      const y = sy(wy); x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
    // 地形
    c.drawImage(this.terrainCv, sx(0), sy(0), W * z, H * z);
    // 瞄准预览线（HUD 正在拖开火键时）
    if (this.aim && g.turn.bean && g.turn.bean.alive && g.turn.state === 'aim') {
      const tr = g.trajectory(this.aim.weapon, this.aim.angle, this.aim.power);
      c.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < tr.length; i += 2) { c.beginPath(); c.arc(sx(tr[i]), sy(tr[i + 1]), Math.max(2, 3 * z), 0, 6.283); c.fill(); }
      if (this.aim.weapon === 'shotgun') {
        const b = g.turn.bean, x2 = b.x + Math.cos(this.aim.angle) * 260, y2 = b.y + Math.sin(this.aim.angle) * 260;
        c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2; c.setLineDash([8, 8]);
        c.beginPath(); c.moveTo(sx(b.x), sy(b.y)); c.lineTo(sx(x2), sy(y2)); c.stroke(); c.setLineDash([]);
      }
    }
    // 空袭/传送的目标标记
    if (this.target) {
      c.strokeStyle = '#ffe066'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(sx(this.target.x), sy(this.target.y), 16, 0, 6.283); c.stroke();
      c.beginPath(); c.moveTo(sx(this.target.x) - 22, sy(this.target.y)); c.lineTo(sx(this.target.x) + 22, sy(this.target.y)); c.moveTo(sx(this.target.x), sy(this.target.y) - 22); c.lineTo(sx(this.target.x), sy(this.target.y) + 22); c.stroke();
    }
    // 炮弹和拖影
    for (const s of g.shots) {
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(sx(s.px ?? s.x), sy(s.py ?? s.y)); c.lineTo(sx(s.x), sy(s.y)); c.stroke();
      c.fillStyle = s.id === 'missile' ? '#ff5a5a' : '#222';
      c.beginPath(); c.arc(sx(s.x), sy(s.y), Math.max(4, 6 * z), 0, 6.283); c.fill();
      c.fillStyle = '#ffb347';
      c.beginPath(); c.arc(sx(s.x) - 3, sy(s.y) - 3, 2, 0, 6.283); c.fill();
    }
    // 霰弹枪拖影
    if (this.tracer) {
      c.strokeStyle = `rgba(255,240,160,${this.tracer.life * 4})`; c.lineWidth = 3;
      c.beginPath(); c.moveTo(sx(this.tracer.x1), sy(this.tracer.y1)); c.lineTo(sx(this.tracer.x2), sy(this.tracer.y2)); c.stroke();
    }
    // 传送光圈
    for (const r of this.rings) {
      c.strokeStyle = `rgba(180,140,255,${r.life * 2})`; c.lineWidth = 3;
      c.beginPath(); c.arc(sx(r.x), sy(r.y), r.r, 0, 6.283); c.stroke();
    }
    // 豆兵
    for (const b of g.beans) {
      if (!b.alive && b.deadT > 0.5) continue;
      const bx = sx(b.x), by = sy(b.y), R = Math.max(5, PHYS.radius * z);
      const team = g.teams[b.team];
      if (!b.alive) c.globalAlpha = 0.35;
      // 身体：圆圆的豆子，头顶一小撮
      c.fillStyle = team.def.color;
      c.beginPath(); c.arc(bx, by, R, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.beginPath(); c.arc(bx - R * 0.3, by - R * 0.35, R * 0.45, 0, 6.283); c.fill();
      c.strokeStyle = team.def.dark; c.lineWidth = Math.max(1, 1.5 * z);
      c.beginPath(); c.arc(bx, by, R, 0, 6.283); c.stroke();
      // 眼睛，朝向脸的方向
      c.fillStyle = '#222';
      c.beginPath(); c.arc(bx + b.face * R * 0.35 - R * 0.28, by - R * 0.15, Math.max(1, R * 0.16), 0, 6.283); c.fill();
      c.beginPath(); c.arc(bx + b.face * R * 0.35 + R * 0.28, by - R * 0.15, Math.max(1, R * 0.16), 0, 6.283); c.fill();
      // 当前行动的豆兵：金色光圈 + 小箭头
      if (g.turn.bean === b && (g.turn.state === 'aim' || g.turn.state === 'retreat')) {
        c.strokeStyle = '#ffe066'; c.lineWidth = 2.5;
        c.beginPath(); c.arc(bx, by, R + 4 + Math.sin(this.waterT * 5) * 1.5, 0, 6.283); c.stroke();
        c.fillStyle = '#ffe066';
        c.beginPath(); c.moveTo(bx, by - R - 14); c.lineTo(bx - 5, by - R - 22); c.lineTo(bx + 5, by - R - 22); c.closePath(); c.fill();
      }
      // 名字和血条（屏幕空间，固定大小）
      c.globalAlpha = 1;
      c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillText(b.name, bx + 1, by - R - 26 + 1);
      c.fillStyle = '#fff'; c.fillText(b.name, bx, by - R - 26);
      const bw = 30, hp = Math.max(0, b.hp) / 100;
      c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(bx - bw / 2, by - R - 23, bw, 4);
      c.fillStyle = hp > 0.5 ? '#7ed957' : hp > 0.25 ? '#ffb347' : '#ff5a5a';
      c.fillRect(bx - bw / 2, by - R - 23, bw * hp, 4);
    }
    // 粒子
    for (const p of this.particles) {
      c.globalAlpha = clamp(p.life / p.max, 0, 1);
      c.fillStyle = p.color;
      c.beginPath(); c.arc(sx(p.x), sy(p.y), Math.max(1.5, p.size * z), 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
    // 伤害飘字
    c.font = '900 14px system-ui, sans-serif'; c.textAlign = 'center';
    for (const f of this.floats) {
      c.globalAlpha = clamp(f.life / 0.9, 0, 1);
      c.fillStyle = f.color; c.fillText(f.text, sx(f.x), sy(f.y));
    }
    c.globalAlpha = 1;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.canvas.remove();
  }
}
