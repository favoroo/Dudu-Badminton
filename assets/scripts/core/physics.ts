// ============================================================
// 羽毛球物理 + 弹道反解
// 思路:θ(出射角)控弧度→决定能不能过网;speed 控落点→决定深浅。
// 两者各自单调,所以用「θ 抬升 + speed 二分」两步求解,不用最小二乘。
// 单位:px / step(1 step = 1/60s)
//
// 球速档位:重力与速度上限**不读 config 原值**,读 core/pace.ts 的派生值
// (Pace.g = gravity·s²,Pace.vmax = maxSpeed·s,初速类走 Pace.shot)。
// 阻力系数 K 与 dragMin **刻意不缩放** —— 时间膨胀下 v² 阻力项形式不变,
// 乘了它落点会漂(实测 12.2px),那不是放慢而是换了颗球。推导见 pace.ts 头注释。
// ============================================================
import { CFG } from "./config";
import { Pace } from "./pace";
import { clamp, lerp, inv, D2R } from "./utils";
import { ShotKind, SwingStyle } from "./types";

const C = CFG;
const U = { clamp, lerp, inv, D2R };
// G/VMAX 已交给 Pace(档位可变);这里只留真正与档无关的量
const K = C.shuttle.dragK;
const DMIN = C.shuttle.dragMin;
const CO = C.court;
// 球有半径,网带的有效拦截线比视觉网顶略高
const NET_HIT_Y = CO.netTopY - C.shuttle.radius * 0.5;

export interface EnvModifier {
  windX: number;
  /** 风是否周期性变向。曾经这个开关住在 rules(就地改写 windX),
   *  于是 getEnvModifier() 读到的是瞬时值、关卡声明值反倒要靠字面量兜回来。
   *  现在 windX 恒为**基准幅度**,由 windAt(phase) 折出任一时刻的风,谁都能算同一句真话。 */
  windOscillate: boolean;
  gravityMul: number;
  dragMul: number;
  erratic: boolean;
  laserRail: boolean;
}

/**
 * 积分口径 —— 这个区分是整个环境机制能不能玩起来的关键,别顺手把它抹平:
 *
 * "truth"  认全部环境量(风、颤抖都算)。给**眼睛和拦截**用:落点圈、虚线弧、AI 接球。
 *          球真正会走的这条线,必须和画出来的这条线一字不差。
 * "aim"    只认重力/阻尼/磁轨,**故意不认侧风与颤抖**。给出球解算用。
 *          反解是「给定落点求初速」:让它去补偿风,每一拍就都精准落在瞄的地方 ——
 *          看着是修好了,其实把"看风下手的余地"整个解没了,机制当场归零。
 *          重力/阻尼/磁轨反过来要认:低重力该读成"球飘得更远、滞空更久"(手感),
 *          不该读成"每一拍都莫名其妙出界"(bug);磁轨是纯几何确定量,认它才打得出电浆炮。
 */
export type IntegrateIntent = "truth" | "aim";

let activeModifier: EnvModifier | null = null;
// 环境相位的**唯一**时钟。只有 tickEnv 能推进,而只有 Rules.step 调 tickEnv。
// 曾经的坑:predictPath/flightFramesTo 这些"给 UI 前瞻用"的循环也在调 step,于是
// 渲染每帧把时钟白推上百步 —— 颤抖的相位被吹成伪随机,看着像"飘忽不定",
// 实际既不可预测也不可复现,连回归都写不出断言。时钟归一之后抖成什么样是算得出的。
let envTick = 0;

export function setEnvModifier(mod: EnvModifier | null): void {
  activeModifier = mod;
  envTick = 0;
}

export function getEnvModifier(): EnvModifier | null {
  return activeModifier;
}

/** 推进环境时钟。整个仓库只有 rules 的主循环该调它。 */
export function tickEnv(n = 1): void { envTick += n; }

/** 读当前环境相位(步) */
export function envPhase(): number { return envTick; }

