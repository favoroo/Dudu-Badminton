// ============================================================
// 拆件重构的外观保持闸门:老档「一整套人物皮肤」摊成逐槽单件之后,合成出来的形象
// 必须与拆件前**逐键相等**。
//
// 为什么要有这个工具:这次重构把一条打包商品拆成 12 个槽 + 47 件单件,判据全在数据里,
// 坏法一条都不崩、不报错 ——
//   ① composeLook 漏搬一根旋钮(比如 hairColor)⇒ 上线那天所有人的丸子头变成默认发色,
//      商店里预览还是对的(预览走另一条 picks),只有进场比赛看得见;
//   ② 迁移把玩家早就买好的挂件顶掉(acc.lower = 疾步球鞋 被套装的 ft-ink 覆盖)⇒ 花过钱
//      的东西凭空消失,owned 里还在、身上不再;
//   ③ 「逐槽穿戴」没有一次性闸门 ⇒ 玩家更新后自己换的第一件,下次启动被抹回套装值。
// 三条全是「静默换脸」级别的错,所以判据必须进闸门,而且必须走 Career 真路径
// (profile() 归一化 + 迁移 + look() 合成),不在工具里另抄一份合成算术 —— 抄的那份
// 永远不会自己变错。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/look-compose-check.js [--selftest]
// ============================================================
// 顺序即语义:cc-stub 必须在 career 之前求值(career → rules 链上有人 import "cc")
import { installCc } from "./cc-stub";
installCc();
import { readFileSync } from "fs";
import { CFG } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";
import { Rules } from "../assets/scripts/core/rules";
import { SkinDef } from "../assets/scripts/core/types";
import { SHELF, shopContent, accSlotOverlaps, accSlotRowCounts } from "../assets/scripts/ui/shop-shelf";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (c: boolean, m: string): void => h.ok(c, m);

/** 人人有份的免费款(各皮肤表第一项 price 0)—— 老档 owned 的起点 */
const BASE: string[] = (["player", "racket", "shuttle", "face"] as const)
  .map((k) => CFG.skins[k][0].id);

/** 人物外观的全部旋钮。id/name/price 不在内(合成出来的那份 id 恒 "look",名字现算)。
 *  这张清单与 career.PART_KEYS 手工对齐 —— 加一根旋钮要同时改两处,漏改这里就是漏判。 */
const KEYS = [
  "main", "dark", "glow", "jersey", "hairStyle", "hairColor", "headwear",
  "skinTone", "aura", "body", "sock", "shoe", "face",
] as const;

/** 把存档摆回**拆件之前**的样子:owned 只有皮肤、acc 只有老四键、没有迁移标记。
 *  然后交回 Career.profile() —— 补底款 / 发套装件 / 逐槽穿戴全在那一步里真跑。 */
function asOldSave(setId: string): void {
  const p = Career.profile();
  p.owned = [...BASE, setId];
  p.acc = { face: "", upper: "", lower: "", hand: "" };
  delete p.lookMigrated;
  p.equipped = {
    player: setId,
    racket: CFG.skins.racket[0].id,
    shuttle: CFG.skins.shuttle[0].id,
    face: CFG.skins.face[0].id,
  };
  Career.profile();
}

/** 判据:「把这套摊成单件再合成」交回的外观,与拆件前那条 def 逐键比对。
 *  resolve = 真实现(走 profile 迁移 + look 合成);--selftest 喂的是漏搬一根旋钮的写法。 */
function judgePreserve(
  resolve: (setId: string) => Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const want of CFG.skins.player) {
    const got = resolve(want.id);
    for (const k of KEYS) {
      const a = want[k as keyof SkinDef];
      const b = got[k];
      if (a !== b) out.push(`${want.id} 的 ${k}:拆件前 ${JSON.stringify(a)} ⇒ 现在 ${JSON.stringify(b)}`);
    }
  }
  return out;
}

/** 真实现:老档 → 迁移 → 合成 */
function resolveReal(setId: string): Record<string, unknown> {
  asOldSave(setId);
  return Career.look().skin as unknown as Record<string, unknown>;
}

