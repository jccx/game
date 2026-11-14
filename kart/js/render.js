// 疾风卡丁：画面——赛道、场景、卡丁车、道具、特效和追尾镜头。全部现场生成，不用图片和模型文件。
import * as THREE from '../../shared/js/three.js';
import { Builder, MAT, blobShadow, canvasTexture, makeCanvas } from '../../shared/js/geo.js';
import { Particles } from '../../shared/js/particles.js';
import { makeRng, damp, clamp } from '../../shared/js/util.js';
import { Sfx } from '../../shared/js/audio.js';
import { KART, RACERS } from './config.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

/** 三种主题的配色 */
const THEMES = {
  forest: { ground: 0x4f8f3f, road: '#50545c', line: '#f2e9c8', fog: 0xcfe9ff, sky: 0x3f86de, sun: 0xfff2d8, wallA: '#2c2f36', wallB: '#e9e9e9' },
  desert: { ground: 0xd8b068, road: '#6a5a4a', line: '#fff0c8', fog: 0xf8e2b8, sky: 0x62aaf0, sun: 0xffe8c0, wallA: '#a8442c', wallB: '#f4e6c8' },
  ice:    { ground: 0xe6f0f8, road: '#8fa9bf', line: '#ffffff', fog: 0xe8f2fb, sky: 0x6ea6e2, sun: 0xf4f8ff, wallA: '#3a78c8', wallB: '#ffffff' },
};
const SPARK = [0xffffff, 0x4ab8ff, 0xff9a2e, 0xc66bff];     // 漂移火花：没攒够、蓝、橙、紫

function roadTex(th) {
  const [cv, c] = makeCanvas(64, 64), rnd = makeRng(4);
  c.fillStyle = th.road; c.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 240; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.08)'; c.fillRect(rnd() * 64, rnd() * 64, 1 + rnd() * 2, 1 + rnd() * 2); }
  c.fillStyle = th.line; c.fillRect(31, 0, 2, 30); c.fillRect(1, 0, 2, 64); c.fillRect(61, 0, 2, 64);
  return cv;
}
function stripeTex(a, b, horiz) {
  const [cv, c] = makeCanvas(32, 32);
  c.fillStyle = a; c.fillRect(0, 0, 32, 32); c.fillStyle = b;
  if (horiz) c.fillRect(0, 0, 32, 16); else c.fillRect(0, 0, 16, 32);
  return cv;
}
function checkerTex() {
  const [cv, c] = makeCanvas(64, 16);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 8, y * 8, 8, 8); }
  return cv;
}
function boxTex() {
  const [cv, c] = makeCanvas(64, 64);
  const g = c.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, '#ffe066'); g.addColorStop(0.5, '#ff8ad0'); g.addColorStop(1, '#6ad8ff');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(3, 3, 58, 58);
  c.fillStyle = '#fff'; c.font = 'bold 46px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 32, 35);
  return cv;
}

/** 卡丁车模型：车身、前翼、尾翼、四轮和车手，合并成一个网格 */
function kartMesh(color) {
  const dk = new THREE.Color(color).multiplyScalar(0.6).getHex(), b = new Builder();
  b.box(1.1, 0.3, 2.3, [dk, color], 0, 0.4, 0).box(0.7, 0.26, 0.9, [dk, color], 0, 0.42, 1.35).box(1.5, 0.08, 0.34, dk, 0, 0.3, 1.9)        // 车身、车鼻、前翼
    .box(0.36, 0.3, 1.1, color, -0.72, 0.42, -0.2).box(0.36, 0.3, 1.1, color, 0.72, 0.42, -0.2)                                          // 侧箱
    .box(1.5, 0.1, 0.4, color, 0, 1.05, -1.2).box(0.1, 0.5, 0.3, dk, -0.6, 0.8, -1.2).box(0.1, 0.5, 0.3, dk, 0.6, 0.8, -1.2)             // 尾翼
    .box(0.6, 0.5, 0.5, 0x2a2e36, 0, 0.6, -0.75)                                                                                         // 发动机
    .box(0.56, 0.5, 0.4, [0x2c3550, 0x4a5a86], 0, 0.82, -0.15, -0.15).sphere(0.27, color, 0, 1.24, -0.1, 1, 1, 1, 8).box(0.36, 0.14, 0.1, 0x16181c, 0, 1.24, 0.14)   // 车手、头盔、面罩
    .torus(0.2, 0.04, 0x16181c, 0, 0.82, 0.32, 0.5, 0, 0, 8);
  for (const sx of [-1, 1]) { b.cyl(0.34, 0.34, 0.3, 0x18181c, sx * 0.86, 0.34, 1.05, 0, 0, Math.PI / 2, 10).cyl(0.4, 0.4, 0.38, 0x18181c, sx * 0.9, 0.4, -0.95, 0, 0, Math.PI / 2, 10); }
  return b.mesh(MAT.vcFlat, true);
}