/** 某一时刻的风(px/步²,带符号:+X 方向)。传 envPhase()+k 就是"k 步之后的风" —— 可预判的全部根据。 */
export function windAt(phase: number): number {
  const m = activeModifier;
  if (!m || m.windX === 0) return 0;
  return m.windOscillate ? Math.sin(phase * C.env.windOscRate) * m.windX : m.windX;
}

/** 阵风通报的监视状态(住在 rules,因为只有它推进环境时钟;physics 只负责算) */
export interface GustWatch {
  /** 门槛已连续满足的步数 */
  hold: number;
  /** 报完一次之后还要闭嘴多少步 */
  cool: number;
  /** 上一次报出去的风向(同一个方向不重复报) */
  lastDir: number;
}

export function freshGustWatch(): GustWatch { return { hold: 0, cool: 0, lastDir: 0 }; }

/**
 * 每步喂一次:这一帧该不该报「起风了」。就地改写 w、只回一个数 —— 这条每步都跑,
 * 分配对象就是每帧垃圾(与 world.ts 把颜色常量提到模块级同一条理由)。
 *
 * 为什么要有这件事:震荡风每 ~6.5s 换一次方向(半个来回),而玩家的眼睛在对球和人物,不会盯着
 * 角落那根 22px 高的针。方向翻掉的那一瞬间,由一次斩劈横幅替他把注意力拉回来 ——
 * 用户原话「吹风方向的提示不太明显」,缺的不是读数,是**变化发生时的通知**。
 *
 * 判据三段,缺一都会出问题:
 *   · 强度 ≥ windGustAt(满量程的比例)—— 刚过零点那种"往哪边都不倒"的时刻不报,报了是噪声;
 *   · 连续 windGustFrames 步 —— 防单帧毛刺把横幅打成闪烁;
 *   · 方向与上次不同 + cooldown 闭嘴 —— 一个半周期正好一句话,不会刷屏。
 * @returns 0 = 不报;±1 = 报一次,符号 = 风吹向的方向(+1 朝对方底线 = 玩家这一拍顺风)
 */
export function gustWatch(w: GustWatch, phase: number): number {
  const E = C.env;
  const m = activeModifier;
  if (!m || m.windX === 0) { w.hold = 0; if (w.cool > 0) w.cool--; return 0; }
  const full = E.windFullScale || 1;
  const v = windAt(phase);
  const dir = v > 0 ? 1 : v < 0 ? -1 : 0;
  if (w.cool > 0) w.cool--;
  w.hold = Math.abs(v) / full >= E.windGustAt ? w.hold + 1 : 0;
  if (w.hold >= E.windGustFrames && w.cool === 0 && dir !== 0 && dir !== w.lastDir) {
    w.hold = 0;
    w.cool = E.windGustCooldown;
    w.lastDir = dir;
    return dir;
  }
  return 0;
}

// 单步阻尼因子(纯函数:球壳与 AI 的球路预测共用,免得改一次手感要同步两处)
function dragOf(sp: number): number {
  const dragMul = activeModifier ? activeModifier.dragMul : 1;
  return Math.max(DMIN, 1 - K * Math.min(sp, Pace.vmax) * dragMul);
}

const gravMul = (): number => (activeModifier ? activeModifier.gravityMul : 1);

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
  /** vx/vy/speed 是**世界单位**(当前档位下的每帧位移);kind 按基准速度定性,与档无关 */
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
  const vmax = Pace.vmax;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > vmax) { const s = vmax / sp; b.vx *= s; b.vy *= s; }
  return Math.min(sp, vmax);
}

