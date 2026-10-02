// ============================================================
// P5 视觉令牌:面板层的**唯一配色真话**。
//
// 为什么要单独一个文件 —— 同一套色原来在五处各存一份:
//   ui-arcade.ARCADE、ui-manager.PAL、campaign-panel.COL、drill-panel.COL、career-panel.COL,
//   外加行内散落的 `new Color(255, 0, 36, 180)` 这类字面量。改一个色要在五个地方找齐,
//   而「这个红到底哪版是对的」没人说得清。这里一次收口:本文件出 hex 与数字,
//   ARCADE / PAL 全部改成由它派生的再导出(键名一个不动 ⇒ 零调用点改动)。
//
// 依赖纪律:**零 cc**。只有 hex 字符串与数字,所以 tools/ 下的断言脚本能直接在 node 里
// 跑(见 tools/panel-check.ts 的对比度与网点数红线)。要 Color 实例请在调用点用
// ui-arcade.ac() / ui-manager.col() 现造 —— 令牌表里存 Color 会把 cc 拖进 node。
//
// 分层语法(L0..L5)与画法在 ui-arcade / p5-shapes,本文件只管「用什么色、斜几度、多大」。
// 基准语言 = 首页 main-menu.ts 的那套实底大色块(用户指定),不是另发明一套。
// ============================================================

/**
 * 色板。键名与历史 ARCADE 完全一致(派生化不改调用点);注释保留各自的**职责**,
 * 因为「色即功能」是本项目的硬约定 —— 用错色等于说错话。
 *
 * ⚠ 这里**不能用 `as const`**:那会把每个值变成字面量类型(" #e60012" 而不是 string),
 * 于是任何以 `ARCADE.xxx` 作默认参数的函数(如 `makeChip(bg = ARCADE.acid)`)
 * 参数类型被收窄成那一个 hex,其余调用点全部报 TS2345 —— 类型闸会一夜之间多出十几条
 * 「传了个字符串」的假错。键名要保留、值必须宽,所以显式给一张 string 表。
 */
export const C: Record<
  "ink" | "navy" | "navy2" | "panelTop" | "line" | "paper" | "paperDim"
  | "acid" | "acidEdge" | "acidDk" | "slash" | "slashDk" | "red" | "blue" | "wood"
  | "good" | "bad" | "cyan" | "dim" | "dimDeep", string
> = {
  // ---- 底与墨 ----
  ink: "#07070d",        // 最深底(P5 黑):衬纸面色、凹陷槽底
  navy: "#101018",       // 面板底(原深蓝换血为近黑)
  navy2: "#1a1a26",      // 按钮底/面板上层、未选中态面色
  panelTop: "#20202e",   // 面板渐变上端(旧语汇,新衬纸层已不用渐变)
  line: "#2c2c3a",       // 描线(暗部之间的分隔,不是给亮底用的)
  // ---- 纸与字 ----
  paper: "#f5efe1",      // 暖纸白:正文、斩劈红面上的字
  paperDim: "#cfc7b4",
  // ---- 三个主强调 ----
  acid: "#ffe14d",       // 荧光黄:星星 / 货币 / 选中档
  acidEdge: "#b79b12",
  acidDk: "#8a7514",
  slash: "#e60012",      // P5 主红:主按钮 / 横幅 / 强调块 = 「上场」
  slashDk: "#8f000b",    // 主红的厚底边
  // ---- 阵营/氛围色(别当主强调用) ----
  red: "#ff4d4d",        // 队色红(与球衣同源)
  blue: "#3ea8ff",       // 队色蓝
  wood: "#c8703a",       // 暖木(球场氛围)
  good: "#7dff9e",       // 绿 = 练成 / 已拥有
  bad: "#ff6b6b",
  cyan: "#00f0ff",       // 青 = 专项 / 说明
  dim: "#8f9cbe",        // 暗部正文
  dimDeep: "#6f7ca6",    // 更暗:锁定态、次要读数
};

/** 大色块上的墨黑字(首页 hero 同款;与 C.ink 略不同 —— 那个纯黑压在亮面上发死) */
export const INK_TEXT = "#0a0e1c";

/**
 * 斜切档位。**只允许这四档** —— 斜切角度一多就读出「每个人手拍了一个数」,
 * 而 P5 的秩序感恰恰来自所有平行四边形同斜率。
 *   plate  面板衬纸:轻微斜切,衬在球场上一眼是「一张纸」
 *   block  实底大色块 / 凹陷槽
 *   button 按钮(比色块更斜一点,才像能按下去的东西)
 *   band   分区色带 / 角签 / 徽章(最斜,小面积要靠斜度才读出形状)
 */
export const SLANT: Record<"plate" | "block" | "button" | "band", number> = {
  plate: 3, block: 5, button: 6, band: 10,
};

