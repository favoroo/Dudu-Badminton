// ============================================================
// 战前简报排版出图 —— 在 node 里把弹窗画成 SVG,再用 headless Chrome 光栅化看。
//
// 为什么需要它:这一轮改的全是「看不看得见」的问题(说明糊到弹窗外、三条三星目标
// 互相重叠),而 brief-check 断言的是**我自己那把尺量出来的**几何 —— 尺要是偏乐观,
// 断言全绿真机照样溢出。所以再拿一个独立裁判复核:SVG 交给 Chrome 用真实字体排,
// 每条物理行右边都画一根「排版算出来的行尾」游标,**字压过游标 = textW 量窄了**。
//
// 颜色与 campaign-panel 的 BRIEF_STYLE 是「同形不同源」(照 render/ui 那套约定,
// 出图工具不 import 面板,面板也不 import 出图工具);颜色错了不影响排版结论。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/brief-preview.js --out .tools-build/brief-preview
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --screenshot=.tools-build/brief-preview/brief.png \
//     --window-size=1320,1000 --default-background-color=00000000 \
//     file://$PWD/.tools-build/brief-preview/brief.svg
// ============================================================
import { mkdirSync, writeFileSync } from "fs";
import { CAMPAIGN_STAGES } from "../assets/scripts/core/campaign";
import { textW } from "../assets/scripts/core/text-metrics";
import { BRIEF, BRIEF_BTN, briefInput, briefOverlaps, briefOverflow, layoutBrief, type BriefItem, type BriefLayout } from "../assets/scripts/ui/brief-layout";

/** 与 campaign-panel 同款的块配色 */
const STYLE: Record<string, { col: string; center?: boolean }> = {
  title: { col: "#f5efe1", center: true },
  badge: { col: "#ffe14d", center: true },
  descHead: { col: "#e60012" },
  desc: { col: "#f5efe1" },
  hintHead: { col: "#7dfe9e" },
  hint: { col: "#ced8ec" },
  target: { col: "#f5efe1" },
  reward: { col: "#ffe14d" },
  starHead: { col: "#ffe14d" },
};
const CHIP_COL = "#c4d0e8";
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 一个弹窗:底板 + 逐块文字 + 行尾游标 */
function dialog(L: BriefLayout, title: string): string {
  const out: string[] = [];
  const W = L.dialogW, H = L.dialogH;
  const y = (v: number): number => -v;                        // 局部原点 = 弹窗中心:cc 的 y 朝上 → SVG 朝下

  out.push(`<g>`);
  out.push(`<text x="0" y="${-14}" fill="#9fb0d8" font-size="12" font-family=${JSON.stringify(FONT)}>${esc(title)}</text>`);
  out.push(`<rect x="${-W / 2 + 12}" y="${-H / 2 - 12}" width="${W}" height="${H}" rx="12" fill="#000" opacity="0.5"/>`);
  out.push(`<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="12" fill="#141622" stroke="#e60012" stroke-width="2.5"/>`);
  // 内边距参考线:文案可用宽就到此为止
  out.push(`<rect x="${-L.availW / 2}" y="${-H / 2 + 6}" width="${L.availW}" height="${H - 12}" fill="none" stroke="#3a4468" stroke-width="1" stroke-dasharray="4 5"/>`);

  for (const it of L.items) {
    const st = STYLE[it.key] ?? { col: CHIP_COL };
    const top = y(it.cy + it.h / 2);
    it.lines.forEach((line, i) => {
      const baseY = top + (i + 0.5) * it.lineH;
      const x = st.center ? 0 : it.left;
      out.push(`<text x="${x}" y="${baseY}" fill="${st.col}" font-size="${it.size}" font-family=${JSON.stringify(FONT)}`
        + ` text-anchor="${st.center ? "middle" : "start"}" dominant-baseline="middle">${esc(line)}</text>`);
      // 行尾游标:字压过这根线 = textW 量窄了(独立裁判在这一张图里)
      const w = textW(line, it.size);
      const right = st.center ? w / 2 : it.left + w;
      out.push(`<line x1="${right + 3}" y1="${baseY - 5}" x2="${right + 3}" y2="${baseY + 5}" stroke="#00f0ff" stroke-width="1" opacity="0.5"/>`);
    });
    if (process.argv.includes("--boxes")) {
      out.push(`<rect x="${it.left}" y="${top}" width="${it.w}" height="${it.h}" fill="none" stroke="#5b6690" stroke-width="0.8"/>`);
    }
  }

  for (const b of L.buttons) {
    const primary = b.key === "start";
    out.push(`<rect x="${b.cx - b.w / 2 + 3}" y="${y(b.cy + b.h / 2) + 4}" width="${b.w}" height="${b.h}" rx="9" fill="${primary ? "#8f0009" : "#101018"}" opacity="0.75"/>`);
    out.push(`<rect x="${b.cx - b.w / 2}" y="${y(b.cy + b.h / 2)}" width="${b.w}" height="${b.h}" rx="9"`
      + ` fill="${primary ? "#e60012" : "#20202e"}" stroke="${primary ? "#ff6b72" : "#f5efe1"}" stroke-opacity="${primary ? 1 : 0.32}" stroke-width="2"/>`);
    out.push(`<text x="${b.cx}" y="${y(b.cy) + 5}" fill="#f5efe1" font-size="${BRIEF.btnSize}" font-family=${JSON.stringify(FONT)}`
      + ` text-anchor="middle">${esc(b.text)}</text>`);
  }
  out.push(`</g>`);
  return out.join("\n");
}

// ---------- 拼一张 2×2 的图:最短 / 最长徽章名 / 最高框 / 生死战 ----------
const PICKS = [1, 13, 17, 20];
const CELL_W = BRIEF.dialogW + 60, CELL_H = BRIEF.maxDialogH + 90;
const COLS = 2, ROWS = 2;
const sheetW = CELL_W * COLS, sheetH = CELL_H * ROWS;

const groups: string[] = [];
PICKS.forEach((no, i) => {
  const st = CAMPAIGN_STAGES.find((s) => s.stageNo === no)!;
  const L = layoutBrief(briefInput(st));
  const of = briefOverflow(L), ov = briefOverlaps(L);
  const cx = (i % COLS) * CELL_W + CELL_W / 2;
  const cy = Math.floor(i / COLS) * CELL_H + CELL_H / 2 + 20;
  const verdict = of.length === 0 && ov.length === 0 ? "OK" : `溢出 ${of.length} / 压字 ${ov.length}`;
  groups.push(`<g transform="translate(${cx},${cy})">${dialog(L, `ST${no} ${st.title} · 框高 ${L.dialogH} · ${verdict}`)}</g>`);
});

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">
<rect width="${sheetW}" height="${sheetH}" fill="#07070d"/>
${groups.join("\n")}
</svg>
`;

const outDir = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/brief-preview";
})();
mkdirSync(outDir, { recursive: true });
const file = `${outDir}/brief.svg`;
writeFileSync(file, svg);
console.log(`✓ 出图 ${file}(${sheetW}×${sheetH},2×2 = ST${PICKS.join(" / ST")},青色游标 = 排版算出的行尾)`);
