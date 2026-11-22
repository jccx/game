// 落日湾联机：Firebase transport，实现 net.js 文件头的 transport 接口。
// 只在加入联机时才动态 import SDK（CDN），平时单机玩完全不加载；不要在别处 import Firebase。
// 配置只从 city/js/firebase-config.js 读，不复制、不打印。
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/13.4.0';

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

    async setPlayer(uid, payload) { await db.set(ref(`players/${uid}`), payload); },
    async removePlayer(uid) { await db.remove(ref(`players/${uid}`)); },
    onPlayers: (cb) => sub('players', cb),

    async setBuilding(index, data) { await db.set(ref(`buildings/${index}`), data); },
    onBuildings: (cb) => sub('buildings', cb),

    async setVehicle(id, data) { await db.set(ref(`vehicles/${id}`), data); },
    onVehicles: (cb) => sub('vehicles', cb),
  };
}
