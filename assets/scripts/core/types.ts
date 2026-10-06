// ============================================================
// 共享实体类型 —— 逻辑层各模块的公共词汇表。
// 只放类型,不放运行时代码;config.ts 也从这里拿数据表类型,
// 依赖方向恒为:types ← config ← 其余模块,不会成环。
// ============================================================

export type TeamSide = "left" | "right";

/** Physics.classify 的球种判定,全游戏唯一的球种体系 */
export type ShotKind = "smash" | "slash" | "lob" | "netshot" | "drive" | "clear";

/** AI 难度档位 key(对应 CFG.diffs);expert = 天花板挑战档 */
export type DiffKey = "easy" | "normal" | "hard" | "expert";

/** AI 面对扣杀时的防守削弱参数 */
/**
 * 难度档的**增量**(不是绝对值):关卡只想"让 AI 稍微再钝一点"时,
 * 不该被迫重抄一遍该档的其余十个数(那等于把三档表抄成二十份)。
 * 正数 = 更差(read 偏差更大 / shotErr 打得更飞 / timingErr 起手更毛 / aggr 更敢扣)。
 */
export type AiDelta = Partial<Record<"read" | "shotErr" | "timingErr" | "aggr", number>>;

/**
 * AI 难度档一行(config.diffs 的值)。
 * windSense 是「看风下手」的程度(0..1):出球解算的 aim 口径**不认风**(见 physics 的
 * IntegrateIntent),所以风真的会把 AI 的球吹偏;这一档补回几成由 windSense 说了算。
 * 0 = 一味不补(风关里也会自爆,留给玩家读风的下手空间),1 = 补满 aiWindDepth。
 */
export interface AiTier {
  label: string;
  tick: number;
  speed: number;
  read: number;
  readFloor: number;
  zone: number;
  shotErr: number;
  timingErr: number;
  aggr: number;
  composure: number;
  crush: number;
  notice: number;
  windSense: number;
  /**
   * 轻松拍回气的闸门(0=这一档接软球也不回气;1=回)。
   * easy 档刻意为 0:新手回球 80% 是高远/放网这类慢软球,若 AI 一路回气,
   * 新手永远体验不到「把他打累 → 他漏球」的正反馈,且会顶穿 ai-check 的 easy 回合长度红线。
   * 只管回气这一半 —— 扣体力本身三档都走,由 crush 决定扣多少。
   */
  softGate: number;
}

/**
 * AI 发球配比一行(config.serveMix):先抽**类型**(flick/clear,其余是标准发球),
 * 再从 serveMix.bands 里对应那条带抽蓄力帧数。带与 flickThresh/clearThresh 不相交,
 * 所以"想发什么"和"实际发出什么"构造上不可能错档 —— 从前是拿延迟反查类型,
 * 默认带 [40,90] 正好跨在 65 上,入门档一半的发球悄悄变成高飘球(白送分)。
 * vsBackCamper/vsNetRusher:对手蹲底线 / 站位靠前时改发短球的比例。
 */
export interface ServeMixTier {
  flick: number;
  clear: number;
  vsBackCamper: number;
  vsNetRusher: number;
}

export interface AiSmashDefenseDef {
  /** 面对扣杀的额外反应迟疑帧数(猝不及防愣神) */
  noticeAdd: number;
  /** 站位误判放大倍率 */
  readMul: number;
  /** 接杀判定区缩放(重杀容错收紧) */
  zoneMul: number;
  /** 挥拍时机误差增量(极速穿窗易挥空) */
  timingAdd: number;
  /** 勉强接下时的出球失误增量(px,易下网或出界) */
  shotErrAdd: number;
}

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
export type SkillId = "lunge" | "smash" | "flash" | "magnet" | "focus" | "shadow" | "rage";

/** 键面读数走哪条通道:"cd" = 剩余冷却倒计时(默认) / "charge" = 蓄能环 + 百分比 */
export type SkillReadout = "cd" | "charge";

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
  /**
   * 键面读数种类。缺省 = "cd"。
   * "charge" 意味着这款技能的门槛**不是**冷却而是一个可累积的资源(怒气重击),
   * 于是键面不许变灰、不许印秒数 —— 判据只有 skills.isChargeSkill 一份,
   * pad-cd / touchpad / game-root / skill-layout 共用,别在调用点各写一遍 id 比较。
   */
  kind?: SkillReadout;
}

