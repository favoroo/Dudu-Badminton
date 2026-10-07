// ============================================================
// 技能演示出图 —— 把弹窗里那块图示在 node 里逐帧画出来看。
//
// 为什么必须有它:这一屏的验收标准是「教的和判的是同一件事」,而那句话肉眼只有一半
// 能看出来(另一半是"看起来挺像")。所以这里两件事一起做:
//   ① 断言:每款技能的烘焙必须**真兑现**(按下当帧进了状态、命中事件的 skillKind 就是它、
//      标注里的数字与 CFG 逐字相同)—— 跑不出兑现就是烘焙失败,直接判红;
//   ② 出图:把每款的分步锚帧画成 SVG 接触表,人眼看构图与"这一步在说什么"。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/skill-demo-preview.js [--out DIR] [--dump]
//     --dump  只打印烘焙读数(局面跑不通时先看这个)
// 产物:DIR/skill-demo.html(七款 × 四步)+ DIR/<id>-<step>.svg
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import { installCc } from "./cc-stub";
installCc();

import { CFG } from "../assets/scripts/core/config";
import { Skills } from "../assets/scripts/core/skills";
import { SkillDemo } from "../assets/scripts/core/skill-demo";
import type { SkillDemoBake } from "../assets/scripts/core/skill-demo";
import { SkillId } from "../assets/scripts/core/types";
import { SD, SK } from "../assets/scripts/ui/skill-layout";
import { skillDiagramDL, SKD } from "../assets/scripts/ui/skill-diagram";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import type { Graphics } from "cc";
import { drawBevelSlot, paintP5 } from "../assets/scripts/ui/p5-paint";
import { C, SLANT } from "../assets/scripts/ui/p5-tokens";

const fs = require("fs") as typeof import("fs");
const argv = process.argv.slice(2);
const OUT = argv[argv.indexOf("--out") + 1] || ".tools-build/skill-demo-preview";
const DUMP = argv.indexOf("--dump") >= 0;
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const rows: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) fails++;
  rows.push(`  ${ok ? "✓" : "✗"} ${name.padEnd(30)} ${detail}`);
};

const ids = Skills.allSkills().map((s) => s.id);

for (const id of ids) {
  const b = SkillDemo.bake(id);
  if (!b) {
    check(`${id} 烘焙`, false, "跑不出兑现:局面摆不出这一拍(演示宁可不画,也不画假的)");
    continue;
  }
  const cast = b.frames[b.cast];
  const hit = b.frames[b.hit];
  const byClone = id === "shadow";
  check(`${id} 兑现`, b.hit > b.cast, `按下第 ${b.cast} 帧 → 第 ${b.hit} 帧出球(kind=${hit.kind} 循环 ${b.loop} 帧)`);
  check(`${id} 那一拍归这款技能`, byClone ? hit.byClone : hit.bySkill,
    byClone ? "影分身的兑现 = 分身接的那一拍(它不进 skillKind)" : `skillKind=${hit.bySkill ? id : "不是 " + id}`);
  check(`${id} 按下当帧真进了状态`, cast.cd > 0 || cast.buffT > 0 || cast.clones.length > 0
    || cast.flashHoldT > 0 || cast.focusT > 0 || cast.lungeT >= 0 || !!cast.flashFrom,
    `cd=${cast.cd} buffT=${cast.buffT} lungeT=${cast.lungeT} clones=${cast.clones.length}`);
  check(`${id} 分步四段`, b.steps.length === 4, b.steps.map((s) => s.name).join(" / "));
  check(`${id} 锚帧都在片子里`, b.steps.every((s) => s.frame >= 0 && s.frame < b.loop),
    b.steps.map((s) => s.frame).join(","));
  check(`${id} 步序不倒着走`, b.steps.every((s, i) => i === 0 || s.frame >= b.steps[i - 1].frame),
    b.steps.map((s) => s.frame).join(" → "));
  if (DUMP) {
    console.log(`\n[${id}] cast=${b.cast} hit=${b.hit} loop=${b.loop} view=${b.view.x0.toFixed(0)}..${b.view.x1.toFixed(0)}`);
    for (const s of b.steps) console.log(`   @${String(s.frame).padStart(3)} ${s.name} — ${s.text}`);
    const marks = [0, b.cast, b.cast + 6, b.hit, b.hit + 20, b.loop - 1];
    for (const f of marks) {
      const sn = b.frames[Math.min(b.loop - 1, Math.max(0, Math.round(f)))];
      console.log(`   f${String(sn.t).padStart(3)} 人 x=${sn.x.toFixed(0)} y=${sn.y.toFixed(0)} swing=${sn.swingT.toFixed(1)}`
        + ` 球 ${sn.ball ? `(${sn.ball.x.toFixed(0)},${sn.ball.y.toFixed(0)}) v=${Math.hypot(sn.ball.vx, sn.ball.vy).toFixed(1)}` : "—"}`
        + ` cd=${sn.cd} buff=${sn.buffT} auto=${sn.autoT} clones=${sn.clones.length}${sn.hit ? " ★HIT" : ""}`);
    }
  }
}

