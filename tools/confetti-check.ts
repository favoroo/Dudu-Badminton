// ============================================================
// 胜利礼花回归 —— 钉住四类「不崩、不报错、tsc 也不管,只会安静地难看」的坏:
//
//   ① 时钟:终局庆祝段必须真的在推进表现层。用户 2026-10-04 现场「胜利时的这个
//      礼花效果会有点卡顿」,根因之一是 OVER 属 CFG.frozen、主循环整块跳过
//      world.stepFx,而 fx.step() 只在那里被调用 ⇒ 68 片纸屑出生后一帧没走,
//      钉在半空直到结算卡关掉。这类坏法在别的闸门里全绿(sim-check 不跑渲染,
//      frame-cost-check 从不放礼花),所以判据必须常驻这份工具。
//   ② 弹道:必须"升起来 → 落回地面 → 一定收场"。旧值是 g=0.02 + 无阻力,按寿命
//      积分全程在往上飞(升程 1400px,早出屏),而收场条件是"掉出屏底"⇒ 永远
//      只能靠寿命到期,庆祝段收不回去 = 渲染降频再也还不回来。
//   ③ 可见:喷口必须落在结算卡(半宽 280)外侧那两条看得见的边带里。旧写法一口
//      居中 (480, groundY-120),纸屑全打在卡片背后,玩家实际一片都看不见。
//   ④ 绘制:角点计算必须零分配。旧写法每片每帧 new 两个数组(68 片 = 136 个临时
//      对象/帧),正是本工程治过的那类周期性 GC 尖峰(见 palette.ts withAlpha)。
//
// 测量范围说明:本工具按主循环同一套档位判据(core/celebration.ts 的 clockOf /
// renderDue)驱动 FXSystem,但**不重跑 game-root 的 while 循环本体** —— 那条循环
// 是 cc Component,node 里跑不动。game-root 只负责照档位调用 stepFx/render,
// 档位与节奏由这里断言的纯函数说死(判据同源)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/confetti-check.js
//   node .tools-build/tools/confetti-check.js --selftest   # 旧时钟 / 旧弹道必须被拦下
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import * as fs from "fs";
import { installCc, Graphics as StubGraphics } from "./cc-stub";
import { CFG } from "../assets/scripts/core/config";
import { clockOf, renderDue, type ClockMode } from "../assets/scripts/core/celebration";
import { FXSystem, readConfetti, writeConfettiQuad } from "../assets/scripts/render/fx";

installCc();

const SELFTEST = process.argv.indexOf("--selftest") >= 0;
const C = CFG;
const CO = C.court;
const W = C.world.w;
const H = C.world.h;
const CF = C.fx.confetti;

/** 与 world.makeViewport 同一变换:世界(canvas 惯例 y 向下)→ Graphics(y 向上) */
const VP = {
  x: (wx: number): number => wx - W / 2,
  y: (wy: number): number => H / 2 - wy,
};
const asG = (g: StubGraphics): Parameters<typeof FXSystem.prototype.draw>[0] =>
  g as unknown as Parameters<typeof FXSystem.prototype.draw>[0];

/** 结算卡半宽:ui/settle-panel.ts 的 CW = 560 → 280。跨模块契约,钉在判据里 */
const CARD_HALF = 280;
/** 每帧笔数预算:与 tools/frame-cost-check.ts 的 BUDGET_PEAK 同源 */
const PEAK_BUDGET = 420;
/** 地面回收线:与 fx._stepConfetti 里的 floor 同式 */
const FLOOR = CO.groundY - CF.floorPad;
/** 出生高度(世界 y):与 fx.confettiVolley 同式 */
const SPAWN_Y = CO.groundY - CF.nozzleY;
/** 池上限:与 fx.ts 的 MAX_CF 同值(只用来开快照缓冲) */
const CAP = 200;

