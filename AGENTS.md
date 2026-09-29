# AGENTS.md — 嘟嘟羽毛球 Cocos 版开发指南

> 本文件供 AI 开发 Agent 阅读，帮助快速理解项目结构、开发规范与注意事项。

## 项目简介

**嘟嘟羽毛球(dudu-cocos)** 是一款基于 Cocos Creator 3.8.8 + TypeScript 的羽毛球游戏。
从老仓库 `嘟嘟02`(零依赖 canvas 版)重构而来,目标平台:**Android APK + 微信小游戏**。
老仓库保留为行为对照基准,手感以它为准。

- 当前版本:`0.0.3`(见 `package.json` 与 `assets/scripts/core/version.ts`)
- 设计分辨率:960×540,FIXED_HEIGHT 适配
- 包名:`com.dudu.badminton`
- 远端仓库:GitHub `favoroo/Dudu-Badminton` + Gitee `favo9/dudu-badminton`

## 快速定位

| 要做什么 | 去哪里看 |
|---------|---------|
| 调手感/数值 | [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) |
| 理解分层铁律 | [types.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/types.ts) 顶部注释 |
| 改物理/弹道 | [physics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/physics.ts) |
| 改角色姿势/外观 | [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) |
| 主循环/事件分发 | [game-root.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/game-root.ts) |
| UI 面板/菜单 | [ui-manager.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-manager.ts) |
| 改音效映射 | [sfx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/sfx.ts) |
| 改背景音乐 | [bgm.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/bgm.ts) |
| 跑回归测试 | `tools/` 下脚本(见下文) |
| 构建配置 | [build-android.json](file:///Users/a1/Documents/01Code/dudu-cocos/build-android.json) / [build-web-mobile.json](file:///Users/a1/Documents/01Code/dudu-cocos/build-web-mobile.json) |
| 发版流程 | [.agents/skills/dudu-release/SKILL.md](file:///Users/a1/Documents/01Code/dudu-cocos/.agents/skills/dudu-release/SKILL.md) |

## 目录结构

```
dudu-cocos/
├── assets/
│   ├── scenes/
│   │   └── main.scene                 # 唯一场景(Canvas + Camera + Widget + GameRoot)
│   ├── scripts/
│   │   ├── core/                      # 逻辑层(纯 TS,零 Cocos 依赖,可在 node 下回归)
│   │   │   ├── types.ts               # 共享实体类型(Player/Ball/输入/事件/数据表)
│   │   │   ├── config.ts             # ★ 全部平衡数值/键位/配色/AI 难度/皮肤/关卡表
│   │   │   ├── utils.ts               # 数学工具 + 存储封装(后端由宿主注入)
│   │   │   ├── physics.ts             # 羽毛球空气动力学 + 弹道反解 + 挥拍几何
│   │   │   ├── player.ts              # 移动/跳跃/挥拍状态机/命中判定
│   │   │   ├── ai.ts                  # CPU 决策(重模拟球路 → 拦截点 → 时机挥拍)
│   │   │   ├── rules.ts               # 比赛状态机 + 计分 + 发球权(只发事件,不碰渲染)
│   │   │   ├── drill.ts               # 训练场:喂球机输入 + 达标判据 + 星级账本
│   │   │   ├── career.ts              # 生涯成长:赛后奖励/等级/皮肤购买装备
│   │   │   ├── settings.ts            # 全局设置(音效/音乐/画面提示/虚拟按键布局)
│   │   │   ├── update-service.ts      # 应用内更新检查(Gitee 优先/GitHub 备选/代理镜像)
│   │   │   ├── version.ts             # 版本号定义与语义化版本比较
│   │   │   └── utils.ts               # 数学工具 + 存储封装
│   │   ├── input/                     # 输入适配层
│   │   │   ├── pad.ts                 # Pad 意图合成(多输入源写同一张 Pad)
│   │   │   ├── keyboard.ts            # 键盘输入 → Pad
│   │   │   └── touchpad.ts            # 触屏虚拟按键 → Pad
│   │   ├── render/                    # 渲染层(只读游戏状态,不改逻辑)
│   │   │   ├── world.ts               # 视口变换 + 每帧重绘 + 飘字 + 拖尾 + 震屏
│   │   │   ├── court.ts               # 静态球场绘制
│   │   │   ├── sprites.ts             # 角色与羽毛球(纯 cc.Graphics 折线/圆,零图片零骨骼)
│   │   │   ├── palette.ts             # 配色工具与 alpha 叠加
│   │   │   ├── fx.ts                 # 粒子 & 打击特效(扣杀冲击波/甜区光晕/扬尘/彩带等)
│   │   │   ├── hud-overlay.ts         # 画布内世界提示(落点预测圈/时机条/赛点旗标)
│   │   │   ├── drill-anim.ts          # 训练场动画(时机条/计量器)
│   │   │   └── widgets.ts             # 渲染小工具
│   │   ├── game/                      # 主循环胶水层
│   │   │   ├── game-root.ts           # ★ 60Hz 固定步长主循环 + 事件分发 + HUD
│   │   │   ├── sfx.ts                 # 音效加载与播放映射(烘焙 WAV → 事件)
│   │   │   ├── bgm.ts                 # 自适应背景音乐编排(分层 stem + 事件 one-shot)
│   │   │   └── host.ts                # 宿主能力注入(平台存储后端 → core/utils)
│   │   └── ui/                        # UI 面板层
│   │       ├── ui-manager.ts          # ★ UI 统一控制器(菜单/HUD/暂停/结算/生涯/训练/设置)
│   │       ├── main-menu.ts           # 主菜单
│   │       ├── hud.ts                 # 对战 HUD(比分/发球权)
│   │       ├── pause-panel.ts         # 暂停面板
│   │       ├── settle-panel.ts        # 结算面板
│   │       ├── career-panel.ts       # 生涯面板(皮肤商店/等级)
│   │       ├── drill-panel.ts         # 训练场面板
│   │       ├── settings-panel.ts      # 设置面板(音效/画面/按键布局)
│   │       ├── update-dialog.ts       # 应用内更新弹窗
│   │       ├── ui-arcade.ts           # 街机风格 UI 绘制(面板/按钮/扫描线/暗角)
│   │       └── widgets.ts             # UI 控件(滑块/开关)
│   └── resources/
│       └── audio/
│           ├── sfx/                   # 烘焙音效 WAV(29 个,tools/bake-audio.ts 生成)
│           └── bgm/                   # 烘焙 BGM stem WAV(groove/drums/arp/lead/tamb/menu)
├── tools/                             # Node.js 回归与烘焙工具
│   ├── tsconfig.json                 # 回归编译配置(只编 core/** + tools/**)
│   ├── tsconfig.check.json            # 全量类型检查(含 cc-shim 兜底)
│   ├── cc-shim.d.ts                  # cc 类型声明兜底(编辑器打开后以正式类型为准)
│   ├── cc-stub.ts                    # pose-preview 用的运行时 cc 替身
│   ├── probe.ts                      # 弹道矩阵 + 左右镜像对称校验
│   ├── drill-check.ts                # 训练场六关喂球自洽断言
│   ├── sim-check.ts                  # AI 对 AI 完整一局冒烟测试
│   ├── pose-preview.ts               # 角色姿势 dump 成 SVG + 几何断言
│   ├── bake-audio.ts                 # 音效离线烘焙(WebAudio 合成 → WAV)
│   ├── bake-bgm.ts                   # BGM 分层离线烘焙
│   └── settings-check.ts             # 设置存档断言
├── native/                            # Android 原生工程模板
│   └── engine/android/               # Cocos 原生引擎配置(包名/ABI/签名等)
├── extensions/
│   └── scene-opener/                  # 编辑器扩展:启动时自动打开 main 场景
├── settings/v2/packages/             # Cocos 编辑器项目设置
│   ├── project.json                  # 设计分辨率 960×540
│   ├── builder.json
│   └── ...
├── .agents/skills/                    # Agent 技能定义
│   ├── dudu-release/                 # Git 提存/双端推送/版本发布流程
│   └── export-apk/                   # APK 构建导出
├── build-android.json                # Android 构建配置
├── build-web-mobile.json             # Web Mobile 构建配置
├── package.json                      # 项目元数据(版本/依赖/scripts)
├── README.md                          # 项目说明
├── HANDOFF.md                         # 工作交接文档(含已知坑与下一步)
└── .gitignore                        # 忽略 build/ library/ temp/ .tools-build/ 等
```

## 分层铁律(改代码前必读)

1. **rules 只发事件,不碰渲染** — 比赛状态机通过事件队列通知表现层,绝不调用 `cc.*`。
2. **render 只画不算** — 渲染层只读游戏状态,不改任何逻辑字段。
3. **数值只进 config.ts** — 所有平衡数值、键位、配色、AI 难度、皮肤表集中在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts)。
4. **core/ 零 Cocos 依赖** — 逻辑层只 import cc 以外的模块,确保可在 node 下回归测试。
5. **依赖方向恒为:types ← config ← 其余模块** — 不会成环。

## 开发规范

### 代码风格

- TypeScript strict 模式,禁止 `any`(类型检查必须零错误)。
- 模块间用 ES Module import/export,不使用全局命名空间。
- 每个模块文件顶部有 `// ============` 注释块说明设计动机 — **改代码前先读注释**。
- canvas → cc.Graphics 的移植约定见 [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) 顶部注释。

### 存储后端注入

`core/utils.ts` 不许 import cc(否则 tools 回归编译失败),存储后端通过 [host.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/host.ts) 的 `installStorageBackend()` 注入。必须在任何 `load()` 之前调用(GameRoot.onLoad 里已排好)。

### 音频

- 音效是离线烘焙的 WAV(不实时合成),改音效规格见 `tools/bake-audio.ts`。
- BGM 是分层烘焙的循环 stem + 事件 one-shot,由 [bgm.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/bgm.ts) 编排。
- 音效/音乐开关和音量统一读 [settings.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/settings.ts),任何模块不该有自己的静音状态。

### 角色绘制

角色是纯 `cc.Graphics` 折线/圆(零图片零骨骼)。改姿势后必须跑 `pose-preview` 检查:
```bash
npx tsc -p tools/tsconfig.json
node .tools-build/tools/pose-preview.js --out .tools-build/pose-preview
open .tools-build/pose-preview/index.html
```

## 回归测试(改物理/数值必跑)

```bash
# 1. 编译回归工具
npx tsc -p tools/tsconfig.json

# 2. 弹道镜像对称校验(必须全 ✓)
node .tools-build/tools/probe.js

# 3. 训练场六关自洽(exit 0)
node .tools-build/tools/drill-check.js

# 4. AI 对 AI 整机冒烟(exit 0)
node .tools-build/tools/sim-check.js
```

## 全量类型检查

```bash
npx tsc -p tools/tsconfig.check.json
```

## 构建与预览

```bash
# Web Mobile 预览(构建后)
python3 -m http.server 8899 --bind 127.0.0.1 --directory build/web-mobile
# 浏览器打开 http://127.0.0.1:8899

# Android 构建(需要 JDK 17 + Android SDK + NDK)
# 配置见 build-android.json
```

## Git 与发布规范

### 提交规范

- **严禁自动 git commit / git push** — 只有用户明确指示时才执行。
- 提交格式:`<type>(<scope>): <description>`,Type:`feat`/`fix`/`refactor`/`style`/`docs`/`test`/`chore`
- 推送时必须同时同步至 GitHub 与 Gitee 两端。

### 版本发布

- 每次发布版本号必须递增 +1(如 `v0.0.2` → `v0.0.3`),禁止同版本覆盖发布。
- 版本号来源:`package.json` 的 `version` 与 [version.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/version.ts) 的 `APP_VERSION` 保持严格一致。
- 发布流程详见 [.agents/skills/dudu-release/SKILL.md](file:///Users/a1/Documents/01Code/dudu-cocos/.agents/skills/dudu-release/SKILL.md)。
- 一键发版脚本:`python3 .agents/skills/dudu-release/release.py build --version X.Y.Z`

## 必须知道的坑

1. **Cocos 界面对自动化封闭** — Dashboard 和 Creator 的界面内容不在辅助功能树里,像素捕获也被新 macOS 拒绝。一切编辑器操作走 CLI + 文件直改(`--project` / `--build` / 改 scene/settings JSON / 扩展)。
2. **ZCode 内置浏览器跑不了 Cocos 构建** — 引擎内置资源加载在 IAB 里永远 hang。验证游戏用真实浏览器或编辑器预览。
3. **Bash 里 curl 走系统代理** — 访问 localhost 必须 `--noproxy '*'`。
4. **python http.server 可能只绑 IPv6** — 用 `--bind 127.0.0.1` 起本地服务。
5. **键盘输入待验证** — keyboard.ts 假设 `EventKeyboard.keyCode` 值就是浏览器 `e.code` 字符串(如 'KeyA')。若真机按键无反应,先查这个。
6. **名牌/球衣号无文字** — Graphics 画不了字,sprites.ts 里留了【移植限制】注释和坐标,需挂 Label。
7. **老仓库有意为之的行为差异(不是 bug)**:
   - rules 画球拖尾改为 `setTrailHook()` 注入(原版表现层依赖泄漏)。
   - config 的 `serve` 段在原版定义了两次(前段是死值),已合并保留全部字段。

## 已完成阶段

- ✅ 逻辑层 8 模块 TS 移植(core/*.ts),三项回归全绿
- ✅ 触屏虚拟按键 + 键盘输入适配(input/*)
- ✅ 音效烘焙 + BGM 分层烘焙(game/sfx.ts + game/bgm.ts)
- ✅ 渲染层(render/*) + 主循环胶水(game/game-root.ts)
- ✅ 完整 UI 面板(ui/*):菜单/HUD/暂停/结算/生涯/训练/设置/更新弹窗
- ✅ 粒子特效系统(render/fx.ts)
- ✅ 应用内更新检查(core/update-service.ts)
- ✅ Android APK 构建配置与导出

## 尚未移植

- ⏳ 球场装饰(看台/灯光/主题皮肤,court.js 的纯视觉部分)
- ⏳ 完整镜头特效(punch/慢动作)
- ⏳ 老仓库回放系统(replay.js,低优先级)
- ⏳ 微信小游戏构建
