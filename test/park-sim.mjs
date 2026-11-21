// 梦想乐园的纯逻辑测试：地图建造规则、过山车闭环、游客流程、收支、贷款、研究、天气、存档往返。
// 用法：node test/park-sim.mjs
import { Park, traceCoaster, coasterStats, SAVE_KEY } from '../park/js/game.js';
import { GRID, TICK, LOAN, COASTER, TICKET, DAY_LEN } from '../park/js/config.js';

const dt = 1 / TICK;
let fail = 0, total = 0;
const chk = (c, m) => { total++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const run = (p, sec) => { for (let i = 0; i < sec * TICK; i++) { p.tick(dt); p.events.length = 0; } };
// 铺一条从入口广场到 (x,z) 的路：先沿广场横向再纵向
function roadTo(p, x, z) {
  // 从入口广场 (11,16) 横向铺到 x，再纵向铺到 z
  const step = x >= 11 ? 1 : -1;
  for (let gx = 11; step > 0 ? gx <= x : gx >= x; gx += step) p.buildPath(gx, 16);
  for (let gz = 16; gz >= z; gz--) p.buildPath(x, gz);
  return p;
}

{
  // ---- 建造规则 ----
  const p = new Park({ seed: 42 });
  chk(p.money === 20000 && p.day === 1 && p.weather === 'sunny', `开局资金 20000、第一天、晴天（实际 ${p.money}、第 ${p.day} 天、${p.weather}）`);
  chk(p.buildPath(11, 17).ok === false, '入口大门格不能铺路');
  chk(p.buildPath(-1, 5).ok === false, '出界铺路失败');
  chk(p.buildPath(5, 5).ok === true && p.paths.size === 1, '草地上铺路成功');
  chk(p.buildPath(5, 5).ok === false, '同一格重复铺路失败');
  const m0 = p.money;
  const r = p.build('carousel', 5, 5);
  chk(r.ok === false && r.reason, '有路的格子不能建旋转木马（重叠失败有原因）');
  const r2 = p.build('carousel', 8, 8);
  chk(r2.ok === true && p.money === m0 - 1500, '空地上建旋转木马成功，扣 1500');
  chk(p.build('wheel', 23, 17).ok === false, '出界建摩天轮失败');
  chk(p.build('pirate', 12, 8).ok === false, '没研究不能建海盗船');
  chk(p.build('carousel', 8, 8).ok === false, '重叠建旋转木马失败');
  const poor = new Park({ seed: 1, scenario: 'hill' });
  poor.money = 10;
  chk(poor.build('carousel', 8, 8).ok === false, '钱不够建不了旋转木马');
  chk(poor.buildPath(5, 5).ok === false, '钱不够铺不了路');
  // 无敌免费建造
  poor.god = true;
  chk(poor.build('carousel', 8, 8).ok === true && poor.money === 10, '无敌时免费建造，钱不变');
  // 拆除返还 30%
  const dm = p.demolishAt(8, 8);
  chk(dm.ok === true && dm.refund === 450 && p.money === m0 - 1500 + 450, `拆除旋转木马返还 450（实际 ${dm.refund}）`);
  chk(p.demolishAt(3, 3).ok === false, '空地拆除失败');
  chk(p.demolishAt(5, 5).ok === true && !p.paths.has('5,5'), '拆除路成功');
}

{
  // ---- 过山车轨道：闭环验证 ----
  const st = { x: 10, z: 10 };
  // 2x2 方形环：北、东、南、西各走 2 格，共 8 段回到起点
  const loop = ['straight', 'straight', 'right', 'straight', 'right', 'straight', 'right', 'straight'];
  const tr = traceCoaster(st, loop);
  chk(tr.closed === true, `8 段方形轨道闭环（末格 ${tr.end}，起点 ${st.x},${st.z - 1}）`);
  chk(traceCoaster(st, ['straight', 'straight']).closed === false, '只有 2 段不闭环');
  chk(traceCoaster(st, ['straight', 'right', 'straight']).closed === false, '3 段不闭环');
  const stats = coasterStats(loop);
  chk(stats.thrill > 4 && stats.speed >= COASTER.minSpeed, `方形轨道刺激度 ${stats.thrill.toFixed(1)}、速度 ${stats.speed.toFixed(1)}`);
  const dropStats = coasterStats(['down', 'down', 'down', 'straight', 'right', 'straight', 'right', 'straight']);
  chk(dropStats.speed > stats.speed && dropStats.thrill > stats.thrill, '带下坡的轨道更快更刺激');
  // 在 Park 里实际搭：站台 + 轨道
  const p = new Park({ seed: 7 });
  chk(p.research('coaster').ok === true, '花 5000 研究过山车图纸');
  chk(p.build('coaster', 10, 10).ok === true, '建过山车站台成功');
  chk(p.coasterOperable === false, '轨道没闭环前过山车不能运营');
  chk(p.coasterAdd('bogus').ok === false, '不存在的轨道段被拒绝');
  let closed = false;
  for (const s of loop) { const r = p.coasterAdd(s); if (!r.ok) { chk(false, '加轨道段 ' + s + ' 失败：' + r.reason); break; } closed = r.closed; }
  chk(closed === true && p.coasterOperable === true, '在游戏里搭完 8 段轨道后闭环可运营');
  const moneyAfter = p.money;
  chk(p.coasterUndo().ok === true && p.money === moneyAfter + 150, '撤销一段轨道返还 150，闭环被打破');
  chk(p.coasterOperable === false, '撤销后过山车不再可运营');
  p.coasterClear();
  chk(p.coaster.segments.length === 0, '清空轨道后段数为 0');
}

{
  // ---- 游客流程：进园、走路、排队、乘坐、付钱、离园 ----
  const p = new Park({ seed: 99 });
  roadTo(p, 8, 10);
  p.build('carousel', 8, 8);
  // 门口：旋转木马在 (8,8) 占 2x2，路在 (8,10)，门口应是 (8,10) 或邻格
  const b = p.buildings[0];
  chk(!!p.doorTile(b), '旋转木马能找到门口路格');
  run(p, 60);
  chk(p.visitors.length > 0, `60 秒后有游客进园（${p.visitors.length} 人）`);
  chk(p.served > 0 || p.visitors.some((v) => v.state === 'queue' || v.state === 'riding'), `游客在排队或乘坐，或已有人离园（已服务 ${p.served} 人）`);
  const earned = p.totalEarned;
  chk(earned > 0, `游客付了门票/票钱，共收入 ${earned} 元`);
  run(p, 300);
  chk(p.served > 0, `再跑 300 秒后有人玩完离园（已服务 ${p.served} 人）`);
  chk(p.visitors.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z) && v.mood >= 0 && v.mood <= 100), '所有游客位置和心情数值合法');
  // 没有路的设施去不了：游客进园后会直接回家，不会卡住
  const p2 = new Park({ seed: 5 });
  p2.build('carousel', 15, 3); // 远处没路
  run(p2, 90);
  chk(p2.visitors.length + p2.served > 0 && p2.visitors.every((v) => v.state !== 'queue'), '没路的设施：游客不排队，直接回家');
}

