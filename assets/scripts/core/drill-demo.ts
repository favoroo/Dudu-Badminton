// ============================================================
// 训练场引导的**真值烘焙**:演示里那颗球怎么飞、在哪儿接到、回球落在哪 ——
// 全部由实机同一条喂球机节拍 + 同一条判据算出来,不再手画抛物线。
//
// 为什么要这个模块 —— 引导动画原来自己编了一套弹道:
//   · 来球是 render/drill-anim 的 `idealInPath` 画的一条**假抛物线**,每关硬写一个
//     arcLift(60/105/70/42/35),和 core/drill.ts 的 feederInput 真喂出来的弧线不是
//     一回事 —— 玩家照着假弧线做动作,球根本不来到那儿;
//   · 回球用随手取的 q=0.72 与演示专用的 contactX/demoH 起算,**从没穿过
//     Drill.matches 这道门** —— 演示里飞出去那一拍,游戏里可能不算有效拍。
// 于是「教的」和「判的」是两套东西,躺在同一个仓库里互相看不见。
//
// 现在只有一份:喂球复现自 tools/drill-check.ts(那份标定脚本已经验证过与 rules 的
// 持球释放一致),接触点与回球再按**真实判据**搜出来 —— 烘焙产物天生是一记合格拍,
// 由 tools/drill-diagram-check.ts 逐关钉住。drill-check 反过来 import 这里,
// 重复的那 ~110 行随之消失(两份复现早晚跑偏,当年 serveDelay 就是这么错的)。
//
// 依赖纪律:**零 cc** —— render/drill-anim 只消费这里的数字负责画(render 只画不算),
// 而本模块可以在 node 下直接回归。
// 帧口径:Pace 的时间膨胀只改帧不改空间(core/pace.ts),matches 里又已把帧折回基准
// (drill.ts 的 baseSteps),所以一份烘焙产物跨球速档位都成立。
// ============================================================
import { CFG } from "./config";
import { Physics } from "./physics";
import type { SolveResult } from "./physics";
import { Player as Pl } from "./player";
import { Drill } from "./drill";
import type { DrillEndFact } from "./drill";
import { clamp } from "./utils";
import type { Ball, DrillDef, Player } from "./types";

const C = CFG;
const CO = C.court, SW = C.swing;

/** 出射角夹回物理允许带 —— 与 player.buildShot 同一个 clamp 口径 */
const clampLoft = (deg: number): number => clamp(deg, C.shot.loftMinDeg, C.shot.loftMaxDeg);

// ============================================================
// ① 喂球机复现:rules.step 里 ball.held 那一段
// ============================================================
// 持球点贴手(handX = p.x + facing*24,handY = p.y - h*0.46),挥拍进窗那一帧释放。
// 「第几帧出球」因此直接决定喂球的高度 —— 这就是每个关卡 feed.jumpLead 的含义。
//
// ⚠ 释放条件用 `k >= 1 + jumpLead` 而不是 `===`:与 core/drill.ts 的 feederInput 同源
//   (那边注释说明连续给是安全的,因为 Player 挥拍中会自己忽略重复 aim,而万一某拍没放球,
//    下一拍马上补 —— 不会卡成抱球不动)。本模块曾经抄成 `===`,两份复现就此差一帧。

/** 释放那一帧的手上事实 */
export interface Released { x: number; y: number; h: number; frame: number }
/** 释放后逐模拟帧采到的一个世界点(y 为 canvas 惯例、地面以下为正) */
export interface SimPoint { x: number; y: number; h: number; speed: number; frame: number }
/** 来球弧线上「玩家够得着」的那些点 */
export interface ContactPoint extends SimPoint { needJump: boolean }
/** 一次完整喂球:释放点 + 出射解 + 真实飞行轨迹 + 可达接触点 */
export interface Feed {
  released: Released;
  shot: SolveResult;
  pts: SimPoint[];
  contacts: ContactPoint[];
}

const handX = (p: { x: number; facing: number }): number => p.x + p.facing * 24;
const handY = (p: { x: number; y: number }): number => p.y - C.player.h * 0.46;

function makeLoneBall(owner: Player): Ball {
  return {
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    live: false, held: true, owner,
    lastHitter: "right", crossed: false, netted: false, shot: null,
    sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  };
}

