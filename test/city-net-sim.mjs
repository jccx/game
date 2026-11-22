// 落日湾联机的纯逻辑测试：不开浏览器、不连真数据库，用内存 mock 服务器测
// 名字校验、加入/重名、位置同步、建筑同步、载具同步、建筑重建同步、离开、离线。
// 用法：node test/city-net-sim.mjs
import { Sim } from '../city/js/sim.js';
import { TICK } from '../city/js/config.js';
import { Net, validName, playerPayload, vehicleKey, weekKey } from '../city/js/net.js';
import { keyboardViewport } from '../shared/js/ui.js';

/** 开火/伤害事件的序号键（和 net-firebase.js 里的一样）：补零到 8 位，字典序就是数字序 */
const seqKey = (seq) => String(seq).padStart(8, '0');

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
    this.env = {}; this.shots = {}; this.hits = {}; this.pdmg = {}; this.vdmg = {}; this.ptake = {}; this.missions = {}; this.scores = {}; this.feed = {}; this.god = null;
    this.log = [];   // 离开时的调用顺序（cancelPresence 必须在 removePlayer/releaseName 之前）
    // “整个节点”式订阅（players/buildings/vehicles/env/scores）存的是值监听；
    // “新孩子”式订阅（shots/hits/pdmg/feed）存的是新增监听，订阅时会把已有的重放一遍（和 Firebase onChildAdded 一样）
    this.listeners = { players: [], buildings: [], vehicles: [], env: {}, scores: {}, shots: [], hits: {}, pdmg: [], vdmg: [], ptake: [], missions: [], feed: [], god: [] };
  }
  notify(kind) { for (const cb of this.listeners[kind]) cb(this[kind]); }
  notifyEnv(uid) { for (const cb of (this.listeners.env[uid] || [])) cb(this.env[uid] ?? null); }
  notifyScores(week) { for (const cb of (this.listeners.scores[week] || [])) cb(this.scores[week] || {}); }
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
    async releaseName(name, uid) { if (server.names[name] === uid) delete server.names[name]; server.log.push('releaseName'); },
    async armPresence() {},
    async cancelPresence() { server.log.push('cancelPresence'); },
    async setPlayer(uid, payload) { server.players[uid] = payload; server.notify('players'); },
    async removePlayer(uid) { delete server.players[uid]; server.log.push('removePlayer'); server.notify('players'); },
    onPlayers: (cb) => { server.listeners.players.push(cb); cb(server.players); return () => { server.listeners.players = server.listeners.players.filter((f) => f !== cb); }; },
    async setBuilding(i, data) { server.buildings[i] = data; server.notify('buildings'); },
    onBuildings: (cb) => { server.listeners.buildings.push(cb); cb(server.buildings); return () => { server.listeners.buildings = server.listeners.buildings.filter((f) => f !== cb); }; },
    async setVehicle(id, data) { server.vehicles[id] = data; server.notify('vehicles'); },
    onVehicles: (cb) => { server.listeners.vehicles.push(cb); cb(server.vehicles); return () => { server.listeners.vehicles = server.listeners.vehicles.filter((f) => f !== cb); }; },

    // ---- v2：环境快照、开火、伤害、排行榜 ----
    async armEnv() {},
    async cancelEnv() { server.log.push('cancelEnv'); },
    async setEnv(uid, data) { server.env[uid] = data; server.notifyEnv(uid); },
    async removeEnv(uid) { delete server.env[uid]; server.log.push('removeEnv'); server.notifyEnv(uid); },
    onEnv: (uid, cb) => {
      (server.listeners.env[uid] ??= []).push(cb); cb(server.env[uid] ?? null);
      return () => { server.listeners.env[uid] = server.listeners.env[uid].filter((f) => f !== cb); };
    },
    async pushShot(uid, seq, data) { (server.shots[uid] ??= {})[seqKey(seq)] = data; for (const cb of server.listeners.shots) cb(uid, seq, data); },
    async removeShot(uid, seq) { if (server.shots[uid]) delete server.shots[uid][seqKey(seq)]; },
    async removeShots(uid) { delete server.shots[uid]; },
    onShots: (cb) => {
      server.listeners.shots.push(cb);
      for (const uid in server.shots) for (const k in server.shots[uid]) cb(uid, parseInt(k, 10), server.shots[uid][k]);
      return () => { server.listeners.shots = server.listeners.shots.filter((f) => f !== cb); };
    },
    async sendHit(victimUid, seq, data) { (server.hits[victimUid] ??= {})[seqKey(seq)] = data; for (const cb of (server.listeners.hits[victimUid] || [])) cb(seq, data); },
    async removeHit(uid, seq) { if (server.hits[uid]) delete server.hits[uid][seqKey(seq)]; },
    async removeHits(uid) { delete server.hits[uid]; },
    onHits: (uid, cb) => {
      (server.listeners.hits[uid] ??= []).push(cb);
      if (server.hits[uid]) for (const k in server.hits[uid]) cb(parseInt(k, 10), server.hits[uid][k]);
      return () => { server.listeners.hits[uid] = server.listeners.hits[uid].filter((f) => f !== cb); };
    },
    async sendPdmg(key, data) { server.pdmg[key] = data; for (const cb of server.listeners.pdmg) cb(key, data); },
    async removePdmg(key) { delete server.pdmg[key]; },
    onPdmg: (cb) => {
      server.listeners.pdmg.push(cb);
      for (const k in server.pdmg) cb(k, server.pdmg[k]);
      return () => { server.listeners.pdmg = server.listeners.pdmg.filter((f) => f !== cb); };
    },
    async sendVdmg(key, data) { server.vdmg[key] = data; for (const cb of server.listeners.vdmg) cb(key, data); },
    async removeVdmg(key) { delete server.vdmg[key]; },
    onVdmg: (cb) => {
      server.listeners.vdmg.push(cb);
      for (const k in server.vdmg) cb(k, server.vdmg[k]);
      return () => { server.listeners.vdmg = server.listeners.vdmg.filter((f) => f !== cb); };
    },
    async sendPtake(key, data) { server.ptake[key] = data; for (const cb of server.listeners.ptake) cb(key, data); },
    async removePtake(key) { delete server.ptake[key]; },
    onPtake: (cb) => {
      server.listeners.ptake.push(cb);
      for (const k in server.ptake) cb(k, server.ptake[k]);
      return () => { server.listeners.ptake = server.listeners.ptake.filter((f) => f !== cb); };
    },
    async claimMission(id, data) {
      const cur = server.missions[id];
      if (!cur || cur.state === 'done' || (typeof cur.t === 'number' && Date.now() - cur.t > 20000)) {
        server.missions[id] = data;
        for (const cb of server.listeners.missions) cb({ ...server.missions });
        return true;
      }
      return false;
    },
    async setMission(id, data) { server.missions[id] = data; for (const cb of server.listeners.missions) cb({ ...server.missions }); },
    async removeMission(id) { delete server.missions[id]; for (const cb of server.listeners.missions) cb({ ...server.missions }); },
    onMissions: (cb) => {
      server.listeners.missions.push(cb);
      cb({ ...server.missions });
      return () => { server.listeners.missions = server.listeners.missions.filter((f) => f !== cb); };
    },
    async scoreTx(week, name, field) {
      (server.scores[week] ??= {})[name] ??= { kills: 0, deaths: 0 };
      server.scores[week][name][field]++;
      server.notifyScores(week);
    },
    onScores: (week, cb) => {
      (server.listeners.scores[week] ??= []).push(cb); cb(server.scores[week] || {});
      return () => { server.listeners.scores[week] = server.listeners.scores[week].filter((f) => f !== cb); };
    },
    async pushFeed(key, data) { server.feed[key] = data; for (const cb of server.listeners.feed) cb(key, data); },
    async removeFeed(key) { delete server.feed[key]; },
    onFeed: (cb) => {
      server.listeners.feed.push(cb);
      for (const k in server.feed) cb(k, server.feed[k]);
      return () => { server.listeners.feed = server.listeners.feed.filter((f) => f !== cb); };
    },
    async setGod(data) { server.god = data; for (const cb of server.listeners.god) cb(server.god); },
    onGod: (cb) => {
      server.listeners.god.push(cb); cb(server.god);
      return () => { server.listeners.god = server.listeners.god.filter((f) => f !== cb); };
    },
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

