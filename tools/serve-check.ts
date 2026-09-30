// 接发成功率回归(Cocos 移植新增)。
// 背景:AI 接简单发球(尤其网前短球)有肉眼可见的漏接率 —— 根因是拦截点取
// 「球第一次降到可击高度以下」偏向网口 + 开关式跑位惯性过冲,球常落在 AI 身后。
// 本工具把左队换成脚本化发球机(近/深按比例混合),右队交给 AI 接发,
// 只统计「左队发球」的分数:发球后被接回(hit 事件)记成功;
// 漏接再按「挥了没碰着(whiff)」/「压根没起拍」归因,按难度分组输出;
// 阈值断言防回退。样本要够大 —— 单样本方差 ±8%,40 分看不出结论。
//
// 2026-09-30 阈值重划(方向变了,别再拿这条当"AI 越能接越好"):
// 用户反馈入门档"来回怎么都接得到、只有发球漏接" —— 漏接率低本身没问题,
// **只有发球会漏**才是问题。所以本工具继续钉住 normal/hard 的地板(顶两档要稳),
// 另外给 easy 加一条**天花板**:入门档必须真的接漏一些发球(玩家才看得见"这档打得动"),
// 但不许漏到像不会打球。胜负口径归 tools/ai-check.ts,这里只管接发这一件事。
//
// 用法:node .tools-build/tools/serve-check.js
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { CFG } from "../assets/scripts/core/config";
import { Ball, DiffKey, Player, PlayerInput } from "../assets/scripts/core/types";

const C = CFG;
const TRIALS_PER_DIFF = 120;         // 每个难度统计的「左队发球」样本数
const MAX_STEPS_PER_DIFF = 60 * 60 * 40;

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
});

// ---------- 脚本化发球机(扮演左队真人) ----------
// 走回 homeX → 蓄力 serveT 帧后挥拍,落点近/深交替,蓄力都落在 [22,65] 的
// 普通发球区间(避开 flick/clear 两种博弈分支,只测「简单发球」的接发率)。
interface ServerScript { trial: number; serveT: number; delay: number; near: boolean }
const script: ServerScript = { trial: 0, serveT: 0, delay: 30, near: true };

function serverInput(p: Player, ball: Ball, state: string): PlayerInput {
  const inp = emptyInput();
  if (state !== "SERVE" || !ball.held || ball.owner !== p) return inp;
  const dx = p.homeX - p.x;
  if (Math.abs(dx) > 6) { inp.left = dx < 0; inp.right = dx > 0; return inp; }
  script.serveT++;
  if (script.serveT > script.delay) {
    script.serveT = 0;
    inp.swingAim = script.near ? C.aimDepth.near : C.aimDepth.deep;
  }
  return inp;
}

function nextServePlan(): void {
  script.serveT = 0;
  script.near = script.trial % 5 < 3;        // 60% 近网短球,40% 深球
  script.delay = 25 + (script.trial % 4) * 9; // 25/34/43/52 帧,全落普通发球区间
  script.trial++;
}

// 漏接归因:挥了没碰着(whiff)还是压根没起拍(站位/时机没到)
type MissKind = "whiff" | "noswing";

