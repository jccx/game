// 裂谷争锋：对局的核心逻辑。这里只有“规则”，没有任何画面代码，所以可以脱离浏览器直接跑（测试用）。
// 渲染层（render/）和界面（hud.js）每帧读取这里的状态，并消费 events 队列里的事件来播放特效和音效。
import { MINION, TOWER, MONSTER, BUFFS, ECON, HERO, DIFFICULTY, PACE } from './config.js';
import { makeMap, pathLength, pointAlong } from './maps.js';
import { World } from './world.js';
import { KIND, STRUCT, Minion, Tower, Crystal, Monster, Hero } from './entities.js';
import { HEROES, HERO_BY_ID } from './heroes/index.js';
import { Brain } from './ai.js';

const MOBILE = KIND.HERO | KIND.MINION | KIND.MONSTER;

export class Game {
  /**
   * @param {object} o
   * @param {string} o.mode       '5v5' | '3v3' | '1v1'
   * @param {string} o.hero       玩家选的英雄 id
   * @param {number} [o.difficulty=1] 0 简单 / 1 普通 / 2 困难
   * @param {boolean} [o.allBots]  玩家的英雄也交给电脑（测试、观战用）
   */
  constructor(o) {
    this.mode = o.mode;
    this.diff = DIFFICULTY[o.difficulty ?? 1];
    this.map = makeMap(o.mode);
    this.world = new World(this.map);
    this.time = 0;
    this.over = null;                 // 结束后为 { winner, time }
    this.events = [];                 // 给渲染层/界面的事件队列
    this.units = [];                  // 所有单位
    this.heroes = []; this.towers = []; this.crystals = [];
    this.projs = [];                  // 飞行中的投射物
    this.timers = [];                 // 延时回调
    this.teamKills = [0, 0];
    this.firstBlood = false;
    this.respawnMul = { '5v5': 1, '3v3': 0.75, '1v1': 0.6 }[o.mode] || 1;
    this.pace = PACE[o.mode] || PACE['5v5'];
    this.waveN = 0; this.nextWaveT = MINION.firstWave;
    this._fountainT = 0; this._pid = 1;

    // 兵线路径：每隔约 6 单位取一个路径点，带上法线（用于让一波兵横向排开）和沿线距离
    this.laneLen = [];
    this.lanePts = this.map.lanes.map((lane) => {
      const L = pathLength(lane.pts), n = Math.ceil(L / 6), arr = [];
      for (let i = 0; i <= n; i++) {
        const d = (L * i) / n, p = pointAlong(lane.pts, d);
        arr.push({ x: p.x, z: p.z, nx: -p.dz, nz: p.dx, d });
      }
      this.laneLen.push(L);
      return arr;
    });

    // 建筑
    for (const t of this.map.towers) {
      const u = new Tower(this, t.team, t.lane, t.tier, t.x, t.z);
      u.circle = { x: t.x, z: t.z, r: u.radius };
      this.world.circles.push(u.circle);
      this.towers.push(u); this.units.push(u);
    }
    this.map.teams.forEach((tm, team) => {
      const c = new Crystal(this, team, tm.crystal[0], tm.crystal[1]);
      c.circle = { x: c.x, z: c.z, r: c.radius };
      this.world.circles.push(c.circle);
      this.crystals.push(c); this.units.push(c);
    });
    this.world.bake();
    this.refreshVulnerable();

    // 英雄阵容
    const lineup = this.pickLineup(o.hero);
    lineup.forEach((ids, team) => ids.forEach((id, i) => {
      const sp = this.map.teams[team].spawn, ang = (i / ids.length) * 6.283;
      const isPlayer = team === 0 && i === 0;
      const h = new Hero(this, HERO_BY_ID[id], team, sp[0] + Math.cos(ang) * 2.2, sp[1] + Math.sin(ang) * 2.2, isPlayer);
      h.lane = this.map.roleLane[h.def.role];
      if (!isPlayer || o.allBots) h.brain = new Brain(h, this);
      if (isPlayer) this.player = h;
      this.heroes.push(h); this.units.push(h);
    }));
    // 单路地图上所有人都走同一条路；5v5 里如果某条路没人（阵容不满），让打野的去补
    this.world.resolve(this.player);

    // 野怪营地
    this.camps = this.map.camps.map((camp) => ({ camp, unit: null, respawnAt: MONSTER[camp.kind].firstSpawn || 0 }));
  }

