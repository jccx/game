// 裂谷争锋：所有模型——英雄、小兵、防御塔、水晶、野怪。全部用基本形体现场拼出来，没有模型文件。
// 约定：模型面朝 +z（单位朝向 face=0 时的方向），脚底在 y=0；面朝 +z 时右手在 -x 一侧。
// 英雄由几块会动的部件组成（身体、头、双臂、双腿）；小兵、野怪、建筑是整块的静态网格。
import * as THREE from '../../../shared/js/three.js';
import { Builder, MAT } from '../../../shared/js/geo.js';
import { TEAM_COLOR } from './scene.js';

const SKIN = 0xf3cba4;
const mesh = (b) => b.mesh(MAT.vcFlat, true);

/** 手臂：以肩为原点向下。sleeve 袖子颜色，hand 手/护手颜色 */
function arm(b, sleeve, hand, w = 0.2, len = 0.86) {
  b.cyl(w, w * 0.92, len * 0.56, sleeve, 0, -len * 0.28, 0, 0, 0, 0, 6);
  b.cyl(w * 0.85, w * 0.78, len * 0.42, hand, 0, -len * 0.74, 0, 0, 0, 0, 6);
  b.sphere(w * 0.98, hand, 0, -len, 0, 1, 1, 1, 6);
  return b;
}
/** 腿：以胯为原点向下 */
function leg(b, pants, boot, w = 0.25, len = 0.98) {
  b.cyl(w, w * 0.86, len * 0.6, pants, 0, -len * 0.3, 0, 0, 0, 0, 6);
  b.cyl(w * 0.92, w, len * 0.4, boot, 0, -len * 0.8, 0, 0, 0, 0, 6);
  b.box(w * 1.9, 0.17, w * 2.7, boot, 0, -len + 0.085, w * 0.55);
  return b;
}

/**
 * 把各部件装配成一个可动的人形。parts：{ torso, head, armL, armR, legL, legR }（都是 Builder）。
 * 返回 { group, pivot, head, armL, armR, legL, legR }，动画代码直接转动这些部件。
 */
function assemble(parts, o = {}) {
  const group = new THREE.Group(), pivot = new THREE.Group();
  group.add(pivot);
  const sw = o.shoulder ?? 0.58, sh = o.shoulderY ?? 1.74, hw = o.hip ?? 0.25;
  const torso = mesh(parts.torso); pivot.add(torso);
  const head = mesh(parts.head); head.position.set(0, o.headY ?? 2.14, 0); pivot.add(head);
  const armR = mesh(parts.armR); armR.position.set(-sw, sh, 0); pivot.add(armR);
  const armL = mesh(parts.armL); armL.position.set(sw, sh, 0); pivot.add(armL);
  const legR = mesh(parts.legR); legR.position.set(-hw, 0.98, 0); pivot.add(legR);
  const legL = mesh(parts.legL); legL.position.set(hw, 0.98, 0); pivot.add(legL);
  group.scale.setScalar(o.scale ?? 1.25);
  return { group, pivot, torso, head, armL, armR, legL, legR, style: o.style || 'melee', float: o.float || 0 };
}

/* ------------------------------------------------------------------ 五个英雄 */

