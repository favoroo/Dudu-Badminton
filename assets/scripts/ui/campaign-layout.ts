// ============================================================
// 闯关大厅版式:标题行 / 场景 tab / 五张关卡卡 / 「继续闯关」条 的唯一算术。
//
// 为什么提成纯函数 —— 这一屏原来把坐标全写死在 campaign-panel 里
// (PW/PH、CARD_W=158·CARD_H=265、tabH=34、RESUME_X0=-404、SKC.right=126、卡内八个 y),
// 而它正是「改一个数全线撞车」的那类排版:
//   · tab 从 34 抬到触控下限 TOUCH.min=44 之后,行心若还留在 164,上缘就从 181 顶到 186,
//     直接压进 24 号标题字的盒子(盒底 180)—— 行心得降到 150 才腾出 8 的空隙;
//   · 卡片换成「墨面 + 顶部一条 accent 色带」,色带高、色带里两行字、状态胶囊、
//     星级印章必须一起重排 —— 手调那八个 y 只保证当前这 20 关不撞字:关卡名最长 5 字
//     (「超频神仙斗」),副标题是全大写英文(「CHAMPIONSHIP POINT」实测 ~100px),
//     卡宽一收紧就被推出卡外;
//   · 底部「继续闯关」条的底块宽跟着文案走(命中区必须同步改 contentSize,那是一条
//     修过的真 bug),它右边那句提示最长 ~419px:条子一变宽,提示就被挤出内容右缘。
// 这类账手调是调不准的,也留不住 —— 交给 tools/panel-check.ts 在 node 下断言。
//
// 两条刻意的秩序(改版时钉死,别退回手拍数字):
//   1) tab 四格与卡五张**都恰好铺满内容列**(±404):193×4+12×3 = 152×5+12×4 = 808,
//      于是两条横排共享同一对边线,读起来是一张版面而不是两叠各自居中的零件。
//   2) 大色块只留给两处 —— 底部「继续闯关」那一条与选中的 tab;卡片整面必须保持墨面,
//      五张亮色卡会排成五色彩虹(出图实测),P5 的语言是红黑白主导 + 点缀。
//
// 依赖纪律:零 cc,只 import p5-tokens 与本目录的 text-metrics(与 settings-layout 同规格)。
// 面板只照返回的坐标摆,判据(campaignOverlaps / campaignOverflow)由 check 在 node 下跑。
// ============================================================
import { TOUCH } from "./p5-tokens";
import { textW } from "../core/text-metrics";

// ---------- 骨架尺寸 ----------

/** 内容左右缘的面板内缩:两条横排与标题行/直达条都贴这两条线 */
const PAD_X = 36;
/** 内容列宽 = 808(= 2 * (880/2 - 36)) */
const CONTENT_W = 880 - PAD_X * 2;
const TAB_GAP = 12;
const CARD_GAP = 12;
/** 整数解:四格 193、五张 152,两条横排都恰好铺满内容列 */
const TAB_W = (CONTENT_W - 3 * TAB_GAP) / 4;
const CARD_W = (CONTENT_W - 4 * CARD_GAP) / 5;

