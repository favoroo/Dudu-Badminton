// ============================================================
// 面部货架「族」闸门:四款同族脸面合成一张卡,一次买断 ⇒ 族内随意换。
//
// 现场(用户 2026-10-06):「商店里面这四个同类型的面部合并成一个吧,然后可以在二级界面
// 去选择对应的面部特征」。合并这件事坏起来有三种,全都不崩、不报错、只有商店里那行字不对:
//   ① 族表引用了货架上不存在/不同类的成员 ⇒ 二级货架少一格,买家点不到那款脸;
//   ② 所有权算术把**免费底款**当凭据 ⇒ 新档一出生就白拿一个付费族(免费底款人人有份);
//      反向坏掉(只认某一款)⇒ 早就买过雀斑的人,合并之后被要求再掏一次 168;
//   ③ 买断只交付所点的那一款 ⇒ 钱扣了、其余三款还写着「金币 88」,这正是本次要修的病。
// 于是判据写成吃「实现」的纯函数:正题喂真 Career,--selftest 喂上面三种坏法。
//
// 另核两条静态事实:族卡与成员两张脸不许互认(familyOf / familyOfSkin 恒不同真,
// 否则族 id 会被当成商品走进 buy/equip),以及二级货架的「返回」键落在空带里
// (几何与判据同源:shop-shelf.shopSubOverlaps)。
//
// ⑦ 是源码判据(拆件重构后的现场:「点进去之后有个二级菜单可以选很多」,
// 可那天点族卡只冒出一颗「返回」键):族展开必须排在面板 acc 那条早退之前、脸底只许有
// FACE_STYLES.base 一个出处(「肤色」那颗旋钮不许再往脸上涂色)、点卡只选中进二级只有
// 动作键一条路 —— 都不崩不报错,数据闸门抓不到,所以钉在源码上。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/face-family-check.js
//   node .tools-build/tools/face-family-check.js --selftest
// ============================================================
import { readFileSync } from "fs";
import { CFG } from "../assets/scripts/core/config";
import { Career } from "../assets/scripts/core/career";
import { SkinDef } from "../assets/scripts/core/types";
import { shopSubOverlaps } from "../assets/scripts/ui/shop-shelf";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (c: boolean, m: string): void => h.ok(c, m);

const ALL: SkinDef[] = Object.values(CFG.skins).reduce<SkinDef[]>((a, l) => a.concat(l), []);
const byId = (id: string): SkinDef | null => ALL.find((s) => s.id === id) ?? null;
const FAMS = Object.values(CFG.families);
/** 人人有份的免费款(各表第一项 price 0)—— 所有权算术的起点档 */
const BASE = Object.keys(CFG.skins).map((k) => CFG.skins[k as keyof typeof CFG.skins][0].id);
/** 族里要付钱的那几款(免费底款不算) */
const paidOf = (fid: string): string[] =>
  (CFG.families[fid]?.members ?? []).filter((m) => (byId(m)?.price ?? 0) > 0);

console.log(`面部货架族:${FAMS.length} 族,成员共 ${FAMS.reduce((n, f) => n + f.members.length, 0)} 款\n`);

// ---------- ① 族表自洽:成员真存在、买断价有出处、二级货架摆得下 ----------
for (const f of FAMS) {
  console.log(`\n[${f.name}] ${f.id} · 买断 ${f.price} · 成员 ${f.members.length} 款`);
  ok(f.id.startsWith("fam-"), `${f.id}:族 id 带 fam- 前缀,与皮肤 id 命名空间隔开`);
  ok(!byId(f.id), `${f.id}:族 id 没有占用真实商品 id(族卡不进存档 owned)`);
  ok(f.members.length >= 2, `${f.name}:至少两款才谈得上「合并」`);
  ok(new Set(f.members).size === f.members.length, `${f.name}:成员不重号`);
  ok(f.members.every((m) => byId(m)?.kind === f.kind), `${f.name}:每款成员都存在且同类(${f.kind})`);
  ok((byId(f.members[0])?.price ?? 1) === 0, `${f.name}:首项是免费底款(二级货架第一格永远拿得到)`);
  const paid = f.members.slice(1).filter((m) => (byId(m)?.price ?? 0) > 0);
  ok(paid.length === f.members.length - 1, `${f.name}:除首项之外全是付费款(${paid.length} 款)`);

  const top = Math.max(...paid.map((m) => byId(m)!.price));
  const sum = paid.reduce((n, m) => n + byId(m)!.price, 0);
  ok(f.price === top, `${f.name}:买断价 ${f.price} = 族内最贵单款 ${top}(不是各款相加 ${sum}) —— 合并对谁都不该变成涨价`);
  ok(!!f.tag, `${f.name}:卡面有一句卖点小字(族卡不写「某一张脸长什么样」)`);

  const bad = shopSubOverlaps(f.members.length);
  ok(bad.length === 0, `${f.name}:二级货架的「返回」键不压末行卡片、不压提示带(${bad.join(" | ") || "空带够用"})`);
}

