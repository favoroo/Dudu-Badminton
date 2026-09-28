// ============================================================
// 训练场面板:关卡列表 → 动作引导(嵌入 DrillAnim) → 训练 → 结算
// 纯代码构建 UI 节点,复刻老项目 src/ui-drill.js 的完整交互。
// 依赖:DrillAnim(演示动画)、Career(存档)、DRILLS(关卡配置)
// ============================================================
import {
  Color, Component, EventKeyboard, Graphics, Input, input, KeyCode, Label, Layers, Node,
  UITransform, Widget, _decorator,
} from "cc";
import { Career } from "../core/career";
import { CFG, DRILLS } from "../core/config";
import { DrillDef } from "../core/types";
import { DrillResult } from "../core/drill";
import * as DrillAnim from "../render/drill-anim";
import { drawHardShadow, slamIn } from "./ui-arcade";

// ---------- 布局(设计分辨率 960×540) ----------

const PW = 880, PH = 470;

// 列表页:2 列 × 3 行
const CARD_W = 260, CARD_H = 120, CARD_GAP = 12;
const GRID_COLS = 2;

// 引导页:左动画 + 右信息
const ANIM_W = 470, ANIM_H = 300;
const INFO_W = PW - ANIM_W - 40;

// 配色(与 career-panel 同源:对齐老 base.css 街机令牌)
const COL = {
  panelBg: new Color(14, 20, 40, 246),        // --navy
  cardBg: new Color(24, 33, 66, 235),         // --navy-2
  cardSel: new Color(255, 225, 77, 255),      // --acid
  cardDone: new Color(21, 56, 42, 235),
  accent: new Color(255, 225, 77, 255),
  gold: new Color(255, 225, 77, 255),
  hot: new Color(255, 106, 31, 255),
  cyan: new Color(0, 240, 255, 255),
  green: new Color(125, 255, 158, 255),       // --good
  white: new Color(245, 239, 225, 255),       // --paper
  dimWhite: new Color(159, 176, 216, 200),
  dimGray: new Color(111, 124, 166, 190),
  overlay: new Color(5, 7, 15, 175),          // --ink
  starOn: new Color(255, 225, 77, 255),
  starOff: new Color(255, 255, 255, 46),
  btnPrimary: new Color(255, 225, 77, 255),   // acid 厚底主按钮
  btnGhost: new Color(255, 255, 255, 18),
  btnDanger: new Color(110, 32, 41, 230),
};

