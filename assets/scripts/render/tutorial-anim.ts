// ============================================================
// 新手教学演示:三段手势动画(移动/击球/起跳)的舞台绘制。
//
// 0.0.24 重做:与训练场演示(drill-anim 0.0.21)同一条路 —— 弹道、站位、跳跃
// 全部吃 core/tutorial-demo 的**真值烘焙**(与教学实操真喂的同一颗球),画的东西
// 不再是自己编的示意:来球/回球是真弹道、人偶是 sprites.drawPlayer 真人、
// 球是 drawShuttle 真羽毛球、滑轨与实机 railGeo 的 1:1 对位同源。
// 旧版的手编贝塞尔、火柴人、白点球、「手指钉死在滑轨上的击球演示」全部退休。
//
// 分层纪律(render 只画不算):
//   · 本模块零判定 —— 门控在 core/tutorial.ts,版式在 ui/tutorial-layout.ts;
//   · 颜色自持(与 ui 侧同源,改要一起改),不反向 import ui 层;
//   · 文字一律以 callouts() 数据交出去,由面板摆 Label(引擎 Graphics 画不了字);
//   · 舞台尺寸由调用方经 drawFrame(g, rig, w, h) 传入,本模块不关心画布到底多大。
//
// 坐标约定:画布原点居中、y 朝上;内部 Viewport 把世界坐标(canvas 惯例 960×540
// y 向下)映射进来 —— 上半是屏幕控件区(滑轨/击球键,与球场同一把 x 尺),
// 下半是球场带(子相机全宽切片)。
// ============================================================
import { Graphics } from "cc";
import { CFG } from "../core/config";
import { bake as demoBake, jumpTable } from "../core/tutorial-demo";
import type { TutDemoBake } from "../core/tutorial-demo";
import { Player as PlayerNS } from "../core/player";
import type { Ball, Player } from "../core/types";
import { clamp } from "../core/utils";
import { textW } from "../core/text-metrics";
import { drawPlayer, drawShuttle, Viewport } from "./sprites";
import { makeShuttleMotion, advanceShuttle } from "./shuttle-motion";
import type { ShuttleMotion } from "./shuttle-motion";
import { pal, withAlpha } from "./palette";
import { drawTaper, drawCrossMark, drawStarburst, fillSpikes, SPIKE_VERTS } from "./p5kit";

const C = CFG;
const CO = C.court;

// 舞台配色(与 ui-arcade/p5-tokens 的斩劈红/荧光黄/青/纸白同一批,两边同源)
const INK = {
  paper: "#f5f1e6",
  dim: "#8a93a8",
  ink: "#0a0e1c",
  gold: "#ffe14d",     // 深球(与触屏击球键右滑档位色同源)
  cyan: "#00f0ff",     // 网前(左滑档位色)/ 上滑手势
  red: "#ff4d4d",      // 玩家人偶
  blue: "#3f6df0",     // 喂球机(来球一侧)
  rail: "#2a3350",
  railEdge: "#4a5680",
  ground: "#5a6486",
  floor: "#c8703a",    // 场地板(与 drill-anim 同一支)
  inbound: "#64d8ff",  // 来球:与 drill-anim 同一支冷青
  trail: "#7dff9e",
} as const;

export interface TutRig {
  topic: number;        // 0 移动 / 1 击球 / 2 起跳
  t: number;            // 舞台时钟(帧)
  speed: number;        // 1 = 原速,0.5 = 慢放
  paused: boolean;
  /** 演示真值(烘不出时为 null:手势照画,球/弧线相关全部跳过) */
  bake: TutDemoBake | null;
  /** 真人偶(hit/jump 画 sprites.drawPlayer;move 也要它跑位) */
  p: Player;
  /** 球体"活着在飞"的视觉状态(滞后角/裙摆/翻滚,零 cc 状态机) */
  m: ShuttleMotion;
  /** 尖刺爆点顶点出生定形(逐帧只缩放,禁逐帧 rand —— 会抖成噪点) */
  seedVerts: Float32Array;
  seedOff: number;
  seedCount: number;
}

export interface Callout { x: number; y: number; text: string; hex: string; size: number }

// ---------- 真值节拍:来球/回球吃弹道真实帧数,手势段吃 config ----------

const D = (): NonNullable<typeof C.tutorial.demo> => C.tutorial.demo;
const B = (): TutDemoBake | null => demoBake();

/** 来球/回球的播放帧数:弹道真值,只挡极端(config.demo.hit 的 clamp) */
function hitPhaseFrames(b: TutDemoBake | null): { inF: number; outDeep: number; outNet: number } {
  const H = D().hit;
  if (!b) return { inF: 52, outDeep: 56, outNet: 56 };
  return {
    inF: clamp(b.inbound.frames, H.minIn, H.maxIn),
    outDeep: clamp(b.deep.pts.length - 1, H.minOut, H.maxOut),
    outNet: clamp(b.net.pts.length - 1, H.minOut, H.maxOut),
  };
}

function jumpPhaseFrames(b: TutDemoBake | null): { inF: number; outF: number; airF: number; apexIdx: number } {
  const J = D().jump;
  const tbl = jumpTable();
  const airF = tbl.length;
  let apexIdx = 0;
  for (let i = 0; i < tbl.length; i++) if (tbl[i] > tbl[apexIdx]) apexIdx = i;
  if (!b || !b.jumpContact) return { inF: 52, outF: 56, airF, apexIdx };
  const outF = clamp(
    b.jumpRet.pts.length - 1, J.minOut,
    Math.min(J.maxOut, airF - apexIdx + J.land + J.hold - 6),   // 循环内必须飞完
  );
  return {
    inF: clamp(b.jumpContact.frame, J.minIn, J.maxIn),
    outF,
    airF, apexIdx,
  };
}

