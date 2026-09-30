// ============================================================
// 触屏虚拟输入层:左下「移动 + 跳」+ 右下「跨步/深球/短球」。
//
// 左半屏有两种模式,由 Settings.moveMode 决定:
//   "joystick" —— 一个模拟摇杆:推多少走多少,能做小碎步/缓冲/微调站位;
//                 **往上推 = 起跳**(见下面「摇杆代跳」一段)。
//   "buttons"  —— 老式「左 / 右」两个按钮,离散全速(旧用户体验,可切回);
//                 没摇杆可推,跳跃退回左簇那个实体键(PAD_BASE.jump)。
// 键盘永远写离散 left/right,两种模式都能兼容 —— 移动轴通过 pad.moveAxis
// 传下去,player.ts 里 moveAxis 优先、其次回落到左右键。
//
// 摇杆代跳(为什么动垂直轴):readStick 过去只把水平 dx 交给 moveAxis,垂直分量
// 画完小球就丢了 —— 一根没人消费的轴。而"跳"本义就是往上,让左手推上去、右手
// 专管出拍,跳杀这两个必须同时发生的动作终于分到两只手上。判据是 CFG.stickJump
// 的两档迟滞(upHi 起跳 / upLo 松手),细节见 makeJoystick 里的 evalStickJump。
//
// 右侧两键:swing 击球键(合并版,滑动手势区分深浅) + lunge 跨步。
// 兄弟序即绘制/命中序,层级命中从最上层往回找,不能每次启动都变。
//
// 对局态的触摸命中收在**层节点**统一裁决(编辑态仍是逐键拖动):
// 每根手指 claim 一个 touch id,按住中滑动会重新命中 —— 「左」滑到「右」
// 不抬手直接换向,对拉快攻不用先松手;划过跨步/击球键不触发(只认按住类动作),
// 防止滑动误出球、误跨步。摇杆的 claim 独立:一根手指按住摇杆区就整段归它,
// 直到抬手,不做键间断续切换。
//
// 屏幕自适应与安全区防遮挡设计:
// 1. 左侧移动簇(摇杆 或 左/右/跳)通过 Widget 吸附屏幕左下角,避让刘海/打孔。
//    **滑轨不在这一簇里**:它要和球场 1:1 对位,而球场永远以屏幕中线为对称轴。
//    左下簇会随安全区内缩,一内缩整条轨的 x 就整体平移、对不上地面的场地线 ——
//    所以滑轨单独挂「屏幕底边中点」参考系(cluster-rail),见 railGeo()。
// 2. 右侧操作簇(跨步/短球/深球)通过 Widget 吸附屏幕右下角。
// 3. 底部留出安全边距,避免沉底或触发全面屏系统手势 —— 但这只是**默认位**,
//    玩家把控件拖到哪儿由 clampDelta 决定:唯一的约束是整块留在可视区内,
//    屏幕其余地方(包括 HUD 那一带)都能放。
// 4. **padScale** 把整套控件按可视宽/960 的比例放大 —— 16:9 屏 scale=1.0,
//    20:9 屏 scale≈1.125,让手指与视觉密度跨机型保持一致。存档仍记「基准倍」
//    下的原始数字,渲染时才乘,换手机不会污染存档。
//    **滑轨是唯一的例外**:轨的「长度」不乘 scale(球场本身不缩放),只有粗细
//    与触摸目标乘 —— 否则宽屏上轨会被拉得比球场还长,1:1 就破了。
//
// 可自定义布局(设置页「调整位置」)存的是**簇内相对位移 dx/dy + 半径 r**,
// 不是屏幕绝对坐标:设计分辨率是 FIXED_HEIGHT —— 高恒 540、宽随长宽比变,
// 再叠加刘海内缩,A 机调好的绝对坐标到 B 机就出屏了。簇靠 Widget 吸角落,
// 位移相对簇原点,才能同时穿越两者变化。
// 滑轨是这套规则里唯一被砍掉一个自由度的槽位:dx 恒 0(SLIDER_LIMIT.maxDx = 0),
// 编辑态只能上下拖 —— 横向一动,轨和脚下场地的 1:1 对位就废了。
//
// 反馈增强的四处:
//   按下 → 冲击环:同一帧画一圈外扩淡出环(alpha 220 → 0,scale 0.85 → 1.15),
//           比色变更快地告诉玩家"按到了"。
//   松手 → 过冲回弹:0.90 → 1.06 → 1.00 两段 tween,物理感更"墩"。
//   摇杆满舵 → |axis| > 0.85 时底圈描边切荧光黄,配合一次性 haptic("light")。
//   摇杆起跳 → 上推越过 upHi 时底圈上半弧点亮,同一帧 haptic:代跳没有按键,
//           不给出看得见的边界就没人能学会它。
//
// 布局变化只改节点位置/半径,不销毁重建:重建会重置兄弟顺序(本项目的绘制
// 顺序就是有语义的兄弟序)、会在 Widget 还没给全屏层定尺寸时就 updateAlignment
// (错一帧),还会丢掉正在进行的触摸 claim。**唯一例外**是 moveMode 切换:
// 摇杆与左右键是不同的节点结构,这时会拆左簇重建,同时清掉左半的 claim。
// ============================================================
import { Color, EventTouch, Graphics, Layers, Node, Tween, tween, UIOpacity, UITransform, Vec3, Widget, sys, v3, view } from "cc";
import { Pad, press, release, cancelJump, resetPadHolds, setMoveAxis, setTargetX } from "./pad";
import {
  PAD_BASE, Settings,
  JOYSTICK_BASE,
  SLIDER_BASE, railGeo,
  type MoveMode, type PadAction,
} from "../core/settings";
import { CFG } from "../core/config";
import { clamp } from "../core/utils";
import { haptic } from "../game/haptics";

/** 有按下/抬起两种状态的键;跨步键是纯边沿语义,抬起不动它。
 *  击球键(swing)需要松手检测(清理 held 态),所以也在 release 列表里。
 *  swingFar/swingNear 是键盘专用路径,触屏不建按钮,不在此列表。 */
