// 反应预算与输入画像自检(球速档位新增的常驻诊断,不改任何数值,只把「接得到吗」换成帧)。
//
// 为什么只有代码能验:「手机上接不到球」这句话里能改的东西有三摊 ——
//   ① 球飞多久(球速档位 pace)、② 判定区多大(随来球速度收缩,swing.zoneFastMul)、
//   ③ 人手比键盘慢多少(击球方向要横滑 commitPx 才提交、滑轨末端 slowDownDist 降速)。
// 三摊**不在同一个单位**里:①②是物理量,③是输入量,靠手感讨论永远吵不出结果。
// 本工具把它们统一成「帧」:球进入判定区还剩几帧 vs 人跑到位要几帧 vs 挥拍最佳提前量几帧。
// 于是「慢一档值多少帧」「触屏到底吃亏在哪一摊」都是能打印、能断言的数字。
//
// 四条结论(每次改输入数值前后都该重读这四条):
//   §1 时间膨胀是不是真的「只改时间、不改空间」—— 手滑去砍 speedMax 会在这里红;
//   §2 慢档把判定区放宽了多少 —— 这是「更好接」的另一半来源;
//   §3 反应预算 slack(剩帧 − 跑位帧 − 提前量)随档位怎么变;
//   §4 键盘 / 摇杆 / 滑轨三种输入画像的跑位帧与横滑提交延迟。
//
// 用法(先 npx tsc -p tools/tsconfig.json):node .tools-build/tools/reach-check.js
import { CFG } from "../assets/scripts/core/config";
import { Pace } from "../assets/scripts/core/pace";
import { Gait } from "../assets/scripts/core/gait";
import { Physics } from "../assets/scripts/core/physics";
import { Player, PRESS_LEAD_FRAMES } from "../assets/scripts/core/player";
import type { Ball, PlayerInput } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};

const IDS = C.pace.tiers.map((t) => t.id);
const sOf = (id: string): number => C.pace.tiers.find((t) => t.id === id)!.s;
const BASE = "fast";                       // s=1 的参照档 = 上一版原速
/** 可达区间(与 player.ts 的夹取同源):左队能站的地方 */
const STAND_MIN = CO.wallL;
const STAND_MAX = CO.netX - CO.netPad;

/** 按当前档位解一发:θ 走 loftFor(与 player.buildShot 同式),boost 固定 0 */
function solve(x0: number, contactH: number, dir: number, depth: number, q: number, id: string) {
  Pace.apply(id);
  const loft = Physics.loftFor(depth, contactH, q);
  return Physics.solveShot(x0, CO.groundY - contactH, dir, depth, loft);
}