// 标注里的数字必须与 CFG 逐字同源(演示不许自己写一个"约 0.8 秒")
const txt = (b: SkillDemoBake): string => b.steps.map((s) => s.text).join(" ");
const numChecks: [SkillId, string, string][] = [
  ["lunge", `${CFG.lunge.speed * CFG.lunge.duration}`, "跨步位移 px"],
  ["lunge", `${CFG.lunge.reachMul}`, "跨步判定区倍率"],
  ["smash", `${CFG.skills.smash.autoWindow}`, "重击代拍窗帧数"],
  ["flash", `${CFG.skills.flash.minHeight}`, "闪现门槛高度"],
  ["flash", `${CFG.skills.flash.holdFrames}`, "闪现悬空帧数"],
  ["magnet", `${CFG.skills.magnet.pullFrames}`, "吸球牵引帧数"],
  ["focus", `${Math.round(CFG.skills.focus.ballSlow * 100)}%`, "领域球速百分比"],
  ["shadow", `${CFG.skills.shadow.maxHits}`, "分身接球额度"],
  ["rage", `${CFG.skills.rage.bothMul * CFG.skills.rage.perHit}`, "又准又杀单拍增益"],
];
const baked = new Map<SkillId, SkillDemoBake | null>();
for (const [id, needle, label] of numChecks) {
  if (!baked.has(id)) baked.set(id, SkillDemo.bake(id));
  const b = baked.get(id);
  if (!b) continue;
  check(`${label}上了字`, txt(b).indexOf(needle) >= 0,
    `标注里要含 ${needle}`);
}

// ---------- 出图:同一批多边形,两种盒子 ----------

/** 一格:凹陷槽底 + 图示本体(与真机同一批多边形、同一个盒子尺寸) */
function cell(id: SkillId, t: number, w: number, h: number, zoom: number): { svg: string; strokes: number } {
  const g = new StubGraphics();
  drawBevelSlot(g as unknown as Graphics, w, h, SLANT.block, C.ink);
  paintP5(g as unknown as Graphics, skillDiagramDL(id, t, w, h));
  const strokes = (g as unknown as StubGraphics).ops.length;
  const svg = `<svg width="${Math.round(w * zoom)}" height="${Math.round(h * zoom)}" `
    + `viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`
    + `<g transform="translate(${w / 2},${h / 2}) scale(1,-1)">${opsToSvg((g as unknown as StubGraphics).ops)}</g></svg>`;
  return { svg, strokes };
}

