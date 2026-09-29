// ============================================================
// 触屏虚拟按键:左下「左移/右移(双击跨步)」,右下「跳/深球/短球」。
// 和键盘映射同一套 Pad 动作语义;按钮节点由本模块程序化生成,
// 编辑器里不用摆任何东西。多指同时按不同键靠 Cocos 的节点级触摸分发。
//
// 屏幕自适应与安全区防遮挡设计:
// 1. 左侧移动簇(左/右)通过 Widget 吸附屏幕左下角,避让刘海/打孔。
// 2. 右侧击球簇(跳/短球/深球)通过 Widget 吸附屏幕右下角。
// 3. 底部留出安全边距,避免沉底或触发全面屏系统手势。
//
// 可自定义布局(设置页「调整位置」)存的是**簇内相对位移 dx/dy + 半径 r**,
// 不是屏幕绝对坐标:设计分辨率是 FIXED_HEIGHT —— 高恒 540、宽随长宽比变
// (16:9 是 960、20:9 是 1080),再叠加刘海内缩,A 机调好的绝对坐标到 B 机
// 就出屏了。簇靠 Widget 吸角落,位移相对簇原点,才能同时穿越两者变化。
// 显示时按当前视口夹一遍(clampDelta),但**不覆写存档值** —— 宽屏上摆到
// 边上的键,拿到窄屏上只是被推回画面内,用户回到宽屏仍是原来的位子。
//
// 布局变化只改节点位置/半径,不销毁重建:重建会重置兄弟顺序(本项目的绘制
// 顺序就是有语义的兄弟序)、会在 Widget 还没给全屏层定尺寸时就 updateAlignment
// (错一帧),还会丢掉正在进行的触摸 claim。
// ============================================================
import { Color, EventTouch, Graphics, Layers, Node, UITransform, Vec3, Widget, sys, v3, view } from "cc";
import { Pad, press, release, resetPadHolds } from "./pad";
import { PAD_BASE, PAD_LABEL, PAD_LIMIT, Settings, type PadAction } from "../core/settings";
import { clamp } from "../core/utils";

/** 有按下/抬起两种状态的键;击球键是边沿语义,抬起不动它 */
const RELEASE_ACTIONS: PadAction[] = ["left", "right", "jump"];

/**
 * 每一簇的建键顺序(照改造前的书写序,别顺手改成 PAD_ACTIONS 的顺序):
 * 兄弟序即绘制/命中序,后建的压在前一个上面。用户把两个键拖到重叠时,
 * 谁的 TOUCH_START 先被派发必须由建层顺序决定,不能每次启动都变。
 */
const CLUSTER_ORDER: Record<"left" | "right", PadAction[]> = {
  left: ["left", "right"],
  right: ["swingFar", "swingNear", "jump"],
};

/** 顶部让开记分牌带(HUD 比分牌占 y≈203..261),按键中心不许进这一带 */
const TOP_KEEP = 150;
/** 圆形按钮离屏幕边的最小间隙 */
const EDGE_PAD = 6;

// ---------- 视觉状态 ----------

interface BtnRec {
  action: PadAction;
  node: Node;
  ut: UITransform;
  g: Graphics;
  cluster: Node;
  r: number;
  pressed: boolean;
  selected: boolean;
}

/**
 * 统一在这里画圆(按下反馈 / 选中环 / 布局重画共用一份),
 * 半径必须从 rec.r 现读 —— 老写法把 spec.r 闭包进了重画函数,r 可变后就是暗雷。
 */
function paint(rec: BtnRec, edit: boolean): void {
  const g = rec.g;
  g.clear();
  // 深蓝玻璃底:球场透得过,按钮在亮/暗场地上都看得清(纯白 15% 会直接融进背景)
  g.fillColor = rec.pressed ? new Color(30, 40, 72, 200) : new Color(14, 20, 40, 170);
  g.strokeColor = rec.pressed ? new Color(255, 231, 77, 230) : new Color(255, 255, 255, 120);
  g.lineWidth = rec.pressed ? 4 : 3;
  g.circle(0, 0, rec.r);
  g.fill();
  g.stroke();
  if (edit && rec.selected) {
    // 外圈荧光黄环 = 「选中」,与按下的内亮区分开:编辑态两者可能同时成立
    g.strokeColor = new Color(255, 231, 77, 255);
    g.lineWidth = 3;
    g.circle(0, 0, rec.r + 8);
    g.stroke();
  }
  // 图标跟随按下/选中态变色
  drawIcon(g, rec.action, rec.r,
    rec.pressed ? new Color(255, 231, 77, 230) : new Color(255, 255, 255, 200));
}

