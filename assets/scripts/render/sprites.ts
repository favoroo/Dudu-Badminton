// ============================================================
// 角色与羽毛球:3/4 斜侧卡通小人 + 阵营色球衣 + 挥拍弧光 + 球头朝速度方向
// —— 自老版 canvas 工程 src/render/sprites.js 逐行移植,姿势/插值/动画数值零改动。
// 视角约定:躯干/腿/双臂/头全部按「面向球网的 3/4 斜侧」画,靠 facing 镜像。
// 曾经正面躯干配侧面手臂,两套视角语汇打架,这是当年重构的根因。
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
//    留【移植限制】注释,坐标已标好,由表现层挂 Label 补上。
//
// 第 4 个参数 alpha 是渲染插值系数(0..1,帧间补偿),不是透明度 —— 与老 game.js 同名同义。
// ============================================================
import { Color, Graphics } from "cc";
import { CFG } from "../core/config";
import { Player, Ball, FaceKind, SkinDef, SwingStyle, Theme } from "../core/types";
import { Physics } from "../core/physics";
import { lerp, clamp, TAU, D2R } from "../core/utils";
import { pal, withAlpha } from "./palette";

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
    pt: (lx, ly) => ({ x: vp.x(wx + facing * sx * lx), y: vp.y(wy + sy * ly) }),
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
      const rx = lx * sqX, ry = ly * sqY;
      return { x: vp.x(wx + rx * cos - ry * sin), y: vp.y(wy + rx * sin + ry * cos) };
    },
    lw: (v) => v * k,
    kx: 0, ky: 0,
  };
}

// ---------- 折线 / 采样:cc.Graphics.arc 扫向与 canvas 相反,统一自采样最稳 ----------

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

/** 局部圆弧按 canvas 语义采样成折线(角度在局部 canvas 约定里解释,方向视觉与原版一致) */
function arcPts(f: Frame, cx: number, cy: number, r: number, a0: number, a1: number, ccw: boolean): Pt[] {
  const d = sweepDelta(a0, a1, ccw);
  const steps = Math.max(2, Math.ceil((Math.abs(d) / TAU) * 36));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = a0 + (d * i) / steps;
    pts.push(f.pt(cx + r * Math.cos(th), cy + r * Math.sin(th)));
  }
  return pts;
}

/** 一般椭圆参数采样(带旋转/非均匀缩放的椭圆 cc ellipse 画不了,统一折线) */
function ellipsePts(f: Frame, cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * TAU;
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

// 头部固定配色(重设计):一整颗黑脸圆 + 白色线条五官,队色只上发带 ——
// 黑脸上唯一的彩色,红蓝阵营识别靠它。SKIN/SKIN_LINE 仍用于手臂与手。
const SKIN = "#f2c491", SKIN_LINE = "rgba(10,13,24,0.55)";
const HEAD = "#0a0e18", HEAD_LINE = "rgba(235,240,255,0.5)", FACE = "#ffffff";

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

// 待机持拍姿势(肩坐标系):屈肘把拍收在体前,拍头朝上举在胸侧。
// 起拍/收拍都在它和挥拍弧线之间插值,替代原先两套硬编码坐标之间的瞬跳
const IDLE_POSE: Pose = { pts: [[0, -2], [9, 10]], hand: [20, 22], ang: 68, len: 25 };

interface Pose {
  pts: number[][];
  hand: number[];
  ang: number;
  len: number;
}

// ---------- 远臂(非持拍侧)的两段 FK ----------
// 旧版把远臂写成三个硬点,手位随动作改、肘位却是定值,结果两段长度忽长忽短(实测
// 11.2~21.1)、肘折角忽大忽小(0°~68.6°)、末端还没有手 —— 三件事叠在一起,屏幕上
// 就是一根钉在背后的棍子。改成「上臂角 + 前臂角」两段之后:两段恒等长(不可能缩成
// 短棍),肘折角 = |ef-ea| 可以直接控,而且角度线性插值不绕圈 → 状态切换天然平滑。
// 两段比持拍臂(实测 15.0 / 16.2)各收一档:远侧透视,绝不允许长过近侧。
const FAR_UA = 16, FAR_FA = 14.5;

/** 远臂姿势:肩帧下的 [肩(0,0), 肘] 与手位(不含拍,所以不复用 Pose 的 ang/len) */
interface FarPose { pts: number[][]; hand: number[] }

/** 远臂两段 FK。ea=上臂角,ef=前臂角(度,canvas 约定:0=朝网,正=向上,与 Pose.ang 同语义) */
function farPose(ea: number, ef: number): FarPose {
  const r1 = ea * D2R, r2 = ef * D2R;
  const ex = Math.cos(r1) * FAR_UA, ey = -Math.sin(r1) * FAR_UA;
  return {
    pts: [[0, 0], [ex, ey]],
    hand: [ex + Math.cos(r2) * FAR_FA, ey - Math.sin(r2) * FAR_FA],
  };
}

/** 挥拍中远臂的两段角:与持拍臂反相。u=0 两臂同举(引拍框架位,真实高远球就是双手都抬),
 *  u=1 远臂整条下落收拢(转体夹臂)。前臂始终落后上臂 45~50°(bend = -45-5u),所以**挥拍全程**
 *  肘折都看得见,不会像旧版那样挥到一半 deflection 掉到 1.3° 突然变棍子。
 *  注:挥拍结束 → 待机的收拍段会经过伸直(手从身后垂处抬到头后,前臂必须绕肘翻折方向),
 *  那是真实手臂的样子;此时仍靠「两段等长 + 肤色分段 + 手盘」三条不变量保证读作手臂。 */
function farSwingAngles(style: SwingStyle, u: number): [number, number] {
  return style === "under"
    ? [lerp(158, 224, u), lerp(110, 176, u)]
    : [lerp(150, 214, u), lerp(105, 164, u)];
}

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
    pt: (lx, ly) => ({ x: vp.x(sa.x + (sa.facing || 1) * lx), y: vp.y(sa.y + ly) }),
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

// 两套姿势间逐点插值:肘/手/拍角/拍长同时过渡,手臂不会中途脱节
function poseLerp(a: Pose, b: Pose, k: number): Pose {
  return {
    pts: a.pts.map((pt, i) => [lerp(pt[0], b.pts[i][0], k), lerp(pt[1], b.pts[i][1], k)]),
    hand: [lerp(a.hand[0], b.hand[0], k), lerp(a.hand[1], b.hand[1], k)],
    ang: lerp(a.ang, b.ang, k),
    len: lerp(a.len, b.len, k),
  };
}

// 挥拍中的臂姿势:手钉在与判定同源的弧线上(P.swingPose 的呼吸半径),
// 肘是垂直于肩→手方向的偏置,中段最弯、起收伸直
function swingArmPose(ang: number, reach: number, u: number): Pose {
  const rad = ang * D2R, dx = Math.cos(rad), dy = -Math.sin(rad);
  const gx = dx * reach * 0.42, gy = dy * reach * 0.42;
  const bend = Math.sin(clamp(u, 0, 1) * Math.PI) * reach * 0.12;
  return {
    pts: [[0, 0], [gx * 0.5 + dy * bend, gy * 0.5 - dx * bend]],
    hand: [gx, gy],
    ang, len: reach * 0.58,
  };
}

// 收拍姿势:k=0 是弧线终点(u=1:呼吸半径收至 0.86、腕部过冲恰归零,与挥拍末帧无缝),
// k=1 回到待机。用 lastSwingStyle/Radius:起拍会把 swingStyle 换成本拍的,回摆得看上一拍
function recoverPose(p: RPlayer, k: number): Pose {
  const arc = Physics.swingArc(p.lastSwingStyle ?? p.swingStyle);
  const reach = (p.lastSwingRadius ?? p.swingRadius) * 0.86;
  return poseLerp(swingArmPose(arc.to, reach, 1), IDLE_POSE, k);
}

// 分段线性查表:躯干拧转曲线这类小型关键帧
function lut(tbl: number[][], x: number): number {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      return lerp(tbl[i - 1][1], tbl[i][1], (x - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0]));
    }
  }
  return tbl[tbl.length - 1][1];
}

