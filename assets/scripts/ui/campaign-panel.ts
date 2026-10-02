// ============================================================
// 闯关挑战模式大厅面板 (Campaign Challenge Panel) —— P5 大色块语法
// 1. 顶部标题行(kicker + 中文标题 + 总星数 + 技能胶囊 + ✕)与四大场景 Tab
// 2. 中间 5 张关卡卡片:墨面 + 顶部一条 accent 色带 + 同色 keyline(p5-shapes.cardDL)。
//    **卡片绝不整面实底** —— 出图实测:五张卡各整面红/黄/青/纸白会排成五色彩虹,
//    而 P5 是红黑白主导 + 点缀;大色块只留给底部「继续闯关」那一条与选中的 tab。
//    三态用色(色即功能,一律查 p5-tokens.ROLE):已通关=record 纸白 / 可挑战=info 青 /
//    下一关=star 荧光黄且 glow / 锁定=locked(墨面压到 navy、色带退成 line)。
// 3. 点击卡片唤起战前简报弹窗 (Stage Briefing Dialog):
//    弹窗里**一个坐标都不手调** —— 折行、堆块、框高全由 ui/brief-layout.ts 算出来
//    (20 关文案长短差 3 倍,写死坐标必然溢出,见该文件顶部注释)。底板走 L1 衬纸。
// 4. 底部「继续闯关」直达条(斩劈红实底大色块)+ 「下一关」卡片印章:回大厅这一屏
//    就知道点哪儿(用户报的「通关了也没个下一关的按钮,回来对着五张卡发呆」)。
// 5. 标题行右侧的技能胶囊:闯关吃的是全局装备那一款,原来大厅里没有入口,
//    想换技能只能退回首页→进对练屏改完再回来(用户:「闯关和无限练习也要有技能选择」)。
//
// 版面算术全在 ./campaign-layout.ts(零 cc 纯函数):tab 行与卡行**都恰好铺满内容列**
// (193×4+12×3 = 152×5+12×4 = 808 = ±404),卡内八行、直达条与其右侧提示行的宽度
// 余量都在那儿算,判据是 campaignOverlaps() / campaignOverflow()。面板只照坐标摆。
//
// 星级与锁一律 Graphics(drawStarGlyph / drawRankBadge),不是 ★☆🔒 文本 ——
// 原生 Android 没有彩色 emoji 字体,🔒 在真机上要么方框要么缺字(本仓库 makeCoinIcon
// 的注释就是为此而生)。总星数那串保留 ★:它是 BMP 文本字形,MiSans 子集里有,真机实拍过。
//
// ⚠ 触摸卫生:大厅是**常驻面板** —— hide 只淡出不 deactivate(原生侧 Graphics 的渲染
// 数据会被 onDisable 清掉),而 show() 的 cancelFade(this.root) 是把**整棵子树**的
// Button/BlockInputEvents 放行回来。所以面板里那层「收起来的简报弹窗」绝不能被误放行:
// 它的整屏遮罩会以 opacity 0 常驻在卡片之上,把每一笔触摸都吞掉(UIOpacity 不参与命中
// 判定,只有 active=false 才不吃,而这里恰恰不许 active=false)。这条规则由
// ui-arcade 的 fadeOutHide / cancelFade 成对兜住(见各自的 parkedInside)。
// 同理:一次画完不再 clear 重画的底块(卡片、简报遮罩)一律走 retainedDraw;
// 每次 clear + 重画的(tab 的 paint / 直达条 / 技能胶囊)天然安全。
// ============================================================
import { BlockInputEvents, Button, Color, Graphics, Label, Node, UITransform } from "cc";
import { CampaignManager, CourtTheme, StageDef, StageRec } from "../core/campaign";
import { Career } from "../core/career";
import { Skills } from "../core/skills";
import {
  ARCADE as C, ROLE, SLANT, ac, cancelFade, drawBevelSlot, drawP5Block, drawP5Card,
  drawPosterPlate, drawRankBadge, drawSectionBand, drawStarGlyph, fadeOutHide, inkFor,
  mkLabel as uiMkLabel, retainedDraw, slamIn, uiIconButton, type Role,
} from "./ui-arcade";
import { faceOf, pressable, repaint, solidBlock, solidTab, uinode, type TabHandle } from "./ui-shell";
import {
  BRIEF, BRIEF_BTN, layoutBrief, type BriefButton, type BriefItem,
} from "./brief-layout";
import {
  CMP, HEADER_TEXT, LOCK_TEXT, SKILL_GO_TEXT, SKILL_TAG_TEXT,
  cardRow, cardRows, headerBoxes, lockRow, resumeRow, skillChip, starRow, tabRow, type Box,
} from "./campaign-layout";
import type { UiKit } from "./ui-manager";

