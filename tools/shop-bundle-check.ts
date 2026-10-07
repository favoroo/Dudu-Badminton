// ============================================================
// 商店捆绑闸门:买了人物形象,他自带的那张脸面必须一起到手。
//
// 现场(用户 2026-10-06):买了「影分身」(默认脸面 = 纯黑无面),面部 tab 里那件脸面
// 仍写着「金币 88」—— 一个已经穿在身上的东西要再付一次钱。这条规则坏的时候不崩、
// 不报错,只有商店里那一行字不对,所以判据必须进闸门:
//   ① 捆绑算术:人物款的 face 引用在脸面货架上找得到商品 ⇒ 必须交回那件商品
//   ② 幂等:给过一次不再给第二次(owned 里冒重复 id 会把退款/统计一起带歪)
//   ③ 不越权:只持默认款的档,一颗付费脸都不许塞
//   ④ 存档真生效:走 Career.profile() 的归一化路径,Career.owns() 读得到
//   ⑤ 货架上没有对应商品的 face(金羽宗师的 sage)点名报出来 —— 是已知缺口,不许悄悄算绿
// 另带 --selftest:三份反例(不捆绑 / 把 faceStyle 当商品 id / 不看 owned 硬塞)必须被拦下。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/shop-bundle-check.js [--selftest]
// ============================================================
import { CFG } from "../assets/scripts/core/config";
import { Career, bundledFaces } from "../assets/scripts/core/career";
import { SkinKind } from "../assets/scripts/core/types";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (c: boolean, m: string): void => h.ok(c, m);

/** 人人有份的免费款(各表第一项 price 0)—— 捆绑判据的起点档 */
const BASE: string[] = (["player", "racket", "shuttle", "face"] as SkinKind[]).map((k) => CFG.skins[k][0].id);

/** 脸面货架上真有的商品,按 faceStyle key 反查 */
const faceByStyle = (style: string) => CFG.skins.face.find((f) => f.faceStyle === style) ?? null;

type BundleFn = (owned: string[]) => string[];

/** 判据本体:喂一份「实现」,返回它没通过的问题列表(反例才能被点名) */
function judgeBundle(fn: BundleFn): string[] {
  const out: string[] = [];
  for (const ps of CFG.skins.player) {
    if (!ps.face) continue;
    const prod = faceByStyle(ps.face);
    if (!prod) continue;   // ⑤ 单独报,不算红
    const got = fn([...BASE, ps.id]);
    if (!got.includes(prod.id)) out.push(`「${ps.name}」自带脸面 ${ps.face} 没随人物到手(应给 ${prod.id})`);
    for (const id of got) {
      if (!CFG.skins.face.some((f) => f.id === id)) out.push(`交回的不是脸面商品 id:「${ps.name}」→ ${id}`);
    }
    const again = fn([...BASE, ps.id, prod.id]);
    if (again.length) out.push(`重复发放:「${ps.name}」第二次仍交回 ${again.join(",")}`);
  }
  const none = fn(BASE);
  if (none.length) out.push(`没买人物却塞了脸面:${none.join(",")}`);
  return out;
}

const bad = judgeBundle(bundledFaces);
ok(bad.length === 0, `捆绑算术:每个人物款的自带脸面都按商品 id 发一次、不越权(${bad.length ? bad.join(" | ") : "全绿"})`);

// ---------- ④ 存档真生效:归一化路径上 owns() 读得到,且不重复 ----------
{
  const p = Career.profile();
  const voidFace = faceByStyle("void");
  ok(!!voidFace, "脸面货架上有「纯黑无面」这件商品(faceStyle = void)");
  if (!voidFace) {
    console.log(`\n✗ ${h.fails} 项失败`);
    process.exit(1);
  }
  const shadow = CFG.skins.player.find((s) => s.id === "p-shadow");
  ok(!!shadow && shadow.price > 0, "人物货架上有付费款「影分身」");

  p.owned = [...BASE, "p-shadow"];
  ok(Career.owns(voidFace.id), `只买「影分身」⇒ owns(${voidFace.id}) 为真,面部 tab 不再要第二次钱`);
  const dup = Career.profile().owned.filter((id) => id === voidFace.id).length;
  ok(dup === 1, `再归一化一次仍只有一份 ${voidFace.id}(实际 ${dup} 份)`);

  p.owned = [...BASE];
  ok(!Career.owns(voidFace.id), "只持默认款 ⇒ 付费脸面不在档上(捆绑不白送)");
  p.owned = [...BASE];
}

// ---------- ⑤ 没有对应商品的自带脸面:点名,不悄悄算绿 ----------
{
  const orphan = CFG.skins.player.filter((ps) => ps.face && !faceByStyle(ps.face));
  console.log(orphan.length
    ? `注:${orphan.map((o) => `${o.name}(${o.face})`).join("、")} 的自带脸面在脸面货架上没有商品 ⇒ 这张脸没法单独买/换(已知缺口)`
    : "注:每个人物款的自带脸面都在脸面货架上有对应商品");
}

// ---------- selftest:三份反例必须被拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:旧写法与两种错写法必须被点名");
  const cases: Array<[string, BundleFn]> = [
    ["不捆绑(买了人物还得再买脸)", () => []],
    ["把 faceStyle 当商品 id 交回", (owned) => CFG.skins.player
      .filter((s) => s.face && owned.includes(s.id)).map((s) => s.face!)],
    ["不看 owned 硬塞(每次归一化都追加一遍)", () => CFG.skins.player
      .map((s) => s.face && faceByStyle(s.face)?.id).filter((x): x is string => !!x)],
  ];
  for (const [name, fn] of cases) {
    const hit = judgeBundle(fn);
    ok(hit.length > 0, `反例被拦下:${name}(${hit.length} 条)`);
  }
  process.exit(h.fails === 0 ? 0 : 1);
}

console.log(h.fails === 0 ? `\n✓ shop-bundle-check:${h.checks} 项断言全绿` : `\n✗ shop-bundle-check:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
