// 一次性验证脚本(不属于游戏运行时代码):自 tools/probe.js 移植。
// 检查「运行时选球模型」= loftFor(高度,深浅) + solveShot(落点) 是否产出合理弹道,
// 以及左右镜像对称性 —— 场地参数不对称时会在这里现形。
import { CFG } from "../assets/scripts/core/config";
import { Physics } from "../assets/scripts/core/physics";

const CO = CFG.court;

const AIM: Record<string, number> = { 近网: 0.12, 中场: 0.5, 深区: 0.92 };
const HEIGHTS = [10, 40, 70, 100, 140, 180, 220];

function line(x0: number, y0: number, dir: number, depth: number, q: number) {
  const h = CO.groundY - y0;
  const deg = Physics.loftFor(depth, h, q);
  const r = Physics.solveShot(x0, y0, dir, depth, deg);
  const t = r.trace;
  return { r, t, deg };
}

console.log("=== 中后场(x=280)击球:不同击球高度 × 瞄准深浅 ===");
console.log("高度  瞄准   θ    v    落点   滞空  网口y  过网  球种");
for (const h of HEIGHTS) {
  for (const [name, depth] of Object.entries(AIM)) {
    const y0 = CO.groundY - h;
    const { r, t, deg } = line(280, y0, 1, depth, 0.5);
    console.log(
      String(h).padStart(4), name.padEnd(4),
      deg.toFixed(0).padStart(4), r.speed.toFixed(1).padStart(5),
      t.landX.toFixed(0).padStart(6), String(t.steps).padStart(5),
      (t.netY === null ? "—" : t.netY.toFixed(0)).padStart(6),
      (t.hitNet ? "下网" : "OK").padStart(4), r.kind.padEnd(8),
      t.landX > CO.right ? "出界" : ""
    );
  }
}

console.log("\n=== 甜蜜点(q=1)vs 勉强够到(q=0)对比,x=280 h=170 ===");
for (const q of [0, 0.5, 1]) {
  const { r, t, deg } = line(280, CO.groundY - 170, 1, 0.92, q);
  console.log("  q=" + q, "θ=" + deg.toFixed(0), "v=" + r.speed.toFixed(1),
    "land=" + t.landX.toFixed(0), "steps=" + t.steps, r.kind);
}

console.log("\n=== 网前(x=445)各种高度:能不能打出贴网球 ===");
for (const h of [60, 80, 95, 110]) {
  for (const depth of [0.05, 0.2, 0.5]) {
    const { r, t, deg } = line(445, CO.groundY - h, 1, depth, 0.6);
    console.log("  h=" + String(h).padStart(3), "d=" + depth.toFixed(2),
      "θ=" + deg.toFixed(0).padStart(3), "land=" + t.landX.toFixed(0).padStart(4),
      "steps=" + String(t.steps).padStart(3), t.hitNet ? "下网" : r.kind);
  }
}

console.log("\n=== 底线救球(x=90, 球在很低位) ===");
for (const h of [8, 25, 50]) {
  const { r, t, deg } = line(90, CO.groundY - h, 1, 0.92, 0.4);
  console.log("  h=" + h, "θ=" + deg.toFixed(0), "v=" + r.speed.toFixed(1),
    "land=" + t.landX.toFixed(0), "steps=" + t.steps, t.hitNet ? "下网" : r.kind);
}

console.log("\n=== 左半场镜像一致性(dir=-1, x=680) ===");
let mirrorBad = 0;
for (const h of [40, 120, 200]) {
  const R = line(280, CO.groundY - h, 1, 0.5, 0.5);
  const L = line(680, CO.groundY - h, -1, 0.5, 0.5);
  const mirror = 960 - L.t.landX;
  const ok = Math.abs(mirror - R.t.landX) < 3;
  if (!ok) mirrorBad++;
  console.log("  h=" + String(h).padStart(3),
    "右→land=" + R.t.landX.toFixed(0), "左→land=" + L.t.landX.toFixed(0),
    "镜像应为≈" + (960 - R.t.landX).toFixed(0),
    ok ? "✓" : "✗ 不对称");
}

console.log("\n=== 可达性:角色站在 x,拍头能扫到的范围 ===");
const P = { x: 300, y: CO.groundY, facing: 1, swingStyle: "over" as const };
const rad = Physics.reachRadius({ vx: 8, vy: -8 });
console.log("  来球速度 11.3px/step → 拍头半径", rad.toFixed(1));
let minx = 9e9, maxx = -9e9, miny = 9e9;
for (let e = 0; e <= Physics.swingTotal(); e++) {
  const hd = Physics.racketHead(P, e, rad);
  minx = Math.min(minx, hd.x); maxx = Math.max(maxx, hd.x); miny = Math.min(miny, hd.y);
}
console.log("  站立挥拍扫掠 x∈[" + minx.toFixed(0) + "," + maxx.toFixed(0) + "] 最高 y=" + miny.toFixed(0) +
  " (离地 " + (CO.groundY - miny).toFixed(0) + "px,网高 " + (CO.groundY - CO.netTopY) + "px)");
P.y = CO.groundY - 129; // 跳起最高点
miny = 9e9;
for (let e = 0; e <= Physics.swingTotal(); e++) miny = Math.min(miny, Physics.racketHead(P, e, rad).y);
console.log("  跳起最高点挥拍 → 最高离地 " + (CO.groundY - miny).toFixed(0) + "px");

if (mirrorBad) {
  console.log(`\n镜像校验失败 ${mirrorBad} 处`);
  process.exit(1);
}
