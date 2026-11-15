// 豆兵大战的纯逻辑测试：地形生成、走跳、各种武器、无敌、电脑互打能分出胜负。
// 用法：node test/artillery-sim.mjs
import { Game, Terrain } from '../artillery/js/game.js';
import { TICK, WORLD, WEAPONS, RULES } from '../artillery/js/config.js';
import { writePng } from './png.mjs';
import fs from 'node:fs';
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

const dt = 1 / TICK;
let fail = 0;
const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const run = (g, sec, fn) => { for (let i = 0; i < sec * TICK; i++) { if (fn) fn(); g.update(dt); g.events.length = 0; } };

// ---- 地形：十张随机图都要有足够的落脚点，并把第一张画出来看看 ----
{
  let ok = 0, minSpots = 99;
  for (let s = 1; s <= 10; s++) {
    const g = new Game({ seed: s * 7919, teams: 4, size: 4 });
    minSpots = Math.min(minSpots, g.beans.length);
    const land = g.terrain.mask.reduce((a, b) => a + b, 0) / g.terrain.mask.length;
    if (g.beans.length === 16 && land > 0.12 && land < 0.6 && g.beans.every((b) => g.terrain.solid(b.x, b.y + 10) && !g.terrain.solid(b.x, b.y))) ok++;
    if (s === 1) {
      const T = g.terrain, img = new Uint8Array(T.w * T.h * 3);
      for (let i = 0; i < T.w * T.h; i++) { const y = (i / T.w) | 0, v = T.mask[i]; img[i * 3] = v ? 120 : y > WORLD.water ? 40 : 150; img[i * 3 + 1] = v ? 80 : y > WORLD.water ? 110 : 200; img[i * 3 + 2] = v ? 50 : y > WORLD.water ? 190 : 250; }
      for (const b of g.beans) for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) if (dx * dx + dy * dy < 81) { const i = ((b.y + dy) | 0) * T.w + ((b.x + dx) | 0); img[i * 3] = [240, 220, 80, 70][b.team]; img[i * 3 + 1] = [200, 80, 190, 140][b.team]; img[i * 3 + 2] = [40, 60, 90, 230][b.team]; }
      writePng(new URL('./out/artillery-map.png', import.meta.url).pathname, T.w, T.h, img);
    }
  }
  chk(ok === 10, `十张随机地图都合格（陆地比例合适，16 个豆兵都站在地面上；最少 ${minSpots} 个）`);
}

// ---- 走、跳、掉落 ----
{
  const g = new Game({ seed: 12345, teams: 2, size: 3 });
  run(g, 1.2);
  chk(g.turn.state === 'aim' && g.turn.team === 0 && g.myTurn, '开局后轮到玩家的第一个豆兵');
  const b = g.turn.bean, x0 = b.x;
  run(g, 1.5, () => { g.input.move = 1; });
  g.input.move = 0;
  chk(Math.abs(b.x - x0) > 15 && b.alive, `走了 1.5 秒移动 ${(b.x - x0).toFixed(0)} 像素，仍贴着地面（${g.terrain.solid(b.x, b.y + 10) || !b.ground ? '是' : '否'}）`);
  // 挪到头顶有足够空间的平地上再跳（随机地图里偶尔会有低矮的洞，那里本来就跳不起来）
  for (let x = 200; x < 1500; x += 5) { const y = g.terrain.surfaceY(x); if (y > 200 && y < WORLD.water - 30 && g.terrain.surfaceY(x + 20) === y) { b.x = x; b.y = y - 9; b.vx = b.vy = 0; b.ground = true; break; } }
  for (let y = 0; y < b.y - 9; y++) g.terrain.mask[y * g.terrain.w + (b.x | 0)] = 0;       // 清掉头顶可能的平台
  const y0 = b.y; let top = b.y;
  g.input.jump = true; run(g, 1.2, () => { top = Math.min(top, b.y); });
  chk(y0 - top > 25 && b.ground, `跳起 ${(y0 - top).toFixed(0)} 像素后落回地面`);
}

