// ============================================================
// 全部平衡数值 / 键位 / 配色集中在这里 —— 想调手感只改这个文件
// 单位约定:1 step = 1/60 s;长度 px;速度 px/step;加速度 px/step²
// ============================================================
import { DiffKey, MenuEntry, Rarity, SkinDef, SkinKind, DrillDef } from "./types";

// ===== 稀有度元数据:商店卡片框色/角标用;配色只进 config =====
export const RARITY_META: Record<Rarity, { name: string; color: string }> = {
  common:    { name: "经典", color: "#8a93a8" },
  rare:      { name: "稀有", color: "#3ea6ff" },
  epic:      { name: "史诗", color: "#b06bff" },
  legendary: { name: "传说", color: "#ffb020" },
};

// ===== 皮肤表(纯装饰):换颜色不改手感;每类第一项 price 0 = 默认拥有 =====
// 人物皮肤即现有 theme(main/dark/glow):球衣、短裤、发带、手臂全跟队色走
// 设计款(rarity != common)带发型/头饰/纹样/专属特效字段;纯色款统一 88 金币无门槛
// 排列约定:每类默认款在前,其余按 price 升序;商店 UI 会把设计款提到纯色款前面展示
// 本表整体降价重构后,原高价纯色款下架,已购玩家按 SKIN_REFUNDS 自动退款(见 career.ts)
export const SKINS: Record<SkinKind, SkinDef[]> = {
  player: [
    { id: "p-red",     kind: "player", name: "经典红",   price: 0, main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a" },
    { id: "p-orange",  kind: "player", name: "活力橙",   price: 88, rarity: "common", main: "#ff8a3d", dark: "#b34710", glow: "#ffb37a" },
    { id: "p-navy",    kind: "player", name: "深海蓝",   price: 88, rarity: "common", main: "#3f6df0", dark: "#1c3480", glow: "#7ea2ff" },
    { id: "p-sakura",  kind: "player", name: "樱花粉",   price: 88, rarity: "common", main: "#ff7bac", dark: "#b23368", glow: "#ffb3d1" },
    { id: "p-flame",   kind: "player", name: "烈焰少年", price: 158, rarity: "rare",
      main: "#ff5a2e", dark: "#8c2417", glow: "#ffb36b",
      hairStyle: "spiky", hairColor: "#ff6a1f", jersey: "sash" },
    { id: "p-shinobi", kind: "player", name: "影忍",     price: 178, rarity: "rare",
      main: "#2a3d66", dark: "#141c33", glow: "#7e9bd8",
      hairStyle: "bun", hairColor: "#1a1a22", headwear: "bandana" },
    { id: "p-blossom", kind: "player", name: "樱花少女", price: 288, unlockLevel: 3, rarity: "epic",
      main: "#ff8fb8", dark: "#a34368", glow: "#ffc9dc",
      hairStyle: "twin", hairColor: "#ff9fc0", headwear: "ribbon", jersey: "trim" },
    { id: "p-cyber",   kind: "player", name: "赛博骇客", price: 328, unlockLevel: 4, rarity: "epic",
      main: "#19d3a2", dark: "#0d3b3f", glow: "#7dffe0",
      hairStyle: "mohawk", hairColor: "#3dffa8", headwear: "goggles", jersey: "stripes" },
    { id: "p-king",    kind: "player", name: "球场之王", price: 888, unlockLevel: 8, rarity: "legendary",
      main: "#f5f2e6", dark: "#8a6a1c", glow: "#ffd24d",
      hairStyle: "bun", hairColor: "#3a2e20", headwear: "crown", jersey: "twoTone", aura: "gold" },
  ],
  // 拍框 frame 留空 = 跟随人物主题 glow 色(默认拍的现状)
  racket: [
    { id: "r-std",     kind: "racket", name: "标准拍", price: 0, grip: "#20242f", shaft: "#efe7d8", frame: null },
    { id: "r-carbon",  kind: "racket", name: "碳黑拍", price: 88, rarity: "common", grip: "#0c0e14", shaft: "#4a5060", frame: "#cfd6e4" },
    { id: "r-jade",    kind: "racket", name: "翡翠拍", price: 88, rarity: "common", grip: "#123324", shaft: "#b8f5d2", frame: "#2fe08a" },
    { id: "r-rose",    kind: "racket", name: "玫瑰金拍", price: 88, rarity: "common", grip: "#4a2530", shaft: "#ffd9de", frame: "#ff9fb4" },
    { id: "r-star",    kind: "racket", name: "星辉拍", price: 148, rarity: "rare",
      grip: "#1c2233", shaft: "#ffd76a", frame: "#ffe9a8", stringColor: "#fff3c4", decal: "star" },
    { id: "r-ember",   kind: "racket", name: "炽焰拍", price: 288, unlockLevel: 4, rarity: "epic",
      grip: "#1c0c10", shaft: "#ff9a62", frame: "#ff4d26", decal: "flame", swingFx: "fire" },
    { id: "r-frost",   kind: "racket", name: "冰晶拍", price: 318, unlockLevel: 5, rarity: "epic",
      grip: "#0e2740", shaft: "#bfe9ff", frame: "#7ecbff", decal: "crystal", swingFx: "ice" },
    { id: "r-rainbow", kind: "racket", name: "虹光拍", price: 688, unlockLevel: 7, rarity: "legendary",
      grip: "#141024", shaft: "#d9c9ff", frame: "#8f7bff", stringColor: "#ffd9f0", swingFx: "rainbow" },
  ],
  // 羽毛球是公共道具,全场生效;默认色带原本误读红方阵营色,这里顺手解耦成自己的值
  // 裙羽 skirt 一律浅色系:球是全场最小的道具,深色裙羽会在暗色球馆里丢辨识度
  shuttle: [
    { id: "s-std",     kind: "shuttle", name: "标准球", price: 0, cap: "#f6f1e6", band: "#ff4d4d", skirt: "#fbfaf5", vein: "rgba(120,130,150,0.65)" },
    { id: "s-neon",    kind: "shuttle", name: "荧光球", price: 88, rarity: "common", cap: "#d8f34d", band: "#141a2e", skirt: "#f4ffd0", vein: "rgba(90,140,60,0.7)" },
    { id: "s-ice",     kind: "shuttle", name: "冰晶球", price: 88, rarity: "common", cap: "#cfe9ff", band: "#2f7fff", skirt: "#eef6ff", vein: "rgba(90,130,200,0.7)" },
    { id: "s-rose",    kind: "shuttle", name: "樱羽球", price: 88, rarity: "common", cap: "#ffd8e6", band: "#ff4d94", skirt: "#fff0f5", vein: "rgba(230,110,160,0.65)" },
    { id: "s-comet",   kind: "shuttle", name: "彗星羽", price: 148, rarity: "rare",
      cap: "#e8f4ff", band: "#2f7fff", skirt: "#f4faff", vein: "rgba(90,130,200,0.7)", trailStyle: "star" },
    { id: "s-phoenix", kind: "shuttle", name: "凤凰羽", price: 328, unlockLevel: 5, rarity: "epic",
      cap: "#ffd9a0", band: "#ff4d26", skirt: "#ffe9d8", vein: "rgba(255,120,60,0.72)", trailStyle: "flame" },
    { id: "s-petal",   kind: "shuttle", name: "花语羽", price: 358, unlockLevel: 5, rarity: "epic",
      cap: "#ffd8e6", band: "#ff4d94", skirt: "#fff0f5", vein: "rgba(230,110,160,0.66)", trailStyle: "petal" },
    { id: "s-galaxy",  kind: "shuttle", name: "星河羽", price: 788, unlockLevel: 9, rarity: "legendary",
      cap: "#e0d4ff", band: "#8b5cf6", skirt: "#f4eeff", vein: "rgba(160,120,240,0.72)", trailStyle: "rainbow" },
  ],
};

// ===== 下架皮肤退款表:本轮商店重构中被设计款替代的纯色款(id → 当年售价) =====
// career.profile() 归一化存档时,owned 里命中此表的 id 会被移除并按原价退币(幂等)
export const SKIN_REFUNDS: Record<string, number> = {
  "p-mint": 150, "p-violet": 300, "p-onyx": 350, "p-jade": 420, "p-gold": 500, "p-ice": 680,
  "r-sunset": 250, "r-aurora": 450, "r-mono": 600, "r-inferno": 880,
  "s-sunset": 300, "s-jade": 550, "s-gold": 600, "s-volt": 760,
};

export const CFG = {
  // 手机版入口裁剪(决策②):先只保留「单人 vs CPU」与「训练场」两类入口;
  // 2p/2v2 的逻辑全部保留,只是菜单不暴露 —— 触屏双人四手挤一屏不现实。
  // 微信/原生端用 sys.platform 判定后再放宽,这里先按手机版收紧。
  mobileOnly: true,

  stage: { w: 992, h: 728 },
  world: { w: 960, h: 540 },

  // 视图布局:世界整体上移,地面线从屏幕 y=-200 抬到 -150,底部让出约 120px 给虚拟按键,
  // 避免按键遮挡人物击球区域(偏移在 world.ts 应用,court.ts 据此补底边覆盖)
  view: { offsetY: 50 },

  sim: {
    step: 1 / 60,      // 固定步长,与显示器刷新率无关
    maxSteps: 4,       // 单帧最多补几步(切后台回来不追帧)
  },

  // 面板态:这些状态下主循环不推进世界(只跑渲染和面板自己的动画)。
  // 原先这个集合在四处各抄了一份字面量(主循环推进守卫 / Rules.step / Rules.pause /
  // togglePause),加一个训练面板态就要同时改四处,漏任何一处都会出鬼事:
  // 漏推进守卫 → 面板背后球在偷偷飞;漏 pause → 按 Esc 把 prevState 写成 DRILLS。
  // 现在统一读这张表,加状态只改一行。
  frozen: ["MENU", "PAUSED", "OVER", "CAREER", "DRILLS", "DRILLDONE"],

  // 「逛面板」的态:和 frozen 不同 —— frozen 问的是「要不要推进世界」,这张表问的是
  // 「玩家是在挑东西还是在打球」。PAUSED 在世界侧是冻结的,但音乐要保持比赛氛围;
  // OVER 有专属终局 jingle。两张表语义不同,所以分开写,不合成一张。
  screens: ["MENU", "CAREER", "DRILLS", "DRILLDONE"],

  court: {
    groundY: 470,
    netX: 480,
    netTopY: 390,      // 网顶;网高 = 470-390 = 80(角色 64 高,比例接近真实)
    netHalfW: 5,       // 碰撞带半宽
    left: 90,          // 底线(界内左)
    right: 870,        // 底线(界内右)
    shortServeL: 372,  // 前发球线
    shortServeR: 588,
    wallL: 44,         // 球员可达边界(比底线更宽,允许救界外球)
    wallR: 916,
  },

  // 球馆主题皮肤列表
  courts: [
    {
      id: "arena",
      name: "黄昏馆",
      title: "黄昏球馆",
      sub: "COURT 01 · DUSK ARENA",
      tag: "室内专业",
      desc: "工业钢架与阶梯看台，温暖聚光灯下的专业赛场",
      accent: "#ffe14d",
    },
    {
      id: "beach",
      name: "海滩场",
      title: "阳光海滩",
      sub: "COURT 02 · SUNNY BEACH",
      tag: "露天沙滩",
      desc: "海风微拂、椰林与浪花翻滚的热带度假沙滩",
      accent: "#38bdf8",
    },
    {
      id: "cyber",
      name: "赛博场",
      title: "赛博霓虹",
      sub: "COURT 03 · CYBER NEON",
      tag: "霓虹暗夜",
      desc: "摩天大楼数码矩阵与激光扫描的未来都市夜市",
      accent: "#f43f5e",
    },
    {
      id: "dojo",
      name: "竹林道场",
      title: "竹林道场",
      sub: "COURT 04 · BAMBOO DOJO",
      tag: "和风古韵",
      desc: "青岚水墨竹林、和纸灯笼与草编榻榻米",
      accent: "#4ade80",
    },
  ],

  shuttle: {
    // 数值由 tools/tune.js 反解得到:7 类球(高远/平抽/重杀/点杀/搓网/挑高/发球)
    // 都能在「落点 + 滞空帧数」双约束下解出可行解,且落地角 ≈ 62°(先平后坠)
    gravity: 0.46,
    dragK: 0.0011,
    dragMin: 0.5,      // 单步阻尼下限,防反向
    maxSpeed: 30,      // 硬上限(配合扫掠碰撞,不会穿网)
    radius: 7,
  },

  // 弹道反解:θ 控弧度(过网),speed 控落点(深度)
  shot: {
    nearOffset: 22,    // depth=0 → 落点贴网 22px(网前小球要真的能打死人)
    farOffset: 368,    // depth=1 → 落点距网 368px(约 848,贴着底线)
    speedMin: 4,
    speedMax: 25,      // 甜蜜点压平后要靠更快的初速够到同一落点
    sweetBoost: 2,     // 甜蜜点初速上限 +2:踩得准才许打得更凶
    perfectBoost: 3,   // 完美击球 +3(25+3=28;距 shuttle.maxSpeed 的差额留给热度加成)
    loftMinDeg: -24,
    loftMaxDeg: 79,
    solveIters: 14,    // 速度二分迭代次数
    // 求解器的「能过网」判定余量(px):球心过网时必须比网带高出这么多。
    // 二分解出来的是临界角,不夹余量就正好贴着网带擦过去 —— 轻击擦网的主因(实测 39% 的短球余量 <5px)。
    // 7 = 球半径(视觉上球头刚碰网带),取 10 让球真正越过网带。
    netClearMargin: 10,
    // 找安全过网角时的角度网格步长(度):单调性不成立,只能沿网格扫(见 physics.safeAngle)
    angleProbeDeg: 8,
    // 落点根本没有安全解时(后场低球搓贴网球 = 物理禁手),每步把落点往对方场内收这么多,
    // 收到有解为止;代价是球更高更慢,而不是白送一分。
    pullTargetDepth: 0.07,
    pullTargetTries: 8,
    netBumpDeg: 9,     // 下网后每次抬弧度
    netBumpTries: 5,
  },

  // 出射角锚点:[击球点离地高度, θ]。这张表就是「滞空时间表」——
  // 落点由求解器反解速度保证,所以想整体放慢或加快回球,改这里最直接。
  // 低球被迫挑高(约 70 帧,有时间回位),高球可以压平(约 30 帧,还来得及反应)。
  // 想放慢只抬 h≥80 段(快球才是来不及反应的来源);低段别动 —— 低点球已够慢,
  // 再抬弧只会让低点深球够不着底线(speedMax cap 下防守深度会崩,实测 798→696)。
  loftByHeight: [
    [0, 74], [40, 66], [80, 52], [110, 36], [150, 22], [200, 6], [250, -6],
  ],
  aimLoftSwing: 0,     // 深浅不再耦合弧度:能不能过网有「最小可过网角」兜底
  aimLoftGate: [60, 180], // 击球高度低于 60 不给压平,高于 180 给满
  sweetLoftShift: 9,   // 甜蜜点比打偏少多少度弧度(更平更快)

  player: {
    // 100px 身高 vs 80px 网高:比真实比例(1.70/1.55)略夸张,换角色更醒目
    w: 42,
    h: 100,
    accel: 1.60,
    vmax: 9.2,
    groundFriction: 0.78,
    airAccelMul: 0.60,
    airFriction: 0.985,
    gravity: 0.52,
    jumpV: -9.8,
    jumpCut: 0.50,     // 提前松键截断上升
    coyote: 6,
    jumpBuffer: 8,
    jumpApex: 19,      // 到达跳跃最高点约需 19 帧(起跳时机预判用)
    landSquash: 0.72,
    jumpStretch: 1.16,
    runPhaseK: 0.06,     // 步频相位随水平位移累积(rad/px):慢走小碎步、冲刺大步频
    footstepSpeed: 5.5,  // 落脚扬尘的速度门槛(低于此值的碎步不扬尘)
    kneeBendMax: 8,      // 跑步膝盖弯曲最大水平偏移(px):小腿向后折的最大幅度
  },

  // 挥拍:windup → active(可命中) → recovery
  swing: {
    windup: 1,
    active: 16,        // 命中窗口 267ms
    recover: 5,
    whiffExtra: 4,     // 挥空的额外硬直(防无脑连打)
    buffer: 10,        // 提前按下的输入缓冲
    pivotY: -70,       // 挥拍支点(肩,相对脚底)
    radiusBase: 55,      // 拍头到肩的距离
    radiusSpeedGain: 0.8, // 来球越快允许越远够球
    radiusMax: 98,
    headR: 30,           // 并入判定区半径;命中判定见 Player.strikeZone
    zoneFullSpeed: 11,   // 来球速度 ≤ 此值给完整判定区
    zoneTightenSpan: 11, // 到 zoneFullSpeed+此值 收到最小
    zoneFastMul: 0.62,   // 快球判定区最小只剩这么多(重杀必须对上时机)
    recoverSpeedMul: 0.45, // recovery 期限速,挥拍是有代价的承诺
    recoverBrake: 0.6,     // 期限速的刹车感:每步衰减「超出上限部分」的比例,替代一帧硬切
    recoverAccelMul: 0.5,  // 挥拍中持续按键的加速打折,配合刹车让稳速收敛在上限附近
    blendIn: 3,          // 起拍:待机姿势 → 挥拍弧线的混合帧数(纯视觉,判定窗不动)
    blendOut: 6,         // 收拍:弧线终点 → 待机回摆的混合帧数
    wristOvershoot: 7,   // 随挥段腕部过冲角(度):判定窗关闭后甩腕,零手感风险
    swingBurst: [0.12, 0.72], // 挥拍节奏:发力时间窗(引拍缓起 → 窗内匀速爆发 → 随挥缓收)
    doubleHitLock: 12, // 同一个人连续击球的最短间隔(帧)
  },

  // 甜蜜点:命中时刻在 active 窗口中的位置
  // coreRatio 换算成手感 = ±(active/2 × coreRatio) 帧的起手容错(见 Player.qualityAt):
  // 0.34 → ±2.7 帧(咬中间 6 帧,偏紧);0.50 → ±4 帧(咬中间 9 帧,约 133ms)
  sweet: {
    coreRatio: 0.50,   // 窗口中心 50% 算甜蜜
    powerBonus: 1.16,
    errBonus: 0.55,    // 非甜蜜点的落点误差倍率
    powerDeg: 5,       // 在 q 压平之外再压的弧度(度):逼 solver 用更快初速补同一落点
  },

  // 完美击球:甜蜜点正中心再收一档(窗口约 2.4 帧 ≈ 40ms),是天花板操作的专属回报:
  // 落点零误差(瞄哪打哪、绝不出界)+ 最高初速上限 + 最顶级的一整套反馈
  perfect: {
    coreRatio: 0.15,   // qRaw ≥ 0.85
    powerDeg: 9,       // 比甜蜜点更狠的压弧度
  },

  // ===== 连击热手:同一分内连续 sweet/perfect 累积热度 =====
  // 热度只在挥拍命中时增减(player.tryHit),beginPoint 清零;出球初速上限随热度放宽
  // ——「连续踩准 → 球越来越凶」,断一拍立刻冷回普通。加成与甜蜜/完美 boost 叠加,
  // 但总余量封在 shuttle.maxSpeed - shot.speedMax(物理上限,与 perfectBoost 同一预算)。
  heat: {
    speedBonus: 0.35,    // 每点热度给出的初速上限余量(px/step)
    speedBonusMax: 1.5,  // 热度加成封顶
    maxStreak: 8,        // 热度计数上限(防无限增长)
    fireAt: 3,           // 热度到此换「火热」球残影 + 飘字提示
  },

  // 双打:两人同侧,空当判定阈值要按整场纵深算;进攻倾向也更高,否则回合打不完
  // aiZone = 双打时 CPU 判定区缩放。真人判定区很宽容(容易接到),
  // 双打一边两个人若也用同一套,双方都漏不掉球,回合能打到上百拍。
  doubles: { deepGuard: 132, aggrBonus: 0.24, aiZone: 0.78 },

  // 落点跟着击球键走:深球键 = 落点往对面推(压底线),短球键 = 落点收在网前。
  // 方向键只管跑动,不参与瞄准。
  aimDepth: { near: 0.12, mid: 0.5, deep: 0.92 },

  // 落点误差(px):打不准才会下网/出界
  aimErr: {
    base: 20,
    moving: 16,        // 跑动中
    airborne: 24,      // 空中
    edge: 28,          // 命中框边缘
    sweetReduce: 0.42, // 甜蜜点时误差 ×0.42
  },

  scoring: {
    winScore: 11,
    pointPause: 78,    // 得分停顿帧
    servePause: 26,
    // 赛点重锤慢放的倍速。0.34 那种「几乎停住」在手机上读起来像掉帧而不是演出,
    // 而且训练场每一拍重扣都会走它(见 game-root 的 drill 放行),0.5 保住电影感又能操控。
    // 现状:fx.slowmoEnabled 已置 false,这个值和 slowmoFrames / scoreSlowmo 一起被总闸屏蔽,
    // 只在总闸打开时生效 —— 别把它当成能直接调的活旋钮。
    matchPointSlowmo: 0.5,
    deuceMinLead: 2,     // 平分后需领先此分数才获胜
    deuceCap: 0,         // 0=无上限;>0 时到此分数强制结束(如 15)
  },

  // ===== 发球:发球博弈(蓄力时长决定发球类型)=====
  // serveWait = 从 SERVE 开始到挥拍的帧数。短 = 偷后场平快,长 = 高远球压底线。
  // 原版 config.js 里 serve 定义了两次(promptBounce 段被博弈段整段覆盖,前者是死值,
  // 全仓库无一处引用),移植时合并成一段并保留全部字段,免得再出现「改了不生效」的假旋钮。
  serve: {
    promptBounce: 42,    // 发球提示弹跳(遗留字段,当前无引用,留作 HUD 备用)
    defaultDepth: 0.82,  // 发球默认落点深度(遗留字段,当前无引用)
    flickThresh: 22,     // < 此帧数 = 偷后场(flick):快速平球偷袭
    clearThresh: 65,     // > 此帧数 = 高远发球(clear):高弧线压底线
    flick: { q: 0.72, depthBias: 0.88, loftDelta: -6, speedMul: 1.15 },  // 快平、压深、略低弧
    clear: { q: 0.88, depthBias: 0.95, loftDelta: 4, speedMul: 0.92 },   // 高弧、压底线
  },

  // ===== 训练场:喂球节奏 / 达标与星级阈值 =====
  // 这里只放六关共用的旋钮;每关特有的球种与落点/滞空约束写在自己的 def 里
  // (那些是「这一关练什么」的一部分,不是全局手感),经济参数则在 career.drill
  drill: {
    pointPause: 40,      // 每球结束到重喂的停顿:比比赛 78 短得多,练功要的是密集重复
    settle: 16,          // 喂球机回到位后先站稳几帧再准备下一球(免得球飘着走)
    defaultGoal: 3,      // 一关默认要打出几拍有效球
    star: {
      sweetRatio: 0.66,  // ★2:有效拍里至少这个比例踩到甜蜜窗
      avgQ3: 0.78,       // ★3:达标且平均质量 ≥ 此值(还要有一记完美)
    },
    // 引导动画小画布:Cocos 版仍保留这个定义,引导页相机与画布只认这一处尺寸
    canvas: { w: 470, h: 300 },
  },

  fx: {
    // 慢动作总闸。false 时下列四组变速旋钮全部不生效:fx.slowmoFrames / fx.scoreSlowmo(Frames)、
    // scoring.matchPointSlowmo,以及主循环里赛点常驻的 0.9 微慢放 —— 世界恒速。
    // 用户反馈「重击卡住不好操控」后决定整条慢放关掉,只保留 hitstop 顿帧本身;
    // 想恢复赛点演出,把这里改回 true 即可,其余接线都还在。
    slowmoEnabled: false,
    // 完美重扣即时回放总闸。false 时彻底不播:主循环既不再每步写快照(replay.push),
    // 也不再排队触发(replayDelay),于是 RALLY 期间不产生「每步 new 一个快照 + map 全体球员」
    // 的分配,全屏 replayBlocker 也永不打开。
    // 关它的理由不是性能而是操控:回放段 Rules.step 整段不跑(BUF_SIZE=90 → 1.5 秒),
    // 且 blocker 刻意垫在虚拟按键之下,玩家本能狂按跳/深球/短球时一个都不响应,
    // 只有点屏幕空白才跳得过 —— 用户判定「回放太影响体验了」,整条关掉。
    // 完美重扣的奖励感改由飘字/白闪/震屏/触觉承担;想恢复复述镜头把这里改回 true。
    replayEnabled: false,
    // hitstop 定格帧数 = 真实帧数(主循环在定格段不乘慢放系数),换算 ms ≈ 帧数 × 16.7。
    // 顶档压在 7 帧:够读出「啪」的一下,又不会把手指按下去的那段时间整段吃掉。
    hitstopCap: 7,          // 定格帧总闸:任何来源(六档/发球/擦网/挥空)都不许超过
    hitstopNormal: 2,
    hitstopSweet: 4,        // 约 0.07 秒,微幅定格制造绝佳打击顿挫感
    hitstopSmash: 5,
    hitstopSweetSmash: 6,   // 甜蜜点扣杀的重顿挫
    hitstopPerfect: 5,      // 完美击球(非扣杀):与甜蜜点扣杀同档但白闪/震屏更重
    hitstopPerfectSmash: 7, // 完美重扣:全游戏最高定格
    shakeNormal: 2,
    shakeSweet: 6,          // 甜蜜点清脆利落震屏
    shakeSmash: 12,
    shakeSweetSmash: 15,
    shakePerfect: 9,
    shakePerfectSmash: 18,
    punchSmash: 1.055,      // 扣杀镜头冲击:整块世界向击球点推近(只放大不缩小,不露边)
    punchPerfectSmash: 1.09,
    punchDecay: 0.85,       // 镜头每帧保留的超出量比例(指数回弹到 1)
    slowmoFrames: 10,       // 赛点重锤慢动作时长:模拟帧数,真实时长 = 帧数/timeScale
    shakeLand: 4,
    shakeLandSmash: 7,
    trailLen: 18,
    trailSweetLen: 24,      // 甜蜜点霓虹残影寿命
    markerLife: 70,

    // --- 打击感 Juice 扩展 ---
    // 一、Sweet/Perfect 档相机 punch(填补中间档空缺)
    punchSweet: 1.025,        // 甜蜜点轻推镜头
    punchPerfect: 1.04,       // 完美击球(非扣杀)中等推近

    // 五、击球白闪(全屏白光一闪即逝,老 fx.js hit 六档 flash 值)
    flashNormal: 0.35,        // 普通高质量击球(q ≥ 0.86)
    flashSweet: 0.42,
    flashSmash: 0.55,
    flashSweetSmash: 0.65,    // 黄金重扣
    flashPerfect: 0.8,        // 完美击球/完美重扣共用顶档
    flashDecay: 0.82,         // 白闪每模拟步衰减系数(老 fx.js flash *= 0.82)

    // 四、Whiff 挥空相机反馈
    shakeWhiff: 1.5,          // 挥空微抖:扑空的轻微颤感
    hitstopWhiff: 1,          // 挥空 1 帧微顿

    // 二、方向性击球火花
    sparkFanCount: 12,        // 扇形火花粒子数
    sparkFanSpread: 0.8,      // 扇形半角(弧度)
    sparkFanSpeed: 18,        // 火花初速

    // 三、球体接触瞬间形变
    ballSquashNormal: 0.75,   // 普通击球压扁比
    ballSquashSweet: 0.65,    // 甜蜜点压扁比
    ballSquashSmash: 0.55,    // 扣杀压扁比(最扁)
    ballSquashRecovery: 0.15, // 每帧恢复速率(approach step)

    // 五、Smash 落地冲击波
    shockwaveMaxR: 80,        // 主波最大半径
    shockwaveSpeed: 5.5,      // 主波扩张速度
    shockwaveLife: 18,        // 主波寿命(帧)

    // 六、挥拍弧光残影
    swingArcTrail: 4,         // 残影持续帧数
    swingArcAlpha: 0.35,      // 残影基础透明度

    // A、扣杀速度线
    speedLineCount: 30,       // 速度线条数
    speedLineLife: 8,         // 速度线寿命(帧)

    // B、击球身体后仰
    recoilSmash: 6,           // 扣杀后仰角度(度)
    recoilNormal: 3,          // 普通击球后仰角度(度)
    recoilDecay: 0.12,        // 后仰恢复速率
    landSquashSmash: 0.62,    // 扣杀落地压扁比(普通落地 0.72,扣杀更深蹲)

    // C、拍头命中闪光
    racketFlashRadius: 16,    // 闪光半径
    racketFlashAlpha: 0.8,    // 闪光基础透明度

    // --- 击打爽感补强:补平普通档反馈 / 场景差异化 ---
    punchNormal: 1.012,       // 普通击球(q≥0.5)的镜头微推:对拉不再干瘪
    flashNormalAt: 0.86,      // 普通档白闪的质量阈值(原硬编码 0.86 参数化)
    flashNormalLowAt: 0.6,    // 次档微闪的质量下限
    flashNormalLow: 0.18,     // 次档微闪强度(高质量球不闪、踩得还行微闪)
    punchServe: 1.02,         // 发球镜头微推
    flashServeFlick: 0.2,     // 偷后场发球白闪
    shakeLandSmashVert: 5,    // 扣杀落地纵向震动(落地冲击以垂直分量为主)
    scoreSlowmoFrames: 10,    // 扣杀得分庆祝短慢放时长(模拟帧)
    scoreSlowmo: 0.45,        // 扣杀得分庆祝短慢放时间缩放

    // D、球种标签(非高级标签时一闪即逝的类型提示)
    shotLabelDrive:  { text: "平抽", color: "#d4e8ff", size: 13, life: 28 },
    shotLabelLob:    { text: "挑高", color: "#b8f0c8", size: 13, life: 28 },
    shotLabelSlash:  { text: "劈吊", color: "#ffd48a", size: 13, life: 28 },
    shotLabelClear:  { text: "高远", color: "#c0d8ff", size: 13, life: 28 },
  },

  // BGM:原版是 WebAudio 现场合成的自适应背景音乐(零音频文件);
  // Cocos 版计划离线烘焙成音频文件后由 AudioSource 播放,分层强度档位数值先原样保留
  bgm: {
    volume: 0.5,       // BGM 相对总线音量
    bpm: 132,
    accentVol: 0.5,    // 击球爬音阶音符的存在感
    rallyArp: 4,       // rally ≥ 此数叠琶音层
    rallyLead: 8,      // rally ≥ 此数叠主旋律层(整回合最燃)
  },

  colors: {
    // 阵营
    red: { main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a", name: "红方" },
    blue: { main: "#3ea8ff", dark: "#1c53a8", glow: "#7fd0ff", name: "蓝方" },
    // 扣杀金焰专属色
    smash: { glow: "#ffe14d", flame: "#ff6a1f", core: "#ffffff", dark: "#c73e00" },
    // 甜蜜点高能光效体系
    sweet: { gold: "#ffe14d", core: "#ffffff", neonCyan: "#00f0ff", neonPurple: "#d946ef", amber: "#ff9f1c" },
    // 球场
    floor: "#c8703a",
    floorDark: "#8f4a22",
    floorLight: "#e08a4c",
    line: "#fff3e0",
    sky: "#141a2e",
    accent: "#ffe14d",   // 荧光黄 —— 羽毛球/高亮
    ink: "#0a0d18",
  },

  // ===== 触屏虚拟按键视觉与手感(绘制在 input/touchpad.ts,数值只住这里) =====
  // 半透明玻璃底:亮场(海滩)上靠深底压得住,暗场靠白描边提得出形状
  padSkin: {
    idleFill: "#0e1428", idleFillA: 0.82,       // 静止底色(14,20,40/210)
    idleEdge: "#ffffff", idleEdgeA: 0.71,       // 静止描边(白/180)
    downFill: "#1e2848", downFillA: 0.86,       // 按下底色(提亮 30,40,72/220)
    downEdge: "#ffe14d", downEdgeA: 0.96,       // 按下描边 = 荧光黄,与 UI 主按钮同语言
    icon: "#ffffff", iconA: 0.9,                // 静止图标(230)
    downIcon: "#ffe14d", downIconA: 0.96,       // 按下图标(245)
    pressScale: 0.9,       // 按下缩放:比 UI 按钮 zoomScale 0.94 更狠一点(游戏键要「墩」)
    edgePad: 12,           // 圆心到屏边最小间隙:6 太贴边,拇指容易蹭到系统手势区
  },

  // 键位表(桌面端按 e.code 绑定,跨布局稳定;每项可给多个候选)
  // 击球键自带落点:swingFar = 远球压底线,swingNear = 短球放网前。
  // 移动只占用方向键,跨步是独立一键(lunge):方向由输入层按「最近的方向键」解出。
  // 旧的「双击方向键跨步」已删 —— 对拉时快速换向会稳定凑成双击,误触代价是一次带恢复期的爆发位移。
  // 触屏端的虚拟按键在输入适配层映射到同一套语义,不另立第二张表
  keys: {
    p1: { left: ["KeyA"], right: ["KeyD"], jump: ["KeyW"], lunge: ["KeyL"], swingFar: ["KeyJ"], swingNear: ["KeyK"] },
    p2: {
      left: ["ArrowLeft"], right: ["ArrowRight"], jump: ["ArrowUp"], lunge: ["Comma"],
      swingFar: ["Slash"], swingNear: ["Period"],
    },
    sys: {
      pause: ["Escape", "KeyP"], restart: ["KeyR"], back: ["KeyQ"],
      mute: ["KeyM"], music: ["KeyN"], confirm: ["Enter", "Space"],
      up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
      shop: ["KeyB"],    // 主菜单开生涯中心
      drills: ["KeyT"],  // 主菜单开训练场
    },
  },

  // 跨步救球:朝「最近的方向键」那一侧爆发一段距离,判定区扩大,结束后有恢复期
  lunge: {
    speed: 12,              // 跨步爆发速度(px/帧)
    duration: 14,           // 跨步持续帧数
    reachMul: 1.55,         // 判定区半径倍率
    recoveryFrames: 18,     // 恢复期帧数
    recoverySpeedMul: 0.35, // 恢复期速度倍率
  },

  // AI 拦截高度带:站立够球上限 / 跳起够球上限(px 离地)
  aiReach: { stand: 140, attack: 182, jump: 236 },

  // AI 难度:全部走同一套挥拍机制,只是时机更不准、反应更慢
  diffs: {
    easy:   { label: "简单", tick: 20, speed: 0.74, aimErr: 92, timingErr: 9, aggr: 0.12 },
    normal: { label: "普通", tick: 14, speed: 0.88, aimErr: 66, timingErr: 6, aggr: 0.40 },
    hard:   { label: "困难", tick: 8,  speed: 1.00, aimErr: 20, timingErr: 2, aggr: 0.58 },
  },

  // ===== 生涯成长:赛后奖励 / 等级 / 皮肤经济(纯数值,逻辑在 career.ts) =====
  // 只对带 CPU 的比赛发放(2p 同屏友谊赛不计,防两人互刷);输了也有安慰奖,保证商店始终有进度感
  career: {
    startCoins: 50,        // 新档见面礼:第一次进商店就能买一件便宜货
    // 基础奖励按 AI 难度查表;双打(打两个 CPU)再乘 doublesMul
    rewards: {
      easy:   { win: 30, lose: 8,  expWin: 22, expLose: 6 },
      normal: { win: 50, lose: 14, expWin: 36, expLose: 10 },
      hard:   { win: 90, lose: 22, expWin: 60, expLose: 16 },
    },
    doublesMul: 1.2,
    // 表现加成:赢得漂亮拿得更多,封顶防极端局刷爆
    bonus: {
      perSmash: 2, smashCap: 20,            // 每记扣杀 +2
      perSweet: 1, sweetCap: 10,            // 每个甜蜜点 +1
      longRallyMin: 10, longRallyCoin: 10,  // 最长回合 ≥10 拍的里程碑
      streakStep: 0.10, streakCap: 0.50,    // 连胜每场 +10%,封顶 +50%;输球清零
    },
    level: {
      cap: 20,
      expBase: 80, expStep: 45,     // 升到下一级所需经验 = expBase + (lv-1)*expStep(线性,好理解)
      coinBase: 20, coinStep: 10,   // 升级金币奖励 = coinBase + lv*coinStep(越往后越值钱)
    },
    // 训练场奖励:只有「首次通关」那一次发钱,之后重打只刷星级 —— 训练可以无限重开,
    // 按次发钱等于开了个无上限的印钞机。数值刻意压在「打赢几场」的量级,
    // 六关全三星 ≈ 5 场 normal 胜利的金币、只占 1→20 级所需经验的 3%,不取代比赛
    drill: {
      firstClear: { coin: 15, exp: 10 },  // 通关底奖
      perStar: { coin: 10, exp: 12 },      // 每颗星再加一份(三星关 = 45 币 / 46 经验)
    },
  },

  // 皮肤表(见文件顶部的 SKINS):挂在 CFG 树上,沿用「手感与经济之外的一切数据都在 CFG」的心智
  skins: SKINS,
  // 稀有度元数据(名称/徽章色),商店卡片渲染用
  rarity: RARITY_META,
  // 下架皮肤退款表,career.profile() 归一化存档时消费
  refunds: SKIN_REFUNDS,
};

export const MENU: MenuEntry[] = [
  { id: "2p",     label: "双人对战",   tag: "LOCAL VS",  desc: "同屏对打 · 各占键盘一半", mode: "2p", diff: null },
  { id: "1p-easy",   label: "单人 · 简单", tag: "EASY",   desc: "AI 反应慢、常打飞,适合热身", mode: "1p", diff: "easy" },
  { id: "1p-normal", label: "单人 · 普通", tag: "NORMAL", desc: "有来有回,会抓你的空当", mode: "1p", diff: "normal" },
  { id: "1p-hard",   label: "单人 · 困难", tag: "HARD",   desc: "跳起就扣杀,落点很刁", mode: "1p", diff: "hard" },
  { id: "2v2", label: "双打 · 两人组队",   tag: "CO-OP 2P", desc: "你 + 队友 打两个 AI",       mode: "2v2", diff: "normal", humans: 2 },
  { id: "1v2", label: "双打 · 带AI搭档", tag: "CO-OP 1P", desc: "你 + AI 搭档 打两个 AI",   mode: "2v2", diff: "normal", humans: 1 },
];

// ============================================================
// 训练场关卡表
// 每关 = 一种球种专项:对面只喂球不还击,打出 goal 拍「有效球」即通关。
//
// 「有效」的判据全部声明在这张表里,由 Drill.matches 统一执行:
//   want       —— Physics.classify 的球种(数组 = 任一即可),不自造第二套球种判定
//   minDepth/maxDepth、minLandX/maxLandX、minSteps/maxSteps、minContact/maxContact
//     —— 约束这一拍的瞄准深度 / 落点 / 滞空 / 接触点离地高度
//   为什么要这么多约束:classify 的 drive 只占 6° 出射角窄带,而且踩得越准(压平)
//   反而越容易跳进 slash 带 —— 单靠球种判据做不出能稳定练成的平抽关,必须补客观量。
//
// feed.depth / feed.jumpLead 不是手拍的:由 tools/drill-check --pick 在
// (depth × jumpLead) 网格上穷举「本关判据能达成的接触点占比」挑出来的。
// 注意分工:feed.* 只描述喂球机(落点多深、第几帧放球),wantKey 才是要求**玩家**按的键
// (far=「深球」/ near=「短球」,只驱动引导文案与时机条)。这两个字段曾被混用成一回事,
// 结果游戏里喂出的球和标定结果完全不符 —— 名字拆开就是为了不再踩第二次。
// 改了 shuttle / loftByHeight / classify 之后跑训练场校验脚本会告诉你哪关串味了。
// ============================================================
// demoH / contactX 只服务引导动画:演示用的接触点高度与横向位置,
// 决定引导里那条理想弹道从哪儿起、画成什么弧度(和游戏判据无关)
export const DRILLS: DrillDef[] = [
  {
    id: "smash", label: "后场重杀", tag: "SMASH", desc: "跳起来把球压下去",
    goal: 3, want: ["smash"],
    feed: { depth: 0.70, jumpLead: 0 },
    wantKey: "far",
    contactX: 300, demoH: 150,
    cue: "起跳,在最高点按「深球」",
    points: [
      "球要跳到高过网带才压得动 —— 站着够只能挑",
      "起跳后别急着按,等球落到头顶",
      "「深球」压得下去;「短球」会收成网前点杀",
    ],
    pose: { style: "over", jump: true },
  },
  {
    id: "clear", label: "高远对拉", tag: "CLEAR", desc: "把球顶到对方底线",
    goal: 3, want: ["clear"], minLandX: 790,
    feed: { depth: 0.42, jumpLead: 11 },
    wantKey: "far",
    contactX: 262, demoH: 122,
    cue: "站定,举过头顶按「深球」",
    points: [
      "高远球是防守的根:球要又高又深,才换得到回位时间",
      "击球点举过头顶,身体正对球网",
      "落点要压过对方后场横线,浅了不算一拍",
    ],
    pose: { style: "over", jump: false },
  },
  {
    id: "slash", label: "网前点杀", tag: "SLASH", desc: "高点球收力点到前场",
    goal: 3, want: ["slash"],
    feed: { depth: 0.70, jumpLead: 0 },
    wantKey: "near",
    contactX: 330, demoH: 132,
    cue: "同样的高球,改按「短球」收着打",
    points: [
      "和重杀同一个来球,只是收力:拍面立一点、不挥满",
      "腕部向前下压,球落在前场就赢",
      "这一关练的是「同一拍球能打出两种结果」",
    ],
    pose: { style: "over", jump: false, cut: 9 },
  },
  {
    id: "netshot", label: "网前搓放", tag: "NET", desc: "贴网低球搓近网短球",
    goal: 3, want: ["netshot"],
    feed: { depth: 0.42, jumpLead: 11 },
    wantKey: "near",
    contactX: 424, demoH: 72,
    cue: "球到网前低处,轻按「短球」",
    points: [
      "越贴网越低,只能向上送,不能压",
      "上网弓步,手要伸到球的前下方",
      "「短球」放得近;「深球」会挑成高远球",
    ],
    pose: { style: "under", jump: false, lunge: 26 },
  },
  {
    id: "drive", label: "平抽快挡", tag: "DRIVE", desc: "中场快球又平又深地顶回去",
    goal: 3, want: ["drive", "slash"], maxSteps: 44, minDepth: 0.5,
    feed: { depth: 0.85, jumpLead: 14 },
    wantKey: "far",
    contactX: 380, demoH: 116,
    cue: "早出手,球还没落到头顶就按「深球」",
    points: [
      "平抽拼的是出手早晚:等球落到肩高就只剩挑球",
      "拍面近乎水平向前送,不求高只求快",
      "球必须又快又深,浅浅一挡不算这一拍",
    ],
    pose: { style: "over", jump: false, tight: true },
  },
  {
    id: "lob", label: "低位挑高", tag: "LOB", desc: "贴地低球铲起来过渡",
    goal: 3, want: ["lob"],
    feed: { depth: 0.05, jumpLead: 8 },
    wantKey: "near",
    contactX: 402, demoH: 46,
    cue: "等球落到脚下,晚一点按「短球」",
    points: [
      "球已经贴地了,只能向上铲,别想着压",
      "出手要晚:让球落到拍面下方再抬",
      "挑得越高越深,才换得到退防时间",
    ],
    pose: { style: "under", jump: false, lunge: 18, crouch: true },
  },
];

// 难度档位 key 的具名类型再导出,供 Rules/AI 的查表处使用(diffs 的 key 即权威定义)
export type { DiffKey };

// 当前平台的菜单入口(决策②):手机版砍掉双人同屏,桌面全量
export function menuForPlatform(): MenuEntry[] {
  if (!CFG.mobileOnly) return MENU;
  return MENU.filter((m) => m.mode === "1p");
}
