// ============================================================
// 角色与羽毛球:3/4 斜侧卡通小人 + 阵营色球衣 + 挥拍弧光 + 球头**滞后追踪**速度方向
// —— 自老版 canvas 工程 src/render/sprites.js 逐行移植,姿势/插值/动画数值零改动。
// 视角约定:躯干/腿/双臂/头全部按「面向球网的 3/4 斜侧」画,靠 facing 镜像。
// 曾经正面躯干配侧面手臂,两套视角语汇打架,这是当年重构的根因。
// 羽毛球本体见文件末尾 drawShuttle:裙摆按环向弧长拆成独立羽片,姿态由渲染层的
// shuttle-motion 提供(滞后角/翻滚/受力外扩),不再是一整块五边形贴在那儿。
//
// canvas → cc.Graphics 的移植约定:
//  * 老代码的 save/translate/rotate/scale 变换栈展开为「帧」对象(Frame):
//    局部点在 canvas 约定(y 向下)里算好,经 frame.pt 映射到 Graphics(y 向上);
//  * cc.Graphics.arc 的扫向与 canvas 相反、也没有带旋转的椭圆弧 ——
//    部分圆弧一律在局部坐标里按 canvas 语义采样成折线;整圆/整椭圆在未旋转的
//    轴对齐帧里走 g.ellipse(精确),在旋转帧里同样采样;
//  * canvas globalAlpha → withAlpha 叠进颜色;shadowBlur 无对应 API,
//    以「同路径加宽一道的低透明度描边」近似(仅弧光/拍框辉光/命中闪光四处);
//  * canvas fillText/measureText 无法用 Graphics 表达:球衣号码与头顶名牌文字
//    已取消(号码不画、名牌不画,表现层也不再挂 Label),只剩主控操控指示标。
//
// 第 4 个参数 alpha 是渲染插值系数(0..1,帧间补偿),不是透明度 —— 与老 game.js 同名同义。
// ============================================================
import { Color, Graphics } from "cc";
import { CFG } from "../core/config";
import { Player, Ball, FaceKind, SkinDef, SwingStyle, Theme } from "../core/types";
import { Physics } from "../core/physics";
import { lerp, clamp, TAU, D2R } from "../core/utils";
import { pal, withAlpha } from "./palette";
import { armIK, legIK, poseLerp, farFK, lut, Pose, Pt2 } from "./rig";
import {
  IDLE_POSE, READY_POSE, serveHoldPose, swingArmPose, recoverPose,
  celebratePose, frustratePose, farSwingAngles, FAR_UA, FAR_FA,
  runFoot, airFoot, lungeFoot, standFoot, swingFootLift,
} from "./poses";
import { ShuttleMotion, shuttleWobble, TIER_FIRE, TIER_SMASH, TIER_SWEET, TIER_SWEET_SMASH } from "./shuttle-motion";

const LineCap = Graphics.LineCap;
const LineJoin = Graphics.LineJoin;

const C = CFG;
const CO = C.court, SW = C.swing;

/** 世界坐标(canvas,y 向下,960×540)→ Graphics 本地坐标(居中原点,y 向上)。
 *  与 world.ts 的同名接口结构一致;此处独立声明避免 render 模块互相成环。 */
export interface Viewport {
  x(wx: number): number;
  y(wy: number): number;
}

// ---------- 局部坐标帧:替代 ctx.save/translate/rotate/scale ----------

interface Pt { x: number; y: number }

/**
 * 一个绘制帧:局部点 (lx, ly)(canvas 约定,y 向下)→ Graphics 坐标。
 * kx/ky 是局部 x/y 轴的长度缩放(未旋转帧才有意义,旋转帧置 0 以禁用 ellipseAA)。
 */
interface Frame {
  pt(lx: number, ly: number): Pt;
  /** 线宽折算:canvas 的 CTM 会缩放描边,这里按 sqrt(|det|) 做几何平均近似 */
  lw(v: number): number;
  kx: number;
  ky: number;
}

/** 人物帧:老代码 translate(x,y) + scale(facing*sx, sy) 的等价展开 */
function playerFrame(vp: Viewport, wx: number, wy: number, facing: number, sx: number, sy: number): Frame {
  const vsx = Math.abs(vp.x(1) - vp.x(0));
  const vsy = Math.abs(vp.y(1) - vp.y(0));
  const vs = Math.sqrt(vsx * vsy) || 1;
  const k = Math.sqrt(Math.abs(facing * sx * sy)) * vs;
  return {
    pt: (lx, ly) => {
      const p = pooledPt();
      p.x = vp.x(wx + facing * sx * lx);
      p.y = vp.y(wy + sy * ly);
      return p;
    },
    lw: (v) => v * k,
    kx: sx * vsx,
    ky: sy * vsy,
  };
}

/** 平移子帧(不旋转不缩放,行列式不变) */
function offsetFrame(parent: Frame, ox: number, oy: number): Frame {
  return {
    pt: (lx, ly) => parent.pt(ox + lx, oy + ly),
    lw: (v) => parent.lw(v),
    kx: parent.kx,
    ky: parent.ky,
  };
}

/** 缩放子帧:以锚点为原点缩放局部单位(表情贴纸的 pop-in 弹出用) */
function scaledFrame(parent: Frame, ox: number, oy: number, s: number): Frame {
  return {
    pt: (lx, ly) => parent.pt(ox + lx * s, oy + ly * s),
    lw: (v) => parent.lw(v * s),
    kx: parent.kx,
    ky: parent.ky,
  };
}

/** 旋转子帧:老代码 translate(ox,oy) + rotate(rot) 的等价展开(canvas 旋转矩阵,坐标系 y 向下) */
function rotateFrame(parent: Frame, ox: number, oy: number, rot: number): Frame {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return {
    pt: (lx, ly) => parent.pt(ox + lx * cos - ly * sin, oy + lx * sin + ly * cos),
    lw: (v) => parent.lw(v),
    kx: 0, ky: 0, // 旋转帧不轴对齐,禁用 ellipseAA/circleAA(一律采样)
  };
}

/** 羽毛球帧:老代码 translate(bx,by) + rotate(ang) + scale(sqX,sqY) 的等价展开(先缩放再旋转再平移) */
function shuttleFrame(vp: Viewport, wx: number, wy: number, ang: number, sqX: number, sqY: number): Frame {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const vsx = Math.abs(vp.x(1) - vp.x(0));
  const vsy = Math.abs(vp.y(1) - vp.y(0));
  const vs = Math.sqrt(vsx * vsy) || 1;
  const k = Math.sqrt(Math.abs(sqX * sqY)) * vs;
  return {
    pt: (lx, ly) => {
      const p = pooledPt();
      const rx = lx * sqX, ry = ly * sqY;
      p.x = vp.x(wx + rx * cos - ry * sin);
      p.y = vp.y(wy + rx * sin + ry * cos);
      return p;
    },
    lw: (v) => v * k,
    kx: 0, ky: 0,
  };
}

// ---------- 折线 / 采样:cc.Graphics.arc 扫向与 canvas 相反,统一自采样最稳 ----------

// ---------- 采样点池:圆弧采样每帧零分配 ----------
// drawPlayer/drawShuttle 一帧要采几十处圆弧,旧写法每点 new {x,y}、每弧 new 数组,
// 两名角色 + 球合计每帧 1500~2500 个短命对象 —— 周期性 major GC 尖峰的主要来源。
// 全文件对采样点的用法都是「采完立刻 polyPath/读值,不跨调用树持有」,所以一页
// 环形池轮转即可:槽位复用、游标只进不退;单帧峰值用量 ~3000 点 / 几十条数组,
// 池深 8192 / 256,任何还活着的点在被覆盖前早就画完了。offset/scaled/rotate 三类
// 子帧只是委托父帧变换,本身不产出新点,无需自己过池。
const PT_POOL_N = 8192;
const ptPool: Pt[] = Array.from({ length: PT_POOL_N }, () => ({ x: 0, y: 0 }));
let ptHead = 0;
const ARR_POOL_N = 256;
const arrPool: Pt[][] = Array.from({ length: ARR_POOL_N }, () => []);
let arrHead = 0;

/** 取下一个复用点(调用方立即写 x/y) */
function pooledPt(): Pt {
  const p = ptPool[ptHead];
  ptHead = (ptHead + 1) % PT_POOL_N;
  return p;
}

/** 取一条复用折线(长度清零,调用方 push) */
function pooledPts(): Pt[] {
  const a = arrPool[arrHead];
  arrHead = (arrHead + 1) % ARR_POOL_N;
  a.length = 0;
  return a;
}

/** canvas arc 语义的扫角归一化:ccw=false 扫增角(区间 (0,2π]),ccw=true 扫减角(区间 [-2π,0)) */
function sweepDelta(a0: number, a1: number, ccw: boolean): number {
  let d = a1 - a0;
  if (!ccw) {
    if (d >= TAU) d = TAU;
    else { while (d < 0) d += TAU; }
  } else {
    if (d <= -TAU) d = -TAU;
    else { while (d > 0) d -= TAU; }
  }
  return d;
}

/** 圆/椭圆折线采样的整圈段数:20 段在 r≤30px 下弦降 <0.6px(肉眼不可辨),
 *  顶点量比旧值 36 少 45% —— 人物一帧要画十几处圆弧,这里是被 GC 与顶点重传放大的热点 */
const CIRCLE_SEGS = 20;

/** 局部圆弧按 canvas 语义采样成折线(角度在局部 canvas 约定里解释,方向视觉与原版一致) */
function arcPts(f: Frame, cx: number, cy: number, r: number, a0: number, a1: number, ccw: boolean): Pt[] {
  const d = sweepDelta(a0, a1, ccw);
  const steps = Math.max(2, Math.ceil((Math.abs(d) / TAU) * CIRCLE_SEGS));
  const pts = pooledPts();
  for (let i = 0; i <= steps; i++) {
    const th = a0 + (d * i) / steps;
    pts.push(f.pt(cx + r * Math.cos(th), cy + r * Math.sin(th)));
  }
  return pts;
}

/** 一般椭圆参数采样(带旋转/非均匀缩放的椭圆 cc ellipse 画不了,统一折线) */
function ellipsePts(f: Frame, cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts = pooledPts();
  for (let i = 0; i < CIRCLE_SEGS; i++) {
    const t = (i / CIRCLE_SEGS) * TAU;
    pts.push(f.pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)));
  }
  return pts;
}

/** 折线路径(隐式起笔画);closed 时补 close() */
function polyPath(g: Graphics, pts: Pt[], closed: boolean): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (closed) g.close();
}

/** 椭圆采样为折线路径:经由 f.pt 变换,与 arcPts / fillRectTr 完全一致,彻底规避 Viewport 缩放/镜像导致比例失调 */
function ellipseAA(g: Graphics, f: Frame, cx: number, cy: number, rx: number, ry: number): void {
  const pts = ellipsePts(f, cx, cy, rx, ry);
  polyPath(g, pts, true);
}

function circleAA(g: Graphics, f: Frame, cx: number, cy: number, r: number): void {
  ellipseAA(g, f, cx, cy, r, r);
}

/** 局部线段(不 stroke,由调用方攒路径后一次性 stroke,与 canvas 同构) */
function lineSeg(g: Graphics, f: Frame, x0: number, y0: number, x1: number, y1: number): void {
  const a = f.pt(x0, y0), b = f.pt(x1, y1);
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
}

/** 变换帧里的实心矩形:canvas fillRect 向 +x/+y 延伸,经镜像/翻转后归一成数学最小角 */
function fillRectTr(g: Graphics, f: Frame, lx: number, ly: number, w: number, h: number, color: Color): void {
  const a = f.pt(lx, ly), b = f.pt(lx + w, ly + h);
  const minX = Math.round(Math.min(a.x, b.x));
  const minY = Math.round(Math.min(a.y, b.y));
  const rw = Math.round(Math.abs(b.x - a.x));
  const rh = Math.round(Math.abs(b.y - a.y));
  g.fillColor = color;
  g.rect(minX, minY, rw, rh);
  g.fill();
}

/** 老代码的 px():半像素对齐的实心矩形(减少亚像素抖动);取整在局部坐标里做,与原版一致 */
function px(g: Graphics, f: Frame, lx: number, ly: number, w: number, h: number, color: string | Color): void {
  const x0 = Math.round(lx * 2) / 2, y0 = Math.round(ly * 2) / 2;
  fillRectTr(g, f, x0, y0, Math.ceil(w), Math.ceil(h), typeof color === "string" ? pal(color) : color);
}

// 头部固定配色,两款脸面(商店「面部皮肤」):墨面款(经典)一整颗黑脸圆 + 白色线条五官,
// 队色只上发带 —— 黑脸上唯一的彩色,红蓝阵营识别靠它;肤色款脸底与手臂同一肤色,
// 五官换深暖棕墨色,好心情表情加腮红。SKIN/SKIN_LINE 仍用于手臂与手(肤色款脸圆共用)。
const SKIN = "#f2c491", SKIN_LINE = "rgba(10,13,24,0.55)";
// HEAD 兼任三处墨迹:墨面款脸底、wow 感叹号气泡的「!」、羽毛球球托背光暗面
const HEAD = "#0a0e18", HEAD_LINE = "rgba(235,240,255,0.5)", FACE = "#ffffff";
// 肤色款专用:五官墨色(与肤色同暖调,比纯黑柔和)/ 心情腮红(happy/cheer/star 两颊淡粉)
const INK = "#4a2b16", BLUSH = "rgba(255,110,120,0.32)";

// 皮肤默认值(与 config.skins 对应项同色):没装备皮肤或旧调用方没传时兜回原配色,
// 皮肤只换颜色不改形状,判定半径与手感完全不受影响
const RACKET_DEFAULT: SkinDef = { id: "r-std", kind: "racket", name: "标准拍", price: 0, grip: "#20242f", shaft: "#efe7d8", frame: null };
const SHUTTLE_DEFAULT = { cap: "#f6f1e6", band: "#ff4d4d", skirt: "#fbfaf5", vein: "rgba(120,130,150,0.65)" };

// 主题兜底:老工程 applyToMatch 保证必有主题;类型上可选,这里兜成红方默认队色(未装备皮肤时本来就是它)
const DEFAULT_THEME: Theme = {
  main: C.colors.red.main, dark: C.colors.red.dark, glow: C.colors.red.glow, name: C.colors.red.name,
};

// ---------- 皮肤设计款渲染常量(纯装饰,与 SKIN/HEAD 同级的绘制常量) ----------
// 设计字段本体在 types.SkinDef / config.SKINS;这里只是它们落到笔画的颜色与尺寸
const HAIR_LINE = "rgba(10,13,24,0.55)";

// 脚下光环(传说人物专属):主环/副环两色 + 三颗环绕光点
const AURA_COLORS: Record<string, { a: string; b: string }> = {
  gold: { a: "#ffd24d", b: "#fff3c4" },
  neon: { a: "#3dffa8", b: "#a5ffe0" },
  flame: { a: "#ff6a1f", b: "#ffd24d" },
  ice: { a: "#7ecbff", b: "#eaffff" },
};

// 挥拍弧光专属风格(设计款球拍):主色/副光色对;rainbow 不在表里,走 hueColor 随时间变相
const SWING_FX_COLORS: Record<string, { a: string; b: string }> = {
  fire: { a: "#ff6a1f", b: "#ffd24d" },
  ice: { a: "#7ecbff", b: "#eaffff" },
  electric: { a: "#b18cff", b: "#f0e6ff" },
};

// 拍框贴章配色(decal):章体用高饱和色,压在拍线上仍一眼可辨
const DECAL_COLORS: Record<string, string> = {
  star: "#ffd24d", bolt: "#ffe14d", flame: "#ff6a1f", crystal: "#7ecbff",
};

/** HSL → #rrggbb(pal 不认 hsl 串);rainbow 弧光/拖尾按时间变相用(world.ts 拖尾也复用) */
export function hueColor(hDeg: number, s = 0.85, l = 0.62): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hDeg / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** 设计款挥拍弧光配色:racketSkin.swingFx → [主色, 副光色];无专属风格返回 null */
function swingFxPair(sk: SkinDef | null | undefined, t: number): [string, string] | null {
  const fx = sk?.swingFx;
  if (!fx) return null;
  if (fx === "rainbow") {
    return [hueColor((t * 0.9) % 360), hueColor((t * 0.9 + 140) % 360, 0.8, 0.7)];
  }
  const p = SWING_FX_COLORS[fx];
  return p ? [p.a, p.b] : null;
}

// 具名姿势(IDLE/READY/SERVE)、挥拍臂/收拍/情绪姿势与远臂两段角已迁往
// render/poses.ts(姿势库)与 render/rig.ts(骨架数学):肘位由 armIK 反解
// (两段恒等长),手位与拍角/拍长语义不变 —— 手仍钉在判定弧上,判定=视觉不破。
// 这里只保留:实体渲染插值字段、表现层私有状态表与弧光接线。

/** 挥拍中远臂的两段角:与持拍臂反相。u=0 两臂同举(引拍框架位,真实高远球就是双手都抬),
 *  u=1 远臂整条下落收拢(转体夹臂)。前臂始终落后上臂 45~50°,所以**挥拍全程**
 *  肘折都看得见。实现在 render/poses.ts(farSwingAngles),此处仅供远臂混合段调用。 */

/**
 * 渲染插值辅助字段:老工程由 game.js / drill-anim.js 直接写在球员/球身上,
 * 公共类型未收录。缺省时的回退与老代码 `??` 完全一致;
 * lastSwingAng 不再写回实体(见 lastAng),以稳定的 side:idx 键私有持有。
 */
interface RPlayer extends Player {
  rx?: number; ry?: number; sqR?: number;
  lastSwingStyle?: SwingStyle;
  lastSwingRadius?: number;
}

interface RBall extends Ball {
  rx?: number; ry?: number; sqR?: number;
}

// 挥拍弧光需要「上一帧的视觉角」。老代码直接写 p.lastSwingAng,但 Cocos 侧
// world.ts 每帧以 {...p, x, y} 展开传新对象,写回会丢 —— 故按 side:idx 存表。
// 键位在整场比赛内稳定;两次挥拍之间必经收拍/待机帧把值清 null,不会串场。
const lastAng = new Map<string, number | null>();

// 分腿垫步(纯视觉,零判定):对手击球、来球逼近信号(readyK)爬升沿触发的一次性
// 双脚分踩 —— 羽毛球步法的标志性起手。沿用 readyK 的渲染侧几何近似先例
// (不积分弹道、不写逻辑字段),状态按 side:idx 私有持有,与 lastAng 同款。
const splitT = new Map<string, number>();     // side:idx → 垫步剩余帧
const splitPrev = new Map<string, number>();  // side:idx → 上一帧 readyK(爬升沿检测)

/** 测试钩子:清空表现层私有姿势状态(lastAng/分腿垫步)。pose-preview 逐姿势
 *  隔离渲染用 —— 否则架拍姿势触发的垫步会泄漏进后续姿势的出图。 */
export function __resetPoseState(): void {
  lastAng.clear();
  splitT.clear();
  splitPrev.clear();
}

function angKey(p: Player): string {
  return p.side + ":" + p.idx;
}

/** 挥拍弧光残影数据:老代码由 sprites 直接推 FX.addSwingArc,移植版经 sink 交还表现层。
 *  color2 = 设计款球拍的副光色(外圈宽描边),无则普通单色弧光 */
export interface SwingArcFx {
  x: number; y: number;
  facing: number;
  fromAng: number; ang: number;
  reach: number;
  color: string;
  color2?: string;
  isSweet: boolean;
}

let swingArcSink: ((fx: SwingArcFx) => void) | null = null;

/** 表现层接线:把挥拍弧光残影送到衰减渲染(对应老 fx.js 的 addSwingArc);不接则只画当帧弧光 */
export function setSwingArcSink(sink: ((fx: SwingArcFx) => void) | null): void {
  swingArcSink = sink;
}

/** 挥拍弧光残影绘制(供 world.ts 调,对应老 fx.js swingArcs 段):
 *  世界坐标肩点 + facing 镜像 + canvas arc 语义采样,角度约定与当帧弧光一致(取负、扫向随角增减);
 *  isSweet 走白弧 + 金晕宽描边(老 shadowBlur 的加宽近似)。alpha 是残影衰减后的不透明度。 */
