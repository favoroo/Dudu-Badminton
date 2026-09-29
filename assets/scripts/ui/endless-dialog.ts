// ============================================================
// 无限练习模式 AI 难度选择弹窗:
// 居中街机卡片 + 半透明暗底遮罩 + 三档难度卡(入门/普通/大师)。
// 玩家选定难度后直接开局进入无限模式(不计比分胜负,持续对拉练习)。
// ============================================================
import { Button, Color, Graphics, Label, Node, UITransform, Vec2 } from "cc";
import type { DiffKey } from "../core/types";
import { col } from "./ui-manager";
import type { UiKit } from "./ui-manager";
import {
  ARCADE, cancelFade, drawHardShadow, drawMenuCard, fadeOutHide,
  makeChip, slamIn,
} from "./ui-arcade";

const DIFF_ITEMS: Array<{
  key: DiffKey;
  name: string;
  tag: string;
  accent: string;
  desc: string;
}> = [
  {
    key: "easy",
    name: "入门",
    tag: "EASY",
    accent: "#7dff9e",
    desc: "球速温和\n回球稳定\n适合练习挥拍",
  },
  {
    key: "normal",
    name: "普通",
    tag: "NORMAL",
    accent: "#ffe14d",
    desc: "攻守兼备\n标准拉吊\n强化控球节奏",
  },
  {
    key: "hard",
    name: "大师",
    tag: "HARD",
    accent: "#ff6a1f",
    desc: "反应迅捷\n强力重扣\n极限相持挑战",
  },
];

const DIM_SUB = "#93a0c4";

export class EndlessDialog {
  readonly root: Node;
  private kit: UiKit;
  private card: Graphics;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "endless-dialog");
    this.root.active = false;

    // 半透明全屏暗底,点击遮罩关闭
    const dim = kit.dim(this.root, 0.42, 0.76);
    dim.on(Node.EventType.TOUCH_START, () => {
      kit.sfx.play("ui");
      this.hide();
    });

    // 扫描线氛围
    kit.atmosphere(this.root);

    // 居中街机面板 (宽 540, 高 350)
    this.card = kit.panel(this.root, 540, 350, {
      r: 16,
      bgAlpha: 0.94,
      scan: true,
    });
    this.card.node.setPosition(0, 0, 0);

    // 标题
    const title = kit.label(this.card.node, "无限练习", 26, P.accent);
    title.node.setPosition(0, 138, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 140);
    title.shadowOffset = new Vec2(0, -4);

    const sub = kit.label(this.card.node, "E N D L E S S   P R A C T I C E", 11, P.dim);
    sub.node.setPosition(0, 114, 0);

    const desc = kit.label(this.card.node, "无视比分胜负，持续对打练习！请选择陪练 AI 难度：", 13, P.text);
    desc.node.setPosition(0, 84, 0);

    // 三张横排难度卡
    DIFF_ITEMS.forEach((item, i) => {
      const x = (i - 1) * 166;
      const y = -14;
      const w = 150;
      const h = 142;

      const node = new Node(`diff:${item.key}`);
      node.layer = this.root.layer;
      node.setPosition(x, y, 0);
      node.addComponent(UITransform).setContentSize(w, h);

      const g = node.addComponent(Graphics);
      drawHardShadow(g, w, h, 12, 4, 6, 0.46);
      drawMenuCard(g, w, h, 12, {
        accent: item.accent,
        tint: 0.12,
        bar: 4,
        edge: 4,
        alpha: 0.92,
      });

      // 顶部 CHIP
      makeChip(node, item.tag, 10, item.accent, "#0a0e1c").setPosition(38, 48, 0);

      // 难度名称
      const name = kit.label(node, item.name, 22, item.accent);
      name.node.setPosition(-26, 46, 0);

      // 描述说明
      const dLabel = kit.label(node, item.desc, 11, DIM_SUB);
      dLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      dLabel.lineHeight = 16;
      dLabel.node.setPosition(0, -16, 0);

      // 按钮点击
      const btn = node.addComponent(Button);
      btn.transition = Button.Transition.SCALE;
      btn.zoomScale = 0.95;
      btn.target = node;

      node.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        this.hide();
        kit.startEndlessMatch(item.key);
      });

      node.setParent(this.card.node);
    });

    // 底部返回按钮
    const backBtn = kit.button(this.card.node, "返回", 140, 42, {
      size: 14,
      fg: P.dim,
    });
    backBtn.setPosition(0, -126, 0);
    backBtn.on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      this.hide();
    });
  }

  show(): void {
    cancelFade(this.root);
    this.root.active = true;
    slamIn(this.card.node);
  }

  hide(): void {
    fadeOutHide(this.root);
  }
}
