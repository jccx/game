// 梦想乐园：核心逻辑——格子地图、建造、过山车轨道编辑、游客行为、收支、贷款、研究、天气。
// 只有规则，没有画面和 DOM 代码，可以脱离浏览器跑（测试用）。
// 坐标：格子 (x, z)，x 向东 0~23，z 向南 0~17；入口在南边中间。
import { GRID, ENTRANCE, DAY_LEN, DAYS_PER_MONTH, SCENARIOS, DIFFICULTY, PATH, RIDES, SHOPS, BUILDING, TICKET, LOAN, RESEARCH, WEATHER, COASTER, VISITOR, DEMOLISH_REFUND } from './config.js';
import { makeRng, clamp } from '../../shared/js/util.js';

export const SAVE_KEY = 'park-save-v1';
const key = (x, z) => x + ',' + z;
const inBounds = (x, z) => x >= 0 && x < GRID.w && z >= 0 && z < GRID.d;
/** 入口大门那两格 */
const isEntrance = (x, z) => z === ENTRANCE.z && x >= ENTRANCE.x && x < ENTRANCE.x + ENTRANCE.w;
/** 入口广场：大门北边一格宽 4 格的区域，游客从这里进园 */
const isPlaza = (x, z) => z === ENTRANCE.z - 1 && x >= ENTRANCE.x - 1 && x < ENTRANCE.x + ENTRANCE.w + 1;

/** 四个方向：北、东、南、西 */
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * 过山车轨道推演：从站台出口出发，按段列表走一格一格算出每段的位置和朝向。
 * 返回 { tiles: [[x,z]...], closed, end:[x,z], heading }；closed 表示回到起点格且段数够。
 */
export function traceCoaster(station, segments) {
  if (!station) return { tiles: [], closed: false, end: null, heading: 0 };
  let x = station.x, z = station.z - 1, heading = 0; // 出口在站台北边，朝北出发
  const tiles = [];
  for (const s of segments) {
    if (s === 'left') heading = (heading + 3) % 4;
    else if (s === 'right') heading = (heading + 1) % 4;
    // 直行、上升、下降都向前走一格；上升/下降只影响速度和刺激度
    x += DIRS[heading][0]; z += DIRS[heading][1];
    tiles.push([x, z]);
  }
  const start = [station.x, station.z - 1];
  const closed = segments.length >= COASTER.minSegments && tiles.length > 0 &&
    tiles[tiles.length - 1][0] === start[0] && tiles[tiles.length - 1][1] === start[1];
  return { tiles, closed, end: tiles.length ? tiles[tiles.length - 1] : start, heading };
}

/** 由轨道段算速度和刺激度 */
export function coasterStats(segments) {
  let drops = 0, turns = 0, ups = 0;
  for (const s of segments) {
    if (s === 'down') drops++;
    else if (s === 'left' || s === 'right') turns++;
    else if (s === 'up') ups++;
  }
  const speed = clamp(COASTER.baseSpeed + drops * COASTER.dropSpeed + turns * COASTER.turnSpeed - ups * 0.5, COASTER.minSpeed, COASTER.maxSpeed);
  const thrill = clamp(COASTER.baseThrill + drops * COASTER.dropThrill + turns * COASTER.turnThrill + segments.length * COASTER.lengthThrill, 0, COASTER.maxThrill);
  return { speed, thrill, drops, turns, ups, length: segments.length };
}