export const CMP = {
  pw: 880,
  ph: 480,
  /** 内容左缘 / 右缘 */
  colX: -CONTENT_W / 2,
  right: CONTENT_W / 2,
  /** 标题行:EN kicker 在上、中文标题在下,都左锚贴 colX */
  tag: { x: -CONTENT_W / 2, cy: 222, size: 10 },
  title: { x: -CONTENT_W / 2, cy: 196, size: 24 },
  /** 总星数读数:右锚,x 就是文字收尾处(给 ✕ 让开命中区) */
  stars: { right: 368, cy: 198, size: 16, maxW: 240 },
  close: { x: CONTENT_W / 2, cy: 198, hit: TOUCH.min, vis: 36 },
  /** 头部技能胶囊:**右缘**钉在 right,左边是标题、右边是星数,名字只能推着左缘动 */
  skill: {
    cy: 198, right: 116, h: 32, hit: TOUCH.min,
    pad: 14, gap: 10, tagSize: 11, nameSize: 14, goSize: 11,
  },
  /** 场景 tab 行:高 = 触控下限,行心 150(下缘 128,与卡行上缘 98.5 之间留 29.5) */
  tab: { w: TAB_W, h: TOUCH.min, gap: TAB_GAP, cy: 150, size: 15 },
  /** 关卡卡行:色带是卡片唯一的大面亮色,所以 bandH 与卡内各行的行心一起在这里定 */
  card: { w: CARD_W, h: 265, gap: CARD_GAP, cy: -34, bandH: 52, teeth: 0, padX: 10 },
  /** 底部直达条:底块宽随文案走(见 resumeRow),命中区必须由调用点跟着改 */
  resume: {
    x0: -CONTENT_W / 2, cy: -206, h: 48,
    wMin: 300, wMax: 430, padX: 33, gap: 20, size: 17,
    hintSize: 12, hintMax: 430,
  },
} as const;

/** 文案常量:面板与判据共用同一串,量宽才不会被改出两份 */
export const HEADER_TEXT = { tag: "PVE CHALLENGE", title: "巅峰闯关模式" } as const;
export const SKILL_TAG_TEXT = "技能";
export const SKILL_GO_TEXT = "更换 ›";
export const LOCK_TEXT = "待解锁";

// ---------- 包围盒 ----------

export interface Box { left: number; right: number; cy: number; h: number }

export const top = (b: Box): number => b.cy + b.h / 2;
export const bottom = (b: Box): number => b.cy - b.h / 2;

/** 左缘 + 宽 + 行心 → 包围盒 */
export function box(left: number, w: number, cy: number, h: number): Box {
  return { left, right: left + w, cy, h };
}

/** 中心 + 宽 + 行心 → 包围盒(卡内那几行是按中心排的) */
export function cbox(cx: number, w: number, cy: number, h: number): Box {
  return box(cx - w / 2, w, cy, h);
}

// ---------- 横排 ----------

/** 场景 tab:每项的包围盒(整行铺满内容列,左缘 = colX) */
export function tabRow(n: number = 4): Box[] {
  const { w, h, gap, cy } = CMP.tab;
  const left0 = CMP.colX;
  return Array.from({ length: n }, (_, i) => box(left0 + i * (w + gap), w, cy, h));
}

/** 关卡卡片:每项的包围盒(同样铺满内容列) */
export function cardRow(n: number = 5): Box[] {
  const { w, h, gap, cy } = CMP.card;
  const left0 = CMP.colX;
  return Array.from({ length: n }, (_, i) => box(left0 + i * (w + gap), w, cy, h));
}

// ---------- 卡片内部(卡中心为原点) ----------

export interface CardRows {
  /** 顶部 accent 色带:亮面,里面的字一律 inkFor(面色) */
  band: Box;
  /** 色带上行:关卡编号 */
  no: Box;
  /** 色带下行:核心特色标签 */
  badge: Box;
  /** 以下都在墨面上 */
  title: Box;
  sub: Box;
  goal: Box;
  diff: Box;
  /** 状态胶囊(下一关 / 最佳比分 / 可挑战) */
  state: Box;
  /** 星级印章行(锁定态换成 lockRow) */
  stars: Box;
  /** 色带下缘的 y:墨面从这里开始 */
  faceTop: number;
}

/**
 * 卡内格子:色带(含它的两行字)+ 墨面六行。
 * 行高一律按字号的 1.35 给足(Label 不设 contentSize 会被忽略,长文案整段推出卡片),
 * 相邻行之间的空隙由 campaignOverlaps 逐对钉住 —— 手调时看不出 3px 的撞,按下就是糊成一片。
 */
