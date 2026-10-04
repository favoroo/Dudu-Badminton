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
import { DRILLS, RARITY_META } from "../assets/scripts/core/config";
import type { DrillDef } from "../assets/scripts/core/types";
import { halftoneCount } from "../assets/scripts/ui/p5-shapes";
import { aboutLayout, box, boxesOverlap, doneBox, SET, TOG_W, TOG_TAIL, controlLayout, mediaLayout, settingsOverlaps, settingsOverflow } from "../assets/scripts/ui/settings-layout";
import { campaignOverflow, campaignOverlaps, CMP } from "../assets/scripts/ui/campaign-layout";
import { DRILL, drillOverflow, drillOverlaps, drillTouch } from "../assets/scripts/ui/drill-layout";
import { SHOP, shopOverflow, shopOverlaps, shopTouch, TOAST, TOAST_FG, toastLane } from "../assets/scripts/ui/shop-shelf";

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

// ============================================================
// 真实数据
// ============================================================

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
  const K = controlLayout(), M = mediaLayout(), A = aboutLayout();
  return [
    ["tab", SET.tab.h],
    ...K.modes.map((b, i) => [`移动方式第 ${i} 档`, b.h] as [string, number]),
    ...K.actions.map((b, i) => [`操控动作键#${i}`, b.h] as [string, number]),
    ...K.tiers.map((t, i) => [`手感滑杆第 ${i} 行`, t.slider.h] as [string, number]),
    ...M.toggles.map((r, i) => [`开关第 ${i} 行(${r.label})`, r.toggle.h] as [string, number]),
    ...M.hints.map((b, i) => [`右列开关#${i}`, b.h] as [string, number]),
    ["关于·检查更新按钮", A.checkBtn.h],
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
    "widgets.ts", "ui-shell.ts", "p5-shapes.ts", "p5-tokens.ts",
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
  ];
  for (const [nm, msgs] of cases) {
    ok(msgs.length > 0, `反例 ${nm}:应被拦下,实得 ${msgs.length} 条${msgs.length ? ` —— ${msgs[0]}` : ""}`);
  }
  // 反向:正确写法不该被咬
  ok(checkCopy('const e = "继续闯关 · 第 3 关「烈日刺目」"; const f = "开";', "good").length === 0,
    "正例:纯中文文案不被文案闸误咬");
  ok(checkContrast([["primary", ROLE.primary.face, inkFor(ROLE.primary.face)]]).length === 0,
    "正例:斩劈红 + 纸白(4.18:1)过 4.0 线");
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
ok(of.length === 0, "设置页版式:没有块越出内容区,开关标签容得下「震动反馈」");
ok(K.tiers[1].y < K.tiers[0].y && K.tiers[0].y - K.tiers[1].y >= SET.rowH,
  `手感两行行距 ${K.tiers[0].y - K.tiers[1].y} ≥ 行高 ${SET.rowH}(滑杆抬到 44 之后这条才成立)`);
ok(TOG_W - TOG_TAIL > 60, `开关可用标签宽 ${TOG_W - TOG_TAIL} 容得下四字标签`);

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

const c4: string[] = [];
for (const f of copyTargets()) c4.push(...checkCopy(readFileSync(join(UI, f), "utf8"), f));
const c5 = checkDrillCopy(DRILLS);
for (const m of [...c4, ...c5]) ok(false, `文案 ${m}`);
ok(c4.length === 0, `文案闸:${copyTargets().length} 个文件的字符串字面量里没有 emoji、★/☆ 与桌面键名`);
ok(c5.length === 0, `文案闸:训练场关卡表 ${DRILLS.length} 关的分步/口诀/要领/区名同样过闸(这批字住在 config,源码扫描看不见)`);

console.log(bad
  ? `\n${bad} 处问题:P5 面板语法断言未通过。`
  : "\nP5 面板语法全部通过:对比度过线、网点在预算内、可点行够高、版式不撞、文案无 emoji。");
process.exit(bad ? 1 : 0);
