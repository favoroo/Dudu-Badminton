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
import { inkFor, ROLE, SLANT, TOUCH } from "./p5-tokens";
import type { Role } from "./p5-tokens";
import { chipHeight, chipWidth, skewOf, slantEdgeX } from "./p5-shapes";
import { textW, wrapText, ellipsize } from "../core/text-metrics";
// 只取类型:履历格的内容函数要吃什么数据,不该把 core/career 的运行时代码拖进排版层
import type { Profile } from "../core/career";
// 里程碑口径单一出口(core/milestone):statCells 的胜率与「下一档」副行都吃它,不许另算一份
import { MILESTONE_STATS, statValue, type MilestoneStat, type MilestoneView } from "../core/milestone";

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
  /**
   * 履历页六格。ch 从 120 抬到 136 是因为新版一行要装三件事(色签标题行 / 大数 / 副行),
   * 而 120 高时副行会顶到卡的斜下缘。两行 + 缝 = 288,内容区 330 高上下各剩 21/22,
   * 由 shopOverflow 兜住不出面板。
   */
  stats: { cw: 268, ch: 136, gap: 16, cols: 3 },
} as const;

export interface SBox { left: number; right: number; cy: number; h: number }

export function sbox(left: number, w: number, cy: number, h: number): SBox {
  return { left, right: left + w, cy, h };
}

export const sTop = (b: SBox): number => b.cy + b.h / 2;
export const sBottom = (b: SBox): number => b.cy - b.h / 2;

/**
 * 顶栏六件:Lv 牌、等级块(两行:等级名 + 经验数字 / 经验条)、金币、关闭
 * —— **从左到右排一条轨道**。
 *
 * 为什么要改成算出来的:这五件原来是各拍一个 x(-390 / -310 / -130 / 304 / 400),
 * 给 Lv 加上 108 宽的斜切牌之后,牌的右缘(-336)直接盖进等级名的文本框(-360 起),
 * 而牌本身还戳出面板左缘 4px。旧写法没暴露它,是因为那位置只有一行 60 宽的字、
 * 刚好与等级名接上 —— 换形状不换算术就撞。现在一条轨道排完,加宽任何一件都自动顺延。
 *
 * 为什么等级块要**两行**:旧版是「等级名 ∥ 经验条」并排一行、「77 / 215 EXP」单独
 * 悬在条子底下 —— 条子和它的读数隔着一整行,读出来是两块互不相干的板(用户截图里
 * 「这个条形底板不太对」)。现在等级名与 EXP 数字同占一行(一左一右),条子铺在它们
 * 正下方、与整块同宽:数字是这条槽的读数,一眼就配对。
 */
