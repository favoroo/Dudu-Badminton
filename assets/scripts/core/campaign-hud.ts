// ============================================================
// 关卡目标的「说法」与「实时进度」—— 判据即文案,一处真话
// 零 Cocos 依赖:简报(ui/brief-layout)、场内 HUD(ui/hud)、结算(ui/settle-panel)
// 三处都从这里取字与取数,谁都不许再手抄一份。
//
// 为什么要单独开这个文件:
//   1) 从前每关手写三条 starsGoal 中文字符串,而判星吃的是另一份 starsCheck ——
//      两边靠人维护对齐。改判据不改文案,简报就在骗人(第 13 关「触发激光加速球」
//      判据此前在渲染层根本没有读者,说的话和判的事已经是两套)。
//   2) 更要命的是**场内有四条判据根本没得看**:20 关 60 条目标,HUD 一条读数都没有,
//      玩家只知道「TO 7」。同门的训练场却有实时行(drill.ts 的 goalText),
//      所以"目标差多少"这件事闯关玩家必须自己记 —— 没人会记。
//   3) 判星此前还整块包在 `if (winner === "left")` 里(rules.ts),打输了连
//      "过了几条、差第 3 条多少"都看不到 —— 那就不是反馈,是审判。
//
// 于是这里只留三样东西:判据 k → 一句话 + 一个紧凑标签;判据 → 进度(cur/need/atMost);
// 组合成 objectiveLines/objectiveHeadline。**求值仍然只有 campaign.ts 的 checkStarCond 一处**
// (ok 由它判,这里只做"给人看的那半边"),免得判与说再次分家。
// ============================================================
import { CFG } from "./config";
import { checkStarCond, StageDef, StageModifiers, StarCond, StarFacts } from "./campaign";
import { SkillId } from "./types";

/** 一条判据的两套说法 + 进度口径 */
interface StarCopy {
  /** 完整一句:战前简报与结算页用(要能独立读懂,不依赖上下文) */
  goal: (c: StarCond) => string;
  /** 紧凑标签:场内 HUD 用,960×540 一行放不下长句 */
  label: string;
  /**
   * 进度取数:cur 是"现在到哪",need 是门槛。
   * atMost=true 时 cur 越小越好(失分/空挥/发球失误…),HUD 印「cur ≤need」;
   * false 时 cur 越大越好(次数/拍数/占比…),HUD 印「cur/need」。
   * 返回 null = 这条**中途判不了**(见 ObjectiveLine.live)。
   */
  prog: (c: StarCond, f: StarFacts) => { cur: number; need: number; atMost: boolean } | null;
  /** 中途能不能给出有意义的读数;缺省 true */
  live?: (c: StarCond, f: StarFacts) => boolean;
}

/** 「至少 n 次」家族:计数够不够 */
const atLeast = (pick: (f: StarFacts) => number) =>
  (c: StarCond, f: StarFacts) => ({ cur: pick(f), need: (c as { n: number }).n, atMost: false });
/** 「不超过 n 次」家族:越少越好 */
const atMost = (pick: (f: StarFacts) => number) =>
  (c: StarCond, f: StarFacts) => ({ cur: pick(f), need: (c as { n: number }).n, atMost: true });

