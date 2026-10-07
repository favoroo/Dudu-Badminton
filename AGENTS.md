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
| 改球速/接球难度 | 档位表 `config.ts` 的 `pace` 段(出货默认 = `vslow` 慢 20%);生效逻辑 [pace.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/pace.ts)(时间膨胀:重力 ×s²、速度 ×s、阻力不动);设置页「球速」滑杆存 `Settings.paceTier`,下一球起生效。**这一档只许帮真人、不许顺手帮电脑**:AI 侧有两处反折 —— `player.ts` 的 `legTierMul`(AI 腿速 ×s,真人那格仍乘移速档)与 `ai.ts` 的 `readHardness`(读球快慢走 `Pace.ref`,与 `physics.classify` 同口径);代拍的两个前瞻 `autoHorizon/autoLandHorizon` 在 `autoSwingDue` 里 `Math.ceil(Pace.frames(n))` 折成世界步(不折就是慢档看不见落点)。把 `diffs.tick/notice/timingErr` 也 ÷s 试过,**过矫得离谱**(AI 接发 99%→90%,等于惩罚电脑),已撤并留档在 ai.ts 头注;验收 `ai-check` 的「AI 强度 vs 球速档」段(配对同种子逐档比,AI 两条读数不许漂) |
| 改人物移速 | 档位表 `config.ts` 的 `gait` 段;生效逻辑 [gait.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/gait.ts);**只乘真人的 accel+vmax**(AI 走 `diffs.speed`,两层不叠),即时生效 |
| 改角色姿势/外观 | [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) |
| 改「谁穿谁的皮肤」(渲染入参副本) | [view-cache.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/view-cache.ts) 的 `viewOf(cache, 实体)` —— **副本必须按实体各存一份**,共享一个 `{}` + `Object.assign` 就是「CPU 蓝球衣顶着一头别人的橙发」的源头(只拷源对象自己有的键);身份比较走 `entityOf()`;闸门 `view-leak-check` |
| 改传说皮肤「脚下法阵」 | 画法 [aura.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/aura.ts)(零状态,只画不算),数值与配色在 `config.ts` 的 `fx.aura` 段;**别再画光滑椭圆环**(与全站 P5 语汇相反);验收 `aura-preview` |
| 改击打/轨迹/球体特效 | 数值在 `config.ts` 的 `fx` 段;丝带 [ribbon.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/ribbon.ts) + 球体运动学 [shuttle-motion.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/shuttle-motion.ts) + 粒子 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts) + 缓动 [easing.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/easing.ts);出图 `fx-preview` |
| 改胜利礼花/终局庆祝时钟 | 弹道与喷口在 `config.ts` 的 `fx.confetti` 段,池与画法在 [fx.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/fx.ts);时钟档位纯函数 [celebration.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/celebration.ts);验收 `confetti-check` |
| 改手机震动(触觉) | 强度表 `config.ts` 的 `haptic` 段;判据与排队 [haptic.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/haptic.ts);平台出口 [haptics.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/haptics.ts);Java 桥在 `native/engine/android/app/src/com/cocos/game/AppActivity.java`。**改 Java 侧必须重打 APK**;**Android 12+ 需显式声明 `USAGE_PHYSICAL_EMULATION`**(否则被归到 TOUCH 档跟着系统总闸走,静默丢掉不抛异常);波形形状这一层做过又撤了(恒幅 one-shot 是已知取舍,别再加 steps/preset);验收 `haptic-check` |
| 改 P5 视觉构件 | render 层 [p5kit.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/p5kit.ts),UI 层 [ui-arcade.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-arcade.ts) |
| 改面板层配色/斜切档 | 令牌唯一真话 [p5-tokens.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-tokens.ts)(`C` 色板、`SLANT` 只许 3/5/6/10 四档、`ROLE` 七个角色);`ARCADE`/`PAL` 是它的派生,**别再抄一份色表** |
| 改面板形状 | 形状出点列 [p5-shapes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-shapes.ts),画笔 [p5-paint.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/p5-paint.ts)(只 import cc 的 Color/Graphics ⇒ node 跑得动);**卡片用 `drawP5Card`(墨面+色带)不要整面实底**;出图 `panel-preview` |
| 改面板的可点件工厂 | [ui-shell.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-shell.ts) 的 `solidTab`/`solidBlock`/`pressable`(**一律自带 `addComponent(Button)`** —— 漏了就是「点了没反应」,闸门 `ui-click-check`) |
| 改四面板排版 | 零 cc 纯函数:`settings-layout.ts`、`campaign-layout.ts`、`drill-layout.ts`、`shop-shelf.ts`;各导出 `XOverlaps()`/`XOverflow()` 判据,统一由 `panel-check` 断言(对比度/网点/触控/溢出/文案)。**改坐标要去判据里核** |
| 改商店/生涯面板(货架 · 试衣间 · 履历格) | 面板 [career-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/career-panel.ts);**格位与格内排版全在 `shop-shelf.ts` 纯函数**(`shopTopBar`/`shopTabs`/`shopContent`/`shopStats`/`statCardDL`/`statCells`),判据 `shopOverlaps`/`shopOverflow`/`statCardFits` 由 `panel-check` 跑,出图 `panel-preview` ④⑤。两条口径:① 顶栏等级块是**两行**(称号 + EXP 读数占一行、经验条铺在正下方),条子走 `progressDL` 的 track+fill 且画在**同一个 Graphics**(旧写法槽 14 高、填充另起 10 高,斜切量按各自的高算 ⇒ 填充与槽的左沿既不重合也不平行 = 用户说的「那个条形底板不太对」);② 履历格**不压通宽实心色带**,色只走「指标名色签(`makeChip`,与货架角签同一份 `chipDL`)+ 同色引导线 + keyline」三处,大数一律纸白(斩劈红压在 navy2 墨面上只有 3.5:1,过不了 `CONTRAST_FLOOR`),副行只写真从存档算出来的数(装饰口号已删);③ 「形象」页那两行钉住的槽位 chip **让位靠裁不靠坐标** —— `accShelf(n)` 把**可视窗**整块变矮(`h = SHELF.h − accBandH(n)`,窗底不动),不是抬 padTop:chip 是半透明凹陷槽,抬 padTop 只管静止那一格,手指一滑卡片就整排穿到 chip 背后(用户 2026-10-07 现场图)。卡上三行字(名称/状态/卖点)的字号、行心、可用宽、折行截尾全在 `CARD_TEXT`/`cardLine`/`cardFxLines`(Label 默认 `Overflow.NONE`,给 w 不裁字,长一句就画到邻卡上;卖点先按「·」分段、分段装不下才按字宽折,两行还不行才截尾),面板只摆它算出来的行;判据 `panel-check` ⑬(`cardTextFits` 吃 config 真文案 + `checkShelfWiring` 扫面板源码钉两处旧写法),出图 `panel-preview` ⑦(上衣槽 14 款三行 + SVG clipPath 就是那扇变矮的窗)。**默认开在「形象」**(`show()` 的 `initialKind ?? "acc"`,2026-10-07 用户指令:进商店先看自己这一身;显式传 kind 的入口不受影响);**点卡一律只选中,进二级只有动作键/键盘 Enter 一条路**(族卡/套装卡也不例外:选中套装 = 试衣间试穿候选套装、按钮「看{套装名}的组成」;选中族卡 = 预览保持当前形象+当前脸、按钮「挑一款{族名}」—— 2026-10-07 用户口径「点一下就进去了,这样体验不好」;整套成交只许发生在二级的「一键穿戴」,`_act()` 不直调 `_actSet`,判据 `face-family-check` ⑦ 扫源码钉死)。**套装二级货架底部空带 = 「返回」+「一键穿戴」两颗键**(几何 `shopSubBack`/`shopSubAction`,判据 `shopSubOverlaps` 由 `shelf-check` 按各套装件数跑;按钮文案与成交链吃 `_setActView`/`_actSet` 一把尺、只属于二级 —— 未买齐时按钮直报补齐价 `charge`,点了 = `buy`+`equipSet`,金币/等级不够是凹陷槽只报原因)。 |
| 改「生涯里程碑」(六格达成 → 整卡点击领金币+经验,2026-10-07) | 档位表 `config.ts` 的 `MILESTONES`(**id 恒为 `ms-<stat>-<档位序号>`,阈值不进 id** —— 日后调档不换 id,老档已领记录不失义;六格之外不给隐藏统计设档,没有卡片承载);现值口径单一出口 [milestone.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/milestone.ts)(零依赖叶子:`statValue` 胜率现算 + `milestoneViews` 可领/下一档/已领满三态,**statCells 的胜率也吃它,别再内联公式**);领取链 [career.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/career.ts) 的 `Career.claimMilestone`(**经验必须走 addExp 同一条曲线**,一次点按合并发该格全部已达成未领档;无可领返回 null)+ 存档 `Profile.claimed`(老档缺键补 `[]`、手改 null 兜回,零迁移);UI 三态副行在 `shop-shelf.ts` 的 `statCells(p, max, mv?)` 第三参(可领 = 整行换金色领取行 + `cell.claim`,「下一档/已领满」缀**量过放得下才拼**,溢出退回原文案是有意的),发光 + 整卡 `pressable` 在 career-panel `_buildStatsPage`,**面板不许直改钱包**。验收 `milestone-check`(+`--selftest`)+ `panel-check` ⑤ + 出图 `panel-preview` ⑤(三态一屏看全) |
| 改「每日/每周活动」(首页底部横幅 → 活动面板,任务领金币+经验,2026-10-07) | 任务表 `config.ts` 的 `ACTIVITIES` + `CFG.activity`(**id 恒 `d-*`/`w-*` 前缀、不掺日期** —— 轮换轮的是「今天抽中哪几条」,id 池恒定;奖励量级对标 normal 胜场,别抬成印钞机);戳/轮换/重置/记录/视图唯一出口 [activity.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/activity.ts)(零 cc 叶子:`dayStamp`/`weekStamp` 本地时区、每日按日戳种子 mulberry32 抽 `dailyPick` 条 —— render 的不可反向 import,就地另写;**每日与每周各存各的 prog/claimed,跨天只清每日侧**;`claimInfo`/`markClaimed` 是领取的校验与记账两半);领取链 [career.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/career.ts) 的 `Career.claimActivity`(**经验必走 addExp 同一条曲线**,无可领返回 null)+ 存档 `Profile.quests`(老档缺键补空账;**跨天/跨周在 profile() 归一化里按戳自愈重置**,任何读取路径拿到的都是新一期,零迁移);进度记录挂在 `Career.settle` 里与 matches++/wins++ 同口径(2p 也算完成;endless 带 scores 喂 max 型)+ `settleDrill`(训练只喂 drill 维度,不算「完成一局比赛」);新完成任务由 `SettleResult.questsDone` 交给 game-root 飘字播报。UI:面板 [activity-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/activity-panel.ts)(三态:进行中=info 青 / 可领=star 黄 glow / 已领=off;进度条走 `progressDL`,已领置灰),版式纯函数 [activity-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/activity-layout.ts)(行内五格,判据吃 config 真文案;**已登记 tools/tsconfig.json include 白名单**),首页横幅入口在 main-menu.ts 底部(打击橙第 6 功能色,可领时「N 项可领」荧光黄角签),副行与面板同吃 `Career.activityViews()` 一份。验收 `activity-check`(+`--selftest` 14 份反例)+ 出图 `activity-preview` |
| 改「移动方式图示」 | [pad-diagram.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/pad-diagram.ts)(零 cc,几何全现读真值,不许另抄一份);判据在 `panel-check` ⑨,出图 `pad-diagram-preview` |
| 改「技能怎么用」演示(技能弹窗左列那格 + 放大窗) | 演示真值 [skill-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/skill-demo.ts)(零 cc,**不自己算任何一帧**:把 `Rules.newMatch`+`Rules.step` 当真机跑一遍逐帧录位置,按下那一帧是"第一次真兑现"搜出来的;分步文案的数字全现读 CFG,文案本身住这个模块、不进 config),画法 [skill-diagram.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-diagram.ts)(零 cc 出 Paint[],与 pad-diagram 同族;冷却弧共用 `input/pad-cd` 的 `cdArcs`),面板 `skill-dialog.ts`(选中即换画面、自动循环、**切档不重置时钟**;点它放大成分步窗 + 点画面定格)。**三条口径**:① 演示跑不通就整格不画(`bake()` 返回 null → 面板不建),宁缺毋假 ② 影分身局面预先 `Player.spawnShadowClone` 补满到"能到达的状态",不是画三个假剪影 ③ 人物形与 pad-diagram 共用 `personDL`(加色只走 `tint` 形参)。版式:`skill-layout.ts` 的 `demoBox`/`SD`/`slotRowFits`/`sdStackFits`,「完成」键与两颗槽位 chip 同排(底部整条让给演示盒);验收 `skill-check`(+selftest)+ `skill-demo-preview`。**第四口径(2026-10-07):这一跑必须走 `Rules.isolated()`** —— 烘焙换上一块一次性的对局状态跑、跑完原样换回(连 `newMatch` 顺手写的审计/阵风累计/关卡环境与球员修饰/两条模式门控一起复原)。直接跑在全局 `Rules.R` 上就是把玩家眼前那一局整块换掉(state 从 MENU 变 POINT、比分被改、球员换成演示那两个),而 `ui-manager` 靠轮询 `R.state` 换屏 ⇒ 症状是**「点一下技能卡片,游戏突然自己开打了」**,不崩不报错、只有真机点得到。闸门 `skill-check` F 段(selftest (j) 拿旧跑法验它有牙齿)。 |
| 改新手操作教学 | 状态机 [tutorial.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/tutorial.ts)、版式 `tutorial-layout.ts`、演示真值烘焙 [tutorial-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/tutorial-demo.ts)、手势演示动画 [tutorial-anim.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/tutorial-anim.ts)、面板 `tutorial-panel.ts`;文案表 `TUTORIAL_TOPICS` 在 config.ts;验收 `tutorial-check`(+`--selftest`)+ `tutorial-demo-preview`(两者 2026-10-05 起才真正登记进 test-all —— 之前这屏的闸门没人跑过)。**摆字口径**:`tutorial-panel.ts` 的 `mkLabel` 恒**中心锚**(盒心 = 节点位置),所以① 色带里的文字必须走 `tutorial-layout.ts` 的 `bandText()`(它交出的是节点局部 Box,左内边距 `TUT.bandPadL`)、不许在面板里写 `x: -w/2 + 12`(那是左锚语义,会把整串字往左推半个盒宽);② 画布标字 `_syncCallouts` 每帧搬节点 ⇒ Label 必须 `align: 1` 居中。两条都由 `tutorial-check` ⑤ 扫源码钉死(症状:「怎么玩」只剩「么玩」、演示标字拖出面板 —— 不崩不报错、预览里看不见,只有真机有) |
| 改训练场引导演示 | 演示真值 [drill-demo.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/drill-demo.ts)(零 cc,沿真实喂球弧线搜接触点,回球必须过 `Drill.matches`),动画 [drill-anim.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/drill-anim.ts),面板 `drill-panel.ts`;分步文案在 `config.ts` 的 `DRILLS[].demoSteps`;验收 `drill-diagram-check` |
| 主循环/事件分发 | [game-root.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/game-root.ts) |
| UI 面板/菜单 | [ui-manager.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/ui-manager.ts) |
| 作者通道(测试拉满档) | 对练屏连点**同一个**球馆 tab 6 下 → 等级满 + 金币 99999,**只在内存生效、本局不落盘**;参数 `CFG.author`(发版想关掉置 `enabled: false`)、手势判定 `mode-screen.ts` 的 `authorTap()`、执行 `career.maxOut()` |
| 改更新链路 | 入口在设置「关于」页 + 冷启动 24h 静默检查(`main-menu.ts` 的 `show()`);弹窗 [update-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/update-dialog.ts);候选源与原生下载器 [update-service.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/game/update-service.ts);发布页直链 `releasePageUrl()` 在 [version.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/version.ts)(Gitee releases API **不返回 html_url**)。弹窗挂 Canvas 并在 `show()` 里抬到最上层(否则被晚到的兄弟节点暗底压死) |
| 改「更新记录」(全部历史版本说明) | 数据真话 [release-history.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/release-history.ts)(两端 Releases 列表 JSON 洗条目;**Gitee 实测最旧在前、无 `published_at`/`draft` 字段**、tag 必须保留 v 前缀供「当前版本」标比对)+ 拉取与进程内缓存 `update-service.ts` 的 `fetchReleaseHistory()`(不落盘,冷启动重取)+ 弹窗 [history-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/history-dialog.ts)(载入/失败重试/列表三态,挂 Canvas 抬层与更新弹窗同款)。说明井的滚动(裁切/拖动/**触摸卫生**)与落屏摆字是两个弹窗共用的 [notes-scroll.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/notes-scroll.ts) / [notes-paint.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/notes-paint.ts),**别再手抄一份**;滚动方向真话在 `release-notes.noteScrollRange()`(**顶 = 负位移**:内容自上而下摆,正位移露出的是底部 —— 2026-10-05「一进来看到最旧版本」的现场就是正负用反,notes-check §5 钉死);入口按钮在 `settings-layout.ts` 的 `aboutLayout().logBtn`(「浏览器下载」让位排最右)。验收 `history-check`(+`--selftest`) |
| 改更新说明排版 | [release-notes.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/release-notes.ts),验收 `notes-check` |
| 改结算屏字 | [settle-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-panel.ts);`unlocked` 是 `SkinDef[]`,拼字符串必须先 `map(s => s.name)`(闸门 `text-object-check`) |
| 改结算屏**排版**(压字/遮挡/加一块内容) | 竖排与横排算术 [settle-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-layout.ts)(零 cc 纯函数:块高由内容算、块间距由剩余空间摊派,缝封顶 `maxGap` 后整组居中),面板只在 `place()` 一处读它的 y。**别再写死 158/124/76/-150 这类常量** —— 0.0.35 之前就是这么坏的:衬底加到 88 高把比分压进红纸背后 25px,按钮「有小字就上抬 12」把关卡目标三行切掉 6px(用户 2026-10-06 现场图,不崩不报错、只有真机看得见)。三条口径:① 「有没有下一关小字」「升级/上新几行」必须**先**算进 flags(它们改块高,进而改每一格的 y)② 缺席那一格的坐标由 `settleLayout` 的链条补上(渲染层不做条件判断)③ 整组上下边距必须等宽,不等宽就是"看着往下坠",数值判据看不见、出图看得见。验收 `settle-layout-check`(+`--selftest` 五份反例:旧写死坐标/旧上抬 12/卡片矮到装不下/整组坠到下面/超长文案)+ 出图 `settle-preview`(现场图那屏 + 七块全在场那屏 + 训练场那屏,盒子与底块都现读同一份排版) |
| 改结算谢幕演出 | 时间轴纯函数 [settle-cine.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/settle-cine.ts),消费 `settle-panel.ts` 的 `playCine`;数值在 `config.ts` 的 `fx.settleCine` 段;验收 `settle-cine-check` |
| 改「调整位置」顶栏 | [editor-strip.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/editor-strip.ts)(纯函数),验收 `strip-check` |
| 改「买人物送脸面」的捆绑 | 引用只有一条:`SKINS.player[].face` → `SKINS.face[].faceStyle`(不另存捆绑表),发放住在 [career.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/career.ts) 的 `profile()` 归一化里(`bundledFaces`,幂等 + 老档下次进来自动补票),商店文案与卡片读 `Career.linkedFace()`;验收 `shop-bundle-check`(+`--selftest` 三份反例) |
| 改「皮肤族」(货架上同类商品合成一张卡 + 二级货架 + 一次买断) | 族表 `config.ts` 的 `SKIN_FAMILIES`(成员顺序 = 二级货架顺序,首项恒是免费底款;买断价 = 族内**最贵单款**,不是各款相加),所有权与成交住在 [career.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/career.ts) 的 `ownsFamily`/`buy`,二级货架那颗「返回」键的几何与判据在 [shop-shelf.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/shop-shelf.ts) 的 `shopSubBack`/`shopSubOverlaps`。**四条口径别改回去**:① 存档里存的仍是**成员 id**(`equipped.face` / `owned`),族 id 带 `fam-` 前缀、永远不进 owned ⇒ 渲染层(faceSkin/FACE_STYLES/drawHead)零改动、老档零迁移 ② 免费底款**不算族所有权凭据**(`profile()` 人人补默认款,拿它当凭据就是白送一个付费族)③ 族内任一付费成员已入手 ⇒ 整族算已入手,老买家一颗钱都不许多收(与「买人物送脸面」同一条尺子:萌芽豆丁→雀斑、猫系少女→猫须都触发整族)④ 点族卡 = 只选中(预览保持「当前形象 + 当前装备的脸」,不试穿族里任何一款 —— `_drawLivePreview` 对族卡用 `Career.skinOf("face")` 兜);进二级货架的唯一入口是动作键「挑一款{族名}」或键盘 Enter(与套装卡同一条口径,详见「商店/生涯面板」行)。面板侧状态只有 `_fam` 一个字段,换 tab/重开面板都回整族货架;成员多到 3 行就没有摆「返回」键的空带,那时该改排版不是判据。**脸面这一族的"默认"拆成两件(2026-10-07,用户:「这个默认的怎么是个全黑呢」+「外层加一个跟随人物」)**:族里首格 `face-auto`「普通肤色」恒为 `FACE_STYLES.skin`(**id 不许改** —— 存档 `owned`/`equipped.face` 存的就是它,只换 faceStyle 与名字),旧写法把它解析成"身上那套人物自带的脸",于是穿着影分身的人在这族里看到的首格是一颗纯黑无面(不崩不报错、只有真机看得见);"跟随人物"另立一件**免费**商品 `face-follow`(`faceStyle: "auto"`,顶层单品、不进族),`drawPlayer` 只在读到 `"auto"` 时才现查 `playerSkin.face`。商店「形象」页那格要的是**候选这套**自带的脸 ⇒ 走 `career-panel.faceOfSet`,与装备位"此刻这套"分得很清(套装卡/试衣间 player tab 都吃它)。验收 `face-family-check`(+`--selftest` 反例;⑦ 钉三条源码事实:族展开排在 acc 早退之前、点卡只选中(卡片 TOUCH_END 出现 `_openFamily`/`_openBundle` 即拦,两条进二级路由必须都在 `_act()`)、faceStyle 不许有悬空 key —— 拼错一个 key 不报错,`drawHead` 静默兜墨面;另钉数据事实「各表第一项恒肤色」) |
| 改「配饰」(墨镜/口罩/围巾/球鞋/手套,四槽限一件) | 商品表 `config.ts` 的 `ACCESSORIES` + 槽位元数据 `ACC_SLOTS`(以后加槽位/配饰都在这里加数据),画法与注册表在 [acc.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/acc.ts) 的 `ACC_STYLES`(**style 没注册 = 商店有货身上永远画不出来**,`accessory-check` ①拦),佩戴/购买/卸下住在 [career.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/career.ts) 的 `equipAcc`/`unequipAcc`/`buyAcc`(与皮肤同一条 owned/金币链)。**五条口径别改回去**:① 每槽限一件 = `Profile.acc[slot]` 覆盖写,跨槽可叠加、**允许空槽**(皮肤恒穿一件,配饰没有免费默认款,坏档槽值清 `""`)② `refundDelisted` 必须 `skinById || accById` 双查 —— 只认皮肤表会把 owned 里的配饰当「已下架」静默删掉(地雷已钉进 `accessory-check` ④)③ 挂载点四处:`drawHead` 五官后(墨镜/口罩)、躯干前+脖子后两段(围巾,`AccNeck` 锚点)、腿循环替换素色鞋块(球鞋)、`drawHand` 的 glove 参数(手套,腕向由 IK 肘位现算);**影分身 `isShadow` 守卫 + CPU 不挂 ⇒ 配饰天然只有真人穿**,别把守卫删了 ④ 渲染层零状态:随机形状 `mulberry32(accSeed(def.id))` 出生定形、逐帧只做 sin/alpha,围巾飘尾走 `draw-kit` 的同一把 Frame 尺(帧/采样原语已从 sprites 抽到 `draw-kit.ts`,别再私拷)⑤ 商店 UI:顶栏一个「配饰」tab + 货架窗顶四个槽位子页签(`accSlotRow`,钉住不随滚动,货架 `accShelf()` 抬 padTop 让位),试衣间选中即试穿。验收 `accessory-check`(+`--selftest` 五份反例)+ 出图 `acc-preview`(每件三姿势试穿) |
| 改「二次确认弹窗」(重置默认前问一句) | 版式 + 文案 [confirm-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/confirm-layout.ts)(零 cc:**卡高跟着文案算**,`CONFIRM_PAD_RESET` 是两处「重置默认」共用的那一句)+ 弹窗 [confirm-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/confirm-dialog.ts)(`askConfirm()` **一次性**:建即显示、退场 destroy,不留复活路径;挂调用面板 root 并抬到最上层,不做「点遮罩=取消」——那要裸 TOUCH 监听,淡出期间就是隐形挡板)+ 要不要问的判据 `Settings.padLayoutIsDefault()`(**与 `resetPad` 同源**:七键/摇杆/滑轨/透明度,一项都没改过就直接重置、不拦人;`PAD_ALPHA_DEFAULT` 是三方共用的常量)。接线只在 `settings-panel.ts` 的 `askResetPad(inEditor)`,**两颗同名键必须都走它、`Settings.resetPad()` 全仓只许一处调用点**(闸门 `panel-check` ⑪ 扫源码钉死)。验收 `panel-check`(+`--selftest` 三份反例)+ 出图 `panel-preview` ⑥ |
| 改闯关大厅/进度/「下一关」 | 关卡表与 `getNextStage()`/`getStageByNo()` 在 [campaign.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/campaign.ts);大厅 [campaign-panel.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/campaign-panel.ts);验收 `campaign-check` |
| 改闯关「战前简报」弹窗 | [brief-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/brief-layout.ts)(纯函数)+ `campaign-panel.ts` 摆;验收 `brief-check` + `brief-preview` |
| 改虚拟按键能放在哪儿 | [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) 的 `clampDelta`(唯一约束 = 整块留在可视区内) |
| 改击球键滑动手势(左/右=落点深浅,上/下=弧线高低) | 双轴判定 [touchpad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/touchpad.ts) `trackSwingSwipe` → 数据池 [pad.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad.ts) → [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) `swingAim`/`swingLoft` → `buildShot`;数值在 `config.ts` `touchAim`/`shot.loftUpMinDeg·loftDownMaxDeg`。**短滑管一拍,长滑管到短滑解除**(和平精英长滑锁定同构设计,2026-10-05):短滑不现图标;滑出按键(dist ≥ r × `lockAppearK`)在目标位置(r × `lockTargetK` ≈78px,不超屏)浮现小锁图标 🔒 与虚线引导轨;手指滑入小锁激活范围高亮荧光黄(进入就绪态);**在小锁处松开手指才触发锁定**(中途滑回松手不锁);**锁着时任何一次短滑 = 解除**(`pad.clearSwingLocks`,锁与键值一起清、那一拍按短滑方向打、没滑到的轴回 mid,白环反馈),长滑同向=维持、反向=换向(**没有 toggle**),不滑只按=一直按锁向打;恢复路只有两条 —— `press("swing")` 与收招钩子 `restoreSwingAim`(经 `Player.consumeAutoAim` 的 `onAimConsume`),都把两轴恢复成锁值(没锁=0,即旧行为);换局 `resetPadHolds` 清锁。锁定视觉 = 键缘方向弧常亮(game-root 的 `setAimEcho` 在「辅助开 或 有锁」时喂 pad 真值)+ 锁定荧光黄/解除白色冲击环。验收 `swipe-vertical-check` + `input-check`(⑩/⑩b)+ `auto-hit-check`(⑩⑪) |
| 改技能键冷却读数 | [pad-cd.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/input/pad-cd.ts)(零 cc:`cdAlpha`/`cdArcs`/`cdText`/`drawCooldown`);取值 `config.ts` 的 `padSkin.cd` 段;验收 `pad-cd-check` + `pad-cd-preview` |
| 改 AI 难度 | 档位表 `config.ts` 的 `diffs` 段(`read`/`zone`/`shotErr`/`composure`);生效逻辑 [ai.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/ai.ts),落档 `rules.ts` 的 `applyAiTier()`;验收 `ai-check`(三档胜负口径)。**胜负带是在「出货球速档」下读的**:`pace.default` 一挪,回合长度跟着变长,每拍失误率更高的一方被磨得更狠 → 四档差被压平(2026-10-05 挪到 `vslow` 后 normal/hard 都落到 20~21%,阶梯塌了),要重铺;只动 `read`(看走眼)不动 `tick/notice`(慢半拍,用户会读成 AI 卡住),现值 60/52/50/46 → 50/33/26/16 |
| 改「影分身」(会累积的影子防线) | 用户口径 2026-10-05:「上一局的影分身可以保留到下一局，场上最多可以有三个影分身，不同影分身上的颜色是不一样的」+「保持三球额度，但只剩一次的话下个回合恢复成三次」。**四条口径别改回去**:① 边界是**跨回合(一分)**,不跨对局、**不落盘**(重开新局靠 `R.players = []` 整批丢)② `resetPoint` 只给 `hits < maxHits && despawnT <= 0` 的分身补满 —— 接满三球正在消散的那个绝不复活 ③ 上限 = `CFG.skills.shadow.slots.length`,**不单开 maxClones 键** ④ 本体恒纯黑,三色只加在辉光/pips/头圈/拍框/粒子。状态 `Player.shadowClones: ShadowCloneState[]`(恒按 `slot` 升序),**slot 才是身份**(颜色/防区/AI 档全查 `slots[slot]`;用数组长度当 slot 会让"死一个集体变色")。色走 `entity.theme.glow` 这条老通道(spawn 写、渲染读,不新增跨层字段),真话在 `config.skills.shadow.slots[].tint`。**三枚各守一块防区**(`homeOffset` 后场/中场/网前):不分区就是三坨剪影叠在同一个拦截点,颜色看不出、9 份额度砸在一块地面 —— 分段边界按相邻 homeX 中点现算(`Shadow.dutyIndex`),**别另抄一份阈值**。门控 + 槽位算术在叶子模块 [shadow-gate.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/shadow-gate.ts)(skills 不能 import shadow 会成环;门控必须进 `canActivate`,否则就是"键亮着按了没反应"),训练场/教学/2p/2v2 **不许召**:`drill.ts` 的 `matches()` 判的是 lastHitter 的**队**不看谁打的。画法在 [sprites.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/render/sprites.ts) 的 `drawShadowClone`(world 与 frame-cost 共用同一个函数,别在预览里另抄一份)。⚠ 这次是**单向增强**(ai.ts 没有 shadow 分支 ⇒ AI 拿不到;ai-check/serve-check/sim-check 的替身从不按技能键 ⇒ 三把尺子全量不到),强度看 `shadow-balance-check`。验收 `shadow-check`(+`--selftest` 13 份反例)、`shadow-preview`(+`--selftest` 5 份)、`shadow-balance-check`、`frame-cost-check`(满编档 307 笔/帧) |
| 改「时空领域」的两个时钟(世界步 vs 玩家真实时间) | 折算只有**一处出口**:[player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts) 的 `worldRate()/swingClockScale()/playerFramesToWorld()/worldToPlayerView()/inTimeDomain()`,领域里世界走 0.35 步/真实帧而挥拍按真实时间走 ⇒ 时机环锚(`swingCuePressFrames`,game-root 只调它)、代拍门槛(`autoSwingDue`)、判定区来球速度收严与放宽(`swing.zoneFastMul` + `skills.focus.zoneReachMul`)、AI 起手提前量(`ai.ts` 的 `center`)全要经这里折,再抄一份 0.35/2.86 就是第二把尺子。窗尾结算还要容得下**非整数步进**(`tryHit` 的 `tail`,只给 `step>1`)。数值 `config.ts` 的 `skills.focus` 段;验收 `focus-check` + `focus-window-check`(+`--selftest`) |
| 改主动技能(7 款,**双技能槽**) | **双槽口径(2026-10-06)**:真人最多带两个技能,场上技能1键(动作名 `lunge`,历史遗留)+技能2键(`skill2`);槽1=`p.skill`(AI/关卡对手/分身仍只有这一槽),槽2=`p.skill2`(只挂真人,`applyToMatch`)。**判据一律走 `Skills.slotOfSkill/hasSkill/slotState`**(skills.ts 三件套),不许再写 `p.skill.id === X` —— 那是单槽假设,槽2会静默失明。同拍组合语义(用户拍板):`modifyShot` 里各槽 armed 分支**数值直接叠加**(重击+怒气速度加成 4.0+4.8,物理池封顶照旧在 buildShot 兜底)、forceSmash 任一满足、消耗各源各自结清;代拍链双窗并存按链序(跨步>重击>怒气)。装备层 `Career.equipSkill(id, slot)`:**撞款即互换、槽1恒有技能**(卸下只对槽2开放,`unequipSkill`);存档 `Profile.equippedSkill2`,老档缺键补 null 零迁移。技能表与数值 `config.ts` 的 `skills` 段;状态机 [skills.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/skills.ts)(`canActivate`/`activate`/`update`/`modifyShot`);一键代拍择帧 `Player.autoSwingDue` 在 [player.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/core/player.ts);起手演出 `game-root.ts` 的 `onSkillCast()`。**两条铁律**:① 球种预告 `previewKind` 与实打共用同一条 `buildShot`,靠 `HitOpt.preview` 分流 —— 往 `modifyShot` 加任何状态消耗(`buffT`/`lungeShotT`/`flashStrikeT`/`magnetPulling`/`rage`)或记账必须过 `!preview` 闸,漏一处就是「按了没反应」;② 凡是"替真人打"的机制一律 `!p.isAI` 闸(AI 也装技能也会自己按键,而 serve-check/ai-check 的真人替身从不按技能键 ⇒ 那两把尺子量不到)。**闪现的威力随接触高度变**(2026-10-06):唯一真杠杆是 buildShot 解出弹道**之后**的速度乘算 —— `speedBoost` 池封顶 5、`powerDeg` 球高 ≥200px 顶 -24° 弧角地板,两条老杠杆都是死的(iaiStrike 同先例,飞行积分器不夹球速);曲线与顶点档在 `skills.flash` 的 `apexHeight`/`curveVx/VyMul`/`apexVx/VyMul` 五个键(乘积≈1 保落点),演出档 `ShotResult.flashApex` → hit 事件 → game-root drain 升档「苍穹制裁」,验收 `flash-check` ⑥。各款分别验收:闪现 `flash-check`、重击 `smash-check`、怒气 `rage-check`、跨步 `lunge-check`、引力吸球 `magnet-check`、时空 `focus-check`+`focus-window-check`、自动击打 `auto-hit-check`、影分身 `shadow-check`;**双槽整体**验收 `skill2-check`(+`--selftest`,selftest 把 modifyShot/activate 换回单槽版验牙齿)。**开赛闸(2026-10-06 用户指令:两槽配齐才许开赛)**:三处开赛口(对练/无限/闯关,即 ui-manager 的 doStartMatch/doStartEndlessMatch/doStartCampaign)都要过 `requireSkillsReady` → `Career.skillSlotsReady()`(槽2空且已解锁款 ≥2 才拦 —— 第二款技能 Lv.2 才解锁,新手无货可配,硬拦会永远开不了赛);拦下弹 `CONFIRM_SKILLS_REQUIRED`(文案真话在 confirm-layout.ts),「去配置」当场开技能弹窗、**不自动替人开局**;训练场/教学不跑 applyToMatch 不在闸内。接线完整性由 `panel-check` ⑫ 扫源码钉死 |
| 改技能配置弹窗排版 | [skill-layout.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-layout.ts)(纯函数)+ [skill-dialog.ts](file:///Users/a1/Documents/01Code/dudu-cocos/assets/scripts/ui/skill-dialog.ts)。双槽版(2026-10-06):顶部「技能1/技能2」槽位行(`SK.slot*`/`slotChipText`/`slotChipX`,点选=选定目标槽),卡片按钮四态文案 `skillBtnLabel`(装入槽N/换到槽N/卸下槽2/已装槽1 惰性),详情板状态四态 `skillStatus(def, unlocked, 0|1|2)`;竖排判据 `panelStackFits` 住 skill-layout,`skill-check` 消费。验收 `skill-check`(+`--selftest`)+ `skill2-check` |
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

一键跑全部(`npm test` = 编译 + [test-all.mjs](file:///Users/a1/Documents/01Code/dudu-cocos/tools/test-all.mjs)):60 个 check + 38 个 `--selftest`(数字以 test-all 开头那行打印为准),任何非零都算失败。**[test-all.mjs](file:///Users/a1/Documents/01Code/dudu-cocos/tools/test-all.mjs) 是「哪些工具存在且必须绿」的唯一事实源**,加新 check 记得登记。

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
| 引力吸球(挥拍中释放) | `magnet-check`(+`--selftest`) |
| 自动击打(辅助) | `auto-hit-check` |
| 时空减速 | `focus-check` + `focus-window-check`(+`--selftest`) |
| 影分身 | `shadow-check`(+selftest) + `shadow-preview`(+selftest) + `shadow-balance-check`(强度上界) + `frame-cost-check`(满编档) |
| 击球键纵向手势 | `swipe-vertical-check` |
| 网前击球/物理判定 | `net-shot-check` |
| AI 体力账本 | `stamina-check` |
| 闯关进度/下一关 | `campaign-check` |
| 触觉(震动) | `haptic-check` |
| BGM 结构 | `bgm-check` |
| AI 对 AI 冒烟 | `sim-check` |
| 更新说明折行 | `notes-check` |
| 更新记录(历史版本说明) | `history-check`(+`--selftest`) |
| 调整位置顶栏 | `strip-check` |
| 战前简报排版 | `brief-check` + `brief-preview` |
| 新手教学 | `tutorial-check` + `tutorial-demo-preview` |
| 技能配置弹窗 | `skill-check` |
| 双技能槽(装备/寻址/激活路由/叠加语义/领域/代拍链/pad 边沿) | `skill2-check`(+`--selftest`) |
| 技能键冷却读数 | `pad-cd-check` + `pad-cd-preview` |
| 面板退场触摸卫生 | `ui-hide-check` + `ui-click-check` |
| 文案对象字符串化 | `text-object-check` |
| P5 面板语法 | `panel-check` + `panel-preview` |
| 移动方式图示 | `pad-diagram-preview`(判据在 `panel-check` ⑨) |
| 技能演示图示(弹窗那格 + 放大窗) | `skill-check`(+selftest)+ `skill-demo-preview` |
| 特效预览 | `fx-preview` |
| 场边飘字车道 | `float-lane-check` |
| 传说皮肤法阵 | `aura-preview` |
| 启动画面 | `splash-check.py`(Python) |
| 胜利礼花/庆祝时钟 | `confetti-check` |
| 结算谢幕演出 | `settle-cine-check` |
| 结算屏竖排/横排排版(压字、遮挡) | `settle-layout-check`(+`--selftest`)+ 出图 `settle-preview` |
| 每帧渲染成本 | `frame-cost-check` |
| 渲染副本跨实体残留(谁穿了谁的装扮) | `view-leak-check` |
| 关卡环境(风等) | `wind-preview` + `env-check` |
| 商店货架 / 套装二级货架空带两颗键(返回+一键穿戴) | `shelf-check` |
| 商店捆绑(买人物送自带脸面) | `shop-bundle-check`(+`--selftest`) |
| 配饰(四槽限一件/style 注册/存档地雷) | `accessory-check`(+`--selftest`)+ 出图 `acc-preview` |
| 皮肤族(货架合并 / 一次买断 / 二级货架返回键) | `face-family-check`(+`--selftest`) |
| 商店顶栏 / 履历格排版 | `panel-check`(+`--selftest`)+ 出图 `panel-preview` ④⑤ |
| 生涯里程碑(六格达成领奖) | `milestone-check`(+`--selftest`)+ 出图 `panel-preview` ⑤ |
| 每日/每周活动(首页横幅 + 任务领奖) | `activity-check`(+`--selftest`)+ 出图 `activity-preview` |
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
11. **斜切块的「顶缘线」必须现算,不能手加 `skew/2`** — `slantQuad` 把**上缘**放在 `-skew/2`、下缘才是 `+skew/2`;旧写法在四处(block 顶缘高光 / slot 上缘压暗 / knob 高光 / 卡片高光线)统一抄了 `+skew/2`,于是顶缘线整体右偏**一个 skew**:44 高的 tab 只偏 3.8 看不出来,136 高的卡偏 11.9,右端直接戳出框外。同族第二刀:卡片顶部色带用 `slantQuad(w, bandH, skewOf(bandH))` 画,斜率按**色带自己的高**算、与卡框(按 `cardH` 算)不平行⇒ 一侧戳出卡框、一侧留缝。要「从卡上切一条带」就用 `sliceQuad`,要一条行内的横线就用 `sliceLine`/`slantEdgeX`,**别再用整块的 `±h/2` 配 `+skew/2`**。出图与真机都会露,但只有斜切角大、块又高时才看得出来。
12. **时空领域把「挥拍」换成真实时钟,所有"还剩几帧"的判据必须跟着折算** — 主循环是 60Hz 定步长 + `dt × world.timeScale()`,所以领域里"世界被拖慢"= **每个真实帧只走 0.35 个世界步**,而 `player.update` 故意让 `swingT += 1/ballSlow`(挥拍动画保持真实速度,配 4.2 倍超速跑位)。于是同一个数字在两个时钟里:`PRESS_LEAD_FRAMES = 9` 在领域外是 9 世界步,在领域内只值 3.1 世界步。旧写法里四处都在数世界步 —— 时机环的锚、代拍择帧门槛 `autoSwingDue`、判定区按来球速度的收严、AI 起手提前量 —— 全部没折,结果就是用户 2026-10-05 的「时空技能,我现在挥拍很难击中球了」:环在区心前 9 世界步喊按,那一拍 3.1 世界步就走完了峰(实测按时机环按 100% 挥空,容错从 15~17 世界步掉到 5~9)。**同族第二刀更阴**:命中窗上沿写成 `swingT <= windup+active`,步进 2.86 时那一帧落在 17.14,被 tryHit 的早退整帧吃掉 ⇒ "窗尾按账结算"永远轮不到,球在判定区里待了整个窗还是判挥空。修法 = 折算只有一个出口(`core/player.ts` 的 `worldRate/swingClockScale/playerFramesToWorld/worldToPlayerView/inTimeDomain`),越界容许只给**非整数步进**(`tail = step > 1 ? step : 0`,摊给平时会让第 18 帧用陈账出手、落点从旧账球位重启);闸门 `focus-window-check`(+4 份反例)。**这类 bug 不崩、不报错、单看每一摊都"正常",只有开领域真按一次拍才发现。**

## 尚未移植

- ⏳ 微信小游戏构建(无 build-wechat 配置;需要 AppID 与域名白名单)