const RELEASE_ACTIONS: PadAction[] = ["left", "right", "jump", "swing"];

/** 滑动手势阈值(像素):手指从按下点横移超过这个距离即提交方向。
 *  约为按钮半径的 1/3,够小不误触、够大有缓冲。
 *  数值搬到 config.touchAim.commitPx:同样的量要在 node 侧断言(见 reach-check 第④段),
 *  而这个文件 import cc,编译不进 tools/tsconfig.json —— 留在原地就永远测不到。 */
const SWIPE_THRESHOLD = CFG.touchAim.commitPx;

/**
 * 每一簇的建键顺序(照改造前的书写序,别顺手改成 PAD_ACTIONS 的顺序):
 * 兄弟序即绘制/命中序,后建的压在前一个上面。用户把两个键拖到重叠时,
 * 谁的命中优先必须由建层顺序决定,不能每次启动都变。
 *
 * 「跳」从左簇末尾建起(仅 buttons 模式会建它,见 buildLeftSide 的分派)。
 * 它原来住在右簇最上层,是因为要抢在击球键之前响应误碰;搬到左手之后
 * 右簇只剩三键,层级关系回到「击球 → 跨步」这一条线。
 */
const CLUSTER_ORDER: Record<"left" | "right", PadAction[]> = {
  left: ["left", "right", "jump"],
  right: ["swing", "lunge"],
};

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
  glow: number;            // 按拍预告辉光 0..1(game 层按来球逼近度每帧喂;只挂击球键)
  flash: Node;             // 冲击环子节点
  flashG: Graphics;
  flashOp: UIOpacity;
  /** 滑动手势方向(仅 swing 键用):0=未提交, 1=右滑(deep), -1=左滑(near)。paint 时据此画方向箭头 */
  swipeDir: number;
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
  /**
   * 上推代跳的迟滞状态:true = 这一段按住已经算作「正按住跳跃键」。
   * 必须有状态,不能在每帧里直接比大小 —— upHi/upLo 两档之间来回蹭时,
   * 无状态的判据会以帧率抖 press/release,而每一次 release 都触发一次 jumpCut。
   */
  jumpOn: boolean;
}

interface SliderRec {
  cluster: Node;           // cluster-rail:屏幕底边中点参考系(不是左下簇,见文件头)
  root: Node;              // 底座(x = railGeo().centerUiX 锁死,y = SLIDER_BASE.y + dy)
  baseUt: UITransform;
  baseG: Graphics;
  thumb: Node;             // 滑块,root 的子节点
  thumbG: Graphics;
  span: number;            // 滑块中心行程 = 左场可达区间长度;**不乘 scale**,与地面等长
  minX: number;            // 可达区间的世界 x 两端(与 player.ts 的夹取同源,见 railGeo)
  maxX: number;
  w: number;               // scaled 轨宽 = span + 2r(两端各让出一个滑块半径)
  h: number;               // scaled 轨高
  r: number;               // scaled 轨半高半径
  selected: boolean;
  activeTouch: number | null;
  jumpOn: boolean;
  lastTouchTime: number;   // 双击跳跃判定时钟(ms)
  lastTouchX: number;
  lastTouchY: number;
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
  // 按拍预告辉光:底色/描边/图标向档位金色拉,glow 只挂在击球两键上,其余键恒 0。
  // 手工通道插值(shim 的 Color 没有 lerp):连 alpha 一起抬,视觉就是「按键整体变亮」。
  const glow = rec.glow;
  const mix = (hex: string, a: number, t: number): Color => {
    const c = skinColor(hex, a);
    if (t <= 0) return c;
    const to = skinColor(CFG.colors.sweet.gold, 1);
    c.r += (to.r - c.r) * t;
    c.g += (to.g - c.g) * t;
    c.b += (to.b - c.b) * t;
    c.a += (to.a - c.a) * t;
    return c;
  };
  g.clear();
  g.fillColor = rec.pressed ? mix(S.downFill, S.downFillA * A, glow * 0.4) : mix(S.idleFill, S.idleFillA * A, glow * 0.55);
  g.strokeColor = rec.pressed ? mix(S.downEdge, S.downEdgeA * A, glow * 0.6) : mix(S.idleEdge, S.idleEdgeA * A, glow);
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
    mix(rec.pressed ? S.downIcon : S.icon, (rec.pressed ? S.downIconA : S.iconA) * A, glow * 0.7));
  // 滑动手势反馈(仅 swing 键):已提交方向时画一道方向色弧
  if (rec.action === "swing" && rec.swipeDir !== 0) {
    const hex = rec.swipeDir > 0 ? CFG.colors.sweet.gold : CFG.colors.sweet.neonCyan;
    g.strokeColor = skinColor(hex, 0.9 * A);
    g.lineWidth = 5;
    const a0 = rec.swipeDir > 0 ? -0.9 : Math.PI - 0.9;
    const a1 = rec.swipeDir > 0 ? 0.9 : Math.PI + 0.9;
    g.arc(0, 0, rec.r - 4, a0, a1, false);
    g.stroke();
  }
}

