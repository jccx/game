// 疾风卡丁：界面和输入——开局菜单、比赛中的仪表和按键、结算。
// 手机：左下摇杆左右转向（自动给油）；右下“漂移”（按住）、“氮气”、“道具”、“刹车”。
// 电脑：A/D 或方向键转向，Shift 或 空格 漂移，J 氮气，K 道具，S 或 ↓ 刹车，Esc 设置。
import { el, toast, store, toggleFullscreen, makeMemo, makeCheatButton } from '../../shared/js/ui.js';
import { Joystick, ActionButton } from '../../shared/js/input.js';
import { Sfx } from '../../shared/js/audio.js';
import { qualityRow, soundRow } from '../../shared/js/settings.js';
import { QUALITY } from '../../shared/js/stage.js';
import { KART, ITEMS, DIFFICULTY, RACERS } from './config.js';
import { TRACKS, buildTrack } from './tracks.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  drift: svg('<path d="M4 18c2-8 8-12 16-12M20 6l-4-3M20 6l-3 4M4 21h6M13 21h7"/>'),
  nitro: svg('<path d="M12 2c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9zM9 20h6"/>'),
  brake: svg('<path d="M12 4v15M5 12l7 7 7-7"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
};
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };

/** 把赛道画成一条线（菜单里的缩略图和比赛中的小地图共用） */
function drawOutline(c, T, size, width, color) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const s of T.s) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  const k = (size - 16) / Math.max(x1 - x0, z1 - z0), ox = (size - (x1 - x0) * k) / 2 - x0 * k, oz = (size - (z1 - z0) * k) / 2 - z0 * k;
  c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath();
  T.s.forEach((s, i) => (i ? c.lineTo(s.x * k + ox, s.z * k + oz) : c.moveTo(s.x * k + ox, s.z * k + oz)));
  c.closePath(); c.lineWidth = width; c.strokeStyle = color; c.stroke();
  return { k, ox, oz };
}

