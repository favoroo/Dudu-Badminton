// ============================================================
// 结算屏竖排排版 (Settle Layout) —— 纯函数、零 cc 依赖
//
// 为什么要单独一个文件:这一屏自上而下有八块东西(大标语衬底 / 比分 / 荣誉胶囊 /
// 六格战报 / 奖励三行 / 升级与上新 / 关卡目标逐条 / 行动钮 + 下一关小字),
// 而**每一块都是「有时才在场」**:训练场没有荣誉胶囊也没有关卡目标,2p 友谊赛不发奖励,
// 「下一关是什么玩法」那行小字只在闯关通关时出现,升级与新品上架两条都可能没有。
//
// 旧写法把这些块的 y 全钉成构造函数里的常量(158 / 124 / 76 / -34 / -56 / -82 / -118 /
// -150 / -190),于是「这一块在不在场、它有多高」和「下一块摆在哪」没有任何关系。
// 用户 2026-10-06 那张现场图就是这么坏出来的,两处叠在一起:
//   ① 0.0.28 给大标语加了 88 高的斩劈红衬底(占卡片 154~242),而比分 Label 还钉在 158
//      —— 「21 : 19」整串压在红纸背后,只露出下半截;
//   ② 行动钮在「有下一关小字」时整排上抬 12(按钮顶缘因此到了 -152),而关卡目标那行
//      钉在 -150 —— 三条 ★ 判据被按钮切掉半截,恰好是玩家最该看清的那一行。
// 两处都不崩、不报错,出图脚本里也看不见(要真机打一局、闯关通关才有),所以只有排版
// 判据能钉住 —— 与战前简报「全部都显示到外面去了」是同一族病。
//
// 现在的口径:**块高由内容算,块间距由剩余空间摊派**,在场与否只改变块数、不留下
// 悬空常量。于是「不压字、不出卡片」是排版性质,不是对某一套文案的假设。
// 全场景组合在 node 下回归:tools/settle-layout-check.ts(--selftest 拿上面那两套
// 旧坐标当反例,必须被点名)。
//
// ⚠ 版式常量放这儿、不放 core/config.ts:仓库的实际分工是「游戏数值进 CFG,视觉
// token 跟着消费者走」(ARCADE / PAL / BRIEF / SK / SD 都在各自模块里)。
// ============================================================
import { textW, type Measure } from "../core/text-metrics";

/**
 * 结算屏的排版度量 —— 面板(settle-panel)与闸门(settle-layout-check)共用这一份,
 * 不会各算各的算歪。坐标一律以**卡片中心**为原点、UI 本地 y 朝上。
 */
export const SETTLE = {
  /** 卡片:比旧的 490 高 10 —— 那 10 不是"更气派",是七块全在场时(通关 + 两条新闻 +
   *  三条目标 + 下一关小字)摊派缝还要够得着下限 6 的唯一来路。
   *  上限由屏幕卡死:cardH/2 + cardY ≤ screenH/2 - screenMargin,闸门 §2 逐条量。 */
  cardW: 560, cardH: 500,
  /** 卡片在 ui-root 里的 y(标语舞台在 root 里,要经它换算) */
  cardY: 2,
  /** 可视高(FIXED_HEIGHT 恒 540)与卡片到屏幕上下缘的最小留白 */
  screenH: 540, screenMargin: 16,

  /** 大标语衬底:斜切块 + 向下探的硬阴影。阴影是暗色装饰,占位连着它一起算,
   *  但**不拿它去量比分** —— 比分的盒子从衬底实色下缘起算。
   *  78 = 42 号标题的字高(uiLabel 的 lineHeight = round(size × 1.22) = 51)上下各 13。 */
  bandW: 470, bandH: 78, bandShadow: 7,
  verdictSize: 42,

  /** 比分(比赛)与关卡名+星(训练)共用头部第一格,同屏只亮一个。
   *  scoreH 42 = 34 号字的 lineHeight;自带的 3px 硬阴影是暗色装饰,不另占位。 */
  scoreSize: 34, scoreH: 42,
  subSize: 15, subH: 22,
  badgeSize: 13, badgeH: 26,
  /** 比分与荣誉胶囊是一对,同处「头部」这一块:它们之间的缝不参与摊派 */
  headGap: 4,

  /** 六格战报:3 列 2 行,行高 = cellH,行缝 = cellGap */
  cellW: 168, cellH: 48, cellGap: 8, statCols: 3, statRows: 2,

  /** 奖励三行:金币大数 / 来源明细 / 经验条(Lv 标与条同高)。
   *  两个文字高度全是对应字号的 lineHeight(17→21 / 12→15),条子本身 14 高。
   *  lvX / barX 是这一行的两个横位(都是节点中心,不是左缘):lvX = -cardW/2 + 44
   *  把「Lv.4」贴在左内缘,经验槽以 barX 为中心、宽 barW 横过去。 */
  coinSize: 17, coinH: 21,
  bonusSize: 12, bonusH: 15,
  barW: 320, barH: 14, barX: 24, lvX: -236, lvSize: 14,
  rewardGap1: 3, rewardGap2: 2,

  /** 升级 / 新品上架:一行一条,最多两条(再多就该改面板高度,不是继续压缝) */
  newsSize: 14, newsLineH: 18, newsMaxLines: 2,

  /** 关卡目标逐条:三条横排「★1 取胜」,整行只有 Label 没有底块 */
  objSize: 12, objH: 15, objGap: 14, objPadX: 40, objWPad: 2,

  /** 行动钮:高度按 uiButton 的实际占位(52 + 硬阴影 4),宽度按实测文案量 */
  btnH: 52, btnShadow: 4, btnGap: 14, btnPad: 46, btnMaxW: 300,
  /** 三颗以上时单颗的下限(两颗时给 240,让主钮站得住);缩到下限仍挤不进卡宽就报溢出 */
  btnMinWide: 128, btnMinPair: 240, btnFloor: 112, btnPadX: 32,
  captionSize: 12, captionH: 15,
  /** 按钮与它下面那行小字之间的缝(小字排在按钮阴影之下) */
  actionGap: 4,

  /** 摊派缝的上下限:低于 minGap 就是这套块塞不进当前卡片,闸门判红 */
  minGap: 6, maxGap: 16,
} as const;

