// 落日湾：载具的物理。五类载具各一套简化的“街机式”物理：汽车/摩托/坦克在地面上跑，船在水上漂，飞机能起降。
// 朝向约定：yaw 是弧度，车头方向为 (sin yaw, cos yaw)；右手边为 (-cos yaw, sin yaw)；向右转时 yaw 减小。
import { VEH } from './config.js';
import { clamp } from '../../shared/js/util.js';
import { terrainY, SIZE } from './world.js';

let VID = 1;
const P = { x: 0, z: 0 };       // 碰撞检测用的临时点

export class Vehicle {
  /**
   * @param {object} sim  对局（用来查询地形、发事件、制造爆炸）
   * @param {string} type 车型，见 config.js 的 VEH
   */
  constructor(sim, type, x, z, yaw = 0, color = 0xd0d0d0) {
    this.sim = sim; this.id = VID++; this.type = type; this.spec = VEH[type]; this.color = color;
    this.x = x; this.z = z; this.yaw = yaw; this.y = this.spec.cls === 'boat' ? 0 : sim.world.groundY(x, z);
    this.px = x; this.py = this.y; this.pz = z; this.pyaw = yaw;      // 上一逻辑帧的状态，渲染时插值
    this.pitch = 0; this.roll = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.speed = 0;            // speed：沿车头方向的速度（倒车为负）
    this.air = 0;                                                     // 空中速度：飞机和直升机共用（直升机悬停时为 0）
    this.steer = 0;                                                    // 平滑后的转向输入
    this.hp = this.spec.hp;
    this.radius = Math.max(this.spec.len * 0.4, this.spec.wid * 0.55); // 车与车、车与人碰撞用的圆
    this.driver = null;          // null / 'player' / 'npc'
    this.ai = null;              // 电脑驾驶的状态（交通、警车追捕）；停着的车为 null
    this.alive = true;           // false：已炸毁或沉没
    this.burning = false; this.burnT = 0;
    this.wreck = false; this.sunk = false; this.goneT = 0;
    this.flying = false;         // 飞机是否在空中
    this.roofY = null;           // 直升机停在楼顶时记下屋顶高度，地面分支就贴着屋顶而不是贴着地面
    this.roofB = null;           // 停的是哪栋楼（楼被炸掉时屋顶就没了，直升机要落回地面）
    this.gunCd = 0;              // 坦克炮的冷却
    this.used = false;           // 玩家开过的车不会被随便回收
    this.siren = false;
    this.byPlayer = false;       // 最近一次伤害是否来自玩家（决定爆炸算不算玩家的罪行）
    this.mission = false;        // 任务用车不回收
    this.stuckT = 0;
  }

  /** 还能不能上车 */
  get usable() { return this.alive && !this.burning; }

  /** 受到伤害。耐久归零后先起火，几秒后爆炸。主角当前坐着的车只在无敌开着时无敌（和主角无敌同一个开关，见 Sim.godOn）：无敌关了，火箭弹、坦克炮、爆炸、撞车照常掉血、照常炸 */
  damage(n, byPlayer = false) {
    if (!this.alive || n <= 0) return;
    if (this.driver === 'player' && this.sim.godOn()) return;   // 无敌开着：主角的座驾炸不坏；无敌关了照常掉血
    this.hp -= n;
    if (byPlayer) this.byPlayer = true;
    if (this.hp <= 0 && !this.burning) {
      this.hp = 0; this.burning = true; this.burnT = (this.spec.cls === 'plane' || this.spec.cls === 'heli') && this.flying ? 0.05 : 2.6;
      this.sim.emit({ type: 'burn', v: this });
      if (this.driver === 'npc') this.sim.ejectNpc(this, true);
    }
  }

  /** 每个逻辑帧调用。c：{ steer 转向 -1~1（正为右）, gas 油门 -1~1（负为刹车/倒车）, handbrake, pitch 俯仰 -1~1（飞机）, fire（坦克开炮） } */
  update(dt, c) {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw;
    if (!this.alive) { this.goneT += dt; if (this.sunk) this.y -= dt * 1.2; return; }
    if (this.gunCd > 0) this.gunCd -= dt;
    if (this.burning && (this.burnT -= dt) <= 0) { this.explode(); return; }
    const cls = this.spec.cls;
    if (cls === 'boat') this.updateBoat(dt, c);
    else if (cls === 'plane') this.updatePlane(dt, c);
    else if (cls === 'heli') this.updateHeli(dt, c);
    else this.updateGround(dt, c);
    this.x = clamp(this.x, 15, SIZE - 15); this.z = clamp(this.z, 15, SIZE - 15);
    // 冷却阈值用 1e-9 而不是 0：0.1 秒不是 3 帧的整数倍，3 帧后 gunCd 会剩约 1e-17，用 <= 0 判断会多等一帧，10 发/秒实际只有 7.5 发/秒
    if (cls === 'tank' && c.fire && this.gunCd <= 1e-9 && !this.burning) {
      this.gunCd = this.spec.reload;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      this.sim.shoot({ x: this.x + fx * 4.6, y: this.y + 2.3, z: this.z + fz * 4.6, dx: fx, dy: 0.01, dz: fz, speed: 95, range: 260, radius: 8, dmg: 520, byPlayer: this.driver === 'player', kind: 'shell', owner: this });
      this.vx -= fx * 2.5; this.vz -= fz * 2.5;         // 后坐力
    }
  }

