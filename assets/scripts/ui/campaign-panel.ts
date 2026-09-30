// ============================================================
// 闯关挑战模式大厅面板 (Campaign Challenge Panel)
// 街机 / P5 暗红斩劈风 UI 布局：
// 1. 顶部四大场景 Tab（海滩、道场、赛博、黄昏馆）与全局总星数
// 2. 中间 5 张街机立式关卡选关卡片流水线（状态：已三星 / 已通关 / 已解锁 / 锁定）
// 3. 点击卡片唤起战前简报弹窗 (Stage Briefing Dialog)：
//    展示战场环境警告、通关目标、通关秘籍、三星成就与首通奖励，一键出战。
//    弹窗里**一个坐标都不手调** —— 折行、堆块、框高全由 ui/brief-layout.ts 算出来
//    (20 关文案长短差 3 倍,写死坐标必然溢出,见该文件顶部注释)。
// 4. 底部「继续闯关」直达条 + 「下一关」卡片印章:回大厅这一屏就知道点哪儿
//    (用户报的「通关了也没个下一关的按钮,回来对着五张卡发呆」)。
//
// ⚠ 触摸卫生:大厅是**常驻面板** —— hide 只淡出不 deactivate(原生侧 Graphics 的渲染
// 数据会被 onDisable 清掉),而 show() 的 cancelFade(this.root) 是把**整棵子树**的
// Button/BlockInputEvents 放行回来。所以面板里那层「收起来的简报弹窗」绝不能被误放行:
// 它的整屏遮罩会以 opacity 0 常驻在卡片之上,把每一笔触摸都吞掉(UIOpacity 不参与命中
// 判定,只有 active=false 才不吃,而这里恰恰不许 active=false)。这条规则由
// ui-arcade 的 fadeOutHide / cancelFade 成对兜住(见各自的 parkedInside)。
// ============================================================
import {
  BlockInputEvents, Button, Color, Graphics, Label, Layers, Node,
  UITransform,
} from "cc";
import { CFG } from "../core/config";
import { CampaignManager, CourtTheme, StageDef, StageRec } from "../core/campaign";
import { cancelFade, drawArcadeButton, drawHardShadow, drawVeil, fadeOutHide, retainedDraw, slamIn, textW, uiIconButton } from "./ui-arcade";
import { BRIEF, BRIEF_BTN, layoutBrief, type BriefButton, type BriefItem } from "./brief-layout";
import type { UiKit } from "./ui-manager";

const PW = 880, PH = 480;
const CARD_W = 158, CARD_H = 265, CARD_GAP = 14;
/** 底部直达条:高 48、中心 y=-202 —— 卡片底(-164)与面板下缘(-240)之间那条空带正好放它 */
const RESUME_W_MIN = 300, RESUME_W_MAX = 430, RESUME_H = 48, RESUME_Y = -PH / 2 + 38, RESUME_X0 = -PW / 2 + 36;

const THEMES_ORDER: { court: CourtTheme; name: string; icon: string }[] = [
  { court: "beach", name: "阳光海滩", icon: "BEACH" },
  { court: "dojo", name: "竹林道场", icon: "DOJO" },
  { court: "cyber", name: "赛博街区", icon: "CYBER" },
  { court: "arena", name: "黄昏馆", icon: "ARENA" },
];

/** 难度文案与主菜单/无限模式同一套产品命名(同一个 DiffKey 全应用只叫一个名) */
const CN_DIFF: Record<string, string> = { easy: "入门", normal: "普通", hard: "大师" };

