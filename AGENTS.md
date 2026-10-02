# AGENTS.md — 嘟嘟羽毛球 Cocos 版开发指南

> 本文件供 AI 开发 Agent 阅读，帮助快速理解项目结构、开发规范与注意事项。

## 项目简介

**嘟嘟羽毛球(dudu-cocos)** 是一款基于 Cocos Creator 3.8.8 + TypeScript 的羽毛球游戏。
从老仓库 `嘟嘟02`(零依赖 canvas 版)重构而来,目标平台:**Android APK + 微信小游戏**。
老仓库保留为行为对照基准,手感以它为准。

- 当前版本:`0.0.19`(见 `package.json` 与 `assets/scripts/core/version.ts`;发版时由 dudu-release 联动递增)
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
| 改手机震动(触觉) | 强度表在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `haptic` 段(键名与 `fx` 六档同源,强度=时长×振幅两维);判据与排队在 [haptic.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/haptic.ts)(零 cc:`shotKey`/`plan`/`HapticGate`),平台出口在 [haptics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/haptics.ts)(Android 反射 `AppActivity.vibrate(ms,amp)` / 微信 `wx.vibrateShort` / Web `navigator.vibrate`,失败不静默 —— `hapticStatus()` 给设置页读数);Java 桥与能力探测在 `native/engine/android/app/src/com/cocos/game/AppActivity.java`;档位「轻/标准/强」在设置页声音画面 tab(存 `Settings.hapticLevel`),验收 `node .tools-build/tools/haptic-check.js`(+`--selftest`)。**改 Java 侧必须重打 APK 才生效** |
| 改 P5 视觉构件(尖刺环/星芒/斜切/飘字底板/斩劈 cut-in) | render 层 [p5kit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/p5kit.ts),UI 层 [ui-arcade.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-arcade.ts);规范见下方「开发规范」P5 条 |
| 改面板层配色/斜切档/色即功能 | 令牌唯一真话 [p5-tokens.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-tokens.ts)(零 cc:`C` 色板、`SLANT` 只许 3/5/6/10 四档、`ROLE` 六角色、`RARITY` 用 config 的 `RARITY_META`、`inkFor`/`contrast`、网点预算)。`ARCADE`/`PAL` 是它的再导出/派生,**别再抄一份色表** |
| 改面板形状(衬纸/大色块/卡片/凹陷槽/开关/滑杆/网点/印章) | 形状出点列 [p5-shapes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-shapes.ts)(零 cc),画笔 [p5-paint.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-paint.ts)(只 import cc 的 Color/Graphics ⇒ **node 跑得动**),ui-arcade 再导出。**卡片用 `drawP5Card`(墨面 + 一条色带)不要整面实底** —— 一屏十几张会排成彩虹,大色块留给少数大面。出图 `node .tools-build/tools/panel-preview.js --out .tools-build/panel-preview` |
| 改面板的可点件工厂 | [ui-shell.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-shell.ts) 的 `solidTab`/`solidBlock`/`sectionTitle`/`bevelSlot`/`pressable`(**一律自带 `addComponent(Button)`** —— 漏了就是「点了没反应」,闸门 `tools/ui-click-check.js`)。四面板经 `UiKit` 的 `plate/block/tab/title/slot/press` 取用 |
| 改四面板排版(设置/闯关大厅/训练场/商店) | 版式是零 cc 纯函数:`ui/settings-layout.ts`、`ui/campaign-layout.ts`、`ui/drill-layout.ts`、`ui/shop-shelf.ts`(`SHOP`/`shopTopBar`/`shopTabs`/`shopContent`/`shopStats`)。各导出 `XOverlaps()`/`XOverflow()` 判据,统一由 `node .tools-build/tools/panel-check.js`(+`--selftest`)断言:对比度 ≥4.0、网点 ≤900 点、可点件 ≥44、不撞不溢出、文案无 emoji 与桌面键名。**改任何一块坐标都要去判据里核** |
| 主循环/事件分发 | [game-root.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/game-root.ts) |
| UI 面板/菜单 | [ui-manager.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-manager.ts) |
| 作者通道(测试拉满档) | 对练屏连点**同一个**球馆 tab 6 下 → 等级满 + 金币 99999,**只在内存生效、本局不落盘**(重开退回原档,每次进应用要重新连点)。参数 `CFG.author`(发版想关掉置 `enabled: false`)、手势判定 `mode-screen.ts` 的 `MatchSetupScreen.authorTap()`(0.0.18 随球馆 tab 从主菜单迁来)、执行与沙箱 `career.maxOut()` / `career.sandboxed()` |
| 更新弹窗/更新说明排版 | [update-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/update-dialog.ts) + 折行算法 [release-notes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/release-notes.ts) |
| 改「调整位置」顶栏排版 | [editor-strip.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/editor-strip.ts)(纯函数,回归见 `tools/strip-check.ts`)+ [settings-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settings-panel.ts) 消费它 |
| 改闯关大厅/进度/「下一关」 | 关卡表与 `getNextStage()`·`getStageByNo()` 在 [campaign.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/campaign.ts);大厅(直达条、卡片「▶ 下一关」印章、tab 自动聚焦)在 [campaign-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/campaign-panel.ts);结算页那颗「下一关 ▶ 第 N 关」在 [settle-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-panel.ts) 的 `buildActions()`(按钮整排按场景重建);验收 `node .tools-build/tools/campaign-check.js` |
| 改闯关「战前简报」弹窗排版 | [brief-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/brief-layout.ts)(纯函数:折行 + 堆块 + 弹窗按内容长高,回归见 `tools/brief-check.ts`、出图 `tools/brief-preview.ts`)+ [campaign-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/campaign-panel.ts) 只照坐标摆 |
| 改虚拟按键能放在哪儿 | [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 的 `clampDelta`(唯一约束 = 整块留在可视区内) |
| 改技能键的冷却读数 | 浓度/几何/文案全在 [pad-cd.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad-cd.ts)(零 cc 依赖:`cdAlpha`·`cdArcs`·`cdText`·`drawCooldown`),取值在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `padSkin.cd` 段,[touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 只照参数摆笔 + 挂键心秒数 Label,剩余秒数由 `game-root.ts` 喂;回归 `node .tools-build/tools/pad-cd-check.js`、出图 `node .tools-build/tools/pad-cd-preview.js` |
| 改 AI 难度 | 档位表在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `diffs` 段(`read`=每记球只认定一次的站位误差 / `zone`=CPU 判定区 / `shotErr`=出球误差 / `composure`=落后是否变强),生效逻辑在 [ai.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/ai.ts),落档到球员在 `rules.ts` 的 `applyAiTier()`;验收 `node .tools-build/tools/ai-check.js`(三档胜负口径) |
| 改主动技能(5 款) | 技能表与专属数值在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `skills` 段,状态机在 [skills.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/skills.ts)(`canActivate` 点亮门槛 / `activate` 起手 / `update` 逐帧推进 / `modifyShot` 出球加成),起手演出在 `game-root.ts` 的 `onSkillCast()`;**换技能的入口** = 模式屏基类 `buildSkillBadge`(对练 / 无限练习)+ 闯关大厅标题行的技能胶囊,装备全局一份存 `Career.profile.equippedSkill`(不分模式);验收 `node .tools-build/tools/flash-check.js`(+ `--selftest` 反例必须被拦住)、出图 `node .tools-build/tools/flash-preview.js` |
| 改技能配置弹窗排版 | [skill-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-layout.ts)(纯函数:详情板折行 + 右对齐块按实测宽倒推 + 面板竖排留缝,回归见 `tools/skill-check.ts`)+ [skill-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-dialog.ts) 只照坐标摆 —— 卡片只留「标签/名字/CD/装备」,完整说明在底部详情板,点卡片切换 |
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
- **视觉语言 = P5(女神异闻录)风**:尖刺/锯齿/星芒/斜切/撕纸边,拒绝光滑圆圈与裸排飘字。UI 层构件在 [ui-arcade.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-arcade.ts)(ARCADE 色板:斩劈红 `#e60012`/荧光黄/墨黑/纸白),render 层构件在 [p5kit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/p5kit.ts);两者「同形不同源」是有意复制 —— render 不反向 import ui,颜色一律由调用方传入。随机形状(锯齿环等)**出生时用 `mulberry32(seed)` 定形,逐帧只做缩放与 alpha 衰减,禁止逐帧 rand**(会抖成噪点)。性格区分:打击=尖刺,引力/时空=平滑圆,别混。新增特效数值照旧只进 `config.ts` 的 `fx` 段。
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

# 4.2 真人可赢性回归(exit 0;三档 AI 的胜负口径 —— 脚本化"真人替身"打完一整局:
#     得分率必须 easy > normal > hard 单调拉开,easy 要 ≥55%(否则又是"怎么都赢不了"),
#     回合均值 ≥10 拍作护栏(削弱过头会把回合打成三五拍)。替身强弱有标定段,改任何
#     diffs.* 数值都要重跑;加样本 AI_CHECK_MATCHES=25)
node .tools-build/tools/ai-check.js

# 4.5 反应预算与输入画像(exit 0;把「手机接不到球」统一成帧的账:
#     §1 球速档位是否真的只改时间不改空间 —— 有人砍 shot.speedMax 来放慢会在这里红,
#     §2 各档判定区放宽多少,§3 slack(剩帧−跑位帧−提前量),§4 键盘/摇杆/滑轨三画像
#     跑位帧与横滑提交延迟,§5 移速档 × 球速档的组合矩阵(挑"手机合适"就照这张表)。
#     改 pace/gait/physics/player 输入相关数值后必跑)
node .tools-build/tools/reach-check.js

# 4.6 技能系统与闪现必中回归(exit 0;「在 高度 × 站位 × 来球速度 × 两侧」150 格网格上
#     逐格按技能,断言:一定打出扣杀、不挥空、落点在对方场内、按完 ≤24 帧出球、命中即消耗
#     保底窗口;另外钉住该拒绝的场合(自家球/低球/隔网球/冷却中)与"蓄力期球真的被按住"。
#     改 skills/player/rules 任一技能路径、或改 swing.pivotY·radius*(判定区几何)都要跑。
#     --selftest 跑反例:旧闪现那个"球上方 15px"的落位必须被判定位拒绝,否则本工具没牙齿)
node .tools-build/tools/flash-check.js
node .tools-build/tools/flash-check.js --selftest
node .tools-build/tools/flash-preview.js --out .tools-build/flash-preview   # 折跃六帧出图

# 4.7 闯关进度与「下一关」判据(exit 0;大厅直达条、卡片「▶ 下一关」印章、
#     结算页「下一关 ▶ 第 N 关」三处全押在 CampaignManager.getNextStage/getStageByNo 上,
#     算歪不会崩、只会安静地不好用。断言:20 关表自洽(编号连续/四场景各 5 关/章节↔场景
#     对应/文案与奖励齐活)、逐关推进严格 +1、回头重打不推进、全通返回 null、
#     tab 自动聚焦不藏关。改 campaign.ts 关卡表或那两个判据都要跑)
node .tools-build/tools/campaign-check.js
node .tools-build/tools/campaign-check.js --selftest   # 五份改坏的关卡表必须被报警

# 4.8 触觉(手机震动)分级与排队回归(exit 0;用户现场:「设置里打开了震动反馈,
#     手机上根本没有用」。链路本来就是通的 —— APK 里有 AppActivity.vibrate、清单里有
#     VIBRATE 权限、反射写法与引擎自身一致;坏在两处看不见的地方:①只有时长没有振幅,
#     旧 light=12ms 在线性马达上基本无感;②裸 catch{} 把一切失败吞成"没反应"。
#     断言:全部时机 ms ∈ [floor,cap] / amp ∈ [1,255]、击球五档 power 严格单调、
#     无感地板 ≥18ms、shotKey 普通档必须返回 null(=不震,这条判据不许散进调用点)、
#     无马达不发、无振幅控制时强度差折进时长且仍单调、同帧「完美重扣+得分」两段都得
#     播出(旧 60ms 一刀切会吞掉第二下)、同键连打只响一次、队列有上限。
#     改 config.ts haptic 段任一值、改 core/haptic.ts、或动 game/haptics.ts 都要跑)
node .tools-build/tools/haptic-check.js
node .tools-build/tools/haptic-check.js --selftest   # 反例(旧 MS={light:12} / 旧同帧直接 return)必须被报警

# 5. AI 对 AI 整机冒烟(exit 0)
node .tools-build/tools/sim-check.js

# 6. 更新弹窗「更新说明」折行/溢出回归(exit 0)
node .tools-build/tools/notes-check.js

# 6.5 「调整位置」顶栏排版回归(exit 0;透明度滑杆曾被重置/完成两颗按钮压在底下,
#     用户看到的是「没有透明度滑杆」—— 一行六件事别手调绝对坐标,见 editor-strip.ts)
node .tools-build/tools/strip-check.js
node .tools-build/tools/strip-check.js --selftest   # 反例必须被报警,防规则脚本悄悄全绿

# 6.6 闯关「战前简报」弹窗排版回归(exit 0;20 关全表逐关排版 —— 文案长短差 3 倍,
#     手调坐标 + Label 不换行曾把说明糊到弹窗外、三条三星目标互相重叠。
#     断言:不出内边距 / 不压字 / 框高 <= 红线(再高顶穿大厅面板)/ 块结构不跑偏。
#     改 campaign.ts 任一关的 desc·hint·starsGoal,或改 brief-layout 的字号行高间距,都要跑)
node .tools-build/tools/brief-check.js
node .tools-build/tools/brief-check.js --selftest   # 反例必须被报警
node .tools-build/tools/brief-preview.js --out .tools-build/brief-preview   # 出 SVG,再用 headless Chrome 光栅化 eyeball(青色游标 = 算出来的行尾)

# 6.8 技能配置弹窗排版回归(exit 0;卡片只有 118 宽,而五句说明实测 198~321px ——
#     Label 没设 overflow 时 contentSize 一律被忽略,五句各按一条无限宽的行画,
#     互相盖字(用户拍的现场图)。现在说明整条搬进底部 652 宽详情板,15 号字一行读完。
#     断言:面板竖排(标题/卡片/详情板/完成)互不压字且都在面板内 / 卡片内竖排各留其位
#     (这条就是"说明为什么塞不回卡片")/ 5 技能 × 解锁与否 × 装备与否全组合不出内容列、
#     四项不压字、需求板高 <= 现高(= 切换技能时面板尺寸不变的算术保证)/ 说明不超行数上限。
#     改 config.ts 技能表任一 desc·cooldownFrames·unlockLevel,或改 skill-layout 的字号
#     行高间距,都要跑)
node .tools-build/tools/skill-check.js
node .tools-build/tools/skill-check.js --selftest   # 反例(旧版真实写法 + 手挑坐标)必须被报警
node .tools-build/tools/skill-check.js --preview    # 打详情板行表

# 6.9 技能键「冷却读数」回归(exit 0;用户现场:「透明度调低之后冷却都看不太清了」——
#     旧写法冷却层每一笔直接乘 Settings.padAlpha,滑杆 0.2 时墨底只剩 0.116,
#     合成到亮场上和就绪态那颗键亮度只差 10%,读出来就是「这颗键坏了」。
#     现在浓度走 cdAlpha(留 0.8 下限),外加键心「还剩几秒」。
#     断言:①滑杆全程浓度下限 ②按引擎真实的 sRGB 通道合成比亮度(冷却态压得下去、
#     环与数字提得起来)③三段弧全按递减排且名义跨度 = 实际跨度(见坑 8)④键心数字
#     随半径缩放、不与键名标签叠字、不出圆 ⑤冷却中永不显示 0.0。
#     改 config.ts padSkin.cd 任一值、改 pad-cd.ts、或动 touchpad 的冷却分支,都要跑)
node .tools-build/tools/pad-cd-check.js
node .tools-build/tools/pad-cd-check.js --selftest   # 旧写法(线性浓度 / 递增弧度 / 写死字号)必须被报警
node .tools-build/tools/pad-cd-preview.js --out .tools-build/pad-cd-preview   # 三档透明度 × 两种背景出图,末列是旧写法对照

# 7. 面板退场的触摸卫生(exit 0;遮罩/可视窗那种裸 TOUCH 监听不随 hide 卸掉,
#    关掉的面板就成一块隐形挡板 —— 曾把无限模式整局按键打死。
#    另钉 ui-arcade 两条契约:fadeOutHide 收触摸必须排在 fadedOut 短路之前、
#    cancelFade 放行必须跳过自己已淡出收起的子树 —— 少一条,闯关大厅重开就是
#    「什么都点不动」(opacity 0 不参与命中判定,只有 active=false 才不吃))
node .tools-build/tools/ui-hide-check.js
node .tools-build/tools/ui-hide-check.js --selftest   # 反例(修好之前的真实写法)必须被报警

# 7.2 点击链路卫生(exit 0;用户现场:「对练屏点这个切换场地、还有切换技能都没有反应了」。
#     根因不是遮挡也不是挡板 —— 那两处只有 UITransform+Graphics,却挂着
#     `on(Button.EventType.CLICK)`:click 只由 Button._onTouchEnded 派发,TOUCH_* 监听也只由
#     Button._registerNodeEvent 注册,所以这种节点连命中判定都进不去(既不响也不吞触摸)。
#     症状因此很挑:同屏装了 Button 的块(返回/三档难度)全好,唯独漏挂的那一排死。
#     断言:凡 `const X = new Node(` 又 `X.on(...CLICK)` 的,必须见过 `X.addComponent(Button)`
#     或被传进一个「会往参数上装 Button」的助手(pressable/solidBlock 这类,自动识别)。
#     与 7 正好互补:那边管「有监听却没卸」,这边管「根本没有触摸入口」。
#     改 UI 里任何手搓节点(0.0.18 从 main-menu 的 card() 迁到 mode-screen 时就把那行迁丢了))
node .tools-build/tools/ui-click-check.js
node .tools-build/tools/ui-click-check.js --selftest   # 反例(漏挂 Button 的真实写法)必须被报警
node .tools-build/tools/ui-click-check.js -v           # 每文件明细:已装/工厂免检/链式不追/报警

# 7.4 P5 面板语法闸门(exit 0;四面板大色块改版的地基。防的是四类**不会崩、只会安静地
#     难看/难点**的坏:①面色与字色对比不够 —— 商店旧 tab 是 navy2 底 + 白 5% 描边,约
#     1.1:1,用户读出来是「这一格坏了」而不是「没被选中」;②网点超预算 —— 这套语法里
#     唯一按面积堆绘制量的件,只准压标题带,铺满整块衬底 1566 点会拖死中低端机;
#     ③行距撞字 —— 开关/滑杆抬到触控下限 44 后,手写行距会重叠几个 px,屏幕看不出、
#     按下就是错档;④emoji 与桌面键名 —— 原生无彩色 emoji 字体(🔒 变方框),手机上
#     「[K / 左键]」是无效指令。断言吃 p5-tokens 与四个 layout 模块的真实数据;
#     --selftest 喂**改动前的真实旧写法**,必须全被拦下 —— 否则这套尺子没牙齿)
node .tools-build/tools/panel-check.js
node .tools-build/tools/panel-check.js --selftest
node .tools-build/tools/panel-preview.js --out .tools-build/panel-preview   # 语法样张 + 四面板拼装(与真机同一批多边形,可直接 Chrome 出 PNG)

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

修改源码后必须把改动追加写入 [CHANGELOG.md](CHANGELOG.md)(gitignored,仅本地)。最新日期在最上,条目头一句话概述(写明用户指令或现场问题),子项用 Added/Changed/Fixed/Removed/Verified 标签并附文件路径。会话收尾前补记,未提交也要记(标注「未提交」)。

**记录要简洁** —— 每个子项一句话:做了什么 + 涉及哪个文件。**不要**写根因分析、设计推导、量化数字、并发提示、未验到的长篇讨论(那些留在会话里或代码注释里)。Verified 只列回归项与 exit 状态,不铺陈数据。一条改动的 changelog 通常三五行就够,读者要的是「改了什么、过没过」,不是「为什么这么改」。

## 必须知道的坑

1. **Cocos 编辑器对自动化封闭** — 界面不在辅助功能树里,像素捕获也被 macOS 拒绝。一切编辑器操作走 CLI + 文件直改。
2. **ZCode 内置浏览器跑不了 Cocos 构建** — 引擎内置资源加载在 IAB 里永远 hang,验证游戏用真实浏览器或编辑器预览。
3. **Bash 里 curl 走系统代理** — 访问 localhost 必须 `--noproxy '*'`。
4. **python http.server 可能只绑 IPv6** — 用 `--bind 127.0.0.1` 起本地服务。
5. **名牌文字用 Label(世界坐标),球衣号已去除** — sprites.ts 画不了字,径向渐变用描边环近似。
6. **老仓库有意差异(不是 bug)** — rules 拖尾改为 `setTrailHook()` 注入;config `serve` 段原版定义两次已合并。
7. **改 Android 应用名要改构建脚本** — 手机安装界面显示的名字是「嘟嘟羽毛球」,由 `.agents/skills/export-apk/scripts/build.sh` 每次构建用 sed 注入到产物 `build/android/proj/res/values/strings.xml`。源文件 `native/engine/android/res/values/strings.xml` 是**空的**,在那儿改没用(会被覆盖且不生效)。版本号联动规则见 dudu-release skill。
8. **`Graphics.arc` 传 `a1 > a0` 画不出那一段,画的是它的补集** — 引擎 `cocos/2d/assembler/graphics/helper.ts` 在 `counterclockwise=false` 时执行 `while (da > 0) da -= PI*2`,把 da 规范进 `(-2π, 0]`。所以想要「从 a 扫过 b」的短弧,要么把角度排成**递减**(终点 < 起点,`pad-cd.ts` 的 `cdArcs` 就是这么排的),要么传 `counterclockwise=true`。踩中的症状是「100° 的弧变成 260° 的一圈」,不报错也不 NaN。另两条同源的:`fill()` **不清路径**(只有下一个路径指令才推进 pathOffset),所以 `circle(); fill(); stroke();` 是一笔两用;而 `tools/cc-stub.ts` 的记录型 Graphics 会清,预览里同一形状要记两遍。UI 本地 y 向上 ⇒ 12 点是 `+π/2`,`-π/2` 是正下方。

## 尚未移植

- ⏳ 微信小游戏构建(无 build-wechat 配置;需要 AppID 与域名白名单)
