// 星岚 —— 法师。远程法术输出，技能命中叠“星痕”，叠满引爆。
import { UNITS, val } from './common.js';

/** 被动：技能命中叠一层星痕，第三层引爆 */
function mark(h, u, g) {
  if (!u.alive || u.isStruct) return;
  const m = u.marks && u.marks.t > g.time ? u.marks : (u.marks = { n: 0, t: 0 });
  m.n++; m.t = g.time + 6;
  if (m.n >= 3) {
    m.n = 0;
    g.damage(h, u, 120 + h.level * 12 + h.ap * 0.35, 'magic');
    g.fx('burst', { x: u.x, z: u.z, color: 0xfff1a8, n: 16 });
  }
}

export default {
  id: 'xinglan', name: '星岚', title: '观星术士', role: 'mage', roleName: '法师',
  desc: '远程法术炮台。星光弹消耗，霜星阵控场，大招召唤陨星覆盖战场。',
  ease: 2, colors: { main: 0x4f8fe8, accent: 0xfff1a8 },
  projKind: 'orb',
  base: { hp: 3050, hpG: 270, mp: 520, mpG: 55, ad: 158, adG: 9, ap: 0, apG: 0, armor: 86, armorG: 16, mr: 50, mrG: 8.5, as: 0.9, asG: 0.012, ms: 6.3, range: 8.5, projSpeed: 24 },
  skillOrder: [0, 1],
  passive: { name: '星痕', desc: '技能命中会给敌人叠加星痕，叠满三层时引爆，造成额外法术伤害。' },

  skills: [
    {
      name: '星光弹', icon: 'orb', aim: 'dir', range: 11.5, width: 2,
      desc: '射出一枚星光弹，穿透小兵，命中英雄时停下，造成法术伤害。',
      cd: [5.5, 5.2, 4.9, 4.6, 4.3, 4], cost: [50, 55, 60, 65, 70, 75],
      ai: { type: 'shot', speed: 28, clear: true },
      cast(h, a, g, lv) {
        const dmg = val(260, 85, lv) + h.ap * 0.55;
        g.shoot({
          src: h, x: h.x, z: h.z, dx: a.dx, dz: a.dz, speed: 28, range: 11.5, radius: 1.0, mask: UNITS, pierce: true, stopOnHero: true, kind: 'star', color: 0x8fd0ff,
          onHit: (u) => { g.damage(h, u, dmg, 'magic'); mark(h, u, g); },
        });
      },
    },
    {
      name: '霜星阵', icon: 'frost', aim: 'point', range: 9.5, radius: 4.2,
      desc: '在目标地点召唤霜星，短暂延迟后爆发：造成法术伤害和 45% 减速，正中心的敌人被冻结 0.8 秒。',
      cd: [10, 9.5, 9, 8.5, 8, 7.5], cost: [70, 75, 80, 85, 90, 95],
      ai: { type: 'point', r: 4.2, delay: 0.55, clear: true },
      cast(h, a, g, lv) {
        const dmg = val(280, 90, lv) + h.ap * 0.5, x = a.x, z = a.z;
        g.fx('warn', { x, z, r: 4.2, dur: 0.55, color: 0x8fd8ff });
        g.after(0.55, () => {
          for (const u of g.query(x, z, 4.2, h.team, UNITS)) {
            g.damage(h, u, dmg, 'magic'); u.slow(0.55, 2);
            if (Math.hypot(u.x - x, u.z - z) < 1.8 + u.radius) u.stun(0.8);
            mark(h, u, g);
          }
          g.fx('frost', { x, z, r: 4.2, color: 0xaee6ff });
        });
      },
    },
    {
      name: '星陨', icon: 'meteor', aim: 'point', range: 11, radius: 6,
      desc: '在目标区域接连落下五颗陨星，每颗对小范围内的敌人造成法术伤害。',
      cd: [48, 43, 38], cost: [120, 135, 150],
      ai: { type: 'point', r: 5, delay: 0.5, ult: true, ultHp: 0.7 },
      cast(h, a, g, lv) {
        const dmg = val(300, 160, lv) + h.ap * 0.45;
        g.fx('warn', { x: a.x, z: a.z, r: 6, dur: 2.6, color: 0xffc46b, thin: true });
        for (let i = 0; i < 5; i++) {
          // 第一颗落在正中，其余在范围内随机
          const ang = Math.random() * 6.283, rr = i === 0 ? 0 : 1.5 + Math.random() * 3;
          const x = a.x + Math.cos(ang) * rr, z = a.z + Math.sin(ang) * rr, t = 0.35 + i * 0.5;
          g.after(t - 0.35, () => g.fx('meteor', { x, z, r: 3.2, dur: 0.35, color: 0xffb04a }));
          g.after(t, () => {
            for (const u of g.query(x, z, 3.2, h.team, UNITS)) { g.damage(h, u, dmg, 'magic'); mark(h, u, g); }
          });
        }
      },
    },
  ],
};
