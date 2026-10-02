// ============================================================
// 训练场版式:列表页 6 张卡 + 引导页(演示动画 / 控制条 / 信息列)的唯一算术。
//
// 为什么提成纯函数 —— 这一页原来把坐标全写死在 drill-panel 里(ANIM_W=470、
// `infoX = -(PW-20)/2 + ANIM_W + 20 + INFO_W/2`、控制条 y=-146、按钮 y=-ANIM_H/2+10),
// 而它正是「改一个字号/高度就全线撞车」的那类排版:
//   · 三颗演示键写死 32 高,低于拇指点准下限 TOUCH.min=44 —— 手机上按不准还看不出;
//   · 教练框写死 48 高,口诀与按键两行加内边距正好顶满,再长一点就糊到下面的「动作要领」;
//   · 步骤读数 `${序号}. ${阶段} · ${说明}` 最长一条按 11 号量到 207px,写死 200 宽的框
//     会被 CLAMP 直接裁掉尾巴 —— 裁字不报错,只有肉眼发现。
// 所以这里把「几何 + 折行 + 按内容长高」全做成算术:面板只照返回的坐标摆,
// 判据交给 tools/panel-check.ts 在 node 下断言(不重叠、不溢出、文案放得下)。
//
// 依赖纪律:**零 cc** —— 只 import p5-tokens(触控尺与斜切档)、core/text-metrics(字宽这把尺)
// 与 core/config(关卡表 + 动画画布尺寸)。坐标一律以**面板中心**为原点(cc 的 y 朝上),
// 卡内块以**卡中心**为原点 —— 面板那边一次减法都不用做。
//
// ⚠ 卡面为什么不是整面实底:出图实测 6 张卡各涂满绿会糊成一堵墙,而 P5 的语言是
//   红黑白主导 + 点缀 —— 卡片只吃「顶部一条色带 + 一圈同色 keyline」(见 p5-shapes.cardDL)。
// ============================================================
import { SLANT, TOUCH } from "./p5-tokens";
import { textW, wrapText } from "../core/text-metrics";
import { CFG, DRILLS } from "../core/config";
import type { DrillDef } from "../core/types";

// ---------- 盒模型(与 settings-layout 同构:包围盒 + 相交判据) ----------

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;
export const widthOf = (b: Box): number => b.right - b.left;
export const centerX = (b: Box): number => b.left + widthOf(b) / 2;

/** 左缘 + 宽 + 块心 + 高 → 一个包围盒 */
export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}

/** 与 ui-arcade.skewOf / p5-shapes.skewOf 同式(本模块零 cc,不能 import 那两边) */
export function shearOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

// ---------- 版面常量 ----------

export const DRILL = {
  pw: 880, ph: 470,
  /** 面板中心在整屏里的下移量(与 career-panel 同一张招牌) */
  panelY: -10,

  /** 内容左/右缘:±420 = 面板半宽 440 各留 20 */
  left: -420,
  right: 420,
  /** 内容上缘(顶栏之下)/ 下缘(再往下就是衬纸的撕口与斜切阴影) */
  contentTop: 186,
  contentBottom: -186,
  /** 衬纸内缘硬线:斜切底块的角越过这里就画到面板外面了 */
  plateEdge: 432,

  /** 顶栏:标题色带 + 「N / 6 已练成」+ 关闭键 */
  barCy: 208,
  barH: 32,

  /** 列表页网格:3 列 × 2 行;272×3 + 12×2 = 840 正好铺满内容宽 */
  cols: 3,
  cw: 272, ch: 150, gapX: 12, gapY: 14,

  /** 卡内:色带高(cardDL 的 bandH 由面板显式传过来,与 tag 框同源)*/
  bandH: 30,
  padX: 12,
  nameY: 26,
  descY: -2,
  goalY: -27,
  footY: -50,
  tagSize: 12, nameSize: 20, descSize: 12, goalSize: 12, footSize: 12,
  starS: 8,
  /** 引导页左列:动画框与控制条之间的缝 */
  animGap: 8,
  /** 三颗演示键的宽度(读数框吃剩下的) */
  playW: 80, speedW: 76, replayW: 64, keyGap: 10,

  /** 引导页右列(信息列) */
  infoLeft: 62,
  infoRight: 420,
  /** 小节色带高 */
  bandH2: 26,
  bandSize: 13, cueSize: 13, pointSize: 11, examSize: 11,

  /** 底部两颗:GO 是这一屏唯一的成交入口,给到 52 */
  goW: 200, goH: 52, backW: 138, backH: 52, btnGap: 12, btnCy: -160,
} as const;

