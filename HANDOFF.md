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

**落日湾 `city/`**：开放世界城市，步行、驾车、通缉系统、枪战、八个任务；载具有轿车、出租车、跑车、皮卡、警车、摩托、船、飞机、直升机、坦克。
出生就带全部 5 种武器，子弹打空自动补满；街上平民行人上限 36 个。直升机能降落在够大的平顶楼顶上（轻推慢降，下机后站在楼顶、能再上机起飞）；
六种载具上都能发火箭筒（J 键或“火箭”键，坦克炮保留），火箭筒射程无限、飞到命中才爆炸（瞄准辅助只看 130 米内）。直升机操作（2026-11-21 改）：摇杆管水平（上下前进/后退、左右转向），升降改“上升/下降”两个按钮（复用油门/刹车键，按钮是二值的，给固定 0.6 档即 7.8 米/秒，在坠毁阈值 9 米/秒以内，按住“下降”能直接平稳落地；键盘方向键保持满杆 ±1）；飞机和其他载具的操作不动。武器射速（2026-11-21 改）：五种武器全部 10 发/秒（拳头、手枪、霰弹枪、火箭筒都改成和冲锋枪一样），坦克炮间隔 1.4 秒改成 0.1 秒，载具火箭筒同样 10 发/秒；伤害、射程、弹药数不动；补满提示 1 秒内最多弹一次。市中心有 8 栋世界地标（埃菲尔铁塔、帝国大厦、哈利法塔、悉尼歌剧院、比萨斜塔、大本钟、西尔斯大厦、特朗普大厦），走近 70 米内报一次名字，屋顶不可降落；所有建筑都有血量，炸毁后变废墟、整局不恢复（民房 1 发火箭筒、高楼 3~4 发、地标 6~8 发）。机场/军营地面闪烁（2026-11-21 修）：停机坪和军营地面顶面与道路顶面完全共面（都是 y=2.03），跑道和虚线间距只有 0.02~0.03 米，深度精度不够导致闪烁；改法是把停机坪、跑道、虚线、军营地面拆成三层独立网格加 polygonOffset（地面 -1、跑道 -2、虚线 -3），高度颜色位置不动。以上五批 2026-11-21 合并一次推送，提交 e4b474a，已发布可玩。

**疾风卡丁 `kart/`**：三条赛道、漂移攒氮气、四种道具、七个电脑对手、最快单圈记录。已发布可玩。注意：`test/kart-sim.mjs` 里的氮气测试曾经是抖动的（等电脑 AI 在 25 秒里恰好上直道才用氮气），2026-11-15 已改成确定性写法：新开一局，把玩家车放到直道上再按氮气测最高速度，不要改回旧写法。

**豆兵大战 `artillery/`**：2–4 队、每队 2–4 个豆兵，回合制炮战，可破坏地形，八种武器，风向，电脑 AI。逻辑在 `js/game.js`（`Terrain`、豆兵物理、武器、回合流程、AI 用 `flight()` 按真实公式模拟弹道找角度；`planGen()` 是生成器，分帧计算；`trajectory()` 给瞄准预览线；`skip()` 跳过回合）。画面是 Canvas 2D（`render.js`，地形离屏画布，爆炸后只重画受影响的区域），界面在 `hud.js`。已发布可玩，提交 650d1c43。

**梦想乐园 `park/`**：24×18 格地图，铺路、5 种设施、3 种商店加厕所、过山车轨道编辑（直行、转弯、上下坡，闭环验证、速度与刺激度）、游客行为、收支与贷款、门票、研究解锁、天气、localStorage 存档。逻辑在 `js/game.js`（`Park` 类 + `traceCoaster` / `coasterStats`），画面是 Three.js 低多边形（`render.js`），界面在 `hud.js`。性能优化（2026-11-21）：BFS 队列 shift 改队首指针、过山车推演加缓存、游客渲染循环内联坐标换算，玩法数值一字未动；基线本来就没有逐帧瓶颈（满员 60 人逻辑 tick 约 0.023 毫秒）。已发布可玩，提交 5d7abfc5，优化随 e4b474a 一起推送。

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

## 8. 2026-11-21 晚：四批合并与 reset 取消（未推送）