export function shopTopBar(): { lv: SBox; lvName: SBox; expNum: SBox; exp: SBox; coins: SBox; close: SBox } {
  const y = SHOP.topBar.cy;
  const gap = 14;
  const closeW = 56, coinW = 130, lvW = 108;
  const blockW = 330;                       // 等级块:上行 等级名 | EXP 读数,下行 同宽经验条
  const nameW = blockW - 112;               // 右边让给 "77 / 215 EXP"(11px 约 78 宽)
  // 等级信息从左边铺,货币与关闭从右边铺 —— 中间留白是有意的(旧版就是这个格局)
  const lvLeft = SHOP.colX + 10;
  const blockLeft = lvLeft + lvW + gap;
  const closeLeft = SHOP.right - closeW;
  const coinLeft = closeLeft - gap - coinW;
  if (blockLeft + blockW > coinLeft) throw new Error("shopTopBar:经验槽与金币撞上,顶栏放不下");
  return {
    lv: sbox(lvLeft, lvW, y, 40),
    lvName: sbox(blockLeft, nameW, y + 10, 16),
    expNum: sbox(blockLeft + nameW, blockW - nameW, y + 10, 16),
    exp: sbox(blockLeft, blockW, y - 10, 12),
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

// ============================================================
// 穿戴槽子页签(配饰 tab 专用,2026-10-06 拆件重构)
//
// 为什么是「窗顶钉住的槽位 chip」而不是把它们提成顶栏 tab:12 个槽会把每格压到
// 半张卡宽,标签放不下;而一行摆 12 颗 chip 只剩 ~43px,加上佩戴色点就挤成一团。
// 所以固定**两行**(本体 / 配件,分组读 config.COSMO_SLOTS[].row)—— 不用横向滚动,
// 因为滚动会把槽位藏起来,而"看不见的控件"在这个面板里一律算 bug。
// 两行都钉在网格窗顶部、**不随滚动**;窗本身按 accBandH 整段变矮让出这条带(见 accShelf)
// —— 让位必须发生在裁切上,抬 padTop 只管静止那一格,一滚就穿帮。
// 滚动上限/末行露出全走 shelfLayout 既有算术,不在面板里手调。
// chip 高吃满 TOUCH.min:它是「选哪个槽位的货架」的触控件,不是标签。
// ============================================================

/** 子页签行高(chip 吃满触控下限)+ 与首行卡片的缝 + 两行之间的缝 */
export const ACC_SLOT_H = TOUCH.min;
export const ACC_SLOT_GAP = 6;
export const ACC_SLOT_ROW_GAP = 4;

/** 槽位 chip 占几行:由 COSMO_SLOTS 的 row 字段分组算出来,不在面板里手调。
 *  拆件重构把 4 槽扩到 12 槽后一行放不下(520px 宽 ÷ 12 ≈ 43px,标签 + 佩戴色点会挤成一团),
 *  而横向滚动会把槽位藏起来 —— 「看不见的控件就是 bug」。所以固定两行:本体 / 配件。 */
export function accSlotRowCounts(rows: number[]): number[] {
  const out: number[] = [];
  for (const r of rows) out[r] = (out[r] ?? 0) + 1;
  return out.map((n) => n || 0);
}

/** 子页签带总高:rowCount 行 chip + 行缝 + 与首行卡片的那条缝。
 *  chip 的落位与货架的让位都从这一个式子算,两边不可能漂成两套。 */
export function accBandH(rowCount = 1): number {
  return rowCount * ACC_SLOT_H + (rowCount - 1) * ACC_SLOT_ROW_GAP + ACC_SLOT_GAP;
}

/** 形象页的货架:**可视窗整块变矮**让出子页签带(窗底不动、顶边落到 chip 之下)。
 *
 *  旧写法是抬 padTop,那是错的:padTop 只管得住「静止时第一行不压 chip」,
 *  手指一滑,整排卡片就从半透明的 chip 背后穿出去(用户 2026-10-07 现场图:
 *  「肤色/上衣」那两行下面全是别人的商品名、价格与卖点小字)。
 *  chip 既然是钉住不随滚动的,让位就必须发生在**裁切**上 —— 让不进窗口的东西,
 *  才是真的不让它出现在那一条带里。 */
export function accShelf(rowCount = 1): Shelf {
  return { ...SHELF, h: SHELF.h - accBandH(rowCount) };
}

/** 槽位 chip:counts[r] = 第 r 行几颗,自上而下排;返回**展平**后的盒,顺序与槽位表一致。
 *  等分货架窗宽、钉在网格窗顶部(y 向上,第一行顶 = 窗顶)。
 *  右缘留一条滚动条走廊:滚动条贴窗右缘内侧(BAR_X = w/2−7),某槽商品多到能滚时
 *  滑块会常驻那一条 —— chip 全宽铺就会与它相撞,走廊提前让位(与是否在滚无关,
 *  chip 宽度不该随滚动状态变)。 */
export function accSlotRows(grid: SBox, counts: number[]): SBox[] {
  const gap = 4;
  const corridor = 14;
  const out: SBox[] = [];
  counts.forEach((n, r) => {
    const tw = (grid.right - grid.left - corridor) / n;
    const cy = grid.cy + grid.h / 2 - ACC_SLOT_H / 2
      - r * (ACC_SLOT_H + ACC_SLOT_ROW_GAP);
    for (let i = 0; i < n; i++) out.push(sbox(grid.left + i * tw, tw - gap, cy, ACC_SLOT_H));
  });
  return out;
}

/** 单行版:一行 n 颗(旧调用点与出图工具仍走这条) */
export function accSlotRow(grid: SBox, n = 4): SBox[] {
  return accSlotRows(grid, [n]);
}

/** 子页签判据:chip 两两不压、都不越出货架窗、高度够触控;
 *  外加**这条带必须整段在裁切窗之外** —— shelf 传进来的是「卡片能滑到的那块窗」,
 *  默认取 accShelf(行数)。把让位退回成抬 padTop,这条会当场咬住(见 selftest 反例)。 */
export function accSlotOverlaps(grid: SBox, counts: number[] = [4], shelf: Shelf = accShelf(counts.length)): string[] {
  const out: string[] = [];
  const chips = accSlotRows(grid, counts);
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      if (hit(chips[i], chips[j])) out.push(`槽位 chip ${i} 压住 ${j}`);
    }
    if (chips[i].left < grid.left - 0.5 || chips[i].right > grid.right + 0.5) {
      out.push(`槽位 chip ${i} 越出货架窗`);
    }
    if (chips[i].h < TOUCH.min) out.push(`槽位 chip ${i} 触控高度不足`);
  }
  const bandBottom = Math.min(...chips.map(sBottom));
  // 让位是**底对齐**的:窗变矮之后中心往下掉 (grid.h − shelf.h)/2,窗顶才落到 chip 之下。
  // 直接拿 grid.cy + shelf.h/2 会把窗顶算高半条带 —— 于是正例反例一起红。
  const winTop = grid.cy + shelf.h / 2 - (grid.h - shelf.h) / 2;
  if (winTop > bandBottom + 0.5) {
    out.push(`裁切窗顶 ${winTop.toFixed(1)} 高过子页签带底缘 ${bandBottom.toFixed(1)} —— 卡片一滚就穿到 chip 背后`);
  }
  return out;
}

