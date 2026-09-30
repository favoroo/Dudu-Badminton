// ============================================================
// 战前简报弹窗排版 (Stage Briefing Layout) —— 纯函数、零 cc 依赖
//
// 为什么要单独一个文件:弹窗里每一块文案都来自 core/campaign.ts 的 20 张关卡表,
// 长度天差地别 —— 情境说明最短 30 字、最长 47 字,三条三星目标里最短的 4 字、最长的
// 14 字(宽 3 倍)。手调绝对坐标 + Label 默认不换行,结果就是用户拍的那张现场图:
// 说明整行糊到弹窗左边框外面、三条三星目标互相重叠、目标与奖励撞成一排。
//
// 所以这里把「折行 → 逐块往下堆 → 弹窗按内容长高」全做成算术:
//   · 字宽与折行用全站同一把尺(text-metrics 的 textW / wrapText),不另起一份;
//   · 输出的每一块自带 left / cy / lines / lineH,渲染层只管照摆,不再量、不再折;
//   · 弹窗高度 = 内容高度 + 按钮行 + 内边距,**内容长多少框就多大**,所以
//     「不溢出、不重叠」是排版性质,不是对某一句文案的假设。
// 20 关全表在 node 下回归:tools/brief-check.ts。
// ============================================================
import { textW, wrapText, type Measure } from "./text-metrics";

/**
 * 排版常量 —— 字号、行高、块间距、内边距都从这里出,
 * 弹窗(campaign-panel)与回归(brief-check)共用同一份,不会各算各的算歪。
 */
export const BRIEF = {
  /** 弹窗宽:比大厅面板(880)窄一截,两侧留得下面板边框 */
  dialogW: 620,
  /** 内容块封顶高:超过它会顶穿大厅面板(PH=480),brief-check 拿它当红线 */
  maxDialogH: 462,
  /** 短关卡也不至于缩成一条 */
  minDialogH: 330,
  /** 左右内边距:框缘 → 文本左缘 */
  padX: 32,
  padTop: 20,
  padBottom: 18,

  titleSize: 24, titleH: 34,
  badgeSize: 13, badgeH: 19, badgeLead: 3,
  headSize: 13, headH: 21, headLead: 15,
  bodySize: 13, bodyH: 19, bodyLead: 2,
  metaSize: 13, metaH: 21, metaLead: 15, rewardLead: 1,
  chipSize: 11, chipH: 18, chipGap: 16,

  btnSize: 15, btnH: 46, btnPadX: 22, btnGapX: 24, btnMinW: 110,
  /** 内容底 → 按钮顶 */
  btnGap: 20,
} as const;

/** 三块小标题:文案写死在这儿,免得弹窗里一份、回归里一份 */
export const BRIEF_HEADS = {
  desc: "⚠️ 战场异变与挑战：",
  hint: "💡 胜战秘籍：",
  star: "★ 三星挑战：",
} as const;

export const BRIEF_BTN = { cancel: "返回", start: "立即开战 ★" } as const;

/** 排版只用到 StageDef 的这几个字段(投影成接口,单测可以手搓一个假关卡) */
export interface BriefStage {
  title: string;
  badge: string;
  subtitle: string;
  desc: string;
  hint: string;
  targetScore: number;
  deathmatch?: boolean;
  rewards: { coins: number; exp: number };
  starsGoal: readonly string[];
}

export type BriefRole = "title" | "badge" | "head" | "body" | "meta" | "chip";

/** 一个文本块:lines 已折好,渲染层用 "\n" 拼接直接画 */
export interface BriefItem {
  key: string;
  role: BriefRole;
  lines: string[];
  size: number;
  /** 引擎 Label.lineHeight 就设这个值 —— 行高由排版说了算,两边不会算歪 */
  lineH: number;
  /** 块高 = lines × lineH */
  h: number;
  /** 最宽一条物理行的实测宽 */
  w: number;
  /** 文本左缘(弹窗中心为原点) */
  left: number;
  /** 块垂直中心 */
  cy: number;
}

