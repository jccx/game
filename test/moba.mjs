// 裂谷争锋的浏览器测试：菜单、三种模式开局、横竖屏截图、快进对局、检查报错。
// 用法：node test/moba.mjs [quick]   截图输出到 test/out/moba-*.png
import { launch, open, shot, VIEW, check, sleep } from './lib.mjs';
const quick = process.argv[2] === 'quick';
const ctx = await launch();
const log = [];
const bad = (errors) => errors.filter((e) => !e.includes('favicon'));

// 1) 菜单
for (const name of quick ? ['landscape'] : ['landscape', 'portrait']) {
  const { page, errors } = await open(ctx, '/moba/?q=1', VIEW[name]);
  await page.waitForSelector('.menu .hero img', { timeout: 20000 });
  await sleep(400);
  check((await page.$$eval('.hero', (c) => c.length)) === 5, `菜单(${name}) 有 5 个英雄`, log);
  check(bad(errors).length === 0, `菜单(${name}) 无报错 ${bad(errors).join(' | ')}`, log);
  await shot(page, 'moba-menu-' + name);
  await page.close();
}

// 2) 各模式开局并快进
const cases = quick ? [['5v5', 'liefeng', 'landscape']] : [['5v5', 'liefeng', 'landscape'], ['5v5', 'xinglan', 'portrait'], ['3v3', 'lingyu', 'landscape'], ['1v1', 'yesun', 'portrait'], ['5v5', 'panyue', 'desktop']];
for (const [mode, hero, vname] of cases) {
  const { page, errors } = await open(ctx, `/moba/?auto=1&mode=${mode}&hero=${hero}&bots=1&q=1`, VIEW[vname]);
  await page.waitForFunction('window.__moba && window.__moba.game && window.__moba.view', { timeout: 30000 });
  await sleep(1500);
  await shot(page, `moba-${mode}-${vname}-start`);
  // 快进 75 秒游戏时间，让兵线接上、英雄开打
  await page.evaluate(() => { const m = window.__moba; m.loop.fastForward(75); });
  await sleep(1500);
  await shot(page, `moba-${mode}-${vname}-fight`);
  const info = await page.evaluate(() => { const m = window.__moba, g = m.game; return { t: g.time, units: g.units.length, stats: m.stage.stats, lv: g.player.level, over: !!g.over }; });
  check(info.t > 70, `${mode}/${vname} 对局在推进（${info.t.toFixed(0)} 秒，${info.units} 个单位，绘制 ${info.stats.calls} 次 / ${info.stats.tris} 三角形）`, log);
  check(bad(errors).length === 0, `${mode}/${vname} 无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
