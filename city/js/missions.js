// 落日湾：任务。走到（或把车慢慢开到）地图上的任务光圈里就开始。
// 任务分三种：checkpoints 检查点型（开指定载具依次经过若干点）、kill 清场型、destroy 摧毁目标型。
// 新增任务：在 buildList() 里加一项即可；检查点用路口坐标 N(i, j) 表示，改路线很方便。
import { VEH, WEAPON_INDEX } from './config.js';
import { terrainY, RUNWAY, GX0, GZ0, PITCH } from './world.js';

/** 生成任务列表（依赖世界数据，所以是函数） */
function buildList(w) {
  const N = (i, j) => { const n = w.node(i, j); return n ? [n.x, n.z] : [GX0 + i * PITCH, GZ0 + j * PITCH]; };
  const S = (i, j, dx = 9.5, dz = 9.5) => { const [x, z] = N(i, j); return [x + dx, z + dz]; };     // 路口旁的人行道
  const P = w.places, pier = P.pier, px = (pier.x0 + pier.x1) / 2;
  // 海上的检查点：从岛中心朝某个角度一直走到深水再往外一点
  const sea = (deg, extra = 35) => {
    const a = (deg * Math.PI) / 180; let r = 300;
    while (r < 900 && terrainY(860 + Math.sin(a) * r, 800 + Math.cos(a) * r) > -3.5) r += 6;
    return [860 + Math.sin(a) * (r + extra), 800 + Math.cos(a) * (r + extra)];
  };
  return [
    {
      id: 'taxi', name: '出租车司机', icon: '租', type: 'checkpoints', reward: 500, at: S(6, 8),
      desc: '开出租车接送三位乘客。', vehicle: 'taxi', spawn: [N(6, 8)[0] - 3.4, N(6, 8)[1] + 18, 0], time: 70, cpTime: 26,
      cps: [N(8, 8), N(8, 10), N(5, 10), N(5, 7), N(7, 6), N(9, 6)],
      cpText: (k) => (k % 2 === 0 ? `去接第 ${k / 2 + 1} 位乘客` : '把乘客送到目的地'),
    },
    {
      id: 'race', name: '街头竞速', icon: '竞', type: 'checkpoints', reward: 800, at: S(8, 7),
      desc: '开跑车在限定时间内跑完全程。', vehicle: 'sports', spawn: [N(8, 7)[0] + 3.4, N(8, 7)[1] - 18, Math.PI], time: 34, cpTime: 12,
      cps: [N(8, 5), N(10, 5), N(10, 8), N(8, 8), N(8, 11), N(5, 11), N(5, 8), N(7, 8)],
    },
    {
      id: 'courier', name: '快递骑手', icon: '递', type: 'checkpoints', reward: 500, at: S(5, 9),
      desc: '骑摩托把七个包裹送到各个街角。', vehicle: 'bike', spawn: [N(5, 9)[0] - 3.4, N(5, 9)[1] + 16, 0], time: 40, cpTime: 15,
      cps: [S(4, 10), S(6, 11, -9.5, 9.5), S(7, 9), S(9, 9, -9.5, -9.5), S(8, 7, 9.5, -9.5), S(6, 6), S(4, 8, -9.5, 9.5)],
      cpText: (k, n) => `送出包裹 ${k + 1}/${n}`,
    },
    {
      id: 'docks', name: '码头清场', icon: '清', type: 'kill', reward: 1200, at: S(7, 11),
      desc: '一伙帮派占了码头仓库。把他们全部放倒。任务开始时给你一把冲锋枪。',
      foes: [S(8, 11, 20, 4), S(8, 11, 40, 4), S(8, 11, 4, 30), S(9, 11, 12, 4), S(9, 11, 4, 20), S(8, 12, 20, -4), S(8, 12, 44, -4), S(9, 12, 10, -4)],
    },
    {
      id: 'boat', name: '水上追风', icon: '艇', type: 'checkpoints', reward: 700, at: [px, pier.z1 - 5],
      desc: '驾驶快艇绕海湾一圈。', vehicle: 'boat', spawn: [px + 11, pier.z1 - 2, Math.PI], time: 60, cpTime: 20,
      cps: [sea(-20), sea(-55), sea(-95), sea(-55, 90), sea(-10, 80), sea(30, 60), sea(15)],
    },
    {
      id: 'fly', name: '飞越落日湾', icon: '飞', type: 'checkpoints', reward: 1500, at: [RUNWAY.x + 22, RUNWAY.z1 - 10],
      desc: '驾驶飞机穿过八个光环，最后降落回跑道。推满油门，速度够了向上推摇杆起飞。', vehicle: 'plane', spawn: [RUNWAY.x, RUNWAY.z1 - 14, Math.PI], reuse: true, time: 90, cpTime: 30, land: true,
      cps: [[RUNWAY.x, RUNWAY.z0 - 140, 50], [1000, 300, 85], [430, 430, 185], [300, 900, 95], [700, 1400, 55], [900, 1420, 45], [1400, 1150, 75], [RUNWAY.x, RUNWAY.z1 + 260, 65]],
      cpText: (k, n) => `穿过光环 ${k + 1}/${n}`,
    },
    {
      id: 'tank', name: '钢铁洪流', icon: '坦', type: 'destroy', reward: 2000, at: [P.gate.x + 8, P.gate.z + 16],
      desc: '开坦克在限定时间内摧毁十辆靶车。任务期间不会被通缉。', vehicle: 'tank', spawn: [P.gate.x + 14, P.gate.z + 4, Math.PI / 2], reuse: true, time: 170, count: 10,
    },
    {
      id: 'truck', name: '夺回货物', icon: '货', type: 'checkpoints', reward: 1000, at: S(9, 10),
      desc: '把被帮派扣下的皮卡抢回来，开到西边的车库。上车后警察会盯上你。', vehicle: 'pickup', spawn: [N(10, 11)[0] - 3.4, N(10, 11)[1] + 20, 0], time: 150, cpTime: 0,
      cps: [N(4, 6)], cpText: () => '把皮卡开到车库', guards: [[N(10, 11)[0] - 8, N(10, 11)[1] + 16], [N(10, 11)[0] + 6, N(10, 11)[1] + 24], [N(10, 11)[0] - 9, N(10, 11)[1] + 28]], heat: 2,
    },
  ];
}

