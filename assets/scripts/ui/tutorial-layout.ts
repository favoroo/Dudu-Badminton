// ============================================================
// 新手教学版式:讲解页(演示画布 + 编号讲解列)+ 实操横幅 + 完成页的唯一算术。
//
// 为什么提成纯函数 —— 与 drill-layout 同一条纪律:教学面板的「改一个字号就全线
// 撞车」类排版,坐标全收在这里,面板只照返回的 Box 摆;「不重叠 / 不溢出 /
// 文案放得下」由 tools/tutorial-check.ts 在 node 下断言。
//
// 结构上与训练场引导页的两点不同(为什么不是复用 drill-layout):
//   ① 讲解页讲的是**手势**(滑轨/击球键/上滑),不是球路 —— 演示画布是一张
//      「屏幕示意图」(render/tutorial-anim 画),没有喂球弧线可烘焙,分步卡改成
//      右列编号行 1/2/3,一次读完;
//   ② 实操页大卡收成**顶部横幅**:滑轨和击球键都住在屏幕下半,横幅只占自己那块
//      (BlockInputEvents 只挂横幅节点),场上目标圈与操作必须完全露出来。
//
// 依赖纪律:零 cc —— 只 import p5-tokens(触控尺/斜切档)、core/text-metrics、
// core/config(主题文案表)。坐标一律以面板中心为原点(cc 的 y 朝上);
// 实操横幅是屏幕节点,box 以横幅中心为原点,由 panel 摆到 (0, bannerY)。
// ============================================================
import { SLANT, TOUCH } from "./p5-tokens";
import { textW, wrapText } from "../core/text-metrics";
import { TUTORIAL_TOPICS } from "../core/config";
import type { TutTopic } from "../core/types";

// ---------- 盒模型(与 drill-layout 同构) ----------

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;
export const widthOf = (b: Box): number => b.right - b.left;
export const centerX = (b: Box): number => b.left + widthOf(b) / 2;

export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}

/** 与 ui-arcade.skewOf 同式(本模块零 cc,不能 import 那边) */
export function shearOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

// ---------- 版面常量 ----------

export const TUT = {
  pw: 880, ph: 470,
  panelY: -6,

  left: -420, right: 420,
  contentTop: 186, contentBottom: -190,
  plateEdge: 432,

  /** 顶栏:标题色带 + 进度读数 + 关闭键 */
  barCy: 209, barH: 32,

  /** 讲解页左列:演示画布(尺寸与 render/tutorial-anim 的舞台同源,唯一出处在这里) */
  demoW: 430, demoH: 244,
  padX: 12,

  /** 右列编号行 */
  nameSize: 20, lineSize: 14, lineH: 22, lineGap: 8,
  bandH2: 24, bandSize: 13, hintSize: 11, hintH: 16,
  /** 顶栏标题字号(面板不再自己写死,判据要拿它量文案放不放得进色带) */
  titleSize: 16,
  /** 色带内的左右内边距:文字不许贴到斜切角上 */
  bandPadL: 12, bandPadR: 10,

  /** 底排:‹ › 翻题箭头 + 三个主题 chip + 跳过/去练一练 */
  chevW: 48, chipW: 118, chipGap: 10,
  skipW: 92, goW: 150, keyH: TOUCH.min,
  rowGap: 10,

  /** 实操横幅(屏幕节点,原点=横幅中心) */
  bannerW: 720, bannerH: 96, bannerY: 160,
  bannerPad: 12, seeW: 96,

  /** 完成页 */
  doneSize: 34, doneSubSize: 13, doneBtnW: 180, doneBtnH: 52, menuBtnW: 140,
} as const;

// ---------- 文案(面板与判据共用同一份) ----------

export const BAR_TITLE = "操作教学";
export const SECTIONS = { howTo: "怎么玩", practice: "练一练" } as const;
export const KEYS = {
  go: "去练一练", back: "看演示", skip: "跳过",
  done: "去打一局", menu: "回主菜单", doneTag: "完成",
} as const;
export const DONE = {
  title: "教学完成!",
  sub: "更多球路教学在主菜单「专项训练」;操作方式随时可在设置里换",
} as const;

/** 编号行文本:序号 + 内容(带圈数字子集字体没有字形,照 drill-layout 用裸数字) */
export function numLine(topic: TutTopic, i: number): string {
  return `${i + 1}  ${topic.lines[i] ?? ""}`;
}

/** 编号行的折行(判据与面板同一份) */
export function numLines(topic: TutTopic): string[] {
  const out: string[] = [];
  for (let i = 0; i < topic.lines.length; i++) {
    out.push(...wrapText(numLine(topic, i), TUT.lineSize, infoInner()));
  }
  return out;
}