export interface BriefButton {
  key: "cancel" | "start";
  text: string;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface BriefLayout {
  items: BriefItem[];
  buttons: BriefButton[];
  dialogW: number;
  dialogH: number;
  /** 文案可用宽 = dialogW - 2*padX */
  availW: number;
}

// ---------- 文案 ----------

export function briefBadgeText(s: BriefStage): string {
  return `【 ${s.badge} · ${s.subtitle} 】`;
}

export function briefTargetText(s: BriefStage): string {
  return s.deathmatch
    ? "🎯 获胜目标：一球生死决胜（丢1分即败，需净胜2分夺冠）"
    : `🎯 获胜目标：抢先赢得 ${s.targetScore} 分`;
}

export function briefRewardText(s: BriefStage): string {
  return `💰 胜利奖励：+${s.rewards.coins} 金币 · +${s.rewards.exp} 经验`;
}

// ---------- 排版 ----------

/** 居中对齐的角色(标题与特色徽章) */
function isCenter(role: BriefRole): boolean {
  return role === "title" || role === "badge";
}

/** 底部按钮:宽度跟着文案走,整对居中 */
export function briefButtons(measure: Measure, cy: number): BriefButton[] {
  const mk = (key: "cancel" | "start", text: string): BriefButton =>
    ({ key, text, w: Math.max(BRIEF.btnMinW, measure(text, BRIEF.btnSize) + BRIEF.btnPadX * 2), h: BRIEF.btnH, cx: 0, cy });
  const cancel = mk("cancel", BRIEF_BTN.cancel);
  const start = mk("start", BRIEF_BTN.start);
  const total = cancel.w + BRIEF.btnGapX + start.w;
  cancel.cx = -total / 2 + cancel.w / 2;
  start.cx = total / 2 - start.w / 2;
  return [cancel, start];
}

/**
 * 关卡 → 弹窗排版。
 * 自上而下堆块(局部坐标 0 = 内容顶,向下为正),堆完才知道要多高的框 ——
 * 所以 dialogH 是**算出来的**,不是写死的;每一块的 cy 再由框高折算回弹窗坐标。
 */
export function layoutBrief(stage: BriefStage, measure: Measure = textW): BriefLayout {
  const avail = BRIEF.dialogW - BRIEF.padX * 2;
  const left0 = -avail / 2;

  interface Slot { key: string; role: BriefRole; lines: string[]; size: number; lineH: number; top: number; w: number; left: number }
  const slots: Slot[] = [];
  let cur = 0;

  /** 堆一块:lead 是与上一块的间距(不是行距) */
  const block = (key: string, role: BriefRole, lines: string[], size: number, lineH: number, lead: number, left = left0): void => {
    const arr = lines.length ? lines : [""];
    cur += lead;
    const w = arr.reduce((m, l) => Math.max(m, measure(l, size)), 0);
    slots.push({ key, role, lines: arr, size, lineH, top: cur, w, left });
    cur += arr.length * lineH;
  };

  block("title", "title", [stage.title], BRIEF.titleSize, BRIEF.titleH, 0);
  block("badge", "badge", [briefBadgeText(stage)], BRIEF.badgeSize, BRIEF.badgeH, BRIEF.badgeLead);

  block("descHead", "head", [BRIEF_HEADS.desc], BRIEF.headSize, BRIEF.headH, BRIEF.headLead);
  block("desc", "body", wrapText(stage.desc, BRIEF.bodySize, avail, measure), BRIEF.bodySize, BRIEF.bodyH, BRIEF.bodyLead);

  block("hintHead", "head", [BRIEF_HEADS.hint], BRIEF.headSize, BRIEF.headH, BRIEF.headLead);
  block("hint", "body", wrapText(stage.hint, BRIEF.bodySize, avail, measure), BRIEF.bodySize, BRIEF.bodyH, BRIEF.bodyLead);

  block("target", "meta", wrapText(briefTargetText(stage), BRIEF.metaSize, avail, measure), BRIEF.metaSize, BRIEF.metaH, BRIEF.metaLead);
  block("reward", "meta", wrapText(briefRewardText(stage), BRIEF.metaSize, avail, measure), BRIEF.metaSize, BRIEF.metaH, BRIEF.rewardLead);

  block("starHead", "head", [BRIEF_HEADS.star], BRIEF.headSize, BRIEF.headH, BRIEF.headLead);

  // 三星目标:横向流式排,一行放不下自己换行 —— 三条长度差 3 倍,定宽列必撞。
  // 标签"★ 三星挑战："占掉第一行的起头,胶囊从它右边接着排。
  {
    const head = slots[slots.length - 1];
    let rowTop = head.top;
    let x = head.left + head.w + BRIEF.chipGap;
    const rowRight = -left0;
    (stage.starsGoal ?? []).forEach((goal, i) => {
      const text = `★ ${goal}`;
      const w = measure(text, BRIEF.chipSize);
      if (x > left0 && x + w > rowRight) {          // 换行(至少排得下一个,否则永远不换)
        rowTop += BRIEF.chipH;
        x = left0;
      }
      slots.push({ key: `chip${i}`, role: "chip", lines: [text], size: BRIEF.chipSize, lineH: BRIEF.chipH, top: rowTop, w, left: x });
      x += w + BRIEF.chipGap;
    });
    cur = rowTop + BRIEF.chipH;
  }

  const contentH = cur;
  const dialogH = Math.max(BRIEF.minDialogH, BRIEF.padTop + contentH + BRIEF.btnGap + BRIEF.btnH + BRIEF.padBottom);
  const top0 = dialogH / 2 - BRIEF.padTop;          // 内容顶在弹窗坐标里的 y

  const items: BriefItem[] = slots.map((s) => {
    const h = s.lines.length * s.lineH;
    return {
      key: s.key, role: s.role, lines: s.lines, size: s.size, lineH: s.lineH, h, w: s.w,
      left: isCenter(s.role) ? -s.w / 2 : s.left,
      cy: top0 - (s.top + h / 2),
    };
  });
  const buttons = briefButtons(measure, -dialogH / 2 + BRIEF.padBottom + BRIEF.btnH / 2);

  return { items, buttons, dialogW: BRIEF.dialogW, dialogH, availW: avail };
}

// ---------- 判据(回归用) ----------

const EPS = 0.5;

/** 溢出:任何一行比可用宽还长,或块探出了弹窗内边距 */
export function briefOverflow(L: BriefLayout, measure: Measure = textW): string[] {
  const bad: string[] = [];
  for (const it of L.items) {
    for (const l of it.lines) {
      const w = measure(l, it.size);
      if (w > L.availW + EPS) bad.push(`${it.key}:行实测宽 ${w} > 可用 ${L.availW} →「${l}」`);
    }
    if (it.left < -L.dialogW / 2 - EPS) bad.push(`${it.key}:左缘 ${it.left} 出弹窗(${(-L.dialogW / 2).toFixed(0)})`);
    if (it.left + it.w > L.dialogW / 2 + EPS) bad.push(`${it.key}:右缘 ${(it.left + it.w).toFixed(1)} 出弹窗(${(L.dialogW / 2).toFixed(0)})`);
    if (it.cy + it.h / 2 > L.dialogH / 2 + EPS) bad.push(`${it.key}:探出弹窗上缘`);
    if (it.cy - it.h / 2 < -L.dialogH / 2 - EPS) bad.push(`${it.key}:探出弹窗下缘`);
  }
  for (const b of L.buttons) {
    if (b.cx - b.w / 2 < -L.availW / 2 - EPS) bad.push(`btn:${b.key}:出左内边距`);
    if (b.cx + b.w / 2 > L.availW / 2 + EPS) bad.push(`btn:${b.key}:出右内边距`);
    if (b.cy - b.h / 2 < -L.dialogH / 2 + BRIEF.padBottom - EPS) bad.push(`btn:${b.key}:贴到弹窗下缘了`);
  }
  return bad;
}

/** 压字:任意两个块(含按钮)的包围盒相交 */
export function briefOverlaps(L: BriefLayout): string[] {
  const box = (key: string, l: number, w: number, cy: number, h: number) => ({ key, l, r: l + w, b: cy - h / 2, t: cy + h / 2 });
  const all = [
    ...L.items.map((i) => box(i.key, i.left, i.w, i.cy, i.h)),
    ...L.buttons.map((b) => box(`btn:${b.key}`, b.cx - b.w / 2, b.w, b.cy, b.h)),
  ];
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i], B = all[j];
      const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
      const oy = Math.min(A.t, B.t) - Math.max(A.b, B.b);
      if (ox > EPS && oy > EPS) out.push(`${A.key} × ${B.key}(横向压 ${ox.toFixed(1)} / 纵向压 ${oy.toFixed(1)})`);
    }
  }
  return out;
}
