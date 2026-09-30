// ============================================================
// 技能配置弹窗排版 (Skill Plate Layout) —— 纯函数、零 cc 依赖
//
// 为什么要单独一个文件:弹窗底部那条详情板要摆「全名 + 冷却 + 解锁状态 + 完整说明」,
// 而这几样的宽度全是实测出来的 —— 技能全名 4~5 字、状态文案三态长短差一倍(「已装备」38
// vs「未解锁 · Lv.5」约 90)、说明最长一句 36 字。手挑 x 坐标必然重演卡片里那场事故:
// 初版就是按「CD 摆 +256、Lv 摆 +292」写死的,量出来才发现两条互相压 21px —— 和当初
// 「9 号说明塞进 118 宽卡片、五句糊成一排」是同一个病,只是搬了个地方。
//
// 所以这里把「右对齐块按实测宽倒推 + 说明折行 + 板高够不够」全做成算术:
//   · 字宽与折行用全站同一把尺(text-metrics 的 textW / wrapText),不另起一份;
//   · 输出的每一项自带 left / x / cy / lines / lineH,渲染层只管照摆,不再量、不再折;
//   · 板高由内容**算出**需求(stackH),与 SK.plateH 比对,所以「不溢出、不压字、
//     切换技能时面板尺寸不变」是排版性质,不是对某一句文案的假设。
// 5 个技能全组合在 node 下回归:tools/skill-check.ts。
//
// ⚠ 版式常量放这儿、不放 core/config.ts:仓库的实际分工是「游戏数值进 CFG,视觉
// token 跟着消费者走」(ARCADE / PAL / TOUCH_MIN / BRIEF / STRIP_* 都在各自模块里)。
// CFG.skills.list 里的 desc·cooldownFrames·unlockLevel·accent 是**内容**,一个都不许动。
// ============================================================
import { textW, wrapText, type Measure } from "./text-metrics";

/** 与 ui-arcade.skewOf 同式(本模块零 cc 不能 import;改斜切角两边一起看) */
function shearOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

/**
 * 排版度量 —— 弹窗(skill-dialog)与回归(skill-check)共用这一份,不会各算各的算歪。
 * 坐标一律以「面板中心」为原点(cc 的 y 朝上),详情板内的项以「板中心」为原点。
 */
export const SK = {
  panelW: 700, panelH: 424,
  /** 面板斜切角:kit.panel 的默认值,内容边界要按斜切后的最坏边算 */
  slantDeg: 3,

  titleY: 182, subY: 156, hintY: 132, hintSize: 12,

  /** 卡片:瘦成「标签 + 名字 + CD + 装备」,说明整条搬进详情板 */
  cardW: 118, cardH: 126, cardPitch: 128, cardsY: 47,
  /** drawMenuCard 的厚底边探出卡外这么多;竖排判据要连着它一起量 */
  cardEdge: 4,
  chipY: 48, chipSize: 9,
  nameY: 22, nameSize: 17,
  cdY: 2, cdSize: 10,
  /** 44 = TOUCH_MIN,uiButton 会把高度抬到这儿;写 28 是自欺欺人,见 skill-check */
  btnW: 100, btnH: 44, btnY: -34,

  /** 详情板 */
  plateW: 652, plateH: 104, plateY: -84, platePad: 14,
  /** 内容列半宽:比「板宽/2 - 内边距」再收一点,给斜切和拇指留余量 */
  contentHalf: 300,
  headSize: 17, headH: 22,
  metaSize: 12, metaH: 16, metaGap: 12,
  descSize: 15, descLineH: 20, descLead: 8, descMaxLines: 2,
  padBottom: 14,

  finW: 140, finH: 46, finY: -171,
  /** uiButton 的斜切阴影向下探这么多 */
  finShadow: 4,
} as const;

/** 排版只用到 SkillDef 的这几个字段(投影成接口,单测可以手搓一个假技能) */
export interface SkillLike {
  id: string;
  name: string;
  shortName: string;
  tag: string;
  desc: string;
  unlockLevel: number;
  cooldownFrames: number;
  accent: string;
}