/** 每个主题的循环长度(帧)。数值真话:来球/回球/跳跃 = 弹道与递推真值,手势段 = config */
export function loopOf(topic: number): number {
  const b = B();
  if (topic === 0) {
    const M = D().move;
    return M.press + M.slide + M.dwell + M.back;
  }
  if (topic === 1) {
    const { inF, outDeep, outNet } = hitPhaseFrames(b);
    const H = D().hit;
    return (inF + H.wind + H.freeze + outDeep + H.hold) + (inF + H.wind + H.freeze + outNet + H.hold);
  }
  const { inF, outF, airF } = jumpPhaseFrames(b);
  const J = D().jump;
  return (inF + J.press + J.slideUp + airF + J.land + J.hold)
    + (inF + J.tap + J.tapGap + J.tap + airF + J.land + J.hold);
}

export function build(topic: number): TutRig {
  const p = PlayerNS.create("left", { theme: C.colors.red, jersey: "01" });
  p.x = 250; p.y = CO.groundY; p.onGround = true;
  p.swingRadius = C.swing.radiusBase;
  p.swingHit = true;
  const verts = new Float32Array(SPIKE_VERTS);
  const count = fillSpikes(verts, 0, 977 + topic * 131, 7, 10, 0.72, 0.12);
  return {
    topic, t: 0, speed: 1, paused: false,
    bake: B(), p, m: makeShuttleMotion(),
    seedVerts: verts, seedOff: 0, seedCount: count,
  };
}

export function setTopic(rig: TutRig, topic: number): void {
  if (rig.topic !== topic) { rig.topic = topic; rig.t = 0; }
}

export function advance(rig: TutRig, dt: number): void {
  if (rig.paused) return;
  rig.t += dt * 60 * rig.speed;
  const loop = loopOf(rig.topic);
  if (rig.t >= loop) rig.t -= loop;
}

// ============================================================
// 节拍:各主题在循环内推出「手指/人偶/球」的当下状态(纯函数,吃 t)
// ============================================================

/** 滑轨可达区间(railGeo 同源:滑块世界 x = 人世界 x,1:1) */
const RAIL_X0 = CO.wallL;
const RAIL_X1 = CO.netX - CO.netPad;

export interface MoveState {
  px: number;           // 人(=手指)的世界 x(滑轨 1:1:手指在哪人就在哪)
  pressed: boolean;
  dwell: boolean;       // 停稳段(圈变金)
  fingerA: number;      // 手指不透明度 0..1(松手渐隐)
}

export function moveState(t: number): MoveState {
  const M = D().move;
  const home = CO.netX - 210;            // 玩家出生位(rules.homeX 同源)
  const target = C.tutorial.moveTargetX;
  const t1 = M.press, t2 = t1 + M.slide, t3 = t2 + M.dwell;
  if (t < t1) return { px: home, pressed: true, dwell: false, fingerA: 1 };
  if (t < t2) {
    const k = (t - t1) / M.slide;
    const e = k * k * (3 - 2 * k);       // smoothstep:拖动起步/收尾有人手味
    return { px: home + (target - home) * e, pressed: true, dwell: false, fingerA: 1 };
  }
  if (t < t3) return { px: target, pressed: true, dwell: true, fingerA: 1 };
  return { px: target, pressed: false, dwell: true, fingerA: clamp(1 - (t - t3) / (M.back * 0.5), 0, 1) };
}

export interface HitState {
  phase: "in" | "wind" | "freeze" | "out" | "hold";
  k: number;            // 段内进度 0..1
  deep: boolean;        // 偶数圈 = 右滑深球,奇数圈 = 左滑网前
  fingerA: number;      // 手指不透明度
  fingerOff: number;    // 手指沿滑向离开键心的距离(px,负 = 左)
}

export function hitState(t: number): HitState {
  const H = D().hit;
  const { inF, outDeep, outNet } = hitPhaseFrames(B());
  const deepLen = inF + H.wind + H.freeze + outDeep + H.hold;
  const deep = t < deepLen;
  const out = deep ? outDeep : outNet;
  const u = deep ? t : t - deepLen;
  if (u < inF) {
    const k = u / inF;
    // 手势:按住键心,球到身前(后 38%)沿档位方向滑出键缘 —— 「按住向右/左滑」要画出来
    const off = k < 0.62 ? 0 : ((k - 0.62) / 0.38) * 22;
    return { phase: "in", k, deep, fingerA: 1, fingerOff: deep ? off : -off };
  }
  const rest = u - inF;
  if (rest < H.wind) return { phase: "wind", k: rest / H.wind, deep, fingerA: 1, fingerOff: deep ? 22 : -22 };
  if (rest < H.wind + H.freeze) return { phase: "freeze", k: (rest - H.wind) / H.freeze, deep, fingerA: 1, fingerOff: deep ? 22 : -22 };
  if (rest < H.wind + H.freeze + out) {
    return { phase: "out", k: (rest - H.wind - H.freeze) / out, deep, fingerA: clamp(1 - (rest - H.wind - H.freeze) / 14, 0, 1), fingerOff: deep ? 22 : -22 };
  }
  return { phase: "hold", k: 0, deep, fingerA: 0, fingerOff: deep ? 22 : -22 };
}

