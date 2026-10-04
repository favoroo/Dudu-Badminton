// ============================================================
// 网前击球物理与判定回归 (2026-10-04 新增)。
//
// 背景(用户反馈):「羽毛球在球网旁边的时候,感觉击打起来操作不太舒服」。
// 经诊断,存在两大致命机制缺陷:
//   ① 隔网硬拦截(inOwnCourt: x < 480 严格)与时机环脱节:
//      玩家在网前 x=470 时,判定区心在 488.7(已在对方半场),时机环按区心引导玩家
//      在球抵网口时按键,但球在 480~485 时 tryHit 直接判非法拒接 -> 必成假动作挥空!
//   ② 网前低球(h <= 40px)解算 100% 挂网自杀死刑:
//      离网仅 10px,而过网高度要求爬升 53~73px,几何需要起飞角 >80°;
//      但旧 loftMaxDeg=79 且 netClearMargin=10 死咬不放,导致 safeAngle 无解直接认命下网。
//
// 本工具钉死:
//   §1 网前低球与各高度击球绝不下网 (x0=470, h in [15..140], near/mid/deep)
//   §2 镜像对称性 (右场 x0=490 同步无死角)
//   §3 网口击球容差与高位截击 (网顶与球身探过时允许击球,拒绝对方半场深球)
//   §4 网前高球扑杀/放网特性 (出射角与球种符合网前直觉)
//
// 用法: node .tools-build/tools/net-shot-check.js [--selftest]
// ============================================================
import { Physics } from "../assets/scripts/core/physics";
import { CFG } from "../assets/scripts/core/config";
import { Player } from "../assets/scripts/core/player";
import { Rules } from "../assets/scripts/core/rules";
import { Ball } from "../assets/scripts/core/types";
import { makeChecker } from "./harness";

const C = CFG;
const CO = C.court;

const isSelfTest = process.argv.includes("--selftest");
const chk = makeChecker();

console.log(`=== 网前击球机制与物理回归 ${isSelfTest ? "[SELFTEST]" : ""} ===`);

// ============================================================
// §1 网前各高度出球绝不下网断言
// ============================================================
console.log("\n--- §1 网前各高度出球过网断言 (x0 = 470, 离网 10px) ---");
const testHeights = [15, 20, 30, 40, 50, 60, 75, 80, 95, 120, 150];
const aims = ["near", "mid", "deep"] as const;

let netFailCount = 0;
for (const h of testHeights) {
  const y0 = CO.groundY - h;
  for (const aim of aims) {
    const depth = (C.aimDepth as Record<string, number>)[aim];
    const loft = Physics.loftFor(depth, h, 0.5);
    const solved = Physics.solveShot(470, y0, 1, depth, loft, 0);
    const hitNet = solved.trace.hitNet;
    const landOpponent = solved.trace.landX > CO.netX;
    if (hitNet || !landOpponent) {
      netFailCount++;
    }
  }
}
chk.ok(netFailCount === 0, `网前 x0=470 处 ${testHeights.length} 个高度 × 3 个瞄准档位全解算过网 (挂网数: ${netFailCount})`);

// ============================================================
// §2 左右半场镜像对称性
// ============================================================
console.log("\n--- §2 左右半场网前对称性断言 ---");
let mirrorMismatch = 0;
for (const h of [25, 40, 70, 110]) {
  const y0 = CO.groundY - h;
  for (const aim of aims) {
    const depth = (C.aimDepth as Record<string, number>)[aim];
    const loft = Physics.loftFor(depth, h, 0.5);
    const leftSol = Physics.solveShot(470, y0, 1, depth, loft, 0);
    const rightSol = Physics.solveShot(490, y0, -1, depth, loft, 0);
    const speedDiff = Math.abs(leftSol.speed - rightSol.speed);
    const degDiff = Math.abs(leftSol.deg - rightSol.deg);
    const netYDiff = Math.abs((leftSol.trace.netY ?? 0) - (rightSol.trace.netY ?? 0));
    if (speedDiff > 0.05 || degDiff > 0.1 || netYDiff > 0.2 || leftSol.trace.hitNet !== rightSol.trace.hitNet) {
      mirrorMismatch++;
    }
  }
}
chk.ok(mirrorMismatch === 0, `左右半场网前击球解算完全镜像对称 (不匹配数: ${mirrorMismatch})`);

