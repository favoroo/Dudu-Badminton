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

/** 飘字文案档位(夸奖/技能/瞄准共用):plate 指定 P5 底板样式(缺省 = 无底板) */
export interface FloatLabel {
  text: string;
  color: string;
  size: number;
  life: number;
  dy: number;
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
    default: "standard",       // 出货默认 = 现在的速度(上一轮已从 8.6 提到 9.2,不再默认加码)
    min: 0.6, max: 1.8,        // 运行时兜底夹取(手改存档 / 以后加档)
    // 表序必须从慢到快单调(settings-check 有断言):滑杆按下标定位,反了会拖反方向。
    tiers: [
      { id: "vslow",    s: 0.70, label: "很慢", note: "慢 30%:飘着走,当对照用" },
      { id: "slow",     s: 0.85, label: "偏慢", note: "慢 15%:手机-thumb 容易过头的那一档" },
      { id: "standard", s: 1.00, label: "标准", note: "现在的速度,一点没改" },
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

  // ===== 球种定性阈值(给飘字/音效/丝带档位/生涯奖励贴标签,不参与任何判定) =====
  // 原先这些数硬编码在 physics.classify 里(违反「数值只进 config」),搬过来。
  // 速度阈值是**基准单位**(s=1 的 px/step):classify 收到的是 pace.ts 折回基准后的速度,
  // 所以标签不随球速档位漂移 —— 慢档里同一记重杀仍叫「重杀」,不会念成「劈吊」。
  shotClass: {
    smashDeg: 15,      // 压角小于此 + 击球点够高 + 球够快 = 重杀
    smashH: 105,
    smashSpeed: 16,
    slashDeg: 22,      // 压角小于此 + 击球点次高 = 劈吊
    slashH: 92,
    lobDeg: 55,        // 挑得比这更高就是挑高/高远一类
    netDepth: 0.3,     // 落点深浅小于此 = 网前小球
    driveDeg: 28,      // 剩下的里再按角度分平抽与高远
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
  // rampFrames = 亮度 0→1→0 三角波的半宽(帧);arriveRadius = 预测「到达」用判定区半径的比例;
  // horizonFrames = 预测积分的前瞻上限。最佳按拍帧由 swing 参数导出(player.PRESS_LEAD_FRAMES)。
  // 同一级辉光镜像到羽毛球本体(注意力在球上时按钮辉光看不见):
  // shuttleGlowR = 外晕基准半径(px);shuttleGlowMax = 峰值亮度上限;
  // 阈值 0.9 对应 |fc-lead| ≤ 1 帧(ramp 14 时约 3 帧 ≈ 50ms)的「就是现在」白环闪烁。
  swingCue: { rampFrames: 14, arriveRadius: 0.5, horizonFrames: 40, shuttleGlowR: 20, shuttleGlowMax: 0.9 },

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

    // 轨迹预测虚线:把「这一拍会走哪条弧」提前画出来,读球不用靠猜。
    // 刻意压得比地面标识低一档(半透明 + 冷白,不抢金/橙的落点圈),
    // 且沿弧长分三段向落点方向淡出 —— 起点跟着球走,末端交给落点圈去喊。
    pathHorizon: 90,            // 前瞻帧数上限( loftByHeight 那张表里最滞空的一档约 70 帧,留余量)
    pathA: 0.30,                // 靠球那端的不透明度
    pathW: 2.2,                 // 线宽
    dashOn: 7, dashOff: 9,      // 虚线段长 / 间隔(px);间隔略大于段长 = 更透气
    pathFade: [1, 0.66, 0.4],   // 沿弧长三等分的透明度衰减
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
    // 慢动作总闸。true 时下列四组变速旋钮全部生效:fx.slowmoFrames / fx.scoreSlowmo(Frames)、
    // scoring.matchPointSlowmo,以及主循环里赛点常驻的 0.9 微慢放。
    // 曾因用户反馈「重击卡住不好操控」关过一段时间;操纵问题已由 hitstop 期间
    // 保留输入边沿(keepEdges)解决,重新打开赛点演出与扣杀庆祝慢放。
    slowmoEnabled: true,
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

    // 六、闪现折跃演出(时停 → 出刀 → 慢放三段)
    // 定格走主循环现成的 hitstop 通道,所以也吃 fx.hitstopCap 总闸:这里给到的就是顶格。
    hitstopFlashCast: 7,      // 折跃当帧的世界定格:球悬在半空,雷光凝住
    flashCastFlash: 0.6,      // 折跃白闪(比扣杀命中的白闪低一档,把顶闪让给那一下)
    flashCastShake: 7,
    flashCastPunch: 1.05,     // 镜头向落点推近,读作「镜头跟着折跃过去」
    flashCastFloat: { text: "时停 · 闪现", color: "#eab308", size: 26, life: 44, dy: -46, plate: "slant" },
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
    slashCutinBandW: 0.38,     // 带宽/屏宽比
    slashCutinAlpha: 0.85,     // 带峰值 alpha
    slashCutinStagger: 0.22,   // 三带错相位
    slashCutinColors: ["#e60012", "#07070d", "#ffffff"],        // sweetSmash 带色(P5 红黑)
    slashCutinColorsFire: ["#e60012", "#ff6a1f", "#ffe14d"],    // fire 带色(红橙金)

    // 四、镜头与飘字(白闪径向化、震屏阻尼正弦、飘字弹入)
    flashRadial: 0.6,          // 白闪径向化的峰值强度(边缘亮/中心透,不糊住球)
    flashRings: 16,            // 径向近似的描边环数
    shakeFreq: 0.8,            // 震屏阻尼正弦角频率(弧度/模拟步);振幅仍按既有 0.85 几何衰减,
                               // 主轴方向由 world.shake(amt, vert, dirAng) 的来球方向给定
    floatPopBack: 1.7,         // 飘字弹入过冲(easeOutBack 参数)
    floatPopFrames: 6,         // 弹入用时(模拟步)
    floatRiseEase: 1.8,        // 上浮减速指数(>1 起得快落得缓)
    floatFadeK: 0.5,           // 全程淡出起点(1=一出现就开始淡)
    // 夸奖档位的文案/字号/寿命:原先硬编码在 game-root 的 drain 里(六档各一行),
    // 挪进配置后"这一档给多大的字"与别的特效旋钮一处对齐
    // plate = P5 飘字底板:star 尖刺星芒衬底(最高两档)/ slant 斜切黑片(次档)/ 无底板
    floatTierPerfectSmash: { text: "完美重扣!!", color: "#ffe14d", size: 30, life: 56, dy: -32, plate: "star" },
    floatTierPerfect:      { text: "✦ PERFECT ✦", color: "#00f0ff", size: 24, life: 50, dy: -30, plate: "slant" },
    floatTierSweetSmash:   { text: "黄金重扣!!", color: "#ffe14d", size: 28, life: 52, dy: -30, plate: "star" },
    floatTierSmash:        { text: "扣杀!!",     color: "#ffe14d", size: 26, life: 48, dy: -28, plate: "slant" },
    floatTierSweet:        { text: "✦ SWEET! ✦", color: "#ffe14d", size: 20, life: 42, dy: -26, plate: "slant" },
    floatTierGood:         { text: "好球",       color: "#ffffff", size: 16, life: 34, dy: -24 },
    // 瞄准深浅的命中确认(触屏右滑/左滑、键盘 J/K 同链路):比档位字小一号,dy 正值 = 球下方,
    // 与上方的档位飘字、更下方的跨步飘字都错开;mid(直接点击,没滑)不飘,默认档不打扰
    floatAimDeep:          { text: "深球·重",    color: "#ffe14d", size: 14, life: 30, dy: 26 },
    floatAimNear:          { text: "短球·轻",    color: "#00f0ff", size: 14, life: 30, dy: 26 },
    // 技能触发与特殊击球飘字
    floatSkillLunge:       { text: "疾风重击!!", color: "#38bdf8", size: 26, life: 48, dy: -28, plate: "slant" },
    floatSkillSmash:       { text: "必杀重扣!!", color: "#f43f5e", size: 30, life: 54, dy: -32, plate: "star" },
    floatSkillFlash:       { text: "闪现扣杀!!", color: "#eab308", size: 32, life: 58, dy: -34, plate: "star" },
    floatSkillMagnet:      { text: "引力回击!!", color: "#a855f7", size: 28, life: 50, dy: -30, plate: "slant" },
    floatSkillFocus:       { text: "时空领域!!", color: "#06b6d4", size: 24, life: 46, dy: -26, plate: "slant" },
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
    label: "#ffffff", labelA: 0.62,   // 键名文字(「击球」「跨步」,乘 padAlpha)
    labelOutline: "#0a0d18",          // 键名描边:亮场(海滩)上白字没描边会糊掉
    labelSize: 13,                    // 键名字号
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
  },

  // 键位表(桌面端按 e.code 绑定,跨布局稳定;每项可给多个候选)
  // 击球键自带落点:J(swingFar)=右滑深球压底线,K(swingNear)=左滑短球放网前。
  // 触屏合并为单个击球键 + 滑动手势;键盘仍保留两键(桌面不缺键位)。
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
    reachMul: 1.55,         // 判定区半径倍率
    cooldownFrames: 48,     // 跨步冷却(48帧 ≈ 0.8s,支持短CD快节奏多次救球)
    shotWindow: 60,         // 跨步后特殊击球窗口(60帧 = 1 秒,身上带风道粒子动画)
    shotBoost: 3.0,         // 窗口内强化重击初速加成(适度提速,兼顾长相持与终结)
    shotPowerDeg: 6.5,      // 窗口内额外压弧度
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

  // ===== 动态技能系统(数值集中管理,纯数据) =====
  skills: {
    list: [
      {
        id: "lunge",
        name: "强力跨步",
        shortName: "跨步",
        tag: "敏捷突进",
        desc: "快速滑步突进救球，并在 1 秒内激活强力暴击状态",
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
        desc: "球拍聚能爆发烈焰，下次挥击无视高度必定暴扣",
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
        desc: "展开重力力场，将全场羽毛球瞬间抓回拍前强力回抽",
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
        desc: "开启 1.5 秒子弹时间，球速与对手大幅减慢，从容完美反击",
        unlockLevel: 5,
        cooldownFrames: 270, // 4.5s
        accent: "#06b6d4",
        icon: "focus",
      },
    ],
    // 各技能专属机制数值
    smash: {
      buffDuration: 240,    // 附魔激活后持续 4 秒(未击球时维持)
      speedBoost: 4.0,      // 极速加成
      powerDeg: 14,         // 强制压角
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
      duration: 90,         // 持续 90 帧 = 1.5 秒
      ballSlow: 0.35,       // 球速减速至 35%
      rivalSlow: 0.40,      // 对手移速减速至 40%
      castPunch: 1.035,     // 时空张开镜头推近
      castShake: 4,         // 时空波纹震颤
      castFlash: 0.40,      // 青碧色时空闪光
      chronoGhosts: 4,      // 羽毛球慢动作时空残影重数
      vignetteAlpha: 0.28,  // 全屏时空领域暗角强度
    },
  },

  // AI 拦截高度带:站立够球上限 / 跳起够球上限 / 低位接球截面(px 离地)。
  // contact/contactDrift:球从「第一次降到可击高度」的点滑行到落点的水平距离
  // 超过 drift(平飘球,常见于网前短球/平抽)时,改等球下落穿过 contact 截面
  // 再接 —— 按过截面点站位,球会落在身后死角;陡坠球滑行小,维持原截点。
  aiReach: { stand: 140, attack: 182, jump: 236, contact: 72, contactDrift: 48 },

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

  // AI 难度:全部走同一套挥拍机制,只是**看走眼更狠、判定区更窄、出手更不准**
  // read=站位认定误差(px) · zone=单打判定区缩放(双打再与 doubles.aiZone 取 min)
  // shotErr=出球落点误差(px,进 player.buildShot 的误差预算,会下网/出界)
  // composure=情绪修正闸门(0=落后不会变强;见 ai.ts emotionModifiers)
  // 回滚成旧行为(逐项精确复现):read 填回 92/66/20 并把 aiRead 的 readFloor 设 1、
  // zone 全 1、shotErr 全 0、composure 全 1 —— 但 read 不抵消这条一改就回不去。
  diffs: {
    easy:   { label: "简单", tick: 20, speed: 0.74, read: 95, readFloor: 0.22, zone: 0.82, shotErr: 70, timingErr: 9, aggr: 0.12, composure: 0 },
    normal: { label: "普通", tick: 14, speed: 0.88, read: 55, readFloor: 0.40, zone: 0.91, shotErr: 22, timingErr: 6, aggr: 0.40, composure: 0.5 },
    hard:   { label: "困难", tick: 8,  speed: 1.00, read: 20, readFloor: 0.62, zone: 0.98, shotErr: 8,  timingErr: 2, aggr: 0.58, composure: 1 },
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

  // ===== 作者通道:真机测试用的隐藏手势 =====
  // 在主菜单连点同一个球馆 tab `taps` 下 → 等级拉到 career.level.cap、金币设为 coins,
  // 省掉「为了测商店/技能解锁反复打局」。判定与执行在 main-menu.ts + career.maxOut()。
  // 只在内存生效:拉满后 profile 不再落盘(career.sandbox),重开应用退回原档,每次进应用都要重新连点。
  // 想让别人拿到包时没有这条路:把 enabled 置 false(唯一的开关,别改手势参数)。
  author: {
    enabled: true,
    taps: 6,        // 连点次数
    gapMs: 1200,    // 相邻两下的最长间隔;点慢了就重新计数,正常选馆不会误触
    coins: 99999,   // 拉满后的金币(全商店皮肤合计 ≈ 7400,这里够买穿一整轮)
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
// (far=「右滑」深球 / near=「左滑」短球,只驱动引导文案与时机条)。这两个字段曾被混用成一回事,
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
    cue: "起跳,在最高点右滑击球",
    points: [
      "球要跳到高过网带才压得动 —— 站着够只能挑",
      "起跳后别急着按,等球落到头顶",
      "右滑压得下去;左滑会收成网前点杀",
    ],
    pose: { style: "over", jump: true },
  },
  {
    id: "clear", label: "高远对拉", tag: "CLEAR", desc: "把球顶到对方底线",
    goal: 3, want: ["clear"], minLandX: 790,
    feed: { depth: 0.42, jumpLead: 11 },
    wantKey: "far",
    contactX: 262, demoH: 122,
    cue: "站定,举过头顶右滑击球",
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
    cue: "同样的高球,改左滑收着打",
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
    cue: "球到网前低处,左滑轻放",
    points: [
      "越贴网越低,只能向上送,不能压",
      "上网弓步,手要伸到球的前下方",
      "左滑放得近;右滑会挑成高远球",
    ],
    pose: { style: "under", jump: false, lunge: 26 },
  },
  {
    id: "drive", label: "平抽快挡", tag: "DRIVE", desc: "中场快球又平又深地顶回去",
    goal: 3, want: ["drive", "slash"], maxSteps: 44, minDepth: 0.5,
    feed: { depth: 0.85, jumpLead: 14 },
    wantKey: "far",
    contactX: 380, demoH: 116,
    cue: "早出手,球还没落到头顶就右滑击球",
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
    cue: "等球落到脚下,晚一点左滑击球",
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
