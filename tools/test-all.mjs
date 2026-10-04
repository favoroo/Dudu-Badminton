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
  // 四面板语法闸门。从前**根本没登记进这张表** —— 对比度/网点/触控/溢出/文案五类判据
  // 只在人肉跑 panel-check 时才生效,「哪些工具存在且必须绿」这份唯一事实源漏了它。
  "panel-check",
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
  // 自动击打(辅助模式):全局"系统替玩家起手每一拍"。它复用 lunge/smash/rage 那条择帧尺子,
  // 所以坏法同样是静默的 —— 把发球也代了(发球类型是玩家的手艺)、白吃判定区尾段倍率(免费手长)、
  // 抢玩家自己那一拍、训练场/教学也被代打(那两处判的就是"你会不会这一拍")、关掉不干净
  // (serve-check / ai-check / sim-check 的替人基线会一起漂)。九段判据逐格钉住这些。
  "auto-hit-check",
  // 时空减速(0.0.28): 结束逻辑改接球后缓释结束 + 击球大幅强化 + 效果彻底结束后才进冷却
  "focus-check",
  // 影分身(0.0.28): 一分一召、代接三球消散、玩家自己接不计数。坏法全都不崩不报错 ——
  // 同分连召、分身塞进名单污染计分口径、玩家接球也记账,都只能靠这里的判据拦。
  "shadow-check",
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
  "strip-check",
  "brief-check",
  "skill-check",
  "pad-cd-check",
  "ui-hide-check",
  // 文案里的对象被字符串化(结算屏「新品上架:[object Object]」现场)。吃 tsc 剩下的两个洞:
  // `${obj}` 插值与 `对象[].join()` / `"x"+obj` / `String(obj)` —— 全都合法、不崩、不报错,
  // 只会把玩家看得见的字糊成占位符。用 TS 编译器 API 读真实类型,不是正则糊一个。
  "text-object-check",
  "ui-click-check",
  "shelf-check",
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
];

/** 带反例的 check:--selftest 必须也绿(规则脚本最怕悄悄全绿) */
const SELFTESTS = [
  "flash-check",
  "lunge-check",
  "smash-check",
  "rage-check",
  // 九份反例(不择帧 / 接管发球 / 白送手长 / 偷偷给必中 / 模式漏 / 去限次 / 界外豁免失效 /
  // 门控分叉 / 代拍压深)。写这套判据时有三条反例第一版是**哑**的(界外豁免自量自、限次从没被逼到、
  // 发球只拆一道闸),靠这轮 --selftest 才抓出来 —— 反例不在表里就等于没人再跑。
  "auto-hit-check",
  "focus-check",
  "shadow-check",
  "swipe-vertical-check",
  "campaign-check",
  "haptic-check",
  "float-lane-check",
  "env-check",
  "strip-check",
  "brief-check",
  "skill-check",
  "pad-cd-check",
  "ui-hide-check",
  // 四种「对象进字符串槽位」的出口各一份坏样本必须被点名,四份合法写法必须放行
  "text-object-check",
  "shelf-check",
  "spec-shot-check",
  "drill-diagram-check",
  "panel-check",
  "stamina-check",
  "aura-preview",
  "frame-cost-check",
  // 反例:旧时钟(frozen 一律 still → 礼花一帧不走)、旧弹道(g=0.02 无阻力 → 出屏顶、
  // 永不落地)、旧一口居中(全打在结算卡背后)、旧绘制(逐片 new 两个数组)
  "confetti-check",
  // 反例:旧单一快路径(胜负没分化)、拖沓档(卡片 3s 后才来)、阶梯过大(逐行变逐个报幕)
  "settle-cine-check",
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