/** 一屏结算里「有时才在场」的东西 —— 排版只认这几个开关,不认具体文案 */
export interface SettleFlags {
  /** true = 比赛(亮比分 21:19);false = 训练场(亮关卡名 + 星) */
  match: boolean;
  /** 荣誉称号胶囊:比赛模式才有 */
  badge: boolean;
  /** 奖励三行:2p 友谊赛不发奖励时整块缺席 */
  rewards: boolean;
  /** 升级 + 新品上架:实际行数 0~2 */
  newsLines: number;
  /** 关卡目标逐条:闯关才有(0 = 不在场) */
  conds: number;
  /** 行动钮下方那行小字:「下一关是什么玩法」/ 全通说明 */
  caption: boolean;
}

/** 一个会画出来的东西的竖直盒子(卡片中心为原点) */
export interface SettleItem {
  key: string;
  cy: number;
  h: number;
  top: number;
  bottom: number;
}

export interface SettleBlock {
  key: string;
  h: number;
  top: number;
  bottom: number;
}

export interface SettleLayout {
  cardW: number;
  cardH: number;
  /** 块间实际摊到的缝(判据要报它,别让人对着常量猜) */
  gap: number;
  /** 自上而下的块 */
  blocks: SettleBlock[];
  /** 每一个会画出来的东西的盒子 —— 闸门拿它做「互不压」的成对判据 */
  items: SettleItem[];
  /** 各元素的中心 y(渲染层照这个摆节点) */
  y: Record<string, number>;
  /** 满足 minGap 所需的卡片高度;> cardH 就是排版不够用 */
  needH: number;
  /** 整组到卡片上下缘的边距 —— 两条必须等宽,否则就是"内容偏下、下面空一块" */
  marginTop: number;
  marginBottom: number;
}

// ---------- 块高 ----------

export function statsH(rows: number = SETTLE.statRows): number {
  return rows * SETTLE.cellH + (rows - 1) * SETTLE.cellGap;
}

export function headH(f: SettleFlags): number {
  return (f.match ? SETTLE.scoreH : SETTLE.subH) + (f.badge ? SETTLE.headGap + SETTLE.badgeH : 0);
}

export function rewardsH(): number {
  return SETTLE.coinH + SETTLE.rewardGap1 + SETTLE.bonusH + SETTLE.rewardGap2 + SETTLE.barH;
}

export function newsH(lines: number): number {
  return Math.max(0, Math.min(SETTLE.newsMaxLines, lines)) * SETTLE.newsLineH;
}

export function actionsH(caption: boolean): number {
  return SETTLE.btnH + SETTLE.btnShadow + (caption ? SETTLE.actionGap + SETTLE.captionH : 0);
}

