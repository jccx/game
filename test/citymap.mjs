// 落日湾地图调试：把地形、路网、建筑、特殊地点画成一张俯视图，并做基本检查。
// 用法：node test/citymap.mjs   输出 test/out/city-map.png
import { World, terrainY, SIZE, AIRPORT, BASE, RUNWAY } from '../city/js/world.js';
import { writePng } from './png.mjs';
import fs from 'node:fs';
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const t0 = Date.now();
const w = new World();
const K = 0.5, W = SIZE * K, img = new Uint8Array(W * W * 3);
const px = (x, y, r, g, b) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= W) return; const i = (y * W + x) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; };
const rect = (x0, z0, x1, z1, r, g, b) => { for (let y = Math.floor(z0 * K); y < z1 * K; y++) for (let x = Math.floor(x0 * K); x < x1 * K; x++) px(x, y, r, g, b); };
let land = 0;
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const h = terrainY(x / K, y / K);
  if (h < -0.6) px(x, y, 30, 90 + Math.max(-60, h * 5), 150);
  else if (h < 1.2) { px(x, y, 215, 200, 150); land++; }
  else { const s = Math.min(1, (h - 2) / 110); px(x, y, 80 + s * 110, 140 - s * 20, 70 + s * 80); land++; }
}
for (const b of w.blocks) { const c = { downtown: [150, 150, 160], commercial: [170, 160, 150], residential: [120, 170, 110], industrial: [150, 140, 120], park: [70, 150, 70], farm: [150, 170, 90] }[b.zone]; rect(b.x0, b.z0, b.x1, b.z1, ...c); }
for (const e of w.edges) e.horiz ? rect(e.a.x, e.a.z - 7, e.b.x, e.a.z + 7, 60, 60, 66) : rect(e.a.x - 7, e.a.z, e.a.x + 7, e.b.z, 60, 60, 66);
for (const n of w.roadNodes) rect(n.x - 7, n.z - 7, n.x + 7, n.z + 7, 70, 70, 76);
rect(AIRPORT[0], AIRPORT[1], AIRPORT[2], AIRPORT[3], 120, 124, 130); rect(RUNWAY.x - RUNWAY.w / 2, RUNWAY.z0, RUNWAY.x + RUNWAY.w / 2, RUNWAY.z1, 40, 40, 46);
rect(BASE[0], BASE[1], BASE[2], BASE[3], 110, 118, 96);
for (const b of w.buildings) { const v = Math.min(255, 90 + b.h * 1.2); rect(b.x0, b.z0, b.x1, b.z1, v, v * 0.9, v * 0.8); }
for (const t of w.trees) px(t[0] * K, t[1] * K, 20, 90, 30);
const P = w.places;
rect(P.spawn.x - 4, P.spawn.z - 4, P.spawn.x + 4, P.spawn.z + 4, 255, 255, 0);
rect(P.hospital.x - 4, P.hospital.z - 4, P.hospital.x + 4, P.hospital.z + 4, 255, 60, 60);
rect(P.pier.x0, P.pier.z0, P.pier.x1, P.pier.z1, 160, 120, 80);
for (const b of P.boats) rect(b[0] - 3, b[1] - 3, b[0] + 3, b[1] + 3, 255, 255, 255);
for (const b of P.planes) rect(b[0] - 5, b[1] - 5, b[0] + 5, b[1] + 5, 255, 0, 255);
for (const b of P.tanks) rect(b[0] - 4, b[1] - 4, b[0] + 4, b[1] + 4, 0, 255, 255);
writePng(new URL('./out/city-map.png', import.meta.url).pathname, W, W, img);
// 检查
let fail = 0; const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const zones = {}; for (const b of w.blocks) zones[b.zone] = (zones[b.zone] || 0) + 1;
console.log(`生成耗时 ${Date.now() - t0}ms；路口 ${w.roadNodes.length}，路段 ${w.edges.length}，街区 ${w.blocks.length}`, zones, `建筑 ${w.buildings.length}，树 ${w.trees.length}，陆地占比 ${(land / (W * W) * 100).toFixed(0)}%`);
chk(w.roadNodes.length > 80, '路口数量足够');
chk(Math.abs(w.groundY(P.spawn.x, P.spawn.z) - 2.16) < 0.01, `出生点在人行道上（高度 ${w.groundY(P.spawn.x, P.spawn.z)}）`);
let inB = false; w.nearBuildings(P.spawn.x, P.spawn.z, 2, (b) => { if (P.spawn.x > b.x0 - 1 && P.spawn.x < b.x1 + 1 && P.spawn.z > b.z0 - 1 && P.spawn.z < b.z1 + 1) inB = true; });
chk(!inB, '出生点不在建筑里');
chk(w.groundY(P.pier.x0 + 5, P.pier.z1 - 2) === 2 && terrainY(P.pier.x0 + 5, P.pier.z1 - 2) < -1, '栈桥伸到了海面上');
chk(P.boats.every((b) => w.inWater(b[0], b[1]) && terrainY(b[0], b[1]) < -1), '船停在水里');
chk(terrainY(RUNWAY.x, RUNWAY.z0) === 2 && terrainY(RUNWAY.x, RUNWAY.z1) === 2, '跑道两端都是平地');
chk(P.tanks.every((b) => terrainY(b[0], b[1]) === 2), '坦克停在平地上');
// 路网连通：从出生点最近的路口能到所有路口
const s = w.nearestNode(P.spawn.x, P.spawn.z); let reach = 0;
for (const n of w.roadNodes) if (w.route(s, n).at(-1) === n) reach++;
chk(reach === w.roadNodes.length, `路网连通（${reach}/${w.roadNodes.length}）`);
chk(!w.blocked(P.spawn.x, P.spawn.z, P.spawn.x - 12, P.spawn.z), '出生点到路上没有被建筑挡住');
process.exit(fail ? 1 : 0);