// ---------- 顶栏 ----------

export function titleBand(): Box {
  return box(TUT.left, 128, TUT.barCy, TUT.barH);
}

/** 进度读数「已完成 1/3」:右对齐,给关闭键让位 */
export function headInfoBand(): Box {
  const right = closeHit().left - 10;
  return box(60, right - 60, TUT.barCy, 24);
}

/** 关闭键命中盒(整块 44 = TOUCH.min,照 drill-layout.closeHit) */
export function closeHit(): Box {
  const hit = TOUCH.min;
  return box(TUT.right - hit, hit, TUT.barCy, hit);
}

// ---------- 讲解页 ----------

/** 演示画布:左列 */
export function demoBox(): Box {
  return box(TUT.left, TUT.demoW, TUT.contentTop - TUT.demoH / 2, TUT.demoH);
}

/** 右列可用文案宽 */
export function infoInner(): number {
  return TUT.right - infoLeftX() - 2 * TUT.padX;
}

/** 右列左缘:画布右缘 + 缝 */
export function infoLeftX(): number {
  return TUT.left + TUT.demoW + 20;
}

export interface BriefInfo {
  name: Box;
  howTo: Box;
  /** 三条编号行的整块(内容驱动高度)与逐行坐标 */
  lines: Box;
  lineRows: Box[];
  /** 「练一练」整面实底色带 */
  practice: Box & { text: string };
  hint: Box;
}

/**
 * 右列:名称 → 「怎么玩」带 → 编号行 → 「练一练」色带 → 提示。
 * 竖排走内容驱动的游标,「不压字」是排版的性质;整列不得压到底排,由判据钉。
 */
export function briefInfo(topic: TutTopic): BriefInfo {
  const L = infoLeftX(), inner = infoInner();

  const name = box(L, TUT.right - L, TUT.contentTop - 15, 30);
  let cursor = bottom(name) - 6;
  const howTo = box(L, bandW(SECTIONS.howTo, TUT.bandSize), cursor - TUT.bandH2 / 2, TUT.bandH2);
  cursor = bottom(howTo) - 6;

  const wrapped = numLines(topic);
  const rowsH = wrapped.length * TUT.lineH;
  const linesB = box(L + TUT.padX, inner, cursor - rowsH / 2, rowsH);
  const lineRows = wrapped.map((_, i) =>
    box(L + TUT.padX, inner, top(linesB) - (i + 0.5) * TUT.lineH, TUT.lineH));
  cursor = bottom(linesB) - 10;

  const practice = {
    ...box(L + TUT.padX, bandW(topic.practice, TUT.bandSize), cursor - TUT.bandH2 / 2, TUT.bandH2),
    text: topic.practice,
  };
  cursor = bottom(practice) - 6;
  const hint = box(L + TUT.padX, inner, cursor - TUT.hintH / 2, TUT.hintH);

  return { name, howTo, lines: linesB, lineRows, practice, hint };
}

/** 色带宽度:文案实测 + 两侧内边距(与 drill-layout.bandW 同源算式) */
export function bandW(text: string, size: number): number {
  return textW(text, size) + 28;
}

/**
 * 色带内的文字盒 —— **以色带节点自己为父**(色带节点摆在 centerX(b),子节点原点就是带心)。
 *
 * 为什么收在这里而不是让面板写 `x: -w/2 + 12`:本面板的 Label 恒「盒心 = 节点位置」
 * (中心锚),左缘数字交给它就是整串字往左偏半个盒宽 —— 0.0.32 的现场:「怎么玩」只剩
 * 「么玩」、「操作教学」头两个字掉到黑底上。交出一个 Box 让面板走同一个 txt(),
 * 锚点语义就只有一份真话,而且能被 tutOverflow 量。
 */
export function bandText(b: Box): Box {
  const w = widthOf(b);
  return box(-w / 2 + TUT.bandPadL, Math.max(1, w - TUT.bandPadL - TUT.bandPadR), 0, b.h);
}

// ---------- 讲解页底排:‹ › + 三个主题 chip + 跳过/去练一练 ----------

export interface BottomRow {
  chevL: Box; chevR: Box;
  chips: Box[];
  skip: Box; go: Box;
  /** 整排上缘(右列不得压进来) */
  topEdge: number;
}