- 四批合进主副本：烟花（§16）、建筑重建（§17）、重建新规则（§18）、码头上船（§19）、联机（net.js/net-firebase.js/database.rules.json/test/city-net-sim.mjs/test/city-net.mjs/test/relay.mjs）。主副本相对 e4b474a：15 个文件 +955/−44，另 7 个联机新文件未追踪。任务发布者名字标签修了一行（view.js:443，`''` 改 `'block'`）。
- 2026-11-21 22:27 用户取消每半小时 reset 地图规则：net.js/net-firebase.js 里的 reset 定时、抢权、提醒、meta 读写，sim.js 的 resetWorldState，hud.js 的 reset 提醒 UI，database.rules.json 的 meta 块，README 与计划文件里的 reset 描述，测试里的 reset 节，全删。被炸的楼改靠 60~180 秒自动重建恢复：rebuildBuilding 把恢复状态同步到库；收到远端已炸的楼时本地也排一个 60~180 秒重建计时；updateRebuilds 里远端已恢复的楼直接出队。database.rules.json 改完要去 Firebase 控制台重新粘贴发布一次。
- 验证：逻辑测试 city-sim 306、city-net-sim 48、kart 23、artillery 20、park 81、moba 3、citymap 9、park-perf 6，全过；浏览器测试 city.mjs 253/253、city-net.mjs 15/15、hub 9/9，全过。等用户批准再推送。

## 9. 2026-11-22：联机 v2（进行中，未推送；基座 e0095238）

- 范围：路人/警察/交通车/任务/拾取物/子弹全同步（房主制，uid 最小者当房主，环境快照 2Hz）、PvP 互杀、每周排行榜（周一 00:00 芝加哥时间清零，保留）、键盘让位（所有输入框）、跑步模式（3 倍速，令牌桶预算）、竖屏铺满 + 转屏不挤压、离开立即释放名字、点“联机 N 人”开排行榜、全员无敌共享开关。
- 关键文件：`city/js/net.js`、`city/js/net-firebase.js`、`city/js/sim.js`、`city/js/missions.js`、`city/js/hud.js`、`city/js/render/view.js`（竖屏 FOV 78°）、`shared/js/ui.js`（fitViewport 改用 innerHeight、attachKeyboardFit）、`shared/js/stage.js`（ResizeObserver 兜底转屏）、`shared/css/base.css`（.kbd）、`database.rules.json`（新增 env/shots/hits/pdmg/vdmg/ptake/missions/scores/feed/godMode，players 加 stars/dead/run）。
- 注意：Firebase 的 web API key 已被限制为只允许 `https://jccx.github.io/*` 来源——localhost 跑 `test/city-net.mjs` 会在登录时被拒（限制在起作用，不是 bug），真库浏览器验证要走 Pages 域名。逻辑测试用内存 mock（`test/city-net-sim.mjs`），不受影响。
- 排行榜按名字认人：名字释放后别人重用，落在同一行、继承它的分（合并，不清零）——2026-11-22 01:49 用户定：保持合并，不改。
- 跑步预算是令牌桶（2026-11-22 01:49 用户定，替代严格滚动窗口）：桶 40 秒，跑动每秒扣 1 秒、步行每秒回 1 秒（`PLAYER.runRefill = 1`），站着不动不扣也不回；扣空强制步行并锁死，走路回满 5 秒（`PLAYER.runResume = 5`）才解锁再跑。60 秒里最多能跑约 50 秒。测试 §15 按令牌桶断言；浏览器 city.mjs 加了跑步段（速度、扣桶、角标、变灰、解锁）。
- 2026-11-22 后续补的系统性逻辑测试：city-net-sim §13 房主选举（含重选和镜像接手）、§14 环境快照（路人/警察/交通车/拾取物领取/子弹/任务抢占与进度）、§15 跑步模式（令牌桶）。city-net-sim 现 132 项。
- database.rules.json 改完要去 Firebase 控制台重新粘贴发布一次（新增 godMode 等节点）。
- 推送前要用户批准；v2 已合进主副本，待推送。

## 10. 2026-11-22：主角座驾无敌只跟无敌开关走（用户纠正，未推送；基座 0e109ce5）

