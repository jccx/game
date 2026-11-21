// 落日湾的纯逻辑测试：不开浏览器，检查各类载具、武器、通缉、任务的规则，并长时间空跑确认不出错。
// 用法：node test/city-sim.mjs
import { Sim } from '../city/js/sim.js';
import { TICK, WEAPON_INDEX, WEAPONS, AMMO, PED } from '../city/js/config.js';
import { terrainY, RUNWAY } from '../city/js/world.js';

const dt = 1 / TICK;
let fail = 0;
const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const run = (sim, sec, fn) => { for (let i = 0; i < sec * TICK; i++) { if (fn) fn(i * dt); sim.update(dt); sim.events.length = 0; } };
const tp = (sim, x, z) => { const p = sim.player; p.x = p.px = x; p.z = p.pz = z; p.y = sim.world.groundY(x, z); };
const finite = (sim) => [sim.player, ...sim.vehicles, ...sim.peds].every((o) => Number.isFinite(o.x) && Number.isFinite(o.z) && Number.isFinite(o.y));

// ---- 1) 步行 + 空跑：行人和交通会出现 ----
{
  const sim = new Sim(), p = sim.player, x0 = p.x;
  run(sim, 3, () => { sim.ctl.mx = -1; sim.ctl.mz = 0; });
  chk(x0 - p.x > 10, `步行 3 秒向西走了 ${(x0 - p.x).toFixed(1)} 米`);
  sim.ctl.mx = 0;
  const t0 = Date.now();
  run(sim, 60);
  const ms = Date.now() - t0;
  const civ = sim.peds.filter((o) => o.kind === 'civ').length, traffic = sim.vehicles.filter((v) => v.ai && v.ai.kind === 'traffic').length;
  chk(civ >= 10, `空跑 60 秒后附近有 ${civ} 个行人`);
  chk(traffic >= 6, `路上有 ${traffic} 辆行驶中的车（总共 ${sim.vehicles.length} 辆）`);
  chk(finite(sim), '所有坐标都是合法数值');
  chk(sim.vehicles.filter((v) => v.ai && v.ai.kind === 'traffic').every((v) => v.alive), '交通车没有自己撞毁');
  console.log(`     每逻辑帧耗时 ${(ms / (60 * TICK)).toFixed(3)} ms`);
}

// ---- 2) 汽车 ----
{
  const sim = new Sim(), p = sim.player;
  const car = sim.vehicles.find((v) => v.type === 'sedan' && v.fixed);
  tp(sim, car.x + 2.5, car.z);
  sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === car, '走到车旁按上车键，坐进了轿车');
  const z0 = car.z;
  run(sim, 5, () => { sim.ctl.gas = 1; });
  chk(car.z - z0 > 40 && car.speed > 20, `踩油门 5 秒：前进 ${(car.z - z0).toFixed(0)} 米，时速 ${(car.speed * 3.6).toFixed(0)} 公里`);
  const yaw0 = car.yaw;
  run(sim, 1, () => { sim.ctl.gas = 0.3; sim.ctl.steer = 1; });
  chk(car.yaw < yaw0 - 0.3, `向右打方向，车头右转了 ${((yaw0 - car.yaw) * 57.3).toFixed(0)} 度`);
  sim.ctl.steer = 0; sim.ctl.gas = -1; run(sim, 4);
  sim.ctl.gas = 0; sim.ctl.enter = true; run(sim, 0.2);
  chk(!p.inVeh && Math.hypot(p.x - car.x, p.z - car.z) < 4, '下车后站在车旁');
}

// ---- 3) 船 ----
{
  const sim = new Sim(), p = sim.player, boat = sim.vehicles.find((v) => v.type === 'boat');
  tp(sim, boat.x + 2, boat.z); p.y = 0;
  sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === boat, '上了快艇');
  const z0 = boat.z;
  run(sim, 6, () => { sim.ctl.gas = 1; });
  chk(Math.hypot(boat.x - P0(boat), 0) >= 0 && Math.abs(boat.z - z0) > 40 && boat.alive, `快艇 6 秒开出 ${Math.abs(boat.z - z0).toFixed(0)} 米，仍在水面上（海底深度 ${terrainY(boat.x, boat.z).toFixed(1)}）`);
  function P0(b) { return b.x; }
}

