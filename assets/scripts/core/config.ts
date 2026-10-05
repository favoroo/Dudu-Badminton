// ============================================================
// 全部平衡数值 / 键位 / 配色集中在这里 —— 想调手感只改这个文件
// 单位约定:1 step = 1/60 s;长度 px;速度 px/step;加速度 px/step²
// ============================================================
import { DiffKey, MenuEntry, Rarity, SkinDef, SkinKind, ShotKind, DrillDef, AiSmashDefenseDef, AiTier, ServeMixTier, SkillId, TutTopic } from "./types";

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
    // --- 首批「整套人物形象」新档:走 CharacterDef 管线(体型档/默认脸面/新特征注册表) ---
    { id: "p-sprout",  kind: "player", name: "萌芽豆丁", price: 168, rarity: "rare",
      main: "#4fae5a", dark: "#1e5c31", glow: "#a8e6b0",
      hairStyle: "bob", hairColor: "#58b24d", jersey: "trim", body: "compact", face: "freckle" },
    { id: "p-cat",     kind: "player", name: "猫系少女", price: 328, unlockLevel: 5, rarity: "epic",
      main: "#b06bff", dark: "#4a2a80", glow: "#d8b8ff",
      hairStyle: "long", hairColor: "#c9a8ff", headwear: "catears", jersey: "sash", face: "cat" },
    { id: "p-sage",    kind: "player", name: "金羽宗师", price: 888, unlockLevel: 8, rarity: "legendary",
      main: "#e8e4f0", dark: "#4a4660", glow: "#b8c8e8",
      hairStyle: "bun", hairColor: "#d8dce8", jersey: "twoTone", aura: "ice", body: "tall", face: "sage" },
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
  // 脸面商品:face-auto(人物默认)= 免费默认款,肤色脸随人物形象走;
  // face-ink 转免费情怀款(老档人人已有);face-sun(阳光肤色 88)已被 face-auto
  // 取代而下架,已购玩家按 SKIN_REFUNDS 原价退款;新付费脸面 = 特征标记款。
  // 面部是真人 0 号专属穿戴位(CPU/P2 恒为墨面,敌我一眼分明);只换脸面配色,不碰任何判定
  face: [
    { id: "face-auto",    kind: "face", name: "人物默认", price: 0, faceStyle: "auto" },
    { id: "face-ink",     kind: "face", name: "经典墨面", price: 0, faceStyle: "ink" },
    { id: "face-freckle", kind: "face", name: "雀斑肤色", price: 88, rarity: "common", faceStyle: "freckle" },
    { id: "face-tear",    kind: "face", name: "泪痣肤色", price: 88, rarity: "common", faceStyle: "tear" },
    { id: "face-cat",     kind: "face", name: "猫系脸面", price: 168, rarity: "rare", faceStyle: "cat" },
  ],
};

// ===== 下架皮肤退款表:本轮商店重构中被设计款替代的纯色款(id → 当年售价) =====
// career.profile() 归一化存档时,owned 里命中此表的 id 会被移除并按原价退币(幂等)
export const SKIN_REFUNDS: Record<string, number> = {
  "p-mint": 150, "p-violet": 300, "p-onyx": 350, "p-jade": 420, "p-gold": 500, "p-ice": 680,
  "r-sunset": 250, "r-aurora": 450, "r-mono": 600, "r-inferno": 880,
  "s-sunset": 300, "s-jade": 550, "s-gold": 600, "s-volt": 760,
  "face-sun": 88,   // 肤色脸转为人物默认款(免费)后下架,已购原价退
};

// ===== 脸面款式注册表(数据):faceStyle key → 脸底/描边/五官墨色/腮红/特征标记 =====
// 五官与特征的**笔画**在 sprites.drawHead;这里只放配色与开关(数值只进 config)。
// "ink" 墨面=黑色剪影+白五官(经典/CPU 默认);"skin" 系=肤色底+暖棕墨+心情腮红。
// mark 交给 sprites 的 FACE_MARKS 函数表渲染(雀斑/泪痣/猫须/白眉须)。
// hi = 头顶高光弧的透明度(墨面深底更淡、浅色脸稍亮才看得见)。
export const FACE_STYLES: Record<string, {
  base: string; line: string; ink: string; blush: boolean; hi: number; mark?: string;
}> = {
  ink:     { base: "#0a0e18", line: "rgba(235,240,255,0.5)", ink: "#ffffff", blush: false, hi: 0.15 },
  skin:    { base: "#f2c491", line: "rgba(10,13,24,0.55)", ink: "#4a2b16", blush: true, hi: 0.22 },
  freckle: { base: "#f6cd9d", line: "rgba(10,13,24,0.55)", ink: "#4a2b16", blush: true, hi: 0.22, mark: "freckle" },
  tear:    { base: "#f2c491", line: "rgba(10,13,24,0.55)", ink: "#4a2b16", blush: true, hi: 0.22, mark: "tear" },
  cat:     { base: "#f2c491", line: "rgba(10,13,24,0.55)", ink: "#4a2b16", blush: true, hi: 0.22, mark: "cat" },
  sage:    { base: "#eec39a", line: "rgba(10,13,24,0.55)", ink: "#3a2a18", blush: false, hi: 0.22, mark: "sage" },
};

// ===== 体型档(纯视觉):人物形象的整体微调 =====
// hip=髋高占身高比例(决定腿长与站姿),torso=躯干高比例,headMul=头半径倍率,
// limbMul=远臂/腿笔画粗细倍率。**挥拍肩点 pivotY 不参与**(判定锁定位),
// 所以体型档只改轮廓观感,零手感影响。人物形象在 SKINS.player[].body 里引用。
export const BODIES: Record<string, { hip: number; torso: number; headMul: number; limbMul: number }> = {
  standard: { hip: 0.34, torso: 0.38, headMul: 1.0,  limbMul: 1.0 },
  compact:  { hip: 0.31, torso: 0.41, headMul: 1.08, limbMul: 1.06 },
  tall:     { hip: 0.40, torso: 0.32, headMul: 0.90, limbMul: 0.96 },
};

/** 飘字文案档位(夸奖/技能/瞄准共用):plate 指定 P5 底板样式(缺省 = 无底板);
 * dy 为贴球小字的偏移(现在只剩瞄准确认在用),评价/技能字改挂场边锚点不再用 dy */