const COL = {
  panelBg: new Color(16, 16, 24, 235),
  cardBg: new Color(26, 26, 38, 220),
  cardLocked: new Color(18, 18, 26, 180),
  accent: new Color(255, 225, 77, 255),
  slash: new Color(230, 0, 18, 255),
  cyan: new Color(0, 240, 255, 255),
  good: new Color(125, 255, 158, 255),
  paper: new Color(245, 239, 225, 255),
  ink: new Color(7, 7, 13, 255),
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
  opts?: { x?: number; y?: number; w?: number; align?: number; lines?: number; lineH?: number; outline?: Color; outlineW?: number },
): Label {
  const o = opts ?? {};
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  const ut = n.addComponent(UITransform);
  ut.setContentSize(o.w ?? 200, (o.lineH ?? size * 1.35) * (o.lines ?? 1));
  // 锚点必须跟着对齐走:左对齐用左锚点(x 就是文本左缘)、右对齐用右锚点。
  // 一律留默认的中心锚点 = 文本框朝 x 左边再伸半个框宽,长文案整段推出边框
  // (战前简报翻车的那张图就是这么来的:说明糊到弹窗外、三条三星目标互相重叠)。
  ut.setAnchorPoint(o.align === 0 ? 0 : o.align === 2 ? 1 : 0.5, 0.5);
  if (o.x !== undefined || o.y !== undefined) n.setPosition(o.x ?? 0, o.y ?? 0, 0);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = Math.round(o.lineH ?? size * 1.25);
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

/** 关卡目标一句话:一球生死战 / 抢 N 分(卡片与直达条共用) */
function goalOf(stage: StageDef): string {
  return stage.deathmatch ? "一球生死战" : `抢 ${stage.targetScore} 分`;
}

/**
 * 简报每一块的长相 —— 几何由 brief-layout 算,这里只配颜色/对齐。
 * 没列进来的 key(chip*)一律走 BRIEF_CHIP_COL 左对齐。
 */
const BRIEF_STYLE: Record<string, { col: Color; center?: boolean; outline?: boolean }> = {
  title:    { col: COL.paper, center: true, outline: true },
  badge:    { col: COL.accent, center: true },
  descHead: { col: COL.slash },
  desc:     { col: COL.paper },
  hintHead: { col: COL.good },
  hint:     { col: new Color(206, 216, 236, 235) },
  target:   { col: COL.paper },
  reward:   { col: COL.accent },
  starHead: { col: COL.starGold },
};
const BRIEF_CHIP_COL = new Color(196, 208, 232, 230);

export class CampaignPanel {
  readonly root: Node;
  private kit: UiKit;
  private panelNode!: Node;
  private cardContainer!: Node;
  private currentCourt: CourtTheme = "beach";
  private tabButtons: { court: CourtTheme; node: Node; g: Graphics; lbl: Label }[] = [];
  private totalStarsLabel!: Label;
  /** 底部直达条:底板宽度跟着文案走,所以每次刷新都要 clear + 重画一次底 */
  private resumeNode!: Node;
  private resumeGfx!: Graphics;
  private resumeLbl!: Label;
  private resumeHint!: Label;
  /** 关完把上一屏(主菜单)交回来的归途 —— 见 show() 的注释 */
  private onClose: (() => void) | null = null;

  // 战前简报弹窗:节点按 key 复用,每开一关重新排一遍(框高、行位置都随文案变)
  private briefDialog!: Node;
  private briefBody!: Node;
  private briefBodyGfx!: Graphics;
  private briefH: number = BRIEF.minDialogH;
  private briefStage: StageDef | null = null;
  private briefLabels = new Map<string, Label>();
  private briefBtnNodes = new Map<string, Node>();

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
    // 落回「下一关所在的那个场景」:这一屏要回答的是「我打到哪儿了」,
    // 而不是记住上次随手翻到过第几章。
    const next = CampaignManager.getNextStage();
    if (next) this.currentCourt = next.court;
    this.refreshTabs();
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

    // 顶部标题栏(左缘留 36 内边距:标签是左锚点,x 就是文字起笔处)
    const titleY = PH / 2 - 32;
    mkLabel(this.panelNode, "tag", "PVE CHALLENGE", 10, COL.slash, { x: -PW / 2 + 36, y: titleY + 14, align: 0 });
    mkLabel(this.panelNode, "title", "巅峰闯关模式", 24, COL.paper, { x: -PW / 2 + 36, y: titleY - 8, align: 0, outline: new Color(0, 0, 0, 200), outlineW: 2 });

    // 总星数徽章(右锚点:x 就是文字收尾处,给 ✕ 让开命中区)
    this.totalStarsLabel = mkLabel(this.panelNode, "starsTotal", "★ 0 / 60", 16, COL.starGold, { x: PW / 2 - 72, y: titleY, align: 2 });

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

    // 底部「继续闯关」直达条(排在简报之前:弹窗的遮罩要盖得住它)
    this.buildResumeBar();

    // 构建战前简报弹窗 (Briefing Dialog)
    this.buildBriefingDialog();

    this.refreshTabs();
    this.refreshHeader();
  }

  // ---------- 底部「继续闯关」直达条 ----------

  private buildResumeBar(): void {
    const n = mkNode("resume", this.panelNode, RESUME_W_MIN, RESUME_H);
    n.setPosition(RESUME_X0 + RESUME_W_MIN / 2, RESUME_Y, 0);
    this.resumeNode = n;
    this.resumeGfx = n.addComponent(Graphics);
    this.resumeLbl = mkLabel(n, "lbl", "继续闯关", 17, COL.paper, { align: 1, w: RESUME_W_MAX, outline: new Color(0, 0, 0, 200), outlineW: 1 });
    const b = n.addComponent(Button);
    b.transition = Button.Transition.SCALE;
    b.zoomScale = 0.96;
    b.target = n;
    n.on(Button.EventType.CLICK, () => {
      // 通关全部 20 关后没有「下一关」,这颗钮退化成「从头再冲三星」,所以它永远有的可点
      const target = CampaignManager.getNextStage() ?? CampaignManager.getStageByNo(1);
      if (!target) return;
      this.kit.sfx.play("ui");
      this.currentCourt = target.court;
      this.refreshTabs();
      this.refreshCards();
      this.openBriefing(target);      // 只到简报:关卡机制说明还得看一眼再出战
    });

    // 提示行按左锚点排,最宽一句(「热带沙尘暴」那关)实测 419 → 框给到 430 才不虚报宽度
    this.resumeHint = mkLabel(this.panelNode, "resumeHint", "", 12, COL.dim, { x: RESUME_X0 + RESUME_W_MIN + 20, y: RESUME_Y, align: 0, w: 430 });
  }

  /** 底块跟着文案走:每次 clear + 重画(保留型画布唯一安全的改法) */
  private paintResume(w: number): void {
    const g = this.resumeGfx;
    g.clear();
    drawHardShadow(g, w, RESUME_H, 10, 4, 4, 0.45);
    drawArcadeButton(g, w, RESUME_H, "primary", 10);
    // 命中区必须跟着底块长:Button 吃的是 UITransform 的 contentSize,
    // 底块画到 372 而盒子还停在 300,两侧各 36px 就是「看得见点不着」的边翼。
    this.resumeNode.getComponent(UITransform)!.setContentSize(w, RESUME_H);
    this.resumeNode.setPosition(RESUME_X0 + w / 2, RESUME_Y, 0);
    this.resumeHint.node.setPosition(RESUME_X0 + w + 20, RESUME_Y, 0);
  }

  private refreshHeader(): void {
    const stages = CampaignManager.getStages();
    const totalStars = CampaignManager.getTotalStars();
    const cleared = CampaignManager.getClearedCount();
    this.totalStarsLabel.string = `★ ${totalStars} / ${stages.length * 3} · 已通关 ${cleared}/${stages.length}`;

    const next = CampaignManager.getNextStage();
    const label = next ? `继续闯关 · 第 ${next.stageNo} 关「${next.title}」` : "全部通关 · 重玩第 1 关";
    this.paintResume(Math.min(RESUME_W_MAX, Math.max(RESUME_W_MIN, textW(label, 17) + 66)));
    this.resumeLbl.string = label;
    this.resumeHint.string = next
      ? `【${next.badge}】${goalOf(next)} · 难度 ${CN_DIFF[next.aiDiff]} · 首通 +${next.rewards.coins} 金币 +${next.rewards.exp} 经验`
      : "20 道场景挑战已全部拿下,挑一关再冲三星";
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
    const next = CampaignManager.getNextStage();
    const totalW = stages.length * CARD_W + (stages.length - 1) * CARD_GAP;
    const startX = -totalW / 2 + CARD_W / 2;

    stages.forEach((stage, idx) => {
      const cx = startX + idx * (CARD_W + CARD_GAP);
      const isUnlocked = CampaignManager.isStageUnlocked(stage.stageNo);
      const rec = CampaignManager.getStageRec(stage.id);
      const isNext = !!next && next.id === stage.id;

      const card = mkNode(`card_${stage.id}`, this.cardContainer, CARD_W, CARD_H);
      card.setPosition(cx, 0, 0);

      const g = card.addComponent(Graphics);
      // 卡片底与立体阴影
      drawHardShadow(g, CARD_W, CARD_H, 10, 6);
      g.fillColor = isUnlocked ? COL.cardBg : COL.cardLocked;
      g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
      g.fill();

      // 边框:下一关=加粗荧光黄(整屏唯一的目标),已通关=暗金,已解锁未通关=红,锁定=冷灰
      const strokeCol = isNext ? COL.accent
        : isUnlocked ? (rec.stars > 0 ? COL.accent : COL.slash)
          : new Color(60, 65, 85, 100);
      g.strokeColor = strokeCol;
      g.lineWidth = isNext ? 3 : isUnlocked ? 2 : 1;
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
      mkLabel(card, "goal", goalOf(stage), 13, isUnlocked ? COL.good : COL.dimDark, {
        x: 0, y: badgeY - 80, align: 1,
      });

      // 难度星级标识
      mkLabel(card, "diff", `难度: ${CN_DIFF[stage.aiDiff] ?? stage.aiDiff}`, 11, isUnlocked ? COL.dim : COL.dimDark, {
        x: 0, y: badgeY - 102, align: 1,
      });

      // 中段状态胶囊:这一大片原来全是空的,正好用来回答「这关我打过没 / 该打哪一关」
      if (isUnlocked) this.paintCardState(g, card, rec, isNext);

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

  /** 卡片中段的三态胶囊:下一关(荧光黄底墨字) / 已通关(最佳比分) / 可挑战 */
  private paintCardState(g: Graphics, card: Node, rec: StageRec, isNext: boolean): void {
    const y = -52;
    if (isNext) {
      g.fillColor = COL.accent;
      g.roundRect(-CARD_W / 2 + 20, y - 13, CARD_W - 40, 26, 13);
      g.fill();
      mkLabel(card, "state", "▶ 下一关", 13, COL.ink, { x: 0, y, align: 1 });
      return;
    }
    if (rec.clears > 0) {
      g.fillColor = new Color(255, 225, 77, 34);
      g.roundRect(-CARD_W / 2 + 16, y - 12, CARD_W - 32, 24, 12);
      g.fill();
      mkLabel(card, "state", `最佳 ${rec.bestScore}`, 12, COL.accent, { x: 0, y, align: 1 });
      return;
    }
    g.fillColor = new Color(120, 130, 160, 34);
    g.roundRect(-CARD_W / 2 + 30, y - 12, CARD_W - 60, 24, 12);
    g.fill();
    mkLabel(card, "state", "可挑战", 12, COL.dim, { x: 0, y, align: 1 });
  }

  // ---------- 战前简报弹窗 (Briefing Dialog) ----------
  // 这里只负责「建节点 + 照排版摆」:折行、块间距、框高一律问 brief-layout。
  private buildBriefingDialog(): void {
    const DW = BRIEF.dialogW;
    this.briefDialog = mkNode("briefDialog", this.panelNode, DW, this.briefH);
    this.briefDialog.setPosition(0, 0, 0);
    this.briefDialog.active = false;

    // 半透明遮罩拦截
    const mask = mkNode("briefMask", this.briefDialog, PW, PH);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(0, 0, 0, 190);
    mg.rect(-PW / 2, -PH / 2, PW, PH);
    mg.fill();
    mask.addComponent(BlockInputEvents);

    // 弹窗本体底板:高度是算出来的、每开一关都可能变 → 画法登记成可重放(retainedDraw),
    // 换高度时 clear + 重画一次即可(原生侧 Graphics 在 onDisable 会丢渲染数据,别裸 active)。
    const body = mkNode("briefBody", this.briefDialog, DW, this.briefH);
    this.briefBody = body;
    const bg = body.addComponent(Graphics);
    this.briefBodyGfx = bg;
    retainedDraw(bg, () => this.paintBriefBody());
  }

  private paintBriefBody(): void {
    const g = this.briefBodyGfx;
    const w = BRIEF.dialogW, h = this.briefH;
    drawHardShadow(g, w, h, 14, 12);
    g.fillColor = new Color(20, 22, 34, 252);
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.fill();
    g.strokeColor = COL.slash;
    g.lineWidth = 2.5;
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.stroke();
  }

  /** 一块文字:节点按 key 建一次就长期复用,排版给什么左缘/中心就摆什么 */
  private applyBriefItem(it: BriefItem): void {
    let lbl = this.briefLabels.get(it.key);
    if (!lbl) {
      const st = BRIEF_STYLE[it.key];
      lbl = mkLabel(this.briefBody, `b:${it.key}`, "", it.size, st ? st.col : BRIEF_CHIP_COL, {
        align: st && st.center ? 1 : 0,
        outline: st && st.outline ? new Color(0, 0, 0, 200) : undefined,
        outlineW: 2,
      });
      this.briefLabels.set(it.key, lbl);
    }
    lbl.lineHeight = it.lineH;
    lbl.string = it.lines.join("\n");                  // 已折好:引擎只管画,不会再自己换行
    lbl.node.setPosition(it.left, it.cy, 0);           // 左锚点 → left 就是文字起笔的 x
  }

  /** 底部双按钮:文案是常量,所以宽只在第一次建时按量出来的尺寸定 */
  private applyBriefButton(b: BriefButton): void {
    let n = this.briefBtnNodes.get(b.key);
    if (!n) {
      n = makeArcadeBtn(this.briefBody, b.text, b.w, b.h, b.key === "start" ? "primary" : "ghost");
      if (b.key === "cancel") {
        n.on(Button.EventType.CLICK, () => {
          this.kit.sfx.play("ui");
          this.closeBriefing();
        });
      } else {
        n.on(Button.EventType.CLICK, () => {
          const stage = this.briefStage;      // 先接住:hide() 会顺手 closeBriefing() 把 briefStage 清掉
          if (!stage) return;
          this.kit.sfx.play("ui");
          this.hide();
          this.kit.startCampaignStage(stage);
        });
      }
      this.briefBtnNodes.set(b.key, n);
    }
    n.setPosition(b.cx, b.cy, 0);
  }

  private openBriefing(stage: StageDef): void {
    this.briefStage = stage;

    const L = layoutBrief(stage);
    this.briefH = L.dialogH;
    this.briefBodyGfx.clear();
    this.paintBriefBody();
    this.briefDialog.getComponent(UITransform)!.setContentSize(L.dialogW, L.dialogH);
    for (const it of L.items) this.applyBriefItem(it);
    for (const b of L.buttons) this.applyBriefButton(b);

    // 打过的关卡不该再喊「立即开战」:两颗钮文案对调成「再次挑战」。
    // 两句都是 4 汉字 + " ★",量出来的按钮宽度一致,底块不用重画(见 brief-layout)。
    const startLbl = this.briefBtnNodes.get("start")?.getChildByName("lbl")?.getComponent(Label);
    if (startLbl) {
      startLbl.string = CampaignManager.getStageRec(stage.id).clears > 0 ? "再次挑战 ★" : BRIEF_BTN.start;
    }

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