/** 触控尺子(与 ui-arcade.TOUCH_MIN / ICON_HIT 同源,那边是再导出) */
export const TOUCH: Record<"min" | "iconHit", number> = { min: 44, iconHit: 56 };

/**
 * 网点(halftone)层:P5 印刷味的魂,全库此前没有。
 * 代价很实在 —— 每个点是一个 Graphics circle 填充,所以有硬上限:
 * 只挂**标题带那一小条**、`retainedDraw` 一次成型、逐帧只 tween α/scale,
 * 绝不进 uiAtmosphere(那是全屏常驻 Widget 层)。超线就升 step,不是偷偷把上限调高。
 *
 * step/rMax 是出图调出来的:第一版 step 24 + rMax 2.6 铺满整块衬底,读出来是
 * 「波点桌布」不是「半调网版」—— 半调要密要小。现在只压顶部一条,才敢用 16 的疏密。
 */
export const HALFTONE: Record<"step" | "rMin" | "rMax" | "alpha" | "maxDots", number> = {
  step: 16, rMin: 0.9, rMax: 2.0, alpha: 0.09, maxDots: 900,
};

/** 网点数估算:整格计数(实际画的时候边缘还会裁掉一点,所以这是**上界**) */
export function halftoneDots(w: number, h: number, step: number = HALFTONE.step): number {
  return Math.ceil(w / step) * Math.ceil(h / step);
}

// ---------- 色即功能:面板层唯一的角色表 ----------

export type Role = "primary" | "star" | "drill" | "info" | "record" | "off";

/**
 * 一个角色 = 面色 + 同色系提亮描边 + 同色压暗厚底边。
 * 语义与首页五块大色块严格同源(见 main-menu.ts L199-202 的注释):
 * 红=上场、荧光黄=闯关星星、绿=练球、青=专项、纸白=档案、off=未选中/锁定。
 * 面板里出现新色之前先问:它属于哪个角色?不属于就把角色加上,别在面板里写 hex。
 */
export const ROLE: Record<Role, { face: string; edge: string; dk: string; why: string }> = {
  primary: { face: C.slash, edge: "#ff6b72", dk: C.slashDk, why: "主行动 / 当前 tab / 完成" },
  star: { face: C.acid, edge: C.acidEdge, dk: C.acidDk, why: "星星 / 货币 / 选中的档" },
  drill: { face: C.good, edge: "#4fd07a", dk: "#2f8f4c", why: "练成 / 已拥有 / 进行中的训练" },
  info: { face: C.cyan, edge: "#66f7ff", dk: "#0a9fb2", why: "专项 / 说明性标题" },
  record: { face: C.paper, edge: C.paperDim, dk: "#b3a893", why: "档案 / 履历 / 已通关卡" },
  off: { face: C.navy2, edge: C.line, dk: C.ink, why: "未选中 / 锁定 / 凹陷槽" },
};

// ---------- 字色与对比度(不许调用点各拍一个) ----------

/** 朴素相对亮度(0..1)。与历史 `inkOn` 同一把尺子 —— 换成 sRGB 线性会把首页 hero 的字色翻面 */
export function naiveLum(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 亮面 true(配墨黑字)、暗面 false(配纸白字) */
export function isBright(hex: string): boolean {
  return naiveLum(hex) > 0.5;
}

/** 大色块上的字色:亮面墨黑、暗面纸白。这是 `inkOn` 的真身,那边改为委托本函数 */
export function inkFor(faceHex: string): string {
  return isBright(faceHex) ? INK_TEXT : C.paper;
}

const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** WCAG 相对亮度(sRGB 线性化后) */
export function relLum(hex: string): number {
  const r = lin(parseInt(hex.slice(1, 3), 16) / 255);
  const g = lin(parseInt(hex.slice(3, 5), 16) / 255);
  const b = lin(parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度(1..21)。断言用,不参与渲染 */
export function contrast(a: string, b: string): number {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 面板层的对比度红线。
 * 为什么是 4.0 而不是 WCAG AA 的 4.5:斩劈红 #e60012 配纸白实测 4.18 ——
 * 4.5 会把首页 hero 那块红、以及全站 primary 按钮判成不合格,而那是用户拍板的目标风格。
 * 4.0 仍然拦得住真正的病号:商店旧 tab 是 navy2 底 + 白 5% 描边,1.1:1,
 * 读出来就是「这是不是坏了」(同一次「和背景融成一片」的老病)。
 */
export const CONTRAST_FLOOR = 4.0;

// 稀有度**不在这里建表**:core/config.ts 的 RARITY_META 早就带着四档的中文名与色值
// (common/rare/epic/legendary),面板一律读那张表。
// 这里曾经加过一份 RARITY{legend,epic,rare,plain} —— 那是第二个真相源,而且键名还与
// core/types.Rarity 对不上,已删。本轮改版要消灭的正是「同一套色在五处各存一份」,
// 自己再造一份就是知法犯法。
