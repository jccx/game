# 交接说明：jccx/game 网页小游戏合集

写给接手的 agent。先读本文，再读 `TODO.md`（按顺序的待办）。更新时间：2026-11-15。

## 1. 项目是什么

用户 Bin（说中文，芝加哥）要一个**全部原创**的网页小游戏合集，放在 GitHub 仓库 `jccx/game`，用 GitHub Pages 发布：https://jccx.github.io/game/ 。

**最高优先级：手机端。** 触屏操作、手机性能第一；电脑键鼠能玩是加分项。横屏、竖屏都必须可用。

五个游戏（风格参考，但角色、名字、地图、音乐、美术一律原创，不能照搬原作），**全部已发布可玩**：

| 目录 | 名称 | 参考的类型 | 状态 | 上线提交 |
|---|---|---|---|---|
| `moba/` | 裂谷争锋 | 王者荣耀（3D 斜俯视英雄对战） | 已发布 | 9611703 |
| `city/` | 落日湾 | GTA 圣安地列斯（开放世界城市） | 已发布 | 95bc5e1 |
| `kart/` | 疾风卡丁 | 跑跑卡丁车（3D 竞速） | 已发布 | 72609ad |
| `artillery/` | 豆兵大战 | 百战天虫（回合制炮战，可炸地形） | 已发布 | 650d1c43 |
| `park/` | 梦想乐园 | 过山车大亨 2（游乐园经营） | 已发布 | 5d7abfc5 |

用户的流程要求：先把每个游戏做到可玩并测试，再统一做性能优化，最后写文档。代码要模块化、好维护，**注释用中文**。没做完的游戏在首页卡片上标“制作中”，做完改成“可玩”。

用户的偏好：别因为提问卡住（他经常离线几小时），能自己定就定、在结果里说明；提问要尽量一次问清。每次改动后向他报告“做了什么、怎么测的、哪里没验证”，说实话，不要夸大。

用户提过的具体要求（五款游戏都要保持一致）：
- 开局菜单里的“开始”按钮放在**最上面**，保证手机上一定看得见（之前被挤出屏幕底部，被他批评过）。
- 屏幕上要有**一键开关的“无敌”按钮**（点一下开、再点一下关，不是倒计时）。位置：屏幕顶部偏右，设置左侧；五款游戏都有（梦想乐园叫“免费建造”，作用是建造和研究不花钱）。

## 2. 技术约定

