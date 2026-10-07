// ============================================================
// 结算屏排版闸门 —— 防的是用户 2026-10-06 那张现场图:「这里显示排版优化一下,
// 有些被遮挡了」。VICTORY 结算屏两处压字:
//   ① 比分「21 : 19」整个压在 88 高的斩劈红衬底背后,只露下半截;
//   ② 三条关卡目标(★1 取胜 / ★2 飞扑 0/3 / ★3 失分 0/2)被行动钮切掉半截 ——
//      按钮在有「下一关小字」时整排上抬 12,而目标行钉在 -150。
// 两处都不崩、不报错,出图脚本也看不见(要真机打一局闯关通关才有),所以只有排版
// 判据能钉住 —— 与战前简报「全部都显示到外面去了」(brief-check)同一族病。
//
// 排版本体在 assets/scripts/ui/settle-layout.ts(纯函数:块高由内容算、块间距由
// 剩余空间摊派)。这里对**全场景组合**断言四条:
//   1) 任何两个元素互不压(竖直盒子不相交 —— 这一屏每块都通宽横排);
//   2) 任何一块都不探出卡片,卡片不顶穿屏幕上下缘;
//   3) 横排三件事:行动钮整排不出卡宽、关卡目标整行不出卡宽、称号不飘出胶囊色带、
//      按钮下的小字不飘出卡片 —— 全部拿 20 关真文案逐关量;
//   4) 结构不跑跑偏:标语永远在最上、比分在衬底之下、目标行在按钮之上(顺序钉子)。
// --selftest 拿**旧的那套写死坐标**当反例:两处压字必须被点名,否则规则脚本是哑的。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/settle-layout-check.js [--selftest]
// ============================================================
import { makeChecker } from "./harness";
import { CAMPAIGN_STAGES } from "../assets/scripts/core/campaign";
import type { StarFacts } from "../assets/scripts/core/campaign";
import { objectiveResults } from "../assets/scripts/core/campaign-hud";
import { textW } from "../assets/scripts/core/text-metrics";
import {
  SETTLE, actionsH, badgeFits, captionFits, actionRowFits, condRow, condRowFits, headH, itemsCollide,
  newsH, rewardsH, settleCentering, settleCollisions, settleLayout, settleOverflow, stageY, statsH,
  type ActLike, type SettleFlags, type SettleItem, type SettleLayout,
} from "../assets/scripts/ui/settle-layout";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

console.log("结算屏:块高由内容算、间距由剩余摊派 → 不压字、不出卡片\n");

/** 一屏结算的全部输入(排版只认 flags,文案只进横排判据) */
interface Scene {
  name: string;
  flags: SettleFlags;
  acts: ActLike[];
  caption: string;
  conds: string[];
  badge: string;
}

const MENU: ActLike = { text: "返回主菜单", size: 16 };

// ---------- 场景表:与 settle-panel.buildActions / ui-manager.settlePayload 同一套分支 ----------

const scenes: Scene[] = [];

/** 闯关 20 关:通关有下一关 / 第 20 关通关 / 挑战失败,三套按钮 + 三套小字 + 三条目标 */
for (const st of CAMPAIGN_STAGES) {
  const next = CAMPAIGN_STAGES.find((s) => s.stageNo === st.stageNo + 1) ?? null;
  const capNext = next
    ? `第 ${next.stageNo} 关「${next.title}」· ${next.deathmatch ? "一球生死战" : `抢 ${next.targetScore} 分`}`
    : `全部 ${CAMPAIGN_STAGES.length} 关已通关 · 「${st.title}」是最后一关,想冲三星随时重打`;
  // 目标读数取**最坏句长**:atMost 家族可以报出超额的大数(「失分 99/2」),
  // 占比家族会带两个 % —— 短句没事,长句才会推出卡片,所以按长的那头量。
  const fat: StarFacts = {
    won: true, myScore: 99, opScore: 99, longestRally: 99,
    hits: 99, smashes: 99, sweets: 99, perfects: 99, whiffs: 99,
    lungeShots: 99, jumpSmashes: 99, iaiStrikes: 99, skillCasts: 99,
    deepShots: 99, netIntercepts: 99, airHits: 99, empReturns: 99,
    zonePenalties: 99, exhausted: 99, serveFaults: 99, smashScores: 99,
    slidingScores: 99, laserBoosts: 99, lastSmash: true,
  };
  const conds = objectiveResults(st, fat).map((c, i) => `★${i + 1} ${c.detail}`);
  const tag = `ST${st.stageNo} ${st.title}`;
  scenes.push({
    name: `${tag} · 通关有下一关`,
    flags: { match: true, badge: true, rewards: true, newsLines: 2, conds: 3, caption: !!next },
    acts: next
      ? [{ text: `下一关 ▶ 第 ${next.stageNo} 关`, size: 16 }, { text: "重打本关", size: 15 }, MENU]
      : [{ text: "返回主菜单", size: 16 }, { text: "重打本关", size: 16 }],
    caption: capNext, conds,
    badge: `★ 关卡突破 · ${st.title} (${st.badge})`,
  });
  scenes.push({
    name: `${tag} · 挑战失败`,
    flags: { match: true, badge: true, rewards: true, newsLines: 0, conds: 3, caption: false },
    acts: [{ text: `再战第 ${st.stageNo} 关`, size: 18 }, MENU],
    caption: "", conds,
    badge: `挑战失败 · ${st.title}`,
  });
}

