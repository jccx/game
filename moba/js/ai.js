// 裂谷争锋：电脑英雄的 AI。
// 每个电脑英雄有一个 Brain：每隔一小段时间“思考”一次（定目标），每一帧“执行”（走位、出手）。
// AI 不直接改英雄的位置和血量，只往 hero.in 里填操作意图，和玩家用摇杆按键是同一个入口。
import { TOWER, HERO, TICK } from './config.js';
import { KIND } from './entities.js';
import { ITEMS } from './items.js';
import { pointAlong } from './maps.js';

/** 粗略的“战斗力”：血量为主，等级越高越强 */
const power = (u) => u.hp * (1 + u.level * 0.07);

export class Brain {
  constructor(hero, game) {
    this.h = hero; this.g = game;
    this.thinkT = Math.random() * 0.4;
    this.goal = 'lane';          // lane 对线 / farm 打兵 / fight 打人 / push 推塔 / jungle 打野 / retreat 撤退 / base 泉水回复 / back 后撤 / defend 回防
    this.focus = null;           // 当前要打的单位
    this.dest = null;            // 当前要去的地点
    this.path = null; this.pathI = 0; this.pathT = 0; this.pgx = 0; this.pgz = 0;
    this.jungler = game.map.id === '5v5' && hero.lane < 0;
    this.roamLane = 1;
    this.side = ((hero.id * 7) % 5 - 2) * 1.1;   // 站位的横向偏移，免得几个人叠在一起
    this.stuckT = 0; this.lx = hero.x; this.lz = hero.z; this.jitterT = 0; this.jx = 0; this.jz = 0;
    this.recalling = false;
  }

  /* ---------------------------------------------------------- 每帧入口 */
  update(dt) {
    const h = this.h, inn = h.in;
    inn.mx = 0; inn.mz = 0; inn.attack = false; inn.atkTarget = null; inn.atkMode = 0;
    if (!h.alive) { this.goal = 'lane'; this.path = null; this.recalling = false; return; }
    this.pathT -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.g.diff.think * (0.8 + Math.random() * 0.4);
      this.think();
    }
    this.act(dt);

