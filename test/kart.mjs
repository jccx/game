// 疾风卡丁的浏览器测试：菜单（开始按钮在顶部）、三条赛道开赛截图、模拟触屏操作、结算、检查报错。
// 用法：node test/kart.mjs [quick]   截图输出到 test/out/kart-*.png
import { launch, open, shot, VIEW, check, sleep } from './lib.mjs';
const quick = process.argv[2] === 'quick';
const ctx = await launch();
const log = [];
const bad = (errors) => errors.filter((e) => !e.includes('favicon'));
const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; });

// 1) 菜单：开始按钮在顶部，点了能开赛
for (const vname of quick ? ['landscape'] : ['landscape', 'portrait']) {
  const view = VIEW[vname];
  const { page, errors } = await open(ctx, '/kart/?q=1', view);
  await page.waitForSelector('.kmenu .start', { timeout: 20000 });
  await sleep(300);
  const b = await center(page, '.kmenu .start');
  check(b.top >= 0 && b.bottom < view.height * 0.3, `${vname} 菜单的“开始比赛”在屏幕顶部（${Math.round(b.top)}~${Math.round(b.bottom)}）`, log);
  await shot(page, `kart-menu-${vname}`);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForFunction('window.__kart.race && window.__kart.hud', { timeout: 30000 });
  await sleep(600);
  // 快进过倒计时，然后测操作：摇杆转向、漂移、氮气、刹车
  await page.evaluate(() => window.__kart.loop.fastForward(4.5));
  const st = () => page.evaluate(() => { const p = window.__kart.race.player; return { v: p.v, steer: p.in.steer, drift: p.in.drift, drifting: p.drifting, nitro: p.nitro, boostT: p.boostT, god: p.god, yaw: p.yaw, state: window.__kart.race.state }; });
  const a = await st();
  check(a.state === 'race' && a.v > 3, `${vname} 倒计时后自动给油，车在加速（${a.v.toFixed(1)} 米/秒）`, log);
  const jx = view.width * 0.2, jy = view.height * 0.8;
  await page.touchscreen.touchStart(jx, jy); await page.touchscreen.touchMove(jx + 50, jy); await sleep(350);
  const s1 = await st();
  check(s1.steer > 0.5, `${vname} 摇杆向右，方向盘向右（${s1.steer.toFixed(2)}）`, log);
  // 一边打方向一边按住漂移（多指）
  const d = await center(page, '.k-drift');
  await page.evaluate(() => { const p = window.__kart.race.player; p.v = 28; });
  const cdp = await page.createCDPSession();
  const pts = [{ x: jx + 50, y: jy, id: 0 }, { x: d.x, y: d.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  await sleep(500);
  const s2 = await st();
  await shot(page, `kart-${vname}-drift`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.touchscreen.touchEnd().catch(() => {});
  check(s2.drift && s2.drifting, `${vname} 同时按住漂移键和摇杆，车进入漂移`, log);
  await page.evaluate(() => { window.__kart.race.player.nitro = 1; });
  await sleep(250);
  const nb = await center(page, '.k-nitro');
  await page.touchscreen.tap(nb.x, nb.y); await sleep(300);
  const s3 = await st();
  check(s3.nitro === 0 && s3.boostT > 1, `${vname} 点氮气键后开始加速`, log);
  const ch = await center(page, '.cheat');
  await page.touchscreen.tap(ch.x, ch.y); await sleep(300);
  check((await st()).god, `${vname} 点“无敌”后打开`, log);
  // 让电脑代跑到终点，检查结算界面。先把玩家放回当前路段的中心线、朝向与路段一致：
  // 前面的手动操作（摇杆、漂移、氮气）可能把车甩到赛道外甚至调头，电脑代跑要从那种状态
  // 恢复过来耗时不定，400 秒未必够——结算检查测的是“跑完能出结算”，不是“电脑会调头”，
  // 所以代跑起点固定在中心线上。只改测试，不改游戏（2026-11-15：此检查在改动前就时好时坏，
  // 原始代码 5d7abfc5 上也复现过同样失败，横竖屏各一次）。
  await page.evaluate(() => {
    const m = window.__kart, r = m.race, p = r.player, s = r.track.s[p.si];
    p.x = s.x; p.z = s.z; p.yaw = Math.atan2(s.tx, s.tz); p.vdir = p.yaw; p.v = 0; p.off = 0;
    p.drifting = false; p.spinT = 0; p.in = { steer: 0, gas: false, brake: false, drift: false, boost: false, use: false };
    p.ai = { speed: 1, line: 0, lineT: 2, nitroT: 5, itemT: 0 };
    for (let i = 0; i < 400 && r.state !== 'done'; i++) m.loop.fastForward(1);
  });
  // 结算面板是冲线 2.6 秒（游戏内计时）后才弹出，无头帧率低时这 2.6 秒比真实 3.5 秒还长，
  // 所以不等固定时间，直接等到结算行出现（最多 15 秒）。只改测试，不改游戏。
  let end = null;
  try { end = await page.waitForSelector('.kend .kend-row', { timeout: 15000 }); } catch { /* 超时则 end 为空，下面判 FAIL */ }
  check(!!end, `${vname} 跑完三圈后出现结算名单`, log);
  await shot(page, `kart-${vname}-end`);
  check(bad(errors).length === 0, `${vname} 无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 2) 三条赛道各截一张比赛中的图
for (const id of quick ? ['forest'] : ['forest', 'desert', 'ice']) {
  const { page, errors } = await open(ctx, `/kart/?auto=1&track=${id}&bots=1&q=2`, VIEW.landscape);
  await page.waitForFunction('window.__kart.race && window.__kart.hud', { timeout: 30000 });
  await page.evaluate(() => window.__kart.loop.fastForward(14));
  await sleep(1500);
  await shot(page, `kart-${id}`);
  const info = await page.evaluate(() => ({ stats: window.__kart.stage.stats, v: window.__kart.race.player.v }));
  check(info.v > 5 && bad(errors).length === 0, `${id} 赛道比赛中：绘制 ${info.stats.calls} 次 / ${info.stats.tris} 三角形 ${bad(errors).slice(0, 2).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
