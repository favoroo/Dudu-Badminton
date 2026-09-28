// 逻辑层整机冒烟测试(Cocos 移植新增,老仓库没有对应物)。
// 老仓库的回归是「双击 index.html 打一局」;渲染层还没移植的现在,
// 这里用「AI 对 AI 打完整一局 + 训练场喂球循环」把 rules/ai/player/drill
// 四个模块的整条链路先压一遍:比赛能正常结束、计分/发球权自洽、
// 训练场喂球循环能自持、全程无 NaN。渲染接进来之后它仍是常驻回归。
//
// 用法:node .tools-build/tools/sim-check.js
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { Drill } from "../assets/scripts/core/drill";
import { Career } from "../assets/scripts/core/career";
import { PlayerInput } from "../assets/scripts/core/types";

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

// 让「真人位」也归 AI 驱动:整机测试只关心世界自洽,不关心谁执拍
function makeAllAI(): void {
  for (const p of Rules.R.players) {
    p.isAI = true;
    p.aiDiff = "normal";
  }
}

function drainEvents(): number {
  const evs = Rules.R.events;
  let hits = 0;
  for (const ev of evs) {
    if (ev.t === "hit") hits++;
    if (ev.t === "drill-end") Drill.onEnd(ev as unknown as Parameters<typeof Drill.onEnd>[0]);
  }
  evs.length = 0;
  return hits;
}

function checkFinite(tag: string): void {
  const b = Rules.R.ball;
  if (!b) return;
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
    failures++;
    console.log(`  ✗ ${tag}: 球状态出现 NaN/Infinity (x=${b.x} y=${b.y} vx=${b.vx} vy=${b.vy})`);
    Rules.R.events.length = 0;
  }
}

// ---------- Part A:AI vs AI 完整一局 ----------
console.log("=== Part A:1p · 普通 AI 对 AI 完整一局 ===");
{
  Rules.newMatch("1p", "normal");
  makeAllAI();
  const MAX_STEPS = 60 * 60 * 6;   // 上限 6 个模拟分钟,11 分制打不完就是有问题
  let steps = 0, totalHits = 0, serves = 0, scores = 0;
  while (steps < MAX_STEPS && Rules.R.state !== "OVER") {
    const R = Rules.R;
    const inputs: PlayerInput[] = [];
    for (const p of R.players) {
      inputs[p.idx] = R.ball ? AI.think(p, R.ball, R.state) : { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
    }
    Rules.step(inputs);
    const evs = Rules.R.events;
    for (const ev of evs) {
      if (ev.t === "serve") serves++;
      if (ev.t === "score") scores++;
    }
    evs.length = 0;
    checkFinite(`step ${steps}`);
    steps++;
  }
  // 事件在循环里已清空,这里只补统计最后一段
  assert(Rules.R.state === "OVER", `比赛应在 ${MAX_STEPS} 步内结束(实际 state=${Rules.R.state})`);
  const R = Rules.R;
  assert(R.winner === "left" || R.winner === "right", `应有获胜方(实际 ${R.winner})`);
  const [s0, s1] = R.scores;
  const hi = Math.max(s0, s1), lo = Math.min(s0, s1);
  assert(hi >= 11, `胜方得分应 ≥11(实际 ${s0}:${s1})`);
  assert(hi - lo >= 2, `终局比分应满足领先 ≥2(实际 ${s0}:${s1})`);
  assert(serves >= 10, `发球次数应 ≥10(实际 ${serves})`);
  assert(scores >= 10, `得分事件应 ≥10(实际 ${scores})`);
  assert(R.longestRally >= 1, `最长回合应 ≥1(实际 ${R.longestRally})`);
  console.log(`  用时 ${steps} 步(${(steps / 60).toFixed(0)} 模拟秒) · 发球 ${serves} · 得分 ${scores} · 最长回合 ${R.longestRally} 拍`);

  // 赛后结算链路:AI 对 AI 也算「带 CPU 的比赛」,应正常发奖
  const st = Rules.statsOf("left");
  const res = Career.settle({ mode: R.mode, diff: R.diff, won: R.winner === "left", stats: st, longestRally: R.longestRally });
  assert(res !== null, "赛后结算应返回明细");
  if (res) {
    assert(res.coin > 0 || !R.winner, `胜方应有金币入账(实际 ${res.coin})`);
    const prof = Career.profile();
    assert(prof.coins >= res.coin, `金币入账应一致(${prof.coins} vs ${res.coin})`);
    console.log(`  结算: 金币+${res.coin} 经验+${res.exp} · 连胜 ${res.streak} · 升级 ${res.levelUps.length} 段`);
  }
}
console.log(failures ? "" : "  ✓ Part A 通过");

// ---------- Part B:训练场喂球循环 ----------
console.log("=== Part B:训练场「高远对拉」喂球 60 模拟秒 ===");
{
  Career; // 触碰模块保证加载(与 game 层的模块完整性断言同思路)
  Rules.newMatch("drill", "normal");
  makeAllAI();
  Drill.begin("clear");
  const MAX_STEPS = 60 * 60;
  let steps = 0, serves = 0, ends = 0;
  while (steps < MAX_STEPS) {
    const R = Rules.R;
    const inputs: PlayerInput[] = [];
    for (const p of R.players) {
      // 右队是喂球机:由 Drill.feederInput 驱动(game 层 buildInputs 的替代)
      if (p.side === "right") inputs[p.idx] = Drill.feederInput(p, R);
      else inputs[p.idx] = R.ball ? AI.think(p, R.ball, R.state) : { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
    }
    Rules.step(inputs);
    const evs = Rules.R.events;
    for (const ev of evs) {
      if (ev.t === "serve") serves++;
      if (ev.t === "drill-end") { ends++; Drill.onEnd(ev as unknown as Parameters<typeof Drill.onEnd>[0]); }
    }
    evs.length = 0;
    checkFinite(`drill step ${steps}`);
    steps++;
  }
  assert(serves >= 3, `喂球应循环发球 ≥3 次(实际 ${serves})`);
  assert(ends >= 3, `每球应有 drill-end 事件 ≥3 次(实际 ${ends})`);
  const prog = Drill.prog();
  console.log(`  发球 ${serves} 次 · 结束 ${ends} 球 · 有效拍 ${prog.valid} · 尝试 ${prog.attempts} · 星级 ${Drill.stars()}`);
  // 发球权必须恒在喂球机一侧(训练分支不动 server 的自洽性)
  assert(Rules.R.server === "right", `发球权应恒为喂球机侧(实际 ${Rules.R.server})`);
  assert(Rules.R.scores[0] === 0 && Rules.R.scores[1] === 0, "训练场不得改比分");
}
console.log(failures ? "" : "  ✓ Part B 通过");

if (failures) {
  console.log(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log("\n逻辑层整机自洽 ✓");
