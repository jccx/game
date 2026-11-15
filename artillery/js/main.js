// 豆兵大战：入口。菜单 → 新建对局（Game）→ 画面（View）→ 界面（Hud）→ 主循环。
import { GameLoop } from '../../shared/js/loop.js';
import { Keys } from '../../shared/js/input.js';
import { $, guardPage, query } from '../../shared/js/ui.js';
import { Game } from './game.js';
import { TICK } from './config.js';
import { View } from './render.js';
import { Hud, showMenu } from './hud.js';

guardPage();
const root = $('#root'), loading = $('#loading');
const keys = new Keys();
let game = null, view = null, hud = null, loop = null, menu = null, last = null;

function teardown() {
  if (loop) loop.stop();
  if (hud) hud.dispose();
  if (view) view.dispose();
  game = view = hud = loop = null;
}
function toMenu() { teardown(); menu = showMenu(root, start); }

/** 开始一局。opts：{ teams 队伍数, size 每队人数, difficulty, theme 地形序号 } */
function start(opts) {
  last = opts;
  if (menu) { menu.close(); menu = null; }
  teardown();
  loading.classList.remove('g-hide');
  requestAnimationFrame(() => setTimeout(() => {
    // 地形由种子决定：找一个 seed % 3 等于所选主题的种子
    let seed = opts.seed;
    if (seed === undefined) {
      seed = (Math.random() * 1e9) | 0;
      for (let i = 0; i < 200 && seed % 3 !== (opts.theme ?? 0); i++) seed = (Math.random() * 1e9) | 0;
    }
    game = new Game({ teams: opts.teams, size: opts.size, difficulty: opts.difficulty, seed, allBots: opts.allBots });
    view = new View($('#stage'), game, { onTap: (x, y) => hud && hud.onCanvasTap(x, y) });
    hud = new Hud($('#hud'), game, { keys, view, pause: (b) => { loop.timeScale = b ? 0 : 1; }, restart: () => start(last), exit: toMenu });
    loop = new GameLoop({
      step: 1 / TICK, maxSteps: 6,
      update: (dt) => {
        hud.readInput();
        game.update(dt);
        // 把这帧的事件分给界面（音效、提示）和画面（粒子、地形重画）
        const evs = game.events.slice(); game.events.length = 0;
        for (const ev of evs) { hud.onEvent(ev); view.onEvent(ev); }
        keys.endFrame();
      },
      render: (alpha, fdt) => { view.update(alpha, fdt); hud.update(fdt); },
    });
    loop.start();
    loading.classList.add('g-hide');
  }, 30));
}

// 调试/测试入口：?auto=1&bots=1 跳过菜单直接开局，自己的队也由电脑开
window.__artillery = { get game() { return game; }, get view() { return view; }, get hud() { return hud; }, get loop() { return loop; }, start, toMenu };
if (query('auto')) start({ teams: +query('teams', 2), size: +query('size', 3), difficulty: +query('diff', 1), theme: +query('theme', 0), seed: query('seed') ? +query('seed') : undefined, allBots: query('bots') === '1' });
else { loading.classList.add('g-hide'); toMenu(); }
