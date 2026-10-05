// ============================================================
// P5 形状层:把面板层的语法算成**显示列表(display list)**,零 cc。
//
// 为什么是「算点列」而不是「直接往 Graphics 上画」——
//   1) 分层铁律里 core/ 零 cc 才能进 node 回归;面板排版同样需要这条通道:
//      tools/panel-preview.ts 要出图、tools/panel-check.ts 要断言几何,
//      而 tools/cc-stub.ts 只桩得住 Color + Graphics 两个类。点列在这里出,
//      画笔在 p5-paint.ts(只 import Color/Graphics),两头都能跑。
//   2) 形状与画笔分开,才谈得上「一份真话」:runtime 画的和 preview 画的是同一批多边形,
//      不再是 brief-preview 那种「把配色版式在工具里重抄一份」的对照图。
//
// 语法(与 p5-tokens 的 L0..L5 一一对应):
//   plate   面板衬纸:斜切硬阴影 → 错位 accent 副衬 → 墨面 → 平直下缘 → 顶缘高光
//   block   实底大色块:首页 drawSolidBlock 的等价物(tab / 卡片 / 主按钮)
//   band    分区色带:block 的 10° 斜切档(小节标题、状态胶囊)
//   slot    凹陷槽:经验槽、滑杆轨道、未选中/锁定态 —— 与 block 相反,是「挖进去」的
//   knob    斜切旋钮:滑杆的把手(替代那颗光滑白圆)
//   toggle  开关行:整行按 on/off 走 block/slot,状态另有文字读数兜底
//   halftone 网点:P5 印刷味,只挂面板衬底一层,点数有硬上限
//   star / badge  印章件:四尖星等级、锁/最佳/下一关/已拥有
//
// 顶点顺序一律**逆时针**(与 ui-arcade.slantPath 一致);y 向上(UI 本地坐标)。
// ============================================================
import { C, HALFTONE, INK_TEXT, ROLE, SLANT, halftoneDots, inkFor } from "./p5-tokens";
import { textW } from "../core/text-metrics";

export type Pt = [number, number];

/** 一笔:多边形填充/描边,或一个圆点(halftone 专用) */
export type Paint =
  | { kind: "fill" | "stroke"; hex: string; a: number; lw?: number; close?: boolean; pts: Pt[] }
  | { kind: "dot"; hex: string; a: number; cx: number; cy: number; r: number };

// ---------- 颜色算术(零 cc:不出 Color 实例,只出 hex 串) ----------

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

