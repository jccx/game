// 落日湾：把游戏状态画出来——镜头、玩家、行人、载具、拾取物、任务标记、特效。
// 不改变任何规则；Sim 可以在没有 View 的情况下独立运行。
import * as THREE from '../../../shared/js/three.js';
import { blobShadow, MAT } from '../../../shared/js/geo.js';
import { Particles } from '../../../shared/js/particles.js';
import { angDamp, damp, clamp } from '../../../shared/js/util.js';
import { el } from '../../../shared/js/ui.js';
import { Sfx } from '../../../shared/js/audio.js';
import { CITY_Y, terrainY } from '../world.js';
import { buildScene } from './scene.js';
import { buildVehicle, personParts, PIVOT, LOOKS, SKIN, MAT_WRECK } from './models.js';

const MAX_PED = 48, MAX_SHADOW = 96;
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _c = new THREE.Color(), _v = new THREE.Vector3();
const PICK_COLOR = { cash: 0x4ade80, health: 0xff5a5a, armor: 0x5ab8ff, weapon: 0xffb347, star: 0xffe066 };
/** 跟车镜头的距离和高度：按载具类别 */
const CAM = { foot: [6.2, 1.7], car: [9.5, 2.2], bike: [7.5, 1.9], boat: [12, 2.6], tank: [14, 3.6], plane: [18, 3.2], heli: [16, 3] };

export class View {
  /**
   * @param {object} stage 共用的渲染舞台
   * @param {import('../sim.js').Sim} sim
   * @param {HTMLElement} layer 放任务名标签的 DOM 层
   * @param {(ev:object)=>void} onEvent 把事件转给界面
   */
  constructor(stage, sim, layer, onEvent) {
    this.stage = stage; this.sim = sim; this.layer = layer; this.onEvent = onEvent;
    this.scene = new THREE.Scene();
    this.world = buildScene(sim.world, this.scene, stage.level >= 2);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.6, 3200);
    const p = sim.player;
    this.camYaw = p.yaw; this.camPitch = 0.3; this.manualT = 9; this.dist = 6; this.shake = 0; this.time = 0;
    this.tx = p.x; this.ty = p.y; this.tz = p.z;

    // ---- 粒子 ----
    this.fire = new Particles(this.scene, { max: 700, additive: true });
    this.smoke = new Particles(this.scene, { max: 320, additive: false });

