// ============================================================
// 姿势库与动作剪辑:全部纯函数 —— 参数是显式数值,不读 Player/ball,
// sprites.ts 负责把实体信号算成这些参数。改姿势/改动作节奏只动这个文件,
// 出图验收走 tools/pose-preview(几何断言 + 肉眼比对)。
//
// 剪辑分层(优先级从高到低,由 sprites.ts 依序混入):
//   挥拍(判定弧线驱动) > 收拍回摆 > 发球等待/来球架拍 > 情绪(庆祝/沮丧)
//   > 跑动携拍/待机呼吸 —— 同一层内互斥,层间用 poseLerp 权重过渡。
// 腿部不是「姿势」而是「脚位目标」:站立/跑动/空中/跨步各自给出踝目标,
// 膝弯由 rig.legIK 几何反解(髋一沉膝就弯,接地约束天然成立)。
// ============================================================
import { CFG } from "../core/config";
import { SwingStyle } from "../core/types";
import { Physics } from "../core/physics";
import { lerp } from "../core/utils";
import { Pose, Pt2, poseLerp, lut } from "./rig";

const C = CFG;

// ---------- 具名姿势(肩局部坐标系:canvas y 向下,+x 朝网) ----------
// 肘位由 rig.armIK 反解:与旧硬点肘位差 ≤2px,两段恒等长。
// 遮挡约束沿用旧实测结论:手位 (16,-8) 在头部遮挡圆(肩局部 y≈-47~-8、x≤12)
// 右下方,不糊脸;SERVE_POSE 拍头前下悬在腿前,两头都不碰。

// 待机持拍:屈肘把拍收在体前,拍头朝上举在胸侧。近直臂(bend 6)= 放松持拍,
// 起拍/收拍都在它和挥拍弧线之间插值。
export const IDLE_POSE: Pose = { hand: { x: 20, y: 22 }, bend: 6, ang: 68, len: 25 };

// 来球预备架拍:肘沉到肩前下方、前臂上抬把手举到肩前上方,拍头斜指上前方。
export const READY_POSE: Pose = { hand: { x: 16, y: -8 }, bend: 96, ang: 64, len: 25 };

// 发球等待持拍:拍沉到体前腰高、拍头斜指前下 —— 正手发球预备。
// 与下手弧线起点(swingArmPose(-34°, reach≈47, 0) 的手位)几乎重合,起拍
// blendIn 只剩 ~10° 微调(旧版「胸前举拍 → 弧线 -34°」的 102° 急翻已消除)。
export const SERVE_POSE: Pose = { hand: { x: 16, y: 12 }, bend: 40, ang: -24, len: 26 };

/** 发球等待的显示位(呼吸微摆 + 慢速拍面微调):等待期显示的 = 起拍出发的,衔接无缝 */
export function serveHoldPose(t: number): Pose {
  return {
    hand: { x: SERVE_POSE.hand.x, y: SERVE_POSE.hand.y + Math.sin(t * 0.025) * 1.2 },
    bend: SERVE_POSE.bend,
    ang: SERVE_POSE.ang + Math.sin(t * 0.025) * 2.5 + Math.sin(t * 0.013) * 2.5,
    len: SERVE_POSE.len,
  };
}

// ---------- 挥拍臂:手钉判定弧线 + 弯折节奏 ----------
// 弯折节奏(度):
//  * over 是头顶鞭打 —— 引拍深卡肘(112°)蓄力,接触前甩直(8°,力量线贯通拍头),
//    随挥回收(46°→58°);旧版「中段最弯、接触仍弯」的肘部节奏按真实挥拍纠正。
//  * under 是低位铲挑 —— 全程保持弯(88°→58°→70°),臂不伸直,靠腿蹬伸发力。
//  手位仍钉在 reach*0.42 的弧线上,拍长 reach*0.58:拍头合计正好 reach = 判定扫掠。
export function swingArmPose(ang: number, reach: number, u: number, style: SwingStyle): Pose {
  const rad = ang * (Math.PI / 180);
  const hand: Pt2 = { x: Math.cos(rad) * reach * 0.42, y: -Math.sin(rad) * reach * 0.42 };
  const bend = style === "over"
    ? lut([[0, 96], [0.14, 112], [0.42, 8], [0.75, 46], [1, 58]], u)
    : lut([[0, 88], [0.3, 74], [0.55, 58], [1, 70]], u);
  return { hand, bend, ang, len: reach * 0.58 };
}

/** 收拍姿势:k=0 是弧线终点(与挥拍末帧无缝),k=1 回到待机;
 *  插值曲线走 easeOutBack(末端甩过头再弹回 = follow-through 的惯性回弹)。
 *  lastStyle/lastRadius 用「上一拍」的值:起拍会把 swingStyle 换成本拍的,回摆得看上一拍。 */
