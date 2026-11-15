// 豆兵大战：数值表。武器、物理、回合规则都在这里，调平衡主要改这个文件。
// 长度单位是像素（世界坐标），时间单位是秒。

export const TICK = 60;
export const WORLD = { w: 1700, h: 760, water: 724 };      // 世界大小和水面高度

export const PHYS = {
  gravity: 640,
  walk: 62,             // 走路速度
  climb: 3,             // 每走一步最多能爬高几个像素（坡再陡就走不上去）
  jump: [100, -235],    // 向前跳的初速度 [水平, 垂直]
  flip: [-48, -335],    // 后空翻
  radius: 9,            // 豆兵的半径
  fallSafe: 430,        // 落地速度超过这个值开始摔伤
  wind: 150,            // 风力满格时对炮弹的水平加速度
};

export const RULES = { turnTime: 30, retreat: 3, hp: 100 };

/**
 * 武器表。
 * kind：shell 炮弹（撞到就炸，受风影响）/ bomb 手雷类（会弹跳，按引信时间爆炸）/ gun 即时命中 /
 *       strike 空袭（点地图选位置）/ drop 放在脚下 / melee 近战 / move 传送（点地图选位置）
 * power：是否需要拉弹弓蓄力；r 爆炸半径；dmg 伤害；ammo 弹药（Infinity 为无限）
 */
export const WEAPONS = [
  { id: 'bazooka', name: '火箭筒', icon: '🚀', kind: 'shell', power: true, speed: 760, r: 44, dmg: 46, ammo: Infinity, desc: '受风影响，撞到就炸' },
  { id: 'grenade', name: '手雷', icon: '💣', kind: 'bomb', power: true, speed: 640, r: 44, dmg: 50, fuse: 3, ammo: Infinity, desc: '会弹跳，3 秒后爆炸，不受风影响' },
  { id: 'shotgun', name: '霰弹枪', icon: '🔫', kind: 'gun', power: false, r: 14, dmg: 24, shots: 2, range: 520, ammo: Infinity, desc: '一回合可以开两枪' },
  { id: 'cluster', name: '集束弹', icon: '🎆', kind: 'bomb', power: true, speed: 640, r: 30, dmg: 28, fuse: 2.4, split: 5, ammo: 3, desc: '爆炸后分裂成五颗小炸弹' },
  { id: 'strike', name: '空袭', icon: '✈️', kind: 'strike', power: false, r: 34, dmg: 34, count: 5, ammo: 1, desc: '点地图选位置，五枚导弹从天而降' },
  { id: 'dynamite', name: '炸药', icon: '🧨', kind: 'drop', power: false, r: 66, dmg: 78, fuse: 4, ammo: 2, desc: '放在脚下，4 秒后大爆炸，放完快跑' },
  { id: 'punch', name: '重拳', icon: '🥊', kind: 'melee', power: false, dmg: 30, ammo: Infinity, desc: '把贴身的敌人打飞' },
  { id: 'teleport', name: '传送', icon: '✨', kind: 'move', power: false, ammo: 2, desc: '点地图上的空地，瞬间移动过去' },
];
export const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** 队伍的名字和颜色（第一队是玩家） */
export const TEAMS = [
  { name: '黄豆队', color: '#f2c230', dark: '#a87a10', names: ['阿黄', '豆包', '金粒', '小圆', '麦麦'] },
  { name: '红豆队', color: '#e2523f', dark: '#96281c', names: ['赤赤', '火火', '枣枣', '朱朱', '丹丹'] },
  { name: '绿豆队', color: '#52b85a', dark: '#2c7a34', names: ['青青', '芽芽', '翠翠', '苗苗', '葱葱'] },
  { name: '蓝豆队', color: '#4a8fe8', dark: '#255aa8', names: ['海海', '冰冰', '蓝蓝', '湖湖', '波波'] },
];

/** 难度：瞄准误差（弧度）、力度误差、思考时间 */
export const DIFFICULTY = [
  { name: '简单', aim: 0.2, pow: 0.12, think: 1.6 },
  { name: '普通', aim: 0.085, pow: 0.05, think: 1.2 },
  { name: '困难', aim: 0.025, pow: 0.015, think: 0.9 },
];

/** 地形主题：土的颜色、草的颜色、天空、远山、水 */
export const THEMES = [
  { id: 'meadow', name: '草原', soil: [0x8a5a34, 0x5a3820], top: 0x5fb848, sky: ['#6fc4ff', '#d8f2ff'], hill: '#9ad0a8', water: '#3a8fd0' },
  { id: 'desert', name: '沙丘', soil: [0xd8a858, 0xa87838], top: 0xf0d088, sky: ['#ffb870', '#fff0c8'], hill: '#e8c088', water: '#3aa0b8' },
  { id: 'snow', name: '雪原', soil: [0x8fa8c0, 0x5a7890], top: 0xf4f8ff, sky: ['#8fb4e8', '#e8f2ff'], hill: '#c8d8ec', water: '#4a88c8' },
];