  /** 决定双方阵容。返回 [蓝方英雄 id 列表（第一个是玩家）, 红方英雄 id 列表] */
  pickLineup(playerHero) {
    const all = HEROES.map((h) => h.id), n = this.map.teamSize;
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const me = HERO_BY_ID[playerHero] ? playerHero : all[0];
    // 队友：优先补上坦克、法师、射手，让小规模对局的阵容也比较合理
    const pref = ['panyue', 'xinglan', 'lingyu', 'liefeng', 'yesun'].filter((id) => id !== me);
    const blue = [me, ...pref.slice(0, n - 1)];
    let red;
    if (n >= 5) red = all.slice();
    else if (n === 1) red = [shuffle(all.filter((id) => id !== me))[0]];
    else red = shuffle(all.slice()).slice(0, n);
    return [blue, red];
  }

  /* ------------------------------------------------------------ 事件与延时 */

  /** 发出一个事件，渲染层/界面会在下一帧处理 */
  emit(ev) { if (this.events.length < 800) this.events.push(ev); }
  /** 发出一个特效事件 */
  fx(name, o) { o.type = 'fx'; o.name = name; this.emit(o); }
  /** 延时执行 */
  after(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }

  /* ------------------------------------------------------------ 查询 */

  /** 重新计算每座塔/水晶当前能否被攻击（外塔倒了里面的塔才能打） */
  refreshVulnerable() {
    for (const t of this.towers) t.vuln = t.alive && t.vulnerable();
    for (const c of this.crystals) c.vuln = c.alive && c.vulnerable();
  }

  /** 单位 u 现在能否被选为目标 */
  targetable(u) {
    if (!u.alive || u.invulnT > 0) return false;
    if (u.kind & STRUCT) return u.vuln;
    return true;
  }

