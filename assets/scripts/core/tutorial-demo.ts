// ============================================================
// 新手教学演示的**真值烘焙** —— render/tutorial-anim 里那颗来球、那记回球、
// 人站哪儿,全部由实机同一条链算出来,不再手画抛物线。
//
// 为什么要有这个模块:tutorial-anim 旧版是训练场演示 0.0.21 重做前的同款旧病 ——
// 来球/回球是手编二次贝塞尔,与教学实操真喂出来的球(`core/tutorial.ts` 的
// feederInput,吃 C.tutorial.feed)毫无关系;人偶是火柴人;喂球机压根没画。
// 「讲解里教的弧线」和「实操里飞的球」是两套东西。训练场的解法(见 drill-demo
// 文件头)已验证:喂球复现 + 判据搜点 + 渲染只画 —— 这里照搬同一条路。
//
// 与 drill-demo 的关系:喂球模拟 simulateFeed、回球解算 shotAt、判定区尺子
// zoneRadius、弧线展开 arcOf 全部直接复用它的导出,零复制。教学自己的只有
// 「挑哪颗接触点」与「站位反解」:
//   · 击球主题挑**站着就够到**(needJump=false)、最贴近肩高的点 —— 讲解文案
//     「球到身前肩高再按」,教的必须是站着能打的那颗;
//   · 起跳主题挑**跳起才够到**(needJump=true)的点 —— 文案「跳起来能打到高球」;
//   · 两颗教学回球 = 同一接触点上 aimDepth.deep(右滑深球)/ aimDepth.near(左滑网前),
//     落点、过网、步数全部来自真实弹道解算。
//
// 依赖纪律:零 cc,可在 node 下直接回归(tools/tutorial-check 的演示断言钉住)。
// ============================================================
import { CFG } from "./config";
import { Physics } from "./physics";
import { simulateFeed, shotAt, zoneRadius, arcOf, apexReach } from "./drill-demo";
import type { ContactPoint } from "./drill-demo";

const C = CFG;
const CO = C.court;

/** 演示要画的一段回球弧(点列世界坐标、canvas 惯例 y 向下) */
export interface TutDemoArc {
  pts: { x: number; y: number }[];
  landX: number;
  steps: number;
  kind: string;
}

export interface TutDemoBake {
  /** 真实来球:从喂球机手上到接触点为止的逐帧点列(frames = 接触点真实帧数) */
  inbound: {
    pts: { x: number; y: number }[];
    feederX: number;
    feederY: number;
    frames: number;
  };
  /** 站立接触点(击球主题):球到「身前肩高」的那一点 */
  contact: ContactPoint;
  /** 跳跃接触点(起跳主题):跳起才够到的那一点(needJump=true) */
  jumpContact: ContactPoint | null;
  /** 站位反解:脚底 x 与判定圆(圆心+半径),人站这儿球正落进圈内 */
  stand: { x: number };
  strike: { x: number; y: number; r: number };
  /** 起跳主题的站位与跳高(真实跳跃递推的可达上限) */
  jumpStand: { x: number; jumpH: number };
  /** 两颗教学回球:右滑深球 / 左滑网前 */
  deep: TutDemoArc;
  net: TutDemoArc;
  /** 起跳主题的回球:跳起够到后打回去的一记平球(aimDepth.mid) */
  jumpRet: TutDemoArc;
}

const memo = new Map<string, TutDemoBake | null>();

/** 演示回球的质量档:正常一拍(与发球 q=0.8 同档),不演「完美拍」 */
const DEMO_Q = 0.8;

/**
 * 站位反解(照 drill-demo.bakeNow 同式):判定圆心 = 脚底 + Physics.strikeOffset,
 * 反解「人该站哪儿」让接触点落进圆内 —— 站立主题不跳(needJump=false)。
 */
function solveStand(pt: ContactPoint): { x: number; strike: { x: number; y: number; r: number } } {
  const rad = Physics.reachRadius({ vx: pt.speed, vy: 0 });
  const off = Physics.strikeOffset(rad, 1);
  const zr = zoneRadius(rad, pt.speed);
  const cy = CO.groundY + off.dy;                 // off.dy 为负:圆心悬在脚底上方
  const vOver = Math.abs(pt.y - cy);
  const slack = Math.sqrt(Math.max(0, zr * zr - vOver * vOver));
  // 球从右往左飞:站位让圆心落在接触点左侧 slack 处,球先入圈、到最深时正对圆心
  const standX = pt.x - slack - off.dx;
  return { x: standX, strike: { x: standX + off.dx, y: cy, r: zr } };
}

