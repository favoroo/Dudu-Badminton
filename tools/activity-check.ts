// ============================================================
// 活动闸门:每日/每周任务 → 首页横幅 + 活动面板领取金币+经验(2026-10-07 活动板块)。
//
// 这条链坏的时候不崩不报错 —— 进度记了不涨、跨天没重置、领了没进账、同一宝箱领两遍、
// 每周进度被跨天清掉,全都只有真机玩到那一步才知道,所以判据进闸门:
//   ① 表完整性:id 唯一且前缀与 kind 一致(d-*→daily / w-*→weekly,阈值/日期不进 id,
//      轮换轮的是「抽中哪几条」)、奖励为正、target 为正、stat 在词表、
//      daily 池 ≥ CFG.activity.dailyPick(抽不满就是面板开天窗)
//   ② 轮换稳定:同一天任何时刻抽到的每日清单都一样(种子=日戳),长度 = dailyPick
//   ③ 记录口径:sum 累加 / max 取最好,进度夹紧到 target;返回「本次新完成且未领」
//   ④ 重置口径:跨天只清每日侧(每周进度必须活过跨天)、跨周只清每周侧、坏档兜空账
//   ⑤ 领取链(走 Career):未达标拦 / 重复领拦 / 数值正确 / 宝箱要全达成才可领且只领一次
//   ⑥ 经济同轨:claimActivity 的经验必须走 addExp(不许另抄升级曲线),面板不直改钱包
//   ⑦ 视图契约:questViews 三态(进行中/可领取/已领取)+ 宝箱态 + 可领数,与手算对账
//   ⑧ 版式判据:activityOverlaps/activityOverflow 全绿,行内五格吃 config 真文案量宽
//   ⑨ 接线扫源码:settle 里记进度、settleDrill 里记训练、claimActivity 走 addExp、
//      面板走 Career.claimActivity/activityViews + progressDL、ui-manager 三处登记 openActivity
//   ⑩ 摆放锚点扫源码:place() 必须把水平对齐与锚点跟摆放 align 钉成一致 —— mkLabel
//      创建时不传 align 的 Label 是中心锚,只按格缘摆节点 = 文字以格缘为中心向两边溢出
//      (2026-10-07 真机:奖励读数压进按钮、宝箱副句飘出卡外;出图按 SVG start/end 画,
//      预览看不见,只有真机有)
// 另带 --selftest:十五份反例(id 撞车 / 前缀不符 / 零奖励 / 词表外的 stat / dailyPick 超池 /
// 记录不夹紧 / 重置错侧 / claimInfo 漏拦未达成 / 宝箱可重复领 / UI 直改钱包 / 面板漏接领取 /
// place 不钉对齐锚点)必须被拦下。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/activity-check.js [--selftest]
// ============================================================
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CFG, type ActivityDef, type ActivityKind, type ActivityStat } from "../assets/scripts/core/config";
import { Career, type Profile } from "../assets/scripts/core/career";
import {
  CHEST_IDS, claimInfo, markClaimed, normalizeQuests, questViews, questsOf, recordMatch,
  freshQuestSave, dayStamp, weekStamp, questTitle,
  type MatchActivityEvent, type QuestSave,
} from "../assets/scripts/core/activity";
import {
  activityOverlaps, activityOverflow, judgeChestRow, judgeQuestRow,
} from "../assets/scripts/ui/activity-layout";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (c: boolean, m: string): void => h.ok(c, m);

function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets/scripts/ui/ui-arcade.ts"))) return dir;
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  throw new Error("找不到工程根(assets/scripts/ui/ui-arcade.ts)");
}
const ROOT = findRoot();
const UI = join(ROOT, "assets/scripts/ui");
const CORE = join(ROOT, "assets/scripts/core");

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const STATS: ActivityStat[] = ["match", "win", "smash", "sweet", "perfect", "drill", "endlessScore"];

