# HANDOFF — 嘟嘟羽毛球 Cocos 重构 · 工作交接

> 给新对话的开场白:「读一下 /Users/a1/Documents/01Code/dudu-cocos/HANDOFF.md,继续下一步」
> 更新时间:2026-09-28

## 项目与目标

老仓库 `/Users/a1/Documents/01Code/嘟嘟02`(零依赖 canvas JS 羽毛球游戏,已存档于
`save/current-version` 分支,commit aacc358)→ 用 **Cocos Creator 3.8.8 + TypeScript** 重构,
目标平台:**微信小游戏 + 安卓 APK**。老仓库保留为**行为对照基准**。

## 环境与关键路径

| 项 | 值 |
| --- | --- |
| 新工程 | `/Users/a1/Documents/01Code/dudu-cocos`(已 git init,尚未 commit) |
| 编辑器 | `/Applications/CocosCreator.app` 3.8.8(直链下载安装,用户已登录 Cocos 账号) |
| 构建产物 | `dudu-cocos/build/web-mobile`(gitignored,本地服务 8899 端口可看) |
| 回归工具 | `tools/` → probe / drill-check / sim-check(全绿),bake-audio(音效烘焙) |
| node | v22.11,typescript 5.5.4 在工程 devDependencies |
| Computer Use | 已启用可用;但 **Cocos 全家(Dashboard/Creator)界面对其封闭**(见下) |

## 已完成

1. **逻辑层 8 模块 TS 移植**(`assets/scripts/core/`):types / utils / config / physics /
   player / ai / rules / drill / career。算法与设计注释 1:1 保留。三项回归全绿
   (probe 镜像对称 ✓、drill-check 六关自洽 ✓、sim-check AI 对 AI 整机 ✓)。
2. **三项产品决策已落地**:
   - ①触屏 = 虚拟按键(`assets/scripts/input/touchpad.ts`,左下移动簇/右下击球簇,与键盘同语义)
   - ②手机版砍双人:`CFG.mobileOnly` + `menuForPlatform()`,2p/2v2 代码保留只藏入口
   - ③音频烘焙:`tools/bake-audio.ts` 把老 WebAudio 合成离线渲染成 **29 个 WAV(712KB)**
     在 `assets/resources/audio/sfx/`;播放映射在 `game/sfx.ts`。BGM 烘焙未做。
3. **阶段 2 渲染 + 胶水**(`assets/scripts/render|input|game/`):
   - sprites.ts(794 行,子代理移植,姿势数值保真)/ palette.ts / court.ts(简化版) /
     world.ts(视口+每帧重绘+飘字+拖尾+震屏)
   - pad/keyboard/touchpad 输入合成;game-root.ts 主循环组件(60Hz 固定步长+事件分发+HUD)
   - 全量严格类型检查零错误(tools/tsconfig.check.json + tools/cc-shim.d.ts 兜底)
4. **编辑器接入全部走文件层/CLI**(Cocos GUI 对自动化封闭,见坑):
   - `CocosCreator --project <路径>` 命令行直开工程
   - `main.scene` 手写(官方 2D 模板底版,Canvas+Camera+Widget,960×540)
   - **GameRoot 已挂到 Canvas**(手工按官方算法算压缩 uuid,构建产物证实正确)
   - 设置 960×540(settings/v2/packages/project.json)
   - `extensions/scene-opener`:编辑器每次启动自动打开 main 场景
5. **web-mobile 构建成功(31s)+ 真实浏览器运行验证**:本地 8899 服务 + Edge 打开,
   245 个请求全部成功,**29 个音效全部被加载 = GameRoot.start() 已执行,游戏在跑**。

## 必须知道的坑(新对话先读这段)

1. **Cocos 界面对自动化封闭**:Dashboard 和 Creator 的界面内容不在辅助功能树里
   (只有菜单栏),像素捕获也被新 macOS 拒绝。**一切编辑器操作走 CLI + 文件直改**
   (`--project` / `--build` / 改 scene/settings JSON / 扩展),不要浪费时间试 GUI 自动化。
2. **ZCode 内置浏览器(IAB)跑不了 Cocos 构建**:引擎内置资源加载在 IAB 里永远 hang
   (已插桩定位:builtinResMgr.loadBuiltinAssets → loadBundle('internal') 不回调)。
   验证游戏一律用真实浏览器(Edge 已验证可用)或编辑器预览。**这不是工程问题。**
