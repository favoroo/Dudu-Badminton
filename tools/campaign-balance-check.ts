// ============================================================
// 闯关模式逐关可通关性回归 (campaign-balance-check)
//
// 为什么要有这一条:campaign-check 管「表自洽 / 进度账本 / 判据文案」,
// ai-check / serve-check 管对练档的胜负带 —— 但**没有任何一把尺子量过
// 「这 20 关,每一关真的打得赢吗」**。关卡是机制(modifiers)+ AI 档 + 不对称减免
// 叠出来的,某一关叠狠了(机制全压在玩家身上、减免又没给够)就是隐形死局:
// 不崩不报错,玩家只是永远打不过。
//
// 量法:对每一关 Rules.startCampaign(stage) 真开一局,把左队换成
// 「normal 档 AI 的脑子 + 真人的身体」(isAI=true、aiDiff="normal",
// speedMul/zoneScale/aiAimErr 保持真人值 —— 真人玩家就是这副身体),
// 右队是关卡原样 AI(含 aiRelief 减免与 aiSkill)。两侧都喂 AI.think,
// 固定种子跑 N 局,统计替身胜率与平均比分。
//
// 这把尺子量的是**地板**不是天花板:真人玩家有技能、有判断、会针对机制调整,
// 理应比 normal 替身强;所以断言是「替身胜率有地板」(这一关不是死局),
// 不是「替身胜率越高越好」。第 20 关(10:10 赛点开局 + 死亡赛 + hard)地板放宽。
//
// 用法(先 npx tsc -p tools/tsconfig.json):
//   node .tools-build/tools/campaign-balance-check.js            # exit 0 = 通过
//   CAMPAIGN_BALANCE_MATCHES=48 node .tools-build/tools/campaign-balance-check.js  # 加样本标定
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { AI } from "../assets/scripts/core/ai";
import { CAMPAIGN_STAGES, StageDef } from "../assets/scripts/core/campaign";
import { PlayerInput } from "../assets/scripts/core/types";

// 固定种子(与 serve-check/ai-check 同一条规矩):回归门必须确定性 ——
// 24 局样本下胜率的批间波动(±8%)足以让贴线断言「有时绿有时红」。
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(0xD0D0CA9);

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

const empty = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
});

const MATCHES_PER_STAGE = Number(process.env.CAMPAIGN_BALANCE_MATCHES ?? 24);
const MAX_STEPS_PER_MATCH = 60 * 60 * 30;

interface MatchOut { win: boolean; my: number; op: number; unfinished: boolean }

function playOne(stage: StageDef): MatchOut {
  Rules.startCampaign(stage);
  // 左队换成 normal 档 AI 代理:**只换脑子,不换身体**。
  // startCampaign 里 applyAiTier 跑时它是真人(speedMul/zoneScale/aiAimErr 是真人值),
  // 保持原样 —— 真人玩家进这一关就是这副身体,这才量得到「这一关对真人公不公平」。
  // AI.think 的档位读数走 p.aiDiff(见 ai.ts 的 D()),relief 只落在右队身上。
  const me = Rules.R.players.find((p) => p.side === "left");
  if (!me) throw new Error("startCampaign 后左队没人");
  me.isAI = true;
  me.aiDiff = "normal";
  let steps = 0;
  while (steps < MAX_STEPS_PER_MATCH && Rules.R.state !== "OVER") {
    const R = Rules.R;
    const ins: PlayerInput[] = [];
    for (const p of R.players) {
      ins[p.idx] = R.ball ? AI.think(p, R.ball, R.state) : empty();
    }
    Rules.step(ins);
    R.events.length = 0;
    steps++;
  }
  const [my, op] = Rules.R.scores;
  return { win: Rules.R.winner === "left", my, op, unfinished: Rules.R.state !== "OVER" };
}

interface Row { stage: StageDef; wins: number; n: number; avgMy: number; avgOp: number; unfinished: number }

function measure(stage: StageDef, n: number): Row {
  let wins = 0, sumMy = 0, sumOp = 0, unfinished = 0;
  for (let i = 0; i < n; i++) {
    const r = playOne(stage);
    if (r.unfinished) unfinished++;
    if (r.win) wins++;
    sumMy += r.my; sumOp += r.op;
  }
  return { stage, wins, n, avgMy: sumMy / n, avgOp: sumOp / n, unfinished };
}

