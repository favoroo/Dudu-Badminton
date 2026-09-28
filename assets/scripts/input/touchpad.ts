// ============================================================
// 触屏虚拟按键(决策①):左下「左移/右移/跨步」,右下「跳/深球/短球」。
// 和键盘映射同一套 Pad 动作语义;按钮节点由本模块程序化生成,
// 编辑器里不用摆任何东西。多指同时按不同键靠 Cocos 的节点级触摸分发。
// ============================================================
import { Color, Graphics, Label, Node, UITransform, Widget } from "cc";
import { Pad, press, release } from "./pad";

interface BtnSpec {
  action: "left" | "right" | "jump" | "lunge" | "swingFar" | "swingNear";
  text: string;
  x: number; y: number;      // 屏幕坐标(设计分辨率 960×540,原点居中)
  r: number;
}

// 布局:左下移动簇,右下击球簇。跳键最大(使用频率最高),击球两键左右并排
const SPECS: BtnSpec[] = [
  { action: "left",  text: "◀",  x: -390, y: -205, r: 46 },
  { action: "right", text: "▶",  x: -270, y: -205, r: 46 },
  { action: "lunge", text: "跨", x: -330, y: -95,  r: 38 },
  { action: "jump",  text: "跳", x: 330,  y: -205, r: 50 },
  { action: "swingFar",  text: "深球", x: 405, y: -90,  r: 42 },
  { action: "swingNear", text: "短球", x: 255, y: -90,  r: 42 },
];

const RELEASE_ACTIONS: Array<BtnSpec["action"]> = ["left", "right", "jump", "lunge"];

function makeButton(spec: BtnSpec, root: Node, pad: Pad): void {
  const node = new Node(`btn-${spec.action}`);
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

  const label = node.addComponent(Label);
  label.string = spec.text;
  label.fontSize = spec.text.length > 1 ? 22 : 30;
  label.lineHeight = spec.text.length > 1 ? 26 : 34;
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