function bakeNow(): TutDemoBake | null {
  // 教学实操真喂的参数(C.tutorial.feed):同一颗球,讲解与实操零失真
  const feed = simulateFeed(C.tutorial.feed.depth, C.tutorial.feed.jumpLead);
  if (!feed || !feed.contacts.length) return null;

  // —— 击球主题的接触点:站着够到、最贴近肩高(≈身高的 0.72)——
  const shoulder = C.player.h * 0.72;
  const standable = feed.contacts.filter((c) => !c.needJump);
  const pool = (standable.length ? standable : feed.contacts)
    .slice()
    .sort((a, b) => Math.abs(a.h - shoulder) - Math.abs(b.h - shoulder));

  // 第一个「两颗教学回球都过得去 + 落点带合理」的接触点就是该教的那颗
  for (const pt of pool) {
    const deep = shotAt(pt, C.aimDepth.deep, DEMO_Q);
    const net = shotAt(pt, C.aimDepth.near, DEMO_Q);
    if (deep.trace.hitNet || net.trace.hitNet) continue;
    const deepOk = deep.trace.landX > CO.shortServeR && deep.trace.landX < CO.right + 60;
    const netOk = net.trace.landX > CO.netX + CO.netPad && net.trace.landX < CO.shortServeR;
    if (!deepOk || !netOk) continue;

    const stand = solveStand(pt);
    // —— 起跳主题的接触点:跳起才够到的点里最高的那颗(「跳起来能打到高球」)——
    const jumpable = feed.contacts.filter((c) => c.needJump);
    const jc = jumpable.length
      ? jumpable.reduce((best, c) => (c.h > best.h ? c : best))
      : null;
    const jumpStand = jc ? solveStand(jc) : null;
    // 起跳高度:真实跳跃递推够到圆心即可(照 drill-demo:needJump 才跳,封顶在真实顶点)
    let jumpH = 0;
    if (jc && jumpStand) {
      const need = Math.max(0, jc.h + (Physics.strikeOffset(Physics.reachRadius({ vx: jc.speed, vy: 0 }), 1).dy));
      jumpH = Math.min(apexReach(), need);
    }
    // 起跳主题的回球:够到之后打回去的一记平球(mid),让「够到了」有一个结果
    let jumpRet: TutDemoArc | null = null;
    if (jc) {
      const jr = shotAt(jc, C.aimDepth.mid, DEMO_Q);
      if (!jr.trace.hitNet) {
        jumpRet = { pts: arcOf(jr, jc), landX: jr.trace.landX, steps: jr.trace.steps, kind: jr.kind };
      }
    }

    return {
      inbound: {
        pts: feed.pts.map((p2) => ({ x: p2.x, y: p2.y })),
        feederX: feed.released.x,
        feederY: feed.released.y,
        frames: pt.frame,
      },
      contact: pt,
      jumpContact: jc,
      stand: { x: stand.x },
      strike: stand.strike,
      jumpStand: { x: jumpStand ? jumpStand.x : stand.x, jumpH },
      deep: { pts: arcOf(deep, pt), landX: deep.trace.landX, steps: deep.trace.steps, kind: deep.kind },
      net: { pts: arcOf(net, pt), landX: net.trace.landX, steps: net.trace.steps, kind: net.kind },
      jumpRet: jumpRet ?? { pts: arcOf(net, pt), landX: net.trace.landX, steps: net.trace.steps, kind: net.kind },
    };
  }
  return null;
}

/** 教学演示真值(记忆化:面板每次打开只算一次) */
export function bake(): TutDemoBake | null {
  if (!memo.has("tut")) {
    memo.set("tut", bakeNow());
  }
  return memo.get("tut") ?? null;
}

/** 改了喂球/弹道/判定区之后让记忆化失效 */
export function invalidate(): void { memo.clear(); }

export const TutorialDemo = { bake, invalidate, jumpTable };

/**
 * 真实跳跃递推表:jumpTable()[k] = 起跳后第 k 帧的离地高度,落地即止。
 * 与 Player.update 同一条递推(jumpV 起、每步加 gravity),「跳到顶要几帧、顶多高、
 * 什么时候落地」是引擎真值 —— 演示里的人偶按这张表跳,和实机跳得一样高、一样快。
 */
export function jumpTable(): number[] {
  const out: number[] = [];
  let vy = C.player.jumpV, y = 0;
  for (let k = 0; k < 90; k++) {
    vy += C.player.gravity; y += vy;
    out.push(Math.max(0, -y));
    if (y > 0) break;
  }
  return out;
}
