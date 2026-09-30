# AGENTS.md — 嘟嘟羽毛球 Cocos 版开发指南

> 本文件供 AI 开发 Agent 阅读，帮助快速理解项目结构、开发规范与注意事项。

## 项目简介

**嘟嘟羽毛球(dudu-cocos)** 是一款基于 Cocos Creator 3.8.8 + TypeScript 的羽毛球游戏。
从老仓库 `嘟嘟02`(零依赖 canvas 版)重构而来,目标平台:**Android APK + 微信小游戏**。
老仓库保留为行为对照基准,手感以它为准。

- 当前版本:`0.0.6`(见 `package.json` 与 `assets/scripts/core/version.ts`)
- 设计分辨率:960×540,FIXED_HEIGHT 适配
- 包名:`com.dudu.badminton`
- 远端仓库:GitHub `favoroo/Dudu-Badminton` + Gitee `favo9/dudu-badminton`

## 快速定位

| 要做什么 | 去哪里看 |
|---------|---------|
| 调手感/数值 | [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) |
| 理解分层铁律 | [types.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/types.ts) 顶部注释 |
| 改物理/弹道 | [physics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/physics.ts) |
| 改球速/接球难度 | 档位表在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `pace` 段,生效逻辑在 [pace.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/pace.ts)(时间膨胀:重力 ×s²、速度类 ×s、阻力不动);玩家开关在设置页「球速」滑杆(存 `Settings.paceTier`,下一球起生效);量化诊断 `tools/reach-check.ts` |
| 改人物移速 | 档位表在 `config.ts` 的 `gait` 段,生效逻辑在 [gait.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/gait.ts);**只乘真人的 accel+vmax**(AI 走 `diffs.speed`,两层不叠),跨步冲量/跳跃/摩擦不参与;**即时生效**(不等下一球);设置页「移速」滑杆(存 `Settings.gaitTier`),组合矩阵见 `tools/reach-check.ts` §5 |
| 改角色姿势/外观 | [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) |
| 改击打/轨迹/球体特效 | 数值全在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `fx` 段;丝带 [ribbon.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/ribbon.ts) + 球体运动学 [shuttle-motion.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/shuttle-motion.ts) + 粒子 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts) + 缓动 [easing.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/easing.ts);出图验收 `node .tools-build/tools/fx-preview.js` |
| 主循环/事件分发 | [game-root.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/game-root.ts) |
| UI 面板/菜单 | [ui-manager.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-manager.ts) |
| 更新弹窗/更新说明排版 | [update-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/update-dialog.ts) + 折行算法 [release-notes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/release-notes.ts) |
| 改「调整位置」顶栏排版 | [editor-strip.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/editor-strip.ts)(纯函数,回归见 `tools/strip-check.ts`)+ [settings-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settings-panel.ts) 消费它 |
| 改虚拟按键能放在哪儿 | [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 的 `clampDelta`(唯一约束 = 整块留在可视区内) |
| 改音效映射 | [sfx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/sfx.ts) |
| 改背景音乐 | [bgm.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/bgm.ts) |
| 改启动图/应用图标 | [make-app-icons.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/make-app-icons.py) 出图标母版 → [make-splash.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/make-splash.py) 派生启动图 → [apply-splash.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/apply-splash.py) 注入构建(比例见 [splash-config.json](file:///Users/a1/Documents/01Code/dudu-cocos/tools/splash-config.json)) |
| 跑回归测试 | `tools/` 下脚本(见下文) |
| 查历史改动/排查问题 | [CHANGELOG.md](CHANGELOG.md)(Agent 变更日志,仅本地) |
| 构建配置 | [build-android.json](file:///Users/a1/Documents/01Code/dudu-cocos/build-android.json) / [build-web-mobile.json](file:///Users/a1/Documents/01Code/dudu-cocos/build-web-mobile.json) |
| 打 Android APK | [.agents/skills/export-apk/SKILL.md](file:///Users/a1/Documents/01Code/dudu-cocos/.agents/skills/export-apk/SKILL.md) |
| 发版/Git 提交推送 | [.agents/skills/dudu-release/SKILL.md](file:///Users/a1/Documents/01Code/dudu-cocos/.agents/skills/dudu-release/SKILL.md) |

## 分层铁律(改代码前必读)

1. **rules 只发事件,不碰渲染** — 比赛状态机通过事件队列通知表现层,绝不调用 `cc.*`。
2. **render 只画不算** — 渲染层只读游戏状态,不改任何逻辑字段。
3. **数值只进 config.ts** — 所有平衡数值、键位、配色、AI 难度、皮肤表集中在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts)。
4. **core/ 零 Cocos 依赖** — 逻辑层只 import cc 以外的模块,确保可在 node 下回归测试。
5. **依赖方向恒为:types ← config ← 其余模块** — 不会成环。

## 开发规范

- TypeScript strict 模式,禁止 `any`(类型检查必须零错误)。
- **严禁自动 `git commit` / `git push`** — 日常改动一律留在工作区,只有用户明确指示才执行(提交格式、双端推送、版本递增等细则见 dudu-release skill)。
- 模块间用 ES Module import/export,不使用全局命名空间。
- 每个模块文件顶部有 `// ============` 注释块说明设计动机 — **改代码前先读注释**。
- canvas → cc.Graphics 的移植约定见 [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) 顶部注释。
- `core/utils.ts` 不许 import cc,存储后端通过 [host.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/host.ts) 的 `installStorageBackend()` 注入,必须在任何 `load()` 之前调用。
- 音效/BGM 均为离线烘焙 WAV,改规格见 `tools/bake-audio.ts` / `tools/bake-bgm.ts`;音效/音乐开关统一读 [settings.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/settings.ts),模块不应有自己的静音状态。
- 角色改姿势后必须跑 pose-preview 检查:
  ```bash
  npx tsc -p tools/tsconfig.json && node .tools-build/tools/pose-preview.js --out .tools-build/pose-preview
  ```

## 回归测试(改物理/数值必跑)

```bash
# 1. 编译回归工具
npx tsc -p tools/tsconfig.json

# 2. 弹道镜像对称校验(必须全 ✓)
node .tools-build/tools/probe.js

# 3. 训练场六关自洽(exit 0)
node .tools-build/tools/drill-check.js

# 4. AI 接发成功率回归(改 AI/物理/数值必跑;阈值防回退)
node .tools-build/tools/serve-check.js

# 4.5 反应预算与输入画像(exit 0;把「手机接不到球」统一成帧的账:
#     §1 球速档位是否真的只改时间不改空间 —— 有人砍 shot.speedMax 来放慢会在这里红,
#     §2 各档判定区放宽多少,§3 slack(剩帧−跑位帧−提前量),§4 键盘/摇杆/滑轨三画像
#     跑位帧与横滑提交延迟,§5 移速档 × 球速档的组合矩阵(挑"手机合适"就照这张表)。
#     改 pace/gait/physics/player 输入相关数值后必跑)
node .tools-build/tools/reach-check.js

# 5. AI 对 AI 整机冒烟(exit 0)
node .tools-build/tools/sim-check.js

# 6. 更新弹窗「更新说明」折行/溢出回归(exit 0)
node .tools-build/tools/notes-check.js

# 6.5 「调整位置」顶栏排版回归(exit 0;透明度滑杆曾被重置/完成两颗按钮压在底下,
#     用户看到的是「没有透明度滑杆」—— 一行六件事别手调绝对坐标,见 editor-strip.ts)
node .tools-build/tools/strip-check.js
node .tools-build/tools/strip-check.js --selftest   # 反例必须被报警,防规则脚本悄悄全绿

# 7. 面板退场的触摸卫生(exit 0;遮罩/可视窗那种裸 TOUCH 监听不随 hide 卸掉,
#    关掉的面板就成一块隐形挡板 —— 曾把无限模式整局按键打死)
node .tools-build/tools/ui-hide-check.js

# 7.5 击打/轨迹/球体特效预览与几何断言(exit 0;NaN 坐标、丝带点数上限、粒子预算、
#     羽片拆片、滞后角追踪各有一条断言兜着 —— 特效改坏了先在 node 里出图看,别上真机猜)
node .tools-build/tools/fx-preview.js --out .tools-build/fx-preview   # 单页: closeups / trails / impacts

# 8. 全量类型检查(零错误)
npx tsc -p tools/tsconfig.check.json
```

## 构建与预览

```bash
# Web Mobile 预览(构建后)
python3 -m http.server 8899 --bind 127.0.0.1 --directory build/web-mobile
```

Android 构建流程见 [.agents/skills/export-apk/SKILL.md](file:///Users/a1/Documents/01Code/dudu-cocos/.agents/skills/export-apk/SKILL.md)。

## 变更日志(每次改代码必读必写)

修改源码后必须把改动追加写入 [CHANGELOG.md](CHANGELOG.md)(gitignored,仅本地)。最新日期在最上,条目头一句话概述(写明用户指令或现场问题),子项用 Added/Changed/Fixed/Verified 标签并附文件路径。会话收尾前补记,未提交也要记(标注「未提交」)。

## 必须知道的坑

1. **Cocos 编辑器对自动化封闭** — 界面不在辅助功能树里,像素捕获也被 macOS 拒绝。一切编辑器操作走 CLI + 文件直改。
2. **ZCode 内置浏览器跑不了 Cocos 构建** — 引擎内置资源加载在 IAB 里永远 hang,验证游戏用真实浏览器或编辑器预览。
3. **Bash 里 curl 走系统代理** — 访问 localhost 必须 `--noproxy '*'`。
4. **python http.server 可能只绑 IPv6** — 用 `--bind 127.0.0.1` 起本地服务。
5. **名牌文字用 Label(世界坐标),球衣号已去除** — sprites.ts 画不了字,径向渐变用描边环近似。
6. **老仓库有意差异(不是 bug)** — rules 拖尾改为 `setTrailHook()` 注入;config `serve` 段原版定义两次已合并。
7. **改 Android 应用名要改构建脚本** — 手机安装界面显示的名字是「嘟嘟羽毛球」,由 `.agents/skills/export-apk/scripts/build.sh` 每次构建用 sed 注入到产物 `build/android/proj/res/values/strings.xml`。源文件 `native/engine/android/res/values/strings.xml` 是**空的**,在那儿改没用(会被覆盖且不生效)。版本号联动规则见 dudu-release skill。

## 尚未移植

- ⏳ 微信小游戏构建(无 build-wechat 配置;需要 AppID 与域名白名单)
