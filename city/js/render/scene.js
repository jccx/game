// 落日湾：静态场景——地形、海面、天空、道路、街区、建筑、树木、路灯。全部由 world.js 的数据现场生成。
// 为了性能，建筑和树按 320 米见方的地块合并成少量网格；镜头外和太远的地块不绘制。
import * as THREE from '../../../shared/js/three.js';
import { Builder, MAT, canvasTexture, makeCanvas } from '../../../shared/js/geo.js';
import { makeRng, fbm2 } from '../../../shared/js/util.js';
import { SIZE, PITCH, ROAD, CITY_Y, CURB, AIRPORT, BASE, RUNWAY, terrainY } from '../world.js';

const CHUNK = 320;
export const FOG_COLOR = 0xf3c7a2;       // 傍晚的暖色雾，和天空地平线同色

/** 路面贴图：沥青、两侧白线、中间黄色虚线 */
function roadTexture() {
  const [cv, c] = makeCanvas(64, 64), rnd = makeRng(3);
  c.fillStyle = '#4a4d55'; c.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 260; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)'; c.fillRect(rnd() * 64, rnd() * 64, 1 + rnd() * 2, 1 + rnd() * 2); }
  c.fillStyle = '#d9dde4'; c.fillRect(2, 0, 2, 64); c.fillRect(60, 0, 2, 64);
  c.fillStyle = '#e8c44a'; c.fillRect(31, 0, 2, 34);
  return cv;
}

/** 楼房外墙贴图：2×2 扇窗，其中一扇亮着灯。墙面是浅色，由顶点颜色染成各栋楼的颜色 */
function windowTexture() {
  const [cv, c] = makeCanvas(128, 128);
  c.fillStyle = '#eceae6'; c.fillRect(0, 0, 128, 128);
  c.fillStyle = 'rgba(0,0,0,.07)'; c.fillRect(0, 60, 128, 4); c.fillRect(0, 124, 128, 4);       // 楼层线
  const win = (x, y, lit) => {
    const g = c.createLinearGradient(0, y, 0, y + 34);
    if (lit) { g.addColorStop(0, '#ffe7a8'); g.addColorStop(1, '#f0b860'); } else { g.addColorStop(0, '#6f93b8'); g.addColorStop(1, '#2b4058'); }
    c.fillStyle = '#8a8f98'; c.fillRect(x - 2, y - 2, 38, 38);
    c.fillStyle = g; c.fillRect(x, y, 34, 34);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x, y, 34, 3);
  };
  win(15, 14, false); win(79, 14, true); win(15, 78, false); win(79, 78, false);
  return cv;
}

/** 海面贴图：蓝色底上几道浅色水纹（可平铺） */
function seaTexture() {
  const S = 128, [cv, c] = makeCanvas(S, S), rnd = makeRng(5);
  c.fillStyle = '#2d7da1'; c.fillRect(0, 0, S, S);
  c.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    const x = rnd() * S, y = rnd() * S, l = 8 + rnd() * 26;
    c.strokeStyle = rnd() < 0.5 ? 'rgba(180,225,240,.28)' : 'rgba(20,70,110,.3)'; c.lineWidth = 1 + rnd() * 2;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { c.beginPath(); c.moveTo(x + ox, y + oy); c.quadraticCurveTo(x + ox + l / 2, y + oy + 4, x + ox + l, y + oy); c.stroke(); }
  }
  return cv;
}

/** 一棵树（约 6~12 米高） */
function tree(b, x, y, z, s, rnd) {
  const trunk = [0x4a3524, 0x6b4a30];
  if (rnd() < 0.5) {
    b.cyl(0.25 * s, 0.4 * s, 2.2 * s, trunk, x, y + 1.1 * s, z, 0, 0, 0, 5);
    b.cone(2.1 * s, 3.6 * s, [0x245a30, 0x4f9a52], x, y + 3.6 * s, z, 0, rnd() * 3, 0, 6);
    b.cone(1.5 * s, 3.0 * s, [0x2f6e3a, 0x6ab862], x, y + 5.6 * s, z, 0, rnd() * 3, 0, 6);
  } else {
    b.cyl(0.3 * s, 0.45 * s, 2.8 * s, trunk, x, y + 1.4 * s, z, 0, 0, 0, 5);
    b.rock(2.4 * s, [0x2f7038, 0x7cc264], x, y + 4.4 * s, z, rnd(), rnd() * 3, 0, 1, 0.85, 1);
    b.rock(1.5 * s, [0x3c8544, 0x92d476], x + 0.9 * s, y + 5.8 * s, z - 0.5 * s, 0, rnd() * 3, 0, 1, 0.8, 1);
  }
}

