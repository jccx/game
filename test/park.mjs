// 梦想乐园的浏览器测试：菜单（开始按钮在顶部，五种手机尺寸）、铺路建施设、过山车编辑器、
// 游客进园、财务、存档、无敌、速度切换、检查报错。截图输出到 test/out/park-*.png
// 用法：CHROME=<chrome 路径> node test/park.mjs [quick]
import { launch, open, shot, VIEW, check, sleep } from './lib.mjs';
const quick = process.argv[2] === 'quick';
const ctx = await launch();
const log = [];
const bad = (errors) => errors.filter((e) => !e.includes('favicon'));
const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; });
const phone = (w, h) => ({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const views = quick
  ? { '横屏 844x390': phone(844, 390) }
  : { '横屏 844x390': phone(844, 390), '竖屏 390x844': phone(390, 844), '小屏横 667x375': phone(667, 375), '小屏竖 360x640': phone(360, 640), '矮横屏 740x320': phone(740, 320) };

// 在画布上点某格：用 View.tileToScreen 算出屏幕坐标再轻点
const tapTile = async (page, x, z) => {
  const pt = await page.evaluate((tx, tz) => window.__park.view.tileToScreen(tx, tz), x, z);
  await page.touchscreen.tap(pt.x, pt.y);
  await sleep(120);
};

// 1) 菜单：开始按钮在顶部、完整可见，点了能开局
for (const [name, view] of Object.entries(views)) {
  const { page, errors } = await open(ctx, '/park/?q=0', view);
  await page.waitForSelector('.pmenu .start', { timeout: 20000 });
  await sleep(300);
  const b = await center(page, '.pmenu .start');
  check(b.top >= 0 && b.bottom < view.height * 0.3, `${name} 菜单的“开始经营”在屏幕顶部（${Math.round(b.top)}~${Math.round(b.bottom)}，屏幕高 ${view.height}）`, log);
  await shot(page, 'park-menu-' + name.split(' ')[1]);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForFunction('window.__park.park && window.__park.hud', { timeout: 30000 });
  check(true, `${name}：点“开始经营”后进入乐园`, log);
  check(bad(errors).length === 0, `${name} 菜单无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 2) 横屏操作：铺路、建旋转木马、游客进园、钱变化
{
  const view = VIEW.landscape;
  const { page, errors } = await open(ctx, '/park/?auto=1&seed=42&q=0', view);
  await page.waitForFunction(() => window.__park.park && window.__park.view, { timeout: 30000 });
  await sleep(800);
  await shot(page, 'park-game-landscape');
  const state = () => page.evaluate(() => { const p = window.__park.park; return { money: p.money, paths: p.paths.size, buildings: p.buildings.length, visitors: p.visitors.length, served: p.served }; });
  const s0 = await state();
  // 选“铺路”，从入口广场向北铺到 (8,10)
  await page.evaluate(() => window.__park.hud.pickTool('path'));
  for (const [x, z] of [[10, 16], [9, 16], [8, 16], [8, 15], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10]]) await tapTile(page, x, z);
  const s1 = await state();
  check(s1.paths >= 8, `铺了 ${s1.paths} 格路（从入口广场到旋转木马门口）`, log);
  // 选“设施”→ 旋转木马，点 (8,8) 落子
  await page.evaluate(() => window.__park.hud.openBuildPanel('ride'));
  await sleep(300);
  await shot(page, 'park-build-panel');
  await page.evaluate(() => { [...document.querySelectorAll('.pp-row')].find((b) => b.textContent.includes('旋转木马'))?.click(); });
  await sleep(200);
  await tapTile(page, 8, 8);
  const s2 = await state();
  check(s2.buildings === 1 && s2.money < s1.money, `旋转木马建好了（建筑 ${s2.buildings} 个，钱从 ${s1.money} 变成 ${s2.money}）`, log);
  await shot(page, 'park-built');
  // 快进 90 秒游戏时间：游客应该进来玩
  await page.evaluate(() => window.__park.loop.fastForward(90));
  await sleep(600);
  const s3 = await state();
  check(s3.visitors > 0 || s3.served > 0, `快进 90 秒后有游客进园（在园 ${s3.visitors} 人，已服务 ${s3.served} 人）`, log);
  check(s3.money !== s2.money, `游客消费后钱变了（${s2.money} → ${s3.money}）`, log);
  await shot(page, 'park-visitors');
  // 无敌开关：一开一关
  const ch = await center(page, '.cheat');
  await page.touchscreen.tap(ch.x, ch.y); await sleep(200);
  check(await page.evaluate(() => window.__park.park.god), '点“免费建造”后打开', log);
  await page.touchscreen.tap(ch.x, ch.y); await sleep(200);
  check(!(await page.evaluate(() => window.__park.park.god)), '再点“免费建造”后关闭', log);
  // 速度按钮：1x → 2x
  const sp = await page.evaluate(() => { const b = [...document.querySelectorAll('.pbar .g-b')].find((e) => e.textContent === '1x'); b?.click(); return !!b; });
  check(sp && (await page.evaluate(() => window.__park.hud.speed)) === 2, '点速度按钮切到 2x', log);
  // 存档：点“存档”，localStorage 里要有 park-save-v1
  await page.evaluate(() => { [...document.querySelectorAll('.pbar .g-b')].find((e) => e.textContent === '存档')?.click(); });
  await sleep(300);
  check(await page.evaluate(() => !!localStorage.getItem('park-save-v1')), '点“存档”后 localStorage 里有 park-save-v1', log);
  check(bad(errors).length === 0, `横屏操作无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 3) 过山车编辑器：研究、建站台、UI 点 8 段轨道闭环
{
  const { page, errors } = await open(ctx, '/park/?auto=1&seed=7&q=0', VIEW.landscape);
  await page.waitForFunction(() => window.__park.park, { timeout: 30000 });
  await page.evaluate(() => {
    const p = window.__park.park;
    p.research('coaster');
    p.build('coaster', 14, 10);
    window.__park.view.dirty = true;
  });
  const st = await page.evaluate(() => ({ station: !!window.__park.park.coaster.station, money: window.__park.park.money }));
  check(st.station, '过山车站台建在 (14,10)', log);
  await page.evaluate(() => window.__park.hud.openCoasterPanel());
  await sleep(300);
  const segs = ['直行', '直行', '右转', '直行', '右转', '直行', '右转', '直行'];
  for (const name of segs) {
    await page.evaluate((n) => { [...document.querySelectorAll('.pp-btns .g-b')].find((b) => b.textContent.startsWith(n))?.click(); }, name);
    await sleep(150);
  }
  const closed = await page.evaluate(() => ({ closed: window.__park.park.coasterClosed, n: window.__park.park.coaster.segments.length }));
  check(closed.closed && closed.n === 8, `编辑器里点了 8 段轨道，闭环可运营（段数 ${closed.n}，闭环 ${closed.closed}）`, log);
  await shot(page, 'park-coaster');
  check(bad(errors).length === 0, `过山车编辑器无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 4) 竖屏开局 + 财务面板截图
{
  const { page, errors } = await open(ctx, '/park/?auto=1&seed=42&q=0', VIEW.portrait);
  await page.waitForFunction(() => window.__park.park, { timeout: 30000 });
  await page.evaluate(() => window.__park.loop.fastForward(30));
  await sleep(600);
  await shot(page, 'park-game-portrait');
  await page.evaluate(() => window.__park.hud.openFinancePanel());
  await sleep(300);
  await shot(page, 'park-finance');
  const fin = await page.evaluate(() => document.querySelector('.ppanel')?.textContent.includes('贷款'));
  check(!!fin, '竖屏下财务面板能打开并显示贷款', log);
  check(bad(errors).length === 0, `竖屏无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
