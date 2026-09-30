// ============================================================
// 闯关挑战模式大厅面板 (Campaign Challenge Panel)
// 街机 / P5 暗红斩劈风 UI 布局：
// 1. 顶部四大场景 Tab（海滩、道场、赛博、黄昏馆）与全局总星数
// 2. 中间 5 张街机立式关卡选关卡片流水线（状态：已三星 / 已通关 / 已解锁 / 锁定）
// 3. 点击卡片唤起战前简报弹窗 (Stage Briefing Dialog)：
//    展示战场环境警告、通关目标、通关秘籍、三星成就与首通奖励，一键出战。
// ============================================================
import {
  BlockInputEvents, Button, Color, Graphics, Label, Layers, Node,
  UITransform,
} from "cc";
import { CFG } from "../core/config";
import { CampaignManager, CourtTheme, StageDef } from "../core/campaign";
import { cancelFade, drawArcadeButton, drawHardShadow, drawVeil, fadeOutHide, slamIn, uiIconButton } from "./ui-arcade";
import type { UiKit } from "./ui-manager";

const PW = 880, PH = 480;
const CARD_W = 158, CARD_H = 265, CARD_GAP = 14;

const THEMES_ORDER: { court: CourtTheme; name: string; icon: string }[] = [
  { court: "beach", name: "阳光海滩", icon: "BEACH" },
  { court: "dojo", name: "竹林道场", icon: "DOJO" },
  { court: "cyber", name: "赛博街区", icon: "CYBER" },
  { court: "arena", name: "黄昏馆", icon: "ARENA" },
];

const COL = {
  panelBg: new Color(16, 16, 24, 235),
  cardBg: new Color(26, 26, 38, 220),
  cardLocked: new Color(18, 18, 26, 180),
  accent: new Color(255, 225, 77, 255),
  slash: new Color(230, 0, 18, 255),
  cyan: new Color(0, 240, 255, 255),
  good: new Color(125, 255, 158, 255),
  paper: new Color(245, 239, 225, 255),
  dim: new Color(159, 176, 216, 200),
  dimDark: new Color(90, 105, 138, 200),
  starGold: new Color(255, 225, 77, 255),
  starOff: new Color(100, 115, 145, 120),
  btnPrimary: new Color(230, 0, 18, 255),
  btnGhost: new Color(32, 32, 46, 230),
};

function mkNode(name: string, parent: Node, w: number, h: number): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setParent(parent);
  return n;
}

function mkLabel(
  parent: Node, name: string, text: string,
  size: number, color: Color = COL.paper,
  opts?: { x?: number; y?: number; w?: number; align?: number; lines?: number; outline?: Color; outlineW?: number },
): Label {
  const o = opts ?? {};
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(o.w ?? 200, size * 1.35 * (o.lines ?? 1));
  if (o.x !== undefined || o.y !== undefined) n.setPosition(o.x ?? 0, o.y ?? 0, 0);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.25);
  l.color = color;
  l.horizontalAlign = o.align ?? 1;
  l.verticalAlign = 1;
  if (o.outline) {
    l.enableOutline = true;
    l.outlineColor = o.outline;
    l.outlineWidth = o.outlineW ?? 2;
  }
  n.setParent(parent);
  return l;
}

function makeArcadeBtn(parent: Node, text: string, w: number, h: number, style: "primary" | "ghost" = "ghost"): Node {
  const n = mkNode("btn", parent, w, h);
  const g = n.addComponent(Graphics);
  drawHardShadow(g, w, h, 8, 3, 4, 0.4);
  drawArcadeButton(g, w, h, style, 8);
  mkLabel(n, "lbl", text, 15, COL.paper, { align: 1, w });
  const btn = n.addComponent(Button);
  btn.transition = Button.Transition.SCALE;
  btn.zoomScale = 0.94;
  btn.target = n;
  return n;
}

