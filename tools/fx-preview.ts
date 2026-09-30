// ============================================================
// 特效预览 —— 在 node 里把「羽毛球本体 / 飞行丝带 / 击打粒子」画成 SVG 看。
//
// 为什么需要它:这一轮改的全是观感(裙摆拆片、拖尾从同心圆换成锥形丝带、
// 粒子按速度成形、缓动曲线)。观感改动必须**看得见**才算验收,而本工程
// 的构建产物在内置浏览器里永久 hang、真实浏览器又要起编辑器预览,
// 来回一次的成本远高于把 Graphics 换成"记录每一笔画"的替身直接出图
// (pose-preview 早已验证这条路可行,手法完全一致)。
//
// 三张表:
//  A 球体 —— 每一档在真实物理弹道上取 4 帧,看滞后角过冲、翻滚、裙摆炸开与回弹;
//  B 丝带 —— 扣杀/高远/搓球/发球四种球各飞一遍,看距离采样后的尾迹疏密与形态差异;
//  C 击打 —— smash/sweet/miniSpark 各取第 0/5/12 帧,看粒子成形与缓动。
//
// 断言不是装饰,都是能在真机上变成"看不见东西"的那类事故:
//  坐标出现 NaN/Infinity(Graphics 吃到就是整条笔画静默消失)、丝带点数超上限、
//  粒子峰值超过 MAX_P、球体笔画数掉了(拆片没生效)、滞后角根本没追踪(写死回硬对齐)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/fx-preview.js            # 出图 + 断言,有失败则 exit 1
//   node .tools-build/tools/fx-preview.js --out DIR  # 换输出目录
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import { installCc, Graphics as StubGraphics, StubOp, opsToSvg } from "./cc-stub";
import { drawShuttle, Viewport } from "../assets/scripts/render/sprites";
import { FXSystem } from "../assets/scripts/render/fx";
import { Ribbon } from "../assets/scripts/render/ribbon";
import {
  advanceShuttle, makeShuttleMotion, shuttleImpact,
  TIER_NORMAL, TIER_SWEET, TIER_SMASH, TIER_SWEET_SMASH, TIER_FIRE,
} from "../assets/scripts/render/shuttle-motion";
import { CFG } from "../assets/scripts/core/config";
import { Physics } from "../assets/scripts/core/physics";
import { approach } from "../assets/scripts/core/utils";
import { Ball, ShotKind, ShotResult, SkinDef } from "../assets/scripts/core/types";

installCc();

const C = CFG;
const F = C.fx;

/** 与 world.makeViewport 同一变换:世界(canvas 惯例 y 向下)→ Graphics(y 向上) */
const VP: Viewport = {
  x: (wx: number) => wx - C.world.w / 2,
  y: (wy: number) => C.world.h / 2 - wy,
};

// ---------- 最小可用实体(Ball 不许加必填字段,这里手搓一份只读快照) ----------

function mkShot(kind: ShotKind, sweet: boolean, perfect: boolean, heat: number,
  vx: number, vy: number): ShotResult {
  return {
    kind, q: perfect ? 0.98 : sweet ? 0.9 : 0.6, sweet, perfect,
    depth: 0.8, vx, vy, power: 1, deg: 0, landX: 700, steps: 60,
    intoNet: false, contactX: 300, contactY: 200,
    hitter: null as unknown as ShotResult["hitter"],
    heat,
  };
}

function mkBall(kind: ShotKind, vx: number, vy: number, x: number, y: number,
  sweet = false, perfect = false, heat = 0): Ball {
  return {
    x, y, px: x, py: y, vx, vy,
    live: true, held: false, owner: null, lastHitter: "left",
    crossed: false, netted: false,
    shot: mkShot(kind, sweet, perfect, heat, vx, vy),
    sq: 1, sqPrev: 1,
  };
}

/** 一帧 = 物理推一步 + sq 恢复 + 丝带老化 + 球体运动学(与 game 主循环同序) */
function simStep(b: Ball, ribbon: Ribbon, m: ReturnType<typeof makeShuttleMotion>): void {
  Physics.step(b);
  b.sqPrev = b.sq;
  b.sq = approach(b.sq, 1, F.ballSquashRecovery || 0.15);
  ribbon.sample(b.x, b.y, Math.hypot(b.vx, b.vy));
  ribbon.step();
  advanceShuttle(m, b.vx, b.vy, b.sq, 1);
}

/** 替身 Graphics → 渲染函数期望的 cc.Graphics(与 pose-preview 同一手法) */
type Gfx = Parameters<typeof drawShuttle>[0];
const asGfx = (g: StubGraphics): Gfx => g as unknown as Gfx;