export function drawSwingArcGhost(
  g: Graphics, vp: Viewport,
  sa: SwingArcFx,
  alpha: number,
): void {
  if (alpha <= 0.004) return;
  const F: Frame = {
    pt: (lx, ly) => {
      const p = pooledPt();
      p.x = vp.x(sa.x + (sa.facing || 1) * lx);
      p.y = vp.y(sa.y + ly);
      return p;
    },
    lw: (v) => v,
    kx: 0, ky: 0,
  };
  const arc = arcPts(F, 0, 0, sa.reach, -sa.fromAng * D2R, -sa.ang * D2R, sa.ang > sa.fromAng);
  const w = sa.isSweet ? 8 : 6;
  if (sa.isSweet) {
    g.strokeColor = withAlpha(pal(C.colors.sweet ? C.colors.sweet.gold : "#ffe14d"), 0.35 * alpha);
    g.lineWidth = w + 5;
    polyPath(g, arc, false);
    g.stroke();
  }
  if (sa.color2) {
    // 设计款副光:外圈宽一道低透明度,与当帧弧光同构(shadowBlur 加宽近似)
    g.strokeColor = withAlpha(pal(sa.color2), 0.32 * alpha);
    g.lineWidth = w + 6;
    polyPath(g, arc, false);
    g.stroke();
  }
  g.strokeColor = withAlpha(pal(sa.isSweet ? "#ffffff" : sa.color), alpha);
  g.lineWidth = w;
  polyPath(g, arc, false);
  g.stroke();
}

/** 跨步高速突进残影参数 */
export interface LungeGhost {
  x: number;
  y: number;
  facing: number;
  life: number;
  maxLife: number;
  lungeLegExt?: number;
  lungeDirRel?: number;
  color?: string;
}

/** 绘制跨步幽灵流风残影 (具有深跨步与背侧破风流线) */
export function drawLungeGhost(g: Graphics, vp: Viewport, ghost: LungeGhost): void {
  const normA = ghost.life / ghost.maxLife;
  if (normA <= 0.005) return;
  const maxA = C.lunge.ghostAlpha || 0.45;
  const alpha = normA * maxA;
  const col = ghost.color || "#38bdf8";

  const W = C.player.w, H = C.player.h;
  // 前冲拉伸变换帧
  const F = playerFrame(vp, ghost.x, ghost.y, ghost.facing, 1.06, 0.94);
  const bodyTop = -H * 0.72;
  const bodyH = H * 0.38;
  const tw = W * 0.66, tx = -W * 0.40;

  // 1. 半透明幽灵剪影躯干与头部
  px(g, F, tx, bodyTop, tw, bodyH, withAlpha(pal(col), alpha * 0.65));
  // 头部圆
  circleAA(g, F, 2, bodyTop - H * 0.18, H * 0.18);
  g.fillColor = withAlpha(pal(col), alpha * 0.75);
  g.fill();

  // 2. 深跨步双腿剪影
  const hipY = -H * 0.46;
  const legExt = ghost.lungeLegExt ?? 0.85;
  const dirRel = ghost.lungeDirRel ?? 1;
  const leadFx = dirRel > 0 ? 22 * legExt : -18 * legExt;
  const trailFx = dirRel > 0 ? -18 * legExt : 14 * legExt;
  g.strokeColor = withAlpha(pal(col), alpha * 0.85);
  g.lineWidth = F.lw(5.2);
  lineSeg(g, F, -4, hipY, leadFx, 0);
  lineSeg(g, F, 4, hipY, trailFx, 0);
  g.stroke();

  // 3. 前伸持拍臂与球拍光影
  const handX = 24 * legExt, handY = hipY - 4;
  lineSeg(g, F, 2, hipY - 10, handX, handY);
  g.stroke();
  g.lineWidth = F.lw(1.8);
  circleAA(g, F, handX + 10 * dirRel, handY - 12, 9.5);
  g.stroke();

  // 4. 背侧速度流线 (Streamlines)
  g.lineWidth = F.lw(2.0);
  g.strokeColor = withAlpha(pal("#ffffff"), alpha * 0.85);
  const streamL = 18 + 14 * normA;
  lineSeg(g, F, tx - 2, bodyTop + 6, tx - streamL, bodyTop + 6);
  lineSeg(g, F, tx - 4, bodyTop + bodyH * 0.5, tx - streamL * 1.25, bodyTop + bodyH * 0.5);
  lineSeg(g, F, tx - 2, bodyTop + bodyH - 4, tx - streamL * 0.85, bodyTop + bodyH - 4);
  g.stroke();
}

/** 闪现折跃离场电离残影参数 */
export interface FlashGhost {
  x: number;
  y: number;
  facing: number;
  life: number;
  maxLife: number;
}

/** 绘制折跃起点电离消散残影 (金雷光芒与电弧碎屑) */
export function drawFlashGhost(g: Graphics, vp: Viewport, ghost: FlashGhost): void {
  const normA = ghost.life / ghost.maxLife;
  if (normA <= 0.005) return;
  const alpha = normA * 0.55;
  const col = "#ffe14d";

  const W = C.player.w, H = C.player.h;
  const F = playerFrame(vp, ghost.x, ghost.y, ghost.facing, 1.0, 1.0);
  const bodyTop = -H * 0.72;
  const bodyH = H * 0.38;
  const tw = W * 0.66, tx = -W * 0.40;

  // 1. 半透明金色剪影
  px(g, F, tx, bodyTop, tw, bodyH, withAlpha(pal(col), alpha * 0.7));
  circleAA(g, F, 2, bodyTop - H * 0.18, H * 0.18);
  g.fillColor = withAlpha(pal(col), alpha * 0.8);
  g.fill();

  // 2. 双腿与持拍手臂
  const hipY = -H * 0.46;
  g.strokeColor = withAlpha(pal(col), alpha * 0.85);
  g.lineWidth = F.lw(4.5);
  lineSeg(g, F, -4, hipY, -10, 0);
  lineSeg(g, F, 4, hipY, 12, 0);
  lineSeg(g, F, 2, hipY - 10, 18, hipY);
  g.stroke();

  // 3. 4 道向四周电离炸裂的金色锯齿雷弧
  g.lineWidth = F.lw(1.8);
  g.strokeColor = withAlpha(pal("#00f0ff"), alpha * 0.9);
  const burstR = (1 - normA) * 16;
  lineSeg(g, F, tx - 4, bodyTop + 4, tx - 12 - burstR, bodyTop - 6 - burstR);
  lineSeg(g, F, tx + tw + 4, bodyTop + 4, tx + tw + 12 + burstR, bodyTop - 6 - burstR);
  lineSeg(g, F, tx - 6, bodyTop + bodyH, tx - 14 - burstR, bodyTop + bodyH + 8 + burstR);
  lineSeg(g, F, tx + tw + 6, bodyTop + bodyH, tx + tw + 14 + burstR, bodyTop + bodyH + 8 + burstR);
  g.stroke();
}

// poseLerp / swingArmPose / recoverPose / lut 已迁往 rig.ts 与 poses.ts(见文件头说明)。

// ---------- 躯干脊柱:一条连续曲线,而不是三块横移量不同的矩形 ----------
// 为什么不是「髋段 + 腰段 + 肩段」三块矩形叠:腰段 y∈[0.22,0.44]·bodyH 整个落在肩段
// y∈[0,0.5]·bodyH 里、又画在它**之前**、同宽 → 被完全盖住,是死代码。于是可见躯干只剩
// 两块矩形,竖向搭接只有 3 单位,却要扛 4.8 单位的横向偏移(lean 前压与 runTwist 扭转
// 都只加在肩段)→ 用户看到的是「腰断了一截」。拼色球衣的色带/腰带同样锚在肩段 x 上,
// 而它们画的那一段只有不移的髋段 → 色块会溢出轮廓画到背景上(网侧多画、背侧漏画)。
// 现在躯干由一条脊柱描述:pt(v,u) = 该高度上「背缘 + u·衣宽」那一点,v=0 在肩、v=1 在髋。
// 底色、明暗、领口、下摆、球衣纹样**全部**从这同一个 pt() 采样 → 覆盖物的两条竖边就长在
// 轮廓上,不需要裁剪也不可能错位。
// 为什么走 polyPath 而不是「按 0.5 网格切横条」:切条会把 4.8 单位的一次大台阶摊成
// ~8 个 4×0.5 的小台阶,背缘那道 3 单位深色带把每个小台阶都描成一条高对比横线,
// 1.5 倍缩放下躯干就成了一身肋骨架。斜边本来就该是斜的 —— 四肢笔画/头圆/发型早就是
// 浮点几何,只有矩形件在吃网格,所以这里不量化并不会让人物「抖」,反而更稳。
interface Torso {
  top: number;
  h: number;
  w: number;
  /** 脊柱上一点(局部坐标,y 向下):v=0 肩 / v=1 髋;u=0 背缘 / u=1 前缘 */
  pt(v: number, u: number): Pt;
}

/** 沿脊柱建躯干。spineX(v) 给该高度相对髋段背缘(tx)的横向偏移;
 *  v=1 必须回到 0 —— 髋段背缘 tx 是 pose-preview 里钉死的 BACK(远臂「手贴轮廓」判据量它)。 */
function makeTorso(tx: number, top: number, h: number, w: number, spineX: (v: number) => number): Torso {
  return {
    top, h, w,
    // 躯干点是每帧最热的一路采样(带/轮廓全走它),一律出池
    pt(v: number, u: number): Pt {
      const p = pooledPt();
      p.x = tx + spineX(v) + w * u;
      p.y = top + h * v;
      return p;
    },
  };
}

/** 脊柱跟随带:纵界 v0..v1(0=肩),横界 u0..u1(0=背缘,1=前缘)。
 *  两条竖边各按 CFG.pose.spineRowH 的步长采点,所以带的边界与躯干轮廓是同一条曲线。
 *  minLx = 左缘地板,给领口那种「从脖子前沿往网侧延伸」的锚用;宽度算出非正值整条跳过 ——
 *  旧写法把宽度写成 `tx+lean+tw-2`,退防跨步(lean≈-12)时它是负数,fillRectTr 取绝对值
 *  → 脖子前面甩出一块没归属的深色板。 */
function torsoBand(g: Graphics, f: Frame, t: Torso, v0: number, v1: number,
  u0: number, u1: number, color: string | Color, minLx?: number): void {
  const mid = t.pt((v0 + v1) / 2, u0);
  const lxMid = minLx === undefined ? mid.x : Math.max(mid.x, minLx);
  if (lxMid >= t.pt((v0 + v1) / 2, u1).x) return;
  const n = Math.max(2, Math.ceil((v1 - v0) * t.h / C.pose.spineRowH));
  const pts = pooledPts();
  for (let i = 0; i <= n; i++) {                        // 背侧边:v0 → v1
    const p = t.pt(v0 + (v1 - v0) * (i / n), u0);
    pts.push(f.pt(minLx === undefined ? p.x : Math.max(p.x, minLx), p.y));
  }
  for (let i = n; i >= 0; i--) {                        // 前侧边:v1 → v0
    const p = t.pt(v0 + (v1 - v0) * (i / n), u1);
    pts.push(f.pt(p.x, p.y));
  }
  g.fillColor = typeof color === "string" ? pal(color) : color;
  polyPath(g, pts, true);
  g.fill();
}

