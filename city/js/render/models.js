// 落日湾：模型——各种载具和人物的部件。全部用基本形体拼成，没有模型文件。
// 约定：车头朝 +z，底部在 y=0。每辆车是一个合并后的网格，外加少数会动的小部件（螺旋桨、警灯、乘员）。
import * as THREE from '../../../shared/js/three.js';
import { Builder, MAT } from '../../../shared/js/geo.js';
import { VEH } from '../config.js';

const GLASS = [0x1f2c3c, 0x58789a], TYRE = 0x18181c;
const darker = (hex, k = 0.62) => new THREE.Color(hex).multiplyScalar(k).getHex();

/** 残骸用的材质：把顶点颜色整体压暗成焦黑 */
export const MAT_WRECK = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x2b2826 });

/** 四个车轮 */
function wheels(b, W, L, r = 0.36, t = 0.28) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(r, r, t, TYRE, sx * (W / 2 - t * 0.3), r, sz * L * 0.31, 0, 0, Math.PI / 2, 10);
}

/** 普通轿车的车身。o 可以调整车舱比例 */
function carBody(b, s, color, o = {}) {
  const L = s.len, W = s.wid, H = s.hgt, cab = o.cab ?? 0.5, cz = o.cabZ ?? -0.04;
  b.box(W, H * 0.4, L, [darker(color), color], 0, H * 0.42, 0);                       // 车身
  b.box(W * 0.96, H * 0.1, L * 0.98, darker(color, 0.4), 0, H * 0.2, 0);              // 底边
  b.box(W * 0.84, H * 0.34, L * cab, GLASS, 0, H * 0.78, L * cz);                     // 车窗
  b.box(W * 0.86, H * 0.06, L * (cab - 0.04), color, 0, H * 0.97, L * cz);            // 车顶
  wheels(b, W, L);
  for (const sx of [-1, 1]) { b.box(0.42, 0.16, 0.08, 0xfff4c0, sx * W * 0.32, H * 0.46, L / 2); b.box(0.42, 0.14, 0.08, 0xd22a2a, sx * W * 0.32, H * 0.48, -L / 2); }
  b.box(W * 0.5, 0.14, 0.1, 0x22262c, 0, H * 0.34, L / 2 + 0.02);                     // 进气格栅
}

/** 坐着的乘员（摩托、快艇这类没有车顶的载具上能看见） */
function rider(b, y, z, shirt = 0xe8793a) {
  b.box(0.46, 0.6, 0.3, shirt, 0, y + 0.5, z, 0.25).sphere(0.17, 0xf0c8a0, 0, y + 1.02, z + 0.12, 1, 1, 1, 6).sphere(0.19, 0x2a2a30, 0, y + 1.08, z + 0.08, 1, 0.8, 1, 6)
    .box(0.13, 0.13, 0.55, shirt, -0.3, y + 0.62, z + 0.3).box(0.13, 0.13, 0.55, shirt, 0.3, y + 0.62, z + 0.3)
    .box(0.17, 0.2, 0.55, 0x2e3a52, -0.16, y + 0.18, z + 0.2).box(0.17, 0.2, 0.55, 0x2e3a52, 0.16, y + 0.18, z + 0.2);
}

/**
 * 生成一辆车的模型。返回 { group, body, prop?, light?, rider? }：
 * prop 螺旋桨（飞机），light 警灯（警车），rider 乘员（摩托、船，只在有人开时显示）。
 */