  explode() {
    this.alive = false; this.wreck = true; this.burning = false; this.speed = 0; this.vx = this.vz = 0;
    const sim = this.sim;
    if (this.driver === 'player') sim.exitVehicle(true);
    else if (this.driver) sim.ejectNpc(this, true);
    if (this.flying) { this.flying = false; this.y = Math.max(sim.world.groundY(this.x, this.z), 0); }
    sim.explode(this.x, this.y + 1, this.z, 8, 200, this.byPlayer, this);
  }

  /** 沉入水中 */
  sink() {
    this.alive = false; this.sunk = true; this.vx = this.vz = 0; this.speed = 0;
    const sim = this.sim;
    sim.emit({ type: 'splash', x: this.x, z: this.z, big: true });
    if (this.driver === 'player') sim.exitVehicle(true);
    else if (this.driver) sim.ejectNpc(this, false);
  }

  /** 和建筑的碰撞：车头车尾各一个圆。返回最大的撞击速度 */
  hitBuildings(fx, fz) {
    const s = this.spec, w = this.sim.world, r = s.wid * 0.6, off = s.len * 0.3;
    let worst = 0;
    for (let k = 0; k < 2; k++) {
      const sg = k ? -1 : 1;
      P.x = this.x + fx * off * sg; P.z = this.z + fz * off * sg;
      const ox = P.x, oz = P.z, hit = w.collide(P, r, this.y);
      if (!hit) continue;
      this.x += P.x - ox; this.z += P.z - oz;
      const vn = this.vx * hit[0] + this.vz * hit[1];
      if (vn < 0) { this.vx -= hit[0] * vn * 1.25; this.vz -= hit[1] * vn * 1.25; if (-vn > worst) worst = -vn; }
    }
    if (worst > 4) { this.damage((worst - 4) * (s.cls === 'tank' ? 0 : 7), this.driver === 'player'); this.sim.emit({ type: 'crash', x: this.x, z: this.z, f: worst, v: this }); }
    return worst;
  }

