// 粒子系统：所有粒子合在一个 Points 里，一次绘制调用画完。
// 位置在 CPU 上更新（几百到一两千个粒子，开销很小），着色器只负责把每个点画成柔边圆。
import * as THREE from './three.js';

const VERT = `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

const _c1 = new THREE.Color(), _c2 = new THREE.Color();

export class Particles {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [o]
   * @param {number} [o.max=600] 同时存在的粒子上限（超出时覆盖最老的）
   * @param {boolean} [o.additive=true] 叠加发光（火花、魔法）；false 为普通混合（烟、尘）
   */
  constructor(scene, o = {}) {
    const n = this.max = o.max || 600;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);     // 剩余寿命
    this.life0 = new Float32Array(n);    // 总寿命
    this.size0 = new Float32Array(n);    // 初始大小
    this.grow = new Float32Array(n);     // 寿命结束时大小是初始的几倍
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.cursor = 0;
    this.alive = 0;
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false,
      blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /** 屏幕尺寸或镜头视角变化时调用，使粒子大小按世界单位计算 */
  setViewport(heightPx, fovDeg, pixelRatio = 1) {
    this.mat.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * 发射粒子。
   * @param {number} x,y,z 发射点
   * @param {object} o
   * @param {number} [o.n=8] 数量
   * @param {number[]} [o.speed=[1,3]] 速度范围
   * @param {number[]} [o.dir] 主方向 [x,y,z]；不给则四面八方
   * @param {number} [o.spread=1] 0 完全沿主方向，1 完全随机
   * @param {number[]} [o.life=[0.3,0.6]] 寿命范围（秒）
   * @param {number[]} [o.size=[0.3,0.6]] 大小范围（世界单位）
   * @param {number} [o.grow=0] 结束时大小倍率
   * @param {number} [o.color=0xffffff] 颜色；[o.color2] 给了则在两色间随机
   * @param {number} [o.gravity=0] 重力（负数向下）
   * @param {number} [o.drag=0] 阻力
   * @param {number} [o.alpha=1]
   * @param {number} [o.r=0] 发射点的随机半径
   */
  emit(x, y, z, o = {}) {
    const n = o.n ?? 8;
    const sp = o.speed || [1, 3], lf = o.life || [0.3, 0.6], sz = o.size || [0.3, 0.6];
    const spread = o.spread ?? 1, dir = o.dir, r = o.r || 0;
    _c1.set(o.color ?? 0xffffff);
    if (o.color2 !== undefined) _c2.set(o.color2);
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      // 随机方向（球面均匀）
      const u = Math.random() * 2 - 1, th = Math.random() * 6.2832, s = Math.sqrt(1 - u * u);
      let dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
      if (dir) {
        dx = dir[0] + (dx - dir[0]) * spread; dy = dir[1] + (dy - dir[1]) * spread; dz = dir[2] + (dz - dir[2]) * spread;
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      }
      const v = sp[0] + Math.random() * (sp[1] - sp[0]);
      const i3 = i * 3, i4 = i * 4;
      this.pos[i3] = x + (r ? (Math.random() * 2 - 1) * r : 0);
      this.pos[i3 + 1] = y + (r ? (Math.random() * 2 - 1) * r * 0.5 : 0);
      this.pos[i3 + 2] = z + (r ? (Math.random() * 2 - 1) * r : 0);
      this.vel[i3] = dx * v; this.vel[i3 + 1] = dy * v; this.vel[i3 + 2] = dz * v;
      let cr = _c1.r, cg = _c1.g, cb = _c1.b;
      if (o.color2 !== undefined) { const t = Math.random(); cr += (_c2.r - cr) * t; cg += (_c2.g - cg) * t; cb += (_c2.b - cb) * t; }
      this.col[i4] = cr; this.col[i4 + 1] = cg; this.col[i4 + 2] = cb; this.col[i4 + 3] = o.alpha ?? 1;
      this.alpha0[i] = o.alpha ?? 1;
      this.life[i] = this.life0[i] = lf[0] + Math.random() * (lf[1] - lf[0]);
      this.size[i] = this.size0[i] = sz[0] + Math.random() * (sz[1] - sz[0]);
      this.grow[i] = o.grow ?? 0;
      this.grav[i] = o.gravity || 0;
      this.drag[i] = o.drag || 0;
    }
  }

  /** 每帧更新 */
  update(dt) {
    const { pos, vel, col, size, life, life0, size0, grow, grav, drag, alpha0, max } = this;
    let alive = 0;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      const l = life[i] - dt;
      const i3 = i * 3;
      if (l <= 0) { life[i] = 0; size[i] = 0; col[i * 4 + 3] = 0; continue; }
      life[i] = l; alive++;
      const d = drag[i] ? Math.max(0, 1 - drag[i] * dt) : 1;
      vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d + grav[i] * dt; vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = 1 - l / life0[i];                 // 0 → 1
      size[i] = size0[i] * (1 + (grow[i] - 1) * t);
      col[i * 4 + 3] = alpha0[i] * (1 - t * t);   // 越到后面越透明
    }
    // 没有活粒子且上一帧也没有时，不必上传缓冲
    if (alive || this.alive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
  }
}