// ============================================================
// 卡片上的三行字 —— 名称 / 状态 / 卖点小字
//
// 为什么把「这行字有多长」搬进排版:Label 默认 Overflow.NONE,给它 w 只是给
// 了个它自己不会遵守的盒子。卖点那一行吃的是 config 里的 desc(最长的一句 15 字、
// 9 号字约 153px,而一张卡只有 96px 宽),于是五张卡的小字在货架上连成一句
// 读不通的话(用户 2026-10-07:「这里显示都溢出了」)。
// 折行/截尾都是纯算术,所以和 statCardFits 同一族:版式住这里,panel-check 拿
// **config 真文案**断言,面板只管摆它算出来的行。
// ============================================================

export const CARD_TEXT = {
  nameSize: 12, statusSize: 12, fxSize: 9,
  /** 三行的行心(卡局部坐标,y 向上,以卡心为轴)。面板照这里摆,判据照这里量。 */
  nameY: -8, statusY: -28,
  /** 左右各留这么多。5px 不是随手拍的:卡片是 5° 斜切块,越往下整行越往右移,
   *  以卡心为轴居中的文字在最深那一行(-55)每侧只剩 (96−86)/2 = 5px —— 再窄就骑边。 */
  padX: 5,
  /** 卖点最多两行,再多就吃掉卡的墨面;两行装不下就截尾 */
  fxLines: 2, fxLineH: 10,
  /** 第一行卖点的行心;第二行往下一个 fxLineH */
  fxY: -45,
} as const;

/** 一行字在卡里能用多宽 */
export const cardInnerW = (): number => SHELF.cardW - CARD_TEXT.padX * 2;

/** 单行件(名称 / 状态):装不下就截尾,不许画到邻卡上 */
export function cardLine(text: string, size: number): string {
  return ellipsize(text, size, cardInnerW());
}

/** 卖点排成几行、有没有被砍掉一截。面板摆的(cardFxLines)与判据量的(cardTextFits)同源。
 *
 *  两条排法,先试前者:
 *  ① 按「·」分段 —— 全站 desc 的写法就是「A · B」两截,按它断行读起来是一句话分成两行;
 *  ② 兜底按字宽贪心折行 —— 纯按宽度断会断出「队服原色 · 人人有 / 份」这种半截词。
 *  两条都装不下才截尾(省略号算进宽度)。 */
function fitCardFx(text: string): { lines: string[]; cut: boolean } {
  if (!text) return { lines: [], cut: false };
  const w = cardInnerW(), size = CARD_TEXT.fxSize;
  const segs = text.split("·").map((s) => s.trim()).filter(Boolean);
  const rows = segs.length > 1 && segs.length <= CARD_TEXT.fxLines && segs.every((s) => textW(s, size) <= w)
    ? segs
    : wrapText(text, size, w);
  if (rows.length <= CARD_TEXT.fxLines) return { lines: rows, cut: false };
  return {
    lines: [...rows.slice(0, CARD_TEXT.fxLines - 1),
      ellipsize(`${rows[CARD_TEXT.fxLines - 1]}…`, size, w)],
    cut: true,
  };
}

