// ============================================================
// 设置页版式:一行三件事(标签 / 控件 / 读数)的唯一算术。
//
// 为什么提成纯函数 —— 这一页原来把坐标全写死在 settings-panel 里
// (COL_X=-338、rows=[56,0,-56,-112,-168]、TIER_SLIDER_X=-51…),而它正是
// 「改一个控件高度就全线撞车」的那类排版:
//   · 开关从 40 抬到 TOUCH_MIN=44(拇指点准下限),行距 56 立刻只剩 12 缝;
//   · 开关右端要放斜纹记号 + 「开/关」读数,原来 140 宽的开关根本放不下
//     (「震动反馈」四字 63 + 记号 22 + 读数 44 + 两侧留白 22 = 151 > 140)。
// 这类账手调是调不准的,也留不住 —— 交给 tools/panel-check.ts 在 node 下断言。
//
// 依赖纪律:零 cc,只 import p5-tokens 与本目录的 text-metrics(与 editor-strip 同规格,
// 已挂进 tools/tsconfig.json 的 include)。面板只照返回的坐标摆。
//
// 0.0.29 操控页加「移动方式图示」后这一页改成两列:左列是三选一 + 提示 + 两颗动作键,
// 右列是一块会动的示意图(摇杆/滑轨/按键各自长什么样、手指怎么动、人怎么走)。
// 原来三档是整页居中排的,那套坐标在两列下会直接压进图示盒 —— 所以整列改成
// 贴内容左缘的左对齐(与 tab 栏、小节色带同一规矩),宽度由 LEFT_W 一处算。
// ============================================================
import type { MoveMode } from "../core/settings";
import { TOUCH } from "./p5-tokens";
import { textW } from "../core/text-metrics";

export const SET = {
  /** 卡片尺寸:宽 760 是「调整位置」顶栏(strip-check)与本页共用的招牌,别单改 */
  pw: 760,
  ph: 424,
  /** 卡片中心下移:顶边 201 仍低于 HUD 记分牌底边 203(从暂停页打开时不挡比分) */
  cardY: -11,
  /** 内容左缘:三页的小节标题与行标签统一贴这里 */
  colX: -338,
  /** 内容右缘 */
  right: 340,
  titleY: 186,
  doneBtn: { w: 150, h: TOUCH.min, x: 0, y: 176 },   // x 由 pw 倒推,见下方 donePos()
  /**
   * tab 栏:整行**左对齐贴内容列**(与闯关大厅 / 商店同一规矩),右端让开「完成」。
   * 单格宽由页数算,不再写死 176 —— 居中那版两页刚好擦过右上角,加第三页就压在
   * 「完成」的下角上(用户截图:tab 右缘 276 vs 完成左缘 207,竖向还叠 12px)。
   */
  tab: { maxW: 176, h: TOUCH.min, gap: 12, y: 144, doneGap: 16 },
  /** 小节色带高 */
  sectionH: 24,
  /** 行高 = 触控下限;行距 = 行高 + 12 */
  rowH: TOUCH.min,
  rowPitch: TOUCH.min + 12,
  /** 第一行的行心(往下按 rowPitch 排) */
  rowTop: 56,
} as const;

/** 「完成」按钮中心:贴在卡片右上角 */
export function donePos(): { x: number; y: number } {
  return { x: SET.pw / 2 - 98, y: SET.doneBtn.y };
}

export type SettingsTab = "control" | "assist" | "media" | "about";

/**
 * 三页 tab 的唯一真话:key 给面板切页用,label 给排版和闸门量宽用。
 * 原来这张表写在 settings-panel 里(要 import cc 的文件),panel-check 就量不到
 * 「再加一页会不会挤出内容区」—— 挪到零 cc 这边,加一页漏一处宽度就会当场红。
 * 「辅助」排在第二格(开设置一次左扫就到):它改的是玩法本身,不该藏在第三页。
 */
export const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "control", label: "操控" },
  { key: "assist", label: "辅助" },
  { key: "media", label: "声音画面" },
  { key: "about", label: "关于" },
];

