// 烈锋 —— 战士。能打能抗，贴身缠斗，残血时靠被动回血。
import { UNITS, val } from './common.js';

export default {
  id: 'liefeng', name: '烈锋', title: '赤焰剑豪', role: 'fighter', roleName: '战士',
  desc: '攻守均衡的近战。旋风斩清兵，突进追人，大招跃入战场收割残血。',
  ease: 1, colors: { main: 0xd9483b, accent: 0xffc857 },
  base: { hp: 3450, hpG: 330, mp: 440, mpG: 40, ad: 172, adG: 12.5, armor: 105, armorG: 21, mr: 55, mrG: 9, as: 0.95, asG: 0.02, ms: 6.5, range: 2.9 },
  skillOrder: [0, 1],
  passive: { name: '战意', desc: '每第三次普攻造成额外伤害，并回复自身 3% 最大生命。' },

  onAttack(h, t, dmg, g) {
    h.ps.n = (h.ps.n || 0) + 1;
    if (h.ps.n >= 3) {
      h.ps.n = 0;
      dmg += 40 + h.level * 8 + (t.isHero ? t.maxHp * 0.05 : 0);
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.03);
      g.fx('burst', { x: t.x, z: t.z, color: 0xff7a3a, n: 8 });
    }
    return dmg;
  },

  skills: [
    {
      name: '旋风斩', icon: 'spin', aim: 'self', range: 4.6, radius: 4.6,
      desc: '挥剑横扫一圈，对周围敌人造成物理伤害；每命中一个英雄回复少量生命。',
      cd: [7, 6.6, 6.2, 5.8, 5.4, 5], cost: [40, 44, 48, 52, 56, 60], castTime: 0.22,
      ai: { type: 'self', near: 4.2, clear: true },
      cast(h, a, g, lv) {
        const dmg = val(200, 70, lv) + h.ad * 0.9;
        g.fx('spin', { u: h, r: 4.6, color: 0xff6b3d });
        for (const u of g.query(h.x, h.z, 4.6, h.team, UNITS)) {
          g.damage(h, u, dmg, 'phys');
          if (u.isHero) h.hp = Math.min(h.maxHp, h.hp + val(40, 16, lv) + h.maxHp * 0.02);
        }
      },
    },
    {
      name: '破阵突进', icon: 'dash', aim: 'dir', range: 7, width: 2.2,
      desc: '向前突进并伤害路径上的敌人；之后的下一次普攻伤害提高、射程加长并减速目标。',
      cd: [10, 9.5, 9, 8.5, 8, 7.5], cost: [45, 50, 55, 60, 65, 70],
      ai: { type: 'dash', engage: true, escape: true },
      cast(h, a, g, lv) {
        const dmg = val(150, 50, lv) + h.ad * 0.5;
        h.startDash({ dx: a.dx, dz: a.dz, dist: 7, speed: 28, hitR: 1.8, mask: UNITS, onHit: (u) => g.damage(h, u, dmg, 'phys') });
        h.nextAtk = { bonus: val(80, 30, lv), slow: 0.6, slowDur: 1.5, range: 1, t: 4 };
        h.atkCd = Math.min(h.atkCd, 0.15);
        g.fx('dust', { x: h.x, z: h.z });
      },
    },
    {
      name: '天陨斩', icon: 'leap', aim: 'point', range: 8.5, radius: 5,
      desc: '高高跃起砸向目标地点，造成大量物理伤害（目标生命越低伤害越高）并减速，落地后自身攻速、移速提升。',
      cd: [45, 40, 35], cost: [100, 110, 120], castTime: 0.1,
      ai: { type: 'leap', r: 5, ult: true, engage: true, ultHp: 0.55 },
      cast(h, a, g, lv) {
        const dmg = val(500, 280, lv) + h.ad * 1.2;
        g.fx('warn', { x: a.x, z: a.z, r: 5, dur: Math.max(0.2, a.dist / 22), color: 0xff5a36 });
        h.startDash({
          dx: a.dx, dz: a.dz, dist: Math.max(0.5, a.dist), speed: 22, jump: true, untarget: true,
          onEnd: () => {
            for (const u of g.query(h.x, h.z, 5, h.team, UNITS)) {
              g.damage(h, u, dmg + (u.isHero ? (u.maxHp - u.hp) * 0.15 : 0), 'phys'); u.slow(0.5, 2);
            }
            h.addBuff('tianyun', 5, { asPct: 0.2, msPct: 0.1 });
            g.fx('quake', { x: h.x, z: h.z, r: 5, color: 0xff5a36 });
          },
        });
      },
    },
  ],
};
