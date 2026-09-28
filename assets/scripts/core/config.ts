// ============================================================
// 全部平衡数值 / 键位 / 配色集中在这里 —— 想调手感只改这个文件
// 单位约定:1 step = 1/60 s;长度 px;速度 px/step;加速度 px/step²
// ============================================================
import { DiffKey, MenuEntry, SkinDef, SkinKind, DrillDef } from "./types";

// ===== 皮肤表(纯装饰):换颜色不改手感;每类第一项 price 0 = 默认拥有 =====
// 人物皮肤即现有 theme(main/dark/glow):球衣、短裤、发带、手臂全跟队色走
// unlockLevel = 等级门槛(到级才能买),升级即「商店上新」
// 每类按 price 升序排,商店格子按此顺序展示;价位顶到 880(普通难度 11-16 局),
// 是毕业级长线目标,等级 cap 20 还给后续上新留了空间
export const SKINS: Record<SkinKind, SkinDef[]> = {
  player: [
    { id: "p-red",   kind: "player", name: "经典红", price: 0,   main: "#ff4d4d", dark: "#a8202c", glow: "#ff8a6a" },
    { id: "p-orange",kind: "player", name: "活力橙", price: 120, main: "#ff8a3d", dark: "#b34710", glow: "#ffb37a" },
    { id: "p-mint",  kind: "player", name: "薄荷绿", price: 150, unlockLevel: 2, main: "#3ddc97", dark: "#0f7a4d", glow: "#8affc9" },
    { id: "p-navy",  kind: "player", name: "深海蓝", price: 180, unlockLevel: 2, main: "#3f6df0", dark: "#1c3480", glow: "#7ea2ff" },
    { id: "p-sakura",kind: "player", name: "樱花粉", price: 200, unlockLevel: 3, main: "#ff7bac", dark: "#b23368", glow: "#ffb3d1" },
    { id: "p-violet",kind: "player", name: "电光紫", price: 300, unlockLevel: 5, main: "#a86bff", dark: "#5b2fb8", glow: "#d0b0ff" },
    { id: "p-onyx",  kind: "player", name: "曜石黑", price: 350, unlockLevel: 4, main: "#3a4050", dark: "#15181f", glow: "#8e9bb8" },
    { id: "p-jade",  kind: "player", name: "孔雀青", price: 420, unlockLevel: 6, main: "#16b8a6", dark: "#0a5c52", glow: "#6ff0dd" },
    { id: "p-gold",  kind: "player", name: "冠军金", price: 500, unlockLevel: 7, main: "#ffd24d", dark: "#b8860b", glow: "#ffe9a0" },
    { id: "p-ice",   kind: "player", name: "冰川白", price: 680, unlockLevel: 9, main: "#e9f2ff", dark: "#8fa3c8", glow: "#ffffff" },
  ],
  // 拍框 frame 留空 = 跟随人物主题 glow 色(默认拍的现状)
  racket: [
    { id: "r-std",    kind: "racket", name: "标准拍", price: 0,   grip: "#20242f", shaft: "#efe7d8", frame: null },
    { id: "r-carbon", kind: "racket", name: "碳黑拍", price: 100, grip: "#0c0e14", shaft: "#4a5060", frame: "#cfd6e4" },
    { id: "r-jade",   kind: "racket", name: "翡翠拍", price: 150, unlockLevel: 2, grip: "#123324", shaft: "#b8f5d2", frame: "#2fe08a" },
    { id: "r-sunset", kind: "racket", name: "落日拍", price: 250, unlockLevel: 4, grip: "#7a2e18", shaft: "#ffb37a", frame: "#ff6a1f" },
    { id: "r-rose",   kind: "racket", name: "玫瑰金拍", price: 320, unlockLevel: 5, grip: "#4a2530", shaft: "#ffd9de", frame: "#ff9fb4" },
    { id: "r-aurora", kind: "racket", name: "极光拍", price: 450, unlockLevel: 6, grip: "#14274d", shaft: "#a5f3fc", frame: "#22d3ee" },
    { id: "r-mono",   kind: "racket", name: "月白拍", price: 600, unlockLevel: 8, grip: "#262b3a", shaft: "#f2f6ff", frame: "#d9e2ff" },
    { id: "r-inferno",kind: "racket", name: "熔岩拍", price: 880, unlockLevel: 11, grip: "#1c0c10", shaft: "#ff9a62", frame: "#ff3b30" },
  ],
  // 羽毛球是公共道具,全场生效;默认色带原本误读红方阵营色,这里顺手解耦成自己的值
  // 裙羽 skirt 一律浅色系:球是全场最小的道具,深色裙羽会在暗色球馆里丢辨识度
  shuttle: [
    { id: "s-std",    kind: "shuttle", name: "标准球", price: 0,   cap: "#f6f1e6", band: "#ff4d4d", skirt: "#fbfaf5", vein: "rgba(120,130,150,0.65)" },
    { id: "s-neon",   kind: "shuttle", name: "荧光球", price: 50,  cap: "#d8f34d", band: "#141a2e", skirt: "#f4ffd0", vein: "rgba(90,140,60,0.7)" },
    { id: "s-ice",    kind: "shuttle", name: "冰晶球", price: 120, unlockLevel: 2, cap: "#cfe9ff", band: "#2f7fff", skirt: "#eef6ff", vein: "rgba(90,130,200,0.7)" },
    { id: "s-sunset", kind: "shuttle", name: "彩霞球", price: 300, unlockLevel: 5, cap: "#ffd9a0", band: "#ff6a1f", skirt: "#ffe9ec", vein: "rgba(255,130,150,0.65)" },
    { id: "s-rose",   kind: "shuttle", name: "樱羽球", price: 380, unlockLevel: 5, cap: "#ffd8e6", band: "#ff4d94", skirt: "#fff0f5", vein: "rgba(230,110,160,0.65)" },
    { id: "s-jade",   kind: "shuttle", name: "翡翠羽", price: 550, unlockLevel: 7, cap: "#d4ffe9", band: "#0fae6e", skirt: "#ecfff5", vein: "rgba(60,180,120,0.7)" },
    { id: "s-gold",   kind: "shuttle", name: "鎏金羽", price: 600, unlockLevel: 8, cap: "#f2c14d", band: "#b8860b", skirt: "#ffe9a0", vein: "rgba(180,130,30,0.75)" },
    { id: "s-volt",   kind: "shuttle", name: "紫电球", price: 760, unlockLevel: 10, cap: "#e8d8ff", band: "#8b5cf6", skirt: "#f4eeff", vein: "rgba(160,120,240,0.7)" },
  ],
};

