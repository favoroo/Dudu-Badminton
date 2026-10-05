// ============================================================
// 二次确认弹窗版式 (Confirm Dialog Layout) —— 纯函数、零 cc 依赖
//
// 为什么要这一层:确认弹窗是「一句问话 + 两颗键」,看着没什么可算的,
// 而它恰恰是全站最容易「文案一长就把按钮顶出卡外」的那类排版 —— 因为
// 卡高是**跟着文案长**的(标题 / 正文 / 补充行 / 按钮行),写死一个高度
// 就等于赌「这句文案永远这么短」。上一代弹窗里那条「更新说明」就是靠
// brief-layout / release-notes 这套算术才不再撞标题的,同一个道理搬过来。
//
// 于是这里只做算术,不做绘制:
//   · 字宽与折行用全站同一把尺(core/text-metrics 的 textW / wrapText);
//   · 卡高 = 内边距 + 各行高 + 按钮行,**算出来的**,不是拍出来的;
//   · 输出的每一块自带 left / cy / h / w,面板只照单摆;
//   · 判据 confirmOverflow / confirmOverlaps 与面板吃同一份 layoutConfirm,
//     由 tools/panel-check.ts 在 node 下断言(含超长文案压力样本)。
//
// 文案为什么也住在这个文件:两颗「重置默认」(设置页 + 调整位置顶栏)必须问
// 同一句话,而 panel-check 要量的正是**面板真摆出去的那几句**。写在面板里
// 就等于闸门量的是另一套假文案。
//
// 依赖纪律:零 cc,只 import p5-tokens 与 core/text-metrics(与 settings-layout 同规格,
// 已挂进 tools/tsconfig.json 的 include)。
// ============================================================
import { textW, wrapText, type Measure } from "../core/text-metrics";
import { TOUCH } from "./p5-tokens";

export const CF = {
  /** 卡宽:比更新弹窗(480)窄一截 —— 确认只说一句话,不该长得像公告 */
  cardW: 440,
  padX: 28,
  padTop: 22,
  padBottom: 20,

  titleSize: 22, titleH: 32,
  bodySize: 14, bodyH: 21,
  hintSize: 11, hintH: 17,
  /** 标题 → 正文 */
  bodyLead: 12,
  /** 正文 → 补充行 */
  hintLead: 7,
  /** 正文/补充 → 按钮行 */
  btnLead: 20,

  /** 按钮:高度 = 触控下限,宽度跟着文案走,两颗成对居中 */
  btnH: TOUCH.min,
  btnSize: 15,
  btnMinW: 116,
  btnPadX: 24,
  btnGapX: 16,

  /**
   * 卡高红线:确认弹窗只该占屏幕中间一小块。
   * 超了说明有人往这里塞公告级文案(那该用更新弹窗那套带滚动井的),不是把红线调高。
   */
  maxCardH: 300,
} as const;

/** 一次确认要说的四段话(hint 可省 = 不占那一行) */
export interface ConfirmSpec {
  title: string;
  body: string;
  hint?: string;
  /** 左键:撤销这次动作,什么都不改 */
  cancel: string;
  /** 右键:兑现这次动作(整面实底红,色即「这一步会覆盖东西」) */
  action: string;
}

/**
 * 「重置默认」那一句 —— 设置页与「调整位置」顶栏两颗同名键共用一份。
 * 四条口径:① 说清**会被覆盖的是哪三样**(位置 / 大小 / 透明度),
 * ② 说清**撤销不了**(只能重新摆),否则人会以为设置页里还有一条返回,
 * ③ 说清**不受影响的是哪样**(移动方式),不然有人以为滑轨偏好也没了,
 * ④ 正文里那个换行是**排出来的**(wrapText 先按 \n 分段再折),不是随手敲的:
 *    两行各自都在可用宽内,panel-check 拿实测宽钉着 —— 拆句拆在标点后面,
 *    不拆在词中间(自动折行会,所以原来那句被切成「这一 / 套就没了」)。
 */
export const CONFIRM_PAD_RESET: ConfirmSpec = {
  title: "重置为默认布局？",
  body: "你摆过的按键位置、大小与透明度会被出厂值全部覆盖。\n撤销不了,只能一颗一颗重新摆。",
  hint: "移动方式(摇杆 / 滑轨 / 按键)不受影响。",
  cancel: "取消",
  action: "重置",
};

export type ConfirmRole = "title" | "body" | "hint";

/** 一个文本块:lines 已折好,渲染层用 "\n" 拼接直接画 */
export interface ConfirmItem {
  key: ConfirmRole;
  lines: string[];
  size: number;
  /** 引擎 Label.lineHeight 就设这个值 —— 行高由排版说了算,两边不会算歪 */
  lineH: number;
  /** 块高 = lines × lineH */
  h: number;
  /** 最宽一条物理行的实测宽 */
  w: number;
  /** 文本左缘(卡片中心为原点);三块都居中排,所以 left = -w/2 */
  left: number;
  /** 块垂直中心 */
  cy: number;
}

export interface ConfirmButton {
  key: "cancel" | "action";
  text: string;
  size: number;
  w: number;
  h: number;
  /** 中心 x / y(卡片中心为原点) */
  cx: number;
  cy: number;
}

export interface ConfirmLayout {
  cardW: number;
  cardH: number;
  /** 文案可用宽 = cardW - 2*padX */
  availW: number;
  items: ConfirmItem[];
  buttons: ConfirmButton[];
}