const PW = CMP.pw, PH = CMP.ph;

const THEMES_ORDER: { court: CourtTheme; name: string; icon: string }[] = [
  { court: "beach", name: "阳光海滩", icon: "BEACH" },
  { court: "dojo", name: "竹林道场", icon: "DOJO" },
  { court: "cyber", name: "赛博街区", icon: "CYBER" },
  { court: "arena", name: "黄昏馆", icon: "ARENA" },
];

/** 难度文案与主菜单/无限模式同一套产品命名(同一个 DiffKey 全应用只叫一个名) */
const CN_DIFF: Record<string, string> = { easy: "入门", normal: "普通", hard: "大师" };

/**
 * 简报每一块的长相 —— 几何由 brief-layout 算,这里只配颜色/对齐(颜色一律取自令牌表)。
 * 没列进来的 key(chip*)一律走 BRIEF_CHIP_COL 左对齐。
 */
const BRIEF_STYLE: Record<string, { col: Color; center?: boolean; outline?: boolean }> = {
  title: { col: ac(C.paper), center: true, outline: true },
  badge: { col: ac(C.acid), center: true },
  descHead: { col: ac(C.slash) },
  desc: { col: ac(C.paper) },
  hintHead: { col: ac(C.good) },
  hint: { col: ac(C.paperDim) },
  target: { col: ac(C.paper) },
  reward: { col: ac(C.acid) },
  starHead: { col: ac(C.acid) },
};
const BRIEF_CHIP_COL = ac(C.paperDim, 0.92);

/** 关卡目标一句话:一球生死战 / 抢 N 分(卡片与直达条共用) */
function goalOf(stage: StageDef): string {
  return stage.deathmatch ? "一球生死战" : `抢 ${stage.targetScore} 分`;
}

/**
 * 卡片该用哪个角色色 —— 色即功能,不在面板里写 hex。
 * 未解锁走 off(卡面整体压暗),下一关走 star 且发光,打过走 record(纸白档案),
 * 能打没打走 info(青,说明性)。
 */
function cardRole(unlocked: boolean, isNext: boolean, rec: StageRec): Role {
  if (!unlocked) return "off";
  if (isNext) return "star";
  return rec.clears > 0 ? "record" : "info";
}

/**
 * 把一个 Label 摆进 campaign-layout 给的格子。
 * contentSize 必须设:Label 不设它会被忽略,长文案整条推出卡片(战前简报糊出弹窗
 * 的根因就是这条),左对齐还要按左缘摆而不是盒心 —— 中心摆会往反方向伸半个框宽。
 */
function place(l: Label, b: Box, align: 0 | 1 | 2 = 1): void {
  const w = b.right - b.left;
  l.node.getComponent(UITransform)!.setContentSize(w, b.h);
  l.overflow = Label.Overflow.CLAMP;
  l.node.setPosition(align === 0 ? b.left : align === 2 ? b.right : b.left + w / 2, b.cy, 0);
}