export const CFG = {
  // 手机版入口裁剪(决策②):先只保留「单人 vs CPU」与「训练场」两类入口;
  // 2p/2v2 的逻辑全部保留,只是菜单不暴露 —— 触屏双人四手挤一屏不现实。
  // 微信/原生端用 sys.platform 判定后再放宽,这里先按手机版收紧。
  mobileOnly: true,

  stage: { w: 992, h: 728 },
  world: { w: 960, h: 540 },

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
    speedMax: 27,      // 甜蜜点压平后要靠更快的初速够到同一落点
    sweetBoost: 2,     // 甜蜜点初速上限 +2:踩得准才许打得更凶
    perfectBoost: 3,   // 完美击球 +3(27+3=30 恰好是 shuttle.maxSpeed 物理上限)
    loftMinDeg: -24,
    loftMaxDeg: 79,
    solveIters: 14,    // 速度二分迭代次数
    netBumpDeg: 9,     // 下网后每次抬弧度
    netBumpTries: 5,
  },

  // 出射角锚点:[击球点离地高度, θ]。这张表就是「滞空时间表」——
  // 落点由求解器反解速度保证,所以想整体放慢或加快回球,改这里最直接。
  // 低球被迫挑高(约 70 帧,有时间回位),高球可以压平(约 25 帧,来不及反应)。
  loftByHeight: [
    [0, 74], [40, 66], [80, 46], [110, 30], [150, 16], [200, 0], [250, -12],
  ],
  aimLoftSwing: 0,     // 深浅不再耦合弧度:能不能过网有「最小可过网角」兜底
  aimLoftGate: [60, 180], // 击球高度低于 60 不给压平,高于 180 给满
  sweetLoftShift: 12,  // 甜蜜点比打偏少多少度弧度(更平更快)

  player: {
    // 100px 身高 vs 80px 网高:比真实比例(1.70/1.55)略夸张,换角色更醒目
    w: 42,
    h: 100,
    accel: 1.50,
    vmax: 8.6,
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
  },

  // 挥拍:windup → active(可命中) → recovery
  swing: {
    windup: 1,
    active: 14,        // 命中窗口 233ms
    recover: 5,
    whiffExtra: 4,     // 挥空的额外硬直(防无脑连打)
    buffer: 8,         // 提前按下的输入缓冲
    pivotY: -70,       // 挥拍支点(肩,相对脚底)
    radiusBase: 50,      // 拍头到肩的距离
    radiusSpeedGain: 0.8, // 来球越快允许越远够球
    radiusMax: 92,
    headR: 30,           // 并入判定区半径;命中判定见 Player.strikeZone
    zoneFullSpeed: 9,    // 来球速度 ≤ 此值给完整判定区
    zoneTightenSpan: 11, // 到 zoneFullSpeed+此值 收到最小
    zoneFastMul: 0.5,    // 快球判定区最小只剩这么多(重杀必须对上时机)
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
  sweet: {
    coreRatio: 0.34,   // 窗口中心 34% 算甜蜜
    powerBonus: 1.16,
    errBonus: 0.55,    // 非甜蜜点的落点误差倍率
    powerDeg: 5,       // 在 q 压平之外再压的弧度(度):逼 solver 用更快初速补同一落点
  },

  // 完美击球:甜蜜点正中心再收一档(窗口约 2 帧 ≈ 35ms),是天花板操作的专属回报:
  // 落点零误差(瞄哪打哪、绝不出界)+ 最高初速上限 + 最顶级的一整套反馈
  perfect: {
    coreRatio: 0.15,   // qRaw ≥ 0.85
    powerDeg: 9,       // 比甜蜜点更狠的压弧度
  },

  // 双打:两人同侧,空当判定阈值要按整场纵深算;进攻倾向也更高,否则回合打不完
  // aiZone = 双打时 CPU 判定区缩放。真人判定区很宽容(容易接到),
  // 双打一边两个人若也用同一套,双方都漏不掉球,回合能打到上百拍。
  doubles: { deepGuard: 132, aggrBonus: 0.24, aiZone: 0.78 },

  // 方向键即瞄准,取屏幕直觉:朝网按 = 落点往对面推(深球),背网按 = 落点收在网前(短球)
  aimDepth: { near: 0.12, mid: 0.5, deep: 0.92 },

  // 落点误差(px):打不准才会下网/出界
  aimErr: {
    base: 26,
    moving: 22,        // 跑动中
    airborne: 30,      // 空中
    edge: 34,          // 命中框边缘
    sweetReduce: 0.42, // 甜蜜点时误差 ×0.42
  },

  scoring: {
    winScore: 11,
    pointPause: 78,    // 得分停顿帧
    servePause: 26,
    matchPointSlowmo: 0.34,
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
    hitstopNormal: 2,
    hitstopSweet: 5,        // 约 0.08 秒(5帧),微幅定格制造绝佳打击顿挫感
    hitstopSmash: 7,
    hitstopSweetSmash: 9,   // 甜蜜点扣杀终极定格快感
    hitstopPerfect: 7,      // 完美击球(非扣杀):比甜蜜点更重的顿挫
    hitstopPerfectSmash: 11,// 完美重扣:全游戏最高定格
    shakeNormal: 2,
    shakeSweet: 6,          // 甜蜜点清脆利落震屏
    shakeSmash: 12,
    shakeSweetSmash: 15,
    shakePerfect: 9,
    shakePerfectSmash: 18,
    punchSmash: 1.055,      // 扣杀镜头冲击:整块世界向击球点推近(只放大不缩小,不露边)
    punchPerfectSmash: 1.09,
    punchDecay: 0.85,       // 镜头每帧保留的超出量比例(指数回弹到 1)
    slowmoFrames: 16,       // 赛点重锤慢动作时长:模拟帧数,真实时长 = 帧数/timeScale
    shakeLand: 4,
    shakeLandSmash: 7,
    trailLen: 18,
    trailSweetLen: 24,      // 甜蜜点霓虹残影寿命
    markerLife: 70,

    // --- 打击感 Juice 扩展 ---
    // 一、Sweet/Perfect 档相机 punch(填补中间档空缺)
    punchSweet: 1.025,        // 甜蜜点轻推镜头
    punchPerfect: 1.04,       // 完美击球(非扣杀)中等推近

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

    // C、拍头命中闪光
    racketFlashRadius: 16,    // 闪光半径
    racketFlashAlpha: 0.8,    // 闪光基础透明度

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

  // 键位表(桌面端按 e.code 绑定,跨布局稳定;每项可给多个候选)
  // 击球键自带落点:swingFar = 远球压底线,swingNear = 短球放网前。方向键只管移动。
  // 触屏端的虚拟按键在输入适配层映射到同一套语义,不另立第二张表
  keys: {
    p1: { left: ["KeyA"], right: ["KeyD"], jump: ["KeyW"], swingFar: ["KeyJ"], swingNear: ["KeyK"], lunge: ["KeyS"] },
    p2: {
      left: ["ArrowLeft"], right: ["ArrowRight"], jump: ["ArrowUp"],
      swingFar: ["Slash"], swingNear: ["Period"], lunge: ["ArrowDown"],
    },
    sys: {
      pause: ["Escape", "KeyP"], restart: ["KeyR"], back: ["KeyQ"],
      mute: ["KeyM"], music: ["KeyN"], confirm: ["Enter", "Space"],
      up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
      shop: ["KeyB"],    // 主菜单开生涯中心
      drills: ["KeyT"],  // 主菜单开训练场
    },
  },

  // 跨步救球:向前爆发一段距离,判定区扩大,结束后有恢复期
  lunge: {
    speed: 12,              // 跨步爆发速度(px/帧)
    duration: 14,           // 跨步持续帧数
    reachMul: 1.45,         // 判定区半径倍率
    recoveryFrames: 18,     // 恢复期帧数
    recoverySpeedMul: 0.35, // 恢复期速度倍率
  },

  // AI 拦截高度带:站立够球上限 / 跳起够球上限(px 离地)
  aiReach: { stand: 140, attack: 182, jump: 236 },

  // AI 难度:全部走同一套挥拍机制,只是时机更不准、反应更慢
  diffs: {
    easy:   { label: "简单", tick: 20, speed: 0.74, aimErr: 92, timingErr: 9, aggr: 0.12 },
    normal: { label: "普通", tick: 13, speed: 0.88, aimErr: 58, timingErr: 5, aggr: 0.48 },
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
};

export const MENU: MenuEntry[] = [
  { id: "2p",     label: "双人对战",   tag: "LOCAL VS",  desc: "同屏对打 · 各占键盘一半", mode: "2p", diff: null },
  { id: "1p-easy",   label: "单人 · 简单", tag: "EASY",   desc: "AI 反应慢、常打飞,适合热身", mode: "1p", diff: "easy" },
  { id: "1p-normal", label: "单人 · 普通", tag: "NORMAL", desc: "有来有回,会抓你的空当", mode: "1p", diff: "normal" },
  { id: "1p-hard",   label: "单人 · 困难", tag: "HARD",   desc: "跳起就扣杀,落点很刁", mode: "1p", diff: "hard" },
  { id: "2v2", label: "双打 · 两人组队",   tag: "CO-OP 2P", desc: "你 + 队友 打两个 CPU",       mode: "2v2", diff: "normal", humans: 2 },
  { id: "1v2", label: "双打 · 带电脑搭档", tag: "CO-OP 1P", desc: "你 + CPU 搭档 打两个 CPU",   mode: "2v2", diff: "normal", humans: 1 },
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
// (far=J 深球 / near=K 短球,只驱动引导文案与时机条)。这两个字段曾被混用成一回事,
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
    cue: "起跳,在最高点按 J",
    points: [
      "球要跳到高过网带才压得动 —— 站着够只能挑",
      "起跳后别急着按,等球落到头顶",
      "按 J 压深球;按 K 会收成网前点杀",
    ],
    pose: { style: "over", jump: true },
  },
  {
    id: "clear", label: "高远对拉", tag: "CLEAR", desc: "把球顶到对方底线",
    goal: 3, want: ["clear"], minLandX: 790,
    feed: { depth: 0.42, jumpLead: 11 },
    wantKey: "far",
    contactX: 262, demoH: 122,
    cue: "站定,举过头顶按 J",
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
    cue: "同样的高球,改按 K 收着打",
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
    cue: "球到网前低处,轻按 K",
    points: [
      "越贴网越低,只能向上送,不能压",
      "上网弓步,手要伸到球的前下方",
      "按 K 放短;按 J 会挑成高远球",
    ],
    pose: { style: "under", jump: false, lunge: 26 },
  },
  {
    id: "drive", label: "平抽快挡", tag: "DRIVE", desc: "中场快球又平又深地顶回去",
    goal: 3, want: ["drive", "slash"], maxSteps: 44, minDepth: 0.5,
    feed: { depth: 0.85, jumpLead: 14 },
    wantKey: "far",
    contactX: 380, demoH: 116,
    cue: "早出手,球还没落到头顶就按 J",
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
    cue: "等球落到脚下,晚一点按 K",
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
