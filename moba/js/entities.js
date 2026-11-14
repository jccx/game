// 裂谷争锋：所有单位的逻辑——英雄、小兵、防御塔、水晶、野怪。纯逻辑，不依赖渲染。
// 朝向约定：face 是弧度，朝向向量为 (sin(face), cos(face))。
import { MINION, TOWER, CRYSTAL, MONSTER, BUFFS, ECON, HERO } from './config.js';
import { clamp } from '../../shared/js/util.js';
import { ITEMS, MAX_ITEMS, BUILDS } from './items.js';

let NEXT_ID = 1;

/** 单位种类（位标志，便于按种类筛选） */
export const KIND = { HERO: 1, MINION: 2, MONSTER: 4, TOWER: 8, CRYSTAL: 16 };
export const STRUCT = KIND.TOWER | KIND.CRYSTAL;

/* ------------------------------------------------------------------ 基类 */
export class Unit {
  constructor(game, kind, team, x, z) {
    this.game = game; this.id = NEXT_ID++; this.kind = kind; this.team = team;
    this.x = x; this.z = z; this.px = x; this.pz = z;   // px/pz 是上一逻辑帧的位置，渲染时用来插值
    this.face = team === 0 ? 2.2 : -0.9;
    this.radius = 0.8;
    this.maxHp = 1; this.hp = 1; this.maxMp = 0; this.mp = 0;
    this.ad = 0; this.ap = 0; this.armor = 0; this.mr = 0; this.as = 1; this.range = 2; this.ms = 0;
    this.pen = 0; this.mpen = 0; this.crit = 0; this.lifesteal = 0;
    this.projSpeed = 0;            // 大于 0 表示远程，普攻会发射投射物
    this.alive = true;
    this.target = null;
    this.atkCd = 0;                // 距离下次可以出手的时间
    this.atkWind = 0;              // 出手前摇剩余时间，大于 0 表示正在出手
    this.atkTarget = null;
    this.atkSeq = 0;               // 每出手一次加一，渲染层据此播放攻击动作
    this.stunT = 0; this.slowT = 0; this.slowK = 1;
    this.shield = 0; this.shieldT = 0; this.invulnT = 0;
    this.moving = false;
    this.lastDamagedT = -99;
    this.dmgTakenMul = 1;
    this.deadT = 0;                // 死亡后经过的时间（小兵尸体停留一会儿再移除）
  }

  get isHero() { return this.kind === KIND.HERO; }
  get isStruct() { return (this.kind & STRUCT) !== 0; }
  get moveSpeed() { return this.ms * (this.slowT > 0 ? this.slowK : 1); }
  distTo(u) { return Math.hypot(u.x - this.x, u.z - this.z); }
  dist2To(x, z) { return (x - this.x) * (x - this.x) + (z - this.z) * (z - this.z); }
  /** 目标是否在普攻距离内（算上对方体积） */
  inRange(u, extra = 0) {
    const r = this.range + u.radius + extra;
    return this.dist2To(u.x, u.z) <= r * r;
  }
  faceTo(x, z) { if (x !== this.x || z !== this.z) this.face = Math.atan2(x - this.x, z - this.z); }

