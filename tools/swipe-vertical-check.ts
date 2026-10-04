// ============================================================
// 击球键纵向手势回归(2026-10-04 新增):上滑 = 挑高,下滑 = 平抽。
//
// 背景(用户需求):击球键原先只有左滑右滑(落点深浅),要给上下滑也配上击打效果,
// 与左右滑组合成「落点 × 弧线」二维瞄准:上+右 = 挑高到后场(防守过渡),
// 下滑 = 压平弧线(平抽/下压快球)。
//
// 这条功能的坏法全都不崩、不报错,只会安静地不好用:
//   ① 上滑没有下托分支 → 高点球照旧压平,怎么滑都打不出高球(「按了没反应」的弧线版)
//   ② 下滑压平过狠     → 低点击球下网自杀,手势变成送分键
//   ③ 手势漏进跳杀/发球 → 空中挑高把跳杀改成慢球、发球弧线被改写
//   ④ 中性单按被带偏   → 没滑的那一拍也变了弹道,spec/net/reach 一批闸门的基线全歪
//
// 钉死:
//   §1 上滑必出挑高:全高度 × 三深浅 kind=lob、deg ≥ 下托角(loftUpMinDeg)、绝不挂网;
//      网前上滑豁免「mid 自动扑推」(明确意图优先)
//   §2 下滑压平:高点击球 deg ≤ loftDownMaxDeg(扣杀/劈吊档),低点击球被 safeAngle
//      抬回 —— 绝不下网
//   §3 两轴组合:上+右 = 挑高到后场;下+近 = 压平到网前;预告(preview)与实打同路径
//   §4 中性单按逐字段不变:swingLoft=0 的弹道与旧公式(loftFor+solveShot)逐位一致
//   §5 边界主权:跳杀压平赢过上滑(空中永远是扣杀);发球(forced)不吃手势
//   §6 输入管道:inp.swingSwipeY 在挥拍中实时覆写 p.swingLoft;不带字段(AI/替身)则不动
//
// 用法:node .tools-build/tools/swipe-vertical-check.js [--selftest]
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { CFG } from "../assets/scripts/core/config";
import { Physics } from "../assets/scripts/core/physics";
import { Ball, HitOpt, PlayerInput, Player as PlayerEntity, ShotResult } from "../assets/scripts/core/types";
import { makeChecker } from "./harness";

const C = CFG;
const CO = C.court;
const SPAN = C.shot.farOffset - C.shot.nearOffset;
const X0 = CO.netX - 175;          // 中后场站位(与 lunge-check 同一口径,贴网/贴底的特殊几何不在这里测)

const isSelfTest = process.argv.includes("--selftest");
const chk = makeChecker();

console.log(`=== 击球键纵向手势(上滑挑高 / 下滑平抽)回归 ${isSelfTest ? "[SELFTEST]" : ""} ===`);

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 干净的左场真人:与 Rules 全局解耦,buildShot 只读 p 上的瞄准/意图/质量字段 */
function mkHero(): PlayerEntity {
  return Pl.create("left");
}

/** buildShot 只读接触点坐标,给一个最小球(不走进 settle/tryHit,不需要完整 Ball) */
function mkBall(h: number, x = X0): Ball {
  const y = CO.groundY - h;
  return { x, y, px: x, py: y } as unknown as Ball;
}

/** 出手辅助:质量档由调用方显式给(不偷偷注入 perfect —— §4 的中性基线必须是零加成) */
function shotOf(hero: PlayerEntity, ball: Ball, aim: string | number, loft: number, opt: HitOpt = {}): ShotResult {
  hero.swingAim = aim;
  hero.swingLoft = loft;
  return Pl.buildShot(hero, ball, { dEdge: 0, heat: 0, ...opt });
}

