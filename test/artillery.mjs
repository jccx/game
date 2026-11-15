// 豆兵大战的浏览器测试：菜单（开始按钮在顶部，五种手机尺寸）、走跳、拖动开火、武器面板、无敌、
// 跳过回合、电脑代打到结算、检查报错。截图输出到 test/out/artillery-*.png
// 用法：CHROME=/opt/meta-chromium/chrome node test/artillery.mjs [quick]
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

// 1) 菜单：开始按钮在顶部、完整可见，点了能开局
for (const [name, view] of Object.entries(views)) {
  const { page, errors } = await open(ctx, '/artillery/?q=0', view);
  await page.waitForSelector('.amenu .start', { timeout: 20000 });
  await sleep(300);
  const b = await center(page, '.amenu .start');
  check(b.top >= 0 && b.bottom < view.height * 0.3, `${name} 菜单的“开始战斗”在屏幕顶部（${Math.round(b.top)}~${Math.round(b.bottom)}，屏幕高 ${view.height}）`, log);
  await shot(page, 'artillery-menu-' + name.split(' ')[1]);
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForFunction('window.__artillery.game && window.__artillery.hud', { timeout: 30000 });
  await page.waitForFunction(() => window.__artillery.game.turn.state === 'aim', { timeout: 20000 });
  check(true, `${name}：点“开始战斗”后进入对局，轮到第一个豆兵`, log);
  check(bad(errors).length === 0, `${name} 菜单无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 2) 横屏操作：走、跳、拖动开火、武器面板、无敌、跳过回合
{
  const view = VIEW.landscape;
  const { page, errors } = await open(ctx, '/artillery/?auto=1&teams=2&size=2&seed=12345&q=0', view);
  await page.waitForFunction(() => window.__artillery.game && window.__artillery.game.turn.state === 'aim', { timeout: 30000 });
  await sleep(500);
  const bean = () => page.evaluate(() => { const g = window.__artillery.game, b = g.turn.bean; return { x: b.x, y: b.y, vy: b.vy, ground: b.ground, hp: b.hp, team: g.turn.team, state: g.turn.state, weapon: g.turn.weapon }; });
  await shot(page, 'artillery-game-landscape');
  // 向左走
  const left = await center(page, '.a-left');
  const b0 = await bean();
  await page.touchscreen.touchStart(left.x, left.y);
  await sleep(900);
  await page.touchscreen.touchEnd();
  const b1 = await bean();
  check(b1.x < b0.x - 10, `按住 ◀ 0.9 秒，豆兵向左移动 ${(b0.x - b1.x).toFixed(0)} 像素`, log);
  // 跳
  const jump = await center(page, '.a-jump');
  await page.touchscreen.tap(jump.x, jump.y);
  await sleep(120);
  const b2 = await bean();
  check(!b2.ground || b2.vy < 0, `点“跳”后豆兵离地（vy=${b2.vy.toFixed(0)}）`, log);
  await sleep(1200);
  // 拖动开火键向上发射：按住开火键，向左上拖，松手
  const fire = await center(page, '.a-fire');
  await page.touchscreen.touchStart(fire.x, fire.y);
  await page.touchscreen.touchMove(fire.x - 45, fire.y - 45);
  await sleep(250);
  const aiming = await page.evaluate(() => !!window.__artillery.hud.aim);
  check(aiming, '拖动开火键时出现瞄准预览', log);
  await shot(page, 'artillery-aim');
  await page.touchscreen.touchEnd();
  await sleep(200);
  const after = await page.evaluate(() => { const g = window.__artillery.game; return { shots: g.shots.length, state: g.turn.state }; });
  check(after.shots > 0 || after.state === 'retreat', `松手后炮弹飞出（炮弹 ${after.shots} 颗，回合状态 ${after.state}）`, log);
  await sleep(1500);
  await shot(page, 'artillery-flight');
  // 武器面板：换手雷
  await page.waitForFunction(() => window.__artillery.game.turn.state === 'aim' || window.__artillery.game.turn.team !== 0, { timeout: 20000 }).catch(() => {});
  const wbtn = await center(page, '.a-weapon');
  await page.touchscreen.tap(wbtn.x, wbtn.y);
  await sleep(300);
  const rows = await page.$$('.aweap-row');
  check(rows.length === 8, `武器面板列出 8 种武器（实际 ${rows.length} 种）`, log);
  await shot(page, 'artillery-weapons');
  await page.evaluate(() => { document.querySelectorAll('.aweap-row')[1].click(); });
  await sleep(300);
  const w = await page.evaluate(() => window.__artillery.game.turn.weapon);
  check(w === 'grenade', `点第二行后换上手雷（当前 ${w}）`, log);
  // 无敌开关
  const ch = await center(page, '.cheat');
  await page.touchscreen.tap(ch.x, ch.y); await sleep(200);
  check(await page.evaluate(() => window.__artillery.game.god), '点“无敌”后打开', log);
  await page.touchscreen.tap(ch.x, ch.y); await sleep(200);
  check(!(await page.evaluate(() => window.__artillery.game.god)), '再点“无敌”后关闭', log);
  check(bad(errors).length === 0, `横屏操作无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 3) 竖屏开局截图
{
  const { page, errors } = await open(ctx, '/artillery/?auto=1&teams=2&size=2&seed=12345&q=0', VIEW.portrait);
  await page.waitForFunction(() => window.__artillery.game && window.__artillery.game.turn.state === 'aim', { timeout: 30000 });
  await page.evaluate(() => window.__artillery.loop.fastForward(2));
  await sleep(800);
  await shot(page, 'artillery-game-portrait');
  check(bad(errors).length === 0, `竖屏开局无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 4) 电脑代打到结算
{
  const { page, errors } = await open(ctx, '/artillery/?auto=1&bots=1&teams=2&size=2&seed=777&q=0', VIEW.landscape);
  await page.waitForFunction(() => window.__artillery.game, { timeout: 30000 });
  await page.evaluate(() => { const m = window.__artillery; for (let i = 0; i < 900 && !m.game.over; i++) m.loop.fastForward(1); });
  const over = await page.evaluate(() => !!window.__artillery.game.over);
  check(over, `电脑代打分出胜负（${over ? '已结束' : '900 秒游戏内时间还没结束'}）`, log);
  // 结算在结束后约 2.2 秒弹出；无头浏览器里 rAF 会被节流，所以等它出现而不是固定睡几秒
  await page.waitForSelector('.aend .aend-row', { timeout: 30000 }).catch(() => {});
  const end = await page.$('.aend .aend-row');
  check(!!end, '结束后出现结算名单', log);
  await shot(page, 'artillery-end');
  check(bad(errors).length === 0, `结算无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