/** 「完成」按钮的包围盒(tab 栏要给它让位,判据也要跟它撞一遍) */
export function doneBox(): Box {
  const d = donePos();
  return box(d.x - SET.doneBtn.w / 2, SET.doneBtn.w, d.y, SET.doneBtn.h);
}

/** 单格 tab 宽:内容左缘到「完成」左缘之间平分,上限 maxW(页数少的时候不许摊成大饼) */
export function tabW(n: number = SETTINGS_TABS.length): number {
  const avail = doneBox().left - SET.colX - SET.tab.doneGap;
  return Math.min(SET.tab.maxW, Math.floor((avail - (n - 1) * SET.tab.gap) / n));
}

/** tab 栏每项的包围盒(整行左对齐贴内容列,右端让开「完成」) */
export function tabBoxes(n: number = SETTINGS_TABS.length): Box[] {
  const w = tabW(n);
  return Array.from({ length: n }, (_, i) => box(SET.colX + i * (w + SET.tab.gap), w, SET.tab.y, SET.tab.h));
}

/** tab 栏整组宽(n 默认按页表算,加一页不用改任何数字) */
export function tabRowWidth(n: number = SETTINGS_TABS.length): number {
  return n * tabW(n) + (n - 1) * SET.tab.gap;
}

/** tab 栏:每项的**中心 x** */
export function tabRow(n: number = SETTINGS_TABS.length): number[] {
  return tabBoxes(n).map((b) => b.left + (b.right - b.left) / 2);
}

/** 第 i 行的行心 */
export function rowY(i: number): number {
  return SET.rowTop - i * SET.rowPitch;
}

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;

/** 控件行:左缘 + 宽 + 行心 → 一个包围盒 */
export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}

// ---------- 声音画面页 ----------

/** 左列开关宽:容得下「震动反馈」+ 记号 + 读数(见文件头那条算术) */
export const TOG_W = 176;
/** 开关右端的记号 + 读数占位,与 p5-shapes.toggleDL / TOGGLE_READOUT_W 同源 */
export const TOG_TAIL = 74;
export const VOL_W = 130;

export interface MediaRow {
  label: string;
  toggle: Box;
  /** 音量滑杆:只有音效/音乐两行有(震动反馈那行右边是空的) */
  vol: Box | null;
  y: number;
}

export interface MediaLayout {
  /** 左子列小节标题「声音与震动」 */
  sectionLeft: Box;
  /** 右子列小节标题「画面」 */
  sectionRight: Box;
  /** 左子列三行开关:音效 / 音乐 / 震动反馈 */
  toggles: MediaRow[];
  /** 右子列三行开关:落点预测圈 / 屏幕震动 / 飘字提示 */
  hints: Box[];
  strength: { name: Box; slider: Box; caption: Box };
  test: { btn: Box; status: Box };
}

/** 左子列的三行开关(第 4、5 行是强度与试震,不是开关 —— 别按五行生成开关盒) */
export const TOGGLE_LABELS = ["音效", "音乐", "震动反馈"];

/**
 * 声音画面页:左子列「声音与震动」(开关 + 音量 + 强度 + 试震),右子列「画面」(三个提示开关)。
 * 返回逐块包围盒,面板照摆、check 照断言。
 */
export function mediaLayout(): MediaLayout {
  const leftTog = SET.colX;
  const volLeft = leftTog + TOG_W + 8;
  return {
    sectionLeft: box(SET.colX, 130, SET.rowTop + SET.rowPitch, SET.sectionH),
    sectionRight: box(60, 60, SET.rowTop + SET.rowPitch, SET.sectionH),
    toggles: TOGGLE_LABELS.map((label, i) => {
      const y = rowY(i);
      return {
        label, y,
        toggle: box(leftTog, TOG_W, y, SET.rowH),
        vol: i < 2 ? box(volLeft, VOL_W, y, SET.rowH) : null,
      };
    }),
    hints: [0, 1, 2].map((i) => box(60, 280, rowY(i), SET.rowH)),
    strength: strengthRow(),
    test: hapticTestRow(),
  };
}

/** 右子列(画面)三行开关 */
export function mediaHints(): Box[] {
  return mediaLayout().hints;
}

