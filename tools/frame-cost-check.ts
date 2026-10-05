// ============================================================
// 每帧渲染成本护栏 —— 把「对局态一帧到底画多少笔」钉成断言。
//
// 背景:两轮性能优化(锁 60 帧 + 球场三层分频 + GC 治理)之后,卡顿的残余来源
// 全是「安静涨回来」型:某个装饰件被挪回每帧重绘、某个分频被人顺手删掉、
// 采样段数被人调大 —— 这些都不会崩、不会 NaN,只会让中低端机慢慢变卡。
// 本工具在 headless 下跑一整段 AI 对 AI 对局,按真实渲染节奏(1 渲染帧/模拟步)
// 驱动可无头驱动的整条绘制路径,统计每帧 fill/stroke 笔数与顶点量:
//   · 球场三层(static 不计 / dyn 每 2 帧 + 晃网强制 / slow 每 3 帧)
//   · 实体层:drawPlayer×2 + drawShuttle + ribbon(每帧)
//   · 特效:fx.step 每模拟步 + fx.draw 每渲染帧,彩带走独立层隔帧重绘
// 断言:稳态帧均值与最忙帧(特效爆发 + 庆祝彩带同帧)都不得超预算 ——
// 预算值 = 优化后水位 × 余量,改动让它变红就说明每帧成本在悄悄回涨。
//
// 测量范围说明:HUD 落点块(hud-overlay)依赖 Node/Label,cc-stub 无此替身,
// 不在本工具覆盖内;它的降频(整块只在积分帧重画)由 draw() 内的门控直接保证。
// hitstop 定格期渲染降频(game-root)同理是主循环一行门控。
//
// --selftest:用「旧写法节奏」重跑同一套测量 —— court-dyn 恢复每帧重绘
// (world.ts 回退分频时的真实形状)。它必须撞红稳态预算:这条钉住两件事 ——
// 预算没被放宽到旧水位之上、分频收益真的存在(哪天有人把分频改没了,
// 正常跑不会红,但 selftest 的旧节奏成本会跌回预算内,一样红)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/frame-cost-check.js
//   node .tools-build/tools/frame-cost-check.js --selftest
//   node .tools-build/tools/frame-cost-check.js --out DIR   # 最忙帧 SVG 出图目录
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import * as fs from "fs";
import { installCc, Graphics as StubGraphics, opPoints, opsToSvg } from "./cc-stub";
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { Player as Pl } from "../assets/scripts/core/player";
import { ShadowGate } from "../assets/scripts/core/shadow-gate";
import { CFG } from "../assets/scripts/core/config";
import { courtRenderer } from "../assets/scripts/render/court";
import { drawPlayer, drawShadowClone, drawShuttle } from "../assets/scripts/render/sprites";
import { Ribbon } from "../assets/scripts/render/ribbon";
import { FXSystem } from "../assets/scripts/render/fx";
import { makeShuttleMotion, advanceShuttle } from "../assets/scripts/render/shuttle-motion";
import type { Ball } from "../assets/scripts/core/types";
import type { Viewport } from "../assets/scripts/render/world";

installCc();

const C = CFG;
const W = C.world.w, H = C.world.h;

/** 与 world.makeViewport 同一变换:世界(canvas 惯例 y 向下)→ Graphics(y 向上) */
const VP: Viewport = {
  x: (wx: number): number => wx - W / 2,
  y: (wy: number): number => H / 2 - wy,
};

// ---------- 预算(优化后水位 × 余量;放宽预算 = 允许每帧成本回涨,先想清楚) ----------
// 稳态余量 15%:AI/出球误差走 Math.random,但 1.1 万帧的均值按大数定律很稳;
// 余量必须小于「分频收益」(dyn 层全额约占稳态 3 成),selftest 的旧节奏成本才撞得到红线。
const BUDGET_STEADY = 255;   // 实测稳态 ≈220 笔/帧(本次优化后首跑)
const BUDGET_PEAK = 420;     // 实测最忙帧 ≈312 笔(特效爆发帧;峰值受对局随机影响大,余量放宽到 35%)
// 满编影分身档:三枚常驻 ⇒ 场上从 2 具身体变 5 具。**0.0.28 影分身上线时这一档根本不在账上**
// (本工具只画 R.players),等于"最坏稳态"从来没人量过。2026-10-05 同场放开到三个,补一条:
// 预算 = 实测满编水位 × 余量,和稳态那条同一口径 —— 它红就说明"分身越画越贵"在悄悄发生。
const BUDGET_STEADY_CLONES = 320;

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const asG = (g: StubGraphics): Parameters<typeof courtRenderer.drawStaticTo>[0] =>
  g as unknown as Parameters<typeof courtRenderer.drawStaticTo>[0];
