// 落日湾联机：同步状态、算房主、收发事件。纯逻辑，不直接碰 Firebase：
// 读写数据库只走构造时传进来的 transport（net-firebase.js 是真实现，测试用内存 mock）。
// 同步什么、多久发一次，都以省流量为先：玩家 8Hz（动的时候）/ 1 秒心跳（站着不动时）、
// 建筑和固定载具只在变了的时候发、环境快照 2Hz、开火只发事件不发弹道。
//
// v1（2026-11-21）：玩家位置/钱/武器、建筑 hp、固定载具、重名保护、掉线清理。
// v2（2026-11-22）：
//   - 房主制：uid 最小的在线玩家是房主，只有房主模拟路人、警察和警车，其他人按快照渲染；
//     房主掉线后剩下的人里 uid 最小的接手，接手时把镜像行人/警车转成本地继续模拟。
//   - 环境快照 env/{房主uid}：房主每 0.5 秒写一次平民/警察/追捕警车的状态；
//     非房主按 netId 对上本地行人，位置插值跟过去，不直接跳变。
//   - 开火事件 shots/{uid}/{序号}：每扣一次扳机一个事件（烟花一轮 8 枚只发 1 个，霰弹 7 粒只发 1 个），
//     接收方在本地重建一枚只看不伤的弹道（或一条曳光线）；伤害只由开火方算，不重复算。
//   - 伤害事件 hits/{受害uid}/{序号}：开火方算命中、写事件，受害方收到后自己扣血（走 hurtPlayer，
//     护甲/坐车分摊/无敌都照旧），每条只算一次；警察打人也一样（房主算命中，写给受害方）。
//   - 路人伤害请求 pdmg/{key}：非房主打镜像行人不直接扣血，改发请求给房主结算，房主算完删掉。
//   - 排行榜 scores/{周一日期}/{名字}：杀手 kills+1、死者 deaths+1（只有受害方记分，不会 double），
//     周键是本周一的日期（芝加哥时间），每周一 00:00 自动换周，旧周数据不删也不显示。
//     排行榜按名字认人：名字释放后别人马上能重用，重用同一个名字就落在同一行、继承它的分（见 plan 文件）。
//   - 全员无敌 godMode/{on,by,t}：单节点共享开关，任何人拨动都影响所有在线玩家；
//     sim.netGod 为 true 时 hurtPlayer 直接返回（所有伤害都走 hurtPlayer，所以是全伤害）；主角座驾也按同一个 godOn 跟着无敌（见 Sim.godOn），无敌关了车照常能被炸。
//   - 离开立即释放：显式离开时先取消 onDisconnect 再删节点（否则旧的断线清理会删掉新玩家刚占的名字）；
//     崩溃/关标签时由服务器的 onDisconnect 删（socket 一断就触发）；10 秒没更新的兜底只清本地列表，不碰库和名字。
//   - 匿名登录的 auth 用户本身不删：只有本人在登录状态下才能删自己的 auth 用户，断线后没人能调；
//     挡住名字重用的只是数据库节点（players/{uid}、names/{名字}），删掉它们就够了；
//     signOut 也不删 auth 用户，同一个标签页重进会恢复同一个 uid。
//   - 击杀播报 feed/{序号}：受害方记分时顺手写一条，所有人弹 toast，只留最近 20 条。
// transport 接口（net-firebase.js / 测试 mock 都实现同一套；返回退订函数的就是订阅）：
//   connect()/disconnect()、claimName(name, uid)/releaseName(name, uid)、armPresence(uid, name)/cancelPresence(uid, name)、armEnv(uid)/cancelEnv(uid)、
//   setPlayer(uid, payload)/removePlayer(uid)/onPlayers(cb)、
//   setBuilding(i, data)/onBuildings(cb)、setVehicle(id, data)/onVehicles(cb)、
//   setEnv(uid, data)/removeEnv(uid)/onEnv(uid, cb)、
//   setGod(data)/onGod(cb)、
//   pushShot(uid, seq, data)/removeShot(uid, seq)/removeShots(uid)/onShots(cb)、
//   sendHit(victimUid, seq, data)/removeHit(uid, seq)/removeHits(uid)/onHits(uid, cb)、
//   sendPdmg(key, data)/removePdmg(key)/onPdmg(cb)、
//   sendVdmg(key, data)/removeVdmg(key)/onVdmg(cb)、sendPtake(key, data)/removePtake(key)/onPtake(cb)、
//   claimMission(id, data)/setMission(id, data)/removeMission(id)/onMissions(cb)、
//   scoreTx(week, name, field)/onScores(week, cb)、pushFeed(key, data)/removeFeed(key)/onFeed(cb)。
// onShots/onPdmg/onVdmg/onPtake/onFeed 是“新孩子”式订阅（cb 收到每一条新增，订阅时也会把已有的重放一遍，
// 所以 Net 收到后要按序号/时间去重、丢掉过期事件）；onPlayers/onBuildings/onVehicles/onEnv/onScores
// 是“整个节点”式订阅（cb 收到整个节点的当前值）。
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** 名字合法性：1~20 个字，去掉前后空格；不能含 Firebase 路径里非法的字符 */
export function validName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, reason: '名字不能为空' };
  if (name.length > 20) return { ok: false, reason: '名字不能超过 20 个字' };
  if (/[/.#$\[\]]/.test(name)) return { ok: false, reason: '名字里不能有 / . # $ [ ]' };
  return { ok: true, name };
}

/** 固定载具的同步键：fixed-序号（序号是 fixedSpawns 里的下标，两边同一张地图所以对得上） */
export function vehicleKey(sim) {
  const v = sim.player.inVeh;
  if (!v || !v.fixed) return '';
  const i = sim.fixedSpawns.findIndex((f) => f.v === v);
  return i < 0 ? '' : `fixed-${i}`;
}

/** 玩家同步包：每 125ms（动的时候）或 1 秒（站着不动的心跳）发一次。取整到 2 位小数，省流量 */
export function playerPayload(sim, name, now = Date.now()) {
  const p = sim.player;
  return {
    name, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
    hp: Math.max(0, Math.round(p.hp)), money: p.money, weapon: p.weapon,
    vehicle: vehicleKey(sim), stars: sim.stars, dead: !!p.dead, run: p.running ? 1 : 0, updatedAt: now,
  };
}

/**
 * 排行榜的周键：本周一的日期（YYYY-MM-DD），按美国芝加哥的墙钟算。
 * 所有客户端同一时刻算出同一个周一；每周一 00:00 芝加哥时间自动换周。
 * 纯函数，测试直接调（星期天算回上周一，星期一算当天）。
 */
export function weekKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => +parts.find((p) => p.type === t).value;
  const y = get('year'), m = get('month') - 1, d = get('day');
  const wd = new Date(Date.UTC(y, m, d)).getUTCDay();   // 0=周日；周日要回退 6 天到周一
  return new Date(Date.UTC(y, m, d - ((wd + 6) % 7))).toISOString().slice(0, 10);
}