// ---------- 文案(面板与判据共用同一份,不会各说各话) ----------

export const BAR_TITLE = "训练场";
export const SECTIONS = { howTo: "这一拍怎么打", points: "动作要领", exam: "考核指标" } as const;
export const DEMO_TAG = "教学演示";

/**
 * 演示键文案。emoji 一个不许留:原生 Android 没有彩色 emoji 字体,⏸ ▶ 🐢 ⚡ 在真机上
 * 要么方框要么缺字(与 makeCoinIcon 当初换掉 🪙 同一条理由)。播放/暂停改由 Graphics 画。
 */
export const KEYS = {
  play: "播放", pause: "暂停", replay: "重播",
  slow: "慢放 0.5x", normal: "原速 1x",
} as const;

export const BTNS = { go: "开始训练", back: "换个项目" } as const;

/** 头部读数 */
export function headText(done: number, total: number): string {
  return `${done} / ${total} 已练成`;
}

/**
 * 三星考核指标 —— 判据来自 CFG.drill(defaultGoal / star.sweetRatio / avgQ3),
 * 文案写在这里,引导页与 node 断言读同一份。行首的星数由 drawStarGlyph 画,不写成 ★。
 */
export function starGoals(): string[] {
  const d = CFG.drill;
  return [
    `打出 ${d.defaultGoal} 拍有效回球`,
    `有效球里 ${Math.round(d.star.sweetRatio * 100)}% 踩到甜蜜窗`,
    `完美 1 次且综合质量 ≥${Math.round(d.star.avgQ3 * 100)}%`,
  ];
}

/** 达标拍数(卡上那一行) */
export function goalTextOf(def: DrillDef): string {
  return `目标 ${def.goal || CFG.drill.defaultGoal} 拍有效球`;
}

/** 卡脚:练成过就说练成几次,没练成就说首通给多少 */
export function footTextOf(clears: number, coin: number, exp: number): string {
  return clears > 0
    ? `已练成 ${clears} 次 · 首通 金币${coin}`
    : `首通奖励 金币${coin} · EXP${exp}`;
}

/**
 * 触屏动作说明:只写触屏向,桌面键名一个不留(旧版是「短球 [K / 左键]」「起跳 [W / 向上]」)。
 * wantKey 的分工见 core/config 注释:far = 击球键向右滑出深球,near = 向左滑出短球。
 */
export function requirementOf(def: DrillDef): string {
  const shot = def.wantKey === "near" ? "击球键向左滑 · 短球" : "击球键向右滑 · 深球";
  return `${shot} · ${def.pose?.jump ? "需要起跳" : "不必起跳"}`;
}

/**
 * 步骤读数的**最坏样本**。真值来自 render/drill-anim.stageOfFrame(),而那边 import cc
 * (要画 Graphics),零 cc 的本模块不能反向 import —— 所以这里照抄一份最长的四条说明,
 * 只用来钉「读数框放不放得下」。真机文案仍以 stageOfFrame 为准。
 */
export const STAGE_WORST = ["迅速移动到位或起跳迎击", "抓住最佳击球时机按下按键", "球越过球网落入目标得分区"] as const;

// ---------- 顶栏 ----------

export function titleBand(): Box {
  return box(DRILL.left, 132, DRILL.barCy, DRILL.barH);
}

/**
 * 关闭键命中盒:整块 44 = TOUCH.min。
 * ui-arcade.uiIconButton 默认给 56 的命中区(它带 44 的视觉圆底),这里显式传 hit:44 ——
 * 顶栏只有 32 高,56 会把命中盒捅到内容区上缘以外。
 */
export function closeHit(): Box {
  const hit = TOUCH.min;
  return box(DRILL.right - hit, hit, DRILL.barCy, hit);
}

