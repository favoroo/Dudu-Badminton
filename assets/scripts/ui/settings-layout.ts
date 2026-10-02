// ============================================================
// 设置页版式:一行三件事(标签 / 控件 / 读数)的唯一算术。
//
// 为什么提成纯函数 —— 这一页原来把坐标全写死在 settings-panel 里
// (COL_X=-338、rows=[56,0,-56,-112,-168]、TIER_SLIDER_X=-51…),而它正是
// 「改一个控件高度就全线撞车」的那类排版:
//   · 开关从 40 抬到 TOUCH_MIN=44(拇指点准下限),行距 56 立刻只剩 12 缝;
//   · 开关右端要放斜纹记号 + 「开/关」读数,原来 140 宽的开关根本放不下
//     (「震动反馈」四字 63 + 记号 22 + 读数 44 + 两侧留白 22 = 151 > 140)。
// 这类账手调是调不准的,也留不住 —— 交给 tools/panel-check.ts 在 node 下断言。
//
// 依赖纪律:零 cc,只 import p5-tokens 与本目录的 text-metrics(与 editor-strip 同规格,
// 已挂进 tools/tsconfig.json 的 include)。面板只照返回的坐标摆。
// ============================================================
import { TOUCH } from "./p5-tokens";
import { textW } from "../core/text-metrics";

export const SET = {
  /** 卡片尺寸:宽 760 是「调整位置」顶栏(strip-check)与本页共用的招牌,别单改 */
  pw: 760,
  ph: 424,
  /** 卡片中心下移:顶边 201 仍低于 HUD 记分牌底边 203(从暂停页打开时不挡比分) */
  cardY: -11,
  /** 内容左缘:两页的小节标题与行标签统一贴这里 */
  colX: -338,
  /** 内容右缘 */
  right: 340,
  titleY: 186,
  doneBtn: { w: 150, h: TOUCH.min, x: 0, y: 176 },   // x 由 pw 倒推,见下方 donePos()
  tab: { w: 176, h: TOUCH.min, gap: 12, y: 144 },
  /** 小节色带高 */
  sectionH: 24,
  /** 行高 = 触控下限;行距 = 行高 + 12 */
  rowH: TOUCH.min,
  rowPitch: TOUCH.min + 12,
  /** 第一行的行心(往下按 rowPitch 排) */
  rowTop: 56,
} as const;

/** 「完成」按钮中心:贴在卡片右上角 */
export function donePos(): { x: number; y: number } {
  return { x: SET.pw / 2 - 98, y: SET.doneBtn.y };
}

/** tab 栏:每项的**中心 x**(整组居中) */
export function tabRow(n: number, y: number = SET.tab.y): number[] {
  const total = n * SET.tab.w + (n - 1) * SET.tab.gap;
  return Array.from({ length: n }, (_, i) => -total / 2 + SET.tab.w / 2 + i * (SET.tab.w + SET.tab.gap));
}

/** 第 i 行的行心 */
export function rowY(i: number): number {
  return SET.rowTop - i * SET.rowPitch;
}

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;

/** 控件行:左缘 + 宽 + 行心 → 一个包围盒 */
export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}

// ---------- 声音画面页 ----------

/** 左列开关宽:容得下「震动反馈」+ 记号 + 读数(见文件头那条算术) */
export const TOG_W = 176;
/** 开关右端的记号 + 读数占位,与 p5-shapes.toggleDL / TOGGLE_READOUT_W 同源 */
export const TOG_TAIL = 74;
export const VOL_W = 130;

export interface MediaRow {
  label: string;
  toggle: Box;
  /** 音量滑杆:只有音效/音乐两行有(震动反馈那行右边是空的) */
  vol: Box | null;
  y: number;
}

export interface MediaLayout {
  /** 左子列小节标题「声音与震动」 */
  sectionLeft: Box;
  /** 右子列小节标题「画面」 */
  sectionRight: Box;
  /** 左子列三行开关:音效 / 音乐 / 震动反馈 */
  toggles: MediaRow[];
  /** 右子列三行开关:落点预测圈 / 屏幕震动 / 飘字提示 */
  hints: Box[];
  strength: { name: Box; slider: Box; caption: Box };
  test: { btn: Box; status: Box };
}

/** 左子列的三行开关(第 4、5 行是强度与试震,不是开关 —— 别按五行生成开关盒) */
export const TOGGLE_LABELS = ["音效", "音乐", "震动反馈"];

