// 豆兵大战：界面和输入——开局菜单、回合中的仪表和按键、武器面板、结算。
// 手机：左下 ◀ ▶ 走、跳、后翻；右下大键“开火”（按住拖动瞄准，拖的方向是发射方向，距离是力度，松手发射，拖回中心取消）；
// 武器键打开武器面板。空袭和传送先点一下地图选位置，再拖开火键发射。
// 电脑：A/D 或方向键走，W 或空格跳，S 或 F 后翻，数字键 1~8 选武器，Enter 跳过回合，Esc 设置。
import { el, toast, store, toggleFullscreen } from '../../shared/js/ui.js';
import { ActionButton } from '../../shared/js/input.js';
import { Sfx } from '../../shared/js/audio.js';
import { WEAPONS, WEAPON, TEAMS, DIFFICULTY, THEMES, RULES } from './config.js';
import { QUALITY2D } from './render.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  jump: svg('<path d="M12 20V6M5 12l7-7 7 7"/>'),
  flip: svg('<path d="M4 14a8 8 0 1 1 2 6M4 20v-6h6"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  fire: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="#fff"/>'),
};

/** 开局菜单：队伍数、每队人数、难度、地形。“开始战斗”放在最上面 */
export function showMenu(root, onStart) {
  const sel = store.get('artillery-pick', { teams: 2, size: 3, difficulty: 1, theme: 0 });
  const wrap = el('div', { cls: 'g-overlay amenu' }, root), box = el('div', { cls: 'g-panel abox' }, wrap);
  const head = el('div', { cls: 'ahead' }, box);
  el('h1', { text: '豆兵大战' }, head);
  const acts = el('div', { cls: 'aacts' }, head);
  el('a', { cls: 'g-b ghost sm', text: '返回大厅', attrs: { href: '../' } }, acts);
  el('button', { cls: 'g-b gold start', text: '开始战斗', on: { click: () => { Sfx.unlock(); Sfx.play('go'); store.set('artillery-pick', sel); onStart({ teams: sel.teams, size: sel.size, difficulty: sel.difficulty, theme: sel.theme }); } } }, acts);
  const body = el('div', { cls: 'abody g-scroll' }, box);
  const segRow = (label, items, get, set) => {
    el('h3', { text: label }, body);
    const seg = el('div', { cls: 'seg' }, body);
    const btns = items.map((t) => el('button', { text: t, on: { click: () => { set(t); refresh(); Sfx.play('click'); } } }, seg));
    return btns;
  };
  const tBtns = segRow('队伍数', ['2 队', '3 队', '4 队'], 0, (t) => { sel.teams = 2 + ['2 队', '3 队', '4 队'].indexOf(t); });
  const sBtns = segRow('每队几个豆兵', ['2 个', '3 个', '4 个'], 0, (t) => { sel.size = 2 + ['2 个', '3 个', '4 个'].indexOf(t); });
  const dBtns = segRow('电脑难度', DIFFICULTY.map((d) => d.name), 0, (t) => { sel.difficulty = DIFFICULTY.findIndex((d) => d.name === t); });
  el('h3', { text: '地形' }, body);
  const thRow = el('div', { cls: 'ath' }, body);
  const thBtns = THEMES.map((th, i) => {
    const b = el('button', { cls: 'athb', on: { click: () => { sel.theme = i; refresh(); Sfx.play('click'); } } }, thRow);
    el('i', { style: { background: th.sky[0] } }, b);
    el('b', { text: th.name }, b); el('span', { text: th.id === 'meadow' ? '起伏的草地' : th.id === 'desert' ? '平缓的沙丘' : '雪地和冰面' }, b);
    return b;
  });
  el('p', { cls: 'atip', text: '玩法：轮到你的豆兵时，先走位，再拖动右下“开火”键瞄准，松手发射。炮弹受风影响，风向和风力看左上角；炸出的坑会把地形炸掉，掉进水里就出局。第一队（黄豆队）是你。' }, body);
  function refresh() {
    tBtns.forEach((b, i) => b.classList.toggle('on', i === sel.teams - 2));
    sBtns.forEach((b, i) => b.classList.toggle('on', i === sel.size - 2));
    dBtns.forEach((b, i) => b.classList.toggle('on', i === sel.difficulty));
    thBtns.forEach((b, i) => b.classList.toggle('on', i === sel.theme));
  }
  refresh();
  return { close() { wrap.remove(); } };
}

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('./game.js').Game} game
   * @param {{keys:object, view:object, pause:(b:boolean)=>void, restart:()=>void, exit:()=>void}} api
   */
  constructor(root, game, api) {
    this.root = root; this.game = game; this.api = api; this.keys = api.keys; this.view = api.view;
    this.c = {}; this.bigT = 0; this.msgT = 0; this.endT = 0; this.overlay = null;
    this.aim = null; this.target = null; this.jumpQueued = false; this.flipQueued = false; this._lastBean = null;
    root.innerHTML = '';
    const r = root;
    // 左上：当前队伍、回合倒计时、风向、队伍血条
    const st = el('div', { cls: 'astat' }, r);
    this.turnEl = el('div', { cls: 'aturn' }, st);
    const row2 = el('div', { cls: 'arow2' }, st);
    this.timeEl = el('div', { cls: 'atime', text: '30' }, row2);
    this.windEl = el('div', { cls: 'awind', text: '无风' }, row2);
    this.teamsEl = el('div', { cls: 'ateams' }, st);
    this.teamRows = this.game.teams.map((tm) => {
      const row = el('div', { cls: 'ateam' }, this.teamsEl);
      el('i', { style: { background: tm.def.color } }, row);
      el('span', { text: tm.def.name }, row);
      const bar = el('div', { cls: 'abar' }, row);
      const fill = el('i', {}, bar);
      const hp = el('em', {}, row);
      return { fill, hp };
    });
    // 右上：无敌开关、设置；下面是跳过回合和全景
    const right = el('div', { cls: 'aright' }, r), row = el('div', { cls: 'arow' }, right);
    this.cheatEl = el('div', { cls: 'cheat', text: '无敌 关', on: { pointerdown: (e) => { e.preventDefault(); this.game.god = !this.game.god; Sfx.play(this.game.god ? 'levelup' : 'click'); toast(this.game.god ? '无敌已打开：挨炸不掉血，落水回到上一个落脚点' : '无敌已关闭'); } } }, row);
    el('div', { cls: 'g-ic', html: IC.gear, on: { pointerdown: (e) => { e.preventDefault(); this.openSettings(); } } }, row);
    const rowB = el('div', { cls: 'arow' }, right);
    this.skipEl = el('button', { cls: 'g-b ghost sm askip', text: '跳过回合', on: { click: () => { if (this.game.skip()) Sfx.play('click'); } } }, rowB);
    this.viewEl = el('button', { cls: 'g-b ghost sm aview', text: '全景', on: { click: () => { const ov = this.view.cam.mode !== 'overview'; this.view.setOverview(ov); this.viewEl.textContent = ov ? '跟随' : '全景'; Sfx.play('click'); } } }, rowB);
    // 中间：大字、提示
    this.bigEl = el('div', { cls: 'abig' }, r); this.msgEl = el('div', { cls: 'amsg' }, r);
    // 左下：◀ ▶ 跳 后翻
    const mv = el('div', { cls: 'amove' }, r);
    this.bLeft = new ActionButton(mv, { cls: 'a-left', icon: IC.left, label: '左' });
    this.bRight = new ActionButton(mv, { cls: 'a-right', icon: IC.right, label: '右' });
    this.bJump = new ActionButton(mv, { cls: 'a-jump', icon: IC.jump, label: '跳', onDown: () => { this.jumpQueued = true; Sfx.unlock(); } });
    this.bFlip = new ActionButton(mv, { cls: 'a-flip', icon: IC.flip, label: '后翻', onDown: () => { this.flipQueued = true; Sfx.unlock(); } });
    // 右下：开火（拖动瞄准）、武器
    const pad = el('div', { cls: 'apad' }, r);
    this.bFire = new ActionButton(pad, {
      cls: 'a-fire', icon: IC.fire, label: '开火', aim: true, aimRadius: 64,
      onDown: () => Sfx.unlock(),
      onAim: (ax, ay, mag) => {
        if (!this.game.myTurn || this.game.turn.state !== 'aim') return;
        const angle = Math.atan2(ay, ax);
        this.aim = { angle, power: mag, weapon: this.game.turn.weapon };
        this.view.aim = this.aim;
      },
      onUp: (ax, ay, mag, cancelled) => {
        const a = this.aim; this.aim = null; this.view.aim = null;
        if (cancelled || mag < 0.2 || !a) return;
        this.doFire(a.angle, a.power);
      },
    });
    this.bWeapon = new ActionButton(pad, {
      cls: 'a-weapon', label: '武器',
      onDown: () => { Sfx.unlock(); this.openWeapons(); },
    });
  }

  /** 点画布：空袭/传送选位置；其它时候不管 */
  onCanvasTap(x, y) {
    const g = this.game;
    if (!g.myTurn || g.turn.state !== 'aim') return;
    const w = WEAPON[g.turn.weapon];
    if (w.kind === 'strike' || w.kind === 'move') {
      this.target = { x, y }; this.view.target = this.target;
      toast('已选位置，拖动“开火”发射');
      Sfx.play('click');
    }
  }

  /** 开火。angle 是方向（弧度，向上为负），power 0~1 */
  doFire(angle, power) {
    const g = this.game, w = WEAPON[g.turn.weapon];
    if (!g.myTurn || g.turn.state !== 'aim') return false;
    if (w.kind === 'strike' || w.kind === 'move') {
      if (!this.target) { toast('先点一下地图选位置'); return false; }
      const ok = g.fire(angle, 1, this.target);
      if (ok) { this.target = null; this.view.target = null; }
      return ok;
    }
    return g.fire(angle, power);
  }

  /** 每个逻辑帧调用：把按钮和键盘写进操作意图 */
  readInput() {
    const g = this.game, k = this.keys;
    if (!g.myTurn) { g.input.move = 0; g.input.jump = false; g.input.flip = false; return; }
    let m = 0;
    if (this.bLeft.pressed) m = -1; else if (this.bRight.pressed) m = 1;
    if (k.isDown('KeyA', 'ArrowLeft')) m = -1; else if (k.isDown('KeyD', 'ArrowRight')) m = 1;
    g.input.move = m;
    g.input.jump = this.jumpQueued || k.hit('KeyW', 'ArrowUp') || k.hit('Space');
    g.input.flip = this.flipQueued || k.hit('KeyS', 'ArrowDown') || k.hit('KeyF');
    this.jumpQueued = false; this.flipQueued = false;
    for (let i = 0; i < WEAPONS.length; i++) if (k.hit('Digit' + (i + 1))) g.selectWeapon(WEAPONS[i].id);
    if (k.hit('Enter')) g.skip();
    if (k.hit('Escape')) this.overlay ? this.closeOverlay() : this.openSettings();
  }

  onEvent(ev) {
    const g = this.game;
    switch (ev.type) {
      case 'fire': {
        const w = WEAPON[ev.id];
        Sfx.play(w.kind === 'move' ? 'magic' : w.kind === 'melee' ? 'hit' : w.kind === 'drop' ? 'click' : 'shoot');
        break;
      }
      case 'boom': Sfx.play(ev.r > 55 ? 'bigboom' : 'boom'); break;
      case 'splash': Sfx.play('splash'); break;
      case 'jump': Sfx.play('jump'); break;
      case 'die': Sfx.play('die', 0.2); break;
      case 'gun': Sfx.play('shoot'); break;
      case 'punch': Sfx.play('hit'); break;
      case 'teleport': Sfx.play('magic'); break;
      case 'turn': {
        const tm = g.teams[ev.team];
        if (tm) this.msg(`轮到${tm.def.name}`, ev.b ? `${ev.b.name} 行动` : '', 1.6);
        break;
      }
      case 'deny': toast(ev.text); break;
      case 'over': Sfx.play(ev.winner === 0 ? 'win' : 'lose'); break;
    }
  }
  big(text, dur) { this.bigEl.textContent = text; this.bigEl.className = 'abig'; void this.bigEl.offsetWidth; this.bigEl.className = 'abig show'; this.bigT = dur; }
  msg(a, b, dur = 2) { this.msgEl.innerHTML = `<b>${a}</b>${b ? `<span>${b}</span>` : ''}`; this.msgEl.className = 'amsg show'; this.msgT = dur; }

  update(dt) {
    const g = this.game;
    if (this.bigT > 0 && (this.bigT -= dt) <= 0) this.bigEl.className = 'abig';
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.msgEl.className = 'amsg';
    if (g.over && !this.overlay && (this.endT += dt) > 2.2) this.openEnd();
    if (g.turn.bean !== this._lastBean) { this._lastBean = g.turn.bean; this.aim = null; this.view.aim = null; this.target = null; this.view.target = null; }
    if ((this._slowT = (this._slowT || 0) - dt) > 0) return;
    this._slowT = 0.08;
    const c = this.c;
    const set = (key, val, fn) => { if (c[key] !== val) { c[key] = val; fn(val); } };
    const t = g.turn;
    set('turn', t.bean ? `${g.teams[t.team]?.def.name || ''} · ${t.bean.name}` : '准备…', (v) => { this.turnEl.textContent = v; });
    set('time', t.bean ? Math.max(0, Math.ceil(t.t)) : 0, (v) => { this.timeEl.textContent = String(v); this.timeEl.classList.toggle('low', v <= 5 && v > 0); });
    set('wind', Math.round(g.wind * 10) / 10, (v) => { this.windEl.textContent = v === 0 ? '无风' : `风 ${v > 0 ? '→' : '←'} ${Math.abs(v * 10).toFixed(0)}`; });
    set('god', g.god, (v) => { this.cheatEl.textContent = v ? '无敌 开' : '无敌 关'; this.cheatEl.classList.toggle('on', v); });
    set('myturn', g.myTurn, (v) => { this.skipEl.disabled = !v; this.bFire.setEnabled(v); this.bWeapon.setEnabled(v); });
    set('weapon', t.weapon + '|' + (g.teams[t.team]?.ammo[t.weapon] ?? ''), (v) => {
      const w = WEAPON[t.weapon], ammo = g.teams[t.team]?.ammo[t.weapon];
      this.bWeapon.setIcon(`<span class="emoji">${w.icon}</span>`);
      this.bWeapon.setLabel(w.name);
      this.bWeapon.setBadge(ammo === Infinity ? '∞' : ammo > 0 ? '×' + ammo : '');
      this.bWeapon.setEnabled(ammo > 0);
    });
    g.teams.forEach((tm, i) => {
      const total = tm.beans.length * RULES.hp, hp = g.teamHp(i);
      const key = `hp${i}`;
      if (c[key] !== hp) { c[key] = hp; this.teamRows[i].fill.style.width = (total ? (hp / total) * 100 : 0) + '%'; this.teamRows[i].hp.textContent = hp; }
      this.teamRows[i].fill.parentElement.parentElement.classList.toggle('out', hp <= 0);
    });
  }

  closeOverlay() { if (this.overlay) { this.overlay.remove(); this.overlay = null; this.api.pause(false); } }
  openOverlay(cls, pause) {
    this.closeOverlay();
    this.overlay = el('div', { cls: 'g-overlay ' + cls }, this.root);
    if (pause) this.api.pause(true);
    return el('div', { cls: 'g-panel abox' }, this.overlay);
  }

  /** 武器面板：八种武器、弹药数，点一个就换上 */
  openWeapons() {
    const g = this.game, box = this.openOverlay('aweap', true);
    el('div', { cls: 'ahead', html: '<h2>选武器</h2>' }, box);
    const list = el('div', { cls: 'aweap-list g-scroll' }, box);
    const cur = g.turn.weapon, ammo = g.teams[g.turn.team]?.ammo || {};
    for (const w of WEAPONS) {
      const n = ammo[w.id];
      const row = el('button', { cls: 'aweap-row' + (w.id === cur ? ' on' : '') + (n <= 0 ? ' off' : ''), on: { click: () => { if (g.selectWeapon(w.id)) { Sfx.play('click'); this.closeOverlay(); } else toast('没弹药了'); } } }, list);
      el('span', { cls: 'emoji', text: w.icon }, row);
      el('b', { text: w.name }, row);
      el('span', { text: w.desc }, row);
      el('em', { text: n === Infinity ? '∞' : '×' + n }, row);
    }
    el('div', { cls: 'set-tip', text: '霰弹枪一回合能开两枪；空袭和传送要先点地图选位置。数字键 1~8 也可以直接换武器。' }, box);
    el('button', { cls: 'g-b', text: '关闭', on: { click: () => this.closeOverlay() } }, box);
  }

  openSettings() {
    const box = this.openOverlay('aset', true), v = this.view;
    el('div', { cls: 'ahead', html: '<h2>设置</h2>' }, box);
    const row = (label) => { const r = el('div', { cls: 'set-row' }, box); el('span', { text: label }, r); return el('div', { cls: 'seg' }, r); };
    const q = row('画质'), names = ['自动', ...QUALITY2D.map((x) => x.name)];
    const mark = () => [...q.children].forEach((b, i) => b.classList.toggle('on', i === 0 ? v.auto : !v.auto && v.level === i - 1));
    names.forEach((n, i) => el('button', { text: n, on: { click: () => { if (i === 0) v.setQuality(v.level, true); else v.setQuality(i - 1, false); mark(); } } }, q));
    mark();
    const s = row('声音'), smark = () => [...s.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === !Sfx.muted));
    ['开', '关'].forEach((n, i) => el('button', { text: n, on: { click: () => { Sfx.setMuted(i === 1); Sfx.unlock(); smark(); } } }, s));
    smark();
    const f = el('div', { cls: 'set-btns' }, box);
    el('button', { cls: 'g-b', text: '继续', on: { click: () => this.closeOverlay() } }, f);
    el('button', { cls: 'g-b ghost', text: '重新开始', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '回大厅', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '全屏', on: { click: () => toggleFullscreen() } }, f);
    el('div', { cls: 'set-tip', text: '电脑键位：A/D 或方向键走，W 或空格跳，S 或 F 后翻，数字键 1~8 选武器，Enter 跳过回合。手机：拖动右下“开火”键瞄准，松手发射。' }, box);
  }

  /** 结算：谁赢了、各队剩几个豆兵、多少血 */
  openEnd() {
    const g = this.game, box = this.openOverlay('aend', false);
    const win = g.over.winner;
    const head = el('div', { cls: 'ahead' }, box);
    el('h2', { cls: win === 0 ? 'win' : '', text: win >= 0 ? `${g.teams[win].def.name}获胜！` : '同归于尽！' }, head);
    const acts = el('div', { cls: 'aacts' }, head);
    el('button', { cls: 'g-b gold', text: '再来一局', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, acts);
    el('button', { cls: 'g-b ghost', text: '回大厅', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, acts);
    const list = el('div', { cls: 'aend-list g-scroll' }, box);
    const order = g.teams.map((tm, i) => ({ tm, i, alive: tm.beans.filter((b) => b.alive).length, hp: g.teamHp(i) }))
      .sort((a, b) => b.alive - a.alive || b.hp - a.hp);
    order.forEach((o, rank) => el('div', { cls: 'aend-row' + (o.i === 0 ? ' me' : ''), html: `<i>${rank + 1}</i><b style="color:${o.tm.def.color}">●</b><span>${o.tm.def.name}</span><em>剩 ${o.alive} 个豆兵 · ${o.hp} 血</em>` }, list));
  }

  dispose() { this.root.innerHTML = ''; }
}