/**
 * 判定区半径(站立、不跨步、无鞋类修正)。与 player.strikeZone 同式,只是不吃
 * `activePlayerModifier` 那个**局内状态** —— 引导页可能在任何时刻打开,读数不能跟着上一局跑。
 */
function zoneRadius(rad: number, speed: number): number {
  const fast = Math.min(1, Math.max(0, (speed - SW.zoneFullSpeed) / SW.zoneTightenSpan));
  return (rad * 0.92 + SW.headR) * (1 - fast * (1 - SW.zoneFastMul));
}

/**
 * 站立时能够到的最高点(离地)。用 Physics.reachRadius 而不是抄公式:
 * 它读的是 |v|,所以喂一个 (speed, 0) 进去就是「这个球速下的挥拍半径」。
 */
function standingTop(speed: number): number {
  const rad = Physics.reachRadius({ vx: speed, vy: 0 });
  return -SW.pivotY + rad * 0.06 + zoneRadius(rad, speed);
}

/**
 * 跳起额外够到的高度 = 跳跃递推的最高点。
 * 与 Player.update 同一条递推(jumpV 起、每步加 gravity),所以「跳到顶还剩多少」是引擎真值,
 * 不是标出来的。旧版这里改成「跑一次喂球模拟看手在第几帧多高」,结果本模块的 APEX 初始化
 * 反过来要用到 simulateFeed 的可达筛选 —— 两个常量互相引用,JS 的 TDZ 直接抛错。
 * 递推是纯函数,没有这个循环。
 */
function jumpApexH(): number {
  let vy = C.player.jumpV, y = 0, best = 0;
  for (let k = 0; k < 120; k++) {
    vy += C.player.gravity; y += vy;
    if (-y > best) best = -y;
    if (y > 0) break;
  }
  return best;
}
const APEX: number = jumpApexH();

/**
 * 忠实复现一记喂球,并把释放后的真实飞行逐帧采下来。
 * @returns null = 这一组喂球参数下网了(标定网格里的正常情况)
 */
export function simulateFeed(depth: number, jumpLead: number): Feed | null {
  const feeder = Pl.create("right", { isAI: true });
  const ball = makeLoneBall(feeder);
  let t = 0;
  let released: Released | null = null;
  let guard = 0;

  while (guard++ < 600 && !released) {
    t++;
    const inp = {
      left: false, right: false, jumpPressed: false, jumpHeld: false,
      swingAim: null as string | number | null, lungePressed: false,
    };
    const dx = feeder.homeX - feeder.x;
    if (Math.abs(dx) > 8) {
      inp.left = dx < 0; inp.right = dx > 0;
    } else if (t > C.drill.settle) {
      const k = t - C.drill.settle;
      if (jumpLead > 0) {
        if (k === 1) { inp.jumpPressed = true; inp.jumpHeld = true; }
        else if (k < 1 + C.player.jumpApex) inp.jumpHeld = true;
        if (k >= 1 + jumpLead) inp.swingAim = depth;
      } else if (k >= 2) inp.swingAim = depth;
    }
    Pl.update(feeder, inp, ball);
    ball.x = handX(feeder); ball.y = handY(feeder);
    // rules.step 的释放窗口
    if (feeder.swingT >= SW.windup && feeder.swingT <= SW.windup + 2) {
      released = { x: ball.x, y: ball.y, h: CO.groundY - ball.y, frame: t };
    }
  }
  if (!released) return null;

  // 与 Player.buildShot 同一套公式(rules 发球固定 q=0.8、无甜蜜/完美),
  // 但不掺落点误差:误差只把落点推 ±8% 深度,不改变「够得着的接触点是什么形状」
  const loft = clampLoft(Physics.loftFor(depth, released.h, 0.8));
  const shot = Physics.solveShot(released.x, released.y, -1, depth, loft, 0);
  if (shot.trace.hitNet) return null;

  // 逐帧 step:一次遍历同时产出「画出来的一整条弧」与「够得着的接触点」
  const b: Ball = {
    x: released.x, y: released.y, px: released.x, py: released.y,
    vx: shot.vx, vy: shot.vy, held: false, live: true,
    owner: null, lastHitter: "right", crossed: false, netted: false, shot: null,
    sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  };
  const pts: SimPoint[] = [{ x: b.x, y: b.y, h: CO.groundY - b.y, speed: Math.hypot(b.vx, b.vy), frame: 0 }];
  const contacts: ContactPoint[] = [];
  for (let i = 0; i < 320; i++) {
    Physics.step(b);
    const speed = Math.hypot(b.vx, b.vy);
    pts.push({ x: b.x, y: b.y, h: CO.groundY - b.y, speed, frame: i + 1 });
    if (b.x < CO.wallL || b.y >= CO.groundY - 2) break;
    if (b.x >= CO.netX) continue;
    const h = CO.groundY - b.y;
    if (h < 8) continue;
    const top = standingTop(speed);
    // 够不着的不算接触点:站立上限之上最多再加一个跳跃顶点的高度(与 drill-check 同一条尺)。
    // 漏掉这一条,preferHigh 会把教学接触点挑到弧线最高的那帧 —— 判据可能还过(它只看球),
    // 但人根本跳不到那儿,于是第②步的站位与「起跳才够到」全成了假的(检查④就是抓这个)。
    if (h > top + APEX) continue;
    contacts.push({ x: b.x, y: b.y, h, speed, frame: i + 1, needJump: h > top });
  }
  return { released, shot, pts, contacts };
}

