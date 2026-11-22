// 落日湾：游戏的核心逻辑——玩家、载具、行人、交通、警察通缉、武器、拾取物。
// 只有规则，没有画面代码，可以脱离浏览器跑（测试用）。画面层每帧读这里的状态，并消费 events 里的事件。
import { World, terrainY, SIZE, CITY_Y, PITCH, NI, BASE } from './world.js';
import { Vehicle } from './vehicles.js';
import { VEH, TRAFFIC_MIX, CAR_COLORS, WEAPONS, WEAPON_INDEX, AMMO, PLAYER, PED, COP, CRIME, WANTED, TRAFFIC } from './config.js';
import { clamp, angDiff } from '../../shared/js/util.js';
import { Missions } from './missions.js';

const NOCTL = { steer: 0, gas: 0, handbrake: false, pitch: 0, fire: false, rocket: false };
let PID = 1;
/** 取整到 1 位小数（环境快照里的坐标，省流量） */
const r1 = (n) => Math.round(n * 10) / 10;

export class Sim {
  /** @param {object} [save] 存档：{ money, done:[任务 id], owned:[bool], ammo:[number] } */
  constructor(save = {}) {
    this.world = new World();
    this.time = 0;
    this.refillToastT = -99;   // 上一次弹“子弹已补满”提示的游戏时间（节流用，见 refillWeapon）
    this.rebuildToastT = -99;   // 上一次弹“XX已重建”提示的游戏时间（节流用，见 rebuildBuilding）
    this.rebuildQueue = [];   // 等重建的建筑（被炸平后按 rebuildAt 排队，见 damageBuilding / updateRebuilds）
    this.events = [];
    this.vehicles = []; this.peds = []; this.shots = []; this.pickups = [];
    const sp = this.world.places.spawn;
    // 出生就拥有全部 6 种武器（2026-11-21）：不用拾取或解锁。旧存档只有部分武器时也补齐：
    // 已有的武器保留存档里的子弹数；缺的武器按初始子弹数补；子弹数为 0 的也按初始数补满。
    const owned = WEAPONS.map(() => true);
    const ammo = AMMO.slice();
    if (save.ammo) for (let i = 1; i < WEAPONS.length; i++) if (save.owned && save.owned[i]) ammo[i] = save.ammo[i] ?? AMMO[i];
    for (let i = 1; i < WEAPONS.length; i++) if (!(ammo[i] > 0)) ammo[i] = AMMO[i];
    this.player = {
      x: sp.x, z: sp.z, y: this.world.groundY(sp.x, sp.z), yaw: sp.face, px: sp.x, py: 0, pz: sp.z,
      hp: PLAYER.hp, armor: 0, money: save.money ?? 200, inVeh: null, moving: false, swim: false, running: false,
      weapon: 1, owned, ammo,
      shootCd: 0, atkSeq: 0, dead: false, deadT: 0, hitT: 0, godT: 0, speed: 0,
    };
    this.player.ammo[0] = Infinity;
    // 玩家的操作意图，由界面每帧填写；aimSet 表示本帧有没有镜头瞄准方向（有就用它，没有就用车头方向）
    this.ctl = { mx: 0, mz: 0, steer: 0, gas: 0, handbrake: false, pitch: 0, fire: false, rocket: false, enter: false, swap: false, run: false, aimYaw: 0, aimSet: false };
    // 通缉
    this.heat = 0; this.stars = 0; this.unseenT = 0; this.copSpawnT = 0; this.seen = false; this.seeT = 0; this.wantedLock = false;
    this.spawnT = 0; this.pedT = 0; this.nearBlocks = []; this.nearT = 0;
    this.fixedSpawns = []; this.fixedI = 0;       // 固定停放的载具（飞机、船、坦克等）：毁了或被开走后会在原地补一辆
    this.net = null;   // 联机（Hud 加入后才设）：只用来同步建筑/载具状态，单机时一直是 null
    this.netHost = false;   // 联机 v2：是不是房主（房主才模拟路人/警察/警车，见 setHost）
    this.netGod = false;    // 联机 v2：全员无敌开关（任何人拨动都影响所有在线玩家，见 Net.setGod）；开的时候 hurtPlayer 直接返回，主角座驾也按 godOn 跟着无敌
    this.netPedSeq = 0;     // 房主给行人编 netId 的计数器（快照里按 netId 认人）
    this.netCarSeq = 0;     // 房主给追捕警车编 netId 的计数器
    this.runBudget = PLAYER.runCap;   // 跑步预算（令牌桶）：桶容量 40 秒，跑动每秒扣 1 秒，步行每秒回 1 秒
    this.runLocked = false;            // 桶扣空后锁死：强制步行，直到走路回满 runResume 秒才解锁（不然每走一帧回的桶马上又被扣空，跑/走每帧闪）
    this.pendingTakes = new Map();           // 拾取物：已发给房主、等快照确认的领取请求（key -> 发出时间）
    this.recentTakes = [];                   // 拾取物：最近 5 秒被捡的一次性拾取物（给请求方在快照里确认用的）
    this.setupWorld();
    this.missions = new Missions(this, save.done || []);
  }

  /* ------------------------------------------------------------ 基础 */
  emit(ev) { if (this.events.length < 600) this.events.push(ev); }
  toast(text, kind = 'info') { this.emit({ type: 'toast', text, kind }); }
  addMoney(n) { this.player.money = Math.max(0, Math.round(this.player.money + n)); this.emit({ type: 'money', n }); }

