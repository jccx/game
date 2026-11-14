// 裂谷争锋：装备表和各英雄的推荐出装。
// 属性键：hp 生命、mp 法力、ad 物理攻击、ap 法术攻击、armor 物理防御、mr 法术防御、
//        asPct 攻速（比例）、ms 移速、crit 暴击率、lifesteal 吸血、cdr 冷却缩减、
//        pen 物理穿透（比例）、mpen 法术穿透（比例）、hpRegen/mpRegen 每秒回复。

export const ITEMS = {
  boots:  { name: '疾行靴',   cost: 650,  type: 'move', ms: 0.9, desc: '移速 +0.9' },

  blade:  { name: '裂风刃',   cost: 1700, type: 'atk', ad: 85, asPct: 0.15, desc: '物攻 +85，攻速 +15%' },
  bow:    { name: '逐日弓',   cost: 1900, type: 'atk', ad: 45, asPct: 0.35, desc: '物攻 +45，攻速 +35%' },
  crit:   { name: '无尽锋芒', cost: 2150, type: 'atk', ad: 110, crit: 0.25, desc: '物攻 +110，暴击 +25%' },
  vamp:   { name: '嗜血镰',   cost: 1800, type: 'atk', ad: 90, lifesteal: 0.2, desc: '物攻 +90，吸血 +20%' },
  pierce: { name: '破甲锥',   cost: 2050, type: 'atk', ad: 80, pen: 0.35, cdr: 0.05, desc: '物攻 +80，物理穿透 +35%' },
  axe:    { name: '战神斧',   cost: 1950, type: 'atk', ad: 80, hp: 500, cdr: 0.1, desc: '物攻 +80，生命 +500，冷却 -10%' },

  tome:   { name: '回响法杖', cost: 1900, type: 'mag', ap: 200, cdr: 0.05, desc: '法攻 +200，冷却 -5%' },
  crown:  { name: '虚空之冠', cost: 2250, type: 'mag', ap: 240, mpen: 0.35, desc: '法攻 +240，法术穿透 +35%' },
  grail:  { name: '圣泉杯',   cost: 1750, type: 'mag', ap: 150, mp: 500, mpRegen: 10, cdr: 0.15, desc: '法攻 +150，法力 +500，冷却 -15%' },
  hat:    { name: '博学之帽', cost: 2300, type: 'mag', ap: 300, desc: '法攻 +300' },
  mask:   { name: '噬魂面具', cost: 1950, type: 'mag', ap: 140, hp: 700, desc: '法攻 +140，生命 +700' },

  plate:  { name: '守护铠甲', cost: 1850, type: 'def', armor: 250, hp: 900, desc: '物防 +250，生命 +900' },
  cloak:  { name: '魔女披风', cost: 1900, type: 'def', mr: 230, hp: 900, hpRegen: 20, desc: '法防 +230，生命 +900' },
  giant:  { name: '霸者重装', cost: 2100, type: 'def', hp: 2200, hpRegen: 40, desc: '生命 +2200，每秒回血 +40' },
  thorn:  { name: '荆棘甲',   cost: 1800, type: 'def', armor: 300, ad: 40, desc: '物防 +300，物攻 +40' },
};

/** 每个英雄的推荐出装顺序（电脑按这个买；玩家的“快捷购买”也按这个推荐） */
export const BUILDS = {
  panyue:  ['boots', 'plate', 'cloak', 'giant', 'thorn', 'axe'],
  liefeng: ['boots', 'axe', 'blade', 'plate', 'vamp', 'cloak'],
  yesun:   ['boots', 'blade', 'pierce', 'crit', 'vamp', 'axe'],
  xinglan: ['boots', 'tome', 'grail', 'crown', 'hat', 'mask'],
  lingyu:  ['boots', 'bow', 'crit', 'vamp', 'pierce', 'blade'],
};

export const MAX_ITEMS = 6;

/** 装备分类的显示名 */
export const ITEM_TYPES = { move: '移动', atk: '攻击', mag: '法术', def: '防御' };