export function buildVehicle(type, color) {
  const s = VEH[type], b = new Builder(), group = new THREE.Group(), out = { group };
  const L = s.len, W = s.wid, H = s.hgt;
  let extra = null;
  switch (type) {
    case 'sedan': carBody(b, s, color); break;
    case 'target': carBody(b, s, color); b.box(W * 0.2, 0.05, L * 0.9, 0xffffff, 0, H + 0.02, 0).box(W * 0.9, 0.05, L * 0.12, 0xffffff, 0, H + 0.02, 0); break;
    case 'taxi': carBody(b, s, color); b.box(0.7, 0.24, 0.3, [0x222222, 0xfff2a0], 0, H + 0.12, 0).box(W + 0.02, 0.12, L * 0.5, 0x202020, 0, H * 0.52, 0); break;
    case 'police':
      carBody(b, s, color); b.box(W + 0.02, H * 0.3, L * 0.44, 0x1c2f66, 0, H * 0.44, -0.1).box(W * 0.7, 0.1, 0.34, 0x30343c, 0, H + 0.06, -0.1);
      extra = new Builder().box(0.42, 0.2, 0.3, 0xff3030, -0.32, H + 0.2, -0.1).box(0.42, 0.2, 0.3, 0x3060ff, 0.32, H + 0.2, -0.1); break;
    case 'sports':
      b.box(W, H * 0.34, L, [darker(color), color], 0, H * 0.4, 0).box(W * 0.96, 0.1, L * 0.99, darker(color, 0.4), 0, H * 0.2, 0)
        .box(W * 0.8, H * 0.3, L * 0.36, GLASS, 0, H * 0.72, -L * 0.08).box(W * 0.82, 0.06, L * 0.3, color, 0, H * 0.9, -L * 0.1)
        .box(W * 0.92, 0.08, 0.5, darker(color, 0.45), 0, H * 0.82, -L * 0.46).box(0.1, 0.3, 0.3, darker(color, 0.45), -W * 0.36, H * 0.68, -L * 0.46).box(0.1, 0.3, 0.3, darker(color, 0.45), W * 0.36, H * 0.68, -L * 0.46)
        .box(W * 0.7, 0.03, L * 0.3, 0xffffff, 0, H * 0.58, L * 0.3);
      wheels(b, W, L, 0.38, 0.32);
      for (const sx of [-1, 1]) { b.box(0.5, 0.1, 0.08, 0xfff4c0, sx * W * 0.3, H * 0.44, L / 2); b.box(0.6, 0.08, 0.08, 0xd22a2a, sx * W * 0.28, H * 0.5, -L / 2); }
      break;
    case 'pickup':
      b.box(W, H * 0.34, L, [darker(color), color], 0, H * 0.36, 0).box(W * 0.9, H * 0.36, L * 0.3, GLASS, 0, H * 0.72, L * 0.12).box(W * 0.92, 0.07, L * 0.28, color, 0, H * 0.92, L * 0.12)
        .box(0.12, H * 0.22, L * 0.4, color, -W / 2 + 0.06, H * 0.62, -L * 0.28).box(0.12, H * 0.22, L * 0.4, color, W / 2 - 0.06, H * 0.62, -L * 0.28).box(W, H * 0.22, 0.12, color, 0, H * 0.62, -L / 2 + 0.06)
        .box(W * 0.8, 0.4, 0.9, 0x8a6a48, 0, H * 0.66, -L * 0.25);
      wheels(b, W, L, 0.44, 0.32);
      for (const sx of [-1, 1]) { b.box(0.44, 0.2, 0.08, 0xfff4c0, sx * W * 0.32, H * 0.42, L / 2); b.box(0.3, 0.2, 0.08, 0xd22a2a, sx * W * 0.38, H * 0.42, -L / 2); }
      break;
    case 'bike':
      b.box(0.24, 0.42, 1.3, [darker(color), color], 0, 0.62, 0).box(0.3, 0.14, 0.6, 0x202024, 0, 0.9, -0.25).box(0.2, 0.3, 0.5, color, 0, 0.92, 0.3)
        .cyl(0.34, 0.34, 0.14, TYRE, 0, 0.34, 0.78, 0, 0, Math.PI / 2, 10).cyl(0.34, 0.34, 0.16, TYRE, 0, 0.34, -0.78, 0, 0, Math.PI / 2, 10)
        .box(0.7, 0.06, 0.06, 0xb0b4bc, 0, 1.14, 0.56).cyl(0.04, 0.04, 0.7, 0xb0b4bc, 0, 0.82, 0.68, -0.4, 0, 0, 5).box(0.14, 0.12, 0.06, 0xfff4c0, 0, 1.0, 0.86);
      extra = new Builder(); rider(extra, 0.72, -0.2); break;
    case 'boat':
      b.box(W, 0.8, L * 0.72, [0x2a6fb5, 0xf2f4f6], 0, 0.35, -L * 0.14).cone(W * 0.72, L * 0.34, [0xf2f4f6, 0x2a6fb5], 0, 0.35, L * 0.39, Math.PI / 2, Math.PI / 4, 0, 4)
        .box(W * 0.86, 0.1, L * 0.7, 0xd9c9a8, 0, 0.78, -L * 0.14).box(W * 0.7, 0.55, 0.1, GLASS, 0, 1.1, L * 0.12, -0.3)
        .box(0.5, 0.9, 0.5, 0x2a2e36, 0, 0.6, -L / 2 + 0.1).box(W * 0.8, 0.3, 0.6, 0xc0392b, 0, 0.95, -L * 0.34);
      extra = new Builder(); rider(extra, 0.72, -0.1, 0x3a7bd5); break;
    case 'plane':
      b.cyl(0.85, 0.85, L * 0.6, [0xc9d3df, color], 0, 1.7, 0.3, Math.PI / 2, 0, 0, 10).cone(0.85, 1.4, [color, 0xd0362e], 0, 1.7, L * 0.3 + 1.0, Math.PI / 2, 0, 0, 10)
        .cyl(0.25, 0.85, L * 0.42, [0xc9d3df, color], 0, 1.75, -L * 0.3 - 0.4, -Math.PI / 2, 0, 0, 10)
        .box(W, 0.16, 1.7, [0xd0362e, color], 0, 2.2, 0.6).box(3.6, 0.12, 0.95, color, 0, 1.95, -L * 0.52).box(0.14, 1.5, 1.15, [color, 0xd0362e], 0, 2.6, -L * 0.52)
        .box(1.0, 0.5, 1.5, GLASS, 0, 2.45, 0.9)
        .cyl(0.06, 0.06, 1.1, 0x50545c, -1.1, 0.75, 0.7, 0, 0, 0, 5).cyl(0.06, 0.06, 1.1, 0x50545c, 1.1, 0.75, 0.7, 0, 0, 0, 5)
        .cyl(0.3, 0.3, 0.2, TYRE, -1.1, 0.3, 0.7, 0, 0, Math.PI / 2, 8).cyl(0.3, 0.3, 0.2, TYRE, 1.1, 0.3, 0.7, 0, 0, Math.PI / 2, 8).cyl(0.2, 0.2, 0.16, TYRE, 0, 0.2, -L * 0.45, 0, 0, Math.PI / 2, 8);
      out.prop = new Builder().box(2.8, 0.26, 0.08, 0x2a2e36).box(0.26, 2.8, 0.08, 0x2a2e36).sphere(0.22, 0xd0362e, 0, 0, 0.1).mesh(MAT.vcFlat, true);
      out.prop.position.set(0, 1.7, L * 0.3 + 1.75); group.add(out.prop);
      break;
    case 'tank':
      b.box(W * 0.8, 1.0, L * 0.92, [darker(color), color], 0, 1.15, 0)
        .box(0.75, 1.0, L, [0x202226, 0x3a3e44], -W / 2 + 0.38, 0.55, 0).box(0.75, 1.0, L, [0x202226, 0x3a3e44], W / 2 - 0.38, 0.55, 0)
        .box(W * 0.62, 0.75, 2.9, [darker(color, 0.8), color], 0, 2.0, -0.2).cyl(0.17, 0.2, 4.4, darker(color, 0.7), 0, 2.05, 3.1, Math.PI / 2, 0, 0, 8)
        .cyl(0.28, 0.28, 0.5, darker(color, 0.5), 0, 2.05, 5.2, Math.PI / 2, 0, 0, 8).cyl(0.45, 0.45, 0.16, darker(color, 0.6), 0.5, 2.45, -0.5, 0, 0, 0, 8)
        .box(W * 0.84, 0.12, L * 0.3, darker(color, 0.75), 0, 1.72, L * 0.3);
      for (let k = -2; k <= 2; k++) for (const sx of [-1, 1]) b.cyl(0.42, 0.42, 0.8, 0x2c3036, sx * (W / 2 - 0.38), 0.45, k * 1.4, 0, 0, Math.PI / 2, 8);
      break;
  }
  out.body = b.mesh(MAT.vcFlat, true);
  group.add(out.body);
  if (extra) {
    const m = extra.mesh(type === 'police' ? MAT.vcBasic : MAT.vcFlat, true);
    group.add(m);
    if (type === 'police') out.light = m; else { out.rider = m; m.visible = false; }
  }
  return out;
}

