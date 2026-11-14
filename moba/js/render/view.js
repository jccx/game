// 裂谷争锋：把对局状态画出来。每帧读取 Game 的状态，更新镜头、模型、血条、特效，然后渲染。
// 这里不改变任何游戏规则；Game 可以在没有 View 的情况下独立运行。
import * as THREE from '../../../shared/js/three.js';
import { blobShadow } from '../../../shared/js/geo.js';
import { angDamp, damp, clamp } from '../../../shared/js/util.js';
import { el } from '../../../shared/js/ui.js';
import { Sfx } from '../../../shared/js/audio.js';
import { KIND } from '../entities.js';
import { buildScene, TEAM_COLOR } from './scene.js';
import { buildHero, minionGeometry, buildTower, buildCrystal, buildMonster } from './models.js';
import { MAT } from '../../../shared/js/geo.js';
import { Fx } from './fx.js';

const MAX_INST = 150;          // 血条、脚下阴影的实例上限
const MINION_CAP = 48;         // 每种小兵（按兵种和队伍）的实例上限
const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();

/** 非英雄单位的血条：所有血条合成一次绘制调用，始终朝向镜头 */
function makeBars() {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(MAX_INST * 3), info = new Float32Array(MAX_INST * 3), col = new Float32Array(MAX_INST * 3);
  const mk = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  geo.setAttribute('iPos', mk(pos, 3)); geo.setAttribute('iInfo', mk(info, 3)); geo.setAttribute('iColor', mk(col, 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec3 iPos; attribute vec3 iInfo; attribute vec3 iColor;
      varying vec2 vUv; varying float vFill; varying vec3 vColor;
      void main() {
        vUv = uv; vFill = iInfo.z; vColor = iColor;
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        mv.xy += position.xy * iInfo.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying float vFill; varying vec3 vColor;
      void main() {
        float inner = step(0.04, vUv.x) * step(vUv.x, 0.96) * step(0.2, vUv.y) * step(vUv.y, 0.8);
        float filled = step((vUv.x - 0.04) / 0.92, vFill);
        vec3 c = mix(vec3(0.03, 0.04, 0.06), mix(vec3(0.16, 0.17, 0.2), vColor * (0.75 + 0.5 * vUv.y), filled), inner);
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 20;
  return { mesh, geo, pos, info, col };
}

export class View {
  /**
   * @param {import('../../../shared/js/stage.js').Stage} stage
   * @param {import('../game.js').Game} game
   * @param {HTMLElement} layer   放英雄血条和飘字的 DOM 层
   * @param {(ev:object)=>void} onEvent  把对局事件转给界面（击杀播报等）
   */
  constructor(stage, game, layer, onEvent) {
    this.stage = stage; this.game = game; this.layer = layer; this.onEvent = onEvent;
    this.scene = new THREE.Scene();
    this.world = buildScene(game.map, this.scene, stage.level >= 2);
    this.camera = new THREE.PerspectiveCamera(38, 1, 2, 420);
    this.camX = game.player.x; this.camZ = game.player.z;
    this.time = 0;
    this.project = this.project.bind(this);
    this.fx = new Fx(this.scene, layer, this.project);

    // ---- 英雄 ----
    this.heroViews = game.heroes.map((h) => this.makeHeroView(h));

    // ---- 小兵：每种兵、每个队伍一个实例化网格 ----
    this.batches = {};
    for (const type of ['melee', 'ranged', 'siege']) for (const team of [0, 1]) {
      const m = new THREE.InstancedMesh(minionGeometry(type, team), MAT.vcFlat, MINION_CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.count = 0; m.castShadow = true;
      this.scene.add(m);
      this.batches[type + team] = m;
    }

    // ---- 建筑 ----
    this.structViews = [];
    for (const t of game.towers) this.structViews.push(this.makeStructView(t, buildTower(t.team, t.tier), 8.6 * (t.tier >= 3 ? 1.12 : 1)));
    for (const c of game.crystals) this.structViews.push(this.makeStructView(c, buildCrystal(c.team), 9));

    // ---- 野怪 ----
    this.monsterViews = new Map();

    // ---- 脚下阴影、血条 ----
    const blob = blobShadow();
    this.shadows = new THREE.InstancedMesh(blob.geo, blob.mat, MAX_INST);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 2; this.shadows.count = 0;
    this.scene.add(this.shadows);
    this.bars = makeBars();
    this.scene.add(this.bars.mesh);

    // ---- 敌方防御塔的射程圈和锁定线 ----
    this.towerRing = new THREE.Mesh(this.fx.geo.thin, new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.55, depthWrite: false }));
    this.towerRing.visible = false; this.towerRing.renderOrder = 4;
    this.towerLine = new THREE.Mesh(this.fx.geo.strip, new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.towerLine.visible = false; this.towerLine.renderOrder = 4;
    this.scene.add(this.towerRing, this.towerLine);

    // ---- 实时阴影（只在“高清”档开启）：一块只显示阴影的透明地面 ----
    const sun = this.world.sun;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.002;
    const cg = new THREE.PlaneGeometry(120, 120); cg.rotateX(-Math.PI / 2);
    this.catcher = new THREE.Mesh(cg, new THREE.ShadowMaterial({ opacity: 0.3 }));
    this.catcher.receiveShadow = true; this.catcher.position.y = 0.02; this.catcher.renderOrder = 1;
    this.scene.add(this.catcher);

    stage.onResize(() => this.layout());
    stage.onQuality((q) => {
      sun.castShadow = q.shadows; this.catcher.visible = q.shadows;
      this.shadows.material.opacity = q.shadows ? 0.5 : 1;
      this.layout();
    });
  }

  /** 屏幕尺寸、横竖屏或画质变化后，重新设置镜头参数 */
  layout() {
    const s = this.stage, cam = this.camera, base = this.game.map.cam.dist;
    cam.aspect = s.aspect;
    if (s.portrait) { cam.fov = 50; this.dist = base * 1.62; this.tilt = 0.98; this.lookAhead = -3.5; }      // 竖屏：拉远、视野加大，人物靠上
    else { cam.fov = 38; this.dist = base * (s.aspect < 1.5 ? 1.12 : 1); this.tilt = 0.9; this.lookAhead = -1; }
    cam.updateProjectionMatrix();
    this.fx.setViewport(s.height, cam.fov, s.pixelRatio);
  }

  /* ---------------------------------------------------------- 创建各类单位的视图 */

  makeHeroView(h) {
    const m = buildHero(h.def.id);
    for (const p of [m.torso, m.head, m.armL, m.armR, m.legL, m.legR]) p.castShadow = true;
    // 脚下的队伍色光环：自己金色，队友蓝色，敌人红色
    const col = h === this.game.player ? 0xffe08a : TEAM_COLOR[h.team];
    const ring = new THREE.Mesh(this.fx.geo.ring, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.scale.set(1.25, 1, 1.25); ring.position.y = 0.06; ring.renderOrder = 3;
    const holder = new THREE.Group();          // holder 只管位置，m.group 管朝向和缩放
    holder.add(m.group, ring);
    this.scene.add(holder);
    // 头顶血条（DOM）：等级、名字、生命、法力
    const cls = h === this.game.player ? 'me' : h.team === this.game.player.team ? 'ally' : 'foe';
    const bar = el('div', { cls: 'hb ' + cls, html: `<i class="lv">1</i><div class="col"><b class="nm">${h.def.name}</b><div class="hp"><i></i><em></em></div><div class="mp"><i></i></div></div>` }, this.layer);
    return {
      h, m, holder, ring, bar, lvEl: bar.querySelector('.lv'), hpEl: bar.querySelector('.hp i'), shEl: bar.querySelector('.hp em'), mpEl: bar.querySelector('.mp i'), hpBox: bar.querySelector('.hp'),
      rot: h.face, phase: 0, atkSeq: h.atkSeq, atkT: 9, castSeq: h.castSeq, castT: 9, deadT: 0, shown: true,
      c: { lv: 0, hp: -1, sh: -1, mp: -1, maxHp: 0, vis: true }, recallT: 0,
    };
  }

  makeStructView(u, model, barY) {
    model.group.position.set(u.x, 0, u.z);
    this.scene.add(model.group);
    return { u, model, barY, dead: false };
  }

  /* ---------------------------------------------------------- 坐标换算 */

  /** 世界坐标 → 屏幕像素 */
  project(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    return { x: (_v.x + 1) * 0.5 * this.stage.width, y: (1 - _v.y) * 0.5 * this.stage.height, visible: _v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.2 };
  }

  /** 屏幕像素 → 地面上的点（鼠标瞄准用）。打不到地面时返回 null */
  screenToGround(cx, cy) {
    _v.set((cx / this.stage.width) * 2 - 1, -(cy / this.stage.height) * 2 + 1, 0.5);
    _ray.setFromCamera(_v, this.camera);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    if (d.y >= -1e-4) return null;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  /* ---------------------------------------------------------- 事件 → 特效和音效 */

  handle(ev) {
    const g = this.game, P = g.player, fx = this.fx;
    switch (ev.type) {
      case 'fx': fx.play(ev); break;
      case 'dmg': {
        const u = ev.u, mine = ev.src === P, onMe = u === P;
        if (mine || onMe) {
          const n = Math.round(ev.n);
          if (n >= 1) fx.text(u.x, u.isStruct ? 6 : 3, u.z, (ev.crit ? '暴击 ' : '') + n, onMe ? 'hurt' : ev.crit ? 'crit' : ev.kind === 'magic' ? 'magic' : ev.kind === 'true' ? 'true' : 'phys');
          if (mine) Sfx.play('hit', 0.08); else Sfx.play('hurt', 0.25);
        }
        if (!u.isStruct) fx.glow.emit(u.x, 1.4, u.z, { n: 3, speed: [2, 5], life: [0.12, 0.3], size: [0.25, 0.5], color: ev.kind === 'magic' ? 0x9fd0ff : 0xffd9a0 });
        break;
      }
      case 'gold': fx.text(ev.x, 2.4, ev.z, '+' + ev.n, 'gold'); Sfx.play('coin', 0.12); break;
      case 'levelup': fx.levelUp(ev.u); if (ev.u === P) { Sfx.play('levelup'); fx.text(ev.u.x, 4, ev.u.z, '升级！', 'gold'); } break;
      case 'cast': {
        if (ev.u !== P && ev.u.distTo(P) > 26) break;
        const ic = ev.u.def.skills[ev.skill].icon;
        Sfx.play(ic === 'dash' || ic === 'roll' || ic === 'blink' ? 'dash' : ic === 'orb' || ic === 'frost' || ic === 'meteor' ? 'magic' : ic === 'fan' || ic === 'snipe' || ic === 'blades' ? 'arrow' : 'skill', 0.06);
        break;
      }
      case 'flash': fx.blink(ev.x, ev.z, ev.u.x, ev.u.z, 0xffe08a); Sfx.play('dash'); break;
      case 'heal': fx.glow.emit(ev.u.x, 0.5, ev.u.z, { n: 18, speed: [1.5, 3.5], dir: [0, 1, 0], spread: 0.2, life: [0.6, 1.1], size: [0.3, 0.6], color: 0x7dff9a, r: 1 }); if (ev.u === P) Sfx.play('heal'); break;
      case 'recalled': fx.ring(ev.u.x, ev.u.z, 3, 0x7ec8ff, 0.5); break;
      case 'respawn': fx.ring(ev.u.x, ev.u.z, 3, 0xffffff, 0.5); break;
      case 'buff': fx.ring(ev.u.x, ev.u.z, 3.4, ev.buff === 'red' ? 0xff6a3a : 0x4ab8ff, 0.7); break;
      case 'death': {
        const u = ev.u;
        if (u.kind === KIND.TOWER) { fx.explode(u.x, u.z, TEAM_COLOR[u.team], false); Sfx.play('boom'); }
        else if (u.kind === KIND.CRYSTAL) { fx.explode(u.x, u.z, TEAM_COLOR[u.team], true); Sfx.play('bigboom'); }
        else if (u.isHero) { fx.burst(u.x, u.z, 0xffffff, 20); if (u === P) Sfx.play('die'); }
        else if (u.kind === KIND.MONSTER) fx.dust(u.x, u.z, 8);
        break;
      }
      case 'buy': if (ev.u === P) Sfx.play('coin'); break;
    }
    this.onEvent(ev);
  }

  /* ---------------------------------------------------------- 每帧更新 */

  /**
   * @param {number} alpha  两次逻辑更新之间的插值比例
   * @param {number} dt     距上一帧的秒数
   */
  update(alpha, dt) {
    const g = this.game, P = g.player;
    this.time += dt;
    const evs = g.events;
    for (let i = 0; i < evs.length; i++) this.handle(evs[i]);
    evs.length = 0;

    // ---- 镜头：跟随玩家，带一点平滑 ----
    const px = P.px + (P.x - P.px) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
    this.camX = damp(this.camX, px, 9, dt); this.camZ = damp(this.camZ, pz + this.lookAhead, 9, dt);
    const cam = this.camera, fx = this.fx;
    let sx = 0, sz = 0;
    if (fx.shake > 0.01) { sx = (Math.random() - 0.5) * fx.shake; sz = (Math.random() - 0.5) * fx.shake; fx.shake *= Math.exp(-dt * 9); }
    cam.position.set(this.camX + sx, this.dist * Math.sin(this.tilt), this.camZ + this.dist * Math.cos(this.tilt) + sz);
    cam.lookAt(this.camX + sx, 0, this.camZ + sz);
    cam.updateMatrixWorld();
    if (this.catcher.visible) {
      this.catcher.position.set(this.camX, 0.02, this.camZ);
      const sun = this.world.sun;
      sun.position.set(this.camX - 30, 60, this.camZ + 25); sun.target.position.set(this.camX, 0, this.camZ);
    }

    // ---- 英雄 ----
    for (const v of this.heroViews) this.updateHero(v, alpha, dt);

    // ---- 小兵、野怪、建筑：顺便填写阴影和血条的实例数据 ----
    this.nShadow = 0; this.nBar = 0;
    const counts = { melee0: 0, melee1: 0, ranged0: 0, ranged1: 0, siege0: 0, siege1: 0 };
    const us = g.units, seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.kind === KIND.MINION) {
        const key = u.type + u.team, b = this.batches[key], n = counts[key];
        if (n >= MINION_CAP) continue;
        const x = u.px + (u.x - u.px) * alpha, z = u.pz + (u.z - u.pz) * alpha;
        let s = u.isSuper ? 1.3 : 1, y = 0;
        if (!u.alive) { const k = Math.min(1, u.deadT / 0.6); s *= 1 - k * 0.7; y = -k * 0.5; }
        else {
          if (u.moving) y = Math.abs(Math.sin(this.time * 9 + u.id)) * 0.12;
          if (u.atkWind > 0) s *= 1.1;
          this.addShadow(x, z, u.radius * 2.6);
          this.addBar(x, u.type === 'siege' ? 2.4 : 2.1 * s, z, 1.3, 0.2, u.hp / u.maxHp, u.team);
        }
        const c = Math.cos(u.face) * s, sn = Math.sin(u.face) * s, a = b.instanceMatrix.array, o = n * 16;
        a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
        counts[key] = n + 1;
      } else if (u.kind === KIND.MONSTER) {
        seen.add(u);
        let m = this.monsterViews.get(u);
        if (!m) { m = buildMonster(u.type); m.castShadow = true; this.scene.add(m); this.monsterViews.set(u, m); }
        const x = u.px + (u.x - u.px) * alpha, z = u.pz + (u.z - u.pz) * alpha;
        m.rotation.y = angDamp(m.rotation.y, u.face, 10, dt);
        if (!u.alive) { const k = Math.min(1, u.deadT / 0.8); m.position.set(x, -k * 1.6, z); m.scale.setScalar(1 - k * 0.3); }
        else {
          const hop = u.atkWind > 0 ? 0.25 : u.moving ? Math.abs(Math.sin(this.time * 8)) * 0.18 : Math.sin(this.time * 2 + u.id) * 0.04;
          m.position.set(x, hop, z); m.scale.setScalar(1);
          this.addShadow(x, z, u.radius * 2.8);
          this.addBar(x, u.type === 'boss' ? 6.8 : u.type === 'small' ? 2.9 : 3.7, z, u.type === 'boss' ? 3.4 : 2.2, 0.26, u.hp / u.maxHp, 2);
        }
      }
    }
    for (const key in counts) { const b = this.batches[key]; b.count = counts[key]; b.instanceMatrix.needsUpdate = true; }
    for (const [u, m] of this.monsterViews) if (!seen.has(u)) { this.scene.remove(m); m.geometry.dispose(); this.monsterViews.delete(u); }

    let ringT = null, lineT = null;
    for (const sv of this.structViews) {
      const u = sv.u, md = sv.model;
      if (!u.alive) {
        if (!sv.dead) { sv.dead = true; md.base.visible = false; md.gem.visible = false; md.rubble.visible = true; }
        continue;
      }
      md.gem.rotation.y += dt * 1.2;
      md.gem.position.y = (u.kind === KIND.CRYSTAL ? 4.2 : 7.1) + Math.sin(this.time * 2 + u.id) * 0.18;
      this.addShadow(u.x, u.z, u.radius * 3.4);
      this.addBar(u.x, sv.barY, u.z, 3.4, 0.34, u.hp / u.maxHp, u.vuln ? u.team : 3);
      if (u.team !== P.team && P.alive) {
        const d = P.distTo(u);
        if (d < u.range + 5 && (!ringT || d < P.distTo(ringT))) ringT = u;
        if (u.target === P || (u.atkWind > 0 && u.atkTarget === P)) lineT = u;
      }
    }
    // 敌方塔的射程圈；塔锁定玩家时画一条红线
    this.towerRing.visible = !!ringT;
    if (ringT) { this.towerRing.position.set(ringT.x, 0.07, ringT.z); this.towerRing.scale.set(ringT.range + 0.85, 1, ringT.range + 0.85); this.towerRing.material.opacity = lineT === ringT ? 0.95 : 0.5; }
    this.towerLine.visible = !!lineT;
    if (lineT) {
      this.towerLine.position.set(lineT.x, 0.1, lineT.z);
      this.towerLine.rotation.y = Math.atan2(px - lineT.x, pz - lineT.z);
      this.towerLine.scale.set(0.35 + Math.sin(this.time * 20) * 0.1, 1, Math.hypot(px - lineT.x, pz - lineT.z));
    }

    this.shadows.count = this.nShadow; this.shadows.instanceMatrix.needsUpdate = true;
    const bg = this.bars.geo;
    bg.instanceCount = this.nBar;
    bg.attributes.iPos.needsUpdate = true; bg.attributes.iInfo.needsUpdate = true; bg.attributes.iColor.needsUpdate = true;

    fx.syncProjs(g.projs, alpha, dt);
    fx.update(dt);
    this.world.update(dt);
    this.stage.render(this.scene, cam, dt);
  }

  /** 加一个脚下阴影实例 */
  addShadow(x, z, size) {
    if (this.nShadow >= MAX_INST) return;
    const a = this.shadows.instanceMatrix.array, o = this.nShadow++ * 16;
    a[o] = size; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = size; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = 0.035; a[o + 14] = z; a[o + 15] = 1;
  }

  /** 加一个血条实例。team：0 蓝 / 1 红 / 2 中立 / 3 灰色（暂时不能被攻击的建筑） */
  addBar(x, y, z, w, h, fill, team) {
    if (this.nBar >= MAX_INST) return;
    const b = this.bars, i = this.nBar++ * 3, mine = this.game.player.team;
    b.pos[i] = x; b.pos[i + 1] = y; b.pos[i + 2] = z;
    b.info[i] = w; b.info[i + 1] = h; b.info[i + 2] = clamp(fill, 0, 1);
    if (team === 3) { b.col[i] = 0.5; b.col[i + 1] = 0.52; b.col[i + 2] = 0.56; }
    else if (team === 2) { b.col[i] = 1; b.col[i + 1] = 0.78; b.col[i + 2] = 0.25; }
    else if (team === mine) { b.col[i] = 0.25; b.col[i + 1] = 0.62; b.col[i + 2] = 1; }
    else { b.col[i] = 1; b.col[i + 1] = 0.3; b.col[i + 2] = 0.26; }
  }

  /** 英雄的位置、动作和头顶血条 */
  updateHero(v, alpha, dt) {
    const h = v.h, m = v.m, g = this.game;
    const x = h.px + (h.x - h.px) * alpha, z = h.pz + (h.z - h.pz) * alpha;

    // 死亡：向后倒下，过一会儿消失；复活时恢复
    if (!h.alive) {
      v.deadT += dt;
      const k = Math.min(1, v.deadT * 2.4);
      m.pivot.rotation.x = -k * 1.45; m.pivot.position.y = k * 0.25;
      if (v.deadT > 2.4 && v.shown) { v.holder.visible = false; v.shown = false; }
      if (v.c.vis) { v.bar.style.display = 'none'; v.c.vis = false; }
      return;
    }
    if (v.deadT > 0 || !v.shown) { v.deadT = 0; v.shown = true; v.holder.visible = true; m.pivot.rotation.x = 0; m.pivot.position.y = 0; v.rot = h.face; }

    let y = m.float ? m.float + Math.sin(this.time * 2.4 + h.id) * 0.08 : 0;
    // 出手、施法动作的计时：发现序号变了就重新开始
    if (h.atkSeq !== v.atkSeq) { v.atkSeq = h.atkSeq; v.atkT = 0; v.atkDur = h.windup() + 0.24; if (h === g.player && h.projSpeed > 0) Sfx.play(h.def.projKind === 'arrow' ? 'arrow' : 'magic', 0.1); }
    if (h.castSeq !== v.castSeq) { v.castSeq = h.castSeq; v.castT = 0; }
    v.atkT += dt; v.castT += dt;

    let aR = 0, aL = 0, lR = 0, lL = 0, lean = 0, twist = 0, roll = 0;
    if (h.moving) {
      v.phase += dt * h.moveSpeed * 1.75;
      const s = Math.sin(v.phase);
      lR = s * 0.9; lL = -s * 0.9; aR = -s * 0.55; aL = s * 0.55; lean = 0.16;
      y += Math.abs(Math.cos(v.phase)) * 0.1;
    } else { aR = Math.sin(this.time * 1.8 + h.id) * 0.05; aL = -aR; }

    if (v.atkT < v.atkDur) {                               // 普攻动作
      const k = v.atkT / v.atkDur, w = h.windup() / v.atkDur;
      if (m.style === 'melee') {
        aR = k < w ? -2.7 * (k / w) : -2.7 + 2.3 * Math.min(1, (k - w) / 0.22);
        twist = k < w ? 0.35 * (k / w) : 0.35 - 0.7 * Math.min(1, (k - w) / 0.22);
        if (m.armL && h.def.id === 'yesun') aL = k < w ? -1.2 * (k / w) : -1.2 - 1.2 * Math.min(1, (k - w) / 0.22);
      } else if (m.style === 'bow') { aL = -1.5; aR = k < w ? -1.3 - 0.4 * (k / w) : -1.0; twist = -0.25; }
      else { aR = k < w ? -1.5 * (k / w) : -1.5 + 0.9 * ((k - w) / (1 - w)); }
    }
    if (v.castT < 0.36) {                                  // 施法动作：双臂上举、微微跃起
      const s = Math.sin((v.castT / 0.36) * Math.PI);
      aR = -2.5 * s; aL = -2.2 * s; y += s * 0.3;
    }
    if (h.dash) {                                          // 位移：前倾；跳跃型位移走抛物线
      lean = 0.55; aR = 0.8; aL = 0.8;
      if (h.dash.jump) { const k = 1 - h.dash.left / Math.max(0.01, h.dash.total); y += Math.sin(k * Math.PI) * 3.4; lean = 0.2; aR = -2.6; }
    }
    if (h.stunT > 0) roll = Math.sin(this.time * 16) * 0.14;                 // 眩晕：左右摇晃
    if (h.recallT > 0) {                                                     // 回城：脚下升起光点
      v.recallT -= dt;
      if (v.recallT <= 0) { v.recallT = 0.07; this.fx.glow.emit(x, 0.2, z, { n: 2, speed: [2, 4], dir: [0, 1, 0], spread: 0.1, life: [0.5, 0.9], size: [0.3, 0.5], color: 0x7ec8ff, r: 1.3 }); }
    }

    v.rot = angDamp(v.rot, h.face, 20, dt);
    v.holder.position.set(x, y, z);
    v.ring.position.y = 0.06 - y;                           // 光环留在地面上
    m.group.rotation.y = v.rot;
    const p = m.pivot, k = 1 - Math.exp(-dt * 24);
    p.rotation.x += (lean - p.rotation.x) * k; p.rotation.y += (twist - p.rotation.y) * k; p.rotation.z += (roll - p.rotation.z) * k;
    m.armR.rotation.x += (aR - m.armR.rotation.x) * k; m.armL.rotation.x += (aL - m.armL.rotation.x) * k;
    m.legR.rotation.x += (lR - m.legR.rotation.x) * k; m.legL.rotation.x += (lL - m.legL.rotation.x) * k;
    this.addShadow(x, z, 2.6);

    // 头顶血条：只在数值变化时才改 DOM
    const sp = this.project(x, y + 3.9 * (m.group.scale.x / 1.25), z), c = v.c;
    if (!sp.visible) { if (c.vis) { v.bar.style.display = 'none'; c.vis = false; } return; }
    if (!c.vis) { v.bar.style.display = ''; c.vis = true; }
    v.bar.style.transform = `translate3d(${sp.x.toFixed(1)}px,${sp.y.toFixed(1)}px,0) translate(-50%,-100%)`;
    const hp = Math.round((h.hp / h.maxHp) * 200), sh = Math.round(Math.min(1, h.shield / h.maxHp) * 200), mp = h.maxMp ? Math.round((h.mp / h.maxMp) * 100) : 0;
    if (hp !== c.hp) { c.hp = hp; v.hpEl.style.width = hp / 2 + '%'; }
    if (sh !== c.sh) { c.sh = sh; v.shEl.style.width = sh / 2 + '%'; }
    if (mp !== c.mp) { c.mp = mp; v.mpEl.style.width = mp + '%'; }
    if (h.level !== c.lv) { c.lv = h.level; v.lvEl.textContent = h.level; }
    if (h.maxHp !== c.maxHp) { c.maxHp = h.maxHp; v.hpBox.style.setProperty('--seg', (1000 / h.maxHp * 100).toFixed(2) + '%'); }   // 每 1000 血一格
  }

  /** 释放所有显存和 DOM（退出对局时调用） */
  dispose() {
    this.world.dispose();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose?.(); });
    for (const v of this.heroViews) v.bar.remove();
    for (const t of this.fx.texts) t.remove();
  }
}