export class Park {
  /**
   * @param {object} [o]
   * @param {number} [o.seed] 随机种子（天气、游客都由它决定，同一个种子同一套流程）
   * @param {string} [o.scenario='meadow'] 开局方案
   * @param {number} [o.difficulty=1] 难度序号
   */
  constructor(o = {}) {
    this.seed = o.seed ?? ((Math.random() * 1e9) | 0);
    this.rnd = makeRng(this.seed + 7);
    const sc = SCENARIOS.find((s) => s.id === o.scenario) || SCENARIOS[0];
    this.scenario = sc.id;
    this.diff = DIFFICULTY[o.difficulty ?? 1] || DIFFICULTY[1];
    this.difficulty = o.difficulty ?? 1;
    this.time = 0; this.day = 1; this.dayT = 0;
    this.money = sc.money; this.reputation = sc.reputation;
    this.ticketPrice = TICKET.def; this.loan = 0;
    this.weather = 'sunny'; this.weatherT = 0;
    this.cleanliness = 80;
    this.god = false; // 无敌 = 免费建造
    this.over = null; // 破产时 { reason: 'bankrupt' }
    this.events = [];
    this.paths = new Set(); // 已铺路的格子 "x,z"
    this.buildings = []; // { id, type, x, z, w, d, queue: [vid], riders: [{vid, t}], cycleT }
    this.nextBuildingId = 1;
    this.visitors = []; // { id, x, z, wallet, mood, hunger, state, path, pi, targetId, wait, rideT, color }
    this.nextVisitorId = 1;
    this.spawnT = 0;
    this.coaster = { station: null, segments: [] }; // station: {x, z} 站台左上角格
    this.researched = new Set();
    this.totalEarned = 0; this.totalSpent = 0; this.served = 0; this.todayEarned = 0; this.todaySpent = 0;
    this._satisfaction = []; // 今天游客离园时的心情，用于算口碑
  }

  emit(ev) { if (this.events.length < 500) this.events.push(ev); }
  get ticketCap() { return this.researched.has('ticket') ? TICKET.maxResearched : TICKET.max; }
  get coasterTrace() { return traceCoaster(this.coaster.station, this.coaster.segments); }
  get coasterClosed() { return this.coasterTrace.closed; }
  get coasterOperable() {
    const st = this.buildings.find((b) => b.type === 'coaster');
    return !!st && this.coasterClosed;
  }
  buildingById(id) { return this.buildings.find((b) => b.id === id); }
  visitorById(id) { return this.visitors.find((v) => v.id === id); }

  /** 某格现在是什么：entrance / plaza / path / building / grass */
  tileAt(x, z) {
    if (!inBounds(x, z)) return 'outside';
    if (isEntrance(x, z)) return 'entrance';
    if (isPlaza(x, z)) return 'plaza';
    if (this.paths.has(key(x, z))) return 'path';
    if (this.buildings.some((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d)) return 'building';
    return 'grass';
  }

  /** 某块矩形占地是否全是草地（可建） */
  _freeRect(x, z, w, d) {
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
      if (this.tileAt(x + dx, z + dz) !== 'grass') return false;
    }
    return true;
  }

  _pay(n) { this.money -= n; this.totalSpent += n; this.todaySpent += n; }
  _earn(n) { this.money += n; this.totalEarned += n; this.todayEarned += n; }

  /* ------------------------------------------------------------ 建造 */

  /** 铺路：一格草地，20 元 */
  buildPath(x, z) {
    if (this.over) return { ok: false, reason: '已经破产了' };
    if (!inBounds(x, z)) return { ok: false, reason: '超出乐园范围' };
    if (this.tileAt(x, z) !== 'grass') return { ok: false, reason: '这里已经有东西了' };
    if (!this.god && this.money < PATH.cost) return { ok: false, reason: '钱不够铺路' };
    if (!this.god) this._pay(PATH.cost);
    this.paths.add(key(x, z));
    this.emit({ type: 'build', kind: 'path', x, z });
    return { ok: true };
  }

  /** 建一个设施/商店/厕所。返回 { ok, reason?, building? } */
  build(kind, x, z) {
    if (this.over) return { ok: false, reason: '已经破产了' };
    const def = BUILDING[kind];
    if (!def) return { ok: false, reason: '没有这种建筑' };
    if (def.tier === 2 && !this.researched.has(kind)) return { ok: false, reason: def.name + '还没研究解锁' };
    if (kind === 'coaster' && this.coaster.station) return { ok: false, reason: '过山车站台只能建一个' };
    if (x < 0 || z < 0 || x + def.w > GRID.w || z + def.d > GRID.d) return { ok: false, reason: '超出乐园范围' };
    if (!this._freeRect(x, z, def.w, def.d)) return { ok: false, reason: '这里被占了，换块空地' };
    if (!this.god && this.money < def.cost) return { ok: false, reason: '钱不够建' + def.name };
    if (!this.god) this._pay(def.cost);
    const b = { id: this.nextBuildingId++, type: kind, x, z, w: def.w, d: def.d, queue: [], riders: [], cycleT: 0 };
    this.buildings.push(b);
    if (kind === 'coaster') this.coaster.station = { x, z };
    this.emit({ type: 'build', kind, x, z, building: b });
    return { ok: true, building: b };
  }

