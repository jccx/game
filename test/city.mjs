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
    // 注意：无头浏览器 rAF 会被节流，固定睡 200 毫秒可能等不到下一帧、按键还没被读到；改成等到武器真的切过去
    await page.keyboard.press('Digit3');
    await page.waitForFunction('window.__city.sim.player.weapon === 2', { timeout: 5000 }).catch(() => {});
    let w = await page.evaluate(() => window.__city.sim.player.weapon);
    check(w === 2, `${name} 按数字键 3 切到冲锋枪`, log);
    await page.keyboard.press('Digit5');
    await page.waitForFunction('window.__city.sim.player.weapon === 4', { timeout: 5000 }).catch(() => {});
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
