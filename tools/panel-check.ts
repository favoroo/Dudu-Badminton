// ============================================================
// 「P5 面板语法」静态自检 —— 四面板大色块改版的闸门。
//
// 防的是四类**不会崩、只会安静地难看/难点**的坏:
//   ① 面色与字色对比不够 —— 商店旧 tab 就是 navy2 底 + 白 5% 描边,约 1.1:1,
//      用户读出来是「这按钮是不是坏了」而不是「它没被选中」(本仓库反复踩过的病);
//   ② 网点超预算 —— 这套语法里唯一按面积堆绘制量的件,中低端机直接掉帧;
//   ③ 行距撞字 —— 开关/滑杆从 40 抬到触控下限 44 之后,原来手写的行距会重叠几个 px,
//      屏幕上看不出来,按下就是错档;
//   ④ emoji 与桌面键名 —— 原生 Android 没有彩色 emoji 字体(🔒 会变方框,
//      makeCoinIcon 的注释就是为此而生),而「[K / 左键]」这类文案在手机上是无效指令。
//
// 2026-10-04 起 ① 还管**面板自己画出来的动态块**:商店底部那条提示带的色对与落位
// (旧写法字色与面色是同一支 #ffe14d、位置还压住货架末行 —— 用户截图「提示都看不清」)。
// 判据住在 shop-shelf.TOAST / toastLane(),与面板取的是同一份数据。
//
// 2026-10-05 起加 ⑪「二次确认弹窗」:版式(卡高跟着文案算、两颗键不撞框)+ 接线完整性
// (两颗「重置默认」都得走确认,不许有绕过它直接覆盖存档的第三条路)。
//
// 与同目录其它 check 一样:判据写成吃数据的纯函数,正题喂真实布局,
// --selftest 喂**改动前的真实旧写法** —— 反例必须变红,否则这套断言没牙齿。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/panel-check.js
//   node .tools-build/tools/panel-check.js --selftest
// ============================================================
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import {
  C, CONTRAST_FLOOR, HALFTONE, ROLE, TOUCH, contrast, inkFor,
} from "../assets/scripts/ui/p5-tokens";
import { DRILLS, RARITY_META, CFG } from "../assets/scripts/core/config";
import type { DrillDef } from "../assets/scripts/core/types";
import { halftoneCount, type Paint } from "../assets/scripts/ui/p5-shapes";
import { aboutLayout, assistCopyLines, assistLayout, assistTextOverflow, box, boxOverflow, boxesOverlap, doneBox, LEFT_W, SET, TOG_W, TOG_TAIL, controlLayout, mediaLayout, settingsOverlaps, settingsOverflow } from "../assets/scripts/ui/settings-layout";
import { AIR_FRAMES, DIAG, SEG, beatOf, cropHeightPx, padDiagramDL, type Beat } from "../assets/scripts/ui/pad-diagram";
import { JOYSTICK_BASE, railGeo, type MoveMode } from "../assets/scripts/core/settings";
import { campaignOverflow, campaignOverlaps, CMP } from "../assets/scripts/ui/campaign-layout";
import { DRILL, drillOverflow, drillOverlaps, drillTouch } from "../assets/scripts/ui/drill-layout";
import { accBandH, accShelf, accSlotOverlaps, accSlotRowCounts, CARD_TEXT, cardInnerW, cardTextFits, SHOP, shopContent, shopOverflow, shopOverlaps, shopTouch, SHELF, statCardFits, statCells, TOAST, TOAST_FG, toastLane } from "../assets/scripts/ui/shop-shelf";
import {
  CF, CONFIRM_PAD_RESET, CONFIRM_SKILLS_REQUIRED, confirmOverflow, confirmOverlaps, layoutConfirm,
} from "../assets/scripts/ui/confirm-layout";
import type { Profile } from "../assets/scripts/core/career";
import { Career } from "../assets/scripts/core/career";
import { milestoneViews } from "../assets/scripts/core/milestone";

function findRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets/scripts/ui/ui-arcade.ts"))) return dir;
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  throw new Error("找不到工程根(assets/scripts/ui/ui-arcade.ts)");
}
const ROOT = findRoot();
const UI = join(ROOT, "assets/scripts/ui");
const verbose = process.argv.includes("-v");
const selftest = process.argv.includes("--selftest");

let bad = 0;
/** 失败一定印出来:断言脚本最怕的不是红,是红了却不说红在哪(所以与 strip-check 相反) */
const ok = (cond: boolean, msg: string): void => {
  if (!cond || verbose) console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};

// ============================================================
// 判据(纯函数,吃数据)
// ============================================================

/** ① 面色 / 字色对比:每一对「实底色面 + 它上面的字」都要过线 */
export function checkContrast(pairs: Array<[string, string, string]>): string[] {
  const out: string[] = [];
  for (const [nm, face, text] of pairs) {
    const c = contrast(face, text);
    if (c < CONTRAST_FLOOR) {
      out.push(`${nm}:${face} 底 + ${text} 字 = ${c.toFixed(2)}:1 < ${CONTRAST_FLOOR}`);
    }
  }
  return out;
}

/** ② 网点预算:点数按面积堆,超线只能升 step,不许偷偷把上限调高 */
export function checkHalftone(specs: Array<[string, number, number, number?]>): string[] {
  const out: string[] = [];
  for (const [nm, w, h, step] of specs) {
    const n = halftoneCount(w, h, step ?? HALFTONE.step);
    if (n > HALFTONE.maxDots) out.push(`${nm}:${n} 点 > 上限 ${HALFTONE.maxDots}(step ${step ?? HALFTONE.step})`);
  }
  return out;
}

/** ③ 触控下限:可点的行/键一律 ≥ TOUCH.min */
export function checkTouch(items: Array<[string, number]>): string[] {
  return items.filter(([nm, h]) => h < TOUCH.min).map(([nm, h]) => `${nm}:高 ${h} < 触控下限 ${TOUCH.min}`);
}

/** ④ 文案闸:emoji 码段与桌面键名。原生无彩色 emoji 字体,手机上桌面键名是无效指令 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FA}\u{25A0}-\u{25FF}\u{2600}-\u{2604}\u{260E}\u{2614}\u{2615}\u{261D}\u{2620}\u{2622}\u{2623}\u{2626}\u{262A}\u{262E}\u{262F}\u{2638}-\u{263A}\u{2640}\u{2642}\u{2648}-\u{2653}\u{2660}\u{2663}\u{2665}\u{2666}\u{2668}\u{267B}\u{267F}\u{2692}-\u{2697}\u{2699}\u{26A0}\u{26A1}\u{26AA}\u{26AB}\u{26C2}-\u{26C4}\u{26C8}\u{26CE}-\u{26D4}\u{26EA}\u{26F0}-\u{26F5}\u{26F7}-\u{26FA}\u{26FD}\u{FE0F}]/u;
/**
 * ★ ☆ **不**列进制止:用户真机截图里「★ 6 / 60 · 已通关 2/20」是正常渲染的 ——
 * 它们是 BMP 文本字形(U+2605/2606),不属于 Unicode 的 Emoji_Presentation,
 * MiSans 子集里有。卡片内部的星级我们**主动**换成 drawStarGlyph(与四尖星语言一致),
 * 但那是风格升级,不是 bug 修复,所以这里不设为硬闸 —— 闸只管「真机上会画不出来」的东西。
 */
