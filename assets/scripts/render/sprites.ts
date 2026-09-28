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
import { Player, Ball, SkinDef, SwingStyle, Theme } from "../core/types";
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
  const k = Math.sqrt(Math.abs(facing * sx * sy));
  return {
    pt: (lx, ly) => ({ x: vp.x(wx + facing * sx * lx), y: vp.y(wy + sy * ly) }),
    lw: (v) => v * k,
    kx: sx,
    ky: sy,
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
  const k = Math.sqrt(Math.abs(sqX * sqY));
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

/** 轴对齐帧里的整椭圆:圆心经变换、半径按各向异性缩放(cc 的 ellipse 参数就是半径)。只可在未旋转帧用 */
function ellipseAA(g: Graphics, f: Frame, cx: number, cy: number, rx: number, ry: number): void {
  const c = f.pt(cx, cy);
  g.ellipse(c.x, c.y, rx * f.kx, ry * f.ky);
}

function circleAA(g: Graphics, f: Frame, cx: number, cy: number, r: number): void {
  ellipseAA(g, f, cx, cy, r, r);
}

/** 折线路径(隐式起笔画);closed 时补 close() */
function polyPath(g: Graphics, pts: Pt[], closed: boolean): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (closed) g.close();
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
  g.fillColor = color;
  g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  g.fill();
}

/** 老代码的 px():半像素对齐的实心矩形(减少亚像素抖动);取整在局部坐标里做,与原版一致 */
function px(g: Graphics, f: Frame, lx: number, ly: number, w: number, h: number, color: string): void {
  const x0 = Math.round(lx * 2) / 2, y0 = Math.round(ly * 2) / 2;
  fillRectTr(g, f, x0, y0, Math.ceil(w), Math.ceil(h), pal(color));
}

// 头部固定配色:皮肤与手同色;头发/描边沿用球鞋的深色调,队色只上发带
const SKIN = "#f2c491", SKIN_LINE = "rgba(10,13,24,0.55)";
const HAIR = "#382718", INK = "rgba(8,10,20,0.85)", EYE = "#1b1f2e";

// 皮肤默认值(与 config.skins 对应项同色):没装备皮肤或旧调用方没传时兜回原配色,
// 皮肤只换颜色不改形状,判定半径与手感完全不受影响
const RACKET_DEFAULT = { grip: "#20242f", shaft: "#efe7d8", frame: null as string | null };
const SHUTTLE_DEFAULT = { cap: "#f6f1e6", band: "#ff4d4d", skirt: "#fbfaf5", vein: "rgba(120,130,150,0.65)" };

// 主题兜底:老工程 applyToMatch 保证必有主题;类型上可选,这里兜成红方默认队色(未装备皮肤时本来就是它)
const DEFAULT_THEME: Theme = {
  main: C.colors.red.main, dark: C.colors.red.dark, glow: C.colors.red.glow, name: C.colors.red.name,
};

// 待机持拍姿势(肩坐标系):屈肘把拍收在体前,拍头朝上举在胸侧。
// 起拍/收拍都在它和挥拍弧线之间插值,替代原先两套硬编码坐标之间的瞬跳
const IDLE_POSE: Pose = { pts: [[0, -2], [9, 10]], hand: [20, 22], ang: 68, len: 25 };