/** 冲击环:按下瞬间亮一下,半径与按钮一致,alpha/scale 由 tween 驱动淡出;hex 传入档位色(甜蜜/完美辉光复用同一子节点) */
function paintFlashRing(rec: BtnRec, hex?: string): void {
  const g = rec.flashG;
  const S = CFG.padSkin;
  g.clear();
  g.strokeColor = hex ? skinColor(hex, 1) : skinColor(S.downEdge, 1);
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

/**
 * 档位辉光:甜蜜/完美命中时击球键闪一圈档位色环 + 键身轻弹。
 * 与 triggerFlash(按下冲击环)刻意不同节奏 —— 一个说「我按到了」,
 * 一个说「这一拍打准了」。色值读 CFG.colors.sweet(铁律:数值只进 config)。
 */
function triggerGlow(rec: BtnRec, hex: string, strong: boolean): void {
  paintFlashRing(rec, hex);
  rec.flashOp.opacity = 255;
  rec.flash.setScale(1, 1, 1);
  Tween.stopAllByTarget(rec.flash);
  Tween.stopAllByTarget(rec.flashOp);
  const dur = strong ? 0.42 : 0.28;
  const spread = strong ? 1.6 : 1.3;
  tween(rec.flash).to(dur, { scale: new Vec3(spread, spread, 1) }, { easing: "quadOut" }).start();
  tween(rec.flashOp).to(dur, { opacity: 0 }).start();
  // 键身轻弹只在不被手指按住时做:按住态的 pressScale 缩放归 upOf 管,别抢
  if (!rec.pressed) {
    Tween.stopAllByTarget(rec.node);
    const s = strong ? 1.14 : 1.08;
    tween(rec.node)
      .to(0.08, { scale: new Vec3(s, s, 1) }, { easing: "quadOut" })
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: "sineIn" })
      .start();
  }
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
  // 起跳分界线:摇杆代跳没有按键,不把「推过这里就跳」画出来没人学得会。
  // 画的是这条弦在底圈内的弦段(端点由坐标直接算),不用 arc —— arc 的角度
  // 旋向在 UI 层 y 轴向上/向下约定下容易反,画错半圈就成了「往下推才跳」。
  const J = CFG.stickJump;
  const jy = st.baseR * J.upHi;
  const jw = Math.sqrt(Math.max(0, st.baseR * st.baseR - jy * jy));
  g.strokeColor = skinColor(S.downEdge, (st.jumpOn ? 0.95 : 0.3) * A);
  g.lineWidth = st.jumpOn ? 5 : 2;
  g.moveTo(-jw, jy);
  g.lineTo(jw, jy);
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

/** 滑轨底座:胶囊型滑道(与左半场 1:1 对位)+ 真实场地线刻度 + 上滑起跳提示箭头 */
function paintSliderTrack(st: SliderRec, pressed: boolean, edit: boolean): void {
  const g = st.baseG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  const CO = CFG.court;
  const w = st.w, h = st.h, r = st.r;
  g.clear();

  // 底轨背景
  g.fillColor = skinColor(S.idleFill, S.idleFillA * A * 0.55);
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();

  // 描边:按下时高亮
  if (pressed) {
    g.strokeColor = skinColor(S.downEdge, 0.88 * A);
    g.lineWidth = 3;
  } else {
    g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.7);
    g.lineWidth = 2;
  }
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.stroke();

  // 刻度 = 脚下的真实场地线。轨与球场 1:1 对位后,世界 x 平移一下就能直接落笔,
  // 所以这里不再按轨宽取百分比(老那套假刻度对不上地面的任何一条线)。
  // 判读方式很简单:滑块停在哪条线上,人就站在那条线的正下方。
  const centerWorldX = (st.minX + st.maxX) / 2;   // 轨心脚下的世界 x
  const tick = (worldX: number, half: number): void => {
    const x = worldX - centerWorldX;
    g.moveTo(x, -half); g.lineTo(x, half); g.stroke();
  };
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.42);
  g.lineWidth = 1.5;
  tick(CO.left, r * 0.45);            // 我方底线
  tick(CO.shortServeL, r * 0.45);     // 前发球线
  // 球网:更粗更亮、画得更满 —— 它是「再往右也过不去」的那道墙
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.78);
  g.lineWidth = 3;
  tick(CO.netX, r * 0.74);
  // 可达端点(滑块行程的两个极限,即 wallL 与 netX-netPad):贴着轨上下缘的短横档,
  // 和「场地线」那种通高竖线区分开,免得右端三道线糊成一坨看不出谁是谁。
  g.strokeColor = skinColor(S.idleEdge, S.idleEdgeA * A * 0.5);
  g.lineWidth = 2;
  for (const lim of [st.minX, st.maxX]) {
    const x = lim - centerWorldX;
    g.moveTo(x, -r * 0.95); g.lineTo(x, -r * 0.6); g.stroke();
    g.moveTo(x, r * 0.6);  g.lineTo(x, r * 0.95);  g.stroke();
  }

  // 顶部起跳手势指引(小上箭头):越过起跳阈值时高亮
  const jumpArrowY = r + 6;
  g.strokeColor = skinColor(S.downEdge, (st.jumpOn ? 0.95 : 0.35) * A);
  g.lineWidth = st.jumpOn ? 3.5 : 2;
  g.moveTo(-7, jumpArrowY);
  g.lineTo(0, jumpArrowY + 6);
  g.lineTo(7, jumpArrowY);
  g.stroke();

  if (edit && st.selected) {
    g.strokeColor = skinColor(S.downEdge, 1 * A);
    g.lineWidth = 3;
    g.roundRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16, r + 8);
    g.stroke();
  }
}

/** 滑轨 thumb:高光滑块 + 抓手手感刻线 */
function paintSliderThumb(st: SliderRec, pressed: boolean): void {
  const g = st.thumbG;
  const S = CFG.padSkin;
  const A = Settings.padAlpha;
  const tr = st.r * 0.88;
  g.clear();

  g.fillColor = pressed ? skinColor(S.downFill, 0.96 * A) : skinColor(S.idleFill, 0.92 * A);
  g.strokeColor = pressed ? skinColor(S.downEdge, 0.98 * A) : skinColor(S.idleEdge, 0.88 * A);
  g.lineWidth = pressed ? 3.5 : 2.5;
  g.circle(0, 0, tr);
  g.fill();
  g.stroke();

  // 抓手微刻线(3 条坚向微细线,暗示手指可左右滑动)
  g.strokeColor = pressed ? skinColor(S.downIcon, 0.9 * A) : skinColor(S.icon, 0.6 * A);
  g.lineWidth = 2;
  const lh = tr * 0.45;
  g.moveTo(-4, -lh); g.lineTo(-4, lh); g.stroke();
  g.moveTo(0, -lh);  g.lineTo(0, lh);  g.stroke();
  g.moveTo(4, -lh);  g.lineTo(4, lh);  g.stroke();
}