/** 自上而下的在场块。块数随场景变,坐标不留常量 —— 这是整份排版的立足点 */
export function settleBlocks(f: SettleFlags): Array<{ key: string; h: number }> {
  const b: Array<{ key: string; h: number }> = [
    { key: "verdict", h: SETTLE.bandH + SETTLE.bandShadow },
    { key: "head", h: headH(f) },
    { key: "stats", h: statsH() },
  ];
  if (f.rewards) b.push({ key: "rewards", h: rewardsH() });
  if (f.newsLines > 0) b.push({ key: "news", h: newsH(f.newsLines) });
  if (f.conds > 0) b.push({ key: "obj", h: SETTLE.objH });
  b.push({ key: "actions", h: actionsH(f.caption) });
  return b;
}

// ---------- 摊派 ----------

/**
 * 剩余空间平摊成「n 块 + 上下两条边距」的等距缝:
 *   · 摊得开 → 缝 = 剩余/(n+1),封顶 maxGap(缝拉到 16 就不再撑,整组居中,
 *     否则训练场那种只有五块的场景会被拉成一条一条的飘字);
 *   · 摊不开 → 缝照算,由 needH > cardH 判红,不静默压成重叠。
 */
export function settleLayout(f: SettleFlags): SettleLayout {
  const blocks = settleBlocks(f);
  const sum = blocks.reduce((s, b) => s + b.h, 0);
  const even = (SETTLE.cardH - sum) / (blocks.length + 1);
  const gap = Math.min(SETTLE.maxGap, even);
  // 未封顶:缝 = 剩余/(n+1),上下边距与缝等宽,整组正好铺满卡片。
  // 封顶:整组只占 sum+(n+1)×maxGap,剩下的差额**平分给上下两条边距**(不是留给缝),
  // 所以起点要先把上边距扣掉 —— 少扣这一笔就是"内容偏下、下面空一大块"(出图肉眼看到的)。
  const stackH = sum + (blocks.length + 1) * gap;
  let cursor = even >= SETTLE.maxGap ? stackH / 2 - gap : SETTLE.cardH / 2 - gap;

  const items: SettleItem[] = [];
  const slot: Record<string, number> = {};
  const laid: SettleBlock[] = [];
  const put = (key: string, top: number, h: number): SettleItem => {
    const it: SettleItem = { key, h, top, bottom: top - h, cy: top - h / 2 };
    items.push(it);
    slot[key] = it.cy;
    return it;
  };

  for (const b of blocks) {
    const top = cursor;
    cursor -= b.h;
    laid.push({ key: b.key, h: b.h, top, bottom: cursor });
    cursor -= gap;

    // 块内不再另起游标:每一格从上一格的下缘往下串(put 返回它的盒子),
    // 所以「这一格离上一格多远」只有一个来源 —— 常量里那几个 *Gap。
    switch (b.key) {
      case "verdict": {
        // 块顶 = 阴影顶,衬底实色从块顶往下 bandH;阴影那 bandShadow 归到缝里
        put("verdict", top, SETTLE.bandH);
        break;
      }
      case "head": {
        const first = put(f.match ? "score" : "sub", top, f.match ? SETTLE.scoreH : SETTLE.subH);
        if (f.badge) put("badge", first.bottom - SETTLE.headGap, SETTLE.badgeH);
        break;
      }
      case "stats": {
        for (let r = 0; r < SETTLE.statRows; r++) {
          put(`stat${r}`, top - r * (SETTLE.cellH + SETTLE.cellGap), SETTLE.cellH);
        }
        break;
      }
      case "rewards": {
        const coin = put("coin", top, SETTLE.coinH);
        const bonus = put("bonus", coin.bottom - SETTLE.rewardGap1, SETTLE.bonusH);
        put("bar", bonus.bottom - SETTLE.rewardGap2, SETTLE.barH);
        break;
      }
      case "news": {
        put("news", top, b.h);
        break;
      }
      case "obj": {
        put("obj", top, SETTLE.objH);
        break;
      }
      case "actions": {
        const btn = put("buttons", top, SETTLE.btnH);
        if (f.caption) put("caption", btn.bottom - SETTLE.btnShadow - SETTLE.actionGap, SETTLE.captionH);
        break;
      }
    }
  }

  // 缺席那一格的坐标读数也要有(渲染层照摆,不做条件判断):跟着它上面最近一格的
  // 位置走 —— 空文案 / active=false 画不出任何东西,但坐标不会是 undefined。
  // 顺序 = 自上而下的视觉顺序,所以「比分」与「训练关卡名」这两选一时,后写的那个
  // 拿到前一个的槽位(它们本来就共用同一格)。
  const y: Record<string, number> = {};
  let last = 0;
  for (const k of ["verdict", "score", "sub", "badge", "stat0", "stat1",
    "coin", "bonus", "bar", "news", "obj", "buttons", "caption"]) {
    const v = slot[k];
    if (v !== undefined) { y[k] = v; last = v; } else y[k] = last;
  }

  return {
    cardW: SETTLE.cardW, cardH: SETTLE.cardH, gap, blocks: laid, items, y,
    needH: sum + (blocks.length + 1) * SETTLE.minGap,
    marginTop: SETTLE.cardH / 2 - laid[0].top,
    marginBottom: SETTLE.cardH / 2 + laid[laid.length - 1].bottom,
  };
}

