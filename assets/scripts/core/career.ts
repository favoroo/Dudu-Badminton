// ============================================================
// 生涯成长:赛后奖励(金币/经验)、等级、皮肤的购买与装备
// 纯逻辑层:不碰渲染。皮肤按 theme 同款链路消费——
// 玩家皮肤由 applyToMatch() 挂到「你」身上(渲染只读 p.theme/p.racketSkin),
// 羽毛球是公共道具,由 game 层渲染时取 skinOf("shuttle") 传入
// ============================================================
import { CFG, SkinFamily, MilestoneStat } from "./config";
import { milestoneViews as milestoneViewsOf, statValue as milestoneStatValue, type MilestoneView } from "./milestone";
import {
  claimInfo as questClaimInfo, markClaimed as questMarkClaimed, normalizeQuests,
  questViews as questViewsOf, recordDrill as questRecordDrill, recordMatch as questRecordMatch,
  freshQuestSave, type ActivityViews, type QuestSave,
} from "./activity";
import { load, save } from "./utils";
import { Rules } from "./rules";
import { DrillResult } from "./drill";
import { AccSlot, AccessoryDef, CosmoSlot, CosmeticDef, DiffKey, SkinDef, SkinKind, SkillId, Theme } from "./types";
import { Skills } from "./skills";

const C = CFG;
const KEY = "profile";
const KINDS: SkinKind[] = ["player", "racket", "shuttle", "face"];

export interface DrillRec {
  stars: number; clears: number; bestQ: number; bestReps: number; attempts: number;
}

export interface Profile {
  /** 存档版本:目前恒 1,只作标记。将来字段语义变卦时按 v 写一次性迁移(现状是零迁移补默认) */
  v: number;
  level: number;
  exp: number;
  coins: number;
  owned: string[];
  equipped: Record<SkinKind, string>;
  /**
   * 配饰四槽(2026-10-06 配饰板块):每槽限装一件、跨槽可叠加、**允许不佩戴**。
   * ""/缺键 = 未佩戴(皮肤槽是「恒穿一件」所以没有空态,配饰有 —— 也没有免费默认款)。
   * 老档缺这个字段由 profile() 逐槽补 "",零迁移;坏值(不是合法 id 或没拥有)清回 ""。
   */
  acc?: Partial<Record<AccSlot, string>>;
  /**
   * 拆件重构的一次性闸门(2026-10-06):把"身上那套人物皮肤"摊成逐槽穿戴件之后置 true。
   *
   * 为什么用布尔而不是升 v:这条链上没有任何**老字段语义变卦**(equipped.player 仍是皮肤 id、
   * acc 仍是槽→id),而"逐槽穿戴"必须只跑一次 —— 每轮都跑会把玩家后来自己换的单件抹回套装值。
   * 其余步骤(补底款/发套装件/补脸面)全是幂等的纯函数,不需要闸门。崩在迁移中途也无所谓:
   * 发件与补底款可重跑,只有"穿戴"那一步被这个标记挡着。
   */
  lookMigrated?: boolean;
  /** 当前装备的技能(技能1 槽,恒有技能 —— 缺失由 profile() 兜 "lunge") */
  equippedSkill?: SkillId;
  /**
   * 技能2 槽(2026-10-06 双技能槽):null/缺键 = 未携带(场上技能2键显示空态)。
   * 老档缺这个字段由 profile() 补默认 null,老玩家技能1不变、零迁移。
   * 「同一款技能不许装两槽」由 equipSkill 保证(撞款即互换);技能1 恒不许空 ——
   * 卸下只对槽2开放,空槽1 没有读数兜底的意义(equippedSkill() 会兜 lunge,等于骗人)。
   */
  equippedSkill2?: SkillId | null;
  /**
   * 新手操作教学看过了吗(首次启动自动弹一次;跳过/看完/手动关闭都算看过)。
   * 老档缺这个字段由 profile() 逐字段补默认 —— 补出来是 false,正好实现
   * 「滑轨升为默认操作方式后,所有人(含老玩家)第一次启动都看一遍教学」。
   */
  tutorialDone?: boolean;
  streak: number;
  bestStreak: number;
  /**
   * 已领取的生涯里程碑档位 id(ms-* 前缀,config.MILESTONES 的主键,与商品 id 不同池)。
   * 老档缺这个字段由 profile() 补 [],零迁移;领过的 id 即使日后档位表改动也原样保留 ——
   * 清掉它就等于让玩家重新领一遍同一笔奖励。
   */
  claimed?: string[];
  /**
   * 每日/每周活动进度(2026-10-07 活动板块):d/w 是「这份进度属于哪天/哪周」的戳,
   * 跨天/跨周由 normalizeQuests 按戳整侧重置(每日与每周各记各的,互不清)。
   * 老档缺这个字段由 profile() 补当天当周的空账,零迁移。
   */
  quests?: QuestSave;
  /** 无限练习手动收局的个人单局最高分(最长相持共用 stats.maxRally) */
  bestEndlessScore: number;
  /** 训练场进度:关卡 id → 最好成绩。老档缺这个字段由 profile() 逐字段补默认,零迁移 */
  drills: Record<string, DrillRec>;
  /** 生涯累积统计 (胜负场次/扣杀/甜区/完美/最长回合) */
  stats: {
    matches: number;
    wins: number;
    smashes: number;
    sweets: number;
    perfects: number;
    hits: number;
    maxRally: number;
  };
}

// 各表第一项(price 0)即默认皮肤,坏档/新档一律兜到它
const DEFAULTS = {} as Record<SkinKind, SkinDef>;
for (const k of KINDS) DEFAULTS[k] = C.skins[k][0];

let cache: Profile | null = null;

// 作者沙箱开关(纯内存,故意不进存档):一旦拉满就掐断 profile 落盘,于是这一局里
// 发生的一切(结算的金币经验、用作弊币买的皮肤、生涯战绩)都不会写盘,杀掉重开读到的
// 还是连点之前的老档 —— 测试不污染真进度。代价是反向开关没有:想恢复落盘只能重启应用。
// 只管 profile 这一个 key;球馆/设置/闯关进度照旧落盘(那些不是这条通道碰的东西)。
let sandbox = false;

const fresh = (): Profile => ({
  v: 1,
  level: 1, exp: 0, coins: C.career.startCoins,
  owned: KINDS.map((k) => DEFAULTS[k].id),
  equipped: { player: DEFAULTS.player.id, racket: DEFAULTS.racket.id, shuttle: DEFAULTS.shuttle.id, face: DEFAULTS.face.id },
  acc: { face: "", upper: "", lower: "", hand: "" },
  lookMigrated: false,
  equippedSkill: "lunge",
  equippedSkill2: null,
  tutorialDone: false,
  streak: 0, bestStreak: 0,
  claimed: [],
  quests: freshQuestSave(new Date()),
  bestEndlessScore: 0,
  drills: {},
  stats: {
    matches: 0,
    wins: 0,
    smashes: 0,
    sweets: 0,
    perfects: 0,
    hits: 0,
    maxRally: 0,
  },
});

