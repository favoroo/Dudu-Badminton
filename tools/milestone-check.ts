// ============================================================
// 生涯里程碑闸门:六格统计达成 → 生涯面板整卡点击一次性领金币+经验。
//
// 现场(用户 2026-10-07):「生涯这里某一项达到一个数字的时候就可以领取奖励,
// 在这里领取奖励金币经验这些。」这条链坏的时候不崩不报错 —— 领了没进账、
// 同一档领两遍、老档进来直接 TypeError,全都只有真机点那一下才知道,所以判据进闸门:
//   ① 表完整性:六项各有档、阈值严格递增、奖励为正、id 唯一且恒为
//      「ms-<stat>-<档位序号>」—— 阈值日后调整不换 id,老档的已领记录不失义,
//      所以**不许**把阈值写进 id
//   ② 未达标领取被拦(claim 返回 null,claimed 原样)
//   ③ 重复领取被拦(幂等:领过的档第二下返回 null)
//   ④ 合并发奖:一次点按领走该格全部已达成的未领档,数值 = 各档之和,id 全落档
//   ⑤ 经济同轨:经验必须走 addExp 同一条曲线(升级金币同步发、满级经验清零),
//      面板侧不许直改钱包 —— 复制一份升级曲线出来早晚漂移成两套(career.addExp 头注同款警告)
//   ⑥ 存档归一化:老档缺 claimed 键补 []、手改 null 兜回 [],领奖链不许 TypeError
//   ⑦ 口径同源:statCells 的胜率大数 = statValue 现值(不许两处各算一份),
//      副行三态(可领/下一档/已领满)文案与 claim 字段对得上
//   ⑧ 接线扫源码:面板走 Career.claimMilestone + pressable 整卡可点 + 喂 milestoneViews
//      视图;shop-shelf 的胜率吃 core/milestone;claimMilestone 函数体内必须出现 addExp
// 另带 --selftest:十份反例(阈值不递增 / 阈值写进 id / 缺档 / 零奖励 / 混入六格外的键 /
// 视图漏报可领 / 已领计入合计 / nextAt 指向已领档 / UI 直改钱包 / 面板漏接领取)必须被拦下。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/milestone-check.js [--selftest]
// ============================================================
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CFG, type MilestoneDef, type MilestoneStat } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";
import type { Profile } from "../assets/scripts/core/career";
import {
  MILESTONE_STATS, milestoneViews, statValue,
  type MilestoneStats, type MilestoneView,
} from "../assets/scripts/core/milestone";
import { statCells } from "../assets/scripts/ui/shop-shelf";
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

// ---------- ① 表完整性(判据吃表,反例喂坏表) ----------
function judgeTable(defs: MilestoneDef[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const d of defs) {
    if (ids.has(d.id)) out.push(`里程碑 id 重复:${d.id}`);
    ids.add(d.id);
    if (!(d.coin > 0) || !(d.exp > 0)) out.push(`里程碑 ${d.id} 奖励必须为正(coin=${d.coin}, exp=${d.exp})`);
    if (!MILESTONE_STATS.some((m) => m.key === d.stat)) {
      out.push(`里程碑 ${d.id} 的统计键「${d.stat}」不在六格词表里(六格之外没有卡片承载)`);
    }
  }
  for (const { key } of MILESTONE_STATS) {
    const tiers = defs.filter((d) => d.stat === key);
    if (!tiers.length) { out.push(`统计「${key}」一个里程碑档都没有`); continue; }
    let prev = -Infinity;
    tiers.forEach((d, i) => {
      if (d.at <= prev) out.push(`统计「${key}」档位阈值不递增(${d.id}: ${d.at} ≤ 上一档 ${prev})`);
      prev = d.at;
      if (d.id !== `ms-${key}-${i + 1}`) {
        out.push(`里程碑 id 不合「ms-<stat>-<序号>」口径:${d.id}(应为 ms-${key}-${i + 1})`);
      }
    });
  }
  return out;
}

// ---------- 视图契约(判据吃实现,正题喂 milestoneViews、反例喂坏视图) ----------
type ViewsFn = (st: MilestoneStats, bestEndless: number, claimed: string[] | undefined)
  => Record<MilestoneStat, MilestoneView>;

