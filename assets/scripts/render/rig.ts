// ============================================================
// 角色骨架数学:两段肢体的 IK/FK 与姿势插值 —— 纯数学,零 cc 依赖,
// tools/pose-preview 与本工程回归脚本可以在 node 里直接消费(与 core/ 同样的可测性)。
//
// 为什么持拍臂改成「手位 + 弯折角」而不是旧的「肘点坐标」:旧 Pose 把肘写成
// 硬点,两段长度随姿势漂移、弯折角忽大忽小;改成 IK 反解之后**两段恒等长**
// (与远臂同一条不变量),弯折量由显式曲线控制 —— 挥拍「引打卡肘、击球伸直、
// 随挥回收」的节奏可以逐帧编排,而手位仍然钉死在判定弧上(判定=视觉铁律不破)。
//
// 姿势插值在「手位/弯折/拍角/拍长」四个标量上做 lerp:角度不绕圈(farFK 的
// 角度式插值已验证的结论推广到全身),任意两个姿势之间的过渡天然平滑。
//
// 腿部走「脚位目标 + IK 反解膝」:站立/屈膝/跨步的膝弯不再靠水平偏移量伪装,
// 髋一沉膝就弯(接地约束),深跨步的下肢剪裁是几何解而不是数值凑。
// ============================================================
import { lerp, clamp, D2R } from "../core/utils";

export interface Pt2 { x: number; y: number }

/** 持拍臂姿势(肩局部坐标系,canvas 约定 y 向下、+x 朝网):
 *  hand=手位(=拍柄握点);bend=肘弯折角(度,0=伸直,越大越弯);
 *  ang/len=拍的极坐标,与 Physics.swingPose.ang 同语义(判定=视觉)。 */
export interface Pose {
  hand: Pt2;
  bend: number;
  ang: number;
  len: number;
}

/** 弯折上限:超过它前臂折回上臂(防御性钳制,正常姿势远用不到) */
export const BEND_MAX = 118;

/** 两段等长臂 IK:手位 + 弯折角 → 肘位与段长。
 *  肘恒落在肩→手方向的 (-uy, ux) 一侧 —— 手在前下时肘垂在后下、手举过头时
 *  肘在外上(投掷预备的卡肘)、手抬到肩前时肘沉在下方,与全部既有姿势同侧。 */
export function armIK(hand: Pt2, bend: number): { elbow: Pt2; seg: number } {
  const d = Math.hypot(hand.x, hand.y) || 1e-4;
  const b = clamp(bend, 0, BEND_MAX) * D2R;
  const seg = d / (2 * Math.cos(b / 2));
  const h = (d / 2) * Math.tan(b / 2);
  const ux = hand.x / d, uy = hand.y / d;
  return { elbow: { x: hand.x / 2 - uy * h, y: hand.y / 2 + ux * h }, seg };
}

/** 两段等长臂的 FK(远臂专用:远臂由「上臂角+前臂角」驱动,角度插值不绕圈)。
 *  ea=上臂角,ef=前臂角(度,0=朝网,正=向上,与 Pose.ang 同语义)。 */
export function farFK(ea: number, ef: number, ua: number, fa: number): { pts: Pt2[]; hand: Pt2 } {
  const r1 = ea * D2R, r2 = ef * D2R;
  const ex = Math.cos(r1) * ua, ey = -Math.sin(r1) * ua;
  return {
    pts: [{ x: 0, y: 0 }, { x: ex, y: ey }],
    hand: { x: ex + Math.cos(r2) * fa, y: ey - Math.sin(r2) * fa },
  };
}

/** 两段腿 IK:髋、踝目标 → 膝位。膝恒折向 +x(朝网):人腿只能向后弯,
 *  侧视里膝在髋-踝连线的网侧 —— 深蹲、跑动摆腿、跨步全部成立。
 *  踝目标超出腿长时夹到全伸(跨步后腿蹬直的几何来源)。 */
export function legIK(hip: Pt2, foot: Pt2, l1: number, l2: number): Pt2 {
  let dx = foot.x - hip.x, dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 0.01;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  if (d < 1e-4) return { x: hip.x, y: hip.y - l1 };
  const cosA = Math.max(-1, Math.min(1, (d * d + l1 * l1 - l2 * l2) / (2 * d * l1)));
  const a1 = Math.acos(cosA);
  const base = Math.atan2(dy, dx);
  const k = base - a1;
  return { x: hip.x + Math.cos(k) * l1, y: hip.y + Math.sin(k) * l1 };
}

/** 两姿势插值:手/弯折/拍角/拍长四个标量同时过渡,臂不会中途脱节 */
export function poseLerp(a: Pose, b: Pose, k: number): Pose {
  return {
    hand: { x: lerp(a.hand.x, b.hand.x, k), y: lerp(a.hand.y, b.hand.y, k) },
    bend: lerp(a.bend, b.bend, k),
    ang: lerp(a.ang, b.ang, k),
    len: lerp(a.len, b.len, k),
  };
}

/** 分段线性查表:小型关键帧曲线(挥拍弯折节奏/躯干拧转共用) */
export function lut(tbl: number[][], x: number): number {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (x <= tbl[i][0]) {
      return lerp(tbl[i - 1][1], tbl[i][1], (x - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0]));
    }
  }
  return tbl[tbl.length - 1][1];
}