  /** 拆除：点到建筑或路，返还 30% 造价 */
  demolishAt(x, z) {
    if (this.over) return { ok: false, reason: '已经破产了' };
    const bi = this.buildings.findIndex((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d);
    if (bi >= 0) {
      const b = this.buildings[bi];
      // 正在排队/乘坐的游客先放走
      for (const vid of [...b.queue, ...b.riders.map((r) => r.vid)]) { const v = this.visitorById(vid); if (v) this._sendHome(v); }
      this.buildings.splice(bi, 1);
      if (b.type === 'coaster') { this.coaster = { station: null, segments: [] }; }
      const refund = Math.round(BUILDING[b.type].cost * DEMOLISH_REFUND);
      this.money += refund;
      this.emit({ type: 'demolish', kind: b.type, refund });
      return { ok: true, refund };
    }
    if (this.paths.has(key(x, z))) {
      this.paths.delete(key(x, z));
      this.emit({ type: 'demolish', kind: 'path', refund: 0 });
      return { ok: true, refund: 0 };
    }
    return { ok: false, reason: '这里没东西可拆' };
  }

  /* ------------------------------------------------------------ 过山车编辑 */

  /** 加一段轨道：straight 直行 / left 左转 / right 右转 / up 上坡 / down 下坡 */
  coasterAdd(seg) {
    if (!this.coaster.station) return { ok: false, reason: '先建一个过山车站台' };
    if (!['straight', 'left', 'right', 'up', 'down'].includes(seg)) return { ok: false, reason: '没有这种轨道段' };
    if (this.coaster.segments.length >= 40) return { ok: false, reason: '轨道太长了，最多 40 段' };
    if (!this.god && this.money < COASTER.segmentCost) return { ok: false, reason: '钱不够加轨道' };
    // 预演：新段不能出界，也不能撞上站台以外的建筑（轨道可以穿过空地）
    const next = [...this.coaster.segments, seg];
    const tr = traceCoaster(this.coaster.station, next);
    const last = tr.tiles[tr.tiles.length - 1];
    if (!last || !inBounds(last[0], last[1])) return { ok: false, reason: '这段会修出乐园外' };
    // 轨道不能穿过已有建筑（站台本身和闭环回到起点除外）
    const start = [this.coaster.station.x, this.coaster.station.z - 1];
    for (const [tx, tz] of tr.tiles) {
      if (tx === start[0] && tz === start[1]) continue;
      if (this.tileAt(tx, tz) === 'building') return { ok: false, reason: '轨道撞上建筑了' };
    }
    if (!this.god) this._pay(COASTER.segmentCost);
    this.coaster.segments.push(seg);
    const closed = traceCoaster(this.coaster.station, this.coaster.segments).closed;
    this.emit({ type: 'coaster', segments: this.coaster.segments.length, closed });
    return { ok: true, closed };
  }

  /** 删掉最后一段轨道，返还一半造价 */
  coasterUndo() {
    const s = this.coaster.segments.pop();
    if (!s) return { ok: false, reason: '没有轨道可删' };
    this.money += Math.round(COASTER.segmentCost / 2);
    return { ok: true };
  }

  /** 清空全部轨道 */
  coasterClear() {
    const n = this.coaster.segments.length;
    this.coaster.segments = [];
    this.money += Math.round((COASTER.segmentCost / 2) * n);
    return { ok: true, refunded: n };
  }

  /* ------------------------------------------------------------ 门票、贷款、研究 */

  setTicket(p) {
    p = clamp(Math.round(p), TICKET.min, this.ticketCap);
    this.ticketPrice = p;
    this.emit({ type: 'ticket', price: p });
    return p;
  }

  /** 借钱：每次最多 5000，总额上限 20000 */
  borrow(n) {
    if (this.over) return { ok: false, reason: '已经破产了' };
    n = Math.round(n);
    if (n <= 0) return { ok: false, reason: '借多少？' };
    if (n > LOAN.chunk) return { ok: false, reason: '一次最多借 ' + LOAN.chunk + ' 元' };
    if (this.loan + n > LOAN.max) return { ok: false, reason: '贷款总额不能超过 ' + LOAN.max + ' 元' };
    this.loan += n; this.money += n;
    this.emit({ type: 'loan', loan: this.loan });
    return { ok: true };
  }

  /** 还钱：还多少就减多少贷款 */
  repay(n) {
    n = clamp(Math.round(n), 0, Math.min(this.loan, Math.max(0, this.money)));
    if (n <= 0) return { ok: false, reason: '没钱还或没有贷款' };
    this.loan -= n; this.money -= n;
    this.emit({ type: 'loan', loan: this.loan });
    return { ok: true, repaid: n };
  }

  research(id) {
    const r = RESEARCH.find((x) => x.id === id);
    if (!r) return { ok: false, reason: '没有这项研究' };
    if (this.researched.has(id)) return { ok: false, reason: '已经研究过了' };
    if (!this.god && this.money < r.cost) return { ok: false, reason: '钱不够研究' };
    if (!this.god) this._pay(r.cost);
    this.researched.add(id);
    this.emit({ type: 'research', id });
    return { ok: true };
  }

  /* ------------------------------------------------------------ 游客 */

  /** 游客能走的格子：路、入口、广场 */
  _walkable(x, z) {
    const t = this.tileAt(x, z);
    return t === 'path' || t === 'entrance' || t === 'plaza';
  }

  /** BFS 找路：从 (x0,z0) 到 (x1,z1)，只走路/入口/广场。返回格子列表，不含起点 */
  findPath(x0, z0, x1, z1) {
    if (!this._walkable(x1, z1) && !(x1 === x0 && z1 === z0)) return null;
    const prev = new Map(), seen = new Set([key(x0, z0)]);
    const q = [[x0, z0]];
    while (q.length) {
      const [cx, cz] = q.shift();
      if (cx === x1 && cz === z1) {
        const path = [];
        let cur = key(x1, z1);
        while (cur !== key(x0, z0)) { const [px, pz] = cur.split(',').map(Number); path.unshift([px, pz]); cur = prev.get(cur); }
        return path;
      }
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz, k = key(nx, nz);
        if (!inBounds(nx, nz) || seen.has(k) || !this._walkable(nx, nz)) continue;
        seen.add(k); prev.set(k, key(cx, cz)); q.push([nx, nz]);
      }
    }
    return null;
  }

