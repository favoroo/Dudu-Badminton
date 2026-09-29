// ============================================================
// 暂停面板:居中卡片 + 全屏暗遮罩。
// 遮罩带 BlockInputEvents 且 ui-root 整体在虚拟按键之上(决策②):
// 暂停期间右下的「跳/深球/短球」触摸不会透进世界。
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

    const card = kit.panel(this.root, 380, 344, { r: 16, alpha: 0.9 });
    this.card = card.node;
    card.node.setPosition(0, 4, 0);
    const title = kit.label(card.node, "已暂停", 28, P.accent);
    title.node.setPosition(0, 128, 0);
    title.enableShadow = true;
    title.shadowColor = new Color(0, 0, 0, 130);
    title.shadowOffset = new Vec2(0, -4);
    kit.label(card.node, "P A U S E D", 11, P.dim).node.setPosition(0, 100, 0);

    const mk = (text: string, y: number, accent: boolean): Node => {
      const b = kit.button(card.node, text, 300, 50, accent
        ? { bg: P.accent, fg: P.ink, size: 18 }
        : { size: 17 });
      b.setPosition(0, y, 0);
      return b;
    };

    mk("继续比赛", 58, true).on(Button.EventType.CLICK, () => {
      kit.sfx.play("ui");
      Rules.resume();
    });
    mk("重新开始", -2, false).on(Button.EventType.CLICK, () => kit.restartCurrent());
    mk("返回主菜单", -62, false).on(Button.EventType.CLICK, () => kit.quitToMenu());
    // 音效开关:全局静音(UI 音 + 比赛音一起切,见 UIManager.applyMute)
    const snd = mk("", -122, false);
    this.soundLabel = snd.children[0].getComponent(Label)!;
    snd.on(Button.EventType.CLICK, () => {
      const muted = kit.toggleMute();
      this.soundLabel.string = `音效:${muted ? "关" : "开"}`;
    });
  }

  show(): void {
    this.soundLabel.string = `音效:${this.kit.muted ? "关" : "开"}`;
    this.root.active = true;
    slamIn(this.card);   // 老 .panel 的 slam 砸落
  }
}