// ============================================================
// §1 缩放自证:换档只该改「几帧走完」,不该改「走哪条弧」
// ============================================================
console.log("\n=== §1 时间膨胀自证(重力 ×s²、速度类 ×s、阻力不动) ===");
{
  const XS = [90, 200, 280, 380, 445];
  const HS = [8, 40, 80, 120, 160, 200, 220];
  const DS = [C.aimDepth.near, C.aimDepth.mid, C.aimDepth.deep];
  const QS = [0.4, 0.7, 1.0];
  const cases: Array<{ x0: number; h: number; d: number; q: number }> = [];
  for (const x0 of XS) for (const h of HS) for (const d of DS) for (const q of QS)
    cases.push({ x0, h, d, q });

  for (const id of IDS) {
    if (id === BASE) continue;
    const s = sOf(id);
    let sumLand = 0, maxLand = 0, nLand = 0, sumRatio = 0, nRatio = 0, sumNet = 0, nNet = 0;
    let netFlips = 0, overCap = 0;
    for (const cs of cases) {
      const a = solve(cs.x0, cs.h, 1, cs.d, cs.q, BASE);
      const b = solve(cs.x0, cs.h, 1, cs.d, cs.q, id);
      const dl = Math.abs(b.trace.landX - a.trace.landX);
      sumLand += dl; maxLand = Math.max(maxLand, dl); nLand++;
      if (a.trace.steps > 0) { sumRatio += b.trace.steps / a.trace.steps; nRatio++; }
      if (a.trace.netY !== null && b.trace.netY !== null) {
        sumNet += Math.abs(b.trace.netY - a.trace.netY); nNet++;
      }
      if (a.trace.hitNet !== b.trace.hitNet) netFlips++;
      if (b.speed > Pace.vmax + 1e-9) overCap++;
    }
    const meanLand = sumLand / nLand, meanRatio = sumRatio / nRatio;
    console.log(`  ${id.padEnd(9)} s=${s.toFixed(2)}  落点 mean=${meanLand.toFixed(2)} max=${maxLand.toFixed(1)}px`
      + ` · 滞空比=${meanRatio.toFixed(4)}(理想 ${(1 / s).toFixed(4)})`
      + ` · 网口y mean=${(sumNet / nNet).toFixed(2)}px · ${nLand} 样本`);
    // mean 才是这条断言的牙齿:把 dragK 也乘了 s(=错误的缩放)会让 mean 漂到 12px 量级;
    // max 只是"最尖的那一发"随档加深,越快档每帧步长越大、Euler 离散误差越大
    // (实测 s=1.16 时 max 15.3px 而 mean 只 1.57px),所以给它 18px 的余量而不是收紧 mean。
    ok(meanLand <= 3 && maxLand <= 18, `${id}:落点几乎不动(mean ≤3px、max ≤18px)`);
    ok(Math.abs(meanRatio - 1 / s) <= 0.02, `${id}:滞空帧数按 1/s 拉长(±2%)`);
    ok(netFlips === 0, `${id}:过网/撞网的结论一例都不许翻转(${netFlips} 例翻转)`);
    ok(overCap === 0, `${id}:解出的初速一律不超过档内上限 Pace.vmax`);
  }
  // 顶速那一发必须严格等于 speedMax·s(这条挡住「有人把 boost 也乘了两遍」)
  for (const id of IDS) {
    const cap = solve(90, 8, 1, C.aimDepth.deep, 0.4, id);
    const want = C.shot.speedMax * sOf(id);
    ok(Math.abs(cap.speed - want) < 1e-6, `${id}:cap 触顶值 = shot.speedMax×s = ${want.toFixed(2)}(实得 ${cap.speed.toFixed(2)})`);
  }
}

// ============================================================
// §2 判定区随档放宽多少(来球越慢,够球距离与判定区越大)
// ============================================================
console.log("\n=== §2 判定区:同一记重杀,各档给出的接球几何 ===");
{
  // 「同一击球强度」= 基准档解出来的那记重杀速度,按 s 折算成各档的世界速度
  const ref = solve(280, 180, 1, C.aimDepth.deep, 0.5, BASE);
  console.log(`  参照:基准档重杀 v=${ref.speed.toFixed(2)} θ=${ref.deg.toFixed(0)}° kind=${ref.kind}`);
  let prevR = -1;
  const rows: Array<[string, number, number, number]> = [];
  for (const id of IDS.slice().sort((a, b) => sOf(b) - sOf(a))) {
    const s = sOf(id);
    const v = ref.speed * s;                       // 世界速度
    Pace.apply(id);
    const rad = Physics.reachRadius({ vx: v, vy: -v * 0.2 });
    const probe = {
      x: 280, y: CO.groundY, facing: 1,
      swingRadius: rad, zoneScale: 1, swingStyle: "over" as const,
    };
    const z = Player.strikeZone(probe, v);
    rows.push([id, v, rad, z.r]);
    if (prevR >= 0) ok(z.r >= prevR - 1e-9, `${id}:球更慢 → 判定区不小(${z.r.toFixed(1)} vs 上一档 ${prevR.toFixed(1)})`);
    prevR = z.r;
  }
  for (const [id, v, rad, r] of rows)
    console.log(`  ${id.padEnd(9)} v=${v.toFixed(2).padStart(6)} 拍头半径=${rad.toFixed(1).padStart(5)} 判定区 r=${r.toFixed(1).padStart(6)}`);
  const fastest = rows[0][3], slowest = rows[rows.length - 1][3];
  ok(slowest > fastest, `最慢档比最快档的判定区宽 ${(slowest - fastest).toFixed(1)}px(${((slowest / fastest - 1) * 100).toFixed(1)}%)`);
}

