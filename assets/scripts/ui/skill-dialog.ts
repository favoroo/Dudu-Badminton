// ============================================================
// 赛前技能配置弹窗 (SkillDialog):
// 街机风格居中面板 + 5 个技能卡片横排 + 底部一条详情板
//
// 为什么说明不在卡片里:卡片只有 118 宽,而五句说明实测 198~321 px(9 号字),
// 硬塞进去就是用户拍的那张图 —— 五句糊成一排互相盖字。何况那颗「装备」按钮被
// uiButton 的 TOUCH_MIN 抬到 44 高之后,卡里连第三样东西的缝都不剩(见 skill-check
// 的 cardStackFits)。所以卡片只留「标签 + 名字 + CD + 装备」,完整说明整条搬到
// 面板底部那条 652 宽的详情板:15 号字下最长一句 535 px,一行就读得完。
//
// 排版一个坐标都不手调 —— 全问 ui/skill-layout.ts(折行、右对齐块按实测宽倒推、
// 竖排留缝),5 个技能全组合在 node 下回归:tools/skill-check.ts。
//
// ⚠ 整卡可点,但 Button 不挂在卡片节点上:见下面 hit 垫那段注释。
// ============================================================
import { Button, Graphics, Label, Node, UITransform, Vec2 } from "cc";
import { Skills } from "../core/skills";
import { Career } from "../core/career";
import { SkillId } from "../core/types";
import type { UiKit } from "./ui-manager";
import {
  ac, ARCADE, cancelFade, drawHardShadow, drawMenuCard, drawSlantShadow, fadeOutHide,
  makeChip, retainedDraw, ROLE, slamIn, skewOf, slantPath,
} from "./ui-arcade";
import {
  layoutSkillPlate, SK, SK_HINT_LINE, skillCardX, skillCd,
  type PlateItem, type PlateRole, type SkillLike,
} from "./skill-layout";

/** 倒三角的 y:贴在选中卡片下缘(含厚底边)与详情板之间那条缝里 */
const CARET_Y = SK.cardsY - SK.cardH / 2 - SK.cardEdge;

interface CardRec {
  node: Node;
  g: Graphics;
  id: SkillId;
  statusBtnLabel: Label;
  accent: string;
}

