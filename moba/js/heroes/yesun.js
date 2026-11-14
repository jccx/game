// 夜隼 —— 刺客。身板脆、爆发高，绕后切入秒掉残血再脱身。
import { UNITS, val, rot } from './common.js';
import { KIND } from '../entities.js';

/** 被动：对生命低于一半的敌人伤害提高 20% */
const hunt = (t) => (t.hp < t.maxHp * 0.5 ? 1.2 : 1);

export default {
  id: 'yesun', name: '夜隼', title: '暗影猎手', role: 'assassin', roleName: '刺客',
  desc: '高机动高爆发。瞬步近身，飞刃减速，大招处决残血并可连续收割。',
  ease: 3, colors: { main: 0x6d4bb5, accent: 0x9be8ff },
  base: { hp: 3150, hpG: 290, mp: 440, mpG: 40, ad: 178, adG: 13.5, armor: 92, armorG: 18, mr: 50, mrG: 8.5, as: 1.0, asG: 0.025, ms: 6.8, range: 2.7 },
  skillOrder: [1, 0],
  passive: { name: '猎杀', desc: '对生命低于一半的敌人，普攻和技能伤害提高 20%。' },

  onAttack(h, t, dmg) { return dmg * hunt(t); },

  skills: [
    {
      name: '瞬影步', icon: 'blink', aim: 'dir', range: 6.5, width: 1.6,
      desc: '瞬间闪现一小段距离；之后的下一次普攻必定暴击并附带额外伤害。',
      cd: [8, 7.5, 7, 6.5, 6, 5.5], cost: [40, 44, 48, 52, 56, 60], castTime: 0.05,
      ai: { type: 'blink', engage: true, escape: true },
      cast(h, a, g, lv) {
        const ox = h.x, oz = h.z;
        h.blink(a.dx, a.dz, 6.5);
        h.nextAtk = { crit: true, bonus: val(50, 20, lv), t: 4 };
        h.atkCd = Math.min(h.atkCd, 0.1);
        g.fx('blink', { x: ox, z: oz, x2: h.x, z2: h.z, color: 0x9b7bff });
      },
    },
    {
      name: '隼羽飞刃', icon: 'blades', aim: 'dir', range: 10, width: 4,
      desc: '扇形掷出三把飞刃，各自对命中的第一个敌人造成物理伤害并减速 30%。',
      cd: [7.5, 7.1, 6.7, 6.3, 5.9, 5.5], cost: [45, 50, 55, 60, 65, 70],
      ai: { type: 'shot', speed: 30, clear: true },
      cast(h, a, g, lv) {
        const dmg = val(140, 45, lv) + h.ad * 0.55;
        const hitN = new Map();
        for (const ang of [-0.21, 0, 0.21]) {
          const [dx, dz] = rot(a.dx, a.dz, ang);
          g.shoot({
            src: h, x: h.x, z: h.z, dx, dz, speed: 30, range: 10, radius: 0.8, mask: UNITS, kind: 'blade', color: 0x9be8ff,
            onHit: (u) => {
              const n = hitN.get(u) || 0; hitN.set(u, n + 1);
              g.damage(h, u, dmg * (n ? 0.5 : 1) * hunt(u), 'phys'); u.slow(0.7, 1.5);
            },
          });
        }
      },
    },
    {
      name: '夜幕处决', icon: 'exec', aim: 'dir', range: 9, width: 2,
      desc: '化作暗影突袭最近的敌方英雄，造成大量物理伤害（目标生命越低伤害越高）。若击杀目标，刷新瞬影步并返还一半冷却。',
      cd: [40, 35, 30], cost: [100, 110, 120], castTime: 0.05,
      ai: { type: 'exec', ult: true, ultHp: 0.5 },
      cast(h, a, g, lv) {
        // 目标：瞄准方向上射程内最近的敌方英雄；没有则向前突进
        let tg = a.target && a.target.isHero ? a.target : null;
        if (!tg) {
          let bd = 1e9;
          for (const u of g.query(h.x + a.dx * 4.5, h.z + a.dz * 4.5, 6, h.team, KIND.HERO)) {
            const d = h.distTo(u); if (d < bd && d <= 10.5) { bd = d; tg = u; }
          }
        }
        let dx = a.dx, dz = a.dz, dist = 9;
        if (tg) { const d = h.distTo(tg) || 1; dx = (tg.x - h.x) / d; dz = (tg.z - h.z) / d; dist = Math.max(0.5, d - 1.2); h.face = Math.atan2(dx, dz); }
        const dmg = val(550, 300, lv) + h.ad * 1.3;
        g.fx('blink', { x: h.x, z: h.z, x2: h.x + dx * dist, z2: h.z + dz * dist, color: 0x5a2bd6 });
        h.startDash({
          dx, dz, dist, speed: 34, untarget: true,
          onEnd: () => {
            const list = tg && tg.alive ? [tg] : g.query(h.x, h.z, 2.6, h.team, UNITS);
            for (const u of list) {
              if (h.distTo(u) > 4.5) continue;
              g.damage(h, u, (dmg + (u.isHero ? (u.maxHp - u.hp) * 0.2 : 0)) * hunt(u), 'phys');
              g.fx('burst', { x: u.x, z: u.z, color: 0xb48bff, n: 18 });
              if (u.isHero && !u.alive) { h.cds[0] = 0; h.cds[2] *= 0.5; }
            }
            h.atkCd = Math.min(h.atkCd, 0.1);
          },
        });
      },
    },
  ],
};
