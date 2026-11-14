// 裂谷争锋：静态场景——地面贴图、河水、墙（石堆和树）、地图边缘的树林、基地平台、灯光。
// 全部由地图数据（maps.js）现场生成，不用任何图片文件。
import * as THREE from '../../../shared/js/three.js';
import { Builder, MAT, canvasTexture, makeCanvas } from '../../../shared/js/geo.js';
import { makeRng } from '../../../shared/js/util.js';
import { HERO } from '../config.js';

export const TEAM_COLOR = [0x3f8cff, 0xff5247, 0xffd35a];     // 蓝方、红方、中立
export const TEAM_CSS = ['#3f8cff', '#ff5247', '#ffd35a'];

/**
 * 把整张地图画成一张俯视图：草地、兵线、河道、基地、营地。
 * 既用作地面贴图（px 取 1024/2048），也用作小地图底图（px 取 256 左右）。
 */
export function paintGround(map, px, forMinimap = false) {
  const [W, H] = map.size, k = px / Math.max(W, H);
  const [cv, c] = makeCanvas(Math.round(W * k), Math.round(H * k));
  const rnd = makeRng(20261114);
  c.scale(k, k);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const line = (pts, width, style) => {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.lineWidth = width; c.strokeStyle = style; c.stroke();
  };
  const disc = (x, z, r, style) => { c.beginPath(); c.arc(x, z, r, 0, 6.2832); c.fillStyle = style; c.fill(); };

  // 草地底色，加上深浅不一的色块
  c.fillStyle = forMinimap ? '#3d6b33' : '#4c8a3b'; c.fillRect(0, 0, W, H);
  if (!forMinimap) {
    const greens = ['rgba(98,160,70,.22)', 'rgba(52,110,48,.25)', 'rgba(120,170,74,.16)', 'rgba(40,92,50,.22)', 'rgba(140,168,80,.12)'];
    for (let i = 0; i < W * H / 22; i++) disc(rnd() * W, rnd() * H, 2 + rnd() * 7, greens[(rnd() * greens.length) | 0]);
  }
  // 墙脚下的深色泥土（也给墙体加一圈“接地”的暗影）
  for (const w of map.walls) line([[w[0], w[1]], [w[2], w[3]]], (w[4] + 2.2) * 2, 'rgba(34,52,30,.42)');
  for (const w of map.walls) line([[w[0], w[1]], [w[2], w[3]]], (w[4] + 0.6) * 2, forMinimap ? '#26302a' : 'rgba(26,34,24,.6)');
  // 河岸的沙地
  line(map.river, map.riverWidth + 3.5, '#b9a877');
  // 兵线：土边、石板路面、磨亮的中线
  for (const l of map.lanes) line(l.pts, map.laneWidth + 2.5, 'rgba(106,92,62,.55)');
  for (const l of map.lanes) line(l.pts, map.laneWidth, '#b6a27a');
  for (const l of map.lanes) line(l.pts, map.laneWidth * 0.5, 'rgba(216,200,158,.55)');
  // 河水画在兵线之上、半透明：兵线过河的地方看起来是一段浅滩
  line(map.river, map.riverWidth, 'rgba(44,136,168,.82)');
  line(map.river, map.riverWidth * 0.6, 'rgba(84,186,214,.6)');
  if (!forMinimap) {
    // 路面上的碎石斑点：只画在路面颜色上
    for (const l of map.lanes) for (let i = 0; i < l.pts.length - 1; i++) {
      const [ax, az] = l.pts[i], [bx, bz] = l.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
      for (let n = 0; n < len * 3; n++) {
        const t = rnd(), o = (rnd() - 0.5) * map.laneWidth * 0.9;
        const x = ax + (bx - ax) * t - ((bz - az) / len) * o, z = az + (bz - az) * t + ((bx - ax) / len) * o;
        c.fillStyle = rnd() < 0.5 ? 'rgba(92,78,54,.22)' : 'rgba(236,224,190,.2)';
        c.fillRect(x, z, 0.3 + rnd() * 0.9, 0.3 + rnd() * 0.6);
      }
    }
  }
  // 野怪营地：一圈压实的土
  for (const cp of map.camps) { disc(cp.x, cp.z, cp.kind === 'boss' ? 6.5 : 4.6, 'rgba(70,56,38,.45)'); disc(cp.x, cp.z, cp.kind === 'boss' ? 4.4 : 3, 'rgba(110,92,62,.4)'); }
  // 塔基
  for (const t of map.towers) { disc(t.x, t.z, 3.3, 'rgba(60,62,70,.55)'); disc(t.x, t.z, 2.6, '#8a8f9c'); }
  // 基地：石台 + 队伍颜色的光环；泉水
  map.teams.forEach((tm, i) => {
    const col = TEAM_CSS[i], [x, z] = tm.crystal, [sx, sz] = tm.spawn;
    const g = c.createRadialGradient(x, z, 2, x, z, 15);
    g.addColorStop(0, '#a9afbd'); g.addColorStop(0.75, '#7d8493'); g.addColorStop(1, 'rgba(125,132,147,0)');
    disc(x, z, 15, g);
    c.lineWidth = 0.7; c.strokeStyle = col; c.globalAlpha = 0.85;
    for (const r of [5.2, 9.5]) { c.beginPath(); c.arc(x, z, r, 0, 6.2832); c.stroke(); }
    c.globalAlpha = 1;
    const f = c.createRadialGradient(sx, sz, 0.5, sx, sz, HERO.fountainRange);
    f.addColorStop(0, i ? 'rgba(255,170,150,.95)' : 'rgba(160,215,255,.95)'); f.addColorStop(0.55, i ? 'rgba(220,90,80,.6)' : 'rgba(70,150,240,.6)'); f.addColorStop(1, 'rgba(0,0,0,0)');
    disc(sx, sz, HERO.fountainRange, f);
  });
  // 地图边缘压暗
  if (!forMinimap) {
    const e = 9;
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, e, 0, 0, 0, e, H], [W, 0, W - e, 0, W - e, 0, e, H], [0, 0, 0, e, 0, 0, W, e], [0, H, 0, H - e, 0, H - e, W, e]]) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(14,28,20,.95)'); g.addColorStop(1, 'rgba(14,28,20,0)');
      c.fillStyle = g; c.fillRect(rx, ry, rw, rh);
    }
  }
  return cv;
}