/** 强度行:标签 34 + 滑杆 130 + 档名 66,整条落在左列内 */
export function strengthRow(): { name: Box; slider: Box; caption: Box } {
  const y = rowY(3);
  return {
    name: box(SET.colX, 34, y, 18),
    slider: box(SET.colX + 40, 130, y, SET.rowH),
    caption: box(SET.colX + 178, 66, y, 18),
  };
}

/** 试震按钮 + 马达状态读数行 */
export function hapticTestRow(): { btn: Box; status: Box } {
  const y = rowY(4);
  return {
    btn: box(SET.colX, 110, y, TOUCH.min),
    status: box(60, 280, y, 18),
  };
}

// ---------- 操控页 ----------

/**
 * 左列宽:这一页的上半区是两列 —— 左列放控件,右列放图示。
 * 398 = 内容宽 678 - 图示 256 - 两列之间 24 的缝(与 tab 栏、小节色带同一规矩:贴内容左缘)。
 */
export const LEFT_W = 398;

/**
 * 图示盒:右缘贴内容右缘,顶边 116 与「移动方式」色带顶边齐平。
 * 高 156 不是拍的 —— pad-diagram 的取景(地面 70 + 人物 100 + 一次满跳 92 + 余量)按宽度
 * 定标后折算成图示像素正好 127,再加上下内边距与抬底,盒子矮一寸就把起跳的顶点切掉了,
 * 高一寸则整格空得像个没画完的框。这条账由 panel-check 的「取景高 ≤ 盒内高」钉住。
 */
export const DIAGRAM = { w: 256, h: 156, cy: 38 };

/**
 * 三档移动方式:label 给分段选择器,tip 给提示行。
 *
 * 为什么从 settings-panel 搬进来 —— 那行提示是 Label.Overflow.CLAMP 摆的,格子从 420 窄到
 * 398 **不报错、不出格,只从中间静默截字**,而 tsc 也量不到字宽。文案是数据就该住在
 * 量得到它的地方(与 ASSIST_COPY / SETTINGS_TABS 同一先例),panel-check 现在量的是真话本身。
 */
export const MOVE_MODES: Array<{ mode: MoveMode; label: string; tip: string }> = [
  { mode: "joystick", label: "摇杆", tip: "虚拟摇杆模拟走位 · 向上推摇杆即起跳" },
  { mode: "slider", label: "滑轨", tip: "手指在哪人就在哪 · 上滑或双击起跳" },
  { mode: "buttons", label: "按键", tip: "经典左右两键全速 · 左手独立按键跳跃" },
];

/** 提示行字号(面板与判据共用一个数,否则量的是另一套字) */
export const MODE_TIP_SIZE = 12;

export interface ControlLayout {
  sectionMove: Box;
  modes: Box[];
  modeTip: Box;
  /** 移动方式图示:一块只读的舞台,切档即换内容 */
  diagram: Box;
  actions: Box[];
  sectionFeel: Box;
  feelHint: Box;
  tiers: Array<{ name: Box; slider: Box; caption: Box; y: number }>;
}

/**
 * 操控页:移动方式三选一 + 图示 + 两颗动作键 + 手感两档(球速/移速)。
 * 行心一律由 rowPitch 推,不再手写 -124/-168 这种「看着差不多」的数 ——
 * 上一版滑杆触摸区从 34 抬到 44 后,那两行会重叠 4px,而 4px 在屏幕上是看不出来的撞。
 *
 * 上半区三排(三选一 / 提示 / 动作键)整列左对齐贴内容列,右半留给图示盒:
 * 原来它们是整页居中的,居中那版在图示进来后会把动作键的右缘(178)顶进图示左缘(84)。
 */
