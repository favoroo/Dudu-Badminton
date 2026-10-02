// ============================================================
// 训练场引导演示出图 —— 把六关 × 四步共 24 张定格画面画成 SVG,肉眼判「看不看得懂」。
//
// 为什么需要它:AGENTS.md 坑 1/2 —— 编辑器自动化封闭、Cocos 构建产物在内置浏览器永久 hang,
// 这一屏的**观感**在真机之外没有第二条路可看。而断言只能证明「不撞、不出框、落点是真的」,
// 证明不了「玩家看完知道下一步手往哪儿动」。
//
// 与 panel-preview 同一条纪律:**不重抄一遍画面**。直接 import render/drill-anim(引擎的
// Graphics 被 cc-stub 换成记录每一笔画的桩),再用同一批 p5-shapes/p5-paint 摆分步卡 ——
// 出的图与真机上画的是同一批多边形与同一批文案盒,风格错了在这张图上就错。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/drill-diagram-preview.js --out .tools-build/drill-diagram
//   for f in .tools-build/drill-diagram/*.svg; do
//     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
//       --use-gl=swiftshader --screenshot="$f.png" --window-size=1240,260 "file://$PWD/$f"; done
// ============================================================
import "./cc-stub";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Graphics } from "cc";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { CFG, DRILLS } from "../assets/scripts/core/config";
import * as DrillAnim from "../assets/scripts/render/drill-anim";
import { C, ROLE, SLANT, inkFor } from "../assets/scripts/ui/p5-tokens";
import { drawBevelSlot, drawP5Block, drawPosterPlate, drawSectionBand } from "../assets/scripts/ui/p5-paint";
import {
  animBox, BAR_TITLE, BTNS, DEMO_TAG, DRILL, examStarRow, headInfoBand, KEYS, SECTIONS,
  briefInfo, centerX, closeHit, demoTagBox, keyRow, requirementOf, stepCardBoxes, stepCardRows,
  stepLines, titleBand, top, bottom, widthOf, type Box,
} from "../assets/scripts/ui/drill-layout";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
/** 整页缩放:一张定格画面 = 画布 + 它那一张分步卡,四步横排刚好一屏宽 */
const K = 0.68;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 一块记录型 Graphics 的 SVG 片段(局部 y 向上 → SVG y 向下) */
function shape(cx: number, cy: number, draw: (g: Graphics) => void): string {
  const g = new StubGraphics();
  draw(g as unknown as Graphics);
  return `<g transform="translate(${r2(cx)},${r2(cy)}) scale(1,-1)">${opsToSvg(g.ops)}</g>`;
}

function txt(x: number, y: number, s: string, size: number, hex: string,
  opts: { anchor?: "start" | "middle" | "end"; bold?: boolean } = {}): string {
  const a = opts.anchor ?? "middle";
  return `<text x="${r2(x)}" y="${r2(y + size * 0.36)}" font-family="${FONT}" font-size="${r2(size)}" `
    + `fill="${hex}"${opts.bold ? " font-weight=\"700\"" : ""} text-anchor="${a === "start" ? "start" : a === "end" ? "end" : "middle"}">${esc(s)}</text>`;
}

/** 一张定格画面:动画本体 + 那一步的标字(标字真机是 Label,这里画成同位置的 SVG text) */
function frame(def: (typeof DRILLS)[number], i: number, ox: number, oy: number, cw: number, ch: number): string {
  const rig = DrillAnim.build(def, null);
  if (!rig) return txt(ox + cw / 2, oy + ch / 2, "烘不出真值", 14, "#ff8f8f");
  DrillAnim.gotoStep(rig, i);
  const parts: string[] = [];
  // 画布底(凹陷槽)与动画本体:同一台相机,所以标字坐标能直接对齐
  parts.push(shape(ox + cw / 2, oy + ch / 2, (g) => drawBevelSlot(g, cw, ch, SLANT.block, "#0d1120")));
  parts.push(shape(ox + cw / 2, oy + ch / 2, (g) => DrillAnim.drawFrame(g, rig, cw, ch)));
  for (const c of DrillAnim.callouts(rig, i, cw, ch)) {
    const col = CALLOUT[c.tone];
    parts.push(txt(ox + cw / 2 + c.x, oy + ch / 2 - c.y, c.text, col.size, col.hex, { bold: col.bold }));
  }
  // 第几步:压在画布左上,与真机那块「教学演示」色带错开
  parts.push(txt(ox + 10, oy + 18, `${i + 1} ${def.demoSteps?.[i]?.name ?? ""}`, 15, C.paper, { anchor: "start", bold: true }));
  return parts.join("");
}

