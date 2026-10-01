// ============================================================
// 球场分层预览 / 静态层一次性断言 —— 验证 court.ts 的三层拆分。
//
// 背景:旧版每渲染帧全量重画整个球场(~900 个图元,其中 200 观众×2 fill、
// LED 点阵 83 格、多段全宽渐变 —— 而真正在动的不到 5%)。现在拆成
//   静态(主题切换时画一次)/ 慢速(观众·跑马灯,每 3 渲染帧)/
//   动态(球网·光束·微尘,每帧)三层,由 world.ts 分别画到三支 Graphics 笔上。
//
// 本工具断言的都是「拆分拆错了会直接变成事故」的判据:
//  ① 静态层画一次后,连续多帧不再增长(拆分漏了会在这里露馅 —— 静态块被
//     挪进动态层不会红,但漏进每帧重画就是白拆);
//  ② draw() 合成(供本工具出图的全量画法)的笔画数 = 静态+慢速+动态 三层之和
//     (调度接线错误会在这里红);
//  ③ 所有笔画坐标无 NaN/Infinity(Graphics 吃到就是整条笔画静默消失)。
//  ④ 每帧成本统计:动态层 + 慢速层/3 的图元数,对比旧版全量画法。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/court-preview.js            # 出图 + 断言,有失败则 exit 1
//   node .tools-build/tools/court-preview.js --out DIR  # 换输出目录
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import * as fs from "fs";
import { installCc, Graphics as StubGraphics, opPoints, opsToSvg } from "./cc-stub";
import { courtRenderer } from "../assets/scripts/render/court";
import { CFG } from "../assets/scripts/core/config";

installCc();

const C = CFG;
const W = C.world.w, H = C.world.h;
const EXT_W = 260, BOTTOM_WY = H + 180;   // 与 court.ts 的画布范围一致
type GGfx = Parameters<typeof courtRenderer.drawStaticTo>[0];

/** 与 world.makeViewport 同一变换:世界(canvas 惯例 y 向下)→ Graphics(y 向上) */
const VP = {
  x: (wx: number): number => wx - W / 2,
  y: (wy: number): number => H / 2 - wy,
};

const THEMES = ["arena", "beach", "cyber", "dojo"] as const;
type Theme = (typeof THEMES)[number];

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** 扫出笔画坐标里的 NaN/Infinity */
function badOps(g: StubGraphics): string[] {
  const bad: string[] = [];
  for (const op of g.ops) {
    for (const p of opPoints(op)) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        bad.push(`${op.kind}@(${p.x},${p.y})`);
        break;
      }
    }
  }
  return bad;
}

const asG = (g: StubGraphics): GGfx => g as unknown as GGfx;

// ---------- 主流程 ----------
const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/court-preview";
})();
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const costRows: string[] = [];

for (const theme of THEMES) {
  if (!courtRenderer.setTheme(theme)) fail(`setTheme(${theme}) 被拒`);
  if (courtRenderer.currentThemeId !== theme) fail(`主题未切到 ${theme}`);

  // --- ① 静态层画一次后不再增长 ---
  const stat = new StubGraphics();
  courtRenderer.drawStaticTo(asG(stat), VP);
  const staticOps1 = stat.ops.length;
  const tmp = new StubGraphics();
  for (let f = 0; f < 10; f++) {
    tmp.clear();
    courtRenderer.drawSlowTo(asG(tmp), VP, 6);
    courtRenderer.drawDynTo(asG(tmp), VP, 6);
  }
  if (stat.ops.length !== staticOps1) {
    failures++;
    console.error(`✗ [${theme}] 静态层被每帧重画:1 次后 ${staticOps1} 笔,10 帧后 ${stat.ops.length} 笔`);
  }

  // --- ② draw() 合成 = 三层之和 ---
  const all = new StubGraphics();
  const s = new StubGraphics(), sl = new StubGraphics(), d = new StubGraphics();
  courtRenderer.draw(asG(all), VP, 6);
  courtRenderer.drawStaticTo(asG(s), VP);
  courtRenderer.drawSlowTo(asG(sl), VP, 6);
  courtRenderer.drawDynTo(asG(d), VP, 6);
  if (all.ops.length !== s.ops.length + sl.ops.length + d.ops.length) {
    failures++;
    console.error(`✗ [${theme}] draw() 合成 ${all.ops.length} 笔 ≠ 三层之和 ${s.ops.length}+${sl.ops.length}+${d.ops.length}`);
  }

  // --- ③ NaN 扫描 ---
  for (const [name, g] of [["composite", all], ["static", s], ["slow", sl], ["dyn", d]] as const) {
    const bad = badOps(g);
    if (bad.length) {
      failures++;
      console.error(`✗ [${theme}] ${name} 层出现非有限坐标 ×${bad.length}: ${bad.slice(0, 3).join(" ")}`);
    }
  }

  // --- ④ 成本统计 ---
  const oldPerFrame = all.ops.length;
  const newPerFrame = d.ops.length + sl.ops.length / 3;
  costRows.push(
    `<tr><td>${theme}</td><td>${oldPerFrame}</td><td>${s.ops.length} ×1</td>` +
    `<td>${sl.ops.length} ÷3</td><td>${d.ops.length} ×1</td>` +
    `<td>${newPerFrame.toFixed(0)}</td><td>${(oldPerFrame / newPerFrame).toFixed(1)}×</td></tr>`);

  // --- 出图:整场合成 SVG(世界坐标 y 向下 → SVG y 向上翻转)---
  // gfx_y = H/2 - wy;要 svg_y = wy,则 translate_y = gfx_y + wy = H/2
  const ox = -Math.round(-EXT_W - W / 2), oy = Math.round(H / 2);
  const wpx = Math.round(EXT_W * 2 + W), hpx = Math.round(BOTTOM_WY);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${hpx}" viewBox="0 0 ${wpx} ${hpx}">
<title>court ${theme} (composite of static+slow+dyn)</title>
<g transform="translate(${ox},${oy}) scale(1,-1)">
${opsToSvg(all.ops)}
</g>
</svg>`;
  fs.writeFileSync(`${OUT}/court-${theme}.svg`, svg);
}

fs.writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8">
<title>court-preview</title>
<style>body{font-family:monospace;background:#111;color:#ddd}img{background:#000;display:block;margin:8px 0}td,th{padding:2px 10px;border:1px solid #444}</style>
<h1>球场分层预览(4 主题全量合成)</h1>
<table><tr><th>主题</th><th>旧版每帧</th><th>静态</th><th>慢速</th><th>动态</th><th>新版每帧均摊</th><th>降幅</th></tr>
${costRows.filter((r) => !r.startsWith("<!--")).join("\n")}
</table>
${THEMES.map((t) => `<h2>${t}</h2><img src="court-${t}.svg" width="960">`).join("\n")}
`);

if (failures > 0) {
  console.error(`court-preview: ${failures} 处断言失败`);
  process.exit(1);
}
console.log(`court-preview: 全部断言通过 → ${OUT}`);