export function cardRows(): CardRows {
  const { w, h, bandH, padX } = CMP.card;
  const bandCy = h / 2 - bandH / 2;
  const inner = w - padX * 2;
  const mid = (cy: number, hh: number, ww: number = inner): Box => cbox(0, ww, cy, hh);
  return {
    band: cbox(0, w, bandCy, bandH),
    no: mid(bandCy + 15, 15),
    badge: mid(bandCy - 9, 19),
    faceTop: bandCy - bandH / 2,
    title: mid(50, 28, inner + padX * 2 - 6),
    sub: mid(24, 13, inner + padX * 2 - 6),
    goal: mid(2, 18),
    diff: mid(-24, 16),
    state: mid(-58, 26, 108),
    stars: mid(-102, 22, 110),
  };
}

export interface StarRow {
  /** 三颗四尖星的中心 x 与半径(实=拿到、空=描边,一律 Graphics) */
  xs: number[];
  s: number;
  cy: number;
}

/** 星级行:三颗等距星(整行居中于卡心) */
export function starRow(n: number = 3): StarRow {
  const { stars } = cardRows();
  const s = 9;
  const pitch = (stars.right - stars.left) / (n + 1);
  return {
    s,
    cy: stars.cy,
    xs: Array.from({ length: n }, (_, i) => stars.left + pitch * (i + 1)),
  };
}

export interface LockRow {
  /** 锁印章中心与边长 */
  cx: number;
  s: number;
  /** 「待解锁」文字盒(左锚:left 就是起笔处) */
  text: Box;
}

/**
 * 锁定态:锁 + 纯文本,顶掉星级行。
 * 不用 🔒 —— 原生 Android 没有彩色 emoji 字体,真机上要么方框要么缺字
 * (本仓库 makeCoinIcon 的注释就是为此而生),形状一律走 drawRankBadge("lock")。
 */
export function lockRow(): LockRow {
  const { stars } = cardRows();
  const s = 16, gap = 7;
  const tw = textW(LOCK_TEXT, 11);
  const x0 = -(s + gap + tw) / 2;
  return { cx: x0 + s / 2, s, text: box(x0 + s + gap, tw, stars.cy, 15) };
}

// ---------- 标题行 ----------

export interface HeaderBoxes {
  tag: Box;
  title: Box;
  stars: Box;
  close: Box;
  skill: Box;
}

/** 技能胶囊的实测宽与三块文字的格子(胶囊本地坐标,底块宽随技能名走,命中区必须跟着改) */
export interface SkillChip {
  /** 整块胶囊的包围盒(面板坐标,右缘钉在 CMP.skill.right) */
  box: Box;
  /** 胶囊本地坐标:三块都是左锚,left 即起笔处,cy = 0 */
  tag: Box;
  name: Box;
  go: Box;
  w: number;
  nameW: number;
}

export function skillChip(name: string): SkillChip {
  const S = CMP.skill;
  const tagW = textW(SKILL_TAG_TEXT, S.tagSize);
  const nameW = textW(name, S.nameSize);
  const goW = textW(SKILL_GO_TEXT, S.goSize);
  const w = S.pad + tagW + S.gap + nameW + S.gap + goW + S.pad;
  const tagX = -w / 2 + S.pad;
  const nameX = tagX + tagW + S.gap;
  const goX = nameX + nameW + S.gap;
  return {
    box: box(S.right - w, w, S.cy, S.hit),
    tag: box(tagX, tagW, 0, Math.round(S.tagSize * 1.35)),
    name: box(nameX, nameW, 0, Math.round(S.nameSize * 1.35)),
    go: box(goX, goW, 0, Math.round(S.goSize * 1.35)),
    w,
    nameW,
  };
}

/**
 * 标题行五个块的包围盒。
 * @param starsText 总星数读数(右锚,宽度由实测来)
 * @param skillName 当前装备的技能名(胶囊宽随它走)
 */