/** 标字配色:与 drill-panel 的 CALLOUT 同值(两边同源,改要一起改) */
const CALLOUT: Record<string, { hex: string; size: number; bold?: boolean }> = {
  zone: { hex: "#7dff9e", size: 11, bold: true },
  stand: { hex: "#00f0ff", size: 10 },
  hit: { hex: "#ffffff", size: 11, bold: true },
  key: { hex: "#ffe14d", size: 12, bold: true },
  land: { hex: "#ffe14d", size: 11, bold: true },
  alt: { hex: "#ff8f8f", size: 10 },
  meter: { hex: "#c8d4ff", size: 10 },
};

/** 一格的分步卡(真机同一批 Box 与同一条 paint):选中那张亮面,其余凹陷 */
function card(def: (typeof DRILLS)[number], i: number, sel: boolean, ox: number, oy: number, cw: number, ch: number): string {
  // 盒子按「卡中心为原点、y 向上」算(与真机同一份 stepCardRows),画到 SVG 时只做一次翻转
  const b = { left: -cw / 2, right: cw / 2, cy: 0, h: ch };
  const rows = stepCardRows(b);
  const ln = stepLines(b, def, i);
  const cx = ox + cw / 2, cy = oy + ch / 2;
  const inkNow = sel ? inkFor(ROLE.star.face) : C.paper;
  const X = (v: number): number => cx + v;
  const Y = (v: number): number => cy - v;
  return shape(cx, cy, (g) => (sel
    ? drawP5Block(g, cw, ch, ROLE.star.face, SLANT.button)
    : drawBevelSlot(g, cw, ch, SLANT.block, "#182142")))
    + txt(X(rows.head.left + DRILLPAD), Y(rows.head.cy), ln.head, 12, inkNow, { anchor: "start", bold: true })
    + txt(X(rows.body.left + DRILLPAD), Y(rows.body.cy + 7), ln.lines[0] ?? "", 11, inkNow, { anchor: "start" })
    + txt(X(rows.body.left + DRILLPAD), Y(rows.body.cy - 7), ln.noteLines[0] ?? "", 10, sel ? "#8a6a00" : C.dim, { anchor: "start" });
}
const DRILLPAD = 10;

function sheet(def: (typeof DRILLS)[number]): { svg: string; w: number; h: number } {
  const c = CFG.drill.canvas;
  const cards = stepCardBoxes();
  // 画布缩着画,分步卡**保持真实高度**:stepCardRows 的 18/28 内边距是按 62 高排的,
  // 连卡一起缩会让两行正文叠成一坨 —— 那是出图工具的错,不是版式的错。
  const aw = Math.round(c.w * K), ah = Math.round(c.h * K), ch = cards[0].h;
  const gapX = 22, gapY = 18, padTop = 46, pad = 28;
  const w = pad * 2 + 2 * aw + gapX;
  const h = padTop + 2 * (ah + 6 + ch) + gapY + 16;
  const out: string[] = [];
  out.push(txt(pad, 26, `${def.label} ${def.tag} · 定格讲解四步(上:与真机同一批多边形;下:那一步的分步卡)`, 16, C.paper, { anchor: "start", bold: true }));
  for (let i = 0; i < 4; i++) {
    const ox = pad + (i % 2) * (aw + gapX);
    const oy = padTop + Math.floor(i / 2) * (ah + 6 + ch + gapY);
    out.push(frame(def, i, ox, oy, aw, ah));
    out.push(card(def, i, i === 0, ox, oy + ah + 6, aw, ch));
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">`
    + `<rect width="100%" height="100%" fill="#0d0f16"/>${out.join("")}</svg>`, w, h };
}

