// 游戏主循环：逻辑按固定步长更新，画面按屏幕刷新率渲染。
// 固定步长让游戏在 30 帧和 120 帧的设备上表现一致，也便于测试时快进。

export class GameLoop {
  /**
   * @param {object} o
   * @param {(dt:number)=>void} o.update  逻辑更新，dt 恒等于 step
   * @param {(alpha:number, frameDt:number)=>void} o.render  渲染；alpha 是两次逻辑更新之间的插值比例
   * @param {number} [o.step=1/30]  逻辑步长（秒）
   * @param {number} [o.maxSteps=4] 一帧内最多补几步逻辑，避免卡顿后越补越卡
   */
  constructor({ update, render, step = 1 / 30, maxSteps = 4 }) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.maxSteps = maxSteps;
    this.timeScale = 1;   // 时间倍率：0 暂停，1 正常
    this.running = false;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    // 切到后台再回来时 dt 会很大，这里截断
    const frameDt = Math.min((now - this._last) / 1000, 0.25);
    this._last = now;
    this._acc += frameDt * this.timeScale;
    let n = 0;
    while (this._acc >= this.step && n < this.maxSteps) {
      this.update(this.step);
      this._acc -= this.step;
      n++;
    }
    if (n === this.maxSteps) this._acc = 0; // 追不上就丢弃欠账
    this.render(this._acc / this.step, frameDt);
  }

  /** 测试用：不渲染，直接把逻辑快进若干秒 */
  fastForward(seconds) {
    const n = Math.round(seconds / this.step);
    for (let i = 0; i < n; i++) this.update(this.step);
  }
}
