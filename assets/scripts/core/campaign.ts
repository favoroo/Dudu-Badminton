// ============================================================
// 闯关挑战模式核心系统 (Campaign Challenge Mode)
// 零 Cocos 依赖，纯 TypeScript 驱动，严格遵守 core/ 分层铁律。
// 汇集四大场景（海滩、道场、赛博、黄昏馆）共 20 关特色创意挑战。
// ============================================================
import { CFG } from "./config";
import { clamp, load, save } from "./utils";
import { AiDelta, AiTier, DiffKey, SkillId } from "./types";

export type CourtTheme = "beach" | "dojo" | "cyber" | "arena";

export interface StageModifiers {
  physics?: {
    windX?: number;            // 恒定或基准横向风力 (px/step^2)
    windOscillate?: boolean;    // 是否周期性正弦震荡变向
    gravityMul?: number;       // 重力加速度缩放 (如 0.5=低重力)
    dragMul?: number;          // 空气阻力缩放 (如 1.35=沙尘阻尼)
    erratic?: boolean;         // 破损羽毛球颤抖漂移
    laserRail?: boolean;       // 球网顶端擦网激光充能超音速
  };
  player?: {
    accelMul?: number;         // 跑动加速度倍率
    vmaxMul?: number;          // 极速倍率
    jumpMul?: number;          // 起跳高度倍率
    frictionMul?: number;      // 地面摩擦系数倍率 (0.25=极滑溜冰)
    reachMul?: number;         // 击球与扑救判定区倍率 (如 1.6=沙地鱼跃)
    cooldownMul?: number;      // 技能冷却缩放 (如 0.25=超频)
    staminaSystem?: boolean;   // 是否开启体力限制槽
    forbiddenNetZone?: number; // 网前禁足区宽度 (px)
    iaiStrike?: boolean;       // 居合拔刀极限反抽机制
    zenFocus?: boolean;        // 心流连续好球触发子弹时间
  };
  environment?: {
    sandstorm?: boolean;       // 热带沙尘暴风沙与迷茫遮蔽
    fog?: boolean;             // 网前水墨白雾
    blindingSun?: boolean;     // 高空烈日致盲盲区
    empGlitch?: boolean;       // CRT 屏幕故障噪点与闪烁断网
    hologramDecoy?: boolean;   // 全息双生虚影球
    spectatorFlash?: boolean;  // 看台闪光灯强光眩晕
    sakuraFlurry?: boolean;    // 漫天落樱狂风
  };
}

export interface StageDef {
  id: string;
  stageNo: number;             // 1..20
  chapter: number;             // 1..4
  chapterName: string;
  court: CourtTheme;
  title: string;
  subtitle: string;
  badge: string;               // 核心特色标签
  desc: string;                // 关卡情境与挑战
  hint: string;                // 过关建议
  targetScore: number;         // 胜利所需得分
  isMatchPointStart?: boolean; // 是否从赛点 10:10 开始
  deathmatch?: boolean;        // 丢 1 分立即失败
  aiDiff: DiffKey;
  /**
   * 这一关对难度档的**局部微调(增量,不是绝对值)**。
   * 为什么要它:三档是给"对练模式"设计的,而关卡机制对玩家和对 AI 的惩罚并不对称 ——
   * 迷雾/烈日/闪光灯这类遮蔽机制只难为人眼,AI 是按重模拟的球路跑位的(它"看得见"),
   * 于是这些关的实际难度全压在玩家一个人身上。给 AI 钝一点,让"这关残酷"只付一次。
   * 没有这一层就只能加第四档 —— 而三档 + 逐关微调比二十个自定义档好懂得多。
   * **通常不用手写这一行**:缺省时由 aiReliefFor() 按 config.campaign.aiRelief 自动算,
   * 这里只留给"机制表说不准"的特例。
   */
  aiTune?: AiDelta;
  aiSkill?: SkillId;
  modifiers: StageModifiers;
  rewards: {
    coins: number;
    exp: number;
  };
  /**
   * 三星判据:判星的唯一真话,也**是**简报/HUD/结算三处文案的唯一来源
   * (措辞在 core/campaign-hud.ts 的 STAR_COPY,别再手抄一份)。
   */
  starsCheck: [StarCond, StarCond, StarCond];
  /**
   * 作者覆写:仅当这一关想说的话与 STAR_COPY 的通用措辞不同才写
   * (如第 20 关的 ★1 要说「连拿 2 分绝杀夺冠」而不是「赢得对局」)。
   * 写了就必须与 starsCheck 三条一一对应 —— campaign-check 逐条比对,对不上就红。
   */
  starsGoal?: [string, string, string];
}

export interface StageRec {
  stars: number;               // 0..3 星
  clears: number;              // 通关次数
  bestScore: string;           // 如 "3-1"
  attempts: number;
}