/** 球员身上的技能运行时状态 */
export interface PlayerSkillState {
  id: SkillId;
  cd: number;               // 剩余冷却帧数 (<=0 表示已就绪)
                            // 按下即付是四个瞬发技能的口径;百分百重击(真人)例外 ——
                            // 它是"上弦等兑现",冷却在真正扣出去那一拍才付,挥空不罚冷却(见 skills.ts)
                            // 怒气重击是第三种口径:cd 只有 20 帧、按下即付,**不是门槛**(真闸是怒气
                            // 资源本身 + armed 窗 buffT),它只挡同一帧连点 —— 与影分身同一条先例
  maxCd: number;            // 技能基础冷却总帧数
  activeT: number;          // 激活执行中的剩余帧数 (-1=空闲)
  buffT: number;            // 增益状态剩余帧数 (如百分百重击附魔, >0 表示激活中)
                            // 怒气重击借用同一个字段位:它表示「按下释放、等下一拍兑现」的armed窗,
                            // 递减处仍是 Skills.update 那一处,不再另起一个计时器(少一处双减风险)
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
  /**
   * 纵向滑动手势(触屏击球键专用):0=未提交(弧线由物理自动决定),
   * 1=上滑(挑高/高远,弧线下托),-1=下滑(平抽/下压,弧线压平)。
   * 与 swingSwipe 两轴独立可组合(上+右 = 后场高远球);语义与横滑完全同构:
   * 挥拍期间可动态提交/反向覆盖,player.ts 在命中前用它设置 p.swingLoft。
   * 键盘路径通过 press("swingUp"/"swingDown") 直接设 ±1。AI 不设置此字段。
   */
  swingSwipeY?: number;
  lungePressed: boolean;
  /** 跨步方向(-1=向左, 1=向右; 未指定时兜底面向方向 p.facing)。Pad 端按最近的方向键解出 */
  lungeDir?: number;
  /** 动态技能按键按下 (兼容 lungePressed) */
  skillPressed?: boolean;
  skillDir?: number;
  /**
   * 第二技能键(技能2 槽)按下边沿。真人与 AI 共用形状,但 AI 决策链只走 skillPressed
   * (槽1)—— 双技能是玩家侧增强,AI 不吃(与「只帮真人不帮电脑」同一条口径)。
   * 方向解析与 lungeDir 同式:Pad 端按最近的方向键解出,滑轨模式下 player.ts 用 targetX 覆盖。
   */
  skill2Pressed?: boolean;
  skill2Dir?: number;
  onJump?(p: Player): void;
  onLand?(p: Player, vy: number): void;
  onFootstep?(p: Player): void;
  onWhiff?(p: Player): void;
  onLunge?(p: Player): void;
  onSkill?(p: Player, skillId: SkillId): void;
  /** 「自动击打(辅助模式)」真替玩家起手那一帧的钩子(只在起手的当帧调一次,不是每帧轮询)。
   *  表现层用它飘「自动」;规则/训练/教学走不到这条分支,所以训练工具不接也不报错。 */
  onAutoSwing?(p: Player, ball: Ball): void;
  /**
   * 「这一次滑动用掉了」的钩子 —— 只在**自动击打开着**且这一拍**真把球打出去**时调一次
   * (core/player.ts 的 consumeAutoAim,收招那一帧)。表现层拿它把 pad 的瞄准存储恢复成
   * 锁定值(input/pad.ts 的 restoreSwingAim):没锁时击球键横滑/纵滑只管一拍而不进锁定态,
   * 长滑锁定的方向(pad.swingLockX/Y)经同一条路回锁向。
   * 挥空不调(瞄准留给下一拍,不许白罚);AI/喂球机/影分身不调(这套 hooks 会铺给所有球员,
   * 漏了 !isAI 那道闸就是 CPU 打一拍吃掉玩家的瞄准)。可选:各工具的合成输入不接也不报错。
   */
  onAimConsume?(p: Player): void;
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
  /**
   * 本记发球的定案(planServe 抽一次,serveT 归零时重抽):
   * delay = 打算蓄力到第几帧才起手,aim = 深浅意图。
   * **必须记住**:从前是每帧重抽延迟,而 rules 拿 serveWait 反查发球类型 ——
   * 重抽等于每帧重新决定类型,一发球就变成"谁先够着谁赢"的赛跑。
   */
  serveDelay: number;
  serveAim: number;
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
  /**
   * 本回合连击压力 0..1(乘档位 crush 闸门):放大 readErr / 加时机误差 / 降跑速。
   * 它不是独立账本,而是 `fatigue` 的读数 —— 见 ai.ts 的 pressureOf()。
   */
  pressure: number;
  /**
   * 本回合已花的体力(单位见 CFG.aiStamina.capacity,每分随 reset 归零):
   * AI 每一次**真实击中**按「这一拍有多费力」记一笔账 —— 跑动距离是主力项,
   * 跨步/腾空/跳杀/技能/接重杀各加一笔,慢软球且没跑则回一点。
   * 从前这里是 rally 拍数的纯函数,而发球本身也 rally++,于是玩家一发球
   * 血条就动一格(用户现场:「我发球他掉一下,他接球又掉一下」)。见 ai.ts staminaCost。
   */
  fatigue: number;
  /** 接球反应延迟剩余帧:新来球刚起时先愣几帧再启动(拟人,帧数 = diffs.notice) */
  noticeT: number;
  /** 扑救俯冲剩余帧(>0 = 正做「够不到也要扑一下」的表现;只给渲染读,不改判定) */
  scrambleT: number;
  /** 已计入的挥空数:ai.ts 用它检测「这一帧扑空了」→ 触发中途沮丧 */
  whiffsSeen: number;
  /** 本记来球是否已经做过一次绝望挥拍(每拍至多一次,防连打) */
  panicSwung: boolean;
  /** 本记来球是否已判定为「怎么都赶不上」(供扑救俯冲表现读取) */
  hopeless: boolean;
  /** 起手瞬间记下的接球快照是否已记(每拍一次,击中时被 noteHit 消费) */
  recvNoted: boolean;
  /** 快照:来球球种(lob/netshot/clear = 慢软球,给「轻松接」判据用) */
  recvKind: ShotKind | null;
  /** 快照:起手时离防区中心 |p.x - homeX| 的距离(px) —— 体力账本的主力项 */
  recvRun: number;
  /** 快照:起手时来球的力度(Physics.classify 的 power;0 = 没球可读) */
  recvPower: number;
}

