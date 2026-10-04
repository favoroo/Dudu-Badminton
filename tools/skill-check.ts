// ============================================================
// 技能配置弹窗排版回归 —— 防的是用户拍的那张现场图:「这些技能说明全部都看不全」。
// 三个病根:
//   1) 描述 Label 设了 contentSize 却从没设 overflow —— 引擎留在 Overflow.NONE,
//      contentSize 被整个忽略,每句说明按一条无限宽的行画(9 号字实测 198~321px);
//   2) 卡片间距只有 128px —— 每一句都盖住左右两张卡,五句糊成一排;
//   3) 装备按钮被 uiButton 的 TOUCH_MIN 抬到 44 高,与说明框只剩 2px 缝 —— 就地折行根本无路。
//
// 排版已经搬进 assets/scripts/ui/skill-layout.ts(纯函数),这里断言:
//   A) 面板那一竖排(标题 / 卡片 / 详情板 / 完成)彼此留得住缝,谁都不出面板;
//   B) 全部技能 × 解锁与否 × 装备与否 全组合:详情板不出内容列、两项不压字、
//      板高够当前文案用(stackH <= plateH)、说明不超行数上限 —— 合起来就是
//      「切换技能时面板尺寸不变、说明永远读得完整」;
//   C) 折行本身:任何输入都不横向溢出;
//   D) 充能款(kind==="charge",怒气重击)的读数与配置自洽 + 三条一键化的门控数值同源;
//   E) rage 不在任何 AI 技能表里(否则等于把技能 buff 当成难度补丁偷偷加给对手)。
// 另带 --selftest:拿人造反例(含旧版真实写法)当输入,断言它**会**被报警 ——
// 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/skill-check.js [--preview] [--selftest]
// ============================================================
import { makeChecker } from "./harness";
import { CFG } from "../assets/scripts/core/config";
import { textW, wrapText } from "../assets/scripts/core/text-metrics";
import { CAMPAIGN_STAGES } from "../assets/scripts/core/campaign";
import { Skills } from "../assets/scripts/core/skills";
import {
  SK, layoutSkillPlate, plateOverlaps, plateOverflow, skillCardX, skillStatus, skillMeter,
  type PlateItem, type PlateLayout, type SkillLike,
} from "../assets/scripts/ui/skill-layout";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const LIST = CFG.skills.list as unknown as SkillLike[];

/** 面板那一竖排:每一项都按 skill-dialog 实际会摆的位置算 */
function panelStackFits(panelH: number): string[] {
  const bad: string[] = [];
  const half = panelH / 2;
  const MARGIN = 10;
  const titleTop = SK.titleY + 24 / 2 + 4;            // 24 号标题 + 投影
  const hintBot = SK.hintY - SK.hintSize / 2;
  const cardsTop = SK.cardsY + SK.cardH / 2;
  const cardsBot = SK.cardsY - SK.cardH / 2 - SK.cardEdge;   // 厚底边探出卡外
  const plateTop = SK.plateY + SK.plateH / 2;
  const plateBot = SK.plateY - SK.plateH / 2;
  const finTop = SK.finY + SK.finH / 2;
  const finBot = SK.finY - SK.finH / 2 - SK.finShadow;       // uiButton 斜切阴影再探 4
  if (titleTop > half - MARGIN) bad.push(`标题探出面板上缘(${titleTop} > ${half - MARGIN})`);
  if (hintBot <= cardsTop) bad.push(`提示压到卡片行(${hintBot} <= ${cardsTop})`);
  if (cardsBot <= plateTop) bad.push(`卡片压到详情板(${cardsBot} <= ${plateTop})`);
  if (plateBot <= finTop) bad.push(`详情板压到完成按钮(${plateBot} <= ${finTop})`);
  if (finBot < -half + MARGIN) bad.push(`完成按钮探出面板下缘(${finBot} < ${-half + MARGIN})`);
  return bad;
}

/**
 * 卡片内部那一竖排 —— 这条就是「说明为什么必须搬出卡片」的算术证据:
 * 装备按钮被 TOUCH_MIN 抬到 44 高之后,卡里已经塞不下第四样东西了。
 */