export function drawPlayer(g: Graphics, vp: Viewport, p: Player, animT: number, alpha: number, ball: Ball | null): void {
  const pp = p as RPlayer;
  const t = animT;
  const x = pp.rx ?? pp.x, y = pp.ry ?? pp.y;
  const th = p.theme ?? DEFAULT_THEME;
  // 完整人物皮肤(发型/头饰/纹样/光环/体型/默认脸):CPU/P2 没挂 → null 走原版画法
  const ps = p.playerSkin ?? null;
  const H = C.player.h, W = C.player.w;
  // 体型档(纯视觉):髋高/躯干/头身比/肢宽的整体微调。肩点 pivotY 是判定
  // 锁定位,体型档不碰它 —— 只改轮廓观感,零手感影响。未知 key 兜 standard
  const body = C.bodies[ps?.body ?? "standard"] ?? C.bodies.standard;
  // 人物肤色:手臂/手/膝盖皮肤与肤色系脸面共用的那一号颜色
  const skinCol = ps?.skinTone ?? SKIN;
  // 脸面解析:CPU/P2 无 faceSkin → undefined → drawHead 兜墨面(敌我识别,不许动);
  // 真人装备位 "auto"(人物默认)→ 人物自带脸 → 全局默认肤色脸
  const eqFace = p.faceSkin?.faceStyle;
  const faceStyle = eqFace === undefined ? undefined
    : eqFace !== "auto" ? eqFace : (ps?.face ?? "skin");

  // 圆头笔画贯穿全身(老 canvas 里首个 arm() 设完就随状态泄漏到后续笔画,闭合路径上无视觉差)
  g.lineCap = LineCap.ROUND;
  g.lineJoin = LineJoin.ROUND;

  // 影子
  const groundY = p.groundY ?? CO.groundY;
  const air = clamp((groundY - y) / 140, 0, 1);
  const vsx = Math.abs(vp.x(1) - vp.x(0));
  const vsy = Math.abs(vp.y(1) - vp.y(0));
  g.fillColor = withAlpha("#000000", 0.38 - air * 0.22);
  g.ellipse(vp.x(x), vp.y(groundY + 3), W * 0.62 * (1 - air * 0.3) * vsx, 5 * (1 - air * 0.35) * vsy);
  g.fill();

  // 传说人物脚下光环:双环呼吸 + 三颗环绕光点(升空时不画,避免悬空光环)
  if (ps?.aura && !air) {
    const ac = AURA_COLORS[ps.aura] || AURA_COLORS.gold;
    const vs = Math.sqrt(vsx * vsy) || 1;
    const pulse = 1 + Math.sin(t * 0.085) * 0.09;
    const rx0 = W * 0.95 * pulse, ry0 = 8.5 * pulse;
    g.strokeColor = withAlpha(pal(ac.a), 0.34);
    g.lineWidth = 2.2 * vs;
    g.ellipse(vp.x(x), vp.y(groundY + 2), rx0 * vsx, ry0 * vsy);
    g.stroke();
    g.strokeColor = withAlpha(pal(ac.b), 0.22);
    g.lineWidth = 1.2 * vs;
    g.ellipse(vp.x(x), vp.y(groundY + 2), rx0 * 1.28 * vsx, ry0 * 1.3 * vsy);
    g.stroke();
    for (let i = 0; i < 3; i++) {
      const oa = t * 0.055 + (i * TAU) / 3;
      const ox = x + Math.cos(oa) * rx0 * 1.12;                       // 环绕椭圆长轴
      const oy = groundY + 2 + Math.sin(oa) * ry0 * 1.12;
      const rise = 6 + Math.sin(t * 0.05 + i * 2.1) * 4;              // 光点小幅漂浮(世界 y 向上为负)
      g.fillColor = withAlpha(pal(i === 1 ? ac.b : ac.a), 0.8);
      g.circle(vp.x(ox), vp.y(oy - rise), 1.6 * vs);
      g.fill();
    }
  }

  // 唯一的坐标系:脚底原点 + facing 镜像 + squash。躯干/腿/双臂/头同场绘制,
  // 肩随 bob 浮动、随 sq 压扁 —— 挥拍臂不再钉在固定肩高上
  const sy = pp.sqR ?? lerp(p.sqPrev, p.sq, alpha);
  const sx = 1 / Math.sqrt(Math.max(0.4, sy));
  const F = playerFrame(vp, x, y, p.facing, sx, sy);

  // ---------- 姿势时间轴:挥拍 / 收拍 / 跑步 ----------
  // 挥拍角与 P.swingPose 同源(判定=视觉);alpha 把 swingT 推进到帧间,
  // 高刷屏上弧线和手臂不再 60Hz 阶跃。挥空多出的硬直帧也要算进钳制里
  const total = Physics.swingTotal() + (p.swingHit ? 0 : SW.whiffExtra);
  const swinging = p.swingT >= 0;
  const swT = swinging ? Math.min(p.swingT + (alpha || 0), total) : -1;
  const sp = swinging ? Physics.swingPose(p.swingStyle, swT, p.swingRadius) : null;
  const poseU = swinging && sp ? sp.u : 1;
  // 收拍进度 0=弧线终点 1=待机(recoverT 每模拟步递减,alpha 补帧间);
  // 缓冲衔接的连拍在起拍时 recoverT 还没走完,起拍混合要从这里接过去
  const recRaw = p.recoverT > 0
    ? clamp((SW.blendOut - p.recoverT + (alpha || 0)) / SW.blendOut, 0, 1) : 1;
  const recK = 1 - (1 - recRaw) * (1 - recRaw);

  // 跑姿:相位由逻辑层随位移累积(步频随速度),runAmt 渐入渐出防起步/急停跳变
  const runAmt = p.runAmt ?? 0;
  const cycRaw = Math.sin(p.runPhase ?? 0);
  const spN = clamp(Math.abs(p.vx) / C.player.vmax, 0, 1);
  // 跑步躯干反向扭转 + 肩高差:上下半身不再像焊死的整体
  const runTwist = cycRaw * 1.8 * runAmt * spN;
  const runShDy = cycRaw * 0.6 * runAmt;
  const airborne = !p.onGround;
  // 落地冲击:squash 还没恢复 = 刚着地,幅度随 squash 衰减(0=完全恢复,~0.28=刚落地)
  const landing = p.onGround && p.sq < 0.85;
  const landAmt = landing ? (1 - p.sq) : 0;
  // ---------- 跨步救球姿势 ----------
  const lunging = p.lungeT >= 0;
  const lungeU = lunging ? clamp(p.lungeT / (C.lunge.duration || 14), 0, 1) : 0;
  // 冷却期也保留一点前倾残影,渐出
  const lungeRecov = p.lungeCd > 0 ? clamp(p.lungeCd / (C.lunge.cooldownFrames || 10), 0, 1) : 0;
  const lungeLean = (lunging ? Math.sin(lungeU * Math.PI) * C.lunge.lean : lungeRecov * 3);  // 跨步中身体大幅倾斜
  const lungeLegExt = lunging ? Math.sin(lungeU * Math.PI) : 0;                   // 引导腿伸出量
  // 跨步方向相对于球员面朝方向(1=向前跨步, -1=向后跨步)
  const lungeDirRel = ((p.lungeDir || p.facing) * p.facing) >= 0 ? 1 : -1;

  // ---------- CPU 人格化:庆祝/沮丧动作 ----------
  const ai = p.ai;
  const celebrating = !!(ai && ai.celebrateT > 0);
  const frustrated = !!(ai && ai.frustrateT > 0);
  const celebrateU = celebrating ? clamp(ai!.celebrateT / 30, 0, 1) : 0;
  const frustrateU = frustrated ? clamp(ai!.frustrateT / 25, 0, 1) : 0;
  // 庆祝:身体微微后仰 + 手臂上举;沮丧:身体前倾 + 肩膀下沉
  const emotionLean = celebrating ? -3 * Math.sin(celebrateU * Math.PI) : frustrated ? 2 * Math.sin(frustrateU * Math.PI) : 0;

  // ---------- AI 扑救俯冲(鱼跃) ----------
  // 够不到球时 ai.ts 置 scrambleT,这里只读它做一次前扑:躯干大幅前倾 + 髋下沉 + 双臂张开。
  // 纯表现,不改判定(球照样漏)。方向按球在身前/身后决定前倾还是后仰。
  const scrambleU = ai && ai.scrambleT > 0 ? clamp(ai.scrambleT / (C.aiReach.scrambleFrames || 16), 0, 1) : 0;
  const scrambleK = Math.sin(scrambleU * Math.PI);
  const scrambleRel = ball ? (Math.sign((ball.x - p.x) * p.facing) || 1) : 1;

  // 呼吸律动:复合波(~3s 主周期 + ~6s 副周期),待机时最明显,跑/跳时降级为背景
  const breathBob = Math.sin(t * 0.035) * 1.2 + Math.sin(t * 0.017) * 0.4;
  const bob = airborne ? breathBob * 0.3 + Math.sin(t * 0.05) * 0.4
    : lerp(breathBob, Math.abs(cycRaw) * (1.2 + 1.2 * spN), runAmt);
  // 重心微移:极慢横向偏移(~8s 周期),只影响上半身;挥拍/跨步时大幅衰减
  const idleWeight = swinging || lunging ? 0.1 : 1;
  const weightShift = Math.sin(t * 0.012) * 1.0 * (1 - runAmt * 0.7) * idleWeight;

  // ---------- 发球等待:持球未挥拍 = 非持拍手后摆托球(远臂 serveHold 分支),球钉在 rules.handX/handY ----------
  const serveHold = !!(ball && ball.held && ball.owner === p && !swinging);

  // 发球姿势权重 serveK:球飞回手时与球同步渐入(同款 ease-out)→ 持球=1 → 起拍后
  // 由挥拍动画接管。全部用现成信号,不需要渲染侧记忆。躯干/腿另用 serveBodyK:
  // 只在 blendIn 内线性融掉 —— 判定窗(swT≥blendIn)一开沉降就已归零,肩点锁定不被破坏;
  // 之后 underCrouchKnee 接力折腿,收拍归零。
  let serveK = 0;
  if (serveHold) {
    serveK = 1;
  } else if (ball && ball.flying && ball.owner === p && !swinging) {
    const t01 = clamp((C.scoring.flyToHandFrames - ball.flyT + 1) / C.scoring.flyToHandFrames, 0, 1);
    serveK = 1 - (1 - t01) * (1 - t01) * (1 - t01);   // 与球落手的 ease-out 同步
  } else if (swinging && p.serveSwing) {
    serveK = 1;
  }
  // 躯干/腿的权重:等待/接球期跟随 serveK(沉降可见),起拍只在 blendIn 内线性融掉 ——
  // 判定窗(swT≥blendIn)一开沉降已归零,肩点锁定不被破坏;之后 under 提跟接力
  const serveBodyK = swinging
    ? (p.serveSwing ? clamp(1 - swT / SW.blendIn, 0, 1) : 0)
    : serveK;
  const serveDip = serveBodyK * C.serveHold.dip;

  // ---------- 来球预备架拍:球朝己方飞来且临近时从待机向架拍姿势渐入(纯视觉,零判定) ----------
  // 信号是几何近似:水平速度朝我方 + 直线距离/速率估到达帧数,不积分弹道 —— 架拍是
  // 氛围表现,快慢半拍无感。挥拍中权重归零(肩点 pivotY 是判定锁定位,沉降不能动它);
  // 收拍期用 recK 接入,从弧线终点平滑长出来,不跳变。AI/玩家通吃。
  let readyK = 0;
  if (ball && ball.live && !ball.held && !serveHold && !lunging && !celebrating && !frustrated
    && ball.vx * p.facing < 0) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const dist = Math.hypot(ball.x - x, ball.y - (y + SW.pivotY));
    const tEst = dist / Math.max(speed, 2);
    let k = clamp(1 - tEst / C.readyStance.horizonFrames, 0, 1);
    k = k * k * (3 - 2 * k);                            // smoothstep:远处懒抬,近前坐实
    k *= lerp(0.45, 1, clamp((speed - 4) / 10, 0, 1));  // 慢球轻架,快球架满
    readyK = k;
  }
  // 分腿垫步触发(纯视觉):readyK 爬升沿 = 对手刚击球、来球信息刚成立的那一刻。
  // 只在地上、非挥拍/跨步/情绪/持球时触发;幅度走 sin 半波,约 0.2 秒收完。
  // 与 lastAng 同款的表现层私有状态,不写任何逻辑字段。
  const skey = angKey(p);
  const prevReadyK = splitPrev.get(skey) ?? 0;
  if (readyK > 0.22 && prevReadyK <= 0.22 && !swinging && !lunging && p.onGround
    && !celebrating && !frustrated && !serveHold) {
    splitT.set(skey, C.pose.splitDur);
  }
  splitPrev.set(skey, readyK);
  const splitLeft = splitT.get(skey) ?? 0;
  if (splitLeft > 0) splitT.set(skey, splitLeft - 1);
  // 应用权重:挥拍 0;收拍/待机随 recK 进出。空中保留举拍与远臂,屈膝/沉降只在地上
  const readyW = swinging ? 0 : readyK * recK;
  const readyG = airborne ? 0 : readyW;
  // 沉降量在这里出(远肩 bsy 在腿段之前就要用):膝弯不再单独给偏移量 ——
  // 髋沉多少,腿部 IK 自动折多少膝(readyStance.dip 就是屈膝深度)
  const readyDip = readyG * C.readyStance.dip;
  // 挥空踉跄:挥空硬直窗(whiffExtra)内躯干前冲 sin 半波,随收拍自然衰减
  const whiffing = swinging && !p.swingHit && swT > SW.windup + SW.active;
  const whiffK = whiffing
    ? Math.sin(clamp((swT - (SW.windup + SW.active)) / SW.whiffExtra, 0, 1) * Math.PI) : 0;

  // ---------- 躯干倾斜量:基础前倾 + 随速度俯身 + 挥拍拧转(引拍后仰→发力前压) ----------
  // 命中后跟随动作:身体跟着球的方向大幅前压(over 更前倾,under 更后仰)
  const ft = p.swingHit;
  const leanTbl = p.swingStyle === "over"
    ? [[0, -1.2], [0.12, -3], [0.4, 2.8], [1, ft ? 1.8 : 0.6]]
    : [[0, 0.8], [0.12, 1.8], [0.4, -2], [1, ft ? -1.2 : -0.4]];
  const lean = 2
    + (p.vx * p.facing / C.player.vmax) * 2.5
    + (swinging ? lut(leanTbl, poseU) : p.recoverT > 0 ? lut(leanTbl, 1) * (1 - recK) : 0)
    + (p.hitRecoil || 0) * p.facing * 0.5   // 击球身体后仰:命中瞬间短暂后仰
    + lungeLean * lungeDirRel               // 跨步救球:身体沿跨步方向大幅倾斜
    + emotionLean                            // CPU 情绪:庆祝后仰/沮丧前倾
    + weightShift                            // 待机重心微移(跑/挥时衰减)
    + landAmt * 4                            // 落地冲击:躯干前倾吸收冲击
    + readyW * C.readyStance.lean            // 架拍:微微前倾压向来球
    + whiffK * C.swing.whiffStagger          // 挥空踉跄:前冲失衡
    + scrambleK * C.aiReach.scrambleLean * scrambleRel   // AI 扑救俯冲:朝球方向大幅前扑/后仰
    - serveBodyK * C.serveHold.lean;         // 发球蓄势:重心微后坐(落位沉下的同时上身略仰)

  // ---------- 下沉量与髋/躯干锚点:所有非判定类下沉统一走髋部 ----------
  // 髋一沉,膝弯由腿部 IK 反解(接地约束)—— 屈膝不再是「大腿矩形压短」的伪装。
  // restDip(落地/跨步/垫步)在起拍 blendIn 内线性淡出(swingFade):判定窗一开,
  // 肩点锁定不被破坏 —— 与 serveBodyK 同一套门控画法。
  const swingFade = swinging ? clamp(1 - swT / SW.blendIn, 0, 1) : 1;
  const landDip = landAmt * C.pose.landDip * swingFade;
  const lungeDip = (lunging && !airborne ? lungeLegExt : 0) * C.lunge.dip * swingFade;
  const splitEnv = splitLeft > 0 ? Math.sin((1 - splitLeft / C.pose.splitDur) * Math.PI) : 0;
  const splitDip = splitEnv * C.pose.splitDip * swingFade;
  const restDip = landDip + lungeDip + splitDip + scrambleK * C.aiReach.scrambleDip * swingFade;
  const hipY = -H * body.hip + bob + readyDip + serveDip + restDip;
  // 躯干长与「髋到肩」的距离是同一条 body.torso。旧写法这里乘 body.torso、下面的躯干段
  // 却硬编码 H*0.38:standard 恰好相等所以从没暴露,compact 衣摆比髋点高 3 单位 → 腰侧
  // 真露出一块背景洞(大腿笔画只盖得住中间那几条),tall 垂到髋下 6 单位 → 像长衫。
  const torsoH = H * body.torso;
  const bodyTop = hipY - torsoH;   // 躯干底边粘在髋上,上沿随下沉/起伏整体移动

  // ---------- 远臂:躯干后层的远侧手臂(景深)。两段 FK + 肤色小臂 + 手,跟着动作反相 ----------
  // 画在腿/躯干/头之前 → 内侧被躯干盖住是刻意的景深。不要在这里"对称地"补一颗肩关节圆:
  // 远肩距躯干**肩段**背缘只有 5.8(tx+lean=-14.8),画了会被整个抹掉(近侧那颗有效是因为它
  // 画在躯干之后)。手在髋高,量它露不露出来要用不随 lean 动的**髋段**背缘 -W*0.40 = -16.8
  // —— pose-preview 的「手贴轮廓」断言就是拿这条边量的。
  // 远肩:躯干后层的景深肩。**不参与发球的沉降/后倾**(serveDip/serve 项从 x 里扣除):
  // 托球手必须钉在 rules 的球位上,躯干在它后面沉 —— 否则球落手瞬间手和球错开 2~3px
  const bsx = -9 + (lean - 2 + serveBodyK * C.serveHold.lean) * 0.9;   // 与近侧 A 相距 10.5 = 3/4 视角的肩宽透视;
  const bsy = bodyTop - serveDip + runShDy;    //   远肩贴躯干上沿但**不参与发球沉降**(托球手钉在 rules 球位上,
  const B = offsetFrame(F, bsx, bsy);          //   否则球落手瞬间手和球错开 2~3px);跑步时肩高差比近侧肩高 2。

  // 基准 = 待机放松挂位:**肘是整条臂最外凸的点,前臂近乎竖直垂到胯边**。
  // 旧基准 206/250 把整条臂甩成正后方 64°(手落在躯干背缘外 8 单位的空白里),读作尾巴不是
  // 手臂 —— 那条臂画在躯干后层,只要露出背缘就够,不需要离开身体。228/266 让手盘内缘
  // 只离髋段背缘 0.6 单位(贴住),且与持拍臂手位同高(-45.6 vs -48)= 一副身体两条臂。
  let fea = 228, fef = 266;
  // 待机呼吸:远臂基线角度随呼吸微变(不同周期,避免与近臂同步)
  if (!swinging && p.recoverT <= 0 && !airborne && !lunging && !celebrating && !frustrated) {
    fea += Math.sin(t * 0.018) * 3; fef += Math.sin(t * 0.014 + 0.5) * 2.5;
  }
  // 落地冲击:远臂下意识外展缓冲
  if (landing) { fea += landAmt * 8; fef += landAmt * 6; }
  // 对侧步态:远侧臂与近侧(前)腿同相。旧版写的是 -cycRaw,与前腿反相 = 顺拐。
  // **前摆小、后摆大**:这条臂画在躯干之前,甩到身体前方会被整个吞掉(实测对称 ±6 时
  // 前相 hug=-4.5,只剩三成手盘露在背缘外)。用抛物线把行程按相位偏置(单调、无折角):
  // 前相走 40% 行程(手压到背缘外 -2.8,仍露七成),后相走 120%(手离体 3.7 = 摆到身后该看见)。
  const gait = cycRaw * (1 - 0.5 * cycRaw) * 0.8 * runAmt;
  fea += gait * 8; fef += gait * 10;
  if (airborne) { fea = lerp(fea, 178, 1 - runAmt); fef = lerp(fef, 128, 1 - runAmt); }
  if (lunging) {
    // 上网救球:远臂朝后上猛甩(走钢丝式平衡);退防跨步:整条垂在身后跟着身体后坐
    // (旧 196/250 手离体 9.2 = 又一根尾巴,退防的「后摆」由 bsx 随 lean 后移提供,臂本身收着)
    const k = lungeLegExt;
    const la = lungeDirRel > 0 ? 168 : 214, lf = lungeDirRel > 0 ? 118 : 268;
    fea = lerp(fea, la, k); fef = lerp(fef, lf, k);
  }
  if (celebrating) {                             // 挥拳:手举到头顶后缘外
    const s = Math.sin(celebrateU * Math.PI);
    fea = lerp(fea, 150, s) - 10 * s; fef = lerp(fef, 95, s);
  }
  if (frustrated) {                              // 耷拉:折角仍按旧版收到 30 = limp,比贴身待机
                                                 // 再直、再往里压 1 单位;区分度主要靠 emotionLean/低头/脸
    const s = Math.sin(frustrateU * Math.PI);
    fea = lerp(fea, 232, s); fef = lerp(fef, 262, s);
  }
  // 发球持球(最高优先):球钉在 rules.handX/handY —— 非持拍手自然后摆的手心
  // (远肩(-9,-72) + 悬挂角 206/250 反解 → x-28、0.515H),球在身体后侧,与体前的拍
  // 明显分开 =「一手拍、一手球」。手到哪球到哪:呼吸/步态残摆收到 ±1.5° 防脱手;
  // 收拍/空中/情绪一律让位。
  // **这两条角是游戏数值,不是审美值**:rules.ts handX = -28 由它反解而来,待机基准改了
  // 也绝不跟着改(改了 = 改发球释放点)。待机贴身之后它反而读得更清楚:托球是刻意后伸手。
  if (serveHold) {
    fea = 206 + Math.sin(t * 0.022) * 1.2 + cycRaw * 3 * runAmt;
    fef = 250 + Math.sin(t * 0.018 + 0.7) * 1 + cycRaw * 4 * runAmt;
  }
  fea += (p.hitRecoil || 0) * 0.6;
  // 架拍平衡:远臂从垂挂位抬到肩后上方(绝对目标角,与 air/lunge/celebrate 同一写法)。
  // 3/4 视角下远臂前伸会撞进后脑遮挡圆(见下文手指来球的警告),只能往后上抬 —— 读作反手
  // 预备的绷臂。旧版是「从待机 206/250 各减一个增量」:基准改成贴身 228/266 之后,增量式
  // 抬不动 fef(228-38=190 但 266-42=224 会把前臂甩成正后方),手反而离体 24。
  if (readyW > 0) {
    fea = lerp(fea, C.readyStance.farArm[0], readyW);
    fef = lerp(fef, C.readyStance.farArm[1], readyW);
  }
  if (whiffK > 0) { fea -= whiffK * 26; fef -= whiffK * 30; }   // 挥空踉跄:划大弧找平衡
  if (scrambleK > 0) { fea -= scrambleK * 34; fef -= scrambleK * 40; }   // 扑救俯冲:远臂张开甩向球侧

  // 收拍 → 挥拍:与持拍臂共用 recK / blendIn 两条窗。**顺序不可调换** —— 缓冲衔接的连拍
  // 在起拍时 recoverT 还没走完,远臂要从回摆中途接过去(对应持拍臂的 poseLerp(recoverPose…))
  let cea = fea, cef = fef;
  if (!swinging && p.recoverT > 0) {
    const e = farSwingAngles(pp.lastSwingStyle ?? p.swingStyle, 1, p.serveSwing);   // u=1 与挥拍末帧无缝(发球用松球轨迹终点)
    cea = lerp(e[0], fea, recK); cef = lerp(e[1], fef, recK);
  }
  // 发球起拍:远臂的混合**出发点**换成托球位,与持拍臂的 `from = serveHoldPose(t)` 同一个
  // 起点、同一个 k。待机基准 206→228 之后托球位与基准差 22°,不接管就是 f0→f1 瞬跳
  // (连续性 serve 松球断言实测 10.1°/帧 vs 持拍臂 2.6°)。
  if (swinging && p.serveSwing) { cea = 206; cef = 250; }
  if (swinging && sp) {
    const t = farSwingAngles(p.swingStyle, clamp(poseU, 0, 1), p.serveSwing);
    const k = swT < SW.blendIn ? 1 - (1 - clamp(swT / SW.blendIn, 0, 1)) ** 2 : 1;
    fea = lerp(cea, t[0], k); fef = lerp(cef, t[1], k);
    fef -= Math.cos(sp.ang * D2R) * 6;           // 反相锁:持拍臂越朝网,远臂越朝后
  } else {
    fea = cea; fef = cef;
  }
  // 命中后跟随:远臂反向平衡(近臂横拉过身体,远臂自然外展)。
  // 12→8:待机基准从「甩在身后」改成「垂在胯侧」后,末帧目标已经贴到背缘,再加 12 会把
  // 肘推过 -8 的外露地板(242° → 肘相对肩 -7.5,整条臂缩进躯干里看不见)
  if (ft && poseU > 0.5) {
    fea += (poseU - 0.5) * 2 * 8;
  }

  // 手指向来球:只在远臂已抬起且球在肩以上时轻推,±12° 封顶。绝不做全 IK ——
  // 手一往前上就撞进后脑的遮挡圆,往回缩就没过躯干背缘,两头都坏事。
  // 两重门控都走斜坡:fea 硬切会瞬跳(穿越 195 那条线的是空中 178 / 上网跨步 168 /
  // 庆祝 140 / 挥拍引拍与收拍混合途中,它们进出这条线时角度是连续变化的);待机 228 与
  // 跑动 216~236 全程在 195 之下 = 垂手时不推,正是想要的(旧基准 206±14 也会来回穿越)。
  // |d|>90 = 球在手的反方向,轻推无意义,90~120 淡出 —— 否则 d 扫过 ±180
  // (正对反方向)时 clamp 的符号翻转会让手指瞬跳
  if (ball) {
    const bdx = (ball.x - x) * p.facing, bdy = ball.y - (y + SW.pivotY);
    if (bdy < -6) {
      let d = Math.atan2(-bdy, bdx) / D2R - fef;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      fef += clamp(d, -12, 12)
        * clamp((195 - fea) / 10, 0, 1)
        * clamp((120 - Math.abs(d)) / 30, 0, 1);
    }
  }

  // 三段两色,一档比近侧(5.5 / 5.5 / r3.6)细、压得更狠 → 远侧更细更远。
  // 这里的 alpha 是真透明度(withAlpha 把 a 叠进颜色),不是 drawPlayer 第 4 参那个帧间插值系数。
  // 深袖 + 肤色小臂的分段是「读作手臂」的关键:整条同色会在球衣上读成斜挎的带子。
  const fp = farFK(fea, fef, FAR_UA * body.limbMul, FAR_FA * body.limbMul);
  arm(g, B, th.dark, fp.pts, 5.0 * body.limbMul, 0.68);
  arm(g, B, skinCol, [fp.pts[1], fp.hand], 4.4 * body.limbMul, 0.62);
  // 发球持球时手盘略放大:托球的手型(掌心向上兜着球);起拍松球后随沉降一起收回常态
  drawHand(g, B, fp.hand.x, fp.hand.y, (3.3 + serveBodyK * 0.5) * body.limbMul, 0.66, skinCol);   // 有手 = 是手臂,不是棍子

  // ---------- 腿:两段真关节(髋-膝-踝),脚位目标 + IK 反解 ----------
  // 旧版是「4 个矩形 + 水平偏移假折膝」:膝弯靠小腿矩形整体后移伪装,屈膝时大腿段
  // 被压短,深蹲/跨步的大动态做不开。现在每条腿给一个「踝目标」(poses.ts 的步态/
  // 空中/跨步剪辑),膝由 rig.legIK 几何反解:髋一沉膝就弯,接地约束天然成立。
  // 挥拍期髋点是判定锁定位,蓄力只走「提跟」机制(swingFootLift),不降髋。
  const burstA = C.swing.swingBurst[0];
  const legOn = swinging && !airborne;
  const legU = legOn ? clamp((poseU - burstA) / (1 - burstA), 0, 1) : 0;
  const driveK = Math.sin(legU * Math.PI);                               // 蹬伸:发力窗起,随挥收
  const crouchK = legOn && p.swingStyle === "under"
    ? clamp(poseU / burstA, 0, 1) * (1 - legU) : 0;                      // 蓄力:引拍折腿,发力释放(低球专属)
  const thighL = H * body.hip * 0.55, shinL = H * body.hip * 0.45;   // 大腿/小腿段长(和 = 髋高,站直时踝贴地)
  const kneeGapF = 0.34;                       // 膝盖皮肤段占小腿的比例(短裤与球袜之间)
  // 后腿(远侧)整体压暗 + 收窄,前腿(近侧)受光 —— 前后景深一眼读出侧身
  const legs = [
    { bx: -W * 0.14, sock: "#cdc9bd", shoe: "#141824", s: -1, far: true },
    { bx: W * 0.10, sock: "#f2efe6", shoe: "#1b1f2e", s: 1, far: false },
  ];
  const airK = clamp((p.vy + 3) / 6, 0, 1);           // 0=刚起跳(收腿) 1=快落地(展腿)
  const wAir = airborne ? 1 - runAmt : 0;
  for (const L of legs) {
    // 踝目标:站立兜底 ← 跑步步态/空中(按互补权重)← 深跨步(最优先)。
    // 抬脚与向前摆同相(runFoot):摆动相折膝前抬、触地相蹬伸 —— 真实步态。
    const runF = runFoot(L.bx, (p.runPhase ?? 0) + (L.far ? Math.PI : 0), spN);
    const airF = airFoot(L.bx, L.s, airK);
    const isLeadLeg = L.s * lungeDirRel > 0;
    const lungeF = lungeFoot(L.bx, isLeadLeg, lungeLegExt, lungeDirRel);
    const standF = standFoot(L.bx);
    let fx = lerp(runF.x, airF.x, wAir), fy = lerp(runF.y, airF.y, wAir);
    const wMove = Math.max(runAmt, wAir);
    fx = lerp(standF.x, fx, wMove); fy = lerp(standF.y, fy, wMove);
    fx = lerp(fx, lungeF.x, lungeLegExt); fy = lerp(fy, lungeF.y, lungeLegExt);
    // 分腿垫步:双脚前后错开(重心压低已走 hipDip)
    fx += L.s * splitEnv * C.pose.splitSpread;
    // 挥拍下半身动力链:under 蓄力双腿提跟、over 发力窗后腿蹬伸提跟
    fy -= legOn ? swingFootLift(p.swingStyle, L.far, crouchK, driveK) : 0;
    // 几何反解膝位(膝恒折向网侧 = 人腿唯一可弯方向),越蹲越弯
    const hip: Pt2 = { x: L.bx, y: hipY };
    const foot: Pt2 = { x: fx, y: fy };
    const knee = legIK(hip, foot, thighL, shinL);
    const knee2: Pt2 = { x: lerp(knee.x, foot.x, kneeGapF), y: lerp(knee.y, foot.y, kneeGapF) };
    // 远侧腿:宽度收窄 8%(透视缩短) + 颜色压暗(景深)。压暗走 arm 的 alpha 参数
    // (withAlpha 是覆盖语义,预叠好的 Color 再过一遍会被重置)
    const lw = L.far ? 0.92 : 1.0;
    const farA = L.far ? 0.78 : 1;
    const sockA = L.far ? 0.82 : 1;
    // 圆头笔画两段腿:短裤/大腿 → 膝盖皮肤段 → 球袜,衔接处圆头互叠无断缝
    arm(g, F, th.dark, [hip, knee], 7.6 * lw * body.limbMul, farA);
    arm(g, F, skinCol, [knee, knee2], 5.6 * lw * body.limbMul, farA);
    arm(g, F, L.sock, [knee2, foot], 5.8 * lw * body.limbMul, sockA);
    // 鞋:踝下的厚底,朝网侧前伸(随踝目标起落/分踩)
    px(g, F, fx - 2.5, fy - 1.5, 12.5, H * 0.075, L.far ? withAlpha(pal(L.shoe), 0.80) : pal(L.shoe));
  }

  // ---------- 躯干:3/4 斜侧 —— 沿一条连续脊柱描出(见文件上方 Torso 注释块) ----------
  // 髋部钉住不动、肩部转体,中间由 smoothstep 连续过渡;底色/明暗/领口/下摆/纹样共用
  // 同一条脊柱,所以「腰上台阶」和「色块画到轮廓外」这两类错位在结构上都不可能出现。
  const bodyH = torsoH;
  const tw = W * 0.66, tx = -W * 0.40;
  const shoulderX = lean + runTwist;   // 端点 = 旧「上段(肩)」矩形偏移 → 领口/V领/头肩关系逐帧不变
  // 弓背额外量。旧写法是 |lean-2|*0.35 加进 spineCurve 再乘 Math.sign(lean-2) —— 前者
  // 与 sign 相乘本就等于 0.35*(lean-2)(连续),后者却让另外三项在 lean=2 处整项翻号:
  // 过头挥拍 u≈0.265、跑步换向、退防跨步都会穿过那条线,腰段一帧横跳 ~2.2 单位。
  // 换成连续软符号:远离 0 → ±1(方向照旧由前倾侧决定),穿过 0 → 平滑归 0。
  const dev = lean - 2;
  const bow = ((swinging ? Math.sin(Math.min(poseU, 1) * Math.PI) * 1.5 : 0)
    + Math.abs(lungeLean) * 0.15
    + Math.abs(cycRaw) * 0.4 * runAmt * spN) * (dev / (Math.abs(dev) + 0.5));
  /** v=0 肩 → v=1 髋。smoothstep(本文件 readyK 处已手写过一次 k*k*(3-2*k)):两端导数为 0
   *  → 骨盆不被剪、肩部不收口,弯曲集中在胸腰交界(腰椎本来就几乎不动)。 */
  const spineX = (v: number): number => {
    const u = 1 - v;
    return shoulderX * (u * u * (3 - 2 * u)) + bow * Math.sin(u * Math.PI);
  };
  const T = makeTorso(tx, bodyTop, bodyH, tw, spineX);
  torsoBand(g, F, T, 0, 1, 0, 1, th.main);
  // 前缘受光 / 背缘背光:旧写法两条一对(肩段一对、髋段一对),中间在 y∈[17,21] 留了
  // 4 单位无明暗的死区,正好压在腰上读成一道"腰带"。现在各收成一条,沿脊柱贯通。
  torsoBand(g, F, T, 5 / bodyH, 1 - 4 / bodyH, 1 - 3 / tw, 1, "rgba(255,255,255,0.18)");
  torsoBand(g, F, T, 5 / bodyH, 1 - 4 / bodyH, 0, 3 / tw, "rgba(0,0,0,0.22)");
  // 领口从脖子前沿(x=2)往网侧延伸:若拖到脖子后面,会在颈后留一块没归属的深色补丁。
  // 宽度地板由 torsoBand 兜住 —— 退防跨步时躯干前缘会退到 x=2 之后,那时不该有领口。
  torsoBand(g, F, T, 0, 5 / bodyH, 0, 1, th.dark, 2);
  // 下摆亮边:spineX(1)=0 → 恒贴髋段背缘,与衣摆齐髋后正好落在短裤上沿
  torsoBand(g, F, T, 1 - 4 / bodyH, 1, 0.25, 1, "rgba(255,255,255,0.20)");
  // V 领:躯干上段顶部中央的 V 形线条,运动球衣的领口细节
  const vCollarCx = T.pt(0, 0).x + tw * 0.52;
  const vCollarTop = bodyTop + 3;
  g.strokeColor = withAlpha(pal(FACE), 0.30);
  g.lineWidth = F.lw(1.2);
  lineSeg(g, F, vCollarCx - 3.5, vCollarTop, vCollarCx, vCollarTop + 5.5);
  lineSeg(g, F, vCollarCx, vCollarTop + 5.5, vCollarCx + 3.5, vCollarTop);
  g.stroke();
  // 侧条纹:躯干前缘一道纵向亮线,运动球衣的常见装饰
  // (旧写法 6 + 0.82·bodyH 会越过下摆 0.24 单位,矩形件时看不出来,脊柱带会照原样画到
  //  轮廓外,所以在这里夹住)
  torsoBand(g, F, T, 6 / bodyH, Math.min(1, 6 / bodyH + 0.82), 0.18, 0.18 + 1.5 / tw, "rgba(255,255,255,0.10)");

  // ---------- 跨步后 1 秒内身体疾风残影与流光动效 (配合跨步重击) ----------
  if (p.lungeShotT > 0) {
    const windAlpha = (p.lungeShotT / C.lunge.shotWindow) * 0.6;
    const wave = Math.sin(t * 0.3) * 2;
    // 躯干背侧流线风道短线
    g.strokeColor = withAlpha(pal("#38bdf8"), windAlpha * 0.8);
    g.lineWidth = F.lw(2.5);
    const wy1 = bodyTop + bodyH * 0.2;
    const wy2 = bodyTop + bodyH * 0.55;
    const wy3 = bodyTop + bodyH * 0.8;
    lineSeg(g, F, tx - 14 - wave, wy1, tx - 2, wy1);
    lineSeg(g, F, tx - 18 + wave, wy2, tx - 3, wy2);
    lineSeg(g, F, tx - 12 - wave, wy3, tx - 2, wy3);
    g.stroke();
    // 躯干周围青色风晕
    // 躯干周围青色风晕:跟着脊柱外扩一圈 —— 躯干已经不再是一根轴对齐的柱子,
    // 用 `tx-3, bodyTop-3, tw+6, bodyH+6` 那种矩形框去包,前压/后仰时会露出半边。
    torsoBand(g, F, T, -3 / bodyH, 1 + 3 / bodyH, -3 / tw, 1 + 3 / tw,
      withAlpha(pal("#38bdf8"), windAlpha * 0.22));
  }

  // 闪现折跃三段:① 来向速度线(人刚从那边过来)② 落位蓄力雷环(时停那几帧)③ 残余电弧
  const FL = C.skills.flash;
  const flashHold = p.flashHoldT ?? 0;
  const ghost = clamp((p.flashT ?? 0) / FL.ghostFrames, 0, 1);
  if (p.flashFrom && ghost > 0) {
    // 残影不真复制一个人(要另起一条绘制链、且和姿势插值抢状态),用三条朝来路收拢的
    // 青色速度线说"人刚从那儿折跃过来"—— 便宜,也不会糊住人物本体
    const side = (p.flashFrom.x - p.x) * p.facing > 0 ? 1 : -1;
    g.strokeColor = withAlpha(pal("#00f0ff"), ghost * 0.6);
    g.lineWidth = F.lw(2);
    for (let i = 0; i < 3; i++) {
      const ly = bodyTop + bodyH * (0.18 + i * 0.3);
      const x0 = tx - side * (16 + i * 5);
      lineSeg(g, F, x0, ly, x0 - side * (16 + 14 * ghost), ly);
    }
    g.stroke();
  }
  if (flashHold > 0) {
    // 环随剩余帧向外扩张、电弧随剩余帧收紧:能量从四周收拢到身上这一格
    const k = clamp(flashHold / FL.holdFrames, 0, 1);
    const cx = tx + tw * 0.5, cy = bodyTop + bodyH * 0.45;
    const rr = 20 + 26 * (1 - k);
    g.lineWidth = F.lw(2.2);
    g.strokeColor = withAlpha(pal("#ffe14d"), 0.32 + 0.4 * k);
    circleAA(g, F, cx, cy, rr);
    g.stroke();
    g.lineWidth = F.lw(1.2);
    g.strokeColor = withAlpha(pal("#00f0ff"), 0.24 + 0.34 * k);
    circleAA(g, F, cx, cy, rr * 0.62);
    g.stroke();
    g.lineWidth = F.lw(1.8);
    g.strokeColor = withAlpha(pal("#ffe14d"), 0.5 + 0.4 * k);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + (1 - k) * 1.2;
      const ca = Math.cos(a), sa = Math.sin(a);
      lineSeg(g, F, cx + ca * rr, cy + sa * rr, cx + ca * (rr + 9 + 8 * k), cy + sa * (rr + 9 + 8 * k));
    }
    g.stroke();

    // 拍头与球体之间的闪电引信电弧 (悬空蓄力时球与拍高压雷弧吸附)
    if (ball) {
      const bdx = (ball.x - x) * p.facing;
      const bdy = ball.y - y;
      g.lineWidth = F.lw(2.0);
      g.strokeColor = withAlpha(pal("#ffe14d"), 0.85 * k);
      const jx = (bdx * 0.5) + (Math.sin(t * 0.6) * 6);
      const jy = (bdy * 0.5) + (Math.cos(t * 0.6) * 5);
      lineSeg(g, F, cx, cy, jx, jy);
      lineSeg(g, F, jx, jy, bdx, bdy);
      g.stroke();
    }
  }
  if (ghost > 0) {
    const flashA = ghost * 0.85;
    g.strokeColor = withAlpha(pal("#eab308"), flashA);
    g.lineWidth = F.lw(2.6);
    lineSeg(g, F, tx - 8, bodyTop - 8, tx + 6, bodyTop + 12);
    lineSeg(g, F, tx + 6, bodyTop + 12, tx - 2, bodyTop + 24);
    lineSeg(g, F, tx - 2, bodyTop + 24, tx + 14, bodyTop + bodyH);
    g.stroke();
  }

  // 引力吸球向心涡旋力场
  if (p.skill && p.skill.magnetPulling) {
    const rot = t * 0.18;
    const cx = tx + tw * 0.5 + 14, cy = bodyTop + bodyH * 0.45;
    // 双层向心旋转吸积环
    g.lineWidth = F.lw(2.2);
    g.strokeColor = withAlpha(pal("#a855f7"), 0.75);
    polyPath(g, arcPts(F, cx, cy, 22, rot, rot + Math.PI * 1.25, false), false);
    polyPath(g, arcPts(F, cx, cy, 22, rot + Math.PI, rot + Math.PI * 2.25, false), false);
    g.stroke();
    g.lineWidth = F.lw(1.4);
    g.strokeColor = withAlpha(pal("#00f0ff"), 0.6);
    polyPath(g, arcPts(F, cx, cy, 14, -rot * 1.5, -rot * 1.5 + Math.PI * 1.15, false), false);
    polyPath(g, arcPts(F, cx, cy, 14, -rot * 1.5 + Math.PI, -rot * 1.5 + Math.PI * 2.15, false), false);
    g.stroke();
    // 奇点能量核
    g.fillColor = withAlpha(pal("#ffffff"), 0.9);
    circleAA(g, F, cx, cy, 3.2);
    g.fill();
  }

  // 百分百重击聚能暴气:全身升腾烈焰斗气与火浪
  if (p.skill && p.skill.id === "smash" && p.skill.buffT > 0) {
    const buffK = clamp(p.skill.buffT / C.skills.smash.buffDuration, 0.2, 1);
    const flameCycle = t * 0.24;
    // 脚底烈焰脉冲光环
    const pulseR = 16 + Math.sin(flameCycle * 1.6) * 4.5;
    g.strokeColor = withAlpha(pal("#ff4d4d"), 0.5 * buffK);
    g.lineWidth = F.lw(2.6);
    circleAA(g, F, 0, 0, pulseR);
    g.stroke();
    g.strokeColor = withAlpha(pal("#ffe14d"), 0.35 * buffK);
    circleAA(g, F, 0, 0, pulseR * 0.68);
    g.stroke();

    // 躯干升腾的 5 朵火焰斗气微波
    g.lineWidth = F.lw(2.2);
    for (let i = 0; i < 5; i++) {
      const fxPos = tx + (i / 4) * tw;
      const fPhase = flameCycle + i * 1.35;
      const fRise = 8 + ((flameCycle * 7 + i * 9) % 26);
      const fWiggle = Math.sin(fPhase) * 3.5;
      const fCol = i % 2 === 0 ? "#ff4d4d" : "#ffe14d";
      g.strokeColor = withAlpha(pal(fCol), 0.7 * buffK * (1 - fRise / 26));
      lineSeg(g, F, fxPos, bodyTop + bodyH - 3, fxPos + fWiggle, bodyTop - fRise);
    }
    g.stroke();

    // 身体外缘金红火晕
    px(g, F, tx - 4, bodyTop - 4, tw + 8, bodyH + 8, withAlpha(pal("#ff6a1f"), 0.20 * buffK));
  }

  // 时空减速:身体周围散发淡青色时空领域微澜
  if (p.focusT && p.focusT > 0) {
    const focusAlpha = clamp(p.focusT / C.skills.focus.duration, 0, 1);
    const chronoR = 24 + Math.sin(t * 0.15) * 5;
    g.strokeColor = withAlpha(pal("#06b6d4"), 0.40 * focusAlpha);
    g.lineWidth = F.lw(1.8);
    circleAA(g, F, 0, bodyTop + bodyH * 0.5, chronoR);
    g.stroke();
  }
  // ---------- 球衣纹样(设计款人物专属):压在底色上、领口描边之下 ----------
  // 注册表分发:key 在 config.SKINS.player[].jersey;glow 色做纹样主色。
  // 参考系 = 躯干本身(同一份脊柱行格):纹样逐行取底色画过的那条 x,所以拼色带/腰带/
  // 斜披巾都不可能画到轮廓外,也不会随挥拍与衣身错开一个腰。
  if (ps?.jersey && OUTFITS[ps.jersey]) {
    OUTFITS[ps.jersey](g, F, th, T);
  }
  // 胸前号码:已取消(不画、也不由表现层挂 Label)。老版曾在局部 (1, bodyTop + bodyH*0.40)
  // 以 700 H*0.115px "DIN Alternate" 居中画 p.jersey,色 rgba(255,255,255,0.8);
  // p.jersey 仅作数据保留,world.ts 的名牌池只喂头顶名牌。

  // ---------- 头(代码绘制的 3/4 卡通头) ----------
  // 头抬高到下巴不压肩:肩关节露在脖子下面,手臂才是从肩膀长出来的;
  // 颈子补在头和领口之间,避免下巴悬空。
  // 挥拍时头随动作俯仰(over 抬头盯球 / under 压头发力),位置随躯干拧转前移
  const swingHeadDy = swinging
    ? (p.swingStyle === "over" ? -1.6 : 1.2) * Math.sin(Math.min(poseU, 1) * Math.PI) : 0;
  // 跑步头部律动:随步频微动(幅度小于身体 bob——头要稳定)
  const runHeadBob = -Math.abs(cycRaw) * 0.6 * runAmt;
  // 落地低头:squash 降低时头部下沉,随恢复抬起
  const landHeadTuck = (p.sq < 0.85 && p.onGround) ? (1 - p.sq) * 4 : 0;
  // 跨步倾斜:头朝跨步方向微倾
  const lungeHeadTilt = lungeLean * lungeDirRel * 0.15;
  const headDy = swingHeadDy + runHeadBob + landHeadTuck + lungeHeadTilt
    + whiffK * 1.5;   // 挥空踉跄:头跟着前冲微低
  // 眼神追球:瞳孔朝球的方向偏一点(局部坐标);没球时看向前方。眨眼按相位错开的
  // 周期触发,无状态 —— 不用给每个角色维护计时器
  let lookX = 0.6, lookY = 0;
  if (ball) {
    const ldx = (ball.x - x) * p.facing, ldy = ball.y - (y - H * 0.9);
    const ld = Math.hypot(ldx, ldy) || 1;
    lookX = ldx / ld * 1.3; lookY = ldy / ld * 1.3;
  }
  const blink = ((t + (p.blinkSeed ?? 0)) % 220) < 5;
  const hr = H * 0.21 * body.headMul;
  px(g, F, -1 + (lean - 2) * 0.6, bodyTop - 7, 6, 9, skinCol);
  drawHead(g, F, th, hr, 2 + (lean - 2) * 0.6, bodyTop - hr * 1.12 + headDy,
    { lookX, lookY, blink, t, face: p.face, faceT: p.faceT, faceD: p.faceD, skin: ps,
      faceStyle, skinTone: ps?.skinTone, focusT: p.focusT });

  // ---------- 持拍臂:一条姿势管线,挥拍弧线 ↔ 待机收拍全程连续 ----------
  // 命中后持拍臂横拉过身体:肩点朝网侧额外偏移(增强跟随感)
  const ftPull = (ft && poseU > 0.6) ? (poseU - 0.6) * 2.5 * p.facing : 0;
  // 肩点在躯干上段内,随拧转前移;跑步肩高差与远肩反向。挥拍判定窗内 readyDip/serveDip
  // 都已归零、restDip 已被 swingFade 融掉 —— 判定锁定位不动
  const A = offsetFrame(F, 1.5 + (lean - 2) * 0.8 + ftPull,
    SW.pivotY + bob + readyDip + serveDip + restDip - runShDy);
  let pose: Pose;
  const prevAng = lastAng.get(angKey(p)) ?? null;
  if (swinging && sp) {
    // 腕部甩击:判定窗关闭后拍角才允许越过臂角,随挥末端过冲再弹回 —— 期间不碰判定
    const wU = (SW.windup + SW.active) / Physics.swingTotal();
    const wrist = sp.u > wU
      ? Math.sin((sp.u - wU) / (1 - wU) * Math.PI) * SW.wristOvershoot : 0;
    const dir = Math.sign(sp.to - sp.from) || 1;
    pose = swingArmPose(sp.ang + dir * wrist, sp.reach, sp.u, p.swingStyle);
    if (swT < SW.blendIn) {
      // 起拍过渡:上一拍没收完就从那里接,否则从待机;easeOut 让引拍先快后缓。
      // 出发姿势带上架拍权重(readyK 是未门控的信号值):从架拍位起拍,拍子不跳回待机。
      // 发球起拍(p.serveSwing)再往 SERVE_POSE 拉:等待期显示的就是这个低持位,
      // 出发点与弧线起点只差 ~10°,拍子不是甩下去的,是从持球位直接推进弧线
      let from = poseLerp(recoverPose(pp.lastSwingStyle ?? p.swingStyle, pp.lastSwingRadius ?? p.swingRadius, recK),
        READY_POSE, readyK);
      if (p.serveSwing) from = poseLerp(from, serveHoldPose(t), serveK);
      pose = poseLerp(from, pose,
        1 - (1 - clamp(swT / SW.blendIn, 0, 1)) ** 2);
    }
    lastAng.set(angKey(p), pose.ang);
    const inWin = swT >= Math.max(SW.windup, SW.blendIn) && swT <= SW.windup + SW.active;
    if (inWin) {
      // 弧光:上一帧视觉角 → 本帧视觉角,半径用同一份呼吸值,跟着手臂走
      const isSweet = p.sweetGlow > 0 || p.perfectGlow > 0;
      const mainA = isSweet ? 0.75 : 0.34;
      // 设计款球拍专属弧光:swingFx → 主/副双色对(rainbow 随时间变相)
      const fxPair = swingFxPair(p.racketSkin, t);
      const arcColor = isSweet ? "#ffffff" : p.contactFlash > 0 ? "#ffffff" : (fxPair ? fxPair[0] : C.colors.accent);
      const arcW = isSweet ? 14 : 10;
      // canvas arc(0,0,r,-a0,-a1, a1>a0):扫向由挥拍角增减决定,采样按 canvas 语义复刻
      const arc = arcPts(A, 0, 0, sp.reach, -(prevAng ?? pose.ang) * D2R, -pose.ang * D2R, pose.ang > (prevAng ?? pose.ang));
      if (isSweet) {
        // shadowBlur(金晕 12)近似:同路径加宽一道的低透明度描边
        g.strokeColor = withAlpha(pal(C.colors.sweet ? C.colors.sweet.gold : "#ffe14d"), 0.30 * mainA);
        g.lineWidth = A.lw(arcW) + 7;
        polyPath(g, arc, false);
        g.stroke();
      }
      if (fxPair) {
        // 设计款副光:外圈宽一道的低透明度描边(火焰/寒冰/雷电辉光)
        g.strokeColor = withAlpha(pal(fxPair[1]), 0.30 * mainA);
        g.lineWidth = A.lw(arcW) + 6;
        polyPath(g, arc, false);
        g.stroke();
      }
      g.strokeColor = withAlpha(pal(arcColor), mainA);
      g.lineWidth = A.lw(arcW);
      polyPath(g, arc, false);
      g.stroke();
      // 挥拍弧光残影:老代码推入 FX 数组由 fx.js 衰减渲染;移植版经 sink 交还表现层。
      // color/color2 原样传给残影,专属风格的辉光在残影里同步衰减
      const shoulderX = x + p.facing * (1.5 + (lean - 2) * 0.8);
      const shoulderY = y + SW.pivotY + bob;
      if (swingArcSink) {
        swingArcSink({
          x: shoulderX, y: shoulderY,
          facing: p.facing,
          fromAng: prevAng ?? pose.ang, ang: pose.ang,
          reach: sp.reach,
          color: arcColor,
          color2: fxPair ? fxPair[1] : undefined,
          isSweet,
        });
      }
    }
  } else if (p.recoverT > 0) {
    pose = recoverPose(pp.lastSwingStyle ?? p.swingStyle, pp.lastSwingRadius ?? p.swingRadius, recK);   // 收拍回摆:弧线终点 → 待机,渐出
    lastAng.set(angKey(p), null);
  } else if (celebrating) {
    // 庆祝姿势:拍举高,手臂上扬(实现在 poses.ts,肘由 armIK 反解)
    pose = celebratePose(Math.sin(celebrateU * Math.PI));
    lastAng.set(angKey(p), null);
  } else if (frustrated) {
    // 沮丧姿势:拍低垂,近直臂 limp
    pose = frustratePose(Math.sin(frustrateU * Math.PI));
    lastAng.set(angKey(p), null);
  } else {
    lastAng.set(angKey(p), null);
    // 待机:屈肘把拍收在体前 + 呼吸微摆(拍角/手位随呼吸漂移)。
    // 跑动携带:拍随步伐轻晃 —— 持拍手跟着步频一颠一颠,不再像焊死的;幅度压小,
    // 跑动中拍子仍保持在体前的「可起拍位」。发球等待在此之上向 SERVE_POSE 渐入
    // (serveK):球飞回手时同步落位,拍沉到体前腰高与起拍第一帧对齐。
    const carryBob = Math.abs(cycRaw) * C.pose.runCarryBob * runAmt;
    const carrySway = Math.sin(p.runPhase ?? 0) * C.pose.runCarrySway * runAmt;
    const idlePose: Pose = {
      hand: { x: IDLE_POSE.hand.x, y: IDLE_POSE.hand.y + Math.sin(t * 0.025) * 1.2 + carryBob },
      bend: IDLE_POSE.bend,
      ang: IDLE_POSE.ang + Math.sin(t * 0.025) * 2.5 + carrySway,
      len: IDLE_POSE.len,
    };
    pose = poseLerp(idlePose, serveHoldPose(t), serveK);
  }
  // 来球预备架拍:后置混合级 —— 待机/收拍姿势整体往架拍位拉。挥拍分支不进(readyW=0),
  // 收拍期权重随 recK 长出来,与弧线终点无缝。*readyBreath 给架拍位留一点呼吸,
  // 满权重时拍子不是冻住的
  if (readyW > 0) {
    pose = poseLerp(pose, READY_POSE, readyW * (0.9 + 0.1 * Math.sin(t * 0.028)));
  }
  // 深跨步够球(纯视觉,上网方向):把拍往跨步侧前下伸 —— 「手要伸到球的前下方」。
  // 退防跨步不前伸(拍保持在架拍位),远臂的后甩平衡已由远臂分支负责。
  if (lunging && !swinging && !celebrating && !frustrated && lungeDirRel > 0) {
    const lungePose: Pose = { hand: { x: 24, y: 18 }, bend: 62, ang: 14, len: 26 };
    pose = poseLerp(pose, lungePose, lungeLegExt);
  }
  // 上臂深色衣袖 + 前臂露肤色:整条深色会在球衣上读成「斜挎的带子」。
  // 肘位由 armIK 反解:两段恒等长、弯折量 = pose.bend,不再是硬点坐标。
  const ik = armIK(pose.hand, pose.bend);
  arm(g, A, th.dark, [{ x: 0, y: 0 }, ik.elbow], 5.5 * body.limbMul);
  arm(g, A, skinCol, [ik.elbow, pose.hand], 5.5 * body.limbMul);
  drawRacket(g, A, pose.hand.x, pose.hand.y, pose.ang, pose.len, th, p);
  drawHand(g, A, pose.hand.x, pose.hand.y, 3.6 * body.limbMul, 1, skinCol);
  // 肩关节衔接件:手臂从肩头长出来,不再从躯干边缘凭空伸出
  g.fillColor = pal(th.dark);
  circleAA(g, A, 0, 0, 4.5);
  g.fill();

  // 角色头顶操控指示标(名牌已取消:名字标签不再显示)
  if (!p.hideTag) {
    drawPlayerCursor(g, vp, p, x, y, t);
  }
}

