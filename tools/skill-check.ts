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
//   B) 5 个技能 × 解锁与否 × 装备与否 全组合:详情板不出内容列、两项不压字、
//      板高够当前文案用(stackH <= plateH)、说明不超行数上限 —— 合起来就是
//      「切换技能时面板尺寸不变、说明永远读得完整」;
//   C) 折行本身:任何输入都不横向溢出。
// 另带 --selftest:拿人造反例(含旧版真实写法)当输入,断言它**会**被报警 ——
// 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/skill-check.js [--preview] [--selftest]
// ============================================================
import { CFG } from "../assets/scripts/core/config";
import { textW, wrapText } from "../assets/scripts/ui/text-metrics";
import {
  SK, layoutSkillPlate, plateOverlaps, plateOverflow, skillCardX, skillStatus,
  type PlateItem, type PlateLayout, type SkillLike,
} from "../assets/scripts/ui/skill-layout";

let fails = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${msg}`); } else { console.log(`  ✓ ${msg}`); }
}

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
  ok(LIST.length === 5, `技能表 ${LIST.length} 款(排版按 5 张横排摆)`);
}

// ---------- B) 5 技能 × 解锁与否 × 装备与否 ----------
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

// ---------- D) selftest:反例必须被报警 ----------
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

console.log(`\n${fails === 0 ? "✓" : "✗"} ${checks} 项断言,失败 ${fails}`);
process.exit(fails === 0 ? 0 : 1);
