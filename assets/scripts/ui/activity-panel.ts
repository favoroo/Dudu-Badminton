// ============================================================
// 活动面板:每日/每周任务 + 全勤宝箱(2026-10-07 活动板块)—— P5 面板语法
// 1. 顶部标题行(EN kicker + 中文标题 + 刷新说明 + ✕)与每日/每周两格 tab
// 2. 任务行 ×3 + 全勤宝箱行 ×1:行格与行内排版全由 ./activity-layout.ts 给,
//    面板只照坐标摆 —— 压字/溢出判据 activityOverlaps/activityOverflow 吃 config
//    真文案,由 tools/activity-check.ts 断言,这里**一个坐标都不手调**。
// 3. 三态用色(色即功能,一律查 p5-tokens.ROLE):进行中=info 青 keyline /
//    可领取=star 荧光黄且 glow(与生涯里程碑可领卡同一语言)/ 已领取=off 墨面压暗。
//    进度条走 progressDL(与经验条同一把尺),fill 恒荧光黄(进度=货币同族)。
// 4. 领取 = 右侧实底色块整块即按钮;发奖与记账都在 Career.claimActivity 一处
//    (金币直接入账、经验走 addExp 同一条经济轨道),面板只管喊话 + 重建。
// 5. 每日任务清单是 core/activity.ts 按日戳抽的(pickDaily),面板不自算一遍;
//    跨天/跨周重置发生在 career.profile() 归一化里,这里拿到的必是当前这期。
// ============================================================
import { Button, Color, Graphics, Label, Node, UITransform } from "cc";
import { Career } from "../core/career";
import { CHEST_IDS } from "../core/activity";
import type { ChestView, QuestView } from "../core/activity";
import {
  ARCADE as C, ROLE, SLANT, ac, cancelFade, drawBevelSlot, drawP5Card,
  fadeOutHide, inkFor, mkLabel as uiMkLabel, paintP5, progressDL, retainedDraw,
  slamIn, uiIconButton,
} from "./ui-arcade";
import { clearKids, onTap, pressable, solidBlock, solidTab, uinode, type TabHandle } from "./ui-shell";
import {
  ACT, BTN_TEXT, CHEST_TEXT, HEADER_TEXT, REFRESH_HINT, TAB_TEXT,
  chestRowParts, headerBoxes, questRowParts, rowBoxes, tabRow, type Box,
} from "./activity-layout";
import type { UiKit } from "./ui-manager";

const PW = ACT.pw, PH = ACT.ph;

/** 把一个 Label 摆进 activity-layout 给的格子(与 campaign-panel 同款:contentSize 必设) */
function place(l: Label, b: Box, align: 0 | 1 | 2 = 1): void {
  const w = b.right - b.left;
  l.node.getComponent(UITransform)!.setContentSize(w, b.h);
  l.overflow = Label.Overflow.CLAMP;
  l.node.setPosition(align === 0 ? b.left : align === 2 ? b.right : b.left + w / 2, b.cy, 0);
}

function mkLabel(
  parent: Node, name: string, text: string,
  size: number, color: string | Color = C.paper,
  opts?: { x?: number; y?: number; w?: number; align?: number; lines?: number; outline?: Color; outlineW?: number },
): Label {
  const o = opts ?? {};
  return uiMkLabel(parent, name, text, size, color, {
    x: o.x, y: o.y, w: o.w, lines: o.lines,
    contentH: size * 1.35 * (o.lines ?? 1),
    align: (o.align ?? 1) as 0 | 1 | 2,
    anchor: "align",
    outline: o.outline, outlineW: o.outlineW,
  });
}

/** 行的三态角色与 keyline 面:可领=star+glow,已领=off,进行中=info */
function rowRole(v: { claimable: boolean; claimed: boolean }): { role: keyof typeof ROLE; glow: boolean } {
  if (v.claimable) return { role: "star", glow: true };
  if (v.claimed) return { role: "off", glow: false };
  return { role: "info", glow: false };
}

