// ============================================================
// 首页排版出图 —— 在 node 里把「五块大色块 + 底部活动横幅」画成 SVG,
// 再用 headless Chrome 光栅化看。四档屏幕长宽比并排:16:9 / 18:9 / 20:9(用户那台)/ 21:9。
//
// 为什么需要它:menu-check 断言的是**我自己那把尺量出来的**几何 —— 尺要是偏乐观,
// 断言全绿真机照样挤。而这一屏的赌注恰恰是观感:用户报的是「横幅被挤到下面去了」,
// 翻译成判据是「屏底留白 >= 18、阵↔横幅缝 >= 18」,翻译成图是「它看起来是那一排的收尾条,
// 不是贴在屏幕最下沿的一条贴纸」。出图与真机读同一份 layoutMenu + 同一份 p5-shapes 点列
// (斜切方向、chip 底块都是真的),所以图上的缝就是真机的缝。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/menu-preview.js --out .tools-build/menu-preview
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --screenshot=.tools-build/menu-preview/menu.png \
//     --window-size=1180,760 --default-background-color=00000000 \
//     file://$PWD/.tools-build/menu-preview/menu.svg
// ============================================================
import { mkdirSync, writeFileSync } from "fs";
import { C } from "../assets/scripts/ui/p5-tokens";
import { chipDL, skewOf, slantQuad, type Paint } from "../assets/scripts/ui/p5-shapes";
import { textW } from "../assets/scripts/core/text-metrics";
import {
  MENU, MENU_SIZE, MENU_TEXT, bottom, center, layoutMenu, partsOf, top, width,
  type BlockLayout, type Box, type MenuLayout,
} from "../assets/scripts/ui/menu-layout";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const SCALE = 0.5;
const COLS = 2;

/** cc 的 y 朝上 → SVG 朝下;整屏按 SCALE 缩 */
const sx = (v: number): number => v * SCALE;
const sy = (v: number): number => -v * SCALE;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const pts = (inPts: ReadonlyArray<readonly [number, number]>): string =>
  inPts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");

/** 块内局部盒 → 屏幕局部盒 */
const abs = (outer: Box, p: Box): Box => ({ left: center(outer) + p.left, right: center(outer) + p.right, cy: outer.cy + p.cy, h: p.h });

/** 大色块底面:与 drawSolidBlock 同一份 slantQuad 点列(斜切按块高现算) */
function face(b: Box, accent: string, opacity = 1): string {
  return `<polygon points="${pts(slantQuad(width(b), b.h, skewOf(b.h, 5), center(b), b.cy))}" fill="${accent}" fill-opacity="${opacity}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1"/>`;
}
function shadow(b: Box): string {
  return `<polygon points="${pts(slantQuad(width(b), b.h, skewOf(b.h, 5), center(b) + 5, b.cy - 6))}" fill="#000" opacity="0.5"/>`;
}
function chip(b: Box, tag: string, size: number, accent: string, faceHex = "#0a0e1c"): string {
  const body = chipDL(tag, size, faceHex).map((p) => paint(p, center(b), b.cy)).join("");
  return body + `<text x="${sx(center(b))}" y="${sy(b.cy) + size * SCALE * 0.36}" fill="${accent}" text-anchor="middle"`
    + ` font-size="${(size * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)}>${esc(tag)}</text>`;
}
/** 一笔 Paint → SVG(与 p5-paint 同一份点列,出图不另抄形状) */
function paint(p: Paint, ox: number, oy: number): string {
  if (p.kind === "dot") {
    return `<circle cx="${sx(p.cx + ox).toFixed(1)}" cy="${sy(p.cy + oy).toFixed(1)}" r="${(p.r * SCALE).toFixed(1)}" fill="${p.hex}" fill-opacity="${p.a}"/>`;
  }
  const body = pts(p.pts.map(([x, y]) => [x + ox, y + oy] as [number, number]));
  return p.kind === "stroke"
    ? `<polyline points="${body}" fill="none" stroke="${p.hex}" stroke-opacity="${p.a}" stroke-width="${(p.lw ?? 1).toFixed(1)}"/>`
    : `<polygon points="${body}" fill="${p.hex}" fill-opacity="${p.a}"/>`;
}
function txt(b: Box, s: string, size: number, fill: string, alpha = 1): string {
  return `<text x="${sx(b.left)}" y="${sy(b.cy) + size * SCALE * 0.36}" fill="${fill}" fill-opacity="${alpha}"`
    + ` font-size="${(size * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)}>${esc(s)}</text>`;
}
function chev(b: Box, ink: string): string {
  return `<text x="${sx(center(b))}" y="${sy(b.cy) + 4}" fill="${ink}" fill-opacity="0.75" text-anchor="middle"`
    + ` font-size="${(15 * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)}>»</text>`;
}