// ---------- 单难度测量 ----------
function measure(diff: DiffKey): { received: number; total: number; miss: Record<MissKind, Record<"near" | "deep", number>> } {
  Rules.newMatch("1p", diff);
  for (const p of Rules.R.players) {
    if (p.side === "right") { p.isAI = true; p.aiDiff = diff; }
  }
  const miss: Record<MissKind, Record<"near" | "deep", number>> = {
    whiff: { near: 0, deep: 0 }, noswing: { near: 0, deep: 0 },
  };
  let received = 0, total = 0;
  let fromLeft = false;                // 本分是否由左队(发球机)发球且尚未判定
  let whiff0 = 0;                      // 该分开始时接发方已累计的 whiff 数
  nextServePlan();
  for (let step = 0; step < MAX_STEPS_PER_DIFF && total < TRIALS_PER_DIFF; step++) {
    if (Rules.R.state === "OVER") {    // 11 分制打完就开新局接着测
      Rules.newMatch("1p", diff);
      for (const p of Rules.R.players) if (p.side === "right") { p.isAI = true; p.aiDiff = diff; }
      nextServePlan();
      fromLeft = false;
    }
    const R = Rules.R;
    const receiver = R.players.find((p) => p.side === "right") as Player;
    const inputs: PlayerInput[] = [];
    for (const p of R.players) {
      if (p.side === "left") {
        inputs[p.idx] = (R.ball ? serverInput(p, R.ball, R.state) : emptyInput());
      } else {
        inputs[p.idx] = R.ball ? AI.think(p, R.ball, R.state) : emptyInput();
      }
    }
    Rules.step(inputs);
    for (const ev of R.events) {
      if (ev.t === "serve" && ev.side === "left") {
        fromLeft = true;
        whiff0 = receiver.stats.whiffs;
      }
      if (ev.t === "hit" && fromLeft && ev.side === "right") {
        received++; total++; fromLeft = false;   // 接发成功(回球质量不论)
      }
      if (ev.t === "score") {
        if (fromLeft) {                // 左队发球的分且没接回 → 漏接归因
          const kind: "near" | "deep" = script.near ? "near" : "deep";
          const how: MissKind = receiver.stats.whiffs > whiff0 ? "whiff" : "noswing";
          miss[how][kind]++;
          total++;
        }
        fromLeft = false;
        nextServePlan();               // 下一分(只在左队发球时真正用到)
      }
    }
    R.events.length = 0;
  }
  return { received, total, miss };
}

// ---------- 主流程 ----------
console.log(`=== 接发成功率:脚本发球机(60% 近网 / 40% 深球)vs AI 接发,每难度 ${TRIALS_PER_DIFF} 个发球样本 ===`);
const table: Array<[string, number]> = [];
for (const diff of ["easy", "normal", "hard"] as DiffKey[]) {
  const r = measure(diff);
  const rate = r.total > 0 ? r.received / r.total : 0;
  table.push([diff, rate]);
  const m = r.miss;
  console.log(`  ${diff.padEnd(6)} 接回 ${r.received}/${r.total} = ${(rate * 100).toFixed(0)}%`
    + `  漏接:挥空 近${m.whiff.near}/深${m.whiff.deep} · 没起拍 近${m.noswing.near}/深${m.noswing.deep}`);
}
// 防回退阈值:在实测均值下方留足余量(单批波动约 ±5%),只拦「明显退化」。
const rateOf = (d: string) => table.find((t) => t[0] === d)?.[1] ?? 0;
assert(rateOf("normal") >= 0.82, `normal 接发成功率应 ≥82%(实际 ${(rateOf("normal") * 100).toFixed(0)}%)`);
assert(rateOf("hard") >= 0.90, `hard 接发成功率应 ≥90%(实际 ${(rateOf("hard") * 100).toFixed(0)}%)`);
assert(rateOf("hard") >= rateOf("normal") - 0.05, "hard 接发成功率不应明显低于 normal");
// 入门档的**天花板**:这一档要故意漏(用户要的"打得动"),但也不许漏成不会接球的木桩。
// 实测 87% 左右(漏的全是"没起拍"= 走位看错,不是挥空)—— 上下各留 8~13 个点的余量。
assert(rateOf("easy") <= 0.95, `easy 接发率不应高到 ${(rateOf("easy") * 100).toFixed(0)}%(入门档要留得下漏接)`);
assert(rateOf("easy") >= 0.70, `easy 接发率不应低于 70%(入门≠不会打球;实际 ${(rateOf("easy") * 100).toFixed(0)}%)`);

if (failures) {
  console.log(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log("\n接发成功率回归 ✓");
