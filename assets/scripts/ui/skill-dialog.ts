// ============================================================
// 赛前技能配置弹窗 (SkillDialog):
// 街机风格居中面板 + 5 个技能卡片横排展示与一键装备
// 展示技能特性、冷却时间、生涯等级解锁要求与当前装备状态
// ============================================================
import { Button, Color, Graphics, Label, Node, UITransform, Vec2 } from "cc";
import { Skills } from "../core/skills";
import { Career } from "../core/career";
import { SkillDef, SkillId } from "../core/types";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, cancelFade, drawHardShadow, drawMenuCard, fadeOutHide,
  makeChip, slamIn,
} from "./ui-arcade";

const DIM_SUB = "#93a0c4";
const DIM_FAINT = "#64748b";

export class SkillDialog {
  readonly root: Node;
  private kit: UiKit;
  private card: Graphics;
  private dim: Node;
  private skillCards: Array<{
    node: Node;
    g: Graphics;
    id: SkillId;
    statusBtnLabel: Label;
    accent: string;
  }> = [];
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

    // 居中街机面板 (宽 700, 高 370)
    this.card = kit.panel(this.root, 700, 370, {
      r: 16,
      bgAlpha: 0.95,
      scan: true,
    });
    this.card.node.setPosition(0, 0, 0);

    // 标题
    const title = kit.label(this.card.node, "核心技能配置", 24, P.accent);
    title.node.setPosition(0, 146, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 140);
    title.shadowOffset = new Vec2(0, -4);

    const sub = kit.label(this.card.node, "S K I L L   C O N F I G U R A T I O N", 10, P.dim);
    sub.node.setPosition(0, 122, 0);

    const desc = kit.label(this.card.node, "提升生涯等级解锁更强技能 · 比赛前可自由装备一个主动技能", 12, P.text);
    desc.node.setPosition(0, 96, 0);

    // 5 张横排技能卡片
    const all = Skills.allSkills();
    all.forEach((item, i) => {
      const x = (i - 2) * 128;
      const y = -10;
      const w = 118;
      const h = 168;

      const node = new Node(`skill:${item.id}`);
      node.layer = this.root.layer;
      node.setPosition(x, y, 0);
      node.addComponent(UITransform).setContentSize(w, h);

      const g = node.addComponent(Graphics);

      // 顶部 CHIP (Tag)
      makeChip(node, item.tag, 9, item.accent, "#0a0e1c").setPosition(0, 62, 0);

      // 技能名称
      const name = kit.label(node, item.shortName, 17, item.accent);
      name.node.setPosition(0, 38, 0);

      // CD 时间
      const cdSec = (item.cooldownFrames / 60).toFixed(1);
      const cdText = kit.label(node, `CD ${cdSec}s`, 10, "#38bdf8");
      cdText.node.setPosition(0, 18, 0);

      // 描述说明
      const dLabel = kit.label(node, item.desc, 9, DIM_SUB);
      dLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      dLabel.lineHeight = 13;
      dLabel.node.setPosition(0, -18, 0);
      dLabel.node.getComponent(UITransform)!.setContentSize(108, 48);

      // 底部操作状态按钮
      const sBtn = kit.button(node, "装备", 96, 28, { size: 11, fg: "#0a0e1c", bg: item.accent });
      sBtn.setPosition(0, -62, 0);
      const btnLabel = sBtn.getComponent(Label) || sBtn.getComponentsInChildren(Label)[0];

      sBtn.on(Button.EventType.CLICK, () => {
        const unlocked = Career.isSkillUnlocked(item.id);
        if (!unlocked) {
          kit.sfx.play("ui");
          kit.toast(`需达到生涯等级 Lv.${item.unlockLevel} 解锁`);
          return;
        }
        kit.sfx.play("ui");
        Career.equipSkill(item.id);
        this.renderAllCards();
        kit.toast(`已装备技能 · ${item.name}`);
        this.onEquipCallback && this.onEquipCallback(item.id);
      });

      node.setParent(this.card.node);
      this.skillCards.push({
        node,
        g,
        id: item.id,
        statusBtnLabel: btnLabel,
        accent: item.accent,
      });
    });

    // 底部完成按钮
    const finBtn = kit.button(this.card.node, "完成", 140, 38, {
      size: 13,
      fg: P.accent,
      bg: "#1e293b",
    });
    finBtn.setPosition(0, -142, 0);
    finBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.hide();
    });
  }

  private renderAllCards(): void {
    const curEquipped = Career.equippedSkill();
    for (const sc of this.skillCards) {
      const def = Skills.defOf(sc.id);
      const isEquipped = sc.id === curEquipped;
      const isUnlocked = Career.isSkillUnlocked(sc.id);

      sc.g.clear();
      drawHardShadow(sc.g, 118, 168, 10, 3, 5, 0.45);
      drawMenuCard(sc.g, 118, 168, 10, {
        accent: isEquipped ? sc.accent : isUnlocked ? "#64748b" : "#334155",
        tint: isEquipped ? 0.16 : 0.06,
        bar: isEquipped ? 4 : 2,
        edge: isEquipped ? 4 : 2,
        alpha: isUnlocked ? 0.92 : 0.6,
      });

      if (isEquipped) {
        sc.statusBtnLabel.string = "已装备";
        sc.statusBtnLabel.color = new Color(16, 185, 129, 255);
      } else if (isUnlocked) {
        sc.statusBtnLabel.string = "装备";
        sc.statusBtnLabel.color = new Color(255, 255, 255, 255);
      } else {
        sc.statusBtnLabel.string = `Lv.${def.unlockLevel} 解锁`;
        sc.statusBtnLabel.color = new Color(148, 163, 184, 255);
      }
    }
  }

  show(onEquip?: (id: SkillId) => void): void {
    this.onEquipCallback = onEquip;
    cancelFade(this.root);
    this.dim.off(Node.EventType.TOUCH_START, this.onDimTap, this);
    this.dim.on(Node.EventType.TOUCH_START, this.onDimTap, this);
    this.root.active = true;
    this.renderAllCards();
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