// ---------- 主流程 ----------
console.log(`=== 闯关逐关可通关性:normal 替身(真人身体) vs 关卡 AI,每关 ${MATCHES_PER_STAGE} 局 ===`);
console.log(`    替身口径:AI.think(normal) + 真人 speedMul/zoneScale/aiAimErr;关卡机制双方同受,减免只落右队`);
const rows: Row[] = [];
for (const stage of CAMPAIGN_STAGES) {
  const row = measure(stage, MATCHES_PER_STAGE);
  rows.push(row);
  const rate = row.wins / row.n;
  console.log(
    `  第${String(stage.stageNo).padStart(2)}关 ${stage.title.padEnd(6)} [${stage.aiDiff}]`
    + ` 胜率 ${(rate * 100).toFixed(0).padStart(3)}%(${row.wins}/${row.n})`
    + ` 场均 ${row.avgMy.toFixed(1)}:${row.avgOp.toFixed(1)}`
    + (row.unfinished ? `  ⚠ ${row.unfinished} 局未打完` : ""),
  );
}

// ---------- 判据 ----------
// ① 死局闸:任何一关都不许 0 胜;地板 10%(normal 脑子 + 真人身体,
//    真人玩家有技能有针对,且替身在「读秒类机制」关上系统性偏弱,
//    地板以下就是机制叠狠了),第 20 关(赛点开局 + 死亡赛 + hard)放宽到 3%。
//    【标定记录 2026-11-02】基线与调参过程见 CHANGELOG;
//    24 局样本噪声 ±10pp,10% 地板拦的是 0~1 胜的死局,不拦「难」。
// ② 未完赛容许:低重力/磁轨关 AI 对读会偶发磨局,24 局里 ≤2 局按败计可以接受,
//    再多就是「这关回合收不掉」的软死局。
const FLOOR = 0.10;
const FLOOR_FINAL = 0.03;
const MAX_UNFINISHED = 2;
for (const r of rows) {
  const rate = r.wins / r.n;
  const floor = r.stage.deathmatch ? FLOOR_FINAL : FLOOR;
  assert(r.unfinished <= MAX_UNFINISHED, `第${r.stage.stageNo}关有 ${r.unfinished} 局在 ${MAX_STEPS_PER_MATCH} 步内没打完(回合收不掉的软死局)`);
  assert(rate >= floor,
    `第${r.stage.stageNo}关「${r.stage.title}」替身胜率 ${(rate * 100).toFixed(0)}% 低于地板 ${(floor * 100).toFixed(0)}%(疑似死局/机制叠狠)`);
}

// ③ 章节难度带:难度曲线整体上行 —— 终章必须是四章里最难的;
//    章间允许 10 点以内的回升(遮蔽关替身高估真人、机制关低估,均值本身就糊),
//    但不许断崖式回落(>10 点 = 终章比前面还简单,曲线塌了)。
const chapterRate = (ch: number): number => {
  const inCh = rows.filter((r) => r.stage.chapter === ch);
  return inCh.reduce((s, r) => s + r.wins / r.n, 0) / inCh.length;
};
const chRates = [1, 2, 3, 4].map(chapterRate);
console.log(`\n  章节均值:一章 ${(chRates[0] * 100).toFixed(0)}% → 二章 ${(chRates[1] * 100).toFixed(0)}%`
  + ` → 三章 ${(chRates[2] * 100).toFixed(0)}% → 四章 ${(chRates[3] * 100).toFixed(0)}%`);
for (let ch = 2; ch <= 4; ch++) {
  assert(chRates[ch - 1] <= chRates[ch - 2] + 0.10,
    `第${ch}章替身胜率均值 ${(chRates[ch - 1] * 100).toFixed(0)}% 大幅高于第${ch - 1}章 ${(chRates[ch - 2] * 100).toFixed(0)}%(难度曲线回落)`);
}
assert(chRates[3] <= chRates[0] && chRates[3] <= chRates[1] && chRates[3] <= chRates[2],
  `第四章(${(chRates[3] * 100).toFixed(0)}%)必须是四章里替身胜率最低的(终章不能比前面简单)`);


if (failures) {
  console.log(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log("\n闯关逐关可通关性回归 ✓");