  /** 各种计时器倒数 */
  tickTimers(dt) {
    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shield = 0; }
  }

  /** 眩晕（击飞也按眩晕处理） */
  stun(d) {
    if (!this.alive || this.invulnT > 0 || this.isStruct) return;
    this.stunT = Math.max(this.stunT, d);
    this.atkWind = 0;
  }
  /** 减速：k 是速度倍率（0.6 表示减速 40%） */
  slow(k, d) {
    if (!this.alive || this.isStruct) return;
    if (this.slowT <= 0 || k < this.slowK) this.slowK = k;
    this.slowT = Math.max(this.slowT, d);
  }
  addShield(amount, d) { this.shield = Math.max(this.shield, amount); this.shieldT = d; }

  /** 朝一个点走一步。返回是否已到达 */
  stepToward(tx, tz, dt, stop = 0.05) {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d <= stop) return true;
    const s = Math.min(this.moveSpeed * dt, d - stop * 0.5);
    this.x += (dx / d) * s; this.z += (dz / d) * s;
    this.face = Math.atan2(dx, dz);
    this.moving = true;
    return false;
  }

  /** 出手前摇时间 */
  windup() { return Math.min(0.28, 0.3 / this.as); }

  /**
   * 普攻状态机，每帧调用。target 为想打的目标（可为 null，只推进已经开始的前摇）。
   * 返回 true 表示这一帧在出手（调用方不应再移动）。
   */
  attack(target, dt) {
    if (this.atkWind > 0) {
      const t = this.atkTarget;
      if (!t || !t.alive) { this.atkWind = 0; this.atkCd = Math.min(this.atkCd, 0.12); return false; }
      this.atkWind -= dt;
      this.faceTo(t.x, t.z);
      if (this.atkWind <= 0) { this.atkWind = 0; this.fireAttack(t); }
      return true;
    }
    if (this.atkCd > 0 || !target || !target.alive) return false;
    if (!this.inRange(target, 0.25)) return false;
    this.atkTarget = target;
    this.atkWind = this.windup();
    this.atkCd = 1 / this.as;
    this.atkSeq++;
    this.faceTo(target.x, target.z);
    return true;
  }

  /** 前摇结束：近战直接结算，远程发射追踪投射物 */
  fireAttack(t) {
    if (this.projSpeed > 0) this.game.homing(this, t, this.projSpeed, (u) => this.onAttackLand(u), this.projKind || 'shot');
    else this.onAttackLand(t);
  }

  /** 普攻命中时的结算（子类可覆盖以加入被动效果） */
  onAttackLand(t) {
    this.game.damage(this, t, this.ad, 'phys', { attack: true });
  }

  update() {}
}

/* ------------------------------------------------------------------ 小兵 */
export class Minion extends Unit {
  /**
   * @param {string} type melee / ranged / siege
   * @param {number} lane 兵线编号
   * @param {number} wi   下一个路径点的下标
   * @param {number} off  相对兵线中线的横向偏移，让一波兵排开
   */
  constructor(game, team, type, lane, x, z, wi, off) {
    super(game, KIND.MINION, team, x, z);
    const c = MINION[type], k = (game.time / 60) * game.pace.grow;
    this.type = type; this.lane = lane; this.wi = wi; this.off = off;
    this.cfg = c;
    // 超级兵：对方这一路已经没有塔了
    this.isSuper = !game.towers.some((t) => t.alive && t.team !== team && t.lane === lane);
    this.maxHp = this.hp = Math.round(c.hp * (1 + MINION.hpGrow * k) * (this.isSuper ? MINION.superHp : 1));
    this.ad = c.ad * (1 + MINION.adGrow * k) * (this.isSuper ? MINION.superAd : 1);
    this.armor = c.armor; this.mr = c.mr; this.as = c.as; this.range = c.range; this.ms = c.ms; this.radius = c.radius;
    this.projSpeed = c.projSpeed || 0;
    this.projKind = type === 'siege' ? 'shell' : 'shot';
    this.acq = Math.random() * 0.3;   // 错开各小兵的索敌时间
  }

  onAttackLand(t) {
    const mul = t.isStruct && this.cfg.vsTower ? this.cfg.vsTower : 1;
    this.game.damage(this, t, this.ad * mul, 'phys', { attack: true });
  }

  update(dt) {
    this.tickTimers(dt);
    this.moving = false;
    if (this.stunT > 0) return;
    if (this.attack(null, dt)) return;           // 正在出手
    // 定期重新索敌
    this.acq -= dt;
    const tg = this.target;
    if (this.acq <= 0 || !tg || !tg.alive || !this.game.targetable(tg, this)) {
      this.acq = 0.3;
      this.target = this.game.findTarget(this, this.cfg.aggro, KIND.MINION | KIND.HERO | STRUCT, 3);
    }
    const t = this.target;
    if (t) {
      if (this.inRange(t)) this.attack(t, dt);
      else this.stepToward(t.x, t.z, dt);
      return;
    }
    // 没有敌人：沿兵线前进
    const pts = this.game.lanePts[this.lane], dir = this.team === 0 ? 1 : -1;
    let p = pts[this.wi];
    if (!p) return;
    let tx = p.x + p.nx * this.off, tz = p.z + p.nz * this.off;
    if (this.dist2To(tx, tz) < 6.25) {
      const ni = this.wi + dir;
      if (ni >= 0 && ni < pts.length) { this.wi = ni; p = pts[ni]; tx = p.x + p.nx * this.off; tz = p.z + p.nz * this.off; }
    } else if (this.dist2To(tx, tz) > 180) {
      // 追人追远了：改走最近的路径点
      this.wi = this.game.nearestLaneIndex(this.lane, this.x, this.z);
    }
    this.stepToward(tx, tz, dt, 0.3);
  }
}

