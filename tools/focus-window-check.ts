// ============================================================
// 时空领域(focus)的「两个时钟」回归 —— 2026-10-05。
//
// 用户现场:「时空技能,我现在挥拍很难击中球了」。
//
// 根因(量出来的,不是猜的):领域把**世界**拖到 ballSlow=0.35 步/真实帧,却故意把
// **玩家的挥拍**留在真实时间(player.update 的 focusTimeStep = 1/0.35 ≈ 2.86,为了让领域里
// "人像子弹时间里的自己那样快")。于是"按下后第 9 帧到质量峰"这件玩家侧的事,在领域里只值
// 3.1 个**世界步**,而下面三处全还在数世界步:
//   · 时机环的锚(game-root.updateSwingCue:PRESS_LEAD_FRAMES + reactFrames)
//   · 代拍择帧尺子(player.autoSwingDue:fc <= PRESS_LEAD_FRAMES)
//   · 判定区按来球速度的收严(swing.zoneFastMul)
// ⇒ 环在区心前 9 世界步喊"现在按",那一拍却在 3.1 世界步就走完了峰。
// 修之前实测:领域内**按时机环按 100% 挥空**,按拍容错从平时 15~17 世界步掉到 5~9。
//
// 本工具钉住五件事:
//   ① 时机环喊「现在按」那一帧按下去必须打中(领域内/外 × 三种来球),环亮到玩家真按下
//      (反应余量走完)那一帧也得打中 —— 预告的两个端点都算数。
//   ② 代拍(autoSwingDue)的首个"该按"帧 = 折算后的提前量(不许更早),且那一拍真打出去。
//   ③ 判定区:领域内按**玩家看到的真实速率**收严(等于不收严),领域外照旧收严;
//      领域内必须比平时放宽(zoneReachMul > 1 —— 拍头每真实帧扫过的弧长是平时 2.9 倍,
//      手长来自扫掠范围,不是把命中窗拖长)。
//   ④ 领域不许比平时更难接:容错窗折算成**真实帧**后,领域内 ≥ 领域外。
//   ⑤ 总闸 fx.slowmoEnabled=false ⇒ 世界根本没变速,四处折算必须全部回到 1
//      (留着补偿就是"世界全速、挥拍还快 2.86 倍",领域立刻变成比平时难三倍的空挥游戏)。
//   ⑥ --selftest:四份反例(锚不折算 / 择帧不折算 / 判定区吃世界步速度 / 领域不放宽)必须被拦下。
//
// 用法: npx tsc -p tools/tsconfig.json && node .tools-build/tools/focus-window-check.js [--selftest]
// ============================================================
import { makeChecker } from "./harness";
import { CFG } from "../assets/scripts/core/config";
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl, PRESS_LEAD_FRAMES, type ZoneProbe } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { AutoHit } from "../assets/scripts/core/auto-hit";
import { Physics, flightFramesToClosest } from "../assets/scripts/core/physics";
import type { Ball, PlayerInput, Player as PlayerEntity } from "../assets/scripts/core/types";

const C = CFG, CO = C.court, SW = C.swing, F = C.skills.focus;
const SELFTEST = process.argv.includes("--selftest");
const REACT = C.swingCue.reactFrames;

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
});

/** 来球画像:分量按**世界步**计(与真机同一条积分),从区心上游 STEPS 步发过来 */
interface Feed { name: string; vx: number; vy: number }
const FEEDS: Feed[] = [
  { name: "平抽 6px/步", vx: -6, vy: 0.8 },
  { name: "慢下坠 4px/步", vx: -4, vy: 1.6 },
  { name: "快压 7px/步", vx: -7, vy: 2.2 },
];
const STEPS = 14;

function setup(focusOn: boolean, feed: Feed): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  hero.skill = Skills.initSkillState(focusOn ? "focus" : "lunge");
  Skills.resetPoint(hero);
  hero.x = CO.netX - 175;
  hero.y = CO.groundY; hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.stats.whiffs = 0;
  if (focusOn) { hero.focusT = F.duration; if (hero.skill) hero.skill.buffT = F.duration; }

  const z = Pl.strikeZone(hero, Math.hypot(feed.vx, feed.vy));
  const ball = R.ball as Ball;
  ball.x = z.x - feed.vx * STEPS;      // 区心上游 STEPS 世界步
  ball.y = z.y - feed.vy * STEPS;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = feed.vx; ball.vy = feed.vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = "right";
  ball.crossed = true; ball.netted = false; ball.shot = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;
  hero.isAI = false;
  return { hero, ball };
}

