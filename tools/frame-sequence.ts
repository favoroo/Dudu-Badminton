// ============================================================
// 逐帧导出 —— 把一段真实对局导成 PNG 序列,供宣传片剪辑用。
//
// 与 frame-cost-check 的关系:那个工具为了量「每帧多少笔」,只保留最忙的一帧,
// 且刻意不画静态层(它用 drawStaticTo 只是为了预热主题数据,随后就 clear 掉了)。
// 出片要的是「肉眼看到的完整画面」,所以这里:
//   · static 层真的留在屏上(天空渐变/看台/地板),这是上一版偏黑的唯一原因;
//   · 每帧落一张 SVG,再由 raster-frames.mjs 走 CDP 批量转 PNG。
//
// 渲染路径与真机 world.render 同构:同一批 render/* 函数、同一个 cc-stub 录制层、
// 同样的三层分频(static 一次 / slow 每 3 帧 / dyn 每 2 帧 + 晃网强制)。
// 不重抄画面 —— 这是本仓库对预览工具一贯的纪律。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/frame-sequence.js --theme arena --out .tools-build/seq/arena \
//        --warmup 240 --frames 300 --every 2
//
// 参数:
//   --theme   arena|beach|cyber|dojo          球场主题(默认 arena)
//   --frames  输出的**渲染帧**数(默认 300)
//   --every   每 N 个模拟步出 1 张(60Hz 逻辑 → every=2 即 30fps,默认 2)
//   --warmup  跳过前 N 个模拟步(默认 240,跳过开局发球的死气)
//   --skill   lunge|smash|flash|magnet|focus|shadow|rage  给左侧玩家装技能
//   --cast    在第 N 个输出帧激活一次技能(默认 0 = 不触发)
//   --pace    球速档位 id(默认 vslow,与游戏默认一致;子弹时间用 slower 档)
//   --shot    只保留「含指定球种」的对局:smash|clear|drive|slash|netshot|lob|serve
//   --minRally 只从回合数 >= N 的时刻开始(默认 0)
//   --seed    给 Math.random 定种子,让同一组参数可复现
//   --prefix  输出文件名前缀(默认 f)
// ============================================================