// ---- 4) 飞机：起飞、爬升、转弯 ----
{
  const sim = new Sim(), p = sim.player, plane = sim.vehicles.find((v) => v.type === 'plane');
  tp(sim, plane.x + 3, plane.z);
  sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === plane, '上了飞机');
  run(sim, 7, () => { sim.ctl.gas = 1; sim.ctl.pitch = 0; });
  chk(plane.speed >= 30 && !plane.flying, `滑跑 7 秒速度 ${plane.speed.toFixed(0)} 米/秒，还在地面`);
  run(sim, 6, () => { sim.ctl.gas = 1; sim.ctl.pitch = 1; });
  chk(plane.flying && plane.y > 25, `拉杆后起飞，6 秒爬到 ${plane.y.toFixed(0)} 米`);
  const yaw0 = plane.yaw;
  run(sim, 3, () => { sim.ctl.pitch = 0.1; sim.ctl.steer = -1; });
  chk(plane.yaw > yaw0 + 0.5 && plane.alive, `向左压杆 3 秒，航向左转 ${((plane.yaw - yaw0) * 57.3).toFixed(0)} 度`);
  // 往空旷处飞，然后收油门俯冲坠毁，确认会爆炸而不是出错
  run(sim, 40, () => { sim.ctl.steer = 0; sim.ctl.pitch = -1; sim.ctl.gas = 0; });
  chk(!plane.alive && !p.inVeh, '俯冲触地后飞机坠毁，玩家被甩出');
  chk(finite(sim), '坠毁后数值仍然合法');
}

// ---- 5) 坦克开炮 ----
{
  const sim = new Sim(), p = sim.player, tank = sim.vehicles.find((v) => v.type === 'tank');     // 军营里的那辆
  tp(sim, tank.x, tank.z + 4);
  sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === tank, '上了坦克');
  const fx = Math.sin(tank.yaw), fz = Math.cos(tank.yaw);
  const dummy = sim.addVehicle('target', tank.x + fx * 40, tank.z + fz * 40, 0);
  let boom = 0;
  for (let i = 0; i < 3 * TICK; i++) { sim.ctl.fire = true; sim.update(dt); boom += sim.events.filter((e) => e.type === 'explosion').length; sim.events.length = 0; }
  sim.ctl.fire = false;
  chk(boom >= 1 && (dummy.burning || !dummy.alive), `开炮命中 40 米外的靶车（爆炸 ${boom} 次）`);
  chk(sim.stars >= 3, `偷开军营里的坦克被通缉：${sim.stars} 星`);
  const s2 = new Sim(), free = s2.vehicles.filter((v) => v.type === 'tank').at(-1);
  tp(s2, free.x, free.z + 4); s2.ctl.enter = true; run(s2, 0.1);
  chk(s2.player.inVeh === free && s2.stars === 0, '军营门外那辆坦克可以随便开，不会被通缉');
}

