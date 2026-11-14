// 落日湾：游戏的核心逻辑——玩家、载具、行人、交通、警察通缉、武器、拾取物。
// 只有规则，没有画面代码，可以脱离浏览器跑（测试用）。画面层每帧读这里的状态，并消费 events 里的事件。
import { World, terrainY, SIZE, CITY_Y, PITCH, NI, BASE } from './world.js';
import { Vehicle } from './vehicles.js';
import { VEH, TRAFFIC_MIX, CAR_COLORS, WEAPONS, WEAPON_INDEX, PLAYER, PED, COP, CRIME, WANTED, TRAFFIC } from './config.js';
import { clamp, angDiff } from '../../shared/js/util.js';
import { Missions } from './missions.js';

const NOCTL = { steer: 0, gas: 0, handbrake: false, pitch: 0, fire: false };
let PID = 1;

export class Sim {
  /** @param {object} [save] 存档：{ money, done:[任务 id], owned:[bool], ammo:[number] } */
  constructor(save = {}) {
    this.world = new World();
    this.time = 0;
    this.events = [];
    this.vehicles = []; this.peds = []; this.shots = []; this.pickups = [];
    const sp = this.world.places.spawn;
    this.player = {
      x: sp.x, z: sp.z, y: this.world.groundY(sp.x, sp.z), yaw: sp.face, px: sp.x, py: 0, pz: sp.z,
      hp: PLAYER.hp, armor: 0, money: save.money ?? 200, inVeh: null, moving: false, swim: false,
      weapon: 1, owned: save.owned ? save.owned.slice() : [true, true, false, false, false], ammo: save.ammo ? save.ammo.slice() : [Infinity, 80, 0, 0, 0],
      shootCd: 0, atkSeq: 0, dead: false, deadT: 0, hitT: 0, godT: 0, speed: 0,
    };
    this.player.ammo[0] = Infinity;
    // 玩家的操作意图，由界面每帧填写
    this.ctl = { mx: 0, mz: 0, steer: 0, gas: 0, handbrake: false, pitch: 0, fire: false, enter: false, swap: false, aimYaw: 0 };
    // 通缉
    this.heat = 0; this.stars = 0; this.unseenT = 0; this.copSpawnT = 0; this.seen = false; this.seeT = 0; this.wantedLock = false;
    this.spawnT = 0; this.pedT = 0; this.nearBlocks = []; this.nearT = 0;
    this.fixedSpawns = []; this.fixedI = 0;       // 固定停放的载具（飞机、船、坦克等）：毁了或被开走后会在原地补一辆
    this.setupWorld();
    this.missions = new Missions(this, save.done || []);
  }

  /* ------------------------------------------------------------ 基础 */
  emit(ev) { if (this.events.length < 600) this.events.push(ev); }
  toast(text, kind = 'info') { this.emit({ type: 'toast', text, kind }); }
  addMoney(n) { this.player.money = Math.max(0, Math.round(this.player.money + n)); this.emit({ type: 'money', n }); }