/** 斜屋顶：一个三角柱的几何体（宽 1、高 1、深 1，屋脊沿 z） */
let _prism = null;
function prism() {
  if (_prism) return _prism;
  const p = [-0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,          // 两个山墙
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,                    // 左坡
    0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5];                      // 右坡
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals(); g.computeBoundingBox();
  return (_prism = g);
}

/**
 * 生成整个静态场景。返回 { group, chunks, update(dt, camX, camZ, far), dispose() }。
 */
export function buildScene(world, scene, hiRes) {
  const group = new THREE.Group(), disposables = [];
  const rnd = makeRng(99);

  // ---------- 地形 ----------
  const N = hiRes ? 160 : 128, tg = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  tg.rotateX(-Math.PI / 2); tg.translate(SIZE / 2, 0, SIZE / 2);
  const pos = tg.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = terrainY(x, z);
    const n = fbm2(x * 0.03, z * 0.03, 2, 8);
    if (y < -0.6) c.setHex(0x8f8a66).lerp(new THREE.Color(0x1f4a5e), Math.min(1, -y / 9));       // 水下的沙
    else if (y < 1.4) c.setHex(0xe2cf96);                                                           // 沙滩
    else if (y > 96) c.setHex(0xf2f4f6);                                                            // 山顶的雪
    else if (y > 55) c.setHex(0x8a8376).lerp(new THREE.Color(0x6a7a5a), n);                         // 岩石
    else c.setHex(0x5e9a48).lerp(new THREE.Color(0x86b25a), n);                                     // 草地
    if (y === CITY_Y) y = CITY_Y - 0.12;        // 城区的地形略低于路面，避免和道路、街区的面重叠闪烁
    pos.setY(i, y);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, MAT.vc);
  terrain.matrixAutoUpdate = false; group.add(terrain); disposables.push(tg);

  // ---------- 海面 ----------
  const stex = canvasTexture(seaTexture(), { repeat: [150, 150] });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: stex, transparent: true, opacity: 0.9 }));
  sea.position.set(SIZE / 2, 0, SIZE / 2); sea.renderOrder = 1; group.add(sea);
  disposables.push(stex, sea.geometry, sea.material);

  // ---------- 天空：下暖上蓝的渐变球，加一轮落日 ----------
  const sg = new THREE.SphereGeometry(1500, 20, 12), sp = sg.attributes.position, sc = new Float32Array(sp.count * 3);
  const cTop = new THREE.Color(0x3f6fb8), cMid = new THREE.Color(0xf0a892), cLow = new THREE.Color(FOG_COLOR);
  for (let i = 0; i < sp.count; i++) {
    const t = Math.max(0, sp.getY(i) / 1500);
    c.copy(cLow).lerp(cMid, Math.min(1, t * 4)).lerp(cTop, Math.min(1, Math.max(0, t - 0.12) * 1.6));
    sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
  }
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; group.add(sky);
  const [sunCv, sx] = makeCanvas(128, 128), sgr = sx.createRadialGradient(64, 64, 6, 64, 64, 64);
  sgr.addColorStop(0, 'rgba(255,250,220,1)'); sgr.addColorStop(0.25, 'rgba(255,214,140,.9)'); sgr.addColorStop(1, 'rgba(255,150,80,0)');
  sx.fillStyle = sgr; sx.fillRect(0, 0, 128, 128);
  const sunTex = canvasTexture(sunCv);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.set(520, 520, 1); sunSprite.renderOrder = -9; group.add(sunSprite);
  disposables.push(sg, sky.material, sunTex, sunSprite.material);

  // ---------- 道路 ----------
  const rp = [], ruv = [], quad = (x0, z0, x1, z1, u0, v0, u1, v1) => {
    const y = CITY_Y + 0.03;
    rp.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    ruv.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
  };
  const h = ROAD / 2;
  for (const e of world.edges) {
    const len = PITCH - ROAD;
    if (e.horiz) {   // 横向的路：贴图要转 90 度，所以四个角的 uv 单独给
      const x0 = e.a.x + h, x1 = e.b.x - h, z0 = e.a.z - h, z1 = e.a.z + h, y = CITY_Y + 0.03, v = len / 8;
      rp.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      ruv.push(0, 0, 1, 0, 1, v, 0, 0, 1, v, 0, v);
    } else quad(e.a.x - h, e.a.z + h, e.a.x + h, e.b.z - h, 0, 0, 1, len / 8);
  }
  for (const n of world.roadNodes) quad(n.x - h, n.z - h, n.x + h, n.z + h, 0.25, 0.75, 0.25, 0.75);     // 路口：纯沥青
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  rg.computeVertexNormals();
  const rtex = canvasTexture(roadTexture(), { repeat: [1, 1], aniso: 4 });
  const roads = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: rtex }));
  roads.matrixAutoUpdate = false; group.add(roads);
  disposables.push(rg, rtex, roads.material);

  // ---------- 街区、建筑、树、路灯：按地块分组 ----------
  const chunks = new Map();
  const at = (x, z) => {
    const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let ch = chunks.get(key);
    if (!ch) chunks.set(key, ch = { b: new Builder(), p: [], n: [], u: [], c: [], cx: (Math.floor(x / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(z / CHUNK) + 0.5) * CHUNK });
    return ch;
  };
  const ZONE_COLOR = { downtown: 0xb9bcc0, commercial: 0xc6c0b2, residential: 0x7fb26a, industrial: 0xa59e8f, park: 0x63a651, farm: 0xb4c26a };
  for (const bl of world.blocks) {
    const cx = (bl.x0 + bl.x1) / 2, cz = (bl.z0 + bl.z1) / 2;
    at(cx, cz).b.box(bl.x1 - bl.x0, CURB + 0.1, bl.z1 - bl.z0, ZONE_COLOR[bl.zone], cx, CITY_Y + CURB / 2 - 0.05, cz);
  }
  // 机场停机坪和跑道、军营地面、栈桥
  const ap = at((AIRPORT[0] + AIRPORT[2]) / 2, (AIRPORT[1] + AIRPORT[3]) / 2).b;
  ap.box(AIRPORT[2] - AIRPORT[0], 0.1, AIRPORT[3] - AIRPORT[1], 0x9a9ea6, (AIRPORT[0] + AIRPORT[2]) / 2, CITY_Y - 0.02, (AIRPORT[1] + AIRPORT[3]) / 2);
  ap.box(RUNWAY.w, 0.1, RUNWAY.z1 - RUNWAY.z0, 0x3a3d44, RUNWAY.x, CITY_Y + 0.01, (RUNWAY.z0 + RUNWAY.z1) / 2);
  for (let z = RUNWAY.z0 + 20; z < RUNWAY.z1 - 20; z += 24) ap.box(0.8, 0.1, 10, 0xf0f0f0, RUNWAY.x, CITY_Y + 0.03, z);
  for (const z of [RUNWAY.z0 + 6, RUNWAY.z1 - 6]) for (let k = -4; k <= 4; k++) ap.box(1.6, 0.1, 8, 0xf0f0f0, RUNWAY.x + k * 3, CITY_Y + 0.03, z);
  at((BASE[0] + BASE[2]) / 2, (BASE[1] + BASE[3]) / 2).b.box(BASE[2] - BASE[0], 0.1, BASE[3] - BASE[1], 0x8a8f78, (BASE[0] + BASE[2]) / 2, CITY_Y - 0.02, (BASE[1] + BASE[3]) / 2);
  const pr = world.places.pier, pb = at((pr.x0 + pr.x1) / 2, pr.z1).b;
  pb.box(pr.x1 - pr.x0, 0.5, pr.z1 - pr.z0, [0x6b4f34, 0x9a7650], (pr.x0 + pr.x1) / 2, CITY_Y - 0.25, (pr.z0 + pr.z1) / 2);
  for (let z = pr.z0 + 6; z < pr.z1; z += 12) for (const x of [pr.x0 + 0.5, pr.x1 - 0.5]) pb.cyl(0.35, 0.35, 7, 0x5a4028, x, CITY_Y - 3.6, z, 0, 0, 0, 6);

  // 建筑
  const ROOFS = [0x9a4a3a, 0x6b4a3a, 0x4a5a6a, 0x7a3a2a, 0x5a6a4a];
  const wall = (ch, x0, z0, x1, z1, y0, y1, nx, nz, color, bay, floor) => {
    // 一面带窗户贴图的墙：从 (x0,z0) 到 (x1,z1)，法线 (nx,nz)
    const len = Math.hypot(x1 - x0, z1 - z0), u = len / bay, v = (y1 - y0) / floor;
    c.setHex(color);
    const P = [[x0, y0, z0, 0, 0], [x1, y0, z1, u, 0], [x1, y1, z1, u, v], [x0, y0, z0, 0, 0], [x1, y1, z1, u, v], [x0, y1, z0, 0, v]];
    for (const q of P) { ch.p.push(q[0], q[1], q[2]); ch.n.push(nx, 0, nz); ch.u.push(q[3], q[4]); ch.c.push(c.r, c.g, c.b); }
  };
  for (const bd of world.buildings) {
    const cx = (bd.x0 + bd.x1) / 2, cz = (bd.z0 + bd.z1) / 2, w = bd.x1 - bd.x0, d = bd.z1 - bd.z0, ch = at(cx, cz), y0 = bd.y0, y1 = bd.y0 + bd.h;
    if (bd.kind === 'ware' || bd.kind === 'wall') {
      c.setHex(bd.color); const dark = c.clone().multiplyScalar(0.72).getHex();
      ch.b.box(w, bd.h, d, [dark, bd.color], cx, y0 + bd.h / 2, cz);
      if (bd.kind === 'ware') ch.b.box(w * 0.3, Math.min(5, bd.h * 0.6), 0.3, 0x3a3f48, cx, y0 + Math.min(5, bd.h * 0.6) / 2, bd.z1 + 0.05);      // 卷帘门
      continue;
    }
    const bay = bd.kind === 'house' ? 5 : 8, fl = bd.kind === 'house' ? 5.6 : 6.8;
    wall(ch, bd.x0, bd.z1, bd.x1, bd.z1, y0, y1, 0, 1, bd.color, bay, fl);
    wall(ch, bd.x1, bd.z0, bd.x0, bd.z0, y0, y1, 0, -1, bd.color, bay, fl);
    wall(ch, bd.x1, bd.z1, bd.x1, bd.z0, y0, y1, 1, 0, bd.color, bay, fl);
    wall(ch, bd.x0, bd.z0, bd.x0, bd.z1, y0, y1, -1, 0, bd.color, bay, fl);
    if (bd.roof === 2) ch.b.add(prism(), ROOFS[(rnd() * ROOFS.length) | 0], cx, y1, cz, 0, 0, 0, w + 1.2, 2.6, d + 1.2);       // 斜屋顶
    else {
      c.setHex(bd.color); ch.b.box(w, 0.5, d, c.multiplyScalar(0.55).getHex(), cx, y1 + 0.2, cz);
      if (bd.roof === 1) { ch.b.box(w * 0.3, 3, d * 0.3, 0x7a808a, cx + w * 0.15, y1 + 1.8, cz - d * 0.1); ch.b.cyl(0.15, 0.15, 9, 0xb0b6c0, cx - w * 0.2, y1 + 4.5, cz + d * 0.2, 0, 0, 0, 4); }
      else if (bd.h > 14) ch.b.box(3, 1.6, 3, 0x8a9098, cx - w * 0.2, y1 + 1, cz + d * 0.15);
    }
  }
  // 树：城区里的种在人行道高度上，野外的种在地形上
  for (const [x, z, s] of world.trees) tree(at(x, z).b, x, Math.max(world.groundY(x, z), 0), z, s * 0.9, rnd);
  // 路灯：每个路口对角各一盏
  for (const n of world.roadNodes) for (const sg2 of [1, -1]) {
    const x = n.x + sg2 * (h + 1.2), z = n.z + sg2 * (h + 1.2), b = at(x, z).b;
    b.cyl(0.1, 0.14, 6.5, 0x4a4f58, x, CITY_Y + 3.4, z, 0, 0, 0, 5); b.box(1.6, 0.14, 0.3, 0x4a4f58, x - sg2 * 0.7, CITY_Y + 6.6, z); b.box(0.5, 0.12, 0.34, 0xfff2c0, x - sg2 * 1.3, CITY_Y + 6.5, z);
  }

  const wtex = canvasTexture(windowTexture(), { repeat: [1, 1], aniso: 4 });
  const wmat = new THREE.MeshLambertMaterial({ map: wtex, vertexColors: true });
  disposables.push(wtex, wmat);
  const list = [];
  for (const ch of chunks.values()) {
    const meshes = [];
    if (ch.b.count) { const m = ch.b.mesh(MAT.vcFlat, true); m.matrixAutoUpdate = false; group.add(m); meshes.push(m); disposables.push(m.geometry); }
    if (ch.p.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(ch.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(ch.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(ch.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(ch.c, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, wmat); m.matrixAutoUpdate = false; group.add(m); meshes.push(m); disposables.push(g);
    }
    list.push({ cx: ch.cx, cz: ch.cz, meshes });
  }

  // ---------- 灯光：低角度的暖色夕阳 + 天空散射光 ----------
  const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x9a7a5c, 1.15);
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.3);
  sun.position.set(-0.75, 0.5, 0.35).multiplyScalar(100);
  group.add(hemi, sun);
  scene.add(group);
  scene.fog = new THREE.Fog(FOG_COLOR, 220, 950);
  scene.background = new THREE.Color(FOG_COLOR);

  return {
    group, chunks: list,
    /** 每帧：海面流动；天空和太阳跟着镜头；太远的地块不画 */
    update(dt, cx, cy, cz, far) {
      stex.offset.x += dt * 0.004; stex.offset.y += dt * 0.007;
      sky.position.set(cx, 0, cz);
      sunSprite.position.set(cx - 1150, cy * 0.2 + 250, cz + 520);
      sea.position.set(Math.round(cx / 40) * 40, 0, Math.round(cz / 40) * 40);
      for (const ch of list) { const vis = Math.hypot(ch.cx - cx, ch.cz - cz) < far + CHUNK * 0.75; for (const m of ch.meshes) m.visible = vis; }
    },
    dispose() { scene.remove(group); scene.fog = null; for (const d of disposables) d.dispose(); },
  };
}

/** 画一张全岛地图（给雷达和大地图用）。返回画布；px 是边长像素 */
export function paintMap(world, px) {
  const [cv, c] = makeCanvas(px, px), k = px / SIZE, img = c.createImageData(px, px), d = img.data;
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const h = terrainY((x + 0.5) / k, (y + 0.5) / k), i = (y * px + x) * 4;
    let r, g, b;
    if (h < -0.6) { const t = Math.min(1, -h / 8); r = 52 - t * 22; g = 118 - t * 38; b = 150 - t * 30; }
    else if (h < 1.4) { r = 214; g = 198; b = 148; }
    else { const t = Math.min(1, (h - 2) / 100); r = 96 + t * 90; g = 142 - t * 10; b = 84 + t * 70; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  c.scale(k, k);
  const ZC = { downtown: '#b0b3b8', commercial: '#bdb7aa', residential: '#86b074', industrial: '#a39c8e', park: '#5fa050', farm: '#b0bc6c' };
  for (const b of world.blocks) { c.fillStyle = ZC[b.zone]; c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); }
  c.fillStyle = '#9a9ea6'; c.fillRect(AIRPORT[0], AIRPORT[1], AIRPORT[2] - AIRPORT[0], AIRPORT[3] - AIRPORT[1]);
  c.fillStyle = '#34373e'; c.fillRect(RUNWAY.x - RUNWAY.w / 2, RUNWAY.z0, RUNWAY.w, RUNWAY.z1 - RUNWAY.z0);
  c.fillStyle = '#8a8f78'; c.fillRect(BASE[0], BASE[1], BASE[2] - BASE[0], BASE[3] - BASE[1]);
  c.fillStyle = '#50545c';
  for (const e of world.edges) e.horiz ? c.fillRect(e.a.x, e.a.z - 7, e.b.x - e.a.x, 14) : c.fillRect(e.a.x - 7, e.a.z, 14, e.b.z - e.a.z);
  for (const n of world.roadNodes) c.fillRect(n.x - 7, n.z - 7, 14, 14);
  c.fillStyle = 'rgba(60,56,52,.75)';
  for (const b of world.buildings) c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  const p = world.places.pier; c.fillStyle = '#8a6a48'; c.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0);
  return cv;
}
