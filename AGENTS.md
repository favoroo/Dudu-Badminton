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
| 改传说皮肤「脚下法阵」(溢光/齿环/断环/符文/星尘/升尘六层) | 画法 [aura.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/aura.ts)(零状态,只画不算),数值与配色表全在 `config.ts` 的 `fx.aura` 段;调用点只有一处:sprites.ts `drawPlayer` 画身体之前。**别再画光滑椭圆环** —— 与全站 P5 语汇相反。验收 `node .tools-build/tools/aura-preview.js`(+`--selftest` 七份反例必须被拦下)、出图 `.tools-build/aura-preview/aura-sigil.html` 与 `aura-people.html`(headless Chrome 光栅化肉眼判) |
| 改击打/轨迹/球体特效 | 数值全在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `fx` 段;丝带 [ribbon.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/ribbon.ts) + 球体运动学 [shuttle-motion.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/shuttle-motion.ts) + 粒子 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts) + 缓动 [easing.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/easing.ts);出图验收 `node .tools-build/tools/fx-preview.js` |
| 改胜利礼花 / 终局庆祝段时钟 | 弹道与喷口全在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `fx.confetti` 段(注释带实测),池与画法在 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts)(`confettiVolley` / `_stepConfetti` / 零分配 `writeConfettiQuad`);**时钟档位**(`sim`/`celebrate`/`still` 与各自的渲染频率)是零 cc 纯函数 [celebration.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/celebration.ts),`game-root.ts` 主循环只照它执行 —— 旧写法把 frozen 六个态一视同仁,OVER 时连 `fx.step()` 都不跑,礼花钉在半空(用户:「胜利时的这个礼花效果会有点卡顿」)。验收 `node .tools-build/tools/confetti-check.js`(+`--selftest` 四份反例必须被拦住)、出图 `node .tools-build/tools/fx-preview.js --out .tools-build/fx-preview` 的 `confetti.html`(六帧,灰框 = 结算卡占位,纸屑必须打在框外侧) |