export const STAR_COPY: Record<StarCond["k"], StarCopy> = {
  win: {
    goal: () => "赢得对局",
    label: "取胜",
    prog: (_c, f) => ({ cur: f.won ? 1 : 0, need: 1, atMost: false }),
    // 局中 won 恒 false(没打完没人赢),读数没意义:星标着但不许刷成「0/1」那种丧气话
    live: () => false,
  },
  netLead: {
    goal: (c) => `净胜对手 ${(c as { n: number }).n} 分以上`,
    label: "净胜",
    prog: (c, f) => ({ cur: Math.max(0, f.myScore - f.opScore), need: (c as { n: number }).n, atMost: false }),
  },
  opScoreAtMost: {
    goal: (c) => `失分不超过 ${(c as { n: number }).n} 分`,
    label: "失分",
    prog: atMost((f) => f.opScore),
  },
  shutout: {
    goal: () => "零封对手（一分不失）",
    label: "零封",
    prog: (_c, f) => ({ cur: f.opScore, need: 0, atMost: true }),
  },
  perfects: {
    goal: (c) => `打出至少 ${(c as { n: number }).n} 次完美击球`,
    label: "完美",
    prog: atLeast((f) => f.perfects),
  },
  sweets: {
    goal: (c) => `打出至少 ${(c as { n: number }).n} 次甜区击球`,
    label: "甜区",
    prog: atLeast((f) => f.sweets),
  },
  smashes: {
    goal: (c) => `打出至少 ${(c as { n: number }).n} 次扣杀`,
    label: "扣杀",
    prog: atLeast((f) => f.smashes),
  },
  noWhiff: {
    goal: () => "全程 0 次空挥失误",
    label: "空挥",
    prog: (_c, f) => ({ cur: f.whiffs, need: 0, atMost: true }),
  },
  whiffsAtMost: {
    goal: (c) => `空挥不超过 ${(c as { n: number }).n} 次`,
    label: "空挥",
    prog: atMost((f) => f.whiffs),
  },
  rallyAtLeast: {
    goal: (c) => `回合数达到 ${(c as { n: number }).n} 拍以上`,
    label: "长回合",
    prog: (c, f) => ({ cur: f.longestRally, need: (c as { n: number }).n, atMost: false }),
  },
  noServeFault: {
    goal: () => "无发球失误",
    label: "发球",
    prog: (_c, f) => ({ cur: f.serveFaults, need: 0, atMost: true }),
  },
  lungeSaves: {
    goal: (c) => `使用飞扑救球至少 ${(c as { n: number }).n} 次`,
    label: "飞扑",
    prog: atLeast((f) => f.lungeShots),
  },
  smashScores: {
    goal: (c) => `扣杀得分至少 ${(c as { n: number }).n} 次`,
    label: "扣杀分",
    prog: atLeast((f) => f.smashScores),
  },
  jumpSmashes: {
    goal: (c) => `打出至少 ${(c as { n: number }).n} 次高空烈焰扣杀`,
    label: "跳杀",
    prog: atLeast((f) => f.jumpSmashes),
  },
  deepShots: {
    goal: (c) => `打出至少 ${(c as { n: number }).n} 次底线深球`,
    label: "深球",
    prog: atLeast((f) => f.deepShots),
  },
  iaiStrikes: {
    goal: (c) => `触发居合一闪至少 ${(c as { n: number }).n} 次`,
    label: "居合",
    prog: atLeast((f) => f.iaiStrikes),
  },
  netIntercepts: {
    goal: (c) => `完成至少 ${(c as { n: number }).n} 次网前精准截击`,
    label: "截击",
    prog: atLeast((f) => f.netIntercepts),
  },
  airShotRatio: {
    goal: (c) => `空中击球占比超过 ${(c as { pct: number }).pct}%`,
    label: "空击占比",
    prog: (c, f) => ({
      cur: f.hits > 0 ? Math.round((f.airHits / f.hits) * 100) : 0,
      need: (c as { pct: number }).pct,
      atMost: false,
    }),
    // 拍数太少时占比是噪声(3 拍里 2 拍空中 = 67%),要等样本够才判得准 ——
    // 阈值与求值同源:CFG.star.airMinHits,和 checkStarCond 用的是同一个数
    live: (_c, f) => f.hits >= CFG.star.airMinHits,
  },
  skillCasts: {
    goal: (c) => `在一局内释放技能至少 ${(c as { n: number }).n} 次`,
    label: "技能",
    prog: atLeast((f) => f.skillCasts),
  },
  noZonePenalty: {
    goal: () => "未触发任何禁区惩罚",
    label: "禁区",
    prog: (_c, f) => ({ cur: f.zonePenalties, need: 0, atMost: true }),
  },
  empReturns: {
    goal: (c) => `在 EMP 故障期间成功回球 ${(c as { n: number }).n} 次`,
    label: "故障回球",
    prog: atLeast((f) => f.empReturns),
  },
  laserBoosts: {
    goal: (c) => `触发激光加速球至少 ${(c as { n: number }).n} 次`,
    label: "电浆球",
    prog: atLeast((f) => f.laserBoosts),
  },
  noExhausted: {
    goal: () => "全程体力未进入枯竭耗尽状态",
    label: "力竭",
    prog: (_c, f) => ({ cur: f.exhausted, need: 0, atMost: true }),
  },
  slidingScores: {
    goal: (c) => `在滑行状态下击球得分至少 ${(c as { n: number }).n} 次`,
    label: "滑行得分",
    prog: atLeast((f) => f.slidingScores),
  },
  lastSmash: {
    goal: () => "最后一球以扣杀得分",
    label: "绝杀扣杀",
    prog: (_c, f) => ({ cur: f.lastSmash ? 1 : 0, need: 1, atMost: false }),
    // 只有终局那一分落下才成立;中途的 lastSmash 是"上一分"的事,拿来报会骗人
    live: () => false,
  },
};