// ---------- 出图 ----------

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/fx-preview";
})();
const fs = require("fs") as typeof import("fs");
fs.mkdirSync(OUT, { recursive: true });

const SCALE = 1.0;   // 世界就是 960×540:1:1 出图,不裁边
function svg(ops: StubOp[], title: string, w = C.world.w, h = C.world.h): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<title>${title}</title>
<rect width="100%" height="100%" fill="#101523"/>
<g transform="translate(${w / 2},${h / 2}) scale(${SCALE},${-SCALE})">${opsToSvg(ops)}
</g></svg>`;
}

let fails = 0;
const rows: string[] = [];
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) fails++;
  rows.push(`  ${ok ? "✓" : "✗"} ${name.padEnd(24)} ${detail}`);
}

/** 遍历所有笔画坐标找 NaN / Infinity:Graphics 吃到非法值 = 整条笔画在真机上静默消失 */
function badCoords(ops: StubOp[]): number {
  let n = 0;
  for (const op of ops) {
    for (const c of op.cmds) {
      for (const key of ["x", "y", "cx", "cy", "rx", "ry", "w", "h", "dx", "dy"] as const) {
        const v = c[key];
        if (v !== undefined && !Number.isFinite(v)) n++;
      }
    }
    if (!Number.isFinite(op.width)) n++;
  }
  return n;
}

// ============================================================
// A 表:球体四相位(命中瞬间 → 飞行中 → 减速 → 变向)
// ============================================================
const TIERS: { name: string; tier: number; kind: ShotKind; sweet: boolean; perfect: boolean; heat: number; vx: number; vy: number }[] = [
  { name: "普通", tier: TIER_NORMAL, kind: "drive", sweet: false, perfect: false, heat: 0, vx: 7, vy: -5 },
  { name: "甜区", tier: TIER_SWEET, kind: "drive", sweet: true, perfect: false, heat: 0, vx: 8, vy: -5 },
  { name: "扣杀", tier: TIER_SMASH, kind: "smash", sweet: false, perfect: false, heat: 0, vx: 15, vy: 7 },
  { name: "甜蜜重扣", tier: TIER_SWEET_SMASH, kind: "smash", sweet: true, perfect: false, heat: 0, vx: 17, vy: 8 },
  { name: "连击火热", tier: TIER_FIRE, kind: "smash", sweet: true, perfect: true, heat: 4, vx: 18, vy: 9 },
];
const POSE_AT = [0, 5, 16, 34];
const shuttleSheet: { name: string; svg: string }[] = [];
let shuttleFills = Infinity;
let laggedFrames = 0;

for (const t of TIERS) {
  const m = makeShuttleMotion();
  const b = mkBall(t.kind, t.vx, t.vy, 300, 180, t.sweet, t.perfect, t.heat);
  // 命中:档位 + 强度(与 game-root 喂 world.shuttleHit 的口径一致)
  shuttleImpact(m, t.tier, t.perfect ? 1 : t.sweet ? 0.85 : 0.6, t.heat);
  const opsList: StubOp[][] = [];
  for (let f = 0; f <= POSE_AT[POSE_AT.length - 1]; f++) {
    if (f > 0) {
      // 球体表不需要丝带,用一个空 Ribbon 走同一套步进
      simStep(b, new Ribbon(), m);
      // 第 16 帧制造一次"变向":模拟被对面抽回去,检验滞后角是否真的过冲
      if (f === 16) { b.vx = -9; b.vy = -4; shuttleImpact(m, t.tier, 0.8, t.heat); }
    }
    if (POSE_AT.indexOf(f) >= 0) {
      const gx = new StubGraphics();
      drawShuttle(asGfx(gx), VP, { ...b, sqR: b.sq } as Ball, null, 0, m);
      opsList.push(gx.ops);
      const fills = gx.ops.filter((o) => o.kind === "fill").length;
      shuttleFills = Math.min(shuttleFills, fills);
      // 滞后角判据:球头指向与真实速度方向的夹角,追踪中应偶尔 > 0.05 rad
      const real = Math.atan2(b.vy, b.vx);
      const dif = Math.abs(Math.atan2(Math.sin(m.ang - real), Math.cos(m.ang - real)));
      if (dif > 0.05 && Math.hypot(b.vx, b.vy) > 2) laggedFrames++;
    }
  }
  const one = opsList.reduce((acc, o) => acc.concat(o), []);
  const file = `shuttle-${TIERS.indexOf(t)}`;
  fs.writeFileSync(`${OUT}/${file}.svg`, svg(one, `球体 ${t.name}`));
  shuttleSheet.push({ name: t.name, svg: svg(one, `球体 ${t.name}`) });
  check(`球体无非法坐标 ${t.name}`, badCoords(one) === 0, `${one.length} 笔`);
}

// ============================================================
// A2 表:球体特写 —— 整屏 960×540 里球只有 20px,分片羽毛/颤动根本看不出改了什么。
// 用一个"以球为原点"的视口把球放大画出来,才谈得上验收。
// ============================================================
const ZW = 700, ZH = 190, ZX = 480, ZY = 110, ZSCALE = 2.6;
const VZ: Viewport = { x: (wx: number) => wx - ZX, y: (wy: number) => ZY - wy };
function zoomSvg(items: { ops: StubOp[]; dx: number }[], title: string): string {
  const body = items.map((it) =>
    `<g transform="translate(${it.dx},0)">${opsToSvg(it.ops)}</g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ZW}" height="${ZH}" viewBox="0 0 ${ZW} ${ZH}">