// ---------- ② 族卡与成员两张脸互不冒充(面板据此把族卡当「入口卡」:选中看当前脸,按钮才进二级) ----------
for (const f of FAMS) {
  ok(Career.familyOf(f.id)?.id === f.id, `${f.id}:familyOf 认得族卡`);
  ok(Career.familyOfSkin(f.id) === null, `${f.id}:familyOfSkin 不认族卡(族 id 走不进单品那条成交路)`);
  for (const m of f.members) {
    ok(Career.familyOfSkin(m)?.id === f.id, `${m}:familyOfSkin 认得成员`);
    ok(Career.familyOf(m) === null, `${m}:familyOf 不认成员(成员卡不会被当成族卡吞掉二级界面)`);
  }
}

// ---------- ③ 所有权算术:只认付费成员,任一付费成员 ⇒ 整族入手 ----------

type OwnsFn = (owned: string[]) => boolean;

function judgeOwns(fn: OwnsFn, fid: string): string[] {
  const out: string[] = [];
  const paid = paidOf(fid);
  if (fn(BASE)) out.push("只持默认款(含免费底款)就被判成已入手 ⇒ 白送一个付费族");
  for (const m of paid) {
    if (!fn([...BASE, m])) out.push(`已买 ${m} 却仍判「未入手」⇒ 合并后会被要求再掏一次 ${CFG.families[fid].price}`);
  }
  if (fn([...BASE, "face-ink", "face-void"])) out.push("族外脸面(墨面/纯黑)被算进了这一族");
  if (fn([...BASE, fid])) out.push("族 id 出现在 owned 里也能判成已入手(族卡不是商品)");
  return out;
}

for (const f of FAMS) {
  const bad = judgeOwns(owned => {
    Career.profile().owned = [...owned];
    return Career.ownsFamily(f.id);
  }, f.id);
  ok(bad.length === 0, `${f.name}:所有权算术(${bad.length ? bad.join(" | ") : "全绿"})`);
}

// ---------- ④ 成交:一次扣族价、整族交付;已入手则免费补票;钱不够一分不动 ----------

interface Grant { owned: string[]; coins: number; ok: boolean }
type GrantFn = (owned: string[], coins: number, pick: string) => Grant;

const grantReal: GrantFn = (owned, coins, pick) => {
  const p = Career.profile();
  p.owned = [...owned]; p.coins = coins; p.level = 1;
  const r = Career.buy(pick);
  const q = Career.profile();
  return { owned: [...q.owned], coins: q.coins, ok: r.ok };
};

