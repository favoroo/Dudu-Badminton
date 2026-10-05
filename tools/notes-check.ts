// ============================================================
// 更新弹窗「更新说明」排版回归 —— 防的就是 v0.0.7 那次线上事故:
// Release 正文是 markdown,原样进 Label 后 `## Dudu Badminton v0.0.8`、`**SHA-256**`
// 连同 64 位哈希一起糊在标题和进度条上(用户截图:文字压过标题、压到进度条)。
//
// 现在排版分两半:release-notes.ts 算(纯函数),update-dialog 画(照单摆 Label)。
// 溢出只有两条出路 —— 卡片变高,或框封顶后开裁罩滚动 —— 两条都由这里的断言守住:
//   1) 横向:任何物理行宽 <= 折行可用宽(带悬挂缩进),这是"不溢出"的定义本身;
//   2) 纵向:内容高 == 逐行 h/lead 累加,且未滚动时首末行都落在框内边距里;
//   3) 语法噪音:## ** ` []() <> - 列表符、SHA-256、裸哈希,一个都不许出现在屏上;
//   4) 封顶:卡片最高 = NOTE_BOX.maxH + 卡头 99 + 卡尾 149,必须 < 设计高 540;
//   5) 开窗方向:滚动态打开必须落在**第一条**(顶部)—— 更新记录弹窗「一进来看到
//      最旧版本」的现场(2026-10-05)就是初始位把正负位移用反,这里逐字复刻摆放
//      循环把方向钉死。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/notes-check.js
//   node .tools-build/tools/notes-check.js --verbose   # 顺带打印文本态排版预览
// ============================================================
import { makeChecker } from "./harness";
import {
  buildNotes, fitNotesBox, inlineSpans, NOTE, NOTE_BOX, noteScrollRange, noteTextW, parseReleaseNotes,
} from "../assets/scripts/ui/release-notes";
import { textW } from "../assets/scripts/core/text-metrics";

/** update-dialog 的卡头/卡尾高度之和 —— 改那边要同步这里,否则 4 号断言会红 */
const CARD_STACK = 99 + 149;
/** 裁切窗内缩(update-dialog.VIEW_INSET) */
const VIEW_INSET = 5;

const h = makeChecker({ printPass: false });
const verbose = process.argv.includes("--verbose");

const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

