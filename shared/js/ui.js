// 页面相关的小工具：创建元素、本机存储、提示条、防误触。

/** 选择器简写 */
export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * 创建元素。props 支持：cls（类名）、text、html、style（对象）、on（事件表）、attrs（属性表）
 */
export function el(tag, props = {}, parent = null) {
  const e = document.createElement(tag);
  if (props.cls) e.className = props.cls;
  if (props.text !== undefined) e.textContent = props.text;
  if (props.html !== undefined) e.innerHTML = props.html;
  if (props.style) Object.assign(e.style, props.style);
  if (props.attrs) for (const k in props.attrs) e.setAttribute(k, props.attrs[k]);
  if (props.on) for (const k in props.on) e.addEventListener(k, props.on[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/** 本机存储（localStorage）。读写都包了 try/catch：隐私模式等环境下会抛错，此时退回内存 */
const mem = {};
const PREFIX = 'jccx-game:';
export const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? (key in mem ? mem[key] : def) : JSON.parse(v);
    } catch { return key in mem ? mem[key] : def; }
  },
  set(key, val) {
    mem[key] = val;
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch { /* 存不了就只留在内存 */ }
  },
};

/** 是否触屏设备 */
export const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/**
 * 只在值变化时才改 DOM 的记忆函数。各游戏 hud.js 的 refresh()/slow() 原来各写了一份
 * `const set = (key, val, fn) => { if (c[key] !== val) { c[key] = val; fn(val); } }`，
 * 现在统一调这里。用法：`const set = makeMemo(this.c); set('gold', v, (x) => { el.textContent = x; });`
 */
export function makeMemo(cache) {
  return (key, val, fn) => { if (cache[key] !== val) { cache[key] = val; fn(val); } };
}

/**
 * 无敌开关按钮（各游戏共用 `.cheat` 样式）。五款游戏原来各写了一份创建代码和刷新代码。
 * @param {HTMLElement} parent 放按钮的父元素
 * @param {object} o
 * @param {string} [o.label='无敌'] 按钮文字前缀（梦想乐园是“免费建造”）
 * @param {()=>boolean} o.get 当前是否打开
 * @param {()=>void} o.onToggle 点一下时做的事（改状态、放音效、提示条，各游戏自己写）
 * @returns {{el: HTMLElement, sync: (v?: boolean)=>void}} sync 按状态刷新文字和 .on 样式，
 *   各游戏在 refresh()/slow() 里调它；不传参数时按 get() 的当前值刷新
 */
export function makeCheatButton(parent, o) {
  const label = o.label || '无敌';
  const btn = el('div', {
    cls: 'cheat', text: label + ' 关',
    on: { pointerdown: (e) => { e.preventDefault(); e.stopPropagation(); o.onToggle(); sync(); } },
  }, parent);
  const sync = (v = o.get()) => {
    btn.textContent = v ? label + ' 开' : label + ' 关';
    btn.classList.toggle('on', v);
  };
  return { el: btn, sync };
}

let toastEl = null, toastTimer = 0;
/** 屏幕中上方的提示条 */
export function toast(msg, ms = 1800) {
  if (!toastEl) toastEl = el('div', { cls: 'g-toast' }, document.body);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/**
 * 把页面高度钉在“实际可见区域”的高度上，写进 CSS 变量 --app-h。
 * 有些手机浏览器的工具栏会盖住屏幕底部，按 100vh 排版时最下面一截看不到。
 */
export function fitViewport() {
  const set = () => {
    const vv = window.visualViewport;
    const h = vv ? Math.min(window.innerHeight, vv.height) : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  };
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', () => setTimeout(set, 150));
  window.visualViewport?.addEventListener('resize', set);
}

/** 游戏页面通用：禁止双击缩放、长按菜单、文字选中、橡皮筋滚动；并让页面高度跟随可见区域 */
export function guardPage() {
  fitViewport();
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !e.target.closest('.g-scroll')) e.preventDefault(); }, { passive: false });
}

/** 进入/退出全屏（iPhone 的 Safari 不支持，调用会静默失败） */
export function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
  } catch { /* 忽略 */ }
}

/** 读取地址栏参数，如 ?mode=1v1 */
export function query(name, def = null) {
  const v = new URLSearchParams(location.search).get(name);
  return v === null ? def : v;
}

/** 当前是否竖屏 */
export const isPortrait = () => window.innerHeight > window.innerWidth;