export function headerBoxes(starsText: string, skillName: string): HeaderBoxes {
  const chip = skillChip(skillName);
  const starsW = textW(starsText, CMP.stars.size);
  return {
    tag: box(CMP.tag.x, textW(HEADER_TEXT.tag, CMP.tag.size) + 6, CMP.tag.cy, Math.round(CMP.tag.size * 1.6)),
    title: box(CMP.title.x, textW(HEADER_TEXT.title, CMP.title.size), CMP.title.cy, 32),
    stars: box(CMP.stars.right - starsW, starsW, CMP.stars.cy, 22),
    close: box(CMP.close.x - CMP.close.hit / 2, CMP.close.hit, CMP.close.cy, CMP.close.hit),
    skill: chip.box,
  };
}

// ---------- 底部直达条 ----------

export interface ResumeRow {
  /** 底块(= 命中区):宽随文案走,调用点必须把 contentSize 改成同一个数 */
  bar: Box;
  hint: Box;
  /** 提示行实测宽与可用宽:超线就是 campaignOverflow 的活 */
  hintW: number;
  hintAvail: number;
}

/**
 * 「继续闯关」条 + 右侧提示行。
 * 条宽 = 文案实测 + 两侧内边距,夹在 [wMin, wMax];提示行拿到的是**剩下的**宽度,
 * 所以条子变宽会立刻在这里把提示行的溢出暴露出来(以前是固定 430 的虚报宽度)。
 */
export function resumeRow(label: string, hint: string): ResumeRow {
  const R = CMP.resume;
  const w = Math.min(R.wMax, Math.max(R.wMin, textW(label, R.size) + R.padX * 2));
  const bar = box(R.x0, w, R.cy, R.h);
  const left = R.x0 + w + R.gap;
  const avail = CMP.right - left;
  return {
    bar,
    hint: box(left, Math.min(R.hintMax, avail), R.cy, Math.round(R.hintSize * 1.35)),
    hintW: textW(hint, R.hintSize),
    hintAvail: avail,
  };
}

// ---------- 判据 ----------

const EPS = 0.5;

const overlapX = (a: Box, b: Box): boolean => a.left < b.right - EPS && b.left < a.right - EPS;
const overlapY = (a: Box, b: Box): boolean => bottom(a) < top(b) - EPS && bottom(b) < top(a) - EPS;

/** 两个包围盒是否压在一起 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapX(a, b) && overlapY(a, b);
}

/** 越出内容列 / 面板上下缘 */
export function boxOverflow(b: Box): string | null {
  if (b.left < CMP.colX - EPS) return `左缘 ${b.left.toFixed(1)} < ${CMP.colX}`;
  if (b.right > CMP.right + EPS) return `右缘 ${b.right.toFixed(1)} > ${CMP.right}`;
  if (top(b) > CMP.ph / 2) return `顶边 ${top(b).toFixed(1)} > ${CMP.ph / 2}`;
  if (bottom(b) < -CMP.ph / 2) return `底边 ${bottom(b).toFixed(1)} < ${-CMP.ph / 2}`;
  return null;
}

/**
 * 只查面板边界:✕ 那种「命中区中心钉在内容右缘」的小面大键,盒子**本该**越过内容列
 * (404±22 → 426),但绝不许越过那张纸(±440)。
 */
export function panelOverflow(b: Box): string | null {
  if (b.left < -CMP.pw / 2 + 8) return `左缘 ${b.left.toFixed(1)} 出纸`;
  if (b.right > CMP.pw / 2 - 8) return `右缘 ${b.right.toFixed(1)} 出纸`;
  if (top(b) > CMP.ph / 2) return `顶边 ${top(b).toFixed(1)} > ${CMP.ph / 2}`;
  if (bottom(b) < -CMP.ph / 2) return `底边 ${bottom(b).toFixed(1)} < ${-CMP.ph / 2}`;
  return null;
}

