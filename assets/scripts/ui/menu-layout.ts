// ============================================================
// 首页版式:顶栏带 → 街机标题 → 五块大色块 → 底部活动横幅 的唯一算术。
//
// 为什么提成纯函数 —— 与 activity-layout / settle-layout 同一条理由:这一屏的坐标
// 从前全手拍在 main-menu.ts 里,而它是全站唯一**跟着屏幕长宽比变**的一屏:
// 设计分辨率 FIXED_HEIGHT(高恒 540、宽随长宽比涨),16:9 是 960、20:9 是 1200。
// 手拍的那排坐标是按 960 eyeball 出来的,于是宽屏上出现用户 2026-10-07 的现场图:
//   · 竖向:色块阵底 -216 → 横幅顶 -221 只剩 5,横幅底 -265 → 屏底 -270 又只剩 5,
//     整条「活动中心」被挤到屏幕最下沿(圆角 + 手势条一压就是「被切了一半」);
//   · 横向:五块合计 915 宽,在 1200 的可视区里两侧各空 140,看着就是"一小坨沉在中间"。
// 现在整屏由 layoutMenu(可视宽, 安全区) 算出来:竖向从屏底往上推(留白 → 横幅 → 缝 →
// 色块阵 → 缝 → 标题),横向按可视宽拉伸(16:9 恒等 = 今天那一排,宽屏最多 1.25 倍,
// 刘海机/分屏窄屏最多收到 0.86 倍)。判据 menuOverlaps / menuOverflow / menuTextFits 由
// tools/menu-check.ts 在 node 下逐档长宽比断言。
//
// 三条口径(改版时钉死):
//   1) 块内件用**到块缘的固定内缩**而不是「块心偏移 × 拉伸系数」—— 块变宽时文字该贴住
//      左边距,不是跟着往中间飘;块变窄时内缩不跟着缩,才量得出「文案装不装得下」。
//   2) 色块阵**底对齐**:行高由「标题下沿 → 横幅上沿」的剩余空间算,屏底安全区变大就
//      整阵变矮(而不是把横幅顶出屏外)。
//   3) 文案宽度一律现读 textW,格子宽度由「块缘 - 内缩」算,两边同一把尺 ⇒ 出图与真机同坐标。
//
// 依赖纪律:零 cc,只 import p5-shapes 的 chip 尺子与 core/text-metrics(与 activity-layout 同规格)。
// 坐标语义:outer / title 是**屏幕局部**(原点 = 屏心);块内件(chip / name / sub / chev /
// dots / hint / claim)是**块内局部**(原点 = 该块块心)。面板把子节点挂在块节点下,
// 正好就是块内局部坐标 —— 别在面板里再加一次块心偏移。
// ============================================================
import { chipHeight, chipWidth } from "./p5-shapes";
import { textW } from "../core/text-metrics";

// ---------- 骨架数值 ----------

export const MENU = {
  /** 可视高:FIXED_HEIGHT 恒 540(半高 270 是这一屏所有竖向算术的基准) */
  screenH: 540,
  /** 顶栏徽章带:距可视顶 14,高 44 = 触控下限 */
  topPad: 14, chipH: 44,

  /** 标题衬底(不参与横向拉伸:它是 logo,宽屏上就该居中占那么大块) */
  titleW: 372, titleH: 74, titleCy: 190,
  /** 两段大字相对标题块心的 x(「嘟嘟」压左、「羽毛球」让右) */
  titleDx: [-81, 54] as const,
  /** 两段大字的字号(衬底 74 高,字 54 占得住) */
  titleSize: 54,

  /** 三带之间的最小缝:标题 → 色块阵 → 活动横幅 */
  gapTitle: 20, gapBanner: 18,
  /** 横幅到屏底的留白(不含安全区)。旧值 = 5,就是「被挤到下面去了」的那一刀 */
  bottomMargin: 18,
  /** 内容外缘到可视边缘的最小留白(不含安全区):960 屏上算出的 f 吸附到 1 */
  edgeMin: 8,

  /** 基准列宽(960 那一排):hero + 缝 + 两列小块 + 缝 = 915 */
  heroW: 316, smallW: 282, gapHero: 11, gapCol: 24,
  /** 行高上限 = 基准 150;下限 126(屏底安全区很大时整阵变矮,不再往下顶) */
  rowHMax: 150, rowHMin: 126, rowGap: 21,
  /** 底部活动横幅高(44 是触控下限,46 给斜切与角签留呼吸) */
  bannerH: 46,

  /** 横向拉伸系数上下限:1.25 = 折叠屏外屏封顶,0.86 = 刘海机/分屏收瘦 */
  fitMin: 0.86, fitMax: 1.25,
} as const;