    // 卡住检测：想走却 1 秒没怎么动，就重新寻路并随机挪一下
    if (inn.mx || inn.mz) {
      this.stuckT += dt;
      if (this.stuckT > 1) {
        if (Math.hypot(h.x - this.lx, h.z - this.lz) < 0.6) { this.path = null; this.jitterT = 0.35; const a = Math.random() * 6.283; this.jx = Math.cos(a); this.jz = Math.sin(a); }
        this.stuckT = 0; this.lx = h.x; this.lz = h.z;
      }
    } else { this.stuckT = 0; this.lx = h.x; this.lz = h.z; }
    if (this.jitterT > 0) { this.jitterT -= dt; inn.mx = this.jx; inn.mz = this.jz; }
  }

  /* ---------------------------------------------------------- 观察 */

  /** 正在威胁我的敌方防御塔（在它射程内，且没有己方小兵替我扛） */
  towerThreat(extra = 1.2) {
    const g = this.g, h = this.h;
    for (const t of g.towers.concat(g.crystals)) {
      if (!t.alive || t.team === h.team) continue;
      if (h.distTo(t) > t.range + h.radius + extra) continue;
      if (t.forceTarget === h || t.target === h) return t;
      let n = 0;
      for (const u of g.units) if (u.alive && u.kind === KIND.MINION && u.team === h.team && t.inRange(u)) n++;
      if (n === 0) return t;
    }
    return null;
  }

  /** 对线时该站的位置：己方兵线最前沿稍靠后；没有兵就守在己方最外面的塔下 */
  lanePos(L) {
    const g = this.g, h = this.h, T = h.team, dir = T === 0 ? 1 : -1, len = g.laneLen[L];
    let front = null;
    for (const u of g.units) {
      if (!u.alive || u.kind !== KIND.MINION || u.team !== T || u.lane !== L) continue;
      const d = g.laneProgress(L, u.x, u.z);
      if (front === null || (d - front) * dir > 0) front = d;
    }
    // 己方最外面的塔（没有兵时的驻守点），和敌方最外面的塔（没有兵时不能越过的安全线）
    let hold = T === 0 ? 8 : len - 8, limit = T === 0 ? len - 8 : 8;
    let holdSet = false, limitSet = false;
    for (const t of g.towers) {
      if (!t.alive || t.lane !== L) continue;
      const d = g.laneProgress(L, t.x, t.z);
      if (t.team === T) { if (!holdSet || (d - hold) * dir > 0) { hold = d; holdSet = true; } }
      else if (!limitSet || (d - limit) * dir < 0) { limit = d; limitSet = true; }
    }
    limit -= dir * (TOWER.range + 3);
    let want;
    if (front === null) want = hold - dir * 2;
    else {
      want = front - dir * (h.range > 5 ? 5.5 : 1.2);
      // 兵线还没到敌塔时，人不要先进塔
      let pushed = false;
      for (const u of g.units) if (u.alive && u.kind === KIND.MINION && u.team === T && u.lane === L && (g.laneProgress(L, u.x, u.z) - limit) * dir > 3) { pushed = true; break; }
      if (!pushed && (want - limit) * dir > 0) want = limit;
    }
    want = Math.max(4, Math.min(len - 4, want));
    const p = pointAlong(g.map.lanes[L].pts, want);
    return { x: p.x - p.dz * this.side, z: p.z + p.dx * this.side };
  }

  /* ---------------------------------------------------------- 思考：定目标 */
  think() {
    const g = this.g, h = this.h, inn = h.in, T = h.team, D = g.diff;
    const hpPct = h.hp / h.maxHp, mpPct = h.maxMp ? h.mp / h.maxMp : 1;
    const sp = g.map.teams[T].spawn;
    const atBase = h.dist2To(sp[0], sp[1]) < HERO.fountainRange * HERO.fountainRange;

    // 有钱就买推荐出装的下一件
    const next = h.nextBuild();
    if (next && h.gold >= ITEMS[next].cost) inn.buy = next;

    // 附近的敌我英雄和实力对比
    const foes = [], pals = [];
    for (const o of g.heroes) {
      if (!o.alive || o === h) continue;
      const d = h.distTo(o);
      if (o.team !== T) { if (d < 15 && g.targetable(o)) foes.push(o); } else if (d < 13) pals.push(o);
    }
    foes.sort((a, b) => h.distTo(a) - h.distTo(b));
    let myPow = power(h), foePow = 0;
    for (const p of pals) myPow += power(p) * 0.8;
    for (const f of foes) foePow += power(f);
    const threat = this.towerThreat();
    if (threat) foePow += 2600;
    for (const f of foes) for (const t of g.towers) if (t.alive && t.team === T && t.inRange(f, 1)) { myPow += 2200; break; }
    this.foes = foes; this.myPow = myPow; this.foePow = foePow;
    const nearFoe = foes[0] || null;
    const hurtRecently = g.time - h.lastDamagedT < 2.5;

    if (hpPct < 0.45 && h.healCd <= 0) inn.heal = true;

    // 1) 在泉水：回满再出门
    if (atBase && (hpPct < 0.9 || mpPct < 0.7) && !nearFoe) { this.goal = 'base'; this.recalling = false; return; }

    // 2) 残血撤退（已经在撤退时，回到七成血以上才重新出击）
    const low = hpPct < 0.3 || (hpPct < 0.42 && foePow > myPow * 1.1 && nearFoe);
    if (low || (this.goal === 'retreat' && hpPct < 0.7) || (mpPct < 0.08 && hpPct < 0.6 && h.maxMp > 0 && !nearFoe)) {
      this.goal = 'retreat'; this.dest = { x: sp[0], z: sp[1] };
      // 安全时原地回城，比走回去快
      const far = h.dist2To(sp[0], sp[1]) > 30 * 30;
      this.recalling = far && !hurtRecently && !threat && (!nearFoe || h.distTo(nearFoe) > 13);
      if (this.recalling && h.recallT <= 0) inn.recall = true;
      if (nearFoe && h.distTo(nearFoe) < 8 && Math.random() < D.combo) this.escape(nearFoe, hpPct);
      return;
    }
    this.recalling = false;

    // 3) 水晶被打：回防
    const cr = g.crystals[T];
    if (g.time - cr.lastDamagedT < 4 && h.distTo(cr) > 14) { this.goal = 'defend'; this.dest = { x: cr.x + (T ? -5 : 5), z: cr.z + (T ? 5 : -5) }; return; }

    // 4) 打人：实力占优，或对面残血
    if (nearFoe) {
      let e = null, best = 1e9;
      for (const f of foes) {
        const s = f.hp / f.maxHp * 3 + h.distTo(f) / 6 + f.hp / 3000;
        if (s < best) { best = s; e = f; }
      }
      const ePct = e.hp / e.maxHp, d = h.distTo(e);
      const brave = myPow * D.aggro >= foePow * 0.85 || (ePct < 0.22 && hpPct > 0.4);
      if (brave && (!threat || (ePct < 0.18 && hpPct > 0.6)) && d < h.range + 9) {
        this.goal = 'fight'; this.focus = e;
        if (Math.random() < D.combo) this.useSkills(e);
        return;
      }
      // 打不过：有人逼近就往后撤
      if (foePow > myPow * 1.35 && d < 9) {
        this.goal = 'back'; this.dest = this.backPoint();
        if (d < 5 && hpPct < 0.5 && Math.random() < D.combo) this.escape(e, hpPct);
        return;
      }
    }

    // 5) 站在敌塔射程里又没有兵扛：后撤
    if (threat) { this.goal = 'back'; this.dest = this.backPoint(threat); return; }

    // 6) 打野
    if (this.jungler || (this.goal === 'jungle' && this.focus && this.focus.alive)) {
      const m = this.pickCamp(hpPct);
      if (m) { this.goal = 'jungle'; this.focus = m; if (h.distTo(m) < 9 && Math.random() < D.combo) this.useSkills(m); return; }
    }

    // 7) 对线：推塔 > 打兵 > 跟着兵线走
    const L = h.lane >= 0 ? h.lane : this.roamLane;
    const tower = this.pushTarget();
    if (tower) { this.goal = 'push'; this.focus = tower; return; }
    let m = null, ms = 1e9, cnt = 0;
    for (const u of g.units) {
      if (!u.alive || u.kind !== KIND.MINION || u.team === T) continue;
      const d = h.distTo(u);
      if (d > h.range + 6.5) continue;
      cnt++;
      const s = d + (u.hp / u.maxHp) * 4;       // 优先打近的、残血的
      if (s < ms) { ms = s; m = u; }
    }
    if (m) {
      this.goal = 'farm'; this.focus = m;
      if (cnt >= 3 && mpPct > 0.5 && Math.random() < D.combo * 0.6) this.useSkills(m, true);
      return;
    }
    this.goal = 'lane'; this.dest = this.lanePos(L);
    // 打野的人野怪清完后，去人最少的那条路帮忙
    if (this.jungler && Math.random() < 0.05) this.roamLane = Math.floor(Math.random() * g.map.lanes.length);
  }

  /** 后撤点：沿着己方泉水方向退一段 */
  backPoint(from) {
    const h = this.h, sp = this.g.map.teams[h.team].spawn;
    const ox = from ? from.x : h.x, oz = from ? from.z : h.z;
    const dx = sp[0] - ox, dz = sp[1] - oz, d = Math.hypot(dx, dz) || 1;
    const k = from ? from.range + 4.5 : 9;
    return { x: ox + (dx / d) * k, z: oz + (dz / d) * k };
  }

  /** 可以推的敌方建筑：能被攻击、有己方小兵在它射程内、就在附近 */
  pushTarget() {
    const g = this.g, h = this.h;
    for (const t of g.towers.concat(g.crystals)) {
      if (t.team === h.team || !t.vuln) continue;
      if (h.distTo(t) > h.range + t.radius + 7) continue;
      let n = 0;
      for (const u of g.units) if (u.alive && u.kind === KIND.MINION && u.team === h.team && t.inRange(u, 1)) n++;
      if (n >= 1 && t.forceTarget !== h && t.target !== h) return t;
    }
    return null;
  }

  /** 选一个要打的野怪：己方半区活着的、最近的；等级高了也会去打巨灵 */
  pickCamp(hpPct) {
    const g = this.g, h = this.h;
    if (hpPct < 0.45) return null;
    let best = null, bd = 1e9;
    for (const cs of g.camps) {
      const m = cs.unit;
      if (!m || !m.alive) continue;
      const side = cs.camp.side;
      if (side === 2) { if (h.level < 8 || hpPct < 0.75) continue; } else if (side !== h.team) continue;
      const d = h.distTo(m) + (side === 2 ? 25 : 0);
      if (d < bd) { bd = d; best = m; }
    }
    return bd < 95 ? best : null;
  }

  /* ---------------------------------------------------------- 技能 */

  /** 给技能瞄准加一点误差（难度越低越歪），并填进操作意图 */
  castAt(i, x, z, target) {
    const h = this.h, inn = h.in, err = (Math.random() - 0.5) * 2 * this.g.diff.aimErr;
    const dx = x - h.x, dz = z - h.z, c = Math.cos(err), s = Math.sin(err);
    inn.cast = i; inn.aimX = h.x + dx * c + dz * s; inn.aimZ = h.z + dz * c - dx * s; inn.aimTarget = target || null;
  }

  /**
   * 对目标 e 尝试放一个技能（一次思考最多放一个）。clearing 为 true 表示是在清兵，不交大招。
   */
  useSkills(e, clearing = false) {
    const h = this.h, g = this.g;
    const isHero = e.isHero, d = h.distTo(e), ePct = e.hp / e.maxHp;
    const vx = (e.x - e.px) * TICK, vz = (e.z - e.pz) * TICK;      // 目标的速度，用来预判
    for (const i of [2, 0, 1]) {
      if (!h.canCast(i)) continue;
      const s = h.def.skills[i], ai = s.ai;
      if (ai.ult) {
        if (!isHero || clearing) continue;
        const many = this.foes && this.foes.length >= 2;
        if (ePct > (ai.ultHp || 0.5) && !(many && ai.type !== 'exec')) continue;
      }
      if (!isHero && !ai.clear && !ai.ult) continue;
      if (clearing && !ai.clear) continue;
      switch (ai.type) {
        case 'shot': {
          if (d > s.range * 0.92) break;
          const t = d / ai.speed;
          this.castAt(i, e.x + vx * t * 0.85, e.z + vz * t * 0.85); return;
        }
        case 'point': {
          if (d > s.range + ai.r * 0.4) break;
          const t = ai.delay || 0.3;
          this.castAt(i, e.x + vx * t * 0.8, e.z + vz * t * 0.8); return;
        }
        case 'self': {
          if (d - e.radius > ai.near) break;
          this.castAt(i, e.x, e.z); return;
        }
        case 'leap': {
          if (d > s.range + 1.5 || !isHero) break;
          if (this.myPow < this.foePow * 0.8 && ePct > 0.3) break;
          this.castAt(i, e.x + vx * 0.25, e.z + vz * 0.25); return;
        }
        case 'exec': {
          if (d > s.range || !isHero) break;
          this.castAt(i, e.x, e.z, e); return;
        }
        case 'dash': case 'blink': {
          if (!isHero) break;
          // 追击：对方在普攻够不着、但位移够得着的距离
          if (ai.engage && d > h.range + 1.5 && d < s.range + h.range && (this.myPow > this.foePow || ePct < 0.35)) { this.castAt(i, e.x, e.z); return; }
          // 射手被近身：朝远离对方的方向翻滚
          if (ai.kite && d < 4 && e.range < 5) { this.castAt(i, h.x - (e.x - h.x), h.z - (e.z - h.z)); return; }
          break;
        }
      }
    }
  }

  /** 逃跑：用位移技能朝泉水方向跑；血量很低时交闪现 */
  escape(e, hpPct) {
    const h = this.h, inn = h.in, sp = this.g.map.teams[h.team].spawn;
    let dx = sp[0] - h.x, dz = sp[1] - h.z;
    const wp = this.path && this.path[this.pathI];
    if (wp) { dx = wp[0] - h.x; dz = wp[1] - h.z; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (const i of [0, 1]) {
      const ai = h.def.skills[i].ai;
      if (ai.escape && h.canCast(i)) { inn.cast = i; inn.aimX = h.x + dx * 10; inn.aimZ = h.z + dz * 10; return; }
      if (ai.defensive && h.canCast(i) && hpPct < 0.5) { inn.cast = i; inn.aimX = h.x; inn.aimZ = h.z; return; }
    }
    if (hpPct < 0.2 && h.flashCd <= 0 && h.distTo(e) < 6.5) { inn.flash = true; inn.mx = dx; inn.mz = dz; }
  }

  /* ---------------------------------------------------------- 执行：走位和出手 */

  /** 沿寻路结果走向 (x, z)。到了返回 true */
  moveTo(x, z, stop = 0.7) {
    const h = this.h;
    if (Math.hypot(x - h.x, z - h.z) <= stop) return true;
    if (!this.path || this.pathT <= 0 || Math.hypot(x - this.pgx, z - this.pgz) > 2.5) {
      this.path = this.g.world.findPath(h.x, h.z, x, z);
      this.pathI = 0; this.pathT = 0.9 + Math.random() * 0.5; this.pgx = x; this.pgz = z;
    }
    let wp = this.path[this.pathI];
    while (wp && this.pathI < this.path.length - 1 && Math.hypot(wp[0] - h.x, wp[1] - h.z) < 1) wp = this.path[++this.pathI];
    if (!wp) wp = [x, z];
    const dx = wp[0] - h.x, dz = wp[1] - h.z, l = Math.hypot(dx, dz) || 1;
    h.in.mx = dx / l; h.in.mz = dz / l;
    return false;
  }

  /** 攻击一个单位：够得着就打，够不着就靠近 */
  engage(u, kite) {
    const h = this.h, inn = h.in, d = h.distTo(u) - u.radius;
    const reach = h.range + (h.nextAtk ? h.nextAtk.range || 0 : 0);
    if (kite && h.range > 5 && d < h.range * 0.4 && h.atkCd > 0.3 && h.atkWind <= 0 && u.range < 5) {
      // 远程被近战贴脸：出手间隙往后拉
      const dx = h.x - u.x, dz = h.z - u.z, l = Math.hypot(dx, dz) || 1;
      inn.mx = dx / l; inn.mz = dz / l;
      return;
    }
    if (d > reach + 3 || (d > reach && !this.g.world.los(h.x, h.z, u.x, u.z))) { this.moveTo(u.x, u.z, reach * 0.8); return; }
    inn.attack = true; inn.atkTarget = u;
  }

  act() {
    const h = this.h, g = this.g, f = this.focus;
    switch (this.goal) {
      case 'base': break;                                   // 站着回血
      case 'retreat':
        if (this.recalling && h.recallT > 0) break;         // 正在回城，别动
        this.moveTo(this.dest.x, this.dest.z, 2);
        break;
      case 'back': case 'defend': case 'lane':
        if (this.dest) this.moveTo(this.dest.x, this.dest.z, this.goal === 'lane' ? 1.2 : 1);
        break;
      case 'fight':
        if (!f || !f.alive || !g.targetable(f)) { this.goal = 'lane'; this.thinkT = 0; break; }
        this.engage(f, true);
        break;
      case 'farm': case 'push': case 'jungle':
        if (!f || !f.alive || !g.targetable(f)) { this.thinkT = 0; break; }
        if (this.goal === 'jungle' && h.distTo(f) > h.range + 6) this.moveTo(f.x, f.z, h.range);
        else this.engage(f, false);
        break;
    }
  }
}
