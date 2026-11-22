// 落日湾的纯逻辑测试：不开浏览器，检查各类载具、武器、通缉、任务的规则，并长时间空跑确认不出错。
// 用法：node test/city-sim.mjs
import { Sim } from '../city/js/sim.js';
import { TICK, WEAPON_INDEX, WEAPONS, AMMO, PED, VEH, COP } from '../city/js/config.js';
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
        c.fire = Math.random() < 0.4; c.rocket = Math.random() < 0.2; c.aimYaw = Math.random() * 6.28; c.aimSet = Math.random() < 0.5; c.handbrake = Math.random() < 0.1;
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
  // 出生：6 种武器全有，子弹是初始数
  const sim = new Sim(), p = sim.player;
  chk(p.owned.every(Boolean) && p.owned.length === 6, '出生就拥有全部 6 种武器');
  chk(p.ammo[1] === 80 && p.ammo[2] === 150 && p.ammo[3] === 24 && p.ammo[4] === 6 && p.ammo[5] === 4, '出生子弹是初始数（手枪 80、冲锋枪 150、霰弹枪 24、火箭筒 6、烟花 4）');
  for (let i = 0; i < 6; i++) { sim.selectWeapon(i); chk(p.weapon === i, `数字键能直接切到${WEAPONS[i].name}`); }
  // 读旧存档（只有两把枪）时补齐
  const old = new Sim({ money: 500, owned: [true, true, false, false, false], ammo: [0, 10, 0, 0, 0], done: [] });
  chk(old.player.owned.every(Boolean), '读旧存档（只有两把枪）时补齐全部 6 种武器');
  chk(old.player.ammo[1] === 10 && old.player.ammo[2] === 150 && old.player.ammo[3] === 24 && old.player.ammo[4] === 6 && old.player.ammo[5] === 4, '旧存档已有的手枪保留 10 发，缺的武器按初始数补（烟花 也补 4 发）');
  // 每种武器打到 0 都自动补满，补满后能继续开火
  for (let i = 1; i < 6; i++) {
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
// ---- 10) 直升机降落楼顶（2026-11-21） ----
{
  const sim = new Sim(), p = sim.player, w = sim.world;
  // 找一栋够大的平顶高楼当靶子
  const tower = w.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
  const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
  chk(!!tower, `找到一栋够大的平顶高楼（${(tower.x1 - tower.x0).toFixed(0)}x${(tower.z1 - tower.z0).toFixed(0)} 米，顶 ${top.toFixed(0)} 米）`);
  // roofAt：楼顶中央算，楼顶边缘/小楼/斜屋顶不算
  chk(w.roofAt(cx, cz, 0, 7.5, 2.6) && Math.abs(w.roofAt(cx, cz, 0, 7.5, 2.6).top - top) < 0.01, '屋顶查询：楼顶中央能降，高度就是 y0 + h');
  chk(!w.roofAt(tower.x0 + 0.5, cz, 0, 7.5, 2.6), '屋顶查询：贴着楼边、机身一半悬空就不算');
  chk(!w.roofAt(cx, cz, 0, 30, 30), '屋顶查询：30 米长的“直升机”放不下，不算');
  const wallRoofs = w.buildings.filter((b) => b.kind === 'wall').map((b) => w.roofAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0, 7.5, 2.6));
  chk(wallRoofs.every((r) => !r), '屋顶查询：1 米宽的围墙放不下直升机，不算');
  const house = w.buildings.find((b) => b.kind === 'house');
  chk(house && !w.roofAt((house.x0 + house.x1) / 2, (house.z0 + house.z1) / 2, 0, 7.5, 2.6), '屋顶查询：斜屋顶的民居不算（顶上有斜坡会穿模）');
  // 上直升机，飞到楼顶上方，轻推慢降
  const heli = sim.vehicles.find((v) => v.type === 'heli');
  tp(sim, heli.x + 2.5, heli.z); sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === heli, '上直升机，准备飞楼顶');
  heli.x = cx; heli.z = cz; heli.y = top + 30; heli.flying = true; heli.vy = 0; heli.pitch = 0; heli.roll = 0; heli.yaw = 0;
  run(sim, 12, () => { sim.ctl.pitch = -0.3; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(!heli.flying && heli.alive && Math.abs(heli.y - top) < 0.6, `轻推慢降到楼顶中央：平稳降落不爆炸（高度 ${heli.y.toFixed(1)} 米，楼顶 ${top.toFixed(1)} 米）`);
  // 停稳后下机，站在楼顶上
  sim.ctl.enter = true; run(sim, 0.2);
  chk(!p.inVeh && Math.abs(p.y - top) < 1, `降落后下机，站在楼顶上（玩家高度 ${p.y.toFixed(1)} 米）`);
  // 再上机、再起飞
  sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === heli, '楼顶上能再上直升机');
  run(sim, 3, () => { sim.ctl.pitch = 1; sim.ctl.gas = 0; });
  chk(heli.flying && heli.y > top + 10, `楼顶再起飞，3 秒升到楼顶上方 ${(heli.y - top).toFixed(0)} 米`);
  // 再落回楼顶，下机后在楼顶上走路，走出几米还在楼顶上
  run(sim, 12, () => { sim.ctl.pitch = -0.3; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(!heli.flying && heli.alive && Math.abs(heli.y - top) < 0.6, '第二次轻推慢降，照旧平稳落在楼顶上');
  sim.ctl.enter = true; run(sim, 0.2);
  chk(!p.inVeh && Math.abs(p.y - top) < 1, '第二次下机，站在楼顶上');
  const px0 = p.x;
  run(sim, 0.5, () => { sim.ctl.mx = 1; sim.ctl.mz = 0; });
  sim.ctl.mx = 0;
  chk(p.x - px0 > 1.5 && Math.abs(p.y - top) < 1, `在楼顶上能走路，走出 ${(p.x - px0).toFixed(1)} 米还在楼顶上`);
  // 满杆砸下来照旧坠毁
  const s2 = new Sim(), h2 = s2.vehicles.find((v) => v.type === 'heli');
  tp(s2, h2.x + 2.5, h2.z); s2.ctl.enter = true; run(s2, 0.1);
  h2.x = cx; h2.z = cz; h2.y = top + 30; h2.flying = true; h2.vy = 0; h2.pitch = 0; h2.roll = 0; h2.yaw = 0;
  run(s2, 6, () => { s2.ctl.pitch = -1; s2.ctl.gas = 0; });
  chk(!h2.alive && !s2.player.inVeh, '满杆下降砸楼顶照旧坠毁');
  // 机身太斜：快到楼顶时强行侧倾，也坠毁（正常飞行里俯仰/侧倾到不了 0.6，这里直接改状态验判定）
  const s3 = new Sim(), h3 = s3.vehicles.find((v) => v.type === 'heli');
  tp(s3, h3.x + 2.5, h3.z); s3.ctl.enter = true; run(s3, 0.1);
  h3.x = cx; h3.z = cz; h3.y = top + 0.5; h3.flying = true; h3.vy = 0; h3.pitch = 1.2; h3.roll = 0; h3.yaw = 0;
  run(s3, 1, () => { s3.ctl.pitch = -0.3; s3.ctl.gas = 0; });
  chk(!h3.alive, '机身太斜着落楼顶照旧坠毁');
  // 撞楼侧面照旧坠毁：从楼顶高度以下横着飞过去撞墙
  const s4 = new Sim(), h4 = s4.vehicles.find((v) => v.type === 'heli');
  tp(s4, h4.x + 2.5, h4.z); s4.ctl.enter = true; run(s4, 0.1);
  h4.x = tower.x0 - 25; h4.z = cz; h4.y = top - 8; h4.flying = true; h4.vy = 0; h4.yaw = Math.PI / 2; h4.pitch = 0; h4.roll = 0;
  run(s4, 4, () => { s4.ctl.pitch = 0; s4.ctl.gas = 1; s4.ctl.steer = 0; });
  chk(!h4.alive, '从楼顶高度以下横着撞楼侧面照旧坠毁');
  // 楼顶降落不影响地面降落：轻推落回地面照旧
  const s5 = new Sim(), h5 = s5.vehicles.find((v) => v.type === 'heli');
  tp(s5, h5.x + 2.5, h5.z); s5.ctl.enter = true; run(s5, 0.1);
  run(s5, 3, () => { s5.ctl.pitch = 1; });
  run(s5, 10, () => { s5.ctl.pitch = -0.4; s5.ctl.gas = 0; s5.ctl.steer = 0; });
  chk(!h5.flying && h5.alive, '地面轻推降落照旧平稳落地');
  chk(finite(s5), '楼顶降落一轮后数值仍然合法');
}

// ---- 11) 载具上发射火箭筒（2026-11-21） ----
{
  const R = WEAPON_INDEX.rocket;
  // 按住火箭键跑几秒，数这期间发出的火箭弹和坦克炮弹
  const holdRocket = (sim, secs) => {
    let rocket = 0, shell = 0, booms = 0;
    sim.ctl.rocket = true;
    for (let i = 0; i < secs * TICK; i++) {
      sim.update(dt);
      for (const e of sim.events) { if (e.type === 'shot' && e.w === 'rocket') rocket++; if (e.type === 'shot' && e.w === 'shell') shell++; if (e.type === 'explosion') booms++; }
      sim.events.length = 0;
    }
    sim.ctl.rocket = false;
    return { rocket, shell, booms };
  };
  // 找一条从车的位置出发、30 米内没有建筑的开阔方向，免得火箭一出发就撞楼、炸伤自己的车
  const clearYaw = (sim, v) => {
    for (const y of [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4]) {
      if (!sim.world.blocked(v.x, v.z, v.x + Math.sin(y) * 30, v.z + Math.cos(y) * 30, v.y + 2.2)) return y;
    }
    return 0;
  };
  for (const [type, name] of [['sedan', '轿车'], ['bike', '摩托'], ['boat', '快艇'], ['plane', '飞机'], ['heli', '直升机'], ['tank', '坦克']]) {
    const sim = new Sim(), p = sim.player;
    const v = sim.vehicles.find((o) => o.type === type && o.usable && !o.driver);
    tp(sim, v.x + 2.5, v.z); sim.ctl.enter = true; run(sim, 0.1);
    chk(p.inVeh === v, `上${name}准备发火箭筒`);
    if (type === 'heli') { run(sim, 3, () => { sim.ctl.pitch = 1; sim.ctl.gas = 0; }); sim.ctl.pitch = 0; sim.ctl.gas = 0; }   // 直升机先升空，空中也能发；升空后收杆悬停，不然会一直爬升
    sim.ctl.aimYaw = clearYaw(sim, v); sim.ctl.aimSet = true;
    const hp0 = v.hp, ammo0 = p.ammo[R], weapon0 = p.weapon;
    const r = holdRocket(sim, 1);
    chk(r.rocket >= 9 && r.rocket <= 11, `${name}上按住火箭键 1 秒发了 ${r.rocket} 枚火箭（射速 10 发/秒）`);
    chk(p.ammo[R] !== ammo0, `${name}上发火箭筒：火箭飞出去了，弹药 ${ammo0} → ${p.ammo[R]}（6 发打空自动补满）`);
    chk(v.alive && v.hp === hp0, `${name}上发火箭筒：自己的车完好无损（耐久 ${v.hp}/${v.spec.hp}）`);
    chk(p.weapon === weapon0, `${name}上发火箭不改变当前选中的武器（还是${WEAPONS[weapon0].name}）`);
    // 发出去的火箭不会一出发就炸自己的车：再跑 2 秒，等它飞远炸开，自己的车还是完好
    run(sim, 2);
    chk(v.alive && v.hp === hp0, `${name}上火箭飞远爆炸后，自己的车还是完好无损`);
    if (type === 'heli') run(sim, 12, () => { sim.ctl.pitch = -0.4; sim.ctl.gas = 0; sim.ctl.steer = 0; });   // 直升机先落回地面再下机
    // 下车后武器和弹药状态不变（和开火结束时比，不再变动）
    const ammoAfter = p.ammo[R];
    sim.ctl.enter = true; run(sim, 0.2);
    chk(!p.inVeh && p.ammo[R] === ammoAfter && p.weapon === weapon0, `${name}上下车后火箭弹药还是 ${p.ammo[R]} 发，武器没变`);
  }
  // 弹药打空自动补满到 6 发，和步行一致
  {
    const sim = new Sim(), p = sim.player;
    const car = sim.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(sim, car.x + 2.5, car.z); sim.ctl.enter = true; run(sim, 0.1);
    sim.ctl.aimYaw = clearYaw(sim, car); sim.ctl.aimSet = true;
    p.ammo[R] = 1; p.shootCd = 0;
    sim.ctl.rocket = true; sim.update(dt); sim.ctl.rocket = false;   // 只开一发：按住 1 秒现在会打 10 发，弹药数就不是 6 了
    chk(p.ammo[R] === 6, `车上火箭剩 1 发时开一发，打空后自动补满到 6 发（当前 ${p.ammo[R]}）`);
  }
  // 没有瞄准方向时用车头方向：aimSet 为假，瞄准角写个错的也不用
  {
    const sim = new Sim(), p = sim.player;
    const car = sim.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(sim, car.x + 2.5, car.z); sim.ctl.enter = true; run(sim, 0.1);
    sim.ctl.aimYaw = 2.5; sim.ctl.aimSet = false;   // 瞄准角 2.5 是错的，车头朝北（yaw 0）
    sim.ctl.rocket = true; sim.update(dt); sim.ctl.rocket = false;
    const s = sim.shots[0];
    chk(s && Math.abs(s.dx - Math.sin(car.yaw)) < 0.01 && Math.abs(s.dz - Math.cos(car.yaw)) < 0.01, '没有瞄准方向时火箭沿车头方向飞（没被错误的瞄准角带偏）');
  }
  // 坦克：火箭键只发火箭不发炮，炮键只发炮不发火箭
  {
    const sim = new Sim(), p = sim.player;
    const tank = sim.vehicles.find((v) => v.type === 'tank');
    tp(sim, tank.x, tank.z + 4); sim.ctl.enter = true; run(sim, 0.1);
    sim.ctl.aimYaw = clearYaw(sim, tank); sim.ctl.aimSet = true;
    const r = holdRocket(sim, 2);
    chk(r.rocket >= 19 && r.rocket <= 21 && r.shell === 0, `坦克按火箭键 2 秒：只发火箭（${r.rocket} 发，射速 10 发/秒），没同时开炮`);
    let shells = 0;
    sim.ctl.fire = true;
    for (let i = 0; i < 2 * TICK; i++) { sim.update(dt); for (const e of sim.events) if (e.type === 'shot' && e.w === 'shell') shells++; sim.events.length = 0; }
    sim.ctl.fire = false;
    chk(shells >= 18 && shells <= 22, `坦克按开炮键 2 秒：坦克炮 ${shells} 发（射速 10 发/秒，reload 0.1 秒）`);
  }
}

// ---- 12) 火箭筒射程无限（2026-11-21） ----
// 注意：火箭有重力下坠（每帧 dy 减，不改），地面平射 47 米就落地，所以 200/250 米的测试必须从高处打：
// 步行从最高的平顶楼顶（地标进场后约 74 米，原来 95 米的楼让给了西尔斯大厦）平射，弹道约 270 米才落地；
// 车上从 150 米高的直升机上发，飞得更远。
{
  const R = WEAPON_INDEX.rocket;
  // 沿弹道逐段检查净空：火箭从 y0 平射，y(d) = y0 + 55*(0.02*(d/55) - 0.06*(d/55)^2)，每 10 米一段，留 3 米余量
  const arcClear = (w, ox, oz, yaw, y0, dist) => {
    for (let d = 10; d < dist; d += 10) {
      const t = d / 55, y = y0 + 55 * (0.02 * t - 0.06 * t * t);
      const x1 = ox + Math.sin(yaw) * d, z1 = oz + Math.cos(yaw) * d;
      const x2 = ox + Math.sin(yaw) * (d + 10), z2 = oz + Math.cos(yaw) * (d + 10);
      if (w.blocked(x1, z1, x2, z2, y - 3)) return false;
    }
    return true;
  };
  // 上直升机，落到最高的平顶楼顶上，下机，走到楼东边 6 米（离直升机远一点，免得火箭一出发就撞上它）
  const sim = new Sim(), p = sim.player, w = sim.world;
  const tower = w.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
  const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
  const heli = sim.vehicles.find((v) => v.type === 'heli');
  tp(sim, heli.x + 2.5, heli.z); sim.ctl.enter = true; run(sim, 0.1);
  heli.x = cx; heli.z = cz; heli.y = top + 30; heli.flying = true; heli.vy = 0; heli.pitch = 0; heli.roll = 0; heli.yaw = 0;
  run(sim, 12, () => { sim.ctl.pitch = -0.3; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(!heli.flying && heli.alive, '射程测试：直升机先落到楼顶上');
  sim.ctl.enter = true; run(sim, 0.2);
  p.x = p.px = cx + 6; p.z = p.pz = cz;   // 站到楼东边，离直升机 6 米
  const fx = p.x, fz = p.z, y0 = top + 1.5;
  // 找一条从楼顶出发、280 米弹道净空的方向
  let yaw = null;
  for (let k = 0; k < 16; k++) { const y = k * Math.PI / 8; if (arcClear(w, fx, fz, y, y0, 280)) { yaw = y; break; } }
  chk(yaw !== null, `找到一条 280 米弹道净空的方向（朝向 ${yaw !== null ? (yaw * 57.3).toFixed(0) : '-'} 度）`);
  // 步行：火箭飞过 130 米、200 米仍在飞，打中 265 米外的靶车才爆炸（从 74 米楼顶平射约 269 米落地，265 米是刚好能打中的最远距离）
  const target = sim.addVehicle('target', fx + Math.sin(yaw) * 265, fz + Math.cos(yaw) * 265, 0);
  target.fixed = true;   // 265 米超出交通回收距离（240 米），不固定会被 spawnTraffic 当远处闲车回收掉
  chk(w.groundY(target.x, target.z) >= 1.9, '265 米外的靶车落在陆地上');
  tp(sim, fx, fz); p.y = top; p.weapon = R; p.shootCd = 0; sim.ctl.aimYaw = yaw; sim.ctl.aimSet = true;
  let maxDist = 0, explodedBefore200 = false, hitTarget = false;
  sim.ctl.fire = true;
  for (let i = 0; i < 10 * TICK; i++) {
    sim.update(dt);
    for (const s of sim.shots) maxDist = Math.max(maxDist, Math.hypot(s.x - fx, s.z - fz));
    const booms = sim.events.filter((e) => e.type === 'explosion');
    if (booms.length && maxDist < 200) explodedBefore200 = true;
    if (booms.length && (target.burning || !target.alive || target.hp < target.spec.hp)) hitTarget = true;
    sim.events.length = 0;
    if (hitTarget) break;
    if (i === 0) sim.ctl.fire = false;   // 只开一发
  }
  chk(maxDist > 200, `楼顶步行发火箭：飞过 ${maxDist.toFixed(0)} 米才炸（130 米处没有自己爆炸）`);
  chk(!explodedBefore200, '楼顶步行发火箭：200 米内没有爆炸');
  chk(hitTarget, `楼顶步行发火箭：打中 265 米外的靶车并炸伤它（靶车耐久 ${target.hp.toFixed(0)}/${target.spec.hp}）`);
  // 自动瞄准仍只在 130 米内：150 米外的靶车不被自动瞄准，火箭按镜头方向直飞、打不中它
  {
    const s2 = new Sim(), q = s2.player, w2 = s2.world;
    const h2 = s2.vehicles.find((v) => v.type === 'heli');
    tp(s2, h2.x + 2.5, h2.z); s2.ctl.enter = true; run(s2, 0.1);
    h2.x = cx; h2.z = cz; h2.y = top + 30; h2.flying = true; h2.vy = 0; h2.pitch = 0; h2.roll = 0; h2.yaw = 0;
    run(s2, 12, () => { s2.ctl.pitch = -0.3; s2.ctl.gas = 0; s2.ctl.steer = 0; });
    s2.ctl.enter = true; run(s2, 0.2);
    q.x = q.px = cx + 6; q.z = q.pz = cz;
    const t2 = s2.addVehicle('target', q.x + Math.sin(yaw) * 150, q.z + Math.cos(yaw) * 150, 0);
    t2.fixed = true;   // 和上面一样，防止被交通回收
    q.y = top; q.weapon = R; q.shootCd = 0;
    s2.ctl.aimYaw = yaw + 0.3; s2.ctl.aimSet = true;   // 故意瞄偏 0.3 弧度
    s2.ctl.fire = true; s2.update(dt); s2.ctl.fire = false;
    const s = s2.shots[0];
    chk(s && Math.abs(s.dx - Math.sin(yaw + 0.3)) < 0.01 && Math.abs(s.dz - Math.cos(yaw + 0.3)) < 0.01, '150 米外的目标不在瞄准辅助内：火箭按镜头方向直飞，不自动拐向目标');
    let maxD2 = 0;
    for (let i = 0; i < 6 * TICK; i++) { s2.update(dt); for (const o of s2.shots) maxD2 = Math.max(maxD2, Math.hypot(o.x - q.x, o.z - q.z)); s2.events.length = 0; }
    chk(maxD2 > 200, `瞄偏的火箭飞过 ${maxD2.toFixed(0)} 米（飞过了 150 米外的目标）`);
    chk(t2.alive && t2.hp === t2.spec.hp, '火箭按镜头方向飞过，没打中 150 米外瞄偏的目标');
  }
  // 车上同样无限射程：直升机爬到 150 米高空，朝南发火箭，飞过 200 米仍在飞
  {
    const s3 = new Sim(), q3 = s3.player;
    const h3 = s3.vehicles.find((v) => v.type === 'heli');
    tp(s3, h3.x + 2.5, h3.z); s3.ctl.enter = true; run(s3, 0.1);
    run(s3, 12, () => { s3.ctl.pitch = 1; s3.ctl.gas = 0; });   // 爬到约 150 米
    s3.ctl.pitch = 0; s3.ctl.gas = 0;   // 悬停
    chk(h3.flying && h3.y > 140, `直升机爬到 ${h3.y.toFixed(0)} 米高空准备发火箭`);
    s3.ctl.aimYaw = 0; s3.ctl.aimSet = true;   // 朝南，朝海，净空
    s3.ctl.rocket = true; s3.update(dt); s3.ctl.rocket = false;
    let maxD = 0;
    for (let i = 0; i < 8 * TICK; i++) { s3.update(dt); for (const s of s3.shots) maxD = Math.max(maxD, Math.hypot(s.x - h3.x, s.z - h3.z)); s3.events.length = 0; if (!s3.shots.length) break; }
    chk(maxD > 200, `直升机高空发火箭：飞过 ${maxD.toFixed(0)} 米仍在飞`);
    chk(finite(s3), '无限射程一轮后数值仍然合法');
  }
}
// ---- 13) 直升机新控制映射（2026-11-21）：摇杆管水平、按钮管升降 ----
// 注意：映射本身在 hud.js 的 readInput() 里（要 DOM，纯逻辑测试跑不了）；这里测的是映射写进 ctl 之后 sim 的响应，
// 也就是新映射约定的信号：gas=1 摇杆上推前进、gas=-1 摇杆下拉后退、pitch=0.6 “上升”按钮、pitch=-0.6 “下降”按钮、steer 转向。
// 真实的摇杆/按钮到 ctl 的映射在浏览器测试里直接调 hud.readInput() 验证。
{
  const sim = new Sim(), p = sim.player;
  const heli = sim.vehicles.find((v) => v.type === 'heli');
  tp(sim, heli.x + 2.5, heli.z); sim.ctl.enter = true; run(sim, 0.1);
  chk(p.inVeh === heli, '新控制测试：先上直升机');
  // “上升”按钮（pitch=0.6）原地起飞
  run(sim, 3, () => { sim.ctl.pitch = 0.6; sim.ctl.gas = 0; });
  chk(heli.flying && heli.y > 15, `“上升”按钮 3 秒原地升到 ${heli.y.toFixed(0)} 米`);
  // 两个按钮都不按（pitch=0）：垂直速度为 0，悬停
  const y0 = heli.y;
  run(sim, 2, () => { sim.ctl.pitch = 0; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(heli.flying && Math.abs(heli.y - y0) < 1.5, `两个按钮都不按，悬停 2 秒高度变化 ${Math.abs(heli.y - y0).toFixed(1)} 米`);
  // 摇杆上推（gas=1）前进
  const x0 = heli.x, z0 = heli.z;
  run(sim, 3, () => { sim.ctl.gas = 1; sim.ctl.pitch = 0; });
  chk(Math.hypot(heli.x - x0, heli.z - z0) > 20, `摇杆上推 3 秒向前飞出 ${Math.hypot(heli.x - x0, heli.z - z0).toFixed(0)} 米`);
  // 松开摇杆（gas=0）：水平速度衰减，悬停
  const sp0 = Math.abs(heli.speed);
  run(sim, 4, () => { sim.ctl.gas = 0; sim.ctl.pitch = 0; sim.ctl.steer = 0; });
  chk(Math.abs(heli.speed) < 2, `松开摇杆 4 秒：水平速度 ${sp0.toFixed(1)} → ${Math.abs(heli.speed).toFixed(1)} 米/秒，悬停`);
  // 摇杆下拉（gas=-1）后退
  const x1 = heli.x, z1 = heli.z, yaw1 = heli.yaw;
  run(sim, 2, () => { sim.ctl.gas = -1; sim.ctl.pitch = 0; });
  const back = (heli.x - x1) * Math.sin(yaw1) + (heli.z - z1) * Math.cos(yaw1);
  chk(back < -5, `摇杆下拉 2 秒向后退了 ${(-back).toFixed(1)} 米`);
  // 摇杆左右转向
  const yaw0 = heli.yaw;
  run(sim, 2, () => { sim.ctl.gas = 0.3; sim.ctl.steer = -1; sim.ctl.pitch = 0; });
  chk(heli.yaw > yaw0 + 0.3, `摇杆向左 2 秒，航向左转 ${((heli.yaw - yaw0) * 57.3).toFixed(0)} 度`);
  // “下降”按钮（pitch=-0.6）按住直接平稳落地（7.8 米/秒，在坠毁阈值 9 米/秒以内）
  run(sim, 10, () => { sim.ctl.pitch = -0.6; sim.ctl.gas = 0; sim.ctl.steer = 0; });
  chk(!heli.flying && heli.alive, '“下降”按钮按住 10 秒：平稳落地不爆炸');
  // 按钮起飞后能平稳降落楼顶（楼顶判定本身不动，见 §10）
  const sRoof = new Sim(), wR = sRoof.world;
  const tower = wR.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
  const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
  const hR = sRoof.vehicles.find((v) => v.type === 'heli');
  tp(sRoof, hR.x + 2.5, hR.z); sRoof.ctl.enter = true; run(sRoof, 0.1);
  hR.x = cx; hR.z = cz; hR.y = top + 30; hR.flying = true; hR.vy = 0; hR.pitch = 0; hR.roll = 0; hR.yaw = 0;
  run(sRoof, 8, () => { sRoof.ctl.pitch = -0.6; sRoof.ctl.gas = 0; sRoof.ctl.steer = 0; });
  chk(!hR.flying && hR.alive && Math.abs(hR.y - top) < 0.6, '“下降”按钮慢降到楼顶：平稳降落不爆炸');
  // 飞机操作完全不变：只给油门不拉杆，滑跑 7 秒仍在地面（俯仰控制没变）
  const s2 = new Sim(), plane = s2.vehicles.find((v) => v.type === 'plane');
  tp(s2, plane.x + 3, plane.z); s2.ctl.enter = true; run(s2, 0.1);
  run(s2, 7, () => { s2.ctl.gas = 1; s2.ctl.pitch = 0; });
  chk(!plane.flying && plane.speed >= 30, '飞机只给油门不拉杆：滑跑 7 秒仍在地面');
  chk(finite(sim), '新控制映射一轮后数值仍然合法');
}
// ---- 14) 所有武器射速统一 10 发/秒（2026-11-21，和冲锋枪一样） ----
// 机关枪（冲锋枪）rate 本来就是 10；拳头 2.2、手枪 3.2、霰弹枪 1.3、火箭筒 0.55 全部改成 10，
// 坦克炮 reload 1.4 → 0.1 秒；警察的 COP.rate 不动；伤害、射程、弹药数都不动。
{
  // 数值本身
  chk(WEAPONS.every((w) => w.rate === 10), `六种武器射速都是 10 发/秒（${WEAPONS.map((w) => w.name + w.rate).join('、')}）`);
  chk(VEH.tank.reload === 0.1, `坦克炮间隔 0.1 秒（原来 1.4 秒）`);
  chk(JSON.stringify(COP.rate) === JSON.stringify([0, 1.2, 1.2, 1.6, 4, 3]), '警察的开火间隔不动');
  // 按住开火 2 秒数发数：每种武器都约 20 发（允许 ±1 帧的边界误差）
  const holdFire = (sim, secs) => {
    const n = {};
    for (let i = 0; i < secs * TICK; i++) {
      sim.update(dt);
      for (const e of sim.events) { if (e.type === 'shot') n[e.w] = (n[e.w] || 0) + 1; if (e.type === 'punch') n.punch = (n.punch || 0) + 1; }
      sim.events.length = 0;
    }
    return n;
  };
  for (let i = 0; i < 6; i++) {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = i; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true; sim.ctl.fire = true;
    const n = holdFire(sim, 2);
    sim.ctl.fire = false;
    // 烟花 一轮 8 枚：shot 事件数除以 8 就是轮数
    const got = i === 0 ? (n.punch || 0) : (i === 5 ? Math.round((n.fireworks || 0) / 8) : (n[WEAPONS[i].id] || 0));
    chk(got >= 19 && got <= 21, `${WEAPONS[i].name}按住开火 2 秒 ${got} 发${i === 5 ? '轮' : ''}（10 发/秒）`);
  }
  // 车上火箭筒同样 10 发/秒（轿车上按住 2 秒）
  {
    const sim = new Sim(), p = sim.player;
    const car = sim.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(sim, car.x + 2.5, car.z); sim.ctl.enter = true; run(sim, 0.1);
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true;
    const n = {};
    sim.ctl.rocket = true;
    for (let k = 0; k < 2 * TICK; k++) { sim.update(dt); for (const e of sim.events) if (e.type === 'shot' && e.w === 'rocket') n.r = (n.r || 0) + 1; sim.events.length = 0; }
    sim.ctl.rocket = false;
    chk((n.r || 0) >= 19 && (n.r || 0) <= 21, `轿车上按住火箭键 2 秒 ${n.r || 0} 发（10 发/秒）`);
  }
  // 补满提示节流：火箭筒 3 秒连发，补满 5 次左右，但“已补满”提示最多 3 次（1 秒内只弹一次），且至少弹一次
  {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = WEAPON_INDEX.rocket; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true; sim.ctl.fire = true;
    let refills = 0, toasts = 0;
    for (let k = 0; k < 3 * TICK; k++) {
      sim.update(dt);
      for (const e of sim.events) { if (e.type === 'refill') refills++; if (e.type === 'toast' && e.text.includes('补满')) toasts++; }
      sim.events.length = 0;
    }
    sim.ctl.fire = false;
    chk(refills >= 4, `火箭筒 3 秒连发自动补满 ${refills} 次（每 0.6 秒补一次）`);
    chk(toasts >= 1 && toasts <= 3, `补满提示 3 秒内只弹了 ${toasts} 次（节流：1 秒内只弹一次，没刷屏）`);
  }
  // 持续火箭开火 5 秒的性能实测：只报数，不设玩法上限
  const perfFire = (sim, secs) => {
    let maxShots = 0, booms = 0;
    const t0 = Date.now();
    sim.ctl.rocket = true;
    for (let i = 0; i < secs * TICK; i++) {
      sim.update(dt);
      maxShots = Math.max(maxShots, sim.shots.length);
      for (const e of sim.events) if (e.type === 'explosion') booms++;
      sim.events.length = 0;
    }
    sim.ctl.rocket = false;
    return { ms: (Date.now() - t0) / (secs * TICK), maxShots, booms };
  };
  {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = WEAPON_INDEX.rocket; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true; sim.ctl.fire = true;
    const g = perfFire(sim, 5);
    console.log(`     地面连续火箭开火 5 秒：每逻辑帧 ${g.ms.toFixed(3)} ms，飞行中火箭最多 ${g.maxShots} 枚，爆炸 ${g.booms} 次`);
    chk(finite(sim) && g.maxShots < 200, '地面连续火箭开火 5 秒后数值仍然合法，飞行中火箭数有界');
  }
  {
    const sim = new Sim(), p = sim.player;
    const h = sim.vehicles.find((v) => v.type === 'heli');
    tp(sim, h.x + 2.5, h.z); sim.ctl.enter = true; run(sim, 0.1);
    run(sim, 12, () => { sim.ctl.pitch = 1; sim.ctl.gas = 0; });   // 爬到约 150 米高空（火箭飞得最远，存活最久）
    sim.ctl.pitch = 0; sim.ctl.gas = 0;
    p.godT = Infinity;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true;
    const a = perfFire(sim, 5);
    console.log(`     高空连续火箭开火 5 秒：每逻辑帧 ${a.ms.toFixed(3)} ms，飞行中火箭最多 ${a.maxShots} 枚，爆炸 ${a.booms} 次`);
    chk(finite(sim) && a.maxShots < 200, '高空连续火箭开火 5 秒后数值仍然合法，飞行中火箭数有界');
  }
}
// ---- 15) 世界地标和炸楼（2026-11-21） ----
{
  const sim = new Sim(), w = sim.world, p = sim.player;
  const lm = w.buildings.filter((b) => b.kind === 'landmark');
  chk(lm.length === 8, `市中心有 8 栋世界地标（${lm.map((b) => b.name).join('、')}）`);
  const byName = Object.fromEntries(lm.map((b) => [b.name, b]));
  chk(byName['哈利法塔'] && byName['哈利法塔'].h === 150 && byName['哈利法塔'].hp === 2560, '哈利法塔全城最高（150 米，8 发火箭筒）');
  chk(byName['西尔斯大厦（威利斯大厦）'] && byName['西尔斯大厦（威利斯大厦）'].h === 130 && byName['西尔斯大厦（威利斯大厦）'].hp === 2560, '西尔斯大厦（威利斯大厦）全城第二高（楼体 130 米，天线到 145 米，8 发火箭筒）');
  chk(byName['特朗普大厦'] && byName['特朗普大厦'].h === 98 && byName['特朗普大厦'].hp === 2240, '特朗普大厦 98 米，三段阶梯（7 发火箭筒）');
  chk(byName['埃菲尔铁塔'] && byName['埃菲尔铁塔'].h === 120 && byName['帝国大厦'].h === 95, '埃菲尔铁塔 120 米、帝国大厦 95 米');
  for (const b of lm) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    chk(b.roof === 1 && !w.roofAt(cx, cz, 0, 7.5, 2.6), `${b.name}屋顶不算可降落（roof=1，直升机不能落上去）`);
    chk(b.maxHp === b.hp && b.hp % 320 === 0, `${b.name}耐久 ${b.hp}（${b.hp / 320} 发火箭筒）`);
  }
  // 耐久按个头算：民居 1 发、商店 2 发、高楼 3~4 发
  const house = w.buildings.find((b) => b.kind === 'house');
  const shop = w.buildings.find((b) => b.kind === 'shop');
  const tower3 = w.buildings.find((b) => b.kind === 'tower' && b.hp === 960);
  const tower4 = w.buildings.find((b) => b.kind === 'tower' && b.hp === 1280);
  chk(house.hp === 320 && shop.hp === 640, `民居耐久 320（1 发火箭筒）、商店耐久 640（2 发）`);
  chk(!!tower3 && !!tower4, '高楼按高度分两档耐久（960 / 1280，即 3 发 / 4 发火箭筒）');
  // 在楼中心正上方爆炸：伤害不衰减，几发倒几发
  const blast = (b, n, dmg = 320, r = 7) => { for (let k = 0; k < n; k++) sim.explode((b.x0 + b.x1) / 2, 2, (b.z0 + b.z1) / 2, r, dmg, true); };
  const hc = (house.x0 + house.x1) / 2, hz = (house.z0 + house.z1) / 2;
  blast(house, 1);
  chk(house.destroyed && house.hp === 0, '民居 1 发火箭筒就夷为平地');
  chk(sim.events.some((e) => e.type === 'buildingDown' && e.b === house), '民居倒塌时发了 buildingDown 事件');
  sim.events.length = 0;
  blast(shop, 1);
  chk(!shop.destroyed && shop.hp === 320, '商店 1 发火箭筒后还剩一半耐久（320）');
  blast(shop, 1);
  chk(shop.destroyed, '商店 2 发火箭筒倒塌');
  blast(tower3, 2);
  chk(!tower3.destroyed && tower3.hp === 320, '高楼（960）2 发后还剩 320 耐久');
  blast(tower3, 1);
  chk(tower3.destroyed, '高楼（960）3 发火箭筒倒塌');
  blast(tower4, 4);
  chk(tower4.destroyed, '高楼（1280）4 发火箭筒倒塌');
  blast(byName['埃菲尔铁塔'], 5);
  chk(!byName['埃菲尔铁塔'].destroyed && byName['埃菲尔铁塔'].hp === 320, '埃菲尔铁塔 5 发后还剩 320 耐久');
  blast(byName['埃菲尔铁塔'], 1);
  chk(byName['埃菲尔铁塔'].destroyed, '埃菲尔铁塔 6 发火箭筒倒塌');
  blast(byName['哈利法塔'], 8);
  chk(byName['哈利法塔'].destroyed, '哈利法塔 8 发火箭筒倒塌');
  // 坦克炮弹（520 伤害）也能炸楼：商店 2 发炮弹倒
  const shop2 = w.buildings.find((b) => b.kind === 'shop' && !b.destroyed);
  blast(shop2, 2, 520, 8);
  chk(shop2.destroyed, '商店 2 发坦克炮弹（520 伤害）倒塌');
  // 高空飞过的火箭不隔空炸楼：爆炸点在楼顶 20 米以上不扣血
  const house2 = w.buildings.find((b) => b.kind === 'house' && !b.destroyed);
  const hp0 = house2.hp;
  sim.explode((house2.x0 + house2.x1) / 2, house2.y0 + house2.h + 20, (house2.z0 + house2.z1) / 2, 7, 320, true);
  chk(house2.hp === hp0 && !house2.destroyed, '高空 20 米处爆炸不伤民居（高度判定拦住了）');
  // 倒塌后：碰撞消失（人能走过废墟）、屋顶不认、站立高度回到地面、视线不再被挡
  chk(!w.collide({ x: hc, z: hz }, 0.6, 2), '倒塌后废墟没有碰撞（人能直接走过）');
  chk(!w.roofAt(hc, hz, 0, 7.5, 2.6), '倒塌后屋顶查询不认这栋楼了');
  chk(Math.abs(w.supportY(hc, hz) - w.groundY(hc, hz)) < 0.01, '倒塌后站立高度回到地面');
  chk(!w.blocked(hc - 10, hz, hc + 10, hz, 3), '倒塌后视线不再被这栋楼挡住');
  tp(sim, hc - 8, hz);
  run(sim, 3, () => { sim.ctl.mx = 1; sim.ctl.mz = 0; });
  sim.ctl.mx = 0;
  chk(p.x > hc + 2 && Math.abs(p.y - w.groundY(p.x, p.z)) < 0.6, `人能穿过废墟走到另一边（走了 ${(p.x - (hc - 8)).toFixed(1)} 米，站在地面上）`);
  // 直升机停在楼顶时楼被炸掉：平稳落到地面，不悬空、不穿模
  {
    const s2 = new Sim(), q = s2.player, w2 = s2.world;
    const tower = w2.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
    const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
    const heli = s2.vehicles.find((v) => v.type === 'heli');
    tp(s2, heli.x + 2.5, heli.z); s2.ctl.enter = true; run(s2, 0.1);
    heli.x = cx; heli.z = cz; heli.y = top + 30; heli.flying = true; heli.vy = 0; heli.pitch = 0; heli.roll = 0; heli.yaw = 0;
    run(s2, 12, () => { s2.ctl.pitch = -0.3; s2.ctl.gas = 0; s2.ctl.steer = 0; });
    chk(!heli.flying && heli.alive && Math.abs(heli.y - top) < 0.6, '直升机先平稳落在楼顶上');
    const gy = w2.groundY(cx, cz);
    s2.damageBuilding(tower, 9999);   // 直接拆楼（不用爆炸：爆炸本身会伤到停在楼顶的直升机，这里只测楼没了之后它怎么落）
    chk(tower.destroyed, '楼顶被拆掉后倒塌');
    run(s2, 2);
    chk(heli.alive && Math.abs(heli.y - gy) < 1, `楼没了，直升机平稳落到地面（高度 ${heli.y.toFixed(1)} 米，地面 ${gy.toFixed(1)} 米）`);
    // 玩家站在楼顶时楼被炸掉：掉回地面
    const s3 = new Sim(), r = s3.player, w3 = s3.world;
    const t3 = w3.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
    const c3x = (t3.x0 + t3.x1) / 2, c3z = (t3.z0 + t3.z1) / 2, top3 = t3.y0 + t3.h;
    r.x = r.px = c3x; r.z = r.pz = c3z; r.y = top3;
    s3.damageBuilding(t3, 9999);   // 直接拆楼（不用爆炸：爆炸本身会伤到站在楼顶的玩家，这里只测楼没了之后人怎么掉）
    chk(t3.destroyed, '玩家脚下的楼被拆倒');
    run(s3, 2);
    chk(Math.abs(r.y - w3.groundY(c3x, c3z)) < 1, `楼没了，玩家掉回地面（高度 ${r.y.toFixed(1)} 米）`);
    chk(finite(s3), '炸楼一轮后数值仍然合法');
  }
  // 被炸毁的建筑旁边停着车，车不受额外伤害（倒塌本身不伤车；车停在爆炸半径外，连爆炸都碰不到它）
  {
    const s4 = new Sim(), w4 = s4.world;
    const h4 = w4.buildings.find((b) => b.kind === 'house' && !b.destroyed);
    const cx4 = (h4.x0 + h4.x1) / 2, cz4 = (h4.z0 + h4.z1) / 2;
    const car = s4.addVehicle('sedan', cx4 + 10, cz4, 0);   // 离爆炸点 10 米，超出爆炸半径 7 米 + 车半径
    const hp4 = car.hp;
    s4.explode(cx4, 2, cz4, 7, 320, true);
    chk(h4.destroyed && car.hp === hp4, '民居被炸倒，旁边 10 米外的车毫发无损');
    run(s4, 2);
    chk(car.hp === hp4 && car.alive, '楼倒塌后车还是完好无损（倒塌本身不伤车）');
  }
  chk(finite(sim), '地标和炸楼一轮后数值仍然合法');
}
// ---- 16) 新武器烟花（2026-11-21）：一轮 8 枚齐射，10 轮/秒，每轮只耗 1 发弹药 ----
{
  const R = WEAPON_INDEX.fireworks;
  chk(R === 5, `烟花 是第 6 种武器（index ${R}）`);
  const wp = WEAPONS[R];
  chk(wp.dmg === 320 && wp.rate === 10 && wp.range === 130 && wp.radius === 7 && wp.speed === 55 && wp.explosive, '烟花 属性和火箭筒一致（伤害 320、射速 10、射程 130、爆炸半径 7、速度 55）');
  chk(AMMO[R] === 4, '烟花 初始 4 发弹药');
  // 一轮恰好 8 枚，方向间隔 45 度（量化：8 个方向角排序后相邻差都是 π/4）
  {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = R; p.shootCd = 0;
    sim.ctl.aimYaw = 0.3; sim.ctl.aimSet = true; sim.ctl.fire = true;
    sim.update(dt); sim.ctl.fire = false;
    const shots = sim.shots.slice();
    chk(shots.length === 8, `烟花 一轮齐射 ${shots.length} 枚（应为 8 枚）`);
    const angs = shots.map((s) => Math.atan2(s.dx, s.dz)).sort((a, b) => a - b);
    let even = shots.length === 8;
    for (let k = 0; k < 8; k++) { const d = angs[(k + 1) % 8] - angs[k]; const dd = d < 0 ? d + 2 * Math.PI : d; if (Math.abs(dd - Math.PI / 4) > 0.001) even = false; }
    chk(even, `8 枚方向间隔都是 45 度（实测角度 ${angs.map((a) => (a * 57.3).toFixed(0)).join('、')} 度，瞄准方向 ${(0.3 * 57.3).toFixed(0)} 度）`);
    chk(shots.every((s) => s.kind === 'fireworks' && s.speed === 55 && s.dmg === 320 && s.radius === 7 && s.range === Infinity && s.byPlayer && s.owner === null), '8 枚都是独立火箭（kind fireworks、速度 55、伤害 320、半径 7、射程无限）');
    chk(p.ammo[R] === 3, `一轮齐射只耗 1 发弹药（剩 ${p.ammo[R]} 发）`);
    const shotEv = sim.events.filter((e) => e.type === 'shot');
    chk(shotEv.length === 8 && shotEv.every((e) => e.w === 'fireworks'), `一轮发了 ${shotEv.length} 个 shot 事件（不多不少，音效不会响两遍）`);
    sim.events.length = 0;
  }
  // 射速：按住 2 秒 20 轮（atkSeq +20），共 160 枚
  {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = R; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true; sim.ctl.fire = true;
    const a0 = p.atkSeq; let n = 0;
    for (let i = 0; i < 2 * TICK; i++) { sim.update(dt); for (const e of sim.events) if (e.type === 'shot' && e.w === 'fireworks') n++; sim.events.length = 0; }
    sim.ctl.fire = false;
    chk(p.atkSeq - a0 >= 19 && p.atkSeq - a0 <= 21, `按住烟花 开火 2 秒 ${p.atkSeq - a0} 轮（10 轮/秒）`);
    chk(n >= 152 && n <= 168, `2 秒共射出 ${n} 枚火箭（20 轮 × 8 枚）`);
  }
  // 打空自动补满：剩 1 发时开一轮，补满到 4 发
  {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = R; p.ammo[R] = 1; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true; sim.ctl.fire = true;
    sim.update(dt); sim.ctl.fire = false;
    chk(p.ammo[R] === AMMO[R], `烟花 剩 1 发时开一轮，打空后自动补满到 ${p.ammo[R]} 发`);
  }
  // 旧存档兼容：只有 5 项的 owned/ammo 数组，读档后烟花 默认拥有、弹药 4 发
  {
    const old = new Sim({ money: 100, owned: [true, true, true, true, true], ammo: [0, 80, 150, 24, 6], done: [] });
    chk(old.player.owned.length === 6 && old.player.owned[5] && old.player.ammo[5] === 4, '读 5 项旧存档，烟花 默认拥有、弹药 4 发');
  }
  // 切武器：selectWeapon(5) 能切，selectWeapon(6) 越界拒绝；Q 循环能走到烟花、也能从它回到拳头
  {
    const sim = new Sim(), p = sim.player;
    sim.selectWeapon(5);
    chk(p.weapon === 5, 'selectWeapon(5) 切到烟花');
    sim.selectWeapon(6);
    chk(p.weapon === 5, 'selectWeapon(6) 越界，武器不变');
    p.weapon = WEAPON_INDEX.rocket; sim.ctl.swap = true; sim.update(dt);
    chk(p.weapon === 5, 'Q 换武器：从火箭筒换到烟花');
    sim.ctl.swap = true; sim.update(dt);
    chk(p.weapon === 0, 'Q 换武器：从烟花 换回拳头');
  }
  // 车上火箭还是普通火箭筒：不走 fireworks、不耗烟花 的弹药
  {
    const sim = new Sim(), p = sim.player;
    const car = sim.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(sim, car.x + 2.5, car.z); sim.ctl.enter = true; run(sim, 0.1);
    p.godT = Infinity; p.shootCd = 0;
    const a4 = p.ammo[WEAPON_INDEX.rocket], a5 = p.ammo[R];
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true; sim.ctl.rocket = true;
    let nR = 0, n360 = 0;
    for (let k = 0; k < Math.floor(0.5 * TICK); k++) { sim.update(dt); for (const e of sim.events) { if (e.type === 'shot' && e.w === 'rocket') nR++; if (e.type === 'shot' && e.w === 'fireworks') n360++; } sim.events.length = 0; }
    sim.ctl.rocket = false;
    chk(nR >= 4 && n360 === 0, `轿车上按住火箭键 0.5 秒发了 ${nR} 枚普通火箭、0 枚烟花`);
    chk(p.ammo[WEAPON_INDEX.rocket] < a4 && p.ammo[R] === a5, '车上火箭只耗火箭筒弹药，烟花 弹药不动');
  }
  // 持续开火 5 秒的性能实测：只报数，不设玩法上限
  const perf360 = (sim, secs) => {
    let maxShots = 0, booms = 0;
    const t0 = Date.now();
    sim.ctl.fire = true;
    for (let i = 0; i < secs * TICK; i++) {
      sim.update(dt);
      maxShots = Math.max(maxShots, sim.shots.length);
      for (const e of sim.events) if (e.type === 'explosion') booms++;
      sim.events.length = 0;
    }
    sim.ctl.fire = false;
    return { ms: (Date.now() - t0) / (secs * TICK), maxShots, booms };
  };
  {
    const sim = new Sim(), p = sim.player;
    p.godT = Infinity; p.weapon = R; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true;
    const g = perf360(sim, 5);
    console.log(`     地面连续烟花 开火 5 秒：每逻辑帧 ${g.ms.toFixed(3)} ms，飞行中火箭最多 ${g.maxShots} 枚，爆炸 ${g.booms} 次`);
    chk(finite(sim), '地面连续烟花 开火 5 秒后数值仍然合法');
  }
  {
    // 高空：站在全城最高的可降落平屋顶上打，火箭飞得最远、存活最久
    const sim = new Sim(), p = sim.player, w = sim.world;
    const tower = w.buildings.filter((b) => b.roof === 0).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
    const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
    p.x = p.px = cx; p.z = p.pz = cz; p.y = top;
    p.godT = Infinity; p.weapon = R; p.shootCd = 0;
    sim.ctl.aimYaw = 0; sim.ctl.aimSet = true;
    const a = perf360(sim, 5);
    console.log(`     ${top.toFixed(0)} 米楼顶连续烟花 开火 5 秒：每逻辑帧 ${a.ms.toFixed(3)} ms，飞行中火箭最多 ${a.maxShots} 枚，爆炸 ${a.booms} 次`);
    chk(finite(sim), '楼顶连续烟花 开火 5 秒后数值仍然合法');
  }
}

// ---- 17) 炸平后重建：随机 60~180 秒，血量回满，屋顶恢复；占地有步行玩家时延后，车不再挡重建（见 §18） ----
{
  // 每帧跑完后把 buildingUp 事件记下来再清（run() 每步都会清 events，直接读不到）
  const runRec = (s, sec) => { const got = []; for (let i = 0; i < sec * TICK; i++) { s.update(dt); for (const e of s.events) if (e.type === 'buildingUp') got.push(e); s.events.length = 0; } return got; };
  // 重建时间每栋独立随机：落在 [60, 180] 秒内
  const sim = new Sim(), w = sim.world;
  const victims = [w.buildings.find((b) => b.kind === 'house'), w.buildings.find((b) => b.kind === 'shop'), w.buildings.find((b) => b.kind === 'tower'), w.buildings.find((b) => b.name === '埃菲尔铁塔')];
  for (const b of victims) sim.damageBuilding(b, 99999);
  for (const b of victims) {
    const d = b.rebuildAt - sim.time;
    chk(b.destroyed && d >= 60 && d <= 180, `${b.name || b.kind}被炸平后重建时间 ${d.toFixed(1)} 秒（在 60~180 秒内）`);
  }
  chk(sim.rebuildQueue.length === victims.length, `等重建的队里有 ${sim.rebuildQueue.length} 栋楼`);
  // 没到时间不重建：59 秒后还在废墟（计时只跟着游戏时间走，不跑 update() 就不动，暂停也一样冻结）
  run(sim, 59);
  chk(victims.every((b) => b.destroyed), '炸平 59 秒后还没重建（最短也要 60 秒）');
  // 到时间自然重建：再跑 150 秒（59+150=209，超过最晚的 180 秒，肯定都过了）
  const ups = runRec(sim, 150);
  chk(victims.every((b) => !b.destroyed && b.hp === b.maxHp && b.rebuildAt === 0), '炸平后 60~180 秒内全部重建、耐久回满');
  chk(sim.rebuildQueue.length === 0, '重建完队就空了');
  chk(ups.length === victims.length && ups.every((e) => victims.includes(e.b)), `重建时每栋都发了 buildingUp 事件（${ups.length} 个）`);
  // 重建后碰撞、屋顶、视线都回来了
  const h0 = victims[0], cx0 = (h0.x0 + h0.x1) / 2, cz0 = (h0.z0 + h0.z1) / 2;
  chk(!!w.collide({ x: cx0, z: cz0 }, 0.6, 2), '重建后废墟又有了碰撞（人走不过去）');
  chk(Math.abs(w.supportY(cx0, cz0) - (h0.y0 + h0.h)) < 0.01, '重建后站立高度回到楼顶');
  chk(w.blocked(cx0 - 10, cz0, cx0 + 10, cz0, 3), '重建后视线又被这栋楼挡住');
  chk(finite(sim), '重建一轮后数值仍然合法');
  // 玩家站在废墟上：重建延后，人走了才重建
  {
    const s = new Sim(), w2 = s.world, p = s.player;
    const h = w2.buildings.find((b) => b.kind === 'house' && Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z) > 60);
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    s.damageBuilding(h, 99999);
    tp(s, cx, cz);   // 玩家站进废墟里
    h.rebuildAt = s.time + 0.1;   // 手动把时间拨近，测触发机制（随机等待本身上面已测）
    run(s, 3);
    chk(h.destroyed && h.rebuildAt > s.time, '玩家站在废墟上时重建延后（没重建，重建时间往后推了）');
    tp(s, cx + 30, cz);   // 走开
    run(s, 10);
    chk(!h.destroyed && h.hp === h.maxHp, '玩家离开后重建完成、耐久回满');
  }
  // 车停在废墟上：不再延后重建，到时间车直接炸掉、楼回来（旧规则“车挡重建”已改，见 §18）
  {
    const s = new Sim(), w2 = s.world;
    const h = w2.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx, cz, 0);
    car.parked = true;   // 别让交通回收逻辑把它当闲置车删掉
    s.damageBuilding(h, 99999);
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!h.destroyed && h.hp === h.maxHp, '废墟上的车不挡重建：到时间楼回来了、耐久回满（爆炸发生在楼恢复之前，没伤到新楼）');
    chk(!car.alive && car.wreck, '废墟上的车在重建那一刻炸掉了（残骸）');
  }
  // 直升机悬停在楼顶上方：不挡重建
  {
    const s = new Sim(), w2 = s.world;
    const h = w2.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2, top = h.y0 + h.h;
    const heli = s.vehicles.find((v) => v.type === 'heli');
    heli.x = cx; heli.z = cz; heli.y = top + 30; heli.flying = true; heli.vy = 0; heli.pitch = 0; heli.roll = 0; heli.yaw = 0;
    s.damageBuilding(h, 99999);
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!h.destroyed && heli.flying && heli.y > top + 0.5, '直升机悬停在楼顶上方不挡重建（楼回来了，直升机还在上面悬停）');
  }
  // 行人在废墟里：重建时把发呆的行人推到楼外
  {
    const s = new Sim(), w2 = s.world;
    const h = w2.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    tp(s, cx + 20, cz);   // 玩家站附近看着，不然行人离玩家太远会被系统直接删掉
    s.damageBuilding(h, 99999);
    const o = s.addPed('civ', cx, cz);
    o.state = 'idle'; o.t = 999;   // 发呆，不自己走出去
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    // 注意：collide 把圆心在楼里的行人推到最近的墙面外沿，正好贴在边界上（坐标等于 x0-r），所以用 <= 加微小容差判，不能用严格 <
    const eps = 1e-6;
    const outside = o.x <= h.x0 - o.r + eps || o.x >= h.x1 + o.r - eps || o.z <= h.z0 - o.r + eps || o.z >= h.z1 + o.r - eps;
    chk(!h.destroyed && outside, '重建时把发呆的行人推到了楼外（没卡在楼里）');
  }
  // 地标也重建：耐久回满，屋顶仍不可降落
  {
    const s = new Sim(), w2 = s.world;
    const lm = w2.buildings.find((b) => b.name === '埃菲尔铁塔');
    const cx = (lm.x0 + lm.x1) / 2, cz = (lm.z0 + lm.z1) / 2;
    s.damageBuilding(lm, 99999);
    chk(lm.destroyed && lm.rebuildAt - s.time >= 60, '地标被炸平后也排队等重建');
    lm.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!lm.destroyed && lm.hp === lm.maxHp && lm.hp === 1920, '地标重建、耐久回满 1920');
    chk(lm.roof === 1 && !w2.roofAt(cx, cz, 0, 7.5, 2.6), '地标重建后仍不可降落（roof=1 不变）');
  }
  // 平顶高楼重建后屋顶又能降落
  {
    const s = new Sim(), w2 = s.world;
    const t = w2.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
    const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    chk(!!w2.roofAt(cx, cz, 0, 7.5, 2.6), '重建前先确认：这栋平顶高楼本来可降落');
    s.damageBuilding(t, 99999);
    chk(!w2.roofAt(cx, cz, 0, 7.5, 2.6), '炸平后屋顶不认了');
    t.rebuildAt = s.time + 0.1;
    run(s, 2);
    const r = w2.roofAt(cx, cz, 0, 7.5, 2.6);
    chk(!t.destroyed && r && Math.abs(r.top - (t.y0 + t.h)) < 0.01, '重建后屋顶又能降落了（roofAt 恢复，高度就是楼顶）');
  }
}
// ---- 18) 重建新规则：警车穿废墟、废墟上的车重建时炸掉、主角座驾无敌（2026-11-22 起座驾无敌只跟无敌开关走，见 §20） ----
{
  // 警车能穿过废墟：视线和路都不挡（有意为之，不是 bug）
  // (a) 视线和碰撞：楼完好时挡，炸平后不挡
  {
    const s = new Sim(), w = s.world;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const half = Math.min((h.x1 - h.x0) / 2, (h.z1 - h.z0) / 2);
    chk(w.blocked(cx - half - 8, cz, cx + half + 8, cz, 3), '楼完好时视线被挡住');
    chk(!!w.collide({ x: cx, z: cz }, 0.6, 2), '楼完好时废墟位置有碰撞');
    s.damageBuilding(h, 99999);
    chk(!w.blocked(cx - half - 8, cz, cx + half + 8, cz, 3), '楼炸平后视线穿过废墟（blocked 跳过已炸平的楼）');
    chk(!w.collide({ x: cx, z: cz }, 0.6, 2), '楼炸平后废墟没有碰撞');
  }
  // (b) 动态：追捕的警车直线穿过废墟去追玩家
  {
    const s = new Sim(), w = s.world, p = s.player;
    // 找一栋民居和一个方向：两边落脚点都没楼、连线只被这一栋楼挡住（炸掉它视线就通了）
    let pick = null;
    for (const h of w.buildings.filter((b) => b.kind === 'house' && (b.x1 - b.x0) >= 10 && (b.z1 - b.z0) >= 10)) {
      const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const ax = cx - dx * 14, az = cz - dz * 14, bx = cx + dx * 14, bz = cz + dz * 14;
        const t1 = { x: ax, z: az }, t2 = { x: bx, z: bz };
        if (w.collide(t1, 1, 2) || w.collide(t2, 1, 2)) continue;   // 落脚点有楼
        if (!w.blocked(ax, az, bx, bz, 3)) continue;   // 连线本来就没被挡，不是这栋楼的功劳
        pick = { h, cx, cz, dx, dz, ax, az, bx, bz };
        break;
      }
      if (pick) break;
    }
    chk(!!pick, '找到一栋可测试的民居（两边落脚点没楼、连线只被它挡住）');
    if (pick) {
      const { h, cx, cz, dx, dz, ax, az, bx, bz } = pick;
      p.godT = Infinity;   // 玩家无敌，免得追上来的警察把人打死、复活传送打乱位置
      tp(s, bx, bz);
      s.stars = 2; s.heat = 2;   // 保持追捕状态，别让通缉系统把警车变回巡逻车
      const cop = s.addVehicle('police', ax, az, Math.atan2(dx, dz));
      cop.driver = 'npc'; cop.siren = true; cop.ai = { kind: 'chase', route: null, routeT: 0, stuck: 0, rev: 0 };
      s.damageBuilding(h, 99999);
      chk(!w.blocked(ax, az, bx, bz, 3), '楼炸平后警车到玩家的视线通了');
      let entered = false, maxAlong = 0;
      for (let i = 0; i < 15 * TICK; i++) {
        s.update(dt); s.events.length = 0;
        if (cop.x > h.x0 && cop.x < h.x1 && cop.z > h.z0 && cop.z < h.z1) entered = true;
        maxAlong = Math.max(maxAlong, (cop.x - ax) * dx + (cop.z - az) * dz);
      }
      chk(entered, '追捕的警车开进了废墟占地（废墟不挡路）');
      chk(maxAlong > 14, `警车穿过废墟中心、向玩家方向开了 ${maxAlong.toFixed(1)} 米（起点到中心 14 米）`);
      chk(finite(s), '警车穿废墟后数值仍然合法');
    }
  }
  // 废墟上的空车：重建那一刻直接炸掉（警车、交通车也一样）
  {
    const s = new Sim(), w = s.world;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx, cz, 0);
    const cop = s.addVehicle('police', cx + 3, cz, 0);
    cop.driver = 'npc';   // 警车，有司机；不要给它挂 chase AI，不然离玩家太远时交通回收逻辑会在重建前把它删掉
    car.parked = true; cop.parked = true;
    s.damageBuilding(h, 99999);
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!h.destroyed && h.hp === h.maxHp, '有车在废墟上照样重建、耐久回满');
    chk(!car.alive && car.wreck, '废墟上的空轿车在重建时炸掉了');
    chk(!cop.alive && cop.wreck, '废墟上的警车在重建时也炸掉了（追捕系统会重新派车）');
  }
  // 停在倒塌建筑旁边的车不受影响（旧规则不变）
  {
    const s = new Sim(), w = s.world;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx + (h.x1 - h.x0) / 2 + 8, cz, 0);   // 楼边 8 米外
    car.parked = true;
    const hp0 = car.hp;
    s.damageBuilding(h, 99999);
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!h.destroyed, '楼重建了');
    chk(car.alive && car.hp === hp0, '楼边 8 米外的车不受影响（没炸、没掉血）');
  }
  // 主角坐着的车无敌（无敌开着时）：火箭弹、爆炸、撞车都不掉血；没人坐的对照组照常掉血
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    chk(p.inVeh === car, '先坐进轿车');
    p.godT = Infinity;   // 无敌开着，座驾才无敌（2026-11-22 起只跟无敌开关走，见 §20）
    const hp0 = car.hp;
    car.damage(500, true);   // 直接伤害：火箭弹、坦克炮、撞车走的都是 Vehicle.damage
    chk(car.hp === hp0 && car.alive && !car.burning, '坐着的车被打 500 也不掉血、不起火');
    s.explode(car.x + 3, car.y + 1, car.z, 8, 320, true);   // 旁边炸一枚火箭
    chk(car.hp === hp0 && car.alive, '旁边爆炸也不掉血（爆炸不推车、不伤车）');
    // 对照：没人坐的同款车，同样爆炸会掉血
    const car2 = s.addVehicle('sedan', car.x + 20, car.z, 0);
    const hp2 = car2.hp;
    s.explode(car2.x + 3, car2.y + 1, car2.z, 8, 320, true);
    chk(car2.hp < hp2, '对照：没人坐的车同样爆炸会掉血');
    // 火箭弹实打：从车顶上方垂直打一枚火箭下来，火箭在车顶炸开、车不掉血
    const before = car.hp;
    s.shoot({ x: car.x, y: car.y + 20, z: car.z, dx: 0, dy: -1, dz: 0, speed: 55, range: 100, radius: 7, dmg: 320, byPlayer: false, kind: 'rocket', owner: null });
    let boom = false;
    for (let i = 0; i < 3 * TICK; i++) { s.update(dt); if (s.events.some((e) => e.type === 'explosion')) boom = true; s.events.length = 0; if (!s.shots.length) break; }
    chk(boom, '火箭弹飞到了车顶、炸开了');
    chk(car.hp === before && car.alive, '火箭弹在车顶炸开，坐着的车不掉血');
  }
  // 重建时主角坐着的车被推到楼外（无敌开着时）：楼回来、车完好、玩家还在车里、还能开；无敌关了会炸，见 §20
  {
    const s = new Sim(), w = s.world, p = s.player;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx, cz, 0);
    car.parked = true;
    s.damageBuilding(h, 99999);   // 先拆楼，不然玩家传送到楼里会被碰撞推出去、够不着车
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    chk(p.inVeh === car, '先坐进停在废墟上的车');
    p.godT = Infinity;   // 无敌开着，座驾才不炸、才推到楼外（2026-11-22 起只跟无敌开关走）
    const hp0 = car.hp;
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    const eps = 1e-6;
    const outside = car.x <= h.x0 - car.radius + eps || car.x >= h.x1 + car.radius - eps || car.z <= h.z0 - car.radius + eps || car.z >= h.z1 + car.radius - eps;
    chk(!h.destroyed && h.hp === h.maxHp, '楼重建了');
    chk(car.alive && car.hp === hp0, '主角坐着的车在重建时没炸、没掉血');
    chk(p.inVeh === car, '玩家还坐在车里');
    chk(outside, '车被推到了楼外（没卡在楼里）');
    // 还能开：车头掉向楼外、踩油门能开走
    car.yaw = Math.atan2(car.x - cx, car.z - cz);
    const ox = car.x, oz = car.z;
    run(s, 2, () => { s.ctl.gas = 1; });
    chk(Math.hypot(car.x - ox, car.z - oz) > 5 && p.inVeh === car, '推出去的车还能开（2 秒开出 5 米以上，玩家还在车里）');
  }
  // 刚下车的空车不算乘坐：重建时照样炸
  {
    const s = new Sim(), w = s.world, p = s.player;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx, cz, 0);
    car.parked = true;
    s.damageBuilding(h, 99999);   // 先拆楼，不然玩家传送到楼里会被碰撞推出去、够不着车
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    chk(p.inVeh === car, '先坐进车');
    s.ctl.enter = true; run(s, 0.2);
    chk(!p.inVeh && car.driver === null, '下车后车没人坐');
    tp(s, cx + 30, cz);   // 玩家走开，免得人站在废墟上挡住重建
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!h.destroyed && h.hp === h.maxHp, '楼重建了');
    chk(!car.alive && car.wreck, '刚下车的空车在重建时炸掉了');
  }
  // 步行的玩家站在废墟上：重建照旧延后（不能炸玩家）
  {
    const s = new Sim(), w = s.world, p = s.player;
    const h = w.buildings.find((b) => b.kind === 'house' && Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z) > 60);
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    s.damageBuilding(h, 99999);
    tp(s, cx, cz);
    h.rebuildAt = s.time + 0.1;
    run(s, 3);
    chk(h.destroyed && h.rebuildAt > s.time, '步行的玩家站在废墟上时重建延后（新规则下步行玩家仍挡重建）');
    tp(s, cx + 30, cz);
    run(s, 10);
    chk(!h.destroyed && h.hp === h.maxHp, '玩家离开后重建完成');
  }
}