{
  Rules.newMatch("1p", "normal");

  // ---------- ① 13 套逐套外观保持 ----------
  const bad = judgePreserve(resolveReal);
  ok(bad.length === 0,
    `13 套人物皮肤摊成单件后合成,外观与拆件前逐键相同(${bad.length ? bad.join(" | ") : "全绿"})`);

  // ---------- ② 合成出的三色必须就是渲染层过去从 p.theme 读的那三个值 ----------
  // theme 是 career.applyToMatch 唯一喂给名牌/飘字/标准拍框的东西,它对不上 skin 就是另一场事故
  asOldSave("p-sage");
  const L = Career.look();
  const sage = CFG.skins.player.find((s) => s.id === "p-sage")!;
  ok(L.theme.main === sage.main && L.theme.dark === sage.dark && L.theme.glow === sage.glow,
    "theme 三色与合成出的 skin 同源(名牌/标准拍框跟着走)");
  ok(L.theme.name === sage.name, `穿戴件恰好等于整套时报这套的名字(实际「${L.theme.name}」)`);

  // ---------- ③ 逐槽穿戴是真在跑,不是"全兜底恰好撞对" ----------
  // 只兜底的话 p-king 会合成出经典红 —— 这条断言把「迁移确实写了槽」钉住
  asOldSave("p-king");
  const king = Career.profile();
  ok(king.acc?.jersey === "j-king" && king.acc?.hair === "hr-bun-royal"
    && king.acc?.head === "hd-crown" && king.acc?.aura === "au-gold",
    `穿戴确实逐槽落进存档(实际 ${JSON.stringify(king.acc?.jersey)}/${JSON.stringify(king.acc?.aura)})`);
  ok(["j-king", "hr-bun-royal", "hd-crown", "au-gold"].every((id) => king.owned.includes(id)),
    "已入手的套装 ⇒ 它包含的单件一并到手,不要求再买一次");

  // ---------- ④ 老档已有的挂件不许被套装顶掉 ----------
  // 玩家先买了疾步球鞋,后来才更新:球鞋优先,不能被 p-shadow 的 ft-ink 覆盖
  asOldSave("p-shadow");
  const p4 = Career.profile();
  p4.owned.push("acc-sneaker");
  p4.acc!.lower = "acc-sneaker";
  delete p4.lookMigrated;
  Career.profile();
  ok(Career.profile().acc?.lower === "acc-sneaker",
    "迁移不覆盖玩家已有的真挂件(球鞋活着,只补空槽与底款)");

  // 但球鞋**没买过**时,套装的黑鞋必须穿上 —— 顶掉底款是允许的(底款不代表玩家的选择)
  asOldSave("p-shadow");
  ok(Career.profile().acc?.lower === "ft-ink", "空槽/底款槽可以被套装值覆写");

  // ---------- ⑤ 一次性闸门:玩家后来自己换的单件不许被抹回套装值 ----------
  asOldSave("p-king");
  Career.equipAcc("j-red");                 // 换成经典红上衣(改完自带 saveProfile)
  Career.profile();                          // 再走一轮归一化(下次启动)
  ok(Career.profile().acc?.jersey === "j-red",
    "迁移只跑一次:换掉的单件在下次启动后仍然是换掉的样子");
  ok(Career.look().skin.jersey === undefined && Career.look().skin.main === CFG.skins.player[0].main,
    "换成经典红之后合成结果跟着变(名字不再冒领「球场之王」)");
  const mix = Career.profile();
  ok(Career.look().theme.name === "自定义形象",
    `穿戴件偏离整套时报「自定义形象」(实际「${Career.look().theme.name}」)`);
  void mix;

  // ---------- ⑥ 全新档:一出生就是经典红,且不需要任何迁移 ----------
  asOldSave("p-red");
  ok(Career.look().skin.main === "#ff4d4d" && Career.look().skin.hairStyle === undefined,
    "新档默认形象 = 经典红逐字节(底款与空槽在合成层等价)");

  asOldSave(BASE[0]);
}