export class SkillDialog {
  readonly root: Node;
  private kit: UiKit;
  private card: Graphics;
  private dim: Node;
  private skillCards: CardRec[] = [];
  /** 底部详情板:节点与 Label 建一次就长期复用,切换技能只改 string / 位置 / 颜色 */
  private plate!: Node;
  private plateG!: Graphics;
  private plateLbl: Partial<Record<PlateRole, Label>> = {};
  /** 指向当前选中卡片的小倒三角 —— 详情板说的是哪张卡,全靠它说 */
  private caret!: Node;
  private caretG!: Graphics;
  private selectedId: SkillId = "lunge";
  private selAccent: string = ARCADE.acid;
  private onEquipCallback?: (id: SkillId) => void;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "skill-dialog");
    this.root.active = false;

    // 半透明全屏暗底,点击遮罩关闭
    this.dim = kit.dim(this.root, 0.45, 0.8);
    this.dim.on(Node.EventType.TOUCH_START, this.onDimTap, this);

    // 扫描线氛围
    kit.atmosphere(this.root);

    // 居中街机面板
    this.card = kit.panel(this.root, SK.panelW, SK.panelH, {
      r: 16,
      bgAlpha: 0.95,
      scan: true,
      bandHex: ROLE.info.face, tear: 12,
    });
    this.card.node.setPosition(0, 0, 0);

    // 标题
    const title = kit.label(this.card.node, "核心技能配置", 24, P.accent);
    title.node.setPosition(0, SK.titleY, 0);
    title.enableShadow = true;
    title.shadowColor = ac("#000000", 0.55);
    title.shadowOffset = new Vec2(0, -4);

    const sub = kit.label(this.card.node, "S K I L L   C O N F I G U R A T I O N", 10, P.dim);
    sub.node.setPosition(0, SK.subY, 0);

    // 操作提示并进这一行:详情板里就不再重复摆一条(同一件事只说一次)
    const hint = kit.label(this.card.node, SK_HINT_LINE, SK.hintSize, P.text);
    hint.node.setPosition(0, SK.hintY, 0);

    this.buildPlate();

    // 5 张横排技能卡片
    const all = Skills.allSkills();
    all.forEach((item, i) => {
      const w = SK.cardW;
      const h = SK.cardH;

      const node = new Node(`skill:${item.id}`);
      node.layer = this.root.layer;
      node.setPosition(skillCardX(i, all.length), SK.cardsY, 0);
      node.addComponent(UITransform).setContentSize(w, h);

      const g = node.addComponent(Graphics);
      node.setParent(this.card.node);

      // 整卡可点 = 选中看说明。但 Button 挂在**兄弟节点**上而不是卡片节点上:
      // Cocos 的 UI 触摸沿「命中节点 → 祖先」冒泡,兄弟不在链上。挂在卡片上的话,
      // 点底下那颗「装备」会同时触发装备 + 选中(两次音效、0.96×0.94 两层挤压)。
      // 摆在这里(装备按钮之前)就是让装备按钮渲染在它上面、先接走那一笔触摸。
      const hit = new Node("hit");
      hit.layer = this.root.layer;
      hit.addComponent(UITransform).setContentSize(w, h);
      const hb = hit.addComponent(Button);
      hb.transition = Button.Transition.SCALE;
      hb.zoomScale = 0.96;
      hb.target = node;
      hit.setParent(node);
      hit.on(Button.EventType.CLICK, () => this.select(item.id));

      // 顶部 CHIP (Tag)
      makeChip(node, item.tag, SK.chipSize, item.accent, ARCADE.ink).setPosition(0, SK.chipY, 0);

      // 技能名称
      const name = kit.label(node, item.shortName, SK.nameSize, item.accent);
      name.node.setPosition(0, SK.nameY, 0);

      // CD 时间(颜色不再写死某一款技能的 accent)
      const cdText = kit.label(node, skillCd(item), SK.cdSize, ARCADE.dim);
      cdText.node.setPosition(0, SK.cdY, 0);

      // 底部操作状态按钮 —— 必须最后 add,才排在 hit 之上、抢得到这一格的触摸
      const sBtn = kit.button(node, "装备", SK.btnW, SK.btnH, { size: 11, fg: ARCADE.ink, bg: item.accent });
      sBtn.setPosition(0, SK.btnY, 0);
      const btnLabel = sBtn.getComponent(Label) || sBtn.getComponentsInChildren(Label)[0];

      sBtn.on(Button.EventType.CLICK, () => {
        const unlocked = Career.isSkillUnlocked(item.id);
        if (!unlocked) {
          kit.sfx.play("ui");
          kit.toast(`需达到生涯等级 Lv.${item.unlockLevel} 解锁`);
          // 点不动也要把说明翻过来:玩家最该读到的正是没解锁的那款
          this.select(item.id);
          return;
        }
        kit.sfx.play("ui");
        Career.equipSkill(item.id);
        this.selectedId = item.id;
        this.repaint();
        kit.toast(`已装备技能 · ${item.name}`);
        this.onEquipCallback && this.onEquipCallback(item.id);
      });

      this.skillCards.push({
        node,
        g,
        id: item.id,
        statusBtnLabel: btnLabel,
        accent: item.accent,
      });
    });

    // 底部完成按钮
    const finBtn = kit.button(this.card.node, "完成", SK.finW, SK.finH, {
      size: 13,
      fg: P.accent,
      bg: ARCADE.navy2,
    });
    finBtn.setPosition(0, SK.finY, 0);
    finBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.hide();
    });
  }

  /** 详情板底板 + 倒三角:建一次,之后只重画底块颜色与摆位 */
  private buildPlate(): void {
    const n = new Node("skill-plate");
    n.layer = this.root.layer;
    n.addComponent(UITransform).setContentSize(SK.plateW, SK.plateH);
    n.setParent(this.card.node);
    n.setPosition(0, SK.plateY, 0);
    // 底块跟着选中技能换色 → 状态驱动的一次绘制,登记成可重放(原生侧掉渲染数据的坑)。
    // ⚠ 先赋字段再 retainedDraw:它登记时就跑一次 draw,而 paintPlate 读的是 this.plateG。
    const pg = n.addComponent(Graphics);
    this.plateG = pg;
    retainedDraw(pg, () => this.paintPlate());
    this.plate = n;

    const c = new Node("caret");
    c.layer = this.root.layer;
    c.addComponent(UITransform).setContentSize(20, 10);
    c.setParent(this.card.node);
    c.setPosition(skillCardX(0, Skills.allSkills().length), CARET_Y, 0);
    const cg = c.addComponent(Graphics);
    this.caretG = cg;
    retainedDraw(cg, () => this.paintCaret());
    this.caret = c;
  }

  private paintPlate(): void {
    const g = this.plateG;
    const skew = skewOf(SK.plateH, SK.slantDeg);
    // 与面板同一个 3° 斜切:底块边也要跟着斜,否则读起来像贴歪了一张纸
    drawSlantShadow(g, SK.plateW, SK.plateH, skew, 4, 5, 0.45);
    g.fillColor = ac(ARCADE.navy, 0.78);
    slantPath(g, SK.plateW, SK.plateH, skew);
    g.fill();
    g.fillColor = ac(this.selAccent, 0.09);
    slantPath(g, SK.plateW, SK.plateH, skew);
    g.fill();
    g.strokeColor = ac(this.selAccent, 0.85);
    g.lineWidth = 2;
    slantPath(g, SK.plateW, SK.plateH, skew);
    g.stroke();
  }

  private paintCaret(): void {
    const g = this.caretG;
    g.fillColor = ac(this.selAccent, 0.9);
    g.moveTo(-8, 0);
    g.lineTo(8, 0);
    g.lineTo(0, -9);
    g.close();
    g.fill();
  }

  /** 一块文字:节点按 role 建一次就长期复用,排版给什么摆什么 */
  private applyPlateItem(it: PlateItem): void {
    let lbl = this.plateLbl[it.role];
    if (!lbl) {
      lbl = this.kit.label(this.plate, "", it.size, ARCADE.paper, { align: it.align });
      // 锚点必须跟着对齐走:左对齐用左锚点、右对齐用右锚点。留着默认中心锚点 =
      // 文本框朝 x 左边再伸半个框宽,长文案整段推出内容列(旧版糊成一排正是这样)。
      lbl.node.getComponent(UITransform)!.setAnchorPoint(it.align === 0 ? 0 : it.align === 2 ? 1 : 0.5, 0.5);
      this.plateLbl[it.role] = lbl;
    }
    lbl.lineHeight = it.lineH;
    lbl.string = it.lines.join("\n");        // 已折好:引擎只管画,不会再自己换行
    lbl.node.setPosition(it.x, it.cy, 0);
  }

  private renderAllCards(): void {
    const curEquipped = Career.equippedSkill();
    for (const sc of this.skillCards) {
      const def = Skills.defOf(sc.id);
      const isEquipped = sc.id === curEquipped;
      const isSelected = sc.id === this.selectedId;
      const isUnlocked = Career.isSkillUnlocked(sc.id);
      const lit = isEquipped || isSelected;

      sc.g.clear();
      drawHardShadow(sc.g, SK.cardW, SK.cardH, 10, 3, 5, 0.45);
      drawMenuCard(sc.g, SK.cardW, SK.cardH, 10, {
        accent: lit ? sc.accent : isUnlocked ? ARCADE.dimDeep : ARCADE.line,
        tint: isSelected ? 0.18 : isEquipped ? 0.14 : 0.06,
        bar: lit ? 4 : 2,
        edge: lit ? 4 : 2,
        alpha: isUnlocked ? 0.92 : 0.6,
        active: isSelected,
      });

      if (isEquipped) {
        sc.statusBtnLabel.string = "已装备";
        sc.statusBtnLabel.color = ac(ARCADE.good);
      } else if (isUnlocked) {
        sc.statusBtnLabel.string = "装备";
        sc.statusBtnLabel.color = ac(ARCADE.paper);
      } else {
        sc.statusBtnLabel.string = `Lv.${def.unlockLevel} 解锁`;
        sc.statusBtnLabel.color = ac(ARCADE.dimDeep);
      }
    }
  }

  /** 详情板重画:全名 / 冷却 / 状态 / 完整说明 + 倒三角指向选中那张卡 */
  private renderDetail(): void {
    const all = Skills.allSkills();
    const def = Skills.defOf(this.selectedId) as unknown as SkillLike;
    const unlocked = Career.isSkillUnlocked(this.selectedId);
    const equipped = Career.equippedSkill() === this.selectedId;
    const L = layoutSkillPlate(def, unlocked, equipped);

    this.selAccent = def.accent;
    this.plateG.clear();
    this.paintPlate();
    this.caretG.clear();
    this.paintCaret();
    const idx = all.findIndex((s) => s.id === this.selectedId);
    this.caret.setPosition(skillCardX(Math.max(0, idx), all.length), CARET_Y, 0);

    for (const it of L.items) {
      this.applyPlateItem(it);
      const lbl = this.plateLbl[it.role];
      if (!lbl) continue;
      lbl.color = ac(
        it.role === "name" ? (unlocked ? def.accent : ARCADE.dim)
          : it.role === "status" ? (unlocked ? (equipped ? ARCADE.good : ARCADE.dim) : ARCADE.bad)
            : it.role === "desc" ? ARCADE.paper
              : ARCADE.cyan,
      );
    }
  }

  private repaint(): void {
    this.renderAllCards();
    this.renderDetail();
  }

  /** 选中一款:幂等 —— 重复点同一张卡不再重绘、也不再响音效 */
  private select(id: SkillId): void {
    if (id === this.selectedId) return;
    this.kit.sfx.play("ui");
    this.selectedId = id;
    this.renderAllCards();
    this.renderDetail();
  }

  show(onEquip?: (id: SkillId) => void): void {
    this.onEquipCallback = onEquip;
    cancelFade(this.root);
    this.dim.off(Node.EventType.TOUCH_START, this.onDimTap, this);
    this.dim.on(Node.EventType.TOUCH_START, this.onDimTap, this);
    // 兄弟顺序即渲染顺序,而本弹窗在 ui-manager.start() 里造得比闯关大厅早(大厅、商店这类
    // 常驻面板都是它之后 addComponent 出来的)—— 从大厅点技能胶囊就会弹到面板背后:
    // 看不见、点不着,只有回到对练屏才正常。每次打开把自己抬到最上层。
    const parent = this.root.parent;
    if (parent) this.root.setSiblingIndex(parent.children.length - 1);
    this.root.active = true;
    // 每次打开都跟着实际装备走(等级、装备都可能在上次关闭后变了)
    this.selectedId = Career.equippedSkill();
    this.repaint();
    slamIn(this.card.node);
  }

  hide(): void {
    this.dim.off(Node.EventType.TOUCH_START, this.onDimTap, this);
    fadeOutHide(this.root);
  }

  private onDimTap(): void {
    this.kit.sfx.play("ui");
    this.hide();
  }
}
