// 裂谷争锋：全局数值表。调平衡性主要改这里。
// 约定：队伍 0 = 蓝方（左下，玩家所在），1 = 红方（右上），2 = 中立（野怪）。

export const TEAM = { BLUE: 0, RED: 1, NEUTRAL: 2 };

/** 逻辑帧率（每秒更新次数）。画面按屏幕刷新率插值，不受它限制 */
export const TICK = 30;

/** 小兵。hpGrow/adGrow 为每分钟成长比例 */
export const MINION = {
  melee:  { hp: 1100, ad: 62,  armor: 30, mr: 20, as: 0.8,  range: 2.4, ms: 5.0, radius: 0.7, gold: 44, exp: 62,  aggro: 8.5 },
  ranged: { hp: 780,  ad: 96,  armor: 15, mr: 15, as: 0.75, range: 7.5, ms: 5.0, radius: 0.65, gold: 34, exp: 46, aggro: 9.5, projSpeed: 22 },
  siege:  { hp: 2300, ad: 150, armor: 60, mr: 60, as: 0.6,  range: 9.5, ms: 4.8, radius: 1.0, gold: 86, exp: 115, aggro: 10.5, projSpeed: 20, vsTower: 1.6 },
  hpGrow: 0.07, adGrow: 0.05,
  firstWave: 12,       // 第一波出兵时间（秒）
  waveEvery: 30,       // 出兵间隔
  siegeEvery: 3,       // 每几波带一辆炮车
  superHp: 1.9, superAd: 1.5,   // 超级兵：对方这一路的塔全被拆掉后，己方这一路出的兵更强
};

/** 各模式的节奏：grow 是小兵成长速度的倍率（越大越快分出胜负），towerHp 是塔和水晶的血量倍率 */
export const PACE = {
  '5v5': { grow: 1.9, towerHp: 0.85 },
  '3v3': { grow: 2.3, towerHp: 0.8 },
  '1v1': { grow: 2.8, towerHp: 0.65 },
};

/** 防御塔，按层级 1（外塔）/2（二塔）/3（高地塔） */
export const TOWER = {
  hp: [0, 5200, 6200, 7200],
  ad: [0, 470, 520, 580],
  armor: 110, mr: 110, as: 0.95, range: 11.5, radius: 1.9,
  projSpeed: 30,
  heroRamp: 0.35,      // 连续攻击同一英雄时，每次伤害提高的比例
  heroRampMax: 2.4,
  noMinionReduce: 0.45,// 附近没有进攻方小兵时，塔受到的伤害倍率（防偷塔）
  gold: 160,           // 摧毁后全队每人获得
  exp: 180,
};

/** 水晶（基地） */
export const CRYSTAL = { hp: 11000, ad: 480, armor: 130, mr: 130, as: 1.0, range: 12, radius: 3.2, regen: 25 };

/** 野怪。respawn 为死亡后的重生秒数 */
export const MONSTER = {
  small: { name: '石爪兽', hp: 2100, ad: 90,  armor: 40, mr: 40, as: 0.8, range: 2.6, ms: 6, radius: 1.1, gold: 78,  exp: 110, respawn: 70,  leash: 9 },
  red:   { name: '炎甲兽', hp: 3900, ad: 135, armor: 60, mr: 60, as: 0.8, range: 2.8, ms: 6, radius: 1.5, gold: 110, exp: 160, respawn: 90,  leash: 9, buff: 'red' },
  blue:  { name: '霜纹兽', hp: 3900, ad: 135, armor: 60, mr: 60, as: 0.8, range: 2.8, ms: 6, radius: 1.5, gold: 110, exp: 160, respawn: 90,  leash: 9, buff: 'blue' },
  boss:  { name: '远古巨灵', hp: 9500, ad: 260, armor: 90, mr: 90, as: 0.7, range: 3.6, ms: 5, radius: 2.4, gold: 0,   exp: 0,   respawn: 180, leash: 11, teamGold: 140, teamExp: 220, firstSpawn: 120 },
  hpGrow: 0.05,        // 每分钟成长
};

/** 野怪增益效果：持续时间（秒）和效果 */
export const BUFFS = {
  red:  { name: '炎甲之力', dur: 70, color: 0xff6a3a, burn: 0.02, slow: 0.12 },   // 普攻附带灼烧并减速
  blue: { name: '霜纹之力', dur: 70, color: 0x4ab8ff, mpRegen: 18, cdr: 0.15 },    // 回蓝并缩短冷却
};

/** 经济与经验 */
export const ECON = {
  startGold: 300,
  passiveGold: 3,          // 每秒自然增长
  shareRange: 16,          // 附近多远的英雄能分到金币经验
  assistShare: 0.5,        // 没补到刀的附近英雄拿到的金币比例
  heroKillGold: 200, heroKillGoldPerLevel: 14, assistGold: 90,
  heroKillExp: 140, heroKillExpPerLevel: 34,
  maxLevel: 15,
  /** 升到下一级所需经验 */
  expNeed: (lv) => 160 + lv * 75,
};

/** 英雄通用 */
export const HERO = {
  radius: 0.85,
  respawnBase: 6, respawnPerLevel: 1.7,     // 复活时间 = base + 等级 × perLevel
  recallTime: 6,                            // 回城引导秒数
  flashDist: 7.5, flashCd: 100,
  healCd: 60, healDur: 5, healPct: 0.07,    // 恢复：每秒回复最大生命/法力的比例
  fountainRange: 9, fountainHeal: 0.14,     // 泉水每秒回复比例
  fountainDmg: 0.25,                        // 敌方泉水每 0.5 秒造成最大生命的比例
  outOfCombat: 5,                           // 脱战判定秒数
  skillMax: [6, 6, 3],                      // 三个技能的等级上限
  ultLevels: [4, 8, 12],                    // 大招可学的英雄等级
  cdrMax: 0.4,
};

/** 难度：思考间隔越短越灵敏；aimErr 是技能瞄准偏差（弧度）；aggro 越大越好斗 */
export const DIFFICULTY = [
  { name: '简单', think: 0.5,  aimErr: 0.30, aggro: 0.75, dmgMul: 0.85, combo: 0.45 },
  { name: '普通', think: 0.28, aimErr: 0.14, aggro: 1.0,  dmgMul: 1.0,  combo: 0.8 },
  { name: '困难', think: 0.14, aimErr: 0.05, aggro: 1.2,  dmgMul: 1.0,  combo: 1.0 },
];
