// ============================================================
// 共享实体类型 —— 逻辑层各模块的公共词汇表。
// 只放类型,不放运行时代码;config.ts 也从这里拿数据表类型,
// 依赖方向恒为:types ← config ← 其余模块,不会成环。
// ============================================================

export type TeamSide = "left" | "right";

/** Physics.classify 的球种判定,全游戏唯一的球种体系 */
export type ShotKind = "smash" | "slash" | "lob" | "netshot" | "drive" | "clear";

/** AI 难度档位 key(对应 CFG.diffs) */
export type DiffKey = "easy" | "normal" | "hard";

/** 挥拍样式:over=高球下压,under=低球上挑 */
export type SwingStyle = "over" | "under";

/**
 * 表情种类:黑脸白线条,由 drawHead 按种类切换五官画法。
 * 设置入口统一在 game 层(drain 事件分发),真人/CPU 共用同一字段。
 */
export type FaceKind =
  | "normal"   // 默认:圆点眼 + 平线嘴,眼神追球 + 周期眨眼
  | "fierce"   // 扣杀:斜怒眉 + 紧咬直线嘴
  | "star"     // 完美击球:十字星眼 + 笑弧 + 星星贴纸
  | "wow"      // 惊讶(被扣/擦网):大圆眼 + o 嘴 + 感叹号气泡
  | "oops"     // 失误(下网):大圆眼 + 波浪嘴 + 汗滴贴纸
  | "happy"    // 得分:∩∩ 笑眼 + 大笑弧
  | "sad"      // 丢分:无力眼线 + 倒弧嘴 + 汗滴贴纸
  | "cheer"    // 赢下比赛:∩∩ 笑眼 + 半圆张嘴 + 爱心贴纸
  | "ko";      // 输掉比赛:XX 眼 + 波浪嘴

// ---------- 技能系统 ----------

/** 可装备技能标识 */
export type SkillId = "lunge" | "smash" | "flash" | "magnet" | "focus";

/** 技能静态定义 */
export interface SkillDef {
  id: SkillId;
  name: string;
  shortName: string;
  tag: string;
  desc: string;
  unlockLevel: number;
  cooldownFrames: number;
  accent: string;
  icon: string;
}

/** 球员身上的技能运行时状态 */
export interface PlayerSkillState {
  id: SkillId;
  cd: number;               // 剩余冷却帧数 (<=0 表示已就绪)
  maxCd: number;            // 技能基础冷却总帧数
  activeT: number;          // 激活执行中的剩余帧数 (-1=空闲)
  buffT: number;            // 增益状态剩余帧数 (如百分百重击附魔, >0 表示激活中)
  ready: boolean;           // 当前局势下是否满足激活门槛 (如闪现扣杀要求球高/在己方半场)
  magnetPulling?: boolean;  // 引力吸球进行中
}

// ---------- 输入 ----------

/**
 * 一步的输入快照。真人和 AI 共用同一形状(AI 直接给数值深度),
* 挥拍落点 swingAim:字符串键名("far"/"near"/"mid")或 0..1 的数值深度。
 * 回调钩子由 game 层挂上,逻辑层只负责在正确时机调用。
 */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  /**
   * 摇杆模拟量:-1..1(左负右正)。非零且超过死区时优先于 left/right,
   * 让玩家能给出"半速小碎步"这种中间态;键盘/老按钮模式不提供此字段。
   */
  moveAxis?: number;
  /**
   * 滑轨精准定位目标点(场地世界坐标 x,仅 slider 移动模式生效)。
   * 若指定此字段,player.ts 将采用平滑定点刹停算法,精准落位于该点且无过冲。
   */
  targetX?: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  swingAim: string | number | null;
  /**
   * 滑动手势方向(触屏击球键专用):0=未提交(mid,由物理自动决定球种),
   * 1=右滑(deep/深球), -1=左滑(near/短球)。
   * 挥拍期间可动态提交;player.ts 在命中前用它覆盖 p.swingAim。
   * 键盘路径通过 press("swingFar"/"swingNear") 直接设 ±1,等价于即按即定。
   */
  swingSwipe?: number;
  lungePressed: boolean;
  /** 跨步方向(-1=向左, 1=向右; 未指定时兜底面向方向 p.facing)。Pad 端按最近的方向键解出 */
  lungeDir?: number;
  /** 动态技能按键按下 (兼容 lungePressed) */
  skillPressed?: boolean;
  skillDir?: number;
  onJump?(p: Player): void;
  onLand?(p: Player, vy: number): void;
  onFootstep?(p: Player): void;
  onWhiff?(p: Player): void;
  onLunge?(p: Player): void;
  onSkill?(p: Player, skillId: SkillId): void;
}