// ---------- 按钮图标(矢量,跟随按钮半径缩放) ----------

/**
 * 在 Graphics 原点周围画按钮图标。
 * - left / right: 箭头
 * - jump: 上箭头
 * - lunge: 左右背对背箭头 + 中缝起振线(键本身不带方向,往哪跨由方向键决定)
 * - swing: 中性羽毛球图标 + 左右方向提示箭头(右滑=深球,左滑=短球)
 * - swingFar / swingNear: 旧图标(触屏不再建按钮,留给类型完备性)
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

    case "swing": {
      // 合并击球键:中性球拍图标 + 左右淡色方向提示(右滑=深球金,左滑=短球绿)
      // 中心画一个羽毛球轮廓 + 两侧三角箭头暗示滑动方向
      const s = r * 0.3;
      // 羽毛球(中心圆 + 放射线)
      g.lineWidth = 3;
      g.circle(0, 0, s);
      g.stroke();
      g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.moveTo(s * 0.35 * Math.cos(a), s * 0.35 * Math.sin(a));
        g.lineTo(s * Math.cos(a), s * Math.sin(a));
        g.stroke();
      }
      // 左右方向提示箭头(小三角,暗示可滑动)
      const aw = r * 0.14;
      const ax = r * 0.55;
      g.lineWidth = 2;
      // 左箭头(短球方向)
      g.moveTo(-ax + aw, -aw);
      g.lineTo(-ax - aw * 0.3, 0);
      g.lineTo(-ax + aw, aw);
      g.stroke();
      // 右箭头(深球方向)
      g.moveTo(ax - aw, -aw);
      g.lineTo(ax + aw * 0.3, 0);
      g.lineTo(ax - aw, aw);
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
 * 编辑选中的槽位:PadAction 中的任一按钮、"joystick"(摇杆本体)、"slider"(滑轨本体)、或 null(未选中)。
 * 编辑器与设置面板共用这一套语言。
 */
export type PadSlot = PadAction | "joystick" | "slider";

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
  /** 甜蜜/完美命中 → 击球两键档位辉光(只由 GameRoot 在真人自己打出好球时调) */
  pulseSwing(tier: "sweet" | "perfect"): void;
  /**
   * 按拍预告辉光:0..1,game 层按「来球距最佳按拍时刻的逼近度」每帧喂。
   * 只重画击球两键,电平变化 <0.02 跳过重画,不来球时恒 0(无重画开销)。
   */
  setSwingGlow(level: number): void;
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
    action, node, ut, g, cluster, r, pressed: false, selected: false, glow: 0,
    flash, flashG, flashOp, swipeDir: 0,
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
    selected: false, activeTouch: null, lastFullFlag: false, jumpOn: false,
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
 * 建滑轨。参考系是 cluster-rail 的原点 = **屏幕底边中点**(不是左下簇,原因见文件头),
 * 局部单位就是设计像素:轨的 x/长度一律不乘 scale,只有粗细 r 与触摸目标乘。
 */