// 单步积分(二次阻力:快球急停、慢球下坠,接近真实羽毛球)
// 重力走 Pace.g(球速档位),阻尼走 dragOf —— 与 trace/AI 预测同一条式子
// **全仓库只有这一份积分实现**:trace/predictPath/future 全是它的包装。
// 曾经四处各抄一份循环、口径还不一样(风与重力有人认有人不认),结果就是
// 「在 A 点画落点圈、把球打到 B 点」—— 改一次手感要同步四处的老账。
function integrate(b: BallLike, intent: IntegrateIntent, phase: number): void {
  b.px = b.x; b.py = b.y;
  const E = C.env;
  const sp = capSpeed(b);
  const d = dragOf(sp);
  b.vx *= d;
  b.vy *= d;
  b.vy += Pace.g * gravMul();

  const m = activeModifier;
  if (!m) { b.x += b.vx; b.y += b.vy; return; }

  if (intent === "truth") {
    b.vx += windAt(phase);
    if (m.erratic && sp > E.erratic.speedGate) {
      // 下降段抖得更凶:球尾失速那一坠才是要玩家留容错的,拍着胸口说"随机急坠"却
      // 实现成等幅正弦,文案就是在骗人。
      const ramp = b.vy > 0 ? E.erratic.descRamp : 1;
      b.vy += Math.sin(phase * E.erratic.freqY) * E.erratic.ampY * ramp;
      b.vx += Math.cos(phase * E.erratic.freqX) * E.erratic.ampX;
    }
  }
  // 磁轨两个口径都认(几何确定量,认它才打得出"贴网电浆炮";不认则每拍贴网球都变出其不意的出界)
  // ⚠ 判带必须在**位置更新之后**:从前这段写在 b.x += b.vx 之前,而步首刚做过
  //   b.px = b.x,于是 crossedNet 拿两个相等的数比"有没有越过网面" —— 恒假,
  //   「1.75 倍速电浆重炮」从上线那天起一次都没触发过(不是没画,是根本没生效)。
  //   高度也改成按穿越点的插值 y 判带,而不是"这一步开始时球在哪"。
  b.x += b.vx;
  b.y += b.vy;

  if (m.laserRail) {
    const yn = yAtNet(b.px, b.py, b.x, b.y);
    if (yn !== null && yn >= CO.netTopY - E.laser.above && yn <= CO.netTopY + E.laser.below) {
      b.vx *= E.laser.speedMul;
      b.vy *= E.laser.vyMul;
      if ("laserBoosted" in b) {
        (b as { laserBoosted?: boolean }).laserBoosted = true;
      }
    }
  }
}

/** 推进真实球。默认 truth;phase 默认取当前环境时钟,前瞻类自己传。 */
export function step(b: BallLike, intent: IntegrateIntent = "truth", phase: number = envPhase()): void {
  integrate(b, intent, phase);
}

// 线段与球网平面的交点 y;未过网返回 null
function yAtNet(px: number, py: number, x: number, y: number): number | null {
  if (x === px) return null;
  const t = (CO.netX - px) / (x - px);
  if (t <= 0 || t > 1) return null;
  return py + (y - py) * t;
}

// 无头模拟:给定初速,看它落在哪 / 是否下网
// **不再自己抄一份循环** —— 与真实球共用 integrate(),否则改一次手感要同步两处,
// 而"落点圈画在 A、球打到 B"就是这么来的。
// 默认 intent="aim"(不补偿侧风与颤抖):反解要的是"我想打哪儿",让它去补风就等于
// 把风这个机制解没了。想看真相传 "truth"。
const tscratch: BallLike = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };

function trace(
  x0: number, y0: number, vx: number, vy: number, maxSteps = 260,
  intent: IntegrateIntent = "aim", phase0: number = envPhase(),
): TraceResult {
  const s = tscratch;
  s.x = x0; s.y = y0; s.px = x0; s.py = y0; s.vx = vx; s.vy = vy;
  let apex = y0;
  let netY: number | null = null;
  const hit = (): boolean => netY !== null && netY > NET_HIT_Y;
  for (let i = 1; i <= maxSteps; i++) {
    integrate(s, intent, phase0 + i);
    if (s.y < apex) apex = s.y;
    const yn = yAtNet(s.px, s.py, s.x, s.y);
    if (yn !== null && netY === null) netY = yn;
    if (s.y >= CO.groundY - 2) {
      return { landX: s.x, landY: CO.groundY - 2, steps: i, apex, netY, lvx: s.vx, lvy: s.vy, hitNet: hit() };
    }
    if (s.x < -80 || s.x > C.world.w + 80) {
      return { landX: s.x, landY: s.y, steps: i, apex, netY, lvx: s.vx, lvy: s.vy, hitNet: hit() };
    }
  }
  return { landX: s.x, landY: s.y, steps: maxSteps, apex, netY, lvx: s.vx, lvy: s.vy, hitNet: hit() };
}

