// 裂谷争锋：开局前的菜单——选模式、选英雄、选难度。
import { el, store } from '../../shared/js/ui.js';
import { Sfx } from '../../shared/js/audio.js';
import { MODES } from './maps.js';
import { HEROES, HERO_BY_ID } from './heroes/index.js';
import { DIFFICULTY } from './config.js';
import { ICONS } from './hud.js';

/**
 * 显示菜单。
 * @param {HTMLElement} root
 * @param {Object<string,string>} portraits 英雄 id → 头像图片
 * @param {(opts:{mode:string, hero:string, difficulty:number})=>void} onStart
 * @returns {{close:()=>void}}
 */
export function showMenu(root, portraits, onStart) {
  const sel = store.get('moba-pick', { mode: '5v5', hero: 'liefeng', difficulty: 1 });
  if (!HERO_BY_ID[sel.hero]) sel.hero = 'liefeng';
  const wrap = el('div', { cls: 'g-overlay menu' }, root);
  const box = el('div', { cls: 'g-panel menu-box' }, wrap);
  // 标题和“开始对战”放在最上面：手机浏览器的底部经常被工具栏挡住，按钮放底部容易看不到
  const head = el('div', { cls: 'menu-head' }, box);
  el('h1', { text: '裂谷争锋' }, head);
  const acts = el('div', { cls: 'menu-acts' }, head);
  el('a', { cls: 'g-b ghost sm', text: '返回大厅', attrs: { href: '../' } }, acts);
  el('button', { cls: 'g-b gold start', text: '开始对战', on: { click: () => { Sfx.unlock(); Sfx.play('go'); store.set('moba-pick', sel); onStart({ ...sel }); } } }, acts);
  const body = el('div', { cls: 'menu-body g-scroll' }, box);

  // 左栏：模式和难度
  const colA = el('div', { cls: 'menu-col' }, body);
  el('h3', { text: '模式' }, colA);
  const modes = el('div', { cls: 'modes' }, colA);
  const modeCards = MODES.map((m) => el('button', { cls: 'mode', html: `<b>${m.name}</b><span>${m.desc}</span><i>${m.time}</i>`, on: { click: () => { sel.mode = m.id; refresh(); Sfx.unlock(); Sfx.play('click'); } } }, modes));
  el('h3', { text: '电脑难度' }, colA);
  const diff = el('div', { cls: 'seg' }, colA);
  const diffBtns = DIFFICULTY.map((d, i) => el('button', { text: d.name, on: { click: () => { sel.difficulty = i; refresh(); Sfx.play('click'); } } }, diff));

  // 右栏：英雄
  const colB = el('div', { cls: 'menu-col' }, body);
  el('h3', { text: '英雄' }, colB);
  const heroes = el('div', { cls: 'heroes' }, colB);
  const heroCards = HEROES.map((h) => el('button', { cls: 'hero', html: `<img alt="" src="${portraits[h.id] || ''}"><b>${h.name}</b><span>${h.roleName}</span>`, on: { click: () => { sel.hero = h.id; refresh(); Sfx.unlock(); Sfx.play('click'); } } }, heroes));
  const info = el('div', { cls: 'hero-info' }, colB);

  function refresh() {
    modeCards.forEach((c, i) => c.classList.toggle('on', MODES[i].id === sel.mode));
    diffBtns.forEach((c, i) => c.classList.toggle('on', i === sel.difficulty));
    heroCards.forEach((c, i) => c.classList.toggle('on', HEROES[i].id === sel.hero));
    const h = HERO_BY_ID[sel.hero];
    info.innerHTML = `<div class="hi-title"><b>${h.name}</b> · ${h.title}<em>上手难度 ${'★'.repeat(h.ease)}${'☆'.repeat(3 - h.ease)}</em></div><p>${h.desc}</p>` +
      `<div class="hi-skill"><i class="pas">被动</i><div><b>${h.passive.name}</b><span>${h.passive.desc}</span></div></div>` +
      h.skills.map((s) => `<div class="hi-skill"><i>${ICONS[s.icon] || ''}</i><div><b>${s.name}</b><span>${s.desc}</span></div></div>`).join('');
  }
  refresh();
  return { close() { wrap.remove(); } };
}