// ---------- 实体 ----------

/** 球员皮肤主题(球衣/短裤/发带/手臂全跟这套色走) */
export interface Theme {
  main: string;
  dark: string;
  glow: string;
  name: string;
}

/** AI 拦截点:重模拟出的「球进入可击高度」的位置 */
export interface Intercept {
  x: number;
  y: number;
  t: number;
  h: number;
}

/** 挂在球员身上的 AI 状态(同一个 AI 可驱动两个球员) */
export interface AiState {
  tick: number;
  targetX: number;
  serveT: number;
  wantSmash: boolean;
  ic: Intercept | null;
  swingLead: number | null;
  chasing: boolean;
  /**
   * 本记来球「认定」的站位偏差(px,带符号):每记球只掷一次,之后一路认账。
   * 旧结构每次重规划重掷 → 均值归零 → AI 收敛到真实落点,难度档形同虚设。
   */
  readErr: number;
  /** readErr 是否已为本记来球掷过(随 swingLead 一起复位,见 ai.ts) */
  readRolled: boolean;
  /** 情绪值:-1(沮丧)到 1(亢奋),0=平静 */
  emotion: number;
  tauntCd: number;
  celebrateT: number;
  frustrateT: number;
}

/** 球员。字段与 Rules/Player 的既有用法一一对应,渲染层也只读这里 */
export interface Player {
  side: TeamSide;
  isAI: boolean;
  theme?: Theme;
  label?: string;
  aiDiff: DiffKey | null;
  ai: AiState | null;
  zone: string;
  teamLabel: string;
  idx: number;
  jersey: string;
  x: number; y: number; vx: number; vy: number;
  px: number; py: number;
  homeX: number;
  facing: number;
  onGround: boolean;
  coyote: number;
  jumpBuf: number;
  /** squash / stretch(sqPrev 供渲染插值,消 60Hz 阶跃) */
  sq: number; sqPrev: number;
  recoverT: number;
  runPhase: number; runAmt: number; runStep: number;
  blinkSeed: number;
  /** 当前表情(faceT>0 时生效,否则画 normal);由 game 层事件设置 */
  face?: FaceKind;
  /** 表情剩余帧数:Pl.update 每步递减,冻结态(hitstop/暂停/OVER)不衰减 → 表情保持 */
  faceT?: number;
  /** 表情总时长(与 faceT 同时设置):贴纸 pop-in 动画据此算已进行帧数 */
  faceD?: number;
  swingT: number;
  swingStyle: SwingStyle;
  lastSwingStyle?: SwingStyle;
  swingHit: boolean;
  /** 这一拍是发球起拍(起拍时球还在手上):渲染层用来切换发球专属的远臂松球轨迹 */
  serveSwing?: boolean;
  swingQ: number;
  swingBuf: number;
  swingBufAim: string | number | null;
  swingAim: string | number;
  swingRadius: number;
  racket: { x: number; y: number; ang: number };
  racketPrev: { x: number; y: number };
  hitLock: number;
  contactFlash: number;
  speedMul: number;
  aiAimErr: number;
  zoneScale: number;
  score: number;
  smashGlow: number;
  sweetGlow: number;
  perfectGlow: number;
  /** 连击热手:本分内连续 sweet/perfect 计数(tryHit 增减,beginPoint 清零) */
  heat: number;
  /** 击球身体后仰(度):命中瞬间设值,每帧衰减回 0 */
  hitRecoil: number;
  /** 跨步救球:-1=未激活,>=0=当前帧计数 */
  lungeT: number;
  lungeDir: number;
  /** 跨步冷却:>0 期间不许再次跨步,但移动完全正常(不再有慢速恢复期) */
  lungeCd: number;
  /** 跨步后特殊击球窗口倒计时(>0=窗口内,每帧递减,跨步触发时重置为 C.lunge.shotWindow) */
  lungeShotT: number;
  /** 球员当前技能系统状态 */
  skill?: PlayerSkillState;
  /** 闪现扣杀残影与电光倒计时 */
  flashT?: number;
  /** 时空减速领域持续帧 */
  focusT?: number;
  stats: { hits: number; smashes: number; sweets: number; perfects: number; whiffs: number };
  /** rules.step 每步记下的输入快照(调试用) */
  lastInp?: PlayerInput;
  racketSkin?: SkinDef;
  /** 完整人物皮肤定义:theme 只传三色,发型/头饰/纹样/光环等设计字段从这里读 */
  playerSkin?: SkinDef;
  /** 面部款式:未挂或字段缺失时渲染层兜回墨面款(经典黑脸) */
  faceSkin?: SkinDef;
  hideTag?: boolean;
  groundY?: number;
}