  /** 生成一辆车 */
  addVehicle(type, x, z, yaw = 0, color) {
    const v = new Vehicle(this, type, x, z, yaw, color ?? (type === 'taxi' ? 0xf2c230 : type === 'police' ? 0xf4f6fa : type === 'tank' ? 0x5c6b48 : type === 'plane' ? 0xe8ecf2 : type === 'boat' ? 0xf0f0f0 : type === 'target' ? 0xc0392b : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0]));
    this.vehicles.push(v);
    return v;
  }

  /** 开局时摆好固定的载具和拾取物 */
  setupWorld() {
    const P = this.world.places, w = this.world;
    const keep = (v) => { v.fixed = true; this.fixedSpawns.push({ type: v.type, x: v.x, z: v.z, yaw: v.yaw, color: v.color, free: false, v }); return v; };
    keep(this.addVehicle('sedan', P.spawn.x - 6.5, P.spawn.z + 6, 0, 0x3b78d8));            // 出生点路边的一辆车
    keep(this.addVehicle('bike', P.spawn.x - 6.5, P.spawn.z - 6, 0));
    for (const [x, z, yaw] of P.boats) keep(this.addVehicle('boat', x, z, yaw));
    for (const [x, z, yaw] of P.planes) keep(this.addVehicle('plane', x, z, yaw));
    for (const [x, z, yaw] of P.tanks) keep(this.addVehicle('tank', x, z, yaw));
    keep(this.addVehicle('tank', P.gate.x + 14, P.gate.z + 4, Math.PI / 2)).free = true;   // 军营门外也停一辆，随便开，不算偷
    this.fixedSpawns.at(-1).free = true;
    // 路边停着的车：住宅区和商业区的若干路段旁
    let n = 0;
    for (const e of w.edges) {
      if ((e.a.id * 7 + e.b.id * 3) % 5 !== 0 || n >= 26) continue;
      const t = 0.3 + ((e.a.id * 13) % 5) / 10, x = e.a.x + (e.b.x - e.a.x) * t, z = e.a.z + (e.b.z - e.a.z) * t;
      const type = ['sedan', 'sedan', 'pickup', 'sports', 'bike', 'taxi'][(e.a.id + e.b.id) % 6];
      const v = e.horiz ? this.addVehicle(type, x, z + 5.6, Math.PI / 2) : this.addVehicle(type, x - 5.6, z, 0);
      v.parked = true; n++;
    }
    // 固定拾取物（过一阵会重新出现）：医疗包、护甲、武器、消星
    const at = (i, j, dx = 9.5, dz = 9.5) => { const nd = w.node(i, j); return nd ? [nd.x + dx, nd.z + dz] : null; };
    const add = (pos, type, val, respawn = 90) => { if (pos) this.pickups.push({ id: PID++, type, val, x: pos[0], z: pos[1], y: w.groundY(pos[0], pos[1]), t: 0, respawn, fixed: true }); };
    add([P.hospital.x + 3, P.hospital.z], 'health', 100, 60);
    add(at(5, 7, 12, 30), 'weapon', 'pistol', 45);
    add(at(8, 9), 'weapon', 'smg'); add(at(4, 5), 'weapon', 'shotgun'); add(at(9, 11), 'weapon', 'smg');
    add([BASE[0] + 70, BASE[1] + 60], 'weapon', 'rocket', 120); add([BASE[0] + 76, BASE[1] + 60], 'armor', 100, 120);
    add(at(7, 8, -9.5, 9.5), 'armor', 100); add(at(10, 6), 'health', 100); add(at(5, 10), 'health', 100);
    add(at(6, 6), 'star', 1, 120); add(at(9, 8, -9.5, -9.5), 'star', 1, 120); add(at(6, 11), 'star', 1, 120);
    add(at(8, 5), 'weapon', 'shotgun'); add(at(7, 10, 9.5, -9.5), 'weapon', 'pistol', 45);
  }

  /* ------------------------------------------------------------ 通缉 */

  /** 犯了事：增加通缉热度 */
  crime(amount) {
    if (this.wantedLock || this.player.dead) return;
    const before = this.stars;
    this.heat = Math.min(5, this.heat + amount);
    this.stars = Math.floor(this.heat + 1e-6);
    this.unseenT = 0;
    if (this.stars > before) this.emit({ type: 'stars', n: this.stars, up: true });
  }
  clearWanted() {
    if (this.stars > 0) this.emit({ type: 'stars', n: 0, up: false });
    this.heat = 0; this.stars = 0;
    for (const p of this.peds) if (p.kind === 'cop' && p.alive) p.state = 'leave';
    // 还在路上的警车关掉警笛，变回普通巡逻车
    for (const v of this.vehicles) if (v.ai && v.ai.kind === 'chase') {
      const a = this.world.nearestNode(v.x, v.z);
      v.siren = false; v.ai = { kind: 'traffic', from: a, to: a.links[(Math.random() * a.links.length) | 0], panic: 0, stuck: 0, rev: 0 };
    }
  }

  updateWanted(dt) {
    const p = this.player;
    if (this.stars <= 0) { this.heat = Math.max(0, this.heat - dt * 0.02); return; }
    // 有没有警察看得见玩家（每半秒查一次）
    if ((this.seeT -= dt) <= 0) {
      this.seeT = 0.5; this.seen = false;
      for (const c of this.peds) if (c.kind === 'cop' && c.alive && Math.hypot(c.x - p.x, c.z - p.z) < WANTED.seeRange && !this.world.blocked(c.x, c.z, p.x, p.z)) { this.seen = true; break; }
      if (!this.seen) for (const v of this.vehicles) if (v.ai && v.ai.kind === 'chase' && v.alive && Math.hypot(v.x - p.x, v.z - p.z) < WANTED.seeRange) { this.seen = true; break; }
    }
    if (this.seen) this.unseenT = 0; else this.unseenT += dt;
    if (this.unseenT > WANTED.evade) {            // 甩掉了：降一颗星
      this.heat = Math.max(0, this.stars - 1); this.stars = Math.floor(this.heat + 1e-6); this.unseenT = WANTED.evade * 0.45;
      this.emit({ type: 'stars', n: this.stars, up: false });
      if (this.stars === 0) this.clearWanted();
      return;
    }
    // 派警车
    if ((this.copSpawnT -= dt) > 0) return;
    this.copSpawnT = WANTED.spawnEvery;
    let cops = 0, cars = 0;
    for (const c of this.peds) if (c.kind === 'cop' && c.alive && c.state !== 'leave') cops++;
    for (const v of this.vehicles) if (v.ai && v.ai.kind === 'chase' && v.alive) { cars++; cops += 2; }
    if (cops >= COP.count[this.stars] || cars >= COP.cars[this.stars]) return;
    const nodes = this.world.roadNodes;
    for (let tries = 0; tries < 12; tries++) {
      const n = nodes[(Math.random() * nodes.length) | 0], d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < 90 || d > 190) continue;
      const v = this.addVehicle('police', n.x, n.z, Math.atan2(p.x - n.x, p.z - n.z));
      v.driver = 'npc'; v.siren = true; v.ai = { kind: 'chase', route: null, routeT: 0, stuck: 0, rev: 0, node: n };
      return;
    }
  }

  /* ------------------------------------------------------------ 玩家 */

  hurtPlayer(dmg) {
    const p = this.player;
    if (p.dead || p.godT > 0) return;
    if (p.inVeh) { p.inVeh.damage(dmg * 1.6, false); dmg *= 0.2; }
    if (p.armor > 0) { const a = Math.min(p.armor, dmg * 0.7); p.armor -= a; dmg -= a; }
    p.hp -= dmg; p.hitT = 0.3;
    this.emit({ type: 'hurt', n: dmg });
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; p.deadT = 0;
      if (p.inVeh) this.exitVehicle(true);
      this.emit({ type: 'wasted' });
      this.missions.fail('你倒下了');
    }
  }

  respawn() {
    const p = this.player, h = this.world.places.hospital;
    p.dead = false; p.hp = PLAYER.hp; p.armor = 0; p.x = p.px = h.x; p.z = p.pz = h.z; p.y = this.world.groundY(h.x, h.z); p.yaw = 0;
    const fee = Math.min(300, Math.round(p.money * 0.1));
    if (fee > 0) this.addMoney(-fee);
    this.clearWanted();
    this.emit({ type: 'respawn', fee });
  }

  /** 离玩家最近、可以上的车 */
  nearestVehicle(maxD = PLAYER.enterDist) {
    const p = this.player; let best = null, bd = 1e9;
    for (const v of this.vehicles) {
      if (!v.usable || (v.flying && v.driver)) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z) - v.radius;
      if (d < maxD - 1.4 && d < bd && Math.abs(v.y - p.y) < 3) { bd = d; best = v; }
    }
    return best;
  }

  enterVehicle(v) {
    const p = this.player;
    if (v.driver === 'npc') {                    // 抢车：把司机拉下来
      this.ejectNpc(v, true);
      this.crime(v.type === 'police' ? CRIME.stealPolice : CRIME.carjack);
    } else if (v.type === 'police' && !v.used) this.crime(CRIME.stealPolice);
    else if (v.type === 'tank' && !v.used && !v.mission && !v.free) this.crime(CRIME.stealTank);   // 军营里的坦克是偷的
    v.driver = 'player'; v.ai = null; v.used = true; v.parked = false;
    p.inVeh = v; p.moving = false;
    this.emit({ type: 'enter', v });
  }

  /** 下车。force：车炸了或沉了被迫离开 */
  exitVehicle(force = false) {
    const p = this.player, v = p.inVeh;
    if (!v) return;
    if (!force && v.flying) { this.toast('先降落再下飞机'); return; }
    v.driver = null; p.inVeh = null;
    // 落脚点：先试驾驶位一侧（左侧），不行换右侧，再不行就原地
    const rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw), d = v.spec.wid / 2 + 0.9, w = this.world;
    let done = false;
    for (const sg of [-1, 1]) {
      const x = v.x + rx * d * sg, z = v.z + rz * d * sg, t = { x, z };
      if (!w.collide(t, PLAYER.radius, v.y)) { p.x = x; p.z = z; done = true; break; }
    }
    if (!done) { p.x = v.x; p.z = v.z; }
    // 从船上下来时如果旁边就是栈桥，直接站到栈桥上
    if (v.spec.cls === 'boat') { const pr = w.places.pier; if (p.x > pr.x0 - 9 && p.x < pr.x1 + 9 && p.z > pr.z0 && p.z < pr.z1 + 6) { p.x = clamp(p.x, pr.x0 + 1, pr.x1 - 1); p.z = Math.min(p.z, pr.z1 - 1); } }
    p.px = p.x; p.pz = p.z; p.y = Math.max(w.groundY(p.x, p.z), -1.15); p.yaw = v.yaw;
    if (force) this.hurtPlayer(v.sunk ? 0 : 45);
    this.emit({ type: 'exit', v });
  }

  /** 把电脑司机弄下车，变成一个逃跑的行人 */
  ejectNpc(v, flee) {
    const cop = v.ai && v.ai.kind === 'chase';
    v.driver = null; v.ai = null;
    if (v.sunk) return;
    const rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
    if (cop) { this.spawnCop(v.x - rx * 2.2, v.z - rz * 2.2); this.spawnCop(v.x + rx * 2.2, v.z + rz * 2.2); return; }
    const ped = this.addPed('civ', v.x - rx * 2, v.z - rz * 2);
    if (flee) { ped.state = 'flee'; ped.t = 9; ped.fx = v.x; ped.fz = v.z; }
  }

  updatePlayer(dt) {
    const p = this.player, c = this.ctl, w = this.world;
    p.px = p.x; p.py = p.y; p.pz = p.z;
    if (p.shootCd > 0) p.shootCd -= dt;
    if (p.hitT > 0) p.hitT -= dt;
    if (p.godT > 0) p.godT -= dt;
    if (p.dead) { if ((p.deadT += dt) > 4.5) this.respawn(); return; }
    if (c.enter) {
      c.enter = false;
      if (p.inVeh) this.exitVehicle(); else { const v = this.nearestVehicle(); if (v) this.enterVehicle(v); }
    }
    if (c.swap) { c.swap = false; for (let k = 1; k <= WEAPONS.length; k++) { const i = (p.weapon + k) % WEAPONS.length; if (p.owned[i] && (p.ammo[i] > 0 || i === 0)) { p.weapon = i; this.emit({ type: 'weapon', i }); break; } } }
    const v = p.inVeh;
    if (v) {
      p.x = v.x; p.y = v.y; p.z = v.z; p.yaw = v.yaw; p.speed = Math.abs(v.speed); p.moving = false; p.swim = false;
      return;
    }
    // 步行
    const m = Math.hypot(c.mx, c.mz), deep = w.inWater(p.x, p.z) && terrainY(p.x, p.z) < -1.2;
    p.swim = deep;
    const sp = deep ? PLAYER.swim : PLAYER.speed;
    if (m > 0.12) {
      const k = Math.min(1, m) / m;
      p.x += c.mx * k * sp * dt; p.z += c.mz * k * sp * dt; p.yaw = Math.atan2(c.mx, c.mz); p.moving = true; p.speed = sp * Math.min(1, m);
    } else { p.moving = false; p.speed = 0; }
    w.collide(p, PLAYER.radius, p.y);
    for (const o of this.vehicles) {             // 不能穿过车
      if (o.sunk) continue;
      const dx = p.x - o.x, dz = p.z - o.z, min = o.radius * 0.8 + PLAYER.radius, d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6 && Math.abs(o.y - p.y) < 3) { const d = Math.sqrt(d2); p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min; }
    }
    p.x = clamp(p.x, 12, SIZE - 12); p.z = clamp(p.z, 12, SIZE - 12);
    const gy = w.groundY(p.x, p.z);
    p.y = deep ? -1.15 : p.y + (Math.max(gy, -1.15) - p.y) * Math.min(1, dt * 16);
    if (c.fire && !deep) this.playerAttack();
    // 拾取
    for (const k of this.pickups) {
      if (k.t > 0 || Math.hypot(k.x - p.x, k.z - p.z) > PLAYER.pickupDist) continue;
      this.collect(k);
    }
  }

  collect(k) {
    const p = this.player;
    if (k.type === 'cash') this.addMoney(k.val);
    else if (k.type === 'health') { if (p.hp >= PLAYER.hp) return; p.hp = PLAYER.hp; }
    else if (k.type === 'armor') { if (p.armor >= 100) return; p.armor = 100; }
    else if (k.type === 'star') { if (this.stars <= 0) return; this.heat = Math.max(0, this.stars - 1); this.stars = Math.floor(this.heat + 1e-6); this.emit({ type: 'stars', n: this.stars, up: false }); if (!this.stars) this.clearWanted(); }
    else if (k.type === 'weapon') { const i = WEAPON_INDEX[k.val]; p.owned[i] = true; p.ammo[i] += { pistol: 60, smg: 150, shotgun: 24, rocket: 6 }[k.val]; p.weapon = i; }
    this.emit({ type: 'pickup', k });
    if (k.fixed) k.t = k.respawn; else this.pickups.splice(this.pickups.indexOf(k), 1);
  }

  /* ------------------------------------------------------------ 武器 */

  /** 自动瞄准：优先正在追捕/敌对的人，其次是准星附近的其他目标。返回 { x, z, ped?, veh? } 或 null */
  pickAim(range) {
    const p = this.player, yaw = this.ctl.aimYaw;
    let best = null, bs = 1e9;
    const consider = (x, z, hostile, obj, isVeh) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > range || d < 0.3) return;
      const a = Math.abs(angDiff(yaw, Math.atan2(x - p.x, z - p.z)));
      if (a > (hostile ? 0.75 : 0.2) + (d < 6 ? 0.5 : 0)) return;
      const s = d + a * 30 + (hostile ? -200 : 0);
      if (s < bs && !this.world.blocked(p.x, p.z, x, z)) { bs = s; best = { x, z, ped: isVeh ? null : obj, veh: isVeh ? obj : null }; }
    };
    for (const o of this.peds) if (o.alive) consider(o.x, o.z, o.kind === 'gang' || (o.kind === 'cop' && o.state !== 'leave'), o, false);
    for (const v of this.vehicles) if (v.alive && v !== p.inVeh) consider(v.x, v.z, !!(v.ai && v.ai.kind === 'chase') || v.type === 'target', v, true);
    return best;
  }

  playerAttack() {
    const p = this.player, wp = WEAPONS[p.weapon];
    if (p.shootCd > 0) return;
    if (!wp.melee && p.ammo[p.weapon] <= 0) {     // 没子弹了：自动换成还有弹药的武器，都没有就用拳头
      let i = 0; for (let k = WEAPONS.length - 1; k > 0; k--) if (p.owned[k] && p.ammo[k] > 0) { i = k; break; }
      p.weapon = i; this.emit({ type: 'weapon', i }); return;
    }
    p.shootCd = 1 / wp.rate; p.atkSeq++;
    const tg = this.pickAim(wp.melee ? wp.range + 0.6 : wp.range);
    const yaw = tg ? Math.atan2(tg.x - p.x, tg.z - p.z) : (wp.melee ? p.yaw : this.ctl.aimYaw);
    p.yaw = yaw;
    if (wp.melee) {
      this.emit({ type: 'punch', x: p.x, z: p.z });
      if (tg && tg.ped && Math.hypot(tg.x - p.x, tg.z - p.z) < wp.range + tg.ped.r) this.hurtPed(tg.ped, wp.dmg, true, p.x, p.z);
      else if (tg && tg.veh && Math.hypot(tg.x - p.x, tg.z - p.z) < wp.range + tg.veh.radius) tg.veh.damage(4, true);
      return;
    }
    p.ammo[p.weapon]--;
    this.noise(p.x, p.z, 45);
    if (wp.explosive) {
      this.shoot({ x: p.x + Math.sin(yaw) * 0.8, y: p.y + 1.5, z: p.z + Math.cos(yaw) * 0.8, dx: Math.sin(yaw), dy: 0.02, dz: Math.cos(yaw), speed: wp.speed, range: wp.range, radius: wp.radius, dmg: wp.dmg, byPlayer: true, kind: 'rocket', owner: null });
      this.emit({ type: 'shot', x: p.x, z: p.z, w: wp.id, mine: true });
      return;
    }
    for (let k = 0; k < (wp.pellets || 1); k++) this.hitscan(p.x, p.y + 1.4, p.z, yaw + (Math.random() - 0.5) * 2 * wp.spread, wp.range, wp.dmg, true, null);
    this.emit({ type: 'shot', x: p.x, z: p.z, w: wp.id, mine: true });
  }

  /** 枪响：附近的行人受惊逃跑，路上的司机踩油门；有人听见还会报警 */
  noise(x, z, r) {
    let heard = false;
    for (const o of this.peds) {
      if (!o.alive || o.kind !== 'civ') continue;
      if (Math.hypot(o.x - x, o.z - z) < r) { o.state = 'flee'; o.t = 6 + Math.random() * 4; o.fx = x; o.fz = z; heard = true; }
    }
    for (const v of this.vehicles) if (v.ai && v.ai.kind === 'traffic' && Math.hypot(v.x - x, v.z - z) < r) v.ai.panic = 6;
    if (heard && Math.random() < 0.35) this.crime(CRIME.gunfire);
  }

  /**
   * 即时命中的子弹：沿方向找到第一个打中的人或车（被建筑挡住则打在墙上），并发出弹道事件。
   * byPlayer 为 true 时目标是行人/警察/车；否则目标是玩家。
   */
  hitscan(x, y, z, yaw, range, dmg, byPlayer, shooter) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw), p = this.player;
    let best = range, hitPed = null, hitVeh = null, hitMe = false;
    const test = (ox, oz, r) => {              // 射线和圆相交的距离
      const tx = ox - x, tz = oz - z, t = tx * dx + tz * dz;
      if (t < 0 || t > best) return -1;
      const px = tx - dx * t, pz = tz - dz * t;
      return px * px + pz * pz < r * r ? t : -1;
    };
    if (byPlayer) {
      for (const o of this.peds) { if (!o.alive) continue; const t = test(o.x, o.z, 0.55); if (t >= 0) { best = t; hitPed = o; hitVeh = null; } }
      for (const v of this.vehicles) { if (!v.alive || v === p.inVeh) continue; const t = test(v.x, v.z, v.radius * 0.85); if (t >= 0) { best = Math.max(0.5, t - v.radius * 0.5); hitVeh = v; hitPed = null; } }
    } else if (!p.dead) {
      const t = test(p.x, p.z, p.inVeh ? p.inVeh.radius * 0.8 : 0.5);
      if (t >= 0) { best = t; hitMe = true; }
    }
    // 建筑遮挡：按 3 米步长沿弹道检查
    const w = this.world;
    for (let t = 3; t < best; t += 3) {
      const cx = x + dx * t, cz = z + dz * t; let b = false;
      w.nearBuildings(cx, cz, 0.5, (bd) => { if (cx > bd.x0 && cx < bd.x1 && cz > bd.z0 && cz < bd.z1 && y < bd.y0 + bd.h) b = true; });
      if (b) { best = t; hitPed = hitVeh = null; hitMe = false; break; }
    }
    if (hitPed) this.hurtPed(hitPed, dmg, true, x, z);
    else if (hitVeh) { hitVeh.damage(dmg * (hitVeh.spec.cls === 'tank' ? 0.1 : 1), true); if (hitVeh.ai && hitVeh.ai.kind === 'chase') this.crime(CRIME.hurtCop * 0.3); else if (hitVeh.ai) hitVeh.ai.panic = 6; }
    else if (hitMe) this.hurtPlayer(dmg);
    this.emit({ type: 'tracer', x1: x, y1: y, z1: z, x2: x + dx * best, y2: y - 0.2, z2: z + dz * best, hit: !!(hitPed || hitVeh || hitMe), mine: byPlayer });
  }

  /** 飞行的炮弹/火箭。o：x,y,z, dx,dy,dz, speed, range, radius, dmg, byPlayer, kind, owner（不会打到自己的车） */
  shoot(o) { this.shots.push({ ...o, id: PID++, px: o.x, py: o.y, pz: o.z, left: o.range, alive: true }); this.emit({ type: 'shot', x: o.x, z: o.z, w: o.kind, mine: o.byPlayer }); }

  updateShots(dt) {
    const w = this.world;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.px = s.x; s.py = s.y; s.pz = s.z;
      const step = s.speed * dt;
      s.x += s.dx * step; s.y += s.dy * step; s.z += s.dz * step; s.left -= step; s.dy -= dt * 0.12;
      let hit = s.left <= 0 || s.y <= Math.max(w.groundY(s.x, s.z), 0) + 0.1;
      if (!hit) w.nearBuildings(s.x, s.z, 0.5, (b) => { if (s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1 && s.y < b.y0 + b.h) hit = true; });
      if (!hit) for (const v of this.vehicles) if (v !== s.owner && !v.sunk && Math.hypot(v.x - s.x, v.z - s.z) < v.radius && Math.abs(v.y + 1 - s.y) < 3) { hit = true; break; }
      if (!hit) for (const o of this.peds) if (o.alive && Math.hypot(o.x - s.x, o.z - s.z) < 1.1) { hit = true; break; }
      if (!hit && !s.byPlayer) { const p = this.player; if (Math.hypot(p.x - s.x, p.z - s.z) < 1.3) hit = true; }
      if (hit) { s.alive = false; this.shots.splice(i, 1); this.explode(s.x, s.y, s.z, s.radius, s.dmg, s.byPlayer, s.owner); }
    }
  }

  /** 爆炸：范围内的人和车按距离受伤 */
  explode(x, y, z, r, dmg, byPlayer, src) {
    this.emit({ type: 'explosion', x, y, z, r });
    const p = this.player;
    for (const o of this.peds) { if (!o.alive) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < r) this.hurtPed(o, dmg * (1 - d / r) * 1.2, byPlayer, x, z); }
    for (const v of this.vehicles) {
      if (v === src || !v.alive) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < r + v.radius) {
        v.damage(dmg * (1 - d / (r + v.radius)) * (v.spec.cls === 'tank' ? 0.35 : 1), byPlayer);
        const k = (1 - d / (r + v.radius)) * 6 / v.spec.mass, l = d || 1; v.vx += ((v.x - x) / l) * k; v.vz += ((v.z - z) / l) * k;
        if (byPlayer && v.ai && v.ai.kind === 'chase') this.crime(CRIME.hurtCop);
      }
    }
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < r && !(p.inVeh && p.inVeh === src)) this.hurtPlayer(dmg * (1 - d / r) * (p.inVeh ? 0.5 : 0.45));
    this.noise(x, z, 60);
    if (byPlayer) this.crime(CRIME.wreck * 0.5);
  }

  /* ------------------------------------------------------------ 行人、警察、帮派 */

  addPed(kind, x, z) {
    const o = {
      id: PID++, kind, x, z, y: this.world.groundY(x, z), px: x, pz: z, py: 0, yaw: Math.random() * 6.28, r: 0.4,
      hp: kind === 'civ' ? PED.hp : kind === 'gang' ? 80 : COP.hp[Math.max(1, this.stars)], alive: true, deadT: 0,
      state: kind === 'civ' ? 'walk' : kind === 'gang' ? 'guard' : 'fight', t: 0, tx: x, tz: z, fx: 0, fz: 0,
      block: null, corner: 0, dir: 1, moving: false, shootCd: 1 + Math.random(), atkSeq: 0, losT: 0, los: false,
      look: (Math.random() * 8) | 0, speed: 0,
    };
    this.peds.push(o);
    return o;
  }
  spawnCop(x, z) { const t = { x, z }; this.world.collide(t, 0.5); return this.addPed('cop', t.x, t.z); }

  /** 行人、警察、帮派分子受伤 */
  hurtPed(o, dmg, byPlayer, fromX, fromZ) {
    if (!o.alive) return;
    o.hp -= dmg;
    this.emit({ type: 'hit', x: o.x, y: o.y + 1.2, z: o.z });
    if (o.kind === 'civ') { o.state = 'flee'; o.t = 10; o.fx = fromX; o.fz = fromZ; }
    else if (o.kind === 'gang') o.state = 'fight';
    if (o.hp <= 0) {
      o.alive = false; o.deadT = 0; o.moving = false;
      if (o.kind === 'civ' && Math.random() < 0.8) this.pickups.push({ id: PID++, type: 'cash', val: 10 + ((Math.random() * 60) | 0), x: o.x, z: o.z, y: o.y, t: 0, life: 40 });
      if (o.kind === 'gang') this.pickups.push({ id: PID++, type: 'cash', val: 60 + ((Math.random() * 80) | 0), x: o.x, z: o.z, y: o.y, t: 0, life: 60 });
      if (byPlayer) this.crime(o.kind === 'cop' ? CRIME.killCop : o.kind === 'civ' ? CRIME.killPed : 0.3);
      this.emit({ type: 'pedDown', o });
    } else if (byPlayer) this.crime(o.kind === 'cop' ? CRIME.hurtCop : o.kind === 'civ' ? (dmg < 16 ? CRIME.punch : CRIME.hurtPed) : 0);
  }

  /** 街区四角人行道上的点（k：0 西北、1 东北、2 东南、3 西南） */
  corner(b, k) { const m = 2.4; return [k === 0 || k === 3 ? b.x0 + m : b.x1 - m, k < 2 ? b.z0 + m : b.z1 - m]; }

  spawnPeds(dt) {
    const p = this.player, w = this.world;
    if ((this.nearT -= dt) <= 0) {
      this.nearT = 2;
      this.nearBlocks = w.blocks.filter((b) => { const d = Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z); return d < PED.spawnMax + 40; });
    }
    if ((this.pedT -= dt) > 0 || !this.nearBlocks.length) return;
    this.pedT = 0.35;
    let civ = 0;
    for (const o of this.peds) if (o.kind === 'civ' && o.alive) civ++;
    if (civ >= PED.count) return;
    const b = this.nearBlocks[(Math.random() * this.nearBlocks.length) | 0];
    if (b.zone === 'farm' && Math.random() < 0.7) return;
    const k = (Math.random() * 4) | 0, c0 = this.corner(b, k), c1 = this.corner(b, (k + 1) % 4), t = Math.random();
    const x = c0[0] + (c1[0] - c0[0]) * t, z = c0[1] + (c1[1] - c0[1]) * t, d = Math.hypot(x - p.x, z - p.z);
    if (d < PED.spawnMin && civ > 4) return;
    if (d < 18) return;
    const o = this.addPed('civ', x, z);
    o.block = b; o.dir = Math.random() < 0.5 ? 1 : -1; o.corner = o.dir > 0 ? (k + 1) % 4 : k;
    const c = this.corner(b, o.corner); o.tx = c[0]; o.tz = c[1];
  }

  /** 走一步（带建筑碰撞）。返回是否到了 */
  pedStep(o, tx, tz, speed, dt, stop = 0.4) {
    const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
    if (d <= stop) { o.moving = false; return true; }
    const s = Math.min(speed * dt, d);
    o.x += (dx / d) * s; o.z += (dz / d) * s; o.yaw = Math.atan2(dx, dz); o.moving = true; o.speed = speed;
    this.world.collide(o, o.r, o.y);
    return false;
  }

  updatePeds(dt) {
    const p = this.player, w = this.world;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const o = this.peds[i];
      o.px = o.x; o.pz = o.z; o.py = o.y;
      const dp = Math.hypot(o.x - p.x, o.z - p.z);
      if (!o.alive) { if ((o.deadT += dt) > 9 || dp > PED.despawn) this.peds.splice(i, 1); continue; }
      if (dp > PED.despawn && !o.mission) { this.peds.splice(i, 1); continue; }
      if (o.kind === 'civ') this.updateCiv(o, dt);
      else this.updateFighter(o, dt, dp);
      o.y = Math.max(w.groundY(o.x, o.z), -1.1);
    }
  }

  updateCiv(o, dt) {
    if (o.state === 'flee') {
      // 朝远离危险的方向跑
      const dx = o.x - o.fx, dz = o.z - o.fz, d = Math.hypot(dx, dz) || 1;
      this.pedStep(o, o.x + (dx / d) * 10, o.z + (dz / d) * 10, PED.run, dt);
      if ((o.t -= dt) <= 0) {
        o.state = 'walk';
        // 回到最近街区的人行道上继续走
        let best = null, bd = 1e9;
        for (const b of this.nearBlocks) for (let k = 0; k < 4; k++) { const c = this.corner(b, k), dd = Math.hypot(c[0] - o.x, c[1] - o.z); if (dd < bd) { bd = dd; best = [b, k]; } }
        if (best) { o.block = best[0]; o.corner = best[1]; const c = this.corner(o.block, o.corner); o.tx = c[0]; o.tz = c[1]; }
      }
      return;
    }
    if (o.state === 'idle') { o.moving = false; if ((o.t -= dt) <= 0) o.state = 'walk'; return; }
    if (!o.block) { o.moving = false; return; }
    if (this.pedStep(o, o.tx, o.tz, PED.walk, dt)) {
      if (Math.random() < 0.12) { o.state = 'idle'; o.t = 1 + Math.random() * 4; }
      const b = o.block, k = o.corner;
      // 到了街角：多数时候沿街区继续走，有时过马路去隔壁街区
      if (Math.random() < 0.3) {
        const horiz = Math.random() < 0.5;
        const di = horiz ? (k === 1 || k === 2 ? 1 : -1) : 0, dj = horiz ? 0 : (k >= 2 ? 1 : -1);
        const nb = this.world.blockAt.get((b.j + dj) * NI + b.i + di);
        if (nb) { o.block = nb; o.corner = horiz ? [1, 0, 3, 2][k] : [3, 2, 1, 0][k]; const c = this.corner(nb, o.corner); o.tx = c[0]; o.tz = c[1]; return; }
      }
      o.corner = (k + o.dir + 4) % 4;
      const c = this.corner(b, o.corner); o.tx = c[0]; o.tz = c[1];
    }
  }

  /** 警察和帮派分子：追、打、开枪 */
  updateFighter(o, dt, dp) {
    const p = this.player, cop = o.kind === 'cop';
    if (o.state === 'leave') {                    // 通缉解除：走开，走远后消失
      const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz) || 1;
      this.pedStep(o, o.x + (dx / d) * 8, o.z + (dz / d) * 8, PED.walk * 1.4, dt);
      if ((o.t += dt) > 25 || dp > 90) o.alive = false, o.deadT = 99;
      return;
    }
    if (cop && this.stars <= 0) { o.state = 'leave'; o.t = 0; return; }
    if ((o.losT -= dt) <= 0) { o.losT = 0.4; o.los = dp < 60 && !this.world.blocked(o.x, o.z, p.x, p.z); }
    if (o.state === 'guard') { o.moving = false; if (o.los && dp < 42 && !p.dead) o.state = 'fight'; return; }
    if (p.dead) { o.moving = false; return; }
    const lvl = cop ? Math.max(1, this.stars) : 3;
    const shootOk = cop ? this.stars >= 2 : true;
    o.shootCd -= dt;
    if (!shootOk) {                               // 一星：只追上来用警棍
      if (dp > 1.7) this.pedStep(o, p.x, p.z, COP.speed, dt, 1.4);
      else { o.moving = false; o.yaw = Math.atan2(p.x - o.x, p.z - o.z); if (o.shootCd <= 0) { o.shootCd = 0.9; o.atkSeq++; this.hurtPlayer(8); this.emit({ type: 'punch', x: o.x, z: o.z }); } }
      return;
    }
    const want = cop ? 13 : 16;
    if (dp > want + 4 || !o.los) this.pedStep(o, p.x, p.z, cop ? COP.speed : 4.2, dt, want);
    else { o.moving = false; o.yaw = Math.atan2(p.x - o.x, p.z - o.z); }
    if (o.los && dp < COP.range && o.shootCd <= 0) {
      o.shootCd = 1 / COP.rate[lvl] * (0.8 + Math.random() * 0.5); o.atkSeq++;
      // 命中率：越远越低；玩家在高速移动时更难打中
      const acc = clamp(0.8 - dp / 55 - (p.speed > 8 ? 0.3 : p.speed > 3 ? 0.12 : 0), 0.08, 0.8);
      const yaw = Math.atan2(p.x - o.x, p.z - o.z) + (Math.random() < acc ? 0 : (Math.random() < 0.5 ? 1 : -1) * (0.06 + Math.random() * 0.1));
      this.hitscan(o.x, o.y + 1.4, o.z, yaw, COP.range + 6, COP.dmg[lvl], false, o);
      this.emit({ type: 'shot', x: o.x, z: o.z, w: lvl >= 4 ? 'smg' : 'pistol', mine: false });
    }
  }

  /* ------------------------------------------------------------ 交通和警车 */

  spawnTraffic(dt) {
    if ((this.spawnT -= dt) > 0) return;
    this.spawnT = 0.6;
    const p = this.player, w = this.world;
    let n = 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i], d = Math.hypot(v.x - p.x, v.z - p.z);
      if (v.ai && v.ai.kind === 'traffic') n++;
      // 回收：走远的交通车、警车、残骸；沉没的车
      const far = d > TRAFFIC.despawn;
      if (v === p.inVeh || v.fixed && v.alive || v.mission) continue;
      if ((far && (v.ai || !v.alive || (!v.parked && !v.used))) || (v.sunk && v.goneT > 4) || (v.wreck && v.goneT > 50) || (far && v.used && d > 500)) this.vehicles.splice(i, 1);
    }
    // 固定载具补位：原来那辆毁了、沉了或被开到很远的地方，而且玩家不在附近时，在原地再放一辆
    const f = this.fixedSpawns[this.fixedI = (this.fixedI + 1) % this.fixedSpawns.length], o = f.v;
    if (o !== p.inVeh && !o.mission && (o.wreck || o.sunk || Math.hypot(o.x - f.x, o.z - f.z) > 150) && Math.hypot(p.x - f.x, p.z - f.z) > 130) {
      o.fixed = false; o.used = false;
      f.v = this.addVehicle(f.type, f.x, f.z, f.yaw, f.color); f.v.fixed = true; f.v.free = f.free;
    }
    if (n >= TRAFFIC.count) return;
    for (let tries = 0; tries < 8; tries++) {
      const a = w.roadNodes[(Math.random() * w.roadNodes.length) | 0], d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < TRAFFIC.spawnMin || d > TRAFFIC.spawnMax) continue;
      const b = a.links[(Math.random() * a.links.length) | 0];
      const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
      const x = a.x + dx * 14 - dz * TRAFFIC.lane, z = a.z + dz * 14 + dx * TRAFFIC.lane;
      if (this.vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 12)) continue;
      let r = Math.random() * 100, type = 'sedan';
      for (const [t, wgt] of TRAFFIC_MIX) { if (r < wgt) { type = t; break; } r -= wgt; }
      const v = this.addVehicle(type, x, z, Math.atan2(dx, dz));
      v.driver = 'npc'; v.ai = { kind: 'traffic', from: a, to: b, panic: 0, stuck: 0, rev: 0 };
      v.vx = dx * 8; v.vz = dz * 8;
      return;
    }
  }

  /** 电脑开车：算出这一帧的方向盘和油门 */
  drive(v, dt) {
    const ai = v.ai, p = this.player, c = { steer: 0, gas: 0, handbrake: false, pitch: 0, fire: false };
    if (ai.kind === 'idle') return c;
    let tx, tz, want = TRAFFIC.speed;
    if (ai.kind === 'traffic') {
      if (ai.panic > 0) { ai.panic -= dt; want *= 1.7; }
      const a = ai.from, b = ai.to, dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
      // 沿着靠右的车道线，朝前方十来米的点开
      const along = (v.x - a.x) * dx + (v.z - a.z) * dz, len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
      const look = Math.min(len - 5, along + 9 + Math.abs(v.speed) * 0.4);
      tx = a.x + dx * look - dz * TRAFFIC.lane; tz = a.z + dz * look + dx * TRAFFIC.lane;
      if (along > len - 11) {                       // 快到路口：选下一条路（尽量不掉头）
        const opts = b.links.filter((n) => n !== a);
        ai.from = b; ai.to = opts.length ? opts[(Math.random() * opts.length) | 0] : a;
      }
      if (along > len - 22) want = Math.min(want, 7);
      // 民用警车：通缉时就近加入追捕
      if (v.type === 'police' && this.stars > 0 && Math.hypot(v.x - p.x, v.z - p.z) < 90) { v.ai = { kind: 'chase', route: null, routeT: 0, stuck: 0, rev: 0 }; v.siren = true; return c; }
    } else {                                        // 追捕
      const dp = Math.hypot(p.x - v.x, p.z - v.z);
      want = 26;
      if (dp < 34 && !this.world.blocked(v.x, v.z, p.x, p.z)) { tx = p.x; tz = p.z; }
      else {
        if ((ai.routeT -= dt) <= 0 || !ai.route || ai.route.length < 2) {
          ai.routeT = 1.5;
          const rt = ai.route = this.world.route(this.world.nearestNode(v.x, v.z), this.world.nearestNode(p.x, p.z));
          // 车已经在第一、二个路口之间时，直接奔第二个，不要掉头回第一个
          while (rt.length > 1 && Math.hypot(v.x - rt[1].x, v.z - rt[1].z) < Math.hypot(rt[0].x - rt[1].x, rt[0].z - rt[1].z) + 4) rt.shift();
        }
        let n = ai.route[0];
        if (ai.route.length > 1 && Math.hypot(n.x - v.x, n.z - v.z) < 12) { ai.route.shift(); n = ai.route[0]; }
        tx = n.x; tz = n.z;
        if (ai.route.length === 1) { tx = p.x; tz = p.z; }
      }
      // 贴近了而且玩家慢下来：停车，警察下车
      if (dp < 15 && p.speed < 5) {
        if (Math.abs(v.speed) < 3) { this.ejectNpc(v, false); v.ai = null; v.siren = true; v.parked = false; return c; }
        c.gas = -1; return c;
      }
      if (dp < 40) want = Math.max(12, Math.min(26, p.speed + 8));
    }
    // 卡住了就倒一下车
    if (ai.rev > 0) { ai.rev -= dt; c.gas = -0.8; c.steer = ai.revSteer; return c; }
    if (Math.abs(v.speed) < 0.8) { if ((ai.stuck += dt) > 2.2) { ai.stuck = 0; ai.rev = 1.1; ai.revSteer = Math.random() < 0.5 ? 1 : -1; } } else ai.stuck = 0;
    const desired = Math.atan2(tx - v.x, tz - v.z), diff = angDiff(v.yaw, desired);
    c.steer = clamp(-diff * 2.4, -1, 1);
    if (Math.abs(diff) > 0.5) want = Math.min(want, 8);
    // 前面有东西就刹车（追捕中的警车不让路）
    if (ai.kind === 'traffic' && this.blockedAhead(v)) want = 0;
    const sp = v.speed;
    c.gas = sp < want - 0.5 ? (ai.kind === 'chase' ? 1 : 0.6) : sp > want + 1.5 ? -0.7 : 0;
    return c;
  }

  /** 车头前方一小段扇形范围内有没有车、行人或玩家 */
  blockedAhead(v) {
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), reach = 6 + Math.abs(v.speed) * 0.9, p = this.player;
    const chk = (x, z, r) => { const dx = x - v.x, dz = z - v.z, f = dx * fx + dz * fz; return f > 1 && f < reach + r && Math.abs(-dx * fz + dz * fx) < 1.5 + r; };
    for (const o of this.vehicles) if (o !== v && !o.sunk && Math.abs(o.x - v.x) < 30 && Math.abs(o.z - v.z) < 30 && chk(o.x, o.z, o.radius * 0.7)) return true;
    for (const o of this.peds) if (o.alive && Math.abs(o.x - v.x) < 25 && Math.abs(o.z - v.z) < 25 && chk(o.x, o.z, 0.4)) return true;
    return !p.inVeh && !p.dead && chk(p.x, p.z, 0.5);
  }

  /** 车与车、车与人的碰撞 */
  collideVehicles() {
    const vs = this.vehicles, p = this.player;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (a.sunk) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (b.sunk) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (Math.abs(dx) > 9 || Math.abs(dz) > 9 || Math.abs(a.y - b.y) > 3.5) continue;
        const min = a.radius + b.radius, d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, ma = a.alive ? a.spec.mass : a.spec.mass * 3, mb = b.alive ? b.spec.mass : b.spec.mass * 3;
        const push = min - d, wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.x -= nx * push * wa; a.z -= nz * push * wa; b.x += nx * push * wb; b.z += nz * push * wb;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const imp = -rel * 1.3;
          a.vx -= nx * imp * wa; a.vz -= nz * imp * wa; b.vx += nx * imp * wb; b.vz += nz * imp * wb;
          if (-rel > 3) {
            const mine = a.driver === 'player' || b.driver === 'player';
            a.damage((-rel - 3) * 6 * (b.spec.cls === 'tank' ? 6 : 1) * (a.spec.cls === 'tank' ? 0 : 1), mine);
            b.damage((-rel - 3) * 6 * (a.spec.cls === 'tank' ? 6 : 1) * (b.spec.cls === 'tank' ? 0 : 1), mine);
            this.emit({ type: 'crash', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, f: -rel, v: a });
            if (mine) { const o = a.driver === 'player' ? b : a; if (o.ai && o.ai.kind === 'chase') this.crime(CRIME.hurtCop * 0.4); else if (o.ai) o.ai.panic = 5; }
          }
        }
      }
      // 撞人
      const sp = Math.hypot(a.vx, a.vz);
      if (sp < 2 || a.flying) continue;
      for (const o of this.peds) {
        if (!o.alive || Math.abs(o.x - a.x) > 6 || Math.abs(o.z - a.z) > 6) continue;
        if (Math.hypot(o.x - a.x, o.z - a.z) > a.radius * 0.85 + 0.4) continue;
        const mine = a.driver === 'player';
        if (sp > 4) this.hurtPed(o, sp * 5, mine, a.x, a.z);
        else { const l = Math.hypot(o.x - a.x, o.z - a.z) || 1; o.x += ((o.x - a.x) / l) * 0.3; o.z += ((o.z - a.z) / l) * 0.3; }
      }
      if (!p.inVeh && !p.dead && a.driver !== 'player' && sp > 5 && Math.hypot(p.x - a.x, p.z - a.z) < a.radius * 0.85 + 0.45 && Math.abs(a.y - p.y) < 3) this.hurtPlayer(sp * 2.2);
    }
  }

  /* ------------------------------------------------------------ 主循环 */
  update(dt) {
    this.time += dt;
    const p = this.player, c = this.ctl;
    this.updatePlayer(dt);
    for (const v of this.vehicles) {
      const ctl = v.driver === 'player' ? c : v.ai && v.driver ? this.drive(v, dt) : NOCTL;
      v.update(dt, v.driver === 'player' && p.dead ? NOCTL : ctl);
    }
    this.collideVehicles();
    if (p.inVeh) { p.x = p.inVeh.x; p.y = p.inVeh.y; p.z = p.inVeh.z; }
    this.updatePeds(dt);
    this.updateShots(dt);
    this.spawnTraffic(dt);
    this.spawnPeds(dt);
    this.updateWanted(dt);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.t > 0) k.t -= dt;
      if (k.life !== undefined && (k.life -= dt) <= 0) this.pickups.splice(i, 1);
    }
    this.missions.update(dt);
  }

  /** 存档内容 */
  save() { const p = this.player; return { money: p.money, done: [...this.missions.done], owned: p.owned, ammo: p.ammo.map((a) => (a === Infinity ? 0 : a)) }; }
}