/** 「N / 6 已练成」:右对齐,右端给关闭键让开 10 */
export function headInfoBand(): Box {
  const right = closeHit().left - 10;
  return box(60, right - 60, DRILL.barCy, 24);
}

// ---------- 列表页:6 张卡 ----------

/** 卡片的**面板局部**包围盒:整排居中于内容宽,两行在内容高里垂直居中 */
export function cardBoxes(): Box[] {
  const n = DRILLS.length;
  const rows = Math.ceil(n / DRILL.cols);
  const totalH = rows * DRILL.ch + (rows - 1) * DRILL.gapY;
  const topEdge = DRILL.contentTop - (DRILL.contentTop - DRILL.contentBottom - totalH) / 2;
  const totalW = DRILL.cols * DRILL.cw + (DRILL.cols - 1) * DRILL.gapX;
  return Array.from({ length: n }, (_, i) => {
    const col = i % DRILL.cols, row = Math.floor(i / DRILL.cols);
    const cx = -totalW / 2 + col * (DRILL.cw + DRILL.gapX) + DRILL.cw / 2;
    const cy = topEdge - row * (DRILL.ch + DRILL.gapY) - DRILL.ch / 2;
    return box(cx - DRILL.cw / 2, DRILL.cw, cy, DRILL.ch);
  });
}

export interface CardRows {
  /** 顶部色带(cardDL 的 band:墨面之上一整条 accent) */
  band: Box;
  /** 色带里的 tag(拉丁小标签,字色由面色亮度算) */
  tag: Box;
  /** 三颗四尖星:卡面右上,与名称同排 */
  stars: Box;
  name: Box; desc: Box; goal: Box; foot: Box;
}

/**
 * 卡内各块 —— **卡中心**为原点。
 * 名称左对齐 + 星级右对齐同占一排,是「一眼看到这颗练到什么程度」的最短路径;
 * 名称排宽按 starW 倒推,六关的 label 全是四字(按 20 号量 84px)—— 这条由 drillOverflow 钉。
 */
export function cardRows(): CardRows {
  const hw = DRILL.cw / 2, hh = DRILL.ch / 2;
  const bandH = DRILL.bandH;
  const inner = -hw + DRILL.padX;
  const right = hw - DRILL.padX;
  const starW = starRowWidth();
  const nameW = right - inner - starW - 10;
  return {
    band: box(-hw, DRILL.cw, hh - bandH / 2, bandH),
    tag: box(inner, right - inner - 10 - starW, hh - bandH / 2, bandH - 10),
    stars: box(right - starW, starW, DRILL.nameY, 20),
    name: box(inner, nameW, DRILL.nameY, 30),
    desc: box(inner, right - inner, DRILL.descY, 17),
    goal: box(inner, right - inner, DRILL.goalY, 16),
    foot: box(inner, right - inner, DRILL.footY, 16),
  };
}

/** 三颗星占的整排宽(右锚往左排) */
export function starRowWidth(): number {
  const s = DRILL.starS;
  return 2 * s + 4 + 2 * (s * 2.6);
}

/** 三颗四尖星的圆心(右锚,由右往左) */
export function starCenters(b: Box): number[] {
  const s = DRILL.starS;
  return [0, 1, 2].map((i) => b.right - s - 2 - (2 - i) * (s * 2.6));
}

// ---------- 引导页:左列 ----------

/** 演示动画框:尺寸只认 CFG.drill.canvas 这一处(画布与引导相机共用) */
export function animBox(): Box {
  const c = CFG.drill.canvas;
  return box(DRILL.left, c.w, DRILL.contentTop - c.h / 2, c.h);
}

/** 动画框左上角的「教学演示」色带(压在动画之上,故意与 animBox 同域) */
export function demoTagBox(): Box {
  const a = animBox();
  return box(a.left + 10, bandW(DEMO_TAG, 11), top(a) - 10 - DRILL.bandH2 / 2, DRILL.bandH2);
}

export interface CtrlRow { play: Box; speed: Box; replay: Box; stage: Box }