/** 一颗按钮的宽:文案实测 + 左右内边距,但不许窄于触控友好下限 */
export function confirmBtnW(text: string, measure: Measure = textW): number {
  return Math.max(CF.btnMinW, measure(text, CF.btnSize) + CF.btnPadX * 2);
}

/**
 * 文案 → 弹窗排版。
 * 自上而下堆块(局部 0 = 内容顶,向下为正),堆完才知道要多高的框 ——
 * 所以「不溢出、不重叠」是排版性质,不是对某一句文案的假设。
 */
export function layoutConfirm(spec: ConfirmSpec, measure: Measure = textW): ConfirmLayout {
  const avail = CF.cardW - CF.padX * 2;

  interface Slot { key: ConfirmRole; lines: string[]; size: number; lineH: number; top: number; w: number }
  const slots: Slot[] = [];
  let cur = 0;

  const block = (key: ConfirmRole, lines: string[], size: number, lineH: number, lead: number): void => {
    const arr = lines.length ? lines : [""];
    cur += lead;
    const w = arr.reduce((m, l) => Math.max(m, measure(l, size)), 0);
    slots.push({ key, lines: arr, size, lineH, top: cur, w });
    cur += arr.length * lineH;
  };

  block("title", [spec.title], CF.titleSize, CF.titleH, 0);
  block("body", wrapText(spec.body, CF.bodySize, avail, measure), CF.bodySize, CF.bodyH, CF.bodyLead);
  if (spec.hint) block("hint", wrapText(spec.hint, CF.hintSize, avail, measure), CF.hintSize, CF.hintH, CF.hintLead);

  const contentH = cur;
  const cardH = CF.padTop + contentH + CF.btnLead + CF.btnH + CF.padBottom;
  const top0 = cardH / 2 - CF.padTop;

  const items: ConfirmItem[] = slots.map((s) => {
    const h = s.lines.length * s.lineH;
    return {
      key: s.key, lines: s.lines, size: s.size, lineH: s.lineH, h, w: s.w,
      left: -s.w / 2, cy: top0 - (s.top + h / 2),
    };
  });

  // 两颗键成对居中:左「取消」右「兑现」。与战前简报同一排法(返回在左、开打在右),
  // 宽度按各自文案实测 —— 等宽会让「取消」这种两字词空出一半。
  const cancelW = confirmBtnW(spec.cancel, measure);
  const actionW = confirmBtnW(spec.action, measure);
  const total = cancelW + CF.btnGapX + actionW;
  const by = -cardH / 2 + CF.padBottom + CF.btnH / 2;
  const buttons: ConfirmButton[] = [
    { key: "cancel", text: spec.cancel, size: CF.btnSize, w: cancelW, h: CF.btnH, cx: -total / 2 + cancelW / 2, cy: by },
    { key: "action", text: spec.action, size: CF.btnSize, w: actionW, h: CF.btnH, cx: total / 2 - actionW / 2, cy: by },
  ];

  return { cardW: CF.cardW, cardH, availW: avail, items, buttons };
}

// ---------- 判据(回归用) ----------

const EPS = 0.5;

/** 溢出:任何一行比可用宽还长,或块探出卡片的内边距 / 卡高越过红线 */
export function confirmOverflow(L: ConfirmLayout, measure: Measure = textW): string[] {
  const bad: string[] = [];
  if (L.cardH > CF.maxCardH + EPS) bad.push(`卡高 ${L.cardH.toFixed(1)} > 红线 ${CF.maxCardH}(确认弹窗不该长成公告)`);
  for (const it of L.items) {
    for (const l of it.lines) {
      const w = measure(l, it.size);
      if (w > L.availW + EPS) bad.push(`${it.key}:行实测宽 ${w} > 可用 ${L.availW} →「${l}」`);
    }
    if (it.left < -L.cardW / 2 - EPS) bad.push(`${it.key}:左缘 ${it.left.toFixed(1)} 出卡片`);
    if (it.left + it.w > L.cardW / 2 + EPS) bad.push(`${it.key}:右缘 ${(it.left + it.w).toFixed(1)} 出卡片`);
    if (it.cy + it.h / 2 > L.cardH / 2 - CF.padTop + EPS) bad.push(`${it.key}:探出卡片上内边距`);
    if (it.cy - it.h / 2 < -L.cardH / 2 + CF.padBottom + CF.btnH + CF.btnLead - EPS) {
      bad.push(`${it.key}:压到按钮行了`);
    }
  }
  for (const b of L.buttons) {
    if (b.h < TOUCH.min) bad.push(`btn:${b.key}:高 ${b.h} < 触控下限 ${TOUCH.min}`);
    if (b.cx - b.w / 2 < -L.cardW / 2 + CF.padX - EPS) bad.push(`btn:${b.key}:出左内边距`);
    if (b.cx + b.w / 2 > L.cardW / 2 - CF.padX + EPS) bad.push(`btn:${b.key}:出右内边距`);
    if (b.cy - b.h / 2 < -L.cardH / 2 + CF.padBottom - EPS) bad.push(`btn:${b.key}:贴到卡片下缘了`);
  }
  return bad;
}

/** 压字:任意两块(含按钮)的包围盒相交 */
export function confirmOverlaps(L: ConfirmLayout): string[] {
  const box = (key: string, l: number, w: number, cy: number, h: number) =>
    ({ key, l, r: l + w, b: cy - h / 2, t: cy + h / 2 });
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
