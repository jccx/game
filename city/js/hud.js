// 落日湾：界面（HUD）和玩家输入。
// 手机：左下摇杆（步行时移动；开车时左右转向，上下也可以当油门/刹车；开飞机时上下是俯仰）；
//      在屏幕右半边空白处拖动可以转镜头；右下是动作键（步行：攻击、上车、换武器；开车：油门、刹车、手刹、下车、开炮）。
// 电脑：WASD 移动/驾驶，按住鼠标拖动转镜头，空格 攻击/手刹，F 上下车，Q 换武器，J 开炮，↑↓ 飞机俯仰，M 地图，Esc 设置。
import { el, toast, toggleFullscreen, store, makeMemo, makeCheatButton } from '../../shared/js/ui.js';
import { Joystick, ActionButton, DragPad } from '../../shared/js/input.js';
import { Sfx } from '../../shared/js/audio.js';
import { qualityRow, soundRow } from '../../shared/js/settings.js';
import { fmtTime, clamp } from '../../shared/js/util.js';
import { QUALITY } from '../../shared/js/stage.js';
import { WEAPONS, VEH } from './config.js';
import { SIZE, RUNWAY, BASE } from './world.js';
import { paintMap } from './render/scene.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  fist: svg('<path d="M7 11V7a2 2 0 0 1 4 0v3M11 10V6a2 2 0 0 1 4 0v5M15 11V8a2 2 0 0 1 4 0v6c0 4-3 7-7 7s-7-2-7-6v-2a2 2 0 0 1 2-2z"/>'),
  gun: svg('<path d="M3 8h15v4H11l-1 3H7l1-3H3zM7 15l-1 5h3l1-5M18 8V6"/>'),
  car: svg('<path d="M4 16V11l2-5h12l2 5v5M4 16h16M6 16v3M18 16v3M7 11h10"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/>'),
  door: svg('<path d="M14 4h4v16h-4M14 4l-8 2v12l8 2zM11 12v1"/>'),
  swap: svg('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
  gas: svg('<path d="M12 20V5M5 12l7-7 7 7"/>'),
  brake: svg('<path d="M12 4v15M5 12l7 7 7-7"/>'),
  hand: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16v.5"/>'),
  fire: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
};

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('./sim.js').Sim} sim
   * @param {import('./render/view.js').View} view
   * @param {{stage:object, keys:object, pause:(b:boolean)=>void, restart:()=>void}} api
   */
  constructor(root, sim, view, api) {
    this.root = root; this.sim = sim; this.view = view; this.api = api; this.keys = api.keys;
    this.c = {}; this.slowT = 0; this.mapT = 0; this.bannerT = 0; this.engine = null; this.saveT = 5;
    this.mapImg = paintMap(sim.world, 512);
    root.innerHTML = '';
    this.build();
    setTimeout(() => this.showBanner('欢迎来到落日湾', '走进黄色光柱接任务，或者随便找辆车兜风', 'info', 5), 600);
  }

  build() {
    const r = this.root, sim = this.sim;
    // 拖动转镜头的区域（铺在最底层，摇杆和按钮盖在它上面）
    this.pad = new DragPad(el('div', { cls: 'look' }, r));
    // 左上：雷达（点一下打开大地图）
    this.radar = el('canvas', { cls: 'radar', on: { pointerdown: (e) => { e.preventDefault(); this.openMap(); } } }, r);
    this.radar.width = this.radar.height = 200; this.rctx = this.radar.getContext('2d');
    // 右上：无敌开关、钱、设置；下面是通缉星、生命/护甲、武器
    const right = el('div', { cls: 'c-right' }, r), row = el('div', { cls: 'c-row' }, right);
    this.cheat = makeCheatButton(row, { get: () => this.sim.player.godT > 0, onToggle: () => this.toggleGod() });
    this.cheatEl = this.cheat.el;
    this.moneyEl = el('div', { cls: 'money', text: '$0' }, row);
    el('div', { cls: 'g-ic', html: IC.gear, on: { pointerdown: (e) => { e.preventDefault(); this.openSettings(); } } }, row);
    this.starsEl = el('div', { cls: 'stars' }, right);
    const bars = el('div', { cls: 'c-bars' }, right);
    this.hpEl = el('i', {}, el('div', { cls: 'c-hp' }, bars)); this.arEl = el('i', {}, el('div', { cls: 'c-ar' }, bars));
    this.wpEl = el('div', { cls: 'c-wp' }, right);
    // 上方中间：任务目标和倒计时；横幅
    this.objEl = el('div', { cls: 'obj' }, r);
    this.banner = el('div', { cls: 'c-banner', html: '<b></b><span></span>' }, r);
    this.speedEl = el('div', { cls: 'speed' }, r);
    this.wasted = el('div', { cls: 'wasted', html: '<b>你倒下了</b><span>稍后在医院醒来</span>' }, r);
    // 左下：摇杆
    this.joy = new Joystick(el('div', { cls: 'g-joy-zone' }, r), { radius: 54 });
    // 右下：动作键。两套按钮共用位置，按是否在车上切换显示
    const pad = el('div', { cls: 'cpad' }, r);
    const one = (key) => () => { Sfx.unlock(); this.sim.ctl[key] = true; };
    this.bAtk = new ActionButton(pad, { cls: 'k-main', icon: IC.fist, onDown: () => Sfx.unlock() });
    this.bEnter = new ActionButton(pad, { cls: 'k-top', icon: IC.car, label: '上车', onDown: one('enter') });
    this.bSwap = new ActionButton(pad, { cls: 'k-left', icon: IC.swap, label: '换武器', onDown: one('swap') });
    this.bGas = new ActionButton(pad, { cls: 'k-main', icon: IC.gas, label: '油门', onDown: () => Sfx.unlock() });
    this.bBrake = new ActionButton(pad, { cls: 'k-left', icon: IC.brake, label: '刹车' });
    this.bExit = new ActionButton(pad, { cls: 'k-top', icon: IC.door, label: '下车', onDown: one('enter') });
    this.bHand = new ActionButton(pad, { cls: 'k-mid', icon: IC.hand, label: '手刹' });
    this.bFire = new ActionButton(pad, { cls: 'k-mid', icon: IC.fire, label: '开炮' });
    this.promptEl = el('div', { cls: 'prompt' }, r);
  }

  toggleGod() {
    const p = this.sim.player;
    p.godT = p.godT > 0 ? 0 : Infinity;
    Sfx.play(p.godT > 0 ? 'levelup' : 'click');
    toast(p.godT > 0 ? '无敌已打开' : '无敌已关闭');
  }

  /* ---------------------------------------------------------- 输入 */

  /** 每个逻辑帧调用：把摇杆、按钮、键盘的状态写进 sim.ctl */
  readInput() {
    const sim = this.sim, c = sim.ctl, p = sim.player, k = this.keys, v = p.inVeh, cy = this.view.camYaw;
    if (this.locked) return;                     // 测试时由脚本直接写 sim.ctl，不读真实输入
    let jx = this.joy.active ? this.joy.x : 0, jy = this.joy.active ? this.joy.y : 0;
    const ka = k.axis();
    if (ka.active) { jx = ka.x; jy = ka.y; }
    if (Math.hypot(jx, jy) < 0.16) { jx = 0; jy = 0; }
    c.aimYaw = cy;
    if (k.hit('KeyF')) c.enter = true;
    if (k.hit('KeyQ')) c.swap = true;
    if (k.hit('KeyM')) this.overlay ? this.closeOverlay() : this.openMap();
    if (k.hit('Escape')) this.overlay ? this.closeOverlay() : this.openSettings();
    if (!v) {
      // 步行：摇杆方向是相对镜头的。镜头朝向 (sin, cos)，屏幕右方是 (-cos, sin)
      const fx = Math.sin(cy), fz = Math.cos(cy);
      c.mx = fx * -jy - fz * jx; c.mz = fz * -jy + fx * jx;
      c.fire = this.bAtk.pressed || k.isDown('Space', 'KeyJ');
      c.steer = 0; c.gas = 0; c.handbrake = false; c.pitch = 0;
      return;
    }
    c.mx = 0; c.mz = 0;
    const plane = v.spec.cls === 'plane';
    c.steer = clamp(jx * 1.25, -1, 1);
    let gas = this.bGas.pressed ? 1 : this.bBrake.pressed ? -1 : 0;
    if (plane) {
      if (k.isDown('KeyW')) gas = 1; else if (k.isDown('KeyS')) gas = -1;
      const kp = (k.isDown('ArrowUp') ? 1 : 0) - (k.isDown('ArrowDown') ? 1 : 0);
      // 触屏上摇杆上下就是俯仰；键盘上 WS 留给油门，俯仰用方向键
      c.pitch = kp || (this.joy.active ? clamp(-jy * 1.2, -1, 1) : 0);
      if (ka.active && !kp) c.steer = (k.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (k.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    } else {
      c.pitch = 0;
      if (!gas && Math.abs(jy) > 0.32) gas = clamp(-jy * 1.3, -1, 1);      // 没按油门键时，摇杆上下也能当油门/刹车
    }
    c.gas = gas;
    c.handbrake = this.bHand.pressed || (k.isDown('Space') && v.spec.cls !== 'tank');
    c.fire = this.bFire.pressed || k.isDown('KeyJ') || (v.spec.cls === 'tank' && k.isDown('Space'));
  }

  /* ---------------------------------------------------------- 事件 */
  onEvent(ev) {
    const sim = this.sim;
    switch (ev.type) {
      case 'toast': toast(ev.text, 2200); break;
      case 'money': if (ev.n > 0) Sfx.play('coin', 0.1); this.saveT = Math.min(this.saveT, 1); break;
      case 'pickup': {
        const k = ev.k; Sfx.play('coin', 0.1);
        toast(k.type === 'cash' ? `捡到 $${k.val}` : k.type === 'health' ? '生命回满' : k.type === 'armor' ? '穿上护甲' : k.type === 'star' ? '通缉降低一星' : `得到${WEAPONS.find((w) => w.id === k.val).name}`);
        break;
      }
      case 'stars': if (ev.up) { Sfx.play('siren'); if (ev.n === 1) this.showBanner('被通缉了', '甩掉警察的视线一阵子，星星就会消失', 'bad', 3); } else if (ev.n === 0) this.showBanner('通缉解除', '', 'good', 2); break;
      case 'wasted': Sfx.play('lose'); break;
      case 'respawn': toast(ev.fee ? `医药费 $${ev.fee}` : '你在医院醒来', 2500); break;
      case 'enter': Sfx.play('click'); toast(`${VEH[ev.v.type].name}${ev.v.spec.cls === 'plane' ? '：按住油门加速，速度够了把摇杆往上推就能起飞' : ev.v.spec.cls === 'tank' ? '：可以原地转向，“开炮”键发射炮弹' : ''}`, ev.v.spec.cls === 'plane' ? 4500 : 2200); break;
      case 'hurt': Sfx.play('hurt', 0.25); this.root.classList.add('hurt'); clearTimeout(this._ht); this._ht = setTimeout(() => this.root.classList.remove('hurt'), 160); break;
      case 'mission':
        if (ev.what === 'start') { Sfx.play('go'); this.showBanner(ev.name, ev.desc, 'info', 5); }
        else if (ev.what === 'win') { Sfx.play('win'); this.showBanner('任务完成', `${ev.name}　+$${ev.reward}${ev.first ? '' : '（重复完成，奖励减少）'}`, 'good', 4); this.saveT = 0.5; }
        else if (ev.what === 'fail') { Sfx.play('lose'); this.showBanner('任务失败', `${ev.name}：${ev.reason}`, 'bad', 4); }
        else if (ev.what === 'checkpoint') Sfx.play('beep');
        break;
    }
  }

  showBanner(title, sub, cls, dur = 3) {
    this.banner.firstChild.textContent = title; this.banner.lastChild.textContent = sub || '';
    this.banner.className = 'c-banner show ' + cls; this.bannerT = dur;
  }

  /* ---------------------------------------------------------- 每帧更新 */
  update(dt) {
    const sim = this.sim, p = sim.player, v = p.inVeh;
    // 拖动转镜头
    const d = this.pad.consume();
    this.view.look(d.dx, d.dy);
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.className = 'c-banner';
    // 引擎声：上车时启动，下车时停
    if (v && !this.engine) this.engine = Sfx.engine();
    if (this.engine) { if (v && !p.dead) this.engine.set(Math.min(1, Math.abs(v.speed) / v.spec.max + (sim.ctl.gas > 0 ? 0.12 : 0)), 0.06); else { this.engine.stop(); this.engine = null; } }
    if ((this.slowT -= dt) <= 0) { this.slowT = 0.1; this.slow(); }
    if ((this.mapT -= dt) <= 0) { this.mapT = 0.1; this.drawRadar(); }
    if ((this.saveT -= dt) <= 0) { this.saveT = 20; store.set('city-save', sim.save()); }
  }

  slow() {
    const sim = this.sim, p = sim.player, v = p.inVeh, c = this.c;
    const set = makeMemo(c);
    set('money', p.money, (x) => { this.moneyEl.textContent = '$' + x; });
    set('stars', sim.stars + (sim.stars > 0 && !sim.seen && sim.unseenT > 3 ? 0.5 : 0), (x) => {
      const n = Math.floor(x); this.starsEl.innerHTML = '★'.repeat(n) + '<i>' + '★'.repeat(5 - n) + '</i>'; this.starsEl.classList.toggle('blink', x % 1 > 0);
    });
    set('hp', Math.ceil(p.hp), (x) => { this.hpEl.style.width = x + '%'; });
    set('ar', Math.ceil(p.armor), (x) => { this.arEl.style.width = x + '%'; this.arEl.parentNode.style.visibility = x > 0 ? '' : 'hidden'; });
    const wp = WEAPONS[p.weapon];
    set('wp', wp.name + (wp.melee ? '' : ' ' + p.ammo[p.weapon]), (x) => { this.wpEl.textContent = x; });
    set('god', p.godT > 0, (x) => this.cheat.sync(x));
    set('dead', p.dead, (x) => { this.wasted.classList.toggle('show', x); });
    // 按钮：步行和开车两套
    const cls = v ? v.spec.cls : '';
    set('mode', cls, () => {
      const foot = !v;
      this.bAtk.show(foot); this.bSwap.show(foot);
      this.bGas.show(!foot); this.bBrake.show(!foot); this.bExit.show(!foot);
      this.bHand.show(!foot && (cls === 'car' || cls === 'bike')); this.bFire.show(cls === 'tank');
      this.bBrake.setLabel(cls === 'plane' ? '减速' : cls === 'boat' ? '倒船' : '刹车');
    });
    set('atkIcon', p.weapon > 0, (x) => this.bAtk.setIcon(x ? IC.gun : IC.fist));
    const near = !v && !p.dead ? sim.nearestVehicle() : null;
    set('near', near ? near.id : 0, () => { this.bEnter.show(!!near); if (near) this.bEnter.setLabel(near.driver === 'npc' ? '抢车' : '上车'); });
    set('prompt', near ? VEH[near.type].name : '', (x) => { this.promptEl.textContent = x; this.promptEl.style.display = x ? '' : 'none'; });
    // 速度、高度
    set('speed', v ? Math.round(Math.abs(v.speed) * 3.6) + (v.flying ? ' km/h　高度 ' + Math.round(v.y) + ' m' : ' km/h') : '', (x) => { this.speedEl.textContent = x; this.speedEl.style.display = x ? '' : 'none'; });
    // 任务目标
    const h = sim.missions.hud;
    set('obj', h ? h.name + '|' + h.text + '|' + (h.timer > 0 ? Math.ceil(h.timer) : '') : '', () => {
      if (!h) { this.objEl.style.display = 'none'; return; }
      this.objEl.style.display = '';
      this.objEl.innerHTML = `<b>${h.name}</b><span>${h.text}</span>` + (h.timer > 0 ? `<i class="${h.timer < 10 ? 'low' : ''}">${fmtTime(h.timer)}</i>` : '');
    });
  }

  /** 雷达：以玩家为中心、正北朝上的一小块地图，加上各种标记 */
  drawRadar() {
    const sim = this.sim, p = sim.player, x = this.rctx, S = 200, R = 125, k = S / (R * 2), mk = this.mapImg.width / SIZE;
    x.save();
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 2, 0, 6.283); x.clip();
    x.fillStyle = '#2f7592'; x.fillRect(0, 0, S, S);
    x.drawImage(this.mapImg, (p.x - R) * mk, (p.z - R) * mk, R * 2 * mk, R * 2 * mk, 0, 0, S, S);
    // 把世界坐标换成雷达坐标；超出范围的贴在边上
    const blip = (wx, wz, color, r = 4, edge = false) => {
      let dx = (wx - p.x) * k, dz = (wz - p.z) * k; const d = Math.hypot(dx, dz), max = S / 2 - 7;
      if (d > max) { if (!edge) return; dx *= max / d; dz *= max / d; }
      x.fillStyle = color; x.beginPath(); x.arc(S / 2 + dx, S / 2 + dz, r, 0, 6.283); x.fill(); x.lineWidth = 1; x.strokeStyle = '#000'; x.stroke();
    };
    for (const o of sim.peds) if (o.alive && o.kind !== 'civ') blip(o.x, o.z, o.kind === 'cop' ? '#4a8cff' : '#c05cff', 3);
    for (const v of sim.vehicles) if (v.alive && v.ai && v.ai.kind === 'chase') blip(v.x, v.z, ((sim.time * 4) | 0) % 2 ? '#ff4a4a' : '#4a8cff', 4);
    for (const kx of sim.pickups) if (kx.t <= 0 && kx.fixed) blip(kx.x, kx.z, kx.type === 'health' ? '#ff6a6a' : kx.type === 'star' ? '#ffe066' : kx.type === 'armor' ? '#6ab8ff' : '#ffb347', 2.5);
    const h = sim.missions.hud;
    if (h && h.target) blip(h.target.x, h.target.z, '#3ae0ff', 6, true);
    else for (const m of sim.missions.list) {
      let dx = (m.at[0] - p.x) * k, dz = (m.at[1] - p.z) * k; const d = Math.hypot(dx, dz), max = S / 2 - 10;
      if (d > max) { dx *= max / d; dz *= max / d; }
      x.fillStyle = sim.missions.done.has(m.id) ? '#9a8a3a' : '#ffd84a'; x.fillRect(S / 2 + dx - 7, S / 2 + dz - 7, 14, 14);
      x.fillStyle = '#201800'; x.font = 'bold 11px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(m.icon, S / 2 + dx, S / 2 + dz + 1);
    }
    // 玩家：朝向箭头
    x.translate(S / 2, S / 2); x.rotate(-p.yaw + Math.PI);
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(0, -8); x.lineTo(6, 7); x.lineTo(0, 3); x.lineTo(-6, 7); x.closePath(); x.fill(); x.stroke();
    x.restore();
    x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 3; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 2, 0, 6.283); x.stroke();
  }

  /* ---------------------------------------------------------- 弹出面板 */
  closeOverlay() { if (this.overlay) { this.overlay.remove(); this.overlay = null; this.api.pause(false); } }
  openOverlay(cls) {
    this.closeOverlay();
    this.overlay = el('div', { cls: 'g-overlay ' + cls }, this.root);
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay) this.closeOverlay(); });
    this.api.pause(true);
    return el('div', { cls: 'g-panel cbox' }, this.overlay);
  }

  /** 大地图：全岛、任务点、特殊地点、自己的位置 */
  openMap() {
    const sim = this.sim, p = sim.player, box = this.openOverlay('cmap');
    el('div', { cls: 'cbox-head', html: '<b>落日湾地图</b><span>黄色方块是任务，点地图外面关闭</span>' }, box);
    const body = el('div', { cls: 'cmap-body' }, box);
    const cv = el('canvas', { cls: 'bigmap' }, body); cv.width = cv.height = 640;
    const x = cv.getContext('2d'), k = 640 / SIZE;
    x.drawImage(this.mapImg, 0, 0, 640, 640);
    const tag = (wx, wz, text, color) => { x.font = 'bold 15px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; const w = x.measureText(text).width + 10; x.fillStyle = color; x.fillRect(wx * k - w / 2, wz * k - 10, w, 20); x.fillStyle = '#111'; x.fillText(text, wx * k, wz * k + 1); };
    const P = sim.world.places;
    tag(RUNWAY.x - 70, (RUNWAY.z0 + RUNWAY.z1) / 2, '机场', '#cfd6e0'); tag((BASE[0] + BASE[2]) / 2, (BASE[1] + BASE[3]) / 2, '军营', '#b9c49a');
    tag(P.pier.x0 + 5, P.pier.z1 + 26, '码头', '#d9b98a'); tag(P.hospital.x, P.hospital.z - 22, '医院', '#ffb0b0'); tag(430, 430, '山', '#e8e8e8');
    for (const m of sim.missions.list) tag(m.at[0], m.at[1], m.icon + (sim.missions.done.has(m.id) ? '✓' : ''), sim.missions.done.has(m.id) ? '#b0a060' : '#ffd84a');
    x.translate(p.x * k, p.z * k); x.rotate(-p.yaw + Math.PI);
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.lineTo(9, 10); x.lineTo(0, 5); x.lineTo(-9, 10); x.closePath(); x.fill(); x.stroke();
    const list = el('div', { cls: 'mlist g-scroll' }, body);
    for (const m of sim.missions.list) el('div', { cls: 'mrow' + (sim.missions.done.has(m.id) ? ' done' : ''), html: `<i>${m.icon}</i><div><b>${m.name}　$${m.reward}</b><span>${m.desc}</span></div>` }, list);
    el('button', { cls: 'g-b', text: '关闭', on: { click: () => this.closeOverlay() } }, box);
  }

  openSettings() {
    const box = this.openOverlay('cset'), st = this.api.stage;
    el('div', { cls: 'cbox-head', html: '<b>设置</b>' }, box);
    qualityRow(box, st, ['自动', ...QUALITY.map((x) => x.name)]);
    soundRow(box);
    const f = el('div', { cls: 'set-btns' }, box);
    el('button', { cls: 'g-b', text: '继续游戏', on: { click: () => this.closeOverlay() } }, f);
    el('button', { cls: 'g-b ghost', text: '地图和任务', on: { click: () => this.openMap() } }, f);
    el('button', { cls: 'g-b ghost', text: '全屏', on: { click: () => toggleFullscreen() } }, f);
    el('button', { cls: 'g-b ghost', text: '清除存档重来', on: { click: () => { store.set('city-save', null); this.closeOverlay(); this.api.restart(); } } }, f);
    el('a', { cls: 'g-b ghost', text: '返回大厅', attrs: { href: '../' } }, f);
    el('div', { cls: 'set-tip', text: '操作：左下摇杆移动或转向，右半边屏幕拖动转镜头。开车时摇杆上下也能当油门和刹车。电脑键位：WASD、鼠标拖动转镜头、空格 攻击/手刹、F 上下车、Q 换武器、J 开炮、方向键上下 飞机俯仰、M 地图。金钱和已完成的任务会自动保存在本机。' }, box);
  }

  dispose() { if (this.engine) this.engine.stop(); store.set('city-save', this.sim.save()); this.root.innerHTML = ''; }
}