- 2026-11-21 的重建批把主角坐着的车做成了无条件无敌（Vehicle.damage 直接 return、爆炸循环跳过、重建时推到楼外）。2026-11-22 09:33 用户纠正：座驾无敌仅在无敌开启时有效，没开无敌时车在碰撞和火力攻击下照常爆炸。
- 改法：新增 `Sim.godOn()`（`player.godT > 0 || netGod`，本地无敌或联机全员无敌任一开着都算开），`hurtPlayer` 改走它；三个口子都按它守：`Vehicle.damage()`（直接伤害、撞车、撞楼）、`sim.explode` 里的载具循环（爆炸伤害 + 炸飞）、`rebuildBuilding`（无敌关了，废墟上的主角座驾和别的车一样直接炸掉，玩家被炸下车）。不动的口子：直升机/飞机失事自毁（hp=0 + explode()，飞行员操作失误）、沉船（sink，从来没守过）；烧起来的车（无敌关着时打着的）即使中途开无敌，烧完照旧炸——那是关着时受的伤的后果。
- 坐车分摊（hurtPlayer：人吃 20%，车吃 1.6 倍）代码一直都在，只是原来被无条件守门挡住了；无敌关了分摊照旧生效，测试 §20(g) 按 50 点伤害断言车掉 80、人掉 10。
- 逻辑测试 city-sim 新增 §20 共 37 项（无敌关：直接伤害/爆炸/火箭/撞车掉血、打爆起火爆炸、重建时炸掉；无敌开：全都不掉血；godT 和 netGod 各自都能守门；hurtPlayer 分摊；直升机满杆砸楼顶照旧坠毁），city-sim 现 343 项；§18 的推车测试补了 godT=Infinity（无敌开着才是推到楼外）。其余逻辑套件全过。浏览器 city.mjs 跑了一遍（见日志）。
- 注意：联机里每台客户端只算自己主角座驾的伤（固定车血量由车主同步回来，别人打的会自愈），所以本地 godOn 就够了，不用跨客户端算。
## 11. 2026-11-22：下线后地图不留人、下线通知 15 秒过期（未推送；基座 0e109ce5）

- 用户 09:24 两条：(1) 玩家下线后不要在地图上显示了，只保留排行榜，不用再显示之前的位置；(2) 下线通知（“xxx离开了”）只在断开连接的 15 秒内向其他在线玩家显示，不用一直显示。
- 根子查清楚了（先复现再修，见 test/repro-offline.mjs，已删）：Net 层本来就是对的——`_onPlayers` 和 10 秒兜底都会把下线的人从 `remotePlayers` 里删掉、只发一次 `playerLeave`，30 秒里不重复、不复活；排行榜 scores 节点离开时一字不动。3D 人物（view.js 按在线列表画）、雷达（hud.js 每 0.1 秒按在线列表重画）、联机面板（每 1 秒刷新）、人数徽标也都跟着在线列表走，没有幽灵。唯一漏的是**大地图**：`openMap()` 打开时只画一次，人走了绿点还留在旧位置上，直到关地图才消失——这就是用户说的“之前的位置”。
- 改法（4 个文件，+161/−18）：`city/js/hud.js`——大地图抽成 `drawBigMap(cv)`，开着时每 0.5 秒重画一次（画前复位变换、清画布，不然第二次画会整体错位），收到加入/离开事件也马上重画，关面板时清掉定时器（`closeOverlay`）；`playerLeave` 的 toast 改成 15 秒（`toast('xxx离开了', 15000)`），到期自动收起。`shared/js/ui.js`——新加 `leaveNoticeDue(seen, name, now)`：同一个名字 15 秒内只报一次（网络抖动反复掉线/重连不会刷屏），过期名字顺手清掉；击杀播报（`killFeed` toast）是另一条提示，一字未动。`test/city-net-sim.mjs` 加 §16（19 项）：下线后在线列表为空且 30 秒不复活、playerLeave 恰好一次、库里的分和榜上的分都在、15 秒窗口假时钟断言（5 秒/14.999 秒不报、满 15 秒可再报、不同名字不受影响）、同名重加入是新鲜位置且榜上的分还在。`test/city-net.mjs` 加 §9（大地图绿像素对照：在线时 >20 个绿像素，下线后 0 个；人物也没了；排行榜订阅还在、面板能打开）和 §10（通知 15 秒后自动消失；15 秒内重复掉线不重复报）。§9/§10 要走 Pages 域名跑真库，localhost 会被 API key 来源限制拒掉（和 §7/§8 一样，待推送后验）。
- 验证：逻辑 8 套全过（city-sim 306、city-net-sim 151、kart 23、artillery 20、park 81、moba 3、citymap 9、park-perf 6）；浏览器 city.mjs 286/286（exit 0，日志 `~/workspace/system/city-browser-offline-map.log`，约 23 分钟——三套浏览器测试并发跑、内存吃紧所致）、hub 9/9（exit 0）。city-net.mjs §9/§10 未跑，待 Pages origin 验。等用户批准再推（不要直接推这个克隆，走主副本三方合并流程）。
## 12. 2026-11-22：竖屏底部黑边仍在（用户 09:31 反馈；修复完成，未推送；基座 0e109ce5）

