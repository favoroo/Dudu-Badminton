// ============================================================
// 触屏虚拟按键:左下「左移/右移(双击跨步)」,右下「跳/深球/短球」。
// 和键盘映射同一套 Pad 动作语义;按钮节点由本模块程序化生成,
// 编辑器里不用摆任何东西。多指同时按不同键靠 Cocos 的节点级触摸分发。
//
// 屏幕自适应与安全区防遮挡设计:
// 1. 左侧移动簇(左/右)通过 Widget 吸附屏幕左下角,避让刘海/打孔。
// 2. 右侧击球簇(跳/短球/深球)通过 Widget 吸附屏幕右下角。
// 3. 底部留出安全边距,避免沉底或触发全面屏系统手势。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UITransform, Widget, sys, view } from "cc";
import { Pad, press, release } from "./pad";

interface BtnSpec {
  action: "left" | "right" | "jump" | "swingFar" | "swingNear";
  text: string;
  x: number; y: number;      // 相对于各自控制簇的局部坐标
  r: number;
}

const RELEASE_ACTIONS: Array<BtnSpec["action"]> = ["left", "right", "jump"];

function makeButton(spec: BtnSpec, root: Node, pad: Pad): Node {
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

  return node;
}

export function buildTouchPad(root: Node, pad: Pad): Node {
  const layer = new Node("touchpad");
  layer.layer = Layers.Enum.UI_2D;
  layer.addComponent(UITransform);

  // 全屏自适应容器
  const layerWidget = layer.addComponent(Widget);
  layerWidget.isAlignTop = true; layerWidget.top = 0;
  layerWidget.isAlignBottom = true; layerWidget.bottom = 0;
  layerWidget.isAlignLeft = true; layerWidget.left = 0;
  layerWidget.isAlignRight = true; layerWidget.right = 0;
  layer.setParent(root);

  // 获取设备安全边距(防打孔屏/刘海屏及底部全面屏横条)
  let safeLeft = 28;
  let safeRight = 28;
  let safeBottom = 20;
  try {
    const safeRect = sys.getSafeAreaRect();
    const visSize = view.getVisibleSize();
    if (safeRect && visSize.width > 0) {
      if (safeRect.x > 0) safeLeft = Math.max(safeLeft, safeRect.x + 8);
      const rightMargin = visSize.width - (safeRect.x + safeRect.width);
      if (rightMargin > 0) safeRight = Math.max(safeRight, rightMargin + 8);
      if (safeRect.y > 0) safeBottom = Math.max(safeBottom, safeRect.y + 4);
    }
  } catch {
    // 兜底使用默认安全留白
  }

  // 1. 左侧移动簇(「左」「右」)
  const leftCluster = new Node("cluster-left");
  leftCluster.layer = Layers.Enum.UI_2D;
  const leftTrans = leftCluster.addComponent(UITransform);
  leftTrans.setAnchorPoint(0, 0); // 以左下角为锚点
  leftTrans.setContentSize(220, 100);
  leftCluster.setParent(layer);

  const leftWidget = leftCluster.addComponent(Widget);
  leftWidget.isAlignLeft = true;
  leftWidget.left = safeLeft;
  leftWidget.isAlignBottom = true;
  leftWidget.bottom = safeBottom;
  leftWidget.updateAlignment();

  // 左按钮(r=44)中心在(50, 50)，右按钮(r=44)中心在(155, 50)
  makeButton({ action: "left",  text: "左", x: 50,  y: 50, r: 44 }, leftCluster, pad);
  makeButton({ action: "right", text: "右", x: 155, y: 50, r: 44 }, leftCluster, pad);

  // 2. 右侧击球簇(「短球」「深球」「跳」)
  const rightCluster = new Node("cluster-right");
  rightCluster.layer = Layers.Enum.UI_2D;
  const rightTrans = rightCluster.addComponent(UITransform);
  rightTrans.setAnchorPoint(1, 0); // 以右下角为锚点
  rightTrans.setContentSize(230, 200);
  rightCluster.setParent(layer);

  const rightWidget = rightCluster.addComponent(Widget);
  rightWidget.isAlignRight = true;
  rightWidget.right = safeRight;
  rightWidget.isAlignBottom = true;
  rightWidget.bottom = safeBottom;
  rightWidget.updateAlignment();

  // 在右簇中(锚点是(1, 0)，原点在右下角，局部坐标 x 向左为负，y 向上为正):
  // 深球(r=38): x = -48, y = 48
  // 短球(r=38): x = -146, y = 48
  // 跳(r=48): x = -60, y = 142 (略偏上方，大拇指最顺手)
  makeButton({ action: "swingFar",  text: "深球", x: -48,  y: 48,  r: 38 }, rightCluster, pad);
  makeButton({ action: "swingNear", text: "短球", x: -146, y: 48,  r: 38 }, rightCluster, pad);
  makeButton({ action: "jump",      text: "跳",   x: -60,  y: 142, r: 48 }, rightCluster, pad);

  return layer;
}