/* ------------------------------------------------------------------ 人物 */

/** 人物各部件相对脚底的支点位置 */
export const PIVOT = { torso: [0, 0, 0], head: [0, 1.62, 0], hair: [0, 1.62, 0], armL: [0.33, 1.42, 0], armR: [-0.33, 1.42, 0], legL: [0.12, 0.84, 0], legR: [-0.12, 0.84, 0] };

/**
 * 人物部件的几何体（白色，靠实例颜色染成衬衫、裤子、头发的颜色）。
 * torso 躯干、head 头、hair 头发/帽子、arm 手臂（从肩向下）、leg 腿（从胯向下）。
 */
export function personParts() {
  const W = 0xffffff, mk = (b) => b.build(true);
  return {
    torso: mk(new Builder().box(0.52, 0.64, 0.3, W, 0, 1.14, 0).box(0.46, 0.14, 0.28, 0xd0d0d0, 0, 0.86, 0)),
    head: mk(new Builder().sphere(0.165, W, 0, 0, 0.01, 1, 1.08, 1, 7).box(0.1, 0.08, 0.06, 0xd8d8d8, 0, -0.2, 0)),
    hair: mk(new Builder().sphere(0.18, W, 0, 0.04, -0.03, 1, 0.9, 1.02, 7)),
    arm: mk(new Builder().box(0.15, 0.62, 0.15, W, 0, -0.3, 0).box(0.13, 0.12, 0.13, 0xf0e0d0, 0, -0.66, 0)),
    leg: mk(new Builder().box(0.2, 0.74, 0.22, W, 0, -0.37, 0).box(0.2, 0.12, 0.3, 0x505050, 0, -0.78, 0.04)),
    // 枪口沿手臂方向（手臂垂下时朝下，举臂瞄准时朝前）
    gun: mk(new Builder().box(0.07, 0.38, 0.1, 0x2a2e36, 0, -0.88, 0.03).box(0.07, 0.1, 0.18, 0x2a2e36, 0, -0.7, -0.06)),
  };
}

/** 行人的配色：[衬衫, 裤子, 头发] */
export const LOOKS = [
  [0xd94b3d, 0x2e3a52, 0x2a2018], [0x3b78d8, 0x4a4a52, 0x3a2a1c], [0xe8e2d0, 0x5a4636, 0x161616], [0x3fae6a, 0x2a2e3a, 0x6a4a2a],
  [0xe0a030, 0x33405a, 0x1a1410], [0x8a5cc8, 0x3a3a40, 0xc8b070], [0xd87aa8, 0x2a3348, 0x241a14], [0x6c7a8a, 0x26303c, 0x8a8a8a],
];
export const SKIN = [0xf2cba4, 0xe0ac7e, 0xc68a5c, 0x8d5a3c];