// ---------- 按钮图标(矢量,跟随按钮半径缩放) ----------

/**
 * 在 Graphics 原点周围画按钮图标。
 * - left / right: 箭头
 * - jump: 上箭头
 * - swingFar: 高弧(高远球轨迹)+ 大端点
 * - swingNear: 低弧(吊球轨迹)+ 小端点
 */
function drawIcon(g: Graphics, action: PadAction, r: number, color: Color): void {
  g.strokeColor = color;
  g.fillColor = color;
  g.lineWidth = 5;
  g.lineCap = Graphics.LineCap.ROUND;
  g.lineJoin = Graphics.LineJoin.ROUND;

  switch (action) {

    case "left": {
      const s = r * 0.38;
      g.moveTo(s * 0.35, s);
      g.lineTo(-s * 0.55, 0);
      g.lineTo(s * 0.35, -s);
      g.stroke();
      break;
    }

    case "right": {
      const s = r * 0.38;
      g.moveTo(-s * 0.35, s);
      g.lineTo(s * 0.55, 0);
      g.lineTo(-s * 0.35, -s);
      g.stroke();
      break;
    }

    case "jump": {
      const s = r * 0.38;
      g.moveTo(-s, -s * 0.25);
      g.lineTo(0, s * 0.65);
      g.lineTo(s, -s * 0.25);
      g.stroke();
      break;
    }

    case "swingFar": {
      // 高弧: 高远球轨迹,弧高 ≈ 0.72r,端点大圆点
      const w = r * 0.6;
      const h = r * 0.72;
      const N = 20;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = -w + 2 * w * t;
        const y = -r * 0.12 + 4 * h * t * (1 - t);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      g.circle(-w, -r * 0.12, 4.5);
      g.fill();
      g.circle(w, -r * 0.12, 4.5);
      g.fill();
      break;
    }

    case "swingNear": {
      // 低弧: 吊球轨迹,弧高 ≈ 0.48r,端点小圆点(与深球形成对比)
      const w = r * 0.55;
      const h = r * 0.48;
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = -w + 2 * w * t;
        const y = -r * 0.08 + 4 * h * t * (1 - t);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      g.circle(-w, -r * 0.08, 3);
      g.fill();
      g.circle(w, -r * 0.08, 3);
      g.fill();
      break;
    }
  }
}

// ---------- 安全区 ----------

export interface SafeMargins { l: number; r: number; b: number }

/** 获取设备安全边距(防打孔屏/刘海屏及底部全面屏横条) */
function safeMargins(): SafeMargins {
  let l = 28, r = 28, b = 20;
  try {
    const safeRect = sys.getSafeAreaRect();
    const visSize = view.getVisibleSize();
    if (safeRect && visSize.width > 0) {
      if (safeRect.x > 0) l = Math.max(l, safeRect.x + 8);
      const rightMargin = visSize.width - (safeRect.x + safeRect.width);
      if (rightMargin > 0) r = Math.max(r, rightMargin + 8);
      if (safeRect.y > 0) b = Math.max(b, safeRect.y + 4);
    }
  } catch {
    // 兜底使用默认安全留白
  }
  return { l, r, b };
}

// ---------- 建层 ----------

export interface TouchPadOpts {
  /** 编辑实例:可拖动、只通知回调,绝不写 Pad(拖动不许打出球,也不许污染跨步计时) */
  edit?: boolean;
  onPick?(action: PadAction): void;
  onDrag?(action: PadAction, dx: number, dy: number): void;
  onDragEnd?(action: PadAction): void;
}

export interface TouchPadHandle {
  root: Node;
  /** 读 Settings 现值刷位置/半径/画面;幂等,可每帧调 */
  apply(): void;
  /** 把候选位移夹到当前视口内(拖动时夹存档值,显示时只夹显示) */
  clampDelta(action: PadAction, dx: number, dy: number): { dx: number; dy: number };
  /** 编辑态选中环;传 null 清空 */
  select(action: PadAction | null): void;
  readonly safe: SafeMargins;
  destroy(): void;
}

/** UI 坐标 → 簇局部坐标(UI 单位即世界单位,不需要任何缩放系数) */
const tmpVec = new Vec3();
function toClusterLocal(cluster: Node, e: EventTouch): Vec3 {
  const u = e.getUILocation();
  return cluster.getComponent(UITransform)!.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
}