const DESKTOP_KEYS = /\[[\s]*[A-Za-z]\s*\/|左键|右键|鼠标|键盘|\bEnter\b|\bEsc\b|\bSpace\b/;

export function checkCopy(src: string, fileLabel: string): string[] {
  const out: string[] = [];
  // 只扫字符串字面量:注释里写「旧写法是 🔒」是**说明**,不是要渲染的东西
  const strings = src.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  for (const s of strings) {
    if (EMOJI.test(s)) out.push(`${fileLabel}:文案含 emoji,原生无彩色 emoji 字体 → 换 Graphics 形状 + 纯文本 ${s}`);
    else if (DESKTOP_KEYS.test(s)) out.push(`${fileLabel}:文案含桌面键名/输入设备指令(界面文案只写触屏向) ${s}`);
  }
  return out;
}

/**
 * ⑨ 移动方式图示:这一格坏法全都不崩、不报错、tsc 也不红 ——
 *   · 取景比盒子高 → 起跳的顶点被上缘切掉(看着像"这人怎么只有一半")
 *   · 滑块与人物不同 x → 「手指在哪人就在哪」当场变谎言(这是滑轨档唯一的卖点)
 *   · knob 脱出底圈 → 摇杆画成了"一个球飞出去"
 *   · 没越过判定就离地 / 越过了却不跳 → 教的和判的是两件事(与 drill-demo 同一类老病)
 *   · 三档画出同一批多边形 → 切档没反应
 *   · 整循环人物没挪过位置、没跳过 → 一格静帧,比没有图示更糟
 *   · 一帧笔画失控 → 设置页也能耗 GPU
 * 判据吃的是 probe(数据),所以 --selftest 能喂一份"改坏的"进来 —— 否则这套尺子没牙齿。
 */
export interface DiagramProbe {
  /** 图示盒宽高(图示像素) */
  w: number; h: number;
  /** 内边距:画面比盒子小一圈 */
  pad: number;
  /** 取景折算成图示像素要多高 */
  needH: number;
  /** 循环帧数 */
  loop: number;
  /** 越过起跳判定那一帧 / 腾空帧数 */
  takeoff: number;
  airFrames: number;
  /** 可达区间(与 railGeo 同源)与摇杆底圈半径(设计像素) */
  minX: number; maxX: number; baseR: number;
  /** 整循环的逐帧状态与显示列表 */
  beats: (mode: MoveMode) => Beat[];
  frames: (mode: MoveMode) => Paint[][];
  /** 每帧笔画预算 */
  strokeCap: number;
}

const DIAG_MODES: MoveMode[] = ["joystick", "slider", "buttons"];

export function checkDiagram(p: DiagramProbe): string[] {
  const out: string[] = [];
  const push = (m: string): void => { if (!out.includes(m)) out.push(m); };
  // 盒子先要装得下这块取景:装不下被切掉的是"起跳"那一下,而它正是这一格要教的东西
  if (p.needH > p.h - p.pad * 2) {
    push(`取景高 ${p.needH.toFixed(1)} > 盒内高 ${(p.h - p.pad * 2).toFixed(1)} —— 起跳顶点会被盒子上缘切掉`);
  }
  const sigs = new Map<MoveMode, string>();
  for (const mode of DIAG_MODES) {
    const beats = p.beats(mode);
    const frames = p.frames(mode);
    if (beats.length !== p.loop || frames.length !== p.loop) {
      push(`${mode}:循环长度对不上(beats ${beats.length} / frames ${frames.length} / loop ${p.loop})`);
      continue;
    }
    let maxStroke = 0, moved = 0, maxHop = 0, cued = 0;
    const xs: number[] = [];
    for (let t = 0; t < p.loop; t++) {
      const b = beats[t];
      const dl = frames[t];
      maxStroke = Math.max(maxStroke, dl.length);
      xs.push(b.personX);
      maxHop = Math.max(maxHop, b.hop);
      if (b.jumpCue) cued++;
      // 人物只能站在够得着的地方(端点与真滑轨同源,越界就是图示在撒谎)
      if (b.personX < p.minX - 0.6 || b.personX > p.maxX + 0.6) push(`${mode} 第 ${t} 帧:人物站到可达区间外 x=${b.personX.toFixed(1)}`);
      // 滑轨的承诺:滑块与人物的 x 必须**恒等**,不是"差不多"
      if (mode === "slider" && Math.abs(b.thumbX - b.personX) > 1e-6) {
        push(`${mode} 第 ${t} 帧:滑块 x=${b.thumbX.toFixed(1)} ≠ 人物 x=${b.personX.toFixed(1)},「手指在哪人就在哪」破了`);
      }
      // 摇杆:knob 不许脱出底圈(脱出去画就成了"一个球飞走")
      if (mode === "joystick" && Math.hypot(b.knobX, b.knobY) > p.baseR + 0.5) {
        push(`${mode} 第 ${t} 帧:knob 离底圈心 ${Math.hypot(b.knobX, b.knobY).toFixed(1)} > 半径 ${p.baseR}`);
      }
      // 起跳:越过判定与真的离地必须是同一件事
      const inWindow = t >= p.takeoff && t <= p.takeoff + p.airFrames;
      if (b.jumpCue !== inWindow) push(`${mode} 第 ${t} 帧:起跳判定 ${b.jumpCue} 与腾空窗 ${inWindow} 不同源`);
      if (b.hop > 0.5 && !inWindow) push(`${mode} 第 ${t} 帧:还没越过判定就已经离地 ${b.hop.toFixed(1)}`);
      if (inWindow && t > p.takeoff + 2 && t < p.takeoff + p.airFrames - 2 && b.hop <= 0.5) {
        push(`${mode} 第 ${t} 帧:越过了判定却没有离地(按了不跳 = 用户下一句就是「没反应」)`);
      }
      // 坐标健康 + 不许画出盒子(NaN 不崩,只会让那一笔消失或整块 Graphics 不上屏)
      for (const pt of dl) {
        const pts: Array<[number, number]> = pt.kind === "dot" ? [[pt.cx, pt.cy]] : pt.pts;
        for (const [x, y] of pts) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) push(`${mode} 第 ${t} 帧:坐标 NaN/Infinity`);
          else if (Math.abs(x) > p.w / 2 + 0.6 || Math.abs(y) > p.h / 2 + 0.6) {
            push(`${mode} 第 ${t} 帧:笔画出框 (${x.toFixed(1)}, ${y.toFixed(1)}) 盒 ${p.w}×${p.h}`);
          }
        }
        if (pt.kind !== "dot" && (pt.a < 0 || pt.a > 1)) push(`${mode} 第 ${t} 帧:alpha ${pt.a} 越界`);
      }
    }
    if (maxStroke > p.strokeCap) push(`${mode}:一帧最多 ${maxStroke} 笔 > 预算 ${p.strokeCap}`);
    moved = Math.max(...xs) - Math.min(...xs);
    if (moved < 120) push(`${mode}:整循环人物只挪了 ${moved.toFixed(0)} 设计像素 —— 这一格等于没在演示走位`);
    if (maxHop < 40) push(`${mode}:整循环最高只离地 ${maxHop.toFixed(0)} —— 起跳那一下没演出来`);
    if (cued < 10) push(`${mode}:起跳判定只亮了 ${cued} 帧,肉眼扫不到`);
    // 循环接缝:首尾都在中场,不然每 5 秒"瞬移"一次
    if (Math.abs(beats[0].personX - beats[p.loop - 1].personX) > 8) {
      push(`${mode}:循环接缝处人物从 ${beats[p.loop - 1].personX.toFixed(0)} 瞬移到 ${beats[0].personX.toFixed(0)}`);
    }
    sigs.set(mode, frames.map((f) => f.length).join(","));
  }
  // 三档必须画的是三件东西:整循环的笔画指纹两两不同
  const list = [...sigs.entries()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i][1] === list[j][1]) push(`图示分档失效:${list[i][0]} 与 ${list[j][0]} 整循环笔画指纹完全相同`);
    }
  }
  return out;
}