function cardStackFits(): string[] {
  const bad: string[] = [];
  const hh = SK.cardH / 2;
  const chipH = SK.chipSize + 10;                     // makeChip 的定式
  const chip = [SK.chipY - chipH / 2, SK.chipY + chipH / 2];
  const name = [SK.nameY - SK.nameSize / 2, SK.nameY + SK.nameSize / 2];
  const cd = [SK.cdY - SK.cdSize / 2, SK.cdY + SK.cdSize / 2];
  const btn = [SK.btnY - SK.btnH / 2 - SK.finShadow, SK.btnY + SK.btnH / 2];
  if (chip[1] > hh) bad.push(`标签探出卡片上缘(${chip[1]} > ${hh})`);
  if (chip[0] <= name[1]) bad.push(`标签压到名字(${chip[0]} <= ${name[1]})`);
  if (name[0] <= cd[1]) bad.push(`名字压到 CD(${name[0]} <= ${cd[1]})`);
  if (cd[0] <= btn[1]) bad.push(`CD 压到装备按钮(${cd[0]} <= ${btn[1]})`);
  if (btn[0] < -hh) bad.push(`装备按钮探出卡片下缘(${btn[0]} < ${-hh})`);
  return bad;
}

/** 与 ui-arcade.skewOf 同式(本工具不能 import ui,那一侧 import cc) */
function skewOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

/**
 * 卡片内部那一**横排** —— 卡从 104 瘦到 88 之后,竖排判据(cardStackFits)一个字都不会变
 * (它只数高度),所以横向必须另有一条:标签 chip、键名、读数行、装备键文字,
 * 任何一个超长都只会"被裁/糊出卡",不崩、不报错、编辑器里也不报警。
 * chip 宽度照 makeChip 的定式(文字宽 + 左右内边距 + 斜切)。
 */
function cardRowFits(def: SkillLike): string[] {
  const bad: string[] = [];
  const usable = SK.cardW - 6;                        // 卡片内左右各留 3
  const chipW = textW(def.tag, SK.chipSize) + 16 + skewOf(SK.chipSize + 10, SK.slantDeg);
  if (chipW > SK.cardW) bad.push(`标签「${def.tag}」${chipW.toFixed(0)}px 出卡片(${SK.cardW})`);
  const nameW = textW(def.shortName, SK.nameSize);
  if (nameW > usable) bad.push(`键名「${def.shortName}」${nameW.toFixed(0)}px > 可用宽 ${usable}`);
  const meterW = textW(skillMeter(def), SK.cdSize);
  if (meterW > usable) bad.push(`读数「${skillMeter(def)}」${meterW.toFixed(0)}px > 可用宽 ${usable}`);
  // 那一格最长的一句不是"装备",是未解锁时的状态文案(skill-dialog 的 button label)
  const lockW = textW(`Lv.${def.unlockLevel} 解锁`, 11);
  if (lockW > SK.btnW - 10) bad.push(`未解锁文案「Lv.${def.unlockLevel} 解锁」${lockW.toFixed(0)}px 出装备键(${SK.btnW - 10})`);
  return bad;
}

console.log("技能配置弹窗:面板竖排不撞、详情板不出列不压字\n");

// ---------- A) 面板竖排 ----------
{
  const bad = panelStackFits(SK.panelH);
  ok(bad.length === 0, `竖排(标题/卡片/详情板/完成)互不压字、全在面板内${bad.length ? ` → ${bad.join(" / ")}` : ""}`);
  ok(SK.panelH <= 540 - 2 * 50, `面板高 ${SK.panelH} <= 屏幕 540 减上下各 50 留白`);
  const cbad = cardStackFits();
  ok(cbad.length === 0, `卡片内竖排(标签/名字/CD/装备按钮)各留其位${cbad.length ? ` → ${cbad.join(" / ")}` : ""}`);
  const rowHalf = skillCardX(LIST.length - 1, LIST.length) + SK.cardW / 2 + 5;
  ok(rowHalf <= SK.panelW / 2, `卡片行总半宽 ${rowHalf} <= 面板半宽 ${SK.panelW / 2}`);
  ok(SK.btnH >= 44, `装备按钮高 ${SK.btnH} >= TOUCH_MIN 44(uiButton 会把高度抬到 44,写 28 是自欺欺人)`);
  ok(LIST.length === 7, `技能表 ${LIST.length} 款(排版按 ${LIST.length} 张横排摆)`);
  // 相邻两卡之间必须真有空隙:pitch <= cardW 时卡片互相重叠,而竖排判据看不见横向这件事
  ok(SK.cardPitch > SK.cardW, `卡间距 ${SK.cardPitch - SK.cardW}px > 0(pitch ${SK.cardPitch} > cardW ${SK.cardW})`);
  for (const def of LIST) {
    const rb = cardRowFits(def);
    ok(rb.length === 0, `${def.shortName}:卡内横排(标签/键名/读数/装备文案)不出卡片${rb.length ? ` → ${rb.join(" / ")}` : ""}`);
  }
}

