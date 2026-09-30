// ============================================================
// Release 正文(markdown)→ 更新弹窗可排版的行
//
// 为什么要单独一个文件、而且零 cc 依赖:
// 弹窗的「溢出」全发生在这一步 —— 折行折错一个单位,文字就压到标题和进度条上
// (v0.0.7 的线上事故就是整段 markdown 原样糊出来,连 `##` 和 SHA-256 都在屏上)。
// 折行是纯算术,不该只能靠开编辑器肉眼验收。所以这里把语法清洗 + 折行 + 高度结算
// 全做成纯函数,字宽由调用方注入(ui-arcade.textW 那把尺),node 下直接回归
// (tools/notes-check.ts)。渲染层只管「照着行表画」,不参与任何测量。
//
// 输出的是「物理行」而不是「逻辑行」:折行后每行自带 indent / h / lead,
// 弹窗按 y 累加摆放即可,行宽 w 已保证 <= textW 可用宽 —— 溢出在类型上就不可能。
// ============================================================

/** 行类型:小节标题(`### x`)/ 列表项(`- x`、`1. x`)/ 普通段落 */
export type NoteKind = "section" | "item" | "para";

/**
 * 一段同样式的连续文字。
 * strong = markdown 的 `**加粗**`:原生端 FreeType 没有粗体字面,`<b>` 在安卓上
 * 和正文一模一样,所以强调一律改用强调色表达,不指望字重。
 */
export interface NoteSpan {
  text: string;
  strong: boolean;
}

/** 折行后的一条物理行(渲染层按 lines 顺序自上而下摆) */
export interface NoteLine {
  kind: NoteKind;
  spans: NoteSpan[];
  /** 左缩进:标记(色条/圆点)占位,折行续行同样缩进 —— 悬挂缩进 */
  indent: number;
  /** 行高 */
  h: number;
  /** 行前额外间距(只有小节首行有) */
  lead: number;
  /** 实测行宽,回归用来断言没超可用宽 */
  w: number;
}

export interface NoteLayout {
  lines: NoteLine[];
  /** 内容总高(含上下内边距):> 日志框可视高就该滚动 */
  height: number;
}

/** 量字宽:(文本, 字号) → 世界单位宽度 */
export type Measure = (text: string, size: number) => number;

/**
 * 排版常量 —— 折行可用宽、行高、缩进都从这里出,
 * 弹窗(update-dialog)与回归(notes-check)共用同一把尺,不会各算各的算歪。
 */
export const NOTE = {
  /** 日志框内宽(世界单位) */
  boxW: 420,
  /** 左右内边距:框缘 → 标记/正文起点 */
  padX: 18,
  /** 上下内边距 */
  padY: 12,
  /** 正文字号 / 行高 */
  size: 13,
  lineH: 17,
  /** 小节标题字号 / 行高 / 与上一节的额外间距 */
  headSize: 14,
  headH: 20,
  sectionLead: 7,
  /** 标记占位:小节 = 3 宽色条 + 9 间距;列表项 = 圆点 + 间距 */
  sectionIndent: 12,
  itemIndent: 14,
} as const;

/** 正文可用的折行宽度(去掉内边距) */
export function noteTextW(indent: number): number {
  return NOTE.boxW - NOTE.padX * 2 - indent;
}

/**
 * 日志框可视高区间。封顶后卡片总高 = maxH + 卡头 99 + 卡尾 149 = 464,
 * 设计分辨率高 540,还留 38 的上下边距 —— 再高就要顶穿屏幕了(notes-check 有断言)。
 */
export const NOTE_BOX = { minH: 72, maxH: 216 } as const;

/**
 * 内容高 → 框高 + 是否需要滚动。
 * 只有两条路:框变高,或者框封顶后开裁罩滚动。**没有第三条**(截断/省略号)。
 */
export function fitNotesBox(contentH: number): { boxH: number; scrollable: boolean } {
  const boxH = Math.max(NOTE_BOX.minH, Math.min(NOTE_BOX.maxH, Math.round(contentH)));
  return { boxH, scrollable: contentH > boxH + 0.5 };
}

// ---------- markdown → 逻辑行 ----------

