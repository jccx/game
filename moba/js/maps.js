// 裂谷争锋：三种模式的地图数据。
// 坐标系：x 向右，z 向下（朝镜头）。蓝方基地在左下，红方在右上（5v5）或右侧（单路）。
// 地图由“数据”描述：兵线路径、塔位、墙（胶囊形障碍）、野怪营地。场景和碰撞都由这些数据生成，
// 所以改地图只需要改这里。

/** 沿折线按“已走距离”取点，同时返回该处的前进方向 */
export function pointAlong(pts, d) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (d <= l || i === pts.length - 2) {
      const t = Math.min(1, d / l);
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / l, dz: (bz - az) / l };
    }
    d -= l;
  }
  return null;
}

/** 折线总长 */
export function pathLength(pts) {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return s;
}

/**
 * 给一条兵线放塔：dists 是蓝方各层塔离蓝方水晶的距离（按层级 3、2、1 的顺序），红方自动对称。
 * 塔放在兵线中线旁边 side 个单位处，小兵从塔旁经过，不会被卡住。
 */
function laneTowers(lane, laneIdx, dists, side = 3.6) {
  const out = [];
  const L = pathLength(lane);
  dists.forEach((d, i) => {
    const tier = dists.length - i;                      // 离基地最近的是最高层
    const b = pointAlong(lane, d), r = pointAlong(lane, L - d);
    out.push({ team: 0, lane: laneIdx, tier, x: b.x - b.dz * side, z: b.z + b.dx * side });
    out.push({ team: 1, lane: laneIdx, tier, x: r.x + r.dz * side, z: r.z - r.dx * side });
  });
  return out;
}

/* ---------------------------------------------------------------- 5v5 三路 */
function map5v5() {
  const S = 170;
  // 两种对称变换：m1 沿中路镜像（上半野区 → 下半野区），m2 绕中心旋转 180°（蓝方 → 红方）
  const m1 = ([x, z]) => [S - z, S - x];
  const m2 = ([x, z]) => [S - x, S - z];
  const wall4 = (w) => {
    const a = [w[0], w[1]], b = [w[2], w[3]], r = w[4];
    return [[a, b], [m1(a), m1(b)], [m2(a), m2(b)], [m2(m1(a)), m2(m1(b))]].map(([p, q]) => [p[0], p[1], q[0], q[1], r]);
  };

  const lanes = [
    { name: '上路', pts: [[20, 150], [17, 115], [17, 45], [25, 25], [45, 17], [115, 17], [150, 20]] },
    { name: '中路', pts: [[20, 150], [48, 122], [85, 85], [122, 48], [150, 20]] },
    { name: '下路', pts: [[20, 150], [55, 153], [125, 153], [145, 145], [153, 125], [153, 55], [150, 20]] },
  ];

  // 蓝方上半野区的墙（[x1, z1, x2, z2, 半径]），其余三个野区由对称得到
  const quad = [
    [29, 125, 29, 101, 2.6],   // 贴着上路的墙，留两个入口
    [29, 92, 29, 67, 2.6],
    [29, 58, 30, 45, 2.6],
    [35, 121, 47, 109, 2.6],   // 贴着中路的墙
    [53, 103, 66, 90, 2.6],
    [33, 46, 45, 58, 2.6],     // 贴着河道的墙
    [52, 65, 63, 76, 2.6],
    [40, 90, 45, 78, 4.2],     // 野区中央的大石堆
  ];
  const walls = quad.flatMap(wall4);

  // 营地：蓝方上半野区 3 个，对称出 12 个；河道两头各一只巨灵
  const camp4 = (kindA, kindB, p) => [
    { kind: kindA, x: p[0], z: p[1], side: 0 },
    { kind: kindB, x: m1(p)[0], z: m1(p)[1], side: 0 },
    { kind: kindA, x: m2(p)[0], z: m2(p)[1], side: 1 },
    { kind: kindB, x: m2(m1(p))[0], z: m2(m1(p))[1], side: 1 },
  ];
  const camps = [
    ...camp4('blue', 'red', [38, 63]),
    ...camp4('small', 'small', [54, 84]),
    ...camp4('small', 'small', [37, 107]),
    { kind: 'boss', x: 52, z: 52, side: 2 },
    { kind: 'boss', x: 118, z: 118, side: 2 },
  ];

  const towers = [
    ...laneTowers(lanes[0].pts, 0, [24, 56, 92]),
    ...laneTowers(lanes[1].pts, 1, [24, 49, 73]),
    ...laneTowers(lanes[2].pts, 2, [24, 56, 92], -3.6),
  ];

  return {
    id: '5v5', name: '5v5 三路', size: [S, S], teamSize: 5, lanes, walls, camps, towers,
    teams: [{ crystal: [20, 150], spawn: [8, 162] }, { crystal: [150, 20], spawn: [162, 8] }],
    river: [[14, 14], [52, 52], [85, 85], [118, 118], [156, 156]],
    laneWidth: 13, riverWidth: 12,
    // 各定位去哪条路：战士上路、法师中路、射手和坦克下路、刺客打野
    roleLane: { fighter: 0, mage: 1, marksman: 2, tank: 2, assassin: -1 },
    cam: { dist: 41 },
  };
}