/** 可平铺的细节纹理：亮度在 1 附近浮动的草叶/颗粒，乘到地面贴图上，近看不糊 */
function detailTexture() {
  const S = 256, [cv, c] = makeCanvas(S, S), rnd = makeRng(7);
  c.fillStyle = '#d2d2d2'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, l = 2 + rnd() * 5, a = rnd() * 6.283;
    const v = rnd() < 0.5 ? 255 : 110;
    c.strokeStyle = `rgba(${v},${v},${v},${0.10 + rnd() * 0.16})`;
    c.lineWidth = 0.8 + rnd() * 1.4;
    // 每一笔在四周各画一份，保证贴图边缘能无缝拼接
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      c.beginPath(); c.moveTo(x + ox, y + oy); c.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); c.stroke();
    }
  }
  return cv;
}

/** 水面的流光纹理（可平铺） */
function waterTexture() {
  const S = 128, [cv, c] = makeCanvas(S, S), rnd = makeRng(11);
  c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
  c.strokeStyle = 'rgba(200,240,255,.5)'; c.lineWidth = 2; c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, l = 10 + rnd() * 22;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      c.beginPath(); c.moveTo(x + ox, y + oy); c.quadraticCurveTo(x + ox + l * 0.5, y + oy + 5, x + ox + l, y + oy); c.stroke();
    }
  }
  return cv;
}

