// 豆兵大战：核心逻辑——可破坏的地形、豆兵的移动和受击、各种武器、回合流程、电脑队伍的 AI。
// 只有规则，没有画面代码，可以脱离浏览器跑（测试用）。坐标是屏幕方向：x 向右，y 向下。
import { WORLD, PHYS, RULES, WEAPONS, WEAPON, TEAMS, DIFFICULTY, THEMES, TICK } from './config.js';
import { makeRng, fbm2, clamp, smoothstep } from '../../shared/js/util.js';

const W = WORLD.w, H = WORLD.h, R = PHYS.radius;

/* ------------------------------------------------------------------ 地形 */
export class Terrain {
  /** @param {number} seed 随机种子：同一个种子生成同一张图 */
  constructor(seed) {
    this.w = W; this.h = H; this.seed = seed;
    this.mask = new Uint8Array(W * H);        // 1 = 实心土，0 = 空
    const rnd = makeRng(seed), m = this.mask;
    // 一两处一直凹到水里的缺口，把陆地分成几块
    const gaps = [];
    for (let i = 0, n = 1 + ((rnd() * 2) | 0); i < n; i++) gaps.push([300 + rnd() * (W - 600), 50 + rnd() * 50]);
    for (let x = 0; x < W; x++) {
      const edge = smoothstep(30, 200, x) * smoothstep(W - 30, W - 200, x);
      let hgt = (130 + fbm2(x * 0.0042, seed * 3.7, 4, seed) * 360) * edge;
      for (const [gx, gw] of gaps) hgt *= smoothstep(gw * 0.5, gw * 1.6, Math.abs(x - gx));
      const top = Math.round(WORLD.water + 26 - hgt);
      for (let y = Math.max(0, top); y < H; y++) m[y * W + x] = 1;
    }
    // 几块浮在半空的平台
    for (let i = 0; i < 4; i++) {
      const cx = 220 + rnd() * (W - 440), sy = this.surfaceY(cx);
      if (sy < 0) continue;
      const cy = Math.max(110, sy - 110 - rnd() * 90), rx = 55 + rnd() * 60, ry = 13 + rnd() * 9;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) m[y * W + x] = 1;
      }
    }
    // 土里挖几个洞
    for (let i = 0; i < 5; i++) { const cx = 200 + rnd() * (W - 400), sy = this.surfaceY(cx); if (sy > 0 && sy < WORLD.water - 150) this.carve(cx, sy + 70 + rnd() * 60, 26 + rnd() * 22); }
  }

  /** 这个像素是不是实心的 */
  solid(x, y) { x |= 0; y |= 0; return x >= 0 && x < W && y >= 0 && y < H && this.mask[y * W + x] === 1; }

  /** 挖掉一个圆 */
  carve(cx, cy, r) {
    const m = this.mask, r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) m[y * W + x] = 0;
    }
  }

  /** 某一列从上往下第一个实心像素的 y；整列都空则返回 -1 */
  surfaceY(x) { x |= 0; if (x < 0 || x >= W) return -1; for (let y = 0; y < H; y++) if (this.mask[y * W + x]) return y; return -1; }

  /** 某点附近地面的法线（指向空的一侧），手雷弹跳用 */
  normal(x, y) {
    let nx = 0, ny = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (!this.solid(x + dx, y + dy)) { nx += dx; ny += dy; }
    const l = Math.hypot(nx, ny);
    return l < 1e-6 ? [0, -1] : [nx / l, ny / l];
  }
}