/** 跳起额外够到的高度(标定脚本打印这个读数;搜法本身在 APEX 里已经用上了) */
export const apexReach = (): number => APEX;

// ============================================================
// ② 接触点 → 这一拍:与 rules 抛给 Drill.onEnd 的那份事实同源
// ============================================================

/** 命中窗质量阶梯(与标定脚本同一份:从「勉强」到「完美」) */
export const QS: number[] = [0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1.0];

export function shotAt(pt: { x: number; y: number }, aim: number, q: number): SolveResult {
  const sweet = q >= 1 - C.sweet.coreRatio;
  const perfect = q >= 1 - C.perfect.coreRatio;
  const powerDeg = perfect ? C.perfect.powerDeg : sweet ? C.sweet.powerDeg : 0;
  const loft = clampLoft(Physics.loftFor(aim, CO.groundY - pt.y, q) - powerDeg);
  const boost = perfect ? C.shot.perfectBoost : sweet ? C.shot.sweetBoost : 0;
  const s = Physics.solveShot(pt.x, pt.y, 1, aim, loft, boost);
  s.sweet = sweet; s.perfect = perfect;
  return s;
}

/** 把「这一拍」还原成 rules 训练分支会抛给 Drill 的那份事实 */
function eventAt(pt: ContactPoint, s: SolveResult, q: number): DrillEndFact {
  return {
    lastHitter: "left", crossed: true, netted: false, scorer: "left",
    kind: s.kind, q, sweet: !!s.sweet, perfect: !!s.perfect,
    shot: { depth: s.depth, landX: s.trace.landX, steps: s.trace.steps, deg: s.deg, contactH: pt.h },
  };
}

// ============================================================
// ③ 目标落点区:由这一关**自己的判据**给边界,不再按 id switch
// ============================================================

export interface TargetZone { x1: number; x2: number; label: string }

/**
 * 这一关的回球要落在对方场地的哪一带才算。
 * 有显式 `minLandX`/`maxLandX` 就以它为一边(高远关「落点要压过这条线」就是这条),
 * 另一边收到界内;没有就以**演示真正打出的落点**为中心开一个 ±zoneSpread 的窗口
 * —— 这条带子是「这一拍真能落到这儿」,不是拍脑袋画的一格。
 * @param landX 烘焙出的理想落点;传 null(实机 HUD 还没开烘焙)时按 wantKey 给默认位置
 */
export function zoneFor(def: DrillDef, landX: number | null = null): TargetZone {
  const D = C.drill.demo;
  const mid = landX != null
    ? landX
    : CO.netX + (CO.right - CO.netX) * (def.wantKey === "near" ? D.fallbackNear : D.fallbackFar);
  const x1 = def.minLandX ?? Math.max(CO.netX + D.zonePad, mid - D.zoneSpread);
  const x2 = def.maxLandX ?? Math.min(CO.right - D.zonePad, mid + D.zoneSpread);
  return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), label: def.zoneName ?? "目标得分区" };
}