// ---------- ① 表完整性(判据吃表,反例喂坏表) ----------
export function judgeTable(defs: ActivityDef[], dailyPick: number): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const d of defs) {
    if (ids.has(d.id)) out.push(`活动 id 重复:${d.id}`);
    ids.add(d.id);
    const wantPrefix = d.kind === "daily" ? "d-" : "w-";
    if (!d.id.startsWith(wantPrefix)) out.push(`活动 ${d.id} 的前缀与 kind=${d.kind} 不符(应为 ${wantPrefix}*)`);
    if (/\d{4}/.test(d.id)) out.push(`活动 ${d.id} 的 id 里掺了日期(轮换不换 id,已领记录靠戳重置)`);
    if (!(d.coin > 0) || !(d.exp > 0)) out.push(`活动 ${d.id} 奖励必须为正(coin=${d.coin}, exp=${d.exp})`);
    if (!(d.target > 0)) out.push(`活动 ${d.id} 的 target 必须为正(实际 ${d.target})`);
    if (!STATS.includes(d.stat)) out.push(`活动 ${d.id} 的统计键「${d.stat}」不在词表里(结算喂不进进度)`);
    if (d.mode !== "sum" && d.mode !== "max") out.push(`活动 ${d.id} 的 mode 非法:${d.mode}`);
    if (!d.title.trim()) out.push(`活动 ${d.id} 没有标题文案`);
  }
  const daily = defs.filter((d) => d.kind === "daily");
  const weekly = defs.filter((d) => d.kind === "weekly");
  if (daily.length < dailyPick) out.push(`每日池只有 ${daily.length} 条,抽不满 dailyPick=${dailyPick}(面板开天窗)`);
  if (!weekly.length) out.push("每周侧一条任务都没有");
  return out;
}

// ---------- ② 轮换稳定(判据吃抽样函数,反例喂「每次重掷」的坏版) ----------
export type PickFn = (kind: ActivityKind, now: Date) => ActivityDef[];
export function judgeRotate(fn: PickFn): string[] {
  const out: string[] = [];
  const day = new Date(2026, 9, 7, 15);
  const picks = [new Date(2026, 9, 7, 0, 1), new Date(2026, 9, 7, 12), new Date(2026, 9, 7, 23, 59)]
    .map((t) => fn("daily", t).map((d) => d.id).join(","));
  if (picks[0] !== picks[1] || picks[1] !== picks[2]) {
    out.push(`同一天抽到的每日清单不一致:${picks.join(" | ")}`);
  }
  if (fn("daily", day).length !== Math.min(CFG.activity.dailyPick, CFG.activities.filter((d) => d.kind === "daily").length)) {
    out.push("每日清单长度 ≠ dailyPick");
  }
  const pool = new Set(CFG.activities.filter((d) => d.kind === "daily").map((d) => d.id));
  for (const d of fn("daily", day)) {
    if (!pool.has(d.id)) out.push(`抽出了池外的任务:${d.id}`);
  }
  return out;
}

// ---------- ③ 记录口径(判据吃记录函数,反例喂「不夹紧」的坏版) ----------
export type RecordFn = (q: QuestSave, ev: MatchActivityEvent, now: Date) => string[];
export function judgeRecord(fn: RecordFn): string[] {
  const out: string[] = [];
  const now = new Date(2026, 9, 7, 15);
  // sum 累加:连打两局,match/win 两侧都记
  const q1 = freshQuestSave(now);
  fn(q1, { won: true, smashes: 3, sweets: 4 }, now);
  fn(q1, { won: false, smashes: 2, sweets: 1 }, now);
  const winDef = CFG.activities.find((d) => d.stat === "win" && d.kind === "weekly");
  if (winDef && q1.weekly.prog[winDef.id] !== 1) out.push(`胜场没记上:w-${winDef.id}=${q1.weekly.prog[winDef.id]},应为 1`);
  const smashW = CFG.activities.find((d) => d.stat === "smash" && d.kind === "weekly");
  if (smashW && q1.weekly.prog[smashW.id] !== 5) out.push(`扣杀累加错:${q1.weekly.prog[smashW.id]},应为 5`);
  // 新完成要回报(id 在当期清单里且恰好跨过 target)
  const dailyPick = questsOf("daily", now);
  const smashD = dailyPick.find((d) => d.stat === "smash" && d.mode === "sum");
  if (smashD && smashD.target === 10) {
    const q = freshQuestSave(now);
    const done = fn(q, { won: false, smashes: 12 }, now);
    if (!done.includes(smashD.id)) out.push(`新完成任务没回报:${smashD.id}`);
    if (q.daily.prog[smashD.id] !== smashD.target) out.push(`进度没夹紧到 target:${q.daily.prog[smashD.id]} ≠ ${smashD.target}`);
  }
  // max 取最好:两局分数 20 再 8,进度留在 20(夹在 target)
  const endD = dailyPick.find((d) => d.stat === "endlessScore");
  if (endD) {
    const q = freshQuestSave(now);
    fn(q, { won: false }, now);    // 非 endless 不带分,不应污染
    fn(q, { won: false, endlessScore: 20 }, now);
    fn(q, { won: false, endlessScore: 8 }, now);
    const want = Math.min(20, endD.target);
    if (q.daily.prog[endD.id] !== want) out.push(`max 型没取最好或没夹紧:${q.daily.prog[endD.id]} ≠ ${want}`);
  }
  // 未跨线的不要误报「新完成」
  const q2 = freshQuestSave(now);
  const done2 = fn(q2, { won: false, smashes: 1 }, now);
  const stillShort = dailyPick.filter((d) => d.mode === "sum" && d.target > 1);
  if (stillShort.some((d) => done2.includes(d.id))) out.push("没达成的任务被误报为新完成");
  return out;
}

