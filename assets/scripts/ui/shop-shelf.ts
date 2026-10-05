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
import { textW } from "../core/text-metrics";
// 只取类型:履历格的内容函数要吃什么数据,不该把 core/career 的运行时代码拖进排版层
import type { Profile } from "../core/career";

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
  /** 主数值,已格式化好的字符串 */
  num: string;
  /** 单位(「%」「拍」「分」);空串 = 不带单位 */
  unit: string;
  /** 副行:必须是真数据,空串 = 这一行不占位 */
  sub: string;
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
 */
export function statCells(p: Profile, drillStarsMax: number): StatCell[] {
  const st = p.stats;
  const winRate = st.matches > 0 ? Math.round((st.wins / st.matches) * 100) : 0;
  const share = (n: number): string => (st.hits > 0 ? `占击球 ${Math.round((n / st.hits) * 100)}%` : "");
  const stars = Object.values(p.drills).reduce((a, d) => a + ((d && d.stars) || 0), 0);
  return [
    { name: "生涯胜率", num: `${winRate}`, unit: "%", sub: `${st.wins} 胜 / ${st.matches} 战`, role: "primary" },
    { name: "扣杀终结", num: `${st.smashes}`, unit: "", sub: share(st.smashes), role: "power" },
    { name: "完美击球", num: `${st.perfects}`, unit: "", sub: share(st.perfects), role: "star" },
    { name: "甜区命中", num: `${st.sweets}`, unit: "", sub: share(st.sweets), role: "drill" },
    { name: "最长相持", num: `${st.maxRally}`, unit: "拍", sub: `累计击球 ${st.hits} 拍`, role: "info" },
    { name: "无限模式纪录", num: `${p.bestEndlessScore || 0}`, unit: "分",
      sub: `训练 ${stars}/${drillStarsMax} ★`, role: "record" },
  ];
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