/** sprites/ribbon/fx 的签名吃 cc.Graphics,stub 只在运行时顶替,类型这里统一硬转 */
type CC = Parameters<typeof drawPlayer>[0];
const asCC = (g: StubGraphics): CC => g as unknown as CC;

/** 一帧的计费口径:fill+stroke 次数与展开顶点量 */
function bill(g: StubGraphics): { ops: number; verts: number } {
  let verts = 0;
  for (const op of g.ops) verts += opPoints(op).length;
  return { ops: g.ops.length, verts };
}

interface Measure {
  steady: number;      // 稳态帧 fill+stroke 均值(含各层分频摊销)
  peak: number;        // 最忙帧 fill+stroke
  peakVerts: number;
  peakFrame: number;
  snapshot: StubGraphics["ops"];
  frames: number;
  clones: number;      // 这一档场上常驻了几个影分身
}

// ---------- 测量主循环 ----------
/**
 * 跑一段 AI 对 AI 对局并按真实渲染节奏计费。
 * @param dynEveryFrame selftest 用:court-dyn 恢复每帧重绘(旧写法节奏),
 *   正常跑恒为 false(节奏与 world.render 的门控一致)。
 * @param clones 影分身档:0 = 现状(两个实名球员);3 = **满编常驻**的最坏稳态。
 *   这一档必须量:0.0.28 那版影分身上线时本工具只画 R.players,分身的成本**完全不在账上**
 *   —— 而"同场最多三个"是把一具身体变成四具,不量就是拿中低端机的帧率去赌。
 *   这里每帧把编制补满(分身接满三球会散,补满才是稳态上界),画的是 sprites.drawShadowClone
 *   —— 与真机 world.drawShadowClones **同一个函数**,不是这里另抄一份便宜画法。
 */