<title>${title}</title><rect width="100%" height="100%" fill="#101523"/>
<g transform="translate(${ZW / 2},${ZH / 2}) scale(${ZSCALE},${-ZSCALE})">${body}</g></svg>`;
}
const closeSheet: { name: string; svg: string }[] = [];
for (const t of TIERS) {
  const items: { ops: StubOp[]; dx: number }[] = [];
  const m = makeShuttleMotion();
  const b = mkBall(t.kind, t.vx, t.vy, ZX, ZY, t.sweet, t.perfect, t.heat);
  shuttleImpact(m, t.tier, t.perfect ? 1 : t.sweet ? 0.85 : 0.6, t.heat);
  // 四格:命中第 1 帧 / 第 4 帧 / 第 12 帧 / 变向后第 3 帧
  for (let k = 0; k < 4; k++) {
    if (k === 3) { b.vx = -t.vx * 0.7; b.vy = -3; shuttleImpact(m, t.tier, 0.9, t.heat); }
    const gx = new StubGraphics();
    drawShuttle(asGfx(gx), VZ, { ...b, sqR: b.sq } as Ball, null, 0, m);
    items.push({ ops: gx.ops, dx: -105 + k * 70 });
    for (let s = 0; s < (k === 3 ? 1 : k === 1 ? 3 : 8); s++) {
      simStep(b, new Ribbon(), m);
      b.x = ZX; b.y = ZY;               // 特写只看姿态,把球钉回原点
    }
  }
  const name = `特写 ${t.name}`;
  const file = `shuttle-zoom-${TIERS.indexOf(t)}`;
  fs.writeFileSync(`${OUT}/${file}.svg`, zoomSvg(items, name));
  closeSheet.push({ name, svg: zoomSvg(items, name) });
}

// ============================================================
// B 表:丝带 —— 四种球各飞一遍,比较尾迹
// ============================================================
const FLIGHTS: { name: string; kind: ShotKind; vx: number; vy: number; x: number; y: number; tier: number; sweet: boolean; heat: number }[] = [
  { name: "smash", kind: "smash", vx: 18, vy: 9, x: 300, y: 150, tier: TIER_SMASH, sweet: false, heat: 0 },
  { name: "clear", kind: "clear", vx: 8, vy: -12, x: 260, y: 300, tier: TIER_NORMAL, sweet: false, heat: 0 },
  { name: "drop", kind: "netshot", vx: 4.2, vy: -2.4, x: 420, y: 230, tier: TIER_NORMAL, sweet: false, heat: 0 },
  { name: "fire", kind: "smash", vx: 19, vy: 10, x: 300, y: 140, tier: TIER_FIRE, sweet: true, heat: 4 },
];
const trailSheet: { name: string; svg: string }[] = [];
const ribbonLens: Record<string, number> = {};
let ribbonMaxPts = 0;

for (const fl of FLIGHTS) {
  const ribbon = new Ribbon();
  const m = makeShuttleMotion();
  const b = mkBall(fl.kind, fl.vx, fl.vy, fl.x, fl.y, fl.sweet, fl.heat > 0, fl.heat);
  ribbon.stamp(b.shot);
  shuttleImpact(m, fl.tier, 1, fl.heat);
  const g = new StubGraphics();
  let maxPts = 0;
  // 飞到落地线或 90 帧为止
  for (let f = 0; f < 90 && b.y < C.court.groundY - 2; f++) {
    simStep(b, ribbon, m);
    ribbon.stamp(b.shot);
    maxPts = Math.max(maxPts, ribbon.pts.length);
  }
  // 只画**最后一个时刻**:叠画多个时刻会把每一帧的"头部"混在一起,看不出收尖方向
  ribbon.draw(asGfx(g), VP, null);
  drawShuttle(asGfx(g), VP, { ...b, sqR: b.sq } as Ball, null, 0, m);
  ribbonMaxPts = Math.max(ribbonMaxPts, maxPts);
  // 尾迹"实际还剩多少点":最后一次绘制时的点数,代表玩家看到的尾长
  ribbonLens[fl.name] = ribbon.pts.length;
  const file = `trail-${fl.name}`;
  fs.writeFileSync(`${OUT}/${file}.svg`, svg(g.ops, `丝带 ${fl.name}`));
  trailSheet.push({ name: fl.name, svg: svg(g.ops, `丝带 ${fl.name}`) });
  check(`丝带无非法坐标 ${fl.name}`, badCoords(g.ops) === 0, `${g.ops.length} 笔,非法 0`);
}

// 球种差异必须看得见:扣杀尾迹的点数/路径显著多于搓球(旧同心圆版两者长得一样)
check("球种分形", (ribbonLens["smash"] || 0) > 0 && (ribbonLens["drop"] || 0) < (ribbonLens["smash"] || 0),
  `smash ${ribbonLens["smash"]} 点 > drop ${ribbonLens["drop"]} 点`);
check("点数上限", ribbonMaxPts <= (F.trailMax || 56), `峰值 ${ribbonMaxPts} ≤ ${F.trailMax || 56}`);

// 设计款球皮的残影风格必须在丝带上活下来(旧版是四套同心圆,现在只换配色与头部形状)
const STYLES: NonNullable<SkinDef["trailStyle"]>[] = ["star", "flame", "petal", "rainbow"];
for (const st of STYLES) {
  const ribbon = new Ribbon();
  const m = makeShuttleMotion();
  const b = mkBall("smash", 18, 9, 300, 150, true, false, 0);
  ribbon.stamp(b.shot);
  shuttleImpact(m, TIER_SMASH, 1, 0);
  const g = new StubGraphics();
  for (let f = 0; f < 46 && b.y < C.court.groundY - 2; f++) simStep(b, ribbon, m);
  ribbon.draw(asGfx(g), VP, st);
  drawShuttle(asGfx(g), VP, { ...b, sqR: b.sq } as Ball, null, 0, m);
  fs.writeFileSync(`${OUT}/trail-style-${st}.svg`, svg(g.ops, `丝带风格 ${st}`));
  trailSheet.push({ name: `style:${st}`, svg: svg(g.ops, `丝带风格 ${st}`) });
  check(`皮肤残影 ${st}`, badCoords(g.ops) === 0 && g.ops.length > 8, `${g.ops.length} 笔`);
}

// ============================================================
// C 表:击打粒子(smash / sweet / miniSpark 各三帧)
// ============================================================
const impactSheet: { name: string; svg: string }[] = [];
let peakParticles = 0;
/** 三个时刻并排(而不是叠在一张里):叠画看不出"第 5 帧到底还剩什么" */
function stripSvg(items: { ops: StubOp[]; dx: number }[], title: string): string {
  const W = 1020, H = 440, SC = 0.75;
  const body = items.map((it) => `<g transform="translate(${it.dx},0)">${opsToSvg(it.ops)}</g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<title>${title}</title><rect width="100%" height="100%" fill="#101523"/>