// ---------- 三星判据:结构化判据 + 判据即文案 ----------
//
// 从前判星写死三条通用规则(rules.ts:胜 / 净胜2 / 零封或长回合≥8),战前简报展示的
// starsGoal 文案(「无发球失误」「飞扑救球 3 次」…)只是装饰,从未被真的判定过。
// 现在每关配一份 starsCheck,判星 = 逐条求值。
//
// 文案也不再手抄:同一条判据要同时出现在战前简报、场内进度条、结算页三处,
// 从前靠 20 份手写字符串撑着,改判据就得记得改文案(没人记得)。现在措辞只住在
// core/campaign-hud.ts 的 STAR_COPY 模板里,由 starsCheck 生成 —— 判据动了文案自动跟着动,
// campaign-check 还把「作者覆写」逐条对回去,防止某一关说的话与判的事脱节。
// 加新判据:这里加一个 k 分支 + rules.ts 的 starFacts() 补对应计数 +
// campaign-hud.ts 的 STAR_COPY/condProgress 补一条 + campaign-check 里补正反例。

/** 一条可判定的三星条件(判别联合,k = 判据名) */
export type StarCond =
  | { k: "win" }                          // 赢得对局
  | { k: "netLead"; n: number }           // 净胜对手 ≥ n 分
  | { k: "opScoreAtMost"; n: number }     // 失分不超过 n 分
  | { k: "shutout" }                      // 零封:对手 0 分(零失误零丢分)
  | { k: "perfects"; n: number }          // 完美击球 ≥ n 次
  | { k: "sweets"; n: number }            // 甜区击球 ≥ n 次
  | { k: "smashes"; n: number }           // 扣杀(出手) ≥ n 次
  | { k: "noWhiff" }                      // 全程 0 次空挥(含「未被假球欺骗」)
  /** 空挥**容许** n 次:第 12 关那种「真假球」要求一次都不挥空,把玩家自己手滑也算进
   *  机制惩罚里 —— 判据想量的是"被骗",不是"手滑"。atMost 家族,进度可中途显示。 */
  | { k: "whiffsAtMost"; n: number }
  | { k: "rallyAtLeast"; n: number }      // 完成一记 ≥ n 拍的回合
  | { k: "noServeFault" }                 // 无发球失误
  | { k: "lungeSaves"; n: number }        // 飞扑救球 ≥ n 次
  | { k: "smashScores"; n: number }       // 扣杀直接得分 ≥ n 次
  | { k: "jumpSmashes"; n: number }       // 高空烈焰扣杀(跳杀) ≥ n 次
  | { k: "deepShots"; n: number }         // 底线深球 ≥ n 次
  | { k: "iaiStrikes"; n: number }        // 居合一闪 ≥ n 次
  | { k: "netIntercepts"; n: number }     // 网前精准截击 ≥ n 次
  | { k: "airShotRatio"; pct: number }    // 空中击球占比超过 pct%
  | { k: "skillCasts"; n: number }        // 释放技能 ≥ n 次
  | { k: "noZonePenalty" }                // 未触发禁区惩罚
  | { k: "empReturns"; n: number }        // EMP 故障期间成功回球 ≥ n 次
  | { k: "laserBoosts"; n: number }       // 触发激光加速球 ≥ n 次
  | { k: "noExhausted" }                  // 全程体力未枯竭
  | { k: "slidingScores"; n: number }     // 滑行中击球得分 ≥ n 次
  | { k: "lastSmash" };                   // 最后一球以扣杀得分

/** 判星用的逐局事实(全部来自 rules 的真实统计,见 rules.starFacts) */
export interface StarFacts {
  won: boolean;
  myScore: number;
  opScore: number;
  longestRally: number;
  hits: number; smashes: number; sweets: number; perfects: number; whiffs: number;
  lungeShots: number; jumpSmashes: number; iaiStrikes: number; skillCasts: number;
  deepShots: number; netIntercepts: number; airHits: number; empReturns: number;
  zonePenalties: number; exhausted: number;
  serveFaults: number; smashScores: number; slidingScores: number; laserBoosts: number;
  /** 最后一分的得分原因是否为左队(玩家)的扣杀得分 */
  lastSmash: boolean;
}

/** 单条判据求值(纯函数,campaign-check 直接喂数据回归) */
export function checkStarCond(c: StarCond, f: StarFacts): boolean {
  switch (c.k) {
    case "win": return f.won;
    case "netLead": return f.myScore - f.opScore >= c.n;
    case "opScoreAtMost": return f.opScore <= c.n;
    case "shutout": return f.opScore === 0;
    case "perfects": return f.perfects >= c.n;
    case "sweets": return f.sweets >= c.n;
    case "smashes": return f.smashes >= c.n;
    case "noWhiff": return f.whiffs === 0;
    case "whiffsAtMost": return f.whiffs <= c.n;
    case "rallyAtLeast": return f.longestRally >= c.n;
    case "noServeFault": return f.serveFaults === 0;
    case "lungeSaves": return f.lungeShots >= c.n;
    case "smashScores": return f.smashScores >= c.n;
    case "jumpSmashes": return f.jumpSmashes >= c.n;
    case "deepShots": return f.deepShots >= c.n;
    case "iaiStrikes": return f.iaiStrikes >= c.n;
    case "netIntercepts": return f.netIntercepts >= c.n;
    case "airShotRatio": return f.hits >= CFG.star.airMinHits && (f.hits > 0 ? (f.airHits / f.hits) * 100 : 0) > c.pct;
    case "skillCasts": return f.skillCasts >= c.n;
    case "noZonePenalty": return f.zonePenalties === 0;
    case "empReturns": return f.empReturns >= c.n;
    case "laserBoosts": return f.laserBoosts >= c.n;
    case "noExhausted": return f.exhausted === 0;
    case "slidingScores": return f.slidingScores >= c.n;
    case "lastSmash": return f.lastSmash;
  }
}

