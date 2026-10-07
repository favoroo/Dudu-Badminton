// ============================================================
// 活动面板版式:标题行 / 每日·每周 tab / 任务行×3 / 全勤宝箱行 的唯一算术。
//
// 为什么提成纯函数 —— 与 campaign-layout 同一条理由:任务行是「一个模板抄 4 行」的
// 排版,行内标题最长(「完成一次专项训练」8 字)、奖励读数最长(+100币 +60经验)、
// 按钮文案三态(领取/已领取/进行中)都要在同一行里互不压字;手拍坐标只保证当前
// 这几条文案不撞,config 表一改就破。判据 activityOverlaps/activityOverflow 由
// tools/activity-check.ts 在 node 下断言,**判据吃 config 真文案**,不是摆拍样本。
//
// 版面秩序(改版时钉死):
//   1) 任务行与宝箱行同宽同模板(内容列铺满 ±404),宝箱行只是文案不同;
//   2) 大色块只留给选中 tab 与可领取按钮 —— 任务行整面保持墨面(drawP5Card bandH:0),
//      可领态用 glow 描边点亮(与生涯里程碑卡片同一条语言,见 career-panel _buildStatsPage);
//   3) 进度条走 p5-shapes.progressDL(与经验条/下载条同一把尺),track+fill 画在同一个 Graphics。
//
// 依赖纪律:零 cc,只 import p5-tokens 与 core/text-metrics(与 campaign-layout 同规格)。
// 面板只照返回的坐标摆。
// ============================================================
import { TOUCH } from "./p5-tokens";
import { textW } from "../core/text-metrics";

// ---------- 骨架尺寸 ----------

const PAD_X = 36;
const CONTENT_W = 880 - PAD_X * 2;
const ROW_GAP = 12;
const ROW_H = 72;
/** 3 条任务 + 1 行宝箱 */
const ROWS = 4;
/** 行区上缘(tab 行下缘再让 6)——四行行心从这里往下排 */
const ROW_TOP = 122;
/** tab 固定宽:两格不铺满整列(整列是行区的),左对齐排 */
const TAB_W = 150;

export const ACT = {
  pw: 880,
  ph: 480,
  /** 内容左缘 / 右缘(±404) */
  colX: -CONTENT_W / 2,
  right: CONTENT_W / 2,
  /** 标题行:EN kicker 在上、中文标题在下,左锚贴 colX(与闯关大厅同一副骨架) */
  tag: { x: -CONTENT_W / 2, cy: 222, size: 10 },
  title: { x: -CONTENT_W / 2, cy: 196, size: 24 },
  /** 每日/每周的刷新说明:右锚贴 right,给 ✕ 让开命中区 */
  hint: { right: CONTENT_W / 2 - 56, cy: 222, size: 10 },
  close: { x: CONTENT_W / 2, cy: 198, hit: TOUCH.min, vis: 36 },
  /** tab 行:两格左对齐,高 = 触控下限 */
  tab: { w: TAB_W, h: TOUCH.min, gap: 12, cy: 150, size: 15 },
  /** 任务行区:行心由 rowBoxes 现算,这里只存模板数 */
  row: { h: ROW_H, gap: ROW_GAP, top: ROW_TOP, padX: 20 },
  /** 行内进度条:左缘贴行内 padX,行心在标题下方 */
  bar: { x: 20, w: 300, h: 12, cy: -18 },
  /** 行内领取按钮:右缘贴行内 padX,方形块(可点 = 亮色大色块语言) */
  btn: { w: 104, h: 44, right: 20, size: 15 },
  /** 行内奖励读数:右锚,贴在按钮左侧 */
  reward: { right: 140, cy: 20, size: 12 },
  /** 行内进度读数「7/10」:贴在进度条右侧 */
  prog: { x: 332, cy: -18, size: 12 },
} as const;