/** 一条目标的完整读数(简报 / HUD / 结算三处共用) */
export interface ObjectiveLine {
  idx: number;                    // 0..2 → ★1..★3
  cond: StarCond;
  /** 完整一句 */
  goal: string;
  /** 紧凑标签 */
  label: string;
  /** 现在到哪(atMost 家族 = 越少越好的那个计数) */
  cur: number;
  /** 门槛 */
  need: number;
  atMost: boolean;
  /** 是否已达 —— 一律由 checkStarCond 判,这里不另算一套 */
  ok: boolean;
  /** false = 中途给不出有意义的读数(HUD 只星标不报数,免得像在骗人) */
  live: boolean;
}

/** 单条判据 → 读数。ok 走 checkStarCond(唯一求值处),cur/need 走 STAR_COPY.prog */
export function objectiveLine(cond: StarCond, idx: number, f: StarFacts): ObjectiveLine {
  const copy = STAR_COPY[cond.k];
  // 表外判据(有人加了 k 没配措辞):给一条"看得见是坏的"读数,而不是抛异常
  if (!copy) {
    return { idx, cond, goal: `〔判据 ${cond.k} 未配措辞〕`, label: cond.k, cur: 0, need: 0, atMost: false, ok: checkStarCond(cond, f), live: false };
  }
  const p = copy.prog(cond, f);
  const live = p !== null && (copy.live ? copy.live(cond, f) : true);
  return {
    idx,
    cond,
    goal: copy.goal(cond),
    label: copy.label,
    cur: p ? p.cur : 0,
    need: p ? p.need : 0,
    atMost: p ? p.atMost : false,
    ok: checkStarCond(cond, f),
    live,
  };
}

/** 这一关的三条目标(缺 starsCheck 的老数据给空表,调用方按长度排布) */
export function objectiveLines(stage: StageDef | null | undefined, f: StarFacts): ObjectiveLine[] {
  if (!stage || !stage.starsCheck || stage.starsCheck.length !== 3) return [];
  return stage.starsCheck.map((c, i) => objectiveLine(c, i, f));
}

/**
 * HUD 一条里的读数小段:统一成「标签 现在/门槛」。
 *   atLeast 家族(次数/拍数)达标后钳到门槛 ——「飞扑 3/3」比「飞扑 5/3」好读,
 *     超额不是玩家要盯的量(那颗星已经到手)。
 *   atMost 家族(失分/空挥/发球失误)门槛就是上限 ——「失分 1/2」= 现在丢 1 分、最多丢 2 分。
 *   占比类两边都带 %。判不了的终局条(win / lastSmash)只留标签,不假装有进度。
 */
export function progressText(l: ObjectiveLine): string {
  if (!l.live) return l.label;
  if (l.cond.k === "airShotRatio") return `${l.label} ${l.cur}%/${l.need}%`;
  const cur = l.atMost ? l.cur : Math.min(l.cur, l.need);
  return `${l.label} ${cur}/${l.need}`;
}

/**
 * 场内 HUD 那一行:星标 + 三条进度,达成几条就亮几颗。
 * 形状照训练场那条线(drill.ts goalText)—— 同一套读法,玩家在两边都不用重新学。
 * 不用 emoji(原生没有彩色 emoji 字体,🎯 只会变方框)。
 */
export function objectiveHeadline(stage: StageDef | null | undefined, f: StarFacts): string {
  const lines = objectiveLines(stage, f);
  if (!lines.length) return "";
  const stars = lines.map((l) => (l.ok ? "★" : "☆")).join("");
  return `${stars} ${lines.map(progressText).join(" · ")}`;
}

/** 结算页要的逐条 ✓/✗:文案 + 本局数值(输赢都要给,见 rules.ts 的判星移出) */
export interface ObjectiveResult {
  goal: string;
  ok: boolean;
  /** 人话版数值:「净胜 1/2」「失分 3 ≤2」—— 让玩家知道差在哪,不是只看到一颗灰星 */
  detail: string;
}

export function objectiveResults(stage: StageDef | null | undefined, f: StarFacts): ObjectiveResult[] {
  return objectiveLines(stage, f).map((l) => ({ goal: l.goal, ok: l.ok, detail: progressText(l) }));
}

/**
 * 战前简报的三条目标文案。
 * 作者覆写(StageDef.starsGoal)优先 —— 那是这一关想说的话(如第 20 关 ★1 要说
 * 「连拿 2 分绝杀夺冠」而不是通用的「赢得对局」);没覆写就由判据生成。
 */