/** 一块大色块:底面 + 版式给的每一格 */
function drawBlock(L: MenuLayout, b: BlockLayout, accent: string, ink: string, texts: { tag: string; name: string; line: string; hint?: string }): string {
  const out: string[] = [shadow(b.outer), face(b.outer, accent)];
  const size = b === L.hero ? MENU_SIZE.heroChip : b === L.banner ? MENU_SIZE.bannerChip : MENU_SIZE.chip;
  // 角签底块:真机是 makeChip(n, tag, size, "#0a0e1c", accent) —— 墨面 + 块色字,出图同一份
  out.push(chip(abs(b.outer, b.chip), texts.tag, size, "#0a0e1c"));
  out.push(txt(abs(b.outer, b.name), texts.name, b === L.hero ? MENU_SIZE.heroName : b === L.banner ? MENU_SIZE.bannerName : MENU_SIZE.name, ink));
  if (b.line && texts.line) out.push(txt(abs(b.outer, b.line), texts.line, b === L.banner ? MENU_SIZE.bannerSub : b === L.hero ? MENU_SIZE.heroLine : MENU_SIZE.sub, ink, 0.7));
  const h = (b as { hint?: Box }).hint;
  if (h && texts.hint) out.push(txt(abs(b.outer, h), texts.hint, MENU_SIZE.heroHint, ink, 0.55));
  const d = (b as { dots?: Box }).dots;
  if (d) {
    const dotHexes = ["#7dff9e", "#ffe14d", "#ff6a1f", "#f43f5e"];
    out.push(dotHexes.map((hex, i) => {
      const bx = abs(b.outer, d);
      return `<rect x="${(sx(bx.left + i * 34)).toFixed(1)}" y="${sy(bx.cy + 7).toFixed(1)}" width="${sx(26).toFixed(1)}" height="${(14 * SCALE).toFixed(1)}" fill="${hex}" opacity="0.95"/>`;
    }).join(""));
  }
  out.push(chev(abs(b.outer, b.chev), ink));
  const claim = (b as { claim?: Box }).claim;
  if (claim) {
    const cb = abs(b.outer, claim);
    const s = "3 项可领";
    out.push(face(cb, C.acid));
    out.push(`<text x="${sx(center(cb))}" y="${sy(cb.cy) + 3.5}" fill="#0a0e1c" text-anchor="middle" font-size="${(MENU_SIZE.claimChip * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)}>${esc(s)}</text>`);
  }
  // 版式盒子(可开关):--boxes 时把每一格描出来,压字一眼看得见
  if (process.argv.includes("--boxes")) {
    for (const [p, nm] of partsOf(b)) {
      const ab = abs(b.outer, p);
      out.push(`<rect x="${sx(ab.left).toFixed(1)}" y="${sy(top(ab)).toFixed(1)}" width="${sx(width(ab)).toFixed(1)}" height="${(ab.h * SCALE).toFixed(1)}" fill="none" stroke="#00f0ff" stroke-width="0.6" opacity="0.6"/>`);
      out.push(`<text x="${sx(ab.left).toFixed(1)}" y="${sy(bottom(ab)) - 1}" fill="#00f0ff" font-size="5" font-family=${JSON.stringify(FONT)}>${esc(nm)}</text>`);
    }
  }
  return out.join("\n");
}

