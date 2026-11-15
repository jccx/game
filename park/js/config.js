// 梦想乐园：数值表。地图、造价、设施、门票、贷款、天气、研究都在这里，调平衡主要改这个文件。
// 时间单位是秒（游戏内），距离单位是格子（1 格 = 4 世界单位）。

/** 逻辑帧率 */
export const TICK = 30;

/** 地图：宽 24 格、深 18 格，每格 4 世界单位 */
export const GRID = { w: 24, d: 18, tile: 4 };
/** 入口：南边中间两格是入口大门，北边一格是入口广场 */
export const ENTRANCE = { x: 11, z: 17, w: 2 };
/** 一天 = 120 游戏秒；5 天 = 1 个月（贷款按月计息） */
export const DAY_LEN = 120;
export const DAYS_PER_MONTH = 5;

/** 开局方案：起始资金、口碑、游客钱包 */
export const SCENARIOS = [
  { id: 'meadow', name: '青青草地', desc: '平坦空地，资金充裕，适合新手', money: 20000, reputation: 50, wallet: [30, 90] },
  { id: 'hill', name: '小山坡', desc: '资金紧张，口碑一般，考验经营', money: 12000, reputation: 45, wallet: [25, 70] },
  { id: 'resort', name: '度假小镇', desc: '游客有钱但挑剔，口碑起点高', money: 16000, reputation: 62, wallet: [50, 120] },
];

/** 难度：游客生成倍率、维护费倍率 */
export const DIFFICULTY = [
  { id: 'easy', name: '简单', spawn: 1.25, upkeep: 0.8 },
  { id: 'normal', name: '普通', spawn: 1, upkeep: 1 },
  { id: 'hard', name: '困难', spawn: 0.8, upkeep: 1.25 },
];

/** 铺路 */
export const PATH = { cost: 20, name: '铺路' };

/**
 * 游乐设施表。
 * w/d：占地（格）；cost：造价；capacity：一次能载几人；thrill：刺激度 0~10；
 * upkeep：每天维护费；price：每次乘坐票价；duration：乘坐时长（秒）；tier：1 初始可建，2 要研究解锁。
 */
export const RIDES = [
  { id: 'carousel', name: '旋转木马', icon: '🎠', w: 2, d: 2, cost: 1500, capacity: 8, thrill: 3, upkeep: 40, price: 8, duration: 20, tier: 1, color: 0xe86a8a, desc: '温和经典，全家都爱坐' },
  { id: 'wheel', name: '摩天轮', icon: '🎡', w: 3, d: 3, cost: 5000, capacity: 12, thrill: 4, upkeep: 120, price: 15, duration: 30, tier: 1, color: 0x4a8fe8, desc: '慢慢转一圈，看遍整个乐园' },
  { id: 'bumper', name: '碰碰车', icon: '🚗', w: 3, d: 2, cost: 2500, capacity: 6, thrill: 6, upkeep: 60, price: 10, duration: 15, tier: 1, color: 0xf08a2e, desc: '撞来撞去，刺激又好玩' },
  { id: 'pirate', name: '海盗船', icon: '🏴‍☠️', w: 3, d: 2, cost: 4000, capacity: 10, thrill: 8, upkeep: 90, price: 14, duration: 25, tier: 2, color: 0x8a5a3a, desc: '越荡越高，尖叫不断' },
  { id: 'coaster', name: '过山车', icon: '🎢', w: 2, d: 2, cost: 6000, capacity: 8, thrill: 10, upkeep: 150, price: 20, duration: 20, tier: 2, color: 0xe24b4b, desc: '自己搭轨道，闭环才能开' },
];

/** 商店和厕所 */
export const SHOPS = [
  { id: 'snack', name: '小吃摊', icon: '🍿', kind: 'shop', w: 1, d: 1, cost: 600, capacity: 4, upkeep: 20, price: 12, duration: 8, tier: 1, color: 0xf2c230, desc: '饿了就来一份，解馋' },
  { id: 'drink', name: '饮料摊', icon: '🥤', kind: 'shop', w: 1, d: 1, cost: 500, capacity: 4, upkeep: 15, price: 8, duration: 6, tier: 1, color: 0x4ab8ff, desc: '渴了喝一杯，解渴' },
  { id: 'gift', name: '礼品店', icon: '🎁', kind: 'shop', w: 1, d: 1, cost: 900, capacity: 4, upkeep: 25, price: 18, duration: 10, tier: 1, color: 0x9a5be0, desc: '带个纪念品回家' },
  { id: 'toilet', name: '厕所', icon: '🚻', kind: 'toilet', w: 1, d: 1, cost: 800, capacity: 2, upkeep: 30, price: 0, duration: 10, tier: 1, color: 0x7a8a99, desc: '保持乐园干净，口碑就靠它' },
];
export const BUILDINGS = [...RIDES, ...SHOPS];
export const BUILDING = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

/** 门票：默认 10 元，上限 50；研究“高级票价”后上限 80 */
export const TICKET = { def: 10, min: 0, max: 50, maxResearched: 80 };

/** 贷款：每次最多借 5000，总额上限 20000，月息 5%，破产线 -5000 */
export const LOAN = { chunk: 5000, max: 20000, monthlyRate: 0.05, bankrupt: -5000 };

/** 研究：花钱解锁二阶设施和更高票价上限 */
export const RESEARCH = [
  { id: 'pirate', name: '海盗船图纸', cost: 3000, unlocks: 'pirate', desc: '解锁建造海盗船' },
  { id: 'coaster', name: '过山车图纸', cost: 5000, unlocks: 'coaster', desc: '解锁建造过山车站台' },
  { id: 'ticket', name: '高级票价', cost: 2000, unlocks: 'ticket', desc: '门票上限提高到 80 元' },
];

/** 天气：生成倍率（游客多少）和游乐设施人气倍率 */
export const WEATHER = {
  sunny: { name: '晴', icon: '☀️', spawn: 1, ride: 1, desc: '阳光明媚，游客最多' },
  cloudy: { name: '多云', icon: '⛅', spawn: 0.85, ride: 0.95, desc: '天有点阴，游客稍少' },
  rainy: { name: '下雨', icon: '🌧️', spawn: 0.55, ride: 0.7, desc: '下雨了，游客少了很多' },
};
export const WEATHER_ORDER = ['sunny', 'cloudy', 'rainy'];

/** 过山车轨道：每段造价，速度和刺激度的算法系数 */
export const COASTER = {
  segmentCost: 300, minSegments: 4,
  baseSpeed: 8, dropSpeed: 4, turnSpeed: -1.5, minSpeed: 4, maxSpeed: 30,
  baseThrill: 4, dropThrill: 1.5, turnThrill: 0.8, lengthThrill: 0.15, maxThrill: 10,
};

/** 游客：钱包、心情、饥饿、走路速度、最多同时在园人数 */
export const VISITOR = {
  walletMin: 30, walletMax: 90, moodMin: 55, moodMax: 85,
  walkSpeed: 1.3, maxInPark: 60, baseSpawnEvery: 6,
  hungerRate: 0.25, moodDecay: 0.05,
};

/** 拆除返还比例 */
export const DEMOLISH_REFUND = 0.3;
