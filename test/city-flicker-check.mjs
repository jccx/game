// 落日湾机场/军营地面闪烁复现：把玩家/镜头放到机场跑道、停机坪、军营地面附近，
// 连续几帧截图，用“重叠带里两种地面颜色的占比”在几帧之间的摆动幅度来量化闪烁。
// 原理：共面（或近共面）的两层地面在深度缓冲里打成平手，镜头稍一动，
// 每像素的胜负就翻转，同一块区域在“路 / 停机坪”两种颜色之间来回跳。
// 采样方法：每个区域在世界坐标里取网格点，逐点投影到屏幕再取色，避免屏幕包围盒混进区域外的地面。
// 用法：CHROME=~/workspace/.tmp/chrome-headless-shell-linux64/chrome-headless-shell node test/city-flicker-check.mjs
// 只读测试，不改游戏代码；结果写 test/out/flicker-result.json，截图写 test/out/flicker-*.png（不提交）。
import { launch, open, sleep, VIEW } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- 最小 PNG 解码：8 位、非隔行、RGB/RGBA ---------------- */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idats = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error(`不支持的 PNG：bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  const ch = colorType === 6 ? 4 : 3, stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const px = new Uint8Array(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) { const s = (y * w + x) * 4; px[s] = cur[x * ch]; px[s + 1] = cur[x * ch + 1]; px[s + 2] = cur[x * ch + 2]; px[s + 3] = ch === 4 ? cur[x * ch + 3] : 255; }
    prev = cur;
  }
  return { w, h, px };
}
const at = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ---------------- 场景设置 ---------------- */
// 每个区域：世界矩形 + 两个候选颜色（A/B，各给一个世界锚点，颜色从实测采样，跨场景共用）。
// 摆动 = A 占比在 5 帧里的 (max-min)；共面闪烁的区域摆动大，单层对照区摆动接近 0。
const SETUPS = [
  { name: 'airport', px: 1120, pz: 700, yaw: 0, pitch: -0.1, regions: [
    { name: 'airportStrip', rect: [1120, 725, 1127, 800], a: { label: 'apron', pt: [1131, 760] }, b: { label: 'road', pt: [1116, 760] } },
    { name: 'airportApron', rect: [1128, 730, 1135, 800], a: { label: 'apron', pt: [1131, 760] }, b: { label: 'road', pt: [1116, 760] } },
  ] },
  { name: 'ctrlRoad', px: 1120, pz: 400, yaw: 0, pitch: -0.1, regions: [
    { name: 'ctrlRoad', rect: [1113, 420, 1127, 470], a: { label: 'road', pt: [1116, 445] }, b: { label: 'apron', pt: [1131, 760] } },
  ] },
  { name: 'runway', px: 1280, pz: 640, yaw: 0, pitch: -0.1, regions: [
    { name: 'runwayDash', rect: [1279.4, 700, 1280.6, 860], a: { label: 'dash', pt: [1280, 756] }, b: { label: 'runway', pt: [1270, 760] } },
    { name: 'runwayPure', rect: [1266, 700, 1278, 860], a: { label: 'dash', pt: [1280, 756] }, b: { label: 'runway', pt: [1270, 760] } },
  ] },
  { name: 'base', px: 890, pz: 420, yaw: 0, pitch: -0.1, regions: [
    // 注意：军营地面锚点不要取 (920,480)，那个点从这里看正好被营房（894~942，426~440）挡住，
    // 采到的是营房背光的墙面 rgb(41,45,34)，不是地面。改取重叠带上的点 (884,470)，就是军营地面本身。
    { name: 'baseStrip', rect: [881, 435, 887, 500], a: { label: 'base', pt: [884, 470] }, b: { label: 'road', pt: [1116, 445] } },
    // 对照区：重叠带以东、营房以西的 5 米宽地面带，从这里看得见，不会被营房挡住
    { name: 'baseGround', rect: [888, 445, 893, 500], a: { label: 'base', pt: [884, 470] }, b: { label: 'road', pt: [1116, 445] } },
  ] },
  // 跑道虚线近景：远景里虚线只有 1~2 像素，量不出来；站到虚线跟前再测
  { name: 'dashClose', px: 1280, pz: 745, yaw: 0, pitch: -0.1, regions: [
    { name: 'dashClose', rect: [1279.6, 748, 1280.4, 772], a: { label: 'dash', pt: [1280, 756] }, b: { label: 'runway', pt: [1270, 756] } },
    { name: 'runwayClose', rect: [1266, 748, 1278, 772], a: { label: 'dash', pt: [1280, 756] }, b: { label: 'runway', pt: [1270, 756] } },
  ] },
];
const FRAMES = 5, NUDGE = 0.1;
// 只跑某个场景：SETUP=dashClose node test/city-flicker-check.mjs；不设则全跑
const RUN = process.env.SETUP ? SETUPS.filter((s) => s.name === process.env.SETUP) : SETUPS;
if (!RUN.length) { console.error('没有这个场景:', process.env.SETUP); process.exit(2); }

// 区域内世界网格采样点（x 步进使每行约 7 个点，z 每 8 米一行）
function grid(rect) {
  const [x0, z0, x1, z1] = rect, pts = [];
  const sx = Math.max(0.3, (x1 - x0) / 6);
  for (let x = x0 + sx / 2; x < x1; x += sx) for (let z = z0 + 4; z < z1; z += 8) pts.push([+x.toFixed(1), z]);
  return pts;
}

const ctx = await launch();
const { page, errors } = await open(ctx, '/city/?fresh=1&q=2', VIEW.landscape);
await page.waitForFunction('window.__city && window.__city.sim && window.__city.hud && window.__city.loop', { timeout: 60000 });
await sleep(8000); // 等欢迎横幅消失（600ms 后出现，持续 5 秒 + 淡出）
await page.evaluate(() => { window.__city.loop.timeScale = 0; }); // 冻结逻辑：车和行人不走，只动镜头

const place = (x, z, yaw, pitch) => page.evaluate(({ x, z, yaw, pitch }) => {
  const m = window.__city, s = m.sim, p = s.player;
  if (p.inVeh) s.exitVehicle(true);
  p.x = p.px = x; p.z = p.pz = z; p.y = p.py = s.world.groundY(x, z);
  p.yaw = yaw;
  m.hud.locked = true;
  const v = m.view; v.camYaw = yaw; v.camPitch = pitch; v.manualT = 0;
  // 量测用：把玩家模型藏起来。镜头永远盯着玩家，地面锚点/采样点在屏幕上正好落在玩家身后，
  // 会采到玩家衣服颜色（之前道路锚点采出 rgb(107,52,23) 就是玩家的棕色上衣），
  // 而且玩家周围 120px 的排除区会把整条重叠带都排除掉。只改页面里的 view 对象，不改游戏代码。
  if (!v._flickerPatched) {
    v._flickerPatched = true;
    v.updatePlayer = () => {};
    for (const k in v.pl) v.pl[k].visible = false;
    v.godBubble.visible = false;
  }
}, { x, z, yaw, pitch });
const nudge = (dz) => page.evaluate((dz) => {
  const m = window.__city, p = m.sim.player;
  p.z = p.pz = p.z + dz; m.view.manualT = 0;
}, dz);
// 世界点 → 屏幕坐标（y 用地面高度 +0.05）
const projectAll = (pts) => page.evaluate((pts) => {
  const v = window.__city.view, s = window.__city.sim;
  const pl = v.project(s.player.x, s.player.y + 1, s.player.z);
  return { pts: pts.map(([x, z]) => { const p = v.project(x, s.world.groundY(x, z) + 0.05, z); return { x: Math.round(p.x), y: Math.round(p.y), vis: p.visible }; }),
           player: { x: Math.round(pl.x), y: Math.round(pl.y) }, time: v.time };
}, pts);

const anchorColors = {}; // "x,z" → [r,g,b]，跨场景共用（同一光照）
const result = { setups: {}, radar: null, errors: errors.filter((e) => !e.includes('favicon')) };
for (const su of RUN) {
  await place(su.px, su.pz, su.yaw, su.pitch);
  await sleep(700);
  const samples = su.regions.map((r) => grid(r.rect));
  const anchorPts = [...new Set(su.regions.flatMap((r) => [r.a.pt.join(','), r.b.pt.join(',')]))].map((k) => k.split(',').map(Number));
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    if (f > 0) { await nudge(NUDGE); await sleep(350); }
    const buf = await page.screenshot();
    const img = decodePng(buf);
    const all = [...samples.flat(), ...anchorPts];
    const { pts, player, time } = await projectAll(all);
    const nSample = samples.flat().length;
    const sPts = pts.slice(0, nSample), aPts = pts.slice(nSample);
    if (f === 0) {
      // 首帧采样锚点颜色：每个锚点在 z 方向取 5 个点（间隔 4 米，虚线间隔 2 米），各取 5x5 中值，
      // 再取这 5 个中值的分量中值（虚线取最亮）。路上可能正好停着一辆被冻结的交通车（约 5 米长），
      // 单点采样会被车身颜色污染，多点中值能把它顶掉。
      const nearPts = (x, z, isDash) => {
        const step = isDash ? 2 : 4;
        const out = [];
        for (let k = -2; k <= 2; k++) out.push([x, z + k * step]);
        return out;
      };
      const allNear = anchorPts.flatMap(([x, z]) => {
        const key = `${x},${z}`;
        const isDash = su.regions.some((r) => r.a.pt.join(',') === key && r.a.label === 'dash');
        return nearPts(x, z, isDash);
      });
      const { pts: nearProj } = await projectAll(allNear);
      let ni = 0;
      anchorPts.forEach(([x, z]) => {
        const key = `${x},${z}`;
        if (Math.hypot(x - su.px, z - su.pz) > 150) { ni += 5; return; }
        const isDash = su.regions.some((r) => r.a.pt.join(',') === key && r.a.label === 'dash');
        const meds = [];
        for (let k = 0; k < 5; k++) {
          const c = nearProj[ni++];
          if (!c.vis || c.x < 0 || c.x >= 844 || c.y < 0 || c.y >= 390) continue;
          const vals = [];
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) vals.push(at(img, Math.min(843, Math.max(0, c.x + dx)), Math.min(389, Math.max(0, c.y + dy))));
          meds.push(vals.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]))[12]);
        }
        if (!meds.length) return;
        anchorColors[key] = isDash
          ? meds.reduce((m, v) => (v[0] + v[1] + v[2] > m[0] + m[1] + m[2] ? v : m))
          : [0, 1, 2].map((ch) => meds.map((m) => m[ch]).sort((a, b) => a - b)[Math.floor(meds.length / 2)]);
      });
      console.log(`[${su.name}] 已知锚点颜色:`, Object.entries(anchorColors).map(([k, v]) => `${k}=rgb(${v.join(',')})`).join('  '));
      fs.writeFileSync(path.join(OUT, `flicker-${su.name}-0.png`), buf);
    }
    if (f === FRAMES - 1) fs.writeFileSync(path.join(OUT, `flicker-${su.name}-last.png`), buf);
    const fr = { time: +time.toFixed(2), regions: {} };
    let off = 0;
    su.regions.forEach((r) => {
      const ca = anchorColors[r.a.pt.join(',')], cb = anchorColors[r.b.pt.join(',')];
      const sp = samples[su.regions.indexOf(r)];
      if (!ca || !cb) { off += sp.length; fr.regions[r.name] = { aFrac: null, n: 0, other: 0, missingAnchor: true }; return; }
      let na = 0, nb = 0, no = 0;
      sp.forEach((_, j) => {
        const p = sPts[off + j];
        if (!p.vis || p.x < 0 || p.x >= 844 || p.y < 0 || p.y >= 390) { no++; return; }
        if (Math.hypot(p.x - player.x, p.y - player.y) < 25) { no++; return; } // 玩家已隐藏，只避开脚下阴影
        const c = at(img, p.x, p.y), da = dist(c, ca), db = dist(c, cb);
        if (Math.min(da, db) > 60) { no++; return; } // 既非 A 也非 B：建筑、树、车、线条等
        if (da <= db) na++; else nb++;
      });
      off += sp.length;
      const tot = na + nb;
      fr.regions[r.name] = tot ? { aFrac: +(na / tot).toFixed(3), n: tot, other: no } : { aFrac: null, n: 0, other: no };
    });
    frames.push(fr);
  }
  for (const r of su.regions) {
    const vals = frames.map((f) => f.regions[r.name].aFrac).filter((v) => v !== null);
    const swing = vals.length ? +(Math.max(...vals) - Math.min(...vals)).toFixed(3) : null;
    result.setups[r.name] = { a: r.a.label, b: r.b.label, frames: vals, swing, n: frames[0].regions[r.name].n };
    console.log(`[${su.name}] ${r.name}: ${r.a.label}占比各帧 ${vals.join(' ')}，摆动 ${swing}（n=${frames[0].regions[r.name].n}）`);
  }
}

// 雷达：玩家静止站机场，雷达画布两次截图的差异占比
await place(1240, 760, 0, 0.3);
await sleep(800);
const radarEl = await page.$('.radar');
const ra = decodePng(await radarEl.screenshot());
await sleep(500);
const rb = decodePng(await radarEl.screenshot());
let diff = 0, tot = 0;
for (let y = 0; y < ra.h; y++) for (let x = 0; x < ra.w; x++) {
  if (Math.hypot(x - 100, y - 100) > 96) continue; // 圆形雷达内
  tot++;
  const a = at(ra, x, y), b = at(rb, x, y);
  if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 12) diff++;
}
result.radar = { diffFrac: +(diff / tot).toFixed(4), diff, tot };
console.log(`雷达静止两帧差异: ${diff}/${tot} = ${(diff / tot).toFixed(4)}`);

fs.writeFileSync(path.join(OUT, 'flicker-result.json'), JSON.stringify(result, null, 2));
await ctx.close();
console.log('done');
