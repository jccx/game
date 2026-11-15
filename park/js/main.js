// 梦想乐园：入口。菜单 → 新建乐园（Park）→ 画面（View）→ 界面（Hud）→ 主循环。
import { Stage } from '../../shared/js/stage.js';
import { GameLoop } from '../../shared/js/loop.js';
import { Keys } from '../../shared/js/input.js';
import { $, guardPage, query } from '../../shared/js/ui.js';
import { Park } from './game.js';
import { TICK } from './config.js';
import { View } from './render.js';
import { Hud, showMenu } from './hud.js';

guardPage();
const root = $('#root'), loading = $('#loading');
const stage = new Stage($('#stage'), { key: 'park-quality' });
const keys = new Keys();
let park = null, view = null, hud = null, loop = null, menu = null, last = null;

function teardown() {
  if (loop) loop.stop();
  if (hud) hud.dispose();
  if (view) view.dispose();
  park = view = hud = loop = null;
}
function toMenu() { teardown(); stage.renderer.clear(); menu = showMenu(root, start); }

/** 开始经营。opts：{ scenario, difficulty, seed, load? } */
function start(opts) {
  last = opts;
  if (menu) { menu.close(); menu = null; }
  teardown();
  loading.classList.remove('g-hide');
  requestAnimationFrame(() => setTimeout(() => {
    park = opts.load ? Park.load() || new Park({}) : new Park({ scenario: opts.scenario, difficulty: opts.difficulty, seed: opts.seed });
    view = new View(stage, park, { onTap: (tile) => hud && hud.onCanvasTap(tile) });
    hud = new Hud($('#hud'), park, {
      stage, keys, view,
      setSpeed: (n) => { if (loop) loop.timeScale = n; },
      restart: () => start(last), exit: toMenu,
    });
    loop = new GameLoop({
      step: 1 / TICK, maxSteps: 6,
      update: (dt) => {
        hud.readInput();
        park.tick(dt);
        // 把这帧的事件分给界面（音效、提示）和画面（重建）
        const evs = park.events.slice(); park.events.length = 0;
        for (const ev of evs) { hud.onEvent(ev); view.onEvent(ev); }
        keys.endFrame();
      },
      render: (alpha, fdt) => { view.update(alpha, fdt); hud.update(fdt); },
    });
    loop.start();
    loading.classList.add('g-hide');
  }, 30));
}

// 调试/测试入口：?auto=1&seed=42 跳过菜单直接开局
window.__park = { get park() { return park; }, get view() { return view; }, get hud() { return hud; }, get loop() { return loop; }, stage, start, toMenu };
if (query('auto')) start({ scenario: query('scenario', 'meadow'), difficulty: +query('diff', 1), seed: query('seed') ? +query('seed') : undefined });
else { loading.classList.add('g-hide'); toMenu(); }
