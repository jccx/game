// 梦想乐园：界面和输入——开局菜单、顶栏、建造工具栏、过山车编辑器、财务、设施详情、存档。
// 手机：点工具栏选工具，再点地图落子；电脑：数字键 1~4 换工具，Esc 关面板，空格暂停。
import { el, toast, store, toggleFullscreen, makeMemo, makeCheatButton } from '../../shared/js/ui.js';
import { qualityRow, soundRow } from '../../shared/js/settings.js';
import { Sfx } from '../../shared/js/audio.js';
import { QUALITY } from '../../shared/js/stage.js';
import { GRID, PATH, RIDES, SHOPS, BUILDING, TICKET, LOAN, RESEARCH, WEATHER, COASTER, SCENARIOS, DIFFICULTY } from './config.js';
import { coasterStats, SAVE_KEY } from './game.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  road: svg('<path d="M6 3v18M18 3v18M6 8h12M6 16h12"/>'),
};

/** 开局菜单：选方案、选难度。“开始经营”放在最上面 */
export function showMenu(root, onStart) {
  const sel = store.get('park-pick', { scenario: 'meadow', difficulty: 1 });
  const hasSave = (() => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } })();
  const wrap = el('div', { cls: 'g-overlay pmenu' }, root), box = el('div', { cls: 'g-panel pbox' }, wrap);
  const head = el('div', { cls: 'phead' }, box);
  el('h1', { text: '梦想乐园' }, head);
  const acts = el('div', { cls: 'pacts' }, head);
  el('a', { cls: 'g-b ghost sm', text: '返回大厅', attrs: { href: '../' } }, acts);
  el('button', { cls: 'g-b gold start', text: '开始经营', on: { click: () => { Sfx.unlock(); Sfx.play('go'); store.set('park-pick', sel); onStart({ scenario: sel.scenario, difficulty: sel.difficulty }); } } }, acts);
  if (hasSave) {
    el('button', { cls: 'g-b sm', text: '继续上次经营', on: { click: () => { Sfx.unlock(); Sfx.play('go'); onStart({ load: true }); } } }, acts);
  }
  const body = el('div', { cls: 'pbody g-scroll' }, box);
  el('h3', { text: '开局方案' }, body);
  const scRow = el('div', { cls: 'ptracks' }, body);
  const scBtns = SCENARIOS.map((s) => {
    const b = el('button', { cls: 'ptrack', on: { click: () => { sel.scenario = s.id; refresh(); Sfx.play('click'); } } }, scRow);
    el('b', { text: s.name }, b); el('span', { text: s.desc }, b);
    el('i', { text: `起始资金 ${s.money} 元 · 口碑 ${s.reputation}` }, b);
    return b;
  });
  el('h3', { text: '难度' }, body);
  const seg = el('div', { cls: 'seg' }, body);
  const dBtns = DIFFICULTY.map((d, i) => el('button', { text: d.name, on: { click: () => { sel.difficulty = i; refresh(); Sfx.play('click'); } } }, seg));
  el('p', { cls: 'ptip', text: '玩法：先铺路，再在路边建游乐设施和商店，游客会自己走进来玩、排队、掏钱。每天结算维护费，贷款每月收利息，钱跌破 -5000 就破产。过山车要先研究图纸、建站台，再一段一段搭轨道，闭环才能开。' }, body);
  function refresh() {
    scBtns.forEach((b, i) => b.classList.toggle('on', SCENARIOS[i].id === sel.scenario));
    dBtns.forEach((b, i) => b.classList.toggle('on', i === sel.difficulty));
  }
  refresh();
  return { close() { wrap.remove(); } };
}