/** 羽毛球。held 时由持球人手掌位置驱动 */
export interface Ball {
  x: number; y: number; px: number; py: number; vx: number; vy: number;
  live: boolean;
  held: boolean;
  owner: Player | null;
  lastHitter: TeamSide | null;
  crossed: boolean;
  netted: boolean;
  shot: ShotResult | null;
  sq: number;
  sqPrev: number;
  /** 得分后球飞入手中动画期间为 true */
  flying: boolean;
  /** 飞入手中动画剩余帧 */
  flyT: number;
  /** 飞入手中动画起点 X（落点） */
  flyFromX: number;
  /** 飞入手中动画起点 Y */
  flyFromY: number;
  /** 引力吸球进行中的牵引目标与参数 */
  magnetPull?: { targetX: number; targetY: number; player: Player; total: number; t: number; fromX: number; fromY: number } | null;
}

// ---------- 击球参数与结果 ----------

export interface HitOpt {
  q?: number; sweet?: boolean; perfect?: boolean; dEdge?: number;
  /** 连击热手:本次命中「之前」的连续好球数(0 = 无加成;发球等直调路径不带) */
  heat?: number;
  /** 跨步后特殊击球窗口内命中(buildShot 叠加 shotBoost + shotPowerDeg) */
  lungeShot?: boolean;
  /** 发球等场景直接指定落点深度(绕过瞄准表) */
  forced?: { depth: number };
}

/** 一次命中的完整结果:player.buildShot 的产物,rules 只负责装进球里 */
export interface ShotResult {
  kind: ShotKind;
  q: number;
  sweet: boolean;
  perfect: boolean;
  depth: number;
  vx: number;
  vy: number;
  power: number;
  deg: number;
  landX: number;
  steps: number;
  intoNet: boolean;
  contactX: number;
  contactY: number;
  hitter: Player;
  /** 命中后的连击热度(渲染层球残影换「火热」风格用) */
  heat?: number;
  /** 跨步后窗口内击球:力度强化标记(渲染层给专属飘字/反馈档位) */
  lungeShot?: boolean;
  /** 时机教学:命中了但不甜时提示该往哪边调(只给真人) */
  timingHint?: "early" | "late";
  /** 瞄准档位:挥拍时提交的落点瞄准("deep"=深球压底线 / "near"=短球放网 / "mid"=不指定);
   *  命中确认飘字用(表现层判断真人后区分轻重提示) */
  aim?: string;
  /** 触发的专属技能类型(用于飘字、音效、专属特效) */
  skillKind?: SkillId;
}

// ---------- 事件 ----------

/** rules 只发事件不碰表现层:emit 往这里塞,由 game 层统一消费分发 */
export interface GameEvent {
  t: string;
  [key: string]: unknown;
}

// ---------- 数据表类型(config.ts 使用) ----------

/** 稀有度:商店卡片框色/角标/排序依据;纯色款=common,设计款按设计量分级 */
export type Rarity = "common" | "rare" | "epic" | "legendary";