/** 基准内容半宽 = 457.5(915 那一排的一半) */
export const BASE_HALF = (MENU.heroW + MENU.gapHero + MENU.smallW * 2 + MENU.gapCol) / 2;

/** 字号:面板建 Label 与判据量宽共用同一批数,别在两处各写一遍 */
export const MENU_SIZE = {
  heroChip: 10, heroName: 44, heroLine: 12, heroHint: 10,
  chip: 9, name: 22, sub: 11,
  bannerChip: 9, bannerName: 18, bannerSub: 12, claimChip: 10,
} as const;

/** 静态文案:面板与判据共用同一串,量宽才不会被改出两份 */
export const MENU_TEXT = {
  title: ["嘟嘟", "羽毛球"] as const,
  hero: { tag: "MATCH", name: "对练", line: "四档难度 · 选球馆 · 随时开局", hint: "EASY / NORMAL / HARD / EXPERT" },
  /** 右列四块 [节点名 key, 角签, 名称, 副行](副行空串 = 不建 Label) */
  entries: [
    { key: "campaign", tag: "CHALLENGE", name: "闯关模式", sub: "" },
    { key: "endless", tag: "ENDLESS", name: "无限练习", sub: "无视比分 · 持续对拉" },
    { key: "drill", tag: "TRAIN", name: "专项训练", sub: "" },
    { key: "career", tag: "CAREER", name: "生涯与商店", sub: "" },
  ] as const,
  banner: { tag: "EVENT", name: "活动中心", sub: "完成任务领金币 · 每天 0 点刷新" },
} as const;

/** 横幅副行「有可领」那一支:格式只有一个出口,面板与量宽判据读同一份 */
export function bannerSubClaimable(dailyDone: number, dailyTotal: number, weeklyDone: number, weeklyTotal: number): string {
  return `今日 ${dailyDone}/${dailyTotal} · 每周 ${weeklyDone}/${weeklyTotal}`;
}

/** 判据用的最宽样本(个位数读数 + 全角分隔) */
export const BANNER_SUB_CLAIMABLE = bannerSubClaimable(9, 9, 9, 9);

// ---------- 块内内缩(到块缘的固定值,不随拉伸系数变) ----------

/** hero:角签/箭标钉上下缘,三条文字钉左缘。竖值 = 到块上缘的距离 */
export const HERO_PAD = {
  chipCx: 56,        // 角签块心 ← 块左缘
  nameL: 18,         // 名称左缘 ← 块左缘
  lineL: 54, lineR: 30,   // 说明行 / 难度行的左右内缩
  dotsL: 6,          // 四档色点行左缘
  chipTop: 39, nameTop: 91, lineTop: 141, dotsTop: 187, hintTop: 223,
  chevR: 46, chevBot: 41,
} as const;

/** 右列小块:角签 + 名称 + 副行 + 箭标(竖值 = 到块心的距离) */
export const ENTRY_PAD = {
  chipCx: 37, left: 37, right: 39, chevR: 29,
  chipCy: 46, nameCy: 10, subCy: -34, chevCy: -8,
} as const;

/** 底部横幅:角签 + 名称 + 副行(接名称右缘)+ 可领角签 + 箭标,全在行心一条线上 */
export const BANNER_PAD = {
  chipCx: 33.5, nameL: 65.5, subGap: 40, claimR: 127.5, chevR: 28.5,
  subRight: 12,   // 副行右缘到可领角签左缘的缝
} as const;