| 改手机震动(触觉) | 强度表在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `haptic` 段(键名与 `fx` 六档同源,强度=时长×振幅两维);判据与排队在 [haptic.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/haptic.ts)(零 cc:`shotKey`/`plan`/`HapticGate`),平台出口在 [haptics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/haptics.ts)(Android 反射 `AppActivity.vibrate(ms,amp)` / 微信 `wx.vibrateShort` / Web `navigator.vibrate`,失败不静默 —— `hapticStatus()` 给设置页读数);Java 桥与能力探测在 `native/engine/android/app/src/com/cocos/game/AppActivity.java`;档位「轻/标准/强」在设置页声音画面 tab(存 `Settings.hapticLevel`),验收 `node .tools-build/tools/haptic-check.js`(+`--selftest`)。**改 Java 侧必须重打 APK 才生效**。**Android 12+ 不带 `VibrationAttributes` 的 `vibrate()` 会被系统归到 `TOUCH` 档,而这一档跟着「设置 → 声音与振动 → 触摸振动」总闸走 —— 总闸关了系统就把整段震动静默丢掉(不抛异常、Java 仍返回 true,JS 侧怎么探都是健康的),所以 API 31+ 一律显式声明 `USAGE_PHYSICAL_EMULATION`;真机取证看 `adb shell dumpsys vibrator_manager` 的 `Recent vibrations`(按 usage 分组,`finished` / `ignored_*` 一眼分明)**。**波形形状(包络/厂商预置)这一层做过又被撤了**(2026-10-02:真机 A/B 用户表示分辨不出、不要改手感,只保留恒幅 one-shot;线性马达的"嗡嗡"是已知取舍)—— 别再往 `HapticSeg` 里加 steps/preset,那套东西的坑与实证记在 CHANGELOG 与记忆里 |
| 改 P5 视觉构件(尖刺环/星芒/斜切/飘字底板/斩劈 cut-in) | render 层 [p5kit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/p5kit.ts),UI 层 [ui-arcade.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-arcade.ts);规范见下方「开发规范」P5 条 |
| 改面板层配色/斜切档/色即功能 | 令牌唯一真话 [p5-tokens.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-tokens.ts)(零 cc:`C` 色板、`SLANT` 只许 3/5/6/10 四档、`ROLE` 六角色、`RARITY` 用 config 的 `RARITY_META`、`inkFor`/`contrast`、网点预算)。`ARCADE`/`PAL` 是它的再导出/派生,**别再抄一份色表** |
| 改面板形状(衬纸/大色块/卡片/凹陷槽/开关/滑杆/网点/印章) | 形状出点列 [p5-shapes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-shapes.ts)(零 cc),画笔 [p5-paint.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-paint.ts)(只 import cc 的 Color/Graphics ⇒ **node 跑得动**),ui-arcade 再导出。**卡片用 `drawP5Card`(墨面 + 一条色带)不要整面实底** —— 一屏十几张会排成彩虹,大色块留给少数大面。出图 `node .tools-build/tools/panel-preview.js --out .tools-build/panel-preview` |
| 改面板的可点件工厂 | [ui-shell.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-shell.ts) 的 `solidTab`/`solidBlock`/`sectionTitle`/`bevelSlot`/`pressable`(**一律自带 `addComponent(Button)`** —— 漏了就是「点了没反应」,闸门 `tools/ui-click-check.js`)。四面板经 `UiKit` 的 `plate/block/tab/title/slot/press` 取用 |
| 改四面板排版(设置/闯关大厅/训练场/商店) | 版式是零 cc 纯函数:`ui/settings-layout.ts`、`ui/campaign-layout.ts`、`ui/drill-layout.ts`、`ui/shop-shelf.ts`(`SHOP`/`shopTopBar`/`shopTabs`/`shopContent`/`shopStats`)。各导出 `XOverlaps()`/`XOverflow()` 判据,统一由 `node .tools-build/tools/panel-check.js`(+`--selftest`)断言:对比度 ≥4.0、网点 ≤900 点、可点件 ≥44、不撞不溢出、文案无 emoji 与桌面键名。**改任何一块坐标都要去判据里核** |
| 改新手操作教学(滑轨引导,三主题讲解+实操) | 状态机 [tutorial.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/tutorial.ts)(零 cc:移动进圈/起跳离地/回球过网三道门控 + 喂球机 + moveMode 内存态临时切换恢复)、版式 [tutorial-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/tutorial-layout.ts)(零 cc,判据 `tools/tutorial-check.ts`)、**演示真值烘焙 [tutorial-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/tutorial-demo.ts)**(零 cc:复用 drill-demo 的喂球模拟/回球解算,烘出教学演示的来球弧/接触点/站位/三颗回球/跳跃表)、手势演示动画 [tutorial-anim.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/tutorial-anim.ts)(只画不算:真人偶/真羽毛球/真值弧线/手势补全/喂球机/判定圈,滑轨与实机 railGeo 1:1 对位)、面板 [tutorial-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/tutorial-panel.ts)(实操页=顶部横幅,滑轨/击球键必须全露);首启自动弹与入口装配在 ui-manager.ts 的 `openTutorial()`,重看入口在训练场列表页入口条与设置「关于」页;文案表 `TUTORIAL_TOPICS` 在 config.ts |
| 改训练场引导演示(六关 × 四步定格) | 演示真值在 [drill-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/drill-demo.ts)(零 cc:`bake(def)` 沿**真实喂球弧线**搜出接触点、回球必须过 `Drill.matches`、落点带由本关 `minLandX`/`maxLandX` 反推、「按错会怎样」直接吃 `Drill.diagnoseFail`),动画只消费它 —— [drill-anim.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/drill-anim.ts) 的 `gotoStep`/`drawFrame`/`callouts`(标字是数据,引擎 Graphics 画不了字,由 [drill-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/drill-panel.ts) 摆 Label);分步文案与落点区名写在 `config.ts` 的 `DRILLS[].demoSteps`/`zoneName`,搜法参数在 `CFG.drill.demo`;回归 `node .tools-build/tools/drill-diagram-check.js`(+`--selftest`)、出图 `node .tools-build/tools/drill-diagram-preview.js --out .tools-build/drill-diagram` |
| 主循环/事件分发 | [game-root.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/game-root.ts) |
| UI 面板/菜单 | [ui-manager.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-manager.ts) |
| 作者通道(测试拉满档) | 对练屏连点**同一个**球馆 tab 6 下 → 等级满 + 金币 99999,**只在内存生效、本局不落盘**(重开退回原档,每次进应用要重新连点)。参数 `CFG.author`(发版想关掉置 `enabled: false`)、手势判定 `mode-screen.ts` 的 `MatchSetupScreen.authorTap()`(0.0.18 随球馆 tab 从主菜单迁来)、执行与沙箱 `career.maxOut()` / `career.sandboxed()` |
| 改更新链路(检查/下载/浏览器出路) | 入口在设置「关于」页(`settings-panel.ts` 的 `buildAboutPage`,那颗「浏览器下载」**只在 `UpdateService.pendingUpdate` 非空时才建** —— 没更新时点它是把人丢进空发布页)+ 冷启动 24h 静默检查(`main-menu.ts` 的 `show()`,首页不再挂按钮);弹窗 [update-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/update-dialog.ts) 三条出口:立即更新(应用内下载+调安装)/ 浏览器下载(`browserDownloadUrl()` → `sys.openURL` 发布页)/ 稍后再说;候选源与原生下载器在 [update-service.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/update-service.ts),发布页直链 `releasePageUrl()` 在 [version.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/version.ts)(Gitee 的 releases API **不返回 html_url**,空串喂给 openURL 就是"点了没反应")。弹窗挂 Canvas 而不是 ui-root,并在 `show()` 里抬到最上层 —— 设置/商店是晚到的兄弟节点,不抬就被它们的暗底压死 |
| 改更新说明排版 | 折行算法 [release-notes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/release-notes.ts),回归 `node .tools-build/tools/notes-check.js` |
| 改结算屏那一屏字(奖励/明细/升级/新品上架) | [settle-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-panel.ts) 的 `fillRewards()`(数据来自 `Career.SettleResult`;`unlocked` 是 `SkinDef[]`,拼字符串必须先 `map(s => s.name)`,否则玩家看到 `[object Object]`)。闸门 `node .tools-build/tools/text-object-check.js` |
| 改结算谢幕演出(卡片弹出前的留白/斜带扫场/冷幕缓沉/标语砸落缓沉/逐行浮现/点按跳过) | 时间轴纯函数 [settle-cine.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-cine.ts)(零 cc,`buildCine` 胜负两路,训练不出仪式)+ 消费 [settle-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-panel.ts) 的 `playCine`;数值全在 config.ts 的 `fx.settleCine` 段;留白段球场由 celebration 的 celebrate 时钟养着(彩带才落得完,busy 归零自动回省电)。验收 `node .tools-build/tools/settle-cine-check.js`(+`--selftest` 旧单一快路径/拖沓档/阶梯过大三反例必须被拦下) |
| 改「调整位置」顶栏排版 | [editor-strip.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/editor-strip.ts)(纯函数,回归见 `tools/strip-check.ts`)+ [settings-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settings-panel.ts) 消费它 |
| 改闯关大厅/进度/「下一关」 | 关卡表与 `getNextStage()`·`getStageByNo()` 在 [campaign.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/campaign.ts);大厅(直达条、卡片「▶ 下一关」印章、tab 自动聚焦)在 [campaign-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/campaign-panel.ts);结算页那颗「下一关 ▶ 第 N 关」在 [settle-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-panel.ts) 的 `buildActions()`(按钮整排按场景重建);验收 `node .tools-build/tools/campaign-check.js` |
| 改闯关「战前简报」弹窗排版 | [brief-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/brief-layout.ts)(纯函数:折行 + 堆块 + 弹窗按内容长高,回归见 `tools/brief-check.ts`、出图 `tools/brief-preview.ts`)+ [campaign-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/campaign-panel.ts) 只照坐标摆 |
| 改虚拟按键能放在哪儿 | [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 的 `clampDelta`(唯一约束 = 整块留在可视区内) |
| 改击球键滑动手势(左/右=落点深浅,**上/下=弧线高低**,斜滑两轴组合如「上+右=挑高到后场」) | 双轴判定 [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) `trackSwingSwipe`(横轴 commitPx=10、纵轴 commitPxY=16,纵向阈值更紧防点按漂移误触)→ 数据池 [pad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad.ts) `swingSwipe`/`swingSwipeY` → 挥拍中实时覆写 [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) `p.swingAim`(深浅)/`p.swingLoft`(挑高/平抽)→ `buildShot` 的 loft 下托/压平分支(排在跳杀压平**之前**;发球 forced 不吃手势)。数值全在 config.ts `touchAim`/`shot.loftUpMinDeg·loftDownMaxDeg`;键盘 U/I 对应上/下滑;预告徽标走真实解算器自动跟随。回归 `node .tools-build/tools/swipe-vertical-check.js`(+`--selftest`) |
| 改技能键的冷却读数 | 浓度/几何/文案全在 [pad-cd.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad-cd.ts)(零 cc 依赖:`cdAlpha`·`cdArcs`·`cdText`·`drawCooldown`),取值在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `padSkin.cd` 段,[touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 只照参数摆笔 + 挂键心秒数 Label,剩余秒数由 `game-root.ts` 喂;回归 `node .tools-build/tools/pad-cd-check.js`、出图 `node .tools-build/tools/pad-cd-preview.js` |
| 改 AI 难度 | 档位表在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `diffs` 段(`read`=每记球只认定一次的站位误差 / `zone`=CPU 判定区 / `shotErr`=出球误差 / `composure`=落后是否变强),生效逻辑在 [ai.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/ai.ts),落档到球员在 `rules.ts` 的 `applyAiTier()`;验收 `node .tools-build/tools/ai-check.js`(三档胜负口径) |
| 改主动技能(7 款) | 技能表与专属数值在 [config.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/config.ts) 的 `skills` 段,状态机在 [skills.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/skills.ts)(`canActivate` 点亮门槛 / `activate` 起手 / `update` 逐帧推进 / `modifyShot` 出球加成),起手演出在 `game-root.ts` 的 `onSkillCast()`;**换技能的入口** = 模式屏基类 `buildSkillBadge`(对练 / 无限练习)+ 闯关大厅标题行的技能胶囊,装备全局一份存 `Career.profile.equippedSkill`(不分模式);**副作用契约**:球种预告 `player.previewKind` 与实打共用同一条 `buildShot`,靠 `HitOpt.preview` 分流 —— 往 `modifyShot` 加任何状态消耗(`buffT`/`lungeShotT`/`flashStrikeT`/`magnetPulling`/**`rage`**)或记账必须过 `!preview` 闸,漏一处就是「按了没反应」(2026-10-03 重击现场;怒气那处漏了的后果是"攒一整局被预告无声抽干");顶档质量改写(`q/perfect`)只给真人,AI 的准头归 `diffs` 管;**凡是"替真人打"的机制一律 `!p.isAI` 闸**(AI 也装 lunge、也会自己按键 `ai.ts`,给它开等于白送永不失误的回球,而 `serve-check`/`ai-check` 的真人替身从不按技能键 ⇒ 那两把尺子量不到);附魔类起手字挂人物头顶(`floatSys`)读作"上弦",完成时的兑现字才挂场边。验收 `node .tools-build/tools/flash-check.js`(+ `--selftest` 反例必须被拦住)、`node .tools-build/tools/smash-check.js`(+ `--selftest`)、出图 `node .tools-build/tools/flash-preview.js` |
| 改「跨步一键自动回球」(强力跨步 = 冲过去 + 自动把这一拍打完) | 承诺由 `skills.activate` 开(`p.lungeAutoT` 待发窗 + `p.lungeShotT` 加力窗,数值全在 `CFG.lunge` 的 `autoReturn/autoWindow/autoHorizon/autoLandHorizon/autoAim/autoOutMargin/autoSettleGrace/reachTailMul`),**那一拍由 [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) 的 `autoSwingDue` 择帧 + `startSwing` 执行**(skills 不能 import player,会成环);择帧锚 `Physics.flightFramesToClosest` 与 `PRESS_LEAD_FRAMES` —— **与时机环/击球键辉光同一把尺子**,只差人不吃的 `swingCue.reactFrames`(那 10 帧是补"看到→按下"的反应,机器不吃);刻意**不给必中**(不碰 `flashStrikeT` 那条 `guar` 分支),走 `tryHit` 真实峰值追踪;手动优先:玩家一按击打键 `p.lungeAutoT = 0` 当场撤销承诺;起手不清窗(它是判定区尾段的开关,清了那一拍反而够不着自己判成"该打"的球)。整套只动真人(`!p.isAI`)。验收 `node .tools-build/tools/lunge-check.js`(+ `--selftest` 四份反例必须被拦住) |
| 改「重击一键自动兑现」(百分百重击 = 上弦 + 到点替玩家轰出那一拍,挥空不罚冷却) | 承诺同样由 `skills.activate` 开(`p.smashAutoT` 代拍窗 + `p.skill.buffT` 附魔期,数值全在 `CFG.skills.smash` 的 `autoReturn/autoWindow/autoAim/autoHorizon/autoLandHorizon/autoOutMargin/autoSettleGrace/cdOnConsume`);**那一拍与跨步共用同一条 [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) `autoSwingDue(p, ball, src)` 择帧尺子**(门控数值各取一份 config,判据 `smash-check ⑯` 钉住两侧不许分叉),起手当场清窗 ⇒ 一次施放最多代一拍,附魔过期或玩家自己按击打键都当场哑掉;**冷却推迟到真扣出去那一拍才付**(`Skills.defersCooldownToConsume`,只有真人重击;AI 按下即付 ⇒ ai-check / serve-check 基线不动);`autoWindow` 上限是 `buffDuration`(超出去会在没附魔的帧上代一记普通球)。窗长按球速档定标:实测「对方出手→该按那帧」标准档最远 84、极限慢 135 ⇒ 取 140。验收 `node .tools-build/tools/smash-check.js`(+ `--selftest` 七份反例必须被拦住) |
| 改「怒气重击」(第 7 款:整局攒怒气 + 按档位兑现 + 一键代拍) | **资源制,不是冷却制** —— 怒气 `p.rage` 住 **`Player`** 而不是 `PlayerSkillState`(`Career.applyToMatch()` 是 `me.skill = initSkillState(...)` **整块换对象**,换装即丢;Player 只在 `Rules.newMatch` 重建 = 正好"每局清零"的生命周期,先例 `p.zenMeter`)。攒点写在 [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) 的 **`settle()`** 而不是 `modifyShot`(预告每真实帧最多跑 10 次 ⇒ 增益写那儿等于按帧速自灌;`rules.applyShot` 又会被发球走到),且**只吃物理档**(`qRaw` 来的 sweet/perfect,不读被 buff 抬起来的 `shot.*`),释放那一拍整口不攒(`skillKind !== "rage"`);数值全在 `CFG.skills.rage`(max/perHit/三个乘数/`rageMinRelease`/`tierAt`/四行 `tiers[]` 演出表含 `castLab`+`lab`);**只有满怒**才 `forceSmash` + 顶档(挪出 `ratio>=1` 就等于把它退化成弱版 smash);一键代拍与跨步/重击共用 `autoSwingDue(p,ball,"rage")`,四个门控数三侧**逐字同源**(`rage-check ⑭` 钉);键面走第二条通道 `setSkillState(..., chargeRatio)` —— `cdRatio` 语义是"还剩多久能用"、焊着变灰/藏图标/印秒数,怒气是反向量,**偷渡就会"怒气越满键越暗"**;`cooldownFrames: 20` 只防同帧连点(真闸是资源 + `buffT` armed 窗,`resetPoint` 每分清 cd 是既有设计,别去"修"它)。验收 `node .tools-build/tools/rage-check.js`(+`--selftest` 十二份反例必须被拦住) |
| 改「时空减速掌控」(接球后缓释结束 + 击球大幅强化 + 效果彻底结束后才进冷却) | 承诺由 `skills.activate` 开(`buffT`/`focusT` 保底 180 步,数值全在 `CFG.skills.focus`;`defersCooldownToConsume` 保证激活时 cd=0 不扣冷却),接球(`!preview`)时将领域时间收缩到 `postHitFrames`(22 步,出球慢放特写),`world.clampSlowmo` 同步收缩;缓释到期当帧 `update` 启动 270 帧冷却;`modifyShot` 赋予真人顶档品质(`sweet/perfect/q>=0.98`)与初速+5.0/压弧+14°;击球触发专属 `chronoBurst` 激波与 16 级震屏。验收 `node .tools-build/tools/focus-check.js`(+ `--selftest` 四份反例必须被拦住) |
| 改「自动击打(辅助模式)」(全局开关:系统替真人起手每一拍) | 开关存 `Settings.autoHit`(默认关)+ 零 cc 单例 [auto-hit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/auto-hit.ts)(`AutoHit.on` = 总闸 && 用户开关 && 模式合格;模式由 `rules` 在 newMatch/startCampaign 两处报进来),数值全在 `CFG.autoHit`;**择帧不另写一套** —— 复用跨步/重击/怒气那条 `Player.autoSwingDue(p, ball, "auto")`(四个门控数与它们逐字同源,`rage-check ⑭`/`smash-check ⑯`/`auto-hit-check ⑨` 三处钉),分支排在整条 else-if 链**最后**(三条技能承诺与手动优先都在它前面)。**四条设计约束**:① 不写 `lungeAutoT`(那字段兼着 `strikeZone` 的判定区尾段倍率 = 白送手长)② 不写 `flashStrikeT`(必中支)③ 起手给字符串 `"mid"` 与真人点按同一条路,玩家滑过的深浅/高低由 `aimOverride` 在同帧覆盖 ⇒「击球键变纯瞄准键」零新增代码(`pad.swingSwipe` 本来就粘住不丢)④ **不接管发球**(实测四重不沾:`live=false`/`held`/`flying`/`lastHitter` 挂在发球方)。没有窗 ⇒ 逐帧轮询,靠 `maxTriesPerBall` 限次(`flightFramesToClosest` 从第 0 帧起扫,球在圈心时 fc=0 当即判"该按",不限次就是"人物自己乱挥")。表现层:时机环 `pressAt` 去掉 `reactFrames`(机器不吃反应)、徽标缀「· 自动」、飘字「自动」、早/晚时机条在 `e.autoHit` 时抑制。设置页第 4 个 tab「辅助」(`assistLayout()`,操控页竖排零余量塞不下)。验收 `node .tools-build/tools/auto-hit-check.js`(+ `--selftest` 九份反例必须被拦住) |
| 改技能配置弹窗排版 | [skill-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-layout.ts)(纯函数:详情板折行 + 右对齐块按实测宽倒推 + 面板竖排留缝,回归见 `tools/skill-check.ts`)+ [skill-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-dialog.ts) 只照坐标摆 —— 卡片只留「标签/名字/CD/装备」,完整说明在底部详情板,点卡片切换 |
| 改音效映射 | [sfx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/sfx.ts) |
| 改背景音乐 | [bgm.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/bgm.ts) |
| 改启动图/应用图标 | [make-app-icons.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/make-app-icons.py) 出图标母版 → [make-splash.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/make-splash.py) 提取发光羽毛球主体与流线光晕派生无缝启动图 → [apply-splash.py](file:///Users/a1/Documents/01Code/dudu-cocos/tools/apply-splash.py) 注入构建(比例见 [splash-config.json](file:///Users/a1/Documents/01Code/dudu-cocos/tools/splash-config.json)),闸门 `python3 tools/splash-check.py` |
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
- **Agent 自己拉起的长驻辅助进程,用完必须关掉** — 调 UI 时手工启动的 headless Chrome(`--headless=new --remote-debugging-port=93xx --user-data-dir=/tmp/...`)、本地静态服务(`python -m http.server`)等不会随会话结束自动退出:父 shell 一退就被 launchd 收养成孤儿,继续吃 CPU、还可能放声音(现场:Qoder Agent 留下的 `dudu-cdp-profile-*` Chrome 跑了两天、各烧 4000+ 分钟 CPU,用户关掉浏览器声音还在)。启动时记下 PID、会话收尾前 `kill`;接手别人的环境先 `ps aux | grep -E "headless.*user-data-dir=/tmp|http\.server"` 清一轮。仓库 tools/ 的一次性出图脚本(`--headless --screenshot`)跑完自退,不在此列。
- 模块间用 ES Module import/export,不使用全局命名空间。
- 每个模块文件顶部有 `// ============` 注释块说明设计动机 — **改代码前先读注释**。
- canvas → cc.Graphics 的移植约定见 [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) 顶部注释。
- `core/utils.ts` 不许 import cc,存储后端通过 [host.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/host.ts) 的 `installStorageBackend()` 注入,必须在任何 `load()` 之前调用。
- 音效/BGM 均为离线烘焙,音效(sfx/*.wav)由 `tools/bake-audio.ts` 烘焙;**BGM 的唯一烘焙源是 `tools/bake-bgm.ts`**(bake-bgm → bgm-check → oggify,分发格式 ogg),8 小节 A/B 段编曲 + 6 stem 自适应分层(pad 和弦垫 lvl≥2 进),结构闸门 `tools/bgm-check.ts`。音效/音乐开关统一读 [settings.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/settings.ts),模块不应有自己的静音状态。
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

# 3.4 引导演示真值 + 六关四步出图(exit 0;用户现场:「演示太简陋,看完不知道怎么做」。
#     根因不是画得丑 —— 旧动画自己编了条假抛物线,回球也从不过 Drill.matches,
#     教的和判的是两套东西。断言:来球弧线与实机喂球模拟逐点吻合、理想回球必须过本关判据、
#     接触点在判定圈内且跳得到、落点落在画给玩家的那条带里、鬼影必须真是错拍。
#     --selftest 喂旧那套假弹道,六关必须全被拦下)
node .tools-build/tools/drill-diagram-check.js
node .tools-build/tools/drill-diagram-check.js --selftest
node .tools-build/tools/drill-diagram-preview.js --out .tools-build/drill-diagram   # 6 关 × 4 步,Chrome 出 PNG 肉眼判

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

# 4.6.5 百分百重击附魔回归(exit 0;「按了没反应」这类坏不崩、不报错,只会安静地不兑现。
#     断言:球种预告 previewKind 前后 buffT/flashStrikeT/magnetPulling/stats.* 逐字段不变,
#     而徽标照旧报扣杀(预告与实打必须同一条路径,不许靠"跳过钩子"来实现);上弦后的下一拍
#     = 必定暴扣且只消耗一次;modifyShot 回写的 q/perfect 真的生效(旧顺序先解构后调用,
#     那三个写全是死值 → 技能拍永远拿不到顶档反馈),而 stats.sweets/perfects 仍按物理档记;
#     挥空不吃附魔、附魔期发球也算暴扣(均为用户 2026-10-03 拍板);AI 吃 forceSmash/加成
#     但不吃顶档改写(一并生效会把真人得分率 60%→46%,等于给对手加难度)。
#     改 modifyShot 的任何消耗写入、buildShot 的调用顺序、或 skills/player/rules 技能路径都要跑。
#     4.6.5b 一键化扩判据(2026-10-04;用户:「点击之后如果球在可打击范围内就也会自动击打,
#     如果挥空不会冷却」)。⑩~⑰ 八段:300 格(6 高度 × 5 远近 × 5 来球速度 × 两侧)逐格只按一次
#     重击,起了拍必须兑现(系统代拍 / 必定扣杀 / 顶档 / 命中即消耗 / 只代一拍 / 不捞界外球),
#     每一次沉默都要归因到"界外/够不着/没过网/贴地/死球/门槛"并且不比零反应延迟的完美手动差;
#     该不出手一律不代拍(含"附魔过期残窗必须哑掉" + 对照组必须真的代拍,否则判据没牙齿);
#     手动优先(同帧抢拍与照时机环玩都被让位,落点用玩家瞄的);计时器逐帧算术(待发窗/附魔/冷却
#     各只减一次,配置 240 帧=4 秒就是文案那句话);冷却三态(按下不付、挥空不付、扣出去付一次);
#     AI 侧口径不动(按下即付、拿不到代拍窗、判定区不放大);窗覆盖度 + 两侧门控数值同源
#     (autoWindow 下限吃球速档:极限慢档实测最远 135 帧 ⇒ 取 140);代拍落点深浅(77% 深、0 格出界)。
#     --selftest 七份反例:legacy(预告也算命中)/ noOverride(顶档改写读不到)/ buffNotConsumed/
#     noAuto(从不代拍 = "按了没反应")/ alwaysDue(不择帧就起手)/ cdAtPress(按下即付冷却 = 旧口径)/
#     aiGetsAuto(拆掉 isAI 闸)必须各自被点名拦住,另附 doubleDecrement 与 autoNotCleared 两份算术对照;
#     改 CFG.skills.smash 任一 auto*/cdOnConsume、skills 的 smash 分支与 resetPoint、
#     player 的 autoSwingDue(src 分支)·挥拍机器 任一都要跑;
#     旧的两份反例(legacy 预告也算命中 / noOverride 顶档读不到)仍在内 —— 只装回其中一份,
#     另一份的断言照样绿,所以一份不够)
node .tools-build/tools/smash-check.js
node .tools-build/tools/smash-check.js --selftest

# 4.6.6 跨步一键自动回球回归(exit 0;用户现场:「点完跨步再去点击打,在手机上操作其实有点
#     不太方便」。右簇 swing/lunge 同排,两下要踩在几十毫秒里 —— 纯操作税。现在按下跨步 =
#     冲过去 + 把这一拍打完。坏法全都不崩不报错:按早按晚(变挥空)、替玩家捞该落地的界外球
#     (把对手送的分还回去)、抢玩家自己那一拍、以及偷偷给 AI 也开(AI 也装 lunge、也会自己
#     按键 ai.ts:487-501,而 serve-check/ai-check 的真人替身从不按技能键 ⇒ 那两把尺子量不到)。
#     七段判据:① 起了拍必须兑现(球回对方场内、带跨步加力、命中即消耗、整段只起一次拍、不捞
#     界外球)+ 每一次沉默都说得出理由(界外/够不着/没过网/贴地/死球/门槛)+ 逐格不比"完美手动
#     两拍"差 ② 该不出手的场合端到端不起拍(附赠门槛:空场状态下跨步键仍按得下去 = 纯位移用法
#     没被机制吃掉)③ 手动优先:玩家一按击打键,待发窗当场清零、落点用他瞄的、自动不许补第二下
#     ④ 判定区:冲量期吃满 reachMul、待发窗吃 reachTailMul 尾段、窗口走完回落、**AI 恒拿不到
#     待发窗** ⑤ 计时器每帧只减一次(p.lungeShotT 曾被两处各减,配置 60 帧=1 秒实际只有 30 帧,
#     与技能文案同源的那句话在撒谎)⑥ 球种预告不许偷吃 buff、击球键徽标不许撒谎 ⑦ 一键 vs 两拍
#     的救球率/质量对照 + 落点深浅(autoAim=0.8 实测压到对方场地 74% 深、0 格出界;deep=0.92
#     会送 3 格出界)。基线是个死按的替身,逐格比较只在"来球界内且它真救得到"的子集上做 ——
#     否则量出来的"自动不如手动"全是假账。⑧(2026-10-04)跳跃中也能释放:真人悬空按下 =
#     空中突进(冲量/加力窗/待发窗照开)+ 空中网格一键兑现、不比"空中完美手动"差 + 起拍那一帧
#     人必须在空中 + **AI 悬空必须被拒**(够球范围归 diffs 管)。
#     改 CFG.lunge 任一 auto*/reachTailMul、skills 的 lunge 分支与 resetPoint、player 的
#     autoSwingDue·ballFuture·strikeZone·挥拍机器 任一都要跑。
#     --selftest 反例:alwaysDue(不择帧就起手)/ noConsume(一次跨步吃好几拍)/
#     aiGetsAuto(拆掉 isAI 闸)/ doubleDecrement(计时器多减一次)/ airGateRestored(旧
#     onGround 闸装回,空中按下没反应)/ aiAirAllowed(拆掉 AI 空中闸)必须各自被拦住)
node .tools-build/tools/lunge-check.js
node .tools-build/tools/lunge-check.js --selftest

# 4.6.7 网前击球与物理判定回归(exit 0;用户现场:「羽毛球在球网旁边的时候,感觉击打起来操作不太舒服」。
#     两大致命机制缺陷:①隔网硬拦截(inOwnCourt: x < 480 严格)与时机环脱节,判定区心在 488.7(已在对方半场),
#     时机环按区心引导玩家在球抵网口时按键,但球在 480~485 时 tryHit 直接判非法拒接 -> 必成假动作挥空;
#     ②网前低球(h <= 40px)解算 100% 挂网自杀死刑:离网仅 10px,而过网高度要求爬升 53~73px,几何需要起飞角 >80°;
#     旧 loftMaxDeg=79 且 netClearMargin=10 死咬不放,导致 safeAngle 无解直接认命下网。
#     断言:网前 x0=470 处各高度全解算过网、左右半场完全镜像对称、网顶/高球网口探入允许击打截击、
#     对方半场深球严格拒绝。改 config.ts netClose*·netReachTol*、physics.ts safeAngle·solveShot、
#     player.ts inOwnCourt·buildShot 都要跑。--selftest 模拟旧版硬卡 480 必须被拦下)
node .tools-build/tools/net-shot-check.js
node .tools-build/tools/net-shot-check.js --selftest

# 4.6.8 击球键纵向手势回归(exit 0;用户需求:「上滑或者下滑也能触发一些其他的击打效果,
#     比如上滑是很高的球」。击球键手势从一维(左右=落点深浅)扩成二维(上下=弧线高低,
#     两轴独立可组合):上滑 = loft 下托到 loftUpMinDeg(58>lobDeg55 ⇒ 必出挑高),
#     下滑 = 压到 loftDownMaxDeg(12,低点击球被 safeAngle 抬回不自杀)。
#     坏法全都不崩不报错:下托分支被拆(怎么滑都打不出高球)、手势漏进跳杀/发球
#     (空中永远是扣杀、发球弧线不被改写)、没滑的那拍被带偏(spec/net/reach 的基线全歪)、
#     AI/替身被带纵轴意图。
#     断言:上滑 7 高度×3 深浅必出 lob、网前上滑豁免 mid 自动扑推、下滑高点击球 deg≤12
#     落扣杀/劈吊档、低点击球全过网、上+右=挑到后场、预告与实打同路径、中性单按与旧公式
#     逐位一致、jumpSmash 压平赢过手势、forced 发球不吃手势、inp.swingSwipeY 挥拍中实时
#     覆写/AI 不带字段不动。改 CFG.touchAim.commitPxY、CFG.shot.loftUpMinDeg·loftDownMaxDeg、
#     player.ts swingLoft·buildShot、pad.ts/keyboard.ts/touchpad.ts 纵轴管道都要跑;
#     --selftest 喂「无下托分支/无压平分支/偏置顺序颠倒/阈值放松」四份反例必须被拦下)
node .tools-build/tools/swipe-vertical-check.js
node .tools-build/tools/swipe-vertical-check.js --selftest

# 4.6.9 时空减速技能与接球缓释回归(exit 0;用户现场:「结束逻辑改成接完一个球过一会就可以结束，击球效果强化，冷却时间改成效果结束后才进冷却」。
#     断言:激活时 cd=0、键面报"领域中"不可重复释放、预告 preview 绝不偷吃/缩短领域时间、
#     真正接球时初速+5.0/压弧+14/顶档 sweet/perfect 品质改写、接球后时间精准收缩到 postHitFrames(22 帧)、
#     缓释走完领域结束且当帧正式启动 270 帧冷却、未接球自然超时同样启动 270 帧冷却、resetPoint 彻底清零。
#     改 config.ts focus.*、skills.ts focus 分支/defersCooldownToConsume、world.ts clampSlowmo/残影、
#     fx.ts chronoBurst 都要跑。--selftest 四份反例:cdAtPress/noPostHit/previewConsumes/noQuality 必须全被拦下)
node .tools-build/tools/focus-check.js
node .tools-build/tools/focus-check.js --selftest

# 4.6.10 胜利礼花与终局庆祝段时钟回归(exit 0;用户现场:「胜利时的这个礼花效果会有点卡顿」。
#     根因不在"画得贵",在三处叠加:frozen 六态一视同仁地跳过 world.stepFx ⇒ fx.step() 不跑,
#     纸屑出生后一帧没走钉在半空;frozen 还把整场渲染降到每 4 真实帧 ⇒ 就算走也是 15fps;
#     旧弹道 g=0.02 无阻力按寿命积分全程在往上飞,而喷口一口居中正好打在结算卡(560×490)背后。
#     断言:①时钟档位真值表(sim/celebrate/still × 六态,庆祝态 ⊆ frozen、暂停必须仍是定格帧)
#     ②渲染节奏(庆祝满帧 / 面板每 4 帧 / 对局满帧、定格每 2 帧,庆祝必须比面板密)
#     ③出生几何(两口关于屏心镜像、≥90% 片落在 |x-屏心|>280 的可见带、不许喷出场外)
#     ④弹道(10 帧位移 >4px = 时钟真的在走;升程 ≥120px;不出屏顶;落回地面;第 N 帧池必空 =
#     庆祝段收得回去,省电降频还得回来)⑤绘制零分配(_drawConfetti 里不许有数组字面量,
#     角点必须走 writeConfettiQuad 复用缓冲)+ 角点公式与旧式逐位同构 + 彩带层 ≥30fps
#     ⑥每片一笔、礼花最忙帧笔数 ≤ frame-cost 峰值预算。改 config.ts fx.confetti 任一键、
#     core/celebration.ts、game-root 主循环时钟分支、fx.ts 彩带池、world.presentationBusy 都要跑。
#     --selftest 四份反例:旧时钟(frozen 一律 still)/ 旧弹道(g=0.02 无阻力)/
#     旧一口居中喷口 / 旧绘制体(逐片 new 两个数组)必须各自被点名拦住)
node .tools-build/tools/confetti-check.js
node .tools-build/tools/confetti-check.js --selftest
node .tools-build/tools/fx-preview.js --out .tools-build/fx-preview   # confetti.html 六帧肉眼判(灰框=结算卡)

# 4.6.11 结算谢幕演出回归(exit 0;用户现场:「目前比分到了之后就直接弹窗结算了,可以多加一点效果(失败和胜利的不一样)」。
#     入场演出全靠 tween 摆出来,任何一步接错都是静默的:斜带忘了挂、胜负两条路径抄成同一条、
#     节拍叠罗汉把卡片拖到三秒后才来 —— tsc 不报、运行时不炸。时间轴由 core/ui 纯函数 settle-cine.ts
#     烘成 CinePlan,settle-panel.ts 的 playCine 照计划摆。
#     断言:①胜负真的分化(斜带/星芒/轻震仅胜利,冷 veil 仅失败,标语 slam≠descend,卡片 pop≠sink,失败暗幕压得更慢);
#     ②时间不打架、总时长不超防拖沓红线(暗幕升完卡片才来、标语落定不晚于卡片、行数 10 行逐行浮现不超 2.6s);
#     ③训练模式不出仪式(保持旧快速入场);④settle-panel 确实在消费时间轴且跳过监听成对卸载。
#     改 config.ts fx.settleCine、ui/settle-cine.ts、ui/settle-panel.ts 演出路径都要跑。
#     --selftest 三份反例:旧单一快路径/拖沓档/阶梯过大必须被点名拦下)
node .tools-build/tools/settle-cine-check.js
node .tools-build/tools/settle-cine-check.js --selftest

# 4.6.12 怒气重击(第 7 款:资源制 + 分档兑现 + 一键代拍)回归(exit 0;用户需求:「和重击机制类似,
#     但可以击打过程攒怒气,特殊击球攒得更快,攒得越多释放越强,放完归零」。
#     这款的坏法**全都不崩、不报错、tsc 也不报**:预告通道每真实帧最多跑 10 次 buildShot,消耗漏一个
#     !preview 闸 ⇒ 攒一整局的怒气被无声抽干;四档塌成一档(tierAt 行数与演出表不齐 / rageTierOf
#     从小往大找恒返回 0 —— 烟测真抓到过);一次施放吃掉多拍(兑现不收 armed 窗);释放那一拍自己给自己
#     充能(增益读了被 buff 抬起来的 shot.sweet 而不是 qRaw 来的物理档);0 怒气也能放 ⇒ 每 20 帧白嫖强球;
#     怒气住 PlayerSkillState ⇒ Career.applyToMatch 整块换对象时丢失;跨分留残窗 ⇒ 下一分凭空多打一拍;
#     手动抢拍时把 armed 一起清 ⇒「我按了技能又自己挥一拍,怒气没了」;给 AI 开代拍窗 ⇒ 白送永不失误的暴扣
#     而 serve-check/ai-check 量不到。16 段判据(含 300 格一键兑现 + 沉默必归因 + 完美手动豁免)+
#     12 份 --selftest 反例。改 CFG.skills.rage 任一键、skills 的 rage 分支、player 的 settle 增益/
#     autoSwingDue src="rage"/代拍链、pad-cd 的 charge* 任一都要跑)
node .tools-build/tools/rage-check.js
node .tools-build/tools/rage-check.js --selftest   # 十二份反例必须各自被点名拦住

# 4.6.13 自动击打(辅助模式)回归(exit 0;用户需求:「做一个自动击打功能,玩家的人物会自动击打羽毛球,
#     打开后玩家就只用移动方向和释放技能;设置里加个开关」。择帧复用 autoSwingDue(与三条一键化同一把尺),
#     所以坏法同样全是静默的:把发球也代了(发球类型是"按下快慢"的手艺,实测四重不沾 live/held/flying/
#     lastHitter,反例要四道全拆才咬得动)、白吃判定区尾段倍率(写 lungeAutoT 就是白送手长)、抢玩家自己
#     那一拍、训练场/教学/本地对战也代打(那两处判的就是"你会不会这一拍")、关掉不干净(serve-check/
#     ai-check/sim-check 的替人基线会一起漂)、同一球连挥("人物自己乱挥半天")。
#     188 格网格(6 高 × 4 远近 × 4 来球速度 × 两侧 + 4 格"够得着但明摆着出界"的平抽)九段判据:
#     ① 起必兑现 + 沉默必归因(唯一豁免:完美手动同一格也接不到)② 永不发球(含对照组,否则量的是死支)
#     ③ 无免费手长(起手帧核 lungeAutoT 与半径)④ 手动优先 + 挥空后仍接得住 ⑤ 模式门控(真集成)
#     ⑥ 关掉 = 零调用零写入(把 Player.autoSwingDue 换成计数壳)⑦ 不加强度(q 与手动同尺、瞄准同源)
#     ⑧ 每球限次(冻结球 + 择帧恒"该按"逼出连挥,拿出厂值核)⑨ 四侧门控数值同源。
#     写这套判据时 --selftest 当场抓出三份**哑反例**(界外豁免自量自配置、限次从没被逼到、发球只拆一道闸)
#     —— 判据读被量的那个配置就等于没量,这条规矩记在文件头。
#     改 CFG.autoHit 任一键、player 的代拍链/aimOverride/previewKind、auto-hit.ts、rules 的 onMatch、
#     game-root 的 updateSwingCue 任一都要跑)
node .tools-build/tools/auto-hit-check.js
node .tools-build/tools/auto-hit-check.js --selftest   # 九份反例必须各自被点名拦住

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

# 4.9 BGM 结构闸门(exit 0;内存重渲断言,不依赖磁盘音频文件,oggify 之后照常可跑)
#     断言:6 条 game stem + menu 名单齐、全 game stem 同帧数(运行时同帧起播,
#     差 1 样本循环相位就漂)、peak<0.99、RMS 基线 ±3dB(改音色实测值要写回
#     bgm-check.ts 的 RMS_BASELINE)、循环接缝 |x[0]-x[末]| ≤ peak/4(wrapFold 生效症状)、
#     声道数(groove/drums/tamb mono,arp/lead/pad/menu stereo)。
#     改 tools/bake-bgm.ts(乐谱/音色)、动 game/bgm.ts 分层权重都要跑;
#     烘焙链路见该文件头注释:bake-bgm → bgm-check → oggify
node .tools-build/tools/bgm-check.js

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

# 6.7 新手操作教学回归(exit 0;滑轨教学三主题「讲解+实操」:版式不撞/文案无 emoji
#     无桌面键名/可点件 ≥44/横幅给下半屏控件让位 + 门控行为套件 —— 圈外不算、
#     没离地不算、下网挥空不算、非击球实操喂球机抱球、三关全过才 allDone、
#     moveMode 临时切换可恢复 + **演示真值套件** —— 演示里那条来球弧必须与
#     实机喂球 simulateFeed 重算逐点一致(手编贝塞尔在这里现形)、接触点站立
#     可够到/落点带真实/跳跃表与引擎同步/标字不出画布/advance 越圈回卷。
#     改 config.ts tutorial 段/TUTORIAL_TOPICS、core/tutorial.ts、core/tutorial-demo.ts、
#     tutorial-layout/panel/anim 任一都要跑;
#     --selftest 喂旧式无条件放行门控 + 手编弧线假烘焙两份反例,必须被拦下)
node .tools-build/tools/tutorial-check.js
node .tools-build/tools/tutorial-check.js --selftest
node .tools-build/tools/tutorial-demo-preview.js --out .tools-build/tutorial-demo   # 三主题分段出图,Chrome 光栅化肉眼判观感

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

# 7.3 文案里的「对象被字符串化」闸门(exit 0;用户现场:胜利结算页写着
#     「新品上架:[object Object] · [object Object] · [object Object]」。
#     `SettleResult.unlocked` 是 SkinDef[],旧代码 `res.unlocked.join(" · ")` 直接吃隐式字符串化。
#     这类坏法不崩、不报错、**tsc 也不报** —— 把对象塞进字符串槽位有两个合法出口:
#     `${x}` 插值不做可文本化检查;`.join()` / `+` / `String(x)` 签名接受任意元素类型。
#     (而 `label.string = 对象` 那种直接赋值 tsc 会报错,所以本工具只补那两个洞,不是 tsc 重复品。)
#     判据用 TypeScript 编译器 API 读真实类型:扫 assets/scripts 全部插值/join/拼接/String() 站点,
#     元素类型是对象且该类型没自己声明 toString 就报警;console.* 实参整条放行(那是调试不是文案)。
#     另钉三条「防自己变瞎」的计数:文件数 >60、字符串化站点 >500、join 调用 >10。
#     改任何用户可见文案的拼接(结算/简报/技能详情/商店)都要跑)
node .tools-build/tools/text-object-check.js
node .tools-build/tools/text-object-check.js --selftest   # 四种出口各一份坏样本必须被点名,四份合法写法必须放行
node .tools-build/tools/text-object-check.js -v           # 站点统计 + 逐条 file:line:col 明细

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

# 7.6 场边飘字「车道整层重排」回归(exit 0;两代叠字现场:0.0.23 之前旧错行只数条数
#     且 Math.min(n,2) 封顶两行,一拍同帧四条场边字(档位+技能+跳杀+热手)的第 3、4 条
#     叠回同一点;0.0.24 的 nextLaneY 排满后 Math.min(sy,maxCenter) 把超限字全部硬夹到
#     同一个 y,且行只朝下长永不回收 —— 用户:「标签一多还是会有重叠」。0.0.25 起是
#     「每步整层重排 + 容量驱逐」纯函数 render/float-lane.ts 的 layoutLanes(同侧按出生序
#     从锚点向下堆,底沿要探过地面线就驱逐 remain 最小者、其余回填上移),world.relayoutFloats
#     每步消费(目标行位 + 同侧共享列上浮偏移,行距锁死;星芒画在 floatStarG 共享底衬层,
#     永远压在所有牌子下)。断言:八连驱逐到容量内存活者两两不叠、混合尺寸按前行实际
#     占位算行距、左右侧互不干扰、非成员与已驱逐不占行、满员驱逐回填、孤字不驱逐。
#     改 float-lane.ts / world.ts relayoutFloats·floatSpawn·星芒底衬层 / p5kit drawFloatStar /
#     config floatLaneGap·floatSide·floatStarScale·floatColumnRise* 都要跑。
#     --selftest 喂两代旧算法(min(n,2) 封顶、0.0.24 触底夹取),必须都被拦下)
node .tools-build/tools/float-lane-check.js
node .tools-build/tools/float-lane-check.js --selftest   # 反例(两代旧算法)必须被报警

# 7.7 传说皮肤「脚下法阵」出图 + 几何断言(exit 0;用户现场:「传说皮肤人物底下一层
#     光圈太简陋了」—— 旧画法是**两个光滑椭圆环 + 三颗圆点**,与全站 P5 语汇「拒绝光滑
#     圆圈」正相反,而且商店预览给 drawPlayer 传的 animT 恒为 0,那圈东西在店里一动不动。
#     现在六层(溢光/齿环/断环/符文/星尘/升尘),画法在 render/aura.ts、数值在 fx.aura。
#     断言九条:坐标有限、同帧重画逐字节一致(逐帧零 rand)、包络不宽过人物不高过小腿、
#     地面层全按 flat 压扁(没有哪层是正圆)、每帧笔画 ≤16、alpha ≤0.95 不糊场、
#     vis 真的在等比缩放每一笔、vis=0 一笔不画、卡片缩略图不画升尘、齿环与外断环反向对转。
#     改 fx.aura 任一值、改 aura.ts、或动 drawPlayer 的法阵分支都要跑;
#     --selftest 喂七份改坏的反例(溢光糊场/外环撑爆/升尘长到 90px/LOD 关掉/两圈同向/
#     扁率 0.9/星尘撒 40 颗),必须全被拦下)
node .tools-build/tools/aura-preview.js
node .tools-build/tools/aura-preview.js --selftest
# 肉眼判两张(一页 3400px 缩到屏幕上看不出细节,所以拆成两页单独截):
#   aura-sigil.html  四种配色 × 六帧,暗场/亮场并排 —— 判「有没有糊成泥坑」
#   aura-people.html 整人 1:1 与 2.4× —— 判「法阵压不压得住、有没有糊到腿」
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --screenshot=.tools-build/aura-preview/sigil.png --window-size=1520,600 \
  --hide-scrollbars "file://$PWD/.tools-build/aura-preview/aura-sigil.html"

# 7.8 启动画面(splash)无缝性与底色纯度闸门(exit 0;用户现场:「启动logo画面背景色和logo本身的背景色弄成一个颜色」。
#     根因是旧素材直接用了桌面 App 图标(Squircle 圆角方块),且方块底色(~#1c1b17)与全屏
#     清屏色(~#0d1114)亮度差近 2 倍,外加 JPEG 宏块失真与旧 displayRatio 缩小导致中央
#     清清楚楚贴着一个方形小卡片。现在 make-splash 从母版提取纯净羽毛球主体+多尺度
#     流线光晕,四周 120px 纯色平原与全屏底色 0 色差,无损 PNG 编码。
#     断言:splash-source 存在且 1024x1024、底色严格等于 (13,17,21)、四周 120px 绝对零色差、
#     发光主体居中且跨度在 [500,750] 内。
#     改 tools/make-splash.py、tools/apply-splash.py、或 tools/splash-config.json 都要跑)
python3 tools/splash-check.py
python3 tools/splash-check.py --selftest   # 模拟旧版带方块贴片的坏图,必须被报警拦下

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