function profile(): Profile {
  if (!cache) cache = Object.assign(fresh(), load<Partial<Profile>>(KEY, {}));
  // 旧档缺新字段就地补齐,以后加字段不用写迁移(真要动老字段语义时再按 v 分支)
  const ref = fresh();
  for (const k of Object.keys(ref) as (keyof Profile)[]) {
    if (!(k in cache)) (cache as unknown as Record<string, unknown>)[k] = ref[k];
  }
  if (typeof cache.v !== "number") cache.v = 1;
  // 类型防御:上面的循环只补「缺键」不纠「错型」—— 手改存档/上游写坏一个 null 时,
  // owned=null 会在 owned.includes 处 TypeError,商店/结算/生涯全链路跟着崩
  if (!Array.isArray(cache.owned)) cache.owned = ref.owned;
  if (!cache.equipped || typeof cache.equipped !== "object") cache.equipped = ref.equipped;
  // 穿戴件槽:缺键补 ""(零迁移);坏值(手改存档写了个不存在的 id / 没拥有的 id)
  // 清回「未佩戴」—— 与 equippedSkill2 的坏档口径同款,别让渲染层静默兜成别款骗人。
  // 只扫 store="acc" 的槽:脸面(faceStyle)落在 equipped.face,写进 acc 就是凭空多一个键。
  if (!cache.acc || typeof cache.acc !== "object") cache.acc = { ...ref.acc };
  const accStore = cache.acc as Record<string, string>;
  for (const s of C.accSlots) {
    if (s.store !== "acc") continue;
    const v = accStore[s.key];
    if (typeof v !== "string" || !v || !accById(v) || !cache.owned.includes(v)) accStore[s.key] = "";
  }
  // 拆件迁移标记被手改坏(字符串/null)→ 退回「没迁移过」,下次进来重跑一遍,无害(有闸门挡着)
  if (typeof cache.lookMigrated !== "boolean") cache.lookMigrated = false;
  if (typeof cache.bestEndlessScore !== "number" || !Number.isFinite(cache.bestEndlessScore)) cache.bestEndlessScore = 0;
  // 里程碑已领记录:手改存档写成 null/字符串 → 兜回空数组,领奖链的 includes/push 才有得落
  if (!Array.isArray(cache.claimed)) cache.claimed = [];
  if (!cache.stats || typeof cache.stats !== "object") cache.stats = fresh().stats;
  for (const sk of Object.keys(ref.stats) as (keyof Profile["stats"])[]) {
    if (!(sk in cache.stats)) cache.stats[sk] = ref.stats[sk];
  }
  // 新增皮肤类别时老档的 owned 里没有它的默认款,就地补上(默认款永远人人有份,
  // 否则商店里会冒出「免费领取自己本来就有的脸」这种怪事);幂等
  for (const k of KINDS) {
    if (!cache.owned.includes(DEFAULTS[k].id)) cache.owned.push(DEFAULTS[k].id);
  }
  // 买了人物形象 ⇒ 它自带的那张脸面一起解锁,不要求再买一次(用户 2026-10-06)。
  // 老档下次进来就补票,不退款也不重买;幂等 —— 补过就不再加
  const bundle = bundledFaces(cache.owned);
  if (bundle.length) { cache.owned.push(...bundle); saveProfile(); }
  // ---------- 拆件重构(2026-10-06):把「一整套人物皮肤」翻译成「一组单件」 ----------
  // ① 每个槽的免费底款人人有份(与各表第一项 price 0 同一条口径);幂等
  const free = freeCosmetics(cache.owned);
  if (free.length) { cache.owned.push(...free); saveProfile(); }
  // ② 已入手的套装 ⇒ 它包含的单件一并到手,不要求再买一次。与 bundledFaces 同风格:
  //    纯函数、只交「owned 里还缺的那些」、幂等。
  const grant = grantSetPieces(cache.owned);
  if (grant.length) { cache.owned.push(...grant); saveProfile(); }
  // ③ **一次性**把"此刻身上那套"逐槽穿上 —— 更新完外观必须与更新前逐像素相同。
  //    这一步不能幂等地每轮都跑,否则玩家后来自己换的单件会被套装值抹掉。
  if (!cache.lookMigrated) {
    if (migrateLook(cache)) saveProfile();
    cache.lookMigrated = true;
    saveProfile();
  }
  if (!cache.equippedSkill) cache.equippedSkill = "lunge";
  // 手改存档把技能2槽写坏(非技能 id)→ 退回「未携带」,别让 defOf 静默兜成 lunge 骗人
  const skillIds = C.skills.list.map((s) => s.id) as string[];
  if (cache.equippedSkill2 != null && !skillIds.includes(cache.equippedSkill2 as string)) {
    cache.equippedSkill2 = null;
  }
  // 手改存档把教学标记写坏(字符串/null)→ 退回「没看过」,下次启动再教一遍,无害
  if (typeof cache.tutorialDone !== "boolean") cache.tutorialDone = false;
  // 每日/每周活动进度:缺字段补当天当周的空账;跨天/跨周在这里按戳整侧重置 ——
  // 放在归一化里(而不是各消费方自己判)意味着任何读取路径(首页横幅/活动面板/领取链)
  // 拿到的都已是新一周,没有「过了午夜面板还显示昨天的进度」这种时差
  cache.quests = normalizeQuests(cache.quests, new Date());
  // 首次自动合流散落的旧 wins / matches 记录
  const legacyWins = load<number>("wins", 0);
  const legacyMatches = load<number>("matches", 0);
  if (cache.stats.wins < legacyWins) cache.stats.wins = legacyWins;
  if (cache.stats.matches < legacyMatches) cache.stats.matches = legacyMatches;
  // 商店重构退款:owned 里的已下架皮肤按原价退币、equipped 回落默认款
  if (refundDelisted(cache)) saveProfile();
  return cache;
}

// 已下架皮肤退款:owned 里不在现行皮肤表、但命中 C.refunds 的 id,移出并按原价退币。
// 幂等 —— 退款后 id 已不在 owned,下次进来不会再命中。equipped 指向下架皮肤回落默认款
// (skinOf 本就有失效回退,这里清干净是为了存档里不留死引用)。
function refundDelisted(p: Profile): boolean {
  const keep: string[] = [];
  let refund = 0;
  for (const id of p.owned) {
    // 配饰与皮肤同住 owned:只认 skinById 会把配饰当「已下架」静默删掉,必须同查
    if (skinById(id) || accById(id)) { keep.push(id); continue; }
    const price = C.refunds[id];
    if (price) refund += price;
    else keep.push(id); // 不在退款表里的未知 id 原样保留,不误删
  }
  let changed = keep.length !== p.owned.length;
  if (changed) { p.owned = keep; p.coins += refund; }
  for (const k of KINDS) {
    if (!skinById(p.equipped[k])) { p.equipped[k] = DEFAULTS[k].id; changed = true; }
  }
  return changed;
}

