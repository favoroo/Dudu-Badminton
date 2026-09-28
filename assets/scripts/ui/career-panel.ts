// ============================================================
// 生涯中心面板:等级/金币总览 + 皮肤商店(购买/装备) + 履历统计 + 实时小人预览
// 纯代码构建 UI 节点,复刻老项目 src/ui-career.js 的完整交互。
// 依赖:Career(逻辑层)、CFG.skins(配置)、Sprites.drawPlayer/drawShuttle(渲染)
// ============================================================
import {
  _decorator, Color, Component, EventKeyboard, Graphics, Input, input, Label, Layers, Node,
  UITransform, UIOpacity, Widget, KeyCode,
} from "cc";
import { Career } from "../core/career";
import { CFG } from "../core/config";
import { Ball, Player, SkinDef, SkinKind, Theme } from "../core/types";
import { drawPlayer, drawShuttle, Viewport } from "../render/sprites";
import { Physics } from "../core/physics";
import { clamp } from "../core/utils";
import { drawHardShadow, slamIn } from "./ui-arcade";

const { ccclass } = _decorator;

// ---------- 常量 ----------

const KIND_ORDER: SkinKind[] = ["player", "racket", "shuttle"];
const KIND_ALL: string[] = ["player", "racket", "shuttle", "stats"];
const KIND_LABEL: Record<string, string> = {
  player: "角色皮肤", racket: "球拍皮肤", shuttle: "羽毛球皮肤", stats: "生涯战绩",
};
const LV_NAMES = [
  "新手菜鸟", "初学乍练", "渐入佳境", "业余好手", "俱乐部主力",
  "地区新星", "城市名将", "省队水准", "全国赛手", "顶级选手",
  "精英大师", "传奇球手", "羽坛名宿", "世界冠军", "大满贯",
  "不朽传奇", "羽球之神", "至高无上", "传说再现", "巅峰至尊",
];

/** 列数:两行制(10→5、8→4),与老项目一致 */
function gridCols(n: number): number {
  return n % 5 === 0 ? 5 : n % 4 === 0 ? 4 : Math.min(n, 6);
}

// 布局(设计分辨率 960×540)
const PW = 880, PH = 470;
const CARD_W = 96, CARD_H = 130, GAP = 8;
const GRID_W = 520, PREVIEW_W = 320, CONTENT_H = 330;

// 配色(对齐老 base.css 的街机令牌:acid 荧光黄 + 暖纸白 + navy)
const COL = {
  panelBg: new Color(14, 20, 40, 246),        // --navy
  cardBg: new Color(24, 33, 66, 235),         // --navy-2
  cardSel: new Color(255, 225, 77, 255),      // --acid 选中描边
  cardSelBg: new Color(255, 225, 77, 26),     // 选中卡内的 acid 薄染
  cardEquip: new Color(21, 56, 42, 235),
  cardLock: new Color(16, 19, 30, 190),
  tabBg: new Color(255, 255, 255, 13),        // 白 5%
  tabSel: new Color(255, 225, 77, 255),       // acid 芯片
  accent: new Color(255, 225, 77, 255),
  gold: new Color(255, 225, 77, 255),
  hot: new Color(255, 106, 31, 255),
  cyan: new Color(0, 240, 255, 255),
  green: new Color(125, 255, 158, 255),       // --good
  white: new Color(245, 239, 225, 255),       // --paper 暖纸白
  dimWhite: new Color(159, 176, 216, 200),
  dimGray: new Color(111, 124, 166, 190),
  overlay: new Color(5, 7, 15, 175),          // --ink
  expBg: new Color(255, 255, 255, 23),
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
  opts?: { x?: number; y?: number; w?: number; align?: number },
): Label {
  const o = opts ?? {};
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(o.w ?? 200, size * 1.4);
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

/** 构造最小可用的 Player 实体供 drawPlayer 消费 */
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
    zoneScale: 1, score: 0, smashGlow: 0, sweetGlow: 0, perfectGlow: 0,
    hitRecoil: 0, lungeT: -1, lungeDir: 0, lungeRecovery: 0,
    stats: { hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0 },
    racketSkin, ...ov,
  };
}

/** 构造最小可用的 Ball 实体供 drawShuttle 消费 */
function dummyBall(): Ball {
  return {
    x: 0, y: 0, px: 0, py: 0, vx: 1, vy: -1.73,
    live: false, held: false, owner: null,
    lastHitter: null, crossed: false, netted: false,
    shot: null, sq: 1, sqPrev: 1,
  };
}

