# 游戏大厅（jccx/game）

网页小游戏合集，手机优先，横屏竖屏都能玩。在线地址：https://jccx.github.io/game/

全部是原创作品：玩法参考了经典类型，但角色、地图、名字和美术都是自己做的，没有使用任何第三方游戏的素材。

| 游戏 | 目录 | 状态 | 说明 |
|---|---|---|---|
| 裂谷争锋 | `moba/` | 可玩 | 3D 英雄对战：5v5 三路 / 3v3 单路 / 1v1，五个英雄，你操控一个，其余是电脑 |
| 落日湾 | `city/` | 制作中 | 开放世界都市：步行、汽车、摩托、飞机、坦克、船，通缉、枪战、任务 |
| 疾风卡丁 | `kart/` | 制作中 | 卡丁车竞速：漂移、氮气、道具、电脑对手 |
| 豆兵大战 | `artillery/` | 制作中 | 回合制炮战：可破坏地形、多种武器、风向 |
| 梦想乐园 | `park/` | 制作中 | 游乐园经营：铺路、建设施和过山车、管游客和收支 |

## 目录结构

```
index.html          首页：选择游戏
shared/             各游戏共用
  vendor/           Three.js（r180，MIT 许可）
  js/               three.js（统一入口）、stage.js（渲染器和画质自适应）、loop.js（主循环）、
                    input.js（摇杆/按钮/键盘）、audio.js（合成音效）、particles.js（粒子）、
                    geo.js（模型搭建工具）、ui.js、util.js
  css/base.css      共用界面样式
moba/               裂谷争锋（见 moba/README.md）
test/               测试脚本（无头 Chrome）
```

没有构建步骤：源码就是线上跑的代码，推到 `main` 后 GitHub Pages 自动发布。

## 本地运行和测试

```
npm install                 # 只装测试工具（puppeteer-core、three 的参考副本）
node test/serve.mjs 8080    # 本地打开 http://127.0.0.1:8080/
node test/hub.mjs           # 首页
node test/mapdebug.mjs      # 裂谷争锋：地图连通性
node test/moba-sim.mjs 3    # 裂谷争锋：电脑互打整局（不开浏览器）
node test/moba.mjs          # 裂谷争锋：浏览器里开局、截图
node test/moba-input.mjs    # 裂谷争锋：模拟触屏操作
```

浏览器测试默认用 `/usr/bin/google-chrome`，可用环境变量 `CHROME=…` 指定别的浏览器。截图输出到 `test/out/`。
