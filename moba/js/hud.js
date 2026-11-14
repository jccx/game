// 裂谷争锋：对局界面（HUD）和玩家输入。
// 左下摇杆移动；右下普攻和三个技能（按住拖动瞄准，松手释放，拖到“取消”处松手则取消）；
// 另有回城、恢复、闪现、补兵、推塔、快捷购买（小地图下方）、小地图、战况；
// 屏幕顶部偏右一排：无敌（作弊开关）、商店、金币、战绩、设置。
// 电脑上：WASD 移动，J/空格/鼠标左键普攻，Q/E/R 技能（朝鼠标位置），1/2/3 加点，B 回城，F 闪现，G 恢复，P 商店，Esc 设置。
import { el, toast, toggleFullscreen } from '../../shared/js/ui.js';
import { Joystick, ActionButton } from '../../shared/js/input.js';
import { Sfx } from '../../shared/js/audio.js';
import { fmtTime } from '../../shared/js/util.js';
import { QUALITY } from '../../shared/js/stage.js';
import { KIND } from './entities.js';
import { ITEMS, ITEM_TYPES, MAX_ITEMS } from './items.js';
import { HERO, ECON } from './config.js';
import { paintGround, TEAM_CSS } from './render/scene.js';

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
/** 图标表：技能、按钮共用的简笔图标 */
export const ICONS = {
  attack: svg('<path d="M5 19l3-1 11-11V4h-3L5 15l-1 3zM14 6l4 4M4 20l3-3"/>'),
  dash: svg('<path d="M9 5l7 7-7 7M3 8h5M2 12h7M3 16h5"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v8M8 12h8"/>'),
  quake: svg('<path d="M3 19h18M12 3v7l-4 3 5 2-3 4M5 14l-2 2M19 14l2 2"/>'),
  spin: svg('<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/><path d="M9 12a3 3 0 1 0 3-3"/>'),
  leap: svg('<path d="M4 16c2-9 9-11 15-6M19 5v5h-5M3 20h8M14 20h7"/>'),
  blink: svg('<path d="M13 2L5 13h6l-1 9 9-12h-6z"/>'),
  blades: svg('<path d="M4 20L20 4M4 20l2-9M4 20l9-2M20 4l-5 1M20 4l-1 5M11 6l2 2M16 11l2 2"/>'),
  exec: svg('<path d="M12 2v14M8 6l4-4 4 4M7 16h10M12 16v6M9 22h6"/>'),
  orb: svg('<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  frost: svg('<path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10M9 4l3 3 3-3M9 20l3-3 3 3"/>'),
  meteor: svg('<circle cx="9" cy="15" r="5"/><path d="M13 11l8-8M15 14l6-3M10 9l3-6"/>'),
  fan: svg('<path d="M4 20L12 3M4 20L20 12M4 20L19 5M4 20L6 4M4 20L21 18"/>'),
  roll: svg('<path d="M4 14a8 8 0 0 1 15-3M19 5v6h-6M6 20h12"/>'),
  snipe: svg('<path d="M3 21L21 3M21 3h-6M21 3v6M7 13l4 4M3 17l4 4"/>'),
  recall: svg('<path d="M4 11l8-7 8 7v9H4zM10 20v-6h4v6"/>'),
  heal: svg('<path d="M12 5v14M5 12h14"/>', '<circle cx="12" cy="12" r="9"/>'),
  flash: svg('<path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>'),
  minion: svg('<path d="M6 21v-8a6 6 0 0 1 12 0v8M6 15h12M12 3v4"/>'),
  tower: svg('<path d="M7 21V10l-2-2V4h3v2h2V4h4v2h2V4h3v4l-2 2v11zM10 21v-5h4v5"/>'),
  shop: svg('<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
};

export class Hud {
  /**
   * @param {HTMLElement} root HUD 容器
   * @param {import('./game.js').Game} game
   * @param {import('./render/view.js').View} view
   * @param {{stage:object, keys:object, pause:(b:boolean)=>void, restart:()=>void, exit:()=>void}} api
   */
  constructor(root, game, view, api) {
    this.root = root; this.game = game; this.view = view; this.api = api;
    this.P = game.player;
    this.keys = api.keys;       // 键盘状态由 main.js 创建一次、各局共用
    this.pend = { cast: -1, aimX: 0, aimZ: 0, aimTarget: null, lv: -1, buy: null, recall: false, heal: false, flash: false, god: false };
    this.aim = null;             // 正在拖动瞄准的技能：{ i, ax, ay, mag, cancel }
    this.latch = false; this.latchMode = 0; this.noTargetT = 0;
    this.mouse = { x: 0, y: 0, down: false };
    this.slowT = 0; this.mapT = 0; this.c = {};      // c：上次显示的值，变化了才改 DOM
    this.feed = []; this.bannerT = 0; this.endShown = false;
    root.innerHTML = '';
    this.build();
    this.bindDesktop();
  }

  /* ---------------------------------------------------------- 搭界面 */
  build() {
    const r = this.root, P = this.P, g = this.game;

    // 左上：小地图 + 快捷购买 + 商店
    const left = el('div', { cls: 'hud-left' }, r);
    const [mw, mh] = g.map.size;
    this.mini = el('canvas', { cls: 'mini' }, left);
    this.mini.width = 220; this.mini.height = Math.round(220 * mh / mw);
    this.mini.style.aspectRatio = `${mw} / ${mh}`;
    this.miniBg = paintGround(g.map, 220, true);
    this.mctx = this.mini.getContext('2d');
    this.quick = el('div', { cls: 'quick g-pe', on: { pointerdown: (e) => { e.preventDefault(); const id = P.nextBuild(); if (id) this.tryBuy(id); } } }, left);

    // 上方：比分、时间
    const top = el('div', { cls: 'hud-top' }, r);
    this.scoreB = el('b', { cls: 'sb', text: '0' }, top);
    this.timeEl = el('span', { cls: 'tm', text: '00:00' }, top);
    this.scoreR = el('b', { cls: 'sr', text: '0' }, top);

    // 右上：从左到右依次是 无敌（作弊）、商店、金币，然后是战绩和设置
    const right = el('div', { cls: 'hud-right' }, r);
    const main = el('div', { cls: 'hr-row' }, right), sub = el('div', { cls: 'hr-row' }, right);
    this.cheatEl = el('div', { cls: 'cheat', text: '无敌 关', on: { pointerdown: (e) => { e.preventDefault(); e.stopPropagation(); this.pend.god = true; } } }, main);
    this.shopBtn = el('div', { cls: 'g-ic shop-btn', html: ICONS.shop, on: { pointerdown: (e) => { e.preventDefault(); this.openShop(); } } }, main);
    this.goldEl = el('div', { cls: 'gold', text: '300' }, main);
    this.kdaEl = el('div', { cls: 'kda', text: '0/0/0' }, sub);
    el('div', { cls: 'g-ic', html: ICONS.gear, on: { pointerdown: (e) => { e.preventDefault(); this.openSettings(); } } }, sub);

    // 击杀信息、横幅、取消施法、回城进度、阵亡遮罩
    this.feedEl = el('div', { cls: 'feed' }, r);
    this.banner = el('div', { cls: 'banner' }, r);
    this.cancelEl = el('div', { cls: 'cancel', text: '拖到这里取消' }, r);
    this.recallEl = el('div', { cls: 'recall', html: '<span>回城中</span><i></i>' }, r);
    this.recallBar = this.recallEl.querySelector('i');
    this.deadEl = el('div', { cls: 'dead', html: '<div><b>你已阵亡</b><span></span></div>' }, r);
    this.deadTxt = this.deadEl.querySelector('span');

    // 下方中间：自己的状态（等级、生命、法力、经验、装备栏）
    const st = el('div', { cls: 'status' }, r);
    this.stLv = el('i', { cls: 'st-lv', text: '1' }, st);
    const bars = el('div', { cls: 'st-bars' }, st);
    this.stHp = el('div', { cls: 'st-hp', html: '<i></i><span></span>' }, bars);
    this.stMp = el('div', { cls: 'st-mp', html: '<i></i><span></span>' }, bars);
    this.stXp = el('div', { cls: 'st-xp', html: '<i></i>' }, bars);
    this.itemsEl = el('div', { cls: 'st-items' }, st);

    // 左下：摇杆
    this.joy = new Joystick(el('div', { cls: 'g-joy-zone' }, r), { radius: 54 });

    // 右下：普攻、技能
    const pad = el('div', { cls: 'pad' }, r);
    this.atkBtn = new ActionButton(pad, { cls: 'b-atk', icon: ICONS.attack, onDown: () => { Sfx.unlock(); this.latch = true; this.latchMode = 0; this.noTargetT = 0; } });
    this.minBtn = new ActionButton(pad, { cls: 'b-min', icon: ICONS.minion, label: '补兵', onDown: () => { this.latch = true; this.latchMode = 1; this.noTargetT = 0; } });
    this.towBtn = new ActionButton(pad, { cls: 'b-tow', icon: ICONS.tower, label: '推塔', onDown: () => { this.latch = true; this.latchMode = 2; this.noTargetT = 0; } });
    this.skillBtns = P.def.skills.map((s, i) => new ActionButton(pad, {
      cls: 'b-s' + (i + 1), icon: ICONS[s.icon] || ICONS.orb, label: s.name, aim: s.aim !== 'self', aimRadius: 58,
      onDown: () => { Sfx.unlock(); this.aim = { i, ax: 0, ay: 0, mag: 0, cancel: false }; },
      onAim: (ax, ay, mag, b, e) => { if (this.aim) { this.aim.ax = ax; this.aim.ay = ay; this.aim.mag = mag; this.aim.cancel = this.overCancel(e); } },
      onUp: (ax, ay, mag, cancelled, b, e) => {
        const a = this.aim; this.aim = null;
        if (!a || cancelled || this.overCancel(e)) return;
        this.castSkill(i, a);
      },
    }));
    this.plusBtns = [0, 1, 2].map((i) => el('div', { cls: 'plus p' + (i + 1), text: '+', on: { pointerdown: (e) => { e.preventDefault(); e.stopPropagation(); this.pend.lv = i; Sfx.play('click'); } } }, pad));

    // 回城、恢复、闪现
    const sum = el('div', { cls: 'sum' }, r);
    this.recBtn = new ActionButton(sum, { cls: 'b-sm', icon: ICONS.recall, label: '回城', onDown: () => { this.pend.recall = true; this.latch = false; } });
    this.healBtn = new ActionButton(sum, { cls: 'b-sm', icon: ICONS.heal, label: '恢复', onDown: () => { this.pend.heal = true; } });
    this.flashBtn = new ActionButton(sum, { cls: 'b-sm', icon: ICONS.flash, label: '闪现', onDown: () => { this.pend.flash = true; } });

    this.refreshItems();
  }

  /** 电脑上的鼠标：记录位置（技能瞄准用），左键按住普攻 */
  bindDesktop() {
    const cv = this.api.stage.canvas;
    this._mm = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
    this._md = (e) => { if (e.pointerType === 'mouse' && e.button === 0) { this.mouse.down = true; Sfx.unlock(); } };
    this._mu = () => { this.mouse.down = false; };
    window.addEventListener('pointermove', this._mm);
    cv.addEventListener('pointerdown', this._md);
    window.addEventListener('pointerup', this._mu);
  }

  /* ---------------------------------------------------------- 输入 → 英雄的操作意图 */

  /** 松手位置是否在“取消”区域里 */
  overCancel(e) {
    if (!e) return false;
    const r = this.cancelEl.getBoundingClientRect();
    return e.clientX >= r.left - 12 && e.clientX <= r.right + 12 && e.clientY >= r.top - 12 && e.clientY <= r.bottom + 12;
  }

  /** 没拖动就松手时的自动瞄准：优先最近的敌方英雄，其次最近的敌人，都没有就朝当前面向 */
  autoTarget(range) {
    const P = this.P, g = this.game;
    let best = null, bs = 1e9;
    for (const u of g.units) {
      if (!u.alive || u.team === P.team || u.isStruct || !g.targetable(u)) continue;
      const d = P.distTo(u) - u.radius;
      if (d > range + 1.5) continue;
      const s = d + (u.isHero ? -100 : 0) + (u.kind === KIND.MONSTER && !u.aggro ? 50 : 0);
      if (s < bs) { bs = s; best = u; }
    }
    return best;
  }

  /** 把一次技能操作换算成瞄准点，交给下一逻辑帧执行 */
  castSkill(i, a) {
    const P = this.P, s = P.def.skills[i], pd = this.pend;
    if (P.skillLv[i] <= 0) { toast('这个技能还没学'); return; }
    if (P.cds[i] > 0) { Sfx.play('error', 0.3); return; }
    if (P.mp < P.skillCost(i)) { toast('法力不足'); Sfx.play('error', 0.3); return; }
    let x, z, target = null;
    if (s.aim === 'self') { x = P.x; z = P.z; }
    else if (a.mouse) { x = a.mouse.x; z = a.mouse.z; }
    else if (a.mag < 0.18) {
      const t = this.autoTarget(s.aim === 'dir' ? Math.min(s.range, 14) : s.range);
      if (t) { x = t.x; z = t.z; target = t; }
      else { const k = s.aim === 'dir' ? 5 : Math.min(s.range, 6); x = P.x + Math.sin(P.face) * k; z = P.z + Math.cos(P.face) * k; }
    } else if (s.aim === 'dir') { x = P.x + a.ax * 10; z = P.z + a.ay * 10; }
    else { x = P.x + a.ax * s.range; z = P.z + a.ay * s.range; }
    pd.cast = i; pd.aimX = x; pd.aimZ = z; pd.aimTarget = target;
    this.latch = false;
  }

  tryBuy(id) {
    const P = this.P, it = ITEMS[id];
    if (P.items.includes(id)) return;
    if (P.items.length >= MAX_ITEMS) { toast('装备栏满了'); return; }
    if (P.gold < it.cost) { toast(`金币不够，还差 ${Math.ceil(it.cost - P.gold)}`); Sfx.play('error', 0.3); return; }
    this.pend.buy = id;
  }

  /** 每个逻辑帧调用：把摇杆、按钮、键盘的状态写进玩家英雄的操作意图 */
  readInput() {
    const P = this.P, inn = P.in, pd = this.pend, k = this.keys;
    if (P.brain) return;                               // 托管给电脑时不读输入
    let mx = this.joy.active ? this.joy.x : 0, mz = this.joy.active ? this.joy.y : 0;
    const ka = k.axis();
    if (ka.active) { mx = ka.x; mz = ka.y; }
    const m = Math.hypot(mx, mz);
    if (m < 0.2) { mx = 0; mz = 0; } else { mx /= m; mz /= m; }
    inn.mx = mx; inn.mz = mz;

    // 键盘快捷键
    if (k.hit('KeyQ')) this.keyCast(0);
    if (k.hit('KeyE')) this.keyCast(1);
    if (k.hit('KeyR')) this.keyCast(2);
    if (k.hit('Digit1')) pd.lv = 0; if (k.hit('Digit2')) pd.lv = 1; if (k.hit('Digit3')) pd.lv = 2;
    if (k.hit('KeyB')) { pd.recall = true; this.latch = false; }
    if (k.hit('KeyF')) pd.flash = true;
    if (k.hit('KeyG')) pd.heal = true;
    if (k.hit('KeyP')) this.shopEl ? this.closeOverlay() : this.openShop();
    if (k.hit('Escape')) this.overlay ? this.closeOverlay() : this.openSettings();

    // 普攻：按住一直打；点一下之后也会继续打当前目标，直到推摇杆、放技能或附近没有敌人
    const held = this.atkBtn.pressed || this.minBtn.pressed || this.towBtn.pressed || k.isDown('KeyJ', 'Space') || this.mouse.down;
    if (mx || mz) this.latch = false;
    if (this.latch && !held) {
      if (P.target && P.target.alive) this.noTargetT = 0;
      else if ((this.noTargetT += 1 / 30) > 0.6) this.latch = false;
    }
    inn.attack = held || this.latch;
    inn.atkMode = this.minBtn.pressed ? 1 : this.towBtn.pressed ? 2 : held ? 0 : this.latchMode;
    inn.atkTarget = null;

    if (pd.cast >= 0) { inn.cast = pd.cast; inn.aimX = pd.aimX; inn.aimZ = pd.aimZ; inn.aimTarget = pd.aimTarget; pd.cast = -1; }
    if (pd.lv >= 0) { inn.lvUp = pd.lv; pd.lv = -1; }
    if (pd.buy) { inn.buy = pd.buy; pd.buy = null; }
    if (pd.recall) { inn.recall = true; pd.recall = false; }
    if (pd.heal) { inn.heal = true; pd.heal = false; }
    if (pd.flash) { inn.flash = true; pd.flash = false; }
    if (pd.god) {
      pd.god = false;
      // 无敌是一个开关：点一下开，再点一下关
      if (!P.alive) toast('复活后再用');
      else if (P.godT > 0) { P.godT = 0; this.game.emit({ type: 'god', u: P, on: false }); }
      else { P.godT = Infinity; P.stunT = 0; P.slowT = 0; this.game.emit({ type: 'god', u: P, on: true }); }
    }
  }

  /** 键盘放技能：朝鼠标所指的地面位置 */
  keyCast(i) {
    const p = this.view.screenToGround(this.mouse.x, this.mouse.y);
    this.castSkill(i, p ? { mouse: p, mag: 1 } : { mag: 0, ax: 0, ay: 0 });
  }

  /* ---------------------------------------------------------- 对局事件 → 播报 */
  onEvent(ev) {
    const g = this.game, P = this.P, mine = P.team;
    switch (ev.type) {
      case 'kill': {
        const v = ev.victim, k = ev.killer;
        const kn = k ? k.def.name : (ev.by.kind === KIND.TOWER || ev.by.kind === KIND.CRYSTAL ? '防御塔' : '小兵');
        this.addFeed(`<b class="${k ? (k.team === mine ? 'a' : 'f') : 'n'}">${kn}</b> 击败了 <b class="${v.team === mine ? 'a' : 'f'}">${v.def.name}</b>`);
        if (ev.first) this.showBanner('第一滴血', k && k.team === mine ? 'good' : 'bad');
        else if (k === P) { this.showBanner(P.streak >= 3 ? `连续击败 ${P.streak} 人！` : '击败敌方英雄', 'good'); Sfx.play('levelup'); }
        else if (v === P) this.showBanner('你被击败了', 'bad');
        else if (k && k.streak >= 3) this.showBanner(`${k.def.name} 势不可挡`, k.team === mine ? 'good' : 'bad');
        break;
      }
      case 'towerDown': this.showBanner(ev.team === mine ? '我方防御塔被摧毁' : '摧毁敌方防御塔', ev.team === mine ? 'bad' : 'good'); break;
      case 'boss': this.showBanner(ev.team === mine ? '我方击败了远古巨灵，全队获得奖励' : '敌方击败了远古巨灵', ev.team === mine ? 'good' : 'bad'); break;
      case 'bossSpawn': this.showBanner('远古巨灵出现在河道', 'info'); break;
      case 'wave': if (ev.n === 1) this.showBanner('全军出击', 'info'); break;
      case 'buff': if (ev.u === P) toast(ev.buff === 'red' ? '获得炎甲之力：普攻灼烧并减速' : '获得霜纹之力：回蓝加快、冷却缩短', 2400); break;
      case 'buy': if (ev.u === P) this.refreshItems(); break;
      case 'over': Sfx.play(ev.winner === mine ? 'win' : 'lose'); this.showBanner(ev.winner === mine ? '胜利' : '失败', ev.winner === mine ? 'good' : 'bad', 4); break;
    }
  }

  addFeed(html) {
    const e = el('div', { cls: 'feed-line', html }, this.feedEl);
    this.feed.push({ e, t: 4.5 });
    if (this.feed.length > 3) this.feed.shift().e.remove();
  }
  showBanner(text, cls, dur = 2.2) {
    this.banner.textContent = text; this.banner.className = 'banner show ' + cls; this.bannerT = dur;
  }

  /* ---------------------------------------------------------- 每帧更新 */
  update(dt) {
    const P = this.P, g = this.game, v = this.view, c = this.c;

    // 技能瞄准指示器
    const a = this.aim;
    if (a && P.alive) {
      const s = P.def.skills[a.i];
      let dx = a.ax, dz = a.ay;
      const m = Math.hypot(dx, dz);
      if (m < 0.18) { dx = Math.sin(P.face); dz = Math.cos(P.face); } else { dx /= m; dz /= m; }
      const k = m < 0.18 ? 0.5 : a.mag;
      v.fx.setAim({ x: P.x, z: P.z, type: s.aim, range: s.range, width: s.width || 2, radius: s.radius || 3, dx, dz, tx: P.x + dx * s.range * k, tz: P.z + dz * s.range * k, cancel: a.cancel });
      this.cancelEl.className = 'cancel show' + (a.cancel ? ' hot' : '');
    } else if (c.aim) { v.fx.setAim(null); this.cancelEl.className = 'cancel'; }
    c.aim = !!(a && P.alive);

    // 技能冷却（内部有节流，数值没变不会改 DOM）
    for (let i = 0; i < 3; i++) this.skillBtns[i].setCooldown(P.cds[i], P.def.skills[i].cd[Math.max(0, P.skillLv[i] - 1)] * (1 - P.cdr));
    this.flashBtn.setCooldown(P.flashCd, HERO.flashCd);
    this.healBtn.setCooldown(P.healCd, HERO.healCd);

    // 击杀信息和横幅的淡出
    for (let i = this.feed.length - 1; i >= 0; i--) if ((this.feed[i].t -= dt) <= 0) { this.feed[i].e.remove(); this.feed.splice(i, 1); }
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.className = 'banner';

    // 回城进度
    const rc = P.recallT > 0;
    if (rc !== c.rc) { c.rc = rc; this.recallEl.classList.toggle('show', rc); }
    if (rc) this.recallBar.style.width = (1 - P.recallT / HERO.recallTime) * 100 + '%';

    // 其余内容每秒更新约 8 次就够了
    if ((this.slowT -= dt) <= 0) { this.slowT = 0.12; this.slow(); }
    if ((this.mapT -= dt) <= 0) { this.mapT = 0.15; this.drawMini(); }

    if (g.over && !this.endShown && (this._overT = (this._overT || 0) + dt) > 2.4) { this.endShown = true; this.openEnd(); }
  }

  /** 低频更新的文字和状态 */
  slow() {
    const P = this.P, g = this.game, c = this.c;
    const set = (key, val, fn) => { if (c[key] !== val) { c[key] = val; fn(val); } };
    set('gold', Math.floor(P.gold), (v) => { this.goldEl.textContent = v; });
    set('kda', `${P.kills}/${P.deaths}/${P.assists}`, (v) => { this.kdaEl.textContent = v; });
    set('sb', g.teamKills[0], (v) => { this.scoreB.textContent = v; });
    set('sr', g.teamKills[1], (v) => { this.scoreR.textContent = v; });
    set('tm', fmtTime(g.time), (v) => { this.timeEl.textContent = v; });
    set('lv', P.level, (v) => { this.stLv.textContent = v; });
    set('hp', Math.ceil(P.hp) + '/' + Math.round(P.maxHp), (v) => { this.stHp.lastChild.textContent = v; this.stHp.firstChild.style.width = (P.hp / P.maxHp) * 100 + '%'; });
    set('mp', Math.floor(P.mp) + '/' + Math.round(P.maxMp), (v) => { this.stMp.lastChild.textContent = v; this.stMp.firstChild.style.width = (P.mp / P.maxMp) * 100 + '%'; });
    set('xp', P.level >= ECON.maxLevel ? 100 : Math.round((P.exp / ECON.expNeed(P.level)) * 100), (v) => { this.stXp.firstChild.style.width = v + '%'; });

    // 技能按钮：等级角标、没学/没蓝时变灰、可加点时显示“+”
    for (let i = 0; i < 3; i++) {
      const b = this.skillBtns[i], lv = P.skillLv[i];
      b.setBadge(lv ? String(lv) : '');
      b.setEnabled(lv > 0 && P.mp >= P.skillCost(i) && P.alive);
      const can = P.alive && P.canLevel(i);
      set('pl' + i, can, (v) => { this.plusBtns[i].classList.toggle('show', v); });
    }
    // 快捷购买：显示推荐的下一件；买得起时高亮
    const id = P.nextBuild();
    set('qb', id ? id + (P.gold >= ITEMS[id].cost ? '+' : '-') : '', () => {
      if (!id) { this.quick.style.display = 'none'; return; }
      const it = ITEMS[id], ok = P.gold >= it.cost;
      this.quick.style.display = '';
      this.quick.className = 'quick g-pe' + (ok ? ' ok' : '');
      this.quick.innerHTML = `<b>${it.name}</b><span>${it.cost}</span>`;
    });
    // 作弊按钮：显示无敌开关的状态
    set('god', P.godT > 0, (v) => {
      this.cheatEl.textContent = v ? '无敌 开' : '无敌 关';
      this.cheatEl.classList.toggle('on', v);
    });
    // 阵亡遮罩
    set('dead', !P.alive, (v) => { this.deadEl.classList.toggle('show', v && !g.over); });
    if (!P.alive) this.deadTxt.textContent = `${Math.ceil(P.respawnT)} 秒后复活`;
    if (this.shopEl) this.refreshShop();
  }

  refreshItems() {
    const P = this.P;
    let h = '';
    for (let i = 0; i < MAX_ITEMS; i++) { const id = P.items[i]; h += id ? `<i class="it t-${ITEMS[id].type}">${ITEMS[id].name[0]}</i>` : '<i class="it"></i>'; }
    this.itemsEl.innerHTML = h;
  }

  /** 小地图：底图 + 塔、小兵、野怪、英雄 */
  drawMini() {
    const g = this.game, x = this.mctx, W = this.mini.width, H = this.mini.height, k = W / g.map.size[0], P = this.P;
    x.drawImage(this.miniBg, 0, 0, W, H);
    for (const u of g.units) {
      if (!u.alive) continue;
      const px = u.x * k, pz = u.z * k;
      if (u.kind === KIND.MINION) { x.fillStyle = TEAM_CSS[u.team]; x.fillRect(px - 1.5, pz - 1.5, 3, 3); }
      else if (u.kind === KIND.MONSTER) { x.fillStyle = '#ffd35a'; x.beginPath(); x.arc(px, pz, u.type === 'boss' ? 4.5 : 2.5, 0, 6.283); x.fill(); }
      else if (u.kind === KIND.TOWER) { x.fillStyle = TEAM_CSS[u.team]; x.strokeStyle = '#fff'; x.lineWidth = 1; x.fillRect(px - 4, pz - 4, 8, 8); x.strokeRect(px - 4, pz - 4, 8, 8); }
      else if (u.kind === KIND.CRYSTAL) { x.fillStyle = TEAM_CSS[u.team]; x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px, pz - 8); x.lineTo(px + 7, pz); x.lineTo(px, pz + 8); x.lineTo(px - 7, pz); x.closePath(); x.fill(); x.stroke(); }
    }
    for (const h of g.heroes) {
      if (!h.alive) continue;
      const px = h.x * k, pz = h.z * k, me = h === P;
      x.beginPath(); x.arc(px, pz, me ? 6.5 : 5.5, 0, 6.283);
      x.fillStyle = me ? '#ffe08a' : TEAM_CSS[h.team]; x.fill();
      x.lineWidth = 1.5; x.strokeStyle = me ? '#fff' : '#101624'; x.stroke();
    }
  }

  /* ---------------------------------------------------------- 弹出面板：商店、设置、结算 */

  closeOverlay() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; this.shopEl = null; this.api.pause(false); }
  }
  openOverlay(cls, pause) {
    this.closeOverlay();
    this.overlay = el('div', { cls: 'g-overlay ' + cls }, this.root);
    this.overlay.addEventListener('pointerdown', (e) => { if (e.target === this.overlay && cls !== 'end') this.closeOverlay(); });
    if (pause) this.api.pause(true);
    return el('div', { cls: 'g-panel box' }, this.overlay);
  }

  openShop() {
    const box = this.openOverlay('shop', false);
    el('div', { cls: 'box-head', html: '<b>商店</b><span class="shop-gold"></span>' }, box);
    el('div', { cls: 'g-ic box-x', text: '✕', on: { pointerdown: (e) => { e.preventDefault(); this.closeOverlay(); } } }, box);
    const list = el('div', { cls: 'shop-list g-scroll' }, box);
    const rec = this.P.nextBuild();
    this.shopCards = {};
    for (const id in ITEMS) {
      const it = ITEMS[id];
      const card = el('div', { cls: 'item', html: `<i class="it t-${it.type}">${it.name[0]}</i><div><b>${it.name}${id === rec ? '<em>推荐</em>' : ''}</b><span>${it.desc}</span></div><u>${it.cost}</u>`, on: { click: () => { this.tryBuy(id); Sfx.play('click'); } } }, list);
      this.shopCards[id] = card;
    }
    this.shopEl = box;
    this.refreshShop();
  }
  refreshShop() {
    const P = this.P;
    this.shopEl.querySelector('.shop-gold').textContent = `金币 ${Math.floor(P.gold)}　装备 ${P.items.length}/${MAX_ITEMS}`;
    for (const id in this.shopCards) {
      const own = P.items.includes(id);
      this.shopCards[id].className = 'item' + (own ? ' own' : P.gold >= ITEMS[id].cost && P.items.length < MAX_ITEMS ? ' ok' : '');
    }
  }

  openSettings() {
    const box = this.openOverlay('set', true), st = this.api.stage;
    el('div', { cls: 'box-head', html: '<b>设置</b>' }, box);
    const row = (label) => { const r = el('div', { cls: 'set-row' }, box); el('span', { text: label }, r); return el('div', { cls: 'seg' }, r); };
    const q = row('画质');
    const names = ['自动', ...QUALITY.map((x) => x.name)];
    const mark = () => [...q.children].forEach((b, i) => b.classList.toggle('on', i === 0 ? st.auto : !st.auto && st.level === i - 1));
    names.forEach((n, i) => el('button', { text: n, on: { click: () => { if (i === 0) st.setQuality(st.level, true); else st.setQuality(i - 1, false); mark(); } } }, q));
    mark();
    const s = row('声音');
    const smark = () => [...s.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === !Sfx.muted));
    ['开', '关'].forEach((n, i) => el('button', { text: n, on: { click: () => { Sfx.setMuted(i === 1); Sfx.unlock(); smark(); } } }, s));
    smark();
    const f = el('div', { cls: 'set-btns' }, box);
    el('button', { cls: 'g-b', text: '继续游戏', on: { click: () => this.closeOverlay() } }, f);
    el('button', { cls: 'g-b ghost', text: '全屏', on: { click: () => toggleFullscreen() } }, f);
    el('button', { cls: 'g-b ghost', text: '重新开始', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '退出对局', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, f);
    el('div', { cls: 'set-tip', text: '电脑键位：WASD 移动，J / 空格 / 鼠标左键普攻，Q E R 技能（朝鼠标方向），1 2 3 加点，B 回城，F 闪现，G 恢复，P 商店。' }, box);
  }

  openEnd() {
    const g = this.game, win = g.over.winner === this.P.team;
    const box = this.openOverlay('end', false);
    el('div', { cls: 'end-title ' + (win ? 'win' : 'lose'), text: win ? '胜 利' : '失 败' }, box);
    el('div', { cls: 'end-sub', text: `${g.map.name}　用时 ${fmtTime(g.over.time)}　比分 ${g.teamKills[0]} : ${g.teamKills[1]}` }, box);
    const tb = el('div', { cls: 'end-table g-scroll' }, box);
    for (const h of g.heroes) {
      el('div', { cls: 'end-row ' + (h.team ? 'r' : 'b') + (h === this.P ? ' me' : ''), html: `<b>${h.def.name}</b><span>${h.def.roleName} Lv${h.level}</span><span>${h.kills} / ${h.deaths} / ${h.assists}</span><span>${Math.round(h.totalGold)} 金</span>` }, tb);
    }
    const f = el('div', { cls: 'set-btns' }, box);
    el('button', { cls: 'g-b gold', text: '再来一局', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '返回选人', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, f);
  }

  /** 退出对局时解除事件绑定 */
  dispose() {
    window.removeEventListener('pointermove', this._mm);
    window.removeEventListener('pointerup', this._mu);
    this.api.stage.canvas.removeEventListener('pointerdown', this._md);
    this.view.fx.setAim(null);
    this.root.innerHTML = '';
  }
}