// ---------- 角色头顶操控指示标: 主控玩家专属悬浮倒三角 ▼ ----------
// 名字名牌(YOU / P1 / P2 / 搭档 / CPU 胶囊 + 表现层 Label)已取消,这里只剩光标。
function drawPlayerCursor(g: Graphics, vp: Viewport, p: Player, x: number, y: number, t: number): void {
  const label = p.label || (p.isAI ? "AI" : "YOU");
  const isMainUser = (!p.isAI && (label === "你" || label === "P1" || label === "YOU"));
  if (!isMainUser) return;

  // 光标仍钉在旧名牌中心线上方 14 的位置(名牌取消后位置不变,不下移)
  const tagY = y - C.player.h - 18;
  const bob = Math.sin((t || 0) * 0.14) * 2.2;
  const arrowY = tagY - 14 + bob;
  // 顶点坐标取整，且保持倒三角完全对称
  const tipX = Math.round(vp.x(x));
  const tipY = Math.round(vp.y(arrowY + 5));
  const topY = Math.round(vp.y(arrowY));
  const halfW = Math.round(4.5 * Math.abs(vp.x(1) - vp.x(0)));

  g.fillColor = pal(p.side === "left" ? "#ffe14d" : "#3ea8ff");
  polyPath(g, [
    { x: tipX, y: tipY },
    { x: tipX - halfW, y: topY },
    { x: tipX + halfW, y: topY },
  ], true);
  g.fill();
}