function makeSlider(cluster: Node, opts: TouchPadOpts, scale: number): SliderRec {
  const s = Settings.slider;
  const G = railGeo();
  const r = s.r * scale;
  const h = r * 2;
  const w = G.span + r * 2;

  const root = new Node("slider-ctrl");
  root.layer = Layers.Enum.UI_2D;
  const baseUt = root.addComponent(UITransform);
  baseUt.setContentSize(w + 32, h + 32);
  root.setPosition(G.centerUiX, SLIDER_BASE.y + s.dy);
  root.setParent(cluster);
  const baseG = root.addComponent(Graphics);

  const thumb = new Node("thumb");
  thumb.layer = Layers.Enum.UI_2D;
  const thumbUt = thumb.addComponent(UITransform);
  thumbUt.setContentSize(r * 2.2, r * 2.2);
  thumb.setPosition(0, 0);
  const thumbG = thumb.addComponent(Graphics);
  thumb.setParent(root);

  const st: SliderRec = {
    cluster, root, baseUt, baseG, thumb, thumbG,
    span: G.span, minX: G.minX, maxX: G.maxX, w, h, r,
    selected: false, activeTouch: null, jumpOn: false,
    lastTouchTime: 0, lastTouchX: 0, lastTouchY: 0,
  };
  paintSliderTrack(st, false, !!opts.edit);
  paintSliderThumb(st, false);

  if (opts.edit) {
    // 编辑态拖动:簇局部单位 == 设计像素,所以这里**不除 scale**(按钮那套要除,
    // 因为它们的存档是「基准倍」下的数字;轨的 y 本来就是屏幕像素)。
    // 横向被 clampDelta 夹回 0,拖不动是设计而不是 bug。
    let dragId: number | null = null;
    let grab = { x: 0, y: 0, dy: 0 };
    root.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      if (dragId !== null) return;
      dragId = e.getID();
      const l = toClusterLocal(cluster, e);
      grab = { x: l.x, y: l.y, dy: Settings.slider.dy };
      opts.onPick?.("slider");
    });
    root.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      const l = toClusterLocal(cluster, e);
      opts.onDrag?.("slider", 0, grab.dy + (l.y - grab.y));
    });
    const fin = (e: EventTouch) => {
      if (e.getID() !== dragId) return;
      dragId = null;
      opts.onDragEnd?.("slider");
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
  let slider: SliderRec | null = null;
  let currentMode: MoveMode = Settings.moveMode;
  let currentScale = padScale();

  // 1. 左侧移动簇:按当前 moveMode 决定建摇杆,还是建 left/right/jump 三键。
  //    摇杆模式下不建跳跃键 —— 往上推摇杆就是跳(见 CFG.stickJump),没有实体键可摆。
  //    slider 模式这一簇是空的,轨住在下面的 cluster-rail 里(见 1b)。
  const leftCluster = new Node("cluster-left");
  leftCluster.layer = Layers.Enum.UI_2D;
  const leftTrans = leftCluster.addComponent(UITransform);
  leftTrans.setAnchorPoint(0, 0); // 以左下角为锚点
  // 220×100 只够 buttons 模式的左右两键;跳跃键基准位 (188,172) 带 48 半径会伸到
  // 236×220,按它取整。注意这只影响节点包围盒 —— 拖动夹取走的是全屏世界坐标
  // (slotCorner 用 -hw+safe.l),不依赖这个尺寸。
  leftTrans.setContentSize(240, 230);
  leftCluster.setParent(layer);

  const leftWidget = leftCluster.addComponent(Widget);
  leftWidget.isAlignLeft = true;
  leftWidget.left = safe.l;
  leftWidget.isAlignBottom = true;
  leftWidget.bottom = safe.b;
  leftWidget.updateAlignment();

  // 1b. 滑轨专用参考系:原点落在**屏幕底边中点**。
  //     滑轨是左半场在地面上的投影,而球场永远以屏幕中线为对称轴、且不随 padScale
  //     横向拉伸 —— 所以它不能住在会随刘海内缩的左下簇里(一内缩整条轨就平移,
  //     对不上脚下的场地线)。水平居中 + 吸底,轨心 x 才能直接等于 railGeo().centerUiX。
  const railCluster = new Node("cluster-rail");
  railCluster.layer = Layers.Enum.UI_2D;
  const railTrans = railCluster.addComponent(UITransform);
  railTrans.setAnchorPoint(0.5, 0);   // 原点 = 屏幕底边中点(尺寸只够 Widget 定位用)
  railTrans.setContentSize(2, 2);
  railCluster.setParent(layer);

  const railWidget = railCluster.addComponent(Widget);
  railWidget.isAlignHorizontalCenter = true;
  railWidget.horizontalCenter = 0;
  railWidget.isAlignBottom = true;
  railWidget.bottom = safe.b;
  railWidget.updateAlignment();

  const buildLeftSide = (): void => {
    // 拆掉上一份左簇子节点(mode 切换、scale 变化都会走这里)
    for (const rec of recs) if (PAD_BASE[rec.action].cluster === "left") rec.node.destroy();
    // filter 后保留 right 簇的 recs 原序
    for (let i = recs.length - 1; i >= 0; i--) if (PAD_BASE[recs[i].action].cluster === "left") recs.splice(i, 1);
    if (stick) { stick.root.destroy(); stick = null; }
    if (slider) { slider.root.destroy(); slider = null; }   // 轨本体拆,cluster-rail 这个参考系留着

    if (currentMode === "joystick") {
      stick = makeJoystick(leftCluster, opts, currentScale);
    } else if (currentMode === "slider") {
      slider = makeSlider(railCluster, opts, currentScale);
    } else {
      for (const a of CLUSTER_ORDER.left) makeButton(a, leftCluster, opts, recs, currentScale);
    }
  };
  buildLeftSide();

  // 2. 右侧操作簇(「击球」「跨步」)—— 两键(原深球+短球已合并为单击球键)。
  //    跳跃原来也在这里,和击球键挤同一只拇指,跳杀按不出来;现在归左手了。
  const rightCluster = new Node("cluster-right");
  rightCluster.layer = Layers.Enum.UI_2D;
  const rightTrans = rightCluster.addComponent(UITransform);
  rightTrans.setAnchorPoint(1, 0); // 以右下角为锚点
  rightTrans.setContentSize(200, 190);
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
  // 摇杆模式下左簇没有实体键(跳跃改由上推代跳),所以这里不存在"键压在摇杆 1.5R
  // 捕获盘上谁优先"的问题;buttons 模式则根本没有摇杆,stick === null。
  // 击球键(swing)是 sticky claim:一旦按下,手指横滑离开按钮中心也不换键,
  // 直到 TOUCH_END 才释放 —— 给滑动手势留出完整的操作空间。
  // startX/Y 记录按下位置,用于计算滑动 delta 提交方向。
  type Claim = { kind: "rec"; rec: BtnRec; startX: number; startY: number } | { kind: "stick" } | { kind: "slider" };
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

    /**
     * 触点 → 是否在滑轨激活区。
     * 轨现在是「你这一半场底部的一条投影带」,横向整条都收手指 —— 不必先瞄准胶囊
     * 才能站位,落点由 readSlider 夹进可达区间,所以过网那一点点也不会跑出界。
     * 上方多留一截是给「上滑起跳」留的余量。
     */
    const hitSlider = (e: EventTouch): boolean => {
      if (!slider) return false;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(slider.root.worldPosition, new Vec3());
      const dx = p.x - c.x, dy = p.y - c.y;
      const hw = slider.w / 2 + 16, hh = slider.h / 2 + 36;
      return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
    };

    /**
     * 触点 → 摇杆局部量。
     * axis = 归一化水平轴(交给 moveAxis);up = 归一化**上推量**(0..1,交给代跳判据);
     * kx/ky = 夹在底圈内的 knob 视觉位置。
     * UI 节点空间 y 向上,所以拇指往上推时 dy>0 —— up 取正半轴,下拉恒为 0。
     */
    const readStick = (e: EventTouch): { axis: number; up: number; kx: number; ky: number } => {
      const st = stick!;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(st.root.worldPosition, new Vec3());
      let dx = p.x - c.x, dy = p.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len > st.baseR && len > 0) { dx = dx * (st.baseR / len); dy = dy * (st.baseR / len); }
      return { axis: clamp(dx / st.baseR, -1, 1), up: clamp(dy / st.baseR, 0, 1), kx: dx, ky: dy };
    };

    /**
     * 触点 → 滑轨局部量 + 目标世界 x。
     *
     * 这里**故意没有归一化那一步**:轨心就钉在可达区间中点的正下方,而 FIXED_HEIGHT
     * 下 1 UI 像素 == 1 世界像素(世界层挂屏幕中心、不横向拉伸;击球瞬间的镜头 punch
     * 只是临时放大画面,不改逻辑坐标),所以「手指的屏幕 x + world.w/2」直接就是
     * 「脚下该站的世界 x」。手指挪 1px = 人挪 1px,人永远停在手指正上方那条竖线上。
     * 老写法把轨宽归一化成 0..1 再铺满可达区间:220px 的轨摊 426px 的地面 ≈ 1.94 倍
     * 放大,想微调 20px 站位得先心算手指该挪 10px —— 挂着"精准"名号的模式反而最不准。
     */
    const readSlider = (e: EventTouch): { targetX: number; thumbX: number; dy: number } => {
      const st = slider!;
      const u = e.getUILocation();
      const p = layerTrans.convertToNodeSpaceAR(v3(u.x, u.y, 0), tmpVec);
      const c = layerTrans.convertToNodeSpaceAR(st.root.worldPosition, new Vec3());
      const dx = p.x - c.x, dy = p.y - c.y;
      const thumbX = clamp(dx, -st.span / 2, st.span / 2);
      const targetX = clamp(c.x + thumbX + CFG.world.w / 2, st.minX, st.maxX);
      return { targetX, thumbX, dy };
    };

    const down = (rec: BtnRec): void => {
      rec.pressed = true;
      if (rec.action === "swing") rec.swipeDir = 0;  // 新按下重置手势
      paint(rec, false);
      Tween.stopAllByTarget(rec.node);
      rec.node.setScale(CFG.padSkin.pressScale, CFG.padSkin.pressScale, 1);
      triggerFlash(rec);
      press(pad, rec.action);
      haptic("light");
    };
    const upOf = (rec: BtnRec): void => {
      rec.pressed = false;
      if (rec.action === "swing") rec.swipeDir = 0;  // 松手清视觉反馈
      paint(rec, false);
      Tween.stopAllByTarget(rec.node);
      // 两段:先 0.9 → 1.06 再回到 1.0,过冲幅度可控、比单调 backOut 更"实"
      tween(rec.node)
        .to(0.07, { scale: new Vec3(1.06, 1.06, 1) }, { easing: "sineOut" })
        .to(0.08, { scale: new Vec3(1, 1, 1) }, { easing: "sineIn" })
        .start();
      if (RELEASE_ACTIONS.includes(rec.action)) release(pad, rec.action as "left");
    };

    /**
     * 击球键滑动手势跟踪:手指从按下点横移超过 SWIPE_THRESHOLD 即提交方向。
     * 右滑 → deep(1),左滑 → near(-1)。提交后写入 pad.swingSwipe,player.ts 在
     * 命中前读取。同时更新 rec.swipeDir 触发方向色弧视觉反馈。
     */
    const trackSwingSwipe = (rec: BtnRec, sx: number, sy: number, e: EventTouch): void => {
      const u = e.getUILocation();
      const dx = u.x - sx;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      const dir = dx > 0 ? 1 : -1;
      if (rec.swipeDir === dir) return;   // 已提交同方向,不重复刷
      rec.swipeDir = dir;
      pad.swingSwipe = dir;
      paint(rec, false);
      haptic("light");
    };

    /**
     * 上推代跳的两档迟滞判据(阈值见 CFG.stickJump)。
     * 只在真的越过档位边缘时才动 pad —— 停在 upLo..upHi 的迟滞带里既不 press 也不
     * release;否则一次抖动就是一对 press/release,而每一次 release 都带着 jumpCut,
     * 跳会既起不来又升不高。
     * 快甩(flick)不需要单独的角速度判定:它的输入时长天然就短,release 时由
     * pad.ts 的 tapCommitFrames 补一段 held 撑到顶点成为一个真跳。
     */
    const evalStickJump = (st: StickRec, up: number): void => {
      const J = CFG.stickJump;
      if (!st.jumpOn && up >= J.upHi) {
        st.jumpOn = true;
        press(pad, "jump");
        haptic("light");
      } else if (st.jumpOn && up <= J.upLo) {
        st.jumpOn = false;
        release(pad, "jump");
      }
    };

    const evalSliderJump = (st: SliderRec, dy: number): void => {
      const SC = CFG.sliderControl;
      if (!st.jumpOn && dy >= SC.jumpSwipeUpY) {
        st.jumpOn = true;
        press(pad, "jump");
        haptic("light");
      } else if (st.jumpOn && dy <= SC.jumpSwipeUpLoY) {
        st.jumpOn = false;
        release(pad, "jump");
      }
    };

    const stickDown = (e: EventTouch): void => {
      const st = stick!;
      st.activeTouch = e.getID();
      const { axis, up, kx, ky } = readStick(e);
      st.knob.setPosition(kx, ky);
      const full = Math.abs(axis) >= FULL_DEFLECT;
      evalStickJump(st, up);          // 先判跳跃再画:底圈那条分界线要跟着一起亮
      paintStick(st, true, full, false);
      paintKnob(st, true);
      setMoveAxis(pad, axis);
      if (full && !st.lastFullFlag) haptic("light");
      st.lastFullFlag = full;
    };
    const stickMove = (e: EventTouch): void => {
      const st = stick!;
      const { axis, up, kx, ky } = readStick(e);
      Tween.stopAllByTarget(st.knob);
      st.knob.setPosition(kx, ky);
      const full = Math.abs(axis) >= FULL_DEFLECT;
      evalStickJump(st, up);
      paintStick(st, true, full, false);
      setMoveAxis(pad, axis);
      if (full && !st.lastFullFlag) haptic("light");
      st.lastFullFlag = full;
    };
    const stickUp = (): void => {
      const st = stick!;
      st.activeTouch = null;
      // 抬手 = 松跳跃键。短按会被 pad.ts 补成完整一跳,推够久再松的仍然收得住高度。
      if (st.jumpOn) { st.jumpOn = false; release(pad, "jump"); }
      setMoveAxis(pad, 0);
      paintStick(st, false, false, false);
      paintKnob(st, false);
      st.lastFullFlag = false;
      // knob spring 回中:elasticOut 让"手指抬起、小球自己弹回"这件事看得见
      Tween.stopAllByTarget(st.knob);
      tween(st.knob).to(0.24, { position: new Vec3(0, 0, 0) }, { easing: "elasticOut" }).start();
    };

    const sliderDown = (e: EventTouch): void => {
      const st = slider!;
      st.activeTouch = e.getID();
      const u = e.getUILocation();
      const now = Date.now();
      const SC = CFG.sliderControl;

      // 双击跳跃判定
      const dt = now - st.lastTouchTime;
      const dist = Math.hypot(u.x - st.lastTouchX, u.y - st.lastTouchY);
      if (dt > 40 && dt <= SC.doubleTapWindowMs && dist <= SC.doubleTapMaxDist) {
        st.jumpOn = true;
        press(pad, "jump");
        haptic("light");
        st.lastTouchTime = 0; // 消费本次双击
      } else {
        st.lastTouchTime = now;
        st.lastTouchX = u.x;
        st.lastTouchY = u.y;
      }

      const { targetX, thumbX, dy } = readSlider(e);
      st.thumb.setPosition(thumbX, 0);
      evalSliderJump(st, dy);

      paintSliderTrack(st, true, false);
      paintSliderThumb(st, true);
      setTargetX(pad, targetX);
    };

    const sliderMove = (e: EventTouch): void => {
      const st = slider!;
      const { targetX, thumbX, dy } = readSlider(e);
      Tween.stopAllByTarget(st.thumb);
      st.thumb.setPosition(thumbX, 0);

      evalSliderJump(st, dy);

      paintSliderTrack(st, true, false);
      setTargetX(pad, targetX);
    };

    const sliderUp = (): void => {
      const st = slider!;
      st.activeTouch = null;
      if (st.jumpOn) {
        st.jumpOn = false;
        release(pad, "jump");
      }
      paintSliderTrack(st, false, false);
      paintSliderThumb(st, false);
    };

    layer.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      const id = e.getID();
      if (id == null || claims.has(id)) return;
      if (hitStick(e)) {
        claims.set(id, { kind: "stick" });
        stickDown(e);
        return;
      }
      if (hitSlider(e)) {
        claims.set(id, { kind: "slider" });
        sliderDown(e);
        return;
      }
      const rec = hitAny(e);
      if (!rec) return;
      const u = e.getUILocation();
      claims.set(id, { kind: "rec", rec, startX: u.x, startY: u.y });
      down(rec);
    });
    layer.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const id = e.getID();
      if (id == null) return;
      const c = claims.get(id);
      if (!c) return;
      if (c.kind === "stick") { stickMove(e); return; }
      if (c.kind === "slider") { sliderMove(e); return; }
      // 击球键 sticky:按下后手指横滑不换键,只跟踪手势方向
      if (c.rec && c.rec.action === "swing") {
        trackSwingSwipe(c.rec, c.startX, c.startY, e);
        return;
      }
      const rec = hitAny(e);
      if (rec === c.rec) return;
      if (c.rec) upOf(c.rec);
      if (rec && RELEASE_ACTIONS.includes(rec.action)) {
        c.rec = rec;
        down(rec);
      } else {
        c.rec = null as unknown as BtnRec;    // 滑出所有键:松开但不换向
        claims.set(id, { kind: "rec", rec: c.rec, startX: 0, startY: 0 });
      }
    });
    const fin = (e: EventTouch): void => {
      const id = e.getID();
      if (id == null) return;
      const c = claims.get(id);
      if (!c) return;
      claims.delete(id);
      if (c.kind === "stick") stickUp();
      else if (c.kind === "slider") sliderUp();
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

  /** 某个槽位的簇原点(左下/右下角点)在层坐标系里的位置(世界单位,已含 scale)。
   *  slider 不走这里 —— 它的参考系是屏幕底边中点,见 clampRailDelta。 */
  const slotCorner = (slot: PadSlot, hw: number, hh: number): { x: number; y: number } => {
    const left = slot === "joystick" ? true : PAD_BASE[slot as PadAction].cluster === "left";
    return { x: left ? -hw + safe.l : hw - safe.r, y: -hh + safe.b };
  };

  /** 槽位的默认布局基准点(世界单位,未含 scale);slider 同上,不走这里 */
  const slotBaseXY = (slot: PadSlot): { x: number; y: number } => {
    if (slot === "joystick") return { x: JOYSTICK_BASE.x, y: JOYSTICK_BASE.y };
    return { x: PAD_BASE[slot as PadAction].x, y: PAD_BASE[slot as PadAction].y };
  };

  /**
   * 滑轨的位移夹取:只有「上下」这一维。
   * 参考系 = 屏幕底边中点,单位 = 设计像素(不乘 scale —— 和球场同一把尺)。
   * dx 一律回 0:轨与球场 1:1 对位之后,横向一动就对不上脚下的场地线,
   * 「手指在哪人就在哪」这个承诺当场作废,所以这一维不是留给用户调的。
   * 纵向唯一约束 = 整条轨留在可视区内(上下都留 edgePad),不再预留顶部记分牌带。
   */
  const clampRailDelta = (dy: number): { dx: number; dy: number } => {
    const { hh } = viewportHalf();
    const r = Settings.slider.r * currentScale;
    const edge = CFG.padSkin.edgePad;
    const lo = r + edge, hi = Math.max(lo, 2 * hh - r - edge);
    const yBottom = clamp(safe.b + SLIDER_BASE.y + dy, lo, hi);
    return {
      dx: 0,
      dy: yBottom - safe.b - SLIDER_BASE.y,
    };
  };

  /**
   * 槽位可放区域的唯一约束:整块控件留在可视区内(四周各留 edgePad)。
   * 以前还额外预留过一条「顶部记分牌带」(按键中心不许进 y>120 那一带),
   * 用户要的是「能放到任意位置」,所以那道保留带已经去掉 —— 挡住 HUD 是玩家自己的选择,
   * 而「拖出屏外就再也点不回来」不是,那一类才是必须夹住的。
   * (位移数值本身仍由 Settings 的 PLACE_GUARD 兜住坏档,这里不重复夹。)
   */
  const clampDelta = (slot: PadSlot, dx: number, dy: number): { dx: number; dy: number } => {
    if (slot === "slider") return clampRailDelta(dy);
    const base = slotBaseXY(slot);
    const { hw, hh } = viewportHalf();
    const corner = slotCorner(slot, hw, hh);
    const isJoy = slot === "joystick";
    const r = (isJoy ? Settings.joystick.r : Settings.padOf(slot as PadAction).r) * currentScale;
    const edge = CFG.padSkin.edgePad;
    const lo = -hw + r + edge, hi = hw - r - edge;
    const yLo = -hh + r + edge, yHi = hh - r - edge;
    const cx = clamp(corner.x + (base.x + dx) * currentScale, Math.min(lo, hi), Math.max(lo, hi));
    const cy = clamp(corner.y + (base.y + dy) * currentScale, Math.min(yLo, yHi), Math.max(yLo, yHi));
    return {
      dx: cx / currentScale - corner.x / currentScale - base.x,
      dy: cy / currentScale - corner.y / currentScale - base.y,
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
      if (slider) {
        const s = Settings.slider;
        const G = railGeo();
        const shown = clampRailDelta(s.dy);
        slider.r = s.r * currentScale;
        slider.h = slider.r * 2;
        slider.span = G.span;
        slider.minX = G.minX;
        slider.maxX = G.maxX;
        slider.w = G.span + slider.r * 2;
        // x 与长度不乘 scale:轨是球场的投影,球场不随长宽比缩放
        slider.root.setPosition(G.centerUiX, SLIDER_BASE.y + shown.dy);
        slider.baseUt.setContentSize(slider.w + 32, slider.h + 32);
        slider.thumb.getComponent(UITransform)!.setContentSize(slider.r * 2.2, slider.r * 2.2);
        // 换机/重置后旧滑块位置可能落在新行程外,夹回来,别让滑块挂在轨端之外
        slider.thumb.setPosition(clamp(slider.thumb.position.x, -G.span / 2, G.span / 2), 0);
        paintSliderTrack(slider, false, !!opts.edit);
        paintSliderThumb(slider, false);
      }
    }
  };

  const select = (slot: PadSlot | null): void => {
    for (const rec of recs) {
      const on = slot !== null && slot !== "joystick" && slot !== "slider" && rec.action === slot;
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
    if (slider) {
      const on = slot === "slider";
      if (on !== slider.selected) {
        slider.selected = on;
        paintSliderTrack(slider, false, !!opts.edit);
      }
    }
  };

  const pulseSwing = (tier: "sweet" | "perfect"): void => {
    // 甜蜜 = 金环轻弹;完美 = 青环更外扩更久。击球键合并后只亮一个。
    const hex = tier === "perfect" ? CFG.colors.sweet.neonCyan : CFG.colors.sweet.gold;
    for (const rec of recs) {
      if (rec.action !== "swing") continue;
      triggerGlow(rec, hex, tier === "perfect");
    }
  };

  const setSwingGlow = (level: number): void => {
    const v = clamp(level, 0, 1);
    for (const rec of recs) {
      if (rec.action !== "swing") continue;
      if (Math.abs(rec.glow - v) < 0.02) continue;
      rec.glow = v;
      paint(rec, !!opts.edit);
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
    pulseSwing,
    setSwingGlow,
    get moveMode(): MoveMode { return currentMode; },
    clearPressed(): void {
      claims.clear();
      for (const rec of recs) {
        const hadGlow = rec.glow > 0;
        if (!rec.pressed && !hadGlow && rec.node.scale.x === 1) continue;
        rec.pressed = false;
        rec.glow = 0;
        Tween.stopAllByTarget(rec.node);
        Tween.stopAllByTarget(rec.flashOp);
        rec.flashOp.opacity = 0;
        rec.node.setScale(1, 1, 1);
        paint(rec, !!opts.edit);
      }
      if (stick && stick.activeTouch !== null) {
        stick.activeTouch = null;
        stick.lastFullFlag = false;
        // 代跳的迟滞状态必须一起清:层被 hide 时手指可能正压在起跳区,
        // jumpOn 留着 true 的话下一次碰摇杆会认为还按着,要推回 upLo 以下才能再跳 —— 卡跳。
        // 走 cancelJump 而不是 release:这不是玩家主动松手,不该补出一段点跳尾巴。
        if (stick.jumpOn) { stick.jumpOn = false; cancelJump(pad); }
        Tween.stopAllByTarget(stick.knob);
        stick.knob.setPosition(0, 0);
        paintStick(stick, false, false, !!opts.edit);
        paintKnob(stick, false);
        setMoveAxis(pad, 0);
      }
      if (slider && (slider.activeTouch !== null || slider.jumpOn)) {
        slider.activeTouch = null;
        if (slider.jumpOn) { slider.jumpOn = false; cancelJump(pad); }
        paintSliderTrack(slider, false, !!opts.edit);
        paintSliderThumb(slider, false);
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

  /** 甜蜜/完美命中 → 击球两键档位辉光;未挂载(桌面纯键盘)时静默忽略 */
  pulseSwing(tier: "sweet" | "perfect"): void {
    this.handle?.pulseSwing(tier);
  }

  /** 按拍预告辉光电平;未挂载时静默忽略 */
  setSwingGlow(level: number): void {
    this.handle?.setSwingGlow(level);
  }
}

export const touchPad = new TouchPadController();
