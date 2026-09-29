// ============================================================
// 羽毛球物理 + 弹道反解
// 思路:θ(出射角)控弧度→决定能不能过网;speed 控落点→决定深浅。
// 两者各自单调,所以用「θ 抬升 + speed 二分」两步求解,不用最小二乘。
// 单位:px / step(1 step = 1/60s)
// ============================================================
import { CFG } from "./config";
import { clamp, lerp, inv, D2R } from "./utils";
import { ShotKind, SwingStyle } from "./types";

const C = CFG;
const U = { clamp, lerp, inv, D2R };
const G = C.shuttle.gravity;
const K = C.shuttle.dragK;
const DMIN = C.shuttle.dragMin;
const VMAX = C.shuttle.maxSpeed;
const CO = C.court;
// 球有半径,网带的有效拦截线比视觉网顶略高
const NET_HIT_Y = CO.netTopY - C.shuttle.radius * 0.5;

/** 物理层只依赖球的运动学字段(结构化类型,Ball 天然满足) */
export interface BallLike {
  x: number; y: number; px: number; py: number; vx: number; vy: number;
}

/** 拍头几何只依赖这几个字段(Probe/Player 都满足) */
export interface RacketLike {
  x: number; y: number; facing: number; swingStyle: SwingStyle;
}

export interface TraceResult {
  landX: number; landY: number; steps: number;
  apex: number; netY: number | null;
  lvx: number; lvy: number; hitNet: boolean;
}

export interface SolveResult {
  vx: number; vy: number; speed: number; deg: number;
  trace: TraceResult;
  targetX: number; short: boolean; depth: number;
  /** 实际命中的安全过网角;null = 这个落点没有安全解(球被压在网带下,认命下网) */
  floorClear: number | null; floorReach: number;
  kind: ShotKind;
  /** 由调用方(标定工具)按命中质量补记,物理层本身不填 */
  sweet?: boolean;
  perfect?: boolean;
}

function capSpeed(b: BallLike): number {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > VMAX) { const s = VMAX / sp; b.vx *= s; b.vy *= s; }
  return Math.min(sp, VMAX);
}

// 单步积分(二次阻力:快球急停、慢球下坠,接近真实羽毛球)
function step(b: BallLike): void {
  b.px = b.x; b.py = b.y;
  const sp = capSpeed(b);
  const d = Math.max(DMIN, 1 - K * sp);
  b.vx *= d;
  b.vy *= d;
  b.vy += G;
  b.x += b.vx;
  b.y += b.vy;
}

// 线段与球网平面的交点 y;未过网返回 null
function yAtNet(px: number, py: number, x: number, y: number): number | null {
  if (x === px) return null;
  const t = (CO.netX - px) / (x - px);
  if (t <= 0 || t > 1) return null;
  return py + (y - py) * t;
}

// 无头模拟:给定初速,看它落在哪 / 是否下网
function trace(x0: number, y0: number, vx: number, vy: number, maxSteps = 260): TraceResult {
  let x = x0, y = y0, px = x0, py = y0;
  let apex = y0, netY: number | null = null;
  for (let i = 1; i <= maxSteps; i++) {
    const sp = Math.hypot(vx, vy);
    const d = Math.max(DMIN, 1 - K * Math.min(sp, VMAX));
    if (sp > VMAX) { const s = VMAX / sp; vx *= s; vy *= s; }
    vx *= d; vy *= d; vy += G;
    px = x; py = y; x += vx; y += vy;
    if (y < apex) apex = y;
    const yn = yAtNet(px, py, x, y);
    if (yn !== null && netY === null) netY = yn;
    if (y >= CO.groundY - 2) {
      return { landX: x, landY: CO.groundY - 2, steps: i, apex, netY, lvx: vx, lvy: vy, hitNet: netY !== null && netY > NET_HIT_Y };
    }
    if (x < -80 || x > C.world.w + 80) {
      return { landX: x, landY: y, steps: i, apex, netY, lvx: vx, lvy: vy, hitNet: netY !== null && netY > NET_HIT_Y };
    }
  }
  return { landX: x, landY: y, steps: maxSteps, apex, netY, lvx: vx, lvy: vy, hitNet: netY !== null && netY > NET_HIT_Y };
}

// 「能过网」不能只看是否撞上球网:二分解出的是**临界角**,不夹余量就正好贴着网带擦过去,
// 这就是轻击容易擦网的原因(实测 39% 的短球过网余量 <5px,球头已经在视觉上蹭到网带)。
// 所以安全解要求球心比网带高出一个余量;netY 为空(球没越过网平面就落地)也一律算没过网。
const MARGIN = C.shot.netClearMargin;
const clears = (t: TraceResult): boolean =>
  !t.hitNet && t.netY !== null && t.netY <= NET_HIT_Y - MARGIN;

