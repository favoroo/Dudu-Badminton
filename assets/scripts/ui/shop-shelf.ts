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

/** 滚动条滑块中心(y 轴向上,轨道居中于 0):f=0 货架在顶,滑块**顶缘**贴轨道顶;
 *  f=1 货架在底,滑块**底缘**贴轨道底。
 *
 *  为什么要进纯函数:这行公式上一版手写在面板里(`trackH/2 - f*(trackH-thumbH)`),
 *  把滑块**中心**钉在了轨道顶 —— 滑块上半截永远戳出轨道,而轨道顶离网格窗顶只差
 *  BAR_PAD,那截黄色直接叠上 tab 条、甚至伸出面板外(用户截图里「飘在标签栏上的
 *  黄色长条」)。谁都会在「能滚 = 有滑块」的回归里漏掉位置,所以跟高度一起搬进来,
 *  由 shelf-check 断言:滑块全程落在轨道内、两端各自贴边。 */
export function thumbCenterY(trackH: number, thumbH: number, f: number): number {
  const travel = Math.max(0, trackH - thumbH);
  return travel / 2 - Math.max(0, Math.min(1, f)) * travel;
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

// ============================================================
// 商店整页几何(本轮 P5 改版新增)
//
// 为什么搬进来:上面那套 SHELF 只管**货架网格与滚动**,面板的顶栏 / 五 tab /
// 试衣间 / 履历格全写在 career-panel 里手拍。这轮把 tab 从 32 高抬到触控下限 44、
// 又给衬纸加了撕口与副衬,那些数一旦漂了不会崩、只会「tab 压住内容区第一行」这类
// 看不出来的错 —— 与 settings-layout / campaign-layout / drill-layout 同一个道理,
// 排版要能在 node 下断言。判据由 tools/panel-check.ts 跑。
//
// 零 cc:只有数字与字符串。
// ============================================================
import { TOUCH } from "./p5-tokens";

export const SHOP = {
  pw: 880, ph: 470,
  /** 面板中心下移量(衬纸画在 (0, panelY)) */
  panelY: -10,
  /** 内容可用左右缘:面板宽留 20 边距 */
  colX: -430, right: 430,
  /**
   * 顶栏 / tab 条 / 内容区是一条自上而下的栈,三个 cy 互相咬合:
   *   顶栏 44 高 → 178..222,面板上缘 225(= ph/2 + panelY),留 3 缝;
   *   tab 条 44 高 → 130..174,离顶栏底 4;
   *   内容区顶 = 122 → topPad = ph/2 - 122 = 113。
   * 旧值(207 / 159 / 98)是「只有 32 高 tab + 一行文字」时拍的,牌和键一抬到 44
   * 就双双顶出上缘 —— 这类数手拍一个改一个必漏,所以三个数写在一起并留这段推导。
   */
  topBar: { cy: 200, h: 44 },
  tabs: { cy: 152, h: TOUCH.min, n: 5, gap: 4 },
  content: { topPad: 113 },
  previewW: 320,
  action: { w: 260, h: TOUCH.min },
  stats: { cw: 268, ch: 120, gap: 16, cols: 3 },
} as const;

export interface SBox { left: number; right: number; cy: number; h: number }

export function sbox(left: number, w: number, cy: number, h: number): SBox {
  return { left, right: left + w, cy, h };
}

export const sTop = (b: SBox): number => b.cy + b.h / 2;
export const sBottom = (b: SBox): number => b.cy - b.h / 2;

/**
 * 顶栏五件:Lv 牌、等级名、经验槽、金币、关闭 —— **从左到右排一条轨道**。
 *
 * 为什么要改成算出来的:这五件原来是各拍一个 x(-390 / -310 / -130 / 304 / 400),
 * 给 Lv 加上 108 宽的斜切牌之后,牌的右缘(-336)直接盖进等级名的文本框(-360 起),
 * 而牌本身还戳出面板左缘 4px。旧写法没暴露它,是因为那位置只有一行 60 宽的字、
 * 刚好与等级名接上 —— 换形状不换算术就撞。现在一条轨道排完,加宽任何一件都自动顺延。
 */
export function shopTopBar(): { lv: SBox; lvName: SBox; exp: SBox; coins: SBox; close: SBox } {
  const y = SHOP.topBar.cy;
  const gap = 14;
  const closeW = 56, coinW = 130, expW = 200, lvW = 108, nameW = 96;
  // 等级信息从左边铺,货币与关闭从右边铺 —— 中间留白是有意的(旧版就是这个格局)
  const lvLeft = SHOP.colX + 10;
  const nameLeft = lvLeft + lvW + gap;
  const expLeft = nameLeft + nameW + 16;
  const closeLeft = SHOP.right - closeW;
  const coinLeft = closeLeft - gap - coinW;
  if (expLeft + expW > coinLeft) throw new Error("shopTopBar:经验槽与金币撞上,顶栏放不下");
  return {
    lv: sbox(lvLeft, lvW, y, 40),
    lvName: sbox(nameLeft, nameW, y, 18),
    exp: sbox(expLeft, expW, y, 14),
    coins: sbox(coinLeft, coinW, y, 20),
    close: sbox(closeLeft, closeW, y, TOUCH.min),
  };
}

/** 五 tab:整排等宽,居中于面板宽 */
export function shopTabs(): SBox[] {
  const tw = (SHOP.pw - 20) / SHOP.tabs.n;
  return Array.from({ length: SHOP.tabs.n }, (_, i) =>
    sbox(SHOP.colX + i * tw, tw - SHOP.tabs.gap, SHOP.tabs.cy, SHOP.tabs.h));
}

/** 内容区:左货架窗 + 右试衣间(试衣间含预览名与动作键) */
export function shopContent(gridH: number): { grid: SBox; preview: SBox; name: SBox; action: SBox } {
  const cy = SHOP.ph / 2 - SHOP.content.topPad - gridH / 2;
  const gw = SHELF.w;
  const grid = sbox(SHOP.colX + 5, gw, cy, gridH);
  const preview = sbox(SHOP.right - 5 - SHOP.previewW, SHOP.previewW, cy, gridH);
  return {
    grid, preview,
    name: sbox(preview.left + 10, SHOP.previewW - 20, cy - gridH / 2 + 87, 22),
    action: sbox(preview.left + (SHOP.previewW - SHOP.action.w) / 2, SHOP.action.w,
      cy - gridH / 2 + 35, SHOP.action.h),
  };
}

/** 履历页六格(占满面板宽,与货架窗互斥显示) */
export function shopStats(gridH: number): SBox[] {
  const cy = SHOP.ph / 2 - SHOP.content.topPad - gridH / 2;
  const { cw, ch, gap, cols } = SHOP.stats;
  const n = 6;
  const totalW = cols * cw + (cols - 1) * gap;
  const top = cy + gridH / 2 - 20;
  return Array.from({ length: n }, (_, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return sbox(-totalW / 2 + col * (cw + gap), cw, top - row * (ch + gap) - ch / 2, ch);
  });
}

const hit = (a: SBox, b: SBox): boolean =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && sBottom(a) < sTop(b) - 0.5 && sBottom(b) < sTop(a) - 0.5;

/** 顶栏四件、tab 五格、内容区三件各自不许压字 */
export function shopOverlaps(gridH = SHELF.h): string[] {
  const out: string[] = [];
  const T = shopTopBar();
  const topPairs: Array<[string, SBox, string, SBox]> = [
    ["Lv牌", T.lv, "等级名", T.lvName],
    ["等级名", T.lvName, "经验槽", T.exp],
    ["经验槽", T.exp, "金币", T.coins],
    ["金币", T.coins, "关闭", T.close],
  ];
  for (const [an, a, bn, b] of topPairs) if (hit(a, b)) out.push(`顶栏:${an} 压住 ${bn}`);

  const tabs = shopTabs();
  for (let i = 0; i < tabs.length; i++) {
    for (let j = i + 1; j < tabs.length; j++) if (hit(tabs[i], tabs[j])) out.push(`tab 第 ${i} 与第 ${j} 格重叠`);
  }
  // tab 条抬到 44 之后最容易撞的两处:上面的顶栏、下面的内容区。
  // (上一版这里写成 `sBottom(tabs) < sTop(T.lv)` 恒真,把「不重叠」判成了重叠 ——
  //  比较方向要的是「两条带咬在一起」,那就是 hit(),别手搓不等式。)
  const tabBar = sbox(tabs[0].left, tabs[tabs.length - 1].right - tabs[0].left, SHOP.tabs.cy, SHOP.tabs.h);
  for (const [nm, b] of Object.entries(T)) if (hit(tabBar, b)) out.push(`tab 条压住顶栏 ${nm}`);
  const K = shopContent(gridH);
  // 内容区往上顶到 tab 条底下才算撞:内容顶边 > tab 底边
  if (sTop(K.grid) > sBottom(tabs[0])) out.push("内容区顶到 tab 条底下");
  if (hit(K.preview, K.grid)) out.push("试衣间压住货架窗");
  if (hit(K.action, K.name)) out.push("动作键压住预览名");

  const st = shopStats(gridH);
  for (let i = 0; i < st.length; i++) {
    for (let j = i + 1; j < st.length; j++) if (hit(st[i], st[j])) out.push(`履历格 ${i} 与 ${j} 重叠`);
  }
  return out;
}

/** 每块都在面板框内(衬纸的撕口与副衬会外溢,那部分不算内容越界) */
export function shopOverflow(gridH = SHELF.h): string[] {
  const out: string[] = [];
  const half = SHOP.ph / 2 + SHOP.panelY;
  const all: Array<[string, SBox]> = [
    ...Object.entries(shopTopBar()).map(([k, v]) => [k, v] as [string, SBox]),
    ...shopTabs().map((b, i) => [`tab#${i}`, b] as [string, SBox]),
    ...Object.entries(shopContent(gridH)).map(([k, v]) => [k, v] as [string, SBox]),
    ...shopStats(gridH).map((b, i) => [`履历格#${i}`, b] as [string, SBox]),
  ];
  for (const [nm, b] of all) {
    if (b.left < SHOP.colX - 0.5) out.push(`${nm} 左缘 ${b.left.toFixed(1)} < ${SHOP.colX}`);
    if (b.right > SHOP.right + 0.5) out.push(`${nm} 右缘 ${b.right.toFixed(1)} > ${SHOP.right}`);
    if (sTop(b) > half) out.push(`${nm} 顶边 ${sTop(b).toFixed(1)} > ${half}`);
    if (sBottom(b) < -SHOP.ph / 2 - SHOP.panelY) out.push(`${nm} 底边越出面板`);
  }
  return out;
}

/** tab 与动作键的可点高度 */
export function shopTouch(gridH = SHELF.h): Array<[string, number]> {
  const K = shopContent(gridH);
  return [
    ...shopTabs().map((b, i) => [`tab#${i}`, b.h] as [string, number]),
    ["动作键", K.action.h],
  ];
}