/** 一棵树：松树（两层圆锥）或阔叶树（圆球树冠） */
function tree(b, x, z, s, rnd) {
  const trunk = [0x4a3524, 0x6b4a30];
  if (rnd() < 0.6) {
    const g1 = [0x1f5a34, 0x3f9450], g2 = [0x2a6e3c, 0x58b060];
    b.cyl(0.16 * s, 0.24 * s, 1.1 * s, trunk, x, 0.55 * s, z, 0, 0, 0, 5);
    b.cone(1.15 * s, 2.0 * s, g1, x, 1.9 * s, z, 0, rnd() * 3, 0, 6);
    b.cone(0.85 * s, 1.7 * s, g2, x, 3.0 * s, z, 0, rnd() * 3, 0, 6);
  } else {
    b.cyl(0.18 * s, 0.26 * s, 1.5 * s, trunk, x, 0.75 * s, z, 0, 0, 0, 5);
    b.rock(1.25 * s, [0x2c7038, 0x6cc060], x, 2.3 * s, z, rnd(), rnd() * 3, 0, 1, 0.9, 1);
    b.rock(0.8 * s, [0x3a8544, 0x86d070], x + 0.5 * s, 3.0 * s, z - 0.3 * s, 0, rnd() * 3, 0, 1, 0.85, 1);
  }
}

/**
 * 生成整个静态场景，返回 { group, update(dt), dispose() }。
 * 墙和树按 48×48 的地块分成多个网格，镜头外的地块会被自动剔除，不占绘制开销。
 */