export class ActivityPanel {
  readonly root: Node;
  private kit: UiKit;
  private panelNode!: Node;
  private rowContainer!: Node;
  private tabs: TabHandle[] = [];
  private tabKeys: Array<"daily" | "weekly"> = ["daily", "weekly"];
  private currentTab: "daily" | "weekly" = "daily";
  private hintLabel!: Label;
  private onClose: (() => void) | null = null;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    this.root = kit.root(parent, "activity-panel");
    this.root.active = false;   // 此刻一个像素都没画过,先关再建不丢渲染数据
    this.build();
  }

  /**
   * 与闯关大厅同款契约:浮在 MENU 之上的一屏,Rules 状态全程不动,
   * 归途只能由调用方给(onClose → screenSwap → menu.show())。
   */
  show(onClose?: () => void): void {
    if (onClose) this.onClose = onClose;
    cancelFade(this.root);
    this.root.active = true;
    this.refreshTabs();
    this.refreshHeader();
    this.refreshRows();
    slamIn(this.panelNode, 0);
  }

  /** 收起:只淡出、不 deactivate(原生侧 Graphics 渲染数据会在 onDisable 被清) */
  hide(): void {
    fadeOutHide(this.root);
  }

  private close(): void {
    this.kit.sfx.play("ui");
    if (this.onClose) this.onClose();
    else this.hide();
  }

  private build(): void {
    this.kit.dim(this.root, 1, 1, { bands: false });
    const plate = this.kit.panel(this.root, PW, PH, {
      bandHex: ROLE.star.face, halftone: true,
    });
    this.panelNode = plate.node;

    // 标题行:EN kicker + 中文标题(左锚贴 colX,与闯关大厅同一副骨架)
    const H = headerBoxes();
    place(mkLabel(this.panelNode, "tag", HEADER_TEXT.tag, ACT.tag.size, ac(ROLE.star.face), { align: 0 }), H.tag, 0);
    place(mkLabel(this.panelNode, "title", HEADER_TEXT.title, ACT.title.size, ac(C.paper), {
      align: 0, outline: ac(C.ink, 0.78), outlineW: 2,
    }), H.title, 0);

    // 刷新说明:右锚,随 tab 换文案
    this.hintLabel = mkLabel(this.panelNode, "hint", "", ACT.hint.size, ac(C.dim), { align: 2 });

    // 关闭按钮
    const closeBtn = uiIconButton(this.panelNode, "✕", {
      fontSize: 18, hit: ACT.close.hit, vis: ACT.close.vis,
    });
    closeBtn.setPosition(ACT.close.x, ACT.close.cy, 0);
    closeBtn.on(Button.EventType.CLICK, () => this.close());

    // 每日/每周两格 tab
    const boxes = tabRow();
    this.tabs = this.tabKeys.map((key, i) => {
      const b = boxes[i];
      const t = solidTab({
        name: `tab:${key}`, parent: this.panelNode, label: TAB_TEXT[key],
        w: b.right - b.left, h: b.h, role: "star", size: ACT.tab.size,
      });
      t.node.setPosition(b.left + (b.right - b.left) / 2, b.cy, 0);
      t.node.on(Button.EventType.CLICK, () => {
        if (this.currentTab === key) return;
        this.kit.sfx.play("ui");
        this.currentTab = key;
        this.refreshTabs();
        this.refreshHeader();
        this.refreshRows();
      });
      return t;
    });

    // 行容器
    this.rowContainer = uinode("rows", this.panelNode, ACT.right - ACT.colX, 340);
    this.rowContainer.setPosition(0, 0, 0);
  }

  private refreshTabs(): void {
    this.tabs.forEach((t, i) => t.paint(this.tabKeys[i] === this.currentTab));
  }

  private refreshHeader(): void {
    this.hintLabel.string = REFRESH_HINT[this.currentTab];
    place(this.hintLabel, headerBoxes().hint, 2);
  }

  // ---------- 任务行与宝箱行(每次 clear 重建:三态、进度、按钮全是数据) ----------

  private refreshRows(): void {
    clearKids(this.rowContainer);
    const views = Career.activityViews();
    const boxes = rowBoxes();
    const list: QuestView[] = this.currentTab === "daily" ? views.daily : views.weekly;

    list.forEach((v, i) => this.buildQuestRow(boxes[i], v));
    this.buildChestRow(boxes[boxes.length - 1], this.currentTab === "daily" ? views.dailyChest : views.weeklyChest);
  }

  private buildQuestRow(r: Box, v: QuestView): void {
    const w = r.right - r.left;
    const card = uinode(`q-${v.id}`, this.rowContainer, w, r.h);
    card.setPosition(r.left + w / 2, r.cy, 0);
    const { role, glow } = rowRole(v);
    const face = ROLE[role].face;

    const g = card.addComponent(Graphics);
    const p = questRowParts(r);
    const bar = this.local(p.bar, card);
    retainedDraw(g, () => {
      // 行底:墨面 + 同色 keyline(可领加 glow),不压通宽色带 —— 与履历格同一条口径
      drawP5Card(g, w, r.h, face, { bandH: 0, glow });
    });

    // 进度条单开一个子节点(cc Graphics 没有 translate):track+fill 都出自 progressDL
    // ⇒ 左沿严格重合,与 career 面板的经验条同一把尺;进度=荧光黄(货币同族),已领置灰
    const barNode = uinode("bar", card, ACT.bar.w, ACT.bar.h + 8);
    barNode.setPosition(bar.left + (bar.right - bar.left) / 2, bar.cy, 0);
    const bg = barNode.addComponent(Graphics);
    retainedDraw(bg, () => {
      const t = v.target > 0 ? Math.min(v.prog / v.target, 1) : 0;
      const dl = progressDL(ACT.bar.w, ACT.bar.h, t, v.claimed ? C.dimDeep : C.acid);
      paintP5(bg, dl.track);
      paintP5(bg, dl.fill);
    });

    const ink = v.claimed ? C.dimDeep : C.paper;
    place(mkLabel(card, "title", v.title, 15, ac(ink), { align: 0 }), this.local(p.title, card), 0);
    const progText = `${v.prog}/${v.target}`;
    place(mkLabel(card, "prog", progText, ACT.prog.size, ac(v.claimable ? C.acid : C.dim)), this.local(p.prog, card), 0);
    const reward = `+${v.coin}币 +${v.exp}经验`;
    place(mkLabel(card, "reward", reward, ACT.reward.size, ac(v.claimed ? C.dimDeep : C.acid)), this.local(p.reward, card), 2);

    this.buildRowButton(card, r, v.claimable, v.claimed, () => this.claim(v.id));
  }

  private buildChestRow(r: Box, v: ChestView): void {
    const w = r.right - r.left;
    const card = uinode("chest", this.rowContainer, w, r.h);
    card.setPosition(r.left + w / 2, r.cy, 0);
    const { role, glow } = rowRole(v);
    const face = ROLE[role].face;

    const g = card.addComponent(Graphics);
    retainedDraw(g, () => drawP5Card(g, w, r.h, face, { bandH: 0, glow }));

    const p = chestRowParts(r);
    const subText = v.claimed ? CHEST_TEXT.claimed
      : this.currentTab === "daily" ? CHEST_TEXT.daily : CHEST_TEXT.weekly;
    place(mkLabel(card, "title", CHEST_TEXT.title, 15, ac(C.acid), { align: 0 }), this.local(p.title, card), 0);
    place(mkLabel(card, "sub", subText, 11, ac(v.claimed ? C.dimDeep : C.dim)), this.local(p.sub, card), 0);
    place(mkLabel(card, "reward", `+${v.coin}币`, ACT.reward.size, ac(v.claimed ? C.dimDeep : C.acid)), this.local(p.reward, card), 2);

    this.buildRowButton(card, r, v.claimable, v.claimed, () => this.claim(CHEST_IDS[this.currentTab]));
  }

  /**
   * 行右侧的三态按钮:可领 = 荧光黄实底大色块(整块即按钮,这一屏唯一的亮色大面);
   * 已领取/进行中 = 凹陷槽(不可点的视觉语言),不挂 Button。
   */
  private buildRowButton(card: Node, r: Box, claimable: boolean, claimed: boolean, onTapClaim: () => void): void {
    const p = questRowParts(r);
    const b = p.btn;
    const w = b.right - b.left, h = b.h;
    const local = this.local(b, card);
    const cx = local.left + w / 2, cy = local.cy;

    if (claimable) {
      const n = solidBlock("claim", card, w, h, ROLE.star.face, SLANT.block);
      n.setPosition(cx, cy, 0);
      mkLabel(n, "lbl", BTN_TEXT.claim, ACT.btn.size, inkFor(ROLE.star.face), { align: 1 });
      pressable(n, 0.96);
      n.on(Button.EventType.CLICK, () => {
        this.kit.sfx.play("ui");
        onTapClaim();
      });
      return;
    }
    const n = uinode("state", card, w, h);
    n.setPosition(cx, cy, 0);
    const g = n.addComponent(Graphics);
    retainedDraw(g, () => drawBevelSlot(g, w, h, SLANT.block));
    mkLabel(n, "lbl", claimed ? BTN_TEXT.claimed : BTN_TEXT.locked, ACT.btn.size, ac(C.dimDeep), { align: 1 });
  }

  /** 面板局部盒 → 行卡片局部盒(卡片节点摆在行盒中心,子件坐标要平移一次) */
  private local(b: Box, card: Node): Box {
    const pos = card.getPosition();
    return { left: b.left - pos.x, right: b.right - pos.x, cy: b.cy - pos.y, h: b.h };
  }

  // ---------- 领取 ----------

  private claim(id: string): void {
    const r = Career.claimActivity(id);
    if (!r) return;   // 无可领:Career 再拦一道,静默返回(按钮本来就照可领态建的)
    if (r.coin > 0) this.kit.sfx.play("coin");
    const ups = r.levelUps.length ? ` 升级 Lv.${r.levelUps[r.levelUps.length - 1]}!` : "";
    this.kit.toast(`领取成功 +${r.coin}金币 +${r.exp}经验${ups}`);
    this.refreshRows();
  }
}