function makeButton(action: PadAction, cluster: Node, pad: Pad, opts: TouchPadOpts, recs: BtnRec[]): BtnRec {
  const base = PAD_BASE[action];
  const p = Settings.padOf(action);
  const r = p.r;

  const node = new Node(`btn-${action}`);
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(r * 2, r * 2);
  node.setPosition(base.x + p.dx, base.y + p.dy);
  node.setParent(cluster);

  const g = node.addComponent(Graphics);

  const rec: BtnRec = { action, node, ut, g, cluster, r, pressed: false, selected: false };
  paint(rec, !!opts.edit);

  if (opts.edit) {
    // 拖动:谁先接到 TOUCH_START 谁就 claim 住这个 touch id,MOVE/END 只发给它,
    // 所以第二根手指来抢同一个键会被 dragId 挡住。
    let dragId: number | null = null;
    let grab = { x: 0, y: 0, dx: 0, dy: 0 };
    node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (dragId !== null) return;
      dragId = e.getID();
      const l = toClusterLocal(cluster, e);
      const cur = Settings.padOf(action);
      grab = { x: l.x, y: l.y, dx: cur.dx, dy: cur.dy };
      opts.onPick?.(action);
    });
    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.(action, grab.dx + (l.x - grab.x), grab.dy + (l.y - grab.y));
    });
    // 拖出按钮范围后松手走的是 TOUCH_CANCEL 而不是 TOUCH_END,两个都得收尾
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.(action);
    };
    node.on(Node.EventType.TOUCH_END, fin);
    node.on(Node.EventType.TOUCH_CANCEL, fin);
  } else {
    // 按下/松开视觉反馈:底色提亮 + 描边换荧光黄
    node.on(Node.EventType.TOUCH_START, () => {
      rec.pressed = true;
      paint(rec, false);
      press(pad, action);
    });
    const up = () => {
      rec.pressed = false;
      paint(rec, false);
      if (RELEASE_ACTIONS.includes(action)) release(pad, action as "left");
    };
    node.on(Node.EventType.TOUCH_END, up);
    node.on(Node.EventType.TOUCH_CANCEL, up);
  }

  recs.push(rec);
  return rec;
}

/**
 * 建一层虚拟按键。
 * @param root 父节点(通常是 Canvas);返回句柄,调用方**必须存住** —— 丢掉节点
 *             就没法隐藏,菜单半透明暗底下会露出按键(本次修掉的 bug 之一)。
 */