interface Pose {
  pts: number[][];
  hand: number[];
  ang: number;
  len: number;
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

/** 挥拍弧光残影数据:老代码由 sprites 直接推 FX.addSwingArc,移植版经 sink 交还表现层 */
export interface SwingArcFx {
  x: number; y: number;
  fromAng: number; ang: number;
  reach: number;
  color: string;
  isSweet: boolean;
}

let swingArcSink: ((fx: SwingArcFx) => void) | null = null;

/** 表现层接线:把挥拍弧光残影送到衰减渲染(对应老 fx.js 的 addSwingArc);不接则只画当帧弧光 */
export function setSwingArcSink(sink: ((fx: SwingArcFx) => void) | null): void {
  swingArcSink = sink;
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
  const H = C.player.h, W = C.player.w;

  // 圆头笔画贯穿全身(老 canvas 里首个 arm() 设完就随状态泄漏到后续笔画,闭合路径上无视觉差)
  g.lineCap = LineCap.ROUND;
  g.lineJoin = LineJoin.ROUND;

  // 影子
  const air = clamp((CO.groundY - y) / 140, 0, 1);
  g.fillColor = withAlpha("#000000", 0.38 - air * 0.22);
  g.ellipse(vp.x(x), vp.y(CO.groundY + 3), W * 0.62 * (1 - air * 0.3), 5 * (1 - air * 0.35));
  g.fill();

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
  const airborne = !p.onGround;
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

  const bob = airborne ? Math.sin(t * 0.05) * 0.7
    : lerp(Math.sin(t * 0.05) * 0.7, Math.abs(cycRaw) * (1.2 + 1.2 * spN), runAmt);

  // ---------- 躯干倾斜量:基础前倾 + 随速度俯身 + 挥拍拧转(引拍后仰→发力前压) ----------
  const leanTbl = p.swingStyle === "over"
    ? [[0, -1.2], [0.12, -3], [0.4, 2.8], [1, 0.6]]
    : [[0, 0.8], [0.12, 1.8], [0.4, -2], [1, -0.4]];
  const lean = 2
    + (p.vx * p.facing / C.player.vmax) * 2.5
    + (swinging ? lut(leanTbl, poseU) : p.recoverT > 0 ? lut(leanTbl, 1) * (1 - recK) : 0)
    + (p.hitRecoil || 0) * p.facing * 0.5   // 击球身体后仰:命中瞬间短暂后仰
    + lungeLean * lungeDirRel               // 跨步救球:身体沿跨步方向大幅倾斜
    + emotionLean;                            // CPU 情绪:庆祝后仰/沮丧前倾

  // ---------- 远臂:画在躯干后层的远侧手臂(景深),垂在体侧偏后 ----------
  const fsy = SW.pivotY + bob + 2;
  let fhx = -25, fhy = fsy + 24;                        // 手探出躯干背缘,露出一截才读作手臂
  fhx += -cycRaw * 5 * runAmt;                          // 跑动时与前腿反相摆(权重渐变)
  if (airborne) fhx -= 3;
  if (swinging && sp) fhx += -Math.cos(sp.ang * D2R) * 6;   // 挥拍时反向后拉,平衡臂
  if (lunging) fhx -= lungeLegExt * 10 * lungeDirRel;   // 跨步时远臂伸出平衡
  if (celebrating) { fhx -= 8; fhy -= 18 * Math.sin(celebrateU * Math.PI); }  // 庆祝:远臂上举
  if (frustrated) { fhy += 5 * Math.sin(frustrateU * Math.PI); }              // 沮丧:远臂下垂
  arm(g, F, th.dark, [[-4, fsy], [-17, fsy + 13], [fhx, fhy]], 5, 0.7);

  // ---------- 腿:跑姿(幅度随速度)与空中姿势(升收腿/落展腿)按权重混合 ----------
  const hipY = -H * 0.34 + bob;
  const thigh = H * 0.19, shin = H * 0.09;
  // 后腿(远侧)整体压暗,前腿(近侧)受光 —— 前后景深一眼读出侧身
  const legs = [
    { bx: -W * 0.14, sock: "#cdc9bd", shoe: "#141824", s: -1 },
    { bx: W * 0.10, sock: "#f2efe6", shoe: "#1b1f2e", s: 1 },
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
    px(g, F, L.bx + dx - W * 0.12, hipY, W * 0.24, thigh - lift, th.dark);                        // 短裤/大腿
    px(g, F, L.bx + dx - W * 0.10, hipY + thigh - lift, W * 0.20, shin, L.sock);                  // 小腿袜
    px(g, F, L.bx + dx - W * 0.15, hipY + thigh + shin - 1 - lift, W * 0.30, H * 0.07, L.shoe);   // 鞋
  }

  // ---------- 躯干:3/4 斜侧 —— 向网侧偏置 + 上段前倾 + 前亮后暗 ----------
  const bodyTop = -H * 0.72 + bob;
  const bodyH = H * 0.38;
  const tw = W * 0.66, tx = -W * 0.40;
  px(g, F, tx, bodyTop + bodyH * 0.42, tw, bodyH * 0.58, th.main);                    // 下段(髋)
  px(g, F, tx + lean, bodyTop, tw, bodyH * 0.5, th.main);                             // 上段(肩,前倾)
  px(g, F, tx + lean + tw - 3, bodyTop + 5, 3, bodyH * 0.5 - 9, "rgba(255,255,255,0.20)");   // 前缘受光
  px(g, F, tx + tw - 3, bodyTop + bodyH * 0.42 + 5, 3, bodyH * 0.58 - 9, "rgba(255,255,255,0.12)");
  px(g, F, tx + lean, bodyTop + 5, 3, bodyH * 0.42 - 4, "rgba(0,0,0,0.20)");          // 背缘背光
  px(g, F, tx, bodyTop + bodyH * 0.42 + 5, 3, bodyH * 0.58 - 5, "rgba(0,0,0,0.24)");
  // 领口从脖子前沿往网侧延伸:若拖到脖子后面,会在颈后留一块没归属的深色补丁
  px(g, F, 2, bodyTop, tx + lean + tw - 2, 5, th.dark);
  px(g, F, tx + tw * 0.25, bodyTop + bodyH - 4, tw * 0.75, 4, "rgba(255,255,255,0.20)");
  // 号码:还在胸前,但随视角偏向网侧。
  // 【移植限制】canvas fillText 无法用 Graphics 复刻:老版以 700 H*0.115px "DIN Alternate"
  // 居中画 p.jersey 于局部 (1, bodyTop + bodyH*0.40),色 rgba(255,255,255,0.8)。
  // 需要时由表现层把局部点 F.pt(1, bodyTop + bodyH*0.40) 转成节点坐标挂 Label。

  // ---------- 头(代码绘制的 3/4 卡通头) ----------
  // 头抬高到下巴不压肩:肩关节露在脖子下面,手臂才是从肩膀长出来的;
  // 颈子补在头和领口之间,避免下巴悬空。
  // 挥拍时头随动作俯仰(over 抬头盯球 / under 压头发力),位置随躯干拧转前移
  const headDy = swinging
    ? (p.swingStyle === "over" ? -1.6 : 1.2) * Math.sin(Math.min(poseU, 1) * Math.PI) : 0;
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
    { lookX, lookY, blink });