  /** 建筑门口最近的路格：建筑南边/北边/东边/西边贴着的那一圈路格里离入口最近的 */
  doorTile(b) {
    let best = null, bestD = 1e9;
    for (let dz = -1; dz <= b.d; dz++) for (let dx = -1; dx <= b.w; dx++) {
      if (dx >= 0 && dx < b.w && dz >= 0 && dz < b.d) continue; // 内部不要
      if (dx < 0 || dx >= b.w) { if (dz < 0 || dz >= b.d) continue; } // 只取四边中点方向的邻格
      const x = b.x + dx, z = b.z + dz;
      if (!inBounds(x, z) || !this._walkable(x, z)) continue;
      const d = Math.abs(x - ENTRANCE.x) + Math.abs(z - ENTRANCE.z);
      if (d < bestD) { bestD = d; best = [x, z]; }
    }
    return best;
  }

  /** 能接待游客的建筑：过山车要闭环才算 */
  operableBuildings() {
    return this.buildings.filter((b) => {
      if (b.type === 'coaster') return this.coasterClosed;
      return true;
    });
  }

  _spawnVisitor() {
    const sc = SCENARIOS.find((s) => s.id === this.scenario);
    const wallet = sc.wallet[0] + this.rnd() * (sc.wallet[1] - sc.wallet[0]);
    const v = {
      id: this.nextVisitorId++, x: ENTRANCE.x + 0.5, z: ENTRANCE.z, wallet,
      mood: VISITOR.moodMin + this.rnd() * (VISITOR.moodMax - VISITOR.moodMin),
      hunger: this.rnd() * 30, state: 'enter', path: [], pi: 0, targetId: 0, wait: 0, rideT: 0,
      color: ['#e2523f', '#4a8fe8', '#52b85a', '#f2c230', '#9a5be0', '#f08a2e'][((this.rnd() * 6) | 0)],
    };
    // 门票：钱包不够就不进来
    if (v.wallet < this.ticketPrice) return null;
    v.wallet -= this.ticketPrice;
    this._earn(this.ticketPrice);
    this.visitors.push(v);
    this.emit({ type: 'enter', id: v.id });
    this._pickTarget(v);
    return v;
  }