export class CampaignPanel {
  readonly root: Node;
  private kit: UiKit;
  private panelNode!: Node;
  private cardContainer!: Node;
  private currentCourt: CourtTheme = "beach";
  private tabButtons: { court: CourtTheme; node: Node; g: Graphics; lbl: Label }[] = [];
  private totalStarsLabel!: Label;
  /** 关完把上一屏(主菜单)交回来的归途 —— 见 show() 的注释 */
  private onClose: (() => void) | null = null;

  // 战前简报弹窗节点
  private briefDialog!: Node;
  private briefStage: StageDef | null = null;
  private briefTitle!: Label;
  private briefBadge!: Label;
  private briefDesc!: Label;
  private briefHint!: Label;
  private briefTarget!: Label;
  private briefReward!: Label;
  private briefStars: Label[] = [];

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    this.root = kit.root(parent, "campaign-panel");
    this.root.active = false;   // 此刻子树一个像素都没画过,关一下不丢渲染数据(画过之后再关才丢)
    this.build();
  }

  /**
   * 大厅是「浮在主菜单之上的一屏」,不挂在任何 Rules 状态上:进来时 openCampaign() 把菜单
   * 收走了,而状态自始至终都是 MENU —— onState 只在**变化沿**触发,所以菜单不会自己回来。
   * 归途只能由调用方给(onClose),和 openCareer / openDrills 同一个契约。
   */
  show(onClose?: () => void): void {
    if (onClose) this.onClose = onClose;
    cancelFade(this.root);
    this.root.active = true;
    this.refreshHeader();
    this.refreshCards();
    this.closeBriefing();
    slamIn(this.panelNode, 0);
  }

  /** 收起:只淡出、不 deactivate —— 原生(JSB)侧 Graphics 的渲染数据会在 onDisable 被清,
   *  重显时不自动重传,第二次进大厅就是一屏没有底块的空壳(见 ui-arcade.retainedDraw 顶部)。 */
  hide(): void {
    this.closeBriefing();     // 简报别留在身后:大厅重开时它要处于「已收起」态,否则放行回来的第一个按钮会是它的
    fadeOutHide(this.root);
  }

  /** ✕ / 返回:交回上一屏。没有归途(理论上不该发生)就自己收,至少留个能点的界面。 */
  private close(): void {
    this.kit.sfx.play("ui");
    if (this.onClose) this.onClose();
    else this.hide();
  }

  private build(): void {
    // 全屏遮罩与氛围层
    const veil = mkNode("veil", this.root, CFG.world.w, CFG.world.h);
    const vg = veil.addComponent(Graphics);
    drawVeil(vg, CFG.world.w, CFG.world.h, 0.25, 0.55);
    veil.addComponent(BlockInputEvents);

    // 主面板
    this.panelNode = mkNode("panel", this.root, PW, PH);
    const pg = this.panelNode.addComponent(Graphics);
    drawHardShadow(pg, PW, PH, 12, 10);
    pg.fillColor = COL.panelBg;
    pg.roundRect(-PW / 2, -PH / 2, PW, PH, 12);
    pg.fill();
    pg.strokeColor = new Color(255, 0, 36, 180);
    pg.lineWidth = 2;
    pg.roundRect(-PW / 2, -PH / 2, PW, PH, 12);
    pg.stroke();

    // 顶部标题栏
    const titleY = PH / 2 - 32;
    mkLabel(this.panelNode, "tag", "PVE CHALLENGE", 10, COL.slash, { x: -PW / 2 + 100, y: titleY + 14, align: 0 });
    mkLabel(this.panelNode, "title", "巅峰闯关模式", 24, COL.paper, { x: -PW / 2 + 100, y: titleY - 8, align: 0, outline: new Color(0, 0, 0, 200), outlineW: 2 });

    // 总星数徽章
    this.totalStarsLabel = mkLabel(this.panelNode, "starsTotal", "★ 0 / 60", 16, COL.starGold, { x: PW / 2 - 120, y: titleY, align: 2 });

    // 关闭按钮
    const closeBtn = uiIconButton(this.panelNode, "✕", { bg: "#6e2029", edge: "#ff8a8a", fontSize: 18, hit: 44, vis: 36 });
    closeBtn.setPosition(PW / 2 - 36, titleY, 0);
    closeBtn.on(Button.EventType.CLICK, () => this.close());

    // 场景 Tab 切换横栏 (4个场景)
    const tabY = PH / 2 - 76;
    const tabW = 180, tabH = 34, tabGap = 12;
    const totalTabW = 4 * tabW + 3 * tabGap;
    const tabStartX = -totalTabW / 2 + tabW / 2;

    THEMES_ORDER.forEach((th, i) => {
      const tx = tabStartX + i * (tabW + tabGap);
      const btnNode = mkNode(`tab:${th.court}`, this.panelNode, tabW, tabH);
      btnNode.setPosition(tx, tabY, 0);
      const bgGfx = btnNode.addComponent(Graphics);
      btnNode.addComponent(Button);

      const lbl = mkLabel(btnNode, "txt", th.name, 14, COL.paper, { x: 0, y: 0, align: 1 });

      btnNode.on(Button.EventType.CLICK, () => {
        this.kit.sfx.play("ui");
        this.currentCourt = th.court;
        this.refreshTabs();
        this.refreshCards();
      });

      this.tabButtons.push({ court: th.court, node: btnNode, g: bgGfx, lbl });
    });

    // 关卡卡片容器
    this.cardContainer = mkNode("cardContainer", this.panelNode, PW - 40, CARD_H + 20);
    this.cardContainer.setPosition(0, -32, 0);

    // 构建战前简报弹窗 (Briefing Dialog)
    this.buildBriefingDialog();

    this.refreshTabs();
  }

  private refreshHeader(): void {
    const totalStars = CampaignManager.getTotalStars();
    const cleared = CampaignManager.getClearedCount();
    this.totalStarsLabel.string = `★ ${totalStars} / 60  (已通关 ${cleared}/20)`;
  }

  private refreshTabs(): void {
    for (const t of this.tabButtons) {
      const isSel = t.court === this.currentCourt;
      t.g.clear();
      if (isSel) {
        t.g.fillColor = COL.slash;
        t.g.roundRect(-90, -17, 180, 34, 6);
        t.g.fill();
        t.lbl.color = COL.paper;
      } else {
        t.g.fillColor = new Color(26, 26, 38, 220);
        t.g.roundRect(-90, -17, 180, 34, 6);
        t.g.fill();
        t.g.strokeColor = new Color(120, 130, 160, 90);
        t.g.lineWidth = 1;
        t.g.roundRect(-90, -17, 180, 34, 6);
        t.g.stroke();
        t.lbl.color = COL.dim;
      }
    }
  }

  private refreshCards(): void {
    this.cardContainer.removeAllChildren();
    const stages = CampaignManager.getStagesByCourt(this.currentCourt);
    const totalW = stages.length * CARD_W + (stages.length - 1) * CARD_GAP;
    const startX = -totalW / 2 + CARD_W / 2;

    stages.forEach((stage, idx) => {
      const cx = startX + idx * (CARD_W + CARD_GAP);
      const isUnlocked = CampaignManager.isStageUnlocked(stage.stageNo);
      const rec = CampaignManager.getStageRec(stage.id);

      const card = mkNode(`card_${stage.id}`, this.cardContainer, CARD_W, CARD_H);
      card.setPosition(cx, 0, 0);

      const g = card.addComponent(Graphics);
      // 卡片底与立体阴影
      drawHardShadow(g, CARD_W, CARD_H, 10, 6);
      g.fillColor = isUnlocked ? COL.cardBg : COL.cardLocked;
      g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
      g.fill();

      // 边框 (已通关为暗金，已解锁未通关为红，锁定为冷灰)
      const strokeCol = isUnlocked ? (rec.stars > 0 ? COL.accent : COL.slash) : new Color(60, 65, 85, 100);
      g.strokeColor = strokeCol;
      g.lineWidth = isUnlocked ? 2 : 1;
      g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
      g.stroke();

      // 卡片内容
      const topY = CARD_H / 2 - 16;
      // 关卡编号
      mkLabel(card, "no", `STAGE ${stage.stageNo < 10 ? "0" + stage.stageNo : stage.stageNo}`, 11, isUnlocked ? COL.slash : COL.dimDark, {
        x: 0, y: topY, align: 1,
      });

      // 核心特色徽章胶囊
      const badgeY = topY - 26;
      g.fillColor = isUnlocked ? new Color(230, 0, 18, 45) : new Color(30, 30, 42, 100);
      g.roundRect(-CARD_W / 2 + 12, badgeY - 11, CARD_W - 24, 22, 11);
      g.fill();
      mkLabel(card, "badge", stage.badge, 11, isUnlocked ? COL.accent : COL.dimDark, {
        x: 0, y: badgeY, align: 1,
      });

      // 关卡名称
      mkLabel(card, "title", stage.title, 18, isUnlocked ? COL.paper : COL.dimDark, {
        x: 0, y: badgeY - 32, align: 1, outline: isUnlocked ? new Color(0, 0, 0, 220) : undefined, outlineW: 1.5,
      });
      mkLabel(card, "sub", stage.subtitle, 9, isUnlocked ? COL.dim : COL.dimDark, {
        x: 0, y: badgeY - 50, align: 1,
      });

      // 挑战目标标签
      const goalStr = stage.deathmatch ? "一球生死战" : `抢 ${stage.targetScore} 分`;
      mkLabel(card, "goal", goalStr, 13, isUnlocked ? COL.good : COL.dimDark, {
        x: 0, y: badgeY - 80, align: 1,
      });

      // 难度星级标识
      const diffStr = stage.aiDiff === "easy" ? "难度: 入门" : stage.aiDiff === "normal" ? "难度: 大师" : "难度: 巅峰";
      mkLabel(card, "diff", diffStr, 11, isUnlocked ? COL.dim : COL.dimDark, {
        x: 0, y: badgeY - 102, align: 1,
      });

      // 底部星级印章
      const starStr = rec.stars > 0
        ? "★".repeat(rec.stars) + "☆".repeat(Math.max(0, 3 - rec.stars))
        : (isUnlocked ? "☆  ☆  ☆" : "🔒 待解锁");
      const starCol = rec.stars > 0 ? COL.starGold : (isUnlocked ? COL.starOff : COL.dimDark);
      mkLabel(card, "stars", starStr, 15, starCol, {
        x: 0, y: -CARD_H / 2 + 24, align: 1,
      });

      if (isUnlocked) {
        card.addComponent(Button);
        card.on(Button.EventType.CLICK, () => {
          this.kit.sfx.play("ui");
          this.openBriefing(stage);
        });
      }
    });
  }

  // ---------- 战前简报弹窗 (Briefing Dialog) ----------
  private buildBriefingDialog(): void {
    const DW = 580, DH = 410;
    this.briefDialog = mkNode("briefDialog", this.panelNode, DW, DH);
    this.briefDialog.setPosition(0, 0, 0);
    this.briefDialog.active = false;

    // 半透明遮罩拦截
    const mask = mkNode("briefMask", this.briefDialog, PW, PH);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(0, 0, 0, 190);
    mg.rect(-PW / 2, -PH / 2, PW, PH);
    mg.fill();
    mask.addComponent(BlockInputEvents);

    // 弹窗本体底板
    const body = mkNode("briefBody", this.briefDialog, DW, DH);
    const bg = body.addComponent(Graphics);
    drawHardShadow(bg, DW, DH, 14, 12);
    bg.fillColor = new Color(20, 22, 34, 252);
    bg.roundRect(-DW / 2, -DH / 2, DW, DH, 12);
    bg.fill();
    bg.strokeColor = COL.slash;
    bg.lineWidth = 2.5;
    bg.roundRect(-DW / 2, -DH / 2, DW, DH, 12);
    bg.stroke();

    const topY = DH / 2 - 28;
    this.briefTitle = mkLabel(body, "bTitle", "关卡标题", 24, COL.paper, { x: 0, y: topY, align: 1, outline: new Color(0, 0, 0, 200), outlineW: 2 });
    this.briefBadge = mkLabel(body, "bBadge", "【特色机制】", 13, COL.accent, { x: 0, y: topY - 26, align: 1 });

    // 战场异变情境
    const descY = topY - 68;
    mkLabel(body, "lblDesc", "⚠️ 战场异变与挑战：", 13, COL.slash, { x: -DW / 2 + 30, y: descY, align: 0 });
    this.briefDesc = mkLabel(body, "bDesc", "情境说明", 13, COL.paper, { x: -DW / 2 + 30, y: descY - 24, align: 0, w: DW - 60, lines: 2 });

    // 通关秘籍
    const hintY = descY - 64;
    mkLabel(body, "lblHint", "💡 胜战秘籍：", 13, COL.good, { x: -DW / 2 + 30, y: hintY, align: 0 });
    this.briefHint = mkLabel(body, "bHint", "秘籍提示", 12, COL.dim, { x: -DW / 2 + 30, y: hintY - 20, align: 0, w: DW - 60, lines: 2 });

    // 目标与奖励
    const goalY = hintY - 54;
    this.briefTarget = mkLabel(body, "bTarget", "🎯 获胜目标：先达 3 分", 13, COL.paper, { x: -DW / 2 + 30, y: goalY, align: 0 });
    this.briefReward = mkLabel(body, "bReward", "💰 首通奖励：+200 金币 · +80 经验", 13, COL.accent, { x: DW / 2 - 30, y: goalY, align: 2 });

    // 三星成就
    const starY = goalY - 32;
    mkLabel(body, "lblStar", "★ 三星挑战：", 12, COL.starGold, { x: -DW / 2 + 30, y: starY, align: 0 });
    this.briefStars = [];
    for (let i = 0; i < 3; i++) {
      const sl = mkLabel(body, `bStar_${i}`, `★ 达成目标 ${i + 1}`, 11, COL.dim, { x: -DW / 2 + 110 + i * 155, y: starY, align: 0 });
      this.briefStars.push(sl);
    }

    // 底部双按钮 (立即开战 / 取消)
    const btnY = -DH / 2 + 38;
    const cancelBtn = makeArcadeBtn(body, "返回", 120, 44, "ghost");
    cancelBtn.setPosition(-90, btnY, 0);
    cancelBtn.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      this.closeBriefing();
    });

    const startBtn = makeArcadeBtn(body, "立即开战 ★", 180, 46, "primary");
    startBtn.setPosition(90, btnY, 0);
    startBtn.on(Button.EventType.CLICK, () => {
      const stage = this.briefStage;      // 先接住:hide() 会顺手 closeBriefing() 把 briefStage 清掉
      if (!stage) return;
      this.kit.sfx.play("ui");
      this.hide();
      this.kit.startCampaignStage(stage);
    });
  }

  private openBriefing(stage: StageDef): void {
    this.briefStage = stage;
    this.briefTitle.string = stage.title;
    this.briefBadge.string = `【 ${stage.badge} · ${stage.subtitle} 】`;
    this.briefDesc.string = stage.desc;
    this.briefHint.string = stage.hint;
    this.briefTarget.string = stage.deathmatch ? "🎯 获胜目标：一球生死决胜（丢1分即败，需净胜2分夺冠）" : `🎯 获胜目标：抢先赢得 ${stage.targetScore} 分`;
    this.briefReward.string = `💰 胜利奖励：+${stage.rewards.coins} 金币 · +${stage.rewards.exp} 经验`;

    stage.starsGoal.forEach((goal, i) => {
      if (this.briefStars[i]) this.briefStars[i].string = `★ ${goal}`;
    });

    // 弹窗本体同样「只淡出、不 deactivate」:它是画过一次再收的第二次子树,
    // 用 active=false 收起会让原生侧底块在第二次打开时整个隐身(只剩字)。
    // cancelFade 排在最前:把上一次退场时禁用的按钮/遮罩放行回来。
    cancelFade(this.briefDialog);
    this.briefDialog.active = true;
    slamIn(this.briefDialog, 0);
  }

  private closeBriefing(): void {
    fadeOutHide(this.briefDialog);
    this.briefStage = null;
  }
}
