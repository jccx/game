// 落日湾联机的浏览器测试：两个无头标签页同时加入、重名被拒、甲炸楼乙看到、重建后楼恢复。
// 注意：测的是真数据库、真共享地图（和正式玩家同一张地图）：炸的是一栋普通民居，重建（60~180 秒）会把它恢复；
// 名字用 testA-/testB- 加随机后缀，测完断开就释放，页面关闭时 onDisconnect 也会清理。
// Chrome 要经过沙盒 egress 代理才能上 gstatic CDN：本文件自带一个本地 CONNECT 中继（test/relay.mjs），
// 浏览器启动参数里加 --proxy-server 指到中继，--ignore-certificate-errors 绕过代理的 TLS 拦截。
// 用法：CHROME=~/workspace/.tmp/chrome-headless-shell-linux64/chrome-headless-shell node test/city-net.mjs
// 截图输出到 test/out/city-net-*.png
import puppeteer from 'puppeteer-core';
import { startServer } from './serve.mjs';
import { startRelay } from './relay.mjs';
import { check, shot, sleep, VIEW } from './lib.mjs';

const log = [];
const runId = String(Date.now() % 100000);
const nameA = `testA-${runId}`, nameB = `testB-${runId}`;
// 沙盒里 Chrome 要经 egress 代理才能上 gstatic：有代理就起本地 CONNECT 中继（test/relay.mjs），
// 没代理（正常机器/CI）就直连，不用中继。
let relay = null;
try { relay = await startRelay(); } catch { relay = null; }
const srv = await startServer(0);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', '--disable-dev-shm-usage',
    ...(relay ? [`--proxy-server=http://127.0.0.1:${relay.port}`, '--proxy-bypass-list=127.0.0.1,localhost',
      '--ignore-certificate-errors'] : [])],
});
const base = srv.url;
const bad = (errors) => errors.filter((e) => !e.includes('favicon'));

