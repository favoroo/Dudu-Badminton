// ============================================================
// 每日/每周活动 —— 任务进度、轮换与三态视图的唯一口径(纯函数,零 cc 依赖)
//
// 依赖方向:types ← config ← 本模块。不 import career/ui/render 任何东西 ——
// career.ts 要吃这里的记录与领取校验,tools/activity-check 与活动面板/首页横幅
// 也要吃同一份视图;一旦反向摸到 career 的 Profile,依赖就成环了。
//
// 这个文件只做四件事:
// ① 戳与轮换:dayStamp/weekStamp(本地时区,now 作入参,测试好摆拍)+ questsOf
//    —— 每日按日戳做种子 mulberry32 抽 dailyPick 条,同一天任何时刻抽到的都一样、
//    次日自然换一批。render/p5kit 的 mulberry32 不能被 core 反向 import(分层铁律),
//    这里就地另写一份同款(与 acc/world 的「同形不同源」同一条理由)。
// ② 重置:存档只存 { d, w, daily, weekly },d/w 是「这份进度属于哪天/哪周」的戳。
//    normalizeQuests 发现现算戳与存档戳不符就整侧重置该侧 —— 由 career.profile()
//    在归一化末尾调,所以任何读取路径(首页横幅/活动面板/领取链)拿到的都已是
//    当天/本周的新一周。**每日与每周各存各的 prog/claimed**:跨天只重置每日侧,
//    每周进度必须活过跨天(反之亦然),共用一份就会互相清。
// ③ 记录:recordMatch/recordDrill 只做加法与夹紧(sum 累加 / max 取最好),
//    返回「本次新完成且未领」的任务 id 供结算飘字播报;发放(金币/经验)不在本模块
//    —— 那是 career.claimActivity 的事,claimInfo/markClaimed 是它的校验与记账两半。
// ④ 视图:questViews 输出三态(进行中/可领取/已领取)+ 宝箱态 + 可领数,
//    首页横幅副行与活动面板共用这一份,别在 UI 里另算一遍。
//
// 任务表在 config.ts 的 ACTIVITIES;进度存 Profile.quests(存档归一化在 career.ts)。
// ============================================================

import { CFG } from "./config";
import type { ActivityDef, ActivityKind, ActivityStat } from "./config";

const C = CFG;

/** 类型随本模块再导出:消费方(ui 层/tools)只认活动域,不直接摸 config 表 */
export type { ActivityDef, ActivityKind, ActivityStat };

// ---------- 存档结构 ----------

/** 单侧(每日或每周)的进度账:prog 键 = 任务 id */
export interface QuestSide {
  prog: Record<string, number>;
  claimed: string[];
}

/** Profile.quests 的形状:d/w 是戳,两侧各记各的(跨天只重置 daily 侧) */
export interface QuestSave {
  d: string;
  w: string;
  daily: QuestSide;
  weekly: QuestSide;
}

/** 全勤宝箱在 claimed 里的两个 id(不是任务,questViews/claimInfo 单独认) */
export const CHEST_IDS: Record<ActivityKind, string> = { daily: "d-chest", weekly: "w-chest" };

// ---------- 戳:本地时区,now 作入参(测试好摆拍) ----------

const p2 = (n: number): string => (n < 10 ? "0" + n : "" + n);

