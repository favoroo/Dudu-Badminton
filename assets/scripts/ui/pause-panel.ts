// ============================================================
// 暂停面板:居中卡片 + 全屏暗遮罩。
// 遮罩带 BlockInputEvents 且 ui-root 整体在虚拟按键之上(决策②):
// 暂停期间触摸不透进世界。PAUSED 已经不是对局态,虚拟按键本身也已经
// 被 input/touchpad 的显隐控制器收起来了(所以这里不会「暗底后浮着五个圈」)。
// ============================================================
import { Button, Color, Label, Node, Vec2 } from "cc";
import { Rules } from "../core/rules";
import type { UiKit } from "./ui-manager";
import { slamIn } from "./ui-arcade";

export class PausePanel {
  readonly root: Node;
  private kit: UiKit;
  private soundLabel: Label;
  private card: Node;

  constructor(parent: Node, kit: UiKit) {
    this.kit = kit;
    const P = kit.pal;
    this.root = kit.root(parent, "pause-panel");
    this.root.active = false;

    kit.dim(this.root, 0.25, 0.5);
    kit.atmosphere(this.root);

    const card = kit.panel(this.root, 380, 374, { r: 16, alpha: 0.9 });
    this.card = card.node;
    card.node.setPosition(0, 4, 0);
    const title = kit.label(card.node, "已暂停", 28, P.accent);
    title.node.setPosition(0, 140, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    kit.label(card.node, "P A U S E D", 11, P.dim).node.setPosition(0, 114, 0);

    const mk = (text: string, y: number, accent: boolean): Node => {
      const b = kit.button(card.node, text, 300, 46, accent
        ? { bg: P.accent, fg: P.ink, size: 18 }
        : { size: 17 });
      b.setPosition(0, y, 0);
      return b;
    };

    mk("继续比赛", 70, true).on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      Rules.resume();
    });
    mk("重新开始", 16, false).on(Button.EventType.CLICK, () => kit.restartCurrent());
    mk("设置", -38, false).on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      kit.openSettings();          // 关完回到这一页,不是主菜单(见 UIManager.openSettings)
    });
    // 声音开关:两条总线一起切(细分的音效/音乐与音量在设置页)
    const snd = mk("", -92, false);
    this.soundLabel = snd.children[0].getComponent(Label)!;
    snd.on(Button.EventType.CLICK, () => {
      const muted = kit.toggleMute();
      this.soundLabel.string = `声音:${muted ? "关" : "开"}`;
    });
    mk("返回主菜单", -146, false).on(Button.EventType.CLICK, () => kit.quitToMenu());
  }

  show(): void {
    this.soundLabel.string = `声音:${this.kit.muted ? "关" : "开"}`;
    this.root.active = true;
    slamIn(this.card);   // 老 .panel 的 slam 砸落
  }
}