/* ---------------------------------------------------------------- 3v3 单路 */
function map3v3() {
  const W = 124, H = 60;
  const lanes = [{ name: '中路', pts: [[14, 30], [110, 30]] }];
  const walls = [];
  // 上下两道山脊把兵线和野区通道隔开，各留两个缺口
  for (const z of [17.5, 42.5]) {
    walls.push([27, z, 44, z, 2.5], [53, z, 71, z, 2.5], [80, z, 97, z, 2.5]);
  }
  const camps = [
    { kind: 'small', x: 40, z: 8.5, side: 0 }, { kind: 'small', x: 84, z: 8.5, side: 1 },
    { kind: 'small', x: 40, z: 51.5, side: 0 }, { kind: 'small', x: 84, z: 51.5, side: 1 },
    { kind: 'red', x: 62, z: 8.5, side: 2 },
    { kind: 'boss', x: 62, z: 51.5, side: 2 },
  ];
  return {
    id: '3v3', name: '3v3 单路', size: [W, H], teamSize: 3, lanes, walls, camps,
    towers: laneTowers(lanes[0].pts, 0, [16, 32]),
    teams: [{ crystal: [14, 30], spawn: [5, 30] }, { crystal: [110, 30], spawn: [119, 30] }],
    river: [[62, 2], [62, 58]],
    laneWidth: 15, riverWidth: 9,
    roleLane: { fighter: 0, mage: 0, marksman: 0, tank: 0, assassin: 0 },
    cam: { dist: 39 },
  };
}

/* ---------------------------------------------------------------- 1v1 单挑 */
function map1v1() {
  const W = 92, H = 44;
  const lanes = [{ name: '中路', pts: [[13, 22], [79, 22]] }];
  const walls = [
    [16, 8, 76, 8, 2.6], [16, 36, 76, 36, 2.6],   // 上下两道长墙围出一条通道
  ];
  return {
    id: '1v1', name: '1v1 单挑', size: [W, H], teamSize: 1, lanes, walls, camps: [],
    towers: laneTowers(lanes[0].pts, 0, [17]),
    teams: [{ crystal: [13, 22], spawn: [5, 22] }, { crystal: [79, 22], spawn: [87, 22] }],
    river: [[46, 2], [46, 42]],
    laneWidth: 17, riverWidth: 8,
    roleLane: { fighter: 0, mage: 0, marksman: 0, tank: 0, assassin: 0 },
    cam: { dist: 38 },
  };
}

export const MODES = [
  { id: '5v5', name: '5v5 三路', desc: '三条兵线加野区，五打五，最接近经典玩法', time: '约 15–20 分钟' },
  { id: '3v3', name: '3v3 单路', desc: '一条兵线、小野区，三打三，节奏快', time: '约 10 分钟' },
  { id: '1v1', name: '1v1 单挑', desc: '一条兵线一座塔，一对一单挑', time: '约 5 分钟' },
];

/** 按模式 id 生成地图数据 */
export function makeMap(id) {
  return id === '3v3' ? map3v3() : id === '1v1' ? map1v1() : map5v5();
}