function mkLabel(
  parent: Node, name: string, text: string,
  size: number, color: string | Color = C.paper,
  opts?: { x?: number; y?: number; w?: number; align?: number; lines?: number; lineH?: number; outline?: Color; outlineW?: number },
): Label {
  const o = opts ?? {};
  // 委托 ui-arcade 的权威 mkLabel;本厂的「锚点跟对齐走」就是权威语义的出处。
  return uiMkLabel(parent, name, text, size, color, {
    x: o.x, y: o.y, w: o.w, lines: o.lines,
    lineH: o.lineH !== undefined ? Math.round(o.lineH) : undefined,
    contentH: (o.lineH ?? size * 1.35) * (o.lines ?? 1),
    align: (o.align ?? 1) as 0 | 1 | 2,
    anchor: "align",
    outline: o.outline, outlineW: o.outlineW,
  });
}

export class CampaignPanel {
  readonly root: Node;
  private kit: UiKit;
  private panelNode!: Node;
  private cardContainer!: Node;
  private currentCourt: CourtTheme = "beach";
  /** tab 四格:solidTab 句柄 + 与 THEMES_ORDER 同序的角色键(工厂只管画) */
  private tabs: TabHandle[] = [];
  private tabKeys: CourtTheme[] = [];
  private totalStarsLabel!: Label;
  /** 底部直达条:底板宽度跟着文案走,所以每次刷新都要 clear + 重画一次底 */
  private resumeNode!: Node;
  private resumeGfx!: Graphics;
  private resumeLbl!: Label;
  private resumeHint!: Label;
  /** 头部技能胶囊:整块可点弹技能选择;底块宽跟着技能名走,所以三块文字都要留引用 */
  private skillChipNode!: Node;
  private skillChipGfx!: Graphics;
  private skillAccent!: Node;
  private skillAccentGfx!: Graphics;
  private skillChipTag!: Label;
  private skillChipName!: Label;
  private skillChipGo!: Label;
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
  private briefStartLabel: Label | null = null;

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
    // 全屏暗底 + BlockInputEvents:与设置页同一个工厂。
    // bands:false —— 这一屏的主角是衬纸本身,暗底再叠两道红带就把球场糊没了。
    this.kit.dim(this.root, 0.25, 0.55, { bands: false });

    // L1 衬纸:一张撕下来的黑纸垫在斩劈红纸上(旧写法是 navy 圆角矩形 + 三层 roundRect 描边)。
    // 这一层不需要 retainedDraw:hide 走 fadeOutHide、整树从不 deactivate。
    const plate = this.kit.panel(this.root, PW, PH, {
      bandHex: ROLE.primary.face, tear: 20, halftone: true,
    });
    this.panelNode = plate.node;

    // 顶部标题栏(左缘贴内容列 colX:标签是左锚点,x 就是文字起笔处)
    const H = headerBoxes("", "");
    place(mkLabel(this.panelNode, "tag", HEADER_TEXT.tag, CMP.tag.size, ac(C.slash), { align: 0 }), H.tag, 0);
    place(mkLabel(this.panelNode, "title", HEADER_TEXT.title, CMP.title.size, ac(C.paper), {
      align: 0, outline: ac(C.ink, 0.78), outlineW: 2,
    }), H.title, 0);

    // 总星数徽章(右锚点:x 就是文字收尾处,给 ✕ 让开命中区)
    this.totalStarsLabel = mkLabel(this.panelNode, "starsTotal", "", CMP.stars.size, ac(C.acid), { align: 2 });

    // 关闭按钮:小面大键(命中 44、视觉 36),颜色取自 primary 角色的厚底边与提亮边
    const closeBtn = uiIconButton(this.panelNode, "✕", {
      bg: ROLE.primary.dk, edge: ROLE.primary.edge, fontSize: 18, hit: CMP.close.hit, vis: CMP.close.vis,
    });
    closeBtn.setPosition(CMP.close.x, CMP.close.cy, 0);
    closeBtn.on(Button.EventType.CLICK, () => this.close());

    // 技能胶囊(标题行右侧):闯关吃的就是全局装备那一款,大厅里得能直接换
    this.buildSkillChip();

    // 场景 Tab:四格 solidTab(选中=斩劈红实底 + 撕纸齿,未选=凹陷槽),高 = 触控下限
    this.buildTabs();