export interface JumpState {
  phase: "in" | "gesture" | "air" | "land" | "hold";
  k: number;            // 段内进度 0..1
  double: boolean;      // 偶数圈 = 上滑,奇数圈 = 双击
  g: number;            // 手势进度 0..1
  gf: number;           // 手势段内的绝对帧(双击按拍用)
  gestureF: number;     // 手势段总长
  jumpH: number;        // 真实跳跃递推的离地高度
}

export function jumpState(t: number): JumpState {
  const J = D().jump;
  const { inF, airF } = jumpPhaseFrames(B());
  const slideLen = inF + J.press + J.slideUp + airF + J.land + J.hold;
  const dbl = t >= slideLen;
  const u = dbl ? t - slideLen : t;
  const gestureF = dbl ? J.tap + J.tapGap + J.tap : J.press + J.slideUp;
  if (u < inF) return { phase: "in", k: u / inF, double: dbl, g: 0, gf: 0, gestureF, jumpH: 0 };
  const r = u - inF;
  if (r < gestureF) {
    return { phase: "gesture", k: r / gestureF, double: dbl, g: r / gestureF, gf: r, gestureF, jumpH: 0 };
  }
  const a = r - gestureF;
  const tbl = jumpTable();
  if (a < airF) {
    return { phase: "air", k: a / airF, double: dbl, g: 1, gf: gestureF, gestureF, jumpH: tbl[Math.min(tbl.length - 1, Math.floor(a))] };
  }
  const l = a - airF;
  if (l < J.land) return { phase: "land", k: l / J.land, double: dbl, g: 1, gf: gestureF, gestureF, jumpH: 0 };
  return { phase: "hold", k: 0, double: dbl, g: 1, gf: gestureF, gestureF, jumpH: 0 };
}

/** 弧线点列取帧(线性插值位置 + 差分速度,球体视觉状态机要吃速度) */
function ballAtArc(pts: { x: number; y: number }[], f: number): { x: number; y: number; vx: number; vy: number } | null {
  if (!pts.length) return null;
  const i = clamp(Math.floor(f), 0, pts.length - 1);
  const j = Math.min(pts.length - 1, i + 1);
  const k = clamp(f - i, 0, 1);
  const x = pts[i].x + (pts[j].x - pts[i].x) * k;
  const y = pts[i].y + (pts[j].y - pts[i].y) * k;
  const vx = pts[j].x - pts[i].x, vy = pts[j].y - pts[i].y;
  return { x, y, vx, vy };
}

// ============================================================
// 舞台几何:控件区(上)+ 球场带(下,子相机全宽切片)
// ============================================================

interface Stage {
  w: number; h: number;
  s: number;                        // 世界→画布缩放
  vp: Viewport;
  gy: number;                       // 地面画布 y
  railY: number; railH: number;
  keyX: number; keyY: number; keyR: number;
}

const BASE_S = 0.49;

function stage(w: number, h: number): Stage {
  const s = BASE_S * (w / 430);
  const camX = (CO.wallL + CO.wallR) / 2;
  const gy = -h / 2 + 26;
  // 地面钉在 gy:vp.y(groundY) = -(groundY-camY)*s = gy → camY = groundY + gy/s
  const camY = CO.groundY + gy / s;
  const vp: Viewport = {
    x: (wx: number) => (wx - camX) * s,
    y: (wy: number) => -(wy - camY) * s,
  };
  const railY = h / 2 - 30;
  return {
    w, h, s, vp, gy,
    railY, railH: 18,
    keyX: w / 2 - 52, keyY: railY, keyR: 22,
  };
}

/** 世界 x → 滑轨画布 x(控件区与球场共用同一把 x 尺:1:1 对位是滑轨的教学卖点) */
function railX(st: Stage, wx: number): number {
  return st.vp.x(clamp(wx, RAIL_X0, RAIL_X1));
}

// ============================================================
// 画笔
// ============================================================

/** 球场带:地板、地面线、场地线、网(与 drill-anim 的 drawCourt 同一语汇) */
function drawCourt(g: Graphics, st: Stage): void {
  const { vp, w, h } = st;
  g.fillColor = withAlpha(pal(INK.ink), 0.35);
  g.rect(-w / 2, -h / 2, w, h);
  g.fill();
  // 地板条(地面线以下)
  g.fillColor = withAlpha(pal(INK.floor), 0.26);
  g.rect(-w / 2, -h / 2, w, st.gy + h / 2);
  g.fill();
  // 地面线 + 场地刻度
  g.strokeColor = withAlpha(pal(INK.ground), 0.75);
  g.lineWidth = 2;
  g.moveTo(vp.x(CO.wallL - 14), st.gy); g.lineTo(vp.x(CO.wallR + 14), st.gy);
  g.stroke();
  g.lineWidth = 1;
  g.strokeColor = withAlpha(pal(INK.ground), 0.4);
  for (const lx of [CO.left, CO.shortServeL, CO.shortServeR, CO.right]) {
    g.moveTo(vp.x(lx), st.gy); g.lineTo(vp.x(lx), st.gy - 5);
  }
  g.stroke();
  // 网
  g.strokeColor = withAlpha(pal(INK.paper), 0.8);
  g.lineWidth = 2.2;
  g.moveTo(vp.x(CO.netX), st.gy); g.lineTo(vp.x(CO.netX), vp.y(CO.netTopY));
  g.stroke();
  g.strokeColor = withAlpha(pal(INK.paper), 0.4);
  g.lineWidth = 1.2;
  g.moveTo(vp.x(CO.netX) - 9, vp.y(CO.netTopY)); g.lineTo(vp.x(CO.netX) + 9, vp.y(CO.netTopY));
  g.stroke();
  g.lineWidth = 1;
  g.strokeColor = withAlpha(pal(INK.paper), 0.22);
  for (let yy = CO.netTopY + 12; yy < CO.groundY - 6; yy += 16) {
    g.moveTo(vp.x(CO.netX) - 5, vp.y(yy)); g.lineTo(vp.x(CO.netX) + 5, vp.y(yy));
  }
  g.stroke();
}