/** 临时钉死 Math.random(中性弹道的误差项归零,§4/§5 发球对照用) */
function withFixedRandom<T>(fn: () => T): T {
  const orig = Math.random;
  Math.random = () => 0.5;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

// ============================================================
// §1 上滑必出挑高
// ============================================================
console.log("\n--- §1 上滑:全高度 × 三深浅 kind=lob、不下托不罢休 ---");
{
  const hero = mkHero();
  const heights = [15, 30, 50, 80, 110, 150, 200];
  const aims = ["near", "mid", "deep"] as const;
  let bad = 0;
  let spot = "";
  for (const h of heights) {
    for (const aim of aims) {
      const s = shotOf(hero, mkBall(h), aim, 1, { q: 1, perfect: true });
      const okKind = s.kind === "lob";                       // classify 里 lob(deg>55)排在 netshot 前 ⇒ 与深浅无关
      const okDeg = s.deg >= C.shot.loftUpMinDeg - 1e-6;     // 下托角是地板:safeAngle 只会再抬,不会压破
      const okLand = !s.intoNet && s.landX > CO.netX;
      if (!okKind || !okDeg || !okLand) {
        bad++;
        spot += `\n      h=${h} aim=${aim}: kind=${s.kind} deg=${s.deg.toFixed(1)} landX=${s.landX.toFixed(0)} intoNet=${s.intoNet}`;
      }
    }
  }
  chk.ok(bad === 0, `上滑 ${heights.length} 高度 × ${aims.length} 深浅全出挑高、deg ≥ ${C.shot.loftUpMinDeg}°、全过网(坏格:${bad})${spot}`);

  // 网前上滑豁免自动扑推:mid 在网前高球本会被强改成 0.32 扑推,明确的挑高意图优先
  const s = shotOf(hero, mkBall(110, CO.netX - 20), "mid", 1, { q: 1, perfect: true });
  const forcedDepthLand = CO.netX + C.shot.nearOffset + 0.32 * SPAN;
  chk.ok(s.kind === "lob" && s.landX > forcedDepthLand + 20,
    `网前上滑(mid)不走 0.32 扑推:landX=${s.landX.toFixed(0)} > 扑推参考线 ${(forcedDepthLand).toFixed(0)},kind=${s.kind}`);
}

// ============================================================
// §2 下滑压平
// ============================================================
console.log("\n--- §2 下滑:高点击球压进上限,低点击球被 safeAngle 兜回 ---");
{
  const hero = mkHero();
  // 高击球点(> slashH 92):cap 生效,deg ≤ 12 ⇒ 扣杀(h>140 且够快)或劈吊
  let badHigh = 0;
  let spotHigh = "";
  for (const h of [120, 150, 200]) {
    for (const aim of ["mid", "deep"] as const) {
      const s = shotOf(hero, mkBall(h), aim, -1, { q: 1, perfect: true });
      const okDeg = s.deg <= C.shot.loftDownMaxDeg + 1e-6;
      const okKind = s.kind === "smash" || s.kind === "slash";
      const okLand = !s.intoNet && s.landX > CO.netX;
      if (!okDeg || !okKind || !okLand) {
        badHigh++;
        spotHigh += `\n      h=${h} aim=${aim}: kind=${s.kind} deg=${s.deg.toFixed(1)} landX=${s.landX.toFixed(0)} intoNet=${s.intoNet}`;
      }
    }
  }
  chk.ok(badHigh === 0, `下滑高点击球(h=120/150/200 × mid/deep)deg ≤ ${C.shot.loftDownMaxDeg}° 且落进扣杀/劈吊档(坏格:${badHigh})${spotHigh}`);

  // 低击球点:12° 必然过不了网,safeAngle 自动抬回 —— 手势只输意图,不造自杀球
  let badLow = 0;
  let spotLow = "";
  for (const h of [20, 40]) {
    for (const aim of ["mid", "deep"] as const) {
      const s = shotOf(hero, mkBall(h), aim, -1, { q: 1, perfect: true });
      if (s.intoNet || s.landX <= CO.netX) {
        badLow++;
        spotLow += `\n      h=${h} aim=${aim}: kind=${s.kind} deg=${s.deg.toFixed(1)} landX=${s.landX.toFixed(0)} intoNet=${s.intoNet}`;
      }
    }
  }
  chk.ok(badLow === 0, `下滑低点击球(h=20/40)被 safeAngle 抬回,全过网(坏格:${badLow})${spotLow}`);
}

// ============================================================
// §3 两轴组合与预告一致性
// ============================================================
console.log("\n--- §3 组合瞄准:上+右 挑到后场,下+近 压到网前,预告同路径 ---");
{
  const hero = mkHero();
  // 上+右:挑高球种 + 深落点(防守过渡的完整承诺)
  const upDeep = shotOf(hero, mkBall(110), "deep", 1, { q: 1, perfect: true });
  const deepLine = CO.netX + C.shot.nearOffset + 0.55 * SPAN;
  chk.ok(upDeep.kind === "lob" && !upDeep.intoNet && upDeep.landX >= deepLine,
    `上+右 = 挑高到后场:kind=${upDeep.kind} landX=${upDeep.landX.toFixed(0)} ≥ ${deepLine.toFixed(0)}`);

  // 下+近:落点照旧压到网前。注意 deg **不**断言 ≤ 上限 —— 「低角 + 短落点」几何上
  // 不成立(平快球必然落深,要落得近就必须慢,慢了在到网前就坠破网带),safeAngle
  // 会抬角兑现落点:手势意图让位于过网,预告徽标如实显示最终球种(这里=劈吊)。
  const dnNear = shotOf(hero, mkBall(110), "near", -1, { q: 1, perfect: true });
  const nearLine = CO.netX + C.shot.nearOffset + 0.3 * SPAN;
  chk.ok(!dnNear.intoNet && dnNear.landX < nearLine
    && (dnNear.kind === "slash" || dnNear.kind === "netshot"),
    `下+近 = 网前下压:kind=${dnNear.kind} deg=${dnNear.deg.toFixed(1)}(safeAngle 抬定)landX=${dnNear.landX.toFixed(0)} < ${nearLine.toFixed(0)}`);

  // 纵向意图必须同时进入预告通道:preview 与实打同一份弹道(spec-shot 契约在纵轴上的投影)
  const real = shotOf(hero, mkBall(110), "mid", 1, { q: 1, perfect: true });
  const prev = shotOf(hero, mkBall(110), "mid", 1, { q: 1, perfect: true, preview: true });
  chk.ok(prev.kind === real.kind && prev.kind === "lob" && Math.abs(prev.deg - real.deg) < 1e-9,
    `预告与实打同路径(上滑):kind=${prev.kind}/${real.kind},deg 差 ${Math.abs(prev.deg - real.deg).toExponential(1)}`);
}

// ============================================================
// §4 中性单按逐字段不变
// ============================================================
console.log("\n--- §4 中性单按(swingLoft=0)与旧公式逐位一致 ---");
{
  const hero = mkHero();
  const aims = ["near", "mid", "deep"] as const;
  let bad = 0;
  let spot = "";
  withFixedRandom(() => {
    for (const h of [30, 80, 110, 150, 200]) {
      for (const aim of aims) {
        const depth = (C.aimDepth as Record<string, number>)[aim];
        // 旧公式:loftFor 直接夹上下限,没有纵向偏置 —— 新代码在 swingLoft=0 时必须走同一条路
        const loft0 = clampN(Physics.loftFor(depth, h, 0.5), C.shot.loftMinDeg, C.shot.loftMaxDeg);
        const legacy = Physics.solveShot(X0, CO.groundY - h, 1, depth, loft0, 0);
        const s = shotOf(hero, mkBall(h), aim, 0, { q: 0.5 });
        const same = s.kind === legacy.kind
          && Math.abs(s.deg - legacy.deg) < 1e-9
          && Math.abs(s.landX - legacy.trace.landX) < 1e-9
          && Math.abs(s.power - legacy.speed) < 1e-9;
        if (!same) {
          bad++;
          spot += `\n      h=${h} aim=${aim}: 新(kind=${s.kind} deg=${s.deg.toFixed(2)}) vs 旧(kind=${legacy.kind} deg=${legacy.deg.toFixed(2)})`;
        }
      }
    }
  });
  chk.ok(bad === 0, `没滑的那一拍 = 物理自动决定,${15} 格逐位一致(漂移格:${bad})${spot}`);
}

// ============================================================
// §5 边界主权:跳杀赢过上滑;发球(forced)不吃手势
// ============================================================
console.log("\n--- §5 跳杀压平 > 手势;发球弧线不被手势改写 ---");
{
  const hero = mkHero();
  // 空中 + 高球 + jumpSmash:无论上滑还是下滑,压平上限(8°)都是最终裁决
  hero.onGround = false;
  const air = shotOf(hero, mkBall(150), "deep", 1, { q: 1, perfect: true, jumpSmash: true });
  const airDown = shotOf(hero, mkBall(150), "deep", -1, { q: 1, perfect: true, jumpSmash: true });
  hero.onGround = true;
  chk.ok(air.kind === "smash" && air.deg <= C.jumpSmash.maxLoftDeg + 1e-6
    && airDown.kind === "smash" && airDown.deg <= C.jumpSmash.maxLoftDeg + 1e-6,
    `空中跳杀不被手势改写:上滑 deg=${air.deg.toFixed(1)} / 下滑 deg=${airDown.deg.toFixed(1)} 均 ≤ ${C.jumpSmash.maxLoftDeg}°`);

  // 发球:forced 路径有自己的弧线编排(serve.loftDelta),纵向意图必须被无视
  const srv = withFixedRandom(() => {
    hero.swingAim = "mid";
    hero.swingLoft = 1;
    const withUp = Pl.buildShot(hero, mkBall(60), { q: 0.5, forced: { depth: 0.5 } });
    hero.swingLoft = 0;
    const neutral = Pl.buildShot(hero, mkBall(60), { q: 0.5, forced: { depth: 0.5 } });
    return { withUp, neutral };
  });
  chk.ok(Math.abs(srv.withUp.deg - srv.neutral.deg) < 1e-9 && srv.withUp.kind === srv.neutral.kind,
    `发球不吃手势:上滑 vs 中性 deg ${srv.withUp.deg.toFixed(2)} vs ${srv.neutral.deg.toFixed(2)},kind ${srv.withUp.kind}/${srv.neutral.kind}`);
}

// ============================================================
// §6 输入管道:挥拍中实时覆写,不带字段不动
// ============================================================
console.log("\n--- §6 inp.swingSwipeY → p.swingLoft 覆写管道 ---");
{
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  hero.isAI = false;
  const ball = R.ball as Ball;
  ball.live = true; ball.held = false; ball.flying = false;
  ball.lastHitter = "right";
  ball.x = CO.netX + 120; ball.y = CO.groundY - 160; ball.px = ball.x; ball.py = ball.y;
  ball.vx = -4; ball.vy = 1;

  const base: PlayerInput = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    swingAim: null, swingSwipe: 0, swingSwipeY: 0, lungePressed: false, lungeDir: 0,
  };
  const midSwing = (): void => {
    hero.swingT = C.swing.windup + 3;   // 挥拍进行中
    hero.swingLoft = 0;
    hero.swingAim = "mid";
  };

  midSwing();
  Pl.update(hero, { ...base, swingSwipeY: 1 }, ball);
  chk.ok(hero.swingLoft === 1, `挥拍中上滑输入 → p.swingLoft=1(实际 ${hero.swingLoft})`);

  midSwing();
  Pl.update(hero, { ...base, swingSwipeY: -1 }, ball);
  chk.ok(hero.swingLoft === -1, `挥拍中下滑输入 → p.swingLoft=-1(实际 ${hero.swingLoft})`);

  // AI / 回归替身的输入不带纵轴字段(undefined):不得把意图碰出来
  midSwing();
  const noY: PlayerInput = { ...base };
  delete (noY as { swingSwipeY?: number }).swingSwipeY;
  Pl.update(hero, noY, ball);
  chk.ok(hero.swingLoft === 0, `无纵轴字段(AI/替身形态)→ p.swingLoft 保持 0(实际 ${hero.swingLoft})`);

  // 未挥拍时不覆写(与横滑同构:起拍才接手)
  hero.swingT = -1;
  hero.swingLoft = 0;
  Pl.update(hero, { ...base, swingSwipeY: 1 }, ball);
  chk.ok(hero.swingLoft === 0, `未挥拍时纵轴输入不覆写(实际 ${hero.swingLoft})`);
}