// ---------- 头:脸面注册表 + 队色发带(商店「面部皮肤」) ----------
// 脸面数据(脸底/描边/五官墨色/腮红/特征标记)在 config.faceStyles,按 faceStyle key 取;
// 未知 key 兜回墨面款(经典/CPU 默认)。肤色系支持 skinTone 覆写脸底(人物形象的肤色)。
// 表情种类见 types.FaceKind;局部 +x = 朝球网:近侧眼大、远侧眼小,瞳位随 opt.look 追球。
// 注意 cc.Graphics 的 fill()/stroke() 会消费当前路径(弧光双描边处靠重建路径证实),
// 所以「填充 + 描边」同一形状必须重建路径,攒路径后一次性 stroke 与 canvas 同构。
function drawHead(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number,
  opt: { lookX?: number; lookY?: number; blink?: boolean; t?: number; face?: FaceKind; faceT?: number; faceD?: number;
    skin?: SkinDef | null; faceStyle?: string; skinTone?: string; focusT?: number } = {}): void {
  const lx = opt.lookX || 0, ly = opt.lookY || 0;
  const face: FaceKind = (opt.faceT ?? 0) > 0 ? (opt.face ?? "normal") : "normal";
  const sk = opt.skin ?? null;
  const st0 = C.faceStyles[opt.faceStyle ?? "ink"] ?? C.faceStyles.ink;
  // 肤色系脸面支持人物形象的 skinTone 覆写脸底(墨面是剪影,不吃肤色)
  const st = opt.skinTone && opt.faceStyle !== "ink" ? { ...st0, base: opt.skinTone } : st0;
  const ink = st.ink;                       // 五官用色(各款式自己的"墨")

  // 脸圆:墨面款近黑填充 + 淡白描边(暗色球馆里勾轮廓);肤色款与手臂同肤色 + 同款描边
  g.fillColor = pal(st.base);
  circleAA(g, f, cx, cy, hr);
  g.fill();
  g.strokeColor = pal(st.line);
  circleAA(g, f, cx, cy, hr);
  g.lineWidth = f.lw(1.6);
  g.stroke();

  // 头顶高光:一道极淡反光弧,墨面款不至于闷成纯色块;浅色脸上稍提亮才看得见
  g.strokeColor = withAlpha(pal(FACE), st.hi ?? 0.15);
  g.lineWidth = f.lw(2.5);
  polyPath(g, arcPts(f, cx, cy, hr * 0.76, Math.PI * 1.12, Math.PI * 1.42, false), false);
  g.stroke();

  // ---------- 发型/头饰(设计款):注册表分发,未知 key 兜回默认 ----------
  if (sk?.hairStyle && sk.hairColor) {
    (HAIRS[sk.hairStyle] ?? HAIRS.short)(g, f, sk.hairColor, hr, cx, cy);
  }

  // 头饰(设计款)替换默认队色发带;ribbon 自带头带 + 结饰
  const hw = sk?.headwear;
  if (hw && HEADWEARS[hw]) {
    HEADWEARS[hw](g, f, th, hr, cx, cy, opt.t ?? 0);
  } else {
    // 队色发带:压在头顶,两款脸上的红蓝阵营识别都靠它
    drawBand(g, f, th, hr, cx, cy);
  }

  // ---------- 五官基线:眼距沿用 3/4 透视(网侧大、背侧小) ----------
  const exN = cx + hr * 0.40, exF = cx - hr * 0.16;   // 近/远眼 x
  const eyN = cy + hr * 0.10, eyF = cy + hr * 0.14;   // 近/远眼 y(远眼略低)
  const mx = cx + hr * 0.17, my = cy + hr * 0.34;     // 嘴基点(偏网侧)
  g.fillColor = pal(ink);
  g.strokeColor = pal(ink);

  switch (face) {
    case "fierce": {
      // 斜怒眉(内端压向鼻梁)+ 紧咬直线嘴 + 圆点眼
      g.lineWidth = f.lw(1.5);
      lineSeg(g, f, exN + 2.0, eyN - 4.8, exN - 1.8, eyN - 2.6);
      lineSeg(g, f, exF + 1.7, eyF - 3.0, exF - 1.7, eyF - 4.8);
      lineSeg(g, f, mx - 1.5, my + 0.2, mx + 4.5, my - 0.4);
      g.stroke();
      dotEyes(g, f, exN, eyN, exF, eyF, lx, ly, ink);
      break;
    }
    case "star": {
      // ✦ 十字星眼 + 笑弧
      g.lineWidth = f.lw(1.3);
      sparkle(g, f, exN + lx, eyN + ly, 2.5);
      sparkle(g, f, exF + lx * 0.7, eyF + ly, 1.9);
      g.stroke();
      smileArc(g, f, mx + 0.5, my - 1.2, 3.2);
      break;
    }
    case "wow":
    case "oops": {
      // 大圆眼 + 惊 o 嘴(wow)/波浪嘴(oops)
      circleAA(g, f, exN + lx, eyN + ly, 2.6);
      g.fill();
      circleAA(g, f, exF + lx * 0.7, eyF + ly, 2.0);
      g.fill();
      if (face === "wow") {
        g.lineWidth = f.lw(1.3);
        circleAA(g, f, mx + 1.2, my + 0.6, 1.7);
        g.stroke();
      } else {
        wavyMouth(g, f, mx, my);
      }
      break;
    }
    case "happy":
    case "cheer": {
      // ∩∩ 笑眼;大笑弧(happy)/白色半圆张嘴(cheer)
      g.lineWidth = f.lw(1.5);
      polyPath(g, arcPts(f, exN + lx, eyN + 0.8, 2.1, Math.PI, 0, false), false);
      polyPath(g, arcPts(f, exF + lx * 0.7, eyF + 0.8, 1.6, Math.PI, 0, false), false);
      g.stroke();
      if (face === "cheer") {
        g.fillColor = pal(ink);
        polyPath(g, arcPts(f, mx + 1, my - 1.4, 3.3, Math.PI * 0.06, Math.PI * 0.94, false), true);
        g.fill();
      } else {
        smileArc(g, f, mx + 0.5, my - 1.4, 3.4);
      }
      break;
    }
    case "sad": {
      // 无力眼线(外端下垂)+ 倒弧嘴
      g.lineWidth = f.lw(1.4);
      lineSeg(g, f, exN - 1.6, eyN - 0.6, exN + 1.7, eyN + 0.6);
      lineSeg(g, f, exF + 1.6, eyF - 0.4, exF - 1.7, eyF + 0.6);
      g.stroke();
      g.lineWidth = f.lw(1.3);
      polyPath(g, arcPts(f, mx + 1.5, my + 1.6, 2.5, Math.PI * 1.12, Math.PI * 1.88, false), false);
      g.stroke();
      break;
    }
    case "ko": {
      // XX 眼 + 波浪嘴
      g.lineWidth = f.lw(1.4);
      crossEye(g, f, exN, eyN, 1.8);
      crossEye(g, f, exF, eyF, 1.4);
      g.stroke();
      wavyMouth(g, f, mx, my);
      break;
    }
    default: {
      // normal:白点眼(追球)+ 眨眼横线 + 短平线嘴
      if (opt.blink) {
        g.lineWidth = f.lw(1.4);
        lineSeg(g, f, exN - 1.8 + lx, eyN, exN + 1.8 + lx, eyN);
        lineSeg(g, f, exF - 1.3 + lx * 0.7, eyF, exF + 1.3 + lx * 0.7, eyF);
        g.stroke();
      } else {
        dotEyes(g, f, exN, eyN, exF, eyF, lx, ly, ink);
      }
      g.lineWidth = f.lw(1.3);
      lineSeg(g, f, mx - 0.5, my, mx + 3.8, my + 0.4);
      g.stroke();
      break;
    }
  }

  // 心情腮红(肤色系脸面):好心情表情在两颊点两团淡粉,3/4 透视近颊略大
  if (st.blush && (face === "happy" || face === "cheer" || face === "star")) {
    g.fillColor = pal(BLUSH);
    circleAA(g, f, cx + hr * 0.56, cy + hr * 0.30, hr * 0.15);
    g.fill();
    circleAA(g, f, cx - hr * 0.40, cy + hr * 0.32, hr * 0.11);
    g.fill();
  }

  // 特征标记(雀斑/泪痣/猫须/白眉须):注册表分发,画在五官之上、贴纸之下
  if (st.mark) {
    (FACE_MARKS[st.mark] ?? (() => {}))(g, f, cx, cy, hr, ink);
  }

  // 时空减速鹰眼激光流光 (Focus Zone Trail)
  if (opt.focusT && opt.focusT > 0) {
    const fA = clamp(opt.focusT / C.skills.focus.duration, 0, 1) * 0.92;
    g.strokeColor = withAlpha(pal("#06b6d4"), fA);
    g.lineWidth = f.lw(2.2);
    lineSeg(g, f, exN + lx, eyN + ly, exN + lx - 15, eyN + ly - 5);
    lineSeg(g, f, exN + lx - 4, eyN + ly - 1, exN + lx - 22, eyN + ly - 8);
    g.stroke();
    g.fillColor = withAlpha(pal("#ffffff"), fA);
    circleAA(g, f, exN + lx, eyN + ly, 2.0);
    g.fill();
  }

  drawFaceSticker(g, f, opt.t ?? 0, face, opt.faceT ?? 0, opt.faceD ?? 1, cx, cy, hr);
}

// ---------- 商店面部款预览:大头像(与上场同一套 drawHead 笔画) ----------
// career-panel 的面部 tab 缩略图/试衣间用;expr 传表情种类,faceT 给到 666(>600 = 贴纸
// 走「定格」分支:pop 完成且不淡出),让表情与贴纸都以最终成色示人。
// faceStyle 为注册表 key;"auto"(人物默认)在预览里按默认人物的肤色脸示人;
// skinTone 可选:预览自定义肤色的脸面配色(pose-preview 的配色验收用)。
export function drawHeadStill(g: Graphics, vp: Viewport, wx: number, wy: number, scale: number,
  th: Theme, faceStyle: string, expr: FaceKind, t: number, skinTone?: string): void {
  const f = playerFrame(vp, wx, wy, 1, scale, scale);
  const style = faceStyle === "auto" ? "skin" : faceStyle;
  drawHead(g, f, th, 20, 0, 0, { t, face: expr, faceT: expr === "normal" ? 0 : 666, faceD: 666, faceStyle: style, skinTone });
}

// ---------- 设计款发型与头饰零件(全部局部坐标,角度沿用 canvas y 向下约定:
// π..2π = 头顶上半圆,+x = 朝球网侧。「填充+描边」必须重建路径再 stroke) ----------
// 注册表模式:新发型/头饰 = 写一个绘制函数挂进 HAIRS/HEADWEARS,再到 config.SKINS
// 引用 key —— 新人物形象零改动 sprites 的分发逻辑。

type HairFn = (g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number) => void;
type HwFn = (g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number, t: number) => void;

/** 发型注册表:key → 绘制函数(sprites 消费 config.SKINS.player[].hairStyle) */
const HAIRS: Record<string, HairFn> = {
  spiky: drawHairSpiky,
  mohawk: drawHairMohawk,
  short: drawHairCover,
  bun: (g, f, c, hr, cx, cy) => { drawHairCover(g, f, c, hr, cx, cy); drawHairBun(g, f, c, hr, cx, cy); },
  twin: (g, f, c, hr, cx, cy) => { drawHairCover(g, f, c, hr, cx, cy); drawHairTwin(g, f, c, hr, cx, cy); },
  bob: (g, f, c, hr, cx, cy) => { drawHairBob(g, f, c, hr, cx, cy); drawHairSprout(g, f, c, hr, cx, cy); },
  long: (g, f, c, hr, cx, cy) => { drawHairCover(g, f, c, hr, cx, cy); drawHairLong(g, f, c, hr, cx, cy); },
};

/** 头饰注册表:key → 绘制函数;无 key 或未知 key = 默认队色发带 */
const HEADWEARS: Record<string, HwFn> = {
  cap: drawCap,
  crown: (g, f, _th, hr, cx, cy) => drawCrown(g, f, hr, cx, cy),
  goggles: drawGoggles,
  bandana: drawBandana,
  ribbon: (g, f, th, hr, cx, cy) => { drawBand(g, f, th, hr, cx, cy); drawRibbon(g, f, th, hr, cx, cy); },
  catears: drawCatEars,
};

/** 球衣纹样注册表:key → 绘制函数。t = 躯干(与底色同一份脊柱行格)
 *  纹样一律走 torsoBand / 行格端点,不自己算 x —— 旧写法拿肩段的 jx 去画腰腹以下的图案,
 *  挥拍前压时色带比身体多出一截画在背景上、另一侧又露出底色。 */