// ---- 19) 上车：码头边上船、走路靠近各型载具、移动的车（2026-11-21） ----
{
  // 码头边上船：三艘固定快艇都系在码头边 4 米内，站在码头边按上车就能上去
  // （修前是 6 米，超出上车窗口 5.4 米，码头边上按上车永远够不着；游泳到 1 米内才能上）
  for (const want of [0, 1, 2]) {
    const sim = new Sim(), pier = sim.world.places.pier;
    const b = sim.vehicles.filter((v) => v.type === 'boat')[want];
    const cx = Math.min(Math.max(b.x, pier.x0), pier.x1), cz = Math.min(Math.max(b.z, pier.z0), pier.z1);
    const dEdge = Math.hypot(b.x - cx, b.z - cz);
    tp(sim, cx, cz, 2); sim.ctl.enter = true; run(sim, 0.1);
    chk(sim.player.inVeh === b, `码头边 ${dEdge.toFixed(1)} 米外的快艇 ${want + 1} 号能直接上船`);
  }
  // 任务船也系在码头边：任务“水上追风”的生成点离码头边不到 5.4 米
  {
    const sim = new Sim(), pier = sim.world.places.pier;
    const m = sim.missions.list.find((x) => x.id === 'boat');
    const cx = Math.min(Math.max(m.spawn[0], pier.x0), pier.x1), cz = Math.min(Math.max(m.spawn[1], pier.z0), pier.z1);
    const d = Math.hypot(m.spawn[0] - cx, m.spawn[1] - cz);
    chk(d < 5.4, `任务快艇生成点离码头边 ${d.toFixed(1)} 米，在上车窗口内（修前 6 米）`);
  }
  // 走路靠近坦克、摩托：走到跟前按上车能上去
  for (const [type, name] of [['tank', '坦克'], ['bike', '摩托']]) {
    const sim = new Sim(), p = sim.player;
    const v = sim.vehicles.find((x) => x.type === type && x.fixed) || sim.addVehicle(type, 700, 700, 0);
    v.yaw = 0;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    tp(sim, v.x - fx * 10, v.z - fz * 10);
    run(sim, 3, () => { sim.ctl.mx = fx; sim.ctl.mz = fz; });
    sim.ctl.mx = 0; sim.ctl.mz = 0;
    const dWalk = Math.hypot(p.x - v.x, p.z - v.z);
    sim.ctl.enter = true; run(sim, 0.1);
    chk(p.inVeh === v, `走路靠近${name}，走到中心距 ${dWalk.toFixed(1)} 米按上车能上去`);
  }
  // 移动的交通车：路边站着，车以 13 米/秒开过，进窗口 0.25 秒后按上车能上去（正常反应速度）
  {
    const w = new Sim().world;
    let best = null;
    for (const e of w.edges) { const len = Math.abs(e.b.x - e.a.x) + Math.abs(e.b.z - e.a.z); if (!best || len > best.len) best = { ...e, len }; }
    const dx = Math.sign(best.b.x - best.a.x), dz = Math.sign(best.b.z - best.a.z);
    const midx = (best.a.x + best.b.x) / 2, midz = (best.a.z + best.b.z) / 2;
    const sim = new Sim(), p = sim.player;
    const car = sim.addVehicle('sedan', best.a.x + dx * 10 - dz * 3.4, best.a.z + dz * 10 + dx * 3.4, Math.atan2(dx, dz));
    car.driver = 'npc'; car.ai = { kind: 'traffic', from: best.a, to: best.b, panic: 0, stuck: 0, rev: 0 };
    car.vx = dx * 13; car.vz = dz * 13;
    tp(sim, midx - dz * (3.4 + 3), midz + dx * (3.4 + 3));
    let visAt = -1, ok = false;
    for (let i = 0; i < 30 * TICK; i++) {
      sim.update(dt); sim.events.length = 0;
      if (visAt < 0 && sim.nearestVehicle() === car) visAt = i;
      if (visAt >= 0 && i === visAt + Math.round(0.25 * TICK)) { sim.ctl.enter = true; sim.update(dt); ok = !!p.inVeh; break; }
      if (visAt >= 0 && i > visAt + 60) break;
    }
    chk(ok, '路边等车开过：车进窗口 0.25 秒后按上车，能上 13 米/秒的交通车');
  }
}