// 给定 θ,二分出「前进距离」最接近需求的初速(前进距离随 speed 单调递增)
// boost:初速上限的临时余量(甜蜜点/完美击球专属)——踩得准才许突破 speedMax 打更凶的球
function bisectSpeed(x0: number, y0: number, dir: number, deg: number, targetX: number, boost = 0): { speed: number; short?: boolean; long?: boolean } {
  const rad = deg * U.D2R;
  const cx = Math.cos(rad), sy = Math.sin(rad);
  const want = (targetX - x0) * dir;                    // 需要朝对方前进多远
  if (want <= 6) return { speed: C.shot.speedMin, short: false };
  const rangeAt = (s: number) => (trace(x0, y0, dir * s * cx, -s * Math.sin(rad)).landX - x0) * dir;
  const lo0 = C.shot.speedMin, hi0 = C.shot.speedMax + (boost || 0);
  if (rangeAt(hi0) < want - 2) return { speed: hi0, short: true };   // 够不到 → 回球偏短
  if (rangeAt(lo0) > want) return { speed: lo0, long: true };        // 收不住 → 容易出界
  let lo = lo0, hi = hi0;
  for (let i = 0; i < C.shot.solveIters; i++) {
    const mid = (lo + hi) / 2;
    if (rangeAt(mid) < want) lo = mid; else hi = mid;
  }
  return { speed: (lo + hi) / 2, short: false };
}

// 一个角度下的候选解:按该角度反解初速(落点达标),再模拟这条弹道
interface AngleSolve { deg: number; speed: number; short: boolean; trace: TraceResult }

function solveAt(x0: number, y0: number, dir: number, deg: number, targetX: number, boost = 0): AngleSolve {
  const r = bisectSpeed(x0, y0, dir, deg, targetX, boost);
  const rad = deg * U.D2R;
  return { deg, speed: r.speed, short: !!r.short, trace: trace(x0, y0, dir * r.speed * Math.cos(rad), -r.speed * Math.sin(rad)) };
}

// 在「不安全角 bad」与「安全角 ok」之间二分,收敛到贴着 bad 那侧的最小改动安全角。
// bad 恒为靠 loft 的一端、ok 恒为安全的一端,所以抬高/压平两个方向共用这套更新规则。
function tighten(x0: number, y0: number, dir: number, bad: number, ok: number, targetX: number, boost: number): AngleSolve | null {
  let a = bad, b = ok;
  for (let i = 0; i < 6; i++) {
    const mid = (a + b) / 2;
    if (clears(solveAt(x0, y0, dir, mid, targetX, boost).trace)) b = mid; else a = mid;
  }
  const s = solveAt(x0, y0, dir, b, targetX, boost);
  return clears(s.trace) ? s : null;
}

/**
 * 找一个「安全过网」的出射角(网口余量 ≥ shot.netClearMargin)。
 * 先按模型 loft 试 —— 绝大多数球在这一步就出解,「高度 → 滞空」那张表照常说话。
 * 不通再沿角度网格往两头扫。旧实现假定 clears 随 θ 单调、直接二分,这个前提不成立:
 * 大角度顶到初速上限后反而够不到落点,小角度贴网太低,安全解常常夹在中间一段;
 * 于是整段可行解被判成 null,球被逼到「挑到最高认命下网」—— 擦网就是这么来的。
 * 抬高弧度的解优先(打不高就挑高,与旧行为一致),两头都没有才考虑压平。
 * @returns null = 这个落点怎么打都过不了网
 */
function safeAngle(x0: number, y0: number, dir: number, targetX: number, loft: number, boost = 0): AngleSolve | null {
  const S = C.shot;
  const first = solveAt(x0, y0, dir, loft, targetX, boost);
  if (clears(first.trace)) return first;
  const rungs = (up: boolean): number[] => {
    const out: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const d = loft + (up ? S.angleProbeDeg : -S.angleProbeDeg) * i;
      if (up && d >= S.loftMaxDeg) { out.push(S.loftMaxDeg); break; }
      if (!up && d <= S.loftMinDeg) { out.push(S.loftMinDeg); break; }
      out.push(d);
    }
    return out;
  };
  for (const up of [true, false]) {
    let bad = loft;
    for (const d of rungs(up)) {
      const s = solveAt(x0, y0, dir, d, targetX, boost);
      if (clears(s.trace)) return tighten(x0, y0, dir, bad, d, targetX, boost) || s;
      bad = d;
    }
  }
  return null;
}