export function controlLayout(): ControlLayout {
  const modeW = 120, modeH = TOUCH.min, modeGap = 14;
  const modeY = 62;
  const actY = -20;
  const feelY = actY - 64;
  const tiers = [0, 1].map((i) => {
    const y = feelY - 42 - i * 50;
    return {
      name: box(SET.colX, 46, y, 18),
      slider: box(-201, 300, y, SET.rowH),
      caption: box(190, 150, y, 18),
      y,
    };
  });
  return {
    sectionMove: box(SET.colX, 120, 104, SET.sectionH),
    modes: [0, 1, 2].map((i) => box(SET.colX + i * (modeW + modeGap), modeW, modeY, modeH)),
    modeTip: box(SET.colX, LEFT_W, modeY - 34, 16),
    diagram: box(SET.right - DIAGRAM.w, DIAGRAM.w, DIAGRAM.cy, DIAGRAM.h),
    actions: [
      box(SET.colX, 190, actY, TOUCH.min + 2),
      box(SET.colX + 204, 150, actY, TOUCH.min + 2),
    ],
    sectionFeel: box(SET.colX, 70, feelY, SET.sectionH),
    feelHint: box(SET.colX + 78, 330, feelY, 18),
    tiers,
  };
}

/**
 * 操控页左列的可用宽:三选一与两颗动作键都得排在 LEFT_W 之内(排不下就是
 * 「图示把控件挤出去了」,屏幕上表现为最后一档贴到图示边缘)。
 */
export function controlLeftOverflow(): string[] {
  const out: string[] = [];
  const K = controlLayout();
  const right = SET.colX + LEFT_W;
  for (const [nm, b] of [...K.modes.map((m, i): [string, Box] => [`移动方式第 ${i} 档`, m]),
    ...K.actions.map((a, i): [string, Box] => [`动作键#${i}`, a]),
    ["提示行", K.modeTip]] as Array<[string, Box]>) {
    if (b.right > right + 0.5) out.push(`${nm}右缘 ${b.right.toFixed(1)} 越过左列边界 ${right}`);
  }
  // 提示行是 CLAMP 摆的字:格子没出左列不代表字没被截
  for (const m of MOVE_MODES) {
    const w = textW(m.tip, MODE_TIP_SIZE);
    const bw = K.modeTip.right - K.modeTip.left;
    if (w > bw) out.push(`移动方式提示「${m.label}」实测 ${w.toFixed(0)}px > 格宽 ${bw}px(CLAMP 会静默截字)`);
  }
  return out;
}


// ---------- 辅助页 ----------

export interface AssistLayout {
  /** 小节色带「辅助」 */
  section: Box;
  /** 那一行的开关 */
  toggle: Box;
  /** 「生效范围」一行:哪些模式代打、哪些不代打 */
  scope: Box;
  /** 一句话说清"哪些还是你的":发球与瞄准 */
  tip: Box;
  /** 为什么会"看着该打却不打":界外球不替捞 + 落点预测圈 */
  landingHint: Box;
}

/** 辅助页的开关标签(也喂给 settingsOverflow 量宽 —— 四个汉字已是上限,加长先改 TOG_W) */
export const ASSIST_TOGGLE_LABELS = ["自动击打"];

/** 辅助页说明行的字号:与「画面」列那几行同规格(13),面板与判据共用这一个数 */
export const ASSIST_COPY_SIZE = 13;

/**
 * 辅助页文案的唯一真话 —— 面板照它摆字,判据照它量宽。
 * 为什么把句子放进零 cc 的版式模块:`txt()` 用的是 Label.Overflow.CLAMP,句子长了**不报错、
 * 不出格、直接从中间静默截掉**,而这三行恰恰是"别把代打当成按键坏了"的唯一解释。
 * 写在这里,copyTargets() 扫的就是真话本身,量宽也量的是真话。
 */
export const ASSIST_COPY = {
  /** 生效范围:说清哪儿不代打,比只说哪儿代打有用 */
  scope: "生效:对练 · 闯关 · 无限练习 · 训练场与新手教学不代打",
  /** 哪些还是你的:发球与瞄准 */
  tip: "人物自动把每一拍打出去,你只管走位和放技能 · 发球仍需你按",
  /** 为什么会"看着该打却不打":界外球不替捞 + 去哪看答案 */
  landing: "会出界的球不替你捞 · 开「落点预测圈」看得明白",
  toastOn: "自动击打已开 · 发球和瞄准还是你的",
  toastOff: "自动击打已关 · 每一拍自己按",
};

