// 首页测试：横屏、竖屏、电脑三种尺寸下打开首页，检查卡片数量并截图。
import { launch, open, shot, VIEW, check } from './lib.mjs';
const ctx = await launch();
const log = [];
for (const [name, view] of Object.entries(VIEW)) {
  const { page, errors } = await open(ctx, '/', view);
  const n = await page.$$eval('.card', (c) => c.length);
  check(n === 5, `首页(${name}) 有 5 张卡片，实际 ${n}`, log);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, `首页(${name}) 没有横向溢出`, log);
  check(errors.filter((e) => !e.includes('favicon')).length === 0, `首页(${name}) 无报错 ${errors.join(' | ')}`, log);
  await shot(page, 'hub-' + name);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
