// 落日湾：界面（HUD）和玩家输入。
// 手机：左下摇杆（步行时移动；开车时左右转向，上下也可以当油门/刹车；开飞机时上下是俯仰）；
//      在屏幕右半边空白处拖动可以转镜头；右下是动作键（步行：攻击、上车、换武器；开车：油门、刹车、手刹、下车、开炮）。
// 电脑：WASD 移动/驾驶，按住鼠标拖动转镜头，空格 攻击/手刹，F 上下车，Q 换武器，J 攻击/车上发火箭筒（坦克炮是空格或“开炮”键），↑↓ 飞机俯仰/直升机升降，M 地图，Esc 设置。
import { el, toast, leaveNoticeDue, toggleFullscreen, store, makeMemo, makeCheatButton, attachKeyboardFit } from '../../shared/js/ui.js';
import { Joystick, ActionButton, DragPad } from '../../shared/js/input.js';
import { Sfx } from '../../shared/js/audio.js';
import { qualityRow, soundRow } from '../../shared/js/settings.js';
import { fmtTime, clamp } from '../../shared/js/util.js';
import { QUALITY } from '../../shared/js/stage.js';
import { WEAPONS, VEH, PLAYER } from './config.js';
import { SIZE, RUNWAY, BASE } from './world.js';
import { paintMap, mapBuildingColor } from './render/scene.js';
import { Net, validName } from './net.js';

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
  net: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18"/>'),
  run: svg('<path d="M4 5l7 7-7 7M12 5l7 7-7 7"/>'),   // 跑步：两个向右的箭头（快进）
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
    this.net = null;   // 联机：没加入时是 null，单机完全不受影响
    this._leaveSeen = new Map();   // 下线通知 15 秒窗口：名字 -> 上次报的时间（见 leaveNoticeDue）
    this._joinSeen = new Map();    // 上线通知 15 秒窗口：和下线一样，同一个名字 15 秒内只报一次（重连重放、掉线重连不刷屏）
    this.mapImg = paintMap(sim.world, 512);
    root.innerHTML = '';
    this.build();
    setTimeout(() => this.showBanner('欢迎来到落日湾', '市中心有 8 栋世界地标，走近了会报名字；走进黄色光柱接任务，或者随便找辆车兜风', 'info', 5), 600);
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
    this.netBtn = el('div', { cls: 'g-ic', html: IC.net, on: { pointerdown: (e) => { e.preventDefault(); this.openNet(); } } }, row);
    el('div', { cls: 'g-ic', html: IC.gear, on: { pointerdown: (e) => { e.preventDefault(); this.openSettings(); } } }, row);
    this.netEl = el('div', { cls: 'net-status', text: '', on: { click: () => { if (this.net && this.net.status === 'online') this.openNet(true); } } }, right);   // 联机状态：单机时不显示；在线时点一下打开排行榜
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
    this.bRun = new ActionButton(pad, { cls: 'k-mid', icon: IC.run, label: '跑步', onDown: () => { Sfx.unlock(); this.sim.toggleRun(); } });   // 步行专用：点一下开、再点一下关（锁定开关，不用按住；预算耗尽时变灰）
    this.bGas = new ActionButton(pad, { cls: 'k-main', icon: IC.gas, label: '油门', onDown: () => Sfx.unlock() });
    this.bBrake = new ActionButton(pad, { cls: 'k-left', icon: IC.brake, label: '刹车' });
    this.bExit = new ActionButton(pad, { cls: 'k-top', icon: IC.door, label: '下车', onDown: one('enter') });
    this.bHand = new ActionButton(pad, { cls: 'k-mid', icon: IC.hand, label: '手刹' });
    this.bFire = new ActionButton(pad, { cls: 'k-mid', icon: IC.fire, label: '开炮' });
    this.promptEl = el('div', { cls: 'prompt' }, r);
  }

  toggleGod() {
    const net = this.net;
    // 联机时无敌是全员共享开关：任何人拨动都影响所有在线玩家（包括自己），走 godMode 节点；
    // 单机时还是只管自己（本地 godT）。
    if (net && net.status === 'online') { net.setGod(!net.god); return; }
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
    c.aimYaw = cy; c.aimSet = true;   // 界面每帧都写瞄准方向；车上发火箭筒时用它，没有它就用车头方向
    if (k.hit('KeyF')) c.enter = true;
    if (k.hit('KeyQ')) c.swap = true;
    if (k.hit('KeyM')) this.overlay ? this.closeOverlay() : this.openMap();
    if (k.hit('Escape')) this.overlay ? this.closeOverlay() : this.openSettings();
    // 跑步开关：按一下 Shift 切换开/关（锁定开关，不用按住；hit 只在按下那一帧触发，按住不放的重复按键不会反复切换）
    if (k.hit('ShiftLeft') || k.hit('ShiftRight')) sim.toggleRun();
    if (!v) {
      // 步行：数字键 1~6 直接切到任意一种武器（出生就全拥有，不用解锁）
      for (let i = 0; i < WEAPONS.length; i++) if (k.hit('Digit' + (i + 1))) sim.selectWeapon(i);
      // 步行：摇杆方向是相对镜头的。镜头朝向 (sin, cos)，屏幕右方是 (-cos, sin)
      const fx = Math.sin(cy), fz = Math.cos(cy);
      c.mx = fx * -jy - fz * jx; c.mz = fz * -jy + fx * jx;
      c.fire = this.bAtk.pressed || k.isDown('Space', 'KeyJ');
      c.rocket = false;   // 步行不发车载火箭，下车时不清会残留
      c.steer = 0; c.gas = 0; c.handbrake = false; c.pitch = 0;
      return;
    }
    c.mx = 0; c.mz = 0;   // 车上不跑步（上车时 sim.enterVehicle 已经把跑步开关关了）
    const plane = v.spec.cls === 'plane', heli = v.spec.cls === 'heli';
    c.steer = clamp(jx * 1.25, -1, 1);
    let gas = this.bGas.pressed ? 1 : this.bBrake.pressed ? -1 : 0;
    if (plane) {
      // 飞机：WS 油门，方向键上下 / 摇杆上下是俯仰
      if (k.isDown('KeyW')) gas = 1; else if (k.isDown('KeyS')) gas = -1;
      const kp = (k.isDown('ArrowUp') ? 1 : 0) - (k.isDown('ArrowDown') ? 1 : 0);
      // 触屏上摇杆上下就是俯仰；键盘上 WS 留给油门，俯仰用方向键
      c.pitch = kp || (this.joy.active ? clamp(-jy * 1.2, -1, 1) : 0);
      if (ka.active && !kp) c.steer = (k.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (k.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    } else if (heli) {
      // 直升机：摇杆管水平（上下前进/后退、左右转向），升降改两个按钮（油门键变“上升”、刹车键变“下降”，见 slow() 里的改名）
      // 键盘本来就是这套：W/S 前进后退、A/D 转向、方向键上下升降，不用改
      if (this.joy.active) gas = clamp(-jy * 1.3, -1, 1);   // 摇杆上推前进、下拉后退；松开就悬停（vehicles.js 里松油门水平速度衰减到 0）
      else if (k.isDown('KeyW')) gas = 1; else if (k.isDown('KeyS')) gas = -1;
      else gas = 0;
      const kp = (k.isDown('ArrowUp') ? 1 : 0) - (k.isDown('ArrowDown') ? 1 : 0);
      // 按钮是二值的（只有按住/松开），给固定 0.6 档：垂直速度 7.8 米/秒，在坠毁阈值 9 米/秒以内，按住“下降”能直接平稳落地；
      // 满杆（1.0，13 米/秒）落地会坠毁，摇杆时代靠轻推控制，按钮时代没法轻推，所以按钮不用满杆。键盘方向键保持满杆 ±1 不变。
      c.pitch = kp || (this.bGas.pressed ? 0.6 : this.bBrake.pressed ? -0.6 : 0);   // 两个按钮都不按，垂直速度就是 0
      if (ka.active && !kp) c.steer = (k.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (k.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    } else {
      c.pitch = 0;
      if (!gas && Math.abs(jy) > 0.32) gas = clamp(-jy * 1.3, -1, 1);      // 没按油门键时，摇杆上下也能当油门/刹车
    }
    c.gas = gas;
    c.handbrake = this.bHand.pressed || (k.isDown('Space') && v.spec.cls !== 'tank');
    // 坦克：开炮键（bFire）或空格是坦克炮；其他车上开炮键（bFire）发火箭筒，J 键在所有车上都发火箭筒
    c.fire = v.spec.cls === 'tank' && (this.bFire.pressed || k.isDown('Space'));
    c.rocket = k.isDown('KeyJ') || (v.spec.cls !== 'tank' && this.bFire.pressed);
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
      case 'buildingDown': {
        const b = ev.b, k = this.mapImg.width / SIZE;
        this.mapImg.getContext('2d').fillStyle = '#3a3632';   // 小地图上也不再是楼，只剩废墟色
        this.mapImg.getContext('2d').fillRect(b.x0 * k, b.z0 * k, (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
        toast(`${b.name || '建筑'}被炸平了`);
        break;
      }
      case 'buildingUp': {
        const b = ev.b, k = this.mapImg.width / SIZE;
        this.mapImg.getContext('2d').fillStyle = mapBuildingColor(this.sim.world, b);   // 小地图上恢复成楼的颜色（地标金色）
        this.mapImg.getContext('2d').fillRect(b.x0 * k, b.z0 * k, (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
        this._mapDirty = true;   // 多栋楼同时重建时，攒到 slow() 里整张重画一次
        break;   // “XX已重建”的提示由 sim.js 在 150 米内节流着发，不在这里重复弹
      }
      case 'respawn': toast(ev.fee ? `医药费 $${ev.fee}` : '你在医院醒来', 2500); break;
      case 'enter': Sfx.play('click'); toast(`${VEH[ev.v.type].name}${ev.v.spec.cls === 'plane' ? '：按住油门加速，速度够了把摇杆往上推就能起飞' : ev.v.spec.cls === 'heli' ? '：摇杆前后左右飞，“上升/下降”按钮升降，不用跑道就能原地起飞；轻推慢降能落平顶楼顶，J 键或“火箭”键发火箭筒' : ev.v.spec.cls === 'tank' ? '：可以原地转向，“开炮”键发射炮弹，J 键发火箭筒' : ''}`, ev.v.spec.cls === 'plane' || ev.v.spec.cls === 'heli' ? 4500 : 2200); break;
      case 'refill': { this.wpEl.classList.remove('flash'); void this.wpEl.offsetWidth; this.wpEl.classList.add('flash'); setTimeout(() => this.wpEl.classList.remove('flash'), 700); break; }
      case 'hurt': Sfx.play('hurt', 0.25); this.root.classList.add('hurt'); clearTimeout(this._ht); this._ht = setTimeout(() => this.root.classList.remove('hurt'), 160); break;
      case 'mission':
        if (ev.what === 'start') { Sfx.play('go'); this.showBanner(ev.name, ev.desc, 'info', 5); }
        else if (ev.what === 'win') { Sfx.play('win'); this.showBanner('任务完成', `${ev.name}　+$${ev.reward}${ev.first ? '' : '（重复完成，奖励减少）'}`, 'good', 4); this.saveT = 0.5; }
        else if (ev.what === 'fail') { Sfx.play('lose'); this.showBanner('任务失败', `${ev.name}：${ev.reason}`, 'bad', 4); }
        else if (ev.what === 'checkpoint') Sfx.play('beep');
        else if (ev.what === 'taken') toast(`${ev.name}：${ev.byName}正在做`, 2500);   // 联机：别人正在做的任务，走进去也不会开始
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
    if (this.net) this.net.update(dt);   // 联机心跳和广播（暂停时也在跑：render 每帧都调这里）
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
    set('god', this.net && this.net.status === 'online' ? this.net.god : p.godT > 0, (x) => this.cheat.sync(x));
    // 联机状态：单机不显示；在线显示人数
    const net = this.net;
    set('net', !net ? '' : net.status === 'connecting' ? '连接中…' : net.status === 'online' ? `联机 ${1 + net.remotePlayers.size} 人` : net.status === 'failed' ? '联机未连接' : '', (x) => {
      this.netEl.textContent = x; this.netEl.style.display = x ? '' : 'none';
      this.netEl.classList.toggle('on', !!net && net.status === 'online');
    });
    // 有楼重建过：小地图攒到这里一次重画
    if (this._mapDirty) { this._mapDirty = false; this.mapImg = paintMap(sim.world, 512); }
    set('dead', p.dead, (x) => { this.wasted.classList.toggle('show', x); });
    // 走近地标时报名字（每栋一局只报一次）
    if (!v) {
      if (!this._lmSeen) this._lmSeen = new Set();
      let best = null, bd = 70;
      for (const b of sim.world.buildings) {
        if (b.kind !== 'landmark' || b.destroyed || this._lmSeen.has(b)) continue;
        const d = Math.hypot((b.x0 + b.x1) / 2 - p.x, (b.z0 + b.z1) / 2 - p.z);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) { this._lmSeen.add(best); toast(`${best.name}${best.note ? '：' + best.note : ''}`); }
    }
    // 按钮：步行和开车两套
    const cls = v ? v.spec.cls : '';
    set('mode', cls, () => {
      const foot = !v;
      this.bAtk.show(foot); this.bSwap.show(foot); this.bRun.show(foot);
      this.bGas.show(!foot); this.bBrake.show(!foot); this.bExit.show(!foot);
      this.bHand.show(!foot && (cls === 'car' || cls === 'bike')); this.bFire.show(!foot); this.bFire.setLabel(cls === 'tank' ? '开炮' : '火箭');   // 开炮键只在坦克上是开炮，其他车上是火箭筒
      this.bGas.setLabel(cls === 'heli' ? '上升' : '油门');   // 直升机上油门键改名“上升”，管升降；其他车上还是油门
      this.bBrake.setLabel(cls === 'heli' ? '下降' : cls === 'plane' ? '减速' : cls === 'boat' ? '倒船' : '刹车');   // 直升机上刹车键改名“下降”
    });
    // 跑步预算指示（每 0.1 秒刷新）：开 = 按钮高亮、文案“跑步中”；关 = 正常、文案“跑步”；预算耗尽锁死时按钮变灰（强制步行），回满 5 秒才重新变亮；角标显示剩余秒数（满格时不显示）
    if (!v) { const left = sim.runBudgetLeft(); this.bRun.setEnabled(sim.runReady()); this.bRun.setActive(sim.runToggle); this.bRun.setLabel(sim.runToggle ? '跑步中' : '跑步'); this.bRun.setBadge(left >= PLAYER.runCap ? '' : Math.ceil(left) + 's'); }
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
    // 联机：别的玩家是绿点
    if (sim.net) for (const rp of sim.net.remotePlayers.values()) blip(rp.x, rp.z, '#4ade80', 4);
    for (const v of sim.vehicles) if (v.alive && v.ai && v.ai.kind === 'chase') blip(v.x, v.z, ((sim.time * 4) | 0) % 2 ? '#ff4a4a' : '#4a8cff', 4);
    for (const kx of sim.pickups) if (kx.t <= 0 && kx.fixed) blip(kx.x, kx.z, kx.type === 'health' ? '#ff6a6a' : kx.type === 'star' ? '#ffe066' : kx.type === 'armor' ? '#6ab8ff' : '#ffb347', 2.5);
    const h = sim.missions.hud;
    // 联机：别人正在做的任务，在雷达上标出他当前的检查点（或任务点），绿色方块
    if (sim.net) for (const [id, st] of sim.net.missionStates) {
      if (!st || st.state !== 'active' || st.by === sim.net.uid) continue;
      const def = sim.missions.list.find((m) => m.id === id);
      if (!def) continue;
      const cp = def.cps && st.cp < def.cps.length ? def.cps[st.cp] : def.at;
      blip(cp[0], cp[1], '#4ade80', 5, true);
    }
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
  closeOverlay() { if (this._netRefresh) { clearInterval(this._netRefresh); this._netRefresh = null; } if (this._mapRefresh) { clearInterval(this._mapRefresh); this._mapRefresh = null; this._mapCv = null; } if (this._netKbdDetach) { this._netKbdDetach(); this._netKbdDetach = null; } if (this.overlay) { this.overlay.remove(); this.overlay = null; this.api.pause(false); } }
  openOverlay(cls) {
    this.closeOverlay();
    this.overlay = el('div', { cls: 'g-overlay ' + cls }, this.root);
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay) this.closeOverlay(); });
    this.api.pause(true);
    return el('div', { cls: 'g-panel cbox' }, this.overlay);
  }

  /** 大地图：全岛、任务点、特殊地点、自己的位置 */
  openMap() {
    const sim = this.sim, box = this.openOverlay('cmap');
    el('div', { cls: 'cbox-head', html: '<b>落日湾地图</b><span>黄色方块是任务，点地图外面关闭</span>' }, box);
    const body = el('div', { cls: 'cmap-body' }, box);
    const cv = el('canvas', { cls: 'bigmap' }, body); cv.width = cv.height = 640;
    this.drawBigMap(cv);
    // 大地图开着时每 0.5 秒重画一次：下线的人马上从图上消失（以前只画一次，人走了绿点还留在旧位置上）；
    // 自己的箭头和任务/地标状态也跟着实时走。关面板时 closeOverlay 里清掉这个定时器。
    this._mapCv = cv;
    this._mapRefresh = setInterval(() => { if (this._mapCv) this.drawBigMap(this._mapCv); }, 500);
    const list = el('div', { cls: 'mlist g-scroll' }, body);
    for (const m of sim.missions.list) {
      // 联机：别人正在做的任务标出来（谁在做、做到哪了）；做完了的标“已完成”
      const st = sim.net && sim.net.missionStates.get(m.id);
      const remote = st && st.state === 'active' && st.by !== (sim.net && sim.net.uid)
        ? `　<span style="color:#4ade80">${st.byName}正在做${st.left > 0 ? `（还剩 ${st.left}）` : ''}</span>` : '';
      const doneBy = st && st.state === 'done' ? `　<span style="color:#b0a060">${st.byName}已完成</span>` : '';
      el('div', { cls: 'mrow' + (sim.missions.done.has(m.id) ? ' done' : ''), html: `<i>${m.icon}</i><div><b>${m.name}　$${m.reward}</b><span>${m.desc}${remote}${doneBy}</span></div>` }, list);
    }
    el('button', { cls: 'g-b', text: '关闭', on: { click: () => this.closeOverlay() } }, box);
  }

  /** 画大地图的画布部分（底图、地名、任务、地标、联机绿点、自己的箭头）。开地图时画一次，开着时每 0.5 秒重画： *
   * 下线的人已经不在 remotePlayers 里，重画后他的绿点就没了，不会留在旧位置上。每次重画先复位变换、清画布
   *（画布的变换状态是接着上一次留下的，不复位的话第二次画会整体错位）。
   */
  drawBigMap(cv) {
    const sim = this.sim, p = sim.player;
    const x = cv.getContext('2d'), k = 640 / SIZE;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, 640, 640);
    x.drawImage(this.mapImg, 0, 0, 640, 640);
    const tag = (wx, wz, text, color) => { x.font = 'bold 15px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; const w = x.measureText(text).width + 10; x.fillStyle = color; x.fillRect(wx * k - w / 2, wz * k - 10, w, 20); x.fillStyle = '#111'; x.fillText(text, wx * k, wz * k + 1); };
    const P = sim.world.places;
    tag(RUNWAY.x - 70, (RUNWAY.z0 + RUNWAY.z1) / 2, '机场', '#cfd6e0'); tag((BASE[0] + BASE[2]) / 2, (BASE[1] + BASE[3]) / 2, '军营', '#b9c49a');
    tag(P.pier.x0 + 5, P.pier.z1 + 26, '码头', '#d9b98a'); tag(P.hospital.x, P.hospital.z - 22, '医院', '#ffb0b0'); tag(430, 430, '山', '#e8e8e8');
    for (const m of sim.missions.list) tag(m.at[0], m.at[1], m.icon + (sim.missions.done.has(m.id) ? '✓' : ''), sim.missions.done.has(m.id) ? '#b0a060' : '#ffd84a');
    for (const b of sim.world.buildings) if (b.kind === 'landmark') tag((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.destroyed ? b.name + '（已炸平）' : b.name, b.destroyed ? '#8a8578' : '#d8a020');
    // 联机：别的玩家是绿点——只画现在还在线的（remotePlayers 里已经没了的人，这里就不会出现）
    if (sim.net) for (const rp of sim.net.remotePlayers.values()) { x.fillStyle = '#4ade80'; x.beginPath(); x.arc(rp.x * k, rp.z * k, 6, 0, 6.283); x.fill(); x.lineWidth = 2; x.strokeStyle = '#000'; x.stroke(); }
    x.translate(p.x * k, p.z * k); x.rotate(-p.yaw + Math.PI);
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.lineTo(9, 10); x.lineTo(0, 5); x.lineTo(-9, 10); x.closePath(); x.fill(); x.stroke();
  }

  /* ---------------------------------------------------------- 联机 */
  netEvent(ev) {
    switch (ev.type) {
      case 'playerJoin':
        // 上线通知也 15 秒窗口：重连重放、掉线后马上回来，同一个名字 15 秒内只报一次（和下线通知一样的窗口）
        if (leaveNoticeDue(this._joinSeen, ev.name)) toast(`${ev.name}加入了落日湾`);
        if (this._mapCv) this.drawBigMap(this._mapCv);   // 大地图开着时马上把新玩家画上去
        break;
      case 'playerLeave': {
        // 下线通知只在断开连接的 15 秒内显示：同一个名字 15 秒内只报一次（网络抖动反复掉线/重连不会刷屏），
        // 通知本身 15 秒后自动收起（toast 15 秒）；击杀播报（killFeed）是另一条 toast，不受影响。
        if (leaveNoticeDue(this._leaveSeen, ev.name)) toast(`${ev.name}离开了`, 15000);
        if (this._mapCv) this.drawBigMap(this._mapCv);   // 大地图开着时马上把下线的人擦掉，不留旧位置的绿点
        break;
      }
      case 'syncBlocked': toast(`联机同步被拒绝了（${ev.what}），请检查数据库规则`, 3000); break;
      case 'killFeed': toast(`${ev.killer} 击杀了 ${ev.victim}`); break;
      case 'godChange': toast(ev.on ? `${ev.by || '有人'}开启了全员无敌` : `${ev.by || '有人'}关闭了全员无敌`); break;
      case 'hostChange': if (ev.isHost) toast('你现在是房主，路人和警察由你这边模拟'); break;
    }
  }

  /** 联机面板：输名字、加入、看在线的人和本周排行榜、断开。focusBoard 为 true 时（从右上“联机 N 人”点进来）滚到排行榜。 */
  openNet(focusBoard = false) {
    const box = this.openOverlay('cnet');
    el('div', { cls: 'cbox-head', html: '<b>联机模式</b><span>所有玩家共享同一张地图</span>' }, box);
    const saved = store.get('city-net-name', '');
    const row = el('div', { cls: 'net-row' }, box);
    const input = el('input', { cls: 'net-input', attrs: { type: 'text', maxlength: '20', placeholder: '输入你的名字（1~20 个字）', value: saved } }, row);
    const joinBtn = el('button', { cls: 'g-b', text: '加入联机' }, row);
    // 键盘让位：输入框聚焦、虚拟键盘弹起时，游戏画面缩到键盘上方的可视区域（见 shared/js/ui.js 的 attachKeyboardFit）；
    // 关面板时 closeOverlay 里拆掉监听、恢复全屏
    this._netKbdDetach = attachKeyboardFit(input);
    const status = el('div', { cls: 'net-err', text: '' }, box);
    const list = el('div', { cls: 'net-players' }, box);
    const myScore = el('div', { cls: 'net-myscore', text: '' }, box);
    const board = el('div', { cls: 'net-board' }, box);
    // 全员无敌开关：任何人都能拨动，影响所有在线玩家（见 Net.setGod）
    const godBtn = el('button', { cls: 'g-b', text: '全员无敌：关' }, box);
    godBtn.addEventListener('click', () => { if (this.net && this.net.status === 'online') this.net.setGod(!this.net.god); });
    const refresh = () => {
      const net = this.net;
      const online = net && net.status === 'online';
      const names = online
        ? [net.name + '（你）', ...[...net.remotePlayers.values()].map((rp) => rp.name)]
        : [];
      list.innerHTML = names.length
        ? `<b>在线 ${names.length} 人</b>` + names.map((n) => `<div>${n}</div>`).join('')
        : '还没加入联机。加入后，你的位置、炸掉的楼、开着的车、路人和警察都会同步给其他玩家；你也可以击杀其他玩家上榜。';
      joinBtn.textContent = online ? '断开联机' : '加入联机';
      // 本周排行榜（按杀数排，前 10 名；名字用 textContent 填，不拼 HTML）
      const mine = online ? net.scores.get(net.name) : null;
      myScore.textContent = mine ? `你本周：${mine.kills} 杀 / ${mine.deaths} 死` : '';
      godBtn.style.display = online ? '' : 'none';
      godBtn.textContent = online ? (net.god ? `全员无敌：开（${net.godBy || '?'}）` : '全员无敌：关') : '全员无敌：关';
      board.innerHTML = '';
      if (online) {
        el('b', { text: `本周排行榜（${net.scoresWeek} 当周，每周一 00:00 清零）` }, board);
        const rows = [...net.scores.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths).slice(0, 10);
        if (!rows.length) el('div', { text: '本周还没有击杀' }, board);
        rows.forEach(([n, s], i) => el('div', { text: `${i + 1}. ${n}　${s.kills} 杀 / ${s.deaths} 死` }, board));
      }
    };
    refresh();
    if (focusBoard) { try { board.scrollIntoView({ block: 'nearest' }); } catch { /* 面板内部滚动，滚不到也不影响 */ } }
    this._netRefresh = setInterval(refresh, 1000);
    const close = () => { clearInterval(this._netRefresh); this._netRefresh = null; this.closeOverlay(); };
    joinBtn.addEventListener('click', async () => {
      if (this.net && this.net.status === 'online') { await this.leaveNet(); refresh(); return; }
      const r = await this.joinNet(input.value);
      if (r.ok) { status.textContent = ''; refresh(); }
      else { status.textContent = r.message || '加入失败'; refresh(); }
    });
    el('button', { cls: 'g-b ghost', text: '关闭', on: { click: close } }, box);
    el('div', { cls: 'set-tip', text: '名字只要和同时在线的人不重名就行。路人、警察、开火和击杀都会同步；排行榜按名字记，每周一 00:00 清零。断网或数据库没连上时，游戏照常单机玩。' }, box);
    input.focus();
  }

  /** 加入联机（测试也直接调这个）。返回 {ok:true} 或 {ok:false, reason, message} */
  async joinNet(rawName) {
    if (this.net && this.net.status === 'online') return { ok: true };
    const v = validName(rawName);
    if (!v.ok) return { ok: false, reason: 'badname', message: v.reason };
    let transport;
    try {
      const mod = await import('./net-firebase.js');   // SDK 只在这里动态加载，单机玩不碰网络
      transport = await mod.createFirebaseTransport();
    } catch (e) {
      console.error('[net] firebase load failed', e);
      return { ok: false, reason: 'offline', message: '联机加载失败（网络不通？），单机继续玩' };
    }
    const net = new Net(this.sim, transport, { onEvent: (ev) => this.netEvent(ev) });
    this.net = net; this.sim.net = net;
    const r = await net.join(v.name);
    if (r.ok) {
      store.set('city-net-name', v.name);
      toast(`已加入联机：${v.name}`);
    } else {
      this.net = null; this.sim.net = null;
    }
    return r;
  }

  async leaveNet() {
    const net = this.net;
    this.net = null; this.sim.net = null;
    if (net) await net.leave();
    toast('已断开联机，回到单机');
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
    el('div', { cls: 'set-tip', text: '操作：左下摇杆移动或转向，右半边屏幕拖动转镜头。开车时摇杆上下也能当油门和刹车。出生就带全部 6 种武器，数字键 1~6 或 Q 换武器，子弹打空自动补满。直升机在机场停机坪：摇杆上下升降、油门前进，不用跑道。电脑键位：WASD、鼠标拖动转镜头、空格 攻击/手刹、F 上下车、Q 换武器、J 开炮、方向键上下 飞机俯仰/直升机升降、M 地图。金钱和已完成的任务会自动保存在本机。' }, box);
  }

  dispose() { if (this._netRefresh) { clearInterval(this._netRefresh); this._netRefresh = null; } if (this._netKbdDetach) { this._netKbdDetach(); this._netKbdDetach = null; } if (this.net) { const n = this.net; this.net = null; this.sim.net = null; n.leave(); } if (this.engine) this.engine.stop(); store.set('city-save', this.sim.save()); this.root.innerHTML = ''; }
}
