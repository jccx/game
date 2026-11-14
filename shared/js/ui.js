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

let toastEl = null, toastTimer = 0;
/** 屏幕中上方的提示条 */
export function toast(msg, ms = 1800) {
  if (!toastEl) toastEl = el('div', { cls: 'g-toast' }, document.body);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/** 游戏页面通用：禁止双击缩放、长按菜单、文字选中、橡皮筋滚动 */
export function guardPage() {
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