function panyue() {   // 坦克：厚重铠甲、大盾、战锤
  const st = [0x66728a, 0xaab6cc], gold = 0xf2c14e, dark = 0x3e4658;
  const torso = new Builder()
    .box(1.2, 0.95, 0.74, st, 0, 1.5, 0).box(0.98, 0.36, 0.64, dark, 0, 0.96, 0).box(1.04, 0.15, 0.78, gold, 0, 1.13, 0)
    .box(0.46, 0.46, 0.08, gold, 0, 1.6, 0.39)
    .sphere(0.46, [0x7a88a2, 0xcdd6e6], -0.76, 1.93, 0, 1, 0.78, 1).sphere(0.46, [0x7a88a2, 0xcdd6e6], 0.76, 1.93, 0, 1, 0.78, 1)
    .cone(0.13, 0.34, gold, -0.76, 2.3, 0).cone(0.13, 0.34, gold, 0.76, 2.3, 0)
    .box(0.9, 0.9, 0.1, 0x8a2f2f, 0, 1.35, -0.42);                                  // 短披风
  const head = new Builder()
    .sphere(0.33, SKIN, 0, 0, 0.03).sphere(0.39, [0x66728a, 0xb9c4d8], 0, 0.1, -0.06, 1, 0.85, 1)
    .box(0.12, 0.3, 0.56, gold, 0, 0.46, -0.06).box(0.46, 0.09, 0.08, 0x1a2030, 0, 0.03, 0.33);
  const armR = arm(new Builder(), st, dark, 0.24)
    .cyl(0.07, 0.07, 1.7, 0x6b4a30, 0, -0.9, 0.55, Math.PI / 2, 0, 0, 6)             // 锤柄（朝前伸）
    .box(0.62, 0.62, 0.8, [0x8a94a8, 0xdfe5f0], 0, -0.9, 1.4).box(0.7, 0.2, 0.2, gold, 0, -0.9, 1.4);
  const armL = arm(new Builder(), st, dark, 0.24)
    .cyl(0.78, 0.78, 0.14, [0x56617a, 0x9eabc4], 0.12, -0.6, 0.38, Math.PI / 2, 0, 0, 10)   // 圆盾
    .cyl(0.3, 0.3, 0.2, gold, 0.12, -0.6, 0.43, Math.PI / 2, 0, 0, 8);
  return assemble({ torso, head, armL, armR, legL: leg(new Builder(), dark, st, 0.28), legR: leg(new Builder(), dark, st, 0.28) }, { scale: 1.36, shoulder: 0.68 });
}

function liefeng() {  // 战士：红甲、巨剑、火红的头发
  const red = [0xa8281f, 0xe8584a], gold = 0xffc857, dark = 0x3a2a2a;
  const torso = new Builder()
    .box(0.98, 0.9, 0.6, red, 0, 1.5, 0).box(0.84, 0.34, 0.54, dark, 0, 0.97, 0).box(0.9, 0.13, 0.62, gold, 0, 1.12, 0)
    .box(0.36, 0.2, 0.34, [0xb8322a, 0xf06a58], -0.6, 1.9, 0).box(0.36, 0.2, 0.34, [0xb8322a, 0xf06a58], 0.6, 1.9, 0)
    .box(0.5, 1.0, 0.08, 0xd9483b, 0, 1.2, -0.36, 0.25, 0, 0)                          // 围巾下摆
    .box(0.7, 0.16, 0.5, 0xd9483b, 0, 1.98, -0.02);
  const head = new Builder().sphere(0.33, SKIN, 0, 0, 0.02).sphere(0.36, 0x7a1d14, 0, 0.1, -0.08, 1, 0.9, 1).box(0.7, 0.08, 0.7, 0xffffff, 0, 0.12, 0);
  for (let i = 0; i < 5; i++) head.cone(0.13, 0.42, [0x8a1f14, 0xff6a3a], (i - 2) * 0.13, 0.42, -0.1 + Math.abs(i - 2) * -0.05, -0.45, 0, (i - 2) * -0.22, 5);
  const armR = arm(new Builder(), red, SKIN, 0.21)
    .box(0.09, 0.16, 0.5, 0x4a3524, 0, -0.9, 0.2).box(0.52, 0.12, 0.14, gold, 0, -0.9, 0.48)       // 剑柄、护手
    .box(0.3, 0.07, 2.3, [0xbfc8d6, 0xf4f7fc], 0, -0.9, 1.68).box(0.1, 0.09, 2.2, 0xff8a5a, 0, -0.9, 1.62);   // 剑身和血槽
  const armL = arm(new Builder(), red, SKIN, 0.21).cyl(0.26, 0.24, 0.3, gold, 0, -0.62, 0, 0, 0, 0, 6);
  return assemble({ torso, head, armL, armR, legL: leg(new Builder(), dark, 0x8a241c), legR: leg(new Builder(), dark, 0x8a241c) }, { scale: 1.3 });
}