// ---------- ④ 重置口径(判据吃归一化函数,反例喂「跨天连每周一起清」的坏版) ----------
export type NormFn = (q: QuestSave | undefined, now: Date) => QuestSave;
export function judgeReset(fn: NormFn): string[] {
  const out: string[] = [];
  const day1 = new Date(2026, 9, 7, 15);
  const day2 = new Date(2026, 9, 8, 9);
  const nextWeek = new Date(2026, 9, 12, 9);   // 周一
  const mk = (): QuestSave => {
    const q = freshQuestSave(day1);
    q.daily.prog["d-match-1"] = 1; q.daily.claimed.push("d-match-1");
    q.weekly.prog["w-match-5"] = 4;
    return q;
  };
  const acrossDay = fn(JSON.parse(JSON.stringify(mk())) as QuestSave, day2);
  if (Object.keys(acrossDay.daily.prog).length || acrossDay.daily.claimed.length) out.push("跨天没清每日侧");
  if (!acrossDay.weekly.prog["w-match-5"]) out.push("跨天把每周进度也清了(每周必须活过跨天)");
  if (acrossDay.d !== dayStamp(day2) || acrossDay.w !== weekStamp(day2)) out.push("跨天/跨周后戳没更新");
  const acrossWeek = fn(JSON.parse(JSON.stringify(mk())) as QuestSave, nextWeek);
  if (Object.keys(acrossWeek.weekly.prog).length) out.push("跨周没清每周侧");
  const sameWeek = fn(JSON.parse(JSON.stringify(mk())) as QuestSave, new Date(2026, 9, 9, 9));
  if (!sameWeek.weekly.prog["w-match-5"]) out.push("同周内把每周进度清了");
  // 坏档兜底:undefined / prog 写坏,不许崩
  try {
    const bad = fn(undefined, day1);
    if (!bad.daily || !bad.weekly) out.push("undefined 档没兜成空账");
    const broken = { d: dayStamp(day1), w: weekStamp(day1), daily: { prog: null, claimed: "x" }, weekly: null } as unknown as QuestSave;
    const fixed = fn(broken, day1);
    if (!fixed.daily.prog || !Array.isArray(fixed.daily.claimed) || !fixed.weekly.prog) out.push("坏档(prog=null/claimed=字符串)没兜回");
  } catch (e) {
    out.push(`归一化对坏档抛了异常:${(e as Error).message}`);
  }
  return out;
}