/** 文案常量:面板与判据共用同一串,量宽才不会被改出两份 */
export const HEADER_TEXT = { tag: "DAILY & WEEKLY", title: "活动中心" } as const;
export const TAB_TEXT = { daily: "每日任务", weekly: "每周任务" } as const;
export const REFRESH_HINT = { daily: "每天 0 点刷新", weekly: "每周一 0 点刷新" } as const;
export const BTN_TEXT = { claim: "领取", claimed: "已领取", locked: "进行中" } as const;
export const CHEST_TEXT = {
  title: "全勤宝箱",
  daily: "今日任务全部完成可领",
  weekly: "本周任务全部完成可领",
  claimed: "宝箱已领取",
} as const;

// ---------- 包围盒 ----------

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;

export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}

/** 任务行 / 宝箱行:每行的整行包围盒(面板局部坐标) */
export function rowBoxes(n: number = ROWS): Box[] {
  const { h, gap, top: t } = ACT.row;
  return Array.from({ length: n }, (_, i) => box(ACT.colX, CONTENT_W, t - h / 2 - i * (h + gap), h));
}

/** tab 行:两格,左对齐贴 colX */
export function tabRow(): Box[] {
  const { w, h, gap, cy } = ACT.tab;
  return [box(ACT.colX, w, cy, h), box(ACT.colX + w + gap, w, cy, h)];
}

/** 标题行三格:tag/title 左锚贴 colX,hint 右缘钉在 ACT.hint.right(给 ✕ 让开命中区) */
export function headerBoxes(): { tag: Box; title: Box; hint: Box } {
  return {
    tag: box(ACT.tag.x, 300, ACT.tag.cy, 14),
    title: box(ACT.tag.x, 320, ACT.title.cy, 30),
    hint: box(ACT.hint.right - 260, 260, ACT.hint.cy, 14),
  };
}

/**
 * 任务行内部格子(以行盒为原点换算)。返回的是**面板局部**坐标,面板直接照摆:
 * title 左上 / bar+prog 左下 / reward 右上 / btn 右侧整高。
 */
export function questRowParts(r: Box): { title: Box; bar: Box; prog: Box; reward: Box; btn: Box } {
  const { bar, prog, reward, btn, row } = ACT;
  return {
    title: box(r.left + row.padX, 320, r.cy + 20, 22),
    bar: box(r.left + bar.x, bar.w, r.cy + bar.cy, bar.h),
    prog: box(r.left + prog.x, 96, r.cy + bar.cy, 18),
    reward: box(r.right - reward.right - 150, 150, r.cy + reward.cy, 16),
    btn: box(r.right - btn.right - btn.w, btn.w, r.cy, btn.h),
  };
}

/** 宝箱行内部格子:标题 + 副句 + 奖励 + 按钮(没有进度条) */
export function chestRowParts(r: Box): { title: Box; sub: Box; reward: Box; btn: Box } {
  const { reward, btn, row } = ACT;
  return {
    title: box(r.left + row.padX, 200, r.cy + 20, 22),
    sub: box(r.left + row.padX, 360, r.cy - 16, 16),
    reward: box(r.right - reward.right - 150, 150, r.cy + reward.cy, 16),
    btn: box(r.right - btn.right - btn.w, btn.w, r.cy, btn.h),
  };
}

// ---------- 判据(吃真文案,check 在 node 下跑) ----------

const EPS = 0.5;

function overlapX(a: Box, b: Box): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS;
}

/** 两个盒子是否压在一起(y 也相交才算真压字) */
export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && Math.min(top(a), top(b)) - Math.max(bottom(a), bottom(b)) > EPS;
}

/** 行内件必须整块缩在行框里:超出行缘(上下左右任一侧)就算溢出 */
function pairWith(r: Box, part: Box, name: string, out: string[]): void {
  const inside = part.left >= r.left - EPS && part.right <= r.right + EPS
    && top(part) <= top(r) + EPS && bottom(part) >= bottom(r) - EPS;
  if (!inside) out.push(`行内件 ${name} 溢出行框`);
}

/** 行内几何自洽:五个格子都在行框内、互不压字(对任务行与宝箱行都成立的那部分) */
function judgeRowInner(parts: Box[], names: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (boxesOverlap(parts[i], parts[j])) out.push(`行内 ${names[i]} 压住 ${names[j]}`);
    }
  }
  return out;
}

/**
 * 一行任务的全部判据:几何自洽 + 真文案量宽。
 * 进度读数按最宽摆拍(目标最大的那条),标题/奖励吃 config 真文案。
 */