// ---- 10) 全员无敌：甲拨动，乙也无敌；关了就恢复；范围是全部伤害 ----
{
  // 第 7 节末尾甲已经离开了，先重新加入
  const rA = await netA.join('甲');
  chk(rA.ok, '甲重新加入（全员无敌测试）');
  netA.update(0.2);
  chk(netB.remotePlayers.has(netA.uid), '乙又看到甲了');
  chk(netA.god === false && netB.god === false, '默认全员无敌是关的');
  netA.setGod(true);
  chk(netA.god === true && netB.god === true, '甲打开全员无敌，乙那边也开了');
  chk(simA.netGod === true && simB.netGod === true, '两边 sim.netGod 都是 true');
  chk(netA.godBy === '甲' && netB.godBy === '甲', '两边都知道是甲开的');
  simB.player.hp = 100; simB.hurtPlayer(50);
  chk(simB.player.hp === 100, '全员无敌开着，乙被打不掉血');
  simB.hurtPlayer(999);
  chk(simB.player.hp === 100, '999 点伤害也挡住了（所有伤害都走 hurtPlayer）');
  netA.setGod(false);
  chk(netA.god === false && netB.god === false && simB.netGod === false, '甲关掉后两边都关了');
  simB.player.hp = 100; simB.hurtPlayer(50);
  chk(simB.player.hp < 100, '关掉后伤害又生效了');
  netB.setGod(true);
  chk(netA.god === true && netA.godBy === '乙', '乙拨动也生效，甲那边看到是乙开的');
  netB.setGod(false);
  chk(netA.god === false, '乙关掉后甲那边也关了');
}