/** 20 关表里最长的那一组卡内文案(改 campaign.ts 的文案要把这里一起改) */
export const WORST_CARD_TEXTS = {
  no: "STAGE 20",
  badge: "水墨子弹时间",
  title: "超频神仙斗",
  sub: "CHAMPIONSHIP POINT",
  goal: "一球生死战",
  diff: "难度: 大师",
  state: "最佳 21-19",
} as const;

/** 最坏情况的标题行读数 */
export const WORST_STARS = "★ 60 / 60 · 已通关 20/20";
export const WORST_SKILL = "百分百重击";
/** 最坏情况的直达条两句(label 变长会把 hint 挤出内容右缘) */
export const WORST_RESUME: Array<[string, string]> = [
  ["继续闯关 · 第 20 关「冠军赛点」",
    "【生死决胜局】一球生死战 · 难度 大师 · 首通 +1200 金币 +480 经验"],
  ["全部通关 · 重玩第 1 关", "20 道场景挑战已全部拿下,挑一关再冲三星"],
];

const pairwise = (nm: string, bs: Box[], out: string[]): void => {
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      if (boxesOverlap(bs[i], bs[j])) out.push(`${nm}:第 ${i} 与第 ${j} 块重叠`);
    }
  }
};

/**
 * 压字判据:四段之间、段内各项之间、卡内各格子之间,两两不许相交。
 * 直达条与提示行是一对**贴着排**的盒子(缝 = CMP.resume.gap),
 * 所以它们只跟「越过内容右缘」较真,不跟彼此较真。
 */
export function campaignOverlaps(): string[] {
  const out: string[] = [];
  const H = headerBoxes(WORST_STARS, WORST_SKILL);
  const tabs = tabRow();
  const cards = cardRow();
  const R = resumeRow(WORST_RESUME[0][0], WORST_RESUME[0][1]);

  pairwise("标题行", [H.tag, H.title, H.stars, H.close, H.skill], out);
  pairwise("tab 行", tabs, out);
  pairwise("卡行", cards, out);

  // 段与段:kicker 与标题在左、星数/胶囊/关闭在右,三档横排(标题行 → tab → 卡 → 直达条)
  for (const [nm, a] of [["tag", H.tag], ["title", H.title]] as Array<[string, Box]>) {
    for (const [m, b] of [["tab#0", tabs[0]], ["tab#3", tabs[tabs.length - 1]]] as Array<[string, Box]>) {
      if (boxesOverlap(a, b)) out.push(`${nm} 压住 ${m}`);
    }
    if (boxesOverlap(a, R.bar)) out.push(`${nm} 压住直达条`);
  }
  for (const [nm, a] of [["stars", H.stars], ["close", H.close], ["skill", H.skill]] as Array<[string, Box]>) {
    if (boxesOverlap(a, tabs[3])) out.push(`${nm} 压住最右 tab`);
  }
  for (const [nm, a] of [["tab", tabs[0]], ["tab末", tabs[tabs.length - 1]]] as Array<[string, Box]>) {
    for (let i = 0; i < cards.length; i++) {
      if (boxesOverlap(a, cards[i])) out.push(`${nm} 压住卡#${i}`);
    }
  }
  for (let i = 0; i < cards.length; i++) {
    if (boxesOverlap(cards[i], R.bar)) out.push(`卡#${i} 压住直达条`);
    if (boxesOverlap(cards[i], R.hint)) out.push(`卡#${i} 压住提示行`);
  }

  // 卡内八行(卡中心为原点的局部坐标系)
  const K = cardRows();
  const rows: Array<[string, Box]> = [
    ["色带", K.band], ["编号", K.no], ["特色", K.badge], ["关卡名", K.title],
    ["副标题", K.sub], ["目标", K.goal], ["难度", K.diff], ["状态胶囊", K.state], ["星级", K.stars],
  ];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [a, b] = [rows[i][1], rows[j][1]];
      // 色带是它自己两行字的**容器**,不算压字(容器与内容同框是应有之义)
      if (rows[i][0] === "色带" || rows[j][0] === "色带") continue;
      if (boxesOverlap(a, b)) out.push(`卡内 ${rows[i][0]} × ${rows[j][0]}`);
    }
  }
  // 锁定态的锁与「待解锁」不许互相压字
  const L = lockRow();
  const lockBox = box(L.cx - L.s / 2, L.s, L.text.cy, L.s);
  if (boxesOverlap(lockBox, L.text)) out.push("锁定态:锁印章压住「待解锁」");
  const SR = starRow();
  const starBox = box(SR.xs[0] - SR.s, (SR.xs[SR.xs.length - 1] + SR.s) - (SR.xs[0] - SR.s), SR.cy, SR.s * 2);
  if (boxesOverlap(starBox, K.state)) out.push("星级行压住状态胶囊");
  return out;
}