/** 这个人物形象自带哪张脸面(脸面货架上有商品的才算)。捆绑发放与商店提示文案共用这一条引用,
 *  免得「送什么」在两层各写一遍。 */
export function linkedFace(playerSkinId: string): SkinDef | null {
  const ps = C.skins.player.find((s) => s.id === playerSkinId);
  return ps?.face ? (C.skins.face.find((f) => f.faceStyle === ps.face) ?? null) : null;
}

/** 买人物形象 ⇒ 自带脸面一起解锁(不另存一张捆绑表,吃的就是
 *  SKINS.player[].face → SKINS.face[].faceStyle 这条既有引用:「这个人物长这张脸」
 *  与「买他送这张脸」是同一句话,抄两份迟早漂移)。
 *  纯函数、幂等:只交「owned 里还缺的那些」,闸门 shop-bundle-check 直接喂反例。 */
export function bundledFaces(owned: string[]): string[] {
  const out: string[] = [];
  for (const ps of C.skins.player) {
    if (!ps.face || !owned.includes(ps.id)) continue;
    const f = linkedFace(ps.id);
    if (f && !owned.includes(f.id) && !out.includes(f.id)) out.push(f.id);
  }
  return out;
}

/** 每个槽的免费底款(价 0 的穿戴件)+ 各槽描述符点名的 base 件。
 *  纯函数、幂等:只交 owned 里还缺的那些。闸门 look-compose-check 直接喂反例。 */
export function freeCosmetics(owned: string[]): string[] {
  const out: string[] = [];
  for (const c of C.accessories) {
    if (c.price === 0 && !owned.includes(c.id) && !out.includes(c.id)) out.push(c.id);
  }
  return out;
}

/** 套装 → 它包含的单件。吃的就是 `SKINS.player[].parts` 这一根引用:
 *  「这套由这几件组成」与「买了这套就都有这几件」是同一句话,抄两份迟早漂移。
 *  纯函数、幂等 —— 与 bundledFaces 同一条车道,只是发的从一张脸变成一组件。 */