// ============================================================
// §7 自测反例(--selftest:旧世界必须被上述判据拦下)
// ============================================================
if (isSelfTest) {
  console.log("\n--- §7 自测反例:喂旧写法,判据必须喊疼 ---");
  // 反例①:buildShot 没有下托分支(纵向被丢弃)—— §1 同一格格子上旧公式打不出挑高
  {
    const depth = C.aimDepth.deep;
    const legacyLoft = clampN(Physics.loftFor(depth, 110, 1) - C.perfect.powerDeg, C.shot.loftMinDeg, C.shot.loftMaxDeg);
    const legacy = Physics.solveShot(X0, CO.groundY - 110, 1, depth, legacyLoft, C.shot.perfectBoost);
    chk.ok(legacy.deg < C.shot.loftUpMinDeg,
      `[selftest] 旧写法(无下托分支)h=110 深球 deg=${legacy.deg.toFixed(1)} < ${C.shot.loftUpMinDeg} —— §1 判据有牙齿`);
  }
  // 反例②:没有压平分支 —— 完美时机在 h=120 的自然出射角远高于下滑承诺的上限
  {
    const depth = C.aimDepth.mid;
    const legacyLoft = clampN(Physics.loftFor(depth, 120, 1) - C.perfect.powerDeg, C.shot.loftMinDeg, C.shot.loftMaxDeg);
    chk.ok(legacyLoft > C.shot.loftDownMaxDeg,
      `[selftest] 旧写法(无压平分支)h=120 自然 deg=${legacyLoft.toFixed(1)} > ${C.shot.loftDownMaxDeg} —— §2 判据有牙齿`);
  }
  // 反例③:偏置顺序颠倒(下托放在跳杀压平之后)会顶开跳杀的角度上限
  {
    const jmLoft = Math.min(
      clampN(Physics.loftFor(C.aimDepth.deep, 150, 1) - C.perfect.powerDeg - C.jumpSmash.powerDeg, C.shot.loftMinDeg, C.shot.loftMaxDeg),
      C.jumpSmash.maxLoftDeg);
    const wrongOrder = Math.max(jmLoft, C.shot.loftUpMinDeg);
    chk.ok(wrongOrder > C.jumpSmash.maxLoftDeg,
      `[selftest] 顺序颠倒(先压平后下托)deg=${wrongOrder.toFixed(1)} 会顶开跳杀 ${C.jumpSmash.maxLoftDeg}° 上限 —— §5 判据有牙齿`);
  }
  // 反例④:纵向提交阈值若放松到与横向相同,点按漂移就会意外挑高/平抽
  chk.ok(C.touchAim.commitPxY > C.touchAim.commitPx,
    `[selftest] 纵向提交阈值(${C.touchAim.commitPxY}px)必须比横向(${C.touchAim.commitPx}px)紧 —— 防点按漂移误触`);
}

console.log(`\n结果: ${chk.checks} 项检查, ${chk.fails} 失败`);
process.exit(chk.fails > 0 ? 1 : 0);