export class Missions {
  constructor(sim, done) {
    this.sim = sim;
    this.done = new Set(done);
    this.list = buildList(sim.world);
    this.active = null;      // 进行中的任务状态
    this.cool = 2;           // 刚结束任务后的短暂冷却，避免站在光圈里立刻重开
  }

  /** 界面要显示的内容：进行中任务的名字、当前目标文字、剩余时间、目标位置 */
  get hud() { const a = this.active; return a ? { name: a.def.name, text: a.text, timer: a.timer, target: a.target, ring: a.ring } : null; }

  update(dt) {
    const sim = this.sim, p = sim.player;
    if (!this.active) {
      if ((this.cool -= dt) > 0 || p.dead) return;
      if (p.inVeh && Math.abs(p.inVeh.speed) > 4) return;
      for (const m of this.list) if (Math.hypot(p.x - m.at[0], p.z - m.at[1]) < 3.4) { this.start(m); break; }
      return;
    }
    const a = this.active;
    a.t += dt;
    const r = this.tick(a, dt);
    if (r === 'win') this.win(); else if (r) this.fail(r);
  }

  start(m) {
    const sim = this.sim, p = sim.player;
    const a = this.active = { def: m, stage: 0, t: 0, timer: m.time || 0, cp: 0, away: 0, vehicle: null, foes: [], targets: [], text: '', target: null, ring: null };
    if (m.vehicle) {
      // reuse：优先用停在原地的那一辆（飞机、坦克），没有才新生成
      let v = m.reuse ? sim.vehicles.find((o) => o.type === m.vehicle && o.usable && !o.driver && Math.hypot(o.x - m.spawn[0], o.z - m.spawn[1]) < 40) : null;
      if (!v) v = sim.addVehicle(m.vehicle, m.spawn[0], m.spawn[1], m.spawn[2]);
      v.mission = true; v.free = true; a.vehicle = v;
    }
    if (m.type === 'kill') {
      const i = WEAPON_INDEX.smg; p.owned[i] = true; p.ammo[i] += 150; p.weapon = i;
      for (const [x, z] of m.foes) { const o = sim.addPed('gang', x, z); o.mission = true; a.foes.push(o); }
    }
    if (m.guards) for (const [x, z] of m.guards) { const o = sim.addPed('gang', x, z); o.mission = true; a.foes.push(o); }
    if (m.type === 'destroy') {
      sim.wantedLock = true; sim.clearWanted();
      // 靶车：摆在任务点附近的路口上
      const nodes = sim.world.roadNodes.slice().sort((x, y) => Math.hypot(x.x - m.at[0], x.z - m.at[1]) - Math.hypot(y.x - m.at[0], y.z - m.at[1]));
      for (let k = 2; k < 2 + m.count && k < nodes.length; k++) { const t = sim.addVehicle('target', nodes[k].x + 3, nodes[k].z + 3, k); t.mission = true; a.targets.push(t); }
    }
    sim.emit({ type: 'mission', what: 'start', name: m.name, desc: m.desc });
  }