/* ------------------------------------------------------------------ 防御塔 */
export class Tower extends Unit {
  constructor(game, team, lane, tier, x, z) {
    super(game, KIND.TOWER, team, x, z);
    this.lane = lane; this.tier = tier;
    this.maxHp = this.hp = Math.round(TOWER.hp[tier] * game.pace.towerHp);
    this.ad = TOWER.ad[tier];
    this.armor = TOWER.armor; this.mr = TOWER.mr; this.as = TOWER.as; this.range = TOWER.range; this.radius = TOWER.radius;
    this.projSpeed = TOWER.projSpeed; this.projKind = 'tower';
    this.forceTarget = null;    // 有敌方英雄在塔下攻击己方英雄时，塔转火这个英雄
    this.rampN = 0;             // 连续攻击同一个英雄的次数
    this.acq = 0;
  }

  /** 是否可以被攻击：外塔没倒之前，后面的塔无敌 */
  vulnerable() {
    if (this.tier <= 1) return true;
    const g = this.game;
    for (const t of g.towers) if (t.team === this.team && t.lane === this.lane && t.tier === this.tier - 1 && t.alive) return false;
    return true;
  }

  windup() { return 0.2; }

  onAttackLand(t) {
    let dmg = this.ad;
    if (t.isHero) { dmg *= Math.min(TOWER.heroRampMax, 1 + TOWER.heroRamp * this.rampN); this.rampN++; }
    else if (t.kind === KIND.MINION) dmg *= t.type === 'siege' ? 0.6 : 1;
    this.game.damage(this, t, dmg, 'phys', { attack: true, tower: true });
  }

  update(dt) {
    this.tickTimers(dt);
    if (this.attack(null, dt)) return;
    const g = this.game;
    let t = this.target;
    const ft = this.forceTarget;
    if (ft && ft.alive && this.inRange(ft) && g.targetable(ft, this)) {
      if (t !== ft) { t = this.target = ft; this.rampN = 0; }
    } else {
      this.forceTarget = null;
      this.acq -= dt;
      if (!t || !t.alive || !this.inRange(t) || !g.targetable(t, this) || this.acq <= 0) {
        this.acq = 0.25;
        // 优先打小兵，没有小兵才打英雄
        const keep = t && t.alive && this.inRange(t) && g.targetable(t, this) ? t : null;
        const nt = keep || g.findTarget(this, this.range, KIND.MINION, 0) || g.findTarget(this, this.range, KIND.HERO, 0);
        if (nt !== t) { this.rampN = 0; t = this.target = nt; }
      }
    }
    if (t) this.attack(t, dt);
  }
}

/* ------------------------------------------------------------------ 水晶 */
export class Crystal extends Tower {
  constructor(game, team, x, z) {
    super(game, team, -1, 9, x, z);
    this.kind = KIND.CRYSTAL;
    this.maxHp = this.hp = Math.round(CRYSTAL.hp * game.pace.towerHp);
    this.ad = CRYSTAL.ad; this.armor = CRYSTAL.armor; this.mr = CRYSTAL.mr; this.as = CRYSTAL.as;
    this.range = CRYSTAL.range; this.radius = CRYSTAL.radius;
  }
  /** 任意一路的塔全部被拆，水晶才能被攻击 */
  vulnerable() {
    const g = this.game, lanes = g.map.lanes.length;
    for (let l = 0; l < lanes; l++) {
      let any = false;
      for (const t of g.towers) if (t.team === this.team && t.lane === l && t.alive) { any = true; break; }
      if (!any) return true;
    }
    return false;
  }
  update(dt) {
    if (this.hp < this.maxHp && this.game.time - this.lastDamagedT > 8) this.hp = Math.min(this.maxHp, this.hp + CRYSTAL.regen * dt);
    super.update(dt);
  }
}