3. **Bash 里 curl 走系统代理**(Clash 7897/7898):访问 localhost 必须 `--noproxy '*'`。
4. python http.server 可能只绑 IPv6;用 `--bind 127.0.0.1` 起本地服务。
5. **键盘输入待验证**:keyboard.ts 假设 Cocos 的 `EventKeyboard.keyCode` 值就是浏览器
   e.code 字符串('KeyA')。若真机按键无反应,先查这个(可能要换成 KeyCode 枚举对照)。
6. 头顶名牌/球衣号码没有文字(Graphics 画不了字):sprites.ts 里留了【移植限制】注释
   和坐标,需要表现层挂 Label。辉光/径向渐变有近似处理(同文件注释)。
7. 老仓库有意为之的行为差异(不是 bug):
   - rules 画球拖尾改为 `setTrailHook()` 注入(原版表现层依赖泄漏)
   - config 的 `serve` 段在原版定义了两次(前段是死值),已合并保留全部字段
8. `build/web-mobile` 的 index.html / 引擎 js 里有本次诊断插桩(MARK/SYS/DL 日志),
   重新构建即清除。
9. 编辑器当前**未运行**;重开会自动加载工程并自动打开 main 场景(scene-opener)。
   扩展日志在启动 stdout;构建日志示例 `--build "platform=web-mobile;debug=true;startScene=<场景uuid>"`。
10. 老仓库 `src/replay.js`(回放系统)未移植——低优先级,微信版可后置。

## 当前游戏形态

`GameRoot` 直进一局「单人 · 普通」(菜单 UI 未做),键盘 WASD+JK+S 与屏幕虚拟按键
均可用(键盘待验证),AI 对手会跑位/扣杀,计分/发球权/赛后金币经验结算都在跑,
音效已接(hit 八变体/floor 三档/cheer 三档/胜负 jingle 等),有 hitstop/震屏/飘字。

## 下一步(建议顺序)

1. **视觉验收**:用户看 Edge(127.0.0.1:8899,服务若停:`python3 -m http.server 8899
   --bind 127.0.0.1 --directory <build>/web-mobile`)或编辑器预览,报告画面偏差 → 修渲染。
2. **输入实测**:键盘/鼠标点虚拟按键各验一次(重点:KeyCode 值假设)。
3. **菜单/暂停/结算/生涯/训练面板 UI**(阶段 3,对齐老 ui*.js 的功能,按 mobileOnly 裁剪)。
4. **表现层打磨**:老 court.js 的 1272 行装饰(看台/灯光/主题)、镜头 punch/慢动作、
   粒子/彩带、名牌与球衣号 Label。
5. **BGM 烘焙**:老 bgm.js 分层编曲 → 离线烘焙 2~3 个强度档交叉淡入。
6. **微信小游戏构建**(构建面板/CLI 出 wechatgame 包;注册 AppID;个人主体发布需 ICP 备案;
   包体:代码+音效 ~1MB,主包 4MB 限制无压力)。
7. **安卓 APK**(JDK 17 + Android Studio + NDK r23~r25,路径不得含中文/空格;签名 keystore)。

## 老仓库 ↔ 新工程 模块对照

| 老仓库 | 新工程 | 状态 |
| --- | --- | --- |
| src/config-utils-physics-player-ai-rules-drill-career.js | assets/scripts/core/*.ts | ✅ 回归全绿 |
| src/render/sprites.js | render/sprites.ts + palette.ts | ✅(名牌文字待挂 Label) |
| src/render/court.js(装饰) | render/court.ts(简化版) | ⏳ 装饰未移植 |
| src/render/hud.js / drill-anim.js | game-root HUD 简版 | ⏳ |
| src/fx.js | game-root 内联精简版(hitstop/震屏/飘字) | ⏳ 完整特效 |
| src/input.js + 触屏 | input/ 三件套 | ✅ 待实测 |
| src/audio.js + bgm.js | game/sfx.ts + 已烘焙 WAV | ✅ 音效 / ⏳ BGM |
| src/ui*.js | — | ⏳ 阶段 3 |
| src/game.js | game/game-root.ts | ✅ 阶段 2 形态 |
| src/replay.js | — | ⏸ 后置 |
