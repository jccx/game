// 设置面板共用的两行：画质分段按钮、声音开关。
// 五款游戏的 openSettings() 里原来各写了一份几乎逐字相同的代码，现在统一调这里；
// 各游戏只留自己的标题、底部按钮和提示文字。
// q 是画质控制器（Stage，或豆兵大战的 View）：{ auto, level, setQuality(level, auto) }。
// names 是 ['自动', ...档位名]，由各游戏从 QUALITY / QUALITY2D 现取。
import { el } from './ui.js';
import { Sfx } from './audio.js';

/** 画质行：自动 / 流畅 / 均衡 / 高清 */
export function qualityRow(box, q, names) {
  const r = el('div', { cls: 'set-row' }, box);
  el('span', { text: '画质' }, r);
  const seg = el('div', { cls: 'seg' }, r);
  const mark = () => [...seg.children].forEach((b, i) => b.classList.toggle('on', i === 0 ? q.auto : !q.auto && q.level === i - 1));
  names.forEach((n, i) => el('button', { text: n, on: { click: () => { if (i === 0) q.setQuality(q.level, true); else q.setQuality(i - 1, false); mark(); } } }, seg));
  mark();
  return seg;
}

/** 声音行：开 / 关 */
export function soundRow(box) {
  const r = el('div', { cls: 'set-row' }, box);
  el('span', { text: '声音' }, r);
  const seg = el('div', { cls: 'seg' }, r);
  const mark = () => [...seg.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === !Sfx.muted));
  ['开', '关'].forEach((n, i) => el('button', { text: n, on: { click: () => { Sfx.setMuted(i === 1); Sfx.unlock(); mark(); } } }, seg));
  mark();
  return seg;
}