/** 卖点小字最终摆出去的那 0~2 行(永远不溢出卡宽 —— 装不下就截尾兜着) */
export function cardFxLines(text: string): string[] {
  return fitCardFx(text).lines;
}

/** 卖点那一摞的各行行心(与 cardFxLines 一一对应;末行不许低于卡底) */
export function cardFxYs(n: number): number[] {
  return Array.from({ length: n }, (_, i) => CARD_TEXT.fxY - i * CARD_TEXT.fxLineH);
}

/** 卡上三行字的判据。量的都是**config 原文**,不是截尾之后的样子 ——
 *  面板那侧 cardLine/cardFxLines 是兜底(永远不许溢出),这条判据管的是另一件事:
 *  **现役文案本来就该整句装进卡里**,靠省略号糊过去等于把卖点砍了还没人发现。
 *  所以 panel-check 喂真文案:加一款长 desc,这里先红,而不是等真机截图。 */
export function cardTextFits(rows: Array<{ tag: string; name: string; status: string; fx: string }>): string[] {
  const out: string[] = [];
  const w = cardInnerW();
  for (const r of rows) {
    for (const [nm, text, size] of [
      ["名称", r.name, CARD_TEXT.nameSize], ["状态", r.status, CARD_TEXT.statusSize],
    ] as Array<[string, string, number]>) {
      if (textW(text, size) > w) out.push(`${r.tag} ${nm}「${text}」宽 ${textW(text, size)} > 卡内宽 ${w},会被截尾`);
    }
    const f = fitCardFx(r.fx);
    if (f.cut) out.push(`${r.tag} 卖点「${r.fx}」装不进 ${CARD_TEXT.fxLines} 行,末行被截尾 —— 截掉的就是卖点`);
    for (const l of f.lines) {
      if (textW(l, CARD_TEXT.fxSize) > w) out.push(`${r.tag} 卖点折出的「${l}」仍宽 ${textW(l, CARD_TEXT.fxSize)} > 卡内宽 ${w}`);
    }
    const ys = cardFxYs(f.lines.length);
    if (ys.length && ys[0] + CARD_TEXT.fxSize / 2 > CARD_TEXT.statusY - CARD_TEXT.statusSize / 2) {
      out.push(`${r.tag} 卖点骑上状态行`);
    }
    const low = ys.pop() ?? 0;
    if (low - CARD_TEXT.fxSize / 2 < -SHELF.cardH / 2) out.push(`${r.tag} 卖点末行低于卡底`);
  }
  return out;
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

// ============================================================
// 二级货架(皮肤族成员 / 套装组成件)的底部空带:「返回」居左 + 套装「一键穿戴」居右
//
// 为什么单独算:面部 tab 把四款同族脸面合成一张卡(见 config.SKIN_FAMILIES),点进去
// 是一层成员列表 —— 那一层必须有一条回去的路。它能待的地方只有货架窗底部那一条空带:
// 上面是末行卡片(2 行制时底缘 -156),下面紧挨着就是提示带车道(带顶 -209),
// 53px 装 44 高的触控键,上下各剩 5/4px。这个数抬不动了,所以由 shopSubOverlaps 钉住:
// 成员多到 3 行就没有这条空带,那时该改的是排版,不是把判据调松。
// 套装二级货架(2026-10-07)在同一条带里加第二颗键「一键穿戴」:散件试穿时不用退回
// 一级货架再整套成交;主动作贴右(拇指热区),返回键留在原位不动。
// ============================================================

/** 返回键的盒子:贴在货架窗左下角内侧 */
export function shopSubBack(w = 104, h: number = TOUCH.min): SBox {
  const K = shopContent(SHELF.h);
  const winBottom = K.grid.cy - SHELF.h / 2;
  return sbox(K.grid.left + 8, w, winBottom + 3 + h / 2, h);
}

/** 套装二级货架「一键穿戴」键的盒子:同一条空带、贴货架窗右下角内侧。
 *  右缘留 14:滚动条贴着窗右缘(BAR_X),别让键的斜切角顶上去。 */
export function shopSubAction(w = 188, h: number = TOUCH.min): SBox {
  const K = shopContent(SHELF.h);
  const winBottom = K.grid.cy - SHELF.h / 2;
  return sbox(K.grid.right - 14 - w, w, winBottom + 3 + h / 2, h);
}

/** 空带里的两颗键两头不许压字:上不叠末行卡片、下不叠提示带、不越出货架窗、彼此不叠 */
export function shopSubOverlaps(n: number): string[] {
  const out: string[] = [];
  const K = shopContent(SHELF.h);
  const rows = shelfLayout(n).rows;
  const lastBottom = K.grid.cy + rowTopY(rows - 1) - SHELF.cardH;
  const toastTop = TOAST.cy + TOAST.h / 2;
  const check = (label: string, b: SBox): void => {
    if (sTop(b) > lastBottom - 0.5) out.push(`${label}顶边 ${sTop(b).toFixed(1)} 压住末行卡片(末行底缘 ${lastBottom.toFixed(1)})`);
    if (sBottom(b) < toastTop + 0.5) out.push(`${label}底边 ${sBottom(b).toFixed(1)} 压住提示带(带顶 ${toastTop.toFixed(1)})`);
    if (b.left < K.grid.left - 0.5) out.push(`${label}左缘 ${b.left} 越出货架窗 ${K.grid.left}`);
    if (b.right > K.grid.right - 0.5) out.push(`${label}右缘 ${b.right} 越出货架窗 ${K.grid.right}`);
  };
  const back = shopSubBack();
  const act = shopSubAction();
  check("返回键", back);
  check("穿戴键", act);
  if (act.left < back.right + 4) out.push(`穿戴键左缘 ${act.left} 压住返回键(返回键右缘 ${back.right})`);
  return out;
}

// ============================================================
// 履历格内部排版 —— 「色签当标题 + 引导线 + 大数带单位 + 真数据副行」
//
// 为什么单独算:旧版一格只有三样东西 —— 一条通宽的实心色带、一个 30 号数、一行标题,
// 于是两个毛病同时犯:
//   ① 那条色带是**装饰**(它和下面的数字同色,什么也没报),还因为斜切量按自己的高算
//      而与卡框不平行,一侧戳出卡框、一侧留缝 —— 用户截图里「那个条形底板不太对」;
//   ② 标题在数字下面重复了一次,而 120 高的格子下半截空着,六格里有四格是空的。
// 现在色带换成**一枚包住指标名的色签**(fit-content,与货架卡右上角那枚稀有度角签同一件
// 工具),右边接一条同色引导线把这一行拉到卡右缘;数字升到 40 号标题字、单位退回 16 号,
// 副行只放**真从存档里算出来的数**(占比、胜负场、训练星),没有装饰口号。
//
// 坐标全在这里、且**随行重算斜边位置**(slantEdgeX):平行四边形里每一条水平行的左右缘
// 都在挪,手拍一个 x 就是「上半格贴边、下半格悬空」。判据见 statCardFits。
// ============================================================

export const STAT = {
  padX: 14, padTop: 12, padBot: 12,
  /** 标题色签(与货架卡稀有度角签同一件:字号 → chipHeight/chipWidth) */
  chipSize: 12, ruleGap: 10, ruleMin: 40, ruleW: 2,
  numSize: 40, unitSize: 16, numGap: 3,
  subSize: 11,
} as const;

export interface StatCell {
  /** 指标名(印在色签上) */
  name: string;
  /** 里程碑统计键(面板据此接整卡领取;六格恒有,与 config.MILESTONES.stat 同词表) */
  key: MilestoneStat;
  /** 主数值,已格式化好的字符串 */
  num: string;
  /** 单位(「%」「拍」「分」);空串 = 不带单位 */
  unit: string;
  /** 副行:必须是真数据,空串 = 这一行不占位 */
  sub: string;
  /** 可领取时的一次性奖励合计(面板把它点亮成金色领取行 + 整卡可点);缺省 = 不可领 */
  claim?: { coin: number; exp: number };
  /** 这一格的角色色(色签面 / 引导线 / 数字 / 卡框 keyline 全读它) */
  role: Role;
}

export interface StatCardDL {
  /** 色签:节点中心 */
  chip: { x: number; y: number; w: number; h: number };
  /** 引导线:两端 x 与中线 y */
  rule: { x0: number; x1: number; y: number };
  /** 大数:左缘 x(左锚 Label)与基线中心 y */
  num: { x: number; y: number; w: number };
  /** 单位:左缘 x */
  unit: { x: number; y: number; w: number };
  /** 副行:中心 x(居中 Label)与 y */
  sub: { x: number; y: number; w: number };
}

/** 一格怎么摆。w/h 传 SHOP.stats 的格位尺寸,坐标以卡中心为原点(y 向上) */
export function statCardDL(w: number, h: number, c: StatCell): StatCardDL {
  const skew = skewOf(h, SLANT.block);
  /** 平行四边形在给定 y 处的左缘(斜切 ⇒ 每一行的左右缘都在挪,不能只算一次) */
  const edge = (y: number): number => slantEdgeX(w, h, skew, y);
  const mid = (y: number): number => edge(y) + w / 2;

  const chipH = chipHeight(STAT.chipSize);
  const chipW = chipWidth(c.name, STAT.chipSize);
  const chipY = h / 2 - STAT.padTop - chipH / 2;
  const chipX = edge(chipY) + STAT.padX + chipW / 2;

  const subH = Math.round(STAT.subSize * 1.35);
  const subY = -h / 2 + STAT.padBot + subH / 2;
  // 大数落在「色签行下沿 ↔ 副行上沿」的正中,格子越高它越居中,不会顶到上面那行
  const numY = (chipY - chipH / 2 + subY + subH / 2) / 2;

  const numW = textW(c.num, STAT.numSize);
  const unitW = c.unit ? textW(c.unit, STAT.unitSize) : 0;
  const pairW = numW + (unitW ? STAT.numGap + unitW : 0);
  const cx = mid(numY);

  return {
    chip: { x: chipX, y: chipY, w: chipW, h: chipH },
    rule: { x0: chipX + chipW / 2 + STAT.ruleGap, x1: edge(chipY) + w - STAT.padX, y: chipY },
    num: { x: cx - pairW / 2, y: numY, w: numW },
    // 单位沉到数字的基线附近:两个中心对齐的 Label 并排读起来是「46 拍」两坨一样大的字,
    // 而单位该是**跟着读**的次要件 —— 降一档、下移一档,主数才立得住。
    unit: { x: cx - pairW / 2 + numW + STAT.numGap, y: numY - (STAT.numSize - STAT.unitSize) * 0.28, w: unitW },
    sub: { x: mid(subY), y: subY, w: textW(c.sub, STAT.subSize) },
  };
}

/** 六格装得下装不下:字溢出、线被吃光、三行叠字,全在这里判(panel-check 喂真实文案) */
export function statCardFits(cells: StatCell[], w: number = SHOP.stats.cw, h: number = SHOP.stats.ch): string[] {
  const out: string[] = [];
  const inner = w - STAT.padX * 2;
  const numHalf = STAT.numSize * 0.55;          // 大数的视觉半高(含降部留量)
  for (const c of cells) {
    const d = statCardDL(w, h, c);
    const tag = `履历格「${c.name}」`;
    if (d.rule.x1 - d.rule.x0 < STAT.ruleMin) {
      out.push(`${tag} 引导线只剩 ${(d.rule.x1 - d.rule.x0).toFixed(0)}px,不到 ${STAT.ruleMin}`);
    }
    const pairW = d.num.w + (d.unit.w ? STAT.numGap + d.unit.w : 0);
    if (pairW > inner) out.push(`${tag} 大数「${c.num}${c.unit}」宽 ${pairW.toFixed(0)} > 内宽 ${inner}`);
    if (c.sub && d.sub.w > inner) out.push(`${tag} 副行「${c.sub}」宽 ${d.sub.w.toFixed(0)} > 内宽 ${inner}`);
    // 三行不许叠:色签行 → 大数 → 副行
    if (d.chip.y - d.chip.h / 2 <= d.num.y + numHalf) out.push(`${tag} 大数顶到色签行`);
    if (c.sub && d.num.y - numHalf <= d.sub.y + Math.round(STAT.subSize * 1.35) / 2) out.push(`${tag} 大数压住副行`);
    if (d.chip.y + d.chip.h / 2 > h / 2 - STAT.padTop + 0.5) out.push(`${tag} 色签戳出卡上缘`);
    if (d.sub.y - Math.round(STAT.subSize * 1.35) / 2 < -h / 2 + STAT.padBot - 0.5) out.push(`${tag} 副行戳出卡下缘`);
    // 斜切卡里越往上左右缘越往左:内缩给得太少,第一行的色签就会骑在卡的斜边上
    if (STAT.padX < 8) out.push(`履历格内缩 padX=${STAT.padX} 小于 8,色签会骑上卡的斜边`);
    if (d.chip.w > inner - STAT.ruleGap - STAT.ruleMin) {
      out.push(`${tag} 指标名色签宽 ${d.chip.w.toFixed(0)} 挤掉引导线(内宽 ${inner})`);
    }
    // 一格只报一次色:色签面 / 引导线 / 大数 / keyline 全读同一个角色,角色表里查不到就是错字
    if (!ROLE[c.role]) out.push(`${tag} 角色「${c.role}」不在 ROLE 表里`);
  }
  return out;
}

/**
 * 履历页六格的内容。**版式与文案同处一地**,所以 tools/panel-preview 出的是这一页、
 * panel-check 断言的也是这一页,而 career-panel 摆的还是同一份数据 —— 预览不再「另抄一份」
 * (AGENTS.md 对 brief-preview 的批评就在这)。
 *
 * **副行只写真从存档里算出来的数** —— 旧版六格里有四格下半截是空的,而空出来的地方一旦
 * 填上「手感火热」这类装饰口号,就成了「不报数据的漂亮话」。`hits` 为 0(新档没打过)时
 * 占比无意义,宁可不写。
 *
 * 里程碑三态(2026-10-07,mv 缺省 = 不挂里程碑,判据/旧调用方仍走纯展示):
 * ① 可领 → 副行整行换成「点击领取 +N金币+N经验」,cell 带 claim(面板发光 + 整卡可点);
 * ② 有下一档 → 原文案缀「 · 下一档 N{unit}」,**量过放得下才缀**(满档数据下退回原文案);
 * ③ 已领满 → 缀「 · 已领满」,同样量宽。
 * 胜率吃 core/milestone 的 statValue —— 它同时是里程碑判定的口径,两处不许各算一份。
 */
export function statCells(p: Profile, drillStarsMax: number, mv?: Record<MilestoneStat, MilestoneView>): StatCell[] {
  const st = p.stats;
  const winRate = statValue("winRate", st, p.bestEndlessScore);
  const share = (n: number): string => (st.hits > 0 ? `占击球 ${Math.round((n / st.hits) * 100)}%` : "");
  const stars = Object.values(p.drills).reduce((a, d) => a + ((d && d.stars) || 0), 0);

  const inner = SHOP.stats.cw - STAT.padX * 2;
  const fitsSub = (s: string): boolean => textW(s, STAT.subSize) <= inner;
  const decorate = (key: MilestoneStat, base: string): { sub: string; claim?: { coin: number; exp: number } } => {
    const v = mv?.[key];
    if (!v) return { sub: base };
    if (v.claimable) {
      return { sub: `点击领取 +${v.claimCoin}金币+${v.claimExp}经验`, claim: { coin: v.claimCoin, exp: v.claimExp } };
    }
    const sep = base ? " · " : "";
    if (v.allDone) {
      const s = `${base}${sep}已领满`;
      return { sub: fitsSub(s) ? s : base };
    }
    if (v.nextAt != null) {
      const s = `${base}${sep}下一档 ${v.nextAt}${v.unit}`;
      return { sub: fitsSub(s) ? s : base };
    }
    return { sub: base };
  };

  const defs: Array<{ key: MilestoneStat; num: string; unit: string; base: string; role: Role }> = [
    { key: "winRate", num: `${winRate}`, unit: "%", base: `${st.wins} 胜 / ${st.matches} 战`, role: "primary" },
    { key: "smashes", num: `${st.smashes}`, unit: "", base: share(st.smashes), role: "power" },
    { key: "perfects", num: `${st.perfects}`, unit: "", base: share(st.perfects), role: "star" },
    { key: "sweets", num: `${st.sweets}`, unit: "", base: share(st.sweets), role: "drill" },
    { key: "maxRally", num: `${st.maxRally}`, unit: "拍", base: `累计击球 ${st.hits} 拍`, role: "info" },
    { key: "endless", num: `${p.bestEndlessScore || 0}`, unit: "分",
      base: `训练 ${stars}/${drillStarsMax} ★`, role: "record" },
  ];
  return defs.map(({ key, num, unit, base, role }) => {
    const meta = MILESTONE_STATS.find((m) => m.key === key)!;
    const { sub, claim } = decorate(key, base);
    return { key, name: meta.label, num, unit, sub, role, ...(claim ? { claim } : {}) };
  });
}

// ============================================================
// 底部提示带(toast)—— 「已装备「活力橙」」「金币不足 · 还差 12」那一条
//
// 为什么搬进来:这块反馈的**面色与字色原来分两处写**,而且撞成了同一个颜色 ——
// 底块走 ROLE.star.face(荧光黄 #ffe14d),Label 却抄 COL.gold,而 COL.gold 就是
// 同一支 C.acid。同色相叠 = 1.00:1,用户真机截图里那是一条纯黄色块、一个字都读不出来
// (「底下这个提示都看不清」)。这类坏不会崩、只会安静地看不见,所以成对同源 +
// 让 panel-check 拿 CONTRAST_FLOOR 核一次,才不会再分家。
//
// 车道:面板下缘与货架窗底之间那 27px,和底部提示行(「换球后全场生效」)同一条 ——
// 塞不下两条,提示带出现时提示行让位(见 career-panel 的 _hintWanted)。
// 旧写法挂在 root 上手拍 -PH/2+20,整条带子往上压进货架末行 21px,
// 把「樱花粉」那格的金币行盖掉一半 —— 盖字这件事同样进判据(toastLane)。
// ============================================================

export const TOAST = {
  /** 带心(面板局部坐标;节点挂在 root 上要再加 SHOP.panelY)。
   *  h=22 / cy=-220 是这条 27px 车道(-208 窗底 ↔ -235 面板下缘)里唯一两头都留口气的解:
   *  上留 1px 不贴卡片、下留 4px 不出面板。drawP5Block 自带的墨影会往下多伸 8px,
   *  压在近黑的衬纸板上看不出来,所以判据只管**面**的几何。 */
  cy: -220, h: 22, size: 15,
  minW: 200, maxW: SHOP.pw - 40, padX: 48,
  face: ROLE.star.face,
} as const;

/** 字色由面色推,不给第二支笔 */
export const TOAST_FG: string = inkFor(TOAST.face);

/** 底块跟着文案收放:长短句都从这一条道走。textPx 由调用方按同一字号量出来 */
export function toastWidth(textPx: number): number {
  return Math.min(TOAST.maxW, Math.max(TOAST.minW, textPx + TOAST.padX));
}

/** 提示带的盒子(水平居中于面板;career-panel 摆节点、panel-preview 出图都取这一个) */
export function toastBox(w: number): SBox {
  return sbox(-w / 2, w, TOAST.cy, TOAST.h);
}

/** 提示带的车道判据:不压货架末行、不出面板下缘、车道本身还装得下它。
 *  cy/h 带默认参是为了让 --selftest 能把**旧写法**(root 手拍 -PH/2+20、高 36)喂进来咬。 */
export function toastLane(cy: number = TOAST.cy, h: number = TOAST.h, gridH: number = SHELF.h): string[] {
  const out: string[] = [];
  const b = sbox(-TOAST.minW / 2, TOAST.minW, cy, h);
  const gridBottom = shopContent(gridH).grid.cy - gridH / 2;
  const panelBottom = -SHOP.ph / 2;
  if (sTop(b) > gridBottom + 0.5) out.push(`提示带顶边 ${sTop(b).toFixed(1)} 压进货架窗(窗底 ${gridBottom})`);
  if (sBottom(b) < panelBottom + 2) out.push(`提示带底边 ${sBottom(b).toFixed(1)} 越出面板下缘 ${panelBottom}`);
  if (gridBottom - panelBottom < h + 2) out.push(`底部车道只有 ${gridBottom - panelBottom}px,放不下 ${h} 高的提示带`);
  return out;
}

const hit = (a: SBox, b: SBox): boolean =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && sBottom(a) < sTop(b) - 0.5 && sBottom(b) < sTop(a) - 0.5;

/** 顶栏四件、tab 五格、内容区三件各自不许压字 */
export function shopOverlaps(gridH = SHELF.h): string[] {
  const out: string[] = [];
  // 顶栏六件两两不压(等级块改成两行后,「谁挨着谁」不再是线性相邻关系,全对扫一遍)
  const top = Object.entries(shopTopBar()) as Array<[string, SBox]>;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      if (hit(top[i][1], top[j][1])) out.push(`顶栏:${top[i][0]} 压住 ${top[j][0]}`);
    }
  }
  const T = shopTopBar();

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