function yesun() {    // 刺客：深紫兜帽、双匕首、长围巾
  const pur = [0x3d2a6e, 0x7a58c8], cyan = 0x9be8ff, dark = 0x221a36;
  const torso = new Builder()
    .box(0.8, 0.86, 0.5, pur, 0, 1.48, 0).box(0.7, 0.34, 0.46, dark, 0, 0.97, 0).box(0.76, 0.1, 0.52, cyan, 0, 1.1, 0)
    .box(0.3, 1.5, 0.07, [0x5a2bd6, 0xb48bff], 0.12, 1.25, -0.42, 0.5, 0, 0.1)        // 飘在身后的围巾
    .box(0.86, 0.2, 0.56, [0x5a2bd6, 0xb48bff], 0, 1.94, 0);
  const head = new Builder().sphere(0.31, SKIN, 0, 0, 0.03).sphere(0.4, pur, 0, 0.09, -0.07, 1, 0.95, 1.05)
    .cone(0.3, 0.42, pur, 0, 0.42, -0.2, -0.7, 0, 0, 6).box(0.44, 0.14, 0.08, dark, 0, -0.1, 0.3).box(0.34, 0.06, 0.06, cyan, 0, 0.06, 0.33);
  const dagger = (b) => b.box(0.07, 0.07, 0.22, dark, 0, -0.88, 0.12).box(0.24, 0.06, 0.07, cyan, 0, -0.88, 0.24).box(0.13, 0.05, 0.9, [0xc8f4ff, 0xffffff], 0, -0.88, 0.72);
  const armR = dagger(arm(new Builder(), pur, dark, 0.17)), armL = dagger(arm(new Builder(), pur, dark, 0.17));
  return assemble({ torso, head, armL, armR, legL: leg(new Builder(), dark, 0x3d2a6e, 0.2), legR: leg(new Builder(), dark, 0x3d2a6e, 0.2) }, { scale: 1.22, shoulder: 0.5, hip: 0.2 });
}

function xinglan() {  // 法师：蓝白长袍、尖帽、星杖，微微浮空
  const blue = [0x2f5fc4, 0x7fb4ff], white = 0xf4f8ff, gold = 0xffe08a;
  const torso = new Builder()
    .cyl(0.42, 0.86, 1.2, [0x2a4fa8, 0x6aa0f4], 0, 0.62, 0, 0, 0, 0, 8)               // 袍子下摆
    .cyl(0.88, 0.9, 0.1, gold, 0, 0.06, 0, 0, 0, 0, 8)
    .box(0.78, 0.8, 0.48, blue, 0, 1.52, 0).box(0.82, 0.1, 0.52, gold, 0, 1.2, 0)
    .cone(0.72, 0.5, white, 0, 1.86, 0, 0, 0, 0, 8).box(0.16, 0.5, 0.06, gold, 0, 1.5, 0.26);
  const head = new Builder().sphere(0.31, SKIN, 0, 0, 0.03).sphere(0.36, [0xbcd6ff, 0xf4f8ff], 0, 0.02, -0.1, 1, 1.25, 1)
    .cyl(0.62, 0.62, 0.06, 0x2a4fa8, 0, 0.26, 0, 0, 0, 0, 10).cone(0.4, 0.95, [0x2a4fa8, 0x7fb4ff], 0, 0.76, -0.04, -0.12, 0, 0, 8)
    .cyl(0.42, 0.42, 0.1, gold, 0, 0.33, 0, 0, 0, 0, 8).rock(0.12, gold, 0, 1.26, -0.1);
  const armR = arm(new Builder(), blue, SKIN, 0.2)
    .cyl(0.05, 0.06, 2.6, 0x6b4a30, 0, -0.5, 0.18, 0.1, 0, 0, 5)                       // 法杖（竖着拿）
    .torus(0.26, 0.05, gold, 0, 0.95, 0.3, 0, 0, 0, 10).rock(0.2, [0xfff1a8, 0xffffff], 0, 0.95, 0.3, 0.4, 0.4, 0);
  const armL = arm(new Builder(), blue, SKIN, 0.2);
  return assemble({ torso, head, armL, armR, legL: leg(new Builder(), 0x2a4fa8, white, 0.16, 0.9), legR: leg(new Builder(), 0x2a4fa8, white, 0.16, 0.9) },
    { scale: 1.24, shoulder: 0.5, style: 'staff', float: 0.22 });
}