const HEAD_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\d{1,2})[.)]\s+(.*)$/;
/** `---` / `***` 分隔线 */
const HR_RE = /^[-*_]{3,}$/;
/** `**SHA-256**: \`abc...\`` —— 校验和是发布脚本写给运维看的,玩家不需要在弹窗里读 64 位十六进制 */
const SHA_RE = /^>?[*_`]{0,3}sha[\s-]*256[*_`]{0,3}\s*[:：]/i;
/** 被折行甩出来的裸哈希续行 */
const HASH_RE = /^[`'"]*[0-9a-f]{16,}[`'"]*$/i;
/** 文档级标题(`## Dudu Badminton v0.0.8`):版本号弹窗上方已经写了,不再重复 */
const DOC_TITLE_RE = /^#{1,2}\s+.*\d+\.\d+\.\d+/;

/**
 * 行内语法清洗:链接留锚文本、行内代码去壳、HTML 标签整段丢掉,
 * `**加粗**` 拆成 strong 片段。返回空数组表示这一行没有可见内容。
 */
export function inlineSpans(raw: string): NoteSpan[] {
  const s = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")      // 图片:弹窗里没有贴图位,连 alt 一起丢
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // 链接 → 锚文本
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")     // 行内代码 → 纯文本
    .replace(/<[^>]*>/g, "")                   // HTML 标签
    .replace(/\\([*_`#])/g, "$1");             // 反斜杠转义
  const out: NoteSpan[] = [];
  for (const part of s.split(/(\*\*[^*]+\*\*|__[^_]+__)/)) {
    if (!part) continue;
    const strong = /^\*\*([\s\S]+)\*\*$|^__([\s\S]+)__$/.exec(part);
    if (strong) {
      const t = (strong[1] ?? strong[2] ?? "").trim();
      if (t) out.push({ text: t, strong: true });
      continue;
    }
    // 单星号斜体在原生字体里同样出不来效果,只把语法噪音擦掉
    const t = part.replace(/\*([^*\s][^*]*)\*/g, "$1").trim();
    if (t) out.push({ text: t, strong: false });
  }
  return out;
}

/**
 * Release 正文 → 逻辑行(未折行)。
 * 认不出的语法一律降级成段落,绝不把 `#`、`*`、反引号原样留在屏幕上。
 */
export function parseReleaseNotes(md: string): NoteLine[] {
  const out: NoteLine[] = [];
  for (const rawLine of (md || "").split("\n")) {
    const line = rawLine.trim();
    if (!line || HR_RE.test(line)) continue;
    if (DOC_TITLE_RE.test(line)) continue;
    if (SHA_RE.test(line.replace(/[*`_\s]/g, ""))) continue;
    if (HASH_RE.test(line.replace(/[*`_\s]/g, ""))) continue;

    const head = HEAD_RE.exec(line);
    if (head) {
      const spans = inlineSpans(head[2]);
      if (spans.length) out.push({ kind: "section", spans, indent: NOTE.sectionIndent, h: NOTE.headH, lead: NOTE.sectionLead, w: 0 });
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      const spans = inlineSpans(bullet[1]);
      if (spans.length) out.push({ kind: "item", spans, indent: NOTE.itemIndent, h: NOTE.lineH, lead: 0, w: 0 });
      continue;
    }
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      const spans = [{ text: `${ordered[1]}. `, strong: true }, ...inlineSpans(ordered[2])];
      out.push({ kind: "item", spans, indent: NOTE.itemIndent, h: NOTE.lineH, lead: 0, w: 0 });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    const spans = inlineSpans(quote ? quote[1] : line);
    if (spans.length) out.push({ kind: "para", spans, indent: 0, h: NOTE.lineH, lead: 0, w: 0 });
  }
  return out;
}

// ---------- 折行 ----------

/**
 * 切成「不可断单元」:中日韩与全角标点逐字可断(它们本来就没有空格),
 * 拉丁词/数字/URL 连成一块,空格是断点。
 * 只按空格断行的话,一整句中文会被当成一个单元 —— 那是溢出最常见的来路。
 */
function units(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " ") {
      out.push(" ");
      i++;
      continue;
    }
    if (isWide(ch)) {
      out.push(ch);
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== " " && !isWide(text[j])) j++;
    out.push(text.slice(i, j));
    i = j;
  }
  return out;
}

/** 码位 > 0x2e80 视作 CJK / 全角(含中文标点),可逐字断行 */
function isWide(ch: string): boolean {
  return ch.charCodeAt(0) > 0x2e80;
}

/** 合并相邻同样式片段,一行内 strong 段不会碎成一堆 label */
function mergeSpans(spans: NoteSpan[]): NoteSpan[] {
  const out: NoteSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.strong === s.strong) last.text += s.text;
    else out.push({ text: s.text, strong: s.strong });
  }
  return out;
}

/**
 * 逻辑行 → 物理行。
 * 单元逐个装进当前行,装不下就换行;单个单元比整行还宽(裸长 URL)时按字硬切,
 * 保证「任何输入都不横向溢出」是算法性质,不是对文案的假设。
 */
function wrapLine(line: NoteLine, measure: Measure): NoteLine[] {
  const size = line.kind === "section" ? NOTE.headSize : NOTE.size;
  const avail = noteTextW(line.indent);
  const flat: { unit: string; strong: boolean }[] = [];
  for (const span of line.spans) for (const u of units(span.text)) flat.push({ unit: u, strong: span.strong });

  const rows: { spans: NoteSpan[]; w: number }[] = [];
  let spans: NoteSpan[] = [];
  let w = 0;
  const flush = (): void => {
    const trimmed = mergeSpans(spans);
    while (trimmed.length && trimmed[trimmed.length - 1].text.endsWith(" ")) {
      const last = trimmed[trimmed.length - 1];
      trimmed[trimmed.length - 1] = { text: last.text.replace(/\s+$/, ""), strong: last.strong };
      if (!trimmed[trimmed.length - 1].text) trimmed.pop();
    }
    rows.push({ spans: trimmed, w: measure(trimmed.map((s) => s.text).join(""), size) });
    spans = [];
    w = 0;
  };
  for (const f of flat) {
    let piece = f.unit;
    const uw = measure(piece, size);
    if (uw > avail) {
      // 超长单元:先结掉当前行,再逐字硬切
      if (w > 0) flush();
      let chunk = "";
      for (const ch of piece) {
        if (chunk && measure(`${chunk}${ch}`, size) > avail) {
          spans.push({ text: chunk, strong: f.strong });
          chunk = "";
          flush();
        }
        chunk += ch;
      }
      if (chunk) spans.push({ text: chunk, strong: f.strong });
      w = measure(spans.map((s) => s.text).join(""), size);
      continue;
    }
    if (w + uw > avail) flush();
    spans.push({ text: piece, strong: f.strong });
    w += uw;
  }
  if (spans.length) flush();

  return rows
    .filter((r) => r.spans.length > 0)
    .map((r, i) => ({ kind: line.kind, spans: r.spans, indent: line.indent, h: line.h, lead: i === 0 ? line.lead : 0, w: r.w }));
}

/**
 * 折行 + 结算总高。
 * height 与逐行 y 偏移用同一份 h/lead 累加,弹窗不再另算一遍 —— 两处各算一次
 * 就是 v0.0.7 那次的病根。
 */
export function layoutNotes(logical: NoteLine[], measure: Measure): NoteLayout {
  const lines: NoteLine[] = [];
  for (const line of logical) lines.push(...wrapLine(line, measure));
  // 小节间距是「两节之间」的事:第一条上面再垫 7,整块内容会被顶偏、居中算不平
  if (lines.length) lines[0] = { ...lines[0], lead: 0 };
  let height = NOTE.padY * 2;
  for (const line of lines) height += line.h + line.lead;
  return { lines, height: Math.round(height) };
}

/** 兜底文案:正文为空 / 全被过滤掉时用,免得弹窗开一个空框 */
export const NOTE_FALLBACK = "修复已知问题，优化游戏体验。";

/** 一步到位:清洗 → 折行 → 结算(空正文自动兜底) */
export function buildNotes(md: string, measure: Measure): NoteLayout {
  let logical = parseReleaseNotes(md || "");
  if (!logical.length) logical = parseReleaseNotes(NOTE_FALLBACK);
  return layoutNotes(logical, measure);
}
