// 落日湾：静态场景——地形、海面、天空、道路、街区、建筑、树木、路灯。全部由 world.js 的数据现场生成。
// 为了性能，建筑和树按 320 米见方的地块合并成少量网格；镜头外和太远的地块不绘制。
import * as THREE from '../../../shared/js/three.js';
import { Builder, MAT, canvasTexture, makeCanvas } from '../../../shared/js/geo.js';
import { makeRng, fbm2 } from '../../../shared/js/util.js';
import { SIZE, PITCH, ROAD, CITY_Y, CURB, AIRPORT, BASE, RUNWAY, terrainY } from '../world.js';

const CHUNK = 320;
export const FOG_COLOR = 0xf3c7a2;       // 傍晚的暖色雾，和天空地平线同色
const ZONE_COLOR = { downtown: '#b0b3b8', commercial: '#bdb7aa', residential: '#86b074', industrial: '#a39c8e', park: '#5fa050', farm: '#b0bc6c' };   // 小地图上各街区的底色（paintMap 和 mapBuildingColor 共用）

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

/** 被炸平的建筑：只剩一层低矮的深色废墟平板和几块碎块（ch.b 是所在 320 米地块的 Builder） */
function rubble(ch, bd, cx, cz) {
  const w = bd.x1 - bd.x0, d = bd.z1 - bd.z0;
  ch.b.box(w, 0.9, d, 0x4a4642, cx, bd.y0 + 0.45, cz);
  ch.b.box(w * 0.3, 1.4, d * 0.3, 0x5a5348, cx - w * 0.2, bd.y0 + 0.7, cz + d * 0.15, 0, 0.4, 0);
  ch.b.box(w * 0.25, 1.0, d * 0.25, 0x3a3632, cx + w * 0.25, bd.y0 + 0.5, cz - d * 0.2, 0, -0.3, 0);
}

/**
 * 世界地标：每栋按名字拼出能一眼认出来的轮廓（方块、圆柱、棱锥组合，不用图片/模型文件）。
 * y0 是地面高度，bd.h 是楼体高度（天线不算在 h 里：西尔斯大厦 h 130，天线画到 145）。
 */