export interface FloatLabel {
  text: string;
  color: string;
  size: number;
  life: number;
  dy?: number;
  plate?: "slant" | "star" | "none";
}

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

  // ===== 渲染帧率上限:120Hz 高刷屏上旧版按设备刷新率裸跑,所有每帧重绘 ×2 =====
  // 逻辑本来就是固定 60Hz 步进,高刷只是重复画一模一样的帧;锁 60 直接把每帧开销
  // 减半,发热更小、更不容易触发温控降频(真机卡顿的隐形来源)。生效在 game-root.onLoad。
  perf: {
    frameRate: 60,
  },

  // ===== 球速档位(时间膨胀):玩家可改的唯一物理旋钮,生效逻辑在 core/pace.ts =====
  // s = 每帧位移相对量(<1 = 更慢)。pace.ts 的缩放是「重力 ×s²、速度类 ×s、阻力系数不动」,
  // 所以**空间轨迹逐点不变**(落点/弧度/过网余量都不动),只是滞空帧数 ÷s。
  // 因此下面 shuttle/shot 的数值仍然是「s=1 基准」的原值 —— 不要在它们身上乘档,
  // 更不要靠砍 shot.speedMax 来放慢(那会让低点深球够不到底线,实测 798→696→611)。
  // 存 id 不存索引:往表里插一档不会让老存档的索引指错。
  pace: {
    default: "standard",       // 出货默认 = 比上一版整体慢 8%(用户反馈手机接不到球)
    min: 0.5, max: 1.4,        // 运行时兜底夹取(手改存档 / 以后加档)
    // 表序必须从慢到快单调(settings-check 有断言):设置页那根滑杆按下标定位,反了会拖反方向。
    // 已有五档的 id 与系数**别改**:玩家存档存的是 id,改系数等于改了人家设好的档。
    // 两头各留了两档"试验档":越靠边, Euler 离散的落点漂移越大(xfast 1.16 档实测 mean 1.6px /
    // max 15.3px,extreme 0.60 档 mean 1.7 / max 13.8),mean 才是牙齿 —— 缩放方式一错就漂到 12px 量级。
    // 再往外扩先看 tools/reach-check.ts §1 的数,别为了"更慢"直接把档砍到飞。
    tiers: [
      { id: "extreme",  s: 0.60, label: "极慢", note: "慢 40%:滞空 ×1.67,基本打不死人,当试验档" },
      { id: "xslow",    s: 0.70, label: "超慢", note: "慢 30%:很从容,回合会明显变长" },
      { id: "vslow",    s: 0.80, label: "很慢", note: "慢 20%:回合变长,已经很好接" },
      { id: "slow",     s: 0.86, label: "偏慢", note: "慢 14%:再给一拍反应时间" },
      { id: "standard", s: 0.92, label: "标准", note: "慢 8%:比上一版好接,落点一点没变" },
      { id: "fast",     s: 1.00, label: "原速", note: "上一版的节奏,一点没放慢" },
      { id: "vfast",    s: 1.08, label: "偏快", note: "快 8%:手感熟到想再压一档" },
      { id: "xfast",    s: 1.16, label: "很快", note: "快 16%:比上一版还凶,练反应用" },
    ],
  },

  // ===== 人物移速档位(真人侧):第二个手感旋钮,生效逻辑在 core/gait.ts =====
  // 球速档调的是「留给玩家几帧」,这一档调的是「这几帧里他能覆盖多少地面」——
  // 两摊账互相补偿,所以分开给两个旋钮,别合成一根"难度"滑杆(那就读不出动了什么)。
  // 只乘 accel 与 vmax 这一对(起步和极速同比例,才是"步子大了");跨步冲量 lunge.speed、
  // 跳跃 jumpV/gravity、摩擦 groundFriction 都不跟着动,更不作用于 AI(AI 有 diffs.speed)。
  // 与 pace 的区别:gait 即时生效(移动速度不影响已在飞的球),不等下一球。
  gait: {
    default: "slow",          // 出货默认 = 偏慢一档(慢 15%):用户把滑杆停在这一档试过,顺手定成默认
    min: 0.6, max: 1.8,        // 运行时兜底夹取(手改存档 / 以后加档)
    // 表序必须从慢到快单调(settings-check 有断言):滑杆按下标定位,反了会拖反方向。
    // 表里六档系数一个没动(玩家存档存的 id 照样是原来那个速度);只是 default 挪到了 slow。
    // 代价要知道:面板那行百分比是**相对默认档**算的(gait.ts 的 labelOf),所以现在
    // 标准档会显示成「标准 · 快 18%」、极快「快 76%」—— 刻度没坏,只是零点挪了一格。
    tiers: [
      { id: "vslow",    s: 0.70, label: "很慢", note: "慢 30%:飘着走,当对照用" },
      { id: "slow",     s: 0.85, label: "偏慢", note: "慢 15%:出货默认档,手机-thumb 不容易过头" },
      { id: "standard", s: 1.00, label: "标准", note: "比默认档快 18%:上一版的出厂速度" },
      { id: "fast",     s: 1.15, label: "偏快", note: "快 15%:够得着更深的球" },
      { id: "vfast",    s: 1.30, label: "很快", note: "快 30%:半场基本两步到底" },
      { id: "xfast",    s: 1.50, label: "极快", note: "快 50%:再快就飘,先看 reach-check §5" },
    ],
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
    // 网前留白:两侧球员都不得进网这个距离内。player.ts 的夹取、AI 走位、滑轨的
    // 可达区间三处都要同一个数 —— 滑轨是按「人能站到哪」画刻度的,抄两份就会
    // 出现「轨的端点指向人到不了的位置」。
    netPad: 10,
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
    // 纵向手势的弧线意图(击球键上滑/下滑,阈值见 touchAim.commitPxY):
    // 上滑 = 弧线下托到不低于此角。取 58:高于 lobDeg(55),classify 里 lob 又排在
    // netshot 之前,所以「上滑必出挑高」与落点深浅无关;低于 loftByHeight 低段
    // (66~74),低点球天然更高时这一档不插手。上+右 = 挑高到后场(防守过渡)。
    // 下滑 = 弧线压平到不高于此角。取 12:高点击球自然落进扣杀/劈吊(下压),
    // 低点击球落进平抽;压得过低过不了网时由 safeAngle 自动抬回,不会自杀下网。
    loftUpMinDeg: 58,
    loftDownMaxDeg: 12,
    solveIters: 14,    // 速度二分迭代次数
    // 求解器的「能过网」判定余量(px):球心过网时必须比网带高出这么多。
    // 二分解出来的是临界角,不夹余量就正好贴着网带擦过去 —— 轻击擦网的主因(实测 39% 的短球余量 <5px)。
    // 7 = 球半径(视觉上球头刚碰网带),取 10 让球真正越过网带。
    netClearMargin: 10,
    // 近网过网自适应余量与角度(px / 度):
    // 普通中后场取 netClearMargin=10 保证不擦网;但在网前(离网 <= netCloseDist)时,
    // 10px 的死余量会导致低球几何仰角需求 >80°,从而直接判死刑挂网。
    // 近网处余量自适应收敛至 netCloseMargin(擦网放网/贴网翻滚),且仰角上限放宽至 loftMaxNearDeg。
    netCloseMargin: 2.5,
    netCloseDist: 30,
    loftMaxNearDeg: 85,
    // 找安全过网角时的角度网格步长(度):单调性不成立,只能沿网格扫(见 physics.safeAngle)
    angleProbeDeg: 8,
    // 落点根本没有安全解时(后场低球搓贴网球 = 物理禁手),每步把落点往对方场内收这么多,
    // 收到有解为止;代价是球更高更慢,而不是白送一分。
    pullTargetDepth: 0.07,
    pullTargetTries: 8,
    netBumpDeg: 9,     // 下网后每次抬弧度
    netBumpTries: 5,
  },

  // ===== 球种定性阈值(给飘字/音效/丝带档位/生涯奖励贴标签,不参与任何判定) =====
  // 原先这些数硬编码在 physics.classify 里(违反「数值只进 config」),搬过来。
  // 速度阈值是**基准单位**(s=1 的 px/step):classify 收到的是 pace.ts 折回基准后的速度,
  // 所以标签不随球速档位漂移 —— 慢档里同一记重杀仍叫「重杀」,不会念成「劈吊」。
  shotClass: {
    smashDeg: 15,      // 压角小于此 + 击球点够高 + 球够快 = 重杀
    smashH: 140,
    smashSpeed: 16,
    slashDeg: 22,      // 压角小于此 + 击球点次高 = 劈吊
    slashH: 92,
    lobDeg: 55,        // 挑得比这更高就是挑高/高远一类
    netDepth: 0.3,     // 落点深浅小于此 = 网前小球
    driveDeg: 28,      // 剩下的里再按角度分平抽与高远
  },

  // ===== 球种预告徽标(画在击球键上方,input/touchpad.ts)=====
  // previewKind(player.ts)按真实求解器预演这一拍,徽标把结果写在拇指上方:
  // 「这一拍大概率是扣杀/放网」不再靠碰。颜色与 game-root 的球种飘字同系。
  shotBadge: {
    size: 12,          // 徽标字号
    dyK: 1.38,         // 徽标圆心 = 击球键心上方 r × 此倍率(键外,不压图标)
    a: 0.95,           // 不透明度
    outline: "#07070d",// 深描边:亮场上白字/彩字都要先过这一层才读得出
    kinds: {
      smash:   { text: "扣杀", color: "#ff5500" },
      slash:   { text: "劈吊", color: "#ff9f1c" },
      lob:     { text: "挑高", color: "#8ef2a3" },
      netshot: { text: "放网", color: "#cfe0ff" },
      drive:   { text: "平抽", color: "#7dd3fc" },
      clear:   { text: "高远", color: "#c0d8ff" },
    } as Record<string, { text: string; color: string }>,
    // 这里**不再有**「· 自动」后缀:自动这个模式读数搬进了击球键的键名(config.autoHit.padLabel),
    // 常亮、且发球/死球时也看得见。徽标只负责一件事 —— 这一拍是什么球种,颜色也不许被模式洗掉。
  },

  // 出射角锚点:[击球点离地高度, θ]。这张表就是「滞空时间表」——
  // 落点由求解器反解速度保证,所以想改**某一类球**的快慢(只抬杀球、只抬高球)改这里。
  // 想整体放慢/加快别动这张表,走 config.pace 的球速档位:那套时间膨胀不改变落点,
  // 而这张表一动,不同球种的滞空比例就变了,训练场各关的达成率会跟着重排。
  // 低球被迫挑高(约 70 帧,有时间回位),高球可以压平(约 30 帧,还来得及反应)。
  // 低段别动 —— 低点球已够慢,再抬弧只会让低点深球够不着底线
  // (speedMax cap 下防守深度会崩,实测 798→696)。
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
    // 点跳门槛:按住不足这么多帧就松手,视作「点一下」,由输入层补一段 held 撑到顶点
    // (input/pad.ts release("jump"))。**取 jumpApex 是刻意的**:人类这一路推上去就跳满。
    // 定更小值会在边界上劈出台阶 —— jumpCut 是每帧砍半(不是一次),实测 tapCommit=5 时
    //   按 4 帧 → 87.5px,按 5 帧 → 45.3px
    // 多按 16ms 反而少跳一半;摇杆拇指「推上去停一下」会反复跨过这条线,跳高忽高忽低。
    // 代价是没有「短跳」这一档了 —— 但原本也只有刻意推住 5~18 帧才碰得到,而 1~4 帧
    // (真机上的绝大多数快点)只有 6px,从来就不是一个能用上的技能位。
    // 想恢复可变跳高就调小这里,但请先在 input-check 的高度单调断言上想清楚怎么不劈。
    // 只影响人类输入:AI 与喂球机直连 inp.jumpHeld(drill.ts 靠按到顶点喂高球),不受牵连。
    tapCommitFrames: 19,
    landSquash: 0.72,
    jumpStretch: 1.16,
    runPhaseK: 0.06,     // 步频相位随水平位移累积(rad/px):慢走小碎步、冲刺大步频
    footstepSpeed: 5.5,  // 落脚扬尘的速度门槛(低于此值的碎步不扬尘)
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
    blendIn: 3,          // 起拍:待机姿势 → 挥拍弧线的混合帧数(纯视觉,判定窗不动)
    blendOut: 6,         // 收拍:弧线终点 → 待机回摆的混合帧数
    wristOvershoot: 7,   // 随挥段腕部过冲角(度):判定窗关闭后甩腕,零手感风险
    swingBurst: [0.12, 0.72], // 挥拍节奏:发力时间窗(引拍缓起 → 窗内匀速爆发 → 随挥缓收)
    doubleHitLock: 12, // 同一个人连续击球的最短间隔(帧)
    // 收拍惯性回弹:回摆曲线由二次缓出换成 easeOutBack,末端拍子小幅甩过头再稳住
    // (follow-through 的弹簧感)。只作用在球拍姿势插值上,躯干/远臂的 recK 衰减不参与,
    // 免得 lean 反向过冲。1=无过冲,标准 easeOutBack 是 1.70158(≈10%),这里收着用
    recoverOvershoot: 1.2,
    // 网前抢点评判容差(px):真实羽毛球球头过网垂直面或网顶正上方即可击打。
    // 旧逻辑严卡 inOwnCourt(x < netX 严格),导致球到网口(x=480~485)时时机环亮起、
    // 玩家按了却被判挥空。低球放宽球头半宽(6px),高球(y<=netTopY)放宽抢网扑球容差(12px)
    netReachTolLow: 6,
    netReachTolHigh: 12,
    // 挥空踉跄:挥空的额外硬直(whiffExtra)期间躯干前冲角(度,sin 半波起落),
    // 配合远臂划大弧 —— 扑空要有失衡的代价感,而不是和打中一样从容收拍
    whiffStagger: 3.5,
  },

  // 来球预备架拍(纯视觉,零判定):球朝己方飞来且临近时,从待机向架拍姿势插值 ——
  // 拍头抬到肩前、屈膝降重心、远臂绷到肩后上方平衡。真实羽毛球接球者的「提前架拍」,
  // 也是动画的 anticipation 法则:预备在半路,起拍行程视觉上变短,3 帧 blendIn 更利落。
  // readyK 信号由渲染层按几何近似现算(不积分弹道、不写逻辑字段),AI/玩家通吃。
  // **挥拍中强制归零**:肩点 pivotY 是判定锁定位,降了就破坏「视觉拍头=扫掠判定」。
  readyStance: {
    horizonFrames: 32,   // 预计多少帧后到身边开始渐入架拍(0=刚开始抬,1=贴身)
    speedGain: 0.55,     // 来球越快预备越深:慢球(≤8)只做 55% 上下,快球做满
    dip: 4.5,            // 屈膝降重心:髋/躯干/肩/头整体下沉量(px);膝弯由腿部 IK 反解,沉降量即屈膝深度
    lean: 1.5,           // 躯干前倾增量(度)
    // 远臂(非持拍侧)两段绝对角 [上臂, 前臂](0=朝网,正=向上;与 air/lunge/celebrate 同一写法)。
    // 214/274 = 肘提到肩后上方、前臂垂住,手落在 (-21.3, -48.6):肘折 60°,手仍贴着髋段背缘
    // 只露 1.2 单位。**不是增量** —— 待机基准 228/266 若各减 38/42 会得到 190/224,前臂被
    // 甩成正后方、手离体 24 单位(= 这次要修的「尾巴」毛病又回来)。
    farArm: [214, 274],
  },

  // 挥拍下半身动力链(纯视觉):上半身拧转/挥臂/甩腕之外,腿也要参与 ——
  // over 高压球发力窗后腿蹬伸提跟,under 低球起拍先提跟蓄力、发力段蹬伸挑起。
  // **肩点/髋点是判定锁定位,蓄力只走「脚跟抬起」机制(poses.swingFootLift),
  // 不降髋**:屈膝的深蹲读感由脚位目标 + legIK 反解给出。
  // 幅度全部压在个位数 px,人物才 100px 高,过了就是抽风。
  swingLegs: {
    overDriveLift: 2.2,    // over 发力窗:后腿蹬伸、脚跟抬起的量(px)
    underCrouchKnee: 5,    // under 起拍段:双腿提跟蓄力(px,乘 0.55 折算成提跟量)
    underDriveLift: 2.5,   // under 发力段:蹬伸提跟(px)
  },

  // 动作系统(纯视觉):真关节骨架(rig.ts)的动作幅度旋钮。屈膝/下沉统一走
  // 「髋部下沉量」,膝弯由腿部 IK 几何反解 —— 沉降量就是屈膝深度,不再有
  // 第二套「膝盖偏移」数值。分腿垫步 = 对手击球瞬间(readyK 爬升沿)的
  // 双脚分踩,羽毛球步法的标志性起手,约 splitDur 帧收完。
  pose: {
    landDip: 5,          // 落地冲击髋部下沉量(px):膝自动深弯吸收,随 squash 恢复抬回
    splitDur: 12,        // 分腿垫步时长(帧)
    splitSpread: 6,      // 分腿垫步双脚错开量(px)
    splitDip: 3.5,       // 分腿垫步重心下沉量(px)
    runCarryBob: 1.6,    // 跑动携拍:拍随步频的上下轻颠(px)
    runCarrySway: 3,     // 跑动携拍:拍角随步伐的左右轻摆(度)
    // 躯干脊柱的采样步长(px):躯干沿这条脊柱切成若干段,髋不动、肩转体,中间连续过渡;
    // 底色/明暗/领口/下摆/球衣纹样都从同一条脊柱取点,所以覆盖物长在轮廓上、不会错位。
    // 旧写法是三块横移量不同的矩形,中间那块被肩段整个盖住(死代码),于是只剩 3px 搭接
    // 去扛 4.8px 的横移 → 挥拍时腰上看到一个台阶。步长越小斜边越顺,代价只是几个顶点。
    spineRowH: 4,
  },

  // 发球等待姿势(纯视觉,零判定):持球待发不再是笔直立正 —— 微屈膝坐重心、躯干
  // 微后倾蓄势,与挥拍期 underCrouchKnee→underDriveLift 串成「落位沉→折腿→蹬伸」
  // 的完整动力链。serveK 由渲染层现算(球飞回手时渐入、起拍后随挥拍进度融掉),
  // 球位/释放点(rules.handX/handY)不参与,发球弹道与手感零影响。
  serveHold: {
    dip: 3.5,      // 屈膝降重心:髋/躯干/肩整体下沉量(px);膝弯由腿部 IK 反解
    lean: 1.5,     // 躯干后倾增量(度,负向 lean = 重心后坐,发球预备的标准蓄势)
  },

  // 按拍预告(触屏反馈):球临近判定区心时击球两键渐亮,到最佳按拍帧闪一下金环。
  // rampFrames = 亮度 0→1→0 三角波的半宽(帧);horizonFrames = 预测积分的前瞻上限。
  // 最佳按拍帧由 swing 参数导出(player.PRESS_LEAD_FRAMES)。
  // 同一级辉光镜像到羽毛球本体(注意力在球上时按钮辉光看不见):
  // shuttleGlowR = 外晕基准半径(px);shuttleGlowMax = 峰值亮度上限;
  // 阈值 0.9 对应 |fc-pressAt| ≤ 1 帧(ramp 14 时约 3 帧 ≈ 50ms)的「就是现在」白环闪烁。
  //
  // 【按拍预告的锚点必须与判定锚点同为一个「判定区心」——这是踩过两层坑的】
  // 第一层:fc 曾经锚在「进入 0.5×半径的内缩小圆」(arriveRadius 0.5),而挥拍质量的结算
  //   锚在球过区心 —— 环收满时球离区心还有半半径+lead 帧的路,按环收满按 = 系统性早按,
  //   「明明按着光环来点,就是没触发」的现场 bug。
  // 第二层:把锚环缩到 0.04 也不行 —— 玩家有走位误差,坠落轨迹距区心差十几 px 是常态,
  //   小圆要求路径精确穿心,fc 直接恒为 null,预告整个失联(ai-check 替身一局挥不上 3 拍)。
  // 正解:fc = Physics.flightFramesToClosest 的「最近逼近帧」—— 对路径偏移鲁棒,
  //   倒数到 0 时球恰在离区心最近的那个帧;超出判定区半径的逼近(根本够不到)仍返回 null。
  // reactFrames = 人类反应补偿(≈150ms):「白闪=现在按」对人是陷阱,看到再按必晚 9~15 帧;
  // 预告把这段反应时间算进去 —— 环收满瞬间白闪,玩家自然反应按下,挥拍质量峰恰好对准球过心。
  swingCue: { rampFrames: 14, horizonFrames: 56, shuttleGlowR: 20, shuttleGlowMax: 0.9, reactFrames: 10 },

  // ===== 落点预测提示(数值只住这里,画在 render/hud-overlay.ts)=====
  // 原实现是压在地面亮线上的一只 15×5.5 细圈,亮度还在 0.18~0.42 之间慢呼吸 ——
  // 金色压在球馆那条暖白地面线上、橙色压在沙滩的金沙上,亮底对亮色等于没画。
  // 现在拆成六层,每层各解决一个「看不见」的成因:
  //   ① backing 暗衬底 —— 不靠「颜色够亮」取胜,先垫出一块暗底,四套主题一律有对比;
  //   ② spot 地贴光斑 —— 同心叠层近似径向渐变(Graphics 没有渐变);
  //   ③ ring 收缩准星环 —— 只留一道,亮度按 sin 两端 ease(见下方「安静档」说明);
  //   ④ 主圈双描边 —— 主题色外描 + 白芯内描,任何底色都读得出轮廓;
  //   ⑤ beam 落点列光 —— 盯着球的时候不用移开视线就能读出落点 x;
  //   ⑥ chevron 下箭头 —— 把「就在这里」指到线上一格。
  // 【安静档】显眼这件事已经全部交给尺寸 + 暗衬底 + 白芯双描边,不靠动效撑:
  //   主圈/光斑/箭头一律恒定亮度(原 0.16rad/帧的呼吸涨落删掉),准星环从 2 道错峰减到
  //   1 道、周期 34→50 帧、峰值 0.9→0.5,且透明度用 sin(π·ph) 两端 ease ——
  //   原来环收到最亮(0.9)那一帧突然跳回 0.1 消失,那个 pop 才是「一直在闪」。
  //   临落只剩环速 50→34 帧与列光微抬这两处缓变,不再有周期性明暗脉动。
  // 落在真人守的那一侧给满档(该动手了),纯 AI 一侧(自己刚打出去的球)收一档不抢戏;
  // 预计出界/撞网的球反过来压暗放慢 —— 这类球不该让人冲过去。
  landing: {
    rx: 30, ry: 9,              // 普通球光斑半径(原 15×5.5 的约两倍)
    smashRx: 36, smashRy: 11,   // 扣杀档:又大又红,一眼分清是不是该跳
    outRx: 26, outRy: 8,        // 预计出界档(收着画)
    backing: 1.2,               // 暗衬底半径 = 光斑半径 × 此倍率
    backingA: 0.45,             // 暗衬底不透明度(纯黑压深)
    spotA: 0.26,                // 光斑中心不透明度(恒定,不再随呼吸涨落)
    glowLayers: 3,              // 光斑同心层数
    rings: 1,                   // 同屏准星环数量(2 道错峰实测就是「一直闪」的元凶)
    ringFrom: 2.2,              // 准星环起始半径 = rx × 此倍率
    ringPeriodSlow: 50,         // 一个收缩循环的帧数(球还远)
    ringPeriodFast: 34,         // 临落时的帧数(只稍微催一点,不再压到 15)
    ringA: 0.5,                 // 准星环峰值不透明度(出现在收到一半那一刻)
    ringW: 2,                   // 准星环线宽(恒定;原先随收缩加粗也在制造 punch)
    beamH: 168, beamW: 22,      // 列光:从地面线往上多高、底部多宽
    beamA: 0.22,                // 列光底部不透明度(向上三段渐隐)
    urgentFrames: 45,           // 距落地 ≤ 此帧数算「快到了」(只抬列光与环速,不再改亮度)

    // 意图对照:风/颤抖关里「你瞄的点」与「球真落点」不是一回事,过去落点圈画的是前者
    // (b.shot.landX 是反解出的意图,不含侧风),于是提示自己在骗人。现在圈画真落点,
    // 另用一枚暗十字标注意图,中间拉一根箭头 —— 一眼看见「风把这拍搬走了多少」。
    driftArrowMin: 14,      // 漂移小于这个像素数就不画对照(免得静风关多出两个噪点)
    driftArrowW: 5,         // 箭头粗头宽(尖端收在真落点)
    intentCrossLen: 13,     // 意图十字臂长
    intentCrossW: 2.2,      // 意图十字臂宽
    intentCrossAlpha: 0.42, // 意图十字透明度(比真落点圈低一档:让真的那层喊话)

    // 轨迹预测虚线:把「这一拍会走哪条弧」提前画出来,读球不用靠猜。
    // 刻意压得比地面标识低一档(半透明 + 冷白,不抢金/橙的落点圈),
    // 且沿弧长分三段向落点方向淡出 —— 起点跟着球走,末端交给落点圈去喊。
    pathHorizon: 90,            // 前瞻帧数上限( loftByHeight 那张表里最滞空的一档约 70 帧,留余量)
    // 低重力关的弧按 1/√gravityMul 变长:反重力 0.22 档实测要 ≈149 帧才看到落点,
    // 只按上面那个固定值会**静默截断** —— 弧画到一半收笔、落点圈干脆不出现,玩家以为没这功能。
    // 上限也顺带放开(dashBuf 得跟着加长,否则虚线段自己先满)。
    pathHorizonMax: 240,
    pathA: 0.30,                // 靠球那端的不透明度
    pathW: 2.2,                 // 线宽
    dashOn: 7, dashOff: 9,      // 虚线段长 / 间隔(px);间隔略大于段长 = 更透气
    pathFade: [1, 0.66, 0.4],   // 沿弧长三等分的透明度衰减
  },

  // 甜蜜点:命中时刻在 active 窗口中的位置
  // coreRatio 换算成手感 = ±(active/2 × coreRatio) 帧的起手容错(见 Player.qualityAt):
  // 0.55 → ±4.4 帧(咬中间 9 帧,约 147ms)。原 0.50 的甜蜜窗实测偏「碰运气」——
  // 特殊击球重做的方向是「成因可见、可主动复现」,容错先放宽一档。
  sweet: {
    coreRatio: 0.55,   // 窗口中心 55% 算甜蜜
    powerBonus: 1.16,
    errBonus: 0.55,    // 非甜蜜点的落点误差倍率
    powerDeg: 5,       // 在 q 压平之外再压的弧度(度):逼 solver 用更快初速补同一落点
  },

  // 完美击球:甜蜜点正中心再收一档(0.30 → 约 4.8 帧 ≈ 80ms),是天花板操作的专属回报:
  // 落点零误差(瞄哪打哪、绝不出界)+ 最高初速上限 + 最顶级的一整套反馈。
  // 原 0.15(约 2.4 帧 ≈ 40ms)的手感是「完美从来不是打出来的,是撞出来的」。
  perfect: {
    coreRatio: 0.30,   // qRaw ≥ 0.70
    powerDeg: 9,       // 比甜蜜点更狠的压弧度
  },

  // ===== 跳杀:空中 + 击球点够高 = 必然扣杀 =====
  // 旧规则里扣不扣杀由 classify 按角度/速度反推,玩家只能「碰」出来;现在成因前置:
  // 起跳 + 高球(离地 ≥ minHeight)直接定性为扣杀并给力度加成 —— 「跳起来打高球 = 杀球」
  // 这条直觉规则对真人与 AI 同样生效。闪现扣杀(空中折跃)天然走同一通道。
  jumpSmash: {
    minHeight: 140,    // 击球点离地至少此高(px,与 shotClass.smashH 同源)才触发;对齐 aiReach.stand(起跳带起点),且高于站立触球上限≈132 —— 站地拍永远不算跳杀(用户两次反馈:很矮的球也触发重扣)
    speedBoost: 2.5,   // 初速加成(px/step,与 sweet/perfect boost 同预算,封顶在 maxSpeed 差额)
    powerDeg: 6,       // 额外压弧度(度)
    maxLoftDeg: 8,     // 强制压弧上限:跳杀不允许挑高,弧度先夹到这里再进求解器
  },

  // ===== 时机环(画在球上,渲染层 render/hud-overlay.ts)=====
  // 按拍预告的「球上版」:按钮辉光在拇指底下,盯球的玩家看不见 —— 收缩环直接长在球上。
  // 环从 fromMul×球半径 收到贴球,收满白闪 = 建议按拍点(fc ≤ PRESS_LEAD_FRAMES +
  // swingCue.reactFrames:峰值锚定球心 + 人类反应补偿);按晚一点由挥拍峰值追踪兜成甜蜜。
  // (判定区心的「甜区圈」已按用户要求移除:判定区随人走,圈不出新信息。)
  timingRing: {
    spanFrames: 22,     // 收缩行程帧数:fc 从 span+按拍点 收到贴球(与 swingCue.horizonFrames 对齐,全程有环)
    fromMul: 5.2,       // 起始半径 = 球半径 × 此倍率
    ringW: 2.6,         // 环线宽
    a: 0.85,            // 环峰值不透明度
    lockA: 0.95,        // 贴球(fc ≤ 按拍点)白闪环不透明度
    lockW: 3.4,         // 贴球白闪环线宽
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
    // 热手火苗刻度(画在 render/hud-overlay.ts 左上角):heat < fireAt 不画,
    // 点火后按 heat 数亮格 —— 「离火力全开还差几格」一眼可读
    gauge: {
      x: 26, y: 44,      // 左上角锚点(世界坐标,左上为原点向下)
      cellW: 13,         // 单格火苗宽
      cellH: 18,         // 单格火苗高
      gap: 4,            // 格间距
      litA: 0.92,        // 已点燃格不透明度
      emberA: 0.3,       // 未点燃槽位余烬不透明度(总槽位数 = max(heat, fireAt))
    },
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
    flyToHandFrames: 12, // 得分后球从落点飞入手中动画帧数(60fps)
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

  // ===== AI 发球:先抽**类型**,再从该类型的蓄力带里抽帧数 =====
  // 从前是反过来写的:`serveDelay = 40 + rand*50` 抽一个延迟,类型由 rules 拿延迟反查
  // (flick<22、clear>65)。默认带 [40,90] **正好跨在 65 上** —— 于是入门档约一半的
  // "标准发球"实际执行成高飘高远球(球在空中多待一倍时间,等玩家摆好姿势来扣),
  // 而 flick 概率 0.15×aggr=1.8%、clear 分支要求 aggr>0.3 永远进不去。
  // 玩家现场看到的「他发球我就得分了」就是这一条。现在意图与执行构造上不可能错档:
  // 三条带互不相交、且都落在 flickThresh/clearThresh 划好的格子里。
  serveMix: {
    /** 蓄力带(帧):standard 带上界 58 < clearThresh 65、下界 30 > flickThresh 22 */
    bands: { flick: [8, 20], standard: [30, 58], clear: [70, 100] },
    easy:   { flick: 0.04, clear: 0.34, vsBackCamper: 0.24, vsNetRusher: 0.12 },
    normal: { flick: 0.16, clear: 0.36, vsBackCamper: 0.50, vsNetRusher: 0.22 },
    hard:   { flick: 0.26, clear: 0.30, vsBackCamper: 0.62, vsNetRusher: 0.34 },
    expert: { flick: 0.34, clear: 0.28, vsBackCamper: 0.72, vsNetRusher: 0.42 },
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
    // 引导动画小画布:引导页相机与画布只认这一处尺寸。
    // 0.0.21 从 470×300 抬到 560×316 —— 引导页改版成「放大演示 + 分步卡」,
    // 而分步讲解要往场上标字(落点区名/滑向/击球高度),图太小那些字就没地方摆。
    canvas: { w: 560, h: 294 },
    // ===== 引导演示的**真值烘焙**参数(core/drill-demo.ts 唯一读处) =====
    // 演示里那颗球的来路/接点/回路与落点,全从这里定义的搜法在真实判据下搜出来 ——
    // 以前是动画自己编一条假抛物线 + 手拍一个 q,教的动作和游戏判的那拍不是一回事。
    demo: {
      q: 0.9,            // 标定质量:≈甜蜜窗上沿,演示画的是「踩准了的那一拍」而不是勉强一档
      // 挑接触点先看「合不合这一关的手」:上手球(over)从高接触点里挑,下手球(under)从低处挑。
      // 少了这一条,高远关会选中弧线上最低的可达点 —— 判据过了,画的却是「弯腰捞球的高远球」。
      preferredShare: 0.55, // 只在最合手的那批接触点里搜这个比例
      standLead: 0.35,   // 球让到判定区圆心前方这么成的水平余量:迎前击球,而不是站球正下方
      zonePad: 12,       // 落点带离边线/网带的留白,压着画会糊成一条线
      zoneSpread: 46,    // 这一关没写显式落点门槛时,以真实落点为中心开 ±此宽
      fallbackNear: 0.3, // 还没烘焙时(实机 HUD 首帧)短球带中心的相对位置
      fallbackFar: 0.72, // 同上,深球
      arcDash: { on: 6, off: 5 },  // 虚线弧疏密:引导页与场上预告同一条尺
      // 演示节拍(帧 @60Hz):来球/出球两段用烘焙出来的**真实帧数**,这三段是演出用的。
      beats: {
        wind: 12,        // 引拍:从「球到眼前」到「触球」
        freeze: 12,      // 触球定格(爆点与「就在这一点打」都在这段里读)
        settle: 16,      // 落点波纹走完、假人收拍
        runShare: 0.42,  // 来球段的后这么多比例用来跑位(全程站着不动看不出「要跑」)
        minIn: 14, minOut: 14, maxPhase: 90,   // 两段真实帧数的兜底夹取(异常喂球不至于卡住)
      },
    },
  },

  // ===== 新手操作教学(滑轨):门控阈值 + 喂球 + 演示节拍 =====
  // 逻辑在 core/tutorial.ts(照 drill.ts 骨架:世界推进仍交给 Rules.step),
  // 版式在 ui/tutorial-layout.ts、动画在 render/tutorial-anim.ts,这里只放数值真话。
  // 门控阈值全是「第一颗球就该成功」的宽限值 —— 教学是教会,不是考试。
  tutorial: {
    pointPause: 46,        // 每球结束到重喂的停顿(比训练场 40 略长,留出读提示的时间)
    settle: 16,            // 喂球机回位后先站稳几帧再放球(与训练场同源)
    // —— 实操门控 ——
    moveTargetX: 120,      // 「把人拖进圈」的目标点(世界坐标:左半场后场;必须离出生点 homeX=270 远,站着不动不许算过)
    moveEps: 30,           // 目标圈半径:圈画多大,人就多宽容
    dwellFrames: 24,       // 在圈内连续停稳多少帧算完成(≈0.4s,防止拖过去路过就算)
    hitGoal: 2,            // 击球实操要打回几拍有效球
    // —— 喂球(击球实操专用):不跳、低手抛,出来的是慢而高的好接球 ——
    feed: { depth: 0.5, jumpLead: 0 },
    // —— 三段手势演示的节拍(render/tutorial-anim 唯一读处,帧 @60Hz)——
    // 位置与弹道是**真值**:滑轨 1:1 对位 railGeo 的可达区间;来球/回球弧线与帧数、
    // 站位、跳跃高度全部来自 core/tutorial-demo 的烘焙(与实操同一颗喂球)。
    // 这里只放手势节奏与定格,不写任何坐标或弧线。
    demo: {
      dash: { on: 12, off: 8 },   // 演示弧线的虚线节奏(世界 px:画 12 停 8)
      move: { press: 12, slide: 58, dwell: 30, back: 26 },  // 按住→拖到圈→停稳→松手回中
      hit: { wind: 6, freeze: 7, hold: 26, minIn: 30, maxIn: 95, minOut: 26, maxOut: 95 },
      // jump:手势圈两式交替(上滑 / 双击);air 段帧数 = 真实跳跃递推的全程,不由这里定
      jump: { press: 8, slideUp: 10, tap: 5, tapGap: 6, hold: 24, land: 12,
              minIn: 30, maxIn: 95, minOut: 26, maxOut: 95 },
    },
  },

  // ===== HUD 左列那一叠读数牌的排布 =====
  // 局别标签 → 闯关目标进度 → 机制读数 → 风向标,四块从上往下摞在左上角。
  // 为什么要搬进 config:这四块分布在 ui/hud.ts 的四个创建点里,从前各写各的 top
  // (20 / 48 / 76 / 104)与高度,加一块就要人肉核对"会不会压上一块的字"——
  // 而压字这种坏不会崩,只会在真机上难看得要命 yet 没人报警。
  // 现在同一张表被 hud 消费、被 campaign-check 断言(top + h ≤ 下一块 top)。
  hudColumn: {
    top: { tag: 20, obj: 48, mech: 76, wind: 104 },
    h: { tag: 24, obj: 20, mech: 20, wind: 22 },
  },

  // ===== 连击徽章(右上角)档位 =====
  // 连击只数**我方(玩家侧)拍数**(rules.R.myRally),不是回合总拍数 —— 敌方的
  // 击打不计入(2026-10-05 用户现场:「敌人的这个击打不算进连击次数里」。连击读的是
  // 「我连续回了多少拍」,对方拍的插花不该把它吹大)。档位按新口径重新标定:对局
  // 平均回合约 10 拍(双方合计)≈ 我方 5 拍,所以起显线不变;旧 10/15 总拍折成我方
  // 约 5/8 拍,橙/红档上移到 8/12。进度槽也从 showAt 顶到 epicAt(hud.paintComboPlate)。
  hudCombo: {
    showAt: 5,    // ≥ 我方拍数起显徽章
    hotAt: 8,     // ≥ 换橙、脉动更猛
    epicAt: 12,   // ≥ 换红 + 星芒爆发,进度槽拉满
  },

  // ===== 关卡环境机制(风 / 颤抖 / 磁轨 …) =====
  // 闯关的"机制"之所以曾经过得毫无存在感,根子在于数值散落在逻辑与渲染里:
  // 风力周期写在 rules、颤抖频率与磁轨带宽写在 physics、遮蔽盒写在 world,
  // 于是没有一处能被界面读到,也没有一个数能被回归脚本钉住。这一段是**唯一出处**:
  // 物理施加、界面演出、文案真值三边都从这里读,改一个数三处一起动。
  // (关卡"用不用"某个机制仍然写在 campaign.ts 的 modifiers 里 —— 那是创意,不是旋钮)
  env: {
    // —— 侧风 ——
    // 周期是这个机制能不能被读懂的关键:一拍滞空约 60-80 步,一个完整来回要
    // 明显长于此,风才近似"每拍一个方向"(读得出);短于此就成了逐帧乱摆(读不成)。
    // 0.016 → 0.008(2026-10-03):用户真机第 1 关现场「风变化速度太快了,体验不太好」——
    // 换向只有 3.3s,比一分球还短,指针刚看懂就翻过去了,读出来是噪声而不是"这一拍顺/逆风"。
    // 现在半个来回 ≈ 6.5s,一次发球到下一拍之间风基本不动,机制变成可以规划的东西。
    windOscRate: 0.008,      // rad/步 → 2π/此值 ≈ 785 步 ≈ 13.1s 一个来回(约 6.5s 换向)
    windDefaultBase: 0.18,   // 关卡设了 oscillate 却没设 windX 时的基准幅度(px/步²)
    windLookahead: 60,       // 风向标"预读针"往前看的步数 ≈ 一记典型回球的滞空
    windFullScale: 0.20,     // 风向标满量程(px/步²),用来把实时风力折成指针偏角
    windMinDrift: 60,        // 反"把机制修没"的下限:解算口径里一拍至少被吹走这么多 px
    /**
     * AI 补满一档时把落点深浅挪多少(depth 单位,0..1 ≈ 对方半场全长)。
     * 半场约 390px,满偏风实测把球吹走 60~100px ≈ 0.15~0.25 depth —— 取 0.2 就是
     * "把这一档的偏差基本补回来"。windSense(见 diffs)再乘一层,决定各档补几成。
     */
    aiWindDepth: 0.2,
    // 阵风通报的三个旋钮 —— 口径(2026-10-02 定):windGustAt 是**满量程的比例**
    // (0.5 = 风已经吹到一半力气以上),连续 windGustFrames 步满足才算"起风"(防穿越零点
    // 那一瞬的抖动报一次),报完压 windGustCooldown 步。震荡风每个半周期正好报一次,
    // 也就是「球往对方底线倒」/「球被按回网前」各一次 —— 这就是玩家等的那个方向信号。
    // 从前这三行写了却无人引用(死旋钮),现在由 physics.gustState 消费、rules 派发
    // "wind-gust" 事件、HUD 落斩劈横幅,env-check 断言它必须真的触发且被 cooldown 节流。
    windGustAt: 0.5,         // 起风门槛(÷ windFullScale)
    windGustFrames: 18,      // 门槛要连续满足这么多步才算一次阵风(防一句话刷屏)
    windGustCooldown: 200,   // 两次阵风通报的最小间隔步数

    // —— 风 → 画面的换算 ——
    // 装饰风(椰树/浪花/网头彩带)与真风必须**同一个符号说话**:叶簇往左摆而球往右偏,
    // 玩家读出的是"动画在随机动",机制照样看不见。
    ambience: {
      k: 150,          // 每 1 px/步² 加速度折成多少 px 画面位移(0.18 → ≈27px)
      idle: 0.35,      // 有环境机制时,原装饰风(那两条 sin)压到几成 —— 让真风主导
      streakCount: 9,  // 沙滩风丝条数(出生定形,逐帧只平移)
      streakLen: 46,   // 风丝基准长度 px
      streakA: 0.30,   // 风丝不透明度
    },

    // —— 贴地风带(第 1 关的主力方向提示) ——
    // 风丝在天幕、针牌在角落,而玩家的眼睛跟着**场地**走:所以让场地 itself 往球被推的
    // 那一侧流。数值口径:一"格"= 场宽 ÷ count,满风时约每 span/(count·speed) 帧滚过一格。
    band: {
      count: 9,        // 人字纹条数(等距铺满全场,不随机 —— 随机会读成噪点)
      y: 30,           // 离地多高(世界 px):贴地但不埋进地胶纹理
      len: 34,         // 满风时的基准长(px)
      lw: 2.6,         // 线宽:双描边(外琥珀内纸白)共用量,单条白线在金沙上看不清
      speed: 2.4,      // 每单位风强折成多少 px/帧 的流速
      a: 0.62,         // 满风不透明度(风丝是 0.30 的背景层,这层要压得住)
    },

    // —— 流沙(第 2 关「深陷流沙」的画面) ——
    // 关卡只给倍率(accelMul 等),画面必须自己把"陷进去"画出来,否则玩家读成手感差。
    sand: {
      count: 9,        // 扬沙颗粒数(出生定形,逐帧只平移)
      spread: 22,      // 颗粒横向散布 px
      rise: 16,        // 颗粒上抛高度 px
      grainA: 0.75,    // 满速时颗粒不透明度
      troughW: 22,     // 沙窝半宽 px
      troughD: 7,      // 沙窝最深 px(跑得越快陷得越深)
      troughA: 0.55,   // 满速时沙窝不透明度
    },

    // —— 烈日致盲(第 3 关「烈日刺目」) ——
    // 从前这两团光晕的盒坐标/中心/α 全写死在 world.ts 里,界面读不到、回归钉不住。
    sun: {
      x0: 400, x1: 560,      // 隐形盒横向范围(世界 px)
      y0: 130, y1: 240,      // 纵向:高空那一段球会看不清
      cx: 480, cy: 180,      // 耀斑中心
      flareA: 0.36,          // 基础不透明度
      flarePulse: 0.08,      // 呼吸幅度(逐帧 sin,不是每帧 rand)
      rays: 12,              // 星芒尖数(p5kit drawStarburst)
      rIn: 34, rOut: 132,    // 星芒内外半径
      bandA: 0.2,            // 光栅带不透明度
    },

    // —— 网前水墨雾(第 6 关「晨雾隐踪」) ——
    // 从前是一团 g.ellipse:光滑圆圈既不是这套视觉语言(见 AGENTS「拒绝光滑圆圈」),
    // 盒尺寸也写死在渲染里。现在改锯齿水墨带,且**范围进 config** —— 玩家该看得见"哪一段会看不见"。
    fog: {
      w: 330, h: 190,        // 以网顶为中心的盒(px)
      teeth: 12,             // 上下沿锯齿牙数
      a: 0.5,                // 主雾不透明度
      coreA: 0.62,           // 内层亮带不透明度
    },

    // —— 贴网电浆磁轨(第 13 关「激光加速轨」) ——
    // 判带几何来自 physics(CFG.netRail 那一组),这里只管"看得见的那部分"。
    // 从前球被磁轨提速到 1.75 倍、玩家挨了却看不见轨 —— 机制隐形的典型。
    rail: {
      glowA: 0.55,           // 常态辉光不透明度
      hotA: 1,               // 触发电浆那一拍的过冲不透明度
      hotFrames: 26,         // 过冲亮起后衰减的帧数
      pulseHz: 0.07,         // 呼吸频率(rad/帧),逐帧 sin,不每帧 rand
      tick: 3,               // 轨上刻度段数(读"这是一条轨",不是一根亮条)
    },

    // —— 落樱狂风(第 8 关「飞叶落樱」) ——
    sakura: {
      count: 26,             // 花瓣数(出生定形)
      fall: 0.55,            // 每帧下落 px(基准)
      sway: 18,              // 横向摆动幅度 px
      k: 90,                 // 真风(px/步²)折成花瓣横向漂移 px/帧的系数
      size: 5,               // 单瓣尺寸 px
      a: 0.72,               // 不透明度
    },

    // —— 破损球的颤抖标记(第 8/19 关) ——
    // 颤抖只在 physics 里改弹道,画面从前一帧都不提示:玩家读成"我手滑/游戏随机"。
    // 这组画出**残影 + 尾羽撕裂**,并把"下降段失速"那一坠标出来(那才是要留容错的时刻)。
    erraticMark: {
      ghost: 9,              // 残影偏移 px(吃真实的 sin 相位,不是随机)
      ghostA: 0.3,           // 残影不透明度
      stallA: 0.6,           // 失速段撕裂标记不透明度
    },

    // —— 破损球的颤抖 ——
    // 相位一律取 envPhase()(见 physics 的 tickEnv),于是"抖成什么样"是可复算的:
    // 曾经的 envTick 被渲染层每帧前瞻推进上百次,抖出来的东西看着随机、其实既不可
    // 预测也不可复现 —— 那是 bug 不是机制。
    // ⚠ 定标的坑(踩过,别再按连续系统估):这里是**每步给速度加 A·sin(ωt) 的离散冲量**,
    //   等效速度偏置 ≈ A/ω,再乘滞空帧数 —— **频率越低累积越狠**。按稳态响应 a/ω² 估会整个估反:
    //   ω=0.105 那组本意是"轻抖",实测把落点铺开 314px(半场才 390px),玩家读到的就是纯随机。
    //   下面这组由 tools/env-check.ts §5 钉在 40-110px 这条"看得见、但学得会"的带里
    //   (常重力实测 71px / 低重力 107px)。改这四个数一定要重跑那一条。
    erratic: {
      speedGate: 1,    // 慢于这个速度不抖(球落地前的爬行段不该再被推)
      freqY: 0.30, ampY: 0.30,
      freqX: 0.24, ampX: 0.155,
      descRamp: 1.7,   // 下降段(球尾下坠)抖动倍率 —— 兑现"后半程失速急坠"那句文案
    },

    // —— 擦网磁轨 ——
    laser: {
      above: 55,       // 触发带上沿:网顶往上这么多 px(文案要说的是这个窗口,不是"50px")
      below: 15,       // 触发带下沿:网带往下这么多 px
      speedMul: 1.75,  // 横向抽速倍率
      vyMul: 0.8,      // 竖直分量倍率(压平 = 更凶的直线)
    },
  },

  fx: {
    // 慢动作总闸。true 时下列变速旋钮生效:fx.scoreSlowmo(Frames)、技能慢放等。
    // 赛点重锤击球慢动作与赛点常驻微慢放已彻底移除(避免干扰玩家肌肉记忆)。
    slowmoEnabled: true,
    // hitstop 定格帧数 = 真实帧数(主循环在定格段不乘慢放系数),换算 ms ≈ 帧数 × 16.7。
    // 顶档压在 7 帧:够读出「啪」的一下,又不会把手指按下去的那段时间整段吃掉。
    hitstopCap: 7,          // 定格帧总闸:任何来源(六档/发球/擦网/挥空)都不许超过
    hitstopNormal: 0,       // 普通击球不顿帧(0帧),保障拉锯节奏流畅,把顿挫感全留给 sweet/smash
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
    hitstopWhiff: 0,          // 挥空不顿帧(0帧),避免操作卡壳感,依靠人物动作硬直和扑空音效表达失衡

    // 六、闪现折跃演出(时停 → 出刀 → 慢放三段)
    // 定格走主循环现成的 hitstop 通道,所以也吃 fx.hitstopCap 总闸:这里给到的就是顶格。
    hitstopFlashCast: 7,      // 折跃当帧的世界定格:球悬在半空,雷光凝住
    flashCastFlash: 0.6,      // 折跃白闪(比扣杀命中的白闪低一档,把顶闪让给那一下)
    flashCastShake: 7,
    flashCastPunch: 1.05,     // 镜头向落点推近,读作「镜头跟着折跃过去」
    flashCastFloat: { text: "时停 · 闪现", color: "#eab308", size: 26, life: 44, plate: "slant" },
    // 百分百重击起手字。这条必须读成「上弦」而不是「已经扣完了」:旧写法在场边锚点打
    // 完成时的「暴烈重扣!!」,而附魔要到下一拍才兑现 —— 玩家按下技能看到的是一条
    // 离自己很远的红字 + 随后一个普通球(2026-10-03 真机现场,根因见 player.previewKind)。
    // 所以它不占场边锚点(那条留给命中档的「必杀重扣!!」floatSkillSmash),改挂人物头顶,
    // 与居合/心流/力竭同用 world.floatSys:关掉设置里的「飘字提示」也照常显示。
    // plate 用 none —— 带底板的字会进同侧堆叠,把后到的场边评价字向下错行(world.floatSpawn)。
    smashCastFloat: { text: "重击附魔!", color: "#f43f5e", size: 24, life: 44, plate: "none" },
    // 「怒气重击」的起手字与兑现字**不在这里**:它们跟着档位走,住在 skills.rage.tiers[]
    // 每一行的 castLab / lab。分成两组键放这儿,就会与 tierAt 的行数对不齐(某档缺一句 =
    // 玩家看见别的档的字),而这件事不崩、不报错、tsc 也不报。
    // 定式仍然照 smashCastFloat 那一条:起手字挂人物头顶 + plate 用 none(带底板的字会进
    // 同侧堆叠,把后到的场边评价字向下错行 —— world.floatSpawn / float-lane)。
    flashSmashSlowmo: 10,     // 闪现扣杀命中后的短慢放时长(模拟帧)
    // 0.45 而不是更低:整段只有 ~0.37s 真实时间。曾经给到 0.32×14 帧(≈0.73s),
    // 用户已经说过"重击卡住不好操控" —— 时停的爽点由前面那记定格负责,尾巴要短。
    flashSmashSlowFac: 0.45,  // 短慢放的时间缩放

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

    // ============================================================
    // 特效精细化(分级炫技):球体运动学 / 锥形拖尾丝带 / 粒子成形 / 镜头与飘字
    // 设计主线:普通档克制,甜区→扣杀→甜蜜重扣→连击火热逐级加码 ——
    // 每档只改"幅度"不改"有没有",玩家一眼能看出这拍打进了甜区。
    // 这一整段只作用于渲染层:不改 squash 档位、hitstop、慢放等任何模拟数值。
    // ============================================================

    // 一、羽毛球本体运动学(阻力对齐 + 翻滚 + 羽片颤动),全部渲染层局部状态
    shuttleAlignK: 0.30,       // 滞后角追踪刚度:球头追速度方向的弹性常数
    shuttleAlignDamp: 0.66,    // 角速度阻尼:<1 才有"甩过头再被拽回"的拖转
    shuttleRollK: 0.0055,      // 翻滚角速度 = 此值 × 速度(弧度/渲染帧)
    featherSplayK: 0.075,      // 受力外扩:速度突变(击球那一下)决定裙摆炸开量
    featherSplayDecay: 0.88,   // 外扩收拢速率(空气把羽片收回)
    featherFlex: 0.5,          // 羽片相位摆幅(弧度):裙摆"呼吸"
    shuttleFeathers: 7,        // 裙摆分片羽毛数(老代码是一整块五边形)
    shuttleWobK: 0.13,         // 压扁回弹的过冲振幅(相对 sq)
    shuttleWobDamp: 0.74,      // 回弹振荡衰减
    shuttleWobFreq: 0.62,      // 回弹振荡角频率(弧度/帧)
    shuttlePopSmash: 0.10,     // 扣杀命中瞬间的整体 scale pop
    shuttlePopDecay: 0.7,      // scale pop 每渲染帧保留的余量比例
    shuttleHeatRim: 0.55,      // 火热档羽尖染火的比例(裙摆外缘烧色)

    // 二、飞行轨迹:锥形丝带(取代"每个采样点叠 3~4 个同心圆")
    // 寿命基准仍复用上面的 trailLen / trailSweetLen(按档位取基数 × lenMul),
    // 免得出现"改了不生效"的假旋钮;单位 = 模拟步(1/60s)。
    trailMax: 56,              // 丝带采样点上限(环形缓冲容量,也是绘制预算上限)
    trailSpacing: 4.5,         // 距离采样间隔(世界单位):扣杀不再稀疏、搓球不再扎堆
    trailMinSpeed: 2.2,        // 低于此速度不入点(搓球末段/死球滚动不该拖出长尾)
    trailHeadW: 2.6,           // 头部半宽基数(击球点一侧)
    trailTailW: 0.55,          // 尾部半宽(收尖)
    trailTaperK: 0.7,          // 宽度收缩指数:<1 = 前段粗、后段收得快
    trailAlphaK: 1.5,          // 淡出指数:>1 尾段掉得快,读起来像被风吹散
    trailHeadR: 4.6,           // 头部亮核半径(扣在球头位置,替代原来的白雾圆)
    trailCurlDrop: 0.55,       // 慢球(搓/吊/放网)尾端打卷量:形态倍率 <0.7 时叠加
    trailTiers: {
      normal:     { lenMul: 0.85, widthMul: 0.8, bands: 4, curl: 0,    layers: [
        { hex: "#cfe0ff", wMul: 1.0,  aMul: 0.30 }, { hex: "#ffffff", wMul: 0.44, aMul: 0.60 } ] },
      sweet:      { lenMul: 1.0,  widthMul: 1.0, bands: 5, curl: 0,    layers: [
        { hex: "#00f0ff", wMul: 1.3,  aMul: 0.26 }, { hex: "#ffe14d", wMul: 0.52, aMul: 0.52 } ] },
      smash:      { lenMul: 1.3,  widthMul: 1.3, bands: 6, curl: 0,    layers: [
        { hex: "#ff6a1f", wMul: 1.35, aMul: 0.30 }, { hex: "#ffe14d", wMul: 0.62, aMul: 0.55 },
        { hex: "#ffffff", wMul: 0.26, aMul: 0.86 } ] },
      sweetSmash: { lenMul: 1.55, widthMul: 1.5, bands: 6, curl: 0,    layers: [
        { hex: "#00f0ff", wMul: 1.5,  aMul: 0.28 }, { hex: "#ff6a1f", wMul: 0.92, aMul: 0.50 },
        { hex: "#ffffff", wMul: 0.3,  aMul: 0.92 } ] },
      fire:       { lenMul: 1.9,  widthMul: 1.7, bands: 7, curl: 0.2,  layers: [
        { hex: "#ff4d4d", wMul: 1.6,  aMul: 0.32 }, { hex: "#ff6a1f", wMul: 1.02, aMul: 0.50 },
        { hex: "#ffe14d", wMul: 0.5,  aMul: 0.74 }, { hex: "#ffffff", wMul: 0.24, aMul: 0.95 } ] },
    },
    // 球种形态倍率:高远/发球留长线,搓/吊几乎不留尾并在末端打卷
    trailShotShape: {
      smash: 1.0, drive: 0.95, clear: 1.15, lob: 1.05, slash: 0.6, netshot: 0.42,
    },
    // 设计款球皮的残影风格:只换层配色与头部形状,不再叠同心圆(皮肤不降级)
    trailSkin: {
      star:    { hexes: ["#7ecbff", "#d8ecff", "#ffffff"], head: "star" },
      flame:   { hexes: ["#ff4d26", "#ff9a3d", "#ffe14d"], head: "ember" },
      petal:   { hexes: ["#ffb7d0", "#ff8fb8", "#ffe0ec"], head: "petal" },
      rainbow: { hexes: [], head: "hue" },   // 空表 = 逐点转色相,色相步进见下
    },
    trailRainbowStep: 16,      // 星河羽:每点色相推进(度)
    trailHeadTwinkle: 0.25,    // 星芒头闪烁的相位角速度(弧度/帧)

    // 三、粒子成形(方块→定向拉长、线性→ease-out、单环→双环辉光)
    partFadeK: 1.55,           // 粒子 alpha 幂指数(>1 前段亮、尾段散)
    partShrink: 0.45,          // 退出时尺寸收缩下限(0=完全缩没)
    streakLenK: 1.7,           // 划线长度 = 速度模长 × 此值(现在只按 |vx| 算)
    streakTaper: 0.28,         // 划线尾端相对头端的宽度比
    ringEaseK: 0.42,           // 扩散环 easeOutQuart 的幂修正(越大越早到外圈)
    ringHaloK: 2.8,            // 双环外晕的宽度倍率
    ringHaloA: 0.24,           // 双环外晕的 alpha 倍率
    ringScale: 0.55,           // 所有扩散环的目标半径倍率:老值(最大 230)在 960×540 的
                               // 画面里糊成一整面"靶心",压到一半才像打在球上的那一下
    sparkleScale: 0.62,        // 星芒尺寸倍率(同上:白/金/青三颗叠一起太大就互相糊色)
    speedLineReach: 0.42,      // 速度线外端距离倍率(原来 150~320,线横穿半屏)
    speedLineBias: 0.72,       // 速度线沿入射方向的比例(其余仍四周散射)
    speedLineWidth: 1.9,       // 速度线基础线宽(改成锥形四边形后的头宽)
    burstSmashK: 0.5,          // 扣杀爆散粒子数量倍率(每粒更精,总数下降)
    miniSparkCount: 4,         // 普通拍接触火星粒数(原 6)

    // 二·五、P5 爆裂锯齿环(取代"简单圆圈"的扩散环/冲击波/落点标记)
    // 尖刺形状在环出生时用种子随机定死,逐帧只做半径扩张与 alpha 衰减 ——
    // 同一颗粒终身同形,绝不抖闪。singularity/timeRupture 刻意不走锯齿
    //(引力/时空=平滑圆,打击=尖刺,两套性格)。
    ringSpikesMin: 7,          // 锯齿环尖刺数下限(出生随机定死)
    ringSpikesMax: 11,         // 上限(2N ≤ 24 顶点池上限)
    ringSpikeInK: 0.7,         // 内半径/外半径比(尖刺深度,越小越尖)
    ringJagK: 0.18,            // 顶点径向抖动比例(出生定死)
    speedLineHeadK: 3.0,       // 漫画集中线头宽 = speedLineWidth × 此值(尾端收尖)
    markCrossLen: 20,          // 落点准星臂长(世界单位)
    markCrossW: 2.2,           // 落点准星臂根宽

    // 二·六、P5 斩劈 cut-in(顶档命中:sweetSmash/fire 三道斜带横扫全屏)
    // 走模拟步推进(hitstop 冻结时斜带一起定格,更"斩"得住);激活期间
    // 径向环白闪被顶替,只留低强度整屏提亮。普通档白闪走原通道不变。
    slashCutinFrames: 9,       // 斩劈闪时长(模拟帧)
    slashCutinAng: 14,         // 斜带倾角(度)
    slashCutinBandW: 0.30,     // 带宽/屏宽比(收窄让中央球路透出来)
    slashCutinAlpha: 0.55,     // 带峰值 alpha(底板只做衬底,不糊死画面)
    slashCutinStagger: 0.22,   // 三带错相位
    slashCutinColors: ["#e60012", "#07070d", "#ffffff"],        // sweetSmash 带色(P5 红黑)
    slashCutinColorsFire: ["#e60012", "#ff6a1f", "#ffe14d"],    // fire 带色(红橙金)
    slashCutinFramesRage: 40,  // 怒气满管释放的斩劈时长(60Hz 帧,≈0.67s)。与上面 9 帧的顶档
                               // 命中档分开一档:那是 hitstop 里定格的一瞬,这是"按下即燃"的
                               // 整屏宣言,不跟 hitstop 走 —— 太短读不出"大事发生",太长盖住下一拍

    // AI 力竭斩劈(hud-overlay.exhaustDraw):AI 体力血条见底那一瞬的演出时长(模拟帧)。
    // 55 帧 ≈ 0.9s:左进右出扫一遍,太短看不清"阶段切换",太长盖住下一拍发球。
    exhaustCueFrames: 55,

    // 四、镜头与飘字(白闪径向化、震屏阻尼正弦、飘字弹入)
    flashRadial: 0.6,          // 白闪径向化的峰值强度(边缘亮/中心透,不糊住球)
    flashRings: 16,            // 径向近似的描边环数
    shakeFreq: 0.8,            // 震屏阻尼正弦角频率(弧度/模拟步);振幅仍按既有 0.85 几何衰减,
                               // 主轴方向由 world.shake(amt, vert, dirAng) 的来球方向给定
    floatPopBack: 1.7,         // 飘字弹入过冲(easeOutBack 参数)
    floatPopFrames: 6,         // 弹入用时(模拟步)
    floatRiseEase: 1.8,        // 上浮减速指数(>1 起得快落得缓)
    floatFadeK: 0.5,           // 全程淡出起点(1=一出现就开始淡)
    // 场边评价字锚点(世界坐标,canvas 风 y 向下 —— 小 y 更高):评价/技能类飘字不贴球,
    // 按击球方挂到两侧场边空中区(padX = 距左右边线的锚点 x)。298 = 网顶(netTopY=390)
    // 上方约 90、人物头顶(groundY-64=406)上方 80+ 的净空带,再往上就撞里程碑横幅(72)
    floatSide: { padX: 100, y: 298 },
    // 飘字底板强度:底板已移到场边,恢复实心墨黑保文字可读(dim=1 原版)。
    // 教训:半透明底板(dim 0.55)在暖色球场上糊成灰,金字反而看不清 ——
    // 可读性靠实底,不挡球靠挪位置;真机仍嫌抢眼再整体调低
    floatPlateDim: 1,          // 底板所有 alpha 的全局乘数
    floatPlatePadScale: 0.85,  // 底板外扩尺寸乘数(1=原版,越小底板越紧凑)
    // 场边字同侧堆叠的行间缝隙:一拍最多四条场边字(档位+技能+跳杀+热手),旧错行
    // 封顶两行会把第 3、4 条叠回同一点(render/float-lane.ts 整层重排+容量驱逐)
    floatLaneGap: 8,
    // star 底板星芒的外径(直径 = 板高 × 此值):旧版按 0.55×板宽推导,30 号宽板
    // 外径 ~255px 是行高的 5 倍,尖刺横扫上下两三行盖住别的牌子(用户现场:
    // 两条「完美重扣」叠成一块)。0.0.25 收到 1.3×板高,并整体压到所有底板下层
    floatStarScale: 1.3,
    // 场边堆叠列的共享上浮偏移:同侧每模拟步 +speed、封顶 max,列空归零。
    // 所有成员共用同一偏移 —— 行距由目标行位锁死;旧版各字按剩余寿命各自上浮,
    // 后出生的升得快,8px 行距约 0.3s 就被追平(render/world.ts relayoutFloats)
    floatColumnRiseSpeed: 0.55,
    floatColumnRiseMax: 30,
    // 夸奖档位的文案/字号/寿命:原先硬编码在 game-root 的 drain 里(六档各一行),
    // 挪进配置后"这一档给多大的字"与别的特效旋钮一处对齐;
    // 位置不跟球 —— game 层按击球方挂到场边锚点 floatSide,底板才不会挡住球
    // plate = P5 飘字底板:star 尖刺星芒徽章(最高两档)/ slant 斜切黑片(次档)/ 无底板
    floatTierPerfectSmash: { text: "完美重扣!!", color: "#ffe14d", size: 30, life: 56, plate: "star" },
    floatTierPerfect:      { text: "✦ PERFECT ✦", color: "#00f0ff", size: 24, life: 50, plate: "slant" },
    floatTierSweetSmash:   { text: "黄金重扣!!", color: "#ffe14d", size: 28, life: 52, plate: "star" },
    floatTierSmash:        { text: "扣杀!!",     color: "#ffe14d", size: 26, life: 48, plate: "slant" },
    floatTierSweet:        { text: "✦ SWEET! ✦", color: "#ffe14d", size: 20, life: 42, plate: "slant" },
    floatTierGood:         { text: "好球",       color: "#ffffff", size: 16, life: 34 },
    // 瞄准深浅的命中确认(触屏右滑/左滑、键盘 J/K 同链路):比档位字小一号,dy 正值 = 球下方,
    // 贴着击球点才有空间反馈,不随档位字去场边;mid(直接点击,没滑)不飘,默认档不打扰
    floatAimDeep:          { text: "深球·重",    color: "#ffe14d", size: 14, life: 30, dy: 26 },
    floatAimNear:          { text: "短球·轻",    color: "#00f0ff", size: 14, life: 30, dy: 26 },
    // 技能触发与特殊击球飘字(同样按施放方挂场边锚点 floatSide,不贴球)
    floatSkillLunge:       { text: "疾风重击!!", color: "#38bdf8", size: 26, life: 48, plate: "slant" },
    floatSkillSmash:       { text: "必杀重扣!!", color: "#f43f5e", size: 30, life: 54, plate: "star" },
    floatSkillFlash:       { text: "闪现扣杀!!", color: "#eab308", size: 32, life: 58, plate: "star" },
    floatSkillMagnet:      { text: "引力回击!!", color: "#a855f7", size: 28, life: 50, plate: "slant" },
    floatSkillMagnetAir:   { text: "引力跳杀!!", color: "#a855f7", size: 30, life: 54, plate: "star" },
    floatSkillFocus:       { text: "时空贯穿!!", color: "#00f0ff", size: 28, life: 52, plate: "star" },
    floatSkillFocusCast:   { text: "时空领域!!", color: "#06b6d4", size: 26, life: 48, plate: "slant" },
    // 影分身的起手两行(旧写法把 color/size/life 内联在 game-root.ts 里,与别的技能不同源)。
    // 第二行报**在场数**而不是"替你接三球" —— 跨回合补满之后那句在撒谎(用户 2026-10-05 口径)。
    // {n} 由 game-root 替换:整句话留在配置里,不许在两个文件里各写一半
    floatSkillShadowCast:  { text: "影分身·参上!", color: "#8b5cf6", size: 24, life: 46, plate: "slant" },
    floatSkillShadowNote:  { text: "已在场 {n} 个", color: "#c4b5fd", size: 15, life: 52, plate: "slant" },
    // 「怒气重击」的场边字不在这里 —— 四档各一句,住在 skills.rage.tiers[].lab(单一真话)。
    // 跳杀(空中高球必然扣杀)专属飘字
    floatJumpSmash:        { text: "跳杀!!",     color: "#ff8a3d", size: 26, life: 46, plate: "slant" },

    // ============================================================
    // 五、胜利礼花(彩带池在 render/fx.ts;放行时钟的判据在 core/celebration.ts)
    //
    // 用户现场:「胜利时的这个礼花效果会有点卡顿」。查下来三件事叠在一起,而礼花
    // 从头到尾**一帧都没走过**:
    //   ① OVER/DRILLDONE 属 CFG.frozen,主循环在 frozen 态整块跳过 world.stepFx ——
    //      而 fx.step() 只在那里被调用,60 片纸屑出生后就钉在半空直到结算卡关掉;
    //   ② frozen 态还把整场渲染降到每 4 真实帧(≈15fps),而彩带层的"隔帧重绘"是按
    //      **渲染帧**计数的,于是变成每 8 真实帧才动一次;
    //   ③ 旧弹道是 g=0.02 且没有空气阻力:按 260 帧寿命积分,纸屑全程在往上飞
    //      (升程 1400px,早就出屏),"重力下落"那句注释在撒谎;而喷口单点居中
    //      (480, groundY-120),正落在结算卡(560×490 居中、alpha 0.94)背后 ——
    //      玩家看得见的那两条侧边里一片纸屑都没有。
    // 现在:两口贴地斜喷(喷口就摆在卡片外侧那两条可见带里)+ 真的会落下来的纸片模型
    // (重力 / 空气阻力 / 翻飘 / 翻面收宽)。数值全部由 tools/confetti-check 钉住。
    // 单位:长度 = 世界 px,速度 = px/帧,加速度 = px/帧²(模拟步 60Hz)。
    // ============================================================
    confetti: {
      states: ["OVER", "DRILLDONE"],  // 值得为庆祝放行表现层时钟的态(必须是 frozen 的子集;PAUSED 不在内 = 暂停仍是定格帧)
      nozzles: [0.058, 0.942],        // 喷口 x / 世界宽:结算卡外侧那两条边
      nozzleY: 120,                   // 喷口离地高度(世界 px,向上为正)
      spread: 44,                     // 出生横向抖动(出图核过:30 会排成两根细水柱,填不满两侧可见带)
      count: 40,                      // 每口粒数(两口 80 片,离池上限 MAX_CF=200 还远;笔数预算见 confetti-check ⑥)
      vyUp: [8.5, 13],                // 出膛竖直速度区间:实测升程 ~240px,最高一片停在 y≈113(不出屏顶)
      inward: 1.8,                    // 侧口向内斜喷的横向初速(两口镜像)
      vxJit: 1.5,                     // 横向初速随机附加
      grav: 0.15,                     // 重力
      drag: 0.975,                    // 纸片空气阻力:终端下落 ~5.9px/帧,约 1 秒落完剩余高度
      flutter: 0.06,                  // 翻飘:每帧横向加速度 = sin(rot) × 此值(再乘阻力,摆幅自然收敛不发散)
      spin: 0.16,                     // 自转角速度区间端点(弧度/帧)
      w: [4, 9],                      // 纸片宽(世界 px)
      h: [6, 14],                     // 纸片高(世界 px)
      life: 210,                      // 寿命(帧)上限:落回地面/出屏即回收;实测第 144 帧全部收场 ⇒ 庆祝段一定回落到省电降频
      floorPad: 2,                    // 地面回收线 = groundY - 此值(纸屑擦到地板就收,不许在地面上堆一层方块)
      flipK: 0.34,                    // 画宽 = w ×(flipK + (1-flipK)·|cos rot|):翻面一闪,不加笔数
      layerEvery: 1,                  // 彩带层每几帧重画一次(fx.draw 内;上升段最快 ~13px/帧,掉到 30fps 就是一串方块跳格)
    },

    // ============================================================
    // 五·五、结算谢幕演出(ui/settle-cine.ts 出时间轴,settle-panel 照它演)
    //
    // 用户现场:「比分到了之后就直接弹窗结算了,可以多加一点效果(失败和胜利的不一样)」。
    // 从前终局当帧切 OVER、下一渲染帧卡片就弹入,胜负只差标语颜色。现在卡片之前先给
    // 一段谢幕(时间轴纯函数出,胜负两条路径):
    //   胜利 = 球场停留(彩带在 celebration 的 celebrate 时钟里真正落完)→ 金红斜带
    //          扫场 → VICTORY! 砸落 + 星芒爆 + 卡片轻震 → 内容逐行浮现;
    //   失败 = 冷暗幕缓缓压下(氛围红斜带收掉)→ DEFEAT 缓沉 → 卡片沉重浮现,
    //          无彩带无弹跳无星芒。
    // 单位:秒(UI tween)/ px。验收 tools/settle-cine-check.ts(+ --selftest 喂
    // 「旧单一快路径」与「拖沓档」必须被拦)。
    // ============================================================
    settleCine: {
      dimDelayWin: 0.25, dimDurWin: 0.4,     // 胜利暗幕:晚一点起、升得快,球场多看一眼
      dimDelayLose: 0.2, dimDurLose: 0.6,    // 失败暗幕:马上压、压得慢,落差感
      beatWin: 0.7,                          // 卡片入场起点(胜利):留够彩带雨的一拍
      beatLose: 0.9,                         // 卡片入场起点(失败):标语沉完卡片才来
      bandsColors: ["#ffe14d", "#e60012", "#07070d"],  // 扫场斜带(金/斩劈红/墨,P5 红黑金)
      bandsAlpha: 0.5,                       // 带峰值 alpha(衬底不糊场)
      bandsDur: 0.5,                         // 单带扫完全程用时
      bandsStagger: 0.09,                    // 三带错相位
      bandsThick: 150,                       // 带厚(px),端帽斜切量 = 厚 × bandsSkewK
      bandsSkewK: 0.9,                       // 端帽斜率(与 slashWipe 同款)
      burstR: 130, burstPoints: 12,          // 标语星芒爆(半径/角数,双层错半步)
      cardShakeAmp: 3, cardShakeDur: 0.22,   // 标语砸落时卡片轻震(幅度/时长)
      loseVeilHex: "#101a2e", loseVeilCenter: 0.16, loseVeilEdge: 0.38,  // 失败冷 veil(叠在暗幕上)
      verdictDescend: 0.55,                  // DEFEAT 缓沉时长(起点 = beatLose − 此值,沉完卡片正好到)
      cardSinkDur: 0.5,                      // 失败卡片沉重浮现时长
      rowStagger: 0.05,                      // 内容逐行浮现阶梯(秒)
    },

    // ============================================================
    // 传说皮肤「脚下法阵」(纯装饰;画法在 render/aura.ts,调用点在 sprites.drawPlayer)
    // 旧写法是 drawPlayer 里 24 行「两个光滑椭圆环 + 三颗圆」——与全站 P5 语汇
    // 「拒绝光滑圆圈」正相反,而且商店预览传的 animT 恒为 0,买家看到的那圈东西既不
    // 呼吸也不转。用户现场:「传说皮肤人物底下那层光圈太简陋了」。
    // 现在拆六层:外溢光晕 / 主齿环 / 外断环 / 符文 / 环绕星尘 / 上升光尘。
    // 单位:长度 = 世界 px(人物宽 player.w = 42 为基准),角速度 = 弧度/渲染帧(60fps)。
    // 各层相位全是 t 的纯函数,逐帧零 rand(与 p5kit「出生定形」同一口径)。
    // ============================================================
    aura: {
      radiusK: 1.02,        // 主齿环长半轴 / 人物宽
      flat: 0.235,          // 地面透视:短半轴 / 长半轴(与影子的扁率同量级)
      liftFade: 3.2,        // 离地淡出斜率:air × 此值 ≥ 1 时整阵隐去(跳起不留悬空法阵)
      breathK: 0.045,       // 呼吸幅度(整阵半径相对涨缩)
      breathSpeed: 0.033,   // 呼吸角速度

      // —— 一、外溢光晕:贴着齿环外侧描三遍宽而淡的环带,读作「光从线上溢到地上」 ——
      // 这里从前是三遍**实心铺底**,在商店那种墨黑底上叠成一摊橄榄色的泥坑:暗底上
      // 半透的暖色只会变脏,不会变亮。改成向外扩散的环带后阵心是干净的地板,亮部只
      // 落在线条两侧,暗场亮场一个读法(出图 tools/aura-preview 两列并排对照)。
      bloomR: [1.03, 1.11, 1.19],    // 三层半径 / 主齿环
      bloomW: [5, 8, 12],            // 三层线宽(世界 px,由内到外越来越散)
      bloomA: [0.105, 0.062, 0.034], // 三层 alpha
      bloomPulse: 0.35,     // 与齿环反相的吐纳幅度:环胀起时溢光收暗

      // —— 二、主齿环:方齿硬边多边形,同形状描两遍近似辉光 ——
      teeth: 9,             // 齿数(奇数:两侧完全对称会呆)
      toothDepth: 0.085,    // 齿高 / 主环半径
      toothTopK: 0.46,      // 齿顶占一个齿距的比例(其余是凹槽)
      spinCore: -0.0075,    // 角速度(负 = 与外断环反向对转)
      coreW: 1.7,           // 芯线宽(世界 px)
      coreA: 0.92,          // 芯 alpha
      haloW: 3.0,           // 外晕线宽(同路径加宽一道的低透明度描边)
      haloA: 0.20,          // 外晕 alpha

      // —— 三、外断环:三段弧 + 缺口,反向慢转(法阵的「阵」) ——
      outerK: 1.26,         // 半径 / 主齿环
      outerSegs: 3,         // 段数
      outerArcK: 0.62,      // 每段占满一格的弧度比例(1 = 无缝整圈)
      spinOuter: 0.0052,
      outerW: 1.5,
      outerA: 0.62,

      // —— 四、符文:压在齿环上的菱形宝石,与齿环同转 ——
      runes: 4,
      runeK: 0.985,         // 所在半径 / 主齿环(略探进齿根)
      runeW: 1.9,           // 菱形半宽 / 半高(世界 px)
      runeH: 3.1,
      runeA: 0.95,          // 宝石体(主色)
      runeGlowA: 0.9,       // 内焰(高光色,半径 ×0.46):宝石要在亮球场与暗商店底都读得出

      // —— 五、环绕星尘:四角星沿外轨巡游,各自错相位闪烁 ——
      stars: 3,
      starK: 1.16,          // 星轨半径 / 主齿环
      starSpin: 0.0125,     // 星轨角速度
      starR: 3.6,           // 星芒外半径(世界 px)
      starInK: 0.34,        // 内半径 / 外半径(越小越尖)
      starPoints: 4,        // 星芒角数(配色表可按款覆写)
      starTwinkle: 0.075,   // 闪烁角速度
      starBob: 2.4,         // 离地漂浮高度(世界 px)
      starA: 0.9,

      // —— 六、上升光尘:自环上生起、飘到顶淡出的小菱形(按下标错相位,零 rand) ——
      motes: 5,
      moteK: 0.94,          // 生点半径 / 主齿环
      moteRise: 16,         // 上升高度(世界 px)
      moteSpeed: 0.011,     // 相位推进(弧度/帧,2π 为一轮)
      moteW: 1.5,           // 菱形半宽(世界 px,半高 = ×1.8)
      moteA: 0.75,
      moteMinPx: 30,        // 主环在地面上的实际半宽(px)小于此就不画升尘:商店卡片那种
                            // 26px 的缩略图里,细碎亮点只会糊成噪点
    },
  },

  // ===== 触觉反馈档位(手机端震动):生效逻辑在 core/haptic.ts,出口在 game/haptics.ts =====
  // 为什么要有这一整段:震动是唯一还没被分级过的打击感通道。fx 的 hitstop/shake/punch
  // 三套阶梯都是「同一拍、按强弱分档」,触觉以前只有 12/24/40ms 三个点 —— 而且只有时长、
  // 没有振幅,线性马达手机上 12~24ms 的 one-shot 基本无感,用户读出来的就是「开关没用」。
  // 现在键名与 fx 六档同源(sweet/smash/…/perfectSmash),单调性由 tools/haptic-check 钉住。
  // 强度 = ms × amp 两维(amp 1..255 直接给 Android VibrationEffect);设备不支持控振幅时
  // core/haptic.ts 会把振幅差折进时长差,所以「轻/标准/强」在无振幅控制的机器上依然有差别。
  haptic: {
    floorMs: 18,        // 时长地板:低于这个数在真机上就是「震了但摸不到」,旧 light:12 栽在这儿
    capMs: 90,          // 时长上限:再长就不再是「触感」而是「马达在嗡嗡」,且盖不住音效
    throttleMs: 55,     // 同一个事件名的最小间隔(防连打把手机震成马达噪声;不同事件不互吞)
    maxQueued: 3,       // 待发放上限:同帧涌进三件事(重扣+落地+得分)也不至于排成一串礼花
    preemptRatio: 1.5,  // 队列已满时,来者 power 需 ≥ 队内最弱 × 此倍率才挤掉它
    gapMs: 26,          // 多段脉冲/排队段之间的间隔:短到读成一串、长到不糊成一坨
    default: "standard",
    // 表序必须从弱到强单调(haptic-check 有断言):设置页滑杆按下标定位。
    // 存 id 不存索引,与 pace/gait 同一套语义。
    levels: [
      { id: "low",      msMul: 0.60, ampMul: 0.55, label: "轻",   note: "只在重要那几下点一下" },
      { id: "standard", msMul: 1.00, ampMul: 1.00, label: "标准", note: "现在的强度,顶档摸得到" },
      { id: "high",     msMul: 1.35, ampMul: 1.00, label: "强",   note: "时长再加三成,手机别放桌上用" },
    ],
    // --- 击球六档(与 fx.hitstop* / shake* / punch* 同序;普通档不在表里 = 不震) ---
    sweet:        { ms: 26, amp: 140 },
    perfect:      { ms: 32, amp: 180 },   // 完美但非扣杀:略轻于 smash,对齐 fx 的 5<5、9<12
    smash:        { ms: 34, amp: 200 },
    sweetSmash:   { ms: 40, amp: 235 },
    perfectSmash: { ms: 48, amp: 255, segs: 2 },  // 全游戏最重的一下:两段脉冲读作「炸开」
    // --- 技能起手:重扣/闪现是爆发型,其余是铺垫型 ---
    skill:        { ms: 44, amp: 230 },
    skillLight:   { ms: 24, amp: 120 },
    // --- 关键节点 ---
    landSmash:    { ms: 40, amp: 210, segs: 2 },  // 扣杀落地冲击波
    score:        { ms: 42, amp: 220, segs: 2 },  // 己方得分
    win:          { ms: 70, amp: 255, segs: 3 },  // 通关:三段,顶档只给它
    lose:         { ms: 50, amp: 130 },           // 失利:长但软,不和爽点抢振幅
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
    // 甜蜜点高能光效体系(lob/drive 是击球键纵向手势的方向色:上滑挑高/下滑平抽,
    // 与 shotBadge.kinds 同源 —— 徽标会在拇指上方预告真实球种)
    sweet: { gold: "#ffe14d", core: "#ffffff", neonCyan: "#00f0ff", neonPurple: "#d946ef", amber: "#ff9f1c", lob: "#8ef2a3", drive: "#7dd3fc" },
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
    // 设备自适应缩放的上下限(算在 touchpad.padScale)。搬到 config 的理由与
    // touchAim.commitPx 同源:这个文件 import cc,node 侧读不到,而冷却读数的排版
    // 断言要用「最小档按钮到底多大」(tools/pad-cd-check.ts ④)。
    scaleMin: 0.9, scaleMax: 1.25,
    label: "#ffffff", labelA: 0.62,   // 键名文字(「击球」「跨步」,乘 padAlpha)
    labelOutline: "#0a0d18",          // 键名描边:亮场(海滩)上白字没描边会糊掉
    labelSize: 13,                    // 键名字号

    // --- 技能键的「冷却读数」(算法与笔画在 input/pad-cd.ts,回归 tools/pad-cd-check.ts) ---
    // 透明度滑杆能压到 0.2。原本冷却的墨底/进度环/图标一律乘这个值,于是滑杆拉到
    // 最低时 0.58 的墨底只剩 0.116 —— 玩家看到的不是「这个技能还剩 3 秒」,
    // 而是「这颗键按不动,是不是坏了」。滑杆管的是**按键别碍眼**,不该把状态指示
    // 一起抹掉:冷却是信息,不是装饰。所以这一层的浓度只跟随滑杆一部分(keep),
    // 留一个读数下限;就绪态(底色/描边/图标)照旧完全跟随滑杆。
    cd: {
      keep: 0.82,                 // 有效 alpha = padAlpha + (1 - padAlpha) * keep(0=完全随滑杆)
      fill: "#0e121a", fillA: 0.66,     // 冷却/锁定中的键底
      edge: "#334155", edgeA: 0.9,      // 冷却/锁定中的描边(亮场要靠它撑出形状)
      lockedIcon: "#64748b", lockedIconA: 0.7,   // 「就绪但当前局势不给放」时的图标(此时不画倒计时)
      sweep: "#05070c", sweepA: 0.72,    // 剩余冷却的扇形墨底
      ringW: 4.5,                 // 就绪进度环粗(按技能专属色上彩)
      ringA: 0.96,
      head: "#ffffff", headA: 1, headW: 7, headSpan: 0.42,  // 扫掠前沿亮点:扇形与环的交界
      num: "#ffffff", numA: 1, numOutline: 2,               // 键心「还剩几秒」(Label)
      numK: 0.5,                    // 倒计时字号 = numK × 按钮半径 —— 跟图标一样随半径缩放,不写死
      numY: 0.08,                   // 倒计时圆心高度比例:往上让开键名标签那一带(断言④)
      numOutlineColor: "#0a0d18",
      numMin: 0.1,                  // 冷却中最低读数:宁显示 0.1 也不显示 0.0(0.0 = 看着像就绪)
      stepTol: 0.008,               // 冷却扫掠的重画阈值:距**上次重画**的累计变化超过它才重画(门控在 pad-cd.makeCdGate;
                                    // 基准若错写成「上一帧喂值」,阈值退化成相邻帧增量,长 CD 的扫掠会整段冻结、只随点按跳格)
      // --- 「就绪但当前局势不给放」三态(笔画在 input/pad-cd.ts,原因文案在 skills.blockText)---
      // 冷却中 = 扇形墨底 + 倒计时;门槛未满足 = 键内 P5 斜切封条(内嵌原因文字如「球没过来」)+ 灰斜杠;就绪 = 呼吸辉光
      slashColor: "#8a8f9e",        // 门槛斜杠颜色(灰:是「局势不让」,不是「出错」)
      slashInset: 0.44,             // 斜杠端点内缩比例(端点在 r×(1-inset) 处)
      slashW: 3.5,                  // 斜杠线宽
      slashA: 0.8,                  // 斜杠不透明度
      // 封条底衬(P5 动感斜切胶带,居中内嵌在按键腰部,与冷却倒计时数字同高度重心)
      tapeW: 1.44,                  // 封条宽度 = r × tapeW
      tapeH: 0.42,                  // 封条高度 = r × tapeH
      tapeSkewK: 0.07,              // P5 动感斜切比例(skew = r × tapeSkewK)
      tapeBg: "#080b12",            // 封条墨黑深底
      tapeBgA: 0.92,                // 封条底色不透明度
      tapeEdge: "#5a454a",          // 封条细描边(暗暖灰/低饱和警示)
      tapeEdgeA: 0.85,              // 描边不透明度
      tapeEdgeW: 1.2,               // 描边线宽
      watermarkA: 0.18,             // 受阻态背后技能图标水印透明度
      hintSize: 10,                 // 键内封条原因文字字号(默认档)
      hintY: 0.08,                  // 原因文字/封条圆心高度比例(与 numY 一致,让开底部键名)
      hintDyK: 0.08,                // 兼容保留
      hintColor: "#f8fafc",         // 原因文字颜色(清亮暖白,在墨黑封条上高对比)
      hintOutline: "#05070c",       // 文字描边纯墨黑
      hintOutlineW: 2.0,            // 文字描边粗细
      hintA: 0.98,                  // 原因文字不透明度
      rejectFlash: "#ff5555",       // 按下被拒的冲击环颜色
      readyPulseK: 0.11,            // 就绪呼吸:循环 tween 单程秒数的系数(秒 = k × 10)
      // ===== 「蓄能环」读数(kind: "charge" 的技能用,当前 = 怒气重击)=====
      // 为什么不复用冷却那套:cdRatio 的语义是「还剩多久能用」,三处行为焊死在它上面 ——
      // 键体变灰并藏图标、键心印秒数、就绪脉冲要求 cdRatio<=0。蓄能是它的**反向量**
      // (越多越好、永远不该让键变灰),偷渡进 cdRatio 就会得到"怒气越满键越暗"。
      // 算法在 input/pad-cd.ts 的 chargeArcs/drawCharge,与 cdArcs 同一条**补集规矩**
      // (角度一律排成递减序,否则 cc 画出的是它的补集,见 AGENTS.md 必须知道的坑 8)。
      charge: {
        ringW: 5.5,                 // 蓄能环比冷却环粗半档:它是"进度"不是"惩罚",要更抢眼
        ringA: 0.95,
        trackA: 0.25,               // 满环底槽(不画它玩家读不出「离满还差多少」,只看得见「有多少」)
        head: "#ffffff", headA: 1, headW: 6.5, headSpan: 0.5,  // 蓄能前沿白亮头
        fullRingW: 2.2,             // 满怒那一圈外环(与 isFlashReady 的双白环同一族读法:满了就是在提示你按)
        fullRingA: 0.9,
        pctK: 0.42,                 // 百分比字号 = pctK × 按钮半径(比倒计时 numK 0.5 收一档:
                                    // "100%" 比 "3.5" 宽得多,不收到 4 字宽会啃键名标签 —— pad-cd-check ④ 同一条判据)
        pctY: 0.08,                 // 圆心高度比例:与倒计时同腰位,两层不叠字
        stepTol: 0.008,             // 重画阈值:怒气一次跳 5~14 点(= 5%~14%),跨过它就必重画
        segGap: 0.16,               // 多管分段环的段间缺口(弧度,≈9°):管与管的分界。
                                    // 单管(pipes<=1)时强制 0 = 连续满环(旧读法原样保留)
      },
    },
  },

  // ===== 摇杆上推代跳(仅 joystick 模式;数值是底圈半径的比例,与设备 scale 无关) =====
  // 摇杆原来只把水平分量 dx 交给 pad.moveAxis,垂直分量画完小球就丢了 —— 彻底的死输入。
  // 现在把它当跳跃意图:跳是「往上」的动作,住在左手的模拟量上比挤在右手四键里自然得多。
  stickJump: {
    upHi: 0.72,   // 上推到半径这个比例 → 起跳并保持(推得越满、停得越久 = 跳得越满)
    upLo: 0.55,   // 退回这个比例以下才算松手。留 0.17 迟滞带:拇指停在边界时
                  // press/release 会以 60Hz 抖动,而抖动落在上升段就是反复 jumpCut,跳不高
  },

  // ===== 滑轨移动与手势参数(仅 slider 模式) =====
  sliderControl: {
    jumpSwipeUpY: 26,     // 向上滑动起跳阈值(像素)
    jumpSwipeUpLoY: 14,   // 向上滑动起跳释放滞后阈值(像素)
    doubleTapWindowMs: 280, // 双击起跳时间窗口(毫秒)
    doubleTapMaxDist: 36, // 双击判定最大像素距离(防大幅滑动中误判)
    arriveEps: 1.5,       // 定点平滑刹停吸附精度(像素)
    slowDownDist: 22,     // 减速缓冲区间(像素):进入此区间按比例减速,平滑定点不冲过头
  },

  // ===== 触屏击球手势:横滑提交深浅的参数(画在 input/touchpad.ts,断言在 tools/reach-check.ts) =====
  // 击球键按下即起拍(与键盘 KEY_DOWN 同帧),深浅要等手指横移过 commitPx 才写进
  // pad.swingSwipe —— 这就是「触屏比键盘多花的那几帧」。原本它是 touchpad.ts 里的
  // 字面量 15,而那个文件 import cc,node 侧读不到,断言就写不出来;值一字未改,
  // 只是搬回它该住的地方(数值只进 config)。
  // 判定用位移矢量长度 hypot(dx,dy) 触发(斜滑也算),但横向分量仍需占主导
  // (≥ commitPx/2),方向由 X 符号决定 —— 见 touchpad.ts trackSwingSwipe。
  touchAim: {
    commitPx: 10,       // 总位移超过这么多像素即提交深/浅(斜滑也认,横向分量需 ≥ commitPx/2)
    // 纵向分量单独的提交阈值(px):比横向紧一档 —— 纵向在此前版本是有意无语义区
    // (防纯纵向晃动误触),给了语义后仍要压住「点按时手指上下漂移」变成意外挑高/平抽。
    // 两轴独立提交、可组合(上+右 = 挑高到后场),同一轴反向滑过阈值即改写。
    commitPxY: 16,
    // 长滑锁定位置提示与手感 (和平精英长滑锁定同构设计):
    //  ① 滑出按键 (dist >= 半径 × lockAppearK) 时开始显现对应方向的小锁图标 🔒 与虚线引导轨;
    //     短滑(按键内滑动)绝不出现图标,没有任何干扰。
    //  ② 小锁出现于按键半径 × lockTargetK (约 78px 处,在指尖自然延伸范围内,不超屏)。
    //  ③ 手指滑入小锁激活范围 (距离目标点 <= lockRadius) 时,小锁点亮为高亮荧光黄 (进入就绪态)。
    //  ④ 在小锁处【松开手指】,才是正式触发锁定!中途滑回松手则不锁定 (仅作普通瞄准打出)。
    // 语义保持不变: 锁着时任何一次短滑 = 解除锁定 (白环中性反馈); 长滑同向 = 维持、反向 = 换向。
    lockAppearK: 1.0,
    lockTargetK: 1.7,
    lockRadius: 28,
  },

  // 键位表(桌面端按 e.code 绑定,跨布局稳定;每项可给多个候选)
  // 击球键自带落点与弧线:J(swingFar)=右滑深球压底线,K(swingNear)=左滑短球放网前,
  // U(swingUp)=上滑挑高,I(swingDown)=下滑平抽 —— 与触屏四向滑动手势一一对应。
  // 触屏合并为单个击球键 + 滑动手势;键盘仍保留对应键(桌面不缺键位)。
  // 移动只占用方向键,跨步是独立一键(lunge):方向由输入层按「最近的方向键」解出。
  // 旧的「双击方向键跨步」已删 —— 对拉时快速换向会稳定凑成双击,误触代价是一次带恢复期的爆发位移。
  // 触屏端的虚拟按键在输入适配层映射到同一套语义,不另立第二张表
  keys: {
    p1: { left: ["KeyA"], right: ["KeyD"], jump: ["KeyW"], lunge: ["KeyL"], swingFar: ["KeyJ"], swingNear: ["KeyK"], swingUp: ["KeyU"], swingDown: ["KeyI"] },
    p2: {
      left: ["ArrowLeft"], right: ["ArrowRight"], jump: ["ArrowUp"], lunge: ["Comma"],
      swingFar: ["Slash"], swingNear: ["Period"], swingUp: ["Semicolon"], swingDown: ["Quote"],
    },
    sys: {
      pause: ["Escape", "KeyP"], restart: ["KeyR"], back: ["KeyQ"],
      mute: ["KeyM"], music: ["KeyN"], confirm: ["Enter", "Space"],
      up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
      shop: ["KeyB"],    // 主菜单开生涯中心
      drills: ["KeyT"],  // 主菜单开训练场
    },
  },

  // 跨步救球:朝「最近的方向键」那一侧爆发一段距离,判定区扩大。
  // 位移 = speed × duration;原 12×14=168px 占半场近 1/3 落点难控,缩到 15×6=90px。
  // speed 必须明显高于 player.vmax(9.2):跨步是「爆发」位移,慢了不如自己跑过去。
  // 爆发结束后不再有慢速恢复期(旧 35% 钳制会瞬间急刹,移动中跨步比干跑还慢),
  // 只用 cooldownFrames 限制连点:连点跨步的平均位移速度(90/(6+10)≈8.4px/帧)
  // 略低于全速跑,单次爆发则远快于跑 —— 激励「时机爆发」而非「永动冲刺」。
  // 跨步后短时间内击球可触发力度强化(shotWindow/shotBoost/shotPowerDeg)。
  lunge: {
    speed: 15,              // 跨步爆发速度(px/帧,约为 vmax 的 1.6 倍)
    duration: 6,            // 跨步持续帧数
    // 空中按下同样有效(2026-10-04 起真人跳跃中可释放):冲量照给读作空中突进,重力不动,
    // 冷却 48 帧 > 满跳滞空,一次起跳至多一次;AI 保持落地门槛(见 skills.canActivate)
    reachMul: 1.55,         // 判定区半径倍率
    cooldownFrames: 48,     // 跨步冷却(48帧 ≈ 0.8s,支持短CD快节奏多次救球)
    shotWindow: 60,         // 跨步后特殊击球窗口(60帧 = 1 秒,身上带风道粒子动画)
    shotBoost: 3.0,         // 窗口内强化重击初速加成(适度提速,兼顾长相持与终结)
    shotPowerDeg: 6.5,      // 窗口内额外压弧度
    // ===== 2026-10-04 一键化:跨完步自动回球 =====
    // 用户现场:「点完跨步再去点击打,在手机上操作其实有点不太方便」—— 触屏上 swing 与 lunge
    // 同排(`touchpad.ts` 右簇),两下要在几十毫秒内踩准,误触代价是整分。这是纯操作税。
    // 现在按下跨步 = 冲过去 + 把这一拍打完。语义与闪现同一条路(技能状态机自己起手),
    // 但**刻意不给必中**:那一拍仍走 tryHit 的真实判定,走位误差照样决定质量档级。
    autoReturn: true,       // 一键化总闸:false = 退回旧行为(跨过去、击打仍自己按)。要整套撤掉只改这里
    autoWindow: 45,         // 自动回球待发窗(帧,0.75s):按下跨步到"该按的那一拍"之间的人球时间差全得盖住,
                            // 30 帧实测只能覆盖半场来球(远的那一半直接放弃承诺)。过期不起手就交还手动
    autoHorizon: 40,        // 起手前瞻帧预算(只需看见 PRESS_LEAD+余量那一帧;与落点前瞻是两件事)
    autoLandHorizon: 90,    // 判"这球会不会出界"能看多远(帧):高远球 40 帧内根本不落地,用短窗会把出界球漏过来捞
    autoAim: 0.8,           // 自动那一拍的落点深度(0..1;取 C.aimDepth 同一张表的刻度:mid 0.5 / deep 0.92)。
                            // 为什么是 0.8:用户要"默认压深",但直接给 deep 会把救球送出对方底线 ——
                            // 132 格"可救来球"实测 deep(0.92)= 3 格出界、0.8 = 0 格出界,而落点深度
                            // 已经有 0.75(整场的 3/4 处),mid(0.5)只有 0.49 等于还给中场。
                            // 想改长短仍然一句话:窗口内点击打键横滑,手动那一拍永远压过自动这一拍。
    autoOutMargin: 8,       // 要飞出边线的球不替玩家捞:落点越出界外这么远才算"该让它落地"
                            // (对手失误送的分不该被自己这一拍救回去 —— 那是把分还给人家)
    autoSettleGrace: 2,     // 球在"最近逼近帧"之后至少还要活这么多帧才起手。峰值追账(tryHit 头注)只记账
                            // 不出手,要等球**离开判定区**或走完窗才结算 —— 球先落地,这一拍永远结不出来:
                            // 人物明明扫到球,分还是丢了,读起来就是"它替我挥了个空"。
                            // 实测(132 格可救来球):0 帧 27 格空挥 / 救到 90;2 帧 24 格空挥 / 救到 92;
                            // 3 帧 20 格空挥但只救到 87 —— 2 帧是拐点。剩下的 24 格连"完美手动两拍"也救不到
                            // (球在挥拍窗口打开前就死了),那条豁免写在 tools/lunge-check.ts 的 ①。
    reachTailMul: 1.2,      // 待发窗内判定区倍率。冲量期吃满 reachMul(1.55),但球真正被打到通常在冲量结束之后
                            // —— 尾段不给一点,跨步"手变长"这个卖点就从来没作用在真正那一拍上(旧行为正是如此)
    // --- 跨步残影与破风表现 ---
    ghostFrames: 14,        // 跨步残影留存帧数
    ghostInterval: 2,       // 产生残影的帧间隔 (每2帧一记)
    ghostAlpha: 0.45,       // 残影初始最高透明度
    castPunch: 1.025,       // 技能起手镜头微推
    castShake: 3,           // 起手轻微震动
    castFlash: 0.22,        // 起手微光闪烁
    // --- 深跨步姿势(纯视觉):前膝深弯、髋沉、后腿蹬直的下肢剪裁 ---
    dip: 14,                // 髋部下沉量(px):引导腿深弯的来源(legIK 反解)
    lean: 14,               // 躯干沿跨步方向的前倾(度;退防跨步为负 = 后仰)
  },

  // ===== 自动击打(辅助模式):系统替真人起手每一拍 =====
  // 择帧与上面三条一键化**共用同一条** autoSwingDue(p, ball, "auto"),只是没有"窗"——
  // 逐帧轮询。语义:玩家只管移动、瞄准(击球键横滑/纵滑照旧有效)和放技能;发球仍归玩家。
  // 用户口径「不打折」:机器借的是时机不是判定 ⇒ 不给必中(不碰 flashStrikeT)、
  // 不给手长(绝不写 lungeAutoT,那会白吃 reachTailMul)、不压 sweet/perfect 档。
  autoHit: {
    enabled: true,          // 代码侧总闸:发版想整套关掉这功能只改这里(玩家侧开关在 Settings.autoHit)
    // 生效模式:对练 / 闯关 / 无限练习。训练场与新手教学**刻意排除** —— 那两处判的就是
    // "你会不会这一拍"(Drill.matches 连球种与手势都要查),被代打等于把判据糊过去;
    // 本地对战/双打同样排除:那是两个真人,替一个就等于替另一个。
    modes: ["1p", "campaign", "endless"] as string[],
    autoAim: "mid",         // 代拍起手的落点档。**给字符串 "mid" 而不是 C.lunge.autoAim 那种数值
                            // 深度**:真人点按拿到的就是 "mid"(pad.buildIntent),而 "mid" 才会走
                            // buildShot 的网前自适应扑推、才会上报 ShotResult.aim ⇒ 与手动逐位同路。
                            // 玩家滑过的方向由 update 的 aimOverride 在同一帧覆盖上来(深浅 + 高低)。
    // --- 以下四个门控数与 lunge / skills.smash / skills.rage **必须逐字相同** ---
    // (共用一把尺子的代价就是分叉要连判据一起改:rage-check ⑭ / smash-check ⑯ / auto-hit-check ⑨)
    autoHorizon: 40,        // 起手前瞻帧预算
    autoLandHorizon: 90,    // 判"会不会出界"能看多远
    autoOutMargin: 8,       // 要飞出边线的球不替玩家捞
    autoSettleGrace: 2,     // 球在最近逼近帧之后至少还要活这么多帧才起手
    // --- 每球限次(这条一键化独有的门控,那三条由"起手即清窗"免费提供限次)---
    // 为什么必须有:flightFramesToClosest 从第 0 帧起扫,球已在判定区心时 fc = 0 当即判"该按"。
    // 于是"玩家按早挥空 → 系统补一拍"会一路补下去,读起来就是人物自己乱挥。取 2 =
    // 允许一次"没接住再救一次"(辅助模式不该罚玩家挥空),但挡住第三次。判据 ⑧。
    maxTriesPerBall: 2,
    // 代拍起手那一帧的场边飘字:回答"为什么人物自己动了"(看不见的状态会被读成 bug)
    castFloat: { text: "自动", color: "#ffe14d", size: 14, life: 30 },
    // --- 键面模式读数:自动开着就把击球键的键名换成这两个字 ---
    // 为什么改键名而不是在徽标后面缀「· 自动」:那个 Label 只在**有来球**时才有内容,
    // 发球/死球/暂停时整颗键看不出"这键不由你按",而玩家恰恰在那几拍最容易困惑。
    // 同一信息只说一次 ⇒ 徽标的 autoSuffix 已删,球种徽标只报球种。
    // keep = 浓度下限,走 pad-cd.alphaFloor 同一套理由(淡出的是按键,不是"现在什么状态"这条信息):
    // 照旧乘 Settings.padAlpha 的话滑杆拉到底,这两个字就没了 —— 判据 pad-cd-check。
    padLabel: { text: "自动", color: "#ffe14d", keep: 0.8 },
  },

  // ===== 动态技能系统(数值集中管理,纯数据) =====
  skills: {
    list: [
      {
        id: "lunge",
        name: "强力跨步",
        shortName: "跨步",
        tag: "敏捷突进",
        desc: "快速滑步突进救球，跨完自动回球，并短时激活强力暴击状态；跳跃中同样可释放",
        unlockLevel: 1,
        cooldownFrames: 48,  // 0.8s
        accent: "#38bdf8",
        icon: "lunge",
      },
      {
        id: "smash",
        name: "百分百重击",
        shortName: "重击",
        tag: "绝杀附魔",
        desc: "球拍聚能爆发烈焰，来球就位自动轰出暴扣，无视高度必定重扣；挥空不进冷却",
        unlockLevel: 2,
        cooldownFrames: 210, // 3.5s
        accent: "#f43f5e",
        icon: "smash",
      },
      {
        id: "flash",
        name: "闪现扣杀",
        shortName: "闪现",
        tag: "空中折跃",
        desc: "折跃瞬间时停悬空，闪至羽毛球下方高点，必定凌空劈扣",
        unlockLevel: 3,
        cooldownFrames: 300, // 5.0s
        accent: "#eab308",
        icon: "flash",
      },
      {
        id: "magnet",
        name: "引力吸球",
        shortName: "吸球",
        tag: "空间掌控",
        desc: "展开重力力场，将全场羽毛球瞬间抓回拍前强力回抽；空中释放直接转跳杀",
        unlockLevel: 4,
        cooldownFrames: 360, // 6.0s
        accent: "#a855f7",
        icon: "magnet",
      },
      {
        id: "focus",
        name: "时空减速",
        shortName: "时空",
        tag: "领域掌控",
        desc: "开启时空子弹时间，自身高速穿梭，接球后强力反击并脱离领域进入冷却",
        unlockLevel: 5,
        cooldownFrames: 270, // 4.5s
        accent: "#06b6d4",
        icon: "focus",
      },
      {
        id: "shadow",
        name: "影分身",
        shortName: "分身",
        tag: "影遁协战",
        desc: "凝出三个影分身各守一方，颜色各异；各自接三球后消散，跨回合未耗尽则补满",
        unlockLevel: 6,
        // 名义冷却:真闸是「每分一次」flag + 分身在场,而 resetPoint 每分都把 cd 清零,
        // 这个倒计时几乎不会出现在键面上 —— 只防分身刚消散的同一帧被连点
        cooldownFrames: 60,
        accent: "#8b5cf6",
        icon: "shadow",
      },
      {
        id: "rage",
        name: "怒气重击",
        shortName: "怒气",
        tag: "越战越勇",
        desc: "越打越满最多攒 3 管，按一下耗一管；满管必定暴扣，不满一管也能放零头",
        unlockLevel: 7,
        // 名义冷却:这款的门槛**不是**冷却而是怒气资源本身(攒 = 出手权,浪费一发就是真代价),
        // 20 帧只挡同一帧连点。同影分身那条先例,且 resetPoint 每分把 cd 清零 —— 别指望它当闸。
        // 键面因此走「蓄能环 + 百分比」(kind: "charge"),不画倒计时、永不变灰。
        cooldownFrames: 20,
        accent: "#f97316",
        icon: "rage",
        kind: "charge",
      },
    ],
    // 技能键「就绪但门槛未满足」的原因文案(skills.skillBlockReason 判定,touchpad 键上方显示)
    blockText: {
      swinging: "挥拍中",
      lunging: "跨步中",
      buffing: "附魔中",
      notIncoming: "球没过来",
      lowBall: "球不够高",
      pulling: "牵引中",
      focusing: "领域中",
      shadowActive: "分身在场",
      shadowFull: "分身满编",
      shadowNoMode: "此地不召",
      shadowUsed: "已召唤",
      rageArmed: "重击中",
      rageLow: "怒气未聚",
    },
    // 各技能专属机制数值
    smash: {
      buffDuration: 240,    // 附魔激活后持续 4 秒(未击球时维持)
      speedBoost: 4.0,      // 极速加成
      powerDeg: 14,         // 强制压角
      // ===== 2026-10-04 一键化:按下重击自动兑现,挥空不罚冷却 =====
      // 用户原话:「点击之后如果球在可打击范围内,就也会自动击打(如果挥空不会冷却)」。
      // 旧口径按下只「上弦」,那一拍仍要玩家自己在几十毫秒里踩准时环 —— 手机上这是纯操作税,
      // 而技能键与击球键同排在右簇。现在按下 = 上弦 + 到点替玩家把那一拍轰出去,
      // 形状与「跨步一键自动回球」完全同一条路(共用 player.ts 的 autoSwingDue 择帧尺子)。
      autoReturn: true,     // 一键化总闸:false = 退回旧行为(只上弦,那一拍仍自己按)。整套撤掉只改这里
      autoWindow: 140,      // 待发窗(帧,2.3 秒):按下到"该按的那一拍"之间的人球时间差,窗内才代那一拍。
                            // 为什么不跟跨步一样取 45:重击的正当用法是「预开启」—— 常在对方刚出手、
                            // 球还在对面半场时就按下去。实测(AI vs AI 各 12 模拟分钟、每档 ~1000 拍,
                            // 量「对方出手 → 接手方的『就是现在』帧」):标准档(s=0.92)中位 32 / p95 53
                            // / 最远 84;球速拉到「极限慢」(s=0.6,手机上很多人用这档)中位 52 / p95 79
                            // / 最远 135,且 19 拍超过 100 帧。取 140 = 盖住最慢档的最远一击还留余量;
                            // 窗短一格,慢档玩家就会原地重演"按了没反应"。判据 tools/smash-check.ts ⑯
                            // 上限是 buffDuration(240):窗长过附魔,就会在没附魔的帧上代一记普通球。
      autoAim: 0.8,         // 自动那一拍的落点深度(与 CFG.lunge.autoAim 同刻度:mid 0.5 / deep 0.92)。
                            // 0.8 是跨步那轮量出来的拐点(deep 0.92 会送出界,0.8 实测 0 格出界),
                            // 重击压得更狠,同刻度才不会把"默认压深"做成"默认出界"。
                            // 想改长短仍然一句话:窗口内玩家自己按击打键,手动那一拍永远压过自动这一拍
      autoHorizon: 40,      // 起手前瞻帧预算(与跨步同一把尺子,不是两份数值 —— 别在这里各调一遍)
      autoLandHorizon: 90,  // 判"这球会不会出界"能看多远(帧)
      autoOutMargin: 8,     // 要飞出边线的球不替玩家捞:对手的失误就该是这分
      autoSettleGrace: 2,   // 球在"最近逼近帧"之后至少还要活这么多帧才起手(峰值追账要等结算)
      cdOnConsume: true,    // 冷却推迟到真正扣出去那一拍才付:按下/挥空都不进冷却(用户点名这条)。
                            // 只给真人 —— AI 的技能循环归 diffs 管,别顺手把它的难度也放宽了
      castPunch: 1.05,      // 技能起手镜头聚推
      castShake: 6,         // 爆气震屏
      castFlash: 0.55,      // 金红白闪
      auraRadius: 28,       // 身体升腾斗气扩散半径
      flameTongues: 6,      // 球拍烈焰火舌数
    },
    flash: {
      // 触发门槛:球离地至少这么高才点亮按键(只有进攻位的球才配折跃)
      minHeight: 115,
      speedBoost: 3.8,      // 闪现扣杀出球速度加成
      powerDeg: 12,         // 闪现下压角
      // ===== 2026-09-30 机制重做 =====
      // 旧写法把脚底瞬移到「球后方 28px / 球上方 15px」,而判定区圆心在脚底上方约 73px ——
      // 球永远落在圆心下方 ~88px,超出判定半径,于是「闪现」稳定变成「闪失」。
      // 现在站位由 skills.activate 的 flash 分支拿 Physics.strikeOffset(判定区圆心偏移)
      // 反解脚底,再叠一层保底接触窗口兜住贴网/贴墙被边界夹走、以及极高球顶到悬空上限的情形。
      holdFrames: 5,        // 折跃后滞空蓄力帧数:悬空举拍,不吃重力、不接受移动输入
      diveVy: 1.8,          // 起拍那一下的下降初速(世界 y 向下为正):被自己那记劈扣的惯量带下来
                            // —— 闪现后就在折跃位落地,而不是从高点松开重力慢慢飘
      strikeFrames: 10,     // 保底接触窗口(帧):起拍之后这段时间内球一定被扣出去
      guaranteedQ: 0.95,    // 保底接触上报的击球质量:直接吃到 sweet+perfect 那套反馈
      maxHover: 118,        // 悬空离地高度上限(px):比跳跃顶点(~92)略高,是"跃至空中"不是浮在三层楼
      ghostFrames: 22,      // 人物身上雷光/残影停留帧数(纯视觉,不参与判定)
    },
    magnet: {
      pullFrames: 9,        // 吸球牵引时长 (约 0.15s 迅速吸至身前)
      speedBoost: 3.2,      // 吸球反弹初速加成
      reboundDepth: 0.92,   // 默认强抽对方深场
      castPunch: 1.045,     // 镜头向身前推近
      castShake: 5,         // 引力引爆空间颤动
      castFlash: 0.45,      // 紫色引力闪烁
      arcBranches: 3,       // 抓取羽毛球的引力电弧束数
      vortexRadius: 24,     // 拍前引力吸积漩涡半径
    },
    focus: {
      duration: 180,        // 领域上限 180 帧 = 3 秒(未击球时的保底持续超时)
      postHitFrames: 16,    // 接完球后缓释收尾帧数(~0.27s 仿真 / slowmo 0.35 下 ~0.76s 慢特写出球,击球后稍早收场)
      ballSlow: 0.35,       // 球速减速至 35%
      rivalSlow: 0.40,      // 对手移速减速至 40%
      // ===== 2026-10-05 领域内"接得到球"的两条折算(用户现场:「挥拍很难击中球了」)=====
      // 领域把世界拖到 ballSlow 步/真实帧,挥拍却按真实时间走(player.update 的 focusTimeStep)。
      // 于是"玩家侧的帧预算"与"世界步"分属两个时钟,判定区这条几何量也必须跟着走:
      // ① 来球速度按**真实速率**看(球慢到能看清,就不该再按世界步速度把区子收到 0.62);
      // ② 拍头每真实帧扫过的弧长是平时 2.9 倍 ⇒ 判定区放宽 zoneReachMul(口径同跨步 reachMul:
      //    手变长是因为扫掠范围变大,不是把命中窗拖长 —— 后者会让收完拍还把球打走)。
      // 放宽幅度由 tools/focus-window-check ④ 钉住:领域内容错(折算成真实帧)必须 ≥ 领域外。
      zoneReachMul: 1.25,
      playerSpeedMul: 4.2,  // 施法者时空领域内移速倍率(对抗 slowmo 0.35 并赋予超速跑位,现实体感达平时 1.47 倍)
      playerAccelMul: 4.5,  // 施法者起步加速度倍率(起步瞬时响应,高速变向不拖泥带水)
      // 领域内击球强化: 初速与压弧大幅强化, 并赋予顶档 sweet/perfect 品质
      speedBoost: 5.0,      // 领域内击球初速加成(由 3.6 强化至 5.0)
      powerDeg: 14,         // 领域内额外压弧(由 10 强化至 14,更凶险的平抽下压)
      castPunch: 1.045,     // 时空张开镜头推近
      castShake: 6,         // 时空波纹震颤
      castFlash: 0.40,      // 青碧色时空闪光
      hitShake: 16,         // 接球强力反击震屏强度
      hitPunch: 1.065,      // 接球强力反击特写镜头推近
      chronoGhosts: 4,      // 羽毛球慢动作时空残影重数
      vignetteAlpha: 0.28,  // 全屏时空领域暗角强度
      cdOnExpire: true,     // 效果完全结束(接球缓释或超时)才开启冷却倒计时
    },
    shadow: {
      // ===== 影分身(2026-10-04 上线;2026-10-05 按用户口径改成"会累积的影子防线")=====
      // 用户原话:「上一局的影分身，它可以保留到下一局 而不是会直接消失，场上最多可以有三个影分身。
      // 不同影分身上的颜色是不一样的，默认的是紫色嘛，有新的第二个可以是其他的颜色。」
      // 追问后定死四条口径,改动前先对着读:
      //   ① 边界 = 跨**回合(一分)**。不跨对局、不落盘:重开新局仍由 rules 的 R.players = [] 整批丢弃
      //   ② 每个分身仍是「接满 3 球就消散」;但带着未用满的额度活到下一回合的,**额度补满回 3**
      //      —— 已经接满、正在消散的那个**不复活**(否则等于把"接三球消散"这条偷偷改掉)
      //   ③ 同场最多三个,由下面 slots 的长度决定(**不单开 maxClones 键**:两条旋钮管同一件事必然分叉)
      //   ④ 本体保持纯黑剪影,颜色只加在轮廓辉光 / 头顶次数片 / 召唤粒子 / 球拍
      slots: [
        // tint = 这一号分身的身份色(渲染从 entity.theme.glow 读它,不另开跨层字段)
        // homeOffset = 相对球网的站位(px):左队往自家后场为负,右队取反。0 号就是 0.0.28 那个唯一分身的位置
        //
        // 三个分身**各守一块防区**是这张表存在的首要理由,不只是好看:AI.think 在 RALLY 里会让所有分身朝
        // 同一个拦截点跑,不分区就是三坨黑剪影叠在同一个点上 —— 颜色分辨不出来、9 份额度全砸在同一块地面、
        // 另外两块照样丢。分区之后"多召一个"才真的多一块地面。
        { tint: "#8b5cf6", diff: "normal" as DiffKey, homeOffset: -200 },  // 0 号 后场
        { tint: "#06b6d4", diff: "normal" as DiffKey, homeOffset: -115 },  // 1 号 中场
        { tint: "#eab308", diff: "normal" as DiffKey, homeOffset: -35 },   // 2 号 网前
      ],
      // 防区分段边界**不在这里再写一份数字**:由相邻 homeOffset 的中点现算(core/shadow.ts 的 dutySlotOf)。
      // 抄一份阈值就是第二条尺子,改站位的人必忘改它 —— 症状是"网前那枚永远当不到值",静默不报错。
      dutyByZone: true,     // 每来球只让归属那枚追,其余守自己的 homeX。false = 退回"三个全追同一颗球"
      maxHits: 3,           // 分身成功回球 N 次后消散(玩家自己接球不计数)
      refillHits: true,     // 跨回合补满额度(用户口径)。false = 退回旧行为(额度只减不加,但仍在场)
      refillFlashFrames: 24, // 补满那一下的头顶亮片演出帧数(纯表现;由 shadow.updateClones 递减,逻辑层不设定时器)
      modes: ["1p", "campaign", "endless"] as string[],
      // 生效模式,与 CFG.autoHit.modes 同表同口径(两套闸各管各的,别互相"顺手复用")。
      // 训练场与新手教学**必须排除**:drill.ts 的 matches()/diagnoseFail 判的是 lastHitter/scorer 的**队**,
      // 不看是谁打的 ⇒ 分身回球会被判成"玩家练成了这一关"。旧写法被每分清场挡着,跨分保留之后这个洞就开了。
      // 本地对战/双打同 auto-hit 的理由:那是两个真人,替一个就是替另一个,而且各自能攒三个 = 同场六坨剪影
      spawnFrames: 18,      // 召唤演出帧(隔帧闪烁成影):演出期不接球,来球归玩家 —— 召唤不是无敌帧
      despawnFrames: 26,    // 消散演出帧(残影上飘):期间分身不再起拍,演完从 shadowClones 里摘掉
      despawnRise: 26,      // 消散上飘距离(px),读作"化烟而去"(旧写法把这个数写死在 render/world.ts 里)
      castPunch: 1.035,     // 技能起手镜头聚推
      castShake: 4,         // 墨烟震屏
      spawnPushBack: 14,    // 分身出生位在宿主身后偏移(px):从宿主影子里"拔出来"的读法
      pipLift: 28,          // 头顶 pips 离脚底的高度(px):要**高过头圈那一圈描边**
                            // (出图现场:取 16 时三片正好压在头顶那圈身份色描边里,读成"头发上
                            // 三道杠"而不是"剩余次数"—— 附属读数一旦和装饰同层就等于没了)
      glowR: 30,            // 轮廓尖刺辉光半径(px):画在黑剪影背后,是三色最主要的那一处分辨件
      glowAlpha: 0.5,       // 轮廓辉光浓度(拉到 0.95 会把亮球场糊成一片色块 —— shadow-preview 的反例钉这条)
      glowSpikes: 11,       // 辉光尖刺数(出生用 seed 定形,逐帧只缩放与衰减,禁止逐帧 rand)
      // inkInterval 已删:全仓零消费者的死配置(注释许诺过"每 20 帧掉一缕墨粒",渲染层从未实现)
    },
    rage: {
      // ===== 「怒气重击」(第 7 款,2026-10-04)=====
      // 用户口径:「和百分百重击像,也自动击球,但不是固定附魔,而是在击打过程攒怒气,
      // 特殊击打攒得更快,有上限,释放时怒气越满那一拍越狠,放完清零。」
      // 与重击的三条既定契约同构:① 消耗只挂真出手(!preview 闸) ② 一键代拍共用
      // player.autoSwingDue 那把择帧尺子 ③ 凡是"替真人打"的一律 !p.isAI。不另起一套。
      //
      // ---- 怒气经济:整数运算,1 点 = 1%(一管的 1%),满一管判据 rage >= max ----
      max: 100,             // 一管的容量 = 百分比分母。嫌攒得太快**只动这里**(→120 把一局释放次数
                            // 从 ~4 拉到 ~3.5);别动 perHit —— 那会断掉「1 点 = 1%」这条读法,
                            // 键面百分比与卡片「蓄满 N~M 拍」全成小数尾巴
      pipes: 3,             // 氮气式多管(2026-10-05 用户口径:「攒完第一个百分之百之后,还可以
                            // 继续攒第二个百分之百,第三个百分之百,最多三个」):总上限 =
                            // max × pipes = 300,满管判据 rage >= max 不变(有整管就能顶格放),
                            // 按一下只**消耗一管**(modifyShot 的兑现分支),余管保留到下一拍。
                            // 3 管攒满后溢出作废(gainRage 钳总上限)—— 跟漂移攒氮气一样,瓶满了就装不进
      perHit: 5,            // 每一记真实命中加这么多。口径 = 走过 player.settle 的那一拍:
                            // **发球不涨**(rules.ts 的发球直接 buildShot,不经 settle),攒不到怒气
                            // 是设计后果不是 bug,第一次试玩若报"发球怎么不涨"就指这一条注释
      sweetMul: 1.8,        // 物理档踩进甜蜜/完美 ⇒ 5×1.8 = 9 点(奖励"按得准",与 heat 同源那把尺子)
      smashMul: 2.0,        // 这一拍出手是扣杀/跳杀 ⇒ 10 点(奖励"敢进攻",跟越攒越狠形成正反馈)
      bothMul: 2.8,         // 又准又杀 ⇒ 14 点。**合并系数,不做 1.8×2.0=3.6 叠乘** ——
                            // 叠乘下一拍就 18 点,八拍的上限被六拍打穿,分档演出永远只见到满怒
                            // 四个乘数都必须让 perHit×mul 落在整数上(rage-check ⑮ 钉住,否则
                            // "1 点 = 1%" 断了,键面会印 78.5% 这种东西)
      // 定标(11 分制、回合均值 10 拍、真人整局约 55 拍;P(甜)≈0.35、P(杀)≈0.22):
      //   期望每拍 5×(1+0.28+0.22)=7.5 ⇒ 蓄满一管约 13 拍;整局期望 ~410 点 ≈ 4 管出头 ——
      //   攒着不放最多存 3 管(≈40 拍的量),连放三拍是它的上限体验。
      //   一个普通 10 拍回合 = 75% ⇒ 一回合能填满大半管(有意义),但一分打不满(除非拍拍甜区扣杀)
      rageMinRelease: 5,    // **释放门槛 = 一拍**。低于它按不出去(键面封条「怒气未聚」)。
                            // 为什么要有这条:资源制最坏的漏洞是 0 怒气也能放 —— 那就变成
                            // "每 20 帧白嫖一记 +speedMin 的球",不崩不报错、只会安静地变强。
                            // 用户拍的是「怒气够一点就能放」,门槛取一拍(不是 1/3 管)。
                            // 多管之后这条照旧管**零头小释放**:不满一管按 = 放出当前全部零头;
                            // 满一管再按则固定消耗一整管(强度顶格),门槛不参与那次分流
      // 四档下界(比例),**长度必须与下面 tiers[] 相等**:rageTierOf 返回的就是这里的下标。
      // 曾经写成 [0.35,0.67,1] 三段 —— 那是"三个档",而演出表有四行:于是 0.34 与 0.5 都落
      // 回下标 0、满怒落回 2,"四档"实际只有三档且最上面那档永远读不到(烟测抓到的现场)。
      tierAt: [0, 0.35, 0.67, 1],   // 0 微怒 / 1 升温 / 2 沸腾 / 3 怒极;末档恒 1 ⇒ 满怒必落最后一档
      // ---- 释放那一拍的强度:线性插值 speedMin + (speedMax-speedMin)·ratio ----
      speedMin: 1.2,        // 空怒边缘那一拍的初速加成(仍略高于普通拍,读作"这是一记重击")
      speedMax: 4.8,        // 满怒上限(高于重击的 4.0、与时空的 5.0 同级 —— 它要攒一整局)
      powerMin: 4,          // 压弧下限(度)
      powerMax: 18,         // 满怒压弧(重击/时空是 14;再凶由 forceSmash 的 loft≤10 夹住,不失控)
      // 老实说一句给改数值的人:初速这一路被 player.ts 的总闸
      // C.shuttle.maxSpeed(30) - C.shot.speedMax(25) = 5 夹死,满怒时 perfectBoost 3 + 4.8 早已越闸。
      // 所以 ratio ≳0.6 之上"更狠"是靠 **powerDeg / forceSmash / 误差归零 / 演出分档** 落地的,
      // 不是靠初速数字。别为了"看起来更凶"去动 maxSpeed —— 那归 pace/reach-check 那把尺子管,
      // 抬它等于同时改接球难度与 AI 可赢性两套基线。
      releaseWindow: 240,   // 按下释放 → 那一拍兑现的 armed 窗(帧,4 秒)。落进 s.buffT(与重击附魔
                            // 同一个字段位、同一处递减),不再另起一个计时器 —— 少一处双减风险。
                            // 窗走完不罚怒气(那一拍本来就没兑现)
      // ===== 一键化:与跨步/重击共用 player.ts 的 autoSwingDue 那一把择帧尺子 =====
      autoReturn: true,     // 总闸:false = 退回"按下之后那一拍玩家自己按"。整套撤掉只改这里
      autoWindow: 140,      // 代拍窗(帧)。与重击同一份实测(球速「极限慢」档最远 135 帧 ⇒ 取 140);
                            // 必须 ≤ releaseWindow,否则会在没 armed 的帧上代一记普通球(rage-check ⑭ 钉)
      autoAim: 0.8,         // 代拍那一拍的落点深度(与 CFG.lunge.autoAim / smash.autoAim 同刻度;
                            // 0.8 是跨步那轮量出的拐点,deep 0.92 会送出界)
      autoHorizon: 40,      // ↓ 这四条与 lunge / smash **必须逐字相同**(一把尺子、三份参数)。
      autoLandHorizon: 90,  //   判据 rage-check ⑭ 与 smash-check ⑯ 一起钉住,不许任何一侧分叉
      autoOutMargin: 8,     //   要飞出边线的球不替玩家捞:对手的失误就该是这分
      autoSettleGrace: 2,   //   球在"最近逼近帧"之后至少还要活这么多帧才起手
      // ---- 分档演出(特效基调=分级炫技:低档克制、满怒才炸)----
      // 下标 = Skills.rageTierOf(ratio)。**一行一档,数字与两句文案同住这一行**:起手字 castLab
      // 挂人物头顶(plate none)、兑现字 lab 挂场边(plate star)。分成 fx 段两组键
      // (rageCastFloatN + floatSkillRageN)的话,就会出现"某档有一行、另一档缺一句"的对不齐
      // 中间态 —— 它不崩、不报错,只是玩家某一档看见的是别的档的字。
      // shake/punch 填**绝对值**:world.shake 取 MAX、world.punch 是覆盖,填增量会随档位叠出
      // 不可复现的强度。触觉只复用 haptic 段现成的四档键 ⇒ haptic-check 那张单调表一个字不动
      // (不新增 HapticKey,那要动 core/haptic.ts 的联合类型与 haptic-check 的行数判据)。
      // hitstop 刻意不进这张表:让 fx 那条六档阶梯独家持有,少一个旋钮、少一处双真话。
      tiers: [
        {
          name: "微怒", castShake: 3, castPunch: 1.02, hitShake: 12, hitPunch: 1.04, haptic: "sweet",
          castLab: { text: "怒气涌动!", color: "#f97316", size: 22, life: 40, plate: "none" },
          lab: { text: "怒气重击!", color: "#f97316", size: 26, life: 50, plate: "star" },
        },
        {
          name: "升温", castShake: 5, castPunch: 1.03, hitShake: 15, hitPunch: 1.05, haptic: "smash",
          castLab: { text: "怒气升温!", color: "#fb8b24", size: 23, life: 42, plate: "none" },
          lab: { text: "怒气升温 · 重击!", color: "#fb8b24", size: 27, life: 50, plate: "star" },
        },
        {
          name: "沸腾", castShake: 8, castPunch: 1.045, hitShake: 18, hitPunch: 1.07, haptic: "sweetSmash",
          castLab: { text: "怒气沸腾!!", color: "#ff6a1f", size: 25, life: 44, plate: "none" },
          lab: { text: "怒气爆击!!", color: "#ff6a1f", size: 28, life: 52, plate: "star" },
        },
        {
          // 兑现字与 floatSkillFlash(闪现扣杀!! 32)同量级顶格:攒满一整局的那一下,
          // 字也得是全场最大的一档,否则演出分不出"这次不一样"
          name: "怒极", castShake: 12, castPunch: 1.06, hitShake: 21, hitPunch: 1.09, haptic: "perfectSmash",
          castLab: { text: "怒极 · 满溢!!", color: "#ffe14d", size: 28, life: 48, plate: "none" },
          lab: { text: "怒极 · 必杀!!", color: "#ffe14d", size: 32, life: 58, plate: "star" },
        },
      ],
    },
  },

  // AI 拦截高度带:站立够球上限 / 跳起够球上限 / 低位接球截面(px 离地)。
  // contact/contactDrift:球从「第一次降到可击高度」的点滑行到落点的水平距离
  // 超过 drift(平飘球,常见于网前短球/平抽)时,改等球下落穿过 contact 截面
  // 再接 —— 按过截面点站位,球会落在身后死角;陡坠球滑行小,维持原截点。
  // scramble*:够不到时的「扑救俯冲」表现(只给渲染读,不改判定区/不影响平衡)—— AI 判定
  // 这一球赶不上时置 scrambleT,人物做一次前倾伸臂的鱼跃,读作「拼了但没够到」。
  // backBias:拦截站位向后墙方向偏移(px)。侧视球场角色恒面向球网,判定区圆心在身前
  // radius*0.34≈25px 处,身后完全盲区。高远球落点深,球常落在 AI 脚下或身后一两步,
  // dx < -r*0.34 的「背后死角」检查直接拒掉,AI 永远不起拍(实测入门档高远发球漏接 40%)。
  // 向后墙偏 25px 让球落在身前判定区圆心附近,正常来球不受影响(仍在区内)。
  aiReach: { stand: 140, attack: 182, jump: 236, contact: 72, contactDrift: 48,
    scrambleFrames: 16, scrambleLean: 9, scrambleDip: 14, backBias: 15 },

  // ===== AI 预判(read):它每记来球只「认定」一次站位偏差,之后一路认账 =====
  // 旧写法是每次重规划(tick 帧一次)重掷 ±aimErr —— 均值归零,几次重规划下来
  // 收敛到真实落点,92px 这个数字等于没写(用户反馈「入门 AI 怎么都能接住」的根因之一)。
  // 改成每记球掷一次并死守之后,误差真的会让人跑错地方。代价是不能再照搬旧数字:
  // 同一个 92 不抵消了,杀伤力大得多,所以整体收小。
  // hard 系数量化「这一拍有多难读」,把误差压回难球上:慢高球只吃 readFloor 那一档
  // (对拉回合照样打得起来,用户明确要保留长回合),快球 / 需要长距离跑位的球才吃满。
  // 速度口径复用 swing.zoneFullSpeed / zoneTightenSpan —— 与 player.strikeZone 那条
  // 「来球越快判定区越小」是同一个词汇,不另立一套"快"的定义。
  aiRead: {
    runRef: 260,        // 跑位距离参考(px):要跑这么远就算"难读"的球
    speedMix: 0.62,     // 难度构成:速度项权重(其余给跑位距离)
    hardMax: 1,         // 系数上限(误差封顶就是 diffs.read)
  },

  // ===== AI 体力:按真实动作记账(不再数拍数) =====
  // 一回合一本账:AI 每一次**真实击中**记一次(入口 ai.ts noteHit,rules.applyShot 在 rally++
  // 同一处调它;持球发球与挥空都拿不到起手快照,天然不掉)。
  // 为什么不再是 rally/span 那种数拍子曲线:发球本身也 rally++(rules.ts:556),于是玩家
  // 一发球血条就动一格、他站把那球回过去又动一格 —— 掉得又快又说不清为什么(用户现场:
  // 「我发球他掉一下,他接球又掉一下」)。体力该由「这一拍有多费力」决定,不是第几拍。
  // ===== 2026-10-02 温和档重标(用户现场:「随便什么接球就掉一大管」)=====
  // 常规拍一律免费(base 0 + runFree 抬高):站定接普通发球/普通对拉血条不动;
  // 只有真被拉开(大跑位)、狼狈救球(跨步/腾空)、特殊球(接重杀/接劈吊)、自己发力才扣;
  // 轻松拍(慢软球且没怎么跑)回气。极费力的回合(连续救球/全程被拉开)才见底。
  // 账本口径:主力是 run(这一拍被拉开多远),第二项是 power(来球有多重),两者正交;
  // 判「重不重」只吃 Physics.classify 的 kind/power,不另立第二套"快"的定义(同 aiRead 的纪律)。
  // capacity 是**唯一标定旋钮**,顶穿 ai-check 红线时只挪这一个数,别逐项调权重。
  aiStamina: {
    capacity: 135,       // 一回合的体力总额;血条 = 1 − 已花/此值(唯一标定旋钮;一格 = capacity/5 = 27)
    base: 0,             // 站定把普通球回过去 = 免费:接发/对拉不再掉血(用户现场「我发球他接球也掉」)
    runK: 10,            // 每多跑 100px 加这么多(主力项,只对超出免费档的部分计费)
    runFree: 70,         // 起手离防区中心 ≤ 此值视作站位微调,不收费:小碎步不花钱,被拉开才收费
    powK: 20,            // 来球每重 10 点力度加这么多(第二连续项)
    powFree: 18,         // 来球力度 ≤ 此值不收费(重杀/快球才吃得到)
    lunge: 12,           // 跨步救球那一拍(shot.lungeShot)—— 最狼狈的动作,要明显
    air: 8,              // 腾空击球(shot.airborne)
    jumpSmash: 4,        // 跳杀额外(蹬地 + 发力,叠在 air 上)
    skill: 5,            // 用了技能那一拍(shot.skillKind)
    ownSmash: 3,         // 自己发力扣杀
    recvSmash: 12,       // 接住一记重杀(来球 kind)—— 用户点名要的「特殊球才掉」
    recvSlash: 3,        // 接劈吊(要急停)
    give: -8,            // 轻松拍的回气量(整拍成本直接取这个数,≈6%,要看得见回升)
    softKinds: ["lob", "netshot", "clear"] as ShotKind[],  // 「慢软球」= classify 的这三个球种
    softRun: 80,         // 且起手离防区中心 ≤ 此值,才叫「没怎么跑」(门槛放宽,轻松拍更容易触发)
    maxBeat: 20,         // 单拍扣减上限 < 一格(27):最狼狈的一拍也不掉满格,消灭「掉一大管」
    minBeat: -8,         // 单拍回气上限
  },

  // ===== 疲劳 → 行为的耦合(与上面那本账解耦:这边只管「累了会怎样」) =====
  // 满疲劳(P=1)时:readErr 放大 (1+readMul) 倍 · 时机误差 +timingAdd 帧 · 跑位降速 speedMul。
  // 不碰物理与判定区几何 —— 「慢球仍能对拉」的性质不变,只是累起来之后开始漏。
  aiPressure: {
    readMul: 0.95,     // 满疲劳时 readErr 额外放大的比例(1.0 = 翻倍)
    timingAdd: 4,      // 满疲劳时额外时机误差(帧,正 = 更易漏)
    speedMul: 0.10,    // 满疲劳时跑位降速比例(腿沉了:不是接不到,是慢半拍)
    // 力竭**大演出**的行为闸门:血条掉到底(≤0.04)不等于这一档真的废了 —— easy 的 crush 只有
    // 0.5,那条"力竭"只是本档一半的疲劳。放不加闸,满屏「对手力竭!」还在稳稳接球。
    cueFloor: 0.6,
  },

  // ===== AI 体力能量槽 (boss 血条规格:下挂在 AI 比分卡底缘,与卡对齐) =====
  // 5 段斜切槽当**刻度**,血量是连续滑过去的填充(hud.ts 缓动 + 掉血残影),
  // 随连击压力 S.pressure 扣减(展示层按本档 crush 归一化,三档都能看到全程变化 ——
  // 否则 hard(0.55)永远 4~5 格、easy(0.5)永不力竭)。从前一格一跳,玩家打完整回合
  // 才看见掉了一格,「在消耗」这件事根本读不出来。
  // 分档色与 game-root 的阶段线同源:充沛(>0.6 青黄) → 消耗(>0.2 橙) → 危险(红) →
  // 力竭(≤0.04 暗槽慢闪红框)
  aiStaminaBar: {
    plateW: 176,       // 底板宽 = 比分卡 196 左右各内缩 10(对齐而不越界)
    plateH: 22,        // 底板高
    drop: 5,           // 底板顶缘到比分卡底缘的缝
    padX: 8,           // 底板左右内边距
    labelW: 26,        // 「体力」标签列宽(段槽从它右边开始)
    h: 12,             // 单段高
    segments: 5,       // 5 段斜切小方块
    gap: 3,            // 格间距
    skewDeg: 8,        // 斜切角:与比分卡同一把尺(从前 6/13 ≈ 25°,和卡不像一家人)
  },

  // AI 难度:全部走同一套挥拍机制,只是**看走眼更狠、判定区更窄、出手更不准**
  // read=站位认定误差(px) · zone=单打判定区缩放(双打再与 doubles.aiZone 取 min)
  // shotErr=出球落点误差(px,进 player.buildShot 的误差预算,会下网/出界)
  // composure=情绪修正闸门(0=落后不会变强;见 ai.ts emotionModifiers)
  // crush=连击压力闸门(0=完全不吃压力;见 ai.ts pressureOf) · notice=接球反应延迟帧(拟人)
  // softGate=轻松拍回气闸门(0=接软球也不回;见 ai.ts noteHit 的负成本)
  // 数值口径:ai-check 的真人替身(走位 ±35px、反应 10 帧、时机早 5/晚 10 帧)打出
  // easy 53% / normal 34% / hard 28% / expert 12% 的得分率(25 局基线,2026-10-03 重校准)。
  // 改任何 diffs.* 都要重跑 ai-check 连同替身口径一起看,贴线断言的余量校准用 AI_CHECK_MATCHES=25。
  //
  // ===== 2026-10-03 四档整体重校准(用户现场:大师档打 100 拍 0 分) =====
  // 旧值 hard crush=0.3:AI 几乎不累,长回合里 99% 挥拍命中率,真人打不穿。
  // 四档防守参数原来挤在很窄的带里(zone 0.93~0.98 / shotErr 12~70),主要靠 crush 拉开,
  // 而 easy 的 shotErr=70 是"AI 自己打飞送分"——不是好设计,且与 normal(14)断层 5 倍。
  // 这次重铺:四档 zone 统一下移并拉开(0.88/0.86/0.90/0.92)、shotErr 均匀阶梯、
  // crush 恢复正常>hard 的差距(0.85 vs 0.55 = 0.3 差,原 1.0 vs 0.3 = 0.7 太极端)。
  // hard 的 crush 0.3→0.55 是核心:AI 现在会在长回合里累、开始漏球,玩家打得穿。
  // 回滚成旧行为(逐项精确复现):speed 填回 0.90/0.94/1.00/1.02、read 45/35/32/26、
  // zone 0.93/0.94/0.96/0.98、shotErr 70/14/12/10、crush 0.5/1.0/0.3/0.15。
  //
  // expert(极限)是给通关玩家的天花板档:不再靠 read/shotErr 拉开(那两格 hard 已收得很窄,
  // 再压只会把 AI 变成不会出手的稻草人),改压「时机与反应」—— tick 重规划更勤、起手误差
  // 只剩 2 帧、愣神 1 帧、判定区收满,加上更抗疲劳(crush 0.3)与完全看风下手(windSense 1)。
  // windSense=这一档**看风下手**的程度(0=一味不补,1=补满 aiWindDepth):
  // 出球解算的 "aim" 口径故意不认风(见 physics.ts 的 IntegrateIntent),所以风会真把
  // AI 的球吹偏 —— 从前它一味不补,风关(第 1 关)等于自杀式送分:用户现场
  // 「他发球我就得分了、他根本不会根据风向来进行适配」。
  // 入门档刻意**留一点**(0.25 而不是 0):第 1 关正是玩家学风的地方,对面要是一点都不
  // 适配,风就变成"AI 自己会输"而不是"玩家要读的方向";补太满又把机制从玩家手里拿走
  // (极限 1 是满补 —— 想赢极限档,风这层红利就不存在了)。
  diffs: {
    easy:   { label: "简单", tick: 20, speed: 0.90, read: 45, readFloor: 0.62, zone: 0.88, shotErr: 50, timingErr: 9, aggr: 0.12, composure: 0, crush: 0.5, notice: 5, windSense: 0.25, softGate: 0 },
    normal: { label: "普通", tick: 14, speed: 0.91, read: 42, readFloor: 0.40, zone: 0.86, shotErr: 24, timingErr: 4, aggr: 0.50, composure: 0.5, crush: 0.85, notice: 3, windSense: 0.55, softGate: 1 },
    hard:   { label: "困难", tick: 8,  speed: 0.95, read: 38, readFloor: 0.62, zone: 0.90, shotErr: 20, timingErr: 4, aggr: 0.52, composure: 1, crush: 0.55, notice: 2, windSense: 0.85, softGate: 1 },
    expert: { label: "极限", tick: 6,  speed: 0.98, read: 30, readFloor: 0.62, zone: 0.92, shotErr: 14, timingErr: 2, aggr: 0.55, composure: 1, crush: 0.30, notice: 1, windSense: 1, softGate: 1 },
  } as Record<DiffKey, AiTier>,

  // ===== AI 每一档带哪一招 =====
  // 从前 rules.applyAiTier() 里是 `if easy / else if normal / else` 三个分支写同一个人
  // —— 看着像差异化配置,其实是恒等空转,读代码的人会以为入门档和大师档打法不同。
  // 现在它是一张**看得出来的表**:四档都是 lunge,与改动前逐位一致(0.0.21 试过
  // normal=magnet / hard=focus,ai-check 立刻从「普通 46%」掉到 33%、普通档 0/12 局能赢
  // —— 吸球与领域减速是补位的量,不是"性格",要动它就得连带重校准各档,那是另一件事)。
  // 关卡表里的 aiSkill 仍然覆盖这一行(第 5/10/14/15/20 关各有指定),战前简报会写出来。
  aiSkillByDiff: {
    easy: "lunge", normal: "lunge", hard: "lunge", expert: "lunge",
  } as Record<DiffKey, SkillId>,

  // ===== AI 扣杀防守难度 (扣杀突破 AI 防线的核心机制) =====
  // 面对扣杀(shot.kind === 'smash', 包括跳杀、技能重扣、闪现暴扣等):
  // 1. noticeAdd: 猝不及防的反应延迟(帧, 重杀突袭导致愣神滞后)
  // 2. readMul: 站位误判放大倍率(重杀下压急, 难以准确预估深浅)
  // 3. zoneMul: 接杀判定区缩放(重杀力量大、球速快, 防守面积收缩)
  // 4. timingAdd: 挥拍时机额外误差(帧, 窗口变窄极易起手偏离导致挥空)
  // 5. shotErrAdd: 勉强接下时的出球失误增量(px, 强吃重杀容易下网/出界送分)
  aiSmashDefense: {
    easy:   { noticeAdd: 8, readMul: 2.4, zoneMul: 0.70, timingAdd: 6, shotErrAdd: 50 },
    normal: { noticeAdd: 6, readMul: 2.0, zoneMul: 0.78, timingAdd: 4, shotErrAdd: 30 },
    hard:   { noticeAdd: 4, readMul: 1.6, zoneMul: 0.86, timingAdd: 3, shotErrAdd: 20 },
    expert: { noticeAdd: 2, readMul: 1.3, zoneMul: 0.92, timingAdd: 2, shotErrAdd: 10 },
  } as Record<DiffKey, AiSmashDefenseDef>,

  // ===== 生涯成长:赛后奖励 / 等级 / 皮肤经济(纯数值,逻辑在 career.ts) =====
  // 只对带 CPU 的比赛发放(2p 同屏友谊赛不计,防两人互刷);输了也有安慰奖,保证商店始终有进度感
  career: {
    startCoins: 50,        // 新档见面礼:第一次进商店就能买一件便宜货
    // 基础奖励按 AI 难度查表;双打(打两个 CPU)再乘 doublesMul
    rewards: {
      easy:   { win: 30, lose: 8,  expWin: 22, expLose: 6 },
      normal: { win: 50, lose: 14, expWin: 36, expLose: 10 },
      hard:   { win: 90, lose: 22, expWin: 60, expLose: 16 },
      expert: { win: 140, lose: 30, expWin: 90, expLose: 24 },
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

  // ===== 作者通道:真机测试用的隐藏手势 =====
  // 在主菜单连点同一个球馆 tab `taps` 下 → 等级拉到 career.level.cap、金币设为 coins,
  // 省掉「为了测商店/技能解锁反复打局」。判定与执行在 mode-screen.ts 的 authorTap() + career.maxOut()。
  // 只在内存生效:拉满后 profile 不再落盘(career.sandbox),重开应用退回原档,每次进应用都要重新连点。
  // 想让别人拿到包时没有这条路:把 enabled 置 false(唯一的开关,别改手势参数)。
  author: {
    enabled: true,
    taps: 6,        // 连点次数
    gapMs: 1200,    // 相邻两下的最长间隔;点慢了就重新计数,正常选馆不会误触
    coins: 99999,   // 拉满后的金币(全商店皮肤合计 ≈ 7400,这里够买穿一整轮)
    profTaps: 4,    // 拉满后继续连点这几下 → 切引擎统计(profiler)开关,真机看 FPS/帧时间
  },

  // ===== 三星判据阈值:判据类型见 campaign.ts 的 StarCond,文案在关卡表 starsGoal =====
  // 从前判星写死三条通用规则(胜/净胜2/零封或长回合),与战前简报展示的 starsGoal 文案
  // 完全对不上 —— 玩家看到的第 2/3 星条件从未被真的判定过。现在每关配结构化判据,
  // 这张表只放判据共用的物理阈值。
  star: {
    deepDepth: 0.8,     // 「底线深球」:真实落点深度 ≥ 此值(aimDepth.deep = 0.92 为瞄准档)
    netZone: 96,        // 「网前截击」:接触点离网带 ≤ 此 px 且甜区/完美
    empRally: 3,        // 「EMP 故障期间」:与渲染层 empActive **同一把尺**(从前 world.ts 里另写死一个 3)
    flashRally: 5,      // 「看台闪光灯」(第 16 关)从第几拍开始闪:同样只这一处,渲染与判据共用
    slideSpeed: 2.2,    // 「滑行击球」:极滑关 |vx| ≥ 此值即算滑行中(含按住方向的高速)
    airMinHits: 6,      // 「空中击球占比」:总击球数低于此不判(防一两拍就 100% 通过)
  },

  // ===== 闯关模式共用的平衡表(关卡"用不用"某机制在 campaign.ts,那才是创意) =====
  campaign: {
    // AI 的不对称减免:遮蔽类机制只难为人眼(AI 走重模拟跑位,它"看得见"球),
    // 于是同一档 AI 在这些关里比"对练模式"更凶,关卡的难变成"机制 + AI"两份叠在玩家身上。
    // 这里的数字是**加在 AI 身上的误差**(read 偏差 px / shotErr 出球误差 px / timingErr 帧
    // / aggr 进攻性),由 campaign.ts 的 aiReliefFor + tuneAiTier 落到那一关的档位上。
    // 移动/体力/重力类不在表里:那些走 PlayerModifier,双方一起受,对称,不用补。
    aiRelief: {
      blindingSun:   { read: 6, shotErr: 8 },      // 第 3 关 烈日刺目
      sandstorm:     { read: 6, timingErr: 1 },    // 第 4 关 热带沙尘暴
      fog:           { read: 8, shotErr: 8 },      // 第 6 关 晨雾隐踪
      empGlitch:     { read: 6 },                  // 第 11 关 电磁脉冲
      hologramDecoy: { read: 8, shotErr: 8 },      // 第 12 关 全息双生(假球骗眼不骗模拟器)
      spectatorFlash:{ read: 6, shotErr: 6 },      // 第 16 关 全场镁光灯
      sakuraFlurry:  { read: 5 },                  // 第 8 关 落樱(与 erratic 同关,会叠加后被夹住)
      erratic:       { read: 6, shotErr: 8 },      // 第 8/19 关 破损球飘忽
    },
    /** 减免的量纲范围:两条机制同时命中时不许把 AI 调成纯靶子 */
    aiReliefCap: {
      read: [8, 80] as [number, number],
      shotErr: [0, 90] as [number, number],
      timingErr: [0, 18] as [number, number],
      aggr: [0, 0.9] as [number, number],
    },
  },

  // 皮肤表(见文件顶部的 SKINS):挂在 CFG 树上,沿用「手感与经济之外的一切数据都在 CFG」的心智
  skins: SKINS,
  // 稀有度元数据(名称/徽章色),商店卡片渲染用
  rarity: RARITY_META,
  // 下架皮肤退款表,career.profile() 归一化存档时消费
  refunds: SKIN_REFUNDS,
  // 脸面款式注册表(数据)与体型档:sprites.drawHead/drawPlayer 消费
  faceStyles: FACE_STYLES,
  bodies: BODIES,
};

// 菜单入口数据表(决策②的原始数据)。目前 mode-screen 自绘入口、没有代码消费者;
// 留作桌面版/双人入口恢复时的现成数据,别按死代码删。
export const MENU: MenuEntry[] = [
  { id: "2p",     label: "双人对战",   tag: "LOCAL VS",  desc: "同屏对打 · 各占键盘一半", mode: "2p", diff: null },
  { id: "1p-easy",   label: "单人 · 简单", tag: "EASY",   desc: "AI 反应慢、常打飞,适合热身", mode: "1p", diff: "easy" },
  { id: "1p-normal", label: "单人 · 普通", tag: "NORMAL", desc: "有来有回,会抓你的空当", mode: "1p", diff: "normal" },
  { id: "1p-hard",   label: "单人 · 困难", tag: "HARD",   desc: "跳起就扣杀,落点很刁", mode: "1p", diff: "hard" },
  { id: "1p-expert", label: "单人 · 极限", tag: "EXPERT", desc: "反应极限,几乎不失误", mode: "1p", diff: "expert" },
  { id: "2v2", label: "双打 · 两人组队",   tag: "CO-OP 2P", desc: "你 + 队友 打两个 AI",       mode: "2v2", diff: "normal", humans: 2 },
  { id: "1v2", label: "双打 · 带AI搭档", tag: "CO-OP 1P", desc: "你 + AI 搭档 打两个 AI",   mode: "2v2", diff: "normal", humans: 1 },
];

// 难度选择展示表:对练屏与无限练习屏共用的四档「海报文案」。
// 档位与 CFG.diffs 一一对应;颜色即难度语言(绿 → 黄 → 橙 → 红,一眼看出强度)。
// 主菜单改版后各档难度不再直接铺在首页,而是收进「对练」屏统一选档(2×2 大色块)。
// desc 写给 312 宽色块卡的单行位,别超过 16 个全角字符。
export interface DiffPick {
  key: DiffKey;
  name: string;
  tag: string;
  accent: string;
  desc: string;
}

export const DIFF_PICKS: DiffPick[] = [
  { key: "easy",   name: "入门", tag: "EASY",   accent: "#7dff9e", desc: "球速温和 · 回球稳定 · 适合热身" },
  { key: "normal", name: "普通", tag: "NORMAL", accent: "#ffe14d", desc: "攻守兼备 · 会抓空当 · 标准拉吊" },
  { key: "hard",   name: "大师", tag: "HARD",   accent: "#ff6a1f", desc: "反应迅捷 · 跳起重扣 · 落点很刁" },
  { key: "expert", name: "极限", tag: "EXPERT", accent: "#f43f5e", desc: "反应极限 · 几乎不失误 · 天花板" },
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
// (far=「右滑」深球 / near=「左滑」短球,只驱动引导文案与时机条)。这两个字段曾被混用成一回事,
// 结果游戏里喂出的球和标定结果完全不符 —— 名字拆开就是为了不再踩第二次。
// 改了 shuttle / loftByHeight / classify 之后跑训练场校验脚本会告诉你哪关串味了。
//
// ⚠ 这里**不再有** contactX / demoH:引导演示的站位、击球点高度、来回球弧线改由
//   core/drill-demo.ts 沿真实喂球弧线 + 本表判据现算(旧的两枚手拍数字只喂给一条假抛物线,
//   演的是「教的一套」、判的是另一套)。钉子:node .tools-build/tools/drill-diagram-check.js
// ============================================================
export const DRILLS: DrillDef[] = [
  {
    id: "smash", label: "后场重杀", tag: "SMASH", desc: "跳起来把球压下去",
    goal: 3, want: ["smash"],
    feed: { depth: 0.70, jumpLead: 0 },
    wantKey: "far",
    cue: "起跳,在最高点右滑击球",
    zoneName: "下压得分区",
    points: [
      "球要跳到高过网带才压得动 —— 站着够只能挑",
      "起跳后别急着按,等球落到头顶",
      "右滑压得下去;左滑会收成网前点杀",
    ],
    demoSteps: [
      { name: "迎球", desc: "盯住青色那条来球弧", note: "喂球机往高处抛" },
      { name: "起跳", desc: "按住起跳键升到顶", note: "这球站着够不到" },
      { name: "击球", desc: "最高点按右滑下压", note: "左滑不算扣杀" },
      { name: "落点", desc: "压进绿色带才算", note: "越靠底线越好" },
    ],
    pose: { style: "over", jump: true },
  },
  {
    id: "clear", label: "高远对拉", tag: "CLEAR", desc: "把球顶到对方底线",
    goal: 3, want: ["clear"], minLandX: 790,
    feed: { depth: 0.42, jumpLead: 11 },
    wantKey: "far",
    cue: "站定,举过头顶右滑击球",
    zoneName: "后场底线深区",
    points: [
      "高远球是防守的根:球要又高又深,才换得到回位时间",
      "击球点举过头顶,身体正对球网",
      "落点要压过对方后场横线,浅了不算一拍",
    ],
    demoSteps: [
      { name: "迎球", desc: "来球很高但不快", note: "站着就能够到" },
      { name: "就位", desc: "退进蓝圈正对网", note: "别跳,跳了就压平" },
      { name: "击球", desc: "举过头顶再右滑", note: "这一拍求高不求快" },
      { name: "落点", desc: "压过那条白线才算", note: "浅了不记这一拍" },
    ],
    pose: { style: "over", jump: false },
  },
  {
    id: "slash", label: "网前点杀", tag: "SLASH", desc: "高点球收力点到前场",
    goal: 3, want: ["slash"],
    feed: { depth: 0.70, jumpLead: 0 },
    wantKey: "near",
    cue: "同样的高球,改左滑收着打",
    zoneName: "网前小球区",
    points: [
      "和重杀同一个来球,只是收力:拍面立一点、不挥满",
      "腕部向前下压,球落在前场就赢",
      "这一关练的是「同一拍球能打出两种结果」",
    ],
    demoSteps: [
      { name: "迎球", desc: "和重杀同一个来球", note: "只是这关不必跳" },
      { name: "就位", desc: "站进蓝圈把拍举高", note: "出手低就只能挑" },
      { name: "击球", desc: "高点改左滑收着力", note: "拍面立一点不挥满" },
      { name: "落点", desc: "落在网前绿带里", note: "深了这一拍不算" },
    ],
    pose: { style: "over", jump: false, cut: 9 },
  },
  {
    id: "netshot", label: "网前搓放", tag: "NET", desc: "贴网低球搓近网短球",
    goal: 3, want: ["netshot"],
    feed: { depth: 0.42, jumpLead: 11 },
    wantKey: "near",
    cue: "球到网前低处,左滑轻放",
    zoneName: "网前小球区",
    points: [
      "越贴网越低,只能向上送,不能压",
      "上网弓步,手要伸到球的前下方",
      "左滑放得近;右滑会挑成高远球",
    ],
    demoSteps: [
      { name: "迎球", desc: "球贴着网往下走", note: "不上网就接不到" },
      { name: "就位", desc: "朝球网跑一个弓步", note: "手伸到球的前下方" },
      { name: "击球", desc: "左滑轻放,不许压", note: "只能向上送一点" },
      { name: "落点", desc: "越贴网越是好球", note: "落进绿色小球区" },
    ],
    pose: { style: "under", jump: false, lunge: 26 },
  },
  {
    id: "drive", label: "平抽快挡", tag: "DRIVE", desc: "中场快球又平又深地顶回去",
    goal: 3, want: ["drive", "slash"], maxSteps: 44, minDepth: 0.5,
    feed: { depth: 0.85, jumpLead: 14 },
    wantKey: "far",
    cue: "早出手,球还没落到头顶就右滑击球",
    zoneName: "中后场深区",
    points: [
      "平抽拼的是出手早晚:等球落到肩高就只剩挑球",
      "拍面近乎水平向前送,不求高只求快",
      "球必须又快又深,浅浅一挡不算这一拍",
      "按住向下滑,拍面放平就是平抽",
    ],
    demoSteps: [
      { name: "迎球", desc: "来球又平又快", note: "等它落就只剩挑球" },
      { name: "就位", desc: "站中场架平拍面", note: "这一关不必起跳" },
      { name: "击球", desc: "没到头顶就右滑", note: "出手早就是全部" },
      { name: "落点", desc: "又深又快才算数", note: "慢了浅了都不记" },
    ],
    pose: { style: "over", jump: false, tight: true },
  },
  {
    id: "lob", label: "低位挑高", tag: "LOB", desc: "贴地低球铲起来过渡",
    goal: 3, want: ["lob"],
    feed: { depth: 0.05, jumpLead: 8 },
    wantKey: "near",
    cue: "等球落到脚下,晚一点左滑击球",
    zoneName: "后场过渡区",
    points: [
      "球已经贴地了,只能向上铲,别想着压",
      "出手要晚:让球落到拍面下方再抬",
      "挑得越高越深,才换得到退防时间",
      "按住向上滑,拍面立起来一键挑高",
    ],
    demoSteps: [
      { name: "迎球", desc: "球已经贴着地面", note: "只能向上铲起来" },
      { name: "就位", desc: "退到球后面蹲低", note: "让拍子在脚下等" },
      { name: "击球", desc: "球落到拍下再左滑", note: "这一拍出手要晚" },
      { name: "落点", desc: "挑得越高越好", note: "才换得到退防时间" },
    ],
    pose: { style: "under", jump: false, lunge: 18, crouch: true },
  },
];

// ============================================================
// 新手操作教学的三条主题(讲解 ①②③ + 实操一句话)。文案唯一真话:
// 讲解页(ui/tutorial-panel)、实操横幅、判据文案(tools/tutorial-check)都读这一份。
// 写法纪律:只写触屏语言,不出现桌面键名与 emoji(原生无彩色 emoji 字体)。
// ============================================================
export const TUTORIAL_TOPICS: TutTopic[] = [
  {
    id: "move", label: "移动",
    lines: [
      "按住屏幕下方的滑轨,按哪里都行",
      "左右拖动:手指在哪,人就在哪",
      "松手,人立刻停住",
    ],
    practice: "把人拖进圆圈里,停稳一下",
    hint: "手指按在滑轨上,拖到圆圈正上方",
  },
  {
    id: "hit", label: "击球",
    lines: [
      "按「击球」键就挥拍,不用蓄力",
      "按住向右滑 = 打深球,向左滑 = 放网前",
      "按住向上滑 = 挑高球,向下滑 = 平抽快球",
      "球到身前肩高再按,回球又快又准",
    ],
    practice: "把喂球机喂来的 2 个球打回对面场内",
    hint: "喂球机放球前会站稳几拍,看准了再按",
  },
  {
    id: "jump", label: "起跳",
    lines: [
      "手指按在滑轨上,向上快速一滑 = 起跳",
      "也可以在滑轨上快速双击起跳",
      "跳起来能打到高球,还能扣杀",
    ],
    practice: "原地起跳 1 次",
    hint: "上滑或双击都行,跳起来就算过",
  },
];

// 难度档位 key 的具名类型再导出,供 Rules/AI 的查表处使用(diffs 的 key 即权威定义)
export type { DiffKey };
