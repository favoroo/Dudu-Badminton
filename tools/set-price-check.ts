// ============================================================
// 套装「补齐差价」定价闸门。
//
// 拆件重构把 13 条打包人物皮肤变成套装卡,单件各定各的价。定价口径有三条,每一条
// 坏掉都**不崩、不报错**,只有商店里那行字和扣的钱不对:
//   ① 一件没买时,套装价必须**恰好等于这条 def 当年的原价** —— 本轮重构不许动经济曲线。
//      写错成"各件相加"就是当场给 13 套全线涨价(樱花少女 288 → 394)。
//   ② 已经零散买过其中几件的人,只许补剩下的钱。按整套原价收 = 为同一件东西付第二次,
//      正是用户反复点名的那条「不白罚」(参见族卡「任一付费成员已入手即整族到手」)。
//   ③ 免费底款(price 0)不计入合计 —— 人人有份的东西没有"买断"可言,
//      拿它当凭据等于白送一套付费形象。
// 判据全部吃 Career.setPrice 这张唯一的嘴;--selftest 喂三份**改动前的真实错写法**。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/set-price-check.js [--selftest]
// ============================================================
import { installCc } from "./cc-stub";
installCc();
import { CFG } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";
import { SkinDef } from "../assets/scripts/core/types";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (c: boolean, m: string): void => h.ok(c, m);

const SETS = CFG.skins.player.filter((s) => Object.keys(s.parts ?? {}).length + (s.face ? 1 : 0) >= 2);
/** 四个皮肤默认款 = 一个"什么都没买"的档案 */
const BASE_DEFAULTS = (["player", "racket", "shuttle", "face"] as const).map((k) => CFG.skins[k][0].id);
const priceOf = (id: string): number =>
  (CFG.accessories.find((c) => c.id === id)?.price ?? CFG.skins.face.find((f) => f.id === id)?.price ?? 0);

/** 这套的付费组成件(含自带脸面) */
function paidItems(set: SkinDef): string[] {
  return Career.setItems(set).filter((i) => i.price > 0).map((i) => i.id);
}

/** 判据①:一件没买 ⇒ 报价必须等于老原价 */
function judgeFreshPrice(charge: (set: SkinDef, owned: string[]) => number): string[] {
  const out: string[] = [];
  for (const s of SETS) {
    const c = charge(s, []);
    if (c !== s.price) out.push(`${s.id}: 空手报价 ${c} ≠ 原价 ${s.price}`);
  }
  return out;
}

/** 判据②:**拥有得越多,报价只许不升**。
 *  单调是对"拥有集合"单调,不是对"最后加进去的那一件的价格"单调 ——
 *  只拥有贵的那件时剩下要补的更多,报价反而高,这是对的(第一版判据就在这儿自己骗自己)。 */
function judgeNoDoubleCharge(charge: (set: SkinDef, owned: string[]) => number): string[] {
  const out: string[] = [];
  for (const s of SETS) {
    const paid = paidItems(s);
    let prev = charge(s, []);
    const acc: string[] = [];
    for (const id of paid) {
      acc.push(id);
      const next = charge(s, acc);
      if (next > prev) out.push(`${s.id}: 又多拥有 ${id} 反而更贵(${prev} → ${next})`);
      prev = next;
    }
    if (charge(s, paid) !== 0) out.push(`${s.id}: 付费件件件在手仍报 ${charge(s, paid)}`);
    // 单件读数也不许超过"一件没有"的整套原价
    for (const id of paid) {
      if (charge(s, [id]) > s.price) out.push(`${s.id}: 只拥有 ${id} 时报价 ${charge(s, [id])} > 原价 ${s.price}`);
    }
  }
  return out;
}

/** 判据③:免费底款不计入合计。
 *  不能只拿现有 13 套去测 —— 它们的组成件**全是付费件**,那条规则在当前数据下不可达,
 *  断言会空转成"永远绿"。所以造一份**硬塞了一件免费底款**的假套装去喂公式:
 *  合计与报价都必须与没塞时一字不差。(以后真有人把 j-red 这类底款写进某个付费套装的
 *  parts,这一条就是拦它的那道门。) */