export function drawPlayer(g: Graphics, vp: Viewport, p: Player, animT: number, alpha: number, ball: Ball | null): void {
  const pp = p as RPlayer;
  const t = animT;
  const x = pp.rx ?? pp.x, y = pp.ry ?? pp.y;
  const th = p.theme ?? DEFAULT_THEME;
  // 完整人物皮肤(发型/头饰/纹样/光环):CPU/P2 没挂 → null 走原版画法
  const ps = p.playerSkin ?? null;
  const H = C.player.h, W = C.player.w;

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
  // 恢复期也保留一点前倾残影,渐出
  const lungeRecov = p.lungeRecovery > 0 ? clamp(p.lungeRecovery / (C.lunge.recoveryFrames || 18), 0, 1) : 0;
  const lungeLean = (lunging ? Math.sin(lungeU * Math.PI) * 8 : lungeRecov * 3);  // 跨步中身体大幅倾斜
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

  // 呼吸律动:复合波(~3s 主周期 + ~6s 副周期),待机时最明显,跑/跳时降级为背景
  const breathBob = Math.sin(t * 0.035) * 1.2 + Math.sin(t * 0.017) * 0.4;
  const bob = airborne ? breathBob * 0.3 + Math.sin(t * 0.05) * 0.4
    : lerp(breathBob, Math.abs(cycRaw) * (1.2 + 1.2 * spN), runAmt);
  // 重心微移:极慢横向偏移(~8s 周期),只影响上半身;挥拍/跨步时大幅衰减
  const idleWeight = swinging || lunging ? 0.1 : 1;
  const weightShift = Math.sin(t * 0.012) * 1.0 * (1 - runAmt * 0.7) * idleWeight;

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
    + landAmt * 4;                           // 落地冲击:躯干前倾吸收冲击

  // ---------- 远臂:躯干后层的远侧手臂(景深)。两段 FK + 肤色小臂 + 手,跟着动作反相 ----------
  // 画在腿/躯干/头之前 → 内侧被躯干盖住是刻意的景深。不要在这里"对称地"补一颗肩关节圆:
  // 远肩距躯干背缘只有 5.8,画了会被整个抹掉(近侧那颗有效是因为它画在躯干之后)。
  const bsx = -9 + (lean - 2) * 0.9;             // 远侧肩:与近侧 A 相距 10.5 = 3/4 视角的肩宽透视;
  const bsy = SW.pivotY + bob - 2 + runShDy;    //   离转体轴更远所以 lean 系数 0.9 > 近侧的 0.8;跑步时肩高差
  const B = offsetFrame(F, bsx, bsy);            //   比近侧肩高 2:斜侧视角远肩略抬,肘更容易露出背缘

  // 基准 = 待机放松挂位(肘朝后外翻、前臂垂在后下),跑动/空中/跨步/情绪逐层覆盖
  let fea = 206, fef = 250;
  // 待机呼吸:远臂基线角度随呼吸微变(不同周期,避免与近臂同步)
  if (!swinging && p.recoverT <= 0 && !airborne && !lunging && !celebrating && !frustrated) {
    fea += Math.sin(t * 0.018) * 3; fef += Math.sin(t * 0.014 + 0.5) * 2.5;
  }
  // 落地冲击:远臂下意识外展缓冲
  if (landing) { fea += landAmt * 8; fef += landAmt * 6; }
  // 对侧步态:远侧臂与近侧(前)腿同相。旧版写的是 -cycRaw,与前腿反相 = 顺拐
  fea += cycRaw * 14 * runAmt; fef += cycRaw * 18 * runAmt;
  if (airborne) { fea = lerp(fea, 178, 1 - runAmt); fef = lerp(fef, 128, 1 - runAmt); }
  if (lunging) {
    // 上网救球:远臂朝后上猛甩(走钢丝式平衡);退防跨步:整条下压后摆
    const k = lungeLegExt;
    const la = lungeDirRel > 0 ? 168 : 196, lf = lungeDirRel > 0 ? 118 : 250;
    fea = lerp(fea, la, k); fef = lerp(fef, lf, k);
  }
  if (celebrating) {                             // 挥拳:手举到头顶后缘外
    const s = Math.sin(celebrateU * Math.PI);
    fea = lerp(fea, 150, s) - 10 * s; fef = lerp(fef, 95, s);
  }
  if (frustrated) {                              // 耷拉:偏转角刻意收到 30 = limp,但手盘和肤色段还在
    const s = Math.sin(frustrateU * Math.PI);
    fea = lerp(fea, 230, s); fef = lerp(fef, 260, s);
  }
  fea += (p.hitRecoil || 0) * 0.6;

  // 收拍 → 挥拍:与持拍臂共用 recK / blendIn 两条窗。**顺序不可调换** —— 缓冲衔接的连拍
  // 在起拍时 recoverT 还没走完,远臂要从回摆中途接过去(对应持拍臂的 poseLerp(recoverPose…))
  let cea = fea, cef = fef;
  if (!swinging && p.recoverT > 0) {
    const e = farSwingAngles(pp.lastSwingStyle ?? p.swingStyle, 1);   // u=1 与挥拍末帧无缝
    cea = lerp(e[0], fea, recK); cef = lerp(e[1], fef, recK);
  }
  if (swinging && sp) {
    const t = farSwingAngles(p.swingStyle, clamp(poseU, 0, 1));
    const k = swT < SW.blendIn ? 1 - (1 - clamp(swT / SW.blendIn, 0, 1)) ** 2 : 1;
    fea = lerp(cea, t[0], k); fef = lerp(cef, t[1], k);
    fef -= Math.cos(sp.ang * D2R) * 6;           // 反相锁:持拍臂越朝网,远臂越朝后
  } else {
    fea = cea; fef = cef;
  }
  // 命中后跟随:远臂反向平衡(近臂横拉过身体,远臂自然外展)
  if (ft && poseU > 0.5) {
    fea += (poseU - 0.5) * 2 * 12;
  }

  // 手指向来球:只在远臂已抬起(fea<195)且球在肩以上时轻推,±12° 封顶。绝不做全 IK ——
  // 手一往前上就撞进后脑的遮挡圆,往回缩就没过躯干背缘,两头都坏事
  if (ball && fea < 195) {
    const bdx = (ball.x - x) * p.facing, bdy = ball.y - (y + SW.pivotY);
    if (bdy < -6) {
      let d = Math.atan2(-bdy, bdx) / D2R - fef;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      fef += clamp(d, -12, 12);
    }
  }

  // 三段两色,一档比近侧(5.5 / 5.5 / r3.6)细、压得更狠 → 远侧更细更远。
  // 这里的 alpha 是真透明度(withAlpha 把 a 叠进颜色),不是 drawPlayer 第 4 参那个帧间插值系数。
  // 深袖 + 肤色小臂的分段是「读作手臂」的关键:整条同色会在球衣上读成斜挎的带子。
  const fp = farPose(fea, fef);
  arm(g, B, th.dark, fp.pts, 5.0, 0.68);
  arm(g, B, SKIN, [fp.pts[1], fp.hand], 4.4, 0.62);
  drawHand(g, B, fp.hand[0], fp.hand[1], 3.3, 0.66);   // 有手 = 是手臂,不是棍子

  // ---------- 腿:跑姿(幅度随速度)与空中姿势(升收腿/落展腿)按权重混合 ----------
  const hipY = -H * 0.34 + bob;
  const thigh = H * 0.19, shin = H * 0.09;
  const skinGap = H * 0.04;                    // 短裤与球袜之间露出的膝盖皮肤段
  const sockH = shin - skinGap;                 // 球袜相应缩短
  const shoeH = H * 0.095;                     // 鞋高(加厚:7→9.5,羽毛球鞋厚底)
  // 后腿(远侧)整体压暗 + 收窄,前腿(近侧)受光 —— 前后景深一眼读出侧身
  const legs = [
    { bx: -W * 0.14, sock: "#cdc9bd", shoe: "#141824", s: -1, far: true },
    { bx: W * 0.10, sock: "#f2efe6", shoe: "#1b1f2e", s: 1, far: false },
  ];
  const airK = clamp((p.vy + 3) / 6, 0, 1);           // 0=刚起跳(收腿) 1=快落地(展腿)
  const wAir = airborne ? 1 - runAmt : 0;
  for (const L of legs) {
    const runDx = L.s * cycRaw * (2.5 + 3.5 * spN);
    const runLift = Math.max(0, L.s * cycRaw) * (3 + 4 * spN);
    const airDx = L.s * lerp(2, 4.5, airK);
    const airLift = L.s > 0 ? lerp(5, 1, airK) : lerp(2, 0.5, airK);
    // 跨步救球:沿跨步方向的大腿大幅伸出,另一条腿拖后压低
    const isLeadLeg = L.s * lungeDirRel > 0;
    const lungeDx = isLeadLeg ? lungeLegExt * 12 * lungeDirRel : -lungeLegExt * 6 * lungeDirRel;
    const lungeLift = isLeadLeg ? -lungeLegExt * 3 : lungeLegExt * 2;
    const dx = runDx * runAmt + airDx * wAir + lungeDx;
    const lift = runLift * runAmt + airLift * wAir + lungeLift;
    // 跑步膝盖弯曲:摆动期(腿在前)小腿向后折,支撑期(腿在后)伸直
    // L.s * cycRaw > 0 = 该腿在前(摆动期),弯曲; < 0 = 在后(支撑期),伸直
    const kneeBend = Math.max(0, L.s * cycRaw) * (C.player.kneeBendMax || 8) * spN * runAmt;
    // 落地冲击:双腿同步深弯吸收冲击,幅度随 squash 恢复衰减
    const landKnee = landAmt * 14;
    const kneeOff = -(kneeBend + landKnee);                     // 小腿向后(远离网方向)偏移
    const kneeLift = (kneeBend + landKnee) * 0.35;              // 弯曲时脚微抬(脚跟离地)
    // 远侧腿:宽度收窄 8%(透视缩短) + 颜色压暗(景深)
    const lw = L.far ? 0.92 : 1.0;
    const darkColor = L.far ? withAlpha(pal(th.dark), 0.78) : pal(th.dark);
    const skinColor = L.far ? withAlpha(pal(SKIN), 0.78) : pal(SKIN);
    const sockColor = L.far ? withAlpha(pal(L.sock), 0.82) : pal(L.sock);
    const shoeColor = L.far ? withAlpha(pal(L.shoe), 0.80) : pal(L.shoe);
    px(g, F, L.bx + dx - W * 0.12 * lw, hipY, W * 0.24 * lw, thigh - lift, darkColor);              // 短裤/大腿
    px(g, F, L.bx + dx + kneeOff - W * 0.10 * lw, hipY + thigh - lift, W * 0.20 * lw, skinGap, skinColor);     // 膝盖皮肤
    px(g, F, L.bx + dx + kneeOff - W * 0.10 * lw, hipY + thigh + skinGap - lift - kneeLift, W * 0.20 * lw, sockH, sockColor); // 球袜
    px(g, F, L.bx + dx + kneeOff - W * 0.165 * lw, hipY + thigh + shin - 1 - lift - kneeLift, W * 0.33 * lw, shoeH, shoeColor); // 鞋(加厚加宽)
  }

  // ---------- 躯干:3/4 斜侧 —— 向网侧偏置 + 上段前倾 + 前亮后暗 + 脊柱曲度 ----------
  const bodyTop = -H * 0.72 + bob;
  const bodyH = H * 0.38;
  const tw = W * 0.66, tx = -W * 0.40;
  // 脊柱曲度:髋部稳定、肩部拧转,中间渐变形成弯曲感(而非两段折角)
  const spineCurve = Math.abs(lean - 2) * 0.35
    + (swinging ? Math.sin(Math.min(poseU, 1) * Math.PI) * 1.5 : 0)
    + Math.abs(lungeLean) * 0.15
    + Math.abs(cycRaw) * 0.4 * runAmt * spN;
  const midLean = lean * 0.45 + Math.sign(lean - 2) * spineCurve;  // 腰部中间段偏移
  px(g, F, tx, bodyTop + bodyH * 0.42, tw, bodyH * 0.58, th.main);                    // 下段(髋)
  px(g, F, tx + midLean, bodyTop + bodyH * 0.22, tw, bodyH * 0.22, th.main);          // 中段(腰,脊柱曲度)
  px(g, F, tx + lean + runTwist, bodyTop, tw, bodyH * 0.5, th.main);                  // 上段(肩,前倾+扭转)
  px(g, F, tx + lean + runTwist + tw - 3, bodyTop + 5, 3, bodyH * 0.5 - 9, "rgba(255,255,255,0.20)");   // 前缘受光
  px(g, F, tx + tw - 3, bodyTop + bodyH * 0.42 + 5, 3, bodyH * 0.58 - 9, "rgba(255,255,255,0.12)");
  px(g, F, tx + lean + runTwist, bodyTop + 5, 3, bodyH * 0.42 - 4, "rgba(0,0,0,0.20)");          // 背缘背光
  px(g, F, tx, bodyTop + bodyH * 0.42 + 5, 3, bodyH * 0.58 - 5, "rgba(0,0,0,0.24)");
  // 领口从脖子前沿往网侧延伸:若拖到脖子后面,会在颈后留一块没归属的深色补丁
  px(g, F, 2, bodyTop, tx + lean + runTwist + tw - 2, 5, th.dark);
  px(g, F, tx + tw * 0.25, bodyTop + bodyH - 4, tw * 0.75, 4, "rgba(255,255,255,0.20)");
  // V 领:躯干上段顶部中央的 V 形线条,运动球衣的领口细节
  const vCollarCx = tx + lean + runTwist + tw * 0.52;
  const vCollarTop = bodyTop + 3;
  g.strokeColor = withAlpha(pal(FACE), 0.30);
  g.lineWidth = F.lw(1.2);
  lineSeg(g, F, vCollarCx - 3.5, vCollarTop, vCollarCx, vCollarTop + 5.5);
  lineSeg(g, F, vCollarCx, vCollarTop + 5.5, vCollarCx + 3.5, vCollarTop);
  g.stroke();
  // 侧条纹:躯干前缘一道纵向亮线,运动球衣的常见装饰
  px(g, F, tx + lean + runTwist + tw * 0.18, bodyTop + 6, 1.5, bodyH * 0.82, "rgba(255,255,255,0.10)");
  // ---------- 球衣纹样(设计款人物专属):压在底色上、领口描边之下 ----------
  // 局部参考:躯干从 (tx+lean+runTwist, bodyTop) 到 (+tw, +bodyH);glow 色做纹样主色
  if (ps?.jersey) {
    const jx = tx + lean + runTwist;
    if (ps.jersey === "stripes") {
      // 霓虹双条纹:前胸两道竖纹(赛博骇客)
      px(g, F, jx + tw * 0.30, bodyTop + 4, 2, bodyH * 0.86, withAlpha(pal(th.glow), 0.9));
      px(g, F, jx + tw * 0.46, bodyTop + 4, 2, bodyH * 0.86, withAlpha(pal(th.glow), 0.55));
    } else if (ps.jersey === "sash") {
      // 斜披巾:背肩 → 前髋一条斜带,双线勾边(烈焰少年)
      g.strokeColor = withAlpha(pal(th.glow), 0.92);
      g.lineWidth = F.lw(5);
      lineSeg(g, F, jx + 2, bodyTop + 4, jx + tw - 3, bodyTop + bodyH - 3);
      g.stroke();
      g.strokeColor = withAlpha(pal(th.dark), 0.8);
      g.lineWidth = F.lw(1.2);
      lineSeg(g, F, jx + 2, bodyTop + 7, jx + tw - 4, bodyTop + bodyH - 3);
      g.stroke();
    } else if (ps.jersey === "trim") {
      // 樱纹描边:领口/下摆/前缘走一道 glow 细边(樱花少女)
      g.strokeColor = withAlpha(pal(th.glow), 0.95);
      g.lineWidth = F.lw(1.4);
      lineSeg(g, F, jx + 1, bodyTop + bodyH - 2, jx + tw - 1, bodyTop + bodyH - 2);   // 下摆
      lineSeg(g, F, jx + tw - 2, bodyTop + 4, jx + tw - 2, bodyTop + bodyH - 4);      // 前缘
      g.stroke();
      px(g, F, jx + tw * 0.34, bodyTop + bodyH * 0.42, 2.2, 2.2, th.glow);            // 一颗小樱点
      px(g, F, jx + tw * 0.52, bodyTop + bodyH * 0.58, 2.2, 2.2, withAlpha(pal(th.glow), 0.7));
    } else if (ps.jersey === "twoTone") {
      // 拼色:腰腹以下整段换 glow 色 + 一道腰带分界(球场之王:白金拼色)
      px(g, F, jx, bodyTop + bodyH * 0.55, tw, bodyH * 0.45, withAlpha(pal(th.glow), 0.85));
      px(g, F, jx, bodyTop + bodyH * 0.55, tw, 2, th.dark);
    }
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
  const headDy = swingHeadDy + runHeadBob + landHeadTuck + lungeHeadTilt;
  // 眼神追球:瞳孔朝球的方向偏一点(局部坐标);没球时看向前方。眨眼按相位错开的
  // 周期触发,无状态 —— 不用给每个角色维护计时器
  let lookX = 0.6, lookY = 0;
  if (ball) {
    const ldx = (ball.x - x) * p.facing, ldy = ball.y - (y - H * 0.9);
    const ld = Math.hypot(ldx, ldy) || 1;
    lookX = ldx / ld * 1.3; lookY = ldy / ld * 1.3;
  }
  const blink = ((t + (p.blinkSeed ?? 0)) % 220) < 5;
  px(g, F, -1 + (lean - 2) * 0.6, bodyTop - 7, 6, 9, SKIN);
  drawHead(g, F, th, H * 0.21, 2 + (lean - 2) * 0.6, bodyTop - H * 0.21 * 1.12 + headDy,
    { lookX, lookY, blink, t, face: p.face, faceT: p.faceT, faceD: p.faceD, skin: ps });

  // ---------- 持拍臂:一条姿势管线,挥拍弧线 ↔ 待机收拍全程连续 ----------
  // 命中后持拍臂横拉过身体:肩点朝网侧额外偏移(增强跟随感)
  const ftPull = (ft && poseU > 0.6) ? (poseU - 0.6) * 2.5 * p.facing : 0;
  const A = offsetFrame(F, 1.5 + (lean - 2) * 0.8 + ftPull, SW.pivotY + bob - runShDy);   // 肩点在躯干上段内,随拧转前移;跑步肩高差与远肩反向
  let pose: Pose;
  const prevAng = lastAng.get(angKey(p)) ?? null;
  if (swinging && sp) {
    // 腕部甩击:判定窗关闭后拍角才允许越过臂角,随挥末端过冲再弹回 —— 期间不碰判定
    const wU = (SW.windup + SW.active) / Physics.swingTotal();
    const wrist = sp.u > wU
      ? Math.sin((sp.u - wU) / (1 - wU) * Math.PI) * SW.wristOvershoot : 0;
    const dir = Math.sign(sp.to - sp.from) || 1;
    pose = swingArmPose(sp.ang + dir * wrist, sp.reach, sp.u);
    if (swT < SW.blendIn) {
      // 起拍过渡:上一拍没收完就从那里接,否则从待机;easeOut 让引拍先快后缓
      pose = poseLerp(recoverPose(pp, recK), pose, 1 - (1 - clamp(swT / SW.blendIn, 0, 1)) ** 2);
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
    pose = recoverPose(pp, recK);        // 收拍回摆:弧线终点 → 待机,渐出
    lastAng.set(angKey(p), null);
  } else if (celebrating) {
    // 庆祝姿势:拍举高,手臂上扬
    const cU = Math.sin(celebrateU * Math.PI);
    pose = { pts: [[0, -2], [6, -8 - cU * 12]], hand: [14, -18 - cU * 10], ang: 78 + cU * 15, len: 25 };
    lastAng.set(angKey(p), null);
  } else if (frustrated) {
    // 沮丧姿势:拍低垂,肩膀下沉
    const fU = Math.sin(frustrateU * Math.PI);
    pose = { pts: [[0, 2 + fU * 3], [8, 14 + fU * 4]], hand: [18, 26 + fU * 3], ang: 58 - fU * 8, len: 25 };
    lastAng.set(angKey(p), null);
  } else {
    lastAng.set(angKey(p), null);
    // 待机:屈肘把拍收在体前 + 呼吸微摆(拍角/手位随呼吸漂移)
    pose = {
      pts: IDLE_POSE.pts,
      hand: [IDLE_POSE.hand[0], IDLE_POSE.hand[1] + Math.sin(t * 0.025) * 1.2],
      ang: IDLE_POSE.ang + Math.sin(t * 0.025) * 2.5,
      len: IDLE_POSE.len,
    };
  }
  // 上臂深色衣袖 + 前臂露肤色:整条深色会在球衣上读成「斜挎的带子」
  arm(g, A, th.dark, pose.pts);
  arm(g, A, SKIN, [pose.pts[1], pose.hand]);
  drawRacket(g, A, pose.hand[0], pose.hand[1], pose.ang, pose.len, th, p);
  drawHand(g, A, pose.hand[0], pose.hand[1]);
  // 肩关节衔接件:手臂从肩头长出来,不再从躯干边缘凭空伸出
  g.fillColor = pal(th.dark);
  circleAA(g, A, 0, 0, 4.5);
  g.fill();

  // 角色头顶名牌与操控指示标
  if (!p.hideTag) {
    drawPlayerTag(g, vp, p, x, y, t);
  }
}

// ---------- 角色头顶名牌: 区分 YOU / P1 / P2 / 搭档 / CPU ----------
// 【移植限制】canvas 的 measureText/fillText 无 Graphics 对应:胶囊与光标照画,
// 文字宽度按字数估算(半角≈6.4px / 全角≈9.5px @ 800 9.5px),文字本身交表现层 Label。
function drawPlayerTag(g: Graphics, vp: Viewport, p: Player, x: number, y: number, t: number): void {
  const label = p.label || (p.isAI ? "AI" : "YOU");
  const isMainUser = (!p.isAI && (label === "你" || label === "P1" || label === "YOU"));
  const isPartner = label === "搭档";
  const isP2 = label === "P2";

  const tagY = y - C.player.h - 18;

  // 1. 操控玩家专属悬浮倒三角光标 ▼ (上下轻微律动)
  if (isMainUser) {
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

  // 2. 身份胶囊名牌
  const tagText = label === "你" ? "YOU" : label;
  const tw = estTextWidth(tagText);
  const pw = Math.max(28, tw + 10);
  const ph = 14;
  const lx = x - pw / 2;
  const ly = tagY - ph / 2;
  const r = ph / 2;

  const rectX = Math.round(vp.x(lx));
  const rectY = Math.round(vp.y(ly + ph));

  // 深色胶囊底衬 (任何球场背景下均清晰醒目)
  g.fillColor = pal(isMainUser
    ? "rgba(10, 14, 28, 0.78)"
    : isPartner
    ? "rgba(10, 26, 34, 0.75)"
    : "rgba(12, 14, 22, 0.58)");
  // canvas 用四段 arcTo 圆角;胶囊半径恰为半高,roundRect 等价(y 翻转后取数学最小角)
  g.roundRect(rectX, rectY, pw, ph, r);
  g.fill();

  // 胶囊描边
  g.lineWidth = 1;
  g.strokeColor = pal(isMainUser
    ? (p.side === "left" ? "rgba(255, 225, 77, 0.85)" : "rgba(62, 168, 255, 0.85)")
    : isPartner
    ? "rgba(0, 240, 255, 0.65)"
    : isP2
    ? "rgba(62, 168, 255, 0.75)"
    : "rgba(255, 255, 255, 0.25)");
  g.roundRect(rectX, rectY, pw, ph, r);
  g.stroke();

  // 文字:【移植限制】原为 fillText(tagText, x, tagY+0.5),800 9.5px 居中/垂直居中,
  // 颜色按身份:主控 黄(左)/#7fd0ff(右)、搭档 #6ee7b7、P2 #7fd0ff、其余 rgba(255,255,255,0.68)。
  // 建议表现层在 (vp.x(x), vp.y(tagY+0.5)) 挂 Label 补上,与胶囊同一节点方便回收。
}

// canvas measureText 的替代:按 800 9.5px 估宽(全角 9.5,半角 6.4),胶囊宽度误差 1~2px
function estTextWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 9.5 : 6.4;
  return w;
}

// ---------- 头:一整颗黑脸圆 + 白色线条五官 + 队色发带(重设计) ----------
// 肤色/刘海/耳朵全部去掉,表情全靠白色线条(face 种类见 types.FaceKind),
// 局部 +x = 朝球网:近侧眼大、远侧眼小,瞳位随 opt.look 追球,和斜侧身体同一个视角。
// 注意 cc.Graphics 的 fill()/stroke() 会消费当前路径(弧光双描边处靠重建路径证实),
// 所以「填充 + 描边」同一形状必须重建路径,攒路径后一次性 stroke 与 canvas 同构。
function drawHead(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number,
  opt: { lookX?: number; lookY?: number; blink?: boolean; t?: number; face?: FaceKind; faceT?: number; faceD?: number;
    skin?: SkinDef | null } = {}): void {
  const lx = opt.lookX || 0, ly = opt.lookY || 0;
  const face: FaceKind = (opt.faceT ?? 0) > 0 ? (opt.face ?? "normal") : "normal";
  const sk = opt.skin ?? null;

  // 黑脸圆:近黑填充 + 淡白描边,暗色球馆里勾出轮廓
  g.fillColor = pal(HEAD);
  circleAA(g, f, cx, cy, hr);
  g.fill();
  g.strokeColor = pal(HEAD_LINE);
  circleAA(g, f, cx, cy, hr);
  g.lineWidth = f.lw(1.6);
  g.stroke();

  // 近侧耳朵:3/4 视角下背侧(远网侧)的一个小半圆凸起,让头部轮廓从"光头球"变成"有人形"
  // 位置在头的背侧边缘偏下(耳廓大约在眼-嘴中线高度),半径约头径 18%
  const earX = cx - hr * 0.85, earY = cy + hr * 0.10;
  g.fillColor = pal(HEAD);
  circleAA(g, f, earX, earY, hr * 0.18);
  g.fill();
  g.strokeColor = pal(HEAD_LINE);
  circleAA(g, f, earX, earY, hr * 0.18);
  g.lineWidth = f.lw(1.0);
  g.stroke();

  // 头顶高光:一道极淡反光弧,黑脸不至于闷成纯色块
  g.strokeColor = withAlpha(pal(FACE), 0.15);
  g.lineWidth = f.lw(2.5);
  polyPath(g, arcPts(f, cx, cy, hr * 0.76, Math.PI * 1.12, Math.PI * 1.42, false), false);
  g.stroke();

  // ---------- 发型(设计款):盖在头圆上部,发带/头饰压在它上面 ----------
  if (sk?.hairStyle && sk.hairColor) {
    drawHair(g, f, sk.hairStyle, sk.hairColor, hr, cx, cy);
  }

  // 头饰(设计款)替换默认队色发带;ribbon 是叠饰,发带照画再补结饰
  const hw = sk?.headwear;
  if (hw === "cap") {
    drawCap(g, f, th, hr, cx, cy);
  } else if (hw === "crown") {
    drawCrown(g, f, hr, cx, cy);
  } else if (hw === "goggles") {
    drawGoggles(g, f, th, hr, cx, cy);
  } else if (hw === "bandana") {
    drawBandana(g, f, th, hr, cx, cy, opt.t ?? 0);
  } else {
    // 队色发带:压在头顶,黑脸上的红蓝识别靠它
    g.strokeColor = pal(th.main);
    g.lineWidth = f.lw(4);
    polyPath(g, arcPts(f, cx, cy, hr * 0.9, Math.PI * 1.14, Math.PI * 1.86, false), false);
    g.stroke();
    if (hw === "ribbon") drawRibbon(g, f, th, hr, cx, cy);
  }

  // ---------- 五官基线:眼距沿用 3/4 透视(网侧大、背侧小) ----------
  const exN = cx + hr * 0.40, exF = cx - hr * 0.16;   // 近/远眼 x
  const eyN = cy + hr * 0.10, eyF = cy + hr * 0.14;   // 近/远眼 y(远眼略低)
  const mx = cx + hr * 0.17, my = cy + hr * 0.34;     // 嘴基点(偏网侧)
  g.fillColor = pal(FACE);
  g.strokeColor = pal(FACE);

  switch (face) {
    case "fierce": {
      // 斜怒眉(内端压向鼻梁)+ 紧咬直线嘴 + 圆点眼
      g.lineWidth = f.lw(1.5);
      lineSeg(g, f, exN + 2.0, eyN - 4.8, exN - 1.8, eyN - 2.6);
      lineSeg(g, f, exF + 1.7, eyF - 3.0, exF - 1.7, eyF - 4.8);
      lineSeg(g, f, mx - 1.5, my + 0.2, mx + 4.5, my - 0.4);
      g.stroke();
      dotEyes(g, f, exN, eyN, exF, eyF, lx, ly);
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
        g.fillColor = pal(FACE);
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
        dotEyes(g, f, exN, eyN, exF, eyF, lx, ly);
      }
      g.lineWidth = f.lw(1.3);
      lineSeg(g, f, mx - 0.5, my, mx + 3.8, my + 0.4);
      g.stroke();
      break;
    }
  }

  drawFaceSticker(g, f, opt.t ?? 0, face, opt.faceT ?? 0, opt.faceD ?? 1, cx, cy, hr);
}

// ---------- 设计款发型与头饰零件(全部局部坐标,角度沿用 canvas y 向下约定:
// π..2π = 头顶上半圆,+x = 朝球网侧。「填充+描边」必须重建路径再 stroke) ----------

// 发型总入口:spiky 刺猬 / mohawk 莫霍克 / bun 发髻 / twin 双马尾(后两者叠在基础发盖上)
function drawHair(g: Graphics, f: Frame, style: NonNullable<SkinDef["hairStyle"]>, color: string,
  hr: number, cx: number, cy: number): void {
  const fillStroke = (pts: Pt[], lw: number): void => {
    g.fillColor = pal(color);
    polyPath(g, pts, true);
    g.fill();
    g.strokeColor = pal(HAIR_LINE);
    g.lineWidth = f.lw(lw);
    polyPath(g, pts, true);
    g.stroke();
  };
  if (style === "spiky") {
    // 刺猬头:沿头顶轮廓向外扎 7 根尖刺(长短错落),根部埋进头圆
    const N = 7, a0 = Math.PI * 1.06, a1 = Math.PI * 1.94;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + ((a1 - a0) * i) / N;
      pts.push(f.pt(cx + Math.cos(a) * hr * 1.02, cy + Math.sin(a) * hr * 1.02));
      if (i < N) {
        const am = a + (a1 - a0) / N / 2;
        const spike = hr * (1.3 + 0.09 * Math.sin(i * 2.7));
        pts.push(f.pt(cx + Math.cos(am) * spike, cy + Math.sin(am) * spike));
      }
    }
    fillStroke(pts, 1.0);
  } else if (style === "mohawk") {
    // 莫霍克:头顶正中一排高耸窄刺,从后脑排到额前
    const N = 5, a0 = Math.PI * 1.22, a1 = Math.PI * 1.78;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + ((a1 - a0) * i) / N;
      pts.push(f.pt(cx + Math.cos(a) * hr * 0.98, cy + Math.sin(a) * hr * 0.98));
      if (i < N) {
        const am = a + (a1 - a0) / N / 2;
        pts.push(f.pt(cx + Math.cos(am) * hr * 1.52, cy + Math.sin(am) * hr * 1.52));
      }
    }
    fillStroke(pts, 1.0);
  } else {
    // 基础发盖:外缘贴头圆外一圈、内缘压到额头上方的新月形
    const outer = arcPts(f, cx, cy, hr * 1.06, Math.PI * 1.0, Math.PI * 2.0, false);
    const inner = arcPts(f, cx, cy, hr * 0.66, Math.PI * 1.94, Math.PI * 1.06, true);
    fillStroke(outer.concat(inner), 1.0);
    if (style === "bun") {
      // 发髻:头顶后侧一枚圆髻
      const bx = cx - hr * 0.62, by = cy - hr * 0.88;
      g.fillColor = pal(color);
      circleAA(g, f, bx, by, hr * 0.34);
      g.fill();
      g.strokeColor = pal(HAIR_LINE);
      g.lineWidth = f.lw(1.0);
      circleAA(g, f, bx, by, hr * 0.34);
      g.stroke();
    } else if (style === "twin") {
      // 双马尾:脑后两条垂落的束发,远侧先画、压暗一档读出前后
      hairTail(g, f, withAlpha(pal(color), 0.82), cx - hr * 0.9, cy - hr * 0.1, cx - hr * 1.18, cy + hr * 0.9, hr * 0.42);
      hairTail(g, f, pal(color), cx - hr * 0.66, cy - hr * 0.28, cx - hr * 0.95, cy + hr * 1.18, hr * 0.46);
    }
  }
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