/** 零输入跑一遍:球离判定区心最近的世界步(容错窗的时间原点)+ 那时的逼近距离/半径 */
function closest(focusOn: boolean, feed: Feed): { t: number; d: number; r: number } {
  const { hero, ball } = setup(focusOn, feed);
  const R = Rules.R;
  const z = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy));
  let best = Infinity, t = -1;
  for (let f = 0; f < 120; f++) {
    R.events.length = 0;
    Rules.step(R.players.map(() => emptyInput()));
    if (!ball.live || ball.held || ball.flying || R.state !== "RALLY") break;
    const d = Math.hypot(ball.x - z.x, ball.y - z.y);
    if (d < best) { best = d; t = f; }
  }
  return { t, d: best, r: z.r };
}

/** 在第 pressFrame 世界步按一拍(零反应延迟的手动),回是否打中 */
function pressOnce(focusOn: boolean, feed: Feed, pressFrame: number): boolean {
  const { hero, ball } = setup(focusOn, feed);
  const R = Rules.R;
  for (let f = 0; f < 120; f++) {
    R.events.length = 0;
    const mine = f === pressFrame ? { swingAim: "mid" as const } : {};
    Rules.step(R.players.map((p) => (p === hero ? { ...emptyInput(), ...mine } : emptyInput())));
    if (R.events.some((ev) => ev.t === "hit" && ev.side === "left")) return true;
    if (!ball.live || ball.held || ball.flying || R.state !== "RALLY") break;
    if (hero.stats.whiffs > 0) break;
  }
  return false;
}

/** 零输入 + 代拍:回系统首个"该按"帧(走导出的 autoSwingDue)与真起手帧/是否打中(走内部那条) */
function autoRun(focusOn: boolean, feed: Feed): { dueFrame: number; frame: number; hit: boolean } {
  const { hero, ball } = setup(focusOn, feed);
  const R = Rules.R;
  let dueFrame = -1, frame = -1;
  AutoHit.request(true);
  try {
    for (let f = 0; f < 120; f++) {
      R.events.length = 0;
      if (dueFrame < 0 && Pl.autoSwingDue(hero, ball, "auto")) dueFrame = f;
      Rules.step(R.players.map(() => emptyInput()));
      if (frame < 0 && hero.swingT >= 0) frame = f;
      if (R.events.some((ev) => ev.t === "hit" && ev.side === "left")) return { dueFrame, frame, hit: true };
      if (!ball.live || ball.held || ball.flying || R.state !== "RALLY") break;
      if (hero.stats.whiffs > 0) break;
    }
  } finally {
    AutoHit.reset();
  }
  return { dueFrame, frame, hit: false };
}

/** 按拍容错:相对区心帧的偏移里哪些帧按下去打得着(世界步 → 真实帧按 1/ballSlow 折) */
function tolerance(focusOn: boolean, feed: Feed): { world: number; real: number; lo: number; hi: number } {
  const { t } = closest(focusOn, feed);
  const ks: number[] = [];
  for (let k = -40; k <= 14; k++) {
    if (t + k < 0) continue;
    if (pressOnce(focusOn, feed, t + k)) ks.push(k);
  }
  const rate = focusOn ? Pl.worldRate({ focusT: 1 }) : 1;
  return { world: ks.length, real: ks.length / rate, lo: ks.length ? Math.min(...ks) : NaN, hi: ks.length ? Math.max(...ks) : NaN };
}

// ---------- 反例用的"修之前"实现(跨模块调用点,patch 得到) ----------
/** 旧判定区:收严按世界步速度、且没有领域放宽 */
function oldZone(p: ZoneProbe, speed: number): { x: number; y: number; r: number } {
  const fast = Math.max(0, Math.min(1, ((speed || 0) - C.swing.zoneFullSpeed) / C.swing.zoneTightenSpan));
  const isLunging = (p.lungeT ?? -1) >= 0;
  const lungeMul = isLunging ? C.lunge.reachMul
    : ((p.lungeAutoT ?? 0) > 0 && C.lunge.autoReturn ? C.lunge.reachTailMul : 1);
  const off = Physics.strikeOffset(p.swingRadius, isLunging ? (p.lungeDir || p.facing) : p.facing, lungeMul);
  const tight = 1 + (C.swing.zoneFastMul - 1) * fast;
  return { x: p.x + off.dx, y: p.y + off.dy, r: (p.swingRadius * 0.92 + C.swing.headR) * (p.zoneScale ?? 1) * tight * lungeMul };
}

interface Mutants { anchor?: boolean; due?: boolean; zoneSpeed?: boolean; zoneWide?: boolean }
const isMut = (m: Mutants): boolean => !!(m.anchor || m.due || m.zoneSpeed || m.zoneWide);

