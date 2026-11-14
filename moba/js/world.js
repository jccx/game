// 裂谷争锋：地形碰撞与寻路。纯逻辑，不依赖渲染。
// 障碍有两种：墙（胶囊形：一条线段加半径）和建筑（圆形，塔和水晶，被摧毁后移除）。
// 寻路用 2 单位一格的网格跑 A*，再用“能直线走就抄近路”把路径拉直。
import { clamp, segParam } from '../../shared/js/util.js';

const AGENT = 0.9;   // 寻路时给墙留的余量（约等于英雄半径）

export class World {
  constructor(map) {
    this.map = map;
    this.w = map.size[0]; this.h = map.size[1];
    this.margin = 3;                        // 地图边缘留白
    this.walls = map.walls.map((w) => ({ x1: w[0], z1: w[1], x2: w[2], z2: w[3], r: w[4] }));
    this.circles = [];                      // 建筑：{x, z, r}

    // 粗格（8 单位一格）记录每格附近有哪些墙，碰撞时只需检查附近几道
    this.bs = 8;
    this.bw = Math.ceil(this.w / this.bs); this.bh = Math.ceil(this.h / this.bs);
    this.buckets = Array.from({ length: this.bw * this.bh }, () => []);
    this.walls.forEach((w, idx) => {
      const pad = w.r + 2.5;
      const x0 = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - pad) / this.bs)), x1 = Math.min(this.bw - 1, Math.floor((Math.max(w.x1, w.x2) + pad) / this.bs));
      const z0 = Math.max(0, Math.floor((Math.min(w.z1, w.z2) - pad) / this.bs)), z1 = Math.min(this.bh - 1, Math.floor((Math.max(w.z1, w.z2) + pad) / this.bs));
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) this.buckets[j * this.bw + i].push(idx);
    });

    // 寻路网格
    this.cs = 2;
    this.gw = Math.ceil(this.w / this.cs); this.gh = Math.ceil(this.h / this.cs);
    const n = this.gw * this.gh;
    this.blocked = new Uint8Array(n);
    this._g = new Float32Array(n);
    this._parent = new Int32Array(n);
    this._stamp = new Uint32Array(n);     // 本次搜索是否访问过
    this._closed = new Uint32Array(n);
    this._gen = 0;
    this._heap = [];
    this.bake();
  }

  /** 加入一个圆形建筑并更新寻路网格 */
  addCircle(c) { this.circles.push(c); this.bake(); }
  /** 移除建筑（被摧毁） */
  removeCircle(c) { const i = this.circles.indexOf(c); if (i >= 0) { this.circles.splice(i, 1); this.bake(); } }

  /** 某点是否在墙或建筑里（含余量 pad） */
  solidAt(x, z, pad = 0) {
    if (x < this.margin || z < this.margin || x > this.w - this.margin || z > this.h - this.margin) return true;
    const b = this.buckets[clamp(Math.floor(z / this.bs), 0, this.bh - 1) * this.bw + clamp(Math.floor(x / this.bs), 0, this.bw - 1)];
    for (let k = 0; k < b.length; k++) {
      const w = this.walls[b[k]];
      const t = segParam(x, z, w.x1, w.z1, w.x2, w.z2);
      const dx = x - (w.x1 + (w.x2 - w.x1) * t), dz = z - (w.z1 + (w.z2 - w.z1) * t);
      const m = w.r + pad;
      if (dx * dx + dz * dz < m * m) return true;
    }
    for (let k = 0; k < this.circles.length; k++) {
      const c = this.circles[k], m = c.r + pad;
      if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < m * m) return true;
    }
    return false;
  }

  /** 重新生成寻路网格的可走/不可走标记 */
  bake() {
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
      this.blocked[j * this.gw + i] = this.solidAt((i + 0.5) * this.cs, (j + 0.5) * this.cs, AGENT) ? 1 : 0;
    }
  }

  /** 把单位从墙和建筑里推出来，并限制在地图范围内。直接修改 u.x、u.z */
  resolve(u) {
    let x = clamp(u.x, this.margin, this.w - this.margin), z = clamp(u.z, this.margin, this.h - this.margin);
    const r = u.radius;
    const b = this.buckets[clamp(Math.floor(z / this.bs), 0, this.bh - 1) * this.bw + clamp(Math.floor(x / this.bs), 0, this.bw - 1)];
    for (let k = 0; k < b.length; k++) {
      const w = this.walls[b[k]];
      const t = segParam(x, z, w.x1, w.z1, w.x2, w.z2);
      const cx = w.x1 + (w.x2 - w.x1) * t, cz = w.z1 + (w.z2 - w.z1) * t;
      let dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz, m = w.r + r * 0.6;
      if (d2 < m * m) {
        let d = Math.sqrt(d2);
        if (d < 1e-4) { dx = -(w.z2 - w.z1); dz = w.x2 - w.x1; d = Math.hypot(dx, dz) || 1; }
        x = cx + (dx / d) * m; z = cz + (dz / d) * m;
      }
    }
    for (let k = 0; k < this.circles.length; k++) {
      const c = this.circles[k];
      let dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz, m = c.r + r * 0.8;
      if (d2 < m * m) {
        let d = Math.sqrt(d2);
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        x = c.x + (dx / d) * m; z = c.z + (dz / d) * m;
      }
    }
    u.x = x; u.z = z;
  }

  _cell(x, z) {
    return clamp(Math.floor(z / this.cs), 0, this.gh - 1) * this.gw + clamp(Math.floor(x / this.cs), 0, this.gw - 1);
  }

  /** 两点之间是否能直线走过去（按网格抽样检查） */
  los(x1, z1, x2, z2) {
    const d = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.ceil(d / (this.cs * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.blocked[this._cell(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)]) return false;
    }
    return true;
  }

  /** 离给定格子最近的可走格子 */
  _nearestFree(c) {
    if (!this.blocked[c]) return c;
    const ci = c % this.gw, cj = (c / this.gw) | 0;
    for (let r = 1; r < 10; r++) {
      let best = -1, bd = 1e9;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const k = j * this.gw + i;
        if (!this.blocked[k]) { const d = (i - ci) * (i - ci) + (j - cj) * (j - cj); if (d < bd) { bd = d; best = k; } }
      }
      if (best >= 0) return best;
    }
    return c;
  }

  /**
   * 寻路。返回路径点数组 [[x,z], ...]（不含起点，最后一个是终点）；找不到路时返回直线。
   */
  findPath(sx, sz, tx, tz) {
    if (this.los(sx, sz, tx, tz)) return [[tx, tz]];
    const gw = this.gw, gh = this.gh, blocked = this.blocked;
    const s = this._nearestFree(this._cell(sx, sz));
    const tRaw = this._cell(tx, tz);
    const t = this._nearestFree(tRaw);
    if (s === t) return [[tx, tz]];
    const gen = ++this._gen;
    const g = this._g, parent = this._parent, stamp = this._stamp, closed = this._closed;
    const heap = this._heap; heap.length = 0;
    const ti = t % gw, tj = (t / gw) | 0;
    const hfun = (c) => {
      const dx = Math.abs((c % gw) - ti), dz = Math.abs(((c / gw) | 0) - tj);
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
    };
    // 二叉堆：元素是 [f, cell]
    const push = (f, c) => {
      let i = heap.length; heap.push(f, c);
      while (i > 0) {
        const p = (((i >> 1) - 1) >> 1) << 1;
        if (heap[p] <= f) break;
        heap[i] = heap[p]; heap[i + 1] = heap[p + 1]; i = p;
      }
      heap[i] = f; heap[i + 1] = c;
    };
    const pop = () => {
      const top = heap[1];
      const lc = heap.pop(), lf = heap.pop();
      const n = heap.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let ch = i * 2 + 2;
          if (ch >= n) break;
          if (ch + 2 < n && heap[ch + 2] < heap[ch]) ch += 2;
          if (heap[ch] >= lf) break;
          heap[i] = heap[ch]; heap[i + 1] = heap[ch + 1]; i = ch;
        }
        heap[i] = lf; heap[i + 1] = lc;
      }
      return top;
    };
    g[s] = 0; parent[s] = -1; stamp[s] = gen;
    push(hfun(s), s);
    let found = false, iter = 0;
    while (heap.length && iter++ < 6000) {
      const c = pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === t) { found = true; break; }
      const ci = c % gw, cj = (c / gw) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const nc = nj * gw + ni;
        if (blocked[nc] || closed[nc] === gen) continue;
        // 斜着走时两侧都得是空的，避免穿墙角
        if (di && dj && (blocked[cj * gw + ni] || blocked[nj * gw + ci])) continue;
        const ng = g[c] + (di && dj ? 1.4142 : 1);
        if (stamp[nc] !== gen || ng < g[nc]) {
          g[nc] = ng; parent[nc] = c; stamp[nc] = gen;
          push(ng + hfun(nc), nc);
        }
      }
    }
    if (!found) return [[tx, tz]];
    // 回溯出格子序列
    const pts = [];
    for (let c = t; c !== -1; c = parent[c]) pts.push([((c % gw) + 0.5) * this.cs, (((c / gw) | 0) + 0.5) * this.cs]);
    pts.reverse();
    if (t === tRaw) pts[pts.length - 1] = [tx, tz];
    // 拉直：从当前位置出发，尽量直达更远的路径点
    const out = [];
    let cx = sx, cz = sz, i = 0;
    while (i < pts.length) {
      let far = i;
      for (let k = pts.length - 1; k > i; k--) { if (this.los(cx, cz, pts[k][0], pts[k][1])) { far = k; break; } }
      out.push(pts[far]); cx = pts[far][0]; cz = pts[far][1]; i = far + 1;
    }
    return out;
  }
}