/** 皮肤:四类共用一张表结构,颜色字段按 kind 各取所需;
 *  设计字段(发型/头饰/纹样/特效)同样按 kind 各取所需,全部可选=纯色款只填颜色。
 *  设计字段是「注册表 key」而不是枚举:render/sprites 里各有一张
 *  HAIRS/HEADWEARS/OUTFITS 函数表,新特征 = 注册一个绘制函数,
 *  新人物 = 在 config.SKINS 加一条数据(复用现有特征时零绘制代码)。 */
export interface SkinDef {
  id: string;
  kind: "player" | "racket" | "shuttle" | "face";
  name: string;
  price: number;
  unlockLevel?: number;
  rarity?: Rarity;
  /** player 皮肤主题色 */
  main?: string; dark?: string; glow?: string;
  /** player 设计字段:发型/发色/头饰/球衣纹样/脚下光环(传说专属)。
   *  key 对应 sprites.ts 的 HAIRS/HEADWEARS/OUTFITS/AURA_COLORS 注册表 */
  hairStyle?: string;
  hairColor?: string;
  headwear?: string;
  jersey?: string;
  aura?: string;
  /** player 人物默认脸面(faceStyle key);装备的脸面商品为 face-auto 时生效 */
  face?: string;
  /** player 体型档:config.bodies 的 key —— 髋高/躯干/头身比的整体微调
   *  (挥拍肩点 pivotY 是判定锁定位,体型档不碰它,只改下肢/躯干/头) */
  body?: "standard" | "compact" | "tall";
  /** player 肤色:脸面为肤色系时作脸底、手臂/手共用;缺省走全局 SKIN */
  skinTone?: string;
  /** face 设计字段:脸面款式 key(config.faceStyles 注册表)。
   *  "auto" = 跟随人物默认脸(装备位默认款),其余 key 直接指定 */
  faceStyle?: string;
  /** racket 配色;frame 留空 = 跟随人物主题 glow 色 */
  grip?: string; shaft?: string; frame?: string | null;
  /** racket 设计字段:拍线颜色/拍框贴章/挥拍弧光专属风格(残影同步) */
  stringColor?: string;
  decal?: "star" | "bolt" | "flame" | "crystal";
  swingFx?: "fire" | "ice" | "electric" | "rainbow";
  /** shuttle 配色;裙羽一律浅色系,暗色球馆里不丢辨识度 */
  cap?: string; band?: string; skirt?: string; vein?: string;
  /** shuttle 设计字段:专属拖尾风格(全场可见,高稀有度卖点) */
  trailStyle?: "star" | "flame" | "petal" | "rainbow";
}

export type SkinKind = "player" | "racket" | "shuttle" | "face";

/** 主菜单条目 */
export interface MenuEntry {
  id: string;
  label: string;
  tag: string;
  desc: string;
  mode: "2p" | "1p" | "2v2";
  diff: DiffKey | null;
  humans?: number;
}

/** 训练场关卡定义。判据字段全部可选,由 Drill.matches 统一执行 */
export interface DrillDef {
  id: string;
  label: string;
  tag: string;
  desc: string;
  goal: number;
  /** 以 Physics.classify 为唯一裁判,不自造第二套球种判定 */
  want: ShotKind[];
  /** 喂球机旋钮:只描述喂球(落点深浅/第几帧放球),和要求玩家按的键无关 */
  feed: { depth: number; jumpLead: number };
  /** 要求玩家按的击球键:far=「深球」/ near=「短球」,只驱动引导文案与时机条 */
  wantKey: "far" | "near";
  contactX: number;
  demoH: number;
  cue: string;
  points: string[];
  pose: { style: SwingStyle; jump: boolean; cut?: number; lunge?: number; tight?: boolean; crouch?: boolean };
  // 这一关特有的客观量约束(球种窄带不够用时补)
  minDepth?: number; maxDepth?: number;
  minLandX?: number; maxLandX?: number;
  minSteps?: number; maxSteps?: number;
  minContact?: number; maxContact?: number;
}