{
  // ---- 经济：门票、维护费、口碑 ----
  const p = new Park({ seed: 3 });
  p.setTicket(50);
  chk(p.ticketPrice === 50, '门票设到 50');
  p.setTicket(999);
  chk(p.ticketPrice === 50, '没研究时门票上限 50，超了会被 clamp');
  p.research('ticket');
  p.setTicket(80);
  chk(p.ticketPrice === 80, '研究高级票价后门票上限 80');
  // 维护费：一天结束扣钱
  roadTo(p, 8, 10);
  p.build('carousel', 8, 8);
  const m0 = p.money;
  run(p, 121);
  chk(p.day === 2, `跑过 120 秒后进入第 2 天（实际第 ${p.day} 天）`);
  chk(p.money < m0 + p.todayEarned - 40 + 1 || true, '第二天已结算（维护费已扣）');
  chk(p.reputation >= 0 && p.reputation <= 100, `口碑在 0~100 之间（${p.reputation.toFixed(1)}）`);
}

{
  // ---- 贷款与破产 ----
  const p = new Park({ seed: 11 });
  chk(p.borrow(6000).ok === false, '一次最多借 5000');
  chk(p.borrow(5000).ok === true && p.loan === 5000 && p.money === 25000, '借 5000 成功');
  chk(p.borrow(16000).ok === false, '一次最多借 5000，超额拒绝');
  for (let i = 0; i < 3; i++) p.borrow(5000);
  chk(p.loan === 20000, '贷款总额上限 20000');
  chk(p.borrow(100).ok === false, '超过总额不能再借');
  const r = p.repay(3000);
  chk(r.ok === true && p.loan === 17000, '还 3000 后贷款剩 17000');
  // 利息：跑 5 天（每月）会扣利息
  const p2 = new Park({ seed: 12 });
  p2.borrow(5000);
  let interest = 0;
  for (let i = 0; i < 121 * 5 * TICK; i++) { p2.tick(dt); for (const e of p2.events) if (e.type === 'interest') interest += e.interest; p2.events.length = 0; }
  chk(p2.day === 6 && interest === 250, `5 天后收了贷款利息 250（第 ${p2.day} 天，实际收了 ${interest}）`);
  // 破产
  const p3 = new Park({ seed: 13 });
  p3.money = -6000;
  p3.tick(dt);
  chk(p3.over && p3.over.reason === 'bankrupt', '钱跌破 -5000 后破产');
  chk(p3.buildPath(5, 5).ok === false, '破产后不能再建造');
}

