// 疾风卡丁：入口。菜单 → 新建比赛（Race）→ 画面（View）→ 界面（Hud）→ 主循环。
import { Stage } from '../../shared/js/stage.js';
import { GameLoop } from '../../shared/js/loop.js';
import { Keys } from '../../shared/js/input.js';
import { $, guardPage, query } from '../../shared/js/ui.js';
import { Race } from './race.js';
import { TICK } from './config.js';
import { TRACKS } from './tracks.js';
import { View } from './render.js';
import { Hud, showMenu } from './hud.js';

guardPage();
const root = $('#root'), loading = $('#loading');
const stage = new Stage($('#stage'), { key: 'kart-quality' });
const keys = new Keys();
let race = null, view = null, hud = null, loop = null, menu = null, last = null;

function teardown() {
  if (loop) loop.stop();
  if (hud) hud.dispose();
  if (view) view.dispose();
  race = view = hud = loop = null;
}
function toMenu() { teardown(); stage.renderer.clear(); menu = showMenu(root, start); }

/** 开始一场比赛。opts：{ track 赛道定义, difficulty, allBots? } */
function start(opts) {
  last = opts;
  if (menu) { menu.close(); menu = null; }
  teardown();
  loading.classList.remove('g-hide');
  requestAnimationFrame(() => setTimeout(() => {
    race = new Race(opts);
    view = new View(stage, race, (ev) => hud && hud.onEvent(ev));
    hud = new Hud($('#hud'), race, { stage, keys, pause: (b) => { loop.timeScale = b ? 0 : 1; }, restart: () => start(last), exit: toMenu });
    loop = new GameLoop({
      step: 1 / TICK, maxSteps: 6,
      update: (dt) => { hud.readInput(); race.update(dt); keys.endFrame(); },
      render: (alpha, fdt) => { view.update(alpha, fdt); hud.update(fdt); },
    });
    loop.start();
    loading.classList.add('g-hide');
  }, 30));
}

// 调试/测试入口：?auto=1&track=forest&bots=1 跳过菜单直接开赛
window.__kart = { get race() { return race; }, get view() { return view; }, get hud() { return hud; }, get loop() { return loop; }, stage, start, toMenu };
if (query('auto')) start({ track: TRACKS.find((t) => t.id === query('track', 'forest')) || TRACKS[0], difficulty: +query('diff', 1), allBots: query('bots') === '1' });
else { loading.classList.add('g-hide'); toMenu(); }