export class Net {
  /** @param {import('./sim.js').Sim} sim @param {object} transport @param {object} [opts] @param {(ev)=>void} [opts.onEvent] */
  constructor(sim, transport, opts = {}) {
    this.sim = sim; this.t = transport;
    this.onEvent = opts.onEvent || (() => {});
    this.status = 'offline';   // offline | online | failed
    this.uid = ''; this.name = '';
    this.remotePlayers = new Map();   // uid -> 玩家同步包（带 px/py/pz 给渲染插值，seenAt 给掉线兜底）
    this.pubAcc = 0; this.lastPlayerPub = null;
    this.lastSeen = 0;
    this.dirtyBuildings = new Set();
    this.lastVehPub = new Map();
    this.unsubs = [];
    // ---- v2：房主与事件 ----
    this.isHost = false; this.hostUid = null;
    this.lastEnvPub = 0; this.unsubEnv = null; this.unsubPdmg = null; this.unsubScores = null;
    this.lastShotSeq = 0;                  // 自己发出去的开火序号（单调递增）
    this.lastShotSeqByUid = new Map();     // 每个远端玩家最后收到的开火序号（去重用）
    this.lastHitSeq = 0;                   // 自己收件箱里最后处理过的伤害序号
    this.lastHitSeqOut = 0;                // 自己发出去的伤害序号（单调递增）
    this.scores = new Map();               // 名字 -> {kills, deaths}（本周）
    this.scoresWeek = '';
    this.lastWeekCheck = 0;
    this.god = false; this.godBy = '';      // 全员无敌共享开关（godMode 节点，见 setGod）
    this.feedKeys = [];                    // 收到的击杀播报键（按到达顺序，超过 20 条就删最旧的）
    // ---- v2：任务 ----
    this.missionStates = new Map();        // 任务 id -> 共享节点（by/byName/state/cp/left/text/t/vehicle/targets）
    this.myClaimedMissions = new Set();    // 我抢到手、还没结束的任务 id（离开时放掉）
    this.unsubMissions = null;
    this.lastMissionPub = 0;               // 上次发任务进度的墙钟时间（1 秒一发，顺便当心跳保住 claim）
    this.lastMissionPubData = '';          // 上次发的进度全文（没变就不重复写）
    this.lastMissionPubDiscrete = '';      // 上次发的离散进度（检查点/剩余数，变了马上发）
  }