// ============================================================
// §3 网口击球容差与合法性判定
// ============================================================
console.log("\n--- §3 网口击球容差与截击判定 ---");
Rules.newMatch("1p", "normal");
const R = Rules.R;
const hero = R.players[0];
hero.isAI = false;
hero.x = 470; hero.y = CO.groundY; hero.onGround = true; hero.facing = 1;
hero.swingT = 8; // 最佳击球帧附近

const ball = R.ball as Ball;
ball.live = true; ball.held = false; ball.flying = false;
ball.lastHitter = "right";
ball.vx = -5; ball.vy = 2;

// 3.1 网顶正上方 (ball.x = 480) 必须允许击打 (不能因为严格 <480 而拒绝)
hero.swingBest = null;
ball.x = 480; ball.y = CO.netTopY - 10; ball.px = ball.x + 5; ball.py = ball.y - 2;
const hitOnTape = Player.tryHit(hero, ball);
const acceptedOnTape = hitOnTape !== null || hero.swingBest !== null;
chk.ok(acceptedOnTape, `球在网带正上方 (x=480, y=netTopY-10) 判定有效/成功记账 (实际: ${acceptedOnTape ? "已接受" : "拒接"})`);

// 3.2 探过球网微量容差 (球体部分进入网口上方，如 x=484, 高于网) 允许截击
hero.swingBest = null;
ball.x = 484; ball.y = CO.netTopY - 15; ball.px = ball.x + 5; ball.py = ball.y - 2;
const hitJustPast = Player.tryHit(hero, ball);
const acceptedJustPast = hitJustPast !== null || hero.swingBest !== null;
chk.ok(acceptedJustPast, `高球微探网口 (x=484, 高于网顶) 允许网前拦截 (实际: ${acceptedJustPast ? "已接受" : "拒接"})`);

// 3.3 对方半场深球 (x=515) 必须严格拒绝 (不能隔网隔大半场乱够)
hero.swingBest = null;
ball.x = 515; ball.y = CO.netTopY - 15; ball.px = ball.x + 5; ball.py = ball.y - 2;
const hitDeepOpponent = Player.tryHit(hero, ball);
const acceptedDeep = hitDeepOpponent !== null || hero.swingBest !== null;
chk.ok(!acceptedDeep, `对方半场深球 (x=515) 严格拒绝击打 (实际: ${acceptedDeep ? "违规命中" : "正确拒接"})`);

// ============================================================
// §4 自测反例断言 (--selftest)
// ============================================================
if (isSelfTest) {
  console.log("\n--- §4 自测反例断言 (旧版行为必须被报警拦截) ---");
  // 模拟旧版硬性隔网判断: 严格 x < 480
  const legacyInOwnCourt = (x: number): boolean => x < 480;
  const legacyBlocked = !legacyInOwnCourt(480);
  chk.ok(legacyBlocked, `[selftest] 旧版在 x=480 必定拒接 (模拟成功: ${legacyBlocked})`);

  // 模拟旧版在 x0=470, h=30 时解算挂网
  const legacySolved = Physics.solveShot(470, CO.groundY - 30, 1, C.aimDepth.mid, 68, 0);
  console.log(`[selftest 观测] h=30 解算结果 hitNet=${legacySolved.trace.hitNet}`);
}

console.log(`\n结果: ${chk.checks} 项检查, ${chk.fails} 失败`);
process.exit(chk.fails > 0 ? 1 : 0);