/** 同色系压暗:k<1 越暗。与 ui-arcade.acShade 同一算法(那边出 Color,这边出 hex) */
export function shadeHex(hex: string, k: number): string {
  const r = parseInt(hex.slice(1, 3), 16) * k;
  const g = parseInt(hex.slice(3, 5), 16) * k;
  const b = parseInt(hex.slice(5, 7), 16) * k;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// ---------- 几何原语 ----------

/** 斜切量:高 h 的块斜 deg 度时顶边相对底边的水平偏移 */
export function skewOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

/**
 * 斜切平行四边形四点(视觉居中,盒心即原点)。
 * 与 ui-arcade.slantPath 逐点同式 —— 那边走 moveTo/lineTo,这边出点列。
 * 注意视觉盒比 w 宽 |skew|:动态底块的宽度计算要预留这份溢出。
 */
export function slantQuad(w: number, h: number, skew: number, cx = 0, cy = 0): Pt[] {
  const s = skew / 2;
  return [
    [-w / 2 + s + cx, -h / 2 + cy],
    [w / 2 + s + cx, -h / 2 + cy],
    [w / 2 - s + cx, h / 2 + cy],
    [-w / 2 - s + cx, h / 2 + cy],
  ];
}

/** 轴对齐矩形四点(中心在 cx,cy) */
export function rectQuad(w: number, h: number, cx = 0, cy = 0): Pt[] {
  return slantQuad(w, h, 0, cx, cy);
}

/** 高 h、斜切 skew 的平行四边形**左缘**在给定 y 处的 x(右缘 = 本函数结果 + w) */
export function slantEdgeX(w: number, h: number, skew: number, y: number): number {
  return -w / 2 + skew / 2 - skew * (y + h / 2) / h;
}

/**
 * 从平行四边形里沿水平线**切一片**(yBot..yTop),左右两边严格贴卡框的斜边。
 *
 * 为什么不能图省事用 `slantQuad(w, bandH, skewOf(bandH))`:斜切量是按**自己的高**算的,
 * 26 高的色带 skew≈2.3,而 136 高的卡片 skew≈11.9 —— 两条边根本不平行。出图实测
 * 色带在一侧戳出卡框 4px、另一侧留 4px 缝,读出来就是「这条带贴歪了」(用户截图里
 * 「那个条形底板不太对」)。切片的四边与卡框同式,才谈得上「带子是卡上印出来的一条」。
 */
export function sliceQuad(w: number, h: number, skew: number, yBot: number, yTop: number): Pt[] {
  const xb = slantEdgeX(w, h, skew, yBot);
  const xt = slantEdgeX(w, h, skew, yTop);
  return [[xb, yBot], [xb + w, yBot], [xt + w, yTop], [xt, yTop]];
}

/**
 * 平行四边形在给定 y 处的**一条内缩横线**(顶缘高光、上缘压暗、下缘接光都用它)。
 *
 * 旧写法四处都是「两端 = ∓w/2 + skew/2 ± inset, y = ±h/2」,
 * 而 slantQuad 的上缘是 `-skew/2`、下缘才是 `+skew/2` —— 于是**上缘**那根线整体右偏一个
 * skew:136 高的卡偏 11.9,右端直接戳出卡框、左端又缩进 15,读出来是「右上角掉了一截白边」。
 * 44 高的 tab 只偏 3.8,所以一直没被发现。走这条函数后上下缘同式,不再靠手挑符号。
 */
export function sliceLine(w: number, h: number, skew: number, y: number, inset: number): Pt[] {
  const x = slantEdgeX(w, h, skew, y);
  return [[x + inset, y], [x + w - inset, y]];
}

// ---------- 色签 / 角签(chip)----------

/** chip 的高:字号 + 上下各 5 的呼吸(与 ui-arcade.makeChip 同一把尺) */
export function chipHeight(size: number): number {
  return Math.round(size + 10);
}

/**
 * chip 底块宽度:量字宽 → 加左右内边距 → 再留斜切溢出。
 *
 * 为什么从 makeChip 里搬出来:履历格要把「指标名色签」当标题行,签子右边还得接一条
 * 引导线,而线的起点必须知道签子有多宽。在面板那边算一份、这边再猜一份,就是
 * 「线压住字」的来路 —— 一把尺,两边都读它。
 */
export function chipWidth(text: string, size: number, slantDeg = SLANT.band): number {
  const h = chipHeight(size);
  return Math.max(size * 2 + 16, textW(text, size) + 16)
    + (slantDeg !== 0 ? Math.abs(skewOf(h, slantDeg)) : 0);
}

/** 色签底块本身(斜切实色片):真机与出图都画这一份,不再「同形不同源」 */
export function chipDL(text: string, size: number, faceHex: string, slantDeg = SLANT.band): Paint[] {
  const h = chipHeight(size);
  const w = chipWidth(text, size, slantDeg);
  return [{ kind: "fill", hex: faceHex, a: 1, pts: slantQuad(w, h, skewOf(h, slantDeg)) }];
}

/**
 * 撕纸齿:一排三角形。base 是齿的**基线** y,tips 在另一侧。
 * dir="down" 齿尖朝下(基线在上) —— 衬纸下缘用这个;dir="up" 反之。
 */
export function tearPolys(w: number, baseY: number, teeth: number, depth: number, dir: "up" | "down"): Pt[][] {
  const out: Pt[][] = [];
  const step = w / teeth;
  const tip = dir === "down" ? baseY - depth : baseY + depth;
  for (let i = 0; i < teeth; i++) {
    const x0 = -w / 2 + i * step;
    out.push([[x0, baseY], [x0 + step * 0.5, tip], [x0 + step, baseY]]);
  }
  return out;
}

/** n 尖多角星(与 ui-arcade.drawStarburst 同式:半径交替、角度 π*i/points + rot) */
export function starQuad(cx: number, cy: number, rOut: number, rIn: number, points: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const t = (Math.PI * i) / points + rot;
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return pts;
}

/**
 * 有界斜纹记号:n 条 45° 短斜杠,全部落在 x0..x0+w 之内。
 *
 * 为什么不用 stripePolys:那条 45° 危险条带的实现为了铺满域,横向从 `-w/2-h` 扫到 `w/2`
 * (斜切要留出高那么多的余量),所以给它 20 宽的窗口会画出 ~54 宽的纹 —— 出图实测直接
 * 溢出到行外、压住右端的「开/关」读数。记号是小件,必须自己数得清边界。
 */
export function hatchPolys(x0: number, cy: number, w: number, h: number, bars: number): Pt[][] {
  const out: Pt[][] = [];
  const lean = h * 0.42;                       // 45° 味道的水平错位
  const slot = w / bars;
  const bw = Math.max(1.5, slot * 0.42);
  for (let i = 0; i < bars; i++) {
    const x = x0 + i * slot;
    out.push([
      [x, cy - h / 2], [x + bw, cy - h / 2],
      [x + bw + lean, cy + h / 2], [x + lean, cy + h / 2],
    ]);
  }
  return out;
}

/** 45° 斜纹带(P5 危险条纹),裁在 w×h 域内 */
export function stripePolys(w: number, h: number, gap: number, cx = 0, cy = 0): Pt[][] {
  const out: Pt[][] = [];
  for (let x = -w / 2 - h; x < w / 2; x += gap * 2) {
    out.push([
      [x + cx, h / 2 + cy], [x + gap + cx, h / 2 + cy],
      [x + gap + h + cx, -h / 2 + cy], [x + h + cx, -h / 2 + cy],
    ]);
  }
  return out;
}

/** 顶缘高光线:沿斜切块上缘的一条开放细线(留 3 不进角) */
function topGloss(w: number, h: number, skew: number, cx = 0, cy = 0, inset = 3): Paint {
  const s = skew / 2;
  return {
    kind: "stroke", hex: "#ffffff", a: 0.12, lw: 1, close: false,
    pts: [[-w / 2 + s + cx + inset, -h / 2 + cy], [w / 2 + s + cx - inset, -h / 2 + cy]],
  };
}

// ---------- L1 衬纸:面板本体 ----------

export interface PlateOpts {
  /** 斜切角度,默认 SLANT.plate(3°) */
  slant?: number;
  /** 面色,默认 C.ink */
  face?: string;
  /** 副衬色(错位露出的那张纸),默认斩劈红 */
  bandHex?: string;
  /** 副衬不透明度,默认 0.95 */
  bandA?: number;
  /** 副衬错位,默认 (+10, -8):露右下两条边 */
  bandDx?: number;
  bandDy?: number;
  /** 下缘收边:平直(历史撕纸齿参数保留兼容,默认 0 = 不撕) */
  teeth?: number;
  /** 外描边(纸白 14%),默认开 */
  edge?: boolean;
  /**
   * 标题带上叠一层网点(印刷味)。默认只压顶部那一条,不是铺满整块衬底 ——
   * 铺满既吵(出图实测像波点桌布)又要上千点。给数字可改带高,给 true 用默认 76。
   */
  halftone?: boolean | number;
  /** 网点色,默认纸白 */
  halftoneHex?: string;
}

/**
 * 面板衬纸:一张「撕下来的黑纸」垫在红纸上。
 * 与首页标题衬底(main-menu 的 backing)同一配方,只是把「红面黑块」翻成
 * 「黑面红衬」—— 面板是读字的,底色必须压得住,不能整面红。
 */
export function plateDL(w: number, h: number, o: PlateOpts = {}): Paint[] {
  const deg = o.slant ?? SLANT.plate;
  const skew = skewOf(h, deg);
  const face = o.face ?? C.ink;
  const band = o.bandHex ?? C.slash;
  const out: Paint[] = [
    // 斜切硬阴影
    { kind: "fill", hex: "#000000", a: 0.45, pts: slantQuad(w, h, skew, 6, -6) },
    // 错位副衬:露出右下两条红边 = 「两张纸」
    { kind: "fill", hex: band, a: o.bandA ?? 0.95, pts: slantQuad(w, h, skew, o.bandDx ?? 10, o.bandDy ?? -8) },
    // 主面
    { kind: "fill", hex: face, a: 0.96, pts: slantQuad(w, h, skew) },
  ];
  const hh = typeof o.halftone === "number" ? o.halftone : (o.halftone ? 76 : 0);
  if (hh > 0) {
    // 只压标题带:网点在顶边往下 hh 高的那条横带里,半径仍按「离面板中心多远」递增,
    // 于是带子两端密、中间疏 —— 半调的层次留着,但面积只有整块的六分之一。
    out.push(...halftoneDL(w - 24, hh, {
      cx: 0, cy: h / 2 - hh / 2 - 6, hex: o.halftoneHex, rampW: w, rampH: h,
    }));
  }
  // 下缘平直收边:历史撕纸齿保留参数兼容,默认不撕
  const teeth = o.teeth ?? 0;
  if (teeth > 0) {
    for (const t of tearPolys(w - 24, -h / 2, teeth, 7, "down")) {
      out.push({ kind: "fill", hex: face, a: 0.96, pts: t });
    }
  }
  out.push(topGloss(w, h, skew));
  if (o.edge !== false) {
    out.push({ kind: "stroke", hex: C.paper, a: 0.14, lw: 2, pts: slantQuad(w, h, skew) });
  }
  return out;
}

// ---------- L3 实底大色块 ----------

/**
 * 实底斜切大色块:整面 accent + 同色压暗厚底边 + 顶缘高光 + 同色描边。
 * 与 ui-arcade.drawSolidBlock 同一配方(那边是历史直绘版,本函数是点列版),
 * 首页五块入口用的就是它 —— 面板里的 tab/卡片/主按钮照抄,不要再发明。
 */
export function blockDL(w: number, h: number, accent: string, slantDeg = SLANT.block): Paint[] {
  const skew = skewOf(h, slantDeg);
  return [
    { kind: "fill", hex: "#000000", a: 0.55, pts: slantQuad(w, h, skew, 5, -8) },
    { kind: "fill", hex: shadeHex(accent, 0.4), a: 1, pts: slantQuad(w, h + 5, skewOf(h + 5, slantDeg), 0, -2.5) },
    { kind: "fill", hex: accent, a: 0.97, pts: slantQuad(w, h, skew) },
    { kind: "stroke", hex: "#ffffff", a: 0.25, lw: 1, close: false, pts: sliceLine(w, h, skew, h / 2, 3) },
    { kind: "stroke", hex: shadeHex(accent, 0.62), a: 0.9, lw: 2, pts: slantQuad(w, h, skew) },
  ];
}

/** 分区色带 = 大色块的 10° 档(小面积要靠斜度才读出形状) */
export function bandDL(w: number, h: number, faceHex: string): Paint[] {
  return blockDL(w, h, faceHex, SLANT.band);
}

// ---------- 卡片:深底 + 一条 accent 色带 ----------

export interface CardOpts {
  /** 顶部色带高,默认 h 的 0.2(不小于 22);**0 = 不画色带**(标题另有色签时用) */
  bandH?: number;
  /** 整卡不透明度,默认 0.97 */
  alpha?: number;
  /** 锁定/未解锁:面色压到 navy、色带退成 line,字由调用方按 dimDeep 走 */
  locked?: boolean;
  /** 强调态(下一关 / 选中):色带描边加粗提亮 */
  glow?: boolean;
  /** 色带下缘收边:平直(历史撕纸齿参数保留兼容,默认 0 = 平边) */
  teeth?: number;
  /** 斜切角,默认 SLANT.block */
  slant?: number;
}

/**
 * 卡片底:墨面 + 顶部一条 accent 色带 + 同色 keyline。
 *
 * 为什么不能直接用 blockDL —— 出图实测:闯关大厅 5 张卡、训练场 6 张、商店 8 张,
 * 每张都整面实底就是「红黄绿青白」五色彩虹,而 P5 的底色语言是**红黑白主导 + 点缀**。
 * 大色块要留给少数几块大面(首页五入口、继续闯关条、选中的 tab),
 * 卡片这种「一屏十几张」的表面,色只能占一条带 + 一圈描边,
 * 信息层级反而更清楚:色带报「这卡是什么属性」,墨面承载文字。
 *
 * `bandH: 0` = 不要色带(履历格那种「标题自己就是一枚色签」的版式,色只走 keyline)。
 */
export function cardDL(w: number, h: number, accent: string, o: CardOpts = {}): Paint[] {
  const deg = o.slant ?? SLANT.block;
  const skew = skewOf(h, deg);
  const a = o.alpha ?? 0.97;
  const face = o.locked ? C.navy : C.navy2;
  const band = o.locked ? C.line : accent;
  const bandH = o.bandH ?? Math.max(22, h * 0.2);
  const out: Paint[] = [
    { kind: "fill", hex: "#000000", a: 0.5, pts: slantQuad(w, h, skew, 5, -7) },
    { kind: "fill", hex: face, a, pts: slantQuad(w, h, skew) },
  ];
  if (bandH > 0) {
    // 色带 = 卡框上端切下来的一片,左右两边严格贴着卡的斜边(见 sliceQuad)
    out.push({ kind: "fill", hex: band, a: o.locked ? 0.7 : 0.96, pts: sliceQuad(w, h, skew, h / 2 - bandH, h / 2) });
    // 色带下缘平直收边:历史撕纸写法保留参数兼容,默认不撕
    const teeth = o.teeth ?? 0;
    if (teeth > 0 && !o.locked) {
      const yB = h / 2 - bandH;
      const dx = slantEdgeX(w, h, skew, yB) + w / 2;   // 撕口跟着这一行的中心走
      for (const t of tearPolys(w - 16, yB, teeth, 5, "down")) {
        out.push({ kind: "fill", hex: band, a: 0.96, pts: t.map(([x, y]) => [x + dx, y] as Pt) });
      }
    }
  }
  out.push({ kind: "stroke", hex: band, a: o.glow ? 0.95 : (o.locked ? 0.4 : 0.55), lw: o.glow ? 3 : 2, pts: slantQuad(w, h, skew) });
  out.push({ kind: "stroke", hex: "#ffffff", a: 0.14, lw: 1, close: false, pts: sliceLine(w, h, skew, h / 2, 3) });
  return out;
}

// ---------- L3′ 凹陷槽 ----------

/**
 * 凹陷槽:与 block 相反的立体关系 —— 上缘压暗、下缘接光,读作「挖进去的」。
 * 用在经验槽、滑杆轨道、未选中/锁定态。**故意不描外边**:
 * 旧写法那圈 5% 白描边在深色面板上只有 1.1:1,是「这控件是不是坏了」的元凶。
 */
export function slotDL(w: number, h: number, slantDeg = SLANT.block, o: { face?: string } = {}): Paint[] {
  const skew = skewOf(h, slantDeg);
  const face = o.face ?? C.navy;
  return [
    { kind: "fill", hex: face, a: 0.92, pts: slantQuad(w, h, skew) },
    // 极淡一圈边:凹陷槽在近黑衬底上只靠上下缘的压暗/接光读不出来(出图实测几乎隐形),
    // 补一圈 line —— 仍是「凹」,但轮廓在。故意比 block 的描边暗一个档,别抢凸的立体感。
    { kind: "stroke", hex: C.line, a: 0.9, lw: 1.5, pts: slantQuad(w, h, skew) },
    // 上缘内阴影
    { kind: "stroke", hex: "#000000", a: 0.55, lw: 2, close: false, pts: sliceLine(w, h, skew, h / 2 - 1, 2) },
    // 下缘接光
    { kind: "stroke", hex: "#ffffff", a: 0.09, lw: 1, close: false, pts: sliceLine(w, h, skew, -h / 2 + 1, 2) },
  ];
}

// ---------- 滑杆:轨道 / 填充 / 旋钮 ----------

export interface SliderDL {
  track: Paint[];
  fill: Paint[];
  knob: Paint[];
  ticks: Paint[];
}

/**
 * 滑杆整支。t 是 0..1 的归一化值。
 * 轨道走 slot(凹),填充走同斜率的实底块(凸出来的那截),旋钮是斜切方块。
 * 旧写法是「玻璃胶囊 + 白色实心圆 + 强调色描边圆」—— 光滑圆圈正是 P5 语汇要拒绝的,
 * 而且 0.5 透明的玻璃轨道在亮球馆上根本读不出还剩多少。
 */
export function sliderDL(w: number, trackH: number, t: number, accent: string, ticks = 0): SliderDL {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const skew = skewOf(trackH, SLANT.block);
  const fillW = w * clamped;
  const knobS = trackH * 1.35;
  const knobX = -w / 2 + fillW;
  const out: SliderDL = {
    track: slotDL(w, trackH),
    fill: fillW > trackH * 0.5
      ? [{ kind: "fill", hex: accent, a: 0.95, pts: slantQuad(fillW, trackH, skew, -w / 2 + fillW / 2, 0) }]
      : [],
    knob: knobDL(knobS, accent, knobX, 0),
    ticks: [],
  };
  if (ticks > 1) {
    for (let i = 0; i < ticks; i++) {
      const x = -w / 2 + (w * i) / (ticks - 1);
      out.ticks.push({ kind: "stroke", hex: C.paper, a: 0.22, lw: 1, close: false, pts: [[x, -trackH / 2 - 4], [x, -trackH / 2 - 1]] });
    }
  }
  return out;
}

/** 进度条:轨道 + 填充(与滑杆同源,但没有旋钮与刻度) */
export interface ProgressDL {
  track: Paint[];
  fill: Paint[];
}

/**
 * 进度条整支(下载进度/经验条)。t 是 0..1 的归一化值。
 * 旋钮是「可以拖」的记号,进度条不可拖,所以不画 —— 只留凹槽轨道与同斜率填充。
 */
export function progressDL(w: number, h: number, t: number, accent: string): ProgressDL {
  const dl = sliderDL(w, h, t, accent, 0);
  return { track: dl.track, fill: dl.fill };
}

/** 斜切旋钮:墨底垫一层 + 实色面 + 顶缘高光(替代那颗白圆) */
export function knobDL(s: number, faceHex: string, cx = 0, cy = 0, slantDeg = SLANT.band): Paint[] {
  const skew = skewOf(s, slantDeg);
  return [
    { kind: "fill", hex: "#000000", a: 0.5, pts: slantQuad(s, s, skew, cx + 2, cy - 2) },
    { kind: "fill", hex: shadeHex(faceHex, 0.45), a: 1, pts: slantQuad(s, s, skew, cx, cy - 1.5) },
    { kind: "fill", hex: faceHex, a: 1, pts: slantQuad(s, s, skew, cx, cy) },
    { kind: "stroke", hex: "#ffffff", a: 0.3, lw: 1, close: false, pts: sliceLine(s, s, skew, s / 2 - 1, 2).map(([x, y]) => [x + cx, y + cy] as Pt) },
  ];
}

// ---------- 图标按钮:实底斜方印章(关闭 ✕ 等小键纯色块) ----------

export interface IconBtnOpts {
  /** 面不透明度,默认 1.0 纯色块实底 */
  faceA?: number;
  /** 描边不透明度,默认 1.0 */
  edgeA?: number;
  /** 斜切角,默认 SLANT.button —— 按钮档,比色块更斜一点才像能按下去的东西 */
  slantDeg?: number;
}

/**
 * 图标按钮底:实底斜方印章 = blockDL 配方小件版(纯色块实底)。
 * 告别旧圆底与暗色半透明感:100% 不透明实底面色 + 同色压暗厚底边 + 硬阴影 + 顶缘高光 + 提亮描边。
 * 偏移全按小件收:阴影 2.5(大块是 5/8,小面积上会读成「掉出来的黑块」)、
 * 厚底边 peek 3(大块 5,按面积比例缩)。
 */
export function iconBtnDL(s: number, faceHex: string, edgeHex: string, o: IconBtnOpts = {}): Paint[] {
  const deg = o.slantDeg ?? SLANT.button;
  const skew = skewOf(s, deg);
  return [
    { kind: "fill", hex: "#000000", a: 0.55, pts: slantQuad(s, s, skew, 2.5, -2.5) },
    // 厚底边:加高 3 的同斜率四边形下移 1.5 → 顶缘与主面齐平、底下 peek 3, 100% 实底不透明
    { kind: "fill", hex: shadeHex(faceHex, 0.45), a: 1, pts: slantQuad(s, s + 3, skewOf(s + 3, deg), 0, -1.5) },
    // 主面:纯色块实底,默认完全不透明
    { kind: "fill", hex: faceHex, a: o.faceA ?? 1.0, pts: slantQuad(s, s, skew) },
    // 顶缘高光线
    { kind: "stroke", hex: "#ffffff", a: 0.25, lw: 1, close: false, pts: [[-s / 2 + skew / 2 + 2.5, s / 2], [s / 2 + skew / 2 - 2.5, s / 2]] },
    // 提亮描边
    { kind: "stroke", hex: edgeHex, a: o.edgeA ?? 1.0, lw: 1.5, pts: slantQuad(s, s, skew) },
  ];
}

// ---------- 开关行 ----------

/**
 * 开关行:整行即按钮,开 = 实底大色块(色占满整面,不是只亮一条边),
 * 关 = 凹陷槽。右端那两道斜纹是「这一格有机关」的记号,状态本身另有文字读数。
 * 旧写法是玻璃卡 + 胶囊轨道 + 圆旋钮 —— 三个光滑件叠一行,和 P5 没有半点关系。
 */
export function toggleDL(w: number, h: number, on: boolean, faceHex: string): Paint[] {
  const out: Paint[] = on ? blockDL(w, h, faceHex, SLANT.block) : slotDL(w, h);
  const markW = 22, markX = w / 2 - markW - 44;   // 让开右端 44 的「开/关」读数位
  for (const pts of hatchPolys(markX, 0, markW, h - 16, 3)) {
    out.push({ kind: "fill", hex: on ? shadeHex(faceHex, 0.55) : C.line, a: on ? 0.95 : 1, pts });
  }
  return out;
}

/** 开关行右端「开/关」读数要占的宽度(布局方与 toggleDL 共用这一个数,别各拍各的) */
export const TOGGLE_READOUT_W = 44;

// ---------- 网点 / 印章件 ----------

export interface HalftoneOpts {
  step?: number;
  rMin?: number;
  rMax?: number;
  alpha?: number;
  hex?: string;
  cx?: number;
  cy?: number;
  /**
   * 渐变参考框:点画在小条上(标题带)时,半径仍按**整块面板**的中心距递增,
   * 那条带子才显示的是渐变的「一段」而不是被自己归一化拉平。
   */
  rampW?: number;
  rampH?: number;
}

/**
 * 网点层:半径按「离中心多远」递增(边缘大、中心小),读作印刷半调。
 * 点数有硬上限 —— 每个点是一次填充,700 点还能靠批量 fill 合成一次绘制,
 * 上千点还铺满屏就是拿中低端机的帧率开玩笑。超线就升 step(见 panel-check 红线)。
 */
export function halftoneDL(w: number, h: number, o: HalftoneOpts = {}): Paint[] {
  const step = o.step ?? HALFTONE.step;
  const rMin = o.rMin ?? HALFTONE.rMin;
  const rMax = o.rMax ?? HALFTONE.rMax;
  const hex = o.hex ?? C.paper;
  const a = o.alpha ?? HALFTONE.alpha;
  const cx = o.cx ?? 0, cy = o.cy ?? 0;
  const out: Paint[] = [];
  const cols = Math.floor(w / step), rows = Math.floor(h / step);
  const maxD = Math.hypot((o.rampW ?? w) / 2, (o.rampH ?? h) / 2) || 1;
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const x = -w / 2 + i * step + (j % 2 ? step / 2 : 0);   // 错排,才像网版而不是棋盘
      const y = -h / 2 + j * step;
      const d = Math.hypot(x, y) / maxD;
      out.push({ kind: "dot", hex, a, cx: cx + x, cy: cy + y, r: rMin + (rMax - rMin) * d });
    }
  }
  return out;
}