/** predictPath 复用的单步状态(模块级,避免每帧造对象;非重入 —— 内部只调 integrate) */
const scratch: BallLike = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };
/** future 复用的单步状态(同上;与 predictPath 不会互相嵌套) */
const fscratch: BallLike = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };

/**
 * 前瞻积分:从给定的运动学状态起,按**同一个 integrate(truth)** 往前推最多 maxSteps 帧,
 * 或直到落地 / 撞网为止。落点与撞网判据与 trace() 一字不差,所以「预测的这条弧」
 * 就是球真正会走的那条 —— 渲染层不许再自己抄一份积分,否则改一次手感就要同步两处。
 * 点写进调用方持有的 out(x,y 交替,世界坐标;含起点),返回写入的点数。
 * 零 GC:缓冲由调用方(每帧复用同一块)持有。
 *
 * 相位**本地推进、绝不回写环境时钟**:这个函数每渲染帧可能被调用上百步,从前它调的
 * 正是带 envTick++ 的 step(),于是"颤抖球"的相位被前瞻吹成伪随机 —— 看着飘忽,实则
 * 既不可预测也不可复现。前瞻只读时钟,推进它的是 rules。
 * @param outEnd 可选,长度 ≥1 的 Int8Array:0=落地 1=撞网 2=飞出海侧 3=被前瞻/缓冲截断(未知)
 */
function predictPath(
  x0: number, y0: number, vx0: number, vy0: number, maxSteps: number,
  out: Float32Array, outEnd?: Int8Array,
): number {
  const s = scratch;
  s.x = x0; s.y = y0; s.px = x0; s.py = y0; s.vx = vx0; s.vy = vy0;
  const phase0 = envPhase();
  let n = 0;
  let end = 3;
  out[n * 2] = x0; out[n * 2 + 1] = y0; n++;
  const cap = (out.length >> 1) - 1;
  for (let i = 0; i < maxSteps && n <= cap; i++) {
    integrate(s, "truth", phase0 + i + 1);
    const yn = yAtNet(s.px, s.py, s.x, s.y);
    if (yn !== null && yn > NET_HIT_Y) {           // 撞网:线停在网面上,不许画穿过去
      out[n * 2] = CO.netX; out[n * 2 + 1] = yn; n++;
      end = 1; break;
    }
    if (s.y >= CO.groundY - 2) {                   // 落地:停在触地点(与 trace 同一条判据)
      out[n * 2] = s.x; out[n * 2 + 1] = CO.groundY - 2; n++;
      end = 0; break;
    }
    if (s.x < -80 || s.x > C.world.w + 80) { end = 2; break; }  // 飞出世界边界
    out[n * 2] = s.x; out[n * 2 + 1] = s.y; n++;
  }
  if (outEnd) outEnd[0] = end;
  return n;
}

/**
 * 前瞻要跑多少帧才够看到落点。低重力关的弧长随 1/√g 变滞空 ——
 * 写死一个帧数会在反重力关**静默截断**(弧画到一半就没落点圈了),所以按档位算。
 */
function pathStepsFor(env: EnvModifier | null, base = C.landing.pathHorizon): number {
  const g = env ? Math.max(0.05, env.gravityMul) : 1;
  return Math.min(C.landing.pathHorizonMax, Math.ceil(base / Math.sqrt(g)));
}

/**
 * 把球往前推 n 步(不改原对象)。AI 的接球截面与提前量都读它。
 * 从前这份住在 ai.ts 里自己抄了一遍循环、且不认环境与速度封顶,于是 AI 在风关
 * 和低重力关是" aiming blind "地跑位。**口径给 truth**:接别人的球必须按真弧来,
 * 风是"打"的技巧、不该变成"接"的运气;出球解算照旧走 aim,玩家与 AI 一样被风吹偏。
 */