type OutfitFn = (g: Graphics, f: Frame, th: Theme, t: Torso) => void;

const OUTFITS: Record<string, OutfitFn> = {
  // 霓虹双条纹:前胸两道竖纹(赛博骇客)
  stripes: (g, f, th, t) => {
    const v0 = 4 / t.h;
    torsoBand(g, f, t, v0, v0 + 0.86, 0.30, 0.30 + 2 / t.w, withAlpha(pal(th.glow), 0.9));
    torsoBand(g, f, t, v0, v0 + 0.86, 0.46, 0.46 + 2 / t.w, withAlpha(pal(th.glow), 0.55));
  },
  // 斜披巾:背肩 → 前髋一条斜带,双线勾边(烈焰少年/猫系少女)
  // 端点取脊柱两端的实际 x(而不是肩段那一条),并各内收「半个笔宽」—— 5 的笔画外沿
  // 正好压在轮廓上,再往外就是背景。
  sash: (g, f, th, t) => {
    const a0 = t.pt(0, 0), b1 = t.pt(1, 1);
    g.strokeColor = withAlpha(pal(th.glow), 0.92);
    g.lineWidth = f.lw(5);
    lineSeg(g, f, a0.x + 4, a0.y + 4, b1.x - 6, b1.y - 3);
    g.stroke();
    g.strokeColor = withAlpha(pal(th.dark), 0.8);
    g.lineWidth = f.lw(1.2);
    lineSeg(g, f, a0.x + 3, a0.y + 7, b1.x - 5, b1.y - 3);
    g.stroke();
  },
  // 樱纹描边:领口/下摆/前缘走一道 glow 细边 + 两颗小点(樱花少女/萌芽豆丁)
  trim: (g, f, th, t) => {
    const b0 = t.pt(1, 0), b1 = t.pt(1, 1);
    g.strokeColor = withAlpha(pal(th.glow), 0.95);
    g.lineWidth = f.lw(1.4);
    // 下摆:贴在髋那一行的底边上(spineX(1)=0 → 这条线天然水平、天然对齐衣摆)
    lineSeg(g, f, b0.x + 1, b0.y - 1, b1.x - 1, b1.y - 1);
    g.stroke();
    // 前缘:描边 → 脊柱跟随带(代价:失去圆头端帽,≤0.7 单位)
    torsoBand(g, f, t, 4 / t.h, 1 - 4 / t.h, 1 - 1.4 / t.w, 1, withAlpha(pal(th.glow), 0.95));
    torsoBand(g, f, t, 0.42, 0.42 + 2.2 / t.h, 0.34, 0.34 + 2.2 / t.w, th.glow);
    torsoBand(g, f, t, 0.58, 0.58 + 2.2 / t.h, 0.52, 0.52 + 2.2 / t.w, withAlpha(pal(th.glow), 0.7));
  },
  // 拼色:腰腹以下整段换 glow 色 + 一道腰带分界(球场之王/金羽宗师)
  // 色带与腰带共用同一条 v 边界 → 两者之间只会露底色,绝不会露背景。
  twoTone: (g, f, th, t) => {
    const v = 0.55;
    torsoBand(g, f, t, v, 1, 0, 1, withAlpha(pal(th.glow), 0.85));
    torsoBand(g, f, t, v, v + 2 / t.h, 0, 1, th.dark);
  },
};

/** 发型填色 + 描边的公共封装(发型笔画都是「填充 + 重建路径再描边」) */
function hairFillStroke(g: Graphics, f: Frame, pts: Pt[], color: string, lw: number): void {
  g.fillColor = pal(color);
  polyPath(g, pts, true);
  g.fill();
  g.strokeColor = pal(HAIR_LINE);
  g.lineWidth = f.lw(lw);
  polyPath(g, pts, true);
  g.stroke();
}

/** 基础发盖:外缘贴头圆外一圈、内缘压到额头上方的新月形(多数发型的底座) */
function drawHairCover(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  const outer = arcPts(f, cx, cy, hr * 1.06, Math.PI * 1.0, Math.PI * 2.0, false);
  const inner = arcPts(f, cx, cy, hr * 0.66, Math.PI * 1.94, Math.PI * 1.06, true);
  hairFillStroke(g, f, outer.concat(inner), color, 1.0);
}

// 刺猬头:沿头顶轮廓向外扎 7 根尖刺(长短错落),根部埋进头圆
function drawHairSpiky(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  const N = 7, a0 = Math.PI * 1.06, a1 = Math.PI * 1.94;
  const pts = pooledPts();
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    pts.push(f.pt(cx + Math.cos(a) * hr * 1.02, cy + Math.sin(a) * hr * 1.02));
    if (i < N) {
      const am = a + (a1 - a0) / N / 2;
      const spike = hr * (1.3 + 0.09 * Math.sin(i * 2.7));
      pts.push(f.pt(cx + Math.cos(am) * spike, cy + Math.sin(am) * spike));
    }
  }
  hairFillStroke(g, f, pts, color, 1.0);
}

// 莫霍克:头顶正中一排高耸窄刺,从后脑排到额前
function drawHairMohawk(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  const N = 5, a0 = Math.PI * 1.22, a1 = Math.PI * 1.78;
  const pts = pooledPts();
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    pts.push(f.pt(cx + Math.cos(a) * hr * 0.98, cy + Math.sin(a) * hr * 0.98));
    if (i < N) {
      const am = a + (a1 - a0) / N / 2;
      pts.push(f.pt(cx + Math.cos(am) * hr * 1.52, cy + Math.sin(am) * hr * 1.52));
    }
  }
  hairFillStroke(g, f, pts, color, 1.0);
}

// 发髻:头顶后侧一枚圆髻(叠在基础发盖上)
function drawHairBun(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  const bx = cx - hr * 0.62, by = cy - hr * 0.88;
  g.fillColor = pal(color);
  circleAA(g, f, bx, by, hr * 0.34);
  g.fill();
  g.strokeColor = pal(HAIR_LINE);
  g.lineWidth = f.lw(1.0);
  circleAA(g, f, bx, by, hr * 0.34);
  g.stroke();
}

// 双马尾:脑后两条垂落的束发,远侧先画、压暗一档读出前后(叠在基础发盖上)
function drawHairTwin(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  hairTail(g, f, withAlpha(pal(color), 0.82), cx - hr * 0.9, cy - hr * 0.1, cx - hr * 1.18, cy + hr * 0.9, hr * 0.42);
  hairTail(g, f, pal(color), cx - hr * 0.66, cy - hr * 0.28, cx - hr * 0.95, cy + hr * 1.18, hr * 0.46);
}

// 波波头:发盖包到耳侧(外缘一直裹到眼下高度),发梢内扣 —— 圆润的孩童感
function drawHairBob(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  const outer = arcPts(f, cx, cy, hr * 1.06, Math.PI * 0.88, Math.PI * 2.12, false);
  const inner = arcPts(f, cx, cy, hr * 0.66, Math.PI * 2.0, Math.PI * 1.0, true);
  hairFillStroke(g, f, outer.concat(inner), color, 1.0);
}

// 呆毛(萌芽豆丁的「芽」):头顶一根弯茎 + 两片小叶
function drawHairSprout(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  const sx = cx + hr * 0.02, sy = cy - hr * 1.04;
  g.strokeColor = pal(color);
  g.lineWidth = f.lw(1.6);
  polyPath(g, [f.pt(sx, sy), f.pt(sx + hr * 0.14, sy - hr * 0.3), f.pt(sx + hr * 0.04, sy - hr * 0.52)], false);
  g.stroke();
  const leaf = (dir: number): void => {
    const pts: Pt[] = [
      f.pt(sx + hr * 0.04, sy - hr * 0.48),
      f.pt(sx + dir * hr * 0.34, sy - hr * 0.72),
      f.pt(sx + dir * hr * 0.06, sy - hr * 0.78),
    ];
    g.fillColor = pal(color);
    polyPath(g, pts, true);
    g.fill();
    g.strokeColor = pal(HAIR_LINE);
    g.lineWidth = f.lw(0.8);
    polyPath(g, pts, true);
    g.stroke();
  };
  leaf(1);
  leaf(-1);
}

// 长直发:脑后两条垂到肩的长束,比双马尾更长更贴(猫系少女)
function drawHairLong(g: Graphics, f: Frame, color: string, hr: number, cx: number, cy: number): void {
  hairTail(g, f, withAlpha(pal(color), 0.82), cx - hr * 0.86, cy - hr * 0.1, cx - hr * 1.02, cy + hr * 0.98, hr * 0.34);
  hairTail(g, f, pal(color), cx - hr * 0.6, cy - hr * 0.26, cx - hr * 0.8, cy + hr * 1.1, hr * 0.4);
}

// 束发/飘带:两点之间的一条旋转长椭圆(发梢自然收窄靠宽参数给小)
function hairTail(g: Graphics, f: Frame, color: Color, x0: number, y0: number, x1: number, y1: number, w: number): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const R = rotateFrame(f, x0, y0, ang);
  g.fillColor = color;
  polyPath(g, ellipsePts(R, len / 2, 0, len / 2, w / 2), true);
  g.fill();
  g.strokeColor = pal(HAIR_LINE);
  g.lineWidth = f.lw(1.0);
  polyPath(g, ellipsePts(R, len / 2, 0, len / 2, w / 2), true);
  g.stroke();
}

// 默认队色发带:压在头顶,红蓝阵营识别靠它(默认款/ribbon 的底座)
function drawBand(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number): void {
  g.strokeColor = pal(th.main);
  g.lineWidth = f.lw(4);
  polyPath(g, arcPts(f, cx, cy, hr * 0.9, Math.PI * 1.14, Math.PI * 1.86, false), false);
  g.stroke();
}

// 猫耳:头顶一对三角耳,内耳粉色(猫系少女;耳朵立在发饰之上,配色跟人物主题走)
function drawCatEars(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number): void {
  const ear = (ex: number, s: number): void => {
    const tipY = cy - hr * 1.62, baseY = cy - hr * 0.82;
    const pts: Pt[] = [
      f.pt(ex - hr * 0.34, baseY),
      f.pt(ex + s * hr * 0.06, tipY),
      f.pt(ex + hr * 0.34, baseY + hr * 0.06),
    ];
    g.fillColor = pal(th.main);
    polyPath(g, pts, true);
    g.fill();
    g.strokeColor = pal(th.dark);
    g.lineWidth = f.lw(1.0);
    polyPath(g, pts, true);
    g.stroke();
    g.fillColor = withAlpha(pal("#ff9fb4"), 0.9);
    polyPath(g, [
      f.pt(ex - hr * 0.18, baseY - hr * 0.02),
      f.pt(ex + s * hr * 0.04, tipY + hr * 0.26),
      f.pt(ex + hr * 0.17, baseY + hr * 0.04),
    ], true);
    g.fill();
  };
  ear(cx - hr * 0.52, -1);
  ear(cx + hr * 0.42, 1);
}

// 棒球帽:扣在头顶的半球帽体 + 朝网侧伸出的帽檐 + 帽顶小扣
function drawCap(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number): void {
  const dome = (): void => { polyPath(g, arcPts(f, cx, cy - hr * 0.08, hr * 1.02, Math.PI * 0.98, Math.PI * 2.02, false), true); };
  g.fillColor = pal(th.main);
  dome();
  g.fill();
  g.strokeColor = pal(HAIR_LINE);
  g.lineWidth = f.lw(1.2);
  dome();
  g.stroke();
  g.fillColor = withAlpha(pal(th.dark), 0.96);
  polyPath(g, ellipsePts(f, cx + hr * 0.88, cy - hr * 0.3, hr * 0.62, hr * 0.17), true);
  g.fill();
  g.stroke();
  g.fillColor = withAlpha(pal(th.glow), 0.9);
  circleAA(g, f, cx, cy - hr * 1.08, hr * 0.10);
  g.fill();
}

// 王冠:金色三尖冠 + 深金描边 + 冠心宝石(球场之王)
function drawCrown(g: Graphics, f: Frame, hr: number, cx: number, cy: number): void {
  const baseY = cy - hr * 0.86, topY = cy - hr * 1.5, hw = hr * 0.62;
  const pts: Pt[] = [
    f.pt(cx - hw, baseY),
    f.pt(cx - hw * 0.78, topY),
    f.pt(cx - hw * 0.42, baseY + hr * 0.14),
    f.pt(cx, topY - hr * 0.1),
    f.pt(cx + hw * 0.42, baseY + hr * 0.14),
    f.pt(cx + hw * 0.78, topY),
    f.pt(cx + hw, baseY),
  ];
  g.fillColor = pal("#ffd24d");
  polyPath(g, pts, true);
  g.fill();
  g.strokeColor = pal("#8a6a1c");
  g.lineWidth = f.lw(1.1);
  polyPath(g, pts, true);
  g.stroke();
  g.fillColor = pal("#ff4d6a");
  circleAA(g, f, cx, topY + hr * 0.28, hr * 0.11);
  g.fill();
}

// 护目镜:推在额头上的荧光镜片(赛博骇客),束带用皮肤深色、镜面用 glow 色
function drawGoggles(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number): void {
  const gy = cy - hr * 0.52;
  g.strokeColor = pal(th.dark);
  g.lineWidth = f.lw(3);
  polyPath(g, arcPts(f, cx, cy, hr * 0.92, Math.PI * 1.08, Math.PI * 1.92, false), false);
  g.stroke();
  const lens = (ex: number, er: number): void => {
    g.fillColor = withAlpha(pal(th.glow), 0.32);
    circleAA(g, f, ex, gy, er);
    g.fill();
    g.strokeColor = pal(th.glow);
    g.lineWidth = f.lw(1.3);
    circleAA(g, f, ex, gy, er);
    g.stroke();
  };
  lens(cx + hr * 0.34, hr * 0.26);
  lens(cx - hr * 0.30, hr * 0.21);
}

// 忍者额带:更宽的束带 + 额前金属贴片 + 脑后两条随风微摆的飘带(影忍)
function drawBandana(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number, t: number): void {
  g.strokeColor = pal(th.main);
  g.lineWidth = f.lw(5.5);
  polyPath(g, arcPts(f, cx, cy, hr * 0.9, Math.PI * 1.1, Math.PI * 1.9, false), false);
  g.stroke();
  g.fillColor = withAlpha(pal(th.glow), 0.95);
  fillRectTr(g, f, cx + hr * 0.40, cy - hr * 0.46, hr * 0.30, hr * 0.20, withAlpha(pal(th.glow), 0.95));
  const wv = Math.sin(t * 0.06) * hr * 0.12;
  g.strokeColor = pal(th.main);
  g.lineWidth = f.lw(2.6);
  lineSeg(g, f, cx - hr * 0.88, cy - hr * 0.30, cx - hr * 1.52, cy - hr * 0.46 + wv);
  lineSeg(g, f, cx - hr * 0.88, cy - hr * 0.18, cx - hr * 1.42, cy + hr * 0.06 + wv * 0.7);
  g.stroke();
}

// 蝴蝶结:头顶后侧的双耳结饰,系在双马尾根部(樱花少女)
function drawRibbon(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number): void {
  const bx = cx - hr * 0.58, by = cy - hr * 0.72;
  const ear = (sx: number): Pt[] => [
    f.pt(bx + sx * hr * 0.3, by - hr * 0.22), f.pt(bx, by), f.pt(bx + sx * hr * 0.3, by + hr * 0.22),
  ];
  g.fillColor = pal(th.glow);
  polyPath(g, ear(-1), true);
  g.fill();
  polyPath(g, ear(1), true);
  g.fill();
  g.strokeColor = pal(HAIR_LINE);
  g.lineWidth = f.lw(0.9);
  polyPath(g, ear(-1), true);
  g.stroke();
  polyPath(g, ear(1), true);
  g.stroke();
  g.fillColor = pal(th.main);
  circleAA(g, f, bx, by, hr * 0.13);
  g.fill();
}

// ---------- 表情五官零件(颜色由 drawHead 按脸面款式给:墨面=白 / 肤色=暖棕) ----------

// 圆点眼:normal/fierce 共用;瞳位随球偏移(look 已是局部单位向量 × 1.3)
function dotEyes(g: Graphics, f: Frame, exN: number, eyN: number, exF: number, eyF: number, lx: number, ly: number,
  color: string): void {
  g.fillColor = pal(color);
  ellipseAA(g, f, exN + lx, eyN + ly, 1.9, 2.6);
  g.fill();
  ellipseAA(g, f, exF + lx * 0.7, eyF + ly, 1.4, 2.1);
  g.fill();
}

// 笑弧:canvas y 向下,0.1π..0.9π 是向下鼓的弧 = 微笑
function smileArc(g: Graphics, f: Frame, cx: number, cy: number, r: number): void {
  g.lineWidth = f.lw(1.4);
  polyPath(g, arcPts(f, cx, cy, r, Math.PI * 0.12, Math.PI * 0.88, false), false);
  g.stroke();
}

// 波浪嘴:三段小折线,失误/倒地时那股「完了」的劲儿
function wavyMouth(g: Graphics, f: Frame, mx: number, my: number): void {
  g.lineWidth = f.lw(1.3);
  polyPath(g, [
    f.pt(mx - 0.5, my + 0.4), f.pt(mx + 1.2, my - 0.8),
    f.pt(mx + 2.9, my + 0.6), f.pt(mx + 4.6, my - 0.5),
  ], false);
  g.stroke();
}

// ✦ 星星眼:竖长横短的四芒十字
function sparkle(g: Graphics, f: Frame, x: number, y: number, r: number): void {
  lineSeg(g, f, x, y - r, x, y + r);
  lineSeg(g, f, x - r * 0.75, y, x + r * 0.75, y);
}

// XX 眼:两根交叉短线
function crossEye(g: Graphics, f: Frame, x: number, y: number, r: number): void {
  lineSeg(g, f, x - r, y - r, x + r, y + r);
  lineSeg(g, f, x - r, y + r, x + r, y - r);
}

// ---------- 脸面特征标记注册表(雀斑/泪痣/猫须/白眉须):key 在 config.faceStyles[].mark ----------
type MarkFn = (g: Graphics, f: Frame, cx: number, cy: number, hr: number, ink: string) => void;

const FACE_MARKS: Record<string, MarkFn> = {
  // 雀斑:两颊各一小撮浅点,近颊多一颗(3/4 透视)
  freckle: (g, f, cx, cy, hr, ink) => {
    g.fillColor = withAlpha(pal(ink), 0.5);
    const spots: [number, number, number][] = [
      [hr * 0.52, hr * 0.34, 0.05], [hr * 0.66, hr * 0.26, 0.04], [hr * 0.44, hr * 0.46, 0.035],
      [-hr * 0.38, hr * 0.38, 0.04], [-hr * 0.52, hr * 0.3, 0.035],
    ];
    for (const [dx, dy, r] of spots) {
      circleAA(g, f, cx + dx, cy + dy, hr * r);
      g.fill();
    }
  },
  // 泪痣:近眼下一颗小痣 + 一点高光
  tear: (g, f, cx, cy, hr, ink) => {
    g.fillColor = withAlpha(pal(ink), 0.85);
    circleAA(g, f, cx + hr * 0.5, cy + hr * 0.42, hr * 0.055);
    g.fill();
    g.fillColor = withAlpha(pal("#ffffff"), 0.8);
    circleAA(g, f, cx + hr * 0.48, cy + hr * 0.4, hr * 0.02);
    g.fill();
  },
  // 猫须:两颊各两根细须,近侧长远侧短(3/4 透视)
  cat: (g, f, cx, cy, hr, ink) => {
    g.strokeColor = withAlpha(pal(ink), 0.75);
    g.lineWidth = f.lw(0.9);
    lineSeg(g, f, cx + hr * 0.62, cy + hr * 0.2, cx + hr * 1.02, cy + hr * 0.14);
    lineSeg(g, f, cx + hr * 0.62, cy + hr * 0.4, cx + hr * 1.02, cy + hr * 0.44);
    lineSeg(g, f, cx - hr * 0.62, cy + hr * 0.24, cx - hr * 0.92, cy + hr * 0.18);
    lineSeg(g, f, cx - hr * 0.62, cy + hr * 0.42, cx - hr * 0.92, cy + hr * 0.46);
    g.stroke();
  },
  // 白眉长须:两道白眉 + 下巴一撮胡(宗师的仙气)
  sage: (g, f, cx, cy, hr, _ink) => {
    const c = "#e8ecf4";
    g.strokeColor = pal(c);
    g.lineWidth = f.lw(1.6);
    // 眉:两道短弧,压在眼位上方
    polyPath(g, arcPts(f, cx + hr * 0.4, cy + hr * 0.02, hr * 0.22, Math.PI * 1.15, Math.PI * 1.85, false), false);
    polyPath(g, arcPts(f, cx - hr * 0.16, cy + hr * 0.05, hr * 0.17, Math.PI * 1.15, Math.PI * 1.85, false), false);
    g.stroke();
    // 须:嘴下的一小撇下垂胡
    g.lineWidth = f.lw(1.3);
    polyPath(g, arcPts(f, cx + hr * 0.16, cy + hr * 0.5, hr * 0.2, Math.PI * 0.15, Math.PI * 0.85, false), false);
    g.stroke();
  },
};

