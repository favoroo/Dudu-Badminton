# AGENTS.md — 嘟嘟羽毛球 Cocos 版开发指南

> 本文件供 AI 开发 Agent 阅读,帮助快速理解项目结构、开发规范与注意事项。
> 设计动机与判据细节写在对应代码文件头注释与 `tools/*.ts` 文件头,不在此抄录。

## 项目简介

**嘟嘟羽毛球(dudu-cocos)** 是一款基于 Cocos Creator 3.8.8 + TypeScript 的羽毛球游戏。
从老仓库 `嘟嘟02`(零依赖 canvas 版)重构而来,目标平台:**Android APK + 微信小游戏**。
老仓库保留为行为对照基准,手感以它为准。

- 版本号见 [package.json](file:///Users/a1/Documents/01Code/dudu-cocos/package.json) 与 [version.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/version.ts)(发版时由 dudu-release 联动递增,本文件不抄)
- 设计分辨率:960×540,FIXED_HEIGHT 适配
- 包名:`com.dudu.badminton`
- 远端仓库:GitHub `favoroo/Dudu-Badminton` + Gitee `favo9/dudu-badminton`

## 快速定位

| 要做什么 | 去哪里看 |
|---------|---------|
| 调手感/数值 | [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) |
| 理解分层铁律 | [types.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/types.ts) 顶部注释 |
| 改物理/弹道 | [physics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/physics.ts) |
| 改球速/接球难度 | 档位表 `config.ts` 的 `pace` 段;生效逻辑 [pace.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/pace.ts)(时间膨胀:重力 ×s²、速度 ×s、阻力不动);设置页「球速」滑杆存 `Settings.paceTier`,下一球起生效 |
| 改人物移速 | 档位表 `config.ts` 的 `gait` 段;生效逻辑 [gait.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/gait.ts);**只乘真人的 accel+vmax**(AI 走 `diffs.speed`,两层不叠),即时生效 |
| 改角色姿势/外观 | [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) |
| 改「谁穿谁的皮肤」(渲染入参副本) | [view-cache.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/view-cache.ts) 的 `viewOf(cache, 实体)` —— **副本必须按实体各存一份**,共享一个 `{}` + `Object.assign` 就是「CPU 蓝球衣顶着一头别人的橙发」的源头(只拷源对象自己有的键);身份比较走 `entityOf()`;闸门 `view-leak-check` |
| 改传说皮肤「脚下法阵」 | 画法 [aura.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/aura.ts)(零状态,只画不算),数值与配色在 `config.ts` 的 `fx.aura` 段;**别再画光滑椭圆环**(与全站 P5 语汇相反);验收 `aura-preview` |
| 改击打/轨迹/球体特效 | 数值在 `config.ts` 的 `fx` 段;丝带 [ribbon.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/ribbon.ts) + 球体运动学 [shuttle-motion.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/shuttle-motion.ts) + 粒子 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts) + 缓动 [easing.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/easing.ts);出图 `fx-preview` |
| 改胜利礼花/终局庆祝时钟 | 弹道与喷口在 `config.ts` 的 `fx.confetti` 段,池与画法在 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts);时钟档位纯函数 [celebration.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/celebration.ts);验收 `confetti-check` |
| 改手机震动(触觉) | 强度表 `config.ts` 的 `haptic` 段;判据与排队 [haptic.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/haptic.ts);平台出口 [haptics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/haptics.ts);Java 桥在 `native/engine/android/app/src/com/cocos/game/AppActivity.java`。**改 Java 侧必须重打 APK**;**Android 12+ 需显式声明 `USAGE_PHYSICAL_EMULATION`**(否则被归到 TOUCH 档跟着系统总闸走,静默丢掉不抛异常);波形形状这一层做过又撤了(恒幅 one-shot 是已知取舍,别再加 steps/preset);验收 `haptic-check` |
| 改 P5 视觉构件 | render 层 [p5kit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/p5kit.ts),UI 层 [ui-arcade.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-arcade.ts) |
| 改面板层配色/斜切档 | 令牌唯一真话 [p5-tokens.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-tokens.ts)(`C` 色板、`SLANT` 只许 3/5/6/10 四档、`ROLE` 六角色);`ARCADE`/`PAL` 是它的派生,**别再抄一份色表** |
| 改面板形状 | 形状出点列 [p5-shapes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-shapes.ts),画笔 [p5-paint.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-paint.ts)(只 import cc 的 Color/Graphics ⇒ node 跑得动);**卡片用 `drawP5Card`(墨面+色带)不要整面实底**;出图 `panel-preview` |
| 改面板的可点件工厂 | [ui-shell.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-shell.ts) 的 `solidTab`/`solidBlock`/`pressable`(**一律自带 `addComponent(Button)`** —— 漏了就是「点了没反应」,闸门 `ui-click-check`) |
| 改四面板排版 | 零 cc 纯函数:`settings-layout.ts`、`campaign-layout.ts`、`drill-layout.ts`、`shop-shelf.ts`;各导出 `XOverlaps()`/`XOverflow()` 判据,统一由 `panel-check` 断言(对比度/网点/触控/溢出/文案)。**改坐标要去判据里核** |
| 改「移动方式图示」 | [pad-diagram.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/pad-diagram.ts)(零 cc,几何全现读真值,不许另抄一份);判据在 `panel-check` ⑨,出图 `pad-diagram-preview` |
| 改新手操作教学 | 状态机 [tutorial.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/tutorial.ts)、版式 `tutorial-layout.ts`、演示真值烘焙 [tutorial-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/tutorial-demo.ts)、手势演示动画 [tutorial-anim.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/tutorial-anim.ts)、面板 `tutorial-panel.ts`;文案表 `TUTORIAL_TOPICS` 在 config.ts;验收 `tutorial-check` |
| 改训练场引导演示 | 演示真值 [drill-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/drill-demo.ts)(零 cc,沿真实喂球弧线搜接触点,回球必须过 `Drill.matches`),动画 [drill-anim.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/drill-anim.ts),面板 `drill-panel.ts`;分步文案在 `config.ts` 的 `DRILLS[].demoSteps`;验收 `drill-diagram-check` |
| 主循环/事件分发 | [game-root.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/game-root.ts) |
| UI 面板/菜单 | [ui-manager.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-manager.ts) |
| 作者通道(测试拉满档) | 对练屏连点**同一个**球馆 tab 6 下 → 等级满 + 金币 99999,**只在内存生效、本局不落盘**;参数 `CFG.author`(发版想关掉置 `enabled: false`)、手势判定 `mode-screen.ts` 的 `authorTap()`、执行 `career.maxOut()` |
| 改更新链路 | 入口在设置「关于」页 + 冷启动 24h 静默检查(`main-menu.ts` 的 `show()`);弹窗 [update-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/update-dialog.ts);候选源与原生下载器 [update-service.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/update-service.ts);发布页直链 `releasePageUrl()` 在 [version.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/version.ts)(Gitee releases API **不返回 html_url**)。弹窗挂 Canvas 并在 `show()` 里抬到最上层(否则被晚到的兄弟节点暗底压死) |
| 改更新说明排版 | [release-notes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/release-notes.ts),验收 `notes-check` |
| 改结算屏字 | [settle-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-panel.ts);`unlocked` 是 `SkinDef[]`,拼字符串必须先 `map(s => s.name)`(闸门 `text-object-check`) |
| 改结算谢幕演出 | 时间轴纯函数 [settle-cine.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-cine.ts),消费 `settle-panel.ts` 的 `playCine`;数值在 `config.ts` 的 `fx.settleCine` 段;验收 `settle-cine-check` |
| 改「调整位置」顶栏 | [editor-strip.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/editor-strip.ts)(纯函数),验收 `strip-check` |
| 改闯关大厅/进度/「下一关」 | 关卡表与 `getNextStage()`/`getStageByNo()` 在 [campaign.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/campaign.ts);大厅 [campaign-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/campaign-panel.ts);验收 `campaign-check` |
| 改闯关「战前简报」弹窗 | [brief-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/brief-layout.ts)(纯函数)+ `campaign-panel.ts` 摆;验收 `brief-check` + `brief-preview` |
| 改虚拟按键能放在哪儿 | [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 的 `clampDelta`(唯一约束 = 整块留在可视区内) |
| 改击球键滑动手势(左/右=落点深浅,上/下=弧线高低) | 双轴判定 [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) `trackSwingSwipe` → 数据池 [pad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad.ts) → [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) `swingAim`/`swingLoft` → `buildShot`;数值在 `config.ts` `touchAim`/`shot.loftUpMinDeg·loftDownMaxDeg`。**短滑管一拍,长滑管到取消**(参考和平精英长滑锁定):越过 `touchAim.lockPx/lockPxY` 锁定该轴(`pad.swingLockX/Y`,写入/取消 toggle 在 `pad.lockSwingAxis`),之后每拍自动按锁向打,沿锁向再长滑=取消、反向长滑=换向、锁定中短滑=例外一拍;恢复路只有两条 —— `press("swing")` 与收招钩子 `restoreSwingAim`(经 `Player.consumeAutoAim` 的 `onAimConsume`),都把两轴恢复成锁值(没锁=0,即旧行为);换局 `resetPadHolds` 清锁。锁定视觉 = 键缘方向弧常亮(game-root 的 `setAimEcho` 在「辅助开 或 有锁」时喂 pad 真值)+ 锁定/取消瞬间方向色冲击环。验收 `swipe-vertical-check` + `input-check`(⑩/⑩b)+ `auto-hit-check`(⑩⑪) |
| 改技能键冷却读数 | [pad-cd.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad-cd.ts)(零 cc:`cdAlpha`/`cdArcs`/`cdText`/`drawCooldown`);取值 `config.ts` 的 `padSkin.cd` 段;验收 `pad-cd-check` + `pad-cd-preview` |
| 改 AI 难度 | 档位表 `config.ts` 的 `diffs` 段(`read`/`zone`/`shotErr`/`composure`);生效逻辑 [ai.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/ai.ts),落档 `rules.ts` 的 `applyAiTier()`;验收 `ai-check`(三档胜负口径) |
| 改「影分身」(会累积的影子防线) | 用户口径 2026-10-05:「上一局的影分身可以保留到下一局，场上最多可以有三个影分身，不同影分身上的颜色是不一样的」+「保持三球额度，但只剩一次的话下个回合恢复成三次」。**四条口径别改回去**:① 边界是**跨回合(一分)**,不跨对局、**不落盘**(重开新局靠 `R.players = []` 整批丢)② `resetPoint` 只给 `hits < maxHits && despawnT <= 0` 的分身补满 —— 接满三球正在消散的那个绝不复活 ③ 上限 = `CFG.skills.shadow.slots.length`,**不单开 maxClones 键** ④ 本体恒纯黑,三色只加在辉光/pips/头圈/拍框/粒子。状态 `Player.shadowClones: ShadowCloneState[]`(恒按 `slot` 升序),**slot 才是身份**(颜色/防区/AI 档全查 `slots[slot]`;用数组长度当 slot 会让"死一个集体变色")。色走 `entity.theme.glow` 这条老通道(spawn 写、渲染读,不新增跨层字段),真话在 `config.skills.shadow.slots[].tint`。**三枚各守一块防区**(`homeOffset` 后场/中场/网前):不分区就是三坨剪影叠在同一个拦截点,颜色看不出、9 份额度砸在一块地面 —— 分段边界按相邻 homeX 中点现算(`Shadow.dutyIndex`),**别另抄一份阈值**。门控 + 槽位算术在叶子模块 [shadow-gate.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/shadow-gate.ts)(skills 不能 import shadow 会成环;门控必须进 `canActivate`,否则就是"键亮着按了没反应"),训练场/教学/2p/2v2 **不许召**:`drill.ts` 的 `matches()` 判的是 lastHitter 的**队**不看谁打的。画法在 [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) 的 `drawShadowClone`(world 与 frame-cost 共用同一个函数,别在预览里另抄一份)。⚠ 这次是**单向增强**(ai.ts 没有 shadow 分支 ⇒ AI 拿不到;ai-check/serve-check/sim-check 的替身从不按技能键 ⇒ 三把尺子全量不到),强度看 `shadow-balance-check`。验收 `shadow-check`(+`--selftest` 13 份反例)、`shadow-preview`(+`--selftest` 5 份)、`shadow-balance-check`、`frame-cost-check`(满编档 307 笔/帧) |
| 改主动技能(7 款) | 技能表与数值 `config.ts` 的 `skills` 段;状态机 [skills.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/skills.ts)(`canActivate`/`activate`/`update`/`modifyShot`);一键代拍择帧 `Player.autoSwingDue` 在 [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts);起手演出 `game-root.ts` 的 `onSkillCast()`。**两条铁律**:① 球种预告 `previewKind` 与实打共用同一条 `buildShot`,靠 `HitOpt.preview` 分流 —— 往 `modifyShot` 加任何状态消耗(`buffT`/`lungeShotT`/`flashStrikeT`/`magnetPulling`/`rage`)或记账必须过 `!preview` 闸,漏一处就是「按了没反应」;② 凡是"替真人打"的机制一律 `!p.isAI` 闸(AI 也装技能也会自己按键,而 serve-check/ai-check 的真人替身从不按技能键 ⇒ 那两把尺子量不到)。各款分别验收:闪现 `flash-check`、重击 `smash-check`、怒气 `rage-check`、跨步 `lunge-check`、时空 `focus-check`、自动击打 `auto-hit-check`、影分身 `shadow-check` |
| 改技能配置弹窗排版 | [skill-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-layout.ts)(纯函数)+ [skill-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-dialog.ts);验收 `skill-check` |
| 改音效映射 | [sfx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/sfx.ts) |
| 改背景音乐 | [bgm.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/bgm.ts);**BGM 唯一烘焙源是 `tools/bake-bgm.ts`**(bake-bgm → bgm-check → oggify,分发格式 ogg);验收 `bgm-check` |
| 改启动图/应用图标 | [make-app-icons.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/make-app-icons.py) 出图标母版 → [make-splash.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/make-splash.py) 派生启动图 → [apply-splash.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/apply-splash.py) 注入构建;闸门 `splash-check.py` |
| 跑回归测试 | 见下方「回归测试」段 |
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
- **严禁自动 `git commit` / `git push`** — 日常改动一律留在工作区,只有用户明确指示才执行(细则见 dudu-release skill)。
- **Agent 自己拉起的长驻辅助进程,用完必须关掉** — headless Chrome(`--headless=new --remote-debugging-port=93xx --user-data-dir=/tmp/...`)、本地静态服务等不会随会话退出:父 shell 一退就被 launchd 收养成孤儿继续吃 CPU。启动时记 PID、会话收尾前 `kill`;接手环境先 `ps aux | grep -E "headless.*user-data-dir=/tmp|http\.server"` 清一轮。仓库 tools/ 的一次性出图脚本(`--headless --screenshot`)跑完自退,不在此列。
- 模块间用 ES Module import/export,不使用全局命名空间。
- 每个模块文件顶部有 `// ============` 注释块说明设计动机 — **改代码前先读注释**。
- canvas → cc.Graphics 的移植约定见 [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) 顶部注释。
- `core/utils.ts` 不许 import cc,存储后端通过 [host.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/host.ts) 的 `installStorageBackend()` 注入,必须在任何 `load()` 之前调用。
- 音效(sfx/*.wav)由 `tools/bake-audio.ts` 烘焙;BGM 唯一烘焙源是 `tools/bake-bgm.ts`(bake-bgm → bgm-check → oggify)。音效/音乐开关统一读 [settings.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/settings.ts),模块不应有自己的静音状态。
- **视觉语言 = P5(女神异闻录)风**:尖刺/锯齿/星芒/斜切/撕纸边,拒绝光滑圆圈与裸排飘字。UI 构件 [ui-arcade.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-arcade.ts)(ARCADE 色板:斩劈红 `#e60012`/荧光黄/墨黑/纸白),render 构件 [p5kit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/p5kit.ts);两者「同形不同源」是有意复制 —— render 不反向 import ui,颜色一律由调用方传入。随机形状**出生时用 `mulberry32(seed)` 定形,逐帧只做缩放与 alpha 衰减,禁止逐帧 rand**。性格区分:打击=尖刺,引力/时空=平滑圆,别混。
- 角色改姿势后必须跑 pose-preview 检查:
  ```bash
  npx tsc -p tools/tsconfig.json && node .tools-build/tools/pose-preview.js --out .tools-build/pose-preview
  ```

## 回归测试

一键跑全部(`npm test` = 编译 + [test-all.mjs](file:///Users/a1/Documents/01Code/dudu-cocos/tools/test-all.mjs)):44 个 check + 29 个 `--selftest`,任何非零都算失败。**[test-all.mjs](file:///Users/a1/Documents/01Code/dudu-cocos/tools/test-all.mjs) 是「哪些工具存在且必须绿」的唯一事实源**,加新 check 记得登记。

改了具体模块后,可单独跑对应的 check(源在 `tools/`,编译后产物在 `.tools-build/tools/`):

| 改了什么 | 跑哪个 check |
|---------|-------------|
| 物理/弹道 | `probe` |
| 训练场六关 | `drill-check` |
| 引导演示真值/出图 | `drill-diagram-check` + `drill-diagram-preview` |
| AI 接发/可赢性 | `serve-check` + `ai-check` |
| 反应预算/输入画像 | `reach-check` |
| 闪现必中 | `flash-check` |
| 重击附魔/一键代拍 | `smash-check` |
| 怒气重击 | `rage-check` |
| 跨步自动回球 | `lunge-check` |
| 自动击打(辅助) | `auto-hit-check` |
| 时空减速 | `focus-check` |
| 影分身 | `shadow-check`(+selftest) + `shadow-preview`(+selftest) + `shadow-balance-check`(强度上界) + `frame-cost-check`(满编档) |
| 击球键纵向手势 | `swipe-vertical-check` |
| 网前击球/物理判定 | `net-shot-check` |
| AI 体力账本 | `stamina-check` |
| 闯关进度/下一关 | `campaign-check` |
| 触觉(震动) | `haptic-check` |
| BGM 结构 | `bgm-check` |
| AI 对 AI 冒烟 | `sim-check` |
| 更新说明折行 | `notes-check` |
| 调整位置顶栏 | `strip-check` |
| 战前简报排版 | `brief-check` + `brief-preview` |
| 新手教学 | `tutorial-check` + `tutorial-demo-preview` |
| 技能配置弹窗 | `skill-check` |
| 技能键冷却读数 | `pad-cd-check` + `pad-cd-preview` |
| 面板退场触摸卫生 | `ui-hide-check` + `ui-click-check` |
| 文案对象字符串化 | `text-object-check` |
| P5 面板语法 | `panel-check` + `panel-preview` |
| 移动方式图示 | `pad-diagram-preview`(判据在 `panel-check` ⑨) |
| 特效预览 | `fx-preview` |
| 场边飘字车道 | `float-lane-check` |
| 传说皮肤法阵 | `aura-preview` |
| 启动画面 | `splash-check.py`(Python) |
| 胜利礼花/庆祝时钟 | `confetti-check` |
| 结算谢幕演出 | `settle-cine-check` |
| 每帧渲染成本 | `frame-cost-check` |
| 渲染副本跨实体残留(谁穿了谁的装扮) | `view-leak-check` |
| 关卡环境(风等) | `wind-preview` + `env-check` |
| 商店货架 | `shelf-check` |
| 设置页 | `settings-check` |
| 输入 | `input-check` |
| 规格击球 | `spec-shot-check` |

带 `--selftest` 的 check 列表见 [test-all.mjs](file:///Users/a1/Documents/01Code/dudu-cocos/tools/test-all.mjs) 的 `SELFTESTS`(反例必须被拦住,防规则脚本悄悄全绿)。

全量类型检查:`npx tsc -p tools/tsconfig.check.json`(零错误)。

各 check 的设计动机与判据细节写在对应 `tools/*.ts` 文件头注释,不在此抄录。

## 构建与预览

```bash
# Web Mobile 预览(构建后)
python3 -m http.server 8899 --bind 127.0.0.1 --directory build/web-mobile
```

Android 构建流程见 [.agents/skills/export-apk/SKILL.md](file:///Users/a1/Documents/01Code/dudu-cocos/.agents/skills/export-apk/SKILL.md)。

## 变更日志(每次改代码必读必写)

修改源码后必须把改动追加写入 [CHANGELOG.md](CHANGELOG.md)(gitignored,仅本地)。最新日期在最上,条目头一句话概述(写明用户指令或现场问题),子项用 Added/Changed/Fixed/Removed/Verified 标签并附文件路径。会话收尾前补记,未提交也要记(标注「未提交」)。

**记录要简洁** —— 每个子项一句话:做了什么 + 涉及哪个文件。**不要**写根因分析、设计推导、量化数字、未验到的长篇讨论(那些留在会话里或代码注释里)。Verified 只列回归项与 exit 状态,不铺陈数据。

## 必须知道的坑

1. **Cocos 编辑器对自动化封闭** — 界面不在辅助功能树里,像素捕获也被 macOS 拒绝。一切编辑器操作走 CLI + 文件直改。
2. **ZCode 内置浏览器跑不了 Cocos 构建** — 引擎内置资源加载在 IAB 里永远 hang,验证游戏用真实浏览器或编辑器预览。
3. **Bash 里 curl 走系统代理** — 访问 localhost 必须 `--noproxy '*'`。
4. **python http.server 可能只绑 IPv6** — 用 `--bind 127.0.0.1` 起本地服务。
5. **名牌文字用 Label(世界坐标),球衣号已去除** — sprites.ts 画不了字,径向渐变用描边环近似。
6. **老仓库有意差异(不是 bug)** — rules 拖尾改为 `setTrailHook()` 注入;config `serve` 段原版定义两次已合并。
7. **改 Android 应用名要改构建脚本** — 手机安装界面显示的名字是「嘟嘟羽毛球」,由 `.agents/skills/export-apk/scripts/build.sh` 每次构建用 sed 注入到产物 `build/android/proj/res/values/strings.xml`。源文件 `native/engine/android/res/values/strings.xml` 是**空的**,在那儿改没用(会被覆盖且不生效)。
8. **`Graphics.arc` 传 `a1 > a0` 画不出那一段,画的是它的补集** — 想要「从 a 扫过 b」的短弧,要么角度排成**递减**(终点 < 起点,`pad-cd.ts` 的 `cdArcs` 就是这么排),要么传 `counterclockwise=true`。踩中症状是「100° 的弧变成 260° 一圈」,不报错也不 NaN。另:`fill()` **不清路径**(只有下一个路径指令才推进 pathOffset),所以 `circle(); fill(); stroke();` 是一笔两用;而 `tools/cc-stub.ts` 的记录型 Graphics 会清,预览里同一形状要记两遍。UI 本地 y 向上 ⇒ 12 点是 `+π/2`。
9. **`inp` 是"本模拟步开始时"拍的快照,清 `pad` 清不到它** — `pad.buildIntent` 按值拷出 `swingSwipe/swipeY` 等字段(`game-root.buildInputs` 每步新建一份,`rules` 还会把它存进 `p.lastInp`)。所以"某个输入用掉了"这类一次性语义**必须在清 pad 的同一处把这份快照也作废**,否则 `player.update` 稍后在同一步还会读到旧值。踩中现场是自动击打的「一滑一拍」:收招帧正被 `p.swingBuf` 接续下一拍 ⇒ 一次右滑打出两拍深球,而 pad 上明明已经是 0(判据 `auto-hit-check ⑩g`)。`p.lastInp` 目前全仓库无人读,别把它当"下一步会用的账本"。
10. **`Object.assign(共享副本, 实体)` 只拷「源对象自己有的键」** — 渲染为了插值又不回写 core 会拷一份入参副本,如果全场共用**同一个**副本对象,那么"只有部分实体才有"的可选键就**没人覆盖**、上一名实体的值会留在对象上被读走。踩中现场(用户 2026-10-05):CPU 穿着蓝阵营色却顶着一头烈焰少年的橙发、脚下还有真人的传说法阵 —— `playerSkin/racketSkin/faceSkin` 只在 `career.applyToMatch()` 里挂到「你」身上,`player.create()` 从不建这三个键;绘制顺序是「离网远的先画」,所以先画的那个恒然后画的那个的装扮。同一条根因的第二刀:副本 ≠ 实体,所以 `ball.owner === p` 这类**身份比较在对局里恒假**(发球托球姿势只在商店/出图里亮过)。修法 = 副本按实体各存一份(`render/view-cache.ts` 的 `viewOf`)+ 身份比较走 `entityOf()` 回指那一跳;闸门 `view-leak-check`。**这类 bug 不崩、不报错,预览里也看不见 —— 只有真机对局才有。**

## 尚未移植

- ⏳ 微信小游戏构建(无 build-wechat 配置;需要 AppID 与域名白名单)