  /**
   * 在 range 范围内为 unit 找一个敌方目标。mask 限定种类；mode 3 是小兵的习惯：优先打小兵，其次才是英雄。
   */
  findTarget(unit, range, mask, mode) {
    let best = null, bs = 1e9;
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (!u.alive || u.team === unit.team || !(u.kind & mask) || u.invulnT > 0) continue;
      if ((u.kind & STRUCT) && !u.vuln) continue;
      const dx = u.x - unit.x, dz = u.z - unit.z;
      if (Math.abs(dx) > range + 4 || Math.abs(dz) > range + 4) continue;
      let s = Math.sqrt(dx * dx + dz * dz) - u.radius;
      if (s > range) continue;
      if (mode === 3 && u.kind === KIND.HERO) s += 3;
      if (s < bs) { bs = s; best = u; }
    }
    return best;
  }

  /** 圆形范围内、不属于 team 的可攻击单位 */
  query(x, z, r, team, mask) {
    const out = [], us = this.units;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (!u.alive || u.team === team || !(u.kind & mask) || u.invulnT > 0) continue;
      if ((u.kind & STRUCT) && !u.vuln) continue;
      const rr = r + u.radius, dx = u.x - x, dz = u.z - z;
      if (dx * dx + dz * dz <= rr * rr) out.push(u);
    }
    return out;
  }

  /** 离 (x,z) 最近的兵线路径点下标 */
  nearestLaneIndex(lane, x, z) {
    const pts = this.lanePts[lane];
    let bi = 0, bd = 1e9;
    for (let i = 0; i < pts.length; i++) { const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  /** (x,z) 在某条兵线上的“进度”：离蓝方水晶的沿线距离 */
  laneProgress(lane, x, z) { return this.lanePts[lane][this.nearestLaneIndex(lane, x, z)].d; }

  /** 塔附近是否有进攻方的小兵（没有的话塔受到的伤害大幅降低，防止偷塔）。结果缓存半秒 */
  hasSiegers(t) {
    if (t._sgT > this.time) return t._sg;
    let any = false;
    const r2 = (t.range + 3) ** 2;
    for (const u of this.units) if (u.alive && u.kind === KIND.MINION && u.team !== t.team && t.dist2To(u.x, u.z) < r2) { any = true; break; }
    t._sg = any; t._sgT = this.time + 0.5;
    return any;
  }

  /* ------------------------------------------------------------ 伤害与击杀 */

  /**
   * 造成伤害。type：phys 物理 / magic 法术 / true 真实。
   * opts：attack 是否普攻（触发吸血）、crit 是否暴击、silent 不显示数字。
   * 返回实际扣掉的生命值。
   */
  damage(src, target, amount, type, opts) {
    if (!target.alive || amount <= 0 || target.invulnT > 0) return 0;
    if (target.godT > 0) return 0;                                  // 作弊无敌中
    const struct = (target.kind & STRUCT) !== 0;
    if (struct && !target.vuln) return 0;
    let dmg = amount;
    // 防御减伤：防御值越高减得越多，600 点防御减一半
    if (type === 'phys') dmg *= 600 / (600 + Math.max(0, target.armor * (1 - (src.pen || 0))));
    else if (type === 'magic') dmg *= 600 / (600 + Math.max(0, target.mr * (1 - (src.mpen || 0))));
    dmg *= target.dmgTakenMul;
    if (struct && !this.hasSiegers(target)) dmg *= TOWER.noMinionReduce;
    if (src.isHero && src.team === 1 && target.isHero) dmg *= this.diff.dmgMul;   // 难度影响电脑对玩家一方的伤害
    const total = dmg;
    if (target.shield > 0) { const a = Math.min(target.shield, dmg); target.shield -= a; dmg -= a; }
    target.hp -= dmg;
    target.lastDamagedT = this.time;

    if (target.isHero) {
      target.lastAttackT = this.time;
      if (src.isHero) {
        target.dmgFrom.set(src, this.time);
        src.lastAttackT = this.time;
        // 在塔下打对方英雄，塔会转火攻击者
        for (const t of this.towers) if (t.alive && t.team === target.team && t.inRange(src)) t.forceTarget = src;
      }
    } else if (target.kind === KIND.MONSTER && src.isHero) {
      // 野怪被打后反击；回营途中在营地范围内被打也会回头
      if (!target.aggro && (!target.returning || Math.hypot(src.x - target.homeX, src.z - target.homeZ) < target.cfg.leash)) {
        target.aggro = src; target.returning = false;
      }
    }
    if (opts && opts.attack && src.lifesteal > 0 && src.alive && !struct) src.hp = Math.min(src.maxHp, src.hp + total * src.lifesteal);

    // 只为和玩家有关或英雄之间的伤害发事件（飘字、受击闪光），避免小兵互殴产生大量事件
    if (!(opts && opts.silent) && (src.isHero || target.isHero)) {
      this.emit({ type: 'dmg', u: target, src, n: total, crit: !!(opts && opts.crit), kind: type });
    }
    if (target.hp <= 0) this.kill(target, src);
    return total;
  }

  /** 把金币和经验分给击杀者和附近的友方英雄 */
  reward(x, z, team, killer, gold, exp) {
    const near = [];
    const r2 = ECON.shareRange * ECON.shareRange;
    for (const h of this.heroes) if (h.alive && h.team === team && (h === killer || h.dist2To(x, z) < r2)) near.push(h);
    if (!near.length) return;
    const lastHit = killer && killer.isHero ? killer : null;
    for (const h of near) {
      const g = h === lastHit ? gold : (gold * ECON.assistShare) / Math.max(1, near.length - (lastHit ? 1 : 0));
      h.gainGold(g);
      if (h === this.player && h === lastHit && gold > 0) this.emit({ type: 'gold', x, z, n: Math.round(gold) });
      h.gainExp((exp * (1 + 0.6 * (near.length - 1))) / near.length);
    }
  }

  kill(u, killer) {
    if (!u.alive) return;
    u.alive = false; u.hp = 0; u.deadT = 0; u.target = null;
    const kind = u.kind;
    if (kind === KIND.MINION) {
      this.reward(u.x, u.z, 1 - u.team, killer, u.cfg.gold, u.cfg.exp);
    } else if (kind === KIND.MONSTER) {
      const cs = this.camps.find((c) => c.unit === u);
      if (cs) cs.respawnAt = this.time + u.cfg.respawn;
      const kh = killer.isHero ? killer : null;
      if (kh) {
        this.reward(u.x, u.z, kh.team, kh, u.cfg.gold, u.cfg.exp);
        if (u.cfg.buff === 'red') kh.redT = BUFFS.red.dur;
        if (u.cfg.buff === 'blue') { kh.blueT = BUFFS.blue.dur; kh.recalc(); }
        if (u.cfg.buff) this.emit({ type: 'buff', u: kh, buff: u.cfg.buff });
        if (u.cfg.teamGold) {
          for (const h of this.heroes) if (h.team === kh.team) { h.gainGold(u.cfg.teamGold); h.gainExp(u.cfg.teamExp); }
          this.emit({ type: 'boss', team: kh.team, u: kh });
        }
      }
    } else if (kind === KIND.TOWER) {
      this.world.removeCircle(u.circle);
      this.refreshVulnerable();
      for (const h of this.heroes) if (h.team !== u.team) { h.gainGold(TOWER.gold); h.gainExp(TOWER.exp); }
      this.emit({ type: 'towerDown', u, team: u.team });
    } else if (kind === KIND.CRYSTAL) {
      this.over = { winner: 1 - u.team, time: this.time };
      this.emit({ type: 'over', winner: 1 - u.team });
    } else if (kind === KIND.HERO) {
      this.heroKilled(u, killer);
    }
    this.emit({ type: 'death', u, killer });
  }

  heroKilled(v, killer) {
    // 击杀者：最后一击是英雄就算他；否则算 10 秒内最后打过他的敌方英雄
    let k = killer.isHero ? killer : null;
    const assists = [];
    let lastT = -1, last = null;
    for (const [h, t] of v.dmgFrom) {
      if (this.time - t > 10) continue;
      if (t > lastT) { lastT = t; last = h; }
    }
    if (!k) k = last;
    for (const [h, t] of v.dmgFrom) if (h !== k && this.time - t <= 10) assists.push(h);
    const lv = v.level;
    v.die();
    const team = k ? k.team : 1 - v.team;
    this.teamKills[team]++;
    const first = !this.firstBlood; this.firstBlood = true;
    if (k) {
      k.kills++; k.streak++;
      k.gainGold(ECON.heroKillGold + lv * ECON.heroKillGoldPerLevel + (first ? 100 : 0));
      if (k === this.player) this.emit({ type: 'gold', x: v.x, z: v.z, n: ECON.heroKillGold + lv * ECON.heroKillGoldPerLevel });
    }
    for (const h of assists) { h.assists++; h.gainGold(ECON.assistGold); }
    // 经验：击杀者、助攻者和附近的队友平分
    const share = new Set(assists); if (k) share.add(k);
    for (const h of this.heroes) if (h.alive && h.team === team && h.dist2To(v.x, v.z) < ECON.shareRange * ECON.shareRange) share.add(h);
    const exp = (ECON.heroKillExp + lv * ECON.heroKillExpPerLevel) * (1 + 0.2 * (share.size - 1));
    for (const h of share) h.gainExp(exp / share.size);
    this.emit({ type: 'kill', victim: v, killer: k, by: killer, assists, first });
  }

  /* ------------------------------------------------------------ 投射物 */

  /** 追踪型投射物（普攻用）：一定命中，除非目标先死了 */
  homing(src, target, speed, onLand, kind) {
    this.projs.push({ id: this._pid++, homing: true, x: src.x, z: src.z, px: src.x, pz: src.z, y: src.isStruct ? 6 : 1.5, tx: target.x, tz: target.z,
      target, speed, onLand, kind, team: src.team, alive: true, hitU: null });
  }

  /**
   * 直线型投射物（技能用）。o：src, x, z, dx, dz, speed, range, radius, mask,
   * pierce（穿透）, stopOnHero（穿透时撞到英雄仍停下）, onHit(u), onEnd(p), kind, color
   */
  shoot(o) {
    this.projs.push({ id: this._pid++, homing: false, x: o.x, z: o.z, px: o.x, pz: o.z, y: 1.4, dx: o.dx, dz: o.dz, speed: o.speed, left: o.range,
      radius: o.radius || 0.8, mask: o.mask, pierce: !!o.pierce, stopOnHero: o.stopOnHero !== false, onHit: o.onHit, onEnd: o.onEnd,
      kind: o.kind || 'shot', color: o.color, team: o.src.team, src: o.src, hit: null, alive: true, hitU: null });
  }

  updateProjs(dt) {
    const ps = this.projs;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.px = p.x; p.pz = p.z;
      if (p.homing) {
        const t = p.target;
        if (t.alive) { p.tx = t.x; p.tz = t.z; }
        const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz), step = p.speed * dt;
        if (d <= step + t.radius * 0.6) {
          p.x = p.tx; p.z = p.tz; p.alive = false;
          if (t.alive) { p.hitU = t; p.onLand(t); }
        } else { p.x += (dx / d) * step; p.z += (dz / d) * step; }
      } else {
        const step = Math.min(p.left, p.speed * dt);
        p.x += p.dx * step; p.z += p.dz * step; p.left -= step;
        const list = this.query(p.x, p.z, p.radius, p.team, p.mask);
        for (const u of list) {
          if (p.hit && p.hit.has(u)) continue;
          (p.hit || (p.hit = new Set())).add(u);
          p.hitU = u;
          p.onHit(u, p);
          if (!p.pierce || (p.stopOnHero && u.isHero)) { p.alive = false; break; }
        }
        if (p.alive && p.left <= 0.001) { p.alive = false; if (p.onEnd) p.onEnd(p); }
      }
      if (!p.alive) { ps[i] = ps[ps.length - 1]; ps.pop(); this.emit({ type: 'projEnd', p }); }
    }
  }

  /* ------------------------------------------------------------ 出兵与野怪 */

  spawnWave() {
    this.waveN++;
    let minions = 0;
    for (const u of this.units) if (u.kind === KIND.MINION && u.alive) minions++;
    if (minions > 84) return;                       // 兵太多时跳过一波，保护性能
    const single = this.map.lanes.length === 1;
    // [兵种, 离己方水晶的沿线距离, 横向偏移]：近战在前，远程在后，炮车殿后
    const comp = single
      ? [['melee', 12, -1.6], ['melee', 12, 1.6], ['melee', 10.2, 0], ['ranged', 8, -1.2], ['ranged', 8, 1.2]]
      : [['melee', 12, -1.4], ['melee', 12, 1.4], ['ranged', 9.4, 0]];
    if (this.waveN % MINION.siegeEvery === 0) comp.push(['siege', 6.8, 0]);
    this.map.lanes.forEach((lane, li) => {
      const pts = this.lanePts[li], L = this.laneLen[li];
      for (let team = 0; team < 2; team++) {
        for (const [type, d0, off] of comp) {
          const d = team === 0 ? d0 : L - d0;
          const p = pointAlong(lane.pts, d);
          // 下一个要去的路径点
          let wi;
          if (team === 0) { wi = pts.findIndex((q) => q.d > d + 1); if (wi < 0) wi = pts.length - 1; }
          else { wi = 0; for (let i = pts.length - 1; i >= 0; i--) if (pts[i].d < d - 1) { wi = i; break; } }
          const m = new Minion(this, team, type, li, p.x - p.dz * off, p.z + p.dx * off, wi, off);
          m.face = Math.atan2(p.dx * (team ? -1 : 1), p.dz * (team ? -1 : 1));
          this.units.push(m);
        }
      }
    });
    this.emit({ type: 'wave', n: this.waveN });
  }

  updateCamps() {
    for (const cs of this.camps) {
      if (cs.unit && cs.unit.alive) continue;
      if (this.time < cs.respawnAt) continue;
      if (cs.unit && cs.unit.deadT < 1.5) continue;
      cs.unit = new Monster(this, cs.camp);
      this.units.push(cs.unit);
      if (cs.camp.kind === 'boss' && this.time > 1) this.emit({ type: 'bossSpawn' });
    }
  }

  /* ------------------------------------------------------------ 主循环 */

  update(dt) {
    if (this.over) return;
    this.time += dt;
    if (this.time >= this.nextWaveT) { this.nextWaveT += MINION.waveEvery; this.spawnWave(); }
    this.updateCamps();

    const us = this.units;
    for (const h of this.heroes) if (h.brain) h.brain.update(dt);
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      u.px = u.x; u.pz = u.z;
      if (u.alive || u.kind === KIND.HERO) u.update(dt); else u.deadT += dt;
    }
    this.separate();
    this.updateProjs(dt);

    // 延时回调（回调里可能再加新的延时，所以倒着遍历并原地删除）
    const tm = this.timers;
    for (let i = tm.length - 1; i >= 0; i--) if (tm[i].t <= this.time) { const f = tm[i].fn; tm.splice(i, 1); f(); }

    // 泉水：敌方英雄闯进来会持续受到大量伤害
    this._fountainT -= dt;
    const tick = this._fountainT <= 0;
    if (tick) this._fountainT = 0.5;
    for (const h of this.heroes) {
      if (!h.alive) continue;
      h.gainGold(ECON.passiveGold * dt);
      if (tick) {
        const sp = this.map.teams[1 - h.team].spawn;
        if (h.dist2To(sp[0], sp[1]) < HERO.fountainRange * HERO.fountainRange) this.damage(this.crystals[1 - h.team], h, h.maxHp * HERO.fountainDmg, 'true');
      }
    }

    // 清理：死掉的小兵和野怪停留一会儿（播放倒地动作）后移除
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i];
      if (!u.alive && (u.kind & (KIND.MINION | KIND.MONSTER)) && u.deadT > 1.2) { us[i] = us[us.length - 1]; us.pop(); }
    }
  }

  /** 单位之间互相挤开，再把所有会动的单位推出墙体 */
  separate() {
    const us = this.units, n = us.length;
    for (let i = 0; i < n; i++) {
      const a = us[i];
      if (!a.alive || !(a.kind & MOBILE)) continue;
      for (let j = i + 1; j < n; j++) {
        const b = us[j];
        if (!b.alive || !(b.kind & MOBILE)) continue;
        const dx = b.x - a.x;
        if (dx > 3 || dx < -3) continue;
        const dz = b.z - a.z;
        if (dz > 3 || dz < -3) continue;
        const min = (a.radius + b.radius) * 0.82, d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        let nx, nz;
        if (d < 1e-3) { nx = Math.cos(a.id * 2.4); nz = Math.sin(a.id * 2.4); } else { nx = dx / d; nz = dz / d; }
        const push = (min - d) * 0.5;
        // 英雄不容易被小兵挤动；位移中的英雄不参与
        let wa = 0.5, wb = 0.5;
        if (a.isHero && !b.isHero) { wa = 0.15; wb = 0.85; } else if (b.isHero && !a.isHero) { wa = 0.85; wb = 0.15; }
        if (a.dash) wa = 0; if (b.dash) wb = 0;
        a.x -= nx * push * wa; a.z -= nz * push * wa;
        b.x += nx * push * wb; b.z += nz * push * wb;
      }
    }
    for (let i = 0; i < n; i++) {
      const u = us[i];
      if (u.alive && (u.kind & MOBILE) && !(u.dash && u.dash.jump)) this.world.resolve(u);
    }
  }
}