// ---------- ⑤⑦ 领取链与视图(判据吃实现,正题喂真件、反例喂坏件) ----------
export type ClaimFn = (q: QuestSave, id: string, now: Date) => { coin: number; exp: number } | null;
export function judgeClaim(fn: ClaimFn): string[] {
  const out: string[] = [];
  const now = new Date(2026, 9, 7, 15);
  const defs = questsOf("daily", now);
  // 未达成拦
  const q1 = freshQuestSave(now);
  if (fn(q1, defs[0].id, now) !== null) out.push("未达成的任务被放行领取");
  // 达成数值对
  const q2 = freshQuestSave(now);
  q2.daily.prog[defs[0].id] = defs[0].target;
  const grant = fn(q2, defs[0].id, now);
  if (!grant || grant.coin !== defs[0].coin || grant.exp !== defs[0].exp) {
    out.push(`达成任务的领取数值不对:${JSON.stringify(grant)}`);
  }
  // 重复领拦
  markClaimed(q2, defs[0].id, now);
  if (fn(q2, defs[0].id, now) !== null) out.push("已领的任务被第二遍放行");
  // 宝箱:未全达成拦 / 全达成数值对 / 领过拦
  const q3 = freshQuestSave(now);
  if (fn(q3, CHEST_IDS.daily, now) !== null) out.push("没全达成宝箱就放行了");
  for (const d of defs) q3.daily.prog[d.id] = d.target;
  const chestGrant = fn(q3, CHEST_IDS.daily, now);
  if (!chestGrant || chestGrant.coin !== CFG.activity.chest.daily.coin) {
    out.push(`全达成后宝箱数值不对:${JSON.stringify(chestGrant)}`);
  }
  markClaimed(q3, CHEST_IDS.daily, now);
  if (fn(q3, CHEST_IDS.daily, now) !== null) out.push("宝箱被第二遍放行");
  // 不认识的 id 拦
  if (fn(freshQuestSave(now), "d-nothing", now) !== null) out.push("池外的 id 被放行领取");
  return out;
}

export type ViewsFn = (q: QuestSave, now: Date) => ReturnType<typeof questViews>;
export function judgeViews(fn: ViewsFn): string[] {
  const out: string[] = [];
  const now = new Date(2026, 9, 7, 15);
  const defs = questsOf("daily", now);
  const mk = (patch: (q: QuestSave) => void): QuestSave => {
    const q = freshQuestSave(now);
    patch(q);
    return q;
  };
  // 新档:全部进行中、无可领、宝箱不可领
  const fresh = fn(mk(() => undefined), now);
  if (fresh.daily.length !== Math.min(CFG.activity.dailyPick, defs.length)) out.push("视图的每日条数不对");
  if (fresh.daily.some((v) => v.claimable || v.claimed)) out.push("新档视图冒出可领/已领");
  if (fresh.anyClaimable || fresh.claimableCount !== 0) out.push("新档视图报了可领");
  if (fresh.dailyTotal !== fresh.daily.length || fresh.dailyDone !== 0) out.push("dailyDone/dailyTotal 读数不对");
  // 半程:一条达成未领 → claimable,claimableCount=1;一条已领
  const half = fn(mk((q) => {
    q.daily.prog[defs[0].id] = defs[0].target;
    if (defs[1]) { q.daily.prog[defs[1].id] = defs[1].target; q.daily.claimed.push(defs[1].id); }
  }), now);
  if (!half.daily[0].claimable) out.push("达成未领的任务没报可领");
  if (!half.daily[1]?.claimed || half.daily[1]?.claimable) out.push("已领任务的三态不对");
  if (half.claimableCount !== 1) out.push(`可领数应为 1(实际 ${half.claimableCount})`);
  if (half.dailyDone !== 2) out.push(`dailyDone 应为 2(实际 ${half.dailyDone})`);
  // 宝箱态:全达成未领 → 可领;领过 → claimed 且不再可领
  const full = fn(mk((q) => { for (const d of defs) q.daily.prog[d.id] = d.target; }), now);
  if (!full.dailyChest.claimable) out.push("全达成后宝箱没报可领");
  const fullClaimed = fn(mk((q) => {
    for (const d of defs) { q.daily.prog[d.id] = d.target; q.daily.claimed.push(d.id); }
    q.daily.claimed.push(CHEST_IDS.daily);
  }), now);
  if (!fullClaimed.dailyChest.claimed || fullClaimed.dailyChest.claimable) out.push("宝箱领过之后三态不对");
  if (fullClaimed.claimableCount !== 0) out.push("全领完还报可领数");
  return out;
}

