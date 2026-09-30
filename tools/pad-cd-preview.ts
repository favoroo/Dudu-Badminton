// ============================================================
// 技能键冷却读数出图 —— 把「透明度调低之后看不看得清」变成一张能盯的图。
//
// 为什么需要它:这是纯观感改动,而本工程的构建产物在内置浏览器里永久 hang、
// 真机来回一次的成本远高于在 node 里画一遍(手法与 pose-preview / fx-preview 一致:
// 把 cc.Graphics 换成记录每一笔画的替身,直接 dump 成 SVG)。
// 关键点是**笔画不是复刻的**:扇形/进度环/前沿亮点全部由 input/pad-cd.ts 的
// drawCooldown 真画一遍(它只声明用到的 Graphics 成员,所以引擎的 Graphics 和
// 这里的记录型替身吃的是同一份代码)—— 预览跑偏而真机没跑偏这种事不会发生。
// 只有键底那一两笔在 paint() 里,这里照 paint 的取值复述一遍(注释标了出处)。
//
// 六列 × 三档透明度 × 两种背景:就绪 / 起手(cd 100%)/ 70% / 40% / 12% / 旧写法对照。
// 背景挑了亮场沙色与暗场墨色 —— 冷却的墨底在亮场上才压不出对比,那是最坏的一档。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/pad-cd-preview.js --out .tools-build/pad-cd-preview
//   # 想肉眼看:把 SVG 用 headless Chrome 光栅化成 PNG 再看
// ============================================================
import { installCc, Graphics as StubGraphics, Color as StubColor, opsToSvg } from "./cc-stub";
import { CD, cdAlpha, cdText, drawCooldown, skillAccent, type CdPen } from "../assets/scripts/input/pad-cd";
installCc();

import { CFG } from "../assets/scripts/core/config";
import { PAD_BASE } from "../assets/scripts/core/settings";

const S = CFG.padSkin;
const R = PAD_BASE.lunge.r;                 // 基准半径(设计像素,16:9 屏 padScale=1)
const CELL = R * 2 + 34;                    // 每格留一点呼吸
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function mk(hex: string, a: number): StubColor {
  const c = new StubColor(hex);
  c.a = Math.round(clamp01(a) * 255);
  return c;
}

const skillOf = (id: string): { shortName: string; cooldownFrames: number } =>
  CFG.skills.list.find((x) => x.id === id) || CFG.skills.list[0];

/**
 * 引擎语义的 arc:counterclockwise=false 时 da 被规范进 (-2π, 0],
 * 传 a1 > a0 画的是补集(helper.ts 的 `while (da > 0) da -= PI*2`)。
 * 记录型替身不会做这个规范化,所以「旧写法」那一格要手动绕一次,图才诚实。
 */
function ccArc(g: StubGraphics, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const TAU = Math.PI * 2;
  let da = a1 - a0;
  if (Math.abs(da) >= TAU) da = -TAU;
  else while (da > 0) da -= TAU;
  g.arc(cx, cy, r, a0, a0 + da, false);
}