/* ------------------------------------------------------------------ 对局 */
export class Game {
  /**
   * @param {object} o
   * @param {number} [o.teams=2]  队伍数（2~4），第一队是玩家
   * @param {number} [o.size=4]   每队几个豆兵
   * @param {number} [o.difficulty=1]
   * @param {number} [o.seed]     地图种子
   * @param {boolean} [o.allBots] 玩家队也交给电脑（测试用）
   */
  constructor(o = {}) {
    this.seed = o.seed ?? ((Math.random() * 1e9) | 0);
    this.rnd = makeRng(this.seed + 99);
    this.terrain = new Terrain(this.seed);
    this.theme = THEMES[this.seed % THEMES.length];
    this.diff = DIFFICULTY[o.difficulty ?? 1];
    this.time = 0; this.events = []; this.shots = []; this.over = null; this.god = false; this.wind = 0;
    this.input = { move: 0, jump: false, flip: false };
    const nT = clamp(o.teams || 2, 2, 4), size = clamp(o.size || 4, 1, 5);
    this.teams = []; this.beans = [];
    // 出生点：在地面上均匀取位置（带一点随机抖动）；抖动找不到合适的落脚点时，沿地图扫一遍补上
    const spots = [], okY = (x) => {
      const y = this.terrain.surfaceY(x);
      return y > 60 && y < WORLD.water - 14 && this.terrain.surfaceY(x - 8) > 0 && this.terrain.surfaceY(x + 8) > 0 ? y - R : -1;
    };
    for (let k = 0; k < nT * size; k++) {
      let found = false;
      for (let tries = 0; tries < 60 && !found; tries++) {
        const x = 90 + ((k + 0.5) / (nT * size)) * (W - 180) + (this.rnd() - 0.5) * 60, y = okY(x);
        if (y >= 0) { spots.push([x, y]); found = true; }
      }
      for (let x = 90 + (k % 7) * 3; x < W - 90 && !found; x += 7) {
        const y = okY(x);
        if (y >= 0 && spots.every((q) => Math.abs(q[0] - x) > 34)) { spots.push([x, y]); found = true; }
      }
    }
    for (let i = spots.length - 1; i > 0; i--) { const j = (this.rnd() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
    for (let t = 0; t < nT; t++) {
      const team = { id: t, def: TEAMS[t], beans: [], ai: t > 0 || !!o.allBots, next: 0, ammo: {} };
      for (const w of WEAPONS) team.ammo[w.id] = w.ammo;
      for (let i = 0; i < size; i++) {
        const sp = spots[t * size + i]; if (!sp) continue;
        const b = { id: this.beans.length, team: t, name: TEAMS[t].names[i], x: sp[0], y: sp[1], vx: 0, vy: 0, hp: RULES.hp, alive: true, ground: true, face: sp[0] < W / 2 ? 1 : -1, walking: false, wx: 0, deadT: 0, hitT: 0 };
        team.beans.push(b); this.beans.push(b);
      }
      this.teams.push(team);
    }
    this.turn = { team: -1, bean: null, state: 'settle', t: 0, weapon: 'bazooka', shots: 0, quiet: 0, ai: null };
  }

  emit(ev) { if (this.events.length < 500) this.events.push(ev); }
  /** 现在是不是轮到玩家操作 */
  get myTurn() { const t = this.turn; return !this.over && t.bean && !this.teams[t.team].ai && (t.state === 'aim' || t.state === 'retreat'); }
  teamHp(t) { let s = 0; for (const b of this.teams[t].beans) if (b.alive) s += b.hp; return s; }

  /* ------------------------------------------------------------ 伤害和爆炸 */
  hurt(b, n, kx = 0, ky = 0) {
    if (!b.alive) return;
    if (!(this.god && b.team === 0) && n > 0) { b.hp = Math.max(0, b.hp - Math.round(n)); this.emit({ type: 'dmg', b, n: Math.round(n) }); }
    b.vx += kx; b.vy += ky; b.hitT = 0.3;
    if (kx || ky) b.ground = false;
  }

  /** 爆炸：挖坑，范围内的豆兵按距离受伤并被炸飞 */
  explode(x, y, r, dmg) {
    this.terrain.carve(x, y, r);
    this.emit({ type: 'boom', x, y, r });
    for (const b of this.beans) {
      if (!b.alive) continue;
      const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy), reach = r + R + 4;
      if (d >= reach) { if (b.ground && !this.terrain.solid(b.x, b.y + R + 1)) b.ground = false; continue; }
      const k = 1 - d / reach, l = d || 1;
      this.hurt(b, Math.max(1, dmg * k), (dx / l) * k * 430, (dy / l) * k * 430 - 150 * k);
    }
  }

  /* ------------------------------------------------------------ 豆兵的物理 */
  updateBean(b, dt) {
    const T = this.terrain;
    if (!b.alive) { b.deadT += dt; return; }
    if (b.hitT > 0) b.hitT -= dt;
    if (b.ground) { if (!T.solid(b.x, b.y + R + 1)) b.ground = false; else return; }
    b.vy += PHYS.gravity * dt;
    const n = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 3));
    for (let s = 0; s < n; s++) {
      let nx = b.x + (b.vx * dt) / n, ny = b.y + (b.vy * dt) / n;
      if (b.vx && T.solid(nx + Math.sign(b.vx) * R * 0.8, b.y)) { b.vx = -b.vx * 0.25; nx = b.x; }              // 撞墙
      if (b.vy < 0 && T.solid(nx, ny - R)) { b.vy = 0; ny = b.y; }                                             // 撞顶
      if (b.vy >= 0 && T.solid(nx, ny + R)) {                                                                  // 落地
        while (T.solid(nx, ny + R - 1) && ny > 0) ny -= 1;
        const hit = b.vy;
        b.x = nx; b.y = ny;
        if (hit > PHYS.fallSafe) { this.hurt(b, Math.min(35, (hit - PHYS.fallSafe) / 9)); this.emit({ type: 'thud', x: b.x, y: b.y + R }); }
        if (Math.abs(b.vx) > 150 || hit > 520) { b.vy = -hit * 0.28; b.vx *= 0.6; }                             // 飞得太猛：弹一下
        else { b.ground = true; b.vx = b.vy = 0; }
        break;
      }
      b.x = nx; b.y = ny;
    }
    if (b.y > WORLD.water + 2 || b.x < -30 || b.x > W + 30) {                                                  // 掉进水里
      this.emit({ type: 'splash', x: b.x });
      if (this.god && b.team === 0 && b.safe) { b.x = b.safe[0]; b.y = b.safe[1]; b.vx = b.vy = 0; b.ground = false; return; }   // 无敌时回到上一个落脚点
      b.hp = 0; b.alive = false; b.drowned = true; this.emit({ type: 'die', b });
    }
  }

  /** 沿地面走一个像素。坡太陡走不上去；前面是悬崖就走下去 */
  step(b, dir) {
    const T = this.terrain, nx = b.x + dir;
    if (nx < 4 || nx > W - 4) return;
    for (let dy = -PHYS.climb; dy <= PHYS.climb + 2; dy++) {
      const cy = b.y + dy;
      if (!T.solid(nx, cy + R - 1) && T.solid(nx, cy + R) && !T.solid(nx, cy - R)) { b.x = nx; b.y = cy; return; }
    }
    if (!T.solid(nx, b.y + R) && !T.solid(nx, b.y)) { b.x = nx; b.ground = false; }
  }

  /** 当前行动的豆兵按输入走、跳 */
  control(b, inp, dt) {
    b.walking = false;
    if (!b.alive || !b.ground) return;
    b.safe = [b.x, b.y];
    if (inp.jump || inp.flip) {
      const v = inp.flip ? PHYS.flip : PHYS.jump;
      b.vx = v[0] * b.face; b.vy = v[1]; b.ground = false; b.y -= 1;
      this.emit({ type: 'jump', b });
    } else if (inp.move) {
      b.face = inp.move; b.walking = true;
      b.wx += PHYS.walk * dt;
      while (b.wx >= 1 && b.ground) { b.wx -= 1; this.step(b, inp.move); }
    }
    inp.jump = false; inp.flip = false;
  }

  /* ------------------------------------------------------------ 武器 */

  /** 玩家主动结束这个回合 */
  skip() { const t = this.turn; if (this.myTurn && t.state !== 'settle') { t.state = 'settle'; t.bean.walking = false; return true; } return false; }

  /** 选武器（没弹药的选不了） */
  selectWeapon(id) { const t = this.turn; if (this.teams[t.team].ammo[id] > 0 && t.state === 'aim' && !t.shots) { t.weapon = id; this.emit({ type: 'weapon', id }); return true; } return false; }

  /**
   * 开火。angle 是方向（弧度，屏幕坐标，向上为负）；power 0~1；target 是空袭/传送选的点。
   * 返回是否成功。
   */
  fire(angle, power = 1, target = null) {
    const t = this.turn, b = t.bean, team = this.teams[t.team], w = WEAPON[t.weapon];
    if (t.state !== 'aim' || !b.alive || team.ammo[w.id] <= 0) return false;
    if ((w.kind === 'strike' || w.kind === 'move') && !target) return false;
    const cx = Math.cos(angle), sy = Math.sin(angle), ox = b.x + cx * (R + 6), oy = b.y + sy * (R + 6), sp = w.speed * (0.22 + 0.78 * clamp(power, 0, 1));
    if (w.kind !== 'strike' && w.kind !== 'move') b.face = cx >= 0 ? 1 : -1;
    switch (w.kind) {
      case 'shell': this.shots.push({ id: w.id, x: ox, y: oy, vx: cx * sp, vy: sy * sp, r: w.r, dmg: w.dmg, wind: true, owner: b, age: 0 }); break;
      case 'bomb': this.shots.push({ id: w.id, x: ox, y: oy, vx: cx * sp, vy: sy * sp, r: w.r, dmg: w.dmg, bounce: true, fuse: w.fuse, split: w.split || 0, owner: b, age: 0 }); break;
      case 'drop': this.shots.push({ id: w.id, x: b.x + b.face * 6, y: b.y, vx: b.face * 25, vy: -40, r: w.r, dmg: w.dmg, bounce: true, fuse: w.fuse, owner: b, age: 0 }); break;
      case 'gun': {
        // 即时命中：沿方向一路查过去，碰到土或豆兵就停
        let x = ox, y = oy, hit = null;
        for (let d = 0; d < w.range; d += 2) {
          x = ox + cx * d; y = oy + sy * d;
          if (this.terrain.solid(x, y)) break;
          for (const o of this.beans) if (o.alive && o !== b && Math.hypot(o.x - x, o.y - y) < R + 1) { hit = o; break; }
          if (hit) break;
        }
        this.emit({ type: 'gun', x1: ox, y1: oy, x2: x, y2: y });
        if (hit) this.hurt(hit, w.dmg, cx * 170, sy * 170 - 60);
        this.terrain.carve(x, y, w.r); this.emit({ type: 'boom', x, y, r: w.r, small: true });
        break;
      }
      case 'strike': for (let i = 0; i < w.count; i++) this.shots.push({ id: 'missile', x: target.x + (i - (w.count - 1) / 2) * 30 - 60, y: -30 - i * 26, vx: 55, vy: 260, r: w.r, dmg: w.dmg, wind: true, owner: null, age: 0 }); break;
      case 'melee': {
        let any = false;
        for (const o of this.beans) if (o.alive && o !== b && Math.abs(o.y - b.y) < 22 && (o.x - b.x) * b.face > -4 && Math.abs(o.x - b.x) < 30) { this.hurt(o, w.dmg, b.face * 340, -300); any = true; }
        this.emit({ type: 'punch', b, any });
        break;
      }
      case 'move': {
        const T = this.terrain, x = clamp(target.x, 12, W - 12), y = clamp(target.y, 12, WORLD.water - 20);
        if (T.solid(x, y) || T.solid(x, y - R) || T.solid(x, y + R - 1)) { this.emit({ type: 'deny', text: '那里是实心的，换个空的地方' }); return false; }
        this.emit({ type: 'teleport', x1: b.x, y1: b.y, x2: x, y2: y });
        b.x = x; b.y = y; b.vx = b.vy = 0; b.ground = false;
        break;
      }
    }
    team.ammo[w.id]--;
    this.emit({ type: 'fire', id: w.id, b });
    // 霰弹枪一回合能打两枪；其余武器开火后进入撤退时间
    if (w.shots && (t.shots = (t.shots || w.shots) - 1) > 0) { t.t = Math.min(t.t, 10); return true; }
    t.shots = 0; t.state = 'retreat'; t.t = w.kind === 'melee' || w.kind === 'move' ? 0.6 : RULES.retreat;
    return true;
  }

  updateShots(dt) {
    const T = this.terrain;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.age += dt; s.px = s.x; s.py = s.y;
      let boom = false;
      if (!s.rest) {
        s.vy += PHYS.gravity * dt;
        if (s.wind) s.vx += this.wind * PHYS.wind * dt;
        const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 3));
        for (let k = 0; k < n && !boom; k++) {
          const nx = s.x + (s.vx * dt) / n, ny = s.y + (s.vy * dt) / n;
          if (T.solid(nx, ny)) {
            if (!s.bounce) { boom = true; break; }
            const [ax, ay] = T.normal(nx, ny), vn = s.vx * ax + s.vy * ay;
            if (vn < 0) { s.vx = (s.vx - 2 * vn * ax) * 0.55; s.vy = (s.vy - 2 * vn * ay) * 0.55; this.emit({ type: 'bounce', x: s.x, y: s.y }); }
            if (Math.hypot(s.vx, s.vy) < 28) { s.rest = true; s.vx = s.vy = 0; }
            break;
          }
          s.x = nx; s.y = ny;
          if (!s.bounce) for (const b of this.beans) if (b.alive && (b !== s.owner || s.age > 0.25) && Math.hypot(b.x - s.x, b.y - s.y) < R + 3) { boom = true; break; }
        }
      } else if (!T.solid(s.x, s.y + 3)) s.rest = false;                       // 脚下的土被炸没了：继续掉
      if (s.fuse !== undefined && (s.fuse -= dt) <= 0) boom = true;
      if (s.y > WORLD.water || s.x < -200 || s.x > W + 200) { this.emit({ type: 'splash', x: s.x }); this.shots.splice(i, 1); continue; }
      if (!boom) continue;
      this.shots.splice(i, 1);
      this.explode(s.x, s.y, s.r, s.dmg);
      for (let k = 0; k < (s.split || 0); k++) this.shots.push({ id: 'bomblet', x: s.x, y: s.y - 6, vx: (k - (s.split - 1) / 2) * 75 + (this.rnd() - 0.5) * 40, vy: -260 - this.rnd() * 120, r: 26, dmg: 24, bounce: false, owner: null, age: 0.3 });
    }
  }

  /* ------------------------------------------------------------ 电脑队伍 */

  /**
   * 模拟一发炮弹的飞行。步长、分步和积分顺序都和 updateShots 完全一致，所以预测的落点和真实落点吻合。
   * windOn：受不受风影响；trace：传入数组就把沿途的点记下来（预览线用）；maxT：最多模拟几秒。
   * 返回落点 [x, y]；飞出地图或超时返回 null。
   */
  flight(x, y, vx, vy, self, windOn = true, trace = null, maxT = 7) {
    const T = this.terrain, dt = 1 / TICK, wind = windOn ? this.wind * PHYS.wind : 0, foes = [];
    for (const b of this.beans) if (b.alive && b !== self) foes.push(b);
    let step = 0;
    for (let t = 0; t < maxT; t += dt) {
      vy += PHYS.gravity * dt; vx += wind * dt;
      const n = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 3));
      for (let k = 0; k < n; k++) {
        x += (vx * dt) / n; y += (vy * dt) / n;
        if (T.solid(x, y)) { if (trace) trace.push(x, y); return [x, y]; }
        if (t + dt > 0.25) for (let i = 0; i < foes.length; i++) { const b = foes[i]; if (Math.hypot(b.x - x, b.y - y) < R + 3) { if (trace) trace.push(x, y); return [x, y]; } }
      }
      if (trace && (step++ & 3) === 0) trace.push(x, y);
      if (y > WORLD.water || x < -100 || x > W + 100) return null;
    }
    return null;
  }

  simShell(x, y, vx, vy, self) { return this.flight(x, y, vx, vy, self, true); }

  /** 玩家瞄准时的预览线：返回 [x0, y0, x1, y1, …]，只画开头一小段（maxT 秒） */
  trajectory(weaponId, angle, power, maxT = 1.6) {
    const w = WEAPON[weaponId], b = this.turn.bean;
    if (!b || !w.power) return [];
    const cx = Math.cos(angle), sy = Math.sin(angle), sp = w.speed * (0.22 + 0.78 * clamp(power, 0, 1)), tr = [];
    this.flight(b.x + cx * (R + 6), b.y + sy * (R + 6), cx * sp, sy * sp, b, w.kind === 'shell', tr, maxT);
    return tr;
  }

  /** 电脑定计划：对每个敌人试各种角度和力度，挑落点最近、又不会炸到自己人的 */
  /** 一口气算完（测试用） */
  aiPlan(b) { const it = this.planGen(b); let r; while (!(r = it.next()).done); return r.value; }

  /** 分帧计算：每算 30 次模拟 yield 一次，由 aiUpdate 每个逻辑帧推进一步 */
  *planGen(b) {
    const foes = this.beans.filter((o) => o.alive && o.team !== b.team), pals = this.beans.filter((o) => o.alive && o.team === b.team);
    if (!foes.length) return { skip: true };
    const team = this.teams[b.team], w = WEAPON.bazooka;
    foes.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    // 贴身：直接出拳
    if (Math.abs(foes[0].x - b.x) < 26 && Math.abs(foes[0].y - b.y) < 20) return { weapon: 'punch', angle: foes[0].x > b.x ? 0 : Math.PI, power: 1 };
    let nSim = 0;
    const w0 = w.speed, score = (ang, p, f) => {
      nSim++;
      const sp = w0 * (0.22 + 0.78 * p);
      const hit = this.simShell(b.x + Math.cos(ang) * (R + 6), b.y + Math.sin(ang) * (R + 6), Math.cos(ang) * sp, Math.sin(ang) * sp, b);
      if (!hit) return null;
      let sc = Math.hypot(hit[0] - f.x, hit[1] - f.y) - (100 - f.hp) * 0.15;
      for (const o of pals) if (Math.hypot(hit[0] - o.x, hit[1] - o.y) < w.r + 26) sc += 300;       // 别炸到自己人
      return { score: sc, d: Math.hypot(hit[0] - f.x, hit[1] - f.y) };
    };
    let best = null;
    for (const f of foes.slice(0, 3)) {
      let coarse = null;
      for (let a = -175; a <= -5; a += 5) for (let p = 0.3; p <= 1.001; p += 0.07) {
        const ang = (a * Math.PI) / 180, r = score(ang, p, f);
        if (r && (!coarse || r.score < coarse.score)) coarse = { ...r, angle: ang, power: p, f };
        if (nSim % 30 === 0) yield;
      }
      if (!coarse) continue;
      // 细扫：在最好的角度和力度附近再找一遍
      for (let da = -2.5; da <= 2.5; da += 0.5) for (let dp = -0.035; dp <= 0.0351; dp += 0.007) {
        const ang = coarse.angle + (da * Math.PI) / 180, p = clamp(coarse.power + dp, 0.2, 1), r = score(ang, p, f);
        if (r && r.score < coarse.score) coarse = { ...r, angle: ang, power: p, f };
        if (nSim % 30 === 0) yield;
      }
      if (!best || coarse.score < best.score) best = coarse;
    }
    if (best && best.d < 34) return { weapon: 'bazooka', angle: best.angle, power: best.power };
    // 炮打不到：有空袭就用；否则朝最近的敌人走一段再打
    const f = foes[0];
    if (team.ammo.strike > 0 && this.terrain.surfaceY(f.x) >= f.y - 4) return { weapon: 'strike', target: { x: f.x - 55, y: f.y } };
    return { walk: f.x > b.x ? 1 : -1, walkT: 1.6, weapon: 'bazooka', angle: best ? best.angle : (f.x > b.x ? -0.9 : -2.25), power: best ? best.power : 0.8 };
  }

  aiUpdate(b, dt) {
    const t = this.turn, ai = t.ai || (t.ai = { think: this.diff.think * (0.8 + this.rnd() * 0.5), plan: null, walked: 0, jumpT: 0 });
    const inp = { move: 0, jump: false, flip: false };
    if (t.state === 'retreat') { this.control(b, inp, dt); return; }
    if (!ai.plan) {
      // 先“思考”一会儿，再分帧算瞄准；算的时候不阻塞画面
      if ((ai.think -= dt) <= 0) { const r = (ai.gen || (ai.gen = this.planGen(b))).next(); if (r.done) { ai.plan = r.value; ai.gen = null; } }
      this.control(b, inp, dt); return;
    }
    const p = ai.plan;
    if (p.skip) { t.state = 'settle'; return; }
    if (p.walk && ai.walked < p.walkT) {
      ai.walked += dt; inp.move = p.walk;
      const x0 = b.x; this.control(b, inp, dt);
      if (b.ground && b.x === x0 && (ai.jumpT -= dt) <= 0) { ai.jumpT = 0.6; this.control(b, { move: 0, jump: true, flip: false }, dt); }      // 被挡住了就跳
      if (ai.walked >= p.walkT) ai.plan = null, ai.gen = null, ai.think = 0.3, ai.replan = (ai.replan || 0) + 1;          // 走完重新找角度
      if (ai.replan > 1) ai.plan = { ...p, walk: 0 };
      return;
    }
    this.control(b, inp, dt);
    if (!b.ground) return;
    t.weapon = p.weapon;
    // 瞄准误差：难度越低越歪
    const ang = (p.angle || 0) + (this.rnd() - 0.5) * 2 * this.diff.aim, pow = clamp((p.power || 1) + (this.rnd() - 0.5) * 2 * this.diff.pow, 0.1, 1);
    if (!this.fire(ang, pow, p.target)) { t.weapon = 'bazooka'; this.fire(ang, pow); }
  }

  /* ------------------------------------------------------------ 回合流程 */
  nextTurn() {
    const alive = this.teams.filter((tm) => tm.beans.some((b) => b.alive));
    if (alive.length <= 1) { this.over = { winner: alive.length ? alive[0].id : -1 }; this.emit({ type: 'over', winner: this.over.winner }); return; }
    const t = this.turn;
    let ti = t.team;
    do { ti = (ti + 1) % this.teams.length; } while (!this.teams[ti].beans.some((b) => b.alive));
    const team = this.teams[ti];
    let b; do { b = team.beans[team.next % team.beans.length]; team.next++; } while (!b.alive);
    this.wind = Math.round((this.rnd() * 2 - 1) * 10) / 10;
    t.team = ti; t.bean = b; t.state = 'aim'; t.t = RULES.turnTime; t.shots = 0; t.ai = null; t.quiet = 0;
    if (team.ammo[t.weapon] <= 0 || team.ai) t.weapon = 'bazooka';
    this.emit({ type: 'turn', team: ti, b });
  }

  update(dt) {
    if (this.over) { for (const b of this.beans) this.updateBean(b, dt); return; }
    this.time += dt;
    const t = this.turn, b = t.bean;
    if (b && (t.state === 'aim' || t.state === 'retreat')) {
      if (!b.alive) t.state = 'settle';
      else {
        if (this.teams[t.team].ai) this.aiUpdate(b, dt); else this.control(b, this.input, dt);
        if ((t.t -= dt) <= 0) { t.state = 'settle'; b.walking = false; }
      }
    }
    for (const o of this.beans) this.updateBean(o, dt);
    this.updateShots(dt);
    if (t.state === 'settle') {
      // 等所有炮弹炸完、所有豆兵站稳，再结算阵亡，然后换下一队
      const busy = this.shots.length > 0 || this.beans.some((o) => o.alive && !o.ground);
      t.quiet = busy ? 0 : t.quiet + dt;
      if (t.quiet > 0.7) {
        const dead = this.beans.filter((o) => o.alive && o.hp <= 0);
        if (dead.length) {
          for (const o of dead) { o.alive = false; this.emit({ type: 'die', b: o }); this.explode(o.x, o.y, 26, 14); }
          t.quiet = 0;
        } else this.nextTurn();
      }
    }
  }
}