    // 关卡卡片容器(与 tab 行共用同一对内容列边线)
    this.cardContainer = uinode("cardContainer", this.panelNode, CMP.right - CMP.colX, CMP.card.h);

    // 底部「继续闯关」直达条(排在简报之前:弹窗的遮罩要盖得住它)
    this.buildResumeBar();

    // 构建战前简报弹窗 (Briefing Dialog)
    this.buildBriefingDialog();

    this.refreshTabs();
    this.refreshHeader();
  }

  // ---------- 场景 tab ----------

  private buildTabs(): void {
    const boxes = tabRow(THEMES_ORDER.length);
    this.tabs = THEMES_ORDER.map((th, i) => {
      const b = boxes[i];
      const t = solidTab({
        name: `tab:${th.court}`, parent: this.panelNode, label: th.name,
        w: b.right - b.left, h: b.h, role: "primary", size: CMP.tab.size, tear: true,
      });
      t.node.setPosition(b.left + (b.right - b.left) / 2, b.cy, 0);
      this.tabKeys.push(th.court);
      t.node.on(Button.EventType.CLICK, () => {
        if (this.currentCourt === th.court) return;
        this.kit.sfx.play("ui");
        this.currentCourt = th.court;
        this.refreshTabs();
        this.refreshCards();
      });
      return t;
    });
  }

  private refreshTabs(): void {
    // 每次 clear + 重画(solidTab.paint),天然免疫「deactivate 掉渲染数据」那条坑
    this.tabs.forEach((t, i) => t.paint(this.tabKeys[i] === this.currentCourt));
  }

  // ---------- 底部「继续闯关」直达条 ----------

  private buildResumeBar(): void {
    const R = resumeRow("", "");
    // 大色块留给这一条:整面斩劈红 + 纸白字,是这一屏唯一占满整面的亮色
    const n = solidBlock("resume", this.panelNode, R.bar.right - R.bar.left, R.bar.h, ROLE.primary.face, SLANT.block);
    this.resumeNode = n;
    this.resumeGfx = n.getComponent(Graphics)!;
    n.setPosition(R.bar.left + (R.bar.right - R.bar.left) / 2, R.bar.cy, 0);
    this.resumeLbl = mkLabel(n, "lbl", "继续闯关", CMP.resume.size, inkFor(ROLE.primary.face), { align: 1, w: CMP.resume.wMax });
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

    // 提示行:左锚 + 宽度由 resumeRow 现算(条子变宽就把它的可用宽度一起挤掉)
    this.resumeHint = mkLabel(this.panelNode, "resumeHint", "", CMP.resume.hintSize, ac(C.dim), { align: 0, w: R.hint.right - R.hint.left });
  }

  /** 底块跟着文案走:每次 clear + 重画,命中区必须同步改成同一个数 */
  private paintResume(label: string, hint: string): void {
    const R = resumeRow(label, hint);
    const w = R.bar.right - R.bar.left;
    repaint(this.resumeGfx, () => drawP5Block(this.resumeGfx, w, R.bar.h, ROLE.primary.face, SLANT.block));
    // 命中区必须跟着底块长:Button 吃的是 UITransform 的 contentSize,
    // 底块画到 372 而盒子还停在 300,两侧各 36px 就是「看得见点不着」的边翼。
    this.resumeNode.getComponent(UITransform)!.setContentSize(w, R.bar.h);
    this.resumeNode.setPosition(R.bar.left + w / 2, R.bar.cy, 0);
    this.resumeLbl.string = label;
    place(this.resumeHint, R.hint, 0);
  }

  // ---------- 头部技能胶囊 ----------

  private buildSkillChip(): void {
    const S = skillChip("");
    const n = uinode("skillChip", this.panelNode, S.w, CMP.skill.hit);
    this.skillChipNode = n;
    this.skillChipGfx = n.addComponent(Graphics);
    n.setPosition(CMP.skill.right - S.w / 2, CMP.skill.cy, 0);
    // 色签:技能自己的主题色只占左侧一小条,整面留给凹陷槽(标题行是读字的)
    this.skillAccent = uinode("accent", n, 8, CMP.skill.h - 14);
    this.skillAccentGfx = this.skillAccent.addComponent(Graphics);
    this.skillChipTag = mkLabel(n, "tag", SKILL_TAG_TEXT, CMP.skill.tagSize, ac(C.dim), { align: 0 });
    this.skillChipName = mkLabel(n, "name", "", CMP.skill.nameSize, ac(C.paper), { align: 0 });
    this.skillChipGo = mkLabel(n, "go", SKILL_GO_TEXT, CMP.skill.goSize, ac(C.dimDeep), { align: 0 });
    pressable(n, 0.95);
    n.on(Button.EventType.CLICK, () => {
      this.kit.sfx.play("ui");
      this.kit.openSkillDialog(() => this.paintSkillChip());
    });
  }

  /** 宽随技能名走:每次 clear + 重画,三块文字按 campaign-layout 量出来的格子倒推 */
  private paintSkillChip(): void {
    const def = Skills.defOf(Career.equippedSkill());
    const S = skillChip(def.name);
    repaint(this.skillChipGfx, () => {
      // 凹陷槽当胶囊底(与未选中的 tab 同一画法),不占亮面
      drawBevelSlot(this.skillChipGfx, S.w, CMP.skill.h, SLANT.block);
    });
    repaint(this.skillAccentGfx, () => {
      drawSectionBand(this.skillAccentGfx, 8, CMP.skill.h - 14, def.accent);
    });
    this.skillChipNode.getComponent(UITransform)!.setContentSize(S.w, CMP.skill.hit);
    this.skillChipNode.setPosition(CMP.skill.right - S.w / 2, CMP.skill.cy, 0);
    this.skillAccent.setPosition(-S.w / 2 + 9, 0, 0);
    place(this.skillChipTag, S.tag, 0);
    place(this.skillChipName, S.name, 0);
    place(this.skillChipGo, S.go, 0);
    this.skillChipName.string = def.name;
    this.skillChipName.color = ac(def.accent);
  }

  private refreshHeader(): void {
    const stages = CampaignManager.getStages();
    const totalStars = CampaignManager.getTotalStars();
    const cleared = CampaignManager.getClearedCount();
    const starsText = `★ ${totalStars} / ${stages.length * 3} · 已通关 ${cleared}/${stages.length}`;
    this.totalStarsLabel.string = starsText;

    const next = CampaignManager.getNextStage();
    const label = next ? `继续闯关 · 第 ${next.stageNo} 关「${next.title}」` : "全部通关 · 重玩第 1 关";
    const hint = next
      ? `【${next.badge}】${goalOf(next)} · 难度 ${CN_DIFF[next.aiDiff]} · 首通 +${next.rewards.coins} 金币 +${next.rewards.exp} 经验`
      : "20 道场景挑战已全部拿下,挑一关再冲三星";
    this.paintSkillChip();
    // 星数与胶囊互相让位:两个盒子的宽度都由实测倒推,撞了就是版式错(campaignOverlaps)
    place(this.totalStarsLabel, headerBoxes(starsText, Skills.defOf(Career.equippedSkill()).name).stars, 2);
    this.resumeHint.string = hint;
    this.paintResume(label, hint);
  }

  // ---------- 关卡卡片 ----------

  private refreshCards(): void {
    this.cardContainer.removeAllChildren();
    const stages = CampaignManager.getStagesByCourt(this.currentCourt);
    const next = CampaignManager.getNextStage();
    const boxes = cardRow(stages.length);

    stages.forEach((stage, idx) => {
      const b = boxes[idx];
      const isUnlocked = CampaignManager.isStageUnlocked(stage.stageNo);
      const rec = CampaignManager.getStageRec(stage.id);
      const isNext = !!next && next.id === stage.id;
      const role = cardRole(isUnlocked, isNext, rec);
      const accent = faceOf(role);
      const K = cardRows();
      /** 色带里的字吃面上的墨,墨面上的字吃纸白;锁定态整卡退成 dimDeep */
      const bandInk = isUnlocked ? ac(inkFor(accent)) : ac(C.dimDeep);
      const faceInk = isUnlocked ? ac(C.paper) : ac(C.dimDeep);

      const card = uinode(`card_${stage.id}`, this.cardContainer, b.right - b.left, b.h);
      card.setPosition(b.left + (b.right - b.left) / 2, b.cy, 0);

      const g = card.addComponent(Graphics);
      retainedDraw(g, () => {
        // 卡片底:墨面 + 顶部一条 accent 色带 + 同色 keyline(下一关那圈描边加粗提亮)
        drawP5Card(g, CMP.card.w, CMP.card.h, accent, {
          bandH: CMP.card.bandH, teeth: CMP.card.teeth, locked: !isUnlocked, glow: isNext,
        });
        if (isUnlocked) {
          // 星级印章:四尖星,实=拿到(荧光黄实心)、空=描边(暗紫灰),不是文本字符
          const S = starRow();
          for (let i = 0; i < S.xs.length; i++) {
            const got = i < rec.stars;
            drawStarGlyph(g, S.xs[i], S.cy, S.s, got, got ? C.acid : C.dimDeep);
          }
        } else {
          // 锁也是 Graphics 形状:原生 Android 没有彩色 emoji 字体,那个字符要么方框要么缺字
          const L = lockRow();
          drawRankBadge(g, "lock", L.s, C.dimDeep, L.cx, L.text.cy);
        }
      });

      // 色带里两行:关卡编号 + 核心特色标签
      place(mkLabel(card, "no", `STAGE ${stage.stageNo < 10 ? "0" + stage.stageNo : stage.stageNo}`, 10, bandInk, { align: 1 }), K.no, 1);
      place(mkLabel(card, "badge", stage.badge, 13, bandInk, { align: 1 }), K.badge, 1);

      // 墨面四行:关卡名 / 副标题 / 挑战目标 / 难度
      place(mkLabel(card, "title", stage.title, 19, faceInk, { align: 1, outline: isUnlocked ? ac(C.ink, 0.86) : undefined, outlineW: 1.5 }), K.title, 1);
      place(mkLabel(card, "sub", stage.subtitle, 9, isUnlocked ? ac(C.dim) : ac(C.dimDeep), { align: 1 }), K.sub, 1);
      place(mkLabel(card, "goal", goalOf(stage), 13, isUnlocked ? ac(C.cyan) : ac(C.dimDeep), { align: 1 }), K.goal, 1);
      place(mkLabel(card, "diff", `难度: ${CN_DIFF[stage.aiDiff] ?? stage.aiDiff}`, 11, isUnlocked ? ac(C.dim) : ac(C.dimDeep), { align: 1 }), K.diff, 1);

      if (isUnlocked) {
        this.buildStateCapsule(card, accent, rec, isNext);
        pressable(card, 0.97);
        card.on(Button.EventType.CLICK, () => {
          this.kit.sfx.play("ui");
          this.openBriefing(stage);
        });
      } else {
        const L = lockRow();
        place(mkLabel(card, "lock", LOCK_TEXT, 11, ac(C.dimDeep), { align: 0 }), L.text, 0);
      }
    });
  }

  /**
   * 卡片中段的三态胶囊:下一关(带三角印章) / 已通关(最佳比分) / 可挑战。
   * 单独一个节点:一件「一次画完」的构件配一份 retainedDraw,不与卡底共用一条画布
   * (卡底每换一关都要 clear + 重画,叠在同一个 g 上就得一路 clear 重放两遍形状)。
   */
  private buildStateCapsule(card: Node, accent: string, rec: StageRec, isNext: boolean): void {
    const K = cardRows();
    const w = K.state.right - K.state.left, h = K.state.h;
    const text = isNext ? "下一关" : rec.clears > 0 ? `最佳 ${rec.bestScore}` : "可挑战";
    const n = uinode("state", card, w, h);
    const g = n.addComponent(Graphics);
    retainedDraw(g, () => {
      drawSectionBand(g, w, h, accent);
      // 下一关是这一屏唯一的目标:胶囊左端补一枚 next 三角印章,代替旧那句的文本箭标
      if (isNext) drawRankBadge(g, "next", 13, inkFor(accent), -w / 2 + 15, 0);
    });
    n.setPosition(0, K.state.cy, 0);
    const lbl = mkLabel(n, "state", text, isNext ? 13 : 12, ac(inkFor(accent)), { align: 1 });
    // 胶囊节点自己就摆在 state 格子上,里面的字按胶囊本地坐标居中(-w/2..w/2 → 盒心 0)
    place(lbl, { left: -w / 2, right: w / 2, cy: 0, h }, 1);
  }

  // ---------- 战前简报弹窗 (Briefing Dialog) ----------
  // 这里只负责「建节点 + 照排版摆」:折行、块间距、框高一律问 brief-layout。
  private buildBriefingDialog(): void {
    const DW = BRIEF.dialogW;
    this.briefDialog = uinode("briefDialog", this.panelNode, DW, this.briefH);
    this.briefDialog.setPosition(0, 0, 0);
    this.briefDialog.active = false;

    // 半透明遮罩拦截
    const mask = uinode("briefMask", this.briefDialog, PW, PH);
    const mg = mask.addComponent(Graphics);
    retainedDraw(mg, () => {
      mg.fillColor = ac(C.ink, 0.75);
      mg.rect(-PW / 2, -PH / 2, PW, PH);
      mg.fill();
    });
    mask.addComponent(BlockInputEvents);

    // 弹窗本体底板:高度是算出来的、每开一关都可能变 → 画法登记成可重放(retainedDraw),
    // 换高度时 clear + 重画一次即可(原生侧 Graphics 在 onDisable 会丢渲染数据,别裸 active)。
    const body = uinode("briefBody", this.briefDialog, DW, this.briefH);
    this.briefBody = body;
    const bg = body.addComponent(Graphics);
    this.briefBodyGfx = bg;
    retainedDraw(bg, () => this.paintBriefBody());
  }

  /** L1 衬纸(与大厅面板同一配方,只是窄一截、撕齿少几枚):旧写法是圆角矩形 + 2.5 斩劈红描边 */
  private paintBriefBody(): void {
    drawPosterPlate(this.briefBodyGfx, BRIEF.dialogW, this.briefH, {
      bandHex: ROLE.primary.face, teeth: 14,
    });
  }

  /** 一块文字:节点按 key 建一次就长期复用,排版给什么左缘/中心就摆什么 */
  private applyBriefItem(it: BriefItem): void {
    let lbl = this.briefLabels.get(it.key);
    if (!lbl) {
      const st = BRIEF_STYLE[it.key];
      lbl = mkLabel(this.briefBody, `b:${it.key}`, "", it.size, st ? st.col : BRIEF_CHIP_COL, {
        align: st && st.center ? 1 : 0,
        outline: st && st.outline ? ac(C.ink, 0.78) : undefined,
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
      // 「立即开战」= 斩劈红整面(与直达条、选中 tab 同一种大色块语言);「返回」= 常规按钮
      n = this.kit.button(this.briefBody, b.text, b.w, b.h,
        b.key === "start" ? { role: "primary", size: BRIEF.btnSize } : { size: BRIEF.btnSize });
      if (b.key === "start") {
        // 那颗 Label 长在按钮的子节点上(kit.button 自己建的),换个名字也不至于摸不到
        this.briefStartLabel = n.children.map((c) => c.getComponent(Label)).find((l) => l !== null) ?? null;
      }
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
    if (this.briefStartLabel) {
      this.briefStartLabel.string = CampaignManager.getStageRec(stage.id).clears > 0 ? "再次挑战 ★" : BRIEF_BTN.start;
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
