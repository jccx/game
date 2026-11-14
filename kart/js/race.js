// 疾风卡丁：比赛的核心逻辑——卡丁车物理（含漂移和氮气）、道具、电脑车手、名次和圈数。
// 只有规则，没有画面代码，可以脱离浏览器跑（测试用）。
// 朝向约定：yaw 是弧度，车头方向为 (sin yaw, cos yaw)；向右转时 yaw 减小。
import { KART, ITEMS, DIFFICULTY, LAPS, RACERS, DRIVERS } from './config.js';
import { buildTrack } from './tracks.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Race {
  /**
   * @param {object} o
   * @param {object} o.track      赛道定义（tracks.js 里的一项）
   * @param {number} [o.difficulty=1]
   * @param {boolean} [o.allBots]  玩家的车也交给电脑（测试用）
   */
  constructor(o) {
    this.track = buildTrack(o.track);
    this.diff = DIFFICULTY[o.difficulty ?? 1];
    this.laps = o.laps || LAPS;
    this.time = 0;                 // 比赛计时（发车后才开始走）
    this.count = 3.6;              // 发车倒计时
    this.state = 'count';          // count 倒计时 / race 比赛中 / done 结束
    this.events = [];
    this.bananas = []; this.missiles = [];
    const T = this.track, S = T.s, N = T.n;
    // 道具箱：每处横排三个
    this.boxes = [];
    for (const f of o.track.boxes) {
      const s = S[Math.floor(f * N)];
      for (const k of [-0.55, 0, 0.55]) this.boxes.push({ x: s.x + s.nx * T.half * k, z: s.z + s.nz * T.half * k, t: 0 });
    }
    // 发车格：两列四排，玩家在第三排
    this.karts = [];
    for (let i = 0; i < RACERS; i++) {
      const slot = i === 0 ? 5 : i <= 5 ? i - 1 : i;         // 玩家占第 6 个格子
      const row = Math.floor(slot / 2), col = slot % 2;
      const si = (N - 5 - row * 4) % N, s = S[si], off = (col ? -1 : 1) * T.half * 0.38;
      const yaw = Math.atan2(s.tx, s.tz);
      const k = {
        id: i, driver: DRIVERS[i], isPlayer: i === 0, x: s.x + s.nx * off, z: s.z + s.nz * off, px: 0, pz: 0, yaw, pyaw: yaw, vdir: yaw, v: 0,
        si, lap: 0, off, progress: si - N, place: slot + 1,
        drifting: false, driftDir: 0, charge: 0, gauge: 0, nitro: 0, boostT: 0, boostKind: 0, spinT: 0, spinA: 0, shieldT: 0, item: null,
        finished: false, finishTime: 0, lapStart: 0, lapTimes: [], best: 0, god: false, wrong: 0, scrapeT: 0,
        in: { steer: 0, gas: false, brake: false, drift: false, boost: false, use: false }, ai: null,
      };
      k.px = k.x; k.pz = k.z;
      if (i > 0 || o.allBots) k.ai = { speed: this.diff.lo + Math.random() * (this.diff.hi - this.diff.lo), line: (Math.random() - 0.5) * 1.2, lineT: 1 + Math.random() * 3, nitroT: 5 + Math.random() * 9, itemT: 0 };
      this.karts.push(k);
    }
    this.player = this.karts[0];
    this.order = this.karts.slice();
  }

  emit(ev) { if (this.events.length < 400) this.events.push(ev); }

  /* ------------------------------------------------------------ 道具 */

  /** 抽道具：名次越靠后，越容易抽到导弹和氮气；领先时多是香蕉皮和护盾 */
  rollItem(place) {
    const t = (place - 1) / (RACERS - 1), w = {
      banana: ITEMS.banana.weight * (1.6 - t), missile: ITEMS.missile.weight * (0.3 + t * 1.7),
      shield: ITEMS.shield.weight * (1.4 - t * 0.8), nitro: ITEMS.nitro.weight * (0.6 + t),
    };
    let r = Math.random() * (w.banana + w.missile + w.shield + w.nitro);
    for (const id in w) { if (r < w[id]) return id; r -= w[id]; }
    return 'nitro';
  }

  useItem(k) {
    const id = k.item; k.item = null;
    if (id === 'banana') this.bananas.push({ x: k.x - Math.sin(k.yaw) * 3, z: k.z - Math.cos(k.yaw) * 3, owner: k, arm: 0.45, alive: true });
    else if (id === 'shield') k.shieldT = 6;
    else if (id === 'nitro') k.nitro = Math.min(KART.nitroMax, k.nitro + 1);
    else if (id === 'missile') {
      const target = this.order[k.place - 2] || null;        // 前面一名
      this.missiles.push({ si: k.si + 2, off: k.off, x: k.x, z: k.z, px: k.x, pz: k.z, target, owner: k, life: 5, alive: true });
    }
    this.emit({ type: 'use', k, id });
  }

  /** 让一辆车中招打转（有护盾或开了无敌就没事） */
  spin(k, by) {
    if (k.shieldT > 0 || k.god) { this.emit({ type: 'block', k }); return; }
    k.spinT = KART.spinTime; k.v *= 0.3; k.drifting = false; k.boostT = 0;
    this.emit({ type: 'spin', k, by });
  }

  /* ------------------------------------------------------------ 电脑车手 */
  aiControl(k, dt, cruise) {
    const T = this.track, S = T.s, N = T.n, ai = k.ai, inn = k.in, P = this.player;
    // 换线：隔几秒换一个横向位置；前面有车就往旁边让
    if ((ai.lineT -= dt) <= 0) { ai.lineT = 2 + Math.random() * 3; ai.line = (Math.random() - 0.5) * 1.3; }
    for (const o of this.karts) {
      if (o === k) continue;
      const dx = o.x - k.x, dz = o.z - k.z, f = dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw);
      if (f > 0 && f < 9 && Math.abs(o.off - k.off) < 2.4) { ai.line = clamp(o.off / T.half + (o.off > k.off ? -0.6 : 0.6), -0.85, 0.85); ai.lineT = 1.2; break; }
    }
    const look = Math.round(4 + k.v * 0.32), s = S[(k.si + look) % N];
    const tx = s.x + s.nx * ai.line * T.half * 0.72, tz = s.z + s.nz * ai.line * T.half * 0.72;
    const diff = angDiff(k.yaw, Math.atan2(tx - k.x, tz - k.z));
    inn.steer = clamp(-diff * 3.2, -1, 1);
    // 弯前减速：看前方约 40 米里最弯的地方
    let km = 0;
    for (let j = 2; j < 22; j++) { const c = Math.abs(S[(k.si + j) % N].k); if (c > km) km = c; }
    // 橡皮筋：落后玩家较多时略快一点，领先较多时略慢一点，让比赛更胶着
    const gap = (P.progress - k.progress) * 2;
    const band = k.isPlayer ? 1 : 1 + clamp(gap / 500, -0.07, 0.09);
    const vmax = KART.max * (cruise ? 0.55 : ai.speed * band);
    const vt = Math.min(vmax * (k.boostT > 0 ? KART.boostMul : 1), Math.sqrt(15 / Math.max(km, 0.002)));
    inn.gas = k.v < vt; inn.brake = k.v > vt + 3;
    inn.drift = false; inn.boost = false; inn.use = false;
    if (cruise) return;
    // 氮气：电脑不漂移，改为隔一阵子得一瓶，直道上用
    if ((ai.nitroT -= dt) <= 0) { ai.nitroT = 9 + Math.random() * 10; k.nitro = Math.min(KART.nitroMax, k.nitro + 1); }
    if (k.nitro > 0 && km < 0.012 && k.boostT <= 0 && Math.abs(diff) < 0.2) inn.boost = true;
    // 道具
    if (k.item) {
      ai.itemT += dt;
      if (ai.itemT > 1.2 + (1 - this.diff.item) * 3) {
        let use = false;
        if (k.item === 'missile') use = k.place > 1;
        else if (k.item === 'banana') use = this.karts.some((o) => o !== k && o.progress < k.progress && k.progress - o.progress < 9) || ai.itemT > 5;
        else if (k.item === 'shield') use = this.missiles.some((m) => m.target === k) || ai.itemT > 6;
        else use = true;
        if (use) { inn.use = true; ai.itemT = 0; }
      }
    } else ai.itemT = 0;
  }

  /* ------------------------------------------------------------ 卡丁车物理 */
  updateKart(k, dt) {
    const T = this.track, S = T.s, N = T.n, inn = k.in, surf = T.def.grip || 1;
    k.px = k.x; k.pz = k.z; k.pyaw = k.yaw;
    if (k.boostT > 0) k.boostT -= dt;
    if (k.shieldT > 0) k.shieldT -= dt;
    if (k.scrapeT > 0) k.scrapeT -= dt;
    if (this.state === 'count') return;
    if (k.finished) this.aiControl(k, dt, true);          // 冲线后自动慢慢滑行
    else if (k.ai) this.aiControl(k, dt, false);

    if (k.spinT > 0) {                                    // 中招打转：失控减速
      k.spinT -= dt; k.spinA += dt * 14; k.v *= Math.exp(-2.5 * dt);
      if (k.spinT <= 0) { k.spinA = 0; k.vdir = k.yaw; }
    } else {
      if (inn.boost && k.nitro > 0 && k.boostT <= 0.3) { k.nitro--; k.boostT = KART.nitroTime; k.boostKind = 3; this.emit({ type: 'boost', k, nitro: true }); }
      if (inn.use && k.item) this.useItem(k);
      const maxV = KART.max * (k.boostT > 0 ? KART.boostMul : 1);
      if (inn.brake) { if (k.v > 0.5) k.v -= KART.brake * dt; else k.v = Math.max(-KART.reverse, k.v - KART.accel * 0.6 * dt); }
      else if (inn.gas) {
        if (k.v < maxV) k.v = Math.min(maxV, k.v + (k.boostT > 0 ? KART.boostAccel : KART.accel * (1 - 0.5 * Math.max(0, k.v) / KART.max)) * dt);
        else k.v -= (k.v - maxV) * 2.2 * dt;
      } else k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), KART.drag * dt);

      // 漂移：按住漂移键并打方向就侧滑过弯；漂得越久攒得越多，松开时按档位给一小段加速，同时攒氮气槽
      const sp = Math.abs(k.v);
      if (!k.drifting && inn.drift && Math.abs(inn.steer) > 0.25 && k.v > KART.driftMinSpeed) { k.drifting = true; k.driftDir = Math.sign(inn.steer); k.charge = 0; this.emit({ type: 'drift', k }); }
      let turn, grip = KART.grip * surf;
      if (k.drifting) {
        if (!inn.drift || k.v < KART.driftMinSpeed * 0.7) {
          k.drifting = false;
          let tier = 0, t = 0;
          KART.miniBoost.forEach((m, i) => { if (k.charge >= m[0]) { tier = i + 1; t = m[1]; } });
          if (tier) { k.boostT = Math.max(k.boostT, t); k.boostKind = tier - 1; this.emit({ type: 'boost', k, tier }); }
        } else {
          turn = k.driftDir * KART.driftTurn + inn.steer * KART.driftSteer;
          grip = KART.driftGrip * surf;
          k.charge += dt * (0.55 + 0.6 * Math.abs(inn.steer));
          k.gauge += KART.gaugeRate * dt;
          if (k.gauge >= 1) { if (k.nitro < KART.nitroMax) { k.gauge -= 1; k.nitro++; this.emit({ type: 'nitro', k }); } else k.gauge = 1; }
        }
      }
      if (!k.drifting) turn = inn.steer * KART.steer * Math.min(1, sp / 6) * (1 - 0.25 * Math.min(1, sp / KART.max));
      k.yaw -= turn * dt * (k.v < 0 ? -1 : 1);
      k.vdir += angDiff(k.vdir, k.yaw) * (1 - Math.exp(-grip * dt));          // 实际行进方向慢慢跟上车头：抓地力越低越“飘”
    }
    k.x += Math.sin(k.vdir) * k.v * dt; k.z += Math.cos(k.vdir) * k.v * dt;

    // 在赛道上的位置：找最近的取样点（只在上一帧位置附近找）
    let best = k.si, bd = 1e9;
    for (let j = -5; j <= 9; j++) { const i = (k.si + j + N) % N, s = S[i], d = (s.x - k.x) ** 2 + (s.z - k.z) ** 2; if (d < bd) { bd = d; best = i; } }
    const old = k.si; k.si = best;
    if (best < N * 0.25 && old > N * 0.75) this.crossLine(k);
    else if (best > N * 0.75 && old < N * 0.25) k.lap--;                       // 倒着压线不算，还要扣回去
    const s = S[k.si];
    k.off = (k.x - s.x) * s.nx + (k.z - s.z) * s.nz;
    k.progress = k.lap * N + k.si;
    // 逆行提示：车头和赛道方向相反
    const fw = Math.sin(k.yaw) * s.tx + Math.cos(k.yaw) * s.tz;
    k.wrong = fw < -0.3 && k.v > 3 ? k.wrong + dt : 0;
    // 护栏：出不去，蹭上去会掉速
    const lim = T.half - 0.9;
    if (Math.abs(k.off) > lim) {
      const sg = Math.sign(k.off), push = k.off - sg * lim;
      k.x -= s.nx * push; k.z -= s.nz * push; k.off = sg * lim;
      let vx = Math.sin(k.vdir), vz = Math.cos(k.vdir);
      const vn = (vx * s.nx + vz * s.nz) * sg;                                 // 朝墙外的速度分量
      if (vn > 0) {
        vx -= s.nx * sg * vn * 1.15; vz -= s.nz * sg * vn * 1.15;
        k.vdir = Math.atan2(vx, vz);
        if (k.spinT <= 0) k.yaw += angDiff(k.yaw, k.vdir) * Math.min(1, dt * 5);
        if (!k.god) k.v *= Math.pow(KART.wallLoss - vn * 0.05, dt * 60);
        if (k.scrapeT <= 0) { k.scrapeT = 0.15; this.emit({ type: 'scrape', k, x: k.x + s.nx * sg * 0.9, z: k.z + s.nz * sg * 0.9 }); }
      }
    }
  }

  /** 压过起跑线：记圈，跑满就冲线 */
  crossLine(k) {
    k.lap++;
    if (k.lap > 1 && !k.finished) {
      const lt = this.time - k.lapStart;
      k.lapTimes.push(lt); if (!k.best || lt < k.best) k.best = lt;
      this.emit({ type: 'lap', k, n: k.lap, time: lt });
    }
    k.lapStart = this.time;
    if (k.lap > this.laps && !k.finished) {
      k.finished = true; k.finishTime = this.time; k.boostT = 0; k.drifting = false;
      k.finishPlace = this.karts.filter((o) => o.finished).length;
      this.emit({ type: 'finish', k, place: k.finishPlace });
    }
  }

  /* ------------------------------------------------------------ 主循环 */
  update(dt) {
    if (this.state === 'count') {
      const before = Math.ceil(this.count);
      this.count -= dt;
      const now = Math.ceil(this.count);
      if (now !== before && now >= 0 && now <= 3) this.emit({ type: 'count', n: now });
      if (this.count <= 0) { this.state = 'race'; }
    } else this.time += dt;
    for (const k of this.karts) this.updateKart(k, dt);

    // 车与车相撞：互相推开
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j], dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, min = KART.radius * 2;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = (min - d) / 2;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      if (Math.abs(a.v - b.v) > 4) { const m = (a.v + b.v) / 2; if (!a.god) a.v += (m - a.v) * 0.25; if (!b.god) b.v += (m - b.v) * 0.25; this.emit({ type: 'bump', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, k: a.isPlayer ? a : b }); }
    }

    // 道具箱
    for (const b of this.boxes) {
      if (b.t > 0) { b.t -= dt; continue; }
      for (const k of ks) if (!k.item && !k.finished && (k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 5.3) { k.item = this.rollItem(k.place); b.t = 4; this.emit({ type: 'item', k, id: k.item }); break; }
    }
    // 香蕉皮
    for (const b of this.bananas) {
      if (b.arm > 0) { b.arm -= dt; continue; }
      for (const k of ks) if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 3.2 && k.spinT <= 0) { b.alive = false; this.spin(k, b.owner); break; }
    }
    if (this.bananas.some((b) => !b.alive)) this.bananas = this.bananas.filter((b) => b.alive);
    // 导弹：沿着赛道飞向目标
    const S = this.track.s, N = this.track.n;
    for (const m of this.missiles) {
      m.px = m.x; m.pz = m.z;
      m.si += (60 * dt) / 2; m.life -= dt;
      const t = m.target;
      if (t) m.off += (t.off - m.off) * Math.min(1, dt * 4);
      const s = S[Math.floor(m.si) % N];
      m.x = s.x + s.nx * m.off; m.z = s.z + s.nz * m.off;
      if (t && !t.finished && (t.x - m.x) ** 2 + (t.z - m.z) ** 2 < 12) { m.alive = false; this.spin(t, m.owner); this.emit({ type: 'hit', x: t.x, z: t.z }); }
      else if (m.life <= 0) m.alive = false;
    }
    if (this.missiles.some((m) => !m.alive)) this.missiles = this.missiles.filter((m) => m.alive);

    // 名次：已冲线的按冲线先后，其余按跑过的路程
    this.order.sort((a, b) => (a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress));
    this.order.forEach((k, i) => { k.place = i + 1; });

    if (this.state === 'race' && this.player.finished) {
      this.state = 'done';
      // 还没跑完的电脑车：按各自的速度推算完赛时间，排出最终名次
      const total = (this.laps + 1) * N;
      for (const k of ks) if (!k.finished) k.estTime = this.time + ((total - k.progress) * 2) / Math.max(12, KART.max * (k.ai ? k.ai.speed : 1) * 0.86);
      this.results = ks.slice().sort((a, b) => (a.finished ? a.finishTime : a.estTime) - (b.finished ? b.finishTime : b.estTime));
      this.emit({ type: 'done' });
    }
  }
}