/* ------------------------------------------------------------------ 野怪 */
export class Monster extends Unit {
  constructor(game, camp) {
    super(game, KIND.MONSTER, 2, camp.x, camp.z);
    const c = MONSTER[camp.kind], k = game.time / 60;
    this.camp = camp; this.cfg = c; this.type = camp.kind;
    this.homeX = camp.x; this.homeZ = camp.z;
    this.maxHp = this.hp = Math.round(c.hp * (1 + MONSTER.hpGrow * k));
    this.ad = c.ad * (1 + MONSTER.hpGrow * k);
    this.armor = c.armor; this.mr = c.mr; this.as = c.as; this.range = c.range; this.ms = c.ms; this.radius = c.radius;
    this.aggro = null;          // 正在追打的目标
    this.returning = false;     // 脱战回营中
    this.face = Math.random() * 6.28;
  }

  update(dt) {
    this.tickTimers(dt);
    this.moving = false;
    if (this.stunT > 0) return;
    if (this.returning) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
      if (this.stepToward(this.homeX, this.homeZ, dt, 0.3)) this.returning = false;
      return;
    }
    if (this.attack(null, dt)) return;
    const t = this.aggro;
    if (!t) return;
    const far = Math.hypot(this.x - this.homeX, this.z - this.homeZ) > this.cfg.leash;
    if (!t.alive || far || !this.game.targetable(t, this)) { this.aggro = null; this.returning = true; return; }
    if (this.inRange(t)) this.attack(t, dt);
    else this.stepToward(t.x, t.z, dt);
  }
}

/* ------------------------------------------------------------------ 英雄 */
export class Hero extends Unit {
  /**
   * @param {object} def 英雄定义（见 heroes/ 目录）
   * @param {boolean} isPlayer 是否由玩家操控
   */
  constructor(game, def, team, x, z, isPlayer) {
    super(game, KIND.HERO, team, x, z);
    this.def = def; this.isPlayer = isPlayer;
    this.radius = HERO.radius;
    this.level = 1; this.exp = 0; this.gold = ECON.startGold; this.totalGold = ECON.startGold;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.streak = 0;
    this.items = [];
    this.skillLv = [0, 0, 0]; this.skillPts = 1; this.cds = [0, 0, 0];
    this.skillPtT = 0;             // 技能点闲置时间（玩家太久没加点时自动加）
    this.flashCd = 0; this.healCd = 0; this.healT = 0;
    this.recallT = 0; this.respawnT = 0;
    this.buffs = [];               // 临时属性加成：{key, t, ad, ap, armor, mr, asPct, msPct}
    this.redT = 0; this.blueT = 0; // 野怪增益剩余时间
    this.dmgFrom = new Map();      // 敌方英雄 → 最近一次对我造成伤害的时间（算助攻）
    this.dash = null;              // 位移中：{dx, dz, speed, left, ...}
    this.castLock = 0;             // 施法僵直剩余时间
    this.castSeq = 0; this.castIdx = -1;
    this.lastAttackT = -99;        // 最近一次攻击/被攻击的时间（脱战判定）
    this.ps = {};                  // 被动技能的状态，由英雄定义自己使用
    this.nextAtk = null;           // 强化下一次普攻：{bonus, crit, slow, slowDur, range, t}
    this.brain = null;             // 电脑 AI（玩家为 null）
    this.cdr = 0; this.hpRegen = 0; this.mpRegen = 0;
    this.projSpeed = def.base.projSpeed || 0;
    this.projKind = def.projKind || 'shot';
    // 本帧的操作意图，由玩家输入或 AI 填写，update 里统一执行
    this.in = { mx: 0, mz: 0, attack: false, atkMode: 0, atkTarget: null, cast: -1, aimX: 0, aimZ: 0, aimTarget: null, flash: false, heal: false, recall: false, lvUp: -1, buy: null };
    this.recalc();
    this.hp = this.maxHp; this.mp = this.maxMp;
  }

  /* ---------- 属性 ---------- */

