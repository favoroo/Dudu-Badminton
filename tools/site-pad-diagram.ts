// ============================================================
// 介绍站用「移动方式图示」出图 —— 与 tools/pad-diagram-preview 同源同画法,
// 但**不带任何标定读数**。
//
// 为什么要单独一支:pad-diagram-preview 那张是给开发看的接触印相,每格底下印着
// 「41 笔 · 人物 x 363 · 离地 0」这类调参读数,还有一段解释像素与键位来源的说明。
// 那些对玩家没有意义,放进介绍页就像把调试日志贴到了海报上。
// 这里调的是同一支 padDiagramDL(几何全取自真值),只去掉标注。
//
// 出图:每种移动方式一格(挑最能说明该档特性的那一帧),横排三格。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/site-pad-diagram.js --out .tools-build/site-pad-diagram
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
//     --screenshot=.tools-build/site-pad-diagram/pad.png --window-size=1260,420 \
//     --hide-scrollbars "file://$PWD/.tools-build/site-pad-diagram/pad.html"
// ============================================================
import "./cc-stub";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Graphics } from "cc";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { C } from "../assets/scripts/ui/p5-tokens";
import { drawBevelSlot, paintP5 } from "../assets/scripts/ui/p5-paint";
import { SET, controlLayout } from "../assets/scripts/ui/settings-layout";
import { padDiagramDL } from "../assets/scripts/ui/pad-diagram";
import { SLANT } from "../assets/scripts/ui/p5-tokens";
import type { MoveMode } from "../assets/scripts/core/settings";

const K = controlLayout();
const BOX = { w: K.diagram.right - K.diagram.left, h: K.diagram.h };
const ZOOM = 2.0;

/**
 * 每档挑一帧:
 *   摇杆 t=112 —— 正往网前走,身后重影由密到疏(起步/刹车),最能看出模拟量
 *   滑轨 t=112 —— 滑块与人同一条竖线,1:1 对位看得最清
 *   按键 t=245 —— 越过起跳判定,三颗键的三角摆位与上箭头都亮着
 */
const PICKS: Array<[MoveMode, number, string]> = [
  ["joystick", 112, "摇杆"],
  ["slider", 112, "滑轨"],
  ["buttons", 245, "按键"],
];

function cell(mode: MoveMode, t: number): string {
  const g = new StubGraphics();
  drawBevelSlot(g as unknown as Graphics, BOX.w, BOX.h, SLANT.block, C.ink);
  paintP5(g as unknown as Graphics, padDiagramDL(mode, t, BOX.w, BOX.h));
  return `<svg width="${Math.round(BOX.w * ZOOM)}" height="${Math.round(BOX.h * ZOOM)}" `
    + `viewBox="0 0 ${BOX.w} ${BOX.h}" xmlns="http://www.w3.org/2000/svg">`
    + `<g transform="translate(${BOX.w / 2},${BOX.h / 2}) scale(1,-1)">`
    + opsToSvg((g as unknown as StubGraphics).ops)
    + `</g></svg>`;
}

const cells = PICKS.map(([mode, t, label]) =>
  `<div class="c"><div class="cap">${label}</div>${cell(mode, t)}</div>`).join("");

const html = `<!doctype html><meta charset="utf-8"><title>移动方式</title>
<style>
body{margin:0;background:${C.ink};font:0/0 a}
.row{display:flex;gap:14px;padding:14px}
.c{position:relative}
.cap{position:absolute;left:0;top:0;z-index:2;background:${C.acid};color:${C.ink};
 font:900 15px/1 -apple-system,"PingFang SC",sans-serif;letter-spacing:.1em;padding:6px 14px;
 transform:skewX(-10deg)}
svg{display:block}
</style>
<div class="row">${cells}</div>
`;

const outDir = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/site-pad-diagram";
})();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "pad.html"), html);
console.log(`✓ 出图 ${join(outDir, "pad.html")}(三档各一格,无标定读数)`);