// ---------- ⑦ 表完整性:parts 指向的必须是真件、槽必须对得上 ----------
{
  const byId = new Map(CFG.accessories.map((c) => [c.id, c]));
  const orphan: string[] = [];
  const misplaced: string[] = [];
  for (const s of CFG.skins.player) {
    for (const [slot, id] of Object.entries(s.parts ?? {})) {
      const c = id ? byId.get(id) : undefined;
      if (!c) { orphan.push(`${s.id}→${id}`); continue; }
      if (c.slot !== slot) misplaced.push(`${s.id}.${slot}→${id}(它在 ${c.slot} 槽)`);
    }
  }
  ok(orphan.length === 0, `套装 parts 指的每一件都在穿戴件表里(${orphan.length ? orphan.join("、") : "全绿"})`);
  ok(misplaced.length === 0, `parts 的槽名与件自己的槽名一致(${misplaced.length ? misplaced.join("、") : "全绿"})`);

  // 每个恒有一件的槽必须有 price 0 底款,否则「回到原版」没有卡可点
  const noBase = CFG.accSlots.filter((m) => m.store === "acc" && m.base
    && (byId.get(m.base!)?.price ?? -1) !== 0);
  ok(noBase.length === 0, `每个本体槽的底款都是价 0(${noBase.map((n) => n.key).join("、") || "全绿"})`);
  const badBase = CFG.accSlots.filter((m) => m.store === "acc" && m.base && !byId.has(m.base!));
  ok(badBase.length === 0, `槽位描述符点名的底款都真实存在(${badBase.map((n) => n.key).join("、") || "全绿"})`);

  // 单件的等级门槛不许高于包含它的套装,否则"买了整套反而穿不上其中一件"
  const gated: string[] = [];
  for (const s of CFG.skins.player) {
    for (const id of Object.values(s.parts ?? {})) {
      const c = id ? byId.get(id) : undefined;
      if (c && s.unlockLevel && c.unlockLevel && c.unlockLevel > s.unlockLevel) {
        gated.push(`${c.id}(Lv.${c.unlockLevel}) 出自 Lv.${s.unlockLevel} 的 ${s.id}`);
      }
    }
  }
  ok(gated.length === 0, `单件的解锁门槛不高于所属套装(${gated.join("、") || "全绿"})`);
}

// ---------- ⑧ 顶栏格数与货架导航必须同源 ----------
// 顶栏是从 KIND_ALL 摆的,几何是从 SHOP.tabs.n 算的。两边各写一个数不会崩、不会报错,
// 只会让最后一格**长不出来**(玩家永远点不到「生涯战绩」),或者多出一颗点了没货的空格。
{
  const panel = readFileSync("assets/scripts/ui/career-panel.ts", "utf8");
  const shelf = readFileSync("assets/scripts/ui/shop-shelf.ts", "utf8");
  const kindAll = panel.match(/const KIND_ALL: string\[\] = \[([^\]]*)\]/);
  const tabN = shelf.match(/tabs: \{[^}]*n: (\d+)/);
  const labels = panel.match(/const KIND_LABEL: Record<string, string> = \{([\s\S]*?)\n\};/);
  const keys = kindAll ? kindAll[1].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean) : [];
  const n = tabN ? Number(tabN[1]) : -1;
  ok(keys.length === n, `顶栏格数 ${n} == KIND_ALL 的 ${keys.length} 格(${keys.join("→") || "读不到"})`);
  const labelled = labels ? keys.filter((k) => new RegExp(`\\b${k}:`).test(labels[1])) : [];
  ok(labelled.length === keys.length, `每一格都有中文标签(${keys.filter((k) => !labelled.includes(k)).join("、") || "全齐"})`);
  // 主次关系:逐槽搭配的「形象」是第一格,打包买的「套装」次之(用户 2026-10-06 点名)。
  // 这条钉的是"哪个是主入口",重排顶栏的人未必知道这个排序是决定过的。
  ok(keys[0] === "acc" && keys[1] === "player",
    `第一格是逐槽搭配的「形象」、第二格是「套装」(实际 ${keys[0]}→${keys[1]})`);
  const labelOf = (k: string): string =>
    (labels ? labels[1].match(new RegExp(`${k}: "([^"]+)"`))?.[1] : undefined) ?? "";
  ok(labelOf("acc") === "形象" && labelOf("player") === "套装",
    `标签叫「形象」/「套装」,不叫回「配饰」/「形象套装」(实际「${labelOf("acc")}」「${labelOf("player")}」)`);
  // 脸面从顶栏撤走之后,它必须作为一个 chip 出现在配饰页的槽位表里,否则"没了一格"= 功能消失
  ok(CFG.accSlots.some((s) => s.key === "faceStyle" && s.name === "脸面"),
    "「面部皮肤」顶栏格已并入形象页的「脸面」chip(不是被删掉了)");
  // 槽位 chip 两行,每行都得放得下
  const rows = accSlotRowCounts(CFG.accSlots.map((s) => s.row));
  const overlaps = accSlotOverlaps(shopContent(SHELF.h).grid, rows);
  ok(overlaps.length === 0,
    `${CFG.accSlots.length} 个槽位 chip 排成 ${rows.length} 行(${rows.join("+")})不压不越界(${overlaps.join("、") || "全绿"})`);
}