export function recoverPose(lastStyle: SwingStyle, lastRadius: number, k: number): Pose {
  const arc = Physics.swingArc(lastStyle);
  const reach = lastRadius * 0.86;
  const c = C.swing.recoverOvershoot, tt = k - 1;
  const kb = 1 + (c + 1) * tt * tt * tt + c * tt * tt;
  return poseLerp(swingArmPose(arc.to, reach, 1, lastStyle), IDLE_POSE, kb);
}

// ---------- 情绪姿势(CPU 人格化) ----------
// 庆祝:拍举高、手臂上扬,随情绪包络抬起;沮丧:拍低垂、近直臂 limp。
export function celebratePose(cU: number): Pose {
  return { hand: { x: 14, y: -18 - cU * 10 }, bend: 6 + 26 * cU, ang: 78 + cU * 15, len: 25 };
}
export function frustratePose(fU: number): Pose {
  return { hand: { x: 18, y: 26 + fU * 3 }, bend: 6 + 4 * fU, ang: 58 - fU * 8, len: 25 };
}

// ---------- 远臂(非持拍侧)两段角 ----------
// 与持拍臂反相。u=0 两臂同举(引拍框架位),u=1 远臂整条下落收拢(转体夹臂)。
// 前臂始终落后上臂 45~50°,挥拍全程肘折可见。
export const FAR_UA = 16, FAR_FA = 14.5;

export function farSwingAngles(style: SwingStyle, u: number, serve = false): [number, number] {
  if (serve) {
    // 发球松球轨迹:u=0 精确等于托球位(206/250)—— 球释放前手球零分离;之后向后缓收。
    // 两段角差值线性收 44°→38° 且不变号,肘折全程可见;手始终在肩后下方,不进后脑遮挡圆。
    return [lerp(206, 188, u), lerp(250, 226, u)];
  }
  return style === "under"
    ? [lerp(158, 224, u), lerp(110, 176, u)]
    : [lerp(150, 214, u), lerp(105, 164, u)];
}

// ---------- 腿部剪辑:踝目标(帧局部坐标,y=0 = 地面) ----------
// bx = 该腿的髋 x;近腿 s=+1、远腿 s=-1(远腿相位 +π)。

/** 跑步步态:触地相脚贴地后蹬、摆动相(向前摆,cos(φ)>0)折膝前抬 ——
 *  抬脚与向前摆同相,是真实步态;旧版抬脚与后蹬同相(脚跟前拖)已纠正。
 *  幅度沿用旧 runDx/runLift 的数值档。 */
export function runFoot(bx: number, phi: number, spN: number): Pt2 {
  const stride = 2.5 + 3.5 * spN;
  const lift = 3 + 4 * spN;
  return { x: bx + Math.sin(phi) * stride, y: -Math.max(0, Math.cos(phi)) * lift };
}

/** 空中:上升段收腿(脚收到臀下)、下落段前腿伸出备落地;airK 0=刚起跳 1=快落地 */
export function airFoot(bx: number, s: number, airK: number): Pt2 {
  return {
    x: bx + s * lerp(2, 4.5, airK),
    y: -(s > 0 ? lerp(5, 1, airK) : lerp(2, 0.5, airK)),
  };
}

/** 深跨步:引导腿大步前伸(髋沉由 sprites 下沉量配合,膝弯自动出现),
 *  后腿蹬直拖后(峰值超出腿长,IK 夹直 = 蹬伸)—— 网前救球的下肢剪裁。 */
export function lungeFoot(bx: number, lead: boolean, ext: number, dirRel: number): Pt2 {
  return lead
    ? { x: bx + dirRel * (5 + 13 * ext), y: 0 }
    : { x: bx - dirRel * (4 + 21 * ext), y: 0 };
}

/** 站立:脚落在自身髋位正下方、踝微抬 1.5px —— 呼吸时髋的 ±1.6px 起落
 *  会经由 IK 折算成膝的轻微屈伸(待机「活」的来源之一)。 */
export function standFoot(bx: number): Pt2 {
  return { x: bx, y: -1.5 };
}

/** 挥拍下半身:under 蓄力双腿提跟(折腿蓄力)、over 发力窗后腿蹬伸提跟。
 *  肩点/髋点是判定锁定位,蓄力只走「脚跟抬起」机制,不降髋。 */
export function swingFootLift(style: SwingStyle, far: boolean, crouchK: number, driveK: number): number {
  if (style === "under") return crouchK * C.swingLegs.underCrouchKnee * 0.55 + driveK * C.swingLegs.underDriveLift;
  return far ? driveK * C.swingLegs.overDriveLift : 0;
}