/** 一格里那颗键:键底(照 touchpad.paint 的取值)+ 冷却层(真调 drawCooldown) */
function buttonSvg(alphaSetting: number, cd: number, skillId: string, legacy = false, locked = false): { shapes: string; texts: string } {
  const g = new StubGraphics();
  const cooling = cd > 0;
  const disabled = cooling || locked;          // 锁定 = 冷却中同一套暗底,但不画扇形与秒数(键 icon 还在)
  // 旧写法对照:冷却层每一笔都直接乘滑杆(没有前沿亮点,环只有 2.5 粗)
  const aCd = legacy ? alphaSetting : cdAlpha(alphaSetting);
  const fillHex = disabled ? (legacy ? "#0e121a" : CD.fill) : S.idleFill;
  const fillA = disabled ? (legacy ? 0.45 * alphaSetting : CD.fillA * aCd) : S.idleFillA * alphaSetting;
  const edgeHex = disabled ? (legacy ? "#334155" : CD.edge) : S.idleEdge;
  const edgeA = disabled ? (legacy ? 0.45 * alphaSetting : CD.edgeA * aCd) : S.idleEdgeA * alphaSetting;
  g.clear();
  g.fillColor = mk(fillHex, fillA);
  g.circle(0, 0, R);
  g.fill();
  // 真引擎里 fill() 不清路径(paint 的 circle→fill→stroke 一笔两用),
  // 而记录型替身清,所以键底轮廓在这里补记一次同样的圆。
  g.strokeColor = mk(edgeHex, edgeA);
  g.lineWidth = 3;
  g.circle(0, 0, R);
  g.stroke();
  if (cooling) {
    g.lineCap = "round";
    g.lineJoin = "round";
    if (legacy) {
      // 修好之前那一段的真实笔画(照旧代码逐字搬来 + 手动套一次引擎的角度规范化)
      const top = -Math.PI / 2;
      g.fillColor = mk("#000000", 0.58 * alphaSetting);
      g.moveTo(0, 0);
      ccArc(g, 0, 0, R, top, top + cd * Math.PI * 2);
      g.lineTo(0, 0);
      g.fill();
      g.strokeColor = mk("#38bdf8", 0.85 * alphaSetting);
      g.lineWidth = 2.5;
      ccArc(g, 0, 0, R - 1.5, top + cd * Math.PI * 2, top + Math.PI * 2);
      g.stroke();
    } else {
      drawCooldown(g as unknown as CdPen, (hex, a) => mk(hex, a), R, cd, skillId, alphaSetting);
    }
  }
  const ops = opsToSvg(g.ops);

  // 文字走 SVG <text>,而且必须排在翻转组**外面**:引擎里这两个读数都是 Label
  // (子节点,不跟着 Graphics 的本地坐标翻转),这里同理 —— 局部 y 向上,换成 SVG 的
  // y 向下要自己翻一次,否则数字会飞到格子角上去(第一版就栽在这儿)。
  const fs = Math.max(9, Math.round(R * CD.numK));
  const num = cooling && !legacy ? cdText(cd * skillOf(skillId).cooldownFrames / 60) : "";
  const texts: string[] = [];
  texts.push(`<text x="${CELL / 2}" y="${CELL / 2 + R * 0.62 + S.labelSize * 0.36}" font-size="${S.labelSize}" `
    + `text-anchor="middle" fill="#ffffff" fill-opacity="${clamp01(S.labelA * alphaSetting)}">${skillOf(skillId).shortName}</text>`);
  if (num) {
    texts.push(`<text x="${CELL / 2}" y="${CELL / 2 - CD.numY * R + fs * 0.36}" font-size="${fs}" font-weight="bold" `
      + `text-anchor="middle" fill="#ffffff" stroke="#0a0d18" stroke-width="${CD.numOutline}" paint-order="stroke">${num}</text>`);
  }
  return { shapes: ops, texts: texts.join("\n") };
}

const STATES: { label: string; cd: number; skill: string; legacy?: boolean; locked?: boolean }[] = [
  { label: "就绪", cd: 0, skill: "flash" },
  { label: "锁定(球不够高)", cd: 0, skill: "flash", locked: true },
  { label: "起手 100%", cd: 1, skill: "flash" },
  { label: "70%", cd: 0.7, skill: "flash" },
  { label: "40%", cd: 0.4, skill: "magnet" },
  { label: "12%", cd: 0.12, skill: "smash" },
  { label: "旧写法 70%", cd: 0.7, skill: "flash", legacy: true },
];
const ALPHAS = [1.0, 0.6, 0.2];
const BGS: { name: string; hex: string }[] = [
  { name: "亮场(海滩沙色)", hex: "#d9c9a4" },
  { name: "暗场(墨蓝)", hex: "#1a2033" },
];

