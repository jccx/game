// 裂谷争锋：入口。负责把各模块接起来：菜单 → 新建对局（Game）→ 画面（View）→ 界面（Hud）→ 主循环。
import { Stage } from '../../shared/js/stage.js';
import { GameLoop } from '../../shared/js/loop.js';
import { Keys } from '../../shared/js/input.js';
import { $, guardPage, query } from '../../shared/js/ui.js';
import { Game } from './game.js';
import { TICK } from './config.js';
import { HEROES } from './heroes/index.js';
import { View } from './render/view.js';
import { renderPortraits } from './render/portrait.js';
import { Hud } from './hud.js';
import { showMenu } from './menu.js';

guardPage();
const root = $('#root'), loading = $('#loading');
const stage = new Stage($('#stage'), { key: 'moba-quality' });
const keys = new Keys();
const portraits = renderPortraits(stage.renderer, HEROES);
let game = null, view = null, hud = null, loop = null, menu = null, last = null;

/** 结束当前对局，释放资源 */
function teardown() {
  if (loop) loop.stop();
  if (hud) hud.dispose();
  if (view) view.dispose();
  game = view = hud = loop = null;
}

/** 回到菜单 */
function toMenu() {
  teardown();
  stage.renderer.clear();
  menu = showMenu(root, portraits, start);
}

/** 开始一局。opts：{ mode, hero, difficulty, allBots? } */
function start(opts) {
  last = opts;
  if (menu) { menu.close(); menu = null; }
  teardown();
  loading.classList.remove('g-hide');
  // 等一帧让“加载中”先显示出来，再做比较耗时的场景生成
  requestAnimationFrame(() => setTimeout(() => {
    game = new Game(opts);
    view = new View(stage, game, $('#world-ui'), (ev) => hud && hud.onEvent(ev));
    hud = new Hud($('#hud'), game, view, {
      stage, keys,
      pause: (b) => { loop.timeScale = b ? 0 : 1; },
      restart: () => start(last),
      exit: toMenu,
    });
    loop = new GameLoop({
      step: 1 / TICK,
      update: (dt) => { hud.readInput(); game.update(dt); keys.endFrame(); },
      render: (alpha, fdt) => { view.update(alpha, fdt); hud.update(fdt); },
    });
    loop.start();
    loading.classList.add('g-hide');
  }, 30));
}

// 调试/测试入口：?auto=1&mode=5v5&hero=liefeng&bots=1 跳过菜单直接开局（bots=1 时玩家英雄也由电脑控制）
window.__moba = { get game() { return game; }, get view() { return view; }, get hud() { return hud; }, get loop() { return loop; }, stage, start, toMenu };
if (query('auto')) start({ mode: query('mode', '5v5'), hero: query('hero', 'liefeng'), difficulty: +query('diff', 1), allBots: query('bots') === '1' });
else { loading.classList.add('g-hide'); toMenu(); }