// ============================================================
// ④ 烘焙:一关一份,记忆化
// ============================================================

/** 演示要画的一段弧(点列为世界坐标,canvas 惯例 y 向下) */
export interface DemoArc { pts: { x: number; y: number }[]; landX: number; kind: string; hitNet: boolean }
/** 理想回球:除了弧线,还带上判据真正吃了的那几个量(标注要写数字) */
export interface DemoShot extends DemoArc { q: number; depth: number; steps: number; contactH: number }

export interface DemoBake {
  def: DrillDef;
  /** 真喂球弧线(从手上那一点起) */
  inbound: DemoArc & { feederX: number; feederY: number; hangFrames: number };
  /** 教学用的接触点:落在 inbound 这条弧上,且回球过本关判据 */
  contact: ContactPoint;
  /** 该接触点上的判定区(圆心 + 半径),画「站得住才能够得到」那个圈 */
  strike: { x: number; y: number; r: number };
  /** 人该站在哪儿(脚底 x)与要不要跳、跳多高:由判定区反解,不是拍出来的 */
  stand: { x: number; jumpH: number; apexH: number; needJump: boolean; rad: number };
  ret: DemoShot;
  /** 同一接触点换另一个滑向 → 真打出来的那一拍(已确认**不**过判据才给;没有就 null) */
  alt: (DemoShot & { verdict: string }) | null;
  zone: TargetZone;
  /** 击球键名:只写触屏动作,和 requirementOf 同一口径 */
  keyName: "左滑" | "右滑";
  /** 恒为 true —— 演示画的就是判据认的那一拍(被 drill-diagram-check 钉住) */
  passes: boolean;
}

const memo = new Map<string, DemoBake | null>();