let nan = 0;
let minCoolPaths = Infinity;
let minMidPaths = Infinity;
let readyPaths = 0;
const sections: string[] = [];
for (const bg of BGS) {
  let cells = "";
  for (const A of ALPHAS) {
    for (const st of STATES) {
      const one = buttonSvg(A, st.cd, st.skill, !!st.legacy, !!st.locked);
      const body = one.shapes + one.texts;
      nan += (body.match(/NaN/g) || []).length + (body.match(/Infinity/g) || []).length;
      const paths = (one.shapes.match(/<path/g) || []).length;
      if (st.cd > 0) minCoolPaths = Math.min(minCoolPaths, paths);
      else readyPaths = Math.max(readyPaths, paths);
      if (st.cd > 0 && st.cd < 1 && !st.legacy) minMidPaths = Math.min(minMidPaths, paths);
      cells += `<div class="c"><b>滑杆 ${A.toFixed(2)} · ${st.label}</b>`
        + `<svg class="k" viewBox="0 0 ${CELL} ${CELL}" style="background:${bg.hex}">`
        + `<g transform="translate(${CELL / 2},${CELL / 2}) scale(1,-1)">${one.shapes}</g>${one.texts}</svg></div>`;
    }
  }
  sections.push(`<h2>${bg.name}</h2><div class="row">${cells}</div>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>技能键冷却读数</title>
<style>
body{margin:18px;background:#0a0d18;color:#e8edf7;font:13px/1.5 -apple-system,"PingFang SC",sans-serif}
h2{margin:14px 0 6px;font-size:14px;color:#ffe14d}
.row{display:flex;flex-wrap:wrap;gap:10px}
.c{width:152px}
.c b{display:block;font-weight:600;font-size:11px;opacity:.75;margin-bottom:3px}
svg.k{width:150px;height:150px;display:block;border-radius:6px}
</style>
<h1>技能键冷却读数 —— 三种透明度 × 两种背景</h1>
<p>键心底/描边完全跟随透明度滑杆(玩家要淡就淡);扇形、进度环、前沿亮点、键心秒数走 cdAlpha(),滑杆最低时仍留 0.8 以上浓度。最后一列是修好之前的真实笔画,拿来对照。</p>
${sections.join("\n")}
`;

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/pad-cd-preview";
})();
require("fs").mkdirSync(OUT, { recursive: true });
require("fs").writeFileSync(`${OUT}/pad-cd.html`, html);

let bad = 0;
function check(name: string, cond: boolean, detail: string): void {
  console.log(`  ${cond ? "✓" : "✗"} ${name} —— ${detail}`);
  if (!cond) bad++;
}
check("无非法坐标", nan === 0, `${nan} 处 NaN/Infinity`);
check("中段冷却格笔画最多", minMidPaths >= readyPaths + 3,
  `就绪 ${readyPaths} 条 → 冷却中段 ${minMidPaths} 条(键底 + 扇形 + 环 + 前沿)`);
check("起手那一帧不画空环", minCoolPaths >= readyPaths + 1,
  `cd=100% 那格也有 ${minCoolPaths} 条(环长 0 应当整条不画,否则会留一个圆头点)`);
const longest = CFG.skills.list.reduce((a, b) => (b.cooldownFrames > a.cooldownFrames ? b : a));
check("最长那格冷却读得出秒数", cdText(longest.cooldownFrames / 60) !== "",
  `${longest.name} ${longest.cooldownFrames} 帧 → 键心 ${cdText(longest.cooldownFrames / 60)}s`);
check("进度环用技能专属色", skillAccent("magnet") === "#a855f7", `吸球环色 ${skillAccent("magnet")}`);
console.log(`\n${bad === 0 ? "✓" : "✗"} 出图 ${OUT}/pad-cd.html,断言失败 ${bad}`);
process.exit(bad === 0 ? 0 : 1);