// ---------- ⑨ 接线扫源码(仿 milestone-check ⑧:靠静态扫描兜「不崩不报错」的漏接) ----------
export function judgeWiring(panelSrc: string, label: string): string[] {
  const out: string[] = [];
  const s = strip(panelSrc);
  if (!/Career\.claimActivity\(/.test(s)) out.push(`${label}:面板没有走 Career.claimActivity 领取(漏接线,点了没反应)`);
  if (!/Career\.activityViews\(/.test(s)) out.push(`${label}:面板没喂 Career.activityViews 视图,三态/宝箱读数会是自己另算的一套`);
  if (/\.coins\s*\+=/.test(s)) out.push(`${label}:UI 直接改钱包(.coins +=)—— 发奖记账只许走 Career 一处`);
  if (!/progressDL\(/.test(s)) out.push(`${label}:进度条没走 progressDL(另抄一把尺早晚跟经验条长得不一样)`);
  return out;
}

// ---------- ⑩ 摆放锚点扫源码(仿 ⑨:这类错位不崩不报错、预览看不见,只有真机有) ----------
export function judgePlaceAnchor(panelSrc: string, label: string): string[] {
  const out: string[] = [];
  const m = strip(panelSrc).match(/function place\([\s\S]*?\n\}/);
  if (!m) return [`${label}:找不到 place() 摆放函数(版式格子与 Label 的接驳点丢了)`];
  const body = m[0];
  if (!/horizontalAlign\s*=/.test(body)) {
    out.push(`${label}:place() 没把 Label 水平对齐钉成与摆放一致(创建默认居中,文字以格缘为中心向两边溢出)`);
  }
  if (!/setAnchorPoint\(/.test(body)) {
    out.push(`${label}:place() 没把锚点跟摆放 align 钉成一致(中心锚 Label 摆在格缘 = 半个文字宽溢出格子)`);
  }
  return out;
}

// ---------- 正题 ----------
{
  const bad = judgeTable(CFG.activities, CFG.activity.dailyPick);
  for (const m of bad) ok(false, `活动表 ${m}`);
  ok(bad.length === 0, `① 表完整性:${CFG.activities.length} 条(每日池 ${CFG.activities.filter((d) => d.kind === "daily").length}/每周 ${CFG.activities.filter((d) => d.kind === "weekly").length}),id 前缀合口径、奖励/target 为正`);
}
{
  const bad = judgeRotate(questsOf);
  for (const m of bad) ok(false, `轮换 ${m}`);
  ok(bad.length === 0, "② 轮换稳定:同一天三个时刻抽到的每日清单一致、长度 = dailyPick");
}
{
  const bad = judgeRecord(recordMatch);
  for (const m of bad) ok(false, `记录 ${m}`);
  ok(bad.length === 0, "③ 记录口径:sum 累加 / max 取最好 / 夹紧 target / 新完成有回报");
}
{
  const bad = judgeReset(normalizeQuests);
  for (const m of bad) ok(false, `重置 ${m}`);
  ok(bad.length === 0, "④ 重置口径:跨天只清每日侧、跨周只清每周侧、坏档兜空账不崩");
}
{
  const bad = judgeClaim(claimInfo);
  for (const m of bad) ok(false, `领取校验 ${m}`);
  ok(bad.length === 0, "⑤ 领取校验:未达标拦 / 重复领拦 / 宝箱全达成才放行且只放行一次");
}
{
  const bad = judgeViews(questViews);
  for (const m of bad) ok(false, `视图 ${m}`);
  ok(bad.length === 0, "⑦ 视图契约:三态 + 宝箱态 + 可领数与手算对账");
}

// ---------- ⑤⑥ 真链路:Career 门面(node 下存档走纯内存,不落盘) ----------
{
  const p = Career.profile();
  const now = new Date();
  const resetQuests = (patch?: (q: QuestSave) => void): QuestSave => {
    const q = freshQuestSave(now);
    patch?.(q);
    p.quests = q;
    p.coins = 1000; p.level = 1; p.exp = 0;
    return q;
  };

  const defs = questsOf("daily", now);
  // ⑤ 未达标拦
  resetQuests();
  ok(Career.claimActivity(defs[0].id) === null, "⑤ 未达标领取被拦:claimActivity 返回 null");
  // ⑤ 达成领取数值 + 记账 + 幂等
  resetQuests((q) => { q.daily.prog[defs[0].id] = defs[0].target; });
  const r1 = Career.claimActivity(defs[0].id);
  ok(!!r1 && r1.coin === defs[0].coin && r1.exp === defs[0].exp, `⑤ 任务领取数值正确(实际 ${JSON.stringify(r1)})`);
  ok(Career.claimActivity(defs[0].id) === null, "⑤ 重复领取被拦(幂等)");
  ok(p.quests!.daily.claimed.includes(defs[0].id), "⑤ 已领记录落档");
  // ⑤ 宝箱全达成
  resetQuests((q) => { for (const d of defs) q.daily.prog[d.id] = d.target; });
  ok(Career.claimActivity(CHEST_IDS.daily)!.coin === CFG.activity.chest.daily.coin, `⑤ 全达成后宝箱可领 +${CFG.activity.chest.daily.coin}`);
  ok(Career.claimActivity(CHEST_IDS.daily) === null, "⑤ 宝箱重复领取被拦");
  // ⑥ 经济同轨:经验走 addExp(升级金币同步发)
  resetQuests((q) => { q.daily.prog[defs[0].id] = defs[0].target; });
  p.exp = Career.expNeed(1) - defs[0].exp + 5;   // 领完刚好过线 5 点 → 升 Lv.2(不硬编码 expBase,当期抽中哪条都成立)
  const c0 = p.coins;
  const r2 = Career.claimActivity(defs[0].id)!;
  ok(r2.levelUps.length === 1 && p.level === 2, `⑥ 经验走 addExp 曲线升级(实际 level=${p.level}, levelUps=${JSON.stringify(r2.levelUps)})`);
  ok(p.coins === c0 + defs[0].coin + Career.levelCoin(2), "⑥ 升级金币随 addExp 同步发(不许吞掉也不许双发)");
  // ⑥ 满级:经验清零不膨胀
  resetQuests((q) => { q.daily.prog[defs[0].id] = defs[0].target; });
  p.level = CFG.career.level.cap; p.exp = 0;
  Career.claimActivity(defs[0].id);
  ok(p.level === CFG.career.level.cap && p.exp === 0, "⑥ 满级:经验清零不膨胀、不再升级");
  // ⑦ 首页读数:questViews 的 anyClaimable 与「有无可领」一致
  resetQuests((q) => { for (const d of defs) q.daily.prog[d.id] = d.target; });
  const av = Career.activityViews();
  ok(av.anyClaimable && av.claimableCount === defs.length + 1, `⑦ 首页读数:全达成未领时可领数 = 任务+宝箱(实际 ${av.claimableCount})`);
  resetQuests();
  ok(!Career.activityViews().anyClaimable, "⑦ 新一期无可领");
}

// ---------- ⑧ 版式判据(吃 config 真文案) ----------
{
  const bad: string[] = [...activityOverlaps(), ...activityOverflow()];
  for (const def of CFG.activities) {
    // 进度读数按最坏摆拍(数字到 target 位数最满),标题/奖励吃真文案
    bad.push(...judgeQuestRow(def.title, `+${def.coin}币 +${def.exp}经验`, `${def.target}/${def.target}`));
  }
  bad.push(...judgeChestRow("本周任务全部完成可领"));
  for (const m of bad) ok(false, `活动版式 ${m}`);
  ok(bad.length === 0, "⑧ 版式:骨架不压不溢,全部任务真文案塞得进行内五格");
  ok(questTitle("d-match-1") === "完成一局比赛" && questTitle("d-nothing") === "d-nothing",
    "⑧ questTitle:表内查得到、查不到原样回落(飘字不吐 undefined)");
}

// ---------- ⑨ 接线扫源码 ----------
{
  const w = judgeWiring(readFileSync(join(UI, "activity-panel.ts"), "utf8"), "activity-panel");
  for (const m of w) ok(false, `面板接线 ${m}`);
  ok(w.length === 0, "⑨ 面板接线:走 Career.claimActivity/activityViews + progressDL,不直改钱包");

  const careerSrc = readFileSync(join(CORE, "career.ts"), "utf8");
  const settleBody = careerSrc.slice(careerSrc.indexOf("function settle("), careerSrc.indexOf("function settleDrill("));
  ok(/questRecordMatch\(p\.quests!/.test(strip(settleBody)), "⑨ settle 里必须调 questRecordMatch 记任务进度(漏了任务永远 0 进度)");
  const drillBody = careerSrc.slice(careerSrc.indexOf("function settleDrill("), careerSrc.indexOf("export interface MilestoneClaim"));
  ok(/questRecordDrill\(p\.quests!/.test(strip(drillBody)), "⑨ settleDrill 里必须调 questRecordDrill(训练类任务没进度)");
  const claimBody = careerSrc.slice(careerSrc.indexOf("function claimActivity("), careerSrc.indexOf("function activityViews("));
  const claimS = strip(claimBody);
  ok(/questClaimInfo\(p\.quests!/.test(claimS) && /questMarkClaimed\(p\.quests!/.test(claimS),
    "⑨ claimActivity 必须先校验(claimInfo)再记账(markClaimed)");
  ok(/addExp\(p, grant\.exp\)/.test(claimS), "⑨ claimActivity 的经验必须走 addExp(不许另抄曲线)");

  const umSrc = strip(readFileSync(join(UI, "ui-manager.ts"), "utf8"));
  const openCount = (umSrc.match(/openActivity/g) ?? []).length;
  ok(openCount >= 3, `⑨ ui-manager 的 openActivity 三处登记(接口/实现/注入)齐全(实际出现 ${openCount} 次)`);
  const menuSrc = strip(readFileSync(join(UI, "main-menu.ts"), "utf8"));
  ok(/kit\.openActivity\(\)/.test(menuSrc), "⑨ 首页横幅必须接 kit.openActivity(漏了就是看得见点不着)");
  ok(/Career\.activityViews\(\)/.test(menuSrc), "⑨ 首页副行吃 Career.activityViews(别在菜单里另算一遍)");
}

// ---------- ⑩ 摆放锚点 ----------
{
  const bad = judgePlaceAnchor(readFileSync(join(UI, "activity-panel.ts"), "utf8"), "activity-panel");
  for (const m of bad) ok(false, `摆放锚点 ${m}`);
  ok(bad.length === 0, "⑩ place() 把水平对齐与锚点跟摆放 align 钉成一致(缘摆不钉 = 文字溢出格子)");
}

// ---------- selftest:反例必须被拦下(防规则脚本悄悄全绿) ----------
if (process.argv.includes("--selftest")) {
  const base: ActivityDef[] = [...CFG.activities];
  const swap = (id: string, patch: Partial<ActivityDef>): ActivityDef[] =>
    base.map((d) => (d.id === id ? { ...d, ...patch } : d));
  const pick = CFG.activity.dailyPick;
  const noClamp: RecordFn = (q, ev, now) => {
    // 坏版:sum 不夹紧、max 也不夹紧,其它照抄真实现
    const delta: Partial<Record<ActivityStat, number>> = {
      match: 1, win: ev.won ? 1 : 0, smash: ev.smashes || 0, sweet: ev.sweets || 0, perfect: ev.perfects || 0,
    };
    if (ev.endlessScore !== undefined) delta.endlessScore = ev.endlessScore;
    const done: string[] = [];
    for (const kind of ["daily", "weekly"] as ActivityKind[]) {
      const side = kind === "daily" ? q.daily : q.weekly;
      for (const def of questsOf(kind, now)) {
        const add = delta[def.stat];
        if (add === undefined) continue;
        const before = side.prog[def.id] || 0;
        const after = def.mode === "max" ? Math.max(before, add) : before + add;
        side.prog[def.id] = after;   // ← 不夹紧
        if (before < def.target && after >= def.target && !side.claimed.includes(def.id)) done.push(def.id);
      }
    }
    return done;
  };
  const resetWrongSide: NormFn = (q, _now) => {
    // 坏版:每周侧每次都清(每周进度活不过跨天,同周内也会被清)
    const base2 = normalizeQuests(q, _now);
    base2.weekly = { prog: {}, claimed: [] };
    return base2;
  };
  const claimAnything: ClaimFn = (q, id, now) => {
    // 坏版:不校验达成与否,照表发钱
    for (const kind of ["daily", "weekly"] as ActivityKind[]) {
      const def = questsOf(kind, now).find((d) => d.id === id);
      if (def) return { coin: def.coin, exp: def.exp };
      if (id === CHEST_IDS[kind]) return { coin: CFG.activity.chest[kind].coin, exp: 0 };
    }
    return null;
  };
  const claimTwice: ClaimFn = (q, id, now) => {
    // 坏版:已领的不拦(宝箱可无限刷)
    void q;
    for (const kind of ["daily", "weekly"] as ActivityKind[]) {
      if (id === CHEST_IDS[kind]) return { coin: CFG.activity.chest[kind].coin, exp: 0 };
      const def = questsOf(kind, now).find((d) => d.id === id);
      if (def) return { coin: def.coin, exp: def.exp };
    }
    return null;
  };
  let reshuffleN = 0;
  const reshuffleEveryCall: PickFn = () => {
    // 坏版:每次调用轮转一档(同一天清单漂)
    const pool = base.filter((d) => d.kind === "daily");
    reshuffleN++;
    const k = reshuffleN % pool.length;
    return [...pool.slice(k), ...pool.slice(0, k)].slice(0, Math.min(pick, pool.length));
  };
  const hideClaimable: ViewsFn = (q, now) => {
    const v = questViews(q, now);
    for (const side of ["daily", "weekly"] as ActivityKind[]) {
      for (const item of v[side]) item.claimable = false;
      v[side === "daily" ? "dailyChest" : "weeklyChest"].claimable = false;
    }
    v.anyClaimable = false; v.claimableCount = 0;
    return v;
  };
  const cases: Array<[string, string[]]> = [
    ["id 撞车", judgeTable([...base, base[0]], pick)],
    ["前缀与 kind 不符(weekly 挂 d-)", judgeTable(swap("w-match-5", { id: "d-match-5" }), pick)],
    ["id 里掺日期(调日期就丢已领记录)", judgeTable(swap("d-match-1", { id: "d-match-1-20261007" }), pick)],
    ["零奖励(白跑一趟)", judgeTable(swap("d-match-1", { coin: 0 }), pick)],
    ["词表外的统计键(结算喂不进)", judgeTable(swap("d-match-1", { stat: "maxRally" as ActivityStat }), pick)],
    ["每日池小于 dailyPick(面板开天窗)", judgeTable(base.filter((d) => d.kind !== "daily"), pick)],
    ["同一天清单漂移(每次重掷)", judgeRotate(reshuffleEveryCall)],
    ["进度不夹紧(数字涨到天上去)", judgeRecord(noClamp)],
    ["跨天把每周进度也清了", judgeReset(resetWrongSide)],
    ["claimInfo 不校验达成(没做完也能领)", judgeClaim(claimAnything)],
    ["宝箱可重复领取(无限刷币)", judgeClaim(claimTwice)],
    ["视图漏报可领(玩家领不到该领的)", judgeViews(hideClaimable)],
    ["UI 直改钱包(绕过 Career 的记账)", judgeWiring("function claim() { p.coins += 40; }", "sample-bad")],
    ["面板漏接领取(点击无反应)", judgeWiring('function refresh() { Career.activityViews(); progressDL(1, 1, 1, "#fff"); }', "sample-bad")],
    ["place 不钉对齐与锚点(旧版:奖励读数压进按钮、副句飘出卡外)", judgePlaceAnchor(
      "function place(l: Label, b: Box, align: 0 | 1 | 2 = 1): void {"
      + " const w = b.right - b.left;"
      + " l.node.getComponent(UITransform)!.setContentSize(w, b.h);"
      + " l.overflow = Label.Overflow.CLAMP;"
      + " l.node.setPosition(align === 0 ? b.left : align === 2 ? b.right : b.left + w / 2, b.cy, 0);\n}",
      "sample-bad")],
  ];
  for (const [nm, msgs] of cases) {
    ok(msgs.length > 0, `反例被拦下:${nm}(${msgs.length} 条)`);
  }
  ok(judgeWiring(readFileSync(join(UI, "activity-panel.ts"), "utf8"), "activity-panel").length === 0,
    "正例:真面板的领取接线过闸");
  process.exit(h.fails === 0 ? 0 : 1);
}

console.log(h.fails === 0
  ? `\n✓ activity-check:${h.checks} 项断言全绿`
  : `\n✗ activity-check:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
