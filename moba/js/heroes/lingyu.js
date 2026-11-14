// 翎羽 —— 射手。射程远、后期伤害最高，但很脆，需要保持距离持续输出。
import { UNITS, val, rot } from './common.js';
import { KIND } from '../entities.js';

export default {
  id: 'lingyu', name: '翎羽', title: '逐风神射', role: 'marksman', roleName: '射手',
  desc: '远程持续输出。散射清兵，翻跃拉开距离，大招全图狙击并眩晕。',
  ease: 2, colors: { main: 0x3fae7a, accent: 0xffe08a },
  projKind: 'arrow',
  base: { hp: 3000, hpG: 265, mp: 440, mpG: 40, ad: 180, adG: 15, armor: 84, armorG: 16, mr: 50, mrG: 8.5, as: 1.05, asG: 0.03, ms: 6.3, range: 9.5, projSpeed: 30 },
  skillOrder: [0, 1],
  passive: { name: '连珠', desc: '每次普攻提高 6% 攻速，最多叠 5 层；3 秒不攻击后消失。' },

  onAttack(h, t, dmg) {
    h.ps.n = h.hasBuff('lianzhu') ? Math.min(5, (h.ps.n || 0) + 1) : 1;
    h.addBuff('lianzhu', 3, { asPct: 0.06 * h.ps.n });
    return dmg;
  },

  skills: [
    {
      name: '散射', icon: 'fan', aim: 'dir', range: 10, width: 6,
      desc: '扇形射出五支箭，各自对命中的第一个敌人造成物理伤害。',
      cd: [7, 6.6, 6.2, 5.8, 5.4, 5], cost: [45, 50, 55, 60, 65, 70],
      ai: { type: 'shot', speed: 32, clear: true },
      cast(h, a, g, lv) {
        const dmg = val(150, 50, lv) + h.ad * 0.6;
        const hitN = new Map();
        for (const ang of [-0.34, -0.17, 0, 0.17, 0.34]) {
          const [dx, dz] = rot(a.dx, a.dz, ang);
          g.shoot({
            src: h, x: h.x, z: h.z, dx, dz, speed: 32, range: 10, radius: 0.75, mask: UNITS, kind: 'arrow', color: 0xffe08a,
            onHit: (u) => { const n = hitN.get(u) || 0; hitN.set(u, n + 1); g.damage(h, u, dmg * (n ? 0.3 : 1), 'phys'); },
          });
        }
      },
    },
    {
      name: '凌空翻跃', icon: 'roll', aim: 'dir', range: 5.5, width: 1.6,
      desc: '向指定方向翻滚；之后的下一次普攻伤害提高、射程加长，并立刻可以出手。',
      cd: [9, 8.4, 7.8, 7.2, 6.6, 6], cost: [40, 44, 48, 52, 56, 60], castTime: 0.05,
      ai: { type: 'dash', escape: true, kite: true },
      cast(h, a, g, lv) {
        h.startDash({ dx: a.dx, dz: a.dz, dist: 5.5, speed: 22 });
        h.nextAtk = { bonus: val(90, 35, lv), range: 2, t: 4 };
        h.atkCd = 0;
        g.fx('dust', { x: h.x, z: h.z });
      },
    },
    {
      name: '贯日长虹', icon: 'snipe', aim: 'dir', range: 42, width: 2.6,
      desc: '射出一支飞越大半张地图的巨箭，命中第一个敌方英雄时爆炸，造成物理伤害并眩晕；飞得越远，伤害越高、眩晕越久。',
      cd: [50, 45, 40], cost: [100, 110, 120], castTime: 0.3,
      ai: { type: 'shot', speed: 40, ult: true, ultHp: 0.6, far: 30 },
      cast(h, a, g, lv) {
        const dmg = val(500, 250, lv) + h.ad * 1.0, sx = h.x, sz = h.z;
        g.shoot({
          src: h, x: h.x, z: h.z, dx: a.dx, dz: a.dz, speed: 40, range: 42, radius: 1.4, mask: KIND.HERO, kind: 'bigarrow', color: 0xfff0a0,
          onHit: (u) => {
            const k = Math.min(1, Math.hypot(u.x - sx, u.z - sz) / 30);
            g.damage(h, u, dmg * (1 + 0.5 * k), 'phys'); u.stun(1 + k);
            for (const o of g.query(u.x, u.z, 3, h.team, UNITS)) if (o !== u) g.damage(h, o, dmg * 0.5, 'phys');
            g.fx('quake', { x: u.x, z: u.z, r: 3, color: 0xfff0a0 });
          },
        });
      },
    },
  ],
};