// ---------- 表情贴纸:头侧的小图标(矢量画的 emoji,原生平台不受字体限制) ----------
// pop-in(easeOutBack 弹出)+ 轻微浮动,末段上浮淡出;时长由 faceD/faceT 驱动
const STICKERS: Partial<Record<FaceKind, "drop" | "bubble" | "star" | "heart">> = {
  star: "star", wow: "bubble", oops: "drop", sad: "drop", cheer: "heart",
};

function drawFaceSticker(g: Graphics, f: Frame, t: number, face: FaceKind, faceT: number, faceD: number,
  cx: number, cy: number, hr: number): void {
  const kind = STICKERS[face];
  if (!kind || faceT <= 0) return;
  // 定格表情(胜负时的超大 faceT):OVER 冻结态 faceT 不衰减,pop-in 按「已弹完」算,
  // 不做淡出;浮动一律用世界时钟,冻结时爱心/星星照样轻轻飘
  const pinned = faceT > 600;
  const elapsed = pinned ? 8 : Math.max(0, faceD - faceT);
  const k = clamp(elapsed / 8, 0, 1);                  // pop-in 进度
  const c1 = 1.70158, c3 = c1 + 1;
  const pop = 1 + c3 * ((k - 1) ** 3) + c1 * ((k - 1) ** 2);
  const out = pinned ? 1 : clamp(faceT / 18, 0, 1);    // 末段淡出权重
  const rise = pinned ? 0 : (1 - out) * 7;
  const bob = Math.sin(t * 0.12) * 1.4;
  const sf = scaledFrame(f, cx + hr * 1.12, cy - hr * 0.72 - rise + bob, Math.max(0.05, pop));
  const alpha = out;

  if (kind === "drop") {
    // 汗滴:上尖下圆,悬在额角
    g.fillColor = withAlpha(pal("#8fd0ff"), alpha);
    circleAA(g, sf, 0, 1.6, 3.0);
    g.fill();
    polyPath(g, [sf.pt(0, -4.6), sf.pt(-2.5, -0.2), sf.pt(2.5, -0.2)], true);
    g.fill();
  } else if (kind === "bubble") {
    // 感叹号气泡:白底泡 + 深色「!」+ 朝头的小尾巴
    g.fillColor = withAlpha(pal(FACE), alpha);
    ellipseAA(g, sf, 0, -0.6, 4.6, 4.2);
    g.fill();
    polyPath(g, [sf.pt(-2.6, 2.8), sf.pt(-4.6, 6.2), sf.pt(-0.8, 3.6)], true);
    g.fill();
    g.strokeColor = withAlpha(pal(HEAD), alpha);
    g.lineWidth = sf.lw(1.5);
    lineSeg(g, sf, 0, -2.4, 0, 0.6);
    circleAA(g, sf, 0, 2.2, 0.75);
    g.stroke();
  } else if (kind === "star") {
    // 四芒星:外尖内收的 8 点多边形
    const pts = pooledPts();
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 4;
      const r = i % 2 === 0 ? 5 : 1.5;
      pts.push(sf.pt(Math.cos(ang) * r, Math.sin(ang) * r));
    }
    g.fillColor = withAlpha(pal("#ffe14d"), alpha);
    polyPath(g, pts, true);
    g.fill();
  } else {
    // 爱心:两圆一三角同色叠出轮廓
    g.fillColor = withAlpha(pal("#ff7bac"), alpha);
    circleAA(g, sf, -1.7, -1.2, 2.0);
    g.fill();
    circleAA(g, sf, 1.7, -1.2, 2.0);
    g.fill();
    polyPath(g, [sf.pt(-3.55, -0.4), sf.pt(3.55, -0.4), sf.pt(0, 4.6)], true);
    g.fill();
  }
}

// 手臂/腿折线:圆头描边;alpha 用于压暗远侧肢(canvas globalAlpha → 叠进颜色)
function arm(g: Graphics, f: Frame, color: string, pts: Pt2[], lw = 5.5, alpha = 1): void {
  g.strokeColor = withAlpha(pal(color), alpha);
  g.lineWidth = f.lw(lw);
  g.lineCap = LineCap.ROUND;
  g.lineJoin = LineJoin.ROUND;
  const p0 = f.pt(pts[0].x, pts[0].y);
  g.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const q = f.pt(pts[i].x, pts[i].y);
    g.lineTo(q.x, q.y);
  }
  g.stroke();
}

// 握拍的手:最后叠画在拍柄上,才是「拿着」而不是「粘着」
// r/alpha 给远侧手用(远侧更小更暗才读得出景深);默认值 = 原持拍手,那一路输出逐字节不变。
// 【注意】withAlpha 是「覆盖」alpha 而不是叠乘(palette.ts 里 new Color(r,g,b,k*255)),
// 而 SKIN_LINE 自带 0.55 —— 所以描边必须写 0.55 * alpha,直接套 alpha 会把持拍手变成黑边。
function drawHand(g: Graphics, f: Frame, hx: number, hy: number, r = 3.6, alpha = 1, skin = SKIN): void {
  g.fillColor = withAlpha(pal(skin), alpha);
  g.strokeColor = withAlpha(pal(SKIN_LINE), 0.55 * alpha);
  g.lineWidth = f.lw(1.2);
  circleAA(g, f, hx, hy, r);
  g.fill();
  g.stroke();
}

/**
 * 现代方头(Isometric)破风拍框采样点:
 * 顶端微平展扩大甜区,两侧破风挺拔流线,底端平滑收拢至 T 头。
 */
function isometricHeadPts(R: Frame, rx = 9.2, ry = 11.5, steps = CIRCLE_SEGS): Pt[] {
  const pts = pooledPts();
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * TAU;
    const ct = Math.cos(th), st = Math.sin(th);
    let x: number, y: number;
    if (st < 0) {
      // 拍头上半部(-y 方向):方头(Isometric)展开,顶部曲率平缓、横向开阔
      const k = -st; // 0 ~ 1,顶部为 1
      const widthMul = 1.0 + 0.08 * Math.sin(k * Math.PI);
      const flatten = st < -0.88 ? 0.98 : 1.0;
      x = rx * ct * widthMul;
      y = ry * st * flatten;
    } else {
      // 拍线下半部(+y 方向):向内置 T 头平滑收拢
      const taper = 1.0 - 0.08 * st;
      x = rx * ct * taper;
      y = ry * st;
    }
    pts.push(R.pt(x, y));
  }
  return pts;
}

// 从手位 (hx,hy) 朝 ang 方向伸出的一支现代高质感羽毛球拍:
// 包含:防脱底盖 → 螺旋手胶 → 封口胶带 → 控制锥盖 → 高模量圆柱高光中杆(挥拍弹性受力)
//       → 内置 T 头加固喉部 → 现代方头立体破风拍框(高光刃/涂装/护线孔) → 高张力内嵌拍弦
function drawRacket(g: Graphics, f: Frame, hx: number, hy: number, ang: number, len: number, th: Theme, p: Player): void {
  const rad = ang * D2R;
  const dx = Math.cos(rad), dy = -Math.sin(rad);
  // 侧向法向量(顺时针垂直于中杆)
  const nx = -dy, ny = dx;

  const sk = p.racketSkin || RACKET_DEFAULT;
  const frame = sk.frame || th.glow;
  const gripCol = sk.grip || "#20242f";
  const shaftCol = sk.shaft || "#efe7d8";

  // 拍框几何参数
  const headRx = 9.2, headRy = 11.5;

  // ---------- 1. 拍柄部件:防脱底盖(Butt Cap) ----------
  // 位于拍柄最底端(外露在手掌后方),喇叭口八角棱台
  const buttBase = -7.2, buttEnd = -8.8;
  const buttPts: Pt[] = [
    f.pt(hx + dx * buttBase - nx * 2.1, hy + dy * buttBase - ny * 2.1),
    f.pt(hx + dx * buttBase + nx * 2.1, hy + dy * buttBase + ny * 2.1),
    f.pt(hx + dx * buttEnd + nx * 2.6, hy + dy * buttEnd + ny * 2.6),
    f.pt(hx + dx * buttEnd - nx * 2.6, hy + dy * buttEnd - ny * 2.6),
  ];
  g.fillColor = pal("#10131c");
  polyPath(g, buttPts, true);
  g.fill();
  // 底盖铭牌金属亮标(金色/冷银亮斑)
  const buttLogoCol = sk.id === "r-star" ? "#ffe14d" : (sk.id === "r-carbon" ? "#d8e2f0" : "#ffd700");
  g.fillColor = withAlpha(pal(buttLogoCol), 0.85);
  polyPath(g, [
    f.pt(hx + dx * buttEnd - nx * 0.8, hy + dy * buttEnd - ny * 0.8),
    f.pt(hx + dx * buttEnd + nx * 0.8, hy + dy * buttEnd + ny * 0.8),
    f.pt(hx + dx * (buttEnd - 0.5) + nx * 0.6, hy + dy * (buttEnd - 0.5) + ny * 0.6),
    f.pt(hx + dx * (buttEnd - 0.5) - nx * 0.6, hy + dy * (buttEnd - 0.5) - ny * 0.6),
  ], true);
  g.fill();

  // ---------- 2. 拍柄手胶(Grip Tape)与螺旋重叠接缝 ----------
  // 手胶主体长 12.2,横跨手心两端
  const gripStart = buttBase, gripEnd = 5.0;
  g.lineCap = LineCap.ROUND;
  g.strokeColor = pal(gripCol);
  g.lineWidth = f.lw(4.4);
  lineSeg(g, f, hx + dx * gripStart, hy + dy * gripStart, hx + dx * gripEnd, hy + dy * gripEnd);
  g.stroke();

  // 手胶螺旋缠绕斜纹(Overlap ridges):呈现吸汗带手工缠绕的凹凸纹理
  g.lineCap = LineCap.BUTT;
  g.lineWidth = f.lw(0.8);
  for (let d = gripStart + 1.2; d <= gripEnd - 0.6; d += 2.2) {
    const rx0 = hx + dx * d - nx * 1.9 - dx * 0.4;
    const ry0 = hy + dy * d - ny * 1.9 - dy * 0.4;
    const rx1 = hx + dx * d + nx * 1.9 + dx * 0.4;
    const ry1 = hy + dy * d + ny * 1.9 + dy * 0.4;
    // 阴影凹缝
    g.strokeColor = withAlpha(pal("#000000"), 0.35);
    lineSeg(g, f, rx0, ry0, rx1, ry1);
    g.stroke();
    // 缝侧反光凸边
    g.strokeColor = withAlpha(pal("#ffffff"), 0.16);
    lineSeg(g, f, rx0 + dx * 0.4, ry0 + dy * 0.4, rx1 + dx * 0.4, ry1 + dy * 0.4);
    g.stroke();
  }

  // ---------- 3. 封口胶带(Finishing Tape) ----------
  // 手胶顶部的哑光黑束口环带 + 细亮金边
  const tapeStart = gripEnd, tapeEnd = 6.2;
  const tapePts: Pt[] = [
    f.pt(hx + dx * tapeStart - nx * 1.8, hy + dy * tapeStart - ny * 1.8),
    f.pt(hx + dx * tapeStart + nx * 1.8, hy + dy * tapeStart + ny * 1.8),
    f.pt(hx + dx * tapeEnd + nx * 1.7, hy + dy * tapeEnd + ny * 1.7),
    f.pt(hx + dx * tapeEnd - nx * 1.7, hy + dy * tapeEnd - ny * 1.7),
  ];
  g.fillColor = pal("#12141a");
  polyPath(g, tapePts, true);
  g.fill();
  // 封口胶带中线装饰金线
  g.strokeColor = withAlpha(pal("#ffd24d"), 0.7);
  g.lineWidth = f.lw(0.5);
  lineSeg(g, f,
    hx + dx * ((tapeStart + tapeEnd) * 0.5) - nx * 1.75,
    hy + dy * ((tapeStart + tapeEnd) * 0.5) - ny * 1.75,
    hx + dx * ((tapeStart + tapeEnd) * 0.5) + nx * 1.75,
    hy + dy * ((tapeStart + tapeEnd) * 0.5) + ny * 1.75,
  );
  g.stroke();

  // ---------- 4. 控制锥盖 / 前套(Cone Cap) ----------
  // 从手柄口径(宽 3.4)收拢过渡到中杆(宽 2.2)的梯形台
  const coneStart = tapeEnd, coneEnd = 9.8;
  const conePts: Pt[] = [
    f.pt(hx + dx * coneStart - nx * 1.6, hy + dy * coneStart - ny * 1.6),
    f.pt(hx + dx * coneStart + nx * 1.6, hy + dy * coneStart + ny * 1.6),
    f.pt(hx + dx * coneEnd + nx * 1.05, hy + dy * coneEnd + ny * 1.05),
    f.pt(hx + dx * coneEnd - nx * 1.05, hy + dy * coneEnd - ny * 1.05),
  ];
  g.fillColor = pal("#1c202a");
  polyPath(g, conePts, true);
  g.fill();
  // 锥盖科技型号微细横线
  g.strokeColor = withAlpha(pal(shaftCol), 0.55);
  g.lineWidth = f.lw(0.6);
  lineSeg(g, f,
    hx + dx * (coneStart * 0.4 + coneEnd * 0.6) - nx * 1.2,
    hy + dy * (coneStart * 0.4 + coneEnd * 0.6) - ny * 1.2,
    hx + dx * (coneStart * 0.4 + coneEnd * 0.6) + nx * 1.2,
    hy + dy * (coneStart * 0.4 + coneEnd * 0.6) + ny * 1.2,
  );
  g.stroke();

  // ---------- 5. 高模量立体中杆(Shaft) ----------
  // 终点动态自适应锚定到 T 头底缘(len - headRy + 0.6),彻底杜绝断裂与穿刺
  const shaftStart = coneEnd;
  const shaftEnd = Math.max(shaftStart + 1.2, len - headRy + 0.6);

  // 挥拍受力弹性弯曲(Shaft Flex):蓄力发力期产生微后弯,击球瞬时回弹
  const isSwinging = (p.swingT ?? -1) >= 0 && !(p as unknown as { swingHit?: boolean }).swingHit;
  const flexK = isSwinging ? Math.sin(clamp((p.swingT ?? 0) / 10, 0, 1) * Math.PI) * 1.2 : 0;

  // 中杆主色管身
  g.lineCap = LineCap.ROUND;
  g.strokeColor = pal(shaftCol);
  g.lineWidth = f.lw(2.2);
  const p0 = { x: hx + dx * shaftStart, y: hy + dy * shaftStart };
  const p1 = { x: hx + dx * shaftEnd, y: hy + dy * shaftEnd };
  if (Math.abs(flexK) > 0.15) {
    const midD = (shaftStart + shaftEnd) * 0.5;
    const cp = { x: hx + dx * midD + nx * flexK, y: hy + dy * midD + ny * flexK };
    const pt0 = f.pt(p0.x, p0.y), pt1 = f.pt(p1.x, p1.y), ptCp = f.pt(cp.x, cp.y);
    g.moveTo(pt0.x, pt0.y);
    g.quadraticCurveTo(ptCp.x, ptCp.y, pt1.x, pt1.y);
    g.stroke();
  } else {
    lineSeg(g, f, p0.x, p0.y, p1.x, p1.y);
    g.stroke();
  }

  // 中杆受光侧抛光高光线(Highlight Spine):形成圆柱反光面
  g.strokeColor = withAlpha(pal("#ffffff"), 0.42);
  g.lineWidth = f.lw(0.7);
  lineSeg(g, f,
    p0.x + nx * 0.45, p0.y + ny * 0.45,
    p1.x + nx * 0.45, p1.y + ny * 0.45,
  );
  g.stroke();

  // 中杆科技水贴双环(Decal Rings):距离锥盖 3px 处点缀细金属环
  if (shaftEnd - shaftStart > 6.0) {
    const ringD = shaftStart + 2.8;
    g.strokeColor = withAlpha(pal("#ffffff"), 0.7);
    g.lineWidth = f.lw(0.6);
    lineSeg(g, f,
      hx + dx * ringD - nx * 1.1, hy + dy * ringD - ny * 1.1,
      hx + dx * ringD + nx * 1.1, hy + dy * ringD + ny * 1.1,
    );
    lineSeg(g, f,
      hx + dx * (ringD + 1.0) - nx * 1.1, hy + dy * (ringD + 1.0) - ny * 1.1,
      hx + dx * (ringD + 1.0) + nx * 1.1, hy + dy * (ringD + 1.0) + ny * 1.1,
    );
    g.stroke();
  }

  // ---------- 6. 拍框子帧(R):中心在 (hx + dx * len, hy + dy * len) ----------
  const R = rotateFrame(f, hx + dx * len, hy + dy * len, -rad + Math.PI / 2);

  // ---------- 7. 内置 T 头 / 加固喉部(Built-in T-Joint) ----------
  // 位于局部子帧 R 的拍框下沿 (0, headRy),形成坚固三角过渡区
  const throatPts: Pt[] = [
    R.pt(0, headRy - 2.2),
    R.pt(2.0, headRy - 0.4),
    R.pt(1.1, headRy + 0.8),
    R.pt(-1.1, headRy + 0.8),
    R.pt(-2.0, headRy - 0.4),
  ];
  g.fillColor = withAlpha(pal(gripCol), 0.88);
  polyPath(g, throatPts, true);
  g.fill();
  g.strokeColor = pal(frame);
  g.lineWidth = R.lw(0.8);
  polyPath(g, throatPts, true);
  g.stroke();

  // ---------- 8. 现代方头破风拍框(Isometric Aero Frame) ----------
  const head = isometricHeadPts(R, headRx, headRy, CIRCLE_SEGS);

  // 拍面底色填充
  g.fillColor = withAlpha(pal("#ffffff"), 0.12);
  polyPath(g, head, true);
  g.fill();

  // 拍框外圈主色描边(修复之前 fill 吃掉 path 导致无边线的重大 bug)
  g.strokeColor = pal(frame);
  g.lineWidth = R.lw(2.4);
  polyPath(g, head, true);
  g.stroke();

  // 拍顶破风刃高光弧(Aero Top Crown Highlight):10 点到 2 点钟的刃口反光
  const crownPts = head.filter((_, idx) => {
    const t = (idx / CIRCLE_SEGS) * TAU;
    return Math.sin(t) < -0.32;
  });
  if (crownPts.length >= 2) {
    g.strokeColor = withAlpha(pal("#ffffff"), 0.48);
    g.lineWidth = R.lw(0.9);
    polyPath(g, crownPts, false);
    g.stroke();
  }

  // 拍框 2 点/10 点与 4 点/8 点破风拉花饰条(Frame Accent Decals):纤细贴合,增添工业涂装质感
  const accentCol = withAlpha(pal(shaftCol), 0.50);
  g.strokeColor = accentCol;
  g.lineWidth = R.lw(0.85);
  // 10点与2点拉花
  lineSeg(g, R, -headRx * 0.88, -headRy * 0.40, -headRx * 0.74, -headRy * 0.65);
  lineSeg(g, R, headRx * 0.88, -headRy * 0.40, headRx * 0.74, -headRy * 0.65);
  // 8点与4点下沿拉花
  lineSeg(g, R, -headRx * 0.84, headRy * 0.38, -headRx * 0.72, headRy * 0.58);
  lineSeg(g, R, headRx * 0.84, headRy * 0.38, headRx * 0.72, headRy * 0.58);
  g.stroke();

  // 护线管胶粒微凹槽(Grommets):3点与9点外圈极细穿线微凹槽
  g.strokeColor = withAlpha(pal("#0e111a"), 0.45);
  g.lineWidth = R.lw(0.6);
  lineSeg(g, R, -headRx - 0.25, -0.6, -headRx - 0.25, 0.6);
  lineSeg(g, R, headRx + 0.25, -0.6, headRx + 0.25, 0.6);
  g.stroke();

  // ---------- 9. 命中与击球反馈辉光 ----------
  // 百分百重击技能蓄力附魔:炽热金红与烈焰高光外晕与翻滚火舌
  const isPowerSmashBuff = !!(p.skill && p.skill.id === "smash" && p.skill.buffT > 0);
  if (isPowerSmashBuff && p.skill) {
    const flameU = Math.sin((p.skill.buffT || 0) * 0.28);
    const outer = isometricHeadPts(R, headRx + 4.5 + flameU * 1.5, headRy + 5.0 + flameU * 1.5, CIRCLE_SEGS);
    glowStroke(g, R, outer, "#f43f5e", 4.2 + 8);
    glowStroke(g, R, head, "#ffe14d", 3.6 + 6);
    // 拍框外延翻滚跳跃的 6 朵烈火火舌
    g.strokeColor = withAlpha(pal("#ff6a1f"), 0.85);
    g.lineWidth = R.lw(2.4);
    for (let i = 0; i < 6; i++) {
      const angF = (i / 6) * TAU + flameU * 0.4;
      const hx0 = Math.cos(angF) * headRx;
      const hy0 = Math.sin(angF) * headRy;
      const tongueLen = 5 + Math.sin(angF * 3 + (p.skill.buffT || 0) * 0.4) * 3.5;
      lineSeg(g, R, hx0, hy0, hx0 + Math.cos(angF) * tongueLen, hy0 + Math.sin(angF) * tongueLen);
    }
    g.stroke();
    // 炽热白色聚能热核
    g.fillColor = withAlpha(pal("#ffffff"), 0.55);
    circleAA(g, R, 0, 0, 4.5);
    g.fill();
    g.strokeColor = pal("#ffffff");
    g.lineWidth = R.lw(3.6);
    polyPath(g, head, true); g.stroke();
    g.strokeColor = pal("#f43f5e");
    g.lineWidth = R.lw(2.5);
    polyPath(g, outer, true); g.stroke();
  } else if (p.perfectGlow > 0) {
    const outer = isometricHeadPts(R, headRx + 3.2, headRy + 3.8, CIRCLE_SEGS);
    glowStroke(g, R, head, "#00f0ff", 3.6 + 8);
    g.strokeColor = pal("#ffffff");
    g.lineWidth = R.lw(3.6);
    polyPath(g, head, true); g.stroke();
    glowStroke(g, R, outer, "#ffe14d", 2.2 + 7);
    g.strokeColor = pal("#ffe14d");
    g.lineWidth = R.lw(2.2);
    polyPath(g, outer, true); g.stroke();
  } else if (p.smashGlow > 0) {
    glowStroke(g, R, head, "#ffe14d", 3.2 + 6);
    g.strokeColor = pal("#ffe14d");
    g.lineWidth = R.lw(3.2);
    polyPath(g, head, true); g.stroke();
  } else if (p.sweetGlow > 0) {
    // 甜蜜点命中瞬间:璀璨白金与电光外光晕
    glowStroke(g, R, head, "#00f0ff", 3.0 + 7);
    g.strokeColor = pal("#ffffff");
    g.lineWidth = R.lw(3.0);
    polyPath(g, head, true); g.stroke();
  }

  // 拍头命中闪光:contactFlash > 0 时在拍头画径向渐变亮斑
  if (p.contactFlash > 0) {
    const flashAlpha = (p.contactFlash / 8) * (C.fx.racketFlashAlpha || 0.8);
    const flashR = C.fx.racketFlashRadius || 16;
    const BANDS = 4;
    for (let i = BANDS; i >= 1; i--) {
      const k = i / BANDS;
      g.fillColor = withAlpha(pal("#ffffff"), flashAlpha * (1 - k));
      polyPath(g, ellipsePts(R, 0, 0, flashR * k, flashR * k), true);
      g.fill();
    }
  }

  // ---------- 10. 高张力拍面网线(String Bed) ----------
  // 严格内壁裁剪算法:端点锁死在拍框内沿,杜绝毛刺外溢;7竖 × 9横致密紧绷网格
  const strColor = sk.stringColor || "#ffffff";
  g.strokeColor = withAlpha(pal(strColor), sk.stringColor ? 0.65 : 0.40);
  g.lineWidth = R.lw(0.75);

  const inRx = 8.1, inRy = 10.2;

  // 7 根竖线
  const xCols = [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4];
  for (const x of xCols) {
    const u = Math.abs(x) / inRx;
    if (u < 0.96) {
      const span = inRy * Math.sqrt(Math.max(0, 1 - u * u));
      const yTop = -span * (1 + 0.04 * (1 - u * u)); // 顶部方头略微平缓展开
      const yBottom = span * 0.96;
      lineSeg(g, R, x, yTop, x, yBottom);
    }
  }

  // 9 根横线
  const yRows = [-7.0, -5.25, -3.5, -1.75, 0, 1.75, 3.5, 5.25, 7.0];
  for (const y of yRows) {
    const v = y < 0 ? Math.abs(y) / (inRy * 1.04) : y / inRy;
    if (v < 0.96) {
      const span = inRx * Math.sqrt(Math.max(0, 1 - v * v));
      lineSeg(g, R, -span, y, span, y);
    }
  }
  g.stroke();

  // 甜区(Sweet Spot)中央高张力反光微晕
  g.fillColor = withAlpha(pal(strColor), 0.06);
  circleAA(g, R, 0, -0.6, 3.6);
  g.fill();

  // ---------- 11. 拍框贴章(设计款专属徽记) ----------
  if (sk.decal) drawDecal(g, R, sk.decal);
}