export function bottomRow(): BottomRow {
  const demo = demoBox();
  const cy = bottom(demo) - TUT.rowGap - TUT.keyH / 2;
  const topEdge = bottom(demo) - TUT.rowGap;
  const chevL = box(TUT.left, TUT.chevW, cy, TUT.keyH);
  let x = chevL.right + 12;
  const chips = [0, 1, 2].map((i) => {
    const b = box(x, TUT.chipW, cy, TUT.keyH);
    x = b.right + TUT.chipGap;
    return b;
  });
  const chevR = box(x + 2, TUT.chevW, cy, TUT.keyH);
  const skip = box(TUT.right - TUT.skipW, TUT.skipW, cy, TUT.keyH);
  const go = box(skip.left - 12 - TUT.goW, TUT.goW, cy, TUT.keyH);
  return { chevL, chevR, chips, skip, go, topEdge };
}

// ---------- 实操横幅(屏幕节点,原点 = 横幅中心) ----------

export interface BannerInfo {
  badge: Box;
  main: Box;
  hint: Box;
  see: Box;
}

/** badge 定宽槽:「实操 1/3」与「完成」都在里面居中(定宽才不用随文案重排) */
export const BANNER_BADGE_W = 150;

/** 实操第 i 主题的横幅排版(原点 = 横幅中心) */
export function bannerLayout(topic: TutTopic): BannerInfo {
  const half = TUT.bannerW / 2;
  const badge = box(-half + TUT.bannerPad, BANNER_BADGE_W, 14, TUT.bandH2);
  const mainLeft = badge.right + 14;
  const see = box(half - TUT.bannerPad - TUT.seeW, TUT.seeW, 0, TUT.keyH);
  const mainW = Math.max(120, see.left - 14 - mainLeft);
  return {
    badge,
    main: box(mainLeft, mainW, 14, 26),
    hint: box(mainLeft, mainW, -16, 18),
    see,
  };
}

/** 横幅 badge 的文案:实操中的第 i 主题 */
export function bannerBadge(i: number): string {
  return `实操 ${i + 1}/${TUTORIAL_TOPICS.length}`;
}

// ---------- 完成页 ----------

export interface DoneLayout {
  title: Box; sub: Box; go: Box; menu: Box;
}

export function doneLayout(): DoneLayout {
  const cy = TUT.contentTop - 70;
  const go = box(-TUT.doneBtnW - 14, TUT.doneBtnW, -96, TUT.doneBtnH);
  const menu = box(14, TUT.menuBtnW, -96, TUT.doneBtnH);
  return {
    title: box(TUT.left, TUT.right - TUT.left, cy, 46),
    sub: box(TUT.left + 40, TUT.right - TUT.left - 80, cy - 44, 20),
    go, menu,
  };
}

// ============================================================
// 判据(面板与 tools/tutorial-check.ts 共用同一份)
// ============================================================

const EPS = 0.5;
const overlapX = (a: Box, b: Box): boolean => a.left < b.right - EPS && b.left < a.right - EPS;
const overlapY = (a: Box, b: Box): boolean => bottom(a) < top(b) - EPS && bottom(b) < top(a) - EPS;

export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && overlapY(a, b);
}

/** 文本块越出内容区 */
export function boxOverflow(b: Box): string | null {
  if (b.left < TUT.left - EPS) return `左缘 ${b.left.toFixed(1)} < ${TUT.left}`;
  if (b.right > TUT.right + EPS) return `右缘 ${b.right.toFixed(1)} > ${TUT.right}`;
  if (top(b) > TUT.contentTop + EPS) return `顶边 ${top(b).toFixed(1)} > ${TUT.contentTop}`;
  if (bottom(b) < TUT.contentBottom - EPS) return `底边 ${bottom(b).toFixed(1)} < ${TUT.contentBottom}`;
  return null;
}

/** 斜切底块的最坏边角是否还在衬纸内(照 drill-layout.baseOverflow) */
export function baseOverflow(b: Box, deg = SLANT.block): string | null {
  const half = shearOf(b.h, deg) / 2;
  if (b.right + half > TUT.plateEdge + EPS) return `斜切右角 ${(b.right + half).toFixed(1)} > ${TUT.plateEdge}`;
  if (b.left - half < -TUT.plateEdge - EPS) return `斜切左角 ${(b.left - half).toFixed(1)} < ${-TUT.plateEdge}`;
  if (top(b) > TUT.ph / 2) return `顶边 ${top(b).toFixed(1)} > 面板半高 ${TUT.ph / 2}`;
  if (bottom(b) - 8 < -TUT.ph / 2) return `底边 ${bottom(b).toFixed(1)} 探出面板`;
  return null;
}