// ---------- 判据 ----------

const EPS = 0.01;

/**
 * 压字:任意两个元素的竖直盒子相交(这一屏每块都是通宽横排,竖直相交即视觉相撞)。
 * 单独收出来是为了让闸门能拿**人造盒子**当反例跑 --selftest,不必改真排版。
 */
export function itemsCollide(items: SettleItem[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      const oy = Math.min(A.top, B.top) - Math.max(A.bottom, B.bottom);
      if (oy > EPS) out.push(`${A.key} × ${B.key}(纵向压 ${oy.toFixed(1)}px)`);
    }
  }
  return out;
}

/** 一套盒子摆进多高的卡片里(反例用) */
export function fakeItems(key: string, cy: number, h: number): SettleItem {
  return { key, cy, h, top: cy + h / 2, bottom: cy - h / 2 };
}

/** 压字(排版版):拿真排版算出来的盒子互比 */
export function settleCollisions(L: SettleLayout): string[] {
  return itemsCollide(L.items);
}

/**
 * 居中:整组到卡片上下缘的边距必须等宽。
 * 不等宽不会压字、不会出框,只会"看着往下坠"—— 数值判据里最容易漏的那一类,
 * 所以单独一条,让闸门和反例都能点名。
 */
export function settleCentering(L: SettleLayout): string[] {
  const d = L.marginTop - L.marginBottom;
  return Math.abs(d) > 0.5
    ? [`上下边距不等宽(上 ${L.marginTop.toFixed(1)} / 下 ${L.marginBottom.toFixed(1)},差 ${d.toFixed(1)} → 整组${d > 0 ? "偏上" : "偏下"}坠)`]
    : [];
}

/** 溢出:任何一块探出卡片;卡片本身探出屏幕 */
export function settleOverflow(L: SettleLayout): string[] {
  const bad: string[] = [];
  const half = L.cardH / 2;
  for (const it of L.items) {
    if (it.top > half + EPS) bad.push(`${it.key}:上缘 ${it.top.toFixed(1)} 越过卡片上界 ${half}`);
    if (it.bottom < -half - EPS) bad.push(`${it.key}:下缘 ${it.bottom.toFixed(1)} 越过卡片下界 ${-half}`);
  }
  if (L.needH > L.cardH + EPS) bad.push(`needH ${L.needH.toFixed(1)} > 卡高 ${L.cardH}:这套块塞不进当前卡片(缝会被压到 ${L.gap.toFixed(1)})`);
  if (L.marginTop < -EPS) bad.push(`整组上缘探出卡片 ${(-L.marginTop).toFixed(1)}`);
  if (L.marginBottom < -EPS) bad.push(`整组下缘探出卡片 ${(-L.marginBottom).toFixed(1)}`);
  const m = SETTLE.screenMargin;
  const top = L.cardH / 2 + SETTLE.cardY, bot = SETTLE.cardY - L.cardH / 2;
  if (top > SETTLE.screenH / 2 - m) bad.push(`卡片上缘 ${top.toFixed(1)} 离屏幕顶不足 ${m}`);
  if (bot < -SETTLE.screenH / 2 + m) bad.push(`卡片下缘 ${bot.toFixed(1)} 离屏幕底不足 ${m}`);
  return bad;
}

/** 标语舞台在 root 里的 y:衬底画在 cine 层(压在卡片之上),要经 cardY 换算回去 */
export function stageY(L: SettleLayout): number {
  return L.y.verdict + SETTLE.cardY;
}

// ---------- 横排:行动钮那一排 ----------

export interface ActLike { text: string; size: number }

/**
 * 三颗(或两颗)行动钮的宽度:按实测文案量、整排超宽再等比缩回卡片内。
 * 从前这段算术住在 settle-panel 里,于是「第 20 关的长关名会不会把整排挤出卡片」
 * 没有任何地方量过 —— 搬进来才钉得住。
 */
