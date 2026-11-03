// ============================================================
// AI 击球后的回位算术(零 cc 叶子:给 ai.ts 消费、给 tools/ai-recover-check 当靶子)
//
// 为什么不是"回到 p.homeX":
// 旧行为是击球下一帧就把目标点切回中场(ai.ts 的非来球分支),于是玩家不管把球打到
// 近网还是底线,AI 下一拍都从同一个"最舒服的站位"起跑 —— 近球/远球没有战术回报。
// 真实球员打完一拍会先收拍停一下,再按**刚打出去的球**决定站位:
//   放网/劈吊 → 压上守网前(球短,对手最可能回放或推腰)
//   平抽/高远/挑高 → 回中场
//   重杀 → 留在后场(起跳落地惯性,别马上又往前扑)
// 难度档再用 backK 决定"愿不愿意真的走到那个点":简单档只走一半,极限档走到位 ——
// 站位纪律本身就是难度,与 diffs 里的 read/zone/shotErr 各管一段。
//
// 三条硬约束:
//   ① 回位点必须夹在本方半场(不撞网、不出墙):AI 至少还在半场里;
//   ② 只按 p.aiDiff 取档,不读 p.aiTier —— campaign 的 aiTune 微调的是
//      read/shotErr/timingErr/aggr,不该顺手改写走位;
//   ③ 资格闸只给"对手 AI":影分身(idx=-1)要守各防区、同侧有真人的 CPU 搭档是队友,
//      两者都保持旧的"回 homeX"行为(闸门 recoverEligible,判据见 ai-recover-check ⑤)。
// ============================================================
import { CFG } from "./config";
import { DiffKey, ShotKind, TeamSide } from "./types";
import { clamp } from "./utils";

export interface RecoverPlan {
  /** 收拍停顿帧数(>0 期间原地不动,让挥拍动画收完) */
  dwell: number;
  /** 停顿结束后要走到的位置(已经夹在本方半场) */
  anchorX: number;
}

export interface RecoverOpts {
  side: TeamSide;
  homeX: number;
  /** 击球瞬间站的位置(不是球的落点) */
  hitX: number;
  /** **这一拍打出去的**球种(Physics.classify 的结果) */
  kind: ShotKind;
  /** 难度档键(aiDiff)。campaign 的 aiTier 微调量刻意不参与 */
  diff: DiffKey;
}

/** 本方半场可站范围:左队 [左墙, 网前 netPad];右队 [网前 netPad, 右墙] */
function ownLo(side: TeamSide): number {
  const CO = CFG.court;
  return side === "left" ? CO.wallL : CO.netX + CO.netPad;
}
function ownHi(side: TeamSide): number {
  const CO = CFG.court;
  return side === "left" ? CO.netX - CO.netPad : CO.wallR;
}

/**
 * 算这一拍击球后的回位计划。纯函数:同样的入参永远同样的结果,
 * 所以非来球分支每帧重读也不会抖(状态只在击球那一刻写一次,见 ai.ts noteHit)。
 */
export function planRecover(o: RecoverOpts): RecoverPlan {
  const A = CFG.aiRecover;
  const dwell = A.dwell[o.diff] ?? A.dwell.normal;
  const backK = A.backK[o.diff] ?? A.backK.normal;
  const facing = o.side === "left" ? 1 : -1;
  // 战术位:正 lean = 压向网(左队 +x,右队 -x)
  const baseX = o.homeX + facing * A.leanPx * (A.kindLean[o.kind] ?? 0);
  // 从击球点向战术位走 backK 成:简单档永远差一口气,极限档到位
  const raw = o.hitX + (baseX - o.hitX) * backK;
  return {
    dwell: Math.max(0, Math.round(dwell)),
    anchorX: clamp(raw, ownLo(o.side), ownHi(o.side)),
  };
}

/**
 * 这套回位只给"对手 AI"。
 *   · side === "left": 左队恒为玩家侧(真人玩家 / 仿真测试替身 / 2v2 CPU 搭档),
 *     绝不能给玩家侧加收拍停顿或站位惩罚(campaign-balance-check 的替身正是因此
 *     被削弱导致机制关跌破地板);
 *   · idx < 0 = 影分身:它要各守一块防区(shadow.ts 的守位逻辑按 homeX 判),不吃;
 *   · 同侧有真人 = CPU 队友:那是队友,不能顺手削弱玩家;
 *   · 喂球机(drill/tutorial)根本不走 AI.think,天然不在内。
 */
export function recoverEligible(p: { isAI: boolean; idx: number; side?: TeamSide }, humanOnSide: boolean): boolean {
  return !!p.isAI && p.idx >= 0 && !humanOnSide && (p.side === undefined || p.side === "right");
}
