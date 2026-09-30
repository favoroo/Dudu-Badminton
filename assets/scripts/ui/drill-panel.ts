// ============================================================
// 训练场面板:关卡列表 → 动作引导(嵌入 DrillAnim) → 开始训练
// 结算不在这里:训练结束统一走 settle-panel(ui-manager 桥接 settleDrill)
// 纯代码构建 UI 节点,复刻老项目 src/ui-drill.js 的完整交互。
// 依赖:DrillAnim(演示动画)、Career(存档)、DRILLS(关卡配置)
// ============================================================
import {
  BlockInputEvents, Button, Color, Component, EventKeyboard, Graphics, Input, input, KeyCode, Label, Layers, Node,
  UITransform, Widget, _decorator,
} from "cc";
import { Career } from "../core/career";
import { CFG, DRILLS } from "../core/config";
import { DrillDef } from "../core/types";
import * as DrillAnim from "../render/drill-anim";
import { drawArcadeButton, drawHardShadow, drawVeil, fadeOutHide, pressFx, slamIn, uiIconButton } from "./ui-arcade";

// ---------- 布局(设计分辨率 960×540) ----------

const PW = 880, PH = 470;

// 列表页:3 列 × 2 行(六关正好铺满面板宽,不再中间一坨、两边空一大片)
const CARD_W = 272, CARD_H = 150, CARD_GAP = 14;
const GRID_COLS = 3;
const GRID_ROWS = Math.ceil(DRILLS.length / GRID_COLS);

// 引导页:左动画 + 右信息
const ANIM_W = 470, ANIM_H = 300;
const INFO_W = PW - ANIM_W - 40;

// 配色(与 career-panel 同源:对齐老 base.css 街机令牌)
const COL = {
  panelBg: new Color(16, 16, 24, 228),        // 面板黑:半透,身后球场还看得见
  cardBg: new Color(26, 26, 38, 208),         // 卡片黑
  cardSel: new Color(255, 225, 77, 255),      // --acid
  cardDone: new Color(21, 56, 42, 208),
  accent: new Color(255, 225, 77, 255),
  gold: new Color(255, 225, 77, 255),
  hot: new Color(255, 106, 31, 255),
  cyan: new Color(0, 240, 255, 255),
  green: new Color(125, 255, 158, 255),       // --good
  white: new Color(245, 239, 225, 255),       // --paper
  dimWhite: new Color(159, 176, 216, 200),
  dimGray: new Color(140, 153, 190, 235),
  overlay: new Color(7, 7, 13, 102),          // --ink 遮罩基准(渐变由 drawVeil 补)
  starOn: new Color(255, 225, 77, 255),
  // 未得星:白 18% 的细空心圈在 navy 面板上基本看不见,0 星的卡像缺了块东西
  starOff: new Color(159, 176, 216, 130),
  btnPrimary: new Color(230, 0, 18, 255),     // 斩劈红厚底主按钮
  btnPrimaryEdge: new Color(255, 107, 114, 255),
  // 次级按钮:白 7% 压在 panelBg 上只有约 1.1:1,读不出「这是个按钮」。
  // 与 career 的未选中 tab 同一个病,一起换成抬一档的 navy-2 + 冷灰描边。
  btnGhost: new Color(26, 26, 38, 235),
  btnGhostEdge: new Color(159, 176, 216, 90),
  btnDanger: new Color(110, 32, 41, 230),
};

/** 红面主按钮上的浅色前景字(P5:斩劈红面白字) */
const PRIMARY_FG = new Color(255, 245, 242, 255);

// ---------- UI 辅助(与 career-panel 同构) ----------

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
  n.addComponent(UITransform).setContentSize(o.w ?? 200, size * 1.4 * (o.lines ?? 1));
  if (o.x !== undefined || o.y !== undefined) n.setPosition(o.x ?? 0, o.y ?? 0, 0);
  n.setParent(parent);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.3);
  l.horizontalAlign = o.align ?? 0;
  l.verticalAlign = 1;
  l.color = color;
  l.overflow = Label.Overflow.CLAMP;
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