/** 色带文案放得进「带内文字盒」吗(标题带/badge 是定宽带,只有量了才知道撑不撑得下) */
export function bandTextFits(b: Box, text: string, size: number): string | null {
  const inner = bandText(b);
  const half = widthOf(b) / 2;
  if (inner.left < -half - EPS) return `文字盒越出带左缘 ${inner.left.toFixed(1)} < ${-half}`;
  if (inner.right > half + EPS) return `文字盒越出带右缘 ${inner.right.toFixed(1)} > ${half}`;
  const need = textW(text, size);
  if (need > widthOf(inner) + EPS) return `文案「${text}」${need} > 带内可放 ${widthOf(inner)}`;
  return null;
}

/** 判据要吃整张主题表 */
export function briefInfos(topics: readonly TutTopic[] = TUTORIAL_TOPICS): Array<{ topic: TutTopic; info: BriefInfo }> {
  return topics.map((topic) => ({ topic, info: briefInfo(topic) }));
}

const pairs = (nm: string, bs: Box[], out: string[]): void => {
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      if (boxesOverlap(bs[i], bs[j])) out.push(`${nm}:第 ${i} 与第 ${j} 块重叠`);
    }
  }
};

/** 讲解页 + 横幅 + 完成页:全部盒子两两比对 */
export function tutOverlaps(topics: readonly TutTopic[] = TUTORIAL_TOPICS): string[] {
  const out: string[] = [];
  pairs("顶栏", [titleBand(), headInfoBand(), closeHit()], out);
  const row = bottomRow();
  pairs("底排", [row.chevL, row.chevR, ...row.chips, row.skip, row.go], out);

  for (const { topic, info } of briefInfos(topics)) {
    pairs(`${topic.id}·右列`, [info.name, info.howTo, info.lines, info.practice, info.hint], out);
    // 右列整体在画布右侧、底排之上
    const col = [info.name, info.howTo, info.lines, info.practice, info.hint];
    for (const b of col) {
      if (b.left < demoBox().right) out.push(`${topic.id}:右列压进画布 ${b.left.toFixed(1)}`);
      if (bottom(b) < row.topEdge) out.push(`${topic.id}:右列掉到底排之下`);
    }
  }

  // 横幅:三个主题逐个摊
  for (const [i, topic] of topics.entries()) {
    const bn = bannerLayout(topic);
    pairs(`${topic.id}·横幅`, [bn.badge, bn.main, bn.hint, bn.see], out);
    if (bn.badge.left < -TUT.bannerW / 2) out.push(`${topic.id}:横幅 badge 越出左缘`);
    if (bn.see.right > TUT.bannerW / 2) out.push(`${topic.id}:横幅按钮越出右缘`);
  }

  const D = doneLayout();
  pairs("完成页", [D.title, D.sub, D.go, D.menu], out);
  return out;
}