/**
 * 整页拼装(--page):把某一关的引导页按真机同一批 Box 摆一遍 —— 分步卡与右列文字
 * 会不会互相挤、标字会不会压到「教学演示」那块色带,这些是算术判据看不出来的。
 */
function page(def: (typeof DRILLS)[number], step: number): { svg: string; w: number; h: number } {
  const c = CFG.drill.canvas;
  const a = animBox();
  const cards = stepCardBoxes();
  const K2 = keyRow();
  const info = briefInfo(def, { clears: 3, stars: 2, bestQ: 0.83, bestReps: 4 });
  const w = DRILL.pw, h = DRILL.ph;
  const X = (v: number): number => w / 2 + v;
  const Y = (v: number): number => h / 2 - v;
  const out: string[] = [];
  out.push(shape(X(0), Y(0), (g) => drawPosterPlate(g, w, h, { bandHex: ROLE.drill.face, halftone: true })));
  // 顶栏
  out.push(shape(X(centerX(titleBand())), Y(DRILL.barCy), (g) => drawSectionBand(g, widthOf(titleBand()), DRILL.barH, ROLE.drill.face)));
  out.push(txt(X(DRILL.left + 12), Y(DRILL.barCy), BAR_TITLE, 16, inkFor(ROLE.drill.face), { anchor: "start", bold: true }));
  out.push(txt(X(widthOf(headInfoBand()) / 2 + 60), Y(DRILL.barCy), "4 / 6 已练成", 13, C.dim, { anchor: "end" }));
  // 画布 + 那一步的定格与标字
  out.push(shape(X(centerX(a)), Y(a.cy), (g) => drawBevelSlot(g, widthOf(a), a.h, SLANT.block, "#0d1120")));
  out.push(frame(def, step, X(a.left), Y(top(a)), widthOf(a), a.h));
  out.push(shape(X(centerX(demoTagBox())), Y(demoTagBox().cy), (g) => drawSectionBand(g, widthOf(demoTagBox()), DRILL.bandH2, ROLE.info.face)));
  out.push(txt(X(demoTagBox().left + 12), Y(demoTagBox().cy), DEMO_TAG, 11, inkFor(ROLE.info.face), { anchor: "start" }));
  // 四张分步卡
  cards.forEach((b, i) => out.push(card(def, i, i === step, X(b.left), Y(top(b)), widthOf(b), b.h)));
  // 底排五颗键
  const keys: Array<[Box, string, string]> = [
    [K2.play, KEYS.pause, ROLE.off.face], [K2.speed, KEYS.normal, ROLE.off.face], [K2.replay, KEYS.replay, ROLE.off.face],
    [K2.back, BTNS.back, ROLE.off.face], [K2.go, BTNS.go, ROLE.primary.face],
  ];
  for (const [b, t, face] of keys) {
    out.push(shape(X(centerX(b)), Y(b.cy), (g) => drawP5Block(g, widthOf(b), b.h, face, SLANT.button)));
    out.push(txt(X(centerX(b)), Y(b.cy), t, b === K2.go ? 16 : 13, inkFor(face), { bold: true }));
  }
  // 右列
  out.push(txt(X(info.name.box.left), Y(info.name.box.cy), def.label, DRILL.nameSize, C.paper, { anchor: "start", bold: true }));
  for (const [b, t] of [[info.howTo, SECTIONS.howTo], [info.requirement, requirementOf(def)], [info.examBand, SECTIONS.exam], [info.recordBand, SECTIONS.record]] as Array<[Box, string]>) {
    out.push(shape(X(centerX(b)), Y(b.cy), (g) => drawSectionBand(g, widthOf(b), b.h, ROLE.star.face)));
    out.push(txt(X(b.left + 12), Y(b.cy), t, DRILL.bandSize, inkFor(ROLE.star.face), { anchor: "start" }));
  }
  out.push(txt(X(info.cue.box.left), Y(info.cue.box.cy), info.cue.lines.join(" / "), DRILL.cueSize, C.paper, { anchor: "start" }));
  info.exam.lines.forEach((ln, i) => {
    const row = examStarRow(info.exam.box, i);
    out.push(txt(X(row.text.left), Y(row.text.cy), ln, DRILL.examSize, C.dim, { anchor: "start" }));
  });
  info.record.lines.forEach((ln, i) => out.push(txt(X(info.record.box.left), Y(top(info.record.box) - 8 - i * 16), ln, DRILL.recordSize, C.dim, { anchor: "start" })));
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="100%" height="100%" fill="#0d0f16"/>${out.join("")}</svg>`, w, h };
}

const outIdx = process.argv.indexOf("--out");
const dir = outIdx >= 0 ? process.argv[outIdx + 1] : ".tools-build/drill-diagram";
mkdirSync(dir, { recursive: true });

// 演示真值的几何自检:定格帧必须落在该步的区间里,而连播时读数会一路走完 0..3
const tlOf = (def: (typeof DRILLS)[number]): DrillAnim.Timeline | null => {
  const rig = DrillAnim.build(def, null);
  return rig ? rig.tl : null;
};
let bad = 0;
for (const def of DRILLS) {
  const tl = tlOf(def);
  if (!tl) { console.log(`✗ ${def.id} 烘不出 rig`); bad++; continue; }
  for (let i = 0; i < 4; i++) {
    const f = DrillAnim.stepFrame(tl, i);
    const back = DrillAnim.stepOfFrame(tl, f);
    if (back !== i) { console.log(`✗ ${def.id} 第${i + 1}步锚帧 ${f.toFixed(1)} 被判成第${back + 1}步`); bad++; }
    if (f < 0 || f > tl.total) { console.log(`✗ ${def.id} 第${i + 1}步锚帧 ${f.toFixed(1)} 出了整轮 ${tl.total}`); bad++; }
  }
  if (tl.in + tl.wind + tl.freeze + tl.out + tl.settle !== tl.total) {
    console.log(`✗ ${def.id} 节拍加不起来:${tl.total} ≠ 分段之和`); bad++;
  }
}

if (process.argv.includes("--page")) {
  for (const def of DRILLS) {
    for (let i = 0; i < 4; i++) {
      const s2 = page(def, i);
      writeFileSync(join(dir, `page-${def.id}-${i + 1}.svg`), s2.svg);
    }
    console.log(`✓ ${def.id} 整页四步拼装`);
  }
  process.exit(0);
}

const index: string[] = [];
for (const def of DRILLS) {
  const s = sheet(def);
  const file = join(dir, `${def.id}.svg`);
  writeFileSync(file, s.svg);
  index.push(`<li><a href="${def.id}.svg">${def.label}(${def.id})</a> ${s.w.toFixed(0)}×${s.h.toFixed(0)}</li>`);
  console.log(`✓ ${def.id.padEnd(8)} 四步出图 ${s.w.toFixed(0)}×${s.h.toFixed(0)} · 来球 ${def ? "" : ""}`);
}
writeFileSync(join(dir, "index.html"),
  `<!meta charset="utf-8"><body style="background:#0d0f16;color:#efe7d6;font-family:${FONT}">`
  + `<h3>训练场引导演示 · 六关四步</h3><ul>${index.join("")}</ul>`
  + `<p style="color:#9aa4c0">每张图:上为定格画面(与真机同一批 Graphics 笔画 + 同一批标字坐标),下为该步的分步卡。第 1 张卡片亮面 = 选中态。</p></body>`);
console.log(bad ? `\n${bad} 处节拍问题` : "\n四步锚帧与节拍自洽,24 张图已出");
process.exit(bad ? 1 : 0);
