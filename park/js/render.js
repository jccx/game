// 梦想乐园：画面。Three.js 低多边形斜俯视：地面网格、路、建筑、会动的游乐设施、游客小人。
// 拖动平移、双指/滚轮缩放；轻点地图是建造落点（由 HUD 接手）。
import * as THREE from '../../shared/js/three.js';
import { Builder, MAT, makeCanvas, canvasTexture } from '../../shared/js/geo.js';
import { GRID, BUILDING } from './config.js';
import { clamp, damp } from '../../shared/js/util.js';

const TILE = GRID.tile, W = GRID.w, D = GRID.d;
/** 格子转世界坐标（中心点） */
export const tileToWorld = (x, z) => [(x - W / 2 + 0.5) * TILE, (z - D / 2 + 0.5) * TILE];
/** 世界坐标转格子 */
export const worldToTile = (wx, wz) => [Math.floor(wx / TILE + W / 2), Math.floor(wz / TILE + D / 2)];

/** 草地贴图：绿色底 + 每格淡淡的网格线，画在一张画布上当地面贴图 */
function groundTexture() {
  const [cv, c] = makeCanvas(512, 384);
  c.fillStyle = '#69b455'; c.fillRect(0, 0, 512, 384);
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  for (let i = 0; i < 900; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)'; c.fillRect(rnd() * 512, rnd() * 384, 2 + rnd() * 4, 2 + rnd() * 4); }
  c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 1;
  for (let x = 0; x <= W; x++) { c.beginPath(); c.moveTo((x / W) * 512, 0); c.lineTo((x / W) * 512, 384); c.stroke(); }
  for (let z = 0; z <= D; z++) { c.beginPath(); c.moveTo(0, (z / D) * 384); c.lineTo(512, (z / D) * 384); c.stroke(); }
  return canvasTexture(cv, { aniso: 4 });
}

