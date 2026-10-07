// ============================================================
// 配饰系统闸门:四槽单选、可不戴、画法已注册、存档零迁移、配饰不被当「下架皮肤」删。
//
// 为什么要有这个工具:配饰是一条「不崩、不报错,坏只坏在看不见/悄悄丢东西」的链 ——
//   ① config 里写了个 ACC_STYLES 没登记的 style ⇒ 商店卡有货、身上永远画不出来;
//   ② 佩戴链不校验 owned ⇒ 谁都能白戴;
//   ③ 归一化不清坏档的槽值 ⇒ 渲染层拿到一个不存在的 def,画不出也不报错;
//   ④ refundDelisted 只认皮肤表 ⇒ owned 里的配饰下次启动被当「已下架」静默删掉
//      (这条是配饰与皮肤共用 owned 数组换来的地雷,career.refundDelisted 的注释钉着);
//   ⑤ applyToMatch 只该给左队 0 号真人挂 acc —— 挂到 CPU/影分身上就是「全员戴围巾」。
// 每条判据都做成「喂实现」的纯函数:主流程喂真实现跑绿,--selftest 喂错写法必须被点名。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/accessory-check.js [--selftest]
// ============================================================
// 顺序即语义:cc-stub 必须在 acc 之前求值(acc → draw-kit/p5kit 都 import "cc")
import { installCc } from "./cc-stub";
installCc();
import fs from "fs";
import { CFG } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";
import { Rules } from "../assets/scripts/core/rules";
import { AccSlot, AccessoryDef, SkinKind } from "../assets/scripts/core/types";
import { ACC_STYLES } from "../assets/scripts/render/acc";
import { SHELF, shopContent, accSlotOverlaps } from "../assets/scripts/ui/shop-shelf";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (c: boolean, m: string): void => h.ok(c, m);

/** 人人有份的免费款(各皮肤表第一项 price 0)—— 配饰判据的起点档(配饰没有免费默认款) */
const BASE: string[] = (["player", "racket", "shuttle", "face"] as SkinKind[]).map((k) => CFG.skins[k][0].id);
const ACC_IDS = CFG.accessories.map((a) => a.id);
/** 只数落 Profile.acc 的那些槽。脸面(faceStyle)落 equipped.face,商品住在 SKINS.face,
 *  拿它去索引 p.acc 会凭空多一个键 —— 归一化那几条判据都必须跳过它。 */
const SLOT_KEYS = CFG.accSlots.filter((s) => s.store === "acc").map((s) => s.key as AccSlot);

// ---------- ① 数据完整性:slot 合法 / style 已注册 / id 不与皮肤撞 / 稀有度合法 ----------

/** style 注册判据:喂一份「key 在不在注册表里」的实现,返回没通过的挂件列表。
 *  只扫 kind="wear":本体件不自己画(旋钮写进合成出的 SkinDef),没有 style 可查。 */
function judgeStyles(has: (style: string) => boolean): AccessoryDef[] {
  return CFG.accessories.filter((a): a is AccessoryDef => a.kind === "wear" && !has(a.style));
}

{
  const bad = judgeStyles((s) => !!ACC_STYLES[s]);
  ok(bad.length === 0, `每个配饰的 style 都已在 acc.ts 的 ACC_STYLES 注册(${bad.length ? bad.map((b) => `${b.id}:${b.style}`).join("、") : "全绿"})`);
  const slotBad = CFG.accessories.filter((a) => !SLOT_KEYS.includes(a.slot));
  ok(slotBad.length === 0, `配饰 slot 都落在 accSlots 四槽之内(${slotBad.length ? slotBad.map((b) => b.id).join("、") : "全绿"})`);
  // id 命名空间:配饰与皮肤同住 owned,撞 id = 一件商品两个价
  const skinIds = (["player", "racket", "shuttle", "face"] as SkinKind[]).flatMap((k) => CFG.skins[k].map((s) => s.id));
  const dup = ACC_IDS.filter((id) => skinIds.includes(id));
  ok(dup.length === 0, `配饰 id 与皮肤 id 无撞车(${dup.length ? dup.join("、") : "全绿"})`);
  const rarityBad = CFG.accessories.filter((a) => !CFG.rarity[a.rarity]);
  ok(rarityBad.length === 0, `配饰稀有度都在 RARITY_META 里(${rarityBad.length ? rarityBad.map((b) => b.id).join("、") : "全绿"})`);
  // 每槽货架不空:空槽的子页签点进去是一片空白,读成「坏了」
  for (const s of SLOT_KEYS) {
    ok(CFG.accessories.some((a) => a.slot === s), `槽位 ${s} 的货架至少一件`);
  }
}