/** 三星判星:逐条求值,通过几条给几星(0..3)。关卡缺 starsCheck 时调用方回落通用三条 */
export function evaluateStars(check: StarCond[] | undefined, f: StarFacts): number {
  if (!check || check.length !== 3) return -1;   // 让调用方走 fallback
  let n = 0;
  for (const c of check) if (checkStarCond(c, f)) n++;
  return n;
}

const STORAGE_KEY = "dudu_campaign_progress";

// ---------- 关卡机制 → AI 该钝多少(不对称减免) ----------
//
// 三条铁律里的"数值只进 config"在这里的含义:哪一关要减免、减免多少,是一张**表**
// (CFG.campaign.aiRelief),不是散在 20 个关卡条目里的 20 份手调数字。
// 为什么必须减免:AI 是用 futureInto 重模拟球路来跑位的(见 ai.ts),迷雾/烈日/闪光灯
// 这些"糊画面"的机制对它**完全不成立** —— 它看得见球,玩家看不见。于是同一档 AI
// 在遮蔽关里显得比对练模式更凶,关卡的"难"就成了"机制 + AI"两份叠在玩家一个人身上。
// 移动/体力/重力类机制不加减免:那些走 Pl.setPlayerModifier,是**双方**一起受的影响
// (0.0.21 起 AI 的自估腿速也吃这套系数,见 ai.ts 的 selfVmax),对称,不用补。

/** 累加一份增量到另一份上(同一键多次命中就叠加,由 tuneAiTier 负责夹范围) */
function addDelta(into: AiDelta, from: AiDelta | undefined): void {
  if (!from) return;
  for (const k of ["read", "shotErr", "timingErr", "aggr"] as const) {
    const v = from[k];
    if (v) into[k] = (into[k] ?? 0) + v;
  }
}

/** 这一关的机制给 AI 的减免增量(关卡写了 aiTune 就以关卡为准,不叠加) */
export function aiReliefFor(stage: StageDef): AiDelta {
  if (stage.aiTune) return stage.aiTune;
  const out: AiDelta = {};
  const R = CFG.campaign.aiRelief;
  const e = stage.modifiers.environment;
  const ph = stage.modifiers.physics;
  addDelta(out, e?.blindingSun ? R.blindingSun : undefined);
  addDelta(out, e?.sandstorm ? R.sandstorm : undefined);
  addDelta(out, e?.fog ? R.fog : undefined);
  addDelta(out, e?.empGlitch ? R.empGlitch : undefined);
  addDelta(out, e?.hologramDecoy ? R.hologramDecoy : undefined);
  addDelta(out, e?.spectatorFlash ? R.spectatorFlash : undefined);
  addDelta(out, e?.sakuraFlurry ? R.sakuraFlurry : undefined);
  addDelta(out, ph?.erratic ? R.erratic : undefined);
  return out;
}

/**
 * 把增量落到档位上,夹在合理范围内(纯函数,campaign-check 直接喂数据回归)。
 * 为什么要夹:减免是"调音"不是"改乐器" —— read 加到 200 会让 AI 变成纯靶子,
 * 而某一关同时命中两条机制(第 8 关既落樱又颤抖)叠加时很容易越界。
 */
export function tuneAiTier(tier: AiTier, d: AiDelta): AiTier {
  const c = CFG.campaign.aiReliefCap;
  return {
    ...tier,
    read: clamp(tier.read + (d.read ?? 0), c.read[0], c.read[1]),
    shotErr: clamp(tier.shotErr + (d.shotErr ?? 0), c.shotErr[0], c.shotErr[1]),
    timingErr: clamp(tier.timingErr + (d.timingErr ?? 0), c.timingErr[0], c.timingErr[1]),
    aggr: clamp(tier.aggr + (d.aggr ?? 0), c.aggr[0], c.aggr[1]),
  };
}

/**
 * 「最佳比分」到底最佳在哪 —— 从前这里是直接覆盖:
 * `prev.bestScore = \`${myScore}-${opScore}\``,于是打第 3 关 7-1 通关、再回来重打 7-6 险胜,
 * 大厅卡片(campaign-panel.ts:454 印「最佳 x-y」)显示的那条就**退步**成了 7-6。
 * 卡片说的是"最佳",存档记的是"最近",两头对不上且没人报错 —— 典型的不会崩、只是不好用。
 * 口径:先比净胜,净胜相同再比失分少(7-1 优于 7-0 之外的同分差场;7-0 恒最优)。
 * 只在**通关**时参与比较(输的比分不进这条),所以两侧都是我方得分在前。
 */