/** 一个建筑的静态造型（合并成一个网格）；会动的部分另外返回一个组 */
function buildingMesh(def, t) {
  const b = new Builder(), cx = 0, cz = 0;
  const w = def.w * TILE, d = def.d * TILE;
  const col = def.color, dk = new THREE.Color(col).multiplyScalar(0.55).getHex();
  const anim = { kind: def.id, spin: null, swing: null, cars: [] };
  switch (def.id) {
    case 'carousel': {
      b.cyl(w * 0.42, w * 0.46, 0.5, dk, cx, 0.25, cz, 0, 0, 0, 12)          // 底座
        .cyl(0.3, 0.3, 3.2, 0xd8d8e8, cx, 1.9, cz, 0, 0, 0, 8);               // 中柱
      const top = new THREE.Group();
      const tb = new Builder();
      tb.cone(w * 0.55, 1.6, [col, 0xffe066], 0, 4.2, 0, 0, 0, 0, 10)          // 尖顶
        .cyl(w * 0.48, w * 0.48, 0.25, col, 0, 3.4, 0, 0, 0, 0, 12);          // 顶盘
      for (let i = 0; i < 6; i++) {                                            // 六匹小马
        const a = (i / 6) * Math.PI * 2;
        tb.box(0.5, 0.9, 1.1, i % 2 ? 0xffffff : 0xffd166, Math.cos(a) * w * 0.3, 1.1, Math.sin(a) * w * 0.3, 0, -a, 0)
          .cyl(0.07, 0.07, 2.6, 0xf2c230, Math.cos(a) * w * 0.3, 1.8, Math.sin(a) * w * 0.3, 0, 0, 0, 6);
      }
      top.add(new THREE.Mesh(tb.build(true), MAT.vcFlat));
      top.position.set(cx, 0, cz);
      anim.spin = top;
      break;
    }
    case 'wheel': {
      b.box(0.6, 4.5, 0.6, dk, -w * 0.32, 2.25, 0, 0, 0, 0.35).box(0.6, 4.5, 0.6, dk, w * 0.32, 2.25, 0, 0, 0, -0.35) // 两条支架
        .box(w * 0.7, 0.5, 0.8, dk, 0, 0.25, 0);
      const wheel = new THREE.Group();
      const wb = new Builder();
      wb.torus(w * 0.42, 0.16, col, 0, 0, 0, 0, 0, 0, 14);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        wb.box(0.9, 0.9, 0.9, [0xffe066, 0xff8a5a, 0x6ad8ff, 0x9a5be0][i % 4], Math.cos(a) * w * 0.42, Math.sin(a) * w * 0.42, 0);
      }
      wheel.add(new THREE.Mesh(wb.build(true), MAT.vcFlat));
      wheel.position.set(0, 5.2, 0);
      anim.spin = wheel;
      anim.spinAxis = 'z';
      break;
    }
    case 'bumper': {
      b.box(w, 0.3, d, 0x8a94a8, cx, 0.15, cz)                                 // 场地
        .box(w, 1.1, 0.3, dk, cx, 0.55, -d / 2 + 0.15).box(w, 1.1, 0.3, dk, cx, 0.55, d / 2 - 0.15);
      for (let i = 0; i < 4; i++) {
        const car = new THREE.Group();
        const cb = new Builder();
        cb.box(1.4, 0.5, 2, [0xe2523f, 0x4a8fe8, 0xf2c230, 0x52b85a][i], 0, 0.5, 0)
          .box(0.9, 0.5, 0.9, 0x2a2e36, 0, 0.95, -0.2);
        car.add(new THREE.Mesh(cb.build(true), MAT.vcFlat));
        anim.cars.push({ g: car, phase: (i / 4) * Math.PI * 2, r: Math.min(w, d) * 0.28, speed: 0.5 + i * 0.07 });
      }
      break;
    }
    case 'pirate': {
      b.box(0.7, 4.2, 0.7, dk, -w * 0.4, 2.1, 0).box(0.7, 4.2, 0.7, dk, w * 0.4, 2.1, 0)
        .box(w, 0.4, d * 0.5, dk, 0, 0.2, 0);
      const ship = new THREE.Group();
      const sb = new Builder();
      sb.box(w * 0.7, 0.7, 1.6, [0x8a5a3a, col], 0, 0, 0)
        .box(w * 0.7, 1.6, 0.3, col, 0, 0.8, 0.7).box(w * 0.7, 1.6, 0.3, col, 0, 0.8, -0.7)
        .cyl(0.12, 0.12, 4, 0xd8d8e8, 0, 2, 0, 0, 0, 0, 6);
      for (let i = -2; i <= 2; i++) sb.box(0.6, 0.6, 0.6, 0xffe066, i * 1.1, 0.6, 0);
      ship.add(new THREE.Mesh(sb.build(true), MAT.vcFlat));
      ship.position.set(0, 4.4, 0);
      anim.swing = ship;
      break;
    }
    case 'coaster': {
      b.box(w, 0.6, d, 0x9a94a8, cx, 0.3, cz)                                  // 站台
        .box(w + 1, 0.3, d + 1, col, cx, 1.9, cz)                             // 雨棚
        .box(0.4, 1.4, 0.4, dk, -w / 2 + 0.2, 1.1, -d / 2 + 0.2).box(0.4, 1.4, 0.4, dk, w / 2 - 0.2, 1.1, -d / 2 + 0.2)
        .box(0.4, 1.4, 0.4, dk, -w / 2 + 0.2, 1.1, d / 2 - 0.2).box(0.4, 1.4, 0.4, dk, w / 2 - 0.2, 1.1, d / 2 - 0.2);
      break;
    }
    default: { // 商店 / 厕所：小房子 + 遮阳篷
      b.box(w * 0.9, 2.2, d * 0.9, [dk, col], cx, 1.1, cz)
        .box(w * 1.1, 0.25, d * 0.7, 0xffffff, cx, 2.5, cz + d * 0.2, 0.25, 0, 0)
        .box(w * 0.5, 1.4, 0.15, 0x2a2e36, cx, 0.7, cz + d * 0.45);
    }
  }
  const mesh = b.count ? b.mesh(MAT.vcFlat, true) : null;
  return { mesh, anim };
}