/**
 * 溢出与容量判据:块不许越出内容列,文案必须塞得进给它的那一格。
 * @param cardTexts 卡内最长那组文案(默认 20 关表里的实际最长)
 * @param resumePairs 直达条的 (label, hint) 组合
 */
export function campaignOverflow(
  cardTexts: Record<keyof typeof WORST_CARD_TEXTS, string> = WORST_CARD_TEXTS,
  resumePairs: Array<[string, string]> = WORST_RESUME,
  starsText: string = WORST_STARS,
  skillName: string = WORST_SKILL,
): string[] {
  const out: string[] = [];
  const H = headerBoxes(starsText, skillName);
  for (const [nm, b] of [["tag", H.tag], ["title", H.title], ["stars", H.stars],
    ["skill", H.skill], ["tab#0", tabRow()[0]], ["tab#3", tabRow()[3]],
    ["card#0", cardRow()[0]], ["card#4", cardRow()[4]],
    ["resume", resumeRow(resumePairs[0][0], resumePairs[0][1]).bar]] as Array<[string, Box]>) {
    const o = boxOverflow(b);
    if (o) out.push(`${nm} ${o}`);
  }
  // ✕ 是「小面大键」:盒子按命中算,允许越过内容列,但必须在纸上
  const co = panelOverflow(H.close);
  if (co) out.push(`close ${co}`);
  // 卡内:每行必须留在卡面内(卡中心为原点)
  const K = cardRows();
  const half = CMP.card.w / 2;
  for (const [nm, b] of Object.entries({ badge: K.badge, no: K.no, title: K.title, sub: K.sub, goal: K.goal, diff: K.diff, state: K.state, stars: K.stars })) {
    if (b.left < -half - EPS || b.right > half + EPS) out.push(`卡内 ${nm} 越出卡面(±${half})`);
    if (bottom(b) < -CMP.card.h / 2 - EPS) out.push(`卡内 ${nm} 探出卡底`);
    if (top(b) > CMP.card.h / 2 + EPS) out.push(`卡内 ${nm} 探出卡顶`);
  }
  // 文案容量:字号给定的实测宽塞不进那一格,就是排版错(不是「再调调坐标」)
  const cap: Array<[string, string, number, number]> = [
    ["编号", cardTexts.no, 10, K.no.right - K.no.left],
    ["特色", cardTexts.badge, 13, K.badge.right - K.badge.left],
    ["关卡名", cardTexts.title, 19, K.title.right - K.title.left],
    ["副标题", cardTexts.sub, 9, K.sub.right - K.sub.left],
    ["目标", cardTexts.goal, 13, K.goal.right - K.goal.left],
    ["难度", cardTexts.diff, 11, K.diff.right - K.diff.left],
    ["状态", cardTexts.state, 12, K.state.right - K.state.left],
    ["总星数", starsText, CMP.stars.size, CMP.stars.maxW],
  ];
  for (const [nm, s, size, w] of cap) {
    const need = textW(s, size);
    if (need > w + EPS) out.push(`卡内「${nm}」${s} 实测 ${need.toFixed(0)}px > 可用 ${w.toFixed(0)}px`);
  }
  // 直达条:条宽越长,右边那句提示越会被挤出内容右缘 —— 这里当场算给看
  for (const [label, hint] of resumePairs) {
    const R = resumeRow(label, hint);
    if (R.hintW > R.hint.right - R.hint.left + EPS) {
      out.push(`提示行实测 ${R.hintW.toFixed(0)}px > 条子(${(R.bar.right - R.bar.left).toFixed(0)}px)右边剩 ${
        (R.hint.right - R.hint.left).toFixed(0)}px ——「${hint}」`);
    }
    if (R.hint.right > CMP.right + EPS) out.push(`提示行右缘 ${R.hint.right.toFixed(1)} > ${CMP.right}`);
  }
  // 色带必须真的存在(卡片唯一的大面亮色),而且不能吃掉整张卡
  const bandRatio = CMP.card.bandH / CMP.card.h;
  if (bandRatio > 0.34) out.push(`色带占卡高 ${(bandRatio * 100).toFixed(0)}% > 34%(整面亮色的前兆)`);
  if (bandRatio < 0.15) out.push(`色带只占卡高 ${(bandRatio * 100).toFixed(0)}%,读不出「这条色是属性」`);
  // 触控下限:可点的三处(单格 tab / 直达条 / 胶囊命中)一律 ≥ 44
  const touch: Array<[string, number]> = [
    ["tab", CMP.tab.h], ["直达条", CMP.resume.h],
    ["技能胶囊命中", CMP.skill.hit], ["关闭键命中", CMP.close.hit],
  ];
  for (const [nm, h] of touch) if (h < TOUCH.min) out.push(`${nm} 高 ${h} < 触控下限 ${TOUCH.min}`);
  return out;
}