/** 日戳:本地时区 YYYY-MM-DD。过了午夜第一次进 profile() 就会因戳变重置每日侧 */
export function dayStamp(now: Date): string {
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

/**
 * 周戳:ISO 周 YYYY-Www,周一为一周之始、重置边界是周一 0 点(本地时区)。
 * 算法:取「本周四」(ISO 定义一周属于哪年看周四),与该年第 1 周的周四比差几周。
 */
export function weekStamp(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);            // 滚到本周四
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Thu = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7) + 3);
  const week = Math.round((d.getTime() - week1Thu.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${p2(week)}`;
}

// ---------- 轮换抽样 ----------

/** 字符串 → 32 位种子(FNV-1a):日戳的散列,同日恒定 */
function hashStamp(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32(与 render/p5kit 同款;core 不许反向 import render,就地另写) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyPool(): ActivityDef[] {
  return C.activities.filter((a) => a.kind === "daily");
}

function weeklyPool(): ActivityDef[] {
  return C.activities.filter((a) => a.kind === "weekly");
}

/** 某一侧当前该显示的任务清单:每日 = 今天抽中的 dailyPick 条;每周 = 固定全量 */
export function questsOf(kind: ActivityKind, now: Date): ActivityDef[] {
  if (kind === "weekly") return weeklyPool();
  const rnd = mulberry32(hashStamp(dayStamp(now)));
  const shuffled = [...dailyPool()];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(C.activity.dailyPick, shuffled.length));
}

// ---------- 归一化与重置(career.profile() 归一化末尾调) ----------

export function freshQuestSave(now: Date): QuestSave {
  return {
    d: dayStamp(now),
    w: weekStamp(now),
    daily: { prog: {}, claimed: [] },
    weekly: { prog: {}, claimed: [] },
  };
}

/**
 * 戳比对即重置 + 坏档兜底(手改存档把 prog/claimed 写坏不崩,兜成空账)。
 * 就地改传入对象并返回:调用方(career.profile())存的就是这个引用。
 */
export function normalizeQuests(q: QuestSave | undefined, now: Date): QuestSave {
  const base: QuestSave = q && typeof q === "object" ? q : freshQuestSave(now);
  if (!base.daily || typeof base.daily !== "object") base.daily = { prog: {}, claimed: [] };
  if (!base.weekly || typeof base.weekly !== "object") base.weekly = { prog: {}, claimed: [] };
  for (const side of [base.daily, base.weekly]) {
    if (!side.prog || typeof side.prog !== "object") side.prog = {};
    if (!Array.isArray(side.claimed)) side.claimed = [];
  }
  const d = dayStamp(now);
  const w = weekStamp(now);
  if (base.d !== d) { base.d = d; base.daily = { prog: {}, claimed: [] }; }
  if (base.w !== w) { base.w = w; base.weekly = { prog: {}, claimed: [] }; }
  return base;
}

// ---------- 进度记录(只加法与夹紧;发放是 career.claimActivity 的事) ----------

/** 一场对局喂给任务账的增量(match/win 与生涯统计同口径,2p 也算完成) */
export interface MatchActivityEvent {
  won: boolean;
  smashes?: number;
  sweets?: number;
  perfects?: number;
  /** 无限练习收局的终局个人得分(max 型任务的输入;其他模式不带) */
  endlessScore?: number;
}

const sideOf = (q: QuestSave, kind: ActivityKind): QuestSide => (kind === "daily" ? q.daily : q.weekly);

/**
 * 把 delta 记进某一侧:sum 累加 / max 取最好,进度夹紧到 target。
 * 返回本次「从未达变成达成且未领」的任务 id(给结算飘字播报,别在 UI 里再算一遍)。
 */
function recordSide(q: QuestSave, kind: ActivityKind, delta: Partial<Record<ActivityStat, number>>, now: Date): string[] {
  normalizeQuests(q, now);
  const side = sideOf(q, kind);
  const doneNow: string[] = [];
  for (const def of questsOf(kind, now)) {
    const add = delta[def.stat];
    if (add === undefined) continue;
    const before = side.prog[def.id] || 0;
    const after = def.mode === "max" ? Math.max(before, add) : before + add;
    side.prog[def.id] = Math.min(after, def.target);
    if (before < def.target && after >= def.target && !side.claimed.includes(def.id)) doneNow.push(def.id);
  }
  return doneNow;
}

/** 一场对局结束:同一场同时喂每日与每周两侧(该侧任务表里 stat 没对上的维度自动跳过) */
export function recordMatch(q: QuestSave, ev: MatchActivityEvent, now: Date): string[] {
  const delta: Partial<Record<ActivityStat, number>> = {
    match: 1,
    win: ev.won ? 1 : 0,
    smash: ev.smashes || 0,
    sweet: ev.sweets || 0,
    perfect: ev.perfects || 0,
  };
  if (ev.endlessScore !== undefined) delta.endlessScore = ev.endlessScore;
  return [...recordSide(q, "daily", delta, now), ...recordSide(q, "weekly", delta, now)];
}

/** 一次训练关结束(走 settleDrill,不走 settle —— 训练不算「完成一局比赛」) */
export function recordDrill(q: QuestSave, now: Date): string[] {
  return [...recordSide(q, "daily", { drill: 1 }, now), ...recordSide(q, "weekly", { drill: 1 }, now)];
}

// ---------- 领取校验与记账(career.claimActivity 的两半,发放本身在 career) ----------

function defsOf(kind: ActivityKind, now: Date): Map<string, ActivityDef> {
  return new Map(questsOf(kind, now).map((def) => [def.id, def]));
}

/** id 可以领吗、领多少:任务 id 或宝箱 id;无可领(未达成/已领/不认识)返回 null */
export function claimInfo(q: QuestSave, id: string, now: Date): { coin: number; exp: number } | null {
  normalizeQuests(q, now);
  for (const kind of ["daily", "weekly"] as ActivityKind[]) {
    const side = sideOf(q, kind);
    if (id === CHEST_IDS[kind]) {
      const defs = questsOf(kind, now);
      const allDone = defs.length > 0 && defs.every((def) => (side.prog[def.id] || 0) >= def.target);
      if (!allDone || side.claimed.includes(id)) return null;
      return { coin: C.activity.chest[kind].coin, exp: 0 };
    }
    const def = defsOf(kind, now).get(id);
    if (def && (side.prog[def.id] || 0) >= def.target && !side.claimed.includes(id)) {
      return { coin: def.coin, exp: def.exp };
    }
  }
  return null;
}

/** 发完钱再调(顺序别反):记入已领账。id 属于哪一侧由任务表/宝箱 id 判,不认前缀 */
export function markClaimed(q: QuestSave, id: string, now: Date): void {
  normalizeQuests(q, now);
  const isDaily = id === CHEST_IDS.daily || dailyPool().some((a) => a.id === id);
  (isDaily ? q.daily : q.weekly).claimed.push(id);
}

// ---------- 视图(首页横幅副行与活动面板共用这一份) ----------

export interface QuestView {
  id: string;
  title: string;
  /** 已夹紧的进度与目标(UI 拼「7/10」用) */
  prog: number;
  target: number;
  done: boolean;
  claimable: boolean;
  claimed: boolean;
  coin: number;
  exp: number;
}

export interface ChestView {
  claimable: boolean;
  claimed: boolean;
  coin: number;
}

export interface ActivityViews {
  daily: QuestView[];
  weekly: QuestView[];
  dailyChest: ChestView;
  weeklyChest: ChestView;
  /** 有没有可领的(任务或宝箱)—— 首页横幅金色高亮用 */
  anyClaimable: boolean;
  /** 可领的条目数(任务 + 宝箱)—— 首页横幅「N 项奖励可领」用 */
  claimableCount: number;
  /** 今日已完成/总数(首页横幅「今日 2/3」用) */
  dailyDone: number;
  dailyTotal: number;
}

function sideViews(q: QuestSave, kind: ActivityKind, now: Date): { views: QuestView[]; side: QuestSide } {
  const side = sideOf(q, kind);
  const views = questsOf(kind, now).map((def) => {
    const prog = Math.min(side.prog[def.id] || 0, def.target);
    const claimed = side.claimed.includes(def.id);
    const done = prog >= def.target;
    return {
      id: def.id, title: def.title, prog, target: def.target,
      done, claimed, claimable: done && !claimed,
      coin: def.coin, exp: def.exp,
    };
  });
  return { views, side };
}

function chestView(q: QuestSave, kind: ActivityKind, views: QuestView[], now: Date): ChestView {
  const side = sideOf(q, kind);
  const claimed = side.claimed.includes(CHEST_IDS[kind]);
  const allDone = views.length > 0 && views.every((v) => v.done);
  return { claimed, claimable: allDone && !claimed, coin: C.activity.chest[kind].coin };
}

export function questViews(q: QuestSave, now: Date): ActivityViews {
  normalizeQuests(q, now);
  const daily = sideViews(q, "daily", now);
  const weekly = sideViews(q, "weekly", now);
  const dailyChest = chestView(q, "daily", daily.views, now);
  const weeklyChest = chestView(q, "weekly", weekly.views, now);
  const claimableTasks = [...daily.views, ...weekly.views].filter((v) => v.claimable).length;
  const claimableCount = claimableTasks + (dailyChest.claimable ? 1 : 0) + (weeklyChest.claimable ? 1 : 0);
  return {
    daily: daily.views,
    weekly: weekly.views,
    dailyChest,
    weeklyChest,
    anyClaimable: claimableCount > 0,
    claimableCount,
    dailyDone: daily.views.filter((v) => v.done).length,
    dailyTotal: daily.views.length,
  };
}

/** 任务 id → 面板标题(结算飘字播报「活动完成 · XXX」用,找不到原样返回 id) */
export function questTitle(id: string): string {
  return C.activities.find((a) => a.id === id)?.title ?? id;
}
