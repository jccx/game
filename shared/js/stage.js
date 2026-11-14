// 3D 画面的舞台：创建渲染器、跟随屏幕尺寸和横竖屏变化、按帧率自动调整分辨率。
// 手机优先：默认限制像素比，帧率不够时先降分辨率，再降画质档位。
import * as THREE from './three.js';
import { store, query } from './ui.js';
import { clamp } from './util.js';

/** 画质档位。maxDpr 是像素比上限，shadows 是否开启实时阴影 */
export const QUALITY = [
  { name: '流畅', maxDpr: 1,    shadows: false },
  { name: '均衡', maxDpr: 1.5,  shadows: false },
  { name: '高清', maxDpr: 2,    shadows: true },
];

export class Stage {
  /**
   * @param {HTMLElement} container 放画布的元素（一般铺满全屏）
   * @param {object} [o]
   * @param {string} [o.key='q'] 画质设置在本机存储里的名字
   */
  constructor(container, o = {}) {
    this.container = container;
    this.key = o.key || 'quality';
    const dpr = window.devicePixelRatio || 1;
    // 高像素比的手机屏上锯齿不明显，不开抗锯齿可以省不少性能
    this.renderer = new THREE.WebGLRenderer({
      antialias: dpr < 2,
      powerPreference: 'high-performance',
      alpha: false, stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'g-canvas';
    container.appendChild(this.canvas);

    this.width = 1; this.height = 1; this.aspect = 1; this.portrait = false;
    this._resizeFns = [];
    this._qualityFns = [];

    // 画质：地址栏 ?q=0/1/2 可强制指定（测试用），否则读本机设置；默认按设备估计
    const forced = query('q');
    const saved = store.get(this.key, null);
    this.auto = forced === null && (saved === null || saved.auto !== false);
    const guess = this._guessLevel();
    this.level = forced !== null ? clamp(+forced, 0, 2) : saved ? clamp(saved.level ?? guess, 0, 2) : guess;
    this.dynScale = 1;       // 动态分辨率系数，自动模式下在 0.55~1 之间浮动
    this._ms = 16;           // 帧耗时的滑动平均
    this._slow = 0; this._fast = 0;
    this.fps = 60;

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
    window.visualViewport?.addEventListener('resize', onResize);
    this.resize();
  }

  /** 按设备粗略估计初始档位：手机默认“均衡”，电脑默认“高清” */
  _guessLevel() {
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
    const cores = navigator.hardwareConcurrency || 4;
    if (!mobile) return 2;
    return cores >= 6 ? 1 : 0;
  }

  /** 注册尺寸变化回调，注册时立即调用一次 */
  onResize(fn) { this._resizeFns.push(fn); fn(this); }

  /** 注册画质变化回调（比如开关阴影），注册时立即调用一次 */
  onQuality(fn) { this._qualityFns.push(fn); fn(QUALITY[this.level], this); }

  /** 当前档位的配置 */
  get quality() { return QUALITY[this.level]; }

  /** 设置画质档位；auto 为 true 时允许按帧率自动调整 */
  setQuality(level, auto = this.auto) {
    this.level = clamp(level, 0, 2);
    this.auto = auto;
    this.dynScale = 1;
    store.set(this.key, { level: this.level, auto });
    this._applyPixelRatio();
    for (const fn of this._qualityFns) fn(QUALITY[this.level], this);
  }

  _applyPixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.level].maxDpr) * this.dynScale;
    this.pixelRatio = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.shadowMap.enabled = QUALITY[this.level].shadows;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.width = w; this.height = h; this.aspect = w / h; this.portrait = h > w;
    this._applyPixelRatio();
    for (const fn of this._resizeFns) fn(this);
  }

  /**
   * 渲染一帧，并统计帧耗时。自动模式下：
   * 连续偏慢就降低分辨率，分辨率降到底还慢就降一档画质；连续很快则慢慢把分辨率加回来。
   * @param {number} frameDt 这一帧距上一帧的秒数
   */
  render(scene, camera, frameDt) {
    this.renderer.render(scene, camera);
    if (!frameDt) return;
    const ms = frameDt * 1000;
    this._ms += (ms - this._ms) * 0.05;
    this.fps = 1000 / this._ms;
    if (!this.auto) return;
    if (this._ms > 24) { this._slow += frameDt; this._fast = 0; }
    else if (this._ms < 17.5) { this._fast += frameDt; this._slow = 0; }
    else { this._slow = 0; this._fast = 0; }
    if (this._slow > 1.5) {
      this._slow = 0;
      if (this.dynScale > 0.56) { this.dynScale = Math.max(0.55, this.dynScale - 0.15); this._applyPixelRatio(); }
      else if (this.level > 0) { this.setQuality(this.level - 1, true); }
    } else if (this._fast > 6 && this.dynScale < 1) {
      this._fast = 0;
      this.dynScale = Math.min(1, this.dynScale + 0.1);
      this._applyPixelRatio();
    }
  }

  /** 渲染统计：绘制调用次数和三角形数（调试、性能测试用） */
  get stats() {
    const i = this.renderer.info.render;
    return { calls: i.calls, tris: i.triangles, fps: Math.round(this.fps), pr: +this.pixelRatio.toFixed(2), level: this.level };
  }
}