/** 与 menu-check 同源的四道缝/溢出判据(出图上直接印结论) */
function judges(L: MenuLayout): string {
  const bs = [L.hero, ...L.entries, L.banner].map((b) => b.outer);
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      if (Math.min(bs[i].right, bs[j].right) - Math.max(bs[i].left, bs[j].left) > 0.5
        && Math.min(top(bs[i]), top(bs[j])) - Math.max(bottom(bs[i]), bottom(bs[j])) > 0.5) return `块 ${i} 压住块 ${j}`;
    }
  }
  if (bottom(L.banner.outer) + MENU.screenH / 2 < MENU.bottomMargin - 0.5) return "横幅贴屏底";
  if (bottom(L.hero.outer) - top(L.banner.outer) < MENU.gapBanner - 0.5) return "阵↔横幅缝塌了";
  if (bottom(L.title) - top(L.hero.outer) < MENU.gapTitle - 0.5) return "标题↔阵缝塌了";
  if (L.visW / 2 - L.safe.x - L.half < MENU.edgeMin - 0.5 && L.f < MENU.fitMax) return "内容越出可视区";
  for (const b of [L.hero as BlockLayout, ...L.entries, L.banner as BlockLayout]) {
    for (const [p] of partsOf(b)) {
      const ab = abs(b.outer, p);
      if (ab.left < b.outer.left - 0.5 || ab.right > b.outer.right + 0.5) return "块内件越出块缘";
    }
  }
  return "";
}