// ---------- 表情五官零件(全部白色线条,由 drawHead 按种类取用) ----------

// 白点眼:normal/fierce 共用;瞳位随球偏移(look 已是局部单位向量 × 1.3)
function dotEyes(g: Graphics, f: Frame, exN: number, eyN: number, exF: number, eyF: number, lx: number, ly: number): void {
  g.fillColor = pal(FACE);
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
    const pts: Pt[] = [];
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

// 手臂折线:圆头描边;alpha 用于压暗远侧肢(canvas globalAlpha → 叠进颜色)
function arm(g: Graphics, f: Frame, color: string, pts: number[][], lw = 5.5, alpha = 1): void {
  g.strokeColor = withAlpha(pal(color), alpha);
  g.lineWidth = f.lw(lw);
  g.lineCap = LineCap.ROUND;
  g.lineJoin = LineJoin.ROUND;
  const p0 = f.pt(pts[0][0], pts[0][1]);
  g.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const q = f.pt(pts[i][0], pts[i][1]);
    g.lineTo(q.x, q.y);
  }
  g.stroke();
}

// 握拍的手:最后叠画在拍柄上,才是「拿着」而不是「粘着」
// r/alpha 给远侧手用(远侧更小更暗才读得出景深);默认值 = 原持拍手,那一路输出逐字节不变。
// 【注意】withAlpha 是「覆盖」alpha 而不是叠乘(palette.ts 里 new Color(r,g,b,k*255)),
// 而 SKIN_LINE 自带 0.55 —— 所以描边必须写 0.55 * alpha,直接套 alpha 会把持拍手变成黑边。
function drawHand(g: Graphics, f: Frame, hx: number, hy: number, r = 3.6, alpha = 1): void {
  g.fillColor = withAlpha(pal(SKIN), alpha);
  g.strokeColor = withAlpha(pal(SKIN_LINE), 0.55 * alpha);
  g.lineWidth = f.lw(1.2);
  circleAA(g, f, hx, hy, r);
  g.fill();
  g.stroke();
}