// ============================================================
// §3 反应预算 slack:剩帧 − 跑位帧 − 最佳提前量
// ============================================================
console.log("\n=== §3 反应预算 slack(接得到的真正余量,单位=帧) ===");
/** 站位在 x 的人,球首次飞进他判定区是第几帧(-1 = 全程进不来) */
function arriveFrame(ball: Ball, x: number): number {
  const b: Ball = { ...ball, px: ball.x, py: ball.y };
  const p = Player.create("left", { homeX: x });
  p.x = x; p.homeX = x;
  for (let f = 0; f <= 200; f++) {
    // 判定半径在真实对局里是「起拍那一刻」按来球速度算的(player.startSwing),
    // 这里逐帧取当前来球速度,等于假定玩家总能按最新信息起拍 —— 略偏乐观,
    // 但档位比较用的是同一条式子,差值仍然可信。
    p.swingRadius = Physics.reachRadius(b);
    if (Player.ballInZone(p, b) !== null) return f;
    Physics.step(b);
    if (b.y >= CO.groundY - 2) break;
  }
  return -1;
}
/** 三种输入画像跑到位需要的帧数(用真的 Player.update,不另写一套运动学) */
function runFrames(fromX: number, toX: number, model: string, tol: number): number {
  const p = Player.create("left", { homeX: fromX });
  p.x = fromX; p.homeX = fromX;
  const inp = (): PlayerInput => {
    const base: PlayerInput = {
      left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
    };
    const dir = toX > p.x ? 1 : -1;
    if (model === "keyboard") { base.left = dir < 0; base.right = dir > 0; }
    else if (model === "stick-full") base.moveAxis = dir;
    else if (model === "stick-0.85") base.moveAxis = dir * 0.85;   // touchpad 的满舵最小轴(FULL_DEFLECT)
    else if (model === "stick-0.70") base.moveAxis = dir * 0.70;
    else if (model === "slider") base.targetX = toX;
    return base;
  };
  for (let f = 0; f <= 600; f++) {
    if (Math.abs(p.x - toX) <= tol) return f;
    Player.update(p, inp(), null);
  }
  return -1;
}
// 来球场景与候选站位(§3 与 §5 共用:一边改球速、一边改脚速,测的是同一批球)
const SCENES: Array<{ name: string; depth: number; q: number }> = [
  { name: "重杀压深区", depth: C.aimDepth.deep, q: 1.0 },
  { name: "平抽中场", depth: C.aimDepth.mid, q: 0.7 },
  { name: "高远压底线", depth: C.aimDepth.deep, q: 0.4 },
];
const CAND = [STAND_MIN + 6, 160, 240, CO.netX - 200, CO.netX - 120, CO.netX - 60];
/** 把「对方那一拍」按球速档解成一颗可积分的来球(右队击球点离地 180),带上它的落地点 */
function incoming(paceId: string, sc: { name: string; depth: number; q: number }): { ball: Ball; landX: number } {
  Pace.apply(paceId);
  const loft = Physics.loftFor(sc.depth, 180, sc.q);
  const shot = Physics.solveShot(680, CO.groundY - 180, -1, sc.depth, loft);
  const ball: Ball = {
    x: 680, y: CO.groundY - 180, px: 680, py: CO.groundY - 180,
    vx: shot.vx, vy: shot.vy, live: true, held: false,
    owner: null, lastHitter: "right", crossed: false, netted: false, shot: null, sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  };
  return { ball, landX: Math.min(STAND_MAX, Math.max(STAND_MIN, shot.trace.landX)) };
}
{
  const slackByTier: Record<string, number> = {};
  const landByTier: Record<string, number> = {};
  for (const id of IDS.slice().sort((a, b) => sOf(b) - sOf(a))) {
    // 每个场景取「挑最好的站位还差多少」= 对候选站位取 **max**(min 是在问「站到最差的
    // 位置还接不接得到」,那测的是站位失误,不是反应预算);场景之间再取 min = 最难接的那拍
    let worst = Infinity;
    let worstDesc = "无候选站位可达";
    let landWorst = Infinity;
    let landDesc = "落点不可达";
    for (const sc of SCENES) {
      Pace.apply(id);
      const loft = Physics.loftFor(sc.depth, 180, sc.q);
      const shot = Physics.solveShot(680, CO.groundY - 180, -1, sc.depth, loft);
      const ball: Ball = {
        x: 680, y: CO.groundY - 180, px: 680, py: CO.groundY - 180,
        vx: shot.vx, vy: shot.vy, live: true, held: false,
        owner: null, lastHitter: "right", crossed: false, netted: false, shot: null, sq: 1, sqPrev: 1,
        flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
      };
      let best = -Infinity, bestDesc = "";
      for (const x of CAND) {
        const t = arriveFrame(ball, x);
        if (t < 0) continue;
        const run = runFrames(CO.netX - 200, x, "stick-full", 8);
        if (run < 0) continue;
        const slack = t - run - PRESS_LEAD_FRAMES;
        if (slack > best) { best = slack; bestDesc = `站 x=${x}(剩 ${t} 帧 / 跑 ${run} 帧)`; }
      }
      if (best > -Infinity && best < worst) { worst = best; worstDesc = `${sc.name} ${bestDesc}`; }

      // 另一个更硬的问法:「非要走到落点那一拍去接」还剩多少余量 ——
      // 站位取球的落地点(夹进可达区间),这是「正面接这一拍」的预算,不受偷懒站home的稀释
      const landX = Math.min(STAND_MAX, Math.max(STAND_MIN, shot.trace.landX));
      const tl = arriveFrame(ball, landX);
      const rl = runFrames(CO.netX - 200, landX, "stick-full", 8);
      if (tl >= 0 && rl >= 0) {
        const sl = tl - rl - PRESS_LEAD_FRAMES;
        if (sl < landWorst) { landWorst = sl; landDesc = `${sc.name} 走到 x=${landX.toFixed(0)}(剩 ${tl} 帧 / 跑 ${rl} 帧)`; }
      }
    }
    slackByTier[id] = worst;
    landByTier[id] = landWorst;
    console.log(`  ${id.padEnd(9)} s=${sOf(id).toFixed(2)}  最好应对方 slack=${worst.toFixed(1)} 帧(${worstDesc})`
      + `   走落点 slack=${landWorst.toFixed(1)} 帧(${landDesc})`);
  }
  const std = slackByTier[C.pace.default];
  const stdLand = landByTier[C.pace.default];
  ok(std >= 10, `出货默认档 "${C.pace.default}":原地就能接到的那拍,余量应 ≥10 帧(实得 ${std.toFixed(1)})`);
  ok(stdLand >= 0, `出货默认档:非要走到落点去接的那拍也还有余量(实得 ${stdLand.toFixed(1)} 帧,<0 就是「来不及」)`);
  ok(landByTier["slow"] > stdLand, `慢一档(slow)让「走落点那一拍」的余量变多(+${(landByTier["slow"] - stdLand).toFixed(1)} 帧)`);
  ok(landByTier["vslow"] > landByTier["slow"], `再慢一档继续变多(+${(landByTier["vslow"] - landByTier["slow"]).toFixed(1)} 帧)`);
  ok(slackByTier["slow"] >= std && slackByTier["vslow"] >= slackByTier["slow"],
    "最好应对口径也单调不减(慢档不会让任何场景更紧)");
  // 与最快档对照:告诉读数的人「原速/偏快」到底吃回去多少帧
  ok(std - slackByTier["vfast"] >= 2, `比 ${BASE} 档慢 8% 换来 +${(std - slackByTier[BASE]).toFixed(1)} 帧,`
    + `比 vfast 快档多 ${(std - slackByTier["vfast"]).toFixed(1)} 帧`);
}