/** 网点数(断言红线用;与实际画出的点同一算法) */
export function halftoneCount(w: number, h: number, step: number = HALFTONE.step): number {
  return (Math.floor(w / step) + 1) * (Math.floor(h / step) + 1);
}

/** 四尖星等级:实 = 拿到,空 = 只描边(替代「三个光滑圆点」和 ★☆ 文本) */
export function starGlyphDL(cx: number, cy: number, s: number, filled: boolean, hex: string): Paint[] {
  const pts = starQuad(cx, cy, s, s * 0.34, 4, Math.PI / 2);
  return filled
    ? [{ kind: "fill", hex, a: 1, pts }]
    : [{ kind: "stroke", hex, a: 0.75, lw: 1.5, pts }];
}

export type BadgeKind = "lock" | "best" | "next" | "own";

/**
 * 状态印章:锁 / 最佳 / 下一关 / 已拥有。
 * 一律 Graphics —— 原生 Android 没有彩色 emoji 字体,🔒 在真机上是要么方框要么缺字
 * (金币那颗 🪙 当初就是因为这个换成 makeCoinIcon 的)。
 */
export function rankBadgeDL(kind: BadgeKind, s: number, hex: string, cx = 0, cy = 0): Paint[] {
  if (kind === "lock") {
    const bodyH = s * 0.62, bodyW = s * 0.92;
    const shackle: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = Math.PI * (i / 10);                       // 上半环,自采样(不碰 arc 的扫向坑)
      shackle.push([cx + Math.cos(t) * bodyW * 0.32, cy + bodyH * 0.1 + Math.sin(t) * s * 0.3]);
    }
    return [
      { kind: "stroke", hex, a: 0.9, lw: 2, close: false, pts: shackle },
      { kind: "fill", hex, a: 0.9, pts: rectQuad(bodyW, bodyH, cx, cy - s * 0.22) },
      { kind: "fill", hex: C.ink, a: 0.9, pts: rectQuad(s * 0.12, s * 0.24, cx, cy - s * 0.22) },
    ];
  }
  if (kind === "next") {
    return [{ kind: "fill", hex, a: 1, pts: [[cx - s * 0.34, cy + s * 0.42], [cx + s * 0.42, cy], [cx - s * 0.34, cy - s * 0.42]] }];
  }
  if (kind === "best") {
    return starGlyphDL(cx, cy, s * 0.55, true, hex);
  }
  // own:对勾,两段折线
  return [{
    kind: "stroke", hex, a: 1, lw: 2.4, close: false,
    pts: [[cx - s * 0.42, cy + s * 0.02], [cx - s * 0.1, cy - s * 0.34], [cx + s * 0.46, cy + s * 0.3]],
  }];
}

// ---------- 角色取色(面板层不许自己拍 hex) ----------

export interface BlockStyle { face: string; edge: string; dk: string; text: string }

/** 一个角色该长什么样:面色 + 描边 + 厚底边 + 字色(字色由亮度算,不手拍) */
export function styleOf(role: keyof typeof ROLE): BlockStyle {
  const r = ROLE[role];
  return { face: r.face, edge: r.edge, dk: r.dk, text: inkFor(r.face) };
}

/** 暗面上的正文色:亮面墨黑、暗面纸白 —— 与首页 inkOf 同一把尺 */
export const INK = INK_TEXT;

/** 网点预算检查:返回点数,调用方与 HALFTONE.maxDots 比 */
export const plateHalftoneDots = halftoneDots;
