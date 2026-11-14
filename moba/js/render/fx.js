// 裂谷争锋：特效——投射物、地面指示圈、冲击波、粒子、飘字、技能瞄准指示器。
// 所有特效网格都从对象池里取、用完放回，对局中不反复创建销毁，避免手机上的卡顿。
import * as THREE from '../../../shared/js/three.js';
import { Particles } from '../../../shared/js/particles.js';
import { makeCanvas, canvasTexture } from '../../../shared/js/geo.js';
import { el } from '../../../shared/js/ui.js';
import { TEAM_COLOR } from './scene.js';

const flat = (g) => { g.rotateX(-Math.PI / 2); return g; };

/** 投射物外观表：geo 形状、size 缩放 [x,y,z]、trail 拖尾粒子、spin 是否旋转、teamColor 是否用队伍颜色 */
const PROJ = {
  shot:     { geo: 'sphere', size: [0.24, 0.24, 0.24], teamColor: true },
  shell:    { geo: 'sphere', size: [0.42, 0.42, 0.42], color: 0xffa040, trail: 0xff8030 },
  tower:    { geo: 'sphere', size: [0.34, 0.34, 0.8], teamColor: true, trail: true },
  arrow:    { geo: 'box', size: [0.1, 0.1, 1.5], color: 0xfff2c0 },
  orb:      { geo: 'sphere', size: [0.3, 0.3, 0.3], color: 0x8fd0ff, trail: 0x8fd0ff },
  star:     { geo: 'sphere', size: [0.55, 0.55, 0.55], color: 0xbfe6ff, trail: 0x8fd0ff, big: true },
  blade:    { geo: 'box', size: [0.9, 0.06, 0.32], color: 0x9be8ff, spin: true, trail: 0x9b7bff },
  bigarrow: { geo: 'box', size: [0.3, 0.3, 3.4], color: 0xfff0a0, trail: 0xffe08a, big: true },
};