// ============================================================
// §4 键盘 / 摇杆 / 滑轨:同一件事各要几帧,横滑提交晚多久
// ============================================================
console.log("\n=== §4 输入画像:跑位帧与击球方向提交延迟 ===");
{
  Pace.apply(BASE);
  const DISTS = [60, 100, 150, 200];
  const MODELS = ["keyboard", "stick-full", "stick-0.85", "stick-0.70", "slider"];
  const header = "  距离".padEnd(9) + MODELS.map((m) => m.padStart(12)).join("") + "   滑轨手指行程";
  console.log(header);
  // 到位容差 8px(判定区半径 65~95px,根本不需要精准站定)
  for (const D of DISTS) {
    const to = CO.netX - 200 + D;
    if (to > STAND_MAX) continue;
    const cells = MODELS.map((m) => String(runFrames(CO.netX - 200, to, m, 8)).padStart(12));
    console.log(`  ${String(D).padEnd(9)}${cells.join("")}   ${D.toFixed(0)}px(1:1 跟手指)`);
  }
  const kb = runFrames(CO.netX - 200, CO.netX - 200 + 150, "keyboard", 8);
  const sl = runFrames(CO.netX - 200, CO.netX - 200 + 150, "slider", 8);
  const st = runFrames(CO.netX - 200, CO.netX - 200 + 150, "stick-0.85", 8);
  ok(Math.abs(sl - kb) <= 2, `滑轨末端降速(slowDownDist=${C.sliderControl.slowDownDist})对「接到球」零代价:${sl} 帧 vs 键盘 ${kb} 帧`);
  ok(st >= kb, `摇杆只推到 0.85 满舵会比键盘慢(${st} vs ${kb} 帧)—— 这条是「摇杆档位手感」的账,不是接不到球的主因`);

  // 横滑提交:按下即起拍,方向要等手指横过 commitPx;键盘是即按即定
  const commitPx = C.touchAim.commitPx;
  const SW = C.swing;
  console.log(`  横滑提交阈值 commitPx=${commitPx}(= ${SW.windup}..${SW.windup + SW.active} 挥拍窗里的早段)`);
  for (const vThumb of [2.5, 4, 6]) {
    const frames = Math.ceil(commitPx / vThumb);
    const late = Math.max(0, Math.min(SW.active, frames));
    console.log(`    拇指 ${vThumb.toFixed(1)}px/帧(≈${(vThumb * 60).toFixed(0)}px/s)→ ${String(frames).padStart(2)} 帧后提交`
      + ` · 早于最佳按拍的 ${PRESS_LEAD_FRAMES.toFixed(0)} 帧?${frames < PRESS_LEAD_FRAMES ? "是 → 按时起手的人照样拿到方向" : "否"}`
      + ` · 挥拍窗里方向未定的帧数 ≈ ${late}/${SW.active + 1}`);
    ok(frames < PRESS_LEAD_FRAMES, `拇指慢到 ${(vThumb * 60).toFixed(0)}px/s 时,横滑提交(${frames} 帧)仍早于最佳按拍提前量(${PRESS_LEAD_FRAMES.toFixed(0)} 帧)`);
  }
  // 「早拍没提交」的真正代价:想压底线,却由 mid 兜底解出中场球
  const deep = solve(280, 150, 1, C.aimDepth.deep, 0.7, BASE);
  const mid = solve(280, 150, 1, C.aimDepth.mid, 0.7, BASE);
  console.log(`  代价量化:同样站位同样质量,瞄准深球落 ${deep.trace.landX.toFixed(0)}`
    + `、被 mid 兜底落 ${mid.trace.landX.toFixed(0)} → 差 ${(deep.trace.landX - mid.trace.landX).toFixed(0)}px 深度`);
  ok(deep.trace.landX - mid.trace.landX > 60, "早拍退回 mid 的代价是「深度损失」而不是「接不到」(差值应 >60px)");
}

