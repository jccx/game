// 落日湾：世界的“数据”——地形高度、路网、街区、建筑、特殊地点。纯计算，不含任何画面代码。
// 整个世界由固定的随机种子生成，每次打开都一样。坐标：x 向东，z 向南，y 向上，单位是米；海平面 y=0。
// 城市建在一张 80 米间距的方格路网上；西北角是山，四周是海。
import { makeRng, fbm2, smoothstep, clamp } from '../../shared/js/util.js';

export const SIZE = 1600;                 // 世界边长
export const PITCH = 80;                  // 路网间距
export const ROAD = 14;                   // 路宽
export const GX0 = 320, GZ0 = 280;        // 第一条竖路、第一条横路的坐标
export const NI = 15, NJ = 14;            // 竖路、横路的条数
export const CITY_Y = 2;                  // 城区地面高度
export const CURB = 0.16;                 // 人行道比路面高出的高度
const SEED = 77;

/** 机场、军营占用的范围（内部没有道路）：[x0, z0, x1, z1] */
export const AIRPORT = [1120, 600, 1360, 920];
export const BASE = [880, 360, 1040, 520];
/** 机场跑道：沿 z 方向 */
export const RUNWAY = { x: 1280, z0: 616, z1: 904, w: 30 };

/* ------------------------------------------------------------------ 地形 */

/** 大于 0 是陆地，越大离海岸越远 */
function landMask(x, z) {
  const dx = (x - 860) / 660, dz = (z - 800) / 580;
  return 1 - Math.sqrt(dx * dx + dz * dz) + (fbm2(x * 0.004, z * 0.004, 3, SEED) - 0.5) * 0.3;
}
/** 西北角大山的权重（0~1） */
function mountain(x, z) { return Math.max(0, 1 - Math.hypot(x - 430, z - 430) / 330); }
/** 城区平地的权重：1 表示完全平坦 */
function flatness(x, z) {
  const inside = Math.min(x - (GX0 - 30), GX0 + (NI - 1) * PITCH + 30 - x, z - (GZ0 - 30), GZ0 + (NJ - 1) * PITCH + 30 - z);
  return clamp(inside / 50, 0, 1) * (1 - smoothstep(0.03, 0.2, mountain(x, z)));
}

/** 地形高度（不含人行道）。水下为负 */
export function terrainY(x, z) {
  const m = landMask(x, z);
  if (m < 0.045) return m < -0.02 ? Math.max(-14, -3 + (m + 0.02) * 60) : -3 + smoothstep(-0.02, 0.045, m) * (CITY_Y + 3);   // 海底和沙滩
  const f = flatness(x, z);
  if (f >= 0.999) return CITY_Y;
  const mt = mountain(x, z);
  const hill = Math.pow(mt, 1.5) * 120 * (0.65 + 0.7 * fbm2(x * 0.012, z * 0.012, 4, SEED + 5)) + fbm2(x * 0.008, z * 0.008, 3, SEED + 9) * 12;
  return CITY_Y + hill * (1 - f) * smoothstep(0.045, 0.14, m);
}

/** 这个位置是不是水域（船能开、车会沉） */
export const isWater = (x, z) => terrainY(x, z) < -0.6;

/* ------------------------------------------------------------------ 世界生成 */

const inRect = (x, z, r, pad = 0) => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad;

