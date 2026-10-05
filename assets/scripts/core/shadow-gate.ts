// ============================================================
// 影分身:召唤门控 + 槽位算术(零依赖叶子模块)
// ------------------------------------------------------------
// 这个文件只做两件"谁都可能需要、但只该有一份"的事:
//   1. **模式门控**:训练场 / 新手教学 / 本地对战不许召影分身;
//   2. **槽位算术**:同场几个、下一个占几号、几号是什么颜色。
// 两者都放叶子上是同一条理由:
//   · 门控必须进 `Skills.canActivate`(门槛不点亮技能键,否则就是本仓反复警告过的
//     "按了没反应、一个字都不说" —— rage / smash / auto-hit 三条键面契约都栽过这一条),
//     而 skills.ts 不能 import shadow.ts:shadow → ai → rules → skills 已经成环,再加一个
//     节点会改模块初始化顺序。同理 player.ts 也不许被 skills.ts 反向 import。
//   · 槽位算术被四个模块同时需要:skills(能不能召)、player(占几号)、shadow(当值判定)、
//     world/sprites(取色)。写在任何一处,其余三处就得抄一份 —— 抄一份就是第二条尺子。
//   · 门控也**不能只挡在 spawnShadowClone**:player.update 那条路是 canActivate → activate
//     → spawn,挡在 spawn 层时 activate 已经付了冷却、立了 shadowCast、game-root 已经播完
//     起手飘字与震屏 —— 玩家看见"影分身·参上!"而场上什么都没有。
//
// 训练场与新手教学为什么必须排除(比 auto-hit 那条理由更硬一档):
//   drill.ts 的 matches()/diagnoseFail() 判的是 **lastHitter / scorer 的"队"**,不是"谁打的"
//   (`e.lastHitter !== "left"` 那一行)。影分身是宿主同侧的 isAI 实体,它那一拍在事件里就算
//   left 打的 ⇒ 分身回球会被判成"玩家练成了这一关"。教学三门控同理(那三关判的是"你会不会")。
//   旧写法这个洞被"每分清场"挡着(一关一球,分身一出场就被 resetPoint 抹掉),而 2026-10-05
//   改成跨回合保留 + 每回合补满额度之后:训练场每球重喂都走 beginPoint ⇒ resetPoint,分身
//   每球回满、近乎永久在场,训练关可以被系统性骗过。
//   本地对战/双打同 auto-hit 的理由:那是两个真人,替一个就是替另一个;而且两名真人各自
//   能攒三个 = 同场六坨剪影。
//
// 未报过模式时按"不许召"处理(初值 lastMode="MENU"),任何纯逻辑单测里手搓的 Player 都
// 必须先 Rules.newMatch 才召得出来 —— 宁可少召不可白送。
// ============================================================
import { CFG } from "./config";
import type { Player, ShadowCloneState } from "./types";

/** 最后一次报进来的模式,只给判据与面板读数用,不参与判定 */
let lastMode = "MENU";
/** 当前模式能不能召影分身 */
let modeOK = false;

/** 这个模式允不允许召唤影分身(判据只有一份,别在调用点各写一遍) */
export function shadowEligible(mode: string): boolean {
  return CFG.skills.shadow.modes.indexOf(mode) >= 0;
}

/** 「没分身」的共享空数组:每帧都跑的读点不许 new 一个 [] (与 world 的 cloneView 同一条零 GC 纪律) */
const NO_CLONES: ShadowCloneState[] = [];

/** 槽位表长度 = 场上分身数量上限。**故意不单开 maxClones 键**:两条旋钮管同一件事必然分叉 */
export function slotCount(): number {
  return CFG.skills.shadow.slots.length;
}

/** 读宿主在场(含消散演出中)的分身列表。任何调用点都不许拿它去改长度以外的东西 */
export function clonesOf(p: Player | null | undefined): ShadowCloneState[] {
  return (p && p.shadowClones) || NO_CLONES;
}

/** 已占用的槽位号集合由数组自带,这里只回答"最低的空位是几号";满则 -1 */
export function freeSlotOf(p: Player): number {
  const taken = clonesOf(p);
  for (let i = 0; i < slotCount(); i++) {
    if (!taken.some((sc) => sc.slot === i)) return i;
  }
  return -1;
}

/** 还能不能召一个:真闸是"槽位没占满",与"接满额度正在消散"无关 —— 后者仍占着那一号位 */
export function canSummon(p: Player): boolean {
  return clonesOf(p).length < slotCount();
}

/**
 * **本帧刚出生**的那一枚(spawnT 还等于出厂值)。给起手演出取身份色与在场数用。
 * 为什么判"等于出生帧数"而不是"数组最后一个":updateClones 会在召唤当帧就把它减到 -1,
 * 所以这个读法只在 player.update → onSkill 那一步成立(顺序有注释钉着,别调换)。
 * 每帧最多一枚出生:每分限召一次 + 满编拒召 ⇒ 不存在歧义。
 */
export function bornClone(p: Player): ShadowCloneState | null {
  const f = CFG.skills.shadow.spawnFrames;
  for (const sc of clonesOf(p)) if (sc.spawnT === f) return sc;
  return null;
}

/**
 * slot → 身份色。**越界一律钳到最后一槽**(配置被改短时不许炸渲染)。
 * 颜色住在 config 的 slots[].tint:这里只查表,别在渲染层再抄一份 hex ——
 * 旧写法就是那样分叉出 fx 用 #a855f7(吸球那颗紫)而影分身是 #8b5cf6 的。
 */
export function slotTint(slot: number): string {
  const list = CFG.skills.shadow.slots;
  const i = Math.max(0, Math.min(list.length - 1, slot | 0));
  return list[i].tint;
}

export const ShadowGate = {
  /** 生效读数:当前模式允许召唤。唯一的闸就是模式闸(强度归 slots.length / dutyByZone 那两条) */
  get on(): boolean { return modeOK; },
  /** 当前报进来的模式名(读数) */
  get mode(): string { return lastMode; },
  /** 开场时报模式:newMatch / startCampaign 两处全仓唯一写 R.mode 的地方各调一次 */
  onMatch(mode: string): void { lastMode = mode; modeOK = shadowEligible(mode); },
  eligible: shadowEligible,
  /** 回到"没报过模式"的初值(回归工具跑完一轮要还原,别把上一段的模式读数漏给下一段) */
  reset(): void { lastMode = "MENU"; modeOK = false; },
  // 槽位算术挂导出面(不只是为了好看:tools/*.ts 的反例要能替换/计数这些点)
  clonesOf, freeSlotOf, canSummon, bornClone, slotTint, slotCount,
};