// ---- 6) 枪战和通缉 ----
{
  const sim = new Sim(), p = sim.player;
  run(sim, 2);
  const ped = sim.addPed('civ', p.x - 8, p.z); ped.block = null;
  sim.ctl.aimYaw = -Math.PI / 2; p.weapon = WEAPON_INDEX.pistol;
  const ammo0 = p.ammo[1];
  run(sim, 1.5, () => { sim.ctl.fire = true; });
  sim.ctl.fire = false;
  chk(!ped.alive && p.ammo[1] < ammo0, `手枪打倒 8 米外的行人，用了 ${ammo0 - p.ammo[1]} 发子弹`);
  chk(sim.stars >= 1, `开枪伤人后被通缉：${sim.stars} 星`);
  sim.heat = 3; sim.stars = 3;
  let minHp = 100, maxCops = 0, tArrive = -1;
  run(sim, 30, (t) => { minHp = Math.min(minHp, p.hp); const n = sim.peds.filter((o) => o.kind === 'cop' && o.alive).length; if (n > maxCops) maxCops = n; if (n && tArrive < 0) tArrive = t; });
  chk(maxCops >= 2, `三星通缉后警车赶到、警察下车（最多同时 ${maxCops} 人，第 ${tArrive.toFixed(0)} 秒到场）`);
  chk(minHp < 100, `警察开枪打中了站着不动的玩家（生命最低 ${minHp.toFixed(0)}）`);
  // 无敌作弊不掉血
  p.hp = 100; p.godT = 15; run(sim, 5);
  chk(p.hp === 100, '无敌期间不掉血');
  // 被击倒后在医院重生，通缉清零
  p.godT = 0; sim.hurtPlayer(500); run(sim, 6);
  const h = sim.world.places.hospital;
  chk(!p.dead && p.hp === 100 && Math.hypot(p.x - h.x, p.z - h.z) < 3 && sim.stars === 0, '倒下后在医院重生，通缉清零');
}

// ---- 7) 任务 ----
{
  const sim = new Sim(), w = sim.world, p = sim.player;
  let bad = 0;
  for (const m of sim.missions.list) {
    const t = { x: m.at[0], z: m.at[1] };
    if (w.collide({ ...t }, 0.6) || w.groundY(t.x, t.z) < 1.9) { bad++; console.log('  任务点位置不对：', m.name, m.at); }
    if (m.type === 'checkpoints' && m.vehicle !== 'plane') for (const c of m.cps) {
      const water = terrainY(c[0], c[1]) < -1.5;
      if (m.vehicle === 'boat' ? !water : (w.groundY(c[0], c[1]) < 1.9 || w.collide({ x: c[0], z: c[1] }, 1))) { bad++; console.log('  检查点位置不对：', m.name, c); }
    }
    if (m.spawn && m.vehicle !== 'boat' && (w.groundY(m.spawn[0], m.spawn[1]) < 1.9 || w.collide({ x: m.spawn[0], z: m.spawn[1] }, 1.5))) { bad++; console.log('  任务载具位置不对：', m.name, m.spawn); }
    if (m.foes) for (const f of m.foes) if (w.collide({ x: f[0], z: f[1] }, 0.5) || w.groundY(f[0], f[1]) < 1.9) { bad++; console.log('  敌人位置不对：', m.name, f); }
  }
  chk(bad === 0, `8 个任务的任务点、检查点、载具和敌人位置都合法（${sim.missions.list.length} 个任务）`);
  // 跑通出租车任务：进光圈 → 上车 → 逐个到达检查点
  const m = sim.missions.list[0];
  tp(sim, m.at[0], m.at[1]); run(sim, 3);
  const a = sim.missions.active;
  chk(a && a.def.id === 'taxi' && a.vehicle, '走进光圈后出租车任务开始，任务车已生成');
  tp(sim, a.vehicle.x + 2.5, a.vehicle.z); sim.ctl.enter = true; run(sim, 0.2);
  chk(p.inVeh === a.vehicle && a.stage === 1, '坐上任务车后进入下一步');
  const money0 = p.money;
  for (const c of m.cps) { a.vehicle.x = c[0]; a.vehicle.z = c[1]; a.vehicle.vx = a.vehicle.vz = 0; run(sim, 0.2); }
  chk(!sim.missions.active && sim.missions.done.has('taxi') && p.money === money0 + m.reward, `经过全部检查点后任务完成，奖励 ${m.reward}`);
  // 清场任务：敌人会还击
  sim.ctl.enter = true; run(sim, 0.2);
  const k = sim.missions.list.find((x) => x.id === 'docks');
  tp(sim, k.at[0], k.at[1]); run(sim, 5);
  const b = sim.missions.active;
  chk(b && b.foes.length === 8 && p.owned[WEAPON_INDEX.smg], '码头清场任务开始：8 个敌人，发了冲锋枪');
  for (const o of b.foes) sim.hurtPed(o, 999, true, p.x, p.z);
  run(sim, 0.2);
  chk(sim.missions.done.has('docks'), '敌人全部倒下后任务完成');
  // 坦克任务
  const tk = sim.missions.list.find((x) => x.id === 'tank');
  tp(sim, tk.at[0], tk.at[1]); run(sim, 5);
  const c2 = sim.missions.active;
  chk(c2 && c2.targets.length === 10 && sim.wantedLock, '坦克任务开始：10 辆靶车，通缉已关闭');
  sim.missions.fail('测试'); 
  chk(!sim.wantedLock && sim.vehicles.filter((v) => v.type === 'target').length === 0, '任务失败后靶车清除、通缉恢复');
  const sv = sim.save();
  chk(sv.done.includes('taxi') && sv.money === p.money, '存档包含金钱和已完成任务');
}

