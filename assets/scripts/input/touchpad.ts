// ============================================================
// 触屏虚拟输入层:左下「移动」+ 右下「跳/跨步/深球/短球」。
//
// 左半屏有两种模式,由 Settings.moveMode 决定:
//   "joystick" —— 一个模拟摇杆:推多少走多少,能做小碎步/缓冲/微调站位;
//   "buttons"  —— 老式「左 / 右」两个按钮,离散全速(旧用户体验,可切回)。
// 键盘永远写离散 left/right,两种模式都能兼容 —— 移动轴通过 pad.moveAxis
// 传下去,player.ts 里 moveAxis 优先、其次回落到左右键。
//
// 右侧四键保持原语义:swingFar / swingNear 击球两键(不合) + lunge 跨步 + jump 跳。
// 兄弟序即绘制/命中序,层级命中从最上层往回找,不能每次启动都变。
//
// 对局态的触摸命中收在**层节点**统一裁决(编辑态仍是逐键拖动):
// 每根手指 claim 一个 touch id,按住中滑动会重新命中 —— 「左」滑到「右」
// 不抬手直接换向,对拉快攻不用先松手;划过跨步/击球键不触发(只认按住类动作),
// 防止滑动误出球、误跨步。摇杆的 claim 独立:一根手指按住摇杆区就整段归它,
// 直到抬手,不做键间断续切换。
//
// 屏幕自适应与安全区防遮挡设计:
// 1. 左侧移动簇(摇杆 或 左/右)通过 Widget 吸附屏幕左下角,避让刘海/打孔。
// 2. 右侧操作簇(跳/跨步/短球/深球)通过 Widget 吸附屏幕右下角。
// 3. 底部留出安全边距,避免沉底或触发全面屏系统手势。
// 4. **padScale** 把整套控件按可视宽/960 的比例放大 —— 16:9 屏 scale=1.0,
//    20:9 屏 scale≈1.125,让手指与视觉密度跨机型保持一致。存档仍记「基准倍」
//    下的原始数字,渲染时才乘,换手机不会污染存档。
//
// 可自定义布局(设置页「调整位置」)存的是**簇内相对位移 dx/dy + 半径 r**,
// 不是屏幕绝对坐标:设计分辨率是 FIXED_HEIGHT —— 高恒 540、宽随长宽比变,
// 再叠加刘海内缩,A 机调好的绝对坐标到 B 机就出屏了。簇靠 Widget 吸角落,
// 位移相对簇原点,才能同时穿越两者变化。
//
// 反馈增强的三处:
//   按下 → 冲击环:同一帧画一圈外扩淡出环(alpha 220 → 0,scale 0.85 → 1.15),
//           比色变更快地告诉玩家"按到了"。
//   松手 → 过冲回弹:0.90 → 1.06 → 1.00 两段 tween,物理感更"墩"。
//   摇杆满舵 → |axis| > 0.85 时底圈描边切荧光黄,配合一次性 haptic("light")。
//
// 布局变化只改节点位置/半径,不销毁重建:重建会重置兄弟顺序(本项目的绘制
// 顺序就是有语义的兄弟序)、会在 Widget 还没给全屏层定尺寸时就 updateAlignment
// (错一帧),还会丢掉正在进行的触摸 claim。**唯一例外**是 moveMode 切换:
// 摇杆与左右键是不同的节点结构,这时会拆左簇重建,同时清掉左半的 claim。
// ============================================================
import { Color, EventTouch, Graphics, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3, Widget, sys, v3, view } from "cc";
import { Pad, press, release, resetPadHolds, setMoveAxis } from "./pad";
import {
  PAD_BASE, PAD_LIMIT, Settings,
  JOYSTICK_BASE, JOYSTICK_LIMIT,
  type MoveMode, type PadAction,
} from "../core/settings";
import { CFG } from "../core/config";
import { clamp } from "../core/utils";
import { haptic } from "../game/haptics";

/** 有按下/抬起两种状态的键;跨步键与击球键是边沿语义,抬起不动它 */
const RELEASE_ACTIONS: PadAction[] = ["left", "right", "jump"];

/**
 * 每一簇的建键顺序(照改造前的书写序,别顺手改成 PAD_ACTIONS 的顺序):
 * 兄弟序即绘制/命中序,后建的压在前一个上面。用户把两个键拖到重叠时,
 * 谁的命中优先必须由建层顺序决定,不能每次启动都变。
 * 「跨步」插在击球两键之后、「跳」之前:跳是右手最容易误碰的大键,保持它最高优先级。
 */
