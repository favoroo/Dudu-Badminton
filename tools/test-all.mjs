#!/usr/bin/env node
// ============================================================
// 回归总入口:先 npx tsc 两遍(工具编译 + 全量类型检查),再串行跑全部 check。
// 从前 19+ 个 check 靠 CHANGELOG 里手抄的逐条命令验收,新增工具很容易忘了跑
// —— 这份清单就是「哪些工具存在且必须绿」的唯一事实源,加新 check 记得登记。
// 用法: npm test(= test:build + 本脚本)
// ============================================================
import { spawnSync } from "node:child_process";

/** 全部 check:进程内断言 + exit 码,任何非零都算失败 */
const CHECKS = [
  "probe",
  "drill-check",
  // 引导演示的真值闸门:钉住「演的那一拍就是判的那一拍」(旧版画的是手编抛物线)
  "drill-diagram-check",
  // 六关 × 四步定格出图 + 锚帧自洽(不登记就等于没人跑,而这一屏的赌注是观感)
  "drill-diagram-preview",
  // 新手操作教学:版式 + 文案 + 门控行为 + 摆字锚点。AGENTS.md 一直写着「验收 tutorial-check」,
  // 但它**从没登记进这张表** —— 于是 0.0.24 起「击球有 4 条讲解」这条结构断言一直红着没人看见,
  // 而色带文字锚点写错(「怎么玩」只剩「么玩」)这类只有真机才看得出来的事,更没人跑。
  "tutorial-check",
  // 三主题演示出图(标字/手势/球路与真机同一批多边形)。0.1s 的代价,和 drill-diagram-preview
  // 同一条理由:不登记就等于没人跑 —— 而它是套件里唯一能看见「演示那一屏」的东西。
  "tutorial-demo-preview",
  // 四面板语法闸门。从前**根本没登记进这张表** —— 对比度/网点/触控/溢出/文案五类判据
  // 只在人肉跑 panel-check 时才生效,「哪些工具存在且必须绿」这份唯一事实源漏了它。
  "panel-check",
  // 移动方式图示(操控页右半格):这一屏的赌注是观感,断言只能证明「不出框、不 NaN、
  // 三档不一样、滑轨真的 1:1」,证明不了「一眼看得懂」。出图不登记就等于没人跑
  // (与 drill-diagram-preview / aura-preview 同一条理由)。判据本体在 panel-check ⑨。
  "pad-diagram-preview",
  // 技能演示图示(详情板左列那一格 + 放大窗):断言的是「演示真跑得出兑现」——
  // 七款各自按下当帧必须进了状态、命中事件必须归这一款、标注里的数字必须与 CFG 逐字相同。
  // 它坏的方式是静默的:局面摆不出效果 → 烘焙返回 null → 面板那块干脆不画(宁缺毋假),
  // 没有这道闸门就没人知道哪几款悄悄没了演示。
  "skill-demo-preview",
  "serve-check",
  "reach-check",
  "ai-check",
  // AI 体力账本的闸门:成本表是纯函数打表(替身从不杀球,「重杀才掉/软球回气」
  // 只有这里验得到);发球零成本、直觉钉子、归一化契约都钉在这份工具里
  "stamina-check",
  "sim-check",
  "flash-check",
  // 百分百重击附魔:钉住「球种预告是纯预览」与「技能的质量改写真的生效」。
  // 这两条坏都不会崩,只会安静地"按了没反应",flash-check 走的是 Rules.step、根本不喂
  // previewKind,所以旧代码在那边全绿 —— 判据必须常驻这张表。
  "smash-check",
  // 怒气重击(第 7 款):整局攒资源 + 按档位兑现 + 一键代拍。它坏的方式全是"静默"的 ——
  // 预告抽干怒气、四档塌成一档、一次施放吃掉多拍、释放那拍自己给自己充能,没有一个会崩。
  "rage-check",
  // 跨步自动回球(0.0.26):一键「跨过去 + 把这一拍打完」。坏法全都不崩不报错 ——
  // 按早按晚(变挥空)、替玩家捞该落地的界外球、抢玩家自己那一拍、以及偷偷给 AI 也开
  // (serve-check / ai-check 的真人替身从不按技能键,量不到这条),所以逐格判据必须常驻。
  "lunge-check",
  // 引力吸球(magnet · 空间掌控)改"挥拍中也能释放":按下即接管正在进行的这一拍。
  // 旧门槛 `p.swingT < 0` 让连打真人长期键灰按了没反应,而被它锁住的那段恰是它要救的现场。
  // 五种坏法全静默(挥拍闸还在 / 接管不清账本 / 拒了还扣冷却 / 偷偷也给 AI 开 / 键面无原因),
  // serve-check / ai-check 的真人替身从不按技能键 ⇒ 量不到,逐格判据必须常驻。
  "magnet-check",
  // 自动击打(辅助模式):全局"系统替玩家起手每一拍"。它复用 lunge/smash/rage 那条择帧尺子,
  // 所以坏法同样是静默的 —— 把发球也代了(发球类型是玩家的手艺)、白吃判定区尾段倍率(免费手长)、
  // 抢玩家自己那一拍、训练场/教学也被代打(那两处判的就是"你会不会这一拍")、关掉不干净
  // (serve-check / ai-check / sim-check 的替人基线会一起漂)。九段判据逐格钉住这些。
  "auto-hit-check",
  // 时空减速(0.0.28): 结束逻辑改接球后缓释结束 + 击球大幅强化 + 效果彻底结束后才进冷却
  "focus-check",
  // 时空领域的「两个时钟」(用户 2026-10-05 现场:「挥拍很难击中球了」)。领域把世界拖到
  // 0.35 步/真实帧、挥拍却按真实时间走 ⇒ 时机环的锚 / 代拍择帧 / 判定区收严 / 窗尾结算
  // 四处全还在数世界步。坏法不崩不报错,只在真机上"按了就是打不到",必须常驻。
  "focus-window-check",
  // 影分身(0.0.28 上线;0.0.29 改成"跨回合保留 + 同场最多三个 + 三色"):一分一召、代接三球
  // 消散、玩家自己接不计数、**上一回合没耗尽额度的分身这一回合补满**。坏法全都不崩不报错 ——
  // 同分连召、分身塞进名单污染计分口径、玩家接球也记账、每分仍清场、把正在消散的那个复活、
  // 三色塌成一色、用数组长度当槽位(死一个集体变色)、三个全追同一颗球,都只能靠这里拦。
  "shadow-check",
  // 影分身强度上界:这次是**单向增强**(ai.ts 没有 shadow 分支 ⇒ AI 拿不到,而 ai-check /
  // serve-check 的真人替身从不按技能键、sim-check 是 AI vs AI),三把现成尺子全都量不到。
  // 所以"攒满三个之后玩家还剩多少事做"必须有一支自己的数,否则失衡不会让任何东西变红。
  "shadow-balance-check",
  // 击球键纵向手势:上滑挑高 / 下滑平抽,与左右滑(落点深浅)组合成「落点 × 弧线」
  // 二维瞄准。坏法不崩不报错 —— 下托分支被拆掉(怎么滑都打不出高球)、压平漏电
  // (低点下网自杀)、手势漏进跳杀/发球、没滑的那拍被带偏 —— 都只能靠这里的格子拦。
  "swipe-vertical-check",
  "campaign-check",
  "haptic-check",
  // 场边飘字「车道整层重排」:两代叠字现场(0.0.23 的 min(n,2) 封顶、0.0.24 的
  // 触底夹取)都坏在「不崩、只是安静地叠成一坨」—— 0.0.24 落地时漏登了这张表
  "float-lane-check",
  "env-check",
  // 第 1 关的风:出图 + 断言「画在不在玩家看得见的地方」——
  // 上一版风丝漏了 vp 换算,动画做了却整片飘出屏幕,这条钉子必须常驻
  "wind-preview",
  "notes-check",
  // 「更新记录」数据链:Releases 列表 JSON → 版本条目 → 说明排版。坏法全静默 ——
  // 草稿/预发布没滤、日期缺失插队、tag 被剥 v 前缀导致「当前版本」标永不亮、
  // 空正文开空块,只有打开弹窗才知道,判据必须常驻
  "history-check",
  "strip-check",
  "brief-check",
  "skill-check",
  // 双技能槽(2026-10-06):装备互换/槽寻址/激活路由/叠加语义/领域到期/代拍链/pad 边沿,
  // 防的是"单槽假设漏改"这一族不崩不报错、只有真机把技能装进槽2才露馅的病。带 selftest。
  "skill2-check",
  "pad-cd-check",
  "ui-hide-check",
  // 文案里的对象被字符串化(结算屏「新品上架:[object Object]」现场)。吃 tsc 剩下的两个洞:
  // `${obj}` 插值与 `对象[].join()` / `"x"+obj` / `String(obj)` —— 全都合法、不崩、不报错,
  // 只会把玩家看得见的字糊成占位符。用 TS 编译器 API 读真实类型,不是正则糊一个。
  "text-object-check",
  "ui-click-check",
  "shelf-check",
  // 商店捆绑:买了人物形象 ⇒ 他自带的那张脸面一起到手(用户 2026-10-06「而不是要再购买一次」)。
  // 坏的时候不崩,只有面部 tab 那一行仍写着「金币 88」—— 只有商店里看得见,所以必须进闸门。
  "shop-bundle-check",
  // 配饰系统:四槽单选/可不戴/style 已注册/坏槽值清空/owned 里的配饰不被当「下架皮肤」删掉
  // (refundDelisted 只认皮肤表就是配饰上线换来的地雷)/applyToMatch 只挂真人。坏法全都不崩
  // 不报错 —— 配饰凭空消失或全员戴围巾,只有真机看得见。
  "accessory-check",
  // 面部货架「族」:四款同族脸面合成一张卡 + 一次买断族内随意换(用户 2026-10-06)。
  // 三种坏法都不崩不报错,只有商店里那行字/那一格不对,所以判据必须进闸门。
  "face-family-check",
  // 生涯里程碑(2026-10-07):六格统计达成 → 整卡点击一次性领金币+经验。
  // 坏法(重复领/未达标放行/绕开 addExp 另抄曲线/老档缺 claimed 键崩)全都不崩不报错,
  // 只有真机点那一下才知道,所以表/视图/领取链/接线全量进闸门。
  "milestone-check",
  // 拆件重构(2026-10-06):13 套人物皮肤摊成 12 槽单件之后,合成出的形象必须与拆件前**逐键相等**。
  // 坏法一条都不崩 —— 漏搬一根旋钮(hairColor)就是上线那天所有人发型变默认,而商店预览还是对的
  // (预览走另一条 picks),只有进场比赛才看得见;迁移顶掉玩家已有的球鞋 = 花过钱的东西凭空消失。
  "look-compose-check",
  // 套装「补齐差价」:空手报价必须 == 老原价(不许把拆件变成全线涨价),已拥有的件绝不二次收钱,
  // 免费底款不计入合计。三条坏法都只体现为"那行字和扣的钱不对",所以判据必须进闸门。
  "set-price-check",
  "settings-check",
  "input-check",
  "spec-shot-check",
  // BGM 结构闸门:内存重渲断言 stem 同长同相/峰值/RMS 基线/循环接缝/声道数
  // (烘焙脚本 tools/bake-bgm.ts 是 BGM 唯一事实源,改动音色/乐谱必须过这道)
  "bgm-check",
  // 传说皮肤脚下法阵:出图 + 九何判据(包络/扁率/预算/淡出/LOD/对转)。
  // 这一屏崩不了、也不报错,坏只会坏成「还是很难看」或「某层没跟地面透视对齐」,
  // 不登记进这张表就等于没人跑。
  "aura-preview",
  // 影分身三色出图 + 几何判据(三色通道差 / 本体没被染色 / 辉光出生定形 / pips 错行且
  // 不压头圈 / 每枚笔画预算)。这一屏的赌注全是观感:三色塌成一色、pips 连成一条横杠、
  // 辉光把亮球场糊成一片,都不崩不报错 —— 与 aura-preview 同一条理由,不登记就没人跑。
  "shadow-preview",
  // 配饰试穿出图:每件上身三种姿势都比基线多笔画(style 未注册/挂载漏接在这现形)、
  // 坐标有限、同帧确定、静置画非空 —— 与 aura-preview 同一条理由,不登记就没人跑。
  "acc-preview",
  // 形象合成出图:13 套逐套「老路径(直接挂 def)vs 新路径(逐槽合成)」同帧 drawPlayer 的
  // 笔画流必须**逐字相同**(颜色+线宽+几何全进签名)。look-compose-check 证的是字段相等,
  // 这一支证的是画出来一样 —— key 改了名、或某处读 theme 不读 skin,只有这一支抓得到。
  "look-preview",
  // 每帧渲染成本护栏:headless 跑一段真对局,按真实分频节奏计 fill/stroke,
  // 钉住稳态/峰值预算 —— 分频被回退、装饰件被挪回每帧重绘、采样段数被调大,
  // 都不会崩、只会让中低端机安静变卡,靠这道闸拦住
  "frame-cost-check",
  // 胜利礼花:终局庆祝段的时钟档位 + 弹道(升起来 / 落回地 / 收得回去) + 喷口必须在
  // 结算卡外侧那条看得见的带里 + 绘制零分配。这类坏法不崩不报错,sim-check 不跑渲染、
  // frame-cost-check 从不放礼花 —— 不登记就等于没人跑。
  "confetti-check",
  // 结算谢幕演出:胜负两条入场路径必须分化(斜带/星芒/轻震仅胜利,冷幕缓沉仅失败)、
  // 时间不打架、总时长不超防拖沓红线、训练模式不出仪式。入场演出坏了一切静默,
  // 只有这份判据能点名。
  "settle-cine-check",
  // 结算屏竖排排版(用户 2026-10-06 现场:「有些被遮挡了」)。比分压在 VICTORY 红衬底
  // 背后 25px、三条关卡目标被行动钮切掉 6px —— 两处都不崩、不报错,出图脚本也看不见
  // (要真机打一局闯关通关才有)。排版搬进 ui/settle-layout.ts 后由这里逐场景量。
  "settle-layout-check",
  // 结算屏三屏出图(现场图那一屏 / 七块全在场的最坏一屏 / 训练场)。缝 7px 挤不挤、
  // 标语衬底收到 78 还站不站得住,断言量不出来 —— 与 aura-preview 同一条理由,不登记就没人跑。
  "settle-preview",
  // 渲染入参副本的「跨实体残留」:world 从前全场共用一个副本对象,而 Object.assign 只拷
  // 源对象自己有的键 ⇒ CPU 身上没有的 playerSkin/racketSkin/faceSkin 留着上一名球员的,
  // 蓝球衣顶着一头别人的橙发(用户 2026-10-05 现场)。同一个副本还让 ball.owner === p 恒假,
  // 发球托球姿势只在商店里亮过。不崩不报错、frame-cost-check 自己另抄循环量不到 —— 常驻。
  "view-leak-check",
];