/** 一屏:可视区边框 + 屏底留白带 + 标题 + 五块 + 横幅 */
function screen(visW: number, tag: string): string {
  const L = layoutMenu({ visW });
  const out: string[] = [];
  const half = MENU.screenH / 2;
  out.push(`<rect x="${sx(-visW / 2).toFixed(1)}" y="${sy(half).toFixed(1)}" width="${sx(visW).toFixed(1)}" height="${(sy(-half) - sy(half)).toFixed(1)}" fill="#101420" stroke="#3a4468" stroke-width="1.2" stroke-dasharray="6 5"/>`);
  // 屏底留白带:现场图里被吃掉的就是这一条(旧版 5,现在 18)
  out.push(`<rect x="${sx(-visW / 2).toFixed(1)}" y="${sy(-half + MENU.bottomMargin).toFixed(1)}" width="${sx(visW).toFixed(1)}" height="${(sy(-half) - sy(-half + MENU.bottomMargin)).toFixed(1)}" fill="${C.slash}" opacity="0.25"/>`);
  out.push(`<text x="${sx(-visW / 2) + 4}" y="${sy(-half + 9).toFixed(1)}" fill="#ff8d95" font-size="${(9 * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)}>屏底留白 ${L.margin.bottom.toFixed(0)}</text>`);
  // 顶栏占位(不参与拉伸:两组角锚徽章)
  const chipY = half - MENU.topPad - MENU.chipH / 2;
  for (const [x, w] of [[-visW / 2 + 14 + 120, 240], [visW / 2 - 14 - 88, 176]] as Array<[number, number]>) {
    out.push(`<rect x="${sx(x - w / 2).toFixed(1)}" y="${sy(chipY + MENU.chipH / 2).toFixed(1)}" width="${sx(w).toFixed(1)}" height="${(MENU.chipH * SCALE).toFixed(1)}" fill="#16161f" stroke="${C.slash}" stroke-width="1"/>`);
  }
  // 标题:与真机同一份 slantQuad(9° 斜切)
  out.push(shadow(L.title), face(L.title, C.slash));
  out.push(txt({ left: L.title.left + 30, right: L.title.right - 30, cy: L.title.cy, h: 50 }, MENU_TEXT.title.join(" "), MENU.titleSize, "#f5efe1"));
  // 五块 + 横幅
  out.push(drawBlock(L, L.hero, C.slash, "#f5efe1", { tag: MENU_TEXT.hero.tag, name: MENU_TEXT.hero.name, line: MENU_TEXT.hero.line, hint: MENU_TEXT.hero.hint }));
  const accents = [C.acid, C.good, C.cyan, C.paper];
  L.entries.forEach((e, i) => out.push(drawBlock(L, e, accents[i], "#0a0e1c", {
    tag: MENU_TEXT.entries[i].tag, name: MENU_TEXT.entries[i].name, line: MENU_TEXT.entries[i].sub,
  })));
  out.push(drawBlock(L, L.banner, C.hot, "#0a0e1c", { tag: MENU_TEXT.banner.tag, name: MENU_TEXT.banner.name, line: MENU_TEXT.banner.sub }));
  // 两道缝的读数 + 判据结论
  const note = (y: number, t: string): string =>
    `<text x="${sx(visW / 2) - 4}" y="${sy(y).toFixed(1)}" fill="#7dfe9e" font-size="${(9 * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)} text-anchor="end">${esc(t)}</text>`;
  out.push(note((bottom(L.hero.outer) + top(L.banner.outer)) / 2, `阵↔横幅 ${Math.round(bottom(L.hero.outer) - top(L.banner.outer))}`));
  out.push(note((bottom(L.title) + top(L.hero.outer)) / 2, `标题↔阵 ${Math.round(bottom(L.title) - top(L.hero.outer))}`));
  const verdict = judges(L);
  out.push(`<text x="${sx(-visW / 2) + 4}" y="${(sy(half) - 7).toFixed(1)}" fill="${verdict ? "#ff5a66" : "#7dfe9e"}" font-size="${(11 * SCALE).toFixed(1)}" font-family=${JSON.stringify(FONT)}>${esc(tag)} · 拉伸 ${L.f.toFixed(3)} · ${verdict ? `✗ ${verdict}` : "✓ 判据全绿"}</text>`);
  return `<g>${out.join("\n")}</g>`;
}

const PICKS = [960, 1080, 1200, 1260];
const CELL_W = sx(1260) + 46, CELL_H = (sy(-MENU.screenH / 2) - sy(MENU.screenH / 2)) + 66;
const sheetW = CELL_W * COLS + 40, sheetH = CELL_H * 2 + 40;

const groups: string[] = [];
PICKS.forEach((wv, i) => {
  const cx = 20 + (i % COLS) * CELL_W + CELL_W / 2;
  const cy = 34 + Math.floor(i / COLS) * CELL_H + CELL_H / 2;
  groups.push(`<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">${screen(wv, `${(wv / MENU.screenH).toFixed(2)}:1 可视宽 ${wv}`)}</g>`);
});

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW.toFixed(0)}" height="${sheetH.toFixed(0)}" viewBox="0 0 ${sheetW.toFixed(0)} ${sheetH.toFixed(0)}">
<rect width="${sheetW.toFixed(0)}" height="${sheetH.toFixed(0)}" fill="#07070d"/>
${groups.join("\n")}
</svg>
`;

const outDir = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/menu-preview";
})();
mkdirSync(outDir, { recursive: true });
const file = `${outDir}/menu.svg`;
writeFileSync(file, svg);
const bad = PICKS.filter((wv) => judges(layoutMenu({ visW: wv })).length > 0);
console.log(`✓ 出图 ${file}(${sheetW.toFixed(0)}×${sheetH.toFixed(0)},四档长宽比 = 16:9 / 18:9 / 20:9 / 21:9,红带 = 屏底留白${bad.length ? `;✗ ${bad.join("/")} 判据红` : ";判据全绿"})`);
if (bad.length) process.exit(1);