  /** 给游客挑下一个目标：饿了找吃的，否则找个能去的游乐设施；都没得去就回家 */
  _pickTarget(v) {
    const cands = [];
    for (const b of this.operableBuildings()) {
      const door = this.doorTile(b);
      if (!door) continue;
      const def = BUILDING[b.type];
      const price = b.type === 'coaster' ? BUILDING.coaster.price : def.price;
      if (v.wallet < price && def.kind !== 'toilet') continue;
      const hungry = v.hunger > 55;
      if (hungry && def.kind !== 'shop' && def.kind !== 'toilet') continue;
      if (!hungry && def.kind === 'shop' && this.rnd() < 0.55) continue; // 不饿时不一定去商店
      cands.push({ b, door, def });
    }
    if (!cands.length) { this._sendHome(v); return; }
    // 刺激度高的更受欢迎；下雨天热门设施打折扣
    const w = WEATHER[this.weather];
    const pick = cands[((this.rnd() * cands.length) | 0)];
    const path = this.findPath(Math.floor(v.x), Math.floor(v.z), pick.door[0], pick.door[1]);
    if (!path) { this._sendHome(v); return; }
    v.path = path; v.pi = 0; v.targetId = pick.b.id; v.state = 'toTarget';
    void w;
  }

  _sendHome(v) {
    v.state = 'leaving';
    const path = this.findPath(Math.floor(v.x), Math.floor(v.z), ENTRANCE.x, ENTRANCE.z);
    v.path = path || []; v.pi = 0; v.targetId = 0;
    if (!path) { // 走不到入口（路被拆了）：直接消失
      v.state = 'gone';
    }
  }

  _removeVisitor(v) {
    this.visitors = this.visitors.filter((o) => o !== v);
    for (const b of this.buildings) {
      b.queue = b.queue.filter((id) => id !== v.id);
      b.riders = b.riders.filter((r) => r.vid !== v.id);
    }
    this._satisfaction.push(v.mood);
    this.served++;
    this.emit({ type: 'leave', id: v.id, mood: Math.round(v.mood) });
  }

  _walkAlong(v, dt) {
    if (v.pi >= v.path.length) return true;
    const [tx, tz] = v.path[v.pi];
    const cx = tx + 0.5, cz = tz + 0.5;
    const dx = cx - v.x, dz = cz - v.z, d = Math.hypot(dx, dz);
    const step = VISITOR.walkSpeed * dt;
    if (d <= step) { v.x = cx; v.z = cz; v.pi++; return v.pi >= v.path.length; }
    v.x += (dx / d) * step; v.z += (dz / d) * step;
    return false;
  }