/** 控制条:三颗演示键 + 步骤读数,整条与动画框同宽同左缘 */
export function ctrlRow(): CtrlRow {
  const a = animBox();
  const h = TOUCH.min;
  const cy = bottom(a) - DRILL.animGap - h / 2;
  const play = box(a.left, DRILL.playW, cy, h);
  const speed = box(play.right + DRILL.keyGap, DRILL.speedW, cy, h);
  const replay = box(speed.right + DRILL.keyGap, DRILL.replayW, cy, h);
  const stageLeft = replay.right + DRILL.keyGap;
  const stage = box(stageLeft, a.right - stageLeft, cy, h);
  return { play, speed, replay, stage };
}

/** 键内左侧的图标位(播放=三角,暂停=双竖条,全用 Graphics 画) */
export function glyphBox(b: Box, s = 14): Box {
  return box(b.left + 10, s, b.cy, s);
}

/** 键内文案位:带图标的让开图标,不带图标的整块居中 */
export function keyTextLabel(b: Box, withGlyph: boolean): Box {
  const g = glyphBox(b);
  return withGlyph
    ? box(g.right + 6, b.right - (g.right + 6) - 6, b.cy, b.h)
    : box(b.left + 6, widthOf(b) - 12, b.cy, b.h);
}

/** 步骤读数两行:阶段名 + 说明(长说明按 10 号量过最坏样本,见 STAGE_WORST) */
export function stageLines(b: Box): { name: Box; desc: Box } {
  return {
    name: box(b.left + 8, widthOf(b) - 16, b.cy + 9, 16),
    desc: box(b.left + 8, widthOf(b) - 16, b.cy - 9, 14),
  };
}

/** 播放三角的三个顶点(键内图标位的中心) */
export function playTri(b: Box): number[][] {
  const cx = centerX(glyphBox(b)), cy = b.cy, s = glyphBox(b).h / 2;
  return [[cx - s * 0.62, cy + s * 0.8], [cx - s * 0.62, cy - s * 0.8], [cx + s * 0.9, cy]];
}

/** 暂停双竖条:左缘 x / 宽 / 高(条高按图标位高的 1.7 倍算,和三角同视觉重量) */
export function pauseBars(b: Box): Array<{ x: number; w: number; h: number }> {
  const cx = centerX(glyphBox(b)), s = glyphBox(b).h / 2;
  const w = s * 0.44, h = s * 1.7;
  return [{ x: cx - s * 0.72, w, h }, { x: cx + s * 0.72 - w, w, h }];
}

// ---------- 引导页:右列(信息列) ----------

export interface InfoBlock { key: string; box: Box; lines: string[]; size: number; lineH: number }

export interface BriefInfo {
  name: InfoBlock;
  howTo: Box;
  cue: InfoBlock;
  /** 「击球键向右滑 · 深球 · 不必起跳」这条整面实底色带 */
  requirement: Box & { text: string };
  pointsBand: Box;
  points: InfoBlock;
  examBand: Box;
  exam: InfoBlock;
  go: Box; back: Box;
}

/** 色带宽度:文案实测 + 两侧内边距(斜切多出去的那半由 shearOf 在判据里另算) */
export function bandW(text: string, size: number): number {
  return textW(text, size) + 28;
}

/** 信息列可用文案宽(整列宽减左右内边距) */
export function infoInner(): number {
  return DRILL.infoRight - DRILL.infoLeft - 2 * DRILL.padX;
}

/**
 * 信息列:名称 → 「这一拍怎么打」带 + 口诀 → 触屏要求色带 → 动作要领 → 考核指标 → 两颗键。
 * 竖排走**内容驱动的游标**(每块上缘贴上一块下缘减 lead),所以「不压字」是排版的性质
 * 而不是对某一句文案的假设;而「整列塞不塞得进按钮之上」由 drillOverflow 逐关钉。
 */