// ---------- B) 6 技能 × 解锁与否 × 装备与否 ----------
{
  let worstStack = 0, worstDesc = 0, maxLines = 1;
  for (const def of LIST) {
    for (const unlocked of [true, false]) {
      for (const equipped of [true, false]) {
        const L = layoutSkillPlate(def, unlocked, equipped);
        const tag = `${def.shortName}/${unlocked ? "解锁" : "锁定"}/${equipped ? "已装" : "未装"}`;
        const of = plateOverflow(L);
        ok(of.length === 0, `${tag}:详情板不出内容列、板高够用${of.length ? ` → ${of.join(" / ")}` : ""}`);
        const ov = plateOverlaps(L);
        ok(ov.length === 0, `${tag}:详情板四项不压字${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
        ok(L.plateH === SK.plateH && L.stackH <= L.plateH, `${tag}:面板尺寸不随切换变化(stackH ${L.stackH.toFixed(1)} <= plateH ${L.plateH})`);
        ok(L.items.length === 4, `${tag}:详情板恒为四项(全名/冷却/状态/说明)`);
        worstStack = Math.max(worstStack, L.stackH);
        worstDesc = Math.max(worstDesc, L.items.find((i) => i.key === "desc")!.w);
        maxLines = Math.max(maxLines, L.descLines);
      }
    }
  }
  console.log(`\n  参照:最需要 ${worstStack.toFixed(1)} 高的板(现有 ${SK.plateH})、说明最宽一行 ${worstDesc}px(可用 ${layoutSkillPlate(LIST[0], true, false).availW})、最多 ${maxLines} 行`);
  // 今天的文案必须全是单行 —— 变成多行是允许的下限,但先钉住「一行放得下」这个事实
  for (const def of LIST) {
    const L = layoutSkillPlate(def, true, false);
    ok(L.descLines === 1, `${def.shortName}:说明在 ${SK.descSize} 号下 ${L.descLines} 行(读得完整)`);
  }
  // 状态三态文案钉住:改的人只可能改 config.ts 的技能表
  ok(skillStatus(LIST[4], false, false) === "未解锁 · Lv.5", `锁定态文案 =「${skillStatus(LIST[4], false, false)}」`);
  ok(skillStatus(LIST[0], true, true) === "已装备" && skillStatus(LIST[0], true, false) === "可装备", "解锁态文案 =「已装备 / 可装备」");
}

// ---------- C) 折行本身:任何输入都不横向溢出 ----------
{
  const avail = layoutSkillPlate(LIST[0], true, false).availW;
  const cases = [
    ["纯中文长句", "开启一点五秒子弹时间球速与对手大幅减慢自身高速敏捷穿梭从容反击完成一次完美的场地控制"],
    ["中英混排", "折跃瞬间时停悬空,闪至 shuttlecock 下方高点,必定凌空劈扣 100%"],
    ["裸长词", "CHAMPIONSHIPPOINTOVERCLOCKEDCHAOSWITHOUTANYSINGLESPACEBREAKPOINTATALL"],
    ["硬换行", "第一行\n第二行"],
    ["空串", ""],
  ] as const;
  for (const [name, s] of cases) {
    const rows = wrapText(s, SK.descSize, avail);
    const bad = rows.filter((r) => textW(r, SK.descSize) > avail);
    ok(bad.length === 0, `wrapText(${name}):${rows.length} 行,每行实测宽都 <= ${avail}`);
  }
}

// ---------- D) 充能款技能与三侧同源 ----------
{
  const RG = CFG.skills.rage;
  const charge = LIST.filter((d) => d.kind === "charge");
  // 今天只有一款(怒气重击)。判据不写死 id:写死了就等于"以后再加一款充能技能"必须记得改这里。
  ok(charge.length >= 1, `技能表里有 ${charge.length} 款 kind==="charge"(资源制读数)`);
  for (const d of charge) {
    // 卡片读数走 skillMeter 而不是 skillCd —— 这条断言的意义是"假冷却不许出现在卡上":
    // 资源制的 cooldownFrames 只是防连点(20 帧),印成「CD 0.3s」玩家会以为 0.3 秒能再放。
    ok(!skillMeter(d).startsWith("CD"), `${d.shortName}:卡上读数 =「${skillMeter(d)}」,不是假冷却`);
    ok(d.cooldownFrames <= 30, `${d.shortName}:充能款的 cooldownFrames ${d.cooldownFrames} <= 30(它是防连点不是门槛,长了就是在双罚)`);
    ok(d.unlockLevel > 0 && !!d.accent && !!d.tag, `${d.shortName}:解锁等级/专属色/标签齐活`);
  }
  // 非充能款必须仍然印 CD —— 否则"skillMeter 改坏了冷却款"这种回归不会被发现
  const cdOnes = LIST.filter((d) => d.kind !== "charge");
  ok(cdOnes.every((d) => skillMeter(d).startsWith("CD ")), `其余 ${cdOnes.length} 款仍印 CD(改动没波及它们)`);

  // ---- 一把尺子、三份参数:跨步/重击/怒气的四个门控数必须逐字相同 ----
  // 这三条一键化共用 player.autoSwingDue。分叉的后果不是崩,是"某个技能替玩家按早按晚"。
  const keys = ["autoHorizon", "autoLandHorizon", "autoOutMargin", "autoSettleGrace"] as const;
  type Gate = { [K in typeof keys[number]]: number };
  const srcs: [string, Gate][] = [["lunge", CFG.lunge], ["smash", CFG.skills.smash], ["rage", CFG.skills.rage]];
  for (const k of keys) {
    const vals = new Set(srcs.map(([, o]) => o[k]));
    ok(vals.size === 1, `门控 ${k} 三侧同源:${srcs.map(([n, o]) => `${n}=${o[k]}`).join(" / ")}`);
  }
  // 代拍窗不能超过 armed 窗:超出去会在"没有承诺的帧"上代一记普通球
  ok(RG.autoWindow <= RG.releaseWindow, `rage.autoWindow ${RG.autoWindow} <= releaseWindow ${RG.releaseWindow}`);
  ok(RG.autoReturn === CFG.lunge.autoReturn && RG.autoReturn === CFG.skills.smash.autoReturn,
    "三条一键化的总闸同开同关(只关一条会留下半套行为,读起来像坏了)");

  // ---- 配置自洽:怒气必须是整数经济、档位与演出表等长 ----
  const gains = [RG.perHit, RG.perHit * RG.sweetMul, RG.perHit * RG.smashMul, RG.perHit * RG.bothMul];
  ok(gains.every((g) => Number.isInteger(g)), `四档增益全整数(1 点 = 1% 的读法才不断):${gains.join(" / ")}`);
  ok(RG.tierAt.length === RG.tiers.length, `档位下界 ${RG.tierAt.length} 条 == 演出表 ${RG.tiers.length} 行(不等长表现层会取到 undefined)`);
  ok(RG.tierAt[0] === 0, `首档下界 = 0(否则最低那档永远进不去,按下只会读成"没反应")`);
  ok(RG.tierAt[RG.tierAt.length - 1] === 1, "末档下界 = 1(满怒必落最后一档)");
  ok(RG.tierAt.every((v, i) => i === 0 || v > RG.tierAt[i - 1]), "档位下界严格递增");
  ok(RG.bothMul >= Math.max(RG.sweetMul, RG.smashMul) && RG.bothMul < RG.sweetMul * RG.smashMul,
    `bothMul ${RG.bothMul} 高于任一单项、又低于两者叠乘 ${(RG.sweetMul * RG.smashMul).toFixed(2)}(叠乘会一拍打穿上限)`);
  ok(RG.rageMinRelease >= RG.perHit, `释放门槛 ${RG.rageMinRelease} >= 每拍增益 ${RG.perHit}(否则门槛形同虚设,空按白嫖加成)`);
  // rageTierOf 必须在整个 0..1 区间都取得到演出行(这是"四档演出真的分得开"的算术证据)
  const missing: number[] = [];
  for (let r = 0; r <= 1.0001; r += 0.01) {
    if (!RG.tiers[Skills.rageTierOf(r)]) missing.push(Number(r.toFixed(2)));
  }
  ok(missing.length === 0, `rageTierOf 全程都有演出行可取${missing.length ? ` → 缺 ${missing.join(",")}` : ""}`);
  ok(Skills.rageTierOf(1) === RG.tiers.length - 1, `满怒落最后一档(实测 ${Skills.rageTierOf(1)})—— 从小往大找会永远返回 0,这条钉住它`);
  ok(Skills.rageTierOf(0) === 0, "空怒落第一档");
  ok(Skills.isChargeSkill("rage") && !Skills.isChargeSkill("smash"), "isChargeSkill 只认充能款那一款");
}

// ---------- E) AI 侧口径:这款技能今天到不了 CPU ----------
{
  // 凡是"替真人打"的机制一律 !p.isAI(AGENTS.md 那条铁律)。这里钉的是**另一半**:
  // AI 的技能循环归 diffs.* 管 —— 哪一关手滑把 aiSkill 写成 "rage",就等于偷偷给对手
  // 加了一管越打越强的资源,而 ai-check / serve-check 的真人替身从不按技能键,量不到它。
  const byDiff = Object.keys(CFG.aiSkillByDiff).map((k) => (CFG.aiSkillByDiff as Record<string, string>)[k]);
  ok(!byDiff.includes("rage"), `aiSkillByDiff 四档都不含 rage:${byDiff.join(" / ")}`);
  const stageSkills = CAMPAIGN_STAGES.map((s) => s.aiSkill).filter(Boolean) as string[];
  ok(!stageSkills.includes("rage"), `20 关的 aiSkill 里没有 rage(出现了就等于给某一关加难度却写在技能表里)`);
  ok(CFG.aiSkillByDiff.easy === CFG.aiSkillByDiff.normal, "入门/标准 AI 同技能档(ai-check 的基线口径没被动过)");
}

// ---------- F) selftest:反例必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:拿人造反例验判据有没有牙齿");
  const base = layoutSkillPlate(LIST[0], true, true);
  const mk = (key: string, left: number, w: number, cy: number, h: number, size = 9): PlateItem =>
    ({ key, role: "desc", lines: ["x"], size, lineH: h, h, w, left, x: left, cy, align: 0 });

  // (a) 旧版真实写法:9 号说明按一条无限宽的行画在 118 宽卡片里,压到 44 高的装备按钮
  const legacy: PlateLayout = {
    ...base,
    items: [
      mk("desc", -textW(LIST[0].desc, 9) / 2, textW(LIST[0].desc, 9), -18, 48),
      mk("btn", -48, 96, -62, 44),
    ],
  };
  const la = plateOverlaps(legacy);
  ok(la.some((s) => s.includes("desc × btn")), `旧版「9 号说明 + 44 高按钮」被报压字(${la[0] ?? "无"})`);
  ok(plateOverlaps(base).length === 0, "同一个判据下现排版干净");

  // (b) 手挑坐标:CD 摆 +256、Lv 摆 +292(初版就是这么写的)
  const handpicked: PlateLayout = {
    ...base,
    items: [
      mk("cd", 256 - textW("CD 0.8s", 12) / 2, textW("CD 0.8s", 12), base.items[0].cy, 16, 12),
      mk("status", 292 - textW("Lv.5 解锁", 12) / 2, textW("Lv.5 解锁", 12), base.items[0].cy, 16, 12),
    ],
  };
  const hb = plateOverlaps(handpicked);
  ok(hb.some((s) => s.includes("cd × status")), `手挑的 CD@256 / Lv@292 被报压字(${hb[0] ?? "无"})`);

  // (c) 超长文案:说明把详情板撑爆
  const bloatedDef: SkillLike = { ...LIST[0], desc: "快速滑步".repeat(20) };
  const BL = layoutSkillPlate(bloatedDef, true, false);
  const of = plateOverflow(BL);
  ok(of.some((s) => s.startsWith("stackH")), `60 字说明把需求板高顶到 ${BL.stackH.toFixed(1)},红线 ${SK.plateH} 拦得住`);
  ok(of.some((s) => s.startsWith("说明折")), `同时被报「说明折 ${BL.descLines} 行 > 上限 ${SK.descMaxLines}」`);

  // (d) 面板缩回旧高度:完成按钮被裁出面板
  const tight = panelStackFits(370);
  ok(tight.length > 0, `面板退回 370 高会被报警(${tight[0] ?? "无"})`);
  ok(panelStackFits(SK.panelH).length === 0, "同一个判据下现面板高度干净");

  // (e) 七张卡沿用六张那一轮的 104/112 间距:整排直接出面板。
  //     这是"加第七款技能"最自然的一次翻车 —— 卡片不会报错,只会把右边那张裁掉。
  const legacyPitch = 3 * 112 + 104 / 2 + 5;
  ok(legacyPitch > SK.panelW / 2, `旧 104/112 摆 7 张 → 半宽 ${legacyPitch} > 面板半宽 ${SK.panelW / 2},判据拦得住`);
  ok(skillCardX(LIST.length - 1, LIST.length) + SK.cardW / 2 + 5 <= SK.panelW / 2, "现 88/96 摆 7 张仍在面板内");

  // (f) 卡内文字超长(卡从 104 瘦到 88 之后,横向余量只剩 8px —— 超长只会糊出卡,
  //     而竖排判据一个字都看不见)。走 cardRowFits 本体,不另算一遍:另算的那份不抓真回归。
  const wideTag: SkillLike = { ...LIST[0], tag: "越战越勇越战越勇" };
  ok(cardRowFits(wideTag).some((s) => s.startsWith("标签")), `超长标签被 cardRowFits 点名(${cardRowFits(wideTag)[0] ?? "无"})`);
  const wideName: SkillLike = { ...LIST[0], shortName: "怒气冲天重击" };
  ok(cardRowFits(wideName).some((s) => s.startsWith("键名")), `超长键名被点名(${cardRowFits(wideName)[0] ?? "无"})`);
  const wideLock: SkillLike = { ...LIST[0], unlockLevel: 99999 };
  ok(cardRowFits(wideLock).some((s) => s.startsWith("未解锁文案")), `装备格那句超长被点名(${cardRowFits(wideLock)[0] ?? "无"})`);
  ok(cardRowFits(LIST[0]).length === 0 && LIST.every((d) => cardRowFits(d).length === 0), "同一个判据下现七款文案都干净");

  // (g) 充能款走旧的 skillCd:卡上出现一个假冷却。
  //     数字合法、排版合法、tsc 也合法 —— 只有玩家读出来是"0.3 秒就能再放一次"。
  const rageDef = LIST.find((d) => d.kind === "charge");
  ok(!!rageDef, "技能表里确实有一款充能款(否则下面这条判据是空的)");
  if (rageDef) {
    const fakeCd = `CD ${(rageDef.cooldownFrames / 60).toFixed(1)}s`;
    ok(skillMeter(rageDef) !== fakeCd, `${rageDef.shortName}:读数「${skillMeter(rageDef)}」≠ 旧的假冷却「${fakeCd}」`);
    ok(textW(fakeCd, SK.cdSize) <= SK.cardW - 6, "(反例本身要合法:假冷却那句排版没问题,所以只有语义判据抓得住它)");
  }

  // (h) 档位下界与演出表不等长:表现层取到 undefined,四档演出塌成一档且不报错
  const badTier = { ...CFG.skills.rage, tierAt: [0, 0.5] };
  ok(badTier.tierAt.length !== badTier.tiers.length, `tierAt 砍到 2 条而演出表 4 行 ⇒ 长度判据能抓到`);
  const dupTier = { ...CFG.skills.rage, tierAt: [0, 0, 0, 0] };
  ok(!dupTier.tierAt.every((v, i) => i === 0 || v > dupTier.tierAt[i - 1]), "四档下界全写成 0 会被递增判据抓到");
  ok(Skills.rageTierOf(1) === 3 && Skills.rageTierOf(0.5) === 1, "现档位:满怒 3 档、半怒 1 档(分得开)");
}

// ---------- E) --preview:把排版打成行表,不开编辑器也能 eyeball ----------
if (process.argv.includes("--preview")) {
  for (const def of LIST) {
    const L = layoutSkillPlate(def, true, false);
    console.log(`\n预览 ${def.shortName}(${def.name}):板 ${L.plateW}×${L.plateH},内容列 ${L.innerL.toFixed(0)}…${L.innerR.toFixed(0)},需求高 ${L.stackH.toFixed(1)}`);
    const rows: { cy: number; tag: string; text: string }[] = [];
    for (const it of L.items) {
      const mark = it.align === 0 ? `x=${it.left.toFixed(0)}` : it.align === 2 ? `右x=${it.x.toFixed(0)}` : `中x=${it.x.toFixed(0)}`;
      it.lines.forEach((l, i) => rows.push({
        cy: it.cy + it.h / 2 - (i + 0.5) * it.lineH,
        tag: `${it.key.padEnd(7)}${String(it.size).padStart(2)}号 ${mark.padStart(8)}`,
        text: l,
      }));
    }
    rows.sort((a, b) => b.cy - a.cy);
    for (const r of rows) console.log(`  cy=${r.cy.toFixed(1).padStart(6)}  ${r.tag}  ${r.text}`);
  }
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