function runSuite(mut: Mutants): { fails: string[]; notes: string[] } {
  const fails: string[] = [];
  const notes: string[] = [];
  const h = makeChecker({ printPass: !isMut(mut) });
  const ok = (cond: boolean, msg: string): void => { h.ok(cond, msg); if (!cond) fails.push(msg); };

  const origCue = Pl.swingCuePressFrames;
  const origDue = Pl.autoSwingDue;
  const origZone = Pl.strikeZone;
  if (mut.anchor) Pl.swingCuePressFrames = () => PRESS_LEAD_FRAMES + REACT;   // ① 旧:环锚不折算
  if (mut.due) Pl.autoSwingDue = (p: PlayerEntity, ball: Ball | null) => {     // ② 旧:择帧不折算
    if (!ball || !ball.live || ball.held || ball.flying || ball.lastHitter === p.side) return false;
    const z = origZone(p, Math.hypot(ball.vx || 0, ball.vy || 0));
    const fc = flightFramesToClosest(ball, z.x, z.y, z.r, C.autoHit.autoHorizon);
    return fc !== null && fc <= PRESS_LEAD_FRAMES;
  };
  if (mut.zoneSpeed) Pl.strikeZone = oldZone;                                  // ③ 旧:收严按世界步速度
  else if (mut.zoneWide) Pl.strikeZone = (p: ZoneProbe, speed: number) => {     // ④ 旧:领域不放宽
    const z = origZone(p, speed);
    return { x: z.x, y: z.y, r: z.r / ((p.focusT ?? 0) > 0 ? (F.zoneReachMul ?? 1) : 1) };
  };

  try {
    // ---------- ① 环喊「现在按」的那一帧,按下去必须打中 ----------
    console.log("\n=== ① 预告与挥拍同钟:环喊的帧按下去打得着 ===");
    for (const feed of FEEDS) {
      const base = closest(false, feed);
      if (base.d > base.r) { ok(false, `${feed.name}:来球画像够不到判定区(最近逼近 ${base.d.toFixed(0)} > r=${base.r.toFixed(0)}),用例失效`); continue; }
      for (const focusOn of [false, true]) {
        const tc = base.t;
        const { hero } = setup(focusOn, feed);
        const guide = Math.round(Pl.swingCuePressFrames(hero));
        const reactSpan = Math.round(Pl.playerFramesToWorld(hero, REACT));
        const tag = `${feed.name} ${focusOn ? "领域内" : "领域外"}`;
        ok(pressOnce(focusOn, feed, Math.max(0, tc - guide)), `${tag}:环喊帧(区心前 ${guide} 世界步)按 → 打中`);
        ok(pressOnce(focusOn, feed, Math.max(0, tc - guide + reactSpan)), `${tag}:环喊后走完反应(+${reactSpan} 步)按 → 打中`);
      }
    }

    // ---------- ② 代拍择帧与环共用同一把折算 ----------
    console.log("\n=== ② 代拍(autoSwingDue)首个「该按」帧 = 折算后的提前量 ===");
    for (const feed of FEEDS) {
      const tc = closest(false, feed).t;
      for (const focusOn of [false, true]) {
        const { hero } = setup(focusOn, feed);
        const lead = Math.round(Pl.playerFramesToWorld(hero, PRESS_LEAD_FRAMES));
        const { dueFrame, frame, hit } = autoRun(focusOn, feed);
        const tag = `${feed.name} ${focusOn ? "领域内" : "领域外"}`;
        ok(hit, `${tag}:代拍把球打出去了`);
        ok(dueFrame >= 0 && Math.abs((tc - dueFrame) - lead) <= 1,
          `${tag}:首个该按帧距区心 ${dueFrame >= 0 ? tc - dueFrame : "-"} 步 ≈ 折算提前量 ${lead} 步(±1,不许更早)`);
        ok(frame >= 0 && Math.abs(frame - dueFrame) <= 1, `${tag}:真起手帧与"该按"帧同步(实测 ${frame} vs ${dueFrame})`);
      }
    }
    {
      const { hero: offHero } = setup(false, FEEDS[0]);
      const { hero: onHero } = setup(true, FEEDS[0]);
      const a = Pl.swingCuePressFrames(offHero), b = Pl.swingCuePressFrames(onHero);
      ok(Math.abs(b - a * F.ballSlow) < 1e-6, `环锚跟着世界的速率走:领域内 ${b.toFixed(2)} = 领域外 ${a.toFixed(2)} × ballSlow ${F.ballSlow}`);
      ok(Pl.swingClockScale(onHero) > Pl.swingClockScale(offHero), "领域内 swingT 步进快于领域外(这条判据量的是真实存在的差)");
    }

    // ---------- ③ 判定区的来球速度口径 ----------
    console.log("\n=== ③ 判定区:领域内看玩家眼里的球速,领域外照旧收严 ===");
    {
      const { hero } = setup(false, FEEDS[0]);
      const slow = Pl.strikeZone(hero, 2).r, fast = Pl.strikeZone(hero, 20).r;
      ok(fast < slow, `领域外快球照旧收严:r(20)=${fast.toFixed(1)} < r(2)=${slow.toFixed(1)}`);
      const { hero: fhero } = setup(true, FEEDS[0]);
      const fSlow = Pl.strikeZone(fhero, 2).r, fFast = Pl.strikeZone(fhero, 20).r;
      ok(Math.abs(fFast - fSlow) < 1e-6, `领域内不按世界步速度收严:r(20)=${fFast.toFixed(1)} = r(2)=${fSlow.toFixed(1)}`);
      ok(fSlow > slow * 1.001, `领域内判定区放宽(zoneReachMul=${F.zoneReachMul ?? 1}):${fSlow.toFixed(1)} > 平时最宽档 ${slow.toFixed(1)}`);
      const out = Pl.strikeZone({ ...fhero, focusT: 0 }, 20).r;
      ok(out === fast, "出领域后同一颗快球的判定区回到旧值(不残留领域加成)");
    }

    // ---------- ④ 领域不许比平时更难接 ----------
    console.log("\n=== ④ 容错窗:领域内(折成真实帧)≥ 领域外 ===");
    for (const feed of FEEDS) {
      const a = tolerance(false, feed), b = tolerance(true, feed);
      notes.push(`  ${feed.name}:领域外 ${a.world} 世界步[${a.lo}..${a.hi}] = ${a.real.toFixed(0)} 真实帧 | `
        + `领域内 ${b.world} 世界步[${b.lo}..${b.hi}] = ${b.real.toFixed(0)} 真实帧`);
      ok(a.world > 0, `${feed.name}:领域外打得着(基准用例有效)`);
      ok(b.world > 0, `${feed.name}:领域内打得着(用户现场的那句「很难击中球」)`);
      ok(b.real >= a.real, `${feed.name}:领域内真实容错 ${b.real.toFixed(0)} ≥ 领域外 ${a.real.toFixed(0)}`);
    }

    // ---------- ⑤ 慢放总闸关掉时不许留补偿 ----------
    console.log("\n=== ⑤ fx.slowmoEnabled=false ⇒ 四处折算全部回到 1 ===");
    {
      const orig = C.fx.slowmoEnabled;
      (C.fx as { slowmoEnabled: boolean }).slowmoEnabled = false;
      try {
        const { hero } = setup(true, FEEDS[0]);
        ok(Pl.worldRate(hero) === 1, "世界速率回到 1(没变速就没有可补偿的差)");
        ok(Math.abs(Pl.swingClockScale(hero) - 1) < 1e-9, "swingT 步进不再 ×2.86");
        ok(Math.abs(Pl.swingCuePressFrames(hero) - (PRESS_LEAD_FRAMES + REACT)) < 1e-6, "环锚不再折算");
        ok(Math.abs(Pl.strikeZone(hero, 20).r - Pl.strikeZone({ ...hero, focusT: 0 }, 20).r) < 1e-6,
          "判定区不再按领域口径折算");
      } finally {
        (C.fx as { slowmoEnabled: boolean }).slowmoEnabled = orig;
      }
    }
  } finally {
    Pl.swingCuePressFrames = origCue;
    Pl.autoSwingDue = origDue;
    Pl.strikeZone = origZone;
    AutoHit.reset();
  }
  return { fails, notes };
}