/** 画星级:★ 填满 n 个,空 (3-n) 个 */
function drawStars(g: Graphics, cx: number, cy: number, n: number, size: number) {
  const gap = size * 1.3;
  const startX = cx - gap;
  for (let i = 0; i < 3; i++) {
    const x = startX + i * gap;
    // 用实心/空心圆近似:亮的用 gold 实心,暗的用 gray 空心
    if (i < n) {
      g.fillColor = COL.starOn;
      g.circle(x, cy, size * 0.42);
      g.fill();
    } else {
      g.strokeColor = COL.starOff;
      g.lineWidth = 2;
      g.circle(x, cy, size * 0.38);
      g.stroke();
    }
  }
}

// ---------- 辅助 ----------

const goalOf = (d: DrillDef): number => d.goal || CFG.drill.defaultGoal;
const recOf = (id: string) => Career.profile().drills[id] || null;
const starsOf = (id: string): number => (recOf(id) || {}).stars || 0;

/** 满星奖励(首通 + 3 星) */
function prize(def: DrillDef) {
  const cd = CFG.career.drill;
  return {
    coin: cd.firstClear.coin + 3 * cd.perStar.coin,
    exp: cd.firstClear.exp + 3 * cd.perStar.exp,
  };
}

/** 易懂口诀 */
function coachTipOf(id: string): string {
  switch (id) {
    case "smash":
      return "起跳至最高点，球在头顶上方时按下「深球」大力下压";
    case "clear":
      return "在后场站定，等球到头顶前方时按「深球」抽到底线";
    case "slash":
      return "面对后场高球，高点击球但轻按「短球」收力切前场";
    case "netshot":
      return "快速上网，等球刚过网口时轻按「短球」轻搓放网";
    case "drive":
      return "中场快速迎击，不等球下落迅速按「深球」平抽推深";
    case "lob":
      return "快速上网，等球落到脚下低点时轻按「短球」向上铲起";
    default:
      return "看准来球轨迹，抓住最佳时机按键击球";
  }
}

/** 明确键位指导 */
function keyPromptOf(def: DrillDef): string {
  const shotKey = def.wantKey === "near" ? "短球 [K / 左键]" : "深球 [J / 右键]";
  const jumpKey = def.pose?.jump ? " + 起跳 [W / 向上]" : " (无需起跳)";
  return `操作按键：${shotKey}${jumpKey}`;
}

// ============================================================

export class DrillPanel extends Component {

  // ---------- 公开接口 ----------

  /** 构建并显示面板(列表 + 引导) */
  show(parent: Node, onSelectDrill: (drill: DrillDef) => void, onBack: () => void) {
    this._onSelectDrill = onSelectDrill;
    this._onBack = onBack;
    this._page = "list";
    this._sel = 0;
    this._buildAll();
    if (this.node && this.node !== parent) {
      this.node.setParent(parent);
    }
    if (this.root) {
      this.root.setParent(parent);
    }
    this._showList();
    if (this._panelNode) slamIn(this._panelNode);   // 老 .panel slam 砸落
  }

  /** 销毁面板 */
  hide() {
    input.off(Input.EventType.KEY_DOWN, this._onKey, this);
    this._onSelectDrill = null;
    this._onBack = null;
    // 复位动画状态,防止 update() 对已销毁 Graphics 继续绘制报错
    this._page = "list";
    this._rig = null;
    this._animGfx = null;
    this._animMs = 0;
    this._stageLabel = null;
    this._btnPlayLabel = null;
    this._btnSpeedLabel = null;
    // 退场淡出后再销毁整树;引用立刻置空,防止 update() 摸到已收走的节点
    const r = this.root;
    if (r && r.isValid) fadeOutHide(r, () => { if (r.isValid) r.destroy(); });
    this.root = null!;
    this._panelNode = null;
  }

  /** 每帧:驱动引导页动画 */
  update(dt: number) {
    if (this._page !== "brief" || !this._rig || !this._animGfx) return;
    if (!this._rig.paused) {
      this._animMs += dt * 1000 * this._rig.speed;
    }
    DrillAnim.draw(this._animGfx, this._rig, this._animMs, ANIM_W, ANIM_H);
    if (this._stageLabel && this._rig) {
      const st = DrillAnim.stageOfFrame(this._rig.currentFrame);
      this._stageLabel.string = `${st.index + 1}. ${st.name} · ${st.desc}`;
    }
  }

