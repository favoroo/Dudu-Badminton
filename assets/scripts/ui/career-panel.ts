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
import { drawArcadeButton, drawHardShadow, drawMenuCard, drawVeil, fadeOutHide, makeCoinIcon, pressFx, retainedDraw, slamIn, textW, uiIconButton } from "./ui-arcade";
import type { BtnStyle } from "./ui-arcade";
import { SHELF, advanceScroll, gridCols, revealRange, rubberBand, rowTopY, shelfLayout, thumbHeight } from "./shop-shelf";
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
/** 手指走出这么多**设计像素**就不算「点卡片」了,算滑动。
 *  960×540 在横屏手机上约 2 倍缩放,10 ≈ Android 的 8dp touch slop,再小就开始误吞点击。 */
const DRAG_SLOP = 10;
/** 越界拖动的阻尼:拉到顶/底还能再拖一截,松手弹回(移动端的标准手感) */
const RUBBER = 0.35;
/** 松手之后的惯性/回弹/定位运动学在 shop-shelf.advanceScroll(常数也在那边) */

// 配色(对齐老 base.css 的街机令牌:acid 荧光黄 + 暖纸白 + navy)
const COL = {
  overlay: new Color(7, 7, 13, 110),          // --ink 遮罩基准(渐变由 drawVeil 补)
  panelBg: new Color(16, 16, 24, 228),        // 面板黑:半透,身后球场还看得见
  cardBg: new Color(26, 26, 38, 208),         // 卡片黑(面板抬一档)
  cardSel: new Color(255, 225, 77, 255),      // --acid 选中描边
  cardSelBg: new Color(255, 225, 77, 26),     // 选中卡内的 acid 薄染
  cardEquip: new Color(21, 56, 42, 208),
  cardLock: new Color(16, 16, 24, 170),
  // 未选中 tab:白 5% 压在 panelBg 上只有 1.1:1,读不出一格一格的形状。
  // 改成抬一档的 navy-2 + 冷灰描边 —— 未选中也要「能点」的样子。
  tabBg: new Color(26, 26, 38, 235),
  tabEdge: new Color(159, 176, 216, 90),
  tabSel: new Color(255, 225, 77, 255),       // acid 芯片
  accent: new Color(255, 225, 77, 255),
  gold: new Color(255, 225, 77, 255),
  hot: new Color(255, 106, 31, 255),
  cyan: new Color(0, 240, 255, 255),
  green: new Color(125, 255, 158, 255),       // --good
  white: new Color(245, 239, 225, 255),       // --paper 暖纸白
  dimWhite: new Color(159, 176, 216, 200),
  dimGray: new Color(140, 153, 190, 235),
  // 经验槽:白 9% 在 navy 面板上等于没有 —— 改成往下压的暗槽,空/满一眼分得清
  expBg: new Color(5, 7, 15, 150),
  expEdge: new Color(159, 176, 216, 70),
  expFill: new Color(184, 255, 94, 255),      // 老 .exp-bar 的青柠→acid 渐变主色
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
  opts?: { x?: number; y?: number; w?: number; align?: number; lines?: number },
): Label {
  const o = opts ?? {};
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  // 多行文本按行数撑高节点,否则 Overflow.CLAMP 会把后续行裁掉
  const ut = n.addComponent(UITransform);
  ut.setContentSize(o.w ?? 200, size * 1.4 * (o.lines ?? 1));
  // 左对齐标签用左锚点,x 即文本左边缘,避免文本框向左延伸到图标区域
  if ((o.align ?? 0) === 0) ut.setAnchorPoint(0, 0.5);
  if (o.x !== undefined || o.y !== undefined) n.setPosition(o.x ?? 0, o.y ?? 0, 0);
  n.setParent(parent);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.3);
  l.horizontalAlign = o.align ?? 0;
  l.verticalAlign = 1;
  l.color = color;
  return l;
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