/**
 * 声音画面页:左子列「声音与震动」(开关 + 音量 + 强度 + 试震),右子列「画面」(三个提示开关)。
 * 返回逐块包围盒,面板照摆、check 照断言。
 */
export function mediaLayout(): MediaLayout {
  const leftTog = SET.colX;
  const volLeft = leftTog + TOG_W + 8;
  return {
    sectionLeft: box(SET.colX, 130, SET.rowTop + SET.rowPitch, SET.sectionH),
    sectionRight: box(60, 60, SET.rowTop + SET.rowPitch, SET.sectionH),
    toggles: TOGGLE_LABELS.map((label, i) => {
      const y = rowY(i);
      return {
        label, y,
        toggle: box(leftTog, TOG_W, y, SET.rowH),
        vol: i < 2 ? box(volLeft, VOL_W, y, SET.rowH) : null,
      };
    }),
    hints: [0, 1, 2].map((i) => box(60, 280, rowY(i), SET.rowH)),
    strength: strengthRow(),
    test: hapticTestRow(),
  };
}

/** 右子列(画面)三行开关 */
export function mediaHints(): Box[] {
  return mediaLayout().hints;
}

/** 强度行:标签 34 + 滑杆 130 + 档名 66,整条落在左列内 */
export function strengthRow(): { name: Box; slider: Box; caption: Box } {
  const y = rowY(3);
  return {
    name: box(SET.colX, 34, y, 18),
    slider: box(SET.colX + 40, 130, y, SET.rowH),
    caption: box(SET.colX + 178, 66, y, 18),
  };
}

/** 试震按钮 + 马达状态读数行 */
export function hapticTestRow(): { btn: Box; status: Box } {
  const y = rowY(4);
  return {
    btn: box(SET.colX, 110, y, TOUCH.min),
    status: box(60, 280, y, 18),
  };
}

// ---------- 操控页 ----------

export interface ControlLayout {
  sectionMove: Box;
  modes: Box[];
  modeTip: Box;
  actions: Box[];
  sectionFeel: Box;
  feelHint: Box;
  tiers: Array<{ name: Box; slider: Box; caption: Box; y: number }>;
}

/**
 * 操控页:移动方式三选一 + 两颗动作键 + 手感两档(球速/移速)。
 * 行心一律由 rowPitch 推,不再手写 -124/-168 这种「看着差不多」的数 ——
 * 上一版滑杆触摸区从 34 抬到 44 后,那两行会重叠 4px,而 4px 在屏幕上是看不出来的撞。
 */
export function controlLayout(): ControlLayout {
  const modeW = 120, modeH = TOUCH.min, modeGap = 14;
  const modeTotal = 3 * modeW + 2 * modeGap;
  const modeY = 62;
  const actY = -20;
  const feelY = actY - 64;
  const tiers = [0, 1].map((i) => {
    const y = feelY - 42 - i * 50;
    return {
      name: box(SET.colX, 46, y, 18),
      slider: box(-201, 300, y, SET.rowH),
      caption: box(190, 150, y, 18),
      y,
    };
  });
  return {
    sectionMove: box(SET.colX, 120, 104, SET.sectionH),
    modes: [0, 1, 2].map((i) => box(-modeTotal / 2 + i * (modeW + modeGap), modeW, modeY, modeH)),
    modeTip: box(-210, 420, modeY - 34, 16),
    actions: [
      box(-178, 190, actY, TOUCH.min + 2),
      box(28, 150, actY, TOUCH.min + 2),
    ],
    sectionFeel: box(SET.colX, 70, feelY, SET.sectionH),
    feelHint: box(SET.colX + 78, 330, feelY, 18),
    tiers,
  };
}

// ---------- 判据 ----------

const overlapX = (a: Box, b: Box): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5;
const overlapY = (a: Box, b: Box): boolean => bottom(a) < top(b) - 0.5 && bottom(b) < top(a) - 0.5;

/** 两个包围盒是否压在一起 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && overlapY(a, b);
}

/** 越出内容区(±colX..right,以及卡片上下边) */
export function boxOverflow(b: Box): string | null {
  if (b.left < SET.colX - 0.5) return `左缘 ${b.left.toFixed(1)} < ${SET.colX}`;
  if (b.right > SET.right + 0.5) return `右缘 ${b.right.toFixed(1)} > ${SET.right}`;
  const half = SET.ph / 2 + SET.cardY;
  if (top(b) > half) return `顶边 ${top(b).toFixed(1)} > ${half}`;
  if (bottom(b) < -half) return `底边 ${bottom(b).toFixed(1)} < ${-half}`;
  return null;
}