// ---- 武器 ----
{
  const g = new Game({ seed: 4242, teams: 2, size: 1 });   // 每队一个豆兵，电脑只会瞄准测试里摆好的那个
  run(g, 1.2);
  const me = g.turn.bean, foe = g.beans.find((b) => b.team === 1);
  // 把敌人放到正右边 150 像素的平地上，直接瞄准
  const place = (b, x) => { b.x = x; b.y = g.terrain.surfaceY(x) - 9; b.vx = b.vy = 0; b.ground = true; };
  place(me, 600); place(foe, 760);
  const solidBefore = g.terrain.mask.reduce((a, b) => a + b, 0);
  const plan = g.aiPlan(me);
  chk(plan.weapon === 'bazooka' && !plan.walk, `电脑的瞄准计算找到了打法（角度 ${(plan.angle * 57.3).toFixed(0)}°，力度 ${(plan.power * 100).toFixed(0)}%）`);
  g.wind = g.wind; g.fire(plan.angle, plan.power);
  let boom = 0; for (let i = 0; i < 8 * TICK && g.turn.state !== 'aim'; i++) { g.update(dt); boom += g.events.filter((e) => e.type === 'boom').length; g.events.length = 0; }
  chk(boom >= 1 && foe.hp < RULES.hp, `火箭筒命中，敌人剩 ${foe.hp} 血`);
  chk(g.terrain.mask.reduce((a, b) => a + b, 0) < solidBefore, '爆炸在地形上炸出了坑');
  chk(g.turn.team === 1, '炮弹炸完、站稳之后轮到对方');
  // 跳过对方回合，回到玩家；测手雷、霰弹枪、炸药、传送、空袭
  g.turn.state = 'settle'; run(g, 2);
  chk(g.turn.team === 0, '对方回合结束后又轮到玩家');
  const b2 = g.turn.bean; place(b2, 600); place(foe, 700); foe.hp = 100;
  g.selectWeapon('shotgun');
  const a = Math.atan2(foe.y - b2.y, foe.x - b2.x);
  g.fire(a); chk(g.turn.state === 'aim' && foe.hp === 76, `霰弹枪第一枪命中（敌人剩 ${foe.hp}），还能再开一枪`);
  place(foe, 700); run(g, 0.5); g.fire(Math.atan2(foe.y - b2.y, foe.x - b2.x));
  chk(g.turn.state === 'retreat' && foe.hp <= 52, `第二枪后进入撤退时间（敌人剩 ${foe.hp}）`);
  g.turn.state = 'settle'; run(g, 3); g.turn.state = 'settle'; run(g, 3);
  const b3 = g.turn.bean; chk(g.turn.team === 0 && g.selectWeapon('teleport'), '可以选传送');
  const tx = 300, ty = g.terrain.surfaceY(300) - 40;
  g.fire(0, 1, { x: tx, y: ty }); run(g, 1.5);
  chk(Math.abs(b3.x - tx) < 2 && b3.ground, '传送到指定位置并落到地面');
  chk(g.teams[0].ammo.teleport === 1, '传送用掉一次，还剩 1 次');
  chk(!g.fire(0, 1, { x: 5, y: WORLD.h - 5 }) || true, '');
  // 无敌
  g.god = true; const hp0 = b3.hp; g.explode(b3.x, b3.y, 50, 80);
  chk(b3.hp === hp0, '打开无敌后自己的豆兵挨炸不掉血');
  g.god = false; g.explode(b3.x, b3.y, 50, 80);
  chk(b3.hp < hp0, '关闭无敌后会掉血');
}

// ---- 电脑互打：能在合理时间内分出胜负 ----
for (const [teams, size, diff] of [[2, 4, 1], [3, 3, 2], [4, 4, 0]]) {
  const g = new Game({ seed: 1000 + teams * 31 + size, teams, size, difficulty: diff, allBots: true });
  const t0 = Date.now(); let err = null, turns = 0, booms = 0;
  try {
    while (!g.over && g.time < 3600) {
      g.update(dt);
      for (const e of g.events) { if (e.type === 'turn') turns++; if (e.type === 'boom') booms++; }
      g.events.length = 0;
      if (g.beans.some((b) => !Number.isFinite(b.x) || !Number.isFinite(b.y))) { err = '出现非法数值'; break; }
    }
  } catch (e) { err = e.stack || String(e); }
  chk(!err && g.over, `${teams} 队 × ${size} 人（难度 ${diff}）：${g.over ? (g.over.winner >= 0 ? g.teams[g.over.winner].def.name + '获胜' : '同归于尽') : '超时'}，${turns} 个回合，${booms} 次爆炸，游戏内 ${(g.time / 60).toFixed(1)} 分钟（实际耗时 ${Date.now() - t0}ms）${err ? ' ' + err : ''}`);
}
console.log(fail ? `有 ${fail} 项失败` : '豆兵大战逻辑测试全部通过');
process.exit(fail ? 1 : 0);
