// ============================================================
// 生涯里程碑 —— 六格生涯统计的达成档位与领奖视图(纯函数,零 cc 依赖)
//
// 依赖方向:types ← config ← 本模块。不 import career/ui/render 任何东西 ——
// career.ts 要吃这里的视图函数,tools/milestone-check 也要吃同一份,两头拿到的
// 必须是同一套口径;一旦这里反向摸到 career 的 Profile,依赖就成环了。
//
// 这个文件只做三件事:
// ① statValue:六项统计「现值」的**唯一出口**。胜率是现算派生值(round(wins/matches*100),
//    不落盘),以前只有 shop-shelf.statCells 一处在算;里程碑要用同一个数,所以把公式
//    收拢到这里,statCells 改吃这里 —— 两处各算一份早晚漂移。
// ② tiersOf / milestoneViews:每格「领到哪一档、能不能领、下一档是多少」的视图。
//    「可领」= 存在已达成的未领档;一次点按领走该格**全部**已达成的未领档(合并发奖,
//    玩家搁置几天再打开面板也不会少拿,不用连点三次)。
// ③ 里程碑副行的文案单位:大数的单位(扣杀终结大数不带「次」)是版式选择,里程碑
//    文案「下一档 60次」的单位是语义需要,两处不同步是有意的,别拿来"统一"。
//
// 档位表在 config.ts 的 MILESTONES;已领记录存 Profile.claimed(存档归一化在 career.ts)。
// ============================================================

import { CFG } from "./config";
import type { MilestoneDef, MilestoneStat } from "./config";

const C = CFG;

/** 类型随本模块再导出:消费方(ui 层/tools)只认里程碑域,不直接摸 config 表 */
export type { MilestoneDef, MilestoneStat };

/** 六项统计的最小结构画像(结构化类型:Profile.stats 天然可赋值,不必 import career) */
export interface MilestoneStats {
  matches: number; wins: number; smashes: number; perfects: number; sweets: number; maxRally: number;
}

/** 每格一行文案需要的元数据(单位只服务「下一档 N{unit}」;label 与 statCells 卡片名同串) */
export const MILESTONE_STATS: { key: MilestoneStat; label: string; unit: string }[] = [
  { key: "winRate", label: "生涯胜率", unit: "%" },
  { key: "smashes", label: "扣杀终结", unit: "次" },
  { key: "perfects", label: "完美击球", unit: "次" },
  { key: "sweets", label: "甜区命中", unit: "次" },
  { key: "maxRally", label: "最长相持", unit: "拍" },
  { key: "endless", label: "无限模式纪录", unit: "分" },
];

/** 某项统计的现值。胜率在 0 场时按 0 算(与 statCells 旧公式同式) */
export function statValue(key: MilestoneStat, st: MilestoneStats, bestEndless: number): number {
  switch (key) {
    case "winRate": return st.matches > 0 ? Math.round((st.wins / st.matches) * 100) : 0;
    case "smashes": return st.smashes;
    case "perfects": return st.perfects;
    case "sweets": return st.sweets;
    case "maxRally": return st.maxRally;
    case "endless": return bestEndless || 0;
  }
}

/** 该项的全部档位,按表中顺序(= 档位序);config 表是唯一真话,这里不做二次过滤 */
export function tiersOf(stat: MilestoneStat): MilestoneDef[] {
  return C.milestones.filter((m) => m.stat === stat);
}

export interface MilestoneView {
  key: MilestoneStat;
  /** 全部档位数 / 已领档数 */
  total: number;
  done: number;
  /** 存在已达成的未领档(整卡可点) */
  claimable: boolean;
  /** 一次点按可领走的合计(= 全部已达成的未领档之和) */
  claimCoin: number;
  claimExp: number;
  /** 下一未领档的阈值(含已达成未领的);全部领完 = null */
  nextAt: number | null;
  /** 「下一档 N{unit}」用的单位 */
  unit: string;
  /** 全部档位都已领(副行缀「已领满」) */
  allDone: boolean;
}

export function milestoneViews(
  st: MilestoneStats, bestEndless: number, claimed: string[] | undefined,
): Record<MilestoneStat, MilestoneView> {
  const claimedSet = new Set(claimed ?? []);
  const out = {} as Record<MilestoneStat, MilestoneView>;
  for (const { key, unit } of MILESTONE_STATS) {
    const tiers = tiersOf(key);
    const unclaimed = tiers.filter((d) => !claimedSet.has(d.id));
    const value = statValue(key, st, bestEndless);
    const reach = unclaimed.filter((d) => value >= d.at);
    out[key] = {
      key,
      total: tiers.length,
      done: tiers.length - unclaimed.length,
      claimable: reach.length > 0,
      claimCoin: reach.reduce((a, d) => a + d.coin, 0),
      claimExp: reach.reduce((a, d) => a + d.exp, 0),
      nextAt: unclaimed.length ? unclaimed[0].at : null,
      unit,
      allDone: unclaimed.length === 0 && tiers.length > 0,
    };
  }
  return out;
}
