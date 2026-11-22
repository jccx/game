// 落日湾联机的纯逻辑测试：不开浏览器、不连真数据库，用内存 mock 服务器测
// 名字校验、加入/重名、位置同步、建筑同步、载具同步、建筑重建同步、离开、离线。
// 用法：node test/city-net-sim.mjs
import { Sim } from '../city/js/sim.js';
import { TICK } from '../city/js/config.js';
import { Net, validName, playerPayload, vehicleKey } from '../city/js/net.js';

const dt = 1 / TICK;
let fail = 0;
const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const run = (sim, sec, fn) => { for (let i = 0; i < sec * TICK; i++) { if (fn) fn(i * dt); sim.update(dt); sim.events.length = 0; } };
const tp = (sim, x, z) => { const p = sim.player; p.x = p.px = x; p.z = p.pz = z; p.y = sim.world.groundY(x, z); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 内存版“服务器”：两个客户端共用一个，行为和 Firebase transport 一致（transaction 语义也一样） */
class FakeServer {
  constructor() {
    this.players = {}; this.names = {}; this.buildings = {}; this.vehicles = {};
    this.listeners = { players: [], buildings: [], vehicles: [] };
  }
  notify(kind) { for (const cb of this.listeners[kind]) cb(this[kind]); }
}

function mockTransport(server, opts = {}) {
  let n = mockTransport._n = (mockTransport._n || 0) + 1;
  return {
    _server: server,
    async connect() { if (opts.failConnect) throw new Error('offline'); return `uid-mock-${n}`; },
    async disconnect() {},
    async claimName(name, uid) {
      if (server.names[name] === undefined || server.names[name] === uid) { server.names[name] = uid; return true; }
      return false;
    },
    async releaseName(name, uid) { if (server.names[name] === uid) delete server.names[name]; },
    async armPresence() {},
    async setPlayer(uid, payload) { server.players[uid] = payload; server.notify('players'); },
    async removePlayer(uid) { delete server.players[uid]; server.notify('players'); },
    onPlayers: (cb) => { server.listeners.players.push(cb); cb(server.players); return () => { server.listeners.players = server.listeners.players.filter((f) => f !== cb); }; },
    async setBuilding(i, data) { server.buildings[i] = data; server.notify('buildings'); },
    onBuildings: (cb) => { server.listeners.buildings.push(cb); cb(server.buildings); return () => { server.listeners.buildings = server.listeners.buildings.filter((f) => f !== cb); }; },
    async setVehicle(id, data) { server.vehicles[id] = data; server.notify('vehicles'); },
    onVehicles: (cb) => { server.listeners.vehicles.push(cb); cb(server.vehicles); return () => { server.listeners.vehicles = server.listeners.vehicles.filter((f) => f !== cb); }; },
  };
}

// ---- 1) 名字校验 ----
{
  chk(!validName('').ok, '空名字不合法');
  chk(!validName('   ').ok, '只有空格不合法');
  chk(!validName('a'.repeat(21)).ok, '21 个字太长');
  chk(!validName('a/b').ok && !validName('a.b').ok && !validName('a#b').ok && !validName('a$b').ok && !validName('a[b').ok && !validName('a]b').ok, '名字里不能有 / . # $ [ ]');
  chk(validName('  阿杰  ').ok && validName('  阿杰  ').name === '阿杰', '名字前后空格会被去掉');
  chk(validName('A-1_测').ok, '字母数字下划线横线都合法');
}

// ---- 2) 加入、互相看见、重名被拒 ----
const server = new FakeServer();
const simA = new Sim(), simB = new Sim();
const evA = [], evB = [];
const netA = new Net(simA, mockTransport(server), { onEvent: (e) => evA.push(e) });
const netB = new Net(simB, mockTransport(server), { onEvent: (e) => evB.push(e) });
simA.net = netA; simB.net = netB;
{
  const rA = await netA.join('甲');
  const rB = await netB.join('乙');
  chk(rA.ok && rB.ok, '甲和乙都加入联机');
  chk(netA.status === 'online' && netB.status === 'online', '两边状态都是 online');
  chk(evB.some((e) => e.type === 'playerJoin' && e.name === '甲'), '乙收到了“甲加入”');
  // 甲走 5 米，广播后乙能看到位置变了
  simA.player.x += 5;
  netA.update(0.2);
  const rp = netB.remotePlayers.get(netA.uid);
  chk(rp && rp.name === '甲' && Math.abs(rp.x - simA.player.x) < 0.01, `乙看到甲的位置（x=${rp ? rp.x.toFixed(1) : '无'}）`);
  // 重名
  const netC = new Net(new Sim(), mockTransport(server), { onEvent: () => {} });
  const rC = await netC.join('甲');
  chk(!rC.ok && rC.reason === 'taken', '第三个人用“甲”被拒（重名）');
  chk(netC.status === 'offline', '重名后状态还是 offline');
  // 钱同步：甲赚钱，乙能看到钱数变了（乙自己的钱不动）
  const moneyB = simB.player.money;
  simA.addMoney(500);
  netA.update(1.5);   // 心跳到了就发，哪怕没动
  const rp2 = netB.remotePlayers.get(netA.uid);
  chk(rp2 && rp2.money === simA.player.money && simB.player.money === moneyB, `乙看到甲的钱变了（${rp2 ? rp2.money : '无'}），自己的钱没动`);
}

// ---- 3) 建筑同步：甲炸楼，乙的楼也塌了 ----
let houseIdx = -1;
{
  const b = simA.world.buildings.find((x) => x.kind === 'house' && !x.destroyed);
  houseIdx = simA.world.buildings.indexOf(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  simA.explode(cx, 2, cz, 7, 320, true);
  chk(b.destroyed, '甲这边楼炸塌了');
  netA.update(0.2);   // 冲掉脏建筑状态
  const bB = simB.world.buildings[houseIdx];
  chk(bB.destroyed && bB.hp === 0, '乙那边同一栋楼也塌了（hp 同步为 0）');
  chk(simB.events.some((e) => e.type === 'buildingDown' && e.remote === true && e.b === bB), '乙收到带 remote 标记的 buildingDown 事件');
  // 只伤血没炸塌：血量也同步
  const b2 = simA.world.buildings.find((x) => x.kind === 'house' && !x.destroyed);
  const hp0 = b2.hp;
  simA.damageBuilding(b2, 100);
  netA.update(0.2);
  chk(simB.world.buildings[simA.world.buildings.indexOf(b2)].hp === hp0 - 100, '没炸塌的楼，血量也同步了');
  // 远端重复状态不重复发事件
  const evN = simB.events.length;
  simB.applyRemoteBuilding(houseIdx, 0, true);
  chk(simB.events.length === evN, '重复的远端建筑状态不重复发事件');
}

// ---- 4) 载具同步：甲开固定轿车，乙看到车在动、司机是甲；甲下车后乙看到司机没了 ----
{
  const carA = simA.vehicles.find((v) => v.type === 'sedan' && v.fixed);
  tp(simA, carA.x + 2.6, carA.z);
  simA.ctl.enter = true; run(simA, 0.1);
  chk(simA.player.inVeh === carA, '甲坐进固定轿车');
  run(simA, 2, () => { simA.ctl.gas = 1; });
  simA.ctl.gas = 0;
  chk(carA.speed > 5, `甲把车开动了（${(carA.speed * 3.6).toFixed(0)} km/h）`);
  netA.update(0.2);
  const carB = simB.fixedSpawns[0].v;
  chk(carB.type === 'sedan' && Math.abs(carB.x - carA.x) < 1 && Math.abs(carB.z - carA.z) < 1, '乙那边同一辆车位置跟过来了');
  chk(carB.remoteDriven === true && carB.driver === netA.uid, '乙那边车标记为甲在开');
  chk(vehicleKey(simA) === 'fixed-0', '甲的玩家节点里 vehicle 写的是 fixed-0');
  // 甲下车
  simA.ctl.enter = true; run(simA, 0.1);
  chk(!simA.player.inVeh, '甲下车了');
  netA.update(0.2);
  chk(carB.driver === '' && carB.remoteDriven === false, '乙那边车司机清空了');
}

// ---- 5) 建筑重建同步：甲炸楼后重建，恢复状态同步给乙；甲掉线后乙也能自己定时重建 ----
// 重建计时用游戏时间 this.time；这里把重建点拨到 1 秒后，不用真等 60~180 秒。
{
  // 甲炸第二栋楼，同步给乙（乙那边也排了本地重建计时）
  const b = simA.world.buildings.find((x) => x.kind === 'house' && !x.destroyed);
  const idx = simA.world.buildings.indexOf(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  simA.explode(cx, 2, cz, 7, 320, true);
  netA.update(0.2);   // 冲掉脏建筑状态
  const bB = simB.world.buildings[idx];
  chk(bB.destroyed, '甲炸第二栋楼，乙那边也塌了');
  chk(bB.rebuildAt > simB.time, '乙收到已炸的楼，也排了本地重建计时');
  // 甲那边到时间重建，恢复状态同步给乙（乙自己的计时还没到，恢复只能来自同步）
  simA.world.buildings[idx].rebuildAt = simA.time + 1;
  run(simA, 2);
  chk(!simA.world.buildings[idx].destroyed && simA.world.buildings[idx].hp === simA.world.buildings[idx].maxHp, '甲那边楼重建了（血量回满）');
  netA.update(0.2);   // 冲掉重建记脏的状态
  chk(!bB.destroyed && bB.hp === bB.maxHp, '乙那边楼也恢复了（重建状态同步过来了）');
  chk(simB.events.some((e) => e.type === 'buildingUp' && e.remote === true && e.b === bB), '乙收到带 remote 标记的 buildingUp 事件');
  // 炸楼的人掉线：甲炸第三栋楼、同步给乙后离开，乙自己的计时到了也会重建、把恢复写回库里
  const b3 = simA.world.buildings.find((x) => x.kind === 'house' && !x.destroyed);
  const idx3 = simA.world.buildings.indexOf(b3);
  const cx3 = (b3.x0 + b3.x1) / 2, cz3 = (b3.z0 + b3.z1) / 2;
  simA.explode(cx3, 2, cz3, 7, 320, true);
  netA.update(0.2);
  const bB3 = simB.world.buildings[idx3];
  chk(bB3.destroyed, '甲炸第三栋楼，乙那边也塌了');
  await netA.leave();
  bB3.rebuildAt = simB.time + 1;   // 乙自己的计时到了（拨到 1 秒后）
  run(simB, 2);
  chk(!bB3.destroyed && bB3.hp === bB3.maxHp, '甲掉线后乙自己重建了楼');
  netB.update(0.2);   // 冲掉重建记脏的状态
  chk(server.buildings[idx3] && server.buildings[idx3].destroyed === false, '乙重建后恢复状态写回了库里');
  // 甲重新加入，继续后面的测试
  const rA2 = await netA.join('甲');
  chk(rA2.ok, '甲重新加入');
  netA.update(0.2);
}

// ---- 6) 掉线兜底：远端玩家 10 秒没更新就当离开 ----
{
  const rp = netB.remotePlayers.get(netA.uid);
  chk(!!rp, '乙还看得到甲');
  rp.updatedAt = Date.now() - 20000;
  netB.update(0.1);
  chk(!netB.remotePlayers.has(netA.uid), '甲 10 秒没更新，乙那边把他清掉了');
  chk(evB.some((e) => e.type === 'playerLeave' && e.name === '甲'), '乙收到“甲离开”');
}

// ---- 7) 离开：玩家节点和名字都释放，乙看不到甲了 ----
{
  // 甲重新加入（第 6 节只是乙单方面清掉，甲其实还在）
  const uidA = netA.uid;
  const r = await netA.join('甲');
  chk(r.ok, '甲重新加入');
  netA.update(0.2);
  chk(netB.remotePlayers.has(uidA), '乙又看到甲了');
  await netA.leave();
  chk(netA.status === 'offline' && !server.players[uidA], '甲离开后服务器上没他的玩家节点了');
  chk(server.names['甲'] === undefined, '甲的名字释放了');
  chk(!netB.remotePlayers.has(uidA), '乙那边甲也不见了');
  // 名字释放后别人能再用
  const netE = new Net(new Sim(), mockTransport(server), { onEvent: () => {} });
  const rE = await netE.join('甲');
  chk(rE.ok, '甲的名字释放后，别人能再用“甲”');
  await netE.leave();
}

// ---- 8) 连不上：join 失败，不碰游戏状态 ----
{
  const simF = new Sim();
  const netF = new Net(simF, mockTransport(server, { failConnect: true }), { onEvent: () => {} });
  const rF = await netF.join('失败');
  chk(!rF.ok && rF.reason === 'offline' && netF.status === 'failed', '连不上时 join 返回 offline');
  chk(simF.net === null, '连不上时 sim.net 还是 null，单机不受影响');
}

// ---- 9) 玩家 payload：字段齐全、数值取整 ----
{
  const simG = new Sim();
  simG.player.x = 123.456; simG.player.y = 2.345; simG.player.z = 789.012;
  const pl = playerPayload(simG, '测试', 1700000000000);
  chk(pl.name === '测试' && pl.x === 123.46 && pl.y === 2.35 && pl.z === 789.01 && pl.updatedAt === 1700000000000, 'payload 字段齐全、坐标取整到 2 位小数');
  chk(pl.vehicle === '', '步行时 vehicle 是空字符串');
  chk(['name', 'x', 'y', 'z', 'yaw', 'hp', 'money', 'weapon', 'updatedAt'].every((k) => k in pl), 'payload 带齐规则要求的必填字段');
}

console.log(fail ? `有 ${fail} 项失败` : '落日湾联机逻辑测试全部通过');
process.exit(fail ? 1 : 0);