// 顺序即语义:cc-stub 必须在 render 模块之前求值(它在模块加载时打 Module._load 补丁)
import * as fs from "fs";
import * as path from "path";
import { installCc, Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { ShadowGate } from "../assets/scripts/core/shadow-gate";
import { Skills } from "../assets/scripts/core/skills";
import { Pace } from "../assets/scripts/core/pace";
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

type G = Parameters<typeof drawPlayer>[0];
const asCC = (g: StubGraphics): G => g as unknown as G;
const asG = (g: StubGraphics): Parameters<typeof courtRenderer.drawStaticTo>[0] =>
  g as unknown as Parameters<typeof courtRenderer.drawStaticTo>[0];

// ---------- 参数 ----------
function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const THEME = arg("theme", "arena")!;
const OUT_FRAMES = Number(arg("frames", "300"));
const EVERY = Math.max(1, Number(arg("every", "2")));
const WARMUP = Number(arg("warmup", "240"));
const SKILL = arg("skill", "");
const CAST_AT = Number(arg("cast", "0"));
const PACE_ID = arg("pace", "");
const WANT_SHOT = arg("shot", "");
const MIN_RALLY = Number(arg("minRally", "0"));
/** --afterShot 只在「刚出现过指定球种」之后 N 个模拟步内出图(默认 0 = 不限)。
 *  重杀那一拍的粒子与镜头推进只活十几帧,用窗口切才能保证录到的是爆发段而不是平淡对拉。 */
const AFTER_SHOT = arg("afterShot", "");
const AFTER_WIN = Number(arg("afterWin", "40"));
const SEED = Number(arg("seed", "0"));
const PREFIX = arg("prefix", "f")!;
const OUT = arg("out", `.tools-build/seq/${THEME}`)!;
// 输出分辨率倍数:渲染层是矢量,放大只是把 SVG 的 viewBox 乘开,
// 不是位图插值 —— 2 倍即真 1920×1080,不是把 960 糊上去。
const SCALE = Math.max(1, Number(arg("scale", "1")));

// ---------- 可复现随机 ----------
// AI 出球与误差走 Math.random;宣传片素材要能按参数重跑出同一条对拉,
// 所以整段对局期间把它换成 mulberry32。跑完还原(工具进程随即退出,但别留脏)。
if (SEED) {
  let s = SEED >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = rnd;
}

// ---------- 开一局 ----------
Rules.newMatch("1p", "normal");
for (const p of Rules.R.players) {
  p.isAI = true;
  p.aiDiff = "normal";
}
Rules.applyAiTier();
if (PACE_ID) Pace.apply(PACE_ID);
courtRenderer.setTheme(THEME);

// 技能装到左侧(玩家侧)的**第二槽**:第一槽归 AI 决策链自己用(ai.ts 只走 skillPressed),
// 装那里会和 AI 的自动释放抢冷却 —— 实测 buffT 刚上弦、下一帧就被 AI 顶掉,宣传片拍不到。
// 第二槽 skill2Pressed 只有真人会按,AI 不碰(双技能是玩家侧增强),所以它听我们的。
if (SKILL) {
  const host = Rules.R.players[0];
  host.skill2 = Skills.initSkillState(SKILL as never);
}

// ---------- 分层 ----------
const staticG = new StubGraphics();  // 静态层:只画一次,全程留在屏上
const dynG = new StubGraphics();     // court-dyn:每 2 帧 + 晃网强制
const slowG = new StubGraphics();    // court-slow:每 3 帧
const entG = new StubGraphics();     // 实体层:球员/球/丝带/特效,每帧
const cfG = new StubGraphics();      // 彩带层
// 观众批次层:与 world.ts 同构,200 人拆 3 批轮转(每批每 9 帧重画)。
// 单独成层是必须的 —— slow 层整体 clear,混在一起会把没画到的那批从屏上抹掉。
const CROWD_BATCHES = 3;
const crowdG: StubGraphics[] = [];
for (let i = 0; i < CROWD_BATCHES; i++) crowdG.push(new StubGraphics());

courtRenderer.drawStaticTo(asG(staticG), VP);
for (let i = 0; i < CROWD_BATCHES; i++) courtRenderer.drawCrowdBatchTo(asG(crowdG[i]), VP, i, CROWD_BATCHES);

const ribbon = new Ribbon();
const fx = new FXSystem();
const mot = makeShuttleMotion();
const ballView = {} as Ball & { sqR: number };

fs.mkdirSync(OUT, { recursive: true });

let frameT = 0;        // 世界帧(动画相位)
let simStep = 0;       // 模拟步
let emitted = 0;       // 已出图数
let castDone = false;
let castFrame = -1;
let shotAt = -1;      // 目标球种最近一次命中的模拟步
let skippedLowRally = 0;
const hits: { frame: number; kind: string; rally: number; sweet: boolean; perfect: boolean }[] = [];
let peakRally = 0;
const MAX_STEPS = 60 * 60 * 6;   // 上限 6 分钟逻辑,防死循环

while (emitted < OUT_FRAMES && simStep < MAX_STEPS) {
  const R = Rules.R;
  if (R.state === "OVER") break;

  // ---- 模拟步 ----
  const inputs: Parameters<typeof Rules.step>[0] = [];
  for (const p of R.players) {
    inputs[p.idx] = R.ball
      ? AI.think(p, R.ball, R.state)
      : { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
  }

  // 技能触发:到点之后**每帧都试**,直到真的放出去为止。
  // 不能只试一帧 —— canActivate 对多数技能要求「球在飞且在自己半场」,
  // 试一次正好卡在发球/死球上就永远错过(实测 smash 的 buffT 门槛在开局几帧不满足)。
  if (SKILL && !castDone && simStep >= WARMUP + CAST_AT * EVERY) {
    const host = R.players[0];
    const inp = inputs[0];
    if (R.ball && Skills.canActivate(host, R.ball, 2)) {
      inp.skill2Pressed = true;
      castDone = true;
      castFrame = frameT;
    }
  }

  Rules.step(inputs);

  // 事件:只记击球点,给剪辑做「击球对齐」用
  for (const ev of R.events) {
    if (ev.t === "hit") {
      hits.push({
        frame: frameT,
        kind: String(ev.kind ?? ""),
        rally: Number(ev.rally ?? 0),
        sweet: !!ev.sweet,
        perfect: !!ev.perfect,
      });
      // 目标球种窗口:命中就把「最近一次爆发帧」推到现在
      if (AFTER_SHOT && String(ev.kind ?? "") === AFTER_SHOT) shotAt = simStep;
    }
  }
  R.events.length = 0;
  if (R.rally > peakRally) peakRally = R.rally;

  fx.step(1 / 60);
  frameT++;
  simStep++;

  const ball = R.ball;
  if (ball) advanceShuttle(mot, ball.vx, ball.vy, ball.sq ?? 1, 1);

  // ---- 渲染 ----
  entG.clear();
  // 影分身:与 world.drawShadowClones 同一函数同一批参数
  const cloneHost = R.players[0];
  const scs = ShadowGate.clonesOf(cloneHost);
  if (scs.length) {
    const SHC = C.skills.shadow;
    for (const sc of scs) {
      if ((sc.spawnT > 0 || sc.despawnT > 0) && frameT % 2 === 1) continue;
      drawShadowClone(asCC(entG), VP, sc.entity, frameT, 1, ball, {
        tint: ShadowGate.slotTint(sc.slot),
        remaining: SHC.maxHits - sc.hits,
        slot: sc.slot,
        seed: sc.seed,
        phase: frameT,
        showPips: sc.spawnT <= 0 && sc.despawnT <= 0,
      });
    }
  }
  for (const p of R.players) drawPlayer(asCC(entG), VP, p, frameT, 1, ball);
  if (ball && (ball.live || ball.held || ball.flying)) {
    Object.assign(ballView, ball);
    ballView.sqR = ball.sq ?? 1;
    drawShuttle(asCC(entG), VP, ballView, null, 0, mot);
  }
  if (ball && ball.live && !ball.held) ribbon.sample(ball.x, ball.y, Math.hypot(ball.vx, ball.vy));
  ribbon.tick = frameT;
  ribbon.draw(asCC(entG), VP, null);
  fx.draw(asCC(entG), VP, asG(cfG));

  const dynDue = frameT % 2 === 0 || courtRenderer.shakeAmp > 0.003;
  if (dynDue) {
    dynG.clear();
    courtRenderer.drawDynTo(asG(dynG), VP, R.rally);
  }
  const slowDue = frameT % 3 === 0;
  if (slowDue) {
    slowG.clear();
    courtRenderer.drawSlowTo(asG(slowG), VP, R.rally);
  }
  // 观众批次:每批每 (批次×3) 帧轮转,与 world.render 同一节奏
  for (let i = 0; i < CROWD_BATCHES; i++) {
    if (frameT % (CROWD_BATCHES * 3) === i * 3) {
      crowdG[i].clear();
      courtRenderer.drawCrowdBatchTo(asG(crowdG[i]), VP, i, CROWD_BATCHES);
    }
  }

  // ---- 出图 ----
  if (simStep > WARMUP && (simStep - WARMUP) % EVERY === 0) {
    // 回合数门槛:开局那几拍是发球试探,不够燃;等回合起来再开始录
    if (R.rally < MIN_RALLY) {
      skippedLowRally++;
      continue;
    }
    // 球种窗口:只在目标球种命中后的窗口内出图(重杀/扣杀的粒子只活十几帧)
    if (AFTER_SHOT && (shotAt < 0 || simStep - shotAt > AFTER_WIN)) {
      skippedLowRally++;
      continue;
    }
    const ops = [
      ...staticG.ops,
      ...crowdG.flatMap((g) => g.ops),
      ...slowG.ops,
      ...dynG.ops,
      ...entG.ops,
      ...cfG.ops,
    ];
    // 包一层带 body{margin:0} 的 HTML:直接给 Chrome 一张裸 SVG,文档默认边距会留白边
    // SCALE>1 时把 viewBox 缩到 960×540 再整体 scale 上去 —— 图形是矢量,放大是真放大
    const ow = W * SCALE, oh = H * SCALE;
    const svg =
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}` +
      `svg{display:block}</style>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${W} ${H}">` +
      `<rect width="${W}" height="${H}" fill="#0a0d18"/>` +
      `<g transform="translate(${W / 2},${H / 2}) scale(1,-1)">${opsToSvg(ops)}</g></svg>`;
    const name = `${PREFIX}${String(emitted).padStart(4, "0")}.svg`;
    fs.writeFileSync(path.join(OUT, name), svg);
    emitted++;
  }
}

// 击球点清单给剪辑对齐用(帧号 → 输出帧号 = (frame - WARMUP) / EVERY)
fs.writeFileSync(
  path.join(OUT, "hits.json"),
  JSON.stringify(
    {
      theme: THEME,
      every: EVERY,
      warmup: WARMUP,
      pace: Pace.id(),
      outFrames: emitted,
      peakRally,
      skippedLowRally,
      hits: hits
        .filter((h) => h.frame > WARMUP)
        .map((h) => ({
          out: Math.round((h.frame - WARMUP) / EVERY),
          kind: h.kind,
          rally: h.rally,
          sweet: h.sweet,
          perfect: h.perfect,
        })),
    },
    null,
    2
  )
);

console.log(
  `${THEME}: ${emitted} 帧 → ${OUT} (every=${EVERY}, pace=${Pace.id()}, 峰值回合 ${peakRally}` +
    (WANT_SHOT ? `, 目标球种 ${WANT_SHOT}` : "") +
    (skippedLowRally ? `, 因回合数不足跳过 ${skippedLowRally} 帧` : "") +
    `)`
);
if (SKILL) console.log(`技能 ${SKILL}: ${castDone ? "已触发" : "未触发(冷却/条件不满足)"}`);