const CLUSTER_ORDER: Record<"left" | "right", PadAction[]> = {
  left: ["left", "right"],
  right: ["swingFar", "swingNear", "lunge", "jump"],
};

/** 顶部让开记分牌带(HUD 比分牌占 y≈203..261),按键中心不许进这一带 */
const TOP_KEEP = 150;

/** 摇杆满舵阈值:|moveAxis| 越过这个视觉与触觉都会给一次额外反馈 */
const FULL_DEFLECT = 0.85;

// ---------- 设备自适应缩放 ----------

/**
 * 触屏控件的视觉倍率:FIXED_HEIGHT 下高恒 540,宽随长宽比变。
 * 16:9 → 960 → 1.0;18:9 → 1080 → 1.125;折叠屏外屏 → 1.25 封顶。
 * 反过来小平板 4:3 → 720 → 0.9 封底,避免按钮大到糊屏。
 * 存档值仍是「基准倍」下的原始数字,渲染时才乘 —— 用户换手机不会污染存档。
 */
export function padScale(): number {
  const w = view.getVisibleSize().width;
  if (!(w > 0)) return 1;
  return clamp(w / 960, 0.9, 1.25);
}

// ---------- 视觉状态 ----------

/** hex + alpha(0..1) → cc.Color(padSkin 的值都按这个格式住 config) */
function skinColor(hex: string, a: number): Color {
  const c = new Color();
  c.fromHEX(hex);
  c.a = Math.round(clamp(a, 0, 1) * 255);
  return c;
}

interface BtnRec {
  action: PadAction;
  node: Node;
  ut: UITransform;
  g: Graphics;
  cluster: Node;
  r: number;               // 已经乘过 padScale 的当前显示半径
  pressed: boolean;
  selected: boolean;
  flash: Node;             // 冲击环子节点
  flashG: Graphics;
  flashOp: UIOpacity;
}

interface StickRec {
  cluster: Node;
  root: Node;              // 底圈(位置随 Settings.joystick.dx/dy + padScale)
  baseUt: UITransform;
  baseG: Graphics;
  knob: Node;              // 摇杆小球,root 的子节点
  knobG: Graphics;
  baseR: number;           // scaled
  knobR: number;           // scaled
  selected: boolean;
  activeTouch: number | null;
  lastFullFlag: boolean;   // 上次是否处于满舵(用来只在跨阈值瞬间触发 haptic)
}

/**
 * 统一在这里画按钮圆(按下反馈 / 选中环 / 布局重画共用一份),
 * 半径必须从 rec.r 现读 —— 老写法把 spec.r 闭包进了重画函数,r 可变后就是暗雷。
 * 配色一律读 CFG.padSkin(铁律:数值只进 config),本文件不再私藏色值。
 */
function paint(rec: BtnRec, edit: boolean): void {
  const g = rec.g;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  g.clear();
  // 深蓝玻璃底:球场透得过,按钮在亮/暗场地上都看得清(纯白 15% 会直接融进背景)
  g.fillColor = rec.pressed ? skinColor(S.downFill, S.downFillA * A) : skinColor(S.idleFill, S.idleFillA * A);
  g.strokeColor = rec.pressed ? skinColor(S.downEdge, S.downEdgeA * A) : skinColor(S.idleEdge, S.idleEdgeA * A);
  g.lineWidth = rec.pressed ? 4 : 3;
  g.circle(0, 0, rec.r);
  g.fill();
  g.stroke();
  if (edit && rec.selected) {
    // 外圈荧光黄环 = 「选中」,与按下的内亮区分开:编辑态两者可能同时成立
    g.strokeColor = skinColor(S.downEdge, 1 * A);
    g.lineWidth = 3;
    g.circle(0, 0, rec.r + 8);
    g.stroke();
  }
  // 图标跟随按下/选中态变色
  drawIcon(g, rec.action, rec.r,
    rec.pressed ? skinColor(S.downIcon, S.downIconA * A) : skinColor(S.icon, S.iconA * A));
}

/** 冲击环:按下瞬间亮一下,半径与按钮一致,alpha/scale 由 tween 驱动淡出 */
function paintFlashRing(rec: BtnRec): void {
  const g = rec.flashG;
  const S = CFG.padSkin;
  g.clear();
  g.strokeColor = skinColor(S.downEdge, 1);
  g.lineWidth = 4;
  g.circle(0, 0, rec.r);
  g.stroke();
}