/** 溢出 + 文案宽度:逐主题摊开 */
export function tutOverflow(topics: readonly TutTopic[] = TUTORIAL_TOPICS): string[] {
  const out: string[] = [];
  for (const [nm, b] of [["标题带", titleBand()], ["进度读数", headInfoBand()], ["关闭键", closeHit()]] as Array<[string, Box]>) {
    if (bottom(b) < TUT.contentTop - EPS) out.push(`顶栏 ${nm} 掉进内容区`);
    if (top(b) > TUT.ph / 2) out.push(`顶栏 ${nm} 越出面板`);
  }
  const row = bottomRow();
  for (const [nm, b] of [["‹", row.chevL], ["›", row.chevR], ["跳过", row.skip], ["去练一练", row.go], ...row.chips.map((c, i) => [`chip${i + 1}`, c] as [string, Box])] as Array<[string, Box]>) {
    const o = baseOverflow(b);
    if (o) out.push(`底排 ${nm} ${o}`);
  }
  const demo = demoBox();
  const od = baseOverflow(demo);
  if (od) out.push(`演示画布 ${od}`);

  for (const { topic, info } of briefInfos(topics)) {
    const all: Array<[string, Box]> = [
      ["名称", info.name], ["怎么玩带", info.howTo], ["编号行", info.lines],
      ["练一练带", info.practice], ["提示", info.hint],
    ];
    for (const [nm, b] of all) {
      const o = boxOverflow(b);
      if (o) out.push(`${topic.id}·${nm} ${o}`);
    }
    // 编号行:折行结果整条交出去,任何一行超宽都是被静悄悄裁掉;
    // 行数也要有预算(右列底排之上只容得下 6 行)—— 长句子靠折行躲过单行宽判据,靠这条拦
    const wrapped = numLines(topic);
    if (wrapped.length !== info.lineRows.length) out.push(`${topic.id}:编号行坐标与折行数不一致`);
    if (wrapped.length > 6) out.push(`${topic.id}:编号行折行 ${wrapped.length} 行,右列只容得下 6 行`);
    for (const line of wrapped) {
      if (textW(line, TUT.lineSize) > infoInner() + EPS) out.push(`${topic.id} 编号行「${line}」放不下 ${infoInner()}`);
    }
    /** 「击球」要教三轴手势 + 时机,是 4 条(0.0.24 起);真正的尺是「折行 ≤6 行 + 不压底排」 */
    if (topic.lines.length < 3 || topic.lines.length > 4) out.push(`${topic.id}:讲解 ${topic.lines.length} 条,版式只给 3~4 条的位置`);
    if (textW(topic.label, TUT.nameSize) > widthOf(info.name)) out.push(`${topic.id}:名称超宽`);
    if (textW(topic.practice, TUT.bandSize) + 28 > widthOf(info.practice) + EPS) out.push(`${topic.id}:练一练带「${topic.practice}」文案比带宽`);
    if (widthOf(info.practice) > TUT.right - infoLeftX() - 2 * TUT.padX + EPS) out.push(`${topic.id}:练一练带宽 > 右列宽`);
    for (const hint of [topic.hint, "下网了:等球落低一点、仰角给足"]) {
      if (textW(hint, TUT.hintSize) > infoInner() + EPS) out.push(`${topic.id} 提示「${hint}」放不下`);
    }
    // chip 上的字:编号 + 名称,必须一行放得下
    for (const [i, topic2] of topics.entries()) {
      const label = `${i + 1} ${topic2.label}`;
      if (textW(label, TUT.bandSize) > TUT.chipW - 12 + EPS) out.push(`chip「${label}」放不下 ${TUT.chipW - 12}`);
    }
  }

  // 横幅:主句一行放得下(横幅没有第二行主句的位置);提示行按「计数前缀 + 最长失败提示」量
  for (const topic of topics) {
    const bn = bannerLayout(topic);
    if (textW(topic.practice, 17) > widthOf(bn.main) + EPS) out.push(`${topic.id}:横幅主句「${topic.practice}」放不下`);
    for (const hint of [topic.hint, "有效 2/2 · 下网了:等球落低一点、仰角给足"]) {
      if (textW(hint, TUT.hintSize) > widthOf(bn.hint) + EPS) out.push(`${topic.id}:横幅提示「${hint}」放不下`);
    }
  }

  // 色带:文案必须放得进「带内文字盒」(面板把文字摆在这里,放不下的那几个字是看不见的)
  const bandIssues: Array<[string, Box, string, number]> = [
    ["标题带", titleBand(), BAR_TITLE, TUT.titleSize],
  ];
  for (const [i, { topic, info }] of briefInfos(topics).entries()) {
    bandIssues.push([`${topic.id}·怎么玩`, info.howTo, SECTIONS.howTo, TUT.bandSize]);
    bandIssues.push([`${topic.id}·练一练`, info.practice, topic.practice, TUT.bandSize]);
    bandIssues.push([`横幅badge${i + 1}`, bannerLayout(topic).badge, bannerBadge(i), TUT.bandSize]);
  }
  for (const [nm, b, text, size] of bandIssues) {
    const o = bandTextFits(b, text, size);
    if (o) out.push(`${nm} ${o}`);
  }

  const D = doneLayout();
  for (const [nm, b] of [["标题", D.title], ["副行", D.sub], ["去打一局", D.go], ["回主菜单", D.menu]] as Array<[string, Box]>) {
    const o = boxOverflow(b);
    if (o) out.push(`完成页 ${nm} ${o}`);
  }
  if (textW(DONE.sub, TUT.doneSubSize) > widthOf(D.sub) + EPS) out.push(`完成页副行放不下`);
  return out;
}

/** 可点件的尺寸表(调用方与 TOUCH.min 比对) */
export function tutTouch(): Array<[string, number]> {
  const row = bottomRow();
  const D = doneLayout();
  return [
    ["‹", row.chevL.h], ["›", row.chevR.h],
    ...row.chips.map((c, i) => [`chip${i + 1}`, c.h] as [string, number]),
    ["跳过", row.skip.h], ["去练一练", row.go.h],
    ["看演示(横幅)", TUT.seeW > 0 ? TUT.keyH : 0],
    ["去打一局(完成页)", D.go.h], ["回主菜单(完成页)", D.menu.h],
    ["关闭键", closeHit().h],
  ];
}