  _updateVisitor(v, dt) {
    v.hunger = Math.min(100, v.hunger + VISITOR.hungerRate * dt);
    if (v.hunger > 80) v.mood = Math.max(0, v.mood - 0.4 * dt);
    switch (v.state) {
      case 'enter':
      case 'toTarget': {
        if (this._walkAlong(v, dt)) {
          if (v.state === 'enter') { v.state = 'toTarget'; break; }
          const b = this.buildingById(v.targetId);
          if (!b) { this._pickTarget(v); break; }
          v.state = 'queue'; v.wait = 0;
          b.queue.push(v.id);
        }
        break;
      }
      case 'queue': {
        v.wait += dt;
        v.mood = Math.max(0, v.mood - VISITOR.moodDecay * dt * (v.wait > 30 ? 3 : 1));
        if (v.wait > 90) { // 排太久不耐烦，走人
          v.mood = Math.max(0, v.mood - 15);
          const b = this.buildingById(v.targetId);
          if (b) b.queue = b.queue.filter((id) => id !== v.id);
          this._pickTarget(v);
        }
        break;
      }
      case 'riding': {
        v.rideT -= dt;
        if (v.rideT <= 0) {
          const b = this.buildingById(v.targetId);
          if (b) {
            const def = BUILDING[b.type];
            v.mood = clamp(v.mood + (def.thrill || 3) * 1.6 - 4, 0, 100);
            if (def.kind === 'shop') v.hunger = Math.max(0, v.hunger - 45);
            if (b.type === 'toilet') this.cleanliness = Math.min(100, this.cleanliness + 1);
          }
          // 再玩一个或回家：心情好、钱包还够就继续
          if (v.mood > 45 && v.wallet > 15 && this.rnd() < 0.65) this._pickTarget(v);
          else this._sendHome(v);
        }
        break;
      }
      case 'leaving': {
        if (this._walkAlong(v, dt)) this._removeVisitor(v);
        break;
      }
    }
  }

  /** 设施发车：排队的人按容量上车，收钱，开始乘坐 */
  _updateBuildings(dt) {
    const w = WEATHER[this.weather];
    for (const b of this.buildings) {
      const def = BUILDING[b.type];
      if (b.type === 'coaster' && !this.coasterClosed) continue;
      b.cycleT -= dt;
      // 正在乘坐的人计时由游客自己管，这里只处理发车间隔
      if (b.cycleT > 0 || !b.queue.length) continue;
      const take = Math.min(def.capacity, b.queue.length);
      const riders = b.queue.splice(0, take);
      for (const vid of riders) {
        const v = this.visitorById(vid);
        if (!v) continue;
        const price = def.price;
        if (v.wallet < price) { v.mood = Math.max(0, v.mood - 8); this._pickTarget(v); continue; }
        v.wallet -= price;
        this._earn(price);
        v.state = 'riding'; v.rideT = def.duration; v.targetId = b.id;
        b.riders.push({ vid, t: def.duration });
      }
      b.cycleT = def.duration;
      if (riders.length) this.emit({ type: 'ride', building: b.id, n: riders.length });
      void w;
    }
    // 清理已下车的 riders 记录
    for (const b of this.buildings) {
      b.riders = b.riders.filter((r) => {
        const v = this.visitorById(r.vid);
        return v && v.state === 'riding';
      });
    }
  }

  /* ------------------------------------------------------------ 主循环 */

  /** 推进 dt 秒（游戏内时间） */
  tick(dt) {
    if (this.over) return;
    this.time += dt; this.dayT += dt;
    // 天气：每天换一次，用种子随机数决定，保证同一种子同一套天气
    if (this.dayT >= DAY_LEN) {
      this.dayT -= DAY_LEN; this.day++;
      this.todayEarned = 0; this.todaySpent = 0;
      this._endOfDay();
      const r = this.rnd();
      this.weather = r < 0.5 ? 'sunny' : r < 0.8 ? 'cloudy' : 'rainy';
      this.emit({ type: 'weather', weather: this.weather, day: this.day });
    }
    // 游客生成：口碑越高、票价越低、天气越好，来得越快
    const w = WEATHER[this.weather];
    const repF = 0.4 + this.reputation / 100;
    const ticketF = clamp(1 - this.ticketPrice / 80, 0.15, 1);
    const interval = (VISITOR.baseSpawnEvery / (repF * ticketF * w.spawn * this.diff.spawn)) || 99;
    this.spawnT += dt;
    if (this.spawnT >= interval && this.visitors.length < VISITOR.maxInPark) {
      this.spawnT = 0;
      this._spawnVisitor();
    }
    for (const v of [...this.visitors]) {
      if (v.state === 'gone') { this._removeVisitor(v); continue; }
      this._updateVisitor(v, dt);
    }
    this._updateBuildings(dt);
    // 干净程度：游客多就脏得快，厕所多就干净
    const toilets = this.buildings.filter((b) => b.type === 'toilet').length;
    this.cleanliness = clamp(this.cleanliness - dt * 0.01 * this.visitors.length + dt * 0.05 * toilets, 0, 100);
    if (this.money < LOAN.bankrupt) {
      this.over = { reason: 'bankrupt' };
      this.emit({ type: 'over', reason: 'bankrupt' });
    }
  }