/** 一行里所有块的两两重叠 + 跨子列碰撞(面板与 check 共用同一判据) */
export function settingsOverlaps(): string[] {
  const out: string[] = [];
  const M = mediaLayout(), K = controlLayout();
  const rows: Array<[string, Box[]]> = [
    // 左列整列一起查:开关、音量、强度三件、试震与状态 —— 它们同在一列的不同行上,
    // 分行查会漏掉「强度滑杆伸进上一行开关的盒子」这类跨行咬合。
    ["声音画面·左列", [
      ...M.toggles.flatMap((r) => [r.toggle, ...(r.vol ? [r.vol] : [])]),
      M.strength.name, M.strength.slider, M.strength.caption,
      M.test.btn, M.test.status,
    ]],
    ["声音画面·右列", M.hints],
    ["操控·移动方式", K.modes],
    ["操控·动作键", K.actions],
    ["操控·手感行", K.tiers.flatMap((t) => [t.name, t.slider, t.caption])],
  ];
  for (const [nm, bs] of rows) {
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        if (boxesOverlap(bs[i], bs[j])) out.push(`${nm}:第 ${i} 与第 ${j} 块重叠`);
      }
    }
  }
  // 跨子列:左列开关/音量 与 右列开关同排时不许咬在一起
  for (const r of M.toggles) {
    for (const h of M.hints) {
      if (Math.abs(r.y - h.cy) < 1 && boxesOverlap(r.toggle, h)) out.push(`左右子列开关撞行 y=${r.y}`);
      if (r.vol && boxesOverlap(r.vol, h)) out.push("音量滑杆压到右列开关");
    }
  }
  for (const h of M.hints) {
    if (Math.abs(M.strength.slider.cy - h.cy) < 1 && boxesOverlap(M.strength.slider, h)) out.push("强度滑杆压到右列开关");
    if (Math.abs(M.test.btn.cy - h.cy) < 1 && boxesOverlap(M.test.btn, h)) out.push("试震按钮压到状态读数");
  }
  // 小节标题压在首行上
  if (boxesOverlap(M.sectionLeft, M.toggles[0].toggle)) out.push("左小节标题压住首行开关");
  if (boxesOverlap(K.sectionMove, K.modes[0])) out.push("「移动方式」标题压住三选一");
  if (boxesOverlap(K.sectionFeel, K.tiers[0].slider)) out.push("「手感」标题压住球速滑杆");
  return out;
}

/** 溢出 + 文案宽度:开关标签必须容得下「震动反馈」,每块控件必须在内容区内 */
export function settingsOverflow(labels: string[] = ["音效", "音乐", "震动反馈"]): string[] {
  const out: string[] = [];
  const M = mediaLayout(), K = controlLayout();
  const all: Array<[string, Box]> = [
    ...M.toggles.flatMap((r, i): Array<[string, Box]> => r.vol
      ? [[`左列开关#${i}`, r.toggle], [`音量滑杆#${i}`, r.vol]]
      : [[`左列开关#${i}`, r.toggle]]),
    ...M.hints.map((b, i): [string, Box] => [`右列开关#${i}`, b]),
    ["强度滑杆", M.strength.slider],
    ["强度档名", M.strength.caption],
    ["试震按钮", M.test.btn],
    ["马达状态", M.test.status],
    ...K.tiers.flatMap((t, i): Array<[string, Box]> => [
      [`手感标签#${i}`, t.name], [`手感滑杆#${i}`, t.slider], [`手感档名#${i}`, t.caption],
    ]),
  ];
  for (const [nm, b] of all) {
    const o = boxOverflow(b);
    if (o) out.push(`${nm} ${o}`);
  }
  // 开关标签可用宽 = 行宽 - 记号与读数占位 - 左留白;四字标签按 15 号量,放不下就是布局错
  const avail = TOG_W - TOG_TAIL - 28;
  for (const s of labels) {
    const w = textW(s, 15);
    if (w > avail) out.push(`开关标签「${s}」${w.toFixed(0)}px > 可用 ${avail}px`);
  }
  return out;
}