// ---- 11) 离开立即释放：先取消断线清理再删节点，名字马上能重用 ----
{
  server.log.length = 0;
  await netA.leave();
  const iCancel = server.log.indexOf('cancelPresence');
  const iRemove = server.log.indexOf('removePlayer');
  const iRelease = server.log.indexOf('releaseName');
  chk(iCancel >= 0 && iCancel < iRemove && iCancel < iRelease, '离开时先取消断线清理，再删玩家节点和名字');
  chk(server.log.includes('cancelEnv'), '离开时也取消了环境快照的断线清理');
  chk(server.names['甲'] === undefined, '甲的名字立即释放了');
  const netG = new Net(new Sim(), mockTransport(server), { onEvent: () => {} });
  const rG = await netG.join('甲');
  chk(rG.ok, '甲离开后，别人马上能用“甲”');
  await netG.leave();
  const rA3 = await netA.join('甲');
  chk(rA3.ok, '甲重新加入');
  netA.update(0.2);
}

// ---- 12) 排行榜按名字：名字重用后落在同一行、继承它的分（合并不清零） ----
{
  const week = weekKey();
  netB.recordKill('甲', '乙');   // 模拟乙被甲击杀后，乙的客户端记分
  chk((server.scores[week]['甲'] || {}).kills === 1 && (server.scores[week]['乙'] || {}).deaths === 1, '甲 1 杀、乙 1 死记到本周榜');
  await netA.leave();
  const netH = new Net(new Sim(), mockTransport(server), { onEvent: () => {} });
  const rH = await netH.join('甲');
  chk(rH.ok, '别人用“甲”加入');
  chk(netH.scores.get('甲') && netH.scores.get('甲').kills === 1, '新“甲”继承了原来甲的 1 杀（按名字认人，见 plan 文件）');
  await netH.leave();
  const rA4 = await netA.join('甲');
  chk(rA4.ok, '甲重新加入');
  netA.update(0.2);
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

// ---- 13) 房主选举：uid 最小的在线玩家当房主；房主离开后重选，接手的人把镜像转成本地 ----
{
  const server2 = new FakeServer();
  const simP = new Sim(), simQ = new Sim();
  const evP = [], evQ = [];
  const netP = new Net(simP, mockTransport(server2), { onEvent: (e) => evP.push(e) });
  const netQ = new Net(simQ, mockTransport(server2), { onEvent: (e) => evQ.push(e) });
  simP.net = netP; simQ.net = netQ;
  const rP = await netP.join('丙');
  const rQ = await netQ.join('丁');
  chk(rP.ok && rQ.ok, '丙和丁都加入（选举测试用新服务器）');
  chk(netP.uid < netQ.uid, `房主按 uid 排：丙的 uid 更小（${netP.uid} < ${netQ.uid}）`);
  chk(netP.isHost && netP.hostUid === netP.uid, 'uid 最小的丙是房主');
  chk(!netQ.isHost && netQ.hostUid === netP.uid, '丁不是房主，认丙是房主');
  chk(simP.netHost === true && simQ.netHost === false, '房主的 sim 标记 host，非房主不是');
  chk(evP.some((e) => e.type === 'hostChange' && e.isHost === true), '丙收到当房主的 hostChange');
  chk(!!netQ.unsubEnv, '非房主丁订阅了房主的环境快照');
  // 房主发个快照，丁收到镜像；房主离开后丁接手，镜像转成本地接着模拟
  const pedP = simP.addPed('civ', simP.player.x + 5, simP.player.z + 5);
  netP.publishEnv();
  const mirQ = simQ.peds.find((o) => o.remote && o.netId === pedP.netId);
  chk(!!mirQ, '丁收到房主的路人镜像');
  await netP.leave();
  chk(netQ.isHost && netQ.hostUid === netQ.uid, '丙离开后丁当选房主（uid 最小）');
  chk(simQ.netHost === true, '丁的 sim 接手成 host');
  chk(evQ.some((e) => e.type === 'hostChange' && e.isHost === true), '丁收到当房主的 hostChange');
  const took = simQ.peds.find((o) => o.netId === pedP.netId);
  chk(took && !took.remote, '丁接手后路人镜像转成本地（不断档）');
  chk(!netQ.unsubEnv, '丁当房主后不再订阅别人的环境快照');
  // 丙重新加入（uid 不变，还是最小），房主回到丙手里
  const rP2 = await netP.join('丙');
  chk(rP2.ok, '丙重新加入');
  chk(netP.isHost && !netQ.isHost, '丙回来后重新当选房主，丁交出');
  chk(simQ.netHost === false, '丁的 sim 交出 host');
  await netP.leave();
  await netQ.leave();
}

// ---- 14) 环境快照：房主的路人/警车/交通车/拾取物/子弹同步给非房主，伤害和领取请求走房主结算 ----
{
  chk(netA.isHost && !netB.isHost, '甲是房主、乙不是（快照测试的前提）');
  // 房主这边放一个平民、一个警察、一辆交通车、一辆追捕警车
  const px = simA.player.x, pz = simA.player.z;
  const civA = simA.addPed('civ', px + 5, pz + 5);
  const copA = simA.addPed('cop', px + 8, pz + 5);
  const trA = simA.addVehicle('sedan', px + 10, pz, 0);
  trA.ai = { kind: 'traffic', route: null, routeT: 0, stuck: 0, rev: 0 };
  const chA = simA.addVehicle('police', px + 12, pz, 0);
  chA.ai = { kind: 'chase', route: null, routeT: 0, stuck: 0, rev: 0 }; chA.siren = true;
  netA.publishEnv();
  const snap = server.env[netA.uid];
  chk(snap && snap.peds.length >= 2 && snap.peds.some((e) => e[1] === 1), '快照里有平民和警察（kind=1 是警察）');
  chk(snap.cars.some((e) => e[1] === 0) && snap.cars.some((e) => e[1] === 1), '快照里有交通车和追捕警车');
  chk(snap.pickups.length > 0, `快照里有共享拾取物（${snap.pickups.length} 个）`);
  const civB = simB.peds.find((o) => o.remote && o.netId === civA.netId);
  const copB = simB.peds.find((o) => o.remote && o.netId === copA.netId);
  chk(!!civB && civB.kind === 'civ', '乙收到平民镜像');
  chk(!!copB && copB.kind === 'cop', '乙收到警察镜像');
  chk(Math.abs(civB.sx - civA.x) < 0.1 && Math.abs(copB.sx - copA.x) < 0.1, '镜像记下了快照位置（插值目标，允许 1 位小数取整）');
  run(simB, 1);
  chk(Math.hypot(civB.x - civA.x, civB.z - civA.z) < 1, '镜像 1 秒内插值走到快照位置附近');
  const trB = simB.vehicles.find((v) => v.remoteDriven && v.netId === trA.netId);
  const chB = simB.vehicles.find((v) => v.remoteDriven && v.netId === chA.netId);
  chk(!!trB && trB.ai.kind === 'traffic', '乙收到交通车镜像');
  chk(!!chB && chB.ai.kind === 'chase' && chB.siren === true, '乙收到追捕警车镜像（带警笛）');
  // 快照里没了的镜像删掉：房主删掉警察和交通车，乙的镜像也跟着没
  simA.peds.splice(simA.peds.indexOf(copA), 1);
  simA.vehicles.splice(simA.vehicles.indexOf(trA), 1);
  netA.publishEnv();
  chk(!simB.peds.some((o) => o.netId === copA.netId), '房主删了警察，乙的镜像也删了');
  chk(!simB.vehicles.some((v) => v.netId === trA.netId), '房主删了交通车，乙的镜像也删了');
  // 子弹：甲开一枪（即时命中），乙看到曳光线；甲发一枚火箭，乙看到一枚只看不伤的弹道
  const py = simA.player.y;
  netA.sendShot({ kind: 'pistol', x: px, y: py + 1, z: pz, dx: 0, dy: 0, dz: 1, speed: 0, hx: px, hy: py + 1, hz: pz + 50 });
  chk(simB.events.some((e) => e.type === 'tracer' && e.mine === false), '乙看到甲的开火曳光线');
  netA.sendShot({ kind: 'rocket', x: px, y: py + 1, z: pz, dx: 0, dy: 0.1, dz: 1, speed: 55, radius: 6, range: Infinity });
  const rsh = simB.shots.find((s) => s.remote);
  chk(!!rsh && rsh.dmg === 0, '乙收到甲的火箭弹道（只看不伤，dmg=0）');
  // 非房主打镜像行人：请求走房主结算，房主那边掉血
  const hp0 = civA.hp;
  netB.requestPedDamage(civB, 20, civB.x, civB.z);
  chk(civA.hp === hp0 - 20, `乙打镜像平民，房主那边平民掉血（${hp0}→${civA.hp}）`);
  // 非房主打镜像警车：同理
  const chHp0 = chA.hp;
  netB.requestVehicleDamage(chB, 100);
  chk(chA.hp === chHp0 - 100, `乙打镜像警车，房主那边警车掉血（${chHp0}→${chA.hp}）`);
  // 拾取物领取：乙走到镜像医疗包上，请求房主批，快照确认后生效
  const pkB = simB.pickups.find((k) => k.remote && k.type === 'health' && k.t <= 0);
  chk(!!pkB, '乙收到共享医疗包镜像');
  simB.player.hp = 50;
  tp(simB, pkB.x, pkB.z);
  run(simB, 0.2);
  netA.publishEnv();
  chk(simB.player.hp === 100, '房主批了领取，乙回满血（快照确认后生效）');
  const pkB2 = simB.pickups.find((k) => k.key === pkB.key);
  chk(pkB2 && pkB2.t > 0, '领完后镜像医疗包进重生倒计时');
  // 任务：甲抢一个带载具的检查点任务，乙看到共享状态和任务车镜像；甲放掉后乙那边清掉
  const def = simA.missions.list.find((m) => m.type === 'checkpoints' && m.vehicle);
  chk(!!def, `找到一个带载具的检查点任务（${def ? def.name : '无'}）`);
  const okClaim = await netA.claimMission(def.id);
  chk(okClaim === true, '甲抢到任务');
  chk(netB.missionStates.get(def.id) && netB.missionStates.get(def.id).by === netA.uid, '乙看到任务是甲的');
  const okClaimB = await netB.claimMission(def.id);
  chk(okClaimB === false, '甲占着任务时乙抢不到');
  simA.missions.start(def);
  netA.publishMissionProgress();
  const stB = netB.missionStates.get(def.id);
  chk(stB && stB.cp === 0 && stB.left === def.cps.length, `乙看到任务进度（0/${def.cps.length} 检查点）`);
  chk(!!stB.vehicle && stB.vehicle.type === def.vehicle, '乙收到任务载具的位置');
  const mvB = simB.vehicles.find((v) => v.missionId === def.id);
  chk(!!mvB, '乙那边建了任务载具镜像');
  simA.missions.fail('测试结束');
  chk(!netB.missionStates.has(def.id), '甲的任务失败放掉后，乙那边任务没了');
  chk(!simB.vehicles.some((v) => v.missionId === def.id), '任务结束，乙的任务车镜像也清了');
}

// ---- 15) 跑步模式（令牌桶，2026-11-22 01:49 用户定）：3 倍速；桶 40 秒，跑动扣、步行回，站着不扣不回；扣空强制步行 ----
{
  const sim = new Sim();
  const ctl = sim.ctl;
  const sx0 = sim.player.x, sz0 = sim.player.z;   // 出生点（住宅区人行道，陆地）
  // 长时间跑/走：每 1 秒传回出生点——往北跑 30 秒会进河（水里不跑也不回桶），传回出生点只为留在陆地上，不影响预算逻辑
  const go = (runFlag, sec) => { ctl.mx = 0; ctl.mz = -1; ctl.run = runFlag; let left = sec; while (left > 0) { const step = Math.min(1, left); run(sim, step); left -= step; tp(sim, sx0, sz0); } };
  chk(Math.abs(sim.runBudgetLeft() - 40) < 1e-9, '出生时跑步预算是满的 40 秒');
  // 步行速度
  go(false, 0.5);
  chk(Math.abs(sim.player.speed - 6.5) < 0.6 && !sim.player.running, `步行速度 6.5 米/秒（实测 ${sim.player.speed.toFixed(1)}）`);
  // 跑步 3 倍速
  go(true, 0.5);
  chk(sim.player.running && Math.abs(sim.player.speed - 19.5) < 0.6, `跑步速度 19.5 米/秒（实测 ${sim.player.speed.toFixed(1)}），正好 3 倍`);
  chk(Math.abs(sim.runBudgetLeft() - 39.5) < 0.6, `跑 0.5 秒扣 0.5 秒预算（剩 ${sim.runBudgetLeft().toFixed(1)} 秒）`);
  chk(playerPayload(sim, '甲').run === 1, '跑步时同步标志 run=1（别人看跑步姿态）');
  // 扣空：再跑 39.5 秒，预算归零、锁死；再跑一小步，强制步行状态落定（刚扣空那一 tick 的 running 还是 true，下一 tick 才变步行）
  go(true, 39.5);
  chk(sim.runBudgetLeft() < 0.05, '跑满 40 秒后预算归零');
  chk(sim.runLocked === true, '扣空后锁死');
  run(sim, 0.1);
  chk(!sim.player.running && Math.abs(sim.player.speed - 6.5) < 0.6, '预算空了强制步行（还按着跑步键，速度回 6.5）');
  chk(playerPayload(sim, '甲').run === 0, '强制步行时同步标志 run=0');
  // 走路回额度：走 20 秒回 20 秒
  go(false, 20);
  chk(Math.abs(sim.runBudgetLeft() - 20) < 0.5, `走 20 秒回 20 秒预算（剩 ${sim.runBudgetLeft().toFixed(1)} 秒）`);
  // 再跑 10 秒：60 秒里一共跑了 50 秒（40+10），令牌桶允许
  go(true, 10);
  chk(sim.player.running && Math.abs(sim.runBudgetLeft() - 10) < 0.5, '走 20 秒后又能跑 10 秒（60 秒里跑了 50 秒）');
  // 站着不动：不扣也不回
  ctl.mx = 0; ctl.mz = 0; ctl.run = true; run(sim, 5);
  chk(Math.abs(sim.runBudgetLeft() - 10) < 0.5, '站着按住跑步键 5 秒，预算不动（不扣）');
  ctl.run = false; run(sim, 5);
  chk(Math.abs(sim.runBudgetLeft() - 10) < 0.5, '站着不动 5 秒，预算也不回（只走路才回）');
  // 锁死期：再跑 10.1 秒扣空（前面落定那 0.1 秒回了 0.1 秒桶），锁死；走 3 秒只回 3 秒（不到 5 秒解锁线），按住跑还是步行；再走 2 秒回满 5 秒，解锁，又能跑了
  go(true, 10.1);
  chk(sim.runBudgetLeft() < 0.05, '再跑 10 秒扣空');
  chk(sim.runLocked === true, '扣空后又锁死');
  run(sim, 0.1);
  chk(!sim.player.running, '锁死后强制步行');
  go(false, 3);
  chk(Math.abs(sim.runBudgetLeft() - 3) < 0.5, `锁死后走 3 秒回 3 秒（剩 ${sim.runBudgetLeft().toFixed(1)} 秒），还没到 5 秒解锁线`);
  ctl.mx = 0; ctl.mz = -1; ctl.run = true; run(sim, 0.5);
  chk(!sim.player.running && Math.abs(sim.player.speed - 6.5) < 0.6, '没回满 5 秒前按住跑还是步行（锁死期）');
  go(false, 2);
  ctl.mx = 0; ctl.mz = -1; ctl.run = true; run(sim, 0.5);
  chk(sim.player.running && Math.abs(sim.player.speed - 19.5) < 0.6, '回满 5 秒后解锁，又能跑了');
  ctl.run = false;
}

console.log(fail ? `有 ${fail} 项失败` : '落日湾联机逻辑测试全部通过');
process.exit(fail ? 1 : 0);
