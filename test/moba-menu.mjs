// 裂谷争锋菜单测试：在几种手机尺寸下，“开始对战”按钮必须在屏幕顶部、完整可见，点它能开局；
// 菜单内容能滚动；对局中的商店面板也不能超出屏幕。
import { launch, open, shot, check, sleep } from './lib.mjs';
const ctx = await launch();
const log = [];
const phone = (w, h) => ({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const views = { '横屏 844x390': phone(844, 390), '竖屏 390x844': phone(390, 844), '小屏横 667x375': phone(667, 375), '小屏竖 360x640': phone(360, 640), '矮横屏 740x320': phone(740, 320) };
for (const [name, view] of Object.entries(views)) {
  const { page, errors } = await open(ctx, '/moba/?q=0', view);
  await page.waitForSelector('.menu .start', { timeout: 20000 });
  await sleep(300);
  const inView = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { ok: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 0.5 && r.right <= window.innerWidth + 0.5 && r.height > 20, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; });
  const st = await inView('.menu .start');
  check(st.ok && st.bottom < st.vh * 0.3, `${name}：“开始对战”在屏幕顶部且完整可见（按钮 ${st.top}~${st.bottom}，屏幕高 ${st.vh}）`, log);
  const sc = await page.$eval('.menu-body', (e) => ({ can: e.scrollHeight > e.clientHeight + 2, h: e.clientHeight }));
  check(sc.h > 60, `${name}：菜单内容区高度 ${sc.h}px${sc.can ? '，可以滚动' : '，一屏放得下'}`, log);
  await shot(page, 'moba-menu-' + name.split(' ')[1]);
  // 点“开始对战”应当进入对局
  const b = await page.$eval('.menu .start', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForFunction('window.__moba.game && window.__moba.hud', { timeout: 30000 }).catch(() => {});
  const started = await page.evaluate(() => !!(window.__moba.game && window.__moba.hud));
  check(started, `${name}：点“开始对战”后进入对局`, log);
  if (started) {
    await sleep(500);
    // 商店面板不能超出屏幕
    await page.evaluate(() => window.__moba.hud.openShop());
    await sleep(200);
    const bx = await inView('.shop .box');
    check(bx.ok, `${name}：商店面板在屏幕内（${bx.top}~${bx.bottom}，屏幕高 ${bx.vh}）`, log);
    await page.evaluate(() => { const h = window.__moba.hud; h.closeOverlay(); h.openSettings(); });
    await sleep(200);
    const sx = await inView('.set .box');
    check(sx.ok, `${name}：设置面板在屏幕内（${sx.top}~${sx.bottom}）`, log);
  }
  const errs = errors.filter((x) => !x.includes('favicon'));
  check(errs.length === 0, `${name}：无报错 ${errs.slice(0, 2).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
