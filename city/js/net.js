// 落日湾联机：纯逻辑 + 联机状态机。不依赖 Firebase SDK（也不 import 它），
// 所以 Node 逻辑测试可以直接 import；真正的数据库访问由 transport 注入。
// transport 接口（见 net-firebase.js 的实现，测试用内存 mock 实现同一套）：
//   connect() -> uid；claimName(name, uid) -> bool；releaseName(name, uid)
//   armPresence(uid, name)；setPlayer(uid, payload)；removePlayer(uid)；onPlayers(cb) -> 取消订阅
//   setBuilding(index, {hp, destroyed})；onBuildings(cb) -> 取消订阅
//   setVehicle(id, data)；onVehicles(cb) -> 取消订阅
//   disconnect()
// 玩家节点 payload：{name, x, y, z, yaw, hp, money, weapon, vehicle, updatedAt}，
// vehicle 是所在固定载具的键（fixed-序号），步行或开非固定车时为空字符串。

/** 名字校验：数据库键里不能有 / . # $ [ ]，长度 1~20 */
export function validName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: '名字要是文字' };
  const name = raw.trim();
  if (!name) return { ok: false, reason: '名字不能为空' };
  if (name.length > 20) return { ok: false, reason: '名字最多 20 个字' };
  if (/[/.#$\[\]]/.test(name)) return { ok: false, reason: '名字里不能有 / . # $ [ ]' };
  return { ok: true, name };
}

/** 固定载具的同步键：fixedSpawns 数组下标，重启也不会变 */
export function fixedKey(i) { return 'fixed-' + i; }

const r2 = (n) => Math.round(n * 100) / 100;

/** 本玩家这辆车在不在固定载具里 */
export function vehicleKey(sim) {
  const v = sim.player.inVeh;
  if (!v) return '';
  const i = sim.fixedSpawns.findIndex((f) => f.v === v);
  return i < 0 ? '' : fixedKey(i);
}

/** 自己的玩家节点 payload（数值取整到 2 位小数，省流量也免得浮点抖动误判“动了”） */
export function playerPayload(sim, name, nowMs) {
  const p = sim.player;
  return {
    name, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
    hp: Math.max(0, Math.ceil(p.hp)), money: p.money, weapon: p.weapon,
    vehicle: vehicleKey(sim), updatedAt: nowMs,
  };
}

const PUB_EVERY = 0.125;      // 位置有变化时 8Hz 广播
const HEARTBEAT = 1;          // 没动也每秒报一次（让别人知道你还在线、钱数也同步）
const STALE_MS = 10000;       // 远端玩家多久没更新就当掉线

export class Net {
  /**
   * @param {import('./sim.js').Sim} sim
   * @param {object} transport 见文件头接口
   * @param {{onEvent:(ev:object)=>void}} [opts] onEvent 事件：playerJoin/playerLeave/syncBlocked
   */
  constructor(sim, transport, opts = {}) {
    this.sim = sim; this.t = transport; this.transport = transport;
    this.onEvent = opts.onEvent || (() => {});
    this.status = 'offline';   // offline | connecting | online | failed
    this.uid = null; this.name = null;
    this.remotePlayers = new Map();   // uid -> {name,x,y,z,px,py,pz,yaw,hp,money,weapon,vehicle,updatedAt,seenAt}
    this.dirtyBuildings = new Set();
    this.pubT = 0; this.lastPub = null; this.lastVehPub = new Map();
    this.unsubs = [];
  }

  /* ------------------------------------------------------------ 加入 / 离开 */

  /** 加入联机。返回 {ok:true} 或 {ok:false, reason}（taken=重名，badname=名字不合法，offline=连不上） */
  async join(rawName) {
    if (this.status === 'online') return { ok: true };
    const v = validName(rawName);
    if (!v.ok) return { ok: false, reason: 'badname', message: v.reason };
    this.status = 'connecting';
    let uid;
    try { uid = await this.t.connect(); }
    catch (e) { this.status = 'failed'; console.error('[net] connect failed', e); return { ok: false, reason: 'offline', message: '连不上联机服务器，单机继续玩' }; }
    let claimed = false, claimErr = null;
    try { claimed = await this.t.claimName(v.name, uid); }
    catch (e) { claimErr = e; console.error('[net] claimName failed', e); }
    if (claimErr) { this.status = 'offline'; try { await this.t.disconnect(); } catch { /* 忽略 */ } return { ok: false, reason: 'offline', message: '占名字时断网了，重试一次' }; }
    if (!claimed) { this.status = 'offline'; try { await this.t.disconnect(); } catch { /* 忽略 */ } return { ok: false, reason: 'taken', message: '这个名字有人用了，换一个名字' }; }
    this.uid = uid; this.name = v.name;
    try {
      await this.t.setPlayer(uid, playerPayload(this.sim, v.name, Date.now()));
      await this.t.armPresence(uid, v.name);
    } catch (e) {
      this.status = 'failed'; console.error('[net] initial publish failed', e);
      try { await this.t.removePlayer(uid); await this.t.releaseName(v.name, uid); await this.t.disconnect(); } catch { /* 忽略 */ }
      return { ok: false, reason: 'offline', message: '联机写入被拒绝了，单机继续玩' };
    }
    this.unsubs = [
      this.t.onPlayers((all) => this._onPlayers(all || {})),
      this.t.onBuildings((all) => this._onBuildings(all || {})),
      this.t.onVehicles((all) => this._onVehicles(all || {})),
    ];
    this.status = 'online';
    this.pubT = 0; this.lastPub = null;
    return { ok: true };
  }

  /** 离开联机：删自己的玩家节点、放名字、退订阅、断开。失败也不抛错 */
  async leave() {
    if (this.status === 'offline' && !this.uid) return;
    const { uid, name } = this;
    this.status = 'offline'; this.uid = null; this.name = null;
    this.remotePlayers.clear();
    for (const u of this.unsubs) { try { u(); } catch { /* 忽略 */ } }
    this.unsubs = [];
    try { if (uid) await this.t.removePlayer(uid); } catch { /* 忽略 */ }
    try { if (name && uid) await this.t.releaseName(name, uid); } catch { /* 忽略 */ }
    try { await this.t.disconnect(); } catch { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 每帧 */

  /** 每渲染帧调用（Hud.update 里调）。只在 online 时干活 */
  update(dt) {
    if (this.status !== 'online') return;
    const now = Date.now();
    this.pubT += dt;
    if (this.pubT >= PUB_EVERY) {
      // 玩家位置：动了或 1 秒心跳到了才发；脏建筑和固定载具每 125ms tick 各自判断（脏了就冲、没变就不写），
      // 不能绑在“玩家动了”上——不然站着不动炸楼，楼塌的状态永远发不出去
      if (this.playerMoved() || this.pubT >= HEARTBEAT) { this.pubT = 0; this.publishPlayer(); }
      this.flushBuildings();
      this.flushVehicles();
    }
    // 超过 10 秒没更新的远端玩家当掉线（onDisconnect 正常会清掉，这是兜底）
    for (const [uid, rp] of this.remotePlayers) {
      if (now - rp.updatedAt > STALE_MS) { this.remotePlayers.delete(uid); this.onEvent({ type: 'playerLeave', name: rp.name }); }
    }
  }

  /* ------------------------------------------------------------ 发布 */

  playerMoved() {
    const p = this.sim.player, l = this.lastPub;
    if (!l) return true;
    return Math.abs(p.x - l.x) > 0.1 || Math.abs(p.y - l.y) > 0.1 || Math.abs(p.z - l.z) > 0.1 ||
      Math.abs(p.yaw - l.yaw) > 0.05 || p.hp !== l.hp || p.money !== l.money ||
      p.weapon !== l.weapon || vehicleKey(this.sim) !== l.vehicle;
  }

  publishPlayer() {
    if (!this.uid) return;
    const payload = playerPayload(this.sim, this.name, Date.now());
    this.lastPub = payload;
    this.t.setPlayer(this.uid, payload).catch((e) => this.syncError('players', e));
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
        prev.px = prev.x; prev.py = prev.y; prev.pz = prev.z;   // 留上一帧位置给渲染插值
        Object.assign(prev, d);
        prev.seenAt = Date.now();
      } else {
        this.remotePlayers.set(uid, { ...d, px: d.x, py: d.y, pz: d.z, seenAt: Date.now() });
        this.onEvent({ type: 'playerJoin', name: d.name });
      }
    }
    for (const [uid, rp] of this.remotePlayers) {
      if (!seen.has(uid)) { this.remotePlayers.delete(uid); this.onEvent({ type: 'playerLeave', name: rp.name }); }
    }
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