export function isBetterBestScore(my: number, op: number, prev: string): boolean {
  const parts = prev.split("-");
  const pm = parseInt(parts[0] ?? "", 10);
  const po = parseInt(parts[1] ?? "", 10);
  // 读不懂(空/错型/手改存档)一律重写:宁可丢掉一条旧纪录,也不要卡片一直印 "0-0"
  if (!Number.isFinite(pm) || !Number.isFinite(po)) return true;
  const margin = my - op;
  if (margin !== pm - po) return margin > pm - po;
  return op < po;
}

/** 20 个绝不重样、创意满满的闯关模式关卡数据表 */
export const CAMPAIGN_STAGES: StageDef[] = [
  // ==================== 第一章：阳光海滩 (Sunny Beach) ====================
  {
    id: "beach_1",
    stageNo: 1,
    chapter: 1,
    chapterName: "阳光海滩",
    court: "beach",
    title: "海风突变",
    subtitle: "SHIFTING CROSSWIND",
    badge: "狂暴阵风",
    // 文案纠偏(0.0.21):从前写「强劲侧风把球往旁边推」—— 这是侧视球场,x 就是场地纵深,
    // 风推的是**深浅**不是左右。玩家按"往旁边"去理解,会发现球既不左也不右、只是变深变浅,
    // 于是把机制读成随机惩罚。现在一句话说清"往哪边、会怎样",并点名场上那两个信号。
    desc: "海风沿着球场纵深来回吹,每几秒换一次方向:顺风把球推向对方底线(容易越线),逆风把球按回网前(容易下网)。场上的琥珀色人字纹往哪边流,球就被推向哪边。",
    hint: "起手前看一眼风向标:黄针是当前风,青针是出手那一拍的风,两针合拢时落点最可控。顺风收力、逆风发力压深。",
    targetScore: 7,
    aiDiff: "easy",
    modifiers: {
      physics: { windX: 0.18, windOscillate: true },
    },
    rewards: { coins: 150, exp: 60 },
    starsCheck: [{ k: "win" }, { k: "netLead", n: 2 }, { k: "noServeFault" }],
  },
  {
    id: "beach_2",
    stageNo: 2,
    chapter: 1,
    chapterName: "阳光海滩",
    court: "beach",
    title: "深陷流沙",
    subtitle: "DEEP SAND",
    badge: "沙地鱼跃",
    desc: "退潮后的深软流沙让双腿沉重如灌铅，但激发出沙滩排球特有的超广角飞扑扑救！",
    hint: "跑动缓慢但扑救范围极广，看准球路提前飞身扑救，享受沙花漫天的手感！",
    targetScore: 7,
    aiDiff: "easy",
    modifiers: {
      player: { accelMul: 0.62, vmaxMul: 0.7, jumpMul: 0.78, reachMul: 1.55 },
    },
    rewards: { coins: 180, exp: 70 },
    // ★3 从前是「失分不超过 1 分」:抢 7 分制里那是**近乎零封**,却排在第 2 关
    // (这一关还把玩家腿速砍到 0.7),入门第二关就打不出来 = 这条白给也白写。放到 ≤2。
    starsCheck: [{ k: "win" }, { k: "lungeSaves", n: 3 }, { k: "opScoreAtMost", n: 2 }],
  },
  {
    id: "beach_3",
    stageNo: 3,
    chapter: 1,
    chapterName: "阳光海滩",
    court: "beach",
    title: "烈日刺目",
    subtitle: "BLINDING SUN",
    badge: "盲区球影",
    desc: "正午顶光刺眼！高空中央区域被金色强光吞噬，羽毛球飞入高空时将短暂隐形！",
    hint: "在球隐形于高空烈日时，低头紧盯地面清晰的球影移动与缩放来预判落点！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      environment: { blindingSun: true },
    },
    rewards: { coins: 200, exp: 80 },
    // 完美击球要"球进完美窗 + 挥拍落在极限时机",而这一关偏偏把球在高空调进隐形盒 ——
    // 要 2 次等于要玩家在看不见球的情况下把时机掐准两回。降为 1 次(仍是这关的正题)。
    starsCheck: [{ k: "win" }, { k: "perfects", n: 1 }, { k: "netLead", n: 2 }],
  },
  {
    id: "beach_4",
    stageNo: 4,
    chapter: 1,
    chapterName: "阳光海滩",
    court: "beach",
    title: "热带沙尘暴",
    subtitle: "TROPICAL SANDSTORM",
    badge: "昏黄狂沙",
    desc: "漫天黄沙遮天蔽日，空气中高浓度的沙尘带来巨大阻力，球在飞行后程急剧坠落！",
    hint: "狂风沙阻让高远球快速坠地，紧盯羽毛球发光轨迹，多在网前抢点击杀！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      // 恒定顺风(不变向):这一关要教的是"高阻 + 顺风 = 球后程既坠又被推深",
      // 而不是第 1 关那种"读方向"。风同时喂给画面 —— 飞沙与球受推同向(见 world 的沙暴分支)。
      physics: { dragMul: 1.35, windX: 0.16 },
      environment: { sandstorm: true },
    },
    rewards: { coins: 240, exp: 95 },
    starsCheck: [{ k: "win" }, { k: "smashScores", n: 2 }, { k: "opScoreAtMost", n: 2 }],
  },
  {
    id: "beach_5",
    stageNo: 5,
    chapter: 1,
    chapterName: "阳光海滩",
    court: "beach",
    title: "热浪低重力",
    subtitle: "HEATWAVE FLOAT",
    badge: "热浪浮空",
    desc: "地表升腾的热气流消解了一半重力，双方获得超级滞空！最高制空点扣杀爆发烈焰暴击！",
    hint: "充分利用超长滞空时间在最高点蓄力暴扣，享受太空羽毛球般的二段慢动作！",
    targetScore: 7,
    aiDiff: "normal",
    aiSkill: "smash",
    modifiers: {
      physics: { gravityMul: 0.52 },
      player: { jumpMul: 1.35 },
    },
    rewards: { coins: 300, exp: 120 },
    // 抢 7 分制要求净胜 3 = 7-4 起步;这一关重力只剩 0.52,双方都在飘,净胜 2 已经够挑。
    starsCheck: [{ k: "win" }, { k: "jumpSmashes", n: 3 }, { k: "netLead", n: 2 }],
  },

  // ==================== 第二章：竹林道场 (Bamboo Dojo) ====================
  {
    id: "dojo_1",
    stageNo: 6,
    chapter: 2,
    chapterName: "竹林道场",
    court: "dojo",
    title: "晨雾隐踪",
    subtitle: "MORNING MIST",
    badge: "网前水墨雾",
    desc: "山间古刹晨雾弥漫，网前区域被厚重的水墨白雾遮蔽，球穿过网前时完全隐形！",
    hint: "看不清近网放球，尽量多拉深底线高远球，让球越过雾气再做判断！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      environment: { fog: true },
    },
    rewards: { coins: 260, exp: 100 },
    // ★3 从前是 shutout(对手**恰好** 0 分):抢 7 分制里那是"一分都不许碰到",
    // 而这一关的机制恰恰只遮网前 —— 玩家被迫多拉高远球,后场空当全暴露。改「失分≤1」。
    starsCheck: [{ k: "win" }, { k: "deepShots", n: 3 }, { k: "opScoreAtMost", n: 1 }],
  },
  {
    id: "dojo_2",
    stageNo: 7,
    chapter: 2,
    chapterName: "竹林道场",
    court: "dojo",
    title: "居合一闪",
    subtitle: "IAI STRIKE",
    badge: "拔刀反抽",
    desc: "全场球速加快 25%！在球砸入拍面的极限微秒瞬间挥拍，触发剑客居合斩击穿透球场！",
    hint: "不要过早挥拍！等球近身的完美瞬间挥击，触发刀光剑影般的极速直线反抽！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      player: { iaiStrike: true },
    },
    rewards: { coins: 300, exp: 120 },
    starsCheck: [{ k: "win" }, { k: "iaiStrikes", n: 2 }, { k: "netLead", n: 2 }],
  },
  {
    id: "dojo_3",
    stageNo: 8,
    chapter: 2,
    chapterName: "竹林道场",
    court: "dojo",
    title: "飞叶落樱",
    subtitle: "SAKURA DRIFT",
    badge: "落叶香蕉球",
    desc: "竹叶与落樱被狂风卷成气流旋涡，羽毛球在空中会发生飘忽不定的 S 型弧线漂移！",
    hint: "不要过分依赖直线落点预判，保持小碎步微调站位，防备突然变向的落叶球！",
    targetScore: 7,
    aiDiff: "hard",
    modifiers: {
      physics: { erratic: true },
      environment: { sakuraFlurry: true },
    },
    rewards: { coins: 320, exp: 130 },
    // 这条把「失分≤1」和「完成一记 8 拍长回合」押在同一局:长回合本身就意味着对手能得分,
    // 两条互相拽 —— 而这一关还是 hard + 飘忽球。失分放到 ≤2。
    starsCheck: [{ k: "win" }, { k: "opScoreAtMost", n: 2 }, { k: "rallyAtLeast", n: 8 }],
  },
  {
    id: "dojo_4",
    stageNo: 9,
    chapter: 2,
    chapterName: "竹林道场",
    court: "dojo",
    title: "心流止水",
    subtitle: "ZEN FOCUS",
    badge: "水墨子弹时间",
    desc: "摒除杂念，沉着应对。连续打出好球即可进入水墨黑白的子弹时间，乱按空挥则会破功僵直！",
    hint: "拒绝盲目连打挥拍，精准从容命中 2 拍即可进入子弹时间，轻松调动对手！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      player: { zenFocus: true },
    },
    rewards: { coins: 350, exp: 140 },
    starsCheck: [{ k: "win" }, { k: "noWhiff" }, { k: "sweets", n: 3 }],
  },
  {
    id: "dojo_5",
    stageNo: 10,
    chapter: 2,
    chapterName: "竹林道场",
    court: "dojo",
    title: "画地为牢",
    subtitle: "FORBIDDEN BOUNDS",
    badge: "网前禁足区",
    desc: "道场宗师设下八卦阵，网前区域被列为严禁踏入的红色禁区，踏入会触电硬直！",
    hint: "切忌无脑冲网！利用身体长臂极限捞球与挑后场，通过大角度调角逼老道 AI 失误！",
    targetScore: 7,
    aiDiff: "hard",
    aiSkill: "magnet",
    modifiers: {
      player: { forbiddenNetZone: 110 },
    },
    rewards: { coins: 400, exp: 160 },
    starsCheck: [{ k: "win" }, { k: "noZonePenalty" }, { k: "netLead", n: 2 }],
  },

  // ==================== 第三章：赛博街区 (Cyber Neon) ====================
  {
    id: "cyber_1",
    stageNo: 11,
    chapter: 3,
    chapterName: "赛博街区",
    court: "cyber",
    title: "电磁脉冲",
    subtitle: "EMP GLITCH",
    badge: "断网闪烁",
    desc: "地下黑客释放电磁脉冲，回合进入多拍时屏幕突发 CRT 霓虹闪烁故障，唯有球尾荧光照亮黑暗！",
    hint: "屏幕闪黑期间不要慌乱，球身带有高亮荧光轨迹，跟随发光轨迹走位击球！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      environment: { empGlitch: true },
    },
    rewards: { coins: 320, exp: 130 },
    starsCheck: [{ k: "win" }, { k: "empReturns", n: 2 }, { k: "netLead", n: 2 }],
  },
  {
    id: "cyber_2",
    stageNo: 12,
    chapter: 3,
    chapterName: "赛博街区",
    court: "cyber",
    title: "全息双生",
    subtitle: "HOLOGRAM DECOY",
    badge: "真假双球",
    desc: "对手球拍加载了全息欺骗模组，每次击球同时分叉出 1 颗真球与 1 颗紫色全息假球！",
    hint: "假球飞跃网后会数码碎裂，真球具有重力弧线与发光尾羽，在 0.3 秒内辨明真假！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      environment: { hologramDecoy: true },
    },
    rewards: { coins: 350, exp: 140 },
    // 这条想量的是"有没有被骗",用 noWhiff 却把玩家自己手滑也算成被骗(一次都不许空挥)。
    // 换成 whiffsAtMost 1:被骗到挥空可以给一次机会,自己的小失误不没收这颗星。
    starsCheck: [{ k: "win" }, { k: "whiffsAtMost", n: 1 }, { k: "opScoreAtMost", n: 1 }],
  },
  {
    id: "cyber_3",
    stageNo: 13,
    chapter: 3,
    chapterName: "赛博街区",
    court: "cyber",
    title: "激光加速轨",
    subtitle: "LASER GRID RAIL",
    badge: "贴网电浆球",
    desc: "球网顶端配备高能聚能磁轨，掠过网顶 50px 的近网球瞬间吸收电离能量，化作 1.75 倍速电浆激光重炮！",
    hint: "全力争夺近网掠空权！多打贴网短球触发激光加速轨，瞬间电浆爆射对手底线！",
    targetScore: 7,
    aiDiff: "hard",
    modifiers: {
      physics: { laserRail: true },
    },
    rewards: { coins: 380, exp: 150 },
    starsCheck: [{ k: "win" }, { k: "laserBoosts", n: 2 }, { k: "smashScores", n: 2 }],
  },
  {
    id: "cyber_4",
    stageNo: 14,
    chapter: 3,
    chapterName: "赛博街区",
    court: "cyber",
    title: "反重力力场",
    subtitle: "ZERO-G CHAMBER",
    badge: "太空漫步",
    desc: "球场反重力发生器开启！重力暴降至 20%，起跳高度暴增 2.2 倍，展开三维空战！",
    hint: "体验高空飞仙般的滞空漫步，在半空中连续二段起跳与凌空拦截！",
    targetScore: 7,
    aiDiff: "hard",
    aiSkill: "flash",
    modifiers: {
      physics: { gravityMul: 0.22, dragMul: 1.2 },
      player: { jumpMul: 2.1 },
    },
    rewards: { coins: 420, exp: 170 },
    starsCheck: [{ k: "win" }, { k: "airShotRatio", pct: 70 }, { k: "netLead", n: 2 }],
  },
  {
    id: "cyber_5",
    stageNo: 15,
    chapter: 3,
    chapterName: "赛博街区",
    court: "cyber",
    title: "超频神仙斗",
    subtitle: "OVERCLOCKED CHAOS",
    badge: "无限特技流",
    desc: "所有硬件解除安全限制，双方所有特技冷却缩短至 1.2 秒！瞬移扣杀、引力吸球、子弹时间无限狂轰！",
    hint: "神仙打架，不要省技能！技能键冷却好了就放，瞬移扣杀与引力吸球连环轰炸！",
    targetScore: 7,
    aiDiff: "hard",
    aiSkill: "flash",
    modifiers: {
      player: { cooldownMul: 0.22 },
    },
    rewards: { coins: 500, exp: 200 },
    starsCheck: [{ k: "win" }, { k: "skillCasts", n: 6 }, { k: "smashes", n: 3 }],
  },

  // ==================== 第四章：黄昏馆 (Dusk Arena) ====================
  {
    id: "arena_1",
    stageNo: 16,
    chapter: 4,
    chapterName: "黄昏馆",
    court: "arena",
    title: "全场镁光灯",
    subtitle: "FLASH FRENZY",
    badge: "眩目光晕",
    desc: "世界级职业大赛看台座无虚席，多拍缠斗时爆发出密集闪光灯，在球场正中产生白晕残影！",
    hint: "保持肌肉记忆与节奏感，顶住全场闪光灯的视觉压迫，沉着回击！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      environment: { spectatorFlash: true },
    },
    rewards: { coins: 360, exp: 150 },
    // 与第 8 关同病:★2 要一记 10 拍长回合、★3 又要失分≤1 —— 长回合本身就在送分。
    // 回合降到 8 拍(仍是这关的"顶住闪光灯"正题),失分放到 ≤2。
    starsCheck: [{ k: "win" }, { k: "rallyAtLeast", n: 8 }, { k: "opScoreAtMost", n: 2 }],
  },
  {
    id: "arena_2",
    stageNo: 17,
    chapter: 4,
    chapterName: "黄昏馆",
    court: "arena",
    title: "极限体能局",
    subtitle: "STAMINA BURN",
    badge: "体能博弈",
    desc: "加时赛体能见底！冲刺与起跳极速消耗体力槽，力竭时步履蹒跚；唯有挑高远球原地站立快速回气！",
    hint: "还原羽毛球高远球拉吊真谛！切忌全场盲目冲刺，用高远球调动对手并原地回气，待其疲软一拍绝杀！",
    targetScore: 7,
    aiDiff: "hard",
    modifiers: {
      player: { staminaSystem: true },
    },
    rewards: { coins: 400, exp: 160 },
    starsCheck: [{ k: "win" }, { k: "noExhausted" }, { k: "netLead", n: 2 }],
  },
  {
    id: "arena_3",
    stageNo: 18,
    chapter: 4,
    chapterName: "黄昏馆",
    court: "arena",
    title: "打蜡事故",
    subtitle: "WAX OVERDRIVE",
    badge: "极滑溜冰",
    desc: "地板保养过度打蜡！地面摩擦力骤降 75%，角色如同在光滑冰面上溜冰滑行，急停需反向拉摇杆！",
    hint: "魔性溜冰手感！起跑后利用惯性长距离滑行，松手前提前反向急停刹车，在滑行中帅气起跳击球！",
    targetScore: 7,
    aiDiff: "normal",
    modifiers: {
      player: { frictionMul: 0.25 },
    },
    rewards: { coins: 420, exp: 170 },
    starsCheck: [{ k: "win" }, { k: "slidingScores", n: 2 }, { k: "opScoreAtMost", n: 1 }],
  },
  {
    id: "arena_4",
    stageNo: 19,
    chapter: 4,
    chapterName: "黄昏馆",
    court: "arena",
    title: "破损的战球",
    subtitle: "WOBBLE SHUTTLE",
    badge: "蝴蝶诡球",
    desc: "使用了一颗羽毛打裂的破损羽毛球，飞行中高频上下抖动，后半程还会随机失速急坠！",
    hint: "球路不走寻常抛物线，保持双脚敏捷移动，给拍面留出足够的容错余量！",
    targetScore: 7,
    aiDiff: "hard",
    modifiers: {
      physics: { erratic: true },
    },
    rewards: { coins: 450, exp: 180 },
    starsCheck: [{ k: "win" }, { k: "opScoreAtMost", n: 1 }, { k: "netIntercepts", n: 2 }],
  },
  {
    id: "arena_5",
    stageNo: 20,
    chapter: 4,
    chapterName: "黄昏馆",
    court: "arena",
    title: "冠军赛点",
    subtitle: "CHAMPIONSHIP POINT",
    badge: "生死决胜局",
    desc: "世界总决赛 10:10 赛点！面对顶级无解的传奇羽坛霸主 AI，丢 1 球立即挑战失败，必须连拿 2 分加冕总冠军！",
    hint: "一分不失，极限高压对抗！集中全部精力，发挥你所学的所有球路与战术，绝杀夺冠！",
    targetScore: 12,
    isMatchPointStart: true,
    deathmatch: true,
    aiDiff: "hard",
    aiSkill: "flash",
    modifiers: {},
    rewards: { coins: 888, exp: 400 },
    // 这一关 ★1 说的话与通用措辞不同(生死战不是"赢得对局"而是"连拿 2 分"),
    // 是全表唯一保留作者覆写的地方;★2「最后一球以扣杀得分」照判据原样写清 ——
    // 这条极其硬(生死局里最后一分要打成扣杀制胜),必须在开战前就看见,不能事后才发现。
    starsGoal: ["连拿 2 分绝杀夺冠", "最后一球以扣杀得分", "打出至少 2 次完美击球"],
    starsCheck: [{ k: "win" }, { k: "lastSmash" }, { k: "perfects", n: 2 }],
  },
];