  /** 加入联机。join 失败不碰游戏状态（sim.net 还是 null），Hud 会把 net 对象丢掉 */
  async join(rawName) {
    const v = validName(rawName);
    if (!v.ok) return { ok: false, reason: 'badname', message: v.reason };
    let uid;
    try { uid = await this.t.connect(); }
    catch (e) { this.status = 'failed'; console.error('[net] connect failed', e); return { ok: false, reason: 'offline', message: '连不上联机服务器，单机继续玩' }; }
    this.uid = uid; this.name = v.name;
    const ok = await this.t.claimName(v.name, uid);
    if (!ok) { this.status = 'offline'; await this.t.disconnect(); return { ok: false, reason: 'taken', message: '这个名字有人在用了，换一个' }; }
    // 掉线自动清理：玩家节点、名字节点、环境快照都由服务器在断线时删掉
    try { await this.t.armPresence(uid, v.name); await this.t.armEnv(uid); } catch { /* 旧版 transport 没有 armEnv 就跳过，leave 时再删 */ }
    await this.t.setPlayer(uid, playerPayload(this.sim, v.name));
    this.unsubs.push(this.t.onPlayers((all) => this._onPlayers(all || {})));
    this.unsubs.push(this.t.onBuildings((all) => this._onBuildings(all || {})));
    this.unsubs.push(this.t.onVehicles((all) => this._onVehicles(all || {})));
    this.unsubs.push(this.t.onShots((u, seq, data) => this._onShot(u, seq, data)));
    this.unsubs.push(this.t.onHits(uid, (seq, data) => this._onHit(seq, data)));
    // 注意：onPdmg 不在这里订，房主才收（applyHostState 里订）；两边都订会让房主把同一份伤害算两遍
    this.unsubs.push(this.t.onFeed((key, data) => this._onFeed(key, data)));
    this.unsubMissions = this.t.onMissions((all) => this._onMissions(all || {}));
    this.unsubs.push(this.t.onGod((data) => this._onGod(data || null)));
    this.subscribeScores(weekKey());
    this.status = 'online';
    this.pubAcc = 0; this.lastPlayerPub = null; this.lastSeen = Date.now();
    this.recomputeHost();   // 刚加入就定一次房主（订阅 players 时 _onPlayers 里也会再算一遍）
    // 刚加入当非房主时 recomputeHost 不触发 setHost（房主没变），但本地加入前刷的交通车/路人必须清掉，
    // 所以这里显式调一次（setHost(false) 是幂等的，重复调没事）
    this.sim.setHost(this.isHost);
    this.publish();
    return { ok: true };
  }

  /** 每帧调（Hud 的主循环里）：发自己的位置、冲脏建筑/载具、房主发环境快照、周一切换检查 */
  update(dt) {
    if (this.status !== 'online') return;
    const now = Date.now();
    this.pubAcc += dt;   // 发包节流用“游戏时间”累计（和 v1 一样）：测试里 dt 是模拟的，墙钟节流会让测试发不出去
    // 超过 10 秒没更新的远端玩家当掉线（onDisconnect 正常会清掉，这是兜底）；每帧都扫一遍，玩家数很少，不用节流
    for (const [uid, rp] of this.remotePlayers) {
      if (now - rp.updatedAt > 10000) { this.remotePlayers.delete(uid); this.onEvent({ type: 'playerLeave', name: rp.name }); }
    }
    this.publish();
    this.flushBuildings();
    this.flushVehicles();
    this.publishMissionProgress();   // 任务进度 1 秒一发（publishMissionProgress 里自己节流，没做任务就不发）
    if (this.isHost && now - this.lastEnvPub > 500) { this.lastEnvPub = now; this.publishEnv(); }
    if (now - this.lastWeekCheck > 5000) { this.lastWeekCheck = now; if (weekKey() !== this.scoresWeek) this.subscribeScores(weekKey()); }
  }

  /** 房主：把环境快照写到 env/{uid}（平民/警察/追捕警车，2Hz） */
  publishEnv() {
    if (!this.isHost || this.status !== 'online') return;
    this.t.setEnv(this.uid, this.sim.publishEnvSnapshot()).catch((e) => this.syncError('env', e));
  }

  /** 房主重算：uid 最小的在线玩家当房主。玩家加入/离开、自己加入时都调。 */
  recomputeHost() {
    if (this.status !== 'online') return;
    const hostUid = [this.uid, ...this.remotePlayers.keys()].sort()[0];
    const hostChanged = hostUid !== this.hostUid;
    const wasHost = this.isHost;
    this.hostUid = hostUid;
    this.isHost = hostUid === this.uid;
    if (hostChanged || this.isHost !== wasHost) this.applyHostState();
    if (this.isHost !== wasHost) {
      this.sim.setHost(this.isHost);
      this.onEvent({ type: 'hostChange', isHost: this.isHost, hostUid });
    }
  }