async function openPage() {
  const page = await browser.newPage();
  await page.setViewport(VIEW.landscape);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(base + '/city/?fresh=1&q=1', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__city && window.__city.sim && window.__city.hud && window.__city.loop', { timeout: 180000 });
  await sleep(1200);
  return { page, errors };
}

const netState = (page) => page.evaluate(() => {
  const n = window.__city.net;
  return n ? { status: n.status, name: n.name, remotes: [...n.remotePlayers.values()].map((r) => r.name) } : null;
});

let pageA, pageB, pageC, errorsA = [], errorsB = [], errorsC = [];
try {
  // ---- 1) 两个标签页加入 ----
  ({ page: pageA, errors: errorsA } = await openPage());
  const rA = await pageA.evaluate((n) => window.__city.hud.joinNet(n), nameA);
  check(rA.ok, `甲加入联机（${nameA}）`, log);
  check((await netState(pageA)).status === 'online', '甲状态 online', log);

  // ---- 2) 重名被拒（单独开一页试，用完就关：三页同时在线会把本机内存顶满，见下） ----
  // 注意：本机同时只能稳定跑两页重 WebGL 页面（另有两个兄弟代理的浏览器也在跑），
  // 所以丙页只用来验重名，验完立刻关掉，后面的步骤只剩甲乙两页。
  ({ page: pageC, errors: errorsC } = await openPage());
  const rC = await pageC.evaluate((n) => window.__city.hud.joinNet(n), nameA);
  check(!rC.ok && rC.reason === 'taken', '第三页用甲的名字被拒（重名）', log);
  await pageC.close(); pageC = null;

  ({ page: pageB, errors: errorsB } = await openPage());
  const rB = await pageB.evaluate((n) => window.__city.hud.joinNet(n), nameB);
  check(rB.ok, `乙加入联机（${nameB}）`, log);

  // ---- 3) 互相看见 ----
  await pageA.evaluate(() => {
    const s = window.__city.sim, p = s.player, sp = s.world.places.spawn;
    p.x = p.px = sp.x; p.z = p.pz = sp.z; p.y = s.world.groundY(sp.x, sp.z); p.yaw = Math.PI / 2;
  });
  await pageB.evaluate(() => {
    const s = window.__city.sim, p = s.player, sp = s.world.places.spawn;
    p.x = p.px = sp.x + 3; p.z = p.pz = sp.z; p.y = s.world.groundY(sp.x + 3, sp.z); p.yaw = -Math.PI / 2;
  });
  await pageA.waitForFunction((n) => { const net = window.__city.net; return net && [...net.remotePlayers.values()].some((r) => r.name === n); }, { timeout: 30000, polling: 500 }, nameB);
  await pageB.waitForFunction((n) => { const net = window.__city.net; return net && [...net.remotePlayers.values()].some((r) => r.name === n); }, { timeout: 30000, polling: 500 }, nameA);
  check(true, '甲和乙互相在对方的在线列表里', log);
  // 后台标签页的 requestAnimationFrame 会被节流，查人物渲染前先把要查的那页切到前台，再等渲染跑出来
  await pageA.bringToFront();
  await pageA.waitForFunction(() => window.__city.view.remoteViews.size === 1, { timeout: 30000, polling: 500 });
  await pageB.bringToFront();
  await pageB.waitForFunction(() => window.__city.view.remoteViews.size === 1, { timeout: 30000, polling: 500 });
  check(true, '两边都画出对方的人物', log);
  // 镜头转向对方再截图：相机在玩家身后朝 yaw 方向看。
  // 先把乙切到前台 1.5 秒让它把心跳发出来（后台标签页的心跳会被节流，甲那边 10 秒收不到就会把乙当掉线清掉），
  // 再切回甲截图，不然截到的可能是“乙已离开”的画面
  await pageB.bringToFront();
  await sleep(1500);
  await pageA.bringToFront();
  await pageA.evaluate(() => { window.__city.view.camYaw = Math.PI / 2; });
  await sleep(600);
  await shot(pageA, 'city-net-two-players-landscape');

  // ---- 4) 甲炸楼，乙的楼也塌了 ----
  const hit = await pageA.evaluate(() => {
    const s = window.__city.sim;
    const b = s.world.buildings.find((x) => x.kind === 'house' && !x.destroyed);
    const i = s.world.buildings.indexOf(b);
    s.damageBuilding(b, 99999);
    // 建筑只有 x0/x1/z0/z1 四条边，没有 x/z：中心点要自己算（b.x 是 undefined，拿它算位置会出 NaN）
    return { i, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  });
  const idx = hit.i;
  check(idx >= 0, `甲炸掉一栋民居（序号 ${idx}）`, log);
  // 等乙收到之前先把乙切到前台：后台标签页收 WebSocket 消息会被饿死，等 30 秒都等不到
  await pageB.bringToFront();
  await pageB.waitForFunction((i) => window.__city.sim.world.buildings[i].destroyed === true, { timeout: 30000, polling: 500 }, idx);
  check(true, '乙那边同一栋楼也塌了', log);
  // 乙走到废墟边、镜头对准它再截图，废墟要亲眼可见
  await pageB.evaluate((h) => {
    const s = window.__city.sim, p = s.player;
    p.x = p.px = h.x + 12; p.z = p.pz = h.z + 12; p.y = s.world.groundY(p.x, p.z);
    window.__city.view.camYaw = Math.atan2(h.x - p.x, h.z - p.z);
  }, hit);
  await sleep(600);
  await shot(pageB, 'city-net-remote-rubble-landscape');

  // ---- 5) 重建后楼恢复（炸楼后 60~180 秒自动重建，重建状态同步给乙；这里把重建点拨到 1 秒后，不用真等） ----
  await pageA.evaluate((i) => {
    const s = window.__city.sim, b = s.world.buildings[i];
    b.rebuildAt = s.time + 1;
  }, idx);
  await pageB.bringToFront();
  await pageB.waitForFunction((i) => window.__city.sim.world.buildings[i].destroyed === false, { timeout: 30000, polling: 500 }, idx);
  check(true, '重建后乙那边楼恢复了', log);
  const backA = await pageA.evaluate((i) => window.__city.sim.world.buildings[i].destroyed === false, idx);
  check(backA, '重建后甲那边楼也恢复了', log);

  // ---- 6) 断开 ----
  await pageA.evaluate(async () => window.__city.hud.leaveNet());
  await pageB.evaluate(async () => window.__city.hud.leaveNet());
  const stA = await netState(pageA), stB = await netState(pageB);
  check(stA === null || stA.status === 'offline', '甲断开后状态 offline（leaveNet 先把 hud.net 置 null，net 对象没了就是已断开）', log);
  check(stB === null || stB.status === 'offline', '乙断开后状态 offline（leaveNet 先把 hud.net 置 null，net 对象没了就是已断开）', log);
} catch (e) {
  log.push('FAIL 浏览器测试中途出错：' + (e.message || e));
} finally {
  for (const p of [pageA, pageB, pageC]) { try { if (p) await p.close(); } catch { /* 忽略 */ } }
  await browser.close();
  srv.server.close();
  if (relay) await relay.close();
}
check(bad(errorsA).length === 0, `甲页面无报错 ${bad(errorsA).slice(0, 3).join(' | ')}`, log);
check(bad(errorsB).length === 0, `乙页面无报错 ${bad(errorsB).slice(0, 3).join(' | ')}`, log);
check(bad(errorsC).length === 0, `丙页面无报错 ${bad(errorsC).slice(0, 3).join(' | ')}`, log);
console.log(log.join('\n'));
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
