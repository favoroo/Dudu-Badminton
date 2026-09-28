// ============================================================
// 触屏虚拟按键:左下「左移/右移(双击跨步)」,右下「跳/深球/短球」。
// 和键盘映射同一套 Pad 动作语义;按钮节点由本模块程序化生成,
// 编辑器里不用摆任何东西。多指同时按不同键靠 Cocos 的节点级触摸分发。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UITransform, Widget } from "cc";
import { Pad, press, release } from "./pad";

interface BtnSpec {
  action: "left" | "right" | "jump" | "swingFar" | "swingNear";
  text: string;
  x: number; y: number;      // 屏幕坐标(设计分辨率 960×540,原点居中)
  r: number;
}

// 布局:左下移动簇(左右双击触发跨步),右下击球簇。跳键最大(使用频率最高),击球两键左右并排
// 世界画面整体抬高 view.offsetY 后,地面线在 y=-150:按键全部收进下方按键带,不压任何角色
const SPECS: BtnSpec[] = [
  { action: "left",      text: "左",   x: -345, y: -205, r: 44 },
  { action: "right",     text: "右",   x: -235, y: -205, r: 44 },
  { action: "jump",      text: "跳",   x: 400,  y: -140, r: 48 },  // 略高于地面线,但横向不与任何角色重叠
  { action: "swingNear", text: "短球", x: 295,  y: -230, r: 38 },
  { action: "swingFar",  text: "深球", x: 400,  y: -230, r: 38 },
];

const RELEASE_ACTIONS: Array<BtnSpec["action"]> = ["left", "right", "jump"];

function makeButton(spec: BtnSpec, root: Node, pad: Pad): void {
  const node = new Node(`btn-${spec.action}`);
  node.layer = Layers.Enum.UI_2D;
  node.addComponent(UITransform).setContentSize(spec.r * 2, spec.r * 2);
  node.setPosition(spec.x, spec.y, 0);
  node.setParent(root);

  const g = node.addComponent(Graphics);
  g.fillColor = new Color(255, 255, 255, 38);
  g.strokeColor = new Color(255, 255, 255, 90);
  g.lineWidth = 3;
  g.circle(0, 0, spec.r);
  g.fill();
  g.stroke();

  const textNode = new Node("text");
  textNode.layer = Layers.Enum.UI_2D;
  textNode.addComponent(UITransform).setContentSize(spec.r * 2, spec.r * 2);
  textNode.setParent(node);

  const label = textNode.addComponent(Label);
  label.string = spec.text;
  label.fontSize = spec.text.length > 1 ? 22 : 30;
  label.lineHeight = Math.round(label.fontSize * 1.2);
  label.horizontalAlign = 1;
  label.verticalAlign = 1;
  label.color = new Color(255, 255, 255, 200);

  // 按下/松开视觉反馈:描边加亮
  const setActive = (on: boolean) => {
    g.clear();
    g.fillColor = on ? new Color(255, 255, 255, 90) : new Color(255, 255, 255, 38);
    g.strokeColor = on ? new Color(255, 231, 77, 220) : new Color(255, 255, 255, 90);
    g.lineWidth = on ? 4 : 3;
    g.circle(0, 0, spec.r);
    g.fill();
    g.stroke();
  };

  node.on(Node.EventType.TOUCH_START, () => { setActive(true); press(pad, spec.action); });
  node.on(Node.EventType.TOUCH_END, () => {
    setActive(false);
    if ((RELEASE_ACTIONS as string[]).includes(spec.action)) release(pad, spec.action as "left");
  });
  node.on(Node.EventType.TOUCH_CANCEL, () => {
    setActive(false);
    if ((RELEASE_ACTIONS as string[]).includes(spec.action)) release(pad, spec.action as "left");
  });
}

export function buildTouchPad(root: Node, pad: Pad): Node {
  const layer = new Node("touchpad");
  layer.layer = Layers.Enum.UI_2D;
  layer.addComponent(UITransform);
  // 吸到屏幕底部:不随镜头震动,真机上横竖屏适配也稳
  const widget = layer.addComponent(Widget);
  widget.isAlignTop = true; widget.top = 0;
  widget.isAlignBottom = true; widget.bottom = 0;
  widget.isAlignLeft = true; widget.left = 0;
  widget.isAlignRight = true; widget.right = 0;
  layer.setParent(root);
  for (const spec of SPECS) makeButton(spec, layer, pad);
  return layer;
}