/** 喂球机:方身 + 出球口 + 指示灯 + 轮子(放球前「站稳几拍」的那台,文案提过它就得在) */
function drawFeeder(g: Graphics, st: Stage, b: TutDemoBake | null, lampGlow: number): void {
  if (!b) return;
  const fx = st.vp.x(b.inbound.feederX);
  const fy = st.gy;
  const bw = 34, bh = 30;
  // 轮子
  g.fillColor = pal(INK.ink);
  g.circle(fx - 10, fy - 3, 3.4); g.fill();
  g.circle(fx + 10, fy - 3, 3.4); g.fill();
  // 方身(斜切顶,避开光滑圆的读感)
  g.fillColor = pal(INK.blue);
  g.moveTo(fx - bw / 2, fy - 6);
  g.lineTo(fx - bw / 2 + 5, fy - 6 - bh);
  g.lineTo(fx + bw / 2, fy - 6 - bh);
  g.lineTo(fx + bw / 2, fy - 6);
  g.close(); g.fill();
  g.strokeColor = withAlpha(pal(INK.paper), 0.55);
  g.lineWidth = 1.2;
  g.moveTo(fx - bw / 2, fy - 6);
  g.lineTo(fx - bw / 2 + 5, fy - 6 - bh);
  g.lineTo(fx + bw / 2, fy - 6 - bh);
  g.lineTo(fx + bw / 2, fy - 6);
  g.close(); g.stroke();
  // 出球口(朝左)
  g.fillColor = pal(INK.ink);
  g.rect(fx - bw / 2 - 6, fy - 26, 8, 7);
  g.fill();
  // 指示灯:放球前后亮一下
  if (lampGlow > 0) {
    g.fillColor = withAlpha(pal(INK.gold), lampGlow);
    g.circle(fx + 6, fy - 6 - bh + 6, 3 + lampGlow * 2);
    g.fill();
  }
}

/** 滑轨:与实机 railGeo 的可达区间 1:1 对位(轨上每个 x = 场上同一个 x) */
function drawRail(g: Graphics, st: Stage): void {
  const l = railX(st, RAIL_X0), r = railX(st, RAIL_X1);
  const y = st.railY - st.railH / 2;
  g.fillColor = pal(INK.rail);
  g.roundRect(l, y, r - l, st.railH, 9);
  g.fill();
  g.strokeColor = pal(INK.railEdge);
  g.lineWidth = 1.5;
  g.roundRect(l, y, r - l, st.railH, 9);
  g.stroke();
  // 刻度:五格,对应真实可达区间
  g.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const x = l + ((r - l) * i) / 5;
    g.moveTo(x, y + 4); g.lineTo(x, y + st.railH - 4);
  }
  g.stroke();
  // 轨心下方的场地对位刻痕:轨与球场 1:1 的暗示
  g.strokeColor = withAlpha(pal(INK.railEdge), 0.5);
  for (const wx of [CO.shortServeL]) {
    const x = railX(st, wx);
    g.moveTo(x, y - 3); g.lineTo(x, y);
  }
  g.stroke();
}

/** 击球键:圆键 + 左右滑档位箭头(箭头色即档位色:右滑金/左滑青)。
 *  非击球主题键整体压暗(它在那两课不是主角,但要在场 —— 实机屏幕上它一直在) */
function drawSwingKey(g: Graphics, st: Stage, dir: number, active: boolean): void {
  const idle = dir === 0 && !active;
  g.fillColor = withAlpha(pal(INK.rail), idle ? 0.55 : 1);
  g.circle(st.keyX, st.keyY, st.keyR);
  g.fill();
  g.strokeColor = withAlpha(pal(active ? INK.gold : INK.railEdge), idle ? 0.6 : 1);
  g.lineWidth = active ? 2.5 : 1.5;
  g.circle(st.keyX, st.keyY, st.keyR);
  g.stroke();
  const arrow = (d: number, hex: string, a: number): void => {
    g.strokeColor = withAlpha(pal(hex), a * (idle ? 0.5 : 1));
    g.lineWidth = a > 0.5 ? 2.5 : 1;
    const x0 = st.keyX + d * 6, y0 = st.keyY;
    g.moveTo(x0, y0 - 6); g.lineTo(x0 + d * 9, y0); g.lineTo(x0, y0 + 6);
    g.stroke();
  };
  arrow(1, INK.gold, dir > 0 ? 1 : 0.25);
  arrow(-1, INK.cyan, dir < 0 ? 1 : 0.25);
}