/** 带反例的 check:--selftest 必须也绿(规则脚本最怕悄悄全绿) */
const SELFTESTS = [
  "flash-check",
  "lunge-check",
  "smash-check",
  "rage-check",
  // 引力吸球六份反例(挥拍闸复活 / 接管不清账本 / 拒了扣冷却 / AI 闸被偷改 / 键面无原因 /
  // preview 偷吃 magnetPulling)—— 与 auto-hit-check 同一条理由,反例不在表里就等于没人再跑
  "magnet-check",
  // 九份反例(不择帧 / 接管发球 / 白送手长 / 偷偷给必中 / 模式漏 / 去限次 / 界外豁免失效 /
  // 门控分叉 / 代拍压深)。写这套判据时有三条反例第一版是**哑**的(界外豁免自量自、限次从没被逼到、
  // 发球只拆一道闸),靠这轮 --selftest 才抓出来 —— 反例不在表里就等于没人再跑。
  "auto-hit-check",
  "focus-check",
  // 领域时钟四件套的折算全部走 core/player.ts 一处算术,反例=把某一处退回"不折算/世界步口径"
  "focus-window-check",
  "campaign-check",
  "haptic-check",
  "float-lane-check",
  "env-check",
  "strip-check",
  "brief-check",
  "skill-check",
  "skill2-check",
  "pad-cd-check",
  "ui-hide-check",
  // 垃圾输入(null/数字/字符串/残缺数组)必须归零且不炸 —— 洗数据函数最怕悄悄出脏条目
  "history-check",
  // 四种「对象进字符串槽位」的出口各一份坏样本必须被点名,四份合法写法必须放行
  "text-object-check",
  "shelf-check",
  // 反例:不捆绑(旧写法)/ 把 faceStyle 当商品 id / 不看 owned 硬塞
  "shop-bundle-check",
  // 反例:style 未注册 / 未拥有也接受 / 坏槽值不清洗 / owned 里的配饰被当下架皮肤删 / 同槽不覆盖
  "accessory-check",
  // 反例:把免费底款当买断凭据 / 只交付所点那一款 / 已入手还二次收族价
  "face-family-check",
  // 反例:阈值不递增 / 阈值写进 id / 缺档 / 零奖励 / 混入六格外的键 / 视图漏报可领 /
  // 已领计入合计 / nextAt 指向已领档 / UI 直改钱包 / 面板漏接领取
  "milestone-check",
  // 反例:合成漏搬一根旋钮 / 迁移顶掉玩家已有的挂件 / 穿戴没有一次性闸门(换掉的单件被抹回)
  "look-compose-check",
  // 反例:各件相加(= 全线涨价)/ 已拥有还二次收钱 / 免费底款计入合计
  "set-price-check",
  "spec-shot-check",
  "drill-diagram-check",
  "panel-check",
  // 反例:旧式无条件放行的门控、手编贝塞尔的假演示真值、0.0.32 那两份「左缘当盒心」的摆字源码
  "tutorial-check",
  "stamina-check",
  "aura-preview",
  // 反例:三色填成同一色 / 身份色写成纯黑 / 辉光浓度拉爆 / pips 不错行 / 辉光逐帧重掷
  "shadow-preview",
  "frame-cost-check",
  // 反例:旧时钟(frozen 一律 still → 礼花一帧不走)、旧弹道(g=0.02 无阻力 → 出屏顶、
  // 永不落地)、旧一口居中(全打在结算卡背后)、旧绘制(逐片 new 两个数组)
  "confetti-check",
  // 反例:旧单一快路径(胜负没分化)、拖沓档(卡片 3s 后才来)、阶梯过大(逐行变逐个报幕)
  "settle-cine-check",
  // 反例:0.0.35 之前那套写死的 y(比分压在衬底里、目标行被按钮切掉)、把旧「上抬 12」
  // 装回新排版、卡片矮到装不下、超长文案的三种横排溢出 —— 五份必须被点名
  "settle-layout-check",
  // 反例:全场共用一个副本(必须真的复现"CPU 穿上真人的装扮")、旧 world.ts/sprites.ts 源码片段
  "view-leak-check",
];

let failed = 0;
const t0 = Date.now();

const run = (name, args) => {
  const t = Date.now();
  const r = spawnSync("node", [`.tools-build/tools/${name}.js`, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t;
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${args.length ? " --selftest" : ""}  (${(ms / 1000).toFixed(1)}s)`);
  if (!ok) {
    const out = `${r.stdout || ""}\n${r.stderr || ""}`.trim().split("\n");
    console.log(out.slice(-18).map((l) => `    ${l}`).join("\n"));
  }
  return ok;
};

console.log(`=== 回归套件:${CHECKS.length} 个 check + ${SELFTESTS.length} 个 selftest ===\n`);
for (const c of CHECKS) run(c, []);
for (const s of SELFTESTS) run(s, ["--selftest"]);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${failed === 0 ? "✓ 全部通过" : `✗ ${failed} 项失败`}(${secs}s)`);
console.log("注:env-check 的 ☰ 条目是显式豁免(关卡机制视觉缺失,阶段 5 TODO),不算失败。");
process.exit(failed === 0 ? 0 : 1);
