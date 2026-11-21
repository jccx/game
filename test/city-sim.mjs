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
    chk(r.rocket >= 1 && p.ammo[R] === ammo0 - 1, `${name}上发火箭筒：火箭飞出去了，弹药 ${ammo0} → ${p.ammo[R]}`);
    chk(v.alive && v.hp === hp0, `${name}上发火箭筒：自己的车完好无损（耐久 ${v.hp}/${v.spec.hp}）`);
    chk(p.weapon === weapon0, `${name}上发火箭不改变当前选中的武器（还是${WEAPONS[weapon0].name}）`);
    // 发出去的火箭不会一出发就炸自己的车：再跑 2 秒，等它飞远炸开，自己的车还是完好
    run(sim, 2);
    chk(v.alive && v.hp === hp0, `${name}上火箭飞远爆炸后，自己的车还是完好无损`);
    if (type === 'heli') run(sim, 12, () => { sim.ctl.pitch = -0.4; sim.ctl.gas = 0; sim.ctl.steer = 0; });   // 直升机先落回地面再下机
    // 下车后武器和弹药状态不变
    sim.ctl.enter = true; run(sim, 0.2);
    chk(!p.inVeh && p.ammo[R] === ammo0 - 1 && p.weapon === weapon0, `${name}上下车后火箭弹药还是 ${p.ammo[R]} 发，武器没变`);
  }
  // 弹药打空自动补满到 6 发，和步行一致
  {
    const sim = new Sim(), p = sim.player;
    const car = sim.vehicles.find((v) => v.type === 'sedan' && v.fixed);
    tp(sim, car.x + 2.5, car.z); sim.ctl.enter = true; run(sim, 0.1);
    sim.ctl.aimYaw = clearYaw(sim, car); sim.ctl.aimSet = true;
    p.ammo[R] = 1; p.shootCd = 0;
    holdRocket(sim, 1);
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
    chk(r.rocket >= 1 && r.shell === 0, `坦克按火箭键：只发火箭（${r.rocket} 发），没同时开炮`);
    let shells = 0;
    sim.ctl.fire = true;
    for (let i = 0; i < 2 * TICK; i++) { sim.update(dt); for (const e of sim.events) if (e.type === 'shot' && e.w === 'shell') shells++; sim.events.length = 0; }
    sim.ctl.fire = false;
    chk(shells >= 1, `坦克按开炮键：坦克炮照旧能开火（${shells} 发）`);
  }
}

// ---- 12) 火箭筒射程无限（2026-11-21） ----
// 注意：火箭有重力下坠（每帧 dy 减，不改），地面平射 47 米就落地，所以 200/300 米的测试必须从高处打：
// 步行从 95 米高的楼顶平射，弹道 300 米才落地；车上从 150 米高的直升机上发，飞得更远。
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
  // 找一条从楼顶出发、320 米弹道净空的方向
  let yaw = null;
  for (let k = 0; k < 16; k++) { const y = k * Math.PI / 8; if (arcClear(w, fx, fz, y, y0, 320)) { yaw = y; break; } }
  chk(yaw !== null, `找到一条 320 米弹道净空的方向（朝向 ${yaw !== null ? (yaw * 57.3).toFixed(0) : '-'} 度）`);
  // 步行：火箭飞过 130 米、200 米仍在飞，打中 300 米外的靶车才爆炸
  const target = sim.addVehicle('target', fx + Math.sin(yaw) * 300, fz + Math.cos(yaw) * 300, 0);
  target.fixed = true;   // 300 米超出交通回收距离（240 米），不固定会被 spawnTraffic 当远处闲车回收掉
  chk(w.groundY(target.x, target.z) >= 1.9, '300 米外的靶车落在陆地上');
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
  chk(hitTarget, `楼顶步行发火箭：打中 300 米外的靶车并炸伤它（靶车耐久 ${target.hp.toFixed(0)}/${target.spec.hp}）`);
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
console.log(fail ? `有 ${fail} 项失败` : '落日湾逻辑测试全部通过');
process.exit(fail ? 1 : 0);