/**
 * 一拍的体力成本输入(ai.ts staminaCost 的入参,给 tools/stamina-check 当靶子)。
 * 全部取自 AiState 的起手快照 + 击中那一刻的 ShotResult,不另立判据。
 */
export interface HitCostInput {
  /** 起手时离防区中心多远(px) */
  run: number;
  /** 起手时来球有多重(0 = 读不到) */
  power: number;
  /** 起手时认定的来球球种 */
  recvKind: ShotKind | null;
  /** 这一拍是跨步救球 */
  lunge: boolean;
  /** 这一拍腾空击球 */
  air: boolean;
  /** 这一拍是跳杀(叠在 air 上) */
  jumpSmash: boolean;
  /** 这一拍用了技能 */
  skill: boolean;
  /** 这一拍自己打出扣杀 */
  ownSmash: boolean;
  /** 这一拍是接发(rally==2):发球-接发是开局仪式,不算消耗,整拍免费 */
  isServeReturn?: boolean;
}

/**
 * 影分身(「影分身」技能的召唤物):挂在宿主身上的独立 Player 实体。
 * **刻意不进 RulesState.players** —— 发球轮转(mates[serveIdx % length])、计分名单、
 * game-root 的 R.players[0]=真人假设都不许被凭空多出的第三名球员污染;
 * 它由 AI.think 出输入、Pl.update/Pl.tryHit 跑完整套移动+挥拍机器,rules 只挂两个钩子。
 *
 * 同场可以有好几个(shadowClones 是数组),身份看 **slot**,不看数组下标(下标会随消散而漂)。
 */