// ---- 20) 主角座驾无敌只跟无敌开关走（2026-11-22 用户纠正）：无敌关了，坐着的车照常掉血、照常炸；无敌开着才不掉血 ----
// 规则：座驾保护用的就是玩家无敌同一个开关 Sim.godOn()（本地 godT 或联机全员无敌 netGod，任一开着都算开）。
// 守住的三个口子：Vehicle.damage（直接伤害、撞车、撞楼）、sim.explode 里的载具循环（爆炸伤害 + 炸飞）、rebuildBuilding（重建时废墟上的车）。
// 不守的口子：直升机/飞机失事自毁（hp=0 + explode()，飞行员操作失误，见 (i)）、沉船（sink，从来没守过）。
{
  // (a) 无敌关了：直接伤害掉血
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    chk(p.inVeh === car, '先坐进轿车（无敌默认关着）');
    chk(!s.godOn(), '无敌默认是关的（godT=0，netGod=false）');
    const hp0 = car.hp;   // 轿车 320
    car.damage(50, true);
    chk(car.hp === hp0 - 50 && car.alive && !car.burning, `无敌关了：直接打 50，车掉血到 ${car.hp}`);
  }
  // (b) 无敌关了：旁边爆炸掉血，玩家还坐在车里
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    const hp0 = car.hp;
    s.explode(car.x + 3, car.y + 1, car.z, 8, 100, true);   // 车边 3 米炸一枚小火箭（玩家只吃 31 伤，死不了）
    chk(car.hp < hp0 && car.alive, `无敌关了：旁边爆炸，车掉血到 ${car.hp.toFixed(1)}`);
    chk(p.inVeh === car && !p.dead, '爆炸后玩家还坐在车里、没死');
  }
  // (c) 无敌关了：头顶火箭掉血
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    const hp0 = car.hp;
    s.shoot({ x: car.x, y: car.y + 20, z: car.z, dx: 0, dy: -1, dz: 0, speed: 55, range: 100, radius: 7, dmg: 100, byPlayer: false, kind: 'rocket', owner: null });
    let boom = false;
    for (let i = 0; i < 3 * TICK; i++) { s.update(dt); if (s.events.some((e) => e.type === 'explosion')) boom = true; s.events.length = 0; if (!s.shots.length) break; }
    chk(boom, '火箭弹飞到了车顶、炸开了');
    chk(car.hp < hp0 && car.alive && p.inVeh === car, `无敌关了：火箭弹在车顶炸开，车掉血到 ${car.hp.toFixed(1)}、玩家还坐在车里`);
  }
  // (d) 无敌关了：撞车掉血（车车碰撞走 Vehicle.damage，同样按 godOn 守着）
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    for (const v of s.vehicles) if (v !== car) { v.x += 500; v.z += 500; v.vx = 0; v.vz = 0; v.speed = 0; }   // 清走别的车，只留这对
    const other = s.addVehicle('sedan', car.x, car.z + 3, 0);   // 3 米 < 两车半径和 3.52，叠在一起
    car.vz = 12; other.vz = 0;   // 主角的车以 12 米/秒撞上去，相对速度 -12，伤害 (12-3)*6=54
    const hp0 = car.hp;
    s.collideVehicles();
    chk(car.hp === hp0 - 54, `无敌关了：12 米/秒撞车，车掉血 54 到 ${car.hp}`);
    chk(other.hp === other.spec.hp - 54, '对方的车也掉了 54 血（撞车是双向的）');
  }
  // (e) 无敌关了：打爆了就起火、几秒后炸掉，玩家被炸下车
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    car.damage(99999, true);
    chk(car.hp === 0 && car.burning, '无敌关了：打 99999，车起火');
    run(s, 4);   // 烧 2.6 秒后爆炸
    chk(!car.alive && car.wreck, '起火 4 秒后车炸掉了');
    chk(!p.inVeh, '车炸了，玩家被炸下车');
  }
  // (f) 无敌开着：直接伤害、爆炸、撞车、火箭全都不掉血（单机 godT）
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    p.godT = Infinity;
    chk(s.godOn(), 'godT=Infinity 时 godOn() 为真');
    const hp0 = car.hp;
    car.damage(500, true);
    chk(car.hp === hp0, '无敌开着：直接打 500 也不掉血');
    s.explode(car.x + 3, car.y + 1, car.z, 8, 320, true);
    chk(car.hp === hp0, '无敌开着：旁边炸 320 也不掉血');
    for (const v of s.vehicles) if (v !== car) { v.x += 500; v.z += 500; v.vx = 0; v.vz = 0; v.speed = 0; }
    const other = s.addVehicle('sedan', car.x, car.z + 3, 0);
    car.vz = 12; other.vz = 0;
    s.collideVehicles();
    chk(car.hp === hp0, '无敌开着：12 米/秒撞车也不掉血');
    chk(other.hp === other.spec.hp - 54, '对照：对方的车照常掉了 54 血（只保主角的车，不保别人的车）');
    car.damage(99999, true);
    chk(car.hp === hp0 && !car.burning, '无敌开着：打 99999 也不起火');
  }
  // (g) 坐车分摊：无敌关了，人只吃 20%，车吃 1.6 倍——分摊代码一直都在，只是原来被无条件守门挡住了；无敌开着整段直接返回
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    const hp0 = car.hp, php0 = p.hp;
    s.hurtPlayer(50);
    chk(car.hp === hp0 - 80 && p.hp === php0 - 10, `无敌关了：hurtPlayer(50)，车吃 1.6 倍掉 80（${car.hp}），人吃 20% 掉 10（${p.hp}）`);
    p.godT = Infinity;
    const hp1 = car.hp, php1 = p.hp;
    s.hurtPlayer(50);
    chk(car.hp === hp1 && p.hp === php1, '无敌开着：hurtPlayer 直接返回，人车都不掉血');
    p.godT = 0;
  }
  // (h) 联机全员无敌 netGod 同样管座驾：只开 netGod 也保，只关 netGod 不保（直接改 sim.netGod 模拟 Net.setGod，见 net.js:548）
  {
    const s = new Sim(), p = s.player;
    const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    p.godT = 0; s.netGod = true;   // 单机无敌关着，只开全员无敌
    chk(s.godOn(), '只开 netGod 时 godOn() 也为真');
    const hp0 = car.hp;
    car.damage(500, true);
    chk(car.hp === hp0, '只开全员无敌：直接打 500 也不掉血');
    s.explode(car.x + 3, car.y + 1, car.z, 8, 320, true);
    chk(car.hp === hp0, '只开全员无敌：旁边爆炸也不掉血');
    s.netGod = false;   // 全员无敌也关了
    chk(!s.godOn(), '两个都关了，godOn() 为假');
    car.damage(50, true);
    chk(car.hp === hp0 - 50, '两个都关了：直接打 50，车掉血');
    p.godT = Infinity; s.netGod = false;   // 只开单机无敌
    const hp1 = car.hp;
    car.damage(500, true);
    chk(car.hp === hp1, '只开单机无敌：直接打 500 也不掉血');
    p.godT = 0;
  }
  // (i) 重建：无敌关了，主角坐着的车和别的车一样直接炸掉，玩家被炸下车；楼照旧回来、满血
  {
    const s = new Sim(), w = s.world, p = s.player;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx, cz, 0);
    car.parked = true;
    s.damageBuilding(h, 99999);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    chk(p.inVeh === car, '先坐进停在废墟上的车（无敌关着）');
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    chk(!h.destroyed && h.hp === h.maxHp, '楼重建了、耐久回满（车爆炸没波及刚回来的楼）');
    chk(!car.alive && car.wreck, '无敌关了：主角坐着的车在重建时炸掉了');
    chk(!p.inVeh, '车炸了，玩家被炸下车');
  }
  // (j) 重建：无敌开着，主角坐着的车不炸、被推到楼外（和 §18 的推车测试同一条规则，这里只验开关）
  {
    const s = new Sim(), w = s.world, p = s.player;
    const h = w.buildings.find((b) => b.kind === 'house');
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    const car = s.addVehicle('sedan', cx, cz, 0);
    car.parked = true;
    s.damageBuilding(h, 99999);
    tp(s, car.x + 2.5, car.z);
    s.ctl.enter = true; run(s, 0.1);
    p.godT = Infinity;
    const hp0 = car.hp;
    h.rebuildAt = s.time + 0.1;
    run(s, 2);
    const eps = 1e-6;
    const outside = car.x <= h.x0 - car.radius + eps || car.x >= h.x1 + car.radius - eps || car.z <= h.z0 - car.radius + eps || car.z >= h.z1 + car.radius - eps;
    chk(!h.destroyed && h.hp === h.maxHp, '楼重建了');
    chk(car.alive && car.hp === hp0, '无敌开着：主角坐着的车在重建时没炸、没掉血');
    chk(p.inVeh === car, '玩家还坐在车里');
    chk(outside, '车被推到了楼外');
    p.godT = 0;
  }
  // (k) 直升机失事自毁不受无敌保护：无敌开着，满杆砸楼顶照旧坠毁（自毁直接 hp=0 + explode()，不走 Vehicle.damage）
  {
    const s = new Sim(), p = s.player, w = s.world;
    const tower = w.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
    const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
    const heli = s.vehicles.find((v) => v.type === 'heli');
    tp(s, heli.x + 2.5, heli.z); s.ctl.enter = true; run(s, 0.1);
    chk(p.inVeh === heli, '先上直升机');
    p.godT = Infinity;   // 无敌开着
    heli.x = cx; heli.z = cz; heli.y = top + 30; heli.flying = true; heli.vy = 0; heli.pitch = 0; heli.roll = 0; heli.yaw = 0;
    run(s, 6, () => { s.ctl.pitch = -1; s.ctl.gas = 0; });
    chk(!heli.alive, '无敌开着，满杆砸楼顶照旧坠毁（失事自毁不走 damage()，神也救不了）');
    chk(!p.dead && p.hp === 100, '坠毁后玩家没掉血（无敌挡住了炸下车和爆炸的伤害）');
    p.godT = 0;
  }
}

console.log(fail ? `有 ${fail} 项失败` : '落日湾逻辑测试全部通过');
process.exit(fail ? 1 : 0);