function future(b: BallLike, n: number, intent: IntegrateIntent = "truth"): { x: number; y: number; vx: number; vy: number }[] {
  const out: FuturePt[] = [];
  futureInto(b, n, out, intent);
  return out;
}

/** future 的复用点型:见 futureInto */
export interface FuturePt { x: number; y: number; vx: number; vy: number }

/**
 * future 的零 GC 版:点写进**调用方持有**的 out(每帧复用同一块),返回该缓冲。
 * 点对象按需增长、原地改写,超出 n 的旧点截断。AI 每模拟步都要前瞻两三回,
 * 旧版每回 new 一个数组 + n 个点(~340 对象/步/AI),是周期性 GC 尖峰的主源。
 */
function futureInto(b: BallLike, n: number, out: FuturePt[], intent: IntegrateIntent = "truth"): FuturePt[] {
  const s = fscratch;
  s.x = b.x; s.y = b.y; s.px = b.x; s.py = b.y; s.vx = b.vx; s.vy = b.vy;
  const phase0 = envPhase();
  for (let i = 0; i < n; i++) {
    integrate(s, intent, phase0 + i + 1);
    let p = out[i];
    if (p === undefined) { p = { x: 0, y: 0, vx: 0, vy: 0 }; out[i] = p; }
    p.x = s.x; p.y = s.y; p.vx = s.vx; p.vy = s.vy;
  }
  if (out.length > n) out.length = n;
  return out;
}

// 「能过网」不能只看是否撞上球网:二分解出的是**临界角**,不夹余量就正好贴着网带擦过去,
// 这就是轻击容易擦网的原因(实测 39% 的短球过网余量 <5px,球头已经在视觉上蹭到网带)。// 所以安全解要求球心比网带高出一个余量;netY 为空(球没越过网平面就落地)也一律算没过网。
const MARGIN = C.shot.netClearMargin;
const clears = (t: TraceResult): boolean =>
  !t.hitNet && t.netY !== null && t.netY <= NET_HIT_Y - MARGIN;