function judgeFreeIgnored(charge: (set: SkinDef, owned: string[]) => number): string[] {
  const out: string[] = [];
  const freeIds = CFG.accessories.filter((c) => c.price === 0).map((c) => c.id);
  for (const s of SETS) {
    for (const id of freeIds) {
      const padded: SkinDef = { ...s, parts: { ...s.parts, tone: id } };
      if (charge(padded, []) !== charge(s, [])) {
        out.push(`${s.id} 塞进免费件 ${id} 后报价从 ${charge(s, [])} 变成 ${charge(padded, [])}`);
      }
    }
  }
  return out;
}

/** 真实现:走 Career.setPriceFor 这张唯一的嘴。
 *  吃 def 而不是 id —— 判据③要喂一份**伪造的**套装,只认 id 就测不到那种情形。
 *  owned 一律从"四个皮肤默认款"起算,即一个什么都没买的档案。 */
const chargeReal = (s: SkinDef, owned: string[]): number =>
  Career.setPriceFor(s, [...BASE_DEFAULTS, ...owned]).charge;

{
  // ---------- ① 空手报价 == 老原价 ----------
  const b1 = judgeFreshPrice(chargeReal);
  ok(b1.length === 0, `一件没买时套装价 == 这条 def 当年的原价(${b1.join(" | ") || "全绿"})`);

  // ---------- ② 不重复收费 + 单调 ----------
  const b2 = judgeNoDoubleCharge(chargeReal);
  ok(b2.length === 0, `已拥有的件绝不二次收价,且拥有越多报价只降不升(${b2.join(" | ") || "全绿"})`);

  // ---------- ③ 免费底款不计 ----------
  const b3 = judgeFreeIgnored(chargeReal);
  ok(b3.length === 0, `往套装里塞任何一件免费底款都不改变合计与报价(${b3.join(" | ") || "全绿"})`);

  // ---------- ④ 套装必须比拆开买便宜 ----------
  const dearer: string[] = [];
  for (const s of SETS) {
    const pr = Career.setPriceFor(s, BASE_DEFAULTS);
    if (s.price > pr.total) dearer.push(`${s.id}: 整套 ${s.price} > 拆开合计 ${pr.total}`);
  }
  ok(dearer.length === 0, `整套价不超过各件合计(否则"套装"是涨价不是折扣)(${dearer.join(" | ") || "全绿"})`);

  // ---------- ⑤ 折扣带报告(按稀有度看是否配平;越界只报不判死,数值归作者调) ----------
  const band: Record<string, [number, number]> = {
    rare: [0.15, 0.52], epic: [0.20, 0.40], legendary: [0.20, 0.40],
  };
  const offBand: string[] = [];
  console.log("套装折扣带:");
  for (const s of SETS) {
    const pr = Career.setPriceFor(s, BASE_DEFAULTS);
    const off = pr.total ? 1 - s.price / pr.total : 0;
    const [lo, hi] = band[s.rarity ?? "common"] ?? [0, 1];
    const flag = off < lo || off > hi ? "  ← 越带" : "";
    if (flag) offBand.push(`${s.id} ${Math.round(off * 100)}%`);
    console.log(`  ${s.rarity ?? "common"}`.padEnd(13)
      + `${s.id}`.padEnd(12) + `整套 ${s.price}`.padEnd(12)
      + `合计 ${pr.total}`.padEnd(13) + `${pr.n} 件`.padEnd(7)
      + `省 ${Math.round(off * 100)}%${flag}`);
  }
  ok(offBand.length === 0, `每套折扣都落在该稀有度的带子里(${offBand.join("、") || "全绿"})`);

  // ---------- ⑥ 只剩一件的套装不上货架 ----------
  const singles = CFG.skins.player
    .filter((s) => Object.keys(s.parts ?? {}).length + (s.face ? 1 : 0) < 2)
    .map((s) => s.id);
  ok(singles.every((id) => {
    const set = CFG.skins.player.find((x) => x.id === id)!;
    return Career.setItems(set).length <= 1;
  }), `纯色款拆完只剩一件上衣 ⇒ 不摆套装卡(${singles.join("、") || "无"})`);

  // ---------- ⑦ 成交一次后:钱扣对了、件都到手了、再按就是"整套穿上" ----------
  const p = Career.profile();
  p.owned = (["player", "racket", "shuttle", "face"] as const).map((k) => CFG.skins[k][0].id);
  p.coins = 99999;
  // 解锁门槛先迈过去:p-king 要 Lv.8,而测试档案一出生是 Lv.1 —— 不抬等级 buy 会直接
  // 回一句「Lv.8 解锁」,于是这一组断言测的其实是"钱没扣",白绿一片。
  p.level = CFG.career.level.cap;
  const king = CFG.skins.player.find((s) => s.id === "p-king")!;
  const before = p.coins;
  const r = Career.buy(king.id);
  const pr = Career.setPrice(king.id);
  ok(r.ok && r.set === "bought", "整套买下走的是套装那条成交分支");
  ok(before - p.coins === king.price, `扣的钱 == 原价(实际扣 ${before - p.coins})`);
  ok(pr.have && pr.charge === 0, "成交后读数翻成「已集齐整套 · 补齐 0」");
  ok(paidItems(king).every((id) => p.owned.includes(id)), "整套成交 ⇒ 组成件一并到手,不要求再买一次");
  ok(Career.equipSet(king.id), "已集齐 ⇒ 整套穿上");
  ok(Career.wearsSet(king.id) && Career.look().skin.aura === king.aura,
    "穿上后逐槽生效(合成结果里 aura 真的在场)");

  // 零散先买两件,再买整套 ⇒ 只补剩下的
  const p2 = Career.profile();
  p2.owned = p2.owned.filter((id) => id !== "p-king" && !paidItems(king).includes(id));
  p2.coins = 99999;
  const items = paidItems(king);
  const one = items[0];
  p2.owned.push(one);
  const partial = Career.setPrice(king.id);
  const expect = Math.round((king.price * (partial.total - priceOf(one))) / partial.total);
  ok(partial.lack === partial.total - priceOf(one), `拥有 ${one} 后 lack 扣掉它的价`);
  ok(Math.abs(partial.charge - expect) <= 1,
    `补齐价 ≈ 原价 × 缺件占比(报 ${partial.charge},算 ${expect})`);
  ok(partial.charge < king.price, `买过一件之后整套更便宜(${partial.charge} < ${king.price})`);
  const coins2 = p2.coins;
  Career.buy(king.id);
  ok(coins2 - p2.coins === partial.charge, `成交扣的就是刚才报的那个补齐价(扣 ${coins2 - p2.coins})`);
}