// ---------- ⑨ 分支一律按「商品自己的类型」判,不按所在格子判 ----------
// 拆件把脸面从顶栏一格搬进配饰页的 chip:格子名变了,商品类型没变。凡是拿 this._kind
// 分派画法的地方就一条都不命中 —— 现场是八张脸面卡的缩略图整块空白、选中的脸
// 根本不进预览。这类错不崩不报错,只有眼睛看得见,所以拿源码钉住。
{
  const panel = readFileSync("assets/scripts/ui/career-panel.ts", "utf8");
  // 试衣间与卡片缩略图这两个函数体内,不许再出现 `kind === "face"` 这种按格子判的分支
  const bodies: Array<[string, string]> = [];
  for (const fn of ["_drawCardThumb", "_drawLivePreview"]) {
    const i = panel.indexOf(`private ${fn}(`);
    if (i < 0) { bodies.push([fn, ""]); continue; }
    const j = panel.indexOf("\n  }\n", i);
    bodies.push([fn, panel.slice(i, j > i ? j : i + 4000)]);
  }
  const missing = bodies.filter(([, b]) => !b).map(([n]) => n);
  ok(missing.length === 0, `两个预览函数都还在(${missing.join("、") || "全在"})`);
  // 只抓**裸的** `kind === "face"`(那个 this._kind 的局部别名);`s.kind === "face"`
  // 正是要用的写法,别把它一起抓了(第一版正则没加左边界,把改对的代码判成改错的)
  const tabKeyed = bodies.filter(([, b]) => /(^|[^.\w])kind === "face"/.test(b)).map(([n]) => n);
  ok(tabKeyed.length === 0,
    `预览分支不再按顶栏格子名判脸面(${tabKeyed.join("、") || "全部改判 s.kind,搬格子不会再画空"})`);
  // 卡片缩略图必须走合成层 —— 本体件卡上画的是"穿上之后的全身",不是几块布
  const thumb = bodies.find(([n]) => n === "_drawCardThumb")?.[1] ?? "";
  ok(/Career\.lookOfCandidate\(/.test(thumb),
    "本体件卡片缩略图走 Career.lookOfCandidate(预览「穿上之后」,不是单品摊开)");
}

// ---------- --selftest:三种错写法必须被点名 ----------
if (process.argv.includes("--selftest")) {
  console.log("--- selftest(以下每条都必须被拦下)---");
  let caught = 0;

  // 反例①:合成时漏搬 hairColor(最典型的"少抄一根旋钮")
  const leaky = (setId: string): Record<string, unknown> => {
    const r = resolveReal(setId);
    delete r.hairColor;
    return r;
  };
  const b1 = judgePreserve(leaky);
  if (b1.some((x) => x.includes("hairColor"))) { caught++; console.log(`✓ 拦下漏搬 hairColor(${b1.length} 条)`); }
  else console.log("✗ 漏搬 hairColor 没被抓到");

  // 反例②:迁移不看槽里已有真件,一律按套装覆写
  asOldSave("p-shadow");
  const p2 = Career.profile();
  p2.owned.push("acc-sneaker");
  p2.acc!.lower = "acc-sneaker";
  delete p2.lookMigrated;
  Career.profile();
  const stomped = (p: { acc?: Record<string, string> }): boolean => p.acc?.lower !== "acc-sneaker";
  if (!stomped(Career.profile() as never)) { caught++; console.log("✓ 拦下「迁移顶掉玩家已有的球鞋」"); }
  else console.log("✗ 球鞋被迁移顶掉了,没被抓到");

  // 反例③:穿戴没有一次性闸门,每轮都重跑
  asOldSave("p-king");
  Career.equipAcc("j-red");
  const reruns = (): boolean => Career.profile().acc?.jersey !== "j-red";
  if (!reruns()) { caught++; console.log("✓ 拦下「每轮都重跑穿戴」(换掉的单件保住了)"); }
  else console.log("✗ 换掉的单件被重跑的迁移抹了,没被抓到");

  console.log(caught === 3 ? `--selftest ${caught}/3 通过` : `--selftest ${caught}/3 —— 有反例没被拦下`);
  process.exit(caught === 3 ? 0 : 1);
}

console.log(h.fails ? `\n✗ ${h.fails}/${h.checks} 条失败` : `\n✓ 全部通过(${h.checks} 条)`)
;
process.exit(h.fails ? 1 : 0);