- 现象：v2 的竖屏铺满修完并推送（98190034）后，用户手机上竖屏底部黑边还在。根因不是取值错了，而是事件漏了：`fitViewport`（shared/js/ui.js）只听 window 的 `resize` / `orientationchange`；iOS Safari 工具栏收起/展开时，window 的 `resize` 可能在工具栏动画开始就触发、读到旧高度，之后不再触发，`--app-h` 就钉死在工具栏出现时的矮值上，工具栏收起后底部露出 `#0a0e18` 底色。`#stage` 上的 ResizeObserver 救不了：它只看容器尺寸，容器尺寸就是由同一个过期的 `--app-h` 驱动的。
- 复现（无头，/tmp/portrait-repro.mjs）：竖屏 390x844，先把 innerHeight 影子成 700 并触发 window resize（模拟工具栏出现，--app-h 跟到 700px 正确），再把 innerHeight 变回 844、只触发 visualViewport resize——修前 --app-h 停在 700px、画布 700 高、底部黑边 144px；visualViewport scroll 同样漏掉。
- 修复（shared/js/ui.js 的 `fitViewport`，影响五款游戏共用的尺寸代码）：值仍读 `window.innerHeight`（v2 定好的语义不动）；触发器补上 `window.visualViewport` 的 `resize` 和 `scroll`（工具栏收起/展开时可视区域跟着变，是真正漏掉的事件源）；每次触发后下一帧再读一次，让动画中途的中间值收敛到最终值；只有值真的变了才写 DOM。另：`city/js/hud.js` 的 `dispose()` 原来没拆键盘让位监听（面板关掉都走 `closeOverlay`，只有 dispose 这条路会漏），补了一行兜底。
- 键盘让位排查结论：不是它——`openOverlay` 一律先走 `closeOverlay`（拆监听、去 kbd class），面板内关闭/点遮罩/设置里“清除存档重来”都经过它；只有 `dispose()` 直接清 DOM 那条路漏了，已补。
- 大厅（index.html）排查结论：不是它——大厅是普通滚动文档页，没用 `.g-root` / `fitViewport`，没有固定高度的游戏区，不会出这种黑边。
- 测试：`test/city.mjs` 新增工具栏收起检查（两种竖屏尺寸 ×（vv resize / vv scroll / 恢复真实 innerHeight / 真 visualViewport 可用 / --app-h 变矮）＝ 10 项）；修测试时发现两个旧测试写法坑：`delete window.visualViewport` 恢复不了真对象（删后是 undefined，cover 检查里改成先存真对象再贴回去）、`delete window.innerHeight` 会把它整个删掉（innerHeight 是 window 自身的访问器属性，改成存描述符再恢复）；跑步角标 39s 检查是旧的刷新时序抖动（HUD 0.1 秒一刷，600 毫秒有时读早了），改成等角标真的变成 39s 再读（和武器切换那处同一写法）。验证：逻辑 8 套全过（306/132/23/20/81/3/9/6）；浏览器 city.mjs 296/296、hub 9/9。`test/city-net.mjs` 没在 localhost 跑（API key 来源限制，按设计）。
- 仍需用户真机确认：无头只能模拟“事件漏掉”这个状态，Safari 工具栏动画里 resize 到底带不带新值、动画多长，都只能在他手机上验证。推上去后请他竖屏玩、开关几次工具栏（上下滑、开联机面板输名字）再看底部。

