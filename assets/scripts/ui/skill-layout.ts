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
// 6 个技能全组合在 node 下回归:tools/skill-check.ts。
//
// ⚠ 版式常量放这儿、不放 core/config.ts:仓库的实际分工是「游戏数值进 CFG,视觉
// token 跟着消费者走」(ARCADE / PAL / TOUCH_MIN / BRIEF / STRIP_* 都在各自模块里)。
// CFG.skills.list 里的 desc·cooldownFrames·unlockLevel·accent 是**内容**,一个都不许动。
// ============================================================
import { textW, wrapText, type Measure } from "../core/text-metrics";
// 充能款技能的卡片要印「蓄满要几拍」—— 那是 config 里的**内容数值**(上限/每拍增益),
// 不是版式 token,所以照铁律 3 从 CFG 读,不在这里抄一份数字(抄了就等于允许它和实机分叉)。
import { CFG } from "../core/config";

/** 与 ui-arcade.skewOf 同式(本模块零 cc 不能 import;改斜切角两边一起看) */
function shearOf(h: number, deg: number): number {
  return h * Math.tan(deg * Math.PI / 180);
}

/**
 * 排版度量 —— 弹窗(skill-dialog)与回归(skill-check)共用这一份,不会各算各的算歪。
 * 坐标一律以「面板中心」为原点(cc 的 y 朝上),详情板内的项以「板中心」为原点。
 */