export interface ShadowCloneState {
  /** 分身本体(isAI=true,side 与宿主同侧,idx=-1 不占名单索引) */
  entity: Player;
  /**
   * 槽位号(0..slots.length-1):这一号分身的**身份** —— 颜色、防区、AI 档全由它索引 config。
   * 0 号消散后 1/2 号的颜色不许变;新召的填回最低空位(于是又是 0 号紫)。
   * 用它而不是数组长度当号,是因为"用 length 当 slot"会让死一个之后的分身集体变色。
   */
  slot: number;
  /** 已替宿主接住的球数(玩家自己接球不计数,见 shadow.noteHit) */
  hits: number;
  /** 召唤演出剩余帧(>0 期间闪烁成影,不接球 —— 演出期来球归玩家) */
  spawnT: number;
  /** 消散演出剩余帧(>0 期间不再接球,演完从数组里摘掉) */
  despawnT: number;
  /** 跨回合补满额度的那一下亮片演出剩余帧(纯表现,渲染只读它) */
  refillT: number;
  /** 出生定形种子:渲染层 mulberry32(seed) 定轮廓辉光的尖刺形状,逐帧只缩放与衰减不重掷 */
  seed: number;
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
  /**
   * 挥拍峰值追踪:窗口内「球离判定区心最近」那一帧的结算快照(记账不结算,见 player.tryHit)。
   * 球离开判定区 / 挥拍窗走完时按这份快照出手。null = 这一拍还没摸到过球。
   */
  swingBest?: SwingBestShot | null;
  /** 这一拍是发球起拍(起拍时球还在手上):渲染层用来切换发球专属的远臂松球轨迹 */
  serveSwing?: boolean;
  swingQ: number;
  swingBuf: number;
  swingBufAim: string | number | null;
  swingAim: string | number;
  /**
   * 纵向手势的弧线意图(与 swingAim 的深浅维度正交):0=未提交(由物理自动决定),
   * 1=上滑挑高(buildShot 里把 loft 下托到 loftUpMinDeg),-1=下滑平抽(压到 loftDownMaxDeg)。
   * 起拍清零、挥拍期间由 inp.swingSwipeY 实时覆盖;发球(forced)与跳杀压平分支不受它影响。
   */
  swingLoft: number;
  swingRadius: number;
  racket: { x: number; y: number; ang: number };
  racketPrev: { x: number; y: number };
  hitLock: number;
  contactFlash: number;
  speedMul: number;
  aiAimErr: number;
  zoneScale: number;
  /**
   * 这一局这个 CPU 实际吃的难度档。默认就是 C.diffs[p.aiDiff];
   * 关卡带了 aiTune 时由 rules.startCampaign 存一份合并后的档进来。
   * ai.ts 的 D(p) 只读这一个字段 —— 这样"档位表"与"逐关微调"不会有两份真话。
   */
  aiTier?: AiTier;
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
  /**
   * 跨步自动回球「待发窗」剩余帧:>0 = 系统替玩家按这一拍。
   * 起手帧由 flightFramesToClosest 与 PRESS_LEAD_FRAMES 对齐(与时机环同一把尺子)。
   * 出拍**不清**这个窗 —— 它同时是判定区尾段倍率的开关,清了会把尾段从正在进行的挥拍里抽走;
   * 不重复出拍由 swingT < 0 与 ball.lastHitter 两头钉死。玩家自己按击打键则当场清零。
   * 做成可选:AI 的残缺 ZoneProbe 与商店/预览的半成品人物字面量都不带它,读侧一律 `?? 0`。
   */
  lungeAutoT?: number;
  /**
   * 重击一键化的「代出一拍」待发窗剩余帧:>0 且附魔还在 = 系统替玩家把那一记暴扣轰出去。
   * 择帧与跨步共用同一条判据(player.ts 的 autoSwingDue),只是门控数值各取一份 config。
   * 与 lungeAutoT 的差别是刻意的:出拍**当场清零** —— 它不兼判定区尾段开关,留着只会在
   * 替玩家挥空之后连挥第二下、第三下("人物自己乱挥半天"就是这么来的)。玩家自己按击打键同样当场清零。
   * 做成可选:AI 永远拿不到它(activate 里按 !p.isAI 给零),商店/预览的半成品人物字面量也不带,读侧一律 `?? 0`。
   */
  smashAutoT?: number;
  /**
   * 「怒气重击」整局累积的怒气(0..C.skills.rage.max × pipes,刻意用整数 ⇒ 1 点 = 一管的 1%)。
   *
   * 为什么住 Player 而不是 PlayerSkillState:后者会被 Career.applyToMatch() **整块对象替换**
   * (me.skill = Skills.initSkillState(...)),而它在 equipSkill() 与每次开赛都会跑 ——
   * 怒气放进技能状态对象,玩家换个技能就把攒了半管的东西无声抹掉。Player 只在 Rules.newMatch
   * 重建,那正好是「每局清零」想要的生命周期(先例:p.zenMeter 同样是 Player 上的累积计量)。
   *
   * 多管蓄力(氮气式):攒满一管(max)不清零、继续攒第二三管,总上限 max×pipes;
   * 兑现那一拍只**扣一管**(ratio>=1 ⟺ 至少一整管),零头小释放(<一管)才全放掉。
   *
   * 生命周期:只有**释放兑现的那一拍**扣量(modifyShot 的 !preview 分支)。
   * Skills.resetPoint 每分不清它 —— 用户口径「只有释放才归零」,攒是整局的事。
   * 挥空、待发窗走完、跨分都不扣怒气(资源制下罚它等于白罚:那一拍本来就没兑现)。
   */
  rage?: number;
  /**
   * 「怒气重击」一键化的「代出一拍」待发窗剩余帧:>0 且释放窗(s.skill.buffT)还开着 = 系统替玩家轰那一拍。
   * 与 smashAutoT 同口径:出拍**当场清零**(它不兼判定区开关,留着就是替玩家连挥第二下);
   * 玩家自己按击打键同样当场清零,但**不清 buffT** —— 那一拍照旧由玩家自己把怒气砸出去,
   * 清了就等于「我按了技能、又自己挥了一拍,结果怒气没了」(rage-check 的反例 armedClearedByManual)。
   * 做成可选:AI 永远拿不到它(activate 里按 !p.isAI 给零),读侧一律 `?? 0`。
   */
  rageAutoT?: number;
  /**
   * 「自动击打(辅助模式)」的**每球限次**账:见 C.autoHit.maxTriesPerBall 与 auto-hit-check ⑧。
   * autoTryRef 存这一发来球的身份(Ball.shot 引用:rules.applyShot 写入、beginPoint 清空),
   * 换了对象就从 0 重新数;autoTries = 这一拍已经替玩家起手过几次。
   * 三条一键化不需要这两个数 —— 它们靠"起手当场清窗"免费拿到限次;这条**没有窗**(逐帧轮询),
   * 而 flightFramesToClosest 从第 0 帧起扫,球已在判定区心时 fc = 0 当即判"该按",
   * 不限次就是 smashAutoT 注释警告过的「人物自己乱挥半天」。
   * 做成可选:AI 走不到这条分支,商店/预览的半成品人物字面量也不带,读侧一律 `?? 0`。
   */
  autoTryRef?: ShotResult | null;
  autoTries?: number;
  /**
   * 当前这一拍是不是系统替玩家起手的(逐拍标记,不是逐球):startSwing 一律置 false,
   * 只有 auto-hit 那条分支起手后当场置 true ⇒ 玩家自己抢的那拍绝不会被误标。
   * settle 拿它写 ShotResult.autoHit,表现层据此抑制早/晚时机教学。
   * 跨步/重击/怒气的代拍**刻意不算在这里**:那三拍玩家明明白白按了技能键,早/晚照样该教。
   */
  swingAuto?: boolean;
  /**
   * 「影分身」技能的本分召唤标记:true = 本分已召过(canActivate 据此拒绝再次释放)。
   * 每分由 Skills.resetPoint 清零 —— 用户口径:「一分之内只能释放一次」。
   * 这是攒满三个的天然限速器:**要三分才攒得满**,别把它去掉。
   */
  shadowCast?: boolean;
  /**
   * 影分身召唤物(「影分身」技能)。**恒按 slot 升序的密集数组**,只装活着的分身,
   * 同场最多 CFG.skills.shadow.slots.length 个(数组长度就是上限,不单开 maxClones 键)。
   *
   * 生命周期三条,一条都别"顺手改回去":
   *   · **跨回合(一分)保留**:resetPoint 不再清空,只把未耗尽额度的分身补满回 maxHits
   *     (用户 2026-10-05:「上一局的影分身可以保留到下一局,而不是会直接消失」)
   *   · **不跨对局、不落盘**:重开新局由 rules 的 R.players = [] 整批丢弃,Pl.create() 的
   *     字面量不带这个字段 ⇒ 天然 undefined。不动 Career.profile,关掉应用也没有影子军团
   *   · **住 Player 而不是 p.skill**:同 p.rage 那条先例 —— Career.applyToMatch() 每次开赛与
   *     每次换装都 `me.skill = Skills.initSkillState(...)` **整块换对象**,住技能状态里就是
   *     "换个技能分身全没了"
   */
  shadowClones?: ShadowCloneState[];
  /** 球员当前技能系统状态(技能1 槽;AI 与关卡对手只有这一槽) */
  skill?: PlayerSkillState;
  /**
   * 技能2 槽(2026-10-06 双技能槽):只挂真人(applyToMatch),AI/分身恒 undefined。
   * 与 p.skill 同构、互不知晓:两槽各自的 cd/buffT/magnetPulling 独立递减(skills.update 遍历),
   * 效果状态(lungeT/flash 系/focusT/rage/shadow 系)仍住 Player 本体 —— 两槽装同名效果字段
   * 不会打架,因为「同一款技能不许装两槽」由装备层(Career.equipSkill 互换)保证。
   */
  skill2?: PlayerSkillState;
  /** 闪现扣杀残影与电光倒计时(纯视觉,渲染层读它画雷光/蓄力环) */
  flashT?: number;
  /** 闪现折跃后悬空蓄力剩余帧:>0 期间不吃重力、不接受移动输入(球在那一拍被扣出去之前人是定住的) */
  flashHoldT?: number;
  /** 闪现保底接触窗口剩余帧:>0 且已起拍 = 这一拍一定命中,不再受判定区几何限制 */
  flashStrikeT?: number;
  /** 闪现折跃起点(世界坐标):渲染层据此画从旧位到新位的雷光与残影 */
  flashFrom?: { x: number; y: number } | null;
  /** 时空减速领域持续帧 */
  focusT?: number;
  /** 时空领域内是否已完成接球反击(接球后进入缓释收尾) */
  focusHit?: boolean;
  stats: {
    hits: number; smashes: number; sweets: number; perfects: number; whiffs: number;
    // ---- 闯关三星判据的逐局计数(球员随每局重建,天然按局归零) ----
    lungeShots: number;      // 飞扑窗口内击球
    jumpSmashes: number;     // 跳杀(空中高球烈焰扣杀)
    iaiStrikes: number;      // 居合一闪拔刀斩
    skillCasts: number;      // 技能成功释放次数
    deepShots: number;       // 底线深球(真实落点深度 ≥ C.star.deepDepth)
    netIntercepts: number;   // 网前精准截击(网带附近甜区/完美回球)
    airHits: number;         // 腾空击球(占比判据的分子)
    empReturns: number;      // EMP 故障期间(rally ≥ C.star.empRally)的回球
    zonePenalties: number;   // 踩禁区触电次数
    exhausted: number;       // 体力曾进入枯竭(0/1,取「曾经发生」语义)
  };
  /** rules.step 每步记下的输入快照(调试用) */
  lastInp?: PlayerInput;
  racketSkin?: SkinDef;
  /** 完整人物皮肤定义:theme 只传三色,发型/头饰/纹样/光环等设计字段从这里读 */
  playerSkin?: SkinDef;
  /** 面部款式:未挂或字段缺失时渲染层兜回墨面款(经典黑脸) */
  faceSkin?: SkinDef;
  hideTag?: boolean;
  groundY?: number;
  /** 闯关挑战模式:体力值 (0..100) 与体力枯竭标记 */
  stamina?: number;
  isExhausted?: boolean;
  /** 闯关挑战模式:心流计数 (0..2,达到2触发子弹时间) */
  zenMeter?: number;
  /** 闯关挑战模式:踩入禁区触电僵直倒计时帧 */
  forbiddenWarn?: number;
  /** 闯关挑战模式:极滑地面滑行状态 (正负代表方向,>0绘制溜冰高光轨迹) */
  sliding?: number;
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
  /** 闯关挑战模式:激光加速轨超音速电浆状态 */
  laserBoosted?: boolean;
  /** 闯关挑战模式:破损球颤抖晃动 */
  isErratic?: boolean;
  /** 闯关挑战模式:全息分身假球实体 */
  hologramDecoy?: { x: number; y: number; vx: number; vy: number; t: number; alpha: number } | null;
}