function triggerFlash(rec: BtnRec): void {
  paintFlashRing(rec);
  rec.flashOp.opacity = 220;
  rec.flash.setScale(0.85, 0.85, 1);
  Tween.stopAllByTarget(rec.flash);
  Tween.stopAllByTarget(rec.flashOp);
  tween(rec.flash).to(0.18, { scale: new Vec3(1.15, 1.15, 1) }, { easing: "quadOut" }).start();
  tween(rec.flashOp).to(0.18, { opacity: 0 }).start();
}

/** 摇杆底圈:半透明玻璃 + 十字辅助线;满舵时描边变荧光黄 */
function paintStick(st: StickRec, pressed: boolean, full: boolean, edit: boolean): void {
  const g = st.baseG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  g.clear();
  g.fillColor = skinColor(S.idleFill, S.idleFillA * A * 0.55);
  g.circle(0, 0, st.baseR);
  g.fill();
  // 描边:静止 = idleEdge 半透;按下 = downEdge;满舵 = 荧光黄实线
  if (full || pressed) {
    g.strokeColor = skinColor(S.downEdge, (full ? 1 : 0.72) * A);
    g.lineWidth = full ? 4 : 3;
  } else {
    g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.7);
    g.lineWidth = 3;
  }
  g.circle(0, 0, st.baseR);
  g.stroke();
  // 内圈虚线参考(半径 baseR * 0.55),给玩家一个"推到这里算满舵"的直觉
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.28);
  g.lineWidth = 2;
  g.circle(0, 0, st.baseR * 0.6);
  g.stroke();
  if (edit && st.selected) {
    g.strokeColor = skinColor(S.downEdge, 1 * A);
    g.lineWidth = 3;
    g.circle(0, 0, st.baseR + 10);
    g.stroke();
  }
}

/** 摇杆 knob:实心圆 + 高光描边;按下更亮一点 */
function paintKnob(st: StickRec, pressed: boolean): void {
  const g = st.knobG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  g.clear();
  g.fillColor = pressed ? skinColor(S.downFill, 0.95 * A) : skinColor(S.idleFill, 0.92 * A);
  g.strokeColor = pressed ? skinColor(S.downEdge, 0.95 * A) : skinColor(S.idleEdge, 0.85 * A);
  g.lineWidth = pressed ? 4 : 3;
  g.circle(0, 0, st.knobR);
  g.fill();
  g.stroke();
  // 中点小高光,让 knob 看起来是"凸起来可以推"的实体而不是平面色块
  g.fillColor = pressed ? skinColor(S.downIcon, 0.85 * A) : skinColor(S.icon, 0.55 * A);
  g.circle(0, 0, st.knobR * 0.22);
  g.fill();
}

// ---------- 按钮图标(矢量,跟随按钮半径缩放) ----------

