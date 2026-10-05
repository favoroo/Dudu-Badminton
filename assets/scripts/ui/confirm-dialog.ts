// ============================================================
// 二次确认弹窗:点「会覆盖你调过的东西」那颗键之前,先问一句。
//
// 什么时候该用它,什么时候不该(用户口径 2026-10-05:「确认只在真有数据要撤销时弹」):
//   ✅ 误触代价不对称的动作 —— 点错要重新摆半小时(重置按键布局就是这一类);
//   ❌ 单纯的入口 / 切页 / 可逆的开关。给这些加弹窗就是拦路,首页那几颗大色块
//      当年就是因为「点一下先弹一层」被要求全改成直切(见 mode-screen / main-menu)。
//   调用点还要**自己判断有没有东西可撤销**:没有就直接做,别拿这颗弹窗当仪式。
//   (现场:Settings.padLayoutIsDefault() —— 判据与 resetPad 同源,见 core/settings.ts。)
//
// 三条实现口径,都是这个仓库真踩过的坑:
//   1) **一个坐标都不手调**:卡高跟着文案算,全在 ui/confirm-layout.ts(零 cc),
//      由 tools/panel-check.ts 断言不压字、不出框、按钮够高。
//   2) **退场即 destroy**:本弹窗是一次性的(每次要问都新建)。常驻复用会撞上
//      「fadeOutHide 不 deactivate → 第二次打开底块透明只剩字」那条原生侧的坑
//      (见 ui-arcade.retainedDraw 与 tools/ui-hide-check.ts 文件头),而一次性
//      新建 + 退场销毁从结构上就没有复活路径,不需要 cancelFade 去救。
//   3) **挂在调用面板的 root 下、show 时抬到最上层**:身后那层面板自己有盖满屏的
//      暗底(BlockInputEvents),不抬就是「弹窗看不见也点不着」(更新弹窗同款事故)。
//      dim 自带 BlockInputEvents,所以弹窗开着时底下那屏一颗键也点不动 —— 这正是
//      「必须先做个选择」要的语义,因此不做「点遮罩=取消」(那需要裸 TOUCH 监听,
//      而淡出期间它会变成隐形挡板,见 ui-hide-check)。
// ============================================================
import { Button, Color, Node, Vec2 } from "cc";
import type { UiKit } from "./ui-manager";
import { fadeOutHide, mkLabel, slamIn } from "./ui-arcade";
import { ROLE } from "./p5-tokens";
import { layoutConfirm, type ConfirmSpec } from "./confirm-layout";

export class ConfirmDialog {
  readonly root: Node;
  private closed = false;

  /**
   * 建好即显示(没有"先建后show"的第二条路,所以也不会有复活问题)。
   * @param parent 面板根(与它的暗底做兄弟)
   * @param spec   文案(见 confirm-layout.ConfirmSpec)
   * @param onAction 右那颗兑现动作;取消那颗不会调它
   */
  constructor(parent: Node, kit: UiKit, spec: ConfirmSpec, onAction: () => void) {
    const P = kit.pal;
    const L = layoutConfirm(spec);

    this.root = kit.root(parent, "confirm-dialog");
    // 抬到最上层:晚到的兄弟才压得住身后那屏的暗底
    const p = this.root.parent;
    if (p) this.root.setSiblingIndex(p.children.length - 1);

    kit.dim(this.root, 0.45, 0.8);

    const card = kit.panel(this.root, L.cardW, L.cardH, { r: 16, bandHex: ROLE.primary.face });
    card.node.setPosition(0, 0, 0);

    for (const it of L.items) {
      const hex = it.key === "title" ? P.accent : it.key === "body" ? P.text : P.dim;
      const lbl = mkLabel(card.node, `cf:${it.key}`, it.lines.join("\n"), it.size, hex, {
        // 行高与块高都照排版给的那份数:引擎自己量的行高(≈size×1.22)比 CF.bodyH 小,
        // 两边各算一次就会出现「判据说没压字、真机上两行叠半行」。
        // 不设 CLAMP:文案已经按可用宽折过,裁切只会带来「最后一行下半截没了」这一种新坏法。
        w: L.availW, lines: it.lines.length, lineH: it.lineH, contentH: it.h,
        align: 1, anchor: "center",
        disp: it.key === "title",
      });
      if (it.key === "title") {
        lbl.enableShadow = true;
        lbl.shadowColor = new Color(0, 0, 0, 130);
        lbl.shadowOffset = new Vec2(0, -4);
      }
      lbl.node.setPosition(0, it.cy, 0);
    }

    for (const b of L.buttons) {
      const node = kit.button(card.node, b.text, b.w, b.h, {
        size: b.size,
        // 兑现那颗走斩劈红实底:色即「这一步会覆盖东西」,与「完成 / 立即开战」同一档
        style: b.key === "action" ? "primary" : "ghost",
      });
      node.setPosition(b.cx, b.cy, 0);
      node.on(Button.EventType.CLICK, () => {
        kit.sfx.play("ui");
        if (b.key === "action") {
          this.hide();
          onAction();
        } else this.hide();
      });
    }

    slamIn(card.node);
  }

  /** 淡出后整树离场:一次性弹窗不留复活路径(见文件头第 2 条) */
  hide(): void {
    if (this.closed) return;
    this.closed = true;
    fadeOutHide(this.root, () => { if (this.root.isValid) this.root.destroy(); });
  }
}

/**
 * 问一句。padding 与卡高都由文案算,调用点只给文案与兑现动作。
 * 顶栏/页面上重复点同一颗键时,调用点负责先收掉上一张(见 settings-panel.askResetPad)。
 */
export function askConfirm(parent: Node, kit: UiKit, spec: ConfirmSpec, onAction: () => void): ConfirmDialog {
  return new ConfirmDialog(parent, kit, spec, onAction);
}