const res = runSuite({});
res.notes.forEach((l) => console.log(l));
if (res.fails.length) {
  console.error("focus-window-check 失败项:", res.fails);
  process.exit(1);
}
if (!SELFTEST) {
  console.log("✓ focus-window-check:时空领域的两个时钟(挥拍 / 预告 / 代拍 / 判定区)口径一致");
  process.exit(0);
}

console.log("\n=== focus-window-check --selftest 反例验证 ===");
const bads: Array<[string, Mutants]> = [
  ["anchorNotScaled(旧:环锚不折算)", { anchor: true }],
  ["dueNotScaled(旧:代拍择帧不折算)", { due: true }],
  ["zoneUsesWorldSpeed(旧:判定区按世界步速度收严)", { zoneSpeed: true }],
  ["domainNoWiderZone(旧:领域不放宽判定区)", { zoneWide: true }],
];
for (const [name, m] of bads) {
  const r = runSuite(m);
  if (r.fails.length === 0) {
    console.error(`反例 ${name} 居然没有被拦截! 测试脚本缺少牙齿!`);
    process.exit(1);
  }
  console.log(`  ✓ 反例 ${name} 被拦住(触发 ${r.fails.length} 处断言失败)`);
}
console.log("✓ 所有反例成功被拦下, --selftest 通过!");
process.exit(0);