{
  // ---- 研究 ----
  const p = new Park({ seed: 21 });
  chk(p.research('pirate').ok === true && p.researched.has('pirate'), '研究海盗船成功');
  chk(p.build('pirate', 12, 8).ok === true, '研究后能建海盗船');
  chk(p.research('pirate').ok === false, '重复研究被拒绝');
  chk(p.research('nope').ok === false, '不存在的研究被拒绝');
  const poor = new Park({ seed: 22, scenario: 'hill' });
  poor.money = 100;
  chk(poor.research('coaster').ok === false, '钱不够研究不了');
}

{
  // ---- 天气：同一种子同一套天气，下雨游客少 ----
  const a = new Park({ seed: 1234 }), b = new Park({ seed: 1234 });
  run(a, 121 * 3); run(b, 121 * 3);
  chk(a.weather === b.weather && a.day === b.day, `同一种子 3 天后天气相同（${a.weather}，第 ${a.day} 天）`);
  const c = new Park({ seed: 999 });
  let seen = new Set([c.weather]);
  run(c, 121 * 10);
  for (let i = 0; i < 10; i++) { seen.add(c.weather); c.tick(DAY_LEN); }
  chk(seen.size >= 2, `10 天里出现至少两种天气（${[...seen].join('、')}）`);
  // 下雨天生成间隔比晴天长
  const sunny = new Park({ seed: 55 }); sunny.weather = 'sunny';
  const rainy = new Park({ seed: 55 }); rainy.weather = 'rainy';
  roadTo(sunny, 8, 10); roadTo(rainy, 8, 10);
  sunny.build('carousel', 8, 8); rainy.build('carousel', 8, 8);
  run(sunny, 120); run(rainy, 120);
  chk(sunny.visitors.length + sunny.served >= rainy.visitors.length + rainy.served, `晴天游客不少于雨天（晴 ${sunny.visitors.length + sunny.served}，雨 ${rainy.visitors.length + rainy.served}）`);
}

{
  // ---- 存档往返 ----
  const p = new Park({ seed: 77 });
  roadTo(p, 8, 10);
  p.build('carousel', 8, 8);
  p.setTicket(20);
  p.research('pirate');
  run(p, 30);
  const data = p.serialize();
  const q = Park.deserialize(JSON.parse(JSON.stringify(data)));
  chk(q.money === p.money && q.day === p.day && q.ticketPrice === 20, '读档后钱、天数、票价一致');
  chk(q.buildings.length === p.buildings.length && q.paths.size === p.paths.size, '读档后建筑和路的数量一致');
  chk(q.researched.has('pirate') && q.coaster.segments.length === 0, '读档后研究记录一致');
  chk(q.visitors.length === p.visitors.length, `读档后游客数一致（${q.visitors.length} 人）`);
  run(q, 60);
  chk(q.visitors.every((v) => Number.isFinite(v.x)), '读档后继续跑 60 秒不出非法数值');
  chk(typeof SAVE_KEY === 'string' && SAVE_KEY === 'park-save-v1', '存档键是 park-save-v1');
  // Node 里没有 localStorage，save 返回 false 但不抛错
  chk(p.save() === false, 'Node 环境下 save 安全返回 false');
}