// ---------- 包围盒 ----------

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;
export const width = (b: Box): number => b.right - b.left;
export const center = (b: Box): number => (b.left + b.right) / 2;

export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}
/** 由中心点建盒(角签/箭标/整块这类「节点即中心」的件) */
export function cbox(cx: number, cy: number, w: number, h: number): Box {
  return box(cx - w / 2, w, cy, h);
}

export interface BlockLayout {
    /** 屏幕局部(原点 = 屏心) */
    outer: Box;
    /** 以下为块内局部(原点 = 块心) */
    chip: Box;
    name: Box;
    line: Box | null;
    chev: Box;
}
export interface HeroLayout extends BlockLayout { dots: Box; hint: Box }
export interface BannerLayout extends BlockLayout { claim: Box }

export interface MenuLayout {
  /** 可视宽(设计单位)与横向拉伸系数 */
  visW: number; f: number;
  /** 内容半宽(五块那一排的左右外缘) */
  half: number;
  title: Box;
  hero: HeroLayout;
  /** [闯关, 无限, 专项, 生涯] */
  entries: BlockLayout[];
  banner: BannerLayout;
  /** 实测留白(给日志与出图看的读数;判据一律现读几何,不读这两个数) */
  margin: { bottom: number; edge: number };
  /** 参与本次排版的安全内缩(判据据此复核 margin.edge 没被另算一份) */
  safe: { x: number; bottom: number };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------- 排版 ----------

export interface MenuInput {
  /** 可视宽(设计单位;FIXED_HEIGHT 下 = 540 × 屏幕长宽比) */
  visW: number;
  /** 左右安全内缩:整排居中 ⇒ 取两侧较大者,不会被刘海啃掉半块 */
  safeX?: number;
  /** 屏底安全内缩 */
  safeBottom?: number;
}

/** 横向拉伸系数:16:9 恒等(±2% 内直接吸附到 1),宽屏最多 1.25,窄屏收到 0.86 */
export function menuFit(visW: number, safeX: number): number {
  const raw = (visW / 2 - safeX - MENU.edgeMin) / BASE_HALF;
  const f = clamp(raw, MENU.fitMin, MENU.fitMax);
  return Math.abs(f - 1) < 0.02 ? 1 : f;
}

export function layoutMenu(input: MenuInput): MenuLayout {
  const safeX = input.safeX ?? 14;
  const safeBottom = input.safeBottom ?? 0;
  const visW = input.visW;
  const f = menuFit(visW, safeX);
  const half = MENU.screenH / 2;

  // ---- 竖向:从屏底往上推(留白 → 横幅 → 缝 → 色块阵 → 缝 → 标题) ----
  const bannerBottom = -half + MENU.bottomMargin + safeBottom;
  const bannerCy = bannerBottom + MENU.bannerH / 2;
  const gridBottom = bannerBottom + MENU.bannerH + MENU.gapBanner;
  const maxGridTop = (MENU.titleCy - MENU.titleH / 2) - MENU.gapTitle;
  const rowH = clamp((maxGridTop - gridBottom - MENU.rowGap) / 2, MENU.rowHMin, MENU.rowHMax);
  const gridH = rowH * 2 + MENU.rowGap;
  const gridTop = Math.min(maxGridTop, gridBottom + gridH);

  // ---- 横向:整排按 f 拉伸,块内件按固定内缩贴块缘 ----
  const heroW = MENU.heroW * f, smallW = MENU.smallW * f;
  const gapHero = MENU.gapHero * f, gapCol = MENU.gapCol * f;
  const rowHalf = (heroW + gapHero + smallW * 2 + gapCol) / 2;
  const heroCx = -rowHalf + heroW / 2;
  const colCx = [
    -rowHalf + heroW + gapHero + smallW / 2,
    -rowHalf + heroW + gapHero + smallW + gapCol + smallW / 2,
  ];

  const title = cbox(0, MENU.titleCy, MENU.titleW, MENU.titleH);

  // hero(整柱):角签贴块顶、箭标贴块底,三条文字贴块左缘
  const hOuter = cbox(heroCx, gridBottom + gridH / 2, heroW, gridH);
  const hL = -heroW / 2, hR = heroW / 2, hT = gridH / 2;
  const hero: HeroLayout = {
    outer: hOuter,
    chip: cbox(hL + HERO_PAD.chipCx, hT - HERO_PAD.chipTop,
      chipWidth(MENU_TEXT.hero.tag, MENU_SIZE.heroChip), chipHeight(MENU_SIZE.heroChip)),
    name: box(hL + HERO_PAD.nameL, textW(MENU_TEXT.hero.name, MENU_SIZE.heroName),
      hT - HERO_PAD.nameTop, MENU_SIZE.heroName * 1.22),
    line: box(hL + HERO_PAD.lineL, (hR - HERO_PAD.lineR) - (hL + HERO_PAD.lineL),
      hT - HERO_PAD.lineTop, MENU_SIZE.heroLine * 1.35),
    dots: box(hL + HERO_PAD.dotsL, 128, hT - HERO_PAD.dotsTop, 14),
    hint: box(hL + HERO_PAD.lineL, (hR - HERO_PAD.lineR) - (hL + HERO_PAD.lineL),
      hT - HERO_PAD.hintTop, MENU_SIZE.heroHint * 1.35),
    chev: cbox(hR - HERO_PAD.chevR, -hT + HERO_PAD.chevBot, 30, 15),
  };

  // 右列 2×2:前两格贴阵顶,后两格贴阵底
  const entries: BlockLayout[] = MENU_TEXT.entries.map((e, i) => {
    const cy = i < 2 ? gridTop - rowH / 2 : gridBottom + rowH / 2;
    const L = -smallW / 2, R = smallW / 2;
    return {
      outer: cbox(colCx[i % 2], cy, smallW, rowH),
      chip: cbox(L + ENTRY_PAD.chipCx, ENTRY_PAD.chipCy,
        chipWidth(e.tag, MENU_SIZE.chip), chipHeight(MENU_SIZE.chip)),
      name: box(L + ENTRY_PAD.left, textW(e.name, MENU_SIZE.name), ENTRY_PAD.nameCy, MENU_SIZE.name * 1.22),
      line: e.sub ? box(L + ENTRY_PAD.left, (R - ENTRY_PAD.right) - (L + ENTRY_PAD.left),
        ENTRY_PAD.subCy, MENU_SIZE.sub * 1.35) : null,
      chev: cbox(R - ENTRY_PAD.chevR, ENTRY_PAD.chevCy, 24, 12),
    };
  });

  // 底部活动横幅:一行五件,全在行心那条线上
  const bW = rowHalf * 2;
  const bL = -bW / 2, bR = bW / 2;
  const bName = box(bL + BANNER_PAD.nameL, textW(MENU_TEXT.banner.name, MENU_SIZE.bannerName),
    0, MENU_SIZE.bannerName * 1.22);
  const claim = cbox(bR - BANNER_PAD.claimR, 0,
    chipWidth("9 项可领", MENU_SIZE.claimChip), chipHeight(MENU_SIZE.claimChip));
  const subLeft = bName.right + BANNER_PAD.subGap;
  const banner: BannerLayout = {
    outer: cbox(0, bannerCy, bW, MENU.bannerH),
    chip: cbox(bL + BANNER_PAD.chipCx, 0,
      chipWidth(MENU_TEXT.banner.tag, MENU_SIZE.bannerChip), chipHeight(MENU_SIZE.bannerChip)),
    name: bName,
    line: box(subLeft, claim.left - BANNER_PAD.subRight - subLeft, 0, MENU_SIZE.bannerSub * 1.35),
    chev: cbox(bR - BANNER_PAD.chevR, 0, 24, 12),
    claim,
  };

  return {
    visW, f, half: rowHalf, title, hero, entries, banner,
    margin: { bottom: bannerBottom + half, edge: visW / 2 - safeX - rowHalf },
    safe: { x: safeX, bottom: safeBottom },
  };
}

// ---------- 判据(check 在 node 下跑) ----------

const EPS = 0.5;

function overlapX(a: Box, b: Box): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS;
}