// ============================================================
// tools/panel-check.ts 接线时要断言什么(本文件不 import 工具,判据留在这儿)
//
// 正题(全部应为空数组):
//   1) `campaignOverlaps().length === 0` —— 四段横排之间、段内各项之间、卡内格子之间
//      两两不压字;标题行五块(kicker/标题/星数/✕/技能胶囊)在**最坏文案**下互不咬。
//   2) `campaignOverflow().length === 0` —— 块不越内容列 ±404、✕ 不越纸、卡内每行不越卡面、
//      最坏文案塞得进给它的那一格、直达条变宽时提示行仍有余地、色带不吃掉整张卡、
//      可点的四处一律 ≥ TOUCH.min=44。
//   3) 两条横排同边线:`tabRow()` 与 `cardRow()` 的首块 left 都 = CMP.colX、末块 right
//      都 = CMP.right(改版的全部秩序感押在这上面,漂了就等于退回两叠各自居中)。
//   4) 真实数据:把 campaign.ts 的 20 关表喂进 `campaignOverflow(卡内最长那组, 直达条组合)`
//      —— 默认样本是我手挑的最坏组合,关卡文案一改就可能更坏,必须由 check 从表里量出来。
//
// --selftest 的反例(必须被同一条判据报警,否则这套断言没牙齿):
//   · 旧 tab 高 34 + 行心 164 → `checkTouch([["旧 tab", 34]])` 报「< 44」;
//   · 旧卡宽 158 + 缝 14 → 首块 left -407 < colX(手调横排从来就不贴内容列);
//   · 直达条固定命中 300 而底块画到 372 → 用 `resumeRow()` 的 bar 宽去比对,窄的那截
//     就是「看得见点不着」的边翼:反例喂 `box(-404, 300, -206, 48)` 与真实 label 宽不一致;
//   · 提示行按虚报的 430 宽摆 → 喂一条长 label(把条子推到 wMax=430),`campaignOverflow`
//     必须报「提示行实测 … > 条子右边剩 …」;
//   · 卡片整面亮色 → 把 `CMP.card.bandH` 改成 `CMP.card.h`,`色带占卡高 > 34%` 必须报。
// ============================================================