function runMeasure(dynEveryFrame: boolean, clones = 0): Measure {
  Rules.newMatch("1p", "normal");
  for (const p of Rules.R.players) { p.isAI = true; p.aiDiff = "normal"; }
  Rules.applyAiTier();
  const cloneHost = clones > 0 ? Rules.R.players[0] : null;

  const mainG = new StubGraphics();     // 实体层(球员/球/丝带/特效,每帧)
  const dynG = new StubGraphics();      // court-dyn(每 2 帧 + 晃网强制)
  const slowG = new StubGraphics();     // court-slow(每 3 帧)
  const cfG = new StubGraphics();       // 彩带层(隔帧,fx.draw 内部管节奏)
  courtRenderer.drawStaticTo(asG(dynG), VP);   // 预画一次静态层,让主题数据就绪
  dynG.clear();

  const ribbon = new Ribbon();
  const fx = new FXSystem();
  const mot = makeShuttleMotion();
  const ballView = {} as Ball & { sqR: number };

  const STEPS = 12000;        // 200 模拟秒:若干次得分 + 庆祝彩带完整生命周期
  const WARMUP = 600;         // 前 10 秒不计(开局发球,节奏不代表稳态)
  let frameT = 0;
  let billed = 0, billedFrames = 0, peakOps = 0, peakVerts = 0, peakFrame = -1;
  let snapshot: StubGraphics["ops"] = [];

  for (let step = 0; step < STEPS; step++) {
    const R = Rules.R;
    if (R.state === "OVER") break;
    // ---- 模拟步(与 game-root 主循环同构:AI 出意 → Rules.step → fx.step)----
    const inputs: Parameters<typeof Rules.step>[0] = [];
    for (const p of R.players) {
      inputs[p.idx] = R.ball ? AI.think(p, R.ball, R.state)
        : { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
    }
    Rules.step(inputs);
    R.events.length = 0;                     // 事件只驱动音效/UI,本工具不消费
    // 满编常驻:分身接满三球会散,这里每帧补回三个,量的才是"影子防线拉满"的最坏稳态
    if (cloneHost) {
      while (ShadowGate.clonesOf(cloneHost).length < C.skills.shadow.slots.length) Pl.spawnShadowClone(cloneHost);
    }
    fx.step(1 / 60);
    frameT++;
    const ball = R.ball;
    if (ball) advanceShuttle(mot, ball.vx, ball.vy, ball.sq ?? 1, 1);

    // ---- 渲染帧(1 渲染帧/模拟步;分频节奏与 world.render 一致)----
    mainG.clear();
    // 影分身:与 world.drawShadowClones 同一批参数、同一个函数(画在实名球员下层)
    if (cloneHost) {
      const SHC = C.skills.shadow;
      for (const sc of ShadowGate.clonesOf(cloneHost)) {
        if ((sc.spawnT > 0 || sc.despawnT > 0) && frameT % 2 === 1) continue;
        drawShadowClone(asCC(mainG), VP, sc.entity, frameT, 1, ball, {
          tint: ShadowGate.slotTint(sc.slot),
          remaining: SHC.maxHits - sc.hits,
          slot: sc.slot,
          seed: sc.seed,
          phase: frameT,
          showPips: sc.spawnT <= 0 && sc.despawnT <= 0,
        });
      }
    }
    for (const p of R.players) drawPlayer(asCC(mainG), VP, p, frameT, 1, ball);
    if (ball && (ball.live || ball.held || ball.flying)) {
      Object.assign(ballView, ball);
      ballView.x = ball.x; ballView.y = ball.y;
      ballView.sqR = ball.sq ?? 1;
      drawShuttle(asCC(mainG), VP, ballView, null, 0, mot);
    }
    if (ball && ball.live && !ball.held) {
      ribbon.sample(ball.x, ball.y, Math.hypot(ball.vx, ball.vy));
    }
    ribbon.tick = frameT;
    ribbon.draw(asCC(mainG), VP, null);
    fx.draw(asCC(mainG), VP, asG(cfG));

    const dynDue = dynEveryFrame || frameT % 2 === 0 || courtRenderer.shakeAmp > 0.003;
    if (dynDue) {
      dynG.clear();
      courtRenderer.drawDynTo(asG(dynG), VP, R.rally);
    }
    const slowDue = frameT % 3 === 0;
    if (slowDue) {
      slowG.clear();
      courtRenderer.drawSlowTo(asG(slowG), VP, R.rally);
    }

    if (step >= WARMUP) {
      const m = bill(mainG);
      // 各层按真实节奏摊销:dyn/slow 只在重绘帧计入全额,彩带层按 fx.confetti.layerEvery 摊
      // (0.0.28 起礼花只在终局庆祝段活着、且庆祝段满帧渲染 ⇒ "恒 ÷2" 那条旧假设不再成立;
      //  本工具从不放礼花,这一项恒为 0,写出来只为不再误导读者)
      const cost = m.ops
        + (dynDue ? dynG.ops.length : 0)
        + (slowDue ? slowG.ops.length / 3 : 0)
        + cfG.ops.length / (C.fx.confetti.layerEvery || 1);
      billed += cost;
      billedFrames++;
      if (cost > peakOps) {
        peakOps = cost;
        peakVerts = m.verts + (dynDue ? bill(dynG).verts : 0);
        peakFrame = frameT;
        snapshot = [...mainG.ops, ...dynG.ops, ...slowG.ops, ...cfG.ops];
      }
    }
  }

  if (billedFrames < 1000) fail(`有效采样帧过少(${billedFrames}),对局没打起来?`);
  return {
    steady: billed / billedFrames,
    peak: peakOps,
    peakVerts,
    peakFrame,
    snapshot,
    frames: billedFrames,
    clones,
  };
}

// ---------- 正常跑:稳态 + 峰值双预算 ----------
const m = runMeasure(false);
const m3 = runMeasure(false, C.skills.shadow.slots.length);
console.log(`采样 ${m.frames} 帧`);
console.log(`稳态均值: ${m.steady.toFixed(1)} 笔/帧(预算 ${BUDGET_STEADY})`);
console.log(`满编影分身: ${m3.steady.toFixed(1)} 笔/帧(三枚常驻,每枚 +${((m3.steady - m.steady) / 3).toFixed(1)} 笔;预算 ${BUDGET_STEADY_CLONES}) / 最忙帧 ${m3.peak.toFixed(0)} 笔(预算 ${BUDGET_PEAK})`);
console.log(`最忙帧:   ${m.peak.toFixed(0)} 笔(第 ${m.peakFrame} 帧,顶点 ${m.peakVerts};预算 ${BUDGET_PEAK})`);

// 最忙帧出图(本地 Graphics 坐标 → SVG:y 翻转 + 平移回世界原点)
const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/frame-cost";
})();
fs.mkdirSync(OUT, { recursive: true });
const wpx = Math.round(W), hpx = Math.round(H);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${hpx}" viewBox="0 0 ${wpx} ${hpx}">
<title>frame-cost peak frame #${m.peakFrame} (${m.peak.toFixed(0)} ops)</title>
<rect width="${wpx}" height="${hpx}" fill="#101018"/>
<g transform="translate(${W / 2},${H / 2}) scale(1,-1)">
${opsToSvg(m.snapshot)}
</g>
</svg>`;
fs.writeFileSync(`${OUT}/peak-frame.svg`, svg);
console.log(`最忙帧出图: ${OUT}/peak-frame.svg`);

// ---------- selftest:旧写法节奏必须撞红稳态预算 ----------
if (process.argv.includes("--selftest")) {
  const old = runMeasure(true);
  console.log(`selftest: 旧节奏(court-dyn 每帧重绘)稳态 ${old.steady.toFixed(1)} 笔/帧`);
  if (old.steady <= BUDGET_STEADY) {
    console.error(`✗ selftest:旧写法节奏 ${old.steady.toFixed(1)} 未超预算 ${BUDGET_STEADY} —— 尺子没牙齿(预算被放宽过头,或分频收益消失)`);
    process.exit(1);
  }
  console.log(`selftest ✓ 旧节奏成本撞红预算(${old.steady.toFixed(1)} > ${BUDGET_STEADY}),world.ts 分频回退会被拦`);
  // 满编档必须**真的在量分身**:哪天有人把渲染循环里那段 drawShadowClone 删了,这一档会退化成
  // 与稳态同一个数,预算就变成摆设 —— 所以这里要求"三个分身至少多出一笔可辨的量"。
  const delta = m3.steady - m.steady;
  if (delta < 3 * 8) {
    console.error(`✗ selftest:满编档只比稳态多 ${delta.toFixed(1)} 笔(每枚不到 8 笔)—— 分身没进账,这条预算是死的`);
    process.exit(1);
  }
  console.log(`selftest ✓ 满编影分身档在量真东西:三枚共 +${delta.toFixed(1)} 笔(每枚 ${(delta / 3).toFixed(1)})`);
  process.exit(0);
}

let failures = 0;
if (m.steady > BUDGET_STEADY) {
  failures++;
  console.error(`✗ 稳态均值 ${m.steady.toFixed(1)} > 预算 ${BUDGET_STEADY} —— 每帧成本回涨,查最近的渲染改动`);
}
if (m.peak > BUDGET_PEAK) {
  failures++;
  console.error(`✗ 最忙帧 ${m.peak.toFixed(0)} > 预算 ${BUDGET_PEAK} —— 特效/庆祝峰值失控(第 ${m.peakFrame} 帧)`);
}
if (m3.steady > BUDGET_STEADY_CLONES) {
  failures++;
  console.error(`✗ 满编影分身稳态 ${m3.steady.toFixed(1)} > 预算 ${BUDGET_STEADY_CLONES} —— 三枚常驻把每帧成本抬出水位了(减辉光笔数 / pips 合并 / 降本体细节,别拿中低端机赌)`);
}
// 满编档的最忙帧也要过同一条峰值红线:特效爆发与三枚分身撞在同一帧,才是真最坏情况
if (m3.peak > BUDGET_PEAK) {
  failures++;
  console.error(`✗ 满编档最忙帧 ${m3.peak.toFixed(0)} > 预算 ${BUDGET_PEAK} —— 三分身 + 特效同帧失控(第 ${m3.peakFrame} 帧)`);
}
if (m3.steady <= m.steady) {
  failures++;
  console.error(`✗ 满编档(${m3.steady.toFixed(1)})没比稳态(${m.steady.toFixed(1)})贵 —— 渲染循环里的分身没被量到,这条预算是死的`);
}
if (failures) {
  console.error(`frame-cost-check: ${failures} 处超预算`);
  process.exit(1);
}
console.log("frame-cost-check: 全部通过 ✓");