  /** 按是不是房主，订阅该订阅的东西：房主收路人/车辆伤害请求和领取请求、不收环境快照；非房主反过来 */
  applyHostState() {
    if (this.isHost) { this.unsubscribeEnv(); this.subscribePdmg(); this.subscribeVdmg(); this.subscribePtake(); }
    else { this.unsubscribePdmg(); this.unsubscribeVdmg(); this.unsubscribePtake(); this.subscribeEnv(this.hostUid); }
  }
  subscribeEnv(uid) {
    this.unsubscribeEnv();
    if (!uid || uid === this.uid) return;
    this.unsubEnv = this.t.onEnv(uid, (data) => { if (this.isHost || !data) return; this.sim.applyEnvSnapshot(data); });
  }
  unsubscribeEnv() { if (this.unsubEnv) { this.unsubEnv(); this.unsubEnv = null; } }
  subscribePdmg() {
    this.unsubscribePdmg();
    this.unsubPdmg = this.t.onPdmg((key, data) => this._onPdmg(key, data));
  }
  unsubscribePdmg() { if (this.unsubPdmg) { this.unsubPdmg(); this.unsubPdmg = null; } }
  subscribeVdmg() {
    this.unsubscribeVdmg();
    this.unsubVdmg = this.t.onVdmg((key, data) => this._onVdmg(key, data));
  }
  unsubscribeVdmg() { if (this.unsubVdmg) { this.unsubVdmg(); this.unsubVdmg = null; } }
  subscribePtake() {
    this.unsubscribePtake();
    this.unsubPtake = this.t.onPtake((key, data) => this._onPtake(key, data));
  }
  unsubscribePtake() { if (this.unsubPtake) { this.unsubPtake(); this.unsubPtake = null; } }
  subscribeScores(week) {
    if (this.unsubScores) { this.unsubScores(); this.unsubScores = null; }
    this.scoresWeek = week;
    this.unsubScores = this.t.onScores(week, (all) => this._onScores(all || {}));
  }

  /** 离开联机：清掉自己的节点（玩家、名字、环境快照、开火、收件箱），退订，sim 回单机 */
  async leave() {
    const uid = this.uid, name = this.name;
    for (const u of this.unsubs) { try { u(); } catch { /* 忽略 */ } }
    this.unsubs = [];
    this.unsubscribeEnv(); this.unsubscribePdmg(); this.unsubscribeVdmg(); this.unsubscribePtake();
    if (this.unsubScores) { this.unsubScores(); this.unsubScores = null; }
    if (this.unsubMissions) { this.unsubMissions(); this.unsubMissions = null; }
    // 离开时把我手里的任务放掉（别人马上能抢；不断线清理靠 claim 的 20 秒过期兜底）
    for (const id of this.myClaimedMissions) this.t.removeMission(id).catch(() => {});
    this.myClaimedMissions.clear();
    this.missionStates.clear();
    this.isHost = false; this.hostUid = null;
    this.god = false; this.godBy = '';
    this.remotePlayers.clear();
    this.status = 'offline';
    if (uid) {
      this.sim.goOffline();   // 镜像行人/警车转回本地，单机继续玩（也清掉 netGod）
      // 先取消断线清理，再删节点：不取消的话，我这边的旧 onDisconnect 还挂在服务器上，
      // 我关标签页时它会把 names/{名字} 删掉——如果这名字已经被新玩家占了，就把别人的名字偷删了。
      // 取消本身也可能失败（已经断了），失败就忽略，反正节点马上就显式删掉。
      try { await this.t.cancelPresence?.(uid, name); } catch { /* 忽略 */ }
      try { await this.t.cancelEnv?.(uid); } catch { /* 忽略 */ }
      const jobs = [this.t.removePlayer(uid), this.t.removeEnv(uid), this.t.removeShots(uid), this.t.removeHits(uid)];
      if (name) jobs.push(this.t.releaseName(name, uid));
      await Promise.all(jobs.map((p) => p.catch(() => {})));
      try { await this.t.disconnect(); } catch { /* 已经掉了就不用管 */ }
    }
    this.uid = ''; this.name = '';
  }

  /* ------------------------------------------------------------ 发自己的状态 */

  /** 位置：动了就 8Hz 发（游戏时间累计 0.125 秒），站着不动 1 秒发一次心跳；血量、钱、武器、通缉星、跑步变了就马上发 */
  publish() {
    if (this.status !== 'online') return;
    const now = Date.now(), p = playerPayload(this.sim, this.name, now);
    const last = this.lastPlayerPub;
    const moved = !last || Math.abs(p.x - last.x) > 0.05 || Math.abs(p.y - last.y) > 0.05 || Math.abs(p.z - last.z) > 0.05 || Math.abs(p.yaw - last.yaw) > 0.02;
    const changed = !last || p.hp !== last.hp || p.money !== last.money || p.weapon !== last.weapon || p.vehicle !== last.vehicle || p.stars !== last.stars || p.dead !== last.dead || p.run !== last.run;
    if (!last || (moved && this.pubAcc >= 0.125) || changed || this.pubAcc >= 1) {
      this.pubAcc = 0;
      this.lastPlayerPub = p;
      this.t.setPlayer(this.uid, p).catch((e) => this.syncError('players', e));
    }
  }

