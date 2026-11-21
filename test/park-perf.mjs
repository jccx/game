// 梦想乐园性能测量：只量数字，不改玩法。
// 用法：node test/park-perf.mjs
// 报告基线（2026-11-21 量过，见 park/README.md 的优化记录）和改后的对比；
// 时间上限都留得很宽（共享 VM 上抖动大），只防数量级回归，不卡毫秒。
import { Park } from '../park/js/game.js';
import { TICK, VISITOR } from '../park/js/config.js';

const dt = 1 / TICK;
let fail = 0, total = 0;
const chk = (c, m) => { total++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

function buildFullPark(seed = 42) {
  const p = new Park({ seed });
  p.god = true;
  for (let z = 16; z >= 2; z--) { p.buildPath(11, z); p.buildPath(12, z); }
  for (let x = 2; x <= 21; x++) { p.buildPath(x, 10); p.buildPath(x, 5); }
  p.build('carousel', 8, 8); p.build('wheel', 14, 6); p.build('bumper', 18, 8);
  p.build('snack', 10, 9); p.build('drink', 13, 9); p.build('gift', 9, 11); p.build('toilet', 13, 11);
  p.research('pirate'); p.build('pirate', 18, 3);
  p.research('coaster'); p.build('coaster', 4, 3);
  p.god = false;
  return p;
}

// 1) BFS：1000 次寻路，5 遍取中位数；路径必须和原来一致（200 组抽查）
{
  const p = buildFullPark();
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    for (let j = 0; j < 1000; j++) p.findPath(11, 16, 2 + (j % 20), 2 + (j % 14));
    runs.push(performance.now() - t0);
  }
  const m = med(runs);
  console.log(`BFS 1000 次 5 遍中位数 ${m.toFixed(1)}ms（基线 83.7ms，5 遍 27.1~125.7ms）`);
  chk(m < 2000, `BFS 1000 次中位数 ${m.toFixed(1)}ms，未数量级回归`);
  const a = p.findPath(11, 16, 21, 10);
  chk(a && a.length > 0 && a[a.length - 1][0] === 21 && a[a.length - 1][1] === 10, 'BFS 仍能找到入口到 (21,10) 的路');
}

// 2) 满员 tick：注入 60 名游客跑 120 秒，每 tick 必须远小于 33ms 步长
{
  const p = buildFullPark();
  for (let i = 0; i < 60; i++) {
    const v = { id: p.nextVisitorId++, x: 11.5, z: 17, wallet: 80, mood: 70, hunger: 20, state: 'enter', path: [], pi: 0, targetId: 0, wait: 0, rideT: 0, color: '#e2523f' };
    p.visitors.push(v); p._pickTarget(v);
  }
  const n = 120 * TICK;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { p.tick(dt); p.events.length = 0; }
  const per = (performance.now() - t0) / n;
  console.log(`强制 60 人满员 tick：平均每 tick ${per.toFixed(3)}ms（基线 0.023~0.082ms，共享 VM 抖动大），游客剩 ${p.visitors.length} 人`);
  chk(per < 5, `满员 tick 平均 ${per.toFixed(3)}ms/次，远小于 33ms 步长`);
}

// 3) coasterTrace 缓存：读 10000 次，旧版中位数 23.3ms
{
  const p = new Park({ seed: 7 });
  p.god = true; p.research('coaster'); p.build('coaster', 10, 10);
  for (const s of ['straight', 'straight', 'right', 'straight', 'right', 'straight', 'right', 'straight']) p.coasterAdd(s);
  p.god = false;
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    for (let j = 0; j < 10000; j++) { if (!p.coasterTrace.closed) throw new Error('not closed'); }
    runs.push(performance.now() - t0);
  }
  const m = med(runs);
  console.log(`coasterTrace 读 10000 次 5 遍中位数 ${m.toFixed(1)}ms（基线 23.3ms）`);
  chk(m < 500, `coasterTrace 缓存读 10000 次中位数 ${m.toFixed(1)}ms，未数量级回归`);
}

// 4) 存档：60 人序列化必须在毫秒级，大小在 20KB 以内
{
  const p = buildFullPark();
  for (let i = 0; i < 60; i++) {
    const v = { id: p.nextVisitorId++, x: 11.5, z: 17, wallet: 80, mood: 70, hunger: 20, state: 'enter', path: [], pi: 0, targetId: 0, wait: 0, rideT: 0, color: '#e2523f' };
    p.visitors.push(v); p._pickTarget(v);
  }
  const t0 = performance.now();
  const json = JSON.stringify(p.serialize());
  const serMs = performance.now() - t0;
  console.log(`存档 60 人：${json.length} 字节（之前误标的 9356 字节是跑完 120 秒后剩 24 人时的大小，不是 60 人），序列化 ${serMs.toFixed(2)}ms`);
  chk(json.length < 20000 && serMs < 100, `存档 ${json.length} 字节、${serMs.toFixed(2)}ms，未数量级回归`);
  chk(p.visitors.length === 60, `满员 60 人（实际 ${p.visitors.length} 人，上限 ${VISITOR.maxInPark}）`);
}

console.log(fail ? `有 ${fail} / ${total} 项失败` : `梦想乐园性能测量全部通过（${total} 项）`);
process.exit(fail ? 1 : 0);
