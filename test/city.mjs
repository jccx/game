// 落日湾的浏览器测试：横竖屏开局截图、各类载具截图、模拟触屏操作、面板不超出屏幕、检查报错。
// 用法：node test/city.mjs [quick]   截图输出到 test/out/city-*.png
import { launch, open, shot, VIEW, check, sleep } from './lib.mjs';
const quick = process.argv[2] === 'quick';
const ctx = await launch();
const log = [];
const bad = (errors) => errors.filter((e) => !e.includes('favicon'));
const ready = (page) => page.waitForFunction('window.__city && window.__city.sim && window.__city.hud && window.__city.loop', { timeout: 60000 });
const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: r.width > 0 && getComputedStyle(e).display !== 'none' }; });

for (const vname of quick ? ['landscape'] : ['landscape', 'portrait']) {
  const view = VIEW[vname];
  const { page, errors } = await open(ctx, '/city/?fresh=1&q=1', view);
  await ready(page);
  await sleep(1500);
  await shot(page, `city-${vname}-start`);
  const st = () => page.evaluate(() => { const s = window.__city.sim, p = s.player; return { x: p.x, z: p.z, veh: p.inVeh ? p.inVeh.type : null, speed: p.inVeh ? p.inVeh.speed : 0, stats: window.__city.stage.stats, cars: s.vehicles.length, peds: s.peds.length, god: p.godT > 0, hp: p.hp }; });
  const a = await st();
  // 摇杆走路
  const jx = view.width * 0.2, jy = view.height * 0.8;
  await page.touchscreen.touchStart(jx, jy); await page.touchscreen.touchMove(jx, jy - 60); await sleep(1500); await page.touchscreen.touchEnd();
  const b = await st();
  check(Math.hypot(b.x - a.x, b.z - a.z) > 0.8, `${vname} 推摇杆后人物移动了 ${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} 米`, log);
  // 走到车旁：出现“上车”键，点它上车
  await page.evaluate(() => { const s = window.__city.sim, p = s.player, v = s.vehicles.find((o) => o.type === 'sedan' && o.fixed); p.x = p.px = v.x + 2.6; p.z = p.pz = v.z; });
  await sleep(700);
  const en = await center(page, '.k-top');
  check(en.vis, `${vname} 走到车旁出现“上车”键`, log);
  await page.touchscreen.tap(en.x, en.y); await sleep(600);
  const c = await st();
  check(c.veh === 'sedan', `${vname} 点“上车”后坐进轿车`, log);
  // 按住油门
  const gas = await center(page, '.cpad .k-main:not([style*="none"])');
  await page.touchscreen.touchStart(gas.x, gas.y); await sleep(2500);
  const d = await st();
  await shot(page, `city-${vname}-drive`);
  await page.touchscreen.touchEnd();
  check(d.speed > 2, `${vname} 按住油门后车开动了（${(d.speed * 3.6).toFixed(0)} km/h）`, log);
  // 无敌开关
  const ch = await center(page, '.cheat');
  await page.touchscreen.tap(ch.x, ch.y); await sleep(300);
  const e = await st();
  check(e.god, `${vname} 点“无敌”后打开`, log);
  await page.touchscreen.tap(ch.x, ch.y); await sleep(300);
  check(!(await st()).god, `${vname} 再点一下关闭`, log);
  // 拖动右半屏转镜头
  const yaw0 = await page.evaluate(() => window.__city.view.camYaw);
  await page.touchscreen.touchStart(view.width * 0.6, view.height * 0.4); await page.touchscreen.touchMove(view.width * 0.6 + 80, view.height * 0.4); await sleep(200); await page.touchscreen.touchEnd();
  const yaw1 = await page.evaluate(() => window.__city.view.camYaw);
  check(Math.abs(yaw1 - yaw0) > 0.2, `${vname} 在屏幕上拖动能转镜头`, log);
  // 地图和设置面板不超出屏幕
  for (const [fn, sel, name] of [['openMap', '.cmap .cbox', '地图'], ['openSettings', '.cset .cbox', '设置']]) {
    await page.evaluate((f) => window.__city.hud[f](), fn); await sleep(300);
    const r = await page.$eval(sel, (el) => { const q = el.getBoundingClientRect(); return { ok: q.top >= 0 && q.bottom <= window.innerHeight + 0.5 && q.left >= 0 && q.right <= window.innerWidth + 0.5, top: Math.round(q.top), bottom: Math.round(q.bottom), vh: window.innerHeight }; });
    check(r.ok, `${vname} ${name}面板在屏幕内（${r.top}~${r.bottom}，屏幕高 ${r.vh}）`, log);
    if (fn === 'openMap') await shot(page, `city-${vname}-map`);
    await page.evaluate(() => window.__city.hud.closeOverlay());
  }
  check(d.stats.calls < 220, `${vname} 绘制调用 ${d.stats.calls} 次，${d.stats.tris} 个三角形，场上 ${d.cars} 辆车 ${d.peds} 个人`, log);
  check(bad(errors).length === 0, `${vname} 无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}

// 各类载具和场景各截一张图（只在完整模式下）
if (!quick) {
  const { page, errors } = await open(ctx, '/city/?fresh=1&q=2', VIEW.landscape);
  await ready(page);
  await sleep(1000);
  const ride = async (type, name, secs, extra) => {
    await page.evaluate((t) => {
      const s = window.__city.sim, p = s.player; if (p.inVeh) s.exitVehicle(true); p.hp = 100; p.godT = Infinity;
      const v = s.vehicles.find((o) => o.type === t && o.usable && !o.driver); s.enterVehicle(v); s.clearWanted(); s.heat = 0;
      window.__city.view.camYaw = v.yaw;
    }, type);
    // 锁住真实输入，由脚本直接给油门（无头浏览器渲染很慢，所以用快进而不是干等）
    await page.evaluate((x, secs) => {
      const m = window.__city, c = m.sim.ctl; m.hud.locked = true;
      c.steer = 0; c.gas = 1; c.pitch = x === 'plane' ? 1 : 0; c.fire = x === 'tank';
      m.loop.fastForward(secs);
    }, extra || type, secs);
    await sleep(1200);
    await shot(page, 'city-' + name);
    const r = await page.evaluate(() => { const m = window.__city, p = m.sim.player, v = p.inVeh, c = m.sim.ctl; c.gas = 0; c.pitch = 0; c.fire = false; m.hud.locked = false; return v ? { speed: v.speed, y: v.y, flying: v.flying, alive: v.alive } : null; });
    return r;
  };
  const boat = await ride('boat', 'boat', 4);
  check(boat && boat.speed > 3, `快艇在水上行驶（${boat ? (boat.speed * 3.6).toFixed(0) : '-'} km/h）`, log);
  const plane = await ride('plane', 'plane', 8);
  check(plane && plane.flying && plane.y > 8, `飞机起飞（高度 ${plane ? plane.y.toFixed(0) : '-'} 米）`, log);
  const tank = await ride('tank', 'tank', 3);
  check(tank && tank.alive, '坦克行驶并开炮', log);
  // 市中心步行视角
  await page.evaluate(() => { const s = window.__city.sim, p = s.player; s.exitVehicle(true); p.hp = 100; const n = s.world.node(7, 7); p.x = p.px = n.x + 9.5; p.z = p.pz = n.z + 9.5; window.__city.view.camYaw = 0.8; window.__city.loop.fastForward(20); });
  await sleep(2500);
  await shot(page, 'city-downtown');
  check(bad(errors).length === 0, `载具巡礼无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