export class View {
  /**
   * @param {object} stage 共用渲染舞台
   * @param {import('./game.js').Park} park
   * @param {object} [o]
   * @param {(tile:{x:number,z:number})=>void} [o.onTap] 轻点地图的回调（格子坐标）
   */
  constructor(stage, park, o = {}) {
    this.stage = stage; this.park = park; this.onTap = o.onTap || null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 600);
    this.time = 0; this.dirty = true;
    this.disposables = [];
    this.anim = []; // { kind, spin, swing, cars, building }
    this.coasterCar = null; this.coasterTrack = null;
    // 镜头：目标点 + 距离（缩放），固定俯视角度；竖屏时拉大视野，不然只能看到几格
    this.camTarget = { x: 0, z: 8 };
    this.camDist = 85;
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.scene.background = new THREE.Color(0x9fd8f0);
    this.scene.fog = new THREE.Fog(0x9fd8f0, 160, 320);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x69b455, 1.3));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.8);
    sun.position.set(-50, 90, 30); this.scene.add(sun);

    // 地面
    const gg = new THREE.PlaneGeometry(W * TILE + 80, D * TILE + 80); gg.rotateX(-Math.PI / 2);
    const gtex = groundTexture();
    this.ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: gtex }));
    this.scene.add(this.ground);
    this.disposables.push(gg, gtex, this.ground.material);
    // 入口大门：两根柱子 + 横幅
    const gate = new Builder()
      .box(1.2, 7, 1.2, [0x8a2f2f, 0xe04b3d], -5, 3.5, 0).box(1.2, 7, 1.2, [0x8a2f2f, 0xe04b3d], 5, 3.5, 0)
      .box(11.5, 1.8, 0.8, [0xe04b3d, 0xffd84a], 0, 7.2, 0).mesh(MAT.vcFlat, true);
    const [gx, gz] = tileToWorld(11.5, 17);
    gate.position.set(gx, 0, gz); this.scene.add(gate);
    this.disposables.push(gate.geometry);

    // 建筑和路的容器（重建时清空重建）
    this.world = new THREE.Group(); this.scene.add(this.world);
    // 游客：一个 InstancedMesh，最多 60 人
    const vgeo = new THREE.SphereGeometry(0.55, 8, 6);
    const vmat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.visitors = new THREE.InstancedMesh(vgeo, vmat, 60);
    this.visitors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.visitors.frustumCulled = false;
    this.scene.add(this.visitors);
    this._dummy = new THREE.Object3D();
    this._vcolor = new THREE.Color();
    this.disposables.push(vgeo, vmat);

    // 选中格高亮（建造时看落点）
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.35, depthWrite: false }));
    hl.rotation.x = -Math.PI / 2; hl.position.y = 0.12; hl.visible = false;
    this.highlight = hl; this.scene.add(hl);
    this.disposables.push(hl.geometry, hl.material);

    stage.onResize(() => this.layout());
    this._bind();
    this.layout();
  }

  layout() {
    const s = this.stage;
    this.camera.aspect = s.aspect;
    // 竖屏时视野拉大（跟疾风卡丁一样的做法），不然横向只能看到几格
    const wantFov = s.portrait ? 72 : 50;
    if (Math.abs(this.camera.fov - wantFov) > 0.1) this.camera.fov = wantFov;
    this.camera.updateProjectionMatrix();
  }

  /** 屏幕坐标转地图格子；点到地图外返回 null */
  pickTile(clientX, clientY) {
    const r = this.stage.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    this._ray.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = new THREE.Vector3();
    if (!this._ray.ray.intersectPlane(this._plane, hit)) return null;
    const [x, z] = worldToTile(hit.x, hit.z);
    if (x < 0 || x >= W || z < 0 || z >= D) return null;
    return { x, z };
  }

  /** 格子转屏幕坐标（测试用：算出某格在屏幕上的点） */
  tileToScreen(x, z) {
    const [wx, wz] = tileToWorld(x, z);
    const v = new THREE.Vector3(wx, 0.5, wz).project(this.camera);
    const r = this.stage.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width + r.left, y: (-v.y + 1) / 2 * r.height + r.top, behind: v.z > 1 };
  }

  _bind() {
    const cv = this.stage.canvas, pts = new Map();
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
      if (pts.size === 2) {
        const p = [...pts.values()];
        this._pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), dist: this.camDist };
        this._drag = null;
      } else this._drag = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.abs(dx) + Math.abs(dy); p.x = e.clientX; p.y = e.clientY;
      if (this._pinch && pts.size === 2) {
        const q = [...pts.values()], d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
        if (d > 10) this.camDist = clamp(this._pinch.dist * (this._pinch.d / d), 42, 150);
        return;
      }
      if (this._drag) {
        // 拖动平移：屏幕位移按当前距离换算成世界位移
        const k = this.camDist / 620;
        this.camTarget.x = clamp(this.camTarget.x - dx * k, -46, 46);
        this.camTarget.z = clamp(this.camTarget.z + dy * k, -34, 34);
      }
    });
    const up = (e) => {
      const p = pts.get(e.pointerId);
      if (p && p.moved < 8 && performance.now() - p.t < 350) {
        const tile = this.pickTile(e.clientX, e.clientY);
        if (tile) this.onTap?.(tile);
      }
      pts.delete(e.pointerId);
      if (pts.size < 2) this._pinch = null;
      if (pts.size === 0) this._drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = clamp(this.camDist * (e.deltaY < 0 ? 0.9 : 1.11), 42, 150);
    }, { passive: false });
  }

  onEvent(ev) {
    if (ev.type === 'build' || ev.type === 'demolish' || ev.type === 'coaster') this.dirty = true;
  }

  /** 重建路和建筑（建造/拆除/读档后调用；平时只动动画，不重建） */
  rebuild() {
    const park = this.park;
    // 清掉旧的建筑组（几何体一并释放）
    this.world.traverse((o) => { if (o.isMesh && o.geometry && o.userData.owned) o.geometry.dispose(); });
    this.world.clear();
    this.anim = [];
    // 路：每格一块薄板，合并成一个网格
    const pb = new Builder();
    for (const k of park.paths) {
      const [x, z] = k.split(',').map(Number);
      const [wx, wz] = tileToWorld(x, z);
      pb.box(TILE * 0.96, 0.18, TILE * 0.96, [0x9a8a6a, 0xc9b98a], wx, 0.09, wz);
    }
    // 入口广场：石板色
    for (let x = 10; x <= 13; x++) {
      const [wx, wz] = tileToWorld(x, 16);
      pb.box(TILE * 0.96, 0.18, TILE * 0.96, [0x8a8a92, 0xb9b9c2], wx, 0.09, wz);
    }
    if (pb.count) {
      const m = pb.mesh(MAT.vcFlat, true); m.userData.owned = true; this.world.add(m);
    }
    // 建筑
    for (const b of park.buildings) {
      const def = BUILDING[b.type];
      const [wx, wz] = tileToWorld(b.x + (b.w - 1) / 2, b.z + (b.d - 1) / 2);
      const g = new THREE.Group();
      g.position.set(wx, 0, wz);
      const { mesh, anim } = buildingMesh(def, this.time);
      if (mesh) { mesh.userData.owned = true; g.add(mesh); }
      if (anim.spin) g.add(anim.spin);
      if (anim.swing) g.add(anim.swing);
      for (const c of anim.cars || []) g.add(c.g);
      this.world.add(g);
      this.anim.push({ ...anim, building: b, group: g });
    }
    // 过山车轨道：每段一小块铁轨
    const tr = park.coasterTrace;
    if (tr.tiles.length) {
      const tb = new Builder();
      for (const [x, z] of tr.tiles) {
        const [wx, wz] = tileToWorld(x, z);
        tb.box(TILE * 0.7, 0.35, TILE * 0.7, tr.closed ? [0x8a2f2f, 0xe04b3d] : [0x6a6a72, 0x9a9aa2], wx, 0.5, wz);
      }
      const tm = tb.mesh(MAT.vcFlat, true); tm.userData.owned = true; this.world.add(tm);
      // 过山车小车：闭环后沿轨道跑
      if (!this.coasterCar) {
        const cb = new Builder().box(1.6, 0.7, 2.6, [0xe04b3d, 0xffd84a], 0, 0.5, 0).mesh(MAT.vcFlat, true);
        this.coasterCar = cb; this.scene.add(cb);
      }
      this.coasterCar.visible = tr.closed;
    } else if (this.coasterCar) this.coasterCar.visible = false;
    this.dirty = false;
  }

  /** 设置建造高亮格（HUD 选了工具后跟随手指/鼠标） */
  setHighlight(x, z, w = 1, d = 1, ok = true) {
    if (x === null || x === undefined) { this.highlight.visible = false; return; }
    const [wx, wz] = tileToWorld(x + (w - 1) / 2, z + (d - 1) / 2);
    this.highlight.position.set(wx, 0.12, wz);
    this.highlight.scale.set(w, d, 1);
    this.highlight.material.color.setHex(ok ? 0xffe066 : 0xff5a5a);
    this.highlight.visible = true;
  }

  update(alpha, fdt) {
    const dt = Math.min(fdt, 0.05);
    this.time += dt;
    if (this.dirty) this.rebuild();
    const park = this.park;
    // 镜头：固定俯视角度，看向目标点
    const cam = this.camera;
    const el = 0.9; // 俯仰角约 52°
    cam.position.set(this.camTarget.x, this.camDist * Math.sin(el), this.camTarget.z + this.camDist * Math.cos(el));
    cam.lookAt(this.camTarget.x, 0, this.camTarget.z);
    // 游乐设施动画
    for (const a of this.anim) {
      if (a.spin) {
        if (a.kind === 'wheel') a.spin.rotation.z += dt * 0.35;
        else a.spin.rotation.y += dt * 0.8;
      }
      if (a.swing) a.swing.rotation.z = Math.sin(this.time * 1.1) * 0.55;
      for (const c of a.cars || []) {
        const an = this.time * c.speed + c.phase;
        c.g.position.set(Math.cos(an) * c.r, 0.35, Math.sin(an) * c.r);
        c.g.rotation.y = -an;
      }
    }
    // 过山车小车沿轨道跑
    const tr = park.coasterTrace;
    if (this.coasterCar && this.coasterCar.visible && tr.tiles.length) {
      const idx = Math.floor(this.time * 1.2) % tr.tiles.length;
      const [wx, wz] = tileToWorld(tr.tiles[idx][0], tr.tiles[idx][1]);
      this.coasterCar.position.set(wx, 1.1, wz);
      const nxt = tr.tiles[(idx + 1) % tr.tiles.length];
      const [nx, nz] = tileToWorld(nxt[0], nxt[1]);
      this.coasterCar.rotation.y = Math.atan2(nx - wx, nz - wz);
    }
    // 游客小人（每帧 60 人：坐标换算直接内联算术，不调 tileToWorld，省掉每人两次小数组分配）
    const vs = park.visitors;
    let n = 0;
    for (const v of vs) {
      if (n >= 60) break;
      // 等价于 tileToWorld(v.x - 0.5, v.z - 0.5)：(v.x - W/2) * TILE，(v.z - D/2) * TILE
      const wx = (v.x - W / 2) * TILE, wz = (v.z - D / 2) * TILE;
      this._dummy.position.set(wx, 0.75 + Math.abs(Math.sin(this.time * 6 + v.id)) * 0.06, wz);
      this._dummy.scale.set(1, 1.3, 1);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.updateMatrix();
      this.visitors.setMatrixAt(n, this._dummy.matrix);
      this._vcolor.set(v.color || '#e2523f');
      this.visitors.setColorAt(n, this._vcolor);
      n++;
    }
    this.visitors.count = n;
    this.visitors.instanceMatrix.needsUpdate = true;
    if (this.visitors.instanceColor) this.visitors.instanceColor.needsUpdate = true;
    this.stage.render(this.scene, cam, dt);
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
  }
}