/**
 * 辅助页:一颗开关 + 三行说明。
 * 为什么要单独一页 —— 操控页竖排**已经零余量**:tier[1] 行心 -176、滑杆高 44 ⇒ 底边 -198,
 * 而 boxOverflow 的红线是 -(ph/2 + cardY) = -201,再塞一行(-226)当场溢出 47px。
 * 那三行说明也不是装饰:这个开关会让人觉得"人物疯了/按键坏了",不写清"发球仍归你、
 * 界外球不替捞",第一次遇到就会以为游戏出了 bug(看不见的状态会被读成坏掉)。
 */
export function assistLayout(): AssistLayout {
  return {
    // 色带行心与「声音画面」页那两列同一条算术(rowTop + rowPitch),别再手写一个"看着差不多"的数
    section: box(SET.colX, 150, SET.rowTop + SET.rowPitch, SET.sectionH),
    toggle: box(SET.colX, TOG_W, rowY(0), SET.rowH),
    scope: box(SET.colX, 600, rowY(1), 18),
    tip: box(SET.colX, 600, rowY(2), 18),
    landingHint: box(SET.colX, 600, rowY(3), 18),
  };
}

/**
 * 辅助页三行说明的量宽判据(纯函数,`--selftest` 要能喂一份超长文案进来咬)。
 * 为什么单独一条:`txt()` 用 Label.Overflow.CLAMP 摆这些句子 —— 长了**不报错、不出格、
 * 直接从中间静默截掉**,而这三行恰恰是"别把代打当按键坏了"的唯一解释。
 * 只靠 boxOverflow 量不到,因为格子本身没出内容区,溢出的是**字**。
 */
export function assistTextOverflow(lines: Array<[string, string]>): string[] {
  const S = assistLayout();
  const cells: Box[] = [S.scope, S.tip, S.landingHint];
  const out: string[] = [];
  lines.forEach(([nm, s], i) => {
    const b = cells[i];
    if (!b) { out.push(`辅助页说明行「${nm}」多出一格没有对应位置`); return; }
    const w = textW(s, ASSIST_COPY_SIZE);
    const bw = b.right - b.left;
    if (w > bw) out.push(`辅助页${nm}实测 ${w.toFixed(0)}px > 格宽 ${bw}px(CLAMP 会静默截字)`);
  });
  return out;
}

/** 辅助页三行说明按版面格子的配对(面板与判据共用这一张表,不各写一遍) */
export function assistCopyLines(): Array<[string, string]> {
  return [["生效行", ASSIST_COPY.scope], ["说明行", ASSIST_COPY.tip], ["界外行", ASSIST_COPY.landing]];
}

// ---------- 关于页 ----------

export interface AboutLayout {
  section: Box;
  /** 「当前版本」标签 */
  verName: Box;
  /** v0.0.x 读数 */
  verValue: Box;
  checkBtn: Box;
  /** 「浏览器下载」:应用内那条路走不通时的第二条路,整条链交给系统浏览器 */
  siteBtn: Box;
  /** 「重看新手教学」:教学的重看入口之一(另一处在训练场列表页) */
  tutBtn: Box;
  /** 检查结果读数(未检查 / 检查中 / 已是最新 / 发现新版本 / 失败原因) */
  status: Box;
  hint: Box;
}

/**
 * 关于页:版本读数 + 两颗按钮 + 一行状态。
 * 整页只占左半区宽度的一半不到,状态行与说明行拉通到内容右缘 ——
 * 「检查失败:请求超时」这种句子短不了,截在中间就变成读不到的信息。
 */
export function aboutLayout(): AboutLayout {
  const btnW = 150;
  const btnGap = 14;
  const wide = SET.right - SET.colX;
  return {
    section: box(SET.colX, 130, SET.rowTop + SET.rowPitch, SET.sectionH),
    verName: box(SET.colX, 70, rowY(0), 18),
    verValue: box(SET.colX + 78, 120, rowY(0), 18),
    checkBtn: box(SET.colX, btnW, rowY(1), SET.rowH),
    siteBtn: box(SET.colX + btnW + btnGap, btnW, rowY(1), SET.rowH),
    status: box(SET.colX, wide, rowY(2), 18),
    hint: box(SET.colX, wide, rowY(3), 16),
    tutBtn: box(SET.colX, 220, rowY(4), SET.rowH),
  };
}