  // ---------- 内部状态 ----------

  private root!: Node;
  private _panelNode: Node | null = null;
  private _onSelectDrill: ((drill: DrillDef) => void) | null = null;
  private _onBack: (() => void) | null = null;

  private _page: "list" | "brief" = "list";
  private _sel = 0;

  // 缓存节点
  private _listPage!: Node;
  private _briefPage!: Node;
  private _gridNode!: Node;
  private _headInfo!: Label;

  // 引导页
  private _animGfx: Graphics | null = null;
  private _rig: DrillAnim.DrillRig | null = null;
  private _animMs = 0;
  private _stageLabel: Label | null = null;
  private _btnPlayLabel: Label | null = null;
  private _btnSpeedLabel: Label | null = null;

  // 结算页
  private _resultContent!: Node;

  // ========== 节点搭建 ==========

  private _buildAll() {
    this.root = new Node("drill-panel");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform).setContentSize(960, 540);
    const wg = this.root.addComponent(Widget);
    wg.isAlignTop = wg.isAlignBottom = wg.isAlignLeft = wg.isAlignRight = true;
    wg.top = wg.bottom = wg.left = wg.right = 0;

    // 遮罩:中心 0.4、四周 0.72 的渐变(老 .screen),再挡住往世界漏的点击
    const overlay = mkNode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = COL.overlay;
    og.rect(-480, -270, 960, 540);
    og.fill();
    drawVeil(og, 960, 540, 0, 0.53);   // 四周最终收到 ~0.72
    overlay.addComponent(BlockInputEvents);

    // 面板背景(硬偏移阴影 + navy 底)
    const panel = mkNode("panel", this.root, PW, PH);
    panel.setPosition(0, -10, 0);
    this._panelNode = panel;
    const pg = panel.addComponent(Graphics);
    drawHardShadow(pg, PW, PH, 16, 6, 6, 0.55);
    drawRR(pg, PW, PH, 16, COL.panelBg, new Color(245, 239, 225, 36), 1.5);

    // 顶部标题栏
    this._buildTopBar(panel);

    // 三页容器
    this._listPage = mkNode("listPage", panel, PW - 20, PH - 60);
    this._listPage.setPosition(0, -20, 0);

    this._briefPage = mkNode("briefPage", panel, PW - 20, PH - 60);
    this._briefPage.setPosition(0, -20, 0);
    this._briefPage.active = false;

    // 列表页内容
    this._buildListPage();

