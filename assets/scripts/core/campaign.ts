// ============================================================
// 闯关挑战模式核心系统 (Campaign Challenge Mode)
// 零 Cocos 依赖，纯 TypeScript 驱动，严格遵守 core/ 分层铁律。
// 汇集四大场景（海滩、道场、赛博、黄昏馆）共 20 关特色创意挑战。
// ============================================================
import { CFG } from "./config";
import { load, save } from "./utils";
import { DiffKey, SkillId } from "./types";

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
  aiSkill?: SkillId;
  modifiers: StageModifiers;
  rewards: {
    coins: number;
    exp: number;
  };
  starsGoal: [string, string, string];
}

export interface StageRec {
  stars: number;               // 0..3 星
  clears: number;              // 通关次数
  bestScore: string;           // 如 "3-1"
  attempts: number;
}

const STORAGE_KEY = "dudu_campaign_progress";

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
    subtitle: "CROSSWIND SHIFT",
    badge: "狂暴阵风",
    desc: "强劲侧风把球往旁边推：海面的风丝与椰梢往哪边倒、风向标的黄针就往哪边指，球也被推向哪边。风每隔几秒换一次方向。",
    hint: "黄针是当前风，青针是你出手那一拍的风。顺风收力、逆风发力压深；两针合拢时落点最可控。",
    targetScore: 7,
    aiDiff: "easy",
    modifiers: {
      physics: { windX: 0.18, windOscillate: true },
    },
    rewards: { coins: 150, exp: 60 },
    starsGoal: ["赢得对局", "净胜对手 2 分以上", "无发球失误"],
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
    starsGoal: ["赢得对局", "使用飞扑救球至少 3 次", "失分不超过 1 分"],
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
    starsGoal: ["赢得对局", "打出至少 2 次完美击球", "净胜对手 2 分以上"],
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
      physics: { dragMul: 1.35 },
      environment: { sandstorm: true },
    },
    rewards: { coins: 240, exp: 95 },
    starsGoal: ["赢得对局", "完成至少 2 次扣杀得分", "失分不超过 2 分"],
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
    starsGoal: ["赢得对局", "打出至少 3 次高空烈焰扣杀", "净胜对手 3 分以上"],
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
    starsGoal: ["赢得对局", "打出至少 3 次底线深球", "零失误零丢分"],
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
    starsGoal: ["赢得对局", "触发居合一闪至少 2 次", "净胜对手 2 分以上"],
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
    starsGoal: ["赢得对局", "失分不超过 1 分", "回合数达到 8 拍以上"],
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
    starsGoal: ["赢得对局", "全程 0 次空挥失误", "打出至少 3 次甜区击球"],
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
    starsGoal: ["赢得对局", "未触发任何禁区惩罚", "净胜对手 2 分以上"],
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
    starsGoal: ["赢得对局", "在 EMP 故障期间成功回球 2 次", "净胜对手 2 分以上"],
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
    starsGoal: ["赢得对局", "未被假球欺骗失误", "失分不超过 1 分"],
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
    starsGoal: ["赢得对局", "触发激光加速球至少 2 次", "扣杀得分至少 2 次"],
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
    starsGoal: ["赢得对局", "空中击球占比超过 70%", "净胜对手 2 分以上"],
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
    starsGoal: ["赢得对局", "在一局内释放技能至少 6 次", "打出至少 3 次扣杀"],
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
    starsGoal: ["赢得对局", "完成一记 10 拍以上长回合", "失分不超过 1 分"],
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
    starsGoal: ["赢得对局", "全程体力未进入枯竭耗尽状态", "净胜对手 2 分以上"],
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
    starsGoal: ["赢得对局", "在滑行状态下击球得分至少 2 次", "失分不超过 1 分"],
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
    starsGoal: ["赢得对局", "失分不超过 1 分", "完成至少 2 次网前精准截击"],
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
    starsGoal: ["连拿 2 分绝杀夺冠", "最后一球以扣杀得分", "打出至少 1 次完美击球"],
  },
];

// ---------- 闯关模式存档与进度管理 ----------

export interface CampaignProgress {
  records: Record<string, StageRec>;
  unlockedMaxStageNo: number;
}

let progressCache: CampaignProgress | null = null;

function freshProgress(): CampaignProgress {
  return {
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
        records: saved.records || {},
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
    prev.bestScore = `${myScore}-${opScore}`;
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