// ---------- ② 佩戴链:未拥有拒收 / 同槽覆盖单选 / 跨槽叠加 / 卸下 ----------
// 全部走 Career 真路径(newMatch 起一场真对局,applyToMatch 真挂),不另抄一份佩戴算术

function resetAccState(): void {
  const p = Career.profile();
  p.owned = [...BASE];
  p.acc = { face: "", upper: "", lower: "", hand: "" };
}

{
  Rules.newMatch("1p", "normal");
  resetAccState();
  const shades = CFG.accessories.find((a) => a.id === "acc-shades")!;
  const scarf = CFG.accessories.find((a) => a.id === "acc-scarf")!;
  const mask = CFG.accessories.find((a) => a.id === "acc-mask")!;

  ok(!Career.equipAcc(scarf.id), "未拥有的配饰被拒收(equipAcc 返回 false)");
  ok(!Career.equippedAcc(scarf.slot), "被拒收后槽位仍空");

  Career.profile().owned.push(scarf.id, shades.id);
  ok(Career.equipAcc(scarf.id) && Career.equipAcc(shades.id), "拥有后可佩戴");
  const me = Rules.R.players[0];
  ok((me.acc?.length ?? 0) === 2, `跨槽可叠加:围巾(上身)+ 墨镜(面部)同时在场(实际 ${me.acc?.length ?? 0} 件)`);

  Career.profile().owned.push(mask.id);
  ok(Career.equipAcc(mask.id), "第二件面部配饰可佩戴(同槽覆盖)");
  ok(Career.equippedAcc("face")?.id === mask.id, "同槽单选:口罩顶掉墨镜");
  ok((me.acc?.length ?? 0) === 2, `叠加总数不变(实际 ${me.acc?.length ?? 0} 件)`);
  ok(Career.equippedAccs().every((a) => !a || a === Career.accById(a.id)), "equippedAccs 交回的都是真 def");

  ok(Career.unequipAcc("face"), "卸下面部槽");
  ok(!Career.equippedAcc("face"), "卸下后槽位为空(空槽是合法态)");
  ok(Career.equippedAcc("upper")?.id === scarf.id, "卸下面部不影响上身(跨槽互不干扰)");
  ok(!Career.unequipAcc("face"), "已空的槽再卸返回 false(UI 据此不弹提示)");

  // applyToMatch 的挂载目标:左队 0 号真人才有 acc,CPU 恒无
  ok(me.acc != null && !me.isAI, "acc 挂在左队 0 号真人身上");
  const cpu = Rules.R.players[1];
  ok(cpu && cpu.isAI && !cpu.acc, "CPU 不沾配饰(敌我一眼分明的老口径)");
  ok(me.acc!.every((a) => a.slot !== "face"), "卸下后 me.acc 里没有面部件(applyToMatch 真刷新)");

  resetAccState();
}

// ---------- ③ 存档归一化:坏槽值清回「未佩戴」(judgeSanitize 喂实现) ----------

/** 判据:把坏值写进槽,「清洗实现」交回的必须是 ""(真实现 = 走 Career.profile() 归一化) */
function judgeSanitize(sanitize: (slot: AccSlot, badId: string) => string): string[] {
  const out: string[] = [];
  for (const s of SLOT_KEYS) {
    const r = sanitize(s, "acc-nonexistent");
    if (r !== "") out.push(`槽 ${s} 的坏 id 没被清空(剩 ${JSON.stringify(r)})`);
    const u = sanitize(s, "acc-shades");   // 真商品但不在 owned 里
    if (u !== "") out.push(`槽 ${s} 的未拥有 id 没被清空(剩 ${JSON.stringify(u)})`);
  }
  return out;
}

/** 真实现:写坏值 → 重新 profile() 触发归一化 → 读回 */
function sanitizeReal(slot: AccSlot, badId: string): string {
  const p = Career.profile();
  p.acc![slot] = badId;
  return Career.profile().acc![slot] ?? "";
}

{
  const bad = judgeSanitize(sanitizeReal);
  ok(bad.length === 0, `归一化把坏槽值(不存在的 id / 未拥有的 id)清回「未佩戴」(${bad.length ? bad.join(" | ") : "全绿"})`);
  // 老档零迁移:acc 整个字段缺失 → 每个槽补 ""(不是补底款 —— 底款是迁移那一步的事,
  // 有 lookMigrated 闸门挡着,不在归一化这轮里偷偷改写玩家身上穿的东西)
  const p = Career.profile();
  const savedAcc = p.acc;
  delete p.acc;
  const after = Career.profile().acc!;
  ok(SLOT_KEYS.every((s) => after[s] === ""), `老档缺 acc 字段 ⇒ 各槽补空(${SLOT_KEYS.length} 槽,实际 ${JSON.stringify(after)})`);
  p.acc = savedAcc;
}

// ---------- ④ refundDelisted 地雷:owned 里的配饰不许被当「已下架皮肤」删掉 ----------