/** 两个盒子是否压在一起(x、y 都相交才算真压字) */
export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && Math.min(top(a), top(b)) - Math.max(bottom(a), bottom(b)) > EPS;
}

/** 块内件 → 屏幕局部(块内件的原点是块心,换算一跳才能跨块比) */
export function toScreen(outer: Box, p: Box): Box {
  return box(center(outer) + p.left, width(p), outer.cy + p.cy, p.h);
}

/** 一块的全部件(带人话名字,判据报错直接指到格) */
export function partsOf(b: BlockLayout): Array<[Box, string]> {
  const out: Array<[Box, string]> = [[b.chip, "角签"], [b.name, "名称"], [b.chev, "箭标"]];
  if (b.line) out.push([b.line, "副行"]);
  const h = (b as HeroLayout).hint;
  if (h) out.push([(b as HeroLayout).dots, "色点行"], [h, "难度行"]);
  const c = (b as BannerLayout).claim;
  if (c) out.push([c, "可领角签"]);
  return out;
}

export function blockName(b: BlockLayout): string {
  if ((b as HeroLayout).hint) return "hero";
  if ((b as BannerLayout).claim) return "横幅";
  return b.name.left.toFixed(0) + " 小块";
}

/** 块与块、块内件与件:互不压 */
export function menuOverlaps(L: MenuLayout): string[] {
  const out: string[] = [];
  const blocks: BlockLayout[] = [L.hero, ...L.entries, L.banner];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (boxesOverlap(blocks[i].outer, blocks[j].outer)) {
        out.push(`${blockName(blocks[i])} 压住 ${blockName(blocks[j])}`);
      }
    }
  }
  if (boxesOverlap(L.title, L.hero.outer)) out.push("标题压住色块阵");
  for (const b of blocks) {
    const ps = partsOf(b);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        if (boxesOverlap(toScreen(b.outer, ps[i][0]), toScreen(b.outer, ps[j][0]))) {
          out.push(`${blockName(b)}:${ps[i][1]} 压住 ${ps[j][1]}`);
        }
      }
    }
  }
  return out;
}