/** acid 底按钮上的深色前景字(老 .btn.primary 的 #1a1a2a) */
const DARK_FG = new Color(20, 16, 10, 255);

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
      g.lineWidth = 1.5;
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

  /** 切换到结算页 */
  showResult(result: DrillResult, onRetry: () => void, onNext: () => void, onQuit: () => void) {
    this._onRetry = onRetry;
    this._onNext = onNext;
    this._onQuitResult = onQuit;
    this._page = "result";
    this._buildResultPage(result);
    this._listPage.active = false;
    this._briefPage.active = false;
    this._resultPage.active = true;
  }

  /** 销毁面板 */
  hide() {
    input.off(Input.EventType.KEY_DOWN, this._onKey, this);
    this._onSelectDrill = null;
    this._onBack = null;
    this._onRetry = null;
    this._onNext = null;
    this._onQuitResult = null;
    if (this.root && this.root.isValid) this.root.destroy();
    this.root = null!;
    this._panelNode = null;
  }

  /** 每帧:驱动引导页动画 */
  update(dt: number) {
    if (this._page !== "brief" || !this._rig || !this._animGfx) return;
    this._animMs += dt * 1000;
    DrillAnim.draw(this._animGfx, this._rig, this._animMs, ANIM_W, ANIM_H);
  }

  // ---------- 内部状态 ----------

  private root!: Node;
  private _panelNode: Node | null = null;
  private _onSelectDrill: ((drill: DrillDef) => void) | null = null;
  private _onBack: (() => void) | null = null;
  private _onRetry: (() => void) | null = null;
  private _onNext: (() => void) | null = null;
  private _onQuitResult: (() => void) | null = null;

  private _page: "list" | "brief" | "result" = "list";
  private _sel = 0;

  // 缓存节点
  private _listPage!: Node;
  private _briefPage!: Node;
  private _resultPage!: Node;
  private _gridNode!: Node;
  private _headInfo!: Label;
  private _hintLabel!: Label;

  // 引导页
  private _animGfx: Graphics | null = null;
  private _rig: DrillAnim.DrillRig | null = null;
  private _animMs = 0;
  private _briefTitle!: Label;
  private _briefGoal!: Label;
  private _briefCue!: Label;
  private _briefPoints!: Label;
  private _briefCaption!: Label;

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

    // 遮罩
    const overlay = mkNode("overlay", this.root, 960, 540);
    const og = overlay.addComponent(Graphics);
    og.fillColor = COL.overlay;
    og.rect(-480, -270, 960, 540);
    og.fill();

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

    this._resultPage = mkNode("resultPage", panel, PW - 20, PH - 60);
    this._resultPage.setPosition(0, -20, 0);
    this._resultPage.active = false;

    // 列表页内容
    this._buildListPage();

    // 底部提示
    this._hintLabel = mkLabel(panel, "hint", "", 13, COL.dimGray, {
      y: -PH / 2 + 18, w: PW - 40, align: 1,
    });

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

    // 返回按钮
    const back = mkNode("back", bar, 36, 36);
    back.setPosition(PW / 2 - 28, 2, 0);
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
      this._onBack?.();
      this.hide();
    });
  }

  // ========== 列表页 ==========

  private _buildListPage() {
    // 网格容器
    const totalW = GRID_COLS * CARD_W + (GRID_COLS - 1) * CARD_GAP;
    const totalH = 3 * CARD_H + 2 * CARD_GAP;
    this._gridNode = mkNode("grid", this._listPage, totalW, totalH);
    this._gridNode.setPosition(0, 10, 0);

    this._buildCards();
  }

  private _buildCards() {
    this._gridNode.removeAllChildren();
    const totalW = GRID_COLS * CARD_W + (GRID_COLS - 1) * CARD_GAP;

    DRILLS.forEach((d, i) => {
      const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
      const x = -totalW / 2 + col * (CARD_W + CARD_GAP) + CARD_W / 2;
      const y = (3 * CARD_H + 2 * CARD_GAP) / 2 - row * (CARD_H + CARD_GAP) - CARD_H / 2;

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
          : new Color(50, 58, 78, 140);
      const bgCol = cleared ? COL.cardDone : COL.cardBg;
      if (sel) drawHardShadow(g, CARD_W, CARD_H, 10, 4, 4, 0.5);   // 选中卡浮起
      drawRR(g, CARD_W, CARD_H, 10, bgCol, borderCol, sel ? 2.5 : 1.5);

      // tag 标签
      mkLabel(card, "tag", d.tag, 11, COL.cyan, { x: -CARD_W / 2 + 32, y: CARD_H / 2 - 16, w: 50 });

      // 名称
      mkLabel(card, "name", d.label, 17, COL.white, { x: 10, y: CARD_H / 2 - 16, w: CARD_W - 70, align: 0 });

      // 描述
      mkLabel(card, "desc", d.desc, 12, COL.dimWhite, { x: 0, y: CARD_H / 2 - 38, w: CARD_W - 20, align: 1 });

      // 星级
      const starNode = mkNode("stars", card, 60, 16);
      starNode.setPosition(0, CARD_H / 2 - 58, 0);
      const sg = starNode.addComponent(Graphics);
      drawStars(sg, 0, 0, stars, 14);

      // 底部信息
      const footText = cleared
        ? `已练成 ${rec!.clears} 次`
        : `首通 🪙${p.coin} · EXP${p.exp}`;
      const footColor = cleared ? COL.green : COL.gold;
      mkLabel(card, "foot", footText, 11, footColor, { y: -CARD_H / 2 + 14, w: CARD_W - 20, align: 1 });

      // 达标拍数
      mkLabel(card, "goal", `有效 ${goalOf(d)} 拍`, 10, COL.dimGray, { y: -CARD_H / 2 + 30, w: CARD_W - 20, align: 1 });

      // 点击
      const idx = i;
      card.on(Node.EventType.TOUCH_END, () => {
        this._sel = idx;
        this._buildCards();
        this._openBrief(DRILLS[idx]);
      });
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

    // 左侧:动画区
    const animArea = mkNode("animArea", this._briefPage, ANIM_W, ANIM_H);
    animArea.setPosition(-(PW - 20) / 2 + ANIM_W / 2 + 5, 30, 0);

    // 动画背景框
    const animBg = animArea.addComponent(Graphics);
    drawRR(animBg, ANIM_W, ANIM_H, 10, new Color(12, 16, 28, 240), new Color(50, 60, 80, 100), 1);

    // 动画 Graphics 节点
    const gfxNode = mkNode("animGfx", animArea, ANIM_W, ANIM_H);
    this._animGfx = gfxNode.addComponent(Graphics);

    // 右侧:信息区
    const infoX = -(PW - 20) / 2 + ANIM_W + 20 + INFO_W / 2;
    const infoArea = mkNode("infoArea", this._briefPage, INFO_W, ANIM_H + 60);
    infoArea.setPosition(infoX, 10, 0);

    // 标题 + tag
    const titleText = `${def.label}`;
    mkLabel(infoArea, "title", titleText, 20, COL.white, { y: ANIM_H / 2 - 10, w: INFO_W - 20, align: 1 });

    // tag 小标签
    mkLabel(infoArea, "tag", def.tag, 12, COL.cyan, { y: ANIM_H / 2 - 32, w: INFO_W - 20, align: 1 });

    // 达标要求
    const goalText = `达标 ${goalOf(def)} 拍有效球`;
    mkLabel(infoArea, "goal", goalText, 14, COL.gold, { y: ANIM_H / 2 - 56, w: INFO_W - 20, align: 1 });

    // 提示语
    mkLabel(infoArea, "cue", def.cue, 13, COL.dimWhite, { y: ANIM_H / 2 - 78, w: INFO_W - 20, align: 1 });

    // 要点列表
    const pointsText = def.points.map((t, i) => `${i + 1}. ${t}`).join("\n");
    mkLabel(infoArea, "points", pointsText, 12, COL.dimWhite, {
      y: -10, w: INFO_W - 24, align: 0,
    });

    // 底部说明
    const key = DrillAnim.keyLabel(def.wantKey === "near" ? "swingNear" : "swingFar");
    mkLabel(infoArea, "caption", `第 ${DrillAnim.contactFrame().toFixed(0)} 帧出手最甜 · 按 ${key}`,
      11, COL.dimGray, { y: -ANIM_H / 2 + 50, w: INFO_W - 20, align: 1 });

    // 按钮区
    const btnY = -ANIM_H / 2 + 10;

    // 开始训练
    const btnGo = mkNode("btnGo", infoArea, 140, 36);
    btnGo.setPosition(0, btnY, 0);
    const goG = btnGo.addComponent(Graphics);
    drawRR(goG, 140, 36, 8, COL.btnPrimary);
    const goL = btnGo.addComponent(Label);
    goL.string = "开始训练"; goL.fontSize = 15; goL.lineHeight = 20;
    goL.horizontalAlign = 1; goL.verticalAlign = 1; goL.color = DARK_FG;   // acid 底配深字(老 .btn.primary)
    btnGo.on(Node.EventType.TOUCH_END, () => {
      this._onSelectDrill?.(def);
    });

    // 换个项目
    const btnBack = mkNode("btnBack", infoArea, 120, 32);
    btnBack.setPosition(0, btnY - 42, 0);
    const bkG = btnBack.addComponent(Graphics);
    drawRR(bkG, 120, 32, 8, COL.btnGhost);
    const bkL = btnBack.addComponent(Label);
    bkL.string = "换个项目"; bkL.fontSize = 13; bkL.lineHeight = 18;
    bkL.horizontalAlign = 1; bkL.verticalAlign = 1; bkL.color = COL.dimWhite;
    btnBack.on(Node.EventType.TOUCH_END, () => {
      this._showList();
    });

    this._hintLabel.string = "Enter 开始 · Esc 回列表 · Q 回菜单";
  }

  private _showList() {
    this._page = "list";
    this._rig = null;
    this._animGfx = null;
    this._briefPage.active = false;
    this._resultPage.active = false;
    this._listPage.active = true;
    this._buildCards();
    this._hintLabel.string = "W/S 选项目 · Enter 看动作引导 · Esc 回菜单";
  }

  // ========== 结算页 ==========

  private _buildResultPage(res: DrillResult) {
    this._resultPage.removeAllChildren();
    this._resultPage.active = true;

    const cw = this._resultPage.getComponent(UITransform)!.contentSize.width;
    const ch = this._resultPage.getComponent(UITransform)!.contentSize.height;

    // 判定语
    const verdict = res.stars >= 3 ? "手感在线" : res.stars >= 1 ? "练成了" : "还没练满";
    const verdictColor = res.stars >= 3 ? COL.gold : res.stars >= 1 ? COL.green : COL.hot;
    mkLabel(this._resultPage, "verdict", verdict, 28, verdictColor, {
      y: ch / 2 - 30, w: cw - 40, align: 1,
    });

    // 星级
    const starNode = mkNode("stars", this._resultPage, 100, 30);
    starNode.setPosition(0, ch / 2 - 65, 0);
    const sg = starNode.addComponent(Graphics);
    drawStars(sg, 0, 0, res.stars, 22);

    // 统计行
    const stats = [
      { val: `${Math.min(res.valid, res.goal)}/${res.goal}`, label: "有效球" },
      { val: `${res.sweet}`, label: "甜蜜点击球" },
      { val: `${res.perfect}`, label: "完美击球" },
      { val: res.attempts ? `${Math.round(100 * res.valid / res.attempts)}%` : "—", label: "出手命中率" },
      { val: res.avgQ ? res.avgQ.toFixed(2) : "—", label: "平均质量" },
    ];

    const rowW = 130, rowH = 56, rowGap = 8;
    const statsTotalW = stats.length * rowW + (stats.length - 1) * rowGap;
    const statsStartX = -statsTotalW / 2 + rowW / 2;
    const statsY = ch / 2 - 120;

    stats.forEach((s, i) => {
      const x = statsStartX + i * (rowW + rowGap);
      const node = mkNode(`stat-${i}`, this._resultPage, rowW, rowH);
      node.setPosition(x, statsY, 0);
      const g = node.addComponent(Graphics);
      drawRR(g, rowW, rowH, 8, new Color(25, 30, 45, 200), new Color(50, 60, 80, 80), 1);
      mkLabel(node, "val", s.val, 20, COL.white, { y: 8, w: rowW - 10, align: 1 });
      mkLabel(node, "label", s.label, 11, COL.dimGray, { y: -14, w: rowW - 10, align: 1 });
    });

    // 奖励区
    const rewardY = statsY - rowH / 2 - 40;
    const prev = recOf(res.def?.id || "");
    // settleDrill 在 showResult 之前已被调用,clears 已自增
    // clears === 1 表示刚刚首次通关
    const isFirstClear = prev && prev.clears === 1 && res.stars >= 1;

    if (isFirstClear && res.def) {
      const cd = CFG.career.drill;
      const coin = cd.firstClear.coin + res.stars * cd.perStar.coin;
      const exp = cd.firstClear.exp + res.stars * cd.perStar.exp;
      mkLabel(this._resultPage, "reward",
        `首次通关 🪙 +${coin} · EXP +${exp}`,
        16, COL.gold, { y: rewardY, w: cw - 40, align: 1 });
    } else {
      const clears = prev ? prev.clears : 0;
      let text = `这一关已练成 ${clears} 次 · 奖励只在首次通关发`;
      // 星级提升提示
      if (prev && clears > 1 && res.stars > 0) {
        // 无法精确得知之前的星级,只提示当前星级
        text += ` · 本次 ${res.stars}★`;
      }
      mkLabel(this._resultPage, "reward", text, 13, COL.dimGray, {
        y: rewardY, w: cw - 40, align: 1,
      });
    }

    // 按钮区
    const btnY = -ch / 2 + 40;

    // 再来一次
    const btnRetry = mkNode("btnRetry", this._resultPage, 130, 36);
    btnRetry.setPosition(-160, btnY, 0);
    const rG = btnRetry.addComponent(Graphics);
    drawRR(rG, 130, 36, 8, COL.btnPrimary);
    const rL = btnRetry.addComponent(Label);
    rL.string = "再来一次"; rL.fontSize = 15; rL.lineHeight = 20;
    rL.horizontalAlign = 1; rL.verticalAlign = 1; rL.color = DARK_FG;   // acid 底配深字
    btnRetry.on(Node.EventType.TOUCH_END, () => {
      this._onRetry?.();
    });

    // 换个项目
    const btnNext = mkNode("btnNext", this._resultPage, 130, 36);
    btnNext.setPosition(0, btnY, 0);
    const nG = btnNext.addComponent(Graphics);
    drawRR(nG, 130, 36, 8, COL.btnGhost);
    const nL = btnNext.addComponent(Label);
    nL.string = "换个项目"; nL.fontSize = 15; nL.lineHeight = 20;
    nL.horizontalAlign = 1; nL.verticalAlign = 1; nL.color = COL.dimWhite;
    btnNext.on(Node.EventType.TOUCH_END, () => {
      this._onNext?.();
      this._showList();
    });

    // 返回菜单
    const btnQuit = mkNode("btnQuit", this._resultPage, 120, 36);
    btnQuit.setPosition(160, btnY, 0);
    const qG = btnQuit.addComponent(Graphics);
    drawRR(qG, 120, 36, 8, COL.btnDanger);
    const qL = btnQuit.addComponent(Label);
    qL.string = "返回菜单"; qL.fontSize = 15; qL.lineHeight = 20;
    qL.horizontalAlign = 1; qL.verticalAlign = 1; qL.color = COL.white;
    btnQuit.on(Node.EventType.TOUCH_END, () => {
      this._onQuitResult?.();
      this.hide();
    });

    this._hintLabel.string = "Enter 再来一次 · Esc 换个项目 · Q 回菜单";
  }

  // ========== 键盘 ==========

  private _onKey(event: EventKeyboard) {
    if (!this.root || !this.root.isValid) return;
    const kc = event.keyCode;
    const code = event.code;
    const isEnter = kc === KeyCode.ENTER || kc === KeyCode.SPACE || code === "Enter" || code === "Space" || code === "NumpadEnter";
    const isEsc = kc === KeyCode.ESCAPE || code === "Escape";
    const isQ = kc === KeyCode.KEY_Q || code === "KeyQ";
    const isUp = kc === KeyCode.ARROW_UP || kc === KeyCode.KEY_W || code === "ArrowUp" || code === "KeyW";
    const isDown = kc === KeyCode.ARROW_DOWN || kc === KeyCode.KEY_S || code === "ArrowDown" || code === "KeyS";
    const isLeft = kc === KeyCode.ARROW_LEFT || kc === KeyCode.KEY_A || code === "ArrowLeft" || code === "KeyA";
    const isRight = kc === KeyCode.ARROW_RIGHT || kc === KeyCode.KEY_D || code === "ArrowRight" || code === "KeyD";

    if (this._page === "result") {
      if (isEnter) {
        this._onRetry?.(); return;
      }
      if (isEsc) {
        this._onNext?.();
        this._showList();
        return;
      }
      if (isQ) {
        this._onQuitResult?.();
        this.hide();
      }
      return;
    }

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