export class View {
  /**
   * @param {object} stage 共用渲染舞台
   * @param {import('./race.js').Race} race
   * @param {(ev:object)=>void} onEvent 把比赛事件转给界面
   */
  constructor(stage, race, onEvent) {
    this.stage = stage; this.race = race; this.onEvent = onEvent;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1400);
    this.time = 0; this.fov = 62; this.shake = 0;
    this.disposables = [];
    const T = race.track, th = this.th = THEMES[T.def.theme];
    this.buildTrack(T, th);
    this.fire = new Particles(this.scene, { max: 600, additive: true });
    this.smoke = new Particles(this.scene, { max: 260, additive: false });

    // 卡丁车
    this.kv = race.karts.map((k) => {
      const g = new THREE.Group(), body = kartMesh(k.driver.color);
      g.add(body);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(1.9, 12, 10), new THREE.MeshBasicMaterial({ color: 0x6ad8ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
      shield.position.y = 0.8; shield.visible = false; g.add(shield);
      this.scene.add(g);
      return { k, g, body, shield, slide: 0, lean: 0, sparkT: 0 };
    });
    const p = race.player;
    this.camYaw = p.yaw; this.cx = p.x; this.cz = p.z;

    // 道具箱、香蕉皮、导弹
    const btex = canvasTexture(boxTex());
    this.boxMat = new THREE.MeshBasicMaterial({ map: btex, transparent: true, opacity: 0.92 });
    this.boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    this.boxes = race.boxes.map((b) => { const m = new THREE.Mesh(this.boxGeo, this.boxMat); m.position.set(b.x, 1.3, b.z); this.scene.add(m); return m; });
    this.bananaGeo = new Builder().torus(0.45, 0.16, [0xe8b020, 0xfff06a], 0, 0.25, 0, Math.PI / 2, 0, 0, 8).cone(0.14, 0.3, 0x6a4a1a, 0.45, 0.3, 0).build(true);
    this.missileGeo = new Builder().cyl(0.22, 0.22, 1.3, [0xd0d4dc, 0xffffff], 0, 0, 0, Math.PI / 2, 0, 0, 8).cone(0.22, 0.5, 0xe03a2e, 0, 0, 0.9, Math.PI / 2, 0, 0, 8).box(0.9, 0.05, 0.4, 0xe03a2e, 0, 0, -0.5).box(0.05, 0.9, 0.4, 0xe03a2e, 0, 0, -0.5).build(true);
    this.bananaViews = new Map(); this.missileViews = new Map();
    this.disposables.push(btex, this.boxMat, this.boxGeo, this.bananaGeo, this.missileGeo);

    const blob = blobShadow();
    this.shadows = new THREE.InstancedMesh(blob.geo, blob.mat, RACERS);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 2;
    this.scene.add(this.shadows);

    stage.onResize(() => this.layout());
    stage.onQuality(() => this.layout());
  }

  layout() {
    const s = this.stage, cam = this.camera;
    cam.aspect = s.aspect; this.baseFov = s.portrait ? 80 : 62; cam.fov = this.fov = this.baseFov;
    cam.updateProjectionMatrix();
    this.fire.setViewport(s.height, cam.fov, s.pixelRatio); this.smoke.setViewport(s.height, cam.fov, s.pixelRatio);
  }

  /** 生成赛道、护栏、起点拱门、周围的景物、天空和灯光 */
  buildTrack(T, th) {
    const S = T.s, N = T.n, h = T.half, scene = this.scene, D = this.disposables;
    const tex = (cv, rep) => { const t = canvasTexture(cv, { repeat: rep, aniso: 4 }); D.push(t); return t; };
    // 一条沿赛道的带子：a、b 是相对中心线的横向位置，ya、yb 是高度；贴图沿赛道方向每 vlen 米重复一次
    const ribbon = (a, b, ya, yb, mat, vlen) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const s = S[i % N], d = i === N ? T.length : s.d;
        pos.push(s.x + s.nx * a, ya, s.z + s.nz * a, s.x + s.nx * b, yb, s.z + s.nz * b);
        uv.push(0, d / vlen, 1, d / vlen);
        if (i < N) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; m.frustumCulled = false; scene.add(m); D.push(g, mat);
      return m;
    };
    const lam = (map, o = {}) => new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide, ...o });
    ribbon(h, -h, 0.03, 0.03, lam(tex(roadTex(th), [1, 1]), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 9);      // 路面
    const curb = tex(stripeTex('#d8362c', '#f4f4f4', true), [1, 1]);
    ribbon(h + 1.3, h, 0.06, 0.04, lam(curb), 3); ribbon(-h, -h - 1.3, 0.04, 0.06, lam(curb), 3);                                                // 路肩
    const wall = tex(stripeTex(th.wallA, th.wallB, false), [1, 1]);
    ribbon(h + 1.3, h + 1.3, 1.15, 0, lam(wall), 4); ribbon(-h - 1.3, -h - 1.3, 0, 1.15, lam(wall), 4);                                          // 护栏

    // 地面
    const [gcv, gc] = makeCanvas(128, 128), rnd = makeRng(21), gcol = new THREE.Color(th.ground);
    gc.fillStyle = '#' + gcol.getHexString(); gc.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) { gc.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)'; gc.fillRect(rnd() * 128, rnd() * 128, 2 + rnd() * 4, 2 + rnd() * 4); }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const gg = new THREE.PlaneGeometry(1600, 1600); gg.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: tex(gcv, [160, 160]) }));
    ground.position.set(mx, 0, mz); scene.add(ground); D.push(gg, ground.material);

    // 起点线和拱门
    const s0 = S[0], yaw0 = Math.atan2(s0.tx, s0.tz);
    const lg = new THREE.PlaneGeometry(h * 2, 3); lg.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ map: tex(checkerTex(), [Math.round(h / 2), 1]), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    line.position.set(s0.x, 0.05, s0.z); line.rotation.y = yaw0; scene.add(line); D.push(lg, line.material);
    const gate = new Builder().box(1, 7, 1, [0x8a2f2f, 0xe04b3d], -h - 2, 3.5, 0).box(1, 7, 1, [0x8a2f2f, 0xe04b3d], h + 2, 3.5, 0).box(h * 2 + 5, 1.6, 0.8, [0xe04b3d, 0xffd84a], 0, 7.2, 0).box(h * 2 + 4, 0.3, 0.9, 0xffffff, 0, 6.3, 0).mesh(MAT.vcFlat, true);
    gate.position.set(s0.x, 0, s0.z); gate.rotation.y = yaw0; scene.add(gate); D.push(gate.geometry);

    // 景物：赛道外面随机摆，离路面太近的不要
    const b = new Builder(), theme = T.def.theme;
    const near = (x, z) => { for (let i = 0; i < N; i += 3) if ((S[i].x - x) ** 2 + (S[i].z - z) ** 2 < (h + 5) ** 2) return true; return false; };
    for (let k = 0; k < 520; k++) {
      const x = x0 - 90 + rnd() * (x1 - x0 + 180), z = z0 - 90 + rnd() * (z1 - z0 + 180), sc = 0.8 + rnd() * 1.1;
      if (near(x, z)) continue;
      if (theme === 'forest') {
        if (rnd() < 0.82) { b.cyl(0.25 * sc, 0.4 * sc, 2 * sc, [0x4a3524, 0x6b4a30], x, sc, z, 0, 0, 0, 5).cone(2 * sc, 3.6 * sc, [0x245a30, 0x58a858], x, 3.4 * sc, z, 0, rnd() * 3, 0, 6).cone(1.4 * sc, 2.8 * sc, [0x2f6e3a, 0x74c26a], x, 5.2 * sc, z, 0, rnd() * 3, 0, 6); }
        else b.rock(1.2 * sc, [0x5c6470, 0x9aa2ae], x, 0.5 * sc, z, rnd(), rnd() * 6, rnd(), 1, 0.8, 1);
      } else if (theme === 'desert') {
        const r = rnd();
        if (r < 0.4) { b.cyl(0.4 * sc, 0.45 * sc, 3.4 * sc, [0x2f7a3a, 0x6ac06a], x, 1.7 * sc, z, 0, 0, 0, 7).cyl(0.26 * sc, 0.26 * sc, 1.4 * sc, [0x2f7a3a, 0x6ac06a], x + 0.9 * sc, 2.3 * sc, z, 0, 0, 0, 6).box(0.9 * sc, 0.3 * sc, 0.3 * sc, 0x3f8f4a, x + 0.5 * sc, 1.7 * sc, z); }
        else if (r < 0.85) b.rock((1 + rnd() * 2.4) * sc, [0x9a5a34, 0xe0a060], x, 0.6 * sc, z, rnd(), rnd() * 6, rnd(), 1, 0.7 + rnd() * 0.8, 1);
        else b.cyl(5 * sc, 7 * sc, 10 * sc, [0x8a4a2c, 0xe09a5a], x, 5 * sc, z, 0, rnd(), 0, 7);                                             // 平顶山
      } else {
        if (rnd() < 0.7) { b.cyl(0.25 * sc, 0.4 * sc, 2 * sc, [0x4a3524, 0x6b4a30], x, sc, z, 0, 0, 0, 5).cone(2 * sc, 3.6 * sc, [0x2f6a5a, 0xf4fbff], x, 3.4 * sc, z, 0, rnd() * 3, 0, 6).cone(1.4 * sc, 2.8 * sc, [0x4a8a7a, 0xffffff], x, 5.2 * sc, z, 0, rnd() * 3, 0, 6); }
        else b.rock((1 + rnd() * 1.6) * sc, [0x6ab8e8, 0xe8f8ff], x, 0.7 * sc, z, rnd(), rnd() * 6, rnd(), 1, 1 + rnd(), 1);                 // 冰块
      }
    }
    // 远处一圈山，挡住地平线
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * TAU + rnd() * 0.3, r = 420 + rnd() * 120, hh = 60 + rnd() * 90;
      b.cone(110 + rnd() * 80, hh, theme === 'desert' ? [0x9a5a34, 0xe8b070] : theme === 'ice' ? [0x8fb4d8, 0xffffff] : [0x3a6a48, 0x9ac0a0], mx + Math.cos(ang) * r, hh / 2 - 2, mz + Math.sin(ang) * r, 0, rnd() * 3, 0, 7);
    }
    const scn = b.mesh(MAT.vcFlat, true); scn.matrixAutoUpdate = false; scene.add(scn); D.push(scn.geometry);

    // 天空：渐变球
    const sg = new THREE.SphereGeometry(1200, 16, 10), sp = sg.attributes.position, sc2 = new Float32Array(sp.count * 3), cTop = new THREE.Color(th.sky), cLow = new THREE.Color(th.fog), c = new THREE.Color();
    for (let i = 0; i < sp.count; i++) { c.copy(cLow).lerp(cTop, clamp(sp.getY(i) / 700, 0, 1)); sc2[i * 3] = c.r; sc2[i * 3 + 1] = c.g; sc2[i * 3 + 2] = c.b; }
    sg.setAttribute('color', new THREE.BufferAttribute(sc2, 3));
    this.sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10; scene.add(this.sky); D.push(sg, this.sky.material);
    scene.fog = new THREE.Fog(th.fog, 120, 620);
    scene.background = new THREE.Color(th.fog);
    scene.add(new THREE.HemisphereLight(0xffffff, th.ground, 1.25));
    const sun = new THREE.DirectionalLight(th.sun, 2); sun.position.set(-60, 100, 40); scene.add(sun);
  }

  /* ---------------------------------------------------------- 事件 → 特效和音效 */
  handle(ev) {
    const P = this.race.player, mine = ev.k === P;
    switch (ev.type) {
      case 'boost': if (mine) { Sfx.play('boost'); this.shake = Math.max(this.shake, 0.25); } break;
      case 'spin': this.smoke.emit(ev.k.x, 0.6, ev.k.z, { n: 14, speed: [2, 6], life: [0.4, 0.9], size: [0.8, 1.6], grow: 2.2, color: 0xe8e8e8, alpha: 0.7 }); if (mine) { Sfx.play('crash'); this.shake = 0.6; } break;
      case 'block': this.fire.emit(ev.k.x, 1, ev.k.z, { n: 14, speed: [3, 7], life: [0.2, 0.5], size: [0.4, 0.8], color: 0x6ad8ff }); break;
      case 'hit': this.fire.emit(ev.x, 1, ev.z, { n: 30, speed: [4, 12], life: [0.3, 0.7], size: [0.8, 1.8], color: 0xff8a20, color2: 0xfff0a0 }); if (Math.hypot(ev.x - P.x, ev.z - P.z) < 80) Sfx.play('boom'); break;
      case 'scrape': this.fire.emit(ev.x, 0.5, ev.z, { n: 3, speed: [2, 6], life: [0.12, 0.3], size: [0.2, 0.4], color: 0xffd080, gravity: -10 }); if (mine) Sfx.play('hit', 0.2); break;
      case 'bump': if (mine) Sfx.play('hit', 0.2); break;
      case 'item': if (mine) Sfx.play('coin'); break;
      case 'nitro': if (mine) Sfx.play('levelup'); break;
      case 'use': if (mine) Sfx.play('click'); break;
    }
    this.onEvent(ev);
  }

  /* ---------------------------------------------------------- 每帧更新 */
  update(alpha, dt) {
    const race = this.race, P = race.player;
    this.time += dt;
    for (const ev of race.events) this.handle(ev);
    race.events.length = 0;

    let n = 0;
    for (const v of this.kv) {
      const k = v.k, x = k.px + (k.x - k.px) * alpha, z = k.pz + (k.z - k.pz) * alpha;
      const yaw = k.pyaw + angDiff(k.pyaw, k.yaw) * alpha;
      // 漂移时车身侧过来并向弯内倾斜
      v.slide = damp(v.slide, k.drifting ? k.driftDir * -KART.driftSlide : 0, 8, dt);
      v.lean = damp(v.lean, k.drifting ? k.driftDir * 0.12 : 0, 8, dt);
      v.g.position.set(x, Math.abs(Math.sin(this.time * 30 + k.id)) * 0.02 * Math.min(1, k.v / 10), z);
      v.g.rotation.set(0, yaw + v.slide + k.spinA, v.lean);
      v.shield.visible = k.shieldT > 0 || k.god;
      if (v.shield.visible) v.shield.material.color.setHex(k.god ? 0xffd35a : 0x6ad8ff);
      // 脚下阴影
      const a = this.shadows.instanceMatrix.array, o = n++ * 16;
      a[o] = 3.6; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0; a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 3.6; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = 0.07; a[o + 14] = z; a[o + 15] = 1;
      // 尾部特效：漂移火花（颜色表示攒到第几档）、加速火焰
      const bx = x - Math.sin(yaw) * 1.3, bz = z - Math.cos(yaw) * 1.3;
      if (k.drifting && (v.sparkT -= dt) <= 0) {
        v.sparkT = 0.03;
        let tier = 0; KART.miniBoost.forEach((m, i) => { if (k.charge >= m[0]) tier = i + 1; });
        this.fire.emit(bx, 0.25, bz, { n: 2, speed: [2, 6], dir: [0, 1, 0], spread: 0.8, life: [0.15, 0.35], size: [0.25, 0.5], color: SPARK[tier], gravity: -8, r: 0.6 });
        this.smoke.emit(bx, 0.3, bz, { n: 1, speed: [0.5, 1.5], life: [0.3, 0.6], size: [0.6, 1], grow: 2.2, color: 0xf0f0f0, alpha: 0.35, r: 0.5 });
      }
      if (k.boostT > 0) this.fire.emit(bx, 0.55, bz, { n: 2, speed: [3, 7], dir: [-Math.sin(yaw), 0.1, -Math.cos(yaw)], spread: 0.25, life: [0.12, 0.28], size: [0.5, 1], color: k.boostKind >= 3 ? 0x4ab8ff : 0xff8a20, color2: 0xffffff });
    }
    this.shadows.count = n; this.shadows.instanceMatrix.needsUpdate = true;

    // 道具箱、香蕉皮、导弹
    race.boxes.forEach((b, i) => { const m = this.boxes[i]; m.visible = b.t <= 0; m.rotation.y = this.time * 1.6 + i; m.rotation.x = 0.4; m.position.y = 1.3 + Math.sin(this.time * 3 + i) * 0.15; });
    this.sync(race.bananas, this.bananaViews, this.bananaGeo, (b, m) => { m.position.set(b.x, 0.05, b.z); m.rotation.y = b.x; });
    this.sync(race.missiles, this.missileViews, this.missileGeo, (s, m) => {
      const x = s.px + (s.x - s.px) * alpha, z = s.pz + (s.z - s.pz) * alpha;
      m.position.set(x, 1, z); m.rotation.y = Math.atan2(s.x - s.px, s.z - s.pz);
      this.smoke.emit(x, 1, z, { n: 1, speed: [0, 1], life: [0.3, 0.6], size: [0.5, 0.9], grow: 2.4, color: 0xdddddd, alpha: 0.5 });
      this.fire.emit(x, 1, z, { n: 1, speed: [0, 1], life: [0.1, 0.2], size: [0.5, 0.8], color: 0xff9a30 });
    });

    // 追尾镜头：跟着“实际行进方向”，所以漂移时能看到车身侧过来；加速时视野拉宽
    const px = P.px + (P.x - P.px) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
    this.camYaw += angDiff(this.camYaw, P.spinT > 0 ? this.camYaw : P.vdir) * (1 - Math.exp(-dt * 6));
    const port = this.stage.portrait, dist = port ? 8.6 : 7.4, hgt = port ? 4.2 : 3.3;
    const cam = this.camera, fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    let sx = 0, sy = 0;
    if (this.shake > 0.01) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake *= Math.exp(-dt * 8); }
    cam.position.set(px - fx * dist + sx, hgt + sy, pz - fz * dist);
    cam.lookAt(px + fx * 5, 1.2, pz + fz * 5);
    const want = this.baseFov + (P.boostT > 0 ? 13 : 0) + Math.min(6, P.v * 0.12);
    this.fov = damp(this.fov, want, 5, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.sky.position.set(px, 0, pz);

    this.fire.update(dt); this.smoke.update(dt);
    this.stage.render(this.scene, cam, dt);
  }

  /** 让一组游戏对象各有一个网格：新出现的创建，消失的移除 */
  sync(list, views, geo, place) {
    for (const o of list) {
      let m = views.get(o);
      if (!m) { m = new THREE.Mesh(geo, MAT.vcFlat); this.scene.add(m); views.set(o, m); }
      place(o, m);
    }
    for (const [o, m] of views) if (!list.includes(o)) { this.scene.remove(m); views.delete(o); }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
    this.scene.fog = null;
  }
}