  /** 本地建筑状态变了（sim.damageBuilding 里调）：先记下来，下一轮发布时一起写 */
  onBuildingChanged(b) { if (this.status === 'online') this.dirtyBuildings.add(b); }

  flushBuildings() {
    if (!this.dirtyBuildings.size) return;
    const bs = this.sim.world.buildings;
    for (const b of this.dirtyBuildings) {
      const i = bs.indexOf(b);
      if (i < 0) continue;
      this.t.setBuilding(i, { hp: Math.max(0, Math.round(b.hp)), destroyed: !!b.destroyed })
        .catch((e) => this.syncError('buildings', e));
    }
    this.dirtyBuildings.clear();
  }

  /** 固定载具：动了（位置/血量/司机变了）或 1 秒心跳到了才写，非固定车（交通车、警车）不同步 */
  flushVehicles() {
    const now = Date.now();
    this.sim.fixedSpawns.forEach((f, i) => {
      const v = f.v;
      if (!v) return;
      const key = fixedKey(i);
      const data = {
        type: v.type, x: r2(v.x), y: r2(v.y), z: r2(v.z), yaw: r2(v.yaw),
        hp: Math.max(0, Math.round(v.hp)),
        driver: v.driver === 'player' ? this.uid : (typeof v.driver === 'string' ? v.driver : ''),
      };
      const last = this.lastVehPub.get(key);
      const changed = !last || Math.abs(data.x - last.x) > 0.5 || Math.abs(data.y - last.y) > 0.5 || Math.abs(data.z - last.z) > 0.5 ||
        Math.abs(data.yaw - last.yaw) > 0.05 || data.hp !== last.hp || data.driver !== last.driver;
      if (changed || !last || now - last.t > 1000) {
        this.lastVehPub.set(key, { ...data, t: now });
        this.t.setVehicle(key, data).catch((e) => this.syncError('vehicles', e));
      }
    });
  }

  syncError(what, e) {
    console.error('[net] sync failed:', what, e && (e.code || e.message || e));
    this.onEvent({ type: 'syncBlocked', what });
  }

  /* ------------------------------------------------------------ 开火 / 伤害 / 记分（v2） */

  /**
   * 发一个开火事件（sim.shoot 里、playerAttack 的 hitscan 末尾调；fireworks 只调一次）。
   * o：{kind, x, y, z, dx, dy, dz, speed, radius, range, hx?, hy?, hz?}，
   * 其中 (x,y,z) 是枪口/发射点，(hx,hy,hz) 是 hitscan 的命中点（飞行物不用填），
   * range 是 Infinity 时写 0，接收方看到 0 就当无限。
   * 序号单调递增，写完删掉 10 发以前的旧事件，节点不积压。
   */
  sendShot(o) {
    if (this.status !== 'online') return;
    const seq = ++this.lastShotSeq;
    const data = {
      kind: o.kind, x: r2(o.x), y: r2(o.y), z: r2(o.z),
      dx: r3(o.dx || 0), dy: r3(o.dy || 0), dz: r3(o.dz || 0),
      speed: o.speed || 0, radius: o.radius || 0,
      range: o.range === Infinity || !o.range ? 0 : Math.round(o.range),
      hx: o.hx !== undefined ? r2(o.hx) : 0, hy: o.hy !== undefined ? r2(o.hy) : 0, hz: o.hz !== undefined ? r2(o.hz) : 0,
      t: Date.now(),
    };
    this.t.pushShot(this.uid, seq, data).catch((e) => this.syncError('shots', e));
    if (seq > 10) this.t.removeShot(this.uid, seq - 10).catch(() => {});
  }

  /** 收到别人的开火事件：本地重建一枚只看不伤的弹道（或一条曳光线），伤害不由这里算 */
  _onShot(uid, seq, data) {
    if (uid === this.uid || !data || typeof data.kind !== 'string') return;
    const seen = this.lastShotSeqByUid.get(uid) || 0;
    if (seq <= seen) return;   // 订阅重放的旧事件：丢掉
    this.lastShotSeqByUid.set(uid, seq);
    if (Date.now() - (data.t || 0) > 5000) return;   // 过期事件（刚加入时重放的旧开火）：不再放
    if (this.isHost) this.sim.noise(data.x, data.z, 45);   // 房主：枪声吓跑附近的路人（和本地开枪一致）
    if (data.kind === 'fireworks') {
      // 烟花一轮 8 枚只发 1 个事件：接收方按事件方向展开同样的 8 枚
      const base = Math.atan2(data.dx || 0, data.dz || 1);
      for (let k = 0; k < 8; k++) {
        const a = base + (k * Math.PI) / 4;
        this.sim.shoot({ x: data.x + Math.sin(a) * 0.8, y: data.y, z: data.z + Math.cos(a) * 0.8, dx: Math.sin(a), dy: 0.02, dz: Math.cos(a), speed: data.speed || 55, range: Infinity, radius: data.radius || 7, dmg: 0, byPlayer: false, kind: 'fireworks', owner: null, remote: true });
      }
      return;
    }
    if (data.speed > 0) {
      // 飞行物（火箭、炮弹）：本地重建一枚只看不伤的弹道，飞到头只放画面不扣血
      this.sim.shoot({ x: data.x, y: data.y, z: data.z, dx: data.dx, dy: data.dy, dz: data.dz, speed: data.speed, range: data.range > 0 ? data.range : Infinity, radius: data.radius || 6, dmg: 0, byPlayer: false, kind: data.kind, owner: null, remote: true });
    } else {
      // 即时命中（手枪/冲锋枪/霰弹/警察开枪）：画一条曳光线到命中点
      this.sim.emit({ type: 'tracer', x1: data.x, y1: data.y, z1: data.z, x2: data.hx, y2: data.hy, z2: data.hz, hit: true, mine: false });
    }
  }