function landmark(ch, bd, cx, cz) {
  const b = ch.b, y0 = bd.y0;
  switch (bd.name) {
    case '埃菲尔铁塔': {
      const iron = [0x3a2e22, 0x5a4632];
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])   // 四条腿向内收，顶端收进一层平台下面
        b.box(3, 54, 3, iron, cx + sx * 12, y0 + 27, cz + sz * 12, -sz * 0.14, 0, sx * 0.14);
      b.box(24, 16, 24, iron, cx, y0 + 60, cz);       // 一层平台 52~68
      b.box(16, 16, 16, iron, cx, y0 + 76, cz);       // 二层 68~84
      b.box(10, 14, 10, iron, cx, y0 + 91, cz);       // 三层 84~98
      b.cone(4, 22, 0x3a2e22, cx, y0 + 109, cz);       // 尖顶 98~120
      break;
    }
    case '帝国大厦': {
      const stone = [0xb59f78, 0xd8c9a3];
      b.box(28, 30, 28, stone, cx, y0 + 15, cz);      // 底座 0~30
      b.box(22, 24, 22, stone, cx, y0 + 42, cz);      // 30~54
      b.box(16, 20, 16, stone, cx, y0 + 64, cz);      // 54~74
      b.box(10, 13, 10, stone, cx, y0 + 80.5, cz);    // 74~87
      b.cyl(1.5, 1.5, 8, 0x8a8f98, cx, y0 + 91, cz);   // 尖顶 87~95
      break;
    }
    case '哈利法塔': {
      const glass = [0x7e9ab5, 0xb8cce0];
      b.box(30, 40, 30, glass, cx, y0 + 20, cz);      // 多级收窄的针形塔
      b.box(24, 30, 24, glass, cx, y0 + 55, cz);      // 40~70
      b.box(18, 25, 18, glass, cx, y0 + 82.5, cz);    // 70~95
      b.box(13, 20, 13, glass, cx, y0 + 105, cz);     // 95~115
      b.box(9, 15, 9, glass, cx, y0 + 122.5, cz);     // 115~130
      b.box(5, 12, 5, glass, cx, y0 + 136, cz);       // 130~142
      b.cyl(1, 1, 8, 0x8a8f98, cx, y0 + 146, cz);      // 针尖 142~150
      break;
    }
    case '悉尼歌剧院': {
      b.box(44, 6, 26, [0x8a7a5c, 0xb09a72], cx, y0 + 3, cz);   // 低矮宽阔的基座
      for (const dx of [-13, 0, 13]) b.sphere(8.5, 0xf0ede4, cx + dx, y0 + 5, cz, 1, 1.5, 1, 10);   // 三片白色贝壳，顶约 18 米
      for (const dx of [-6.5, 6.5]) b.sphere(5, 0xf0ede4, cx + dx, y0 + 4, cz - 8, 1, 1.4, 1, 8);    // 后排两片小贝壳
      break;
    }
    case '比萨斜塔': {
      const marble = [0xd8cdb2, 0xefe8d2];
      // 塔身倾斜约 6 度（rz 0.1 时顶端向 -x 偏约 2.6 米），环形挑檐跟着同一方向错开
      b.cyl(5, 5.4, 26, marble, cx, y0 + 13, cz, 0, 0, 0.1, 12);
      for (const [dy, off] of [[7, -0.7], [14, -1.4], [21, -2.1]]) b.cyl(6, 6, 1.2, 0xc8bda0, cx + off, y0 + dy, cz, 0, 0, 0.1, 12);
      b.cyl(5.5, 5.5, 3, marble, cx - 2.6, y0 + 27.5, cz, 0, 0, 0.1, 12);
      break;
    }
    case '大本钟': {
      const stone = [0x9a8a6c, 0xc0b090];
      b.box(12, 45, 12, stone, cx, y0 + 22.5, cz);    // 方形钟楼
      for (const [dx, dz] of [[0, 6.1], [0, -6.1], [6.1, 0], [-6.1, 0]])   // 四面钟面
        b.box(dx === 0 ? 8 : 0.4, 8, dz === 0 ? 8 : 0.4, 0xf0ead8, cx + dx, y0 + 38, cz + dz);
      b.cone(8.5, 10, 0x2e5a44, cx, y0 + 50, cz, 0, Math.PI / 4, 0, 4);   // 四棱锥尖顶 45~55
      break;
    }
    case '西尔斯大厦（威利斯大厦）': {
      const glass = [0x22262e, 0x3d4a5e];
      const H = [[95, 110, 95], [110, 130, 110], [95, 110, 95]];   // 九个方形筒体捆在一起，中间最高
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
        const h = H[a][c];
        b.box(10.5, h, 10.5, glass, cx + (a - 1) * 11, y0 + h / 2, cz + (c - 1) * 11);
      }
      b.cyl(0.35, 0.35, 15, 0x8a8f98, cx - 3, y0 + 137.5, cz, 0, 0, 0, 6);   // 两根天线 130~145
      b.cyl(0.35, 0.35, 15, 0x8a8f98, cx + 3, y0 + 137.5, cz, 0, 0, 0, 6);
      break;
    }
    case '特朗普大厦': {
      const glass = [0x5f7a92, 0x9db4c8];
      b.box(26, 45, 26, glass, cx, y0 + 22.5, cz);    // 三段阶梯收窄
      b.box(26, 1, 26, 0xb8c8d8, cx, y0 + 45, cz);     // 收窄处的浅色腰线
      b.box(20, 28, 20, glass, cx, y0 + 59, cz);      // 45~73
      b.box(20, 1, 20, 0xb8c8d8, cx, y0 + 73, cz);
      b.box(14, 25, 14, glass, cx, y0 + 85.5, cz);    // 73~98
      break;
    }
    default: break;
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
  // 机场停机坪、跑道、军营地面：单独成网，用 polygonOffset 按层拉开深度。
  // 原来它们是和建筑一起合进地块网格的薄盒子，顶面和道路完全共面（都是 y=2.03，
  // 跑道只比停机坪高 0.03 米、虚线只比跑道高 0.02 米），深度缓冲打成平手，
  // 镜头稍一动每像素的胜负就翻转，机场西缘那条 7 米宽的重叠带在“路 / 停机坪”之间闪烁。
  // polygonOffset 在深度值上把各层拉开至少一个深度单位（远处、掠射角都有效），
  // 高度、颜色、位置一个都不动，所以地面高度、碰撞、跑道降落、停机坪都不受影响。
  // 层级（数字越小越靠前）：道路/地形 0，停机坪和军营地面 -1，跑道 -2，跑道虚线 -3；
  // 上层必须比下层更靠前，否则会被下层盖住（比如只给跑道加偏移会把虚线盖掉）。
  const slabMat = (off) => { const m = MAT.vcFlat.clone(); m.polygonOffset = true; m.polygonOffsetFactor = off; m.polygonOffsetUnits = off; return m; };
  const slabMesh = (b, off) => { const m = b.mesh(slabMat(off), true); m.matrixAutoUpdate = false; group.add(m); disposables.push(m.geometry, m.material); };
  const groundB = new Builder(), runwayB = new Builder(), dashB = new Builder();
  groundB.box(AIRPORT[2] - AIRPORT[0], 0.1, AIRPORT[3] - AIRPORT[1], 0x9a9ea6, (AIRPORT[0] + AIRPORT[2]) / 2, CITY_Y - 0.02, (AIRPORT[1] + AIRPORT[3]) / 2);
  groundB.box(BASE[2] - BASE[0], 0.1, BASE[3] - BASE[1], 0x8a8f78, (BASE[0] + BASE[2]) / 2, CITY_Y - 0.02, (BASE[1] + BASE[3]) / 2);
  runwayB.box(RUNWAY.w, 0.1, RUNWAY.z1 - RUNWAY.z0, 0x3a3d44, RUNWAY.x, CITY_Y + 0.01, (RUNWAY.z0 + RUNWAY.z1) / 2);
  for (let z = RUNWAY.z0 + 20; z < RUNWAY.z1 - 20; z += 24) dashB.box(0.8, 0.1, 10, 0xf0f0f0, RUNWAY.x, CITY_Y + 0.03, z);
  for (const z of [RUNWAY.z0 + 6, RUNWAY.z1 - 6]) for (let k = -4; k <= 4; k++) dashB.box(1.6, 0.1, 8, 0xf0f0f0, RUNWAY.x + k * 3, CITY_Y + 0.03, z);
  slabMesh(groundB, -1); slabMesh(runwayB, -2); slabMesh(dashB, -3);
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
    if (bd.destroyed) { rubble(ch, bd, cx, cz); continue; }   // 被炸平了：只剩一层低矮的废墟
    if (bd.kind === 'landmark') { landmark(ch, bd, cx, cz); continue; }
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
  const ZC = ZONE_COLOR;
  for (const b of world.blocks) { c.fillStyle = ZC[b.zone]; c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); }
  c.fillStyle = '#9a9ea6'; c.fillRect(AIRPORT[0], AIRPORT[1], AIRPORT[2] - AIRPORT[0], AIRPORT[3] - AIRPORT[1]);
  c.fillStyle = '#34373e'; c.fillRect(RUNWAY.x - RUNWAY.w / 2, RUNWAY.z0, RUNWAY.w, RUNWAY.z1 - RUNWAY.z0);
  c.fillStyle = '#8a8f78'; c.fillRect(BASE[0], BASE[1], BASE[2] - BASE[0], BASE[3] - BASE[1]);
  c.fillStyle = '#50545c';
  for (const e of world.edges) e.horiz ? c.fillRect(e.a.x, e.a.z - 7, e.b.x - e.a.x, 14) : c.fillRect(e.a.x - 7, e.a.z, 14, e.b.z - e.a.z);
  for (const n of world.roadNodes) c.fillRect(n.x - 7, n.z - 7, 14, 14);
  for (const b of world.buildings) {
    if (b.destroyed) c.fillStyle = '#3a3632';            // 炸平了：小地图上也不再是楼，只剩废墟色
    else if (b.kind === 'landmark') c.fillStyle = '#d8a020';   // 地标单独用金色标出来
    else c.fillStyle = 'rgba(60,56,52,.75)';
    c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }
  const p = world.places.pier; c.fillStyle = '#8a6a48'; c.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0);
  return cv;
}

/**
 * 小地图上某栋楼本来的颜色：paintMap 里那层 rgba(60,56,52,.75) 盖在街区底色上的混合结果，算成不透明色返回。
 * 重建时直接把废墟色盖回去用——不能拿半透明色往废墟色上盖，盖完还是废墟色。
 * 地标直接是金色 #d8a020。楼不在任何街区里时按 downtown 底色算。
 */
export function mapBuildingColor(world, b) {
  if (b.kind === 'landmark') return '#d8a020';
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const blk = world.blocks.find((k) => cx >= k.x0 && cx < k.x1 && cz >= k.z0 && cz < k.z1);
  const zc = ZONE_COLOR[blk ? blk.zone : 'downtown'];
  const zr = parseInt(zc.slice(1, 3), 16), zg = parseInt(zc.slice(3, 5), 16), zb = parseInt(zc.slice(5, 7), 16);
  return `rgb(${Math.round(60 * 0.75 + zr * 0.25)},${Math.round(56 * 0.75 + zg * 0.25)},${Math.round(52 * 0.75 + zb * 0.25)})`;
}
