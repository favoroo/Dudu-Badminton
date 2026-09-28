// ============================================================
// 生涯成长:赛后奖励(金币/经验)、等级、皮肤的购买与装备
// 纯逻辑层:不碰渲染。皮肤按 theme 同款链路消费——
// 玩家皮肤由 applyToMatch() 挂到「你」身上(渲染只读 p.theme/p.racketSkin),
// 羽毛球是公共道具,由 game 层渲染时取 skinOf("shuttle") 传入
// ============================================================
import { CFG } from "./config";
import { load, save } from "./utils";
import { Rules } from "./rules";
import { DrillResult } from "./drill";
import { DiffKey, SkinDef, SkinKind } from "./types";

const C = CFG;
const KEY = "profile";
const KINDS: SkinKind[] = ["player", "racket", "shuttle"];

export interface DrillRec {
  stars: number; clears: number; bestQ: number; bestReps: number; attempts: number;
}

export interface Profile {
  level: number;
  exp: number;
  coins: number;
  owned: string[];
  equipped: Record<SkinKind, string>;
  streak: number;
  bestStreak: number;
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

const fresh = (): Profile => ({
  level: 1, exp: 0, coins: C.career.startCoins,
  owned: KINDS.map((k) => DEFAULTS[k].id),
  equipped: { player: DEFAULTS.player.id, racket: DEFAULTS.racket.id, shuttle: DEFAULTS.shuttle.id },
  streak: 0, bestStreak: 0,
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
  // 旧档缺新字段就地补齐,以后加字段不用写迁移
  const ref = fresh();
  for (const k of Object.keys(ref) as (keyof Profile)[]) {
    if (!(k in cache)) (cache as unknown as Record<string, unknown>)[k] = ref[k];
  }
  if (!cache.stats || typeof cache.stats !== "object") cache.stats = fresh().stats;
  for (const sk of Object.keys(ref.stats) as (keyof Profile["stats"])[]) {
    if (!(sk in cache.stats)) cache.stats[sk] = ref.stats[sk];
  }
  // 首次自动合流散落的旧 wins / matches 记录
  const legacyWins = load<number>("wins", 0);
  const legacyMatches = load<number>("matches", 0);
  if (cache.stats.wins < legacyWins) cache.stats.wins = legacyWins;
  if (cache.stats.matches < legacyMatches) cache.stats.matches = legacyMatches;
  return cache;
}

function saveProfile(): void { save(KEY, cache); }

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
const unlocked = (s: SkinDef): boolean => !s.unlockLevel || profile().level >= s.unlockLevel;

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
}

// ---------- 赛后结算:发奖励 + 升级,返回明细给 UI 展示 ----------
// 2p 同屏没有 CPU,属友谊赛:不发奖励、连胜清零(防两人互相刷币)
function settle({ mode, diff, won, stats, longestRally }: {
  mode: string; diff: DiffKey; won: boolean; stats?: MatchStats; longestRally?: number;
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

  if (mode === "2p") { p.streak = 0; saveProfile(); return null; }

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
  const baseCoin = Math.round((won ? R0.win : R0.lose) * mul);
  const coin = Math.round((baseCoin + perf) * (1 + streakBonus));
  const exp = Math.round((won ? R0.expWin : R0.expLose) * mul);

  p.streak = won ? p.streak + 1 : 0;
  p.bestStreak = Math.max(p.bestStreak, p.streak);

  const levelUps = addExp(p, exp);
  p.coins += coin;
  saveProfile();

  return {
    coin, exp, perf, baseCoin, streakBonus,
    streak: p.streak, levelUps,
    unlocked: skinsUnlockedAt(levelUps),
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

  p.coins += coin;
  saveProfile();

  return {
    coin, exp, perf: 0, baseCoin: coin, streakBonus: 0,
    streak: p.streak, levelUps, first,
    unlocked: first ? skinsUnlockedAt(levelUps) : [],
  };
}

// 升级踩到解锁门槛、且还没拥有的皮肤 → 结算屏「商店上新」提示
function skinsUnlockedAt(levels: number[]): SkinDef[] {
  if (!levels.length) return [];
  return KINDS
    .flatMap((k) => C.skins[k])
    .filter((s) => {
      const ul = s.unlockLevel;
      return !!ul && levels.some((lv) => lv >= ul) && !owns(s.id);
    });
}

export interface BuyResult { ok: boolean; reason?: string }

// ---------- 商店 ----------
function buy(id: string): BuyResult {
  const s = skinById(id);
  if (!s) return { ok: false, reason: "没有这件商品" };
  if (owns(id)) return { ok: false, reason: "已经拥有" };
  if (!unlocked(s)) return { ok: false, reason: `Lv.${s.unlockLevel ?? "?"} 解锁` };
  const p = profile();
  if (p.coins < s.price) return { ok: false, reason: "金币不足" };
  p.coins -= s.price;
  p.owned.push(id);
  saveProfile();
  return { ok: true };
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

// 把当前装备解析成 theme / racketSkin,只挂在左队 0 号真人(「你」)身上。
// CPU 与 P2 保持阵营色 —— 敌我一眼分明,这也是现有视觉语言
function applyToMatch(): void {
  if (!Rules.R.players.length) return;
  const me = Rules.R.players[0];
  if (me && !me.isAI) {
    const ps = skinOf("player");
    me.theme = { main: ps.main || "#ff4d4d", dark: ps.dark || "#a8202c", glow: ps.glow || "#ff8a6a", name: ps.name };
    me.racketSkin = skinOf("racket");
  }
}

export const Career = {
  KINDS, profile, skinOf, skinById, owns, unlocked,
  expNeed, levelCoin, settle, settleDrill, buy, equip, buyAndEquip, applyToMatch,
};