/** 判据:owned 混入配饰后,「该不该保留」的实现必须对配饰也说保留 */
function judgeOwnedSurvival(keep: (id: string) => boolean): string[] {
  const out: string[] = [];
  for (const id of ACC_IDS) {
    if (!keep(id)) out.push(`配饰 ${id} 会被当「已下架」从 owned 删掉`);
  }
  return out;
}

{
  // 真实现:Career 的查表双管(skinById || accById)
  const bad = judgeOwnedSurvival((id) => !!Career.skinById(id) || !!Career.accById(id));
  ok(bad.length === 0, `owned 里的配饰全部被归一化保留(${bad.length ? bad.join("、") : "全绿"})`);
  // 存档真生效:owned 里放进配饰,过一遍 profile() 还在
  const p = Career.profile();
  p.owned = [...BASE, "acc-shades"];
  Career.profile();
  ok(Career.owns("acc-shades"), `买了配饰 ⇒ 下次启动 owns() 仍为真(refundDelisted 不误删)`);
  p.owned = [...BASE];
}

// ---------- ⑤ 源码钉:渲染层与 applyToMatch 的两条铁律(源码扫,别让守卫被顺手删掉) ----------

{
  const sprites = fs.readFileSync("assets/scripts/render/sprites.ts", "utf8");
  ok(sprites.includes("const acc = isShadow ? null : (p.acc ?? null);"),
    "sprites.drawPlayer 读 acc 有 isShadow 守卫(影分身恒无配饰)");
  const career = fs.readFileSync("assets/scripts/core/career.ts", "utf8");
  // 拆件之后 acc 经 composeLook() 中转再挂,所以钉两半:合成里真的现调 equippedAccs()
  // (每次新建数组),applyToMatch 挂的是那份合成结果 —— 两条都在,共享引用的坑才回不来。
  ok(career.includes("acc: equippedAccs(),") && career.includes("me.acc = L.acc;"),
    "applyToMatch 经 composeLook → equippedAccs() 挂 acc(每次新数组,别共享引用)");
  // 子页签排布判据(chip 两两不压/不越窗/够触控)—— 别让这排键压住商品卡或滚出窗
  const chips = accSlotOverlaps(shopContent(SHELF.h).grid);
  ok(chips.length === 0, `配饰槽位子页签排布合法(${chips.length ? chips.join(" | ") : "全绿"})`);
}

// ---------- selftest:错写法必须被拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:四种错写法必须被点名");
  // ① 假装注册表漏了 scarf ⇒ judgeStyles 必须点名 acc-scarf
  ok(judgeStyles((s) => s !== "scarf").length > 0, "反例被拦下:style 未注册(漏登记的画法)");
  // ② 什么都接受的 equip ⇒ 未拥有也被戴上
  ok(judgeUnownedRejected(() => true).length > 0, "反例被拦下:未拥有的配饰也被接受");
  // ③ 坏值原样保留(不清洗)的归一化
  ok(judgeSanitize((_slot, id) => id).length > 0, "反例被拦下:坏槽值原样进渲染层");
  // ④ refundDelisted 只认皮肤表(配饰上线前的老写法,就是这颗地雷)
  ok(judgeOwnedSurvival((id) => !!Career.skinById(id)).length > 0, "反例被拦下:owned 里的配饰被当下架皮肤删掉");
  // ⑤ 同槽不覆盖(第二件被拒/并列)的单选破坏
  ok(judgeSlotOverwrite((_a, _b) => ({ face: null })).length > 0, "反例被拦下:同槽第二件没顶掉第一件");
  process.exit(h.fails === 0 ? 0 : 1);
}

/** 判据:连戴两件同槽配饰,槽里必须是第二件(喂「a、b 两连戴」的实现) */
function judgeUnownedRejected(equip: (id: string) => boolean): string[] {
  const out: string[] = [];
  resetAccState();
  for (const a of CFG.accessories) {
    if (equip(a.id)) out.push(`未拥有的 ${a.id} 也被接受`);
  }
  resetAccState();
  return out;
}

/** 判据:连戴两件面部配饰,槽里必须是第二件 */
function judgeSlotOverwrite(equipTwo: (a: string, b: string) => { face: string | null }): string[] {
  const out: string[] = [];
  const shades = CFG.accessories.find((x) => x.id === "acc-shades")!;
  const mask = CFG.accessories.find((x) => x.id === "acc-mask")!;
  const r = equipTwo(shades.id, mask.id);
  if (r.face !== mask.id) out.push(`同槽第二件没顶掉第一件(槽里是 ${JSON.stringify(r.face)})`);
  return out;
}

console.log(h.fails === 0 ? `\n✓ accessory-check:${h.checks} 项断言全绿` : `\n✗ accessory-check:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