/** Graphics 画圆角矩形(填充+描边) */
function drawRR(g: Graphics, w: number, h: number, r: number, fill: Color, stroke?: Color, lw = 2) {
  const hw = w / 2, hh = h / 2;
  g.fillColor = fill;
  g.roundRect(-hw, -hh, w, h, r);
  g.fill();
  if (stroke) {
    g.strokeColor = stroke;
    g.lineWidth = lw;
    g.roundRect(-hw, -hh, w, h, r);
    g.stroke();
  }
}

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
    swingQ: 0, swingBuf: 0, swingBufAim: null, swingAim: "mid",
    swingRadius: 52,
    racket: { x: 0, y: 0, ang: 0 }, racketPrev: { x: 0, y: 0 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0,
    zoneScale: 1, score: 0, smashGlow: 0, sweetGlow: 0, perfectGlow: 0, heat: 0,
    hitRecoil: 0, lungeT: -1, lungeDir: 0, lungeCd: 0, lungeShotT: 0,
    stats: { hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0 },
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
  show(parent: Node, onClose: () => void) {
    this._onCloseCb = onClose;
    this._kind = "player";
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
    this._expFill = null;
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
    this._tabGraphics = [];
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
      this._drawLivePreview();
    }

    // Toast 淡出
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0 && this._toastOpacity) {
        this._toastOpacity.opacity = 0;
      }
    }
  }

  // ---------- 内部状态 ----------

  private root: Node | null = null;
  private _panelNode: Node | null = null;
  private _onCloseCb: (() => void) | null = null;
  private _kind: SkinKind | "stats" = "player";
  private _sel = 0;
  private _elapsed = 0;
  private _toastTimer = 0;

  // 缓存的 UI 元素
  private _lvLabel: Label | null = null;
  private _lvNameLabel: Label | null = null;
  private _expLabel: Label | null = null;
  private _expFill: Graphics | null = null;
  private _coinsLabel: Label | null = null;
  private _hintLabel: Label | null = null;
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
  private _tabGraphics: Array<{ g: Graphics; l: Label; ut: UITransform }> = [];
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

    // 遮罩:中心只压 0.4,四周收到 0.72(老 .screen 的 radial 渐变)——
    // 商店是「浮在球场上的玻璃柜」,不是一块贴满屏幕的黑纸。
    const overlay = mkNode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = COL.overlay;
    og.rect(-480, -270, 960, 540);
    og.fill();
    drawVeil(og, 960, 540, 0, 0.51);   // 增量按剩余不透明度折算:四周最终收到 ~0.72
    // 商店打开时不要让点击漏到下面的虚拟按键上(菜单的遮罩此时已隐藏)
    overlay.addComponent(BlockInputEvents);

    // 面板背景(硬偏移阴影 + navy 底:老 .panel 的贴纸感)
    const panel = mkNode("panel", this.root, PW, PH);
    panel.setPosition(0, -10, 0);
    this._panelNode = panel;
    const pg = panel.addComponent(Graphics);
    drawHardShadow(pg, PW, PH, 16, 6, 6, 0.55);
    drawRR(pg, PW, PH, 16, COL.panelBg, new Color(245, 239, 225, 36), 1.5);

    this._buildTopBar(panel);
    this._buildTabBar(panel);
    this._buildContent(panel);
    this._buildHint(panel);

    // Toast:底块和文字各占一个子节点 —— 一个节点只能挂一个 renderable
    this._toastNode = mkNode("toast", this.root, 400, 36);
    this._toastNode.setPosition(0, -PH / 2 + 20, 0);
    this._toastG = mkNode("toast-plate", this._toastNode, 400, 36).addComponent(Graphics);
    this._toastLabel = mkNode("toast-label", this._toastNode, 400, 36).addComponent(Label);
    this._toastLabel.string = "";
    this._toastLabel.fontSize = 16;
    this._toastLabel.lineHeight = 22;
    this._toastLabel.horizontalAlign = 1;
    this._toastLabel.verticalAlign = 1;
    this._toastLabel.color = COL.gold;
    this._toastOpacity = this._toastNode.addComponent(UIOpacity);
    this._toastOpacity.opacity = 0;
  }

  // ----- 顶部状态栏 -----
  private _buildTopBar(panel: Node) {
    const bar = mkNode("topBar", panel, PW - 20, 48);
    bar.setPosition(0, PH / 2 - 28, 0);

    // Lv.
    this._lvLabel = mkLabel(bar, "lv", "Lv.1", 20, COL.gold, { x: -PW / 2 + 50, y: 8, w: 60 });

    // 等级名
    this._lvNameLabel = mkLabel(bar, "lvName", LV_NAMES[0], 13, COL.dimWhite, {
      x: -PW / 2 + 130, y: 8, w: 100,
    });

    // 经验条
    const expBg = mkNode("expBg", bar, 200, 14);
    expBg.setPosition(-PW / 2 + 310, 8, 0);
    const expBgG = expBg.addComponent(Graphics);
    drawRR(expBgG, 200, 14, 7, COL.expBg, COL.expEdge, 1);

    const expFillNode = mkNode("expFill", bar, 196, 10);
    expFillNode.setPosition(-PW / 2 + 310, 8, 0);
    this._expFill = expFillNode.addComponent(Graphics);

    this._expLabel = mkLabel(bar, "expNum", "0 / 80 EXP", 12, COL.dimWhite, {
      x: -PW / 2 + 310, y: -10, w: 200, align: 1,
    });

    // 金币(Graphics 图标 + 数字,替代 🪙 emoji)
    makeCoinIcon(bar, PW / 2 - 155, 6, 9);
    this._coinsLabel = mkLabel(bar, "coins", "50", 18, COL.gold, {
      x: PW / 2 - 136, y: 6, w: 80, align: 0,
    });

    // 返回按钮:命中区 56(视觉圆底 44),Button.CLICK 自带按压反馈
    const back = uiIconButton(bar, "✕", { bg: "#6e2029", edge: "#ff8a8a", fontSize: 20 });
    back.setPosition(PW / 2 - 40, 6, 0);
    back.on(Button.EventType.CLICK, () => {
      this._onCloseCb?.();
      this.hide();
    });
  }

  // ----- Tab 栏 -----
  private _buildTabBar(panel: Node) {
    const bar = mkNode("tabs", panel, PW - 20, 38);
    bar.setPosition(0, PH / 2 - 73, 0);
    this._tabGraphics = [];

    const tw = (PW - 20) / KIND_ALL.length;
    KIND_ALL.forEach((k, i) => {
      const tab = mkNode(`tab-${k}`, bar, tw - 4, 32);
      tab.setPosition(-((PW - 20) / 2) + tw * i + tw / 2, 0, 0);

      const g = tab.addComponent(Graphics);
      const ut = tab.getComponent(UITransform)!;

      drawRR(g, tw - 4, 32, 8, COL.tabBg, COL.tabEdge, 1.5);
      const l = mkLabel(tab, `tabLabel-${k}`, KIND_LABEL[k], 15, COL.dimWhite, {
        x: 0, y: 0, w: tw - 8, align: 1,
      });

      tab.on(Node.EventType.TOUCH_END, () => {
        if (this._kind === k) return;
        this._setKind(k as SkinKind | "stats");
      });
      pressFx(tab);   // 裸触摸交互补按压反馈,与 Button 风格统一

      this._tabGraphics.push({ g, l, ut });
    });
  }

  // ----- 内容区(左:网格 右:预览) -----
  private _buildContent(panel: Node) {
    const cy = PH / 2 - 94 - CONTENT_H / 2;

    // 左:卡片网格(货架在 _ensureGridShell 里建,这里只留一块地)
    const left = mkNode("gridArea", panel, GRID_W, CONTENT_H);
    left.setPosition(-((PW - 20) / 2) + GRID_W / 2 + 5, cy, 0);
    this._gridNode = left;

    // 右:预览
    const right = mkNode("previewArea", panel, PREVIEW_W, CONTENT_H);
    right.setPosition(((PW - 20) / 2) - PREVIEW_W / 2 - 5, cy, 0);
    this._previewArea = right;

    const prevBg = right.addComponent(Graphics);
    // 切到「履历」页时这块整列会 active=false,再切回来得重画(原生侧 onDisable 会清渲染数据)
    retainedDraw(prevBg, () => {
      drawRR(prevBg, PREVIEW_W, CONTENT_H, 12, new Color(15, 18, 28, 220),
        new Color(159, 176, 216, 80), 1.5);
    });

    // 预览 Graphics
    const gfxNode = mkNode("gfx", right, PREVIEW_W, CONTENT_H - 30);
    gfxNode.setPosition(0, 10, 0);
    this._previewGfx = gfxNode.addComponent(Graphics);

    // 预览名称:贴在人物脚下、动作按钮上方(按钮要落在拇指够得着的下沿)
    this._previewName = mkLabel(right, "prevName", "", 16, COL.white, { y: -CONTENT_H / 2 + 87, w: PREVIEW_W - 20, align: 1 });

    // 动作按钮 —— 商店唯一的成交入口。
    // 点卡片只「选中」(换试衣间 + 换按钮文案),金币只有按这里才动:
    // 皮肤买了不能退,一tap 就扣钱的手感在触摸端就是误触。
    const act = mkNode("action", right, ACT_W, ACT_H);
    act.setPosition(0, -CONTENT_H / 2 + 35, 0);
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
  private _buildHint(panel: Node) {
    this._hintLabel = mkLabel(panel, "hint", "", 13, COL.dimGray, {
      y: -PH / 2 + 18, w: PW - 40, align: 1,
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

  /** 覆盖式细滚动条:位置随货架走,装得下时整条不画(不留没意义的轨道) */
  private _drawBar() {
    const g = this._barG;
    if (!g || !g.isValid) return;
    g.clear();
    if (this._maxScroll <= 0) return;
    const trackH = CONTENT_H - BAR_PAD * 2;
    const thumbH = thumbHeight(trackH, CONTENT_H, this._maxScroll);
    const f = clamp(this._scrollY / this._maxScroll, 0, 1);
    const cy = trackH / 2 - f * (trackH - thumbH);
    g.fillColor = new Color(159, 176, 216, 30);
    g.roundRect(-BAR_W / 2, -trackH / 2, BAR_W, trackH, BAR_W / 2);
    g.fill();
    g.fillColor = new Color(255, 225, 77, 140);
    g.roundRect(-BAR_W / 2, cy - thumbH / 2, BAR_W, thumbH, BAR_W / 2);
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
    const children = host.children;
    for (let i = children.length - 1; i >= 0; i--) {
      children[i].removeFromParent();
    }

    const list = this._list();
    const lay = shelfLayout(list.length);
    const cols = lay.cols;
    const totalW = cols * CARD_W + (cols - 1) * GAP;
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
      const col = i % cols, row = Math.floor(i / cols);
      const x = -totalW / 2 + col * (CARD_W + GAP) + CARD_W / 2;
      const y = rowTopY(row) - CARD_H / 2;

      const equipped = prof.equipped[this._kind as SkinKind] === s.id;
      const owned = Career.owns(s.id);
      const locked = !Career.unlocked(s);
      const broke = !owned && !locked && prof.coins < s.price;
      const rarity = s.rarity ?? "common";
      const rmeta = CFG.rarity[rarity];
      const rarityCol = parseColor(rmeta.color, COL.white);

      // 卡片节点
      const card = mkNode(`card-${i}`, host, CARD_W, CARD_H);
      card.setPosition(x, y, 0);

      const g = card.addComponent(Graphics);
      const sel = i === this._sel;
      // 边框层级:装备中(绿) > 选中(acid) > 稀有度色 > 默认冷灰
      const borderCol = equipped ? COL.green
        : sel ? COL.cardSel
          : rarity !== "common" ? rarityCol
            : new Color(107, 124, 166, 170);
      const bgCol = equipped ? COL.cardEquip : locked ? COL.cardLock : COL.cardBg;
      if (sel) drawHardShadow(g, CARD_W, CARD_H, 8, 4, 4, 0.5);   // 选中卡浮起(老 .skin-card.sel)
      drawRR(g, CARD_W, CARD_H, 8, bgCol, borderCol, sel ? 2.5 : 1.5);
      if (rarity === "legendary") {
        // 传说款:外圈再罩一道同色微光,货架上第一个被看到
        g.strokeColor = new Color(rarityCol.r, rarityCol.g, rarityCol.b, 80);
        g.lineWidth = 5;
        g.roundRect(-CARD_W / 2 - 2.5, -CARD_H / 2 - 2.5, CARD_W + 5, CARD_H + 5, 10.5);
        g.stroke();
      }

      // 缩略图区域
      const thumbW = 64, thumbH = 76;
      const thumbNode = mkNode("thumb", card, thumbW, thumbH);
      thumbNode.setPosition(0, CARD_H / 2 - thumbH / 2 - 6, 0);
      const tg = thumbNode.addComponent(Graphics);
      this._drawCardThumb(tg, s);

      // 稀有度角标(common 不挂,基础款保持素净)
      if (rarity !== "common") {
        const chip = mkNode("rarity", card, 34, 14);
        chip.setPosition(-CARD_W / 2 + 19, CARD_H / 2 - 8, 0);
        const cg = chip.addComponent(Graphics);
        drawRR(cg, 34, 14, 7,
          new Color(rarityCol.r, rarityCol.g, rarityCol.b, 240),
          new Color(10, 13, 24, 190), 1);
        mkLabel(chip, "rarityTxt", rmeta.name, 9, new Color(12, 14, 22, 255), { y: -1, w: 34, align: 1 });
      }

      // 名称
      const nameColor = locked ? COL.dimGray : COL.white;
      mkLabel(card, "name", s.name, 12, nameColor, {
        y: -8, w: CARD_W - 8, align: 1,
      });

      // 状态行
      let statusText: string, statusColor: Color;
      if (equipped) { statusText = "✓ 装备中"; statusColor = COL.green; }
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
      if (locked) {
        const ovNode = mkNode("lock-mask", card, CARD_W, CARD_H);
        const ov = ovNode.addComponent(Graphics);
        ov.fillColor = new Color(0, 0, 0, 120);
        ov.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
        ov.fill();
      }
      if (broke && !owned) {
        const ovNode = mkNode("broke-mask", card, CARD_W, CARD_H);
        const ov = ovNode.addComponent(Graphics);
        ov.fillColor = new Color(0, 0, 0, 110);
        ov.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
        ov.fill();
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
  private _actView(): { text: string; style: BtnStyle; fg: Color } {
    const kind = this._kind;
    if (kind === "stats") return { text: "", style: "ghost", fg: COL.dimGray };
    const s = this._list()[this._sel];
    if (!s) return { text: "", style: "ghost", fg: COL.dimGray };

    const p = Career.profile();
    if (p.equipped[kind] === s.id) return { text: "✓ 已经装备", style: "ghost", fg: COL.green };
    if (Career.owns(s.id)) return { text: "装备上身", style: "ghost", fg: COL.white };
    if (!Career.unlocked(s)) return { text: `Lv.${s.unlockLevel ?? "?"} 解锁`, style: "ghost", fg: COL.dimGray };
    if (p.coins < s.price) return { text: `金币不足 · 还差 ${s.price - p.coins}`, style: "ghost", fg: COL.dimGray };
    // 红面 primary 上要用浅字(P5 主按钮:斩劈红面白字)
    const primaryFg = new Color(255, 245, 242, 255);
    if (s.price === 0) return { text: "免费领取", style: "primary", fg: primaryFg };
    return { text: `购买 · ${s.price} 金币`, style: "primary", fg: primaryFg };
  }

  /** 底块单独走一遍,好让 retainedDraw 的重放和状态刷新用同一张脸 */
  private _drawActionFace() {
    const g = this._actGfx;
    if (!g || !g.isValid) return;
    g.clear();
    drawArcadeButton(g, ACT_W, ACT_H, this._actView().style);
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
      this._statsNode.setPosition(0, PH / 2 - 94 - CONTENT_H / 2, 0);
    }

    // 清空旧统计卡片
    const children = this._statsNode.children;
    for (let i = children.length - 1; i >= 0; i--) {
      children[i].removeFromParent();
    }

    const p = Career.profile();
    const st = p.stats;
    const matches = st.matches;
    const wins = st.wins;
    const winRate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
    const totalStars = Object.values(p.drills).reduce((a, d) => a + (d.stars || 0), 0);

    const cards = [
      { num: `${winRate}%`, label: "生涯胜率", sub: `${wins} 胜 / ${matches} 战`, color: COL.gold },
      { num: `${st.smashes}`, label: "扣杀终结", sub: "", color: COL.hot },
      { num: `${st.perfects}`, label: "完美击球", sub: "", color: COL.cyan },
      { num: `${st.sweets}`, label: "甜区命中", sub: "", color: COL.gold },
      { num: `${st.maxRally} 拍`, label: "最长相持", sub: "", color: COL.white },
      { num: `${totalStars} / ${DRILL_STARS_MAX} ★`, label: "训练评级", sub: "", color: COL.cyan },
    ];

    const cw = 268, ch = 120, cgap = 16, cols = 3;
    const totalW = cols * cw + (cols - 1) * cgap;

    cards.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = -totalW / 2 + col * (cw + cgap) + cw / 2;
      const y = CONTENT_H / 2 - 20 - row * (ch + cgap) - ch / 2;

      const node = mkNode(`stat-${i}`, this._statsNode!, cw, ch);
      node.setPosition(x, y, 0);
      const g = node.addComponent(Graphics);
      drawRR(g, cw, ch, 12, new Color(25, 30, 45, 200), c.color, 1.5);

      // 数值
      mkLabel(node, "num", c.num, 30, c.color, { y: 24, w: cw - 16, align: 1 });
      // 标题
      mkLabel(node, "label", c.label, 15, COL.white, { y: -12, w: cw - 16, align: 1 });
      // 副标题:只有真数据才占位(装饰性口号已删)
      if (c.sub) mkLabel(node, "sub", c.sub, 12, COL.dimGray, { y: -36, w: cw - 16, align: 1 });
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

    drawPlayer(g, vp, player, 0, 1, null);
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
      const w = Math.min(PW - 40, Math.max(200, textW(text, 16) + 48));
      const g = this._toastG;
      g.node.getComponent(UITransform)!.setContentSize(w, 36);
      g.clear();
      drawHardShadow(g, w, 36, 8, 3, 3, 0.45);
      drawMenuCard(g, w, 36, 8, { accent: "#ffe14d", tint: 0.05, bar: 4, edge: 0, alpha: 0.96 });
    }
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
    this._tabGraphics.forEach((tab, i) => {
      const active = KIND_ALL[i] === this._kind;
      tab.g.clear();
      drawRR(tab.g, tab.ut.contentSize.width, tab.ut.contentSize.height, 8,
        active ? COL.tabSel : COL.tabBg, active ? undefined : COL.tabEdge, 1.5);
      tab.l.color = active ? new Color(20, 16, 10, 255) : COL.dimWhite;
    });

    // 内容区
    if (this._kind === "stats") {
      // 货架整棵收走而不是 active=false:原生侧 Mask/Graphics 的渲染数据会在 onDisable 被清
      this._destroyGridShell();
      // 履历页没有可预览的皮肤:右侧试衣间整块让位给统计卡
      if (this._previewArea) this._previewArea.active = false;
      this._buildStatsPage();
      if (this._statsNode) this._statsNode.active = true;
      this._hintLabel.string = "";   // 履历页全是数据,不需要一句口号压在下头
    } else {
      if (this._statsNode) this._statsNode.active = false;
      if (this._previewArea) this._previewArea.active = true;
      this._buildGrid();
      this._updateAction();
      // 只留一条真有信息量的:换球是全场生效的,其余标签页看名字就懂
      this._hintLabel.string = this._kind === "shuttle" ? "换球后全场生效" : "";
    }

    // 预览
    this._elapsed = 0;
    this._drawLivePreview();
  }

  private _drawExpBar(ratio: number) {
    if (!this._expFill) return;
    const g = this._expFill;
    g.clear();
    const w = 196 * clamp(ratio, 0, 1);
    if (w > 0) {
      g.fillColor = COL.expFill;
      g.roundRect(-98, -5, w, 10, 5);
      g.fill();
    }
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