<g transform="translate(${W / 2},${H / 2}) scale(${SC},${-SC})">
<line x1="-600" y1="0" x2="600" y2="0" stroke="#233" stroke-width="0.5"/>
${body}</g></svg>`;
}
for (const spec of [
  { name: "smash", run: (fx: FXSystem) => fx.smash(480, 210, 0.6, TIER_SMASH) },
  { name: "sweet-smash", run: (fx: FXSystem) => fx.smash(480, 210, 0.6, TIER_SWEET_SMASH) },
  { name: "sweet", run: (fx: FXSystem) => fx.sweet(480, 210, 0.6) },
  { name: "mini", run: (fx: FXSystem) => fx.miniSpark(480, 210, 0.6) },
]) {
  const fx = new FXSystem();
  spec.run(fx);
  const items: { ops: StubOp[]; dx: number }[] = [];
  const AT = [0, 5, 12];
  for (let f = 0; f <= 20; f++) {
    if (AT.indexOf(f) >= 0) {
      const gg = new StubGraphics();
      fx.draw(asGfx(gg), VP);
      items.push({ ops: gg.ops, dx: (AT.indexOf(f) - 1) * 420 });
      peakParticles = Math.max(peakParticles, gg.ops.length);
    }
    fx.step(1 / 60);
  }
  const one = items.reduce<StubOp[]>((acc, o) => acc.concat(o.ops), []);
  const file = `impact-${spec.name.replace(/[^a-z0-9]+/gi, "-")}`;
  fs.writeFileSync(`${OUT}/${file}.svg`, stripSvg(items, `击打 ${spec.name}`));
  impactSheet.push({ name: `${spec.name}(第 0/5/12 帧)`, svg: stripSvg(items, `击打 ${spec.name}`) });
  check(`击打无非法坐标 ${spec.name}`, badCoords(one) === 0, `${one.length} 笔`);
}
check("粒子预算", peakParticles <= 500, `单次峰值笔画 ${peakParticles} ≤ MAX_P 500`);
check("球体拆片生效", shuttleFills >= 12, `每帧最少 ${shuttleFills} 个 fill(老版只有 6 笔)`);
check("滞后角追踪生效", laggedFrames >= 1, `${laggedFrames} 个采样帧球头与速度方向有夹角(硬对齐时恒为 0)`);

// ---------- 汇总 ----------
console.log(`特效预览 —— 输出目录 ${OUT}/`);
console.log(rows.join("\n"));
console.log(`\n${fails === 0 ? "全部通过 ✓" : `${fails} 项失败 ✗`}`);

const html = `<!doctype html><meta charset="utf-8"><title>fx preview</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:24px}
h2{margin-top:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:14px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:8px;text-align:center}
.c b{display:block;margin-bottom:6px;font-weight:600}
.c svg{max-width:500px;height:auto}
pre{white-space:pre-wrap}</style>
<h1>嘟嘟羽毛球 —— 击打/轨迹/球体特效预览</h1>
<pre>${rows.join("\n")}</pre>
<h2>A 球体:每一档取命中后 0/5/16/34 帧(第 16 帧造一次变向,看滞后角过冲)</h2>
<div class="grid">${shuttleSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}</div>
<h2>A2 球体特写(×7):每档四格 = 命中第 1 帧 / 第 4 帧 / 第 12 帧 / 变向后 —— 看分片羽毛、裙摆炸开与回弹</h2>
<div class="grid">${closeSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}</div>
<h2>B 丝带:扣杀 / 高远 / 放网 / 火热 —— 每 22 帧叠画一次,看尾迹疏密与形态</h2>
<div class="grid">${trailSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}</div>
<h2>C 击打:smash / sweet / miniSpark —— 第 0/5/12 帧叠加,看粒子成形与缓动</h2>
<div class="grid">${impactSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}</div>
`;
fs.writeFileSync(`${OUT}/index.html`, html);
// 单独一张"球体特写"页:整页太长时截图会被缩小,验收羽毛分片要看这一张
fs.writeFileSync(`${OUT}/closeups.html`, `<!doctype html><meta charset="utf-8"><title>shuttle closeups</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.6 ui-monospace,Menlo,monospace;margin:18px}
.row{display:flex;flex-wrap:wrap;gap:12px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:6px}
.c b{display:block;margin-bottom:4px}
.c svg{width:600px;height:auto}</style>
<h2>球体特写 ×7:每档四格 = 命中第 1 帧 / 第 4 帧 / 第 12 帧 / 变向后</h2>
<div class="row">${closeSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}</div>
`);
fs.writeFileSync(`${OUT}/impacts.html`, `<!doctype html><meta charset="utf-8"><title>impact closeups</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.6 ui-monospace,Menlo,monospace;margin:18px}
.row{display:flex;flex-wrap:wrap;gap:12px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:6px}
.c b{display:block;margin-bottom:4px}
.c svg{width:980px;height:auto}</style>
<h2>击打粒子:每一档三个时刻并排(第 0 / 5 / 12 帧)</h2>
<div class="row">${impactSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}</div>
`);
fs.writeFileSync(`${OUT}/trails.html`, `<!doctype html><meta charset="utf-8"><title>trail closeups</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.6 ui-monospace,Menlo,monospace;margin:18px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:6px;margin-bottom:12px}
.c b{display:block;margin-bottom:4px}
.c svg{width:960px;height:auto}</style>
<h2>丝带:扣杀 / 高远 / 放网 / 火热 —— 每 22 帧叠画一次(1:1,不裁边)</h2>
${trailSheet.map((s) => `<div class="c"><b>${s.name}</b>${s.svg}</div>`).join("")}
`);
console.log(`预览页: ${OUT}/index.html  (单页: closeups.html / trails.html / impacts.html)`);
process.exit(fails === 0 ? 0 : 1);