/** 手指:白圆 + 指甲高光 + 按压涟漪(涟漪节奏吃 t,不逐帧 rand) */
function drawFinger(g: Graphics, st: Stage, x: number, y: number, pressed: boolean, t: number, alpha: number): void {
  if (alpha <= 0.01) return;
  if (pressed) {
    const k = (t % 36) / 36;
    g.strokeColor = withAlpha(pal(INK.paper), 0.7 * alpha * (1 - k));
    g.lineWidth = 1.5;
    g.circle(x, y, 10 + k * 12);
    g.stroke();
  }
  g.fillColor = withAlpha(pal(INK.paper), alpha);
  g.circle(x, y, 9);
  g.fill();
  g.strokeColor = withAlpha(pal(INK.ink), alpha);
  g.lineWidth = 2;
  g.circle(x, y, 9);
  g.stroke();
  // 指甲高光:一弯月牙,从「白点」升格成「手指」
  g.strokeColor = withAlpha(pal(INK.dim), 0.9 * alpha);
  g.lineWidth = 2;
  g.arc(x + 2.2, y + 2.2, 3.6, Math.PI * 0.9, Math.PI * 1.7, false);
  g.stroke();
}

/** 手指拖动尾迹:沿节拍倒推历史位置(无状态,定格时尾迹也定格) */
function drawFingerTrail(g: Graphics, st: Stage, histAt: (dtAgo: number) => { x: number; y: number } | null, alpha: number): void {
  for (let k = 5; k >= 1; k--) {
    const pt = histAt(k * 3);
    if (!pt) continue;
    const a = alpha * (1 - k / 6) * 0.5;
    if (a <= 0.01) continue;
    g.fillColor = withAlpha(pal(INK.paper), a);
    g.circle(pt.x, pt.y, 4.5 - k * 0.5);
    g.fill();
  }
}

/** 虚线弧:一段画、一段空;upto = 画到第几帧(「飞过才亮」与「定格画满」同一支笔) */
function drawDashed(g: Graphics, st: Stage, pts: { x: number; y: number }[], upto: number,
  color: string, alpha: number, width: number): void {
  if (pts.length < 2) return;
  const { on, off } = D().dash;
  const n = Math.min(pts.length - 1, Math.max(1, Math.floor(upto)));
  g.strokeColor = withAlpha(pal(color), alpha);
  g.lineWidth = width;
  let run = 0, pen = true;
  g.moveTo(st.vp.x(pts[0].x), st.vp.y(pts[0].y));
  for (let i = 1; i <= n; i++) {
    run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (pen) g.lineTo(st.vp.x(pts[i].x), st.vp.y(pts[i].y));
    else g.moveTo(st.vp.x(pts[i].x), st.vp.y(pts[i].y));
    if (run >= (pen ? on : off)) { run = 0; pen = !pen; }
  }
  g.stroke();
}

/** 触球爆点:星芒 + 尖刺集中线(照 drill-anim 的 drawHitBurst) */
function drawHitBurst(g: Graphics, rig: TutRig, st: Stage, cx: number, cy: number, u: number): void {
  drawStarburst(g, cx, cy, 20 - u * 6, 7, 9, pal(INK.gold), (1 - u) * 0.9, u * 0.6);
  g.fillColor = withAlpha(pal(INK.paper), (1 - u) * 0.95);
  g.circle(cx, cy, 4.5 * (1 - u * 0.5));
  g.fill();
  const rng = 8 + u * 16;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    drawTaper(g, cx + Math.cos(a) * 6, cy + Math.sin(a) * 6,
      cx + Math.cos(a) * rng, cy + Math.sin(a) * rng, 3.4, pal(INK.gold), (1 - u) * 0.85);
  }
}

/** 落点尘土:两三笔小斜线 + 压扁回弹由人偶自己演 */
function drawLandDust(g: Graphics, st: Stage, x: number, u: number): void {
  const a = (1 - u) * 0.7;
  if (a <= 0.02) return;
  g.strokeColor = withAlpha(pal(INK.dim), a);
  g.lineWidth = 1.6;
  for (const [dx, dy] of [[-8, -3], [8, -3], [-13, -7], [13, -7]] as const) {
    g.moveTo(st.vp.x(x) + dx * (0.6 + u), st.gy - 2);
    g.lineTo(st.vp.x(x) + dx * (1.2 + u * 0.8), st.gy - 2 + dy);
  }
  g.stroke();
}

/** 画一颗真羽毛球(手搓 Ball 字面量,照 drill-anim 先例;motion 让它活着飞) */
function drawShuttleAt(g: Graphics, rig: TutRig, st: Stage, at: { x: number; y: number; vx: number; vy: number }): void {
  const fake: Ball = {
    x: at.x, y: at.y, px: at.x, py: at.y, vx: at.vx, vy: at.vy,
    live: true, held: false, owner: null, lastHitter: null, crossed: false, netted: false,
    shot: null, sq: 1, sqPrev: 1, flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  };
  advanceShuttle(rig.m, at.vx, at.vy, 1, 1);
  drawShuttle(g, st.vp, fake, null, 0, rig.m);
}

// ============================================================
// 各主题
// ============================================================