export function briefInfo(def: DrillDef): BriefInfo {
  const L = DRILL.infoLeft, R = DRILL.infoRight, inner = infoInner();
  const cueLines = wrapText(def.cue, DRILL.cueSize, inner);
  const cueH = cueLines.length * 20;
  const pointLines: string[] = [];
  for (const p of def.points) pointLines.push(...wrapText(p, DRILL.pointSize, inner - 12));
  const pointsH = pointLines.length * 16 + Math.max(0, def.points.length - 1) * 2;
  const goals = starGoals();
  const examH = goals.length * 16;

  const name = box(L, R - L, DRILL.contentTop - 15, 30);
  // 游标:每块的上缘贴上一块的下缘减缝宽。缝宽分三档 —— 带与正文 5~6、
  // 正文与新的小节带 10、带与带之间的整块 7,最后给按钮行留出整列的余量。
  let cursor = bottom(name) - 6;
  const howTo = box(L, bandW(SECTIONS.howTo, DRILL.bandSize), cursor - DRILL.bandH2 / 2, DRILL.bandH2);
  cursor = bottom(howTo) - 5;
  const cueB = box(L + DRILL.padX, inner, cursor - cueH / 2, cueH);
  cursor = bottom(cueB) - 7;
  const reqText = requirementOf(def);
  const requirement = {
    ...box(L + DRILL.padX, bandW(reqText, DRILL.bandSize), cursor - DRILL.bandH2 / 2, DRILL.bandH2),
    text: reqText,
  };
  cursor = bottom(requirement) - 10;
  const pointsBand = box(L, bandW(SECTIONS.points, DRILL.bandSize), cursor - DRILL.bandH2 / 2, DRILL.bandH2);
  cursor = bottom(pointsBand) - 5;
  const pointsB = box(L + DRILL.padX, inner, cursor - pointsH / 2, pointsH);
  cursor = bottom(pointsB) - 10;
  const examBand = box(L, bandW(SECTIONS.exam, DRILL.bandSize), cursor - DRILL.bandH2 / 2, DRILL.bandH2);
  cursor = bottom(examBand) - 5;
  const examB = box(L + DRILL.padX, inner, cursor - examH / 2, examH);

  const go = box(L, DRILL.goW, DRILL.btnCy, DRILL.goH);
  const back = box(go.right + DRILL.btnGap, DRILL.backW, DRILL.btnCy, DRILL.backH);

  return {
    name: { key: "name", box: name, lines: [def.label], size: DRILL.nameSize, lineH: 26 },
    howTo,
    cue: { key: "cue", box: cueB, lines: cueLines, size: DRILL.cueSize, lineH: 20 },
    requirement,
    pointsBand,
    points: { key: "points", box: pointsB, lines: pointLines, size: DRILL.pointSize, lineH: 16 },
    examBand,
    exam: { key: "exam", box: examB, lines: goals, size: DRILL.examSize, lineH: 16 },
    go, back,
  };
}

/**
 * 考核三行:第 i 行的三颗星(实 i+1 颗)+ 文案框。
 * 星半径与间距一起给出去 —— 出图第一版半径 8、间距 14.4,三颗叠成一团四尖星,
 * 屏幕上看着像一枚脏印章。半径只许到 pitch 的一半以内,所以这里把两个数同源。
 */
export function examStarRow(b: Box, i: number): { centers: number[]; r: number; text: Box } {
  const pitch = 15, r = 6;
  const rowCy = top(b) - i * b.h / 3 - b.h / 6;
  const centers = [0, 1, 2].map((k) => b.left + r + 2 + k * pitch);
  return { centers, r, text: box(centers[2] + r + 9, b.right - (centers[2] + r + 9), rowCy, 16) };
}

// ============================================================
// 判据(面板与 tools/panel-check.ts 共用同一份)
// ============================================================

const EPS = 0.5;
const overlapX = (a: Box, b: Box): boolean => a.left < b.right - EPS && b.left < a.right - EPS;
const overlapY = (a: Box, b: Box): boolean => bottom(a) < top(b) - EPS && bottom(b) < top(a) - EPS;

/** 两个包围盒是否压在一起 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && overlapY(a, b);
}

/** 文本块越出内容区(±left..right / contentBottom..contentTop) */
export function boxOverflow(b: Box): string | null {
  if (b.left < DRILL.left - EPS) return `左缘 ${b.left.toFixed(1)} < ${DRILL.left}`;
  if (b.right > DRILL.right + EPS) return `右缘 ${b.right.toFixed(1)} > ${DRILL.right}`;
  if (top(b) > DRILL.contentTop + EPS) return `顶边 ${top(b).toFixed(1)} > ${DRILL.contentTop}`;
  if (bottom(b) < DRILL.contentBottom - EPS) return `底边 ${bottom(b).toFixed(1)} < ${DRILL.contentBottom}`;
  return null;
}