/** ⑩ 从图示模块取一份真实探针(正题照它测,反例在它上面动一个字段) */
function diagramProbe(over: Partial<DiagramProbe> = {}): DiagramProbe {
  const D = controlLayout().diagram;
  const w = D.right - D.left, h = D.h;
  const cache = new Map<MoveMode, { beats: Beat[]; frames: Paint[][] }>();
  const R = railGeo();
  const get = (mode: MoveMode): { beats: Beat[]; frames: Paint[][] } => {
    let c = cache.get(mode);
    if (!c) {
      c = {
        beats: Array.from({ length: DIAG.loop }, (_, t) => beatOf(mode, t)),
        frames: Array.from({ length: DIAG.loop }, (_, t) => padDiagramDL(mode, t, w, h)),
      };
      cache.set(mode, c);
    }
    return c;
  };
  return {
    w, h, pad: DIAG.pad, needH: cropHeightPx(w, h), loop: DIAG.loop,
    takeoff: SEG.prep1, airFrames: AIR_FRAMES,
    minX: R.minX, maxX: R.maxX, baseR: JOYSTICK_BASE.r,
    beats: (m) => get(m).beats, frames: (m) => get(m).frames,
    strokeCap: 90,
    ...over,
  };
}

/**
 * ⑪ 二次确认弹窗的「接线完整性」:上面的版式判据只证明这张弹窗自己没排坏,
 * 证明不了两颗「重置默认」都走了它。而漏接的那颗**不崩、不报错、出图里也看不出来**
 * —— 只有真机上误触一次才发现(用户 2026-10-05 报的正是这一颗)。所以扫源码:
 *   a) 面板必须引用那份文案(两处同名键问同一句话,不许各抄一份);
 *   b) askResetPad 至少三处(定义 + 两颗键各一处接线);
 *   c) Settings.resetPad() 只许一处调用点(全走 doResetPad)——
 *      多出来的那一处就是绕过确认的第三条路。
 */
export function checkConfirmWiring(raw: string, fileLabel: string): string[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  const n = (re: RegExp): number => (src.match(re) ?? []).length;
  if (!n(/CONFIRM_PAD_RESET/g)) out.push(`${fileLabel}:没引用 CONFIRM_PAD_RESET —— 确认文案被抄回面板里了,两处同名键会各问一套`);
  const wired = n(/askResetPad\b/g);
  if (wired < 3) out.push(`${fileLabel}:askResetPad 只出现 ${wired} 处(要 定义 + 两颗「重置默认」各一处)—— 有那颗没接确认`);
  const direct = n(/Settings\.resetPad\(\)/g);
  if (direct !== 1) out.push(`${fileLabel}:Settings.resetPad() 有 ${direct} 处调用点(只许 1 处,在 doResetPad 里)—— 多出来的那条绕过了确认弹窗`);
  return out;
}

/**
 * ⑫ 双技能闸的「接线完整性」(2026-10-06 用户指令:两槽配齐才许开赛):
 * 三处开赛口(对练 / 无限练习 / 闯关,即 doStartMatch / doStartEndlessMatch /
 * doStartCampaign)都要过 requireSkillsReady,且弹窗文案必须引用 confirm-layout 的
 * CONFIRM_SKILLS_REQUIRED(不许把那句话抄回 ui-manager —— 闸门提示与判据各说一套,
 * panel-check 量的就不再是面板真摆出去的字)。漏接闸的坏法**不崩、不报错、出图看不见**
 * —— 槽2空着照样开局,只有想起技能2为什么按不出来时才回头翻配置。
 */