/**
 * 溢出与节奏:块不出可视区、块内件不出块缘,外加三条**竖向缝**判据 ——
 * 最后这三条就是用户现场图的那一刀(旧排版屏底留白 5、色块阵与横幅缝 5)。
 */
export function menuOverflow(L: MenuLayout): string[] {
  const out: string[] = [];
  const half = MENU.screenH / 2;
  const visHalf = L.visW / 2;
  const blocks: Array<[Box, string]> = [
    [L.title, "标题"], [L.hero.outer, "hero"],
    ...L.entries.map((e, i): [Box, string] => [e.outer, `小块${i}`]),
    [L.banner.outer, "横幅"],
  ];
  for (const [b, nm] of blocks) {
    if (b.left < -visHalf - EPS || b.right > visHalf + EPS) out.push(`${nm} 越出可视区左右缘`);
    if (top(b) > half + EPS || bottom(b) < -half - EPS) out.push(`${nm} 越出可视区上下缘`);
  }
  for (const b of [L.hero as BlockLayout, ...L.entries, L.banner as BlockLayout]) {
    const hw = width(b.outer) / 2, hh = b.outer.h / 2;
    for (const [p, nm] of partsOf(b)) {
      if (p.left < -hw - EPS || p.right > hw + EPS) out.push(`${blockName(b)}:${nm} 越出块左右缘`);
      if (top(p) > hh + EPS || bottom(p) < -hh - EPS) out.push(`${blockName(b)}:${nm} 越出块上下缘`);
    }
  }
  // 竖向节奏:这三条就是用户现场图的判据(旧排版屏底留白 5、横幅与色块阵缝 5)。
  // **一律现读几何**,不读 margin.* 那两个数 —— 字段会撒谎,盒子不会。
  const bottomGap = bottom(L.banner.outer) + half;
  if (bottomGap < MENU.bottomMargin - EPS) out.push(`横幅贴屏底:留白 ${bottomGap.toFixed(1)} < ${MENU.bottomMargin}`);
  if (Math.abs(bottomGap - L.margin.bottom) > 0.51) out.push(`margin.bottom ${L.margin.bottom.toFixed(1)} 与横幅盒子对不上(留白被另算了一份)`);
  const gapBanner = bottom(L.hero.outer) - top(L.banner.outer);
  if (gapBanner < MENU.gapBanner - EPS) out.push(`色块阵与横幅的缝 ${gapBanner.toFixed(1)} < ${MENU.gapBanner}`);
  const gapTitle = bottom(L.title) - top(L.hero.outer);
  if (gapTitle < MENU.gapTitle - EPS) out.push(`标题与色块阵的缝 ${gapTitle.toFixed(1)} < ${MENU.gapTitle}`);
  const edge = visHalf - L.half;
  if (edge < MENU.edgeMin - EPS && L.f < MENU.fitMax) out.push(`内容外缘留白 ${edge.toFixed(1)} < ${MENU.edgeMin}`);
  if (Math.abs(edge - L.margin.edge - L.safe.x) > 0.51) out.push(`margin.edge ${L.margin.edge.toFixed(1)} 与内容半宽对不上`);
  return out;
}