// ============================================================
// §5 移速档:同一批球,把脚速换一档还剩几帧(只作用于真人,AI 走 diffs.speed)
// ============================================================
console.log("\n=== §5 移速档:脚速换一档,接同一拍还剩几帧 ===");
{
  const HOME = CO.netX - 200;
  const gTiers = C.gait.tiers.slice().sort((a, b) => b.s - a.s);    // 快 → 慢
  const gs = (id: string): number => C.gait.tiers.find((t) => t.id === id)!.s;
  /** 走落点 slack:球速档固定,只换脚速 */
  const landSlack = (paceId: string, gaitId: string): number => {
    Gait.apply(gaitId);
    let worst = Infinity;
    for (const sc of SCENES) {
      const { ball, landX } = incoming(paceId, sc);
      const t = arriveFrame(ball, landX);
      const r = runFrames(HOME, landX, "stick-full", 8);
      if (t >= 0 && r >= 0) worst = Math.min(worst, t - r - PRESS_LEAD_FRAMES);
    }
    return worst;
  };
  const runTo150 = (gaitId: string): number => {
    Gait.apply(gaitId);
    return runFrames(HOME, HOME + 150, "stick-full", 8);
  };

  const paceDef = C.pace.default;
  let prevRun = Infinity;
  const defSlack = landSlack(paceDef, C.gait.default);
  for (const t of gTiers) {
    const run = runTo150(t.id);
    const slack = landSlack(paceDef, t.id);
    console.log(`  ${t.id.padEnd(9)} ×${t.s.toFixed(2)}  跑 150px=${String(run).padStart(3)} 帧`
      + ` · 走落点 slack=${slack.toFixed(1).padStart(5)} 帧(相对标准档 ${(slack - defSlack >= 0 ? "+" : "") + (slack - defSlack).toFixed(1)})  ${t.label}`);
    if (prevRun !== Infinity) {
      ok(run >= prevRun - 1e-9, `${t.id}:脚越慢,跑位帧单调不减(${run} ≥ 上一档 ${prevRun})`);
    }
    prevRun = run;
  }
  // 真人侧专属:AI 不该被玩家的设置牵着走 —— 它已经有 diffs.speed 这一层,
  // 再叠一遍 serve-check/sim-check 就变成了在测玩家偏好而不是测 AI。
  const aiRun = (gaitId: string): number => {
    Gait.apply(gaitId);
    const p = Player.create("left", { homeX: HOME, isAI: true });
    p.x = HOME; p.speedMul = 1;
    const base: PlayerInput = {
      left: false, right: true, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
    };
    for (let f = 0; f <= 600; f++) {
      if (Math.abs(p.x - (HOME + 150)) <= 8) return f;
      Player.update(p, base, null);
    }
    return -1;
  };
  ok(aiRun("standard") === aiRun("xfast"),
    `脚速档只作用于真人:AI 位跑同样的 150px 都是 ${aiRun("standard")} 帧(标准 vs 极快)`);
  const fast = runTo150(gTiers[0].id), slowest = runTo150(gTiers[gTiers.length - 1].id);
  ok(fast < slowest, `最快档与最慢档的跑位帧拉开 ${slowest - fast} 帧 —— 这才叫"可调",不是名义上的档位`);

  // 矩阵:球速 × 移速 的组合。用户挑档位的真实问题永远是"这两个旋钮怎么配",
  // 分开看两张表会误判(慢球 + 慢脚 ≈ 好接;慢球 + 快脚 = 从容到没对手)
  console.log(`  组合矩阵(走落点 slack,单位=帧;球速档 ↓ × 脚速档 →)`);
  console.log("    " + "".padEnd(12) + gTiers.map((t) => t.id.padStart(9)).join(""));
  for (const p of ["fast", paceDef, "vslow", "xslow"]) {
    const cells = gTiers.map((g) => landSlack(p, g.id).toFixed(0).padStart(9));
    console.log(`    ${p.padEnd(12)}${cells.join("")}`);
  }
  // 脚速这一摊不该比球速更"贵":默认脚速 + 原速球 已经来不及(slack ≤ §3 默认档),
  // 而默认组合必须留出余量 —— 这两条一起钉住"出货组合是接得住的"
  ok(landSlack("fast", C.gait.default) <= defSlack,
    `脚速不变、球回到原速:余量只会更少(${landSlack("fast", C.gait.default).toFixed(1)} ≤ ${defSlack.toFixed(1)})`);
  ok(defSlack >= 0, `出货组合(${paceDef} × ${C.gait.default})接得到最硬的那一拍(实得 ${defSlack.toFixed(1)} 帧)`);
  Gait.apply(C.gait.default);   // 别让后面的段落带着临时档位跑
}

console.log(`\n${bad === 0 ? "反应预算与输入画像自洽 ✓" : `${bad} 项断言失败`}`);
process.exit(bad === 0 ? 0 : 1);