  /**
   * 发一个伤害事件：开火方算命中后调（hitscan 打中远端玩家、爆炸波及远端玩家、警察打中远端玩家、近战打中远端玩家）。
   * src：'pvp'（玩家打的）或 'cop'（警察打的）；只有 src='pvp' 且致死才记分。
   */
  sendHit(victimUid, dmg, src, weapon) {
    if (this.status !== 'online' || !victimUid || victimUid === this.uid) return;
    const seq = ++this.lastHitSeqOut;
    this.t.sendHit(victimUid, seq, { from: this.uid, fromName: this.name, dmg: Math.max(0, Math.round(dmg)), src, weapon: weapon || '', t: Date.now() })
      .catch((e) => this.syncError('hits', e));
  }

  /** 收到打向自己的伤害事件：先删再算（避免重连后重复扣血），走 hurtPlayer（护甲/坐车分摊/无敌都照旧） */
  _onHit(seq, data) {
    if (!data || typeof data.dmg !== 'number') return;
    if (seq <= this.lastHitSeq) { this.t.removeHit(this.uid, seq).catch(() => {}); return; }
    this.lastHitSeq = seq;
    this.t.removeHit(this.uid, seq).catch(() => {});
    if (Date.now() - (data.t || 0) > 10000) return;   // 过期伤害（人可能已经复活了）：不再扣
    const p = this.sim.player;
    if (p.dead) return;
    this.sim.hurtPlayer(data.dmg);
    if (p.dead && data.src === 'pvp') {
      p.pvpDeath = true;   // PvP 死：复活不扣医药费、钱留着、通缉不变（见 sim.respawn）
      this.recordKill(data.fromName || '？', this.name);
    }
  }

  /** 非房主打镜像行人：不直接扣血，发伤害请求给房主结算（房主算完删掉） */
  requestPedDamage(o, dmg, fromX, fromZ) {
    if (this.status !== 'online' || !o.netId) return;
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.t.sendPdmg(key, { by: this.uid, id: o.netId, dmg: Math.max(0, Math.round(dmg)), fromX: r2(fromX ?? o.x), fromZ: r2(fromZ ?? o.z), t: Date.now() })
      .catch((e) => this.syncError('pdmg', e));
  }

  /** 非房主捡镜像拾取物：发领取请求给房主（房主批了、快照里 by 是我，效果才生效） */
  requestTake(key) {
    if (this.status !== 'online' || !key) return;
    const reqKey = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.t.sendPtake(reqKey, { by: this.uid, key, t: Date.now() })
      .catch((e) => this.syncError('ptake', e));
  }

  /** 任务：抢一个任务（transaction，原子）。没人做、已完成、或超过 20 秒没心跳（抢的人掉了）才能抢到。 */
  async claimMission(id) {
    if (this.status !== 'online') return false;
    const def = this.sim.missions.list.find((m) => m.id === id);
    if (!def) return false;
    const left = def.type === 'kill' ? (def.foes ? def.foes.length : 0) + (def.guards ? def.guards.length : 0)
      : def.type === 'destroy' ? def.count
      : def.cps ? def.cps.length : 0;
    const data = { by: this.uid, byName: this.name, state: 'active', cp: 0, left, text: '', t: Date.now() };
    let ok = false;
    try { ok = await this.t.claimMission(id, data); } catch (e) { this.syncError('missions', e); return false; }
    if (ok) this.myClaimedMissions.add(id);
    return ok;
  }