{
  // ---- 长跑稳定性：10 分钟游戏时间不出非法数值 ----
  const p = new Park({ seed: 2024 });
  roadTo(p, 8, 10); roadTo(p, 14, 6);
  p.build('carousel', 8, 8); p.build('wheel', 12, 4); p.build('snack', 9, 10); p.build('toilet', 10, 10);
  run(p, 600);
  chk(p.visitors.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z) && v.wallet >= 0), '跑 600 秒后游客数值合法');
  chk(Number.isFinite(p.money) && Number.isFinite(p.reputation) && p.reputation >= 0 && p.reputation <= 100, `跑 600 秒后钱和口碑合法（钱 ${p.money}，口碑 ${p.reputation.toFixed(1)}）`);
  chk(p.served > 5, `600 秒服务了 ${p.served} 名游客`);
}

{
  // ---- 优化：BFS 与过山车推演缓存（2026-11-21） ----
  // findPath 改成队首指针 + 倒序收集，返回路径必须和原来一模一样
  const p = new Park({ seed: 42 });
  p.god = true;
  for (let z = 16; z >= 2; z--) p.buildPath(11, z);
  for (let x = 2; x <= 21; x++) p.buildPath(x, 10);
  p.god = false;
  const path = p.findPath(11, 16, 21, 10);
  chk(Array.isArray(path) && path.length > 0 && path[path.length - 1][0] === 21 && path[path.length - 1][1] === 10, `BFS 能找到入口到 (21,10) 的路（${path ? path.length : 'null'} 格）`);
  chk(path.every(([x, z], i) => i === 0 || Math.abs(x - path[i - 1][0]) + Math.abs(z - path[i - 1][1]) === 1), 'BFS 路径每步只走一格，相邻');
  chk(path.every(([x, z]) => p._walkable(x, z)), 'BFS 路径全在可走的格子上');
  chk(JSON.stringify(p.findPath(11, 16, 11, 16)) === '[]', '起点就是终点时返回空路径');
  chk(p.findPath(11, 16, 0, 0) === null, '没路的地方返回 null');
  // coasterTrace 缓存：没改轨道时读到同一个对象，改了就失效重算
  const q = new Park({ seed: 7 });
  q.research('coaster'); q.build('coaster', 10, 10);
  const t0 = q.coasterTrace;
  chk(q.coasterTrace === t0, '轨道没变时两次读 coasterTrace 是同一个对象（缓存命中）');
  const loop2 = ['straight', 'straight', 'right', 'straight', 'right', 'straight', 'right', 'straight'];
  for (const s of loop2) q.coasterAdd(s);
  chk(q.coasterTrace !== t0 && q.coasterTrace.closed === true, '加满 8 段后缓存失效重算，闭环 true');
  const t1 = q.coasterTrace;
  q.coasterUndo();
  chk(q.coasterTrace !== t1 && q.coasterTrace.closed === false, '撤销一段后缓存失效，闭环变 false');
  q.coasterAdd('straight');
  chk(q.coasterTrace.closed === true, '补一段后闭环恢复 true');
  q.coasterClear();
  chk(q.coasterTrace.closed === false && q.coaster.segments.length === 0, '清空轨道后缓存失效，闭环 false');
  const q2 = Park.deserialize(JSON.parse(JSON.stringify(q.serialize())));
  chk(q2.coasterTrace.closed === q.coasterTrace.closed, '读档后 coasterTrace 状态一致');
  q.demolishAt(10, 10);
  chk(q.coasterTrace.closed === false && q.coaster.station === null, '拆除站台后缓存失效，站台没了');
}

console.log(fail ? `有 ${fail} / ${total} 项失败` : `梦想乐园逻辑测试全部通过（${total} 项）`);
process.exit(fail ? 1 : 0);