// ---------- 判据 ----------

const overlapX = (a: Box, b: Box): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5;
const overlapY = (a: Box, b: Box): boolean => bottom(a) < top(b) - 0.5 && bottom(b) < top(a) - 0.5;

/** 两个包围盒是否压在一起 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && overlapY(a, b);
}

/** 越出内容区(±colX..right,以及卡片上下边) */
export function boxOverflow(b: Box): string | null {
  if (b.left < SET.colX - 0.5) return `左缘 ${b.left.toFixed(1)} < ${SET.colX}`;
  if (b.right > SET.right + 0.5) return `右缘 ${b.right.toFixed(1)} > ${SET.right}`;
  const half = SET.ph / 2 + SET.cardY;
  if (top(b) > half) return `顶边 ${top(b).toFixed(1)} > ${half}`;
  if (bottom(b) < -half) return `底边 ${bottom(b).toFixed(1)} < ${-half}`;
  return null;
}

/** 一行里所有块的两两重叠 + 跨子列碰撞(面板与 check 共用同一判据) */
export function settingsOverlaps(): string[] {
  const out: string[] = [];
  const M = mediaLayout(), K = controlLayout(), S = assistLayout(), A = aboutLayout();
  const rows: Array<[string, Box[]]> = [
    // 左列整列一起查:开关、音量、强度三件、试震与状态 —— 它们同在一列的不同行上,
    // 分行查会漏掉「强度滑杆伸进上一行开关的盒子」这类跨行咬合。
    ["声音画面·左列", [
      ...M.toggles.flatMap((r) => [r.toggle, ...(r.vol ? [r.vol] : [])]),
      M.strength.name, M.strength.slider, M.strength.caption,
      M.test.btn, M.test.status,
    ]],
    ["声音画面·右列", M.hints],
    // 操控页上半区:图示盒是晚到的兄弟 —— 三选一/提示/动作键原来整页居中排,
    // 不把它们一起拉进左列,盒子的左缘会正好咬在「调整位置」那颗键上。
    ["操控·上半区(左列 + 图示)", [
      K.sectionMove, ...K.modes, K.modeTip, ...K.actions, K.diagram,
    ]],
    ["操控·手感行", K.tiers.flatMap((t) => [t.name, t.slider, t.caption])],
    ["辅助页", [S.section, S.toggle, S.scope, S.tip, S.landingHint]],
    ["关于", [A.section, A.verName, A.verValue, A.checkBtn, A.siteBtn, A.status, A.hint, A.tutBtn]],
  ];
  for (const [nm, bs] of rows) {
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        if (boxesOverlap(bs[i], bs[j])) out.push(`${nm}:第 ${i} 与第 ${j} 块重叠`);
      }
    }
  }
  // 跨子列:左列开关/音量 与 右列开关同排时不许咬在一起
  for (const r of M.toggles) {
    for (const h of M.hints) {
      if (Math.abs(r.y - h.cy) < 1 && boxesOverlap(r.toggle, h)) out.push(`左右子列开关撞行 y=${r.y}`);
      if (r.vol && boxesOverlap(r.vol, h)) out.push("音量滑杆压到右列开关");
    }
  }
  for (const h of M.hints) {
    if (Math.abs(M.strength.slider.cy - h.cy) < 1 && boxesOverlap(M.strength.slider, h)) out.push("强度滑杆压到右列开关");
    if (Math.abs(M.test.btn.cy - h.cy) < 1 && boxesOverlap(M.test.btn, h)) out.push("试震按钮压到状态读数");
  }
  // 小节标题压在首行上
  if (boxesOverlap(M.sectionLeft, M.toggles[0].toggle)) out.push("左小节标题压住首行开关");
  if (boxesOverlap(K.sectionMove, K.modes[0])) out.push("「移动方式」标题压住三选一");
  if (boxesOverlap(K.sectionFeel, K.tiers[0].slider)) out.push("「手感」标题压住球速滑杆");
  if (boxesOverlap(S.section, S.toggle)) out.push("「自动击打」标题压住开关");
  // tab 栏压在「完成」上:这一条就是那次事故 —— 两页时整组居中刚好擦过右上角,
  // 加第三页 tab 右缘 276 顶进完成的 207,竖向上再叠 12px,屏幕上看着就是「完成」缺了个角。
  const done = doneBox();
  tabBoxes().forEach((t, i) => {
    if (boxesOverlap(t, done)) out.push(`tab 第 ${i} 格压住「完成」按钮`);
  });
  return out;
}