/** 普通对练 / 无限练习:有称号、有关场数据、没有关卡目标 */
scenes.push({
  name: "对练 · 胜", flags: { match: true, badge: true, rewards: true, newsLines: 1, conds: 0, caption: false },
  acts: [{ text: "再来一局", size: 18 }, MENU], caption: "", conds: [],
  badge: "旗开得胜",
});
scenes.push({
  name: "无限 · 新纪录", flags: { match: true, badge: true, rewards: true, newsLines: 2, conds: 0, caption: false },
  acts: [{ text: "再来一局", size: 18 }, MENU], caption: "", conds: [],
  badge: `∞ 练习新纪录 · 单局 999 分`,
});
/** 2p 友谊赛不发奖励:整块奖励区缺席,少一块的同时缝要跟着摊开 */
scenes.push({
  name: "2p · 不发奖励", flags: { match: true, badge: true, rewards: false, newsLines: 0, conds: 0, caption: false },
  acts: [{ text: "再来一局", size: 18 }, MENU], caption: "", conds: [], badge: "势均力敌",
});
/** 训练场:没有比分(亮关卡名 + 星)、没有称号、没有关卡目标 */
scenes.push({
  name: "训练场 · 六星", flags: { match: false, badge: false, rewards: true, newsLines: 2, conds: 0, caption: false },
  acts: [{ text: "再练一次", size: 18 }, MENU], caption: "", conds: [], badge: "",
});
/** 极端:六块全在场 + 两条新闻 —— 摊派缝必须还够得着下限 */
scenes.push({
  name: "极端 · 全块在场", flags: { match: true, badge: true, rewards: true, newsLines: 2, conds: 3, caption: true },
  acts: [{ text: "下一关 ▶ 第 20 关", size: 16 }, { text: "重打本关", size: 15 }, MENU],
  caption: "第 20 关「一球生死战」· 抢 21 分", conds: ["★1 绝杀扣杀", "★2 空中占比 100%/60%", "★3 失分 99/2"],
  badge: `★ 关卡突破 · ${CAMPAIGN_STAGES.reduce((a, b) => (textW(a.title, 13) >= textW(b.title, 13) ? a : b)).title} (最长副标)`,
});

// ---------- ① 逐场景:不压字、不出卡片、缝不塌 ----------

const seen = new Set<string>();
let tightest = { name: "", gap: Infinity };
for (const s of scenes) {
  const L = settleLayout(s.flags);
  if (!seen.has(s.name)) seen.add(s.name);

  const col = settleCollisions(L);
  ok(col.length === 0, `${s.name}:互不压${col.length ? ` → ${col.join(" / ")}` : ""}`);
  const ovr = settleOverflow(L);
  ok(ovr.length === 0, `${s.name}:不出卡片/屏幕${ovr.length ? ` → ${ovr.join(" / ")}` : ""}`);
  const ctr = settleCentering(L);
  ok(ctr.length === 0, `${s.name}:整组居中${ctr.length ? ` → ${ctr[0]}` : ""}`);
  ok(L.gap >= SETTLE.minGap - 0.01, `${s.name}:摊派缝 ${L.gap.toFixed(1)} >= 下限 ${SETTLE.minGap}`);
  if (L.gap < tightest.gap) tightest = { name: s.name, gap: L.gap };

  const ar = s.acts.length ? actionRowFits(s.acts) : [];
  ok(ar.length === 0, `${s.name}:行动钮整排不出卡宽、文案塞得进自己那颗${ar.length ? ` → ${ar.join(" / ")}` : ""}`);
  const cr = s.conds.length ? condRowFits(s.conds) : [];
  ok(cr.length === 0, `${s.name}:关卡目标排不出卡宽${cr.length ? ` → ${cr.join(" / ")}` : ""}`);
  const cf = s.caption ? captionFits(s.caption) : [];
  ok(cf.length === 0, `${s.name}:按钮下小字不飘出卡片${cf.length ? ` → ${cf.join(" / ")}` : ""}`);
  const bf = s.badge ? badgeFits(s.badge) : [];
  ok(bf.length === 0, `${s.name}:称号不飘出色带${bf.length ? ` → ${bf.join(" / ")}` : ""}`);
}
ok(scenes.length >= 45, `场景表覆盖 ${scenes.length} 套(20 关 × 2 + 五种非闯关 + 极端)`);
console.log(`  · 最紧的一套:${tightest.name}(缝 ${tightest.gap.toFixed(1)}px)`);