export function buildScene(map, scene, hiRes) {
  const [W, H] = map.size;
  const group = new THREE.Group();
  const disposables = [];
  const rnd = makeRng(4242);

  // ---- 地面：整图贴图 × 平铺细节 ----
  const paint = canvasTexture(paintGround(map, hiRes ? 2048 : 1024), { aniso: 4 });
  const detail = canvasTexture(detailTexture(), { repeat: [W / 7, H / 7], aniso: 4 });
  const gmat = new THREE.MeshBasicMaterial({ map: detail, lightMap: paint, lightMapIntensity: 1.22 * Math.PI });
  const ggeo = new THREE.PlaneGeometry(W, H); ggeo.rotateX(-Math.PI / 2); ggeo.translate(W / 2, 0, H / 2);
  const ground = new THREE.Mesh(ggeo, gmat);
  ground.matrixAutoUpdate = false;
  group.add(ground);
  disposables.push(paint, detail, gmat, ggeo);
  // 地图外面一圈深色地面，镜头移到边缘时不会露出空白
  const ogeo = new THREE.PlaneGeometry(W + 160, H + 160); ogeo.rotateX(-Math.PI / 2); ogeo.translate(W / 2, -0.05, H / 2);
  const outer = new THREE.Mesh(ogeo, new THREE.MeshBasicMaterial({ color: 0x0f1f17 }));
  outer.matrixAutoUpdate = false;
  group.add(outer);

  // ---- 河水流光：沿河道铺一条半透明的滚动贴图 ----
  const wtex = canvasTexture(waterTexture(), { repeat: [1, 1] });
  const wmat = new THREE.MeshBasicMaterial({ map: wtex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const wpos = [], wuv = [];
  for (let i = 0; i < map.river.length - 1; i++) {
    const [ax, az] = map.river[i], [bx, bz] = map.river[i + 1], len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len * map.riverWidth * 0.5, nz = (bx - ax) / len * map.riverWidth * 0.5;
    const q = [[ax - nx, az - nz, 0, 0], [ax + nx, az + nz, 1, 0], [bx + nx, bz + nz, 1, len / 12], [bx - nx, bz - nz, 0, len / 12]];
    for (const j of [0, 1, 2, 0, 2, 3]) { wpos.push(q[j][0], 0.04, q[j][1]); wuv.push(q[j][2] * map.riverWidth / 12, q[j][3]); }
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  const water = new THREE.Mesh(wgeo, wmat);
  water.matrixAutoUpdate = false; water.renderOrder = 1;
  group.add(water);
  disposables.push(wtex, wmat, wgeo);

  // ---- 墙、边缘树林、基地装饰：按地块合并 ----
  const CH = 48, chunks = new Map();
  const at = (x, z) => {
    const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
    let b = chunks.get(key); if (!b) { b = new Builder(); chunks.set(key, b); }
    return b;
  };
  const rockCol = [[0x535a66, 0x8e96a4], [0x5c5a52, 0x9a9686], [0x4a525c, 0x808a98]];
  for (const w of map.walls) {
    const [x1, z1, x2, z2, r] = w, len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 2.1));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0, x = x1 + (x2 - x1) * t + (rnd() - 0.5) * 0.6, z = z1 + (z2 - z1) * t + (rnd() - 0.5) * 0.6;
      const s = r * (0.82 + rnd() * 0.22), b = at(x, z);
      b.rock(s, rockCol[(rnd() * 3) | 0], x, s * 0.42, z, rnd() * 0.5, rnd() * 6.3, rnd() * 0.5, 1, 0.9 + rnd() * 0.45, 1);
      if (rnd() < 0.55) b.rock(s * 0.5, [0x3b7a3c, 0x7cc36a], x + (rnd() - 0.5) * s, s * 1.05, z + (rnd() - 0.5) * s, 0, rnd() * 6, 0, 1.2, 0.35, 1.2);   // 苔藓
      if (rnd() < 0.5) tree(b, x + (rnd() - 0.5) * r * 0.7, z + (rnd() - 0.5) * r * 0.7, 0.8 + rnd() * 0.45, rnd);
    }
  }
  // 地图四周的树林（两排，挡住地图边界）
  const edge = (x, z) => { const b = at(x, z); if (rnd() < 0.8) tree(b, x, z, 1.1 + rnd() * 0.9, rnd); else b.rock(1.2 + rnd() * 1.3, rockCol[(rnd() * 3) | 0], x, 0.6, z, rnd(), rnd() * 6, rnd(), 1, 0.8 + rnd() * 0.5, 1); };
  for (let x = -6; x <= W + 6; x += 2.6) for (const o of [-1.5, -5.5]) { edge(x + rnd() * 1.4, o + rnd() * 1.6 + 1.2); edge(x + rnd() * 1.4, H - o - rnd() * 1.6 - 1.2); }
  for (let z = 2; z <= H - 2; z += 2.6) for (const o of [-1.5, -5.5]) { edge(o + rnd() * 1.6 + 1.2, z + rnd() * 1.4); edge(W - o - rnd() * 1.6 - 1.2, z + rnd() * 1.4); }
  // 基地：水晶底座和泉水的立柱
  map.teams.forEach((tm, i) => {
    const [x, z] = tm.crystal, [sx, sz] = tm.spawn, col = TEAM_COLOR[i], b = at(x, z);
    b.cyl(4.6, 5.2, 0.5, [0x6f7686, 0x9aa1b2], x, 0.25, z, 0, 0, 0, 12);
    b.cyl(3.6, 4.0, 0.4, [0x858c9c, 0xb4bac8], x, 0.7, z, 0, 0, 0, 12);
    for (let a = 0; a < 4; a++) {
      const px = x + Math.cos(a * 1.571 + 0.785) * 4.3, pz = z + Math.sin(a * 1.571 + 0.785) * 4.3;
      b.cyl(0.35, 0.5, 2.6, [0x6c7384, 0xa6adbc], px, 1.3, pz, 0, 0, 0, 6);
      b.rock(0.45, col, px, 3.0, pz, 0, 0.6, 0, 1, 1.5, 1);
    }
    const f = at(sx, sz);
    f.cyl(3.2, 3.5, 0.3, [0x7a8191, 0xa8afbe], sx, 0.15, sz, 0, 0, 0, 12);
    f.torus(2.6, 0.18, col, sx, 0.4, sz, Math.PI / 2, 0, 0, 16);
  });
  const staticMeshes = [];
  for (const b of chunks.values()) {
    if (!b.count) continue;
    const m = b.mesh(MAT.vcFlat, true);
    m.matrixAutoUpdate = false; m.castShadow = true;
    group.add(m); staticMeshes.push(m); disposables.push(m.geometry);
  }

  // ---- 灯光 ----
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x4b5a3c, 1.25);
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.9);
  sun.position.set(-30, 60, 25);
  group.add(hemi, sun, sun.target);
  scene.add(group);
  scene.background = new THREE.Color(0x0f1f17);

  return {
    group, sun, ground, staticMeshes,
    /** 水面流动 */
    update(dt) { wtex.offset.y -= dt * 0.12; wtex.offset.x += dt * 0.03; },
    dispose() { scene.remove(group); for (const d of disposables) d.dispose(); },
  };
}