/**
 * 文案量宽:真文案必须塞进格子(格子宽由块缘算,拉伸/收瘦都逃不过这条)。
 * 「压字」不在这里判 —— 那是 menuOverlaps 的活(它按 x+y 双向判,块内件换算一跳)。
 */
export function menuTextFits(L: MenuLayout, bannerSub: string = MENU_TEXT.banner.sub): string[] {
  const out: string[] = [];
  const push = (cond: boolean, msg: string): void => { if (cond) out.push(msg); };
  const hero = L.hero;
  push(textW(MENU_TEXT.hero.name, MENU_SIZE.heroName) > width(hero.name), "hero 名称放不下");
  push(textW(MENU_TEXT.hero.line, MENU_SIZE.heroLine) > width(hero.line!), `hero 说明放不下:${MENU_TEXT.hero.line}`);
  push(textW(MENU_TEXT.hero.hint, MENU_SIZE.heroHint) > width(hero.hint), `hero 难度行放不下:${MENU_TEXT.hero.hint}`);
  L.entries.forEach((e, i) => {
    const t = MENU_TEXT.entries[i];
    push(textW(t.name, MENU_SIZE.name) > width(e.name), `小块${i} 名称放不下:${t.name}`);
    if (e.line) push(textW(t.sub, MENU_SIZE.sub) > width(e.line), `小块${i} 副行放不下:${t.sub}`);
    push(e.name.right > e.chev.left - 6, `小块${i} 名称压住箭标`);
  });
  const b = L.banner;
  push(textW(MENU_TEXT.banner.name, MENU_SIZE.bannerName) > width(b.name), "横幅名称放不下");
  push(textW(bannerSub, MENU_SIZE.bannerSub) > width(b.line!), `横幅副行放不下:${bannerSub}`);
  push(b.name.right > b.line!.left, "横幅名称压住副行");
  push(b.line!.right > b.claim.left, "横幅副行压住可领角签");
  return out;
}

/** 触控下限:整块即按钮的入口,高不得小于 44 */
export function menuTouchFits(L: MenuLayout): string[] {
  const out: string[] = [];
  if (L.hero.outer.h < 44) out.push(`hero 高 ${L.hero.outer.h.toFixed(0)} 不足触控下限 44`);
  L.entries.forEach((e, i) => { if (e.outer.h < 44) out.push(`小块${i} 高 ${e.outer.h.toFixed(0)} 不足 44`); });
  if (L.banner.outer.h < 44) out.push(`横幅高 ${L.banner.outer.h.toFixed(0)} 不足触控下限 44`);
  return out;
}

/** 一屏的全部判据(check 与 preview 共用,出图上印的就是这四个字) */
export function menuJudges(L: MenuLayout): string[] {
  return [
    ...menuOverlaps(L), ...menuOverflow(L),
    ...menuTextFits(L), ...menuTextFits(L, BANNER_SUB_CLAIMABLE), ...menuTouchFits(L),
  ];
}