function judgeBuyout(fn: GrantFn, fid: string): string[] {
  const out: string[] = [];
  const fam = CFG.families[fid];
  const paid = paidOf(fid);
  const pick = paid[paid.length - 1];

  const g = fn(BASE, 1000, pick);
  if (!g.ok) out.push(`钱够却买不动 ${pick}`);
  if (g.coins !== 1000 - fam.price) out.push(`扣了 ${1000 - g.coins},族价应是 ${fam.price}`);
  for (const m of paid) if (!g.owned.includes(m)) out.push(`买断后 ${m} 没到手(只交付所点那一款 = 钱扣了货没给全)`);
  if (g.owned.filter((id) => id === pick).length !== 1) out.push(`${pick} 在 owned 里出现不止一次`);

  const legacy = fn([...BASE, paid[0]], 1000, pick);
  if (!legacy.ok || legacy.coins !== 1000) out.push(`已买过 ${paid[0]} 的人再拿 ${pick} 还要收钱(实收 ${1000 - legacy.coins})`);

  const broke = fn(BASE, fam.price - 1, pick);
  if (broke.ok) out.push("金币不足却成交了");
  if (broke.coins !== fam.price - 1) out.push("买不成却动了金币");
  if (broke.owned.some((id) => paid.includes(id) && !BASE.includes(id))) out.push("买不成却把货先给了");

  // 免费底款:profile() 本就把各表默认款补进 owned,所以"领"这条路可能压根走不到 ——
  // 两种情形共同的硬要求是:不扣钱、拿得到那一款、并且**不许因此把整族算已入手**
  const base = fn(BASE.filter((id) => !id.startsWith("face-")), 1000, fam.members[0]);
  if (base.coins !== 1000) out.push(`领免费底款 ${fam.members[0]} 却扣了 ${1000 - base.coins}`);
  if (!base.owned.includes(fam.members[0])) out.push(`${fam.members[0]} 没到手(默认款既没补上也没领到)`);
  Career.profile().owned = [...base.owned];
  if (Career.ownsFamily(fid)) out.push("领了免费底款就等于拿下整族(见 ③ 同一条病)");

  const head = fn(BASE, 1000, fid);
  if (head.ok) out.push("族卡 id 走进了成交通道(族卡只该进二级货架,不该被 buy)");
  return out;
}

for (const f of FAMS) {
  const bad = judgeBuyout(grantReal, f.id);
  ok(bad.length === 0, `${f.name}:买断/补票/钱不够/免费底款四种情形(${bad.length ? bad.join(" | ") : "全绿"})`);
}

// ---------- ⑤ 与「买人物送脸面」同一条尺子 ----------
{
  const cross = CFG.skins.player
    .map((ps) => ({ ps, face: Career.linkedFace(ps.id) }))
    .filter((x) => x.face && Career.familyOfSkin(x.face.id));
  console.log(`\n捆绑交叉:${cross.length ? cross.map((c) => `${c.ps.name}→${c.face!.name}`).join("、") : "无"} ⇒ 这些人物款自带的脸在本族里`);
  for (const { ps, face } of cross) {
    Career.profile().owned = [...BASE, ps.id];
    const granted = Career.owns(face!.id);
    ok(granted && Career.ownsFamily(Career.familyOfSkin(face!.id)!.id),
      `只买「${ps.name}」⇒ 送的脸(${face!.id})到手,且整族算已入手,合并后不再收第二次钱`);
  }
}

// ---------- ⑥ 折叠后的货架:成员不各占一格,族卡只有一张 ----------
{
  const fid = FAMS[0].id;
  const kind = FAMS[0].kind as keyof typeof CFG.skins;
  const shelf = CFG.skins[kind].filter((s) => !Career.familyOfSkin(s.id));
  const heads = FAMS.filter((f) => f.kind === kind);
  ok(shelf.every((s) => !FAMS[0].members.includes(s.id)), `${kind} 货架折叠:没有成员漏在外面各占一格`);
  ok(heads.length === 1, `${kind} 货架上正好一张族卡(${heads.map((h2) => h2.name).join("、")})`);
  ok(shelf.length + heads.length < CFG.skins[kind].length, `${kind}:折叠后 ${CFG.skins[kind].length} 款收成 ${shelf.length + heads.length} 格`);
  console.log(`  折叠后:${["(单品)", ...shelf.map(s => s.id), `族卡 ${fid}`].join(" ")}`);
}

Career.profile().owned = [...BASE];

