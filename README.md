# 游戏大厅（jccx/game）

网页小游戏合集，手机优先，横屏竖屏都能玩。在线地址：https://jccx.github.io/game/

全部是原创作品：玩法参考了经典类型，但角色、地图、名字和美术都是自己做的，没有使用任何第三方游戏的素材。

五款游戏**全部可玩**：

| 游戏 | 目录 | 状态 | 一句话玩法 |
|---|---|---|---|
| 裂谷争锋 | `moba/` | 可玩 | 3D 英雄对战：5v5 三路 / 3v3 单路 / 1v1，五个英雄，你操控一个，其余是电脑 |
| 落日湾 | `city/` | 可玩 | 开放世界都市：步行、汽车、摩托、飞机、直升机、坦克、船，通缉、枪战、八个任务 |
| 疾风卡丁 | `kart/` | 可玩 | 卡丁车竞速：三条赛道、漂移攒氮气、四种道具、七个电脑对手 |
| 豆兵大战 | `artillery/` | 可玩 | 回合制炮战：可破坏地形、八种武器、风向，2–4 队轮流开火 |
| 梦想乐园 | `park/` | 可玩 | 游乐园经营：铺路、建设施和过山车、管游客和收支 |

## 目录结构

```
index.html          首页：选择游戏（五张卡片）
shared/             各游戏共用
  vendor/           Three.js（r180，MIT 许可），由 shared/js/three.js 统一导出
  js/               three.js（统一入口）、stage.js（渲染器和画质自适应）、loop.js（主循环）、
                    input.js（摇杆/按钮/键盘）、audio.js（合成音效）、particles.js（粒子）、
                    geo.js（模型搭建工具）、ui.js（元素/存储/提示/视口/记忆更新 makeMemo/
                    无敌开关 makeCheatButton）、settings.js（设置面板共用的画质行/声音行）、
                    util.js（数学/随机数）
  css/base.css      共用界面样式（--u 单位、安全区变量、面板、按钮、无敌开关、设置行）
moba/               裂谷争锋（见 moba/README.md）
city/               落日湾（见 city/README.md）
kart/               疾风卡丁（见 kart/README.md）
artillery/          豆兵大战（见 artillery/README.md）
park/               梦想乐园（见 park/README.md）
test/               测试脚本（无头 Chrome），截图输出到 test/out/（不提交）
```

没有构建步骤：源码就是线上跑的代码，推到 `main` 后 GitHub Pages 自动发布。

每个游戏的玩法、模块说明、数值在哪改，见各自目录下的 `README.md`；数值一律集中在各游戏的 `js/config.js`，调平衡只改它。

## 本地运行和测试

```
npm install                 # 只装测试工具（puppeteer-core、three 的参考副本）
node test/serve.mjs 8080    # 本地打开 http://127.0.0.1:8080/
node test/hub.mjs           # 首页：五张卡片、横竖屏、无报错
node test/mapdebug.mjs      # 裂谷争锋：地图连通性
node test/moba-sim.mjs      # 裂谷争锋：电脑互打整局（不开浏览器）
node test/moba.mjs          # 裂谷争锋：浏览器里开局、截图
node test/moba-input.mjs    # 裂谷争锋：模拟触屏操作
node test/moba-menu.mjs     # 裂谷争锋：五种手机尺寸下菜单和面板不超出屏幕
node test/citymap.mjs       # 落日湾：生成世界并画出俯视图
node test/city-sim.mjs      # 落日湾：载具、武器、通缉、任务的规则（不开浏览器）
node test/city.mjs          # 落日湾：浏览器里开局、触屏操作、各类载具截图
node test/kart-sim.mjs      # 疾风卡丁：赛道合法性、电脑车跑完全程、漂移氮气道具（不开浏览器）
node test/kart.mjs          # 疾风卡丁：菜单、触屏操作（含多指）、三条赛道截图、结算
node test/artillery-sim.mjs # 豆兵大战：地形、走跳、武器、无敌、电脑互打分出胜负（不开浏览器）
node test/artillery.mjs     # 豆兵大战：五种手机尺寸横竖屏、触摸瞄准开火、武器面板、结算
node test/park-sim.mjs      # 梦想乐园：建造、过山车闭环、游客、收支、贷款、研究、天气（不开浏览器）
node test/park.mjs          # 梦想乐园：五种手机尺寸横竖屏、铺路建施设、过山车编辑器、存档
```

浏览器测试默认用 `/usr/bin/google-chrome`，可用环境变量 `CHROME=…` 指定别的浏览器（例如下载的 chrome-headless-shell）。截图输出到 `test/out/`。

调试：各游戏入口都暴露调试对象（`window.__moba`、`__city`、`__kart`、`__artillery`、`__park`），支持 `?auto=1` 跳过菜单直接开局，`?q=0/1/2` 强制画质档位（流畅/均衡/高清）。具体参数见各游戏的 `README.md`。

性能说明：无头浏览器是 swiftshader 软渲染，帧耗时绝对值没有参考价值，只看同一台机器上的相对变化；真机帧率需要实测。
