// ============================================================
// 人物移速档位 —— 真人操作侧的第二个手感旋钮(第一个是 pace.ts 的球速档位)
// ------------------------------------------------------------
// 为什么要有它:手机上的"接不到"有两摊账 —— 球飞多久(pace)和人跑到哪儿(gait)。
// pace 调的是留给玩家几帧,gait 调的是这几帧里他能覆盖多少地面。两摊互相补偿,
// 所以两个旋钮分开给,让用户自己试出组合;合成一个"难度"滑杆就再也读不出动了什么。
//
// 与 pace 的三条区别(别顺手照抄 pace 的做法):
//   ① **只作用于真人**:`player.ts` 里按 `p.isAI` 分流。AI 的速度已经有自己的一套旋钮
//      (`diffs.*.speed`,rules 在 newMatch 时写进 `p.speedMul`),两层叠在一起会让
//      难度档与玩家设置互相污染,而且 serve-check/sim-check 的阈值就成了测玩家偏好。
//   ② **即时生效,不挂 beginPoint**:移动速度不改任何已在飞的东西(球的弹道在击球那一刻
//      就解完了),当场改档不存在"残程拐弯"的问题;而试手感要的正是"拖完这拍马上能感觉到"。
//      pace 必须等下一球是因为它改重力。
//   ③ 缩放的是 `accel` 与 `vmax` **这一对**(同一比例),不碰跨步冲量 `lunge.speed`、
//      跳跃 `jumpV/gravity`、摩擦 `groundFriction`。只提 vmax 不提 accel 会显得"起步肉",
//      两个一起乘才是"整个人步子大了";而跨步/跳跃是另一套手感,别跟着漂。
//
// 表与档位在 config.gait,存存档时存 id 不存系数(与 pace 同一理由:插档不会指错)。
// ============================================================
import { CFG } from "./config";

export interface GaitTier {
  id: string;
  /** 移速相对量(1 = 现在的 accel/vmax 原值) */
  s: number;
  label: string;
  note: string;
}

/** 认不出就退回默认档:坏存档 / 打错 id 都不许让角色跑不动或飞出场地 */
export function gaitTierById(id: unknown): GaitTier {
  const T = CFG.gait.tiers;
  if (typeof id === "string") {
    const hit = T.find((t) => t.id === id);
    if (hit) return hit;
  }
  return T.find((t) => t.id === CFG.gait.default) ?? T[0];
}

/** 档位在表里的下标(设置面板那根 step=1 的滑杆用它定位) */
export function gaitIndexOf(id: unknown): number {
  const i = CFG.gait.tiers.findIndex((t) => t.id === (typeof id === "string" ? id : ""));
  return i < 0 ? 0 : i;
}

const clampS = (v: number): number =>
  Math.min(CFG.gait.max, Math.max(CFG.gait.min, v));

let active: GaitTier = gaitTierById(CFG.gait.default);
let S = clampS(active.s);

export const Gait = {
  /** 当前系数:player.ts 每步乘在 accel 与 vmax 上 */
  get s(): number { return S },
  id(): string { return active.id },
  tier(): GaitTier { return active },
  /** 直接生效(移动速度没有"残程"问题,不需要等下一球) */
  apply(id: unknown): void {
    active = gaitTierById(id);
    S = clampS(active.s);
  },
  /** 相对默认档的百分比人话:「很快 · 快 50%」;默认档只写档名 */
  labelOf(t: GaitTier): string {
    const pct = Math.round((t.s / tierOfDefault().s - 1) * 100);
    return pct === 0 ? t.label : `${t.label} · ${pct > 0 ? "快" : "慢"} ${Math.abs(pct)}%`;
  },
};

function tierOfDefault(): GaitTier {
  return gaitTierById(CFG.gait.default);
}