export class World {
  constructor() {
    const rnd = this.rnd = makeRng(SEED);
    // ---- 路口：平坦的陆地上才有 ----
    this.nodes = [];                                   // 下标 = j * NI + i；无效的为 null
    for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
      const x = GX0 + i * PITCH, z = GZ0 + j * PITCH;
      const ok = landMask(x, z) > 0.1 && flatness(x, z) > 0.999 && !inRect(x, z, AIRPORT, -1) && !inRect(x, z, BASE, -1);
      this.nodes.push(ok ? { i, j, x, z, id: j * NI + i, links: [] } : null);
    }
    // ---- 路段：相邻两个路口之间 ----
    this.edges = [];
    const link = (a, b) => { if (!a || !b) return; a.links.push(b); b.links.push(a); this.edges.push({ a, b, horiz: a.j === b.j }); };
    for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
      const n = this.node(i, j);
      if (i + 1 < NI) link(n, this.node(i + 1, j));
      if (j + 1 < NJ) link(n, this.node(i, j + 1));
    }
    // 去掉死路口（只连着一条路或没有路），避免车开进去出不来
    for (let pass = 0; pass < 3; pass++) for (const n of this.nodes) {
      if (!n || n.links.length !== 1) continue;
      const o = n.links[0]; o.links.splice(o.links.indexOf(n), 1); n.links.length = 0;
      this.edges = this.edges.filter((e) => e.a !== n && e.b !== n);
    }
    this.roadNodes = this.nodes.filter((n) => n && n.links.length >= 2);

    // ---- 街区和建筑 ----
    this.blocks = [];          // { i, j, x0, z0, x1, z1, zone }
    this.buildings = [];       // { x0, z0, x1, z1, y0, h, kind, color, roof }
    this.trees = [];           // [x, z, 大小]
    this.props = [];           // 小物件：{ type, x, z, ... }
    this.hash = new Map();     // 空间哈希：格子 → 建筑下标列表（碰撞用）
    for (let j = 0; j < NJ - 1; j++) for (let i = 0; i < NI - 1; i++) {
      const x0 = GX0 + i * PITCH + ROAD / 2, z0 = GZ0 + j * PITCH + ROAD / 2, x1 = x0 + PITCH - ROAD, z1 = z0 + PITCH - ROAD;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (inRect(cx, cz, AIRPORT) || inRect(cx, cz, BASE)) continue;
      // 四个角都得是平坦陆地
      let ok = true;
      for (const [px, pz] of [[x0 - 7, z0 - 7], [x1 + 7, z0 - 7], [x0 - 7, z1 + 7], [x1 + 7, z1 + 7]]) if (landMask(px, pz) < 0.075 || flatness(px, pz) < 0.999) ok = false;
      if (!ok) continue;
      const b = { i, j, x0, z0, x1, z1, zone: this.zoneAt(cx, cz, rnd) };
      this.blocks.push(b);
      this.fillBlock(b, rnd);
    }
    this.buildAirport(rnd);
    this.buildBase(rnd);
    this.scatterTrees(rnd);
    this.buildLandmarks();
    this.buildings.forEach((b, idx) => {
      for (let gx = Math.floor(b.x0 / 40); gx <= Math.floor(b.x1 / 40); gx++) for (let gz = Math.floor(b.z0 / 40); gz <= Math.floor(b.z1 / 40); gz++) {
        const k = gx * 1000 + gz; let a = this.hash.get(k); if (!a) this.hash.set(k, a = []); a.push(idx);
      }
    });
    this.blockAt = new Map(this.blocks.map((b) => [b.j * NI + b.i, b]));
    this.places = this.makePlaces();
  }

  node(i, j) { return i < 0 || j < 0 || i >= NI || j >= NJ ? null : this.nodes[j * NI + i]; }

  /** 街区的用途：市中心高楼、商业区、住宅、工业、公园、农田 */
  zoneAt(x, z, rnd) {
    const d = Math.hypot(x - 880, z - 840);
    if (d < 150) return rnd() < 0.15 ? 'park' : 'downtown';
    if (d < 290) return rnd() < 0.14 ? 'park' : 'commercial';
    if (z > 1080 && x > 760) return 'industrial';
    if (z < 560 || x > 1180) return rnd() < 0.2 ? 'residential' : 'farm';
    return rnd() < 0.08 ? 'park' : 'residential';
  }

  /** 建筑耐久（火箭筒一发 320，坦克炮弹一发 520）：民居 1 发、商店/仓库 2 发、高楼 3~4 发、地标 6~8 发 */
  defaultHp(kind, h) {
    if (kind === 'house') return 320;
    if (kind === 'shop' || kind === 'ware') return 640;
    if (kind === 'tower') return h >= 60 ? 1280 : 960;
    return 320;   // 围墙
  }

  addBuilding(x0, z0, x1, z1, h, kind, color, roof = 0, y0 = CITY_Y, opts = {}) {
    const hp = opts.hp ?? this.defaultHp(kind, h);
    this.buildings.push({ x0, z0, x1, z1, y0, h, kind, color, roof, name: opts.name ?? null, note: opts.note ?? null, hp, maxHp: hp, destroyed: false });
  }

  /** 世界知名地标：8 栋，固定放在市中心 downtown（位置见 README）。形状在 render/scene.js 里按 name 拼。 */
  buildLandmarks() {
    // [名字, 备注, 中心 x, 中心 z, 宽, 深, 高, 几发火箭筒]
    const list = [
      ['埃菲尔铁塔', '高 120 米', 840, 800, 40, 40, 120, 6],
      ['帝国大厦', '高 95 米', 1000, 800, 28, 28, 95, 7],
      ['哈利法塔', '全城最高，高 150 米', 920, 720, 30, 30, 150, 8],
      ['悉尼歌剧院', '贝壳形屋顶', 840, 960, 44, 26, 19, 6],
      ['比萨斜塔', '塔身倾斜约 6 度', 1000, 960, 16, 16, 30, 6],
      ['大本钟', '方形钟楼加钟面', 1000, 880, 14, 14, 55, 6],
      ['西尔斯大厦（威利斯大厦）', '含天线 145 米，全城第二高', 920, 880, 36, 36, 130, 8],
      ['特朗普大厦', '三段阶梯收窄，高 98 米', 840, 880, 26, 26, 98, 7],
    ];
    const COLORS = { '埃菲尔铁塔': 0x4a3b2e, '帝国大厦': 0xcbb98f, '哈利法塔': 0x9fb6c9, '悉尼歌剧院': 0xf0ede4, '比萨斜塔': 0xe8e0cc, '大本钟': 0xb8a888, '西尔斯大厦（威利斯大厦）': 0x2e3440, '特朗普大厦': 0x7a93a8 };
    for (const [name, note, cx, cz, w, d, h, rockets] of list) {
      const x0 = cx - w / 2, z0 = cz - d / 2, x1 = cx + w / 2, z1 = cz + d / 2;
      // 腾地方：清掉占了这块地的生成建筑和树（不挡跑道、出生点和任务点，都在市中心街区内）
      this.buildings = this.buildings.filter((b) => b.x1 < x0 - 2 || b.x0 > x1 + 2 || b.z1 < z0 - 2 || b.z0 > z1 + 2);
      this.trees = this.trees.filter(([x, z]) => x < x0 - 2 || x > x1 + 2 || z < z0 - 2 || z > z1 + 2);
      this.addBuilding(x0, z0, x1, z1, h, 'landmark', COLORS[name], 1, CITY_Y, { name, note, hp: rockets * 320 });
    }
  }

  /** 按用途给街区摆建筑和树 */
  fillBlock(b, rnd) {
    const W = b.x1 - b.x0, zone = b.zone;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const lots = (n, pad, fn) => {
      const s = (W - pad * 2) / n;
      for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) fn(b.x0 + pad + a * s, b.z0 + pad + c * s, s, a, c);
    };
    if (zone === 'downtown') {
      const core = 1 - Math.hypot(cx - 880, cz - 840) / 170;
      lots(2, 5, (x, z, s) => {
        if (rnd() < 0.1) { this.trees.push([x + s / 2, z + s / 2, 1.2]); return; }
        const m = 2 + rnd() * 3, h = 30 + rnd() * 40 + core * 60 * rnd();
        this.addBuilding(x + m, z + m, x + s - m, z + s - m, h, 'tower', TOWER_COLORS[(rnd() * TOWER_COLORS.length) | 0], rnd() < 0.5 ? 1 : 0);
      });
    } else if (zone === 'commercial') {
      lots(rnd() < 0.5 ? 2 : 3, 4, (x, z, s) => {
        if (rnd() < 0.12) { this.trees.push([x + s / 2, z + s / 2, 1]); return; }
        const m = 1.5 + rnd() * 2;
        this.addBuilding(x + m, z + m, x + s - m, z + s - m, 10 + rnd() * 26, 'shop', SHOP_COLORS[(rnd() * SHOP_COLORS.length) | 0]);
      });
    } else if (zone === 'residential') {
      lots(3, 4, (x, z, s, a, c) => {
        if (a === 1 && c === 1) { this.trees.push([x + s / 2, z + s / 2, 1.1]); return; }      // 街区中间留作院子
        if (rnd() < 0.15) { this.trees.push([x + s * 0.3, z + s * 0.6, 0.9]); return; }
        const w = 9 + rnd() * 4, d = 9 + rnd() * 4, ox = x + (s - w) / 2, oz = z + (s - d) / 2;
        this.addBuilding(ox, oz, ox + w, oz + d, 5.5 + rnd() * 3, 'house', HOUSE_COLORS[(rnd() * HOUSE_COLORS.length) | 0], 2);
        if (rnd() < 0.6) this.trees.push([x + 2 + rnd() * 3, z + 2 + rnd() * 3, 0.7 + rnd() * 0.4]);
      });
    } else if (zone === 'industrial') {
      const horiz = rnd() < 0.5;
      for (let k = 0; k < 2; k++) {
        if (rnd() < 0.25) continue;
        const col = WARE_COLORS[(rnd() * WARE_COLORS.length) | 0], h = 9 + rnd() * 6;
        if (horiz) this.addBuilding(b.x0 + 6, b.z0 + 6 + k * 30, b.x1 - 6, b.z0 + 30 + k * 30, h, 'ware', col);
        else this.addBuilding(b.x0 + 6 + k * 30, b.z0 + 6, b.x0 + 30 + k * 30, b.z1 - 6, h, 'ware', col);
      }
    } else if (zone === 'park') {
      for (let k = 0; k < 16; k++) this.trees.push([b.x0 + 5 + rnd() * (W - 10), b.z0 + 5 + rnd() * (W - 10), 0.9 + rnd() * 0.8]);
    } else {  // 农田：偶尔一座谷仓，田边几棵树
      if (rnd() < 0.35) { const x = b.x0 + 10 + rnd() * 30, z = b.z0 + 10 + rnd() * 30; this.addBuilding(x, z, x + 14, z + 10, 7, 'house', 0x9a4a3a, 2); }
      for (let k = 0; k < 5; k++) this.trees.push([b.x0 + 3 + rnd() * (W - 6), rnd() < 0.5 ? b.z0 + 3 : b.z1 - 3, 0.9 + rnd() * 0.6]);
    }
  }

  buildAirport() {
    const [x0, z0, x1] = AIRPORT;
    this.addBuilding(x0 + 16, z0 + 60, x0 + 44, z0 + 200, 13, 'ware', 0xd8dde6);            // 航站楼
    this.addBuilding(x0 + 20, z0 + 230, x0 + 32, z0 + 242, 34, 'tower', 0xb9c2d0, 1);       // 塔台
    this.addBuilding(x1 - 60, z0 + 20, x1 - 16, z0 + 60, 15, 'ware', 0x8fa0b5);             // 机库
    this.addBuilding(x1 - 60, z0 + 250, x1 - 16, z0 + 290, 15, 'ware', 0x8fa0b5);
  }

  buildBase() {
    const [x0, z0, x1, z1] = BASE, t = 1, h = 3.2, c = 0x6b7361;
    // 围墙，南面留一个大门
    this.addBuilding(x0, z0, x1, z0 + t, h, 'wall', c); this.addBuilding(x0, z0, x0 + t, z1, h, 'wall', c); this.addBuilding(x1 - t, z0, x1, z1, h, 'wall', c);
    this.addBuilding(x0, z1 - t, (x0 + x1) / 2 - 9, z1, h, 'wall', c); this.addBuilding((x0 + x1) / 2 + 9, z1 - t, x1, z1, h, 'wall', c);
    for (let k = 0; k < 3; k++) this.addBuilding(x0 + 14, z0 + 14 + k * 26, x0 + 62, z0 + 28 + k * 26, 6, 'ware', 0x6f7a5c);   // 营房
    this.addBuilding(x1 - 44, z0 + 14, x1 - 14, z0 + 44, 9, 'ware', 0x5f6a50);
  }

  /** 城区以外的野地和山上撒树（避开水、街区、道路和山顶） */
  scatterTrees(rnd) {
    const cells = new Set(this.blocks.map((b) => b.j * NI + b.i));
    for (let k = 0; k < 7000; k++) {
      const x = 80 + rnd() * (SIZE - 160), z = 80 + rnd() * (SIZE - 160);
      if (landMask(x, z) < 0.09 || inRect(x, z, AIRPORT, 20) || inRect(x, z, BASE, 10)) continue;
      if (cells.has(Math.floor((z - GZ0) / PITCH) * NI + Math.floor((x - GX0) / PITCH))) continue;
      let onRoad = false;
      for (const e of this.edges) {
        if (e.horiz ? Math.abs(z - e.a.z) < 12 && x > e.a.x - 12 && x < e.b.x + 12 : Math.abs(x - e.a.x) < 12 && z > e.a.z - 12 && z < e.b.z + 12) { onRoad = true; break; }
      }
      if (onRoad) continue;
      const y = terrainY(x, z);
      if (y > 95 || fbm2(x * 0.02, z * 0.02, 2, 3) < 0.36) continue;
      this.trees.push([x, z, 1 + rnd() * 1.2]);
    }
  }

  /** 特殊地点：出生点、医院、码头、各类载具的停放处 */
  makePlaces() {
    // 从 (x, z) 往南找到水够深的地方
    const shore = (x, z = 1250) => { while (z < SIZE - 20 && terrainY(x, z) > -1.6) z += 2; return z; };
    const px = GX0 + 7 * PITCH, pz = shore(px);          // 栈桥从最南边那条路的路口一直伸到海里
    return {
      spawn: { x: GX0 + 5 * PITCH + 10, z: GZ0 + 7 * PITCH + 22, face: -Math.PI / 2 },     // 住宅区的人行道上
      hospital: { x: GX0 + 7 * PITCH + 9.5, z: GZ0 + 6 * PITCH + 9.5 },
      pier: { x0: px - 5, x1: px + 5, z0: GZ0 + 12 * PITCH + ROAD / 2, z1: pz + 16 },
      boats: [[px - 11, pz + 6, 0], [px + 11, pz + 8, 0], [px - 11, pz + 15, 0]],        // 船头朝南（朝海）
      planes: [[RUNWAY.x, RUNWAY.z1 - 14, Math.PI], [AIRPORT[2] - 76, AIRPORT[1] + 40, -Math.PI / 2]],
      helis: [[1210, 760, 0]],          // 机场停机坪：跑道西侧空地（地面平坦，无建筑），不用跑道就能原地起飞
      tanks: [[BASE[2] - 60, BASE[1] + 80, Math.PI], [BASE[2] - 46, BASE[1] + 80, Math.PI]],
      gate: { x: (BASE[0] + BASE[2]) / 2, z: BASE[3] + 6 },
    };
  }

  /* ---------------------------------------------------------------- 查询 */

  /** 城区内某点是不是在人行道/街区上（否则是路面） */
  onSidewalk(x, z) {
    const lx = ((x - GX0) % PITCH + PITCH) % PITCH, lz = ((z - GZ0) % PITCH + PITCH) % PITCH;
    return lx > ROAD / 2 && lx < PITCH - ROAD / 2 && lz > ROAD / 2 && lz < PITCH - ROAD / 2;
  }

  /** 是否在栈桥上 */
  onPier(x, z) { const p = this.places.pier; return x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1; }

  /** 这个位置是不是水域（船能开、车会沉）。栈桥上不算 */
  inWater(x, z) { return terrainY(x, z) < -0.6 && !this.onPier(x, z); }

  /** 地面高度（含人行道和栈桥），人和车踩在这个高度上 */
  groundY(x, z) {
    const y = terrainY(x, z);
    if (y < CITY_Y && this.onPier(x, z)) return CITY_Y;
    if (y === CITY_Y && this.onSidewalk(x, z)) {
      const i = Math.floor((x - GX0) / PITCH), j = Math.floor((z - GZ0) / PITCH);
      if (this.blockAt.has(j * NI + i)) return CITY_Y + CURB;
    }
    return y;
  }

  /**
   * 直升机降落用的屋顶查询：(x, z) 为中心、按 yaw 旋转的直升机矩形（长 len、宽 wid）加 margin 后
   * 完整落在同一栋平顶建筑的屋顶内时，返回 { top: 屋顶高度, b: 建筑 }；否则返回 null。
   * 只给直升机降落用，不改 collide 对其他载具和行人的行为。
   * 平顶（roof === 0）才能降：斜屋顶（民居）和带屋顶机房/天线的楼顶有凸起，落上去会穿模，所以不算。
   */
  roofAt(x, z, yaw, len, wid, margin = 0.5) {
    const hl = len / 2 + margin, hw = wid / 2 + margin;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    let best = null;
    this.nearBuildings(x, z, Math.max(len, wid), (b) => {
      if (b.roof !== 0) return;                    // 只要平顶
      for (const [a, d] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
        const px = x + a * fx + d * rx, pz = z + a * fz + d * rz;
        if (px < b.x0 || px > b.x1 || pz < b.z0 || pz > b.z1) return;   // 矩形有一角出界就不算
      }
      const top = b.y0 + b.h;
      if (!best || top > best.top) best = { top, b };
    });
    return best;
  }

  /** 站立高度：地面高度，或者脚下建筑的屋顶高度（人站在楼顶上时）。下机后站楼顶、屋顶行走用。 */
  supportY(x, z) {
    let y = this.groundY(x, z);
    this.nearBuildings(x, z, 1, (b) => {
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) y = Math.max(y, b.y0 + b.h);
    });
    return y;
  }

  /** 地面法线的近似（车在坡上跟着倾斜用）：返回 [沿 x 的坡度, 沿 z 的坡度] */
  slope(x, z) { return [(terrainY(x + 1.5, z) - terrainY(x - 1.5, z)) / 3, (terrainY(x, z + 1.5) - terrainY(x, z - 1.5)) / 3]; }

  /** 附近的建筑（碰撞用）。回调 fn(building)。被炸平的建筑跳过：碰撞、屋顶、遮挡都当它不存在 */
  nearBuildings(x, z, r, fn) {
    const g0 = Math.floor((x - r) / 40), g1 = Math.floor((x + r) / 40), h0 = Math.floor((z - r) / 40), h1 = Math.floor((z + r) / 40);
    for (let gx = g0; gx <= g1; gx++) for (let gz = h0; gz <= h1; gz++) {
      const a = this.hash.get(gx * 1000 + gz);
      if (a) for (let k = 0; k < a.length; k++) { const b = this.buildings[a[k]]; if (!b.destroyed) fn(b); }
    }
  }

  /**
   * 把一个圆（x, z, 半径 r，高度 y）从建筑里推出来。o 是带 x、z 的对象，直接修改。
   * 返回被推开的法线 [nx, nz, 深度]，没碰到返回 null。
   */
  collide(o, r, y = CITY_Y) {
    let hit = null;
    this.nearBuildings(o.x, o.z, r + 1, (b) => {
      if (y > b.y0 + b.h + 0.5) return;                          // 从楼顶上方飞过
      const cx = clamp(o.x, b.x0, b.x1), cz = clamp(o.z, b.z0, b.z1);
      let dx = o.x - cx, dz = o.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      let d = Math.sqrt(d2), nx, nz, pen;
      if (d > 1e-4) { nx = dx / d; nz = dz / d; pen = r - d; }
      else {                                                     // 圆心在楼里：从最近的一面推出去
        const l = o.x - b.x0, rr = b.x1 - o.x, t = o.z - b.z0, bb = b.z1 - o.z, m = Math.min(l, rr, t, bb);
        if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        pen = m + r;
      }
      o.x += nx * pen; o.z += nz * pen;
      if (!hit || pen > hit[2]) hit = [nx, nz, pen];
    });
    return hit;
  }

  /** 从 (x1,z1) 到 (x2,z2) 的视线是否被建筑挡住（高度 y 处） */
  blocked(x1, z1, x2, z2, y = CITY_Y + 1.5) {
    const d = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(d / 4);
    for (let k = 1; k < n; k++) {
      const t = k / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      let b = false;
      this.nearBuildings(x, z, 0.5, (bd) => { if (x > bd.x0 && x < bd.x1 && z > bd.z0 && z < bd.z1 && y < bd.y0 + bd.h) b = true; });
      if (b) return true;
    }
    return false;
  }

  /** 离 (x,z) 最近的路口 */
  nearestNode(x, z) {
    let best = null, bd = 1e18;
    for (const n of this.roadNodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  /** 路网上从路口 a 到路口 b 的最短路线（广度优先）。返回路口数组（含起点终点） */
  route(a, b) {
    if (a === b) return [a];
    const prev = new Map([[a, null]]), q = [a];
    for (let h = 0; h < q.length; h++) {
      const n = q[h];
      if (n === b) break;
      for (const o of n.links) if (!prev.has(o)) { prev.set(o, n); q.push(o); }
    }
    if (!prev.has(b)) return [a];
    const out = [];
    for (let n = b; n; n = prev.get(n)) out.push(n);
    return out.reverse();
  }
}

const TOWER_COLORS = [0x8fa6c4, 0x9db3c9, 0x6f8fb5, 0xb7c3d2, 0x7c93a8, 0xa8b8c8, 0x5f7f9f, 0xc2c9d4];
const SHOP_COLORS = [0xc9b79a, 0xb8a58a, 0xd6c3a5, 0xa89a8a, 0xc4a98c, 0xbdb2a0, 0xd9ccb8, 0xb59a84];
const HOUSE_COLORS = [0xf0e2c8, 0xe6d3b8, 0xd9e2e8, 0xf2d9c4, 0xdfe8d4, 0xe8dcc8, 0xf4ead8];
const WARE_COLORS = [0x8a96a3, 0x9aa08f, 0xa38f7a, 0x7f8c99, 0xb0a696];