export function buildTouchPad(root: Node, pad: Pad, opts: TouchPadOpts = {}): TouchPadHandle {
  const layer = new Node(opts.edit ? "touchpad-edit" : "touchpad");
  layer.layer = Layers.Enum.UI_2D;
  const layerUt = layer.addComponent(UITransform);

  // 全屏自适应容器
  const layerWidget = layer.addComponent(Widget);
  layerWidget.isAlignTop = true; layerWidget.top = 0;
  layerWidget.isAlignBottom = true; layerWidget.bottom = 0;
  layerWidget.isAlignLeft = true; layerWidget.left = 0;
  layerWidget.isAlignRight = true; layerWidget.right = 0;
  layer.setParent(root);

  const safe = safeMargins();
  const recs: BtnRec[] = [];

  // 1. 左侧移动簇(「左」「右」)
  const leftCluster = new Node("cluster-left");
  leftCluster.layer = Layers.Enum.UI_2D;
  const leftTrans = leftCluster.addComponent(UITransform);
  leftTrans.setAnchorPoint(0, 0); // 以左下角为锚点
  leftTrans.setContentSize(220, 100);
  leftCluster.setParent(layer);

  const leftWidget = leftCluster.addComponent(Widget);
  leftWidget.isAlignLeft = true;
  leftWidget.left = safe.l;
  leftWidget.isAlignBottom = true;
  leftWidget.bottom = safe.b;
  leftWidget.updateAlignment();

  for (const a of CLUSTER_ORDER.left) makeButton(a, leftCluster, pad, opts, recs);

  // 2. 右侧击球簇(「短球」「深球」「跳」)
  const rightCluster = new Node("cluster-right");
  rightCluster.layer = Layers.Enum.UI_2D;
  const rightTrans = rightCluster.addComponent(UITransform);
  rightTrans.setAnchorPoint(1, 0); // 以右下角为锚点
  rightTrans.setContentSize(230, 200);
  rightCluster.setParent(layer);

  const rightWidget = rightCluster.addComponent(Widget);
  rightWidget.isAlignRight = true;
  rightWidget.right = safe.r;
  rightWidget.isAlignBottom = true;
  rightWidget.bottom = safe.b;
  rightWidget.updateAlignment();

  for (const a of CLUSTER_ORDER.right) makeButton(a, rightCluster, pad, opts, recs);

  /** 视口半宽高:实时读层尺寸,不许写死 960×540(Widget 还没跑时用默认兜底) */
  const viewportHalf = (): { hw: number; hh: number } => {
    const w = layerUt.width, h = layerUt.height;
    return { hw: w > 0 ? w / 2 : 480, hh: h > 0 ? h / 2 : 270 };
  };

  /** 某个键的簇原点(左下/右下角点)在层坐标系里的位置 */
  const clusterCorner = (action: PadAction, hw: number, hh: number): { x: number; y: number } => {
    const left = PAD_BASE[action].cluster === "left";
    return { x: left ? -hw + safe.l : hw - safe.r, y: -hh + safe.b };
  };

  const clampDelta = (action: PadAction, dx: number, dy: number): { dx: number; dy: number } => {
    const base = PAD_BASE[action];
    const { hw, hh } = viewportHalf();
    const corner = clusterCorner(action, hw, hh);
    const r = Settings.padOf(action).r;
    // 圆心可行域:整圆在屏内,且不进顶部记分牌带
    const lo = -hw + r + EDGE_PAD, hi = hw - r - EDGE_PAD;
    const cx = clamp(corner.x + base.x + dx, Math.min(lo, hi), Math.max(lo, hi));
    const cy = clamp(corner.y + base.y + dy, -hh + r + EDGE_PAD, hh - TOP_KEEP);
    return {
      dx: clamp(cx - corner.x - base.x, -PAD_LIMIT.maxDx, PAD_LIMIT.maxDx),
      dy: clamp(cy - corner.y - base.y, -PAD_LIMIT.maxDy, PAD_LIMIT.maxDy),
    };
  };

  const apply = (): void => {
    for (const rec of recs) {
      const base = PAD_BASE[rec.action];
      const p = Settings.padOf(rec.action);
      const shown = clampDelta(rec.action, p.dx, p.dy);   // 只夹显示,不动存档
      rec.r = p.r;
      rec.node.setPosition(base.x + shown.dx, base.y + shown.dy);
      rec.ut.setContentSize(p.r * 2, p.r * 2);
      paint(rec, !!opts.edit);
    }
  };

  const select = (action: PadAction | null): void => {
    for (const rec of recs) {
      const on = rec.action === action;
      if (on !== rec.selected) {
        rec.selected = on;
        paint(rec, !!opts.edit);
      }
    }
  };

  apply();
  // 设置页/编辑器改布局 → 两个实例(真按键 + 编辑预览)都跟着刷;
  // apply 只读不写 Settings,不会自激。
  const off = Settings.onChange(() => apply());

  return {
    root: layer,
    apply,
    clampDelta,
    select,
    safe,
    destroy(): void {
      off();
      layer.destroy();
    },
  };
}

// ============================================================
// 显隐控制器:虚拟按键只在**真正在打球**时出现。
//
// 决策放这里(由 GameRoot 每帧喂状态),不放 UIManager —— UI 不碰输入层,
// 项目既有的分层不破。设置页的「调整位置」用的是面板自己的第二个 pad 实例
// (见 buildTouchPad 的 edit 模式),所以编辑态永远进不了这条判据,
// 也不存在两份按键同屏。
// ============================================================

class TouchPadController {
  private handle: TouchPadHandle | null = null;
  private pad: Pad | null = null;
  private playing = false;

  /** GameRoot.start 调一次;重复调用是 no-op */
  mount(root: Node, pad: Pad): void {
    if (this.handle) return;
    this.pad = pad;
    this.handle = buildTouchPad(root, pad);
    this.handle.root.active = false;
  }

  /** GameRoot.update 每帧调:值没变就直接返回,不改 active */
  setPlaying(on: boolean): void {
    if (this.playing === on) return;
    this.playing = on;
    const h = this.handle;
    if (!h) return;
    h.root.active = on;
    if (on) {
      h.apply();               // 藏起来的这段时间里用户可能改过布局
    } else {
      // ⚠ 关键:手指按着「左」时把层 active=false,那个 TOUCH_END 就永远送不到
      // 节点,pad.left 卡在 true → 下一局人自己往左跑,双击跨步的计时字段也被污染。
      // 所以「藏起来」这个动作必须顺带把所有按下状态清干净。
      this.releaseAll();
    }
  }

  /** 清掉所有按下状态(隐藏时自动调;切局/退出也可以直连) */
  releaseAll(): void {
    if (this.pad) resetPadHolds(this.pad);
  }
}

export const touchPad = new TouchPadController();