function bakeNow(def: DrillDef): DemoBake | null {
  const D = C.drill.demo;
  const feed = simulateFeed(def.feed.depth, def.feed.jumpLead);
  if (!feed || !feed.contacts.length) return null;

  // 要起跳的关只教「必须跳才够得到」的那几个点,不跳的关反之 ——
  // 于是第②步的站位与是否起跳是从判据里长出来的,不是文案里写的。
  const wantJump = !!def.pose?.jump;
  const fitted = feed.contacts.filter((c) => c.needJump === wantJump);
  // 再按这一关的挥拍式挑高度:上手球(over)教**高接触点**(高远/点杀要举过头顶),
  // 下手球(under)教**低接触点**(搓放/挑高就是贴地铲)。不加这一条,高远关会选中弧线上
  // 最低的可达点 —— 判据过了,画的却是个「弯腰捞球的高远球」,教的姿势本身就是错的。
  const preferHigh = (def.pose?.style ?? "over") !== "under";
  const sorted = [...(fitted.length ? fitted : feed.contacts)]
    .sort((a, b) => (preferHigh ? b.h - a.h : a.h - b.h));
  // 只在最合手的那一批里,从高(上手球)/低(下手球)往下扫:第一个过判据的就是该教的那颗。
  // 旧版在这里按弧线中点往外扫 —— 那会把高远关挑到弧线最低的可达点:判据过了,
  // 画的却是弯腰捞球,姿势本身就是错的。
  const pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * D.preferredShare)));

  const aim = def.wantKey === "near" ? C.aimDepth.near : C.aimDepth.deep;
  const other = def.wantKey === "near" ? C.aimDepth.deep : C.aimDepth.near;

  let found: { pt: ContactPoint; s: SolveResult; q: number } | null = null;
  // 先用标定质量(≈甜蜜区中段的正常一拍),找不到才放宽到整条质量阶梯
  for (const q of [D.q, ...QS]) {
    for (const pt of pool) {
      const s = shotAt(pt, aim, q);
      if (s.trace.hitNet) continue;
      if (Drill.matches(def, eventAt(pt, s, q))) { found = { pt, s, q }; break; }
    }
    if (found) break;
  }
  if (!found) return null;

  const { pt, s, q } = found;
  const rad = Physics.reachRadius({ vx: pt.speed, vy: 0 });
  const off = Physics.strikeOffset(rad, 1);
  const zr = zoneRadius(rad, pt.speed);
  // 判定区圆心 = 脚底 + off(Physics.strikeOffset 是圆心位置的唯一真话)。反解「该站哪儿」:
  //   竖直方向**只在真够不着时才跳**(contact.needJump 是判据自己算出来的),按需封顶在
  //   真实跳跃顶点 —— 不然站着能够到的球也会把小人画成离地飘着,那是另一个假动作。
  const needJumpH = Math.max(0, pt.h + off.dy);   // off.dy 是负数:圆心在脚底上方
  const jumpH = pt.needJump ? Math.min(APEX, needJumpH) : 0;
  const footY = CO.groundY - jumpH;
  const cy = footY + off.dy;
  const vOver = Math.abs(pt.y - cy);
  const slack = Math.sqrt(Math.max(0, zr * zr - vOver * vOver));
  const standX = pt.x - slack * D.standLead - off.dx;

  // 错误对照:同一点换另一个滑向,真打出来的一拍。**不过判据才画**(画了就得真是错的),
  // 错在哪直接用 Drill.diagnoseFail —— 与玩家实机打错时飘起来的那句同一份文案,
  // 「引导里教的按错会怎样」和「游戏里报的为什么没算」就此不会各说各话。
  const altShot = shotAt(pt, other, q);
  const altFact = altShot.trace.hitNet ? null : eventAt(pt, altShot, q);
  const altOk = !altFact || Drill.matches(def, altFact);

  return {
    def,
    inbound: {
      pts: feed.pts.map((p) => ({ x: p.x, y: p.y })),
      landX: s.trace.landX, kind: "feed", hitNet: false,
      feederX: feed.released.x, feederY: feed.released.y,
      hangFrames: pt.frame,
    },
    contact: pt,
    strike: { x: standX + off.dx, y: cy, r: zr },
    stand: { x: standX, jumpH, apexH: APEX, needJump: pt.needJump, rad },
    ret: {
      pts: arcOf(s, pt), landX: s.trace.landX, kind: s.kind, hitNet: s.trace.hitNet,
      q, depth: s.depth, steps: s.trace.steps, contactH: pt.h,
    },
    alt: altOk ? null : {
      pts: arcOf(altShot, pt), landX: altShot.trace.landX, kind: altShot.kind,
      hitNet: false, q, depth: altShot.depth,
      steps: altShot.trace.steps, contactH: pt.h,
      verdict: Drill.diagnoseFail(def, altFact),
    },
    zone: zoneFor(def, s.trace.landX),
    keyName: def.wantKey === "near" ? "左滑" : "右滑",
    passes: true,
  };
}

/** 把一记求解结果展开成逐帧点列(渲染要的是弧,不是只有落点) */
function arcOf(s: SolveResult, from: { x: number; y: number }): { x: number; y: number }[] {
  const b: Ball = {
    x: from.x, y: from.y, px: from.x, py: from.y,
    vx: s.vx, vy: s.vy, held: false, live: true,
    owner: null, lastHitter: "left", crossed: false, netted: false, shot: null,
    sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  };
  const pts = [{ x: b.x, y: b.y }];
  for (let i = 0; i < 320; i++) {
    Physics.step(b);
    pts.push({ x: b.x, y: b.y });
    if (b.y >= CO.groundY - 2 || b.x > CO.right + 40 || b.x < 20) break;
  }
  return pts;
}

/** 一关的演示真值(记忆化:引导页每次打开、HUD 每帧读都只查一次表) */
export function bake(def: DrillDef): DemoBake | null {
  if (memo.has(def.id)) return memo.get(def.id) ?? null;
  const b = bakeNow(def);
  memo.set(def.id, b);
  return b;
}

/** 全部关卡的烘焙结果(标定与预览工具吃这张表) */
export function bakeAll(defs: readonly DrillDef[]): Array<{ def: DrillDef; bake: DemoBake | null }> {
  return defs.map((def) => ({ def, bake: bake(def) }));
}

/** 改了 shuttle / loftByHeight / 判据之后重跑标定:让记忆化表清空重算 */
export function invalidate(): void { memo.clear(); }

export const DrillDemo = {
  bake, bakeAll, invalidate, zoneFor, simulateFeed, standingTop, apexReach, shotAt, eventAt, QS,
};