  // ---------- 持拍臂:一条姿势管线,挥拍弧线 ↔ 待机收拍全程连续 ----------
  const A = offsetFrame(F, 1.5 + (lean - 2) * 0.8, SW.pivotY + bob);   // 肩点在躯干上段内,随拧转前移
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
      const arcColor = isSweet ? "#ffffff" : p.contactFlash > 0 ? "#ffffff" : C.colors.accent;
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
      g.strokeColor = withAlpha(pal(arcColor), mainA);
      g.lineWidth = A.lw(arcW);
      polyPath(g, arc, false);
      g.stroke();
      // 挥拍弧光残影:老代码推入 FX 数组由 fx.js 衰减渲染;移植版经 sink 交还表现层
      const shoulderX = x + p.facing * (1.5 + (lean - 2) * 0.8);
      const shoulderY = y + SW.pivotY + bob;
      if (swingArcSink) {
        swingArcSink({
          x: shoulderX, y: shoulderY,
          fromAng: prevAng ?? pose.ang, ang: pose.ang,
          reach: sp.reach, color: C.colors.accent, isSweet,
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
    pose = IDLE_POSE;                    // 待机:屈肘把拍收在体前
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
  drawPlayerTag(g, vp, p, x, y, t);
}

// ---------- 角色头顶名牌: 区分 YOU / P1 / P2 / 搭档 / CPU ----------
// 【移植限制】canvas 的 measureText/fillText 无 Graphics 对应:胶囊与光标照画,
// 文字宽度按字数估算(半角≈6.4px / 全角≈9.5px @ 800 9.5px),文字本身交表现层 Label。
function drawPlayerTag(g: Graphics, vp: Viewport, p: Player, x: number, y: number, t: number): void {
  const label = p.label || (p.isAI ? "CPU" : "YOU");
  const isMainUser = (!p.isAI && (label === "你" || label === "P1" || label === "YOU"));
  const isPartner = label === "搭档";
  const isP2 = label === "P2";

  const tagY = y - C.player.h - 18;

  // 1. 操控玩家专属悬浮倒三角光标 ▼ (上下轻微律动)
  if (isMainUser) {
    const bob = Math.sin((t || 0) * 0.14) * 2.2;
    const arrowY = tagY - 14 + bob;
    g.fillColor = pal(p.side === "left" ? "#ffe14d" : "#3ea8ff");
    polyPath(g, [
      { x: vp.x(x), y: vp.y(arrowY + 5) },
      { x: vp.x(x - 4.5), y: vp.y(arrowY) },
      { x: vp.x(x + 4.5), y: vp.y(arrowY) },
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

  // 深色胶囊底衬 (任何球场背景下均清晰醒目)
  g.fillColor = pal(isMainUser
    ? "rgba(10, 14, 28, 0.78)"
    : isPartner
    ? "rgba(10, 26, 34, 0.75)"
    : "rgba(12, 14, 22, 0.58)");
  // canvas 用四段 arcTo 圆角;胶囊半径恰为半高,roundRect 等价(y 翻转后取数学最小角)
  g.roundRect(vp.x(lx), vp.y(ly + ph), pw, ph, r);
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

// ---------- 头:后脑发圆 → 脸 → 远侧耳 → 刘海 → 队色发带 → 五官 → 轮廓 ----------
// 局部 +x = 朝球网:近侧眼大、远侧眼小,瞳位随 opt.look 追球,和斜侧身体同一个视角
function drawHead(g: Graphics, f: Frame, th: Theme, hr: number, cx: number, cy: number, opt: { lookX?: number; lookY?: number; blink?: boolean } = {}): void {
  const lx = opt.lookX || 0, ly = opt.lookY || 0;
  const fx = cx + 1.5, fy = cy + 2.5, fr = hr * 0.82;   // 脸圆;发圆略大偏后包住它

  // 后脑(发) + 脸
  g.fillColor = pal(HAIR);
  circleAA(g, f, cx - 1.5, cy - 1, hr);
  g.fill();
  g.fillColor = pal(SKIN);
  circleAA(g, f, fx, fy, fr);
  g.fill();
  g.strokeColor = pal(INK); g.lineWidth = f.lw(2); g.stroke();   // 同路径描边(脸圆)

  // 远侧耳朵(贴背缘,只露一只 = 侧身信号)
  g.fillColor = pal(SKIN); g.strokeColor = pal(SKIN_LINE); g.lineWidth = f.lw(1.2);
  circleAA(g, f, fx - fr * 0.62, fy + 2, 3.4);
  g.fill(); g.stroke();

  // 刘海:盖住上半张脸的发帘,三个发圆 scallop 出弧形分缝,偏向网侧
  g.fillColor = pal(HAIR);
  polyPath(g, arcPts(f, fx, fy, fr + 0.8, Math.PI, 0, false), true);
  g.fill();
  const scallops: number[][] = [[fr * 0.52, -fr * 0.22, fr * 0.30], [-fr * 0.05, -fr * 0.10, fr * 0.32], [-fr * 0.52, -fr * 0.28, fr * 0.26]];
  for (const [bx, by, br] of scallops) {
    circleAA(g, f, fx + bx, fy + by, br);
    g.fill();
  }

  // 队色发带:接替旧头像圆环的红蓝识别,压在发帘和额头交界
  g.strokeColor = pal(th.main); g.lineWidth = f.lw(4);
  polyPath(g, arcPts(f, fx, fy, fr * 0.94, Math.PI * 1.18, Math.PI * 1.86, false), false);
  g.stroke();

  // 发丝高光
  g.strokeColor = withAlpha(pal("#ffffff"), 0.12); g.lineWidth = f.lw(2.5);
  polyPath(g, arcPts(f, cx - 1.5, cy - 1, hr * 0.72, Math.PI * 1.15, Math.PI * 1.5, false), false);
  g.stroke();

  // 双眼:网侧大、背侧小(3/4 透视);瞳位随球偏移;眨眼时收成两条短横线
  if (opt.blink) {
    g.strokeColor = pal(EYE); g.lineWidth = f.lw(1.4);
    lineSeg(g, f, fx + fr * 0.40 - 1.8 + lx, fy + 1.5, fx + fr * 0.40 + 1.8 + lx, fy + 1.5);
    lineSeg(g, f, fx - fr * 0.28 - 1.3 + lx * 0.7, fy + 2, fx - fr * 0.28 + 1.3 + lx * 0.7, fy + 2);
    g.stroke();
  } else {
    g.fillColor = pal(EYE);
    ellipseAA(g, f, fx + fr * 0.40 + lx, fy + 1.5 + ly, 1.9, 2.7); g.fill();
    ellipseAA(g, f, fx - fr * 0.28 + lx * 0.7, fy + 2 + ly, 1.4, 2.2); g.fill();
    g.fillColor = pal("rgba(255,255,255,0.85)");
    circleAA(g, f, fx + fr * 0.40 + lx - 0.5, fy - 0.2 + ly, 0.7); g.fill();
    circleAA(g, f, fx - fr * 0.28 + lx * 0.7 - 0.4, fy + 0.4 + ly, 0.6); g.fill();
  }

  // 腮红 + 微笑
  g.fillColor = pal("rgba(235,120,100,0.35)");
  ellipseAA(g, f, fx + fr * 0.52, fy + 6.5, 2.6, 1.5);
  g.fill();
  g.strokeColor = pal("#b06548"); g.lineWidth = f.lw(1.3);
  polyPath(g, arcPts(f, fx + 2, fy + 5.5, 2.8, Math.PI * 0.15, Math.PI * 0.85, false), false);
  g.stroke();

  // 外轮廓最后勾,把发圆的边缘收干净
  g.strokeColor = pal(INK); g.lineWidth = f.lw(2);
  circleAA(g, f, cx - 1.5, cy - 1, hr);
  g.stroke();
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
function drawHand(g: Graphics, f: Frame, hx: number, hy: number): void {
  g.fillColor = pal(SKIN);
  g.strokeColor = pal(SKIN_LINE);
  g.lineWidth = f.lw(1.2);
  circleAA(g, f, hx, hy, 3.6);
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
  g.strokeColor = pal(sk.grip || RACKET_DEFAULT.grip);   // 拍柄
  g.lineWidth = f.lw(4.5);
  lineSeg(g, f, hx - dx * 2.5, hy - dy * 2.5, hx + dx * 4.5, hy + dy * 4.5);
  g.stroke();

  // 拍杆
  g.strokeColor = pal(sk.shaft || RACKET_DEFAULT.shaft);
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

  // 拍面网线
  g.strokeColor = withAlpha(pal("#ffffff"), 0.35);
  g.lineWidth = R.lw(0.8);
  for (let i = -2; i <= 2; i++) lineSeg(g, R, i * 3, -10, i * 3, 10);
  for (let i = -3; i <= 3; i++) lineSeg(g, R, -8, i * 3, 8, i * 3);
  g.stroke();
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