function drawMove(g: Graphics, rig: TutRig, st: Stage): void {
  const m = moveState(rig.t);
  const p = rig.p;
  // 人偶:跑动跟随(1:1 对位:手指世界 x 就是人的世界 x)
  const moving = m.pressed && rig.t >= D().move.press && rig.t < D().move.press + D().move.slide;
  p.x = m.px; p.y = CO.groundY; p.onGround = true;
  p.runAmt = moving ? 1 : 0; p.vx = moving ? 2 : 0;
  p.facing = 1; p.sq = 1; p.swingT = -1; p.recoverT = 0;

  // 实操判定圈:与 hud-overlay 的 tutorialGuides 同形同色(青→进圈变金),教和练一个视觉。
  // 底层填充 + 粗描边 + 四向刻度,与实机同一套加浓(亮沙地上细描边看不见)。
  const T = C.tutorial;
  const cx = st.vp.x(T.moveTargetX), cy = st.gy - 2;
  const inZone = Math.abs(m.px - T.moveTargetX) <= T.moveEps;
  const pulse = 0.5 + 0.5 * Math.sin(rig.t * 0.2);
  const col = m.dwell ? INK.gold : INK.cyan;
  const strong = inZone || m.dwell;
  const rx = T.moveEps * st.s, ry = T.moveEps * 0.32 * st.s;
  g.fillColor = withAlpha(pal(col), (strong ? 0.36 : 0.24) + 0.10 * pulse);
  g.ellipse(cx, cy, rx, ry);
  g.fill();
  g.strokeColor = withAlpha(pal(col), Math.min(1, (strong ? 0.98 : 0.9) + 0.06 * pulse));
  g.lineWidth = strong ? 3.4 : 2.8;
  g.ellipse(cx, cy, rx, ry);
  g.stroke();
  g.lineWidth = 2.0 * st.s;
  const tick = 5 * st.s;
  g.moveTo(cx - rx - tick, cy); g.lineTo(cx - rx + tick, cy);
  g.moveTo(cx + rx - tick, cy); g.lineTo(cx + rx + tick, cy);
  g.moveTo(cx, cy - ry - tick); g.lineTo(cx, cy - ry + tick);
  g.moveTo(cx, cy + ry - tick); g.lineTo(cx, cy + ry + tick);
  g.stroke();
  g.lineWidth = 1.8 * st.s;
  g.circle(cx, cy, 4 * st.s);
  g.stroke();

  // 对位竖线:手指正下方那条线一直落到人脚下 —— 滑轨 1:1 的教学点睛
  if (m.fingerA > 0.01) {
    const fx = railX(st, m.px);
    g.strokeColor = withAlpha(pal(INK.paper), 0.22 * m.fingerA);
    g.lineWidth = 1;
    let pen = true;
    for (let y = st.railY - 16; y > st.gy + 6; y -= 7) {
      if (pen) { g.moveTo(fx, y); g.lineTo(fx, Math.max(st.gy + 6, y - 4)); }
      else g.moveTo(fx, y);
      pen = !pen;
    }
    g.stroke();
  }

  drawPlayerSprite(g, rig, st);
  // 手指 + 尾迹(在轨上)
  const fx = railX(st, m.px);
  drawFingerTrail(g, st, (dtAgo) => {
    const h = moveState(Math.max(0, rig.t - dtAgo));
    return { x: railX(st, h.px), y: st.railY };
  }, m.fingerA);
  drawFinger(g, st, fx, st.railY, m.pressed, rig.t, m.fingerA);
}

function drawHit(g: Graphics, rig: TutRig, st: Stage): void {
  const b = rig.bake;
  const s = hitState(rig.t);
  const H = D().hit;
  const standX = b ? b.stand.x : 250;
  const p = rig.p;
  p.x = standX; p.y = CO.groundY; p.onGround = true;
  p.facing = 1; p.runAmt = 0; p.vx = 0;
  p.sq = 1; p.recoverT = 0;
  // 挥拍:wind 引拍 → freeze 定格在命中弧中段 → out 随挥收拍(真 swingT,有中间帧)
  const SWc = C.swing;
  if (s.phase === "in") { p.swingT = -1; p.swingStyle = "over"; p.lastSwingStyle = "over"; }
  else if (s.phase === "wind") { p.swingStyle = "over"; p.lastSwingStyle = "over"; p.swingT = Math.floor(s.k * SWc.windup); }
  else if (s.phase === "freeze") { p.swingStyle = "over"; p.lastSwingStyle = "over"; p.swingT = SWc.windup + Math.round(SWc.active * 0.35); }
  else if (s.phase === "out") { p.swingStyle = "over"; p.lastSwingStyle = "over"; p.swingT = SWc.windup + Math.round(clamp(0.35 + s.k, 0, 1) * SWc.active); }
  else { p.swingT = -1; p.recoverT = SWc.blendOut; }

  // 喂球机:in 段放球前后灯亮
  const lampGlow = s.phase === "in" ? clamp(1 - Math.abs(s.k - 0.12) * 6, 0, 1) : 0;
  drawFeeder(g, st, b, lampGlow);

  if (!b) return;
  const { inF } = hitPhaseFrames(b);
  const arc = s.deep ? b.deep : b.net;

  // 来球弧:整条淡 + 已飞过段亮(与场上落点预告同一支笔)
  drawDashed(g, st, b.inbound.pts.slice(0, Math.max(2, inF + 1)), b.inbound.pts.length, INK.inbound, 0.22, 1.5);
  if (s.phase === "in") drawDashed(g, st, b.inbound.pts.slice(0, Math.max(2, inF + 1)), s.k * inF, INK.inbound, 0.8, 2);

  // 回球弧:出球后逐帧长出来
  if (s.phase === "out") drawDashed(g, st, arc.pts, s.k * arc.pts.length, s.deep ? INK.gold : INK.cyan, 0.85, 2.2);
  else if (s.phase === "hold") drawDashed(g, st, arc.pts, arc.pts.length, s.deep ? INK.gold : INK.cyan, 0.5, 2);

  // 球:in 段飞来 → 引拍/触球期钉在接触点 → out 段飞走
  if (s.phase === "in") {
    const at = ballAtArc(b.inbound.pts, s.k * inF);
    if (at) drawShuttleAt(g, rig, st, at);
  } else if (s.phase === "wind" || s.phase === "freeze") {
    drawShuttleAt(g, rig, st, { x: b.contact.x, y: b.contact.y, vx: 1, vy: 0 });
    if (s.phase === "freeze") drawHitBurst(g, rig, st, st.vp.x(b.contact.x), st.vp.y(b.contact.y), s.k);
  } else if (s.phase === "out") {
    const at = ballAtArc(arc.pts, s.k * (arc.pts.length - 1));
    if (at) drawShuttleAt(g, rig, st, at);
  }
  // 落点准星:回球飞到 80% 才出现
  if ((s.phase === "out" && s.k > 0.8) || s.phase === "hold") {
    drawCrossMark(g, st.vp.x(arc.landX), st.gy - 2, 11, 2.2, 0.5, pal(s.deep ? INK.gold : INK.cyan), s.phase === "hold" ? 0.95 : 0.7);
  }

  drawPlayerSprite(g, rig, st);
  // 手指:按在击球键上,球到身前后沿档位方向滑出(手势本身要演出来)
  if (s.fingerA > 0.01) {
    const fx = st.keyX + s.fingerOff;
    drawFingerTrail(g, st, (dtAgo) => {
      const h = hitState(Math.max(0, rig.t - dtAgo));
      return h.fingerA > 0.01 ? { x: st.keyX + h.fingerOff, y: st.keyY } : null;
    }, s.fingerA);
    drawFinger(g, st, fx, st.keyY, s.fingerA > 0.9, rig.t, s.fingerA);
  }
}