function judgeView(fn: ViewsFn): string[] {
  const out: string[] = [];
  const cases: Array<[string, MilestoneStats, number, string[] | undefined]> = [
    ["新档", { matches: 0, wins: 0, smashes: 0, perfects: 0, sweets: 0, maxRally: 0 }, 0, undefined],
    ["半程", { matches: 10, wins: 4, smashes: 25, perfects: 3, sweets: 8, maxRally: 12 }, 7, []],
    ["越顶", { matches: 30, wins: 25, smashes: 999, perfects: 999, sweets: 999, maxRally: 99 }, 999, ["ms-smashes-1"]],
    ["全领", { matches: 30, wins: 25, smashes: 999, perfects: 999, sweets: 999, maxRally: 99 }, 999,
      CFG.milestones.map((m) => m.id)],
  ];
  for (const [nm, st, endless, claimed] of cases) {
    const views = fn(st, endless, claimed);
    for (const { key } of MILESTONE_STATS) {
      const v = views?.[key];
      if (!v) { out.push(`${nm}/${key}:视图缺格`); continue; }
      const tiers = CFG.milestones.filter((m) => m.stat === key);
      const claimedSet = new Set(claimed ?? []);
      const value = statValue(key, st, endless);
      const un = tiers.filter((d) => !claimedSet.has(d.id));
      const reach = un.filter((d) => value >= d.at);
      const want = (pick: (d: MilestoneDef) => number): number => reach.reduce((a, d) => a + pick(d), 0);
      if (v.claimable !== reach.length > 0) out.push(`${nm}/${key}:claimable=${v.claimable},应为 ${reach.length > 0}`);
      if (v.claimCoin !== want((d) => d.coin)) out.push(`${nm}/${key}:claimCoin=${v.claimCoin},应为 ${want((d) => d.coin)}(漏档或把已领档计进来)`);
      if (v.claimExp !== want((d) => d.exp)) out.push(`${nm}/${key}:claimExp=${v.claimExp},应为 ${want((d) => d.exp)}`);
      if (v.nextAt !== (un.length ? un[0].at : null)) {
        out.push(`${nm}/${key}:nextAt=${v.nextAt},应为 ${un.length ? un[0].at : null}`);
      }
      if (v.allDone !== (un.length === 0 && tiers.length > 0)) out.push(`${nm}/${key}:allDone=${v.allDone},应为 ${un.length === 0 && tiers.length > 0}`);
      if (v.done !== tiers.length - un.length) out.push(`${nm}/${key}:done=${v.done},应为 ${tiers.length - un.length}`);
    }
  }
  return out;
}

