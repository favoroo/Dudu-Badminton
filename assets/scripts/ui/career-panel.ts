// ============================================================
// 生涯中心面板:等级/金币总览 + 皮肤商店(点选试穿 → 按钮成交) + 履历统计 + 实时小人预览
// 纯代码构建 UI 节点,复刻老项目 src/ui-career.js 的完整交互。
// 与老项目的一处**有意差异**:老版是桌面键盘(方向键选中 + Enter 成交),触摸端把两步压成了
// 一tap 直接扣金币 —— 皮肤买了不能退,误触代价是真的,所以这里拆回「点卡片只选中 / 按按钮才成交」。
// 货架为什么能滑:角色皮肤 12 款按 4 列排是 3 行,而网格窗只装得下 2 行 —— 第三行从前
// 直接伸出面板底被屏幕切掉,想看最后几款没法把它挪进画面。现在由 Mask 裁切 + 拖动/惯性滚动,
// 越界回弹、滚动条、滑与点的分辨见「货架可视窗(滚动)」一节。
// 依赖:Career(逻辑层)、CFG.skins(配置)、Sprites.drawPlayer/drawShuttle(渲染)
// ============================================================
import {
  _decorator, BlockInputEvents, Button, Color, Component, EventKeyboard, EventTouch, Graphics, Input, input, Label, Layers,
  Mask, Node, UITransform, UIOpacity, Widget, KeyCode,
} from "cc";
import { Career } from "../core/career";
import { CFG, DRILLS } from "../core/config";
import type { SkinFamily, MilestoneStat } from "../core/config";
import { Ball, CosmoSlot, CosmeticDef, FaceKind, Player, SkinDef, SkinKind, Theme } from "../core/types";
import { drawAccStill } from "../render/acc";
import { drawHeadStill, drawPlayer, drawRacketStill, drawShuttle, hueColor, Viewport } from "../render/sprites";
import { Physics } from "../core/physics";
import { clamp } from "../core/utils";
import {
  ac, applyFont, drawBevelSlot, drawP5Block, drawP5Card, drawPosterPlate, drawRankBadge,
  drawSlantPanel, drawSlantShadow, drawSawtooth, drawStarGlyph, fadeOutHide,
  gridCenters, hbox, inkFor, makeChip, makeCoinIcon, mkLabel as uiMkLabel, paintP5, pressFx,
  progressDL, retainedDraw, ROLE, skewOf, slamIn, SLANT, textW, TOUCH_MIN, uiIconButton,
} from "./ui-arcade";
import { C } from "./p5-tokens";
import { clearKids, onTap, pressable, solidTab, type TabHandle } from "./ui-shell";
import {
  accBandH, accShelf, accSlotRowCounts, accSlotRows, cardFxLines, cardFxYs, cardInnerW, cardLine, CARD_TEXT, SHELF, advanceScroll, gridCols, revealRange, rubberBand, rowTopY, shelfLayout,
  SHOP, shopContent, shopStats, shopSubAction, shopSubBack, shopTabs, shopTopBar, STAT, statCardDL, statCells, thumbCenterY,
  thumbHeight, TOAST, TOAST_FG, toastWidth,
} from "./shop-shelf";
import type { ScrollMotion, Shelf } from "./shop-shelf";

const { ccclass } = _decorator;

// ---------- 常量 ----------

// 顶栏五格(2026-10-06 拆件重构):
//  · "acc" 摆**第一格**并改名「形象」—— 用户 2026-10-06 点名:自己逐槽搭才是这件事的主入口,
//    打包买是次要路径。「配饰」这个名字本来也不对:里面装的是上衣、发型、肤色,不是配饰。
//  · "player" 这一格摆的是**套装卡**(13 条老人物皮肤改出来的打包),跟着挪到第二格;
//    标签从「形象套装」缩短成「套装」—— 它左边那格已经叫「形象」,再叫「形象套装」
//    两格读起来像同一格打错了字。
//  · "face"(面部皮肤)从顶栏撤掉,并进「形象」的「脸面」chip(它本来就是单选,和一个槽同构);
//  · "acc" 不是 SkinKind:它是 CFG.accessories 这张独立表 + 十二个子槽的面板状态(_accSlot),
//    货架几何走 accShelf(槽位 chip 行数)(padTop 抬高让出子页签行)。
const KIND_ALL: string[] = ["acc", "player", "racket", "shuttle", "stats"];
const KIND_LABEL: Record<string, string> = {
  player: "套装", racket: "球拍皮肤", shuttle: "羽毛球皮肤", face: "面部皮肤",
  acc: "形象", stats: "生涯战绩",
};

/** 槽位 chip 的行分组(每行几颗)与行数:全部由 config.COSMO_SLOTS 的 row 字段算出来。
 *  chip 排布与货架让位(accShelf 抬 padTop)吃同一份数字,两边不可能漂成两套。 */
const SLOT_ROWS = accSlotRowCounts(CFG.accSlots.map((s) => s.row));
const SLOT_ROW_N = SLOT_ROWS.length;

/** 皮肤与穿戴件共用一张货架/一条成交链。判别走 `kind`:SkinDef 的 kind 是四类皮肤,
 *  CosmeticDef 的 kind 是 "part"/"wear",两个联合字面量**互不相交**,所以这是真判别式。
 *  (旧写法 `"slot" in s && "style" in s` 在拆件后失效了:本体件没有 style。) */
function isCosmo(s: SkinDef | CosmeticDef): s is CosmeticDef {
  return s.kind === "part" || s.kind === "wear";
}
const LV_NAMES = [
  "新手菜鸟", "初学乍练", "渐入佳境", "业余好手", "俱乐部主力",
  "地区新星", "城市名将", "省队水准", "全国赛手", "顶级选手",
  "精英大师", "传奇球手", "羽坛名宿", "世界冠军", "大满贯",
  "不朽传奇", "羽球之神", "至高无上", "传说再现", "巅峰至尊",
];

// 布局(设计分辨率 960×540)
const PW = 880, PH = 470;
// 货架尺寸的唯一出处在 shop-shelf.ts(纯函数,node 下可断言,回归见 tools/shelf-check.ts);
// 这里只是给既有调用点保留短名。留白(padTop/padBot)只在货架那边参与计算,不再手调。
const { cardW: CARD_W, cardH: CARD_H, gap: GAP, w: GRID_W, h: CONTENT_H } = SHELF;
const PREVIEW_W = 320;
/** 动作按钮:商店里唯一花钱的地方(点卡片只试穿,按一下才扣金币) */
const ACT_W = 260, ACT_H = 44;
/** 训练评级满分:六关各三星(原来是硬编码的 18) */
const DRILL_STARS_MAX = DRILLS.length * 3;

// ---------- 货架滚动(网格超过一屏时才有意义) ----------
/** 滚动条:贴在可视窗右缘内侧的覆盖式细条(4 列时卡片块两侧各有 56px 留白,不压卡) */
const BAR_W = 4, BAR_X = GRID_W / 2 - 7, BAR_PAD = 12;
/** 滚动条配色提为常量:_drawBar 滚动期间每帧都跑,Color 别在帧里现造(同 advanceScroll 的纪律)
 *  值由令牌表给 —— 轨道是「暗部之间的分隔线」C.line 上抬一档,滑块是货币色 acid。 */
const BAR_TRACK_COLOR = ac(C.dim, 0.12);
const BAR_THUMB_COLOR = ac(C.acid, 0.55);
/** 手指走出这么多**设计像素**就不算「点卡片」了,算滑动。
 *  960×540 在横屏手机上约 2 倍缩放,10 ≈ Android 的 8dp touch slop,再小就开始误吞点击。 */
const DRAG_SLOP = 10;
/** 越界拖动的阻尼:拉到顶/底还能再拖一截,松手弹回(移动端的标准手感) */
const RUBBER = 0.35;
/** 松手之后的惯性/回弹/定位运动学在 shop-shelf.advanceScroll(常数也在那边) */

// 配色:**值全部派生自 p5-tokens.C**(那张表是面板层唯一说真话的地方)。
// 这里保留 COL 这套历史短名与 Color 实例 —— 本文件几十处 mkLabel/Graphics 直接吃 Color,
// 一次性改完风险大于收益;但「同一个 hex 在五处各写一遍」的病到此为止。
// 旧注释里那句「白 5% 压在 panelBg 上只有 1.1:1」的临时补丁(tabBg/tabEdge)已随
// tab 换成 solidTab 一起删掉 —— 未选中态现在是凹陷槽,靠明暗凹凸读,不靠描边。
const COL = {
  overlay: ac(C.ink, 1),
  panelBg: ac(C.navy, 0.89),
  cardBg: ac(C.navy2, 0.82),
  cardSel: ac(C.acid),
  cardEquip: ac(ROLE.drill.dk, 0.82),
  cardLock: ac(C.navy, 0.67),
  accent: ac(C.acid),
  gold: ac(C.acid),
  hot: ac(C.hot),
  cyan: ac(C.cyan),
  green: ac(C.good),
  white: ac(C.paper),
  dimWhite: ac(C.dim, 0.78),
  dimGray: ac(C.dimDeep, 0.92),
  expBg: ac(C.ink, 0.59),
  expFill: ac(C.acid),
};

// ---------- UI 辅助 ----------

function mkNode(name: string, parent: Node, w: number, h: number): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setParent(parent);
  return n;
}

function mkLabel(
  parent: Node, name: string, text: string,
  size: number, color: Color = COL.white,
  opts?: { x?: number; y?: number; w?: number; align?: number; lines?: number; disp?: boolean },
): Label {
  const o = opts ?? {};
  // 委托权威 mkLabel:align→锚点映射与旧行为逐位一致(现役调用只用 align 0/1;
  // 旧实现里「align=2 没有右锚」的暗坑顺带被治好,行为变化仅限从未调用的组合)。
  return uiMkLabel(parent, name, text, size, color, {
    x: o.x, y: o.y, w: o.w, lines: o.lines,
    lineH: Math.round(size * 1.3),
    contentH: size * 1.4 * (o.lines ?? 1),
    align: (o.align ?? 0) as 0 | 1 | 2,
    anchor: "align",
    disp: o.disp,
  });
}

/** 解析 CSS 颜色:支持 #hex 与 rgb()/rgba()(Cocos 的 fromHEX 不认 rgba 字符串) */
function parseColor(s: string, fallback: Color): Color {
  const m = /^\s*rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[, /]\s*([\d.]+))?\s*\)\s*$/.exec(s);
  if (m) {
    const a = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 255) : 255;
    return new Color(+m[1], +m[2], +m[3], a);
  }
  try { return new Color().fromHEX(s); } catch { return fallback; }
}

/** 传说款的四尖星印章:同色实心 + 墨圆心(与首页标题右上角那枚同一画法) */
function drawStarSeal(g: Graphics, cx: number, cy: number, r: number, hex: string): void {
  drawStarGlyph(g, cx, cy, r, true, hex);
  g.fillColor = ac(C.ink, 1);
  g.circle(cx, cy, r * 0.18);
  g.fill();
}

/**
 * 履历页六格的数据与版式同住在 shop-shelf(statCells / statCardDL / statCardFits),
 * 出图与判据吃的是同一份 —— 这里只递上存档和「六关满星」这把尺。
 */

// ---------- 预览辅助 ----------
function themeOf(s: SkinDef): Theme {
  return { main: s.main ?? "#ff4d4d", dark: s.dark ?? "#a8202c", glow: s.glow ?? "#ff8a6a", name: s.name };
}

/** 候选脸面 → drawHead 的 faceStyle key。"auto"(跟随人物)按「当前装备人物自带的脸」
 *  解析 —— 与 sprites.drawPlayer 里那条 eqFace === "auto" 的分支同一个口径,别兜两份。 */
function faceStyleOf(s: SkinDef, worn: SkinDef): string {
  const k = s.faceStyle;
  if (k === undefined) return "skin";
  return k === "auto" ? (worn.face ?? "skin") : k;
}

/** 「这套人物形象长什么样」:戴上它自带的那张脸(影分身的无面/猫系少女的猫须)。
 *  与货架上「跟随人物」那件商品是两件事 —— 那一款读的是**玩家此刻**穿着的人物,
 *  而这里要预览的是**候选这套**本身。 */
function faceOfSet(def: SkinDef): SkinDef {
  return { id: "face-set", kind: "face", name: def.name, price: 0, faceStyle: def.face ?? "skin" };
}

/** 构造最小可用的 Player 实体供 drawPlayer 消费。
 *  faceSkin 兜的是"没有人物上下文"的那一格:素净肤色脸(货架默认款 face-auto 那一张)。
 *  预览某套人物形象时由调用方递 faceOfSet(它),别指望这一格自己猜。 */