    // ---- 玩家：和行人用同一套部件，但各自是独立的网格 ----
    const parts = this.parts = personParts();
    const pm = (geo, color) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, color, flatShading: true })); m.matrixAutoUpdate = false; this.scene.add(m); return m; };
    this.pl = { torso: pm(parts.torso, 0xe8793a), head: pm(parts.head, SKIN[1]), hair: pm(parts.hair, 0x24303f), armL: pm(parts.arm, 0xe8793a), armR: pm(parts.arm, 0xe8793a), legL: pm(parts.leg, 0x3a3f4a), legR: pm(parts.leg, 0x3a3f4a), gun: pm(parts.gun, 0xffffff) };
    this.plPhase = 0; this.plAtkSeq = 0; this.plAtkT = 9;

    // ---- 行人：每种部件一个实例化网格，所有行人只用 7 次绘制调用 ----
    const im = (geo) => { const m = new THREE.InstancedMesh(geo, MAT.vcFlat, MAX_PED); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; this.scene.add(m); return m; };
    this.pd = { torso: im(parts.torso), head: im(parts.head), hair: im(parts.hair), armL: im(parts.arm), armR: im(parts.arm), legL: im(parts.leg), legR: im(parts.leg) };

    // ---- 载具、拾取物、任务标记 ----
    this.vehViews = new Map(); this.pickViews = new Map(); this._seen = new Set();
    const blob = blobShadow();
    this.shadows = new THREE.InstancedMesh(blob.geo, blob.mat, MAX_SHADOW);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.shadows.frustumCulled = false; this.shadows.renderOrder = 2; this.shadows.count = 0;
    this.scene.add(this.shadows);
    this.pickGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const glow = (color, o = 0.35) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    this.givers = sim.missions.list.map((m) => {
      const mesh = new THREE.Mesh(beamGeo, glow(0xffd84a));
      mesh.scale.set(3.2, 28, 3.2); mesh.position.set(m.at[0], sim.world.groundY(m.at[0], m.at[1]) + 14, m.at[1]); mesh.renderOrder = 6;
      this.scene.add(mesh);
      return { m, mesh, label: el('div', { cls: 'wlabel', text: m.name }, layer) };
    });
    this.cpBeam = new THREE.Mesh(beamGeo, glow(0x4ae0ff, 0.4)); this.cpBeam.renderOrder = 6;
    this.cpRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), glow(0x4ae0ff, 0.9)); this.cpRing.renderOrder = 6;
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.8, 4), new THREE.MeshBasicMaterial({ color: 0xff4a4a })); this.arrow.rotation.x = Math.PI;
    for (const m of [this.cpBeam, this.cpRing, this.arrow]) { m.visible = false; this.scene.add(m); }
    // 无敌光罩
    this.godBubble = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), glow(0xffd35a, 0.28)); this.godBubble.visible = false; this.scene.add(this.godBubble);

    // ---- 弹道、爆炸火球（对象池） ----
    this.tracers = []; this.balls = []; this.active = [];
    this.tGeo = new THREE.BoxGeometry(0.06, 0.06, 1); this.bGeo = new THREE.SphereGeometry(1, 12, 10);
    this.shotViews = new Map();
    this.shotGeo = new THREE.BoxGeometry(0.25, 0.25, 1.2);

    stage.onResize(() => this.layout());
    stage.onQuality(() => this.layout());
  }

  layout() {
    const s = this.stage, cam = this.camera;
    cam.aspect = s.aspect; cam.fov = s.portrait ? 74 : 58;
    cam.updateProjectionMatrix();
    this.fire.setViewport(s.height, cam.fov, s.pixelRatio); this.smoke.setViewport(s.height, cam.fov, s.pixelRatio);
    this.far = s.level === 0 ? 520 : s.level === 1 ? 700 : 950;                // 画质越低看得越近，省性能
    this.scene.fog.near = this.far * 0.3; this.scene.fog.far = this.far;
  }

  /** 有楼被炸平后重建静态场景（废墟代替楼）。全量重建只在炸楼时触发一次；重建用同一个随机种子，所以树和屋顶颜色和原来一样 */
  rebuildScene() {
    this.world.dispose();
    this.world = buildScene(this.sim.world, this.scene, this.stage.level >= 2);
    this.layout();   // 重建会重置雾效距离，按当前画质重新设
  }

  /** 手指拖动屏幕转动镜头 */
  look(dx, dy) {
    if (!dx && !dy) return;
    this.camYaw -= dx * 0.0062; this.camPitch = clamp(this.camPitch + dy * 0.004, -0.15, 1.1); this.manualT = 0;
  }

  /** 世界坐标 → 屏幕像素 */
  project(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    return { x: (_v.x + 1) * 0.5 * this.stage.width, y: (1 - _v.y) * 0.5 * this.stage.height, visible: _v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1 };
  }

  /* ---------------------------------------------------------- 事件 → 特效和音效 */
  handle(ev) {
    const p = this.sim.player, near = (x, z, r) => Math.hypot(x - p.x, z - p.z) < r;
    switch (ev.type) {
      case 'tracer': {
        let m = this.tracers.pop();
        if (!m) { m = new THREE.Mesh(this.tGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); this.scene.add(m); }
        const dx = ev.x2 - ev.x1, dy = ev.y2 - ev.y1, dz = ev.z2 - ev.z1, len = Math.hypot(dx, dy, dz);
        m.visible = true; m.position.set(ev.x1 + dx / 2, ev.y1 + dy / 2, ev.z1 + dz / 2); m.scale.set(1, 1, len); m.lookAt(ev.x2, ev.y2, ev.z2);
        this.active.push({ m, t: 0.07, pool: this.tracers });
        this.fire.emit(ev.x1 + dx / len * 0.8, ev.y1, ev.z1 + dz / len * 0.8, { n: 3, speed: [1, 4], life: [0.05, 0.12], size: [0.4, 0.8], color: 0xffd070 });
        if (ev.hit) this.smoke.emit(ev.x2, ev.y2, ev.z2, { n: 3, speed: [1, 3], life: [0.2, 0.4], size: [0.3, 0.6], grow: 2, color: 0xe8e0d0, alpha: 0.7 });
        else this.fire.emit(ev.x2, ev.y2, ev.z2, { n: 3, speed: [2, 5], life: [0.1, 0.25], size: [0.2, 0.4], color: 0xffe0a0 });
        break;
      }
      case 'explosion': {
        let m = this.balls.pop();
        if (!m) { m = new THREE.Mesh(this.bGeo, new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.scene.add(m); }
        m.visible = true; m.position.set(ev.x, ev.y, ev.z);
        this.active.push({ m, t: 0.4, dur: 0.4, pool: this.balls, r: ev.r });
        this.fire.emit(ev.x, ev.y, ev.z, { n: 46, speed: [4, 16], life: [0.3, 0.8], size: [1, 2.6], color: 0xff8a20, color2: 0xfff0a0, gravity: -6, drag: 1.5 });
        this.smoke.emit(ev.x, ev.y + 1, ev.z, { n: 22, speed: [2, 7], dir: [0, 1, 0], spread: 0.7, life: [1, 2.2], size: [2, 4], grow: 2.6, color: 0x3a3632, alpha: 0.7, drag: 1, r: 1.5 });
        const d = Math.hypot(ev.x - p.x, ev.z - p.z);
        this.shake = Math.max(this.shake, clamp(1.6 - d / 45, 0, 1.4));
        if (d < 220) Sfx.play(d < 70 ? 'bigboom' : 'boom', 0.1);
        break;
      }
      case 'buildingDown': {
        // 楼被炸平了：下个逻辑帧重建一次静态场景（废墟代替楼）。一次爆炸可能炸掉好几栋楼，一帧最多重建一次
        this.needRebuild = true;
        const cx = (ev.b.x0 + ev.b.x1) / 2, cz = (ev.b.z0 + ev.b.z1) / 2;
        this.smoke.emit(cx, ev.b.y0 + 2, cz, { n: 24, speed: [2, 8], dir: [0, 1, 0], spread: 0.9, life: [1.0, 2.0], size: [2, 3.5], grow: 1.2, color: 0x6a6258, alpha: 0.6, drag: 1, r: 2 });
        this.fire.emit(cx, ev.b.y0 + 2, cz, { n: 16, speed: [2, 8], life: [0.3, 0.7], size: [1, 2.4], color: 0xff8a20, color2: 0xfff0a0, gravity: -6 });
        this.shake = Math.max(this.shake, 0.7);
        break;
      }
      case 'crash':
        this.fire.emit(ev.x, (ev.v ? ev.v.y : CITY_Y) + 0.8, ev.z, { n: Math.min(16, 4 + ev.f), speed: [3, 9], life: [0.15, 0.4], size: [0.2, 0.5], color: 0xffd080, gravity: -14 });
        if (near(ev.x, ev.z, 60)) Sfx.play('crash', 0.15);
        if (ev.v && ev.v.driver === 'player') this.shake = Math.max(this.shake, Math.min(0.8, ev.f * 0.05));
        break;
      case 'splash':
        this.smoke.emit(ev.x, 0.4, ev.z, { n: ev.big ? 30 : 10, speed: [3, 9], dir: [0, 1, 0], spread: 0.6, life: [0.5, 1.1], size: [0.8, 1.8], grow: 1.6, color: 0xeaf6ff, alpha: 0.8, gravity: -12, r: 1.5 });
        if (near(ev.x, ev.z, 80)) Sfx.play('splash', 0.2);
        break;
      case 'hit': this.smoke.emit(ev.x, ev.y, ev.z, { n: 4, speed: [1, 3], life: [0.2, 0.45], size: [0.3, 0.6], grow: 1.8, color: 0xf0e8e0, alpha: 0.75 }); break;
      case 'shot': if (ev.mine || near(ev.x, ev.z, 70)) Sfx.play(ev.w === 'rocket' || ev.w === 'shell' ? 'boost' : 'shoot', 0.05); break;
      case 'punch': if (near(ev.x, ev.z, 30)) Sfx.play('slash', 0.1); break;
    }
    this.onEvent(ev);
  }

  /* ---------------------------------------------------------- 人物姿势 */

  /**
   * 算出一个人各部件的矩阵并交给 write(部件名, 矩阵)。
   * o：位置朝向；lean 身体前倾；fall 倒地程度 0~1；aL/aR/lL/lR 四肢摆角。
   */
  pose(x, y, z, yaw, lean, fall, aL, aR, lL, lR, write) {
    _m0.makeRotationY(yaw).setPosition(x, y, z);
    if (fall > 0) { _m1.makeRotationX(-fall * 1.5); _m0.multiply(_m1); }
    else if (lean) { _m1.makeRotationX(lean); _m0.multiply(_m1); }
    const part = (name, ang) => {
      const pv = PIVOT[name];
      if (ang) _m1.makeRotationX(ang); else _m1.identity();
      _m1.setPosition(pv[0], pv[1], pv[2]);
      write(name, _m2.multiplyMatrices(_m0, _m1));
    };
    part('torso', 0); part('head', 0); part('hair', 0); part('armL', aL); part('armR', aR); part('legL', lL); part('legR', lR);
  }

  /* ---------------------------------------------------------- 每帧更新 */
  update(alpha, dt) {
    const sim = this.sim, p = sim.player, w = sim.world, v = p.inVeh;
    this.time += dt; this.manualT += dt;
    const evs = sim.events;
    for (let i = 0; i < evs.length; i++) this.handle(evs[i]);
    evs.length = 0;
    if (this.needRebuild) { this.needRebuild = false; this.rebuildScene(); }

    // ---- 镜头 ----
    const lx = p.px + (p.x - p.px) * alpha, lz = p.pz + (p.z - p.pz) * alpha;
    let ly = p.py + (p.y - p.py) * alpha;
    if (v) ly = v.py + (v.y - v.py) * alpha;
    const cls = v ? v.spec.cls : 'foot', cm = CAM[cls];
    let pitch = this.camPitch;
    if (v) {
      // 开车时镜头慢慢转到车尾后面；刚用手拖过镜头时先不抢
      if (this.manualT > 1.4) this.camYaw = angDamp(this.camYaw, v.yaw, v.flying ? 3.2 : 1.2 + Math.min(2.2, Math.abs(v.speed) * 0.2), dt);
      if (v.flying) pitch = clamp(this.camPitch - v.pitch * 0.55, -0.5, 1.1);
    } else if (p.moving && this.manualT > 2.2) this.camYaw = angDamp(this.camYaw, p.yaw, 0.8, dt);
    const want = cm[0] * (this.stage.portrait ? 1.12 : 1);
    this.tx = lx; this.tz = lz; this.ty = damp(this.ty, ly + cm[1], 12, dt);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 镜头和玩家之间有楼挡着时把镜头拉近
    let d = want;
    for (let k = 1; k <= 6; k++) {
      const t = (k / 6) * want, x = this.tx - fx * cp * t, z = this.tz - fz * cp * t, y = this.ty + sp * t;
      let hit = false;
      w.nearBuildings(x, z, 1, (b) => { if (x > b.x0 - 0.4 && x < b.x1 + 0.4 && z > b.z0 - 0.4 && z < b.z1 + 0.4 && y < b.y0 + b.h + 0.3) hit = true; });
      if (hit) { d = Math.max(1.2, ((k - 1) / 6) * want); break; }
    }
    this.dist = d < this.dist ? d : damp(this.dist, d, 4, dt);
    const cam = this.camera;
    let cx = this.tx - fx * cp * this.dist, cz = this.tz - fz * cp * this.dist, cy = this.ty + sp * this.dist;
    cy = Math.max(cy, Math.max(terrainY(cx, cz), 0) + 0.7);
    if (this.shake > 0.01) { cx += (Math.random() - 0.5) * this.shake; cy += (Math.random() - 0.5) * this.shake; this.shake *= Math.exp(-dt * 7); }
    cam.position.set(cx, cy, cz);
    cam.lookAt(this.tx + fx * 2, this.ty + (v && v.flying ? 0 : 0.2), this.tz + fz * 2);
    cam.updateMatrixWorld();

    this.nShadow = 0;
    this.updatePlayer(p, lx, ly, lz, dt);
    this.updatePeds(alpha);
    this.updateVehicles(alpha, dt);
    this.updateMarkers(dt);

    // 飞行中的炮弹和火箭
    for (const s of sim.shots) {
      let m = this.shotViews.get(s);
      if (!m) { m = new THREE.Mesh(this.shotGeo, new THREE.MeshBasicMaterial({ color: 0xfff0a0 })); this.scene.add(m); this.shotViews.set(s, m); }
      const x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha, z = s.pz + (s.z - s.pz) * alpha;
      m.position.set(x, y, z); m.lookAt(x + s.dx, y + s.dy, z + s.dz);
      this.fire.emit(x, y, z, { n: 1, speed: [0, 1], life: [0.15, 0.3], size: [0.5, 0.9], color: 0xffa040 });
      this.smoke.emit(x, y, z, { n: 1, speed: [0, 1], life: [0.4, 0.8], size: [0.5, 0.9], grow: 2.5, color: 0xd8d8d8, alpha: 0.5 });
    }
    for (const [s, m] of this.shotViews) if (!s.alive) { this.scene.remove(m); m.material.dispose(); this.shotViews.delete(s); }

    // 限时特效：弹道线、爆炸火球
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t -= dt;
      if (a.dur) { const k = 1 - a.t / a.dur; a.m.scale.setScalar(a.r * (0.3 + 0.8 * k)); a.m.material.opacity = 1 - k; }
      if (a.t <= 0) { a.m.visible = false; a.pool.push(a.m); this.active[i] = this.active[this.active.length - 1]; this.active.pop(); }
    }

    this.shadows.count = this.nShadow; this.shadows.instanceMatrix.needsUpdate = true;
    this.fire.update(dt); this.smoke.update(dt);
    this.world.update(dt, cx, cy, cz, this.far);
    this.stage.render(this.scene, cam, dt);
  }

  addShadow(x, y, z, size) {
    if (this.nShadow >= MAX_SHADOW) return;
    const a = this.shadows.instanceMatrix.array, o = this.nShadow++ * 16;
    a[o] = size; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = size; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = y + 0.06; a[o + 14] = z; a[o + 15] = 1;
  }

  updatePlayer(p, x, y, z, dt) {
    const pl = this.pl, vis = !p.inVeh;
    for (const k in pl) pl[k].visible = vis;
    this.godBubble.visible = p.godT > 0 && !p.dead;
    if (this.godBubble.visible) {
      const v = p.inVeh, r = v ? Math.max(v.spec.len, v.spec.wid) * 0.62 : 1.25;
      this.godBubble.position.set(x, y + (v ? v.spec.hgt * 0.5 : 1), z); this.godBubble.scale.setScalar(r + Math.sin(this.time * 6) * 0.05);
      this.godBubble.material.opacity = v ? 0.1 : 0.18;          // 在车上时光罩很大，调淡一些免得挡视线
    }
    if (!vis) return;
    if (p.atkSeq !== this.plAtkSeq) { this.plAtkSeq = p.atkSeq; this.plAtkT = 0; }
    this.plAtkT += dt;
    let aL = 0, aR = 0, lL = 0, lR = 0, lean = 0, fall = 0;
    if (p.dead) fall = Math.min(1, p.deadT * 2.5);
    else if (p.swim) { lean = 1.15; const s = Math.sin(this.time * 6); aL = -2.2 + s * 0.8; aR = -2.2 - s * 0.8; lL = s * 0.4; lR = -s * 0.4; }
    else if (p.moving) { this.plPhase += dt * 11; const s = Math.sin(this.plPhase); lL = s * 0.85; lR = -s * 0.85; aL = -s * 0.6; aR = s * 0.6; lean = 0.1; }
    const armed = p.weapon > 0;
    if (!p.dead && !p.swim && this.plAtkT < 0.35) aR = armed ? -1.5 : -1.5 + Math.sin(this.plAtkT / 0.35 * Math.PI) * -0.8;       // 举枪 / 出拳
    pl.gun.visible = armed && !p.swim && !p.dead;
    this.pose(x, y, z, p.yaw, lean, fall, aL, aR, lL, lR, (name, m) => { pl[name].matrix.copy(m); if (name === 'armR') pl.gun.matrix.copy(m); });
    if (!p.swim) this.addShadow(x, y, z, 1.4);
  }

  updatePeds(alpha) {
    const pd = this.pd, peds = this.sim.peds, t = this.sim.time;
    let n = 0;
    for (let i = 0; i < peds.length && n < MAX_PED; i++) {
      const o = peds[i];
      const x = o.px + (o.x - o.px) * alpha, z = o.pz + (o.z - o.pz) * alpha, y = o.py + (o.y - o.py) * alpha;
      let aL = 0, aR = 0, lL = 0, lR = 0, fall = 0;
      if (!o.alive) fall = Math.min(1, o.deadT * 2.5);
      else {
        if (o.moving) { const s = Math.sin(t * (o.speed > 3 ? 12 : 6.5) + o.id); lL = s * 0.8; lR = -s * 0.8; aL = -s * 0.5; aR = s * 0.5; }
        if (o.state === 'flee') { aL = -2.7; aR = -2.7; }                       // 举着手逃跑
        else if (o.state === 'fight' && !o.moving) aR = -1.5;                    // 举枪
        this.addShadow(x, y, z, 1.3);
      }
      const idx = n++;
      this.pose(x, y, z, o.yaw, 0, fall, aL, aR, lL, lR, (name, m) => pd[name].setMatrixAt(idx, m));
      // 配色：警察深蓝，帮派紫色，路人随机
      const lk = LOOKS[o.look];
      const shirt = o.kind === 'cop' ? 0x1f3a6e : o.kind === 'gang' ? 0x7a2bb8 : lk[0], pants = o.kind === 'cop' ? 0x1a2238 : o.kind === 'gang' ? 0x1c1c20 : lk[1], hair = o.kind === 'cop' ? 0x101830 : o.kind === 'gang' ? 0xd0d0d0 : lk[2];
      pd.torso.setColorAt(idx, _c.setHex(shirt)); pd.armL.setColorAt(idx, _c); pd.armR.setColorAt(idx, _c);
      pd.legL.setColorAt(idx, _c.setHex(pants)); pd.legR.setColorAt(idx, _c);
      pd.hair.setColorAt(idx, _c.setHex(hair)); pd.head.setColorAt(idx, _c.setHex(SKIN[o.look % SKIN.length]));
    }
    for (const k in pd) { const m = pd[k]; m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  updateVehicles(alpha, dt) {
    const sim = this.sim, seen = this._seen, t = this.time;
    seen.clear();
    for (const v of sim.vehicles) {
      seen.add(v);
      let vw = this.vehViews.get(v);
      if (!vw) { vw = buildVehicle(v.type, v.color); vw.group.rotation.order = 'YXZ'; this.scene.add(vw.group); this.vehViews.set(v, vw); }
      const x = v.px + (v.x - v.px) * alpha, y = v.py + (v.y - v.py) * alpha, z = v.pz + (v.z - v.pz) * alpha;
      const g = vw.group;
      g.position.set(x, y, z);
      g.rotation.set(-v.pitch, v.pyaw + (v.yaw - v.pyaw) * alpha, v.roll);
      if (vw.prop) { vw.prop.rotation.z += dt * (v.driver ? 14 + Math.abs(v.speed) * 0.8 : 0); vw.prop.visible = v.alive; }
      if (vw.rotor) { vw.rotor.rotation.y += dt * (v.flying ? 14 + Math.abs(v.speed) * 0.8 : 0); vw.rotor.visible = v.alive; }   // 旋翼只在空中转：停稳（地面或楼顶）后停转
      if (vw.light) vw.light.visible = v.alive && (!v.siren || ((t * 5) | 0) % 2 === 0);
      if (vw.rider) vw.rider.visible = !!v.driver && v.alive;
      if (v.wreck && !vw.dead) { vw.dead = true; vw.body.material = MAT_WRECK; }
      const cls = v.spec.cls;
      if (v.alive) {
        if (v.flying) this.addShadow(x, Math.max(sim.world.groundY(x, z), 0), z, v.spec.wid * 0.9);
        else if (cls !== 'boat') this.addShadow(x, y, z, Math.max(v.spec.len, v.spec.wid) * 1.25);
        // 受损冒烟、起火
        if (v.burning) {
          this.fire.emit(x, y + v.spec.hgt * 0.8, z, { n: 2, speed: [1, 3], dir: [0, 1, 0], spread: 0.5, life: [0.3, 0.6], size: [0.8, 1.6], color: 0xff7a20, color2: 0xffe080, r: 0.8 });
          this.smoke.emit(x, y + v.spec.hgt, z, { n: 1, speed: [1, 3], dir: [0, 1, 0], spread: 0.4, life: [0.8, 1.6], size: [1, 1.8], grow: 2.5, color: 0x2a2826, alpha: 0.7 });
        } else if (v.hp < v.spec.hp * 0.4 && Math.random() < dt * 14) this.smoke.emit(x, y + v.spec.hgt * 0.8, z, { n: 1, speed: [0.5, 2], dir: [0, 1, 0], spread: 0.4, life: [0.6, 1.2], size: [0.6, 1.2], grow: 2.4, color: 0x8a8a8a, alpha: 0.55 });
        const sp = Math.abs(v.speed);
        // 船的尾浪；车在野地上扬尘
        if (cls === 'boat' && sp > 5 && Math.random() < dt * 40) this.smoke.emit(x - Math.sin(v.yaw) * 3, 0.2, z - Math.cos(v.yaw) * 3, { n: 2, speed: [1, 3], dir: [0, 1, 0], spread: 0.8, life: [0.5, 1], size: [0.8, 1.5], grow: 2, color: 0xf2fbff, alpha: 0.7, r: 1 });
        else if ((cls === 'car' || cls === 'bike' || cls === 'tank') && sp > 9 && y !== CITY_Y && Math.random() < dt * 25) this.smoke.emit(x - Math.sin(v.yaw) * 2, y + 0.3, z - Math.cos(v.yaw) * 2, { n: 1, speed: [0.5, 2], dir: [0, 1, 0], spread: 0.7, life: [0.5, 1], size: [0.8, 1.4], grow: 2.4, color: 0xc8b48a, alpha: 0.45 });
      }
    }
    for (const [v, vw] of this.vehViews) if (!seen.has(v)) {
      this.scene.remove(vw.group);
      vw.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      this.vehViews.delete(v);
    }
  }

  /** 拾取物、任务光柱、检查点、目标箭头 */
  updateMarkers(dt) {
    const sim = this.sim, p = sim.player, t = this.time, seen = this._seen;
    seen.clear();
    for (const k of sim.pickups) {
      if (k.t > 0 || Math.hypot(k.x - p.x, k.z - p.z) > 140) continue;
      seen.add(k);
      let m = this.pickViews.get(k);
      if (!m) { m = new THREE.Mesh(this.pickGeo, new THREE.MeshBasicMaterial({ color: PICK_COLOR[k.type] })); this.scene.add(m); this.pickViews.set(k, m); }
      m.position.set(k.x, k.y + 0.9 + Math.sin(t * 3 + k.id) * 0.15, k.z); m.rotation.y = t * 2 + k.id; m.rotation.x = 0.6;
    }
    for (const [k, m] of this.pickViews) if (!seen.has(k)) { this.scene.remove(m); m.material.dispose(); this.pickViews.delete(k); }

    const ms = sim.missions, a = ms.active;
    for (const g of this.givers) {
      const d = Math.hypot(g.m.at[0] - p.x, g.m.at[1] - p.z), vis = !a && d < 420;
      g.mesh.visible = vis;
      g.mesh.material.opacity = 0.25 + 0.12 * Math.sin(t * 3);
      let lab = false;
      if (vis && d < 90) { const s = this.project(g.m.at[0], g.mesh.position.y - 9, g.m.at[1]); if (s.visible) { lab = true; g.label.style.transform = `translate3d(${s.x.toFixed(0)}px,${s.y.toFixed(0)}px,0) translate(-50%,-50%)`; } }
      if (lab !== g.shown) { g.shown = lab; g.label.style.display = lab ? '' : 'none'; }
    }
    const hud = ms.hud, ring = hud && hud.ring, tg = hud && hud.target;
    this.cpBeam.visible = !!ring && ring.y === null; this.cpRing.visible = !!ring && ring.y !== null;
    if (ring) {
      if (ring.y === null) { const gy = Math.max(sim.world.groundY(ring.x, ring.z), 0); this.cpBeam.position.set(ring.x, gy + 9, ring.z); this.cpBeam.scale.set(ring.r, 18, ring.r); this.cpBeam.material.opacity = 0.3 + 0.12 * Math.sin(t * 5); }
      else { this.cpRing.position.set(ring.x, ring.y, ring.z); this.cpRing.scale.setScalar(ring.r); this.cpRing.rotation.y = Math.atan2(p.x - ring.x, p.z - ring.z); }
    }
    // 目标是一辆车或一个人时，头顶飘一个红色箭头
    const obj = tg && tg.radius !== undefined || tg && tg.kind ? tg : null;
    this.arrow.visible = !!obj && obj.alive !== false && p.inVeh !== obj;
    if (this.arrow.visible) { this.arrow.position.set(obj.x, obj.y + (obj.spec ? obj.spec.hgt + 2.2 : 3) + Math.sin(t * 4) * 0.3, obj.z); this.arrow.rotation.y = t * 2; }
  }

  dispose() {
    this.world.dispose();
    for (const g of this.givers) g.label.remove();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
  }
}