// ---------- 击球参数与结果 ----------

export interface HitOpt {
  q?: number; sweet?: boolean; perfect?: boolean; dEdge?: number;
  /** 连击热手:本次命中「之前」的连续好球数(0 = 无加成;发球等直调路径不带) */
  heat?: number;
  /** 跨步后特殊击球窗口内命中(buildShot 叠加 shotBoost + shotPowerDeg) */
  lungeShot?: boolean;
  /** 跳杀:空中 + 击球点够高(C.jumpSmash.minHeight)= 必然扣杀 + 力度加成 */
  jumpSmash?: boolean;
  /** 发球等场景直接指定落点深度(绕过瞄准表) */
  forced?: { depth: number };
  /**
   * 接触点离地高度(px,buildShot 现算塞入,调用方不用给):settle 在出手前已把球钉回
   * 记账帧接触点,所以 modifyShot 读到的就是真实击球高度;预告通道用实时球位,徽标不撒谎。
   * 闪现的高度威力曲线(apexHeight 档)按它插值,其余技能不读。
   */
  contactH?: number;
  /**
   * 瞄准 hint:把"还没起拍的玩家意图"(击球键上粘住的那次滑动)喂给一次解算。
   * 只有球种预告 player.previewKind 用它,实打路径不传 ⇒ 逐字等于旧行为。
   * 为什么需要:自动击打开起来后玩家不再起拍,p.swingAim 停在上一拍的旧值,
   * 徽标就会一直报上一拍的落点 —— 看不准的读数比没有读数更坏。
   */
  aimHint?: { aim: string | number; loft: number };
  /**
   * 纯预览(球种预告徽标,player.previewKind):照旧走同一条 buildShot + Skills.modifyShot
   * 通道 ⇒ 加成一并算、徽标说的就是实打会发生的事;但**消耗一律跳过** ——
   * buffT / flashStrikeT / magnetPulling / stats.smashes 四处写入在此一律不发。
   * 为什么需要这个标志:预告每个真实帧(按 ≤10 帧节流)就跑一次,而 modifyShot 是按
   * 「真打一拍」写的。旧写法里按下重击后的第一记预告就把附魔清零,玩家看到的是
   * 「按了没反应、下一拍还是普通球」,顺手白付 3.5s 冷却(2026-10-03 真机现场)。
   * 同理被偷的还有闪现的必中窗(它还兼 tryHit 的门槛)与引力吸球的回球加成。
   * 规矩:往 modifyShot 里加任何**状态消耗**,必须同步过 `!preview` 这道闸,
   * 判据与反例见 tools/smash-check.ts。
   */
  preview?: boolean;
}

