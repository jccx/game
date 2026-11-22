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
 * 下线通知 15 秒窗口：同一个名字 15 秒内只报一次，过期后可再报（2026-11-22 用户定：
 * 下线通知只在断开连接的 15 秒内显示，之后自动消失，不一直挂着“xxx离开了”）。
 * seen 存名字 -> 上次报的时间（毫秒墙钟）；调用时顺手清掉过期的名字，免得越攒越多。
 * 网络抖动时同一个人反复掉线/重连，只报第一次，不刷屏；击杀播报不受影响。
 */
export function leaveNoticeDue(seen, name, now = Date.now()) {
  for (const [n, t] of seen) if (now - t >= 15000) seen.delete(n);
  if (seen.has(name)) return false;
  seen.set(name, now);
  return true;
}

/**
 * 把页面高度钉在“实际可见区域”的高度上，写进 CSS 变量 --app-h。
 * 用布局视口高度（window.innerHeight），不要用 visualViewport.height：
 * 手机浏览器显示地址栏/工具栏时 visualViewport 会变矮（还可能带 offsetTop），
 * 按它排版会把游戏区缩短，屏幕上下露出机身底色黑边（2026-11-22 竖屏黑边问题）。
 * 布局视口就是整块屏幕：工具栏出现时它只会短暂盖住底部，手指一碰就自动收起，
 * 而 HUD 的上下控件本来就按安全区（--st/--sb）留了边距。
 * 虚拟键盘是例外：键盘会盖住布局视口，那种情况由 attachKeyboardFit
 *（html.kbd 规则 + --vv-h）单独处理，和这里不冲突。
 */
export function fitViewport() {
  const set = () => {
    document.documentElement.style.setProperty('--app-h', Math.round(window.innerHeight) + 'px');
  };
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', () => setTimeout(set, 150));
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

/**
 * 虚拟键盘弹起时算可视区域（纯函数，测试用）：vv 是 visualViewport（或同形状的假对象），
 * innerHeight 是布局视口高度。返回 {top, height, kbdH}：可视区域相对布局视口的顶边、
 * 高度、键盘占掉的高度（没有键盘时 kbdH 是 0）。
 */
export function keyboardViewport(vv, innerHeight) {
  if (!vv) return { top: 0, height: innerHeight, kbdH: 0 };
  const height = Math.max(0, Math.round(Math.min(innerHeight, vv.height)));
  return { top: Math.max(0, Math.round(vv.offsetTop || 0)), height, kbdH: Math.max(0, Math.round(innerHeight - vv.height)) };
}

/**
 * 键盘让位：输入框聚焦、虚拟键盘弹起时，把游戏画面缩到键盘上方的可视区域，
 * 让输入框和它旁边的按钮不被键盘盖住；失焦或面板关掉就恢复。
 * 做法：聚焦时给 <html> 加 kbd class，并把可视区域写进 --vv-top / --vv-h（见 base.css 的 html.kbd 规则）；
 * 键盘开合、屏幕滚动都会触发 visualViewport 的 resize/scroll，跟着刷新。失焦时清掉。
 * 没有 visualViewport 的环境（桌面浏览器）不做任何事。
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @returns {()=>void} 拆掉监听的函数（面板关闭时调；输入框本身被一起删掉时 blur 也会清掉 class，再调一次也无害）
 */
export function attachKeyboardFit(input) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv || !input) return () => {};
  const apply = () => {
    const r = keyboardViewport(vv, window.innerHeight);
    root.style.setProperty('--vv-top', r.top + 'px');
    root.style.setProperty('--vv-h', r.height + 'px');
  };
  const onFocus = () => { root.classList.add('kbd'); apply(); vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); try { input.scrollIntoView({ block: 'nearest' }); } catch { /* 忽略 */ } };
  const onBlur = () => { root.classList.remove('kbd'); root.style.removeProperty('--vv-top'); root.style.removeProperty('--vv-h'); vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); };
  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);
  return () => { input.removeEventListener('focus', onFocus); input.removeEventListener('blur', onBlur); onBlur(); };
}
