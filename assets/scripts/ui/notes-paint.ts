// ============================================================
// 「更新说明」物理行的落屏画笔 —— 更新弹窗与「更新记录」弹窗共用同一份。
//
// 为什么从 update-dialog 里拆出来:「更新记录」要把**很多个版本**的正文叠进同一口
// 滚动井,一行行摆字的规则(小节色条/列表圆点、span 依次推进 x、anchor (0,.5) 对齐
// textW 的量宽)与更新弹窗完全同构 —— 两份手抄迟早漂移,v0.0.7 那次线上事故的病根
// 正是「排版算术两处各算一次」。折行与行高仍由 release-notes 独家算,这里只负责
// 「照着行表画」,不参与任何测量。
//
// 颜色与 Label 工厂由调用方注入(kit.label + 三个角色色),本文件不握 UiKit 实例。
// ============================================================
import { Graphics, Label, Node, UITransform } from "cc";
import { col } from "./ui-manager";
import { textW } from "./ui-arcade";
import { NOTE } from "./release-notes";
import type { NoteLine } from "./release-notes";

/** 画笔的注入面:Label 工厂与三个角色色(调用方从 kit.pal 现取,不缓存旧色) */
export interface NotePaintDeps {
  label: (parent: Node, text: string, size: number, colorHex: string, opts?: { align?: 0 | 1 | 2 }) => Label;
  accent: string;
  dim: string;
  text: string;
}

/** 清空内容层(每次显示重建 Label:一轮对话最多看几次,不值得做对象池) */
export function clearNotePaint(content: Node, g: Graphics): void {
  for (const child of content.children.slice()) {
    child.removeFromParent();
    child.destroy();
  }
  g.clear();
}

/**
 * 摆一条物理行:中心 y = cy,井内宽 = boxW(标记条的 x 从井左缘 + padX 起算)。
 * span 从左往右排,anchor 压到 (0, .5) 才和 textW 量出来的宽度对得上。
 */
export function paintNoteLine(deps: NotePaintDeps, g: Graphics, content: Node, line: NoteLine, cy: number, boxW: number): void {
  const isHead = line.kind === "section";
  const size = isHead ? NOTE.headSize : NOTE.size;
  let x = -boxW / 2 + NOTE.padX + line.indent;
  if (isHead) {
    g.fillColor = col(deps.accent, 0.9);
    g.rect(-boxW / 2 + NOTE.padX, cy - 6, 3, 12);
    g.fill();
  } else if (line.kind === "item") {
    g.fillColor = col(deps.dim, 0.9);
    g.circle(-boxW / 2 + NOTE.padX + 2, cy, 2);
    g.fill();
  }
  for (const span of line.spans) {
    const label = deps.label(content, span.text, size, noteSpanColor(deps, span.strong, isHead), { align: 0 });
    label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    label.node.setPosition(x, cy, 0);
    x += textW(span.text, size);
  }
}

/** 小节 = 强调色;正文 = 纸白;md 的 **加粗** 用强调色顶上(原生无粗体字面,靠颜色分层) */
function noteSpanColor(deps: NotePaintDeps, strong: boolean, isHead: boolean): string {
  if (isHead) return deps.accent;
  return strong ? deps.accent : deps.text;
}