  /** 根据等级、装备、增益重新计算全部属性 */
  recalc() {
    const b = this.def.base, L = this.level - 1;
    let hp = b.hp + b.hpG * L, mp = b.mp + b.mpG * L, ad = b.ad + b.adG * L, ap = (b.ap || 0) + (b.apG || 0) * L;
    let armor = b.armor + b.armorG * L, mr = b.mr + b.mrG * L, asPct = b.asG * L, ms = b.ms, msPct = 0;
    let crit = 0, ls = 0, cdr = 0, pen = 0, mpen = 0, hpRegen = 8 + L * 1.2, mpRegen = 5 + L * 0.5;
    for (const id of this.items) {
      const it = ITEMS[id];
      hp += it.hp || 0; mp += it.mp || 0; ad += it.ad || 0; ap += it.ap || 0; armor += it.armor || 0; mr += it.mr || 0;
      asPct += it.asPct || 0; ms += it.ms || 0; crit += it.crit || 0; ls += it.lifesteal || 0; cdr += it.cdr || 0;
      pen = 1 - (1 - pen) * (1 - (it.pen || 0)); mpen = 1 - (1 - mpen) * (1 - (it.mpen || 0));
      hpRegen += it.hpRegen || 0; mpRegen += it.mpRegen || 0;
    }
    for (const f of this.buffs) {
      ad += f.ad || 0; ap += f.ap || 0; armor += f.armor || 0; mr += f.mr || 0; asPct += f.asPct || 0; msPct += f.msPct || 0;
    }
    if (this.blueT > 0) { mpRegen += BUFFS.blue.mpRegen; cdr += BUFFS.blue.cdr; }
    const dHp = hp - this.maxHp, dMp = mp - this.maxMp;
    this.maxHp = hp; this.maxMp = mp;
    if (this.alive) { if (dHp > 0) this.hp += dHp; if (dMp > 0) this.mp += dMp; }
    this.hp = Math.min(this.hp, hp); this.mp = Math.min(this.mp, mp);
    this.ad = ad; this.ap = ap; this.armor = armor; this.mr = mr;
    this.as = Math.min(2.5, b.as * (1 + asPct));
    this.ms = ms * (1 + msPct);
    this.range = b.range;
    this.crit = Math.min(1, crit); this.lifesteal = ls; this.cdr = Math.min(HERO.cdrMax, cdr);
    this.pen = pen; this.mpen = mpen; this.hpRegen = hpRegen; this.mpRegen = mpRegen;
    this.dmgTakenMul = 1;
  }

  /** 添加/刷新一个临时增益 */
  addBuff(key, dur, mods) {
    const i = this.buffs.findIndex((f) => f.key === key);
    const f = { key, t: dur, ...mods };
    if (i >= 0) this.buffs[i] = f; else this.buffs.push(f);
    this.recalc();
  }
  hasBuff(key) { return this.buffs.some((f) => f.key === key); }

  gainGold(n) { this.gold += n; this.totalGold += n; }

  gainExp(n) {
    if (this.level >= ECON.maxLevel) return;
    this.exp += n;
    while (this.level < ECON.maxLevel && this.exp >= ECON.expNeed(this.level)) {
      this.exp -= ECON.expNeed(this.level);
      this.level++; this.skillPts++;
      this.recalc();
      this.game.emit({ type: 'levelup', u: this });
    }
    if (this.level >= ECON.maxLevel) this.exp = 0;
  }

  /** 第 i 个技能现在能否升级 */
  canLevel(i) {
    if (this.skillPts <= 0 || this.skillLv[i] >= HERO.skillMax[i]) return false;
    if (i === 2) return this.level >= HERO.ultLevels[this.skillLv[2]];
    return this.skillLv[i] < Math.ceil(this.level / 2);
  }
  levelSkill(i) {
    if (!this.canLevel(i)) return false;
    this.skillLv[i]++; this.skillPts--; this.skillPtT = 0;
    return true;
  }
  /** 自动加点：优先大招，其次按英雄定义的顺序 */
  autoLevel() {
    const order = [2, ...(this.def.skillOrder || [0, 1])];
    for (let guard = 0; guard < 4 && this.skillPts > 0; guard++) {
      let done = false;
      for (const i of order) if (this.levelSkill(i)) { done = true; break; }
      if (!done) break;
    }
  }