- **纯 ES 模块，没有构建步骤**，浏览器直接加载。Three.js r180 放在 `shared/vendor/`，由 `shared/js/three.js` 统一导出，不要用 CDN。
- **不用任何图片、模型、音频文件**：模型用 `shared/js/geo.js` 的 `Builder` 拼低多边形（顶点色合并几何体），贴图用 canvas 现画，音效用 `shared/js/audio.js` 的 Web Audio 合成（预设表 `PRESETS`，用 `Sfx.play('名字')`）。
- **逻辑和画面分离**：`Game`/`Sim`/`Race`/`Park` 等逻辑类不碰 DOM 和 Three，可以在 Node 里无头跑，测试靠这个。固定步长循环（`shared/js/loop.js` 的 `GameLoop`，逻辑 30 Hz 或 60 Hz，画面插值）。
- **手机适配**：界面单位 `--u`（约 1vmin），安全区变量 `--sl/--sr/--st/--sb`，页面高度用 `--app-h`（`guardPage()` 里的 `fitViewport()` 按可视区域量出来，避免底部被浏览器工具栏盖住）。共用样式在 `shared/css/base.css`（面板、按钮、`.cheat` 无敌按钮、`.seg` 分段按钮等），每个游戏自己的样式在 `<游戏>/css/`。
- **触控**：Pointer Events，多点触控。`shared/js/input.js` 有 `Joystick`、`ActionButton`（按住拖动瞄准、冷却环）、`DragPad`、`Keys`。
- **画质**：`shared/js/stage.js` 的 `Stage` 管 Three 渲染器，三档（流畅/均衡/高清）+ 按帧率自动降分辨率；地址加 `?q=0/1/2` 强制画质。2D 游戏（豆兵大战）不用 `Stage`，自己做同样的档位。
- **性能手段**：InstancedMesh（小兵、阴影、血条）、单个 Points 粒子系统、对象池、DOM 只在值变化时更新（各游戏 `hud.js` 的 `refresh()` 里用 `set(key, val, fn)` 记忆上次的值，见 `shared/js/ui.js` 的 `makeMemo`）。
- **共用界面代码**：`shared/js/ui.js` 的 `makeMemo(cache)`（DOM 记忆更新）和 `makeCheatButton(parent, { label, get, onToggle })`（无敌开关按钮，梦想乐园叫“免费建造”）；`shared/js/settings.js` 的 `qualityRow(box, q, names)`、`soundRow(box)`（设置面板的画质行、声音行）。五款游戏的 `hud.js` 都调这三处，不再各写一份；各游戏只留自己的标题、底部按钮和提示文字。
- **注意**：`shared/vendor/` 里的 `three.module.min.js` 是分包构建，第一行就 `from './three.core.min.js'` 导入核心，`three.core.min.js` 必须保留，删掉会让四款 3D 游戏全部 404 打不开（2026-11-15 整理时误判为重复副本删过一次，回归测试立刻发现并恢复了）。
- **数值集中放 `<游戏>/js/config.js`**，调平衡只改它。
- 目录结构：`shared/`（共用）、各游戏目录（`js/`、`css/`、`index.html`、`README.md`）、`test/`（测试）、根目录 `index.html`（首页选择游戏）、`.nojekyll`。
- 各游戏入口都暴露调试对象（`window.__moba`、`__city`、`__kart`、`__artillery`、`__park`），并支持 `?auto=1` 跳过菜单直接开局，测试用。参考 `kart/js/main.js` 的写法，新游戏照着做。

## 3. 各游戏的现状（全部可玩）

**裂谷争锋 `moba/`**：5v5 三路、3v3 单路、1v1，开局前选；五个原创英雄，玩家控制一个，其余是 AI；商店、小地图、设置、结算、横竖屏都做完。整局机器人对打能打完（1v1 约 4–7 分钟，5v5 约 16–24 分钟）。

**落日湾 `city/`**：开放世界城市，步行、驾车、通缉系统、枪战、八个任务；载具有轿车、出租车、跑车、皮卡、警车、摩托、船、飞机、坦克。已发布可玩。

**疾风卡丁 `kart/`**：三条赛道、漂移攒氮气、四种道具、七个电脑对手、最快单圈记录。已发布可玩。注意：`test/kart-sim.mjs` 里的氮气测试曾经是抖动的（等电脑 AI 在 25 秒里恰好上直道才用氮气），2026-11-15 已改成确定性写法：新开一局，把玩家车放到直道上再按氮气测最高速度，不要改回旧写法。

**豆兵大战 `artillery/`**：2–4 队、每队 2–4 个豆兵，回合制炮战，可破坏地形，八种武器，风向，电脑 AI。逻辑在 `js/game.js`（`Terrain`、豆兵物理、武器、回合流程、AI 用 `flight()` 按真实公式模拟弹道找角度；`planGen()` 是生成器，分帧计算；`trajectory()` 给瞄准预览线；`skip()` 跳过回合）。画面是 Canvas 2D（`render.js`，地形离屏画布，爆炸后只重画受影响的区域），界面在 `hud.js`。已发布可玩，提交 650d1c43。

**梦想乐园 `park/`**：24×18 格地图，铺路、5 种设施、3 种商店加厕所、过山车轨道编辑（直行、转弯、上下坡，闭环验证、速度与刺激度）、游客行为、收支与贷款、门票、研究解锁、天气、localStorage 存档。逻辑在 `js/game.js`（`Park` 类 + `traceCoaster` / `coasterStats`），画面是 Three.js 低多边形（`render.js`），界面在 `hud.js`。已发布可玩，提交 5d7abfc5。