// 满力也够不到落点时,能够到的最小出射角(射程在 45° 前随 θ 递增)
// boost 透传:这个下限按「初速上限」算可达包络,不透传会把甜蜜点/完美的压平夹回去
function minReachDeg(x0: number, y0: number, dir: number, targetX: number, boost = 0): number {
  const S = C.shot;
  const vMax = S.speedMax + (boost || 0);
  const want = (targetX - x0) * dir;
  const reachAt = (deg: number): number => {
    const rad = deg * U.D2R;
    return (trace(x0, y0, dir * vMax * Math.cos(rad), -vMax * Math.sin(rad)).landX - x0) * dir;
  };
  if (reachAt(S.loftMinDeg) >= want) return S.loftMinDeg;
  if (reachAt(45) < want) return 45;             // 怎么抬都够不到 → 取射程最大的角
  let lo = S.loftMinDeg, hi = 45;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (reachAt(mid) >= want) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * 解一发回球。甜蜜点靠"压平 θ"体现:同样落点需要更快的初速 → 球更凶、到得更早。
 * 出射角只在「模型 loft 不安全」时才被改动(safeAngle 抬弧度/压平),
 * 且改动量取离 loft 最近的安全解,所以「质量 → 滞空」的单调关系照常成立。
 * @param x0,y0   击球点
 * @param dir     出球方向(朝对方半场,±1)
 * @param depth   0=贴网短球 … 1=底线深球(>1 表示打出界)
 * @param loft    期望出射角(度,正=向上;负=下压)
 * @param boost   初速上限余量(px/step),默认 0;甜蜜点/完美击球用来兑换球速
 */
function solveShot(x0: number, y0: number, dir: number, depth: number, loft: number, boost = 0): SolveResult {
  const S = C.shot;
  const SPAN = S.farOffset - S.nearOffset;
  const targetOf = (d: number): number => CO.netX + dir * (S.nearOffset + d * SPAN);
  let d = depth, targetX = targetOf(d);
  let best = safeAngle(x0, y0, dir, targetX, loft, boost);
  // 这个落点根本没有安全解(例:后场低球要搓出贴网 22px = 物理禁手)。
  // 与其挑到最高认命下网,不如把落点一格一格往对方场内收,收到有解为止:
  // 代价是一拍更高更慢的过渡球,而不是一眼可预见的白送一分。
  for (let i = 0; !best && i < S.pullTargetTries && d < 1; i++) {
    d = Math.min(1, d + S.pullTargetDepth);
    targetX = targetOf(d);
    best = safeAngle(x0, y0, dir, targetX, loft, boost);
  }
  const floorReach = minReachDeg(x0, y0, dir, targetX, boost);

  let deg: number, speed: number, short: boolean;
  if (best) {
    deg = best.deg; speed = best.speed; short = best.short;
  } else {
    // 连收到最深都过不了网:球被压在网带以下,按可达下限挑最高,认命下网
    deg = U.clamp(Math.max(loft, floorReach), S.loftMinDeg, S.loftMaxDeg);
    const r = bisectSpeed(x0, y0, dir, deg, targetX, boost);
    speed = r.speed; short = !!r.short;
  }
  const rad = deg * U.D2R;
  const vx = dir * speed * Math.cos(rad);
  const vy = -speed * Math.sin(rad);
  const result: SolveResult = {
    vx, vy, speed, deg, trace: trace(x0, y0, vx, vy),
    targetX, short, depth: d,
    floorClear: best ? deg : null, floorReach,
    kind: "clear",
  };
  result.kind = classify(result, d, y0);
  return result;
}

// 击球点高度 → 基础弧度 θ(单调下降:越低的球被迫挑越高)
function baseLoft(contactH: number): number {
  const T = C.loftByHeight;
  if (contactH <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (contactH <= T[i][0]) {
      const [h0, a0] = T[i - 1], [h1, a1] = T[i];
      return U.lerp(a0, a1, U.inv(h0, h1, contactH));
    }
  }
  return T[T.length - 1][1];
}

// 瞄准深浅对弧度的修正:低位时不给压平(否则一定下网),高位时近网可下压
function aimLoft(depth: number, contactH: number): number {
  const [g0, g1] = C.aimLoftGate;
  const gate = U.inv(g0, g1, contactH);
  return (0.5 - depth) * C.aimLoftSwing * gate;
}

// 汇总:一次回球的出射角。甜蜜点压平(更凶),打偏自动抬高保过网。
function loftFor(depth: number, contactH: number, quality: number): number {
  const deg = baseLoft(contactH) + aimLoft(depth, contactH) - (quality - 0.5) * C.sweetLoftShift;
  return U.clamp(deg, C.shot.loftMinDeg, C.shot.loftMaxDeg);
}

// 给这一拍定性:渲染/音效/统计都按它来
function classify(shot: { deg: number; speed: number }, depth: number, y0: number): ShotKind {
  const h = CO.groundY - y0;               // 击球点高度
  if (shot.deg < 15 && h > 105 && shot.speed > 16) return "smash";
  if (shot.deg < 22 && h > 92) return "slash";
  if (shot.deg > 55) return "lob";
  // 落点贴网就是网前小球 —— 不再要求击球点低:轻击为了过网被抬到 30~50° 时,
  // 它依然是打在网前的小球,不该叫「高远球」(放网提示与 hit 音效都读这个标签)
  if (depth < 0.3) return "netshot";
  if (shot.deg < 28) return "drive";
  return "clear";
}

// ---------- 挥拍几何 ----------
// style: 'over'(高球下压,拍头由后上扫到前下) | 'under'(低球上挑)
const ARCS: Record<SwingStyle, { from: number; to: number }> = {
  over: { from: 142, to: -38 },
  under: { from: -34, to: 146 },
};

function swingTotal(): number {
  const s = C.swing;
  return s.windup + s.active + s.recover;
}

// 分段挥拍节奏:引拍缓起(二次缓入) → 发力窗内匀速爆发 → 随挥缓收(二次缓出)。
// 发力段斜率 m 由窗口端点解出,三段在拼接处速度连续(C1),不会有「挥到一半急停」的顿挫;
// 换掉原先整条 smoothstep 的匀速扫弧感,让引拍-发力-随挥的节奏一眼可读
function easeSwing(u: number): number {
  const [a, b] = C.swing.swingBurst;
  const m = 2 / (1 + b - a);
  const p1 = m * a / 2;                     // 引拍段走过的行程
  const p2 = 1 - m * (1 - b) / 2;           // 发力段结束时的行程
  if (u <= a) return p1 * (u / a) * (u / a);
  if (u >= b) { const s = (u - b) / (1 - b); return p2 + (1 - p2) * (1 - (1 - s) * (1 - s)); }
  return p1 + m * (u - a);
}

export interface SwingPose {
  ang: number; reach: number; u: number; from: number; to: number;
}

// 挥拍姿势:角度 + 呼吸半径。判定(racketHead)与渲染(sprites)共用这一个来源,
// 视觉拍头和扫掠判定永远重合,谁也不许再各自手搓 smoothstep
function swingPose(style: SwingStyle, elapsed: number, radius: number): SwingPose {
  const arc = ARCS[style] || ARCS.over;
  const u = U.clamp(elapsed / swingTotal(), 0, 1);
  return {
    ang: U.lerp(arc.from, arc.to, easeSwing(u)),
    reach: radius * (0.86 + 0.14 * Math.sin(u * Math.PI)),
    u, from: arc.from, to: arc.to,
  };
}

export interface RacketHead {
  x: number; y: number; ang: number; r: number; u: number;
}

// 拍头位置:elapsed 从挥拍第 0 帧起算
function racketHead(p: RacketLike, elapsed: number, radius: number): RacketHead {
  const s = C.swing;
  const pose = swingPose(p.swingStyle, elapsed, radius);
  const px = p.x, py = p.y + s.pivotY;
  return {
    x: px + p.facing * pose.reach * Math.cos(pose.ang * U.D2R),
    y: py - pose.reach * Math.sin(pose.ang * U.D2R),
    ang: pose.ang, r: pose.reach, u: pose.u,
  };
}

// 拍头半径:来球越快,允许越远的够球距离(手感补偿)
function reachRadius(ball: { vx: number; vy: number } | null | undefined): number {
  const sp = ball ? Math.hypot(ball.vx, ball.vy) : 0;
  return Math.min(C.swing.radiusMax, C.swing.radiusBase + sp * C.swing.radiusSpeedGain);
}

// 拍头扫掠角(渲染挥拍弧用)
function swingArc(style: SwingStyle): { from: number; to: number } {
  return ARCS[style] || ARCS.over;
}

export interface NetHit { y: number }

// 运行时:这一步球是否撞网(扫掠,快球不会穿网)
function checkNet(b: BallLike): NetHit | null {
  const yn = yAtNet(b.px, b.py, b.x, b.y);
  if (yn === null) return null;
  return yn > NET_HIT_Y ? { y: yn } : null;
}

export const Physics = {
  step, trace, solveShot, classify, checkNet,
  loftFor, baseLoft, aimLoft,
  racketHead, swingTotal, reachRadius, swingArc, swingPose,
  get gravity() { return G; },
  get netHitY() { return NET_HIT_Y; },
};