  /** 任务：把进度写回共享节点（抢到任务的人发，顺便当心跳；只有手里还有 claim 才发）。
   * 检查点/剩余数变了马上发（别人要及时看到进度）；载具位置只 1 秒发一次（不然每帧都写库）；没变 5 秒发一次心跳。 */
  publishMissionProgress() {
    if (this.status !== 'online') return;
    const prog = this.sim.missionProgress();
    const a = this.sim.missions.active;
    if (!prog || !a) return;
    const id = a.def.id;
    const st = this.missionStates.get(id);
    if (st && st.by && st.by !== this.uid) return;   // 共享节点说任务是别人的了，我不发（本地任务继续玩，只是不对外同步）
    const vehicle = prog.vehicle ? { ...prog.vehicle, driver: this.uid } : null;
    const data = { by: this.uid, byName: this.name, state: 'active', cp: prog.cp, left: prog.left, text: prog.text, t: Date.now(), vehicle, targets: prog.targets };
    const now = Date.now();
    const discrete = id + '|' + prog.cp + '|' + prog.left;   // 检查点/剩余数（离散变化，马上发）
    const discreteChanged = discrete !== this.lastMissionPubDiscrete;
    if (!discreteChanged && now - this.lastMissionPub < 1000) return;   // 没变，等 1 秒节流
    if (!discreteChanged && this.lastMissionPubData === JSON.stringify(data) && now - this.lastMissionPub < 5000) return;   // 全都没变，5 秒心跳
    this.lastMissionPub = now; this.lastMissionPubDiscrete = discrete; this.lastMissionPubData = JSON.stringify(data);
    this.t.setMission(id, data).catch((e) => this.syncError('missions', e));
  }

  /** 任务：完成（节点留着，state 变成 done，别人能看到是谁完成的、可以再抢着重玩）。 */
  setMissionDone(id) {
    if (this.status !== 'online') return;
    this.myClaimedMissions.delete(id);
    const def = this.sim.missions.list.find((m) => m.id === id);
    this.t.setMission(id, { by: this.uid, byName: this.name, state: 'done', cp: def && def.cps ? def.cps.length : 0, left: 0, text: '已完成', t: Date.now(), vehicle: null, targets: null })
      .catch((e) => this.syncError('missions', e));
  }

  /** 任务：放掉（失败、走远、离开时调；节点删掉，别人马上能抢）。 */
  releaseMission(id) {
    if (this.status !== 'online') return;
    this.myClaimedMissions.delete(id);
    this.t.removeMission(id).catch((e) => this.syncError('missions', e));
  }

  /** 任务节点变了：更新本地的共享状态；别人任务的载具和靶车镜像跟上；任务没了就清掉镜像。 */
  _onMissions(all) {
    const prev = this.missionStates;
    this.missionStates = new Map(Object.entries(all || {}));
    for (const [id, st] of this.missionStates) {
      if (!st || st.state !== 'active') {
        this.sim.removeRemoteMissionVehicle(id);
        this.sim.missions.clearRemoteTargets(id);
        continue;
      }
      if (st.by === this.uid) continue;   // 自己的任务：载具和靶车本来就在本地，不用镜像
      const def = this.sim.missions.list.find((m) => m.id === id);
      if (!def) continue;
      if (st.vehicle) this.sim.applyRemoteMissionVehicle(id, st.vehicle);
      else this.sim.removeRemoteMissionVehicle(id);
      if (def.type === 'destroy') this.sim.missions.syncRemoteTargets(def, st.targets);
    }
    for (const id of prev.keys()) {
      if (!this.missionStates.has(id)) { this.sim.removeRemoteMissionVehicle(id); this.sim.missions.clearRemoteTargets(id); }
    }
    this.onEvent({ type: 'missions' });
  }

  /** 房主收到领取请求：先删再算，只结算一次；拾取物没了或在重生就不批（请求方等超时后重试） */
  _onPtake(reqKey, data) {
    if (!this.isHost || !data || typeof data.key !== 'string' || typeof data.by !== 'string') return;
    this.t.removePtake(reqKey).catch(() => {});
    if (Date.now() - (data.t || 0) > 10000) return;   // 过期请求：不再结算
    this.sim.applyTake(data.key, data.by);
  }

  /** 房主收到路人伤害请求：先删再算，只结算一次；byPlayer=false，房主这边不记犯罪（请求方自己记过了） */
  _onPdmg(key, data) {
    if (!this.isHost || !data || typeof data.id !== 'number' || typeof data.dmg !== 'number') return;
    this.t.removePdmg(key).catch(() => {});
    if (Date.now() - (data.t || 0) > 10000) return;   // 过期请求：不再结算
    const o = this.sim.peds.find((q) => q.netId === data.id && q.alive);
    if (!o) return;
    this.sim.hurtPed(o, data.dmg, false, data.fromX, data.fromZ);
  }

  /** 非房主打镜像车（交通车/警车）：不直接扣血，发伤害请求给房主结算（房主算完删掉） */
  requestVehicleDamage(v, dmg) {
    if (this.status !== 'online' || !v.netId) return;
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.t.sendVdmg(key, { by: this.uid, id: v.netId, dmg: Math.max(0, Math.round(dmg)), t: Date.now() })
      .catch((e) => this.syncError('vdmg', e));
  }