export function grantSetPieces(owned: string[]): string[] {
  const out: string[] = [];
  for (const ps of C.skins.player) {
    if (!ps.parts || !owned.includes(ps.id)) continue;
    for (const id of Object.values(ps.parts)) {
      if (id && !owned.includes(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * 一次性迁移:把「身上那套人物皮肤」摊成逐槽穿戴件,让更新前后的外观逐像素相同。
 *
 * 两条不许越界的规则:
 *  ① **已有真件的槽一律不覆盖**。老档 `acc.lower = "acc-sneaker"`(疾步球鞋)必须活着,
 *     哪怕那套人物皮肤想写 ft-ink —— 玩家先买的东西优先。
 *  ② 只写「空槽」或「还停在免费底款上」的槽:这两种状态都不携带玩家的选择,顶掉它没有损失。
 *
 * 返回是否改动过(调用方据此决定要不要落盘)。幂等由 Profile.lookMigrated 这一道闸保证。
 */
function migrateLook(p: Profile): boolean {
  let changed = false;
  // 先把所有槽补到底款("" 与底款在合成层等价,但存档里留个明确 id,UI 的「装备中」才不说谎)
  for (const meta of C.accSlots) {
    if (meta.store !== "acc" || !meta.base) continue;
    const key = meta.key as AccSlot;
    const cur = p.acc?.[key] || "";
    if (!cur) { p.acc![key] = meta.base; changed = true; }
  }
  const set = skinById(p.equipped.player);
  if (set?.parts) {
    for (const [slot, id] of Object.entries(set.parts)) {
      if (!id) continue;
      const key = slot as AccSlot;
      const meta = C.accSlots.find((s) => s.key === key);
      if (!meta || meta.store !== "acc") continue;
      const cur = p.acc?.[key] || "";
      if (cur && cur !== meta.base) continue;          // 规则①
      if (!p.owned.includes(id)) continue;             // 规则:只穿已到手的东西
      p.acc![key] = id;
      changed = true;
    }
  }
  return changed;
}

/** 身上这套穿戴件是否**恰好**等于某个套装。
 *  「当前形象叫什么名字」由它现算,不存可变指针 —— 存指针就会过期,过期就说谎。 */
function matchesSet(p: Profile, set: SkinDef): boolean {
  if (!set.parts) return false;
  for (const [slot, id] of Object.entries(set.parts)) {
    if ((p.acc?.[slot as AccSlot] || "") !== id) return false;
  }
  return true;
}

/** 身上穿戴件是否**恰好**是这套的原样 —— 套装卡那个「装备中」角标的唯一出处。
 *  商店与合成层(报名字用)读同一个判断,不会出现"卡上说在穿、小人穿的是另一套"。 */
function wearsSet(setId: string): boolean {
  const set = skinById(setId);
  return !!set && matchesSet(profile(), set);
}

// ---------- 套装(打包卖)的定价:补齐差价,已有的件不重复收 ----------

/** 这套包含哪些「件」:parts 指向的单件 + 它自带的那张脸面。
 *  脸面走既有的 `ps.face → SKINS.face[].faceStyle` 那根引用(linkedFace),
 *  不另立第二张捆绑表 —— 「这套自带这张脸」与「买这套送这张脸」是同一句话。 */
function setItems(set: SkinDef): Array<{ id: string; price: number }> {
  const out: Array<{ id: string; price: number }> = [];
  for (const id of Object.values(set.parts ?? {})) {
    const c = id ? accById(id) : null;
    if (c) out.push({ id: c.id, price: c.price });
  }
  const f = linkedFace(set.id);
  if (f) out.push({ id: f.id, price: f.price });
  return out;
}

export interface SetPrice {
  /** 现在按下去要扣多少(已集齐 / 已入手整套 ⇒ 0) */
  charge: number;
  /** 全部付费件单买合计 —— 卡面「省 N 金币」的减数 */
  total: number;
  /** 还没到手的那几件合计 */
  lack: number;
  /** 整套是否已经齐了(手里有这套 id,或付费件件件都在 owned 里) */
  have: boolean;
  /** 件数(含自带脸面)。1 件的套装不算套装,货架不摆它的套装卡。 */
  n: number;
}

/**
 * 套装价 = **这条 def 当年的原价**,再按"还缺几件"等比折算:
 *
 *     charge = round(原价 × 缺件合计 / 全部付费件合计)
 *
 * 三条口径,一条都别改:
 *  ① 一件没买时 charge **恰好等于老价格** —— 本轮重构不动经济曲线;
 *  ② 已经买过其中几件的人只补剩下的,**绝不为同一件东西付第二次钱**
 *     (与 ownsFamily「任一付费成员已入手即整族到手」同一条精神,只是跨槽时按件折算);
 *  ③ 免费底款不计入 total/lack —— 人人有份的东西没有"买断"可言。
 *
 * 为什么不复用族卡的「买断价 = 族内最贵单款」:那条是给**同槽互斥**的四张脸用的
 * (只能穿一张,合并只是省货架);套装是不同槽同时穿戴,取最贵一件等于把七成的货白送。
 */
/** 定价核心:吃一份套装 def(不是 id)—— 闸门要能喂**伪造的**套装来测边界,
 *  只认 id 的实现永远测不到"数据里多塞了一件"这种情形。 */
function setPriceFor(set: SkinDef, owned: string[]): SetPrice {
  const items = setItems(set);
  const paid = items.filter((i) => i.price > 0);
  const total = paid.reduce((s, i) => s + i.price, 0);
  const lack = paid.filter((i) => !owned.includes(i.id)).reduce((s, i) => s + i.price, 0);
  const have = owned.includes(set.id) || lack === 0;
  const charge = have || total === 0 ? 0 : Math.max(1, Math.round((set.price * lack) / total));
  return { charge, total, lack, have, n: items.length };
}

function setPriceOf(setId: string, owned: string[]): SetPrice {
  const set = skinById(setId);
  return set ? setPriceFor(set, owned) : { charge: 0, total: 0, lack: 0, have: true, n: 0 };
}

/** 当前档案下这件套装的成交价(闸门与 UI 共用这一张嘴,别在 UI 里另算一份) */
function setPrice(setId: string): SetPrice {
  return setPriceOf(setId, profile().owned);
}

/** 凑不齐两件的就不是套装:纯色款(活力橙/深海蓝/樱花粉)拆完只剩一件上衣,
 *  套装卡与单件卡长得一模一样,摆上「形象套装」那一格是噪声。
 *  判据只写这一次 —— 面板、出图工具、闸门各自 filter 一遍必然漂成三套
 *  (出图那版就把免费底款「经典红」画在了套装页上)。 */
function shelfSets(): SkinDef[] {
  return C.skins.player.filter((s) => (s.parts ? setItems(s).length >= 2 : false));
}

function saveProfile(): void {
  // 作者沙箱开着时一个字节都不写盘,见下方 sandbox 注释
  if (sandbox) return;
  save(KEY, cache);
}

function skinById(id: string): SkinDef | null {
  for (const k of KINDS) {
    const s = C.skins[k].find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

// kind 当前装备的皮肤(档里的 id 失效时回退默认,皮肤表改名也不会白屏)
function skinOf(kind: SkinKind): SkinDef {
  const s = skinById(profile().equipped[kind]);
  return s || DEFAULTS[kind];
}

const owns = (id: string): boolean => profile().owned.includes(id);
const unlocked = (s: { unlockLevel?: number }): boolean => !s.unlockLevel || profile().level >= s.unlockLevel;

// ---------- 穿戴件(2026-10-06 拆件重构:一槽一件,挂件与本体件同住这张表) ----------

/** 件 id → 定义(与 skinById 平行的第二条查表;两表 id 不许撞,accessory-check 断言) */
function accById(id: string): CosmeticDef | null {
  return C.accessories.find((a) => a.id === id) ?? null;
}

/** 判别轴是「自己画不画」:wear 件自带 ACC_STYLES 画法,要挂到实体 p.acc 上;
 *  part 件不画自己,只把旋钮写进 look() 合成出的那份 SkinDef,永远不去渲染层。 */
const isWear = (c: CosmeticDef): c is AccessoryDef => c.kind === "wear";

/** 某槽当前佩戴/穿着的件(null = 该槽空着)。faceStyle 槽不落 acc,由 accAt 统一指路。 */
function equippedAcc(slot: AccSlot): CosmeticDef | null {
  const id = accAt(profile(), slot);
  return id ? accById(id) : null;
}

/** 按槽位描述符取存档落点:store="acc" 读 Profile.acc,"kind"(脸面)读 equipped.face。
 *  全代码库只有这一处翻译两种存储 —— 别在 UI 层再判一次 store。 */
function accAt(p: Profile, slot: CosmoSlot): string {
  const meta = C.accSlots.find((s) => s.key === slot);
  if (!meta) return "";
  return meta.store === "kind" ? (p.equipped.face || "") : (p.acc?.[slot as AccSlot] || "");
}

/** 已佩戴的**挂件**件,按槽位表顺序收成新数组挂到实体上。
 *  每次调用都新建数组 —— viewOf 按实体拷引用,原地改共享数组就是「全员戴同一条围巾」。
 *  part 件在这里被过滤掉:它们的外观已经并进 look() 合成的 SkinDef 了。 */
function equippedAccs(): AccessoryDef[] {
  const p = profile();
  const out: AccessoryDef[] = [];
  for (const s of C.accSlots) {
    if (s.store !== "acc") continue;
    const id = p.acc?.[s.key as AccSlot];
    if (!id) continue;
    const a = accById(id);
    if (a && isWear(a)) out.push(a);
  }
  return out;
}

// 佩戴配饰:同槽覆盖 = 天然单选(戴第二条围巾时顶掉第一条);跨槽互不影响。
// 必须已拥有;佩戴后 save + applyToMatch(当前对局与菜单演示小人同步换装)
function equipAcc(id: string): boolean {
  const a = accById(id);
  if (!a || !owns(id)) return false;
  const p = profile();
  p.acc![a.slot] = id;
  saveProfile();
  applyToMatch();
  return true;
}

/** 卸下某槽配饰(配饰允许空槽,与皮肤「恒穿一件」不同);已空返回 false,UI 据此不弹提示 */
function unequipAcc(slot: AccSlot): boolean {
  const p = profile();
  if (!p.acc?.[slot]) return false;
  p.acc[slot] = "";
  saveProfile();
  applyToMatch();
  return true;
}

// ---------- 皮肤族(货架上的一张卡 = 一组同类商品) ----------

/** 族卡 id → 族定义("fam-" 前缀让它与皮肤 id 天然不撞,族 id 永远不会出现在 owned 里) */
const familyOf = (fid: string): SkinFamily | null => C.families[fid] ?? null;

/** 这件商品属于哪个族;不属于任何族 = null(货架按单品摆) */
function familyOfSkin(id: string): SkinFamily | null {
  for (const f of Object.values(C.families)) if (f.members.includes(id)) return f;
  return null;
}

/** 族内**付费成员**只要有一款在 owned 里,整族就算入手。
 *  免费底款(普通肤色)人人有份,拿它当凭据等于白送一个付费族。
 *  反过来:老玩家买过其中任意一款都不必再掏钱 —— 货架合并不该让人为同一件东西付第二次。 */
function ownsFamily(fid: string): boolean {
  const f = familyOf(fid);
  if (!f) return false;
  return f.members.some((id) => (skinById(id)?.price ?? 0) > 0 && owns(id));
}

const expNeed = (lv: number): number => C.career.level.expBase + (lv - 1) * C.career.level.expStep;
const levelCoin = (lv: number): number => C.career.level.coinBase + lv * C.career.level.coinStep;

// 经验入账 + 可能连升。比赛结算和训练结算共用这一段:
// 两条入口的经济必须严格一致,复制一份出来早晚漂移成两套曲线。
// 返回升到的等级列表(满级后经验不再累计,防数字无意义膨胀)
function addExp(p: Profile, exp: number): number[] {
  const levelUps: number[] = [];
  p.exp += exp;
  while (p.level < C.career.level.cap && p.exp >= expNeed(p.level)) {
    p.exp -= expNeed(p.level);
    p.level++;
    p.coins += levelCoin(p.level);
    levelUps.push(p.level);
  }
  if (p.level >= C.career.level.cap) p.exp = 0;
  return levelUps;
}

export interface MatchStats {
  hits?: number; smashes?: number; sweets?: number; perfects?: number; whiffs?: number;
}

export interface SettleResult {
  coin: number; exp: number; perf: number; baseCoin: number; streakBonus: number;
  streak: number; levelUps: number[]; first?: boolean;
  unlocked: SkinDef[];
  /** 本次结算新完成且未领的活动任务 id(game-root 拿去飘字播报;2p 友谊赛不走这个出口) */
  questsDone?: string[];
}

// ---------- 赛后结算:发奖励 + 升级,返回明细给 UI 展示 ----------
// 2p 同屏没有 CPU,属友谊赛:不发奖励、连胜清零(防两人互相刷币)
// campaign:闯关首通按战前简报承诺的关卡奖励(stage.rewards)发放,重打回落难度表;
// 由 game 层从 campaign-clear 事件取出 firstClear 与奖励传入(rules 里 recordStageClear
// 先于本函数执行,到这时「是不是首通」只能从事件侧带过来)。
// scores:无限练习收局时的终局比分,用于单局最高分落盘。
function settle({ mode, diff, won, stats, longestRally, scores, campaign }: {
  mode: string; diff: DiffKey; won: boolean; stats?: MatchStats; longestRally?: number;
  scores?: [number, number];
  campaign?: { firstClear: boolean; coins: number; exp: number };
}): SettleResult | null {
  const p = profile();

  // 累计生涯统计数据 (场次、胜场、击球、扣杀、甜区、完美、最长相持)
  p.stats.matches++;
  if (won) p.stats.wins++;
  if (stats) {
    p.stats.smashes += (stats.smashes || 0);
    p.stats.sweets += (stats.sweets || 0);
    p.stats.perfects += (stats.perfects || 0);
    p.stats.hits += (stats.hits || 0);
  }
  p.stats.maxRally = Math.max(p.stats.maxRally || 0, longestRally || 0);

  // 活动任务进度与生涯统计同口径:2p 也算「完成一局」、胜负按同一把 won 尺,
  // 无限练习带终局个人比分喂 max 型任务。2p 早退前记录 —— 2p 不发奖但仍要记进度。
  const questsDone = questRecordMatch(p.quests!, {
    won,
    smashes: stats?.smashes, sweets: stats?.sweets, perfects: stats?.perfects,
    endlessScore: mode === "endless" && scores ? scores[0] : undefined,
  }, new Date());

  if (mode === "2p") { p.streak = 0; saveProfile(); return null; }

  // 无限练习收局:单局个人最高分落盘(从前这个模式永不结算,什么都留不下)
  if (mode === "endless" && scores) {
    p.bestEndlessScore = Math.max(p.bestEndlessScore || 0, scores[0]);
  }

  const R0 = C.career.rewards[diff] || C.career.rewards.normal;
  const mul = mode === "2v2" ? C.career.doublesMul : 1;
  const B = C.career.bonus;

  // 表现分:赢得漂亮拿得更多(你方含双打搭档,一起算)
  const smash = Math.min((stats?.smashes || 0) * B.perSmash, B.smashCap);
  const sweet = Math.min((stats?.sweets || 0) * B.perSweet, B.sweetCap);
  const rally = (longestRally || 0) >= B.longRallyMin ? B.longRallyCoin : 0;
  const perf = Math.round((smash + sweet + rally) * mul);

  // 连胜加成只乘金币,按结算前的连胜数算(首胜无加成,第二连胜起 +10%)
  const streakBonus = won ? Math.min(p.streak * B.streakStep, B.streakCap) : 0;
  // 闯关首通:基础金币/经验换成关卡奖励(表现分与连胜照常叠加,只多不少);
  // 重打不走这一支 —— 简报承诺的是「首通 +N」,按次发等于回头刷第 1 关印钞。
  const stageFirst = mode === "campaign" && !!campaign && !!campaign.firstClear;
  const baseCoin = Math.round(stageFirst ? campaign!.coins : (won ? R0.win : R0.lose) * mul);
  const coin = Math.round((baseCoin + perf) * (1 + streakBonus));
  const exp = Math.round(stageFirst ? campaign!.exp : (won ? R0.expWin : R0.expLose) * mul);

  p.streak = won ? p.streak + 1 : 0;
  p.bestStreak = Math.max(p.bestStreak, p.streak);

  const levelUps = addExp(p, exp);
  p.coins += coin;
  saveProfile();

  return {
    coin, exp, perf, baseCoin, streakBonus,
    streak: p.streak, levelUps,
    first: stageFirst,
    unlocked: skinsUnlockedAt(levelUps),
    questsDone,
  };
}

// ---------- 训练关结算:只有「首次通关」那一次发钱 ----------
// 训练场可以无限重开,按次发钱等于开了个无上限的印钞机;
// 之后重打只刷新星级与最好成绩。不读写 streak —— 连胜是比赛资产,训练不该稀释它。
// res = Drill.result();返回键集与 settle() 完全一致,UI 的奖励渲染能原样吃
function settleDrill(res: DrillResult): SettleResult {
  const p = profile();
  const D = C.career.drill, def = res.def;
  if (!def) {
    return { coin: 0, exp: 0, perf: 0, baseCoin: 0, streakBonus: 0, streak: p.streak, levelUps: [], first: false, unlocked: [] };
  }
  const rec = p.drills[def.id] || (p.drills[def.id] = {
    stars: 0, clears: 0, bestQ: 0, bestReps: 0, attempts: 0,
  });
  const first = !rec.clears;
  const coin = first ? D.firstClear.coin + res.stars * D.perStar.coin : 0;
  const exp = first ? D.firstClear.exp + res.stars * D.perStar.exp : 0;
  const levelUps = first ? addExp(p, exp) : [];

  rec.stars = Math.max(rec.stars, res.stars);
  rec.clears++;
  rec.bestQ = Math.max(rec.bestQ || 0, res.avgQ || 0);
  rec.bestReps = Math.max(rec.bestReps || 0, res.valid || 0);
  rec.attempts = (rec.attempts || 0) + (res.attempts || 0);

  // 活动任务:「完成一次专项训练」类只记 drill 维度;训练不发奖也不飘字,
  // 完成提示交给首页横幅与活动面板(训练有自己的结算排版,别再往上叠一行)
  questRecordDrill(p.quests!, new Date());

  p.coins += coin;
  saveProfile();

  return {
    coin, exp, perf: 0, baseCoin: coin, streakBonus: 0,
    streak: p.streak, levelUps, first,
    unlocked: first ? skinsUnlockedAt(levelUps) : [],
  };
}

export interface MilestoneClaim {
  coin: number; exp: number; levelUps: number[];
}

// ---------- 生涯里程碑领取(2026-10-07):整卡点按,一次领走该格全部已达成的未领档 ----------
// 与 settle/settleDrill 同一条经济轨道:金币直接入账、经验必须走 addExp(升级金币由它
// 同步发),严禁在这里另抄一份升级曲线 —— 复制出来早晚漂移成两套(见 addExp 头注)。
// 无可领档返回 null(UI 只在读数可领时才点得动,这里再拦一道防绕过)。
function claimMilestone(stat: MilestoneStat): MilestoneClaim | null {
  const p = profile();
  const value = milestoneStatValue(stat, p.stats, p.bestEndlessScore);
  const reach = C.milestones.filter(
    (m) => m.stat === stat && value >= m.at && !p.claimed!.includes(m.id),
  );
  if (!reach.length) return null;
  let coin = 0, exp = 0;
  for (const m of reach) {
    p.claimed!.push(m.id);
    coin += m.coin;
    exp += m.exp;
  }
  p.coins += coin;
  const levelUps = addExp(p, exp);
  saveProfile();
  return { coin, exp, levelUps };
}

/** 六格里程碑视图(可领/下一档/已领满):生涯面板排版与 milestone-check 共用这一份 */
function milestoneViews(): Record<MilestoneStat, MilestoneView> {
  const p = profile();
  return milestoneViewsOf(p.stats, p.bestEndlessScore, p.claimed);
}

export interface ActivityClaim {
  coin: number; exp: number; levelUps: number[];
}

// ---------- 活动任务领取(2026-10-07 活动板块):与 claimMilestone 同一条经济轨道 ----------
// 金币直接入账、经验必须走 addExp(升级金币由它同步发),严禁另抄升级曲线(见 addExp 头注)。
// 校验与记账两半在 core/activity.ts(claimInfo/markClaimed),这里只管发钱;
// 无可领返回 null(面板只在读数可领时才点得动,这里再拦一道防绕过)。
function claimActivity(id: string): ActivityClaim | null {
  const p = profile();
  const grant = questClaimInfo(p.quests!, id, new Date());
  if (!grant) return null;
  questMarkClaimed(p.quests!, id, new Date());
  p.coins += grant.coin;
  const levelUps = addExp(p, grant.exp);
  saveProfile();
  return { coin: grant.coin, exp: grant.exp, levelUps };
}

/** 活动三态视图(进行中/可领取/已领取 + 宝箱):活动面板与首页横幅副行共用这一份 */
function activityViews(): ActivityViews {
  const p = profile();
  return questViewsOf(p.quests!, new Date());
}

// 升级踩到解锁门槛、且还没拥有的商品 → 结算屏「商店上新」提示(皮肤与穿戴件同扫)。
// 拆件后 C.accessories 是那张 47 件的大表,新单件的 unlockLevel 也从这里播报。
function skinsUnlockedAt(levels: number[]): SkinDef[] {
  if (!levels.length) return [];
  const all: Array<SkinDef | CosmeticDef> = [...KINDS.flatMap((k) => C.skins[k]), ...C.accessories];
  return all.filter((s) => {
    const ul = s.unlockLevel;
    return !!ul && levels.some((lv) => lv >= ul) && !owns(s.id);
  }) as SkinDef[];
}

export interface BuyResult {
  ok: boolean;
  reason?: string;
  /** 族内成交的两种:bought = 一次扣族价拿下整族,granted = 族已入手、这一款免费补上 */
  family?: "bought" | "granted";
  /** 套装成交的两种:bought = 扣补齐差价拿下整套,completed = 件件都在手上了,0 元登记这套 */
  set?: "bought" | "completed";
  /** 套装成交时一并到手的件数(成交提示要说清"还送了什么",否则买家只看到钱少了) */
  setPieces?: number;
}

// ---------- 商店 ----------
// 皮肤、穿戴件、套装共用这一条购买链(同一个 owned 数组与金币钱包)。
// 族卡只对同槽皮肤有意义;套装是跨槽的另一条道,两条都在这个函数里,别另起第三个成交入口。
function buy(id: string): BuyResult {
  const s = skinById(id);
  const a = accById(id);
  const def = s ?? a;
  if (!def) return { ok: false, reason: "没有这件商品" };
  if (owns(id)) return { ok: false, reason: "已经拥有" };
  if (!unlocked(def)) return { ok: false, reason: `Lv.${def.unlockLevel ?? "?"} 解锁` };
  const p = profile();

  // ---------- 套装:按「补齐差价」成交 ----------
  // 单件已经买过几件的人,这里只收剩下那几件折算后的钱(setPriceOf 的口径)。
  // 一件件都齐了但从没"买过这套" ⇒ 0 元登记,不再收一次。
  if (s?.parts) {
    const pr = setPriceOf(id, p.owned);
    if (!pr.have && p.coins < pr.charge) return { ok: false, reason: "金币不足" };
    const gained: string[] = [];
    for (const it of setItems(s)) {
      if (it.price > 0 && !p.owned.includes(it.id)) { p.owned.push(it.id); gained.push(it.id); }
    }
    if (!p.owned.includes(id)) p.owned.push(id);
    if (!pr.have) p.coins -= pr.charge;
    saveProfile();
    return { ok: true, set: pr.have ? "completed" : "bought", setPieces: gained.length };
  }

  // 族内付费成员走的不是单品价:一次扣**族价**把族内所有付费成员一并记进 owned。
  // 已经拥有族内任何一款 ⇒ 这一款免费补进 owned(ownsFamily 的口径,不二次收费)。
  // 免费成员(普通肤色)不进这条道 —— 它没有"买断"可言,落回下面的 0 元领取。
  const fam = s ? familyOfSkin(id) : null;
  if (fam && s && s.price > 0) {
    if (ownsFamily(fam.id)) {
      p.owned.push(id);
      saveProfile();
      return { ok: true, family: "granted" };
    }
    if (p.coins < fam.price) return { ok: false, reason: "金币不足" };
    p.coins -= fam.price;
    for (const m of fam.members) {
      if ((skinById(m)?.price ?? 0) > 0 && !owns(m)) p.owned.push(m);
    }
    saveProfile();
    return { ok: true, family: "bought" };
  }

  if (p.coins < def.price) return { ok: false, reason: "金币不足" };
  p.coins -= def.price;
  p.owned.push(id);
  saveProfile();
  return { ok: true };
}

/**
 * 整套穿上:逐槽写进 acc + equipped.player 记这套 + 自带脸面跟着换(它就在 setItems 里)。
 *
 * 与「一件件穿」的唯一区别是这一步会**覆写这套涉及的每个槽**;没涉及的槽(比如球拍、
 * 挂件)一律不动 —— 买的是形象,不是把人从头到脚重置一遍。
 * 必须已拥有该套装或其全部付费件,否则拒收(返回 false,UI 报"先买再穿")。
 */
function equipSet(id: string): boolean {
  const set = skinById(id);
  if (!set?.parts || set.kind !== "player") return false;
  const p = profile();
  if (!p.owned.includes(id) && !setPriceOf(id, p.owned).have) return false;
  for (const [slot, piece] of Object.entries(set.parts)) {
    if (!piece || !p.owned.includes(piece)) continue;
    p.acc![slot as AccSlot] = piece;
  }
  if (!p.owned.includes(id)) p.owned.push(id);
  p.equipped.player = id;
  const gift = linkedFace(id);
  if (gift && p.owned.includes(gift.id)) p.equipped.face = gift.id;
  saveProfile();
  applyToMatch();
  return true;
}

// 装备后立刻刷新当前对局的外观——菜单背景的演示小人马上换装
function equip(kind: SkinKind, id: string): boolean {
  const s = skinById(id);
  if (!s || s.kind !== kind || !owns(id)) return false;
  profile().equipped[kind] = id;
  saveProfile();
  applyToMatch();
  return true;
}

// 买完顺手穿上:一次把新买的三类里这一类装备好
function buyAndEquip(kind: SkinKind, id: string): BuyResult {
  const r = buy(id);
  if (!r.ok) return r;
  equip(kind, id);
  return r;
}

// 配饰版「买完顺手戴上」(buy 已对配饰同链开放,只差装备一步)
function buyAcc(id: string): BuyResult {
  const r = buy(id);
  if (!r.ok) return r;
  equipAcc(id);
  return r;
}

// 获取当前装备的技能 (缺省为 "lunge")
function equippedSkill(): SkillId {
  return profile().equippedSkill || "lunge";
}

// 获取技能2槽(null/undefined = 未携带)
function equippedSkill2(): SkillId | null {
  return profile().equippedSkill2 || null;
}

/**
 * 开赛闸判据(用户指令 2026-10-06:两个技能都配好才许开赛,三处开赛口共用)。
 * 槽1 恒有技能(equipSkill 口径②),所以"没配齐"只可能是槽2空着;
 * 但第二个技能要 Lv.2 才解锁 —— 新档根本没有第二款可配,这道闸只对
 * "配得齐"的人关(已解锁款 ≥2 才拦),否则新手永远开不了对练,只能在训练场磨级。
 */
function skillSlotsReady(): boolean {
  if (equippedSkill2()) return true;
  const unlockedCount = Skills.allSkills().filter((s) => isSkillUnlocked(s.id)).length;
  return unlockedCount < 2;
}

// ---------- 作者通道:测试档拉满(CFG.author,手势判定在 main-menu.ts) ----------
// 只动等级与金币:经验清零(满级后 addExp 本就不留经验),金币取「已有 vs 给定」的较大值,
// 于是重复触发只会稳定停在满档,不会把已经花掉的钱又补回一个更大的数。
// 皮肤/技能解锁全部按 level 现算(career.unlocked / isSkillUnlocked),所以拉满等级即全解锁。
// 顺带打开 sandbox:这一局不再落盘,重开应用即回到点之前的档,所以每次进应用都要重新连点。
function maxOut(coins: number): { level: number; coins: number } {
  const p = profile();   // 先取档(可能触发退款归一化并落盘),再掐落盘
  sandbox = true;
  p.level = C.career.level.cap;
  p.exp = 0;
  p.coins = Math.max(p.coins, coins);
  return { level: p.level, coins: p.coins };
}

// 沙箱是否开着(UI 想挂「本次不落盘」提示时读它)
const sandboxed = (): boolean => sandbox;

// 检查某个技能是否已通过等级解锁
function isSkillUnlocked(id: SkillId): boolean {
  const def = Skills.defOf(id);
  return profile().level >= def.unlockLevel;
}

/**
 * 装备指定技能到某一槽(缺省槽1 = 旧口径,旧调用方不改也通)。
 *
 * 双槽三条口径(2026-10-06):
 * ① **撞款即互换**:目标槽想装进另一槽已有的技能时,两槽内容对调 —— 换个键位放,
 *    而不是弹回失败(玩家读到的永远是"装上了")。
 * ② **技能1 恒有技能**:往槽2装槽1的那款时,若槽2是空的就拒绝(返回 false,UI 给提示)——
 *    空槽1 会把 equippedSkill() 的 "lunge" 兜底变成一句谎话,干脆不允许;
 *    槽2有别的技能则是正常互换(①)。
 * ③ 卸下只对槽2开放(unequipSkill);槽1想换款直接装另一款即可,无需先卸。
 */
function equipSkill(id: SkillId, slot: 1 | 2 = 1): boolean {
  if (!isSkillUnlocked(id)) return false;
  const pr = profile();
  if (slot === 2) {
    if (pr.equippedSkill === id) {
      if (!pr.equippedSkill2) return false;    // 口径②:槽1那款挪不进空槽2
      pr.equippedSkill = pr.equippedSkill2;    // 口径①:互换
    }
    pr.equippedSkill2 = id;
  } else {
    if (pr.equippedSkill2 === id) pr.equippedSkill2 = pr.equippedSkill;
    pr.equippedSkill = id;
  }
  saveProfile();
  applyToMatch();
  return true;
}

/** 卸下技能2槽(槽1恒有技能,卸它恒拒绝)。已空也返回 false,UI 据此不弹提示 */
function unequipSkill(slot: 1 | 2 = 2): boolean {
  if (slot === 1) return false;
  const pr = profile();
  if (!pr.equippedSkill2) return false;
  pr.equippedSkill2 = null;
  saveProfile();
  applyToMatch();
  return true;
}

/** 新手教学看完/跳过/手动关闭都落这个标记:同设备只自动弹一次(重看入口在训练场与设置页) */
function setTutorialDone(): void {
  const p = profile();
  if (p.tutorialDone) return;
  p.tutorialDone = true;
  saveProfile();
}

// ---------- 形象合成(2026-10-06 拆件重构):N 槽穿戴件 → 渲染层已经在吃的那一对 ----------

/** 一份「此刻长什么样」。渲染层只认这三样,而且**只从 applyToMatch 那一个口子拿到** ——
 *  拆件之后不再有"一条人物皮肤定义全部外观"这回事,但 sprites.ts 不必知道这件事。 */
export interface Look {
  theme: Theme;
  skin: SkinDef;
  acc: AccessoryDef[];
}

/** 底色的那三个值 = 经典红 p-red 的原值。上衣槽的空态与 j-red 底款都兜到这里。 */
const BASE_THEME = { main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a" };

/** 本体件往合成 SkinDef 上搬哪几根旋钮。字段名两边同源,**逐键赋值、不做翻译** ——
 *  加一根新旋钮 = 这里加一行,不用动任何调用点。 */
const PART_KEYS = [
  "skinTone", "body", "hairStyle", "hairColor", "headwear",
  "main", "dark", "glow", "jersey", "sock", "shoe", "aura",
] as const;

/**
 * 按槽位表顺序把所有本体件折成一份 SkinDef。
 *
 * `picks` = 商店预览用的"这一件换上去之后长什么样"(按槽覆写,其余照旧),
 * 正常取当前形象时不传。
 *
 * 两条不能改的口径:
 *  ① 每次调用都新建 skin/theme/acc 三样。view-cache 按实体拷引用,共享一份就会
 *     「全员戴同一条围巾」(见 render/view-cache.ts)。
 *  ② `face` 与 `name` 仍取**套装**那根 legacy 旋钮(equipped.player)。渲染层只在装备
 *     「跟随人物」(faceStyle "auto")时才读这一根;留着还有第二个理由 —— look-compose
 *     断言"逐件穿上后合成出的 SkinDef 与该套装 def 逐键相等",少一个键就是那条地基断了。
 */
function composeLook(picks?: Partial<Record<AccSlot, CosmeticDef>>): Look {
  const p = profile();
  const set = skinById(p.equipped.player);
  // 名字现算:穿戴件恰好还是这套的原样才叫这套的名字,否则叫「自定义形象」。
  // 存一个"当前套装"指针就会过期 —— 玩家换掉一件,指针还在替它报喜。
  const custom = !set || !matchesSet(p, set);
  const skin: SkinDef = {
    id: "look", kind: "player", name: custom ? "自定义形象" : set!.name, price: 0,
    main: BASE_THEME.main, dark: BASE_THEME.dark, glow: BASE_THEME.glow,
    ...(set?.face ? { face: set.face } : {}),
  };
  for (const meta of C.accSlots) {
    if (meta.store !== "acc") continue;
    const key = meta.key as AccSlot;
    const worn = picks?.[key]
      ?? accById(p.acc?.[key] || "")
      ?? (meta.base ? accById(meta.base) : null);
    if (!worn || worn.kind !== "part") continue;
    for (const k of PART_KEYS) {
      const v = worn[k];
      // 逐键搬运的代价:TS 不知道 k 与 skin[k] 同型(只有 body 是联合字面量),
      // 所以这里过一道 unknown。键集由 PART_KEYS 与 CosmoPart 手工对齐,闸门 look-compose 断言。
      if (v !== undefined) (skin as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return {
    theme: {
      main: skin.main || BASE_THEME.main,
      dark: skin.dark || BASE_THEME.dark,
      glow: skin.glow || BASE_THEME.glow,
      name: skin.name,
    },
    skin,
    acc: equippedAccs(),
  };
}

/** 当前形象(渲染层与预览的总入口) */
function look(): Look { return composeLook(); }

/**
 * 商店预览:「这一件/这一套换上去之后长什么样」。
 * 单件 → 只覆写它自己那一槽;套装 → 按 parts 覆写它的全部槽。
 * 卡片缩略图与右侧实时试衣间都吃这个,于是「预览」和「成交后」不可能长得不一样。
 */
function lookOfCandidate(def: SkinDef | CosmeticDef): Look {
  if (!isCosmoDef(def)) return composeLook();      // 皮肤货架上的球拍/羽毛球/脸面:不吃形象合成
  const picks: Partial<Record<AccSlot, CosmeticDef>> = { [def.slot]: def };
  return composeLook(picks);
}

/** 判别式:穿戴件表里的东西(挂件件与本体件都算) */
function isCosmoDef(def: SkinDef | CosmeticDef): def is CosmeticDef {
  return def.kind === "part" || def.kind === "wear";
}

// 把当前装备解析成 theme / playerSkin / racketSkin 与当前技能,只挂在左队 0 号真人(「你」)身上。
// CPU 与 P2 保持阵营色 —— 敌我一眼分明,这也是现有视觉语言。
// theme 只承载三色(与 CPU 阵营色同构),发型/头饰/纹样/光环等设计字段走 playerSkin
function applyToMatch(): void {
  if (!Rules.R.players.length) return;
  const me = Rules.R.players[0];
  if (me && !me.isAI) {
    const L = look();
    me.theme = L.theme;
    me.playerSkin = L.skin;
    me.racketSkin = skinOf("racket");
    me.faceSkin = skinOf("face");
    // 挂件件(每槽最多一件,顺序按槽位表);equippedAccs 每次新数组,别共享引用
    me.acc = L.acc;
    me.skill = Skills.initSkillState(equippedSkill());
    // 双槽(2026-10-06):槽2 有货才挂,空槽清掉上一局的残留对象(应用 undefined 而不是留着)
    me.skill2 = equippedSkill2() ? Skills.initSkillState(equippedSkill2()!) : undefined;
  }
}

export const Career = {
  KINDS, profile, skinOf, skinById, owns, unlocked, linkedFace,
  familyOf, familyOfSkin, ownsFamily,
  accById, equippedAcc, equippedAccs, equipAcc, unequipAcc, buyAcc, accAt, isWear,
  isCosmoDef, look, lookOfCandidate,
  setPrice, setPriceFor, setItems, equipSet, grantSetPieces, freeCosmetics, wearsSet, shelfSets,
  expNeed, levelCoin, settle, settleDrill, claimMilestone, milestoneViews,
  claimActivity, activityViews,
  buy, equip, buyAndEquip, applyToMatch,
  equippedSkill, equippedSkill2, skillSlotsReady, isSkillUnlocked, equipSkill, unequipSkill, setTutorialDone, maxOut, sandboxed,
};