function drawJump(g: Graphics, rig: TutRig, st: Stage): void {
  const b = rig.bake;
  const s = jumpState(rig.t);
  const J = D().jump;
  const standX = b && b.jumpContact ? b.jumpStand.x : 250;
  const p = rig.p;
  p.x = standX;
  p.y = CO.groundY - s.jumpH;
  p.onGround = s.jumpH <= 0 && s.phase !== "air";
  p.facing = 1; p.runAmt = 0; p.vx = 0;
  p.sq = s.phase === "land" && s.k < 0.5 ? C.player.landSquash
    : s.phase === "air" && s.jumpH > 2 ? C.player.jumpStretch : 1;
  p.swingT = -1; p.recoverT = 0; p.swingStyle = "over"; p.lastSwingStyle = "over";
  // 顶点前后甩拍(够高球的姿势)
  const { airF, apexIdx } = jumpPhaseFrames(b);
  if (s.phase === "air" && s.k * airF > apexIdx * 0.6) {
    p.swingT = C.swing.windup + Math.round(clamp((s.k * airF - apexIdx * 0.6) / (apexIdx * 0.8), 0, 1) * C.swing.active);
  }

  const lampGlow = s.phase === "in" ? clamp(1 - Math.abs(s.k - 0.12) * 6, 0, 1) : 0;
  drawFeeder(g, st, rig.bake, lampGlow);

  if (b && b.jumpContact) {
    const { inF, outF } = jumpPhaseFrames(b);
    const apexT = inF + s.gestureF + apexIdx;   // 球钟:顶点那一拍够到球
    drawDashed(g, st, b.inbound.pts.slice(0, Math.max(2, inF + 1)), b.inbound.pts.length, INK.inbound, 0.22, 1.5);
    if (s.phase === "in") drawDashed(g, st, b.inbound.pts.slice(0, Math.max(2, inF + 1)), s.k * inF, INK.inbound, 0.8, 2);
    if (rig.t >= apexT) drawDashed(g, st, b.jumpRet.pts, Math.min(b.jumpRet.pts.length - 1, rig.t - apexT), INK.gold, 0.8, 2);

    // 球钟:in 段飞来 → 手势+起跳期钉在接触点 → 顶点够到后沿 jumpRet 飞走
    if (s.phase === "in") {
      const at = ballAtArc(b.inbound.pts, s.k * inF);
      if (at) drawShuttleAt(g, rig, st, at);
    } else if (rig.t < apexT) {
      drawShuttleAt(g, rig, st, { x: b.jumpContact.x, y: b.jumpContact.y, vx: 1, vy: 0 });
    } else {
      const at = ballAtArc(b.jumpRet.pts, Math.min(b.jumpRet.pts.length - 1, rig.t - apexT));
      if (at) drawShuttleAt(g, rig, st, at);
    }
    // 顶点爆点:跳到顶正好够到
    if (s.phase === "air") {
      const aF = s.k * airF;
      if (aF > apexIdx - 4 && aF < apexIdx + 8) {
        drawHitBurst(g, rig, st, st.vp.x(b.jumpContact.x), st.vp.y(b.jumpContact.y), clamp((aF - (apexIdx - 4)) / 12, 0, 1));
      }
    }
    if (rig.t - apexT > outF * 0.8) {
      drawCrossMark(g, st.vp.x(b.jumpRet.landX), st.gy - 2, 11, 2.2, 0.5, pal(INK.gold), 0.9);
    }
  }

  drawPlayerSprite(g, rig, st);

  // 落地尘土
  if (s.phase === "land") drawLandDust(g, st, standX, s.k);

  // 手势:上滑(手指+箭头一起上移,带速度线)/ 双击(两次快速按压)
  const gestureA = s.phase === "gesture" ? 1 : s.phase === "air" && s.k * airF < 8 ? 1 - (s.k * airF) / 8 : 0;
  if (gestureA > 0.01) {
    const fx = railX(st, standX);
    if (!s.double) {
      const lift = (s.gf / Math.max(1, J.slideUp)) * 22;
      drawFinger(g, st, fx, st.railY - lift, true, rig.t, gestureA);
      // 上滑箭头跟手走,尖朝上(y 朝上:翼从下两侧汇到上端尖)
      const tipY = st.railY - lift + 22;
      g.strokeColor = withAlpha(pal(INK.cyan), gestureA);
      g.lineWidth = 2.5;
      g.moveTo(fx, tipY); g.lineTo(fx, tipY + 16);
      g.moveTo(fx - 5, tipY + 7); g.lineTo(fx, tipY); g.lineTo(fx + 5, tipY + 7);
      g.stroke();
      g.strokeColor = withAlpha(pal(INK.cyan), gestureA * 0.4);
      g.lineWidth = 1.2;
      for (let i = 1; i <= 2; i++) {
        g.moveTo(fx - 12, tipY + 6 + i * 4); g.lineTo(fx - 12, tipY + 14 + i * 4);
        g.moveTo(fx + 12, tipY + 6 + i * 4); g.lineTo(fx + 12, tipY + 14 + i * 4);
      }
      g.stroke();
    } else {
      // 双击:两下短促按压,第二下触发跳
      const tapF = J.tap, gapF = J.tapGap;
      const u = s.gf;
      const pressed = u < tapF || (u >= tapF + gapF && u < tapF + gapF + tapF);
      drawFinger(g, st, fx, st.railY, pressed, rig.t, gestureA);
      if (pressed) {
        g.strokeColor = withAlpha(pal(INK.cyan), gestureA);
        g.lineWidth = 2;
        g.moveTo(fx - 6, st.railY + 14); g.lineTo(fx - 6, st.railY + 22);
        g.moveTo(fx + 6, st.railY + 14); g.lineTo(fx + 6, st.railY + 22);
        g.stroke();
      }
    }
  }
}