function lingyu() {   // 射手：绿衣、长弓、箭袋、马尾和羽饰
  const green = [0x1f7a4c, 0x55c98a], brown = 0x6b4a30, light = 0xffe08a;
  const torso = new Builder()
    .box(0.84, 0.86, 0.5, green, 0, 1.48, 0).box(0.74, 0.34, 0.46, 0x4a3524, 0, 0.97, 0).box(0.8, 0.1, 0.52, light, 0, 1.1, 0)
    .cyl(0.17, 0.15, 0.95, brown, -0.22, 1.6, -0.36, 0.35, 0, -0.3, 6)                // 箭袋
    .box(0.05, 0.3, 0.05, 0xffffff, -0.34, 2.16, -0.5).box(0.05, 0.3, 0.05, 0xffffff, -0.24, 2.2, -0.52)
    .box(0.76, 0.9, 0.06, [0x2c8f5c, 0x9fe6bd], 0, 1.3, -0.3, 0.18, 0, 0);            // 短披风
  const head = new Builder().sphere(0.31, SKIN, 0, 0, 0.03).sphere(0.36, [0xb5651d, 0xf0a04b], 0, 0.08, -0.07, 1, 0.92, 1)
    .cyl(0.1, 0.05, 0.75, [0xb5651d, 0xf0a04b], 0, -0.1, -0.5, -0.9, 0, 0, 5)          // 马尾
    .box(0.05, 0.56, 0.2, [0x55c98a, 0xffffff], 0.3, 0.42, -0.06, -0.3, 0, -0.25);     // 羽饰
  const armL = arm(new Builder(), green, SKIN, 0.18);
  // 长弓：三段弓臂拼成弧形，加一根弦
  armL.box(0.07, 0.75, 0.09, [0x7a5230, 0xc79a5a], 0, -0.86, 0.36).box(0.06, 0.7, 0.08, [0x7a5230, 0xc79a5a], 0, -0.2, 0.2, 0.5, 0, 0)
    .box(0.06, 0.7, 0.08, [0x7a5230, 0xc79a5a], 0, -1.52, 0.2, -0.5, 0, 0).box(0.02, 1.9, 0.02, 0xffffff, 0, -0.86, 0.04);
  const armR = arm(new Builder(), green, SKIN, 0.18);
  return assemble({ torso, head, armL, armR, legL: leg(new Builder(), brown, 0x3d2a1c, 0.21), legR: leg(new Builder(), brown, 0x3d2a1c, 0.21) },
    { scale: 1.22, shoulder: 0.52, hip: 0.21, style: 'bow' });
}

const HERO_MODELS = { panyue, liefeng, yesun, xinglan, lingyu };

/** 按英雄 id 生成模型 */
export function buildHero(id) { return (HERO_MODELS[id] || liefeng)(); }

/* ------------------------------------------------------------------ 小兵（整块几何体，用实例化批量绘制） */

/** 返回某种小兵的几何体。team 决定配色 */
export function minionGeometry(type, team) {
  const col = TEAM_COLOR[team], dk = team ? 0x8a241c : 0x1f4aa0, metal = [0x7d8798, 0xd0d8e4];
  const b = new Builder();
  if (type === 'melee') {
    b.box(0.62, 0.6, 0.42, [dk, col], 0, 0.86, 0).cyl(0.2, 0.17, 0.5, 0x3a3f4c, -0.17, 0.3, 0, 0, 0, 0, 5).cyl(0.2, 0.17, 0.5, 0x3a3f4c, 0.17, 0.3, 0, 0, 0, 0, 5)
      .sphere(0.25, SKIN, 0, 1.34, 0.02, 1, 1, 1, 6).sphere(0.29, metal, 0, 1.42, -0.03, 1, 0.75, 1, 6).cone(0.08, 0.22, col, 0, 1.72, -0.03, 0, 0, 0, 5)
      .box(0.09, 0.07, 0.95, metal, -0.42, 0.9, 0.45).cyl(0.34, 0.34, 0.08, [dk, col], 0.42, 0.9, 0.2, Math.PI / 2, 0, 0, 8);
  } else if (type === 'ranged') {
    b.cyl(0.24, 0.42, 0.9, [dk, col], 0, 0.5, 0, 0, 0, 0, 7).sphere(0.24, SKIN, 0, 1.2, 0.02, 1, 1, 1, 6)
      .cone(0.3, 0.5, [dk, col], 0, 1.52, -0.02, -0.1, 0, 0, 7)
      .cyl(0.04, 0.04, 1.5, 0x6b4a30, -0.36, 0.85, 0.16, 0.12, 0, 0, 5).rock(0.16, [col, 0xffffff], -0.36, 1.68, 0.25);
  } else {   // 炮车
    b.box(1.2, 0.5, 1.6, [0x4a3524, 0x8a6a48], 0, 0.6, 0).box(1.3, 0.14, 1.7, [dk, col], 0, 0.9, 0)
      .cyl(0.28, 0.34, 1.5, [0x3a3f4c, 0x8892a4], 0, 1.15, 0.45, Math.PI / 2 - 0.25, 0, 0, 8).torus(0.3, 0.07, col, 0, 1.36, 1.1, 0.25, 0, 0, 8);
    for (const [x, z] of [[-0.72, 0.5], [0.72, 0.5], [-0.72, -0.5], [0.72, -0.5]]) b.cyl(0.38, 0.38, 0.16, [0x2a2f3a, 0x5a6272], x, 0.38, z, 0, 0, Math.PI / 2, 8);
  }
  return b.build(true);
}

