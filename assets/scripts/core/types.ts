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

// ---------- 输入 ----------

/**
 * 一步的输入快照。真人和 AI 共用同一形状(AI 直接给数值深度),
* 挥拍落点 swingAim:字符串键名("far"/"near"/"mid")或 0..1 的数值深度。
 * 回调钩子由 game 层挂上,逻辑层只负责在正确时机调用。
 */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  swingAim: string | number | null;
  lungePressed: boolean;
  onJump?(p: Player): void;
  onLand?(p: Player, vy: number): void;
  onFootstep?(p: Player): void;
  onWhiff?(p: Player): void;
  onLunge?(p: Player): void;
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
  swingT: number;
  swingStyle: SwingStyle;
  swingHit: boolean;
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
  /** 击球身体后仰(度):命中瞬间设值,每帧衰减回 0 */
  hitRecoil: number;
  /** 跨步救球:-1=未激活,>=0=当前帧计数 */
  lungeT: number;
  lungeDir: number;
  lungeRecovery: number;
  stats: { hits: number; smashes: number; sweets: number; perfects: number; whiffs: number };
  /** rules.step 每步记下的输入快照(调试/回放用) */
  lastInp?: PlayerInput;
  racketSkin?: SkinDef;
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
}

// ---------- 击球结果 ----------

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
  /** 时机教学:命中了但不甜时提示该往哪边调(只给真人) */
  timingHint?: "early" | "late";
}

// ---------- 事件 ----------

/** rules 只发事件不碰表现层:emit 往这里塞,由 game 层统一消费分发 */
export interface GameEvent {
  t: string;
  [key: string]: unknown;
}

// ---------- 数据表类型(config.ts 使用) ----------

/** 皮肤:三类共用一张表结构,颜色字段按 kind 各取所需 */
export interface SkinDef {
  id: string;
  kind: "player" | "racket" | "shuttle";
  name: string;
  price: number;
  unlockLevel?: number;
  /** player 皮肤主题色 */
  main?: string; dark?: string; glow?: string;
  /** racket 配色;frame 留空 = 跟随人物主题 glow 色 */
  grip?: string; shaft?: string; frame?: string | null;
  /** shuttle 配色;裙羽一律浅色系,暗色球馆里不丢辨识度 */
  cap?: string; band?: string; skirt?: string; vein?: string;
}

export type SkinKind = "player" | "racket" | "shuttle";

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
  /** 要求玩家按的键:far=J 深球 / near=K 短球,只驱动引导文案与时机条 */
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