// 从手位 (hx,hy) 朝 ang 方向伸出的一支拍:柄 → 杆 → 框
// 颜色走 p.racketSkin(生涯系统挂上);frame 留空的皮肤跟随人物主题 glow
function drawRacket(g: Graphics, f: Frame, hx: number, hy: number, ang: number, len: number, th: Theme, p: Player): void {
  const rad = ang * D2R;
  const dx = Math.cos(rad), dy = -Math.sin(rad);
  const sk = p.racketSkin || RACKET_DEFAULT;
  const frame = sk.frame || th.glow;

  g.lineCap = LineCap.ROUND;
  g.strokeColor = pal(sk.grip || "#20242f");             // 拍柄
  g.lineWidth = f.lw(4.5);
  lineSeg(g, f, hx - dx * 2.5, hy - dy * 2.5, hx + dx * 4.5, hy + dy * 4.5);
  g.stroke();

  // 拍杆
  g.strokeColor = pal(sk.shaft || "#efe7d8");
  g.lineWidth = f.lw(2.4);
  lineSeg(g, f, hx + dx * 4.5, hy + dy * 4.5, hx + dx * len * 0.62, hy + dy * len * 0.62);
  g.stroke();

  // 拍框 + 拍面:老代码 translate 到拍头再 rotate;展开为旋转子帧
  const R = rotateFrame(f, hx + dx * len, hy + dy * len, -rad + Math.PI / 2);

  // 拍面底色与边框
  g.fillColor = withAlpha(pal("#ffffff"), 0.16);
  g.strokeColor = pal(frame);
  g.lineWidth = R.lw(2.5);
  const head = ellipsePts(R, 0, 0, 9, 11.5);
  polyPath(g, head, true);
  g.fill();
  g.stroke();

  // 完美命中瞬间:白金拍框 + 金青双色外晕,全游戏最强的一帧
  if (p.perfectGlow > 0) {
    const outer = ellipsePts(R, 0, 0, 12.5, 15.5);
    glowStroke(g, R, head, "#00f0ff", 3.6 + 8);          // 青色外晕(原 shadowBlur 14 近似)
    g.strokeColor = pal("#ffffff");
    g.lineWidth = R.lw(3.6);
    polyPath(g, head, true); g.stroke();
    glowStroke(g, R, outer, "#ffe14d", 2.2 + 7);         // 金色外晕(原 shadowBlur 10 近似)
    g.strokeColor = pal("#ffe14d");
    g.lineWidth = R.lw(2.2);
    polyPath(g, outer, true); g.stroke();
  } else if (p.smashGlow > 0) {
    glowStroke(g, R, head, "#ffe14d", 3.2 + 6);          // 原 shadowBlur 8 近似
    g.strokeColor = pal("#ffe14d");
    g.lineWidth = R.lw(3.2);
    polyPath(g, head, true); g.stroke();
  } else if (p.sweetGlow > 0) {
    // 甜蜜点命中瞬间: 璀璨白金与电光外光晕
    glowStroke(g, R, head, "#00f0ff", 3.0 + 7);          // 原 shadowBlur 10 近似
    g.strokeColor = pal("#ffffff");
    g.lineWidth = R.lw(3.0);
    polyPath(g, head, true); g.stroke();
  }

  // 拍头命中闪光:contactFlash > 0 时在拍头画径向渐变亮斑,提供更精确的命中确认
  if (p.contactFlash > 0) {
    const flashAlpha = (p.contactFlash / 8) * (C.fx.racketFlashAlpha || 0.8);
    const flashR = C.fx.racketFlashRadius || 16;
    // 【移植限制】径向渐变无对应 API:由外向内叠 4 层同心圆近似(越靠内越亮)
    const BANDS = 4;
    for (let i = BANDS; i >= 1; i--) {
      const k = i / BANDS;
      g.fillColor = withAlpha(pal("#ffffff"), flashAlpha * (1 - k));
      polyPath(g, ellipsePts(R, 0, 0, flashR * k, flashR * k), true);
      g.fill();
    }
  }

  // 拍面网线(设计款可自定义拍线色,如星辉拍的金线)
  const strColor = sk.stringColor || "#ffffff";
  g.strokeColor = withAlpha(pal(strColor), sk.stringColor ? 0.6 : 0.35);
  g.lineWidth = R.lw(0.8);
  for (let i = -2; i <= 2; i++) lineSeg(g, R, i * 3, -10, i * 3, 10);
  for (let i = -3; i <= 3; i++) lineSeg(g, R, -8, i * 3, 8, i * 3);
  g.stroke();

  // 拍框贴章(设计款):压在网线上,拍面下缘正中的小徽记
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

export function drawShuttle(g: Graphics, vp: Viewport, b: Ball, skin: SkinDef | null): void {
  const bb = b as RBall;
  const sk = {
    cap: skin?.cap ?? SHUTTLE_DEFAULT.cap,
    band: skin?.band ?? SHUTTLE_DEFAULT.band,
    skirt: skin?.skirt ?? SHUTTLE_DEFAULT.skirt,
    vein: skin?.vein ?? SHUTTLE_DEFAULT.vein,
  };
  const bx = bb.rx ?? b.x, by = bb.ry ?? b.y;
  const sp = Math.hypot(b.vx, b.vy);
  // 球头朝运动方向;静止时朝下
  const ang = sp > 0.35 ? Math.atan2(b.vy, b.vx) : Math.PI / 2;
  // 球体形变:击球瞬间沿飞行方向压扁,体积守恒(垂直方向膨胀)
  const sq = bb.sqR ?? b.sq ?? 1;
  const sqX = sq;                    // 沿飞行方向压缩
  const sqY = 1 / Math.sqrt(Math.max(0.4, sq));  // 垂直方向膨胀,保持视觉体积
  const S = shuttleFrame(vp, bx, by, ang, sqX, sqY);

  g.lineCap = LineCap.ROUND;
  g.lineJoin = LineJoin.ROUND;

  // 球托(软木)
  g.fillColor = pal(sk.cap);
  polyPath(g, ellipsePts(S, 3, 0, 5.2, 5.2), true);
  g.fill();
  g.fillColor = pal(sk.band);
  polyPath(g, arcPts(S, 3, 0, 5.2, -1.05, 1.05, false), true);
  g.fill();
  // 球托高光(canvas fillRect(1.5,-3.6,1.6,2) 在旋转缩放帧里 → 四角变换)
  fillRectTr(g, S, 1.5, -3.6, 1.6, 2, withAlpha(pal("#ffffff"), 0.55));
  // 羽毛裙(朝后展开)
  g.fillColor = pal(sk.skirt);
  polyPath(g, [
    S.pt(-1, -3.4), S.pt(-14, -8.6), S.pt(-16, 0), S.pt(-14, 8.6), S.pt(-1, 3.4),
  ], true);
  g.fill();
  g.strokeColor = pal(sk.vein);
  g.lineWidth = S.lw(0.9);
  for (let i = -2; i <= 2; i++) lineSeg(g, S, -1.5, i * 1.5, -15, i * 3.6);
  g.stroke();
  g.strokeColor = withAlpha(pal("#ffffff"), 0.9);
  g.lineWidth = S.lw(1.2);
  polyPath(g, arcPts(S, -13.5, 0, 8.8, -0.95, 0.95, false), false);
  g.stroke();
}