/** 用「假设 owned = 默认款 + 这些件」的档案读一次定价,读完还原 */

// ---------- --selftest:三份改动前的真实错写法必须被点名 ----------
if (process.argv.includes("--selftest")) {
  console.log("--- selftest(以下三条都必须被拦下)---");
  let caught = 0;

  // 反例①:各件相加(本轮重构最容易顺手写出的涨价)
  const sumImpl = (s: SkinDef, owned: string[]): number =>
    Career.setItems(s).reduce((n, i) => n + (owned.includes(i.id) ? 0 : i.price), 0);
  if (judgeFreshPrice(sumImpl).length) { caught++; console.log("✓ 拦下「各件相加」定价"); }
  else console.log("✗ 各件相加没被抓到");

  // 反例②:永远按整套原价收(已拥有的件照收不误)
  const flatImpl = (s: SkinDef): number => s.price;
  if (judgeNoDoubleCharge(flatImpl).length) { caught++; console.log("✓ 拦下「已拥有还二次收钱」"); }
  else console.log("✗ 二次收费没被抓到");

  // 反例③:把免费底款也算进合计
  const countFreeImpl = (s: SkinDef, owned: string[]): number =>
    Career.setItems(s).reduce((n, i) => n + (owned.includes(i.id) ? 0 : Math.max(1, i.price)), 0);
  if (judgeFreeIgnored(countFreeImpl).length) { caught++; console.log("✓ 拦下「免费底款计入合计」"); }
  else console.log("✗ 免费底款计入没被抓到");

  console.log(caught === 3 ? `--selftest ${caught}/3 通过` : `--selftest ${caught}/3 —— 有反例没被拦下`);
  process.exit(caught === 3 ? 0 : 1);
}

console.log(h.fails ? `\n✗ ${h.fails}/${h.checks} 条失败` : `\n✓ 全部通过(${h.checks} 条)`);
process.exit(h.fails ? 1 : 0);