// ---------- ② 顺序钉子:谁必须在谁上面 ----------

function order(L: SettleLayout, a: string, b: string): boolean {
  return L.items.find((i) => i.key === a)!.top > L.items.find((i) => i.key === b)!.top;
}
const full = settleLayout({ match: true, badge: true, rewards: true, newsLines: 2, conds: 3, caption: true });
ok(order(full, "verdict", "score"), "标语衬底在比分之上");
ok(order(full, "score", "badge"), "比分在荣誉胶囊之上");
ok(order(full, "badge", "stat0"), "荣誉胶囊在战报第一行之上");
ok(order(full, "stat1", "coin"), "战报第二行在奖励行之上");
ok(order(full, "coin", "bonus"), "奖励大数在明细之上");
ok(order(full, "bonus", "bar"), "明细在经验条之上");
ok(order(full, "bar", "news"), "经验条在升级/上新之上");
ok(order(full, "news", "obj"), "升级/上新在关卡目标之上");
ok(order(full, "obj", "buttons"), "关卡目标在行动钮之上(旧写法正是这一对被按钮切了半截)");
ok(order(full, "buttons", "caption"), "行动钮在下一关小字之上");
ok(full.items.length === 12, `全块在场时 12 个元素(衬底/比分/胶囊/战报×2/奖励×3/新闻/目标/钮/小字),拿到 ${full.items.length}`);

// ---------- ③ 块高与常量同源:渲染层照这些数摆,别在面板里再抄一遍 ----------

ok(statsH() === 2 * SETTLE.cellH + SETTLE.cellGap, `战报块高 ${statsH()} = 两行格 + 一条行缝`);
ok(rewardsH() > SETTLE.coinH + SETTLE.bonusH + SETTLE.barH, `奖励块高 ${rewardsH()} 含两条内部缝`);
ok(newsH(9) === SETTLE.newsMaxLines * SETTLE.newsLineH, `新闻块高封顶 ${newsH(9)} = ${SETTLE.newsMaxLines} 行`);
ok(headH({ match: true, badge: true, rewards: true, newsLines: 0, conds: 0, caption: false }) > headH({ match: true, badge: false, rewards: true, newsLines: 0, conds: 0, caption: false }),
  "有称号的头部比没称号的高(块数不变、高度跟着内容走)");
ok(actionsH(true) > actionsH(false), `有下一关小字时行动钮块更高 ${actionsH(true)} > ${actionsH(false)} —— 旧写法是「整排上抬 12」,把目标行挤没了`);
ok(settleLayout({ match: false, badge: false, rewards: false, newsLines: 0, conds: 0, caption: false }).gap === SETTLE.maxGap,
  "只有一块奖励都没有时,缝封顶在 maxGap(整组居中,不拉成飘字)");

// ---------- ④ 舞台换算:衬底在 cine 层(root 坐标),要经 cardY 折回去 ----------

ok(Math.abs(stageY(full) - (full.y.verdict + SETTLE.cardY)) < 0.01, "stageY = 衬底卡内 y + 卡片 root y(两处必须同一个数)");
ok(stageY(full) - SETTLE.bandH / 2 > -SETTLE.screenH / 2, "衬底下缘不探出屏幕");
ok(stageY(full) + SETTLE.bandH / 2 < SETTLE.screenH / 2, "衬底上缘不探出屏幕");

// ---------- ⑤ 反例(--selftest):旧的那套写死坐标必须被点名 ----------

