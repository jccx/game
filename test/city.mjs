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
  await page.waitForFunction(() => { const b = document.querySelector('.k-top'); return b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0; }, { timeout: 15000 }).catch(() => null);
  const en = await center(page, '.k-top');
  check(en.vis, `${vname} 走到车旁出现“上车”键`, log);
  await page.touchscreen.tap(en.x, en.y); await sleep(600);
  const c = await st();
  check(c.veh === 'sedan', `${vname} 点“上车”后坐进轿车`, log);
  // 按住油门（无头帧率低时固定等 2.5 秒不够车加速到 2 米/秒：等到速度达标为止，最多 10 秒）
  const gas = await center(page, '.cpad .k-main:not([style*="none"])');
  await page.touchscreen.touchStart(gas.x, gas.y);
  await page.waitForFunction(() => { const s = window.__city.sim, p = s.player; return p.inVeh && p.inVeh.speed > 2; }, { timeout: 10000 }).catch(() => null);
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
  // 码头边上船：下车后瞬移到码头边，出现“上车”键，点它上船（2026-11-21：船原来系在 11 米外，码头边按上车够不着）
  await page.evaluate(() => { const s = window.__city.sim, p = s.player, pier = s.world.places.pier; if (p.inVeh) s.exitVehicle(); const b = s.vehicles.find((o) => o.type === 'boat'); const cx = Math.min(Math.max(b.x, pier.x0), pier.x1), cz = Math.min(Math.max(b.z, pier.z0), pier.z1); p.x = p.px = cx; p.z = p.pz = cz; p.y = 2; });
  await page.waitForFunction(() => { const b = document.querySelector('.k-top'); return b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0; }, { timeout: 15000 }).catch(() => null);
  const en2 = await center(page, '.k-top');
  check(en2.vis, `${vname} 站在码头边出现“上车”键`, log);
  await page.touchscreen.tap(en2.x, en2.y); await sleep(600);
  const cb = await st();
  check(cb.veh === 'boat', `${vname} 点“上车”后坐进快艇`, log);
  await shot(page, `city-${vname}-boat`);
  await page.evaluate(() => { const s = window.__city.sim; if (s.player.inVeh) s.exitVehicle(); });
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
// 跑步模式（锁定开关 + 令牌桶，2026-11-25 用户定）：点一下开、再点一下关，不用按住；桶 30 秒，跑动扣、步行回，扣空强制步行（只在完整模式下）
if (!quick) {
  const { page, errors } = await open(ctx, '/city/?fresh=1&q=1', VIEW.landscape);
  await ready(page);
  await sleep(1200);
  const runState = () => page.evaluate(() => { const m = window.__city, s = m.sim, p = s.player; return { speed: p.speed, running: p.running, toggle: s.runToggle, left: s.runBudgetLeft(), ready: s.runReady(), badge: m.hud.bRun.badgeEl.textContent, label: m.hud.bRun.labelEl.textContent, on: m.hud.bRun.el.classList.contains('on'), off: m.hud.bRun.el.classList.contains('off') }; });
  const freeze = () => page.evaluate(() => { const m = window.__city, c = m.sim.ctl; c.mx = 0; c.mz = 0; m.sim.runToggle = false; });
  // 传到市中心人行道，锁住真实输入，由脚本直接拨开关和给方向（和载具巡礼一样用快进）
  await page.evaluate(() => { const m = window.__city, s = m.sim, p = s.player; if (p.inVeh) s.exitVehicle(true); p.hp = 100; const n = s.world.node(7, 7); p.x = p.px = n.x + 9.5; p.z = p.pz = n.z + 9.5; m.hud.locked = true; });
  await page.evaluate(() => { const m = window.__city, c = m.sim.ctl; c.mx = 0; c.mz = -1; m.sim.toggleRun(); m.loop.fastForward(1); });
  let r = await runState();
  check(r.toggle && r.running && r.speed > 18, `点一下开关跑起来了（${r.speed.toFixed(1)} 米/秒，约 3 倍步行）`, log);
  check(Math.abs(r.left - 29) < 1, `跑 1 秒扣 1 秒预算（剩 ${r.left.toFixed(1)} 秒）`, log);
  await freeze();
  // 等角标真的刷到 29s 再读：HUD 是 0.1 秒一刷，无头下帧率低，固定睡 600 毫秒有时读早了
  //（角标还是初始的 30s），和武器切换那处一样改成等条件而不是等固定时间。
  await page.waitForFunction(`window.__city.hud.bRun.badgeEl.textContent === '29s'`, { timeout: 5000 }).catch(() => {});
  r = await runState();
  check(r.badge === '29s', `跑步键角标显示剩余 29s（实测“${r.badge}”）`, log);
  // 跑满 30 秒扣空：每 0.5 秒传回原地（往北跑 30 秒会进河，水里不跑也不回桶），一锁死就停——不停的话锁死后每 chunk 还在走路回桶
  await page.evaluate(() => { const m = window.__city, s = m.sim, p = s.player, c = s.ctl; const n = s.world.node(7, 7); c.mx = 0; c.mz = -1; m.sim.toggleRun(); for (let i = 0; i < 90 && !s.runLocked; i++) { m.loop.fastForward(0.5); p.x = p.px = n.x + 9.5; p.z = p.pz = n.z + 9.5; } });
  r = await runState();
  check(!r.running && r.speed < 7, '预算扣空后强制步行（开关已自动关了）', log);
  check(r.left < 1, `扣空后桶里不到 1 秒（剩 ${r.left.toFixed(1)} 秒）`, log);
  await freeze();
  await sleep(600);
  r = await runState();
  check(r.off, '扣空后跑步键变灰（锁死期）', log);
  // 走 6 秒回 6 秒，解锁，又能跑了
  await page.evaluate(() => { const m = window.__city, c = m.sim.ctl; c.mx = 0; c.mz = -1; m.loop.fastForward(6); });
  await sleep(600);   // 等 HUD 刷新跑步键（0.1 秒一刷，无头下帧率低，读早了按钮还是灰的）
  r = await runState();
  check(Math.abs(r.left - 6) < 1.5 && r.ready && !r.off, `走 6 秒回 6 秒预算，跑步键恢复（剩 ${r.left.toFixed(1)} 秒）`, log);
  await page.evaluate(() => { const m = window.__city, c = m.sim.ctl; m.sim.toggleRun(); m.loop.fastForward(1); });
  r = await runState();
  check(r.running && r.speed > 18, '回满 5 秒解锁，又能跑了', log);
  // 锁定开关：点一下跑步键关，再点一下开（文案和高亮跟着变）
  await page.evaluate(() => { const b = window.__city.hud.bRun.el; b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })); });
  await sleep(600);   // 等 HUD 刷新按钮（0.1 秒一刷）
  r = await runState();
  check(!r.toggle && r.label === '跑步' && !r.on, '点一下跑步键，开关关了（文案变回“跑步”、高亮没了）', log);
  await page.evaluate(() => { const b = window.__city.hud.bRun.el; b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })); });
  await sleep(600);
  r = await runState();
  check(r.toggle && r.label === '跑步中' && r.on, '再点一下跑步键，开关开了（文案“跑步中”、按钮高亮）', log);
  // 锁定开关：按一下 Shift 关，再按一下开（键盘走真实按键事件，HUD 输入要先解锁；W 按住让角色一直往前走，不然站着看不出跑没跑）
  await page.evaluate(() => { const m = window.__city; m.hud.locked = false; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: false })); });
  await page.evaluate(() => { const m = window.__city; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', repeat: false })); m.loop.fastForward(0.3); });
  r = await runState();
  check(!r.toggle && !r.running && r.speed > 5 && r.speed < 7, `按一下 Shift，跑步开关关了（变回步行 ${r.speed.toFixed(1)} 米/秒）`, log);
  await page.evaluate(() => { const m = window.__city; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', repeat: false })); m.loop.fastForward(0.3); });
  r = await runState();
  check(r.toggle && r.running && r.speed > 18, '再按一下 Shift，跑步开关又开了', log);
  await page.evaluate(() => { const m = window.__city; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); m.hud.locked = true; });
  check(bad(errors).length === 0, `跑步流程无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}
// 新功能：出生全武器、自动补满、直升机、行人密度——五种手机尺寸横竖屏（只在完整模式下）
if (!quick) {
  const phone = (w, h) => ({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const sizes = { 'landscape-844x390': phone(844, 390), 'portrait-390x844': phone(390, 844), 'small-land-667x375': phone(667, 375), 'small-port-360x640': phone(360, 640), 'short-land-740x320': phone(740, 320) };
  for (const [name, view] of Object.entries(sizes)) {
    const { page, errors } = await open(ctx, '/city/?fresh=1&q=1', view);
    await ready(page);
    await sleep(1200);
    // 竖屏铺满：画布必须盖满整个视口（2026-11-22：fitViewport 曾按 visualViewport 高度排版，
    // 手机浏览器工具栏一出现就上下留黑边）。竖屏再模拟工具栏（visualViewport 变矮且顶边下移），
    // 确认画布仍铺满——这是黑边的回归检查；同时确认竖屏 HUD 控件没有被裁到视口外。
    const cover = await page.evaluate(async () => {
      const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const full = () => { const c = rect('canvas.g-canvas'); return !!c && Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1 && Math.abs(c.w - window.innerWidth) <= 1 && Math.abs(c.h - window.innerHeight) <= 1; };
      const out = { base: full(), toolbar: null, restored: null, hud: null };
      if (window.innerHeight > window.innerWidth) {
        const fake = { width: window.innerWidth, height: Math.round(window.innerHeight * 0.83), offsetTop: Math.round(window.innerHeight * 0.08), offsetLeft: 0, scale: 1, addEventListener() {}, removeEventListener() {}, onresize: null, onscroll: null };
        const realVV = window.visualViewport;   // 先存真 visualViewport
        Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => setTimeout(r, 150));
        out.toolbar = full();
        // 直接 delete 恢复不了：visualViewport 是 window 自身的访问器属性，
        // 删掉影子属性后它就是 undefined（2026-11-22 实测），必须用存下的真对象贴回去。
        Object.defineProperty(window, 'visualViewport', { value: realVV, configurable: true });
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => setTimeout(r, 150));
        out.restored = full();
        out.hud = ['.g-joy', '.k-main', '.k-mid', '.k-left'].every((sel) => {
          const e = document.querySelector(sel); if (!e) return false;
          const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return true;
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.left >= -1 && b.top >= -1 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1;
        });
      }
      return out;
    });
    check(cover.base, `${name} 画布铺满整个视口（无黑边）`, log);
    if (cover.toolbar !== null) {
      check(cover.toolbar, `${name} 模拟手机工具栏（visualViewport 变矮）后画布仍铺满`, log);
      check(cover.restored, `${name} 工具栏消失后画布恢复铺满`, log);
      check(cover.hud, `${name} 竖屏 HUD 控件（摇杆/开火/跑步/换武器）全部在视口内`, log);
      // 工具栏收起（2026-11-22 底部黑边根因）：innerHeight 变回全高，但只触发
      // visualViewport 事件、不触发 window resize——真机上 window resize 可能在
      // 工具栏动画开始就触发、读到旧高度。fitViewport 必须听 visualViewport 的
      // resize/scroll 才能跟上；这里把 innerHeight 影子化来模拟，只留 vv 事件。
      const collapse = await page.evaluate(async () => {
        const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
        const origH = window.innerHeight;
        const vv = window.visualViewport;   // 真 visualViewport（前面的 cover 检查已把它恢复好）
        // innerHeight 是 window 自身的访问器属性：直接 delete 会把它整个删掉、
        // 之后读到 undefined（2026-11-22 实测），所以先存描述符、用它恢复。
        const ihDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        const appH = () => getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim();
        const full = () => { const c = document.querySelector('canvas.g-canvas'); if (!c) return false; const b = c.getBoundingClientRect(); return Math.abs(b.x) <= 1 && Math.abs(b.y) <= 1 && Math.abs(b.width - window.innerWidth) <= 1 && Math.abs(b.height - window.innerHeight) <= 1; };
        const shrink = Math.round(origH * 0.83);
        const out = { vvExists: !!vv };
        if (!vv) return out;
        // 收起路径 1：只触发 visualViewport resize
        Object.defineProperty(window, 'innerHeight', { value: shrink, configurable: true });
        window.dispatchEvent(new Event('resize'));
        await sleep2(150);
        out.shrunk = appH() === shrink + 'px';
        Object.defineProperty(window, 'innerHeight', { value: origH, configurable: true });
        vv.dispatchEvent(new Event('resize'));
        await sleep2(200);
        out.vvResize = full();
        // 收起路径 2：只触发 visualViewport scroll（工具栏收起时 offsetTop 也会变）
        Object.defineProperty(window, 'innerHeight', { value: shrink, configurable: true });
        window.dispatchEvent(new Event('resize'));
        await sleep2(150);
        Object.defineProperty(window, 'innerHeight', { value: origH, configurable: true });
        vv.dispatchEvent(new Event('scroll'));
        await sleep2(200);
        out.vvScroll = full();
        Object.defineProperty(window, 'innerHeight', ihDesc);   // 用存下的描述符恢复真 innerHeight
        window.dispatchEvent(new Event('resize'));
        await sleep2(150);
        out.restored = full();
        return out;
      });
      check(collapse.vvExists, `${name} 真 visualViewport 可用`, log);
      check(collapse.shrunk, `${name} 模拟工具栏出现后 --app-h 跟着变矮`, log);
      check(collapse.vvResize, `${name} 工具栏收起（只触发 visualViewport resize）后画布恢复铺满`, log);
      check(collapse.vvScroll, `${name} 工具栏收起（只触发 visualViewport scroll）后画布恢复铺满`, log);
      check(collapse.restored, `${name} 恢复真实 innerHeight 后画布仍铺满`, log);
    }
    // 出生全武器：数字键 1~6 直接切
    const spawn = await page.evaluate(() => { const p = window.__city.sim.player; return { owned: p.owned.slice(), ammo: p.ammo.slice() }; });
    check(spawn.owned.every(Boolean) && spawn.ammo[1] === 80 && spawn.ammo[4] === 6 && spawn.ammo[5] === 4, `${name} 出生拥有全部 6 种武器（手枪 80 发、火箭筒 6 发、烟花 4 发）`, log);
    // 注意：无头浏览器 rAF 会被节流，固定睡 200 毫秒可能等不到下一帧、按键还没被读到；改成等到武器真的切过去
    await page.keyboard.press('Digit3');
    await page.waitForFunction('window.__city.sim.player.weapon === 2', { timeout: 5000 }).catch(() => {});
    let w = await page.evaluate(() => window.__city.sim.player.weapon);
    check(w === 2, `${name} 按数字键 3 切到冲锋枪`, log);
    await page.keyboard.press('Digit5');
    await page.waitForFunction('window.__city.sim.player.weapon === 4', { timeout: 5000 }).catch(() => {});
    w = await page.evaluate(() => window.__city.sim.player.weapon);
    check(w === 4, `${name} 按数字键 5 切到火箭筒`, log);
    // 烟花：数字键 6 切过去，开一轮恰好 8 枚、只耗 1 发弹药
    await page.keyboard.press('Digit6');
    await page.waitForFunction('window.__city.sim.player.weapon === 5', { timeout: 5000 }).catch(() => {});
    w = await page.evaluate(() => window.__city.sim.player.weapon);
    check(w === 5, `${name} 按数字键 6 切到烟花`, log);
    const r360 = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player;
      p.hp = 100; p.godT = Infinity; p.weapon = 5; p.shootCd = 0;
      m.hud.locked = true;   // 锁住真实输入，免得 readInput() 每帧覆盖 ctl.fire
      s.ctl.aimYaw = 0; s.ctl.aimSet = true; s.ctl.fire = true;
      const before = s.shots.length;
      s.update(1 / 30); s.ctl.fire = false; m.hud.locked = false;
      return { n: s.shots.length - before, ammo: p.ammo[5] };
    });
    check(r360.n === 8 && r360.ammo === 3, `${name} 烟花 开一轮齐射 8 枚、只耗 1 发弹药（剩 ${r360.ammo} 发）`, log);
    // 打空一把自动补满：只剩 1 发时开一枪
    const refill = await page.evaluate(() => {
      const s = window.__city.sim, p = s.player;
      p.weapon = 1; p.ammo[1] = 1; p.shootCd = 0; s.ctl.aimYaw = 0; s.ctl.fire = true;
      s.update(1 / 30); s.ctl.fire = false; s.events.length = 0;
      return p.ammo[1];
    });
    check(refill === 80, `${name} 手枪剩 1 发时开一枪，打空后自动补满到 80 发（当前 ${refill}）`, log);
    // 射速统一 10 发/秒：步行按住火箭筒开火 2 秒，数攻击次数（atkSeq 每开一火加 1）
    const rate = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, c = s.ctl;
      p.hp = 100; p.godT = Infinity; p.weapon = 4; p.shootCd = 0;
      m.hud.locked = true;   // 锁住真实输入，免得 readInput() 每帧覆盖 ctl.fire
      c.aimYaw = 0; c.aimSet = true; c.fire = true;
      const a0 = p.atkSeq; m.loop.fastForward(2); c.fire = false; m.hud.locked = false;
      return p.atkSeq - a0;
    });
    check(rate >= 18 && rate <= 22, `${name} 按住火箭筒开火 2 秒 ${rate} 发（机关枪同速 10 发/秒）`, log);
    await shot(page, `city-firerate-${name}`);
    // 直升机：上机、原地升空、悬停、降落、下机
    await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, h = s.vehicles.find((v) => v.type === 'heli');
      p.hp = 100; p.godT = Infinity;
      p.x = p.px = h.x + 2.5; p.z = p.pz = h.z; p.y = s.world.groundY(p.x, p.z);
      m.hud.locked = true;
      s.ctl.enter = true; s.update(1 / 30); s.events.length = 0;
    });
    let st = await page.evaluate(() => { const s = window.__city.sim; return { veh: s.player.inVeh ? s.player.inVeh.type : null }; });
    check(st.veh === 'heli', `${name} 走到机场直升机旁上机`, log);
    await page.evaluate(() => { const m = window.__city, c = m.sim.ctl; c.pitch = 1; c.gas = 0; m.loop.fastForward(3); c.pitch = 0; });   // 升空后立即收杆，不然真实循环在截图等待时还会继续爬升
    await sleep(600);
    await shot(page, `city-heli-${name}`);
    st = await page.evaluate(() => { const v = window.__city.sim.player.inVeh; return { flying: v.flying, y: v.y, speed: v.speed }; });
    check(st.flying && st.y > 20 && Math.abs(st.speed) < 1, `${name} 直升机原地升空到 ${st.y.toFixed(0)} 米（不用跑道）`, log);
    const hover = await page.evaluate(() => {
      const m = window.__city, c = m.sim.ctl, v = m.sim.player.inVeh, y0 = v.y;
      c.pitch = 0; c.gas = 0; c.steer = 0; m.loop.fastForward(2);
      return { dy: Math.abs(v.y - y0), flying: v.flying };
    });
    check(hover.flying && hover.dy < 1.5, `${name} 悬停 2 秒高度变化 ${hover.dy.toFixed(1)} 米`, log);
    const land = await page.evaluate(() => {
      const m = window.__city, c = m.sim.ctl, v = m.sim.player.inVeh;
      const secs = Math.ceil((v.y - 2) / 5.2) + 2;   // 轻推是 -5.2 米/秒，按实际高度算够用的时间
      c.pitch = -0.4; c.gas = 0; c.steer = 0; m.loop.fastForward(secs);
      const ok = !v.flying && v.alive;
      if (ok) { m.sim.ctl.enter = true; m.sim.update(1 / 30); }
      m.hud.locked = false; c.pitch = 0; c.gas = 0; c.steer = 0;
      return { ok, inVeh: !!m.sim.player.inVeh, d: Math.hypot(m.sim.player.x - v.x, m.sim.player.z - v.z) };
    });
    check(land.ok && !land.inVeh && land.d < 4, `${name} 轻推降落、平稳落地后下机`, log);
    // 直升机新控制映射（2026-11-21）：摇杆管水平、按钮管升降——直接调 hud.readInput() 验证映射，再用真实输入飞一圈
    const map = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, h = s.vehicles.find((v) => v.type === 'heli'), hud = m.hud, c = s.ctl;
      p.hp = 100; p.godT = Infinity;
      hud.locked = true;   // 先锁住，免得真实循环改 ctl
      p.x = p.px = h.x + 2.5; p.z = p.pz = h.z; p.y = s.world.groundY(p.x, p.z);
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      const entered = p.inVeh === h;
      // 按钮文字：直升机上油门键变“上升”、刹车键变“下降”。
      // 标签是 slow() 每 0.1 秒才刷的（无头浏览器帧率低，上一拍可能还没跑到），这里直接调一次 slow() 再读，不然读到的是上车前的旧文字。
      hud.slow();
      const labels = { gas: hud.bGas.labelEl.textContent, brake: hud.bBrake.labelEl.textContent };
      // 直接驱动真实输入再调 readInput()：摇杆上推 → 前进油门；摇杆左右 → 转向；按钮 → 升降
      hud.locked = false;
      const read = () => { hud.readInput(); return { gas: c.gas, pitch: c.pitch, steer: c.steer }; };
      hud.joy.active = true; hud.joy.x = 0; hud.joy.y = -1;
      const up = read();
      hud.joy.y = 1;
      const down = read();
      hud.joy.y = 0; hud.joy.x = -1;
      const left = read();
      hud.joy.active = false; hud.joy.x = 0; hud.joy.y = 0;
      hud.bGas.pressed = true;
      const btnUp = read();
      hud.bGas.pressed = false; hud.bBrake.pressed = true;
      const btnDown = read();
      hud.bBrake.pressed = false;
      const btnNone = read();
      hud.locked = true;
      return { entered, labels, up, down, left, btnUp, btnDown, btnNone };
    });
    check(map.entered, `${name} 新控制：走到机场直升机旁上机`, log);
    check(map.labels.gas === '上升' && map.labels.brake === '下降', `${name} 直升机上按钮显示“上升/下降”（当前“${map.labels.gas}/${map.labels.brake}”）`, log);
    check(map.up.gas > 0.5 && map.up.pitch === 0, `${name} 摇杆上推：前进油门 ${map.up.gas.toFixed(2)}，不升降`, log);
    check(map.down.gas < -0.5 && map.down.pitch === 0, `${name} 摇杆下拉：后退油门 ${map.down.gas.toFixed(2)}，不升降`, log);
    check(map.left.steer < -0.5, `${name} 摇杆向左：转向 ${map.left.steer.toFixed(2)}`, log);
    check(map.btnUp.pitch === 0.6, `${name} 按住“上升”按钮：升降 ${map.btnUp.pitch}`, log);
    check(map.btnDown.pitch === -0.6, `${name} 按住“下降”按钮：升降 ${map.btnDown.pitch}`, log);
    check(map.btnNone.pitch === 0, `${name} 两个按钮都不按：升降 ${map.btnNone.pitch}`, log);
    // 真实输入飞一圈：按住“上升”起飞、摇杆上推前进、按住“下降”落回地面
    const fly = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, h = s.vehicles.find((v) => v.type === 'heli'), hud = m.hud, c = s.ctl;
      p.hp = 100; p.godT = Infinity;
      hud.locked = false;   // 解锁，fastForward 每步都会调真实的 readInput()
      hud.bGas.pressed = true; m.loop.fastForward(3); hud.bGas.pressed = false;   // 按住“上升”起飞
      const airborne = h.flying && h.y > 15, y = h.y;
      const x0 = h.x, z0 = h.z;
      hud.joy.active = true; hud.joy.x = 0; hud.joy.y = -1; m.loop.fastForward(2); hud.joy.active = false;   // 摇杆上推前进
      const fwd = Math.hypot(h.x - x0, h.z - z0);
      hud.bBrake.pressed = true;   // 按住“下降”落回地面（0.6 档 7.8 米/秒，在坠毁阈值以内）
      const secs = Math.ceil((h.y - 2) / 7.8) + 2;
      m.loop.fastForward(secs); hud.bBrake.pressed = false;
      const landed = !h.flying && h.alive;
      hud.locked = true; c.gas = 0; c.pitch = 0; c.steer = 0;
      return { airborne, y, fwd, landed };
    });
    check(fly.airborne, `${name} 按住“上升”按钮起飞到 ${fly.y.toFixed(0)} 米`, log);
    check(fly.fwd > 15, `${name} 摇杆上推向前飞出 ${fly.fwd.toFixed(0)} 米`, log);
    check(fly.landed, `${name} 按住“下降”按钮落回地面`, log);
    await shot(page, `city-heli-controls-${name}`);
    const flyOut = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, h = s.vehicles.find((v) => v.type === 'heli');
      s.ctl.enter = true; s.update(1 / 30); s.events.length = 0;
      return { out: !p.inVeh, d: Math.hypot(p.x - h.x, p.z - h.z) };
    });
    check(flyOut.out && flyOut.d < 4, `${name} 真实输入飞一圈后下机`, log);
    // 楼顶降落：上直升机，飞到最高的平顶楼顶上方，轻推慢降
    const roof = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, w = s.world, c = s.ctl;
      const tower = w.buildings.filter((b) => b.roof === 0 && (b.x1 - b.x0) >= 18 && (b.z1 - b.z0) >= 18 && b.y0 + b.h >= 30).sort((a, b) => (b.y0 + b.h) - (a.y0 + a.h))[0];
      const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2, top = tower.y0 + tower.h;
      const h = s.vehicles.find((v) => v.type === 'heli');
      p.hp = 100; p.godT = Infinity;
      m.hud.locked = true;
      p.x = p.px = h.x + 2.5; p.z = p.pz = h.z; p.y = w.groundY(p.x, p.z);
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      const entered = p.inVeh === h;
      h.x = cx; h.z = cz; h.y = top + 30; h.flying = true; h.vy = 0; h.pitch = 0; h.roll = 0; h.yaw = 0;
      c.pitch = -0.3; c.gas = 0; c.steer = 0; m.loop.fastForward(10); c.pitch = 0;
      const landed = !h.flying && h.alive && Math.abs(h.y - top) < 1;
      m.view.camYaw = 0.8;
      return { entered, landed, top, hy: h.y, cx, cz };
    });
    check(roof.entered && roof.landed, `${name} 直升机轻推慢降到楼顶（楼顶 ${roof.top.toFixed(0)} 米，直升机 ${roof.hy.toFixed(1)} 米）`, log);
    await sleep(800);
    await shot(page, `city-roof-${name}`);
    // 楼顶下机（站在楼顶）、再上机、再起飞；起飞后在空中发一枚火箭
    const roof2 = await page.evaluate((top) => {
      const m = window.__city, s = m.sim, p = s.player, c = s.ctl, h = s.vehicles.find((v) => v.type === 'heli');
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      const onRoof = !p.inVeh && Math.abs(p.y - top) < 1;
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      const reboard = p.inVeh === h;
      c.pitch = 1; c.gas = 0; m.loop.fastForward(2); c.pitch = 0;
      const airborne = h.flying && h.y > top + 10;
      const ammo0 = p.ammo[4];
      c.aimYaw = 0; c.aimSet = true; c.rocket = true; s.update(1 / 30); c.rocket = false;   // 只开一发：按住 1 秒现在会打 10 发，弹药数就不是减 1 了
      const fired = p.ammo[4] === ammo0 - 1 && h.alive;
      // 落回楼顶，下机
      c.pitch = -0.4; c.gas = 0; c.steer = 0; m.loop.fastForward(12); c.pitch = 0;
      const landed2 = !h.flying && h.alive;
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      return { onRoof, reboard, airborne, fired, landed2, out: !p.inVeh };
    }, roof.top);
    check(roof2.onRoof && roof2.reboard && roof2.airborne, `${name} 楼顶下机站在楼顶、再上机、再起飞`, log);
    check(roof2.fired, `${name} 直升机空中发火箭筒（弹药减 1，自己的直升机完好）`, log);
    check(roof2.landed2 && roof2.out, `${name} 直升机落回楼顶后下机`, log);
    // 轿车上发火箭筒：弹药减 1，自己的车完好
    const rk = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, w = s.world, c = s.ctl;
      const car = s.vehicles.find((v) => v.type === 'sedan' && v.fixed);
      p.hp = 100; p.godT = Infinity;
      p.x = p.px = car.x + 2.5; p.z = p.pz = car.z; p.y = w.groundY(p.x, p.z);
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      const entered = p.inVeh === car;
      // 先把 50 米内的交通车清掉：它们会随机开进火箭弹道、近处炸开溅到自己的车（和“自己的车该不该受伤”无关，纯粹是随机性）
      s.vehicles = s.vehicles.filter((v) => v === car || !(v.ai && v.ai.kind === 'traffic') || Math.hypot(v.x - car.x, v.z - car.z) > 50);
      let yaw = 0;
      for (const y of [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4]) {
        if (!w.blocked(car.x, car.z, car.x + Math.sin(y) * 30, car.z + Math.cos(y) * 30, car.y + 2.2)) { yaw = y; break; }
      }
      const ammo0 = p.ammo[4], hp0 = car.hp;
      c.aimYaw = yaw; c.aimSet = true; c.rocket = true; s.update(1 / 30); c.rocket = false;   // 只开一发：按住 1 秒现在会打 10 发，弹药数就不是减 1 了
      const fired = p.ammo[4] === ammo0 - 1;
      m.loop.fastForward(2);   // 等火箭飞远炸开
      c.gas = 0; c.pitch = 0; c.steer = 0; c.fire = false;
      m.hud.locked = false;
      return { entered, fired, ammo0, ammo: p.ammo[4], alive: car.alive, hp: car.hp, hp0 };
    });
    // 拆成三项分别报：之前合在一起报，失败时看不出是没上车、没打出去还是自己的车被炸伤了
    check(rk.entered, `${name} 轿车上发火箭筒：先坐进轿车`, log);
    check(rk.fired, `${name} 轿车上发火箭筒：弹药 ${rk.ammo0} → ${rk.ammo}`, log);
    check(rk.alive && rk.hp === rk.hp0, `${name} 轿车上发火箭筒：自己的车完好无损（耐久 ${rk.hp}/${rk.hp0}）`, log);
    await shot(page, `city-rocket-${name}`);
    // 高空远射（只在横屏跑一次）：上直升机爬到 150 米以上，朝南发火箭，飞 4 秒（220 米）仍在飞
    // 注意顺序：必须放在炸楼之前——炸楼那步把玩家传到离停机坪 400 米外，直升机超过 150 米没回停机坪、玩家又离停机坪超过 130 米时，
    // 游戏的固定载具补位机制会在停机坪重新放一架直升机、把楼顶那架收掉，远射再传到楼顶高度就上不了新直升机（nearestVehicle 要求高度差小于 3 米）
    if (name === 'landscape-844x390') {
      const far = await page.evaluate((top) => {
        const m = window.__city, s = m.sim, p = s.player, w = s.world, c = s.ctl;
        const h = s.vehicles.find((v) => v.type === 'heli');
        p.hp = 100; p.godT = Infinity;
        m.hud.locked = true;
        if (p.inVeh) { c.enter = true; s.update(1 / 30); s.events.length = 0; }   // 先下轿车（不然传送会被下车动作抵消）
        p.x = p.px = h.x + 2.5; p.z = p.pz = h.z; p.y = top;   // 传到楼顶的直升机旁：高度要是楼顶，不是地面
        c.enter = true; s.update(1 / 30); s.events.length = 0;
        const entered = p.inVeh === h;
        c.pitch = 1; c.gas = 0; m.loop.fastForward(12); c.pitch = 0;   // 爬到约 250 米
        const alt = h.y;
        const ox = h.x, oz = h.z;
        c.aimYaw = 0; c.aimSet = true; c.rocket = true; s.update(1 / 30); c.rocket = false;
        let maxD = 0;
        for (let i = 0; i < 4 * 30; i++) { s.update(1 / 30); for (const sh of s.shots) maxD = Math.max(maxD, Math.hypot(sh.x - ox, sh.z - oz)); s.events.length = 0; }
        c.gas = 0; c.pitch = 0; c.steer = 0;
        m.hud.locked = false;
        return { entered, alt, maxD, alive: s.shots.length > 0 };
      }, roof.top);
      check(far.entered && far.alt > 140 && far.maxD > 200, `${name} 直升机 ${far.alt.toFixed(0)} 米高空发火箭：飞过 ${far.maxD.toFixed(0)} 米仍在飞`, log);
      await shot(page, `city-rocket-far-${name}`);
      // 地标全景（只在横屏跑一次）：直升机悬在市中心上空 160 米，镜头扫过 8 栋地标
      const pano = await page.evaluate(() => {
        const m = window.__city, s = m.sim, p = s.player, w = s.world;
        const lm = w.buildings.filter((b) => b.kind === 'landmark');
        const h = s.vehicles.find((v) => v.type === 'heli');
        p.hp = 100; p.godT = Infinity;
        if (!p.inVeh) { p.x = p.px = h.x + 2.5; p.z = p.pz = h.z; p.y = w.groundY(p.x, p.z); s.ctl.enter = true; s.update(1 / 30); s.events.length = 0; }
        h.x = 980; h.z = 1080; h.y = 160; h.flying = true; h.vy = 0; h.pitch = 0; h.roll = 0; h.yaw = Math.PI;
        m.view.camYaw = Math.PI;   // 朝北看市中心：直升机偏到东边（x=980），中央的西尔斯大厦（920, 880）和哈利法塔（920, 720）不被机身挡住
        m.loop.fastForward(1);
        return { count: lm.length, names: lm.map((b) => b.name), hy: h.y, flying: h.flying };
      });
      check(pano.count === 8 && pano.flying, `${name} 直升机悬在市中心上空 ${pano.hy.toFixed(0)} 米，8 栋地标都在视野里（${pano.names.join('、')}）`, log);
      await sleep(1000);
      await shot(page, `city-landmarks-${name}`);
      // 坦克炮射速统一 10 发/秒：军营里上坦克，按住开炮键 2 秒数炮弹
      const tankRate = await page.evaluate(() => {
        const m = window.__city, s = m.sim, p = s.player, c = s.ctl;
        const tank = s.vehicles.find((v) => v.type === 'tank');
        p.hp = 100; p.godT = Infinity;
        m.hud.locked = true;
        if (p.inVeh) s.exitVehicle(true);   // 先下直升机（强制下机，直接落到地面）
        p.x = p.px = tank.x; p.z = p.pz = tank.z + 4; p.y = s.world.groundY(p.x, p.z);
        c.enter = true; s.update(1 / 30); s.events.length = 0;
        const entered = p.inVeh === tank;
        c.fire = true; m.loop.fastForward(2); c.fire = false;
        const shells = s.events.filter((e) => e.type === 'shot' && e.w === 'shell').length;
        m.hud.locked = false; c.fire = false;
        return { entered, shells };
      });
      check(tankRate.entered && tankRate.shells >= 18 && tankRate.shells <= 22, `${name} 坦克炮按住开火 2 秒 ${tankRate.shells} 发（机关枪同速 10 发/秒）`, log);
      await shot(page, `city-tankrate-${name}`);
    }
    // 炸楼：站到一栋民居 12 米外发一枚火箭把它炸平，再开车碾过废墟
    const demo = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player, w = s.world, c = s.ctl;
      if (p.inVeh) s.exitVehicle(true);
      p.hp = 100; p.godT = Infinity;
      const n = w.node(7, 7);
      const house = w.buildings.filter((b) => b.kind === 'house' && !b.destroyed).sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - n.x, (a.z0 + a.z1) / 2 - n.z) - Math.hypot((b.x0 + b.x1) / 2 - n.x, (b.z0 + b.z1) / 2 - n.z))[0];
      const cx = (house.x0 + house.x1) / 2, cz = (house.z0 + house.z1) / 2;
      let dx = 1, dz = 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = cx + a * 12, sz = cz + b * 12;
        if (w.groundY(sx, sz) < 1.9) continue;
        if (!w.blocked(sx, sz, cx, cz, 2.2)) { dx = a; dz = b; break; }
      }
      p.x = p.px = cx + dx * 12; p.z = p.pz = cz + dz * 12; p.y = w.groundY(p.x, p.z);
      p.weapon = 4; p.ammo[4] = Math.max(p.ammo[4], 2); p.shootCd = 0;
      m.view.camYaw = Math.atan2(-dx, -dz);
      m.hud.locked = true;
      return { cx, cz, dx, dz, hp: house.hp };
    });
    await sleep(800);
    await shot(page, `city-demolish-before-${name}`);
    const demo2 = await page.evaluate((demo) => {
      const m = window.__city, s = m.sim, p = s.player, c = s.ctl;
      c.aimYaw = Math.atan2(-demo.dx, -demo.dz); c.aimSet = true; c.fire = true;
      s.update(1 / 30); c.fire = false; c.aimSet = false;
      const fired = p.ammo[4] < 6;
      m.loop.fastForward(2);   // 等火箭飞到楼上炸开
      const house = s.world.buildings.find((b) => b.kind === 'house' && Math.abs((b.x0 + b.x1) / 2 - demo.cx) < 1 && Math.abs((b.z0 + b.z1) / 2 - demo.cz) < 1);
      return { fired, destroyed: house.destroyed, hp: house.hp, events: s.events.some((e) => e.type === 'buildingDown') };
    }, demo);
    check(demo2.fired && demo2.destroyed && demo2.hp === 0, `${name} 民居 1 发火箭筒被炸平（耐久 ${demo.hp}→0，buildingDown 事件已发）`, log);
    await sleep(2000);   // 等烟尘散了再拍，废墟才看得清楚
    await shot(page, `city-demolish-after-${name}`);
    const over = await page.evaluate((demo) => {
      const m = window.__city, s = m.sim, p = s.player, w = s.world, c = s.ctl;
      const cx = demo.cx, cz = demo.cz;
      let dir = null;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = cx + a * 15, sz = cz + b * 15;
        if (w.groundY(sx, sz) < 1.9) continue;
        if (!w.blocked(sx, sz, cx - a * 8, cz - b * 8, 2.2)) { dir = [a, b]; break; }
      }
      if (!dir) return { ok: false, reason: 'no clear approach' };
      const [a, b] = dir;
      const car = s.vehicles.find((v) => v.type === 'sedan' && v.usable && !v.driver);
      car.x = cx + a * 15; car.z = cz + b * 15; car.y = w.groundY(car.x, car.z); car.yaw = Math.atan2(-a, -b); car.vx = 0; car.vz = 0; car.speed = 0;
      for (const v of s.vehicles) if (v !== car) { v.x += 500; v.z += 500; v.vx = 0; v.vz = 0; v.speed = 0; }   // 清走路上的交通车：撞上会把车堵在 10-18 米（隔离复现 15.8 米），与废墟无关
      p.x = p.px = car.x + 2.5; p.z = p.pz = car.z; p.y = w.groundY(p.x, p.z);
      c.enter = true; s.update(1 / 30); s.events.length = 0;
      const entered = p.inVeh === car;
      c.gas = 1; c.steer = 0; m.loop.fastForward(3); c.gas = 0;
      const disp = (car.x - (cx + a * 15)) * -a + (car.z - (cz + b * 15)) * -b;
      m.hud.locked = false;
      return { ok: entered && car.alive && disp > 23, entered, alive: car.alive, disp };
    }, demo);
    check(over.ok, `${name} 开车碾过废墟：穿过炸平的民居（沿路开了 ${over.disp ? over.disp.toFixed(1) : '-'} 米，车完好）`, log);
    await page.evaluate(() => { window.__city.view.camYaw += Math.PI; });   // 镜头转回身后，拍刚碾过的废墟
    await sleep(600);
    await shot(page, `city-rubble-${name}`);
    // 重建：暂停时计时冻结；拨近重建时间后楼回来、耐久回满、小地图恢复
    const reb = await page.evaluate((demo) => {
      const m = window.__city, s = m.sim;
      const house = s.world.buildings.find((b) => b.kind === 'house' && Math.abs((b.x0 + b.x1) / 2 - demo.cx) < 1 && Math.abs((b.z0 + b.z1) / 2 - demo.cz) < 1);
      const t0 = s.time;
      m.loop.timeScale = 0;   // 暂停
      return { t0, destroyed: house.destroyed, rebuildAt: house.rebuildAt };
    }, demo);
    await sleep(1500);   // 真实时间过去 1.5 秒，暂停时游戏时间不应该动
    const paused = await page.evaluate((reb) => {
      const m = window.__city, s = m.sim;
      const frozen = s.time === reb.t0;
      m.loop.timeScale = 1;   // 恢复
      return { frozen, time: s.time };
    }, reb);
    check(reb.destroyed && paused.frozen, `${name} 暂停时重建计时冻结（游戏时间停在 ${reb.t0.toFixed(1)} 秒没动，楼还是废墟）`, log);
    const reb2 = await page.evaluate((demo) => {
      const m = window.__city, s = m.sim;
      const house = s.world.buildings.find((b) => b.kind === 'house' && Math.abs((b.x0 + b.x1) / 2 - demo.cx) < 1 && Math.abs((b.z0 + b.z1) / 2 - demo.cz) < 1);
      const delay = house.rebuildAt - s.time;
      house.rebuildAt = s.time + 0.5;   // 手动把重建时间拨近（随机 60~180 秒的等待本身逻辑测试已测）
      let waited = 0;
      while (house.destroyed && waited < 15) { m.loop.fastForward(1); waited += 1; }   // 占地里有步行的玩家时会延后 5 秒再试：等到重建为止，最多 15 秒，别写死 3 秒（车不再挡重建，见下面的 rebCars）
      const up = s.events.some((e) => e.type === 'buildingUp');
      return { delay, destroyed: house.destroyed, hp: house.hp, maxHp: house.maxHp, up, waited };
    }, demo);
    check(reb2.delay > 0 && reb2.delay <= 180, `${name} 炸平后重建时间还剩 ${reb2.delay.toFixed(0)} 秒（原始抽值 60~180 秒，见逻辑测试；这里测的是剩余时间，炸楼到测量之间已经过了几秒）`, log);
    check(!reb2.destroyed && reb2.hp === reb2.maxHp && reb2.up, `${name} 重建后楼回来了（耐久回满 ${reb2.hp}，等了 ${reb2.waited} 秒，buildingUp 事件已发）`, log);
    // 等小地图重画：buildingUp 事件要等下一帧渲染才消费（fastForward 不跑渲染），无头下帧率不稳，固定等 1.2 秒有时不够，改成等到像素变色为止
    await page.waitForFunction((demo) => {
      const m = window.__city, s = m.sim;
      const house = s.world.buildings.find((b) => b.kind === 'house' && Math.abs((b.x0 + b.x1) / 2 - demo.cx) < 1 && Math.abs((b.z0 + b.z1) / 2 - demo.cz) < 1);
      const k = m.hud.mapImg.width / 1600, cx = (house.x0 + house.x1) / 2, cz = (house.z0 + house.z1) / 2;
      return m.hud.mapImg.getContext('2d').getImageData(Math.round(cx * k), Math.round(cz * k), 1, 1).data[0] > 65;
    }, { timeout: 15000, polling: 200 }, demo).catch(() => null);
    const rebPx = await page.evaluate((demo) => {
      const m = window.__city, s = m.sim;
      const house = s.world.buildings.find((b) => b.kind === 'house' && Math.abs((b.x0 + b.x1) / 2 - demo.cx) < 1 && Math.abs((b.z0 + b.z1) / 2 - demo.cz) < 1);
      const k = m.hud.mapImg.width / 1600, cx = (house.x0 + house.x1) / 2, cz = (house.z0 + house.z1) / 2;
      const px = m.hud.mapImg.getContext('2d').getImageData(Math.round(cx * k), Math.round(cz * k), 1, 1).data;
      return [px[0], px[1], px[2]];
    }, demo);
    check(rebPx[0] > 65, `${name} 小地图上楼的颜色恢复了（中心点 rgb(${rebPx.join(',')})，废墟是 58,54,50）`, log);
    await shot(page, `city-rebuilt-${name}`);
    // 重建新规则：废墟上的空车重建时炸掉；主角坐着的车无敌、被推到楼外（拆楼直接调 damageBuilding，拆楼本身前面已测过）
    const rebCars = await page.evaluate((demo) => {
      const m = window.__city, s = m.sim, p = s.player, w = s.world;
      const house = s.world.buildings.find((b) => b.kind === 'house' && Math.abs((b.x0 + b.x1) / 2 - demo.cx) < 1 && Math.abs((b.z0 + b.z1) / 2 - demo.cz) < 1);
      const cx = demo.cx, cz = demo.cz;
      const out = {};
      // 先测主角的车：把楼再拆一次，坐进停在废墟上的车，等重建
      if (p.inVeh) s.exitVehicle(true);
      p.hp = 100; p.godT = Infinity;
      s.damageBuilding(house, 99999);
      let car = s.vehicles.find((v) => v.type === 'sedan' && v.usable && !v.driver);
      if (!car) car = s.addVehicle('sedan', cx, cz, 0);
      car.x = cx; car.z = cz; car.y = w.groundY(cx, cz); car.yaw = 0; car.vx = 0; car.vz = 0; car.speed = 0; car.parked = true;
      p.x = p.px = car.x + 2.5; p.z = p.pz = car.z; p.y = w.groundY(p.x, p.z);
      s.ctl.enter = true; s.update(1 / 30); s.events.length = 0;
      out.entered = p.inVeh === car;
      const hp0 = car.hp;
      house.rebuildAt = s.time + 0.5;
      let waited = 0;
      while (house.destroyed && waited < 15) { m.loop.fastForward(1); waited += 1; }
      const eps = 1e-6;
      out.mine = {
        rebuilt: !house.destroyed, hp: house.hp, maxHp: house.maxHp,
        alive: car.alive, hpCar: car.hp, hp0, inVeh: p.inVeh === car,
        outside: car.x <= house.x0 - car.radius + eps || car.x >= house.x1 + car.radius - eps || car.z <= house.z0 - car.radius + eps || car.z >= house.z1 + car.radius - eps,
      };
      // 再测空车：把楼又拆一次，废墟上放一辆空车，等重建
      if (p.inVeh) s.exitVehicle(true);
      p.x = p.px = cx + 30; p.z = p.pz = cz; p.y = w.groundY(p.x, p.z);   // 玩家走开，免得挡住重建
      s.damageBuilding(house, 99999);
      let car2 = s.vehicles.find((v) => v.type === 'sedan' && v.usable && !v.driver && v !== car);
      if (!car2) car2 = s.addVehicle('sedan', cx, cz, 0);
      car2.x = cx; car2.z = cz; car2.y = w.groundY(cx, cz); car2.yaw = 0; car2.vx = 0; car2.vz = 0; car2.speed = 0; car2.parked = true;
      house.rebuildAt = s.time + 0.5;
      waited = 0;
      while (house.destroyed && waited < 15) { m.loop.fastForward(1); waited += 1; }
      out.empty = { rebuilt: !house.destroyed, alive: car2.alive, wreck: car2.wreck };
      return out;
    }, demo);
    check(rebCars.entered, `${name} 重建新规则：玩家坐进了停在废墟上的车`, log);
    check(rebCars.mine.rebuilt && rebCars.mine.hp === rebCars.mine.maxHp, `${name} 主角坐着的车不挡重建：楼回来了（耐久回满）`, log);
    check(rebCars.mine.alive && rebCars.mine.hpCar === rebCars.mine.hp0 && rebCars.mine.inVeh, `${name} 主角坐着的车没炸、没掉血，玩家还在车里`, log);
    check(rebCars.mine.outside, `${name} 主角坐着的车被推到了楼外`, log);
    check(rebCars.empty.rebuilt && !rebCars.empty.alive && rebCars.empty.wreck, `${name} 废墟上的空车在重建时炸掉了（残骸），楼照常回来`, log);
    await shot(page, `city-rebuild-cars-${name}`);
    // 行人密度：先走到市中心（机场附近没有街区，行人不生成），再快进 60 秒；同时记逻辑帧耗时
    const dens = await page.evaluate(() => {
      const m = window.__city, s = m.sim, p = s.player;
      const n = s.world.node(7, 7); p.x = p.px = n.x + 9.5; p.z = p.pz = n.z + 9.5; p.y = s.world.groundY(p.x, p.z);
      const t0 = performance.now(); m.loop.fastForward(60); const ms = performance.now() - t0;
      const civ = s.peds.filter((o) => o.kind === 'civ' && o.alive).length;
      return { civ, msPerTick: ms / (60 * 30) };
    });
    check(dens.civ >= 30, `${name} 市中心平民行人 ${dens.civ} 个（原来上限 18，现在 36）`, log);
    check(dens.msPerTick < 5, `${name} 行人翻倍后逻辑帧耗时 ${dens.msPerTick.toFixed(2)} ms（无明显变差）`, log);
    check(bad(errors).length === 0, `${name} 新功能流程无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
    await page.close();
  }
}
// 旋转：横屏玩一会儿 → 切竖屏 → 切回横屏（2026-11-22：转屏后画面被挤压的 bug，
// 根因是转屏动画中途 resize 只触发一次、读到旧尺寸；Stage 里加了 ResizeObserver 按布局尺寸兜底）
if (!quick) {
  const { page, errors } = await open(ctx, '/city/?fresh=1&q=1', VIEW.landscape);
  await ready(page);
  await sleep(1200);
  await page.evaluate(() => window.__city.loop.fastForward(5));
  await sleep(300);
  const geom = () => page.evaluate(() => {
    const s = window.__city.stage, v = window.__city.view;
    const c = document.querySelector('canvas.g-canvas');
    const r = c.getBoundingClientRect();
    return {
      css: [Math.round(r.width), Math.round(r.height)],
      buf: [c.width, c.height],
      camAspect: +v.camera.aspect.toFixed(3), camFov: v.camera.fov, dpr: s.pixelRatio,
    };
  });
  const expectGeom = (g, w, h, fov, tag) => {
    const expBuf = [Math.round(w * g.dpr), Math.round(h * g.dpr)];
    check(Math.abs(g.css[0] - w) <= 1 && Math.abs(g.css[1] - h) <= 1, `${tag} 画布 CSS 盒子是 ${w}x${h}`, log);
    check(g.buf[0] === expBuf[0] && g.buf[1] === expBuf[1], `${tag} 画布缓冲是 ${expBuf[0]}x${expBuf[1]}（没被挤压）`, log);
    check(Math.abs(g.camAspect - w / h) < 0.01 && g.camFov === fov, `${tag} 相机宽高比 ${g.camAspect}、FOV ${g.camFov}°`, log);
  };
  let g = await geom();
  expectGeom(g, 844, 390, 58, '旋转前横屏');
  // 切竖屏
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(900);
  g = await geom();
  expectGeom(g, 390, 844, 78, '转竖屏后');
  await shot(page, 'city-rotate-port');
  // 模拟真机转屏的脏状态：缓冲被人停在横屏尺寸，只动容器布局（不动 window 事件），
  // ResizeObserver 必须自己把它纠回来——这是转屏挤压的回归检查。
  await page.evaluate(() => {
    const s = window.__city.stage;
    s.renderer.setSize(844, 390, false);   // 人为把缓冲拨回横屏尺寸（模拟转屏动画中途读到的旧尺寸）
    const root = document.documentElement;
    root.style.setProperty('--app-h', '843px');
    setTimeout(() => root.style.setProperty('--app-h', '844px'), 50);
  });
  await sleep(600);
  g = await geom();
  expectGeom(g, 390, 844, 78, '脏缓冲被 ResizeObserver 纠回后');
  // 切回横屏
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await sleep(900);
  g = await geom();
  expectGeom(g, 844, 390, 58, '转回横屏后');
  check(bad(errors).length === 0, `旋转流程无报错 ${bad(errors).slice(0, 3).join(' | ')}`, log);
  await page.close();
}
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
