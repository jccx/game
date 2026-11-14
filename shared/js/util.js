// 通用小工具：数学、随机数、角度、格式化。不依赖任何其它模块。

export const TAU = Math.PI * 2;

/** 把 v 限制在 [a, b] */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 线性插值 */
export const lerp = (a, b, t) => a + (b - a) * t;

/** 与帧率无关的平滑逼近：k 越大越快 */
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/** 从角度 a 转到角度 b 的最短差值，范围 (-π, π] */
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** 角度的平滑逼近 */
export const angDamp = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));

/** 角度以最大步长 maxStep 转向 b */
export function angToward(a, b, maxStep) {
  const d = angDiff(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}

/** 平面距离的平方 / 距离 */
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** 平滑阶跃 */
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 可复现的随机数发生器（mulberry32）。返回一个函数，每次调用给出 [0,1) */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [a, b) 内的随机数；只给一个参数时为 [0, a) */
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));

/** 随机整数 [a, b] */
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

/** 从数组里随机取一个 */
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

/** 整数坐标哈希到 [0,1)，用于噪声 */
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 二维值噪声，输出 [0,1] */
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** 多层叠加的噪声（分形），输出约 [0,1] */
export function fbm2(x, y, octaves = 4, seed = 1) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f, seed + i * 17);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

/** 秒数格式化成 mm:ss */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/** 点 (px,pz) 到线段 (ax,az)-(bx,bz) 的最近点参数 t∈[0,1] */
export function segParam(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return 0;
  return clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
}

/** 点到线段的距离 */
export function segDist(px, pz, ax, az, bx, bz) {
  const t = segParam(px, pz, ax, az, bx, bz);
  return Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
}