let worstStrokes = 0;
const sections: string[] = [];
for (const id of ids) {
  const b = SkillDemo.bake(id);
  if (!b) continue;
  const def = Skills.defOf(id);
  const rows: string[] = [];
  b.steps.forEach((s, i) => {
    const mini = cell(id, s.frame, SK.demoW, SK.demoH, 2.4);
    const big = cell(id, s.frame, SD.canvasW, SD.canvasH, 1.25);
    worstStrokes = Math.max(worstStrokes, big.strokes);
    fs.writeFileSync(`${OUT}/${id}-${i + 1}.svg`, big.svg);
    rows.push(
      `<div class="c"><b>${i + 1} · ${s.name}</b>${big.svg}`
      + `<i>第 ${s.frame} 帧 · ${big.strokes} 笔 · 按下第 ${b.cast} 帧 / 兑现第 ${b.hit} 帧</i>`
      + `<p>${s.text}</p><div class="m">${mini.svg}<i>弹窗里那格 ${SK.demoW}×${SK.demoH}(${mini.strokes} 笔)</i></div></div>`,
    );
  });
  sections.push(`<h2>${def.shortName} · ${def.name}<span>取景 ${SKD.x1 - SKD.x0}×${SKD.above + SKD.below} 世界像素</span></h2><div class="row">${rows.join("")}</div>`);
  // 每款单独一份:整页一张图太高,截图会被缩到看不清笔画
  fs.writeFileSync(`${OUT}/${id}.html`,
    `<!doctype html><meta charset="utf-8"><style>body{margin:10px;background:${C.ink};color:${C.paper};font:12px/1.45 -apple-system,"PingFang SC",sans-serif}`
    + `.row{display:flex;gap:10px}.c i{display:block;font-style:normal;color:${C.dim};margin:3px 0}p{margin:4px 0 0;color:${C.paperDim}}</style>`
    + `<h2 style="margin:0 0 8px;font-size:14px;color:${C.acid}">${def.shortName} · ${def.name}</h2><div class="row">${rows.join("")}</div>`);
}

const html = `<!doctype html><meta charset="utf-8"><title>技能演示图示</title>
<style>
body{margin:18px;background:${C.ink};color:${C.paper};font:13px/1.5 -apple-system,"PingFang SC",sans-serif}
h1{font-size:19px;margin:0 0 6px}h2{margin:18px 0 8px;font-size:15px;color:${C.acid}}
h2 span{font-size:11px;color:${C.dim};font-weight:400;margin-left:8px}
.row{display:flex;flex-wrap:wrap;gap:12px}
.c{width:${Math.round(SD.canvasW * 1.25)}px;background:${C.navy};border:1px solid ${C.line};border-radius:8px;padding:8px}
.c b{display:block;font-size:12px;margin-bottom:4px}
.c i{display:block;font-style:normal;font-size:11px;color:${C.dim};margin:4px 0}
.c p{margin:6px 0 0;font-size:12px;color:${C.paperDim}}
.m{display:flex;gap:6px;align-items:flex-end}
.m i{max-width:60px}
pre{margin-top:18px;font-size:12px}
</style>
<h1>技能演示图示 —— ${ids.length} 款 × 4 步(上=放大窗画布,下=弹窗里那格)</h1>
${sections.join("")}
<pre>${rows.join("\n")}</pre>`;
fs.writeFileSync(`${OUT}/skill-demo.html`, html);
check("每帧笔画在预算内", worstStrokes <= SKD.strokeBudget, `最重一帧 ${worstStrokes} 笔 <= ${SKD.strokeBudget}`);
// 烘焙跑过一轮之后,任何一帧都不该出现 NaN 坐标(取模、倒推残影、折线插值都在这一步被验)
let nan = 0;
for (const id of ids) {
  const b = SkillDemo.bake(id);
  if (!b) continue;
  for (let t = 0; t < b.loop; t++) {
    for (const p of skillDiagramDL(id, t, SD.canvasW, SD.canvasH)) {
      if (p.kind === "dot") { if (!Number.isFinite(p.cx) || !Number.isFinite(p.cy)) nan++; continue; }
      for (const [x, y] of p.pts) if (!Number.isFinite(x) || !Number.isFinite(y)) nan++;
    }
  }
}
check("逐帧零非法坐标", nan === 0, `${nan} 个 NaN/Infinity 坐标`);
console.log(`\n出图 ${OUT}/skill-demo.html(最重一帧 ${worstStrokes} 笔)`);
console.log(fails === 0 ? "全部通过 ✓" : `\n${fails} 项失败 ✗`);
process.exit(fails === 0 ? 0 : 1);
