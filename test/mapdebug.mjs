// 地图调试：把三种模式的可走区域、兵线、塔、营地画成图片，并检查连通性和寻路。
// 用法：node test/mapdebug.mjs   输出到 test/out/map-*.png
import { makeMap, pathLength, pointAlong } from '../moba/js/maps.js';
import { World } from '../moba/js/world.js';
import { writePng } from './png.mjs';
import fs from 'node:fs';
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

let fail = 0;
for (const id of ['5v5', '3v3', '1v1']) {
  const map = makeMap(id), world = new World(map);
  for (const t of map.towers) world.addCircle({ x: t.x, z: t.z, r: 1.9 });
  for (const tm of map.teams) world.addCircle({ x: tm.crystal[0], z: tm.crystal[1], r: 3.2 });
  const K = 5, W = map.size[0] * K, H = map.size[1] * K;
  const img = new Uint8Array(W * H * 3);
  const px = (x, y, r, g, b) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; };
  const dot = (x, z, rad, r, g, b) => { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) px(x * K + dx, z * K + dy, r, g, b); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const solid = world.solidAt(x / K, y / K, 0), nav = world.blocked[world._cell(x / K, y / K)];
    if (solid) px(x, y, 40, 44, 52); else if (nav) px(x, y, 90, 110, 90); else px(x, y, 150, 190, 140);
  }
  for (const lane of map.lanes) { const L = pathLength(lane.pts); for (let d = 0; d < L; d += 0.3) { const p = pointAlong(lane.pts, d); dot(p.x, p.z, 1, 230, 210, 150); } }
  for (const t of map.towers) dot(t.x, t.z, 6 + t.tier, t.team ? 255 : 60, 80, t.team ? 60 : 255);
  for (const tm of map.teams) { dot(tm.crystal[0], tm.crystal[1], 12, 255, 255, 255); dot(tm.spawn[0], tm.spawn[1], 6, 0, 255, 255); }
  for (const c of map.camps) dot(c.x, c.z, c.kind === 'boss' ? 10 : 6, 255, c.kind === 'small' ? 200 : c.kind === 'boss' ? 0 : 120, c.kind === 'blue' ? 255 : 0);
  // 连通性：从蓝方出生点到每个营地、对方出生点都要能寻到路
  const [sx, sz] = map.teams[0].spawn;
  const goals = [...map.camps.map((c) => [c.x, c.z + 3.5, '营地 ' + c.kind]), [map.teams[1].spawn[0], map.teams[1].spawn[1], '红方出生点'], ...map.towers.map((t) => [t.x, t.z + 4, '塔'])];
  for (const [gx, gz, name] of goals) {
    const path = world.findPath(sx, sz, gx, gz);
    let ok = path.length > 0, cx = sx, cz = sz, len = 0;
    for (const [x, z] of path) { if (!world.los(cx, cz, x, z)) ok = false; len += Math.hypot(x - cx, z - cz); for (let t = 0; t <= 1; t += 0.02) dot(cx + (x - cx) * t, cz + (z - cz) * t, 0, 255, 0, 255); cx = x; cz = z; }
    const end = path[path.length - 1];
    if (Math.hypot(end[0] - gx, end[1] - gz) > 3) ok = false;
    if (!ok) { fail++; console.log(`FAIL ${id} 到 ${name} (${gx},${gz}) 寻路失败`); }
  }
  // 营地、塔、出生点不能在墙里
  for (const c of map.camps) if (world.solidAt(c.x, c.z, 1.5)) { fail++; console.log(`FAIL ${id} 营地在墙里`, c); }
  writePng(new URL(`./out/map-${id}.png`, import.meta.url).pathname, W, H, img);
  console.log(`${id}: ${map.walls.length} 道墙, ${map.towers.length} 座塔, ${map.camps.length} 个营地, 网格 ${world.gw}x${world.gh}`);
}
console.log(fail ? `有 ${fail} 项失败` : '地图检查全部通过');
process.exit(fail ? 1 : 0);