/**
 * 在 Graphics 原点周围画按钮图标。
 * - left / right: 箭头
 * - jump: 上箭头
 * - lunge: 左右背对背箭头 + 中缝起振线(键本身不带方向,往哪跨由方向键决定)
 * - swingFar: 粗笔高弧 + 实心球 + 力量爆发线(重击/高远球)
 * - swingNear: 细笔低弧 + 空心球 + 落地反弹弧(轻击/吊球)
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

    case "lunge": {
      // 跨步:左右两个背对背箭头 + 中间一道起振竖线。
      // 刻意不画成单个方向的箭头 —— 这个键不带方向,往哪跨由左手方向键/摇杆决定,
      // 图形先替玩家把「按住哪边/推哪侧就往哪跨」这件事说清楚。
      const s = r * 0.4;
      g.lineWidth = 6;
      g.moveTo(-s * 0.32, s * 0.78);
      g.lineTo(-s * 1.02, 0);
      g.lineTo(-s * 0.32, -s * 0.78);
      g.stroke();
      g.moveTo(s * 0.32, s * 0.78);
      g.lineTo(s * 1.02, 0);
      g.lineTo(s * 0.32, -s * 0.78);
      g.stroke();
      g.lineWidth = 4;
      g.moveTo(0, -s * 0.5);
      g.lineTo(0, s * 0.5);
      g.stroke();
      break;
    }

    case "swingFar": {
      // 重击(高远球):粗笔高弧 + 顶端实心球 + 外侧力量短线(爆发感)
      const w = r * 0.55;
      const h = r * 0.7;
      const N = 20;
      g.lineWidth = 6;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = -w + 2 * w * t;
        const y = -r * 0.15 + 4 * h * t * (1 - t);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // 顶端实心球(羽毛球)
      g.circle(w, -r * 0.15, 5);
      g.fill();
      // 力量爆发线(从球向外辐射)
      g.lineWidth = 3;
      const bx = w, by = -r * 0.15;
      const angles = [-0.9, -0.35, 0.2];
      for (const a of angles) {
        g.moveTo(bx + Math.cos(a) * 7, by + Math.sin(a) * 7);
        g.lineTo(bx + Math.cos(a) * 14, by + Math.sin(a) * 14);
        g.stroke();
      }
      break;
    }

    case "swingNear": {
      // 轻击(吊球):细笔低弧 + 空心球(轻盈) + 落地反弹小弧(过网轻落)
      const w = r * 0.55;
      const h = r * 0.38;
      const N = 16;
      g.lineWidth = 3;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = -w + 2 * w * t;
        const y = r * 0.05 + h * Math.sin(Math.PI * t);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // 落点空心圈(球轻盈落地)
      g.circle(w, r * 0.05, 4);
      g.stroke();
      // 过网轻落小弧(在落点下方)
      g.lineWidth = 2;
      g.moveTo(w + 6, r * 0.05 + 2);
      g.quadraticCurveTo(w + 10, r * 0.05 + 8, w + 14, r * 0.05 + 2);
      g.stroke();
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

/**
 * 编辑选中的槽位:PadAction 中的任一按钮、"joystick"(摇杆本体)、或 null(未选中)。
 * 编辑器与设置面板共用这一套语言。
 */
export type PadSlot = PadAction | "joystick";

export interface TouchPadOpts {
  /** 编辑实例:可拖动、只通知回调,绝不写 Pad(拖动不许打出球,也不许打出一个跨步) */
  edit?: boolean;
  onPick?(slot: PadSlot): void;
  onDrag?(slot: PadSlot, dx: number, dy: number): void;
  onDragEnd?(slot: PadSlot): void;
}

export interface TouchPadHandle {
  root: Node;
  /** 读 Settings 现值刷位置/半径/画面;幂等,可每帧调;moveMode 变了这里会拆左簇重建 */
  apply(): void;
  /** 把候选位移夹到当前视口内(拖动时夹存档值,显示时只夹显示) */
  clampDelta(slot: PadSlot, dx: number, dy: number): { dx: number; dy: number };
  /** 编辑态选中环;传 null 清空 */
  select(slot: PadSlot | null): void;
  /** 当前生效的移动方式(便于面板判断要不要显示摇杆的 chip) */
  readonly moveMode: MoveMode;
  /** 清触摸 claim 与按下的视觉状态(层被隐藏时 TOUCH_END 送不到,必须主动清) */
  clearPressed(): void;
  readonly safe: SafeMargins;
  destroy(): void;
}

/** UI 坐标 → 簇局部坐标(UI 单位即世界单位,不需要任何缩放系数) */
const tmpVec = new Vec3();
function toClusterLocal(cluster: Node, e: EventTouch): Vec3 {
  const u = e.getUILocation();
  return cluster.getComponent(UITransform)!.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
}

function makeButton(action: PadAction, cluster: Node, opts: TouchPadOpts, recs: BtnRec[], scale: number): BtnRec {
  const base = PAD_BASE[action];
  const p = Settings.padOf(action);
  const r = p.r * scale;

  const node = new Node(`btn-${action}`);
  node.layer = Layers.Enum.UI_2D;
  const ut = node.addComponent(UITransform);
  ut.setContentSize(r * 2, r * 2);
  node.setPosition((base.x + p.dx) * scale, (base.y + p.dy) * scale);
  node.setParent(cluster);

  const g = node.addComponent(Graphics);

  // 冲击环子节点:UIOpacity 淡出 + 子节点自身 scale 外扩
  const flash = new Node(`flash-${action}`);
  flash.layer = Layers.Enum.UI_2D;
  const flashUt = flash.addComponent(UITransform);
  flashUt.setContentSize(r * 2.6, r * 2.6);
  const flashG = flash.addComponent(Graphics);
  const flashOp = flash.addComponent(UIOpacity);
  flashOp.opacity = 0;
  flash.setParent(node);

  const rec: BtnRec = {
    action, node, ut, g, cluster, r, pressed: false, selected: false,
    flash, flashG, flashOp,
  };
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
      grab = { x: l.x / scale, y: l.y / scale, dx: cur.dx, dy: cur.dy };
      opts.onPick?.(action);
    });
    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.(action, grab.dx + (l.x / scale - grab.x), grab.dy + (l.y / scale - grab.y));
    });
    // 拖出按钮范围后松手走的是 TOUCH_CANCEL 而不是 TOUCH_END,两个都得收尾
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.(action);
    };
    node.on(Node.EventType.TOUCH_END, fin);
    node.on(Node.EventType.TOUCH_CANCEL, fin);
  }
  // 非编辑态不在这里挂事件:对局态的按下/滑动/换向由层节点统一裁决(见 bindPlayLayer),
  // 节点级分发做不到「手指按住左键滑到右键不抬手换向」。

  recs.push(rec);
  return rec;
}