// ---------- ⑧ 接线扫源码(仿 panel-check ⑫:靠静态扫描兜「不崩不报错」的漏接) ----------
export function judgeWiring(src: string, label: string): string[] {
  const out: string[] = [];
  const s = strip(src);
  if (!/Career\.claimMilestone\(/.test(s)) out.push(`${label}:面板没有走 Career.claimMilestone 领取(漏接线,点了没反应)`);
  if (/\.coins\s*\+=/.test(s)) out.push(`${label}:UI 直接改钱包(.coins +=)—— 发奖记账只许走 Career 一处`);
  if (!/pressable\(node\)/.test(s)) out.push(`${label}:可领卡没挂 Button(pressable)—— 浮图形点了没反应`);
  if (!/Career\.milestoneViews\(/.test(s)) out.push(`${label}:面板没喂里程碑视图(statCells 第三参),三态副行不会出现`);
  return out;
}

// ---------- 正题 ----------
{
  const bad = judgeTable(CFG.milestones);
  for (const m of bad) ok(false, `里程碑表 ${m}`);
  ok(bad.length === 0, `① 表完整性:${CFG.milestones.length} 档 / 六项齐、阈值递增、id 合「ms-<stat>-<序号>」口径`);
}
{
  const bad = judgeView(milestoneViews);
  for (const m of bad) ok(false, `里程碑视图 ${m}`);
  ok(bad.length === 0, "视图契约:新档/半程/越顶/全领四档摆写下 claimable·合计·nextAt·allDone 全对");
}

// ---------- ②③④⑤⑥⑦ 真链路:Career 门面 + 归一化 + 副行(node 下存档走纯内存,不落盘) ----------
{
  const p = Career.profile();
  const reset = (over: Partial<Profile["stats"]>, endless = 0, claimed: string[] = []): void => {
    p.stats = { matches: 0, wins: 0, smashes: 0, sweets: 0, perfects: 0, hits: 0, maxRally: 0, ...over };
    p.bestEndlessScore = endless;
    p.claimed = [...claimed];
    p.coins = 1000; p.level = 1; p.exp = 0;
  };

  // ② 未达标:一档都没够到,点了必须原样退回
  reset({}, 0);
  let nulled = 0;
  for (const { key } of MILESTONE_STATS) if (Career.claimMilestone(key) === null) nulled++;
  ok(nulled === MILESTONE_STATS.length, "② 未达标领取被拦:六格全阈值未到,claim 全部返回 null");

  // ③ 单档 + 幂等
  reset({ smashes: 25 });   // 20 ≤ 25 < 60:只有第 1 档达标
  const r1 = Career.claimMilestone("smashes");
  ok(!!r1 && r1.coin === 40 && r1.exp === 25, `③ 单档领取数值正确(实际 ${JSON.stringify(r1)})`);
  ok(Career.claimMilestone("smashes") === null, "③ 重复领取被拦(幂等):领过的档第二下返回 null");
  ok(Career.profile().claimed?.join(",") === "ms-smashes-1", "③ 已领记录落档(ms-smashes-1)");

  // ④ 合并发奖:一次点按领走全部已达成的未领档
  reset({ perfects: 999 });
  const r2 = Career.claimMilestone("perfects");
  ok(!!r2 && r2.coin === 270 && r2.exp === 175, `④ 合并发奖 = 三档之和(实际 coin=${r2?.coin}, exp=${r2?.exp})`);
  ok(Career.profile().claimed?.filter((id) => id.startsWith("ms-perfects-")).length === 3, "④ 三档 id 全部落档");
  const pv = Career.milestoneViews().perfects;
  ok(pv.allDone && pv.nextAt === null && !pv.claimable, "④ 领完视图:allDone + nextAt=null + 不再可领");

  // ⑤ 经济同轨:金币直接入账,经验必须走 addExp 曲线(升级金币同步发、满级经验清零)
  reset({ smashes: 25 });
  const c0 = p.coins;
  Career.claimMilestone("smashes");
  ok(p.level === 1 && p.exp === 25 && p.coins === c0 + 40, "⑤ 无升级:经验原样入账、金币只加档位奖");
  reset({ smashes: 25 });
  p.exp = 60;   // 60 + 25 = 85 ≥ expNeed(1)=80 → 升 Lv.2,余 5
  const c1 = p.coins;
  const r4 = Career.claimMilestone("smashes")!;
  ok(r4.levelUps.length === 1 && r4.levelUps[0] === 2, "⑤ 升级回报 levelUps=[2]");
  ok(p.level === 2 && p.exp === 5, `⑤ 跨级经验按 expNeed 曲线折算(实际 level=${p.level}, exp=${p.exp})`);
  ok(p.coins === c1 + 40 + Career.levelCoin(2), "⑤ 升级金币随 addExp 同步发(不许吞掉也不许双发)");
  reset({ smashes: 25 });
  p.level = CFG.career.level.cap; p.exp = 0;
  Career.claimMilestone("smashes");
  ok(p.level === CFG.career.level.cap && p.exp === 0, "⑤ 满级:经验清零不膨胀、不再升级");

  // ⑥ 归一化:老档缺键 / 手改坏值,领奖链不许崩
  delete (p as Partial<Profile>).claimed;
  ok(Array.isArray(Career.profile().claimed), "⑥ 老档缺 claimed 键 → profile() 补 []");
  (p as Partial<Profile>).claimed = null as unknown as string[];
  ok(Array.isArray(Career.profile().claimed) && Career.profile().claimed!.length === 0, "⑥ 手改 claimed=null → 兜回 []");

  // ⑦ 副行三态与口径
  const st = { matches: 22, wins: 15, smashes: 662, sweets: 1173, perfects: 952, hits: 4982, maxRally: 46 };
  reset(st, 40);
  const cells = statCells(Career.profile(), 18, Career.milestoneViews());
  ok(cells.every((c) => c.claim), "⑦ 满档摆拍:六格全可领(阈值全被顶过)");
  ok(cells.every((c) => c.sub === `点击领取 +${c.claim!.coin}金币+${c.claim!.exp}经验`), "⑦ 可领副行 = 「点击领取 +N金币+N经验」,与 claim 字段同源");
  ok(cells[0].num === `${statValue("winRate", st, 40)}`, "⑦ 胜率口径同源:statCells 大数 = statValue 现值");
  reset({}, 0);
  const freshCells = statCells(Career.profile(), 18, Career.milestoneViews());
  ok(freshCells[1].sub === "下一档 20次" && freshCells[0].sub === "0 胜 / 0 战 · 下一档 30%",
    "⑦ 未达标副行缀「下一档 N{unit}」,原文案为空时不带分隔点");
}

// ---------- ⑧ 接线扫源码(正题) ----------
{
  const w = judgeWiring(readFileSync(join(UI, "career-panel.ts"), "utf8"), "career-panel");
  for (const m of w) ok(false, `领取接线 ${m}`);
  ok(w.length === 0, "⑧ 面板接线:走 Career.claimMilestone + pressable 整卡可点 + 喂 milestoneViews,不直改钱包");
  const shelfSrc = strip(readFileSync(join(UI, "shop-shelf.ts"), "utf8"));
  ok(/from "\.\.\/core\/milestone"/.test(shelfSrc), "⑧ shop-shelf 的里程碑口径 import 自 core/milestone");
  ok(!/Math\.round\(\(st\.wins/.test(shelfSrc), "⑧ statCells 不再内联胜率公式(口径单一出口)");
  const careerSrc = readFileSync(join(CORE, "career.ts"), "utf8");
  const claimFn = careerSrc.slice(
    careerSrc.indexOf("function claimMilestone"), careerSrc.indexOf("function milestoneViews"),
  );
  ok(/addExp\(p, exp\)/.test(claimFn), "⑧ claimMilestone 的经验必须走 addExp(不许另抄曲线)");
}

// ---------- selftest:反例必须被拦下(防规则脚本悄悄全绿) ----------
if (process.argv.includes("--selftest")) {
  const base: MilestoneDef[] = [...CFG.milestones];
  const swap = (id: string, patch: Partial<MilestoneDef>): MilestoneDef[] =>
    base.map((d) => (d.id === id ? { ...d, ...patch } : d));
  const hideClaim: ViewsFn = (st, e, c) => {
    const v = milestoneViews(st, e, c);
    for (const k of Object.keys(v) as MilestoneStat[]) v[k] = { ...v[k], claimable: false, claimCoin: 0, claimExp: 0 };
    return v;
  };
  const doubleClaim: ViewsFn = (st, e, c) => {
    const v = milestoneViews(st, e, c);
    for (const k of Object.keys(v) as MilestoneStat[]) v[k] = { ...v[k], claimCoin: 999, claimExp: 999 };
    return v;
  };
  const badNext: ViewsFn = (st, e, c) => {
    const v = milestoneViews(st, e, c);
    for (const k of Object.keys(v) as MilestoneStat[]) v[k] = { ...v[k], nextAt: 1 };
    return v;
  };
  const cases: Array<[string, string[]]> = [
    ["档位阈值不递增", judgeTable(swap("ms-winRate-2", { at: 20 }))],
    ["id 把阈值写进去(调档就丢已领记录)", judgeTable(swap("ms-endless-1", { id: "ms-endless-5" }))],
    ["某项统计一个档都没有", judgeTable(base.filter((d) => d.stat !== "sweets"))],
    ["零奖励档(白跑一趟)", judgeTable(swap("ms-smashes-1", { coin: 0 }))],
    ["混进六格之外的统计键", judgeTable([...base, { id: "ms-hits-1", stat: "hits" as MilestoneStat, at: 100, coin: 1, exp: 1 }])],
    ["视图漏报可领档(玩家领不到该领的)", judgeView(hideClaim)],
    ["视图把已领档计入可领合计(重复发钱)", judgeView(doubleClaim)],
    ["视图 nextAt 指向已领档(下一档读数骗人)", judgeView(badNext)],
    ["UI 直改钱包(绕过 Career 的记账)", judgeWiring("function claim() { p.coins += 40; }", "sample-bad")],
    ["面板漏接领取(点击无反应)", judgeWiring('function claim() { ui.toast("ok"); }', "sample-bad")],
  ];
  for (const [nm, msgs] of cases) {
    ok(msgs.length > 0, `反例被拦下:${nm}(${msgs.length} 条)`);
  }
  ok(judgeWiring(readFileSync(join(UI, "career-panel.ts"), "utf8"), "career-panel").length === 0,
    "正例:真面板的领取接线过闸");
  process.exit(h.fails === 0 ? 0 : 1);
}

console.log(h.fails === 0
  ? `\n✓ milestone-check:${h.checks} 项断言全绿`
  : `\n✗ milestone-check:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