  /** 推进任务。返回 'win'、失败原因（字符串）或 undefined（继续） */
  tick(a, dt) {
    const sim = this.sim, p = sim.player, d = a.def, v = a.vehicle;
    a.ring = null;
    if (v && !v.alive) return v.sunk ? '载具沉了' : '载具被毁了';
    if (d.type === 'kill') {
      const alive = a.foes.filter((o) => o.alive);
      if (!alive.length) return 'win';
      a.text = `放倒帮派分子（还剩 ${alive.length} 人）`;
      a.target = alive.reduce((b, o) => (Math.hypot(o.x - p.x, o.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? o : b));
      return;
    }
    // 以下两种都要先上车
    if (a.stage === 0) {
      a.text = `坐上${VEH[d.vehicle].name}`; a.target = v;
      if (p.inVeh === v) { a.stage = 1; if (d.heat) sim.crime(d.heat); sim.emit({ type: 'mission', what: 'step' }); }
      return;
    }
    if (a.timer > 0 && (a.timer -= dt) <= 0) { a.timer = 0; return '时间到了'; }
    if (p.inVeh !== v) { a.text = `回到${VEH[d.vehicle].name}上`; a.target = v; if ((a.away += dt) > 25) return '你离开载具太久了'; return; }
    a.away = 0;
    if (d.type === 'destroy') {
      const alive = a.targets.filter((t) => t.alive);
      if (!alive.length) return 'win';
      a.text = `摧毁靶车（还剩 ${alive.length} 辆）`;
      a.target = alive.reduce((b, o) => (Math.hypot(o.x - p.x, o.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? o : b));
      return;
    }
    const n = d.cps.length;
    if (a.cp >= n) {                        // 飞行任务的最后一步：降落
      a.text = '降落到跑道上并停稳'; a.target = { x: RUNWAY.x, z: (RUNWAY.z0 + RUNWAY.z1) / 2 };
      if (!v.flying && Math.abs(v.speed) < 12 && Math.abs(v.x - RUNWAY.x) < RUNWAY.w && v.z > RUNWAY.z0 - 20 && v.z < RUNWAY.z1 + 20) return 'win';
      return;
    }
    const c = d.cps[a.cp], air = c[2] !== undefined;
    a.text = d.cpText ? d.cpText(a.cp, n) : `前往检查点 ${a.cp + 1}/${n}`;
    a.target = { x: c[0], z: c[1], y: c[2] };
    a.ring = { x: c[0], z: c[1], y: air ? c[2] : null, r: air ? 22 : 7, next: d.cps[a.cp + 1] || null };
    if (Math.hypot(p.x - c[0], p.z - c[1]) < (air ? 24 : 7.5) && (!air || Math.abs(p.y - c[2]) < 22)) {
      a.cp++; a.timer += d.cpTime || 0;
      sim.emit({ type: 'mission', what: 'checkpoint' });
      if (a.cp >= n && !d.land) return 'win';
    }
  }

  cleanup() {
    const a = this.active, sim = this.sim;
    if (!a) return;
    if (a.vehicle) a.vehicle.mission = false;
    for (const o of a.foes) { o.mission = false; if (o.alive) { o.alive = false; o.deadT = 99; } }
    for (const t of a.targets) { t.mission = false; const i = sim.vehicles.indexOf(t); if (i >= 0 && t.alive) sim.vehicles.splice(i, 1); }
    if (a.def.type === 'destroy') sim.wantedLock = false;
    this.active = null; this.cool = 4;
  }

  win() {
    const a = this.active, sim = this.sim;
    if (!a) return;
    const first = !this.done.has(a.def.id), reward = first ? a.def.reward : Math.round(a.def.reward * 0.4);
    this.done.add(a.def.id);
    this.cleanup();
    sim.addMoney(reward);
    sim.emit({ type: 'mission', what: 'win', name: a.def.name, reward, first });
  }

  fail(reason) {
    const a = this.active;
    if (!a) return;
    this.cleanup();
    this.sim.emit({ type: 'mission', what: 'fail', name: a.def.name, reason });
  }
}
