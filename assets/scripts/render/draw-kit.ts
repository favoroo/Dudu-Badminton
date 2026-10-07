// ============================================================
// 笔画助手帧池:局部坐标帧(Frame)与 canvas → cc.Graphics 的采样/描边原语。
//
// 为什么单独成文件:这套「帧 + 采样池 + 折线原语」原来是 sprites.ts 的模块私有件,
// 而配饰(render/acc.ts)要在 drawPlayer/drawHead 的**同一把变换尺**下画(挂载点跟随
// facing 镜像/挤压/视口缩放),抄一份就是 AGENTS.md 说的「第二把尺子」。所以整包搬来,
// sprites 与 acc 共同 import;渲染层其他模块不许再私拷这几个函数。
//
// canvas → cc.Graphics 的移植约定(原 sprites.ts 文件头,随代码一起搬来):
//  * 老代码的 save/translate/rotate/scale 变换栈展开为「帧」对象(Frame):
//    局部点在 canvas 约定(y 向下)里算好,经 frame.pt 映射到 Graphics(y 向上);
//  * cc.Graphics.arc 的扫向与 canvas 相反、也没有带旋转的椭圆弧 ——
//    部分圆弧一律在局部坐标里按 canvas 语义采样成折线;整圆/整椭圆在未旋转的
//    轴对齐帧里走 g.ellipse(精确),在旋转帧里同样采样;
//  * canvas globalAlpha → withAlpha 叠进颜色。
// ============================================================
import { Color, Graphics } from "cc";
import { TAU } from "../core/utils";
import { pal, withAlpha } from "./palette";
import { Pt2 } from "./rig";

const LineCap = Graphics.LineCap;
const LineJoin = Graphics.LineJoin;

/** 世界坐标(canvas,y 向下,960×540)→ Graphics 本地坐标(居中原点,y 向上)。
 *  与 world.ts 的同名接口结构一致;此处独立声明避免 render 模块互相成环。 */
export interface Viewport {
  x(wx: number): number;
  y(wy: number): number;
}

// ---------- 局部坐标帧:替代 ctx.save/translate/rotate/scale ----------

export interface Pt { x: number; y: number }

/**
 * 一个绘制帧:局部点 (lx, ly)(canvas 约定,y 向下)→ Graphics 坐标。
 * kx/ky 是局部 x/y 轴的长度缩放(未旋转帧才有意义,旋转帧置 0 以禁用 ellipseAA)。
 */
export interface Frame {
  pt(lx: number, ly: number): Pt;
  /** 线宽折算:canvas 的 CTM 会缩放描边,这里按 sqrt(|det|) 做几何平均近似 */
  lw(v: number): number;
  kx: number;
  ky: number;
}