let fails = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "✓" : "✗"} ${name} —— ${detail}`);
  if (!ok) fails++;
}

// ============================================================
// ① 时钟档位真值表
// ============================================================
const SIM_STATES = ["SERVE", "RALLY", "POINT"];
const PANEL_STATES = ["MENU", "PAUSED", "CAREER", "DRILLS"];
const CEL_STATES = CF.states as string[];

let clockBad = "";
for (const s of SIM_STATES) {
  if (clockOf(s, false) !== "sim" || clockOf(s, true) !== "sim") clockBad += ` ${s}`;
}
check("① 对局态恒为 sim(庆祝判据不许把手感拖慢)", clockBad === "", `sim 漏档:${clockBad || "无"}`);

let celBad = "";
for (const s of CEL_STATES) {
  if (clockOf(s, true) !== "celebrate") celBad += ` ${s}(busy→celebrate)`;
  if (clockOf(s, false) !== "still") celBad += ` ${s}(idle→still)`;
}
check("① 终局态:有东西在放就放行表现层,放完了回到 still", celBad === "", celBad || `庆祝态 ${CEL_STATES.join("/")}`);

let stillBad = "";
for (const s of PANEL_STATES) {
  if (clockOf(s, true) !== "still") stillBad += ` ${s}`;
}
check("① 面板态仍全冻(省电;暂停必须是定格帧)", stillBad === "", stillBad || PANEL_STATES.join("/"));

// 庆祝态必须是 frozen 子集 —— 否则等于在"球还在飞"的态里放行 stepFx 却不跑 Rules.step,
// 表现层与时序分叉(人不动、粒子却继续跑)
const subBad = CEL_STATES.filter((s) => (C.frozen as string[]).indexOf(s) < 0);
check("① 庆祝态 ⊆ CFG.frozen", subBad.length === 0,
  subBad.length ? `不在 frozen 表里:${subBad.join("/")}` : `${CEL_STATES.join("/")} ⊆ frozen`);

// ============================================================
// ② 渲染节奏
// ============================================================
function drawsWithin(clock: ClockMode, frames: number, stop: number): number {
  let n = 0;
  for (let f = 0; f < frames; f++) if (renderDue(clock, stop, f)) n++;
  return n;
}
const D_FRAMES = 240;
const dCeleb = drawsWithin("celebrate", D_FRAMES, 0);
const dStill = drawsWithin("still", D_FRAMES, 0);
const dSim = drawsWithin("sim", D_FRAMES, 0);
const dStop = drawsWithin("sim", D_FRAMES, 5);
check("② 庆祝段满帧(礼花上升段最快 ~13px/帧,15fps 会抽成跳格)",
  dCeleb === D_FRAMES, `${dCeleb}/${D_FRAMES} 帧`);
check("② 面板态仍每 4 帧一次(省电没被顺手删掉)", dStill === D_FRAMES / 4, `${dStill} 次`);
check("② 对局态满帧 / 定格帧每 2 帧", dSim === D_FRAMES && dStop === D_FRAMES / 2, `sim ${dSim},定格 ${dStop}`);
check("② 庆祝段重画频率必须高于面板态", dCeleb > dStill, `${dCeleb} > ${dStill}`);

// ============================================================
// ③ 出生几何:喷口对称、落在卡片外侧的可见带里
// ============================================================
const nozX = (CF.nozzles as number[]).map((k) => k * W);
const mirrorBad = nozX.filter((x) => !nozX.some((o) => Math.abs((W - o) - x) < 0.01));
check("③ 喷口关于屏心镜像(左右不对称=礼花歪一半)", mirrorBad.length === 0,
  nozX.map((x) => x.toFixed(1)).join(", "));

/** 出生时就在结算卡外侧(看得见)的片数占比 */
function visibleAtBirth(): { n: number; vis: number; out: number } {
  const fx = new FXSystem();
  fx.confettiVolley();
  const n = fx.confettiCount();
  const buf = new Float32Array(8);
  let vis = 0, out = 0;
  for (let i = 0; i < n; i++) {
    if (!readConfetti(i, buf)) break;
    if (Math.abs(buf[0] - W / 2) > CARD_HALF) vis++;
    if (buf[0] < 0 || buf[0] > W || buf[1] < 0 || buf[1] > CO.groundY) out++;
  }
  return { n, vis, out };
}

// ============================================================
// ④ 弹道 + 时钟:按主循环档位推进,判"起得来、落得下、收得回去、真的在走"
// ============================================================
interface Flight {
  rise: number;        // 最大升程(出生线往上算,世界 px)
  minY: number; maxY: number; minX: number; maxX: number;
  movedBy10: number;   // 第 10 帧相对第 0 帧的平均竖直位移(时钟有没有走的直接读数)
  emptyAt: number;     // 池子空掉的帧(-1 = 没空)
  left: number;        // 采样结束还剩几片
}

function fly(policy: (state: string, busy: boolean) => ClockMode, state = "OVER", frames = CF.life + 60): Flight {
  const fx = new FXSystem();
  fx.confettiVolley();
  const buf = new Float32Array(8);
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  let y0 = 0, y10 = 0, emptyAt = -1, sampled = 0;
  for (let f = 0; f <= frames; f++) {
    const n = fx.confettiCount();
    if (n > 0) {
      let sum = 0, cnt = 0, lo = Infinity, hi = -Infinity, l = Infinity, r = -Infinity;
      for (let i = 0; i < n; i++) {
        if (!readConfetti(i, buf)) break;
        if (buf[1] < lo) lo = buf[1];
        if (buf[1] > hi) hi = buf[1];
        if (buf[0] < l) l = buf[0];
        if (buf[0] > r) r = buf[0];
        sum += buf[1]; cnt++;
      }
      if (cnt > 0) {
        if (lo < minY) minY = lo;
        if (hi > maxY) maxY = hi;
        if (l < minX) minX = l;
        if (r > maxX) maxX = r;
        if (f === 0) y0 = sum / cnt;
        if (f === 10) y10 = sum / cnt;
        sampled = cnt;
      }
    } else if (emptyAt < 0) emptyAt = f;
    if (f === frames) break;
    const clock = policy(state, fx.busy());
    if (clock !== "still") fx.step(1 / 60);
  }
  return { rise: SPAWN_Y - minY, minY, maxY, minX, maxX, movedBy10: Math.abs(y10 - y0), emptyAt, left: sampled };
}

/** 一份飞行读数合不合格;返回不合格项(空数组 = 全过) */
function judgeFlight(fl: Flight): string[] {
  const bad: string[] = [];
  if (!(fl.movedBy10 > 4)) bad.push(`时钟没走:第 10 帧平均位移只有 ${fl.movedBy10.toFixed(2)}px`);
  if (!(fl.rise >= 120)) bad.push(`升不起来:最大升程只有 ${fl.rise.toFixed(0)}px`);
  if (!(fl.minY > 0)) bad.push(`出屏顶:最高一片 y=${fl.minY.toFixed(0)}`);
  if (!(fl.maxY >= FLOOR - 3)) bad.push(`落不下来:最低一片 y=${fl.maxY.toFixed(0)}(回收线 ${FLOOR})`);
  if (!(fl.minX > -25 && fl.maxX < W + 25)) bad.push(`横向出界:[${fl.minX.toFixed(0)},${fl.maxX.toFixed(0)}]`);
  if (!(fl.emptyAt >= 0)) bad.push(`收不回去:${CF.life + 60} 帧后还剩 ${fl.left} 片(渲染降频再也还不回来)`);
  return bad;
}

const FL = fly(clockOf);
const VB = visibleAtBirth();

// ============================================================
// ⑤ 零分配:绘制路径不许在循环里 new 角点数组
// ============================================================
/** 扫一段函数体:出现数组字面量 / push 对象 = 逐片逐帧分配(旧写法的形状) */
function allocInDraw(body: string): boolean {
  return /=\s*\[/.test(body) || /\.push\(\s*[{[]/.test(body) || /new\s+Array\b/.test(body);
}

/** 0.0.27 之前的真实绘制体(selftest 用它证明这把尺子有牙齿) */
const LEGACY_DRAW = `
    for (let i = 0; i < cfN; i++) {
      const a = Math.min(1, cflf[i] / 60);
      const w = cfw[i], h = cfh[i];
      const hw = w * 0.5, hh = h * 0.5;
      const cosR = cos(cfrot[i]);
      const sinR = sin(cfrot[i]);
      const cx = cfx[i], cy = cfy[i];
      const corners_x = [
        -hw * cosR - (-hh) * sinR,
         hw * cosR - (-hh) * sinR
      ];
      const corners_y = [
        -hw * sinR + (-hh) * cosR,
         hw * sinR + (-hh) * cosR
      ];
      g.fillColor = withAlpha(CLUT[cfcol[i]], a);
      g.moveTo(vp.x(cx + corners_x[0]), vp.y(cy + corners_y[0]));
      g.lineTo(vp.x(cx + corners_x[1]), vp.y(cy + corners_y[1]));
      g.close();
      g.fill();
    }`;

const FX_SRC = fs.readFileSync("assets/scripts/render/fx.ts", "utf8");
const drawStart = FX_SRC.indexOf("private _drawConfetti(");
const drawEnd = drawStart < 0 ? -1 : FX_SRC.indexOf("\n  // ---------- 羽毛", drawStart);
const DRAW_BODY = drawStart < 0 || drawEnd < 0 ? "" : FX_SRC.slice(drawStart, drawEnd);

/** 角点公式对照:旧式(两个数组)与 writeConfettiQuad 必须逐位一致 */
function quadMatchesLegacyFormula(): boolean {
  const quad = new Float32Array(8);
  const buf = new Float32Array(8);
  for (let volley = 0; volley < 200; volley++) {
    const fx = new FXSystem();
    fx.confettiVolley();
    const n = fx.confettiCount();
    for (let i = 0; i < n; i++) {
      if (!readConfetti(i, buf)) break;
      const rot = buf[4], w = buf[6], h = buf[7];
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const hw = w * 0.5 * (CF.flipK + (1 - CF.flipK) * Math.abs(cosR));
      const hh = h * 0.5;
      const dx = [-hw, hw, hw, -hw];
      const dy = [-hh, -hh, hh, hh];
      writeConfettiQuad(i, quad);
      for (let j = 0; j < 4; j++) {
        const lx = dx[j] * cosR - dy[j] * sinR;
        const ly = dx[j] * sinR + dy[j] * cosR;
        if (Math.abs(quad[j * 2] - lx) > 1e-4 || Math.abs(quad[j * 2 + 1] - ly) > 1e-4) return false;
      }
      // 中心对称(平行四边形):对角线互相平分
      if (Math.abs(quad[0] + quad[4] - quad[2] - quad[6]) > 1e-4) return false;
      if (!Number.isFinite(quad[0]) || !Number.isFinite(quad[7])) return false;
    }
  }
  return true;
}

/** 彩带层的重绘节奏:连续 8 次 draw 里重画了几次(用 clear 换数组引用这一点判定) */
function layerRedraws(): { redraws: number; every: number } {
  const fx = new FXSystem();
  fx.confettiVolley();
  const g = new StubGraphics();
  const probe = new StubGraphics();
  let redraws = 0;
  for (let k = 0; k < 8; k++) {
    const before = probe.ops;
    fx.draw(asG(g), VP, asG(probe));
    if (probe.ops !== before) redraws++;
    fx.step(1 / 60);
  }
  return { redraws, every: CF.layerEvery };
}

// ============================================================
// 正常跑:全量判据
// ============================================================
{
  const want = CF.count * nozX.length;
  check("③ 一发齐射的粒数", VB.n === want && VB.n < CAP * 0.5,
    `${VB.n} 片(每口 ${CF.count} × ${nozX.length} 口,池上限 ${CAP})`);
  check("③ ≥90% 纸屑出生就在结算卡外侧(看得见的两条边带里)",
    VB.n > 0 && VB.vis / VB.n >= 0.9, `${VB.vis}/${VB.n} 在 |x-屏心|>${CARD_HALF}`);
  check("③ 出生点在场地内(不许喷到观众席/地面以下)", VB.out === 0, `越界 ${VB.out} 片`);
}
{
  const bad = judgeFlight(FL);
  check("④ 礼花真的升起来、落下来、收得回去(庆祝段时钟在走)", bad.length === 0,
    bad.length ? bad.join(" / ")
      : `升程 ${FL.rise.toFixed(0)}px,最高 y=${FL.minY.toFixed(0)},第 ${FL.emptyAt} 帧收场,10 帧位移 ${FL.movedBy10.toFixed(1)}px`);
  // 收场要落在"回到地面"上,不能是熬到寿命在半空消失(那是"礼花突然不见"的读法)
  check("④ 收场早于寿命上限(说明是落回地面,不是熬到期)",
    FL.emptyAt > 0 && FL.emptyAt <= CF.life, `第 ${FL.emptyAt} 帧空,寿命上限 ${CF.life} 帧`);
}
check("⑤ 绘制循环零分配(不许逐片 new 角点数组)",
  DRAW_BODY.length > 0 && !allocInDraw(DRAW_BODY) && DRAW_BODY.indexOf("writeConfettiQuad(") >= 0,
  DRAW_BODY.length === 0 ? "找不到 _drawConfetti(改名了?判据要跟着改)"
    : `无数组字面量=${!allocInDraw(DRAW_BODY)},走 writeConfettiQuad=${DRAW_BODY.indexOf("writeConfettiQuad(") >= 0}`);
check("⑤ 角点公式与旧式逐位同构(重写没改几何)", quadMatchesLegacyFormula(),
  "200 发齐射、逐片 8 个标量对照 + 平行四边形对称");
{
  const lr = layerRedraws();
  check("⑤ 彩带层重绘节奏 ≥ 30fps", lr.redraws >= 4, `8 次 draw 重画 ${lr.redraws} 次(layerEvery=${lr.every})`);
}
{
  const fx = new FXSystem();
  fx.confettiVolley();
  const g = new StubGraphics();
  const cg = new StubGraphics();
  fx.step(1 / 60);
  fx.draw(asG(g), VP, asG(cg));
  const fills = cg.ops.filter((o) => o.kind === "fill").length;
  const total = g.ops.length + cg.ops.length;
  check("⑥ 每片一笔(彩带层笔画数 == 池内片数)", fills === fx.confettiCount(), `${fills} 笔 / ${fx.confettiCount()} 片`);
  check("⑥ 礼花最忙帧笔数不超 frame-cost 峰值预算", total <= PEAK_BUDGET, `${total} 笔 ≤ ${PEAK_BUDGET}`);
}

// ============================================================
// selftest:两份旧写法必须各自被点名
// ============================================================
if (SELFTEST) {
  check("selftest-1 旧绘制体(逐片两个数组)被点名", allocInDraw(LEGACY_DRAW), "LEGACY_DRAW 含数组字面量 → 判据认得出这个形状");
  const legacyClock = (_s: string, _b: boolean): ClockMode => "still";
  const badClock = judgeFlight(fly(legacyClock));
  check("selftest-2 旧时钟(frozen 一律 still)被拦下", badClock.length > 0, badClock[0] || "居然没拦住 —— 这把尺子没牙齿");
  const keep = { grav: CF.grav, drag: CF.drag, flutter: CF.flutter, life: CF.life, vyUp: CF.vyUp, nozzles: CF.nozzles, count: CF.count };
  CF.grav = 0.02; CF.drag = 1; CF.flutter = 0; CF.life = 260;
  CF.vyUp = [3, 8]; CF.nozzles = [0.5]; CF.count = 60;
  const badPhys = judgeFlight(fly(clockOf));
  const visLegacy = visibleAtBirth();
  CF.grav = keep.grav; CF.drag = keep.drag; CF.flutter = keep.flutter; CF.life = keep.life;
  CF.vyUp = keep.vyUp; CF.nozzles = keep.nozzles; CF.count = keep.count;
  check("selftest-3 旧弹道(g=0.02 无阻力)被拦下", badPhys.length > 0,
    badPhys.join(" / ") || "居然没拦住 —— 这把尺子没牙齿");
  check("selftest-4 旧一口居中(全打在结算卡背后)被拦下",
    visLegacy.n > 0 && visLegacy.vis / visLegacy.n < 0.9,
    `旧喷口 ${visLegacy.vis}/${visLegacy.n} 落在可见带内(<90% 才算拦住)`);
}

console.log(SELFTEST
  ? (fails === 0 ? "confetti-check --selftest: 反例全部被拦住 ✓" : `confetti-check --selftest: ${fails} 处未拦住 ✗`)
  : (fails === 0 ? "confetti-check: 全部通过 ✓" : `confetti-check: ${fails} 项失败 ✗`));
process.exit(fails === 0 ? 0 : 1);
