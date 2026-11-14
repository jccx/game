// 落日湾：入口。把各模块接起来：读存档 → 新建世界（Sim）→ 画面（View）→ 界面（Hud）→ 主循环。
import { Stage } from '../../shared/js/stage.js';
import { GameLoop } from '../../shared/js/loop.js';
import { Keys } from '../../shared/js/input.js';
import { $, guardPage, query, store } from '../../shared/js/ui.js';
import { Sim } from './sim.js';
import { TICK } from './config.js';
import { View } from './render/view.js';
import { Hud } from './hud.js';

guardPage();
const loading = $('#loading');
const stage = new Stage($('#stage'), { key: 'city-quality' });
const keys = new Keys();
let sim = null, view = null, hud = null, loop = null;

function teardown() {
  if (loop) loop.stop();
  if (hud) hud.dispose();
  if (view) view.dispose();
  sim = view = hud = loop = null;
}

/** 开始（或重新开始）游戏 */
function start() {
  teardown();
  loading.classList.remove('g-hide');
  // 等一帧让“加载中”先显示出来，再生成世界（比较耗时）
  requestAnimationFrame(() => setTimeout(() => {
    sim = new Sim((query('fresh') ? null : store.get('city-save', null)) || {});
    view = new View(stage, sim, $('#world-ui'), (ev) => hud && hud.onEvent(ev));
    hud = new Hud($('#hud'), sim, view, { stage, keys, pause: (b) => { loop.timeScale = b ? 0 : 1; }, restart: start });
    loop = new GameLoop({
      step: 1 / TICK,
      update: (dt) => { hud.readInput(); sim.update(dt); keys.endFrame(); },
      render: (alpha, fdt) => { hud.update(fdt); view.update(alpha, fdt); },
    });
    loop.start();
    loading.classList.add('g-hide');
  }, 30));
}

// 切到后台时存一次档
document.addEventListener('visibilitychange', () => { if (document.hidden && sim) store.set('city-save', sim.save()); });

// 调试/测试入口：控制台里 __city.sim 是游戏状态；地址栏加 ?fresh=1 忽略存档
window.__city = { get sim() { return sim; }, get view() { return view; }, get hud() { return hud; }, get loop() { return loop; }, stage, start };
start();