/** 开局菜单：选赛道、选难度。“开始比赛”放在最上面 */
export function showMenu(root, onStart) {
  const sel = store.get('kart-pick', { track: 'forest', difficulty: 1 }), best = store.get('kart-best', {});
  if (!TRACKS.some((t) => t.id === sel.track)) sel.track = TRACKS[0].id;
  const wrap = el('div', { cls: 'g-overlay kmenu' }, root), box = el('div', { cls: 'g-panel kbox' }, wrap);
  const head = el('div', { cls: 'khead' }, box);
  el('h1', { text: '疾风卡丁' }, head);
  const acts = el('div', { cls: 'kacts' }, head);
  el('a', { cls: 'g-b ghost sm', text: '返回大厅', attrs: { href: '../' } }, acts);
  el('button', { cls: 'g-b gold start', text: '开始比赛', on: { click: () => { Sfx.unlock(); Sfx.play('go'); store.set('kart-pick', sel); onStart({ track: TRACKS.find((t) => t.id === sel.track), difficulty: sel.difficulty }); } } }, acts);
  const body = el('div', { cls: 'kbody g-scroll' }, box);
  el('h3', { text: '赛道' }, body);
  const tr = el('div', { cls: 'ktracks' }, body);
  const cards = TRACKS.map((t) => {
    const card = el('button', { cls: 'ktrack', on: { click: () => { sel.track = t.id; refresh(); Sfx.unlock(); Sfx.play('click'); } } }, tr);
    const cv = el('canvas', {}, card); cv.width = cv.height = 160;
    const c = cv.getContext('2d'), T = buildTrack(t);
    drawOutline(c, T, 160, 12, 'rgba(0,0,0,.45)'); drawOutline(c, T, 160, 7, { forest: '#7fd66a', desert: '#f0b85a', ice: '#9fd8ff' }[t.theme]);
    el('b', { text: t.name }, card); el('span', { text: t.desc }, card);
    el('i', { text: `${Math.round(T.length)} 米 · 三圈` + (best[t.id] ? ` · 最快单圈 ${fmt(best[t.id])}` : '') }, card);
    return card;
  });
  el('h3', { text: '电脑难度' }, body);
  const seg = el('div', { cls: 'seg' }, body);
  const dbtn = DIFFICULTY.map((d, i) => el('button', { text: d.name, on: { click: () => { sel.difficulty = i; refresh(); Sfx.play('click'); } } }, seg));
  el('p', { cls: 'ktip', text: '玩法：自动给油，左下摇杆左右转向。过弯时按住“漂移”并打方向，车尾冒出蓝、橙、紫色火花后松开，就能获得一段加速；漂移还会攒氮气槽，攒满得一瓶氮气。吃到彩色问号箱会得到道具。' }, body);
  function refresh() { cards.forEach((c, i) => c.classList.toggle('on', TRACKS[i].id === sel.track)); dbtn.forEach((b, i) => b.classList.toggle('on', i === sel.difficulty)); }
  refresh();
  return { close() { wrap.remove(); } };
}

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('./race.js').Race} race
   * @param {{stage:object, keys:object, pause:(b:boolean)=>void, restart:()=>void, exit:()=>void}} api
   */
  constructor(root, race, api) {
    this.root = root; this.race = race; this.api = api; this.keys = api.keys;
    this.c = {}; this.slowT = 0; this.msgT = 0; this.endT = 0; this.engine = null; this.locked = false;
    root.innerHTML = '';
    const r = root, P = race.player;
    // 左上：名次、圈数、时间
    const st = el('div', { cls: 'kstat' }, r);
    this.placeEl = el('div', { cls: 'kplace', html: '<b>8</b><i>/8</i>' }, st);
    this.lapEl = el('div', { cls: 'klap' }, st); this.timeEl = el('div', { cls: 'ktime', text: '0:00.00' }, st);
    // 右上：无敌开关、设置；下面是小地图
    const right = el('div', { cls: 'kright' }, r), row = el('div', { cls: 'krow' }, right);
    this.cheat = makeCheatButton(row, {
      get: () => P.god,
      onToggle: () => { P.god = !P.god; Sfx.play(P.god ? 'levelup' : 'click'); toast(P.god ? '无敌已打开：不怕道具，蹭墙不掉速' : '无敌已关闭'); },
    });
    this.cheatEl = this.cheat.el;
    el('div', { cls: 'g-ic', html: IC.gear, on: { pointerdown: (e) => { e.preventDefault(); this.openSettings(); } } }, row);
    this.mini = el('canvas', { cls: 'kmini' }, right); this.mini.width = this.mini.height = 180; this.mctx = this.mini.getContext('2d');
    // 中间：倒计时、提示
    this.bigEl = el('div', { cls: 'kbig' }, r); this.msgEl = el('div', { cls: 'kmsg' }, r);
    // 下方中间：速度和氮气槽
    const sp = el('div', { cls: 'kspeed' }, r);
    this.speedEl = el('b', { text: '0' }, sp); el('span', { text: 'km/h' }, sp);
    this.gaugeEl = el('i', {}, el('div', { cls: 'kgauge' }, sp));
    // 左下：摇杆
    this.joy = new Joystick(el('div', { cls: 'g-joy-zone' }, r), { radius: 54 });
    // 右下：漂移、氮气、道具、刹车
    const pad = el('div', { cls: 'kpad' }, r);
    this.bDrift = new ActionButton(pad, { cls: 'k-drift', icon: IC.drift, label: '漂移', onDown: () => Sfx.unlock() });
    this.bNitro = new ActionButton(pad, { cls: 'k-nitro', icon: IC.nitro, label: '氮气', onDown: () => { Sfx.unlock(); this.pBoost = true; } });
    this.bItem = new ActionButton(pad, { cls: 'k-item', label: '道具', onDown: () => { this.pUse = true; } });
    this.bBrake = new ActionButton(pad, { cls: 'k-brake', icon: IC.brake, label: '刹车' });
  }

  /** 每个逻辑帧调用：把摇杆、按钮、键盘写进玩家的操作意图 */
  readInput() {
    const P = this.race.player, inn = P.in, k = this.keys;
    if (P.ai || this.locked) return;
    let s = this.joy.active ? this.joy.x * 1.3 : 0;
    const ka = k.axis(); if (ka.active && ka.x) s = ka.x;
    inn.steer = Math.max(-1, Math.min(1, Math.abs(s) < 0.12 ? 0 : s));
    inn.brake = this.bBrake.pressed || k.isDown('KeyS', 'ArrowDown');
    inn.gas = !inn.brake;                                  // 自动给油
    inn.drift = this.bDrift.pressed || k.isDown('ShiftLeft', 'ShiftRight', 'Space');
    inn.boost = !!this.pBoost || k.hit('KeyJ'); this.pBoost = false;
    inn.use = !!this.pUse || k.hit('KeyK'); this.pUse = false;
    if (k.hit('Escape')) this.overlay ? this.closeOverlay() : this.openSettings();
  }

  onEvent(ev) {
    const P = this.race.player, mine = ev.k === P;
    switch (ev.type) {
      case 'count': this.big(ev.n > 0 ? String(ev.n) : '出发！', ev.n > 0 ? 0.9 : 1.2); Sfx.play(ev.n > 0 ? 'beep' : 'go'); break;
      case 'lap': if (mine && ev.n <= this.race.laps) { this.msg(ev.n === this.race.laps ? '最后一圈！' : `第 ${ev.n} 圈`, `上一圈 ${fmt(ev.time)}`); Sfx.play('levelup'); } break;
      case 'item': if (mine) this.msg(`得到${ITEMS[ev.id].name}`, ITEMS[ev.id].desc, 1.8); break;
      case 'spin': if (mine) this.msg('中招了！', ev.by && ev.by !== P ? `来自 ${ev.by.driver.name}` : '', 1.3); else if (ev.by === P) this.msg(`击中 ${ev.k.driver.name}`, '', 1.3); break;
      case 'block': if (mine) this.msg('挡住了', '', 1); break;
      case 'boost': if (mine && ev.tier) this.msg(['', '小加速', '加速！', '超级加速！'][ev.tier], '', 0.8); break;
      case 'nitro': if (mine) this.msg('氮气 +1', '', 1); break;
      case 'finish': if (mine) { this.big(`第 ${ev.place} 名`, 3); Sfx.play(ev.place <= 3 ? 'win' : 'lose'); } break;
    }
  }
  big(text, dur) { this.bigEl.textContent = text; this.bigEl.className = 'kbig'; void this.bigEl.offsetWidth; this.bigEl.className = 'kbig show'; this.bigT = dur; }
  msg(a, b, dur = 2) { this.msgEl.innerHTML = `<b>${a}</b>${b ? `<span>${b}</span>` : ''}`; this.msgEl.className = 'kmsg show'; this.msgT = dur; }

  update(dt) {
    const race = this.race, P = race.player, c = this.c;
    if (this.bigT > 0 && (this.bigT -= dt) <= 0) this.bigEl.className = 'kbig';
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.msgEl.className = 'kmsg';
    if (!this.engine && race.state !== 'count') this.engine = Sfx.engine();
    if (this.engine) this.engine.set(Math.min(1.2, Math.abs(P.v) / KART.max + (P.boostT > 0 ? 0.25 : 0)), race.state === 'done' ? 0.02 : 0.05);
    if (race.state === 'done' && !this.overlay && (this.endT += dt) > 2.6) this.openEnd();     // 冲线后稍等一下再弹结算
    if ((this.slowT -= dt) > 0) return;
    this.slowT = 0.08;
    const set = makeMemo(c);
    set('place', P.place, (v) => { this.placeEl.firstChild.textContent = v; });
    set('lap', Math.min(race.laps, Math.max(1, P.lap)), (v) => { this.lapEl.textContent = `第 ${v}/${race.laps} 圈`; });
    this.timeEl.textContent = fmt(P.finished ? P.finishTime : race.time);
    set('speed', Math.round(Math.abs(P.v) * 5.5), (v) => { this.speedEl.textContent = v; });
    set('gauge', Math.round(P.gauge * 50), (v) => { this.gaugeEl.style.width = v * 2 + '%'; });
    set('nitro', P.nitro, (v) => { this.bNitro.setBadge(v ? '×' + v : ''); this.bNitro.setEnabled(v > 0); });
    set('item', P.item || '', (v) => { this.bItem.setIcon(v ? `<span class="emoji">${ITEMS[v].icon}</span>` : ''); this.bItem.setEnabled(!!v); this.bItem.setLabel(v ? ITEMS[v].name : '道具'); });
    set('god', P.god, (v) => this.cheat.sync(v));
    set('wrong', P.wrong > 0.8, (v) => { if (v) this.msg('方向反了！', '调头', 1.5); });
    this.drawMini();
  }

  /** 小地图：赛道轮廓和每辆车的位置 */
  drawMini() {
    const x = this.mctx, T = this.race.track, S = 180;
    x.clearRect(0, 0, S, S);
    drawOutline(x, T, S, 9, 'rgba(0,0,0,.55)');
    const m = drawOutline(x, T, S, 5, 'rgba(255,255,255,.85)');
    for (const k of this.race.karts.slice().reverse()) {
      x.beginPath(); x.arc(k.x * m.k + m.ox, k.z * m.k + m.oz, k.isPlayer ? 6.5 : 4.5, 0, 6.283);
      x.fillStyle = '#' + k.driver.color.toString(16).padStart(6, '0'); x.fill(); x.lineWidth = k.isPlayer ? 2.5 : 1; x.strokeStyle = k.isPlayer ? '#fff' : '#000'; x.stroke();
    }
  }

  closeOverlay() { if (this.overlay) { this.overlay.remove(); this.overlay = null; this.api.pause(false); } }
  openOverlay(cls, pause) {
    this.closeOverlay();
    this.overlay = el('div', { cls: 'g-overlay ' + cls }, this.root);
    if (pause) this.api.pause(true);
    return el('div', { cls: 'g-panel kbox' }, this.overlay);
  }

  openSettings() {
    const box = this.openOverlay('kset', true), st = this.api.stage;
    el('div', { cls: 'khead', html: '<h2>设置</h2>' }, box);
    qualityRow(box, st, ['自动', ...QUALITY.map((x) => x.name)]);
    soundRow(box);
    const f = el('div', { cls: 'set-btns' }, box);
    el('button', { cls: 'g-b', text: '继续比赛', on: { click: () => this.closeOverlay() } }, f);
    el('button', { cls: 'g-b ghost', text: '重新开始', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '换赛道', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, f);
    el('button', { cls: 'g-b ghost', text: '全屏', on: { click: () => toggleFullscreen() } }, f);
    el('div', { cls: 'set-tip', text: '电脑键位：A/D 或方向键转向，Shift 或空格漂移，J 氮气，K 道具，S 刹车。' }, box);
  }

  /** 结算：名次表、最快单圈（破纪录会保存） */
  openEnd() {
    const race = this.race, P = race.player, box = this.openOverlay('kend', false);
    const place = race.results.indexOf(P) + 1;
    const best = store.get('kart-best', {}), id = race.track.def.id, rec = P.best && (!best[id] || P.best < best[id]);
    if (rec) { best[id] = P.best; store.set('kart-best', best); }
    const head = el('div', { cls: 'khead' }, box);
    el('h2', { cls: place <= 3 ? 'win' : '', text: `第 ${place} 名` }, head);
    const acts = el('div', { cls: 'kacts' }, head);
    el('button', { cls: 'g-b gold', text: '再来一局', on: { click: () => { this.closeOverlay(); this.api.restart(); } } }, acts);
    el('button', { cls: 'g-b ghost', text: '换赛道', on: { click: () => { this.closeOverlay(); this.api.exit(); } } }, acts);
    el('div', { cls: 'kend-sub', text: `${race.track.def.name}　用时 ${fmt(P.finishTime)}　最快单圈 ${fmt(P.best)}${rec ? '（新纪录！）' : ''}` }, box);
    const list = el('div', { cls: 'kend-list g-scroll' }, box);
    race.results.forEach((k, i) => el('div', { cls: 'kend-row' + (k === P ? ' me' : ''), html: `<i>${i + 1}</i><b style="color:#${k.driver.color.toString(16).padStart(6, '0')}">●</b><span>${k.driver.name}</span><em>${fmt(k.finished ? k.finishTime : k.estTime)}</em>` }, list));
  }

  dispose() { if (this.engine) this.engine.stop(); this.root.innerHTML = ''; }
}