    // 键盘
    input.on(Input.EventType.KEY_DOWN, this._onKey, this);
  }

  // ----- 顶部标题栏 -----
  private _buildTopBar(panel: Node) {
    const bar = mkNode("topBar", panel, PW - 20, 40);
    bar.setPosition(0, PH / 2 - 24, 0);

    mkLabel(bar, "title", "训练场", 20, COL.gold, { x: -PW / 2 + 60, y: 4, w: 100 });

    this._headInfo = mkLabel(bar, "headInfo", "", 14, COL.dimWhite, {
      x: 0, y: 4, w: 200, align: 1,
    });

    // 返回按钮:命中区 56(视觉圆底 44),Button.CLICK 自带按压反馈
    const back = uiIconButton(bar, "✕", { bg: "#6e2029", edge: "#ff8a8a", fontSize: 20 });
    back.setPosition(PW / 2 - 40, 2, 0);
    back.on(Button.EventType.CLICK, () => {
      this._onBack?.();
      this.hide();
    });
  }

  // ========== 列表页 ==========

  private _buildListPage() {
    // 网格容器
    const totalW = GRID_COLS * CARD_W + (GRID_COLS - 1) * CARD_GAP;
    const totalH = GRID_ROWS * CARD_H + (GRID_ROWS - 1) * CARD_GAP;
    this._gridNode = mkNode("grid", this._listPage, totalW, totalH);
    this._gridNode.setPosition(0, 6, 0);

    this._buildCards();
  }

  private _buildCards() {
    this._gridNode.removeAllChildren();
    const totalW = GRID_COLS * CARD_W + (GRID_COLS - 1) * CARD_GAP;
    const totalH = GRID_ROWS * CARD_H + (GRID_ROWS - 1) * CARD_GAP;

    DRILLS.forEach((d, i) => {
      const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
      const x = -totalW / 2 + col * (CARD_W + CARD_GAP) + CARD_W / 2;
      const y = totalH / 2 - row * (CARD_H + CARD_GAP) - CARD_H / 2;

      const rec = recOf(d.id);
      const stars = starsOf(d.id);
      const cleared = rec && rec.clears > 0;
      const p = prize(d);

      const card = mkNode(`card-${i}`, this._gridNode, CARD_W, CARD_H);
      card.setPosition(x, y, 0);

      const g = card.addComponent(Graphics);
      const sel = i === this._sel;
      const borderCol = sel ? COL.cardSel
        : cleared ? COL.green
          : new Color(107, 124, 166, 170);
      const bgCol = cleared ? COL.cardDone : COL.cardBg;
      if (sel) drawHardShadow(g, CARD_W, CARD_H, 10, 4, 4, 0.45);   // 选中卡浮起
      drawRR(g, CARD_W, CARD_H, 10, bgCol, borderCol, sel ? 2.5 : 1.5);

      // tag 标签(左上)+ 星级(右上,一眼看到练到什么程度)
      mkLabel(card, "tag", d.tag, 12, COL.cyan, { x: -CARD_W / 2 + 34, y: CARD_H / 2 - 18, w: 60 });
      const starNode = mkNode("stars", card, 72, 18);
      starNode.setPosition(CARD_W / 2 - 46, CARD_H / 2 - 18, 0);
      const sg = starNode.addComponent(Graphics);
      drawStars(sg, 0, 0, stars, 15);

      // 名称
      mkLabel(card, "name", d.label, 19, COL.white, { x: 0, y: CARD_H / 2 - 48, w: CARD_W - 24, align: 1 });

      // 描述
      mkLabel(card, "desc", d.desc, 12, COL.dimWhite, { x: 0, y: CARD_H / 2 - 74, w: CARD_W - 28, align: 1 });

      // 达标拍数
      mkLabel(card, "goal", `目标 ${goalOf(d)} 拍有效球`, 12, COL.dimGray, { y: -CARD_H / 2 + 36, w: CARD_W - 20, align: 1 });

      // 底部信息
      const footText = cleared
        ? `已练成 ${rec!.clears} 次 · 首通 金币${p.coin}`
        : `首通奖励 金币${p.coin} · EXP${p.exp}`;
      const footColor = cleared ? COL.green : COL.gold;
      mkLabel(card, "foot", footText, 12, footColor, { y: -CARD_H / 2 + 16, w: CARD_W - 20, align: 1 });

      // 点击(先注册业务回调再补按压反馈:重建网格销毁卡片时动画不会晚到一步)
      const idx = i;
      card.on(Node.EventType.TOUCH_END, () => {
        this._sel = idx;
        this._buildCards();
        this._openBrief(DRILLS[idx]);
      });
      pressFx(card);
    });

    // 更新头部信息
    const n = DRILLS.filter((d) => (recOf(d.id) || {}).clears > 0).length;
    this._headInfo.string = `${n} / ${DRILLS.length} 已练成`;
  }

  // ========== 引导页 ==========

  private _openBrief(def: DrillDef) {
    this._page = "brief";
    this._rig = DrillAnim.build(def, Career.skinOf("player"));
    this._animMs = 0;

    this._listPage.active = false;
    this._briefPage.active = true;

    // 清空旧内容
    this._briefPage.removeAllChildren();

    // 左侧:动画区 (470×300)
    const animArea = mkNode("animArea", this._briefPage, ANIM_W, ANIM_H);
    animArea.setPosition(-(PW - 20) / 2 + ANIM_W / 2 + 5, 30, 0);

    // 动画背景框
    const animBg = animArea.addComponent(Graphics);
    drawRR(animBg, ANIM_W, ANIM_H, 10, new Color(12, 16, 28, 240), new Color(159, 176, 216, 80), 1.5);

    // 动画 Graphics 节点
    const gfxNode = mkNode("animGfx", animArea, ANIM_W, ANIM_H);
    this._animGfx = gfxNode.addComponent(Graphics);

    // 左上角角标: 教学演示
    const tagNode = mkNode("demoTag", animArea, 130, 24);
    tagNode.setPosition(-ANIM_W / 2 + 75, ANIM_H / 2 - 18, 0);
    const tagG = tagNode.addComponent(Graphics);
    drawRR(tagG, 130, 22, 5, new Color(18, 26, 52, 220), new Color(0, 240, 255, 120), 1);
    mkLabel(tagNode, "tagText", "教学演示 · 循环播放", 11, COL.cyan, { align: 1, w: 120 });

    // ---------- 左侧下方: 演示控制条 (y = -146) ----------
    const ctrlBar = mkNode("ctrlBar", this._briefPage, ANIM_W, 36);
    ctrlBar.setPosition(-(PW - 20) / 2 + ANIM_W / 2 + 5, -146, 0);

    // 1. 播放/暂停
    const btnPlay = mkNode("btnPlay", ctrlBar, 74, 32);
    btnPlay.setPosition(-ANIM_W / 2 + 42, 0, 0);
    const pg = btnPlay.addComponent(Graphics);
    drawRR(pg, 74, 32, 6, new Color(26, 26, 38, 240), new Color(159, 176, 216, 110), 1.2);
    this._btnPlayLabel = mkLabel(btnPlay, "txt", "⏸ 暂停", 12, COL.white, { align: 1, w: 74 });
    const playBtn = btnPlay.addComponent(Button);
    playBtn.transition = Button.Transition.SCALE;
    playBtn.zoomScale = 0.92;
    playBtn.target = btnPlay;
    btnPlay.on(Button.EventType.CLICK, () => {
      if (!this._rig) return;
      this._rig.paused = !this._rig.paused;
      if (this._btnPlayLabel) this._btnPlayLabel.string = this._rig.paused ? "▶ 播放" : "⏸ 暂停";
    });

    // 2. 0.5x 慢放
    const btnSpeed = mkNode("btnSpeed", ctrlBar, 74, 32);
    btnSpeed.setPosition(-ANIM_W / 2 + 122, 0, 0);
    const sg = btnSpeed.addComponent(Graphics);
    drawRR(sg, 74, 32, 6, new Color(26, 26, 38, 240), new Color(159, 176, 216, 110), 1.2);
    this._btnSpeedLabel = mkLabel(btnSpeed, "txt", "🐢 0.5x", 12, COL.gold, { align: 1, w: 74 });
    const speedBtn = btnSpeed.addComponent(Button);
    speedBtn.transition = Button.Transition.SCALE;
    speedBtn.zoomScale = 0.92;
    speedBtn.target = btnSpeed;
    btnSpeed.on(Button.EventType.CLICK, () => {
      if (!this._rig) return;
      this._rig.speed = this._rig.speed === 1.0 ? 0.5 : 1.0;
      if (this._btnSpeedLabel) this._btnSpeedLabel.string = this._rig.speed === 0.5 ? "⚡ 1.0x" : "🐢 0.5x";
    });

    // 3. 重播
    const btnReplay = mkNode("btnReplay", ctrlBar, 70, 32);
    btnReplay.setPosition(-ANIM_W / 2 + 200, 0, 0);
    const rg = btnReplay.addComponent(Graphics);
    drawRR(rg, 70, 32, 6, new Color(26, 26, 38, 240), new Color(159, 176, 216, 110), 1.2);
    mkLabel(btnReplay, "txt", "↺ 重播", 12, COL.white, { align: 1, w: 70 });
    const repBtn = btnReplay.addComponent(Button);
    repBtn.transition = Button.Transition.SCALE;
    repBtn.zoomScale = 0.92;
    repBtn.target = btnReplay;
    btnReplay.on(Button.EventType.CLICK, () => {
      this._animMs = 0;
      if (this._rig) {
        this._rig.paused = false;
        if (this._btnPlayLabel) this._btnPlayLabel.string = "⏸ 暂停";
      }
    });

    // 4. 当前步骤动态指示卡
    const stageCard = mkNode("stageCard", ctrlBar, 210, 32);
    stageCard.setPosition(ANIM_W / 2 - 110, 0, 0);
    const scg = stageCard.addComponent(Graphics);
    drawRR(scg, 210, 32, 6, new Color(16, 16, 26, 230), new Color(107, 124, 166, 120), 1.0);
    this._stageLabel = mkLabel(stageCard, "stTxt", "1. 迎球 · 观察来球", 11, COL.cyan, { align: 1, w: 200 });

    // ---------- 右侧: 信息区 (370×360) ----------
    const infoX = -(PW - 20) / 2 + ANIM_W + 20 + INFO_W / 2;
    const infoArea = mkNode("infoArea", this._briefPage, INFO_W, ANIM_H + 60);
    infoArea.setPosition(infoX, 8, 0);

    // 1. 关卡标题与 Tag
    mkLabel(infoArea, "title", def.label, 20, COL.white, { y: ANIM_H / 2 - 2, w: INFO_W - 20, align: 1 });
    mkLabel(infoArea, "tag", def.tag, 11, COL.cyan, { y: ANIM_H / 2 - 24, w: INFO_W - 20, align: 1 });

    // 2. 核心操作指导卡片 (高亮口诀 + 按键)
    const coachBox = mkNode("coachBox", infoArea, INFO_W - 16, 48);
    coachBox.setPosition(0, ANIM_H / 2 - 60, 0);
    const cbg = coachBox.addComponent(Graphics);
    drawRR(cbg, INFO_W - 16, 48, 8, new Color(26, 26, 40, 240), new Color(255, 225, 77, 160), 1.5);
    mkLabel(coachBox, "coachTip", coachTipOf(def.id), 12, COL.gold, { y: 8, w: INFO_W - 28, align: 1 });
    mkLabel(coachBox, "keyPrompt", keyPromptOf(def), 11, COL.white, { y: -12, w: INFO_W - 28, align: 1 });

    // 3. 动作要领
    const pointsHeader = mkNode("ptHead", infoArea, INFO_W - 20, 20);
    pointsHeader.setPosition(0, ANIM_H / 2 - 96, 0);
    mkLabel(pointsHeader, "ptTitle", "【动作要领】", 12, COL.dimWhite, { x: -INFO_W / 2 + 56, y: 0, w: 100 });

    const pointsText = def.points.map((t, i) => `${i + 1}. ${t}`).join("\n");
    mkLabel(infoArea, "points", pointsText, 11, COL.dimWhite, {
      y: ANIM_H / 2 - 140, w: INFO_W - 28, align: 0, lines: def.points.length,
    });

    // 4. 三星通关规则说明卡片
    const starBox = mkNode("starBox", infoArea, INFO_W - 16, 56);
    starBox.setPosition(0, -ANIM_H / 2 + 76, 0);
    const sbg = starBox.addComponent(Graphics);
    drawRR(sbg, INFO_W - 16, 56, 6, new Color(18, 18, 28, 220), new Color(159, 176, 216, 80), 1.0);
    mkLabel(starBox, "sHead", "★ 考核指标", 11, COL.gold, { x: -INFO_W / 2 + 56, y: 16, w: 90 });
    const starDesc = "★ 基础：打出 3 拍有效回球\n★★ 进阶：2 拍击中甜蜜区\n★★★ 炉火纯青：1 次完美击球且综合质量≥78%";
    mkLabel(starBox, "sDesc", starDesc, 10, COL.dimWhite, { y: -10, w: INFO_W - 32, align: 0, lines: 3 });

    // 5. 底部按钮
    const btnY = -ANIM_H / 2 + 10;
    // 开始训练
    const btnGo = mkNode("btnGo", infoArea, 180, 48);
    btnGo.setPosition(-88, btnY, 0);
    const goG = btnGo.addComponent(Graphics);
    drawHardShadow(goG, 180, 48, 8, 3, 4, 0.45);
    drawArcadeButton(goG, 180, 48, "primary", 8);
    mkLabel(btnGo, "text", "开始训练", 16, PRIMARY_FG, { align: 1, w: 180 });
    const goBtn = btnGo.addComponent(Button);
    goBtn.transition = Button.Transition.SCALE;
    goBtn.zoomScale = 0.94;
    goBtn.target = btnGo;
    btnGo.on(Button.EventType.CLICK, () => {
      this._onSelectDrill?.(def);
    });

    // 换个项目
    const btnBack = mkNode("btnBack", infoArea, 136, 48);
    btnBack.setPosition(102, btnY, 0);
    const bkG = btnBack.addComponent(Graphics);
    drawHardShadow(bkG, 136, 48, 8, 3, 4, 0.4);
    drawArcadeButton(bkG, 136, 48, "ghost", 8);
    mkLabel(btnBack, "text", "换个项目", 15, COL.dimWhite, { align: 1, w: 136 });
    const backBtn = btnBack.addComponent(Button);
    backBtn.transition = Button.Transition.SCALE;
    backBtn.zoomScale = 0.94;
    backBtn.target = btnBack;
    btnBack.on(Button.EventType.CLICK, () => {
      this._showList();
    });
  }

  private _showList() {
    this._page = "list";
    this._rig = null;
    this._animGfx = null;
    this._stageLabel = null;
    this._btnPlayLabel = null;
    this._btnSpeedLabel = null;
    this._briefPage.active = false;
    this._listPage.active = true;
    this._buildCards();
  }

  // ========== 键盘 ==========

  private _onKey(event: EventKeyboard) {
    if (!this.root || !this.root.isValid) return;
    const kc = event.keyCode;
    // Cocos 的 EventKeyboard 没有直接的 `code` 字段,只有 keyCode + rawEvent。
    // Web 预览/构建里 rawEvent 是原生 KeyboardEvent → 取 e.code 得 "KeyA"/"Enter" 之类;
    // 原生 APK 里 rawEvent 缺 → 回退到用 keyCode 判定的旧写法(kc === KeyCode.KEY_Q 等)。
    // 与 input/keyboard.ts 的 getCode() 同一套兜底,不新造第二份逻辑。
    const raw = (event as unknown as { rawEvent?: { code?: string } }).rawEvent;
    const code = raw && typeof raw.code === "string" ? raw.code : "";
    const isEnter = kc === KeyCode.ENTER || kc === KeyCode.SPACE || code === "Enter" || code === "Space" || code === "NumpadEnter";
    const isEsc = kc === KeyCode.ESCAPE || code === "Escape";
    const isQ = kc === KeyCode.KEY_Q || code === "KeyQ";
    const isUp = kc === KeyCode.ARROW_UP || kc === KeyCode.KEY_W || code === "ArrowUp" || code === "KeyW";
    const isDown = kc === KeyCode.ARROW_DOWN || kc === KeyCode.KEY_S || code === "ArrowDown" || code === "KeyS";
    const isLeft = kc === KeyCode.ARROW_LEFT || kc === KeyCode.KEY_A || code === "ArrowLeft" || code === "KeyA";
    const isRight = kc === KeyCode.ARROW_RIGHT || kc === KeyCode.KEY_D || code === "ArrowRight" || code === "KeyD";

    if (this._page === "brief") {
      if (isEnter) {
        if (this._rig) this._onSelectDrill?.(this._rig.def);
        return;
      }
      if (isEsc) {
        this._showList();
        return;
      }
      if (isQ) {
        this._onBack?.();
        this.hide();
      }
      return;
    }

    // 列表页
    if (isUp || isLeft) {
      this._sel = (this._sel - 1 + DRILLS.length) % DRILLS.length;
      this._buildCards();
      return;
    }
    if (isDown || isRight) {
      this._sel = (this._sel + 1) % DRILLS.length;
      this._buildCards();
      return;
    }
    if (isEnter) {
      this._openBrief(DRILLS[this._sel]);
      return;
    }
    if (isEsc || isQ) {
      this._onBack?.();
      this.hide();
    }
  }
}
