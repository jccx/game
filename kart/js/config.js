// 疾风卡丁：数值表。调手感、道具、难度主要改这里。

/** 逻辑帧率 */
export const TICK = 60;

/** 卡丁车的参数（速度单位：米/秒） */
export const KART = {
  max: 34,            // 正常最高速度
  accel: 15,          // 加速度
  brake: 30,          // 刹车
  reverse: 8,         // 倒车最高速度
  drag: 6,            // 松油门时的减速
  steer: 1.75,        // 转向速度（弧度/秒）
  grip: 9,            // 抓地力：越大车越“跟手”
  radius: 1.25,       // 碰撞半径
  // 漂移
  driftMinSpeed: 13,  // 多快才能起漂
  driftTurn: 1.3,     // 漂移时的基础转向速度
  driftSteer: 0.85,   // 漂移中打方向带来的额外转向
  driftGrip: 2.4,     // 漂移时的抓地力
  driftSlide: 0.42,   // 漂移时车身侧过来的角度（弧度）
  miniBoost: [[0.7, 0.55], [1.5, 1.0], [2.6, 1.5]],   // [漂移攒到多少, 松开后加速几秒]：蓝、橙、紫三档
  gaugeRate: 0.17,    // 漂移时每秒攒多少氮气槽（攒满 1 得一瓶）
  // 氮气
  boostMul: 1.4, boostAccel: 34, nitroTime: 2.6, nitroMax: 2,
  wallLoss: 0.965,    // 蹭墙时每帧保留的速度比例
  spinTime: 1.3,      // 中了道具打转的时间
};

/** 道具。weight 是抽中的权重；名次越靠后越容易抽到好东西（见 race.js 的 rollItem） */
export const ITEMS = {
  banana:  { name: '香蕉皮', icon: '🍌', weight: 30, desc: '丢在身后，谁压到谁打转' },
  missile: { name: '导弹',   icon: '🚀', weight: 24, desc: '追着前面一名的车飞过去' },
  shield:  { name: '护盾',   icon: '🛡️', weight: 18, desc: '6 秒内不怕道具' },
  nitro:   { name: '氮气',   icon: '🔥', weight: 28, desc: '直接得到一瓶氮气' },
};

/** 难度：电脑车的速度范围（相对最高速度的比例）和犯错概率 */
export const DIFFICULTY = [
  { name: '简单', lo: 0.80, hi: 0.90, item: 0.5 },
  { name: '普通', lo: 0.88, hi: 0.97, item: 0.8 },
  { name: '困难', lo: 0.95, hi: 1.03, item: 1.0 },
];

export const LAPS = 3;
export const RACERS = 8;

/** 车手的名字和配色（第一个是玩家） */
export const DRIVERS = [
  { name: '你', color: 0xf5c518 }, { name: '小闪', color: 0xe04b3d }, { name: '阿蓝', color: 0x3b7be0 }, { name: '青柠', color: 0x4fc26a },
  { name: '紫电', color: 0x9a5be0 }, { name: '橘子', color: 0xf08a2e }, { name: '雪球', color: 0xe8eef6 }, { name: '墨鱼', color: 0x3a4250 },
];