/* ------------------------------------------------------------------ 防御塔、水晶 */

/**
 * 防御塔。返回 { group, gem, base, rubble }：gem 是顶上会转的宝石，塔被摧毁后隐藏 base/gem、显示 rubble。
 */
export function buildTower(team, tier) {
  const col = TEAM_COLOR[team], stone = [0x5b6272, 0xa7afc0], s = tier >= 3 ? 1.12 : tier === 2 ? 1.05 : 1;
  const b = new Builder()
    .cyl(1.75, 2.0, 0.6, [0x4b5261, 0x8a92a4], 0, 0.3, 0, 0, 0, 0, 8).cyl(1.25, 1.6, 1.6, stone, 0, 1.4, 0, 0, 0, 0, 8)
    .cyl(1.0, 1.25, 2.6, stone, 0, 3.5, 0, 0, 0, 0, 8).cyl(1.5, 1.05, 0.5, [0x6a7284, 0xc0c8d8], 0, 5.05, 0, 0, 0, 0, 8)
    .torus(1.3, 0.14, col, 0, 2.3, 0, Math.PI / 2, 0, 0, 12).torus(1.55, 0.12, col, 0, 5.35, 0, Math.PI / 2, 0, 0, 12);
  for (let a = 0; a < 4; a++) {
    const x = Math.cos(a * 1.571) * 1.35, z = Math.sin(a * 1.571) * 1.35;
    b.box(0.34, 0.7, 0.34, [0x6a7284, 0xc0c8d8], x, 5.6, z).box(0.2, 1.3, 0.08, col, Math.cos(a * 1.571) * 1.3, 3.6, Math.sin(a * 1.571) * 1.3, 0, -a * 1.571 + 1.571, 0);
  }
  const group = new THREE.Group();
  const base = mesh(b); base.castShadow = true;
  const gem = new THREE.Mesh(new Builder().cone(0.75, 1.3, [col, 0xffffff], 0, 0.65, 0, 0, 0, 0, 6).cone(0.75, 1.0, [0xffffff, col], 0, -0.5, 0, Math.PI, 0, 0, 6).build(true), MAT.vcBasic);
  gem.position.y = 7.1;
  const rb = new Builder().cyl(1.75, 2.0, 0.5, [0x3d4350, 0x6e7686], 0, 0.25, 0, 0, 0, 0, 8);
  for (let i = 0; i < 7; i++) rb.rock(0.5 + (i % 3) * 0.2, [0x4b5261, 0x8a92a4], Math.cos(i * 0.9) * (0.4 + i * 0.22), 0.6 + (i % 2) * 0.3, Math.sin(i * 0.9) * (0.4 + i * 0.22), i, i * 2, i * 0.5, 1, 0.8, 1);
  const rubble = mesh(rb); rubble.visible = false;
  group.add(base, gem, rubble);
  group.scale.setScalar(s);
  return { group, gem, base, rubble };
}

/** 基地水晶。返回 { group, gem, base, rubble } */
export function buildCrystal(team) {
  const col = TEAM_COLOR[team];
  const group = new THREE.Group();
  const gb = new Builder().cone(1.9, 3.4, [col, 0xffffff], 0, 1.7, 0, 0, 0, 0, 6).cone(1.9, 2.2, [0xffffff, col], 0, -1.1, 0, Math.PI, 0, 0, 6);
  for (let a = 0; a < 3; a++) gb.cone(0.5, 1.5, [col, 0xffffff], Math.cos(a * 2.094) * 2.5, 0.2, Math.sin(a * 2.094) * 2.5, 0, 0, 0, 5).cone(0.5, 1.0, [0xffffff, col], Math.cos(a * 2.094) * 2.5, -1.05, Math.sin(a * 2.094) * 2.5, Math.PI, 0, 0, 5);
  const gem = new THREE.Mesh(gb.build(true), MAT.vcBasic);
  gem.position.y = 4.2;
  const base = mesh(new Builder().cyl(2.6, 3.0, 0.5, [0x6f7686, 0xb4bac8], 0, 1.15, 0, 0, 0, 0, 10).torus(2.7, 0.2, col, 0, 1.45, 0, Math.PI / 2, 0, 0, 14));
  const rb = new Builder();
  for (let i = 0; i < 9; i++) rb.rock(0.6 + (i % 3) * 0.3, i % 2 ? [0x4b5261, 0x8a92a4] : [col, 0xffffff], Math.cos(i * 0.7) * (0.5 + i * 0.3), 1.2 + (i % 2) * 0.3, Math.sin(i * 0.7) * (0.5 + i * 0.3), i, i * 2, i * 0.5, 1, 0.7, 1);
  const rubble = mesh(rb); rubble.visible = false;
  group.add(base, gem, rubble);
  return { group, gem, base, rubble };
}