// ---- 8) 长时间随机乱跑，确认不出异常 ----
{
  const sim = new Sim(), p = sim.player;
  let err = null;
  try {
    for (let i = 0; i < 240 * TICK; i++) {
      if (i % 45 === 0) {
        const c = sim.ctl; c.mx = Math.random() * 2 - 1; c.mz = Math.random() * 2 - 1; c.steer = Math.random() * 2 - 1; c.gas = Math.random() < 0.8 ? 1 : -1; c.pitch = Math.random() * 2 - 1;
        c.fire = Math.random() < 0.4; c.aimYaw = Math.random() * 6.28; c.handbrake = Math.random() < 0.1;
        if (Math.random() < 0.25) c.enter = true; if (Math.random() < 0.1) c.swap = true;
      }
      sim.update(dt); sim.events.length = 0;
      if (i % 300 === 0 && !finite(sim)) { err = '出现非法数值'; break; }
    }
  } catch (e) { err = e.stack || String(e); }
  chk(!err, `随机乱按 240 秒无异常${err ? '：' + err : ''}（最后 ${sim.vehicles.length} 辆车，${sim.peds.length} 个人，${sim.stars} 星）`);
}
// ---- 9) 出生全武器、子弹自动补满、直升机、行人密度（2026-11-21） ----
{
  // 出生：5 种武器全有，子弹是初始数
  const sim = new Sim(), p = sim.player;
  chk(p.owned.every(Boolean) && p.owned.length === 5, '出生就拥有全部 5 种武器');
  chk(p.ammo[1] === 80 && p.ammo[2] === 150 && p.ammo[3] === 24 && p.ammo[4] === 6, '出生子弹是初始数（手枪 80、冲锋枪 150、霰弹枪 24、火箭筒 6）');
  for (let i = 0; i < 5; i++) { sim.selectWeapon(i); chk(p.weapon === i, `数字键能直接切到${WEAPONS[i].name}`); }
  // 读旧存档（只有两把枪）时补齐
  const old = new Sim({ money: 500, owned: [true, true, false, false, false], ammo: [0, 10, 0, 0, 0], done: [] });
  chk(old.player.owned.every(Boolean), '读旧存档（只有两把枪）时补齐全部 5 种武器');
  chk(old.player.ammo[1] === 10 && old.player.ammo[2] === 150 && old.player.ammo[3] === 24 && old.player.ammo[4] === 6, '旧存档已有的手枪保留 10 发，缺的武器按初始数补');
  // 每种武器打到 0 都自动补满，补满后能继续开火
  for (let i = 1; i < 5; i++) {
    const s2 = new Sim(), q = s2.player;
    q.weapon = i; q.ammo[i] = 1; q.shootCd = 0; s2.ctl.aimYaw = 0;
    let refilled = false;
    for (let k = 0; k < TICK && !refilled; k++) { s2.ctl.fire = true; s2.update(dt); if (s2.events.some((e) => e.type === 'refill')) refilled = true; s2.events.length = 0; }
    s2.ctl.fire = false;
    chk(refilled && q.ammo[i] === AMMO[i], `${WEAPONS[i].name}打到 0 后自动补满到 ${AMMO[i]} 发（当前 ${q.ammo[i]}）`);
    q.shootCd = 0; s2.ctl.fire = true; s2.update(dt); s2.ctl.fire = false; s2.events.length = 0;
    chk(q.ammo[i] === AMMO[i] - 1, `${WEAPONS[i].name}补满后继续开火，子弹又打出去了（剩 ${q.ammo[i]} 发）`);
  }
  // 直升机：机场停机坪、上下机、垂直起降、悬停、前飞、转向、降落
  const heli = sim.vehicles.find((v) => v.type === 'heli');
  chk(!!heli, '机场停了一架直升机');
  chk(heli && Math.hypot(heli.x - 1210, heli.z - 760) < 1 && sim.world.groundY(heli.x, heli.z) === 2, `直升机在机场停机坪（${heli.x.toFixed(0)}, ${heli.z.toFixed(0)}，地面高 2 米）`);
  tp(sim, heli.x + 2.5, heli.z);
  sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === heli, '走到直升机旁按上车键，坐进直升机');
  run(sim, 3, () => { sim.ctl.pitch = 1; sim.ctl.gas = 0; });
  chk(heli.flying && heli.y > 25 && Math.abs(heli.speed) < 1, `拉升降杆 3 秒原地升到 ${heli.y.toFixed(0)} 米，水平速度 ${heli.speed.toFixed(1)}（不用跑道）`);
  const y0 = heli.y;
  run(sim, 2, () => { sim.ctl.pitch = 0; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(heli.flying && Math.abs(heli.y - y0) < 1.5, `悬停 2 秒高度变化 ${Math.abs(heli.y - y0).toFixed(1)} 米`);
  const x0 = heli.x, z0 = heli.z;
  run(sim, 3, () => { sim.ctl.gas = 1; sim.ctl.pitch = 0; });
  chk(Math.hypot(heli.x - x0, heli.z - z0) > 20, `油门 3 秒向前飞出 ${Math.hypot(heli.x - x0, heli.z - z0).toFixed(0)} 米`);
  const yaw0 = heli.yaw;
  run(sim, 2, () => { sim.ctl.gas = 0.3; sim.ctl.steer = -1; sim.ctl.pitch = 0; });   // 向左转，往跑道方向飞，避开西侧的航站楼和塔台
  chk(heli.yaw > yaw0 + 0.3, `向左压杆 2 秒，航向左转 ${((heli.yaw - yaw0) * 57.3).toFixed(0)} 度`);
  run(sim, 10, () => { sim.ctl.pitch = -0.4; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(!heli.flying && heli.alive, `轻推降落杆后平稳落地（高度 ${heli.y.toFixed(1)} 米）`);
  sim.ctl.enter = true; run(sim, 0.2);
  chk(!p.inVeh && Math.hypot(p.x - heli.x, p.z - heli.z) < 4, '降落后下机，站在直升机旁');
  // 满杆砸下来会坠毁（复用飞机的 -9 米/秒阈值）
  const s3 = new Sim(), h2 = s3.vehicles.find((v) => v.type === 'heli');
  tp(s3, h2.x + 2.5, h2.z); s3.ctl.enter = true; run(s3, 0.1);
  run(s3, 3, () => { s3.ctl.pitch = 1; });
  run(s3, 6, () => { s3.ctl.pitch = -1; s3.ctl.gas = 0; });
  chk(!h2.alive && !s3.player.inVeh, '满杆下降触地后直升机坠毁，玩家被甩出');
  chk(finite(s3), '坠毁后数值仍然合法');
  // 行人密度：上限 36，空跑后附近平民能达到新目标
  chk(PED.count === 36, '行人上限是 36（从 18 翻倍）');
  const s4 = new Sim();
  run(s4, 60);
  const civ = s4.peds.filter((o) => o.kind === 'civ' && o.alive).length;
  chk(civ >= 30, `空跑 60 秒后附近有 ${civ} 个平民行人（目标 36）`);
  chk(finite(s4), '行人翻倍后数值仍然合法');
}
console.log(fail ? `有 ${fail} 项失败` : '落日湾逻辑测试全部通过');
process.exit(fail ? 1 : 0);