/** 语法噪音:出现任何一条都算「把 markdown 原样糊到屏幕上」 */
const NOISE: Array<[RegExp, string]> = [
  [/(^|\s)#{1,6}\s/, "标题井号"],
  [/\*\*/, "加粗星号"],
  [/`/, "反引号"],
  [/\[[^\]]*\]\(/, "链接方括号"],
  [/<\/?[a-z][a-z0-9]*\s*\/?>/i, "HTML 标签"],
  [/^\s*[-*+]\s/, "列表符"],
  [/sha[\s-]*256/i, "SHA-256 行"],
  [/[0-9a-f]{32,}/i, "裸哈希"],
];

const V008 = `## Dudu Badminton v0.0.8

### 新增功能
- 无限练习模式：选难度后一直打，专注练手感
- 按拍预告改到羽毛球本体发光，更好抓时机

### 修复问题
- 修复发球持球姿势，球稳握后手不再悬空
- 优化 AI 接发球，简单球不再频繁漏接
- 重构即时回放，仅在死球时播放可一键跳过

**SHA-256**: \`88a308948a5452db7ec9f3eb847659b6a1a531ef8fbe2642f09c3064b6b2f7c1\`
`;

const MESSY = `# v0.0.9

---

#### 变更 <b>要点</b>
1. 把 [设置页](https://example.com/settings) 重排,**支持拖动**排序
2. 修复 \`build-android.json\` 里遗漏的 *签名* 参数
> 引用块:延迟 <100ms 才算跟手
- 一条超长中文项:这个条目故意写得非常长以便触发多次折行看看悬挂缩进到底对不对齐
- https://github.com/favoroo/Dudu-Badminton/releases/download/v0.0.9/dudu-badminton-v0.0.9.apk
- 混合 mixed 词 longwordwithoutanybreaksitinsidehere 也要能切开
`;

/** 20 条小节的超长正文:必然顶到框高上限,只能靠滚动 */
const HUGE = `${Array.from({ length: 20 }, (_, i) => `### 第 ${i + 1} 项\n- 说明文字 ${i}`).join("\n\n")}\n`;

/**
 * 核心断言:一份正文走完整条排版链路。
 * 返回 { 行数, 内容高, 框高, 是否滚动 },供用例做额外比对。
 */
function audit(name: string, md: string): { lines: number; height: number; boxH: number; scrollable: boolean } {
  const layout = buildNotes(md, textW);
  const fit = fitNotesBox(layout.height);

  // —— 1) 横向不溢出 ——
  for (const line of layout.lines) {
    const avail = noteTextW(line.indent);
    const joined = line.spans.map((s) => s.text).join("");
    const w = textW(joined, line.kind === "section" ? NOTE.headSize : NOTE.size);
    ok(w <= avail, `${name}: 行宽 ${w} > 可用 ${avail} →「${joined}」`);
    ok(Math.abs(w - line.w) <= 1, `${name}: 行表自报宽 ${line.w} 与实测 ${w} 不符`);
    // 逐 span 累加必须等于整行宽 —— 弹窗是按 span 依次摆 x 的,对不上就会互相压字
    const spanSum = line.spans.reduce((a, s) => a + textW(s.text, line.kind === "section" ? NOTE.headSize : NOTE.size), 0);
    ok(Math.abs(spanSum - w) <= line.spans.length, `${name}: span 宽累加 ${spanSum} ≠ 行宽 ${w} →「${joined}」`);
    // —— 3) 语法噪音 ——
    for (const [re, label] of NOISE) ok(!re.test(joined), `${name}: 残留${label} →「${joined}」`);
  }

  // —— 2) 纵向:逐字复刻 update-dialog.renderNotes 的摆放循环 ——
  let sum = NOTE.padY * 2;
  for (const line of layout.lines) sum += line.h + line.lead;
  ok(sum === layout.height, `${name}: 内容高 ${layout.height} ≠ 累加 ${sum}`);
  const contentH = Math.max(fit.boxH, layout.height);
  const blockH = Math.min(contentH, layout.height);
  let y = contentH / 2 - (contentH - blockH) / 2 - NOTE.padY;
  let firstTop = 0;
  let lastBottom = 0;
  let first = true;
  let outside = 0;
  for (const line of layout.lines) {
    y -= line.lead;
    const top = y;
    y -= line.h;
    if (first) { firstTop = top; first = false; }
    lastBottom = y;
    if (Math.abs(top - line.h / 2) > fit.boxH / 2 - 1) outside++;
  }
  // 未滚动时不该有任何一行探出框(滚动态下探出的那几行由裁罩切掉,是设计而非事故)
  ok(!fit.scrollable || outside > 0, `${name}: 判定可滚动却没有行需要裁切`);
  ok(fit.scrollable || outside === 0, `${name}: ${outside} 行探出了 ${fit.boxH} 高的框`);
  ok(!fit.scrollable || layout.height > NOTE_BOX.maxH, `${name}: 判定滚动但内容没超过框上限`);
  if (!fit.scrollable) {
    ok(Math.abs(firstTop + lastBottom) < 0.51, `${name}: 文字块没在框里垂直居中(${firstTop} / ${lastBottom})`);
    ok(firstTop <= contentH / 2 - NOTE.padY + 0.01, `${name}: 首行顶到内边距之外`);
  }
  // 行前间距只属于小节行(且只有该逻辑行的首条物理行能带)
  ok(layout.lines.every((l) => l.lead === 0 || (l.kind === "section" && l.lead === NOTE.sectionLead)),
    `${name}: lead 分布异常`);

  // —— 5) 滚动态的开窗方向:打开必须落在第一条(顶部),不是最后一条 ——
  // 用户 2026-10-05 现场:更新记录弹窗一进来看到的是最旧版本 —— 旧写法把 +scrollMax
  // 当「顶」,而正位移是把内容往上推、露出的是内容底部。方向真话在 noteScrollRange。
  if (fit.scrollable) {
    const viewH = fit.boxH - VIEW_INSET * 2;
    const contentH = Math.max(fit.boxH, layout.height);
    const blockH = Math.min(contentH, layout.height);
    const range = noteScrollRange(contentH, viewH, fit.scrollable);
    // 逐字复刻摆放循环,量出第一条上缘 / 最后一条下缘(content 坐标)
    let y = contentH / 2 - (contentH - blockH) / 2 - NOTE.padY;
    let firstTop = 0;
    let lastBottom = 0;
    let first = true;
    for (const line of layout.lines) {
      y -= line.lead;
      if (first) { firstTop = y; first = false; }
      y -= line.h;
      lastBottom = y;
    }
    ok(range.min < range.max, `${name}: 判定可滚动但滚动区间为空`);
    ok(range.min + firstTop <= viewH / 2 + 0.01,
      `${name}: 滚到顶第一条仍探出视窗上缘 ${(range.min + firstTop - viewH / 2).toFixed(1)}(方向反了?)`);
    ok(range.min + firstTop >= -viewH / 2 - 0.01, `${name}: 滚到顶第一条落在视窗下缘之外`);
    ok(range.max + lastBottom >= -viewH / 2 - 0.01,
      `${name}: 滚到底最后一条仍探出视窗下缘 ${( -viewH / 2 - (range.max + lastBottom)).toFixed(1)}(方向反了?)`);
    ok(range.max + lastBottom <= viewH / 2 + 0.01, `${name}: 滚到底最后一条落在视窗上缘之外`);
    // 方向钉子:用 +max 当「顶」(旧写法)必须真的探出上缘 —— 这条红说明区间语义被翻转
    ok(range.max + firstTop > viewH / 2,
      `${name}: +max 也装得下第一条,方向钉子失去牙齿(内容高 ${contentH} / 视窗 ${viewH})`);
  }

  // —— 4) 封顶后卡片仍然装得下屏幕 ——
  ok(fit.boxH + CARD_STACK < 540 - 2 * VIEW_INSET, `${name}: 卡片高 ${fit.boxH + CARD_STACK} 顶穿 540`);

  if (verbose) preview(name, layout, fit, contentH);
  return { lines: layout.lines.length, height: layout.height, boxH: fit.boxH, scrollable: fit.scrollable };
}

/** 文本态预览:把框画出来,肉眼确认小节/圆点/缩进/裁切位置 */
function preview(name: string, layout: ReturnType<typeof buildNotes>, fit: ReturnType<typeof fitNotesBox>, contentH: number): void {
  const cols = 62;
  const scale = NOTE.boxW / cols;
  const unit = (v: number): number => Math.round(v / scale);
  // 打开时滚到顶部:可视窗覆盖的内容 y 区间
  const winTop = contentH / 2 - (fit.scrollable ? 0 : (contentH - fit.boxH) / 2);
  const winBottom = winTop - (fit.scrollable ? fit.boxH - VIEW_INSET * 2 : fit.boxH);
  console.log(`\n── ${name}  内容高 ${layout.height} / 框高 ${fit.boxH}${fit.scrollable ? "  ↕ 可滚动" : ""}`);
  console.log("┌" + "─".repeat(cols) + "┐");
  let y = contentH / 2 - NOTE.padY;
  for (const line of layout.lines) {
    y -= line.lead;
    const cy = y - line.h / 2;
    const mark = line.kind === "section" ? "▌" : line.kind === "item" ? "·" : " ";
    const text = mark + line.spans.map((s) => (s.strong ? `«${s.text}»` : s.text)).join("");
    const pad = " ".repeat(unit(NOTE.padX + line.indent));
    const body = (pad + text).slice(0, cols);
    const tail = cy < winBottom || cy > winTop ? "…裁切" : "";
    console.log(`│${body.padEnd(cols)}│${tail}`);
    y -= line.h;
  }
  console.log("└" + "─".repeat(cols) + "┘");
}

// ---------- 用例 ----------

console.log("notes-check: 更新弹窗排版回归\n");

const v008 = audit("v0.0.8 真实正文", V008);
ok(v008.lines === 7, `v0.0.8 应为 2 小节 + 5 条目 = 7 行,实得 ${v008.lines}`);
ok(!v008.scrollable, "v0.0.8 正文不该触发滚动(卡片变高即可)");

const messy = audit("畸形正文", MESSY);
ok(messy.lines > 7, `畸形正文应被折成多行,实得 ${messy.lines}`);

const huge = audit("超长正文", HUGE);
ok(huge.scrollable, "20 节正文必须走滚动,而不是被截断");
ok(huge.height > NOTE_BOX.maxH + 100, `超长正文内容高异常:${huge.height}`);

audit("空正文", "");
audit("只有 SHA 行", "**SHA-256**: `88a308948a5452db7ec9f3eb847659b6a1a531ef8fbe2642f09c3064b6b2f7c1`");
audit("只有文档标题", "## Dudu Badminton v0.0.8\n");
audit("纯空白", "   \n\n  \t \n");

// 兜底文案必须真出现,不能开一个空框
for (const empty of ["", "## Dudu Badminton v0.0.8\n", "**SHA-256**: `abc`"]) {
  const l = buildNotes(empty, textW);
  ok(l.lines.length === 1, `空正文兜底失效(输入 ${JSON.stringify(empty)} → ${l.lines.length} 行)`);
  ok(l.lines[0].spans.map((s) => s.text).join("").includes("修复已知问题"), "兜底文案内容不对");
}

// 行内解析:strong 片段要独立成段,颜色才分得开;相邻普通文字合并成一段
const spans = inlineSpans("把 **设置页** 重排,支持 `拖动` 排序");
ok(spans.length === 3 && spans[1].strong && spans[1].text === "设置页", `行内加粗解析异常:${JSON.stringify(spans)}`);
ok(spans.filter((s) => s.strong).length === 1, "strong 片段数量不对");
ok(spans.every((s) => !/[*`]/.test(s.text)), "行内语法符号没洗掉");

// 逻辑行分类
const kinds = parseReleaseNotes("### 小节\n- 项\n1. 有序\n普通段落").map((l) => l.kind).join(",");
ok(kinds === "section,item,item,para", `行分类异常:${kinds}`);

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
console.log(`  v0.0.8:${v008.lines} 行 / 内容 ${v008.height} / 框 ${v008.boxH} / 滚动 ${v008.scrollable ? "是" : "否"}`);
console.log(`  畸形:  ${messy.lines} 行 / 内容 ${messy.height} / 框 ${messy.boxH} / 滚动 ${messy.scrollable ? "是" : "否"}`);
console.log(`  超长:  ${huge.lines} 行 / 内容 ${huge.height} / 框 ${huge.boxH} / 滚动 ${huge.scrollable ? "是" : "否"}`);
process.exit(h.fails === 0 ? 0 : 1);
