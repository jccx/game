// 裂谷争锋的纯逻辑测试：不开浏览器，让电脑互相打完整局，检查不出错、不出现非法数值、能在合理时间内分出胜负。
// 用法：node test/moba-sim.mjs [每种模式跑几局=1] [难度=1]
import { Game } from '../moba/js/game.js';
import { HEROES } from '../moba/js/heroes/index.js';
import { TICK } from '../moba/js/config.js';

const rounds = Number(process.argv[2]) || 1, diff = Number(process.argv[3] ?? 1);
const LIMIT = { '5v5': 40 * 60, '3v3': 25 * 60, '1v1': 20 * 60 };   // 超过这个游戏内时间还没结束算失败
let fail = 0;
for (const mode of ['1v1', '3v3', '5v5']) {
  for (let r = 0; r < rounds; r++) {
    const hero = HEROES[(r + (mode === '3v3' ? 2 : 0)) % HEROES.length].id;
    const g = new Game({ mode, hero, difficulty: diff, allBots: true });
    const t0 = Date.now();
    let maxUnits = 0, bad = null;
    try {
      while (!g.over && g.time < LIMIT[mode]) {
        g.update(1 / TICK);
        g.events.length = 0;
        if (g.units.length > maxUnits) maxUnits = g.units.length;
        if ((g.time * TICK | 0) % 30 === 0) {
          for (const u of g.units) if (!Number.isFinite(u.x) || !Number.isFinite(u.z) || !Number.isFinite(u.hp)) { bad = `非法数值 ${u.constructor.name} x=${u.x} z=${u.z} hp=${u.hp}`; break; }
          if (bad) break;
        }
      }
    } catch (e) { bad = '异常：' + (e.stack || e); }
    const ms = Date.now() - t0;
    const hs = g.heroes.map((h) => `${h.team ? '红' : '蓝'}${h.def.name} Lv${h.level} ${h.kills}/${h.deaths}/${h.assists} 金${Math.round(h.totalGold)} 装${h.items.length}`).join('\n    ');
    const towers = [0, 1].map((t) => g.towers.filter((x) => x.team === t && x.alive).length);
    const ok = !bad && g.over;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${mode} 玩家位=${hero} 结束=${g.over ? (g.over.winner ? '红方胜' : '蓝方胜') : '超时'} 游戏时间=${(g.time / 60).toFixed(1)}分 击杀 ${g.teamKills.join(':')} 剩塔 蓝${towers[0]} 红${towers[1]} 最多单位=${maxUnits} 实际耗时=${ms}ms (每帧 ${(ms / (g.time * TICK)).toFixed(3)}ms)${bad ? '\n  ' + bad : ''}\n    ${hs}`);
  }
}
console.log(fail ? `有 ${fail} 局失败` : '逻辑测试全部通过');
process.exit(fail ? 1 : 0);
