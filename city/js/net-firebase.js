// 落日湾联机：Firebase transport，实现 net.js 文件头的 transport 接口。
// 只在加入联机时才动态 import SDK（CDN），平时单机玩完全不加载；不要在别处 import Firebase。
// 配置只从 city/js/firebase-config.js 读，不复制、不打印。
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/13.4.0';

/** 开火/伤害事件的序号键：补零到 8 位，字典序就是数字序（Firebase 按键的字典序触发 onChildAdded） */
const seqKey = (seq) => String(seq).padStart(8, '0');

/** 建一个 Firebase transport。调用方（Hud）先 await 这个函数，再把结果传给 new Net() */
export async function createFirebaseTransport() {
  const [{ initializeApp }, { getAuth, signInAnonymously, signOut, setPersistence, browserSessionPersistence }, db] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const database = db.getDatabase(app);
  const ref = (p) => db.ref(database, p);

  // 订阅辅助：onValue 回调拿的是快照值（没有就是 null），它本身返回退订函数
  const sub = (path, cb) => db.onValue(ref(path), (snap) => { try { cb(snap.val()); } catch (e) { console.error('[net] listener error', path, e); } });

  return {
    async connect() {
      // 身份只存在这个标签页里（sessionStorage）：同一台电脑开两个标签页就是两个玩家；
      // 同一个标签页刷新后还是同一个人，名字不会丢给自己
      await setPersistence(auth, browserSessionPersistence);
      const cred = await signInAnonymously(auth);
      return cred.user.uid;
    },
    async disconnect() { try { await signOut(auth); } catch { /* 已经掉了就不用管 */ } },

    /** 占名字：transaction，只有没人占或就是自己占的时候才成功 */
    async claimName(name, uid) {
      const r = await db.runTransaction(ref(`names/${name}`), (cur) => {
        if (cur === null || cur === uid) return uid;
        return undefined;   // 有人占着：放弃这次 transaction
      });
      return !!r.committed;
    },
    async releaseName(name, uid) {
      await db.runTransaction(ref(`names/${name}`), (cur) => (cur === uid ? null : undefined));
    },
    /** 掉线自动清理：玩家节点和名字节点都由服务器在断线时删掉 */
    async armPresence(uid, name) {
      await db.onDisconnect(ref(`players/${uid}`)).remove();
      await db.onDisconnect(ref(`names/${name}`)).remove();
    },
    /** 离开时取消断线清理：不取消的话，我关标签页时服务器还会跑旧的清理，
     * 把 names/{名字} 删掉——如果这名字已经被新玩家占了，就把别人的名字偷删了 */
    async cancelPresence(uid, name) {
      await db.onDisconnect(ref(`players/${uid}`)).cancel();
      await db.onDisconnect(ref(`names/${name}`)).cancel();
    },

    async setPlayer(uid, payload) { await db.set(ref(`players/${uid}`), payload); },
    async removePlayer(uid) { await db.remove(ref(`players/${uid}`)); },
    onPlayers: (cb) => sub('players', cb),

    async setBuilding(index, data) { await db.set(ref(`buildings/${index}`), data); },
    onBuildings: (cb) => sub('buildings', cb),

    async setVehicle(id, data) { await db.set(ref(`vehicles/${id}`), data); },
    onVehicles: (cb) => sub('vehicles', cb),

    // ---- v2：环境快照、开火、伤害、排行榜 ----
    /** 掉线自动清理环境快照（和 armPresence 里的玩家/名字节点一样） */
    async armEnv(uid) { await db.onDisconnect(ref(`env/${uid}`)).remove(); },
    /** 离开时取消环境快照的断线清理（和 cancelPresence 一个道理） */
    async cancelEnv(uid) { await db.onDisconnect(ref(`env/${uid}`)).cancel(); },

    async setEnv(uid, data) { await db.set(ref(`env/${uid}`), data); },
    async removeEnv(uid) { await db.remove(ref(`env/${uid}`)); },
    onEnv: (uid, cb) => sub(`env/${uid}`, cb),

    async pushShot(uid, seq, data) { await db.set(ref(`shots/${uid}/${seqKey(seq)}`), data); },
    async removeShot(uid, seq) { await db.remove(ref(`shots/${uid}/${seqKey(seq)}`)); },
    async removeShots(uid) { await db.remove(ref(`shots/${uid}`)); },
    /**
     * 订阅所有人的开火事件。shots 是两层（uid -> 序号 -> 事件）：先监听 uid 层，
     * 每个 uid 出现时再挂一层序号监听；uid 删掉时把那层监听也拆掉，避免泄漏。
     * 订阅时会把已有的旧事件重放一遍，Net 那边按序号/时间去重、丢掉过期的。
     */
    onShots: (cb) => {
      const childSubs = new Map();
      const err = (e) => console.error('[net] listener error', 'shots', e);
      const unsubParent = db.onChildAdded(ref('shots'), (snap) => {
        const uid = snap.key;
        if (childSubs.has(uid)) return;
        try {
          childSubs.set(uid, db.onChildAdded(ref(`shots/${uid}`), (s2) => {
            try { cb(uid, parseInt(s2.key, 10), s2.val()); } catch (e) { err(e); }
          }));
        } catch (e) { err(e); }
      });
      const unsubRemoved = db.onChildRemoved(ref('shots'), (snap) => {
        const u = childSubs.get(snap.key);
        if (u) { try { u(); } catch { /* 忽略 */ } childSubs.delete(snap.key); }
      });
      return () => {
        try { unsubParent(); } catch { /* 忽略 */ }
        try { unsubRemoved(); } catch { /* 忽略 */ }
        for (const u of childSubs.values()) { try { u(); } catch { /* 忽略 */ } }
        childSubs.clear();
      };
    },

    async sendHit(victimUid, seq, data) { await db.set(ref(`hits/${victimUid}/${seqKey(seq)}`), data); },
    async removeHit(uid, seq) { await db.remove(ref(`hits/${uid}/${seqKey(seq)}`)); },
    async removeHits(uid) { await db.remove(ref(`hits/${uid}`)); },
    onHits: (uid, cb) => db.onChildAdded(ref(`hits/${uid}`), (snap) => {
      try { cb(parseInt(snap.key, 10), snap.val()); } catch (e) { console.error('[net] listener error', `hits/${uid}`, e); }
    }),

    async sendPdmg(key, data) { await db.set(ref(`pdmg/${key}`), data); },
    async removePdmg(key) { await db.remove(ref(`pdmg/${key}`)); },
    onPdmg: (cb) => db.onChildAdded(ref('pdmg'), (snap) => {
      try { cb(snap.key, snap.val()); } catch (e) { console.error('[net] listener error', 'pdmg', e); }
    }),

    async sendVdmg(key, data) { await db.set(ref(`vdmg/${key}`), data); },
    async removeVdmg(key) { await db.remove(ref(`vdmg/${key}`)); },
    onVdmg: (cb) => db.onChildAdded(ref('vdmg'), (snap) => {
      try { cb(snap.key, snap.val()); } catch (e) { console.error('[net] listener error', 'vdmg', e); }
    }),

    async sendPtake(key, data) { await db.set(ref(`ptake/${key}`), data); },
    async removePtake(key) { await db.remove(ref(`ptake/${key}`)); },
    onPtake: (cb) => db.onChildAdded(ref('ptake'), (snap) => {
      try { cb(snap.key, snap.val()); } catch (e) { console.error('[net] listener error', 'ptake', e); }
    }),

    /** 任务：抢任务用 transaction（没人做/已完成/超过 20 秒没心跳才能抢到）；进度和完成直接 set；失败/离开直接删。 */
    async claimMission(id, data) {
      const res = await db.runTransaction(ref(`missions/${id}`), (cur) => {
        if (cur === null) return data;
        if (cur.state === 'done') return data;
        if (typeof cur.t === 'number' && Date.now() - cur.t > 20000) return data;
        return undefined;   // 有人在做：放弃
      });
      return !!res.committed;
    },
    async setMission(id, data) { await db.set(ref(`missions/${id}`), data); },
    async removeMission(id) { await db.remove(ref(`missions/${id}`)); },
    onMissions: (cb) => db.onValue(ref('missions'), (snap) => {
      try { cb(snap.val() || {}); } catch (e) { console.error('[net] listener error', 'missions', e); }
    }),

    /** 排行榜记分：transaction 保证 +1 是原子的（规则也要求新值只能是旧值 +1 或从 1 开始） */
    async scoreTx(week, name, field) {
      await db.runTransaction(ref(`scores/${week}/${name}/${field}`), (cur) => {
        if (cur === null) return 1;
        if (typeof cur !== 'number') return undefined;   // 数据坏了：放弃这次 transaction
        return cur + 1;
      });
    },
    onScores: (week, cb) => sub(`scores/${week}`, cb),

    async pushFeed(key, data) { await db.set(ref(`feed/${key}`), data); },
    async removeFeed(key) { await db.remove(ref(`feed/${key}`)); },
    onFeed: (cb) => db.onChildAdded(ref('feed'), (snap) => {
      try { cb(snap.key, snap.val()); } catch (e) { console.error('[net] listener error', 'feed', e); }
    }),

    /** 全员无敌共享开关：单节点，任何登录玩家都能拨动（规则只校验字段，不限 uid） */
    async setGod(data) { await db.set(ref('godMode'), data); },
    onGod: (cb) => sub('godMode', cb),
  };
}
