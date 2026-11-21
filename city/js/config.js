// 落日湾：数值表。载具、武器、通缉、人物的参数都在这里，调手感主要改这个文件。

/** 逻辑帧率 */
export const TICK = 30;

/**
 * 载具参数。cls 决定用哪套物理：car 汽车 / bike 摩托 / boat 船 / plane 飞机 / heli 直升机 / tank 坦克。
 * len 长、wid 宽、hgt 高（米）；hp 耐久；max 最高速度（米/秒）；rev 倒车最高速度；accel 加速度；brake 刹车；
 * steer 转向速度（弧度/秒）；grip 抓地力（越小越容易甩尾）；mass 相对质量（撞车时谁推谁）。
 * 直升机复用飞机的数值：max/accel/brake/steer/grip/hp 与飞机相同，升限 420 米与飞机相同（见 vehicles.js），
 * 垂直速度上限复用 accel（13 米/秒）；rev 复用汽车的 9（后退速度）。
 */
const car = (o) => ({ cls: 'car', len: 4.4, wid: 1.9, hgt: 1.45, hp: 320, max: 36, rev: 9, accel: 11, brake: 24, steer: 2.3, grip: 6.5, mass: 1, ...o });
export const VEH = {
  sedan:  car({ name: '轿车' }),
  taxi:   car({ name: '出租车' }),
  sports: car({ name: '跑车', max: 56, accel: 19, grip: 8, hgt: 1.2, hp: 260 }),
  pickup: car({ name: '皮卡', max: 30, accel: 9, len: 5.2, wid: 2.1, hgt: 1.8, hp: 480, mass: 1.6 }),
  police: car({ name: '警车', max: 46, accel: 15, hp: 420 }),
  target: car({ name: '靶车', hp: 260 }),
  bike:   { cls: 'bike', name: '摩托车', len: 2.2, wid: 0.8, hgt: 1.2, hp: 160, max: 54, rev: 5, accel: 21, brake: 26, steer: 2.8, grip: 9, mass: 0.35 },
  boat:   { cls: 'boat', name: '快艇', len: 6.5, wid: 2.4, hgt: 1.4, hp: 400, max: 30, rev: 6, accel: 9, brake: 4, steer: 1.5, grip: 1.6, mass: 1 },
  plane:  { cls: 'plane', name: '螺旋桨飞机', len: 8, wid: 10, hgt: 2.6, hp: 300, max: 78, rev: 0, accel: 13, brake: 14, steer: 1.1, grip: 5, takeoff: 30, stall: 24, mass: 1 },
  heli:   { cls: 'heli', name: '直升机', len: 7.5, wid: 2.6, hgt: 2.8, hp: 300, max: 78, rev: 9, accel: 13, brake: 14, steer: 1.1, grip: 5, mass: 1 },
  tank:   { cls: 'tank', name: '坦克', len: 7, wid: 3.6, hgt: 2.6, hp: 4000, max: 15, rev: 7, accel: 7, brake: 20, steer: 1.2, grip: 12, mass: 20, reload: 0.1 },   // 坦克炮间隔 0.1 秒，和冲锋枪一样（2026-11-21，原来是 1.4 秒）
};

/** 路上随机出现的车型和比例 */
export const TRAFFIC_MIX = [['sedan', 46], ['taxi', 12], ['pickup', 16], ['sports', 10], ['bike', 10], ['police', 6]];

/** 车身颜色 */
export const CAR_COLORS = [0xd94b3d, 0x3b78d8, 0xe8e8e8, 0x2f3540, 0x3fae6a, 0xe0a030, 0x8a5cc8, 0x9aa4b0];

/**
 * 武器。melee 近战；dmg 单发伤害；rate 每秒发数；range 射程；spread 散布（弧度）；pellets 一次打出的弹丸数；
 * explosive 是否爆炸物（radius 爆炸半径、speed 飞行速度）。
 * 射速统一 10 发/秒（2026-11-21：原来拳头 2.2、手枪 3.2、霰弹枪 1.3、火箭筒 0.55，全部改成和冲锋枪一样）；
 * 伤害、射程、爆炸半径、速度、弹药数都不动。
 */
export const WEAPONS = [
  { id: 'fist',    name: '拳头',   melee: true, dmg: 14, rate: 10, range: 2.0 },
  { id: 'pistol',  name: '手枪',   dmg: 22, rate: 10, range: 55, spread: 0.02 },
  { id: 'smg',     name: '冲锋枪', dmg: 13, rate: 10, range: 50, spread: 0.05 },
  { id: 'shotgun', name: '霰弹枪', dmg: 11, pellets: 7, rate: 10, range: 24, spread: 0.11 },
  { id: 'rocket',  name: '火箭筒', dmg: 320, rate: 10, range: 130, explosive: true, radius: 7, speed: 55 },
];
export const WEAPON_INDEX = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

/**
 * 每种武器的初始子弹数（拳头无限）。出生和子弹打空自动补满都补到这个数。
 * 手枪 80 是原来的出生子弹数；冲锋枪 150、霰弹枪 24、火箭筒 6 与 sim.js 里拾取武器的补给量相同。
 */
export const AMMO = [Infinity, 80, 150, 24, 6];

/** 玩家 */
export const PLAYER = { speed: 6.5, swim: 2.6, radius: 0.45, hp: 100, enterDist: 4.2, pickupDist: 1.8 };

/** 行人与警察 */
export const PED = { walk: 1.5, run: 5.6, hp: 40, count: 36, spawnMin: 45, spawnMax: 110, despawn: 150 };   // 平民行人上限 36（2026-11-21 从 18 翻倍；渲染 MAX_PED 是 48，不用改）
export const COP = {
  hp: [0, 70, 70, 90, 120, 150],            // 各星级警察的生命
  dmg: [0, 5, 5, 6, 5, 8],                  // 单发伤害
  rate: [0, 1.2, 1.2, 1.6, 4, 3],           // 每秒开火次数（4 星起用冲锋枪）
  count: [0, 2, 4, 6, 8, 10],               // 同时追捕的警察人数上限
  cars: [0, 1, 2, 3, 3, 4],                 // 同时出动的警车上限
  range: 38, speed: 5.2,
};

/** 通缉：每项罪行增加的“热度”，热度每满 1 就是一颗星，最多 5 星 */
export const CRIME = { punch: 0.35, hurtPed: 0.5, killPed: 1, carjack: 0.6, gunfire: 0.25, hurtCop: 1.2, killCop: 2, wreck: 0.8, stealPolice: 2, stealTank: 3 };
export const WANTED = { evade: 13, seeRange: 75, spawnEvery: 3.5 };

/** 交通 */
export const TRAFFIC = { count: 12, spawnMin: 90, spawnMax: 190, despawn: 240, speed: 13, lane: 3.4 };