// ---------- ⑦ 面板与渲染层的静态事实:二级货架摆得出来 · 脸不吃肤色 · 点卡只选中 ----------
// 三条坏法都不崩、不报错、数据闸门一条抓不到,只有商店里那格不对:
//   ① _list() 的族展开排在 acc 那条早退**之后** ⇒ 点族卡只冒出一颗「返回」键,货架纹丝不动
//      (2026-10-07 拆件重构现场就是这么把二级货架弄没的,用户:「点进去之后有个二级菜单可以选很多」);
//   ② drawHead 再吃一根 skinTone ⇒ 「肤色」那颗旋钮替全公司的脸上色,选纯黑肤就把付费的
//      雀斑/猫须脸一起染黑(用户同一天点名要解耦);
//   ③ 卡片 TOUCH_END 直接调 _openFamily/_openBundle ⇒ 点一下就跳进二级,试衣间没机会亮候选
//      (2026-10-07 用户口径:「点一下就进去了,这样体验不好,应该点按钮才进」)。
/** 货架的族展开必须在 acc 早退之前,而且只许有一份 */
function checkShelfNesting(src: string): string[] {
  const out: string[] = [];
  const i = src.indexOf("private _list()");
  if (i < 0) return ["_list() 读不到了(改名要同步这条判据)"];
  const body = src.slice(i, src.indexOf("\n  }\n", i));
  const famAt = body.indexOf("this._fam ? CFG.families");
  const accAt = body.indexOf('if (this._kind === "acc")');
  if (famAt < 0) out.push("_list() 里根本没有族展开(点族卡进不了二级货架)");
  else {
    if (accAt >= 0 && famAt > accAt) out.push("族展开排在 acc 早退之后(脸面住在「形象」页,永远走不到)");
    if (body.indexOf("this._fam ? CFG.families", famAt + 1) >= 0) out.push("族展开写了两份(同一条货架两把尺子)");
  }
  return out;
}

/** 点卡只选中、进二级只有动作键一条路(2026-10-07 用户口径:「点一下就进去了,这样体验不好」)。
 *  卡片 TOUCH_END 里出现 _openFamily/_openBundle = 旧写法(点族卡/套装卡直接跳二级,
 *  试衣间永远没机会亮出候选);_act() 里少了那两条路由 = 按钮/键盘 Enter 进不去二级,
 *  _act() 又直接调 _actSet = 一级卡绕过二级直接花钱(成交只许发生在二级「一键穿戴」)。 */
function checkCardTapWiring(panel: string): string[] {
  const out: string[] = [];
  const i = panel.indexOf("Node.EventType.TOUCH_END");
  if (i < 0) return ["卡片 TOUCH_END 读不到了(改名要同步这条判据)"];
  const body = panel.slice(i, panel.indexOf("});", i));
  if (!body.includes("this._select(")) out.push("点卡不再走 _select(选中态丢了,点了没反应)");
  if (body.includes("_openFamily(") || body.includes("_openBundle(")) {
    out.push("点卡直接进二级(旧写法:要先选中看预览,按钮才进)");
  }
  const a = panel.indexOf("private _act()");
  if (a < 0) return [...out, "_act() 读不到了(改名要同步这条判据)"];
  const act = panel.slice(a, panel.indexOf("\n  }\n", a));
  if (!act.includes("this._openFamily(")) out.push("_act() 里族卡路由没了(按钮/Enter 进不了族二级货架)");
  if (!act.includes("this._openBundle(")) out.push("_act() 里套装路由没了(按钮/Enter 进不了套装二级货架)");
  if (act.includes("this._actSet(")) out.push("_act() 又直接成交套装了(整套成交只许在二级「一键穿戴」)");
  return out;
}

/** 脸面配色只许有一个出处:FACE_STYLES.base。渲染层与商店预览都不许再拿肤色往脸上涂 */
function checkFaceColor(sprites: string, panel: string): string[] {
  const out: string[] = [];
  const i = sprites.indexOf("function drawHead(");
  if (i < 0) return ["drawHead 读不到了(改名要同步这条判据)"];
  const body = sprites.slice(i, sprites.indexOf("\n}\n", i));
  if (/skinTone/.test(body)) out.push("drawHead 又吃起了 skinTone(人物肤色会替脸面上色)");
  if (/skinTone/.test(panel)) out.push("商店面板里又出现了 skinTone(卡片/试衣间另抄了一份肤色)");
  return out;
}

