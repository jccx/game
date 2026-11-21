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
// 新功能：出生全武器、自动补满、直升机、行人密度——五种手机尺寸横竖屏（只在完整模式下）
if (!quick) {
  const phone = (w, h) => ({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const sizes = { 'landscape-844x390': phone(844, 390), 'portrait-390x844': phone(390, 844), 'small-land-667x375': phone(667, 375), 'small-port-360x640': phone(360, 640), 'short-land-740x320': phone(740, 320) };
  for (const [name, view] of Object.entries(sizes)) {
    const { page, errors } = await open(ctx, '/city/?fresh=1&q=1', view);
    await ready(page);
    await sleep(1200);
    // 出生全武器：数字键 1~5 直接切
    const spawn = await page.evaluate(() => { const p = window.__city.sim.player; return { owned: p.owned.slice(), ammo: p.ammo.slice() }; });
    check(spawn.owned.every(Boolean) && spawn.ammo[1] === 80 && spawn.ammo[4] === 6, `${name} 出生拥有全部 5 种武器（手枪 80 发、火箭筒 6 发）`, log);
    await page.keyboard.press('Digit3'); await sleep(200);
    let w = await page.evaluate(() => window.__city.sim.player.weapon);
    check(w === 2, `${name} 按数字键 3 切到冲锋枪`, log);
    await page.keyboard.press('Digit5'); await sleep(200);
    w = await page.evaluate(() => window.__city.sim.player.weapon);
    check(w === 4, `${name} 按数字键 5 切到火箭筒`, log);
    // 打空一把自动补满：只剩 1 发时开一枪
    const refill = await page.evaluate(() => {
      const s = window.__city.sim, p = s.player;
      p.weapon = 1; p.ammo[1] = 1; p.shootCd = 0; s.ctl.aimYaw = 0; s.ctl.fire = true;
      s.update(1 / 30); s.ctl.fire = false; s.events.length = 0;
      return p.ammo[1];
    });
    check(refill === 80, `${name} 手枪剩 1 发时开一枪，打空后自动补满到 80 发（当前 ${refill}）`, log);
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
      c.aimYaw = 0; c.aimSet = true; c.rocket = true; m.loop.fastForward(1); c.rocket = false;
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
      let yaw = 0;
      for (const y of [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4]) {
        if (!w.blocked(car.x, car.z, car.x + Math.sin(y) * 30, car.z + Math.cos(y) * 30, car.y + 2.2)) { yaw = y; break; }
      }
      const ammo0 = p.ammo[4], hp0 = car.hp;
      c.aimYaw = yaw; c.aimSet = true; c.rocket = true; m.loop.fastForward(1); c.rocket = false;
      const fired = p.ammo[4] === ammo0 - 1;
      m.loop.fastForward(2);   // 等火箭飞远炸开
      c.gas = 0; c.pitch = 0; c.steer = 0; c.fire = false;
      m.hud.locked = false;
      return { entered, fired, alive: car.alive, hp: car.hp, hp0 };
    });
    check(rk.entered && rk.fired && rk.alive && rk.hp === rk.hp0, `${name} 轿车上发火箭筒：弹药减 1，自己的车完好无损`, log);
    await shot(page, `city-rocket-${name}`);
    // 高空远射（只在横屏跑一次）：上直升机爬到 150 米以上，朝南发火箭，飞 4 秒（220 米）仍在飞
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
    }
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
await ctx.close();
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