/** 摇杆 knob 相对 baseR 的比例:手感里"手指刚好盖住小球、又能露出底圈刻度" */
const KNOB_RATIO = 0.42;

function makeJoystick(cluster: Node, opts: TouchPadOpts, scale: number): StickRec {
  const j = Settings.joystick;
  const baseR = j.r * scale;
  const knobR = baseR * KNOB_RATIO;

  const root = new Node("joystick");
  root.layer = Layers.Enum.UI_2D;
  const baseUt = root.addComponent(UITransform);
  baseUt.setContentSize(baseR * 2.6, baseR * 2.6);
  root.setPosition((JOYSTICK_BASE.x + j.dx) * scale, (JOYSTICK_BASE.y + j.dy) * scale);
  root.setParent(cluster);
  const baseG = root.addComponent(Graphics);

  const knob = new Node("knob");
  knob.layer = Layers.Enum.UI_2D;
  const knobUt = knob.addComponent(UITransform);
  knobUt.setContentSize(knobR * 2, knobR * 2);
  knob.setPosition(0, 0);
  const knobG = knob.addComponent(Graphics);
  knob.setParent(root);

  const st: StickRec = {
    cluster, root, baseUt, baseG, knob, knobG, baseR, knobR,
    selected: false, activeTouch: null, lastFullFlag: false,
  };
  paintStick(st, false, false, !!opts.edit);
  paintKnob(st, false);

  if (opts.edit) {
    // 编辑态:拖 root = 改 Settings.joystick.dx/dy。knob 事件让 root 收。
    let dragId: number | null = null;
    let grab = { x: 0, y: 0, dx: 0, dy: 0 };
    root.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (dragId !== null) return;
      dragId = e.getID();
      const l = toClusterLocal(cluster, e);
      const cur = Settings.joystick;
      grab = { x: l.x / scale, y: l.y / scale, dx: cur.dx, dy: cur.dy };
      opts.onPick?.("joystick");
    });
    root.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.("joystick", grab.dx + (l.x / scale - grab.x), grab.dy + (l.y / scale - grab.y));
    });
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.("joystick");
    };
    root.on(Node.EventType.TOUCH_END, fin);
    root.on(Node.EventType.TOUCH_CANCEL, fin);
  }

  return st;
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
  let stick: StickRec | null = null;
  let currentMode: MoveMode = Settings.moveMode;
  let currentScale = padScale();

  // 1. 左侧移动簇:按当前 moveMode 决定建摇杆还是建 left/right 两键
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

  const buildLeftSide = (): void => {
    // 拆掉上一份左簇子节点(mode 切换、scale 变化都会走这里)
    for (const rec of recs) if (PAD_BASE[rec.action].cluster === "left") rec.node.destroy();
    // filter 后保留 right 簇的 recs 原序
    for (let i = recs.length - 1; i >= 0; i--) if (PAD_BASE[recs[i].action].cluster === "left") recs.splice(i, 1);
    if (stick) { stick.root.destroy(); stick = null; }

    if (currentMode === "joystick") {
      stick = makeJoystick(leftCluster, opts, currentScale);
    } else {
      for (const a of CLUSTER_ORDER.left) makeButton(a, leftCluster, opts, recs, currentScale);
    }
  };
  buildLeftSide();

  // 2. 右侧操作簇(「短球」「深球」「跨步」「跳」)—— 永远四键,不合并
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

  for (const a of CLUSTER_ORDER.right) makeButton(a, rightCluster, opts, recs, currentScale);

  // ---------- 对局态触摸:层节点统一命中 + 滑动换向(编辑模式不挂,键只是摆给你拖) ----------
  //
  // 每根手指 claim 一个 touch id;按住中滑动会重新命中:
  //   「左」滑到「右」= 不抬手直接换向(对拉快攻省一次抬手);
  //   滑出所有键 = 松键(与旧的 TOUCH_CANCEL 自愈同语义);
  //   划过跨步/击球键不触发 —— 换向只认「按住类」动作(left/right/jump),
  //   防止手指路过右手键区凭空打出一拍、或凭空摔一次跨步。
  // 摇杆 claim 单独一等公民:一根手指一旦落到摇杆命中区,整段按住期间都归摇杆,
  // 不做按键间断续切换 —— 玩家拇指推在摇杆上时不该被"擦过边缘"打断了走位。
  type Claim = { kind: "rec"; rec: BtnRec } | { kind: "stick" };
  const claims = new Map<number, Claim>();

  const bindPlayLayer = (): void => {
    const layerTrans = layerUt;

    /** 触点 → 命中的键:兄弟序即层级,从最上层(数组尾部)往回找 */
    const hitAny = (e: EventTouch): BtnRec | null => {
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      for (let i = recs.length - 1; i >= 0; i--) {
        const rec = recs[i];
        const c = layerTrans.convertToNodeSpaceAR(rec.node.worldPosition, new Vec3());
        const dx = p.x - c.x, dy = p.y - c.y;
        if (dx * dx + dy * dy <= rec.r * rec.r) return rec;
      }
      return null;
    };

    /** 触点 → 是否在摇杆激活区(半径 baseR × 1.5 内即算,手指不必精准命中底圈) */
    const hitStick = (e: EventTouch): boolean => {
      if (!stick) return false;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(stick.root.worldPosition, new Vec3());
      const dx = p.x - c.x, dy = p.y - c.y;
      const rr = stick.baseR * 1.5;
      return dx * dx + dy * dy <= rr * rr;
    };

    /** 触点 → 摇杆局部坐标(-1..1 归一化后的水平轴,和 knob 视觉位置) */
    const readStick = (e: EventTouch): { axis: number; kx: number; ky: number } => {
      const st = stick!;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(st.root.worldPosition, new Vec3());
      let dx = p.x - c.x, dy = p.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len > st.baseR && len > 0) { dx = dx * (st.baseR / len); dy = dy * (st.baseR / len); }
      return { axis: clamp(dx / st.baseR, -1, 1), kx: dx, ky: dy };
    };

    const down = (rec: BtnRec): void => {
      rec.pressed = true;
      paint(rec, false);
      Tween.stopAllByTarget(rec.node);
      rec.node.setScale(CFG.padSkin.pressScale, CFG.padSkin.pressScale, 1);
      triggerFlash(rec);
      press(pad, rec.action);
      haptic("light");
    };
    const upOf = (rec: BtnRec): void => {
      rec.pressed = false;
      paint(rec, false);
      Tween.stopAllByTarget(rec.node);
      // 两段:先 0.9 → 1.06 再回到 1.0,过冲幅度可控、比单调 backOut 更"实"
      tween(rec.node)
        .to(0.07, { scale: new Vec3(1.06, 1.06, 1) }, { easing: "sineOut" })
        .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: "sineIn" })
        .start();
      if (RELEASE_ACTIONS.includes(rec.action)) release(pad, rec.action as "left");
    };

    const stickDown = (e: EventTouch): void => {
      const st = stick!;
      st.activeTouch = e.getID();
      const { axis, kx, ky } = readStick(e);
      st.knob.setPosition(kx, ky);
      const full = Math.abs(axis) >= FULL_DEFLECT;
      paintStick(st, true, full, false);
      paintKnob(st, true);
      setMoveAxis(pad, axis);
      if (full && !st.lastFullFlag) haptic("light");
      st.lastFullFlag = full;
    };
    const stickMove = (e: EventTouch): void => {
      const st = stick!;
      const { axis, kx, ky } = readStick(e);
      Tween.stopAllByTarget(st.knob);
      st.knob.setPosition(kx, ky);
      const full = Math.abs(axis) >= FULL_DEFLECT;
      paintStick(st, true, full, false);
      setMoveAxis(pad, axis);
      if (full && !st.lastFullFlag) haptic("light");
      st.lastFullFlag = full;
    };
    const stickUp = (): void => {
      const st = stick!;
      st.activeTouch = null;
      setMoveAxis(pad, 0);
      paintStick(st, false, false, false);
      paintKnob(st, false);
      st.lastFullFlag = false;
      // knob spring 回中:elasticOut 让"手指抬起、小球自己弹回"这件事看得见
      Tween.stopAllByTarget(st.knob);
      tween(st.knob).to(0.24, { position: new Vec3(0, 0, 0) }, { easing: "elasticOut" }).start();
    };

    layer.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      const id = e.getID();
      if (id == null || claims.has(id)) return;
      if (hitStick(e)) {
        claims.set(id, { kind: "stick" });
        stickDown(e);
        return;
      }
      const rec = hitAny(e);
      if (!rec) return;
      claims.set(id, { kind: "rec", rec });
      down(rec);
    });
    layer.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const id = e.getID();
      if (id == null) return;
      const c = claims.get(id);
      if (!c) return;
      if (c.kind === "stick") { stickMove(e); return; }
      const rec = hitAny(e);
      if (rec === c.rec) return;
      if (c.rec) upOf(c.rec);
      if (rec && RELEASE_ACTIONS.includes(rec.action)) {
        c.rec = rec;
        down(rec);
      } else {
        c.rec = null as unknown as BtnRec;    // 滑进击球键区/滑出所有键:松开但不换向
        claims.set(id, { kind: "rec", rec: c.rec });
      }
    });
    const fin = (e: EventTouch): void => {
      const id = e.getID();
      if (id == null) return;
      const c = claims.get(id);
      if (!c) return;
      claims.delete(id);
      if (c.kind === "stick") stickUp();
      else if (c.rec) upOf(c.rec);
    };
    layer.on(Node.EventType.TOUCH_END, fin);
    layer.on(Node.EventType.TOUCH_CANCEL, fin);
  };

  if (!opts.edit) bindPlayLayer();

  /** 视口半宽高:实时读层尺寸,不许写死 960×540(Widget 还没跑时用默认兜底) */
  const viewportHalf = (): { hw: number; hh: number } => {
    const w = layerUt.width, h = layerUt.height;
    return { hw: w > 0 ? w / 2 : 480, hh: h > 0 ? h / 2 : 270 };
  };

  /** 某个槽位的簇原点(左下/右下角点)在层坐标系里的位置(世界单位,已含 scale) */
  const slotCorner = (slot: PadSlot, hw: number, hh: number): { x: number; y: number } => {
    const left = slot === "joystick" ? true : PAD_BASE[slot as PadAction].cluster === "left";
    return { x: left ? -hw + safe.l : hw - safe.r, y: -hh + safe.b };
  };

  /** 槽位的默认布局基准点(世界单位,未含 scale) */
  const slotBaseXY = (slot: PadSlot): { x: number; y: number } =>
    slot === "joystick" ? { x: JOYSTICK_BASE.x, y: JOYSTICK_BASE.y } : { x: PAD_BASE[slot as PadAction].x, y: PAD_BASE[slot as PadAction].y };

  /** 位移与半径夹到当前视口内(单位:原始、未 scale) */
  const clampDelta = (slot: PadSlot, dx: number, dy: number): { dx: number; dy: number } => {
    const base = slotBaseXY(slot);
    const { hw, hh } = viewportHalf();
    const corner = slotCorner(slot, hw, hh);
    const isJoy = slot === "joystick";
    const r = (isJoy ? Settings.joystick.r : Settings.padOf(slot as PadAction).r) * currentScale;
    const limDx = isJoy ? JOYSTICK_LIMIT.maxDx : PAD_LIMIT.maxDx;
    const limDy = isJoy ? JOYSTICK_LIMIT.maxDy : PAD_LIMIT.maxDy;
    // 圆心可行域:整圆在屏内,且不进顶部记分牌带(edgePad 从 config 读)
    const edge = CFG.padSkin.edgePad;
    const lo = -hw + r + edge, hi = hw - r - edge;
    const cx = clamp(corner.x + (base.x + dx) * currentScale, Math.min(lo, hi), Math.max(lo, hi));
    const cy = clamp(corner.y + (base.y + dy) * currentScale, -hh + r + edge, hh - TOP_KEEP);
    return {
      dx: clamp(cx / currentScale - corner.x / currentScale - base.x, -limDx, limDx),
      dy: clamp(cy / currentScale - corner.y / currentScale - base.y, -limDy, limDy),
    };
  };

  const apply = (): void => {
    // 模式或设备尺寸变了 → 拆左簇重建;scale 只影响左侧摇杆与按钮渲染
    const newMode = Settings.moveMode;
    const newScale = padScale();
    if (newMode !== currentMode || Math.abs(newScale - currentScale) > 1e-3) {
      currentMode = newMode;
      currentScale = newScale;
      buildLeftSide();
      // 右簇也要跟着重画半径;右侧结构不变,直接原地刷 r / 位置
      for (const rec of recs) {
        if (PAD_BASE[rec.action].cluster !== "right") continue;
        const base = PAD_BASE[rec.action];
        const p = Settings.padOf(rec.action);
        rec.r = p.r * currentScale;
        rec.node.setPosition((base.x + p.dx) * currentScale, (base.y + p.dy) * currentScale);
        rec.ut.setContentSize(rec.r * 2, rec.r * 2);
        rec.flash.getComponent(UITransform)!.setContentSize(rec.r * 2.6, rec.r * 2.6);
        paint(rec, !!opts.edit);
      }
    } else {
      for (const rec of recs) {
        const base = PAD_BASE[rec.action];
        const p = Settings.padOf(rec.action);
        const shown = clampDelta(rec.action, p.dx, p.dy);   // 只夹显示,不动存档
        rec.r = p.r * currentScale;
        rec.node.setPosition((base.x + shown.dx) * currentScale, (base.y + shown.dy) * currentScale);
        rec.ut.setContentSize(rec.r * 2, rec.r * 2);
        rec.flash.getComponent(UITransform)!.setContentSize(rec.r * 2.6, rec.r * 2.6);
        paint(rec, !!opts.edit);
      }
      if (stick) {
        const j = Settings.joystick;
        const shown = clampDelta("joystick", j.dx, j.dy);
        stick.baseR = j.r * currentScale;
        stick.knobR = stick.baseR * KNOB_RATIO;
        stick.root.setPosition((JOYSTICK_BASE.x + shown.dx) * currentScale, (JOYSTICK_BASE.y + shown.dy) * currentScale);
        stick.baseUt.setContentSize(stick.baseR * 2.6, stick.baseR * 2.6);
        stick.knob.getComponent(UITransform)!.setContentSize(stick.knobR * 2, stick.knobR * 2);
        paintStick(stick, false, false, !!opts.edit);
        paintKnob(stick, false);
      }
    }
  };

  const select = (slot: PadSlot | null): void => {
    for (const rec of recs) {
      const on = slot !== null && slot !== "joystick" && rec.action === slot;
      if (on !== rec.selected) {
        rec.selected = on;
        paint(rec, !!opts.edit);
      }
    }
    if (stick) {
      const on = slot === "joystick";
      if (on !== stick.selected) {
        stick.selected = on;
        paintStick(stick, false, false, !!opts.edit);
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
    get moveMode(): MoveMode { return currentMode; },
    clearPressed(): void {
      claims.clear();
      for (const rec of recs) {
        if (!rec.pressed && rec.node.scale.x === 1) continue;
        rec.pressed = false;
        Tween.stopAllByTarget(rec.node);
        Tween.stopAllByTarget(rec.flashOp);
        rec.flashOp.opacity = 0;
        rec.node.setScale(1, 1, 1);
        paint(rec, !!opts.edit);
      }
      if (stick && stick.activeTouch !== null) {
        stick.activeTouch = null;
        stick.lastFullFlag = false;
        Tween.stopAllByTarget(stick.knob);
        stick.knob.setPosition(0, 0);
        paintStick(stick, false, false, !!opts.edit);
        paintKnob(stick, false);
        setMoveAxis(pad, 0);
      }
    },
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
      h.apply();               // 藏起来的这段时间里用户可能改过布局/移动方式
    } else {
      // ⚠ 关键:手指按着「左」/推着摇杆时把层 active=false,那个 TOUCH_END 就永远送不到
      // 节点,pad.left 卡在 true / moveAxis 停在最后一次推送值 → 下一局人自己往一边跑。
      // 所以「藏起来」这个动作必须顺带把所有按下状态清干净(pad 状态 + claim + 视觉)。
      this.releaseAll();
      h.clearPressed();
    }
  }

  /** 清掉所有按下状态(隐藏时自动调;切局/退出也可以直连) */
  releaseAll(): void {
    if (this.pad) resetPadHolds(this.pad);
  }
}

export const touchPad = new TouchPadController();