  /** 生成一辆车 */
  addVehicle(type, x, z, yaw = 0, color) {
    const v = new Vehicle(this, type, x, z, yaw, color ?? (type === 'taxi' ? 0xf2c230 : type === 'police' ? 0xf4f6fa : type === 'tank' ? 0x5c6b48 : type === 'plane' ? 0xe8ecf2 : type === 'heli' ? 0xd0362e : type === 'boat' ? 0xf0f0f0 : type === 'target' ? 0xc0392b : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0]));
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
    for (const [x, z, yaw] of P.helis) keep(this.addVehicle('heli', x, z, yaw));   // 机场停机坪的直升机
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
    // 固定拾取物（过一阵会重新出现）：医疗包、护甲、武器、消星。
    // 联机：固定拾取物是共享的（房主说了算），key 按创建顺序编（f0、f1……），所有客户端都一样，换房主也不变。
    const at = (i, j, dx = 9.5, dz = 9.5) => { const nd = w.node(i, j); return nd ? [nd.x + dx, nd.z + dz] : null; };
    let fk = 0;
    const add = (pos, type, val, respawn = 90) => { if (pos) this.pickups.push({ id: PID++, key: 'f' + (fk++), type, val, x: pos[0], z: pos[1], y: w.groundY(pos[0], pos[1]), t: 0, respawn, fixed: true, shared: true, by: '', byT: 0 }); };
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
    for (const p of this.peds) if (p.kind === 'cop' && p.alive && !p.remote) p.state = 'leave';   // 镜像警察不管：房主那边目标星清了才会让他们走
    // 还在路上的警车关掉警笛，变回普通巡逻车（镜像警车不管，等房主快照）
    for (const v of this.vehicles) if (v.ai && v.ai.kind === 'chase' && !v.remoteDriven) {
      const a = this.world.nearestNode(v.x, v.z);
      v.siren = false; v.ai = { kind: 'traffic', from: a, to: a.links[(Math.random() * a.links.length) | 0], panic: 0, stuck: 0, rev: 0 };
    }
  }

  /**
   * 联机 v2：警察的追捕目标——通缉星最多的在线玩家（并列取离 (x, z) 最近的）。
   * 没人有通缉就追本地玩家。返回 {x, z, y, speed, dead, uid, stars}，uid 是 null 时就是本地玩家。
   * 单机时 net 是 null，直接返回本地玩家，和原来一模一样。
   */
  copTarget(x = this.player.x, z = this.player.z) {
    const p = this.player;
    let best = { x: p.x, z: p.z, y: p.y, speed: p.speed, dead: p.dead, uid: null, stars: this.stars, dist: Math.hypot(p.x - x, p.z - z) };
    if (!this.net) return best;
    for (const [uid, rp] of this.net.remotePlayers) {
      const stars = rp.stars | 0;
      if (stars <= 0 || rp.dead) continue;
      const d = Math.hypot(rp.x - x, rp.z - z);
      if (stars > best.stars || (stars === best.stars && d < best.dist)) {
        best = { x: rp.x, z: rp.z, y: rp.y ?? 0, speed: rp.speed ?? 0, dead: !!rp.dead, uid, stars, dist: d };
      }
    }
    return best;
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
  }

  /** 派警车（原来 updateWanted 的后半段，拆出来因为联机时只有房主能派：见 update 里的调用）。
   * 警车派到追捕目标（copTarget，星最多的在线玩家）附近，不是只派到房主身边。 */
  spawnCops(dt) {
    if ((this.copSpawnT -= dt) > 0) return;
    this.copSpawnT = WANTED.spawnEvery;
    const tgt = this.copTarget();
    if (tgt.stars <= 0) return;
    let cops = 0, cars = 0;
    for (const c of this.peds) if (c.kind === 'cop' && c.alive && c.state !== 'leave') cops++;
    for (const v of this.vehicles) if (v.ai && v.ai.kind === 'chase' && v.alive) { cars++; cops += 2; }
    if (cops >= COP.count[tgt.stars] || cars >= COP.cars[tgt.stars]) return;
    const nodes = this.world.roadNodes;
    for (let tries = 0; tries < 12; tries++) {
      const n = nodes[(Math.random() * nodes.length) | 0], d = Math.hypot(n.x - tgt.x, n.z - tgt.z);
      if (d < 90 || d > 190) continue;
      const v = this.addVehicle('police', n.x, n.z, Math.atan2(tgt.x - n.x, tgt.z - n.z));
      v.driver = 'npc'; v.siren = true; v.ai = { kind: 'chase', route: null, routeT: 0, stuck: 0, rev: 0, node: n };
      return;
    }
  }

  /* ------------------------------------------------------------ 玩家 */

  /** 无敌是否开着：本地无敌（godT，单机开关，无限时长）或联机全员无敌（netGod，任何人拨动都影响所有在线玩家）。
   * 玩家本人和主角座驾共用这一条：开着时人车都不掉血，关了人车都照常受伤（2026-11-22 用户纠正：座驾无敌仅在无敌开启时有效）。 */
  godOn() { return this.player.godT > 0 || this.netGod; }

  hurtPlayer(dmg) {
    const p = this.player;
    // 伤害唯一入口：PvP、警察、爆炸、撞车、摔落全走这里。无敌（godT / netGod，见 godOn）在这里挡；
    // 坐车的分摊在下面：人只吃 20%，车吃 1.6 倍——无敌关了分摊照旧生效（车能被打掉血了），无敌开着整段直接返回、人车都不掉血。
    if (p.dead || this.godOn()) return;
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
    // PvP 死（Net 收到致死伤害时立的旗）：不扣医药费、钱留着、通缉不变；其他死法照旧（医药费、清通缉）
    const pvp = !!p.pvpDeath; p.pvpDeath = false;
    const fee = pvp ? 0 : Math.min(300, Math.round(p.money * 0.1));
    if (fee > 0) this.addMoney(-fee);
    if (!pvp) this.clearWanted();
    this.emit({ type: 'respawn', fee });
  }

  /** 离玩家最近、可以上的车。联机里房主派来的追捕警车（remoteDriven）不能抢：它是房主模拟的，抢了会两边打架 */
  nearestVehicle(maxD = PLAYER.enterDist) {
    const p = this.player; let best = null, bd = 1e9;
    for (const v of this.vehicles) {
      if (!v.usable || (v.flying && v.driver) || v.remoteDriven) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z) - v.radius;
      if (d < maxD - 1.4 && d < bd && Math.abs(v.y - p.y) < 3) { bd = d; best = v; }
    }
    return best;
  }

  enterVehicle(v) {
    const p = this.player;
    if (v.remoteDriven) { this.toast('这辆警车正在追捕中，联机时不能抢'); return; }   // 兜底：nearestVehicle 已经跳过它了
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
    if (!force && v.flying) { this.toast('先降落再下机'); return; }
    v.driver = null; p.inVeh = null;
    // 落脚点：先试驾驶位一侧（左侧），不行换右侧，再不行就原地
    const rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw), d = v.spec.wid / 2 + 0.9, w = this.world;
    let done = false;
    for (const sg of [-1, 1]) {
      const x = v.x + rx * d * sg, z = v.z + rz * d * sg, t = { x, z };
      if (!w.collide(t, PLAYER.radius, v.y + 1)) { p.x = x; p.z = z; done = true; break; }   // 高 1 米查：停在楼顶上下机时，落脚点在屋顶上不被推出去；地面上下机时楼顶仍在 1 米以上，照旧挡住
    }
    if (!done) { p.x = v.x; p.z = v.z; }
    // 从船上下来时如果旁边就是栈桥，直接站到栈桥上
    if (v.spec.cls === 'boat') { const pr = w.places.pier; if (p.x > pr.x0 - 9 && p.x < pr.x1 + 9 && p.z > pr.z0 && p.z < pr.z1 + 6) { p.x = clamp(p.x, pr.x0 + 1, pr.x1 - 1); p.z = Math.min(p.z, pr.z1 - 1); } }
    p.px = p.x; p.pz = p.z; p.y = Math.max(w.supportY(p.x, p.z), -1.15); p.yaw = v.yaw;   // 下机站在地面，或者停在楼顶时站在屋顶上
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
      p.x = v.x; p.y = v.y; p.z = v.z; p.yaw = v.yaw; p.speed = Math.abs(v.speed); p.moving = false; p.swim = false; p.running = false;
      if (c.rocket) this.vehicleRocket();   // 车上只能发火箭筒（步行开火到不了这里，坦克炮走载具自己的 c.fire）
      return;
    }
    // 步行：跑步是步行速度 ×3（PLAYER.runMul），按住 Shift / 跑步按钮；跑步预算是令牌桶：
    // 桶容量 40 秒（游戏时间，暂停冻结），跑动每秒扣 1 秒，步行每秒回 1 秒（runRefill）；站着不动不扣也不回，扣空强制步行。
    // 扣空后锁死（runLocked）：继续走路回桶，回满 5 秒（runResume）才解锁再跑——不然每走一帧回的桶马上又被扣空，跑/走每帧闪。
    // 60 秒里最多能跑约 50 秒（先跑满 40 秒、走 20 秒回 20 秒、再跑 10 秒）；40 秒上限是软指导、不是硬顶（2026-11-22 01:49 用户定令牌桶）。
    const m = Math.hypot(c.mx, c.mz), deep = w.inWater(p.x, p.z) && terrainY(p.x, p.z) < -1.2;
    p.swim = deep;
    const wantRun = !!c.run && !deep;
    if (this.runLocked && this.runBudget >= PLAYER.runResume) this.runLocked = false;
    const running = m > 0.12 && wantRun && !this.runLocked && this.runBudget > 0.01;   // 0.01 秒以下当空（和 HUD 跑步键的启用阈值一致，避免浮点余量多跑一帧）
    const sp = deep ? PLAYER.swim : PLAYER.speed * (running ? PLAYER.runMul : 1);
    if (running) {
      this.runBudget = Math.max(0, this.runBudget - dt);
      if (this.runBudget <= 0.01) this.runLocked = true;
    } else if (m > 0.12 && !deep) this.runBudget = Math.min(PLAYER.runCap, this.runBudget + dt * PLAYER.runRefill);
    p.running = running;
    if (m > 0.12) {
      const k = Math.min(1, m) / m;
      p.x += c.mx * k * sp * dt; p.z += c.mz * k * sp * dt; p.yaw = Math.atan2(c.mx, c.mz); p.moving = true; p.speed = sp * Math.min(1, m);
    } else { p.moving = false; p.speed = 0; }
    // 站在楼顶上时不被建筑碰撞推下去（屋顶行走）；走到边缘、脚下没楼顶了就恢复碰撞，正常掉下去
    const onRoof = p.y > w.groundY(p.x, p.z) + 0.5 && Math.abs(p.y - w.supportY(p.x, p.z)) < 0.6;
    if (!onRoof) w.collide(p, PLAYER.radius, p.y);
    for (const o of this.vehicles) {             // 不能穿过车
      if (o.sunk) continue;
      const dx = p.x - o.x, dz = p.z - o.z, min = o.radius * 0.8 + PLAYER.radius, d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6 && Math.abs(o.y - p.y) < 3) { const d = Math.sqrt(d2); p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min; }
    }
    p.x = clamp(p.x, 12, SIZE - 12); p.z = clamp(p.z, 12, SIZE - 12);
    const gy = w.supportY(p.x, p.z);   // 地面高度，或者脚下建筑的屋顶高度（站在楼顶上时）
    p.y = deep ? -1.15 : p.y + (Math.max(gy, -1.15) - p.y) * Math.min(1, dt * 16);
    if (c.fire && !deep) this.playerAttack();
    // 拾取
    for (const k of this.pickups) {
      if (k.t > 0 || Math.hypot(k.x - p.x, k.z - p.z) > PLAYER.pickupDist) continue;
      if (k.remote) {
        // 镜像拾取物（房主在管）：不直接捡，发领取请求给房主；房主批了、快照里 by 是我，效果才生效（见 applyEnvSnapshot）。
        // 一个拾取物同时只发一个请求（等 3 秒超时再说），对我没用的不发（满血不抢医疗包）。
        if (!this.pickupUseful(k)) continue;
        const pt = this.pendingTakes.get(k.key);
        if (pt && Date.now() - pt < 3000) continue;
        this.pendingTakes.set(k.key, Date.now());
        this.net?.requestTake(k.key);
        continue;
      }
      this.collect(k);
    }
  }

  /** 跑步预算（令牌桶）：桶里还剩多少秒可跑。跑动扣、步行回，站着不动不扣也不回。 */
  runBudgetLeft() { return this.runBudget; }
  /** 现在能不能跑（HUD 跑步键的启用状态）：没锁死、桶里还有。锁死期按钮一直灰着，直到回满 5 秒。 */
  runReady() { return !this.runLocked && this.runBudget > 0.01; }

  /** 拾取物的效果（只生效，不记账）：钱、回血、护甲、消星、武器弹药。满血捡医疗包、没星捡消星，返回 false（不消耗拾取物）。 */
  applyPickupEffect(type, val) {
    const p = this.player;
    if (type === 'cash') { this.addMoney(val); return true; }
    if (type === 'health') { if (p.hp >= PLAYER.hp) return false; p.hp = PLAYER.hp; return true; }
    if (type === 'armor') { if (p.armor >= 100) return false; p.armor = 100; return true; }
    if (type === 'star') { if (this.stars <= 0) return false; this.heat = Math.max(0, this.stars - 1); this.stars = Math.floor(this.heat + 1e-6); this.emit({ type: 'stars', n: this.stars, up: false }); if (!this.stars) this.clearWanted(); return true; }
    if (type === 'weapon') { const i = WEAPON_INDEX[val]; p.owned[i] = true; p.ammo[i] += { pistol: 60, smg: 150, shotgun: 24, rocket: 6 }[val]; p.weapon = i; return true; }
    return false;
  }

  /** 这拾取物对我现在有没有用（发领取请求前先判断，免得白白把共享拾取物消耗掉）。 */
  pickupUseful(k) {
    const p = this.player;
    if (k.type === 'health') return p.hp < PLAYER.hp;
    if (k.type === 'armor') return p.armor < 100;
    if (k.type === 'star') return this.stars > 0;
    return true;   // 钱、武器总是有用
  }

  /** 本地拾取（单机、房主自己捡、帮派怪掉的本地钱）：生效后记账。共享拾取物被捡时记下是谁捡的（by），快照带给别人看。 */
  collect(k) {
    if (!this.applyPickupEffect(k.type, k.val)) return;   // 没用上（满血捡医疗包），拾取物留着
    this.emit({ type: 'pickup', k });
    if (k.shared && this.net) { k.by = this.net.uid; k.byT = Date.now(); }
    if (k.fixed) k.t = k.respawn;
    else this.pickups.splice(this.pickups.indexOf(k), 1);
  }

  /** 联机：房主收到领取请求——拾取物还在且可用就批掉（固定物进重生倒计时，一次性的直接删掉并记一笔 recentTakes，
   * 让请求方在快照里看到 by 是自己才生效）；已经被别人捡了就忽略（请求方等 3 秒超时后自己会重试）。 */
  applyTake(key, byUid) {
    const k = this.pickups.find((q) => q.key === key && q.shared);
    if (!k || k.t > 0) return false;
    k.by = byUid; k.byT = Date.now();
    if (k.fixed) k.t = k.respawn;
    else {
      this.pickups.splice(this.pickups.indexOf(k), 1);
      this.recentTakes.push({ key: k.key, type: k.type, val: k.val, by: byUid, byT: Date.now() });
    }
    return true;
  }

  /* ------------------------------------------------------------ 武器 */

  /** 直接切到第 i 种武器（数字键 1~6 用）。出生就全拥有，所以任何一把都能直接切到 */
  selectWeapon(i) {
    const p = this.player;
    if (i < 0 || i >= WEAPONS.length || !p.owned[i]) return;
    p.weapon = i; this.emit({ type: 'weapon', i });
  }

  /** 子弹打空时自动补满到该武器的初始子弹数（config.js 的 AMMO），不改武器、不改伤害。
   * 补满提示节流：1 秒内只弹一次——火箭筒现在 10 发/秒、6 发一补，每 0.6 秒就补一次，
   * 不节流的话“火箭筒子弹已补满”会一直刷屏。右上武器栏的闪烁（refill 事件）不受影响，照旧每次都闪。 */
  refillWeapon(i) {
    const p = this.player;
    p.ammo[i] = AMMO[i];
    this.emit({ type: 'refill', i });
    if (this.time - this.refillToastT >= 1) { this.refillToastT = this.time; this.toast(`${WEAPONS[i].name}子弹已补满`); }
  }

  /** 自动瞄准：优先正在追捕/敌对的人，其次是准星附近的其他目标。返回 { x, z, ped?, veh?, remoteUid? } 或 null。
   * 联机时远端玩家也算敌对目标（remoteUid 记着是谁，playerAttack 按它发伤害事件） */
  pickAim(range) {
    const p = this.player, yaw = this.ctl.aimYaw;
    let best = null, bs = 1e9;
    const consider = (x, z, hostile, obj, isVeh, remoteUid = null) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > range || d < 0.3) return;
      const a = Math.abs(angDiff(yaw, Math.atan2(x - p.x, z - p.z)));
      if (a > (hostile ? 0.75 : 0.2) + (d < 6 ? 0.5 : 0)) return;
      const s = d + a * 30 + (hostile ? -200 : 0);
      if (s < bs && !this.world.blocked(p.x, p.z, x, z)) { bs = s; best = { x, z, ped: isVeh ? null : obj, veh: isVeh ? obj : null, remoteUid }; }
    };
    for (const o of this.peds) if (o.alive) consider(o.x, o.z, o.kind === 'gang' || (o.kind === 'cop' && o.state !== 'leave'), o, false);
    for (const v of this.vehicles) if (v.alive && v !== p.inVeh) consider(v.x, v.z, !!(v.ai && v.ai.kind === 'chase') || v.type === 'target', v, true);
    if (this.net) for (const [uid, rp] of this.net.remotePlayers) if (!rp.dead) consider(rp.x, rp.z, true, null, false, uid);
    return best;
  }

  /** 当前武器的 id（发伤害事件时写在 weapon 字段里，给排行榜/击杀播报看；爆炸时可能已经切武器了，只是个显示标签） */
  playerWeaponId() { return WEAPONS[this.player.weapon].id; }

  playerAttack() {
    const p = this.player, wp = WEAPONS[p.weapon];
    // 冷却用 1e-9 而不是 0：0.1 秒不是 3 帧（1/30 秒）的整数倍，3 帧后 shootCd 会剩约 1e-17，
    // 用 > 0 判断会多等一帧，10 发/秒实际只有 7.5 发/秒
    if (p.shootCd > 1e-9) return;
    if (!wp.melee && p.ammo[p.weapon] <= 0) this.refillWeapon(p.weapon);   // 子弹是 0 就先补满再开火（不会换武器）
    p.shootCd = 1 / wp.rate; p.atkSeq++;
    const tg = this.pickAim(wp.melee ? wp.range + 0.6 : wp.range);
    const yaw = tg ? Math.atan2(tg.x - p.x, tg.z - p.z) : (wp.melee ? p.yaw : this.ctl.aimYaw);
    p.yaw = yaw;
    if (wp.melee) {
      this.emit({ type: 'punch', x: p.x, z: p.z });
      if (tg && tg.remoteUid && Math.hypot(tg.x - p.x, tg.z - p.z) < wp.range + 0.55) this.net?.sendHit(tg.remoteUid, wp.dmg, 'pvp', wp.id);
      else if (tg && tg.ped && Math.hypot(tg.x - p.x, tg.z - p.z) < wp.range + tg.ped.r) this.hurtPed(tg.ped, wp.dmg, true, p.x, p.z);
      else if (tg && tg.veh && Math.hypot(tg.x - p.x, tg.z - p.z) < wp.range + tg.veh.radius) this.damageVehicle(tg.veh, 4, true);
      return;
    }
    p.ammo[p.weapon]--;
    if (p.ammo[p.weapon] <= 0) this.refillWeapon(p.weapon);   // 打到 0 的瞬间补满，正在开火的那把能继续开火
    this.noise(p.x, p.z, 45);
    if (wp.explosive) {
      // shoot() 自己会发一个 shot 事件（位置是火箭出发点），这里不再单独发一个，不然每发火箭有两个 shot 事件、发射音效响两遍
      if (wp.id === 'fireworks') {
        // 烟花：一轮同时向 8 个方向齐射，方向是瞄准方向 + k*45 度（k=0..7）；每枚都是独立的 shoot() 调用，
        // 所以每枚有自己的 shot 事件和音效判定（kind 用 'fireworks'，view.js 里按火箭筒一样放 'boost' 音效）；
        // 弹药只在上面扣过 1 发（这一轮 8 枚只耗 1 发弹药）。
        // 联机：8 枚只发 1 个开火事件（接收方按方向展开同样的 8 枚），所以这里的 shoot() 都加 quiet
        this.net?.sendShot({ kind: 'fireworks', x: p.x, y: p.y + 1.5, z: p.z, dx: Math.sin(yaw), dy: 0.02, dz: Math.cos(yaw), speed: wp.speed, radius: wp.radius, range: Infinity });
        for (let k = 0; k < 8; k++) {
          const a = yaw + (k * Math.PI) / 4;
          this.shoot({ x: p.x + Math.sin(a) * 0.8, y: p.y + 1.5, z: p.z + Math.cos(a) * 0.8, dx: Math.sin(a), dy: 0.02, dz: Math.cos(a), speed: wp.speed, range: Infinity, radius: wp.radius, dmg: wp.dmg, byPlayer: true, kind: 'fireworks', owner: null, quiet: true });
        }
        return;
      }
      this.shoot({ x: p.x + Math.sin(yaw) * 0.8, y: p.y + 1.5, z: p.z + Math.cos(yaw) * 0.8, dx: Math.sin(yaw), dy: 0.02, dz: Math.cos(yaw), speed: wp.speed, range: Infinity, radius: wp.radius, dmg: wp.dmg, byPlayer: true, kind: 'rocket', owner: null });   // 火箭筒射程无限：飞到命中才爆炸（瞄准辅助还是只看 130 米内，见上面的 pickAim）
      return;
    }
    // 即时命中武器：每扣一次扳机只发 1 个开火事件（霰弹 7 粒也只发 1 个，接收方按第一粒的落点画一条曳光线）；
    // 伤害还是本地 hitscan 算（打中远端玩家就写 hits 事件，见 hitscan）
    let first = null;
    for (let k = 0; k < (wp.pellets || 1); k++) { const r = this.hitscan(p.x, p.y + 1.4, p.z, yaw + (Math.random() - 0.5) * 2 * wp.spread, wp.range, wp.dmg, true, null); if (!first) first = r; }
    if (first) this.net?.sendShot({ kind: wp.id, x: p.x, y: p.y + 1.4, z: p.z, dx: Math.sin(yaw), dy: 0, dz: Math.cos(yaw), speed: 0, radius: 0, range: wp.range, hx: first.x2, hy: first.y2, hz: first.z2 });
    this.emit({ type: 'shot', x: p.x, z: p.z, w: wp.id, mine: true });
  }

  /**
   * 车上发射火箭筒：六种载具都能发，只发火箭筒，不动当前选中的武器，下车后武器和弹药状态不变。
   * 方向用镜头瞄准方向（ctl.aimYaw），没有瞄准方向时用车头方向；火箭从车顶前方出发，射程无限。
   * owner 传自己的车：updateShots 不会打中自己的车，explode 也不会炸伤自己的车和车里的人。
   * 弹药走玩家自己的火箭筒弹药数，打空自动补满到 6 发；射速、伤害、射程、爆炸半径和步行一致。
   */
  vehicleRocket() {
    const p = this.player, v = p.inVeh, R = WEAPON_INDEX.rocket;
    if (!v || !p.owned[R] || p.shootCd > 1e-9) return;   // 冷却阈值见 playerAttack：1e-9 才能真到 10 发/秒
    if (p.ammo[R] <= 0) this.refillWeapon(R);
    p.shootCd = 1 / WEAPONS[R].rate; p.atkSeq++;
    const yaw = this.ctl.aimSet ? this.ctl.aimYaw : v.yaw;
    const wp = WEAPONS[R];
    p.ammo[R]--;
    if (p.ammo[R] <= 0) this.refillWeapon(R);   // 打到 0 的瞬间补满
    this.noise(v.x, v.z, 45);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // shoot() 自己会发一个 shot 事件，这里不再单独发一个，不然每发火箭有两个 shot 事件、发射音效响两遍
    this.shoot({ x: v.x + fx * (v.spec.len / 2 + 1), y: v.y + 2.2, z: v.z + fz * (v.spec.len / 2 + 1), dx: fx, dy: 0.02, dz: fz, speed: wp.speed, range: Infinity, radius: wp.radius, dmg: wp.dmg, byPlayer: true, kind: 'rocket', owner: v });
  }

  /** 枪响：附近的行人受惊逃跑，路上的司机踩油门；有人听见还会报警。
   * 联机：镜像行人不本地改状态（房主的快照会把逃跑带过来，见 Net._onShot 里房主调的 noise） */
  noise(x, z, r) {
    let heard = false;
    for (const o of this.peds) {
      if (!o.alive || o.kind !== 'civ' || o.remote) continue;
      if (Math.hypot(o.x - x, o.z - z) < r) { o.state = 'flee'; o.t = 6 + Math.random() * 4; o.fx = x; o.fz = z; heard = true; }
    }
    for (const v of this.vehicles) if (v.ai && v.ai.kind === 'traffic' && Math.hypot(v.x - x, v.z - z) < r) v.ai.panic = 6;
    if (heard && Math.random() < 0.35) this.crime(CRIME.gunfire);
  }

  /**
   * 即时命中的子弹：沿方向找到第一个打中的人或车（被建筑挡住则打在墙上），并发出弹道事件。
   * byPlayer 为 true 时目标是行人/警察/车/远端玩家；否则目标是玩家。
   * 打中远端玩家不直接扣血，改写 hits 事件给对方自己扣（一次权威，见 Net.sendHit）。
   * 返回曳光线的落点 {x2, y2, z2, hit}，playerAttack 拿它发开火事件（每扣一次扳机只发 1 个）。
   */
  hitscan(x, y, z, yaw, range, dmg, byPlayer, shooter) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw), p = this.player;
    let best = range, hitPed = null, hitVeh = null, hitMe = false, hitRemote = null;
    const test = (ox, oz, r) => {              // 射线和圆相交的距离
      const tx = ox - x, tz = oz - z, t = tx * dx + tz * dz;
      if (t < 0 || t > best) return -1;
      const px = tx - dx * t, pz = tz - dz * t;
      return px * px + pz * pz < r * r ? t : -1;
    };
    if (byPlayer) {
      for (const o of this.peds) { if (!o.alive) continue; const t = test(o.x, o.z, 0.55); if (t >= 0) { best = t; hitPed = o; hitVeh = null; hitRemote = null; } }
      for (const v of this.vehicles) { if (!v.alive || v === p.inVeh) continue; const t = test(v.x, v.z, v.radius * 0.85); if (t >= 0) { best = Math.max(0.5, t - v.radius * 0.5); hitVeh = v; hitPed = null; hitRemote = null; } }
      if (this.net) for (const [uid, rp] of this.net.remotePlayers) { if (rp.dead) continue; const t = test(rp.x, rp.z, rp.vehicle ? 2.2 : 0.55); if (t >= 0) { best = t; hitRemote = uid; hitPed = null; hitVeh = null; } }
    } else if (!p.dead) {
      const t = test(p.x, p.z, p.inVeh ? p.inVeh.radius * 0.8 : 0.5);
      if (t >= 0) { best = t; hitMe = true; }
    }
    // 建筑遮挡：按 3 米步长沿弹道检查
    const w = this.world;
    for (let t = 3; t < best; t += 3) {
      const cx = x + dx * t, cz = z + dz * t; let b = false;
      w.nearBuildings(cx, cz, 0.5, (bd) => { if (cx > bd.x0 && cx < bd.x1 && cz > bd.z0 && cz < bd.z1 && y < bd.y0 + bd.h) b = true; });
      if (b) { best = t; hitPed = hitVeh = null; hitMe = false; hitRemote = null; break; }
    }
    if (hitPed) this.hurtPed(hitPed, dmg, true, x, z);
    else if (hitVeh) { this.damageVehicle(hitVeh, dmg * (hitVeh.spec.cls === 'tank' ? 0.1 : 1), true); if (hitVeh.ai && hitVeh.ai.kind === 'chase') this.crime(CRIME.hurtCop * 0.3); else if (hitVeh.ai) hitVeh.ai.panic = 6; }
    else if (hitRemote) this.net.sendHit(hitRemote, dmg, 'pvp', this.playerWeaponId());
    else if (hitMe) this.hurtPlayer(dmg);
    this.emit({ type: 'tracer', x1: x, y1: y, z1: z, x2: x + dx * best, y2: y - 0.2, z2: z + dz * best, hit: !!(hitPed || hitVeh || hitMe || hitRemote), mine: byPlayer });
    return { x2: x + dx * best, y2: y - 0.2, z2: z + dz * best, hit: !!(hitPed || hitVeh || hitMe || hitRemote) };
  }

  /** 飞行的炮弹/火箭。o：x,y,z, dx,dy,dz, speed, range, radius, dmg, byPlayer, kind, owner（不会打到自己的车），quiet（烟花一轮 8 枚共用 1 个开火事件时用，见 playerAttack），remote（别人发来的，只看不伤） */
  shoot(o) {
    this.shots.push({ ...o, id: PID++, px: o.x, py: o.y, pz: o.z, left: o.range, alive: true });
    this.emit({ type: 'shot', x: o.x, z: o.z, w: o.kind, mine: o.byPlayer });
    // 联机：自己开的火广播一个开火事件（烟花一轮 8 枚只发 1 个，见 playerAttack 的 quiet；坦克炮弹也走这里，byPlayer 只在司机是玩家时为 true）
    if (o.byPlayer && this.net && !o.quiet && !o.remote) this.net.sendShot(o);
  }

  updateShots(dt) {
    const w = this.world;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.px = s.x; s.py = s.y; s.pz = s.z;
      const step = s.speed * dt;
      s.x += s.dx * step; s.y += s.dy * step; s.z += s.dz * step; s.left -= step; s.dy -= dt * 0.12;
      let hit = s.left <= 0 || s.y <= Math.max(w.groundY(s.x, s.z), 0) + 0.1;
      if (!hit && (s.x < -200 || s.x > SIZE + 200 || s.z < -200 || s.z > SIZE + 200 || s.y > 600)) hit = true;   // 飞出地图边界：按过期处理，直接爆炸清理，不占着 shots 数组（重力会让火箭最终落下，这里是兜底）
      if (!hit) w.nearBuildings(s.x, s.z, 0.5, (b) => { if (s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1 && s.y < b.y0 + b.h) hit = true; });
      if (!hit) for (const v of this.vehicles) if (v !== s.owner && !v.sunk && Math.hypot(v.x - s.x, v.z - s.z) < v.radius && Math.abs(v.y + 1 - s.y) < 3) { hit = true; break; }
      if (!hit) for (const o of this.peds) if (o.alive && Math.hypot(o.x - s.x, o.z - s.z) < 1.1 && Math.abs(o.y + 1 - s.y) < 3) { hit = true; break; }   // 打行人也要看高度：从楼顶/直升机上打出去的火箭在高空飞过时，不能因为正下方有个行人就半空炸了（贴地飞时照旧能打中行人）
      if (!hit && !s.byPlayer) { const p = this.player; if (Math.hypot(p.x - s.x, p.z - s.z) < 1.3) hit = true; }
      if (hit) {
        s.alive = false; this.shots.splice(i, 1);
        if (s.remote) {
          // 别人发来的弹道：只放爆炸画面，不扣血、不吓路人（伤害由开火方自己算）；房主这边补一声 noise，让路人逃跑
          this.explodeVisual(s.x, s.y, s.z, s.radius);
          if (this.net?.isHost) this.noise(s.x, s.z, 60);
        } else this.explode(s.x, s.y, s.z, s.radius, s.dmg, s.byPlayer, s.owner);
      }
    }
  }

  /** 只看不伤的爆炸：别人发来的弹道飞到头时用，只放火光/烟尘/音效，不扣血、不吓路人、不记罪 */
  explodeVisual(x, y, z, r) { this.emit({ type: 'explosion', x, y, z, r }); }

  /** 爆炸：范围内的人和车按距离受伤 */
  explode(x, y, z, r, dmg, byPlayer, src) {
    this.emit({ type: 'explosion', x, y, z, r });
    const p = this.player;
    for (const o of this.peds) { if (!o.alive) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < r) this.hurtPed(o, dmg * (1 - d / r) * 1.2, byPlayer, x, z); }
    for (const v of this.vehicles) {
      if (v === src || !v.alive) continue;
      if (v.driver === 'player' && this.godOn()) continue;   // 无敌开着：主角的座驾不掉血、也不被炸飞；无敌关了照常掉血、照常被炸飞（伤害走 damageVehicle → Vehicle.damage，那里同样按 godOn 守着）
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < r + v.radius) {
        this.damageVehicle(v, dmg * (1 - d / (r + v.radius)) * (v.spec.cls === 'tank' ? 0.35 : 1), byPlayer);
        const k = (1 - d / (r + v.radius)) * 6 / v.spec.mass, l = d || 1; v.vx += ((v.x - x) / l) * k; v.vz += ((v.z - z) / l) * k;
        if (byPlayer && v.ai && v.ai.kind === 'chase') this.crime(CRIME.hurtCop);
      }
    }
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < r && !(p.inVeh && p.inVeh === src)) this.hurtPlayer(dmg * (1 - d / r) * (p.inVeh ? 0.5 : 0.45));
    // 联机：自己的爆炸波及远端玩家，写 hits 事件给对方自己扣（一次权威）；别人的爆炸不由这里算
    if (this.net && byPlayer) for (const [uid, rp] of this.net.remotePlayers) {
      if (rp.dead) continue;
      const dd = Math.hypot(rp.x - x, rp.z - z);
      if (dd < r) this.net.sendHit(uid, dmg * (1 - dd / r) * 0.45, 'pvp', this.playerWeaponId());
    }
    // 建筑伤害：爆炸点到建筑 footprint 的最近点水平距离小于爆炸半径才扣血，按距离衰减（复用载具那套思路）；
    // 高度也要在建筑的垂直范围内（上下各放宽 3 米），高空飞过的火箭不隔空炸楼
    const w = this.world;
    const seen = new Set();   // 大楼的 footprint 可能跨好几个空间哈希格子，nearBuildings 会把它回调好几次，同一栋楼一次爆炸只能扣一次血
    w.nearBuildings(x, z, r, (b) => {
      if (seen.has(b)) return;
      seen.add(b);
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const dd = Math.hypot(x - cx, z - cz);
      if (dd >= r) return;
      if (y < b.y0 - 3 || y > b.y0 + b.h + 3) return;
      this.damageBuilding(b, dmg * (1 - dd / r));
    });
    this.noise(x, z, 60);
    if (byPlayer) this.crime(CRIME.wreck * 0.5);
  }

  /** 建筑受伤。hp 归零就夷为平地：碰撞、屋顶、遮挡都消失；60~180 秒后自动重建（见 updateRebuilds），每栋独立随机 */
  damageBuilding(b, dmg) {
    if (b.destroyed || dmg <= 0) return;
    b.hp -= dmg;
    if (this.net) this.net.onBuildingChanged(b);   // 联机：血量变了就记下来，下一轮广播出去
    if (b.hp > 0) return;
    b.hp = 0; b.destroyed = true;
    b.rebuildAt = this.time + 60 + Math.random() * 120;   // 均匀随机 60~180 秒后重建
    this.rebuildQueue.push(b);
    this.emit({ type: 'buildingDown', b });
  }

  /** 有没有步行的玩家正好在某栋楼的占地里（重建会压到人就不能重建）。载具不再挡重建：废墟上的车到时间直接炸掉，
   * 主角坐着的车：无敌开着才推到楼外，无敌关了直接炸掉（见 rebuildBuilding）；坐车里的玩家不单独算，位置就是车的位置。
   * 行人不挡：重建时把他们推出去。飞在楼顶上方的不算：高度超过楼顶 0.5 米就不挡，和 world.collide 的“从楼顶上方飞过”同一条线 */
  footprintOccupied(b) {
    const top = b.y0 + b.h + 0.5, p = this.player;
    if (!p.inVeh && p.y < top && p.x > b.x0 - PLAYER.radius && p.x < b.x1 + PLAYER.radius && p.z > b.z0 - PLAYER.radius && p.z < b.z1 + PLAYER.radius) return true;
    return false;
  }

  /** 一栋楼重建：状态回满、废墟消失、画面和小地图靠 buildingUp 事件恢复（见 view.js / hud.js）。
   * 占地里的车：重建那一刻直接炸掉，走现有的 Vehicle.explode 摧毁路径（残骸 + 爆炸火光/烟尘/音效，和被炸毁时一样），
   * 必须在楼恢复之前炸——爆炸本身会伤楼，楼这时还是废墟，damageBuilding 对已炸平的楼直接返回，刚重建好的楼不会被波及；
   * 空车都炸（警车、交通车也一样，追捕系统会重新派车）。主角坐着的车：无敌开着才不炸，楼恢复后再用 world.collide 把它（连同车里的主角）
   * 推到最近的边缘外，复用行人推出那套机制；无敌关了和别的车一样直接炸掉，玩家被炸下车（Vehicle.explode → exitVehicle）。玩家位置下一帧跟着车同步（见 update）。
   * 行人如果还在占地里，用 world.collide 把他们推到最近的边缘外：平时走路的行人每步都会被 collide 推出建筑，
   * 但发呆的行人不走路，不在这里推就永远卡在楼里。 */
  rebuildBuilding(b) {
    const top = b.y0 + b.h + 0.5;
    let mine = null;
    for (const v of this.vehicles) {
      if (!v.alive || v.sunk || v.y >= top) continue;   // 飞在楼顶上方的不算，和 footprintOccupied 同一条线
      const cx = clamp(v.x, b.x0, b.x1), cz = clamp(v.z, b.z0, b.z1);
      if (Math.hypot(v.x - cx, v.z - cz) >= v.radius) continue;   // 只有占地范围真正重叠的车才受影响
      if (v === this.player.inVeh && this.godOn()) { mine = v; continue; }   // 无敌开着：主角坐着的车不炸，楼回来后推到楼外；无敌关了：和别的车一样直接炸掉
      v.explode();
    }
    b.destroyed = false; b.hp = b.maxHp; b.rebuildAt = 0;
    if (this.net) this.net.onBuildingChanged(b);   // 联机：重建状态也要广播出去，不然晚加入的人永远读到旧的“已炸平”
    if (mine) this.world.collide(mine, mine.radius, mine.y);
    for (const o of this.peds) {
      if (!o.alive) continue;
      if (o.x > b.x0 - o.r && o.x < b.x1 + o.r && o.z > b.z0 - o.r && o.z < b.z1 + o.r) this.world.collide(o, o.r, o.y);
    }
    this.emit({ type: 'buildingUp', b });
    // 提示只在 150 米内弹、1 秒内最多一次：一次爆炸能炸掉好几栋楼，重建时间又各自随机，不节流会刷屏
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (Math.hypot(cx - this.player.x, cz - this.player.z) < 150 && this.time - this.rebuildToastT >= 1) {
      this.rebuildToastT = this.time;
      this.toast(`${b.name || '建筑'}已重建`);
    }
  }

  /** 每帧扫一遍等重建的队：到时间就重建；占地里有步行的玩家就延后 5 秒再看，直到人离开。
   * 车不再挡重建：废墟上的车到时间直接炸掉，主角坐着的车只在无敌开着时推到楼外、关了也炸（见 rebuildBuilding）。
   * 计时用游戏时间 this.time：暂停（loop.timeScale = 0）时 sim.update 不跑，计时自动冻结。 */
  updateRebuilds() {
    const q = this.rebuildQueue;
    for (let i = q.length - 1; i >= 0; i--) {
      const b = q[i];
      if (!b.destroyed) { q.splice(i, 1); continue; }   // 已经从远端同步恢复了：不用再重建一遍（不然会白白炸掉占地里的车）
      if (this.time < b.rebuildAt) continue;
      if (this.footprintOccupied(b)) { b.rebuildAt = this.time + 5; continue; }   // 有步行的玩家站在废墟上：等 5 秒再看，别把楼重建在人身上
      q.splice(i, 1);
      this.rebuildBuilding(b);
    }
  }
  /** 联机：应用远端同步来的建筑状态。只改状态、发事件，不再重复扣血、不回写（回写是 Net 的事） */
  applyRemoteBuilding(i, hp, destroyed) {
    const b = this.world.buildings[i];
    if (!b) return;
    if (b.hp === hp && b.destroyed === destroyed) return;
    const wasDestroyed = b.destroyed;
    b.hp = hp; b.destroyed = destroyed;
    if (destroyed && !wasDestroyed) {
      this.emit({ type: 'buildingDown', b, remote: true });
      // 远端炸掉的楼，本地也排一个重建计时（和 damageBuilding 同一个 60~180 秒范围）：
      // 炸楼的人掉线了也没关系，在线的任何人到时间都会重建、把恢复写回库里，晚加入的人最多 3 分钟内看到楼回来
      if (!b.rebuildAt) { b.rebuildAt = this.time + 60 + Math.random() * 120; this.rebuildQueue.push(b); }
    }
    else if (!destroyed && wasDestroyed) this.emit({ type: 'buildingUp', b, remote: true });
  }

  /** 联机：应用远端同步来的固定载具状态（键是 fixed-序号）。非固定车（交通车、警车）不同步，这里直接忽略 */
  applyRemoteVehicle(key, d) {
    if (!d || typeof d.x !== 'number') return;
    const m = /^fixed-(\d+)$/.exec(key);
    if (!m) return;
    const f = this.fixedSpawns[Number(m[1])];
    if (!f || !f.v) return;
    if (this.net && d.driver === this.net.uid) return;   // 自己的车：本地物理说了算，不接受自己的回声
    let v = f.v;
    // 本地这辆已经是残骸、远端却是好的：说明远端那边补位重生了，本地也换一辆新的
    if (!v.alive && typeof d.hp === 'number' && d.hp > 0) {
      const i = this.vehicles.indexOf(v);
      if (i >= 0) this.vehicles.splice(i, 1);
      v = this.addVehicle(f.type, f.x, f.z, f.yaw, f.color); v.fixed = true; v.free = f.free; f.v = v;
    }
    v.px = v.x; v.py = v.y; v.pz = v.z; v.pyaw = v.yaw;   // 留上一帧位置给渲染插值
    v.x = d.x; v.z = d.z; if (typeof d.y === 'number') v.y = d.y; v.yaw = d.yaw;
    if (typeof d.hp === 'number') {
      if (d.hp <= 0 && v.alive) {
        // 远端炸毁了：本地直接变残骸，不再本地引爆一次（不然爆炸会再伤一遍周围的楼和车）
        v.hp = 0; v.alive = false; v.wreck = true; v.burning = false; v.speed = 0; v.vx = v.vz = 0;
        if (v.driver === 'player') this.exitVehicle(true);
      } else v.hp = d.hp;
    }
    // 司机已经不在联机里了（掉线），就当没司机；有人开的车本地不跑物理，等远端的位置
    const driver = (d.driver && d.driver !== '' && this.net && this.net.remotePlayers.has(d.driver)) ? d.driver : '';
    v.driver = driver; v.remoteDriven = driver !== '';
  }

  /* ------------------------------------------------------------ 行人、警察、帮派 */

  addPed(kind, x, z) {
    const o = {
      id: PID++, kind, x, z, y: this.world.groundY(x, z), px: x, pz: z, py: 0, yaw: Math.random() * 6.28, r: 0.4,
      hp: kind === 'civ' ? PED.hp : kind === 'gang' ? 80 : COP.hp[Math.max(1, this.stars)], alive: true, deadT: 0,
      state: kind === 'civ' ? 'walk' : kind === 'gang' ? 'guard' : 'fight', t: 0, tx: x, tz: z, fx: 0, fz: 0,
      block: null, corner: 0, dir: 1, moving: false, shootCd: 1 + Math.random(), atkSeq: 0, losT: 0, los: false,
      look: (Math.random() * 8) | 0, speed: 0,
      netId: 0, remote: false,   // 联机 v2：netId 是房主编的快照编号（0 = 还没编过），remote 是镜像行人（房主模拟，本地只插值）
    };
    this.peds.push(o);
    return o;
  }
  spawnCop(x, z) { const t = { x, z }; this.world.collide(t, 0.5); return this.addPed('cop', t.x, t.z); }

  /** 行人、警察、帮派分子受伤。
   * 联机：镜像行人（remote）不本地扣血——非房主打它只发伤害请求给房主结算（房主算完快照发回来），
   * 本地的犯罪归属和受击反馈照旧，只是不扣血、不死；帮派分子永远是本地的，不走这条。 */
  /** 车辆伤害的唯一入口：镜像车（房主在管的交通车/警车）不本地扣血，改发 vdmg 请求给房主结算。
   * 别人开的固定车是 v1 行为：本地扣血，但车主的 vehicles/ 同步会把血量覆盖回来（自愈），不走 vdmg。 */
  damageVehicle(v, dmg, byPlayer) {
    if (!v || !v.alive) return;
    if (v.remoteDriven && v.netId && v.ai && (v.ai.kind === 'chase' || v.ai.kind === 'traffic') && this.net) {
      this.net.requestVehicleDamage(v, dmg);
      return;
    }
    v.damage(dmg, byPlayer);
  }

  hurtPed(o, dmg, byPlayer, fromX, fromZ) {
    if (!o.alive) return;
    if (o.remote && this.net && !this.net.isHost) {
      this.emit({ type: 'hit', x: o.x, y: o.y + 1.2, z: o.z });
      if (o.kind === 'civ') { o.state = 'flee'; o.t = 10; o.fx = fromX; o.fz = fromZ; }
      else if (o.kind === 'gang') o.state = 'fight';
      if (byPlayer) {
        this.net.requestPedDamage(o, dmg, fromX, fromZ);
        this.crime(o.kind === 'cop' ? CRIME.hurtCop : o.kind === 'civ' ? (dmg < 16 ? CRIME.punch : CRIME.hurtPed) : 0);
      }
      return;
    }
    o.hp -= dmg;
    this.emit({ type: 'hit', x: o.x, y: o.y + 1.2, z: o.z });
    if (o.kind === 'civ') { o.state = 'flee'; o.t = 10; o.fx = fromX; o.fz = fromZ; }
    else if (o.kind === 'gang') o.state = 'fight';
    if (o.hp <= 0) {
      o.alive = false; o.deadT = 0; o.moving = false;
      // 掉钱：平民的钱是共享拾取物（房主掉的，别人也能捡，快照里同步）；帮派的钱是任务怪掉的，各玩各的，不共享
      if (o.kind === 'civ' && Math.random() < 0.8) { const id = PID++; this.pickups.push({ id, key: 'c' + id, type: 'cash', val: 10 + ((Math.random() * 60) | 0), x: o.x, z: o.z, y: o.y, t: 0, life: 40, shared: true, by: '', byT: 0 }); }
      if (o.kind === 'gang') { const id = PID++; this.pickups.push({ id, key: 'c' + id, type: 'cash', val: 60 + ((Math.random() * 80) | 0), x: o.x, z: o.z, y: o.y, t: 0, life: 60, shared: false, by: '', byT: 0 }); }
      if (byPlayer) this.crime(o.kind === 'cop' ? CRIME.killCop : o.kind === 'civ' ? CRIME.killPed : 0.3);
      this.emit({ type: 'pedDown', o });
    } else if (byPlayer) this.crime(o.kind === 'cop' ? CRIME.hurtCop : o.kind === 'civ' ? (dmg < 16 ? CRIME.punch : CRIME.hurtPed) : 0);
  }

  /** 街区四角人行道上的点（k：0 西北、1 东北、2 东南、3 西南） */
  corner(b, k) { const m = 2.4; return [k === 0 || k === 3 ? b.x0 + m : b.x1 - m, k < 2 ? b.z0 + m : b.z1 - m]; }

  spawnPeds(dt) {
    const p = this.player, w = this.world;
    // 联机做房主时：行人在哪个玩家身边刷，要轮着来（随机挑一个在线玩家做锚点），不然离房主远的玩家身边永远没行人
    let anchor = p;
    if (this.net?.isHost && this.net.remotePlayers.size) {
      const all = [p, ...this.net.remotePlayers.values()];
      anchor = all[(Math.random() * all.length) | 0];
    }
    if ((this.nearT -= dt) <= 0 || this._spawnAnchor !== anchor) {
      this.nearT = 2; this._spawnAnchor = anchor;
      this.nearBlocks = w.blocks.filter((b) => { const d = Math.hypot((b.x0 + b.x1) / 2 - anchor.x, (b.z0 + b.z1) / 2 - anchor.z); return d < PED.spawnMax + 40; });
    }
    if ((this.pedT -= dt) > 0 || !this.nearBlocks.length) return;
    this.pedT = 0.35;
    let civ = 0;
    for (const o of this.peds) if (o.kind === 'civ' && o.alive) civ++;
    if (civ >= PED.count) return;
    const b = this.nearBlocks[(Math.random() * this.nearBlocks.length) | 0];
    if (b.zone === 'farm' && Math.random() < 0.7) return;
    const k = (Math.random() * 4) | 0, c0 = this.corner(b, k), c1 = this.corner(b, (k + 1) % 4), t = Math.random();
    const x = c0[0] + (c1[0] - c0[0]) * t, z = c0[1] + (c1[1] - c0[1]) * t, d = Math.hypot(x - anchor.x, z - anchor.z);
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
    // 联机做房主时：行人离“任何一个在线玩家”近就不删（不然离房主远的玩家身边行人会被房主删光）
    let dpNear = null;
    if (this.net?.isHost) {
      dpNear = (o) => {
        let m = Math.hypot(o.x - p.x, o.z - p.z);
        for (const rp of this.net.remotePlayers.values()) m = Math.min(m, Math.hypot(o.x - rp.x, o.z - rp.z));
        return m;
      };
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const o = this.peds[i];
      o.px = o.x; o.pz = o.z; o.py = o.y;
      const dpLocal = Math.hypot(o.x - p.x, o.z - p.z);
      const dp = dpNear ? dpNear(o) : dpLocal;   // 删不删，看离任何人近不近
      if (!o.alive) { if ((o.deadT += dt) > 9 || (dp > PED.despawn && !o.remote)) this.peds.splice(i, 1); continue; }
      if (dp > PED.despawn && !o.mission && !o.remote) { this.peds.splice(i, 1); continue; }   // 镜像行人只由快照删，不本地删
      if (o.remote) { this.updateRemotePed(o, dt); continue; }   // 镜像行人：房主模拟，本地只插值跟过去
      if (o.kind === 'civ') this.updateCiv(o, dt);
      else this.updateFighter(o, dt, dpLocal);   // 打不打，看离本地玩家多远（警察内部再按追捕目标算，见 updateFighter）
      o.y = Math.max(w.groundY(o.x, o.z), -1.1);
    }
  }

  /** 镜像行人：位置朝快照目标插值过去（0.3 秒跟到位），朝向按最短弧线转；AI 不跑，状态/血量由快照给 */
  updateRemotePed(o, dt) {
    const k = Math.min(1, dt / 0.3);
    o.x += ((o.sx ?? o.x) - o.x) * k; o.z += ((o.sz ?? o.z) - o.z) * k;
    o.yaw += angDiff(o.yaw, o.syaw ?? o.yaw) * k;
    o.y = Math.max(this.world.groundY(o.x, o.z), -1.1);
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

  /** 警察和帮派分子：追、打、开枪。警察追的是追捕目标（copTarget：星最多的在线玩家），不是只追本地玩家；
   * 帮派分子还是只追本地玩家（tgt 就是本地玩家）。 */
  updateFighter(o, dt, dp) {
    const p = this.player, cop = o.kind === 'cop';
    const tgt = cop ? this.copTarget(o.x, o.z) : { x: p.x, z: p.z, y: p.y, speed: p.speed, dead: p.dead, uid: null, stars: this.stars };
    const tx = tgt.x, tz = tgt.z, tdp = Math.hypot(tx - o.x, tz - o.z);
    if (o.state === 'leave') {                    // 通缉解除：走开，走远后消失
      const dx = o.x - tx, dz = o.z - tz, d = Math.hypot(dx, dz) || 1;
      this.pedStep(o, o.x + (dx / d) * 8, o.z + (dz / d) * 8, PED.walk * 1.4, dt);
      if ((o.t += dt) > 25 || tdp > 90) o.alive = false, o.deadT = 99;
      return;
    }
    if (cop && tgt.stars <= 0) { o.state = 'leave'; o.t = 0; return; }
    if ((o.losT -= dt) <= 0) { o.losT = 0.4; o.los = tdp < 60 && !this.world.blocked(o.x, o.z, tx, tz); }
    if (o.state === 'guard') { o.moving = false; if (o.los && tdp < 42 && !tgt.dead) o.state = 'fight'; return; }
    if (tgt.dead) { o.moving = false; return; }
    const lvl = cop ? Math.max(1, tgt.stars) : 3;
    const shootOk = cop ? tgt.stars >= 2 : true;
    o.shootCd -= dt;
    if (!shootOk) {                               // 一星：只追上来用警棍
      if (tdp > 1.7) this.pedStep(o, tx, tz, COP.speed, dt, 1.4);
      else {
        o.moving = false; o.yaw = Math.atan2(tx - o.x, tz - o.z);
        if (o.shootCd <= 0) {
          o.shootCd = 0.9; o.atkSeq++;
          if (tgt.uid) this.net?.sendHit(tgt.uid, 8, 'cop', 'fist');   // 打远端玩家：写伤害事件
          else this.hurtPlayer(8);
          this.emit({ type: 'punch', x: o.x, z: o.z });
        }
      }
      return;
    }
    const want = cop ? 13 : 16;
    if (tdp > want + 4 || !o.los) this.pedStep(o, tx, tz, cop ? COP.speed : 4.2, dt, want);
    else { o.moving = false; o.yaw = Math.atan2(tx - o.x, tz - o.z); }
    if (o.los && tdp < COP.range && o.shootCd <= 0) {
      o.shootCd = 1 / COP.rate[lvl] * (0.8 + Math.random() * 0.5); o.atkSeq++;
      // 命中率：越远越低；玩家在高速移动时更难打中
      const acc = clamp(0.8 - tdp / 55 - (tgt.speed > 8 ? 0.3 : tgt.speed > 3 ? 0.12 : 0), 0.08, 0.8);
      const yaw = Math.atan2(tx - o.x, tz - o.z) + (Math.random() < acc ? 0 : (Math.random() < 0.5 ? 1 : -1) * (0.06 + Math.random() * 0.1));
      const w = lvl >= 4 ? 'smg' : 'pistol';
      let hx, hy, hz;
      if (tgt.uid) {
        // 目标是联机里的其他玩家：命中直接写伤害事件（一次权威），曳光线画到他身上
        const hit = Math.random() < acc;
        if (hit) this.net?.sendHit(tgt.uid, COP.dmg[lvl], 'cop', w);
        hx = hit ? tx : o.x + Math.sin(yaw) * (COP.range + 6);
        hy = hit ? (tgt.y ?? 0) + 1.2 : o.y + 1.2;
        hz = hit ? tz : o.z + Math.cos(yaw) * (COP.range + 6);
        this.emit({ type: 'tracer', x1: o.x, y1: o.y + 1.4, z1: o.z, x2: hx, y2: hy, z2: hz, hit, mine: false });
      } else {
        const r = this.hitscan(o.x, o.y + 1.4, o.z, yaw, COP.range + 6, COP.dmg[lvl], false, o);
        hx = r.x2; hy = r.y2; hz = r.z2;
      }
      // 警察开枪也要广播开火事件，让其他客户端看到曳光线（伤害只由这里算，不重复）
      this.net?.sendShot({ kind: w, x: o.x, y: o.y + 1.4, z: o.z, dx: Math.sin(yaw), dy: 0, dz: Math.cos(yaw), speed: 0, radius: 0, range: COP.range + 6, hx, hy, hz });
      this.emit({ type: 'shot', x: o.x, z: o.z, w, mine: false });
    }
  }

  /* ------------------------------------------------------------ 交通和警车 */

  /** 离“任何一个在线玩家”的最近距离（单机就是离本地玩家）；房主刷/删交通车和行人时用它。 */
  distToAnyPlayer(x, z) {
    const p = this.player;
    let m = Math.hypot(x - p.x, z - p.z);
    if (this.net) for (const rp of this.net.remotePlayers.values()) m = Math.min(m, Math.hypot(x - rp.x, z - rp.z));
    return m;
  }

  spawnTraffic(dt) {
    if ((this.spawnT -= dt) > 0) return;
    this.spawnT = 0.6;
    const p = this.player, w = this.world;
    // 联机做房主时：交通车在哪个玩家身边刷，要轮着来（随机挑一个在线玩家做锚点）；删不删看离任何人近不近
    let anchor = p;
    if (this.net?.isHost && this.net.remotePlayers.size) {
      const all = [p, ...this.net.remotePlayers.values()];
      anchor = all[(Math.random() * all.length) | 0];
    }
    const dpNear = (x, z) => (this.net?.isHost ? this.distToAnyPlayer(x, z) : Math.hypot(x - p.x, z - p.z));
    let n = 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i], d = dpNear(v.x, v.z);
      if (v.ai && v.ai.kind === 'traffic') n++;
      // 回收：走远的交通车、警车、残骸；沉没的车
      const far = d > TRAFFIC.despawn;
      if (v === p.inVeh || v.fixed && v.alive || v.mission) continue;
      if ((far && (v.ai || !v.alive || (!v.parked && !v.used))) || (v.sunk && v.goneT > 4) || (v.wreck && v.goneT > 50) || (far && v.used && d > 500)) this.vehicles.splice(i, 1);
    }
    // 固定载具补位：原来那辆毁了、沉了或被开到很远的地方，而且玩家不在附近时，在原地再放一辆
    const f = this.fixedSpawns[this.fixedI = (this.fixedI + 1) % this.fixedSpawns.length], o = f.v;
    if (o !== p.inVeh && !o.mission && (o.wreck || o.sunk || Math.hypot(o.x - f.x, o.z - f.z) > 150) && dpNear(f.x, f.z) > 130) {
      o.fixed = false; o.used = false;
      f.v = this.addVehicle(f.type, f.x, f.z, f.yaw, f.color); f.v.fixed = true; f.v.free = f.free;
    }
    if (n >= TRAFFIC.count) return;
    for (let tries = 0; tries < 8; tries++) {
      const a = w.roadNodes[(Math.random() * w.roadNodes.length) | 0], d = Math.hypot(a.x - anchor.x, a.z - anchor.z);
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
    const ai = v.ai, p = this.player, c = { steer: 0, gas: 0, handbrake: false, pitch: 0, fire: false, rocket: false };
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
      // 民用警车：通缉时就近加入追捕（联机时只有房主能转，不然非房主的本地警车会各追各的）
      if (v.type === 'police' && (!this.net || this.net.isHost)) {
        const tgt = this.copTarget(v.x, v.z);
        if (tgt.stars > 0 && Math.hypot(v.x - tgt.x, v.z - tgt.z) < 90) { v.ai = { kind: 'chase', route: null, routeT: 0, stuck: 0, rev: 0 }; v.siren = true; return c; }
      }
    } else {                                        // 追捕：追的是追捕目标（星最多的在线玩家），不是只追本地玩家
      const tgt = this.copTarget(v.x, v.z);
      const dp = Math.hypot(tgt.x - v.x, tgt.z - v.z);
      want = 26;
      if (dp < 34 && !this.world.blocked(v.x, v.z, tgt.x, tgt.z)) { tx = tgt.x; tz = tgt.z; }
      else {
        if ((ai.routeT -= dt) <= 0 || !ai.route || ai.route.length < 2) {
          ai.routeT = 1.5;
          const rt = ai.route = this.world.route(this.world.nearestNode(v.x, v.z), this.world.nearestNode(tgt.x, tgt.z));
          // 车已经在第一、二个路口之间时，直接奔第二个，不要掉头回第一个
          while (rt.length > 1 && Math.hypot(v.x - rt[1].x, v.z - rt[1].z) < Math.hypot(rt[0].x - rt[1].x, rt[0].z - rt[1].z) + 4) rt.shift();
        }
        let n = ai.route[0];
        if (ai.route.length > 1 && Math.hypot(n.x - v.x, n.z - v.z) < 12) { ai.route.shift(); n = ai.route[0]; }
        tx = n.x; tz = n.z;
        if (ai.route.length === 1) { tx = tgt.x; tz = tgt.z; }
      }
      // 贴近了而且玩家慢下来：停车，警察下车
      if (dp < 15 && tgt.speed < 5) {
        if (Math.abs(v.speed) < 3) { this.ejectNpc(v, false); v.ai = null; v.siren = true; v.parked = false; return c; }
        c.gas = -1; return c;
      }
      if (dp < 40) want = Math.max(12, Math.min(26, tgt.speed + 8));
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

  /** 车与车、车与人的碰撞。
   * 联机：镜像车（remoteDriven，房主模拟的）不参与本地的车车碰撞和撞行人（房主那边算），
   * 但撞玩家那一下由受害方自己算（镜像警车撞到我，只有我这边知道，房主那边没有我的位置）。 */
  collideVehicles() {
    const vs = this.vehicles, p = this.player;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (a.sunk) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (b.sunk || a.remoteDriven || b.remoteDriven) continue;
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
      // 撞人（镜像车跳过：房主算；镜像行人被本地交通车撞到只推开一点，伤害归房主）
      const sp = Math.hypot(a.vx, a.vz);
      if (sp < 2 || a.flying) continue;
      if (!a.remoteDriven) for (const o of this.peds) {
        if (!o.alive || Math.abs(o.x - a.x) > 6 || Math.abs(o.z - a.z) > 6) continue;
        if (Math.hypot(o.x - a.x, o.z - a.z) > a.radius * 0.85 + 0.4) continue;
        const mine = a.driver === 'player';
        if (sp > 4) {
          if (o.remote && !mine) { const l = Math.hypot(o.x - a.x, o.z - a.z) || 1; o.x += ((o.x - a.x) / l) * 0.5; o.z += ((o.z - a.z) / l) * 0.5; }
          else this.hurtPed(o, sp * 5, mine, a.x, a.z);
        }
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
      if (v.remoteDriven) continue;   // 联机：别人开的固定车位置由远端同步，本地不跑物理（不然会和网络位置打架）
      const ctl = v.driver === 'player' ? c : v.ai && v.driver ? this.drive(v, dt) : NOCTL;
      v.update(dt, v.driver === 'player' && p.dead ? NOCTL : ctl);
    }
    this.collideVehicles();
    if (p.inVeh) { p.x = p.inVeh.x; p.y = p.inVeh.y; p.z = p.inVeh.z; }
    this.updatePeds(dt);
    this.updateRemoteVehicles(dt);   // 联机：镜像警车朝快照目标插值
    this.updateShots(dt);
    if (!this.net || this.net.isHost) this.spawnTraffic(dt);   // 联机时只有房主刷交通车（非房主的本地交通车在 setHost(false) 里已清掉）
    if (!this.net || this.net.isHost) this.spawnPeds(dt);   // 联机时只有房主刷行人
    this.updateWanted(dt);   // 通缉衰减是各算各的（自己的星自己降）；派警车只有房主能派，见下一行
    if (!this.net || this.net.isHost) this.spawnCops(dt);
    this.updateRebuilds();
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.remote) continue;   // 镜像拾取物：计时归房主，快照到了自然更新，本地不减
      if (k.t > 0) k.t -= dt;
      if (k.byT && Date.now() - k.byT > 5000) { k.by = ''; k.byT = 0; }   // 5 秒前的“谁捡的”不用再带给别人
      if (k.life !== undefined && (k.life -= dt) <= 0) this.pickups.splice(i, 1);
    }
    // 最近被捡的一次性拾取物（给请求方确认用的），5 秒后丢掉
    while (this.recentTakes.length && Date.now() - this.recentTakes[0].byT > 5000) this.recentTakes.shift();
    this.missions.update(dt);
  }

  /* ------------------------------------------------------------ 联机 v2：环境同步与房主 */

  /** 房主：把环境快照发出去（Net 每 0.5 秒调一次）。只发平民和警察（帮派是任务怪，各玩各的）、
   * 追捕中的警车和交通车（固定车走另一条同步，不在这里）、共享拾取物（固定物和平民掉的钱；帮派掉的钱各玩各的）；
   * 坐标取整到 0.1 米。行人/车第一次进快照时才编 netId。车：[netId, kind(0=交通车,1=警车), x, z, yaw, vx, vz, hp, siren]。
   * 拾取物：[key, type, val, x, z, t(剩余重生秒数，0=可捡), by(最近 5 秒谁捡的，没有是 ''), respawn]。
   * takes：最近 5 秒被捡的一次性拾取物 [key, type, val, by]（给请求方确认用的，拾取物本身已经从列表里删了）。 */
  publishEnvSnapshot() {
    const peds = [];
    for (const o of this.peds) {
      if (o.kind !== 'civ' && o.kind !== 'cop') continue;
      if (!o.netId) o.netId = ++this.netPedSeq;
      peds.push([o.netId, o.kind === 'cop' ? 1 : 0, r1(o.x), r1(o.z), r1(o.yaw), Math.max(0, Math.round(o.hp)), o.alive ? 1 : 0, o.state, o.moving ? 1 : 0, r1(o.speed)]);
    }
    const cars = [];
    for (const v of this.vehicles) {
      if (!v.ai || (v.ai.kind !== 'chase' && v.ai.kind !== 'traffic') || !v.alive || v.fixed || v.mission) continue;
      if (!v.netId) v.netId = ++this.netCarSeq;
      cars.push([v.netId, v.ai.kind === 'chase' ? 1 : 0, r1(v.x), r1(v.z), r1(v.yaw), r1(v.vx), r1(v.vz), Math.max(0, Math.round(v.hp)), v.siren ? 1 : 0]);
    }
    const pickups = [];
    for (const k of this.pickups) {
      if (!k.shared) continue;
      pickups.push([k.key, k.type, k.val, r1(k.x), r1(k.z), Math.max(0, r1(k.t)), (k.byT && Date.now() - k.byT <= 5000) ? k.by : '', k.fixed ? k.respawn : 0]);
    }
    const takes = this.recentTakes.filter((t) => Date.now() - t.byT <= 5000).map((t) => [t.key, t.type, t.val, t.by]);
    return { t: Date.now(), peds, cars, pickups, takes };
  }

  /** 非房主收到环境快照：按 netId 对上本地行人/警车（没有就新建），位置不直接写、等插值跟过去；
   * 快照里没有的镜像行人/警车删掉（房主那边已经没了）。房主自己不调这个（Net 里拦住了）。 */
  applyEnvSnapshot(data) {
    if (!data || !Array.isArray(data.peds)) return;
    const age = Math.max(0, (Date.now() - (data.t || Date.now())) / 1000);
    const seen = new Set();
    for (const e of data.peds) {
      const [id, kind, x, z, yaw, hp, alive, state, moving, speed] = e;
      seen.add(id);
      let o = this.peds.find((q) => q.netId === id);
      if (!o) {
        o = this.addPed(kind === 1 ? 'cop' : 'civ', x, z);
        o.netId = id; o.remote = true; o.look = id % 8;   // 外观按 netId 定，不每次换脸
      }
      o.sx = x; o.sz = z; o.syaw = yaw; o.shp = hp; o.salive = !!alive; o.sstate = state; o.smoving = moving; o.sspeed = speed;
      if (o.alive && !o.salive) { o.alive = false; o.deadT = 0; o.moving = false; }
      else if (!o.alive && o.salive) { o.alive = true; o.deadT = 0; }
      else if (o.alive) { o.hp = hp; o.state = state; o.moving = !!moving; o.speed = speed; }
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const o = this.peds[i];
      if (o.remote && (o.kind === 'civ' || o.kind === 'cop') && !seen.has(o.netId)) this.peds.splice(i, 1);
    }
    const seenCars = new Set();
    for (const e of (data.cars || [])) {
      const [id, kind, x, z, yaw, vx, vz, hp, siren] = e;
      seenCars.add(id);
      let v = this.vehicles.find((q) => q.netId === id && q.ai && (q.ai.kind === 'chase' || q.ai.kind === 'traffic'));
      if (!v) {
        // 交通车和警车都按快照建镜像：交通车没有警笛，警车有；类型先按 kind 建（交通车多半是轿车，颜色随机——
        // 镜像车的外观不重要，位置/朝向/速度才重要；房主那边换车时会删掉重建）
        v = this.addVehicle(kind === 1 ? 'police' : 'sedan', x, z, yaw);
        v.netId = id; v.driver = 'npc'; v.siren = !!siren; v.ai = { kind: kind === 1 ? 'chase' : 'traffic', route: null, routeT: 0, stuck: 0, rev: 0 }; v.remoteDriven = true;
      }
      // 速度外推：快照是 0.5 秒前的，按速度先推到现在的位置，再插值跟过去
      v.sx = x + vx * age; v.sz = z + vz * age; v.syaw = yaw; v.svx = vx; v.svz = vz; v.hp = hp; v.siren = !!siren;
      // 房主那边车炸了/修好了，镜像也跟着变（不然本地炸掉的镜像车快照说还活着也回不来）
      if (hp <= 0 && v.alive) { v.hp = 0; v.alive = false; v.wreck = true; v.burning = false; v.speed = 0; v.vx = v.vz = 0; }
      else if (hp > 0 && !v.alive) { v.hp = hp; v.alive = true; v.wreck = false; v.burning = false; }
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.remoteDriven && v.ai && (v.ai.kind === 'chase' || v.ai.kind === 'traffic') && !seenCars.has(v.netId)) this.vehicles.splice(i, 1);
    }
    // 共享拾取物：按 key 对上镜像（没有就新建），重生倒计时由快照给；快照里没有的镜像拾取物删掉（房主那边已经没了）。
    // 领取确认：快照里 by 是我的（固定物）或 takes 里 by 是我的（一次性），说明房主批了我的请求，效果这时才生效；
    // by 是别人、我又有未完成的请求，说明这轮抢输了，请求作废。超 3 秒没确认的请求也作废（可以再发）。
    const myUid = this.net?.uid;
    const nowMs = Date.now();
    for (const [key, pt] of this.pendingTakes) if (nowMs - pt > 3000) this.pendingTakes.delete(key);
    const confirm = (key, type, val) => {
      if (!myUid || !this.pendingTakes.has(key)) return;
      this.pendingTakes.delete(key);
      if (this.applyPickupEffect(type, val)) this.emit({ type: 'pickup', k: { type, val } });
    };
    const seenPickups = new Set();
    for (const e of (data.pickups || [])) {
      const [key, type, val, x, z, t, by, respawn] = e;
      seenPickups.add(key);
      let k = this.pickups.find((q) => q.key === key && q.remote);
      if (!k) {
        k = { id: PID++, key, type, val, x, z, y: this.world.groundY(x, z), t, respawn: respawn || 0, fixed: (respawn || 0) > 0, shared: true, remote: true, by: '', byT: 0 };
        this.pickups.push(k);
      }
      k.x = x; k.z = z; k.t = t; k.val = val;
      if (by) { if (by === myUid) confirm(key, type, val); else this.pendingTakes.delete(key); }
    }
    for (const e of (data.takes || [])) {
      const [key, type, val, by] = e;
      if (by === myUid) confirm(key, type, val);
      else this.pendingTakes.delete(key);
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.remote && k.shared && !seenPickups.has(k.key)) this.pickups.splice(i, 1);
    }
  }

  /** 联机：我正在做的任务的进度（给 Net 发共享节点用）。没有在做任务就返回 null。
   * vehicle 只有“新生成的那辆”才发（reuse 的固定车走固定车同步，不重复发）；targets 只有摧毁任务才发。 */
  missionProgress() {
    const a = this.missions.active;
    if (!a) return null;
    const d = a.def;
    let left = 0;
    if (d.type === 'kill') left = a.foes.filter((o) => o.alive).length;
    else if (d.type === 'destroy') left = a.targets.filter((t) => t.alive).length;
    else if (d.cps) left = Math.max(0, d.cps.length - a.cp);
    let vehicle = null;
    if (a.vehicle && !a.vehicle.fixed) {
      const v = a.vehicle;
      vehicle = { type: v.type, x: r1(v.x), y: r1(v.y), z: r1(v.z), yaw: r1(v.yaw), hp: Math.max(0, Math.round(v.hp)) };
    }
    const targets = d.type === 'destroy' ? a.targets.map((t) => [Math.max(0, Math.round(t.hp)), t.alive ? 1 : 0]) : null;
    return { cp: a.cp, left, text: a.text || '', vehicle, targets };
  }

  /** 联机：别人任务里的载具镜像（非固定车那辆）。按 missionId 认车，没有就新建；位置按快照插值（见 updateRemoteVehicles）。 */
  applyRemoteMissionVehicle(id, data) {
    if (!data || !data.type) return;
    let v = this.vehicles.find((q) => q.missionId === id);
    if (!v) {
      v = this.addVehicle(data.type, data.x, data.z, data.yaw || 0);
      v.mission = true; v.missionId = id; v.remoteDriven = true; v.driver = data.driver || '';
      v.x = data.x; v.z = data.z; v.y = data.y ?? this.world.groundY(data.x, data.z);
    }
    v.sx = data.x; v.sz = data.z; v.sy = data.y ?? v.y; v.syaw = data.yaw || 0; v.hp = data.hp ?? v.hp;
    if (v.hp <= 0 && v.alive) { v.alive = false; v.wreck = true; v.burning = false; v.speed = 0; v.vx = v.vz = 0; }
    else if (v.hp > 0 && !v.alive) { v.alive = true; v.wreck = false; v.burning = false; }
  }

  /** 联机：删掉某个任务的载具镜像（任务结束时）。 */
  removeRemoteMissionVehicle(id) {
    const i = this.vehicles.findIndex((q) => q.missionId === id);
    if (i >= 0) this.vehicles.splice(i, 1);
  }
  reanchorTraffic(v) {
    const a = this.world.nearestNode(v.x, v.z);
    v.ai.from = a; v.ai.to = (a.links && a.links.length) ? a.links[(Math.random() * a.links.length) | 0] : a;
    v.ai.panic = 0; v.ai.stuck = 0; v.ai.rev = 0;
  }

  /** 镜像车（警车、交通车、别人任务里的载具）：位置朝快照目标（已按速度外推过）插值，朝向按最短弧线转；
   * 速度写进 vx/vz，供撞玩家的判定用。任务载具没有 ai，高度也按快照插值（船在水面上、不能按地面高度算）。 */
  updateRemoteVehicles(dt) {
    for (const v of this.vehicles) {
      if (!v.remoteDriven) continue;
      const isMissionVeh = !!v.missionId;
      if (!isMissionVeh && (!v.ai || (v.ai.kind !== 'chase' && v.ai.kind !== 'traffic'))) continue;
      v.px = v.x; v.py = v.y; v.pz = v.z; v.pyaw = v.yaw;
      const k = Math.min(1, dt / 0.25);
      v.x += ((v.sx ?? v.x) - v.x) * k; v.z += ((v.sz ?? v.z) - v.z) * k;
      v.yaw += angDiff(v.yaw, v.syaw ?? v.yaw) * k;
      v.vx = v.svx ?? 0; v.vz = v.svz ?? 0;
      if (isMissionVeh && v.sy !== undefined) v.y += ((v.sy ?? v.y) - v.y) * k;
      else v.y = this.world.groundY(v.x, v.z);
    }
  }

  /**
   * 房主换人时调（Net.recomputeHost 里调）：isHost=true 是接手，false 是交出。
   * 接手：镜像行人/车转成本地模拟（位置不断，netId 保留），计数器从最大 id 续上，避免新行人撞 id。
   * 交出：本地平民/警察转成镜像（位置不断，等新房主的快照来接管），本地追捕警车也转成镜像（快照里没有就删），
   * 本地交通车直接删掉（新房主会重新刷；留着会和新房主的快照撞车）。帮派分子不管（一直是本地的）。
   * 重复调同一个值直接返回（交出时也要跑一遍清理，所以不能只看 netHost，要看是不是已经清理过——
   * 这里用 netHost 守：交出只在从 true 到 false 时发生，重复调 false 直接返回是安全的）。
   */
  setHost(isHost) {
    // 交出（false）每次都要跑一遍清理：刚加入当非房主时 netHost 本来就是 false，不跑清理的话，
    // 加入前本地刷的交通车和路人会一直留在本地，和房主的快照撞车。清理本身是幂等的（跑过一次后，
    // 本地交通车已删、本地路人已是镜像，第二次进来什么也找不到），所以重复调是安全的。
    // 接手（true）只在从非房主变房主时跑一次。
    if (isHost && this.netHost) return;
    this.netHost = isHost;
    if (isHost) {
      this.netPedSeq = Math.max(this.netPedSeq, ...this.peds.map((o) => o.netId || 0));
      this.netCarSeq = Math.max(this.netCarSeq, ...this.vehicles.map((v) => v.netId || 0));
      for (const o of this.peds) if (o.remote) { o.remote = false; o.sx = undefined; o.sz = undefined; }
      for (const v of this.vehicles) {
        if (!v.remoteDriven || !v.ai || (v.ai.kind !== 'chase' && v.ai.kind !== 'traffic')) continue;
        v.remoteDriven = false; v.driver = 'npc';
        if (v.ai.kind === 'traffic') this.reanchorTraffic(v);   // 镜像交通车没有 from/to，接手时重找一条路
      }
      for (const k of this.pickups) if (k.remote) k.remote = false;   // 镜像拾取物转成本地（重生倒计时从快照的值继续走）
    } else {
      for (const o of this.peds) {
        if (o.remote || (o.kind !== 'civ' && o.kind !== 'cop')) continue;
        o.remote = true; o.sx = o.x; o.sz = o.z; o.syaw = o.yaw; o.shp = o.hp; o.salive = o.alive; o.sstate = o.state; o.smoving = o.moving ? 1 : 0; o.sspeed = o.speed;
      }
      for (let i = this.vehicles.length - 1; i >= 0; i--) {
        const v = this.vehicles[i];
        if (!v.ai || v.remoteDriven) continue;
        if (v.ai.kind === 'traffic') { this.vehicles.splice(i, 1); continue; }   // 本地交通车删掉，等新房主的快照
        if (v.ai.kind !== 'chase') continue;
        v.remoteDriven = true; v.sx = v.x; v.sz = v.z; v.syaw = v.yaw; v.svx = v.vx; v.svz = v.vz;
      }
      // 共享拾取物是房主的 state：本地固定物和共享的钱都删掉，等新房主的快照（key 都一样，接得上）；
      // 帮派怪掉的本地钱留着（各玩各的）。未确认的领取请求作废（新房主没收到过，走了再发）。
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const k = this.pickups[i];
        if (k.shared && !k.remote) this.pickups.splice(i, 1);
      }
      this.pendingTakes.clear();
    }
  }

  /**
   * 断开联机、回单机时调（Net.leave 里调）：镜像行人/车全部转回本地模拟，游戏继续单机玩。
   * 平民没街区就近找一个（不然 updateCiv 里没 block 会一直站着不动）。
   */
  goOffline() {
    this.netHost = false;
    this.netGod = false;   // 离开联机：全员无敌只对在线玩家有效，回到单机就清掉
    for (const o of this.peds) {
      if (!o.remote) continue;
      o.remote = false;
      if (o.kind === 'civ' && !o.block) {
        let best = null, bd = 1e9;
        for (const b of this.world.blocks) { const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, d = Math.hypot(cx - o.x, cz - o.z); if (d < bd) { bd = d; best = b; } }
        if (best) { o.block = best; o.corner = 0; const c = this.corner(best, 0); o.tx = c[0]; o.tz = c[1]; }
      }
    }
    for (const v of this.vehicles) {
      if (!v.remoteDriven || !v.ai || (v.ai.kind !== 'chase' && v.ai.kind !== 'traffic')) continue;
      v.remoteDriven = false; v.driver = 'npc';
      if (v.ai.kind === 'traffic') this.reanchorTraffic(v);
    }
    for (const k of this.pickups) if (k.remote) k.remote = false;   // 镜像拾取物转回本地（固定物继续按快照里的倒计时重生）
    this.pendingTakes.clear();
  }

  /** 存档内容 */
  save() { const p = this.player; return { money: p.money, done: [...this.missions.done], owned: p.owned, ammo: p.ammo.map((a) => (a === Infinity ? 0 : a)) }; }
}