  /** 购买装备 */
  buy(id) {
    const it = ITEMS[id];
    if (!it || this.gold < it.cost || this.items.length >= MAX_ITEMS || this.items.includes(id)) return false;
    this.gold -= it.cost; this.items.push(id);
    this.recalc();
    this.game.emit({ type: 'buy', u: this, id });
    return true;
  }
  /** 推荐出装里下一件还没买的 */
  nextBuild() {
    for (const id of BUILDS[this.def.id]) if (!this.items.includes(id)) return id;
    return null;
  }

  /* ---------- 技能 ---------- */

  skillCost(i) { const c = this.def.skills[i].cost; return c[Math.max(0, this.skillLv[i] - 1)] || 0; }
  canCast(i) {
    return this.alive && this.skillLv[i] > 0 && this.cds[i] <= 0 && this.mp >= this.skillCost(i) &&
      this.stunT <= 0 && !this.dash && this.castLock <= 0;
  }

  /**
   * 释放技能。aim = {x, z, target?} 是瞄准点（世界坐标）；会被限制在技能射程内。
   */
  cast(i, aim) {
    if (!this.canCast(i)) return false;
    const s = this.def.skills[i], lv = this.skillLv[i];
    let dx = aim.x - this.x, dz = aim.z - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = Math.sin(this.face); dz = Math.cos(this.face); d = 1e-3; } else { dx /= d; dz /= d; }
    const cd = Math.min(d, s.range);
    const a = { x: this.x + dx * cd, z: this.z + dz * cd, dx, dz, dist: cd, target: aim.target || null };
    this.mp -= this.skillCost(i);
    this.cds[i] = s.cd[lv - 1] * (1 - this.cdr);
    if (s.aim !== 'self') this.face = Math.atan2(dx, dz);
    this.castSeq++; this.castIdx = i;
    this.castLock = s.castTime ?? 0.18;
    this.atkWind = 0; this.recallT = 0;
    this.lastAttackT = this.game.time;
    this.game.emit({ type: 'cast', u: this, skill: i });
    s.cast(this, a, this.game, lv);
    return true;
  }

  /** 开始位移。o: {dx, dz, dist, speed, hitR, mask, onHit(u), stopOnHero, onEnd()} */
  startDash(o) {
    this.dash = { dx: o.dx, dz: o.dz, speed: o.speed, left: o.dist, total: o.dist, jump: !!o.jump, hitR: o.hitR || 0, mask: o.mask || (KIND.HERO | KIND.MINION | KIND.MONSTER), onHit: o.onHit, stopOnHero: !!o.stopOnHero, onEnd: o.onEnd, hit: new Set(), untarget: !!o.untarget };
    this.atkWind = 0; this.recallT = 0;
    if (o.untarget) this.invulnT = Math.max(this.invulnT, o.dist / o.speed + 0.1);
  }

  /** 瞬移：沿方向最多 dist，落点不能在墙里（否则往回找） */
  blink(dx, dz, dist) {
    const w = this.game.world;
    for (let d = dist; d > 0; d -= 0.5) {
      const x = this.x + dx * d, z = this.z + dz * d;
      if (!w.solidAt(x, z, this.radius * 0.6)) { this.x = x; this.z = z; break; }
    }
    this.px = this.x; this.pz = this.z;     // 不插值，直接出现在落点
    this.atkWind = 0; this.recallT = 0;
  }

  /* ---------- 普攻 ---------- */

  /**
   * 选择普攻目标。mode：0 智能（英雄优先）、1 只打小兵和野怪、2 只打建筑。
   */
  pickTarget(mode) {
    const g = this.game, R = this.range + 5.5;
    let best = null, bs = 1e9;
    for (const u of g.units) {
      if (!u.alive || u.team === this.team || !g.targetable(u, this)) continue;
      const k = u.kind;
      if (mode === 1 && !(k & (KIND.MINION | KIND.MONSTER))) continue;
      if (mode === 2 && !(k & STRUCT)) continue;
      const d = this.distTo(u) - u.radius;
      if (d > R) continue;
      let s = d;
      if (mode === 0) {
        if (k === KIND.HERO) s -= d <= this.range + 2 ? 100 : 6;
        else if (k & STRUCT) s += 8;
        else if (k === KIND.MONSTER && !u.aggro && d > this.range) s += 30;   // 不主动招惹远处没开打的野怪
      }
      if (u === this.target) s -= 2.5;                                          // 尽量不换目标
      if (s < bs) { bs = s; best = u; }
    }
    return best;
  }

  onAttackLand(t) {
    const g = this.game, def = this.def;
    let dmg = this.ad, crit = false;
    const na = this.nextAtk;
    if (this.crit > 0 && Math.random() < this.crit) crit = true;
    if (na) {
      if (na.crit) crit = true;
      dmg += na.bonus || 0;
      if (na.slow) t.slow(na.slow, na.slowDur || 1.5);
      this.nextAtk = null;
    }
    if (crit) dmg *= 1.8;
    if (def.onAttack) dmg = def.onAttack(this, t, dmg, g) ?? dmg;       // 被动
    g.damage(this, t, dmg, 'phys', { attack: true, crit });
    if (this.redT > 0 && t.alive && !t.isStruct) {                        // 炎甲之力：灼烧并减速
      g.damage(this, t, Math.min(t.maxHp * BUFFS.red.burn, 150), 'true', { silent: true });
      t.slow(1 - BUFFS.red.slow, 1);
    }
    this.lastAttackT = g.time;
  }

  /* ---------- 死亡与复活 ---------- */

  die() {
    this.alive = false; this.hp = 0;
    this.deaths++; this.streak = 0;
    this.respawnT = (HERO.respawnBase + this.level * HERO.respawnPerLevel) * this.game.respawnMul;
    this.dash = null; this.atkWind = 0; this.recallT = 0; this.castLock = 0; this.healT = 0;
    this.stunT = 0; this.slowT = 0; this.shield = 0; this.nextAtk = null;
    this.redT = 0; this.blueT = 0; this.buffs.length = 0;
    this.target = null;
    this.recalc();
  }

  respawn() {
    const s = this.game.map.teams[this.team].spawn;
    this.alive = true;
    this.x = this.px = s[0] + (Math.random() - 0.5) * 3; this.z = this.pz = s[1] + (Math.random() - 0.5) * 3;
    this.hp = this.maxHp; this.mp = this.maxMp;
    this.invulnT = 1.5;
    this.dmgFrom.clear();
    this.game.emit({ type: 'respawn', u: this });
  }

  /* ---------- 每帧更新 ---------- */

  update(dt) {
    const g = this.game, inn = this.in;
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.tickTimers(dt);
    this.moving = false;
    for (let i = 0; i < 3; i++) if (this.cds[i] > 0) this.cds[i] -= dt;
    if (this.flashCd > 0) this.flashCd -= dt;
    if (this.healCd > 0) this.healCd -= dt;
    if (this.castLock > 0) this.castLock -= dt;
    if (this.nextAtk && (this.nextAtk.t -= dt) <= 0) this.nextAtk = null;

    // 临时增益到期
    let changed = false;
    for (let i = this.buffs.length - 1; i >= 0; i--) if ((this.buffs[i].t -= dt) <= 0) { this.buffs.splice(i, 1); changed = true; }
    if (this.redT > 0) this.redT -= dt;
    if (this.blueT > 0 && (this.blueT -= dt) <= 0) changed = true;
    if (changed) this.recalc();
    if (this.def.tick) this.def.tick(this, dt, g);     // 被动的持续逻辑

    // 回复：自然回复、“恢复”技能、泉水
    let hpGain = this.hpRegen * dt, mpGain = this.mpRegen * dt;
    if (this.healT > 0) { this.healT -= dt; hpGain += this.maxHp * HERO.healPct * dt; mpGain += this.maxMp * HERO.healPct * dt; }
    const sp = g.map.teams[this.team].spawn;
    if (this.dist2To(sp[0], sp[1]) < HERO.fountainRange * HERO.fountainRange) {
      hpGain += this.maxHp * HERO.fountainHeal * dt; mpGain += this.maxMp * HERO.fountainHeal * dt;
    }
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + hpGain);
    if (this.mp < this.maxMp) this.mp = Math.min(this.maxMp, this.mp + mpGain);

    // 技能加点：电脑立即自动加；玩家闲置 6 秒后自动加
    if (this.skillPts > 0) {
      if (inn.lvUp >= 0) this.levelSkill(inn.lvUp);
      if (!this.isPlayer) this.autoLevel();
      else if ((this.skillPtT += dt) > 6 || this.skillLv[0] + this.skillLv[1] + this.skillLv[2] === 0 && this.skillPtT > 2.5) this.autoLevel();
    }
    inn.lvUp = -1;
    if (inn.buy) { this.buy(inn.buy); inn.buy = null; }

    if (this.stunT > 0) { this.recallT = 0; this.clearOnce(); return; }

    // 位移中：只处理位移
    if (this.dash) { this.updateDash(dt); this.clearOnce(); return; }

    // 召唤师技能
    if (inn.flash && this.flashCd <= 0) {
      let dx = inn.mx, dz = inn.mz;
      if (!dx && !dz) { dx = Math.sin(this.face); dz = Math.cos(this.face); }
      const ox = this.x, oz = this.z;
      this.blink(dx, dz, HERO.flashDist);
      this.flashCd = HERO.flashCd;
      g.emit({ type: 'flash', u: this, x: ox, z: oz });
    }
    if (inn.heal && this.healCd <= 0) { this.healCd = HERO.healCd; this.healT = HERO.healDur; g.emit({ type: 'heal', u: this }); }
    if (inn.recall && this.recallT <= 0) { this.recallT = HERO.recallTime; this.atkWind = 0; g.emit({ type: 'recall', u: this }); }

    // 技能
    if (inn.cast >= 0) this.cast(inn.cast, { x: inn.aimX, z: inn.aimZ, target: inn.aimTarget });

    // 回城引导：移动、攻击、受伤都会打断
    if (this.recallT > 0) {
      if (inn.mx || inn.mz || inn.attack || g.time - this.lastDamagedT < 0.1) this.recallT = 0;
      else if ((this.recallT -= dt) <= 0) {
        this.recallT = 0;
        this.x = this.px = sp[0]; this.z = this.pz = sp[1];
        g.emit({ type: 'recalled', u: this });
      }
    }

    if (this.castLock > 0) { this.clearOnce(); return; }

    // 移动优先于普攻：推摇杆会取消还没打出去的普攻
    if (inn.mx || inn.mz) {
      if (this.atkWind > 0) { this.atkWind = 0; this.atkCd = Math.min(this.atkCd, 0.1); }
      const sp2 = this.moveSpeed * dt;
      this.x += inn.mx * sp2; this.z += inn.mz * sp2;
      this.face = Math.atan2(inn.mx, inn.mz);
      this.moving = true;
    } else if (this.attack(null, dt)) {
      // 正在出手
    } else if (inn.attack) {
      let t = inn.atkTarget && inn.atkTarget.alive && g.targetable(inn.atkTarget, this) ? inn.atkTarget : this.pickTarget(inn.atkMode);
      this.target = t;
      if (t) {
        const extra = this.nextAtk?.range || 0;
        if (this.inRange(t, extra)) {
          if (this.atkCd <= 0) {
            const r = this.range; this.range = r + extra;      // 强化普攻可能临时加射程
            this.attack(t, dt);
            this.range = r;
          } else this.faceTo(t.x, t.z);
        } else this.stepToward(t.x, t.z, dt);
      }
    }
    this.clearOnce();
  }

  /** 一次性意图用完即清 */
  clearOnce() {
    const inn = this.in;
    inn.cast = -1; inn.flash = false; inn.heal = false; inn.recall = false; inn.aimTarget = null;
  }

  updateDash(dt) {
    const d = this.dash, g = this.game;
    const step = Math.min(d.left, d.speed * dt);
    const ox = this.x, oz = this.z;
    this.x += d.dx * step; this.z += d.dz * step;
    if (!d.jump) g.world.resolve(this);            // 跳跃型位移可以越过墙，落地后再由世界把人推出墙体
    const moved = Math.hypot(this.x - ox, this.z - oz);
    d.left -= step;
    this.moving = true;
    let end = d.left <= 0.01 || moved < step * 0.35;      // 走完了，或者撞墙走不动了
    if (d.hitR > 0 && d.onHit) {
      const list = g.query(this.x, this.z, d.hitR, this.team, d.mask);
      for (const u of list) {
        if (d.hit.has(u)) continue;
        d.hit.add(u);
        d.onHit(u);
        if (d.stopOnHero && u.isHero) { end = true; break; }
      }
    }
    if (end) { this.dash = null; d.onEnd?.(); }
  }
}