// ---------- 闯关模式存档与进度管理 ----------

export interface CampaignProgress {
  /** 存档版本:目前恒 1,只作标记(与 settings 的 v 同一约定) */
  v: number;
  records: Record<string, StageRec>;
  unlockedMaxStageNo: number;
}

let progressCache: CampaignProgress | null = null;

function freshProgress(): CampaignProgress {
  return {
    v: 1,
    records: {},
    unlockedMaxStageNo: 1, // 默认第 1 关解锁
  };
}

export const CampaignManager = {
  getStages(): StageDef[] {
    return CAMPAIGN_STAGES;
  },

  getStage(id: string): StageDef | undefined {
    return CAMPAIGN_STAGES.find((s) => s.id === id);
  },

  getStagesByChapter(chap: number): StageDef[] {
    return CAMPAIGN_STAGES.filter((s) => s.chapter === chap);
  },

  getStagesByCourt(court: CourtTheme): StageDef[] {
    return CAMPAIGN_STAGES.filter((s) => s.court === court);
  },

  getProgress(): CampaignProgress {
    if (!progressCache) {
      const saved = load<Partial<CampaignProgress>>(STORAGE_KEY, {});
      progressCache = {
        v: typeof saved.v === "number" ? saved.v : 1,
        // 错型防御:records 被手改/写坏成非对象时,下面所有 records[x] 读取都会崩
        records: saved.records && typeof saved.records === "object" ? saved.records : {},
        unlockedMaxStageNo: typeof saved.unlockedMaxStageNo === "number" ? Math.max(1, saved.unlockedMaxStageNo) : 1,
      };
    }
    return progressCache;
  },

  isStageUnlocked(stageNo: number): boolean {
    const prog = this.getProgress();
    return stageNo <= prog.unlockedMaxStageNo;
  },

  getStageRec(id: string): StageRec {
    const prog = this.getProgress();
    return prog.records[id] || { stars: 0, clears: 0, bestScore: "0-0", attempts: 0 };
  },

  getTotalStars(): number {
    const prog = this.getProgress();
    let sum = 0;
    for (const k of Object.keys(prog.records)) {
      sum += prog.records[k].stars || 0;
    }
    return sum;
  },

  getClearedCount(): number {
    const prog = this.getProgress();
    let count = 0;
    for (const k of Object.keys(prog.records)) {
      if ((prog.records[k].clears || 0) > 0) count++;
    }
    return count;
  },

  getStageByNo(stageNo: number): StageDef | null {
    return CAMPAIGN_STAGES.find((s) => s.stageNo === stageNo) ?? null;
  },

  /**
   * 「下一关」= 已解锁但还没通关里编号最小的那一关;全 20 关都通了返回 null。
   * 解锁是线性的(过第 N 关开第 N+1 关),所以按编号正序扫第一个 clears===0 就够。
   * 大厅的直达条与结算页的「下一关」按钮共用这一条判据 —— 两边不能各算各的。
   */
  getNextStage(): StageDef | null {
    for (const s of CAMPAIGN_STAGES) {
      if (this.isStageUnlocked(s.stageNo) && (this.getStageRec(s.id).clears || 0) === 0) return s;
    }
    return null;
  },

  recordStageClear(
    stage: StageDef,
    myScore: number,
    opScore: number,
    starsEarned: number
  ): { firstClear: boolean; newStars: number } {
    const prog = this.getProgress();
    const prev = prog.records[stage.id] || { stars: 0, clears: 0, bestScore: `${myScore}-${opScore}`, attempts: 0 };
    const firstClear = prev.clears === 0;
    const oldStars = prev.stars || 0;
    const newStars = Math.max(oldStars, Math.min(3, Math.max(1, starsEarned)));

    prev.stars = newStars;
    prev.clears = (prev.clears || 0) + 1;
    // 「最佳」必须真的最佳 —— 旧写法无条件覆盖成最近一局,重打打得更差反而把纪录改差
    if (isBetterBestScore(myScore, opScore, prev.bestScore)) prev.bestScore = `${myScore}-${opScore}`;
    prev.attempts = (prev.attempts || 0) + 1;
    prog.records[stage.id] = prev;

    // 解锁下一关
    if (stage.stageNo >= prog.unlockedMaxStageNo && stage.stageNo < CAMPAIGN_STAGES.length) {
      prog.unlockedMaxStageNo = stage.stageNo + 1;
    }

    save(STORAGE_KEY, prog);
    return { firstClear, newStars: newStars - oldStars };
  },

  recordAttempt(id: string): void {
    const prog = this.getProgress();
    const prev = prog.records[id] || { stars: 0, clears: 0, bestScore: "0-0", attempts: 0 };
    prev.attempts = (prev.attempts || 0) + 1;
    prog.records[id] = prev;
    save(STORAGE_KEY, prog);
  },
};