export type PlateRole = "name" | "cd" | "status" | "desc";

/** 详情板里的一项:lines 已折好,渲染层用 "\n" 拼接直接画 */
export interface PlateItem {
  key: string;
  role: PlateRole;
  lines: string[];
  size: number;
  /** 引擎 Label.lineHeight 就设这个值 —— 行高由排版说了算,两边不会算歪 */
  lineH: number;
  /** 块高 = lines × lineH */
  h: number;
  /** 最宽一条物理行的实测宽 */
  w: number;
  /** 包围盒左缘(判据用;板中心为原点) */
  left: number;
  /** 节点摆放 x —— 配合 align 决定的锚点,左对齐时它就等于 left */
  x: number;
  /** 块垂直中心(板中心为原点) */
  cy: number;
  /** 0 左 / 1 中 / 2 右:锚点跟着对齐走,这是旧版糊出边框的正解 */
  align: 0 | 1 | 2;
}

export interface PlateLayout {
  items: PlateItem[];
  plateW: number;
  plateH: number;
  /** 内容列左右边界(已扣掉内边距与斜切最坏边) */
  innerL: number;
  innerR: number;
  /** 文案可用宽 = innerR - innerL */
  availW: number;
  /** 当前这份文案**需要**多高的板;> plateH 就是排版不够用,skill-check 拿它当红线 */
  stackH: number;
  /** 说明折了几行(钉住「切换技能不会改变面板尺寸」) */
  descLines: number;
}

// ---------- 文案 ----------

/** 冷却秒数:帧数 / 60,一位小数 */
export function skillCdSec(def: SkillLike): number {
  return def.cooldownFrames / 60;
}

export function skillCd(def: SkillLike): string {
  return `CD ${skillCdSec(def).toFixed(1)}s`;
}

/** 详情板右上角那一格状态:三态只留一条文案,不再拆成「CD + Lv」两块(那正是压字来路) */
export function skillStatus(def: SkillLike, unlocked: boolean, equipped: boolean): string {
  if (!unlocked) return `未解锁 · Lv.${def.unlockLevel}`;
  return equipped ? "已装备" : "可装备";
}

/** 说明会跟着换」的操作提示并进面板副标里,详情板只留「全名 + 冷却 + 状态 + 说明」 */
export const SK_HINT_LINE = "提升生涯等级解锁更强技能 · 点击下方卡片查看完整说明";

/** 第 i 张卡的中心 x:n 张横排整体居中 */
export function skillCardX(i: number, n: number = 5): number {
  return (i - (n - 1) / 2) * SK.cardPitch;
}

// ---------- 排版 ----------

/**
 * 一个技能 → 详情板排版。
 *
 * 头部一行(全名左 / 冷却 + 状态右),说明在剩下的带子里垂直居中 —— 所以说明 1 行还是
 * 2 行都不会把别的项挤走,面板尺寸恒定这件事是结构给的。
 */
