// 英雄技能的公共小工具。每个英雄一个文件，结构相同：
//   base     基础属性和每级成长（xxG）
//   passive  被动的名字和说明（逻辑在 onAttack / tick 里）
//   skills   三个技能：aim 瞄准方式（dir 方向 / point 地点 / self 自身），range 射程，
//            cd/cost 按技能等级的数组，ai 给电脑的使用提示，cast(h, a, g, lv) 释放逻辑
// 新增英雄：照着写一个文件，在 index.js 里登记，再到 render/models.js 里加一个模型即可。
import { KIND } from '../entities.js';

/** 技能能打到的单位：英雄、小兵、野怪（不含建筑） */
export const UNITS = KIND.HERO | KIND.MINION | KIND.MONSTER;

/** 按技能等级取数值：base + per × (lv - 1) */
export const val = (base, per, lv) => base + per * (lv - 1);

/** 把方向 (dx, dz) 旋转 ang 弧度 */
export function rot(dx, dz, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [dx * c + dz * s, dz * c - dx * s];
}