function dummyPlayer(theme: Theme, racketSkin: SkinDef, ov: Partial<Player> = {}): Player {
  return {
    side: "left", isAI: false, theme, jersey: "01",
    aiDiff: null, ai: null, zone: "", teamLabel: "", idx: 0,
    x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, homeX: 0,
    facing: 1, onGround: true, coyote: 0, jumpBuf: 0,
    sq: 1, sqPrev: 1, recoverT: 0,
    runPhase: 0, runAmt: 0, runStep: 0, blinkSeed: 0,
    swingT: -1, swingStyle: "over" as const, swingHit: false,
    swingQ: 0, swingBuf: 0, swingBufAim: null, swingAim: "mid", swingLoft: 0,
    swingRadius: 52,
    racket: { x: 0, y: 0, ang: 0 }, racketPrev: { x: 0, y: 0 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0,
    zoneScale: 1, score: 0, smashGlow: 0, sweetGlow: 0, perfectGlow: 0, heat: 0,
    hitRecoil: 0, lungeT: -1, lungeDir: 0, lungeCd: 0, lungeShotT: 0,
    stats: {
      hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0,
      lungeShots: 0, jumpSmashes: 0, iaiStrikes: 0, skillCasts: 0,
      deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
      zonePenalties: 0, exhausted: 0,
    },
    racketSkin,
    faceSkin: { id: "face-auto", kind: "face", name: "普通肤色", price: 0, faceStyle: "skin" },
    hideTag: true,
    groundY: 0,
    ...ov,
  };
}

/** 构造最小可用的 Ball 实体供 drawShuttle 消费 */
function dummyBall(): Ball {
  return {
    x: 0, y: 0, px: 0, py: 0, vx: 1, vy: -1.73,
    live: false, held: false, owner: null,
    lastHitter: null, crossed: false, netted: false,
    shot: null, sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  };
}

/** 预览用 Viewport:将 drawPlayer 的世界坐标映射到 Graphics 本地空间 */
function previewVp(scale: number, cx: number, cy: number): Viewport {
  return {
    x: (wx: number) => wx * scale + cx,
    y: (wy: number) => -(wy * scale) + cy,
  };
}

/** 设计款卖点一句话:卡片底部小字与购买欲直接挂钩 */
function fxTag(s: SkinDef | CosmeticDef): string {
  // 配饰的卖点就是 config 里那句 desc,不走下面的皮肤字段分支
  if (isCosmo(s)) return s.desc;
  // 族卡不吃下面任何一条分支:它的卖点不是"某一张脸长什么样",而是"里面有好几张可挑"
  const fam = Career.familyOf(s.id);
  if (fam) return fam.tag;
  if (s.kind === "face") {
    switch (s.faceStyle) {
      case "skin": return "肤色脸 · 无特征 · 心情腮红";
      case "auto": return "跟随人物自带脸面";
      case "ink": return "经典剪影 · 情怀款";
      case "void": return "纯黑无面 · 零描边";
      case "snow": return "纯白无面 · 零描边";
      case "freckle": return "肤色脸 · 雀斑 · 心情腮红";
      case "tear": return "肤色脸 · 泪痣 · 心情腮红";
      case "cat": return "猫系脸面 · 猫须腮红";
      case "sage": return "白眉长须 · 仙风道骨";
      default: return "";
    }
  }
  if (s.kind === "racket") {
    switch (s.swingFx) {
      case "fire": return "专属火焰挥拍弧光";
      case "ice": return "专属寒冰挥拍弧光";
      case "electric": return "专属雷电挥拍弧光";
      case "rainbow": return "专属彩虹挥拍弧光";
    }
    return s.decal || s.stringColor ? "定制拍面徽记" : "";
  }
  if (s.kind === "shuttle") {
    switch (s.trailStyle) {
      case "star": return "全场可见 · 星芒拖尾";
      case "flame": return "全场可见 · 火羽拖尾";
      case "petal": return "全场可见 · 花瓣拖尾";
      case "rainbow": return "全场可见 · 星云拖尾";
    }
    return "";
  }
  // 套装卡的卖点不再是"它长什么样"(卡片本身就在画它),而是**这一格里有哪几件、
  // 一次拿下省多少**。旧写法是从 aura/body/face 反推一句「专属脚下光环」,那是在猜;
  // 现在 parts 就是那张清单,直接数。
  if (s.kind === "player" && s.parts) {
    const pr = Career.setPrice(s.id);
    const save = pr.total - s.price;
    return save > 0 ? `${pr.n} 件单品 · 整套省 ${save} 金币` : `${pr.n} 件单品 · 一次穿齐`;
  }
  return "";
}

/** 预览球的专属拖尾示意:球后斜向 5 颗衰减圆点(与 world 拖尾同色系) */
function drawTrailHint(g: Graphics, vp: Viewport, s: SkinDef): void {
  const style = s.trailStyle;
  if (!style) return;
  const cols: Record<string, string[]> = {
    star: ["#7ecbff", "#aadcff", "#eaf6ff"],
    flame: ["#ff4d26", "#ff9a3d", "#ffe14d"],
    petal: ["#ff8fb8", "#ffb7d0", "#ffe0ec"],
  };
  for (let i = 0; i < 5; i++) {
    // 球后距离(预览局部 px):2.5 倍缩放下 1.73 的斜率会把尾点一路甩到 -212,
    // 越过试衣间下沿(那一段现在归动作按钮)甚至出面板底 —— 收短到 5 颗全落在画面区内。
    const d = 11 + i * 5;
    const a = Math.max(0.08, 0.55 - i * 0.11);
    const wx = -d, wy = d * 1.73;                // dummyBall 速度 (1,-1.73) 的反方向
    let col: Color;
    if (style === "rainbow") col = parseColor(hueColor(i * 58), COL.white);
    else col = parseColor((cols[style] ?? cols.star)[i % 3], COL.white);
    g.fillColor = new Color(col.r, col.g, col.b, Math.round(255 * a));
    g.circle(vp.x(wx), vp.y(wy), (4.6 - i * 0.55) * 2.5);
    g.fill();
  }
}

// ============================================================

@ccclass("CareerPanel")
export class CareerPanel extends Component {

  // ---------- 公开接口 ----------

  /** 构建并显示面板 */
  show(parent: Node, onClose: () => void, initialKind?: SkinKind | "acc" | "stats") {
    this._onCloseCb = onClose;
    // 默认开在「形象」:进来先看自己这一身,套装/皮肤是主动逛街才去翻的(2026-10-07 用户指令)。
    // 显式传 initialKind 的入口(履历跳转等)仍以传入为准。
    this._kind = initialKind ?? "acc";
    this._sel = 0;
    this._fam = null;   // 每次开门都从整族货架看起,不复用上次停在二级界面的位置
    this._buildAll(parent);
    this._refresh();
    if (this._panelNode) slamIn(this._panelNode);   // 老 .panel slam 砸落
    input.on(Input.EventType.KEY_DOWN, this._onKey, this);
  }

  /** 销毁面板 */
  hide() {
    this._onCloseCb = null;
    this._panelNode = null;
    input.off(Input.EventType.KEY_DOWN, this._onKey, this);
    // 退场淡出后再销毁整树;引用立刻置空,避免 update() 对已收走的节点继续画
    const r = this.root;
    if (r && r.isValid) fadeOutHide(r, () => { if (r.isValid) r.destroy(); });
    this.root = null;
    this._lvLabel = null;
    this._lvNameLabel = null;
    this._expLabel = null;
    this._expBarG = null;
    this._coinsLabel = null;
    this._hintLabel = null;
    this._previewGfx = null;
    this._previewName = null;
    this._actNode = null;
    this._actGfx = null;
    this._actLabel = null;
    this._gridNode = null;
    this._statsNode = null;
    this._previewArea = null;
    this._backNode = null;
    this._subActNode = null;
    this._fam = null;
    this._accSlotBar = null;
    // 货架整棵随 root 一起销毁,这里只清引用 + 复位滚动状态(面板复用时不留残余)
    this._viewport = null;
    this._contentNode = null;
    this._vpH = 0;
    this._barG = null;
    this._scrollY = 0;
    this._maxScroll = 0;
    this._rows = 0;
    this._dragId = null;
    this._dragMoved = false;
    this._vel = 0;
    this._easeTo = null;
    this._tabHandles = [];
    this._toastNode = null;
    this._toastLabel = null;
    this._toastOpacity = null;
    this._toastTimer = 0;
  }

  /** 外部触发数据刷新 */
  refresh() { this._refresh(); }

  /** 每帧:驱动预览动画 */
  update(dt: number) {
    if (!this.root) return;
    this._stepScroll(dt);
    if (this._kind === "stats") return;
    // player/racket/acc 的试衣间都是活的小人(呼吸/挥拍/围巾飘动都吃时钟)。
    // "face" 这一项随顶栏撤掉一并删了 —— 脸面现在是 acc 里的一个槽,时钟由 acc 那支管。
    if (this._kind === "player" || this._kind === "racket" || this._kind === "acc") {
      this._elapsed += dt;
      if (this._elapsed > 2.2) this._elapsed -= 2.2;
      // 另一条不回卷的时钟:专给 drawPlayer 的 animT(待机呼吸/眨眼/脚下法阵的自转)。
      // 从前这里恒传 0 —— 于是「2200ms 循环」编排完挥拍,人物却像一尊蜡像,传说皮肤
      // 那圈法阵更是一动不动。_elapsed 要回卷重放挥拍,拿它当自转时钟会让法阵每 2.2s
      // 猛地拧回去一次,所以另起一条只累加的。
      this._clock += dt;
      this._drawLivePreview();
    }

    // Toast 淡出
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0 && this._toastOpacity) {
        this._toastOpacity.opacity = 0;
        // 提示带走了,同一车道的底部提示行回到原位(换球页那句「换球后全场生效」)
        if (this._hintLabel) this._hintLabel.string = this._hintWanted;
      }
    }
  }

  // ---------- 内部状态 ----------

  private root: Node | null = null;

  /** 面板根节点:供 ui-manager 做 screenSwap 退场用(退场仍走 hide(),那里有清理) */
  get rootNode(): Node | null { return this.root; }
  private _panelNode: Node | null = null;
  private _onCloseCb: (() => void) | null = null;
  private _kind: SkinKind | "acc" | "stats" = "acc";
  private _sel = 0;
  /** 二级货架:非 null = 此刻摆在的是这一族(config.SKIN_FAMILIES 的 key)的成员列表。
   *  换 tab / 开关面板都回 null(整族货架),只有点族卡才会置上。 */
  private _fam: string | null = null;
  /** 形象套装 tab 的二级货架:正展开的是哪个套装(= SKINS.player 的那条 id,与存档 owned 同源)。
   *  与 _fam 分开两个字段:族是"同槽互斥的几款合并成一张卡",套装是"跨槽的几件打包同时穿",
   *  两者的成员来源、价格口径、成交动作全不同,塞进一个字段早晚写出错的分支。 */
  private _bundle: string | null = null;
  /** 配饰 tab 当前看的槽位;换 tab 不复位,回来还停在原槽。
   *  类型是 CosmoSlot 不是 AccSlot:这一格导航里既有落 acc 的槽,也有脸面(落 equipped.face)。 */
  private _accSlot: CosmoSlot = "tone";
  /** 配饰子页签条(挂在 gridArea 上、与可视窗平级 → 不随滚动、履历页随整树销毁) */
  private _accSlotBar: Node | null = null;
  /** 本次货架用的几何(形象页用 accShelf() 把**可视窗**变矮,让出钉住的子页签带);
   *  _revealSel 要用同一份算「滚到哪能看全」,别两边各拿一份 SHELF */
  private _curShelf: Shelf = SHELF;
  private _elapsed = 0;
  /** 不回卷的累加时钟 → drawPlayer 的 animT(帧);_elapsed 负责挥拍编排,这条负责自转 */
  private _clock = 0;
  private _toastTimer = 0;

  // 缓存的 UI 元素
  private _lvLabel: Label | null = null;
  private _lvNameLabel: Label | null = null;
  private _expLabel: Label | null = null;
  /** 经验条:轨道 + 填充同一个 Graphics(progressDL 一次画完,两者斜率必然同式) */
  private _expBarG: Graphics | null = null;
  private _expW = 0;
  private _expH = 0;
  private _coinsLabel: Label | null = null;
  private _hintLabel: Label | null = null;
  /** 底部提示行**该写什么**:与提示带共用一条车道,提示带在屏的 1.7s 里先让位 */
  private _hintWanted = "";
  private _previewGfx: Graphics | null = null;
  private _previewName: Label | null = null;
  private _actNode: Node | null = null;
  private _actGfx: Graphics | null = null;
  private _actLabel: Label | null = null;
  private _gridNode: Node | null = null;
  private _statsNode: Node | null = null;
  private _previewArea: Node | null = null;
  /** 二级货架的「返回」键:货架窗底部那条空带里的常驻件(随 _buildGrid 重建) */
  private _backNode: Node | null = null;
  /** 套装二级货架的「一键穿戴」键:同一条空带、贴右(仅套装二级态建,随 _buildGrid 重建) */
  private _subActNode: Node | null = null;

  // 货架滚动:viewport 挂 Mask 裁切,content 是被拖动的货架
  private _viewport: Node | null = null;
  private _contentNode: Node | null = null;
  /** 建这扇窗时用的窗高:换 tab 之后 _curShelf.h 变了就得重建(Mask 的矩形在原生侧
   *  是渲染时烘进去的,运行时改 UITransform 不保证跟着改) */
  private _vpH = 0;
  private _barG: Graphics | null = null;
  /** 货架位移(≥0 = 往上滚看了后面的行),范围 [0, _maxScroll] */
  private _scrollY = 0;
  private _maxScroll = 0;
  /** 本次列表的行数(把选中卡滚进视野要用) */
  private _rows = 0;
  /** 正在拖动的手指 id;null = 没人按着 */
  private _dragId: number | null = null;
  private _dragFromY = 0;
  private _dragBaseY = 0;
  /** 本次触摸已滑动 → 抬起时不要把它当成「点卡片」 */
  private _dragMoved = false;
  /** 拖动中的瞬时速度(px/s,正=向上滚),松手交给惯性 */
  private _vel = 0;
  private _scrollSample = 0;
  /** 非 null = 正在平滑滚向这个值(键盘选中定位、越界回弹共用) */
  private _easeTo: number | null = null;
  /** advanceScroll 的复用出参:每帧都要跑,不每次造对象 */
  private readonly _motion: ScrollMotion = { y: 0, v: 0, easeTo: null };
  private _tabHandles: TabHandle[] = [];
  private _toastNode: Node | null = null;
  private _toastG: Graphics | null = null;
  private _toastLabel: Label | null = null;
  private _toastOpacity: UIOpacity | null = null;

  // ========== 节点搭建 ==========

  private _buildAll(parent: Node) {
    // --- root (全屏) ---
    this.root = new Node("career-panel");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform).setContentSize(960, 540);
    const wg = this.root.addComponent(Widget);
    wg.isAlignTop = wg.isAlignBottom = wg.isAlignLeft = wg.isAlignRight = true;
    wg.top = wg.bottom = wg.left = wg.right = 0;
    this.root.setParent(parent);

    // 遮罩:二级界面底即墨黑(用户指令),身后的一级界面/球场一律不露;
    // rect 与 uiDim 同款超宽:宽屏两侧那一条也不露背景。
    const overlay = mkNode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = COL.overlay;
    og.rect(-2000, -1000, 4000, 2000);
    og.fill();
    // 商店打开时不要让点击漏到下面的虚拟按键上(菜单的遮罩此时已隐藏)
    overlay.addComponent(BlockInputEvents);

    // 面板衬纸(L1):一张黑纸垫在荧光黄副衬上,标题带叠网点,下缘平直收边。
    // 副衬用黄不用首页的红 —— 商店的角色色是「星星/货币」,与首页那块「闯关」同档。
    const panel = mkNode("panel", this.root, PW, PH);
    panel.setPosition(0, -10, 0);
    this._panelNode = panel;
    const pg = panel.addComponent(Graphics);
    retainedDraw(pg, () => drawPosterPlate(pg, PW, PH, {
      bandHex: ROLE.star.face, halftone: true,
    }));

    this._buildTopBar(panel);
    this._buildTabBar(panel);
    this._buildContent(panel);
    this._buildHint(panel);

    // Toast:底块和文字各占一个子节点 —— 一个节点只能挂一个 renderable
    // 位置/尺寸/面色/字色全取自 shop-shelf.TOAST(与 panel-check 的判据同源)。
    // 挂在 root 上而不是 panel 上,但要换算到同一坐标系:panel 在 root 下移 SHOP.panelY。
    this._toastNode = mkNode("toast", this.root, TOAST.minW, TOAST.h);
    this._toastNode.setPosition(0, TOAST.cy + SHOP.panelY, 0);
    this._toastG = mkNode("toast-plate", this._toastNode, TOAST.minW, TOAST.h).addComponent(Graphics);
    this._toastLabel = mkNode("toast-label", this._toastNode, TOAST.minW, TOAST.h).addComponent(Label);
    applyFont(this._toastLabel, false);
    this._toastLabel.string = "";
    this._toastLabel.fontSize = TOAST.size;
    this._toastLabel.lineHeight = TOAST.size + 5;
    this._toastLabel.horizontalAlign = 1;
    this._toastLabel.verticalAlign = 1;
    // ★ 字色必须由面色经 inkFor 推:旧写法是 COL.gold,而 COL.gold == C.acid == 面色,
    //   同色相叠(实测 1.00:1)→ 真机上那是一条纯黄块,一个字都读不出来。
    this._toastLabel.color = ac(TOAST_FG);
    this._toastOpacity = this._toastNode.addComponent(UIOpacity);
    this._toastOpacity.opacity = 0;
  }

  // ----- 顶部状态栏 -----
  // 六件的位置全部由 shop-shelf.shopTopBar() 给(一条从左到右的轨道)。
  // 以前这里每件各拍一个 x,给 Lv 加斜切牌之后牌就盖住了等级名 —— 判据见 shopOverlaps()。
  private _buildTopBar(panel: Node) {
    const T = shopTopBar();
    const bar = mkNode("topBar", panel, PW - 20, SHOP.topBar.h);
    bar.setPosition(0, SHOP.topBar.cy, 0);
    const cx = (b: { left: number; right: number }): number => (b.left + b.right) / 2;
    /** 顶栏节点的原点在 topBar.cy,盒子的 cy 是面板坐标 → 落位要减一次 */
    const ly = (cy: number): number => cy - SHOP.topBar.cy;

    // Lv. 牌:斜切红底 + 右缘撕纸(抄 main-menu 左上那枚,同一语汇)
    const lvW = T.lv.right - T.lv.left, lvH = T.lv.h;
    const lvPlate = mkNode("lv-plate", bar, lvW, lvH);
    lvPlate.setPosition(cx(T.lv), 0, 0);
    const lpg = lvPlate.addComponent(Graphics);
    const lvSkew = skewOf(lvH, SLANT.band);
    retainedDraw(lpg, () => {
      drawSlantShadow(lpg, lvW, lvH, lvSkew, 3, 3, 0.5);
      drawSlantPanel(lpg, lvW, lvH, lvSkew, { face: C.slash, alpha: 0.97, edge: ROLE.primary.edge, edgeA: 0.8 });
      drawSawtooth(lpg, 8, lvH - 16, 3, C.slashDk, 0.95, "right", lvW / 2 + 4, 0);
    });
    // 旧写法没传 align ⇒ align 0 = 左锚,而 x 给的是**牌心** → 「Lv.4」整串字挂在中心
    // 往右跑,压住右缘那排撕纸齿。牌上的字当然该居中,补 align 1(锚点随之回到 0.5)。
    this._lvLabel = mkLabel(bar, "lv", "Lv.1", 20, ac(C.paper), {
      x: cx(T.lv), y: ly(T.lv.cy), w: lvW - 16, align: 1, disp: true,
    });

    // 等级块第一行:左=称号,右=EXP 读数(读数与它下面的条子配成一对,不再隔一行)
    this._lvNameLabel = mkLabel(bar, "lvName", LV_NAMES[0], 14, ac(C.paperDim), {
      x: T.lvName.left, y: ly(T.lvName.cy), w: T.lvName.right - T.lvName.left, align: 0, disp: true,
    });
    this._expLabel = mkLabel(bar, "expNum", "0 / 80 EXP", 11, COL.dimWhite, {
      x: T.expNum.right, y: ly(T.expNum.cy), w: T.expNum.right - T.expNum.left, align: 2,
    });

    // 经验条:轨道 + 填充走 progressDL —— 与结算屏那条 EXP 条**同一把尺**。
    // 旧写法是槽画 14 高、填充另起一个 10 高的块,两者斜切量按各自的高算(14→1.22、10→0.88),
    // 于是填充的左沿与槽的左沿既不重合也不平行:用户截图里「那个条形底板不太对」就是它。
    this._expW = T.exp.right - T.exp.left;
    this._expH = T.exp.h;
    const expBar = mkNode("expBar", bar, this._expW, this._expH);
    expBar.setPosition(cx(T.exp), ly(T.exp.cy), 0);
    this._expBarG = expBar.addComponent(Graphics);
    this._drawExpBar(0);

    // 金币(Graphics 图标 + 数字,替代 🪙 emoji)
    const coinW = T.coins.right - T.coins.left;
    makeCoinIcon(bar, T.coins.left + 10, 0, 9);
    this._coinsLabel = mkLabel(bar, "coins", "50", 18, COL.gold, {
      x: T.coins.left + 26 + (coinW - 26) / 2, y: ly(T.coins.cy), w: coinW - 26, align: 1, disp: true,
    });

    // 返回按钮:命中区 56(视觉斜方底 44),Button.CLICK 自带按压反馈
    const back = uiIconButton(bar, "✕", { fontSize: 20 });
    back.setPosition(cx(T.close), 0, 0);
    back.on(Button.EventType.CLICK, () => {
      this._onCloseCb?.();
      this.hide();
    });
  }

  // ----- Tab 栏 -----
  private _buildTabBar(panel: Node) {
    const tabs = shopTabs();
    const bar = mkNode("tabs", panel, PW - 20, SHOP.tabs.h);
    bar.setPosition(0, SHOP.tabs.cy, 0);
    this._tabHandles = [];

    KIND_ALL.forEach((k, i) => {
      const b = tabs[i];
      // 选中 = 整面荧光黄实底 + 墨黑字;未选 = 凹陷槽 + dim 字。
      // 旧写法是 navy2 底 + 白 5% 描边(约 1.1:1),用户读出来是「这一格坏了」。
      const h = solidTab({
        name: `tab-${k}`, parent: bar, label: KIND_LABEL[k],
        w: b.right - b.left, h: b.h, role: "star", size: 15,
      });
      h.node.setPosition((b.left + b.right) / 2, 0, 0);
      h.node.on(Button.EventType.CLICK, () => {
        if (this._kind === k) return;
        this._setKind(k as SkinKind | "acc" | "stats");
      });
      this._tabHandles.push(h);
    });
  }

  // ----- 内容区(左:网格 右:预览) -----
  private _buildContent(panel: Node) {
    // 左:卡片网格(货架在 _ensureGridShell 里建,这里只留一块地)
    // 顶栏 / tab / 内容区 / 履历格的 y 全部来自 shop-shelf 的 SHOP 栈(判据 shopOverlaps)
    const K = shopContent(CONTENT_H);
    const left = mkNode("gridArea", panel, GRID_W, CONTENT_H);
    left.setPosition((K.grid.left + K.grid.right) / 2, K.grid.cy, 0);
    this._gridNode = left;

    // 右:预览
    const right = mkNode("previewArea", panel, PREVIEW_W, CONTENT_H);
    right.setPosition((K.preview.left + K.preview.right) / 2, K.preview.cy, 0);
    this._previewArea = right;

    const prevBg = right.addComponent(Graphics);
    // 切到「履历」页时这块整列会 active=false,再切回来得重画(原生侧 onDisable 会清渲染数据)
    retainedDraw(prevBg, () => {
      // 试衣间是一块小衬纸:副衬用青(专项/展示),下缘平直收边
      drawPosterPlate(prevBg, PREVIEW_W, CONTENT_H, { bandHex: ROLE.info.face, edge: false });
    });

    // 预览 Graphics
    const gfxNode = mkNode("gfx", right, PREVIEW_W, CONTENT_H - 30);
    gfxNode.setPosition(0, 10, 0);
    this._previewGfx = gfxNode.addComponent(Graphics);

    // 预览名称:贴在人物脚下、动作按钮上方(按钮要落在拇指够得着的下沿)
    this._previewName = mkLabel(right, "prevName", "", 16, COL.white, {
      y: K.name.cy - K.preview.cy, w: K.name.right - K.name.left, align: 1,
    });

    // 动作按钮 —— 商店唯一的成交入口。
    // 点卡片只「选中」(换试衣间 + 换按钮文案),金币只有按这里才动:
    // 皮肤买了不能退,一点就扣钱的手感在触摸端就是误触。
    const act = mkNode("action", right, ACT_W, ACT_H);
    act.setPosition((K.action.left + K.action.right) / 2 - (K.preview.left + K.preview.right) / 2,
      K.action.cy - K.preview.cy, 0);
    this._actNode = act;
    this._actGfx = act.addComponent(Graphics);
    // 切到履历页时 previewArea 整块会 active=false,回到商店时靠 retainedDraw 重放底块
    retainedDraw(this._actGfx, () => this._drawActionFace());
    this._actLabel = mkLabel(act, "actionTxt", "", 17, COL.white, { y: 0, w: ACT_W - 20, align: 1 });
    const actBtn = act.addComponent(Button);
    actBtn.transition = Button.Transition.SCALE;
    actBtn.zoomScale = 0.95;
    actBtn.target = act;
    act.on(Button.EventType.CLICK, () => this._act());
  }

  // ----- 底部提示 -----
  // 与提示带共用一条车道、同一个线位:提示带在屏的 1.7s 里这行让位,
  // 淡出后回到**同一行**(从前一个 -PH/2+18、一个 -PH/2+20,两条字互相压着)
  private _buildHint(panel: Node) {
    this._hintLabel = mkLabel(panel, "hint", "", 13, COL.dimGray, {
      y: TOAST.cy, w: PW - 40, align: 1,
    });
  }

  // ========== 货架可视窗(滚动) ==========

  /**
   * 建可视窗 + 货架 + 滚动条。
   *
   * 为什么要这一层:12 款角色皮肤按 4 列排是 3 行,而网格窗只装得下 2 行 ——
   * 第三行从前直接伸出面板底、被屏幕下沿切掉,想看最后几款没有任何办法把它挪进画面。
   * Mask 只裁「自己的子孙」,所以卡片必须住在 content 里,content 上下移动就是滚动。
   *
   * 窗外的卡片点不着,不是这里自己拦的:3.8 的 UITransform.hitTest 命中后会沿父链
   * 跑 Mask.isHit(_maskTest),渲染与命中一起被裁 —— 越界那一截既看不见也不会偷走
   * tab 条或底下按钮的点击。滚动时唯一要自己分辨的是「滑」与「点」,见 _dragMoved。
   *
   * 不用 active 开关整棵子树:原生侧 Graphics/Mask 的渲染数据会在 onDisable 被清,
   * 重新激活不会自动重传(见 ui-arcade.retainedDraw 顶部说明),而货架每次切 tab
   * 都要走一遍「让位给履历页 / 再回来」,所以改成销毁重建。
   */
  private _ensureGridShell() {
    if (!this._gridNode || (this._contentNode && this._contentNode.isValid)) return;

    // 窗高跟着本次货架走:形象页让出子页签带之后窗变矮,而且是**底对齐**变矮
    // (往下挪 (SHELF.h − h)/2),这样窗底与右侧试衣间仍然齐平。
    const vpH = this._curShelf.h;
    const inset = (SHELF.h - vpH) / 2;

    const vp = mkNode("gridView", this._gridNode, GRID_W, vpH);
    vp.setPosition(0, -inset, 0);
    const mask = vp.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_RECT;

    const content = mkNode("gridContent", vp, GRID_W, vpH);

    // 滚动条挂在窗户外面(gridArea 的另一个子节点),否则跟着内容一起被裁掉
    const bar = mkNode("gridBar", this._gridNode, BAR_W + 4, vpH);
    bar.setPosition(BAR_X, -inset, 0);

    this._viewport = vp;
    this._contentNode = content;
    this._vpH = vpH;
    this._barG = bar.addComponent(Graphics);

    const T = Node.EventType;
    content.on(T.TOUCH_START, this._onDragStart, this);
    content.on(T.TOUCH_MOVE, this._onDragMove, this);
    content.on(T.TOUCH_END, this._onDragEnd, this);
    content.on(T.TOUCH_CANCEL, this._onDragEnd, this);

    this._scrollY = 0;
    this._vel = 0;
    this._easeTo = null;
    this._applyScroll();
  }

  /** 让位给履历页时把整棵货架收走(连带 Mask):不 deactivate,直接销毁 */
  private _destroyGridShell() {
    const T = Node.EventType;
    if (this._contentNode && this._contentNode.isValid) {
      this._contentNode.off(T.TOUCH_START, this._onDragStart, this);
      this._contentNode.off(T.TOUCH_MOVE, this._onDragMove, this);
      this._contentNode.off(T.TOUCH_END, this._onDragEnd, this);
      this._contentNode.off(T.TOUCH_CANCEL, this._onDragEnd, this);
    }
    if (this._gridNode) {
      const kids = this._gridNode.children;
      for (let i = kids.length - 1; i >= 0; i--) kids[i].destroy();
    }
    this._viewport = null;
    this._contentNode = null;
    this._vpH = 0;
    this._barG = null;
    this._backNode = null;   // 它是 _gridNode 的孩子,跟着上面那圈一起销毁
    this._subActNode = null; // 同上
    this._dragId = null;
    this._dragMoved = false;
    this._vel = 0;
    this._easeTo = null;
    this._scrollY = 0;
    this._maxScroll = 0;
  }

  private _applyScroll() {
    if (this._contentNode && this._contentNode.isValid) {
      this._contentNode.setPosition(0, this._scrollY, 0);
    }
    this._drawBar();
  }

  /** 覆盖式细滚动条:位置随货架走,装得下时整条不画(不留没意义的轨道)。
   *  滑块中心由 shop-shelf.thumbCenterY 给:f=0 顶缘贴轨道顶、f=1 底缘贴轨道底 ——
   *  旧版在这里手写 `trackH/2 - f*(trackH-thumbH)`,把滑块中心钉在轨道顶,
   *  上半截戳出网格窗叠到 tab 条上(用户截图里那根飘着的黄条)。 */
  private _drawBar() {
    const g = this._barG;
    if (!g || !g.isValid) return;
    g.clear();
    if (this._maxScroll <= 0) return;
    const trackH = this._curShelf.h - BAR_PAD * 2;
    const thumbH = thumbHeight(trackH, this._curShelf.h, this._maxScroll);
    const f = clamp(this._scrollY / this._maxScroll, 0, 1);
    const cy = thumbCenterY(trackH, thumbH, f);
    g.fillColor = BAR_TRACK_COLOR;
    g.rect(-BAR_W / 2, -trackH / 2, BAR_W, trackH);
    g.fill();
    g.fillColor = BAR_THUMB_COLOR;
    g.rect(-BAR_W / 2, cy - thumbH / 2, BAR_W, thumbH);
    g.fill();
  }

  // ----- 拖动手势(挂在货架上:卡片的事件会冒泡上来,手指不必精准按住卡) -----

  private _onDragStart(e: EventTouch) {
    if (this._dragId !== null) return;   // 第二根手指不抢方向盘
    this._dragMoved = false;             // 每一指都从「没滑动」起算,这是点/滑的判定基准
    if (this._maxScroll <= 0) return;    // 装得下就没有货架可滑
    this._dragId = e.getID();
    this._dragFromY = e.getUILocation().y;
    this._dragBaseY = this._scrollY;
    this._vel = 0;
    this._easeTo = null;
    this._scrollSample = this._scrollY;
  }

  private _onDragMove(e: EventTouch) {
    if (this._dragId === null || e.getID() !== this._dragId) return;
    const dy = e.getUILocation().y - this._dragFromY;
    if (!this._dragMoved && Math.abs(dy) > DRAG_SLOP) this._dragMoved = true;
    this._scrollY = rubberBand(this._dragBaseY + dy, this._maxScroll, RUBBER);
    this._applyScroll();
  }

  private _onDragEnd(e: EventTouch) {
    if (this._dragId === null || e.getID() !== this._dragId) return;
    this._dragId = null;
    const max = this._maxScroll;
    if (this._scrollY < 0 || this._scrollY > max) {
      // 松手时还在越界区:弹回边界,别把货架停在半截
      this._easeTo = clamp(this._scrollY, 0, max);
      this._vel = 0;
    }
    // 否则保留 _vel,交给 _stepScroll 跑惯性
  }

  /** 每帧推进:拖动中采样速度 → 松手后跑惯性 / 回弹 / 定位(运动学在 shop-shelf) */
  private _stepScroll(dt: number) {
    if (this._dragId !== null) {
      const inst = (this._scrollY - this._scrollSample) / Math.max(dt, 1 / 240);
      this._vel = this._vel * 0.6 + inst * 0.4;
      this._scrollSample = this._scrollY;
      return;
    }

    const m = this._motion;
    m.y = this._scrollY; m.v = this._vel; m.easeTo = this._easeTo;
    advanceScroll(m, this._maxScroll, dt);
    if (m.y === this._scrollY && m.v === this._vel && m.easeTo === this._easeTo) return;
    this._scrollY = m.y;
    this._vel = m.v;
    this._easeTo = m.easeTo;
    this._applyScroll();
  }

  /** 把选中的卡片滚进视野(键盘上下选、点下半截露在外面的卡片都要) */
  private _revealSel() {
    if (this._maxScroll <= 0 || this._rows <= 0) return;
    const cols = gridCols(this._list().length);
    const { min, max } = revealRange(Math.floor(this._sel / cols), this._maxScroll, this._curShelf);
    if (min > max) return;   // 这一行在任何位置都露不全 —— shelf-check 拦的就是它
    let target = this._scrollY;
    if (target < min) target = min;
    else if (target > max) target = max;
    if (target === this._scrollY) return;
    this._vel = 0;
    this._easeTo = target;
  }

  // ========== 卡片网格 ==========

  /** 此刻货架上摆的是哪些商品。四条货架,一把尺子:
   *  · **配饰 tab** = 当前槽位那一格的商品。脸面槽特殊:商品住在 SKINS.face(它落
   *    equipped.face,不落 acc),而且它带着「肤色脸面」那张族卡,折叠口径与皮肤页一致。
   *  · **形象套装 tab** = 套装卡。只有**真的多件**才算套装 —— 纯色款拆完只剩一件上衣,
   *    套装卡与单件卡长得一模一样,摆出来是噪声,所以 parts 少于 2 件的不上这一格。
   *    动作键/键盘 Enter 进二级货架 = 摆它 parts 里那几件单件,顺序照 parts 的槽位表。
   *  · 整族货架:一族的成员不各占一格,合成一张族卡,动作键/键盘 Enter 进二级货架
   *    (顺序照 members,首项是免费底款,不排序)。点卡一律只选中,不直接进二级。
   *  · 排序:免费底款永远排第一(它代表「回到原版」,是这一槽的锚点),其余稀有度降序→价格升序。 */
  private _list(): Array<SkinDef | CosmeticDef> {
    const rank: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const byRarityThenPrice = (a: { rarity?: string; price: number }, b: { rarity?: string; price: number }): number => {
      if (a.price === 0) return -1;
      if (b.price === 0) return 1;
      const ra = rank[a.rarity ?? "common"], rb = rank[b.rarity ?? "common"];
      return ra !== rb ? ra - rb : a.price - b.price;
    };

    // 二级货架:一族摆它自己的成员。这条必须排在下面 acc 那条早退**之前** —— 脸面的族住在
    // 「形象」页的「脸面」chip 里,acc 分支一 return 就到不了这里,点族卡只剩一颗「返回」键、
    // 货架纹丝不动(2026-10-07 拆件重构就是这么把它挤没的,闸门 face-family-check ⑦ 钉住)
    const fam = this._fam ? CFG.families[this._fam] : null;
    if (fam) return fam.members
      .map((id) => Career.skinById(id))
      .filter((s): s is SkinDef => !!s);

    if (this._kind === "acc") {
      if (this._accSlot === "faceStyle") {
        // 脸面:族卡盖住的成员不各占一格(与皮肤页同一条 familyOfSkin,别另算一份)
        const fams = Object.values(CFG.families).filter((f) => f.kind === "face");
        const solo = CFG.skins.face.filter((s) => !Career.familyOfSkin(s.id));
        return [...solo, ...fams.map((f) => this._famCard(f))].sort(byRarityThenPrice);
      }
      return CFG.accessories
        .filter((c) => c.slot === this._accSlot)
        .sort(byRarityThenPrice);
    }

    // 二级货架:套装的组成件
    const bundle = this._bundle ? Career.skinById(this._bundle) : null;
    if (bundle?.parts) {
      const order = CFG.accSlots.map((s) => s.key as string);
      return Object.entries(bundle.parts)
        .map(([, id]) => (id ? Career.accById(id) : null))
        .filter((c): c is CosmeticDef => !!c)
        .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    }

    if (this._kind === "player") {
      // 套装卡是一张**合成商品卡**(走卡片那条渲染路径,但 id 用套装 id、价格用补齐价)。
      // "哪些算套装"这条判据住在 Career.shelfSets —— 面板自己 filter 一遍就会和出图/闸门漂。
      return Career.shelfSets().sort(byRarityThenPrice);
    }

    // 「谁被族卡盖住」只问 Career.familyOfSkin 一张嘴 —— 闸门 face-family-check 折叠那段
    // 吃的也是它,两边不会漂成两套(在这里另算一份 hidden 集合就是第二把尺子)
    const own = Object.values(CFG.families).filter((f) => f.kind === this._kind);
    const all = (CFG.skins[this._kind as SkinKind] ?? []).filter((s) => !Career.familyOfSkin(s.id));
    return [...all, ...own.map((f) => this._famCard(f))].sort(byRarityThenPrice);
  }

  /** 族卡是一张**合成商品卡**(不进 CFG.skins,也不进存档):走的是卡片那同一条渲染路径,
   *  只是 id 用族 id、价格用买断价、脸面缩略图画族里最贵的那一款(货架上先给买家看最好的)。 */
  private _famCard(fam: SkinFamily): SkinDef {
    const defs = fam.members
      .map((id) => Career.skinById(id))
      .filter((s): s is SkinDef => !!s);
    const best = defs.reduce((a, b) => (b.price > a.price ? b : a), defs[0]);
    return {
      id: fam.id, kind: fam.kind, name: fam.name,
      price: fam.price, rarity: fam.rarity,
      faceStyle: best?.faceStyle,
    };
  }

  /** 一张卡此刻的四件读数:穿着没有 / 到手没有 / 该报多少钱 / 那个价是不是**打包价**。
   *  三条车道各有一个唯一出处,这里只负责取,不在 UI 里算第二份:
   *   · 穿戴件 → owned 数组 + accAt(槽位落点在 career 那张描述符表里,脸面落 equipped.face);
   *   · 套装   → Career.setPrice(补齐差价)与 Career.wearsSet(是否恰好整套在身上);
   *   · 族卡   → Career.ownsFamily(同槽互斥的那套老口径)。
   *  `bundle` 是给状态行用的:几格全写「金币 168」会被读成每件各 168,写「补齐 168」才是一句话。 */
  private _cardState(s: SkinDef | CosmeticDef): { worn: boolean; owned: boolean; price: number; bundle: boolean } {
    const prof = Career.profile();
    if (isCosmo(s)) {
      return {
        worn: Career.accAt(prof, s.slot) === s.id,
        owned: Career.owns(s.id),
        price: s.price,
        bundle: false,
      };
    }
    if (s.kind === "player" && s.parts) {
      const pr = Career.setPrice(s.id);
      return {
        worn: Career.wearsSet(s.id),
        owned: pr.have,
        price: pr.charge,
        bundle: true,
      };
    }
    const asFamily = Career.familyOf(s.id);
    if (asFamily) {
      return {
        worn: asFamily.members.includes(prof.equipped[asFamily.kind]),
        owned: Career.ownsFamily(asFamily.id),
        price: asFamily.price,
        bundle: true,
      };
    }
    const of = Career.familyOfSkin(s.id);
    return {
      worn: prof.equipped[s.kind] === s.id,
      owned: Career.owns(s.id) || (!!of && Career.ownsFamily(of.id)),
      price: of ? of.price : s.price,
      bundle: !!of,
    };
  }

  /** 进族二级货架的唯一入口(选中族卡后按动作键/键盘 Enter;点卡只选中)。进来先停在
   *  身上正穿着的那一款(没穿族里的停在第一格) */
  private _openFamily(fid: string) {
    const fam = CFG.families[fid];
    if (!fam) return;
    this._fam = fid;
    this._sel = Math.max(0, fam.members.indexOf(Career.profile().equipped[fam.kind]));
    this._resetShelf();
    this._refresh();
  }

  /** 返回 = 回到整族货架,并且**停在刚出去的那张族卡上**,不把人丢回第一格 */
  private _closeFamily() {
    const fid = this._fam;
    if (!fid) return;
    this._fam = null;
    this._sel = Math.max(0, this._list().findIndex((s) => s.id === fid));
    this._resetShelf();
    this._refresh();
  }

  /** 进套装二级货架的唯一入口(选中套装卡后按动作键/键盘 Enter;点卡只选中):
   *  摆它包含的那几件单件,进来先停在身上正穿着的那一件(一件都没穿就停在第一格 = 免费底款)。 */
  private _openBundle(setId: string) {
    const set = Career.skinById(setId);
    if (!set?.parts) return;
    this._bundle = setId;
    const prof = Career.profile();
    const pieces = this._list();
    const wornIdx = pieces.findIndex((c) => Career.accAt(prof, (c as CosmeticDef).slot) === c.id);
    this._sel = Math.max(0, wornIdx);
    this._resetShelf();
    this._refresh();
  }

  /** 从套装二级货架返回:停在刚出去的那张套装卡上(与 _closeFamily 同一条口径) */
  private _closeBundle() {
    const sid = this._bundle;
    if (!sid) return;
    this._bundle = null;
    this._sel = Math.max(0, this._list().findIndex((s) => s.id === sid));
    this._resetShelf();
    this._refresh();
  }

  /** 换货架(切 tab / 进出二级界面)都要复位滚动:别停在上一页的行位置 */
  private _resetShelf() {
    this._elapsed = 0;
    this._scrollY = 0;
    this._vel = 0;
    this._easeTo = null;
    this._dragId = null;
    this._dragMoved = false;
  }

  private _buildGrid() {
    // 先定货架几何,再建壳:可视窗的高就是从这里来的(形象页要让出钉住的子页签带)
    this._curShelf = this._kind === "acc" ? accShelf(SLOT_ROW_N) : SHELF;
    if (this._vpH && this._vpH !== this._curShelf.h) this._destroyGridShell();
    this._ensureGridShell();
    const host = this._contentNode;
    if (!this._gridNode || !host || !host.isValid) return;
    // 清空旧卡片:只清货架,别把挂着 Mask 的可视窗和滚动条一起摘了
    clearKids(host)
    this._buildBack();
    this._buildSubAction();
    this._buildAccSlots();

    const list = this._list();
    // 形象页的窗变矮让出子页签行(几何真话在 shop-shelf.accShelf);
    // _revealSel 用同一份 _curShelf,两边不各拿一份 SHELF
    const lay = shelfLayout(list.length, this._curShelf);
    const cols = lay.cols;
    const lefts = hbox(Array(cols).fill(CARD_W), GAP);
    const prof = Career.profile();

    // 行数决定货架多高:超过窗高才有得滚,滚动条也才有得画(算法与出处见 shop-shelf.ts)
    this._rows = lay.rows;
    this._maxScroll = lay.maxScroll;
    // 货架方框要始终盖住整扇窗(上下各多让 maxScroll),否则滚到底时窗底那一条
    // 落在货架框外 —— 手指从卡片缝隙起手的拖动就收不到 TOUCH_START 了。
    host.getComponent(UITransform)!.setContentSize(GRID_W, this._curShelf.h + 2 * lay.maxScroll);
    if (this._scrollY > this._maxScroll) {
      this._scrollY = this._maxScroll;
      this._vel = 0;
      this._easeTo = null;
    }

    list.forEach((s, i) => {
      const row = Math.floor(i / cols);
      const x = lefts[i % cols] + CARD_W / 2;
      const y = rowTopY(row, this._curShelf) - CARD_H / 2;

      // 装备/拥有/价格三件读数同源(族卡与族内成员看整族,口径在 _cardState)
      const st = this._cardState(s);
      const equipped = st.worn;
      const owned = st.owned;
      const locked = !Career.unlocked(s);
      const broke = !owned && !locked && prof.coins < st.price;
      const rarity = s.rarity ?? "common";
      const rmeta = CFG.rarity[rarity];
      // 稀有度色只有**一个**出处:config 的 RARITY_META(它带着中文名与色值)。
      // 不在面板里另拍一套紫色 —— 本轮改版要消灭的就是「同一套色在五处各存一份」。
      const rarityHex = rmeta.color;
      const rarityCol = parseColor(rarityHex, COL.white);

      // 卡片节点
      const card = mkNode(`card-${i}`, host, CARD_W, CARD_H);
      card.setPosition(x, y, 0);

      const g = card.addComponent(Graphics);
      const sel = i === this._sel;
      // 卡片 = 墨面 + 顶部一条稀有度色带 + 同色 keyline(cardDL)。
      // **不整面涂稀有度色**:一屏 8~16 张各涂满黄/紫/蓝会排成五色彩虹,
      // 而 P5 的底色语言是红黑白主导 + 点缀 —— 色只负责报「这卡什么档」。
      // 层级仍是:装备中(绿带 + glow)> 选中(acid 带 + glow)> 稀有度色带 > 锁定。
      const bandHex = equipped ? C.good : sel ? C.acid : rarity !== "common" ? rarityHex : C.line;
      retainedDraw(g, () => drawP5Card(g, CARD_W, CARD_H, bandHex, {
        bandH: 24,
        locked: locked || (!equipped && !sel && rarity === "common"),
        glow: equipped || sel,
        teeth: 0,
      }));
      if (rarity === "legendary" && !locked) {
        // 传说款:右上角一枚同色四尖星印章,货架上第一个被看到(旧版是一圈 5px 微光描边)
        drawStarSeal(g, CARD_W / 2 - 13, CARD_H / 2 - 13, 9, rarityHex);
      }

      // 缩略图区域
      const thumbW = 64, thumbH = 76;
      const thumbNode = mkNode("thumb", card, thumbW, thumbH);
      thumbNode.setPosition(0, CARD_H / 2 - thumbH / 2 - 6, 0);
      const tg = thumbNode.addComponent(Graphics);
      this._drawCardThumb(tg, s);

      // 稀有度角标(common 不挂,基础款保持素净)
      if (rarity !== "common") {
        // 稀有度角标:斜切小片,面色即稀有度色,字色由亮度算(不再硬写墨黑)
        const chip = makeChip(card, rmeta.name, 9, rarityHex, inkFor(rarityHex), SLANT.band);
        chip.setPosition(-CARD_W / 2 + 21, CARD_H / 2 - 8, 0);
      }

      // 名称。三行字的字号/行心/可用宽一律读 shop-shelf.CARD_TEXT ——
      // Label 默认 Overflow.NONE,给它 w 只是给它一个它不会遵守的盒子,
      // 所以文案在摆出去之前先按同一把尺折行/截尾(判据 cardTextFits 量的也是这一份)。
      const nameColor = locked ? COL.dimGray : COL.white;
      mkLabel(card, "name", cardLine(s.name, CARD_TEXT.nameSize), CARD_TEXT.nameSize, nameColor, {
        y: CARD_TEXT.nameY, w: cardInnerW(), align: 1,
      });

      // 状态行。套装那一格说的不是"这一件多少钱",而是**还差几件的钱**:
      // 零散买过其中两件的人,看到「金币 888」会以为又在收一次全套 —— 那是把人往外推。
      let statusText: string, statusColor: Color;
      const setPr = s.kind === "player" && s.parts ? Career.setPrice(s.id) : null;
      if (equipped) { statusText = "装备中"; statusColor = COL.green; }
      else if (owned) { statusText = setPr ? "已集齐整套" : "已拥有"; statusColor = COL.dimWhite; }
      else if (locked) { statusText = `Lv.${s.unlockLevel} 解锁`; statusColor = COL.dimGray; }
      else if (setPr) {
        statusText = setPr.lack < setPr.total ? `补齐 ${setPr.charge}` : `整套 ${setPr.charge}`;
        statusColor = broke ? COL.dimGray : COL.gold;
      }
      else { statusText = st.bundle ? `买断 ${st.price}` : `金币 ${st.price}`; statusColor = broke ? COL.dimGray : COL.gold; }
      mkLabel(card, "status", cardLine(statusText, CARD_TEXT.statusSize), CARD_TEXT.statusSize, statusColor, {
        y: CARD_TEXT.statusY, w: cardInnerW(), align: 1,
      });

      // 卖点小字(设计款专属效果,稀有度色):折成几行摆几行,行心由排版那边给
      const fx = cardFxLines(fxTag(s));
      const ys = cardFxYs(fx.length);
      fx.forEach((line, k) => {
        mkLabel(card, `fx${k}`, line, CARD_TEXT.fxSize,
          new Color(rarityCol.r, rarityCol.g, rarityCol.b, 215), {
            y: ys[k], w: cardInnerW(), align: 1,
          });
      });

      // 锁定遮罩(独立子节点:一个节点只能挂一个 renderable,card 已有背景 Graphics)
      // 锁定/买不起:凹陷槽本身已经把卡压暗了,不再叠一层圆角黑罩(那会把斜切边露在外面)。
      // 只补一枚锁形印章 —— 用 Graphics,不用 🔒:原生 Android 没有彩色 emoji 字体。
      if (locked) {
        const ovNode = mkNode("lock-mark", card, 26, 26);
        ovNode.setPosition(0, 6, 0);
        const ov = ovNode.addComponent(Graphics);
        retainedDraw(ov, () => drawRankBadge(ov, "lock", 24, C.dimDeep));
      }

      // 点击 = 只选中:右侧试衣间马上换人,下方按钮改口径;金币不动。
      // 族卡/套装卡也不例外 —— 选中套装试穿整套、选中族卡看当前形象,进二级货架
      // 只有一条路:底部动作键(「看组成」/「挑一款…」,键盘 Enter 同路)。
      // (先注册业务回调再补按压反馈:重建网格销毁卡片时动画不会晚到一步)
      const idx = i;
      card.on(Node.EventType.TOUCH_END, () => {
        if (this._dragMoved) return;   // 这一指是在滑货架,不是在点卡片
        this._select(idx);
      });
      pressFx(card);
    });

    this._applyScroll();
  }

  /** 配饰 tab 的子页签行:四个槽位 chip 钉在网格窗顶部(不随滚动 —— 挂 gridArea,
   *  与可视窗/返回键平级,Mask 只裁自己的子孙)。随 _buildGrid 重建,不用 active 开关
   *  (原生侧 Graphics 渲染数据会在 onDisable 被清);chip 上带一枚「已佩戴」小圆点,
   *  颜色就是那件配饰自己的 main —— 一眼读出「这个槽已经戴了什么色」。 */
  private _buildAccSlots() {
    if (this._accSlotBar && this._accSlotBar.isValid) this._accSlotBar.destroy();
    this._accSlotBar = null;
    if (this._kind !== "acc" || !this._gridNode || !this._gridNode.isValid) return;

    const K = shopContent(CONTENT_H);
    const chips = accSlotRows(K.grid, SLOT_ROWS);
    // bar 挂在 gridArea 上,**它自己就在网格窗中心** —— chip 的局部坐标已经按
    // 「窗中心为原点」算好(b.center − grid.center),bar 再摆到面板系的网格中心
    // 就是把整排子页签又平移一倍(现场:四个 chip 集体左移出面板左缘、压住商品卡)。
    // 与 _buildBack 同一条参照系:父节点 = 网格窗中心,子件摆相对量。
    const bar = mkNode("accSlots", this._gridNode, GRID_W, accBandH(SLOT_ROW_N));
    bar.setPosition(0, 0, 0);
    this._accSlotBar = bar;

    CFG.accSlots.forEach((slot, i) => {
      const b = chips[i];
      const w = b.right - b.left;
      const t = solidTab({
        name: `accSlot-${slot.key}`, parent: bar, label: slot.name,
        w, h: b.h, role: "info", size: 14,
      });
      t.paint(this._accSlot === slot.key);
      t.node.setPosition((b.left + b.right) / 2 - (K.grid.left + K.grid.right) / 2, b.cy - K.grid.cy, 0);
      // 这里原先有一枚「已佩戴」色点(点色 = 该槽那件的主色)。删了:近黑的描边压在近黑的
      // chip 上,墨黑球鞋/墨黑球袜那点根本看不见;而它没有任何地方解释自己是什么 ——
      // 用户盯着红点问"这是什么意思"就是结论。槽位状态不靠猜:点进 chip,货架上那一件
      // 自己写着「装备中」,右侧试衣间立刻演出全身效果,两处都比一枚无字小点说得清。
      t.node.on(Button.EventType.CLICK, () => {
        if (this._accSlot === slot.key) return;
        this._accSlot = slot.key;
        this._sel = 0;
        this._resetShelf();
        this._refresh();
      });
    });
  }

  /** 二级货架的「返回」键:摆在货架窗底部那条空带里(几何与判据都在 shop-shelf.shopSubBack)。
   *  挂在 gridArea 上、与可视窗**平级** —— Mask 只裁自己的子孙,滚动条就是这么活下来的。
   *  随 _buildGrid 一起重建:不用 active 开关(原生侧 Graphics 渲染数据会在 onDisable 被清)。 */
  private _buildBack() {
    if (this._backNode && this._backNode.isValid) this._backNode.destroy();
    this._backNode = null;
    const fam = this._fam ? CFG.families[this._fam] : null;
    // 族货架与套装货架共用这一颗「返回」:谁在二级态就接谁的返回。两颗长在一起的返回键
    // 读起来就是界面坏了,而套装页永远不可能同时开着族。
    const inBundle = !fam && !!this._bundle;
    if ((!fam && !inBundle) || !this._gridNode || !this._gridNode.isValid) return;

    const b = shopSubBack();
    const K = shopContent(CONTENT_H);
    const t = solidTab({
      name: "subBack", parent: this._gridNode, label: "返回",
      w: b.right - b.left, h: b.h, role: "info", size: 15,
    });
    t.paint(true);   // 常态走实底青块:凹陷槽在这个位置会被读成「这颗键坏了」
    t.node.setPosition((b.left + b.right) / 2 - (K.grid.left + K.grid.right) / 2, b.cy - K.grid.cy, 0);
    t.node.on(Button.EventType.CLICK, () => (fam ? this._closeFamily() : this._closeBundle()));
    this._backNode = t.node;
  }

  /** 套装二级货架「一键穿戴」键:与「返回」同一条底部空带、贴右(几何 shop-shelf.shopSubAction)。
   *  只在套装二级态建(族货架没有"穿一整套"这件事,脸面同槽互斥);挂在 gridArea 上、与
   *  可视窗平级 —— Mask 只裁自己的子孙,返回键就是这么活下来的。随 _buildGrid 重建:
   *  在二级货架里买散件,补齐价当场变、集齐当场换字,不用另写一套状态同步。
   *  文案与成交链吃 _setActView/_actSet 一把尺(按钮带价 = 补齐价 charge)—— 套装成交
   *  只有这一颗键,一级套装卡的按钮是「看组成」入口,不碰钱。 */
  private _buildSubAction() {
    if (this._subActNode && this._subActNode.isValid) this._subActNode.destroy();
    this._subActNode = null;
    if (this._fam || !this._bundle || !this._gridNode || !this._gridNode.isValid) return;

    const b = shopSubAction();
    const K = shopContent(CONTENT_H);
    const w = b.right - b.left;
    const n = mkNode("subAction", this._gridNode, w, b.h);
    n.setPosition((b.left + b.right) / 2 - (K.grid.left + K.grid.right) / 2, b.cy - K.grid.cy, 0);
    const g = n.addComponent(Graphics);
    const lb = mkLabel(n, "subActTxt", "", 15, COL.white, { y: 0, w: w - 16, align: 1 });
    // 与一级动作键同一张脸:有面 = 实底大色块(能成交),无面 = 凹陷槽(不可成交,点了只报原因)
    const v = this._setActView(this._bundle);
    if (v.face) drawP5Block(g, w, b.h, v.face, SLANT.button);
    else drawBevelSlot(g, w, b.h, SLANT.button);
    lb.string = v.text;
    lb.color = v.fg;
    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 0.95;
    btn.target = n;
    n.on(Button.EventType.CLICK, () => { if (this._bundle) this._actSet(this._bundle); });
    this._subActNode = n;
  }

  // ---------- 卡片缩略图 ----------

  /** 卡片缩略图。分支一律按**商品自己的 kind**判,不按所在格子判 ——
   *  脸面从顶栏搬进「配饰」的 chip 之后,拿 this._kind 判会一条都不命中,
   *  八张脸面的卡就全是空白(格子名与商品类型是两件事,前者会搬,后者不会)。 */
  private _drawCardThumb(g: Graphics, s: SkinDef | CosmeticDef) {
    g.clear();

    if (isCosmo(s)) {
      if (s.kind === "wear") {
        // 挂件件有"孤立的样子"可看:墨镜是墨镜、围巾是围巾,摆成商品挂展;
        // _clock 驱动微动画(镜面反光/尾梢慢波)
        drawAccStill(g, previewVp(1, 0, 0), s, Math.round(this._clock * 60));
        return;
      }
      // 本体件(上衣/发型/肤色/体型/袜/鞋/光环)**没有孤立的样子** —— 一件"樱花粉上衣"
      // 摊开就是几块布,买家要看的从来是「穿上之后」。所以卡片直接画缩小全身像,
      // 走 Career.lookOfCandidate:预览与成交后吃同一份合成,不可能长得不一样。
      const L = Career.lookOfCandidate(s);
      const p = dummyPlayer(L.theme, Career.skinOf("racket"), {
        playerSkin: L.skin, faceSkin: Career.skinOf("face"), acc: L.acc,
      });
      drawPlayer(g, previewVp(0.60, 0, -30), p, 0, 1, null);
      return;
    }

    if (s.kind === "player") {
      // 套装卡:挂这套的完整 def → 缩略图直接带发型/头饰/光环,设计款一眼可辨。
      // 脸也戴这套自带的那张(影分身是无面、猫系少女是猫须),不吃玩家此刻装备的脸面。
      const th = themeOf(s);
      const p = dummyPlayer(th, Career.skinOf("racket"), { playerSkin: s, faceSkin: faceOfSet(s) });
      drawPlayer(g, previewVp(0.60, 0, -30), p, 0, 1, null);
      return;
    }
    if (s.kind === "racket") {
      // 真球拍(与上场同一套 drawRacket,拍头朝上竖放;皮肤来自卡片本身)
      const p = dummyPlayer(themeOf(CFG.skins.player[0]), s);
      drawRacketStill(g, previewVp(1.30, 0, -26), 0, 0, 1, p);
      return;
    }
    if (s.kind === "shuttle") {
      // 真羽毛球(与上场同一套 drawShuttle,放大 2.05 对齐原版)
      drawShuttle(g, previewVp(2.05, 0, 4), dummyBall(), s);
      return;
    }
    // 脸面:大头像(与上场同一套 drawHead),常态表情,换什么脸一眼可辨。
    // 底色走这张脸自己的 FACE_STYLES.base —— 玩家的肤色不上脸,所以「纯黑肤 + 猫系脸面」
    // 的卡与试衣间里那张猫系脸是同一个颜色(2026-10-07 解耦)。当前形象只用来把
    // "跟随人物"那一款解析成他身上这套人物自带的脸(族里首格「普通肤色」恒肤色,不吃它)。
    const cur = Career.look();
    drawHeadStill(g, previewVp(2.1, 0, 10), 0, 0, 1,
      cur.theme, faceStyleOf(s, cur.skin), "normal", 0);
  }

  // ========== 选中 / 成交 ==========

  /** 点卡片只做「选中」:试衣间换人、按钮换文案,金币一分不动 */
  private _select(index: number) {
    if (this._kind === "stats") return;
    if (!this._list()[index]) return;
    this._sel = index;
    this._elapsed = 0;
    this._buildGrid();
    this._revealSel();   // 按到只露半截的卡片时把它整个带进窗里(只挪必要的那一点)
    this._drawLivePreview();
    this._updateAction();
  }

  /** 按钮此刻该说什么 —— 买不成时把「为什么不行」直接写在按钮上,不用点了才知道 */
  /**
   * 按钮三态:面色 + 字色成对给出。`face: null` = 凹陷槽(不可成交的状态),
   * 有面 = 整块实底大色块 —— 商店里唯一花钱的地方必须是最亮的那一块。
   * 字色一律 inkFor(面色),不再硬写「浅粉白」。
   */
  /** 这一槽允不允许空着?由槽位描述符说了算(有免费底款的槽不许空 —— 「回到原版」是
   *  一张卡,不是一颗卸下键)。卸下只对真能空着的槽开放,否则按下去会得到一个隐形状态。 */
  private _slotCanEmpty(s: CosmeticDef): boolean {
    return !CFG.accSlots.find((m) => m.key === s.slot)?.base;
  }

  private _actView(): { text: string; face: string | null; fg: Color } {
    const kind = this._kind;
    if (kind === "stats") return { text: "", face: null, fg: COL.dimGray };
    const s = this._list()[this._sel];
    if (!s) return { text: "", face: null, fg: COL.dimGray };
    const p = Career.profile();
    const buyFg = ac(inkFor(ROLE.primary.face));
    const short = (price: number): { text: string; face: null; fg: Color } =>
      ({ text: `金币不足 · 还差 ${price - p.coins}`, face: null, fg: COL.dimGray });

    // ---------- 穿戴件:四态(卸下 / 穿上 / 买即穿 / 购买) ----------
    if (isCosmo(s)) {
      const st = this._cardState(s);
      if (st.worn) {
        return this._slotCanEmpty(s)
          ? { text: "卸下这一件", face: ROLE.info.face, fg: ac(inkFor(ROLE.info.face)) }
          : { text: "已经穿着", face: null, fg: COL.green };
      }
      if (st.owned) return { text: "穿上身", face: ROLE.star.face, fg: ac(inkFor(ROLE.star.face)) };
      if (!Career.unlocked(s)) return { text: `Lv.${s.unlockLevel ?? "?"} 解锁`, face: null, fg: COL.dimGray };
      if (p.coins < s.price) return short(s.price);
      return { text: `购买 · ${s.price} 金币`, face: ROLE.primary.face, fg: buyFg };
    }

    // ---------- 套装卡不直接成交:按钮是「进去看组成」的入口,和族卡同一条口径。
    // 成交(补齐+整套穿上)只发生在二级货架的「一键穿戴」上,话术住在 _setActView ----------
    if (s.kind === "player" && s.parts) {
      return { text: `看${s.name}的组成`, face: ROLE.info.face, fg: ac(inkFor(ROLE.info.face)) };
    }

    // 族卡不成交:按钮说的是「进去挑一款」。点卡片只选中,进二级全靠这一颗(键盘 Enter 同路)
    const fam = Career.familyOf(s.id);
    if (fam) return { text: `挑一款${fam.name}`, face: ROLE.info.face, fg: ac(inkFor(ROLE.info.face)) };

    const st = this._cardState(s);
    if (st.worn) return { text: "已经装备", face: null, fg: COL.green };
    // 族已入手 ⇒ 族内任何一款都算"装备上身"(没在 owned 里的那一款按下去走免费补票)
    if (st.owned) return { text: "装备上身", face: ROLE.star.face, fg: ac(inkFor(ROLE.star.face)) };
    if (!Career.unlocked(s)) return { text: `Lv.${s.unlockLevel ?? "?"} 解锁`, face: null, fg: COL.dimGray };
    if (s.price === 0) return { text: "免费领取", face: ROLE.primary.face, fg: buyFg };
    if (p.coins < st.price) return short(st.price);
    const of = Career.familyOfSkin(s.id);
    if (of) return { text: `买断全族 · ${of.price} 金币`, face: ROLE.primary.face, fg: buyFg };
    return { text: `购买 · ${s.price} 金币`, face: ROLE.primary.face, fg: buyFg };
  }

  /** 套装二级货架「一键穿戴」的五态真话(一级套装卡的按钮是「看组成」入口,不吃这份)。
   *  带价时只报一个 charge —— 那本来就是按缺几件折过的补齐价,成交 toast 会把
   *  "一并到手几件"说清。不可成交的状态一律 face:null(凹陷槽),点了不扣钱、由 _actSet 报原因。 */
  private _setActView(id: string): { text: string; face: string | null; fg: Color } {
    const s = Career.skinById(id);
    if (!s?.parts) return { text: "", face: null, fg: COL.dimGray };
    const st = this._cardState(s);
    const pr = Career.setPrice(s.id);
    if (st.worn) return { text: "整套已穿在身上", face: null, fg: COL.green };
    if (!Career.unlocked(s)) return { text: `Lv.${s.unlockLevel ?? "?"} 解锁`, face: null, fg: COL.dimGray };
    if (st.owned || pr.charge === 0) return { text: "一键穿戴", face: ROLE.star.face, fg: ac(inkFor(ROLE.star.face)) };
    const p = Career.profile();
    if (p.coins < pr.charge) {
      return { text: `金币不足 · 还差 ${pr.charge - p.coins}`, face: null, fg: COL.dimGray };
    }
    return { text: `一键穿戴 · ${pr.charge} 金币`, face: ROLE.primary.face, fg: ac(inkFor(ROLE.primary.face)) };
  }

  /** 底块单独走一遍,好让 retainedDraw 的重放和状态刷新用同一张脸 */
  private _drawActionFace() {
    const g = this._actGfx;
    if (!g || !g.isValid) return;
    g.clear();
    const face = this._actView().face;
    if (face) drawP5Block(g, ACT_W, ACT_H, face, SLANT.button);
    else drawBevelSlot(g, ACT_W, ACT_H, SLANT.button);
  }

  private _updateAction() {
    const v = this._actView();
    if (this._actLabel) {
      this._actLabel.string = v.text;
      this._actLabel.color = v.fg;
    }
    this._drawActionFace();
  }

  /** 唯一的成交入口:按钮点按与键盘 Enter 走同一条道 */
  private _act() {
    const kind = this._kind;
    if (kind === "stats") return;
    const s = this._list()[this._sel];
    if (!s) return;

    // ---------- 穿戴件三态:卸下 / 穿上 / 买即穿(金币链与皮肤同一条,见 career.buyAcc) ----------
    if (isCosmo(s)) {
      const st = this._cardState(s);
      if (st.worn) {
        if (!this._slotCanEmpty(s)) { this._showToast("这一件已经穿在身上了"); return; }
        Career.unequipAcc(s.slot);
        this._showToast(`已卸下「${s.name}」`);
      } else if (st.owned) {
        Career.equipAcc(s.id);
        this._showToast(`已穿上「${s.name}」`);
      } else {
        const r = Career.buyAcc(s.id);
        this._showToast(r.ok ? `入手「${s.name}」并已穿上!` : (r.reason ?? "购买失败"));
      }
      this._elapsed = 0;
      this._refresh();
      return;
    }

    // ---------- 套装卡按下去 = 进二级货架看组成(金币一分不动)。成交只有一条链:
    // 二级货架那颗「一键穿戴」走 _actSet —— 一级卡选中后按钮只管导航,不再直接花钱 ----------
    if (s.kind === "player" && s.parts) {
      this._openBundle(s.id);
      return;
    }

    const fam = Career.familyOf(s.id);
    if (fam) { this._openFamily(fam.id); return; }   // 族卡按下去 = 进二级货架,金币一分不动

    // 走到这里的一定是皮肤货架(上面的穿戴件与套装分支已提前返回)。
    // 装备的目标类取**商品自己的 kind**,不取 this._kind —— 脸面现在摆在「配饰」那一格里,
    // 但它仍然落 equipped.face;拿格子名当类名,按下去就会去写一个不存在的 "acc" 类。
    const k = s.kind;
    const p = Career.profile();
    if (p.equipped[k] === s.id) {
      this._showToast("已经穿在身上了");
      return;
    }
    if (Career.owns(s.id)) {
      Career.equip(k, s.id);
      this._showToast(`已装备「${s.name}」`);
    } else {
      // 买人物 ⇒ 自带脸面一起到手(捆绑住在 Career.profile() 归一化里)。
      // 「送」字要在成交**之前**问一次有没有,别对着早就拥有的东西报喜
      const gift = k === "player" ? Career.linkedFace(s.id) : null;
      const had = gift ? Career.owns(gift.id) : false;
      const of = Career.familyOfSkin(s.id);
      const r = Career.buyAndEquip(k, s.id);
      if (!r.ok) this._showToast(r.reason ?? "购买失败");
      else if (r.family === "bought" && of) {
        // 一次扣族价拿下整族:把"还送了什么"说清楚,否则买家只看到钱少了
        const extra = of.members.filter((m) => (Career.skinById(m)?.price ?? 0) > 0).length;
        this._showToast(`买断「${of.name}」· ${extra} 款脸面随意换`);
      } else if (gift && !had) this._showToast(`入手「${s.name}」并已装备!送「${gift.name}」`);
      else this._showToast(`入手「${s.name}」并已装备!`);
    }
    this._elapsed = 0;
    this._refresh();
  }

  /** 套装成交:一次补齐 + 逐槽穿上。二级货架「一键穿戴」的唯一成交链
   *  (买仍住在 Career.buy 里,这里只多走一步装备);不可成交的状态点了只报原因、不扣钱。 */
  private _actSet(id: string) {
    const s = Career.skinById(id);
    if (!s?.parts) return;
    const st = this._cardState(s);
    if (st.worn) { this._showToast("整套已经穿在身上了"); return; }
    if (!Career.unlocked(s)) { this._showToast(`Lv.${s.unlockLevel} 解锁`); return; }
    const pr = Career.setPrice(s.id);
    // 「送了几件」要在成交**之前**问,别对着早就拥有的东西报喜
    const gift = pr.have ? 0 : Career.setItems(s).filter((i) => i.price > 0 && !Career.owns(i.id)).length;
    if (!st.owned && pr.charge > 0) {
      const r = Career.buy(s.id);
      if (!r.ok) { this._showToast(r.reason ?? "购买失败"); return; }
    }
    if (!Career.equipSet(s.id)) { this._showToast("先买下这套的组成件"); return; }
    this._showToast(gift > 0
      ? `入手「${s.name}」整套 · ${gift} 件一并到手,已穿上!`
      : `已整套穿上「${s.name}」`);
    this._elapsed = 0;
    this._refresh();
  }

  // ========== Tab 切换 ==========

  private _setKind(k: SkinKind | "acc" | "stats") {
    this._kind = k;
    this._sel = 0;
    this._fam = null;   // 换 tab 就出了这一族,二级货架随之收
    this._bundle = null; // 套装的二级货架同理:换格子还停在上一套的组成件里就是迷路
    this._resetShelf();
    this._refresh();
  }

  // ========== 统计页 ==========

  private _buildStatsPage() {
    if (!this._gridNode) return;

    // 履历页没有商店预览可看,统计卡直接铺满面板宽(老 .career-stats-page 也是整页网格)
    if (!this._statsNode) {
      this._statsNode = mkNode("statsPage", this._gridNode.parent!, PW - 40, CONTENT_H);
      this._statsNode.setPosition(0, shopContent(CONTENT_H).grid.cy, 0);
    }

    // 清空旧统计卡片
    clearKids(this._statsNode)

    const cells = statCells(Career.profile(), DRILL_STARS_MAX, Career.milestoneViews());

    // 六格的格位与格内排版都由 shop-shelf 给(与 shopOverlaps / shopOverflow / statCardFits 同一套数)
    const boxes = shopStats(CONTENT_H);
    const gridCy = shopContent(CONTENT_H).grid.cy;

    cells.forEach((c, i) => {
      const b = boxes[i];
      const cw = b.right - b.left, ch = b.h;
      const node = mkNode(`stat-${i}`, this._statsNode!, cw, ch);
      node.setPosition((b.left + b.right) / 2, b.cy - gridCy, 0);
      const d = statCardDL(cw, ch, c);
      const face = ROLE[c.role].face;

      const g = node.addComponent(Graphics);
      // 墨面 + 同色 keyline。**不再压一条通宽实心色带**:那条带子和它下面的数字同色,
      // 什么也没报(装饰),而且它的斜切量按自己的 26 高算、卡框按 136 高算,两边不平行
      // ⇒ 一侧戳出卡框、一侧留缝,就是用户说的「那个条形底板不太对」。
      // 里程碑可领的卡点亮 glow(与货架卡选中态同一参数):这里只管画,「可不可领」
      // 的判定在 shop-shelf.statCells 的三态里,面板不重复算第二遍。
      const claim = !!c.claim;
      retainedDraw(g, () => drawP5Card(g, cw, ch, face, { bandH: 0, glow: claim }));

      // 引导线**另起一个节点**:cc 的 Graphics 上 stroke() 不清路径(AGENTS.md 坑 8),
      // 画在同一张画布上会把卡框 keyline 再描一遍,0.55 的边被叠成 0.78 —— 一条线的钱,
      // 不该由整圈框来付。子节点自己 retainedDraw,切页回来照样重画。
      const ruleNode = mkNode("rule", node, cw, STAT.ruleW + 2);
      const rg = ruleNode.addComponent(Graphics);
      retainedDraw(rg, () => {
        rg.strokeColor = ac(face, 0.5);
        rg.lineWidth = STAT.ruleW;
        rg.moveTo(d.rule.x0, d.rule.y);
        rg.lineTo(d.rule.x1, d.rule.y);
        rg.stroke();
      });

      // 标题 = 一枚包住指标名的色签(与货架卡右上角那枚稀有度角签**同一件工具**、同一份
      // chipDL 点列),字色由面色亮度推(亮面墨黑、暗面纸白),不硬写。
      makeChip(node, c.name, STAT.chipSize, face, inkFor(face), SLANT.band)
        .setPosition(d.chip.x, d.chip.y, 0);

      // 大数 + 小单位:两个 Label 按量出来的宽度配成一对整体居中;大字走 MiSans-Heavy,
      // 与 HUD 比分、结算大数同一支笔(旧版 30 号正文白字,压在墨面上毫无分量)。
      // **数不跟着角色走色**:斩劈红 #e60012 压在 navy2 墨面上只有 3.5:1,过不了
      // CONTRAST_FLOOR —— 卡片语法自己的口径就是「色报档位,墨面承载文字」。
      // 所以色留在色签 / 引导线 / keyline 三处,数字一律纸白,六格读起来反而更齐。
      mkLabel(node, "num", c.num, STAT.numSize, ac(C.paper), {
        x: d.num.x, y: d.num.y, w: d.num.w + 8, align: 0, disp: true,
      });
      if (c.unit) mkLabel(node, "unit", c.unit, STAT.unitSize, COL.dimWhite, {
        x: d.unit.x, y: d.unit.y, w: d.unit.w + 8, align: 0, disp: true,
      });
      if (c.sub) mkLabel(node, "sub", c.sub, STAT.subSize, claim ? COL.gold : COL.dimGray, {
        x: d.sub.x, y: d.sub.y, w: cw - STAT.padX * 2, align: 1,
      });

      // 里程碑可领 → 整卡即按钮(268×136 远超触控下限),点按领取;发奖与记账都在
      // Career.claimMilestone 一处,面板只管喊话与重建。
      if (c.claim) {
        pressable(node);
        onTap(node, () => this._claimMilestone(c.key));
      }
    });
  }

  // 生涯里程碑领取(2026-10-07):可领卡整卡点按 → Career 发奖(金币+经验走同一条
  // 经济轨道)→ toast 播报 → _refresh() 重建六格并同步顶栏金币。无可领时 Career 返回
  // null,这里静默返回(卡片本来就是照「可领」态建的,正常点不到这条路)。
  private _claimMilestone(key: MilestoneStat) {
    const r = Career.claimMilestone(key);
    if (!r) return;
    const ups = r.levelUps.length ? ` 升级 Lv.${r.levelUps[r.levelUps.length - 1]}!` : "";
    this._showToast(`里程碑达成!+${r.coin}金币 +${r.exp}经验${ups}`);
    this._refresh();
  }

  // ========== 实时预览 ==========

  private _drawLivePreview() {
    if (!this._previewGfx) return;
    const g = this._previewGfx;
    g.clear();

    const kind = this._kind;
    if (kind === "stats") return;

    const list = this._list();
    const s = list[this._sel];
    if (!s) return;

    // 当前真实形象:逐槽合成出来的那一份,不再是"equipped.player 那条 def"。
    // 玩家自己搭出来的混搭(黑肤 + 猫耳 + 王者拼色)必须在每一个 tab 的预览里都站着,
    // 否则买家在球拍页看到的"自己"是另一个人。
    const cur = Career.look();
    const curRacket = Career.skinOf("racket");

    // --- 配饰 tab:全身试衣间 —— 当前形象 + 选中件换上身的实时试穿。
    //     买家拍板的是「穿在我身上哪儿、什么效果」,单件静置画答不了这个问题;
    //     选中的那件**即时替换**它槽位上的现装(没戴也直接戴上),站姿呼吸看细节。 ---
    if (isCosmo(s)) {
      // 本体件走合成覆写(改的是 skin 的旋钮);挂件件改的是 acc 数组。两条通道各管各的槽。
      const L = Career.lookOfCandidate(s);
      const acc = s.kind === "wear"
        ? L.acc.filter((a) => a.slot !== s.slot).concat(s)
        : L.acc;
      const body = dummyPlayer(L.theme, curRacket, {
        playerSkin: L.skin, faceSkin: Career.skinOf("face"),
        acc,
        // 呼吸走不回卷的 _clock:_elapsed 每 2.2s 回卷,sin(6×2.2)≠sin(0),
        // 每个循环回卷瞬间整只人凭空坠一下(sin 没落在 0 上)
        y: Math.sin(this._clock * 6) * 2,
      });
      // alpha=0:预览逐帧画精确状态,没有"上一帧"可插值 —— drawPlayer 会把 alpha 加进
      // 挥拍/收拍状态里,传 1 等于每帧预先快进一帧,起拍/收拍边界各瞬移一大步
      drawPlayer(g, previewVp(1.5, 0, -45), body, Math.round(this._clock * 60), 0, null);
      if (this._previewName) {
        const rn = CFG.rarity[s.rarity].name;
        this._previewName.string = rn === "经典" ? s.name : `${s.name} · ${rn}`;
      }
      return;
    }

    // 试衣间:player tab 用候选套装+当前球拍;racket tab 反之。
    // playerSkin 挂完整定义 → 发型/头饰/光环在预览里实时可见
    const playerSkinDef = kind === "player" ? (s as SkinDef) : cur.skin;
    const playerTheme = kind === "player" ? themeOf(s as SkinDef) : cur.theme;
    const racketSkin = kind === "racket" ? (s as SkinDef) : curRacket;
    // 脸:候选那套戴它自带的脸;其余 tab 戴玩家此刻装备的那张(装备位是"跟随人物"时
    // 由 drawPlayer 现读身上这套)
    const faceSkinDef = kind === "player" ? faceOfSet(s as SkinDef) : Career.skinOf("face");

    // --- 羽毛球 tab:展示羽毛球 + 专属拖尾示意 ---
    if (kind === "shuttle") {
      const vp = previewVp(2.5, 0, 20);
      const ball = dummyBall();
      drawTrailHint(g, vp, s);
      drawShuttle(g, vp, ball, s);
      if (this._previewName) {
        const rn = CFG.rarity[s.rarity ?? "common"].name;
        this._previewName.string = `${s.name} · ${rn}`;
      }
      return;
    }

    // --- 面部 tab:全身 + 头部特写。买家要拍板的是「这张脸装在这身上什么效果」,
    //     只给一颗大头像看不出发型/球衣/肤色的整体搭配;但五官与心情腮红又必须
    //     看得清,所以两幅同屏、共用同一个表情时钟(不是两张各演各的)。 ---
    // 判据取**商品自己的 kind**,不取所在格子:脸面现在摆在「配饰」那一格的 chip 里,
    // 拿 this._kind 判就永远进不来这条分支(选中的脸根本不会画进预览)。
    if (s.kind === "face") {
      const exprs: FaceKind[] = ["normal", "happy", "star", "wow"];
      const seg = 2.2 / exprs.length;               // 与试衣间同一个 2.2s 循环时钟
      const expr = exprs[Math.min(exprs.length - 1, Math.floor(this._elapsed / seg))];
      const th = cur.theme;
      // 族卡不是一张脸:选中它时预览保持「当前形象 + 当前装备的脸」原样不动 —— 点它只代表
      // "要进这族挑一款"(按钮/Enter 才进二级),不是试穿族里任何一款;散脸卡才把候选画上身。
      const cand = Career.familyOf(s.id) ? Career.skinOf("face") : s;
      const style = faceStyleOf(cand, cur.skin);
      const sticker = expr === "normal" ? 0 : 666;  // >600 = 贴纸走「定格」分支

      // 左:头部特写(与上场同一套 drawHead 笔画,底色只来自这张脸自己);
      // 微动时钟走 _clock(表情循环才需要回卷的 _elapsed,微动不回卷)
      drawHeadStill(g, previewVp(2.6, -92, 52), 0, 0, 1, th, style, expr, this._clock);
      // 右:当前装备的人物 + 球拍,只把脸换成候选;站姿呼吸,不挥拍(挥拍会甩头,脸读不清)。
      // 1.5 与人物/球拍 tab 同一档 —— 三个 tab 里"你"该是一样大。
      const body = dummyPlayer(th, curRacket, {
        playerSkin: cur.skin, faceSkin: cand,
        face: expr, faceT: sticker, faceD: 666,
        y: Math.sin(this._clock * 6) * 2,
      });
      drawPlayer(g, previewVp(1.5, 45, -45), body, Math.round(this._clock * 60), 0, null);

      if (this._previewName) {
        const rn = CFG.rarity[s.rarity ?? "common"].name;
        this._previewName.string = rn === "经典" ? s.name : `${s.name} · ${rn}`;
      }
      return;
    }

    // --- player / racket:画完整小人 ---
    const vp = previewVp(1.5, 0, -45);

    // 动画状态(复刻老项目 2200ms 循环)
    let swingT = -1, recoverT = 0;
    let smashGlow = 0, sweetGlow = 0, contactFlash = 0;
    let bob = 0;
    const t = this._elapsed;

    if (t < 1.0) {
      // 待机呼吸
      bob = Math.sin(t * 6) * 2;
    } else if (t < 1.6) {
      // 挥拍
      const u = (t - 1.0) / 0.6;
      swingT = u * Physics.swingTotal();
      contactFlash = (u > 0.45 && u < 0.62) ? 1 : 0;
      smashGlow = (u > 0.45 && u < 0.75) ? 1 : 0;
      sweetGlow = (u > 0.45 && u < 0.75) ? 1 : 0;
    } else {
      // 收拍
      const u = (t - 1.6) / 0.6;
      recoverT = (1 - clamp(u, 0, 1)) * CFG.swing.blendOut;
    }

    const player = dummyPlayer(playerTheme, racketSkin, {
      playerSkin: playerSkinDef,
      faceSkin: faceSkinDef,
      swingT, swingStyle: "over",
      swingRadius: 52, recoverT,
      contactFlash, smashGlow, sweetGlow,
      y: bob,
    });

    // alpha=0:同配饰页 —— 预览画精确状态;传 1 会把起拍 blendIn 第一帧推到 56%、
    // 收拍 easeOutBack 第一帧推到 92%(整段回摆被压进一帧),每 2.2s 各瞬移一大步
    drawPlayer(g, vp, player, Math.round(this._clock * 60), 0, null);
    if (this._previewName) {
      const rn = CFG.rarity[s.rarity ?? "common"].name;
      this._previewName.string = rn === "经典" ? s.name : `${s.name} · ${rn}`;
    }
  }

  // ========== Toast 提示 ==========

  private _showToast(text: string) {
    if (!this._toastLabel || !this._toastOpacity) return;
    this._toastLabel.string = text;
    // 「金币不足,还差 xx」这类长短句都从这一条道走,底块跟着文案收放
    if (this._toastG) {
      const w = toastWidth(textW(text, TOAST.size));
      const g = this._toastG;
      g.node.getComponent(UITransform)!.setContentSize(w, TOAST.h);
      g.clear();
      // 整面荧光黄 + 墨黑字,与「装备上身」那颗键同一张脸(面色与字色成对来自 TOAST,
      // 不再一个走 ROLE.star.face、另一个抄 COL.gold —— 那两支笔是同一支,字就没了)。
      drawP5Block(g, w, TOAST.h, TOAST.face, SLANT.band);
    }
    // 同一车道的底部提示行让位,淡出时再摆回去(否则两行字叠在一条带上)
    if (this._hintLabel) this._hintLabel.string = "";
    this._toastOpacity.opacity = 255;
    this._toastTimer = 1.7; // 1.7秒后淡出
  }

  // ========== 刷新 ==========

  private _refresh() {
    if (!this._lvLabel || !this._lvNameLabel || !this._expLabel || !this._coinsLabel || !this._hintLabel) return;
    const p = Career.profile();

    // 等级
    this._lvLabel.string = `Lv.${p.level}`;
    this._lvNameLabel.string = LV_NAMES[clamp(p.level - 1, 0, LV_NAMES.length - 1)] ?? "";

    // 经验
    const need = Career.expNeed(p.level);
    const cap = CFG.career.level.cap;
    if (p.level >= cap) {
      this._expLabel.string = "MAX";
      this._drawExpBar(1);
    } else {
      this._expLabel.string = `${p.exp} / ${need} EXP`;
      this._drawExpBar(need > 0 ? p.exp / need : 0);
    }

    // 金币
    this._coinsLabel.string = `${p.coins}`;

    // Tab 高亮(acid 芯片 + 深字:老 .shop-tab.sel)
    this._tabHandles.forEach((h, i) => h.paint(KIND_ALL[i] === this._kind));

    // 内容区
    if (this._kind === "stats") {
      // 货架整棵收走而不是 active=false:原生侧 Mask/Graphics 的渲染数据会在 onDisable 被清
      this._destroyGridShell();
      // 履历页没有可预览的皮肤:右侧试衣间整块让位给统计卡
      if (this._previewArea) this._previewArea.active = false;
      this._buildStatsPage();
      if (this._statsNode) this._statsNode.active = true;
      this._hintWanted = "";   // 履历页全是数据,不需要一句口号压在下头
    } else {
      if (this._statsNode) this._statsNode.active = false;
      if (this._previewArea) this._previewArea.active = true;
      this._buildGrid();
      this._updateAction();
      // 只留一条真有信息量的:换球是全场生效的,其余标签页看名字就懂
      this._hintWanted = this._kind === "shuttle" ? "换球后全场生效" : "";
    }
    // 提示带在屏上的那 1.7s 里,这一行先让位 —— 两者共用面板底部那一条车道
    this._hintLabel.string = this._toastTimer > 0 ? "" : this._hintWanted;

    // 预览
    this._elapsed = 0;
    this._drawLivePreview();
  }

  /** 经验条:轨道与填充一次画完,两边都出自 progressDL ⇒ 左沿严格重合 */
  private _drawExpBar(ratio: number) {
    const g = this._expBarG;
    if (!g || !g.isValid || this._expW <= 0) return;
    g.clear();
    const dl = progressDL(this._expW, this._expH, clamp(ratio, 0, 1), C.acid);
    paintP5(g, dl.track);
    paintP5(g, dl.fill);
  }

  // ========== 键盘 ==========

  private _onKey(event: EventKeyboard) {
    if (!this.root) return;
    const code = event.keyCode;

    if (code === KeyCode.ARROW_LEFT || code === KeyCode.KEY_A) {
      const idx = KIND_ALL.indexOf(this._kind);
      this._setKind(KIND_ALL[(idx + KIND_ALL.length - 1) % KIND_ALL.length] as any);
      return;
    }
    if (code === KeyCode.ARROW_RIGHT || code === KeyCode.KEY_D) {
      const idx = KIND_ALL.indexOf(this._kind);
      this._setKind(KIND_ALL[(idx + 1) % KIND_ALL.length] as any);
      return;
    }
    if (code === KeyCode.ARROW_UP || code === KeyCode.KEY_W) {
      this._moveSel(-1); return;
    }
    if (code === KeyCode.ARROW_DOWN || code === KeyCode.KEY_S) {
      this._moveSel(1); return;
    }
    if (code === KeyCode.ENTER || code === KeyCode.SPACE) {
      this._act(); return;
    }
    if (code === KeyCode.ESCAPE || code === KeyCode.KEY_Q || code === KeyCode.KEY_B) {
      if (this._fam) { this._closeFamily(); return; }   // 在二级货架里,Esc 是先退一层而不是关店
      this._onCloseCb?.();
      this.hide();
    }
  }

  private _moveSel(d: number) {
    if (this._kind === "stats") return;
    const list = this._list();
    if (list.length === 0) return;
    this._sel = (this._sel + d + list.length) % list.length;
    this._elapsed = 0;
    this._buildGrid();
    this._revealSel();   // 选中了窗外那一行也得滚过来,别让人对着看不见的东西按确认
    this._drawLivePreview();
    this._updateAction();
  }
}
