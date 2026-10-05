// ============================================================
// 移动方式图示出图 —— 把「切到摇杆/滑轨/按键时右边那一格在演什么」摊成一张能盯的接触印相。
//
// 为什么必须出图:这是一次**观感**交付(用户的原话是「只有文字不太直观」),而断言只能证明
// 「不出框、不 NaN、三档不一样、滑轨真的 1:1」,证明不了「一眼看得懂」。本工程的构建产物在
// 内置浏览器里永久 hang(AGENTS.md 坑 2),真机来回一次的成本远高于在 node 里画一遍。
//
// 与 panel-preview 同一立场:**笔画不是复刻的** —— 这里画的就是 assets/scripts/ui/pad-diagram.ts
// 出的那批多边形,经 p5-paint 的 paintP5 落到记录型 Graphics 上。预览跑偏而真机没跑偏不会发生;
// 反过来,图上一眼看出来的毛病(人物被键挡住、箭头太淡)改的就是真机上那一格。
//
// 五帧 × 三档:走左 / 走右 / 起跳手势 / 腾空 / 收势。腾空那帧要看的是「影子有没有变小变淡」,
// 收势那帧要看的是「手指淡出之后画面还成不成立」。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/pad-diagram-preview.js --out .tools-build/pad-diagram-preview
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
//     --screenshot=.tools-build/pad-diagram-preview/sheet.png --window-size=1420,1180 \
//     --hide-scrollbars "file://$PWD/.tools-build/pad-diagram-preview/pad-diagram.html"
// ============================================================
import "./cc-stub";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Graphics } from "cc";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { C, ROLE, SLANT } from "../assets/scripts/ui/p5-tokens";
import { drawBevelSlot, paintP5 } from "../assets/scripts/ui/p5-paint";
import { SET, controlLayout } from "../assets/scripts/ui/settings-layout";
import { DIAG, beatOf, padDiagramDL } from "../assets/scripts/ui/pad-diagram";
import type { MoveMode } from "../assets/scripts/core/settings";

const K = controlLayout();
const BOX = { w: K.diagram.right - K.diagram.left, h: K.diagram.h };
const ZOOM = 2.2;

const MODES: Array<[MoveMode, string]> = [["joystick", "摇杆"], ["slider", "滑轨"], ["buttons", "按键"]];
const FRAMES: Array<[number, string]> = [
  [40, "① 往底线走"],
  [112, "② 往网前走"],
  [245, "③ 越过起跳判定"],
  [263, "④ 腾空(顶点附近)"],
  [292, "⑤ 收势:手指淡出"],
];

/** 一格:凹陷槽底 + 图示本体(与真机同一批多边形、同一个盒子尺寸) */
function cell(mode: MoveMode, t: number): { svg: string; strokes: number } {
  const g = new StubGraphics();
  drawBevelSlot(g as unknown as Graphics, BOX.w, BOX.h, SLANT.block, C.ink);
  paintP5(g as unknown as Graphics, padDiagramDL(mode, t, BOX.w, BOX.h));
  const strokes = (g as unknown as StubGraphics).ops.length;
  return {
    svg: `<svg width="${Math.round(BOX.w * ZOOM)}" height="${Math.round(BOX.h * ZOOM)}" `
      + `viewBox="0 0 ${BOX.w} ${BOX.h}" xmlns="http://www.w3.org/2000/svg">`
      + `<g transform="translate(${BOX.w / 2},${BOX.h / 2}) scale(1,-1)">${opsToSvg((g as unknown as StubGraphics).ops)}</g></svg>`,
    strokes,
  };
}

const sections: string[] = [];
let worst = 0;
for (const [mode, label] of MODES) {
  const cells = FRAMES.map(([t, cap]) => {
    const c = cell(mode, t);
    worst = Math.max(worst, c.strokes);
    const b = beatOf(mode, t);
    return `<div class="c"><b>${cap}</b>${c.svg}`
      + `<i>${c.strokes} 笔 · 人物 x ${b.personX.toFixed(0)} · 离地 ${b.hop.toFixed(0)}</i></div>`;
  }).join("");
  sections.push(`<h2>${label}</h2><div class="row">${cells}</div>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>移动方式图示</title>
<style>
body{margin:18px;background:#07070d;color:${C.paper};font:13px/1.5 -apple-system,"PingFang SC",sans-serif}
h1{font-size:19px;margin:0 0 6px}h2{margin:16px 0 6px;font-size:14px;color:${ROLE.star.face}}
p{max-width:1120px;color:${C.paperDim}}
.row{display:flex;flex-wrap:wrap;gap:12px}
.c{width:${Math.round(BOX.w * ZOOM)}px}
.c b{display:block;font-weight:600;font-size:12px;opacity:.8;margin-bottom:3px}
.c i{display:block;font-style:normal;font-size:11px;opacity:.55;margin-top:3px}
svg{display:block}
</style>
<h1>移动方式图示 —— 三档 × 五帧(${BOX.w}×${BOX.h} 图示盒,${ZOOM}× 放大看细节)</h1>
<p>这一格在设置页「操控」的右半边,切哪档就演哪档。几何不吃装饰:底圈圆心与半径来自
JOYSTICK_BASE、三颗键的三角摆位来自 PAD_BASE、轨的行程与刻度来自 railGeo()(它自己从 CFG.court 算)、
起跳判定线来自 CFG.stickJump.upHi、腾空曲线是 CFG.player.jumpV/gravity 的真实抛物线。
人物身后的重影是同一拍倒推 10/21/33 帧的位置 —— 按键档等距(全速、松开即停),摇杆档由密到疏
(缓入缓出、松手还要多滑一小截),滑轨档滑块与人物始终在同一条竖线上(手指在哪人就在哪)。</p>
${sections.join("\n")}
`;

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/pad-diagram-preview";
})();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "pad-diagram.html"), html);
console.log(`✓ 出图 ${OUT}/pad-diagram.html —— 盒 ${BOX.w}×${BOX.h},最忙一帧 ${worst} 笔,循环 ${DIAG.loop} 帧`);