const fmtMoney = (n) => (n < 0 ? '-' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('en-US');

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('./game.js').Park} park
   * @param {{keys:object, view:object, stage:object, setSpeed:(n:number)=>void, restart:()=>void, exit:()=>void}} api
   */
  constructor(root, park, api) {
    this.root = root; this.park = park; this.api = api; this.keys = api.keys; this.view = api.view;
    this.c = {}; this.slowT = 0; this.msgT = 0; this.endT = 0; this.overlay = null;
    this.tool = null; // 当前建造工具：'path' | 建筑 id | 'demolish' | null
    this.speed = 1;
    root.innerHTML = '';
    const r = root;
    // 顶栏：金钱 / 口碑 / 游客 / 日期 / 天气
    const top = el('div', { cls: 'ptop' }, r);
    this.moneyEl = el('div', { cls: 'pmoney', text: '¥20,000' }, top);
    this.repEl = el('div', { cls: 'prep', text: '口碑 50' }, top);
    this.visEl = el('div', { cls: 'pvis', text: '游客 0' }, top);
    this.dayEl = el('div', { cls: 'pday', text: '第 1 天' }, top);
    this.wxEl = el('div', { cls: 'pwx', text: '☀️ 晴' }, top);
    // 右上：无敌开关（设置左边）、设置
    const right = el('div', { cls: 'pright' }, r), row = el('div', { cls: 'prow' }, right);
    this.cheat = makeCheatButton(row, {
      label: '免费建造',
      get: () => this.park.god,
      onToggle: () => { this.park.god = !this.park.god; Sfx.play(this.park.god ? 'levelup' : 'click'); toast(this.park.god ? '免费建造已打开：建造和研究不花钱' : '免费建造已关闭'); },
    });
    this.cheatEl = this.cheat.el;
    el('div', { cls: 'g-ic', html: IC.gear, on: { pointerdown: (e) => { e.preventDefault(); this.openSettings(); } } }, row);
    // 中间提示
    this.msgEl = el('div', { cls: 'pmsg' }, r);
    // 建造面板（工具栏上方弹出）
    this.panelEl = el('div', { cls: 'ppanel g-panel g-hide' }, r);
    // 底部工具栏：路 / 设施 / 商店 / 拆除 / 过山车 / 财务 / 票价 / 速度 / 存档
    const bar = el('div', { cls: 'pbar' }, r);
    const mk = (text, cls, fn) => el('button', { cls: 'g-b sm ' + (cls || ''), text, on: { click: () => { Sfx.unlock(); fn(); } } }, bar);
    this.bPath = mk('铺路', 'ptool', () => this.pickTool('path'));
    this.bRide = mk('设施', 'ptool', () => this.openBuildPanel('ride'));
    this.bShop = mk('商店', 'ptool', () => this.openBuildPanel('shop'));
    this.bDemolish = mk('拆除', 'ptool', () => this.pickTool('demolish'));
    this.bCoaster = mk('过山车', 'ptool', () => this.openCoasterPanel());
    this.bFinance = mk('财务', 'ptool', () => this.openFinancePanel());
    this.bTicket = mk('票价 ¥10', 'ptool', () => this.openTicketPanel());
    this.bSpeed = mk('1x', 'ptool', () => this.cycleSpeed());
    this.bSave = mk('存档', 'ptool', () => this.saveGame());
    this.toolBtns = { path: this.bPath, demolish: this.bDemolish };
  }

  /* ------------------------------------------------------------ 工具选择 */

  pickTool(tool) {
    this.tool = this.tool === tool ? null : tool;
    this.closePanel();
    this._markTools();
    if (this.tool) toast(this.tool === 'path' ? '铺路：点一块草地铺路（每格 ¥20）' : '拆除：点一个建筑或一段路拆掉，返还 30%');
    Sfx.play('click');
  }

  _markTools() {
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('on', this.tool === k);
    this.bRide.classList.toggle('on', !!this.tool && RIDES.some((x) => x.id === this.tool));
    this.bShop.classList.toggle('on', !!this.tool && SHOPS.some((x) => x.id === this.tool));
  }

  /** 点地图：按当前工具落子；没选工具时点建筑看详情 */
  onCanvasTap(tile) {
    const p = this.park;
    if (p.over) return;
    if (!this.tool) { this.openDetailAt(tile); return; }
    let res;
    if (this.tool === 'path') res = p.buildPath(tile.x, tile.z);
    else if (this.tool === 'demolish') res = p.demolishAt(tile.x, tile.z);
    else res = p.build(this.tool, tile.x, tile.z);
    if (res.ok) {
      Sfx.play('coin');
      this.view.dirty = true;
      if (res.building) this.msg(`${BUILDING[this.tool].name}建好了`, '', 1.5);
    } else {
      Sfx.play('error');
      toast(res.reason || '建不了');
    }
  }

  /* ------------------------------------------------------------ 面板 */

  closePanel() { this.panelEl.classList.add('g-hide'); this.panelEl.innerHTML = ''; this.panelMode = null; }
  openPanel(title) {
    this.panelEl.classList.remove('g-hide');
    this.panelEl.innerHTML = '';
    const h = el('div', { cls: 'pp-head' }, this.panelEl);
    el('b', { text: title }, h);
    el('button', { cls: 'g-b ghost sm', text: '关闭', on: { click: () => this.closePanel() } }, h);
    return el('div', { cls: 'pp-body g-scroll' }, this.panelEl);
  }

  /** 建造面板：设施或商店列表，点一个再点地图落子 */
  openBuildPanel(kind) {
    const list = kind === 'ride' ? RIDES : SHOPS;
    const body = this.openPanel(kind === 'ride' ? '建游乐设施' : '建商店 / 厕所');
    this.panelMode = 'build';
    for (const def of list) {
      const locked = def.tier === 2 && !this.park.researched.has(def.id);
      const row = el('button', { cls: 'pp-row' + (locked ? ' off' : ''), on: { click: () => {
        if (locked) { toast(def.name + '还没研究解锁，先去财务里研究'); return; }
        this.tool = def.id; this._markTools(); this.closePanel();
        toast(`${def.name}：点一块空地建造（¥${def.cost}，占 ${def.w}×${def.d} 格）`);
        Sfx.play('click');
      } } }, body);
      el('span', { cls: 'emoji', text: def.icon }, row);
      el('b', { text: def.name }, row);
      el('span', { text: def.desc }, row);
      el('em', { text: locked ? '未解锁' : '¥' + def.cost }, row);
    }
    el('div', { cls: 'set-tip', text: '设施要建在路边，游客才能走过去排队。点地图上的建筑可以看详情。' }, body);
  }

  /** 过山车编辑器：先研究、建站台，再一段一段加轨道 */
  openCoasterPanel() {
    const p = this.park;
    const body = this.openPanel('过山车编辑器');
    this.panelMode = 'coaster';
    this.coasterBody = body;
    this._renderCoaster(body);
  }

  _renderCoaster(body) {
    const p = this.park;
    body.innerHTML = '';
    const st = coasterStats(p.coaster.segments);
    const tr = p.coasterTrace;
    const info = el('div', { cls: 'pp-info' }, body);
    if (!p.researched.has('coaster')) {
      info.textContent = '先去“财务”研究过山车图纸（¥5000），再建站台。';
      return;
    }
    if (!p.coaster.station) {
      info.textContent = '还没建站台：选“设施”里的过山车，在空地上建一个站台。';
      return;
    }
    info.innerHTML = `轨道 ${p.coaster.segments.length} 段 · ${p.coasterClosed ? '已闭环，可以运营' : '未闭环，不能运营'}<br>速度 ${st.speed.toFixed(1)} · 刺激度 ${st.thrill.toFixed(1)} · 下坡 ${st.drops} · 转弯 ${st.turns}`;
    const row = el('div', { cls: 'pp-btns' }, body);
    const segs = [['straight', '直行'], ['left', '左转'], ['right', '右转'], ['up', '上坡'], ['down', '下坡']];
    for (const [id, name] of segs) {
      el('button', { cls: 'g-b sm', text: name + ' ¥300', on: { click: () => {
        const res = p.coasterAdd(id);
        if (res.ok) { Sfx.play('coin'); this.view.dirty = true; this._renderCoaster(body); if (res.closed) toast('轨道闭环了，过山车可以运营了！'); }
        else { Sfx.play('error'); toast(res.reason); }
      } } }, row);
    }
    el('button', { cls: 'g-b ghost sm', text: '撤销一段', on: { click: () => { p.coasterUndo(); this.view.dirty = true; this._renderCoaster(body); } } }, row);
    el('button', { cls: 'g-b ghost sm', text: '清空轨道', on: { click: () => { p.coasterClear(); this.view.dirty = true; this._renderCoaster(body); } } }, row);
    el('div', { cls: 'set-tip', text: '从站台北边出发，每段走一格；回到出发格就闭环。下坡提速又刺激，转弯多了会减速。' }, body);
  }

  /** 财务面板：收支、贷款、研究 */
  openFinancePanel() {
    const p = this.park;
    const body = this.openPanel('财务');
    this.panelMode = 'finance';
    this.financeBody = body;
    this._renderFinance(body);
  }

  _renderFinance(body) {
    const p = this.park;
    body.innerHTML = '';
    const sum = el('div', { cls: 'pp-info' }, body);
    sum.innerHTML = `现金 ${fmtMoney(p.money)} · 贷款 ${fmtMoney(p.loan)}<br>累计收入 ${fmtMoney(p.totalEarned)} · 累计支出 ${fmtMoney(p.totalSpent)} · 已服务 ${p.served} 人<br>贷款月息 5%，每 5 天收一次；现金跌破 -¥5000 就破产。`;
    const row = el('div', { cls: 'pp-btns' }, body);
    el('button', { cls: 'g-b sm', text: '借 ¥5000', on: { click: () => { const r = p.borrow(5000); if (!r.ok) { toast(r.reason); Sfx.play('error'); } else { Sfx.play('coin'); this._renderFinance(body); } } } }, row);
    el('button', { cls: 'g-b sm', text: '还 ¥5000', on: { click: () => { const r = p.repay(5000); if (!r.ok) { toast(r.reason); Sfx.play('error'); } else { Sfx.play('coin'); this._renderFinance(body); } } } }, row);
    el('button', { cls: 'g-b sm', text: '还清', on: { click: () => { const r = p.repay(p.loan); if (!r.ok) { toast(r.reason); Sfx.play('error'); } else { Sfx.play('coin'); this._renderFinance(body); } } } }, row);
    el('h3', { text: '研究' }, body);
    for (const r of RESEARCH) {
      const done = p.researched.has(r.id);
      const row2 = el('button', { cls: 'pp-row' + (done ? ' off' : ''), on: { click: () => {
        const res = p.research(r.id);
        if (!res.ok) { toast(res.reason); Sfx.play('error'); } else { Sfx.play('levelup'); toast(r.name + '研究完成'); this._renderFinance(body); }
      } } }, body);
      el('span', { cls: 'emoji', text: done ? '✅' : '🔬' }, row2);
      el('b', { text: r.name }, row2);
      el('span', { text: r.desc }, row2);
      el('em', { text: done ? '已完成' : '¥' + r.cost }, row2);
    }
  }

  /** 票价面板：加减门票 */
  openTicketPanel() {
    const p = this.park;
    const body = this.openPanel('门票');
    this.panelMode = 'ticket';
    this.ticketBody = body;
    this._renderTicket(body);
  }

  _renderTicket(body) {
    const p = this.park;
    body.innerHTML = '';
    el('div', { cls: 'pp-info', text: `当前门票 ¥${p.ticketPrice}（上限 ¥${p.ticketCap}）。票价越高收入越多，但游客来得越少。` }, body);
    const row = el('div', { cls: 'pp-btns' }, body);
    el('button', { cls: 'g-b sm', text: '-5', on: { click: () => { p.setTicket(p.ticketPrice - 5); this._renderTicket(body); } } }, row);
    el('button', { cls: 'g-b sm', text: '-1', on: { click: () => { p.setTicket(p.ticketPrice - 1); this._renderTicket(body); } } }, row);
    el('button', { cls: 'g-b sm', text: '+1', on: { click: () => { p.setTicket(p.ticketPrice + 1); this._renderTicket(body); } } }, row);
    el('button', { cls: 'g-b sm', text: '+5', on: { click: () => { p.setTicket(p.ticketPrice + 5); this._renderTicket(body); } } }, row);
  }

  /** 设施详情：点地图上的建筑看运营情况，可以拆除 */
  openDetailAt(tile) {
    const p = this.park;
    const b = p.buildings.find((x) => tile.x >= x.x && tile.x < x.x + x.w && tile.z >= x.z && tile.z < x.z + x.d);
    if (!b) return;
    const def = BUILDING[b.type];
    const body = this.openPanel(def.icon + ' ' + def.name);
    this.panelMode = 'detail';
    const info = el('div', { cls: 'pp-info' }, body);
    const extra = b.type === 'coaster'
      ? (p.coasterClosed ? `轨道已闭环，速度 ${coasterStats(p.coaster.segments).speed.toFixed(1)}，刺激度 ${coasterStats(p.coaster.segments).thrill.toFixed(1)}` : '轨道未闭环，暂时不能运营')
      : `票价 ¥${def.price} · 容量 ${def.capacity} 人 · 刺激度 ${def.thrill || '-'} · 每天维护 ¥${def.upkeep}`;
    info.innerHTML = `${extra}<br>排队 ${b.queue.length} 人 · 正在玩 ${b.riders.length} 人`;
    const row = el('div', { cls: 'pp-btns' }, body);
    el('button', { cls: 'g-b ghost sm', text: '拆除（返还 ¥' + Math.round(def.cost * 0.3) + '）', on: { click: () => { p.demolishAt(b.x, b.z); this.view.dirty = true; this.closePanel(); Sfx.play('click'); } } }, row);
    if (b.type === 'coaster') {
      el('button', { cls: 'g-b sm', text: '编辑轨道', on: { click: () => this.openCoasterPanel() } }, row);
    }
  }

  /* ------------------------------------------------------------ 速度、存档 */

  cycleSpeed() {
    const order = [0, 1, 2, 3];
    this.speed = order[(order.indexOf(this.speed) + 1) % order.length];
    this.api.setSpeed(this.speed);
    this.bSpeed.textContent = this.speed === 0 ? '暂停' : this.speed + 'x';
    Sfx.play('click');
  }

  setSpeed(n) {
    this.speed = n;
    this.api.setSpeed(n);
    this.bSpeed.textContent = n === 0 ? '暂停' : n + 'x';
  }

  saveGame() {
    if (this.park.save()) toast('已存档');
    else toast('存档失败（浏览器不允许保存）');
    Sfx.play('coin');
  }

  /* ------------------------------------------------------------ 输入、事件 */

  readInput() {
    const k = this.keys;
    if (k.hit('Digit1')) this.pickTool('path');
    else if (k.hit('Digit2')) this.openBuildPanel('ride');
    else if (k.hit('Digit3')) this.openBuildPanel('shop');
    else if (k.hit('Digit4')) this.pickTool('demolish');
    else if (k.hit('Digit5')) this.openCoasterPanel();
    else if (k.hit('Digit6')) this.openFinancePanel();
    if (k.hit('Space')) this.cycleSpeed();
    if (k.hit('Escape')) this.overlay ? this.closeOverlay() : this.closePanel();
  }

  onEvent(ev) {
    const p = this.park;
    switch (ev.type) {
      case 'day': this.msg(`第 ${ev.day} 天`, `维护费 ¥${ev.upkeep}`, 2.2); break;
      case 'weather': { const w = WEATHER[ev.weather]; this.msg(`${w.icon} ${w.name}`, w.desc, 2); break; }
      case 'interest': toast(`贷款利息 ¥${ev.interest}`); break;
      case 'research': Sfx.play('levelup'); break;
      case 'ride': Sfx.play('coin', 0.3); break;
      case 'over': Sfx.play('lose'); break;
    }
    void p;
  }

  msg(a, b, dur = 2) {
    this.msgEl.innerHTML = `<b>${a}</b>${b ? `<span>${b}</span>` : ''}`;
    this.msgEl.className = 'pmsg show'; this.msgT = dur;
  }

  update(dt) {
    const p = this.park;
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.msgEl.className = 'pmsg';
    if (p.over && !this.overlay && (this.endT += dt) > 1.5) this.openEnd();
    if ((this.slowT -= dt) > 0) return;
    this.slowT = 0.08;
    const c = this.c;
    const set = makeMemo(c);
    set('money', Math.round(p.money), (v) => { this.moneyEl.textContent = fmtMoney(v); this.moneyEl.classList.toggle('neg', v < 0); });
    set('rep', Math.round(p.reputation), (v) => { this.repEl.textContent = `口碑 ${v}`; });
    set('vis', p.visitors.length, (v) => { this.visEl.textContent = `游客 ${v}`; });
    set('day', p.day, (v) => { this.dayEl.textContent = `第 ${v} 天`; });
    set('wx', p.weather, (v) => { const w = WEATHER[v]; this.wxEl.textContent = `${w.icon} ${w.name}`; });
    set('god', p.god, (v) => this.cheat.sync(v));
    set('ticket', p.ticketPrice, (v) => { this.bTicket.textContent = `票价 ¥${v}`; });
    // 过山车面板开着时，轨道一变就刷新
    if (this.panelMode === 'coaster' && this.coasterBody) {
      const sig = p.coaster.segments.length + '|' + p.coasterClosed;
      if (c.coasterSig !== sig) { c.coasterSig = sig; this._renderCoaster(this.coasterBody); }
    }
  }

  closeOverlay() { if (this.overlay) { this.overlay.remove(); this.overlay = null; this.api.setSpeed(this.speed); } }
  openOverlay(cls, pause) {
    this.closeOverlay();
    this.overlay = el('div', { cls: 'g-overlay ' + cls }, this.root);
    if (pause) this.api.setSpeed(0);
    return el('div', { cls: 'g-panel pbox' }, this.overlay);
  }

  openSettings() {
    const box = this.openOverlay('pset', true), st = this.api.stage;
    el('div', { cls: 'phead', html: '<h2>设置</h2>' }, box);
    qualityRow(box, st, ['自动', ...QUALITY.map((x) => x.name)]);
    soundRow(box);
    const f = el('div', { cls: 'set-btns' }, box);
    el('button', { cls: 'g-b', text: '继续', on: { click: () => this.closeOverlay() } }, f);
    el('button', { cls: 'g-b ghost', text: '重新开始', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '回大厅', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '全屏', on: { click: () => toggleFullscreen() } }, f);
    el('div', { cls: 'set-tip', text: '电脑键位：1 铺路，2 设施，3 商店，4 拆除，5 过山车，6 财务，空格暂停，Esc 关面板。手机：点工具栏选工具，再点地图落子；拖动地图平移，双指缩放。' }, box);
  }

  /** 破产结算 */
  openEnd() {
    const p = this.park, box = this.openOverlay('pend', false);
    const head = el('div', { cls: 'phead' }, box);
    el('h2', { text: '破产了！' }, head);
    const acts = el('div', { cls: 'pacts' }, head);
    el('button', { cls: 'g-b gold', text: '再来一局', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, acts);
    el('button', { cls: 'g-b ghost', text: '回大厅', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, acts);
    const list = el('div', { cls: 'pend-list g-scroll' }, box);
    el('div', { cls: 'pend-row', html: `<span>经营天数</span><em>${p.day} 天</em>` }, list);
    el('div', { cls: 'pend-row', html: `<span>累计收入</span><em>${fmtMoney(p.totalEarned)}</em>` }, list);
    el('div', { cls: 'pend-row', html: `<span>累计支出</span><em>${fmtMoney(p.totalSpent)}</em>` }, list);
    el('div', { cls: 'pend-row', html: `<span>服务游客</span><em>${p.served} 人</em>` }, list);
    el('div', { cls: 'pend-row', html: `<span>最终口碑</span><em>${Math.round(p.reputation)}</em>` }, list);
    el('div', { cls: 'set-tip', text: '现金跌破 -¥5000 就破产。下次记得早点还贷款、控制维护费，别把票价定得太高吓跑游客。' }, box);
  }

  dispose() { this.root.innerHTML = ''; }
}