/** 人物帧:老代码 translate(x,y) + scale(facing*sx, sy) 的等价展开 */
export function playerFrame(vp: Viewport, wx: number, wy: number, facing: number, sx: number, sy: number): Frame {
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
export function offsetFrame(parent: Frame, ox: number, oy: number): Frame {
  return {
    pt: (lx, ly) => parent.pt(ox + lx, oy + ly),
    lw: (v) => parent.lw(v),
    kx: parent.kx,
    ky: parent.ky,
  };
}

/** 缩放子帧:以锚点为原点缩放局部单位(表情贴纸的 pop-in 弹出用) */
export function scaledFrame(parent: Frame, ox: number, oy: number, s: number): Frame {
  return {
    pt: (lx, ly) => parent.pt(ox + lx * s, oy + ly * s),
    lw: (v) => parent.lw(v * s),
    kx: parent.kx,
    ky: parent.ky,
  };
}

/** 旋转子帧:老代码 translate(ox,oy) + rotate(rot) 的等价展开(canvas 旋转矩阵,坐标系 y 向下) */
export function rotateFrame(parent: Frame, ox: number, oy: number, rot: number): Frame {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return {
    pt: (lx, ly) => parent.pt(ox + lx * cos - ly * sin, oy + lx * sin + ly * cos),
    lw: (v) => parent.lw(v),
    kx: 0, ky: 0, // 旋转帧不轴对齐,禁用 ellipseAA/circleAA(一律采样)
  };
}

/** 羽毛球帧:老代码 translate(bx,by) + rotate(ang) + scale(sqX,sqY) 的等价展开(先缩放再旋转再平移) */
export function shuttleFrame(vp: Viewport, wx: number, wy: number, ang: number, sqX: number, sqY: number): Frame {
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

/** 取下一个复用点(调用方立即写 x/y);散装自建帧(如弧光残影)也要过池,保持导出 */
export function pooledPt(): Pt {
  const p = ptPool[ptHead];
  ptHead = (ptHead + 1) % PT_POOL_N;
  return p;
}

/** 取一条复用折线(长度清零,调用方 push) */
export function pooledPts(): Pt[] {
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
export const CIRCLE_SEGS = 20;

/** 整圈采样段数随半径自适应:大轮廓(r≥12)维持 CIRCLE_SEGS 不变,小件按比例减段 ——
 *  眼睛 2px、嘴巴 3px 这些也照拿 20 段是被顶点重传放大的浪费。下限 8 段
 *  (8 段在 r=8 时弦降 ~0.77px,仍不可辨);拍框高光弧等按索引映射角度的调用
 *  仍直接用 CIRCLE_SEGS,不经过这里,免得点数与角度错位。 */
function segsFor(r: number): number {
  const ar = r < 0 ? -r : r;
  if (ar >= 12) return CIRCLE_SEGS;
  const s = Math.ceil(ar * 1.4) + 4;
  return s < 8 ? 8 : s;
}

/** 局部圆弧按 canvas 语义采样成折线(角度在局部 canvas 约定里解释,方向视觉与原版一致) */
export function arcPts(f: Frame, cx: number, cy: number, r: number, a0: number, a1: number, ccw: boolean): Pt[] {
  const d = sweepDelta(a0, a1, ccw);
  const steps = Math.max(2, Math.ceil((Math.abs(d) / TAU) * segsFor(r)));
  const pts = pooledPts();
  for (let i = 0; i <= steps; i++) {
    const th = a0 + (d * i) / steps;
    pts.push(f.pt(cx + r * Math.cos(th), cy + r * Math.sin(th)));
  }
  return pts;
}

/** 一般椭圆参数采样(带旋转/非均匀缩放的椭圆 cc ellipse 画不了,统一折线) */
export function ellipsePts(f: Frame, cx: number, cy: number, rx: number, ry: number): Pt[] {
  const segs = segsFor(rx > ry ? rx : ry);
  const pts = pooledPts();
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * TAU;
    pts.push(f.pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)));
  }
  return pts;
}

/** 折线路径(隐式起笔画);closed 时补 close() */
export function polyPath(g: Graphics, pts: Pt[], closed: boolean): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (closed) g.close();
}

/** 椭圆采样为折线路径:经由 f.pt 变换,与 arcPts / fillRectTr 完全一致,彻底规避 Viewport 缩放/镜像导致比例失调 */
export function ellipseAA(g: Graphics, f: Frame, cx: number, cy: number, rx: number, ry: number): void {
  const pts = ellipsePts(f, cx, cy, rx, ry);
  polyPath(g, pts, true);
}

export function circleAA(g: Graphics, f: Frame, cx: number, cy: number, r: number): void {
  ellipseAA(g, f, cx, cy, r, r);
}

/** 局部线段(不 stroke,由调用方攒路径后一次性 stroke,与 canvas 同构) */
export function lineSeg(g: Graphics, f: Frame, x0: number, y0: number, x1: number, y1: number): void {
  const a = f.pt(x0, y0), b = f.pt(x1, y1);
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
}

/** 变换帧里的实心矩形:canvas fillRect 向 +x/+y 延伸,经镜像/翻转后归一成数学最小角 */
export function fillRectTr(g: Graphics, f: Frame, lx: number, ly: number, w: number, h: number, color: Color): void {
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
export function px(g: Graphics, f: Frame, lx: number, ly: number, w: number, h: number, color: string | Color): void {
  const x0 = Math.round(lx * 2) / 2, y0 = Math.round(ly * 2) / 2;
  fillRectTr(g, f, x0, y0, Math.ceil(w), Math.ceil(h), typeof color === "string" ? pal(color) : color);
}

/** 手臂/腿折线:圆头描边;alpha 用于压暗远侧肢(canvas globalAlpha → 叠进颜色) */
export function arm(g: Graphics, f: Frame, color: string, pts: Pt2[], lw = 5.5, alpha = 1): void {
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
