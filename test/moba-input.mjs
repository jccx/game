// 裂谷争锋的触屏操作测试：用模拟触摸推摇杆、按普攻、放技能、加点、买装备，检查英雄确实照做。
import { launch, open, shot, VIEW, check, sleep } from './lib.mjs';
const ctx = await launch();
const log = [];
for (const vname of ['landscape', 'portrait']) {
  const view = VIEW[vname];
  const { page, errors } = await open(ctx, '/moba/?auto=1&mode=1v1&hero=xinglan&q=0', view);
  await page.waitForFunction('window.__moba && window.__moba.game && window.__moba.hud', { timeout: 30000 });
  await sleep(800);
  const st = () => page.evaluate(() => { const p = window.__moba.game.player; return { x: p.x, z: p.z, lv: p.skillLv.slice(), cds: p.cds.slice(), mp: p.mp, items: p.items.length, gold: p.gold, atkSeq: p.atkSeq, castSeq: p.castSeq, pts: p.skillPts, recall: p.recallT }; });
  const center = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const a = await st();

  // 摇杆：在左下区域按住向右拖 1.2 秒
  const jx = view.width * 0.2, jy = view.height * 0.8;
  await page.touchscreen.touchStart(jx, jy);
  await page.touchscreen.touchMove(jx + 60, jy);
  await sleep(1200);
  const b = await st();
  await page.touchscreen.touchEnd();
  check(b.x - a.x > 1, `${vname} 摇杆向右，英雄向右移动了 ${(b.x - a.x).toFixed(1)}`, log);

  // 加点：点第一个技能的“+”（开局有 1 个技能点）
  await sleep(300);
  const hasPlus = await page.$eval('.plus.p1', (e) => e.classList.contains('show'));
  if (hasPlus) { const p = await center('.plus.p1'); await page.touchscreen.tap(p.x, p.y); await sleep(300); }
  const c = await st();
  check(c.lv[0] === 1, `${vname} 点“+”学会了一技能（等级 ${c.lv.join(',')}）`, log);

  // 技能：按住一技能向右上拖动再松手
  const s1 = await center('.b-s1');
  await page.touchscreen.touchStart(s1.x, s1.y);
  await page.touchscreen.touchMove(s1.x + 30, s1.y - 30);
  await sleep(250);
  await shot(page, `moba-input-${vname}-aim`);
  await page.touchscreen.touchEnd();
  await sleep(400);
  const d = await st();
  check(d.castSeq > c.castSeq && d.cds[0] > 0 && d.mp < c.mp, `${vname} 拖动一技能后释放成功（冷却 ${d.cds[0].toFixed(1)} 秒）`, log);

  // 取消施法：技能冷却好后，按住拖到“取消”处松手，不应释放
  await page.evaluate(() => { const p = window.__moba.game.player; p.cds[0] = 0; });
  const cz = await center('.cancel');
  await page.touchscreen.touchStart(s1.x, s1.y);
  await page.touchscreen.touchMove(cz.x, cz.y);
  await sleep(200);
  await page.touchscreen.touchEnd();
  await sleep(300);
  const e = await st();
  check(e.castSeq === d.castSeq, `${vname} 拖到取消区松手，技能没有放出`, log);

  // 普攻：把一个敌方小兵放到身边，点普攻键
  await page.evaluate(() => {
    const m = window.__moba, g = m.game, p = g.player;
    m.loop.fastForward(14);                                  // 等第一波兵出来
    const foe = g.units.find((u) => u.alive && u.kind === 2 && u.team === 1);
    foe.x = p.x + 4; foe.z = p.z; foe.px = foe.x; foe.pz = foe.z;
  });
  const before = await st();
  const atk = await center('.b-atk');
  await page.touchscreen.tap(atk.x, atk.y);
  await sleep(1200);
  const f = await st();
  check(f.atkSeq > before.atkSeq, `${vname} 点普攻后英雄出手了 ${f.atkSeq - before.atkSeq} 次`, log);

  // 购买：给够金币后点“快捷购买”
  await page.evaluate(() => { window.__moba.game.player.gold = 5000; });
  await sleep(400);
  const q = await center('.quick');
  await page.touchscreen.tap(q.x, q.y);
  await sleep(400);
  const h = await st();
  check(h.items === 1 && h.gold < 5000, `${vname} 快捷购买买到了装备`, log);

  // 商店面板
  const sb = await center('.shop-row .g-ic');
  await page.touchscreen.tap(sb.x, sb.y);
  await sleep(300);
  check(!!(await page.$('.shop .item')), `${vname} 商店面板能打开`, log);
  await shot(page, `moba-input-${vname}-shop`);
  await page.evaluate(() => window.__moba.hud.closeOverlay());

  // 作弊按钮：点一下无敌 15 秒，期间不掉血，15 秒后恢复正常
  const ch = await center('.cheat');
  await page.touchscreen.tap(ch.x, ch.y);
  await sleep(500);
  const god = await page.evaluate(() => {
    const m = window.__moba, g = m.game, p = g.player, foe = g.heroes.find((h) => h.team === 1);
    const t = p.godT, hp0 = p.hp;
    g.damage(foe, p, 800, 'true'); const hp1 = p.hp;
    p.stun(2); const stunned = p.stunT > 0;
    m.loop.fastForward(15.5);
    const tAfter = p.godT, hp2 = p.hp;
    g.damage(foe, p, 300, 'true');
    return { t, kept: hp1 === hp0, stunned, tAfter, hurtAfter: p.hp < hp2, label: document.querySelector('.cheat').textContent };
  });
  check(god.t > 13 && god.kept && !god.stunned, `${vname} 点作弊按钮后无敌（剩 ${god.t.toFixed(1)} 秒，挨打不掉血、不被眩晕）`, log);
  check(god.tAfter <= 0 && god.hurtAfter, `${vname} 15 秒后无敌结束，恢复会受伤`, log);

  // 回城
  await page.evaluate(() => { const g = window.__moba.game; for (const u of g.units) if (u.kind === 2) u.alive = false; });
  const rb = await center('.sum .b-sm');
  await page.touchscreen.tap(rb.x, rb.y);
  await sleep(500);
  const i = await st();
  check(i.recall > 0, `${vname} 点回城后开始引导`, log);

  // 结算界面
  await page.evaluate(() => { const g = window.__moba.game; g.kill(g.crystals[1], g.player); });
  await sleep(3200);
  check(!!(await page.$('.end .end-title')), `${vname} 水晶被毁后出现结算界面`, log);
  await shot(page, `moba-input-${vname}-end`);
  const errs = errors.filter((x) => !x.includes('favicon'));
  check(errs.length === 0, `${vname} 无报错 ${errs.slice(0, 3).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