/** 真人偶(sprites.drawPlayer):姿势字段在 drawXxx 里摆好,这里只负责画 */
function drawPlayerSprite(g: Graphics, rig: TutRig, st: Stage): void {
  drawPlayer(g, st.vp, rig.p, Math.floor(rig.t), 0, null);
}

// ============================================================
// 主绘制
// ============================================================

export function drawFrame(g: Graphics, rig: TutRig, w: number, h: number): void {
  g.clear();
  const st = stage(w, h);

  drawCourt(g, st);
  drawRail(g, st);
  // 键先画,手指后画 —— 击球演示的手指按在键上,顺序反了手指会被键的实底盖住
  drawSwingKey(g, st, rig.topic === 1 ? (hitState(rig.t).deep ? 1 : -1) : 0,
    rig.topic === 1 && hitState(rig.t).phase !== "hold");

  if (rig.topic === 0) drawMove(g, rig, st);
  else if (rig.topic === 1) drawHit(g, rig, st);
  else drawJump(g, rig, st);
}

// ---------- 画布上的标字(数据,由面板摆 Label) ----------

const clampCallout = (c: Callout, w: number, h: number): Callout => {
  const half = textW(c.text, c.size) / 2 + 4;
  c.x = clamp(c.x, -w / 2 + half, w / 2 - half);
  c.y = clamp(c.y, -h / 2 + 14, h / 2 - 14);   // 顶上还有标题带,字出画布就是压字
  return c;
};

export function callouts(rig: TutRig, w: number, h: number): Callout[] {
  void h;
  const st = stage(w, h);
  const out: Callout[] = [];
  if (rig.topic === 0) {
    const m = moveState(rig.t);
    if (m.pressed && rig.t < D().move.press + D().move.slide && rig.t > D().move.press + 8) {
      out.push(clampCallout({ x: railX(st, m.px), y: st.railY + 34, text: "手指在哪,人就在哪", hex: INK.paper, size: 11 }, w, h));
    }
    if (m.dwell) {
      out.push(clampCallout({ x: st.vp.x(C.tutorial.moveTargetX), y: st.gy + 26, text: "停稳一下", hex: INK.gold, size: 12 }, w, h));
    }
  } else if (rig.topic === 1) {
    const s = hitState(rig.t);
    if (s.phase === "in" && s.k > 0.45) {
      out.push(clampCallout({ x: st.keyX, y: st.keyY - st.keyR - 16, text: "球到身前就按", hex: INK.paper, size: 11 }, w, h));
    } else if (s.phase === "freeze") {
      out.push(clampCallout({ x: st.keyX, y: st.keyY - st.keyR - 16, text: s.deep ? "按住向右滑" : "按住向左滑", hex: s.deep ? INK.gold : INK.cyan, size: 12 }, w, h));
    } else if (s.phase === "out" && s.k > 0.35 || s.phase === "hold") {
      out.push(clampCallout({ x: st.vp.x((s.deep ? rig.bake?.deep.landX : rig.bake?.net.landX) ?? 700), y: st.gy + 26, text: s.deep ? "深球" : "网前", hex: s.deep ? INK.gold : INK.cyan, size: 13 }, w, h));
    }
  } else {
    const s = jumpState(rig.t);
    if (s.phase === "gesture" && s.g > 0.25) {
      out.push(clampCallout({ x: railX(st, rig.bake?.jumpStand.x ?? 250), y: st.railY + 46, text: s.double ? "快速点两下" : "向上滑", hex: INK.cyan, size: 12 }, w, h));
    } else if (s.phase === "air" && s.k > 0.5) {
      out.push(clampCallout({ x: st.vp.x(rig.bake?.jumpStand.x ?? 250), y: st.gy + 90, text: "跳起来够高球", hex: INK.paper, size: 11 }, w, h));
    }
  }
  return out.slice(0, 3);
}