  /** 每天结束：收维护费、算口碑、每月还贷款利息 */
  _endOfDay() {
    // 维护费
    let upkeep = 0;
    for (const b of this.buildings) upkeep += BUILDING[b.type].upkeep * this.diff.upkeep;
    upkeep = Math.round(upkeep);
    if (upkeep) this._pay(upkeep);
    // 口碑：按今天离园游客的平均心情和干净程度调整
    if (this._satisfaction.length) {
      const avg = this._satisfaction.reduce((a, b) => a + b, 0) / this._satisfaction.length;
      const delta = (avg - 60) * 0.08 + (this.cleanliness - 60) * 0.03;
      this.reputation = clamp(this.reputation + delta, 0, 100);
      this._satisfaction = [];
    } else {
      this.reputation = clamp(this.reputation + (this.cleanliness - 60) * 0.02, 0, 100);
    }
    // 每月利息
    if (this.day % DAYS_PER_MONTH === 0 && this.loan > 0) {
      const interest = Math.round(this.loan * LOAN.monthlyRate);
      this._pay(interest);
      this.emit({ type: 'interest', interest });
    }
    this.emit({ type: 'day', day: this.day, upkeep });
  }

  /* ------------------------------------------------------------ 存档 */

  serialize() {
    return {
      v: 1, seed: this.seed, scenario: this.scenario, difficulty: this.difficulty,
      time: this.time, day: this.day, dayT: this.dayT, money: this.money, reputation: this.reputation,
      ticketPrice: this.ticketPrice, loan: this.loan, weather: this.weather, cleanliness: this.cleanliness,
      god: this.god, over: this.over,
      paths: [...this.paths],
      buildings: this.buildings.map((b) => ({ ...b, queue: [...b.queue], riders: b.riders.map((r) => ({ ...r })) })),
      nextBuildingId: this.nextBuildingId,
      visitors: this.visitors.map((v) => ({ ...v, path: v.path.map((p) => [...p]) })),
      nextVisitorId: this.nextVisitorId, spawnT: this.spawnT,
      coaster: { station: this.coaster.station ? { ...this.coaster.station } : null, segments: [...this.coaster.segments] },
      researched: [...this.researched],
      totalEarned: this.totalEarned, totalSpent: this.totalSpent, served: this.served,
    };
  }

  static deserialize(data) {
    const p = new Park({ seed: data.seed, scenario: data.scenario, difficulty: data.difficulty });
    p.time = data.time; p.day = data.day; p.dayT = data.dayT; p.money = data.money;
    p.reputation = data.reputation; p.ticketPrice = data.ticketPrice; p.loan = data.loan;
    p.weather = data.weather; p.cleanliness = data.cleanliness; p.god = !!data.god; p.over = data.over || null;
    p.paths = new Set(data.paths);
    p.buildings = data.buildings.map((b) => ({ ...b, queue: [...b.queue], riders: b.riders.map((r) => ({ ...r })) }));
    p.nextBuildingId = data.nextBuildingId;
    p.visitors = data.visitors.map((v) => ({ ...v, path: v.path.map((q) => [...q]) }));
    p.nextVisitorId = data.nextVisitorId; p.spawnT = data.spawnT || 0;
    p.coaster = { station: data.coaster.station ? { ...data.coaster.station } : null, segments: [...data.coaster.segments] };
    p.researched = new Set(data.researched || []);
    p.totalEarned = data.totalEarned || 0; p.totalSpent = data.totalSpent || 0; p.served = data.served || 0;
    p.events = [];
    return p;
  }

  /** 存到 localStorage（浏览器里用；Node 里没有 localStorage 时返回 false） */
  save() {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
      return true;
    } catch { return false; }
  }

  /** 从 localStorage 读档；没有档返回 null */
  static load() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return Park.deserialize(JSON.parse(raw));
    } catch { return null; }
  }
}