export class Fx {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} layer 飘字所在的 DOM 层
   * @param {(x:number,y:number,z:number)=>{x:number,y:number,visible:boolean}} project 世界坐标转屏幕坐标
   */
  constructor(scene, layer, project) {
    this.scene = scene; this.project = project;
    this.glow = new Particles(scene, { max: 700, additive: true });
    this.smoke = new Particles(scene, { max: 240, additive: false });
    this.active = [];                 // 进行中的特效：{ m, t, dur, fn }
    this.pools = {};                  // 名字 → 空闲网格
    this.projViews = new Map();       // 投射物 → 网格
    this.shake = 0;                   // 镜头震动强度，由 View 读取并衰减
    this.geo = {
      ring: flat(new THREE.RingGeometry(0.9, 1, 48)),
      thin: flat(new THREE.RingGeometry(0.965, 1, 64)),
      disc: flat(new THREE.CircleGeometry(1, 40)),
      arc: flat(new THREE.RingGeometry(0.55, 1, 20, 1, 0, 2.2)),
      sphere: new THREE.SphereGeometry(1, 10, 8),
      box: new THREE.BoxGeometry(1, 1, 1),
      // 贴在地上的长条：原点在一端，沿 +z 伸出 1 个单位
      strip: (() => { const g = flat(new THREE.PlaneGeometry(1, 1)); g.translate(0, 0, 0.5); return g; })(),
    };

    // 飘字：固定数量的 DOM 元素循环使用
    this.texts = []; this.textI = 0;
    for (let i = 0; i < 26; i++) this.texts.push(el('div', { cls: 'ft' }, layer));

    // 技能瞄准指示器
    const [ac, ax] = makeCanvas(64, 128);
    const g = ax.createLinearGradient(0, 128, 0, 0);
    // 贴图上方对应长条的近端（英雄脚下），下方对应远端：近处淡、远处亮，末端画一个箭头
    g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.75, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    ax.fillStyle = g; ax.fillRect(6, 0, 52, 128);
    ax.strokeStyle = '#fff'; ax.lineWidth = 5; ax.strokeRect(6, 2, 52, 124);
    ax.lineWidth = 6; ax.lineJoin = 'round'; ax.beginPath(); ax.moveTo(14, 96); ax.lineTo(32, 118); ax.lineTo(50, 96); ax.stroke();
    this.aimTex = canvasTexture(ac);
    const im = () => new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false });
    this.aimRange = new THREE.Mesh(this.geo.thin, im());
    this.aimDir = new THREE.Mesh(this.geo.strip, new THREE.MeshBasicMaterial({ map: this.aimTex, color: 0x5ab8ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }));
    this.aimSpot = new THREE.Mesh(this.geo.disc, im());
    this.aimSpotRing = new THREE.Mesh(this.geo.thin, im());
    for (const m of [this.aimRange, this.aimDir, this.aimSpot, this.aimSpotRing]) { m.visible = false; m.renderOrder = 6; m.position.y = 0.08; scene.add(m); }
    this.aimSpot.material.opacity = 0.3;
  }

  setViewport(h, fov, pr) { this.glow.setViewport(h, fov, pr); this.smoke.setViewport(h, fov, pr); }

  /* ---------------------------------------------------------- 对象池 */

  /** 从池里取一个网格（没有就新建）。每个网格有自己的材质，便于各自调整透明度和颜色 */
  take(name, geoName, additive = true) {
    const pool = this.pools[name] || (this.pools[name] = []);
    let m = pool.pop();
    if (!m) {
      m = new THREE.Mesh(this.geo[geoName], new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      m.userData.pool = name; m.renderOrder = 5;
      this.scene.add(m);
    }
    m.visible = true; m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    return m;
  }
  release(m) { m.visible = false; this.pools[m.userData.pool].push(m); }

  /** 加入一个限时特效。fn(k, m, dt)：k 从 0 到 1 */
  run(m, dur, fn) { this.active.push({ m, t: 0, dur, fn }); fn(0, m, 0); return m; }

  /* ---------------------------------------------------------- 各种特效 */

  /** 扩散的冲击波圆环 */
  ring(x, z, r, color, dur = 0.45) {
    const m = this.take('ring', 'ring'); m.material.color.set(color); m.position.set(x, 0.1, z);
    this.run(m, dur, (k) => { const s = r * (0.25 + 0.75 * (1 - (1 - k) * (1 - k))); m.scale.set(s, 1, s); m.material.opacity = 0.9 * (1 - k); });
  }

  /** 地面预警圈：外圈固定，内圈逐渐填满，填满时技能生效 */
  warn(x, z, r, dur, color, thin) {
    const a = this.take('thin', 'thin'); a.material.color.set(color); a.position.set(x, 0.07, z); a.scale.set(r, 1, r);
    this.run(a, dur, (k) => { a.material.opacity = 0.9 - 0.3 * k; });
    const b = this.take('disc', 'disc'); b.material.color.set(color); b.position.set(x, 0.06, z);
    this.run(b, dur, (k) => { const s = thin ? r : r * Math.max(0.05, k); b.scale.set(s, 1, s); b.material.opacity = thin ? 0.12 : 0.28; });
  }

  /** 一团发光粒子 */
  burst(x, z, color, n = 12, y = 1.2) {
    this.glow.emit(x, y, z, { n, speed: [3, 8], life: [0.25, 0.55], size: [0.35, 0.8], color, color2: 0xffffff, gravity: -6, drag: 2 });
  }

  /** 一团尘土 */
  dust(x, z, n = 8) {
    this.smoke.emit(x, 0.3, z, { n, speed: [1, 3.5], dir: [0, 1, 0], spread: 0.85, life: [0.4, 0.8], size: [0.9, 1.6], grow: 2.2, color: 0xcbb994, alpha: 0.5, drag: 2.5, r: 0.5 });
  }

  /** 落地重击：冲击波 + 尘土 + 碎石 + 镜头震动 */
  quake(x, z, r, color) {
    this.ring(x, z, r, color, 0.5); this.ring(x, z, r * 0.6, 0xffffff, 0.3);
    const d = this.take('disc', 'disc'); d.material.color.set(color); d.position.set(x, 0.07, z); d.scale.set(r, 1, r);
    this.run(d, 0.35, (k) => { d.material.opacity = 0.45 * (1 - k); });
    this.dust(x, z, 16);
    this.glow.emit(x, 0.4, z, { n: 22, speed: [4, 11], dir: [0, 1, 0], spread: 0.7, life: [0.35, 0.7], size: [0.4, 0.9], color, color2: 0xffffff, gravity: -22 });
    this.shake = Math.max(this.shake, 0.55);
  }

  /** 冰霜爆发 */
  frost(x, z, r, color) {
    this.ring(x, z, r, color, 0.5);
    const d = this.take('disc', 'disc'); d.material.color.set(color); d.position.set(x, 0.07, z); d.scale.set(r, 1, r);
    this.run(d, 0.6, (k) => { d.material.opacity = 0.5 * (1 - k); });
    this.glow.emit(x, 0.5, z, { n: 30, speed: [1, 6], dir: [0, 1, 0], spread: 0.9, life: [0.4, 0.9], size: [0.3, 0.8], color, color2: 0xffffff, gravity: -3, drag: 1.5, r: r * 0.6 });
  }

  /** 绕着单位的一圈刀光 */
  spin(u, r, color) {
    for (let i = 0; i < 2; i++) {
      const m = this.take('arc', 'arc'); m.material.color.set(i ? 0xffffff : color);
      this.run(m, 0.3, (k) => { m.position.set(u.x, 1.0 + i * 0.2, u.z); const s = r * (0.7 + 0.3 * k); m.scale.set(s, 1, s); m.rotation.y = -k * 7.5 + i * 3.14; m.material.opacity = 0.85 * (1 - k * k); });
    }
    this.glow.emit(u.x, 1, u.z, { n: 14, speed: [5, 9], dir: [0, 0.1, 0], spread: 1, life: [0.2, 0.4], size: [0.3, 0.6], color, drag: 3 });
  }

  /** 护盾罩：跟着单位，护盾被打掉时提前消失 */
  shield(u, dur, color) {
    const m = this.take('bubble', 'sphere'); m.material.color.set(color);
    this.run(m, dur, (k) => {
      m.position.set(u.x, 1.5, u.z); m.scale.setScalar(1.9 + Math.sin(k * 40) * 0.05);
      m.material.opacity = u.shield > 0 && u.alive ? 0.22 : 0;
    });
  }

  /** 闪现/瞬步的残影光带 */
  blink(x, z, x2, z2, color) {
    const m = this.take('strip', 'strip'); m.material.color.set(color);
    const d = Math.hypot(x2 - x, z2 - z);
    m.position.set(x, 0.12, z); m.rotation.y = Math.atan2(x2 - x, z2 - z);
    this.run(m, 0.32, (k) => { m.scale.set(1.3 * (1 - k * 0.6), 1, d); m.material.opacity = 0.7 * (1 - k); });
    this.burst(x, z, color, 10); this.burst(x2, z2, color, 10);
  }

  /** 从天而降的陨星 */
  meteor(x, z, r, dur, color) {
    const m = this.take('ball', 'sphere'); m.material.color.set(color);
    this.run(m, dur, (k) => {
      const y = 16 * (1 - k), px = x + 5 * (1 - k), pz = z - 4 * (1 - k);
      m.position.set(px, y + 0.6, pz); m.scale.setScalar(0.9); m.material.opacity = 1;
      this.glow.emit(px, y + 0.6, pz, { n: 2, speed: [0.5, 2], life: [0.25, 0.5], size: [0.7, 1.2], color, color2: 0xffffff });
      if (k >= 1) { this.ring(x, z, r, color, 0.4); this.burst(x, z, color, 16, 0.6); this.dust(x, z, 6); this.shake = Math.max(this.shake, 0.3); }
    });
  }

  /** 升级光效 */
  levelUp(u) {
    this.ring(u.x, u.z, 2.6, 0xffe08a, 0.6);
    this.glow.emit(u.x, 0.3, u.z, { n: 20, speed: [3, 7], dir: [0, 1, 0], spread: 0.25, life: [0.5, 0.9], size: [0.3, 0.6], color: 0xffe08a, color2: 0xffffff, r: 1 });
  }

  /** 建筑被摧毁 */
  explode(x, z, color, big) {
    this.quake(x, z, big ? 9 : 5, color);
    this.smoke.emit(x, 2, z, { n: big ? 30 : 16, speed: [2, 6], dir: [0, 1, 0], spread: 0.7, life: [0.8, 1.6], size: [1.5, 3], grow: 2.5, color: 0x6a6a72, alpha: 0.55, drag: 1.2, r: 1.5 });
    this.glow.emit(x, 3, z, { n: big ? 50 : 26, speed: [4, 14], life: [0.4, 1], size: [0.5, 1.3], color, color2: 0xffffff, gravity: -14 });
    this.shake = Math.max(this.shake, big ? 1.2 : 0.7);
  }

  /** 按事件里的名字播放特效（game.fx(name, {...}) 发出的事件） */
  play(ev) {
    switch (ev.name) {
      case 'ring': this.ring(ev.x, ev.z, ev.r, ev.color); break;
      case 'warn': this.warn(ev.x, ev.z, ev.r, ev.dur, ev.color, ev.thin); break;
      case 'burst': this.burst(ev.x, ev.z, ev.color, ev.n); break;
      case 'dust': this.dust(ev.x, ev.z); break;
      case 'quake': this.quake(ev.x, ev.z, ev.r, ev.color); break;
      case 'frost': this.frost(ev.x, ev.z, ev.r, ev.color); break;
      case 'spin': this.spin(ev.u, ev.r, ev.color); break;
      case 'shield': this.shield(ev.u, ev.dur, ev.color); break;
      case 'blink': this.blink(ev.x, ev.z, ev.x2, ev.z2, ev.color); break;
      case 'meteor': this.meteor(ev.x, ev.z, ev.r, ev.dur, ev.color); break;
    }
  }

  /* ---------------------------------------------------------- 飘字 */

  /** 在世界坐标处冒出一行字。cls 决定颜色和大小（见 moba.css 的 .ft-xxx） */
  text(x, y, z, str, cls) {
    const p = this.project(x, y, z);
    if (!p.visible) return;
    const e = this.texts[this.textI]; this.textI = (this.textI + 1) % this.texts.length;
    e.textContent = str;
    e.className = 'ft';
    void e.offsetWidth;                       // 强制重排，让同一个元素的动画重新开始
    e.style.left = (p.x + (Math.random() - 0.5) * 26) + 'px'; e.style.top = p.y + 'px';
    e.className = 'ft go ft-' + cls;
  }

  /* ---------------------------------------------------------- 投射物 */

  /** 每帧：让每个飞行中的投射物都有对应的网格，并更新位置；已消失的回收 */
  syncProjs(projs, alpha, dt) {
    const views = this.projViews;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      let m = views.get(p);
      const spec = PROJ[p.kind] || PROJ.shot;
      if (!m) {
        m = this.take('p_' + p.kind, spec.geo, true);
        m.material.color.set(p.color ?? (spec.teamColor ? TEAM_COLOR[p.team] : spec.color));
        m.material.opacity = 1;
        m.scale.set(spec.size[0], spec.size[1], spec.size[2]);
        m.userData.d0 = p.homing ? Math.max(0.5, Math.hypot(p.tx - p.x, p.tz - p.z)) : 0;
        m.userData.y0 = p.y;
        views.set(p, m);
      }
      const x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha;
      let y = p.y;
      if (p.homing) {            // 追踪弹：从发射高度逐渐降到目标胸口
        const k = Math.min(1, Math.hypot(p.tx - x, p.tz - z) / m.userData.d0);
        y = 1.3 + (m.userData.y0 - 1.3) * k + (p.kind === 'shell' ? Math.sin(k * 3.14) * 2.2 : 0);
        m.rotation.y = Math.atan2(p.tx - x, p.tz - z);
      } else m.rotation.y = spec.spin ? m.rotation.y + dt * 22 : Math.atan2(p.dx, p.dz);
      m.position.set(x, y, z);
      if (spec.trail && Math.random() < dt * 40) {
        this.glow.emit(x, y, z, { n: 1, speed: [0, 0.8], life: [0.18, 0.35], size: spec.big ? [0.5, 0.9] : [0.25, 0.5], color: spec.trail === true ? m.material.color.getHex() : spec.trail });
      }
    }
    for (const [p, m] of views) {
      if (p.alive) continue;
      views.delete(p); this.release(m);
      // 命中时溅出一点火花
      if (p.hitU) this.glow.emit(p.x, 1.2, p.z, { n: PROJ[p.kind]?.big ? 12 : 4, speed: [2, 6], life: [0.15, 0.35], size: [0.25, 0.55], color: m.material.color.getHex(), color2: 0xffffff });
    }
  }

  /* ---------------------------------------------------------- 瞄准指示器 */

  /**
   * 显示技能瞄准指示。a 为 null 时隐藏。
   * a: { x, z（英雄位置）, type: 'dir'|'point'|'self', range, width, radius, dx, dz（方向）, tx, tz（落点）, cancel }
   */
  setAim(a) {
    const show = !!a;
    this.aimRange.visible = show;
    this.aimDir.visible = show && a.type === 'dir';
    this.aimSpot.visible = this.aimSpotRing.visible = show && a.type !== 'dir';
    if (!show) return;
    const col = a.cancel ? 0xff5a4a : 0x3fb0ff;
    for (const m of [this.aimRange, this.aimDir, this.aimSpot, this.aimSpotRing]) m.material.color.set(col);
    const rr = a.type === 'self' ? a.radius : Math.min(a.range, 16);
    this.aimRange.position.set(a.x, 0.08, a.z); this.aimRange.scale.set(rr, 1, rr);
    if (a.type === 'dir') {
      this.aimDir.position.set(a.x, 0.09, a.z);
      this.aimDir.rotation.y = Math.atan2(a.dx, a.dz);
      this.aimDir.scale.set(a.width, 1, Math.min(a.range, 22));
    } else {
      const x = a.type === 'self' ? a.x : a.tx, z = a.type === 'self' ? a.z : a.tz;
      this.aimSpot.position.set(x, 0.09, z); this.aimSpot.scale.set(a.radius, 1, a.radius);
      this.aimSpotRing.position.set(x, 0.1, z); this.aimSpotRing.scale.set(a.radius, 1, a.radius);
    }
  }

  /* ---------------------------------------------------------- 每帧更新 */
  update(dt) {
    const act = this.active;
    for (let i = act.length - 1; i >= 0; i--) {
      const a = act[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k, a.m, dt);
      if (k >= 1) { this.release(a.m); act[i] = act[act.length - 1]; act.pop(); }
    }
    this.glow.update(dt); this.smoke.update(dt);
  }
}
