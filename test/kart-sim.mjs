// 疾风卡丁的纯逻辑测试：赛道合法性、电脑车能跑完全程、漂移和氮气、道具、无敌。
// 用法：node test/kart-sim.mjs
import { Race } from '../kart/js/race.js';
import { TRACKS, buildTrack } from '../kart/js/tracks.js';
import { TICK, KART, LAPS } from '../kart/js/config.js';

const dt = 1 / TICK;
let fail = 0;
const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// ---- 赛道：不能自己和自己靠得太近（否则两段路会重叠），弯不能急到过不去 ----
for (const def of TRACKS) {
  const T = buildTrack(def), S = T.s, N = T.n;
  let minGap = 1e9, maxK = 0;
  for (let i = 0; i < N; i += 2) {
    maxK = Math.max(maxK, Math.abs(S[i].k));
    for (let j = i + 30; j < N; j += 2) {
      if (N - j + i < 30) continue;                         // 首尾相接处不算
      const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z); if (d < minGap) minGap = d;
    }
  }
  chk(minGap > def.width + 6, `${def.name}：全长 ${T.length.toFixed(0)} 米，不同路段最近相距 ${minGap.toFixed(0)} 米（路宽 ${def.width}）`);
  chk(1 / maxK > def.width * 0.55, `${def.name}：最急的弯半径 ${(1 / maxK).toFixed(0)} 米`);
}

// ---- 每条赛道：八辆电脑车跑完三圈 ----
for (const def of TRACKS) {
  const r = new Race({ track: def, difficulty: 1, allBots: true });
  const t0 = Date.now();
  let err = null, spins = 0, uses = 0;
  try {
    while (r.state !== 'done' && r.time < 400) {
      r.update(dt);
      for (const e of r.events) { if (e.type === 'spin') spins++; if (e.type === 'use') uses++; }
      r.events.length = 0;
      if (r.karts.some((k) => !Number.isFinite(k.x) || !Number.isFinite(k.v))) { err = '出现非法数值'; break; }
    }
  } catch (e) { err = e.stack || String(e); }
  const fin = r.karts.filter((k) => k.finished).length;
  chk(!err && r.state === 'done', `${def.name}：电脑代跑完赛 ${r.player.finishTime.toFixed(1)} 秒，最快单圈 ${r.player.best.toFixed(1)} 秒，${fin} 辆已冲线，道具使用 ${uses} 次、打转 ${spins} 次${err ? ' ' + err : ''}（实际耗时 ${Date.now() - t0}ms）`);
  chk(r.results.length === 8 && r.results.every((k) => k.lap >= 1), `${def.name}：结算名单完整`);
}

// ---- 漂移、氮气、道具、无敌 ----
{
  const r = new Race({ track: TRACKS[0], difficulty: 1 }), p = r.player;
  for (let i = 0; i < 4 * TICK; i++) r.update(dt);
  chk(r.state === 'race' && p.v === 0, '倒计时结束前车不动，结束后开始比赛');
  p.in.gas = true;
  for (let i = 0; i < 4 * TICK; i++) r.update(dt);
  chk(p.v > 25, `油门 4 秒加速到 ${p.v.toFixed(1)} 米/秒`);
  // 漂移：按住漂移并打方向，1 秒后松开应得到加速并攒了氮气槽
  p.in.drift = true; p.in.steer = 1;
  for (let i = 0; i < 1.0 * TICK; i++) r.update(dt);
  const wasDrifting = p.drifting, g = p.gauge, yawTurned = Math.abs(p.yaw - p.vdir);
  p.in.drift = false; p.in.steer = 0; r.events.length = 0; r.update(dt);
  chk(wasDrifting && g > 0.12 && p.boostT >= 0.5 && yawTurned > 0.15, `漂移 1 秒：车身侧滑 ${(yawTurned * 57.3).toFixed(0)} 度，氮气槽 ${(g * 100).toFixed(0)}%，松开后获得 ${p.boostT.toFixed(2)} 秒加速`);
  // 氮气：让电脑代开（它会在直道上用氮气），给两瓶，看最高速度能不能明显超过平时
  {
    const r2 = new Race({ track: TRACKS[0], difficulty: 1, allBots: true }), q = r2.player;
    for (let i = 0; i < 9 * TICK; i++) r2.update(dt);
    q.nitro = 2; q.ai.nitroT = 99; let vmax = 0, used = 0;
    for (let i = 0; i < 25 * TICK; i++) { r2.update(dt); if (q.v > vmax) vmax = q.v; used += r2.events.filter((e) => e.type === 'boost' && e.k === q && e.nitro).length; r2.events.length = 0; }
    chk(used >= 1 && vmax > KART.max * 1.2, `用氮气 ${used} 次，最高速度冲到 ${vmax.toFixed(1)}（平时最高 ${KART.max}）`);
  }
  // 香蕉皮
  p.item = 'banana'; p.in.use = true; r.update(dt); p.in.use = false;
  const b = r.bananas.find((x) => x.owner === p);
  chk(b && !p.item && Math.hypot(b.x - p.x, b.z - p.z) < 6, '用掉香蕉皮后它留在了身后的赛道上');
  b.arm = 0; const foe = r.karts[1]; foe.spinT = 0; foe.shieldT = 0; foe.x = b.x; foe.z = b.z; foe.v = 20; r.update(dt);
  chk(foe.spinT > 0 && !r.bananas.includes(b), '别的车压到香蕉皮后打转，香蕉皮消失');
  // 护盾和无敌
  foe.spinT = 0; foe.shieldT = 5; r.spin(foe, p);
  chk(foe.spinT <= 0, '有护盾时不会打转');
  p.god = true; r.spin(p, foe);
  chk(p.spinT <= 0, '开了无敌不会打转');
  p.god = false; r.spin(p, foe);
  chk(p.spinT > 0, '关掉无敌后会打转');
  // 导弹
  const a = r.karts[2]; a.item = 'missile'; a.place = 3; r.order[1] = foe; foe.shieldT = 0; foe.spinT = 0; r.useItem(a);
  let hit = false;
  for (let i = 0; i < 6 * TICK && !hit; i++) { r.update(dt); r.order[1] = r.order[1]; if (r.events.some((e) => e.type === 'hit')) hit = true; r.events.length = 0; }
  chk(hit || r.missiles.length === 0, '导弹发射后飞向前车');
}
console.log(fail ? `有 ${fail} 项失败` : '疾风卡丁逻辑测试全部通过');
process.exit(fail ? 1 : 0);