export function actionWidths(acts: ActLike[], measure: Measure = textW): number[] {
  const n = acts.length;
  const minOne = n >= 3 ? SETTLE.btnMinWide : SETTLE.btnMinPair;
  const w = acts.map((a) => Math.min(SETTLE.btnMaxW, Math.max(minOne, Math.round(measure(a.text, a.size) + SETTLE.btnPad))));
  const total = () => w.reduce((s, x) => s + x, 0) + SETTLE.btnGap * (n - 1);
  if (total() > SETTLE.cardW - SETTLE.btnPadX) {
    const k = (SETTLE.cardW - SETTLE.btnPadX - SETTLE.btnGap * (n - 1)) / w.reduce((s, x) => s + x, 0);
    for (let i = 0; i < n; i++) w[i] = Math.max(SETTLE.btnFloor, Math.floor(w[i] * k));
  }
  return w;
}

/** 整排居中后各钮中心 x */
export function actionXs(widths: number[]): number[] {
  const total = widths.reduce((s, x) => s + x, 0) + SETTLE.btnGap * (widths.length - 1);
  let x = -total / 2;
  return widths.map((w) => { const c = x + w / 2; x += w + SETTLE.btnGap; return c; });
}

/** 横排判据:整排不出卡片,且每颗钮的文案实测宽不超出它自己分到的宽度 */
export function actionRowFits(acts: ActLike[], measure: Measure = textW): string[] {
  const bad: string[] = [];
  if (!acts.length) return ["行动钮一排一颗都没有"];
  const w = actionWidths(acts, measure);
  const total = w.reduce((s, x) => s + x, 0) + SETTLE.btnGap * (w.length - 1);
  const avail = SETTLE.cardW - SETTLE.btnPadX;
  if (total > avail + EPS) bad.push(`整排宽 ${total} > 可用 ${avail}`);
  for (let i = 0; i < acts.length; i++) {
    const need = Math.ceil(measure(acts[i].text, acts[i].size));
    if (need + SETTLE.btnPad > w[i] + EPS) {
      bad.push(`第 ${i + 1} 颗「${acts[i].text}」文案 ${need}+${SETTLE.btnPad} 塞不进 ${w[i]}(字号 ${acts[i].size})`);
    }
  }
  return bad;
}

// ---------- 横排:关卡目标逐条 ----------

/** 三条「★1 取胜」的实测宽与整排居中后的中心 x */
export function condRow(texts: string[], measure: Measure = textW): { w: number[]; x: number[]; total: number } {
  const w = texts.map((t) => measure(t, SETTLE.objSize) + SETTLE.objWPad);
  const total = w.reduce((s, x) => s + x, 0) + SETTLE.objGap * Math.max(0, texts.length - 1);
  let x = -total / 2;
  const cx = w.map((v) => { const c = x + v / 2; x += v + SETTLE.objGap; return c; });
  return { w, x: cx, total };
}

/**
 * 目标排从前没有任何宽度防护:三条文案由 core/campaign-hud 现算,「★3 失分 0/2」这种
 * 短句没事,换成一句长话就会整排推出卡片。这里按**最坏句长**判,不靠"这句刚好不长"。
 */
export function condRowFits(texts: string[], measure: Measure = textW): string[] {
  const bad: string[] = [];
  const r = condRow(texts, measure);
  const avail = SETTLE.cardW - SETTLE.objPadX;
  if (r.total > avail + EPS) bad.push(`目标排宽 ${r.total.toFixed(0)} > 可用 ${avail}`);
  return bad;
}

/** 荣誉胶囊:底块宽跟着字数走,但封顶在卡宽内 —— 超上限就是字会飘出色带 */
export function badgeFits(title: string, measure: Measure = textW): string[] {
  const bad: string[] = [];
  const maxW = SETTLE.cardW - 60;
  const w = Math.min(maxW, measure(title, SETTLE.badgeSize) + 34);
  const need = measure(title, SETTLE.badgeSize);
  if (need > w + EPS) bad.push(`称号「${title}」实测 ${need.toFixed(0)} > 色带 ${w.toFixed(0)}`);
  return bad;
}

/**
 * 按钮下那行小字(「下一关是什么玩法」/ 全通说明):只有一条 Label、没有底块,
 * 也没有折行 —— 超出可用宽就是整串飘出卡片。关卡名长短不一(第 1 关 4 字 vs
 * 「深陷流沙」带副标),所以这一句必须逐关量,不能靠"这关刚好不长"。
 */
export function captionFits(text: string, measure: Measure = textW): string[] {
  const avail = SETTLE.cardW - SETTLE.objPadX;
  const w = measure(text, SETTLE.captionSize);
  return w > avail + EPS ? [`小字「${text}」实测 ${w.toFixed(0)} > 可用 ${avail}`] : [];
}