## 4. 测试（puppeteer-core + 无头 Chrome）

- 先 `npm install`（`package.json` 只装测试工具）。浏览器默认 `/usr/bin/google-chrome`，可用环境变量 `CHROME` 改（这台沙箱上 `/usr/bin/google-chrome` 不存在，要用下载的 chrome-headless-shell，例如 `~/workspace/.tmp/chrome-headless-shell-linux64/chrome-headless-shell`）。
- `test/lib.mjs`：`launch/open/shot/check/VIEW`；`test/serve.mjs` 起本地静态服务；`test/out/` 放截图（不提交）。
- 纯逻辑：`node test/moba-sim.mjs`、`city-sim.mjs`、`kart-sim.mjs`、`artillery-sim.mjs`、`park-sim.mjs`。
- 浏览器：`moba.mjs`、`moba-input.mjs`（触摸、无敌、顶部布局）、`moba-menu.mjs`（五种手机尺寸下开始键可见）、`city.mjs`、`kart.mjs`、`artillery.mjs`、`park.mjs`、`hub.mjs`（首页）。触摸用 `page.touchscreen` 模拟。
- **每个游戏必须测的东西**：横竖屏、五种手机尺寸、开始按钮完整可见、触摸能操作、无控制台报错，并**亲自看截图**。
- 沙箱里的 WebGL 是 swiftshader 软渲染，帧率数字没有参考价值，只看同一台机器上的相对变化；真机性能需要用户反馈。

## 5. 发布

- 推送到 `main` 即部署（Pages 从根目录发布）。推送用 Muse 的 GitHub 连接器 `github push-files`（snapshot 流程，见 `/opt/hatch/connectors/github/references/snapshot-push.md`）：先核对远端 HEAD，用 `git ls-files` 重新生成清单（放克隆目录之外，排除同步记录），推送成功后把完整 commit SHA 追加进 `~/workspace/jccx-game-clone.muse-github-snapshot-sync.json`（已有 650d1c43、5d7abfc5 两条，别动它们）。
- 每次往 GitHub 写都要经过用户的批准卡片；卡片超时或失败就停下来报告，不要盲目重试，不要换别的凭证路线。
- 核对部署：`list_commits` 看 HEAD 是不是刚推的提交，`get_file_contents` 看远端文件内容，再用 `browser.open` 打开 https://jccx.github.io/game/ 和对应游戏页。**注意：首页抓取有缓存，可能滞后十几分钟甚至更久**（2026-11-15 梦想乐园上线时首页抓取还停在旧版本），以远端 `index.html` 的内容为准，如实说明缓存情况，不要只看抓取就说没上线。
- 提交信息不要编造 `Co-Authored-By` / `Claude-Session` 署名行；经连接器推送的提交作者就是用户本人（jccx）。
- 不要提交 `test/out/`。

## 6. 注意事项（踩过的坑）

- 不要用 `git stash` 做对比实验——用户拒绝过这种操作，且容易丢改动。
- 菜单面板必须 `max-height:100%` + 内部滚动，开始按钮放在顶部；不然小屏手机上按钮会被挤出屏幕。
- 手机上一切尺寸用 `--u`，不要写死 px；底部控件要留 `--sb` 安全区。
- 不要把角色、地图、名称做得像原作；新增内容保持原创。
- 日期和时区：用户在芝加哥（UTC-6）。
- 本地克隆 `~/workspace/jccx-game-clone` 的 git HEAD 会落后于远端（snapshot push 不走 git push）：开工前先 `git fetch origin` 再 `git reset --hard <远端 HEAD>`，确认 `git status` 干净；不要用 `git pull` 合并出多余提交。

## 7. 接下来按什么顺序做

见 `TODO.md`：五款游戏已全部上线，只剩统一收尾（性能优化、文档、全量回归、最终推送）和真机验证。真机验证只能由用户在手机上做，做完反馈 bug 再修。
