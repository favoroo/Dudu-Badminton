// ============================================================
// 文案宽度估算 + 折行 —— 全站唯一一把「字有多宽 / 该在哪儿换行」的尺
//
// 单独成文件、零 cc 依赖的原因:更新弹窗的 markdown 折行(assets/scripts/ui/
// release-notes.ts)与战前简报的排版(assets/scripts/ui/brief-layout.ts)完全建立
// 在这把尺上,而折行算错一个单位就是文字糊到标题上、整行推出边框。
// 折行是纯算术,就该能在 node 下回归 —— 所以它不能和 cc 绑在同一个文件里。
// ui-arcade.ts 原样转出本函数,调用点不必改。
// ============================================================

/** 量字宽:(文本, 字号) → 世界单位宽度 */
export type Measure = (text: string, size: number) => number;

/**
 * 全角按 1.05、半角按 0.62 个字宽。
 * Graphics 没有 measureText,而 Label 的 contentSize 要等布局才准(当帧读是旧值),
 * 所以「底块要跟着字长走」的地方(chip / 轻提示 / HUD 状态条)统一用这把尺子。
 * 全角系数取 1.05 而非 1.0:宁可在折行时早一点换行,也不能晚 —— 早换只是少排一个字,
 * 晚换就是溢出边框。
 */
export function textW(text: string, size: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 255 ? 1.05 : 0.62;
  return Math.round(w * size);
}

/** 码位 > 0x2e80 视作 CJK / 全角(含中文标点),可逐字断行 */
export function isWide(ch: string): boolean {
  return ch.charCodeAt(0) > 0x2e80;
}

/**
 * 切成「不可断单元」:中日韩与全角标点逐字可断(它们本来就没有空格),
 * 拉丁词/数字/URL 连成一块,空格是断点。
 * 只按空格断行的话,一整句中文会被当成一个单元 —— 那是溢出最常见的来路。
 */
export function textUnits(text: string): string[] {
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

/**
 * 贪心折行:单元逐个装进当前行,装不下就换行;单个单元比整行还宽时逐字硬切。
 * 输入里的 `\n` 是硬换行,照样保留。
 *
 * 出来的每一行**在算术上保证** `measure(行) <= availW` —— 所以「不横向溢出」是
 * 算法性质,不是对文案的假设。渲染层拿到行表只管摆,不参与任何测量。
 * 空文本返回 `[]`(由调用方决定占不占位),全空白行会被丢掉。
 */
export function wrapText(text: string, size: number, availW: number, measure: Measure = textW): string[] {
  const rows: string[] = [];
  const flush = (buf: string): string => {
    const t = buf.replace(/\s+$/, "");
    if (t) rows.push(t);
    return "";
  };
  for (const para of String(text ?? "").split("\n")) {
    let buf = "";
    for (const unit of textUnits(para)) {
      if (!buf && unit === " ") continue;                 // 换行后不吃空格,行首不留白
      if (measure(unit, size) > availW) {
        buf = flush(buf);                                  // 一个单元就超宽:先结行再逐字硬切
        for (const ch of unit) {
          if (buf && measure(buf + ch, size) > availW) buf = flush(buf);
          buf += ch;
        }
        continue;
      }
      if (buf && measure(buf + unit, size) > availW) buf = flush(buf);
      buf += unit;
    }
    flush(buf);
  }
  return rows;
}