export function layoutSkillPlate(
  def: SkillLike, unlocked: boolean, equipped: boolean, measure: Measure = textW,
): PlateLayout {
  const shear = shearOf(SK.plateH, SK.slantDeg) / 2;
  const half = Math.min(SK.plateW / 2 - SK.platePad - shear, SK.contentHalf);
  const innerL = -half, innerR = half;
  const availW = innerR - innerL;

  // 头部:全名左起,状态贴右,冷却排在状态左边 —— 三个 x 全是量出来的
  const nameLines = [def.name];
  const nameW = measure(def.name, SK.headSize);
  const statusText = skillStatus(def, unlocked, equipped);
  const statusW = measure(statusText, SK.metaSize);
  const cdText = skillCd(def);
  const cdW = measure(cdText, SK.metaSize);
  const headCy = SK.plateH / 2 - SK.platePad - SK.headH / 2;

  const lines = wrapText(def.desc, SK.descSize, availW, measure);
  const descH = Math.max(1, lines.length) * SK.descLineH;
  // 说明在「头部之下、板底内边距之上」这条带子里垂直居中:1 行还是 2 行都居中在同一条
  // 中线上,板高不变、其它项不动 —— 「切换技能面板不重排」就是这么来的,不是巧合。
  const bandTop = headCy - SK.headH / 2 - SK.descLead;
  const bandBot = -SK.plateH / 2 + SK.padBottom;
  const descCy = (bandTop + bandBot) / 2;
  const descW = lines.reduce((m, l) => Math.max(m, measure(l, SK.descSize)), 0);

  const items: PlateItem[] = [
    {
      key: "name", role: "name", lines: nameLines, size: SK.headSize, lineH: SK.headH, h: SK.headH,
      w: nameW, left: innerL, x: innerL, cy: headCy, align: 0,
    },
    {
      key: "status", role: "status", lines: [statusText], size: SK.metaSize, lineH: SK.metaH, h: SK.metaH,
      w: statusW, left: innerR - statusW, x: innerR, cy: headCy, align: 2,
    },
    {
      key: "cd", role: "cd", lines: [cdText], size: SK.metaSize, lineH: SK.metaH, h: SK.metaH,
      w: cdW, left: innerR - statusW - SK.metaGap - cdW, x: innerR - statusW - SK.metaGap, cy: headCy, align: 2,
    },
    {
      key: "desc", role: "desc", lines: lines.length ? lines : [""], size: SK.descSize, lineH: SK.descLineH, h: descH,
      w: descW, left: innerL, x: innerL, cy: descCy, align: 0,
    },
  ];

  // 当前这份文案**需要**多高的板;超过 SK.plateH 就是排版不够用,skill-check 判红
  const stackH = SK.platePad + SK.headH + SK.descLead + descH + SK.padBottom;

  return { items, plateW: SK.plateW, plateH: SK.plateH, innerL, innerR, availW, stackH, descLines: lines.length };
}

// ---------- 判据(回归用) ----------

const EPS = 0.5;

/** 溢出:任何一行比可用宽还长,或块探出了内容列 / 板上下缘 */
export function plateOverflow(L: PlateLayout, measure: Measure = textW): string[] {
  const bad: string[] = [];
  for (const it of L.items) {
    for (const l of it.lines) {
      const w = measure(l, it.size);
      if (w > L.availW + EPS) bad.push(`${it.key}:行实测宽 ${w} > 可用 ${L.availW} →「${l}」`);
    }
    if (it.left < L.innerL - EPS) bad.push(`${it.key}:左缘 ${it.left.toFixed(1)} 出了内容列(${L.innerL.toFixed(0)})`);
    if (it.left + it.w > L.innerR + EPS) bad.push(`${it.key}:右缘 ${(it.left + it.w).toFixed(1)} 出了内容列(${L.innerR.toFixed(0)})`);
    if (it.cy + it.h / 2 > L.plateH / 2 + EPS) bad.push(`${it.key}:探出详情板上缘`);
    if (it.cy - it.h / 2 < -L.plateH / 2 - EPS) bad.push(`${it.key}:探出详情板下缘`);
  }
  if (L.stackH > L.plateH + EPS) bad.push(`stackH ${L.stackH.toFixed(1)} > 板高 ${L.plateH}:这块文案塞不进当前详情板`);
  if (L.descLines > SK.descMaxLines) bad.push(`说明折了 ${L.descLines} 行 > 上限 ${SK.descMaxLines}`);
  return bad;
}

/** 压字:任意两项的包围盒相交(头部那三格就是靠这条钉住的) */
export function plateOverlaps(L: PlateLayout): string[] {
  const box = (it: PlateItem) => ({ key: it.key, l: it.left, r: it.left + it.w, b: it.cy - it.h / 2, t: it.cy + it.h / 2 });
  const all = L.items.map(box);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i], B = all[j];
      const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
      const oy = Math.min(A.t, B.t) - Math.max(A.b, B.b);
      if (ox > EPS && oy > EPS) out.push(`${A.key} × ${B.key}(横向压 ${ox.toFixed(1)} / 纵向压 ${oy.toFixed(1)})`);
    }
  }
  return out;
}