if (process.argv.includes("--selftest")) {
  console.log("\n反例:0.0.28~0.0.35 那套写死的 y(衬底 88 高 + 比分 158 + 目标行 -150 + 按钮上抬 12)");
  /** 卡片中心为原点,照 settle-panel 旧构造函数的常量原样摆一遍 */
  const OLD: SettleItem[] = [
    { key: "verdict", cy: 198, h: 88, top: 242, bottom: 154 },
    { key: "score", cy: 158, h: 42, top: 179, bottom: 137 },
    { key: "badge", cy: 124, h: 26, top: 137, bottom: 111 },
    { key: "stat0", cy: 76, h: 48, top: 100, bottom: 52 },
    { key: "stat1", cy: 20, h: 48, top: 44, bottom: -4 },
    { key: "coin", cy: -34, h: 22, top: -23, bottom: -45 },
    { key: "bonus", cy: -56, h: 16, top: -48, bottom: -64 },
    { key: "bar", cy: -82, h: 14, top: -75, bottom: -89 },
    { key: "news", cy: -118, h: 44, top: -96, bottom: -140 },
    { key: "obj", cy: -150, h: 16, top: -142, bottom: -158 },
    { key: "buttons", cy: -178, h: 52, top: -152, bottom: -204 },
    { key: "caption", cy: -218, h: 16, top: -210, bottom: -226 },
  ];
  const bad = itemsCollide(OLD);
  ok(bad.some((m) => m.includes("verdict") && m.includes("score")),
    `反例被点名:比分压在衬底背后 → ${bad.filter((m) => m.includes("score") && m.includes("verdict")).join(" / ") || "(没抓到)"}`);
  ok(bad.some((m) => m.includes("obj") && m.includes("buttons")),
    `反例被点名:目标行被行动钮切掉 → ${bad.filter((m) => m.includes("obj") && m.includes("buttons")).join(" / ") || "(没抓到)"}`);
  ok(bad.length >= 2, `反例至少报出两处(实报 ${bad.length} 处:${bad.join(" / ")})`);

  // 单点反例:把「按钮上抬 12」这一条单独装回新排版 → 必须立刻撞
  const lifted: SettleItem[] = full.items.map((i) =>
    i.key === "buttons" ? { ...i, cy: i.cy + 12, top: i.top + 12, bottom: i.bottom + 12 } : i);
  const bad2 = itemsCollide(lifted);
  ok(bad2.some((m) => m.includes("obj")), `把旧「整排上抬 12」装回新排版,目标行立刻被点名 → ${bad2.join(" / ") || "(没抓到)"}`);

  // 溢出反例:卡片压到 430(比 needH 矮)→ 必须报「塞不进」
  const thin: SettleLayout = { ...full, cardH: 430, items: full.items, needH: full.needH };
  ok(settleOverflow(thin).some((m) => m.includes("越过卡片")), `卡片矮到装不下时报溢出 → ${settleOverflow(thin).slice(0, 2).join(" / ") || "(没抓到)"}`);

  // 居中反例:封顶那条分支少扣一次上边距时长成的样子(上 24 / 下 56,不压字、不出框,
  // 只是整组往下坠 —— 出图肉眼看见、纯 overlap 判据看不见的那一类)
  const sunk: SettleLayout = { ...full, marginTop: 24, marginBottom: 56 };
  ok(settleCentering(sunk).length === 1, `整组坠到下面时被 settleCentering 点名 → ${settleCentering(sunk)[0] || "(没抓到)"}`);
  ok(settleCentering(full).length === 0, "真排版的上下边距等宽(settleCentering 放行)");
  const wide = settleLayout({ match: false, badge: false, rewards: false, newsLines: 0, conds: 0, caption: false });
  ok(Math.abs(wide.marginTop - wide.marginBottom) < 0.01 && wide.marginTop > wide.gap,
    `块最少时走封顶分支:边距 ${wide.marginTop.toFixed(1)} 等宽且大于缝 ${wide.gap}(整组居中,不是贴顶)`);

  // 横排反例:一条长得离谱的目标句必须被 condRowFits 点名(整行宽 > 卡内可用宽)
  ok(condRowFits([`★3 ${"失分门槛可以写得很长".repeat(5)}`]).length === 1,
    "长目标句被 condRowFits 点名(整行推出卡片)");
  // 称号反例:超长称号必须被 badgeFits 点名(字飘出色带)
  ok(badgeFits(`★ 关卡突破 · ${"很长很长的关卡名字".repeat(8)}`).length === 1, "超长称号被 badgeFits 点名(字飘出色带)");
  // 小字反例:超长关名必须被 captionFits 点名
  ok(captionFits(`第 20 关「${"很长很长的关卡名字".repeat(8)}」· 一球生死战`).length === 1, "超长小字被 captionFits 点名(飘出卡片)");
  // 合法样本必须放行,否则判据是"恒真"的哑闸
  ok(condRowFits(["★1 取胜", "★2 飞扑 0/3", "★3 失分 0/2"]).length === 0, "现场图那三条短句放行(condRowFits)");
  ok(captionFits("第 3 关「烈日刺目」· 抢 7 分").length === 0, "现场图那句小字放行(captionFits)");
  const cw = condRow(["★1 取胜", "★2 飞扑 0/3", "★3 失分 0/2"]);
  ok(cw.total < SETTLE.cardW - SETTLE.objPadX, `现场那三条整行宽 ${cw.total.toFixed(0)} < 可用 ${SETTLE.cardW - SETTLE.objPadX}`);
}

console.log(`\n${h.fails === 0 ? "✓ 结算屏排版全部通过" : `✗ ${h.fails} 项失败`}(${h.checks} 项,场景 ${seen.size} 套)`);
process.exit(h.fails === 0 ? 0 : 1);