/**
 * 斜切底块的最坏边角是否还在衬纸内:cardDL / 色带都把顶边按 shearOf 推出去半份,
 * 所以「框宽 = 内容宽」并不等于画出来不出界(旧版那 6 张卡正好差 2px,没人发现)。
 */
export function baseOverflow(b: Box, deg = SLANT.block): string | null {
  const half = shearOf(b.h, deg) / 2;
  if (b.right + half > DRILL.plateEdge + EPS) return `斜切右角 ${(b.right + half).toFixed(1)} > ${DRILL.plateEdge}`;
  if (b.left - half < -DRILL.plateEdge - EPS) return `斜切左角 ${(b.left - half).toFixed(1)} < ${-DRILL.plateEdge}`;
  if (top(b) > DRILL.ph / 2) return `顶边 ${top(b).toFixed(1)} > 面板半高 ${DRILL.ph / 2}`;
  if (bottom(b) - 8 < -DRILL.ph / 2) return `底边 ${bottom(b).toFixed(1)} 探出面板`;
  return null;
}

/** 顶栏三件 + 六张卡 + 卡内六排 + 左列 + 右列逐块 + 两列之间 —— 全在这里比对 */
export function drillOverlaps(drills: readonly DrillDef[] = DRILLS): string[] {
  const out: string[] = [];
  const pairs = (nm: string, bs: Box[]): void => {
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        if (boxesOverlap(bs[i], bs[j])) out.push(`${nm}:第 ${i} 与第 ${j} 块重叠`);
      }
    }
  };

  pairs("顶栏", [titleBand(), headInfoBand(), closeHit()]);
  pairs("列表页卡片", cardBoxes());

  const rows = cardRows();
  pairs("卡内上排", [rows.tag, rows.stars]);
  pairs("卡内竖排", [rows.band, rows.name, rows.desc, rows.goal, rows.foot]);

  const K = ctrlRow(), a = animBox();
  pairs("演示控制条", [K.play, K.speed, K.replay, K.stage]);
  if (top(K.play) >= bottom(a)) out.push("控制条顶到动画框");

  for (const { def, info } of briefInfos(drills)) {
    const col = [info.name.box, info.howTo, info.cue.box, info.requirement,
      info.pointsBand, info.points.box, info.examBand, info.exam.box, info.go, info.back];
    pairs(`${def.id}·信息列`, col);
    for (const b of [a, K.play, K.speed, K.replay, K.stage]) {
      for (const c of col) if (boxesOverlap(b, c)) out.push(`${def.id}:左列块压到右列`);
    }
  }
  return out;
}

/** 逐关把信息列摊开(判据要吃的就是这张表) */
export function briefInfos(drills: readonly DrillDef[] = DRILLS): Array<{ def: DrillDef; info: BriefInfo }> {
  return drills.map((def) => ({ def, info: briefInfo(def) }));
}

/**
 * 溢出 + 文案宽度:六关逐关摊开 —— 任何一块越出内容区、任何一句折行后仍比框宽、
 * 任何一条色带放不下、整列压到按钮行上,都在这里红。
 */