{
  const panel = readFileSync("assets/scripts/ui/career-panel.ts", "utf8");
  const sprites = readFileSync("assets/scripts/render/sprites.ts", "utf8");
  const bad = checkShelfNesting(panel);
  ok(bad.length === 0, `脸面族卡的二级货架摆得出来(${bad.join(" | ") || "族展开在 acc 早退之前"})`);
  const bad3 = checkCardTapWiring(panel);
  ok(bad3.length === 0, `点卡只选中、动作键才进二级(${bad3.join(" | ") || "点卡=_select;Enter 路由族卡/套装齐全"})`);
  const bad2 = checkFaceColor(sprites, panel);
  ok(bad2.length === 0, `脸底只走 FACE_STYLES.base,与「肤色」槽无关(${bad2.join(" | ") || "两处都不再上肤色"})`);
  // 数据侧同一条:每款脸自己带底色(类型上 base 必填,这里核的是别有人再填一份"随肤色"的口子)
  ok(Object.values(CFG.faceStyles).every((s) => /^#[0-9a-f]{6}$/i.test(s.base)),
    "每一款脸面都有一个写死的 hex 脸底(没有一款靠外部着色)")
  ;
  // 每件脸面商品写的 faceStyle 都得是注册表里的真 key("auto" 由渲染层现读套装的 face 旋钮)。
  // 拼错一个 key 不崩不报错:drawHead 兜回墨面 ⇒ 商店里那张卡与身上那颗头一起变黑。
  const unreg = CFG.skins.face.filter((f) => f.faceStyle !== "auto" && !CFG.faceStyles[f.faceStyle ?? ""]);
  ok(unreg.length === 0, `脸面商品的 faceStyle 全在 FACE_STYLES 注册表里(${unreg.map(f => `${f.id}→${f.faceStyle}`).join(", ") || "无悬空 key"})`);
  // 「人物默认」这个歧义源头:货架默认款不许再是"跟随"语义(用户 2026-10-07:
  // 穿着影分身的人,在「肤色脸面」这一族里看到的首格是一颗纯黑无面)
  ok(CFG.skins.face[0].faceStyle === "skin",
    `各表第一项 = 存档默认款(${CFG.skins.face[0].id})恒为素净肤色,不跟随任何人物`);
}

// ---------- selftest:三种坏法必须被点名 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:②③④⑦ 的坏写法必须被同一判据拦下");

  const ownsCases: Array<[string, OwnsFn]> = [
    ["把免费底款当买断凭据", (owned) => FAMS[0].members.some((m) => owned.includes(m))],
    ["只认最贵那一款", (owned) => owned.includes("face-cat")],
    ["把族 id 当商品存进 owned", (owned) => owned.includes(FAMS[0].id)],
  ];
  for (const [name, fn] of ownsCases) {
    const hit = judgeOwns(fn, FAMS[0].id);
    ok(hit.length > 0, `所有权反例被拦下:${name}(${hit.length} 条)`);
  }

  const grantCases: Array<[string, GrantFn]> = [
    ["按单品价只交付所点那一款(合并没真的合并)", (owned, coins, pick) => {
      const price = byId(pick)?.price ?? 0;
      return coins < price
        ? { owned, coins, ok: false }
        : { owned: [...owned, pick], coins: coins - price, ok: true };
    }],
    ["整族交付没错,但已入手的人再拿一款还要收族价", (owned, coins, pick) => {
      const fam = CFG.families[FAMS[0].id];
      const paid = paidOf(FAMS[0].id);
      return coins < fam.price
        ? { owned, coins, ok: false }
        : { owned: [...owned, ...paid.filter((m) => !owned.includes(m))], coins: coins - fam.price, ok: true };
    }],
    ["领免费底款就把整族发了(白送一个付费族)", (owned, coins, pick) => pick === FAMS[0].members[0]
      ? { owned: [...owned, ...paidOf(FAMS[0].id)], coins, ok: true }
      : grantReal(owned, coins, pick)],
  ];
  for (const [name, fn] of grantCases) {
    const hit = judgeBuyout(fn, FAMS[0].id);
    ok(hit.length > 0, `成交反例被拦下:${name}(${hit.length} 条)`);
  }

  // ⑦ 的两条源码判据:坏写法(含 2026-10-07 那份真事故)必须被同一判据点名
  const HEAD = "private _list(): Array<SkinDef | CosmeticDef> {\n";
  const TAIL = "\n  }\n";
  const shelfCases: Array<[string, string]> = [
    ["族展开排在 acc 早退之后(2026-10-07 二级货架就是这么消失的)",
      HEAD + '    if (this._kind === "acc") { return []; }\n' +
      "    const fam = this._fam ? CFG.families[this._fam] : null;\n" + TAIL],
    ["_list() 里根本没有族展开", HEAD + "    return [];\n" + TAIL],
    ["族展开写了两份(同一格两把尺子)", HEAD +
      "    const fam = this._fam ? CFG.families[this._fam] : null;\n" +
      "    const fam2 = this._fam ? CFG.families[this._fam] : null;\n" + TAIL],
  ];
  for (const [name, src] of shelfCases) {
    const hit = checkShelfNesting(src);
    ok(hit.length > 0, `货架反例被拦下:${name}(${hit.join(" | ") || "没拦住"})`);
  }

  // 点卡接线判据:旧写法(点族卡/套装卡直接进二级)与路由缺失必须被同一判据点名
  const TAP_OK = 'card.on(Node.EventType.TOUCH_END, () => {\n    if (this._dragMoved) return;\n    this._select(idx);\n  });\n';
  const ACT_OK = 'private _act() {\n    if (fam) { this._openFamily(fam.id); return; }\n    if (s.kind === "player" && s.parts) { this._openBundle(s.id); return; }\n  }\n';
  const tapCases: Array<[string, string]> = [
    ["点族卡直接 _openFamily(旧写法:试衣间没机会亮候选)",
      TAP_OK.replace("this._select(idx);", "this._openFamily(fid.id);") + ACT_OK],
    ["点卡不走 _select(点了没反应)",
      TAP_OK.replace("this._select(idx);", "// 空的") + ACT_OK],
    ["_act() 丢了套装路由(按钮/Enter 进不了套装二级)",
      TAP_OK + ACT_OK.replace('if (s.kind === "player" && s.parts) { this._openBundle(s.id); return; }\n', "")],
    ["_act() 绕过二级直接成交套装(整套成交只许在二级「一键穿戴」)",
      TAP_OK + ACT_OK.replace("this._openBundle(s.id); return; ", "this._actSet(s.id); return; ")],
  ];
  for (const [name, src] of tapCases) {
    const hit = checkCardTapWiring(src);
    ok(hit.length > 0, `点卡反例被拦下:${name}(${hit.join(" | ") || "没拦住"})`);
  }

  const CLEAN_SPRITES = "function drawHead(g: Graphics) {\n  const st = C.faceStyles[k] ?? C.faceStyles.ink;\n}\n";
  const colorCases: Array<[string, string, string]> = [
    ["drawHead 再吃一根 skinTone(肤色替全公司的脸上色)",
      "function drawHead(g: Graphics) {\n  const st = opt.skinTone && !st0.solid ? { ...st0, base: opt.skinTone } : st0;\n}\n", ""],
    ["商店预览另传一份肤色", CLEAN_SPRITES,
      "private _drawCardThumb(g: Graphics) {\n  drawHeadStill(g, vp, 0, 0, 1, th, style, \"normal\", 0, cur.skin.skinTone);\n}\n"],
  ];
  for (const [name, sprites, panel] of colorCases) {
    const hit = checkFaceColor(sprites, panel);
    ok(hit.length > 0, `配色反例被拦下:${name}(${hit.join(" | ") || "没拦住"})`);
  }

  process.exit(h.fails === 0 ? 0 : 1);
}

console.log(h.fails === 0
  ? `\n✓ face-family-check:${h.checks} 项断言全绿`
  : `\n✗ face-family-check:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
