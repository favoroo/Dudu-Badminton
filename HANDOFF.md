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
6. 头顶名牌文字已由表现层 Label 实现(world.ts syncTags,sprites.ts 预留的【移植限制】已闭环);
   **球衣号已按设计决策去掉**(人物身上不再有数字)。辉光/径向渐变用描边环近似(同文件注释)。
7. 老仓库有意为之的行为差异(不是 bug):
   - rules 画球拖尾改为 `setTrailHook()` 注入(原版表现层依赖泄漏)
   - config 的 `serve` 段在原版定义了两次(前段是死值),已合并保留全部字段
8. `build/web-mobile` 的 index.html / 引擎 js 里有本次诊断插桩(MARK/SYS/DL 日志),
   重新构建即清除。
9. 编辑器当前**未运行**;重开会自动加载工程并自动打开 main 场景(scene-opener)。
   扩展日志在启动 stdout;构建日志示例 `--build "platform=web-mobile;debug=true;startScene=<场景uuid>"`。
10. 精彩即时回放已于 2026-09-30 整条链路删除(core/replay.ts、设置项 replayMode、
    转播水印/暗角、全屏跳过挡板)—— 用户判定它对体验没有提升。慢动作(slowmo)与
    hitstop 定格不受影响,仍在 config.fx.slowmoEnabled 总闸下。

## 当前游戏形态

完整产品形态:主菜单/暂停/结算/生涯商店/训练场/设置/更新弹窗全套 UI;4 套球场主题
(arena/beach/cyber/dojo)+ 看台/灯光/晃网;六档打击阶梯(hitstop/震屏/镜头 punch/白闪)、
赛点重锤慢动作 + 长回合金晕 + 赛点红晕氛围暗角;
球残影四风格 + 挥拍弧光残影;自适应分层 BGM;AI 情绪/赛后称号/多拍里程碑/发球博弈;
Android 应用内更新(APK 原生流式下载器 + 多源回退)。

## 下一步(建议顺序)

1. **表现层验收**:真实浏览器打开 127.0.0.1:8899,验证镜头 punch/慢动作/白闪/氛围暗角/
   完美重扣打击反馈/弧光残影/球残影四风格的手感与观感。
2. **输入实测**:键盘/鼠标点虚拟按键各验一次(重点:KeyCode 值假设)。
3. **微信小游戏构建**(构建面板/CLI 出 wechatgame 包;注册 AppID;个人主体发布需 ICP 备案;
   包体:代码+音效 ~1MB,主包 4MB 限制无压力)。
4. **安卓 APK 发版**(dudu-release 流程;版本号必须 +1)。

## 老仓库 ↔ 新工程 模块对照

| 老仓库 | 新工程 | 状态 |
| --- | --- | --- |
| src/config-utils-physics-player-ai-rules-drill-career.js | assets/scripts/core/*.ts | ✅ 回归全绿 |
| src/render/sprites.js | render/sprites.ts + palette.ts | ✅(名牌 Label 已挂,球衣号去除) |
| src/render/court.js | render/court.ts(4 主题/看台/灯光/晃网) | ✅ |
| src/render/hud.js / drill-anim.js | render/hud-overlay.ts / drill-anim | ✅ |
| src/fx.js | render/fx.ts + world.ts 镜头四件套/白闪/氛围暗角 | ✅ |
| src/replay.js | — | ❌ 已删除(回放对体验无提升) |
| src/input.js + 触屏 | input/ 三件套 | ✅ 待实测 |
| src/audio.js + bgm.js | game/sfx.ts + game/bgm.ts + 烘焙 WAV | ✅ |
| src/ui*.js | ui/ 全套面板 + ui-arcade | ✅ |
| src/game.js | game/game-root.ts | ✅ |