export function drillOverflow(drills: readonly DrillDef[] = DRILLS): string[] {
  const out: string[] = [];
  const rows = cardRows();
  for (const [i, b] of cardBoxes().entries()) {
    const o = baseOverflow(b);
    if (o) out.push(`卡片#${i} ${o}`);
  }
  for (const [nm, b] of Object.entries(rows) as Array<[string, Box]>) {
    if (bottom(b) < -DRILL.ch / 2 - EPS || top(b) > DRILL.ch / 2 + EPS) out.push(`卡内 ${nm} 越出卡片`);
  }
  const inner = infoInner();
  for (const { def, info } of briefInfos(drills)) {
    const all: Array<[string, Box]> = [
      ["名称", info.name.box], ["小节带·怎么打", info.howTo], ["口诀", info.cue.box],
      ["要求色带", info.requirement], ["小节带·要领", info.pointsBand], ["要领", info.points.box],
      ["小节带·考核", info.examBand], ["考核", info.exam.box], ["GO", info.go], ["换个项目", info.back],
    ];
    for (const [nm, b] of all) {
      const o = boxOverflow(b);
      if (o) out.push(`${def.id}·${nm} ${o}`);
    }
    // 游标排到最后一块,底边必须还在按钮行之上(口诀多出一行就会在这里红)
    if (bottom(info.exam.box) < top(info.go) + 4) out.push(`${def.id}:考核行压到按钮行`);
    // 折行之后再量一次:wrapText 保证单行不超 availW,这条是防有人把 inner 算错
    for (const blk of [info.cue, info.points, info.exam]) {
      for (const line of blk.lines) {
        if (textW(line, blk.size) > inner + EPS) out.push(`${def.id}·${blk.key} 「${line}」放不下 ${inner}`);
      }
    }
    for (const [nm, b, size] of [
      ["怎么打", info.howTo, DRILL.bandSize], ["要求", info.requirement, DRILL.bandSize],
      ["要领", info.pointsBand, DRILL.bandSize], ["考核", info.examBand, DRILL.bandSize],
    ] as Array<[string, Box, number]>) {
      const text = nm === "要求" ? info.requirement.text : SECTIONS[nm === "怎么打" ? "howTo" : nm === "要领" ? "points" : "exam"];
      if (textW(text, size) + 28 > widthOf(b) + EPS) out.push(`${def.id}:色带「${text}」文案比带宽`);
      if (widthOf(b) > DRILL.infoRight - DRILL.infoLeft + EPS) out.push(`${def.id}:色带「${text}」宽 ${widthOf(b)} > 信息列宽`);
    }
    if (textW(def.label, DRILL.nameSize) > widthOf(rows.name)) out.push(`${def.id}:名称 ${def.label} 超出卡内名称排宽`);
    if (textW(def.label, DRILL.nameSize) > widthOf(info.name.box)) out.push(`${def.id}:引导页名称超出信息列`);
    if (textW(def.desc, DRILL.descSize) > widthOf(rows.desc)) out.push(`${def.id}:描述「${def.desc}」超出卡内描述排宽`);
    if (textW(def.tag, DRILL.tagSize) > widthOf(rows.tag)) out.push(`${def.id}:tag ${def.tag} 超出色带文案位`);
    if (textW(goalTextOf(def), DRILL.goalSize) > widthOf(rows.goal)) out.push(`${def.id}:达标行超出卡内宽`);
    if (textW(footTextOf(0, 45, 46), DRILL.footSize) > widthOf(rows.foot)) out.push(`${def.id}:卡脚超出卡内宽`);
    const st = stageLines(ctrlRow().stage);
    for (const s of STAGE_WORST) {
      if (textW(s, 10) > widthOf(st.desc)) out.push(`${def.id}:步骤说明「${s}」超出读数框 ${widthOf(st.desc)}`);
    }
  }
  for (const [nm, b] of [["标题带", titleBand()], ["头部读数", headInfoBand()], ["关闭键", closeHit()]] as Array<[string, Box]>) {
    // 顶栏整排站在内容上缘之上:任何一件掉到 contentTop 以下,就是压进了列表/引导页
    if (bottom(b) < DRILL.contentTop - EPS) out.push(`顶栏 ${nm} 掉进内容区 ${bottom(b).toFixed(1)} < ${DRILL.contentTop}`);
    if (top(b) > DRILL.ph / 2) out.push(`顶栏 ${nm} 越出面板`);
    if (widthOf(b) < 1) out.push(`顶栏 ${nm} 宽算歪了`);
  }
  return out;
}

/**
 * 可点件的尺寸表(件名 + 高)。**由调用方与 TOUCH.min 比对** ——
 * tools/panel-check.ts 那张 `panels` 表把四块面板的同一件事并成一列判,
 * 判据留在调用侧,这里只负责「哪些件该多高」这一份数。
 * 旧版三颗演示键写死 32 高,就是这条红出来的。
 */
export function drillTouch(): Array<[string, number]> {
  const K = ctrlRow();
  const info = briefInfo(DRILLS[0]);
  return [
    ["播放/暂停", K.play.h], ["慢放", K.speed.h], ["重播", K.replay.h],
    ["开始训练", info.go.h], ["换个项目", info.back.h], ["关闭键", closeHit().h],
  ];
}