export const SK = {
  // 双技能槽(2026-10-06):面板加高到 440(判据上限 540-100)给槽位行腾地方,
  // 英文副标与提示行删去(解锁提示卡片按钮上本就有「Lv.N 解锁」,点卡看说明是通用直觉)
  panelW: 700, panelH: 440,
  /** 面板斜切角:kit.panel 的默认值,内容边界要按斜切后的最坏边算 */
  slantDeg: 3,

  titleY: 192,
  /** 槽位行:两颗槽位 chip + 最右一颗「完成」键 —— 完成键从底部搬上来了,
   *  因为底部那条 50 高的带子整个让给了演示盒(详情板从 104 长到 162)。
   *  两颗 chip 从 250 收到 216:读数最长「技能1 · 跨步」实测 76 字宽,216 还空一大截,
   *  收它只为给完成键让出 84 + 缝(整行 560 宽,面板在该高度处半宽 342,进得来)。 */
  slotW: 216, slotH: 48, slotGap: 24, slotY: 147,
  /** 完成键与第二颗 chip 之间的缝 */
  finGap: 20, finW: 84, finH: 44, finY: 147,
  /** uiButton 的斜切阴影向下探这么多 */
  finShadow: 4,

  /** 卡片:瘦成「标签 + 名字 + CD + 装备」,说明整条搬进详情板。
   *  0.0.25 起 6 款技能:118/128 是按 5 张横排定的,6 张总半宽 384 直接出 700 面板 ——
   *  收瘦到 104/112(间距 8、装备键 96),6 张总半宽 337 重新进得来。
   *  0.0.26 起 7 款(怒气重击):同一手收瘦,104/112 → 88/96(间距仍 8、装备键 80),
   *  7 张总半宽 skillCardX(6,7) + 44 + 5 = 288 + 49 = 337 —— 与 6 张那一轮**同一个数**。
   *  面板宽度**不动**(700):设计分辨率是 FIXED_HEIGHT,4:3 平板的可视宽度会掉到 ~720,
   *  把面板加宽到 800 在这种屏上直接出画。加第八款时这条路就到头了 ——
   *  那时该改成两行 4+3 栅格,而不是继续把卡压到 88 以下(名字两字 + 装备键已经贴边)。 */
  cardW: 88, cardH: 126, cardPitch: 96, cardsY: 27,
  /** drawMenuCard 的厚底边探出卡外这么多;竖排判据要连着它一起量 */
  cardEdge: 4,
  chipY: 48, chipSize: 9,
  nameY: 22, nameSize: 17,
  cdY: 2, cdSize: 10,
  /** 44 = TOUCH_MIN,uiButton 会把高度抬到这儿;写 28 是自欺欺人,见 skill-check */
  btnW: 80, btnH: 44, btnY: -34,

  /** 详情板:左列演示盒 + 右列文字(名称 / 读数 / 状态 / 完整说明) */
  plateW: 652, plateH: 162, plateY: -131, platePad: 14,
  /**
   * 演示盒(图示)尺寸。高 150 是「板高 - 上下各 6」,不是拍的:
   * 盒子里那张画面的取景宽高比由 ui/skill-diagram 的 SKD 决定(496×322 世界像素),
   * 而缩放 k 取宽/高中较小的一边 —— 所以**高度才是决定人物大小的那一条边**,
   * 板每矮 10 px,人物就矮一截。矮到读不懂不是判据能拦的,是出图肉眼看出来的
   * (pad-diagram-preview 同一套理由)。
   */
  demoW: 250, demoH: 150,
  /** 演示盒与文字列之间的缝 */
  demoGap: 18,
  headSize: 17, headH: 22,
  metaSize: 12, metaH: 16, metaGap: 12,
  descSize: 15, descLineH: 20, descLead: 8, descMaxLines: 3,
  padBottom: 14,
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
  /** 键面读数种类(与 core/types 的 SkillDef.kind 同义;"charge" = 资源制,卡片不印 CD) */
  kind?: "cd" | "charge";
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
  /** 内容列左右边界(左界 = 演示盒右缘 + 缝;右界扣掉内边距与斜切最坏边) */
  innerL: number;
  innerR: number;
  /** 演示盒右缘:文字列不许越过它(压到画上 = 读不出在讲什么) */
  demoRight: number;
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

/**
 * 蓄满要几拍:把「这款技能的门槛是一整局的积累」翻译成玩家能规划的次数。
 * 两个数都说 —— 只印最好那个(每拍又准又杀)就是在骗人,只印最坏那个又白丢了
 * "打得好就攒得快"这层正反馈。上下界直接从 config 的增益算,不在这里抄数字。
 * 多管蓄力后印「蓄**一管** N~M 拍」:卡片读数槽只有 cardW-6 宽(82px),
 * 「蓄满一管 N~M 拍 · 最多攒 3 管」90px 出卡(skill-check 量过)—— 管数上限
 * 由说明行/config desc 承载,卡面只报一管的账。
 */
export function skillFillShots(def: SkillLike): string {
  const RG = CFG.skills.rage;
  const best = Math.ceil(RG.max / (RG.perHit * RG.bothMul));
  const worst = Math.ceil(RG.max / RG.perHit);
  return `蓄一管 ${best}~${worst} 拍`;
}

/**
 * 卡片与详情板的那一行读数:冷却款印 CD,充能款印「蓄满几拍」。
 *
 * 为什么不能照旧印 CD:怒气重击的 cooldownFrames 是 20 帧(只防同帧连点,不是门槛),
 * 印出来是「CD 0.3s」—— 玩家会以为它 0.3 秒就能再放一次,而真相是要打十几拍。
 * 一款把门槛写在资源上的技能却报一个假冷却,和"看不见怒气"是同一类 bug。
 * 判据在 def.kind(skill-dialog 从 Skills.allSkills() 直接带过来),不散在各处比 id。
 */
export function skillMeter(def: SkillLike): string {
  return def.kind === "charge" ? skillFillShots(def) : skillCd(def);
}

/** 详情板右上角那一格状态:四态(双技能槽 2026-10-06 起)。slot:0=未装备 / 1=装在槽1 / 2=装在槽2 */
export function skillStatus(def: SkillLike, unlocked: boolean, slot: 0 | 1 | 2): string {
  if (!unlocked) return `未解锁 · Lv.${def.unlockLevel}`;
  if (slot === 1) return "已装槽1";
  if (slot === 2) return "已装槽2";
  return "可装备";
}

/**
 * 卡片底部那颗操作按钮的文案:跟着「选中槽」与这张卡的装备位置走 ——
 * 按钮语义 = 对选中槽执行这个动作(装入/换到/卸下),不再是单纯的"装备"。
 * slotSel:当前选中的目标槽(1/2);equipSlot:这张卡现在装在哪(0=没装);slot2Occupied:槽2有没有货。
 * 惯例:槽1 恒有技能(equipSkill 口径②),所以「槽1那款挪进空槽2」不存在 —— 按钮给惰性的"已装槽1"。
 */
export function skillBtnLabel(
  def: SkillLike, unlocked: boolean, slotSel: 1 | 2, equipSlot: 0 | 1 | 2, slot2Occupied: boolean,
): string {
  if (!unlocked) return `Lv.${def.unlockLevel} 解锁`;
  if (equipSlot === slotSel) return slotSel === 2 ? "卸下槽2" : "已装槽1";
  if (equipSlot !== 0) {
    // 装在另一槽:目标是槽1 → 换到槽1(互换后槽1 照旧有货);目标是槽2 → 槽2有货才换
    if (slotSel === 1) return "换到槽1";
    return slot2Occupied ? "换到槽2" : "已装槽1";
  }
  return slotSel === 1 ? "装入槽1" : "装入槽2";
}

/** 槽位 chip 的读数:装备了显技能短名,空槽显「空」 */
export function slotChipText(slot: 1 | 2, shortName: string | null): string {
  return `技能${slot} · ${shortName ?? "空"}`;
}

/** 槽位行整行的总宽(两颗 chip + 缝 + 完成键),用于居中 */
function slotRowW(): number {
  return SK.slotW * 2 + SK.slotGap + SK.finGap + SK.finW;
}

/** 槽位 chip 的中心 x:两颗 chip 与完成键排成一行,整行居中 */
export function slotChipX(slot: 1 | 2): number {
  return -slotRowW() / 2 + (slot - 1) * (SK.slotW + SK.slotGap) + SK.slotW / 2;
}

/** 完成键的中心 x:贴这一行的最右 */
export function slotFinX(): number {
  return slotRowW() / 2 - SK.finW / 2;
}

// ---------- 面板竖排判据(双槽 + 演示盒版) ----------

export interface StackItem { key: string; cy: number; h: number; }

/** 标题 / 槽位行 / 卡片行 / 详情板,自上而下四个盒子(渲染层与判据共用同一份几何) */
export function panelStack(): StackItem[] {
  return [
    { key: "title", cy: SK.titleY, h: 30 },
    { key: "slots", cy: SK.slotY, h: SK.slotH },
    { key: "cards", cy: SK.cardsY, h: SK.cardH + SK.cardEdge },
    { key: "plate", cy: SK.plateY, h: SK.plateH },
  ];
}

/**
 * 竖排不撞、不出面板。倒三角住在「卡片行底缘(含厚底边)与详情板上缘」那条缝里,
 * 这里一并量:缝宽不够装 caret(10 高)也算犯规。
 */
export function panelStackFits(panelH: number = SK.panelH, margin = 6): string[] {
  const bad: string[] = [];
  const half = panelH / 2;
  const items = panelStack();
  for (const it of items) {
    if (it.cy + it.h / 2 > half - margin) bad.push(`${it.key}:上缘 ${it.cy + it.h / 2} 越过面板上界 ${half - margin}`);
    if (it.cy - it.h / 2 < -half + margin) bad.push(`${it.key}:下缘 ${it.cy - it.h / 2} 越过面板下界 ${-half + margin}`);
  }
  // items 恒按自上而下摆(cy 递减,UI 本地 y 向上):A 在上、B 在下,缝 = A 底缘 - B 顶缘
  for (let i = 0; i + 1 < items.length; i++) {
    const A = items[i], B = items[i + 1];
    const gap = (A.cy - A.h / 2) - (B.cy + B.h / 2);
    if (gap < 2) bad.push(`${A.key} 与 ${B.key} 相撞(缝 ${gap.toFixed(1)})`);
  }
  // 倒三角那条缝:cards 底缘(含厚底边)→ plate 顶缘
  const cards = items[2], plate = items[3];
  const gap2 = (cards.cy - cards.h / 2) - (plate.cy + plate.h / 2);
  if (gap2 < 12) bad.push(`卡片与详情板之间的缝 ${gap2.toFixed(1)} 装不下倒三角(需 12)`);
  return bad;
}

/** 槽位行里的三颗可点件(两颗 chip + 完成键),横排几何 */
export function slotRowBoxes(): Array<{ key: string; left: number; right: number; h: number }> {
  return [
    { key: "slot1", left: slotChipX(1) - SK.slotW / 2, right: slotChipX(1) + SK.slotW / 2, h: SK.slotH },
    { key: "slot2", left: slotChipX(2) - SK.slotW / 2, right: slotChipX(2) + SK.slotW / 2, h: SK.slotH },
    { key: "fin", left: slotFinX() - SK.finW / 2, right: slotFinX() + SK.finW / 2, h: SK.finH + SK.finShadow },
  ];
}

/**
 * 槽位行横排判据:三颗件互不压、每颗都不越出**该高度处的斜切边界**。
 * 边界为什么按 y 现算:面板是个平行四边形,y=147 那一行的可用半宽是
 * 350 - 147×tan3° ≈ 342,不是 350 —— 拿 350 量会把键画到斜边外面。
 */
export function slotRowFits(): string[] {
  const bad: string[] = [];
  const boxes = slotRowBoxes();
  const edge = panelHalfAt(SK.slotY, SK.panelW, SK.slantDeg);
  for (const b of boxes) {
    if (b.right > edge) bad.push(`${b.key}:右缘 ${b.right.toFixed(1)} 出了斜切边界 ${edge.toFixed(1)}`);
    if (b.left < -edge) bad.push(`${b.key}:左缘 ${b.left.toFixed(1)} 出了斜切边界 ${-edge.toFixed(1)}`);
  }
  for (let i = 0; i + 1 < boxes.length; i++) {
    const gap = boxes[i + 1].left - boxes[i].right;
    if (gap < 8) bad.push(`${boxes[i].key} 与 ${boxes[i + 1].key} 缝只有 ${gap.toFixed(1)}(< 8 会点错)`);
  }
  if (SK.finH < 44) bad.push(`完成键高 ${SK.finH} < TOUCH_MIN 44`);
  return bad;
}

/** 第 i 张卡的中心 x:n 张横排整体居中 */
export function skillCardX(i: number, n: number = 5): number {
  return (i - (n - 1) / 2) * SK.cardPitch;
}

// ---------- 放大窗(点演示盒开大的那一屏) ----------

/**
 * 演示放大窗的版式。为什么要有第二屏:详情板左列那格只有 250×150,画得下「谁在哪儿、
 * 按下去发生了什么」,画不下**为什么** —— 分步讲解要一条能读完的文案 + 翻步的键。
 * 同一份 ui/skill-diagram 点列,换个盒子再画一遍(尺寸是它的一个参数,不是第二套画面)。
 */
export const SD = {
  panelW: 560, panelH: 420,
  /** 顶行:标题(居中在剩余列里)+ 关闭键(贴右,按斜切边界倒推) */
  titleY: 180, closeW: 84, closeH: 44,
  /** 画布:456×260 —— 宽按窗口内容列给足,高是被"文案 + 底排三颗键"挤出来的 */
  canvasW: 456, canvasH: 260, canvasY: 24,
  /** 当前这一步:「2 · 等到点」+ 正文一行 */
  capY: -128, capH: 34, capSize: 12, capLineH: 17, capMaxLines: 2,
  /** 底排:上一步 / 定格·连播 / 下一步 */
  keyY: -178, keyH: 44, keyW: 84, keyGap: 10,
  pad: 14,
} as const;

/** 面板在某个高度处的可用半宽(平行四边形,越靠边越窄) */
export function panelHalfAt(y: number, panelW: number, slantDeg: number): number {
  return panelW / 2 - Math.abs(y) * Math.tan(slantDeg * Math.PI / 180);
}

/** 放大窗的关闭键中心 x:贴内容列右缘 */
export function sdCloseX(): number {
  return panelHalfAt(SD.titleY, SD.panelW, SK.slantDeg) - SD.pad - SD.closeW / 2;
}

/** 放大窗标题的居中 x:内容列左缘到关闭键左缘的中点 */
export function sdTitleX(): number {
  const l = -panelHalfAt(SD.titleY, SD.panelW, SK.slantDeg) + SD.pad;
  return (l + (sdCloseX() - SD.closeW / 2)) / 2;
}

/** 放大窗竖排:顶行 / 画布 / 文案 / 底排,四格彼此留缝且不出窗口 */
export function sdStack(): StackItem[] {
  return [
    { key: "head", cy: SD.titleY, h: SD.closeH },
    { key: "canvas", cy: SD.canvasY, h: SD.canvasH },
    { key: "cap", cy: SD.capY, h: SD.capH },
    { key: "keys", cy: SD.keyY, h: SD.keyH },
  ];
}

export function sdStackFits(panelH: number = SD.panelH, margin = 6): string[] {
  const bad: string[] = [];
  const half = panelH / 2;
  const items = sdStack();
  for (const it of items) {
    if (it.cy + it.h / 2 > half - margin) bad.push(`${it.key}:上缘 ${it.cy + it.h / 2} 越过窗口上界 ${half - margin}`);
    if (it.cy - it.h / 2 < -half + margin) bad.push(`${it.key}:下缘 ${it.cy - it.h / 2} 越过窗口下界 ${-half + margin}`);
  }
  for (let i = 0; i + 1 < items.length; i++) {
    const A = items[i], B = items[i + 1];
    const gap = (A.cy - A.h / 2) - (B.cy + B.h / 2);
    if (gap < 4) bad.push(`${A.key} 与 ${B.key} 相撞(缝 ${gap.toFixed(1)})`);
  }
  const rowW = SD.keyW * 3 + SD.keyGap * 2;
  const edge = panelHalfAt(SD.keyY, SD.panelW, SK.slantDeg) - SD.pad;
  if (rowW / 2 > edge) bad.push(`底排三颗键半宽 ${rowW / 2} 出了内容列 ${edge.toFixed(1)}`);
  if (SD.closeH < 44) bad.push(`关闭键高 ${SD.closeH} < TOUCH_MIN 44`);
  for (const k of [SD.keyH, SD.closeH]) if (k < 44) bad.push(`键高 ${k} < TOUCH_MIN 44`);
  return bad;
}

// ---------- 排版 ----------

/**
 * 详情板左列那块演示盒的几何(板中心为原点)。面板照它摆节点、判据照它核「文字有没有压到画上」。
 * 上下各留 6 贴着板,左右贴着内边距 —— 演示盒就是这块板的**左半边**,不是浮在上面的贴图。
 */
export function demoBox(): { cx: number; cy: number; w: number; h: number; left: number; right: number } {
  const left = -SK.plateW / 2 + SK.platePad;
  return { cx: left + SK.demoW / 2, cy: 0, w: SK.demoW, h: SK.demoH, left, right: left + SK.demoW };
}

/**
 * 放大窗里这一步的文案:「2 · 等到点 —— 正文」折好行。
 * 面板只管照行数摆 Label,判据拿同一个函数核「这一句放不放得进文案带」——
 * 两边共用一份折行,不会出现"预览里两行、真机上一行半被切掉"。
 */
export function sdCaptionLines(step: number, name: string, text: string, measure: Measure = textW): string[] {
  const avail = SD.panelW - 2 * SD.pad - shearOf(SD.capH, SK.slantDeg);
  return wrapText(`${step + 1} · ${name} —— ${text}`, SD.capSize, avail, measure);
}

/**
 * 一个技能 → 详情板排版(右列文字)。
 *
 * 头部一行(全名左 / 冷却 + 状态右),说明在剩下的带子里垂直居中 —— 所以说明 1 行还是
 * 3 行都不会把别的项挤走,面板尺寸恒定这件事是结构给的。
 * 内容列的左界 = 演示盒右缘 + 缝:文字与画面**由同一个数隔开**,不靠"这句刚好不长"。
 */
export function layoutSkillPlate(
  def: SkillLike, unlocked: boolean, equipSlot: 0 | 1 | 2, measure: Measure = textW,
): PlateLayout {
  const shear = shearOf(SK.plateH, SK.slantDeg) / 2;
  const demo = demoBox();
  const innerL = demo.right + SK.demoGap;
  const innerR = Math.min(SK.plateW / 2 - SK.platePad - shear, SK.plateW / 2 - SK.platePad);
  const availW = innerR - innerL;

  // 头部:全名左起,状态贴右,冷却排在状态左边 —— 三个 x 全是量出来的
  const nameLines = [def.name];
  const nameW = measure(def.name, SK.headSize);
  const statusText = skillStatus(def, unlocked, equipSlot);
  const statusW = measure(statusText, SK.metaSize);
  // 项的 key/role 仍叫 "cd":它是「这一格读数是技能可用性」这个**版式位置**的名字,
  // 不是秒数的名字(skill-dialog 的 plateLbl[role] 映射按它取键)。内容换成了蓄满拍数,
  // 位置与对齐算法一个字都不动 —— 换文案不换几何,才不会有第六处再抄一遍摆位。
  const meterTxt = skillMeter(def);
  const cdW = measure(meterTxt, SK.metaSize);
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
      key: "cd", role: "cd", lines: [meterTxt], size: SK.metaSize, lineH: SK.metaH, h: SK.metaH,
      w: cdW, left: innerR - statusW - SK.metaGap - cdW, x: innerR - statusW - SK.metaGap, cy: headCy, align: 2,
    },
    {
      key: "desc", role: "desc", lines: lines.length ? lines : [""], size: SK.descSize, lineH: SK.descLineH, h: descH,
      w: descW, left: innerL, x: innerL, cy: descCy, align: 0,
    },
  ];

  // 当前这份文案**需要**多高的板;超过 SK.plateH 就是排版不够用,skill-check 判红
  const stackH = SK.platePad + SK.headH + SK.descLead + descH + SK.padBottom;

  return { items, plateW: SK.plateW, plateH: SK.plateH, innerL, innerR, demoRight: demo.right, availW, stackH, descLines: lines.length };
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