  /** 房主收到车辆伤害请求：先删再算，只结算一次；byPlayer=false，房主这边不记犯罪（请求方自己记过了） */
  _onVdmg(key, data) {
    if (!this.isHost || !data || typeof data.id !== 'number' || typeof data.dmg !== 'number') return;
    this.t.removeVdmg(key).catch(() => {});
    if (Date.now() - (data.t || 0) > 10000) return;   // 过期请求：不再结算
    const v = this.sim.vehicles.find((q) => q.netId === data.id && q.alive && q.ai && (q.ai.kind === 'chase' || q.ai.kind === 'traffic'));
    if (!v) return;
    v.damage(data.dmg, false);
  }

  /**
   * 记分（只有受害方调一次，不会 double）：杀手 kills+1、死者 deaths+1，顺手写一条击杀播报。
   * 名字是唯一身份（匿名登录没有稳定的个人 id），别人顶同一个名字会继承这个名字的分，见 README。
   */
  recordKill(killerName, victimName) {
    const week = weekKey();
    this.t.scoreTx(week, killerName, 'kills').catch((e) => this.syncError('scores', e));
    if (victimName !== killerName) this.t.scoreTx(week, victimName, 'deaths').catch((e) => this.syncError('scores', e));
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.t.pushFeed(key, { killer: killerName, victim: victimName, t: Date.now() }).catch((e) => this.syncError('feed', e));
  }

  _onScores(all) {
    this.scores = new Map(Object.entries(all || {}).map(([name, v]) => [name, { kills: (v && v.kills) | 0, deaths: (v && v.deaths) | 0 }]));
    this.onEvent({ type: 'scores' });
  }

  /**
   * 全员无敌共享开关：任何人拨动都影响所有在线玩家（包括拨的人自己）。
   * 写 godMode 单节点 {on, by, t}；所有客户端收到后把 sim.netGod 置成 on，
   * hurtPlayer 直接返回（所有伤害都走 hurtPlayer，所以是全伤害、只保人不保车）。
   */
  setGod(on) {
    if (this.status !== 'online') return;
    this.t.setGod({ on: !!on, by: this.name, t: Date.now() }).catch((e) => this.syncError('godMode', e));
  }

  _onGod(data) {
    const on = !!(data && data.on);
    const by = (data && data.by) || '';
    if (on === this.god && by === this.godBy) return;
    this.god = on; this.godBy = by;
    this.sim.netGod = on;
    this.onEvent({ type: 'godChange', on, by });
  }

  /** 击杀播报：只留最近 20 条（多出来的最旧的删掉，各客户端删同一批，删重了也没事） */
  _onFeed(key, data) {
    if (!data || typeof data.killer !== 'string' || typeof data.victim !== 'string') return;
    this.feedKeys.push(key);
    if (this.feedKeys.length > 20) { const old = this.feedKeys.shift(); this.t.removeFeed(old).catch(() => {}); }
    if (Date.now() - (data.t || 0) > 30000) return;   // 刚加入时重放的旧播报：不弹 toast
    this.onEvent({ type: 'killFeed', killer: data.killer, victim: data.victim });
  }

  /* ------------------------------------------------------------ 收到远端状态 */

  _onPlayers(all) {
    const seen = new Set();
    for (const uid in all) {
      if (uid === this.uid) continue;   // 自己的回声不要
      const d = all[uid];
      if (!d || typeof d.x !== 'number' || typeof d.name !== 'string') continue;
      seen.add(uid);
      const prev = this.remotePlayers.get(uid);
      if (prev) {
        // 估算移动速度（警察瞄准、警车追捕用）：两次位置之间的位移除以间隔，抖动大时取上限 30
        const dt = Math.max(0.05, (Date.now() - (prev.seenAt || Date.now())) / 1000);
        const sp = Math.min(30, Math.hypot(d.x - prev.x, d.z - prev.z) / dt);
        prev.px = prev.x; prev.py = prev.y; prev.pz = prev.z;   // 留上一帧位置给渲染插值
        Object.assign(prev, d);
        prev.speed = sp;
        prev.seenAt = Date.now();
      } else {
        this.remotePlayers.set(uid, { ...d, px: d.x, py: d.y, pz: d.z, seenAt: Date.now() });
        this.onEvent({ type: 'playerJoin', name: d.name });
      }
    }
    for (const [uid, rp] of this.remotePlayers) {
      if (!seen.has(uid)) { this.remotePlayers.delete(uid); this.onEvent({ type: 'playerLeave', name: rp.name }); }
    }
    this.recomputeHost();   // 有人加入/离开就重算房主
  }

  _onBuildings(all) {
    for (const k in all) {
      const i = Number(k);
      if (!Number.isInteger(i)) continue;
      const d = all[k];
      if (!d || typeof d.hp !== 'number' || typeof d.destroyed !== 'boolean') continue;
      this.sim.applyRemoteBuilding(i, d.hp, d.destroyed);
    }
  }

  _onVehicles(all) {
    for (const k in all) this.sim.applyRemoteVehicle(k, all[k]);
  }
}

/** 固定载具的同步键（Net 内部用）：fixed-序号 */
function fixedKey(i) { return `fixed-${i}`; }