  /* ---------------------------------------------------------- 汽车、摩托、坦克 */
  updateGround(dt, c) {
    const s = this.spec, w = this.sim.world, tank = s.cls === 'tank';
    this.steer += (c.steer - this.steer) * Math.min(1, dt * (s.cls === 'bike' ? 10 : 7));
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let vf = this.vx * fx + this.vz * fz, vs = -this.vx * fz + this.vz * fx;     // 前进方向和侧向的速度分量
    const gas = this.burning ? 0 : c.gas;
    if (gas > 0) { if (vf < s.max) vf += s.accel * gas * dt * (vf < 0 ? 1.8 : 1) * (1 - 0.55 * Math.max(0, vf) / s.max); }
    else if (gas < 0) { if (vf > 0.8) vf -= s.brake * -gas * dt; else if (vf > -s.rev) vf -= s.accel * 0.7 * -gas * dt; }
    vf -= vf * (gas === 0 ? 0.55 : 0.1) * dt;                 // 松油门时慢慢停下
    if (c.handbrake) vf -= vf * 2 * dt;
    vs *= Math.exp(-(c.handbrake ? s.grip * 0.2 : s.grip) * dt);   // 拉手刹时抓地力骤降，可以甩尾
    // 转向：速度太低转不动（坦克除外，可以原地转），速度很高时转得慢
    const sp = Math.abs(vf);
    const turn = tank ? 1 : Math.min(1, sp / 5) / (1 + sp / 40);
    this.yaw -= this.steer * s.steer * turn * dt * (vf < -0.3 && !tank ? -1 : 1);
    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
    this.vx = fx * vf - fz * vs; this.vz = fz * vf + fx * vs;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.hitBuildings(fx, fz);
    this.speed = this.vx * fx + this.vz * fz;
    // 掉进深水就沉了
    if (w.inWater(this.x, this.z) && terrainY(this.x, this.z) < -1.1) { this.sink(); return; }
    const gy = w.groundY(this.x, this.z);
    this.y += (gy - this.y) * Math.min(1, dt * 14);
    // 车身随坡度倾斜；摩托过弯时侧倾
    const sl = w.slope(this.x, this.z);
    // 约定：pitch 为正表示车头抬起，roll 为正表示向右倾
    const tp = Math.atan(sl[0] * fx + sl[1] * fz), tr = s.cls === 'bike' ? this.steer * Math.min(1, sp / 12) * 0.5 : Math.atan(sl[0] * fz - sl[1] * fx);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 8); this.roll += (tr - this.roll) * Math.min(1, dt * 8);
  }

  /* ---------------------------------------------------------- 船 */
  updateBoat(dt, c) {
    const s = this.spec, w = this.sim.world;
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 4);
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let vf = this.vx * fx + this.vz * fz, vs = -this.vx * fz + this.vz * fx;
    const afloat = terrainY(this.x, this.z) < -0.5 && !w.onPier(this.x, this.z);
    const gas = this.burning ? 0 : c.gas;
    const pw = afloat ? 1 : 0.35;                             // 搁浅时只剩一点动力，够倒回水里
    if (gas > 0) { if (vf < s.max * pw) vf += s.accel * gas * dt * pw; }
    else if (gas < 0) { if (vf > -s.rev) vf -= (vf > 0 ? s.brake + 3 : s.accel * 0.5) * -gas * dt; }
    vf -= vf * (afloat ? 0.3 : 3.5) * dt;
    vs *= Math.exp(-(afloat ? s.grip : 8) * dt);
    this.yaw -= this.steer * s.steer * Math.min(1, Math.abs(vf) / 4) * dt * (vf < -0.3 ? -1 : 1);
    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
    this.vx = fx * vf - fz * vs; this.vz = fz * vf + fx * vs;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.speed = vf;
    this.y = Math.max(0, terrainY(this.x, this.z) + 0.3) + Math.sin(this.sim.time * 1.7 + this.id) * 0.08;
    this.pitch += (Math.min(0.2, Math.max(0, vf) / s.max * 0.22) - this.pitch) * Math.min(1, dt * 3);     // 加速时船头抬起
    this.roll += (this.steer * Math.min(1, Math.abs(vf) / 10) * 0.35 - this.roll) * Math.min(1, dt * 3);
  }

  /* ---------------------------------------------------------- 直升机：照飞机的做法，但能垂直起降 */
  updateHeli(dt, c) {
    const s = this.spec, w = this.sim.world;
    if (!this.flying) {
      // 地面：不用跑道、不用前飞加速，拉升降杆（pitch）就原地升空；停在楼顶时贴着屋顶高度
      this.vx *= Math.max(0, 1 - 4 * dt); this.vz *= Math.max(0, 1 - 4 * dt); this.speed = 0;
      if (this.roofB && this.roofB.destroyed) { this.roofY = null; this.roofB = null; }   // 楼顶被炸没了：屋顶没了就落回地面，别悬在半空
      const gy = this.roofY != null ? this.roofY : w.groundY(this.x, this.z);
      this.y += (gy - this.y) * Math.min(1, dt * 14);
      this.pitch += (0 - this.pitch) * Math.min(1, dt * 4); this.roll += (0 - this.roll) * Math.min(1, dt * 4);
      if (c.pitch > 0.15 && !this.burning) { this.flying = true; this.vy = 3; this.air = 0; this.y += 0.3; this.roofY = null; this.roofB = null; }
      return;
    }
    // 空中：油门控制前后速度（松油门就悬停），升降杆控制垂直速度，左右压杆转向
    let v = this.air || 0;
    const gas = this.burning ? -0.3 : c.gas;
    if (gas > 0) v += s.accel * gas * dt * (1 - v / s.max * 0.6); else if (gas < 0) v -= s.brake * -gas * dt;
    else v -= v * 0.8 * dt;                                       // 悬停：松油门后水平速度衰减到 0
    v = clamp(v, -s.rev, s.max);
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 3);
    this.yaw -= this.steer * s.steer * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.vx = fx * v; this.vz = fz * v;
    this.vy = c.pitch * s.accel;                                  // 垂直速度上限复用 accel（13 米/秒）
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.y = Math.min(420, this.y + this.vy * dt);                // 升限复用飞机的 420 米
    this.air = v; this.speed = v;
    // 机身随速度前倾、随转向侧倾
    this.pitch += (clamp(v / s.max, -0.3, 0.3) * 0.8 - this.pitch) * Math.min(1, dt * 3);
    this.roll += (this.steer * 0.3 - this.roll) * Math.min(1, dt * 3);
    // 楼顶降落：脚下有够大、够平的屋顶、正在下降、离屋顶不到 0.6 米时，屋顶当作地面按触地判定处理。
    // 必须在撞楼判定之前查，否则下降到屋顶附近时 collide 会先把飞机判成撞楼爆炸。
    // 平稳（下降速度 > -9 米/秒，机身倾斜 < 0.6）就正常降落；太快、太斜照旧坠毁。
    const roof = w.roofAt(this.x, this.z, this.yaw, s.len, s.wid);
    if (roof && this.vy <= 0 && this.y <= roof.top + 0.6) {
      const ok = this.vy > -9 && Math.abs(this.pitch) < 0.6 && Math.abs(this.roll) < 0.6;
      this.flying = false;
      if (!ok) { this.hp = 0; this.burning = true; this.explode(); return; }
      this.y = roof.top; this.roofY = roof.top; this.roofB = roof.b; this.vy = 0; this.speed = v; this.roll = 0;
      this.sim.emit({ type: 'crash', x: this.x, z: this.z, f: 3, v: this });
      return;
    }
    // 撞楼（复用飞机的判定）
    P.x = this.x; P.z = this.z;
    if (w.collide(P, 3, this.y)) { this.x = P.x; this.z = P.z; this.hp = 0; this.burning = true; this.burnT = 0; this.byPlayer = false; this.explode(); return; }
    // 触地：平稳、落在陆地上就算降落，否则坠毁；落在水里沉没（下降速度和坡度阈值复用飞机）
    const g = Math.max(w.groundY(this.x, this.z), 0);
    if (this.y <= g + 0.05) {
      this.y = g;
      if (w.inWater(this.x, this.z)) { this.flying = false; this.sink(); return; }
      const sl = w.slope(this.x, this.z);
      const ok = this.vy > -9 && Math.abs(sl[0]) + Math.abs(sl[1]) < 0.35;
      this.flying = false;
      if (!ok) { this.hp = 0; this.burning = true; this.explode(); return; }
      this.vy = 0; this.speed = v; this.roll = 0; this.roofY = null; this.roofB = null;
      this.sim.emit({ type: 'crash', x: this.x, z: this.z, f: 3, v: this });
    }
  }

  /* ---------------------------------------------------------- 飞机 */
  updatePlane(dt, c) {
    const s = this.spec, w = this.sim.world;
    if (!this.flying) {
      // 地面滑行：和汽车类似，但转向迟钝；速度够了并且拉杆就离地
      this.updateGround(dt, { steer: c.steer * 0.5, gas: c.gas > 0 ? c.gas : c.gas * 0.6, handbrake: false });
      if (!this.alive) return;
      this.roll = 0; this.pitch += (0 - this.pitch) * Math.min(1, dt * 4);
      if (this.speed >= s.takeoff && c.pitch > 0.15 && !this.burning) { this.flying = true; this.vy = 3; this.air = this.speed; this.y += 0.3; }
      return;
    }
    // 空中：油门控制速度，推拉杆控制俯仰，左右压杆带坡度转弯
    let v = this.air;
    const gas = this.burning ? -0.3 : c.gas;
    if (gas > 0) v += s.accel * gas * dt * (1 - v / s.max * 0.6); else if (gas < 0) v -= s.brake * -gas * dt;
    v -= Math.sin(this.pitch) * 9 * dt;                     // 爬升掉速，俯冲增速
    v -= (v - 46) * 0.04 * dt;
    v = clamp(v, 12, s.max * 1.15);
    let tp = c.pitch * 0.6;
    if (v < s.stall) tp = -0.55;                            // 失速：机头下沉
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 1.8);
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 3);
    this.roll += (this.steer * 0.85 - this.roll) * Math.min(1, dt * 3);
    this.yaw -= this.steer * s.steer * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), h = v * Math.cos(this.pitch);
    this.vx = fx * h; this.vz = fz * h; this.vy = v * Math.sin(this.pitch);
    this.x += this.vx * dt; this.z += this.vz * dt; this.y = Math.min(420, this.y + this.vy * dt);
    this.air = v; this.speed = v;
    // 撞楼
    P.x = this.x; P.z = this.z;
    if (w.collide(P, 3, this.y)) { this.x = P.x; this.z = P.z; this.hp = 0; this.burning = true; this.burnT = 0; this.byPlayer = false; this.explode(); return; }
    // 触地：平稳、不太陡、落在陆地上就算降落，否则坠毁；落在水里沉没
    const g = Math.max(w.groundY(this.x, this.z), 0);
    if (this.y <= g + 0.05) {
      this.y = g;
      if (w.inWater(this.x, this.z)) { this.flying = false; this.sink(); return; }
      const sl = w.slope(this.x, this.z);
      const ok = this.vy > -9 && this.pitch > -0.5 && Math.abs(this.roll) < 0.6 && Math.abs(sl[0]) + Math.abs(sl[1]) < 0.35;
      this.flying = false;
      if (!ok) { this.hp = 0; this.burning = true; this.explode(); return; }
      this.vy = 0; this.speed = h; this.roll = 0;
      this.sim.emit({ type: 'crash', x: this.x, z: this.z, f: 3, v: this });
    }
  }
}