/* ------------------------------------------------------------------ 野怪 */

/** 野怪：整块静态网格，靠整体的起伏、晃动来表现动作 */
export function buildMonster(kind) {
  const b = new Builder();
  const beast = (body, belly, eye, s, horn) => {
    b.sphere(0.95 * s, body, 0, 0.95 * s, -0.1 * s, 1, 0.82, 1.25, 7).sphere(0.55 * s, body, 0, 1.2 * s, 0.95 * s, 1, 0.9, 1, 7)
      .sphere(0.5 * s, belly, 0, 0.62 * s, 0.1 * s, 1.2, 0.6, 1.4, 6);
    for (const [x, z] of [[-0.6, 0.5], [0.6, 0.5], [-0.6, -0.6], [0.6, -0.6]]) b.cyl(0.24 * s, 0.3 * s, 0.7 * s, body, x * s, 0.35 * s, z * s, 0, 0, 0, 6);
    b.sphere(0.1 * s, eye, -0.24 * s, 1.36 * s, 1.38 * s, 1, 1, 1, 5).sphere(0.1 * s, eye, 0.24 * s, 1.36 * s, 1.38 * s, 1, 1, 1, 5);
    for (let i = 0; i < 4; i++) b.cone(0.2 * s, 0.6 * s, horn, 0, 1.75 * s, (0.5 - i * 0.45) * s, -0.4, 0, 0, 5);
    b.cone(0.14 * s, 0.5 * s, horn, -0.36 * s, 1.72 * s, 1.0 * s, 0.5, 0, 0.4, 5).cone(0.14 * s, 0.5 * s, horn, 0.36 * s, 1.72 * s, 1.0 * s, 0.5, 0, -0.4, 5);
  };
  if (kind === 'small') beast([0x5d5648, 0xa69a80], 0xcbbf9e, 0xffe66b, 1, [0x4a443a, 0xd8d0b8]);
  else if (kind === 'red') beast([0x8a2a1c, 0xf0603a], 0xffb070, 0xfff3a0, 1.35, [0x5a1810, 0xffc04a]);
  else if (kind === 'blue') beast([0x1f4f9a, 0x58b8ff], 0xbfeaff, 0xffffff, 1.35, [0x163a78, 0xd8f6ff]);
  else {   // 远古巨灵：石头巨人
    const st = [0x4a3f66, 0x9a86d0], core = 0xff9df0;
    b.rock(1.7, st, 0, 2.6, 0, 0.2, 0.4, 0, 1, 1.15, 0.85).rock(1.0, st, 0, 4.7, 0.2, 0.5, 0.2, 0.1)
      .rock(1.0, st, -2.1, 2.9, 0.2, 0.3, 0, 0.4, 0.8, 1.5, 0.8).rock(1.0, st, 2.1, 2.9, 0.2, 0.3, 0, -0.4, 0.8, 1.5, 0.8)
      .rock(0.8, st, -2.4, 1.2, 0.5, 0, 0.5, 0).rock(0.8, st, 2.4, 1.2, 0.5, 0, 0.5, 0)
      .cyl(0.7, 0.85, 1.6, st, -0.75, 0.8, 0, 0, 0, 0, 6).cyl(0.7, 0.85, 1.6, st, 0.75, 0.8, 0, 0, 0, 0, 6)
      .rock(0.55, [core, 0xffffff], 0, 2.9, 1.25).sphere(0.16, core, -0.35, 4.85, 1.05, 1, 1, 1, 5).sphere(0.16, core, 0.35, 4.85, 1.05, 1, 1, 1, 5);
  }
  return mesh(b);
}