// 拍框贴章:星/电/火/冰晶四种小徽记,画在拍面局部坐标(R)下缘 (0, 6) 处
function drawDecal(g: Graphics, R: Frame, kind: NonNullable<SkinDef["decal"]>): void {
  const col = DECAL_COLORS[kind] || "#ffd24d";
  const at = (dx: number, dy: number): Pt => R.pt(dx, dy);
  if (kind === "star") {
    // 四角星芒
    g.fillColor = pal(col);
    polyPath(g, [at(0, 3.2), at(0.9, 5.2), at(0, 8.6), at(-0.9, 5.2)], true);
    g.fill();
    polyPath(g, [at(-2.4, 6.1), at(-0.9, 5.2), at(0.9, 5.2), at(2.4, 6.1)], true);
    g.fill();
  } else if (kind === "bolt") {
    // 闪电折线
    g.strokeColor = pal(col);
    g.lineWidth = R.lw(1.4);
    g.moveTo(at(0.9, 3.4).x, at(0.9, 3.4).y);
    g.lineTo(at(-0.7, 6.0).x, at(-0.7, 6.0).y);
    g.lineTo(at(0.3, 6.2).x, at(0.3, 6.2).y);
    g.lineTo(at(-0.9, 9.0).x, at(-0.9, 9.0).y);
    g.stroke();
  } else if (kind === "flame") {
    // 火苗:外焰 + 内焰两层泪滴
    g.fillColor = pal(col);
    polyPath(g, [at(0, 3.2), at(1.5, 5.8), at(0.7, 8.4), at(0, 9.4), at(-0.8, 8.2), at(-1.4, 5.6)], true);
    g.fill();
    g.fillColor = withAlpha(pal("#ffe14d"), 0.9);
    polyPath(g, [at(0, 5.4), at(0.7, 7.2), at(0, 9.0), at(-0.7, 7.0)], true);
    g.fill();
  } else {
    // 冰晶:菱形六角晶面
    g.fillColor = withAlpha(pal(col), 0.85);
    polyPath(g, [at(0, 3.4), at(1.3, 5.6), at(0, 9.0), at(-1.3, 5.6)], true);
    g.fill();
    g.strokeColor = withAlpha(pal("#eaffff"), 0.9);
    g.lineWidth = R.lw(0.7);
    polyPath(g, [at(0, 3.4), at(1.3, 5.6), at(0, 9.0), at(-1.3, 5.6)], true);
    g.stroke();
  }
}

/**
 * 静态球拍(商店缩略图/预览):以世界坐标 (wx,wy) 为握点、拍头朝上竖放的
 * 完整 drawRacket —— 与上场同一套绘制,皮肤换了它跟着换。
 * p 用 career-panel 的 dummyPlayer 携带 racketSkin;glow 字段全 0 即普通拍。
 */
export function drawRacketStill(g: Graphics, vp: Viewport, wx: number, wy: number, scale: number, p: Player): void {
  const f = playerFrame(vp, wx, wy, 1, scale, scale);
  const theme: Theme = p.theme ?? { name: "default", main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a" };
  drawRacket(g, f, 0, 0, 90, 40, theme, p);
}

// shadowBlur 的 Graphics 近似:同一路径先加宽一道低透明度描边当辉光,再叠正式描边
function glowStroke(g: Graphics, f: Frame, pts: Pt[], color: string, glowW: number): void {
  g.strokeColor = withAlpha(pal(color), 0.30);
  g.lineWidth = f.lw(glowW);
  polyPath(g, pts, true);
  g.stroke();
}

/**
 * 羽毛球本体。
 *
 * 2026-09 精修(分级炫技 P0):老版本裙摆是**一整块五边形 + 5 条直线羽轴**,朝向写死
 * `atan2(vy,vx)`,于是变向那一帧整只球"啪"地翻面、羽片一动不动 —— 像个贴着速度矢量的
 * 图标,而不是一只在空气里飞的球。现在:
 *  * 朝向改用渲染层的**滞后角**(shuttle-motion:弹性追踪 + 过冲回正);
 *  * 裙摆拆成 `fx.shuttleFeathers` 片独立羽毛,按绕飞行轴的角度投影出横向位置与
 *    视宽(正对观众最宽、 silhouette 处退化成边),前后两遍绘制保证遮挡关系;
 *  * 翻滚相位驱动羽片明暗与球头高光 —— 无贴图也读得出自转;
 *  * 受力外扩(被抽到的那一下裙摆炸开)+ 压扁回弹过冲 + 命中整球 pop;
 *  * 档位辉光:甜区青、扣杀金、甜蜜重扣烧白核、连击火热羽尖染色。
 * `motion` 为 null 时(生涯预览/训练引导的静态球)退回老的硬对齐与零颤动,预览图不会歪。
 */
export function drawShuttle(g: Graphics, vp: Viewport, b: Ball, skin: SkinDef | null, cueGlow = 0,
  motion: ShuttleMotion | null = null): void {
  const bb = b as RBall;
  const F = C.fx;
  const sk = {
    cap: skin?.cap ?? SHUTTLE_DEFAULT.cap,
    band: skin?.band ?? SHUTTLE_DEFAULT.band,
    skirt: skin?.skirt ?? SHUTTLE_DEFAULT.skirt,
    vein: skin?.vein ?? SHUTTLE_DEFAULT.vein,
  };
  const bx = bb.rx ?? b.x, by = bb.ry ?? b.y;
  const sp = Math.hypot(b.vx, b.vy);
  // 球头朝运动方向;静止时朝下。比赛里的球走滞后角(有记忆,会变向过冲)
  const ang = motion ? motion.ang : (sp > 0.35 ? Math.atan2(b.vy, b.vx) : Math.PI / 2);
  const roll = motion ? motion.roll : 0.9;
  const splay = motion ? motion.splay : 0;
  const tier = motion ? motion.tier : 0;
  // 球体形变:击球瞬间沿飞行方向压扁,体积守恒(垂直方向膨胀),再叠回弹过冲与命中 pop
  const sqRaw = clamp(bb.sqR ?? b.sq ?? 1, 0.35, 1.5);
  const wob = motion ? shuttleWobble(motion, sqRaw) : 0;
  const pop = 1 + (motion ? motion.pop : 0);
  const sq = clamp(sqRaw + wob, 0.3, 1.6);
  const sqX = sq * pop;                   // 沿飞行方向压缩
  const sqY = pop / Math.sqrt(Math.max(0.4, sq));  // 垂直方向膨胀,保持视觉体积
  const S = shuttleFrame(vp, bx, by, ang, sqX, sqY);

  g.lineCap = LineCap.ROUND;
  g.lineJoin = LineJoin.ROUND;

  // 按拍预告辉光(画在球体之前当背光):game 层把来球逼近度喂进来,注意力跟球的玩家
  // 看不见按钮辉光,改为羽毛球本体发光。shadowBlur 近似 = 两层低透明度金晕,
  // 越接近最佳按拍帧越亮越大;峰值(≥0.9,约 3 帧)在球头外再闪一道白环提示「就是现在」。
  // 色值读 CFG.colors.sweet(铁律:数值只进 config)。
  if (cueGlow > 0) {
    const glow = Math.min(1, cueGlow) * C.swingCue.shuttleGlowMax;
    const r = C.swingCue.shuttleGlowR * (0.75 + 0.45 * cueGlow);
    g.fillColor = withAlpha(pal(C.colors.sweet.gold), 0.16 * glow);
    polyPath(g, ellipsePts(S, -2, 0, r * 1.7, r * 1.7), true);
    g.fill();
    g.fillColor = withAlpha(pal(C.colors.sweet.gold), 0.30 * glow);
    polyPath(g, ellipsePts(S, -2, 0, r, r), true);
    g.fill();
    if (cueGlow >= 0.9) {
      g.strokeColor = withAlpha(pal(C.colors.sweet.core), 0.9 * glow);
      g.lineWidth = S.lw(1.6);
      polyPath(g, arcPts(S, 0, 0, 9.5, 0, TAU, false), true);
      g.stroke();
    }
  }

  // 档位背光:这拍打进甜区/扣杀/连击火热,球身上就长期带一层对应颜色的 rim
  // (与拖尾档位同源 —— 玩家不看残影也能从球本身认出"这拍不一样")
  if (tier >= TIER_SWEET) {
    const rimCol = tier >= TIER_SMASH ? C.colors.smash.glow : C.colors.sweet.neonCyan;
    const a = tier >= TIER_SWEET_SMASH ? 0.2 : 0.14;
    g.strokeColor = withAlpha(pal(rimCol), a);
    g.lineWidth = S.lw(1.9);
    polyPath(g, ellipsePts(S, -5, 0, 10.5, 8), true);
    g.stroke();
    g.strokeColor = withAlpha(pal(C.colors.sweet.core), a * 0.9);
    g.lineWidth = S.lw(0.8);
    polyPath(g, ellipsePts(S, -5, 0, 10.5, 8), true);
    g.stroke();
  }

  // ---- 裙摆:拆片羽毛,绕飞行轴投影 ----
  const n = Math.max(3, Math.round(F.shuttleFeathers || 7));
  const baseX = -1.2, baseR = 3.2;
  const tipR = 8.4 + splay * 2.8;         // 受力炸开:裙口张开
  const tipX = -15 - splay * 1.8;         // 以及被拉长一点(羽片向后甩)
  const midX = (baseX + tipX) * 0.5;
  // 底衬:老的那块梯形仍在,但降透明度当"裙体阴影",羽片缝隙不再露背景
  g.fillColor = withAlpha(pal(sk.skirt), 0.34);
  polyPath(g, [S.pt(baseX, -baseR), S.pt(tipX, -tipR), S.pt(tipX, tipR), S.pt(baseX, baseR)], true);
  g.fill();

  // 两遍绘制:背向观众的半边先画(暗、窄),朝观众的半边压在前面 → 有遮挡关系
  // 羽片视宽按**环向弧长**投影算(2πR/n × |cosφ|):正对观众的那片刚好盖住自己那份
  // 扇区、侧面那片收成一条线 —— 这样 7 片铺满锥面不留缝,也不会像几把扇子叠在一起。
  const arcTip = (TAU * tipR) / n;
  const arcBase = (TAU * baseR) / n;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const phi = roll + (i * TAU) / n;
      const depth = Math.cos(phi);                     // >0 = 朝观众
      if (pass === 0 ? depth > 0 : depth <= 0) continue;
      const s = Math.sin(phi);
      // 颤动:相位随翻滚推进,慢球几乎不颤(没有气流),被抽到的那一下幅度最大
      const flut = Math.sin(roll * 2.4 + i * 1.15) * (F.featherFlex || 0.5) * (0.3 + splay);
      const y0 = s * baseR;
      // splay 越大裙口张得越开;羽尖位置不许越过锥面(s+颤动一起夹),否则 silhouette 会长刺
      const y1 = clamp(s + flut * 0.16, -1, 1) * tipR;
      const face = Math.abs(depth);                    // 正对观众 = 宽,侧面 = 成一条线
      const midY = y0 + (y1 - y0) * 0.5;
      const rMid = (baseR + tipR) * 0.5;
      const belly = 0.5 + splay * 0.45;                // 羽面鼓起
      const hw0 = Math.max(0.1, Math.min(0.16 + arcBase * 0.52 * face, baseR - Math.abs(y0)));
      const hwM = Math.max(0.1, Math.min(0.16 + arcTip * 0.52 * face + belly, rMid - Math.abs(midY)));
      const hw1 = Math.max(0.12, Math.min(0.16 + arcTip * 0.52 * face, tipR - Math.abs(y1)));
      const alpha = (pass === 0 ? 0.38 : 0.62) + 0.3 * Math.max(0, depth);
      g.fillColor = withAlpha(pal(sk.skirt), alpha);
      polyPath(g, [
        S.pt(baseX, y0 - hw0), S.pt(midX, midY - hwM), S.pt(tipX, y1 - hw1),
        S.pt(tipX, y1 + hw1), S.pt(midX, midY + hwM), S.pt(baseX, y0 + hw0),
      ], true);
      g.fill();
      // 中肋:羽轴(三点采样折线,不再是一条直线段)
      g.strokeColor = withAlpha(pal(sk.vein), alpha * 0.9);
      g.lineWidth = S.lw(0.7);
      polyPath(g, [S.pt(baseX + 0.4, y0), S.pt(midX, midY + flut * 0.05), S.pt(tipX, y1)], false);
      g.stroke();
    }
  }

  // 羽尖烧色:扣杀/甜蜜重扣/火热档,裙口那一段压一层焰色(越狠越明显)
  if (tier >= TIER_SMASH) {
    const heatHex = tier >= TIER_FIRE ? C.colors.smash.dark : C.colors.smash.flame;
    const heatA = tier >= TIER_FIRE ? 0.42 : 0.24;
    const k = F.shuttleHeatRim || 0.55;                 // 从裙口往里烧多少
    const hx0 = tipX + (midX - tipX) * k;
    const hin = baseR + (tipR - baseR) * (1 - k);       // 内缘半径(沿锥面收)
    g.fillColor = withAlpha(pal(heatHex), heatA);
    polyPath(g, [S.pt(hx0, -hin), S.pt(tipX, -tipR), S.pt(tipX, tipR), S.pt(hx0, hin)], true);
    g.fill();
  }

  // 裙口一圈:投影后是椭圆(不是半弧),描出来才有"开口"的体积感
  g.strokeColor = withAlpha(pal("#ffffff"), 0.88);
  g.lineWidth = S.lw(1.1);
  polyPath(g, ellipsePts(S, tipX, 0, 1.9 + splay * 0.6, tipR), true);
  g.stroke();

  // ---- 球托(软木):两圆错位的月牙暗面 → 有体积,不再是一张贴纸 ----
  const capR = 5.2;
  // 背光侧压一道深色(用角色描线同款近黑,低透明),再盖亮面 —— 软木是圆的
  g.fillColor = withAlpha(pal(HEAD), 0.3);
  polyPath(g, ellipsePts(S, 2.2 - Math.cos(roll) * 0.8, Math.sin(roll) * 0.5, capR, capR), true);
  g.fill();
  g.fillColor = pal(sk.cap);
  polyPath(g, ellipsePts(S, 3.4, 0, capR * 0.97, capR * 0.97), true);
  g.fill();
  // 甜蜜重扣/火热:球心烧白(击球点残留的炽核)
  if (tier >= TIER_SWEET_SMASH) {
    g.fillColor = withAlpha(pal(C.colors.sweet.core), tier >= TIER_FIRE ? 0.55 : 0.4);
    polyPath(g, ellipsePts(S, 2.6, 0, 3.4, 3.4), true);
    g.fill();
  }
  // 腰线(软木与羽毛交界的胶带)
  g.fillColor = pal(sk.band);
  polyPath(g, arcPts(S, 3, 0, 5.2, -1.05, 1.05, false), true);
  g.fill();
  // 高光随翻滚绕球头转一圈 —— 静止也有细节,动起来就是自转
  const hlY = -3.4 + Math.sin(roll) * 1.15;
  fillRectTr(g, S, 1.6 + Math.cos(roll) * 0.8, hlY, 1.6, 2,
    withAlpha(pal("#ffffff"), 0.42 + 0.2 * Math.max(0, Math.cos(roll))));
}