// 给定 θ,二分出「前进距离」最接近需求的初速(前进距离随 speed 单调递增)
// boost:初速上限的临时余量(甜蜜点/完美击球专属)——踩得准才许突破 speedMax 打更凶的球
// 入参与返回都是**世界单位**(每帧位移):speedMax/speedMin 在这里经 Pace.shot 折档,
// boost 由 solveShot 入口一次性折好透传下来,所以这一层不再乘第二次。
function bisectSpeed(x0: number, y0: number, dir: number, deg: number, targetX: number, boost = 0): { speed: number; short?: boolean; long?: boolean } {
  const rad = deg * U.D2R;
  const cx = Math.cos(rad), sy = Math.sin(rad);
  const want = (targetX - x0) * dir;                    // 需要朝对方前进多远
  const lo0 = Pace.shot(C.shot.speedMin);
  if (want <= 6) return { speed: lo0, short: false };
  const rangeAt = (s: number) => (trace(x0, y0, dir * s * cx, -s * Math.sin(rad)).landX - x0) * dir;
  const hi0 = Pace.shot(C.shot.speedMax) + (boost || 0);
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
  const vMax = Pace.shot(S.speedMax) + (boost || 0);   // boost 已是世界单位(solveShot 入口折过)
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
 * @param boost   初速上限余量(**基准单位** px/step @ s=1),默认 0;甜蜜点/完美击球用来兑换球速
 */
function solveShot(x0: number, y0: number, dir: number, depth: number, loft: number, boost = 0): SolveResult {
  const S = C.shot;
  // 档位的**唯一折算点**:调用方(player/训练场喂球机)一律按基准单位报 boost,
  // 这里折成世界单位往下传;bisectSpeed/minReachDeg 收到的已经是世界单位,不再乘。
  // 把转换收在physics边界上,player 那条「sweet/perfect/heat/lunge 加成 + 封顶
  // maxSpeed-speedMax」的预算链就一行都不用改。
  const B = Pace.shot(boost || 0);
  const SPAN = S.farOffset - S.nearOffset;
  const targetOf = (d: number): number => CO.netX + dir * (S.nearOffset + d * SPAN);
  let d = depth, targetX = targetOf(d);
  let best = safeAngle(x0, y0, dir, targetX, loft, B);
  // 这个落点根本没有安全解(例:后场低球要搓出贴网 22px = 物理禁手)。
  // 与其挑到最高认命下网,不如把落点一格一格往对方场内收,收到有解为止:
  // 代价是一拍更高更慢的过渡球,而不是一眼可预见的白送一分。
  for (let i = 0; !best && i < S.pullTargetTries && d < 1; i++) {
    d = Math.min(1, d + S.pullTargetDepth);
    targetX = targetOf(d);
    best = safeAngle(x0, y0, dir, targetX, loft, B);
  }
  const floorReach = minReachDeg(x0, y0, dir, targetX, B);

  let deg: number, speed: number, short: boolean;
  if (best) {
    deg = best.deg; speed = best.speed; short = best.short;
  } else {
    // 连收到最深都过不了网:球被压在网带以下,按可达下限挑最高,认命下网
    deg = U.clamp(Math.max(loft, floorReach), S.loftMinDeg, S.loftMaxDeg);
    const r = bisectSpeed(x0, y0, dir, deg, targetX, B);
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
  result.kind = classify(result, d, y0, x0);
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
// 速度阈值比的是**基准速度**(Pace.ref 折回 s=1):否则慢档里同一记重杀会被念成「劈吊」,
// 飘字、hit 音效、丝带档位、生涯每杀奖励全跟着档漂 —— 标签该只说「这打得多狠」,
// 不该说「此刻球速档位是几」。角度/高度是纯几何量,不折。
function classify(shot: { deg: number; speed: number }, depth: number, y0: number, x0?: number): ShotKind {
  const SC = C.shotClass;
  const h = CO.groundY - y0;               // 击球点高度
  const v = Pace.ref(shot.speed);          // 世界速度 → 基准速度
  if (shot.deg < SC.smashDeg && h > SC.smashH && v > SC.smashSpeed) return "smash";
  if (shot.deg > SC.lobDeg) return "lob";
  // 离网距离 > 前发球线至网距离(108px)为中后场。中后场高位(h > slashH)下切到前场 = 点杀/劈吊(slash)
  // 低出射角(deg < slashDeg)下切(如中场平抽下切/网前扑杀)亦属此类
  const isBackcourt = x0 != null ? Math.abs(x0 - CO.netX) > (CO.netX - CO.shortServeL) : false;
  if (h > SC.slashH && (shot.deg < SC.slashDeg || (isBackcourt && depth < SC.netDepth))) return "slash";
  // 网前轻放贴网(或低位放网) = 网前小球/搓放(netshot)
  if (depth < SC.netDepth) return "netshot";
  if (shot.deg < SC.driveDeg) return "drive";
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
// **故意读世界速度、不做档位折算**:慢档里 sp 自己就变小,判定区随之放宽
// (strikeZone 那条「快球收紧」也一样自动放宽)。具体放宽多少由
// tools/reach-check.ts 第②段实测钉住,别在这里写死数字 —— 那是会过期的。
// 折回基准单位的话,「慢档更好接」这一条就白做了。
function reachRadius(ball: { vx: number; vy: number } | null | undefined): number {
  const sp = ball ? Math.hypot(ball.vx, ball.vy) : 0;
  return Math.min(C.swing.radiusMax, C.swing.radiusBase + sp * C.swing.radiusSpeedGain);
}

/**
 * 判定区圆心相对脚底的偏移(px):player.strikeZone 与 core/skills 的闪现站位反解**共用这一条**。
 * 抽出来的理由很实在 —— 闪现要把球"摆进圆心"就得知道圆心在哪,抄第二份式子早晚会有一处
 * 跟判定跑偏(旧闪现正是这么漏球的:人闪到球上方,球落在圆心下方 ~88px,半径只有 ~80)。
 * @param radius   挥拍半径(Physics.reachRadius 的产物,快球更大)
 * @param reachDir 够球方向(跨步时 = 跨步方向,否则 = 面向)
 * @param lungeMul 跨步判定区放大倍率(只乘 dx,与 strikeZone 一致)
 */
function strikeOffset(radius: number, reachDir: number, lungeMul = 1): { dx: number; dy: number } {
  return { dx: reachDir * radius * 0.34 * lungeMul, dy: C.swing.pivotY - radius * 0.06 };
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

/**
 * 预测:球按真实单步积分(重力 + 二次阻力)再飞多少帧后,首次进入以 (tx,ty) 为心、
 * r 为半径的圆;horizon 帧内到不了(出界/落地)返回 null。
 * 拷贝入参积分,绝不改原球 —— 只供 UI 做「按拍预告」,不参与任何判定。
 */
/** 按拍预告共用的积分暂存球:这两个前瞻每渲染帧都会跑,逐帧 new BallLike 是纯 GC 粮。
 *  只在函数体内消费、不外泄引用,复用安全(与 world.ts ballView 同一手法)。 */
const cueBallScratch: BallLike = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };

export function flightFramesTo(ball: BallLike, tx: number, ty: number, r: number, horizon: number): number | null {
  const b = cueBallScratch;
  b.x = ball.x; b.y = ball.y; b.px = ball.px; b.py = ball.py; b.vx = ball.vx; b.vy = ball.vy;
  const r2 = r * r;
  const phase0 = envPhase();
  for (let i = 0; i <= horizon; i++) {
    const dx = b.x - tx, dy = b.y - ty;
    if (dx * dx + dy * dy <= r2) return i;
    integrate(b, "truth", phase0 + i + 1);    // 本地推相位:UI 前瞻不许拨环境时钟
  }
  return null;
}

/**
 * 预测:球按真实单步积分再飞多少帧后到达「离 (tx,ty) 最近」的那一帧(最近逼近帧)。
 * 与 flightFramesTo 的「首次进入圆环」不同:路径不穿过圆心也能给出稳定读数 ——
 * 玩家有走位误差,坠落轨迹距判定区心差十几 px 是常态,小圆锚环会要求路径精确穿心,
 * fc 恒为 null(预告整个失联)。closestDist 参数当门槛:最近逼近仍超出判定区半径
 * (根本够不到的球)返回 null,不给预告。只读不写,纯 UI 前瞻。
 */
export function flightFramesToClosest(ball: BallLike, tx: number, ty: number, closestDist: number, horizon: number): number | null {
  const b = cueBallScratch;
  b.x = ball.x; b.y = ball.y; b.px = ball.px; b.py = ball.py; b.vx = ball.vx; b.vy = ball.vy;
  const cap2 = closestDist * closestDist;
  let bestD2 = Infinity;
  let bestI: number | null = null;
  const phase0 = envPhase();
  for (let i = 0; i <= horizon; i++) {
    const dx = b.x - tx, dy = b.y - ty;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    integrate(b, "truth", phase0 + i + 1);    // 本地推相位:UI 前瞻不许拨环境时钟
  }
  return bestD2 <= cap2 ? bestI : null;
}

export const Physics = {
  step, trace, solveShot, classify, checkNet, predictPath, future, futureInto, pathStepsFor,
  loftFor, baseLoft, aimLoft,
  racketHead, swingTotal, reachRadius, strikeOffset, swingArc, swingPose,
  setEnvModifier, getEnvModifier,
  /** 环境相位时钟:只有 rules 的主循环能推进(tickEnv),其余一律只读 */
  tickEnv, envPhase,
  /** 某一时刻的风(px/步²,带符号)。传 envPhase()+k 就是 k 步之后的风 —— 风向标的预读针。 */
  windAt,
  /** 阵风通报判据(纯函数;状态归 rules 持有,因为它才是环境时钟的主人) */
  gustWatch, freshGustWatch,
  // drag 已从公开面上摘掉:唯一用户是 AI 自己抄的那份积分,现已统一进 future(truth)。
  // 留个口子就会有第五份循环,而四份循环口径不一致正是"落点圈骗人"的根因。
  get gravity() { return Pace.g; },
  get netHitY() { return NET_HIT_Y; },
};
