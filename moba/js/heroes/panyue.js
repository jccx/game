// 磐岳 —— 坦克。皮糙肉厚，冲进人群把敌人眩晕住，替队友挡伤害。
import { UNITS, val } from './common.js';

export default {
  id: 'panyue', name: '磐岳', title: '镇岳之盾', role: 'tank', roleName: '坦克',
  desc: '最硬的前排。冲撞眩晕，护盾减速，大招跳进人群群体眩晕。',
  ease: 1, colors: { main: 0x8e9bb0, accent: 0xf2c14e },
  base: { hp: 3700, hpG: 360, mp: 420, mpG: 40, ad: 160, adG: 10, armor: 125, armorG: 24, mr: 60, mrG: 10, as: 0.9, asG: 0.015, ms: 6.3, range: 2.8 },
  skillOrder: [0, 1],
  passive: { name: '不动如山', desc: '生命低于一半时，受到的伤害减少 20%。' },

  tick(h) { h.dmgTakenMul = h.hp < h.maxHp * 0.5 ? 0.8 : 1; },

  skills: [
    {
      name: '撼地冲撞', icon: 'dash', aim: 'dir', range: 8, width: 2.4,
      desc: '向前冲撞，对路径上的敌人造成物理伤害；撞到英雄时停下并将其眩晕 0.9 秒。',
      cd: [9, 8.5, 8, 7.5, 7, 6.5], cost: [45, 50, 55, 60, 65, 70],
      ai: { type: 'dash', engage: true, escape: true },
      cast(h, a, g, lv) {
        const dmg = val(180, 60, lv) + h.ad * 0.6;
        h.startDash({
          dx: a.dx, dz: a.dz, dist: 8, speed: 26, hitR: 1.9, mask: UNITS, stopOnHero: true,
          onHit: (u) => {
            g.damage(h, u, dmg, 'phys');
            if (u.isHero) { u.stun(0.9); g.fx('burst', { x: u.x, z: u.z, color: 0xffe08a, n: 14 }); }
          },
        });
        g.fx('dust', { x: h.x, z: h.z });
      },
    },
    {
      name: '磐石护体', icon: 'shield', aim: 'self', range: 5, radius: 5,
      desc: '获得一层护盾，并震击周围敌人，造成法术伤害和 30% 减速。',
      cd: [12, 11.5, 11, 10.5, 10, 9.5], cost: [55, 60, 65, 70, 75, 80], castTime: 0.1,
      ai: { type: 'self', near: 4.5, clear: true, defensive: true },
      cast(h, a, g, lv) {
        h.addShield(val(400, 150, lv) + h.maxHp * 0.1, 4);
        const dmg = val(120, 40, lv) + h.ad * 0.3;
        for (const u of g.query(h.x, h.z, 5, h.team, UNITS)) { g.damage(h, u, dmg, 'magic'); u.slow(0.7, 2); }
        g.fx('ring', { x: h.x, z: h.z, r: 5, color: 0xf2c14e });
        g.fx('shield', { u: h, dur: 4, color: 0xf2c14e });
      },
    },
    {
      name: '山崩地裂', icon: 'quake', aim: 'point', range: 7.5, radius: 5.5,
      desc: '跃向目标地点，落地时对范围内敌人造成大量物理伤害并眩晕。',
      cd: [50, 45, 40], cost: [100, 110, 120], castTime: 0.1,
      ai: { type: 'leap', r: 5.5, ult: true, engage: true },
      cast(h, a, g, lv) {
        const dmg = val(450, 250, lv) + h.ad * 1.0, st = val(1.25, 0.25, lv);
        g.fx('warn', { x: a.x, z: a.z, r: 5.5, dur: Math.max(0.2, a.dist / 24), color: 0xffb347 });
        h.startDash({
          dx: a.dx, dz: a.dz, dist: Math.max(0.5, a.dist), speed: 24, jump: true,
          onEnd: () => {
            for (const u of g.query(h.x, h.z, 5.5, h.team, UNITS)) {
              g.damage(h, u, dmg + (u.isHero ? u.maxHp * 0.06 : 0), 'phys'); u.stun(st);
            }
            g.fx('quake', { x: h.x, z: h.z, r: 5.5, color: 0xffb347 });
          },
        });
      },
    },
  ],
};
