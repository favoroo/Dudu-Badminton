// ============================================================
// 商店货架的几何 —— 零 cc 依赖,所以能在 node 下回归(tools/shelf-check.ts)。
//
// 为什么要单独成文件:货架「装得下几行 / 能滚多远 / 滚到底末行落在哪」全是绝对坐标算出来的,
// 而上一版就是这么手调在面板里的:12 款角色皮肤按 4 列排是 3 行,网格窗只有 330 高(两行的量),
// 末行直接伸出面板底被屏幕下沿切掉 —— 用户看到的是「商店只能看 8 款,后面的滑不出来」。
// 现在行数、货架高、滚动上限、以及「某一行要滚到哪才完整可见」都由这里的纯函数给,
// career-panel 只负责照它摆节点、跑拖动与惯性;谁溢出由 shelf-check 断言,不靠肉眼挪像素。
//
// 依赖纪律:不 import cc —— 否则 node 下跑不了。
// ============================================================

/** 卡片与网格窗的尺寸(设计分辨率 960×540 下的 px)。改这里等于改商店排版,必跑 shelf-check */
export const SHELF = {
  cardW: 96, cardH: 130, gap: 8,
  w: 520, h: 330,
  padTop: 10, padBot: 10,
};
export type Shelf = typeof SHELF;

/** 列数:两行制(10→5、8→4),与老项目一致;上限 5 —— 6 列 96px 卡会顶破 520 网格宽 */
export function gridCols(n: number, s: Shelf = SHELF): number {
  return n % 5 === 0 ? 5 : n % 4 === 0 ? 4 : Math.min(n, 5);
}

export interface ShelfLayout {
  cols: number;
  rows: number;
  /** 整块货架要多高才装得下所有行 */
  contentH: number;
  /** 货架最多能往上推多少 px;0 = 一屏就装得下,不该出现滚动条 */
  maxScroll: number;
}

/** n 款商品铺成几列几行、货架多高、能滚多远 */
export function shelfLayout(n: number, s: Shelf = SHELF): ShelfLayout {
  const cols = Math.max(1, gridCols(n, s));
  const rows = Math.max(1, Math.ceil(n / cols));
  const contentH = s.padTop + rows * (s.cardH + s.gap) - s.gap + s.padBot;
  return { cols, rows, contentH, maxScroll: Math.max(0, contentH - s.h) };
}

/** 第 row 行顶缘在货架坐标系(content 中心为原点)里的 y */
export function rowTopY(row: number, s: Shelf = SHELF): number {
  return s.h / 2 - s.padTop - row * (s.cardH + s.gap);
}

/** 把第 row 行**完整**留在可视窗里所需的位移区间(min ≤ s ≤ max)。
 *  min > max = 这一行在任何滚动位置都露不全 —— 就是「滑到底也看不见末行」那种事故。 */
export function revealRange(row: number, maxScroll: number, s: Shelf = SHELF): { min: number; max: number } {
  const top = rowTopY(row, s);
  const bottom = top - s.cardH;
  // 位移 s 把内容整体上移:顶缘不越过窗顶 → s ≤ 窗顶 - top;底缘不低于窗底 → s ≥ -窗底 - bottom
  return {
    min: Math.max(0, -s.h / 2 - bottom),
    max: Math.min(maxScroll, Math.max(0, s.h / 2 - top)),
  };
}

/** 越界阻尼:窗内原样返回,窗外按 k 压缩(拉到顶还能再拖一截,松手由调用方弹回) */
export function rubberBand(y: number, maxScroll: number, k: number): number {
  if (y < 0) return y * k;
  if (y > maxScroll) return maxScroll + (y - maxScroll) * k;
  return y;
}

/** 滚动条滑块高度:按「窗 / 整块货架」的比例换算,再兜一个看得见、也捏得住的下限。
 *  maxScroll ≤ 0 时返回 0 —— 装得下就不该画出一根没有意义的轨道。 */
export function thumbHeight(trackH: number, h: number, maxScroll: number, min = 34): number {
  if (maxScroll <= 0) return 0;
  return Math.min(trackH, Math.max(min, trackH * h / (h + maxScroll)));
}

// ---------- 滚动运动学(松手之后那一段) ----------

/** 惯性衰减系数(≈1 秒收到 1.5%)与停止阈值 px/s */
export const FLING_DECAY = 4.2, FLING_MIN = 25;
/** 越界回弹与「把选中卡滚进视野」的指数逼近速率 */
export const EASE_RATE = 16;
/** 离目标这么近就算到了,免得永远在 0.5px 上抖 */
export const SETTLE_EPS = 0.6;

export interface ScrollMotion {
  /** 货架位移,静止区间 [0, maxScroll] */
  y: number;
  /** px/s,正 = 往上滚(后面的行进窗) */
  v: number;
  /** 非 null = 正在平滑滚向这个值(键盘选中定位用) */
  easeTo: number | null;
}

/** 推进一帧:定位 → 越界回弹 → 惯性 → 停下。就地改 m 并返回它(每帧都调,别造垃圾)。
 *
 * 三条不许破的底线,由 tools/shelf-check.ts 断言:
 *   任何初态在有限时间内收进 [0, maxScroll];中途不许 NaN;惯性段速度只减不增。
 */
export function advanceScroll(m: ScrollMotion, maxScroll: number, dt: number): ScrollMotion {
  let { y, v, easeTo } = m;
  if (easeTo !== null) {
    const d = easeTo - y;
    if (Math.abs(d) < SETTLE_EPS) { y = easeTo; easeTo = null; v = 0; }
    else y += d * Math.min(1, dt * EASE_RATE);
  } else if (y < 0 || y > maxScroll) {
    const t = Math.max(0, Math.min(maxScroll, y));
    const d = t - y;
    if (Math.abs(d) < SETTLE_EPS) { y = t; v = 0; }
    else y += d * Math.min(1, dt * EASE_RATE);
  } else if (Math.abs(v) > FLING_MIN) {
    y += v * dt;
    v *= Math.exp(-FLING_DECAY * dt);
    if (y <= 0) { y = 0; v = 0; }
    else if (y >= maxScroll) { y = maxScroll; v = 0; }
  } else {
    v = 0;
  }
  m.y = y; m.v = v; m.easeTo = easeTo;
  return m;
}