/** 挥拍峰值追踪的结算快照(记账期攒最优帧,球离区/窗走完时按它出手) */
export interface SwingBestShot {
  q: number;        // 综合质量(qRaw − 边缘罚),记账期的比较键
  qRaw: number;     // 挥拍相位质量(窗口正中 = 1)
  dEdge: number;    // 球离判定区心的边缘比例(0 = 正中;拍头扫掠封顶 0.35,供结算罚用)
  /** 未封顶的真实边缘比例(拍头扫掠在区外时记 2):只供「球折返远去 → 当场出手」的比较,
   *  不能拿封顶的 dEdge 比对 —— 那会把正在接近的球误判成正在远去,挥拍峰还没到就出手 */
  dRaw: number;
  bx: number; by: number;   // 记账帧的球位(结算弹道从这里起)
  bpx: number; bpy: number; // 记账帧的球上一帧位(渲染插值/拍头扫掠用)
  swingT: number;   // 记账帧的挥拍相位(时机教学按它算早/晚)
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
  /** 跳杀:空中 + 击球点够高触发的必然扣杀(飘字/专属特效读它) */
  jumpSmash?: boolean;
  /**
   * 闪现顶点天雷:接触点 ≥ C.skills.flash.apexHeight 的闪现扣杀(飘字/升档演出读它)。
   * 威力部分(求解后速度乘算)不在此曝光 —— shot.vx/vy 本身已带,表现层只认档位。
   */
  flashApex?: boolean;
  /**
   * 这一拍由「自动击打(辅助模式)」替玩家起手。表现层只有两处读它:量化时机条与「早了/晚了」
   * —— 那两样教的是"你按得准不准",而机器挑的就是时机环教人的那一帧,张张满分,留着只是噪声。
   * 球种/档位飘字、怒气、统计**一律不看来路**(用户口径「不打折」:代劳的是时机,不是判定)。
   */
  autoHit?: boolean;
  /**
   * 带符号时机档(只给真人,恒上报):0 = 踩在窗口正中,负 = 偏早,正 = 偏晚,
   * 绝对值 = 距正中占半窗的比例。量化时机条与「早了/晚了」共用这一个数。
   */
  timingGrade?: number;
  /** 时机教学:命中了但不甜时提示该往哪边调(只给真人) */
  timingHint?: "early" | "late";
  /** 瞄准档位:挥拍时提交的落点瞄准("deep"=深球压底线 / "near"=短球放网 / "mid"=不指定);
   *  命中确认飘字用(表现层判断真人后区分轻重提示) */
  aim?: string;
  /** 触发的专属技能类型(用于飘字、音效、专属特效) */
  skillKind?: SkillId;
  /**
   * 「怒气重击」兑现那一刻释放的怒气比例(0..1)。**只在这一拍是怒气重击时非空。**
   * 多管蓄力后语义:存量至少一整管时恒快照 1(那一拍吃的是整管,强度顶格);
   * 只有零头小释放(<一管)才快照零头的比例。
   * 为什么要把一个已经扣掉的东西抄进结果里:怒气在兑现当帧就扣掉了,而表现层(game-root 的
   * drain)跑在事件排空时,那时读 p.rage 已经是扣完的值 ⇒ 四档演出全被打成最低档。
   * 档位不在这里重复存一份:表现层用 Skills.rageTierOf(rageRatio) 现推 —— 两个数迟早会分叉。
   */
  rageRatio?: number;
  /** 闯关挑战模式:居合一闪拔刀斩 */
  iaiStrike?: boolean;
  /** 出手瞬间人在腾空(三星判据「空中击球占比」的分子口径) */
  airborne?: boolean;
  /** 出手瞬间处于极滑滑行状态(三星判据「滑行击球得分」的口径) */
  sliding?: boolean;
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

/**
 * 引导演示的一步(分步定格讲解)。**固定四条**,与 render/drill-anim 的 `STEP_FRAME`
 * 一一对应:迎球 → 就位/起跳 → 击球定格 → 出球落点。
 * 写法纪律:每条都要落到「手指动作 + 这一关自己的门槛」,不许写六关通用的空话 ——
 * 「看完不知道怎么做」就是那套通用话造成的(旧 stageOfFrame 六关字面完全一样)。
 */
export interface DrillStep {
  /** 阶段名(卡上第一排,四字以内) */
  name: string;
  /** 这一步做什么(卡内正文,两行以内) */
  desc: string;
  /** 可选提醒:为什么这步容易做错(读不到就不显示) */
  note?: string;
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
  cue: string;
  points: string[];
  /** 引导演示的分步讲解(缺省 = 用 drill-anim 的通用四步,只为自测表兼容旧数据) */
  demoSteps?: DrillStep[];
  /** 目标落点区叫什么,画在场上那条带子上(缺省「目标得分区」) */
  zoneName?: string;
  pose: { style: SwingStyle; jump: boolean; cut?: number; lunge?: number; tight?: boolean; crouch?: boolean };
  // 这一关特有的客观量约束(球种窄带不够用时补)
  minDepth?: number; maxDepth?: number;
  minLandX?: number; maxLandX?: number;
  minSteps?: number; maxSteps?: number;
  minContact?: number; maxContact?: number;
}

/**
 * 新手操作教学的主题条目(表在 config.ts 的 TUTORIAL_TOPICS,照 DRILLS 先例文案进 config)。
 * 每个主题 = 一页「讲解(①②③)」+ 一页「实操」,阶段推进由 core/tutorial.ts 状态机管,
 * 这里只承载文案 —— 版式在 ui/tutorial-layout.ts、动画在 render/tutorial-anim.ts。
 */
export interface TutTopic {
  id: "move" | "hit" | "jump";
  /** 编号 chip 上的名字(1 移动 · 2 击球 · 3 起跳) */
  label: string;
  /** 讲解页右侧的编号行,正好三条(版式判据钉死) */
  lines: string[];
  /** 实操横幅的一句话目标 */
  practice: string;
  /** 实操横幅第二行的补充提示(怎么做) */
  hint: string;
}