/** 溢出 + 文案宽度:开关标签必须容得下「震动反馈」,每块控件必须在内容区内 */
export function settingsOverflow(labels: string[] = [...TOGGLE_LABELS, ...ASSIST_TOGGLE_LABELS]): string[] {
  const out: string[] = [];
  const M = mediaLayout(), K = controlLayout(), S = assistLayout(), A = aboutLayout();
  const all: Array<[string, Box]> = [
    ...M.toggles.flatMap((r, i): Array<[string, Box]> => r.vol
      ? [[`左列开关#${i}`, r.toggle], [`音量滑杆#${i}`, r.vol]]
      : [[`左列开关#${i}`, r.toggle]]),
    ...M.hints.map((b, i): [string, Box] => [`右列开关#${i}`, b]),
    ["强度滑杆", M.strength.slider],
    ["强度档名", M.strength.caption],
    ["试震按钮", M.test.btn],
    ["马达状态", M.test.status],
    ["辅助开关", S.toggle],
    ["辅助生效行", S.scope],
    ["辅助说明", S.tip],
    ["辅助界外提示", S.landingHint],
    ["操控·图示盒", K.diagram],
    ...K.modes.map((b, i): [string, Box] => [`移动方式第 ${i} 档`, b]),
    ["操控·提示行", K.modeTip],
    ...K.actions.map((b, i): [string, Box] => [`动作键#${i}`, b]),
    ...K.tiers.flatMap((t, i): Array<[string, Box]> => [
      [`手感标签#${i}`, t.name], [`手感滑杆#${i}`, t.slider], [`手感档名#${i}`, t.caption],
    ]),
    ["关于·版本读数", A.verValue],
    ["关于·检查按钮", A.checkBtn],
    ["关于·发布页按钮", A.siteBtn],
    ["关于·状态行", A.status],
    ["关于·说明行", A.hint],
  ];
  for (const [nm, b] of all) {
    const o = boxOverflow(b);
    if (o) out.push(`${nm} ${o}`);
  }
  // 开关标签可用宽 = 行宽 - 记号与读数占位 - 左留白;四字标签按 15 号量,放不下就是布局错
  const avail = TOG_W - TOG_TAIL - 28;
  for (const s of labels) {
    const w = textW(s, 15);
    if (w > avail) out.push(`开关标签「${s}」${w.toFixed(0)}px > 可用 ${avail}px`);
  }
  // 辅助页三行说明:格子没出内容区不代表字没溢出(CLAMP 静默截字),所以量的是字。
  for (const m of assistTextOverflow(assistCopyLines())) out.push(m);
  // 操控页左列:图示盒占掉右半之后,三选一与两颗键、以及那行提示都得还留在左列里
  for (const m of controlLeftOverflow()) out.push(m);
  // tab 栏:整组要落在内容区里,每格的字要放得下(斜切会吃掉两端,各留 12)
  const groupW = tabRowWidth();
  if (groupW > SET.right - SET.colX) out.push(`tab 栏整组宽 ${groupW} > 内容宽 ${SET.right - SET.colX}`);
  const cellW = tabW();
  for (const t of SETTINGS_TABS) {
    const w = textW(t.label, 15);
    if (w > cellW - 24) out.push(`tab 标签「${t.label}」${w.toFixed(0)}px > 可用 ${cellW - 24}px`);
  }
  return out;
}