export function starGoalLines(stage: StageDef | null | undefined): string[] {
  if (!stage) return [];
  // 未知 k 不许把简报排版整个撞崩 —— 闸门要的是「报出一条问题」,不是拿到一个 TypeError。
  // 真机上一崩就是弹窗开不出来、整关点不动,而判据表加了一行忘了配措辞恰好是最常见的手滑。
  const derived = (stage.starsCheck ?? []).map((c) => (STAR_COPY[c.k] ? STAR_COPY[c.k].goal(c) : `〔判据 ${c.k} 未配措辞〕`));
  if (!stage.starsGoal || stage.starsGoal.length !== derived.length) return derived;
  return stage.starsGoal.map((s, i) => (s && s.trim() ? s : derived[i]));
}

/** 判据带的数字(没有参数就返回 null):netLead.n / airShotRatio.pct / … */
function condNumber(c: StarCond): number | null {
  if ("n" in c) return c.n;
  if ("pct" in c) return c.pct;
  return null;
}

/** 句子里出现的所有整数(「净胜对手 2 分以上」→ [2];多位数不误拆成 1 和 0) */
export function numbersIn(text: string): number[] {
  const m = text.match(/\d+/g);
  return m ? m.map((s) => parseInt(s, 10)) : [];
}

/**
 * 覆写文案与判据**是否说的同一件事** —— 只核数字,不核措辞。
 *
 * 为什么不吃"文本必须等于生成文本":那会把作者故意的改写(第 20 关 ★1)全判成错,
 * 而闸门一红人就学会忽略闸门。真正的坏是「判据改了、文案没改」:
 * 把失分门槛从 1 放松到 2,简报却还印「不超过 1 分」,玩家按错的承诺决定要不要挑战。
 * 所以规则是:**覆写里只要出现整数,判据的那个数字必须在其中**;
 * 不写数字(纯 flavor:「一分不失」)就放行。
 */
export function goalOverrideMismatch(stage: StageDef): number[] {
  if (!stage.starsGoal) return [];
  const bad: number[] = [];
  for (let i = 0; i < stage.starsCheck.length; i++) {
    const c = stage.starsCheck[i];
    const need = condNumber(c);
    if (need === null) continue;
    const text = stage.starsGoal[i];
    if (!text || !text.trim()) { bad.push(i); continue; }
    const nums = numbersIn(text);
    if (nums.length && !nums.includes(need)) bad.push(i);
  }
  return bad;
}

// ============================================================
// 关卡机制的「人话读数」:战前简报标签 + 场内读数,同一个来源
//
// 为什么也放这儿:关卡 modifiers 是一张布尔/倍率表,而玩家看到的应该是
// 「这一关改了什么、改了多少」。从前这件事只有 desc 散文在说(手写在关卡表里),
// 场内没有任何一处把「移速 70%」这类事实报出来 —— 第 2 关就是典型:腿被砍到 0.7,
// 画面还是第 1 关那片海滩,玩家读出的是"角色今天很慢",不是"这关是流沙"。
// 数值一律从 CFG 与关卡表读,这里只做翻译,不加系数(系数是关卡设计,进 campaign.ts)。
// ============================================================

/** 机制键 → 短标签(≤6 字,简报排一行胶囊) */
const MECH_TAG: Record<string, string> = {
  wind: "侧风变向",
  gravity: "低重力",
  drag: "高阻沙尘",
  erratic: "飘忽球",
  laserRail: "贴网电浆",
  heavy: "沙地陷脚",
  jump: "弹跳增强",
  slide: "冰面滑行",
  reach: "扑救扩大",
  overclock: "技能超频",
  stamina: "体力博弈",
  forbidNet: "网前禁区",
  iai: "居合时机",
  zen: "心流子弹",
  sandstorm: "黄沙遮蔽",
  fog: "网前迷雾",
  sun: "高空盲区",
  emp: "断网闪烁",
  decoy: "真假双球",
  flash: "镁光眩晕",
  sakura: "落樱狂风",
};

/**
 * 这一关开了哪些机制 → 短标签表(顺序固定:物理 → 玩家 → 环境)。
 * 判据是"关卡表里声明了什么",不是散文 —— 改了 modifiers 简报自动跟着变,
 * 不会出现「文案写了狂风、判据里根本没风」这种脱节。
 */