export function judgeQuestRow(title: string, reward: string, progText: string): string[] {
  const out: string[] = [];
  const r = rowBoxes()[0];
  const p = questRowParts(r);
  const names = ["标题", "进度条", "进度读数", "奖励读数", "按钮"];
  for (const [b, nm] of [[p.title, names[0]], [p.bar, names[1]], [p.prog, names[2]], [p.reward, names[3]], [p.btn, names[4]]] as Array<[Box, string]>) {
    pairWith(r, b, nm, out);
  }
  out.push(...judgeRowInner([p.title, p.bar, p.prog, p.reward, p.btn], names));
  // 量宽:文字必须塞进格子(进度读数给最坏样本,按 clamp 宽度反而看不见溢出)
  if (textW(title, 15) > p.title.right - p.title.left) out.push(`标题放不下:${title}`);
  if (textW(reward, ACT.reward.size) > p.reward.right - p.reward.left) out.push(`奖励读数放不下:${reward}`);
  if (textW(progText, ACT.prog.size) > p.prog.right - p.prog.left) out.push(`进度读数放不下:${progText}`);
  if (textW(BTN_TEXT.claimed, ACT.btn.size) > p.btn.right - p.btn.left - 16) out.push("按钮文案放不下:已领取");
  return out;
}

/** 宝箱行判据:几何自洽 + 文案量宽(副句吃每日/每周两句最长的) */
export function judgeChestRow(sub: string): string[] {
  const out: string[] = [];
  const r = rowBoxes()[3];
  const p = chestRowParts(r);
  const names = ["标题", "副句", "奖励读数", "按钮"];
  for (const [b, nm] of [[p.title, names[0]], [p.sub, names[1]], [p.reward, names[2]], [p.btn, names[3]]] as Array<[Box, string]>) {
    pairWith(r, b, nm, out);
  }
  out.push(...judgeRowInner([p.title, p.sub, p.reward, p.btn], names));
  if (textW(CHEST_TEXT.title, 15) > p.title.right - p.title.left) out.push("宝箱标题放不下");
  if (textW(sub, 11) > p.sub.right - p.sub.left) out.push(`宝箱副句放不下:${sub}`);
  return out;
}

/** 骨架判据:行区/tab/标题互相不压、都在面板内 */
export function activityOverlaps(): string[] {
  const out: string[] = [];
  const rows = rowBoxes();
  const tabs = tabRow();
  // 标题(左)与刷新说明(右)不压字
  const H = headerBoxes();
  if (boxesOverlap(H.title, H.hint)) out.push("标题压住刷新说明");
  // 行区上缘不得顶进 tab 行(tab 高 = 触控下限,行区上缘由 ROW_TOP 钉住)
  const tabBottom = bottom(tabs[0]);
  for (const r of rows) if (top(r) > tabBottom) out.push("任务行顶进 tab 行");
  // 行间互不压
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (boxesOverlap(rows[i], rows[j])) out.push(`第 ${i} 行压住第 ${j} 行`);
    }
  }
  // 底行不得越出面板下缘
  const last = rows[rows.length - 1];
  if (bottom(last) < -ACT.ph / 2) out.push("宝箱行越出面板下缘");
  // tab 两格互不压
  if (boxesOverlap(tabs[0], tabs[1])) out.push("两格 tab 相互压字");
  return out;
}

/** 溢出判据:所有盒子都在内容列与面板内(tab 是小面大键,允许到内容列即止) */
export function activityOverflow(): string[] {
  const out: string[] = [];
  const all: Array<[Box, string]> = [
    ...rowBoxes().map((b): [Box, string] => [b, "任务行"]),
    ...tabRow().map((b, i): [Box, string] => [b, `tab${i}`]),
  ];
  for (const [b, nm] of all) {
    if (b.left < ACT.colX - EPS || b.right > ACT.right + EPS) out.push(`${nm} 越出内容列`);
    if (top(b) > ACT.ph / 2 - EPS || bottom(b) < -ACT.ph / 2 - EPS) out.push(`${nm} 越出面板上下缘`);
  }
  return out;
}
