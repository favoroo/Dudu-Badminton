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
import { Ball, FaceKind, Player, SkinDef, SkinKind, Theme } from "../core/types";
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
import { clearKids, solidTab, type TabHandle } from "./ui-shell";
import {
  SHELF, advanceScroll, gridCols, revealRange, rubberBand, rowTopY, shelfLayout, SHOP,
  shopContent, shopStats, shopTabs, shopTopBar, STAT, statCardDL, statCells, thumbCenterY, thumbHeight,
  TOAST, TOAST_FG, toastWidth,
} from "./shop-shelf";
import type { ScrollMotion } from "./shop-shelf";

const { ccclass } = _decorator;

// ---------- 常量 ----------

const KIND_ORDER: SkinKind[] = ["player", "racket", "shuttle", "face"];
const KIND_ALL: string[] = ["player", "racket", "shuttle", "face", "stats"];
const KIND_LABEL: Record<string, string> = {
  player: "角色皮肤", racket: "球拍皮肤", shuttle: "羽毛球皮肤", face: "面部皮肤", stats: "生涯战绩",
};
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

/** 构造最小可用的 Player 实体供 drawPlayer 消费。
 *  faceSkin 恒挂 face-auto:商品卡展示的是「人物形象本体」,默认走人物自带脸面
 *  (萌芽豆丁的雀斑/猫系少女的猫须),不被玩家当前装备的脸面盖掉。 */
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
    faceSkin: { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" },
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
function fxTag(s: SkinDef): string {
  if (s.kind === "face") {
    switch (s.faceStyle) {
      case "auto": return "跟随人物默认脸面";
      case "ink": return "经典剪影 · 情怀款";
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
  if (s.body === "compact") return "小巧体型 · 全新人物形象";
  if (s.body === "tall") return "高挑体型 · 全新人物形象";
  return s.aura ? "专属脚下光环"
    : (s.hairStyle || s.headwear || s.jersey) ? "全新人物形象" : "";
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
  show(parent: Node, onClose: () => void, initialKind?: SkinKind | "stats") {
    this._onCloseCb = onClose;
    this._kind = initialKind ?? "player";
    this._sel = 0;
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
    // 货架整棵随 root 一起销毁,这里只清引用 + 复位滚动状态(面板复用时不留残余)
    this._viewport = null;
    this._contentNode = null;
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
    if (this._kind === "player" || this._kind === "racket") {
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
  private _kind: SkinKind | "stats" = "player";
  private _sel = 0;
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

  // 货架滚动:viewport 挂 Mask 裁切,content 是被拖动的货架
  private _viewport: Node | null = null;
  private _contentNode: Node | null = null;
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
        this._setKind(k as SkinKind | "stats");
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

    const vp = mkNode("gridView", this._gridNode, GRID_W, CONTENT_H);
    const mask = vp.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_RECT;

    const content = mkNode("gridContent", vp, GRID_W, CONTENT_H);

    // 滚动条挂在窗户外面(gridArea 的另一个子节点),否则跟着内容一起被裁掉
    const bar = mkNode("gridBar", this._gridNode, BAR_W + 4, CONTENT_H);
    bar.setPosition(BAR_X, 0, 0);

    this._viewport = vp;
    this._contentNode = content;
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
    this._barG = null;
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
    const trackH = CONTENT_H - BAR_PAD * 2;
    const thumbH = thumbHeight(trackH, CONTENT_H, this._maxScroll);
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
    const { min, max } = revealRange(Math.floor(this._sel / cols), this._maxScroll);
    if (min > max) return;   // 这一行在任何位置都露不全 —— shelf-check 拦的就是它
    let target = this._scrollY;
    if (target < min) target = min;
    else if (target > max) target = max;
    if (target === this._scrollY) return;
    this._vel = 0;
    this._easeTo = target;
  }

  // ========== 卡片网格 ==========

  /** 商店展示顺序:默认款 → 设计款(稀有度降序→价格升序) → 纯色款(价格升序)。
   *  设计款放前面是货架语言:开门先看到好看的东西,纯色款垫底当「基础款」 */
  private _list(): SkinDef[] {
    const all = CFG.skins[this._kind as SkinKind] ?? [];
    const rank: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
    return [...all].sort((a, b) => {
      if (a.price === 0) return -1;
      if (b.price === 0) return 1;
      const ra = rank[a.rarity ?? "common"], rb = rank[b.rarity ?? "common"];
      if (ra !== rb) return ra - rb;
      return a.price - b.price;
    });
  }

  private _buildGrid() {
    this._ensureGridShell();
    const host = this._contentNode;
    if (!this._gridNode || !host || !host.isValid) return;
    // 清空旧卡片:只清货架,别把挂着 Mask 的可视窗和滚动条一起摘了
    clearKids(host)

    const list = this._list();
    const lay = shelfLayout(list.length);
    const cols = lay.cols;
    const lefts = hbox(Array(cols).fill(CARD_W), GAP);
    const prof = Career.profile();

    // 行数决定货架多高:超过窗高才有得滚,滚动条也才有得画(算法与出处见 shop-shelf.ts)
    this._rows = lay.rows;
    this._maxScroll = lay.maxScroll;
    // 货架方框要始终盖住整扇窗(上下各多让 maxScroll),否则滚到底时窗底那一条
    // 落在货架框外 —— 手指从卡片缝隙起手的拖动就收不到 TOUCH_START 了。
    host.getComponent(UITransform)!.setContentSize(GRID_W, CONTENT_H + 2 * lay.maxScroll);
    if (this._scrollY > this._maxScroll) {
      this._scrollY = this._maxScroll;
      this._vel = 0;
      this._easeTo = null;
    }

    list.forEach((s, i) => {
      const row = Math.floor(i / cols);
      const x = lefts[i % cols] + CARD_W / 2;
      const y = rowTopY(row) - CARD_H / 2;

      const equipped = prof.equipped[this._kind as SkinKind] === s.id;
      const owned = Career.owns(s.id);
      const locked = !Career.unlocked(s);
      const broke = !owned && !locked && prof.coins < s.price;
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

      // 名称
      const nameColor = locked ? COL.dimGray : COL.white;
      mkLabel(card, "name", s.name, 12, nameColor, {
        y: -8, w: CARD_W - 8, align: 1,
      });

      // 状态行
      let statusText: string, statusColor: Color;
      if (equipped) { statusText = "装备中"; statusColor = COL.green; }
      else if (owned) { statusText = "已拥有"; statusColor = COL.dimWhite; }
      else if (locked) { statusText = `Lv.${s.unlockLevel} 解锁`; statusColor = COL.dimGray; }
      else { statusText = `金币 ${s.price}`; statusColor = broke ? COL.dimGray : COL.gold; }
      mkLabel(card, "status", statusText, 12, statusColor, {
        y: -28, w: CARD_W - 8, align: 1,
      });

      // 卖点小字(设计款专属效果,稀有度色)
      const fx = fxTag(s);
      if (fx) {
        mkLabel(card, "fx", fx, 9, new Color(rarityCol.r, rarityCol.g, rarityCol.b, 215), {
          y: -47, w: CARD_W - 6, align: 1,
        });
      }

      // 锁定遮罩(独立子节点:一个节点只能挂一个 renderable,card 已有背景 Graphics)
      // 锁定/买不起:凹陷槽本身已经把卡压暗了,不再叠一层圆角黑罩(那会把斜切边露在外面)。
      // 只补一枚锁形印章 —— 用 Graphics,不用 🔒:原生 Android 没有彩色 emoji 字体。
      if (locked) {
        const ovNode = mkNode("lock-mark", card, 26, 26);
        ovNode.setPosition(0, 6, 0);
        const ov = ovNode.addComponent(Graphics);
        retainedDraw(ov, () => drawRankBadge(ov, "lock", 24, C.dimDeep));
      }

      // 点击 = 只选中:右侧试衣间马上换人,下方按钮改口径;金币不动
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

  // ---------- 卡片缩略图 ----------

  private _drawCardThumb(g: Graphics, s: SkinDef) {
    g.clear();
    const kind = this._kind;

    if (kind === "player") {
      // 缩小版 drawPlayer 静态像(对齐原版 scale 0.6:100px 的人物画成 60px 高);
      // playerSkin 挂卡片自身 → 缩略图直接带发型/头饰,设计款一眼可辨
      const vp = previewVp(0.60, 0, -30);
      const th = themeOf(s);
      const curRacket = Career.skinOf("racket");
      const p = dummyPlayer(th, curRacket, { playerSkin: s });
      drawPlayer(g, vp, p, 0, 1, null);
    } else if (kind === "racket") {
      // 真球拍(与上场同一套 drawRacket,拍头朝上竖放;皮肤来自卡片本身)
      const p = dummyPlayer(themeOf(CFG.skins.player[0] ?? s), s);
      drawRacketStill(g, previewVp(1.30, 0, -26), 0, 0, 1, p);
    } else if (kind === "shuttle") {
      // 真羽毛球(与上场同一套 drawShuttle,放大 2.05 对齐原版)
      drawShuttle(g, previewVp(2.05, 0, 4), dummyBall(), s);
    } else if (kind === "face") {
      // 大头像(与上场同一套 drawHead):常态表情,换什么脸一眼可辨
      drawHeadStill(g, previewVp(2.1, 0, 10), 0, 0, 1,
        themeOf(Career.skinOf("player")), s.faceStyle ?? "skin", "normal", 0);
    }
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
  private _actView(): { text: string; face: string | null; fg: Color } {
    const kind = this._kind;
    if (kind === "stats") return { text: "", face: null, fg: COL.dimGray };
    const s = this._list()[this._sel];
    if (!s) return { text: "", face: null, fg: COL.dimGray };

    const p = Career.profile();
    if (p.equipped[kind] === s.id) return { text: "已经装备", face: null, fg: COL.green };
    if (Career.owns(s.id)) return { text: "装备上身", face: ROLE.star.face, fg: ac(inkFor(ROLE.star.face)) };
    if (!Career.unlocked(s)) return { text: `Lv.${s.unlockLevel ?? "?"} 解锁`, face: null, fg: COL.dimGray };
    if (p.coins < s.price) return { text: `金币不足 · 还差 ${s.price - p.coins}`, face: null, fg: COL.dimGray };
    const buyFg = ac(inkFor(ROLE.primary.face));
    if (s.price === 0) return { text: "免费领取", face: ROLE.primary.face, fg: buyFg };
    return { text: `购买 · ${s.price} 金币`, face: ROLE.primary.face, fg: buyFg };
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

    const p = Career.profile();
    if (p.equipped[kind] === s.id) {
      this._showToast("已经穿在身上了");
      return;
    }
    if (Career.owns(s.id)) {
      Career.equip(kind, s.id);
      this._showToast(`已装备「${s.name}」`);
    } else {
      const r = Career.buyAndEquip(kind, s.id);
      if (r.ok) this._showToast(`入手「${s.name}」并已装备!`);
      else this._showToast(r.reason ?? "购买失败");
    }
    this._elapsed = 0;
    this._refresh();
  }

  // ========== Tab 切换 ==========

  private _setKind(k: SkinKind | "stats") {
    this._kind = k;
    this._sel = 0;
    this._elapsed = 0;
    // 换 tab = 换货架:回到第一行,别停在上一页的滚动位置
    this._scrollY = 0;
    this._vel = 0;
    this._easeTo = null;
    this._dragId = null;
    this._dragMoved = false;
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

    const cells = statCells(Career.profile(), DRILL_STARS_MAX);

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
      retainedDraw(g, () => drawP5Card(g, cw, ch, face, { bandH: 0 }));

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
      if (c.sub) mkLabel(node, "sub", c.sub, STAT.subSize, COL.dimGray, {
        x: d.sub.x, y: d.sub.y, w: cw - STAT.padX * 2, align: 1,
      });
    });
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

    const curPlayer = Career.skinOf("player");
    const curRacket = Career.skinOf("racket");

    // 试衣间:player tab 用候选人物+当前球拍;racket tab 反之。
    // playerSkin 挂完整定义 → 发型/头饰/光环在预览里实时可见
    const playerSkinDef = kind === "player" ? s : curPlayer;
    const playerTheme = themeOf(playerSkinDef);
    const racketSkin = kind === "racket" ? s : curRacket;

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

    // --- 面部 tab:大头像循环表情,把五官配色和心情腮红直接演给买家看 ---
    if (kind === "face") {
      const vp = previewVp(3.4, 0, 10);
      const exprs: FaceKind[] = ["normal", "happy", "star", "wow"];
      const seg = 2.2 / exprs.length;               // 与试衣间同一个 2.2s 循环时钟
      const expr = exprs[Math.min(exprs.length - 1, Math.floor(this._elapsed / seg))];
      drawHeadStill(g, vp, 0, 0, 1, themeOf(curPlayer), s.faceStyle ?? "skin", expr, this._elapsed);
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
      swingT, swingStyle: "over",
      swingRadius: 52, recoverT,
      contactFlash, smashGlow, sweetGlow,
      y: bob,
    });

    drawPlayer(g, vp, player, Math.round(this._clock * 60), 1, null);
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