/** 预览用 Viewport:将 drawPlayer 的世界坐标映射到 Graphics 本地空间 */
function previewVp(scale: number, cx: number, cy: number): Viewport {
  return {
    x: (wx: number) => wx * scale + cx,
    y: (wy: number) => -(wy * scale) + cy,
  };
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
    // 简单隐藏:将 root 节点从父节点移除
    if (this.root) {
      this.root.removeFromParent();
    }
  }

  /** 外部触发数据刷新 */
  refresh() { this._refresh(); }

  /** 每帧:驱动预览动画 */
  update(dt: number) {
    if (!this.root || this._kind === "stats") return;
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
  private _gridNode: Node | null = null;
  private _statsNode: Node | null = null;
  private _tabGraphics: Array<{ g: Graphics; l: Label; ut: UITransform }> = [];
  private _toastNode: Node | null = null;
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

    // 遮罩
    const overlay = mkNode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = COL.overlay;
    og.rect(-480, -270, 960, 540);
    og.fill();

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

    // Toast
    this._toastNode = mkNode("toast", this.root, 400, 36);
    this._toastNode.setPosition(0, -PH / 2 + 20, 0);
    this._toastLabel = this._toastNode.addComponent(Label);
    this._toastLabel.fontSize = 16;
    this._toastLabel.lineHeight = 22;
    this._toastLabel.horizontalAlign = 1;
    this._toastLabel.verticalAlign = 1;
    this._toastLabel.color = COL.gold;
    this._toastOpacity = this._toastNode.addComponent(UIOpacity);
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
    drawRR(expBgG, 200, 14, 7, COL.expBg);

    const expFillNode = mkNode("expFill", bar, 196, 10);
    expFillNode.setPosition(-PW / 2 + 310, 8, 0);
    this._expFill = expFillNode.addComponent(Graphics);

    this._expLabel = mkLabel(bar, "expNum", "0 / 80 EXP", 11, COL.dimWhite, {
      x: -PW / 2 + 310, y: -10, w: 200, align: 1,
    });

    // 金币
    this._coinsLabel = mkLabel(bar, "coins", "🪙 50", 18, COL.gold, {
      x: PW / 2 - 100, y: 6, w: 120, align: 2,
    });

    // 返回按钮
    const back = mkNode("back", bar, 36, 36);
    back.setPosition(PW / 2 - 28, 6, 0);
    const bg = back.addComponent(Graphics);
    bg.fillColor = new Color(200, 60, 60, 180);
    bg.circle(0, 0, 16); bg.fill();
    bg.strokeColor = new Color(255, 120, 120, 200);
    bg.lineWidth = 1.5; bg.circle(0, 0, 16); bg.stroke();
    const bl = back.addComponent(Label);
    bl.string = "✕"; bl.fontSize = 14; bl.lineHeight = 18;
    bl.horizontalAlign = 1; bl.verticalAlign = 1;
    bl.color = COL.white;
    back.on(Node.EventType.TOUCH_END, () => {
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
      const l = tab.addComponent(Label);
      const ut = tab.getComponent(UITransform)!;

      drawRR(g, tw - 4, 32, 8, COL.tabBg);
      l.string = KIND_LABEL[k];
      l.fontSize = 15; l.lineHeight = 20;
      l.horizontalAlign = 1; l.verticalAlign = 1;
      l.color = COL.dimWhite;

      tab.on(Node.EventType.TOUCH_END, () => {
        if (this._kind === k) return;
        this._setKind(k as SkinKind | "stats");
      });

      this._tabGraphics.push({ g, l, ut });
    });
  }

  // ----- 内容区(左:网格 右:预览) -----
  private _buildContent(panel: Node) {
    const cy = PH / 2 - 94 - CONTENT_H / 2;

    // 左:卡片网格
    const left = mkNode("gridArea", panel, GRID_W, CONTENT_H);
    left.setPosition(-((PW - 20) / 2) + GRID_W / 2 + 5, cy, 0);
    this._gridNode = left;

    // 右:预览
    const right = mkNode("previewArea", panel, PREVIEW_W, CONTENT_H);
    right.setPosition(((PW - 20) / 2) - PREVIEW_W / 2 - 5, cy, 0);

    const prevBg = right.addComponent(Graphics);
    drawRR(prevBg, PREVIEW_W, CONTENT_H, 12, new Color(15, 18, 28, 220),
      new Color(50, 60, 80, 100), 1);

    // 预览 Graphics
    const gfxNode = mkNode("gfx", right, PREVIEW_W, CONTENT_H - 30);
    gfxNode.setPosition(0, 10, 0);
    this._previewGfx = gfxNode.addComponent(Graphics);

    // 预览名称
    this._previewName = mkLabel(right, "prevName", "", 16, COL.white, { y: -CONTENT_H / 2 + 18, w: PREVIEW_W - 20, align: 1 });
  }

  // ----- 底部提示 -----
  private _buildHint(panel: Node) {
    this._hintLabel = mkLabel(panel, "hint", "", 13, COL.dimGray, {
      y: -PH / 2 + 18, w: PW - 40, align: 1,
    });
  }

  // ========== 卡片网格 ==========

  private _buildGrid() {
    if (!this._gridNode) return;
    // 清空旧卡片:移除所有子节点
    const children = this._gridNode.children;
    for (let i = children.length - 1; i >= 0; i--) {
      children[i].removeFromParent();
    }

    const list = CFG.skins[this._kind as SkinKind] ?? [];
    const cols = gridCols(list.length);
    const totalW = cols * CARD_W + (cols - 1) * GAP;
    const prof = Career.profile();

    list.forEach((s, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = -totalW / 2 + col * (CARD_W + GAP) + CARD_W / 2;
      const y = CONTENT_H / 2 - 10 - row * (CARD_H + GAP) - CARD_H / 2;

      const equipped = prof.equipped[this._kind as SkinKind] === s.id;
      const owned = Career.owns(s.id);
      const locked = !Career.unlocked(s);
      const broke = !owned && !locked && prof.coins < s.price;

      // 卡片节点
      const card = mkNode(`card-${i}`, this._gridNode!, CARD_W, CARD_H);
      card.setPosition(x, y, 0);

      const g = card.addComponent(Graphics);
      const sel = i === this._sel;
      const borderCol = equipped ? COL.green
        : sel ? COL.cardSel
          : locked ? new Color(40, 44, 55, 100)
            : new Color(50, 58, 78, 140);
      const bgCol = equipped ? COL.cardEquip : COL.cardBg;
      if (sel) drawHardShadow(g, CARD_W, CARD_H, 8, 4, 4, 0.5);   // 选中卡浮起(老 .skin-card.sel)
      drawRR(g, CARD_W, CARD_H, 8, bgCol, borderCol, sel ? 2.5 : 1.5);

      // 缩略图区域
      const thumbW = 64, thumbH = 76;
      const thumbNode = mkNode("thumb", card, thumbW, thumbH);
      thumbNode.setPosition(0, CARD_H / 2 - thumbH / 2 - 6, 0);
      const tg = thumbNode.addComponent(Graphics);
      this._drawCardThumb(tg, s);

      // 名称
      const nameColor = locked ? COL.dimGray : COL.white;
      mkLabel(card, "name", s.name, 12, nameColor, {
        y: -8, w: CARD_W - 8, align: 1,
      });

      // 状态行
      let statusText: string, statusColor: Color;
      if (equipped) { statusText = "✔ 装备中"; statusColor = COL.green; }
      else if (owned) { statusText = "已拥有"; statusColor = COL.dimWhite; }
      else if (locked) { statusText = `🔒 Lv.${s.unlockLevel}`; statusColor = COL.dimGray; }
      else { statusText = `🪙 ${s.price}`; statusColor = broke ? COL.dimGray : COL.gold; }
      mkLabel(card, "status", statusText, 11, statusColor, {
        y: -28, w: CARD_W - 8, align: 1,
      });

      // 锁定遮罩
      if (locked) {
        const ov = card.addComponent(Graphics);
        ov.fillColor = new Color(0, 0, 0, 80);
        ov.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
        ov.fill();
      }
      if (broke && !owned) {
        const ov = card.addComponent(Graphics);
        ov.fillColor = new Color(0, 0, 0, 50);
        ov.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
        ov.fill();
      }

      // 点击
      const idx = i;
      card.on(Node.EventType.TOUCH_END, () => this._confirm(idx));
    });
  }

  // ---------- 卡片缩略图 ----------

  private _drawCardThumb(g: Graphics, s: SkinDef) {
    g.clear();
    const kind = this._kind;

    if (kind === "player") {
      // 缩小版 drawPlayer 静态像
      const vp = previewVp(0.38, 0, -10);
      const th = themeOf(s);
      const curRacket = Career.skinOf("racket");
      const p = dummyPlayer(th, curRacket);
      drawPlayer(g, vp, p, 0, 1, null);
    } else if (kind === "racket") {
      // 简化球拍图标:椭圆拍面 + 拍柄
      const frameCol = s.frame
        ? new Color().fromHEX(s.frame as string)
        : new Color().fromHEX("#888");
      const gripCol = new Color().fromHEX(s.grip ?? "#333");
      const shaftCol = new Color().fromHEX(s.shaft ?? "#aaa");

      // 拍柄
      g.strokeColor = gripCol;
      g.lineWidth = 5;
      g.moveTo(-2, -30); g.lineTo(-2, -6);
      g.stroke();
      // 拍杆
      g.strokeColor = shaftCol;
      g.lineWidth = 3;
      g.moveTo(-2, -6); g.lineTo(-2, 10);
      g.stroke();
      // 拍面
      g.strokeColor = frameCol;
      g.lineWidth = 2.5;
      g.ellipse(-2, 24, 16, 20);
      g.stroke();
      // 弦
      g.strokeColor = new Color(200, 200, 200, 80);
      g.lineWidth = 0.8;
      for (let dy = -12; dy <= 12; dy += 6) {
        g.moveTo(-14, 24 + dy); g.lineTo(10, 24 + dy);
      }
      for (let dx = -10; dx <= 6; dx += 5) {
        g.moveTo(-2 + dx, 8); g.lineTo(-2 + dx, 40);
      }
      g.stroke();
    } else if (kind === "shuttle") {
      // 简化羽毛球图标
      const capCol = new Color().fromHEX(s.cap ?? "#f0e8d8");
      const skirtCol = new Color().fromHEX(s.skirt ?? "#faf8f2");
      const bandCol = new Color().fromHEX(s.band ?? "#ff4d4d");

      // 裙羽(梯形)
      g.fillColor = skirtCol;
      g.moveTo(-14, -4); g.lineTo(-8, -22);
      g.lineTo(8, -22); g.lineTo(14, -4);
      g.close(); g.fill();
      // 羽毛纹理
      g.strokeColor = new Color().fromHEX(s.vein ?? "rgba(150,150,150,0.5)");
      g.lineWidth = 0.8;
      for (let i = -10; i <= 10; i += 5) {
        g.moveTo(i, -4); g.lineTo(i * 0.5, -20);
      }
      g.stroke();
      // 球头
      g.fillColor = capCol;
      g.circle(0, 4, 8); g.fill();
      // 装饰带
      g.strokeColor = bandCol;
      g.lineWidth = 2.5;
      g.arc(0, 4, 8, 200, 340, false);
      g.stroke();
    }
  }

  // ========== 确认(购买/装备) ==========

  private _confirm(index: number) {
    const kind = this._kind;
    if (kind === "stats") return;
    const list = CFG.skins[kind];
    const s = list[index];
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
    this._sel = index;
    this._elapsed = 0;
    this._refresh();
  }

  // ========== Tab 切换 ==========

  private _setKind(k: SkinKind | "stats") {
    this._kind = k;
    this._sel = 0;
    this._elapsed = 0;
    this._refresh();
  }

  // ========== 统计页 ==========

  private _buildStatsPage() {
    if (!this._gridNode) return;

    // 创建统计节点(如果不存在)
    if (!this._statsNode) {
      this._statsNode = mkNode("statsPage", this._gridNode.parent!, GRID_W, CONTENT_H);
      const gp = this._gridNode.getPosition();
      this._statsNode.setPosition(gp.x, gp.y, gp.z);
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
      { num: `${st.smashes}`, label: "扣杀终结", sub: "记重炮暴击", color: COL.hot },
      { num: `${st.perfects}`, label: "完美击球", sub: "顶级时机", color: COL.cyan },
      { num: `${st.sweets}`, label: "甜区命中", sub: "扎实好球", color: COL.gold },
      { num: `${st.maxRally} 拍`, label: "最长相持", sub: "极限拉锯回合", color: COL.white },
      { num: `${totalStars} / 18 ★`, label: "训练评级", sub: "基本功扎实度", color: COL.cyan },
    ];

    const cw = 155, ch = 120, cgap = 12, cols = 3;
    const totalW = cols * cw + (cols - 1) * cgap;

    cards.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = -totalW / 2 + col * (cw + cgap) + cw / 2;
      const y = CONTENT_H / 2 - 20 - row * (ch + cgap) - ch / 2;

      const node = mkNode(`stat-${i}`, this._statsNode!, cw, ch);
      node.setPosition(x, y, 0);
      const g = node.addComponent(Graphics);
      drawRR(g, cw, ch, 10, new Color(25, 30, 45, 220), c.color, 1.5);

      // 数值
      mkLabel(node, "num", c.num, 26, c.color, { y: 22, w: cw - 16, align: 1 });
      // 标题
      mkLabel(node, "label", c.label, 14, COL.white, { y: -8, w: cw - 16, align: 1 });
      // 副标题
      mkLabel(node, "sub", c.sub, 11, COL.dimGray, { y: -28, w: cw - 16, align: 1 });
    });
  }

  // ========== 实时预览 ==========

  private _drawLivePreview() {
    if (!this._previewGfx) return;
    const g = this._previewGfx;
    g.clear();

    const kind = this._kind;
    if (kind === "stats") return;

    const list = CFG.skins[kind as SkinKind] ?? [];
    const s = list[this._sel];
    if (!s) return;

    const curPlayer = Career.skinOf("player");
    const curRacket = Career.skinOf("racket");

    // 试衣间:player tab 用候选球衣+当前球拍;racket tab 反之
    const playerTheme = kind === "player" ? themeOf(s) : themeOf(curPlayer);
    const racketSkin = kind === "racket" ? s : curRacket;

    // --- 羽毛球 tab:展示羽毛球 ---
    if (kind === "shuttle") {
      const vp = previewVp(2.5, 0, 20);
      const ball = dummyBall();
      drawShuttle(g, vp, ball, s);
      if (this._previewName) this._previewName.string = s.name;
      return;
    }

    // --- player / racket:画完整小人 ---
    const vp = previewVp(1.5, 0, -20);

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
      swingT, swingStyle: "over",
      swingRadius: 52, recoverT,
      contactFlash, smashGlow, sweetGlow,
      y: bob,
    });

    drawPlayer(g, vp, player, 0, 1, null);
    if (this._previewName) this._previewName.string = s.name;
  }

  // ========== Toast 提示 ==========

  private _showToast(text: string) {
    if (!this._toastLabel || !this._toastOpacity) return;
    this._toastLabel.string = text;
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
    this._coinsLabel.string = `🪙 ${p.coins}`;

    // Tab 高亮(acid 芯片 + 深字:老 .shop-tab.sel)
    this._tabGraphics.forEach((tab, i) => {
      const active = KIND_ALL[i] === this._kind;
      tab.g.clear();
      drawRR(tab.g, tab.ut.contentSize.width, tab.ut.contentSize.height, 8, active ? COL.tabSel : COL.tabBg);
      tab.l.color = active ? new Color(20, 16, 10, 255) : COL.dimWhite;
    });

    // 内容区
    if (this._kind === "stats") {
      this._buildStatsPage();
      this._hintLabel.string = "长期生涯数据累积 · 见证你的每一次变强";
    } else {
      this._buildGrid();
      const hints: Record<string, string> = {
        player: "用金币装扮你的球员,选件帅气的战袍",
        racket: "更换趁手球拍,挥出专属手感",
        shuttle: "换上特色羽毛球,全场公共生效",
      };
      this._hintLabel.string = hints[this._kind] ?? "";
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
      this._confirm(this._sel); return;
    }
    if (code === KeyCode.ESCAPE || code === KeyCode.KEY_Q || code === KeyCode.KEY_B) {
      this._onCloseCb?.();
      this.hide();
    }
  }

  private _moveSel(d: number) {
    if (this._kind === "stats") return;
    const list = CFG.skins[this._kind as SkinKind] ?? [];
    if (list.length === 0) return;
    this._sel = (this._sel + d + list.length) % list.length;
    this._elapsed = 0;
    this._buildGrid();
    this._drawLivePreview();
  }
}