export function checkSkillsGateWiring(raw: string, fileLabel: string): string[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  if (!/CONFIRM_SKILLS_REQUIRED/.test(src)) {
    out.push(`${fileLabel}:没引用 CONFIRM_SKILLS_REQUIRED —— 弹窗文案被抄回开赛口里了`);
  }
  const gates = (src.match(/requireSkillsReady\(/g) ?? []).length;
  if (gates < 4) out.push(`${fileLabel}:requireSkillsReady 只出现 ${gates} 处(要 定义 + 对练/无限/闯关三处开赛口各一处)—— 有开赛口没接双技能闸`);
  return out;
}

/**
 * ⑬ 货架的「让位与文案」接线(2026-10-07 用户现场图:形象页子页签那两行下面全是别人的
 * 商品名与价格,卡片底部那行卖点五张卡连成一句读不通的话)。两处都是**不崩、不报错、
 * 静止出图也看不出来**的坏:
 *   a) 可视窗高必须读 _curShelf —— 写死 CONTENT_H 就是那扇 330 的整窗,
 *      卡片一滚就穿到钉住的 chip 背后(chip 是半透明凹陷槽,挡不住);
 *   b) 卡上三行字必须过 cardLine / cardFxLines —— 直接摆 s.name / fx 原文,
 *      Label 那个 w 参数拦不住任何东西(Overflow.NONE 只挪锚点不裁字)。
 */
export function checkShelfWiring(raw: string, fileLabel: string): string[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  if (/mkNode\(\s*"gridView"[\s\S]{0,60}CONTENT_H\s*\)/.test(src)) {
    out.push(`${fileLabel}:可视窗高写死 CONTENT_H —— 形象页的子页签带没让出来,卡片会滚到 chip 背后`);
  }
  if (!/const vpH = this\._curShelf\.h/.test(src)) {
    out.push(`${fileLabel}:可视窗没读 _curShelf.h —— 让位算术与货架几何(_curShelf)分成了两套`);
  }
  if (/mkLabel\(card, "name", s\.name/.test(src) || /mkLabel\(card, "status", statusText/.test(src)) {
    out.push(`${fileLabel}:卡片名称/状态直接摆原文 —— 没走 cardLine,长一句就画到邻卡上`);
  }
  if (!/cardFxLines\(fxTag\(s\)\)/.test(src)) {
    out.push(`${fileLabel}:卖点没走 cardFxLines(折行 + 截尾)—— 一行摆不下时它会横着溢出卡片`);
  }
  return out;
}

/** 面板 fxTag() 里**硬编码**那几条卖点(脸面/球拍/羽毛球的分支)。
 *  从源码现取,判据里不抄第二份 —— 那边加一句新的,这里自动跟着量。 */
function fxTagLiterals(raw: string): string[] {
  const i = raw.indexOf("function fxTag(");
  if (i < 0) return [];
  const body = raw.slice(i, raw.indexOf("\n}", i));
  return [...new Set([...body.matchAll(/return "([^"]{4,})"/g)].map((m) => m[1]))];
}

/** 货架上可能出现的每一张卡的三行字:商品名与卖点现读 config / 面板源码,
 *  状态行按**最坏那句**喂(金币四位数、Lv.12 解锁、补齐 金币 888)——
 *  它是运行期按存档算的,判据不该赌「这个存档的数还小」。 */
function shelfCardRows(): Array<{ tag: string; name: string; status: string; fx: string }> {
  const src = readFileSync(join(UI, "career-panel.ts"), "utf8");
  const rows: Array<{ tag: string; name: string; status: string; fx: string }> = [];
  for (const a of CFG.accessories) {
    rows.push({ tag: `穿戴件「${a.name}」`, name: a.name, status: `金币 ${a.price}`, fx: a.desc });
  }
  for (const fam of Object.values(CFG.families)) {
    rows.push({ tag: `族卡「${fam.name}」`, name: fam.name, status: `买断 ${fam.price}`, fx: fam.tag });
  }
  for (const s of CFG.skins.player) {
    if (!s.parts) continue;
    const pr = Career.setPrice(s.id);
    const save = pr.total - s.price;
    rows.push({
      tag: `套装卡「${s.name}」`, name: s.name, status: `补齐 ${pr.charge}`,
      fx: save > 0 ? `${pr.n} 件单品 · 整套省 ${save} 金币` : `${pr.n} 件单品 · 一次穿齐`,
    });
  }
  for (const list of Object.values(CFG.skins)) {
    for (const s of list) {
      rows.push({ tag: `皮肤「${s.name}」`, name: s.name, status: "Lv.12 解锁", fx: "" });
    }
  }
  for (const t of fxTagLiterals(src)) rows.push({ tag: `卖点「${t}」`, name: "深海蓝", status: "金币 88", fx: t });
  return rows;
}

// ============================================================
// 真实数据
// ============================================================
/**
 * 履历页的摆拍存档:只喂 statCells 会读的那几个键。
 * 版式与文案都取自 shop-shelf 的真函数,所以这里红 = 面板上也会红(不是预览另算一份)。
 */
function mockProfile(
  stats: Partial<Profile["stats"]> = {}, endless = 0,
): Profile {
  return {
    level: 4, exp: 77, coins: 1760, bestEndlessScore: endless,
    drills: { a: { stars: 3, clears: 1, bestQ: 0, bestReps: 0, attempts: 1 }, b: { stars: 2, clears: 1, bestQ: 0, bestReps: 0, attempts: 1 } },
    stats: { matches: 22, wins: 15, smashes: 662, sweets: 1173, perfects: 952, hits: 4982, maxRally: 46, ...stats },
  } as unknown as Profile;
}

/** 角色表:每个角色的面上字色由 inkFor 算,这里核它过不过线 */
function rolePairs(): Array<[string, string, string]> {
  return [
    ...Object.entries(ROLE).map(([k, r]) => [`ROLE.${k}`, r.face, inkFor(r.face)] as [string, string, string]),
    ...Object.entries(RARITY_META).map(([k, r]) => [`RARITY.${k}`, r.color, inkFor(r.color)] as [string, string, string]),
    // 暗面上的正文(未选中 tab / 锁定卡)
    ["未选中态正文", C.navy2, C.dim],
    ["锁定态正文", C.navy, C.dimDeep],
    ["衬纸上的正文", C.ink, C.paper],
    // 商店底部提示带:面色与字色成对来自 shop-shelf.TOAST(旧字色 = COL.gold = 同一支
    // C.acid,1.00:1,真机上整条提示是一个纯黄块 —— 用户截图里「都看不清」)
    [`商店提示带(${TOAST.face})`, TOAST.face, TOAST_FG],
  ];
}

/** 四块面板的网点层尺寸(标题带,不是整块衬底 —— 那是第一版的错) */
function halftoneSpecs(): Array<[string, number, number, number?]> {
  return [
    ["设置页标题带", SET.pw - 24, 76],
    ["闯关大厅标题带", 880 - 24, 76],
    ["训练场标题带", 880 - 24, 76],
    ["商店标题带", 880 - 24, 76],
  ];
}

function touchItems(): Array<[string, number]> {
  const K = controlLayout(), M = mediaLayout(), S = assistLayout(), A = aboutLayout();
  return [
    ["tab", SET.tab.h],
    ...K.modes.map((b, i) => [`移动方式第 ${i} 档`, b.h] as [string, number]),
    ...K.actions.map((b, i) => [`操控动作键#${i}`, b.h] as [string, number]),
    ...K.tiers.map((t, i) => [`手感滑杆第 ${i} 行`, t.slider.h] as [string, number]),
    ["辅助页开关", S.toggle.h],
    ...M.toggles.map((r, i) => [`开关第 ${i} 行(${r.label})`, r.toggle.h] as [string, number]),
    ...M.hints.map((b, i) => [`右列开关#${i}`, b.h] as [string, number]),
    ["关于·检查更新按钮", A.checkBtn.h],
    ["关于·更新记录按钮", A.logBtn.h],
    ["关于·浏览器下载按钮", A.siteBtn.h],
  ];
}

/**
 * ④b 数据驱动的文案闸:训练场关卡表里的**每一句人话**。
 *
 * 为什么单独一条:`copyTargets()` 扫的是 `assets/scripts/ui/` 下的**源码字面量**,
 * 而训练场的文案住在 core/config.ts 的 DRILLS 表里(口诀 / 要领 / 分步四句 / 落点区名)——
 * 引导页改版把「分步讲解」也写进了那张表,于是这一屏最要紧的一批文字**一个字都不过闸**。
 * emoji 与桌面键名在真机上是方框和无效指令,这条不该取决于文案写在哪个文件里。
 */
export function checkDrillCopy(drills: readonly DrillDef[]): string[] {
  const out: string[] = [];
  const scan = (where: string, text: string | undefined): void => {
    if (!text) return;
    if (EMOJI.test(text)) out.push(`${where}:文案含 emoji,原生无彩色 emoji 字体 → 换 Graphics 形状 + 纯文本 ${text}`);
    else if (DESKTOP_KEYS.test(text)) out.push(`${where}:文案含桌面键名/输入设备指令(界面文案只写触屏向) ${text}`);
  };
  for (const d of drills) {
    scan(`${d.id}.label`, d.label);
    scan(`${d.id}.desc`, d.desc);
    scan(`${d.id}.cue`, d.cue);
    scan(`${d.id}.zoneName`, d.zoneName);
    d.points.forEach((t, i) => scan(`${d.id}.points[${i}]`, t));
    d.demoSteps?.forEach((st, i) => {
      scan(`${d.id}.demoSteps[${i}].name`, st.name);
      scan(`${d.id}.demoSteps[${i}].desc`, st.desc);
      scan(`${d.id}.demoSteps[${i}].note`, st.note);
    });
    if (!d.demoSteps || d.demoSteps.some((st) => !st.desc)) out.push(`${d.id}:分步讲解缺句子,定格到那一步会是一片空白`);
  }
  return out;
}

/** 参与文案闸的文件:四个面板 + 它们的版式模块(存在才扫,分阶段落地时不至于红) */
function copyTargets(): string[] {
  const want = [
    "settings-panel.ts", "settings-layout.ts",
    "campaign-panel.ts", "campaign-layout.ts",
    "drill-panel.ts", "drill-layout.ts",
    "career-panel.ts",
    "widgets.ts", "ui-shell.ts", "p5-shapes.ts", "p5-tokens.ts", "pad-diagram.ts",
    "confirm-layout.ts", "confirm-dialog.ts",
  ];
  const have = new Set(readdirSync(UI));
  return want.filter((f) => have.has(f));
}

// ============================================================
// 反例(--selftest):全部是**改动前的真实写法**,必须被同一判据拦下
// ============================================================

if (selftest) {
  const cases: Array<[string, string[]]> = [
    // 商店旧 tab:navy2 底上只有白 5% 描边,字用 dim —— 与背景几乎同亮度
    ["旧商店 tab(navy2 底 + dim 字,实测 1.1:1 那一类)",
      checkContrast([["旧 tab", C.navy2, "#4a5578"]])],
    // 网点铺满整块衬底 + 默认 step 16:1566 点 > 900。
    // (第一版实测 step 24 铺满是 720 点、**不**超线 —— 那个反例是假的,已换成真会超线的那个。
    //  这条钉的是「覆盖范围别从标题带退回整块衬底」,退回就会撞上这个数。)
    ["网点铺满整块衬底(默认 step 16)",
      checkHalftone([["整块衬底", 880 - 24, 456]])],
    // 开关行高 40:低于拇指点准下限
    ["旧开关/滑杆行高 40(< 44)", checkTouch([["旧开关", 40], ["旧滑杆触摸区", 34]])],
    // 闯关卡里那串 emoji 与星级文本
    ["旧闯关卡文案(🔒 待解锁 / ★★★)", checkCopy('const a = "🔒 待解锁"; const b = "★★★";', "campaign")],
    // 训练场那行桌面键名
    ["旧训练场键提示([K / 左键] 与 ⏸)", checkCopy('const c = "[K / 左键]"; const d = "⏸";', "drill")],
    // 同一句桌面键名**写在关卡表里**:文件扫描够不着(copyTargets 只扫 ui/),这条必须仍被拦下
    ["旧训练场键提示写进 DRILLS.cue", checkDrillCopy([{ ...DRILLS[0], cue: "起跳后按 [K / 左键]" }])],
    // 分步讲解缺句:定格到那一步就是一片空白(旧版根本没有逐关文案)
    ["DRILLS 缺 demoSteps", checkDrillCopy([{ ...DRILLS[1], demoSteps: undefined }])],
    // 商店旧 toast:底块 ROLE.star.face(#ffe14d)+ 字 COL.gold(同一支 C.acid)——
    // 同色相叠 1.00:1,不崩不报错,只是那条提示在真机上是一个没有字的黄块
    ["旧商店 toast(荧光黄面 + 荧光黄字,实测 1.00:1)",
      checkContrast([["旧 toast", ROLE.star.face, C.acid]])],
    // 商店旧 toast 的落位:挂 root 手拍 -PH/2+20 → 面板局部 -205、高 36,
    // 顶边 -187 压进货架窗(窗底 -208)21px,盖掉末行下半截
    ["旧商店 toast 落位(压货架末行 21px)", toastLane(-205, 36)],
    // 设置页旧 tab 栏:整组居中 + 写死 176 宽。两页时最右格右缘 182 刚好擦过「完成」左缘 207,
    // 加第三页(关于)就排到 276 —— 用户截图里「完成」缺了个角。判据必须认得这一撞。
    ["旧设置 tab 栏(居中 176 宽 × 3 格 撞右上角「完成」)", (() => {
      const d = doneBox(), w = 176, total = 3 * w + 2 * 12;
      return [0, 1, 2]
        .map((i) => box(-total / 2 + i * (w + 12), w, SET.tab.y, SET.tab.h))
        .filter((c) => boxesOverlap(c, d))
        .map((c) => `tab 右缘 ${c.right} 压进完成左缘 ${d.left}`);
    })()],
    // 「自动击打」开关硬塞进操控页:那一页竖排零余量 —— 手感第二行 -176、行高 44 ⇒ 底 -198,
    // 红线 -201。第三行要落在 -226(底 -248),当场溢出 47px。这就是它另起一页的原因,
    // 把这笔账冻成反例,免得下一个人又去操控页里挤一行。
    ["把第 3 行手感/辅助硬塞进操控页(y=-226)", [
      boxOverflow(box(-201, 300, -226, SET.rowH)) ?? "",
    ].filter(Boolean)],
    // 辅助页三行说明用 Label.Overflow.CLAMP 摆:格子没出内容区,但字从中间静默截掉 ——
    // 读的人只会看到半句话。判据量的是字宽,不是格子。
    ["辅助页说明行超长(CLAMP 静默截字)", assistTextOverflow([
      ["生效行", "生效:对练 · 闯关 · 无限练习 · 训练场与新手教学不代打 · 本地双打与网络对战同样不代打 · 训练与教学也不代打"],
    ])],
    // ---------- 移动方式图示的七份反例 ----------
    // 这一格的坏法全都不崩不报错(画歪、画成静帧、把承诺画成谎话),所以判据必须有牙齿。
    // 探针只建一次(300 帧 × 3 档的显示列表),反例在它上面各动一个字段。
    ...(() => {
      const P = diagramProbe();
      /** 在真实探针上改一个维度:beats/frames 各取一份包装 */
      const withBeats = (fix: (m: MoveMode, b: Beat) => Beat): DiagramProbe => ({
        ...P, beats: (m) => P.beats(m).map((b) => fix(m, b)),
      });
      const withFrames = (fix: (m: MoveMode, dl: Paint[], t: number) => Paint[]): DiagramProbe => ({
        ...P, frames: (m) => P.frames(m).map((dl, t) => fix(m, dl, t)),
      });
      return [
        // 盒子矮 40px:被上缘切掉的正好是「起跳」那一下 —— 这一格最该被看懂的一笔
        ["图示盒太矮(装不下一次满跳)", checkDiagram({ ...P, h: 116 })],
        // 滑轨的滑块按 0.9 缩:「手指在哪人就在哪」当场成为谎话(演示与判据不同源)
        ["滑轨滑块与人物脱钩(0.9 倍)", checkDiagram(withBeats((m, b) =>
          m === "slider" ? { ...b, thumbX: b.personX * 0.9 } : b))],
        // 摇杆的 knob 推到圈外:画出来是"一个球飞走了"
        ["摇杆 knob 脱出底圈", checkDiagram(withBeats((m, b) =>
          m === "joystick" ? { ...b, knobX: b.knobX * 1.7, knobY: b.knobY * 1.7 } : b))],
        // 离地比判定早 10 帧:教的是一回事、判的是另一回事(与 drill-demo 那次的假弹道同病)
        ["提前离地(还没越过判定就跳了)", checkDiagram({
          ...P,
          beats: (m) => { const a = P.beats(m); return a.map((b, i) => ({ ...b, hop: a[(i + 10) % a.length].hop })); },
        })],
        // 三档画出同一批多边形:切档没反应(用户下一句就是「点了没用」)
        ["三档画成同一件东西", checkDiagram({ ...P, frames: () => P.frames("slider") })],
        // 整循环人物不动 + 不离地:一格静帧,比没有图示更糟
        ["图示成了静帧(人物不挪不离地)", checkDiagram({
          ...P,
          beats: (m) => P.beats(m).map((b) => ({ ...b, personX: 257, thumbX: 257, hop: 0 })),
        })],
        // 一笔出框 / 一个 NaN:不崩,只是那一笔消失或整块画布不上屏
        ["笔画出框 + NaN 坐标", checkDiagram(withFrames((m, dl, t) =>
          t === 5 ? [...dl, { kind: "fill", hex: "#ffffff", a: 1, pts: [[400, 0]] },
            { kind: "fill", hex: "#ffffff", a: 1, pts: [[Number.NaN, 3]] }] : dl))],
      ] as Array<[string, string[]]>;
    })(),
    // ---------- 确认弹窗的三份反例 ----------
    // 这张弹窗的坏法同样不崩不报错:卡高一写死,文案长一点就压字;按钮文案长一点就出卡;
    // 而「漏接确认」连界面都不会变 —— 只有真机误触那一次才知道。
    ...(() => {
      const base = layoutConfirm(CONFIRM_PAD_RESET);
      const grown = layoutConfirm({
        ...CONFIRM_PAD_RESET,
        body: "你摆过的按键位置、大小与透明度会被出厂值全部覆盖。\n撤销不了,只能一颗一颗重新摆。\n移动方式与手感档位都不受影响,这一句只为了把话说完。",
      });
      return [
        // 旧式弹窗的排法:卡高是个常量。四行正文按短文案的框摆 → 标题探上内边距 + 正文压进按钮行
        ["确认弹窗卡高写死(正文长到四行)", confirmOverflow({ ...grown, cardH: base.cardH })],
        // 兑现那颗被写成一句话:两键总宽越过可用宽,右半颗直接探出卡框
        ["确认按钮文案长到一排放不下", confirmOverflow(layoutConfirm({
          ...CONFIRM_PAD_RESET, action: "立刻把全部按键恢复成出厂位置",
        }))],
        // 有人图省事,在别的入口上直接覆盖存档
        ["绕过确认直接 resetPad", checkConfirmWiring(
          `Settings.resetPad();\nSettings.resetPad();\nreset.on(CLICK, () => Settings.resetPad());`, "sample-bad")],
        // 双技能闸(2026-10-06):新开赛口忘了接闸(闸与文案全缺),或接了闸却把弹窗文案抄回开赛口
        ["新开赛口不接双技能闸", checkSkillsGateWiring(
          `function doStartX() { slashWipe(this.node, () => {}); }`, "sample-bad")],
        ["双技能闸弹窗文案抄回开赛口", checkSkillsGateWiring(
          `function requireSkillsReady(run) { run(); }\nrequireSkillsReady(a);\nrequireSkillsReady(b);\nrequireSkillsReady(c);`, "sample-bad")],
      ] as Array<[string, string[]]>;
    })(),
    // ---------- 履历格的反例 ----------
    // 版式判据吃的是 statCells 的真文案,所以「格子压矮 / 名字写长」这两条会在同一把尺上红。
    ["履历格压回 100 高还留 40 号大数(大数顶到色签行)",
      statCardFits(statCells(mockProfile(), 18), SHOP.stats.cw, 100)],
    ["指标名写成一句话,引导线被吃光",
      statCardFits([{ name: "生涯累计完美击球占比统计·全平台同步", key: "perfects", num: "1", unit: "", sub: "", role: "star" }])],
    ["大数涨到十一位(七位击球数再翻两档)",
      statCardFits([{ name: "甜区命中", key: "sweets", num: "12345678901", unit: "", sub: "", role: "drill" }])],
    // ---------- 货架卡与子页签带的反例(2026-10-07 现场图那两处) ----------
    // 让位做成抬 padTop:静止时确实不压 chip,一滚就穿 —— 所以判据量的是**窗**,不是静止坐标
    ["子页签带只抬 padTop、可视窗仍是整扇 330(卡片滚起来穿过 chip)",
      accSlotOverlaps(shopContent(SHELF.h).grid, accSlotRowCounts(CFG.accSlots.map((s) => s.row)),
        { ...SHELF, padTop: SHELF.padTop + accBandH(2) })],
    // 面板绕过排版:窗口尺寸写死常量 + 卡片直接摆原文(这两条都不崩、出图也看不出来)
    ["货架接线退回旧写法(窗写死 CONTENT_H + 名称/卖点摆原文)", checkShelfWiring(
      `const vp = mkNode("gridView", this._gridNode, GRID_W, CONTENT_H);\n`
      + `mkLabel(card, "name", s.name, 12, c, { y: -8 });\nif (fx) mkLabel(card, "fx", fx, 9, c, { y: -47 });`,
      "sample-bad")],
    ["卖点写成 30 字长话(卡里排到第三行,只能靠截尾砍掉)",
      cardTextFits([{ tag: "上衣「纯白衫」", name: "纯白衫", status: "金币 88",
        fx: "纯黑衫的镜像 · 暗球馆里最亮的一件 · 穿上之后全场都看得见你" }])],
    ["商品名写到七个字(12 号字排不进 96 宽的卡)",
      cardTextFits([{ tag: "面饰「疾风限量款墨镜」", name: "疾风限量款墨镜", status: "金币 268", fx: "" }])],
  ];
  for (const [nm, msgs] of cases) {
    ok(msgs.length > 0, `反例 ${nm}:应被拦下,实得 ${msgs.length} 条${msgs.length ? ` —— ${msgs[0]}` : ""}`);
  }
  ok(assistTextOverflow(assistCopyLines()).length === 0, "正例:辅助页三行说明都在自己那格里,不被 CLAMP 截");
  // 反向:正确写法不该被咬
  ok(checkCopy('const e = "继续闯关 · 第 3 关「烈日刺目」"; const f = "开";', "good").length === 0,
    "正例:纯中文文案不被文案闸误咬");
  ok(cardTextFits(shelfCardRows()).length === 0, "正例:现役货架卡的名称/状态/卖点整句装得下,判据不误咬现文案");
  ok(accSlotOverlaps(shopContent(SHELF.h).grid, accSlotRowCounts(CFG.accSlots.map((s) => s.row))).length === 0,
    "正例:两行子页签带整段落在裁切窗之外");
  ok(checkContrast([["primary", ROLE.primary.face, inkFor(ROLE.primary.face)]]).length === 0,
    "正例:斩劈红 + 纸白(4.18:1)过 4.0 线");
  const baseC = layoutConfirm(CONFIRM_PAD_RESET);
  ok(confirmOverflow(baseC).length === 0 && confirmOverlaps(baseC).length === 0,
    "正例:确认弹窗真文案既不溢出也不压字(判据不咬人)");
  const baseS = layoutConfirm(CONFIRM_SKILLS_REQUIRED);
  ok(confirmOverflow(baseS).length === 0 && confirmOverlaps(baseS).length === 0,
    "正例:双技能闸真文案既不溢出也不压字(判据不咬人)");
  ok(checkConfirmWiring(readFileSync(join(UI, "settings-panel.ts"), "utf8"), "settings-panel").length === 0,
    "正例:真面板的接线过「两处都问」这道闸");
  ok(checkSkillsGateWiring(readFileSync(join(UI, "ui-manager.ts"), "utf8"), "ui-manager").length === 0,
    "正例:对练/无限/闯关三处开赛口都接了双技能闸,弹窗文案走 confirm-layout");
  process.exit(bad ? 1 : 0);
}

// ============================================================
// 正题
// ============================================================

const c1 = checkContrast(rolePairs());
for (const m of c1) ok(false, `对比度 ${m}`);
ok(c1.length === 0, `面色与字色对比全部 ≥ ${CONTRAST_FLOOR}(${Object.keys(ROLE).length + Object.keys(RARITY_META).length} 个角色/稀有度面 + 3 组暗面正文 + 1 条商店提示带)`);

// 商店底部提示带:必须待在「面板下缘 ↔ 货架窗底」那一条车道里。
// 旧写法挂在 root 上手拍 -PH/2+20(= 面板局部 -205)、高 36 → 往上压进货架末行 21px,
// 把最后一格金币行盖掉一半;而它和底部提示行还各占一个 y,两条字叠在一起。
const tl = toastLane();
for (const m of tl) ok(false, `提示带 ${m}`);
ok(tl.length === 0, "商店提示带:整条在底部车道内,不压货架末行、不出面板下缘");

const c2 = checkHalftone(halftoneSpecs());
for (const m of c2) ok(false, `网点 ${m}`);
ok(c2.length === 0, `四块面板的网点层都在预算内(上限 ${HALFTONE.maxDots} 点/层)`);

const c3 = checkTouch(touchItems());
for (const m of c3) ok(false, `触控 ${m}`);
ok(c3.length === 0, `设置页所有可点行 ≥ 触控下限 ${TOUCH.min}`);

const K = controlLayout(), M = mediaLayout();
const ov = settingsOverlaps();
for (const m of ov) ok(false, `重叠 ${m}`);
ok(ov.length === 0, "设置页版式:左右子列、三选一、手感两行互不重叠");
const of = settingsOverflow();
for (const m of of) ok(false, `溢出 ${m}`);
ok(of.length === 0, "设置页版式:没有块越出内容区,开关标签容得下「震动反馈」,操控页左列没被图示挤出去");
ok(K.tiers[1].y < K.tiers[0].y && K.tiers[0].y - K.tiers[1].y >= SET.rowH,
  `手感两行行距 ${K.tiers[0].y - K.tiers[1].y} ≥ 行高 ${SET.rowH}(滑杆抬到 44 之后这条才成立)`);
ok(TOG_W - TOG_TAIL > 60, `开关可用标签宽 ${TOG_W - TOG_TAIL} 容得下四字标签`);

// ---------- 移动方式图示(操控页右半格,三档 × 整循环) ----------
{
  const dm = checkDiagram(diagramProbe());
  for (const m of dm) ok(false, `图示 ${m}`);
  ok(dm.length === 0, `移动方式图示:${DIAG_MODES.length} 档 × ${DIAG.loop} 帧 —— 取景装得下盒子、`
    + "滑轨滑块与人物同 x、摇杆 knob 不脱底圈、起跳与判定同一帧、笔画不出框也不 NaN、每帧在预算内");
  const D = controlLayout().diagram;
  ok(D.right <= SET.right + 0.5 && D.left > SET.colX + LEFT_W,
    `图示盒在内容区右半(${D.left}..${D.right}),与左列之间留 ${D.left - (SET.colX + LEFT_W)}px 的缝`);
}

// ---------- 四块面板各自的版式判据(判据与面板同源,由各自 layout 模块导出) ----------
type Boxes = () => string[];
const NO_TOUCH = (): Array<[string, number]> => [];
const panels: Array<[string, Boxes, Boxes, () => Array<[string, number]>]> = [
  ["闯关大厅", campaignOverlaps, campaignOverflow, NO_TOUCH],
  ["训练场", drillOverlaps, drillOverflow, drillTouch],
  ["商店", () => shopOverlaps(), () => shopOverflow(), () => shopTouch()],
];
for (const [nm, ov, of, touch] of panels) {
  const a = ov();
  for (const m of a) ok(false, `${nm} 重叠 ${m}`);
  ok(a.length === 0, `${nm} 版式:各块互不重叠`);
  const b = of();
  for (const m of b) ok(false, `${nm} 溢出 ${m}`);
  ok(b.length === 0, `${nm} 版式:没有块越出面板`);
  const c = touch().filter(([, h]) => h < TOUCH.min);
  for (const [k, h] of c) ok(false, `${nm} 触控 ${k} 高 ${h} < ${TOUCH.min}`);
  ok(c.length === 0, `${nm} 版式:可点件 ≥ 触控下限`);
}
// 衬纸会往右下外溢(副衬错位 +10/-8,下缘撕口再往下 7):核的是**整块还在屏幕内**,
// 不是还在面板尺寸内 —— 上一版本这里写 `pw + 12 <= 880`,拿 880 的面板去比 880 的面板,恒假。
const SCREEN_W = 960, SCREEN_H = 540;
for (const [nm, pw, ph] of [["闯关", CMP.pw, CMP.ph], ["训练场", DRILL.pw, DRILL.ph], ["商店", SHOP.pw, SHOP.ph]] as const) {
  ok(pw + 12 <= SCREEN_W, `${nm} 面板宽 ${pw} + 衬纸外溢 12 ≤ 屏宽 ${SCREEN_W}`);
  ok(ph + 20 <= SCREEN_H, `${nm} 面板高 ${ph} + 衬纸外溢 20 ≤ 屏高 ${SCREEN_H}`);
}

// ---------- 二次确认弹窗(「重置默认」那一句)----------
{
  const L = layoutConfirm(CONFIRM_PAD_RESET);
  const ofC = confirmOverflow(L), ovC = confirmOverlaps(L);
  for (const m of ofC) ok(false, `确认弹窗 ${m}`);
  for (const m of ovC) ok(false, `确认弹窗 ${m}`);
  ok(ofC.length === 0 && ovC.length === 0,
    `确认弹窗:「${CONFIRM_PAD_RESET.title}」的标题 / ${L.items[1].lines.length} 行正文 / 补充行 / 两颗键`
    + `互不压字、都不出卡(卡 ${L.cardW}×${L.cardH},高是跟着文案算出来的)`);
  ok(L.cardH <= CF.maxCardH, `卡高 ${L.cardH} ≤ 红线 ${CF.maxCardH} —— 超了该改用带滚动井的公告弹窗,不是把红线调高`);
  ok(L.cardH + 12 <= SCREEN_H, `确认弹窗 + 衬纸外溢仍在屏高 ${SCREEN_H} 内`);
  ok(L.buttons.every((b) => b.h >= TOUCH.min), `两颗键高 ${L.buttons[0].h} ≥ 触控下限 ${TOUCH.min}`);
  const sp = join(UI, "settings-panel.ts");
  const wire = existsSync(sp) ? checkConfirmWiring(readFileSync(sp, "utf8"), "settings-panel") : ["settings-panel.ts 找不到"];
  for (const m of wire) ok(false, `确认弹窗 ${m}`);
  ok(wire.length === 0, "两颗「重置默认」都走 askResetPad、覆盖存档只有一处出口(没有绕过确认的第三条路)");
}

// ---------- 履历页六格:版式判据与面板同源(statCells / statCardDL / statCardFits 全在 shop-shelf) ----------
{
  const cells = statCells(mockProfile(), 18);
  const f = statCardFits(cells);
  for (const m of f) ok(false, `履历格 ${m}`);
  ok(f.length === 0, `履历格六格:色签 + 引导线 + 大数 + 副行装进 ${SHOP.stats.cw}×${SHOP.stats.ch},三行不叠字`);
  // 六格六色:旧版 gold 用两次、cyan 用两次,「色是数据编码」当场失效(同色报两件不同的事)
  const faces = cells.map((c) => ROLE[c.role].face);
  ok(new Set(faces).size === faces.length, `履历格六格配色互不重复(${faces.join(" ")})—— 色即数据编码`);
  // 存档涨上去不能把版式撑破:五位数 + 最长指标名 + 最长副行
  const big = statCells(mockProfile({
    matches: 9999, wins: 9999, smashes: 123456, sweets: 123456, perfects: 123456, hits: 1234567, maxRally: 999,
  }, 999999), 18);
  const bf = statCardFits(big);
  for (const m of bf) ok(false, `履历格(满档数据)${m}`);
  ok(bf.length === 0, "履历格六格:七位击球数 + 五位数 + 满星副行仍然装得下");
  // 里程碑三态(2026-10-07):可领行 / 已领满缀是真视图喂出来的,同样要装得下。
  // 摆拍存档把每项都顶过第 3 档 → 六格全部可领;再喂全量已领 → 全部「已领满」。
  const claimP = mockProfile({}, 40);
  const claimCells = statCells(claimP, 18, milestoneViews(claimP.stats, 40, []));
  const cf = statCardFits(claimCells);
  for (const m of cf) ok(false, `履历格(可领态)${m}`);
  ok(cf.length === 0 && claimCells.every((c) => c.claim),
    "履历格里程碑:六格全可领,「点击领取 +N金币+N经验」金色行装得下、claim 都在");
  const doneP = mockProfile({}, 40);
  const doneCells = statCells(doneP, 18, milestoneViews(doneP.stats, 40, CFG.milestones.map((m) => m.id)));
  const df = statCardFits(doneCells);
  for (const m of df) ok(false, `履历格(已领满态)${m}`);
  ok(df.length === 0, "履历格里程碑:全领满后「已领满」缀不溢出");
}

// ---------- 货架卡上的三行字 + 钉住的子页签带(2026-10-07 用户现场图:「这里显示都溢出了」) ----------
{
  const rows = shelfCardRows();
  const f = cardTextFits(rows);
  for (const m of f) ok(false, `货架卡 ${m}`);
  ok(f.length === 0,
    `货架卡 ${rows.length} 张:名称 / 状态 / 卖点**整句**装进 ${SHELF.cardW}×${SHELF.cardH} 的卡`
    + `(卡内宽 ${cardInnerW()},卖点最多 ${CARD_TEXT.fxLines} 行)`);

  const grid = shopContent(SHELF.h).grid;
  const counts = accSlotRowCounts(CFG.accSlots.map((s) => s.row));
  const band = accBandH(counts.length);
  const ov = accSlotOverlaps(grid, counts);
  for (const m of ov) ok(false, `子页签带 ${m}`);
  ok(ov.length === 0,
    `子页签带 ${counts.join("+")} 行、整段高 ${band} 落在裁切窗**之外**(窗高 ${accShelf(counts.length).h} = 网格窗 ${SHELF.h} − 这条带)`
    + ` —— chip 是半透明凹陷槽,让位只能靠裁,靠静止坐标一滚就穿帮`);

  const wire = checkShelfWiring(readFileSync(join(UI, "career-panel.ts"), "utf8"), "career-panel");
  for (const m of wire) ok(false, `货架接线 ${m}`);
  ok(wire.length === 0, "可视窗读 _curShelf.h、卡上三行字都过 cardLine/cardFxLines(没有直接摆原文的第四条路)");
}

const c4: string[] = []; for (const f of copyTargets()) c4.push(...checkCopy(readFileSync(join(UI, f), "utf8"), f));
const c5 = checkDrillCopy(DRILLS);
for (const m of [...c4, ...c5]) ok(false, `文案 ${m}`);
ok(c4.length === 0, `文案闸:${copyTargets().length} 个文件的字符串字面量里没有 emoji、★/☆ 与桌面键名`);
ok(c5.length === 0, `文案闸:训练场关卡表 ${DRILLS.length} 关的分步/口诀/要领/区名同样过闸(这批字住在 config,源码扫描看不见)`);

console.log(bad
  ? `\n${bad} 处问题:P5 面板语法断言未通过。`
  : "\nP5 面板语法全部通过:对比度过线、网点在预算内、可点行够高、版式不撞、文案无 emoji、确认弹窗排得下且两处都问。");
process.exit(bad ? 1 : 0);