export function stageMechTags(mods: StageModifiers | undefined): string[] {
  if (!mods) return [];
  const out: string[] = [];
  const p = mods.physics;
  if (p?.windX) out.push(MECH_TAG.wind);
  if (p?.gravityMul !== undefined && p.gravityMul !== 1) out.push(MECH_TAG.gravity);
  if (p?.dragMul !== undefined && p.dragMul !== 1) out.push(MECH_TAG.drag);
  if (p?.erratic) out.push(MECH_TAG.erratic);
  if (p?.laserRail) out.push(MECH_TAG.laserRail);
  const pl = mods.player;
  // 「移速受限」与「弹跳增强」是两回事,分开判:第 2 关同时砍 accel/vmax 又砍 jump,
  // 而第 5 关只加 jump —— 混成一个标签就会在简报里说错话
  if (pl && ((pl.accelMul ?? 1) < 1 || (pl.vmaxMul ?? 1) < 1)) out.push(MECH_TAG.heavy);
  if (pl?.jumpMul !== undefined && pl.jumpMul !== 1) out.push(MECH_TAG.jump);
  if (pl?.frictionMul !== undefined && pl.frictionMul < 1) out.push(MECH_TAG.slide);
  if (pl?.reachMul !== undefined && pl.reachMul > 1) out.push(MECH_TAG.reach);
  if (pl?.cooldownMul !== undefined && pl.cooldownMul < 1) out.push(MECH_TAG.overclock);
  if (pl?.staminaSystem) out.push(MECH_TAG.stamina);
  if (pl?.forbiddenNetZone) out.push(MECH_TAG.forbidNet);
  if (pl?.iaiStrike) out.push(MECH_TAG.iai);
  if (pl?.zenFocus) out.push(MECH_TAG.zen);
  const e = mods.environment;
  if (e?.sandstorm) out.push(MECH_TAG.sandstorm);
  if (e?.fog) out.push(MECH_TAG.fog);
  if (e?.blindingSun) out.push(MECH_TAG.sun);
  if (e?.empGlitch) out.push(MECH_TAG.emp);
  if (e?.hologramDecoy) out.push(MECH_TAG.decoy);
  if (e?.spectatorFlash) out.push(MECH_TAG.flash);
  if (e?.sakuraFlurry) out.push(MECH_TAG.sakura);
  return out;
}

/**
 * 玩家自己被改了什么 —— 场内读数与简报共用的一行「事实」。
 * 只报倍率类(腿速/跳/滑/扑救/冷却),环境类机制由画面与目标条说话。
 * 第 2 关没有这一行,玩家永远只能猜"是不是我手机卡了" —— 那是最贵的误解。
 */
export function playerModReadout(mods: StageModifiers | undefined): string {
  const pl = mods?.player;
  if (!pl) return "";
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const bits: string[] = [];
  const speed = Math.min(pl.accelMul ?? 1, pl.vmaxMul ?? 1);
  if (speed !== 1) bits.push(`移速 ${pct(speed)}`);
  if (pl.jumpMul !== undefined && pl.jumpMul !== 1) bits.push(`起跳 ${pct(pl.jumpMul)}`);
  if (pl.frictionMul !== undefined && pl.frictionMul !== 1) bits.push(`摩擦 ${pct(pl.frictionMul)}`);
  if (pl.reachMul !== undefined && pl.reachMul !== 1) bits.push(`判定 ${pct(pl.reachMul)}`);
  if (pl.cooldownMul !== undefined && pl.cooldownMul !== 1) bits.push(`冷却 ${pct(pl.cooldownMul)}`);
  return bits.join(" · ");
}

/** 物理环境的同类读数(重力/阻尼/风力幅度) */
export function physicsModReadout(mods: StageModifiers | undefined): string {
  const p = mods?.physics;
  if (!p) return "";
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const bits: string[] = [];
  if (p.gravityMul !== undefined && p.gravityMul !== 1) {
    bits.push(`重力 ${pct(p.gravityMul)}`);
    // 滞空倍率 = 1/√重力倍率(自由落体时间随 √(1/g) 走):低重力关真正要玩家适应的是
    // "球在空中多待一半时间",不是"重力 52%"这个物理课数字。第 5/14 关那种浮空感
    // 从前只有散文在描述,读数上一个字都没有。
    bits.push(`滞空 ×${(1 / Math.sqrt(p.gravityMul)).toFixed(2)}`);
  }
  if (p.dragMul !== undefined && p.dragMul !== 1) bits.push(`阻力 ${pct(p.dragMul)}`);
  if (p.windX) bits.push(`风 ±${pct(p.windX / CFG.env.windFullScale)}`);
  return bits.join(" · ");
}

/** 对手这一关带的技能:简报要写出来(第 5/10/14/15/20 关有 aiSkill,从前从不告诉玩家) */
export function skillLabel(id: SkillId | null | undefined): string {
  if (!id) return "";
  const s = CFG.skills.list.find((x) => x.id === id);
  return s ? s.name : String(id);
}


