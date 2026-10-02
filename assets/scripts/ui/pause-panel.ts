// ============================================================
// 暂停面板:居中卡片 + 全屏暗遮罩。
// 遮罩带 BlockInputEvents 且 ui-root 整体在虚拟按键之上(决策②):
// 暂停期间触摸不透进世界。PAUSED 已经不是对局态,虚拟按键本身也已经
// 被 input/touchpad 的显隐控制器收起来了(所以这里不会「暗底后浮着五个圈」)。
// ============================================================
import { Button, Color, Label, Node, Vec2 } from "cc";
import { Rules } from "../core/rules";
import type { UiKit } from "./ui-manager";
import { cancelFade, fadeOutHide, ROLE, slamIn } from "./ui-arcade";

export class PausePanel {
  readonly root: Node;
  private kit: UiKit;
  private soundLabel: Label;
  private card: Node;
  /** 六颗按钮按名字索引,show() 时按模式重排(结束本局只在无尽模式露出) */
  private btns = new Map<string, Node>();
  private static readonly H = 470;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "pause-panel");
    this.root.active = false;

    kit.dim(this.root, 0.25, 0.5);
    kit.atmosphere(this.root);

    // 卡片 470 高:六颗按钮每档间隙能保住 12+ 触控缝;非无尽模式收成五颗、间距放宽
    const card = kit.panel(this.root, 380, PausePanel.H, {
      r: 16, alpha: 0.92, bandHex: ROLE.primary.face, tear: 9,
    });
    this.card = card.node;
    card.node.setPosition(0, 0, 0);
    const title = kit.label(card.node, "已暂停", 28, P.accent);
    title.node.setPosition(0, 191, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    kit.label(card.node, "P A U S E D", 12, P.dim).node.setPosition(0, 165, 0);

    const mk = (name: string, accent: boolean): Node => {
      const b = kit.button(card.node, name, 300, 46, accent
        ? { bg: P.accent, fg: P.ink, size: 18 }
        : { size: 17 });
      this.btns.set(name, b);
      return b;
    };

    mk("继续比赛", true).on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      Rules.resume();
    });
    // 无限练习专属:从前这个模式永不终局,只能暂停回主菜单 —— 打多久、最高多少分
    // 全不留档也没有奖励。收局走正常 matchOver,按当前比分判胜负并进结算页。
    mk("结束本局", false).on(Button.EventType.CLICK, () => kit.endEndless());
    mk("重新开始", false).on(Button.EventType.CLICK, () => kit.restartCurrent());
    mk("设置", false).on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.openSettings();          // 关完回到这一页,不是主菜单(见 UIManager.openSettings)
    });
    // 声音开关:两条总线一起切(细分的音效/音乐与音量在设置页)
    const snd = mk("", false);
    this.btns.delete("");            // 音效钮显示文本为空,改用固定键参与 show() 排布
    this.btns.set("声音", snd);
    this.soundLabel = snd.children[0].getComponent(Label)!;
    snd.on(Button.EventType.CLICK, () => {
      const muted = kit.toggleMute();
      this.soundLabel.string = `声音:${muted ? "关" : "开"}`;
    });
    mk("返回主菜单", false).on(Button.EventType.CLICK, () => kit.quitToMenu());
  }

  show(): void {
    cancelFade(this.root);
    // 无尽模式六颗(含「结束本局」),其余模式五颗;两种排法都从 y=113 起步铺满卡面
    const endless = Rules.R.mode === "endless";
    const visible = endless
      ? ["继续比赛", "结束本局", "重新开始", "设置", "声音", "返回主菜单"]
      : ["继续比赛", "重新开始", "设置", "声音", "返回主菜单"];
    const gap = endless ? 58 : 71;
    let y = 113;
    for (const name of visible) {
      const b = this.btns.get(name);
      if (!b) continue;
      b.active = true;
      b.setPosition(0, y, 0);
      y -= gap;
    }
    for (const [name, b] of this.btns) {
      if (!visible.includes(name)) b.active = false;   // 模式切换后的残留隐藏
    }
    this.soundLabel.string = `声音:${this.kit.muted ? "关" : "开"}`;
    this.root.active = true;
    slamIn(this.card);   // 老 .panel 的 slam 砸落
  }

  hide(): void {
    fadeOutHide(this.root);
  }
}
