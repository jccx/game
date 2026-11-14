// 疾风卡丁：赛道数据。每条赛道是一圈闭合的中心线（若干控制点，程序自动连成平滑曲线）加上宽度和主题。
// 改赛道只要改控制点；新增赛道就在 TRACKS 里加一项。坐标单位是米，x 向右、z 向下。

export const TRACKS = [
  {
    id: 'forest', name: '森林环道', desc: '宽阔平顺，适合练漂移', theme: 'forest', width: 17,
    pts: [[0, 0], [70, -4], [128, -30], [150, -85], [120, -140], [60, -150], [30, -110], [-10, -100], [-50, -130], [-110, -120], [-135, -65], [-105, -15], [-55, 2]],
    boxes: [0.12, 0.42, 0.72],
  },
  {
    id: 'desert', name: '沙漠峡谷', desc: '连续发卡弯，考验刹车点', theme: 'desert', width: 15,
    pts: [[0, 0], [80, 0], [130, -25], [135, -75], [95, -95], [55, -70], [20, -90], [35, -140], [100, -160], [150, -200], [110, -240], [30, -230], [-40, -200], [-70, -140], [-45, -95], [-90, -60], [-120, -15], [-70, 5]],
    boxes: [0.1, 0.33, 0.58, 0.82],
  },
  {
    id: 'ice', name: '冰雪港湾', desc: '路面很滑，漂移更远也更难收', theme: 'ice', width: 18, grip: 0.62,
    pts: [[0, 0], [90, 5], [150, -30], [160, -100], [120, -150], [60, -150], [15, -185], [-45, -205], [-110, -170], [-135, -105], [-105, -65], [-128, -30], [-105, 2], [-55, 6]],
    boxes: [0.15, 0.48, 0.78],
  },
];

/**
 * 把控制点连成平滑的闭合曲线，并按约 2 米一段取样。
 * 返回 { def, s: 取样点数组, n, length, half }；每个取样点有：
 *   x, z 位置；tx, tz 前进方向；nx, nz 左手边方向；d 从起点算起的距离；k 弯曲程度（带正负号，正为左弯）
 */
export function buildTrack(def) {
  const P = def.pts, n = P.length, raw = [];
  const cr = (p0, p1, p2, p3, t) => {      // Catmull-Rom 样条
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
    for (let k = 0; k < 40; k++) { const t = k / 40; raw.push([cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t)]); }
  }
  // 重新按等间距取样
  let total = 0; const cum = [0];
  for (let i = 0; i < raw.length; i++) { const q = raw[(i + 1) % raw.length]; total += Math.hypot(q[0] - raw[i][0], q[1] - raw[i][1]); cum.push(total); }
  const N = Math.round(total / 2), s = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = (i / N) * total;
    while (cum[j + 1] < d) j++;
    const a = raw[j % raw.length], b = raw[(j + 1) % raw.length], t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    s.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, d });
  }
  for (let i = 0; i < N; i++) {
    const a = s[(i + N - 1) % N], b = s[(i + 1) % N], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    s[i].tx = (b.x - a.x) / l; s[i].tz = (b.z - a.z) / l;
    s[i].nx = s[i].tz; s[i].nz = -s[i].tx;       // 左手边：前进方向逆时针转 90 度（俯视、z 向下）
  }
  for (let i = 0; i < N; i++) {
    const a = s[(i + N - 2) % N], b = s[(i + 2) % N];
    let da = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
    if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
    s[i].k = da / 8;                              // 每米转过的弧度
  }
  return { def, s, n: N, length: total, half: def.width / 2 };
}
